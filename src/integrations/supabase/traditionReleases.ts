// The tradition-pack reads, and the one column a customer may write.
//
// Three boundaries shape this file, and all three are the database's, not conveniences:
//
//   * The release row is never written from here. A browser updates only
//     `weddings.tradition_pack_release_id` on its own wedding; the release itself is
//     content-maintenance territory, governed by `private.guard_tradition_pack_release()`
//     and reached over no HTTP surface the client can name.
//   * Approval is decided on write, not here. `weddings_pack_release_gate` refuses a
//     selection of anything that is not approved at the moment of selection, so this
//     adapter does not re-check the lifecycle before sending the update. A client-side
//     check would look like the guarantee while being a filter someone can edit.
//   * Provenance stays unselected. `review_label`, `review_basis`, `review_scope`,
//     `reviewed_*`, `approved_at`, `deprecated_at`, `author_label`, `machine_assisted`,
//     `machine_assistance_notes`, `source_reference` and `changelog` are not in any column
//     list below. A query that does not ask for them is stronger evidence than a UI that
//     hides them, and it is why `npm run dbtypes:check` can read every column this layer
//     touches: what cannot cross the wire cannot leak.
//
// Reads are two round trips rather than an embedded `tradition_packs(...)` select, for the
// same reason `getWeddingDesign` fetches a template's artwork separately: an embed would
// put a table name inside a column list, which is the shape the data-layer checker exists
// to refuse, and it would silently disappear when RLS hides the concept row instead of
// arriving as a value this file can decide what to do with.

import { supabase } from './client';
import { describe } from '@/lib/safeError';
import type { Database, Json } from './types';

type ReleaseRow = Database['public']['Tables']['tradition_pack_releases']['Row'];
type PackRow = Database['public']['Tables']['tradition_packs']['Row'];

/** What `listSelectableTraditionReleases` projects from a release: identity and coverage. */
type CatalogueRelease = Pick<
  ReleaseRow,
  'id' | 'pack_id' | 'release_number' | 'languages'
>;

/** What it projects from the concept the release belongs to. */
type CataloguePack = Pick<PackRow, 'id' | 'pack_key' | 'display_name' | 'scope_statement'>;

/** A release the host may choose right now, as the picker shows it. */
export interface TraditionReleaseOption {
  id: string;
  packKey: string;
  packDisplayName: string;
  scopeStatement: string;
  releaseNumber: number;
  languages: string[];
}

/** The release this wedding points at, including the definition it pins. */
export interface SelectedTraditionRelease extends TraditionReleaseOption {
  /** The section list the release pins, exactly as stored. Nothing resolves it on the
   *  client: the database resolves it at freeze time, and a renderer only ever reads the
   *  snapshot's resolved list, normalised in `src/lib/invitationSections.ts`. */
  definition: Json;
  /** The contract version this definition claims to satisfy. Compare against
   *  `TRADITION_PACK_DEFINITION_SCHEMA_VERSION`; a release this build does not understand
   *  has to be refused by name rather than rendered as a partial invitation. */
  definitionSchemaVersion: number;
  /** True when the release has been retired since it was chosen. A lifecycle state is not
   *  a customer-facing fact — "deprecated" means nothing on a screen — but "the pack you
   *  chose has been retired, and your existing invitation still reads it" is. */
  retired: boolean;
}

/** `{ data, error }`, with `error` a phrase this file chose, never the server's. */
export type QueryResult<T> = { data: T; error: null } | { data: null; error: string };

const CATALOGUE_RELEASE_COLUMNS = 'id, pack_id, release_number, languages';
const CATALOGUE_PACK_COLUMNS = 'id, pack_key, display_name, scope_statement';
const SELECTION_COLUMNS = 'id, tradition_pack_release_id';
const RELEASE_DETAIL_COLUMNS =
  'id, pack_id, release_number, languages, definition, definition_schema_version, status';

const fail = (context: string, error: unknown): { data: null; error: string } => {
  console.warn(describe('traditionReleases', context, error));
  return { data: null, error: context };
};

/**
 * Every approved release, newest number first within a pack.
 *
 * The `status` filter is not the visibility rule — RLS is — but the policy also lets a host
 * read a *retired* release their own wedding points at, and that row belongs in the editor's
 * "what did I choose" panel, not in a picker of things to choose.
 */
export async function listSelectableTraditionReleases(): Promise<
  QueryResult<TraditionReleaseOption[]>
