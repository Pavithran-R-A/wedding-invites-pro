// The host adapter's half of the Stage 8 contract: which function is named with which arguments,
// which columns a table read is allowed to ask for, and what the module does when the answer is an
// error, no rows, or a shape it was not written to read.
//
// Three claims hold this file together.
//
// The first is the one §8 of `docs/architecture/guest-rsvp-security.md` draws the module's line with:
// a credential is minted, read and killed only behind an `api` function, and the browser's argument
// list must therefore never contain one. `rotate_guest_invitation` is addressed by the household's id
// (`20261009120000_stage8_guest_invitations_rsvp.sql:449-464`), never by the secret, so an adapter that
// sent `p_token` would put a bearer credential in a POST body the log can quote. The assertions read
// the recorded calls rather than trusting the type.
//
// The second is that every write re-reads what it wrote. An owner policy that does not match the
// caller answers with zero rows and no error, so a check on `error` alone reports a saved change for a
// request that changed nothing (`weddingContentQueries.test.ts` is the same argument for Stage 3's
// tables). Three of these verbs answer `QueryResult<null>` — their success half has nothing in it — and
// that shape is pinned here explicitly, because a screen that reads an empty `data` as a refusal tells
// a host a delete failed after it worked.
//
// The third is the two vocabularies the schema owns and this module must not blend: `response_source`
// pinned to `'host_manual'` on a host's entry, and `23503` translated into the sentence a host can act
// on rather than the constraint that produced it.
//
// Whether Postgres answers at all is qualified by `supabase/tests/stage8/`; nothing here claims to
// prove RLS.

import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  databaseError,
  emptyResult,
  payloadOf,
  planQueries,
  queriedTables,
  recordedRpc,
  recordedSteps,
  rowReturned,
  rpcArgsOf,
  stepsFor,
} from "@/test/fakeSupabase";

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fakeSupabase");
  return { supabase: fakeSupabase };
});

import {
  createGuestHousehold,
  getGuestInvitationState,
  issueGuestInvitations,
  listGuestHouseholds,
  listGuestReplies,
  listHouseholdEventScopes,
  recordManualReply,
  removeGuestHousehold,
  removeGuestReply,
  revokeGuestInvitation,
  rotateGuestInvitation,
  setHouseholdEventScopes,
  updateGuestHousehold,
  type HouseholdDraft,
  type ManualReplyDraft,
} from "@/integrations/supabase/guestInvitations";

const WEDDING = '7d1f0a3e-0000-4000-8000-000000000001';
const HOUSEHOLD = '4a2b6c10-0000-4000-8000-000000000002';
const OTHER = '4a2b6c10-0000-4000-8000-000000000003';
const EVENT_ONE = '9e3d5a70-0000-4000-8000-000000000004';
const EVENT_TWO = '9e3d5a70-0000-4000-8000-000000000005';
const PUBLICATION = '0b1c2d3e-0000-4000-8000-000000000006';
const REPLY = 'c5d6e7f8-0000-4000-8000-000000000007';

/** 41 characters plus the two a minted credential's alphabet allows, in the shape written at
 *  `…sql:248-258`. It is chosen to be recognisable in a log line, which is the point. */
const TOKEN = `${'a'.repeat(41)}_-`;
const PATH = `/g/${TOKEN}`;

const draft = (overrides: Partial<HouseholdDraft> = {}): HouseholdDraft => ({
  displayName: 'The Krishnan family',
  salutation: 'The Krishnans',
  expectedPartySize: '4',
  hostNotes: 'Arriving from Kochi on the 12th.',
  ...overrides,
});

const replyDraft = (overrides: Partial<ManualReplyDraft> = {}): ManualReplyDraft => ({
  householdId: HOUSEHOLD,
  eventId: EVENT_ONE,
  attending: 'attending',
  partySize: 3,
  ...overrides,
});

const panelRow = (householdId: string) => ({
  household_id: householdId,
  display_name: 'The Krishnan family',
  salutation: null,
  expected_party_size: 4,
  link_state: 'never_issued',
  link_expires_at: null,
  link_last_used_at: null,
  scoped_event_count: 2,
  reply_count: 0,
  attending_count: 0,
});

const sendResult = (invitations: unknown[]) => ({
  wedding_id: WEDDING,
  publication_id: PUBLICATION,
  issued: invitations.length,
  already_live: 0,
  expires_at: null,
  invitations,
});

