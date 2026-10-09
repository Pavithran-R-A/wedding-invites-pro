// What a family reviewer is shown, and what a host is told about their own asks.
//
// Three reads share this file because they share one failure mode: each arrives as `jsonb`
// from a PostgREST RPC, and JSON is not a type. `api.resolve_family_review` hands the
// reviewer the frozen document plus the metadata that makes the review act meaningful — who
// was asked, when, of which version, and which sections the product will accept a note
// about. `api.get_approval_requests` hands the host one row per ask. `api.request_family_review`,
// `api.revoke_family_review` and `api.submit_family_review` answer with a small verdict
// object. None of them is read with `as` casts here; every field is taken by name, so a
// projection that stopped writing something is a refusal rather than `undefined` reaching a
// screen a stranger is filling in on a phone.
//
// The document itself comes from `parseInvitationObject`, the same reader the guest page
// uses. That is the point of the split: a reviewer must see the document a guest would see,
// and a second parser standing beside the first is how the two would start to differ.
//
// Vocabulary is treated the way `publicInvitation.ts` treats it. A value of the wrong *kind*
// refuses the payload. An unfamiliar *word* — `status`, `link_state`, a history entry's
// `kind` — is kept as text, because the row is still the row the database wrote and a host
// screen can say "this build does not have a label for that word" out loud. Inventing a
// default for an unrecognised status would be worse: it would render tomorrow's word as
// today's `pending`.
//
// `review_token` is the one field in this file that carries a credential, and it appears only
// in the ask. It exists so the host can build the link once; nothing here writes it to
// storage, and `familyReviewLinkPath` is the only place that turns it into an address.

import { asObject, booleanValue, isBooleanValue, isNumberValue, numberValue } from './jsonShape';
import { parseInvitationObject, type PublicInvitation } from './publicInvitation';

/** Three characters of prefix plus the 43-character credential the ask returned. Shaped like
 *  the guest address (`/i/…`), and for the same reason the address is short: this string is
 *  going to be pasted into a chat window and tapped on a phone. */
const REVIEW_PATH_PREFIX = '/r/';

/** The credential's shape: 43 URL-safe characters, from the base64-with-padding-stripped mint
 *  at `20261008120000_stage7_family_approval_review.sql:127`, and asserted on every ask by
 *  `supabase/tests/api/stage7_family_approval.test.mjs`. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export interface FamilyReviewLink {
  path: string;
  token: string;
}

/**
 * The reviewer's address, built from a credential the host was handed once.
 *
 * Returns `null` rather than a plausible-looking path: a token of the wrong shape cannot
 * open the door anyway, and an anchor built from a surprising string is a link the host
 * sends to a relative that goes nowhere, with no way for them to tell why.
 */
export function familyReviewLinkPath(token: string): FamilyReviewLink | null {
  if (!TOKEN_SHAPE.test(token)) return null;
  return { path: `${REVIEW_PATH_PREFIX}${token}`, token };
}

/** The document as the reviewer sees it: the frozen invitation, and the review metadata that
 *  makes it an ask rather than a preview — who was asked, which version, when it was asked,
 *  when the link dies, which sections accept a note, and which request this answer lands on. */
export interface FamilyReviewDocument {
  requestId: string;
  reviewerDisplayName: string;
  versionNumber: number;
  requestedAt: string | null;
  /** The link's own deadline. Nullable because `private.access_tokens.expires_at` is; a token
   *  minted without one lives until it is withdrawn or answered. */
  expiresAt: string | null;
  /** The section keys this invitation accepts a note about, in the order the projection wrote
   *  them. Read as plain text: a section a later migration renames is a note the reviewer
   *  will be told the product does not know, not a blank page. */
  sectionKeys: string[];
  invitation: PublicInvitation;
}

/** What a successful ask returned. `token` is the only raw credential this app ever holds. */
export interface FamilyReviewAsk {
  requestId: string;
  token: string;
  expiresAt: string | null;
}

