#!/usr/bin/env node
// VIVAAHVARNAM — Stage 9 §10.1 probe: drive the Open Graph serving harness the way a crawler would.
//
// Why this file exists. The unit battery on `src/lib/ogMetadata.ts` pins the tag arithmetic; the render
// sweep pins what a browser paints. Neither proves the three things §10.1 asks to be proved about a
// *response*: that the shell's brand tags are removed rather than shadowed, that the bytes a crawler
// reads are the bytes the manifest digests, and that an address withdrawn from publication stops
// answering without the server being restarted. This file starts `scripts/og-serving-adapter.mjs` as a
// child process, requests each document through it with `facebookexternalhit` and `Twitterbot`, and
// measures the replies.
//
// What it is not. §10.2's honest claim is `PARTIAL (local contract only)`: no WhatsApp, Telegram or
// other unfurl is contacted, no hosted target is used, and nothing here binds a port beyond 127.0.0.1.
// The documents are the three fixture generations plus the sharing-relevant content shapes from the
// render sweep, restated here through the fixture builder — the sweep's own matrix builds its documents
// by creating weddings in the local stack, which this tier does not need and must not reach.
//
// Two properties of the data, stated because they shape the assertions:
//   * The `/i/<credential>` and `/previews/<key>` values are derived from each case's name by `sha256`,
//     so a rerun asks the harness for the same addresses and they are not live capabilities. They are
//     still masked on every line this tier prints: §10.3 puts the served strings "on record" by hashing
//     them, and a tier that prints a credential-shaped string into a log it does not protect teaches the
//     next stage that the discipline is decorative.
//   * The preview image is a 1×1 PNG written to scratch, standing in for the `og_image` artefact the
//     render worker draws in S9-6. What §10.1 asks to be proved is that the served bytes equal the
//     manifest's `content_digest`, and that relation holds at any size; the drawing itself is proved
//     there, not here.
//
// Usage:
//   npm run build
//   node scripts/stage9-og-serving.mjs
//
// Exit code 1 means a finding was recorded; a harness that will not start, will not answer, or throws
// is a harness failure and exits 2.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  guestInvitation,
  guestInvitationPacked,
  guestInvitationV1,
} from '../src/test/invitationFixture.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER = join(ROOT, 'scripts', 'og-serving-adapter.mjs');
const SHELL = resolve(ROOT, process.env.STAGE9_OG_SHELL ?? 'dist/index.html');
const PORT = Number(process.env.STAGE9_OG_PORT ?? '4391');
const HOST_ORIGIN = `http://127.0.0.1:${PORT}`;
/** What the harness pretends to be: a public, `https`, path-free origin — the only shape §9.3's door
 *  allows a shared invitation address to have. */
const PUBLIC_ORIGIN = 'https://vivaahvarnam.example';

const RUN_TAG = `s9-og-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const EVIDENCE_DIR = resolve(process.env.STAGE9_EVIDENCE_DIR ?? join(ROOT, '..', 'q9-logs'));
const SCRATCH = join(EVIDENCE_DIR, RUN_TAG);
mkdirSync(SCRATCH, { recursive: true });
const STATE = join(SCRATCH, 'state.json');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** A credential from the alphabet the door accepts, derived from the case's own name so a rerun asks
 *  for the same addresses. */
const credentialFor = (kind, name) =>
  createHash('sha256').update(`${kind}:${name}`).digest('base64url').slice(0, 43);

const clone = (value) => JSON.parse(JSON.stringify(value));

// --------------------------------------------------------------------- reporting

const findings = [];
const lines = [];
const TOKEN_SHAPED = /(^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
const mask = (text) => String(text).replace(TOKEN_SHAPED, '$1<credential>');
/** Only ever the masked form is kept, so `report.txt` is the same record the console saw and §E's
 *  assertion about this tier's own output is about bytes that were actually written. */
const say = (text) => { const out = mask(text); lines.push(out); console.log(out); };
const check = (id, ok, detail) => {
  say(`${ok ? 'PASS' : 'FINDING'} ${id}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) findings.push(`${id}${detail === undefined ? '' : `: ${detail}`}`);
};
const measured = (label, value) => say(`  ${label}: ${value}`);

// --------------------------------------------------------------------- documents

