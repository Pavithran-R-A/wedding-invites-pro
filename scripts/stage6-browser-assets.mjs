#!/usr/bin/env node
// VIVAAHVARNAM — Stage 6 browser tier: the host asset panel, driven by clicks.
//
// Why this file exists. The Stage 6 SQL battery (`supabase/tests/stage6/80_asset_registry.sql`) proves
// the database refuses; the HTTP battery (`supabase/tests/api/stage6_storage.test.mjs`) proves the
// transport refuses; the unit tier proves the adapter's own gates fire. None of them proves the four
// things this tier is for: that a host can actually complete upload → list → preview → replace → remove
// in the shipped product, that a refusal reaches the host as the adapter's sentence rather than as a
// silent no-op, that the signed preview URL travels only where it is rendered, and that the 44 px press
// area `WeddingAssetsPanel.tsx` claims is 44 px *on screen*. `docs/audits/stage-6-storage-assets.md`
// §19.7 set the rule for this file — authored and executed in the same sitting, because an authored-but
// -never-run journey file is a confident claim about responses the stack may not send.
//
// Scope. Four journeys, in order, on one host page:
//   A  panel lifecycle — empty state, the five client-side refusals (each proved by "the alert said it"
//      *and* "no request left and no row appeared"), a real PNG upload read back against
//      `public.wedding_assets` and `storage.objects`, preview through a minted signed URL with the
//      served bytes compared to the fixture, an `audio/mpeg` upload previewed as `<audio>`, replace,
//      remove.
//   B  isolation — a second, unrelated host account cannot see, read, sign or download the first
//      wedding's object, through its own browser session and its own token.
//   C  network/privacy N1–N4, exactly as `q6-logs/s6-engine-runbook.md` §18 scopes them, including the
//      vacuity guards it names as mandatory.
//   D  the §33 accessibility re-measurement of the replace-target radio at the Stage 5 editor viewports.
//
// Deliberate properties:
//   * No new dependency: raw CDP through `stage5-browser-driver.mjs`, the only browser module in this
//     repository that exports anything.
//   * Nothing can reach a hosted project: both origins are checked for loopback before a page opens,
//     and `supabase/config.toml`'s `project_id` must be this repository's disposable stack.
//   * Every byte-gate refusal case is discriminated by *requests made* and *rows left behind*, not only
//     by an alert sentence — two of the five cases share one sentence, so text alone could pass a case
//     that never ran.
//   * Counts state their preflight convention (see §C's first two measurement lines): a Storage PUT or
//     DELETE through Kong also produces an `OPTIONS`, and the same journey would otherwise report two
//     different totals.
//   * Expired-signature behaviour is deliberately **not** claimed here. The 60 s TTL's refusal belongs
//     to the HTTP battery; this tier mints a preview and reads it while it is live.
//
// Usage:
//   npm run build
//   npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
//   node scripts/stage6-browser-assets.mjs              # all four journeys
//   node scripts/stage6-browser-assets.mjs --only=a     # one journey
//
// Exit code 1 means a finding was recorded, not that the harness broke; a harness failure throws.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { assertLoopback, openBrowser } from './stage5-browser-driver.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_ORIGIN = assertLoopback(
  process.env.STAGE6_PREVIEW_URL ?? 'http://127.0.0.1:4173', 'STAGE6_PREVIEW_URL');
const CDP_PORT = Number(process.env.STAGE6_CDP_PORT ?? 9441);
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

const originOf = (url) => { try { return new URL(url).origin; } catch { return ''; } };
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
// Stage 9 removed this tier's font-host allowset: the six pinned faces are served from this origin
// (`public/fonts/`), so an asset page has no legitimate destination outside the machine and any host
// classified UNCLASSIFIED below is a finding rather than a declared exception.
const API_ORIGIN = originOf(apiUrl);
const PREVIEW = originOf(PREVIEW_ORIGIN);

const RUN_TAG = `stage6ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}`;
const SCRATCH = join(tmpdir(), `stage6-ui-${RUN_TAG}`);
mkdirSync(SCRATCH, { recursive: true });
// Screenshots are evidence, and `teardown()` deletes SCRATCH; the evidence directory lives outside
// the repository so nothing a browser writes can be staged by an explicit-path commit.
const EVIDENCE_DIR = resolve(process.env.STAGE6_EVIDENCE_DIR ?? join(ROOT, '..', 'q6-logs'));
mkdirSync(EVIDENCE_DIR, { recursive: true });

// --------------------------------------------------------------------- reporting

const TOKEN_SHAPED = /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g;
const JWT_SHAPED = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
/** Values discovered *during* the run (a signed-URL token is not known when the file is written).
 *  Every one is redacted on the way out, and `loggedLines` holds the *unmasked* string of every line
 *  this tier printed, so N4's third assertion — "no line the tier writes carries the token" — is
 *  answered by scanning what was about to be printed rather than by trusting the mask. */
const DISCOVERED = [];
// The service-role key is known before this run starts, and invariant I10 says it must never reach a
// log this stage writes. Putting it in the redaction list up front means the mask does the work even
// if a future check echoes an error body that happens to carry it; the value is still hunted as a
// needle below, which is a different question from whether it gets printed.
if (typeof serviceKey === 'string' && serviceKey !== '') DISCOVERED.push(serviceKey);
const mask = (value) => {
  let out = String(value)
    .replace(TOKEN_SHAPED, (whole, lead) => `${lead}‹credential masked›`)
    .replace(JWT_SHAPED, '‹jwt masked›')
    .split(PASSWORD).join('‹password masked›')
    .split(emailFor('host')).join('‹host email masked›')
    .split(emailFor('other')).join('‹other email masked›');
  for (const secret of DISCOVERED) out = out.split(secret).join('‹discovered secret masked›');
  return out;
};

const loggedLines = [];
const results = [];
let failureCount = 0;

