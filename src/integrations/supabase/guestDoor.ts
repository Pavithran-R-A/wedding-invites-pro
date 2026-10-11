// The family's one door: one header, no session, no account.
//
// A guest opening `/g/<credential>` on a phone is not a customer, must not become one, and must not be
// able to see anything beyond their own household's invitation. This module is where that is enforceable,
// and it is deliberately a copy of `publicReview.ts` rather than a cousin of it, for the same three
// reasons:
//
//   * `api.resolve_guest_invitation` is called with no arguments, so the credential can only arrive in a
//     request header. PostgREST will accept a GET with arguments in the URL against a volatile function,
//     and a link whose credential is in a query string ends up in server access logs, browser history
//     and any `Referer` a third-party asset leaks. A header is not an address. The database reads the
//     header itself (`20261009120000_stage8_guest_invitations_rsvp.sql:583`, `:840`) and
//     `scripts/check-product-contract.mjs` fails the build if the argument form is ever written here.
//   * `api.submit_guest_rsvp` does take arguments — the household's answers — and they travel in the POST
//     body for the same reason. The body this file builds has exactly the three keys the door admits per
//     card (`…sql:786-791`), and never an `answers` key: this invitation asks no optional question, and
//     sending one would be a guest writing prose into a host's `rsvp_responses.answers` column.
//   * The client is built fresh per call, holds no session, and writes nothing to storage
//     (`persistSession: false`). After a family reads its invitation and replies, a shared household
//     phone keeps neither a session nor a refresh token nor this credential.
//
// Refusals are shaped like the database's. A malformed, unknown, revoked, expired, rotated-away,
// withdrawn or cross-household credential all answer the read door with `200 { available: false }`
// (`…sql:1229`), and this file turns each of them into the same one phrase, so a guest who mistyped a
// link learns nothing and nobody probing addresses learns which households exist.
//
// The write door refuses in two registers, and each is handled by its own rule. Three of them are
// in-band (`200 { recorded: false, reason: … }`, `…sql:727-729`) and become the three sentences in
// `REFUSAL_COPY` below. The rest are raised as `23514` with the migration's own authored sentence, and
// only the three listed in `SUBMISSION_REFUSALS` are repeated; anything this build has not read is
// folded into one phrase with its code logged, because an unrecognised server message may name a table.

import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import {
  parseGuestDoorDocument,
  parseGuestRsvpOutcome,
  type GuestDoorDocument,
  type GuestRsvpOutcome,
} from '@/lib/guestInvitation';
import { describe } from '@/lib/safeError';
import type { QueryResult } from './weddings';

/** The only header a household invitation may travel in. */
const TOKEN_HEADER = 'x-guest-token';

/** Both doors read the header themselves and refuse anything that is not 43 URL-safe characters before
 *  hashing it (`…sql:584-586`, `:841`), so a string of another shape cannot possibly match. Checked here
 *  for the same reason it is checked there: it is not worth a round trip, and refusing it locally costs
 *  nothing to say. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The two answers this product records, and the only two the column's CHECK admits
 *  (`20260925120300_stage2_guests_approvals_rsvp.sql:78`). */
export type GuestAttendance = 'attending' | 'declined';

/** One event card as the family leaves it. `partySize` is a number the page already made the guest type
 *  — the door requires it (`…sql:815-818`) precisely so an "attending" row can never carry the column's
 *  default of zero, which the host panel would read as nobody coming. */
export interface GuestRsvpCard {
  eventId: string;
  attending: GuestAttendance;
  partySize: number;
}

export const GUEST_DOOR_UNAVAILABLE = 'This invitation link is not available.';
export const GUEST_ANSWER_NOT_RECORDED = 'Your reply could not be recorded.';

/**
 * The three sentences `api.submit_guest_rsvp` raises a malformed body with, transcribed from
 * `…sql:730`, `:768` and `:832`.
 *
 * Passing these through, and nothing else, is the exception to the Stage 2 rule that a client repeats no
 * server message: they are authored product copy that names no table, no policy and no other family.
 * Each says something a guest can act on — a page that has lost a card, a submission naming every guest
 * at once, the same event answered twice.
 */