const sendItem = (householdId: string) => ({
  household_id: householdId,
  display_name: 'The Krishnan family',
  status: 'issued',
  path: PATH,
});

const PINNED = 'this family still has a link or recorded replies, so its row stays — withdraw the link, or delete its replies';
const NOT_SCOPED = 'that family is not invited to that event, so the answer cannot be recorded';

let warnSpy: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe("the four verbs that touch a credential", () => {
  it("asks the panel function for one wedding and nothing else", async () => {
    planQueries({ get_guest_invitation_state: [rowReturned([panelRow(HOUSEHOLD)])] });
    const result = await getGuestInvitationState(WEDDING);
    expect(rpcArgsOf('get_guest_invitation_state')).toEqual({ p_wedding_id: WEDDING });
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].linkState).toBe('never_issued');
  });

  it("refuses the whole panel rather than printing the rows it recognised", async () => {
    planQueries({
      get_guest_invitation_state: [rowReturned([panelRow(HOUSEHOLD), { household_id: HOUSEHOLD }])],
    });
    const result = await getGuestInvitationState(WEDDING);
    expect(result).toEqual({ data: null, error: 'the guest invitations could not be read' });
  });

  it("sends to nobody without asking the database, because an empty list would mint against the whole wedding", async () => {
    planQueries({});
    const result = await issueGuestInvitations(WEDDING, []);
    expect(result).toEqual({ data: null, error: 'choose at least one household to send to' });
    expect(recordedRpc()).toEqual([]);
  });

  it("leaves the lifetime to the database when the screen set none, and asks for named households only", async () => {
    planQueries({ issue_guest_invitations: [rowReturned(sendResult([sendItem(HOUSEHOLD)]))] });
    const result = await issueGuestInvitations(WEDDING, [HOUSEHOLD, OTHER]);
    // `null`, not `undefined`: the argument that reaches Postgres has to say "no deadline given", and a
    // key the JSON layer drops is a different function signature.
    expect(rpcArgsOf('issue_guest_invitations')).toEqual({
      p_wedding_id: WEDDING,
      p_household_ids: [HOUSEHOLD, OTHER],
      p_expires_at: null,
    });
    expect(result.data?.invitations[0].path).toBe(PATH);
  });

  it("addresses a rotation and a withdrawal by the household, never by the secret it is replacing", async () => {
    planQueries({
      rotate_guest_invitation: [rowReturned({
        household_id: HOUSEHOLD,
        publication_id: PUBLICATION,
        path: PATH,
        previous_revoked_at: '2026-10-08T09:00:00+00:00',
        expires_at: null,
      })],
      revoke_guest_invitation: [rowReturned({
        household_id: HOUSEHOLD,
        revoked: true,
        credentials_revoked: 1,
        revoked_at: '2026-10-08T09:30:00+00:00',
      })],
    });
    await rotateGuestInvitation(HOUSEHOLD);
    await revokeGuestInvitation(HOUSEHOLD);
    expect(rpcArgsOf('rotate_guest_invitation')).toEqual({ p_household_id: HOUSEHOLD });
    expect(rpcArgsOf('revoke_guest_invitation')).toEqual({ p_household_id: HOUSEHOLD });
  });

  it("hands the minted address back exactly once, and keeps it out of every argument and log line", async () => {
    planQueries({
      issue_guest_invitations: [rowReturned(sendResult([sendItem(HOUSEHOLD)]))],
      rotate_guest_invitation: [databaseError('duplicate key value violates unique constraint')],
    });
    const sent = await issueGuestInvitations(WEDDING, [HOUSEHOLD]);
    expect(sent.data?.invitations).toHaveLength(1);
    const rotated = await rotateGuestInvitation(HOUSEHOLD);
    expect(rotated).toEqual({ data: null, error: 'that invitation link could not be replaced' });
    // The path is this response's payload and nothing else: no argument names it, and the logged
    // failure — which is where a careless `describe()` would put a whole row — does not carry it.
    expect(JSON.stringify(recordedRpc())).not.toContain(TOKEN);
    expect(JSON.stringify(recordedSteps())).not.toContain(TOKEN);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(TOKEN);
  });

  it("refuses a rotation whose path the door could not open, instead of handing the host a broken link", async () => {
    planQueries({
      rotate_guest_invitation: [rowReturned({
        household_id: HOUSEHOLD,
        publication_id: PUBLICATION,
        path: '/g/short',
        previous_revoked_at: null,
        expires_at: null,
      })],
    });
    const result = await rotateGuestInvitation(HOUSEHOLD);
    expect(result).toEqual({ data: null, error: 'that invitation link could not be replaced' });
  });

  it("passes a withdrawal's own answer through, including the case where there was nothing to withdraw", async () => {
    planQueries({
      revoke_guest_invitation: [rowReturned({
        household_id: HOUSEHOLD, revoked: false, credentials_revoked: 0, revoked_at: null,
      })],
    });
    const result = await revokeGuestInvitation(HOUSEHOLD);
    expect(result.data).toEqual({
      householdId: HOUSEHOLD, revoked: false, credentialsRevoked: 0, revokedAt: null,
    });
    expect(result.error).toBeNull();
  });
});

