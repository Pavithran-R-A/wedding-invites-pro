#!/usr/bin/env node
// VIVAAHVARNAM Stage 7 — the family-approval browser tier.
//
// What this proves, and what the other Stage 7 instruments deliberately do not:
//   * `supabase/tests/stage7/80_family_review.sql` + `90_review_boundary.sql` prove the state
//     machine, the credential liveness rule and the RLS boundary as SQL.
//   * `supabase/tests/api/stage7_family_approval.test.mjs` proves the same over PostgREST with
//     hand-built requests: it knows the route, the header and the body because it writes them.
//   * `src/test/familyReviewPage.test.tsx` and `familyReviewPanel.test.tsx` prove the two React
//     surfaces against a mocked door.
//   None of them proves that a person holding a phone can do the workflow: that the host's panel
//     offers the ask at the right moment, that the address it shows once is the address that
//     works, that the reviewer's page asks for nothing beyond what it says it asks for, that the
//     browser's own form validation is what stops an empty change note, and that the answer the
//     host reads back is the answer the relative typed. This tier clicks the shipped `dist/`
//     bundle against the local stack and reads the wire.
//
// Guarantees enforced before anything is clicked:
//   * both origins are loopback and `project_id` is this repository's disposable stack — the same
//     three checks every tier since Stage 4 makes, copied deliberately so a fresh reader does not
//     have to trust an import;
//   * the built bundle in `dist/` carries the reviewer's own sentences and calls the loopback
//     target, so a client-side gate measured here is a gate that actually shipped;
//   * every raw review credential this run mints is registered in `DISCOVERED`, masked out of
//     every printed line, and re-verified as absent from the database, the page and the wire;
//   * accounts and rows belong to this run's tag and are removed child-before-parent.
//
// Usage:
//   npm run build
//   npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
//   node scripts/stage7-browser-review.mjs              # all four journeys
//   node scripts/stage7-browser-review.mjs --only=a     # one journey
//
// Exit code 1 means a finding was recorded, not that the harness broke; a harness failure throws.
//
// One limitation is stated rather than hidden. The shared CDP driver surfaces response bodies,
// wire headers, storage and cookies, but it attaches no `Runtime`/`Log` console listener, so this
// tier cannot assert "the credential never reached the JavaScript console" — the app's own
// `describe()` helper masks what it logs, and that path is pinned by unit test, but a browser
// console sweep would mean changing an instrument that Stages 5 and 6 depend on. Journey C
// measures what the browser did hand over and records the console as not covered.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { assertLoopback, openBrowser } from './stage5-browser-driver.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_ORIGIN = assertLoopback(
  process.env.STAGE7_PREVIEW_URL ?? 'http://127.0.0.1:4173', 'STAGE7_PREVIEW_URL');
const CDP_PORT = Number(process.env.STAGE7_CDP_PORT ?? 9421);
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '--only=a,b,c,d')
  .slice('--only='.length).split(',').map((x) => x.trim().toLowerCase());
const wants = (letter) => ONLY.includes(letter);

function localEnv() {
  const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
}

const env = localEnv();
const apiUrl = assertLoopback(env.SUPABASE_LOCAL_URL, 'SUPABASE_LOCAL_URL');
const anonKey = env.SUPABASE_LOCAL_PUBLISHABLE_KEY;
const serviceKey = env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
const browserApiUrl = assertLoopback(env.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL');
if (!apiUrl || !anonKey || !serviceKey) throw new Error('.env.local is missing a local key');

const toml = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');
const projectId = /^project_id\s*=\s*"?([^"\n]+?)"?\s*$/m.exec(toml)?.[1]?.trim();
if (projectId !== 'localvivaahvarnam') {
  throw new Error(`refusing to run: project_id is ${projectId}, not localvivaahvarnam`);
}
const DB_CONTAINER = `supabase_db_${projectId}`;

const RUN_TAG = `s7ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}`;
const SCRATCH = join(tmpdir(), `stage7-ui-${RUN_TAG}`);
mkdirSync(SCRATCH, { recursive: true });
const EVIDENCE_DIR = resolve(process.env.STAGE7_EVIDENCE_DIR ?? join(ROOT, '..', 'q7-logs'));
mkdirSync(EVIDENCE_DIR, { recursive: true });

const COUPLE = 'Meena weds Arun';
const LINES = {
  opening: 'With the blessings of our elders, we ask you to share this day.',
  familyIntroduction: 'Parents, grandparents and cousins invite you.',
  eventNotes: 'The ceremony begins at sunrise on the river terrace.',
  closing: 'Come as you are; your presence is the gift.',
};
const HOST_NOTE = 'The grandmother\'s name is spelled wrong in the second part.';

// --------------------------------------------------------------------- reporting

/** Every raw credential this run was handed — the link the reviewer holds, and the forged one
 *  journey B invents. Two uses: the leak checks must never embed one in a query or an assertion
 *  detail, and the closing masking sweep has to know what it is looking for. Nothing in a printed
 *  line survives `scrub`, which is installed over `console.log` below. */
const DISCOVERED = new Set();
const TOKEN_SHAPED = /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g;
const mask = (value) => String(value).replace(TOKEN_SHAPED, (whole, lead) => `${lead}‹credential masked›`);

/** Nothing outside this machine may be reached. Until Stage 9 this line carried the two Google Fonts
 *  hosts as a named allowset, because `index.html` asked them for the display and Tamil faces on every
 *  route, the reviewer's included — a journey that banned "any host outside the loopback" was banning
 *  the product. The faces are served from this origin now (`public/fonts/`, and the gate that reads it
 *  is `scripts/check-render-assets.mjs`), so there is no legitimate destination elsewhere and any host
 *  that appears here is a finding. */
/** Origins that would be a finding if a single request reached one. The list is named, because "no
 *  analytics" is only a claim if the instrument says what it looked for. Copied from Stage 5 so the
 *  two tiers mean the same thing by it. */
const TELEMETRY_HOSTS = ['google-analytics.com', 'googletagmanager.com', 'analytics.google.com',
  'sentry.io', 'ingest.sentry.io', 'posthog.com', 'mixpanel.com', 'segment.io', 'segment.com',
  'amplitude.com', 'clarity.ms', 'hotjar.com', 'lovable.dev', 'vercel.app', 'supabase.co',
  'supabase.in'];
const urlHostIsLoopback = (value) => {
  try {
    const host = new URL(value).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host.startsWith('127.');
  } catch {
    return false;
  }
};
const rpcName = (value) => /rpc\/([a-z_]+)/.exec(value)?.[1] ?? '?';

/** What this run tried to print, and what actually left for the terminal. The hook sits on
 *  `process.stdout.write` rather than on `console.log` because every console path funnels through
 *  it, so a check at the end can say "N lines carried a credential in, none came out" — a
 *  before/after measurement instead of a promise that `check()` was careful.
 *
 *  Boundary, stated: a child process started with `stdio: 'inherit'` writes to the file descriptor
 *  directly and is not in either list. No query in this file passes a credential to the database,
 *  so nothing inherited has one to print, and that is why the SQL reads are built without a needle. */
const rawChunks = [];
const emittedChunks = [];
let maskedChunkCount = 0;
const realWrite = process.stdout.write.bind(process.stdout);
const scrub = (line) => {
  let out = mask(line);
  for (const t of DISCOVERED) out = out.split(t).join('‹credential masked›');
  return out;
};
process.stdout.write = (chunk, ...rest) => {
  const text = typeof chunk === 'string' ? chunk : String(chunk);
  const safe = scrub(text);
  rawChunks.push(text);
  if (safe !== text) maskedChunkCount += 1;
  emittedChunks.push(safe);
  return realWrite(safe, ...rest);
};

/** Writes a line through the hook with the credential still in it, on purpose. `check()` and
 *  `measure()` scrub their own detail before it ever reaches `console.log`, so a run that only used
 *  those two would report "0 credential(s) appeared in what this run tried to print" — which is
 *  true of the run, but tells nothing about the hook: deleting `scrub` would leave that sentence
 *  green. This is the input side of the closing sweep. The line goes out through the rewritten
 *  `process.stdout.write`, so the raw form is recorded and only the masked form reaches the
 *  terminal and the evidence log. */
const printRaw = (text) => { process.stdout.write(`  raw  ${text}\n`); };

const results = [];
let failureCount = 0;
function check(area, name, ok, detail) {
  const shown = detail === undefined ? '' : mask(String(detail)).slice(0, 400);
  results.push({ area, name, ok: Boolean(ok), detail: shown });
  if (!ok) failureCount += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} [${area}] ${name}${shown ? ` — ${shown}` : ''}`);
}
function measure(area, name, value) {
  results.push({ area, name, ok: true, detail: mask(value), measured: true });
  console.log(`  ..   [${area}] ${name} — ${mask(value)}`);
}
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// --------------------------------------------------------------------- database reads

function psqlRows(query) {
  const out = execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-F', '|', '-c', query],
  { encoding: 'utf8' }).split(/\r?\n/).filter((l) => l !== '');
  return out;
}
const psqlValue = (query) => psqlRows(query)[0] ?? null;

const owners = `(select w.id from public.weddings w join auth.users u on u.id = w.owner_user_id
  where u.email like '%+${RUN_TAG}@example.test')`;
/** The single quote this file's literals use, escaped the SQL way, for text taken from a page. */
const sql = (text) => `'${String(text).replace(/'/g, "''")}'`;

// --------------------------------------------------------------------- page helpers
// Shape and names copied from `stage5-ui-journeys.mjs` and `stage6-browser-assets.mjs` on purpose:
// these tiers share a driver, and a reader who knows one should be able to read the other without
// working out why the same problem is solved twice with different code.

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForUrl(page, part, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const url = await page.currentUrl();
    if (url.includes(part)) return url;
    if (Date.now() > deadline) return null;
    await sleep(150);
  }
}