> {
  const { data: packs, error: packError } = await supabase
    .from('tradition_packs')
    .select(CATALOGUE_PACK_COLUMNS)
    .order('display_name');
  if (packError) return fail('the tradition packs could not be loaded', packError);

  const { data: releases, error: releaseError } = await supabase
    .from('tradition_pack_releases')
    .select(CATALOGUE_RELEASE_COLUMNS)
    .eq('status', 'approved')
    .order('release_number', { ascending: false });
  if (releaseError) return fail('the tradition packs could not be loaded', releaseError);

  const packById = new Map((packs ?? []).map((pack: CataloguePack) => [pack.id, pack]));
  return {
    // A release whose pack did not come back is dropped rather than shown with a blank name:
    // `users_read_packs_with_approved_releases` hides a concept only when it has no approved
    // release, so this can only happen if the two reads saw different database states.
    data: (releases ?? [])
      .map((release: CatalogueRelease) => {
        const pack = packById.get(release.pack_id);
        if (!pack) return null;
        return {
          id: release.id,
          packKey: pack.pack_key,
          packDisplayName: pack.display_name,
          scopeStatement: pack.scope_statement,
          releaseNumber: release.release_number,
          languages: release.languages,
        } satisfies TraditionReleaseOption;
      })
      .filter((option: TraditionReleaseOption | null): option is TraditionReleaseOption =>
        option !== null,
      ),
    error: null,
  };
}

/**
 * The release this wedding points at, or `null` when the host is writing everything themselves.
 *
 * "No tradition pack" is a first-class state rather than a missing row, which is why an absent
 * selection is `{ data: null, error: null }` and not a failure: the invitation still renders
 * from host data, and the editor has nothing to explain.
 */
export async function getSelectedTraditionRelease(
  userId: string,
  weddingId: string,
): Promise<QueryResult<SelectedTraditionRelease | null>> {
  const { data: wedding, error: weddingError } = await supabase
    .from('weddings')
    .select(SELECTION_COLUMNS)
    .eq('id', weddingId)
    .eq('owner_user_id', userId)
    .maybeSingle();
  if (weddingError) return fail('the tradition pack could not be loaded', weddingError);
  if (!wedding) return fail('this invitation could not be opened', null);
  if (!wedding.tradition_pack_release_id) return { data: null, error: null };

  const { data: release, error: releaseError } = await supabase
    .from('tradition_pack_releases')
    .select(RELEASE_DETAIL_COLUMNS)
    .eq('id', wedding.tradition_pack_release_id)
    .maybeSingle();
  if (releaseError) return fail('the tradition pack could not be loaded', releaseError);
  // A wedding pointing at a row the host cannot read is a database that no longer matches
  // its own policy, and guessing would show an invitation whose wording came from nowhere.
  if (!release) return fail('the tradition pack could not be loaded', null);

  const { data: pack, error: packError } = await supabase
    .from('tradition_packs')
    .select(CATALOGUE_PACK_COLUMNS)
    .eq('id', release.pack_id)
    .maybeSingle();
  if (packError || !pack) return fail('the tradition pack could not be loaded', packError ?? null);

  return {
    data: {
      id: release.id,
      packKey: pack.pack_key,
      packDisplayName: pack.display_name,
      scopeStatement: pack.scope_statement,
      releaseNumber: release.release_number,
      languages: release.languages,
      definition: release.definition,
      definitionSchemaVersion: release.definition_schema_version,
      retired: release.status === 'deprecated',
    },
    error: null,
  };
}

/**
 * Point this wedding at an approved release.
 *
 * The read-back is the point of the `.select('id')`: an update that matched no row because
 * RLS did not recognise the caller is not a success, and only the affected count can say
 * which of the two happened.
 */
async function writeSelection(
  userId: string,
  weddingId: string,
  releaseId: string | null,
  context: string,
): Promise<QueryResult<null>> {
  const { data, error } = await supabase
    .from('weddings')
    .update({ tradition_pack_release_id: releaseId })
    .eq('id', weddingId)
    .eq('owner_user_id', userId)
    .select('id');
  if (error) return fail(context, error);
  if (!data || data.length === 0) return fail(context, null);
  return { data: null, error: null };
}

export function selectTraditionRelease(
  userId: string,
  weddingId: string,
  releaseId: string,
): Promise<QueryResult<null>> {
  return writeSelection(userId, weddingId, releaseId, 'that pack could not be chosen');
}

/** Back to writing everything yourself. This is the explicit "No tradition pack" choice. */
export function clearTraditionRelease(
  userId: string,
  weddingId: string,
): Promise<QueryResult<null>> {
  return writeSelection(userId, weddingId, null, 'the pack selection could not be cleared');
}
