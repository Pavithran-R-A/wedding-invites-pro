// What a household is shown at its own door, and what a host is told about its links.
//
// Six reads share this file, and they share one failure mode: each arrives as `jsonb` from a
// PostgREST RPC, and JSON is not a type. `api.resolve_guest_invitation` hands a family its greeting,
// its own event list and the frozen document; `api.get_guest_invitation_state` hands the host one row
// per household; `api.issue_guest_invitations`, `api.rotate_guest_invitation`,
// `api.revoke_guest_invitation` and `api.submit_guest_rsvp` answer with a small verdict object. None
// of them is read with an `as` cast here; every field is taken by name, so a projection that stopped
// writing something is a refusal rather than `undefined` reaching a page a guest is filling in on a
// phone.
//
// The invitation half of the door document is read by `parseInvitationObject`, the same reader the
// wedding's own public page uses. That is the point of the split: a family must see the document the
// couple published, and a second parser standing beside the first is how the two would start to
// differ. `20261009120000_stage8_guest_invitations_rsvp.sql:679-696` returns
// `private.public_invitation_dto` unchanged for exactly that reason (Ruling 5.1 of the design note).
//
// Vocabulary is treated the way `familyReview.ts` treats it. A value of the wrong *kind* refuses the
// payload. An unfamiliar *word* — `link_state`, a send item's `status`, a card's `attending` — is kept
// as text, because the row is still the row the database wrote and a screen can say "this build has no
// label for that word" out loud. Inventing a default for an unrecognised state would render tomorrow's
// word as today's `live`.
//
// Raw credentials appear in exactly two places here: the path a send or a rotate handed back, and the
// token the host pastes into a chat window. Neither is written to storage by this file, and
// `supabase/tests/api/stage8_guest_rsvp.test.mjs` H-01 measures the property that makes the second one
// unrepeatable — a household that already has a live link comes back `already_live` with `path: null`,
// because a secret is legible once (`…sql:248-258`).

import { asObject, booleanValue, isBooleanValue, isNumberValue, numberValue } from './jsonShape';
import { parseInvitationObject, type PublicInvitation } from './publicInvitation';

/** Three characters of prefix plus the 43-character credential, spelled at `…sql:293` and `:469`. */
const GUEST_PATH_PREFIX = '/g/';

/** The credential's shape: 43 URL-safe characters from the base64-with-padding-stripped mint
 *  (`…sql:273`, the same generator as the wedding link at
 *  `20260926130000_stage3_publication_resolution_boundary.sql:515`). Both doors refuse anything else
 *  before they hash it, so this is checked here for the same reason it is checked there: a hopeless
 *  link is not worth a round trip. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The two answers a household may give about an event, closed by the column's CHECK at
 *  `20260925120300_stage2_guests_approvals_rsvp.sql:76`. A form offers these; a parse accepts any
 *  string, because a word this build has not read is still the family's answer. */
export const ATTENDANCE_LABELS = ['attending', 'declined'] as const;

/** The two states a send item can come back in (`…sql:256`, `:292`). */
export const SEND_STATUSES = ['issued', 'already_live'] as const;

/** The four words `link_state` answers for the panel, from the CASE at `…sql:510-513`. Stage 7's queue
 *  uses the same four for the same reason: one word means one thing across both host screens. */
export const LINK_STATES = ['never_issued', 'live', 'expired', 'revoked'] as const;

/**
 * The three reasons `api.submit_guest_rsvp` can refuse a *well-shaped* body (`…sql:726-728`).
 *
 * They are not one family. `unavailable` covers every credential, scope and publication state —
 * revoked, expired, withdrawn publication, an event the household was never shown — and is deliberate
 * indifference, so a guest cannot learn which of those a link is in. The other two are correctable by
 * the person holding the form, which is why Ruling 4.1 of the design note keeps the vocabularies apart
 * and why this file hands the reason to the caller rather than folding it into a single sentence.
 */
export const RSVP_REFUSAL_REASONS = ['unavailable', 'party_size_too_large', 'answers_not_accepted'] as const;

export interface GuestLink {
  path: string;
  token: string;
}

/**
 * The household's address, built from a credential the send or rotate handed back.
 *
 * `null` rather than a plausible-looking path: a token of the wrong shape cannot open the door anyway,
 * and an anchor built from a surprising string is a link a host sends to a family that goes nowhere,
 * with no way for them to tell why.
 */
export function guestLinkPath(token: string): GuestLink | null {
  if (!TOKEN_SHAPE.test(token)) return null;
  return { path: `${GUEST_PATH_PREFIX}${token}`, token };
}

