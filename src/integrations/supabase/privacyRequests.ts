// What this account has asked for, and how it asks.
//
// Stage 11 shipped `api.create_privacy_request` and `api.get_my_privacy_requests`
// (`supabase/migrations/20261020190300_stage11_privacy_intake.sql:308` and `…:364`, the two doors of §2 at
// `…:242`, over the `internal_api` bodies at `…:245` and `…:332`) as one-line SECURITY INVOKER wrappers over
// SECURITY DEFINER bodies that re-derive the caller from
// `auth.uid()` — `…:320` and `…:373` grant each to `authenticated` and to nobody else. So there is no
// requester argument here, and none could be honoured: the body inserts `v_caller` as the requester (`…:292`)
// and filters the read on the same value (`…:352`).
//
// The honest limitation of this surface, in the product's own words: **filing is not doing.** Stage 11's
// header for this migration is "receive a request, route it, never erase anything" (`…:1`), and the comments
// on the two bodies say it again — the create wrapper "deletes nothing" (`…:328-330`), and Stage 13 owns the
// destructive decision (`…:238-239`). A screen built on these two calls may show a host what they filed and
// where it stands; it may not imply that a copy arrived or a row vanished. That is why the status sentences
// live in `@/lib/privacyRequests` and describe rows rather than futures.
//
// Two argument shapes a caller must get right, both measured against the bodies rather than the generated
// types:
//   * `p_wedding_id` is required. There is no account-level privacy request: a NULL never reaches the FK and
//     fails the ownership test at `…:269-272`, which answers the same refusal as a wedding belonging to
//     somebody else. The page therefore makes the host choose one of their own invitations.
//   * `p_note` crosses as an explicit `null` when absent. Omitting the key is a different call — PostgREST
//     resolves by exact argument set, so a missing key is 404/PGRST202 — and `./types.ts` prints both
//     arguments as required and non-null because PostgreSQL records no parameter nullability. A blank note
//     refuses (`…:265-268`: real text or absent), so the form sends null for an empty box instead of "".
//
// A second tap is not a second request. While this account already holds a live request for the same wedding
// and kind, the body returns that row with `replayed: true` and writes nothing (`…:283-287`), so this file
// needs no idempotency key and the UI needs no double-submit guard to avoid a duplicate queue entry.
//
// WHERE THIS FILE HAS BEEN MEASURED. `src/test/privacyRequestsTransport.test.ts` runs both doors against a
// recording stand-in for the client and pins the argument sets including the nulls, the fixed phrases and the
// fact that no `.from()` happens here; `src/test/privacyRequestsShape.test.ts` drives the parsers in
// `@/lib/privacyRequests` those returns depend on. Against the real stack the same two doors are driven by
// `supabase/tests/stage11/90_privacy_intake.sql` and by the host cases of
// `supabase/tests/api/stage11_operations_http.test.mjs`, whose `EXPECT_KEYS` table (`…:1354-1355`) lists the
// identical key sets these parsers refuse anything else against.

import { supabase } from './client';
import { describe } from '@/lib/safeError';
import {
  parseFileReceipt,
  parsePrivacyList,
  type FilePrivacyReceipt,
  type PrivacyRequestList,
} from '@/lib/privacyRequests';
import type { QueryResult } from './weddings';

const MODULE = 'privacyRequests';

const fail = (context: string, error: unknown): { data: null; error: string } => {
  console.warn(describe(MODULE, context, error));
  return { data: null, error: context };
};

/**
 * Everything this account has filed, newest first, or null-shaped refusal with one fixed sentence.
 *
 * An empty `requests` array is data, not an error: a customer who has never asked for anything has a real
 * answer, and a screen that told them "we could not read your requests" would be teaching them the product
 * is broken.
 */
export async function getMyPrivacyRequests(): Promise<QueryResult<PrivacyRequestList>> {
  const { data, error } = await supabase.schema('api').rpc('get_my_privacy_requests', {});
  if (error) return fail('your privacy requests could not be read', error);
  const list = parsePrivacyList(data);
  if (list === null) return fail('your privacy requests could not be read', null);
  return { data: list, error: null };
}

/**
 * File one request about one wedding this account owns.
 *
 * `note` is the host's own words, and the door keeps them out of the audit trail (`…:55-56`). An absent note
 * crosses as an explicit null — the arity rule in the header — and that is all this function does to it: a
 * blank or whitespace-only note is *not* rewritten here, because the body refuses one (`…:265-268`) and a
 * silent trim would make the app's rule and the database's rule diverge without either being wrong. The form
 * is the place that turns an empty box into `null` (`src/pages/MyData.tsx:126`), which is why the door's own
 * sentence stays reachable. The receipt's `status` and `replayed` are the door's answer, not this file's guess.
 */
export async function createPrivacyRequest(input: {
  weddingId: string;
  kind: string;
  note?: string | null;
}): Promise<QueryResult<FilePrivacyReceipt>> {
  const { data, error } = await supabase.schema('api').rpc('create_privacy_request', {
    p_wedding_id: input.weddingId,
    p_kind: input.kind,
    p_note: input.note ?? null,
  });
  if (error) return fail('your privacy request could not be filed', error);
  const receipt = parseFileReceipt(data);
  if (receipt === null) return fail('your privacy request could not be filed', null);
  return { data: receipt, error: null };
}