describe("the reads that stay on tables", () => {
  it("names the three host tables and never a token table, a digest or a path", async () => {
    planQueries({
      guest_households: [rowReturned([])],
      rsvp_responses: [rowReturned([])],
      household_event_scopes: [rowReturned([])],
    });
    await listGuestHouseholds(WEDDING);
    await listGuestReplies(WEDDING);
    await listHouseholdEventScopes(WEDDING, HOUSEHOLD);
    expect(queriedTables()).toEqual(['guest_households', 'rsvp_responses', 'household_event_scopes']);
    const selects = recordedSteps()
      .filter(step => step.method === 'select')
      .map(step => String(step.args[0]))
      .join(',');
    expect(selects).not.toMatch(/token|secret|digest|path|hash|private/i);
    expect(recordedRpc()).toEqual([]);
  });

  it("keeps the host's own note on the host's side of the door", async () => {
    planQueries({
      guest_households: [rowReturned([{
        id: HOUSEHOLD, display_name: 'The Krishnan family', salutation: null,
        expected_party_size: null, host_notes: 'Arriving from Kochi on the 12th.',
      }])],
    });
    const result = await listGuestHouseholds(WEDDING);
    // `host_notes` is the one column the door has no field for, and this read is the one screen
    // allowed to see it (`…sql:499-522` is the panel's ten, without it).
    expect(stepsFor('guest_households')[1].args[0]).toMatch(/host_notes/);
    expect(result.data?.[0].hostNotes).toBe('Arriving from Kochi on the 12th.');
    expect(result.data?.[0].expectedPartySize).toBeNull();
  });

  it("answers an empty scope list as the real answer it is, not as a load failure", async () => {
    planQueries({ household_event_scopes: [rowReturned([])] });
    const result = await listHouseholdEventScopes(WEDDING, HOUSEHOLD);
    expect(result).toEqual({ data: [], error: null });
  });

  it("scopes every read to one wedding, so a list cannot be asked for another host's families", async () => {
    planQueries({
      guest_households: [rowReturned([])],
      rsvp_responses: [rowReturned([])],
    });
    await listGuestHouseholds(WEDDING);
    await listGuestReplies(WEDDING);
    const eqs = recordedSteps().filter(step => step.method === 'eq').map(step => step.args);
    expect(eqs).toContainEqual(['wedding_id', WEDDING]);
    expect(eqs.filter(eq => eq[0] === 'wedding_id')).toHaveLength(2);
  });
});

