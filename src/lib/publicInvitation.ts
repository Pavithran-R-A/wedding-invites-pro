// The guest-facing document, as the app is willing to render it.
//
// `api.resolve_public_invitation` hands back JSON, and JSON is not a type. This module
// turns it into the interface below or refuses: every field is read by name from the
// wire shape (which is snake_case, because the database built it), so nothing the
// projection did not write can reach a renderer, and no `Record<string, any>` stands in
// for the contract.
//
// Refusal is the whole payload, not the field that looked odd. A projection that
// emitted a number where it promised text has either changed or is being fed junk, and
// half an invitation is a wrong invitation — the host would share a link that shows a
// guest a document missing a piece. The database half of the boundary does the same
// thing (`private.public_invitation_dto` returns NULL rather than a partial object), so
// the two halves agree on what "I cannot vouch for this" means.
//
// One exception, deliberately mirroring the database: a map link whose scheme is not
// https is dropped to null and the venue stays. `private.map_link_or_null` treats an
// unsafe link as "no link", not as "no invitation", and a guest who can read an address
// but not tap a map is still holding a correct document.
//
// `sections` is the part that grew in Stage 4, and it is read with one further
// distinction. A *shape* that is wrong — a number where the projection promised text — is
// still refused wholesale, because that document is not the one the database wrote. A
// *vocabulary* this build has not been taught is not: `kind` and `body.source` are kept as
// plain text here, because a guest page frozen by a newer migration must keep rendering for
// an older bundle, and the refusal of an unknown kind belongs to the reader that can say why
// (`invitationSections.ts`, which skips it and records an issue). Refusing the whole payload
// for a word this parser has not seen would turn a forward-compatible addition into a blank
// page for the one reader who cannot be updated — the visitor holding a link.

import { asObject, booleanValue, isBooleanValue, isNumberValue, isText, numberValue, text } from './jsonShape.ts';

const ALIGNMENTS = ['left', 'center', 'right'] as const;

export type InvitationAlignment = (typeof ALIGNMENTS)[number];

export interface InvitationLanguage {
  primary: string | null;
  additional: string[];
}

/** The four settings a guest may be shown. `foilEnabled` is absent by design: it is a
 *  screen-only flourish standing in for printed foil, and the projection never emits it. */
export interface InvitationStyle {
  font: string | null;
  fontSize: string | null;
  color: string | null;
  alignment: InvitationAlignment | null;
}

export interface InvitationCredit {
  displayName: string | null;
  key: string | null;
  /** A template's revision, or a pack's release number — whichever number the projection
   *  wrote for that credit (see `parseCredit`). Null for a legacy document whose pack block
   *  recorded no release. Never drawn: see `InvitationRenderer`. */
  revision: number | null;
}

export interface InvitationPerson {
  displayName: string | null;
  roleKey: string | null;
  roleLabel: string | null;
  groupKey: string | null;
  groupLabel: string | null;
}

export interface InvitationVenue {
  name: string | null;
  addressText: string | null;
  /** https or nothing. See the note above. */
  mapUrl: string | null;
}

export interface InvitationEvent {
  eventKey: string | null;
  displayName: string | null;
  /** Wall-clock text as the host froze it, e.g. `2026-11-14T07:30:00`. Deliberately not
   *  a `Date`: parsing it would let a client move a muhurtham by an hour. */
  startsAtLocal: string | null;
  endsAtLocal: string | null;
  timezone: string | null;
  venue: InvitationVenue | null;
}

/** One of the two maps a section's wording can come from, as the projection flattens it.
 *  `fallbackUsed` is the release's own record that the requested language was not available
 *  and `en` was used with its permission; a host body carries neither field. */
export interface InvitationSectionHeading {
  text: string | null;
  language: string | null;
  fallbackUsed: boolean | null;
}

export interface InvitationSectionBody {
  /** `'host'`, `'reviewed_pack'`, or a word this build has not been taught — see the header. */
  source: string | null;
  /** For a host body, the projection resolved it from the snapshot's `draft` block, so the
   *  words live in one place in the frozen document rather than twice. */
  text: string | null;
  language: string | null;
  fallbackUsed: boolean | null;
  overrodePackText: boolean | null;
}

/** One entry of the ordered list a release resolved into. Every field is read by name; the
 *  three that could be *renamed* by a later migration (`section_key`, `kind`,
 *  `body.source`) stay as plain text so an older bundle can skip one rather than refuse a
 *  guest's page. */
export interface InvitationSection {
  sectionKey: string | null;
  position: number | null;
  kind: string | null;
  required: boolean | null;
  /** Already whitelisted to the four host fields by the projection; read as text here. */
  hostField: string | null;
  heading: InvitationSectionHeading | null;
  body: InvitationSectionBody | null;
}

export interface InvitationSections {
  /** The language the frozen wedding asked for, so a host preview can explain a substitution. */
  requested: string | null;
  items: InvitationSection[];
}

