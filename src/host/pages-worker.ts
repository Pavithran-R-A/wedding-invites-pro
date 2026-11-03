// The first bytes a host sends, before any JavaScript runs.
//
// Why this file exists. Everything the product promises a crawler — `noindex, nofollow`, an Open
// Graph card drawn from the frozen document rather than from the brand — was, until now, only true
// *after* this bundle executed. That is a real limitation with a name in the readiness matrix:
// `facebookexternalhit` and `Twitterbot` do not run JavaScript, so for them a meta written by a hook
// is invisible, and a `robots.txt` `Disallow` is a request that can be honoured without ever reading
// the page's own posture. The one mechanism that reaches every agent is the response header and the
// initial HTML, and neither of those belongs in `src/pages/`. This is that layer: an edge Worker for
// Cloudflare Pages' advanced mode, bundled out of this file by `scripts/build-pages-worker.mjs`.
//
// Why it shares its rules with the browser rather than restating them. Three imports carry the whole
// contract: `parsePublicInvitation` (the guest's own reader of the resolver's envelope),
// `buildOgMetadata` (the tag arithmetic, including the `og:url` door that refuses a private address),
// and `NOINDEX_CONTENT` (the posture both runtimes emit). A second implementation of any of them
// here would be a second source of truth about someone's wedding, and the failure mode is silent: the
// card and the page disagree, or one route loses its posture. The same three are what
// `scripts/og-serving-adapter.mjs` already imports, which is how §10.1's harness and this host cannot
// drift apart.
//
// What stays deliberately unreachable from here:
//   * the credential never enters a response body, a log line, or an upstream URL. It is a request
//     header on the way to PostgREST, exactly as the browser sends it
//     (`src/integrations/supabase/publicInvitation.ts:56-65`), and this file's own paths are keyed on
//     the *shape* rather than the value. `scripts/host-response-contract.mjs` asserts the absence by
//     reading this Worker's captured stdout, so the claim is measured and not merely intended.
//   * no `og:image`. A published preview is a signed Storage URL that expires, and §15 H-1 keeps that
//     domain closed until the product decides how long a card may be cached by a chat platform.
//     `buildOgMetadata` emits no image tag when handed `null`, so the honest answer is a card with a
//     title and a date rather than a URL that 403s the next time someone opens the thread.
//   * no caching of a door document. `cache-control: no-store` on `/i/`, `/r/` and `/g/`, because a
//     cached 200 keeps answering after a revocation — the exact behaviour §10.1 tests and §9.2 forbids.
//
// The indifference rule, stated because it is the opposite of a normal server's instinct: a bad
// credential, an unknown credential, a revoked credential, a malformed payload and an unreachable
// database all answer the *same* document — the app shell with no Open Graph block — and the SPA then
// says "This invitation is not available." That is the same indifference the database shows a bad
// credential and the client shows a refused payload, so probing addresses from the outside teaches
// nobody which ones exist. It is also why an unconfigured host is not a 500: the guest still gets a
// page. `scripts/host-response-contract.mjs` proves the shapes are indistinguishable, and
// `scripts/deploy-pages.mjs` refuses to deploy without the two browser-safe variables, so the missing
// configuration is loud where it is fixable rather than quiet where a guest is reading.

import { parsePublicInvitation } from '../lib/publicInvitation.ts';
import { buildOgMetadata } from '../lib/ogMetadata.ts';
import { withOpenGraphTags } from '../lib/ogShellDocument.ts';
import { NOINDEX_CONTENT } from '../lib/robotsPosture.ts';
import { PRIVATE_DOOR_PREFIXES, PUBLIC_INVITATION_PATH } from '../render/qrTarget.ts';

/** The bindings and variables a Pages deployment hands a Worker. Declared locally rather than
 *  pulled from `@cloudflare/workers-types`: the only things needed here are `fetch`, `Request`,
 *  `Response` and `URL`, all of which the DOM lib already describes, and a new dependency to type
 *  four of them would be a lockfile change for a comment. */