// The sweep's long-form and hostile needles, restated so this tier exercises the same content through a
// server rather than only through a function call.
const LONG_TA = 'வணக்கம் '.repeat(40) + 'இந்த அழைப்பு அனைவருக்கும். '.repeat(6);
const UNBROKEN_EN = 'A'.repeat(200) + 'B'.repeat(200);
const HOSTILE_TITLE = '"><script>alert(1)</script>';
const LONG_VENUE = `Sri ${'Mahal '.repeat(45)}Kanchipuram`;
const WHEN = '14 November 2026 · 7:30 AM – 9:00 AM';
const CEREMONY_LINE = `${WHEN}, Sri Kanchi Mahal`;

const invitationWith = (invitation, mutate) => {
  const copy = clone(invitation);
  mutate(copy);
  return copy;
};
const withVenue = (invitation, venue) => invitationWith(invitation, (doc) => {
  doc.events[0].venue = { name: 'Sri Kanchi Mahal', address_text: null, map_url: null, ...venue };
});

const CASES = [
  {
    name: 'no-pack-tamil',
    invitation: () => guestInvitation({ language: 'ta' }),
    title: 'Arun weds Deepa',
    description: CEREMONY_LINE,
  },
  {
    // §10.1's triple is per artefact and language-agnostic: `primary_language` selects the wording a
    // guest reads, not a different card. Same title, same ceremony line.
    name: 'no-pack-english',
    invitation: () => guestInvitation({ language: 'en' }),
    title: 'Arun weds Deepa',
    description: CEREMONY_LINE,
  },
  {
    name: 'approved-pack',
    invitation: () => guestInvitationPacked(),
    title: 'Arun weds Deepa',
    description: CEREMONY_LINE,
  },
  {
    name: 'legacy-v1',
    invitation: () => guestInvitationV1(),
    title: 'Arun weds Deepa',
    description: CEREMONY_LINE,
  },
  {
    // Sweep shape 7: Tamil prose long enough that the title exceeds the bound.
    name: 'long-tamil',
    invitation: () => invitationWith(guestInvitation({ language: 'ta' }),
      (doc) => { doc.title = LONG_TA.slice(0, 120); }),
    title: LONG_TA.slice(0, 120),
    description: CEREMONY_LINE,
  },
  {
    // Sweep shape 8: a title with no break point anywhere — §10.3's overshoot case.
    name: 'unbroken-english',
    invitation: () => invitationWith(guestInvitation({ language: 'en' }), (doc) => { doc.title = UNBROKEN_EN; }),
    title: UNBROKEN_EN,
    description: CEREMONY_LINE,
  },
  {
    // Sweep shape 10: markup in the title, and a venue whose map link is a script URL.
    name: 'hostile-markup',
    invitation: () => withVenue(
      invitationWith(guestInvitation({ language: 'en' }), (doc) => { doc.title = HOSTILE_TITLE; }),
      { map_url: 'javascript:alert(6)' },
    ),
    title: HOSTILE_TITLE,
    description: CEREMONY_LINE,
  },
  {
    // A document with no ceremonies at all: the description ladder's last rung is the host's welcome,
    // and nothing is invented in place of a date.
    name: 'no-events',
    invitation: () => invitationWith(guestInvitation({ language: 'en' }), (doc) => { doc.events = []; }),
    title: 'Arun weds Deepa',
    description: 'With the blessings of our elders',
  },
  {
    // A ceremony with a start and no end: one clock, not a range.
    name: 'no-end-time',
    invitation: () => invitationWith(guestInvitation({ language: 'en' }),
      (doc) => { delete doc.events[0].ends_at_local; }),
    title: 'Arun weds Deepa',
    description: '14 November 2026 · 7:30 AM, Sri Kanchi Mahal',
  },
  {
    // No venue name: the card says when, and does not invent where. An address is not a place name.
    name: 'no-venue-name',
    invitation: () => withVenue(guestInvitation({ language: 'en' }),
      { name: null, address_text: '12 Temple Street' }),
    title: 'Arun weds Deepa',
    description: WHEN,
  },
  {
    // The composed line, not only its venue slot, is what exceeds 300 codepoints here.
    name: 'long-venue',
    invitation: () => withVenue(guestInvitation({ language: 'en' }), { name: LONG_VENUE }),
    title: 'Arun weds Deepa',
    description: `${WHEN}, ${LONG_VENUE}`,
    descriptionPrefix: `${WHEN}, Sri `,
    descriptionTail: 'Kanchipuram',
  },
];

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const PREVIEW_FILE = join(SCRATCH, 'preview.png');
writeFileSync(PREVIEW_FILE, PNG_1PX);
const PREVIEW_DIGEST = sha256(PNG_1PX);

