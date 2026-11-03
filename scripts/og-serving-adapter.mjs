#!/usr/bin/env node
// VIVAAHVARNAM — Stage 9 §10.1: the HTML a host must serve so a shared invitation link unfurls.
//
// Why this file exists. `src/lib/ogMetadata.ts` is a pure function and its unit battery pins its
// arithmetic, but a unit test cannot show that the bytes leave a server correctly: that the shell's
// brand tags are actually gone and not merely shadowed, that an `&` in a host's title survives
// attribute escaping and still reads back as `&`, that a revoked address answers the way §9.2 says it
// must. §10.1 asks for a loopback harness to prove those, and `scripts/stage9-og-serving.mjs` is the
// probe that drives it. This is the harness.
//
// One implementation, two runtimes. The tags come from `src/lib/ogMetadata.ts` imported directly —
// Node 24 strips the types, and every runtime import in that module chain carries its extension, so
// this harness and the guest page cannot drift into two different OG contracts. A JS restatement of
// the tag list here would be a second source of truth, which is the thing this stage keeps refusing.
//
// The origin is a parameter because loopback is not a legal `og:url`. `src/render/qrTarget.ts` — the
// door that decides what a printed or shared address may look like — refuses a literal IP address, so
// `http://127.0.0.1:<port>/i/<token>` is not something this module is allowed to publish as a
// canonical URL. The harness therefore *pretends* to be the public origin named in its state file: it
// composes `${origin}/i/<token>` for the tags and answers on 127.0.0.1. A misconfigured state file
// (origin of `http://127.0.0.1:4173`, say) produces a 500 with no tags at all rather than a page
// advertising an address the QR door would refuse to print. That failure is a negative control the
// probe asserts, not an accident of implementation.
//
// Three deliberate absences:
//   * no access log. A log line for `GET /i/<credential>` is the credential written into a file this
//     stage does not control, and §9's whole argument about printed addresses is that the credential
//     is the secret. The harness prints one startup line and nothing per request, and the probe
//     asserts that on the harness's own stdout.
//   * no cache. Every response says `no-store`, because a harness that cached a 200 would keep
//     answering after revocation — the exact behaviour §10.1 is here to test.
//   * no bind option. It listens on 127.0.0.1 and nowhere else. A harness reachable by a real crawler
//     would be a hosted deployment, and §10.2 forbids inventing one.
//
// What is *not* claimed: that WhatsApp, Telegram or any other client renders these bytes. §10.2's
// honest status is `PARTIAL (local contract only)` — this proves the response a host must give, not a
// third-party unfurl.
//
// Usage:
//   npm run build
//   node scripts/og-serving-adapter.mjs --port 4391 --shell dist/index.html --state <file.json>
//
// The state file is re-read for every request, so the probe can flip a token from live to revoked
// without restarting the server — which is what makes the §9.2 lifecycle testable at all. A revoked
// token answers 410 for its invitation page *and* for its preview object, because §10.2's production
// seam is "delete the preview object when a publication is revoked or rotated":
//
//   {
//     "origin": "https://vivaahvarnam.example",
//     "invitations": [
//       { "token": "<43 chars>", "payload": { "available": true, "invitation": { … } },
//         "preview": { "path": "/previews/<token>.png", "file": "<path a digest is taken of>" } }
//     ],
//     "revoked": ["<43 chars>"]
//   }

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePublicInvitation } from '../src/lib/publicInvitation.ts';
import { buildOgMetadata } from '../src/lib/ogMetadata.ts';
import { withOpenGraphTags } from '../src/lib/ogShellDocument.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';

/** `--flag value` only, no positionals: a silently ignored argument would mean a probe asserting
 *  against a harness configured differently from what its author believed. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`unexpected argument: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    out[flag.slice(2)] = value;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.state) throw new Error('--state is required: the harness holds no invitation data of its own');
if (args.port !== undefined && !/^\d+$/.test(args.port)) throw new Error(`--port must be a number, got ${args.port}`);

const PORT = Number(args.port ?? '4391');
if (PORT < 1024 || PORT > 65535) throw new Error(`--port must be in 1024-65535, got ${args.port}`);
const SHELL = resolve(ROOT, args.shell ?? 'dist/index.html');
const STATE = resolve(ROOT, args.state);

/** The preview artefacts this stage draws are bitmaps; anything else is opaque bytes rather than a
 *  type guessed from a filename. */
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const shell = readFileSync(SHELL, 'utf8');
if (!/<\/head>/i.test(shell)) throw new Error(`the shell at ${SHELL} has no </head> to insert into`);

