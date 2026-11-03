#!/usr/bin/env node
// VIVAAHVARNAM — the host-response contract, measured from outside the edge Worker.
//
// Why this tier exists. Issue #1's P0-5 comment asked for one thing that no test in this repository
// could answer until now: the *initial HTTP response*, read by an external client, not the hydrated
// DOM. Everything the product promised a crawler lived in `src/hooks/use-noindex-route.ts` — a React
// effect — and in `scripts/og-serving-adapter.mjs`, a harness that only Stage 9's own probe drives. A
// meta written by script is invisible to `facebookexternalhit` and `Twitterbot`, so the promise was
// true for one agent out of four. `src/host/pages-worker.ts` is the layer that closes that gap, and
// this file is the only place that can say it closed: it boots the Worker on the runtime that will
// actually run it (workerd, through Cloudflare's CLI), asks it for documents over real HTTP, and
// measures the bytes and headers that come back before any JavaScript has run.
//
// What is being claimed, and what is not. This is a **local** measurement of the **host-neutral
// contract** — the same decisions the Worker will make in production, on the same runtime, over the
// same bytes. It is not a measurement of a deployed origin, because there is not one yet, and it does
// not pretend to be: no Cloudflare project is created or contacted here, and nothing binds a port
// beyond 127.0.0.1. The things that differ between this run and a real deployment are the TLS
// termination, the platform's own header handling, and the static-asset layer's answer to a missing
// file. The last of those three was measured rather than assumed, and it changed what this tier is
// allowed to assert: see the fallback note above HR-21.
//
// The three properties that make this tier worth having:
//   * **The rules are not restated here.** The expected door body is computed by importing the same
//     `src/lib/ogShellDocument.ts`, `src/lib/ogMetadata.ts` and `src/lib/publicInvitation.ts` the
//     Worker imports, then compared by SHA-256 to the bytes the Worker served. An assertion written
//     against a second copy of the rule would pass even when host and browser disagreed — which is
//     the exact defect this contract exists to prevent.
//   * **Every refusal is byte-identical to every other refusal,** including the one where the host is
//     not configured at all and the one where the database is unreachable. A probe must not learn
//     which addresses exist from the difference between a 200 and a 500, so the indifference is
//     asserted across boots, not just within one.
//   * **The credential is tracked, not assumed.** It is asked for only by its header on the way
//     upstream (asserted at a stub server that records what it received) and its absence is asserted
//     over this Worker's own diagnostic lines. A measured zero is only meaningful because the same
//     capture is proved alive by the diagnostic line it also contains, and because the dev-server's
//     own access log — which *does* print the path, and is therefore not the surface this rule is
//     about — is counted and reported rather than quietly excluded.
//
// Configuration isolation, stated because it is a measured property of the tool and not a preference.
// `wrangler pages dev` loads a `.env`/`.env.local` file from its *working directory* — measured: from
// the repository root it discovered `.env.local`, listed the local stack's service-role key as a
// Worker binding, and ignored an explicit `--env-file` whose value never reached the Worker at all. So
// each boot runs from its own empty directory under the evidence root and is configured by a `.env`
// this file writes there, which is both the mechanism that works and the reason the repository's
// service-role key cannot appear in a boot. Boot B proves the isolation from the inside: it expects the
// Worker's own `host-unconfigured` diagnostic, and an ambient value would turn that assertion red rather
// than quietly relabel the test.
//
// Usage:
//   npm run pages:build            (the Worker and the static bundle must exist)
//   node scripts/host-response-contract.mjs
//
// Env: HOST_CONTRACT_EVIDENCE_DIR (default ../p1-logs), WRANGLER_BIN (absolute path to a wrangler
//      entry script — otherwise the CLI is located in node_modules or along PATH and never installed).
// Exit 1 means a finding was recorded against the contract. A missing build, a wrangler that cannot be
// found or will not boot, or a stub that never answers is a harness failure and exits 2: those are not
// statements about the product.

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { locateWrangler as locateWranglerFor } from './wrangler-location.mjs';

import { guestInvitation, guestPayload } from '../src/test/invitationFixture.ts';
import { parsePublicInvitation } from '../src/lib/publicInvitation.ts';
import { buildOgMetadata, serializeOgMetaTags } from '../src/lib/ogMetadata.ts';
import { withOpenGraphTags } from '../src/lib/ogShellDocument.ts';
import { NOINDEX_CONTENT } from '../src/lib/robotsPosture.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(process.env.PAGES_DIST_DIR ?? join(ROOT, 'dist'));
const WORKER = join(OUT_DIR, '_worker.js');
const SHELL_FILE = join(OUT_DIR, 'index.html');

