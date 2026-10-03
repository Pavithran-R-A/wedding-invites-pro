// One place that decides what a client error may be turned into.
//
// PostgREST answers an RPC failure with `message`, `details`, `hint` and `code`. The
// first three are written by Postgres and name tables, columns, constraints and
// policies — accurate descriptions of the database, addressed to whoever happens to be
// watching, which for a browser app is the visitor's own developer tools and, for a
// shared link, potentially a guest. So nothing on the data path puts that prose in front
// of a user: pages show the short phrase their adapter chose, and the only thing this
// mapper adds is a category and an error code, which are stable identifiers rather than
// a description of the schema.
//
// One surface is outside this file, by decision rather than by oversight: the three auth
// screens show the message Supabase Auth returns (`Login failed`, `Signup failed`,
// `Reset failed`). Those sentences are authored by GoTrue for the person signing in —
// "Invalid login credentials", "Email not confirmed" — and they describe an authentication
// outcome, not the schema, so replacing them with a fixed phrase would lose the only
// information that tells a host what they got wrong. §33's independent review found the
// earlier wording of this comment (`no part of this project`) claimed more than the code
// did; the claim is now the one the code holds, and the exception is named where a reader
// would look for it.
//
// The code is kept because it is the difference between "this user may not do that" and
// "the stack was unreachable" — a support question nobody can answer from a fixed
// phrase, and a fact that does not leak anything to name.

/** The categories the app can tell apart, and nothing else. */
export type FailureKind = 'forbidden' | 'rejected' | 'unreachable' | 'unexpected';

interface Shaped {
  code?: unknown;
  name?: unknown;
}

/**
 * `42501` is a grant or RLS refusal; `PGRST*` is the API surface itself (a function
 * that is not exposed, or called with the wrong arguments). `23xxx`/`22xxx`/`23503` are
 * the database's own rules about the data — a CHECK, a unique index, a foreign key —
 * which means the write the app attempted is one the schema refuses. Everything else,
 * including a `TypeError` from a fetch that never reached the server, is unreachable or
 * unexpected, and the two are separated only by whether the transport failed.
 */
export function classify(error: unknown): FailureKind {
  if (error === null || typeof error !== 'object') return 'unexpected';
  const { code, name } = error as Shaped;
  if (typeof code === 'string') {
    if (code === '42501' || code === 'PGRST106' || code === 'PGRST202' || code === 'PGRST205') {
      return 'forbidden';
    }
    if (/^2[23]/.test(code)) return 'rejected';
  }
  if (typeof name === 'string' && (name === 'TypeError' || name === 'AbortError')) return 'unreachable';
  return 'unexpected';
}

/** The error's own code, if it has a printable one. Nothing else about the error is
 *  carried forward. */
export const codeOf = (error: unknown): string => {
  if (error === null || typeof error !== 'object') return 'none';
  const code = (error as Shaped).code;
  return typeof code === 'string' && /^[A-Za-z0-9]{3,9}$/.test(code) ? code : 'none';
};

/**
 * A single log line: the phrase the caller is already showing the user, plus the
 * category and code that tell a maintainer which of the four kinds of failure this was.
 * `context` is the caller's own words, never the server's.
 */
export const describe = (module: string, context: string, error: unknown): string =>
  `[${module}] ${context} (${classify(error)}, code ${codeOf(error)})`;
