// The one spelling of "do not index this address".
//
// Two runtimes say it. `src/hooks/use-noindex-route.ts` writes it into a live `<meta name="robots">`
// for a crawler that runs this bundle, and the edge Worker in `src/host/pages-worker.ts` writes it
// into the `X-Robots-Tag` response header for every other agent — including the ones that never
// execute JavaScript, which is the whole reason the header exists.
//
// It lives in a module of its own rather than being imported from the hook because the hook file
// pulls in React, and a Worker bundle that carried a copy of React to read one string would be a
// slower first byte for every guest. The name is still re-exported from the hook, so a reader who
// arrives from the bundle side finds it where the readiness matrix says it is.
//
// What the value is *not* is a security boundary. `docs/audits` records the ruling: a `noindex` is a
// request to a search engine, honoured or ignored by them, and the thing that keeps a household's or
// a relative's address out of reach is the credential's authorisation, expiry and revocation in the
// database. Nothing in either runtime compensates for a token that should not have worked.

/** The directive both runtimes emit. `nofollow` travels with it because a token-bearing page's links
 *  are its own guest's doors, and handing a crawler a route to follow from an address the product
 *  already refuses to index is a second way to be found. */
export const NOINDEX_CONTENT = 'noindex, nofollow';
