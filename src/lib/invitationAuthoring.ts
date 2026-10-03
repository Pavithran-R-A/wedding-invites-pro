// The server's authoring declaration and issue records, turned into a screen.
//
// This file exists so that the editor asks the database two questions and answers neither of
// them itself. "Which sections does this invitation have, in what order, and what does each one
// require?" is answered by `api.preview_invitation_document`'s `authoring` array, and "why may
// this not be frozen yet?" by its `issues` array. What is here is the *wording* of the second
// answer and the *layout* of the first, because a machine code and a `params` object are not
// something to print at a person. The rule that keeps the two layers honest is directional: a
// code selects a sentence written here, and never the other way round — no sentence is built by
// re-deriving a rule from `required` and `kind`, because a client that re-derives is a second
// implementation of the rule, and the second one is always the one that drifts.
//
// Three consequences worth stating, since each is a directive requirement and not a style choice:
//
//   * Nothing here reads a pack definition. `BUILT_IN_AUTHORING` below is derived from
//     `NO_PACK_SECTIONS`, which is the platform's own neutral section list and is already pinned
//     against `private.default_invitation_definition()` by `scripts/check-db-contract.mjs`. It is
//     the fallback for a wedding the server has not answered about yet, not a competing reading
//     of a release: as soon as the document call answers, its declaration governs.
//   * There is no branch on a pack key, a tradition, a language, a religion, a community or a
//     name — here, in the outline component that consumes these types, or in the renderer. A
//     section's `kind` says which control belongs and its `override_rule` says whether the host
//     may write it; that is the whole of the dispatch (§19's generic-UI requirement).
//   * No sentence quotes the database. A record's `params` hold values a host can act on (a
//     language tag, a count, a kind), and those are the only inputs a sentence is built from.
//     Postgres' own `message`, `details` and `hint` never reach this layer: the adapter turns a
//     refused call into one of its own phrases before anything gets here.

import type {
  AuthoringSection,
  InvitationIssue,
  SelectedReleaseSummary,
} from '@/integrations/supabase/publication';
import type { PublicInvitation } from './publicInvitation';
import { NO_PACK_SECTIONS } from './invitationSections';
import { DRAFT_SLOT_LABELS, HOST_FIELD_OF_SLOT } from './invitationDraftSlots';
import { languageLabel } from './i18n';
import {
  PACK_HOST_FIELDS,
  type PackHostField,
  type PackSectionKey,
} from './traditionPackContract';

/**
 * The declaration a wedding is drawn with before the server has answered about it.
 *
 * Every `required` is false and every prose rule is `host_may_replace`, which is exactly what
 * the database's own default definition declares — so a no-pack host sees the manual editor
 * they have always had, and a page that loads before the document call lands does not invent a
 * requirement that the release never stated.
 */
export const BUILT_IN_AUTHORING: AuthoringSection[] = NO_PACK_SECTIONS.map(section => ({
  sectionKey: section.key,
  kind: section.kind,
  position: section.position,
  required: false,
  hostField: section.hostField,
  overrideRule: section.kind === 'text' ? ('host_may_replace' as const) : null,
  requiresVenue: section.kind === 'event_list' ? false : null,
}));

/** The platform's own word for each slot. Used when a release declares no heading for it, and
 *  for nothing else: a heading the release *does* supply is the wording the host's guests will
 *  read, so the editor names the section with that instead. */
export const SECTION_LABELS: Record<PackSectionKey, string> = {
  opening: 'The opening',
  welcome: DRAFT_SLOT_LABELS.welcome,
  family_introduction: DRAFT_SLOT_LABELS.familyIntroduction,
  family: 'The people',
  couple: 'The couple',
  invitation: 'The invitation',
  ceremonies: 'The ceremonies',
  venue: 'The venue',
  event_notes: DRAFT_SLOT_LABELS.eventNotes,
  blessing: 'A blessing',
  closing: DRAFT_SLOT_LABELS.closing,
};

/** Where on the screen a finding points. `prose` carries the slot it belongs to, because two
 *  prose sections need two different fields; `release-choice` and `language` are places this
 *  page does not own, so they become a link rather than a focus. */
export type AuthoringTarget =
  | { kind: 'prose'; sectionKey: string }
  | { kind: 'group'; group: 'people' | 'venues' | 'ceremonies' }
  | { kind: 'release-choice' }
  | { kind: 'language-page' }
  | { kind: 'none' };

export interface AuthoritativeIssue {
  /** Stable for one record: used as a React key and as the anchor a jump button targets. */
  id: string;
  blocking: boolean;
  sentence: string;
  target: AuthoringTarget;
}

/** The one authoritative issue list. Blocking findings first, because they are the reason the
 *  freeze button is off; advisories after, because a host who reads only the first line of this
 *  list still learns what stands between them and a version. */