/** Every `og:`/`twitter:` tag in the shell is the brand's, and only the brand's: the guest's own
 *  `<title>`, its `description`, its `referrer` and its `viewport` pass through untouched — §10.3
 *  explicitly keeps the page title's current behaviour, and §10.1 says nothing about the others.
 *  The removal and the insertion live in `src/lib/ogShellDocument.ts` rather than here so that this
 *  harness and the edge Worker that Stage 12 puts in front of a real build cannot drift into two
 *  readings of "the brand tags are gone". */
const pageWith = (tags) => withOpenGraphTags(shell, tags);

const readState = () => JSON.parse(readFileSync(STATE, 'utf8'));

/** A state file the harness cannot route from is a setup failure, not a guest-visible shape, so it
 *  gets the same fixed vocabulary as a refusal: no text from the file is echoed. */
const routedState = (state) =>
  state !== null && typeof state === 'object'
    && typeof state.origin === 'string'
    && Array.isArray(state.invitations)
    && Array.isArray(state.revoked)
    && state.invitations.every((entry) => typeof entry.token === 'string')
    ? state
    : null;

function respond(res, req, status, body, headers) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, { 'content-length': bytes.length, 'cache-control': 'no-store', ...headers });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

const unavailable = (res, req, status, servingError) =>
  respond(res, req, status, `${JSON.stringify(servingError === undefined
    ? { available: false }
    : { available: false, serving_error: servingError })}\n`, {
    'content-type': 'application/json; charset=utf-8',
  });

const handler = (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' });
    res.end();
    return;
  }

  let path;
  try {
    path = new URL(req.url, `http://${HOST}:${PORT}`).pathname;
  } catch {
    unavailable(res, req, 400);
    return;
  }

  let state = readState();
  if (routedState(state) === null) {
    unavailable(res, req, 500, 'state-unreadable');
    return;
  }
  state = routedState(state);

  // Only ever the raw tail: the credential's alphabet is `[A-Za-z0-9_-]`, so a percent-encoded
  // spelling is not a different way of asking for the same address — it is an unknown address, and it
  // must not be decoded into one.
  const requestedToken = path.startsWith('/i/') ? path.slice('/i/'.length) : null;

  // Revocation is answered before the entry is read, so a token in both lists gives 410: the state
  // file's own ordering cannot revive an address that has been withdrawn.
  if (requestedToken !== null && state.revoked.includes(requestedToken)) {
    unavailable(res, req, 410);
    return;
  }

  if (path.startsWith('/previews/')) {
    const owner = state.invitations.find((candidate) => candidate.preview?.path === path);
    if (owner === undefined) {
      unavailable(res, req, 404);
      return;
    }
    // §10.2's seam says a revoked or rotated publication has its preview object *deleted*. Locally the
    // harness cannot delete what a manifest still names, so it refuses — the address the unfurl already
    // handed out must keep answering nothing once the invitation behind it is withdrawn.
    if (state.revoked.includes(owner.token)) {
      unavailable(res, req, 410);
      return;
    }
    let bytes;
    try {
      bytes = readFileSync(resolve(ROOT, owner.preview.file));
    } catch {
      unavailable(res, req, 500, 'preview-unreadable');
      return;
    }
    respond(res, req, 200, bytes, {
      'content-type': IMAGE_TYPES[extname(owner.preview.file).toLowerCase()] ?? 'application/octet-stream',
    });
    return;
  }

  if (requestedToken === null) {
    unavailable(res, req, 404);
    return;
  }

  const entry = state.invitations.find((candidate) => candidate.token === requestedToken);
  if (entry === undefined) {
    unavailable(res, req, 404);
    return;
  }

  const invitation = parsePublicInvitation(entry.payload);
  if (invitation === null) {
    // A payload this repository's own guest parser refuses has no honest preview: emitting the brand
    // tags, or a partial set, would be the "rendered something" failure §10.1 exists to rule out.
    unavailable(res, req, 500, 'payload-unparsable');
    return;
  }

  const metadata = buildOgMetadata({
    invitation,
    url: `${state.origin}${path}`,
    previewImageUrl: entry.preview === undefined ? null : `${state.origin}${entry.preview.path}`,
  });
  if (metadata.ok === false) {
    // The reason is one of the QR door's eight names — a fact about this harness's configuration, and
    // never a quote from the document.
    unavailable(res, req, 500, `metadata-refused:${metadata.reason}`);
    return;
  }

  respond(res, req, 200, pageWith(metadata.tags), {
    'content-type': 'text/html; charset=utf-8',
    'x-robots-tag': 'noindex, nofollow',
  });
};

// Fail fast on a state file the handler could otherwise only discover request by request.
const startupState = routedState(readState());
if (startupState === null) throw new Error(`--state ${STATE} is not readable routing state`);

const server = createServer(handler);
server.listen(PORT, HOST, () => {
  console.log(`og-serving-adapter: listening on ${HOST}:${PORT}, answering as ${startupState.origin}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
}
