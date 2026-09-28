// Turns a tradition-pack release plus the host's own data into the section list a renderer
// draws, and says which wording came from where.
//
// Two rules shape this file, and both come from the Stage 4 directive.
//
// First, provenance is a fact, not a mood (§12). A section's wording is either the reviewed
// pack's or the host's. It is never "the pack's, but the host edited it" — that string would
// describe something the schema cannot establish and would read as a review covering words no
// reviewer saw. So a host field that has content *replaces* the pack's wording for that
// section, and the replacement is what the provenance records; the pack's wording is not
// returned alongside it as if it were still on the page.
//
// Second, this is the read path, so it is lenient on purpose (§13). A public invitation that
// was frozen months ago has to keep rendering after a later build adds a section slot or a
// kind, and crashing a guest's page over a definition the guest never chose would be the worst
// possible way to discover a forward-compatibility gap. Unknown kinds are therefore skipped
// with a named issue rather than thrown. `traditionPackDefinition.ts` is the strict half and
// belongs to the write path: it refuses exactly what the database refuses, because a content
// author must learn the rule before the row exists, not after a guest sees a blank card.
//
// No React, no Supabase client, no `Date`, no random values — the same input always produces
// the same output, which is what makes a frozen snapshot reproducible.

import type { PackHostField, PackSectionKey, PackSectionKind } from './traditionPackContract'
import { PACK_HOST_FIELDS, PACK_SECTION_KEYS, PACK_SECTION_KINDS } from './traditionPackContract'
import type { PackIssue } from './traditionPackDefinition'
import { asObject, text } from './jsonShape'

/** The release as it was pinned: identity, the languages it claims, and the raw definition. */
export interface TraditionPackSource {
  packKey: string
  releaseNumber: number
  languages: readonly string[]
  definition: unknown
}

/** What the host supplied for the fields a pack may read instead of carrying wording. */
export type HostFieldText = Partial<Record<PackHostField, string | null | undefined>>

/**
 * Who supplied this section's `content`. It is deliberately about the content and not the
 * section as a whole: a heading is the release's name for a slot, and a host field that has
 * text in it replaces the release's wording under that name. Reporting that as
 * "reviewed_pack, but the host edited it" would claim a review covered words no reviewer saw
 * (§12), and reporting the heading's origin as host would credit the host with the pack's
 * label. `label` therefore comes from the release whenever it is not null.
 */
export type SectionProvenance =
  | {
      source: 'reviewed_pack'
      packKey: string
      releaseNumber: number
      language: string
      /** True when the requested language was not available and `en` was used with the release's permission. */
      fallbackUsed: boolean
    }
  | {
      source: 'host'
      /** Null for a structured list, whose rows are host data the pack never supplies. */
      hostField: PackHostField | null
    }

export interface ResolvedSection {
  key: PackSectionKey
  kind: PackSectionKind
  required: boolean
  /** The section's own position in the release, kept so a caller can prove nothing reordered. */
  position: number
  label: string | null
  content: string | null
  /** The single language this section was read in; null when neither candidate served it. */
  lang: string | null
  provenance: SectionProvenance
}

export interface ResolvedTraditionPack {
  /** Sections in the release's declared order, with unreadable and unknown-kind ones removed. */
  sections: ResolvedSection[]
  issues: PackIssue[]
  /** Null when no release was selected at all — every section then reads as host content. */
  release: { packKey: string; releaseNumber: number; requestedLanguage: string } | null
}

const nonBlank = (value: unknown): string | null => {
  const asString = text(value)
  return asString !== null && asString.trim().length > 0 ? asString : null
}

const presentValue = (value: unknown): unknown => (value === null ? undefined : value)

interface RawSection {
  key: string
  position: number
  kind: string
  required: boolean
  hostField: string | null
  heading: Record<string, unknown> | null
  packText: Record<string, unknown> | null
  allowEnglishFallback: boolean
}

const readRawSection = (entry: unknown): RawSection | null => {
  const section = asObject(entry)
  if (!section) return null
  const position = section['position']
  return {
    key: text(section['section_key']) ?? '',
    position: typeof position === 'number' && Number.isFinite(position) ? position : 0,
    kind: text(section['kind']) ?? '',
    required: section['required'] === true,
    hostField: text(presentValue(section['host_field'])),
    heading: asObject(section['heading']),
    packText: asObject(section['pack_text']),
    allowEnglishFallback: section['allow_english_fallback'] === true,
  }
}


/**
 * The languages this section may be read in, best first. `en` is only ever a candidate when
 * the section asked for it, the release covers it, and the release is what the guard accepted
 * — a fallback that the database would have refused is not offered here as a courtesy.
 */
const candidateLanguages = (
  section: RawSection,
  requestedLanguage: string,
  languages: readonly string[],
): string[] => {
  const candidates: string[] = []
  if (languages.includes(requestedLanguage)) candidates.push(requestedLanguage)
  if (section.allowEnglishFallback && languages.includes('en') && !candidates.includes('en')) {
    candidates.push('en')
  }
  return candidates
}

const readFromMap = (map: Record<string, unknown> | null, language: string): string | null =>
  map === null ? null : nonBlank(map[language])