export const authoritativeIssues = (
  issues: InvitationIssue[],
  labelOf: (sectionKey: string | null) => string,
): AuthoritativeIssue[] => {
  const described = issues.map((issue, index) => describeIssue(issue, labelOf, index));
  return [...described.filter(i => i.blocking), ...described.filter(i => !i.blocking)];
};

const paramCount = (params: Record<string, unknown>, name: string): number | null => {
  const value = params[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const paramLanguage = (params: Record<string, unknown>, name: string): string | null => {
  const value = params[name];
  return typeof value === 'string' && value.trim() !== '' ? languageLabel(value) : null;
};

const paramList = (params: Record<string, unknown>, name: string): string | null => {
  const value = params[name];
  if (!Array.isArray(value)) return null;
  const labels = value.filter((item): item is string => typeof item === 'string').map(languageLabel);
  return labels.length > 0 ? labels.join(', ') : null;
};

/** The sentence for the one situation §19 calls out by name: a release whose reviewed wording
 *  stays on the page while the host's own field still holds text. It is printed twice on purpose
 *  — beside the field that holds the unused wording (`AuthoringOutline`) and in the finding list
 *  (from the server's own `host_override_not_permitted` record) — and it is written once for the
 *  same reason: two wordings of one fact is how a screen ends up reassuring a host in one place
 *  and warning them in another. Nothing in it deletes or empties anything. */
export const packTextOnlyNotice = (name: string): string =>
  `${name} keeps the wording your chosen pack supplies, whatever you wrote here earlier. Nothing you wrote has been deleted — your own line is simply not used by this release.`;

/** One record, one sentence. The `default` arm is the whole forward-compatibility story: a code
 *  this build was not told about is reported as "the server says something is missing" with its
 *  severity intact rather than dropped, because a dropped blocking finding is a freeze button
 *  that came back on for no reason the host can see. */
const describeIssue = (
  issue: InvitationIssue,
  labelOf: (sectionKey: string | null) => string,
  index: number,
): AuthoritativeIssue => {
  const base = {
    id: `${issue.code}-${issue.sectionKey ?? 'document'}-${index}`,
    blocking: issue.blocking,
  };
  const name = labelOf(issue.sectionKey);
  // A record that names a section points at that section's control; one that does not name one
  // is a fact about the document, and inventing a control to blame would send the host to a
  // field that was never the problem.
  const proseTarget: AuthoringTarget =
    issue.sectionKey === null ? { kind: 'none' } : { kind: 'prose', sectionKey: issue.sectionKey };
  const prose = { ...base, target: proseTarget };
  const document = { ...base, target: { kind: 'none' } as AuthoringTarget };

  switch (issue.messageKey) {
    case 'language_not_covered': {
      const language = paramLanguage(issue.params, 'language');
      const covers = paramList(issue.params, 'covers');
      return {
        ...document,
        target: { kind: 'release-choice' },
        sentence:
          language === null
            ? 'The language this invitation is written in is not one your chosen pack covers, so its wording cannot be drawn.'
            : covers === null
              ? `Your invitation is in ${language}, which the chosen pack does not cover.`
              : `Your invitation is in ${language}, which the chosen pack does not cover. It covers ${covers}. Choose a pack that covers it, or change the invitation language on the planning page.`,
      };
    }
    case 'contract_unsupported': {
      const version = issue.params['version'];
      return {
        ...document,
        target: { kind: 'release-choice' },
        sentence:
          typeof version === 'string' || typeof version === 'number'
            ? `The chosen pack was written against format ${String(version)}, which this build cannot read. Nothing it declares has been guessed at. Choose another pack, or write everything yourself.`
            : 'The chosen pack was written against a format this build cannot read, and nothing it declares has been guessed at. Choose another pack, or write everything yourself.',
      };
    }
    case 'kind_unrenderable':
      return {
        ...prose,
        sentence: `${name} asks for a kind of content this build cannot draw, so it will not reach your guests and it will not freeze.`,
      };
    case 'position_unorderable':
      return {
        ...prose,
        sentence: `${name} has no usable place in the order your chosen pack declares, so it cannot be drawn.`,
      };
    case 'required_text_missing': {
      const slot =
        issue.field !== null && (PACK_HOST_FIELDS as readonly string[]).includes(issue.field)
          ? DRAFT_SLOT_LABELS[HOST_FIELD_OF_SLOT[issue.field as PackHostField]]
          : null;
      return {
        ...prose,
        // A release that names its own heading gets the useful two-part sentence: the section a
        // guest reads, then the field the host has to write. On the platform's own sections the
        // two names are the same string, and repeating it would read as a sentence about two
        // places when there is only one — so it says the one thing and the jump link below
        // does the pointing.
        sentence:
          slot === null
            ? `${name} needs wording before this can be frozen, and nothing supplies it.`
            : slot === name
              ? `${name} needs wording before this can be frozen.`
              : `${name} needs wording before this can be frozen. Write it in ${slot}.`,
      };
    }
    case 'required_list_empty': {
      const kind = issue.params['kind'];
      if (kind === 'people_list') {
        return {
          ...document,
          target: { kind: 'group', group: 'people' },
          sentence: `${name} needs at least one person added before this can be frozen.`,
        };
      }
      if (kind === 'event_list') {
        return {
          ...document,
          target: { kind: 'group', group: 'ceremonies' },
          sentence: `${name} needs at least one ceremony added before this can be frozen.`,
        };
      }
      return {
        ...document,
        sentence: `${name} needs at least one entry added before this can be frozen.`,
      };
    }
    case 'event_venue_missing': {
      const missing = paramCount(issue.params, 'missing');
      return {
        ...document,
        target: { kind: 'group', group: 'venues' },
        sentence:
          missing === null
            ? 'One of your ceremonies has no venue yet, and this pack asks every ceremony to have one.'
            : `${missing} of your ceremonies have no venue yet, and this pack asks every ceremony to have one. Add a venue and attach it to each ceremony.`,
      };
    }
    case 'host_override_not_permitted':
      return { ...prose, sentence: packTextOnlyNotice(name) };
    default:
      return {
        ...prose,
        sentence: `${name} is not complete yet, and the server counts that as ${issue.blocking ? 'a reason a version cannot be frozen' : 'something to look at'}.`,
      };
  }
};

/** The section's own words for a heading, if the release supplies one. Read off the resolved
 *  document rather than the definition: this is the string a guest will read over the section,
 *  so naming the field with it cannot disagree with the canvas. */
export const headingOf = (
  invitation: PublicInvitation | null,
  sectionKey: PackSectionKey,
): string | null => {
  const item = invitation?.sections?.items.find(entry => entry.sectionKey === sectionKey);
  const heading = item?.heading?.text ?? null;
  return heading !== null && heading.trim() !== '' ? heading : null;
};

/** A section's label for a sentence: the release's heading where it declared one, the platform's
 *  word otherwise. Never the raw slot key — `event_notes` is a platform identifier, and a host
 *  reading it has been handed a column name dressed as a heading. */
export const labelForSection = (
  declaration: AuthoringSection[],
  headingLookup: (sectionKey: PackSectionKey) => string | null,
): ((sectionKey: string | null) => string) =>
  (sectionKey: string | null): string => {
    if (sectionKey === null) return 'Your invitation';
    const known = declaration.find(section => section.sectionKey === sectionKey);
    const fromDocument = headingLookup(sectionKey as PackSectionKey);
    if (fromDocument !== null) return fromDocument;
    if (known !== undefined) return SECTION_LABELS[known.sectionKey];
    return 'One of the sections';
  };

/** Whether the host may write this section. The one place that answers it, so an outline and a
 *  notice cannot disagree about the same rule. */
export const isHostEditable = (section: AuthoringSection): boolean =>
  section.kind === 'text' && section.hostField !== null && section.overrideRule !== 'pack_only';

/** Whether this finding list is a reason to keep the freeze button off. Computed from the
 *  server's own `blocking` flags and nothing else — the client does not re-check whether a
 *  section is full, because then it would be the thing the server disagrees with. */
export const hasBlockingIssue = (issues: InvitationIssue[]): boolean =>
  issues.some(issue => issue.blocking);

/**
 * Whether the invitation stands on a release the platform has retired.
 *
 * `null` is the no-pack state, which is a choice the host made rather than a standing the
 * platform changed, so it is never "an older release". The flag comes from the same document
 * read as the findings and the declaration, which is what makes it usable as a freeze gate: a
 * button held off here and a canvas showing that release's words cannot then disagree.
 *
 * This is not one of the server's `issues`. A retired release is refused by
 * `versions_pack_release_gate` at the version INSERT, so it is a real blocker rather than a
 * note — but it is not a finding about the *document*, and putting it in the authoritative list
 * would mean printing something the list's own heading ("the same check the freeze button runs")
 * does not cover. It gets its own named notice instead, and the gate still refuses on the server
 * whichever way this screen looks.
 */
export const usesRetiredRelease = (release: SelectedReleaseSummary | null): boolean =>
  release !== null && !release.isCurrent;

/** The notice for a wedding pointing at a retired release, in one sentence per guarantee: what
 *  the situation is, what does *not* change because of it, and what is therefore refused. The
 *  middle clause is the one §21 asks for in as many words — a host told their pack is out of date
 *  will otherwise assume their guests' page is about to change under them.
 *
 *  Written once because it is printed twice: by the pack panel, which is where the host reads
 *  their choice back to them, and by the publication panel, which is where the refused freeze
 *  button sits. Two wordings of one fact is how a screen ends up reassuring a host in one place
 *  and warning them in another. */
export const retiredReleaseNotice = (displayName: string, releaseNumber: number): string =>
  `This invitation uses an older release of ${displayName} — release ${releaseNumber}. ` +
  'The versions you already froze, and any link your guests are holding, keep showing exactly what ' +
  'they show now; nothing about them changes. A new version cannot be frozen from this release.';
