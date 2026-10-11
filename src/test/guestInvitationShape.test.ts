// What a household is shown at its own door, and what a host is told about its links, read as shapes.
//
// The database half of Stage 8 is qualified in `supabase/tests/sql/` and `supabase/tests/api/`, where the
// projections themselves are measured over real HTTP. What this file pins is the line the app draws
// between a fact it has been taught and a fact it has not: an unfamiliar *word* (`link_state`, a send
// item's `status`, a card's `attending`) still has to reach the screen, because the row is the row the
// database wrote, while a field of the wrong *kind* refuses the whole payload. A parse that guessed
// `live` for tomorrow's `frozen` would render an unknown state as a known one, and a host who reads "Link
// is working" about a withdrawn invitation tells their family to open a door that no longer opens.
//
// The second thing this file pins is the credential's one-time property, which is a shape fact before it
// is a database fact: `supabase/tests/api/stage8_guest_rsvp.test.mjs` H-01 measures that a household which
// already has a live link comes back `already_live` with `path: null`
// (`20261009120000_stage8_guest_invitations_rsvp.sql:248-258`), and the parser refuses an `already_live`
// item that carries a path, so a projection that started handing the same secret out twice would make
// this file go red before it made a host's screen do it.
//
// The third is data minimisation, and here the test points the other way from the others: a payload is
// given the columns the door must never speak about (a digest, a host note, a phone number, a guest
// estimate) and the assertion is that none of them reaches the parsed object. A key the app has not been
// taught is a key it cannot print, which is a weaker guarantee than the RLS policy that withholds those
// columns and is stated as such rather than as a defence.
//
// The fixtures are written in the exact snake_case the migration's `jsonb_build_object` calls produce
// (`…sql:253-258`, `:289-305`, `:352-361`, `:466-472`, `:506-522`, `:650-697`, `:930-935`), including its
// habit of writing every key and using null for the empty ones. The invitation inside a door payload is
// the shared guest fixture, because the door answers with `private.public_invitation_dto` itself rather
// than a second opinion of it (Ruling 5.1).

import { describe, expect, it } from "vitest";

import {
  RSVP_REFUSAL_REASONS,
  guestLinkPath,
  guestTokenFromPath,
  parseGuestDoorDocument,
  parseGuestPanel,
  parseGuestRevocation,
  parseGuestRotation,
  parseGuestRsvpOutcome,
  parseGuestSendResult,
} from "@/lib/guestInvitation";
import { guestInvitation } from "@/test/invitationFixture";

/** 41 characters plus the two a minted credential's alphabet allows: 43 in all, which is what the
 *  generator at `…sql:273` writes and no more. */
const TOKEN = `${'a'.repeat(41)}_-`;

const HOUSEHOLD_ID = '9d2a6f3e-5b18-4c7a-a0e4-000000000011';
const OTHER_HOUSEHOLD_ID = '2c9b4d70-3e62-4a58-bf19-000000000015';
const WEDDING_ID = '4a71c8d2-6f39-4b5c-8e17-000000000012';
const PUBLICATION_ID = 'b8f3e1c6-2a4d-4f90-9c3b-000000000013';
const EVENT_ID = '1c9b4d70-3e62-4a58-bf19-000000000014';

/** A card as the door's `jsonb_agg` writes it for a family that has not answered yet, which is what the
 *  LEFT JOIN costs (`…sql:666-669`): every key is present, the three answer keys are null. */
const eventCard = (overrides: Record<string, unknown> = {}) => ({
  event_id: EVENT_ID,
  display_name: 'Wedding ceremony',
  starts_at_local: '2026-11-14T07:30:00',
  ends_at_local: '2026-11-14T09:00:00',
  timezone: 'Asia/Kolkata',
  attending: null,
  party_size: null,
  responded_at: null,
  ...overrides,
});

/** The `guest` block at `…sql:686-695`, written key for key as `jsonb_build_object` writes it. */
const guestObject = (overrides: Record<string, unknown> = {}) => ({
  household_id: HOUSEHOLD_ID,
  display_name: 'Raman Family',
  greeting: 'Dear Raman Family',
  expected_party_size: 4,
  version_number: 3,
  can_respond: true,
  responds_until: '2026-11-01T09:00:00+00:00',
  events: [eventCard()],
  ...overrides,
});