function check(area, name, ok, detail) {
  const raw = detail === undefined ? '' : String(detail);
  loggedLines.push(`${area} ${name} ${raw}`);
  const shown = raw === '' ? '' : mask(raw).slice(0, 400);
  results.push({ area, name, ok: Boolean(ok), detail: shown });
  if (!ok) failureCount += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} [${area}] ${name}${shown ? ` — ${shown}` : ''}`);
}
function measure(area, name, value) {
  loggedLines.push(`${area} ${name} ${String(value)}`);
  results.push({ area, name, ok: true, detail: mask(String(value)), measured: true });
  console.log(`  ..   [${area}] ${name} — ${mask(String(value))}`);
}

// --------------------------------------------------------------------- the stack

function psqlRows(query) {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', query], { encoding: 'utf8' })
    .split(/\r?\n/).filter((l) => l.length > 0);
}
const psqlValue = (query) => psqlRows(query)[0] ?? null;
function psqlExec(statement) {
  execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement], { stdio: ['ignore', 'inherit', 'inherit'] });
}

const assetRows = (weddingId) => psqlRows(`
  select id::text, asset_kind, object_key, coalesce(mime_type,'-'),
         coalesce(size_bytes::text,'-'), upload_status
  from public.wedding_assets where wedding_id = '${weddingId}'::uuid order by created_at, id`);
const objectRows = (weddingId) => psqlRows(`
  select o.name, coalesce(o.metadata->>'size','-'), coalesce(o.metadata->>'mimetype','-'),
         coalesce(o.owner_id,'-')
  from storage.objects o where o.bucket_id = 'wedding-assets'
    and o.name like 'weddings/${weddingId}/%' order by o.name`);

// --------------------------------------------------------------------- fixtures
//
// Real files on disk, because `DOM.setFileInputFiles` is the only way a page can be handed a genuine
// `File`, and a fixture whose own bytes disagree with the tier's expectation would silently turn a
// product verdict into a tautology. The PNG is the standard 1×1 image and is *verified below* rather
// than trusted: if its signature is not PNG, this tier has no right to report a byte-gate result.

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 5242880;

const writeFixture = (name, bytes) => {
  const path = join(SCRATCH, name);
  writeFileSync(path, bytes);
  return path;
};
const FIXTURES = {
  goodPng: { label: 'a-tested-photograph.png', path: writeFixture('a-tested-photograph.png', PNG_1PX) },
  jpegHeadClaimingPng: {
    label: 'jpeg-head-claiming-to-be-png.png',
    path: writeFixture('jpeg-head-claiming-to-be-png.png',
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(28, 0x20)])),
  },
  markupClaimingPng: {
    label: 'markup-claiming-to-be-png.png',
    path: writeFixture('markup-claiming-to-be-png.png',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>pwn</text></svg>', 'utf8')),
  },
  textPage: {
    label: 'a-text-page.html',
    path: writeFixture('a-text-page.html', Buffer.from('<html><body>not media</body></html>', 'utf8')),
  },
  emptyPng: { label: 'no-bytes.png', path: writeFixture('no-bytes.png', Buffer.alloc(0)) },
  tooLargePng: {
    label: 'larger-than-the-ceiling.png',
    path: writeFixture('larger-than-the-ceiling.png',
      Buffer.concat([PNG_MAGIC, Buffer.alloc(MAX_BYTES + 1 - PNG_MAGIC.length, 0)])),
  },
  mp3Clip: {
    label: 'a-music-clip.mp3',
    path: writeFixture('a-music-clip.mp3',
      Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.alloc(125, 0)])),
  },
};

// --------------------------------------------------------------------- copy the product must print
//
// Transcribed from `src/integrations/supabase/weddingAssets.ts:83-88` and the panel's own strings, not
// paraphrased: a tier that reworded a refusal would be asserting the harness's taste.

const SENTENCE = {
  empty: 'the file has no bytes in it',
  unsupported: 'the file is not one of the accepted types: a JPEG, PNG or WebP image, or an MP3',
  tooLarge: 'the file is larger than the 5 MB this invitation allows',
  wrongBytes: 'the file does not hold the bytes of the type it says it is, so nothing was uploaded',
  uploaded: 'Your file is uploaded.',
  replaced: 'The file was replaced. The one it was standing in for has been removed.',
  removed: 'That file is removed.',
  stored: 'Stored.',
  emptyList: 'You have not uploaded a file to this invitation yet.',
  noGuests: 'Your guests do not see them in this',
};
const PANEL = 'section[aria-labelledby="assets-heading"]';
const KIND_LABEL = 'What is this file for?';
const NAME_LABEL = 'Name this file';
const FILE_LABEL = 'Choose a file';

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

/** The panel's own alert line, scoped to the panel so another section's error cannot be read as this
 *  one's verdict. `textContent`, not `innerText`: a wrapped refusal sentence gains newline characters
 *  in the rendered text and would then not compare equal to the string in `SENTENCE`. */
const alertRead = (page) => page.evaluate(
  `[...document.querySelectorAll(${JSON.stringify(`${PANEL} [role=alert]`)})]
    .map((el) => el.textContent.trim().replace(/\\s+/g, ' ')).join(' || ') || null`);

/** Reads the alert after a press, and reports whether its text *changed* from what was on screen
 *  before. Two of the five refusal cases share one sentence, so for the second of them this cannot
 *  distinguish a fresh verdict from the previous one's element still standing — the case is then
 *  carried by the picker's own read-back plus "no request left, no row appeared", and that is what
 *  the returned `changed` flag tells the reader rather than hiding from them. */
async function panelAlert(page, previous) {
  const present = await page.waitForSelector(`${PANEL} [role=alert]`, 15_000);
  if (!present) return { text: null, changed: false };
  const deadline = Date.now() + 8_000;
  let text = await alertRead(page);
  for (;;) {
    if (text !== previous) break;
    if (Date.now() > deadline) break;
    await sleep(150);
    text = await alertRead(page);
  }
  return { text, changed: text !== previous };
}
const rowSel = (n, rest = '') => `${PANEL} ul > li:nth-child(${n})${rest}`;
const rowCount = (page) => page.evaluate(
  `document.querySelectorAll(${JSON.stringify(`${PANEL} ul > li`)}).length`);

/** What the host's session has asked the stack for, with the preflight convention stated rather than
 *  assumed. `PUT`/`DELETE` through Kong each arrive twice — once as `OPTIONS`, once as the verb — and
 *  a count that did not separate them could not tell "nothing happened" from "the preflight happened". */
async function requestCounts(page) {
  const log = await page.networkLog();
  const http = log.filter((r) => /^https?:/.test(r.url));
  return {
    all: http.length,
    options: http.filter((r) => r.method === 'OPTIONS').length,
    puts: http.filter((r) => r.method === 'PUT' && r.url.includes('/storage/v1/object/')).length,
    registers: http.filter((r) => r.method === 'POST' && r.url.includes('/rest/v1/wedding_assets')).length,
    signs: http.filter((r) => r.url.includes('/object/sign/')).length,
    storage: http.filter((r) => r.url.includes('/storage/v1/')).length,
  };
}

// --------------------------------------------------------------------- the UI flow (shared with Stage 5)

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
  const loginPressed = await fillAndSubmit(page, {
    '#email': emailFor(who),
    '#password': PASSWORD,
  }, 'Log in');
  const dash = await waitForUrl(page, '/dashboard');
  if (!dash) {
    throw new Error(`${who} could not reach the dashboard (login press ${loginPressed}): `
      + `${(await page.bodyText()).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  return page;
}

async function createWedding(page, { title, lang }) {
  await page.clickLink('Create Invitation');
  await page.waitForSelector('#title');
  await fillAndSubmit(page, { '#title': title, '#language': lang }, 'Create Invitation Draft');
  const url = await waitForUrl(page, '/configure');
  if (!url) throw new Error(`wedding creation did not reach the planning page: `
    + `${(await page.bodyText()).replace(/\s+/g, ' ').slice(0, 240)}`);
  const weddingId = /\/project\/([0-9a-f-]{36})\/configure/.exec(url)?.[1];
  if (!weddingId) throw new Error(`could not read the new wedding from ${mask(url)}`);
  await fillAndSubmit(page, { '#guests': '40' }, 'Save Draft');
  await page.waitForText('Saved');
  await page.clickLink('Open Invitation Editor');
  const edit = await waitForUrl(page, '/edit');
  if (!edit) throw new Error('the editor never opened from the planning page');
  return weddingId;
}

/** Hands the picker a fixture and returns what the input says it now holds. The read-back is the
 *  guard: an empty `type` would make the panel refuse for the *unsupported type* reason while the case
 *  was aiming at a different gate, and a silently-empty picker would make every refusal below pass. */
async function pickFile(page, fixture, { expectType }) {
  const held = await page.setFileByLabel(FILE_LABEL, fixture.path);
  if (held.count !== 1 || held.size === undefined) {
    throw new Error(`the picker reported ${JSON.stringify(held)} for ${fixture.label}`);
  }
  if (expectType !== undefined && held.type !== expectType) {
    throw new Error(`fixture ${fixture.label} arrived as "${held.type}", not "${expectType}" `
      + '— the browser, not the product, decided this case');
  }
  return held;
}

/** The panel's upload path as a host uses it: choose kind, name it, pick the file, press. Returns the
 *  button's own verdict so a disabled control is reported as the product's answer. */
async function tryUpload(page, { kind, name, fixture, expectType }) {
  await page.setByLabel(KIND_LABEL, kind);
  await page.setByLabel(NAME_LABEL, name);
  const held = await pickFile(page, fixture, { expectType });
  const readBackKind = await page.valueByLabel(KIND_LABEL);
  if (readBackKind?.value !== kind) {
    throw new Error(`the kind select kept "${readBackKind?.value}" after being set to "${kind}"`);
  }
  const press = await page.pressButtonWhenReady('Upload file', 25_000, PANEL);
  return { held, press };
}

// --------------------------------------------------------------------- journey A

