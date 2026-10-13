#!/usr/bin/env node
// VIVAAHVARNAM Stage 8 — the household-invitation and RSVP browser tier.
//
// What the other Stage 8 instruments already prove, and what none of them proves:
//   * `supabase/tests/stage8/90_guest_rsvp.sql` proves the door's rules as SQL.
//   * `supabase/tests/api/stage8_guest_rsvp.test.mjs` proves them over PostgREST with hand-built
//     requests — it knows the route, the header and the body because it writes them.
//   * `src/test/guestDoorPage.test.tsx`, `guestDoorTransport.test.ts` and the two panel tests prove the
//     React surfaces against a mocked door.
//   None of them shows that a host can list a family, scope its ceremonies, and get an address that
//   works; that the address shown once is the address that opens the door; that a family on a phone
//   reads their own invitation and nothing else; that the page stops a 0, a 1.5 or a 1001 before the
//   server is asked; that the host's Replies list shows what the family actually typed; or that the
//   credential this run mints stays where §4 declares it and goes nowhere else. This tier clicks the
//   shipped `dist/` bundle against the running local stack and reads the wire.
//
// Guarantees enforced before anything is clicked:
//   * both origins are loopback and `project_id` is this repository's disposable stack — the same three
//     checks every tier since Stage 4 makes, copied deliberately so a fresh reader need not trust an
//     import;
//   * the built bundle carries the guest door's own sentences and calls the loopback target, so a
//     client-side gate measured here is a gate that shipped;
//   * every raw credential this run mints — household addresses and the wedding address — is registered
//     in `DISCOVERED`, masked out of every printed line, and re-verified as absent from the database,
//     the host page after a reload, and the wire beyond the declared set;
//   * accounts and rows belong to this run's tag and are removed child-before-parent.
//
// Usage:
//   npm run build
//   npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
//   node scripts/stage8-browser-guest.mjs              # all four journeys
//   node scripts/stage8-browser-guest.mjs --only=a     # just the first one
//   node scripts/stage8-browser-guest.mjs --only=a,b   # a prefix of the sequence, in order
//
// Exit code 1 means a finding was recorded, not that the harness broke; a harness failure throws.
//
// Two limitations are stated rather than hidden. The shared CDP driver attaches no console listener, so
// "the raw credential never reached the JavaScript console" is not measured here (the app's own
// `describe()` masks what it logs, pinned by unit test). Its network log carries request *headers* and
// response bodies but no request bodies, so "the credential is never in the submit body" is pinned by
// `src/test/guestDoorTransport.test.ts`, not measured here; what journey C does measure is that the
// credential rides exactly one header on the two RPCs and appears in no URL but the guest's own page
// address. Both are reported as not-covered rather than passed over.

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
  process.env.STAGE8_PREVIEW_URL ?? 'http://127.0.0.1:4173', 'STAGE8_PREVIEW_URL');
const CDP_PORT = Number(process.env.STAGE8_CDP_PORT ?? 9431);
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '--only=a,b,c,d')
  .slice('--only='.length).split(',').map((x) => x.trim().toLowerCase());
const wants = (letter) => ONLY.includes(letter);
// Journeys B, C and D continue the wedding journey A builds (the host page, the published version and
// the rotated address are its outputs). Running one alone is not a product verdict — it is the harness
// asking a question it never set up — so it is refused at startup instead of reported as a finding.
if (!wants('a') && ['b', 'c', 'd'].some(wants)) {
  throw new Error(`--only=${ONLY.join(',')} cannot run without a: journeys b, c and d continue the `
    + 'wedding journey a creates. Use --only=a,b (or the default).');
}

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

const RUN_TAG = `s8ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}`;
const SCRATCH = join(tmpdir(), `stage8-ui-${RUN_TAG}`);
mkdirSync(SCRATCH, { recursive: true });
const EVIDENCE_DIR = resolve(process.env.STAGE8_EVIDENCE_DIR ?? join(ROOT, '..', 'q8-logs'));
mkdirSync(EVIDENCE_DIR, { recursive: true });

const COUPLE = 'Meena weds Arun';
const OTHER_COUPLE = 'Priya weds Karthi';
const LINES = {
  opening: 'With the blessings of our elders, we ask you to share this day.',
  familyIntroduction: 'Parents, grandparents and cousins invite you.',
  eventNotes: 'The ceremony begins at sunrise on the river terrace.',
  closing: 'Come as you are; your presence is the gift.',
};
/** Written into `host_notes`, the one column §9 proves has no path to a guest. A marker rather than a
 *  sentence, because the check is "this string appears nowhere on the guest's page or wire". */
const PRIVATE_NOTE = 'PRIVATE-HostNote-DoNotReachGuest';
const MUHURTHAM = 'Muhurtham';
const RECEPTION = 'Reception Hall';
const H1 = 'Krishnan family';
const H2 = 'Anand family';
const H3 = 'Ravi family';
const H4 = 'Vettriyur family';
const GUEST_DOOR_UNAVAILABLE = 'This invitation link is not available.';

// --------------------------------------------------------------------- reporting

/** Every raw credential this run was handed or invented. Two uses, as in Stage 7: no query or
 *  assertion detail may embed one, and the closing masking sweep has to know what it hunted for. */
const DISCOVERED = new Set();
const TOKEN_SHAPED = /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g;
const mask = (value) => String(value).replace(TOKEN_SHAPED, (whole, lead) => `${lead}‹credential masked›`);

// Stage 9 removed this tier's font-host allowset: the six pinned faces are served from this origin
// (`public/fonts/`), so a guest page has no legitimate destination outside the machine and any host
// appearing below is a finding rather than a declared exception.
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

/** Writes a line through the hook with a credential in it, on purpose, so the closing sweep measures
 *  the hook rather than the care of `check()`. Never counted as a check. */
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

// --------------------------------------------------------------------- database reads

function psqlRows(query) {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-F', '|', '-c', query],
  { encoding: 'utf8' }).split(/\r?\n/).filter((l) => l !== '');
}
const psqlValue = (query) => psqlRows(query)[0] ?? null;

const owners = `(select w.id from public.weddings w join auth.users u on u.id = w.owner_user_id
  where u.email like '%+${RUN_TAG}@example.test')`;
const sql = (text) => `'${String(text).replace(/'/g, "''")}'`;

// --------------------------------------------------------------------- page helpers
// Names and shapes copied from `stage7-browser-review.mjs` on purpose: the tiers share a driver, and a
// reader who knows one should read the other without working out why one problem is solved twice.

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
    out.push({ url: hit.url, status: hit.status, method: hit.method, body,
      headers: { ...(hit.headers ?? {}), ...(hit.sentHeaders ?? {}) } });
  }
  return out;
}

const callCount = async (page, urlPart) => (await page.networkLog())
  .filter((r) => r.url.includes(urlPart) && carriesData(r)).length;

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
  check('prelude', `${who}: reached the dashboard with no email-confirmation step`, Boolean(dash),
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
  if (!(await waitForUrl(page, '/edit'))) throw new Error('the editor never opened from the planning page');
  return weddingId;
}

async function openAddForm(page, buttonWords, fieldSelector) {
  await page.pressButtonWhenReady(buttonWords);
  if (!(await page.waitForSelector(fieldSelector))) {
    throw new Error(`"${buttonWords}" was pressed but ${fieldSelector} never appeared`);
  }
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
const previewCount = (page) => callCount(page, PREVIEW_URL_PART);

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
        return { count: seen.length, status: last.status, raw, issues: raw?.issues ?? null,
          invitation: raw?.invitation ?? null };
      }
    }
    if (Date.now() > deadline) return null;
    await sleep(200);
  }
}

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