const EVIDENCE_ROOT = resolve(process.env.HOST_CONTRACT_EVIDENCE_DIR ?? join(ROOT, '..', 'p1-logs'));
const RUN_TAG = `h3-contract-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const SCRATCH = join(EVIDENCE_ROOT, RUN_TAG);
mkdirSync(SCRATCH, { recursive: true });

/** The origin the Worker composes `og:url` against — a public, `https`, path-free host, which is the
 *  only shape `src/render/qrTarget.ts` will print. The requests themselves arrive on loopback; that
 *  asymmetry is the point of the variable, and the door's refusal of a loopback origin is asserted. */
const PUBLIC_ORIGIN = 'https://vivaahvarnam.example';

/** Three boots need three ports. They are asked for, but the port actually used is read back from the
 *  dev server's own `Ready on …` line — a tier that assumed the port it requested is the port it got
 *  would be asserting against somebody else's server. */
const PORT_BASE = Number(process.env.HOST_CONTRACT_PORT_BASE ?? '8791');

/** A publishable key shape, invented for this run. It is never printed: the leak assertions need a
 *  value to search for, and the value is this string, so the record shows its length only. */
const PUBLISHABLE = 'sb_publishable_VIVAAAHCONTRACTONLY_0000000000000000000';
/** A service-role-shaped value that must never leave this process. It is not passed to the Worker at
 *  all; it is here so the stub can prove it did not arrive. */
const SERVICE_ROLE_SHAPE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SERVICE_ROLE_SHAPE.NOT_A_SECRET';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const credentialFor = (name) =>
  createHash('sha256').update(`host-contract:${RUN_TAG}:${name}`).digest('base64url').slice(0, 43);
const GOOD = credentialFor('good');
const UNKNOWN = credentialFor('unknown');
const REVOKED = credentialFor('revoked');
const MALFORMED = 'short-token-not-43-characters-at-all-here';
/** A `/g/` and a `/r/` address, so the private doors are tested with a credential the resolver would
 *  happily answer for — a door that leaks is only found if it is asked with a valid key. */
const HOUSEHOLD = credentialFor('household');
const REVIEW = credentialFor('review');

const ALL_CREDENTIALS = [GOOD, UNKNOWN, REVOKED, MALFORMED, HOUSEHOLD, REVIEW];
/** The evidence record names a credential by what this tier built it for rather than by its value, so
 *  `observed-upstream.json` can be read without it being a list of door addresses. */
const CREDENTIAL_LABEL = new Map([
  [GOOD, 'good'], [UNKNOWN, 'unknown'], [REVOKED, 'revoked'], [MALFORMED, 'malformed'],
  [HOUSEHOLD, 'household'], [REVIEW, 'review'],
]);

// --------------------------------------------------------------------- reporting

const findings = [];
const measurements = [];
const lines = [];
/** The same masking `scripts/stage9-og-serving.mjs` applies to its own record, and for the same reason:
 *  this tier prints the door address it asked for (HR-08 has to, or it is not asserting the address),
 *  and a tier that writes a credential-shaped string into a log it does not protect teaches the next
 *  stage that the discipline is decorative. The fixture addresses here are `sha256`-derived from this
 *  run's own tag, so they are not live capabilities — but "not a live capability" is a property of the
 *  fixture, not of the habit, and the habit is what gets copied. Assertions below compare against the
 *  real in-memory value; only the printed form is masked. */
const TOKEN_SHAPED = /(^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
const mask = (text) => String(text).replace(TOKEN_SHAPED, '$1<credential>');
const say = (text) => { const out = mask(text); lines.push(out); console.log(out); };
const check = (id, ok, detail) => {
  say(`${ok ? 'PASS' : 'FINDING'} ${id}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) findings.push(`${id}${detail === undefined ? '' : `: ${detail}`}`);
};
const measured = (label, value) => { measurements.push([label, value]); say(`  ${label}: ${value}`); };

const bootErrors = [];
const harnessFail = (message) => { bootErrors.push(message); say(`HARNESS FAILURE — ${message}`); };

// --------------------------------------------------------------------- the upstream stub
//
// Not a mock of PostgREST's whole surface — only the one RPC the guest's door uses, with the same
// envelope and the same indifference. It records every request it receives so the credential's
// transport can be asserted from the server's point of view rather than from the caller's claim.

/** @type {Array<{method: string, url: string, headers: Record<string, string|string[]|undefined>, body: string}>} */
const observed = [];

const invitationDoc = guestInvitation({ language: 'en' });

const stub = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, v]));
    observed.push({ method: req.method ?? '', url: req.url ?? '', headers, body });
    if ((req.method ?? '') !== 'POST' || req.url !== '/rest/v1/rpc/resolve_public_invitation') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"no route"}');
      return;
    }
    const token = typeof headers['x-invitation-token'] === 'string' ? headers['x-invitation-token'] : '';
    const payload = token === GOOD ? guestPayload({ language: 'en' }) : { available: false };
    if (token === REVOKED) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"message":"revoked"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
});

const listen = (server, port) =>
  new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', () => ok(server)); });

/** A port that was bound a moment ago and is now released, which is the cheapest way to name an
 *  upstream that provably answers nothing. Boot C points the Worker at it, so the unreachable path is
 *  a measured shape rather than a code-reading. */
const freePort = async () => {
  const probe = await listen(createServer(), 0);
  const port = probe.address().port;
  await new Promise((ok) => probe.close(ok));
  return port;
};

// --------------------------------------------------------------------- wrangler location

/** The same rule the deployment tool uses, in one file — see `scripts/wrangler-location.mjs`, which
 *  carries the reasoning (ordered resolution, reported source, and the measured reason wrangler is not
 *  vendored here). This tier and that tool must not run different software while both say "wrangler". */
const locateWrangler = () => locateWranglerFor(import.meta.url);

// --------------------------------------------------------------------- the Worker under test

/** Every wrangler process this tier started, so the teardown is a list rather than a search. */
const servers = [];

