// The host's read of what was rendered for their wedding, and the two minutes of access that follows.
//
// Two calls, both already granted to a signed-in host by
// `supabase/migrations/20261013120000_stage9_render_outputs.sql`:
//
//   * `api.list_invitation_outputs` — the manifest. The wrapper is one delegation to a
//     `SECURITY DEFINER` body that re-checks ownership and answers `insufficient_privilege`
//     (`:563-569`) if the caller does not own the wedding, so this layer reads a refusal as a refusal
//     rather than as an empty list; an empty list is a wedding with nothing rendered, which the panel
//     says differently.
//   * Storage's signed URL, for one object, for 60 seconds. This is Stage 6's delivery mechanism
//     reused verbatim (`weddingAssets.ts:218`), including its TTL, because §8 promises the private
//     domain "one delivery mechanism" and a second way to fetch bytes would be a second policy to
//     audit.
//
// What this layer deliberately does not do:
//   * It never selects `invitation_outputs` itself. The table does carry a `GRANT SELECT` and an
//     owner-read policy, so a direct read would work — and it would read `object_key`, the one column
//     the RPC withholds on purpose ("a path is not a delivery mechanism"). The path this file signs is
//     composed by `outputDeliveryPath` from fields the RPC does return, and the storage policy
//     `wedding_members_read_output_objects` (`:468-477`) is what authorises it: a composed path that
//     matches no row of a wedding this caller owns signs nothing. So the derivation can only ever fail
//     shut, and the deliberate omission in the projection stays an omission.
//   * It never touches `invitation-previews`. That bucket has no read policy in this build and no
//     consent decision either (§10.3); the objects in it are reached by an opaque key, not by a host's
//     session. `outputDeliveryPath` returns null for any row in that domain and no call is made.
//   * It stores nothing. A signed URL is returned to the caller, held in component state while the
//     host decides to press it, and dropped on the next read. It is never written to a row, a draft,
//     a snapshot or the guest route — the same boundary Stage 6 drew for uploaded media.
//   * It uses no privileged key. The only client imported here is `client.ts`, whose session is the
//     publishable anon one plus the host's own JWT, so invariant I10 holds by inspection.
//
// WHERE THIS FILE HAS BEEN MEASURED. The unit tier is `src/test/invitationOutputs.test.ts` (the shape
// layer, the path derivation and its refusals) and `src/test/invitationOutputsPanel.test.tsx` (both
// functions against a recording stand-in for the client, including the refusal wording). The live tier
// is the Stage 9 browser run over the local stack, which mints a URL for an artefact the render worker
// actually uploaded and reads the bytes back; until that run is recorded, the statements above about
// what Storage does are read off the migration and the Stage 6 battery, not measured through these
// functions.

import { supabase } from './client';
import { describe } from '@/lib/safeError';
import { outputDeliveryPath, parseInvitationOutputs, type InvitationOutput } from '@/lib/invitationOutputs';
import type { QueryResult } from './weddings';

/** The private bucket §8 names for every file a host downloads. Spelled here and nowhere else in
 *  `src/`, for Stage 6's reason: the policy pins `bucket_id` to it, so a second occurrence would be a
 *  second source of truth about which bucket a host may read. */
const BUCKET = 'invitation-outputs';

/** Same 60 seconds Stage 6 measured and the design's §8 row repeats: long enough to press a link,
 *  short enough that a copied address stops being a way to share a file. */
const TTL_SECONDS = 60;

const MODULE = 'invitationOutputs';

const fail = (context: string, error: unknown): { data: null; error: string } => {
  console.warn(describe(MODULE, context, error));
  return { data: null, error: context };
};

/**
 * Every artefact this wedding has ever been given, newest first within each kind.
 *
 * The order is the RPC's (`ORDER BY x.output_kind, x.variant, x.format, x.page_number, x.created_at,
 * x.id`) and is left untouched here: a client-side sort would make the panel's order a second claim
 * about a fact the server already decided.
 */
export async function listInvitationOutputs(
  weddingId: string,
): Promise<QueryResult<InvitationOutput[]>> {
  const { data, error } = await supabase
    .schema('api')
    .rpc('list_invitation_outputs', { p_wedding_id: weddingId });
  if (error) return fail('the list of files could not be read', error);
  // A wedding with nothing rendered answers `[]`, because the body COALESCEs the aggregate to an
  // empty array (`:571-573` of the migration). A `null` here would therefore be a changed projection
  // rather than an empty manifest, and it falls into the shape test below instead of being read as
  // "nothing to show" — the difference matters to the host, who is told one of two sentences.
  const rows = parseInvitationOutputs(data);
  if (rows === null) return fail('the list of files could not be read', null);
  return { data: rows, error: null };
}

/**
 * A short-lived address for one artefact's bytes, or the reason there is not one.
 *
 * The context strings are the host's sentences, because the panel prints them verbatim: a row this
 * build cannot address is a manifest from a changed projection, and "this file has no address" is the
 * truth a host can act on (refresh, or re-render), whereas a path template would be a machine's
 * complaint.
 */
export async function signedOutputUrl(
  weddingId: string,
  output: InvitationOutput,
): Promise<QueryResult<string>> {
  const path = outputDeliveryPath(weddingId, output);
  if (path === null) {
    return {
      data: null,
      error: output.storageDomain === 'published_preview'
        ? 'this file belongs to the published preview, which no session can download'
        : 'this build cannot work out where this file is kept',
    };
  }
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, TTL_SECONDS);
  if (error) return fail('the file could not be opened', error);
  if (!data?.signedUrl) return fail('the file could not be opened', null);
  return { data: data.signedUrl, error: null };
}

/** The seconds this panel's links stay live, said out loud rather than left implicit in copy: the
 *  host is told how long they have to press, and a test can pin the number to the TTL above. */
export const OUTPUT_LINK_SECONDS = TTL_SECONDS;
