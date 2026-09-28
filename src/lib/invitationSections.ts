// The ordered list a renderer draws, from whatever shape the frozen document arrived in.
//
// This is the seam directive §13 asks for. The guest projection can hand back two things: a
// v2 document that carries `sections.items` — the release's own order, headings and wording,
// resolved once at freeze time — or a v1 document that carries only the four flat prose slots
// plus the people and event lists, because no section list existed when it was frozen. A
// renderer that read both shapes directly would have to know which stage produced the page,
// and a page that knows the stage that produced it is a page that branches per stage. So the
// two readings happen here, once, and everything downstream sees one kind of thing: an
// ordered array of sections, each with a `kind`, a heading it may not have, content it may
// not have, and a region of the paper it sits on.
//
// No-pack path. `NO_PACK_SECTIONS` below is a copy of `private.default_invitation_definition()`
// in `supabase/migrations/20260927120000_stage4_tradition_pack_releases.sql`, which is what a
// wedding with no tradition pack resolves against in the database. Copying it is the point:
// Stage 3's neutral ordering (welcome, family introduction, people, ceremonies, notes,
// closing) becomes a *section list* rather than a hand-written run of JSX, so the no-pack
// page and a packed page go through the same loop, and the difference between them is data
// the host or a content author chose — not an `if`. `scripts/check-db-contract.mjs` fails the
// build if the two copies ever differ.
//
// What this file never does is look at *who* the wedding is. There is no branch on a pack key,
// a language, a religion, a community or a name here or in the renderer, because directive
// §13 forbids exactly that: a section's `kind` says how to draw it and its `key` says where on
// the paper it sits, and nothing else about a tradition reaches layout. The dispatch is
// therefore two-dimensional and finite — `kind` (what to draw) and `region` (which wrapper) —
// and a release that reorders, renames or refills an invitation does it with rows.
//
// Forward compatibility (§13's "unknown future section"). An unfamiliar `kind` or an
// unfamiliar `section_key` is skipped and named in `issues`; it does not throw and does not
// take the page down. The visitor holding a link published by a newer build cannot be
// upgraded, and nine tenths of an invitation with a preview that says which tenth this build
// cannot place is the honest outcome. A *hostile* value (a number where the projection
// promised text) is refused a layer earlier, in `publicInvitation.ts`, which returns `null`
// for the whole payload.
//
// Provenance is carried and not printed. §12 makes a host's replacement of pack wording
// `source: 'host'` and never "the pack's, edited"; that fact belongs to the host's own view of
// their document, so it is returned here for the editor to show and the renderer draws no
// badge, no reviewer label and no release number.

import type { PackHostField, PackSectionKey } from './traditionPackContract';
import { PACK_HOST_FIELDS, PACK_SECTION_KEYS } from './traditionPackContract';
import type { InvitationSection, PublicInvitation } from './publicInvitation';

/** The three drawing rules this build implements, copied from the same database list the
 *  release guard reads (`kind` is checked there at write time too). */
export const RENDER_SECTION_KINDS = ['text', 'people_list', 'event_list'] as const;

export type RenderSectionKind = (typeof RENDER_SECTION_KINDS)[number];

/** Which part of the paper a section sits on. `opening` sections are the lead prose under the
 *  title; `closing` is the sign-off; `body` is everything between the rules. */
export type RenderRegion = 'opening' | 'body' | 'closing';

/**
 * Who supplied this section's `content`. Same three-way distinction the resolver makes, and
 * for the same reason (§12): the wording is either the reviewed release's or the host's, and
 * a value this build was not told about is reported as unknown rather than folded into
 * whichever of the two would look least alarming.
 */
export type RenderProvenance =
  | { source: 'reviewed_pack'; language: string | null; fallbackUsed: boolean }
  | { source: 'host'; hostField: PackHostField | null; overrodePackText: boolean }
  | { source: 'unknown'; reported: string }
  | { source: 'none' };

export interface RenderSection {
  /** The platform slot this section fills. Never printed — it is an identifier, like
   *  `role_key` and `event_key` beside it. */
  key: PackSectionKey | null;
  kind: RenderSectionKind;
  region: RenderRegion;
  /** The release's own position, kept so a caller can show nothing reordered. */
  position: number | null;
  required: boolean;
  heading: string | null;
  content: string | null;
  provenance: RenderProvenance;
}

export interface RenderIssue {
  code: string;
  path: string;
  message: string;
}

export interface NormalizedInvitation {
  /** The language the frozen wedding asked for, so a preview can name a substitution in the
   *  host's own words. Null on a v1 document, which recorded no such request. */
  requested: string | null;
  /** In the order to draw: the projection's order for a v2 document, the declared order for
   *  a no-pack one. Sections this build cannot place are already removed. */
  sections: RenderSection[];
  /** What was skipped, and why. Empty for a document this build can fully honour. */
  issues: RenderIssue[];
}