const carriesData = (entry) => entry.method !== 'OPTIONS';

async function responsesFor(page, urlPart) {
  const log = await page.networkLog();
  const hits = log.filter((r) => r.url.includes(urlPart) && r.status && carriesData(r));
  const out = [];
  for (const hit of hits) {
    let body = null;
    try { body = await page.responseBody(hit.requestId); } catch { body = null; }
    out.push({ url: hit.url, status: hit.status, method: hit.method, body, headers: hit.headers });
  }
  return out;
}

const callCount = async (page, urlPart) => (await page.networkLog())
  .filter((r) => r.url.includes(urlPart) && carriesData(r)).length;

/** The auth routes remount their form when the session changes, so a harness that types into the
 *  first instance reports a press that never reaches the server. Wait for the button to be present
 *  *and* stable, type, read every value back, then click. */
async function fillAndSubmit(page, fields, buttonWords) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const ready = await page.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        x.textContent.trim().replace(/\\s+/g, ' ').startsWith(${JSON.stringify(buttonWords)}));
      return b && !b.disabled ? 1 : 0;
    })()`);
    if (ready) {
      await sleep(450);
      const still = await page.evaluate(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) =>
          x.textContent.trim().replace(/\\s+/g, ' ').startsWith(${JSON.stringify(buttonWords)}));
        return b && !b.disabled ? 1 : 0;
      })()`);
      if (!still) continue;
      const missing = [];
      for (const [selector, value] of Object.entries(fields)) {
        await page.setBySelector(selector, value);
        const readBack = await page.evaluate(
          `document.querySelector(${JSON.stringify(selector)})?.value ?? null`);
        if (readBack !== value) missing.push(selector);
      }
      if (missing.length === 0) return page.pressButton(buttonWords);
      if (attempt === 8) throw new Error(`the form would not hold its values: ${missing.join(', ')}`);
      await sleep(300);
    } else {
      await sleep(300);
    }
  }
  return 'absent';
}

async function signUpAndEnterHost(browser, who) {
  const page = await browser.newPage(who);
  await page.goto(`${PREVIEW_ORIGIN}/signup`);
  await page.waitForSelector('form');
  const pressed = await fillAndSubmit(page, {
    '#name': 'Test Host', '#email': emailFor(who), '#password': PASSWORD,
  }, 'Sign up');
  check('prelude', `${who}: the sign-up button was pressable`, pressed === 'pressed', pressed);
  await waitForUrl(page, '/login');
  const loginPressed = await fillAndSubmit(page, {
    '#email': emailFor(who), '#password': PASSWORD,
  }, 'Log in');
  const dash = await waitForUrl(page, '/dashboard');
  check('prelude', `${who}: reached the dashboard with no email-confirmation step`,
    Boolean(dash),
    dash ?? `press ${loginPressed}; page said: ${(await page.bodyText()).replace(/\s+/g, ' ').slice(0, 160)}`);
  return page;
}

async function createWedding(page, { title, lang }) {
  await page.clickLink('Create Invitation');
  await page.waitForSelector('#title');
  await fillAndSubmit(page, { '#title': title, '#language': lang }, 'Create Invitation Draft');
  const url = await waitForUrl(page, '/configure');
  if (!url) {
    throw new Error(`wedding creation did not reach the planning page: `
      + `${(await page.bodyText()).replace(/\s+/g, ' ').slice(0, 240)}`);
  }
  const weddingId = /\/project\/([0-9a-f-]{36})\/configure/.exec(url)?.[1];
  if (!weddingId) throw new Error(`could not read the new wedding from ${mask(url)}`);
  await fillAndSubmit(page, { '#guests': '120' }, 'Save Draft');
  await page.waitForText('Saved');
  await page.clickLink('Open Invitation Editor');
  const edit = await waitForUrl(page, '/edit');
  if (!edit) throw new Error('the editor never opened from the planning page');
  return weddingId;
}

async function openAddForm(page, buttonWords, fieldSelector) {
  await page.pressButtonWhenReady(buttonWords);
  const opened = await page.waitForSelector(fieldSelector);
  if (!opened) throw new Error(`"${buttonWords}" was pressed but ${fieldSelector} never appeared`);
}
async function addPerson(page, { name, role, group }) {
  await openAddForm(page, 'Add a person', '[id$="-new-person-name"]');
  await page.setBySelector('[id$="-new-person-name"]', name);
  await page.setBySelector('[id$="-new-person-role"]', role);
  await page.setBySelector('[id$="-new-person-group"]', group);
  await page.pressButtonWhenReady('Add to invitation');
  return page.waitForText(name, 25_000);
}
async function addVenue(page, { name, address }) {
  await openAddForm(page, 'Add a venue', '[id$="-new-venue-name"]');
  await page.setBySelector('[id$="-new-venue-name"]', name);
  await page.setBySelector('[id$="-new-venue-address"]', address);
  await page.pressButtonWhenReady('Add to invitation');
  return page.waitForText(name, 25_000);
}
async function addCeremony(page, { name, starts, timezone, venueName }) {
  await openAddForm(page, 'Add a ceremony', '[id$="-new-ceremony-name"]');
  await page.setBySelector('[id$="-new-ceremony-name"]', name);
  await page.setBySelector('[id$="-new-ceremony-starts"]', starts);
  await page.setBySelector('[id$="-new-ceremony-timezone"]', timezone);
  const options = await page.evaluate(`(() => {
    const el = document.querySelector('[id$="-new-ceremony-venue"]');
    return el ? [...el.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : null;
  })()`);
  const match = (options ?? []).find((o) => o.text.includes(venueName));
  if (!match) throw new Error(`the venue "${venueName}" was not offered in the ceremony form`);
  await page.setBySelector('[id$="-new-ceremony-venue"]', match.value);
  await page.pressButtonWhenReady('Add to invitation');
  return page.waitForText(name, 25_000);
}

const PROSE_LABELS = {
  opening: 'The opening',
  familyIntroduction: 'Who is inviting',
  eventNotes: 'A note about the ceremonies',
  closing: 'The last words',
};
async function typeAvailableProse(page, valuesBySlot) {
  const typed = [];
  for (const [slot, text] of Object.entries(valuesBySlot)) {
    const label = PROSE_LABELS[slot];
    if (!label) throw new Error(`no screen label is recorded for the slot '${slot}'`);
    if (!(await page.valueByLabel(label))) continue;
    await page.setByLabel(label, text);
    typed.push(slot);
  }
  return typed;
}

const PREVIEW_URL_PART = '/rest/v1/rpc/preview_invitation_document';

async function readPreview(page, { minCount = 1, timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const seen = await responsesFor(page, PREVIEW_URL_PART);
    if (seen.length >= minCount && seen.length > 0) {
      const last = seen[seen.length - 1];
      if (last.body !== null) {
        let raw;
        try {
          const parsed = JSON.parse(last.body);
          raw = Array.isArray(parsed) ? parsed[0] : parsed;
        } catch {
          throw new Error(`the newest preview verdict is not JSON — HTTP ${last.status}, `
            + `${last.body.length} bytes`);
        }
        if (raw === null || typeof raw !== 'object') {
          throw new Error(`the newest preview verdict answered ${JSON.stringify(raw).slice(0, 80)}`);
        }
        return { count: seen.length, status: last.status, raw, issues: raw?.issues ?? null,
          invitation: raw?.invitation ?? null };
      }
    }
    if (Date.now() > deadline) return null;
    await sleep(200);
  }
}

const previewCount = async (page) => (await page.networkLog())
  .filter((r) => r.url.includes(PREVIEW_URL_PART) && r.status && carriesData(r)).length;

/** A request started *before* a write can answer *after* it, so waiting for "one more response"
 *  can hand back a verdict that predates the action. Wait for a new response *and* for the
 *  endpoint to go quiet, then take the newest answer. */
async function previewAfter(page, action, { quietMs = 1_500, timeoutMs = 30_000, label = 'this action' } = {}) {
  const before = await previewCount(page);
  await action();
  const deadline = Date.now() + timeoutMs;
  let count = before;
  let quietSince = null;
  const settle = async (minCount) => {
    const doc = await readPreview(page, { minCount });
    if (doc === null) throw new Error(`no usable preview verdict after ${label}`);
    return doc;
  };
  for (;;) {
    const now = await previewCount(page);
    if (now > count) { count = now; quietSince = null; }
    else if (count > before) {
      if (quietSince === null) quietSince = Date.now();
      else if (Date.now() - quietSince >= quietMs) return settle(count);
    }
    if (Date.now() > deadline) break;
    await sleep(200);
  }
  return settle(Math.max(1, count));
}

/** The editor's own save status, read from the element the header renders rather than from the page
 *  text: `waitForText('Saved')` matches any status line on the screen, and the panel below prints
 *  its notices in a `<p role="status">` too. This one is found by walking from the Save button the
 *  product wires the save to, so it can only be `SaveStatus` (EditProject.tsx:314). */
const saveStatusLine = (page) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /^(Save Draft|Saving)/.test(b.textContent.trim().replace(/\\s+/g, ' ')));
  if (!btn) return null;
  const cluster = btn.parentElement;
  const p = cluster ? cluster.querySelector('[role=status]') : null;
  return p ? p.innerText.trim().replace(/\\s+/g, ' ') : null;
})()`);

/** What the page claims about the draft at the instant a save-dependent action is pressed: the
 *  header's status line and the preview badge, which render the same `dirty` value in two places. */
const dirtyWitness = (page) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /^(Save Draft|Saving)/.test(b.textContent.trim().replace(/\\s+/g, ' ')));
  const cluster = btn ? btn.parentElement : null;
  const status = cluster ? cluster.querySelector('[role=status]') : null;
  const badge = [...document.querySelectorAll('p')]
    .find((p) => p.textContent.trim().startsWith('Draft preview'));
  return { status: status ? status.innerText.trim() : null,
    badge: badge ? badge.innerText.trim().replace(/\\s+/g, ' ') : null };
})()`);