async function journeyLifecycle(browser, state) {
  const host = await signUpAndEnterHost(browser, 'host');
  const weddingId = await createWedding(host, { title: 'Measured Wedding', lang: 'en' });
  state.host = host;
  state.weddingId = weddingId;
  state.hostId = psqlValue(`select id::text from auth.users where email = '${emailFor('host')}'`);

  const mounted = await host.waitForSelector('#assets-heading', 25_000);
  if (!mounted) {
    throw new Error('the assets panel never mounted in the editor at /edit — nothing downstream of '
      + 'this journey can be measured');
  }
  check('A:panel', 'the panel is a labelled section whose own heading names it',
    (await host.evaluate(`(() => {
      const sec = document.querySelector(${JSON.stringify(PANEL)});
      const labelId = sec?.getAttribute('aria-labelledby');
      return Boolean(labelId && sec?.querySelector('#' + labelId)?.textContent.trim() === 'Your files');
    })()`)) === true);
  const shownEmpty = await host.waitForText(SENTENCE.emptyList, 20_000);
  check('A:panel', 'a wedding with no files says so in the panel\'s own words', Boolean(shownEmpty),
    shownEmpty ? 'empty-state copy rendered' : (await host.bodyText()).replace(/\s+/g, ' ').slice(0, 200));
  // Read *after* the empty-state copy: `loaded` only becomes true when the list came back, so this is
  // the first moment at which "the read succeeded and said nothing was wrong" is a real claim.
  const mountAlert = await alertRead(host);
  check('A:panel', 'the first read of this wedding\'s files reported no error',
    mountAlert === null, mountAlert === null ? 'no alert line on a loaded, empty list'
      : `it said: ${mountAlert}`);
  const noGuests = await host.waitForText(SENTENCE.noGuests, 10_000);
  check('A:panel', 'the panel claims no guest delivery, as audit §7 rules this stage',
    Boolean(noGuests), noGuests ? 'guest-scope sentence rendered' : 'copy absent');

  const kinds = await host.evaluate(`(() => {
    const sel = document.getElementById('asset-kind');
    return sel ? [...sel.options].map((o) => o.value).join(',') : null;
  })()`);
  check('A:panel', 'the offered kinds are the four an uploader can mean, and not `generated_output`',
    kinds === 'photo,monogram,decorative,audio', `options read back: ${kinds}`);

  // ---- the five client-side refusals.
  const refusalCases = [
    { name: 'a file with no bytes', fixture: FIXTURES.emptyPng, expectType: 'image/png',
      sentence: SENTENCE.empty },
    { name: 'a type the bucket does not accept', fixture: FIXTURES.textPage, expectType: 'text/html',
      sentence: SENTENCE.unsupported },
    { name: 'a file above the 5 MiB ceiling', fixture: FIXTURES.tooLargePng,
      expectType: 'image/png', sentence: SENTENCE.tooLarge },
    { name: 'markup behind an image/png declaration', fixture: FIXTURES.markupClaimingPng,
      expectType: 'image/png', sentence: SENTENCE.wrongBytes },
    { name: 'a JPEG head behind an image/png declaration', fixture: FIXTURES.jpegHeadClaimingPng,
      expectType: 'image/png', sentence: SENTENCE.wrongBytes },
  ];
  let alertBefore = null;
  for (const [index, fixtureCase] of refusalCases.entries()) {
    const area = 'A:refusals';
    const before = await requestCounts(host);
    const objectsBefore = (await objectRows(weddingId)).length;
    const { held, press } = await tryUpload(host, {
      kind: 'photo', name: `refusal ${index + 1}`, fixture: fixtureCase.fixture,
      expectType: fixtureCase.expectType,
    });
    check(area, `${fixtureCase.name}: the upload button was offered once a file was held`,
      press === 'pressed', press);
    const { text: alert, changed } = await panelAlert(host, alertBefore);
    alertBefore = alert;
    check(area, `${fixtureCase.name}: the panel prints the adapter's own refusal`,
      typeof alert === 'string' && alert.includes(fixtureCase.sentence),
      alert === null ? 'no alert appeared at all' : `alert said: ${alert}`);
    measure(area, `${fixtureCase.name}: whether the alert line re-rendered for this case`,
      changed ? 'the text changed from the previous case, so this press produced this verdict'
        : 'identical to the previous case\'s text, so this case is carried by the picker read-back '
          + 'and by "no request, no row" rather than by its sentence');
    await sleep(600);
    const after = await requestCounts(host);
    const rowsAfter = await assetRows(weddingId);
    const objectsAfter = await objectRows(weddingId);
    // A case with no traffic would also pass if the harness had sent nothing at all, so the claim is
    // carried by the input's own read-back printed beside it.
    check(area, `${fixtureCase.name}: nothing was registered and no bytes were stored`,
      after.puts === before.puts && after.registers === before.registers
        && rowsAfter.length === 0 && objectsAfter.length === 0,
      `PUTs ${before.puts}→${after.puts}, register POSTs ${before.registers}→${after.registers}, `
        + `rows ${rowsAfter.length}, objects ${objectsBefore}→${objectsAfter.length}; `
        + `the picker held ${held.name} (${held.size} B, ${held.type || 'no declared type'})`);
    const domRows = await rowCount(host);
    check(area, `${fixtureCase.name}: the panel still lists no row`, domRows === 0, `rows drawn ${domRows}`);
  }

  // ---- a real upload, read back against both registries.
  const area = 'A:upload';
  const label = 'A tested photograph';
  const before = await requestCounts(host);
  const { held } = await tryUpload(host, {
    kind: 'photo', name: label, fixture: FIXTURES.goodPng, expectType: 'image/png',
  });
  const said = await host.waitForText(SENTENCE.uploaded, 30_000);
  check(area, 'a genuine PNG is accepted and the panel says so in its own words', Boolean(said),
    said ? 'success copy rendered' : `alert: ${await alertRead(host)}`);
  const listed = await host.waitForText(label, 25_000);
  check(area, 'the new row is drawn with the name the host typed', Boolean(listed), `rows drawn ${await rowCount(host)}`);
  const sizeWords = `${held.size} bytes`;
  check(area, 'the row prints the size the file actually had',
    Boolean(await host.waitForText(sizeWords, 10_000)), `expected "${sizeWords}"`);
  check(area, 'the row reports the stored state, not a promise',
    Boolean(await host.waitForText(SENTENCE.stored, 15_000)));

  const rows = await assetRows(weddingId);
  check(area, 'exactly one registry row exists for this wedding', rows.length === 1,
    rows.map((r) => r.split('|')[1]).join(', '));
  const [rowId, rowKind, rowKey, rowMime, rowSize, rowStatus] = rows[0].split('|');
  check(area, 'the database minted the key from the row id, not from anything the browser sent',
    rowKey === `weddings/${weddingId}/${rowKind}/${rowId}`, `minted key ${rowKey}`);
  check(area, 'the confirmation edge reached `ready`, so the claims matched the object',
    rowStatus === 'ready', `upload_status ${rowStatus}`);
  check(area, 'the row carries the type and size the file had',
    rowMime === 'image/png' && rowSize === String(held.size), `${rowMime} / ${rowSize} B`);
  const objects = await objectRows(weddingId);
  check(area, 'one storage object exists and it is the minted key',
    objects.length === 1 && objects[0].split('|')[0] === rowKey,
    objects.map((o) => o.split('|')[0]).join(', ') || 'no object found');
  const [objectName, objectMetaSize, objectMetaMime, objectOwner] = objects[0].split('|');
  check(area, 'the object\'s own record agrees with the row about size and type',
    objectMetaSize === String(held.size) && objectMetaMime === 'image/png',
    `metadata size ${objectMetaSize}, metadata mimetype ${objectMetaMime}`);
  check(area, 'the object is owned by the account that uploaded it',
    objectOwner === state.hostId, `owner_id ${objectOwner.slice(0, 8)}… (not printed in full)`);
  const after = await requestCounts(host);
  measure(area, 'requests this upload cost (PUTs excluding OPTIONS preflights)',
    `${before.puts}→${after.puts} PUT, ${before.registers}→${after.registers} register POST, `
    + `${before.storage}→${after.storage} storage-path requests`);

  // ---- preview, with the served bytes compared to the fixture.
  const pArea = 'A:preview';
  const pressedPreview = await host.pressButtonWhenReady('Preview', 25_000, rowSel(1));
  check(pArea, 'Preview is offered for a ready image row', pressedPreview === 'pressed', pressedPreview);
  const srcReady = await host.waitForSelector(`${rowSel(1)} img`, 25_000);
  if (!srcReady) throw new Error('no <img> appeared after Preview was pressed');
  const previewSrc = await host.evaluate(
    `document.querySelector(${JSON.stringify(`${rowSel(1)} img`)}).src`);
  const signed = new URL(previewSrc);
  check(pArea, 'the preview is a signed path under this bucket, not the public one',
    signed.pathname.startsWith('/storage/v1/object/sign/wedding-assets/'), `path ${signed.pathname}`);
  const expectedPath = `/storage/v1/object/sign/wedding-assets/${rowKey}`;
  check(pArea, 'the signed URL points at the key the database minted',
    decodeURIComponent(signed.pathname) === expectedPath,
    `path ${signed.pathname}, expected ${expectedPath}`);
  const token = signed.searchParams.get('token');
  check(pArea, 'a token is present on the minted link (so the N4 hunt below has a live needle)',
    typeof token === 'string' && token.length > 20, `token length ${token?.length ?? 0}`);
  // Only a real value enters the redaction list: an empty string would make `split('')` chop every
  // later line into single characters.
  if (typeof token === 'string' && token.length > 20) {
    DISCOVERED.push(token);
    state.signedToken = token;
  }
  const alt = await host.evaluate(
    `document.querySelector(${JSON.stringify(`${rowSel(1)} img`)}).alt`);
  check(pArea, 'the preview carries an alt text built from the host\'s own words',
    typeof alt === 'string' && alt.includes('photograph'), `alt "${alt}"`);
  const served = await host.evaluate(`(async () => {
    const res = await fetch(${JSON.stringify(previewSrc)}, { cache: 'no-store' });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, length: buf.length, head: [...buf.slice(0, 8)] };
  })()`);
  check(pArea, 'the bytes behind the signed link are the bytes the host uploaded',
    served.status === 200 && served.length === held.size
      && served.head.join(',') === [...PNG_MAGIC].join(','),
    `HTTP ${served.status}, ${served.length} of ${held.size} bytes, head ${served.head.join(',')}`);
  const previewCaption = await host.waitForText('A short-lived link, for you alone', 10_000);
  check(pArea, 'the panel tells the host the link is short-lived and theirs alone',
    Boolean(previewCaption));

  // ---- the audio class, which is the other branch of `inlineMedia`.
  const aArea = 'A:audio';
  await tryUpload(host, {
    kind: 'audio', name: 'A music clip', fixture: FIXTURES.mp3Clip, expectType: 'audio/mpeg',
  });
  const twoRows = await host.waitForText('A music clip', 30_000);
  check(aArea, 'an audio/mpeg file with an ID3 head is accepted as its own row', Boolean(twoRows),
    `rows drawn ${await rowCount(host)}`);
  const audioRows = await assetRows(weddingId);
  check(aArea, 'two registry rows now exist, one per kind',
    audioRows.length === 2 && audioRows.some((r) => r.split('|')[1] === 'audio'),
    audioRows.map((r) => `${r.split('|')[1]}:${r.split('|')[5]}`).join(', '));
  const audioIndex = audioRows.findIndex((r) => r.split('|')[1] === 'audio') + 1;
  const pressedAudio = await host.pressButtonWhenReady('Preview', 25_000, rowSel(audioIndex));
  check(aArea, 'Preview is offered for a ready audio row', pressedAudio === 'pressed', pressedAudio);
  const audioTag = await host.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(`${rowSel(audioIndex)} audio`)});
    return el ? { src: el.src, controls: el.hasAttribute('controls') } : null;
  })()`);
  check(aArea, 'the audio row draws an <audio controls>, not a broken image',
    audioTag !== null && audioTag.controls
      && audioTag.src.includes('/storage/v1/object/sign/wedding-assets/'),
    audioTag === null ? 'no <audio> element' : `src path ${new URL(audioTag.src).pathname}`);
  const mediaCount = await host.evaluate(`document.querySelectorAll(${
    JSON.stringify(`${PANEL} img, ${PANEL} audio`)}).length`);
  check(aArea, 'only one preview is on screen at a time, as the panel claims', mediaCount === 1,
    `media elements in the panel: ${mediaCount}`);

  // ---- replace.
  const rArea = 'A:replace';
  const photoKeyBefore = audioRows.find((r) => r.split('|')[1] === 'photo').split('|')[2];
  const photoIndex = audioRows.findIndex((r) => r.split('|')[1] === 'photo') + 1;
  await host.clickSelector(rowSel(photoIndex, ' input[type=radio]'));
  const radioOn = await host.evaluate(
    `document.querySelector(${JSON.stringify(rowSel(photoIndex, ' input[type=radio]'))}).checked`);
  check(rArea, 'the round button on the photo row answers to a press', radioOn === true, `checked ${radioOn}`);
  const replacing = await host.waitForText('Replacing A photograph', 15_000);
  check(rArea, 'the panel names the row the new file will stand in for', Boolean(replacing));
  await host.setByLabel(KIND_LABEL, 'photo');
  await host.setByLabel(NAME_LABEL, 'The replaced photograph');
  const replacement = await pickFile(host, FIXTURES.goodPng, { expectType: 'image/png' });
  const pressedReplace = await host.pressButtonWhenReady('Replace the chosen file', 25_000, PANEL);
  check(rArea, 'the replace button is offered once a target and a file are both chosen',
    pressedReplace === 'pressed', pressedReplace);
  const replacedCopy = await host.waitForText(SENTENCE.replaced, 40_000);
  check(rArea, 'the panel reports the replacement and the removal of what it stood in for',
    Boolean(replacedCopy), replacedCopy ? 'success copy rendered' : `alert: ${await alertRead(host)}`);
  const afterReplace = await assetRows(weddingId);
  check(rArea, 'a replacement leaves one row where the replaced one was, not two',
    afterReplace.length === 2, afterReplace.map((r) => r.split('|')[1]).join(', '));
  check(rArea, 'the replaced row is gone from the registry',
    !afterReplace.some((r) => r.split('|')[2] === photoKeyBefore), `key ${photoKeyBefore}`);
  check(rArea, 'the new row carries a freshly minted key of the same grammar',
    afterReplace.some((r) => r.split('|')[1] === 'photo'
      && r.split('|')[2].startsWith(`weddings/${weddingId}/photo/`)
      && r.split('|')[2] !== photoKeyBefore),
    afterReplace.filter((r) => r.split('|')[1] === 'photo').map((r) => r.split('|')[2]).join(', '));
  const objectsAfterReplace = await objectRows(weddingId);
  check(rArea, 'the replaced object\'s bytes are gone and the new ones are present',
    objectsAfterReplace.length === 2
      && !objectsAfterReplace.some((o) => o.split('|')[0] === photoKeyBefore),
    `${objectsAfterReplace.length} objects: ${objectsAfterReplace.map((o) => o.split('|')[0].split('/').pop()).join(', ')}`);
  check(rArea, 'the new row\'s claims match its own object',
    afterReplace.filter((r) => r.split('|')[1] === 'photo').every((r) => {
      const [, , key, , size, status] = r.split('|');
      const object = objectsAfterReplace.find((o) => o.split('|')[0] === key);
      return status === 'ready' && object !== undefined && object.split('|')[1] === size;
    }), `replacement file was ${replacement.size} B`);

  // ---- remove (the audio class is removable too, which is the point of aiming at that row).
  const dArea = 'A:remove';
  const audioKey = afterReplace.find((r) => r.split('|')[1] === 'audio').split('|')[2];
  const remainingAudioIndex = afterReplace.findIndex((r) => r.split('|')[1] === 'audio') + 1;
  const pressedRemove = await host.pressButtonWhenReady('Remove', 25_000,
    rowSel(remainingAudioIndex));
  check(dArea, 'Remove is offered on the audio row', pressedRemove === 'pressed', pressedRemove);
  const removedCopy = await host.waitForText(SENTENCE.removed, 30_000);
  check(dArea, 'the panel reports the removal in its own words', Boolean(removedCopy),
    removedCopy ? 'success copy rendered' : `alert: ${await alertRead(host)}`);
  const afterRemove = await assetRows(weddingId);
  check(dArea, 'the audio row is gone from the registry', afterRemove.length === 1
    && !afterRemove.some((r) => r.split('|')[2] === audioKey),
    `${afterRemove.length} row(s) left`);
  const objectsAfterRemove = await objectRows(weddingId);
  check(dArea, 'its bytes are gone from storage, so no orphan object was left behind',
    !objectsAfterRemove.some((o) => o.split('|')[0] === audioKey),
    `${objectsAfterRemove.length} object(s) left for this wedding`);
  check(dArea, 'the delete guard was satisfied by the adapter\'s order, not by a forced delete',
    psqlValue(`select count(*)::text from public.wedding_assets
      where wedding_id = '${weddingId}'::uuid and upload_status <> 'ready'`) === '0',
    'every surviving row is still `ready`');

  state.photoKey = afterRemove[0].split('|')[2];
  state.photoId = afterRemove[0].split('|')[0];
  state.rowsAfterA = afterRemove;
  return { rowsAfter: afterRemove.length, objectsAfter: objectsAfterRemove.length };
}

// --------------------------------------------------------------------- journey B

/** A second, unrelated account against the first wedding's live object. Every call here is made from
 *  inside host-2's own page with host-2's own token, so the verdict is the server's answer to a real
 *  authenticated principal rather than to a hand-assembled header set. */
async function journeyIsolation(browser, state) {
  const area = 'B:isolation';
  const other = await signUpAndEnterHost(browser, 'other');
  const bearer = await other.authHeader();
  if (!bearer) throw new Error('host-2 has no session token to test with');
  if (typeof state.photoKey !== 'string' || state.photoKey === '') {
    check(area, 'journey B has a real object key to probe', false,
      'journey A never reached a ready row, so every probe below would have asked the API for the '
      + 'string "undefined" and a refusal would have proved nothing');
    return { other };
  }
  const headers = { apikey: anonKey, Authorization: `Bearer ${bearer}` };

  await other.goto(`${PREVIEW_ORIGIN}/project/${state.weddingId}/edit`);
  const mounted = await other.waitForSelector('#assets-heading', 12_000);
  const pageText = (await other.bodyText()).replace(/\s+/g, ' ');
  measure(area, 'whether the panel even mounted for a stranger',
    mounted ? 'it did — so the read path is what must refuse' : 'it did not (the project page refused first)');
  check(area, 'a stranger\'s page never lists another wedding\'s file',
    !pageText.includes('The replaced photograph'), `page said: ${pageText.slice(0, 200)}`);
  check(area, 'a stranger\'s page names no object key',
    !pageText.includes('weddings/'), 'no key-shaped string in the rendered text');
  check(area, 'a stranger\'s page mints no preview link',
    !(await other.networkLog()).some((r) => r.url.includes('/object/sign/') && r.status === 200),
    'no successful sign request on host-2\'s session');

  const read = await other.fetchFromPage(
    `${apiUrl}/rest/v1/wedding_assets?select=id,object_key&wedding_id=eq.${state.weddingId}`,
    { method: 'GET', headers: { ...headers, Accept: 'application/json' } });
  check(area, 'a REST read for that wedding returns nothing to a non-owner',
    read.status === 200 && read.text.trim() === '[]', `HTTP ${read.status}, body ${read.text.slice(0, 80)}`);

  const direct = await other.fetchFromPage(
    `${apiUrl}/storage/v1/object/wedding-assets/${state.photoKey}`,
    { method: 'GET', headers });
  check(area, 'a direct object read by the exact minted key is refused',
    direct.status !== 200, `HTTP ${direct.status}, body ${direct.text.slice(0, 80)}`);

  const signing = await other.fetchFromPage(
    `${apiUrl}/storage/v1/object/sign/wedding-assets/${state.photoKey}`,
    { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 60 }) });
  check(area, 'a non-owner cannot mint a signed URL for that key',
    signing.status !== 200, `HTTP ${signing.status}, body ${signing.text.slice(0, 80)}`);

  const insert = await other.fetchFromPage(`${apiUrl}/rest/v1/wedding_assets`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      wedding_id: state.weddingId, asset_kind: 'photo', label: 'intruder',
      mime_type: 'image/png', size_bytes: PNG_1PX.length,
    }),
  });
  // PostgREST answers a refused write with an error body, and a granted one with a created
  // representation. Counting the rows that came back is the claim; the status code alone would let a
  // 201-with-empty-array read as a refusal. `assetRows` deliberately does not select `label`, so the
  // ground truth for the planted label is a separate query rather than a scan of that projection.
  const insertedRows = (() => {
    try {
      const parsed = JSON.parse(insert.text);
      return Array.isArray(parsed) ? parsed.length : null;
    } catch {
      return null;
    }
  })();
  check(area, 'a non-owner cannot register a row against another wedding',
    insertedRows !== 1,
    `HTTP ${insert.status}; ${insertedRows === null ? 'no row list in the reply'
      : `${insertedRows} row(s) in the representation`}; body ${insert.text.slice(0, 120)}`);
  const planted = psqlValue(`select count(*)::text from public.wedding_assets
    where label = 'intruder'`);
  const rowsNow = await assetRows(state.weddingId);
  check(area, 'the owner\'s registry is exactly as the first journey left it',
    planted === '0' && rowsNow.length === state.rowsAfterA.length,
    `${rowsNow.length} row(s) belong to the wedding now; ${planted} row(s) anywhere carry the 'intruder' label`);

  // The bytes must still be there for the owner, or the isolation journey proved nothing about a live
  // object. This is also journey C's needle refresh, so `state.photoKey` is read while it has content.
  const ownerBearer = await state.host.authHeader();
  const ownerRead = await state.host.fetchFromPage(
    `${apiUrl}/storage/v1/object/wedding-assets/${state.photoKey}`,
    { method: 'GET', headers: { apikey: anonKey, Authorization: `Bearer ${ownerBearer}` } });
  check(area, 'the same object is still readable by its owner (so the refusals above were not a dead bucket)',
    ownerRead.status === 200, `owner read HTTP ${ownerRead.status}`);
  return { other };
}

// --------------------------------------------------------------------- journey C (N1–N4)

const headerGet = (headers, name) => {
  const key = Object.keys(headers ?? {}).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? null : headers[key];
};

/** Copied from `scripts/stage5-network-privacy.mjs:288-334`, which is module-private there. It is
 *  carried here rather than imported because Stage 6 is the tier that *has* a signed-URL token to
 *  hunt: §18's N4 fix is live in the instrument that mints the credential, and adding an always-inert
 *  needle to the Stage 5 pass would be dead code that reads like coverage. */
function hunt(requests, needles) {
  const active = Object.entries(needles).filter(([, v]) => typeof v === 'string' && v !== '');
  const hits = [];
  for (const r of requests) {
    const where = [['url', r.url], ...Object.entries(r.headers ?? {})];
    for (const [needleName, needle] of active) {
      for (const [field, value] of where) {
        if (String(value).includes(needle)) {
          hits.push({ needleName, field, origin: originOf(r.url), host: hostOf(r.url),
            path: new URL(r.url).pathname, url: r.url });
        }
      }
    }
  }
  return hits;
}
function travelReport(area, label, requests, needles, allowed) {
  const hits = hunt(requests, needles);
  const thirdParty = hits.filter((h) => !LOOPBACK_HOSTS.has(h.host));
  const unexpected = hits.filter((h) => {
    const set = allowed[h.needleName];
    if (!set) return true;
    // CDP hands back header names with whatever casing the requester used — this stack produced both
    // `authorization` and `Authorization` for the same field in one run — so the declared field set is
    // matched case-insensitively, the way `headerGet` already matches. Comparing raw strings would
    // score a declared, loopback-only header as undeclared travel.
    return !set.some((a) => (a.origin === undefined || a.origin === h.origin)
      && (a.pathIncludes === undefined || h.url.includes(a.pathIncludes))
      && (a.pathPrefix === undefined || h.path.startsWith(a.pathPrefix))
      && (a.fields === undefined || a.fields.map((f) => f.toLowerCase()).includes(h.field.toLowerCase())));
  });
  const tally = hits.map((h) => `${h.needleName}@${h.origin === API_ORIGIN ? 'local-api'
    : h.origin === PREVIEW ? 'preview' : h.host}:${h.field}`);
  measure(area, `${label} · where each secret was actually seen`,
    tally.length === 0 ? 'nowhere' : [...new Set(tally)].join(', '));
  check(area, `${label}: no secret of this pass reaches any third-party destination`,
    thirdParty.length === 0,
    thirdParty.map((h) => `${h.needleName} at ${h.origin}${h.path} (${h.field})`).join(' | ')
      || 'nothing reached a host outside this machine');
  check(area, `${label}: each secret travels only to the places this pass declares`,
    unexpected.length === 0,
    unexpected.map((h) => `${h.needleName} at ${h.origin}${h.path} (${h.field})`).join(' | ')
      || 'travel matches the declared set');
  return { hits, thirdParty, unexpected };
}

async function journeyNetwork(browser, state) {
  const area = 'C:network';
  const page = state.host;
  // Re-mint a preview inside this journey so the needle is live at the moment of the hunt, and so a
  // stale preview from journey A can never make N4's DOM scan vacuously pass.
  await page.pressButtonWhenReady('Preview', 25_000, rowSel(1));
  const liveSrc = await page.evaluate(`document.querySelector(${
    JSON.stringify(`${rowSel(1)} img`)}).src`);
  const freshToken = new URL(liveSrc).searchParams.get('token');
  if (!freshToken) throw new Error('no signed URL could be minted for the hunt');
  if (state.signedToken !== freshToken) {
    // The redaction list holds every token this run has minted, not just the newest one — an early
    // preview's token is still a live-looking credential in a log line, and a TTL of 60s means the
    // old one can outlive the run that wrote it.
    if (typeof state.signedToken === 'string' && state.signedToken !== '') DISCOVERED.push(state.signedToken);
    DISCOVERED.push(freshToken);
    state.signedToken = freshToken;
  }

  const log = await page.networkLog();
  const http = log.filter((r) => /^https?:/.test(r.url));
  const inPage = log.filter((r) => !/^https?:/.test(r.url));
  const nonOpt = http.filter((r) => r.method !== 'OPTIONS');
  measure(area, 'request-count convention',
    `${http.length} http(s) entries, of which ${http.length - nonOpt.length} are OPTIONS preflights; `
    + 'origin tallies count every entry, media/auth assertions use non-OPTIONS only');

  const tally = new Map();
  for (const r of http) {
    const o = originOf(r.url);
    tally.set(o, (tally.get(o) ?? 0) + 1);
  }
  for (const [o, count] of [...tally].sort()) {
    const kind = o === PREVIEW ? 'LOCAL PREVIEW (the production bundle)'
      : o === API_ORIGIN ? 'LOCAL API (this repository\'s own stack)'
        : 'UNCLASSIFIED';
    measure(area, `${o} — ${count} request(s)`, kind);
  }
  const foreign = [...tally.keys()].filter((o) => !LOOPBACK_HOSTS.has(hostOf(o)));
  check(area, 'N1: no destination outside loopback was contacted',
    foreign.length === 0, foreign.join(', ') || 'every origin seen is accounted for above');
  const storageSeen = http.filter((r) => r.url.includes('/storage/v1/'));
  check(area, 'N1 vacuity: the tally is non-empty and holds at least one /storage/v1/ request',
    http.length > 0 && storageSeen.length > 0,
    `${http.length} http request(s), ${storageSeen.length} of them on the storage path`);
  check(area, 'N1: every scheme this page used is http(s) or an in-page one',
    inPage.every((r) => /^(data|blob|about):/.test(r.url)),
    inPage.length ? `${inPage.length} in-page entr(ies): `
      + [...new Set(inPage.map((r) => r.url.slice(0, 24)))].join(', ') : 'none');

  const bearer = await page.authHeader();
  const needles = {
    bearer, apiKey: anonKey, signedToken: state.signedToken, serviceKey,
    password: PASSWORD, hostEmail: emailFor('host'),
  };
  const allowed = {
    bearer: [{ origin: API_ORIGIN, fields: ['authorization'] }],
    // The publishable key is public by design — the prelude above proves it ships inside `dist/` — and
    // supabase-js puts it in `Authorization: Bearer <publishable>` on the calls made before a session
    // exists (signup, token exchange), as well as in `apikey`. Both go only to the local API.
    apiKey: [{ origin: API_ORIGIN, fields: ['apikey', 'authorization'] }],
    signedToken: [{ origin: API_ORIGIN, pathIncludes: '/object/sign/', fields: ['url'] }],
    serviceKey: [], password: [], hostEmail: [],
  };

  const authed = nonOpt.filter((r) => headerGet(r.headers, 'authorization') !== null);
  const misplacedAuth = authed.filter((r) => originOf(r.url) !== API_ORIGIN);
  check(area, 'N2: every request that carried an authorization header went only to the local API',
    misplacedAuth.length === 0,
    misplacedAuth.map((r) => `${r.method} ${originOf(r.url)}${new URL(r.url).pathname}`).join(' | ')
      || `${authed.length} authorized request(s), all to ${API_ORIGIN}`);
  const mediaReqs = nonOpt.filter((r) => originOf(r.url) === API_ORIGIN
    && ['Image', 'Media'].includes(r.type) && r.url.includes('/storage/v1/object/'));
  check(area, 'N2 vacuity: at least one Image/Media-typed request reached the local API',
    mediaReqs.length > 0,
    `types seen on the storage path: ${[...new Set(storageSeen.filter((r) => r.method !== 'OPTIONS')
      .map((r) => r.type))].join(', ') || 'none'}`);
  const signedReqs = mediaReqs.filter((r) => r.url.includes('/object/sign/'));
  check(area, 'N2: the preview media GET itself carried no authorization header',
    signedReqs.length > 0 && signedReqs.every((r) => headerGet(r.headers, 'authorization') === null),
    `${signedReqs.length} signed media GET(s); credentials on them would make the link a copyable `
      + 'session rather than a short-lived one');

  const publicPath = http.filter((r) => r.url.includes('/object/public/'));
  check(area, 'N3: no object was ever read through the public bucket path',
    publicPath.length === 0, `${publicPath.length} request(s) on /object/public/`);
  check(area, 'N3 positive sibling: /object/sign/ appears at least once, so the refusal above was measured',
    http.filter((r) => r.url.includes('/object/sign/')).length >= 1,
    `${http.filter((r) => r.url.includes('/object/sign/')).length} signed-path request(s) seen`);

  travelReport(area, 'the host session', nonOpt, needles, allowed);

  const domScan = await page.evaluate(`(() => {
    const token = ${JSON.stringify(state.signedToken)};
    const textNodes = [];
    const walk = document.createTreeWalker(document.body, window.NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeValue && n.nodeValue.includes(token)) textNodes.push(n.parentElement?.tagName ?? '?');
    }
    return {
      inBodyText: document.body.innerText.includes(token),
      textNodes,
      inHref: [...document.querySelectorAll('a[href]')].filter((a) => a.href.includes(token)).length,
      inInputValue: [...document.querySelectorAll('input,textarea,select')]
        .filter((el) => String(el.value).includes(token)).length,
      inStatusOrAlert: [...document.querySelectorAll('[role=status],[role=alert],[aria-live]')]
        .filter((el) => el.textContent.includes(token)).length,
      inMediaSrc: [...document.querySelectorAll('img[src],audio[src]')]
        .filter((el) => el.getAttribute('src').includes(token)).length,
      inLocalStorage: Object.keys(window.localStorage).filter(
        (k) => String(window.localStorage.getItem(k)).includes(token)).length,
      inSessionStorage: Object.keys(window.sessionStorage).filter(
        (k) => String(window.sessionStorage.getItem(k)).includes(token)).length,
      inCookie: document.cookie.includes(token),
      referrerMeta: document.querySelector('meta[name=referrer]')?.getAttribute('content') ?? null,
      tokenLength: token.length,
    };
  })()`);
  check(area, 'N4: the token is on screen exactly where the panel renders media and nowhere else',
    domScan.inMediaSrc >= 1 && domScan.inBodyText === false && domScan.textNodes.length === 0
      && domScan.inHref === 0 && domScan.inInputValue === 0 && domScan.inStatusOrAlert === 0,
    `media src hits ${domScan.inMediaSrc}; body text ${domScan.inBodyText}; text nodes `
      + `${domScan.textNodes.join(', ') || 'none'}; hrefs ${domScan.inHref}; field values `
      + `${domScan.inInputValue}; status/alert regions ${domScan.inStatusOrAlert}`);
  check(area, 'N4: the token is not persisted in storage or cookies',
    domScan.inLocalStorage === 0 && domScan.inSessionStorage === 0 && domScan.inCookie === false,
    `localStorage ${domScan.inLocalStorage}, sessionStorage ${domScan.inSessionStorage}, `
    + `cookie ${domScan.inCookie}`);
  const tokenInOwnLines = loggedLines.filter((line) => line.includes(state.signedToken)).length;
  check(area, 'N4: no line this tier printed carries the token in the clear',
    tokenInOwnLines === 0,
    `${tokenInOwnLines} of ${loggedLines.length} recorded lines would have printed it (the raw scan, `
      + 'not the mask, is the evidence; the mask is what lets the log be kept at all)');
  // One request has two header views, and they answer different questions. `headers` is what the
  // renderer *proposed*; `sentHeaders` is what the network service put on the wire after referrer
  // policy ran. A subresource load always proposes a Referer, so a claim about what actually left this
  // machine has to read the second view — and the proposal is measured alongside it rather than
  // discarded, so the difference between the two is visible in the record instead of assumed.
  const proposedWithReferrer = signedReqs.filter((r) => headerGet(r.headers, 'referer') !== null);
  const withWireView = signedReqs.filter((r) => r.sentHeaders !== undefined);
  const wireWithReferrer = withWireView.filter(
    (r) => headerGet(r.sentHeaders, 'referer') !== null);
  measure(area, 'N4 referrer: proposed against sent, for the signed requests',
    `${signedReqs.length} signed request(s): ${proposedWithReferrer.length} proposed a referer, `
    + `${withWireView.length} had the wire view captured, ${wireWithReferrer.length} of those put one `
    + 'on the wire');
  check(area, 'N4: the wire header set was captured for every signed preview request',
    signedReqs.length > 0 && withWireView.length === signedReqs.length,
    `${withWireView.length} of ${signedReqs.length} had Network.requestWillBeSentExtraInfo reported `
    + '— an absent wire view must not read as an unmeasured pass');
  check(area, 'N4: the preview request carries no referrer on the wire',
    wireWithReferrer.length === 0,
    `${wireWithReferrer.length} signed request(s) sent a referer (the renderer proposed `
    + `${proposedWithReferrer.length})`);
  check(area, 'N4 bound: the tracked no-referrer policy is live in the page that made the request',
    domScan.referrerMeta === 'no-referrer', `meta[name=referrer] content="${domScan.referrerMeta}"`);
  measure(area, 'N4 needle shape', `the hunted token is ${domScan.tokenLength} characters, taken from `
    + 'the ?token= of a minted /object/sign/ URL; it is in the hunt set, not in a printed value');
  const inert = Object.entries(needles).filter(([, v]) => v === '' || v === null || v === undefined)
    .map(([k]) => k);
  measure(area, 'needles that were inert this run (declared so a pass is not mistaken for coverage)',
    inert.length ? inert.join(', ') : 'none — every needle had a value to hunt');
  return { foreign, storageSeen: storageSeen.length, signed: signedReqs.length };
}

// --------------------------------------------------------------------- journey D (a11y re-measurement)

const PANEL_A11Y = `((sectionSel) => {
  const sec = document.querySelector(sectionSel);
  if (!sec) return null;
  const norm = (s) => String(s ?? '').replace(/\\s+/g, ' ').trim();
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      left: Math.round(r.left), right: Math.round(r.right) };
  };
  const rows = [...sec.querySelectorAll('ul > li')];
  const radios = rows.map((li, index) => {
    const el = li.querySelector('input[type=radio]');
    if (!el) return { index: index + 1, absent: true };
    el.scrollIntoView({ block: 'center' });
    const own = rectOf(el);
    const wrap = el.closest('label');
    const effective = wrap ? rectOf(wrap) : own;
    const hit = document.elementFromPoint(own.x + own.w / 2, own.y + own.h / 2);
    const answer = !hit ? 'nothing-there' : hit === el ? 'self'
      : el.contains(hit) ? 'own-descendant'
        : hit.contains(el) ? 'answered-by-ancestor' : 'other-thing';
    const liRect = rectOf(li);
    const cs = getComputedStyle(li);
    const border = Number.parseFloat(cs.borderLeftWidth) || 0;
    const pad = Number.parseFloat(cs.paddingLeft) || 0;
    const flex = wrap ? wrap.parentElement : null;
    const siblings = flex ? [...flex.children].filter((c) => c !== wrap) : [];
    const textRect = siblings.length ? rectOf(siblings[0]) : null;
    const textHit = textRect
      ? document.elementFromPoint(textRect.x + textRect.w / 2, textRect.y + textRect.h / 2) : null;
    return {
      index: index + 1, own, effective, answer, disabled: Boolean(el.disabled),
      ariaLabel: el.getAttribute('aria-label'), hasValueAttribute: el.hasAttribute('value'),
      insideLabel: Boolean(wrap),
      overhangPastPaddingBoxPx: Math.round((liRect.left + border + pad) - effective.left),
      overhangPastBorderBoxPx: Math.round(liRect.left - effective.left),
      overhangPastBorderBoxRightPx: Math.round(effective.right - liRect.right),
      labelBoxReachesIntoTextRunPx: textRect ? Math.round(textRect.right - effective.left) : null,
      textRunCentreAnswers: !textHit ? 'nothing-there'
        : (wrap !== null && (textHit === wrap || wrap.contains(textHit))) ? 'the-label' : 'other-element',
      flexGapPx: flex ? getComputedStyle(flex).columnGap || getComputedStyle(flex).gap : null,
      separationFromTextRunPx: textRect ? Math.round(effective.left - textRect.right) : null,
    };
  });
  const controls = [...sec.querySelectorAll('button,input,select')].map((el) => {
    const r = rectOf(el);
    const label = el.tagName === 'BUTTON' ? norm(el.textContent)
      : [...(el.labels ?? [])].map((l) => norm(l.textContent)).join('/') || el.getAttribute('aria-label');
    // The size a person actually aims at, the same rule the row loop above applies to the radio: a
    // control wrapped in a padded <label> is pressed through the label, so sizing the bare 16x16
    // input against the floor would report a defect on a control the host hits comfortably.
    const wrap = el.closest('label');
    const aim = wrap ? rectOf(wrap) : r;
    return { tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || null,
      name: label, disabled: Boolean(el.disabled), ...r,
      aimW: aim.w, aimH: aim.h, wrapped: wrap !== null };
  });
  const media = [...sec.querySelectorAll('img,audio')].map((el) => ({
    tag: el.tagName.toLowerCase(),
    srcHost: (() => { try { return new URL(el.src).host; } catch { return null; } })(),
    pathStarts: (() => { try { return new URL(el.src).pathname.slice(0, 34); } catch { return null; } })(),
    alt: el.getAttribute('alt'),
  }));
  const de = document.documentElement;
  return {
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    horizontalOverflowPx: de.scrollWidth - de.clientWidth,
    radios, controls, media,
    headingText: norm(sec.querySelector('h2')?.textContent),
    liveRegionCount: sec.querySelectorAll('[role=status],[role=alert]').length,
  };
})`;

const EDITOR_VIEWPORTS = [
  { label: '375x740 · dpr 3 · mobile', width: 375, height: 740, dpr: 3, mobile: true },
  { label: '768x1024 · dpr 2 · tablet', width: 768, height: 1024, dpr: 2, mobile: false },
];
const MIN_TARGET_PX = 24;
const HOST_WORKBENCH_PX = 44;

async function journeyA11y(browser, state) {
  const page = state.host;
  for (const viewport of EDITOR_VIEWPORTS) {
    const area = `D:a11y ${viewport.label}`;
    await page.viewport({ width: viewport.width, height: viewport.height, dpr: viewport.dpr,
      mobile: viewport.mobile });
    await sleep(400);
    // Open the preview inside this journey instead of relying on one carried over from C. The media
    // assertions below walk `snap.media`, and an empty list would let every one of them pass without
    // saying anything at all — so the run first proves there is a drawn element to measure, and takes
    // the token it just minted into the redaction list.
    const pressed = await page.pressButtonWhenReady('Preview', 25_000, PANEL);
    check(area, 'a preview can still be opened at this viewport', pressed === 'pressed', pressed);
    const drawn = await page.waitForSelector(`${PANEL} img`, 25_000);
    check(area, 'the opened preview is drawn as an <img> at this viewport', Boolean(drawn));
    if (drawn) {
      const src = await page.evaluate(`document.querySelector(${
        JSON.stringify(`${PANEL} img`)}).src`);
      const fresh = new URL(src).searchParams.get('token');
      if (typeof fresh === 'string' && fresh !== '' && fresh !== state.signedToken) {
        DISCOVERED.push(fresh);
        state.signedToken = fresh;
      }
    }
    const snap = await page.evaluate(`(${PANEL_A11Y})(${JSON.stringify(PANEL)})`);
    if (snap === null) throw new Error(`the panel was not on the page at ${viewport.label}`);
    measure(area, 'document horizontal overflow', `${snap.horizontalOverflowPx} px`);
    check(area, 'the panel does not force the document to scroll sideways',
      snap.horizontalOverflowPx === 0, `${snap.horizontalOverflowPx} px past the client width`);

    check(area, 'at least one row is present to measure (a11y claims are about a drawn row)',
      snap.radios.length > 0, `${snap.radios.length} row(s) drawn`);
    for (const radio of snap.radios) {
      if (radio.absent) {
        check(area, `row ${radio.index} offers a replace-target radio`, false, 'no radio in that row');
        continue;
      }
      check(area, `row ${radio.index}: the press area a host aims at is at least `
        + `${HOST_WORKBENCH_PX}x${HOST_WORKBENCH_PX}`,
        radio.effective.w >= HOST_WORKBENCH_PX && radio.effective.h >= HOST_WORKBENCH_PX,
        `own ${radio.own.w}x${radio.own.h}, effective ${radio.effective.w}x${radio.effective.h}`);
      check(area, `row ${radio.index}: the point at the control's own centre still answers to the radio`,
        radio.answer === 'self' || radio.answer === 'own-descendant',
        `centre answered by ${radio.answer}`);
      // The two numbers are signed overhangs: positive means the label's box sticks *past* the drawn
      // row's edge, negative means it sits inside it. Only the past-edge direction can clip or collide
      // with a neighbouring row, so the floor is one-sided. Scoring these with `Math.abs` would fail a
      // row for having its touch target well inside its own border — the opposite of the defect sought.
      check(area, `row ${radio.index}: the label's box stays within 3 px of the drawn row's border`,
        radio.overhangPastBorderBoxPx <= 3 && radio.overhangPastBorderBoxRightPx <= 3,
        `left edge ${radio.overhangPastBorderBoxPx} px past the border box, right edge `
        + `${radio.overhangPastBorderBoxRightPx} px past (negative means it sits inside the row); `
        + `past the padding box ${radio.overhangPastPaddingBoxPx} px (audit §33.2 predicted 2)`);
      check(area, `row ${radio.index}: the label's box does not swallow the text run's own centre`,
        radio.textRunCentreAnswers !== 'the-label',
        `the text run's centre answers to ${radio.textRunCentreAnswers}; the label reaches `
        + `${radio.labelBoxReachesIntoTextRunPx} px into the text run's box`);
      measure(area, `row ${radio.index}: gap between the text run and the label box`,
        `${radio.separationFromTextRunPx} px (flex gap ${radio.flexGapPx})`);
      check(area, `row ${radio.index}: the 8 px separation design-principles.md asks for is kept`,
        radio.flexGapPx === '8px' || radio.flexGapPx === '8', `column-gap ${radio.flexGapPx}`);
      check(area, `row ${radio.index}: the radio names itself for a screen reader`,
        typeof radio.ariaLabel === 'string' && radio.ariaLabel.startsWith('Replace this file'),
        `aria-label "${radio.ariaLabel}"`);
    }
    for (const control of snap.controls) {
      check(area, `${control.tag}${control.type ? `[${control.type}]` : ''} "${control.name ?? '?'}" `
        + `is at least ${MIN_TARGET_PX} px in both axes and has a name`,
        control.aimW >= MIN_TARGET_PX && control.aimH >= MIN_TARGET_PX
          && (control.tag === 'input' && control.type === 'radio' || Boolean(control.name)),
        `aimed ${control.aimW}x${control.aimH}${control.wrapped ? ' (through its label)' : ''}, `
        + `own ${control.w}x${control.h}, name ${control.name === null || control.name === '' ? 'none' : 'present'}`);
    }
    check(area, 'the panel holds at least one media element for the host/path claims below',
      snap.media.length > 0, `${snap.media.length} media element(s) in the panel`);
    for (const mediaEl of snap.media) {
      check(area, `the ${mediaEl.tag} preview points at the local API, never at a public object path`,
        String(mediaEl.srcHost).startsWith('127.0.0.1')
          && !String(mediaEl.pathStarts).includes('/object/public/'),
        `host ${mediaEl.srcHost}, path ${mediaEl.pathStarts}`);
    }
    const shot = join(EVIDENCE_DIR, `s6-panel-${viewport.width}x${viewport.height}.png`);
    const size = await page.screenshot(shot);
    measure(area, 'screenshot of the panel at this viewport', `${shot} (${size})`);
  }
  await page.evaluate('window.scrollTo(0, 0)');
  await page.setViewportSizeOnly({ width: 1280, height: 900, dpr: 1, mobile: false });
  return { viewports: EDITOR_VIEWPORTS.length };
}

