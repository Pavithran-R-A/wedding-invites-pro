// One guest payload, in the exact snake_case shape `private.public_invitation_dto` writes.
//
// Shared by the parser tests and the renderer tests so the two halves are proven against
// the same document: if the projection's shape and this fixture ever disagree, the parser
// test is the thing that goes red, not a page that renders nothing.
//
// Key order and null-for-absent are what the local stack was measured answering; the ids
// a snapshot carries (`wedding_id`, `version_id`, …) are deliberately *not* here, because
// the projection does not emit them and a test fixture that did would let a leak pass.
//
// Three documents, because the projection answers for three kinds of frozen version:
//
//   `guestInvitation()`       a v2 document with no pack — the section list is what
//                             `private.default_invitation_definition()` resolves to.
//   `guestInvitationPacked()` a v2 document frozen from an approved bilingual release: the
//                             release's own order, its own heading, its own wording beside
//                             the host's overridden one.
//   `guestInvitationV1()`     the Stage 3 shape, which carries no section list at all,
//                             because none existed when it was frozen.
//
// The v2 key sets are read off the projection (`…stage4_tradition_pack_releases.sql`, the
// `jsonb_build_object` calls that build `sections`), including its habit of writing every
// key it was given and using null for the ones with no value. The *words* in the packed
// document are fixture values, not a database dump: each is a bracketed placeholder, so a
// test cannot be read as claiming Tamil ceremonial wording exists anywhere.
//
// Why a host's prose is written twice here. In a v2 document the four prose slots appear
// once as the DTO's flat `welcome` / `family_introduction` / `event_notes` / `closing` keys
// and again as the `host` bodies of the sections whose `host_field` names them — because
// `resolve_invitation_sections` reads them out of the snapshot's `draft` block and the DTO
// reads the same block again. A document that carried a host line in one place and not the
// other is not a document the database can produce, and a renderer that drew from whichever
// copy a test happened to edit would be free to disagree with a guest's page. So the draft
// is a parameter of the builder, and the two copies are written together inside it.
// Everything else in the document — the title, the style, the people, the events — is
// written once by the projection and can be shaped by a test without creating an
// impossible document.

import type { PackHostField } from "@/lib/traditionPackContract";

/** The four slots a host writes prose into — the same closed list the release guard admits
 *  for a section's `host_field`, imported rather than restated so the fixture cannot drift
 *  from the vocabulary the contract pins. */
export type GuestDraftSlot = PackHostField;

export type GuestDraft = Partial<Record<GuestDraftSlot, string | null>>;

export interface GuestNoPackOptions {
  /** The language the wedding asked for, as `weddings.primary_language` holds it. `null` is
   *  a wedding that never chose one, which the projection resolves as English. */
  readonly language?: string | null;
  readonly draft?: GuestDraft;
}

const PLATFORM_LANGUAGE = 'en';

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

/** The draft this fixture's host wrote, before any test overrode it: two slots filled, two
 *  left empty, which is the pair a guest page has to be able to draw and skip. */
const WELCOME = 'With the blessings of our elders';
const FAMILY_INTRODUCTION = 'Our families invite you';

const draftOf = (overrides: GuestDraft) => ({
  welcome: WELCOME,
  family_introduction: FAMILY_INTRODUCTION,
  event_notes: null,
  closing: null,
  ...overrides,
});

/** The language `build_invitation_snapshot` actually resolves against: it passes
 *  `COALESCE(primary_language, 'en')`, so a wedding that chose none is asked in English. */
const resolutionLanguage = (language: string | null): string => language ?? PLATFORM_LANGUAGE;

/** A resolved text section, in the thirteen fields the projection writes per section. A host
 *  body names no language and claims no fallback, because the platform does not know what
 *  language a person typed in; an empty slot carries no body at all, which is how the
 *  projection writes a section with no wording and no pack behind it. */
const hostSection = (
  sectionKey: string,
  position: number,
  hostField: GuestDraftSlot,
  draft: Record<GuestDraftSlot, string | null>,
  overrodePackText = false,
) => ({
  section_key: sectionKey,
  position,
  kind: 'text',
  required: false,
  host_field: hostField,
  heading: null,
  body: draft[hostField] === null
    ? null
    : {
        source: 'host',
        text: draft[hostField],
        language: null,
        fallback_used: null,
        overrode_pack_text: overrodePackText,
      },
});

const listSection = (
  sectionKey: string,
  position: number,
  kind: string,
  heading: { text: string; language: string; fallback_used: boolean } | null,
) => ({
  section_key: sectionKey,
  position,
  kind,
  required: false,
  host_field: null,
  heading,
  body: null,
});

/** The one heading `private.default_invitation_definition()` declares, and the condition the
 *  battery measured for it: it is written in `en` with `allow_english_fallback` left at its
 *  default of false, so `pack_text_for` answers it to an English request and answers nothing
 *  to any other. `50_pack_release.sql` group B is that sentence in SQL. */
const platformCeremoniesHeading = (language: string | null) =>
  resolutionLanguage(language) === PLATFORM_LANGUAGE
    ? { text: 'The ceremonies', language: PLATFORM_LANGUAGE, fallback_used: false }
    : null;

const guestInvitationBody = (language: string | null, draft: Record<GuestDraftSlot, string | null>) => ({
  title: 'Arun weds Deepa',
  language: { primary: language, additional: language === 'en' ? [] : ['en'] },
  style: { font: 'Noto Sans Tamil', fontSize: '24', color: '#6b1e2a', alignment: 'center' },
  design_template: { display_name: 'Maroon and Gold', template_key: 'maroon-gold', revision: 1 },
  people: [guestPerson()],
  events: [guestEvent()],
  welcome: draft.welcome,
  family_introduction: draft.family_introduction,
  event_notes: draft.event_notes,
  closing: draft.closing,
});

