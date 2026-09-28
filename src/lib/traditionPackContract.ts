// The vocabulary a tradition-pack release is allowed to name, copied from the database.
//
// `private.guard_tradition_pack_release()` in
// `supabase/migrations/20260927120000_stage4_tradition_pack_releases.sql` is the authority:
// it refuses a definition whose section key, kind or host field is not on one of these lists,
// so a client that accepted a different list would be writing rows the database is about to
// reject. The lists are duplicated here because the client cannot ask Postgres mid-form, and
// `scripts/check-db-contract.mjs` fails the build if the two ever differ — a duplicate with
// no checker beside it is a second source of truth wearing a first's clothes.
//
// Two properties of the database list carry over deliberately. The section keys are *product
// slots* the app already has a place to put, so a closed set is what makes "a pack can reorder
// and refill an invitation without a code change" true while "a pack can invent a section
// nobody renders" stays false. And no name here refers to a rite, a community, a deity or a
// caste: the vocabulary describes where content goes, not what a tradition holds. Adding a
// slot is a code change with a renderer beside it, never a content write.

/** The one definition contract version this build reads. */
export const TRADITION_PACK_DEFINITION_SCHEMA_VERSION = 1

/** Top-level keys a definition may carry. Anything else is a key nobody specified. */
export const PACK_DEFINITION_KEYS = ['sections', 'event_vocabulary', 'design_guidance'] as const

/** Keys one section object may carry. */
export const PACK_SECTION_FIELD_KEYS = [
  'section_key',
  'position',
  'kind',
  'required',
  'host_field',
  'heading',
  'pack_text',
  'allow_english_fallback',
] as const

/** The section slots this build renders, in no meaningful order. */
export const PACK_SECTION_KEYS = [
  'opening',
  'welcome',
  'family_introduction',
  'family',
  'couple',
  'invitation',
  'ceremonies',
  'venue',
  'event_notes',
  'blessing',
  'closing',
] as const

/**
 * How a section is filled. `text` may carry reviewed wording or read a host field;
 * `people_list` and `event_list` are structured and so may carry neither.
 */
export const PACK_SECTION_KINDS = ['text', 'people_list', 'event_list'] as const

/**
 * Wedding fields a host owns and a pack section may read instead of supplying wording.
 * A list kind never appears with one of these.
 */
export const PACK_HOST_FIELDS = [
  'welcome',
  'family_introduction',
  'event_notes',
  'closing',
] as const

export const PACK_HEADING_MAX_CHARS = 160
export const PACK_TEXT_MAX_CHARS = 4_000
export const PACK_EVENT_VOCABULARY_MAX = 50
export const PACK_EVENT_KEY_MAX_CHARS = 40
export const PACK_MOTIF_MAX_CHARS = 200
export const PACK_LEAD_SIZE_MIN = 8
export const PACK_LEAD_SIZE_MAX = 72

/** Keys one `event_vocabulary` entry may carry. */
export const PACK_EVENT_ENTRY_KEYS = ['event_key', 'labels'] as const

/** Keys one `design_guidance` object may carry. */
export const PACK_DESIGN_GUIDANCE_KEYS = ['lead_size', 'motif_reference'] as const

/** A slug, as the database spells it: lowercase, digit or underscore, starting with a letter. */
export const PACK_EVENT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/

export type PackDefinitionKey = (typeof PACK_DEFINITION_KEYS)[number]
export type PackSectionFieldKey = (typeof PACK_SECTION_FIELD_KEYS)[number]
export type PackSectionKey = (typeof PACK_SECTION_KEYS)[number]
export type PackSectionKind = (typeof PACK_SECTION_KINDS)[number]
export type PackHostField = (typeof PACK_HOST_FIELDS)[number]