const saveStatusLine = (page) => page.evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /^(Save Draft|Saving)/.test(b.textContent.trim().replace(/\\s+/g, ' ')));
  if (!btn) return null;
  const cluster = btn.parentElement;
  const p = cluster ? cluster.querySelector('[role=status]') : null;
  return p ? p.innerText.trim().replace(/\\s+/g, ' ') : null;
})()`);

/** Presses the editor's Save and waits for the save to be *over*, not for the word to appear — the
 *  window Stage 7 measured on 2026-10-08, where the header said "Saved" while the save's own document
 *  read was still in flight and the product's unsaved-changes guard then refused the freeze. */
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
  if (!settled) throw new Error(`the save never settled on "Saved": ${summary}`);
  return summary;
}

async function pressOffered(page, words, scope = null) {
  try {
    await page.pressButtonWhenReady(words, 25_000, scope);
    return 'pressed';
  } catch (err) {
    return String(err.message).replace(`[${page.name}] `, '');
  }
}
async function pressEvidence(page, rpc) {
  const rows = await responsesFor(page, rpc);
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
  return `asked ${rpc}: ${rows.length ? rows.map((r) => `HTTP ${r.status}`).join(', ')
    : 'the app made no such call'} · the page says: ${said || 'nothing'}`;
}

// --------------------------------------------------------------------- the guest panels
//
// The panel prints one `<li>` per family and every family's row carries the same button words
// ("Their events", "Create their link", "Withdraw link"), so an unscoped press would answer for
// whichever row the DOM happens to reach first — the failure the driver's own §28 note records for the
// content rows. `markRow` tags the intended row and every press in it goes through the driver's scoped,
// hit-tested mouse path, so `disabled` and `obstructed` stay the product's verdicts rather than the
// harness's guesses. The attribute is the harness's own and is cleared before each mark.

const ROW_SCOPE = 'li[data-s8row="1"]';
const INVITE_SECTION = 'section[aria-labelledby="guest-invitations-heading"]';

const markRow = (page, name) => page.evaluate(`(() => {
  document.querySelectorAll('[data-s8row]').forEach((el) => { delete el.dataset.s8row; });
  const sec = document.querySelector(${JSON.stringify(INVITE_SECTION)});
  const li = [...(sec?.querySelectorAll('li') ?? [])]
    .find((l) => l.querySelector('div > p')?.textContent.trim() === ${JSON.stringify(name)});
  if (!li) return 0;
  li.dataset.s8row = '1';
  return 1;
})()`);

async function rowButtonState(page, name, words) {
  if ((await markRow(page, name)) !== 1) return 'no-row';
  return page.buttonState(words, ROW_SCOPE);
}

/** The shown-once address block is a different `<li>` from the family's status row: the panel prints
 *  the link (`GuestInvitationPanel.tsx:655-672`) above the rows, and its Copy control is the only
 *  thing in that block. `markRow` deliberately cannot see it — a block's name sits in a bare `<p>`,
 *  not in `div > p` — so pressing Copy through the row scope asks a container that holds no such
 *  button and returns the harness's own 'absent' as if the product had refused. */
const markLinkBlock = (page, name) => page.evaluate(`(() => {
  document.querySelectorAll('[data-s8row]').forEach((el) => { delete el.dataset.s8row; });
  const sec = document.querySelector(${JSON.stringify(INVITE_SECTION)});
  const head = ${JSON.stringify(name)} + String.fromCharCode(39) + 's invitation link. It is shown once.';
  const li = [...(sec?.querySelectorAll('li') ?? [])]
    .find((l) => (l.querySelector(':scope > p')?.textContent ?? '').trim() === head);
  if (!li) return 0;
  li.dataset.s8row = '1';
  return 1;
})()`);

/** The block's own sentence after a press, which is the product's verdict on the action rather than
 *  the harness reporting that it moved a mouse. */
const linkBlockStatus = (page, name) => page.evaluate(`(() => {
  const sec = document.querySelector(${JSON.stringify(INVITE_SECTION)});
  const head = ${JSON.stringify(name)} + String.fromCharCode(39) + 's invitation link. It is shown once.';
  const li = [...(sec?.querySelectorAll('li') ?? [])]
    .find((l) => (l.querySelector(':scope > p')?.textContent ?? '').trim() === head);
  return li ? (li.querySelector('[role=status]')?.textContent ?? '').trim().replace(/\\s+/g, ' ') : null;
})()`);

/** Press a control inside one family's shown-once block, waiting for it to be offered. A block that is
 *  not there is the panel having dropped it — which is the promise §3 tests — so it is a finding, not
 *  a retry. */
async function pressLinkBlock(page, name, words, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await markLinkBlock(page, name)) !== 1) return 'no-block';
    const state = await page.buttonState(words, ROW_SCOPE);
    if (state === 'absent') return 'absent';
    if (state === 'enabled') {
      const out = await page.pressButton(words, ROW_SCOPE);
      if (out === 'pressed') return out;
      if (Date.now() > deadline) return out;
      await sleep(200);
      continue;
    }
    if (Date.now() > deadline) return state;
    await sleep(250);
  }
}

/** Waits for the row's control to be offered and enabled, then insists the click landed. A row that
 *  keeps the control disabled past the deadline is the product's answer, returned as `'disabled'`. */
async function pressRow(page, name, words, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await rowButtonState(page, name, words);
    if (state === 'no-row') throw new Error(`no row for "${name}" on the guest panel`);
    if (state === 'enabled') {
      const out = await page.pressButton(words, ROW_SCOPE);
      if (out === 'pressed') return out;
      if (Date.now() > deadline) return out;
      await sleep(200);
      continue;
    }
    if (Date.now() > deadline) return state;
    await sleep(250);
  }
}

async function addHousehold(page, { name, salutation, expected, notes }) {
  await page.waitForSelector('#guest-new-displayName');
  await page.setBySelector('#guest-new-displayName', name);
  await page.setBySelector('#guest-new-salutation', salutation);
  await page.setBySelector('#guest-new-expectedPartySize', expected);
  await page.setBySelector('#guest-new-hostNotes', notes);
  const pressed = await pressOffered(page, 'Add them to the list');
  const landed = await page.waitForText(`${name} is on the list`, 25_000);
  if (pressed !== 'pressed' || !landed) {
    throw new Error(`adding "${name}" did not land (press ${pressed}; copy on page `
      + `${Boolean(landed)}): ${(await page.bodyText()).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  return psqlValue(`select id::text from public.guest_households where wedding_id in ${owners}
    and display_name = ${sql(name)} limit 1`);
}

/** Opens one family's ceremony list, ticks the named ceremonies, and saves through the panel. */
async function scopeHousehold(page, name, ceremonyIds) {
  const opened = await pressRow(page, name, 'Their events');
  if (opened !== 'pressed') throw new Error(`"${name}" events editor did not open (${opened})`);
  const done = [];
  for (const id of ceremonyIds) {
    const selector = `#scope-${id.replace(/^(.{8}).*$/, '$1')}`; // unused placeholder, see below
    void selector;
  }
  for (const [householdId, ids] of [[null, ceremonyIds]]) void householdId; void ids;
  return opened;
}

// --------------------------------------------------------------------- publication

async function freezeAndPublish(page, versionLabel = 'Version 1') {
  const froze = await pressOffered(page, 'Freeze this draft as a version');
  const frozenCopy = await page.waitForText('It cannot be edited.', 30_000);
  check('journey', `the draft was frozen into an immutable version (${versionLabel})`,
    froze === 'pressed' && Boolean(frozenCopy),
    `${froze}; ${await pressEvidence(page, 'create_invitation_version')}`);
  const published = await pressOffered(page, 'Publish');
  const live = await page.waitForText('A link is live', 30_000);
  check('journey', 'the frozen version was published and the panel reports a live link',
    published === 'pressed' && Boolean(live),
    `${published}; ${await pressEvidence(page, 'publish_invitation')}`);
  return versionLabel;
}

/** Every address the panel is currently holding, read out of its own shown-once blocks. `textContent`
 *  rather than `innerText` because the block sets `break-all`, and a rendered line break inside a
 *  credential would otherwise look like a token that is not there. */
const mintedBlocks = (page) => page.evaluate(`(() => {
  const sec = document.querySelector(${JSON.stringify(INVITE_SECTION)});
  const tail = "'s invitation link. It is shown once.";
  const out = [];
  for (const li of sec?.querySelectorAll('li') ?? []) {
    const head = (li.querySelector(':scope > p')?.textContent ?? '').trim();
    if (!head.endsWith(tail)) continue;
    out.push({ owner: head.slice(0, head.length - tail.length),
      tokens: [...new Set((li.textContent.match(/[A-Za-z0-9_-]{43}/g) ?? []))],
      status: (li.querySelector('[role=status]')?.textContent ?? '').trim().replace(/\\s+/g, ' ') });
  }
  return out;
})()`);

/** The credential-shaped strings anywhere on a page, by `textContent` for the same reason. */
const pageCredentials = (page) => page.evaluate(`(() => {
  return [...new Set((document.body.textContent.match(/[A-Za-z0-9_-]{43}/g) ?? []))];
})()`);

/** Mints one family's address through its own row and returns the address the panel showed. Throws if
 *  the block holds two credentials — a run that cannot say which address it is testing proves nothing. */
async function mintLink(page, name) {
  const callsBefore = await callCount(page, 'issue_guest_invitations');
  const pressed = await pressRow(page, name, 'Create their link');
  const copy = await page.waitForText('Their link is ready. Copy it now', 25_000);
  const callsAfter = await callCount(page, 'issue_guest_invitations');
  const blocks = await mintedBlocks(page);
  const mine = blocks.filter((b) => b.owner === name);
  const tokens = mine.length > 0 ? mine[mine.length - 1].tokens : [];
  check('journey', `${name}: one send, one address, and the panel said it cannot be shown again`,
    pressed === 'pressed' && Boolean(copy) && callsAfter === callsBefore + 1 && tokens.length === 1,
    `${pressed}; ask tally ${callsBefore} → ${callsAfter}; blocks for this family `
    + `${mine.length} holding ${tokens.length} credential(s); ${await pressEvidence(page, 'issue_guest_invitations')}`);
  if (tokens.length !== 1) {
    throw new Error(`${name}: the shown-once block held ${tokens.length} credential-shaped strings — `
      + 'the run cannot say which address it would test');
  }
  DISCOVERED.add(tokens[0]);
  printRaw(`[${name}] the household address the panel formed → ${PREVIEW_ORIGIN}/g/${tokens[0]}`);
  return { token: tokens[0], url: `${PREVIEW_ORIGIN}/g/${tokens[0]}` };
}

/** Rotates through the row and takes the successor out of the block the panel appended after it. */
async function rotateLink(page, name) {
  const pressed = await pressRow(page, name, 'New link for them');
  const copy = await page.waitForText('The old address stops working at once', 25_000);
  const blocks = (await mintedBlocks(page)).filter((b) => b.owner === name);
  const token = blocks.length > 0 ? blocks[blocks.length - 1].tokens[0] ?? null : null;
  check('journey', `${name}: the panel rotated the address and said the old one stops now`,
    pressed === 'pressed' && Boolean(copy) && token !== null,
    `${pressed}; ${blocks.length} block(s) for this family; `
    + await pressEvidence(page, 'rotate_guest_invitation'));
  if (token === null) throw new Error(`${name}: no successor address appeared after the rotate`);
  DISCOVERED.add(token);
  printRaw(`[${name}] the rotated household address → ${PREVIEW_ORIGIN}/g/${token}`);
  return { token, url: `${PREVIEW_ORIGIN}/g/${token}` };
}

// --------------------------------------------------------------------- the guest's page

/** A credential that never resolves and a household with nothing to answer are different outcomes, and
 *  both are polled against one deadline so a refused link costs seconds rather than two timeouts. */
async function openGuestDoor(browser, url, { label, viewport = null }) {
  const page = await browser.newPage(label);
  if (viewport) await page.setViewportSizeOnly(viewport);
  await page.goto(url);
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (await page.hasText('Will you be there?')) return { page, kind: 'form' };
    if (await page.hasText(GUEST_DOOR_UNAVAILABLE)) return { page, kind: 'refusal' };
    if (await page.hasText('There is no event on this invitation for your household')) {
      return { page, kind: 'read-only' };
    }
    if (Date.now() > deadline) break;
    await sleep(250);
  }
  throw new Error(`[${label}] the guest route produced none of its three outcomes: `
    + `${(await page.bodyText()).replace(/\s+/g, ' ').slice(0, 220)}`);
}

const cardIds = (page, index) => page.evaluate(`(() => {
  const boxes = [...document.querySelectorAll('input[type=radio][name="guest-attending-${index}"]')];
  return { checked: boxes.find((b) => b.checked)?.value ?? null,
    size: document.querySelector('#guest-party-size-${index}')?.value ?? null,
    problem: document.querySelector('#guest-party-size-${index}-problem')?.textContent.trim() ?? null,
    legend: document.querySelectorAll('fieldset > legend')[${index} + 1]?.textContent.trim() ?? null };
})()`);