const stateFor = (origin, names) => ({
  origin,
  invitations: CASES
    .filter((testCase) => names === null || names.includes(testCase.name))
    .map((testCase) => ({
      name: testCase.name,
      token: credentialFor('i', testCase.name),
      payload: { available: true, invitation: testCase.invitation() },
      // A separate opaque key: an unfurl that shows both must not let one address be used to guess the
      // other, and §10.3's published preview is a different capability from the guest's own link.
      preview: {
        path: `/previews/${credentialFor('preview', testCase.name)}.png`,
        file: PREVIEW_FILE,
        content_digest: PREVIEW_DIGEST,
      },
    })),
  revoked: [],
});

const writeState = (state) => { writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`); };
const entryFor = (state, name) => state.invitations.find((candidate) => candidate.name === name);

// --------------------------------------------------------------------- the harness as a child

const childLines = { stdout: [], stderr: [] };
let child;

async function startAdapter() {
  if (!existsSync(SHELL)) throw new Error(`no shell at ${SHELL}: run \`npm run build\` first`);
  writeState(stateFor(PUBLIC_ORIGIN, null));
  child = spawn(process.execPath, [ADAPTER, '--port', String(PORT), '--shell', SHELL, '--state', STATE], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => childLines.stdout.push(String(chunk)));
  child.stderr.on('data', (chunk) => childLines.stderr.push(String(chunk)));
  child.on('exit', (code, signal) => say(`harness exited code=${code ?? 'null'} signal=${signal ?? 'null'}`));
  const deadline = Date.now() + 15000;
  while (!childLines.stdout.join('').includes('listening on')) {
    if (Date.now() > deadline) throw new Error(`harness did not start:\n${childLines.stderr.join('')}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function stopAdapter() {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    const deadline = Date.now() + 5000;
    while (child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  }
}

const USER_AGENTS = [
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Twitterbot/1.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
];
const uaLabel = (userAgent) => userAgent.split(/[ /]/)[0];

const responses = [];

async function fetchRaw(path, { userAgent = USER_AGENTS[0], method = 'GET' } = {}) {
  const res = await fetch(`${HOST_ORIGIN}${path}`, {
    method,
    redirect: 'manual',
    headers: { 'user-agent': userAgent, accept: method === 'GET' ? 'text/html' : '*/*' },
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  const headers = Object.fromEntries(res.headers);
  responses.push({ path, method, userAgent, status: res.status, bytes, headers });
  return { status: res.status, headers, bytes, text: bytes.toString('utf8') };
}

// --------------------------------------------------------------------- HTML reading

const META_TAG = /<meta\b[^>]*>/gi;
const attrIn = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m === null ? undefined : m[1];
};
const unescapeAttr = (value) => value
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

/** Every `og:`/`twitter:` tag in a document, in document order, with attribute values read back. */
const socialTags = (html) => {
  const out = new Map();
  for (const tag of html.match(META_TAG) ?? []) {
    const key = attrIn(tag, 'property') ?? attrIn(tag, 'name');
    if (key !== undefined && /^(?:og:|twitter:)/.test(key)) {
      out.set(key, unescapeAttr(attrIn(tag, 'content') ?? ''));
    }
  }
  return out;
};
const metaCount = (html) => (html.match(META_TAG) ?? []).length;
const titleOf = (html) => {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
  return m === null ? null : m[1];
};

// --------------------------------------------------------------------- §10.3 clamp reading

const OG_TITLE_LIMIT = 88;
const OG_DESCRIPTION_LIMIT = 300;

/** Read a bound the served bytes either honour or visibly overshoot, and say which. A word boundary is
 *  required in both cases: the stage refuses a mid-word cut, so an overshoot is a whole word too. */
function assertClamp(id, label, original, served, limit) {
  const servedLength = Array.from(served).length;
  if (Array.from(original).length <= limit) {
    check(`${id}/${label}/whole-value-stays`, served === original, `${servedLength} codepoints`);
    return;
  }
  if (served === original) {
    check(`${id}/${label}/overshoot-is-the-whole-value`, !/\s/.test(original),
      `${servedLength} codepoints served whole because the value has no break point`);
    return;
  }
  const isPrefix = original.startsWith(served);
  const next = original[served.length];
  check(`${id}/${label}/bound`, isPrefix && servedLength <= limit,
    `${servedLength} codepoints, prefix of the original: ${isPrefix}`);
  check(`${id}/${label}/word-boundary`, isPrefix && next !== undefined && /\s/.test(next),
    `character after the cut: ${JSON.stringify(next)}`);
  check(`${id}/${label}/no-invented-ellipsis`, !/[…]/.test(served) && !served.includes('...'), 'no ellipsis');
}

// --------------------------------------------------------------------- phases

async function phaseContract() {
  say('');
  say('=== A. the exact tag set, per document, per user-agent ===');
  const shell = readFileSync(SHELL, 'utf8');
  const shellSocial = socialTags(shell);
  const EXPECTED = ['og:title', 'og:description', 'og:type', 'og:image', 'og:url', 'twitter:card'];
  const brandOnlyKeys = [...shellSocial.keys()].filter((key) => !EXPECTED.includes(key));
  say(`shell ${SHELL}: ${shellSocial.size} brand social tags, ${metaCount(shell)} <meta> in total`);
  check('shell/has-brand-tags', shellSocial.size > 0, `${shellSocial.size} to be replaced`);
  check('shell/brand-only-keys-exist', brandOnlyKeys.length > 0, brandOnlyKeys.join(', '));
  check('shell/title-is-brand', titleOf(shell) === 'VivaahVarnam — Digital Wedding Patrika', titleOf(shell));

  for (const testCase of CASES) {
    const state = stateFor(PUBLIC_ORIGIN, [testCase.name]);
    writeState(state);
    const entry = entryFor(state, testCase.name);
    const servedBy = new Map();
    for (const userAgent of USER_AGENTS) {
      const res = await fetchRaw(`/i/${entry.token}`, { userAgent });
      check(`http/${testCase.name}/${uaLabel(userAgent)}/200`, res.status === 200, `status ${res.status}`);
      check(`headers/${testCase.name}/${uaLabel(userAgent)}/noindex`,
        res.headers['x-robots-tag'] === 'noindex, nofollow', `X-Robots-Tag ${res.headers['x-robots-tag']}`);
      check(`headers/${testCase.name}/${uaLabel(userAgent)}/no-store`,
        res.headers['cache-control'] === 'no-store', `Cache-Control ${res.headers['cache-control']}`);
      check(`headers/${testCase.name}/${uaLabel(userAgent)}/html`,
        res.headers['content-type'] === 'text/html; charset=utf-8', `Content-Type ${res.headers['content-type']}`);
      servedBy.set(userAgent, res.text);
    }
    const distinct = new Set([...servedBy.values()].map((html) => sha256(Buffer.from(html, 'utf8'))));
    check(`ua/${testCase.name}/one-response-per-document`, distinct.size === 1,
      `${servedBy.size} user-agents, ${distinct.size} distinct bodies (this harness does not vary by UA)`);

    const html = servedBy.get(USER_AGENTS[0]);
    const tags = socialTags(html);
    check(`tags/${testCase.name}/exact-set-in-order`,
      JSON.stringify([...tags.keys()]) === JSON.stringify(EXPECTED), `served ${JSON.stringify([...tags.keys()])}`);
    check(`tags/${testCase.name}/brand-only-keys-gone`,
      brandOnlyKeys.every((key) => !tags.has(key)), `survivors: ${brandOnlyKeys.filter((key) => tags.has(key)).join(', ') || 'none'}`);
    check(`tags/${testCase.name}/brand-copy-gone`,
      tags.get('og:title') !== shellSocial.get('og:title')
      && tags.get('og:description') !== shellSocial.get('og:description'));
    check(`tags/${testCase.name}/meta-count-is-shell-minus-brand-plus-contract`,
      metaCount(html) === metaCount(shell) - shellSocial.size + EXPECTED.length,
      `${metaCount(html)} vs ${metaCount(shell)} shell − ${shellSocial.size} brand + ${EXPECTED.length} contract`);
    check(`tags/${testCase.name}/page-title-untouched`, titleOf(html) === titleOf(shell),
      '§10.3 leaves <title> alone');
    check(`tags/${testCase.name}/type`, tags.get('og:type') === 'website', tags.get('og:type'));
    check(`tags/${testCase.name}/card`, tags.get('twitter:card') === 'summary_large_image', tags.get('twitter:card'));
    check(`tags/${testCase.name}/url-is-the-public-door`,
      tags.get('og:url') === `${PUBLIC_ORIGIN}/i/${entry.token}`
      && /^https:\/\/[^/]+\/i\/[A-Za-z0-9_-]{43}$/.test(tags.get('og:url') ?? ''), tags.get('og:url'));
    check(`tags/${testCase.name}/image-is-a-separate-key`,
      tags.get('og:image') === `${PUBLIC_ORIGIN}${entry.preview.path}`
      && !tags.get('og:image').includes(entry.token), tags.get('og:image'));
    check(`tags/${testCase.name}/description-is-what-the-document-says`,
      (() => {
        const served = tags.get('og:description') ?? '';
        if (Array.from(testCase.description).length <= OG_DESCRIPTION_LIMIT) return served === testCase.description;
        // §10.3's bound applies to the *composed* line, so this case asserts the ceremony keeps its
        // place at the front and the venue's tail is what goes. The byte-exact strings are on record as
        // the digests §F prints; an over-bound value is clamped, and a word-for-word copy here would be
        // the module's arithmetic restated in the probe.
        return served.startsWith(testCase.descriptionPrefix) && !served.includes(testCase.descriptionTail);
      })(),
      `served ${JSON.stringify((tags.get('og:description') ?? '').slice(0, 72))}`);
    assertClamp(`clamp/${testCase.name}`, 'title', testCase.title, tags.get('og:title') ?? '', OG_TITLE_LIMIT);
    assertClamp(`clamp/${testCase.name}`, 'description', testCase.description,
      tags.get('og:description') ?? '', OG_DESCRIPTION_LIMIT);

    // The words a guest's page carries but a card must not: family lines, release wording, the lunch
    // note, the venue address, and any markup the host was given.
    const forbidden = ['[placeholder blessing line', 'Lunch follows the ceremony', '12 Temple Street',
      '<script>alert', 'javascript:'];
    for (const needle of forbidden) {
      check(`silence/${testCase.name}/${needle.slice(0, 18)}`, !html.includes(needle));
    }
    measured(`response sha256 ${testCase.name}`, sha256(Buffer.from(html, 'utf8')));
  }

  // One positive control that escaping is real rather than assumed: the hostile title's attribute.
  writeState(stateFor(PUBLIC_ORIGIN, ['hostile-markup']));
  const hostile = await fetchRaw(`/i/${entryFor(stateFor(PUBLIC_ORIGIN, ['hostile-markup']), 'hostile-markup').token}`);
  check('escape/hostile-title-is-attribute-encoded',
    hostile.text.includes('content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'),
    'and reads back as the host wrote it (§A round-trips every value)');
  check('escape/no-executable-script-from-a-title', !/<script>alert/i.test(hostile.text));
}

async function phaseImage() {
  say('');
  say('=== B. the preview object: served bytes against the manifest digest ===');
  const state = stateFor(PUBLIC_ORIGIN, null);
  writeState(state);
  const entry = entryFor(state, 'no-pack-tamil');
  check('image/fixture-is-a-real-png', PNG_1PX.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    `${PNG_1PX.length} bytes, 1×1`);
  const res = await fetchRaw(entry.preview.path);
  check('image/status', res.status === 200, `status ${res.status}`);
  check('image/content-type', res.headers['content-type'] === 'image/png', res.headers['content-type']);
  check('image/no-store', res.headers['cache-control'] === 'no-store', res.headers['cache-control']);
  const servedDigest = sha256(res.bytes);
  check('image/digest-equals-manifest-content-digest',
    servedDigest === entry.preview.content_digest, `served ${servedDigest}`);
  check('image/byte-length', res.bytes.length === PNG_1PX.length, `${res.bytes.length} bytes`);
  check('image/bytes-identical', res.bytes.equals(PNG_1PX));
  measured('preview sha256', servedDigest);
  const missing = await fetchRaw('/previews/does-not-exist.png');
  check('image/unknown-preview-refuses', missing.status === 404, `status ${missing.status}`);
}

async function phaseLifecycle() {
  say('');
  say('=== C. revocation and rotation on one running harness (§9.2, no restart) ===');
  const name = 'no-pack-tamil';
  const live = stateFor(PUBLIC_ORIGIN, null);
  writeState(live);
  const entry = entryFor(live, name);
  const before = await fetchRaw(`/i/${entry.token}`);
  check('lifecycle/live-address-answers', before.status === 200, `status ${before.status}`);
  const beforeImage = await fetchRaw(entry.preview.path);
  check('lifecycle/live-preview-answers', beforeImage.status === 200, `status ${beforeImage.status}`);

  writeState({ ...live, revoked: [...live.revoked, entry.token] });
  const after = await fetchRaw(`/i/${entry.token}`);
  check('lifecycle/revoked-410', after.status === 410, `status ${after.status}`);
  check('lifecycle/revoked-body-is-the-vocabulary', after.text === '{"available":false}\n',
    `body ${JSON.stringify(after.text)}`);
  check('lifecycle/revoked-carries-no-tags', socialTags(after.text).size === 0,
    `${socialTags(after.text).size} social tags in a refusal body`);
  check('lifecycle/revoked-still-no-store', after.headers['cache-control'] === 'no-store',
    after.headers['cache-control']);
  const afterImage = await fetchRaw(entry.preview.path);
  check('lifecycle/revoked-preview-object-refused', afterImage.status === 410, `status ${afterImage.status}`,
    'the §10.2 seam deletes the object; a refusal is the local expression of that');

  const never = await fetchRaw(`/i/${credentialFor('i', 'never-published')}`);
  check('lifecycle/unknown-address-404', never.status === 404, `status ${never.status}`);
  check('lifecycle/unknown-carries-no-tags', socialTags(never.text).size === 0);

  // Rotation: the published address changes, the old one stops answering, and the new one's `og:url`
  // follows the entry rather than the request.
  const rotatedToken = credentialFor('i', `${name}-rotated`);
  writeState({
    ...live,
    invitations: live.invitations.map((candidate) =>
      (candidate.name === name ? { ...candidate, token: rotatedToken } : candidate)),
  });
  const oldAddress = await fetchRaw(`/i/${entry.token}`);
  const newAddress = await fetchRaw(`/i/${rotatedToken}`);
  check('lifecycle/rotated-out-address-404', oldAddress.status === 404, `status ${oldAddress.status}`);
  check('lifecycle/rotated-in-address-200', newAddress.status === 200, `status ${newAddress.status}`);
  check('lifecycle/rotated-url-follows-the-entry',
    socialTags(newAddress.text).get('og:url') === `${PUBLIC_ORIGIN}/i/${rotatedToken}`);
}

async function phaseNegativeControls() {
  say('');
  say('=== D. negative controls: the harness fails closed, never half-open ===');

  const controls = [
    // Each reason is the door's own, in the door's own order: protocol before host, host before path.
    { id: 'origin-is-a-name-that-resolves-locally', origin: 'https://localhost', reason: 'target-origin-not-public' },
    { id: 'origin-is-not-https', origin: 'http://vivaahvarnam.example', reason: 'target-not-https' },
    { id: 'origin-is-an-ipv4-literal', origin: `https://127.0.0.1:${PORT}`, reason: 'target-origin-not-public' },
    { id: 'origin-carries-a-path', origin: `${PUBLIC_ORIGIN}/tradition`, reason: 'target-path-shape' },
    { id: 'origin-is-a-private-door', origin: `${PUBLIC_ORIGIN}/g`, reason: 'target-private-door' },
  ];
  check('controls/list-is-not-empty', controls.length > 0, `${controls.length} misconfigurations`);
  for (const control of controls) {
    const state = stateFor(control.origin, [CASES[0].name]);
    writeState(state);
    const res = await fetchRaw(`/i/${entryFor(state, CASES[0].name).token}`);
    let body = {};
    try { body = JSON.parse(res.text); } catch { /* the two assertions below read the raw bytes */ }
    check(`control/${control.id}/500`, res.status === 500, `status ${res.status}`);
    check(`control/${control.id}/reason`, body.serving_error === `metadata-refused:${control.reason}`,
      `serving_error ${JSON.stringify(body.serving_error)}`);
    check(`control/${control.id}/no-tags-at-all`, socialTags(res.text).size === 0,
      'a partial card is the failure §10.1 exists to rule out');
  }

  const good = stateFor(PUBLIC_ORIGIN, [CASES[0].name]);
  const entry = entryFor(good, CASES[0].name);
  writeState({ ...good, invitations: [{ ...entry, payload: { invitation: entry.payload.invitation } }] });
  const refusedPayload = await fetchRaw(`/i/${entry.token}`);
  let refusedBody = {};
  try { refusedBody = JSON.parse(refusedPayload.text); } catch { /* asserted below */ }
  check('control/payload-the-parser-refuses/500', refusedPayload.status === 500,
    `status ${refusedPayload.status}`);
  check('control/payload-the-parser-refuses/reason', refusedBody.serving_error === 'payload-unparsable',
    `serving_error ${JSON.stringify(refusedBody.serving_error)}`);
  check('control/payload-the-parser-refuses/no-tags', socialTags(refusedPayload.text).size === 0);

  writeState({ origin: 'not-json-because-the-file-was-rewritten-partially' });
  const badState = await fetchRaw(`/i/${entry.token}`);
  check('control/state-file-unusable/500', badState.status === 500, `status ${badState.status}`);
  check('control/state-file-unusable/no-tags', socialTags(badState.text).size === 0);

  writeState(good);
  const unknownPath = await fetchRaw('/nothing-here');
  check('control/unknown-path-404', unknownPath.status === 404, `status ${unknownPath.status}`);
  const post = await fetchRaw(`/i/${entry.token}`, { method: 'POST' });
  check('control/post-405', post.status === 405 && post.headers.allow === 'GET, HEAD',
    `status ${post.status}, Allow ${post.headers.allow}`);
  const head = await fetchRaw(`/i/${entry.token}`, { method: 'HEAD' });
  const get = await fetchRaw(`/i/${entry.token}`);
  check('control/head-answers', head.status === 200, `status ${head.status}`);
  check('control/head-sends-no-bytes', head.bytes.length === 0, `${head.bytes.length} bytes`);
  check('control/head-content-length-matches-get',
    Number(head.headers['content-length']) === get.bytes.length,
    `HEAD ${head.headers['content-length']} vs GET ${get.bytes.length} bytes`);
  // `encodeURIComponent` is a no-op on the door's alphabet, so a percent-encoding control has to build
  // its own escaping: an encoded spelling of the same letters must not be decoded into a match, because
  // the credential is compared as written, not as unescaped.
  const rawToken = credentialFor('i', CASES[0].name);
  const encodedToken = `%${rawToken.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}${rawToken.slice(1)}`;
  check('control/encoded-spelling-differs-from-the-token', encodedToken !== rawToken
    && encodedToken.includes('%'), 'the control would be vacuous otherwise');
  const encoded = await fetchRaw(`/i/${encodedToken}`);
  check('control/encoded-credential-is-not-the-same-address', encoded.status === 404,
    `status ${encoded.status}`);
  check('control/encoded-credential-carries-no-tags', socialTags(encoded.text).size === 0);
}