async function bootWrangler(name, port, envValues) {
  const located = locateWrangler();
  if (located === null) {
    harnessFail('wrangler was not found — see the header for WRANGLER_BIN');
    return null;
  }
  // One path for this boot's log, named from the boot rather than passed in, so the file written when
  // the process exits and the file written at teardown are the same file.
  const log = join(SCRATCH, `wrangler-${name}.log`);
  const runDir = join(SCRATCH, `run-${name}`);
  mkdirSync(runDir, { recursive: true });
  // The variables are handed over as a `.env` file in the dev server's own working directory, which is
  // the mechanism measured to work (probe: an explicit `--env-file` was parsed but never reached the
  // Worker's environment). The working directory is this scratch run, never the repository, so the
  // repository's `.env.local` — which carries the local stack's service-role key — is not discovered
  // either; HR-34 asserts that from the Worker's own diagnostic.
  writeFileSync(join(runDir, '.env'), envValues.map(([k, v]) => `${k}=${v}\n`).join(''));

  const child = spawn(
    process.execPath,
    [
      '--no-warnings',
      located.path,
      'pages', 'dev', OUT_DIR,
      '--ip', '127.0.0.1',
      '--port', String(port),
      '--compatibility-date=2026-09-26',
      '--show-interactive-dev-session=false',
      '--persist-to', join(runDir, 'state'),
    ],
    // One configuration channel: the file above. The parent's environment is passed through unchanged
    // (wrangler needs PATH and SYSTEMROOT to run) and no `VITE_*` value is added to it, so a value the
    // Worker saw can only have come from the `.env` this function wrote.
    { cwd: runDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } },
  );

  let capture = '';
  const record = (chunk) => { capture += chunk.toString('utf8'); };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  child.on('error', (error) => harnessFail(`${name}: spawn failed — ${error.message}`));
  child.on('exit', (code, signal) => {
    writeFileSync(log, capture);
    if (code !== 0 && code !== null && signal === null) say(`  note: ${name} exited ${code}`);
  });
  servers.push({ name, child, getCapture: () => capture, log });

  const boundPort = await new Promise((ok, no) => {
    const deadline = Date.now() + 120_000;
    const poll = () => {
      const match = capture.match(/Ready on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match !== null) return ok(Number(match[1]));
      if (child.killed || child.exitCode !== null) return no(new Error(`${name}: exited before ready`));
      if (Date.now() > deadline) return no(new Error(`${name}: no Ready line inside 120 s`));
      setTimeout(poll, 100);
    };
    poll();
  }).catch((error) => { harnessFail(error.message); return null; });
  if (boundPort === null) return null;
  if (boundPort !== port) say(`  note: ${name} asked for ${port} and got ${boundPort}`);

  return {
    name,
    port: boundPort,
    origin: `http://127.0.0.1:${boundPort}`,
    request: async (path, init = {}) => {
      const response = await fetch(`http://127.0.0.1:${boundPort}${path}`, { ...init, redirect: 'manual' });
      const text = init.method === 'HEAD' ? '' : await response.text();
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        text,
        digest: sha256(text),
      };
    },
    capture: () => capture,
  };
}

/** The Worker's `console.warn` reaches this process through the dev server's log channel, and that
 *  channel is asynchronous. Measured on the first run: the line was absent when the capture was read
 *  immediately after the request that caused it, and present once the process had exited — so a zero
 *  read that early is not evidence that the Worker declined to log. The tier waits for the line it
 *  expects and only calls it missing when the wait expires, and it reports how long the wait took, so
 *  a pass that needed eight seconds of lagging channel is visible as a lag rather than invisible as a
 *  green. */
const waitForDiagnostic = async (boot, needle, limitMs = 10_000) => {
  const started = Date.now();
  for (;;) {
    if (boot.capture().includes(needle)) return Date.now() - started;
    if (Date.now() - started > limitMs) return null;
    await new Promise((tick) => setTimeout(tick, 100));
  }
};

/** Terminal colour codes, as they really arrive. The dev server writes them even into a pipe, so every
 *  diagnostic line this tier reads ends in `ESC[0m` — measured, and the reason an earlier draft of the
 *  reason-vocabulary check below answered `<no reason named>` for all nine lines: a pattern anchored to
 *  the end of the line was matching the colour code rather than the parenthesis. Stripping happens where
 *  the line is kept, so every later assertion on it — the vocabulary and the credential searches alike —
 *  reads the same text an operator would. */
const stripAnsi = (text) => text.replace(/\u001B\[[0-9;]*m/g, '');

function teardown() {
  for (const { name, child } of servers) {
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGTERM');
    } catch (error) {
      say(`  note: ${name} teardown — ${error?.message ?? String(error)}`);
    }
  }
}

// --------------------------------------------------------------------- expected bytes
//
// Computed here from the product's own modules. If the Worker and this file ever disagree, one of the
// two is wrong about the contract — which is the assertion worth having.

const shellBytes = readFileSync(SHELL_FILE, 'utf8');

const cardMetadata = buildOgMetadata({
  invitation: parsePublicInvitation(guestPayload({ language: 'en' })),
  url: `${PUBLIC_ORIGIN}/i/${GOOD}`,
  previewImageUrl: null,
});
const expectedCardBody = cardMetadata.ok
  ? withOpenGraphTags(shellBytes, cardMetadata.tags)
  : null;
const expectedBareBody = withOpenGraphTags(shellBytes, []);

// --------------------------------------------------------------------- the assertions

