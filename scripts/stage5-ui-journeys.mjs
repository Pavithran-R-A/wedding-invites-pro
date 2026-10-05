#!/usr/bin/env node
// VIVAAHVARNAM — Stage 5 §27 / §28 / §29: the three real-browser journeys.
//
// What this proves and why it is not covered by the other Stage 5 instruments:
//   * `supabase/tests/api/stage5_pack_driven_http.test.mjs` proves the *server* answers correctly.
//   * `scripts/stage4-render-qualification.mjs` proves the shipped renderer *draws* documents
//     correctly.
//   * Neither one proves a person can complete the workflow by clicking: that the copy they read is
//     the server's verdict, that the freeze button offers the action at the right moment and refuses
//     at the wrong one, and that the guest page they publish is the document the host previewed.
//     §27, §28 and §29 ask for exactly that, against the production bundle and the local stack.
//
// Guarantees this file enforces before it clicks anything:
//   * the target API origin and the preview origin are both loopback, and `project_id` in
//     config.toml is this repository's disposable stack — the same three checks the Stage 4
//     instrument makes, copied deliberately so a fresh reader does not have to trust an import;
//   * the built bundle in `dist/` calls the loopback target and does not contain the hosted project
//     URL that `.env` still carries, so "no hosted Supabase contact" is read off the bytes shipped
//     to the browser;
//   * every guest page opens in its own browser context, so it holds no auth state by construction
//     rather than by hope;
//   * accounts and rows are owned by this run's tag and removed child-before-parent, and a
//     credential-shaped string never reaches the printed report.
//
// Usage:
//   npm run build
//   npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
//   node scripts/stage5-ui-journeys.mjs              # all three journeys
//   node scripts/stage5-ui-journeys.mjs --only=a     # one journey
//
// Exit code 1 means a finding was recorded, not that the harness broke; a harness failure throws.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { assertLoopback, openBrowser } from './stage5-browser-driver.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_ORIGIN = assertLoopback(
  process.env.STAGE5_PREVIEW_URL ?? 'http://127.0.0.1:4173', 'STAGE5_PREVIEW_URL');
const CDP_PORT = Number(process.env.STAGE5_CDP_PORT ?? 9411);
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '--only=a,b,c')
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

const RUN_TAG = `stage5ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
/** Every catalogue row this run mints carries this pack-key prefix, so the residue report can tell
 *  this run's fixture apart from the earlier runs that are already in the local catalogue. */
const RUN_PACK_PREFIX = `stage5_ui_${RUN_TAG.replace(/-/g, '_')}`;
const PASSWORD = `local-only-${RUN_TAG}`;
const SCRATCH = mkdtempSync(join(tmpdir(), 'stage5-ui-'));

// --------------------------------------------------------------------- reporting

const TOKEN_SHAPED = /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g;
const mask = (value) => String(value).replace(TOKEN_SHAPED, (whole, lead) => `${lead}‹credential masked›`);
const results = [];
let failureCount = 0;

function check(area, name, ok, detail) {
  const shown = detail === undefined ? '' : mask(detail).slice(0, 400);
  results.push({ area, name, ok: Boolean(ok), detail: shown });
  if (!ok) failureCount += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} [${area}] ${name}${shown ? ` — ${shown}` : ''}`);
}
function measure(area, name, value) {
  results.push({ area, name, ok: true, detail: mask(value), measured: true });
  console.log(`  ..   [${area}] ${name} — ${mask(value)}`);
}
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Review, machine-assistance and platform-record fields a guest must never be handed, as *keys*
 *  in its payload. Measured 2026-10-01: this list used to also carry `section_key`, `role_key`,
 *  `group_key`, `event_key`, `body_source`, `fallback_used` and `overrode_pack_text`, which the
 *  public projection names one by one as part of the whitelist it will ship
 *  (`20260927120000_stage4_tradition_pack_releases.sql:1165-1171,1280-1365`) because the guest
 *  renderer keys its sections off them. Asserting their absence would have been a claim about the
 *  harness's taste, not about the contract, so the contract's own dropped fields are what is
 *  asserted here, and the whitelisted structural fields are reported as a measurement instead. */
const NEVER_FOR_GUEST_KEYS = [
  'machine_assisted', 'machine_assistance_notes', 'review_label', 'review_basis', 'review_scope',
  'reviewed_by', 'reviewed_at', 'approved_at', 'review_packet_hash', 'source_reference',
  'changelog', 'author_label', 'reviewed_languages', 'definition_schema_version',
  'pack_id', 'release_id', 'wedding_id', 'owner_user_id', 'snapshot', 'token',
];
/** The structural fields the projection is written to ship, listed here so a run *says* which
 *  ones a real guest payload carried rather than leaving the reader to trust the SQL comment. */
const STRUCTURAL_KEYS_ALLOWED_TO_GUEST = [
  'section_key', 'role_key', 'group_key', 'event_key', 'body_source', 'fallback_used',
  'overrode_pack_text', 'pack_key', 'template_key', 'release_number',
];
/** Words a guest's rendered page must never print. The synthetic release's own wording begins with
 *  `TEST ONLY` on purpose — the marker travels with the content so a test body can never be read
 *  as a real reviewed line — so it belongs to the fixture's vocabulary, not to this list. It used
 *  to be here, and §29's "draws no review string" check then failed on a page that was showing
 *  exactly the wording it was built to show. */
const NEVER_FOR_GUEST_WORDS = [
  'TEST FIXTURE', 'NOT A REAL CULTURAL REVIEW', 'machine_assisted', 'machine assisted',
  'human review', 'reviewed by', 'review packet', 'review basis', 'review scope', 'changelog',
  'source reference', 'author label', 'definition schema version', 'snapshot_schema_version',
];
const UUID_SHAPED = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Recursive walk of a response body: a key that never appears in the *rendered* page can still be
 *  sitting in the payload, which is the difference between a layout bug and a data leak. */
function keysIn(value, names, path = '$', found = []) {
  if (value === null || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    if (names.includes(key.toLowerCase())) found.push(`${path}.${key}`);
    keysIn(child, names, `${path}.${key}`, found);
  }
  return found;
}
const forbiddenKeysIn = (value) => keysIn(value, NEVER_FOR_GUEST_KEYS);
const structuralKeysIn = (value) => keysIn(value, STRUCTURAL_KEYS_ALLOWED_TO_GUEST)
  .map((p) => p.split('.').pop()).filter((k, i, all) => all.indexOf(k) === i);

// --------------------------------------------------------------------- the stack

function psqlRows(query) {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', query], { encoding: 'utf8' })
    .split(/\r?\n/).filter((l) => l.length > 0);
}
const psqlValue = (query) => psqlRows(query)[0] ?? null;

/** The maintenance CLI, invoked the only way it can be invoked: against the named local container,
 *  with no default target. §28 requires the synthetic release to be created *through* this tool,
 *  because a release a person did not travel draft → reviewed → approved through is not the thing
 *  the journey is meant to exercise. */
function cli(...argv) {
  const res = spawnSync('node', [join(ROOT, 'scripts', 'tradition-pack-admin.mjs'),
    '--via-docker', DB_CONTAINER, ...argv], { encoding: 'utf8', cwd: ROOT });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (res.status !== 0) throw new Error(`cli ${argv[0]} exited ${res.status}: ${mask(out).slice(-500)}`);
  return out;
}
function cliJson(...argv) {
  const out = cli(...argv);
  // The tool prints its plan as prose lines and then exactly one JSON document, so the document is
  // taken by its braces rather than by line shape.
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`cli ${argv[0]} printed no JSON document:\n${mask(out).slice(0, 600)}`);
  }
  try { return JSON.parse(out.slice(start, end + 1)); } catch (err) {
    throw new Error(`cli ${argv[0]} printed unparseable JSON (${err.message}):\n`
      + `${mask(out.slice(start, end + 1)).slice(0, 600)}`);
  }
}

const SCOPE = 'TEST ONLY fixture created by the Stage 5 browser journeys. It endorses no tradition, '
  + 'community, ritual or language claim; no string in it was read by a human reviewer with '
  + 'cultural authority; it is not customer content.';
const REVIEWER = 'TEST ONLY — Stage 5 browser journey harness';

/** The version-2 definition §28 asks for: one section per override rule, a required people list, a
 *  required event list that demands a venue, ordered positions, reviewed wording in two languages,
 *  and — in `invitation` — reviewed wording that exists only in English *and declares
 *  `allow_english_fallback`*, which is what makes an English fallback something the journey
 *  actually walks into rather than only asserts about. The flag is not decoration: measured on
 *  2026-10-01 the same definition without it produced no body for `invitation` at all and a
 *  blocking `required_text_missing` that said "the release does not allow it to fall back", which
 *  is the server's rule, not a defect — a fallback has to be offered by the release. */