describe("a household row", () => {
  it("sends the name trimmed and an empty field as NULL, which is the CHECK's other arm", async () => {
    planQueries({ guest_households: [rowReturned([{ id: HOUSEHOLD }])] });
    const result = await createGuestHousehold(WEDDING, draft({
      displayName: '  The Rao household  ', salutation: '   ', hostNotes: '', expectedPartySize: '',
    }));
    expect(payloadOf('guest_households', 'insert')).toEqual({
      wedding_id: WEDDING,
      display_name: 'The Rao household',
      salutation: null,
      host_notes: null,
      expected_party_size: null,
    });
    expect(result.data).toEqual({ id: HOUSEHOLD });
  });

  it.each([
    ['no name', draft({ displayName: '   ' })],
    ['a fractional expectation', draft({ expectedPartySize: '2.5' })],
    ['a zero expectation', draft({ expectedPartySize: '0' })],
    ['a negative expectation', draft({ expectedPartySize: '-2' })],
  ])("refuses %s before spending a request on it", async (_label, badDraft) => {
    planQueries({});
    const result = await createGuestHousehold(WEDDING, badDraft);
    expect(result.data).toBeNull();
    expect(recordedSteps()).toEqual([]);
  });

  it("reports a zero-row insert as a failure, never as a saved family", async () => {
    planQueries({ guest_households: [emptyResult()] });
    const result = await createGuestHousehold(WEDDING, draft());
    expect(result).toEqual({ data: null, error: 'the households could not be saved' });
  });

  it("answers a successful edit with an empty data half, which is the shape a screen must not misread", async () => {
    planQueries({ guest_households: [rowReturned([{ id: HOUSEHOLD }])] });
    const result = await updateGuestHousehold(WEDDING, HOUSEHOLD, draft());
    // `QueryResult<null>`: the error is the only discriminator between this and a refusal. Both host
    // panels check the error half for this reason.
    expect(result).toEqual({ data: null, error: null });
    expect(payloadOf('guest_households', 'update')).toEqual({
      display_name: 'The Krishnan family',
      salutation: 'The Krishnans',
      host_notes: 'Arriving from Kochi on the 12th.',
      expected_party_size: 4,
    });
  });

  it("edits inside one wedding only", async () => {
    planQueries({ guest_households: [rowReturned([{ id: HOUSEHOLD }])] });
    await updateGuestHousehold(WEDDING, HOUSEHOLD, draft());
    expect(stepsFor('guest_households').filter(s => s.method === 'eq').map(s => s.args))
      .toEqual([['id', HOUSEHOLD], ['wedding_id', WEDDING]]);
  });

  it("turns the schema's refusal to delete into the sentence §7 asks for, with no constraint in it", async () => {
    planQueries({
      guest_households: [databaseError(
        'update or delete on table "guest_households" violates foreign key constraint "rsvp_responses_wedding_id_household_id_fkey" on table "rsvp_responses"',
        '23503',
      )],
    });
    const result = await removeGuestHousehold(WEDDING, HOUSEHOLD);
    expect(result).toEqual({ data: null, error: PINNED });
    expect(result.error ?? '').not.toMatch(/foreign key|guest_households|rsvp_responses|household_event_scopes|access_tokens|constraint|23503/);
  });

  it("keeps every other delete failure generic, and reports an RLS no-op as a failure", async () => {
    planQueries({ guest_households: [databaseError('permission denied for table guest_households')] });
    await expect(removeGuestHousehold(WEDDING, HOUSEHOLD))
      .resolves.toEqual({ data: null, error: 'the households could not be saved' });
    planQueries({ guest_households: [emptyResult()] });
    await expect(removeGuestHousehold(WEDDING, HOUSEHOLD))
      .resolves.toEqual({ data: null, error: 'the households could not be saved' });
  });

  it("answers a delete that removed its row with the empty success half", async () => {
    planQueries({ guest_households: [rowReturned([{ id: HOUSEHOLD }])] });
    expect(await removeGuestHousehold(WEDDING, HOUSEHOLD)).toEqual({ data: null, error: null });
  });
});