/** The whole door envelope (`…sql:684-697`). Only the two top-level keys a test means to move belong in
 *  the argument: `guest` replaces the household block, anything else sits beside it. */
const doorPayload = (overrides: Record<string, unknown> = {}) => ({
  available: true,
  guest: guestObject(),
  invitation: guestInvitation(),
  ...overrides,
});

const doorWith = (guestOverrides: Record<string, unknown>) => doorPayload({ guest: guestObject(guestOverrides) });

/** A panel row as `row_to_json` over the subselect writes it — ten keys, in `…sql:506-522`'s order, and
 *  not one of them token material. */
const panelRow = (overrides: Record<string, unknown> = {}) => ({
  household_id: HOUSEHOLD_ID,
  display_name: 'Raman Family',
  salutation: 'Dear Raman Family',
  expected_party_size: 4,
  link_state: 'live',
  link_expires_at: '2026-11-01T09:00:00+00:00',
  link_last_used_at: '2026-10-20T12:04:00+00:00',
  scoped_event_count: 2,
  reply_count: 1,
  attending_count: 1,
  ...overrides,
});

const sendItem = (overrides: Record<string, unknown> = {}) => ({
  household_id: HOUSEHOLD_ID,
  display_name: 'Raman Family',
  status: 'issued',
  path: `/g/${TOKEN}`,
  ...overrides,
});

const sendResult = (overrides: Record<string, unknown> = {}) => ({
  wedding_id: WEDDING_ID,
  publication_id: PUBLICATION_ID,
  issued: 1,
  already_live: 0,
  expires_at: '2026-11-01T09:00:00+00:00',
  invitations: [sendItem()],
  ...overrides,
});

describe("the address built from a credential the host was handed once", () => {
  it("is the short path the directive asks for", () => {
    expect(guestLinkPath(TOKEN)).toEqual({ path: `/g/${TOKEN}`, token: TOKEN });
  });

  it("refuses a string that cannot open the door rather than building a link that goes nowhere", () => {
    for (const hopeless of ['', 'short', TOKEN.slice(0, 42), `${TOKEN}extra`, 'has spaces !@#']) {
      expect(guestLinkPath(hopeless)).toBeNull();
    }
  });

  it("reads the minted path back as the credential it was built from", () => {
    expect(guestTokenFromPath(`/g/${TOKEN}`)).toBe(TOKEN);
    expect(guestTokenFromPath(guestLinkPath(TOKEN)?.path ?? '')).toBe(TOKEN);
  });

  it("refuses a path of another door's prefix instead of slicing blindly", () => {
    // A wedding link (`/i/…`) and a reviewer link (`/r/…`) are the same 43 characters at a different
    // address. The kind filter lives in the database (`…sql:604`); this file's contribution is to not
    // hand one door a credential read out of another's address, which is how a guess at the guest page
    // becomes a probe of the wedding page.
    const otherDoors = [`/i/${TOKEN}`, `/r/${TOKEN}`, TOKEN, `/guest/${TOKEN}`, `/g/${TOKEN}/extra`, `/g/${TOKEN.slice(0, 42)}`];
    for (const path of otherDoors) {
      expect(guestTokenFromPath(path)).toBeNull();
    }
  });
});

