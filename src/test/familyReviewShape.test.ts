// The two halves of Stage 7 read as shapes: what a host's queue is, and what a reviewer's door is.
//
// The database half of this is qualified in `supabase/tests/sql/` and `supabase/tests/api/`.
// What this file pins is the line the app draws between a word it has been taught and a word it
// has not: a status this build has no label for still has to reach the screen, because the row is
// the row the database wrote, while a field of the wrong *kind* refuses the whole payload. A parse
// that guessed `pending` for tomorrow's `escalated` would render an unknown fact as a known one,
// and a host reading "Waiting for their answer" over a request the family has already escalated is
// the failure this file exists to prevent.
//
// The fixtures are written in the exact snake_case the migration's `jsonb_build_object` calls
// produce (`20261008120000_stage7_family_approval_review.sql:145`, `:207`, `:271-283`, `:447-458`,
// `:629-634`), including its habit of writing every key and using null for the empty ones. The
// guest document inside a review payload is the shared fixture, because the review door answers
// with `private.public_invitation_dto` itself rather than a second opinion of it.

import { describe, expect, it } from "vitest";

import {
  familyReviewLinkPath,
  parseApprovalQueue,
  parseFamilyReviewAsk,
  parseFamilyReviewDocument,
  parseReviewAnswer,
  parseReviewWithdrawal,
} from "@/lib/familyReview";
import { guestInvitation } from "@/test/invitationFixture";

/** 41 characters plus the two a minted credential's alphabet allows: 43 in all, which is what the
 *  ask at `:127` writes and no more. */
const TOKEN = `${'a'.repeat(41)}_-`;

const REQUEST_ID = '2f6c1a44-7c31-4b1e-9a10-000000000001';
const FEEDBACK_ID = '7b4d92e0-1c5a-4f77-8d31-000000000002';
const VERSION_ID = 'c3e5a0b8-92d0-4a6f-bc42-000000000003';

const historyEntry = (overrides: Record<string, unknown> = {}) => ({
  id: FEEDBACK_ID,
  kind: 'decision',
  decision: 'changes_requested',
  section_key: 'blessing',
  message: 'Move the muhurtham note to the morning.',
  author_label: 'Maami',
  created_at: '2026-10-08T09:12:00+00:00',
  ...overrides,
});

const queueRow = (overrides: Record<string, unknown> = {}) => ({
  request_id: REQUEST_ID,
  version_id: VERSION_ID,
  version_number: 3,
  reviewer_display_name: 'Maami',
  status: 'changes_requested',
  requested_at: '2026-10-07T10:00:00+00:00',
  responded_at: '2026-10-08T09:12:00+00:00',
  invalidated_at: null,
  link_state: 'live',
  link_expires_at: '2026-10-21T10:00:00+00:00',
  link_last_used_at: '2026-10-08T09:00:00+00:00',
  history: [historyEntry()],
  ...overrides,
});

const reviewPayload = (reviewOverrides: Record<string, unknown> = {}) => ({
  available: true,
  review: {
    request_id: REQUEST_ID,
    reviewer_display_name: 'Maami',
    version_number: 3,
    requested_at: '2026-10-07T10:00:00+00:00',
    expires_at: '2026-10-21T10:00:00+00:00',
    invitation: guestInvitation(),
    section_keys: ['welcome', 'family', 'ceremonies', 'blessing'],
    ...reviewOverrides,
  },
});

describe("the address built from a credential the host was handed once", () => {
  it("is the short path the directive asks for", () => {
    expect(familyReviewLinkPath(TOKEN)).toEqual({ path: `/r/${TOKEN}`, token: TOKEN });
  });

  it("refuses a string that cannot open the door rather than building a link that goes nowhere", () => {
    for (const hopeless of ['', 'short', TOKEN.slice(0, 42), `${TOKEN}extra`, 'has spaces !@#']) {
      expect(familyReviewLinkPath(hopeless)).toBeNull();
    }
  });
});