export interface HostEnv {
  /** Pages' own static-asset binding in advanced mode. Everything this Worker does not answer itself
   *  goes through it, so the hashed bundles keep the fingerprinted caching the build already relies
   *  on instead of inheriting a hand-rolled `cache-control`. */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** The same two names the browser build inlines, deliberately: one place in the hosting dashboard
   *  holds one pair of values, and a Worker reading a differently-named copy of the same URL is how
   *  a staging origin ends up calling a production database. Both are browser-safe by construction —
   *  the publishable key is the value the shipped bundle already carries — and `service_role`,
   *  passwords and payment secrets must never be named here. */
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** The origin `og:url` is composed against. Optional: when unset the Worker uses the origin the
   *  request arrived on, which is correct for a real `https` host and refuses loudly on loopback
   *  because `src/render/qrTarget.ts` does not accept a literal IP address as a printed target.
   *  Set it in a local run to prove the tag bytes; leave it unset in production. */
  VIVAAH_PUBLIC_ORIGIN?: string;
}

/** Every path prefix that carries a credential in the address itself. `/i/` is the published
 *  invitation; the other two come from the QR door's own list, so a fourth private door added there
 *  arrives here too rather than being indexed by omission. */
const TOKEN_BEARING_PREFIXES = ['/i/', ...PRIVATE_DOOR_PREFIXES];

/** The guest's one read, spelled the way `scripts/stage4-render-qualification.mjs:267-271` and
 *  `src/integrations/supabase/publicInvitation.ts` spell it: no arguments in the body or the URL, the
 *  credential in a header, and the `api` profile because the RPC lives in that schema. */
const RESOLVER_PATH = '/rest/v1/rpc/resolve_public_invitation';
const TOKEN_HEADER = 'x-invitation-token';

const isTokenBearing = (pathname: string): boolean =>
  TOKEN_BEARING_PREFIXES.some((prefix) => pathname.startsWith(prefix));

/** The credential only when the address is exactly `/i/<43 shape>`; anything else under `/i/` is a
 *  page with no document to describe, which is the same answer a wrong-shaped link gets. */
const invitationCredential = (pathname: string): string | null =>
  PUBLIC_INVITATION_PATH.test(pathname) ? pathname.slice('/i/'.length) : null;

/** The two values this Worker needs, or `null` when the host is not configured. No partial answers:
 *  half a configuration would produce a request that fails in a way a guest cannot see and an operator
 *  cannot name. */
const upstreamConfig = (env: HostEnv): { url: string; key: string } | null => {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : '';
  const key =
    typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === 'string'
      ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
      : '';
  if (url === '' || key === '' || !/^https?:\/\//.test(url)) return null;
  return { url: url.replace(/\/+$/, ''), key };
};

/**
 * The document behind one published address, or `null` for every reason there is not one.
 *
 * `reason` is a name from this file's own fixed vocabulary and never a quote from the upstream — a
 * PostgREST message can carry the address that produced it, and a reason that reaches a log line
 * should not be somebody's credential.
 */
async function resolveInvitation(
  env: HostEnv,
  credential: string,
): Promise<{ invitation: Awaited<ReturnType<typeof parsePublicInvitation>>; reason: string | null }> {
  const config = upstreamConfig(env);
  if (config === null) return { invitation: null, reason: 'host-unconfigured' };

  let response: Response;
  try {
    response = await fetch(`${config.url}${RESOLVER_PATH}`, {
      method: 'POST',
      headers: {
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
        'content-type': 'application/json',
        'content-profile': 'api',
        [TOKEN_HEADER]: credential,
      },
      body: '{}',
    });
  } catch {
    return { invitation: null, reason: 'upstream-unreachable' };
  }
  if (!response.ok) return { invitation: null, reason: `upstream-status-${response.status}` };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { invitation: null, reason: 'payload-unreadable' };
  }

  const invitation = parsePublicInvitation(payload);
  if (invitation === null) return { invitation: null, reason: 'payload-refused' };
  return { invitation, reason: null };
}

