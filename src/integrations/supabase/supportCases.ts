// The host's four doors into their own support thread — read the list, read one, open one, answer one.
//
// Stage 11 shipped `api.open_support_case`, `api.get_my_support_cases`, `api.get_my_support_case` and
// `api.reply_to_support_case` (`supabase/migrations/20261020190100_stage11_support_cases.sql`) as one-line
// SECURITY INVOKER wrappers over SECURITY DEFINER bodies that re-derive the caller from `auth.uid()` and
// refuse anybody else. Four grants, all `TO authenticated` and to nobody else (`…:616`, `…:687`, `…:760`,
// `…:866`), which means three things about this file. There is no owner argument to pass,
// because the answer to "whose tickets are these" is the JWT and the bodies ignore anything else a caller
// could name. There is no queue, because a host's list is filtered by `requester_user_id` and nothing else
// (`…:656`), and the operator's queue is a different door this build does not call — see below. And there is
// no way to read somebody else's case: the thread body raises `insufficient_privilege` for a ref that is
// not the caller's (`…:716-718`), which the HTTP tier measures rather than this file asserting.
//
// What it deliberately is not:
//   * **Not an operator surface.** The thirteen `operator_*` doors exist in `api` and in the generated types,
//     and nothing here names one. `npm run product:check` refuses an `operator_` reference anywhere under
//     `src/` except the generated catalogue, and the reason is §10's channel split: an operator act belongs
//     in the one process that signs in as a named human with a password — the Stage 11 operations console,
//     a tool under `scripts/` that is reached from a terminal and never from a route.
//     A browser bundle that could triage a ticket would be an admin console with a URL for a door.
//   * **Not a place that softens a refusal into a guess.** The bodies raise for a blank summary, an unknown
//     category, an oversized reply, a closed case and a thread the caller does not own. PostgREST's message
//     for each names a table, a column or a policy, so `describe()` keeps that prose in `console.warn` and
//     the caller gets one fixed sentence, exactly as `commerceStatus.ts` and `familyReview.ts` do. The forms
//     validate the same bounds first (`SUMMARY_LIMIT`, `REPLY_LIMIT`), so a host who types past one is told
//     before the round trip rather than after it.
//   * **Not a cache.** One call, one read, returned to the component; nothing is written to a row, a draft
//     or storage, and no response is kept between mounts.
//
// The one thing a caller must not get wrong is the null. `open_support_case` accepts a NULL `p_wedding_id`
// as the documented shape of an account-level ticket (`…:92`), and `get_my_support_cases` accepts NULL for
// both filter arguments meaning "no filter" and "the default count" (`…:642-651`). Omitting the key is not
// the same call — PostgREST resolves by exact argument set, so a missing key is 404/PGRST202 — which is why
// every one of those travels as an explicit `null` and why the types in `./types.ts`, which print each
// argument as required and non-null, are the generator's limitation rather than this file's claim.
//
// WHERE THIS FILE HAS BEEN MEASURED. `src/test/supportCasesTransport.test.ts` runs all four functions
// against a recording stand-in for the client and pins the door names, the exact argument sets including the
// nulls, the fixed phrases and the fact that no `.from()` happens here; `src/test/supportCasesShape.test.ts`
// drives the parsers in `@/lib/supportCases` that these four returns depend on. Against the real stack the
// same four doors are driven by `supabase/tests/stage11/85_support_lifecycle.sql` and by
// `supabase/tests/api/stage11_operations_http.test.mjs`, whose `EXPECT_KEYS` table (`…:1349-1353`) lists the
// identical key sets these parsers refuse anything else against. Whether a signed-in non-owner can read
// another host's ref is that tier's case, not this file's.

import { supabase } from './client';
import { describe } from '@/lib/safeError';
import {
  parseCaseList,
  parseCaseThread,
  parseOpenReceipt,
  parseReplyReceipt,
  type OpenCaseReceipt,
  type ReplyReceipt,
  type SupportCaseList,
  type SupportCaseThread,
} from '@/lib/supportCases';
import type { QueryResult } from './weddings';