describe("the host's queue", () => {
  it("reads a whole row into the fields the panel prints", () => {
    const rows = parseApprovalQueue([queueRow()]);
    expect(rows).not.toBeNull();
    expect(rows?.[0]).toEqual({
      requestId: REQUEST_ID,
      versionId: VERSION_ID,
      versionNumber: 3,
      reviewerDisplayName: 'Maami',
      status: 'changes_requested',
      requestedAt: '2026-10-07T10:00:00+00:00',
      respondedAt: '2026-10-08T09:12:00+00:00',
      invalidatedAt: null,
      linkState: 'live',
      linkExpiresAt: '2026-10-21T10:00:00+00:00',
      linkLastUsedAt: '2026-10-08T09:00:00+00:00',
      history: [{
        id: FEEDBACK_ID,
        kind: 'decision',
        decision: 'changes_requested',
        sectionKey: 'blessing',
        message: 'Move the muhurtham note to the morning.',
        authorLabel: 'Maami',
        createdAt: '2026-10-08T09:12:00+00:00',
      }],
    });
  });

  it("keeps a word this build has no label for instead of defaulting it", () => {
    const rows = parseApprovalQueue([queueRow({ status: 'escalated', link_state: 'frozen' })]);
    expect(rows?.[0]?.status).toBe('escalated');
    expect(rows?.[0]?.linkState).toBe('frozen');
  });

  it("keeps the two vocabularies apart: an answered ask whose link is still live", () => {
    const rows = parseApprovalQueue([queueRow()]);
    expect(rows?.[0]?.status).toBe('changes_requested');
    expect(rows?.[0]?.linkState).toBe('live');
  });

  it("reads a link that was never issued, which is a state and not an absence of the row", () => {
    const rows = parseApprovalQueue([queueRow({
      status: 'pending',
      responded_at: null,
      link_state: 'never_issued',
      link_expires_at: null,
      link_last_used_at: null,
      history: [],
    })]);
    expect(rows?.[0]).toMatchObject({
      status: 'pending',
      respondedAt: null,
      linkState: 'never_issued',
      linkExpiresAt: null,
      history: [],
    });
  });

  it("answers an empty list for a wedding that has asked nobody, and nothing at all for a payload that is not a list", () => {
    expect(parseApprovalQueue([])).toEqual([]);
    // A parse failure must not become "nobody has been asked": that is a claim about the family,
    // and only the database is allowed to make it.
    for (const notAList of [null, undefined, {}, '[]', 42, { requests: [] }]) {
      expect(parseApprovalQueue(notAList)).toBeNull();
    }
  });

  it("refuses a whole read rather than showing a queue with one row's history quietly missing", () => {
    expect(parseApprovalQueue([queueRow({ history: null })])).toBeNull();
    expect(parseApprovalQueue([queueRow({ history: '[]' })])).toBeNull();
    expect(parseApprovalQueue([queueRow({ history: [historyEntry({ message: 7 })] })])).toBeNull();
    expect(parseApprovalQueue([queueRow(), queueRow({ history: [42] })])).toBeNull();
  });

  it("refuses a field that arrived as the wrong kind of thing", () => {
    expect(parseApprovalQueue([queueRow({ version_number: '3' })])).toBeNull();
    expect(parseApprovalQueue([queueRow({ version_number: null })])).toBeNull();
    expect(parseApprovalQueue([queueRow({ status: 12 })])).toBeNull();
    expect(parseApprovalQueue([queueRow({ requested_at: 0 })])).toBeNull();
    expect(parseApprovalQueue([queueRow({ request_id: null, id: REQUEST_ID })])).toBeNull();
  });

  it("keeps a history entry with nothing in its optional columns, because an absent note is a fact", () => {
    const rows = parseApprovalQueue([queueRow({
      history: [historyEntry({ decision: null, section_key: null, message: null, author_label: null })],
    })]);
    expect(rows?.[0]?.history[0]).toMatchObject({
      kind: 'decision',
      decision: null,
      sectionKey: null,
      message: null,
      authorLabel: null,
    });
  });

  it("refuses an entry that is not a record at all", () => {
    expect(parseApprovalQueue([queueRow({ history: [42] })])).toBeNull();
    expect(parseApprovalQueue([queueRow({ history: ['nope'] })])).toBeNull();
    expect(parseApprovalQueue([queueRow({ history: [historyEntry({ id: null, kind: null })] })])).toBeNull();
  });

  it("keeps a section key it does not recognise as the text it is", () => {
    const rows = parseApprovalQueue([queueRow({ history: [historyEntry({ section_key: 'garbha_sanskar' })] })]);
    expect(rows?.[0]?.history[0]?.sectionKey).toBe('garbha_sanskar');
  });
});