/** The shell as the build shipped it. Fetched with GET even for a `HEAD` request: the caller throws
 *  these bytes away or sends them back through a `Response` the runtime shortens on its own. */
const readShell = async (env: HostEnv): Promise<string | null> => {
  const origin = new URL('http://pages.internal');
  const asset = await env.ASSETS.fetch(new Request(`${origin.origin}/index.html`));
  if (!asset.ok) return null;
  return asset.text();
};

const withPosture = (headers: Headers): Headers => {
  const out = new Headers(headers);
  out.set('x-robots-tag', NOINDEX_CONTENT);
  out.set('cache-control', 'no-store');
  out.set('content-type', 'text/html; charset=utf-8');
  return out;
};

export async function handleRequest(request: Request, env: HostEnv): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const isDocumentRead = request.method === 'GET' || request.method === 'HEAD';

  if (isTokenBearing(pathname)) {
    if (!isDocumentRead) {
      // A door answers documents. Anything else is not this route's business, and the honest reply
      // is the one the static layer already gives rather than a redirect that invents a location.
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const shell = await readShell(env);
    if (shell === null) {
      // `dist/index.html` missing is a broken deploy, not a guest-visible shape. It stays a 500 with
      // no body rather than a 200 that renders nothing, because a 200 is what an unfurling agent
      // caches.
      return new Response(null, { status: 500, headers: { 'cache-control': 'no-store' } });
    }

    const credential = invitationCredential(pathname);
    let tags: Parameters<typeof withOpenGraphTags>[1] = [];
    let reason = credential === null ? 'address-not-an-invitation' : 'host-unconfigured';

    if (credential !== null) {
      const resolved = await resolveInvitation(env, credential);
      if (resolved.invitation !== null) {
        const origin =
          typeof env.VIVAAH_PUBLIC_ORIGIN === 'string' && env.VIVAAH_PUBLIC_ORIGIN.trim() !== ''
            ? env.VIVAAH_PUBLIC_ORIGIN.trim().replace(/\/+$/, '')
            : `${url.protocol}//${url.host}`;
        const metadata = buildOgMetadata({
          invitation: resolved.invitation,
          url: `${origin}${pathname}`,
          previewImageUrl: null,
        });
        if (metadata.ok === true) {
          tags = metadata.tags;
          reason = null;
        } else {
          // The door's own name for why this address cannot be a printed target. It is a fact about
          // this host's configuration, and `scripts/host-response-contract.mjs` asserts it is the
          // loopback refusal rather than a card built from a URL the QR door would not print.
          reason = `metadata-refused:${metadata.reason}`;
        }
      } else {
        reason = resolved.reason ?? 'payload-refused';
      }
    }

    // A reason is recorded for the operator, never the address. Workers surface `console` only to a
    // session that explicitly tails this deployment, so this is a diagnostic and not an access log —
    // and it still names only the matched prefix, because a `/g/` or `/r/` path is a credential too
    // and masking only the shape this branch happens to know about is how a leak gets written.
    if (reason !== null) {
      const door = TOKEN_BEARING_PREFIXES.find((prefix) => pathname.startsWith(prefix)) ?? 'unknown';
      console.warn(`vivaahvarnam: no card served for the ${door} door (${reason})`);
    }

    return new Response(withOpenGraphTags(shell, tags), {
      status: 200,
      headers: withPosture(new Headers()),
    });
  }

  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404 || !isDocumentRead) return asset;

  // The SPA fallback an advanced-mode Worker owns: a path with no dot is a route the browser router
  // resolves, not a missing file. Same rule `vite preview` and the pilot's own journeys rely on.
  if (pathname.includes('.')) return asset;
  const shell = await readShell(env);
  if (shell === null) return asset;
  return new Response(shell, {
    status: 200,
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }),
  });
}

export default {
  fetch: (request: Request, env: HostEnv): Promise<Response> => handleRequest(request, env),
};