/** The path the product mints, read back as a credential. A path of another prefix or another shape is
 *  a projection this file has not been taught, so it refuses rather than slicing blindly. */
export function guestTokenFromPath(path: string): string | null {
  if (!path.startsWith(GUEST_PATH_PREFIX)) return null;
  const token = path.slice(GUEST_PATH_PREFIX.length);
  return TOKEN_SHAPE.test(token) ? token : null;
}

/** One event this household was paired with, plus that household's own latest answer to it. The eight
 *  keys are the projection at `…sql:650-659`; `attending`, `party_size` and `responded_at` are all null
 *  until the family answers, because the read is a LEFT JOIN (`:666-669`).
 *
 *  `starts_at_local` and `ends_at_local` are wall-clock text with no offset (`to_char`, `:653-655`) —
 *  the instant is `timezone`'s business, and a guest is shown the time the wedding is being held at. */
export interface GuestEventCard {
  eventId: string;
  displayName: string;
  startsAtLocal: string;
  endsAtLocal: string | null;
  timezone: string;
  attending: string | null;
  partySize: number | null;
  respondedAt: string | null;
}

/** What one family is shown at its own door. `can_respond` is "this household has at least one live
 *  card" (`…sql:692`), not a judgement about the link: a family whose events are all disabled can still
 *  read the invitation. `responds_until` is the *credential's* deadline (`:693`), which is why it can be
 *  a date the published document says nothing about. */
export interface GuestDoorDocument {
  householdId: string;
  displayName: string;
  /** What to call them: the host's salutation when there is one, the household's own name when there is
   *  not (`:628`). Never derived from anything but these two columns. */
  greeting: string;
  expectedPartySize: number | null;
  versionNumber: number;
  canRespond: boolean;
  respondsUntil: string | null;
  events: GuestEventCard[];
  invitation: PublicInvitation;
}

/** One row of the host's panel: a household, its link's state, and its reply counts. Ten keys, the
 *  `row_to_json` over the subselect at `…sql:506-522`. No token material is in any of them, and
 *  `host_notes` is not among the columns this read is given. */
export interface GuestPanelRow {
  householdId: string;
  displayName: string;
  salutation: string | null;
  expectedPartySize: number | null;
  linkState: string;
  linkExpiresAt: string | null;
  linkLastUsedAt: string | null;
  scopedEventCount: number;
  replyCount: number;
  attendingCount: number;
}

/** One household's outcome of a send. `path` is text for `issued` and null for `already_live`
 *  (`…sql:253-258`, `:289-294`) — the second is not a failure, it is the same link still working. */
export interface GuestSendItem {
  householdId: string;
  displayName: string;
  status: string;
  path: string | null;
}

/** What one send answered: the six keys at `…sql:298-305`. `expires_at` is the argument, so it is null
 *  for a send that chose no deadline; it is not a claim about any household's own deadline. */
export interface GuestSendResult {
  weddingId: string;
  publicationId: string;
  issued: number;
  alreadyLive: number;
  expiresAt: string | null;
  invitations: GuestSendItem[];
}

/** What a rotate answered. The successor's secret is here and the retired one is not, and
 *  `previous_revoked_at` is the instant written to it (`…sql:466-472`). */
export interface GuestRotation {
  householdId: string;
  publicationId: string;
  path: string;
  previousRevokedAt: string | null;
  expiresAt: string | null;
}

/** What a withdraw answered. `revoked: false` with `credentials_revoked: 0` is a real answer about a
 *  household that had no live link, not an error (`…sql:352-361`). */
export interface GuestRevocation {
  householdId: string;
  revoked: boolean;
  credentialsRevoked: number;
  revokedAt: string | null;
}

/** What a recorded answer answered: the four keys at `…sql:930-935`. `events_recorded` counts the cards
 *  this household wrote, so a family that changed its mind about one event of five sees `1`. */
export interface GuestRsvpReceipt {
  householdId: string;
  eventsRecorded: number;
  respondedAt: string | null;
}

/** The write door's outcome, as one of two kinds. A refusal carries the database's own reason word;
 *  `null` from the parser means the payload was neither of the two shapes this product records, which
 *  the caller treats as "the answer did not land" without claiming to know why. */
export type GuestRsvpOutcome =
  | { kind: 'recorded'; receipt: GuestRsvpReceipt }
  | { kind: 'refused'; reason: string };

/** The door. `{ available: false }`, an envelope this file has not been taught, and a document it
 *  cannot vouch for, all answer `null` — the same indifference the database shows a malformed, revoked,
 *  expired, withdrawn or cross-household credential. */