describe("the household's door", () => {
  it("reads the greeting, the family's own list and the published document", () => {
    const document = parseGuestDoorDocument(doorPayload());
    expect(document).not.toBeNull();
    expect(document?.householdId).toBe(HOUSEHOLD_ID);
    expect(document?.displayName).toBe('Raman Family');
    expect(document?.greeting).toBe('Dear Raman Family');
    expect(document?.expectedPartySize).toBe(4);
    expect(document?.versionNumber).toBe(3);
    expect(document?.canRespond).toBe(true);
    expect(document?.respondsUntil).toBe('2026-11-01T09:00:00+00:00');
    expect(document?.events[0]).toEqual({
      eventId: EVENT_ID,
      displayName: 'Wedding ceremony',
      startsAtLocal: '2026-11-14T07:30:00',
      endsAtLocal: '2026-11-14T09:00:00',
      timezone: 'Asia/Kolkata',
      attending: null,
      partySize: null,
      respondedAt: null,
    });
    // The invitation is the guest's own document, read by the guest's own parser (Ruling 5.1), so a
    // family and the wedding page cannot be handed two different readings of one frozen snapshot.
    expect(document?.invitation.title).toBe('Arun weds Deepa');
    expect(document?.invitation.events[0]?.venue?.mapUrl).toBe('https://maps.example/sri-kanchi-mahal');
  });

  it("answers nothing at all to the one envelope the database uses for every refusal", () => {
    expect(parseGuestDoorDocument({ available: false })).toBeNull();
    expect(parseGuestDoorDocument({ ...doorPayload(), available: false })).toBeNull();
    expect(parseGuestDoorDocument(null)).toBeNull();
    expect(parseGuestDoorDocument(undefined)).toBeNull();
    expect(parseGuestDoorDocument('<html>an invitation</html>')).toBeNull();
    expect(parseGuestDoorDocument([])).toBeNull();
    expect(parseGuestDoorDocument({ available: 'true', guest: guestObject(), invitation: guestInvitation() })).toBeNull();
  });

  it("refuses a door with no household behind it, and a household with no document behind it", () => {
    expect(parseGuestDoorDocument({ available: true })).toBeNull();
    expect(parseGuestDoorDocument({ available: true, guest: null })).toBeNull();
    expect(parseGuestDoorDocument({ available: true, guest: guestObject() })).toBeNull();
    expect(parseGuestDoorDocument(doorPayload({ invitation: { title: 42 } }))).toBeNull();
    expect(parseGuestDoorDocument(doorPayload({ invitation: null }))).toBeNull();
  });

  it("keeps an unanswered card's blanks as blanks, because \"we have not said yet\" is a fact", () => {
    const document = parseGuestDoorDocument(doorWith({ events: [eventCard()] }));
    expect(document?.events[0]).toMatchObject({ attending: null, partySize: null, respondedAt: null });
  });

  it("keeps the answer a family already gave, because a returning guest must not have to guess", () => {
    const document = parseGuestDoorDocument(doorWith({
      events: [eventCard({ attending: 'attending', party_size: 3, responded_at: '2026-10-22T10:15:00+00:00' })],
    }));
    expect(document?.events[0]).toMatchObject({
      attending: 'attending', partySize: 3, respondedAt: '2026-10-22T10:15:00+00:00',
    });
  });

  it("keeps an answer word this build has no label for as the family's own text", () => {
    const document = parseGuestDoorDocument(doorWith({ events: [eventCard({ attending: 'maybe' })] }));
    expect(document?.events[0]?.attending).toBe('maybe');
  });

  it("reads a family the host left without an expected size, and a link the host gave no deadline", () => {
    const document = parseGuestDoorDocument(doorWith({
      expected_party_size: null, can_respond: false, responds_until: null, events: [],
    }));
    expect(document).toMatchObject({ expectedPartySize: null, respondsUntil: null, canRespond: false, events: [] });
  });

  it("keeps the database's own `can_respond` instead of re-deriving it from the list", () => {
    // The flag and the list come out of one transaction (`…sql:692`), and the flag is the claim the page
    // obeys. A parse that recomputed it from `events.length` would override the server whenever the two
    // disagreed, which is how a family loses the form they were allowed to fill in.
    const document = parseGuestDoorDocument(doorWith({ can_respond: false }));
    expect(document?.canRespond).toBe(false);
    expect(document?.events).toHaveLength(1);
  });

  it("refuses a card that arrived as the wrong kind of thing, rather than drawing a wrong time", () => {
    expect(parseGuestDoorDocument(doorWith({ events: [eventCard({ starts_at_local: 17 })] }))).toBeNull();
    expect(parseGuestDoorDocument(doorWith({ events: [eventCard({ ends_at_local: 17 })] }))).toBeNull();
    expect(parseGuestDoorDocument(doorWith({ events: [eventCard({ timezone: null })] }))).toBeNull();
    expect(parseGuestDoorDocument(doorWith({ events: [eventCard({ event_id: null })] }))).toBeNull();
    expect(parseGuestDoorDocument(doorWith({ events: [eventCard({ party_size: 'four' })] }))).toBeNull();
    expect(parseGuestDoorDocument(doorWith({ events: [42] }))).toBeNull();
    expect(parseGuestDoorDocument(doorWith({ events: null }))).toBeNull();
    expect(parseGuestDoorDocument(doorWith({ events: '[]' }))).toBeNull();
  });

  it("refuses a whole door rather than showing a family a list with one event quietly missing", () => {
    const document = parseGuestDoorDocument(doorWith({
      events: [eventCard(), eventCard({ event_id: OTHER_HOUSEHOLD_ID, display_name: null })],
    }));
    expect(document).toBeNull();
  });

  it("refuses a door fact that arrived as the wrong kind of thing", () => {
    expect(parseGuestDoorDocument(doorWith({ version_number: '3' }))).toBeNull();
    expect(parseGuestDoorDocument(doorWith({ can_respond: 'true' }))).toBeNull();
    expect(parseGuestDoorDocument(doorWith({ greeting: null }))).toBeNull();
    expect(parseGuestDoorDocument(doorWith({ display_name: 9 }))).toBeNull();
    expect(parseGuestDoorDocument(doorWith({ responds_until: 17 }))).toBeNull();
    expect(parseGuestDoorDocument(doorWith({ expected_party_size: 'four' }))).toBeNull();
    expect(parseGuestDoorDocument(doorWith({ household_id: null }))).toBeNull();
  });

  it("shows a family only the fields the projection was given, and drops any the read gains", () => {
    // Everything the door must not say — a digest, a host note, a phone number, a head-count estimate —
    // is withheld first by RLS and by this shape second. A projection cannot widen what reaches a
    // render without this file being edited, and that is the guarantee being measured here.
    const document = parseGuestDoorDocument(doorWith({
      token_hash: 'f'.repeat(64),
      host_notes: 'Prefers the hall near the stage.',
      contact_phone: '+91 90000 00000',
      estimated_guest_count: 180,
    }));
    const rendered = JSON.stringify(document);
    expect(rendered).not.toContain('f'.repeat(64));
    expect(rendered).not.toContain('Prefers');
    expect(rendered).not.toContain('90000');
    expect(rendered).not.toContain('180');
    expect(Object.keys(document ?? {})).toEqual([
      'householdId', 'displayName', 'greeting', 'expectedPartySize', 'versionNumber',
      'canRespond', 'respondsUntil', 'events', 'invitation',
    ]);
  });
});

