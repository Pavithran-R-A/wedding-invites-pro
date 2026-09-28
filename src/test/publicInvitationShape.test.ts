// The client half of the public contract: what a guest's browser will accept as an
// invitation, and what it refuses.
//
// The database already refuses a broken projection by returning NULL. This proves the
// other half — that a response which is *not* what the projection writes (a changed
// column, a hand-crafted payload, an older build's shape) is refused here too, whole,
// rather than reaching a renderer as `undefined` in a paragraph.

import { describe, expect, it } from "vitest";
import { parsePublicInvitation } from "@/lib/publicInvitation";
import {
  DELETE_FIELD,
  guestInvitation,
  guestInvitationPacked,
  guestInvitationV1,
  guestPayload,
  legacyGuestPayload,
  packedGuestPayload,
  payloadOfWith,
  payloadWith,
} from "@/test/invitationFixture";

const parse = (payload: unknown) => parsePublicInvitation(payload);

describe("the public invitation parser", () => {
  it("accepts the shape the local resolver was measured answering", () => {
    const invitation = parse(guestPayload());
    expect(invitation).not.toBeNull();
    expect(invitation?.title).toBe('Arun weds Deepa');
    expect(invitation?.language).toEqual({ primary: 'ta', additional: ['en'] });
    expect(invitation?.people[0]).toEqual({
      displayName: 'Arun Kumar',
      roleKey: 'groom',
      roleLabel: 'Groom',
      groupKey: 'groom_family',
      groupLabel: 'Family of the groom',
    });
    expect(invitation?.events[0]?.venue?.mapUrl).toBe('https://maps.example/sri-kanchi-mahal');
    expect(invitation?.welcome).toBe('With the blessings of our elders');
    expect(invitation?.eventNotes).toBeNull();
  });

  it("keeps a ceremony's wall-clock text unparsed", () => {
    const invitation = parse(guestPayload());
    // A `Date` would move the muhurtham by the visitor's timezone offset. The string the
    // host froze is the only faithful rendering of "7:30 in Kanchipuram".
    expect(invitation?.events[0]?.startsAtLocal).toBe('2026-11-14T07:30:00');
    expect(typeof invitation?.events[0]?.startsAtLocal).toBe('string');
  });

  it("carries exactly the documented keys and nothing the projection did not write", () => {
    const invitation = parse(guestPayload());
    expect(Object.keys(invitation ?? {}).sort()).toEqual([
      'closing', 'designTemplate', 'eventNotes', 'events', 'familyIntroduction',
      'language', 'people', 'sections', 'style', 'title', 'traditionPack', 'welcome',
    ]);
    const event = JSON.stringify(invitation?.events[0]);
    for (const forbidden of ['id', 'token', 'snapshot', 'digest', 'svg', 'html']) {
      expect(Object.keys(JSON.parse(event)).map(k => k.toLowerCase())).not.toContain(forbidden);
    }
  });

  // The section list is the Stage 4 half of the same contract, so it is proven the same way:
  // the keys below are the camelCase names `private.public_invitation_dto`'s `jsonb_build_object`
  // calls correspond to, one per projected key, and an identifier the projection does not emit
  // must not appear here either.
  it("reads a v2 section list as an ordered list of thirteen documented fields", () => {
    const invitation = parse(guestPayload());
    expect(invitation?.sections?.requested).toBe('ta');
    expect(invitation?.sections?.items.map(item => [item.sectionKey, item.position, item.kind])).toEqual([
      ['welcome', 1, 'text'],
      ['family_introduction', 2, 'text'],
      ['family', 3, 'people_list'],
      ['ceremonies', 4, 'event_list'],
      ['event_notes', 5, 'text'],
      ['closing', 6, 'text'],
    ]);
    // A host body carries the words the draft holds, the credit that the host wrote them,
    // and no language claim — the platform does not know what language a person typed in.
    expect(invitation?.sections?.items[0]?.body).toEqual({
      source: 'host',
      text: 'With the blessings of our elders',
      language: null,
      fallbackUsed: null,
      overrodePackText: false,
    });
    // A section nobody filled is an absent body, not a body of empty text: the difference is
    // what lets the renderer draw nothing instead of an empty paragraph.
    expect(invitation?.sections?.items[4]?.body).toBeNull();
    expect(invitation?.sections?.items[2]?.hostField).toBeNull();
    expect(invitation?.sections?.items[2]?.heading).toBeNull();
    for (const item of invitation?.sections?.items ?? []) {
      expect(Object.keys(item).sort()).toEqual([
        'body', 'heading', 'hostField', 'kind', 'position', 'required', 'sectionKey',
      ]);
    }
    // The public contract names no identifier, and the section list is now part of it: a
    // `release_id` here would be a uuid a guest could quote back at the platform.
    expect(Object.keys(invitation?.sections ?? {}).sort()).toEqual(['items', 'requested']);
    for (const item of invitation?.sections?.items ?? []) {
      expect(Object.keys(item.body ?? {})).not.toContain('releaseId');
      expect(item).not.toHaveProperty('releaseId');
      expect(item).not.toHaveProperty('packId');
      expect(item).not.toHaveProperty('snapshot');
    }
  });

  it("keeps a release's heading and reviewed wording as the projection stated them", () => {
    const invitation = parse(packedGuestPayload());
    const blessing = invitation?.sections?.items.find(item => item.sectionKey === 'blessing');
    expect(blessing?.body).toEqual({
      source: 'reviewed_pack',
      text: '[placeholder blessing line from the release]',
      language: 'ta',
      fallbackUsed: false,
      overrodePackText: false,
    });
    expect(blessing?.required).toBe(true);
    const ceremonies = invitation?.sections?.items.find(item => item.sectionKey === 'ceremonies');
    expect(ceremonies?.heading).toEqual({
      text: '[placeholder heading from the release]',
      language: 'ta',
      fallbackUsed: false,
    });
    // The override: the host's words, credited to the host, saying the pack had been overridden.
    expect(invitation?.sections?.items[0]?.body).toEqual({
      source: 'host',
      text: 'With the blessings of our elders',
      language: null,
      fallbackUsed: null,
      overrodePackText: true,
    });
    // And the release's own order, kept rather than re-sorted into the platform's.
    expect(invitation?.sections?.items.map(item => item.sectionKey)).toEqual([
      'welcome', 'blessing', 'family', 'ceremonies', 'closing', 'event_notes',
    ]);
  });

  it("reads a document frozen before Stage 4 as having no section list", () => {
    const invitation = parse(legacyGuestPayload());
    expect(invitation).not.toBeNull();
    expect(invitation?.sections).toBeNull();
    expect(invitation?.welcome).toBe('With the blessings of our elders');
    // The parser reads the payload it was handed, not the stage that produced it: what makes
    // a document legacy is the absence of the key, and `null` is the same absence in this
    // projection's own idiom.
    expect(parse(payloadOfWith(guestInvitationV1(), ['sections'], null))?.sections).toBeNull();
  });

  it("reads a pack credit by the number the projection wrote for it", () => {
    // `design_template.revision` and `tradition_pack.release_number` are different keys on
    // purpose: one is a template's revision, the other the reviewed release a guest read. A
    // parser that read `revision` from both reported a v2 pack as having no number at all.
    expect(parse(packedGuestPayload())?.traditionPack).toEqual({
      displayName: 'TEST ONLY — Synthetic Reviewed Fixture',
      key: 'test-reviewed-fixture',
      revision: 2,
    });
    expect(parse(packedGuestPayload())?.designTemplate).toEqual({
      displayName: 'Maroon and Gold',
      key: 'maroon-gold',
      revision: 1,
    });
    // A wedding with no release to credit publishes the block as an explicit absence, which is
    // what `50_pack_release.sql` C3b measures server-side; the client reads it as no credit
    // rather than as a credit with a null name.
    expect(parse(guestPayload())?.traditionPack).toEqual({
      displayName: null,
      key: null,
      revision: null,
    });
    // The Stage 3 pack block carried `revision`, the number of a pack *row*, which Stage 4
    // renumbered as a release. Reading it into this field would tell a later reader that a
    // guest had read release 2 of something no release ever was, so the number is honestly
    // absent. Nothing draws it either way; see `InvitationRenderer`.
    expect(parse(legacyGuestPayload())?.traditionPack).toEqual({
      displayName: 'Tamil wedding patrika',
      key: 'tamil-generic',
      revision: null,
    });
  });

  it("keeps an unfamiliar vocabulary word as text rather than refusing the page", () => {
    // The split this parser lives by: a *wrong kind of thing* where the projection promised
    // text is a broken payload and refuses the document; an unfamiliar *word* is a document
    // from a newer build, and the visitor holding that link cannot be upgraded. Dropping the
    // section is `invitationSections.ts`'s decision to make, with an issue attached — this
    // layer's job is to hand the word over intact.
    const unknownKind = parse(payloadWith(['invitation', 'sections', 'items', 2, 'kind'], 'deity_list'));
    expect(unknownKind?.sections?.items[2]?.kind).toBe('deity_list');
    const unknownSource = parse(payloadWith(['invitation', 'sections', 'items', 0, 'body', 'source'], 'community'));
    expect(unknownSource?.sections?.items[0]?.body?.source).toBe('community');
    const unknownSlot = parse(payloadWith(['invitation', 'sections', 'items', 5, 'section_key'], 'sankalpam'));
    expect(unknownSlot?.sections?.items[5]?.sectionKey).toBe('sankalpam');
    const unknownField = parse(payloadWith(['invitation', 'sections', 'items', 0, 'host_field'], 'grandmother'));
    expect(unknownField?.sections?.items[0]?.hostField).toBe('grandmother');
  });

  it("refuses a response that is not an envelope at all", () => {
    expect(parse(null)).toBeNull();
    expect(parse(undefined)).toBeNull();
    expect(parse('Arun weds Deepa')).toBeNull();
    expect(parse([])).toBeNull();
    expect(parse(guestInvitation())).toBeNull(); // the document without its envelope
  });

  it("answers an unavailable envelope with nothing", () => {
    expect(parse({ available: false })).toBeNull();
    expect(parse({ available: false, invitation: guestInvitation() })).toBeNull();
    expect(parse(payloadWith(['available'], 'true'))).toBeNull(); // a string is not `true`
  });

  it("refuses the whole payload when one field is the wrong kind of thing", () => {
    const refusals: Array<[Array<string | number>, unknown]> = [
      [['invitation', 'title'], 42],
      [['invitation', 'title'], null],
      [['invitation', 'welcome'], 7],
      [['invitation', 'language', 'additional'], 'en'],
      [['invitation', 'language', 'additional'], [1, 2]],
      [['invitation', 'style', 'fontSize'], 24],
      [['invitation', 'style', 'alignment'], 'justify'],
      [['invitation', 'design_template', 'revision'], '1'],
      [['invitation', 'people'], {}],
      [['invitation', 'people', '0', 'role_label'], 5],
      [['invitation', 'events'], null],
      [['invitation', 'events', '0', 'starts_at_local'], 1700000000],
      [['invitation', 'events', '0', 'venue'], 'Sri Kanchi Mahal'],
      [['invitation', 'events', '0', 'venue', 'address_text'], 12],
      // The section list is the same kind of promise, so it is refused the same way and for
      // the same reason: `all-or-nothing` is the projection's own rule (an element whose
      // position is not a number makes the whole guest document NULL server-side), and a
      // client that partly honoured such a payload would be rendering a document the
      // database decided not to publish.
      [['invitation', 'sections'], 'ta'],
      [['invitation', 'sections', 'items'], {}],
      [['invitation', 'sections', 'items'], null],
      [['invitation', 'sections', 'items', 0], 'welcome'],
      [['invitation', 'sections', 'items', 0, 'position'], '1'],
      [['invitation', 'sections', 'items', 0, 'position'], null],
      [['invitation', 'sections', 'items', 0, 'position'], []],
      [['invitation', 'sections', 'items', 0, 'required'], 'false'],
      [['invitation', 'sections', 'items', 0, 'section_key'], 7],
      [['invitation', 'sections', 'items', 0, 'host_field'], 4],
      [['invitation', 'sections', 'items', 0, 'body'], 'With the blessings of our elders'],
      [['invitation', 'sections', 'items', 0, 'body', 'fallback_used'], 'no'],
      [['invitation', 'sections', 'items', 0, 'body', 'overrode_pack_text'], 1],
      [['invitation', 'sections', 'requested'], 1],
    ];
    for (const [path, value] of refusals) {
      expect(parse(payloadWith(path, value))).toBeNull();
    }

    // A section that carries a heading, which only a document with something to say in the
    // requested language has: the no-pack fixture's one declared heading is withheld from a
    // Tamil request, so the heading's own field kinds are broken on the packed document.
    const packedRefusals: Array<[Array<string | number>, unknown]> = [
      [['invitation', 'sections', 'items', 3, 'heading'], 'The ceremonies'],
      [['invitation', 'sections', 'items', 3, 'heading', 'text'], 9],
      [['invitation', 'sections', 'items', 3, 'heading', 'language'], 1],
      [['invitation', 'sections', 'items', 3, 'heading', 'fallback_used'], 'no'],
      [['invitation', 'sections', 'items', 1, 'body', 'language'], 1],
      [['invitation', 'sections', 'items', 1, 'body', 'text'], 4],
    ];
    for (const [path, value] of packedRefusals) {
      expect(parse(payloadOfWith(guestInvitationPacked(), path, value))).toBeNull();
    }
  });

  it("refuses a section element that is missing what the projection always writes", () => {
    // `jsonb_build_object` writes every key it was given, so an absent key was never in the
    // projection at all. Absence is forgiven in exactly two places, because a null there is a
    // state the database means: a section with no heading and a section with no wording.
    expect(parse(payloadWith(['invitation', 'sections', 'items', 0], DELETE_FIELD))).toBeNull();
    expect(parse(payloadWith(['invitation', 'sections', 'items', 0, 'position'], DELETE_FIELD))).toBeNull();
    expect(parse(payloadWith(['invitation', 'sections', 'items'], DELETE_FIELD))).toBeNull();

    // `requested` is the one string in the list the projection writes through `dto_text`, so
    // null is a value it publishes rather than a hole: a wedding that never chose a language
    // has no requested language to record. Absence therefore reads the same way.
    const noRequested = parse(payloadWith(['invitation', 'sections', 'requested'], DELETE_FIELD));
    expect(noRequested?.sections?.requested).toBeNull();
    expect(parse(payloadWith(['invitation', 'sections', 'requested'], undefined))?.sections?.requested).toBeNull();

    const dropped = parse(payloadWith(['invitation', 'sections', 'items', 1, 'heading'], DELETE_FIELD));
    expect(dropped?.sections?.items[1]?.heading).toBeNull();
    const noBody = parse(payloadWith(['invitation', 'sections', 'items', 0, 'body'], DELETE_FIELD));
    expect(noBody?.sections?.items[0]?.body).toBeNull();
    const explicitNull = parse(payloadWith(['invitation', 'sections', 'items', 0, 'body'], null));
    expect(explicitNull?.sections?.items[0]?.body).toBeNull();
  });

  it("keeps an absent vocabulary word as the absence it is, and does not draw it", () => {
    // `section_key`, `kind` and `body.source` are the three fields this parser deliberately
    // does not insist on: they are words from a vocabulary, and a payload missing one is
    // nearer a build that renamed it than a corrupted document. What makes that safe rather
    // than a silent hole is that the renderer's normalizer treats `null` exactly as it treats
    // an unfamiliar word — skipped, with a named issue — which `invitationSections.test.ts`
    // measures. A *kind* of thing the projection promised is still refused above.
    const noKind = parse(payloadWith(['invitation', 'sections', 'items', 0, 'kind'], DELETE_FIELD));
    expect(noKind?.sections?.items[0]?.kind).toBeNull();
    const noRequired = parse(payloadWith(['invitation', 'sections', 'items', 0, 'required'], DELETE_FIELD));
    expect(noRequired?.sections?.items[0]?.required).toBeNull();
    const noKey = parse(payloadWith(['invitation', 'sections', 'items', 0, 'section_key'], DELETE_FIELD));
    expect(noKey?.sections?.items[0]?.sectionKey).toBeNull();
    // That the page does not then draw a section with no kind on it is `invitationSections.test.ts`'s
    // `render.unknown_kind_skipped` case: this layer keeps the word, that layer decides it is
    // not drawable, and neither layer is allowed to guess.
  });

  it("refuses a key the projection stopped writing", () => {
    // `undefined` counts as absent text for nullable slots, but a missing required object
    // is a different document, not an invitation with a hole in it.
    expect(parse(payloadWith(['invitation', 'style'], DELETE_FIELD))).toBeNull();
    expect(parse(payloadWith(['invitation', 'language'], DELETE_FIELD))).toBeNull();
    expect(parse(payloadWith(['invitation', 'events'], DELETE_FIELD))).toBeNull();
  });

  it("drops an unsafe map link and keeps the venue beside it", () => {
    for (const link of ['http://maps.example/x', 'javascript:alert(1)', 'data:text/html,<h1>hi>', 'maps.example/x']) {
      const invitation = parse(payloadWith(['invitation', 'events', '0', 'venue', 'map_url'], link));
      expect(invitation).not.toBeNull();
      expect(invitation?.events[0]?.venue?.mapUrl).toBeNull();
      expect(invitation?.events[0]?.venue?.name).toBe('Sri Kanchi Mahal');
    }
  });

  it("reads a null venue as no venue, not as a broken event", () => {
    const invitation = parse(payloadWith(['invitation', 'events', '0', 'venue'], null));
    expect(invitation?.events).toHaveLength(1);
    expect(invitation?.events[0]?.venue).toBeNull();
  });

  it("reads an absent credit as no credit rather than refusing the page", () => {
    // `design_template` and `tradition_pack` are platform content, not a guest's fact; a
    // wedding frozen before either existed is still a readable invitation.
    const invitation = parse(payloadWith(['invitation', 'design_template'], null));
    expect(invitation?.designTemplate).toEqual({ displayName: null, key: null, revision: null });
  });
});