/**
 * A v2 document with no tradition pack: the section list `build_invitation_snapshot` resolves
 * for a wedding whose `tradition_pack_release_id` is null, which is
 * `private.default_invitation_definition()` read in the wedding's own language. A Tamil (or
 * Telugu, or unanswered-for) request therefore carries no heading at all — see
 * `platformCeremoniesHeading` — and an English one carries the platform's word.
 *
 * The credit block is `null`, not a pack-shaped object with nothing in it, because that is
 * what the projection publishes for a packless wedding; `50_pack_release.sql` C3b measures the
 * same sentence and refuses a document that has fewer names but a credit where no release is
 * named.
 */
export const guestInvitation = (options: GuestNoPackOptions = {}) => {
  const language = options.language === undefined ? 'ta' : options.language;
  const draft = draftOf(options.draft ?? {});
  const heading = platformCeremoniesHeading(language);
  return {
    ...guestInvitationBody(language, draft),
    tradition_pack: null,
    sections: {
      requested: language,
      items: [
        hostSection('welcome', 1, 'welcome', draft),
        hostSection('family_introduction', 2, 'family_introduction', draft),
        listSection('family', 3, 'people_list', null),
        listSection('ceremonies', 4, 'event_list', heading),
        hostSection('event_notes', 5, 'event_notes', draft),
        hostSection('closing', 6, 'closing', draft),
      ],
    },
  };
};

/**
 * The same wedding, frozen from an approved release that put its own words and its own order
 * on the page. Three things differ from the no-pack document, and each is what a later
 * assertion reads: a heading that came from the release and is in the requested language, a
 * body credited to `reviewed_pack`, and a host line written over pack wording
 * (`overrode_pack_text: true`) — the pair directive §12 refuses to merge into one.
 *
 * The order is the release's, not the platform's: `blessing` sits before the people list, and
 * `event_notes` has moved after the closing and is filled while `closing` is left empty, so a
 * renderer that ignored the projection's array order would be caught by the sequence alone.
 */
export const guestInvitationPacked = () => {
  // The host's own words on this document: `welcome` written over the release's line, and an
  // `event_notes` note the release never had a slot for until it put one after the closing.
  const draft = draftOf({ event_notes: 'Lunch follows the ceremony.' });
  return {
    ...guestInvitationBody('ta', draft),
    tradition_pack: {
      display_name: 'TEST ONLY — Synthetic Reviewed Fixture',
      pack_key: 'test-reviewed-fixture',
      release_number: 2,
    },
    sections: {
      requested: 'ta',
      items: [
        hostSection('welcome', 1, 'welcome', draft, true),
        {
          section_key: 'blessing',
          position: 2,
          kind: 'text',
          required: true,
          host_field: null,
          heading: null,
          body: {
            source: 'reviewed_pack',
            text: '[placeholder blessing line from the release]',
            language: 'ta',
            fallback_used: false,
            overrode_pack_text: false,
          },
        },
        listSection('family', 3, 'people_list', null),
        listSection('ceremonies', 4, 'event_list', {
          text: '[placeholder heading from the release]',
          language: 'ta',
          fallback_used: false,
        }),
        hostSection('closing', 5, 'closing', draft),
        hostSection('event_notes', 6, 'event_notes', draft),
      ],
    },
  };
};

/**
 * The Stage 3 document: four prose slots, two lists, no section list, and a pack block that
 * pinned a `revision` rather than a `release_number`, because a release did not exist as a
 * concept when it was frozen. A guest link to one of these outlives this stage, so the
 * parser and the renderer both have to keep answering for it.
 *
 * The draft here is the same host's words, in the same shape `build_invitation_snapshot`
 * wrote for schema version 1 — which is why the flat four slots are the only prose this
 * document has: `sections` did not exist yet.
 */
export const guestInvitationV1 = () => {
  const draft = draftOf({});
  return {
    ...guestInvitationBody('ta', draft),
    tradition_pack: { display_name: 'Tamil wedding patrika', pack_key: 'tamil-generic', revision: 2 },
  };
};

/** The resolver's whole envelope, as HTTP answers it. */
export const guestPayload = (options?: GuestNoPackOptions): unknown => ({
  available: true,
  invitation: guestInvitation(options),
});

/** The same envelope around the packed document. */
export const packedGuestPayload = (): unknown => ({ available: true, invitation: guestInvitationPacked() });

/** …and around a document frozen before Stage 4 existed. */
export const legacyGuestPayload = (): unknown => ({ available: true, invitation: guestInvitationV1() });

/** Passed where a test needs a key to be absent rather than null. */
export const DELETE_FIELD = Symbol('delete');

/** A copy with one path replaced, so a refusal test changes exactly one field. A numeric
 *  step indexes a list, which is how a document reaches its second event. */
export const payloadWith = (path: Array<string | number>, value: unknown): unknown =>
  payloadOfWith(guestInvitation() as unknown as Record<string, unknown>, path, value);

/** The same instrument pointed at any of the three documents, for the cases that are about
 *  a shape one of them does not have (a v1 payload with a section list bolted on, say) or at
 *  a host's words (`guestInvitation({ draft: … })`) before one field is broken. */
export const payloadOfWith = (
  invitation: Record<string, unknown>,
  path: Array<string | number>,
  value: unknown,
): unknown => {
  const clone = JSON.parse(JSON.stringify({ available: true, invitation })) as Record<string, unknown>;
  let node: Record<string, unknown> = clone;
  for (let i = 0; i < path.length - 1; i += 1) node = node[path[i]] as Record<string, unknown>;
  const last = path[path.length - 1];
  if (value === DELETE_FIELD) delete node[last];
  else node[last] = value;
  return clone;
};
