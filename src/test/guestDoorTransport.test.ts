// The family's transport: one header, no session, no arguments on the door, and one answer to every
// question a guest might be asking.
//
// The database half of this is qualified in `supabase/tests/api/stage8_guest_rsvp.test.mjs`. What this
// file pins is the browser half of the same five rules:
//
//   * the credential never enters a URL, a query string or an RPC argument on the read — it would
//     otherwise land in server access logs, browser history and any `Referer` a third-party asset leaks,
//     which is why `api.resolve_guest_invitation()` is written to take no parameters at all
//     (`…sql:562`, wrapper `:1156-1162`);
//   * the household is never named as an argument either. The body a guest sends carries events and
//     answers and no `household_id`, because the household comes from the credential server-side
//     (`…sql:847-857`) — one family asking to be recorded as another is not a request this door can
//     receive, let alone honour;
//   * the answers travel in the body with exactly the three keys the door admits per card
//     (`…sql:786-791`), and never an `answers` key: this invitation asks no optional question, and a
//     guest must not be able to write prose into a host's `rsvp_responses.answers` column
//     (`20260925120300_stage2_guests_approvals_rsvp.sql:87`);
//   * a visit stores nothing — no session, no refresh token, no credential left behind on the shared
//     household phone that this whole stage exists for;
//   * a malformed link, a revoked one, an expired one, a withdrawn publication and a document that
//     arrived in an unexpected shape all reach the relative as the same sentence
//     (`…sql:1229`), while the refusals that name something the guest can fix — three raised sentences
//     and three in-band reasons — are said in their own words, because indifference about *why* a link
//     is dead is security and indifference about *what to type* is a broken form.
//
// The last block is the separation the Stage 8 brief asks for by name: a guest credential is presented
// to the guest door and to nothing else, and the family-approval header from Stage 7 is not reachable
// from this file's client at all.

import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ schema: () => ({ rpc }) })));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

import {
  GUEST_ANSWER_NOT_RECORDED,
  GUEST_DOOR_UNAVAILABLE,
  resolveGuestInvitation,
  submitGuestRsvp,
  type GuestRsvpCard,
} from "@/integrations/supabase/guestDoor";
import { guestInvitation } from "@/test/invitationFixture";

/** 41 characters plus the two a minted credential's alphabet allows: 43 in all, which is the shape the
 *  generator at `…sql:273` writes and both doors' header tests demand (`…sql:586`, `:841`). */
const TOKEN = `${'a'.repeat(41)}_-`;

const HOUSEHOLD_ID = '9d2a6f3e-5b18-4c7a-a0e4-000000000011';
const EVENT_ID = '1c9b4d70-3e62-4a58-bf19-000000000014';
const OTHER_EVENT_ID = '7b4d92e0-1c5a-4f77-8d31-000000000021';

/** The `guest` block plus the published document, in the envelope at `…sql:684-697`. The invitation is
 *  the shared fixture because the door answers with `private.public_invitation_dto` itself, not a second
 *  opinion of it (Ruling 5.1 of the design note). */
const doorPayload = (): unknown => ({
  available: true,
  guest: {
    household_id: HOUSEHOLD_ID,
    display_name: 'Raman Family',
    greeting: 'Dear Raman Family',
    expected_party_size: 4,
    version_number: 3,
    can_respond: true,
    responds_until: '2026-11-01T09:00:00+00:00',
    events: [{
      event_id: EVENT_ID,
      display_name: 'Wedding ceremony',
      starts_at_local: '2026-11-14T07:30:00',
      ends_at_local: '2026-11-14T09:00:00',
      timezone: 'Asia/Kolkata',
      attending: null,
      party_size: null,
      responded_at: null,
    }],
  },
  invitation: guestInvitation(),
});

const receipt = (eventsRecorded: number): unknown => ({
  recorded: true,
  household_id: HOUSEHOLD_ID,
  events_recorded: eventsRecorded,
  responded_at: '2026-10-20T12:04:00+00:00',
});

/** The answer a family that is coming leaves on the form, in the shape this transport takes. */
const attendingCard: GuestRsvpCard = { eventId: EVENT_ID, attending: 'attending', partySize: 3 };

