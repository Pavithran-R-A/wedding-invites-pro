// What one wedding's households are, which of them hold a live link, and what they have said.
//
// This is the host's half of Stage 8, and it is split by the sentence §8 of
// `docs/architecture/guest-rsvp-security.md` was written to decide: secrets and cross-row
// computations go behind `api` wrappers, host-owned content moves through table grants and owner
// policies. So four of the calls below are RPCs — every one that mints, reads or kills a credential,
// or reports a link's state — and everything else is a plain read or write of `guest_households`,
// `household_event_scopes` and `rsvp_responses` under the twelve owner policies at
// `20260925120500_stage2_rls_and_grants.sql:222-299`. No seventh verb was invented for the second
// group, and none of these paths can name a `private` table: `private.access_tokens` is readable only
// through `api.get_guest_invitation_state`, which is why the panel can say `link_state` without any
// browser being able to read a digest.
//
// A raw household credential is legible exactly once, in the response that minted it
// (`20261009120000_stage8_guest_invitations_rsvp.sql:248-258`), so this module hands a path back to the
// screen that asked and stores nothing: no token, no path, no copy of the send result. A host who did
// not copy the address while it was on screen rotates the link — which mints a successor and retires the
// previous one in the same statement (`…sql:449-464`) — rather than re-reading a secret the database
// deliberately no longer has.
//
// Errors follow the Stage 2 rule: `fail()` logs the code through `describe()` and returns a phrase
// chosen in this file. The one database code whose meaning the host can act on is `23503`, and it gets
// its own sentence because it is the schema's answer to "delete this family", which §7 rules is refused
// for any household that has been sent a link or has replies recorded
// (`20260925120400_stage2_assets_entitlements_secrets.sql:169`, `20260925120300…:93-94`).
//
// Every write re-reads the affected row. A policy that does not match the caller returns zero rows
// rather than an error, so a zero-row answer is reported as a failure and never as Saved.

import { supabase } from './client';
import { describe, codeOf } from '@/lib/safeError';
import {
  parseGuestPanel,
  parseGuestRevocation,
  parseGuestRotation,
  parseGuestSendResult,
  type GuestPanelRow,
  type GuestRevocation,
  type GuestRotation,
  type GuestSendResult,
} from '@/lib/guestInvitation';
import type { QueryResult } from './weddings';

type HouseholdRow = {
  id: string;
  display_name: string;
  salutation: string | null;
  expected_party_size: number | null;
  host_notes: string | null;
};

type ReplyRow = {
  id: string;
  household_id: string;
  event_id: string;
  attending: string;
  party_size: number;
  response_source: string;
  responded_at: string;
};

type ScopeRow = { event_id: string };

const HOUSEHOLD_COLUMNS = 'id, display_name, salutation, expected_party_size, host_notes';
const REPLY_COLUMNS = 'id, household_id, event_id, attending, party_size, response_source, responded_at';
const SCOPE_COLUMNS = 'event_id';

/** The name CHECK is the database's (`length(btrim(display_name)) > 0`, at the same place Stage 2 put
 *  it); saying it here spends no request and answers with an instruction instead a constraint name. */
const NAME_NEEDED = 'a household needs a name before it can be saved';
/** Says "or left empty" because NULL is the CHECK's other arm — no expectation, therefore no cap for
 *  the guest — and a host who wants none should be able to leave the field blank. */
const PARTY_SIZE_NEEDED = 'the expected number of guests must be a whole number greater than zero, or left empty';
/** 23503, in the host's own terms: the refusal is the point of the rule, and the sentence has to say
 *  what to do instead, because "delete" is the control the screen did not offer. */
const HOUSEHOLD_PINNED = 'this family still has a link or recorded replies, so its row stays — withdraw the link, or delete its replies';
/** A manual answer may only be recorded for an event the household was invited to, which the composite
 *  key at `20260925120300…:93-94` enforces; the screen's event list comes from the same scopes, so this
 *  is a stale-page case rather than a normal one. */
