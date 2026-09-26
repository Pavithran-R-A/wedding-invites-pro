// The four predicates every hand-written JSON reader in this app needs.
//
// Supabase hands the client `Json` for an RPC that returns `jsonb`, and `Json` says only
// "some JSON". Each response is therefore read by name and by type, and the reading is
// the same shape test everywhere: is this the kind of thing the database promised, or is
// this a payload from a build where that promise changed? Small enough to have no opinion
// of its own, so a response parser reads as a list of fields rather than a list of
// local helpers.

/** An object, and not an array — an array where an object was promised is a refusal. */
export const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * A value this module may treat as nullable text: a string, or the absence of one.
 * `undefined` counts as absent because the database's `jsonb_build_object` always writes
 * every key it was given, so a key that is missing was never in the projection at all.
 */
export const isText = (value: unknown): boolean =>
  value === null || value === undefined || typeof value === 'string';

export const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** A number, or the absence of one. Non-finite values are refused, not read as zero. */
export const isNumberValue = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value));

export const numberValue = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const isBooleanValue = (value: unknown): boolean =>
  value === null || value === undefined || typeof value === 'boolean';

export const booleanValue = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;