let warnSpy: MockInstance;

type ClientOptions = {
  global: { headers: Record<string, string> };
  auth: Record<string, unknown>;
};

const optionsOf = (call = 0) => createClient.mock.calls[call][2] as ClientOptions;
const guestHeader = { 'x-guest-token': TOKEN };

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
    'has.dots.and/slashes/',
    '../../../../etc/passwd',
  ];

  it("is refused on both doors without leaving the page", async () => {
    for (const token of hopeless) {
      expect(await resolveGuestInvitation(token)).toEqual({ data: null, error: GUEST_DOOR_UNAVAILABLE });
      expect(await submitGuestRsvp(token, [attendingCard])).toEqual({ data: null, error: GUEST_DOOR_UNAVAILABLE });
    }
    // Two RPCs are the whole guest surface; a string that cannot match earns no request, and no client
    // is built to make one with.
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the door that reads the invitation", () => {
  beforeEach(() => {
    rpc.mockResolvedValue({ data: doorPayload(), error: null });
  });

  it("takes no arguments, so the credential has nowhere to go but a header", async () => {
    await resolveGuestInvitation(TOKEN);
    const call = rpc.mock.calls[0] as unknown[];
    expect(call[0]).toBe('resolve_guest_invitation');
    // The whole point of the no-parameter function: an argument here would be a query string on a GET,
    // which is an address, which is a log entry.
    expect(call).toHaveLength(1);
    expect(optionsOf().global.headers).toEqual(guestHeader);
  });

  it("keeps the credential out of the client's own arguments and out of every logged line", async () => {
    await resolveGuestInvitation(TOKEN);
    const [url, key] = createClient.mock.calls[0];
    expect(`${url}`).not.toContain(TOKEN);
    expect(`${key}`).not.toContain(TOKEN);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(TOKEN);
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain(TOKEN);
  });

  it("builds a client that stores nothing", async () => {
    await resolveGuestInvitation(TOKEN);
    expect(optionsOf().auth).toEqual({ persistSession: false, autoRefreshToken: false });
  });

  it("hands the page the household's own document, greeting and deadline included", async () => {
    const result = await resolveGuestInvitation(TOKEN);
    expect(result.error).toBeNull();
    expect(result.data?.householdId).toBe(HOUSEHOLD_ID);
    expect(result.data?.greeting).toBe('Dear Raman Family');
    expect(result.data?.expectedPartySize).toBe(4);
    expect(result.data?.canRespond).toBe(true);
    expect(result.data?.respondsUntil).toBe('2026-11-01T09:00:00+00:00');
    expect(result.data?.events[0]?.displayName).toBe('Wedding ceremony');
    expect(result.data?.invitation.title).toBe('Arun weds Deepa');
  });
});

describe("every way the read door can refuse", () => {
  it("answers with the same sentence and keeps none of the server's words", async () => {
    const failures: Array<{ data?: unknown; error?: unknown }> = [
      { error: { code: '42501', message: 'permission denied for schema private', hint: 'granted to nobody' } },
      { error: { code: 'PGRST202', message: 'Could not find the function api.resolve_guest_invitation' } },
      { data: { available: false } },
      { data: null },
      { data: { available: true, guest: { household_id: 42 } } },
      { data: '<html>a wedding</html>' },
    ];

    for (const response of failures) {
      rpc.mockResolvedValueOnce(response);
      expect(await resolveGuestInvitation(TOKEN)).toEqual({ data: null, error: GUEST_DOOR_UNAVAILABLE });
    }

    // One phrase for all six means a guest who mistyped a link learns nothing, and nobody probing
    // addresses can tell a revoked household from a wedding that never had one.
    const logged = warnSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('permission denied for schema private');
    expect(logged).not.toContain('granted to nobody');
    expect(logged).toContain('42501');
  });
});