/**
 * Resolve a release against a requested language and the host's own field text.
 *
 * `source` may be null: "no tradition pack" is a first-class selection, not an error, and the
 * invitation still renders from host data with every section reported as host-sourced — which
 * is why the caller passes the section list it wants drawn even when nothing is selected.
 */
export const resolveTraditionPack = (input: {
  source: TraditionPackSource | null
  requestedLanguage: string
  hostFields?: HostFieldText
}): ResolvedTraditionPack => {
  const issues: PackIssue[] = []
  const hostFields = input.hostFields ?? {}

  const source = input.source
  if (!source) {
    // "No tradition pack" is a selection, not a failure: there is nothing to resolve, so the
    // caller draws the invitation from host data alone and no section claims a review.
    return { sections: [], issues, release: null }
  }

  const root = asObject(source.definition)
  if (!root) {
    issues.push({
      code: 'read.definition_unreadable',
      path: 'definition',
      message: 'the pinned definition is not an object, so no section of it can be read',
    })
    return { sections: [], issues, release: { packKey: source.packKey, releaseNumber: source.releaseNumber, requestedLanguage: input.requestedLanguage } }
  }

  const rawSections = Array.isArray(root['sections']) ? (root['sections'] as unknown[]) : []
  if (rawSections.length === 0) {
    issues.push({ code: 'read.no_sections', path: 'sections', message: 'the pinned definition declares no sections' })
  }

  const resolved: ResolvedSection[] = []
  for (const entry of rawSections) {
    const section = readRawSection(entry)
    if (!section) {
      issues.push({ code: 'read.section_unreadable', path: 'sections', message: 'a section in the pinned definition is not an object and was skipped' })
      continue
    }
    if (!PACK_SECTION_KEYS.includes(section.key as PackSectionKey)) {
      // The forward-compatibility case §13 names: a slot this build has nowhere to put.
      issues.push({
        code: 'read.unknown_section_skipped',
        path: `sections.${section.key || '(unnamed)'}`,
        message: `section ${section.key || '(unnamed)'} is not a slot this build renders, so it was skipped`,
      })
      continue
    }
    if (!PACK_SECTION_KINDS.includes(section.kind as PackSectionKind)) {
      issues.push({
        code: 'read.unknown_kind_skipped',
        path: `sections.${section.key}.kind`,
        message: `section ${section.key} claims kind ${section.kind || '(none)'} that no renderer knows, so it was skipped`,
      })
      continue
    }
    const kind = section.kind as PackSectionKind
    const key = section.key as PackSectionKey
    const hostField: PackHostField | null =
      section.hostField !== null && PACK_HOST_FIELDS.includes(section.hostField as PackHostField)
        ? (section.hostField as PackHostField)
        : null
    if (section.hostField !== null && hostField === null) {
      issues.push({
        code: 'read.unknown_host_field',
        path: `sections.${key}.host_field`,
        message: `section ${key} reads host field ${section.hostField}, which this build has nowhere to put`,
      })
    }

    if (kind === 'people_list' || kind === 'event_list') {
      resolved.push({
        key, kind, required: section.required, position: section.position,
        label: null, content: null, lang: null,
        provenance: { source: 'host', hostField: null },
      })
      continue
    }

    const hostText = hostField !== null ? nonBlank(hostFields[hostField]) : null

    // One language per section, so a heading in one script never sits above prose in another.
    const candidates = candidateLanguages(section, input.requestedLanguage, source.languages)
    let lang: string | null = null
    let label: string | null = null
    let packContent: string | null = null
    for (const candidate of candidates) {
      const candidateLabel = readFromMap(section.heading, candidate)
      const candidateContent = readFromMap(section.packText, candidate)
      if (candidateLabel !== null || candidateContent !== null) {
        lang = candidate
        label = candidateLabel
        packContent = candidateContent
        break
      }
    }

    const fallbackUsed = lang !== null && lang !== input.requestedLanguage

    if (hostText !== null) {
      resolved.push({
        key, kind, required: section.required, position: section.position,
        label, content: hostText, lang,
        provenance: { source: 'host', hostField },
      })
      continue
    }

    if (lang === null && (section.heading !== null || section.packText !== null)) {
      issues.push({
        code: 'read.language_unavailable',
        path: `sections.${key}`,
        message: `section ${key} has wording in none of the languages it may be read in (${[...candidates].join(', ') || 'none offered'}), and no host text replaced it`,
      })
    }

    const usingPack = label !== null || packContent !== null
    if (!usingPack && section.required) {
      issues.push({
        code: 'read.required_section_empty',
        path: `sections.${key}`,
        message: `section ${key} is required by this release but has neither pack wording that resolves nor host text to read`,
      })
    }
    resolved.push({
      key, kind, required: section.required, position: section.position,
      label, content: packContent, lang,
      provenance: usingPack
        ? { source: 'reviewed_pack', packKey: source.packKey, releaseNumber: source.releaseNumber, language: lang as string, fallbackUsed }
        : { source: 'host', hostField },
    })
  }

  return {
    sections: resolved.sort((a, b) => a.position - b.position),
    issues,
    release: { packKey: source.packKey, releaseNumber: source.releaseNumber, requestedLanguage: input.requestedLanguage },
  }
}