const NOT_SCOPED = 'that family is not invited to that event, so the answer cannot be recorded';
const PANEL_REFUSED = 'the guest invitations could not be read';
const SEND_REFUSED = 'the invitations could not be sent';
const ROTATE_REFUSED = 'that invitation link could not be replaced';
const REVOKE_REFUSED = 'that invitation link could not be withdrawn';
const HOUSEHOLD_REFUSED = 'the households could not be saved';
const SCOPE_REFUSED = 'the events for that household could not be saved';
const REPLY_REFUSED = 'the replies could not be saved';

/** The two answers the form offers, and the only two the column's CHECK admits
 *  (`20260925120300_stage2_guests_approvals_rsvp.sql:78`). */
export type AttendanceChoice = 'attending' | 'declined';

export interface GuestHousehold {
  id: string;
  displayName: string;
  salutation: string | null;
  expectedPartySize: number | null;
  hostNotes: string | null;
}

export interface GuestReply {
  id: string;
  householdId: string;
  eventId: string;
  attending: string;
  partySize: number;
  /** `'guest'` only ever arrives from the anonymous door's upsert (`…sql:914-922`); a host-written row
   *  is `'host_manual'`, and the screen says which of the two it is looking at. */
  responseSource: string;
  respondedAt: string;
}

export interface HouseholdDraft {
  displayName: string;
  salutation: string;
  expectedPartySize: string;
  hostNotes: string;
}

export interface ManualReplyDraft {
  householdId: string;
  eventId: string;
  attending: AttendanceChoice;
  partySize: number;
}

const MODULE = 'guestInvitations';

const fail = (context: string, error: unknown): { data: null; error: string } => {
  console.warn(describe(MODULE, context, error));
  return { data: null, error: context };
};

const refused = (error: string): { data: null; error: string } => ({ data: null, error });

const blank = (value: string): boolean => value.trim() === '';
const textOrNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/** `''` means "the host set no expectation", which the column stores as NULL — the arm of the CHECK that
 *  turns the guest's party-size cap off (`:25` of the Stage 2 guests file, whose other arm is `> 0`).
 *  Reading a blank field back as a number the host never typed would invent a limit, and accepting the
 *  `0` that same CHECK refuses would spend a request to be told no; `undefined` is the refusal. */