describe("the door that records an answer", () => {
  beforeEach(() => {
    rpc.mockResolvedValue({ data: receipt(2), error: null });
  });

  it("sends the three keys the door admits, and no others", async () => {
    await submitGuestRsvp(TOKEN, [
      attendingCard,
      { eventId: OTHER_EVENT_ID, attending: 'declined', partySize: 0 },
    ]);
    expect(rpc.mock.calls[0][0]).toBe('submit_guest_rsvp');
    expect(rpc.mock.calls[0][1]).toEqual({
      p_answers: {
        events: [
          { event_id: EVENT_ID, attending: 'attending', party_size: 3 },
          { event_id: OTHER_EVENT_ID, attending: 'declined', party_size: 0 },
        ],
      },
    });
    expect(optionsOf().global.headers).toEqual(guestHeader);
  });

  it("never sends an optional answer, because this invitation is not asking for one", async () => {
    await submitGuestRsvp(TOKEN, [attendingCard]);
    // The whole key set, not a substring: `p_answers` is the door's own argument name, and the thing
    // under test is the shape of a card inside it. An `answers` key is the one the door refuses out of
    // band (`…sql:779-784`) because it is a column a host owns (`20260925120300…:87`); a transport that
    // grew one would be a guest writing prose into it.
    const body = rpc.mock.calls[0][1] as { p_answers: { events: Array<Record<string, unknown>> } };
    expect(Object.keys(body.p_answers.events[0]).sort()).toEqual(['attending', 'event_id', 'party_size']);
  });

  it("never sends the household, because the credential already is the household", async () => {
    await submitGuestRsvp(TOKEN, [attendingCard]);
    const body = JSON.stringify(rpc.mock.calls[0][1]);
    expect(body).not.toContain('household_id');
    expect(body).not.toContain(HOUSEHOLD_ID);
    // …and a guest cannot ask to be recorded as somebody else, because there is no such argument to
    // make. The body's only keys are the three the loop over `p_answers -> 'events'` admits.
  });

  it("carries a declined card's zero as a zero", async () => {
    await submitGuestRsvp(TOKEN, [{ eventId: EVENT_ID, attending: 'declined', partySize: 0 }]);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_answers: { events: [{ attending: 'declined', party_size: 0 }] },
    });
    // The door makes an attending card's headcount at least 1 (`…sql:826-829`) and this file invents
    // nothing on a guest's behalf to satisfy a rule it does not own.
  });

  it("refuses to submit nothing, rather than recording an empty answer", async () => {
    expect(await submitGuestRsvp(TOKEN, [])).toEqual({ data: null, error: GUEST_ANSWER_NOT_RECORDED });
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never sends the credential as an argument, on either side of the answer", async () => {
    await submitGuestRsvp(TOKEN, [attendingCard]);
    // The answers are an argument and the link is not: the credential reaches the header only, so a
    // request log line that captures the body captures a headcount and no way to replay it.
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(TOKEN);
    const [url, key] = createClient.mock.calls[0];
    expect(`${url}`).not.toContain(TOKEN);
    expect(`${key}`).not.toContain(TOKEN);
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain(TOKEN);
  });

  it("stores nothing on the way out either", async () => {
    await submitGuestRsvp(TOKEN, [attendingCard]);
    expect(optionsOf().auth).toEqual({ persistSession: false, autoRefreshToken: false });
  });

  it("hands the page the receipt of what was recorded", async () => {
    const result = await submitGuestRsvp(TOKEN, [attendingCard]);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      kind: 'recorded',
      receipt: { householdId: HOUSEHOLD_ID, eventsRecorded: 2, respondedAt: '2026-10-20T12:04:00+00:00' },
    });
  });
});

