// The reviewer's transport: one header, no session, no arguments on the door, and one answer to
// every question a relative might be asking.
//
// The database half of this is qualified in `supabase/tests/api/stage7_family_approval.test.mjs`.
// What this file pins is the browser half of the same four rules:
//
//   * the credential never enters a URL, a query string or an RPC argument on the read — it would
//     otherwise land in server access logs, browser history and any `Referer` a third-party asset
//     leaks, which is exactly the reason `api.resolve_family_review` is written to take no
//     parameters at all;
//   * the submission's arguments travel in the body, and the credential still travels only in the
//     header, so the note a reviewer writes and the link they wrote it from never share an
//     address;
//   * a visit stores nothing — no session, no refresh token, and no credential left behind on a
//     shared family phone;
//   * a malformed link, a refused link and a link whose answer arrived in an unexpected shape all
//     reach the relative as the same sentence, while the six sentences the migration authors for
//     a refusal pass through unchanged because each one names something the reviewer can fix.

import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ schema: () => ({ rpc }) })));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

import {
  REVIEW_NOT_RECORDED,
  REVIEW_UNAVAILABLE,
  resolveFamilyReview,
  submitFamilyReview,
  type ReviewAnswer,
} from "@/integrations/supabase/publicReview";
import { guestInvitation } from "@/test/invitationFixture";

/** 41 characters plus the two a minted credential's alphabet allows: 43 in all, which is the
 *  shape the ask at `20261008120000_stage7_family_approval_review.sql:127` writes. */
const TOKEN = `${'a'.repeat(41)}_-`;

const REVIEW_ID = '2f6c1a44-7c31-4b1e-9a10-000000000001';
const FEEDBACK_ID = '7b4d92e0-1c5a-4f77-8d31-000000000002';

const documentPayload = (): unknown => ({
  available: true,
  review: {
    request_id: REVIEW_ID,
    reviewer_display_name: 'Maami',
    version_number: 3,
    requested_at: '2026-10-07T10:00:00+00:00',
    expires_at: '2026-10-21T10:00:00+00:00',
    invitation: guestInvitation(),
    section_keys: ['welcome', 'blessing'],
  },
});

const approval: ReviewAnswer = {
  decision: 'approved',
  reviewerLabel: 'Maami',
  message: null,
  sectionKey: null,
};

let warnSpy: MockInstance;

type ClientOptions = {
  global: { headers: Record<string, string> };
  auth: Record<string, unknown>;
};

const optionsOf = (call = 0) => createClient.mock.calls[call][2] as ClientOptions;