/** Everything a guest may learn about one invitation. Fourteen text slots and lists; no
 *  identifier of any kind, because nothing in the renderer should need one. */
export interface PublicInvitation {
  title: string;
  language: InvitationLanguage;
  style: InvitationStyle;
  designTemplate: InvitationCredit | null;
  traditionPack: InvitationCredit | null;
  people: InvitationPerson[];
  events: InvitationEvent[];
  /** Null for a document frozen before Stage 4, which carries no section list at all. The
   *  flat four slots below are what such a document has; a v2 projection writes both, and
   *  `invitationSections.ts` decides which one a renderer draws from. */
  sections: InvitationSections | null;
  welcome: string | null;
  familyIntroduction: string | null;
  eventNotes: string | null;
  closing: string | null;
}

/** An array of nullable text, in the order the database wrote it. */
const parseTextList = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    out.push(entry);
  }
  return out;
};

const parseLanguage = (value: unknown): InvitationLanguage | null => {
  const raw = asObject(value);
  if (!raw || !isText(raw.primary)) return null;
  const additional = parseTextList(raw.additional);
  if (additional === null) return null;
  return { primary: text(raw.primary), additional };
};

const parseStyle = (value: unknown): InvitationStyle | null => {
  const raw = asObject(value);
  if (!raw || !isText(raw.font) || !isText(raw.fontSize) || !isText(raw.color)) return null;
  const alignment = raw.alignment;
  if (alignment !== null && alignment !== undefined && !ALIGNMENTS.includes(alignment as InvitationAlignment)) {
    return null;
  }
  return {
    font: text(raw.font),
    fontSize: text(raw.fontSize),
    color: text(raw.color),
    alignment: (alignment as InvitationAlignment | undefined) ?? null,
  };
};

/**
 * A credit line: platform content the document names. The number's *key* differs by credit
 * because the projection renamed it — `design_template.revision` is a template revision,
 * while a pack block on a v2 document carries `release_number`, the number that answers
 * "which reviewed release did this guest read". Naming both keys here rather than reading
 * `revision` from everything is what stops a pack credit from silently parsing as
 * `{ revision: null }` on the one shape that has a real number to report.
 */
const parseCredit = (
  value: unknown,
  keyName: string,
  numberName: string,
): InvitationCredit | null => {
  if (value === null || value === undefined) return { displayName: null, key: null, revision: null };
  const raw = asObject(value);
  if (!raw || !isText(raw.display_name) || !isNumberValue(raw[numberName])) return null;
  if (!isText(raw[keyName])) return null;
  return {
    displayName: text(raw.display_name),
    key: text(raw[keyName]),
    revision: numberValue(raw[numberName]),
  };
};

const parsePerson = (value: unknown): InvitationPerson | null => {
  const raw = asObject(value);
  if (!raw) return null;
  if (!isText(raw.display_name) || !isText(raw.role_key) || !isText(raw.role_label)) return null;
  if (!isText(raw.group_key) || !isText(raw.group_label)) return null;
  return {
    displayName: text(raw.display_name),
    roleKey: text(raw.role_key),
    roleLabel: text(raw.role_label),
    groupKey: text(raw.group_key),
    groupLabel: text(raw.group_label),
  };
};

const parseVenue = (value: unknown): InvitationVenue | null => {
  if (value === null || value === undefined) return null;
  const raw = asObject(value);
  if (!raw || !isText(raw.name) || !isText(raw.address_text)) return null;
  const link = text(raw.map_url);
  return {
    name: text(raw.name),
    addressText: text(raw.address_text),
    // Re-checked rather than trusted: the projection already does this, but a frozen
    // version predates whatever rule the projection follows tomorrow.
    mapUrl: link !== null && /^https:\/\//.test(link) ? link : null,
  };
};

const parseEvent = (value: unknown): InvitationEvent | null => {
  const raw = asObject(value);
  if (!raw) return null;
  if (!isText(raw.event_key) || !isText(raw.display_name)) return null;
  if (!isText(raw.starts_at_local) || !isText(raw.ends_at_local) || !isText(raw.timezone)) return null;
  const venue = raw.venue === null || raw.venue === undefined ? null : parseVenue(raw.venue);
  if (venue === null && raw.venue !== null && raw.venue !== undefined) return null;
  return {
    eventKey: text(raw.event_key),
    displayName: text(raw.display_name),
    startsAtLocal: text(raw.starts_at_local),
    endsAtLocal: text(raw.ends_at_local),
    timezone: text(raw.timezone),
    venue,
  };
};

const parseSectionHeading = (value: unknown): InvitationSectionHeading | null => {
  const raw = asObject(value);
  if (!raw || !isText(raw.text) || !isText(raw.language)) return null;
  if (!isBooleanValue(raw.fallback_used)) return null;
  return {
    text: text(raw.text),
    language: text(raw.language),
    fallbackUsed: booleanValue(raw.fallback_used),
  };
};