describe("a submission the database refuses", () => {
  it("says the three authored sentences exactly, because each names something the guest can fix", async () => {
    const authored = [
      'the answers submitted are not in the shape this invitation records',
      'too many answers in one submission',
      'the same event was answered twice',
    ];
    for (const message of authored) {
      rpc.mockResolvedValueOnce({ error: { code: 'PGRST500', message } });
      expect(await submitGuestRsvp(TOKEN, [attendingCard])).toEqual({ data: null, error: message });
    }
  });

  it("folds any other server sentence into one phrase and keeps its words out of the page", async () => {
    const surprises = [
      { code: '42501', message: 'permission denied for table rsvp_responses' },
      { code: '23514', message: 'new row violates check constraint for household_event_scopes' },
      { code: '23503', message: 'insert or update on table "rsvp_responses" violates foreign key constraint' },
      { code: 'unknown', message: '' },
    ];
    for (const error of surprises) {
      rpc.mockResolvedValueOnce({ error });
      expect(await submitGuestRsvp(TOKEN, [attendingCard])).toEqual({ data: null, error: GUEST_ANSWER_NOT_RECORDED });
    }

    const logged = warnSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('rsvp_responses');
    expect(logged).not.toContain('household_event_scopes');
    expect(logged).not.toContain('check constraint');
    expect(logged).toContain('42501');
  });

  it("answers each in-band reason in its own words", async () => {
    const inBand: Array<[string, string]> = [
      ['unavailable', GUEST_DOOR_UNAVAILABLE],
      ['party_size_too_large', 'That is more guests than this invitation is for. Ask the host if more can be added.'],
      ['answers_not_accepted', 'The couple is not asking that question on this invitation yet.'],
    ];
    for (const [reason, copy] of inBand) {
      rpc.mockResolvedValueOnce({ data: { recorded: false, reason }, error: null });
      expect(await submitGuestRsvp(TOKEN, [attendingCard])).toEqual({ data: null, error: copy });
    }
  });

  it("refuses an unfamiliar reason word rather than handing it to a guest as text", async () => {
    rpc.mockResolvedValueOnce({ data: { recorded: false, reason: 'wedding_on_fire' }, error: null });
    expect(await submitGuestRsvp(TOKEN, [attendingCard])).toEqual({ data: null, error: GUEST_ANSWER_NOT_RECORDED });
    // A word this build has not read cannot be explained to the person holding the form, and the one
    // place it could be explained is a log the guest does not see — which this path does not write.
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('wedding_on_fire');
  });

  it("treats a receipt-shaped success that is not one as the answer not having landed", async () => {
    const notAReceipt = [
      { recorded: true },
      { recorded: true, household_id: HOUSEHOLD_ID, events_recorded: 'two', responded_at: null },
      { recorded: null },
    ];
    for (const data of notAReceipt) {
      rpc.mockResolvedValueOnce({ data, error: null });
      expect(await submitGuestRsvp(TOKEN, [attendingCard])).toEqual({ data: null, error: GUEST_ANSWER_NOT_RECORDED });
    }
  });

  it("treats a link that stopped working mid-form as the door being unavailable, which is what it means", async () => {
    rpc.mockResolvedValue({ data: { recorded: false, reason: 'unavailable' }, error: null });
    expect(await submitGuestRsvp(TOKEN, [attendingCard])).toEqual({ data: null, error: GUEST_DOOR_UNAVAILABLE });

    rpc.mockResolvedValue({ data: null, error: null });
    expect(await submitGuestRsvp(TOKEN, [attendingCard])).toEqual({ data: null, error: GUEST_ANSWER_NOT_RECORDED });
  });
});

describe("the guest credential and the reviewer credential", () => {
  it("are never both presented, and the guest door carries only its own header", async () => {
    rpc.mockResolvedValue({ data: doorPayload(), error: null });
    await resolveGuestInvitation(TOKEN);
    rpc.mockResolvedValue({ data: receipt(1), error: null });
    await submitGuestRsvp(TOKEN, [attendingCard]);

    // Stage 7's reviewer door is `/r/<token>` with `x-review-token`
    // (`src/integrations/supabase/publicReview.ts`). The Stage 8 brief separates the two credentials by
    // name, and the check that holds here is the one a page cannot quietly widen: this file's client
    // sets exactly one header, and it is not that one.
    for (const call of [optionsOf(0), optionsOf(1)]) {
      expect(call.global.headers).toEqual(guestHeader);
      expect(call.global.headers).not.toHaveProperty('x-review-token');
    }
  });
});

describe("one visit, two doors", () => {
  it("builds its client per call, so an answer sent after a read still carries the credential it came in on", async () => {
    rpc.mockResolvedValue({ data: doorPayload(), error: null });
    await resolveGuestInvitation(TOKEN);
    rpc.mockResolvedValue({ data: receipt(1), error: null });
    await submitGuestRsvp(TOKEN, [attendingCard]);

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(optionsOf(0).global.headers).toEqual(optionsOf(1).global.headers);
  });
});
