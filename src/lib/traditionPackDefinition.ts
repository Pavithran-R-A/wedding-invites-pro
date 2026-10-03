// Reads a tradition-pack release definition the way the database reads it.
//
// `private.guard_tradition_pack_release()` is the gate that decides what may be stored, and
// it refuses one definition at a time with a message that names the rule. The client needs
// the same rules for a different purpose: a content author editing a candidate definition
// wants *every* problem in the document at once, each named by the rule that fired, so a
// refusal never arrives as "invalid JSON". Codes are stable strings, so an editor can put
// its own sentence next to each one and a test can assert a specific rule rather than the
// shape of a message.
//
// It is not written with zod even though zod is a dependency, because every interesting rule
// here is a relation between two parts of the document — a heading key against the release's
// language list, a position against the number of sections, a `pack_text` against the
// section's kind — and expressing those as schema combinators hides which relation failed
// behind a generic error tree. The predicates from `jsonShape.ts` keep the reading explicit.
//
// `scripts/check-db-contract.mjs` compares `traditionPackContract.ts` against the migration,
// so this file cannot drift into a friendlier rule set than the database enforces.

import {
  PACK_DEFINITION_KEYS,
  PACK_DESIGN_GUIDANCE_KEYS,
  PACK_EVENT_ENTRY_KEYS,
  PACK_EVENT_KEY_MAX_CHARS,
  PACK_EVENT_KEY_PATTERN,
  PACK_EVENT_VOCABULARY_MAX,
  PACK_HEADING_MAX_CHARS,
  PACK_HOST_FIELDS,
  PACK_LEAD_SIZE_MAX,
  PACK_LEAD_SIZE_MIN,
  PACK_MOTIF_MAX_CHARS,
  PACK_OVERRIDE_RULES,
  PACK_SECTION_FIELD_KEYS,
  PACK_SECTION_KINDS,
  PACK_SECTION_KEYS,
  PACK_TEXT_MAX_CHARS,
  isReadableDefinitionSchemaVersion,
  type PackHostField,
  type PackOverrideRule,
  type PackSectionKey,
  type PackSectionKind,
} from './traditionPackContract'
import { asObject, isText, text } from './jsonShape'

/** One rule that fired, on one part of the document. */
export interface PackIssue {
  code: string
  path: string
  message: string
}

export interface PackLanguageMap {
  [language: string]: string
}

export interface PackSection {
  sectionKey: PackSectionKey
  position: number
  kind: PackSectionKind
  required: boolean
  hostField: PackHostField | null
  heading: PackLanguageMap | null
  packText: PackLanguageMap | null
  allowEnglishFallback: boolean
}

export interface PackEventVocabularyEntry {
  eventKey: string
  labels: PackLanguageMap
}

export interface PackDesignGuidance {
  leadSize: number | null
  motifReference: string | null
}

export interface PackDefinition {
  schemaVersion: number
  sections: PackSection[]
  eventVocabulary: PackEventVocabularyEntry[] | null
  designGuidance: PackDesignGuidance | null
}

/**
 * A parse either yields a definition or refuses. `ok: true` carries no issues, but the type says
 * `PackIssue[]` rather than "the empty tuple" so that a caller reading `result.issues` before it
 * has branched gets a list it can render instead of `never` it cannot.
 */
export type PackParseResult =
  | { ok: true; definition: PackDefinition; issues: PackIssue[] }
  | { ok: false; definition: null; issues: PackIssue[] }

const issue = (code: string, path: string, message: string): PackIssue => ({ code, path, message })

/**
 * A key the document carries, or `null` when it is absent or explicitly JSON null — the two
 * are the same thing to the database, which tests `? key AND jsonb_typeof(key) <> 'null'`.
 */
const present = (source: Record<string, unknown>, key: string): unknown => {
  const value = source[key]
  return value === undefined || value === null ? undefined : value
}

const isBlank = (value: string): boolean => value.trim().length === 0

/**
 * A language map: an object whose keys are all covered languages and whose values are all
 * non-blank strings within `maxChars`. Mirrors the two identical halves of the heading and
 * `pack_text` rules, which differ only in their cap.
 */