// --------------------------------------------------------------------- teardown

function ownedIds() {
  return `(select w.id from public.weddings w join auth.users u on u.id = w.owner_user_id
    where u.email like '%+${RUN_TAG}@example.test')`;
}

async function teardown() {
  const owners = ownedIds();
  // Order is forced by the registry's own guard, not chosen: `private.guard_wedding_asset_delete()`
  // refuses a delete while the object still resolves *and* while the row still says `ready`, so
  // bytes go first, then the status moves to its terminal value, then the row goes.
  //
  // The `allow_delete_query` line is not a shortcut around a product refusal — it is Storage's own
  // documented escape hatch, and it is *required* here: `storage.protect_delete()` is a BEFORE
  // DELETE **FOR EACH STATEMENT** trigger, so it raises 42501 even when the delete matches zero rows.
  // Without it this teardown would fail on a run that left nothing behind. Measured both ways on
  // this stack: a zero-row delete raised, the same delete under `set local` answered `DELETE 0`.
  // `set local` keeps the widening inside this transaction instead of the session.
  psqlExec(`
    begin;
    set local storage.allow_delete_query = 'true';
    delete from storage.objects
     where bucket_id = 'wedding-assets'
       and split_part(name, '/', 2) in (select w.id::text from public.weddings w
         join auth.users u on u.id = w.owner_user_id
         where u.email like '%+${RUN_TAG}@example.test');
    update public.wedding_assets set upload_status = 'tombstoned'
     where wedding_id in ${owners};
    delete from public.wedding_assets where wedding_id in ${owners};
    delete from private.access_tokens where wedding_id in ${owners};
    delete from public.publications where wedding_id in ${owners};
    delete from public.invitation_versions where wedding_id in ${owners};
    delete from public.wedding_events where wedding_id in ${owners};
    delete from public.wedding_people where wedding_id in ${owners};
    delete from public.venues where wedding_id in ${owners};
    delete from public.invitation_drafts where wedding_id in ${owners};
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
  const leftAccounts = psqlValue(`select count(*)::text from auth.users
    where email like '%+${RUN_TAG}@example.test'`);
  const leftRows = psqlValue(`select count(*)::text from public.wedding_assets a
    where a.wedding_id in (select w.id from public.weddings w
      join auth.users u on u.id = w.owner_user_id where u.email like '%+${RUN_TAG}@example.test')`);
  const leftObjects = psqlValue(`select count(*)::text from storage.objects
    where bucket_id = 'wedding-assets' and name like 'weddings/%'
      and (split_part(name, '/', 2)) in
      (select w.id::text from public.weddings w join auth.users u on u.id = w.owner_user_id
        where u.email like '%+${RUN_TAG}@example.test')`);
  check('cleanup', 'every account this run created is gone', leftAccounts === '0', `left ${leftAccounts}`);
  check('cleanup', 'every registry row this run created is gone', leftRows === '0', `left ${leftRows}`);
  check('cleanup', 'every stored object this run created is gone', leftObjects === '0',
    `left ${leftObjects}`);
  rmSync(SCRATCH, { recursive: true, force: true });
}

// --------------------------------------------------------------------- main

async function main() {
  console.log(`Stage 6 browser tier · run tag ${RUN_TAG} · preview ${PREVIEW_ORIGIN} · api ${apiUrl}`);
  if (!PNG_MAGIC.equals(PNG_1PX.subarray(0, 8))) {
    throw new Error('the PNG fixture does not carry the PNG signature — this tier has no right to '
      + 'report a byte-gate result');
  }
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
  // The tier must run on the bytes the UPL-07 repair produced, or a client-side gate that is not in
  // this bundle would be measured against a product that never shipped it.
  check('prelude', 'the shipped bundle carries the byte-gate refusal sentence',
    bundleText.includes(SENTENCE.wrongBytes),
    `${(bundleText.length / 1024).toFixed(0)} KB of shipped JS/CSS/HTML scanned`);
  check('prelude', 'the shipped bundle calls the loopback target', bundleText.includes(browserApiUrl));
  const hostedOrigins = [
    ...new Set(bundleText.match(/https:\/\/[A-Za-z0-9._-]+\.supabase\.(?:co|in)(?=[\s"'`,:)?\]}]|$)/g) ?? []),
  ];
  check('prelude', 'no hosted Supabase origin of any shape is baked into the shipped bundle',
    hostedOrigins.length === 0,
    hostedOrigins.length ? `origins found (host names only): ${hostedOrigins.join(', ')}` : 'none');
  check('prelude', 'the local stack answers', psqlValue('select 1') === '1');
  measure('prelude', 'bucket row the tier expects to write into',
    psqlValue(`select coalesce(file_size_limit::text,'-') || ' / '
      || coalesce(array_to_string(allowed_mime_types, ','),'-')
      || ' / public=' || coalesce(public::text,'-')
      from storage.buckets where id = 'wedding-assets'`) ?? 'NO BUCKET ROW');

  const browser = await openBrowser({ cdpPort: CDP_PORT });
  const state = { host: null, weddingId: null, signedToken: null, rowsAfterA: [] };
  const runJourney = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
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
    await guarded('a', 'journey A (panel lifecycle)', false, () => journeyLifecycle(browser, state));
    await guarded('b', 'journey B (isolation)', true, () => journeyIsolation(browser, state));
    await guarded('c', 'journey C (N1–N4)', true, () => journeyNetwork(browser, state));
    await guarded('d', 'journey D (accessibility)', true, () => journeyA11y(browser, state));
  } finally {
    await browser.close().catch(() => {});
    const owners = ownedIds();
    const registryBefore = psqlValue(`select count(*)::text from public.wedding_assets a
      where a.wedding_id in ${owners}`);
    const objectsBefore = psqlValue(`select count(*)::text from storage.objects o
      where o.bucket_id = 'wedding-assets'
        and split_part(o.name, '/', 2) in (select w.id::text from public.weddings w
          join auth.users u on u.id = w.owner_user_id
          where u.email like '%+${RUN_TAG}@example.test')`);
    console.log(`==> rows for this run's wedding before teardown: ${registryBefore} registry `
      + `and ${objectsBefore} object(s)`);
    await teardown();
  }

  const checks = results.filter((r) => !r.measured).length;
  console.log(`\n==> checks ${checks}, measurements `
    + `${results.filter((r) => r.measured).length}, findings ${failureCount}`);
  if (failureCount > 0) {
    console.log('FINDINGS:');
    for (const r of results.filter((x) => !x.ok)) console.log(`  - [${r.area}] ${r.name}: ${r.detail}`);
    process.exitCode = 1;
  } else {
    console.log('STAGE 6 BROWSER TIER: PASS');
  }
}

await main();