describe("the host's panel", () => {
  it("reads a whole row into the fields the panel prints", () => {
    const rows = parseGuestPanel([panelRow()]);
    expect(rows).not.toBeNull();
    expect(rows?.[0]).toEqual({
      householdId: HOUSEHOLD_ID,
      displayName: 'Raman Family',
      salutation: 'Dear Raman Family',
      expectedPartySize: 4,
      linkState: 'live',
      linkExpiresAt: '2026-11-01T09:00:00+00:00',
      linkLastUsedAt: '2026-10-20T12:04:00+00:00',
      scopedEventCount: 2,
      replyCount: 1,
      attendingCount: 1,
    });
  });

  it("answers an empty list for a wedding with no households, and nothing for a payload that is not a list", () => {
    expect(parseGuestPanel([])).toEqual([]);
    // A parse failure must not become "nobody is on the list": that is a claim about the family, and only
    // `…sql:503`'s `coalesce(…, '[]'::jsonb)` is allowed to make it.
    for (const notAList of [null, undefined, {}, '[]', 42, { households: [] }]) {
      expect(parseGuestPanel(notAList)).toBeNull();
    }
  });

  it("reads a household that has never been sent a link as a row, not as an absence", () => {
    const rows = parseGuestPanel([panelRow({
      salutation: null,
      expected_party_size: null,
      link_state: 'never_issued',
      link_expires_at: null,
      link_last_used_at: null,
      scoped_event_count: 0,
      reply_count: 0,
      attending_count: 0,
    })]);
    expect(rows?.[0]).toEqual({
      householdId: HOUSEHOLD_ID,
      displayName: 'Raman Family',
      salutation: null,
      expectedPartySize: null,
      linkState: 'never_issued',
      linkExpiresAt: null,
      linkLastUsedAt: null,
      scopedEventCount: 0,
      replyCount: 0,
      attendingCount: 0,
    });
  });

  it("keeps the two vocabularies apart: a withdrawn link on a household that did reply", () => {
    const rows = parseGuestPanel([panelRow({ link_state: 'revoked', link_last_used_at: null, reply_count: 2 })]);
    expect(rows?.[0]).toMatchObject({ linkState: 'revoked', replyCount: 2 });
  });

  it("keeps a word this build has no label for instead of defaulting it to `live`", () => {
    const rows = parseGuestPanel([panelRow({ link_state: 'frozen' })]);
    expect(rows?.[0]?.linkState).toBe('frozen');
  });

  it("refuses a field that arrived as the wrong kind of thing", () => {
    expect(parseGuestPanel([panelRow({ reply_count: '1' })])).toBeNull();
    expect(parseGuestPanel([panelRow({ reply_count: null })])).toBeNull();
    expect(parseGuestPanel([panelRow({ attending_count: undefined })])).toBeNull();
    expect(parseGuestPanel([panelRow({ scoped_event_count: 'two' })])).toBeNull();
    expect(parseGuestPanel([panelRow({ link_state: 12 })])).toBeNull();
    expect(parseGuestPanel([panelRow({ household_id: null })])).toBeNull();
    expect(parseGuestPanel([panelRow({ link_expires_at: 17 })])).toBeNull();
    expect(parseGuestPanel([panelRow({ expected_party_size: 'four' })])).toBeNull();
    expect(parseGuestPanel([42])).toBeNull();
    expect(parseGuestPanel([panelRow(), panelRow({ household_id: null })])).toBeNull();
  });

  it("prints no token material and no household secret, even if the read ever gains a column", () => {
    const rows = parseGuestPanel([{
      ...panelRow(), token_hash: 'f'.repeat(64), path: `/g/${TOKEN}`, host_notes: 'old number',
    }]);
    const rendered = JSON.stringify(rows);
    expect(rendered).not.toContain('f'.repeat(64));
    expect(rendered).not.toContain(TOKEN);
    expect(rendered).not.toContain('old number');
    expect(Object.keys(rows?.[0] ?? {})).toEqual([
      'householdId', 'displayName', 'salutation', 'expectedPartySize', 'linkState',
      'linkExpiresAt', 'linkLastUsedAt', 'scopedEventCount', 'replyCount', 'attendingCount',
    ]);
  });
});

