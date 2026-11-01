export type Language = 'en' | 'ta' | 'te' | 'kn' | 'ml';

// Ordered by rollout priority: English, then Tamil, Telugu, Malayalam, Kannada.
export const LANGUAGES: { code: Language; label: string; nativeLabel: string }[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்' },
  { code: 'te', label: 'Telugu', nativeLabel: 'తెలుగు' },
  { code: 'ml', label: 'Malayalam', nativeLabel: 'മലയാളം' },
  { code: 'kn', label: 'Kannada', nativeLabel: 'ಕನ್ನಡ' },
];

/** A language code spoken in the words this platform uses for it. An unfamiliar code prints as
 *  itself rather than as nothing: a release that claims a language this build has never heard of
 *  still claims it, and renaming that away would be this file's invention. */
export const languageLabel = (code: string): string =>
  LANGUAGES.find(language => language.code === code)?.label ?? code;

/**
 * The one sentence a language option may need beside it in a picker: whether a reviewed pack in this
 * build speaks that language at all.
 *
 * Why this belongs next to `LANGUAGES` rather than inside one page: the list above is a rollout plan
 * (five languages the platform intends to speak) and the pack catalogue is the present fact. A host who
 * writes in a language no release speaks gets no reviewed wording for it, and if they then attach a
 * release, the freeze door compares the wedding's `primary_language` against the languages of the
 * release pinned in the snapshot and raises a blocking `language_not_covered` finding
 * (`supabase/migrations/20260929120000_stage5_pack_driven_authoring_review.sql:1095`).
 *
 * What this sentence must NOT say is that the invitation cannot be published. The same arm reads the
 * pinned release's `languages` first (`:1071`) and only fires when that value is an array (`:1090`), so a
 * snapshot with no pack raises nothing — and Stage 5's journey A measured exactly that path through the
 * shipped UI to a live guest link (`docs/audits/stage-5-pack-driven-authoring-review.md` §25). So the
 * honest limit is about reviewed pack wording, not about the draft's future.
 *
 * `coverage` is the union of the `languages` arrays of the releases this build can select, read through
 * the same door the editor's pack panel reads (`listSelectableTraditionReleases`), so the two screens
 * cannot disagree about what exists. Three answers, because `null` is a real third state: coverage could
 * not be read. A page that does not know must not print "no pack speaks this" — that would be this
 * file's invention, and it would be a refusal the server never made.
 */
export const packCoverageWords = (
  code: string,
  coverage: ReadonlySet<string> | null,
): string | null => {
  if (coverage === null) return null;
  if (coverage.has(code)) return null;
  return 'No reviewed pack in this build speaks this language. Your own wording can still be written and '
    + 'published in it; attaching a reviewed pack to it is what this build cannot do until one speaks it.';
};
