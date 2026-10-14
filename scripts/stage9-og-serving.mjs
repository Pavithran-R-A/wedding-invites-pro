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
//   * Every `/previews/<key>.png` is that case's **own** `og_image`, drawn by `src/render/` through the
//     same worker the raster tier drives. No bytes are shared between cases and none are invented: the
//     one document whose teaser the fit ladder refuses (`unbroken-english`, whose 400-letter title cannot
//     wrap into a 1200×630 box) is served with **no** `og:image` tag at all, which is §10.1's "nothing is
//     invented where the document is silent" applied to the image slot rather than to a text slot. §B
//     therefore proves three things at once: served bytes equal the manifest's `content_digest`, the
//     served PNG reads back as §5's box, and two documents that produce the same card text produce
//     different pixels.
//
// Usage:
//   npm run build
//   npm run preview -- --host 127.0.0.1 --port 4173 --strictPort    (a second shell: the render origin)
//   node scripts/stage9-og-serving.mjs
//
// Env: STAGE9_OG_SHELL, STAGE9_OG_PORT (the harness's own loopback port), STAGE9_PREVIEW_ORIGIN
//      (default http://127.0.0.1:4173), STAGE9_OG_CDP_PORT (default 9435), STAGE9_EVIDENCE_DIR.
// Exit code 1 means a finding was recorded; a harness that will not start, will not answer, throws, or a
// render origin that will not serve `dist/render.html` is a harness failure and exits 2.

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
import { OG_BOX } from '../src/render/outputGeometry.ts';
import { imageDimensions, openRenderWorker } from './stage9-render-worker.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER = join(ROOT, 'scripts', 'og-serving-adapter.mjs');
const SHELL = resolve(ROOT, process.env.STAGE9_OG_SHELL ?? 'dist/index.html');
const PORT = Number(process.env.STAGE9_OG_PORT ?? '4391');
const HOST_ORIGIN = `http://127.0.0.1:${PORT}`;
/** The origin the teaser is drawn from: the same `vite preview` of `dist/` the raster tier renders
 *  against. The worker asserts it is loopback before it opens a browser, so a tier that is pointed at a
 *  hosted target fails at this line rather than sending a fixture document to somebody's server. */
const PREVIEW_ORIGIN = process.env.STAGE9_PREVIEW_ORIGIN ?? 'http://127.0.0.1:4173';
const CDP_PORT = Number(process.env.STAGE9_OG_CDP_PORT ?? '9435');
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

/** §10.1's six pairs, in the order `src/lib/ogMetadata.ts` emits them. A set the harness *adds* to the
 *  shell rather than replacing into would fail the order assertion, which is why the order is pinned
 *  rather than the membership alone. */
const CONTRACT_TAGS = ['og:title', 'og:description', 'og:type', 'og:image', 'og:url', 'twitter:card'];

/** Each case's own `og:image`, drawn before the harness starts: `name → { file, content_digest, bytes,
 *  source_dto_digest, measured_height_px, dropped }`. A case the teaser ladder refuses has no entry —
 *  see `drawPreviews` — and a case with no entry gets no `preview` in the routing state, so the tag is
 *  absent from its card rather than pointed at something this tier made up. */
const previews = new Map();
/** `name → reason`, for the same cases: §B prints the name the product answered with, which is the only
 *  honest record of why a card has five tags instead of six. */
const previewRefusals = new Map();

/**
 * Render every case document through the product's own worker and keep its PNG.
 *
 * Three things this deliberately does not do: it does not draw one image and hand it to eleven addresses
 * (a shared preview file would make §B's byte-equality assertion about the harness, not about the
 * wedding); it does not fall back to a placeholder when the ladder refuses (a refusal is §5's designed
 * answer for a document that will not fit, and inventing pixels for it is the failure §10.1 names); and
 * it does not serve the artefact from the worker's own output directory, because that directory is named
 * by `(kind, variant, page)` and every one of these renders answers to the same filename — each copy
 * below is made from the bytes read at that path *before* the next render overwrites it.
 */