const SUBMISSION_REFUSALS = new Set([
  'the answers submitted are not in the shape this invitation records',
  'too many answers in one submission',
  'the same event was answered twice',
]);

/**
 * The three in-band reasons, in the page's own words.
 *
 * `party_size_too_large` is actionable rather than a wall: the guest's own door already shows the
 * household's expected size (`…sql:690`), so naming the cap tells them what happened and points at the
 * one person who can change it. `answers_not_asked` is worded the way the migration's own comment asks
 * for (`…sql:776-778`): the couple is not asking that yet, which is different from being told their
 * request is malformed.
 */
const REFUSAL_COPY: Record<string, string> = {
  unavailable: GUEST_DOOR_UNAVAILABLE,
  party_size_too_large: 'That is more guests than this invitation is for. Ask the host if more can be added.',
  answers_not_accepted: 'The couple is not asking that question on this invitation yet.',
};

const guestClient = (token: string) => createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    global: { headers: { [TOKEN_HEADER]: token } },
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

/** The invitation for one household, or the one phrase. Nothing is cached and nothing is stored: a
 *  household's guest list is not something to leave on a shared phone. */
export async function resolveGuestInvitation(
  token: string,
): Promise<QueryResult<GuestDoorDocument>> {
  if (!TOKEN_SHAPE.test(token)) return { data: null, error: GUEST_DOOR_UNAVAILABLE };

  const { data, error } = await guestClient(token).schema('api').rpc('resolve_guest_invitation');
  if (error) return unavailable('resolve_guest_invitation', error);

  const document = parseGuestDoorDocument(data);
  if (document === null) return { data: null, error: GUEST_DOOR_UNAVAILABLE };
  return { data: document, error: null };
}

/**
 * Record this household's answers, all the cards it names or none of them.
 *
 * The household is not passed: it is derived from the credential server-side (`…sql:847-857`), which is
 * what makes one family unable to answer for another. Repeat submissions overwrite the household's own
 * current answer rather than stacking history (`…sql:917-922`), so a mis-tap is correctable and the
 * result is the same four-key receipt either way.
 */
export async function submitGuestRsvp(
  token: string,
  cards: GuestRsvpCard[],
): Promise<QueryResult<GuestRsvpOutcome>> {
  if (!TOKEN_SHAPE.test(token)) return { data: null, error: GUEST_DOOR_UNAVAILABLE };
  if (cards.length === 0) return { data: null, error: GUEST_ANSWER_NOT_RECORDED };

  const { data, error } = await guestClient(token).schema('api').rpc('submit_guest_rsvp', {
    p_answers: {
      events: cards.map((card) => ({
        event_id: card.eventId,
        attending: card.attending,
        party_size: card.partySize,
      })),
    },
  });
  if (error) return notRecorded(error);

  const outcome = parseGuestRsvpOutcome(data);
  if (outcome === null) return { data: null, error: GUEST_ANSWER_NOT_RECORDED };
  if (outcome.kind === 'refused') {
    const copy = REFUSAL_COPY[outcome.reason];
    if (copy === undefined) return notRecorded(null);
    return { data: null, error: copy };
  }
  return { data: outcome, error: null };
}

const unavailable = (context: string, reason: unknown): { data: null; error: string } => {
  console.warn(describe(context, GUEST_DOOR_UNAVAILABLE, reason));
  return { data: null, error: GUEST_DOOR_UNAVAILABLE };
};

/** The submission path is the one place a server sentence may reach the guest, and only from the list
 *  above — see `SUBMISSION_REFUSALS`. */
const notRecorded = (reason: unknown): { data: null; error: string } => {
  console.warn(describe('submit_guest_rsvp', GUEST_ANSWER_NOT_RECORDED, reason));
  const message = (reason as { message?: unknown } | null | undefined)?.message;
  if (typeof message === 'string' && SUBMISSION_REFUSALS.has(message)) return { data: null, error: message };
  return { data: null, error: GUEST_ANSWER_NOT_RECORDED };
};