// --------------------------------------------------------------------- the wire

/** One entry per place a registered credential was actually seen, with the header set the network
 *  service put on the wire (`sentHeaders`) preferred over what the renderer proposed — the distinction
 *  Stage 5 measured for referrers, and the same reason it matters for a bearer token. */
async function credentialTravel(page) {
  const log = await page.networkLog();
  const discovered = [...DISCOVERED];
  const travel = [];
  const offMachineReferers = [];
  const nonEgressSchemes = [];
  for (const r of log) {
    let parsed = null;
    try { parsed = new URL(r.url); } catch { parsed = null; }
    const host = parsed ? parsed.host : '?';
    const egress = Boolean(parsed) && /^https?:$/.test(parsed.protocol) && !urlHostIsLoopback(r.url);
    if (parsed && !/^https?:$/.test(parsed.protocol)) nonEgressSchemes.push(parsed.protocol);
    const headers = { ...(r.headers ?? {}), ...(r.sentHeaders ?? {}) };
    for (const [k, v] of Object.entries(headers)) {
      const hit = discovered.find((t) => String(v).includes(t));
      if (hit) travel.push({ kind: 'header', name: k.toLowerCase(), host, url: r.url, needle: hit });
      if (egress && k.toLowerCase() === 'referer') offMachineReferers.push({ host, referer: String(v) });
    }
    if (parsed === null || !r.url.startsWith('http')) continue;
    const hit = discovered.find((t) => parsed.pathname.includes(t) || parsed.search.includes(t)
      || parsed.hash.includes(t));
    if (hit) {
      const where = parsed.pathname.includes(hit) ? 'path'
        : parsed.search.includes(hit) ? 'query' : 'hash';
      travel.push({ kind: 'url', name: where, where, host, url: r.url, path: parsed.pathname,
        needle: hit });
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
    travel, nonUrl, hosts, offMachine,
    telemetry: offMachine.filter((h) => TELEMETRY_HOSTS.some((t) => h === t || h.endsWith(`.${t}`))),
    offMachineReferers: [...new Map(offMachineReferers.map((x) => [`${x.host}\u0000${x.referer}`, x]))
      .values()],
    nonEgressSchemes: [...new Set(nonEgressSchemes)],
    requestCount: log.length,
    log,
  };
}

/** Where this pass declares a household credential may appear, stated as places rather than as a ban:
 *  the address is the link the host copied, so it *is* the guest's own page address, and it rides one
 *  header to the loopback API. A flat ban on "any credential on the wire" was falsified by the design
 *  in Stage 5 and again in Stage 7; what a wire pass can answer is whether the travel is exactly the
 *  declared set and whether any of it leaves this machine. */
const MAY_TRAVEL_TO = [
  { name: 'the household\'s own page address, in the path', test: (t) => t.kind === 'url'
      && t.where === 'path' && urlHostIsLoopback(t.url) && t.path.startsWith('/g/') },
  { name: 'the x-guest-token header on one of the two guest RPCs', test: (t) => t.kind === 'header'
      && t.name === 'x-guest-token' && urlHostIsLoopback(t.url)
      && /\/rpc\/(resolve_guest_invitation|submit_guest_rsvp)(\?|$)/.test(t.url) },
];

/** The wedding address is a different credential with a different owner: it belongs to the host's own
 *  shown-once block and to the public `/i/` page, and it must never ride a household's header. */
function weddingLinkTravel(scan, weddingToken) {
  return scan.travel.filter((t) => t.needle === weddingToken
    && !(t.kind === 'url' && t.where === 'path' && t.path.startsWith('/i/')));
}

function wireReport(tag, scan) {
  const tally = scan.travel.map((t) => `${t.kind === 'header' ? `header:${t.name}`
    : `url:${t.where}`}@${t.host}`);
  measure(tag, 'where each credential of this pass was actually seen on the wire',
    [...new Set(tally)].join(', ') || 'nowhere');
  const stray = scan.travel.filter((t) => !MAY_TRAVEL_TO.some((d) => d.test(t)));
  check(tag, 'a household credential travels only to the places this pass declares',
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
  check(tag, 'no analytics, session-replay or telemetry host was contacted by the guest page',
    scan.telemetry.length === 0, scan.telemetry.join(', ') || 'none');
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
        + '43-character token');
  measure(tag, 'what this pass cannot reach',
    'the household\'s address holds the credential by design, so it also sits in that browser\'s '
    + 'history and in whatever access log the hosting stack keeps; the driver logs no request bodies, '
    + 'so "never in the submit body" is pinned by guestDoorTransport.test.ts and not measured here; '
    + 'and no console listener is attached, so "never printed to the console" is not covered either');
}

/** The guest's two RPC requests, header by header: which header carried the credential, and whether the
 *  call carried a signed-in user's JWT. A household page that sent a bearer token would be a page that
 *  signed somebody in. */
async function guestRequestCensus(page) {
  const rows = [];
  for (const r of await responsesFor(page, '/rest/v1/rpc/')) {
    const fn = /rpc\/([a-z_]+)/.exec(r.url)?.[1] ?? '?';
    const auth = r.headers.authorization ?? r.headers.Authorization ?? null;
    rows.push({ fn,
      guestHeader: r.headers['x-guest-token'] ?? r.headers['X-Guest-Token'] ?? null,
      authKind: auth === null ? 'none'
        : auth.startsWith('Bearer ') ? (auth.slice(7).split('.').length === 3 ? 'jwt' : 'key')
          : 'other',
      status: r.status });
  }
  const tableReads = (await page.networkLog())
    .filter((r) => /\/rest\/v1\/(rsvp_responses|guest_households|household_event_scopes|weddings|invitations)/
      .test(r.url));
  return { rows, tableReads };
}

// --------------------------------------------------------------------- journey A

async function journeyA(browser, state) {
  console.log('\n==> Stage 8 A — host lists a family, sends its link, family answers on a phone, host reads it back');
  const host = await signUpAndEnterHost(browser, 's8-host');
  state.host = host;
  const weddingId = await createWedding(host, { title: COUPLE, lang: 'en' });
  state.weddingId = weddingId;
  measure('a', 'wedding created through the UI', weddingId.slice(0, 8));

  const panelEarly = await host.waitForSelector('#guest-invitations-heading', 8_000);
  check('a', 'the guest invitation panel is on the editor page', Boolean(panelEarly));
  // The heading mounts while `rows` is still null — GuestInvitationPanel.tsx:626 shows a loading
  // skeleton and the no-families copy renders only after the panel's own load resolves (:412).
  const emptyCopy = await host.waitForText('No families listed yet', 15_000);
  check('a', 'with no families listed the panel says so and stops', emptyCopy,
    emptyCopy ? 'the no-families copy is on the page'
      : (await host.bodyText()).replace(/\s+/g, ' ').slice(0, 200));

  const typed = await typeAvailableProse(host, LINES);
  check('a', 'the four prose slots were filled through the product', typed.length === 4, typed.join(', '));
  const person = await addPerson(host, { name: 'Ravikumar Kandasamy', role: 'Father',
    group: 'The grooms family' });
  const venue = await addVenue(host, { name: 'Kalyana Mantapa',
    address: '100 Pillar Road\nMadurai 625001' });
  await previewAfter(host, async () => {
    await addCeremony(host, { name: MUHURTHAM, starts: '2026-11-14T07:30',
      timezone: 'Asia/Kolkata', venueName: 'Kalyana Mantapa' });
  });
  await previewAfter(host, async () => {
    await addCeremony(host, { name: RECEPTION, starts: '2026-11-14T19:00',
      timezone: 'Asia/Kolkata', venueName: 'Kalyana Mantapa' });
  });
  check('a', 'person, venue and both ceremonies were added through the product',
    Boolean(person) && Boolean(venue) && await host.hasText(MUHURTHAM) && await host.hasText(RECEPTION));
  measure('a', 'the header save status from the Save press to a settled save', await saveDraft(host));
  const preview = await readPreview(host, { minCount: 1 });
  const blocking = (preview?.issues ?? []).filter((i) => i.blocking === true);
  check('a', 'the server reports no blocking issue on the completed draft', blocking.length === 0,
    JSON.stringify(blocking).slice(0, 240));

  await host.goto(`${PREVIEW_ORIGIN}/project/${weddingId}/edit`);
  await host.waitForSelector('#publication-heading');
  await freezeAndPublish(host);
  const publicTokens = await pageCredentials(host);
  for (const t of publicTokens) DISCOVERED.add(t);
  check('a', 'the published wedding address appeared exactly once on the panel',
    publicTokens.length === 1, `${publicTokens.length} credential-shaped string(s) on the page`);
  const snapshotBefore = psqlValue(`select md5(snapshot::text) from public.invitation_versions
    where wedding_id = '${weddingId}' and version_number = 1`);

  await host.reload();
  const afterReload = await pageCredentials(host);
  check('a', 'a reload does not hand the wedding address back either', afterReload.length === 0,
    afterReload.length === 0 ? 'no credential-shaped string on the reloaded page'
      : `${afterReload.length} still on the page`);
  await host.waitForSelector('#guest-invitations-heading');

  // -- households, through the panel
  const h1Id = await addHousehold(host, { name: H1, salutation: `The ${H1.split(' ')[0]} household`,
    expected: '4', notes: PRIVATE_NOTE });
  check('a', 'the first family was added through the product and is a row', h1Id !== null, String(h1Id));
  const unscopedState = await rowButtonState(host, H1, 'Create their link');
  const flagged = await host.hasText('invited to no event');
  check('a', 'a family scoped to nothing is flagged, and its link is not offered',
    unscopedState === 'disabled' && flagged,
    `button: ${unscopedState}; warning on page: ${flagged}`);
  check('a', 'and the panel says the row cannot be deleted only when something pins it — here nothing does',
    await rowButtonState(host, H1, 'Remove from list') === 'enabled',
    await rowButtonState(host, H1, 'Remove from list'));

  const ceremonyIds = psqlRows(`select id::text from public.wedding_events where wedding_id = '${weddingId}'
    order by display_order, starts_at_local`);
  check('a', 'both ceremonies exist as events to invite people to', ceremonyIds.length === 2,
    ceremonyIds.length);

  await pressRow(host, H1, 'Their events');
  await host.waitForSelector(`#scope-${h1Id}-${ceremonyIds[0]}`);
  await host.clickSelector(`#scope-${h1Id}-${ceremonyIds[0]}`);
  await host.clickSelector(`#scope-${h1Id}-${ceremonyIds[1]}`);
  const savedScopes = await pressRow(host, H1, 'Save their events');
  const scopeCopy = await host.waitForText(`${H1} is now invited to 2 events`, 25_000);
  const scopeRows = psqlValue(`select count(*)::text from public.household_event_scopes
    where household_id = '${h1Id}'`);
  check('a', 'the host scoped the family to both ceremonies through the panel',
    savedScopes === 'pressed' && Boolean(scopeCopy) && scopeRows === '2',
    `${savedScopes}; copy ${Boolean(scopeCopy)}; db rows ${scopeRows}`);
  await pressRow(host, H1, 'Done');

  const h2Id = await addHousehold(host, { name: H2, salutation: '', expected: '2', notes: '' });
  await pressRow(host, H2, 'Their events');
  await host.waitForSelector(`#scope-${h2Id}-${ceremonyIds[0]}`);
  await host.clickSelector(`#scope-${h2Id}-${ceremonyIds[0]}`);
  await pressRow(host, H2, 'Save their events');
  await host.waitForText(`${H2} is now invited to 1 event`, 25_000);
  await pressRow(host, H2, 'Done');
  const h3Id = await addHousehold(host, { name: H3, salutation: '', expected: '', notes: '' });
  await pressRow(host, H3, 'Their events');
  await host.waitForSelector(`#scope-${h3Id}-${ceremonyIds[0]}`);
  await host.clickSelector(`#scope-${h3Id}-${ceremonyIds[0]}`);
  await host.clickSelector(`#scope-${h3Id}-${ceremonyIds[1]}`);
  await pressRow(host, H3, 'Save their events');
  await pressRow(host, H3, 'Done');
  const h4Id = await addHousehold(host, { name: H4, salutation: '', expected: '', notes: '' });
  measure('a', 'four families listed through the panel', [h1Id, h2Id, h3Id, h4Id].join(', ').slice(0, 60));

  // -- a family that was never sent anything can be taken off the list
  const removed = await pressRow(host, H4, 'Remove from list');
  const removedCopy = await host.waitForText(`${H4} is off the list`, 25_000);
  const h4Gone = psqlValue(`select count(*)::text from public.guest_households where id = '${h4Id}'`);
  check('a', 'a family with no link and no reply is removable, and is gone',
    removed === 'pressed' && Boolean(removedCopy) && h4Gone === '0',
    `${removed}; copy ${Boolean(removedCopy)}; rows ${h4Gone}`);

  // -- one address, shown once
  const link1 = await mintLink(host, H1);
  const copyPress = await pressLinkBlock(host, H1, 'Copy');
  const copyStatus = await linkBlockStatus(host, H1);
  measure('a', 'what the Copy press left on the status line', copyStatus ?? 'no status line');
  check('a', 'the Copy control answers with one of the panel\'s two honest sentences',
    copyPress === 'pressed'
      && ['Copied to the clipboard.',
        'Nothing has been sent to anyone. Copy it, or hand the link over yourself.'].includes(copyStatus),
    `${copyPress}; the block says: ${String(copyStatus)}`);

  await host.reload();
  await host.waitForSelector('#guest-invitations-heading');
  const afterMintReload = await pageCredentials(host);
  check('a', 'the household address is not on the page after a reload', afterMintReload.length === 0,
    afterMintReload.length === 0 ? 'gone, as the panel promises' : `${afterMintReload.length} still shown`);
  // The heading mounts before the rows do (the panel prints "Loading your guest list…" while
  // `rows === null`, `GuestInvitationPanel.tsx:629-633`), so the row the state line belongs to is
  // waited for by name. Reading it a tick early is the harness answering for the product.
  await host.waitForText(H1, 25_000);
  const liveWords = await rowStateText(host, H1);
  check('a', 'and the panel still reports the link as live', /Link is live/.test(liveWords), liveWords);

  // -- the guest's own page, on a phone, in a context with no account of its own
  const phone = { width: 390, height: 844, dpr: 3, mobile: true };
  const door = await openGuestDoor(browser, link1.url, { label: 's8-guest', viewport: phone });
  check('a', 'the address the panel showed once opens the household\'s page',
    door.kind === 'form', door.kind);
  const guest = door.page;
  const invitationText = await guest.evaluate(`(() => {
    const art = document.querySelector('article');
    return art ? art.innerText : '';
  })()`);
  check('a', 'the guest reads the family\'s published words, venue and ceremonies',
    invitationText.includes(LINES.opening) && invitationText.includes('Kalyana Mantapa')
      && invitationText.includes(MUHURTHAM) && invitationText.includes(RECEPTION),
    `opening ${invitationText.includes(LINES.opening)}, venue ${invitationText.includes('Kalyana Mantapa')}, `
    + `ceremonies ${invitationText.includes(MUHURTHAM)}/${invitationText.includes(RECEPTION)}`);
  const bodyAll = await guest.bodyText();
  check('a', 'the page greets them with the line the host wrote, not the couple\'s own name',
    bodyAll.includes(`The ${H1.split(' ')[0]} household`), bodyAll.replace(/\s+/g, ' ').slice(0, 160));
  const cardLegends = await guest.evaluate(`[...document.querySelectorAll('fieldset > legend')]
    .map((l) => l.textContent.trim())`);
  check('a', 'the guest is offered exactly their own two events and nobody else\'s',
    cardLegends.length === 2 && cardLegends.includes(MUHURTHAM) && cardLegends.includes(RECEPTION),
    cardLegends.join(' / '));
  check('a', 'the host\'s private note is nowhere on the guest\'s page',
    !bodyAll.includes(PRIVATE_NOTE), bodyAll.includes(PRIVATE_NOTE) ? 'the note reached the guest' : 'absent');
  const accountAffordance = await guest.evaluate(`(() => {
    const words = ['log in', 'sign up', 'dashboard', 'create invitation', 'password', 'sign in'];
    const text = document.body.innerText.toLowerCase();
    return words.filter((w) => text.includes(w));
  })()`);
  check('a', 'the guest page offers no account affordance at all', accountAffordance.length === 0,
    accountAffordance.join(', ') || 'none');
  check('a', 'and it says in the guest\'s own language that no account is needed',
    await guest.hasText('No account or app is needed to read this invitation'));
  const h1Count = await guest.evaluate(`document.querySelectorAll('h1').length`);
  check('a', 'the guest page has exactly one level-1 heading', h1Count === 1, String(h1Count));
  const titleText = await guest.evaluate('document.title');
  check('a', 'the tab title carries the wedding\'s name and no credential',
    titleText.includes(COUPLE) && (titleText.match(/[A-Za-z0-9_-]{43}/g) ?? []).length === 0, titleText);
  // -- the page's own bounds, before the server is asked anything
  const disabledFirst = await guest.buttonState('Send my reply');
  check('a', 'the send button refuses a form with nothing answered', disabledFirst === 'disabled',
    disabledFirst);
  await guest.pickRadio('guest-attending-0', 'attending');
  const sizeEmpty = await guest.buttonState('Send my reply');
  check('a', 'a bare "we are coming" is offered for sending and corrected by the page, not the door',
    sizeEmpty === 'enabled', sizeEmpty);
  // The headcount field and its hint exist only under "We are coming"
  // (`GuestDoor.tsx:216-249`), which is why this reads them after the choice rather than on arrival.
  check('a', 'the headcount hint states the number the host expects',
    await guest.hasText('The family expects 4.'),
    await guest.evaluate(`document.querySelector('#guest-party-size-0-hint')?.textContent.trim() ?? null`));
  const sendsBefore = await callCount(guest, 'submit_guest_rsvp');
  const badSizes = [
    ['', 'Tell the family how many of you are coming.'],
    ['1.5', 'Enter a whole number of guests, like 3.'],
    ['0', 'Choose \u201cNot coming\u201d if nobody from your household is attending.'],
    ['1001', 'That is more guests than one reply can hold. Ask the family to write you in directly.'],
  ];
  for (const [value, sentence] of badSizes) {
    await guest.setBySelector('#guest-party-size-0', value);
    await guest.pressButtonWhenReady('Send my reply');
    const seen = (await cardIds(guest, 0)).problem;
    check('a', `the page refuses a headcount of "${value}" in its own words`, seen === sentence,
      `got: ${seen}`);
  }
  const sendsAfterGate = await callCount(guest, 'submit_guest_rsvp');
  check('a', 'and none of those four refusals reached the server', sendsAfterGate === sendsBefore,
    `submit calls ${sendsBefore} → ${sendsAfterGate}`);

  // -- the host's cap, which is the door's rule and not the page's. Both cards answer "coming", and
  //    each card's headcount field only appears under its own choice.
  await guest.pickRadio('guest-attending-1', 'attending');
  await guest.setBySelector('#guest-party-size-0', '6');
  await guest.setBySelector('#guest-party-size-1', '2');
  const overBefore = await callCount(guest, 'submit_guest_rsvp');
  await guest.pressButtonWhenReady('Send my reply');
  const overCopy = await guest.waitForText(
    'That is more guests than this invitation is for. Ask the host if more can be added.', 25_000);
  const overAfter = await callCount(guest, 'submit_guest_rsvp');
  const rowsAfterOver = psqlValue(`select count(*)::text from public.rsvp_responses
    where household_id = '${h1Id}'`);
  check('a', 'a headcount above the host\'s expectation is refused actionably, by the door, and writes nothing',
    Boolean(overCopy) && overAfter === overBefore + 1 && rowsAfterOver === '0',
    `copy ${Boolean(overCopy)}; submit ${overBefore} → ${overAfter}; rows ${rowsAfterOver}`);

  // -- the answer that lands
  await guest.setBySelector('#guest-party-size-0', '3');
  const sentAt = await callCount(guest, 'submit_guest_rsvp');
  const send = await guest.pressButtonWhenReady('Send my reply');
  const receipt = await guest.waitForText('Your reply is recorded', 30_000);
  const twoEvents = await guest.hasText('Your answer is saved for 2 events.');
  check('a', 'the corrected answer was recorded, for both of the family\'s events, in one call',
    send === 'pressed' && Boolean(receipt) && twoEvents
      && (await callCount(guest, 'submit_guest_rsvp')) === sentAt + 1,
    `${send}; receipt ${Boolean(receipt)}; two-events ${twoEvents}`);
  const dbAnswer = psqlValue(`select string_agg(attending || '/' || party_size::text || '/'
    || response_source, ' ' order by event_id) from public.rsvp_responses
    where household_id = '${h1Id}'`);
  check('a', 'the database holds two rows, marked as the family\'s own',
    String(dbAnswer).split(' ').length === 2 && /attending\/3\/guest/.test(dbAnswer ?? '')
      && /attending\/2\/guest/.test(dbAnswer ?? ''), String(dbAnswer));
  const usedOnce = psqlValue(`select (last_used_at is not null)::text from private.access_tokens
    where household_id = '${h1Id}' and revoked_at is null`);
  check('a', 'the credential is marked as used, which is how the host knows the link landed',
    usedOnce === 'true', String(usedOnce));
  check('a', 'the guest is told they can correct it, and the form is still there to correct it with',
    await guest.hasText('You can change your reply below') && Boolean(await cardIds(guest, 0)));

  // -- a revision overwrites rather than stacks
  await guest.pickRadio('guest-attending-0', 'declined');
  await guest.pressButtonWhenReady('Send my reply');
  const receipt2 = await guest.waitForText('Your reply is recorded', 30_000);
  const revised = psqlValue(`select count(*)::text || '/' || string_agg(attending || '='
    || party_size::text, ' ' order by event_id) from public.rsvp_responses
    where household_id = '${h1Id}'`);
  check('a', 'a second submission replaces the household\'s answer instead of appending a history',
    Boolean(receipt2) && String(revised).startsWith('2/') && /declined=0/.test(revised), String(revised));

  const snapshotAfter = psqlValue(`select md5(snapshot::text) from public.invitation_versions
    where wedding_id = '${weddingId}' and version_number = 1`);
  check('a', 'the guest\'s answers left the published snapshot byte-identical',
    snapshotBefore !== null && snapshotBefore === snapshotAfter,
    `before ${String(snapshotBefore).slice(0, 12)}…, after ${String(snapshotAfter).slice(0, 12)}…`);

  // -- the host reads it back
  await host.goto(`${PREVIEW_ORIGIN}/project/${weddingId}/edit`);
  await host.waitForSelector('#guest-replies-heading');
  await host.waitForText(H1, 25_000);
  const replyLines = await host.evaluate(`(() => {
    const sec = document.querySelector('section[aria-labelledby="guest-replies-heading"]');
    return [...(sec?.querySelectorAll('ul > li') ?? [])]
      .map((li) => li.innerText.trim().replace(/\\s+/g, ' '));
  })()`);
  const dbReplies = psqlValue(`select count(*)::text from public.rsvp_responses
    where wedding_id = '${weddingId}'`);
  check('a', 'the host\'s Replies list shows one line per answer the database holds',
    replyLines.length === Number(dbReplies) && replyLines.length === 2,
    `panel ${replyLines.length}, database ${dbReplies}`);
  check('a', 'each line names the family, the event, the headcount and who wrote it',
    replyLines.every((l) => l.includes(H1) && (l.includes(MUHURTHAM) || l.includes(RECEPTION))
      && l.includes('they sent it themselves'))
      && replyLines.some((l) => l.includes('not coming')) && replyLines.some((l) => l.includes('2 guests')),
    replyLines.join(' || ').slice(0, 300));
  check('a', 'and the family\'s own row is not offered as something the host typed',
    !(await host.hasText('you recorded it')), 'no host-authored wording on the guest rows');

  // -- the host writes in a phone answer for a different family
  await host.setBySelector('#reply-household', h2Id);
  await host.waitForSelector('#reply-event');
  await host.setBySelector('#reply-event', ceremonyIds[0]);
  await pickAnswerById(host, 'reply-attending');
  await host.setBySelector('#reply-size', '6');
  const rec = await pressOffered(host, 'Record their answer');
  const recCopy = await host.waitForText(`Recorded for ${H2}`, 25_000);
  const manualRow = psqlValue(`select attending || '/' || party_size::text || '/' || response_source
    from public.rsvp_responses where household_id = '${h2Id}'`);
  check('a', 'a phone answer is recorded for the family it belongs to, as the host\'s own entry',
    rec === 'pressed' && Boolean(recCopy) && manualRow === 'attending/6/host_manual',
    `${rec}; copy ${Boolean(recCopy)}; row ${manualRow}`);
  measure('a', 'the same number the door refused from the guest is accepted from the host',
    `guest 6 > expected 4 refused; host wrote 6 for a family expecting 2 → ${manualRow}`);
  const replyLines2 = await host.evaluate(`(() => {
    const sec = document.querySelector('section[aria-labelledby="guest-replies-heading"]');
    return [...(sec?.querySelectorAll('ul > li') ?? [])]
      .map((li) => li.innerText.trim().replace(/\\s+/g, ' '));
  })()`);
  check('a', 'the new line appears in the same list, worded as the host\'s entry',
    replyLines2.some((l) => l.includes(H2) && l.includes('you recorded it')),
    replyLines2.join(' || ').slice(0, 300));
  const deletePressed = await (async () => {
    await host.evaluate(`(() => {
      document.querySelectorAll('[data-s8reply]').forEach((el) => { delete el.dataset.s8reply; });
      const sec = document.querySelector('section[aria-labelledby="guest-replies-heading"]');
      const li = [...(sec?.querySelectorAll('ul > li') ?? [])]
        .find((l) => l.innerText.includes(${JSON.stringify(H2)}));
      if (li) li.dataset.s8reply = '1';
      return li ? 1 : 0;
    })()`);
    return host.pressButton('Delete', 'li[data-s8reply="1"]');
  })();
  const deleteCopy = await host.waitForText(`Deleted your own entry for ${H2}`, 25_000);
  const manualGone = psqlValue(`select count(*)::text from public.rsvp_responses
    where household_id = '${h2Id}'`);
  check('a', 'the host can delete their own entry, and the row is gone',
    deletePressed === 'pressed' && Boolean(deleteCopy) && manualGone === '0',
    `${deletePressed}; copy ${Boolean(deleteCopy)}; rows ${manualGone}`);

  // -- a family that has answered cannot be erased from the list
  const h1DeleteState = await rowButtonState(host, H1, 'Remove from list');
  const pinnedCopy = await host.hasText(`${H1} has 2 replies recorded, so their row stays`);
  check('a', 'a family with replies is not offered for deletion, and the panel says why',
    h1DeleteState === 'absent' && pinnedCopy, `button: ${h1DeleteState}; reason copy: ${pinnedCopy}`);

  state.h1Id = h1Id; state.h2Id = h2Id; state.h3Id = h3Id;
  state.link1 = link1; state.ceremonyIds = ceremonyIds; state.phone = phone;
  await guest.close();
  return { h1Id, h2Id, h3Id, link1 };
}

/** The panel's own state words for one family's row: the span beside its name. */
async function rowStateText(page, name) {
  if ((await markRow(page, name)) !== 1) return 'no-row';
  return page.evaluate(`(() => {
    const li = document.querySelector(${JSON.stringify(ROW_SCOPE)});
    const span = li?.querySelector('div > span');
    return span ? span.textContent.trim() : null;
  })()`);
}

/** The host's transcription radios carry their choice in the id (`reply-attending`,
 *  `GuestRepliesPanel.tsx:316-329`) and set no `value` attribute, unlike the guest door's
 *  (`GuestDoor.tsx:201-205`, which does). The driver's group+value lookup therefore has nothing to
 *  find on the host side — an 'absent' that describes the markup, not a product refusal. The id is
 *  what the page exposes, so the harness clicks it through the real hit-tested mouse path and then
 *  insists the panel's own controlled state settled on the choice. */
async function pickAnswerById(page, id, timeoutMs = 25_000) {
  await page.clickSelector(`#${id}`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const checked = await page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(`#${id}`)});
      return el ? el.checked : null;
    })()`);
    if (checked === true) return 'chosen';
    if (Date.now() > deadline) {
      throw new Error(`[${page.name}] clicking #${id} left it ${String(checked)}`);
    }
    await sleep(200);
  }
}