beforeEach(() => {
  rpc.mockReset();
  createClient.mockClear();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe("a credential that cannot possibly match", () => {
  const hopeless = [
    '',
    'short',
    TOKEN.slice(0, 42),
    `${TOKEN}extra`,
    'has spaces and symbols !@#',
    '../../../../etc/passwd',
  ];

  it("is refused on both doors without leaving the page", async () => {
    for (const token of hopeless) {
      expect(await resolveFamilyReview(token)).toEqual({ data: null, error: REVIEW_UNAVAILABLE });
      expect(await submitFamilyReview(token, approval)).toEqual({ data: null, error: REVIEW_UNAVAILABLE });
    }
    // Two RPCs are the whole reviewer surface; a string that cannot match earns no request, and
    // no client is built to make one with.
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the door that reads the invitation", () => {
  beforeEach(() => {
    rpc.mockResolvedValue({ data: documentPayload(), error: null });
  });

  it("takes no arguments, so the credential has nowhere to go but a header", async () => {
    await resolveFamilyReview(TOKEN);
    const call = rpc.mock.calls[0] as unknown[];
    expect(call[0]).toBe('resolve_family_review');
    // The whole point of the no-parameter function: an argument here would be a query string on a
    // GET, which is an address, which is a log entry.
    expect(call).toHaveLength(1);
    expect(optionsOf().global.headers).toEqual({ 'x-review-token': TOKEN });
  });

  it("keeps the credential out of the client's own arguments and out of every logged line", async () => {
    await resolveFamilyReview(TOKEN);
    const [url, key] = createClient.mock.calls[0];
    expect(`${url}`).not.toContain(TOKEN);
    expect(`${key}`).not.toContain(TOKEN);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(TOKEN);
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain(TOKEN);
  });

  it("builds a client that stores nothing", async () => {
    await resolveFamilyReview(TOKEN);
    expect(optionsOf().auth).toEqual({ persistSession: false, autoRefreshToken: false });
  });

  it("hands the page the parsed document, including the sections a note may name", async () => {
    const result = await resolveFamilyReview(TOKEN);
    expect(result.error).toBeNull();
    expect(result.data?.reviewerDisplayName).toBe('Maami');
    expect(result.data?.versionNumber).toBe(3);
    expect(result.data?.sectionKeys).toEqual(['welcome', 'blessing']);
    expect(result.data?.invitation.title).toBe('Arun weds Deepa');
  });
});

describe("every way the door can refuse", () => {
  it("answers with the same sentence and keeps none of the server's words", async () => {
    const failures: Array<{ data?: unknown; error?: unknown }> = [
      { error: { code: '42501', message: 'permission denied for schema private', hint: 'granted to nobody' } },
      { error: { code: 'PGRST202', message: 'Could not find the function api.resolve_family_review' } },
      { data: { available: false } },
      { data: null },
      { data: { available: true, review: { invitation: { title: 42 } } } },
      { data: '<html>a review</html>' },
    ];

    for (const response of failures) {
      rpc.mockResolvedValueOnce(response);
      expect(await resolveFamilyReview(TOKEN)).toEqual({ data: null, error: REVIEW_UNAVAILABLE });
    }

    const logged = warnSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('permission denied for schema private');
    expect(logged).not.toContain('granted to nobody');
    expect(logged).toContain('42501');
  });
});

describe("the door that records an answer", () => {
  beforeEach(() => {
    rpc.mockResolvedValue({
      data: { recorded: true, status: 'approved', feedback_id: FEEDBACK_ID, responded_at: '2026-10-08T09:12:00+00:00' },
      error: null,
    });
  });

  it("sends the note as arguments and the link as a header, and never the other way round", async () => {
    await submitFamilyReview(TOKEN, { ...approval, message: 'The blessing line is perfect.', sectionKey: 'blessing' });
    expect(rpc.mock.calls[0][0]).toBe('submit_family_review');
    expect(rpc.mock.calls[0][1]).toEqual({
      p_decision: 'approved',
      p_reviewer_label: 'Maami',
      p_message: 'The blessing line is perfect.',
      p_section_key: 'blessing',
    });
    expect(optionsOf().global.headers).toEqual({ 'x-review-token': TOKEN });
  });

  it("passes the nulls the schema records for an approval with no note", async () => {
    await submitFamilyReview(TOKEN, approval);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_message: null, p_section_key: null });
  });

  it("never sends the credential as an argument, on either side of the note", async () => {
    await submitFamilyReview(TOKEN, { ...approval, message: 'Send it to Thambi too.' });
    // The note is an argument and the link is not: the credential reaches the header only, so a
    // request log line that captures the body captures a decision and no way to replay it.
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(TOKEN);
    const [url, key] = createClient.mock.calls[0];
    expect(`${url}`).not.toContain(TOKEN);
    expect(`${key}`).not.toContain(TOKEN);
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain(TOKEN);
  });

  it("stores nothing on the way out either", async () => {
    await submitFamilyReview(TOKEN, approval);
    expect(optionsOf().auth).toEqual({ persistSession: false, autoRefreshToken: false });
  });

  it("hands the page the receipt of what was recorded", async () => {
    const result = await submitFamilyReview(TOKEN, approval);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ feedbackId: FEEDBACK_ID, status: 'approved', respondedAt: '2026-10-08T09:12:00+00:00' });
  });
});

describe("a submission the database refuses", () => {
  it("says the six authored sentences exactly, because each names something the reviewer can fix", async () => {
    const authored = [
      'the review decision is not one this product records',
      'say who is answering, in their own words',
      'a request for changes needs a note saying what to change',
      'that note is too long to record',
      'that note does not name a section of this invitation',
      'that section reference is too long',
    ];
    for (const message of authored) {
      rpc.mockResolvedValueOnce({ error: { code: 'PGRST500', message } });
      expect(await submitFamilyReview(TOKEN, approval)).toEqual({ data: null, error: message });
    }
  });

  it("folds any other server sentence into one phrase and keeps its words out of the page", async () => {
    const surprises = [
      { code: '42501', message: 'permission denied for table approval_feedback' },
      { code: '23514', message: 'new row violates check constraint for approval_requests' },
      { code: 'unique_violation', message: 'duplicate key value violates unique constraint "one_answer_per_request"' },
      { code: 'unknown', message: '' },
    ];
    for (const error of surprises) {
      rpc.mockResolvedValueOnce({ error });
      expect(await submitFamilyReview(TOKEN, approval)).toEqual({ data: null, error: REVIEW_NOT_RECORDED });
    }

    const logged = warnSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('approval_feedback');
    expect(logged).not.toContain('check constraint');
    expect(logged).toContain('42501');
  });

  it("treats a refusal-shaped success as the link having stopped working, which is what it means", async () => {
    rpc.mockResolvedValue({ data: { recorded: false, reason: 'unavailable' }, error: null });
    expect(await submitFamilyReview(TOKEN, approval)).toEqual({ data: null, error: REVIEW_UNAVAILABLE });

    rpc.mockResolvedValue({ data: null, error: null });
    expect(await submitFamilyReview(TOKEN, approval)).toEqual({ data: null, error: REVIEW_UNAVAILABLE });
  });
});

describe("one visit, two doors", () => {
  it("builds its client per call, so a note sent after a read still carries the credential it came in on", async () => {
    rpc.mockResolvedValue({ data: documentPayload(), error: null });
    await resolveFamilyReview(TOKEN);
    rpc.mockResolvedValue({
      data: { recorded: true, status: 'approved', feedback_id: FEEDBACK_ID, responded_at: '2026-10-08T09:12:00+00:00' },
      error: null,
    });
    await submitFamilyReview(TOKEN, approval);

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(optionsOf(0).global.headers).toEqual(optionsOf(1).global.headers);
  });
});