/** Where each slot of the platform's vocabulary sits on the paper. A slot this build does not
 *  know is skipped before its region matters, so the table needs no fallback entry. */
const REGION_BY_SLOT: Record<PackSectionKey, RenderRegion> = {
  opening: 'opening',
  welcome: 'opening',
  family_introduction: 'opening',
  invitation: 'opening',
  family: 'body',
  couple: 'body',
  ceremonies: 'body',
  venue: 'body',
  event_notes: 'body',
  blessing: 'body',
  closing: 'closing',
};

/** One entry of `private.default_invitation_definition()`, in that function's order.
 *
 *  `headingEnglish` is the platform's own word for the slot, in the one language the platform
 *  wrote it — the string Stage 3's renderer printed unconditionally. The database's default
 *  definition declares no English fallback for it, and `private.pack_text_for` therefore
 *  withholds it from an invitation whose language is not English; that is asserted by the
 *  Stage 4 battery (`50_pack_release.sql`, the group that resolves the default definition in
 *  `ta`), and it is the reason this copy resolves the heading instead of printing it. A
 *  Tamil page no longer shows an English heading nobody authored, and a fresh no-pack page
 *  and a legacy one now agree with each other as well as with the database. */
export const NO_PACK_SECTIONS: ReadonlyArray<{
  key: PackSectionKey;
  position: number;
  kind: RenderSectionKind;
  hostField: PackHostField | null;
  headingEnglish: string | null;
}> = [
  { key: 'welcome', position: 1, kind: 'text', hostField: 'welcome', headingEnglish: null },
  { key: 'family_introduction', position: 2, kind: 'text', hostField: 'family_introduction', headingEnglish: null },
  { key: 'family', position: 3, kind: 'people_list', hostField: null, headingEnglish: null },
  { key: 'ceremonies', position: 4, kind: 'event_list', hostField: null, headingEnglish: 'The ceremonies' },
  { key: 'event_notes', position: 5, kind: 'text', hostField: 'event_notes', headingEnglish: null },
  { key: 'closing', position: 6, kind: 'text', hostField: 'closing', headingEnglish: null },
];

/** The single language the platform's own slot words are written in. */
const PLATFORM_LANGUAGE = 'en';

const nonBlank = (value: string | null): string | null =>
  value !== null && value.trim() !== '' ? value : null;

const asSlot = (value: string | null): PackSectionKey | null =>
  value !== null && PACK_SECTION_KEYS.includes(value as PackSectionKey) ? (value as PackSectionKey) : null;

const asKind = (value: string | null): RenderSectionKind | null =>
  value !== null && RENDER_SECTION_KINDS.includes(value as RenderSectionKind)
    ? (value as RenderSectionKind)
    : null;

const asHostField = (value: string | null): PackHostField | null =>
  value !== null && PACK_HOST_FIELDS.includes(value as PackHostField) ? (value as PackHostField) : null;

/** The host's own words for a slot, on a document that has no section list. */
const FLAT_SLOT_TEXT: Record<'welcome' | 'family_introduction' | 'event_notes' | 'closing', keyof PublicInvitation> = {
  welcome: 'welcome',
  family_introduction: 'familyIntroduction',
  event_notes: 'eventNotes',
  closing: 'closing',
};

/**
 * A v1 document: four prose slots, a people list and an event list, and no record of an
 * order. `NO_PACK_SECTIONS` supplies the order the platform has always used, which is the
 * same list the database's own default definition resolves today, so a legacy page and a
 * freshly-created no-pack page now go through the same loop in the same sequence.
 */
const normalizeFlatInvitation = (invitation: PublicInvitation): RenderSection[] => {
  // The language the resolution would have been asked for, not the language the host happened
  // to record: the snapshot build calls `resolve_invitation_sections` with
  // `COALESCE(primary_language, 'en')`, because a wedding that never chose a language has no
  // pack text to resolve *for a language nobody picked* and the platform's own copy is
  // English. A page that treated the null as its own case would withhold a heading the
  // database wrote.
  const requested = invitation.language.primary ?? PLATFORM_LANGUAGE;
  return NO_PACK_SECTIONS.map((entry) => {
    const content =
      entry.kind === 'text' && entry.hostField !== null
        ? nonBlank(invitation[FLAT_SLOT_TEXT[entry.hostField]] as string | null)
        : null;
    const heading =
      entry.headingEnglish !== null && requested === PLATFORM_LANGUAGE ? entry.headingEnglish : null;
    return {
      key: entry.key,
      kind: entry.kind,
      region: REGION_BY_SLOT[entry.key],
      position: entry.position,
      // False by fact rather than by default: a v1 document declares no requirement, and a
      // slot the platform always drew stayed drawable even when empty.
      required: false,
      heading,
      content,
      provenance:
        entry.kind === 'text' && entry.hostField !== null
          ? content !== null
            ? { source: 'host', hostField: entry.hostField, overrodePackText: false }
            : { source: 'none' }
          : { source: 'none' },
    };
  });
};