describe("the reviewer's door", () => {
  it("reads the frozen document plus the four facts that make it a review", () => {
    const document = parseFamilyReviewDocument(reviewPayload());
    expect(document).not.toBeNull();
    expect(document?.requestId).toBe(REQUEST_ID);
    expect(document?.reviewerDisplayName).toBe('Maami');
    expect(document?.versionNumber).toBe(3);
    expect(document?.expiresAt).toBe('2026-10-21T10:00:00+00:00');
    expect(document?.sectionKeys).toEqual(['welcome', 'family', 'ceremonies', 'blessing']);
    // The invitation is the guest's own document, parsed by the guest's own parser.
    expect(document?.invitation.title).toBe('Arun weds Deepa');
  });

  it("answers nothing at all to the one envelope the database uses for every refusal", () => {
    expect(parseFamilyReviewDocument({ available: false })).toBeNull();
    expect(parseFamilyReviewDocument({ available: false, review: reviewPayload().review })).toBeNull();
    expect(parseFamilyReviewDocument(null)).toBeNull();
    expect(parseFamilyReviewDocument('<html>a review</html>')).toBeNull();
    expect(parseFamilyReviewDocument({ available: 'true', review: reviewPayload().review })).toBeNull();
  });

  it("refuses a document whose invitation it cannot vouch for, rather than drawing half a page", () => {
    expect(parseFamilyReviewDocument(reviewPayload({ invitation: { title: 42 } }))).toBeNull();
    expect(parseFamilyReviewDocument(reviewPayload({ invitation: null }))).toBeNull();
  });

  it("allows a link with no deadline, because `expires_at` is nullable in the token table", () => {
    const document = parseFamilyReviewDocument(reviewPayload({ expires_at: null, requested_at: null }));
    expect(document?.expiresAt).toBeNull();
    expect(document?.requestedAt).toBeNull();
  });

  it("keeps a section key from a newer release as text instead of dropping the document", () => {
    const document = parseFamilyReviewDocument(reviewPayload({ section_keys: ['welcome', 'annadanam'] }));
    expect(document?.sectionKeys).toEqual(['welcome', 'annadanam']);
  });

  it("refuses a section list that is not a list of text", () => {
    expect(parseFamilyReviewDocument(reviewPayload({ section_keys: null }))).toBeNull();
    expect(parseFamilyReviewDocument(reviewPayload({ section_keys: 'welcome' }))).toBeNull();
    expect(parseFamilyReviewDocument(reviewPayload({ section_keys: ['welcome', 7] }))).toBeNull();
    expect(parseFamilyReviewDocument(reviewPayload({ section_keys: [] }))).toMatchObject({ sectionKeys: [] });
  });

  it("refuses a missing or wrongly-kinded review fact", () => {
    expect(parseFamilyReviewDocument(reviewPayload({ version_number: '3' }))).toBeNull();
    expect(parseFamilyReviewDocument(reviewPayload({ reviewer_display_name: null }))).toBeNull();
    expect(parseFamilyReviewDocument(reviewPayload({ requested_at: 0 }))).toBeNull();
    expect(parseFamilyReviewDocument({ available: true })).toBeNull();
  });
});