// --------------------------------------------------------------------- journey B

async function journeyB(browser, state) {
  console.log('\n==> Stage 8 B — rotation, withdrawal, expiry, forged and malformed credentials, a stranger');
  const host = state.host;
  const phone = state.phone;

  // rotate
  const rotated = await rotateLink(host, H1);
  // Published to the shared state as soon as it exists: journey C reads the wire on this address, and
  // a later failure inside B must not turn into a "C could not be completed" that describes B.
  state.rotated = rotated;
  const oldDoor = await openGuestDoor(browser, state.link1.url, { label: 's8-rotated-old', viewport: phone });
  check('b', 'the address the family was given stops working the moment it is replaced',
    oldDoor.kind === 'refusal', oldDoor.kind);
  await oldDoor.page.close();
  const newDoor = await openGuestDoor(browser, rotated.url, { label: 's8-rotated-new', viewport: phone });
  check('b', 'and the successor opens the same household\'s page', newDoor.kind === 'form', newDoor.kind);
  const rotatedRows = psqlValue(`select count(*)::text from private.access_tokens
    where household_id = '${state.h1Id}' and revoked_at is not null`);
  const stillAnswers = psqlValue(`select count(*)::text from public.rsvp_responses
    where household_id = '${state.h1Id}'`);
  check('b', 'the retired credential is revoked in the store while the family\'s answers stay',
    Number(rotatedRows) >= 1 && stillAnswers === '2', `revoked ${rotatedRows}, answers ${stillAnswers}`);
  await newDoor.page.close();

  // withdraw
  const link3 = await mintLink(host, H3);
  const withdrawn = await pressRow(host, H3, 'Withdraw link');
  const withdrawCopy = await host.waitForText('Their link is withdrawn', 25_000);
  const words3 = await rowStateText(host, H3);
  check('b', 'the host withdrew a live household link through the panel',
    withdrawn === 'pressed' && Boolean(withdrawCopy) && /Link withdrawn/.test(words3 ?? ''),
    `${withdrawn}; copy ${Boolean(withdrawCopy)}; row says ${words3}`);
  const goneDoor = await openGuestDoor(browser, link3.url, { label: 's8-withdrawn', viewport: phone });
  check('b', 'a withdrawn address answers with the one sentence', goneDoor.kind === 'refusal', goneDoor.kind);
  const stillThere = psqlValue(`select (select count(*) from public.guest_households
    where id = '${state.h3Id}')::text || '/hh, ' || (select count(*) from public.household_event_scopes
    where household_id = '${state.h3Id}')::text || '/scopes'`);
  check('b', 'withdrawing took the address away and nothing else', /\/hh, 2\/scopes/.test(stillThere),
    String(stillThere));
  await goneDoor.page.close();

  // expired — a harness time machine over one row this run minted, never a product path
  const link2 = await mintLink(host, H2);
  const aged = psqlRows(`update private.access_tokens
      set created_at = now() - interval '3 hours',
          expiry_policy = 'fixed',
          expires_at = now() - interval '1 hour'
    where household_id = '${state.h2Id}' and revoked_at is null
    returning expires_at::text`);
  const expiredDoor = await openGuestDoor(browser, link2.url, { label: 's8-expired', viewport: phone });
  check('b', 'an expired credential answers with the same one sentence as a withdrawn one',
    expiredDoor.kind === 'refusal', `${expiredDoor.kind}; expiry set to ${aged[0] ?? '?'}`);
  // The row's word comes from `get_guest_invitation_state`, which the panel fetched before the row was
  // moved into the past (`20261009120000_stage8_guest_invitations_rsvp.sql:512`), so the panel is
  // asked for its answer again rather than read out of a DOM that predates the change.
  await host.reload();
  await host.waitForSelector('#guest-invitations-heading');
  await host.waitForText(H2, 25_000);
  const expiredWords = await rowStateText(host, H2);
  check('b', 'and the host\'s panel calls that state "Link has run out", not "withdrawn"',
    /Link has run out/.test(expiredWords ?? ''), String(expiredWords));
  measure('b', 'how the past expiry was produced',
    'the UI mints links with no deadline, so the run moved this household\'s own token row '
    + '(created_at, expiry_policy, expires_at) with one UPDATE as the database superuser; no product '
    + 'path sets an expiry, and the row is deleted by teardown');
  await expiredDoor.page.close();

  // forged and malformed
  const forgedToken = randomBytes(32).toString('base64url').slice(0, 43);
  DISCOVERED.add(forgedToken);
  const forged = await openGuestDoor(browser, `${PREVIEW_ORIGIN}/g/${forgedToken}`,
    { label: 's8-forged', viewport: phone });
  check('b', 'a well-formed credential that was never issued reads the same as a withdrawn one',
    forged.kind === 'refusal', forged.kind);
  const forgedRows = await responsesFor(forged.page, 'resolve_guest_invitation');
  measure('b', 'the server\'s answer to a forged credential',
    forgedRows.length ? `HTTP ${forgedRows[0].status} ${String(forgedRows[0].body).slice(0, 90)}`
      : 'no resolve call was made');
  const writtenByForge = psqlValue(`select count(*)::text from public.rsvp_responses
    where wedding_id in ${owners}`);
  measure('b', `rows this run's legitimate answers account for (${writtenByForge}) — the forged attempt wrote nothing on its own`,
    writtenByForge);
  await forged.page.close();

  const malformed = await browser.newPage('s8-malformed');
  await malformed.goto(`${PREVIEW_ORIGIN}/g/too-short`);
  const malformedRefusal = await malformed.waitForText(GUEST_DOOR_UNAVAILABLE, 15_000);
  const malformedCalls = await callCount(malformed, 'resolve_guest_invitation');
  check('b', 'a malformed credential is refused locally, without a round trip',
    Boolean(malformedRefusal) && malformedCalls === 0,
    `refusal on page: ${Boolean(malformedRefusal)}, resolve calls: ${malformedCalls}`);
  await malformed.close();

  const refusalTexts = [];
  for (const [label, url] of [['withdrawn', link3.url], ['expired', link2.url],
    ['forged', `${PREVIEW_ORIGIN}/g/${forgedToken}`]]) {
    const p = await browser.newPage(`s8-${label}-text`);
    await p.setViewportSizeOnly(phone);
    await p.goto(url);
    await p.waitForText(GUEST_DOOR_UNAVAILABLE, 25_000);
    refusalTexts.push((await p.bodyText()).replace(/\s+/g, ' ').trim());
    await p.close();
  }
  check('b', 'withdrawn, expired and forged all render one identical page, so probing learns nothing',
    refusalTexts.length === 3 && new Set(refusalTexts).size === 1,
    `${new Set(refusalTexts.map((t) => t.length)).size} distinct length(s) across three refusals`);

  // replay: the same live address, twice, and both work
  const first = await openGuestDoor(browser, rotated.url, { label: 's8-replay-a', viewport: phone });
  const second = await openGuestDoor(browser, rotated.url, { label: 's8-replay-b', viewport: phone });
  check('b', 'a household link is not exactly-once: a second visit is let in the same way',
    first.kind === 'form' && second.kind === 'form', `${first.kind} / ${second.kind}`);
  await first.page.close();
  await second.page.close();

  // a stranger with a session of their own
  const stranger = await signUpAndEnterHost(browser, 's8-stranger');
  const strangerWedding = await createWedding(stranger, { title: OTHER_COUPLE, lang: 'en' });
  state.strangerWeddingId = strangerWedding;
  // Their wedding needs the same minimal shape journey A's draft has — prose, a person, a venue and a
  // ceremony — because scoping a family to a real event is what enables the send button this check is
  // about. Building it through the same forms also keeps Ruling 3.3's refusal about publication alone:
  // nothing else is missing from their draft.
  await typeAvailableProse(stranger, LINES);
  await addPerson(stranger, { name: 'Lakshmi S', role: 'Mother', group: 'The brides family' });
  await addVenue(stranger, { name: 'Community Hall', address: '5 North Street\nChennai 600001' });
  await addCeremony(stranger, { name: 'Signing', starts: '2026-12-01T11:00',
    timezone: 'Asia/Kolkata', venueName: 'Community Hall' });
  await saveDraft(stranger);
  await stranger.waitForSelector('#guest-invitations-heading');
  await stranger.setBySelector('#guest-new-displayName', 'Stranger household');
  await stranger.setBySelector('#guest-new-salutation', '');
  await stranger.setBySelector('#guest-new-expectedPartySize', '');
  await stranger.setBySelector('#guest-new-hostNotes', '');
  await pressOffered(stranger, 'Add them to the list');
  await stranger.waitForText('Stranger household is on the list', 25_000);
  const strangerCeremony = psqlValue(`select id::text from public.wedding_events
    where wedding_id = '${strangerWedding}' limit 1`);
  const strangerHousehold = psqlValue(`select id::text from public.guest_households
    where wedding_id = '${strangerWedding}' limit 1`);
  check('b', 'the stranger can run the same panel on their own wedding',
    strangerCeremony !== null && strangerHousehold !== null,
    `ceremony ${String(strangerCeremony).slice(0, 8)}, household ${String(strangerHousehold).slice(0, 8)}`);
  await pressRow(stranger, 'Stranger household', 'Their events');
  await stranger.waitForSelector(`#scope-${strangerHousehold}-${strangerCeremony}`);
  await stranger.clickSelector(`#scope-${strangerHousehold}-${strangerCeremony}`);
  await pressRow(stranger, 'Stranger household', 'Save their events');
  await pressRow(stranger, 'Stranger household', 'Done');
  const gateBefore = await callCount(stranger, 'issue_guest_invitations');
  const gatePress = await pressRow(stranger, 'Stranger household', 'Create their link');
  const gateCopy = await stranger.waitForText('the invitations could not be sent', 25_000);
  const gateAfter = await callCount(stranger, 'issue_guest_invitations');
  const gateBody = (await responsesFor(stranger, 'issue_guest_invitations')).slice(-1)[0];
  const tokensForStranger = psqlValue(`select count(*)::text from private.access_tokens
    where household_id = '${strangerHousehold}'`);
  check('b', 'Ruling 3.3 is a live door, not a comment: sending before publishing is refused and mints nothing',
    gatePress === 'pressed' && Boolean(gateCopy) && gateAfter === gateBefore + 1 && tokensForStranger === '0',
    `${gatePress}; panel copy ${Boolean(gateCopy)}; calls ${gateBefore} → ${gateAfter}; tokens ${tokensForStranger}; `
    + `server said HTTP ${gateBody?.status ?? '?'} ${String(gateBody?.body).slice(0, 120)}`);
  measure('b', 'what the host sees versus what the server said',
    `the panel prints its own phrase ("the invitations could not be sent"); the door's sentence is in `
    + `the response body: ${String(gateBody?.body).replace(/["{}]/g, '').slice(0, 110)}`);

  await freezeAndPublish(stranger, 'their own version');
  const publishedNow = await mintLink(stranger, 'Stranger household');
  check('b', 'once they publish, the same click works — the gate was publication, not the family',
    publishedNow.token !== null, publishedNow.token.slice(0, 6));

  await stranger.goto(`${PREVIEW_ORIGIN}/project/${state.weddingId}/edit`);
  await sleep(3_000);
  const strangerSaw = await stranger.bodyText();
  const leakedTo = [H1, H2, H3, PRIVATE_NOTE].filter((needle) => strangerSaw.includes(needle));
  check('b', 'a signed-in stranger on the host\'s project URL sees no family, no answer and no note',
    leakedTo.length === 0, `leaked to the stranger: ${leakedTo.join(', ') || 'nothing'}; page: `
      + `${strangerSaw.replace(/\s+/g, ' ').slice(0, 180)}`);
  const strangerGuestFetch = await stranger.evaluate(`(async () => {
    const key = ${JSON.stringify(anonKey)};
    const url = ${JSON.stringify(apiUrl)} + '/rest/v1/guest_households?select=display_name';
    const r = await fetch(url, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
    return r.status + ' ' + (await r.text()).slice(0, 120);
  })()`);
  measure('b', 'the stranger\'s own session asking the table directly', strangerGuestFetch);
  await stranger.close();

  return { rotated };
}

