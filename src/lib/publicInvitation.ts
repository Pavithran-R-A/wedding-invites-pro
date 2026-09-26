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

import { asObject, isNumberValue, isText, numberValue, text } from './jsonShape';

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

const parseCredit = (value: unknown, keyName: string): InvitationCredit | null => {
  if (value === null || value === undefined) return { displayName: null, key: null, revision: null };
  const raw = asObject(value);
  if (!raw || !isText(raw.display_name) || !isNumberValue(raw.revision)) return null;
  if (!isText(raw[keyName])) return null;
  return {
    displayName: text(raw.display_name),
    key: text(raw[keyName]),
    revision: numberValue(raw.revision),
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

  const raw = asObject(envelope.invitation);
  if (!raw) return null;

  const language = parseLanguage(raw.language);
  const style = parseStyle(raw.style);
  const designTemplate = parseCredit(raw.design_template, 'template_key');
  const traditionPack = parseCredit(raw.tradition_pack, 'pack_key');
  const people = parseList(raw.people, parsePerson);
  const events = parseList(raw.events, parseEvent);
  const slots = [raw.welcome, raw.family_introduction, raw.event_notes, raw.closing];

  if (
    typeof raw.title !== 'string' ||
    language === null ||
    style === null ||
    designTemplate === null ||
    traditionPack === null ||
    people === null ||
    events === null ||
    !slots.every(isText)
  ) {
    return null;
  }

  return {
    title: raw.title,
    language,
    style,
    designTemplate,
    traditionPack,
    people,
    events,
    welcome: text(raw.welcome),
    familyIntroduction: text(raw.family_introduction),
    eventNotes: text(raw.event_notes),
    closing: text(raw.closing),
  };
}