async function drawPreviews() {
  const worker = await openRenderWorker({
    origin: PREVIEW_ORIGIN, outputDir: join(SCRATCH, 'renders'), cdpPort: CDP_PORT,
  });
  try {
    for (const testCase of CASES) {
      const result = await worker.renderOgTeaser({ dto: testCase.invitation() });
      if (result.ok === false) {
        previewRefusals.set(testCase.name, result.reason);
        continue;
      }
      const artefact = result.artefacts.find((row) => row.name.endsWith('.png'));
      const bytes = readFileSync(artefact.path);
      const file = join(SCRATCH, `preview-${testCase.name}.png`);
      writeFileSync(file, bytes);
      previews.set(testCase.name, {
        file,
        // This tier's own digest of the bytes it is about to serve, hashed from the copy on disk rather
        // than copied from the worker's record — so §B's manifest comparison is about the harness, and
        // the comparison between the two digests is about the renderer and the hash agreeing.
        content_digest: sha256(bytes),
        worker_content_digest: artefact.content_digest,
        bytes: bytes.length,
        source_dto_digest: result.source_dto_digest,
        measured_height_px: result.measured_height_px,
        dropped: result.fit_plan.dropped,
        render_config_hash: artefact.render_config_hash,
      });
    }
  } finally {
    const closed = await worker.close();
    measured('preview worker profile removed', String(closed.profileRemoved));
    measured('preview renders', String(closed.renders));
  }
  // A tier that drew nothing has no subject: the render origin is down or the bundle is stale, which is
  // the definition of "unrunnable" in this file's exit-code vocabulary, and better said here than
  // discovered as a TypeError three phases later.
  if (previews.size === 0) {
    throw new Error(`no case drew a teaser from ${PREVIEW_ORIGIN}: `
      + `[${[...previewRefusals.entries()].map(([name, reason]) => `${name}=${reason}`).join(', ')}]`);
  }
}

/** §10.1's six pairs, minus the image for a document whose teaser was refused: `ogMetadata.ts` drops an
 *  empty slot instead of inventing one, and a card is only under this tier's contract to the extent its
 *  own document has something to put in it. */
const expectedTagsFor = (name) =>
  (previews.has(name) ? CONTRACT_TAGS : CONTRACT_TAGS.filter((key) => key !== 'og:image'));