describe("sending the links", () => {
  it("reads the six keys the send answers with", () => {
    expect(parseGuestSendResult(sendResult())).toEqual({
      weddingId: WEDDING_ID,
      publicationId: PUBLICATION_ID,
      issued: 1,
      alreadyLive: 0,
      expiresAt: '2026-11-01T09:00:00+00:00',
      invitations: [{ householdId: HOUSEHOLD_ID, displayName: 'Raman Family', status: 'issued', path: `/g/${TOKEN}` }],
    });
  });

  it("keeps a link that is still working as an outcome, not an error", () => {
    const result = parseGuestSendResult(sendResult({
      issued: 0,
      already_live: 1,
      invitations: [sendItem({ status: 'already_live', path: null })],
    }));
    expect(result?.invitations[0]).toEqual({
      householdId: HOUSEHOLD_ID, displayName: 'Raman Family', status: 'already_live', path: null,
    });
  });

  it("reads a send that chose no deadline as an absence, not as a date it invented", () => {
    expect(parseGuestSendResult(sendResult({ expires_at: null }))?.expiresAt).toBeNull();
    expect(parseGuestSendResult(sendResult())?.expiresAt).toBe('2026-11-01T09:00:00+00:00');
  });

  it("refuses an `issued` item whose secret never arrived, because that send cannot be acted on", () => {
    expect(parseGuestSendResult(sendResult({ invitations: [sendItem({ path: null })] }))).toBeNull();
    expect(parseGuestSendResult(sendResult({ invitations: [sendItem({ path: `/g/${TOKEN.slice(0, 42)}` })] }))).toBeNull();
    expect(parseGuestSendResult(sendResult({ invitations: [sendItem({ path: `/i/${TOKEN}` })] }))).toBeNull();
  });

  it("refuses any item that is not newly issued yet carries a path, which would print a live link twice", () => {
    // H-01's one-time property is a shape fact as much as a database fact: the response that minted a
    // secret is the only response allowed to carry one.
    expect(parseGuestSendResult(sendResult({
      issued: 0, already_live: 1,
      invitations: [sendItem({ status: 'already_live', path: `/g/${TOKEN}` })],
    }))).toBeNull();
    expect(parseGuestSendResult(sendResult({ invitations: [sendItem({ status: 'pending' })] }))).toBeNull();
  });

  it("keeps a status word this build has not been taught, with no path beside it", () => {
    const result = parseGuestSendResult(sendResult({ invitations: [sendItem({ status: 'queued', path: null })] }));
    expect(result?.invitations[0]?.status).toBe('queued');
  });

  it("reads a household's answer list in the order the send walked it", () => {
    const result = parseGuestSendResult(sendResult({
      issued: 1,
      already_live: 1,
      invitations: [
        sendItem(),
        sendItem({ household_id: OTHER_HOUSEHOLD_ID, display_name: 'Chandran Family', status: 'already_live', path: null }),
      ],
    }));
    expect(result?.invitations.map((item) => [item.status, item.path])).toEqual([
      ['issued', `/g/${TOKEN}`],
      ['already_live', null],
    ]);
  });

  it("refuses a send whose counts or ids are not what the response promised", () => {
    expect(parseGuestSendResult(sendResult({ issued: '1' }))).toBeNull();
    expect(parseGuestSendResult(sendResult({ already_live: null }))).toBeNull();
    expect(parseGuestSendResult(sendResult({ wedding_id: null }))).toBeNull();
    expect(parseGuestSendResult(sendResult({ publication_id: 7 }))).toBeNull();
    expect(parseGuestSendResult(sendResult({ expires_at: 17 }))).toBeNull();
    expect(parseGuestSendResult(sendResult({ invitations: null }))).toBeNull();
    expect(parseGuestSendResult(sendResult({ invitations: 42 }))).toBeNull();
    expect(parseGuestSendResult(null)).toBeNull();
    expect(parseGuestSendResult([])).toBeNull();
  });

  it("reads a send that issued nobody as an empty list, not as a failure", () => {
    expect(parseGuestSendResult(sendResult({ issued: 0, already_live: 0, invitations: [] })))
      .toMatchObject({ issued: 0, alreadyLive: 0, invitations: [] });
  });
});