/** What a withdraw answered: the ask's new state, and whether a live link went with it. */
export interface ReviewWithdrawal {
  requestId: string;
  status: string;
  wasPending: boolean;
  credentialRevoked: boolean;
}

/** What recording an answer answered. */
export interface ReviewAnswerReceipt {
  feedbackId: string;
  status: string;
  respondedAt: string | null;
}

/** One note or decision the reviewer has already left, as the host's queue reports it. */
export interface ApprovalHistoryEntry {
  id: string;
  kind: string;
  decision: string | null;
  sectionKey: string | null;
  message: string | null;
  authorLabel: string | null;
  createdAt: string | null;
}

/** One ask in the host's queue. `linkState` is about the credential, never about the person:
 *  an answered ask can still read `live`, which `supabase/tests/api/stage7_family_approval.test.mjs`
 *  Q-03 measures, and the host screen has to show both strings side by side rather than one of
 *  them standing in for the other. */
export interface ApprovalRequestRow {
  requestId: string;
  versionId: string;
  versionNumber: number;
  reviewerDisplayName: string;
  status: string;
  requestedAt: string | null;
  respondedAt: string | null;
  invalidatedAt: string | null;
  linkState: string;
  linkExpiresAt: string | null;
  linkLastUsedAt: string | null;
  history: ApprovalHistoryEntry[];
}

/** A field the projection may legitimately leave empty, or a refusal when it wrote something
 *  that is neither text nor an absence of text. `undefined` therefore means "not parseable",
 *  which is kept apart from `null` all the way to the caller. */
const nullableText = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : undefined;
};

const requiredText = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const refused = (fields: (string | null | undefined)[]): boolean =>
  fields.some((field) => field === undefined);

const parseTextList = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    out.push(entry);
  }
  return out;
};

const parseHistoryEntry = (value: unknown): ApprovalHistoryEntry | null => {
  const raw = asObject(value);
  if (!raw) return null;
  const id = requiredText(raw.id);
  const kind = requiredText(raw.kind);
  const decision = nullableText(raw.decision);
  const sectionKey = nullableText(raw.section_key);
  const message = nullableText(raw.message);
  const authorLabel = nullableText(raw.author_label);
  const createdAt = nullableText(raw.created_at);
  if (id === null || kind === null || refused([decision, sectionKey, message, authorLabel, createdAt])) {
    return null;
  }
  return { id, kind, decision, sectionKey, message, authorLabel, createdAt };
};

const parseQueueRow = (value: unknown): ApprovalRequestRow | null => {
  const raw = asObject(value);
  if (!raw) return null;
  const requestId = requiredText(raw.request_id);
  const versionId = requiredText(raw.version_id);
  const reviewerDisplayName = requiredText(raw.reviewer_display_name);
  const status = requiredText(raw.status);
  const linkState = requiredText(raw.link_state);
  const versionNumber = isNumberValue(raw.version_number) ? numberValue(raw.version_number) : null;
  const requestedAt = nullableText(raw.requested_at);
  const respondedAt = nullableText(raw.responded_at);
  const invalidatedAt = nullableText(raw.invalidated_at);
  const linkExpiresAt = nullableText(raw.link_expires_at);
  const linkLastUsedAt = nullableText(raw.link_last_used_at);
  if (
    requestId === null || versionId === null || reviewerDisplayName === null || status === null
    || linkState === null || versionNumber === null
    || refused([requestedAt, respondedAt, invalidatedAt, linkExpiresAt, linkLastUsedAt])
  ) {
    return null;
  }
  if (!Array.isArray(raw.history)) return null;
  const history: ApprovalHistoryEntry[] = [];
  for (const entry of raw.history) {
    const parsed = parseHistoryEntry(entry);
    if (parsed === null) return null;
    history.push(parsed);
  }
  return {
    requestId,
    versionId,
    versionNumber,
    reviewerDisplayName,
    status,
    requestedAt,
    respondedAt,
    invalidatedAt,
    linkState,
    linkExpiresAt,
    linkLastUsedAt,
    history,
  };
};