function definitionV2(openingEn, invitationEn) {
  return {
    sections: [
      { section_key: 'opening', position: 1, kind: 'text', required: true,
        host_field: 'welcome', override_rule: 'host_may_replace',
        heading: { en: 'Opening', ta: 'தொடக்கம்' },
        pack_text: { en: openingEn, ta: 'வணக்கம்' } },
      { section_key: 'family', position: 2, kind: 'people_list', required: true,
        heading: { en: 'Our families', ta: 'குடும்பம்' } },
      { section_key: 'ceremonies', position: 3, kind: 'event_list', required: true,
        requires_venue: true, heading: { en: 'The ceremonies', ta: 'நிகழ்ச்சிகள்' } },
      { section_key: 'invitation', position: 4, kind: 'text', required: true,
        host_field: 'family_introduction', override_rule: 'pack_only',
        allow_english_fallback: true,
        heading: { en: 'The invitation', ta: 'அழைப்பு' },
        pack_text: { en: invitationEn } },
      { section_key: 'closing', position: 5, kind: 'text', required: true,
        host_field: 'closing', override_rule: 'host_must_supply',
        heading: { en: 'Closing', ta: 'முடிவு' } },
    ],
    event_vocabulary: [
      { event_key: 'muhurtham', labels: { en: 'Muhurtham', ta: 'முஹூர்தம்' } },
    ],
  };
}

/** create → hash → review → approve, with nothing hand-written into a table and no digest computed
 *  by this file. The hash that `submit-review` binds to is the one the CLI printed, which the
 *  database recomputed from its own row. */
function mintApprovedRelease({ key, name, openingEn, invitationEn, packExists = false }) {
  if (!packExists) cli('create-pack', '--key', key, '--name', name, '--scope', SCOPE, '--yes');
  const defPath = join(SCRATCH, `${key}-definition.json`);
  writeFileSync(defPath, JSON.stringify(definitionV2(openingEn, invitationEn), null, 2));
  const created = cliJson('create-release', '--key', key, '--definition', defPath,
    '--dsv', '2', '--languages', 'en,ta',
    '--author', 'Machine-assisted draft; no human cultural review has been recorded.',
    '--machine-assisted',
    '--notes', 'TEST ONLY: machine-assisted wording, generated for browser qualification.',
    '--source', 'TEST ONLY — Stage 5 §28 journey fixture',
    '--changelog', packExists
      ? 'TEST ONLY second release for this fixture pack: one reviewed line changes.'
      : 'TEST ONLY first release for this fixture pack.',
    // The CLI plans before it writes; every state-changing verb in this file carries --yes
    // deliberately, so a dry run is never mistaken for a minted release.
    '--yes');
  const releaseId = created.release_id ?? created.id ?? created.release?.id;
  if (!releaseId) throw new Error('create-release printed no release id');
  const packetDir = join(SCRATCH, 'packets');
  const packetOut = cli('review-packet', '--release', releaseId, '--out', packetDir);
  const digest = /authoritative digest: ([0-9a-f]{64})/.exec(packetOut)?.[1];
  if (!digest) throw new Error('review-packet printed no authoritative digest');
  cli('submit-review', '--release', releaseId, '--decision', 'accept',
    '--reviewer', REVIEWER, '--basis', 'TEST ONLY — machine-assisted fixture review',
    '--scope', 'TEST ONLY — wording and section order only; no cultural endorsement',
    '--languages', 'en,ta', '--hash', digest, '--yes');
  cli('approve', '--release', releaseId, '--hash', digest, '--yes');
  const after = cliJson('inspect', '--release', releaseId);
  return { releaseId, digest, status: after.status ?? after.release?.status ?? null,
    releaseNumber: after.release_number ?? after.release?.release_number ?? null };
}

// --------------------------------------------------------------------- page-level helpers

const sleep = (ms) => new Promise((d) => setTimeout(d, ms));

async function waitForUrl(page, part, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const url = await page.currentUrl();
    if (url.includes(part)) return url;
    if (Date.now() > deadline) return null;
    await sleep(150);
  }
}

/** Every response Chrome saw for one endpoint, oldest first, with its body read back.
 *
 *  CORS preflights are excluded. A preflight is a real request on the wire (§32 classifies it
 *  from the raw log, where it belongs) but it carries no verdict: it answers with headers and no
 *  body, and `Network.getResponseBody` refuses it. Measured 2026-10-01 on §28's venue step — the
 *  preview endpoint went from 12 to 14 completed responses, the newest of which was the preflight
 *  of the following call, so "wait for a fresh answer and take the last one" took an empty OPTIONS
 *  as the host's verdict. */
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

const PREVIEW_URL_PART = '/rest/v1/rpc/preview_invitation_document';

/** The newest preview verdict the server has actually sent. Waiting for the count to grow is what
 *  keeps a stale panel from being reported as the current verdict — the risk §20's race fix was
 *  about, seen from the browser side. */
async function readPreview(page, { minCount = 1, timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const seen = await responsesFor(page, PREVIEW_URL_PART);
    if (seen.length >= minCount && seen.length > 0) {
      const last = seen[seen.length - 1];
      // `body !== null`, not `body`: an empty or unparseable answer is a verdict about the
      // endpoint, and silently re-polling it read as "no verdict ever arrived". Measured
      // 2026-10-01, where §28 died three steps later on a null read of `.issues` instead of
      // saying what the newest preview response actually contained.
      if (last.body !== null) {
        let raw;
        try {
          const parsed = JSON.parse(last.body);
          raw = Array.isArray(parsed) ? parsed[0] : parsed;
        } catch {
          throw new Error(`the newest preview verdict is not JSON — HTTP ${last.status}, `
            + `${last.body.length} bytes: ${JSON.stringify(last.body.slice(0, 120))}`);
        }
        if (raw === null || typeof raw !== 'object') {
          throw new Error(`the newest preview verdict answered ${JSON.stringify(raw).slice(0, 120)} `
            + `at HTTP ${last.status}, not a document`);
        }
        return { count: seen.length, status: last.status, raw,
          issues: raw?.issues ?? null, invitation: raw?.invitation ?? null,
          authoring: raw?.authoring ?? null, selectedRelease: raw?.selected_release ?? null };
      }
    }
    if (Date.now() > deadline) return null;
    await sleep(200);
  }
}

/** The preview traffic as the harness recorded it, spelled out for the message that says no
 *  verdict arrived — so a step that never triggered a read is told apart from a read whose body
 *  the browser would not hand over. */
const previewTrace = async (page) => {
  const seen = await responsesFor(page, PREVIEW_URL_PART);
  return `${seen.length} completed (`
    + seen.slice(-4).map((r) => `${r.method} ${r.status}:${r.body === null ? 'unreadable' : `${r.body.length}B`}`).join(' ')
    + ')';
};

/** The preview and guest RPCs answer the frozen projection, not the app's parsed DTO: `sections`
 *  is an object carrying `requested` and `items`, and each item's `heading` and `body` are
 *  themselves objects with a `text`. Reading that shape by name keeps a journey's claim about
 *  "what the server said" a claim about what the server actually sent. */
const sectionItems = (invitation) => invitation?.sections?.items ?? null;
const sectionBody = (section) => section?.body?.text ?? null;
const sectionSource = (section) => section?.body?.source ?? null;
const sectionHeading = (section) => section?.heading?.text ?? section?.section_key ?? null;

/** The app's own session token, taken from the captured traffic, for one deliberate call that the
 *  disabled button will not make. Never printed. */