const stateFor = (origin, names) => ({
  origin,
  invitations: CASES
    .filter((testCase) => names === null || names.includes(testCase.name))
    .map((testCase) => {
      const preview = previews.get(testCase.name);
      return {
        name: testCase.name,
        token: credentialFor('i', testCase.name),
        payload: { available: true, invitation: testCase.invitation() },
        // A separate opaque key: an unfurl that shows both must not let one address be used to guess the
        // other, and §10.3's published preview is a different capability from the guest's own link.
        // Spreading rather than setting `preview: null`, because the harness's own rule is
        // "no preview object in the state ⇒ no `og:image` in the card", and a null would be a third
        // spelling that rule has to guess between.
        ...(preview === undefined ? {} : {
          preview: {
            path: `/previews/${credentialFor('preview', testCase.name)}.png`,
            file: preview.file,
            content_digest: preview.content_digest,
            bytes: preview.bytes,
          },
        }),
      };
    }),
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
  const brandOnlyKeys = [...shellSocial.keys()].filter((key) => !CONTRACT_TAGS.includes(key));
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
    const expected = expectedTagsFor(testCase.name);
    check(`tags/${testCase.name}/exact-set-in-order`,
      JSON.stringify([...tags.keys()]) === JSON.stringify(expected),
      `served ${JSON.stringify([...tags.keys()])}, expected ${JSON.stringify(expected)}`);
    check(`tags/${testCase.name}/brand-only-keys-gone`,
      brandOnlyKeys.every((key) => !tags.has(key)), `survivors: ${brandOnlyKeys.filter((key) => tags.has(key)).join(', ') || 'none'}`);
    check(`tags/${testCase.name}/brand-copy-gone`,
      tags.get('og:title') !== shellSocial.get('og:title')
      && tags.get('og:description') !== shellSocial.get('og:description'));
    check(`tags/${testCase.name}/meta-count-is-shell-minus-brand-plus-contract`,
      metaCount(html) === metaCount(shell) - shellSocial.size + expected.length,
      `${metaCount(html)} vs ${metaCount(shell)} shell − ${shellSocial.size} brand + ${expected.length} contract`);
    check(`tags/${testCase.name}/page-title-untouched`, titleOf(html) === titleOf(shell),
      '§10.3 leaves <title> alone');
    check(`tags/${testCase.name}/type`, tags.get('og:type') === 'website', tags.get('og:type'));
    check(`tags/${testCase.name}/card`, tags.get('twitter:card') === 'summary_large_image', tags.get('twitter:card'));
    check(`tags/${testCase.name}/url-is-the-public-door`,
      tags.get('og:url') === `${PUBLIC_ORIGIN}/i/${entry.token}`
      && /^https:\/\/[^/]+\/i\/[A-Za-z0-9_-]{43}$/.test(tags.get('og:url') ?? ''), tags.get('og:url'));
    if (entry.preview === undefined) {
      // The one card that has no image, and the reason it has none: the teaser ladder refused to draw
      // this document rather than crop it (§B names the refusal). A URL invented here would point at an
      // object that does not exist, which is the half-open card §10.1 rules out.
      check(`tags/${testCase.name}/no-preview-no-image-tag`, !tags.has('og:image'),
        `teaser refused: ${previewRefusals.get(testCase.name)}`);
    } else {
      check(`tags/${testCase.name}/image-is-a-separate-key`,
        tags.get('og:image') === `${PUBLIC_ORIGIN}${entry.preview.path}`
        && !tags.get('og:image').includes(entry.token), tags.get('og:image'));
    }
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

/** The teaser route's own refusal vocabulary, copied from `scripts/stage9-render-worker.mjs`: the
 *  ladder's answer (`teaser-does-not-fit`), the two measurement disagreements that mean "the plan and
 *  the page do not agree", the worker's bounds (`render-timeout`, `worker-error`, `bytes-over-ceiling`,
 *  `artefact-box-mismatch`, `image-header-*`) and the parse gate's `invitation-refused`. A reason outside
 *  this list is not a designed outcome, so it must arrive as a finding rather than as a five-tag card. */
const TEASER_REFUSALS = [
  'teaser-does-not-fit', 'height-not-measurable', 'plan-says-fit-but-measurement-did-not',
  'render-timeout', 'worker-error', 'invitation-refused', 'bytes-over-ceiling', 'artefact-box-mismatch',
];
const isDesignedTeaserRefusal = (reason) =>
  typeof reason === 'string'
  && (TEASER_REFUSALS.includes(reason) || reason.startsWith('image-header-'));

const PNG_SIGNATURE = '89504e470d0a1a0a';

async function phaseImage() {
  say('');
  say('=== B. the preview objects: served bytes against the manifest, the artefact and the box ===');
  const state = stateFor(PUBLIC_ORIGIN, null);
  writeState(state);

  check('image/every-case-either-drew-or-was-refused',
    previews.size + previewRefusals.size === CASES.length,
    `${previews.size} drawn, ${previewRefusals.size} refused, ${CASES.length} cases`);
  for (const [name, reason] of previewRefusals) {
    check(`image/${name}/refusal-is-a-teaser-route-name-not-an-accident`,
      isDesignedTeaserRefusal(reason), `reason ${JSON.stringify(reason)}`);
    check(`image/${name}/refusal-wrote-no-preview-file`, !existsSync(join(SCRATCH, `preview-${name}.png`)),
      SCRATCH);
  }

  const servedDigests = new Map();
  for (const testCase of CASES) {
    const entry = entryFor(state, testCase.name);
    if (entry.preview === undefined) continue;
    const preview = previews.get(testCase.name);
    const res = await fetchRaw(entry.preview.path);
    check(`image/${testCase.name}/status`, res.status === 200, `status ${res.status}`);
    check(`image/${testCase.name}/content-type`,
      res.headers['content-type'] === 'image/png', res.headers['content-type']);
    check(`image/${testCase.name}/no-store`,
      res.headers['cache-control'] === 'no-store', res.headers['cache-control']);
    const servedDigest = sha256(res.bytes);
    servedDigests.set(testCase.name, servedDigest);
    check(`image/${testCase.name}/digest-equals-manifest-content-digest`,
      servedDigest === entry.preview.content_digest, `served ${servedDigest}`);
    check(`image/${testCase.name}/digest-equals-the-artefact-the-worker-recorded`,
      servedDigest === preview.worker_content_digest, `worker ${preview.worker_content_digest}`);
    // The address and the file are two different things: a harness that served the *wrong* file with the
    // right digest would be a broken manifest, and one that served the right file at the wrong address
    // would be a card pointing at somebody else's wedding. Both halves are asserted separately.
    check(`image/${testCase.name}/bytes-are-this-cases-own-artefact`,
      res.bytes.equals(readFileSync(preview.file)), `${res.bytes.length} bytes`);
    check(`image/${testCase.name}/byte-length`, res.bytes.length === entry.preview.bytes,
      `${res.bytes.length} bytes`);
    check(`image/${testCase.name}/is-a-png`,
      res.bytes.subarray(0, 8).toString('hex') === PNG_SIGNATURE,
      res.bytes.subarray(0, 8).toString('hex'));
    const dims = imageDimensions(res.bytes, 'png');
    check(`image/${testCase.name}/served-png-reads-back-as-the-og-box`,
      dims.ok === true && dims.width === OG_BOX.width && dims.height === OG_BOX.height,
      `${JSON.stringify(dims)} vs OG_BOX ${OG_BOX.width}x${OG_BOX.height} dpr ${OG_BOX.dpr}`);
    // Which rung of the ladder this card came from, printed rather than assumed: the drop list is the
    // product's answer about what a 630 px card leaves out, and it differs between these documents.
    measured(`teaser ${testCase.name}`,
      `height=${preview.measured_height_px} dropped=${JSON.stringify(preview.dropped)} `
      + `render_config_hash=${preview.render_config_hash}`);
  }
  check('image/every-drawn-preview-was-fetched',
    servedDigests.size === previews.size, `${servedDigests.size} of ${previews.size}`);

  // Two documents that produce the *same* card text must still produce different pixels. `no-pack-tamil`
  // and `no-pack-english` have the identical `og:title` and `og:description` (§A asserts both strings for
  // both cases), so if their previews matched, the image would be a function of the harness rather than of
  // the wedding — which is exactly what a shared stand-in file used to make unobservable.
  const pair = ['no-pack-tamil', 'no-pack-english'];
  const [first, second] = pair.map((name) => servedDigests.get(name));
  check('image/different-documents-get-different-previews',
    first !== undefined && second !== undefined && first !== second,
    `${pair[0]} ${first} vs ${pair[1]} ${second}`);

  // The converse witness, and the reason the check above is not a tautology about unique inputs: two of
  // this tier's documents draw byte-identical teasers while their parsed documents hash differently — so
  // a preview digest is a digest of what the surface *paints*, not of the DTO it was handed, and a field
  // the teaser does not draw cannot move it. Measured for this pair on both probe runs that preceded the
  // edit (`q9-logs/s9-6d-preview-render-probe.mjs`, `no-pack-tamil` and `legacy-v1` both
  // `d0088fb2…` from `80988b7e…` and `0771c98b…` documents), which is what makes it a fact about the
  // renderer rather than an accident of one run. §13's determinism, read from the serving side.
  const sameBytesPair = ['no-pack-tamil', 'legacy-v1'];
  const [sameA, sameB] = sameBytesPair.map((name) => servedDigests.get(name));
  const [dtoA, dtoB] = sameBytesPair.map((name) => previews.get(name)?.source_dto_digest);
  check('image/identical-teasers-are-a-drawn-document-fact-not-a-shared-file',
    sameA !== undefined && sameA === sameB && dtoA !== undefined && dtoA !== dtoB,
    `previews ${sameA} === ${sameB}, dto ${dtoA} vs ${dtoB}`);

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
  if (entry.preview === undefined) {
    // Nothing to fetch: the card this case answers with has no image, so §10.2's "delete the preview
    // object" has no object to delete. Both halves of that absence are asserted in §A and §B.
    check('lifecycle/live-preview-answers', false, `${name} has no preview object to revoke`);
    check('lifecycle/revoked-preview-object-refused', false, `${name} has no preview object to revoke`);
  } else {
    const beforeImage = await fetchRaw(entry.preview.path);
    check('lifecycle/live-preview-answers', beforeImage.status === 200, `status ${beforeImage.status}`);
  }

  writeState({ ...live, revoked: [...live.revoked, entry.token] });
  const after = await fetchRaw(`/i/${entry.token}`);
  check('lifecycle/revoked-410', after.status === 410, `status ${after.status}`);
  check('lifecycle/revoked-body-is-the-vocabulary', after.text === '{"available":false}\n',
    `body ${JSON.stringify(after.text)}`);
  check('lifecycle/revoked-carries-no-tags', socialTags(after.text).size === 0,
    `${socialTags(after.text).size} social tags in a refusal body`);
  check('lifecycle/revoked-still-no-store', after.headers['cache-control'] === 'no-store',
    after.headers['cache-control']);
  if (entry.preview !== undefined) {
    const afterImage = await fetchRaw(entry.preview.path);
    check('lifecycle/revoked-preview-object-refused', afterImage.status === 410, `status ${afterImage.status}`,
      'the §10.2 seam deletes the object; a refusal is the local expression of that');
  }

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
  check('record/attribute-values-were-hashed',
    rows.length === CASES.reduce((sum, testCase) => sum + expectedTagsFor(testCase.name).length, 0),
    `${rows.length} values across ${CASES.length} documents, six pairs each less the image a refused `
    + `teaser drops (${previewRefusals.size} refused)`);
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
  say(`previews drawn from: ${PREVIEW_ORIGIN}`);
  check('cases/list-is-not-empty', CASES.length > 0, `${CASES.length} documents`);
  await drawPreviews();
  say(`previews: ${previews.size} drawn, ${previewRefusals.size} refused by name `
    + `[${[...previewRefusals.entries()].map(([name, reason]) => `${name}=${reason}`).join(', ')}]`);
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