/**
 * The host's queue: a bare JSON array, empty when this wedding has asked nobody. A payload
 * that is not an array is refused to `null`, which the caller renders as "this read did not
 * answer" — not as an empty queue, because an empty queue is a claim that nobody has been
 * asked, and that claim belongs to the database, not to a parse failure.
 */
export function parseApprovalQueue(payload: unknown): ApprovalRequestRow[] | null {
  if (!Array.isArray(payload)) return null;
  const rows: ApprovalRequestRow[] = [];
  for (const entry of payload) {
    const row = parseQueueRow(entry);
    if (row === null) return null;
    rows.push(row);
  }
  return rows;
}

/** The reviewer's door. `{ available: false }`, an envelope this file has not been taught and
 *  a document it cannot vouch for all answer `null`, which is the same indifference the
 *  database shows a malformed, revoked, expired or cross-wedding credential. */
export function parseFamilyReviewDocument(payload: unknown): FamilyReviewDocument | null {
  const envelope = asObject(payload);
  if (!envelope || envelope.available !== true) return null;

  const raw = asObject(envelope.review);
  if (!raw) return null;
  const requestId = requiredText(raw.request_id);
  const reviewerDisplayName = requiredText(raw.reviewer_display_name);
  const versionNumber = isNumberValue(raw.version_number) ? numberValue(raw.version_number) : null;
  const requestedAt = nullableText(raw.requested_at);
  const expiresAt = nullableText(raw.expires_at);
  const sectionKeys = parseTextList(raw.section_keys);
  if (
    requestId === null || reviewerDisplayName === null || versionNumber === null
    || sectionKeys === null || refused([requestedAt, expiresAt])
  ) {
    return null;
  }
  const invitation = parseInvitationObject(raw.invitation);
  if (invitation === null) return null;

  return { requestId, reviewerDisplayName, versionNumber, requestedAt, expiresAt, sectionKeys, invitation };
}

export function parseFamilyReviewAsk(payload: unknown): FamilyReviewAsk | null {
  const raw = asObject(payload);
  if (!raw) return null;
  const requestId = requiredText(raw.request_id);
  const token = requiredText(raw.review_token);
  const expiresAt = nullableText(raw.expires_at);
  if (requestId === null || token === null || refused([expiresAt])) return null;
  if (!TOKEN_SHAPE.test(token)) return null;
  return { requestId, token, expiresAt };
}

export function parseReviewWithdrawal(payload: unknown): ReviewWithdrawal | null {
  const raw = asObject(payload);
  if (!raw) return null;
  const requestId = requiredText(raw.request_id);
  const status = requiredText(raw.status);
  const wasPending = isBooleanValue(raw.was_pending) ? booleanValue(raw.was_pending) : null;
  const credentialRevoked = isBooleanValue(raw.credential_revoked)
    ? booleanValue(raw.credential_revoked)
    : null;
  if (requestId === null || status === null || wasPending === null || credentialRevoked === null) {
    return null;
  }
  return { requestId, status, wasPending, credentialRevoked };
}

/**
 * The answer's receipt. Note what is *not* accepted here: `{ recorded: false,
 * reason: 'unavailable' }` is a real answer from the database — the credential stopped being
 * live between the page load and the submit — and it is not a receipt, so it parses to `null`
 * and the caller is left with the one sentence it is allowed to show a reviewer whose note
 * did not land.
 */
export function parseReviewAnswer(payload: unknown): ReviewAnswerReceipt | null {
  const raw = asObject(payload);
  if (!raw || raw.recorded !== true) return null;
  const feedbackId = requiredText(raw.feedback_id);
  const status = requiredText(raw.status);
  const respondedAt = nullableText(raw.responded_at);
  if (feedbackId === null || status === null || refused([respondedAt])) return null;
  return { feedbackId, status, respondedAt };
}