/** Presses the editor's own Save and waits for the save to be *over*, which is not the moment the
 *  header first says "Saved". `handleSave` writes the style row, the draft row, then asks the server
 *  for a fresh document (`EditProject.tsx:483`); the run that pressed Freeze as soon as the word
 *  appeared was refused by the product's own unsaved-changes guard (`EditProject.tsx:533`) even
 *  though the header had read "Saved" — measured 2026-10-08, journey A run 1, no version row
 *  written. What that run does not establish is why the guard saw the draft unsaved at all; so this
 *  waits for the document read the save ends with *and* for the header to hold "Saved" for a second
 *  and a half, and the check beside the freeze reports what the page claimed at the press. A future
 *  run that hits the same window fails loudly with both traces instead of being timed around. */
async function saveDraft(page) {
  const previewsBefore = await previewCount(page);
  const started = Date.now();
  await page.pressButtonWhenReady('Save Draft');
  const trace = [];
  let line = null;
  let heldSince = null;
  let settled = false;
  const deadline = Date.now() + 40_000;
  for (;;) {
    line = await saveStatusLine(page);
    if (trace.length === 0 || trace[trace.length - 1].text !== line) {
      trace.push({ at: Date.now() - started, text: line });
    }
    const docLanded = (await previewCount(page)) > previewsBefore;
    if (docLanded && line === 'Saved') {
      if (heldSince === null) heldSince = Date.now();
      else if (Date.now() - heldSince >= 1_500) { settled = true; break; }
    } else {
      heldSince = null;
    }
    if (Date.now() > deadline) break;
    await sleep(150);
  }
  const summary = trace.map((s) => `+${s.at}ms: ${s.text ?? '(no status line)'}`).join('  →  ');
  if (!settled) {
    throw new Error(`the save never settled on "Saved" after the document read it ends with: ${summary}`);
  }
  return summary;
}

async function pressOffered(page, words) {
  try {
    await page.pressButtonWhenReady(words);
    return 'pressed';
  } catch (err) {
    return String(err.message).replace(`[${page.name}] `, '');
  }
}
async function pressEvidence(page, rpcName) {
  const rpc = await responsesFor(page, rpcName);
  const said = await page.evaluate(`(() => {
    const parts = [];
    for (const sel of ['[role=status]', '[role=alert]']) {
      for (const el of document.querySelectorAll(sel)) {
        const t = el.innerText.trim().replace(/\\s+/g, ' ');
        if (t) parts.push(t.slice(0, 140));
      }
    }
    return parts.slice(0, 6).join(' | ');
  })()`);
  return `asked ${rpcName}: ${rpc.length ? rpc.map((r) => `HTTP ${r.status}`).join(', ')
    : 'the app made no such call'} · the page says: ${said || 'nothing'}`;
}

/** Reads the review address the panel shows once, registers its credential for masking, and
 *  refuses to continue if the page offered more than one credential-shaped string — a journey
 *  that cannot say which link it is testing is not testing anything. */
