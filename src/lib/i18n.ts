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