describe("which events one family is invited to", () => {
  it("withdraws the family's scopes before it invites any, so a half-finished write can only narrow", async () => {
    planQueries({
      household_event_scopes: [
        rowReturned([{ event_id: EVENT_ONE }, { event_id: EVENT_TWO }]),
        rowReturned([{ event_id: EVENT_ONE }]),
        rowReturned([{ event_id: EVENT_ONE }]),
      ],
    });
    const result = await setHouseholdEventScopes(WEDDING, HOUSEHOLD, [EVENT_ONE]);
    const methods = stepsFor('household_event_scopes').map(step => step.method);
    expect(methods.indexOf('delete')).toBeLessThan(methods.indexOf('insert'));
    expect(result.data).toEqual([EVENT_ONE]);
  });

  it("sends one row per distinct event, each pinned to this wedding and this family", async () => {
    planQueries({
      household_event_scopes: [
        rowReturned([{ event_id: EVENT_ONE }, { event_id: EVENT_TWO }]),
        rowReturned([{ event_id: EVENT_ONE }, { event_id: EVENT_TWO }]),
        rowReturned([{ event_id: EVENT_ONE }, { event_id: EVENT_TWO }]),
      ],
    });
    await setHouseholdEventScopes(WEDDING, HOUSEHOLD, [EVENT_ONE, EVENT_TWO, EVENT_ONE]);
    const inserted = stepsFor('household_event_scopes').find(s => s.method === 'insert')?.args[0];
    expect(inserted).toEqual([
      { wedding_id: WEDDING, household_id: HOUSEHOLD, event_id: EVENT_ONE },
      { wedding_id: WEDDING, household_id: HOUSEHOLD, event_id: EVENT_TWO },
    ]);
  });

  it("clears the list with a withdraw and no insert, and answers with the empty list it read back", async () => {
    planQueries({ household_event_scopes: [rowReturned([{ event_id: EVENT_ONE }]), rowReturned([])] });
    const result = await setHouseholdEventScopes(WEDDING, HOUSEHOLD, []);
    expect(stepsFor('household_event_scopes').map(s => s.method)).toEqual(['from', 'delete', 'eq', 'eq', 'select', 'from', 'select', 'eq', 'eq', 'order']);
    expect(result).toEqual({ data: [], error: null });
  });

  it("refuses a write whose re-read does not match, because a policy that matched nothing is not a saved scope", async () => {
    planQueries({
      household_event_scopes: [
        rowReturned([{ event_id: EVENT_ONE }]),
        rowReturned([{ event_id: EVENT_ONE }]),
        rowReturned([]),
      ],
    });
    const result = await setHouseholdEventScopes(WEDDING, HOUSEHOLD, [EVENT_ONE]);
    expect(result).toEqual({ data: null, error: 'the events for that household could not be saved' });
  });

  it("refuses a failed withdraw before it invites anything", async () => {
    planQueries({ household_event_scopes: [databaseError('permission denied for table household_event_scopes')] });
    const result = await setHouseholdEventScopes(WEDDING, HOUSEHOLD, [EVENT_ONE]);
    expect(result).toEqual({ data: null, error: 'the events for that household could not be saved' });
    expect(stepsFor('household_event_scopes').map(s => s.method)).not.toContain('insert');
  });
});

describe("an answer the host wrote down", () => {
  it("pins the source to the host, because a client that could write 'guest' could put words in a family's mouth", async () => {
    planQueries({ rsvp_responses: [rowReturned([{ id: REPLY }])] });
    const result = await recordManualReply(WEDDING, replyDraft());
    expect(payloadOf('rsvp_responses', 'insert')).toEqual({
      wedding_id: WEDDING,
      household_id: HOUSEHOLD,
      event_id: EVENT_ONE,
      attending: 'attending',
      party_size: 3,
      response_source: 'host_manual',
    });
    expect(result.data).toEqual({ id: REPLY });
  });

  it("refuses a number that is not a count before the request", async () => {
    for (const partySize of [2.5, -1, Number.NaN]) {
      planQueries({});
      const result = await recordManualReply(WEDDING, replyDraft({ partySize }));
      expect(result).toEqual({ data: null, error: 'the number of guests must be a whole number' });
      expect(recordedSteps()).toEqual([]);
    }
  });

  it("turns the scope key's refusal into the family-and-event sentence, with no constraint named", async () => {
    planQueries({
      rsvp_responses: [databaseError(
        'insert violates foreign key constraint "rsvp_responses_household_id_event_id_fkey"',
        '23503',
      )],
    });
    const result = await recordManualReply(WEDDING, replyDraft({ eventId: EVENT_TWO }));
    expect(result).toEqual({ data: null, error: NOT_SCOPED });
    expect(result.error ?? '').not.toMatch(/foreign key|household_event_scopes|constraint|23503/);
  });

  it("reports a zero-row insert as a failure rather than a recorded answer", async () => {
    planQueries({ rsvp_responses: [emptyResult()] });
    await expect(recordManualReply(WEDDING, replyDraft()))
      .resolves.toEqual({ data: null, error: 'the replies could not be saved' });
  });

  it("answers a successful delete of a reply with the empty success half", async () => {
    planQueries({ rsvp_responses: [rowReturned([{ id: REPLY }])] });
    expect(await removeGuestReply(WEDDING, REPLY)).toEqual({ data: null, error: null });
    expect(stepsFor('rsvp_responses').filter(s => s.method === 'eq').map(s => s.args))
      .toEqual([['id', REPLY], ['wedding_id', WEDDING]]);
  });

  it("refuses to delete another wedding's reply id, and says so when nothing came back", async () => {
    planQueries({ rsvp_responses: [emptyResult()] });
    await expect(removeGuestReply(WEDDING, REPLY))
      .resolves.toEqual({ data: null, error: 'the replies could not be saved' });
  });
});
