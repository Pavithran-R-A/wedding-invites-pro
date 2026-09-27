// One guest payload, in the exact snake_case shape `private.public_invitation_dto` writes.
//
// Shared by the parser tests and the renderer tests so the two halves are proven against
// the same document: if the projection's shape and this fixture ever disagree, the parser
// test is the thing that goes red, not a page that renders nothing.
//
// Key order and null-for-absent are what the local stack was measured answering; the ids
// a snapshot carries (`wedding_id`, `version_id`, …) are deliberately *not* here, because
// the projection does not emit them and a test fixture that did would let a leak pass.

export const guestPerson = () => ({
  display_name: 'Arun Kumar',
  role_key: 'groom',
  role_label: 'Groom',
  group_key: 'groom_family',
  group_label: 'Family of the groom',
});

export const guestEvent = () => ({
  event_key: 'muhurtham',
  display_name: 'Wedding ceremony',
  starts_at_local: '2026-11-14T07:30:00',
  ends_at_local: '2026-11-14T09:00:00',
  timezone: 'Asia/Kolkata',
  venue: {
    name: 'Sri Kanchi Mahal',
    address_text: '12 Temple Street\nKanchipuram',
    map_url: 'https://maps.example/sri-kanchi-mahal',
  },
});

export const guestInvitation = () => ({
  title: 'Arun weds Deepa',
  language: { primary: 'ta', additional: ['en'] },
  style: { font: 'Noto Sans Tamil', fontSize: '24', color: '#6b1e2a', alignment: 'center' },
  design_template: { display_name: 'Maroon and Gold', template_key: 'maroon-gold', revision: 1 },
  tradition_pack: { display_name: 'Tamil wedding patrika', pack_key: 'tamil-generic', revision: 2 },
  people: [guestPerson()],
  events: [guestEvent()],
  welcome: 'With the blessings of our elders',
  family_introduction: 'Our families invite you',
  event_notes: null,
  closing: null,
});

/** The resolver's whole envelope, as HTTP answers it. */
export const guestPayload = () => ({ available: true, invitation: guestInvitation() });

/** Passed where a test needs a key to be absent rather than null. */
export const DELETE_FIELD = Symbol('delete');

/** A copy with one path replaced, so a refusal test changes exactly one field. A numeric
 *  step indexes a list, which is how a document reaches its second event. */
export const payloadWith = (path: Array<string | number>, value: unknown): unknown => {
  const clone = JSON.parse(JSON.stringify(guestPayload())) as Record<string, unknown>;
  let node: Record<string, unknown> = clone;
  for (let i = 0; i < path.length - 1; i += 1) node = node[path[i]] as Record<string, unknown>;
  const last = path[path.length - 1];
  if (value === DELETE_FIELD) delete node[last];
  else node[last] = value;
  return clone;
};