/**
 * One v2 section, or the reason it is not in the list. An unknown `kind` or `section_key`
 * arrives as an issue naming the value it carries, because "skipped" without the word that
 * caused it would leave a content author hunting through a definition for a spelling mistake.
 */
const normalizeResolvedSection = (
  item: InvitationSection,
  index: number,
  counts: { people: number; events: number },
  issues: RenderIssue[],
): RenderSection | null => {
  const kind = asKind(item.kind);
  if (kind === null) {
    issues.push({
      code: 'render.unknown_kind_skipped',
      path: `sections.items[${index}]`,
      message: `section ${item.sectionKey ?? '(unnamed)'} claims kind ${item.kind ?? '(none)'}, which no renderer in this build knows, so it was skipped`,
    });
    return null;
  }
  const key = asSlot(item.sectionKey);
  if (key === null) {
    issues.push({
      code: 'render.unknown_slot_skipped',
      path: `sections.items[${index}]`,
      message: `section ${item.sectionKey ?? '(unnamed)'} is not a slot this build has a place for, so it was skipped`,
    });
    return null;
  }

  const hostField = asHostField(item.hostField);
  if (item.hostField !== null && hostField === null) {
    issues.push({
      code: 'render.unknown_host_field',
      path: `sections.items[${index}]`,
      message: `section ${key} reads host field ${item.hostField}, which this build has nowhere to put`,
    });
  }

  const heading = nonBlank(item.heading?.text ?? null);
  const bodyText = nonBlank(item.body?.text ?? null);
  const reportedSource = item.body?.source ?? null;

  let provenance: RenderProvenance;
  if (item.body === null || reportedSource === null) {
    provenance = { source: 'none' };
  } else if (reportedSource === 'host') {
    provenance = {
      source: 'host',
      hostField,
      overrodePackText: item.body.overrodePackText === true,
    };
  } else if (reportedSource === 'reviewed_pack') {
    provenance = {
      source: 'reviewed_pack',
      language: item.body.language,
      fallbackUsed: item.body.fallbackUsed === true,
    };
  } else {
    // A provenance word from a newer projection. The text is still text and still gets
    // drawn; what this build refuses to do is guess which review covers it.
    provenance = { source: 'unknown', reported: reportedSource };
    issues.push({
      code: 'render.unknown_provenance',
      path: `sections.items[${index}].body.source`,
      message: `section ${key} reports provenance ${reportedSource}, which this build does not know, so its wording is drawn without a provenance claim`,
    });
  }

  if (item.required === true && kind === 'text' && heading === null && bodyText === null) {
    issues.push({
      code: 'render.required_section_empty',
      path: `sections.items[${index}]`,
      message: `section ${key} is required by this release and resolved to no wording, so nothing is drawn where a guest should read it`,
    });
  }
  if (item.required === true && kind === 'people_list' && counts.people === 0) {
    issues.push({
      code: 'render.required_list_empty',
      path: `sections.items[${index}]`,
      message: `section ${key} is required by this release and the frozen document holds no people to draw`,
    });
  }
  if (item.required === true && kind === 'event_list' && counts.events === 0) {
    issues.push({
      code: 'render.required_list_empty',
      path: `sections.items[${index}]`,
      message: `section ${key} is required by this release and the frozen document holds no ceremonies to draw`,
    });
  }

  return {
    key,
    kind,
    region: REGION_BY_SLOT[key],
    position: item.position,
    required: item.required === true,
    heading,
    content: kind === 'text' ? bodyText : null,
    provenance,
  };
};

/**
 * Turn a parsed invitation into the list to draw, and say what could not be drawn.
 *
 * Pure and deterministic: the same frozen document always produces the same output, which is
 * what makes a guest page reproducible from its snapshot alone.
 */
export const normalizeInvitationSections = (invitation: PublicInvitation): NormalizedInvitation => {
  if (invitation.sections === null) {
    return { requested: null, sections: normalizeFlatInvitation(invitation), issues: [] };
  }

  const issues: RenderIssue[] = [];
  const sections: RenderSection[] = [];
  const counts = { people: invitation.people.length, events: invitation.events.length };
  invitation.sections.items.forEach((item, index) => {
    const section = normalizeResolvedSection(item, index, counts, issues);
    // The projection's array order is the order the document was frozen in; it is kept rather
    // than re-derived from `position`, so a tie or a gap in a hand-written definition cannot
    // silently reorder a guest's page.
    if (section !== null) sections.push(section);
  });

  return { requested: invitation.sections.requested, sections, issues };
};
