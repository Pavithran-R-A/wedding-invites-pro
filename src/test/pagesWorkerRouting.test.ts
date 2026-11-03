// @vitest-environment node
// The routing decisions of `src/host/pages-worker.ts`, taken against an asset layer that answers 404.
//
// Why this file exists at all, and why it is not a substitute for the live tier.
// `scripts/host-response-contract.mjs` boots this Worker on workerd through Cloudflare's own CLI and
// reads the initial HTTP response, so it is the authority for everything a crawler sees on a door: the
// posture headers, the card bytes, the indifference between refusals. What it cannot show is the
// fallback branch, because the dev server's static layer never says 404. Measured, three times, against
// a boot with no door involved: `/login`, `/nope`, `/definitely-not-a-file.css` and
// `/assets/nope.css` all answered 200 with the shell's bytes, an `etag`, and
// `cache-control: public, max-age=0, must-revalidate` — miniflare's own fallback document, with its own
// headers, and therefore not the `no-store` response the Worker's fallback branch writes. The branch is
// unreachable there, so the tier reports it as a harness boundary (HR-21, HR-23) instead of asserting
// somebody else's behaviour and calling it the Worker's.
//
// A deployed Pages project in advanced mode is documented to answer `ASSETS.fetch` with a 404 for a
// file that is not in the bucket, which is the shape this file supplies by hand. So the split is:
// **the decision** is proved here, on a fake that returns what the platform returns; **the wire** is
// proved there. What stays unverified until a deploy exists is the platform's own answer, and this
// file cannot close that either — it can only prove that the Worker is right about whatever the asset
// layer says.
//
// The credential rule is asserted here too, and deliberately from the *inside*: a unit test can read the
// Worker's own `console.warn` arguments, which is the one place the "a diagnostic names the door, not the
// address" claim is checkable without depending on how a dev server happens to print stdout.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleRequest, type HostEnv } from '@/host/pages-worker';
import { carriesOpenGraphTags, withOpenGraphTags } from '@/lib/ogShellDocument';
import { NOINDEX_CONTENT } from '@/lib/robotsPosture';
import { guestPayload } from './invitationFixture';

/** A shell of this file's own making, with a brand card in it. Using the real `dist/index.html` would
 *  couple a unit test to a build; what matters is that a brand `og:`/`twitter:` block exists to be
 *  removed, and that the insertion point is there. */
const SHELL = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <title>VivaahVarnam</title>',
  '    <meta property="og:title" content="VivaahVarnam — Digital Wedding Patrika" />',
  '    <meta name="twitter:card" content="summary" />',
  '  </head>',
  '  <body><div id="root"></div></body>',
  '</html>',
].join('\n');

const ASSET_JS = 'console.log("fingerprinted chunk");';
const NOT_FOUND_BODY = '{"error":"not found"}';

/** The bytes a refused door must be: this shell through the same function the Worker itself calls, with
 *  an empty tag list.
 *
 *  Written that way on purpose. The claim under test is that a refusal is *exactly* the shared module's
 *  empty-card body — no brand card, no invented card, not the raw shell — and the only honest way to say
 *  it is to compare against the one implementation of "the shell with a card installed", which is the
 *  module `src/host/pages-worker.ts` imports rather than a second copy of the rule typed out here. The
 *  readable half of the same claim is asserted separately, line by line, so a future change to the
 *  shared module cannot carry a wrong expectation along with it. */
const REFUSAL_BODY = withOpenGraphTags(SHELL, []);

/** The asset layer as a deployed host answers it: a known path returns its bytes, anything else is a
 *  404 — including a path that looks like a route. */