async function rpcAsHost(page, functionName, params) {
  const h = await page.rpcHeaders();
  if (!h?.authorization) throw new Error('no captured RPC headers to reuse');
  const headers = {
    apikey: h.apikey, Authorization: h.authorization, 'Content-Type': 'application/json',
  };
  if (h.profile) headers['Content-Profile'] = h.profile;
  return page.fetchFromPage(`${apiUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST', headers, body: JSON.stringify(params) });
}

// --------------------------------------------------------------------- the UI flow

const PROSE_LABELS = {
  opening: 'The opening',
  familyIntroduction: 'Who is inviting',
  eventNotes: 'A note about the ceremonies',
  closing: 'The last words',
};

/** The auth routes remount their form when the session changes: signing up establishes a session,
 *  so `/login` renders once with the outgoing values and then again empty. A harness that types
 *  into the first instance reports a press that never reaches the server — measured on
 *  2026-10-01, where the click landed on a form whose fields had just been cleared. So the harness
 *  waits for the button to be present *and* stable, types, reads every value back, and only then
 *  clicks. Anything it cannot read back is reported, not papered over. */
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
    '#name': 'Test Host',
    '#email': emailFor(who),
    '#password': PASSWORD,
  }, 'Sign up');
  check('prelude', `${who}: the sign-up button was pressable`, pressed === 'pressed', pressed);
  const landed = await waitForUrl(page, '/login') ?? await page.currentUrl();
  check('prelude', `${who}: sign-up routed into the real login screen`, landed.includes('/login'), landed);
  const signupTruth = await page.waitForText(
    'Nothing was emailed — this stack confirms accounts without email. Log in to continue.',
    10_000,
  );
  check('prelude', `${who}: sign-up copy matches the local stack's no-confirmation behaviour`,
    Boolean(signupTruth),
    signupTruth ? 'truthful no-email notification rendered'
      : `page said: ${(await page.bodyText()).replace(/\\s+/g, ' ').slice(0, 220)}`);
  const loginPressed = await fillAndSubmit(page, {
    '#email': emailFor(who),
    '#password': PASSWORD,
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
  // shadcn's `Button asChild` renders the router Link, so this entry point is an `<a>`; a
  // button query would report "absent" and the run would blame the app.
  await page.clickLink('Open Invitation Editor');
  const edit = await waitForUrl(page, '/edit');
  if (!edit) throw new Error('the editor never opened from the planning page');
  return weddingId;
}

/** A second context signing in as the same host: the way to prove the pack choice, the release
 *  notice and the frozen versions are properties of the account, not of one page instance. */
async function signInExisting(browser, who) {
  const page = await browser.newPage(`${who}-signin`);
  await page.goto(`${PREVIEW_ORIGIN}/login`);
  await page.waitForSelector('#email');
  const pressed = await fillAndSubmit(page, {
    '#email': emailFor(who),
    '#password': PASSWORD,
  }, 'Log in');
  const dash = await waitForUrl(page, '/dashboard');
  if (!dash) {
    throw new Error(`existing host could not sign in (press ${pressed}): `
      + `${(await page.bodyText()).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  return page;
}

async function waitForTraditionPanel(page) {
  const ok = await page.waitForSelector('#tradition-heading');
  if (!ok) return null;
  const found = await page.waitForText('Choose a pack, or write everything yourself.', 25_000);
  return found ? true : null;
}

/** Opens one of the three row-add forms and proves it opened. The editor keeps a single add slot
 *  and disables these buttons while a row is saving, so "pressed" is checked, not assumed. */
async function openAddForm(page, buttonWords, fieldSelector) {
  await page.pressButtonWhenReady(buttonWords);
  const opened = await page.waitForSelector(fieldSelector);
  if (!opened) {
    throw new Error(`"${buttonWords}" was pressed but ${fieldSelector} never appeared: `
      + `${(await page.bodyText()).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
}

/** The row's own words appearing on the page is the commit signal a host reads. Waiting for the
 *  add-form to close instead (which is what this did) proves only that the editor moved on: on a
 *  slow response the form can close while the new row is still being fetched, and the journey then
 *  reports its compound "was not added" with nothing to point at. Measured 2026-10-01 (run 9): all
 *  three rows were in the database, and the check still failed, because it had looked for their
 *  text a moment too early. */
async function rowAdded(page, name, formSelector) {
  const shown = await page.waitForText(name, 25_000);
  if (shown) return true;
  const formStillOpen = await page.evaluate(
    `Boolean(document.querySelector(${JSON.stringify(formSelector)}))`);
  if (formStillOpen) {
    throw new Error(`"${name}" never appeared and its add form is still open, so the write did not `
      + 'come back — every later step of this journey would be aimed at the wrong slot');
  }
  return false;
}

async function addPerson(page, { name, role, group }) {
  await openAddForm(page, 'Add a person', '[id$="-new-person-name"]');
  await page.setBySelector('[id$="-new-person-name"]', name);
  if (role) await page.setBySelector('[id$="-new-person-role"]', role);
  if (group) await page.setBySelector('[id$="-new-person-group"]', group);
  await page.pressButtonWhenReady('Add to invitation');
  return rowAdded(page, name, '[id$="-new-person-name"]');
}
async function addVenue(page, { name, address, map }) {
  await openAddForm(page, 'Add a venue', '[id$="-new-venue-name"]');
  await page.setBySelector('[id$="-new-venue-name"]', name);
  await page.setBySelector('[id$="-new-venue-address"]', address);
  if (map) await page.setBySelector('[id$="-new-venue-map"]', map);
  await page.pressButtonWhenReady('Add to invitation');
  return rowAdded(page, name, '[id$="-new-venue-name"]');
}
async function addCeremony(page, { name, starts, timezone, venueName }) {
  await openAddForm(page, 'Add a ceremony', '[id$="-new-ceremony-name"]');
  await page.setBySelector('[id$="-new-ceremony-name"]', name);
  await page.setBySelector('[id$="-new-ceremony-starts"]', starts);
  if (timezone) await page.setBySelector('[id$="-new-ceremony-timezone"]', timezone);
  if (venueName) {
    const options = await page.evaluate(`(() => {
      const el = document.querySelector('[id$="-new-ceremony-venue"]');
      if (!el) return null;
      return [...el.options].map((o) => ({ value: o.value, text: o.textContent.trim() }));
    })()`);
    const match = (options ?? []).find((o) => o.text.includes(venueName));
    if (!match) throw new Error(`the venue "${venueName}" was not offered in the ceremony form`);
    await page.setBySelector('[id$="-new-ceremony-venue"]', match.value);
  }
  await page.pressButtonWhenReady('Add to invitation');
  return rowAdded(page, name, '[id$="-new-ceremony-name"]');
}

/** The host's own words, typed into whatever prose fields the current authoring declaration offers.
 *  Deliberately generic: journey A gets four fields, journey B gets the three the release declares,
 *  and a `pack_only` section has no field to type into — which is the §28 test, not an obstacle.
 *  Slots are named the way the code names them; the screen is addressed by the words it prints. */
async function typeAvailableProse(page, valuesBySlot) {
  const typed = [];
  const absent = [];
  for (const [slot, text] of Object.entries(valuesBySlot)) {
    const label = PROSE_LABELS[slot];
    if (!label) throw new Error(`no screen label is recorded for the slot '${slot}'`);
    const present = await page.valueByLabel(label);
    if (!present) {
      absent.push(slot);
      continue;
    }
    await page.setByLabel(label, text);
    typed.push(slot);
  }
  if (absent.length) measure('journey', 'prose slots with no field on this page', absent.join(', '));
  return typed;
}

/** Presses an action the product may still be loading (a freeze refetches the version list before
 *  `Publish` is offered) and turns "it never came" into a recorded finding with the reason, instead
 *  of a stack trace that hides the rest of the journey. */
async function pressOffered(page, words) {
  try {
    await page.pressButtonWhenReady(words);
    return 'pressed';
  } catch (err) {
    return String(err.message).replace(`[${page.name}] `, '');
  }
}

/** What a press that returned `pressed` actually produced. The browser delivering a click is not
 *  the app taking an action: `handleCreateVersion` can return before any request (its unsaved-changes
 *  guard, `EditProject.tsx:531`), and `runPublication` can answer with a notice instead of a row
 *  (`EditProject.tsx:507`). Measured 2026-10-01 (run 8): journey A's freeze reported `pressed`, no
 *  version row appeared, and the only evidence the check carried was the first two hundred
 *  characters of the page — the top of the editor, which cannot tell "the handler never ran" from
 *  "the server refused" from "the app said why further down". So an action now reports the request
 *  the app made and the app's own status/notice line beside the press result. */
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

async function saveDraft(page, { minPreviews = 0 } = {}) {
  await page.pressButtonWhenReady('Save Draft');
  const saved = await page.waitForText('Saved', 20_000);
  if (!saved) throw new Error('the editor never reported Saved');
  if (minPreviews > 0) await readPreview(page, { minCount: minPreviews + 1 });
  return saved;
}

/** Row edits and draft saves each trigger their own preview read, and a request the app started
 *  *before* a write can answer *after* it. Measured on 2026-10-01: §28's ceremony insert was
 *  followed by a preview that had begun on the previous save and still reported `required_list_empty`
 *  for a section that had an event by then — so waiting only for "one more response" can hand back a
 *  verdict that predates the action. The harness therefore waits for a new response *and* for the
 *  endpoint to go quiet for `quietMs`, then takes the newest answer. */
const previewCount = async (page) => (await page.networkLog())
  .filter((r) => r.url.includes(PREVIEW_URL_PART) && r.status && carriesData(r)).length;

async function previewAfter(page, action, { quietMs = 1_500, timeoutMs = 30_000, label = 'this action' } = {}) {
  const before = await previewCount(page);
  await action();
  const deadline = Date.now() + timeoutMs;
  let count = before;
  let quietSince = null;
  const settle = async (minCount) => {
    const doc = await readPreview(page, { minCount });
    if (doc === null) {
      throw new Error(`no usable preview verdict after ${label}: the endpoint went from `
        + `${before} to ${await previewTrace(page)} responses`);
    }
    return doc;
  };
  for (;;) {
    const now = await previewCount(page);
    if (now > count) {
      count = now;
      quietSince = null;
    } else if (count > before) {
      if (quietSince === null) quietSince = Date.now();
      else if (Date.now() - quietSince >= quietMs) return settle(count);
    }
    if (Date.now() > deadline) break;
    await sleep(200);
  }
  return settle(Math.max(1, count));
}

async function guestPage(browser, token, { label = 'guest' } = {}) {
  const page = await browser.newPage(label);
  await page.goto(`${PREVIEW_ORIGIN}/i/${token}`);
  const drawn = await page.waitForSelector('article', 25_000);
  return { page, drawn };
}

async function documentFingerprint(page) {
  const html = await page.evaluate(`(() => {
    const art = document.querySelector('article');
    return art ? art.outerHTML : null;
  })()`);
  if (html === null) {
    throw new Error(`[${page.name}] drew no invitation document to read — nothing can be `
      + 'fingerprinted, and a check against an empty page would be a green light for free');
  }
  const text = await page.evaluate(`(() => {
    const art = document.querySelector('article');
    return art ? art.innerText : null;
  })()`);
  return { html, text, hash: sha256(html), textHash: text === null ? null : sha256(text) };
}

const RESOLVE_URL_PART = 'resolve_public_invitation';

const resolveVisits = async (page) => (await responsesFor(page, RESOLVE_URL_PART)).length;

/** The guest payload from the newest visit this page made — or a thrown error. The check that
 *  consumed it used to read `seen.length ? JSON.parse(body) : null`, so a run in which the guest
 *  document never arrived handed `null` to the leak walker and passed by having nothing to walk
 *  (found 2026-10-01 while re-reading journey A). A missing payload is an instrument failure. */
async function guestPayload(page) {
  const seen = await responsesFor(page, RESOLVE_URL_PART);
  const last = seen[seen.length - 1];
  if (!last) throw new Error(`the guest page made no ${RESOLVE_URL_PART} request with a status`);
  if (last.body === null) {
    throw new Error(`the guest document came back at HTTP ${last.status} with no retrievable body`);
  }
  return { body: JSON.parse(last.body), visits: seen.length };
}

/** Return to a published address and wait for the server's answer to *that* trip.
 *  `documentFingerprint` can only read the DOM in front of it, so fingerprinting after a change
 *  without re-navigating compares a page against itself: §29's "the guest changed only now" check
 *  printed `b7927cfc → b7927cfc` for exactly this reason. Counting the resolve responses before and
 *  after makes "the guest saw the new document" a measured fact — the document cannot be drawn
 *  without the request that produced it. */
async function revisitGuest(page, token, { timeoutMs = 25_000 } = {}) {
  const before = await resolveVisits(page);
  await page.goto('about:blank');
  await page.goto(`${PREVIEW_ORIGIN}/i/${token}`);
  const drawn = await page.waitForSelector('article', timeoutMs);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await resolveVisits(page) > before) return drawn;
    if (Date.now() > deadline) break;
    await sleep(200);
  }
  throw new Error(`revisiting the guest address drew a document but asked the server nothing`
    + ` (${before} → ${await resolveVisits(page)} ${RESOLVE_URL_PART} responses)`);
}

// --------------------------------------------------------------------- journey A (§27)

const A_LINES = {
  opening: 'With love from the family, we invite you to share this day.',
  familyIntroduction: 'Grandparents, parents and siblings invite you.',
  eventNotes: 'A meal follows the ceremony on the terrace.',
  closing: 'Your presence is the only gift we ask for.',
};

async function journeyA(browser) {
  console.log('\n==> §27 — journey A: no pack, whole way through the UI');
  const host = await signUpAndEnterHost(browser, 's5a-host');
  const weddingId = await createWedding(host, { title: 'Asha weds Bala', lang: 'en' });
  measure('27', 'wedding created through the UI', weddingId.slice(0, 8));

  const panel = await waitForTraditionPanel(host);
  check('27', 'the tradition panel reached its loaded state', panel !== null,
    await host.hasText('Loading the tradition packs…') ? 'still loading' : 'no legend rendered');
  const checked = await host.radioValue('tradition-pack-release');
  check('27', 'a brand-new draft stands on no pack', checked === 'none', String(checked));
  check('27', 'the panel says a pack is optional',
    await host.hasText('Tradition packs are optional. You can create an invitation without one.'));

  const typed = await typeAvailableProse(host, A_LINES);
  check('27', 'all four manual prose slots were editable', typed.length === 4, typed.join(', '));
  const personAdded = await addPerson(host,
    { name: 'Ravikumar Kandasamy', role: 'Father', group: "The groom's family" });
  const venueAdded = await addVenue(host, {
    name: 'Kalyana Mantapa', address: '100 Pillar Road\nMadurai 625001',
    map: 'https://maps.example.test/kalyana' });
  const ceremonyAdded = await previewAfter(host, async () => {
    await addCeremony(host, {
      name: 'Muhurtham', starts: '2026-11-14T07:30', timezone: 'Asia/Kolkata',
      venueName: 'Kalyana Mantapa' });
  });
  const ceremonyVisible = await host.hasText('Muhurtham');
  const rowCounts = psqlValue(`
    select (select count(*) from public.wedding_people where wedding_id = '${weddingId}')::text
           || ' people, '
           || (select count(*) from public.venues where wedding_id = '${weddingId}')::text
           || ' venues, '
           || (select count(*) from public.wedding_events where wedding_id = '${weddingId}')::text
           || ' events'`);
  check('27', 'people, venue and ceremony were added through the UI',
    personAdded && venueAdded && ceremonyVisible,
    `person on page: ${personAdded}, venue on page: ${venueAdded}, ceremony on page: `
    + `${ceremonyVisible}; the database holds ${rowCounts}`);
  void ceremonyAdded;
  await saveDraft(host);

  const preview = await readPreview(host, { minCount: 1 });
  check('27', 'the server answered the preview', preview !== null && preview.status === 200);
  const blocking = (preview?.issues ?? []).filter((i) => i.blocking === true);
  check('27', 'the server reports no blocking issue for the completed no-pack draft',
    blocking.length === 0, JSON.stringify(blocking).slice(0, 300));
  check('27', 'the issue panel is therefore absent from the page',
    !(await host.hasText('What the server says stands between this and a version')));
  measure('27', 'server issue count on the complete draft', `${preview.issues.length} issues`);

  const freezeState = await host.buttonState('Freeze this draft as a version');
  check('27', 'the freeze button is offered', freezeState === 'enabled', freezeState);
  const froze = await pressOffered(host, 'Freeze this draft as a version');
  const frozenCopy = await host.waitForText('It cannot be edited.', 25_000);
  check('27', 'freeze V1 succeeded and was surfaced', froze === 'pressed' && frozenCopy,
    `${froze}; ${await pressEvidence(host, 'create_invitation_version')}`);

  const published = await pressOffered(host, 'Publish');
  const liveCopy = await host.waitForText('Copy the address now', 25_000);
  check('27', 'publish succeeded and the address was shown once',
    published === 'pressed' && liveCopy,
    `${published}; ${await pressEvidence(host, 'publish_invitation_version')}`);
  const token = (await host.bodyText()).match(/[A-Za-z0-9_-]{43}/)?.[0] ?? null;
  check('27', 'a share address was readable from the page', Boolean(token),
    token ? 'token read (masked here)' : 'none found');

  const versions = psqlValue(
    `select count(*)::text from public.invitation_versions where wedding_id = '${weddingId}'`);
  const pinnedRelease = psqlValue(
    `select coalesce(tradition_pack_release_id::text,'NONE') from public.invitation_versions
       where wedding_id = '${weddingId}' and version_number = 1`);
  check('27', 'V1 was written as one frozen version', versions === '1', String(versions));
  check('27', 'V1 carries no pack provenance', pinnedRelease === 'NONE', pinnedRelease);

  const sources = psqlRows(`
    select coalesce(s ->> 'body_source','(none)')
      from public.invitation_versions v,
           jsonb_array_elements(v.snapshot -> 'sections' -> 'items') s
     where v.wedding_id = '${weddingId}' and v.version_number = 1`);
  check('27', 'no section of V1 claims reviewed-pack credit',
    !sources.includes('reviewed_pack'), sources.join(', ') || 'no sections');

  const { page: guest, drawn } = await guestPage(browser, token);
  check('27', 'the guest page rendered in a context with no session', drawn);
  const first = await documentFingerprint(guest);
  check('27', 'the guest sees the host\'s own words',
    first.text.includes(A_LINES.opening) && first.text.includes(A_LINES.closing));
  check('27', 'the guest sees the venue, the ceremony and the people',
    first.text.includes('Kalyana Mantapa') && first.text.includes('Muhurtham')
    && first.text.includes('Ravikumar Kandasamy'));
  const forbidden = NEVER_FOR_GUEST_WORDS.filter((needle) => first.text.toLowerCase()
    .includes(needle.toLowerCase()));
  check('27', 'no review, machine-assistance or platform-key string is drawn',
    forbidden.length === 0, forbidden.join(', '));
  check('27', 'no internal identifier is drawn', !UUID_SHAPED.test(first.text));
  const { body: guestDtoBody } = await guestPayload(guest);
  const leaked = forbiddenKeysIn(guestDtoBody);
  check('27', 'the guest payload itself carries no reviewer or provenance field',
    leaked.length === 0, leaked.join(', '));
  measure('27', 'structural keys the guest payload did carry',
    structuralKeysIn(guestDtoBody).join(', ') || 'none');

  const storage = await guest.privacyState();
  const cookies = await guest.cookiesForOrigin();
  check('27', 'the guest holds no auth state',
    storage.local.length === 0 && storage.session.length === 0 && cookies.length === 0,
    JSON.stringify({ local: storage.local, session: storage.session, cookies }));
  const guestNet = await guest.networkLog();
  const remote = guestNet.filter((r) => /supabase\.co|\.supabase\.in/.test(r.url)
    || (r.url.startsWith('http') && !r.url.includes('127.0.0.1')
      && !r.url.includes('localhost') && !/^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(r.url)));
  check('27', 'the guest page contacted no hosted Supabase and no unexplained origin',
    remote.length === 0, remote.map((r) => r.url.split('?')[0]).join(', '));
  measure('27', 'guest requests classified',
    [...new Set(guestNet.map((r) => new URL(r.url).host))].join(', '));

  // §27's last clause: the draft is still editable, and the published guest page must not move.
  await host.goto(`${PREVIEW_ORIGIN}/project/${weddingId}/edit`);
  await host.waitForSelector('#tradition-heading');
  await host.setByLabel(PROSE_LABELS.opening, 'Rewritten after V1 was published.');
  await saveDraft(host);
  await revisitGuest(guest, token);
  const second = await documentFingerprint(guest);
  check('27', 'a fresh visit to the same address is byte-identical after the draft was edited',
    second.hash === first.hash, `${first.hash.slice(0, 12)} → ${second.hash.slice(0, 12)}`);
  const previewNow = await readPreview(host, { minCount: 1 });
  check('27', 'the host preview did move, so the comparison is not two stale reads',
    (sectionItems(previewNow?.invitation) ?? []).some((s) => (sectionBody(s) ?? '')
      .includes('Rewritten after V1')));
  const versionsAfter = psqlValue(
    `select count(*)::text from public.invitation_versions where wedding_id = '${weddingId}'`);
  check('27', 'no second version was created by editing the draft', versionsAfter === '1');
  const linkAgain = await host.hasText('A live address cannot be shown again');
  measure('27', 'share address shown once (reload guard present on page)',
    linkAgain ? 'yes' : 'not re-shown');
  return { weddingId, guestHashBefore: first.hash, token };
}

// --------------------------------------------------------------------- journey B (§28)

const B_PACK_KEY = RUN_PACK_PREFIX;
const B_LINE_R1 = 'TEST ONLY — release one opening line for the Stage 5 browser journey.';
const B_INVITATION_R1 = 'TEST ONLY — together with their families, you are invited.';

async function journeyB(browser) {
  console.log('\n==> §28 — journey B: a synthetic approved pack, created through the CLI');
  const minted = mintApprovedRelease({
    key: B_PACK_KEY, name: 'TEST ONLY — Stage 5 UI Journey Pack',
    openingEn: B_LINE_R1, invitationEn: B_INVITATION_R1 });
  check('28', 'the CLI carried the release draft → reviewed → approved',
    minted.status === 'approved', `status ${minted.status}, release ${minted.releaseNumber}`);
  measure('28', 'approved release', minted.releaseId.slice(0, 8));

  const host = await signUpAndEnterHost(browser, 's5b-host');
  const weddingId = await createWedding(host, { title: 'அஷா திருமணம் பாலா', lang: 'ta' });
  await waitForTraditionPanel(host);
  const options = await host.evaluate(`(() => [...document.querySelectorAll(
    'input[type=radio][name=tradition-pack-release]')]
      .map((r) => ({ value: r.value, text: r.closest('label')?.innerText.trim().slice(0,60)
        ?? null, disabled: r.disabled })))()`);
  measure('28', 'pack options the UI offered', JSON.stringify(options).slice(0, 300));
  const offered = (options ?? []).find((o) => o.value === minted.releaseId);
  check('28', 'the approved synthetic release is selectable and nothing else about it is exposed',
    Boolean(offered) && offered.disabled === false);

  // Incomplete first: the release asks for things the fresh draft has not supplied.
  const previewIncomplete = await readPreview(host, { minCount: 1 });
  await host.pickRadio('tradition-pack-release', minted.releaseId);
  await host.waitForText('Chosen:', 25_000);
  const previewAfterChoice = await previewAfter(host, async () => {
    await host.pressButtonWhenReady('Save Draft');
  });
  const blockingAfterChoice = (previewAfterChoice?.issues ?? []).filter((i) => i.blocking === true);
  check('28', 'the server lists blocking issues for the incomplete pack-driven draft',
    blockingAfterChoice.length > 0,
    JSON.stringify(blockingAfterChoice.map((i) => i.code)).slice(0, 300));
  const codes = blockingAfterChoice.map((i) => i.code);
  check('28', 'the blocking set names the required host prose and the required lists',
    codes.includes('required_text_missing') && codes.includes('required_list_empty'),
    codes.join(', ') || 'none');
  check('28', 'the editor shows that server list verbatim',
    await host.hasText('What the server says stands between this and a version'));
  const freezeState = await host.buttonState('Freeze this draft as a version');
  check('28', 'the freeze button is not offered while the server blocks',
    freezeState === 'disabled', freezeState);
  measure('28', 'the button\'s own explanation',
    (await host.buttonCaption('Freeze this draft as a version') ?? '').replace(/\s+/g, ' ').slice(0, 160));

  const refused = await rpcAsHost(host, 'create_invitation_version', { p_wedding_id: weddingId });
  check('28', 'the server refuses the freeze independently of the disabled button',
    refused.status >= 400, `HTTP ${refused.status}`);
  const refusalBody = refused.text.slice(0, 400);
  check('28', 'the refusal leaks no table, function or constraint name to the browser',
    !/private\.|internal_api\.|SECURITY|constraint|relation/i.test(refusalBody), refusalBody);

  // Editor order comes from the release, not from the client's guess. The blocks are the divs
  // `AuthoringOutline` ids `authoring-<section_key>`; `[id^="authoring-"]` also matches the
  // section's own `<h2 id="authoring-heading">`, which is a heading, not a section, and was
  // measured (2026-10-01) sitting at the head of that list and reported as a section named
  // "heading". The tag is what distinguishes a block, so the query asks for it.
  const order = await host.evaluate(`(() => [...document.querySelectorAll('div[id^="authoring-"]')]
    .map((el) => el.id.replace('authoring-','')))()`);
  const declaredOrder = (previewAfterChoice.authoring ?? []).map((s) => s.section_key);
  check('28', 'the server\'s authoring declaration carries the release\'s declared order',
    JSON.stringify(declaredOrder) === JSON.stringify(['opening', 'family', 'ceremonies', 'invitation', 'closing']),
    declaredOrder.join(' → '));
  check('28', 'the editor renders the release-declared section order',
    JSON.stringify(order) === JSON.stringify(declaredOrder),
    order.join(' → '));

  // pack_only: the reviewed line has no field, and a host write to the paired slot does not take.
  const packOnlyCopy = await host.hasText(
    'This release does not accept a replacement for this section, so there is no field for it here.');
  check('28', 'pack_only declares itself in the editor and offers no editable field', packOnlyCopy);
  const draftPatch = await patchDraftSlot(host, weddingId, 'family_introduction',
    'A host attempt to replace reviewed wording.');
  check('28', 'the host can still write the paired draft slot (the row is theirs)',
    draftPatch.status >= 200 && draftPatch.status < 300,
    `HTTP ${draftPatch.status} ${mask(draftPatch.text).slice(0, 220)}`);
  const previewPackOnly = await previewAfter(host, async () => { await host.reload(); });
  const invitationSection = (sectionItems(previewPackOnly?.invitation) ?? [])
    .find((s) => s.section_key === 'invitation');
  check('28', 'the reviewed wording survives the host write',
    sectionBody(invitationSection) === B_INVITATION_R1
    && sectionSource(invitationSection) === 'reviewed_pack',
    JSON.stringify(invitationSection).slice(0, 260));
  const notPermitted = (previewPackOnly?.issues ?? [])
    .filter((i) => i.code === 'host_override_not_permitted');
  check('28', 'the server records the attempt as an advisory, not a blocker',
    notPermitted.length === 1 && notPermitted[0].blocking === false,
    JSON.stringify(notPermitted).slice(0, 200));

  // host_may_replace: the host's own words take over, and the credit moves with them.
  const replacedLine = 'Written by the family, in their own words.';
  await host.setByLabel(PROSE_LABELS.opening, replacedLine);

  // host_must_supply + the required lists, filled in the order the release asks for.
  const beforeClose = (await readPreview(host, { minCount: 1 })).issues
    .filter((i) => i.blocking).map((i) => i.code);
  check('28', 'the required closing line blocks while it is empty',
    beforeClose.includes('required_text_missing'), beforeClose.join(', '));
  await addPerson(host, { name: 'கந்தசாமி ரவிகுமார்', role: 'தந்தை', group: 'குடும்பம்' });
  await addVenue(host, { name: 'மணமக்கள் மண்டபம்', address: 'மதுரை',
    map: 'https://maps.example.test/venue' });
  const noVenueYet = await previewAfter(host, () => addCeremony(host, {
    name: 'Muhurtham', starts: '2026-11-14T07:30', timezone: 'Asia/Kolkata' }));
  check('28', 'requires_venue blocks an event with no venue',
    noVenueYet.issues.filter((i) => i.blocking).some((i) => i.code === 'event_venue_missing'),
    JSON.stringify(noVenueYet.issues.filter((i) => i.blocking).map((i) => i.code)));
  await host.pressButtonWhenReady('Save Draft');
  await host.waitForText('Saved');

  const closePreview = await previewAfter(host, async () => {
    await host.setByLabel(PROSE_LABELS.closing, 'முடிவு வരി — a closing line the host wrote.');
    await host.pressButtonWhenReady('Save Draft');
  });
  check('28', 'host_must_supply is satisfied once the host writes the line',
    !closePreview.issues.filter((i) => i.blocking).some((i) => i.code === 'required_text_missing'),
    JSON.stringify(closePreview.issues.filter((i) => i.blocking).map((i) => i.code)));

  // Give the event its venue through the row editor, then require a clean preview. A saved
  // ceremony row ids its venue select `<fieldId>-ceremony-<row id>-venue` and the add form uses
  // `<fieldId>-new-ceremony-venue` (`ContentEditor.tsx:566,620`), so the two are told apart by the
  // row id in the middle. `[id$="-ceremony-venue"]` matched neither and was measured (2026-10-01)
  // throwing "no ceremony row offered the venue to attach" on a page that plainly had one.
  const venueFixed = await previewAfter(host, async () => {
    const target = await host.evaluate(`(() => {
      const rows = [...document.querySelectorAll('select[id$="-venue"]')]
        .filter((s) => /-ceremony-/.test(s.id) && !/-new-ceremony-/.test(s.id));
      if (rows.length !== 1) return { error: 'matched ' + rows.length + ' saved ceremony rows' };
      const el = rows[0];
      const opt = [...el.options].find((o) => o.textContent.includes('மணமக்கள் மண்டபம்'));
      return opt ? { id: el.id, value: opt.value }
                 : { error: 'the venue is not among this row\\'s options: '
                     + [...el.options].map((o) => o.textContent.trim()).join('|').slice(0, 120) };
    })()`);
    if (target?.error) throw new Error(`the venue could not be attached: ${target.error}`);
    await host.setBySelector(`[id="${target.id}"]`, target.value);
    // Scoped to this row's own fieldset: every content row prints a "Save row", and the first one
    // in the document belongs to the person added two steps ago — never dirty, so never enabled.
    await host.pressButtonWhenReady('Save row', 25_000, `fieldset:has(select[id="${target.id}"])`);
  }, { label: 'the ceremony venue row save' }).catch(async (err) => {
    // A row write the adapter refuses never reaches the server and never refreshes the preview,
    // so the refusal the host can see and the HTTP status of the writes that did leave the page
    // are the two facts that tell a product failure from a harness expectation. Both are printed
    // here rather than left for the next reader to guess (measured 2026-10-01: this step threw
    // `Cannot read properties of null (reading 'issues')`, which named neither).
    const writes = (await host.networkLog())
      .filter((r) => r.status && carriesData(r) && /\/rest\/v1\/wedding_events\b/.test(r.url))
      .slice(-3)
      .map((r) => `${r.method} → HTTP ${r.status}`);
    const alert = await host.evaluate(`(() => {
      const a = document.querySelector('[role="alert"]');
      return a ? a.textContent.trim().slice(0, 140) : null;
    })()`);
    throw new Error(`${err.message} · wedding_events writes: ${writes.join(' | ') || 'none left the page'}`
      + ` · the editor's own alert: ${alert ?? 'none shown'}`);
  });
  const blockingNow = venueFixed.issues.filter((i) => i.blocking);
  check('28', 'the preview is complete: no blocking issue remains',
    blockingNow.length === 0, JSON.stringify(blockingNow.map((i) => i.code)).slice(0, 300));

  const froze = await pressOffered(host, 'Freeze this draft as a version');
  const frozenCopy = await host.waitForText('It cannot be edited.', 25_000);
  check('28', 'freeze succeeded through the UI once the server was satisfied',
    froze === 'pressed' && frozenCopy,
    `${froze}; ${await pressEvidence(host, 'create_invitation_version')}`);
  const published = await pressOffered(host, 'Publish');
  const liveCopy = await host.waitForText('Copy the address now', 25_000);
  check('28', 'publish succeeded', published === 'pressed' && liveCopy,
    `${published}; ${await pressEvidence(host, 'publish_invitation_version')}`);
  const token = (await host.bodyText()).match(/[A-Za-z0-9_-]{43}/)?.[0] ?? null;

  // Preview/freeze parity, read from the two payloads rather than from how they look.
  const previewFinal = await readPreview(host, { minCount: 1 });
  const { page: guest, drawn } = await guestPage(browser, token);
  check('28', 'the guest page renders', drawn);
  const { body: guestBody } = await guestPayload(guest);
  const guestInvitation = Array.isArray(guestBody) ? guestBody[0] : guestBody;
  const guestSections = sectionItems(guestInvitation?.invitation ?? guestInvitation);
  const previewSections = sectionItems(previewFinal.invitation);
  const sameOrder = JSON.stringify(guestSections?.map(sectionHeading))
    === JSON.stringify(previewSections?.map(sectionHeading));
  const sameBodies = JSON.stringify(guestSections?.map(sectionBody))
    === JSON.stringify(previewSections?.map(sectionBody));
  check('28', 'the guest document is the same canonical document the host previewed',
    Boolean(guestSections) && Boolean(previewSections) && sameOrder && sameBodies,
    `order ${sameOrder}, bodies ${sameBodies} · guest `
    + JSON.stringify(guestSections?.map(sectionHeading) ?? null).slice(0, 200)
    + ' / ' + JSON.stringify(guestSections?.map(sectionBody) ?? null).slice(0, 260)
    + ' · preview '
    + JSON.stringify(previewSections?.map(sectionHeading) ?? null).slice(0, 200)
    + ' / ' + JSON.stringify(previewSections?.map(sectionBody) ?? null).slice(0, 260));
  const fingerprint = await documentFingerprint(guest);
  check('28', 'the guest shows the host override where the host wrote one',
    fingerprint.text.includes(replacedLine) && !fingerprint.text.includes(B_LINE_R1));
  check('28', 'the guest shows the reviewed pack_only line',
    fingerprint.text.includes(B_INVITATION_R1));
  check('28', 'the English fallback line is drawn on a Tamil invitation',
    fingerprint.text.includes(B_INVITATION_R1) && (fingerprint.text.includes('அழைப்பு')
      || fingerprint.text.includes('The invitation')));
  const leaked = forbiddenKeysIn(guestBody);
  check('28', 'no reviewer metadata or provenance field reaches the guest payload',
    leaked.length === 0, leaked.join(', '));
  measure('28', 'structural keys the guest payload did carry',
    structuralKeysIn(guestBody).join(', ') || 'none');
  const guestStorage = await guest.privacyState();
  check('28', 'the guest context holds no auth state',
    guestStorage.local.length === 0 && guestStorage.session.length === 0);

  // What was actually frozen, read out of the snapshot the guest is being served from.
  const provenance = psqlRows(`
    select s ->> 'section_key' || ':' || coalesce(s ->> 'body_source','?')
           || ':' || coalesce((s ->> 'overrode_pack_text'),'?')
           || ':' || coalesce((s ->> 'body_fallback_used'),'?')
           || ':' || coalesce(s ->> 'body_language','?')
      from public.invitation_versions v, jsonb_array_elements(v.snapshot -> 'sections' -> 'items') s
     where v.wedding_id = '${weddingId}' and v.version_number = 1
     order by (s ->> 'position')::int`);
  measure('28', 'frozen provenance per section', provenance.join(' | '));
  const pinned = psqlValue(`select tradition_pack_release_id::text from public.invitation_versions
    where wedding_id = '${weddingId}' and version_number = 1`);
  check('28', 'V1 is pinned to the approved release', pinned === minted.releaseId, pinned);
  check('28', 'the host override is credited to the host, not to the pack',
    provenance.some((p) => p.startsWith('opening:host:true')), provenance.join(', '));
  check('28', 'the pack_only line keeps reviewed credit',
    provenance.some((p) => p.startsWith('invitation:reviewed_pack:false')
      || p.startsWith('invitation:reviewed_pack:')), provenance.join(', '));
  check('28', 'the fallback line records the language actually drawn',
    provenance.some((p) => p.startsWith('invitation:reviewed_pack')
      && p.endsWith('en') && p.includes(':true:')), provenance.join(', '));
  check('28', 'the closing line is credited to the host',
    provenance.some((p) => p.startsWith('closing:host')), provenance.join(', '));

  return { minted, weddingId, token, packKey: B_PACK_KEY, guestHash: fingerprint.hash };
}

/** A host write to one prose slot, through the same REST surface the app uses. The draft is *one*
 *  `content` jsonb column, not four text columns — `updateDraftContent` replaces the whole object —
 *  so a write has to read the row and send the other slots back with it. Sending a bare column name
 *  was measured (2026-10-01) to be refused as an unknown column (HTTP 400), which is a harness
 *  mistake rather than a product rule, and it is why the refusal body is kept as evidence here. */
async function patchDraftSlot(page, weddingId, slotKey, value) {
  const h = await page.rpcHeaders();
  if (!h?.authorization) throw new Error('no captured headers for the draft write');
  const base = { apikey: h.apikey, Authorization: h.authorization, Accept: 'application/json' };
  const read = await page.fetchFromPage(
    `${apiUrl}/rest/v1/invitation_drafts?wedding_id=eq.${weddingId}&select=content`,
    { method: 'GET', headers: base });
  if (read.status < 200 || read.status >= 300) {
    throw new Error(`the draft could not be read before writing it: HTTP ${read.status} `
      + mask(read.text).slice(0, 200));
  }
  const rows = JSON.parse(read.text);
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`the host should own exactly one draft row, saw ${rows?.length}`);
  }
  const content = { ...(rows[0].content ?? {}), [slotKey]: value };
  const written = await page.fetchFromPage(
    `${apiUrl}/rest/v1/invitation_drafts?wedding_id=eq.${weddingId}`, {
      method: 'PATCH',
      headers: {
        ...base,
        'Content-Type': 'application/json', Prefer: 'return=representation',
      },
      body: JSON.stringify({ content }),
    });
  return { status: written.status, text: written.text, content };
}

// --------------------------------------------------------------------- journey C (§29)

async function journeyC(browser, b) {
  console.log('\n==> §29 — journey C: retirement and R2, from journey B\'s wedding');
  const { minted, weddingId, token, packKey } = b;
  const { page: guest } = await guestPage(browser, token);
  const before = await documentFingerprint(guest);
  measure('29', 'V1 guest document', `${before.hash.slice(0, 12)} (${before.text.length} chars)`);

  const stillR1 = psqlValue(`select tradition_pack_release_id::text from public.weddings
    where id = '${weddingId}'`);
  check('29', 'the wedding still stands on R1 before any R2 exists',
    stillR1 === minted.releaseId, stillR1);

  const r2 = mintApprovedRelease({
    key: packKey, name: 'unused — R2 rides on the pack journey B created',
    packExists: true,
    openingEn: B_LINE_R1,
    invitationEn: 'TEST ONLY — release two changes this one line, and only this line.' });
  const r2Status = psqlValue(`select status from public.tradition_pack_releases where id = '${r2.releaseId}'`);
  check('29', 'R2 was created, reviewed and approved through the CLI',
    r2Status === 'approved', `status ${r2Status}`);

  const weddingAfterApproval = psqlValue(`select tradition_pack_release_id::text
    from public.weddings where id = '${weddingId}'`);
  check('29', 'approving R2 did not move the wedding',
    weddingAfterApproval === minted.releaseId, weddingAfterApproval);
  await revisitGuest(guest, token);
  const guestAfterR2 = await documentFingerprint(guest);
  check('29', 'a fresh visit still shows V1 on R1', guestAfterR2.hash === before.hash);

  cli('deprecate', '--release', minted.releaseId, '--yes');
  await revisitGuest(guest, token);
  const guestAfterDeprecation = await documentFingerprint(guest);
  check('29', 'a fresh visit to the existing link is byte-identical after R1 was deprecated',
    guestAfterDeprecation.hash === before.hash,
    `${before.hash.slice(0, 12)} → ${guestAfterDeprecation.hash.slice(0, 12)}`);

  const host = await signInExisting(browser, 's5b-host');
  await host.goto(`${PREVIEW_ORIGIN}/project/${weddingId}/edit`);
  await waitForTraditionPanel(host);
  await readPreview(host, { minCount: 1 });
  const notice = await host.waitForText('This invitation uses an older release', 25_000);
  check('29', 'the editor tells the host the invitation stands on an older release', notice);
  const freezeState = await host.buttonState('Freeze this draft as a version');
  check('29', 'the freeze button is withdrawn while the draft stands on the retired release',
    freezeState === 'disabled', freezeState);
  const refused = await rpcAsHost(host, 'create_invitation_version', { p_wedding_id: weddingId });
  check('29', 'the server refuses a new freeze from R1', refused.status >= 400, `HTTP ${refused.status}`);
  const versionsStill = psqlValue(`select count(*)::text from public.invitation_versions
    where wedding_id = '${weddingId}'`);
  check('29', 'the refusal created no version', versionsStill === '1', versionsStill);

  // The attribute value is quoted, and quoted *inside* the page's own string: a release id is a
  // uuid, so `[value=8fa8…]` is not a valid selector and `[value='8fa…']` written straight into a
  // template literal closes the string early. Measured 2026-10-01 as `SyntaxError: missing ) after
  // argument list` from the page — the same reason `pickRadio` concatenates this way.
  const newerOption = await host.evaluate(`(() => {
    const el = document.querySelector(
      'input[type=radio][name="tradition-pack-release"][value="' + ${JSON.stringify(r2.releaseId)} + '"]');
    return el ? { disabled: el.disabled, text: el.closest('label')?.innerText.trim().slice(0, 90) } : null;
  })()`);
  check('29', 'R2 is offered as an explicit choice, and only as a choice',
    Boolean(newerOption) && newerOption.disabled === false, JSON.stringify(newerOption));
  await host.pickRadio('tradition-pack-release', r2.releaseId);
  await host.waitForText('Chosen:', 25_000);
  const saved = await host.pressButtonWhenReady('Save Draft');
  await host.waitForText('Saved', 20_000);
  const weddingNow = psqlValue(`select tradition_pack_release_id::text from public.weddings
    where id = '${weddingId}'`);
  check('29', 'the wedding moved to R2 only after the host chose it',
    weddingNow === r2.releaseId, weddingNow);
  void saved;

  await revisitGuest(guest, token);
  const guestUnchanged = await documentFingerprint(guest);
  check('29', 'V1 and its link are untouched by the reselection',
    guestUnchanged.hash === before.hash);
  const previewNow = await readPreview(host, { minCount: 1 });
  check('29', 'the preview is complete on R2',
    previewNow.issues.filter((i) => i.blocking).length === 0,
    JSON.stringify(previewNow.issues.filter((i) => i.blocking).map((i) => i.code)).slice(0, 240));
  const froze = await pressOffered(host, 'Freeze this draft as a version');
  const frozenAgain = await host.waitForText('Version 2 is frozen', 25_000);
  check('29', 'V2 froze from R2', froze === 'pressed' && frozenAgain,
    `${froze}; ${await pressEvidence(host, 'create_invitation_version')}`);
  const pinnedV2 = psqlValue(`select tradition_pack_release_id::text from public.invitation_versions
    where wedding_id = '${weddingId}' and version_number = 2`);
  check('29', 'V2 is pinned to R2, not to the release it inherited',
    pinnedV2 === r2.releaseId, pinnedV2);

  await pressOffered(host, 'Publish');
  const publishedV2 = await host.waitForText('now shows this version', 25_000);
  check('29', 'V2 was published to the existing address', publishedV2);
  const visitsBefore = await resolveVisits(guest);
  await revisitGuest(guest, token);
  const guestV2 = await documentFingerprint(guest);
  check('29', 'the guest changed only now, and only by the one wording R2 carries',
    guestV2.hash !== before.hash
    && guestV2.text.includes('TEST ONLY — release two changes this one line')
    && !guestV2.text.includes(B_INVITATION_R1),
    `${before.hash.slice(0, 8)} → ${guestV2.hash.slice(0, 8)}, drawn from `
    + `${await resolveVisits(guest)} resolve responses (the visit before this one was `
    + `${visitsBefore})`);
  check('29', 'the host override the host wrote in journey B is still their own words',
    guestV2.text.includes('Written by the family, in their own words.'));
  const leakedC = NEVER_FOR_GUEST_WORDS.filter((n) => guestV2.text.toLowerCase().includes(n.toLowerCase()));
  check('29', 'the changed guest page still draws no review or provenance string',
    leakedC.length === 0, leakedC.join(', '));
  return { r2, beforeHash: before.hash, afterHash: guestV2.hash };
}

// --------------------------------------------------------------------- teardown

function ownedIds() {
  return `(select w.id from public.weddings w join auth.users u on u.id = w.owner_user_id
    where u.email like '%+${RUN_TAG}@example.test')`;
}
function ownedCounts() {
  const owners = ownedIds();
  return [['weddings', 'id'], ['invitation_versions', 'wedding_id'], ['publications', 'wedding_id'],
    ['invitation_drafts', 'wedding_id'], ['wedding_people', 'wedding_id'],
    ['venues', 'wedding_id'], ['wedding_events', 'wedding_id']]
    .map(([t, key]) => `${t}=${psqlValue(`select count(*)::text from public.${t} where ${key} in ${owners}`)}`)
    .join(' ');
}

async function teardown() {
  const owners = ownedIds();
  execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-c', `
      delete from private.access_tokens where wedding_id in ${owners};
      delete from public.publications where wedding_id in ${owners};
      delete from public.invitation_versions where wedding_id in ${owners};
      delete from public.wedding_events where wedding_id in ${owners};
      delete from public.wedding_people where wedding_id in ${owners};
      delete from public.venues where wedding_id in ${owners};
      delete from public.invitation_drafts where wedding_id in ${owners};
      delete from public.weddings where id in ${owners};
    `], { stdio: ['ignore', 'inherit', 'inherit'] });
  const svc = createClient(apiUrl, serviceKey, { auth: { persistSession: false } });
  const { data } = await svc.auth.admin.listUsers({ pageSize: 1000 });
  for (const user of data.users ?? []) {
    if (user.email?.endsWith(`+${RUN_TAG}@example.test`)) {
      const { error } = await svc.auth.admin.deleteUser(user.id);
      if (error) console.log(`  !! could not remove ${user.email}: ${error.message}`);
    }
  }
  const left = psqlValue(`select count(*)::text from auth.users
    where email like '%+${RUN_TAG}@example.test'`);
  check('cleanup', 'every account this run created is gone', left === '0', `left ${left}`);
  rmSync(SCRATCH, { recursive: true, force: true });
}

// --------------------------------------------------------------------- main

async function main() {
  console.log(`Stage 5 browser journeys · run tag ${RUN_TAG} · preview ${PREVIEW_ORIGIN}`);
  const index = await fetch(`${PREVIEW_ORIGIN}/`).catch(() => null);
  if (!index?.ok) throw new Error(`no production bundle at ${PREVIEW_ORIGIN} — run npm run build and npm run preview`);
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
  /** `.env` is the gitignored file that carries a *hosted* project URL, and a qualification clone
   *  that never touches a hosted project has no reason to hold one. Reading it unconditionally made
   *  this instrument die on `ENOENT` before any journey ran, so the same question is now answered
   *  twice: against `.env` when a reviewer's clone has one, and against the built bundle with a
   *  pattern that needs no credential to exist. The second answer is the stronger one — it refuses
   *  *any* hosted origin, not only the one this machine happens to declare. */
  let hostedUrl = null;
  try {
    hostedUrl = readFileSync(resolve(ROOT, '.env'), 'utf8')
      .match(/^VITE_SUPABASE_URL\s*=\s*"?(.+?)"?\s*$/m)?.[1];
  } catch {
    hostedUrl = null;
  }
  check('prelude', 'the shipped bundle calls the loopback target', bundleText.includes(browserApiUrl));
  measure('prelude', 'whether this clone declares a hosted project URL at all',
    hostedUrl ? 'a .env exists and declares one (value not printed)'
      : 'no .env in this clone — no hosted project URL is declared here');
  check('prelude', 'the hosted project URL .env declares is absent from the bundle',
    !hostedUrl || !bundleText.includes(hostedUrl), 'the hosted value is not printed here');
  const hostedOrigins = [
    ...new Set(bundleText.match(/https:\/\/[A-Za-z0-9._-]+\.supabase\.(?:co|in)(?=[\s"'`,:)?\]}]|$)/g) ?? []),
  ];
  check('prelude', 'no hosted Supabase origin of any shape is baked into the shipped bundle',
    hostedOrigins.length === 0,
    hostedOrigins.length ? `origins found (host names only): ${hostedOrigins.join(', ')}`
      : `scanned ${(bundleText.length / 1024).toFixed(0)} KB of shipped JS/CSS/HTML`);

  const browser = await openBrowser({ cdpPort: CDP_PORT });
  let outcome = null;
  /** A journey that throws is a finding, not a licence to stop reporting. Measured 2026-10-01
   *  (run 8): journey A's guest page never drew a document, the null fingerprint threw out of
   *  `main`, and §28 and §29 were silently never attempted — a report of three findings that
   *  quietly omitted two whole journeys. Each one is now run to its own end. */
  const runJourney = async (label, area, fn) => {
    try {
      return await fn();
    } catch (err) {
      check(area, `${label} could not be completed`, false, String(err?.message ?? err).slice(0, 300));
      return null;
    }
  };
  try {
    const a = wants('a') ? await runJourney('journey A', '27', () => journeyA(browser)) : null;
    const b = wants('b') ? await runJourney('journey B', '28', () => journeyB(browser)) : null;
    let c = null;
    if (wants('c')) {
      if (b === null) {
        check('29', 'journey C ran', false, 'journey B did not complete, and C is carried on '
          + "B's wedding, release and guest address");
      } else {
        c = await runJourney('journey C', '29', () => journeyC(browser, b));
      }
    }
    outcome = { a, b, c };
  } finally {
    await browser.close().catch(() => {});
    console.log(`\n==> rows owned by this run: ${ownedCounts()}`);
    await teardown();
    console.log(`==> catalogue residue left behind (the maintenance tool has no delete verb by `
      + 'design): '
      + `${psqlValue('select count(*)::text from public.tradition_pack_releases')} releases and `
      + `${psqlValue('select count(*)::text from public.tradition_packs')} packs in total, of which `
      + `${psqlValue(`select count(*)::text from public.tradition_pack_releases r
          join public.tradition_packs p on p.id = r.pack_id
          where p.pack_key like '${RUN_PACK_PREFIX}%'`)} releases and `
      + `${psqlValue(`select count(*)::text from public.tradition_packs
          where pack_key like '${RUN_PACK_PREFIX}%'`)} packs were minted by this run`);
  }

  const checks = results.filter((r) => !r.measured).length;
  console.log(`\n==> checks ${checks}, measurements `
    + `${results.filter((r) => r.measured).length}, findings ${failureCount}`);
  if (failureCount > 0) {
    console.log('FINDINGS:');
    for (const r of results.filter((x) => !x.ok)) console.log(`  - [${r.area}] ${r.name}: ${r.detail}`);
    process.exitCode = 1;
  } else {
    console.log('STAGE 5 BROWSER JOURNEYS: PASS');
    void outcome;
  }
}

await main();