export function parseGuestDoorDocument(payload: unknown): GuestDoorDocument | null {
  const envelope = asObject(payload);
  if (!envelope || envelope.available !== true) return null;

  const raw = asObject(envelope.guest);
  if (!raw) return null;
  const householdId = requiredText(raw.household_id);
  const displayName = requiredText(raw.display_name);
  const greeting = requiredText(raw.greeting);
  const versionNumber = isNumberValue(raw.version_number) ? numberValue(raw.version_number) : null;
  const canRespond = isBooleanValue(raw.can_respond) ? booleanValue(raw.can_respond) : null;
  const expectedPartySize = optionalNumber(raw.expected_party_size);
  const respondsUntil = nullableText(raw.responds_until);
  if (
    householdId === null || displayName === null || greeting === null
    || versionNumber === null || canRespond === null
    || refuses([expectedPartySize, respondsUntil])
  ) return null;

  if (!Array.isArray(raw.events)) return null;
  const events: GuestEventCard[] = [];
  for (const entry of raw.events) {
    const card = parseEventCard(entry);
    if (card === null) return null;
    events.push(card);
  }

  const invitation = parseInvitationObject(envelope.invitation);
  if (invitation === null) return null;

  return {
    householdId,
    displayName,
    greeting,
    expectedPartySize,
    versionNumber,
    canRespond,
    respondsUntil,
    events,
    invitation,
  };
}

/** The host's panel: a bare JSON array, empty when this wedding has no households. A payload that is
 *  not an array is refused to `null`, which the caller renders as "this read did not answer" — not as an
 *  empty panel, because an empty panel is a claim that nobody is on the list, and that claim belongs to
 *  the database. */
export function parseGuestPanel(payload: unknown): GuestPanelRow[] | null {
  if (!Array.isArray(payload)) return null;
  const rows: GuestPanelRow[] = [];
  for (const entry of payload) {
    const row = parsePanelRow(entry);
    if (row === null) return null;
    rows.push(row);
  }
  return rows;
}

export function parseGuestSendResult(payload: unknown): GuestSendResult | null {
  const raw = asObject(payload);
  if (!raw) return null;
  const weddingId = requiredText(raw.wedding_id);
  const publicationId = requiredText(raw.publication_id);
  const issued = isNumberValue(raw.issued) ? numberValue(raw.issued) : null;
  const alreadyLive = isNumberValue(raw.already_live) ? numberValue(raw.already_live) : null;
  const expiresAt = nullableText(raw.expires_at);
  if (weddingId === null || publicationId === null || issued === null || alreadyLive === null) return null;
  if (refuses([expiresAt])) return null;
  if (!Array.isArray(raw.invitations)) return null;
  const invitations: GuestSendItem[] = [];
  for (const entry of raw.invitations) {
    const item = parseSendItem(entry);
    if (item === null) return null;
    invitations.push(item);
  }
  return { weddingId, publicationId, issued, alreadyLive, expiresAt, invitations };
}

export function parseGuestRotation(payload: unknown): GuestRotation | null {
  const raw = asObject(payload);
  if (!raw) return null;
  const householdId = requiredText(raw.household_id);
  const publicationId = requiredText(raw.publication_id);
  const path = requiredText(raw.path);
  const previousRevokedAt = nullableText(raw.previous_revoked_at);
  const expiresAt = nullableText(raw.expires_at);
  if (householdId === null || publicationId === null || path === null) return null;
  if (refuses([previousRevokedAt, expiresAt])) return null;
  // The successor's secret is the reason this response exists. A path this file cannot read back as a
  // credential is a rotate whose link the host would send out broken and blind.
  if (guestTokenFromPath(path) === null) return null;
  return { householdId, publicationId, path, previousRevokedAt, expiresAt };
}

export function parseGuestRevocation(payload: unknown): GuestRevocation | null {
  const raw = asObject(payload);
  if (!raw) return null;
  const householdId = requiredText(raw.household_id);
  const revoked = isBooleanValue(raw.revoked) ? booleanValue(raw.revoked) : null;
  const credentialsRevoked = isNumberValue(raw.credentials_revoked)
    ? numberValue(raw.credentials_revoked)
    : null;
  const revokedAt = nullableText(raw.revoked_at);
  if (householdId === null || revoked === null || credentialsRevoked === null) return null;
  if (refuses([revokedAt])) return null;
  return { householdId, revoked, credentialsRevoked, revokedAt };
}

/**
 * The answer door's two families, kept apart.
 *
 * `{ recorded: false, reason: 'unavailable' }` is a real answer from the database — the link stopped
 * being live between the page load and the submit — and it is not a receipt. A reason outside
 * `RSVP_REFUSAL_REASONS` is refused to `null` rather than passed through as text, because the only
 * thing a guest can do with an unfamiliar reason word is misread it as a credential problem; the
 * caller gets one sentence for that case and the code goes to the log.
 */