async function phasePrivacy() {
  say('');
  say('=== E. needles: what must not be in any byte this harness returned ===');
  check('needles/responses-were-collected', responses.length > 0, `${responses.length} responses`);
  const needles = [
    ['jwt-shaped-credential', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
    ['household-door-path', /\/g\//],
    ['review-door-path', /\/r\//],
    ['script-url', /javascript:/i],
    ['executable-script-tag', /<script>alert/i],
    ['service-role-mention', /service_role/i],
    ['storage-api-path', /\/storage\/v1\//],
    ['api-key-parameter', /[?&](api_key|apikey|key)=/i],
    ['postgres-connection-string', /postgres(ql)?:\/\//i],
  ];
  check('needles/list-is-not-empty', needles.length > 0, `${needles.length} needles`);
  needles.forEach(([name, re]) => {
    const hits = responses.filter((r) => re.test(r.bytes.toString('utf8')));
    check(`needles/${name}`, hits.length === 0, hits.length === 0
      ? `absent from ${responses.length} response bodies`
      : `found at ${hits.map((h) => mask(h.path)).join(', ')}`);
  });

  const envPath = join(ROOT, '.env.local');
  if (existsSync(envPath)) {
    const values = readFileSync(envPath, 'utf8').split(/\r?\n/)
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => line.slice(line.indexOf('=') + 1).trim().replace(/^"|"$/g, ''))
      .filter((value) => value.length >= 12);
    check('needles/configured-values-were-read', values.length > 0, `${values.length} values`);
    const allText = responses.map((r) => r.bytes.toString('utf8')).join('\n');
    const leaked = values.filter((value) => allText.includes(value));
    check('needles/no-configured-value-in-a-response', leaked.length === 0,
      leaked.length === 0 ? 'no .env.local value appears in any response' : `${leaked.length} leaks`);
  } else {
    say('DECLARED LIMITATION — .env.local is absent, so configured-key needles were not collected. '
      + 'The structural needles above were, and no payload in this tier comes from the stack.');
  }

  const harnessLog = `${childLines.stdout.join('')}${childLines.stderr.join('')}`;
  const tokens = new Set(CASES.map((c) => credentialFor('i', c.name)));
  const printedTokens = [...tokens].filter((token) => harnessLog.includes(token));
  check('logs/harness-prints-no-access-line', !/(GET|POST|HEAD) \//.test(harnessLog),
    'the harness has no access log, by design');
  check('logs/harness-prints-no-credential', printedTokens.length === 0,
    printedTokens.length === 0
      ? `none of the ${tokens.size} credentials in its stdout+stderr`
      : `found: ${printedTokens.length}`);
  measured('harness log lines', harnessLog.split(/\r?\n/).filter(Boolean).length);
  check('logs/harness-startup-line-exists', /listening on 127\.0\.0\.1/.test(harnessLog), harnessLog.split('\n')[0]);

  const tierLog = lines.join('\n');
  check('logs/this-tier-masked-every-credential',
    [...tokens].every((token) => !tierLog.includes(token)),
    `none of the ${tokens.size} credentials appears in this tier's own report`);
}

async function phaseRecord() {
  say('');
  say('=== F. §10.3: the exact strings that left the harness are on record ===');
  const state = stateFor(PUBLIC_ORIGIN, null);
  writeState(state);
  const rows = [];
  for (const testCase of CASES) {
    const entry = entryFor(state, testCase.name);
    const res = await fetchRaw(`/i/${entry.token}`);
    for (const [key, value] of socialTags(res.text)) {
      rows.push({
        name: testCase.name,
        key,
        codepoints: Array.from(value).length,
        digest: sha256(Buffer.from(value, 'utf8')),
      });
    }
  }
  check('record/attribute-values-were-hashed', rows.length === CASES.length * 6,
    `${rows.length} values across ${CASES.length} documents × 6 tags`);
  rows.forEach((row) => say(`  ${row.name} ${row.key} codepoints=${row.codepoints} sha256=${row.digest}`));
  const digests = responses.map((r) => sha256(r.bytes));
  check('record/every-response-body-hashed',
    digests.length === responses.length && digests.every((d) => /^[0-9a-f]{64}$/.test(d)),
    `${digests.length} response bodies hashed`);
}

// --------------------------------------------------------------------- main

async function main() {
  say(`stage9 §10.1 og serving probe ${RUN_TAG}`);
  say(`shell: ${SHELL}`);
  say(`scratch: ${SCRATCH}`);
  say(`harness: ${HOST_ORIGIN} answering as ${PUBLIC_ORIGIN}`);
  check('cases/list-is-not-empty', CASES.length > 0, `${CASES.length} documents`);
  await startAdapter();
  try {
    await phaseContract();
    await phaseImage();
    await phaseLifecycle();
    await phaseNegativeControls();
    await phasePrivacy();
    await phaseRecord();
  } finally {
    await stopAdapter();
  }

  say('');
  say(`checks run: ${lines.filter((l) => l.startsWith('PASS') || l.startsWith('FINDING')).length}`);
  say(`findings: ${findings.length}`);
  findings.forEach((finding) => say(`  - ${finding}`));
  const reportPath = join(SCRATCH, 'report.txt');
  writeFileSync(reportPath, `${lines.join('\n')}\n`);
  say(`report: ${reportPath}`);
  if (findings.length > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(`harness failure: ${error && error.stack ? error.stack : error}`);
  await stopAdapter();
  process.exitCode = 2;
});