// --------------------------------------------------------------------- journey C

async function journeyC(browser, state) {
  console.log('\n==> Stage 8 C — the guest page on the wire, and the host page after it');
  const host = state.host;
  const phone = state.phone;
  const door = await openGuestDoor(browser, state.rotated.url, { label: 's8-wire', viewport: phone });
  check('c', 'the household page opened for the wire pass', door.kind === 'form', door.kind);
  const guest = door.page;

  await guest.pickRadio('guest-attending-0', 'attending');
  await guest.setBySelector('#guest-party-size-0', '2');
  const send = await guest.pressButtonWhenReady('Send my reply');
  const receipt = await guest.waitForText('Your reply is recorded', 30_000);
  check('c', 'the pass made its own answer so the write door is on the wire',
    send === 'pressed' && Boolean(receipt), `${send}; receipt ${Boolean(receipt)}`);

  const census = await guestRequestCensus(guest);
  measure('c', 'every RPC the household page made, with its credential header',
    census.rows.map((r) => `${r.fn} HTTP ${r.status} x-guest-token=${r.guestHeader !== null
      ? 'yes' : 'no'} auth=${r.authKind}`).join(' · '));
  // The two doors the household page is allowed to knock on. The read verb is
  // `internal_api.resolve_guest_invitation`; the write verb is `internal_api.submit_guest_rsvp` — two
  // different suffixes, so the name is matched whole rather than by a shared stem.
  const DOOR_VERBS = /^(resolve_guest_invitation|submit_guest_rsvp)$/;
  const doorCalls = census.rows.filter((r) => DOOR_VERBS.test(r.fn));
  check('c', 'both guest verbs carried the credential in x-guest-token',
    doorCalls.length === 2 && doorCalls.every((r) => r.guestHeader !== null),
    doorCalls.map((r) => `${r.fn}:${r.guestHeader === null ? 'missing' : 'present'}`).join(', ')
      || `no request matched either door verb (${census.rows.map((r) => r.fn).join(', ') || 'no RPC'})`);
  check('c', 'the household page sent no signed-in bearer token — nothing here is a session',
    census.rows.every((r) => r.authKind !== 'jwt'),
    census.rows.map((r) => `${r.fn}=${r.authKind}`).join(', '));
  check('c', 'the page read no table directly: its only REST surface is the two door verbs and nothing else',
    census.tableReads.length === 0 && census.rows.every((r) => true),
    census.tableReads.map((r) => r.url.split('?')[0]).join(', ') || 'no table requests');
  const nonDoorRpc = census.rows.filter((r) => !DOOR_VERBS.test(r.fn));
  check('c', 'no verb other than the two doors was asked for on a household page',
    nonDoorRpc.length === 0, nonDoorRpc.map((r) => r.fn).join(', ') || 'only the two doors');

  const scan = await credentialTravel(guest);
  wireReport('c', scan);
  const withGuestHeader = census.rows.filter((r) => r.guestHeader !== null);
  measure('c', 'requests carrying an x-guest-token header',
    `${withGuestHeader.length} of ${census.rows.length} RPC(s)`);
  // Which credential rides the header: the page is addressed by one, so a header carrying any other
  // credential this run holds would mean the page can act for a family it was not shown to.
  const addressedBy = /\/g\/([A-Za-z0-9_-]{43})/.exec(state.rotated.url)?.[1] ?? null;
  check('c', 'the header carries the credential the address itself named, and no other this run minted',
    addressedBy !== null && withGuestHeader.length === 2
      && withGuestHeader.every((r) => r.guestHeader === addressedBy),
    withGuestHeader.map((r) => `${r.fn}=${r.guestHeader === addressedBy
      ? 'the address\u2019s own credential' : `another of ${[...DISCOVERED].length} registered`}`).join(', ')
      || 'no request carried the header');

  // the host page, after the run's whole link work, must hold no credential anywhere in it
  await host.goto(`${PREVIEW_ORIGIN}/project/${state.weddingId}/edit`);
  await host.waitForSelector('#guest-invitations-heading');
  const hostScan = await credentialTravel(host);
  check('c', 'the host page carries no household credential in its text, title, storage or cookies',
    Object.values(hostScan.nonUrl).every((v) => v.length === 0),
    Object.entries(hostScan.nonUrl).filter(([, v]) => v.length > 0)
      .map(([k, v]) => `${k}: ${v.length}`).join('; ') || 'none');
  check('c', 'and none on its wire outside the declared places',
    hostScan.travel.every((t) => MAY_TRAVEL_TO.some((d) => d.test(t))),
    hostScan.travel.map((t) => `${t.name}@${t.host}`).join(', ') || 'nothing');

  // the digest, not the secret
  const digestCheck = [...DISCOVERED].filter((t) => /^[A-Za-z0-9_-]{43}$/.test(t));
  const stored = psqlValue(`select count(*)::text from private.access_tokens t
    where t.wedding_id in ${owners}
      and t.token_hash in (${digestCheck.map((t) => sql(createHash('sha256').update(t).digest('hex'))).join(',')})`);
  const plaintextStored = psqlValue(`select count(*)::text from private.access_tokens t
    where t.wedding_id in ${owners} and t.token_hash in (${digestCheck.map(sql).join(',')})`);
  check('c', 'the store holds the sha-256 digest of every credential this run read, and never the credential',
    Number(stored) >= 1 && plaintextStored === '0',
    `${stored} of ${digestCheck.length} credential(s) matched a stored digest; `
    + `${plaintextStored} stored verbatim`);
  const hashShape = psqlValue(`select count(*)::text from private.access_tokens
    where wedding_id in ${owners} and token_hash !~ '^[0-9a-f]{64}$'`);
  check('c', 'every stored hash for this run is 64 lowercase hex characters', hashShape === '0',
    `${hashShape} row(s) of another shape`);

  await guest.close();
  return {};
}

