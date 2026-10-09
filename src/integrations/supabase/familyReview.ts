// The host's side of family review: ask, watch, withdraw.
//
// Three RPCs, all called as the signed-in user, all shaped exactly like `publication.ts` and
// for the same reason. The database derives who is calling from the JWT and proves ownership
// of the wedding server-side, so there is no `p_owner_user_id` to pass — and none of these
// functions could accept one. `api.get_approval_requests(p_wedding_id)` from a host who does
// not own that wedding answers 403 / 42501 / "the caller may not read these reviews", which
// `supabase/tests/api/stage7_family_approval.test.mjs` G-03 measures; a client-supplied owner
// would have been a value the function had to distrust anyway. The same case measures that a
// wedding id belonging to nobody answers identically, so this call is not an oracle for which
// weddings exist.
//
// The credential is the one thing that changes the shape of a normal read. A review token is
// returned exactly once, by `request_family_review`, and this file does not keep it: the
// queue read answers `link_state` instead of the token, because `private.access_tokens` holds
// only a hash and there is nothing to hand back later. That is why the host's screen has to
// show the link at the moment of asking and never pretend it can be re-minted — see
// `FamilyReviewPanel`.
//
// Nothing here touches `private`, and nothing here writes `approval_feedback`: a reviewer's
// note arrives through the anonymous door in `publicReview.ts`, never through a host call.
//
// Errors follow the Stage 2 rule: the returned `error` is a fixed phrase chosen by this file,
// and the only thing taken from the server is its error code, logged through `describe()`.

import { supabase } from './client';
import { describe } from '@/lib/safeError';
import {
  parseApprovalQueue,
  parseFamilyReviewAsk,
  parseReviewWithdrawal,
  type ApprovalRequestRow,
  type FamilyReviewAsk,
  type ReviewWithdrawal,
} from '@/lib/familyReview';
import type { QueryResult } from './weddings';

const MODULE = 'familyReview';

const fail = (context: string, error: unknown): { data: null; error: string } => {
  console.warn(describe(MODULE, context, error));
  return { data: null, error: context };
};

/**
 * Ask one named person to review one frozen version.
 *
 * `expiresAt` is optional, and `null` does not mean "never expires" — it means the lifetime
 * the database itself applies, measured in K-02 of the Stage 7 battery as fourteen days from
 * the ask. The version does not have to be the newest one: an ask against an older frozen
 * version is allowed, and the reviewer is then shown that version, which X-03 measures.
 */
export async function requestFamilyReview(
  weddingId: string,
  versionId: string,
  reviewerDisplayName: string,
  expiresAt?: string,
): Promise<QueryResult<FamilyReviewAsk>> {
  const { data, error } = await supabase.schema('api').rpc('request_family_review', {
    p_wedding_id: weddingId,
    p_version_id: versionId,
    p_reviewer_display_name: reviewerDisplayName,
    p_expires_at: expiresAt ?? null,
  });
  if (error) return fail('the review request could not be made', error);
  const ask = parseFamilyReviewAsk(data);
  if (ask === null) return fail('the review request could not be made', null);
  return { data: ask, error: null };
}

/** Withdraw an ask, and with it the link that represents it. */
export async function revokeFamilyReview(
  requestId: string,
): Promise<QueryResult<ReviewWithdrawal>> {
  const { data, error } = await supabase.schema('api').rpc('revoke_family_review', {
    p_request_id: requestId,
  });
  if (error) return fail('the review request could not be withdrawn', error);
  const withdrawal = parseReviewWithdrawal(data);
  if (withdrawal === null) return fail('the review request could not be withdrawn', null);
  return { data: withdrawal, error: null };
}

/** Every ask this host has made about this wedding, newest first, with each one's history.
 *  An empty array is a real answer — nobody has been asked yet — which Q-01 measures. */
export async function getApprovalRequests(
  weddingId: string,
): Promise<QueryResult<ApprovalRequestRow[]>> {
  const { data, error } = await supabase.schema('api').rpc('get_approval_requests', {
    p_wedding_id: weddingId,
  });
  if (error) return fail('the review requests could not be read', error);
  const queue = parseApprovalQueue(data);
  if (queue === null) return fail('the review requests could not be read', null);
  return { data: queue, error: null };
}
