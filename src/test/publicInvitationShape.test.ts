// The client half of the public contract: what a guest's browser will accept as an
// invitation, and what it refuses.
//
// The database already refuses a broken projection by returning NULL. This proves the
// other half — that a response which is *not* what the projection writes (a changed
// column, a hand-crafted payload, an older build's shape) is refused here too, whole,
// rather than reaching a renderer as `undefined` in a paragraph.

import { describe, expect, it } from "vitest";
import { parsePublicInvitation } from "@/lib/publicInvitation";
import { DELETE_FIELD, guestPayload, guestInvitation, payloadWith } from "@/test/invitationFixture";

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
      'language', 'people', 'style', 'title', 'traditionPack', 'welcome',
    ]);
    const event = JSON.stringify(invitation?.events[0]);
    for (const forbidden of ['id', 'token', 'snapshot', 'digest', 'svg', 'html']) {
      expect(Object.keys(JSON.parse(event)).map(k => k.toLowerCase())).not.toContain(forbidden);
    }
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
    const refusals: Array<[string[], unknown]> = [
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
    ];
    for (const [path, value] of refusals) {
      expect(parse(payloadWith(path, value))).toBeNull();
    }
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