async function revealLink(page, tag) {
  const body = await page.bodyText();
  const hits = [...new Set(body.match(/[A-Za-z0-9_-]{43}/g) ?? [])];
  if (hits.length === 0) {
    throw new Error(`${tag}: no review address appeared on the page — `
      + `${body.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  if (hits.length > 1) {
    throw new Error(`${tag}: the page offered ${hits.length} credential-shaped strings at once`);
  }
  DISCOVERED.add(hits[0]);
  const shown = await page.hasText('This is their review link. It is shown once.');
  check(tag, 'the link block says the address is shown once', shown);
  const link = `${PREVIEW_ORIGIN}/r/${hits[0]}`;
  // Marked `raw` rather than `..` so a reader of the log can tell the masking probe's line from a
  // measurement: a `raw` line is an input to the hook and is never counted as a check.
  printRaw(`[${tag}] the address the panel formed, written through the stdout hook unmasked → ${link}`);
  return link;
}

/** Asks the shipped panel for one live link, returning the address plus the request id the
 *  database gave the ask (read back by reviewer name, which this run makes unique). */
async function askForLink(page, name, versionLabel) {
  await page.waitForSelector('#review-version');
  if (versionLabel) {
    const values = await page.evaluate(`(() => {
      const el = document.querySelector('#review-version');
      return el ? [...el.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : null;
    })()`);
    const wanted = (values ?? []).find((o) => o.text.includes(versionLabel));
    if (!wanted) {
      throw new Error(`the version picker did not offer "${versionLabel}": `
        + `${(values ?? []).map((o) => o.text).join(' / ') || 'no options'}`);
    }
    await page.setBySelector('#review-version', wanted.value);
  }
  await page.setBySelector('#reviewer-name', name);
  // The host page is shared by every journey, so its network log is cumulative: the tally in
  // `pressEvidence` grows rather than resets. Counting around the press turns that shared log into
  // the evidence itself — one press, exactly one request, no double-submit — instead of leaving a
  // reader to work out what "HTTP 200, HTTP 200, HTTP 200" was supposed to mean.
  const callsBefore = await callCount(page, 'request_family_review');
  const asked = await pressOffered(page, 'Ask them to review it');
  const ready = await page.waitForText('Their link is ready. Copy it now', 25_000);
  const callsAfter = await callCount(page, 'request_family_review');
  const evidence = await pressEvidence(page, 'request_family_review');
  check('journey', `${name}: the panel made exactly one ask through the product's own button`,
    asked === 'pressed' && Boolean(ready) && callsAfter === callsBefore + 1,
    `${asked}; ${evidence}; this press took the host page's cumulative ask tally from `
    + `${callsBefore} to ${callsAfter}`);
  if (!ready) throw new Error(`${name}: the panel never reported a link — ${evidence}`);
  const link = await revealLink(page, 'journey');
  const requestId = psqlValue(`select id::text from public.approval_requests
    where wedding_id in ${owners} and reviewer_display_name = ${sql(name)}
    order by requested_at desc limit 1`);
  if (requestId === null) throw new Error(`${name}: the ask is not in approval_requests`);
  return { link, requestId, name };
}

// --------------------------------------------------------------------- the reviewer's page

async function openReviewer(browser, link, { label = 'reviewer', viewport = null } = {}) {
  const page = await browser.newPage(label);
  if (viewport) await page.setViewportSizeOnly(viewport);
  await page.goto(link);
  // Both outcomes are polled in one deadline: a refusal page never shows the form, so waiting the
  // form's full timeout first would cost half a minute per refused link and tell us nothing new.
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (await page.hasText('Send your answer')) return { page, kind: 'form' };
    if (await page.hasText('This review link is not available.')) return { page, kind: 'refusal' };
    if (Date.now() > deadline) break;
    await sleep(250);
  }
  throw new Error(`[${label}] the review route produced neither the form nor the refusal: `
    + `${(await page.bodyText()).replace(/\s+/g, ' ').slice(0, 220)}`);
}

/** Every place this run's credentials were actually seen, in the shapes a leak takes: the request
 *  line split into path/query/hash, the request headers, the page's own text and title, the two
 *  storages, and the cookies. The old `inUrls` reported a credential-bearing address with its query
 *  and hash stripped, so it could not tell the reviewer's own page address (where the credential
 *  belongs, because it *is* the link the host copied) from the same credential riding along in a
 *  query string (where it does not). */
async function leakScan(page) {
  const log = await page.networkLog();
  const discovered = [...DISCOVERED];
  const travel = [];
  const headerNames = new Set();
  const offMachineReferers = [];
  const nonEgressSchemes = [];
  for (const r of log) {
    let parsed = null;
    try { parsed = new URL(r.url); } catch { parsed = null; }
    const host = parsed ? parsed.host : '?';
    // "Leaves this machine" means an http(s) request to a host that is not loopback. A `data:` or
    // `blob:` pseudo-request has an empty hostname, so it fails a bare host test while never
    // touching the network at all — the landing page's inline SVG does exactly that, and reports a
    // Referer of this machine's own origin. Counting it as egress would be a false finding.
    const egress = Boolean(parsed) && /^https?:$/.test(parsed.protocol) && !urlHostIsLoopback(r.url);
    if (parsed && !/^https?:$/.test(parsed.protocol)) nonEgressSchemes.push(parsed.protocol);
    for (const [k, v] of Object.entries(r.headers ?? {})) {
      headerNames.add(k.toLowerCase());
      const hit = discovered.find((t) => String(v).includes(t));
      if (hit) travel.push({ kind: 'header', name: k.toLowerCase(), host, url: r.url, needle: hit });
      if (egress && k.toLowerCase() === 'referer') {
        offMachineReferers.push({ host, referer: String(v) });
      }
    }
    if (parsed === null || !r.url.startsWith('http')) continue;
    const hit = discovered.find((t) => parsed.pathname.includes(t) || parsed.search.includes(t)
      || parsed.hash.includes(t));
    if (hit) {
      const where = parsed.pathname.includes(hit) ? 'path'
        : parsed.search.includes(hit) ? 'query' : 'hash';
      travel.push({ kind: 'url', name: where, host, url: r.url, path: parsed.pathname,
        origin: parsed.origin, where, needle: hit });
    }
  }
  const storage = await page.privacyState();
  const cookies = await page.cookiesForOrigin();
  const bodyText = await page.bodyText();
  const title = await page.evaluate('document.title');
  const localDump = JSON.stringify(await page.localStorageSnapshot());
  const sessionKeys = JSON.stringify(storage.session ?? []);
  const cookieDump = JSON.stringify(cookies);
  const nonUrl = {
    bodyText: discovered.filter((t) => bodyText.includes(t)),
    title: discovered.filter((t) => title.includes(t)),
    localStorage: discovered.filter((t) => localDump.includes(t)),
    sessionStorage: discovered.filter((t) => sessionKeys.includes(t)),
    cookies: discovered.filter((t) => cookieDump.includes(t)),
  };
  const hosts = [...new Set(log.filter((r) => r.url.startsWith('http'))
    .map((r) => { try { return new URL(r.url).host; } catch { return '?'; } }))];
  const offMachine = hosts.filter((h) => !urlHostIsLoopback(`http://${h}`));
  return {
    travel,
    nonUrl,
    hosts,
    offMachine,
    telemetry: offMachine.filter((h) => TELEMETRY_HOSTS.some((t) => h === t || h.endsWith(`.${t}`))),
    offMachineReferers: [...new Map(offMachineReferers.map((x) => [`${x.host}\u0000${x.referer}`, x]))
      .values()],
    nonEgressSchemes: [...new Set(nonEgressSchemes)],
    pageUrl: await page.currentUrl(),
    requestCount: log.length,
    headerNames: [...headerNames].sort(),
  };
}

/** A reviewer page must hand its credential to exactly one header on the two RPCs, and to nothing
 *  else. Returns the per-endpoint header census, read off the wire rather than the source. */
async function tokenHeaderCensus(page) {
  const log = await page.networkLog();
  const rows = [];
  for (const r of log) {
    if (!r.url.includes('/rest/v1/rpc/') || r.method === 'OPTIONS') continue;
    const fn = /rpc\/([a-z_]+)/.exec(r.url)?.[1] ?? '?';
    const headers = r.headers ?? {};
    const entry = { fn, seen: [] };
    for (const [k, v] of Object.entries(headers)) {
      if (DISCOVERED.has(String(v))) entry.seen.push(k.toLowerCase());
    }
    entry.hasReviewHeader = Object.keys(headers).some((k) => k.toLowerCase() === 'x-review-token');
    entry.referer = headers['referer'] ?? headers['Referer'] ?? null;
    rows.push(entry);
  }
  return rows;
}

/** The places this pass declares a review credential may appear, stated as places rather than as a
 *  ban. Stage 5's network tier ran the ban shape first and it fired on the design
 *  (`stage5-network-privacy.mjs:120-127`): a family-review credential is *supposed* to travel — it
 *  is the link the host copied, so it is the reviewer's own page address, and it rides one header to
 *  the loopback API. What a wire pass can answer is whether that travel is exactly the declared set,
 *  whether any of it leaves this machine, and whether the credential appears in the places a leak
 *  actually takes: query, hash, page text, title, storage, cookie. */
const MAY_TRAVEL_TO = [
  { name: 'the reviewer\'s own page address, in the path', test: (t) => t.kind === 'url'
      && t.where === 'path' && urlHostIsLoopback(t.url) && t.path.startsWith('/r/') },
  { name: 'the x-review-token header on one of the two review RPCs', test: (t) => t.kind === 'header'
      && t.name === 'x-review-token' && urlHostIsLoopback(t.url)
      && /\/rpc\/(resolve|submit)_family_review/.test(t.url) },
];

/** Journey C's assertions, over one scan. Split out so the run's narrative stays readable and so a
 *  later pass that reads the wire can reuse the same declared-travel shape. */
function wireReport(tag, scan) {
  const tally = scan.travel.map((t) => `${t.kind === 'header' ? `header:${t.name}`
    : `url:${t.where}`}@${t.host}`);
  measure(tag, 'where each credential of this pass was actually seen on the wire',
    [...new Set(tally)].join(', ') || 'nowhere');
  const stray = scan.travel.filter((t) => !MAY_TRAVEL_TO.some((d) => d.test(t)));
  check(tag, 'the credential travels only to the places this pass declares',
    scan.travel.length > 0 && stray.length === 0,
    stray.map((t) => `${t.name}@${t.host} ${t.url.split('?')[0]}`).join(', ')
      || (scan.travel.length === 0 ? 'the wire showed nothing at all, so nothing was proved'
        : `declared: ${MAY_TRAVEL_TO.map((d) => d.name).join(' · ')}`));
  const offMachine = scan.travel.filter((t) => !urlHostIsLoopback(`http://${t.host}`));
  check(tag, 'no credential of this pass reaches a host outside this machine',
    offMachine.length === 0,
    offMachine.map((t) => `${t.name}@${t.host}`).join(', ') || 'nothing crossed the loopback edge');
  const appearances = Object.entries(scan.nonUrl).filter(([, v]) => v.length > 0);
  check(tag, 'the credential appears in no query, hash, page text, title, storage or cookie',
    appearances.length === 0,
    appearances.map(([k, v]) => `${k}: ${v.length} credential(s)`).join('; ') || 'none');
  check(tag, 'no destination outside this machine is contacted at all',
    scan.offMachine.length === 0, scan.offMachine.join(', ') || 'every host seen is loopback');
  check(tag, 'no analytics, session-replay or telemetry host was contacted by the reviewer page',
    scan.telemetry.length === 0, scan.telemetry.join(', ') || 'none');
  // Reshaped 2026-10-08, and the reshape is recorded rather than smoothed over: the first version of
  // this line claimed "no request leaving this machine carried a Referer", which the run falsified —
  // the woff2 files went out with `https://fonts.googleapis.com/`, the stylesheet's own address. An
  // isolated probe (the same page with and without a 43-character token in its path) showed the
  // stylesheet request carrying an empty Referer in both and the font requests carrying the Google
  // address in both, and no Referer in either case named this machine. Stage 9 served the faces from
  // this origin, so the expected result here is `none at all`: nothing leaves, and the check above is
  // what makes that a claim rather than an absence of evidence.
  const refererRows = scan.offMachineReferers;
  measure(tag, 'every Referer on a request that leaves this machine',
    refererRows.length === 0 ? 'none at all'
      : refererRows.map((r) => `${r.host} \u2190 ${r.referer === '' ? '(empty)' : r.referer}`).join(' | '));
  if (scan.nonEgressSchemes.length > 0) {
    measure(tag, 'pseudo-requests excluded from the egress count because they never touch the network',
      scan.nonEgressSchemes.join(', '));
  }
  const disclosed = refererRows.filter((r) => /127\.0\.0\.1|localhost|[A-Za-z0-9_-]{43}/.test(r.referer));
  check(tag, 'no Referer that leaves this machine names it or carries a credential-shaped string',
    disclosed.length === 0,
    disclosed.map((r) => `${r.host}: ${r.referer.slice(0, 90)}`).join(' | ')
      || 'nothing that reaches a host outside this machine carries this machine\'s address or a '
        + '43-character token; the credential-bearing page address stays in the browser');
  measure(tag, 'what this pass cannot reach',
    'the reviewer\'s address holds the credential by design, so it also sits in that browser\'s '
    + 'history and in whatever access log the hosting stack keeps; a local run has no such log, '
    + 'so the tier proves the travel and discloses the residue instead of claiming none');
}

// --------------------------------------------------------------------- journey A

const A_NAME = 'Kamla (aunt)';

async function journeyA(browser, state) {
  console.log('\n==> Stage 7 A — host asks, relative answers on a phone, host reads it back');
  const host = await signUpAndEnterHost(browser, 's7-host');
  state.host = host;
  const weddingId = await createWedding(host, { title: COUPLE, lang: 'en' });
  state.weddingId = weddingId;
  measure('a', 'wedding created through the UI', weddingId.slice(0, 8));

  const panelEarly = await host.waitForSelector('#family-review-heading', 5_000);
  check('a', 'the review panel is on the editor page', Boolean(panelEarly));
  const emptyState = await host.hasText('Nothing to send yet — freeze a version under');
  check('a', 'with nothing frozen the panel refuses an ask and says why', emptyState,
    emptyState ? 'the no-version copy is on the page' : await host.bodyText());
  check('a', 'with nothing frozen the ask button is not offered',
    await host.buttonState('Ask them to review it') === 'disabled',
    await host.buttonState('Ask them to review it'));

  const typed = await typeAvailableProse(host, LINES);
  check('a', 'the four prose slots were filled through the product', typed.length === 4, typed.join(', '));
  const person = await addPerson(host, { name: 'Ravikumar Kandasamy', role: 'Father',
    group: "The groom's family" });
  const venue = await addVenue(host, { name: 'Kalyana Mantapa',
    address: '100 Pillar Road\nMadurai 625001' });
  await previewAfter(host, async () => {
    await addCeremony(host, { name: 'Muhurtham', starts: '2026-11-14T07:30',
      timezone: 'Asia/Kolkata', venueName: 'Kalyana Mantapa' });
  });
  const ceremonyVisible = await host.hasText('Muhurtham');
  check('a', 'person, venue and ceremony were added through the product',
    Boolean(person) && Boolean(venue) && ceremonyVisible,
    `person on page: ${Boolean(person)}, venue on page: ${Boolean(venue)}, `
    + `ceremony on page: ${ceremonyVisible}`);
  measure('a', 'the header save status from the Save press to a settled save', await saveDraft(host));
  const preview = await readPreview(host, { minCount: 1 });
  const blocking = (preview?.issues ?? []).filter((i) => i.blocking === true);
  check('a', 'the server reports no blocking issue on the completed draft', blocking.length === 0,
    JSON.stringify(blocking).slice(0, 240));
  const atFreeze = await dirtyWitness(host);
  check('a', 'the page calls the draft saved on both of its two witnesses before the freeze',
    atFreeze.status === 'Saved' && !/unsaved/i.test(atFreeze.badge ?? ''),
    `header: ${String(atFreeze.status)}; preview badge: ${String(atFreeze.badge)}`);
  const froze = await pressOffered(host, 'Freeze this draft as a version');
  const frozenCopy = await host.waitForText('It cannot be edited.', 25_000);
  check('a', 'the draft was frozen into an immutable version', froze === 'pressed' && Boolean(frozenCopy),
    `${froze}; ${await pressEvidence(host, 'create_invitation_version')}`);
  const versionCount = psqlValue(`select count(*)::text from public.invitation_versions
    where wedding_id = '${weddingId}'`);
  check('a', 'the frozen version is one row in the database', versionCount === '1', String(versionCount));
  /** The frozen document's own digest, read straight out of the version row. A review that wrote
   *  back into the snapshot it was about would change this string, and the check at the end of
   *  this journey would say so — which is the directive's "never silently mutate the approved
   *  invitation snapshot" as something a run can fail, rather than a sentence about it. */
  const snapshotBefore = psqlValue(`select md5(snapshot::text) from public.invitation_versions
    where wedding_id = '${weddingId}' and version_number = 1`);

  const askedFor = await askForLink(host, A_NAME, 'Version 1');
  const queueLive = await host.waitForText('Waiting for their answer', 25_000);
  check('a', 'the host queue shows the ask as waiting', Boolean(queueLive));

  await host.reload();
  const goneAfterReload = !(await host.bodyText()).match(/[A-Za-z0-9_-]{43}/);
  check('a', 'a reload does not hand the address back', goneAfterReload,
    goneAfterReload ? 'no credential-shaped string on the reloaded page' : 'the address reappeared');

  const phone = { width: 390, height: 844, dpr: 3, mobile: true };
  const { page: reviewer, kind } = await openReviewer(browser, askedFor.link, {
    label: 's7-reviewer', viewport: phone });
  check('a', 'the address the panel showed once opens the reviewer page in a context with no session',
    kind === 'form', kind);
  const frozenArticle = await reviewer.waitForSelector('article', 25_000);
  check('a', 'the reviewer is shown the frozen invitation, not a stub', Boolean(frozenArticle));
  const invitationText = await reviewer.evaluate(`(() => {
    const art = document.querySelector('article');
    return art ? art.innerText : '';
  })()`);
  check('a', 'the reviewer reads the host\'s own words, the venue, the ceremony and the person',
    invitationText.includes(LINES.opening) && invitationText.includes('Kalyana Mantapa')
      && invitationText.includes('Muhurtham') && invitationText.includes('Ravikumar Kandasamy'));
  const salutation = await reviewer.hasText(`${A_NAME}, this invitation is waiting for you`);
  check('a', 'the page addresses the reviewer by the name the host typed', salutation);
  const noAccountAffordance = await reviewer.evaluate(`(() => {
    const words = ['log in', 'sign up', 'dashboard', 'create invitation', 'password', 'sign in'];
    const text = document.body.innerText.toLowerCase();
    return words.filter((w) => text.includes(w));
  })()`);
  check('a', 'the reviewer page offers no account affordance at all',
    noAccountAffordance.length === 0, noAccountAffordance.join(', ') || 'none');
  const saidNoAccount = await reviewer.hasText('Reading this needs no account');
  check('a', 'and it says so in the reviewer\'s own language', saidNoAccount);

  const h1Count = await reviewer.evaluate(`document.querySelectorAll('h1').length`);
  check('a', 'the reviewer page has exactly one level-1 heading', h1Count === 1, String(h1Count));

  const buttonBefore = await reviewer.buttonState('Send my answer');
  check('a', 'the send button refuses an empty form', buttonBefore === 'disabled', buttonBefore);
  await reviewer.setBySelector('#review-label', 'Kamla R.');
  const nameOnly = await reviewer.buttonState('Send my answer');
  check('a', 'a name alone is not enough — the button stays disabled without a decision',
    nameOnly === 'disabled', `${nameOnly}; the name field holds `
    + `"${await reviewer.evaluate(`document.querySelector('#review-label')?.value ?? null`)}"`);
  await reviewer.pickRadio('review-decision', 'changes_requested');
  const withDecision = await reviewer.buttonState('Send my answer');
  check('a', 'a decision plus a name is enough to offer the send, before any note',
    withDecision === 'enabled', withDecision);
  const noteRequired = await reviewer.evaluate(
    `document.querySelector('#review-message')?.required ?? null`);
  check('a', 'choosing "change something" makes the note a required field', noteRequired === true,
    String(noteRequired));
  const gateCalls = await callCount(reviewer, 'submit_family_review');
  const gatePress = await reviewer.pressButton('Send my answer');
  await sleep(1_500);
  const afterGate = await callCount(reviewer, 'submit_family_review');
  check('a', 'an empty change note is refused by the page before anything reaches the server',
    gatePress === 'pressed' && afterGate === gateCalls,
    `press ${gatePress}; submit calls ${gateCalls} → ${afterGate}; the page still shows: `
    + `${(await reviewer.hasText('Send your answer')) ? 'the form' : 'something else'}`);
  const explained = await reviewer.hasText('A request for changes is not recorded without the note');
  check('a', 'the page explains why the note is not optional here', explained);

  const sectionOptions = await reviewer.evaluate(`(() => {
    const el = document.querySelector('#review-section');
    return el ? [...el.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : null;
  })()`);
  check('a', 'the section picker offers the frozen document\'s own sections',
    Array.isArray(sectionOptions) && sectionOptions.length > 1,
    sectionOptions ? `${sectionOptions.length} option(s)` : 'no select rendered');
  const sectionChoice = (sectionOptions ?? []).find((o) => o.value !== '' && o.text !== '');
  if (sectionChoice) await reviewer.setBySelector('#review-section', sectionChoice.value);
  await reviewer.setBySelector('#review-message', HOST_NOTE);
  const sent = await reviewer.pressButtonWhenReady('Send my answer');
  const recorded = await reviewer.waitForText('Your answer is recorded', 30_000);
  check('a', 'the reviewer\'s answer was accepted through the product',
    sent === 'pressed' && Boolean(recorded),
    `${sent}; ${await pressEvidence(reviewer, 'submit_family_review')}`);
  const receipt = await reviewer.hasText(HOST_NOTE);
  check('a', 'the receipt shows the reviewer their own words back', receipt);
  const signedAs = await reviewer.hasText('Signed as Kamla R.');
  check('a', 'and the name they signed with', signedAs);
  const versionEcho = await reviewer.hasText('recorded against version 1');
  check('a', 'and which version the answer is pinned to', versionEcho);
  const noSecondForm = await reviewer.buttonState('Send my answer');
  check('a', 'the form is gone once the answer is in — the link offers nothing further',
    noSecondForm === 'absent', noSecondForm);

  await host.goto(`${PREVIEW_ORIGIN}/project/${weddingId}/edit`);
  await host.waitForSelector('#family-review-heading');
  const seenAnswer = await host.waitForText('Asked for changes', 25_000);
  const seenName = await host.hasText(A_NAME);
  const seenNote = await host.hasText(HOST_NOTE);
  const seenSigned = await host.hasText('Signed as Kamla R.');
  check('a', 'the host reads the answer back in the queue', Boolean(seenAnswer) && seenName,
    `status copy: ${Boolean(seenAnswer)}, reviewer named: ${seenName}, signed line: ${seenSigned}`);
  check('a', 'the host reads the reviewer\'s note exactly as it was typed', seenNote);

  const row = psqlRows(`
    select r.status || ' / ' || coalesce((select f.feedback_kind || ':' || coalesce(f.decision,'-')
             from public.approval_feedback f where f.request_id = r.id), 'no feedback')
             || ' / tokens=' || (select count(*)::text from private.access_tokens t
                 where t.approval_request_id = r.id)
             || ' / live=' || coalesce((select t.token_kind || '/' || length(t.token_hash)::text
                 || '/hex=' || (t.token_hash ~ '^[0-9a-f]{64}$')::text
                 from private.access_tokens t where t.approval_request_id = r.id
                 and t.revoked_at is null limit 1), 'none')
      from public.approval_requests r where r.id = '${askedFor.requestId}'`)[0];
  check('a', 'the database records one answered request, one decision row and one credential',
    row !== undefined && /changes_requested/.test(row) && /decision:changes_requested/.test(row)
      && /tokens=1/.test(row) && /live=approval_review\/64\/hex=true/.test(row),
    row ?? 'no such request row');
  // The credential's journey into storage, read as text and compared here rather than in SQL:
  // putting the raw link into a `where` clause would put it on a command line, and a command line
  // is something an auditor can find.
  const stored = psqlRows(`
    select 'req:' || coalesce(string_agg(to_jsonb(r)::text, ' '), '')
      from public.approval_requests r where r.wedding_id = '${weddingId}'
    union all
    select 'fb:' || coalesce(string_agg(to_jsonb(f)::text, ' '), '')
      from public.approval_feedback f where f.wedding_id = '${weddingId}'
    union all
    select 'tok:' || coalesce(string_agg(to_jsonb(a)::text, ' '), '')
      from private.access_tokens a where a.wedding_id = '${weddingId}'`);
  const storedBlob = stored.join('\n');
  const storedLeaks = [...DISCOVERED].filter((t) => storedBlob.includes(t));
  check('a', 'no raw review credential is stored in any column of the three review tables',
    storedLeaks.length === 0,
    `${storedLeaks.length} of ${DISCOVERED.size} credential(s) found in `
      + `${storedBlob.length} chars of stored text`);
  const digest = psqlValue(`select token_hash from private.access_tokens
    where approval_request_id = '${askedFor.requestId}' limit 1`);
  const rawOfThisAsk = [...DISCOVERED].find((t) => askedFor.link.endsWith(t));
  measure('a', 'the row\'s credential is one-way (digest equals SHA-256 of the link, not the link)',
    `${String(digest).length} chars, matches sha256(link)=${digest === sha256(rawOfThisAsk ?? '')}`);
  check('a', 'the stored credential is a 64-hex SHA-256 digest',
    /^[0-9a-f]{64}$/.test(digest ?? ''), `digest length ${String(digest).length}`);

  const answered = await openReviewer(browser, askedFor.link, { label: 's7-answered-revisit', viewport: phone });
  check('a', 'the same link, reopened after the answer, refuses with the one sentence',
    answered.kind === 'refusal', answered.kind);
  const refusedBody = await answered.page.evaluate('document.body.innerText');
  check('a', 'the refusal names no table, no status and no other family',
    !/approval_requests|token|hash|wedding_id|version_id|[0-9a-f]{8}-[0-9a-f]{4}/i.test(refusedBody),
    refusedBody.replace(/\s+/g, ' ').slice(0, 200));
  const answerCount = psqlValue(`select count(*)::text from public.approval_feedback
    where request_id = '${askedFor.requestId}'`);
  check('a', 'the refused revisit recorded nothing further', answerCount === '1', String(answerCount));

  const snapshotAfter = psqlValue(`select md5(snapshot::text) from public.invitation_versions
    where wedding_id = '${weddingId}' and version_number = 1`);
  check('a', 'the recorded answer left the frozen snapshot byte-identical to what the reviewer read',
    snapshotBefore !== null && snapshotBefore === snapshotAfter,
    `digest before ${String(snapshotBefore).slice(0, 12)}…, after ${String(snapshotAfter).slice(0, 12)}…`);
  const versionsAfter = psqlValue(`select count(*)::text from public.invitation_versions
    where wedding_id = '${weddingId}'`);
  check('a', 'and no second version was written by the review', versionsAfter === '1',
    String(versionsAfter));

  await host.goto(`${PREVIEW_ORIGIN}/project/${weddingId}/edit`);
  await host.waitForSelector('#tradition-heading');
  const stillEditing = await host.hasText('Save Draft') || await host.hasText('Saved');
  check('a', 'the host is still editing the same draft the reviewer never saw change',
    Boolean(stillEditing),
    stillEditing ? 'the editor offers its own actions as before'
      : await pressEvidence(host, 'preview_invitation_document'));

  const shot = join(EVIDENCE_DIR, `s7-reviewer-${phone.width}x${phone.height}.png`);
  const size = await reviewer.screenshot(shot);
  measure('a', 'screenshot of the reviewer page at the phone viewport', `${shot} (${size})`);
  return { reviewer, host, weddingId };
}

// --------------------------------------------------------------------- journey B

async function journeyB(browser, state) {
  console.log('\n==> Stage 7 B — withdrawal, forged and malformed credentials, a stranger with a session');
  if (state.host === null || state.weddingId === null) {
    check('b', 'journey B ran', false, 'journey A did not produce a host page or a wedding');
    return;
  }
  const host = state.host;
  const phone = { width: 390, height: 844, dpr: 3, mobile: true };

  const withdrawn = await askForLink(host, 'Nila (sister)', 'Version 1');
  const liveBefore = psqlValue(`select coalesce(revoked_at::text,'live') from private.access_tokens
    where approval_request_id = '${withdrawn.requestId}'`);
  await host.goto(`${PREVIEW_ORIGIN}/project/${state.weddingId}/edit`);
  await host.waitForSelector('#family-review-heading');
  await host.waitForText('Nila (sister)', 25_000);
  const pressed = await host.pressButtonWhenReady('Withdraw link');
  const words = await host.waitForText('withdrawn', 25_000);
  check('b', 'the host withdrew a live link through the panel', pressed === 'pressed' && Boolean(words),
    `${pressed}; ${await pressEvidence(host, 'revoke_family_review')}`);
  const liveAfter = psqlValue(`select coalesce(revoked_at::text,'live') || '/' || status
    from private.access_tokens t join public.approval_requests r on r.id = t.approval_request_id
    where t.approval_request_id = '${withdrawn.requestId}'`);
  check('b', 'the credential is revoked in the store and the ask is invalidated',
    liveBefore === 'live' && /invalidated/.test(liveAfter ?? ''), `${liveBefore} → ${liveAfter}`);
  const revokedPage = await openReviewer(browser, withdrawn.link, { label: 's7-revoked', viewport: phone });
  check('b', 'a withdrawn address refuses with the same one sentence',
    revokedPage.kind === 'refusal', revokedPage.kind);
  await revokedPage.page.close();

  const forgedToken = randomBytes(32).toString('base64url').slice(0, 43);
  DISCOVERED.add(forgedToken);
  const forged = await openReviewer(browser, `${PREVIEW_ORIGIN}/r/${forgedToken}`,
    { label: 's7-forged', viewport: phone });
  check('b', 'a well-formed credential that was never issued refuses with the same sentence',
    forged.kind === 'refusal', forged.kind);
  const forgedRows = await responsesFor(forged.page, 'resolve_family_review');
  measure('b', 'the server\'s answer to a forged credential',
    forgedRows.length ? `HTTP ${forgedRows[0].status} ${JSON.stringify(forgedRows[0].body ?? null).slice(0, 90)}`
      : 'no resolve call was made');
  const forgedWrites = psqlValue(`select (select count(*) from public.approval_requests
    where wedding_id in ${owners})::text || ' asks, ' || (select count(*) from public.approval_feedback
    where wedding_id in ${owners})::text || ' feedback rows'`);
  measure('b', 'rows the forged attempt left behind (the asks and answers this run made legitimately)',
    forgedWrites);
  await forged.page.close();

  const malformed = await browser.newPage('s7-malformed');
  await malformed.goto(`${PREVIEW_ORIGIN}/r/too-short`);
  const malformedRefusal = await malformed.waitForText('This review link is not available.', 15_000);
  const malformedCalls = await callCount(malformed, 'resolve_family_review');
  check('b', 'a malformed credential is refused locally, without a round trip',
    Boolean(malformedRefusal) && malformedCalls === 0,
    `refusal on page: ${Boolean(malformedRefusal)}, resolve calls: ${malformedCalls}`);
  await malformed.close();

  const liveAsk = await askForLink(host, 'Thavu (cousin)', 'Version 1');
  const stranger = await signUpAndEnterHost(browser, 's7-stranger');
  await stranger.goto(`${PREVIEW_ORIGIN}/dashboard`);
  await stranger.waitForText('Invitations', 20_000).catch(() => {});
  const dashText = await stranger.bodyText();
  check('b', 'the stranger\'s own dashboard lists none of the host\'s invitation',
    !dashText.includes(COUPLE), dashText.replace(/\s+/g, ' ').slice(0, 200));
  await stranger.goto(`${PREVIEW_ORIGIN}/project/${state.weddingId}/edit`);
  const strangerOnHostProject = await stranger.hasText('Asked for changes')
    || await stranger.hasText(A_NAME) || await stranger.hasText(HOST_NOTE);
  const strangerSaw = await stranger.bodyText();
  check('b', 'a signed-in stranger on the host\'s project URL reads no review queue at all',
    !strangerSaw.includes(HOST_NOTE) && !strangerOnHostProject,
    strangerSaw.replace(/\s+/g, ' ').slice(0, 220));

  const { page: reviewerInSession, kind } = await openReviewer(browser, liveAsk.link,
    { label: 's7-stranger-on-link', viewport: phone });
  check('b', 'the same stranger, holding a live link, is still let in — the link is the credential, '
    + 'the session grants nothing', kind === 'form', kind);
  const salutes = await reviewerInSession.hasText('Thavu (cousin), this invitation is waiting for you');
  check('b', 'and the page still addresses them by the name the host chose, not their account',
    salutes && !(await reviewerInSession.bodyText()).includes('s7-stranger'),
    `host's name shown: ${salutes}`);
  await reviewerInSession.pickRadio('review-decision', 'approved');
  await reviewerInSession.setBySelector('#review-label', 'I am actually the neighbour');
  const approved = await reviewerInSession.pressButtonWhenReady('Send my answer');
  const recorded2 = await reviewerInSession.waitForText('You approved this invitation as it stands.', 30_000);
  check('b', 'their approval is recorded under the words they typed',
    approved === 'pressed' && Boolean(recorded2),
    `${approved}; ${await pressEvidence(reviewerInSession, 'submit_family_review')}`);
  const secondRow = psqlValue(`select r.status || ' / signed ' || coalesce(f.author_label,'-')
    from public.approval_requests r join public.approval_feedback f on f.request_id = r.id
    where r.id = '${liveAsk.requestId}'`);
  check('b', 'the database pins the answer to the typed label, with nothing to verify it against',
    /approved/.test(secondRow ?? '') && (secondRow ?? '').includes('I am actually the neighbour'),
    secondRow ?? 'no row');
  await host.goto(`${PREVIEW_ORIGIN}/project/${state.weddingId}/edit`);
  await host.waitForSelector('#family-review-heading');
  const hostSeesTruth = await host.waitForText('Signed as I am actually the neighbour', 25_000);
  check('b', 'the host is shown that signature rather than a promise about identity',
    Boolean(hostSeesTruth));

  const answeredAgain = await openReviewer(browser, liveAsk.link, { label: 's7-second-answer', viewport: phone });
  check('b', 'the answered link refuses a second reply', answeredAgain.kind === 'refusal',
    answeredAgain.kind);
  const dupRows = psqlValue(`select count(*)::text from public.approval_feedback
    where request_id = '${liveAsk.requestId}'`);
  check('b', 'and exactly one feedback row exists for it', dupRows === '1', String(dupRows));
  await answeredAgain.page.close();
  return { host };
}

// --------------------------------------------------------------------- journey C

async function journeyC(browser, state) {
  console.log('\n==> Stage 7 C — the wire: where the credential travels, and where it must not');
  if (state.host === null) { check('c', 'journey C ran', false, 'no host page from journey A'); return; }
  const phone = { width: 390, height: 844, dpr: 3, mobile: true };
  const ask = await askForLink(state.host, 'Ravi (uncle)', 'Version 1');
  const { page, kind } = await openReviewer(browser, ask.link, { label: 's7-wire', viewport: phone });
  check('c', 'the reviewer page opened', kind === 'form', kind);
  const resolveRows = await responsesFor(page, 'resolve_family_review');
  check('c', 'the reviewer\'s read went to the loopback API and answered',
    resolveRows.length > 0 && resolveRows.every((r) => r.url.startsWith(apiUrl))
      && resolveRows.some((r) => r.status === 200),
    resolveRows.map((r) => `${r.method} ${r.status}`).join(', ') || 'no call');

  await page.pickRadio('review-decision', 'approved');
  await page.setBySelector('#review-label', 'Ravi M.');
  const sent = await page.pressButtonWhenReady('Send my answer');
  const done = await page.waitForText('Your answer is recorded', 30_000);
  check('c', 'the reviewer answered while the wire was being read', sent === 'pressed' && Boolean(done),
    `${sent}; ${await pressEvidence(page, 'submit_family_review')}`);

  const census = await tokenHeaderCensus(page);
  const byFunction = census.map((r) => `${r.fn}${r.hasReviewHeader ? ' [x-review-token]' : ''}`
    + (r.seen.length ? ` credential in: ${r.seen.join(',')}` : ''));
  check('c', 'every credential-carrying request is one of the two review RPCs, over the one header',
    census.length > 0 && census.every((r) => ['resolve_family_review', 'submit_family_review']
      .includes(r.fn) && r.hasReviewHeader && r.seen.length === 1
      && r.seen.every((h) => h === 'x-review-token')),
    byFunction.join(' · ').slice(0, 380));
  const scan = await leakScan(page);
  wireReport('c', scan);
  measure('c', 'request header names the reviewer page sent', scan.headerNames.join(', '));
  measure('c', 'requests the reviewer page made', `${scan.requestCount}`);
  const storage = await page.privacyState();
  check('c', 'after answering, the reviewer\'s browser holds no session and no credential',
    storage.local.length === 0 && storage.session.length === 0,
    JSON.stringify({ local: storage.local, session: storage.session }));
  measure('c', 'console coverage',
    'not covered by this tier — the shared driver attaches no Runtime/Log listener; the app\'s '
    + 'describe() masking path is pinned by src/test/familyReviewTransport.test.ts instead');
  await page.close();
  return { ask };
}

// --------------------------------------------------------------------- journey D

async function journeyD(browser, state) {
  console.log('\n==> Stage 7 D — accessibility and mobile on the reviewer page and the host panel');
  if (state.host === null) { check('d', 'journey D ran', false, 'no host page from journey A'); return; }
  const phone = { width: 390, height: 844, dpr: 3, mobile: true };
  const ask = await askForLink(state.host, 'Lakshmi (pedagogue)', 'Version 1');
  const { page, kind } = await openReviewer(browser, ask.link, { label: 's7-a11y', viewport: phone });
  check('d', 'the reviewer page opened at a phone viewport', kind === 'form', kind);

  const structure = await page.evaluate(`(() => {
    const de = document.documentElement;
    const heads = [...document.querySelectorAll('h1,h2,h3')].map((h) => ({
      level: Number(h.tagName.slice(1)), text: h.textContent.trim().replace(/\\s+/g, ' ').slice(0, 46) }));
    const controls = [...document.querySelectorAll(
      'input,select,textarea,button,a[href],label')].map((el) => {
      const r = el.getBoundingClientRect();
      const wrap = el.closest('label');
      const aim = wrap ? wrap.getBoundingClientRect() : r;
      const name = el.tagName.toLowerCase() === 'INPUT' && ['radio','checkbox'].includes(el.type)
        ? (el.labels && el.labels.length ? el.labels[0].textContent.trim() : el.getAttribute('aria-label'))
        : (el.getAttribute('aria-label')
          || (el.labels && el.labels.length ? el.labels[0].textContent.trim() : null)
          || (el.id && document.querySelector('label[for="' + el.id + '"]')
            ? document.querySelector('label[for="' + el.id + '"]').textContent.trim() : null)
          || el.textContent.trim());
      return { tag: el.tagName.toLowerCase(), id: el.id || null, type: el.getAttribute('type'),
        name: (name || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
        aimW: Math.round(aim.width), aimH: Math.round(aim.height),
        w: Math.round(r.width), h: Math.round(r.height),
        disabled: Boolean(el.disabled) };
    });
    return { overflow: de.scrollWidth - de.clientWidth, viewport: window.innerWidth,
      mainLandmarks: document.querySelectorAll('main').length, headings: heads, controls };
  })()`);
  check('d', 'the reviewer page does not overflow its phone viewport horizontally',
    structure.overflow <= 0, `${structure.overflow}px at ${structure.viewport}px wide`);
  check('d', 'exactly one level-1 heading and one main landmark',
    structure.headings.filter((h) => h.level === 1).length === 1
      && structure.mainLandmarks === 1,
    structure.headings.map((h) => `h${h.level}:${h.text}`).join(' · ').slice(0, 300));

  const unlabeled = structure.controls.filter((c) => !['button', 'a'].includes(c.tag)
    && (c.name === '' || c.name === null));
  check('d', 'every form control on the reviewer page has an accessible name',
    unlabeled.length === 0, unlabeled.map((c) => `${c.tag}#${c.id}`).join(', ') || 'none');

  const small = structure.controls.filter((c) => !c.disabled
    && ['radio', 'checkbox'].includes(c.type ?? '') === false
    && ['input', 'select', 'button', 'textarea'].includes(c.tag)
    && (c.aimW < 44 || c.aimH < 44));
  check('d', 'no enabled control on the reviewer page is smaller than 44x44 CSS px',
    small.length === 0,
    small.map((c) => `${c.tag}#${c.id ?? '-'} aim ${c.aimW}x${c.aimH}`).join(', ')
      || `${structure.controls.filter((c) => ['radio', 'checkbox'].includes(c.type ?? '')
        && (c.aimW < 44 || c.aimH < 44)).length} radio/checkbox aim(s) under 44px, sized through their label`);
  const radioAims = structure.controls.filter((c) => ['radio', 'checkbox'].includes(c.type ?? ''));
  measure('d', 'radio aim size through the label',
    radioAims.map((c) => `${c.type} aimed ${c.aimW}x${c.aimH}, own ${c.w}x${c.h}`).join(' · '));

  await page.pressTab();
  const path = [];
  for (let i = 0; i < 12; i += 1) {
    path.push(await page.focusInfo());
    await page.pressTab();
  }
  const stops = path.map((f) => `${f.tag}${f.id ? `#${f.id}` : ''}`
    + `${f.label ? ` "${String(f.label).slice(0, 22)}"` : ''}`);
  const noIndicator = path.filter((f) => f.tag !== 'BODY'
    && (f.outlineWidth === '0px' || f.outlineStyle === 'none')
    && (!f.boxShadow || f.boxShadow === 'none'));
  check('d', 'every keyboard stop on the reviewer page shows a visible indicator',
    noIndicator.length === 0,
    noIndicator.map((f) => `${f.tag}#${f.id ?? '-'} outline ${f.outlineStyle} ${f.outlineWidth}`).join(', ')
      || `${path.length} stops, all with an outline or ring`);
  const reachedForm = path.some((f) => f.id === 'review-label' || f.id === 'review-message'
    || f.id === 'review-section');
  check('d', 'the keyboard path reaches the answer controls', reachedForm, stops.join(' → ').slice(0, 380));
  const radiosSeen = path.filter((f) => f.type === 'radio').length;
  check('d', 'the two answer options are keyboard reachable', radiosSeen >= 1,
    `${radiosSeen} radio stop(s) in the first ${path.length} presses`);

  const host = state.host;
  await host.setViewportSizeOnly(phone);
  await host.goto(`${PREVIEW_ORIGIN}/project/${state.weddingId}/edit`);
  await host.waitForSelector('#family-review-heading');
  const panel = await host.evaluate(`(() => {
    const sec = document.querySelector('section[aria-labelledby="family-review-heading"]');
    if (!sec) return null;
    const de = document.documentElement;
    const controls = [...sec.querySelectorAll('input,select,textarea,button')].map((el) => {
      const r = el.getBoundingClientRect();
      const lab = el.labels && el.labels.length ? el.labels[0].textContent.trim()
        : el.getAttribute('aria-label') || el.textContent.trim();
      return { tag: el.tagName.toLowerCase(), id: el.id || null,
        name: lab.replace(/\\s+/g, ' ').slice(0, 46), w: Math.round(r.width), h: Math.round(r.height),
        disabled: Boolean(el.disabled) };
    });
    return { overflow: de.scrollWidth - de.clientWidth, labelled: sec.getAttribute('aria-labelledby'),
      heading: (sec.querySelector('#family-review-heading')?.textContent ?? '').trim(),
      controls };
  })()`);
  check('d', 'the host panel is labelled by its own heading', panel !== null
    && panel.labelled === 'family-review-heading' && panel.heading === 'Family approval',
    panel ? `labelledBy ${panel.labelled}, heading "${panel.heading}"` : 'no panel');
  const panelSmall = (panel?.controls ?? []).filter((c) => !c.disabled && (c.w < 44 || c.h < 44));
  check('d', 'no enabled control in the host panel is smaller than 44x44 CSS px',
    panelSmall.length === 0,
    panelSmall.map((c) => `${c.tag}#${c.id ?? '-'} ${c.w}x${c.h} "${c.name}"`).join(', ')
      || `${(panel?.controls ?? []).length} control(s) tested`);
  const panelUnnamed = (panel?.controls ?? []).filter((c) => ['button'].includes(c.tag) === false
    && c.name === '');
  check('d', 'every input in the host panel has an accessible name', panelUnnamed.length === 0,
    panelUnnamed.map((c) => `${c.tag}#${c.id}`).join(', ') || 'none');
  measure('d', 'host panel horizontal overflow at the phone viewport', `${panel?.overflow}px`);
  const shotD = join(EVIDENCE_DIR, `s7-panel-${phone.width}x${phone.height}.png`);
  const sizeD = await host.screenshot(shotD);
  measure('d', 'screenshot of the host panel at the phone viewport', `${shotD} (${sizeD})`);
  await host.setViewportSizeOnly({ width: 1280, height: 900, dpr: 1, mobile: false });
  await page.close();
  return { ask };
}

// --------------------------------------------------------------------- teardown

async function teardown() {
  // Child before parent, in the order the foreign keys demand: the feedback rows and the
  // credentials reference the ask, the ask references the frozen version. `set local` keeps the
  // storage escape hatch inside this transaction; this tier uploads no bytes, and the object
  // count is read back and reported rather than assumed.
  psqlRows(`
    begin;
    delete from public.approval_feedback where wedding_id in ${owners};
    delete from private.access_tokens where wedding_id in ${owners};
    delete from public.approval_requests where wedding_id in ${owners};
    delete from public.publications where wedding_id in ${owners};
    delete from public.wedding_assets where wedding_id in ${owners};
    delete from public.wedding_events where wedding_id in ${owners};
    delete from public.wedding_people where wedding_id in ${owners};
    delete from public.venues where wedding_id in ${owners};
    delete from public.invitation_drafts where wedding_id in ${owners};
    delete from public.invitation_versions where wedding_id in ${owners};
    delete from public.weddings where id in ${owners};
    commit;
  `);
  const svc = createClient(apiUrl, serviceKey, { auth: { persistSession: false } });
  const { data } = await svc.auth.admin.listUsers({ pageSize: 1000 });
  for (const user of data.users ?? []) {
    if (user.email?.endsWith(`+${RUN_TAG}@example.test`)) {
      const { error } = await svc.auth.admin.deleteUser(user.id);
      if (error) console.log(`  !! could not remove ${user.email}: ${error.message}`);
    }
  }
  const left = psqlValue(`select (select count(*) from public.weddings w join auth.users u
      on u.id = w.owner_user_id where u.email like '%+${RUN_TAG}@example.test')::text
    || ' weddings, ' || (select count(*) from public.approval_requests where wedding_id in ${owners})::text
    || ' asks, ' || (select count(*) from public.approval_feedback where wedding_id in ${owners})::text
    || ' feedback, ' || (select count(*) from private.access_tokens where wedding_id in ${owners})::text
    || ' credentials, ' || (select count(*) from auth.users
      where email like '%+${RUN_TAG}@example.test')::text || ' accounts'`);
  const leftAccounts = psqlValue(`select count(*)::text from auth.users
    where email like '%+${RUN_TAG}@example.test'`);
  const leftAsks = psqlValue(`select count(*)::text from public.approval_requests
    where wedding_id in ${owners}`);
  const leftTokens = psqlValue(`select count(*)::text from private.access_tokens
    where wedding_id in ${owners}`);
  check('cleanup', 'every account this run created is gone', leftAccounts === '0', `left ${leftAccounts}`);
  check('cleanup', 'every ask this run created is gone', leftAsks === '0', `left ${leftAsks}`);
  check('cleanup', 'every review credential this run created is gone', leftTokens === '0',
    `left ${leftTokens}`);
  measure('cleanup', 'residue report', left ?? 'no report');
  rmSync(SCRATCH, { recursive: true, force: true });
}

// --------------------------------------------------------------------- main

async function main() {
  console.log(`Stage 7 browser tier · run tag ${RUN_TAG} · preview ${PREVIEW_ORIGIN} · api ${apiUrl}`);
  const index = await fetch(`${PREVIEW_ORIGIN}/`).catch(() => null);
  if (!index?.ok) throw new Error(`no production bundle at ${PREVIEW_ORIGIN} — run npm run build and `
    + 'npm run preview');

  const bundleFiles = [];
  const collect = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) collect(p);
      else if (/\.(?:js|mjs|css|html)$/.test(entry.name)) bundleFiles.push(readFileSync(p, 'utf8'));
    }
  };
  collect(join(ROOT, 'dist'));
  const bundleText = bundleFiles.join('\n');
  const SENTENCES = [
    'This review link is not available.',
    'Send my answer',
    'Your answer is recorded',
    'Nothing to send yet — freeze a version under',
    'There is no sign-in on this page',
  ];
  for (const s of SENTENCES) {
    check('prelude', 'the shipped bundle carries the reviewer copy', bundleText.includes(s),
      JSON.stringify(s.slice(0, 44)));
  }
  check('prelude', 'the shipped bundle calls the loopback target', bundleText.includes(browserApiUrl));
  const hostedOrigins = [
    ...new Set(bundleText.match(/https:\/\/[A-Za-z0-9._-]+\.supabase\.(?:co|in)(?=[\s"'`,:)?\]}]|$)/g) ?? []),
  ];
  check('prelude', 'no hosted Supabase origin of any shape is baked into the shipped bundle',
    hostedOrigins.length === 0,
    hostedOrigins.length ? `origins found (host names only): ${hostedOrigins.join(', ')}` : 'none');
  check('prelude', 'the local stack answers', psqlValue('select 1') === '1');
  const verbs = psqlValue(`select string_agg(p.proname, ',' order by p.proname) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal_api' and p.proname in ('request_family_review','resolve_family_review',
      'submit_family_review','revoke_family_review','get_approval_requests')`);
  check('prelude', 'the five Stage 7 verbs are on the stack this run will exercise',
    String(verbs).split(',').length === 5, String(verbs));
  measure('prelude', 'bytes of shipped JS/CSS/HTML scanned', `${(bundleText.length / 1024).toFixed(0)} KB`);

  const browser = await openBrowser({ cdpPort: CDP_PORT });
  const state = { host: null, weddingId: null };
  const runJourney = async (label, fn) => {
    try { return await fn(); } catch (err) {
      check('harness', `${label} could not be completed`, false, String(err?.message ?? err).slice(0, 300));
      return null;
    }
  };
  const guarded = async (letter, label, needsHost, fn) => {
    if (!wants(letter)) return null;
    if (needsHost && state.host === null) {
      check(letter, `${label} ran`, false, 'journey A did not produce a host page or a wedding');
      return null;
    }
    return runJourney(label, fn);
  };
  try {
    await guarded('a', 'journey A (ask, review, read-back)', false, () => journeyA(browser, state));
    await guarded('b', 'journey B (withdrawal, forged, stranger)', true, () => journeyB(browser, state));
    await guarded('c', 'journey C (wire and privacy)', true, () => journeyC(browser, state));
    await guarded('d', 'journey D (a11y and mobile)', true, () => journeyD(browser, state));
  } finally {
    await browser.close().catch(() => {});
    const before = psqlValue(`select (select count(*) from public.approval_requests
      where wedding_id in ${owners})::text || ' asks and '
      || (select count(*) from public.approval_feedback where wedding_id in ${owners})::text
      || ' answers before teardown'`);
    console.log(`==> ${before}`);
    await teardown();
    // The last word on masking: the hook saw both sides of every write, so this is a before/after
    // measurement of the run's own stdout, not a promise that `check()` was careful.
    const tried = rawChunks.join('');
    const cameOut = emittedChunks.join('');
    const carried = [...DISCOVERED].filter((t) => tried.includes(t));
    const escaped = [...DISCOVERED].filter((t) => cameOut.includes(t));
    check('cleanup', 'every credential this run tried to print was masked before it left',
      escaped.length === 0 && carried.length > 0,
      `${DISCOVERED.size} credential(s) registered, ${carried.length} appeared in what this run `
      + `tried to print, ${maskedChunkCount} write(s) were rewritten, ${escaped.length} escaped`);
    const logPath = join(EVIDENCE_DIR, `s7-browser-${RUN_TAG}.log`);
    writeFileSync(logPath, cameOut, 'utf8');
    measure('cleanup', 'evidence log, written from the side that left for the terminal', logPath);
  }

  const checks = results.filter((r) => !r.measured).length;
  console.log(`\n==> checks ${checks}, measurements `
    + `${results.filter((r) => r.measured).length}, findings ${failureCount}`);
  if (failureCount > 0) {
    console.log('FINDINGS:');
    for (const r of results.filter((x) => !x.ok)) console.log(`  - [${r.area}] ${r.name}: ${r.detail}`);
    process.exitCode = 1;
  } else {
    console.log('STAGE 7 BROWSER TIER: PASS');
  }
}

await main();