const readLanguageMap = (
  raw: unknown,
  languages: readonly string[],
  maxChars: number,
  path: string,
  codeNotObject: string,
  codeLanguage: string,
  codeValue: string,
  issues: PackIssue[],
): PackLanguageMap | null => {
  const map = asObject(raw)
  if (!map) {
    issues.push(issue(codeNotObject, path, `${path} must be an object of language keys`))
    return null
  }
  const out: PackLanguageMap = {}
  for (const [lang, value] of Object.entries(map)) {
    if (!languages.includes(lang)) {
      issues.push(
        issue(codeLanguage, `${path}.${lang}`, `${path} names ${lang}, which this release does not cover`),
      )
      continue
    }
    if (!isText(value) || typeof value !== 'string' || isBlank(value) || value.length > maxChars) {
      issues.push(
        issue(codeValue, `${path}.${lang}`, `${path} for ${lang} must be a non-blank string of at most ${maxChars} characters`),
      )
      continue
    }
    out[lang] = value
  }
  return out
}

/**
 * Parse a release definition against the vocabulary this build renders and the languages the
 * release claims. `definitionSchemaVersion` is a column on the release, not a key inside the
 * definition, so it is passed in rather than read out.
 */
export const parseTraditionPackDefinition = (
  raw: unknown,
  languages: readonly string[],
  definitionSchemaVersion: number,
): PackParseResult => {
  const issues: PackIssue[] = []

  if (!isReadableDefinitionSchemaVersion(definitionSchemaVersion)) {
    return {
      ok: false,
      definition: null,
      issues: [
        issue(
          'definition.schema_version',
          'definition_schema_version',
          `definition schema version ${definitionSchemaVersion} is not understood by this build, so it cannot be validated`,
        ),
      ],
    }
  }

  const root = asObject(raw)
  if (!root) {
    return {
      ok: false,
      definition: null,
      issues: [issue('definition.not_object', 'definition', 'a release definition must be a JSON object')],
    }
  }

  const unknownRootKeys = Object.keys(root).filter((k) => !PACK_DEFINITION_KEYS.includes(k as never))
  if (unknownRootKeys.length > 0) {
    issues.push(
      issue(
        'definition.unknown_key',
        'definition',
        `a release definition carries keys this build does not understand: ${unknownRootKeys.join(', ')}`,
      ),
    )
  }

  const rawSections = present(root, 'sections')
  if (!Array.isArray(rawSections) || rawSections.length === 0) {
    issues.push(issue('sections.empty', 'sections', 'a release must declare at least one section'))
    return { ok: false, definition: null, issues }
  }

  const total = rawSections.length
  const sections: PackSection[] = []
  const seenKeys: string[] = []
  const seenPositions: number[] = []
  const seenHostFields: string[] = []
  let peopleLists = 0
  let eventLists = 0

  rawSections.forEach((entry, index) => {
    const path = `sections[${index}]`
    const section = asObject(entry)
    if (!section) {
      issues.push(issue('section.not_object', path, `${path} is not an object`))
      return
    }

    const unknownKeys = Object.keys(section).filter((k) => !PACK_SECTION_FIELD_KEYS.includes(k as never))
    if (unknownKeys.length > 0) {
      issues.push(
        issue('section.unknown_key', path, `section ${path} carries unknown keys: ${unknownKeys.join(', ')}`),
      )
    }

    const sectionKey = text(present(section, 'section_key'))
    if (sectionKey === null || !PACK_SECTION_KEYS.includes(sectionKey as PackSectionKey)) {
      issues.push(
        issue(
          'section.key_unknown',
          `${path}.section_key`,
          `section ${sectionKey ?? '(none)'} is not one of the section slots this build renders`,
        ),
      )
      return
    }
    if (seenKeys.includes(sectionKey)) {
      issues.push(issue('section.duplicate_key', `${path}.section_key`, `section_key ${sectionKey} appears twice in one release`))
      return
    }
    seenKeys.push(sectionKey)

    const position = section['position']
    if (typeof position !== 'number' || !Number.isInteger(position)) {
      issues.push(issue('section.position_not_number', `${path}.position`, `section ${sectionKey} has no numeric position`))
    } else if (position < 1 || position > total) {
      issues.push(
        issue('section.position_out_of_range', `${path}.position`, `section ${sectionKey} has position ${position} outside 1..${total}`),
      )
    } else if (seenPositions.includes(position)) {
      issues.push(issue('section.position_duplicate', `${path}.position`, `position ${position} is claimed by two sections`))
    } else {
      seenPositions.push(position)
    }

    const kind = text(present(section, 'kind'))
    if (kind === null || !PACK_SECTION_KINDS.includes(kind as PackSectionKind)) {
      issues.push(
        issue('section.kind_unknown', `${path}.kind`, `section ${sectionKey} claims kind ${kind ?? '(none)'} that no renderer knows`),
      )
      return
    }
    const listKind = kind === 'people_list' || kind === 'event_list'

    const rawHostField = present(section, 'host_field')
    if (listKind && rawHostField !== undefined) {
      issues.push(
        issue('list.host_field_forbidden', `${path}.host_field`, `section ${sectionKey} is a ${kind} and may not read a host field`),
      )
    }

    if (kind === 'people_list') {
      if (peopleLists === 1) {
        issues.push(
          issue('section.second_people_list', `${path}.kind`, `a release may declare at most one people list; section ${sectionKey} is a second`),
        )
      }
      peopleLists = 1
    }
    if (kind === 'event_list') {
      if (eventLists === 1) {
        issues.push(
          issue('section.second_event_list', `${path}.kind`, `a release may declare at most one event list; section ${sectionKey} is a second`),
        )
      }
      eventLists = 1
    }

    const required = present(section, 'required')
    if (typeof required !== 'boolean') {
      issues.push(issue('section.required_not_boolean', `${path}.required`, `section ${sectionKey} must declare required as a boolean`))
      return
    }

    let hostField: PackHostField | null = null
    if (rawHostField !== undefined && !listKind) {
      const candidate = text(rawHostField)
      if (candidate === null || !PACK_HOST_FIELDS.includes(candidate as PackHostField)) {
        issues.push(
          issue('host_field.unknown', `${path}.host_field`, `section ${sectionKey} reads unknown host field ${String(rawHostField)}`),
        )
      } else if (seenHostFields.includes(candidate)) {
        issues.push(issue('host_field.duplicate', `${path}.host_field`, `two sections read host field ${candidate}`))
      } else {
        seenHostFields.push(candidate)
        hostField = candidate as PackHostField
      }
    }

    // Stage 5's two authoring rules, mirrored from the guard clause for clause. The client is
    // not the authority — the write is refused by the database either way — but an author who
    // learns a rule only from a rejected save has been told nothing about which of the two
    // declarations disagree, and that is the difference between a fix and a retry.
    const rawOverrideRule = present(section, 'override_rule')
    const rawRequiresVenue = present(section, 'requires_venue')
    if (definitionSchemaVersion === 1
        && (rawOverrideRule !== undefined || rawRequiresVenue !== undefined)) {
      issues.push(
        issue(
          'section.v2_key_on_v1_definition',
          path,
          `section ${sectionKey} declares override_rule or requires_venue on a version-1 `
            + 'definition, which claims the older contract while depending on the newer one',
        ),
      )
    }
    if (rawOverrideRule !== undefined && definitionSchemaVersion !== 1) {
      const candidate = text(rawOverrideRule)
      if (candidate === null || !PACK_OVERRIDE_RULES.includes(candidate as PackOverrideRule)) {
        issues.push(
          issue(
            'override_rule.unknown',
            `${path}.override_rule`,
            `section ${sectionKey} declares override_rule ${String(rawOverrideRule)}, which is `
              + 'not one of host_may_replace, pack_only or host_must_supply',
          ),
        )
      } else if (listKind) {
        issues.push(
          issue(
            'override_rule.on_list_section',
            `${path}.override_rule`,
            `section ${sectionKey} is a ${kind} and has no reviewed wording for an override `
              + 'rule to govern',
          ),
        )
      } else if (candidate === 'host_must_supply') {
        if (present(section, 'pack_text') !== undefined) {
          issues.push(
            issue(
              'override_rule.host_must_supply_offers_text',
              `${path}.pack_text`,
              `section ${sectionKey} must be written by the host but this release offers `
                + 'wording for it anyway',
            ),
          )
        }
        if (hostField === null) {
          issues.push(
            issue(
              'override_rule.host_must_supply_unfillable',
              `${path}.host_field`,
              `section ${sectionKey} must be written by the host but reads no host field, so `
                + 'nobody could supply it',
            ),
          )
        }
      } else if (candidate === 'pack_only' && present(section, 'pack_text') === undefined) {
        issues.push(
          issue(
            'override_rule.pack_only_without_text',
            `${path}.pack_text`,
            `section ${sectionKey} may not be overridden but carries no reviewed wording to `
              + 'show instead',
          ),
        )
      }
    }
    if (rawRequiresVenue !== undefined && definitionSchemaVersion !== 1) {
      if (typeof rawRequiresVenue !== 'boolean') {
        issues.push(
          issue('requires_venue.not_boolean', `${path}.requires_venue`,
            `section ${sectionKey} must declare requires_venue as a boolean`),
        )
      } else if (kind !== 'event_list') {
        issues.push(
          issue('requires_venue.on_non_event_list', `${path}.requires_venue`,
            `section ${sectionKey} is a ${kind} and does not draw events, so it cannot require a venue`),
        )
      }
    }

    const fallback = present(section, 'allow_english_fallback')
    if (fallback !== undefined && typeof fallback !== 'boolean') {
      issues.push(
        issue('fallback.not_boolean', `${path}.allow_english_fallback`, `section ${sectionKey} must declare allow_english_fallback as a boolean`),
      )
    }
    const allowEnglishFallback = fallback === true
    if (allowEnglishFallback && !languages.includes('en')) {
      issues.push(
        issue(
          'fallback.language_not_covered',
          `${path}.allow_english_fallback`,
          `section ${sectionKey} allows an English fallback but this release does not cover en`,
        ),
      )
    }

    let heading: PackLanguageMap | null = null
    const rawHeading = present(section, 'heading')
    if (rawHeading !== undefined) {
      heading = readLanguageMap(
        rawHeading, languages, PACK_HEADING_MAX_CHARS, `${path}.heading`,
        'heading.not_object', 'heading.language_not_covered', 'heading.value_invalid', issues,
      )
    }

    let packText: PackLanguageMap | null = null
    const rawPackText = present(section, 'pack_text')
    if (rawPackText !== undefined) {
      if (listKind) {
        issues.push(
          issue('pack_text.on_list_kind', `${path}.pack_text`, `section ${sectionKey} is a ${kind} and cannot carry reviewed wording`),
        )
      } else {
        packText = readLanguageMap(
          rawPackText, languages, PACK_TEXT_MAX_CHARS, `${path}.pack_text`,
          'pack_text.not_object', 'pack_text.language_not_covered', 'pack_text.value_invalid', issues,
        )
      }
    }

    if (kind === 'text' && heading === null && packText === null && hostField === null) {
      issues.push(
        issue('section.says_nothing', path, `section ${sectionKey} says nothing: no heading, no reviewed wording, no host field`),
      )
      return
    }

    sections.push({
      sectionKey: sectionKey as PackSectionKey,
      position: typeof position === 'number' ? position : 0,
      kind: kind as PackSectionKind,
      required,
      hostField,
      heading,
      packText,
      allowEnglishFallback,
    })
  })

  let eventVocabulary: PackEventVocabularyEntry[] | null = null
  const rawVocabulary = present(root, 'event_vocabulary')
  if (rawVocabulary !== undefined) {
    if (!Array.isArray(rawVocabulary)) {
      issues.push(issue('event_vocabulary.not_array', 'event_vocabulary', 'event_vocabulary must be an array'))
    } else if (rawVocabulary.length > PACK_EVENT_VOCABULARY_MAX) {
      issues.push(
        issue('event_vocabulary.too_many', 'event_vocabulary', `event_vocabulary must be an array of at most ${PACK_EVENT_VOCABULARY_MAX} entries`),
      )
    } else {
      eventVocabulary = []
      rawVocabulary.forEach((entry, index) => {
        const path = `event_vocabulary[${index}]`
        const item = asObject(entry)
        if (!item) {
          issues.push(issue('event_vocabulary.entry_not_object', path, `${path} is not an object`))
          return
        }
        const unknown = Object.keys(item).filter((k) => !PACK_EVENT_ENTRY_KEYS.includes(k as never))
        if (unknown.length > 0) {
          issues.push(issue('event_vocabulary.unknown_key', path, `${path} carries an unknown key: ${unknown.join(', ')}`))
          return
        }
        const eventKey = text(present(item, 'event_key'))
        if (eventKey === null || !PACK_EVENT_KEY_PATTERN.test(eventKey) || eventKey.length > PACK_EVENT_KEY_MAX_CHARS) {
          issues.push(
            issue('event_vocabulary.event_key_not_slug', `${path}.event_key`, `${path} needs a slug event_key of at most ${PACK_EVENT_KEY_MAX_CHARS} characters`),
          )
          return
        }
        const labels = readLanguageMap(
          present(item, 'labels'), languages, PACK_HEADING_MAX_CHARS, `${path}.labels`,
          'event_vocabulary.labels_not_object', 'event_vocabulary.language_not_covered', 'event_vocabulary.label_invalid', issues,
        )
        if (!labels || Object.keys(labels).length === 0) {
          if (!labels) return
          issues.push(issue('event_vocabulary.labels_empty', `${path}.labels`, `${path} declares no label in any covered language`))
          return
        }
        eventVocabulary?.push({ eventKey, labels })
      })
    }
  }

  let designGuidance: PackDesignGuidance | null = null
  const rawGuidance = present(root, 'design_guidance')
  if (rawGuidance !== undefined) {
    const guidance = asObject(rawGuidance)
    if (!guidance) {
      issues.push(issue('design_guidance.not_object', 'design_guidance', 'design_guidance must be an object'))
    } else {
      const unknown = Object.keys(guidance).filter((k) => !PACK_DESIGN_GUIDANCE_KEYS.includes(k as never))
      if (unknown.length > 0) {
        issues.push(
          issue('design_guidance.unknown_key', 'design_guidance', `design_guidance carries a key this build does not understand: ${unknown.join(', ')}`),
        )
      } else {
        const leadSize = present(guidance, 'lead_size')
        const motif = present(guidance, 'motif_reference')
        let leadOk = true
        let motifOk = true
        if (leadSize !== undefined) {
          if (typeof leadSize !== 'number' || !Number.isFinite(leadSize) || leadSize < PACK_LEAD_SIZE_MIN || leadSize > PACK_LEAD_SIZE_MAX) {
            issues.push(
              issue('design_guidance.out_of_range', 'design_guidance.lead_size', `lead_size must be a number between ${PACK_LEAD_SIZE_MIN} and ${PACK_LEAD_SIZE_MAX}`),
            )
            leadOk = false
          }
        }
        if (motif !== undefined) {
          if (!isText(motif) || typeof motif !== 'string' || isBlank(motif) || motif.length > PACK_MOTIF_MAX_CHARS) {
            issues.push(
              issue('design_guidance.out_of_range', 'design_guidance.motif_reference', `motif_reference must be a short string of at most ${PACK_MOTIF_MAX_CHARS} characters`),
            )
            motifOk = false
          }
        }
        if (leadOk && motifOk) {
          designGuidance = {
            leadSize: typeof leadSize === 'number' ? leadSize : null,
            motifReference: typeof motif === 'string' ? motif : null,
          }
        }
      }
    }
  }

  if (issues.length > 0) return { ok: false, definition: null, issues }

  return {
    ok: true,
    definition: { schemaVersion: definitionSchemaVersion, sections, eventVocabulary, designGuidance },
    issues: [],
  }
}