const metaContent = (html, key) => {
  const pattern = new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`, 'i');
  const match = html.match(pattern);
  return match === null ? null : match[1];
};
const countOf = (html, key) => (html.match(new RegExp(`"${key}"`, 'g')) ?? []).length;

/** How many times a raw string appears, wherever it sits. `countOf` can only see a value wrapped in
 *  quotes, so it reports zero for the shell's `<title>` — which is exactly the text HR-12c has to count.
 *  Measured on this build: the brand appears 3 times in the shell, once in the card-free refusal body. */
const textCount = (html, needle) => html.split(needle).length - 1;

/** The brand string the *template* claims for itself, read out of the build rather than hard-coded, so
 *  a rebrand moves this tier's expectation instead of silently making an assertion vacuous. */
const BRAND = metaContent(shellBytes, 'og:title') ?? 'VivaahVarnam — Digital Wedding Patrika';

/** Every `<meta>` in these bytes that is part of a card block, as raw strings.
 *
 *  Deliberately a counting regex owned by this file rather than an import of `ogShellDocument.ts`'s
 *  removal pattern: the tier needs an independent witness of how many card tags a response carries, and
 *  a measurement that reused the product's own expression could not catch a rule that removes the wrong
 *  elements. The two must agree by the arithmetic, not by sharing a string.
 *
 *  The quote is optional here, and that is the whole point of owning a second expression.
 *  `ogShellDocument.ts` requires a quote after `=`, so `name=twitter:card` is invisible to both its
 *  removal rule and its `carriesOpenGraphTags` probe — a measured limit, pinned in
 *  `src/test/ogShellDocument.test.ts`. If this tier demanded a quote too, an unquoted brand card left on
 *  the wire would make HR-12 count zero tags and pass, and `carriesOpenGraphTags === false` would be
 *  quoted in support of it. Counting more loosely than the product can only ever make this tier redder,
 *  never greener, which is the direction a witness has to be allowed to lean. */
const cardMetaElements = (html) =>
  html.match(/<meta\b[^>]*?\b(?:property|name)\s*=\s*["']?(?:og:|twitter:)[^>]*>/gi) ?? [];

const POSTURE = { robots: 'x-robots-tag', cache: 'cache-control' };

const note = (text) => { say(text); };

async function main() {
  if (!existsSync(WORKER) || !existsSync(SHELL_FILE)) {
    console.error(`host-response-contract: ${WORKER} or ${SHELL_FILE} missing — run \`npm run pages:build\``);
    process.exit(2);
  }
  await listen(stub, 0);
  const stubOrigin = `http://127.0.0.1:${stub.address().port}`;

  note(`wrangler entry: ${locateWrangler()?.path ?? 'not found'}`);
  note(`stub upstream:  ${stubOrigin}`);
  note(`shell:          ${SHELL_FILE} (${Buffer.byteLength(shellBytes)} bytes)`);
  note(`worker bundle:  ${WORKER} (${readFileSync(WORKER, 'utf8').length} chars)`);
  note('');

  // A precondition on this file, not on the product: every byte-level assertion below is computed from
  // the shared modules, so if the door in `src/render/qrTarget.ts` ever refuses the address this tier
  // composes, the whole tier would silently compare against a `null` expectation.
  check('HR-00 this tier can build the card it is about to demand',
    cardMetadata.ok === true && expectedCardBody !== null,
    cardMetadata.ok ? 'ok' : `the QR door refused: ${cardMetadata.reason}`);

  // ---- Boot A — a configured host, a reachable upstream.
  const A = await bootWrangler('A-configured', PORT_BASE, [
    ['VITE_SUPABASE_URL', stubOrigin],
    ['VITE_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE],
    ['VIVAAH_PUBLIC_ORIGIN', PUBLIC_ORIGIN],
  ]);

  if (A !== null) {
    const door = await A.request(`/i/${GOOD}`);
    check('HR-01 the published address answers 200 over HTTP', door.status === 200, `status ${door.status}`);
    check(
      'HR-02 the initial response carries the noindex header',
      door.headers[POSTURE.robots] === NOINDEX_CONTENT,
      `x-robots-tag: ${door.headers[POSTURE.robots] ?? '<absent>'}`,
    );
    check(
      'HR-03 the initial response forbids caching a door',
      (door.headers[POSTURE.cache] ?? '').includes('no-store'),
      `cache-control: ${door.headers[POSTURE.cache] ?? '<absent>'}`,
    );
    check(
      'HR-04 the door is served as HTML to a client that runs no script',
      (door.headers['content-type'] ?? '').startsWith('text/html'),
      `content-type: ${door.headers['content-type'] ?? '<absent>'}`,
    );
    check('HR-05 the invitation card is in the first bytes', door.text.includes('property="og:title"'));
    check(
      'HR-06 the served door bytes are exactly what the shared modules build',
      expectedCardBody !== null && door.digest === sha256(expectedCardBody),
      `served ${door.digest.slice(0, 12)} expected ${expectedCardBody === null ? '<build refused>' : sha256(expectedCardBody).slice(0, 12)}`,
    );
    check('HR-07 og:title is the host\'s title, not the brand',
      metaContent(door.text, 'og:title') === invitationDoc.title,
      `${metaContent(door.text, 'og:title')}`);
    check('HR-08 og:url is the published address on the deployment origin',
      metaContent(door.text, 'og:url') === `${PUBLIC_ORIGIN}/i/${GOOD}`,
      `${metaContent(door.text, 'og:url')}`);
    check('HR-09 the card carries the ceremony line as its description',
      metaContent(door.text, 'og:description') !== null && metaContent(door.text, 'og:description').includes('Sri Kanchi Mahal'),
      `${metaContent(door.text, 'og:description')}`);
    check('HR-10 no og:image is invented while §15 H-1 is closed',
      metaContent(door.text, 'og:image') === null);
    check('HR-11 one card, not a card and a brand',
      countOf(door.text, 'og:title') === 1 && countOf(door.text, 'twitter:card') === 1,
      `og:title x${countOf(door.text, 'og:title')}, twitter:card x${countOf(door.text, 'twitter:card')}`);
    // HR-12 is about the card block, not about every brand byte in the document, and the distinction
    // was earned: the first run of this tier searched the whole body for the brand string, went red, and
    // the cause was the shell's `<title>` and `<meta name="author">` — which this Worker deliberately
    // leaves alone, because it replaces what describes the *card* and the guest's tab title belongs to
    // the app. Asserting that no brand byte survives anywhere would have been a claim about a different
    // design than the one `src/host/pages-worker.ts` implements. The two shapes are therefore measured
    // separately: the card block must be clean, and whatever brand text remains outside it must be the
    // same text the locally-built refusal body carries — so a stale brand tag inserted somewhere else is
    // still a finding. The first draft of that second half counted with `countOf`, which only sees a
    // quoted attribute value, so it compared 0 with 0 and passed without witnessing anything; the brand
    // text outside the card block lives in element content, so it is counted as raw text here, and the
    // check refuses to be satisfied by two equal zeros.
    const brandTagsServed = cardMetaElements(door.text).filter((tag) => tag.includes(BRAND));
    check('HR-12 no brand card tag survives the replacement',
      brandTagsServed.length === 0, `${brandTagsServed.length} tag(s) still carry the brand`);
    const builtCardCount = cardMetadata.ok
      ? (serializeOgMetaTags(cardMetadata.tags).match(/<meta\b/gi) ?? []).length
      : -1;
    check('HR-12b the served card is exactly the built card, tag for tag',
      builtCardCount > 0 && cardMetaElements(door.text).length === builtCardCount,
      `served ${cardMetaElements(door.text).length} card tag(s), built ${builtCardCount}`);
    const brandInDoor = textCount(door.text, BRAND);
    const brandInRefusal = textCount(expectedBareBody, BRAND);
    const brandInShell = textCount(shellBytes, BRAND);
    check('HR-12c the brand text left in the door is the shell\'s own, and fewer of it than the shell had',
      brandInDoor === brandInRefusal && brandInDoor > 0 && brandInDoor < brandInShell,
      `served ${brandInDoor}, built refusal ${brandInRefusal}, raw shell ${brandInShell}`);

    for (const [id, path, label] of [
      ['HR-13', `/i/${UNKNOWN}`, 'an unknown credential'],
      ['HR-14', `/i/${REVOKED}`, 'a revoked-shaped credential'],
      ['HR-15', `/i/${MALFORMED}`, 'a malformed credential'],
      ['HR-16', `/g/${HOUSEHOLD}`, "a household's door"],
      ['HR-17', `/r/${REVIEW}`, "a reviewer's door"],
    ]) {
      const refused = await A.request(path);
      check(`${id} ${label} still answers 200 with the noindex header`,
        refused.status === 200 && refused.headers[POSTURE.robots] === NOINDEX_CONTENT,
        `status ${refused.status}, x-robots-tag ${refused.headers[POSTURE.robots] ?? '<absent>'}`);
      // "No card at all" is a negative-existence claim, so it is measured by this tier's own counting
      // regex rather than by `carriesOpenGraphTags`, the product's predicate: the product needs a quote
      // after `=` and this one does not (see `cardMetaElements`). The digest half alone would have been
      // satisfied by the mutation run that stopped stripping brand tags, because the expected refusal body
      // is built with the same function and moved with it — the two digests matched while six brand tags
      // sat on the wire. Each half of the conjunction is reported separately, so a red says which one broke.
      const cardTagsOnRefusal = cardMetaElements(refused.text).length;
      const matchesBuiltRefusal = refused.digest === sha256(expectedBareBody);
      check(`${id}b ${label} gets no card at all`,
        cardTagsOnRefusal === 0 && matchesBuiltRefusal,
        `${cardTagsOnRefusal} card tag(s) on the wire | served ${refused.digest.slice(0, 12)} vs built refusal ${sha256(expectedBareBody).slice(0, 12)}`);
    }

    // The log channel lags the response (see `waitForDiagnostic`), so the tier waits for the diagnostic
    // belonging to the last door it asked about before it reads the capture as evidence about the
    // others. The lines arrive in order on one stream, so a witnessed `/r/` line is also proof that the
    // five before it were emitted.
    const aSettle = await waitForDiagnostic(A, 'no card served for the /r/ door');
    check('HR-17c this boot\'s own refusals reached the log',
      aSettle !== null, aSettle === null ? 'no /r/ diagnostic inside 10 s' : `visible after ${aSettle} ms`);

    const home = await A.request('/');
    check('HR-18 the marketing page keeps the brand card',
      metaContent(home.text, 'og:title') === 'VivaahVarnam — Digital Wedding Patrika',
      `${metaContent(home.text, 'og:title')}`);
    check('HR-19 the marketing page carries no noindex header',
      home.headers[POSTURE.robots] === undefined,
      `x-robots-tag: ${home.headers[POSTURE.robots] ?? '<absent>'}`);
    check('HR-20 the marketing page is the untouched build output',
      home.digest === sha256(shellBytes),
      `served ${home.digest.slice(0, 12)} vs disk ${sha256(shellBytes).slice(0, 12)}`);

    // The SPA fallback, and the honest limit of what this harness can show.
    //
    // `src/host/pages-worker.ts` answers a missing extension-less path with the shell and its own
    // headers, and forwards a missing dotted path unchanged. Measured here (probe: three runs against a
    // boot with no door involved): the *dev* asset layer never returns 404 — `/login`, `/nope`,
    // `/definitely-not-a-file.css` and `/assets/nope.css` all come back 200 with the shell's bytes, an
    // `etag`, and `cache-control: public, max-age=0, must-revalidate`. Those are miniflare's own
    // fallback-document headers, not the `no-store`/`content-type` pair the Worker's fallback branch
    // writes, and that difference is how the two are told apart. So the Worker's fallback branch is
    // unreachable through `pages dev`, and the routing rule it implements is asserted at the unit level
    // instead — `src/test/pagesWorkerRouting.test.ts`, driving `handleRequest` with an ASSETS binding
    // that really does answer 404, which is the production shape this harness cannot present.
    //
    // What this tier can and does carry is the part that is measurable over live HTTP: a route the
    // bundle has no file for still answers the shell to a client that runs no script, and neither a
    // route nor a missing asset is given the door's posture, because neither is a door. Whether a real
    // deployed Pages project returns 404 from ASSETS is recorded as unverified until a deploy exists.
    const login = await A.request('/login');
    check('HR-21 a route the bundle has no file for still answers the shell over HTTP',
      login.status === 200 && login.digest === sha256(shellBytes),
      `status ${login.status}, ${login.text.length} bytes`);
    check('HR-21b and on this harness it came from the asset layer rather than the door branch',
      login.headers[POSTURE.robots] === undefined && login.headers[POSTURE.cache] !== 'no-store',
      `cache-control: ${login.headers[POSTURE.cache] ?? '<absent>'}, x-robots-tag: ${login.headers[POSTURE.robots] ?? '<absent>'}`);
    measured('dev asset layer on a missing route',
      `status ${login.status}, cache-control ${login.headers[POSTURE.cache] ?? '<absent>'}, etag ${login.headers.etag ?? '<absent>'}`);

    const robotsTxt = await A.request('/robots.txt');
    const groups = (robotsTxt.text.match(/^User-agent:/gm) ?? []).length;
    check('HR-22 robots.txt is served, whole, and carries no robots header',
      robotsTxt.status === 200 && groups === 5 && robotsTxt.headers[POSTURE.robots] === undefined,
      `status ${robotsTxt.status}, ${groups} groups, x-robots-tag ${robotsTxt.headers[POSTURE.robots] ?? '<absent>'}`);

    const missing = await A.request('/definitely-not-a-file.css');
    check('HR-23 a missing asset is not answered as a door, whatever the asset layer decided to return',
      missing.headers[POSTURE.robots] === undefined && missing.headers[POSTURE.cache] !== 'no-store',
      `status ${missing.status}, x-robots-tag ${missing.headers[POSTURE.robots] ?? '<absent>'}, cache-control ${missing.headers[POSTURE.cache] ?? '<absent>'}`);

    // A fingerprinted chunk, chosen from the build output rather than hard-coded: the name is a hash of
    // the bytes, so an assertion written against one build's filename is a tier that rots on the next.
    const assetName = readdirSync(join(OUT_DIR, 'assets')).filter((f) => f.endsWith('.js')).sort()[0];
    const assetBytes = readFileSync(join(OUT_DIR, 'assets', assetName), 'utf8');
    const asset = await A.request(`/assets/${assetName}`);
    check('HR-24 a fingerprinted chunk is served byte-for-byte through the host',
      asset.status === 200 && asset.digest === sha256(assetBytes),
      `${assetName}: served ${asset.digest.slice(0, 12)} vs disk ${sha256(assetBytes).slice(0, 12)}`);
    check('HR-25 a fingerprinted chunk carries no robots header',
      asset.headers[POSTURE.robots] === undefined,
      `x-robots-tag: ${asset.headers[POSTURE.robots] ?? '<absent>'}`);

    const wrong = await A.request(`/i/${GOOD}`, { method: 'POST', body: '{}' });
    check('HR-26 a door answers documents and nothing else',
      wrong.status === 405 && (wrong.headers['allow'] ?? '').includes('GET'),
      `status ${wrong.status}, allow ${wrong.headers['allow'] ?? '<absent>'}`);

    const head = await A.request(`/i/${GOOD}`, { method: 'HEAD' });
    check('HR-27 HEAD carries the same posture as GET and no body',
      head.status === 200 && head.headers[POSTURE.robots] === NOINDEX_CONTENT && head.text === '',
      `status ${head.status}, x-robots-tag ${head.headers[POSTURE.robots] ?? '<absent>'}`);

    // The credential's transport, read from the server that receives it.
    const calls = observed.filter((entry) => entry.url === '/rest/v1/rpc/resolve_public_invitation');
    const tokensAsked = new Set(calls.map((entry) => entry.headers['x-invitation-token']));
    const neverReachedUpstream = [MALFORMED, HOUSEHOLD, REVIEW]
      .filter((token) => observed.some((entry) => JSON.stringify(entry).includes(token)));
    check('HR-28 only the exact published shape reached the resolver',
      tokensAsked.size === 3 && [...tokensAsked].every((t) => [GOOD, UNKNOWN, REVOKED].includes(t)),
      `${calls.length} calls, ${tokensAsked.size} distinct tokens`);
    check('HR-29 a `/g/`, a `/r/` and a malformed address were never sent upstream',
      neverReachedUpstream.length === 0, neverReachedUpstream.join(', '));
    check('HR-30 the credential never entered the upstream URL or the body',
      calls.every((entry) => ALL_CREDENTIALS.every((token) => !entry.url.includes(token))
        && entry.body === '{}' && !entry.body.includes(GOOD)),
      `paths: ${[...new Set(calls.map((entry) => entry.url))].join(', ') || '<none>'}`);
    check('HR-31 the credential travelled only in its own header, with the api profile',
      calls.every((entry) => typeof entry.headers['x-invitation-token'] === 'string'
        && entry.headers['content-profile'] === 'api'
        && entry.headers.apikey === PUBLISHABLE
        && entry.headers.authorization === `Bearer ${PUBLISHABLE}`),
      calls.map((entry) => Object.keys(entry.headers).sort().join('+')).join(' | '));
    check('HR-32 no privileged value ever left the Worker toward the upstream',
      observed.every((entry) => !JSON.stringify(entry).includes(SERVICE_ROLE_SHAPE)));

    note('');
    note(`  upstream calls observed: ${calls.length}`);
    note(`  resolver paths asked for: ${[...new Set(calls.map((entry) => entry.url))].join(', ') || '<none>'}`);
    note(`  header names on an upstream call: ${calls.length > 0 ? Object.keys(calls[0].headers).sort().join(', ') : '<none>'}`);
  }

  // ---- Boot B — a host with no configuration at all.
  const B = await bootWrangler('B-unconfigured', PORT_BASE + 1, [
    ['VITE_SUPABASE_URL', ''],
    ['VITE_SUPABASE_PUBLISHABLE_KEY', ''],
  ]);

  if (B !== null) {
    const cold = await B.request(`/i/${GOOD}`);
    const coldDiagnostic = await waitForDiagnostic(
      B, 'no card served for the /i/ door (host-unconfigured)',
    );
    check('HR-33 an unconfigured host is not a 500: the guest still gets a page',
      cold.status === 200 && cold.digest === sha256(expectedBareBody), `status ${cold.status}`);
    // The Worker's own word for why it refused is the inside proof that this boot saw no ambient
    // configuration: had the repository's `.env.local` been discovered, the reason would have been an
    // upstream one and this line would name it.
    check('HR-34 the boot really was unconfigured (no ambient .env leaked in)',
      coldDiagnostic !== null,
      coldDiagnostic === null
        ? '<no host-unconfigured diagnostic inside 10 s>'
        : `the Worker named the refusal after ${coldDiagnostic} ms`);
    if (A !== null) {
      const refused = await A.request(`/i/${UNKNOWN}`);
      check('HR-35 an unconfigured host is byte-identical to an unknown credential',
        cold.digest === refused.digest, `${cold.digest.slice(0, 12)} vs ${refused.digest.slice(0, 12)}`);
    }
    const home = await B.request('/');
    check('HR-36 an unconfigured host still serves the site', home.status === 200 && home.digest === sha256(shellBytes));
  }

  // ---- Boot C — configured against a port nothing listens on.
  const deadPort = await freePort();
  const C = await bootWrangler('C-unreachable', PORT_BASE + 2, [
    ['VITE_SUPABASE_URL', `http://127.0.0.1:${deadPort}`],
    ['VITE_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE],
    ['VIVAAH_PUBLIC_ORIGIN', PUBLIC_ORIGIN],
  ]);
  if (C !== null) {
    const down = await C.request(`/i/${GOOD}`);
    const downDiagnostic = await waitForDiagnostic(
      C, 'no card served for the /i/ door (upstream-unreachable)',
    );
    check('HR-37 an unreachable database answers the same refusal as no database',
      down.status === 200 && down.digest === sha256(expectedBareBody), `status ${down.status}`);
    check('HR-38 and it says so in its own vocabulary',
      downDiagnostic !== null,
      downDiagnostic === null
        ? '<no upstream-unreachable diagnostic inside 10 s>'
        : `the Worker named the refusal after ${downDiagnostic} ms`);
    if (B !== null) {
      const unconfigured = await B.request(`/i/${GOOD}`);
      check('HR-39 the three refusals are one shape, so probing learns nothing',
        down.digest === unconfigured.digest, `${down.digest.slice(0, 12)} vs ${unconfigured.digest.slice(0, 12)}`);
    }
  }

  // ---- The Worker's own output, across every boot.
  note('');
  const workerDiagnostics = [];
  const linesPerBoot = [];
  let accessLogWithCredential = 0;
  for (const { name, getCapture } of servers) {
    const capture = getCapture();
    writeFileSync(join(SCRATCH, `wrangler-${name}.log`), capture);
    let forBoot = 0;
    for (const raw of capture.split(/\r?\n/)) {
      const line = stripAnsi(raw.trim());
      if (line.includes('vivaahvarnam:')) {
        workerDiagnostics.push(line);
        forBoot += 1;
      }
      if (/GET|HEAD|POST/.test(line) && ALL_CREDENTIALS.some((c) => line.includes(c))) accessLogWithCredential += 1;
    }
    linesPerBoot.push(`${name}=${forBoot}`);
  }
  // What this check asserts, and what it deliberately stopped asserting.
  //
  // The first draft compared the *number* of diagnostic lines to 8. That number is this tier's own request
  // ledger times how fast the dev server's log channel happened to flush, and neither is a property of the
  // product: the mutation run that deleted the `x-robots-tag` line moved boot B from one diagnostic to two,
  // because HR-39 asks that boot a second time and the second line had simply not arrived yet in the
  // earlier green runs. An assertion that can be moved by a re-request is a count of the instrument, so the
  // count is reported and the claim is made about the vocabulary instead: the set of reasons the Worker
  // named must be exactly the set of refusals this run provoked. A reason going silent is red — that is the
  // witness the leak checks below need — and so is a reason nobody provoked. A door that logged twice is
  // neither, and the per-boot line counts say where it did.
  const REASONS_PROVOKED = new Map([
    ['address-not-an-invitation', 'HR-15 a malformed credential, HR-16 a `/g/`, HR-17 a `/r/`'],
    ['payload-refused', 'HR-13 an unknown credential: the upstream answers, and the answer is not an invitation'],
    ['upstream-status-500', 'HR-14 a revoked-shaped credential: the stub refuses with 500'],
    ['host-unconfigured', 'HR-33/35/39 on boot B, which was booted with no configuration at all'],
    ['upstream-unreachable', 'HR-37/38 on boot C, which points at a port that was closed before the request'],
  ]);
  const reasonOf = (line) => (line.match(/\(([^()]*)\)\s*$/) ?? [, '<no reason named>'])[1];
  const observedReasons = new Set(workerDiagnostics.map(reasonOf));
  const neverNamed = [...REASONS_PROVOKED.keys()].filter((r) => !observedReasons.has(r));
  const neverProvoked = [...observedReasons].filter((r) => !REASONS_PROVOKED.has(r));
  check('HR-40 every refusal this run provoked was named by the Worker, and nothing else was',
    neverNamed.length === 0 && neverProvoked.length === 0,
    neverNamed.length > 0 || neverProvoked.length > 0
      ? `never named: ${neverNamed.map((r) => `${r} <- ${REASONS_PROVOKED.get(r)}`).join(' ; ') || '<none>'}`
        + ` | named unprovoked: ${neverProvoked.join(', ') || '<none>'}`
      : `${workerDiagnostics.length} line(s) naming ${observedReasons.size} reason(s); lines per boot ${linesPerBoot.join(' ')}`);
  const leakedInDiagnostics = workerDiagnostics.filter((line) => ALL_CREDENTIALS.some((c) => line.includes(c)));
  check('HR-41 no credential appears in any Worker diagnostic line',
    leakedInDiagnostics.length === 0, `${leakedInDiagnostics.length} line(s) named`);
  const leakedKey = workerDiagnostics.filter((line) => line.includes(PUBLISHABLE));
  check('HR-42 no key value appears in any Worker diagnostic line', leakedKey.length === 0);
  note(`  measured, not asserted: the dev server's own access log printed the request path, so it `
    + `contains a credential on ${accessLogWithCredential} line(s). That log is wrangler's, not this `
    + `Worker's; a deployed Pages project has no such stdout, and the address in it is the address the `
    + `guest typed. The rule this tier guards is the *upstream* log, which HR-30 measures.`);

  // ---- Non-vacuity: the tier must be capable of failing.
  check('HR-43 the card body and the refusal body differ, so HR-06 is not comparing a string to itself',
    expectedCardBody !== null && sha256(expectedCardBody) !== sha256(expectedBareBody));
  check('HR-44 the refusal body carries no card where the shell carried one, so the brand strip really ran',
    cardMetaElements(shellBytes).length > 0 && cardMetaElements(expectedBareBody).length === 0,
    `raw shell ${cardMetaElements(shellBytes).length} card tag(s), built refusal ${cardMetaElements(expectedBareBody).length}`);

  writeFileSync(join(SCRATCH, 'report.txt'), `${lines.join('\n')}\n`);
  writeFileSync(join(SCRATCH, 'observed-upstream.json'), `${JSON.stringify(
    observed.map((entry) => ({
      method: entry.method,
      url: entry.url,
      body: entry.body,
      headerNames: Object.keys(entry.headers).sort(),
      // Named, not quoted: the record says which fixture door this call was made for and how long the
      // value was, which is everything a reader needs to re-derive it, and none of what a scraper of
      // this evidence folder would need to re-play it.
      credentialKind: CREDENTIAL_LABEL.get(
        Object.entries(entry.headers).find(([k]) => k === 'x-invitation-token')?.[1],
      ) ?? (entry.headers['x-invitation-token'] === undefined ? 'none' : 'unrecognised'),
      credentialLength: String(entry.headers['x-invitation-token'] ?? '').length,
      apikeyLength: String(entry.headers.apikey ?? '').length,
    })), null, 2,
  )}\n`);
  teardown();
  stub.close();

  say('');
  say(`${measurements.length} measurements, ${lines.filter((l) => l.startsWith('PASS')).length} PASS, `
    + `${findings.length} FINDING(s), ${bootErrors.length} harness failure(s).`);
  say(`evidence: ${SCRATCH}`);
  if (bootErrors.length > 0) process.exit(2);
  process.exit(findings.length > 0 ? 1 : 0);
}

process.on('SIGINT', () => { teardown(); process.exit(130); });
main().catch((error) => {
  teardown();
  console.error(`host-response-contract: crashed — ${error?.stack ?? String(error)}`);
  process.exit(2);
});