const MODULE = 'supportCases';

const fail = (context: string, error: unknown): { data: null; error: string } => {
  console.warn(describe(MODULE, context, error));
  return { data: null, error: context };
};

/**
 * Every ticket this account opened, newest first.
 *
 * `status` narrows the list and `null` asks for all of them; `limit` is the page size, and `null` takes the
 * door's own default of 25 (`…:650`). An empty `cases` array is a real answer — an account that has never
 * written to support — and comes back as data, not as an error, because a screen that said "we could not
 * read your tickets" to a customer with none is a screen that teaches them the product is broken.
 */
export async function getMySupportCases(
  status: string | null = null,
  limit: number | null = null,
): Promise<QueryResult<SupportCaseList>> {
  const { data, error } = await supabase
    .schema('api')
    .rpc('get_my_support_cases', { p_status: status ?? null, p_limit: limit ?? null });
  if (error) return fail('your support tickets could not be read', error);
  const list = parseCaseList(data);
  if (list === null) return fail('your support tickets could not be read', null);
  return { data: list, error: null };
}

/**
 * One thread: the ticket, its status history and the host's own messages, with the two flags the body
 * derives rather than stores.
 *
 * A ref that is not this account's answers 403 and arrives here as the same sentence as a ref that does not
 * exist at all — which is the body's design, not this file's mercy: `…:716-718` refuses both, so the surface
 * cannot be used to find out which refs are real.
 */
export async function getMySupportCase(
  caseRef: string,
): Promise<QueryResult<SupportCaseThread>> {
  const { data, error } = await supabase
    .schema('api')
    .rpc('get_my_support_case', { p_case_ref: caseRef });
  if (error) return fail('this support thread could not be read', error);
  const thread = parseCaseThread(data);
  if (thread === null) return fail('this support thread could not be read', null);
  return { data: thread, error: null };
}

/**
 * Open a ticket about one of this host's weddings, or about their account when `weddingId` is null.
 *
 * `idempotencyKey` is not an implementation detail of this call: minting a fresh one per attempt would
 * quietly defeat the door's duplicate protection, so the form owns the key and passes the same one when the
 * host presses the button again. The value crosses as `null`-free text, but `weddingId` crosses as an
 * explicit null for the account-level case, for the arity reason in the header.
 */
export async function openSupportCase(input: {
  weddingId: string | null;
  category: string;
  severity: string;
  summary: string;
  idempotencyKey: string;
}): Promise<QueryResult<OpenCaseReceipt>> {
  const { data, error } = await supabase.schema('api').rpc('open_support_case', {
    p_wedding_id: input.weddingId ?? null,
    p_category: input.category,
    p_severity: input.severity,
    p_summary: input.summary,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return fail('your message could not be sent', error);
  const receipt = parseOpenReceipt(data);
  if (receipt === null) return fail('your message could not be sent', null);
  return { data: receipt, error: null };
}

/**
 * Answer on a thread the host owns.
 *
 * A closed case refuses (`…:823-826`), and this file does not pretend otherwise with a nicer sentence; the
 * page does not offer a box on such a thread at all, because `reply_allowed` in the thread projection tells
 * it not to. A reply on a thread that is `awaiting_information` is what moves it back to `in_progress`, and
 * the receipt's `status` is the door's answer rather than this file's guess.
 */
export async function replyToSupportCase(input: {
  caseRef: string;
  body: string;
  idempotencyKey: string;
}): Promise<QueryResult<ReplyReceipt>> {
  const { data, error } = await supabase.schema('api').rpc('reply_to_support_case', {
    p_case_ref: input.caseRef,
    p_body: input.body,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) return fail('your reply could not be sent', error);
  const receipt = parseReplyReceipt(data);
  if (receipt === null) return fail('your reply could not be sent', null);
  return { data: receipt, error: null };
}