const assetsFor = (files: Record<string, { body: string; type: string }>): HostEnv['ASSETS'] => ({
  fetch: async (request: Request) => {
    const pathname = new URL(request.url).pathname;
    const file = files[pathname];
    if (file === undefined) {
      return new Response(NOT_FOUND_BODY, {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(file.body, { status: 200, headers: { 'content-type': file.type } });
  },
});

const FULL_BUCKET: Record<string, { body: string; type: string }> = {
  '/index.html': { body: SHELL, type: 'text/html; charset=utf-8' },
  '/assets/app-abc123.js': { body: ASSET_JS, type: 'text/javascript; charset=utf-8' },
};

const envFor = (overrides: Partial<HostEnv> = {}): HostEnv => ({
  ASSETS: assetsFor(FULL_BUCKET),
  ...overrides,
});

const get = (path: string, init?: RequestInit): Request =>
  new Request(`https://vivaahvarnam.example${path}`, init);

const CREDENTIAL = '0ycxsxgXDUqNBkrvZICYf7m7Y6olVCv4x6buLCFSux0';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the host answers a route the bucket has no file for', () => {
  it('serves the shell, and forbids caching it', async () => {
    const response = await handleRequest(get('/dashboard'), envFor());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(SHELL);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    // A route is not a door: it gets no posture header, because there is no credential in its address
    // for a crawler to stumble into and the app's own pages are meant to be indexed.
    expect(response.headers.get('x-robots-tag')).toBe(null);
  });

  it('takes a HEAD the same way, since a HEAD is a document read', async () => {
    const response = await handleRequest(get('/dashboard', { method: 'HEAD' }), envFor());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    // What this file can see and what the wire carries are different questions, and the difference is
    // the point. `handleRequest` builds one `Response` for both methods — it does not branch on HEAD —
    // so the object here really does hold the shell, and it is the *runtime* that decides a HEAD caller
    // gets no body. Measured on workerd over HTTP: `scripts/host-response-contract.mjs` HR-27 asked a
    // door for a HEAD and received the posture headers with an empty body. Asserting an empty body at
    // this level would be asserting Node's `Response`, which is not the thing under test.
    expect(await response.text()).toBe(SHELL);
  });

  it('leaves a missing file a 404 rather than calling it a route', async () => {
    const response = await handleRequest(get('/assets/gone-xyz789.js'), envFor());
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(NOT_FOUND_BODY);
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('forwards a file the bucket really has, byte for byte and header for header', async () => {
    const response = await handleRequest(get('/assets/app-abc123.js'), envFor());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(ASSET_JS);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    // The fingerprinted name is the cache key. A Worker that imposed `no-store` here would be charging
    // the guest's every reload to the origin, so the silence is the contract.
    expect(response.headers.get('cache-control')).toBe(null);
  });

  it('does not treat a non-document method as a route to render', async () => {
    const response = await handleRequest(get('/dashboard', { method: 'POST', body: '{}' }), envFor());
    expect(response.status).toBe(404);
  });
});

describe('a broken deploy is a 500 and not a cached 200', () => {
  it('refuses to serve a door when the shell is not in the bucket', async () => {
    const response = await handleRequest(
      get(`/i/${CREDENTIAL}`),
      envFor({ ASSETS: assetsFor({}) }),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it('still serves nothing invented when a normal route is asked for and the bucket is empty', async () => {
    const response = await handleRequest(get('/dashboard'), envFor({ ASSETS: assetsFor({}) }));
    expect(response.status).toBe(404);
  });
});

describe('the door\'s own address is the limit of what the host will describe', () => {
  /** Configure the upstream, and do *not* set `VIVAAH_PUBLIC_ORIGIN`: the Worker then composes `og:url`
   *  from the address the request arrived on. Pointed at loopback, `src/render/qrTarget.ts` refuses it —
   *  the same door that refuses to print a QR for a private address — so the honest answer is the shell
   *  with no card at all. This is that rule enforced at the edge rather than in the browser. */
  const stubResolver = () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify(guestPayload({ language: 'en' })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })));
  };

  it('serves the refusal rather than a card whose og:url it could not print', async () => {
    stubResolver();
    const response = await handleRequest(
      new Request(`http://127.0.0.1:8789/i/${CREDENTIAL}`),
      envFor({
        VITE_SUPABASE_URL: 'https://project.ref.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only_value_000000',
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toBe(NOINDEX_CONTENT);
    const body = await response.text();
    expect(body).toBe(REFUSAL_BODY);
    expect(carriesOpenGraphTags(body)).toBe(false);
    expect(body).toContain('<title>VivaahVarnam</title>');
    expect(body).not.toBe(SHELL);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('names the door in its diagnostic and never the address', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubResolver();
    await handleRequest(
      new Request(`http://127.0.0.1:8789/i/${CREDENTIAL}`),
      envFor({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' }),
    );
    expect(warned).toHaveBeenCalledTimes(1);
    const [message] = warned.mock.calls[0] as [string];
    expect(message).toContain('/i/');
    expect(message).not.toContain(CREDENTIAL);
  });

  it('refuses a `/g/` and a `/r/` address with the same bytes it refuses a wrong credential with', async () => {
    const bare = REFUSAL_BODY;
    for (const path of [`/g/${CREDENTIAL}`, `/r/${CREDENTIAL}`, `/i/${'short-not-43'}`]) {
      const response = await handleRequest(get(path), envFor());
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe(bare);
      expect(carriesOpenGraphTags(body)).toBe(false);
      expect(response.headers.get('x-robots-tag')).toBe(NOINDEX_CONTENT);
    }
  });

  it('answers a door with a method that is not a document read with 405 and nothing else', async () => {
    const response = await handleRequest(get(`/i/${CREDENTIAL}`, { method: 'PUT', body: '{}' }), envFor());
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});