const parseSectionBody = (value: unknown): InvitationSectionBody | null => {
  const raw = asObject(value);
  if (!raw || !isText(raw.source) || !isText(raw.text) || !isText(raw.language)) return null;
  if (!isBooleanValue(raw.fallback_used) || !isBooleanValue(raw.overrode_pack_text)) return null;
  return {
    source: text(raw.source),
    text: text(raw.text),
    language: text(raw.language),
    fallbackUsed: booleanValue(raw.fallback_used),
    overrodePackText: booleanValue(raw.overrode_pack_text),
  };
};

/**
 * One section, read the way the rest of this file reads: a wrong *kind* of value refuses
 * the payload, an unfamiliar *word* (`kind`, `body.source`, `section_key`) is kept as text
 * for `invitationSections.ts` to skip with a named issue. `position` is required to be a
 * number because the projection casts it and a document that lost that is not this
 * document; the array's own order is what the renderer is given, not a re-sort.
 */
const parseSection = (value: unknown): InvitationSection | null => {
  const raw = asObject(value);
  if (!raw || !isText(raw.section_key) || !isText(raw.kind)) return null;
  if (!isText(raw.host_field) || !isBooleanValue(raw.required)) return null;
  if (typeof raw.position !== 'number' || !Number.isFinite(raw.position)) return null;
  const heading = raw.heading === null || raw.heading === undefined
    ? null
    : parseSectionHeading(raw.heading);
  if (heading === null && raw.heading !== null && raw.heading !== undefined) return null;
  const body = raw.body === null || raw.body === undefined ? null : parseSectionBody(raw.body);
  if (body === null && raw.body !== null && raw.body !== undefined) return null;
  return {
    sectionKey: text(raw.section_key),
    position: raw.position,
    kind: text(raw.kind),
    required: booleanValue(raw.required),
    hostField: text(raw.host_field),
    heading,
    body,
  };
};

/** Null means the document has no section list — a version frozen before Stage 4. An object
 *  that is half-written is refused rather than read as "no sections", because a v2
 *  projection that stopped writing its items would otherwise render as a v1 document and
 *  silently lose the ordering its host chose. */
const parseSections = (value: unknown): InvitationSections | null => {
  if (value === null || value === undefined) return null;
  const raw = asObject(value);
  if (!raw || !isText(raw.requested)) return null;
  const items = parseList(raw.items, parseSection);
  if (items === null) return null;
  return { requested: text(raw.requested), items };
};

const parseList = <T>(value: unknown, parse: (entry: unknown) => T | null): T[] | null => {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const entry of value) {
    const parsed = parse(entry);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
};

/**
 * The one reader of the resolver's envelope. `{ available: false }`, an absent envelope,
 * a hostile shape and a shape this module has not been taught all return the same
 * `null`, which is the same indifference the database shows a bad credential.
 */
export function parsePublicInvitation(payload: unknown): PublicInvitation | null {
  const envelope = asObject(payload);
  if (!envelope || envelope.available !== true) return null;
  return parseInvitationObject(envelope.invitation);
}

/**
 * The document, read apart from whatever envelope carries it. Stage 7 needed this half
 * named: `api.resolve_family_review` returns the same projection nested one level deeper
 * (`{ available: true, review: { invitation: {...} } }`), and a reviewer must see exactly
 * the document a guest would, not a second parser that could drift from the first. Same
 * fields, same wholesale refusal, one implementation.
 */
export function parseInvitationObject(value: unknown): PublicInvitation | null {
  const raw = asObject(value);
  if (!raw) return null;

  const language = parseLanguage(raw.language);
  const style = parseStyle(raw.style);
  const designTemplate = parseCredit(raw.design_template, 'template_key', 'revision');
  const traditionPack = parseCredit(raw.tradition_pack, 'pack_key', 'release_number');
  const people = parseList(raw.people, parsePerson);
  const events = parseList(raw.events, parseEvent);
  const slots = [raw.welcome, raw.family_introduction, raw.event_notes, raw.closing];
  const hasSections = raw.sections !== null && raw.sections !== undefined;
  const sections = hasSections ? parseSections(raw.sections) : null;

  if (
    typeof raw.title !== 'string' ||
    language === null ||
    style === null ||
    designTemplate === null ||
    traditionPack === null ||
    people === null ||
    events === null ||
    (hasSections && sections === null) ||
    !slots.every(isText)
  ) {
    return null;
  }

  // `sections` is read apart from that chain because it is the one part a document may
  // legitimately not have: a version frozen before Stage 4 carries no section list, and
  // refusing it would blank a guest page that was correct the day it was published. A
  // *present but half-written* sections block does go through the chain — it is a v2
  // projection that stopped meaning what it says, and that is the refusal case.
  return {
    title: raw.title,
    language,
    style,
    designTemplate,
    traditionPack,
    sections,
    people,
    events,
    welcome: text(raw.welcome),
    familyIntroduction: text(raw.family_introduction),
    eventNotes: text(raw.event_notes),
    closing: text(raw.closing),
  };
}
