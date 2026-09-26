// The guest's one door: one function, one header, no session.
//
// Directive §X says the public page may call nothing else, and this file is where that
// rule is enforceable: `resolve_public_invitation` is the only RPC named here, it takes
// no arguments, and the credential arrives as a request header rather than as a query
// string or a body field. That distinction matters because PostgREST will accept a GET
// against a volatile function with arguments in the URL — a link whose token sits in a
// query string ends up in server access logs, browser history, and any `Referer` a
// third-party asset on the page leaks. A header is not a URL.
//
// So the browser's *address* still reads `/i/<token>` — that is the address a host shares
// — but the route is resolved by the SPA after the document loads, and the API request
// that follows carries the credential in a header instead of repeating it in a URL.
//
// This client is built fresh per read, deliberately:
//   * it must not be `./client`'s singleton, which holds the signed-in host's session and
//     would send an `Authorization` header for a visitor who has none;
//   * `persistSession: false` means a guest's visit writes nothing to storage — no
//     session, no refresh token, nothing left on a shared family phone after the
//     invitation is read;
//   * the header value is fixed when the client is constructed, which is exactly the
//     lifetime of a credential on this page.
//
// Every failure answers with the same phrase, for the same reason the database returns
// the same `{ available: false }` for a malformed, unknown, revoked and expired
// credential: a guest who mistyped a link learns nothing they could not have guessed, and
// nobody probing addresses learns which ones exist.

import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { parsePublicInvitation, type PublicInvitation } from '@/lib/publicInvitation';
import { describe } from '@/lib/safeError';
import type { QueryResult } from './weddings';

/** The only header a credential may travel in. */
const TOKEN_HEADER = 'x-invitation-token';

/** `private.mint_public_invitation_token` writes 43 URL-safe characters, and
 *  `private.invitation_for_token` refuses anything else before hashing it. Checked here
 *  for the same reason it is checked there: a string that cannot possibly match is not
 *  worth a round trip, and refusing it locally costs nothing to say. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export const INVITATION_UNAVAILABLE = 'This invitation is not available.';

const unavailable = (reason?: unknown): { data: null; error: string } => {
  if (reason !== undefined) console.warn(describe('publicInvitation', INVITATION_UNAVAILABLE, reason));
  return { data: null, error: INVITATION_UNAVAILABLE };
};

export async function resolvePublicInvitation(
  token: string,
): Promise<QueryResult<PublicInvitation>> {
  if (!TOKEN_SHAPE.test(token)) return unavailable();

  const client = createClient<Database>(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { headers: { [TOKEN_HEADER]: token } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const { data, error } = await client.schema('api').rpc('resolve_public_invitation');
  if (error) return unavailable(error);

  const invitation = parsePublicInvitation(data);
  if (invitation === null) return unavailable();
  return { data: invitation, error: null };
}