const partySizeOrNull = (value: string): number | null | undefined => {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const toHousehold = (row: HouseholdRow): GuestHousehold => ({
  id: row.id,
  displayName: row.display_name,
  salutation: row.salutation,
  expectedPartySize: row.expected_party_size,
  hostNotes: row.host_notes,
});

const toReply = (row: ReplyRow): GuestReply => ({
  id: row.id,
  householdId: row.household_id,
  eventId: row.event_id,
  attending: row.attending,
  partySize: row.party_size,
  responseSource: row.response_source,
  respondedAt: row.responded_at,
});

/** `.select('id')` after a write is what makes an RLS no-op visible: a policy that does not match the
 *  caller returns no rows rather than an error, and zero affected rows is not a saved change. */
const wroteRow = (data: { id: string }[] | null): boolean => Array.isArray(data) && data.length > 0;

const householdPayload = (draft: HouseholdDraft) => ({
  display_name: draft.displayName.trim(),
  salutation: textOrNull(draft.salutation),
  host_notes: textOrNull(draft.hostNotes),
});

// ---------------------------------------------------------------------------
// The four verbs that touch credentials
// ---------------------------------------------------------------------------

/** One row per household: its own details, its link's state, and how many of its scoped events have
 *  answered. Ten columns, none of them token material (`…sql:499-522`), and an empty array is a real
 *  answer for a wedding that has invited nobody yet. */
export async function getGuestInvitationState(
  weddingId: string,
): Promise<QueryResult<GuestPanelRow[]>> {
  const { data, error } = await supabase.schema('api').rpc('get_guest_invitation_state', {
    p_wedding_id: weddingId,
  });
  if (error) return fail(PANEL_REFUSED, error);
  const panel = parseGuestPanel(data);
  if (panel === null) return fail(PANEL_REFUSED, null);
  return { data: panel, error: null };
}

/**
 * Mint a link for each named household of the current publication, and hand the addresses back once.
 *
 * `expiresAt` is the send's own deadline, shared by every link it mints, and `null` means the lifetime
 * the database applies (`…sql:284`); it is not each household's `responds_until`, which the door reads
 * from the credential row itself. A household that already holds a live link comes back `already_live`
 * with `path: null` rather than as an error, and re-running a send is therefore safe: it cannot leak an
 * old secret and cannot give one family two live links (`…sql:240-258`).
 *
 * The refusal is not silent. `issued` counts the paths in this response, so a screen that shows a send
 * result and lost the paths has nothing to show — which is why the panel's only answer to "we lost the
 * address" is rotate.
 */
export async function issueGuestInvitations(
  weddingId: string,
  householdIds: string[],
  expiresAt?: string,
): Promise<QueryResult<GuestSendResult>> {
  if (householdIds.length === 0) return refused('choose at least one household to send to');
  const { data, error } = await supabase.schema('api').rpc('issue_guest_invitations', {
    p_wedding_id: weddingId,
    p_household_ids: householdIds,
    p_expires_at: expiresAt ?? null,
  });
  if (error) return fail(SEND_REFUSED, error);
  const result = parseGuestSendResult(data);
  if (result === null) return fail(SEND_REFUSED, null);
  return { data: result, error: null };
}

/** Replace one household's link with a new secret, retiring the old one. The path returned here is the
 *  only copy of the successor that will ever exist. */
export async function rotateGuestInvitation(
  householdId: string,
): Promise<QueryResult<GuestRotation>> {
  const { data, error } = await supabase.schema('api').rpc('rotate_guest_invitation', {
    p_household_id: householdId,
  });
  if (error) return fail(ROTATE_REFUSED, error);
  const rotation = parseGuestRotation(data);
  if (rotation === null) return fail(ROTATE_REFUSED, null);
  return { data: rotation, error: null };
}

/** Withdraw one household's link. The household, its events and its answers stay exactly where they
 *  are; only the secret stops resolving (`…sql:314`, `:346-361`), which is the outcome §7 names as the
 *  honest answer to "remove this family" when the row itself cannot be removed. */
export async function revokeGuestInvitation(
  householdId: string,
): Promise<QueryResult<GuestRevocation>> {
  const { data, error } = await supabase.schema('api').rpc('revoke_guest_invitation', {
    p_household_id: householdId,
  });
  if (error) return fail(REVOKE_REFUSED, error);
  const revocation = parseGuestRevocation(data);
  if (revocation === null) return fail(REVOKE_REFUSED, null);
  return { data: revocation, error: null };
}

// ---------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------

/** The host's own list, in the order the panel prints it. `host_notes` is included here because this is
 *  the one screen that is allowed to see it; it never reaches the door, and `parseGuestDoorDocument`
 *  has no field to put it in. */
export async function listGuestHouseholds(
  weddingId: string,
): Promise<QueryResult<GuestHousehold[]>> {
  const { data, error } = await supabase
    .from('guest_households')
    .select(HOUSEHOLD_COLUMNS)
    .eq('wedding_id', weddingId)
    .order('display_name')
    .order('id');
  if (error) return fail('the households could not be loaded', error);
  return { data: (data as HouseholdRow[] | null ?? []).map(toHousehold), error: null };
}

export async function createGuestHousehold(
  weddingId: string,
  draft: HouseholdDraft,
): Promise<QueryResult<{ id: string }>> {
  if (blank(draft.displayName)) return refused(NAME_NEEDED);
  const expected = partySizeOrNull(draft.expectedPartySize);
  if (expected === undefined) return refused(PARTY_SIZE_NEEDED);
  const { data, error } = await supabase
    .from('guest_households')
    .insert({
      wedding_id: weddingId,
      ...householdPayload(draft),
      expected_party_size: expected,
    })
    .select('id');
  if (error) return fail(HOUSEHOLD_REFUSED, error);
  if (!wroteRow(data)) return fail(HOUSEHOLD_REFUSED, null);
  return { data: { id: data[0].id }, error: null };
}

export async function updateGuestHousehold(
  weddingId: string,
  householdId: string,
  draft: HouseholdDraft,
): Promise<QueryResult<null>> {
  if (blank(draft.displayName)) return refused(NAME_NEEDED);
  const expected = partySizeOrNull(draft.expectedPartySize);
  if (expected === undefined) return refused(PARTY_SIZE_NEEDED);
  const { data, error } = await supabase
    .from('guest_households')
    .update({ ...householdPayload(draft), expected_party_size: expected })
    .eq('id', householdId)
    .eq('wedding_id', weddingId)
    .select('id');
  if (error) return fail(HOUSEHOLD_REFUSED, error);
  if (!wroteRow(data)) return fail(HOUSEHOLD_REFUSED, null);
  return { data: null, error: null };
}

/**
 * Delete a household that has never been sent a link and has never replied.
 *
 * The screen offers this control only where the panel says `link_state` is `never_issued`, and this call
 * does not re-check that: the schema's `NO ACTION` keys are the authority, and a family that was ever
 * invited answers 23503 with its row, its scopes and its replies all still present — which is what
 * §7's teardown ruling requires and what the battery asserts as cleanliness rather than only as a code.
 * `…sql:267-272` records the same rule from the other side: the minting function deliberately leaves
 * this delete path open for a never-issued household, and closed for every other one.
 */
export async function removeGuestHousehold(
  weddingId: string,
  householdId: string,
): Promise<QueryResult<null>> {
  const { data, error } = await supabase
    .from('guest_households')
    .delete()
    .eq('id', householdId)
    .eq('wedding_id', weddingId)
    .select('id');
  if (error) {
    if (codeOf(error) === '23503') return refused(HOUSEHOLD_PINNED);
    return fail(HOUSEHOLD_REFUSED, error);
  }
  if (!wroteRow(data)) return fail(HOUSEHOLD_REFUSED, null);
  return { data: null, error: null };
}

// ---------------------------------------------------------------------------
// Which events one household is invited to
// ---------------------------------------------------------------------------

/** The scope rows for one household — the same set the door turns into event cards, minus the
 *  `enabled` filter the door applies (`…sql:662-669`). A disabled ceremony stays scoped so the host's
 *  list and the guest's list differ in exactly one documented way (§6). */
export async function listHouseholdEventScopes(
  weddingId: string,
  householdId: string,
): Promise<QueryResult<string[]>> {
  const { data, error } = await supabase
    .from('household_event_scopes')
    .select(SCOPE_COLUMNS)
    .eq('wedding_id', weddingId)
    .eq('household_id', householdId)
    .order('event_id');
  if (error) return fail('the events for that household could not be loaded', error);
  return { data: (data as ScopeRow[] | null ?? []).map((row) => row.event_id), error: null };
}

/**
 * Set the whole list in one call: withdraw first, then invite.
 *
 * The order is a privacy decision, not an implementation detail. Two REST calls cannot be one
 * transaction, so the interim state is what a guest might read: removing first means the worst a
 * half-finished write can leave is a family shown fewer events, while adding first means a family could
 * be shown an event the host was in the middle of taking away. A failure between the two leaves the
 * narrower list and returns a refusal rather than a partial answer, and the success path re-reads the
 * rows instead of trusting the insert's count, so the screen shows what the household actually holds.
 */
export async function setHouseholdEventScopes(
  weddingId: string,
  householdId: string,
  eventIds: string[],
): Promise<QueryResult<string[]>> {
  const unique = [...new Set(eventIds)];
  const removed = await supabase
    .from('household_event_scopes')
    .delete()
    .eq('wedding_id', weddingId)
    .eq('household_id', householdId)
    .select('event_id');
  if (removed.error) return fail(SCOPE_REFUSED, removed.error);

  if (unique.length > 0) {
    const added = await supabase
      .from('household_event_scopes')
      .insert(unique.map((eventId) => ({ wedding_id: weddingId, household_id: householdId, event_id: eventId })))
      .select('event_id');
    if (added.error) return fail(SCOPE_REFUSED, added.error);
  }

  const after = await supabase
    .from('household_event_scopes')
    .select(SCOPE_COLUMNS)
    .eq('wedding_id', weddingId)
    .eq('household_id', householdId)
    .order('event_id');
  if (after.error) return fail(SCOPE_REFUSED, after.error);
  const written = (after.data as ScopeRow[] | null ?? []).map((row) => row.event_id);
  if (written.length !== unique.length) return fail(SCOPE_REFUSED, null);
  return { data: written, error: null };
}

// ---------------------------------------------------------------------------
// The host's reply list, and the manual entry
// ---------------------------------------------------------------------------

/** Every answer this wedding holds, from both sources. Household and event names belong to the lists
 *  the screen already loaded, so this read stays flat: no embedded resource, no join the column checker
 *  cannot resolve. */
export async function listGuestReplies(weddingId: string): Promise<QueryResult<GuestReply[]>> {
  const { data, error } = await supabase
    .from('rsvp_responses')
    .select(REPLY_COLUMNS)
    .eq('wedding_id', weddingId)
    .order('responded_at')
    .order('id');
  if (error) return fail('the replies could not be loaded', error);
  return { data: (data as ReplyRow[] | null ?? []).map(toReply), error: null };
}

/**
 * Record an answer the host transcribed — a phone call, a message, a paper RSVP.
 *
 * `response_source` is pinned to `'host_manual'` because the INSERT policy requires it
 * (`20260925120500…:278-283`), and a client that could write `'guest'` would be able to put words in a
 * family's mouth. There is no party-size cap here: §7's asymmetry is that a host recording three more
 * arrivals is stating a fact, while a guest raising their own headcount past the host's expectation is
 * exercising a permission the host kept.
 *
 * An event this household is not scoped to is refused by the composite key to `household_event_scopes`
 * (`20260925120300…:93-94`), which is the same authority the guest door uses, so the host cannot record
 * an answer for a ceremony the family was never invited to.
 */
export async function recordManualReply(
  weddingId: string,
  draft: ManualReplyDraft,
): Promise<QueryResult<{ id: string }>> {
  if (!Number.isInteger(draft.partySize) || draft.partySize < 0) {
    return refused('the number of guests must be a whole number');
  }
  const { data, error } = await supabase
    .from('rsvp_responses')
    .insert({
      wedding_id: weddingId,
      household_id: draft.householdId,
      event_id: draft.eventId,
      attending: draft.attending,
      party_size: draft.partySize,
      response_source: 'host_manual',
    })
    .select('id');
  if (error) {
    if (codeOf(error) === '23503') return refused(NOT_SCOPED);
    return fail(REPLY_REFUSED, error);
  }
  if (!wroteRow(data)) return fail(REPLY_REFUSED, null);
  return { data: { id: data[0].id }, error: null };
}

/**
 * Delete one recorded answer.
 *
 * This is also the honest half of "correct a family's answer": a host may not save an edit that
 * re-labels a guest's row as their own (`owners_update_manual_rsvps`' WITH CHECK,
 * `20260925120500…:285-294`), so the path §7 rules out is a silent overwrite and the path it rules in is
 * this delete followed by `recordManualReply`. Two writes, both visible in the reply list's
 * `response_source`, and no policy edited to make the single click work.
 */
export async function removeGuestReply(
  weddingId: string,
  replyId: string,
): Promise<QueryResult<null>> {
  const { data, error } = await supabase
    .from('rsvp_responses')
    .delete()
    .eq('id', replyId)
    .eq('wedding_id', weddingId)
    .select('id');
  if (error) return fail(REPLY_REFUSED, error);
  if (!wroteRow(data)) return fail(REPLY_REFUSED, null);
  return { data: null, error: null };
}