export function parseGuestRsvpOutcome(payload: unknown): GuestRsvpOutcome | null {
  const raw = asObject(payload);
  if (!raw) return null;
  if (raw.recorded === false) {
    const reason = requiredText(raw.reason);
    if (reason === null) return null;
    if (!(RSVP_REFUSAL_REASONS as readonly string[]).includes(reason)) return null;
    return { kind: 'refused', reason };
  }
  if (raw.recorded !== true) return null;
  const householdId = requiredText(raw.household_id);
  const eventsRecorded = isNumberValue(raw.events_recorded) ? numberValue(raw.events_recorded) : null;
  const respondedAt = nullableText(raw.responded_at);
  if (householdId === null || eventsRecorded === null || refuses([respondedAt])) return null;
  return {
    kind: 'recorded',
    receipt: { householdId, eventsRecorded, respondedAt },
  };
}

const nullableText = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : undefined;
};

const requiredText = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/** `undefined` is the only value that refuses a payload, and the list carries both kinds of
 *  optional field this file reads: nullable text and nullable numbers. */
const refuses = (fields: (string | number | null | undefined)[]): boolean =>
  fields.some((field) => field === undefined);

/** A number the projection may legitimately leave empty. `null` means "absent", which is allowed;
 *  `undefined` means "the wrong kind of thing", which refuses the whole payload — kept apart all the way
 *  to the caller, as in `familyReview.ts`. */
const optionalNumber = (value: unknown): number | null | undefined => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
};

const parseEventCard = (value: unknown): GuestEventCard | null => {
  const raw = asObject(value);
  if (!raw) return null;
  const eventId = requiredText(raw.event_id);
  const displayName = requiredText(raw.display_name);
  const startsAtLocal = requiredText(raw.starts_at_local);
  const timezone = requiredText(raw.timezone);
  const endsAtLocal = nullableText(raw.ends_at_local);
  const attending = nullableText(raw.attending);
  const respondedAt = nullableText(raw.responded_at);
  const partySize = optionalNumber(raw.party_size);
  if (eventId === null || displayName === null || startsAtLocal === null || timezone === null) return null;
  if (refuses([endsAtLocal, attending, respondedAt, partySize])) return null;
  return {
    eventId,
    displayName,
    startsAtLocal,
    endsAtLocal,
    timezone,
    attending,
    partySize,
    respondedAt,
  };
};

const parseSendItem = (value: unknown): GuestSendItem | null => {
  const raw = asObject(value);
  if (!raw) return null;
  const householdId = requiredText(raw.household_id);
  const displayName = requiredText(raw.display_name);
  const status = requiredText(raw.status);
  const path = nullableText(raw.path);
  if (householdId === null || displayName === null || status === null) return null;
  if (refuses([path])) return null;
  // Only an `issued` item may carry a credential. A raw secret is legible exactly once, in the response
  // that minted it (`…sql:248-258`, `:289-294`), so `already_live` answers with NULL and a path beside
  // any other word is a send that would print a live link a second time.
  if (status === 'issued') {
    if (path === null || guestTokenFromPath(path) === null) return null;
  } else if (path !== null) {
    return null;
  }
  return { householdId, displayName, status, path };
};

const parsePanelRow = (value: unknown): GuestPanelRow | null => {
  const raw = asObject(value);
  if (!raw) return null;
  const householdId = requiredText(raw.household_id);
  const displayName = requiredText(raw.display_name);
  const linkState = requiredText(raw.link_state);
  const scopedEventCount = isNumberValue(raw.scoped_event_count)
    ? numberValue(raw.scoped_event_count)
    : null;
  const replyCount = isNumberValue(raw.reply_count) ? numberValue(raw.reply_count) : null;
  const attendingCount = isNumberValue(raw.attending_count) ? numberValue(raw.attending_count) : null;
  const salutation = nullableText(raw.salutation);
  const linkExpiresAt = nullableText(raw.link_expires_at);
  const linkLastUsedAt = nullableText(raw.link_last_used_at);
  const expectedPartySize = optionalNumber(raw.expected_party_size);
  if (
    householdId === null || displayName === null || linkState === null
    || scopedEventCount === null || replyCount === null || attendingCount === null
  ) return null;
  if (refuses([salutation, linkExpiresAt, linkLastUsedAt, expectedPartySize])) return null;
  return {
    householdId,
    displayName,
    salutation,
    expectedPartySize,
    linkState,
    linkExpiresAt,
    linkLastUsedAt,
    scopedEventCount,
    replyCount,
    attendingCount,
  };
};