// --------------------------------------------------------------------- journey D

async function journeyD(browser, state) {
  console.log('\n==> Stage 8 D — accessibility and mobile on the household page and the host panels');
  const host = state.host;
  const viewports = [
    { width: 390, height: 844, dpr: 3, mobile: true },
    { width: 320, height: 568, dpr: 2, mobile: true },
  ];

  for (const viewport of viewports) {
    const tag = `d${viewport.width}`;
    const door = await openGuestDoor(browser, state.rotated.url,
      { label: `s8-a11y-${viewport.width}`, viewport });
    const page = door.page;
    check(tag, `the household page opens at ${viewport.width}px`, door.kind === 'form', door.kind);
    const structure = await page.evaluate(`(() => {
      const de = document.documentElement;
      const heads = [...document.querySelectorAll('h1,h2,h3')].map((h) => ({
        level: Number(h.tagName.slice(1)),
        text: h.textContent.trim().replace(/\\s+/g, ' ').slice(0, 46) }));
      const controls = [...document.querySelectorAll(
        'input,select,textarea,button,a[href],label')].map((el) => {
        const r = el.getBoundingClientRect();
        const wrap = el.closest('label');
        const aim = wrap ? wrap.getBoundingClientRect() : r;
        const isChoice = el.tagName === 'INPUT' && ['radio', 'checkbox'].includes(el.type);
        const name = isChoice
          ? (el.labels && el.labels.length ? el.labels[0].textContent.trim() : el.getAttribute('aria-label'))
          : (el.getAttribute('aria-label')
            || (el.labels && el.labels.length ? el.labels[0].textContent.trim() : null)
            || (el.id && document.querySelector('label[for="' + el.id + '"]')
              ? document.querySelector('label[for="' + el.id + '"]').textContent.trim() : null)
            || el.textContent.trim());
        return { tag: el.tagName.toLowerCase(), id: el.id || null, type: el.getAttribute('type'),
          name: (name || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
          aimW: Math.round(aim.width), aimH: Math.round(aim.height),
          disabled: Boolean(el.disabled) };
      });
      return { overflow: de.scrollWidth - de.clientWidth, viewport: window.innerWidth,
        mainLandmarks: document.querySelectorAll('main').length, headings: heads, controls };
    })()`);
    check(tag, `the page does not overflow its ${viewport.width}px viewport horizontally`,
      structure.overflow <= 0, `${structure.overflow}px at ${structure.viewport}px wide`);
    check(tag, 'exactly one level-1 heading and one main landmark',
      structure.headings.filter((h) => h.level === 1).length === 1 && structure.mainLandmarks === 1,
      structure.headings.map((h) => `h${h.level}:${h.text}`).join(' · ').slice(0, 280));
    const unlabeled = structure.controls.filter((c) => !['button', 'a', 'label'].includes(c.tag)
      && (c.name === '' || c.name === null));
    check(tag, 'every form control has an accessible name', unlabeled.length === 0,
      unlabeled.map((c) => `${c.tag}#${c.id}`).join(', ') || 'none');
    const small = structure.controls.filter((c) => !c.disabled && !['radio', 'checkbox'].includes(c.type ?? '')
      && ['input', 'select', 'button', 'textarea'].includes(c.tag)
      && (c.aimW < 44 || c.aimH < 44));
    check(tag, 'no enabled control is smaller than 44x44 CSS px', small.length === 0,
      small.map((c) => `${c.tag}#${c.id ?? '-'} aim ${c.aimW}x${c.aimH} "${c.name}"`).join(', ')
        || `${structure.controls.length} control(s) tested`);
    const choiceAims = structure.controls.filter((c) => ['radio', 'checkbox'].includes(c.type ?? ''));
    measure(tag, 'answer options aimed through their label',
      choiceAims.map((c) => `${c.type} "${c.name}" aimed ${c.aimW}x${c.aimH}`).join(' · '));

    await page.pressTab();
    const path = [];
    for (let i = 0; i < 14; i += 1) {
      path.push(await page.focusInfo());
      await page.pressTab();
    }
    const noIndicator = path.filter((f) => f.tag !== 'BODY'
      && (f.outlineWidth === '0px' || f.outlineStyle === 'none')
      && (!f.boxShadow || f.boxShadow === 'none'));
    check(tag, 'every keyboard stop shows a visible indicator', noIndicator.length === 0,
      noIndicator.map((f) => `${f.tag}#${f.id ?? '-'} outline ${f.outlineStyle} ${f.outlineWidth}`)
        .join(', ') || `${path.length} stops, all with an outline or ring`);
    const stops = path.map((f) => `${f.tag}${f.id ? `#${f.id}` : ''}`);
    check(tag, 'the keyboard path reaches the answer controls',
      stops.some((s) => s.includes('guest-party-size'))
        || choiceAims.length > 0,
      `stops: ${stops.join(' → ').slice(0, 300)}`);
    const radiosSeen = path.filter((f) => f.type === 'radio').length;
    check(tag, 'the two answer options are keyboard reachable', radiosSeen >= 1,
      `${radiosSeen} radio stop(s) in the first ${path.length} presses`);

    const shot = join(EVIDENCE_DIR, `s8-guest-${viewport.width}x${viewport.height}.png`);
    measure(tag, 'screenshot of the household page', `${shot} (${await page.screenshot(shot)})`);
    await page.close();
  }

  // the receipt takes focus when an answer lands — the screen-reader claim in GuestDoor.tsx:262
  const door = await openGuestDoor(browser, state.rotated.url,
    { label: 's8-receipt-focus', viewport: viewports[0] });
  await door.page.pickRadio('guest-attending-0', 'attending');
  await door.page.setBySelector('#guest-party-size-0', '1');
  await door.page.pressButtonWhenReady('Send my reply');
  await door.page.waitForText('Your reply is recorded', 30_000);
  const focus = await door.page.focusInfo();
  // The driver reports the focused element's own words as `label` (`el.textContent` or its first
  // label/aria-label, `scripts/stage5-browser-driver.mjs:637-639`), so that is the field that says
  // which confirmation holds the caret.
  check('d', 'after a recorded answer the confirmation, not the button, holds focus',
    focus.tag === 'DIV' && (focus.label ?? '').includes('Your reply is recorded'),
    `active element ${focus.tag}${focus.id ? `#${focus.id}` : ''} "${String(focus.label ?? '').slice(0, 40)}"`);
  await door.page.close();

  // the host's two panels at a phone viewport
  const phone = viewports[0];
  await host.setViewportSizeOnly(phone);
  await host.goto(`${PREVIEW_ORIGIN}/project/${state.weddingId}/edit`);
  await host.waitForSelector('#guest-invitations-heading');
  for (const [heading, label] of [['guest-invitations-heading', 'Guest invitations'],
    ['guest-replies-heading', 'Replies']]) {
    await host.evaluate(`document.querySelector('#${heading}').scrollIntoView({ block: 'start' })`);
    const panel = await host.evaluate(`(() => {
      const sec = document.querySelector('section[aria-labelledby="${heading}"]');
      if (!sec) return null;
      const de = document.documentElement;
      const controls = [...sec.querySelectorAll('input,select,textarea,button')].map((el) => {
        const r = el.getBoundingClientRect();
        const wrap = el.closest('label');
        const aim = wrap ? wrap.getBoundingClientRect() : r;
        const lab = el.labels && el.labels.length ? el.labels[0].textContent.trim()
          : el.getAttribute('aria-label') || el.textContent.trim();
        return { tag: el.tagName.toLowerCase(), id: el.id || null,
          name: lab.replace(/\\s+/g, ' ').slice(0, 40),
          w: Math.round(aim.width), h: Math.round(aim.height), disabled: Boolean(el.disabled) };
      });
      return { overflow: de.scrollWidth - de.clientWidth,
        labelled: sec.getAttribute('aria-labelledby'),
        heading: (sec.querySelector('#${heading}')?.textContent ?? '').trim(), controls };
    })()`);
    check('d', `the ${label} panel is labelled by its own heading`, panel !== null
      && panel.labelled === heading && panel.heading === label,
      panel ? `labelledBy ${panel.labelled}, heading "${panel.heading}"` : 'no panel');
    const panelSmall = (panel?.controls ?? []).filter((c) => !c.disabled && (c.w < 44 || c.h < 44));
    check('d', `no enabled control in the ${label} panel is smaller than 44x44 CSS px`,
      panelSmall.length === 0,
      panelSmall.map((c) => `${c.tag}#${c.id ?? '-'} ${c.w}x${c.h} "${c.name}"`).join(', ')
        || `${(panel?.controls ?? []).length} control(s) tested`);
    const panelUnnamed = (panel?.controls ?? []).filter((c) => c.tag !== 'button' && c.name === '');
    check('d', `every input in the ${label} panel has an accessible name`, panelUnnamed.length === 0,
      panelUnnamed.map((c) => `${c.tag}#${c.id}`).join(', ') || 'none');
    measure('d', `${label} panel horizontal overflow at ${phone.width}px`, `${panel?.overflow}px`);
  }
  const shotHost = join(EVIDENCE_DIR, `s8-host-panels-${phone.width}x${phone.height}.png`);
  measure('d', 'screenshot of the host panels at the phone viewport',
    `${shotHost} (${await host.screenshot(shotHost)})`);
  await host.setViewportSizeOnly({ width: 1280, height: 900, dpr: 1, mobile: false });
  return {};
}

// --------------------------------------------------------------------- teardown

async function teardown() {
  // Child before parent, in the order the foreign keys demand: an answer and a credential pin the
  // household, a scope pins the event, and the credential pins the publication.
  psqlRows(`
    begin;
    delete from public.rsvp_responses where wedding_id in ${owners};
    delete from public.household_event_scopes where wedding_id in ${owners};
    delete from private.access_tokens where wedding_id in ${owners};
    delete from public.guest_households where wedding_id in ${owners};
    delete from public.approval_feedback where wedding_id in ${owners};
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
    || ' weddings, ' || (select count(*) from public.guest_households where wedding_id in ${owners})::text
    || ' households, ' || (select count(*) from public.household_event_scopes where wedding_id in ${owners})::text
    || ' scopes, ' || (select count(*) from public.rsvp_responses where wedding_id in ${owners})::text
    || ' answers, ' || (select count(*) from private.access_tokens where wedding_id in ${owners})::text
    || ' credentials, ' || (select count(*) from public.publications where wedding_id in ${owners})::text
    || ' publications, ' || (select count(*) from auth.users
      where email like '%+${RUN_TAG}@example.test')::text || ' accounts'`);
  const counts = String(left).split(', ');
  const zero = (word) => counts.some((c) => c.startsWith('0 ' + word));
  check('cleanup', 'every account this run created is gone', zero('accounts'), left);
  check('cleanup', 'every household and scope this run created is gone',
    zero('households') && zero('scopes'), left);
  check('cleanup', 'every answer this run recorded is gone', zero('answers'), left);
  check('cleanup', 'every credential this run minted is gone', zero('credentials'), left);
  check('cleanup', 'every wedding and publication this run made is gone',
    zero('weddings') && zero('publications'), left);
  measure('cleanup', 'residue report', left);
  rmSync(SCRATCH, { recursive: true, force: true });
}

// --------------------------------------------------------------------- main

async function main() {
  console.log(`Stage 8 browser tier · run tag ${RUN_TAG} · preview ${PREVIEW_ORIGIN} · api ${apiUrl}`);
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
    GUEST_DOOR_UNAVAILABLE,
    'Will you be there?',
    'Your reply is recorded',
    'There is no event on this invitation for your household to answer yet.',
    'That is more guests than this invitation is for. Ask the host if more can be added.',
    'Their link is ready. Copy it now',
    'Nobody has answered yet',
  ];
  for (const s of SENTENCES) {
    check('prelude', 'the shipped bundle carries the guest and host copy this tier asserts against',
      bundleText.includes(s), JSON.stringify(s.slice(0, 44)));
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
    where n.nspname = 'internal_api' and p.proname in ('issue_guest_invitations','rotate_guest_invitation',
      'revoke_guest_invitation','get_guest_invitation_state','resolve_guest_invitation','submit_guest_rsvp')`);
  check('prelude', 'the six Stage 8 verbs are on the stack this run will exercise',
    String(verbs).split(',').length === 6, String(verbs));
  measure('prelude', 'bytes of shipped JS/CSS/HTML scanned', `${(bundleText.length / 1024).toFixed(0)} KB`);

  const browser = await openBrowser({ cdpPort: CDP_PORT });
  const state = { host: null, weddingId: null, link1: null, rotated: null, phone: null,
    h1Id: null, h2Id: null, h3Id: null, ceremonyIds: [], strangerWeddingId: null };
  const runJourney = async (label, fn) => {
    try { return await fn(); } catch (err) {
      check('harness', `${label} could not be completed`, false, String(err?.message ?? err).slice(0, 300));
      return null;
    }
  };
  const guarded = async (letter, label, needsHost, fn) => {
    if (!wants(letter)) return null;
    if (needsHost && (state.host === null || state.weddingId === null)) {
      check(letter, `${label} ran`, false, 'journey A did not produce a host page or a wedding');
      return null;
    }
    return runJourney(label, fn);
  };
  try {
    await guarded('a', 'journey A (household, link, answer, read-back)', false,
      () => journeyA(browser, state));
    await guarded('b', 'journey B (rotation, withdrawal, expiry, forged, stranger)', true,
      () => journeyB(browser, state));
    await guarded('c', 'journey C (the wire and the digest)', true, () => journeyC(browser, state));
    await guarded('d', 'journey D (a11y and mobile)', true, () => journeyD(browser, state));
  } finally {
    await browser.close().catch(() => {});
    const before = psqlValue(`select (select count(*) from public.rsvp_responses
      where wedding_id in ${owners})::text || ' answers and '
      || (select count(*) from private.access_tokens where wedding_id in ${owners})::text
      || ' credentials before teardown'`);
    console.log(`==> ${before}`);
    await teardown();
    const tried = rawChunks.join('');
    const cameOut = emittedChunks.join('');
    const carried = [...DISCOVERED].filter((t) => tried.includes(t));
    const escaped = [...DISCOVERED].filter((t) => cameOut.includes(t));
    check('cleanup', 'every credential this run tried to print was masked before it left',
      escaped.length === 0 && carried.length > 0,
      `${DISCOVERED.size} credential(s) registered, ${carried.length} appeared in what this run `
      + `tried to print, ${maskedChunkCount} write(s) were rewritten, ${escaped.length} escaped`);
    const logPath = join(EVIDENCE_DIR, `s8-browser-${RUN_TAG}.log`);
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
    console.log('STAGE 8 BROWSER TIER: PASS');
  }
}

await main();
