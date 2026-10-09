// The reviewer's one door: one header, no session, no account.
//
// A relative opening `/r/<credential>` on a phone is not a customer, must not become one, and
// must not be able to see anything beyond the one frozen version they were asked about. This
// module is where that is enforceable, and it is deliberately a copy of `publicInvitation.ts`
// rather than a cousin of it:
//
//   * `api.resolve_family_review` is called with no arguments, so the credential can only
//     arrive in a request header. PostgREST will accept a GET with arguments in the URL
//     against a volatile function, and a link whose credential is in a query string ends up in
//     server access logs, browser history and any `Referer` a third-party asset leaks. A header
//     is not a URL. `scripts/check-product-contract.mjs` fails the build if the argument form
//     is ever written.
//   * `api.submit_family_review` does take arguments — a decision, a label, a note, a section —
//     and they travel in the POST body for the same reason: a body is not an address.
//   * The client is built fresh per call, holds no session, and writes nothing to storage
//     (`persistSession: false`). After a relative reads an invitation and sends a note, a
//     shared family phone keeps neither a session nor a refresh token nor this credential.
//
// Refusals are shaped like the database's. A malformed, unknown, revoked, expired, already
// answered or cross-wedding credential all answer the door with `200 { available: false }`, and
// this file turns each of them into the same one phrase, so a relative who mistyped a link
// learns nothing and nobody probing addresses learns which ones exist.

import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { parseFamilyReviewDocument, parseReviewAnswer, type FamilyReviewDocument, type ReviewAnswerReceipt } from '@/lib/familyReview';
import { describe } from '@/lib/safeError';
import type { QueryResult } from './weddings';

/** The only header a review credential may travel in. */
const TOKEN_HEADER = 'x-review-token';

/** Both doors read the header themselves and refuse anything that is not 43 URL-safe
 *  characters before hashing it (`20261008120000_stage7_family_approval_review.sql:390` and
 *  `:563`), so a string of another shape cannot possibly match. Checked here for the same
 *  reason it is checked there: it is not worth a round trip, and refusing it locally costs
 *  nothing to say. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The two decisions this product records. Anything else is refused by the database's own
 *  CHECK, and the select control offers only these. */
export type ReviewDecision = 'approved' | 'changes_requested';

export interface ReviewAnswer {
  decision: ReviewDecision;
  /** The reviewer's own words for who they are — the product never verifies identity, so this
   *  label is a signature, not a credential. See `docs/audits/stage-7-family-approval.md`. */
  reviewerLabel: string;
  message: string | null;
  sectionKey: string | null;
}

export const REVIEW_UNAVAILABLE = 'This review link is not available.';
export const REVIEW_NOT_RECORDED = 'Your note could not be recorded.';

/**
 * The six sentences `api.submit_family_review` refuses a submission with, transcribed from
 * `supabase/tests/api/stage7_family_approval.test.mjs` rather than from the migration, because
 * what the reviewer is owed is the string the transport actually returned.
 *
 * Passing these through, and nothing else, is the exception to the Stage 2 rule that a client
 * repeats no server message: these six are authored product copy that names no table, no
 * policy and no other family, and one of them is the difference between a reviewer fixing a
 * note on the spot and a reviewer giving up. An unrecognised message is folded into
 * `REVIEW_NOT_RECORDED` with its code logged — a message this build has not read is not a
 * message to put in front of a stranger.
 */
const SUBMISSION_REFUSALS = new Set([
  'the review decision is not one this product records',
  'say who is answering, in their own words',
  'a request for changes needs a note saying what to change',
  'that note is too long to record',
  'that note does not name a section of this invitation',
  'that section reference is too long',
]);

const reviewerClient = (token: string) => createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    global: { headers: { [TOKEN_HEADER]: token } },
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

export async function resolveFamilyReview(
  token: string,
): Promise<QueryResult<FamilyReviewDocument>> {
  if (!TOKEN_SHAPE.test(token)) return { data: null, error: REVIEW_UNAVAILABLE };

  const { data, error } = await reviewerClient(token).schema('api').rpc('resolve_family_review');
  if (error) return unavailable('resolve_family_review', error);

  const document = parseFamilyReviewDocument(data);
  if (document === null) return { data: null, error: REVIEW_UNAVAILABLE };
  return { data: document, error: null };
}

/**
 * Record one answer against the credential's own ask.
 *
 * `null` on success is the receipt (`feedback_id`, `status`, `responded_at`) — the reviewer is
 * told what was recorded, not what the host will decide. On refusal the returned string is the
 * sentence the reviewer can act on. Nothing is retried here: the ask is exactly-once, and a
 * second answer is refused by design (A-03), so replaying a submission would be a bug wearing
 * a spinner.
 */
export async function submitFamilyReview(
  token: string,
  answer: ReviewAnswer,
): Promise<QueryResult<ReviewAnswerReceipt>> {
  if (!TOKEN_SHAPE.test(token)) return { data: null, error: REVIEW_UNAVAILABLE };

  // The generated `Args` for this RPC type `p_message` and `p_section_key` as `string`, because
  // PostgreSQL records no nullability for a function parameter (see the header of `types.ts`).
  // An approved review with no note is `p_message := null` and `p_section_key := null` — A-01 of
  // the Stage 7 battery records that row — so the nulls below are the schema's, not a cast
  // around the types.
  const { data, error } = await reviewerClient(token).schema('api').rpc('submit_family_review', {
    p_decision: answer.decision,
    p_reviewer_label: answer.reviewerLabel,
    p_message: answer.message,
    p_section_key: answer.sectionKey,
  });
  if (error) return notRecorded(error);

  const receipt = parseReviewAnswer(data);
  if (receipt === null) return { data: null, error: REVIEW_UNAVAILABLE };
  return { data: receipt, error: null };
}

const unavailable = (context: string, reason: unknown): { data: null; error: string } => {
  console.warn(describe(context, REVIEW_UNAVAILABLE, reason));
  return { data: null, error: REVIEW_UNAVAILABLE };
};

/** The submission path is the one place a server sentence may reach the reviewer, and only
 *  from the list above — see `SUBMISSION_REFUSALS`. */
const notRecorded = (reason: unknown): { data: null; error: string } => {
  console.warn(describe('submit_family_review', REVIEW_NOT_RECORDED, reason));
  const message = (reason as { message?: unknown } | null | undefined)?.message;
  if (typeof message === 'string' && SUBMISSION_REFUSALS.has(message)) return { data: null, error: message };
  return { data: null, error: REVIEW_NOT_RECORDED };
};