describe("replacing one household's link", () => {
  it("hands back the successor's path and the instant the retired one died at", () => {
    expect(parseGuestRotation({
      household_id: HOUSEHOLD_ID,
      publication_id: PUBLICATION_ID,
      path: `/g/${TOKEN}`,
      previous_revoked_at: '2026-10-21T08:00:00+00:00',
      expires_at: '2026-11-01T09:00:00+00:00',
    })).toEqual({
      householdId: HOUSEHOLD_ID,
      publicationId: PUBLICATION_ID,
      path: `/g/${TOKEN}`,
      previousRevokedAt: '2026-10-21T08:00:00+00:00',
      expiresAt: '2026-11-01T09:00:00+00:00',
    });
  });

  it("keeps an expiry the retired link never had as an absence", () => {
    expect(parseGuestRotation({
      household_id: HOUSEHOLD_ID, publication_id: PUBLICATION_ID, path: `/g/${TOKEN}`,
      previous_revoked_at: null, expires_at: null,
    })).toMatchObject({ previousRevokedAt: null, expiresAt: null });
  });

  it("refuses a rotate whose path is not a credential, because the host would send it out broken and blind", () => {
    for (const hopeless of [null, '', '/g/too-short', `/g/${TOKEN}extra`, `/r/${TOKEN}`, TOKEN]) {
      expect(parseGuestRotation({
        household_id: HOUSEHOLD_ID, publication_id: PUBLICATION_ID, path: hopeless,
        previous_revoked_at: '2026-10-21T08:00:00+00:00', expires_at: null,
      })).toBeNull();
    }
  });

  it("refuses a rotate that is not a rotate", () => {
    expect(parseGuestRotation(null)).toBeNull();
    expect(parseGuestRotation([])).toBeNull();
    expect(parseGuestRotation({ household_id: HOUSEHOLD_ID })).toBeNull();
    expect(parseGuestRotation({
      household_id: null, publication_id: PUBLICATION_ID, path: `/g/${TOKEN}`, previous_revoked_at: null, expires_at: null,
    })).toBeNull();
    expect(parseGuestRotation({
      household_id: HOUSEHOLD_ID, publication_id: PUBLICATION_ID, path: `/g/${TOKEN}`, previous_revoked_at: 17, expires_at: null,
    })).toBeNull();
  });
});