describe("the ask", () => {
  it("is the one place a raw credential is read, and it keeps it only as text", () => {
    const ask = parseFamilyReviewAsk({ request_id: REQUEST_ID, review_token: TOKEN, expires_at: '2026-10-21T10:00:00+00:00' });
    expect(ask).toEqual({ requestId: REQUEST_ID, token: TOKEN, expiresAt: '2026-10-21T10:00:00+00:00' });
  });

  it("refuses a credential of the wrong shape instead of handing the panel an address to build", () => {
    expect(parseFamilyReviewAsk({ request_id: REQUEST_ID, review_token: 'too-short', expires_at: null })).toBeNull();
    expect(parseFamilyReviewAsk({ request_id: REQUEST_ID, review_token: `${TOKEN}extra`, expires_at: null })).toBeNull();
    expect(parseFamilyReviewAsk({ request_id: REQUEST_ID, review_token: null, expires_at: null })).toBeNull();
    expect(parseFamilyReviewAsk({ request_id: REQUEST_ID, expires_at: null })).toBeNull();
    expect(parseFamilyReviewAsk(null)).toBeNull();
  });

  it("keeps an expiry the database left empty as an empty, not as a date it invented", () => {
    expect(parseFamilyReviewAsk({ request_id: REQUEST_ID, review_token: TOKEN, expires_at: null })?.expiresAt).toBeNull();
    expect(parseFamilyReviewAsk({ request_id: REQUEST_ID, review_token: TOKEN })).toMatchObject({ expiresAt: null });
  });

  it("refuses an expiry that arrived as something other than text", () => {
    expect(parseFamilyReviewAsk({ request_id: REQUEST_ID, review_token: TOKEN, expires_at: 17 })).toBeNull();
  });
});

describe("a withdrawal", () => {
  it("reads the two independent facts the host's sentence is built from", () => {
    expect(parseReviewWithdrawal({ request_id: REQUEST_ID, status: 'invalidated', was_pending: true, credential_revoked: true }))
      .toEqual({ requestId: REQUEST_ID, status: 'invalidated', wasPending: true, credentialRevoked: true });
    expect(parseReviewWithdrawal({ request_id: REQUEST_ID, status: 'approved', was_pending: false, credential_revoked: true }))
      .toMatchObject({ status: 'approved', wasPending: false, credentialRevoked: true });
    expect(parseReviewWithdrawal({ request_id: REQUEST_ID, status: 'expired', was_pending: false, credential_revoked: false }))
      .toMatchObject({ credentialRevoked: false });
  });

  it("refuses a receipt whose booleans are missing rather than guessing whether a link went with it", () => {
    expect(parseReviewWithdrawal({ request_id: REQUEST_ID, status: 'invalidated' })).toBeNull();
    expect(parseReviewWithdrawal({ request_id: REQUEST_ID, status: 'invalidated', was_pending: 'true', credential_revoked: true })).toBeNull();
    expect(parseReviewWithdrawal({ request_id: REQUEST_ID })).toBeNull();
    expect(parseReviewWithdrawal(null)).toBeNull();
  });
});

describe("the answer's receipt", () => {
  it("reads what was recorded", () => {
    expect(parseReviewAnswer({ recorded: true, status: 'approved', feedback_id: FEEDBACK_ID, responded_at: '2026-10-08T09:12:00+00:00' }))
      .toEqual({ feedbackId: FEEDBACK_ID, status: 'approved', respondedAt: '2026-10-08T09:12:00+00:00' });
  });

  it("is not a receipt, so the caller keeps the one sentence it is allowed to show a reviewer whose note did not land", () => {
    expect(parseReviewAnswer({ recorded: false, reason: 'unavailable' })).toBeNull();
    expect(parseReviewAnswer({ recorded: true, status: 'approved', feedback_id: FEEDBACK_ID })).toMatchObject({ respondedAt: null });
    expect(parseReviewAnswer({ recorded: true, status: 'approved' })).toBeNull();
    expect(parseReviewAnswer({ recorded: 'true', status: 'approved', feedback_id: FEEDBACK_ID, responded_at: null })).toBeNull();
  });
});