describe("withdrawing one household's link", () => {
  it("reads the two independent facts a withdrawal answered with", () => {
    expect(parseGuestRevocation({
      household_id: HOUSEHOLD_ID, revoked: true, credentials_revoked: 1, revoked_at: '2026-10-21T08:00:00+00:00',
    })).toEqual({
      householdId: HOUSEHOLD_ID, revoked: true, credentialsRevoked: 1, revokedAt: '2026-10-21T08:00:00+00:00',
    });
  });

  it("reads a household with no live link as an answer, not an error: `revoked: false` with no instant", () => {
    expect(parseGuestRevocation({
      household_id: HOUSEHOLD_ID, revoked: false, credentials_revoked: 0, revoked_at: null,
    })).toEqual({ householdId: HOUSEHOLD_ID, revoked: false, credentialsRevoked: 0, revokedAt: null });
  });

  it("reads one verb withdrawing both kinds of credential a household can hold", () => {
    expect(parseGuestRevocation({
      household_id: HOUSEHOLD_ID, revoked: true, credentials_revoked: 2, revoked_at: '2026-10-21T08:00:00+00:00',
    })).toMatchObject({ credentialsRevoked: 2, revoked: true });
  });

  it("refuses a withdrawal whose count is missing rather than guessing whether a link went with it", () => {
    expect(parseGuestRevocation({ household_id: HOUSEHOLD_ID, revoked: true })).toBeNull();
    expect(parseGuestRevocation({ household_id: HOUSEHOLD_ID, revoked: 'true', credentials_revoked: 1 })).toBeNull();
    expect(parseGuestRevocation({ household_id: HOUSEHOLD_ID, revoked: true, credentials_revoked: '1' })).toBeNull();
    expect(parseGuestRevocation({ household_id: HOUSEHOLD_ID, revoked: true, credentials_revoked: 1, revoked_at: 17 })).toBeNull();
    expect(parseGuestRevocation(null)).toBeNull();
  });
});

describe("the household's answer", () => {
  it("reads what was recorded", () => {
    expect(parseGuestRsvpOutcome({
      recorded: true, household_id: HOUSEHOLD_ID, events_recorded: 2, responded_at: '2026-10-22T10:15:00+00:00',
    })).toEqual({
      kind: 'recorded',
      receipt: { householdId: HOUSEHOLD_ID, eventsRecorded: 2, respondedAt: '2026-10-22T10:15:00+00:00' },
    });
  });

  it("keeps the three refusal reasons apart instead of folding them into one sentence", () => {
    // `unavailable` is deliberate indifference about the credential; the other two are correctable by the
    // person holding the form (Ruling 4.1). Collapsing them would tell a family whose party is larger than
    // the host allowed that their link had expired, and they would stop trying instead of asking.
    expect(RSVP_REFUSAL_REASONS).toEqual(['unavailable', 'party_size_too_large', 'answers_not_accepted']);
    for (const reason of RSVP_REFUSAL_REASONS) {
      expect(parseGuestRsvpOutcome({ recorded: false, reason })).toEqual({ kind: 'refused', reason });
    }
  });

  it("refuses a reason word this build cannot explain, rather than telling a guest about a cause it does not know", () => {
    expect(parseGuestRsvpOutcome({ recorded: false, reason: 'link_is_wobbly' })).toBeNull();
    expect(parseGuestRsvpOutcome({ recorded: false, reason: null })).toBeNull();
    expect(parseGuestRsvpOutcome({ recorded: false })).toBeNull();
    expect(parseGuestRsvpOutcome({ recorded: false, reason: 7 })).toBeNull();
  });

  it("refuses a receipt that is not a receipt", () => {
    expect(parseGuestRsvpOutcome({
      recorded: 'true', household_id: HOUSEHOLD_ID, events_recorded: 1, responded_at: null,
    })).toBeNull();
    expect(parseGuestRsvpOutcome({ recorded: true, household_id: HOUSEHOLD_ID, events_recorded: '1' })).toBeNull();
    expect(parseGuestRsvpOutcome({ recorded: true, events_recorded: 1 })).toBeNull();
    expect(parseGuestRsvpOutcome({ recorded: true, household_id: HOUSEHOLD_ID })).toBeNull();
    expect(parseGuestRsvpOutcome({})).toBeNull();
    expect(parseGuestRsvpOutcome(null)).toBeNull();
    expect(parseGuestRsvpOutcome([])).toBeNull();
  });

  it("reads a revision that touched one event of five as one, because that is what the family changed", () => {
    expect(parseGuestRsvpOutcome({
      recorded: true, household_id: HOUSEHOLD_ID, events_recorded: 1, responded_at: '2026-10-23T18:00:00+00:00',
    })).toMatchObject({ receipt: { eventsRecorded: 1 } });
  });
});
