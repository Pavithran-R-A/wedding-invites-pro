#!/usr/bin/env node
// Stage 10, tier 4: the host's own page, over the shipped build and the running local stack.
//
// Requirement 8 of the Stage 10 work order ends at a screen, and every tier below this one measures the
// same fact one layer further from the person: the SQL battery (`supabase/tests/stage10/90_commerce_functions.sql`
// group H) reads the projection out of the deployed function, the HTTP battery
// (`supabase/tests/api/stage10_commerce_http.test.mjs` D-17, S-06) reads it through PostgREST, and the unit
// tier (`src/test/commerceStatusPanel.test.tsx`) renders the panel against a stand-in client. None of them
// shows that the sentences the panel prints are the sentences the shipped reader writes, on bytes the
// production build actually emitted, in a session a host really signed in with. This file does that, and
// nothing else — it never asks the product to do a thing the ledger cannot already do by itself.
//
// Three layers are read for every state, because agreeing with itself is not the same as agreeing with the
// database: the ledger's own rows (a `psql` cell, the tie-break the projection uses), the wire answer from
// `api.commerce_host_summary` fetched *with the page's own captured credentials*, and the text inside
// `section[aria-labelledby="commerce-heading"]`. The rendered sentence is compared against
// `stateWords(...)` loaded out of `src/lib/commerceStatus.ts` through Vite's SSR loader, so the parity is
// with the shipped copy of the prose rather than a paraphrase typed into this file — which is the finding
// `docs/audits` carried as "nothing on either tier compares them with the CASE".
//
// What it also measures, because the work order asked for it and no earlier tier did:
//   * the price rule at the page — an unapproved `display_approved` price is *absent* from the projection
//     and prints no figure (`20261019130000_stage10_host_failed_state.sql:146-153`),
//   * the ownership refusal in a browser session — a signed-in non-owner calling the door for somebody
//     else's wedding, which is Requirement 6 seen from the side that has credentials,
//   * that the guest, public and family-review doors mount and answer without ever knocking on a commerce
//     function, and that `commerce_host_summary` appears in the built chunks the host route loads and not
//     in the ones the guest route loads,
//   * secret isolation on the wire: every header value the page really sent is hashed and compared against
//     the local stack's service-role key, and only the boolean leaves this process.
//
// Ten of the thirteen derived states are driven here. `captured_awaiting_entitlement`,
// `refunded_entitlement_revoked` and `entitlement_expired` are not: the first two need the *policy*
// singleton (`private.commerce_policy.refund_revocation_mode`) pointed at a mode this stack has never been
// run in, and the third needs an entitlement expiry the shipped surface has no door for. Rewriting a shared
// policy row from a browser tier to colour a page is the kind of thing that leaves the next project on this
// machine reading a half-set-up stack, so those three stay the SQL and HTTP tiers' claims and this file
// says so in its own output.
//
// Run it against the built bytes and the running stack:
//   npm run build && (npm run preview &)
//   node scripts/stage10-browser-commerce.mjs --container supabase_db_localvivaahvarnam \
//     --preview http://127.0.0.1:4173 --out ../q10-logs/s10-browser-1.txt
// A fixture password is derived from the run tag and never printed; webhook signing uses a per-run random
// key, because the ledger records `delivery_verified` as an argument and no real provider is involved.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { openBrowser, assertLoopback } from './stage5-browser-driver.mjs';
import {
  cashfreeDelivery, decodeLine, ensureSafeEncoding, expireOrderSql, quoteOrderSql, razorpayDelivery,
  resolveTarget, revocationSql, runDelivery, runPsql,
} from './stage10-commerce-driver.mjs';

/** Repo root with a trailing separator, so `${REPO}dist/assets` reads as a directory join.
 *  `import.meta.url`'s pathname is percent-encoded on this machine (the account name has a space), which is
 *  what made the first attempt at this line fail to find `.env.local`. */
const REPO = `${resolve(import.meta.dirname, '..')}${sep}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class Refusal extends Error {
  constructor(message, code = 2) { super(message); this.exitCode = code; }
}

// ------------------------------------------------------------------------ options and environment

const USAGE = `usage: node scripts/stage10-browser-commerce.mjs [options]
  --container <supabase_db_...>  the local stack's database container (default
                                 supabase_db_localvivaahvarnam)
  --preview <origin>             the built app being measured (loopback only, default
                                 http://127.0.0.1:4173)
  --api-origin <origin>          the stack's API origin (loopback only; default is .env.local's
                                 SUPABASE_LOCAL_URL)
  --cdp-port <n>                 the browser harness's own DevTools port (default 9417)
  --floor-mb <n>                 refuse to start, and stop mid-run, below this much free disk
                                 on C: (default 120)
  --run-tag <s>                  a label for this run's fixture rows (default: a random one)
  --out <path>                   where to write the evidence log
No connection string, key or token is taken from the command line, and none is printed.`;

function readOptions(argv) {
  const opts = {
    container: 'supabase_db_localvivaahvarnam',
    preview: 'http://127.0.0.1:4173',
    apiOrigin: null,
    cdpPort: 9417,
    floorMb: 120,
    runTag: `s10ui-${randomBytes(6).toString('hex')}`,
    out: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { process.stdout.write(`${USAGE}\n`); process.exit(0); }
    const key = String(a).replace(/^--/, '');
    if (!(key in opts)) throw new Refusal(`refused: unknown option --${key}.\n${USAGE}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Refusal(`refused: --${key} wants a value.`);
    i += 1;
    opts[key] = key === 'cdpPort' || key === 'floorMb' ? Number(value) : value;
  }
  if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(opts.container) || /supabase\.(co|io)/i.test(opts.container)) {
    throw new Refusal(`refused: --container must be the local stack's own database container name, got `
      + `${JSON.stringify(opts.container)}. A hosted target is not this tier's to touch.`);
  }
  for (const label of ['preview', 'apiOrigin']) {
    if (opts[label] === null) continue;
    assertLoopback(opts[label], label);
  }
  if (!Number.isInteger(opts.cdpPort) || opts.cdpPort <= 0) throw new Refusal('refused: --cdp-port is not a port.');
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(opts.runTag)) throw new Refusal('refused: --run-tag is not a safe tag.');
  return opts;
}

/** `.env.local`, the names and the two loopback values this tier has a job for. Only three values are ever
 *  read out of it, and the service-role key among them is used in one place: hashed against a captured
 *  header, so the answer this file prints is a boolean and never the key. */
function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

const sha = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 12);

// ------------------------------------------------------------------------ the disk guard
// The work order made Chromium conditional on headroom, and on this shared machine free space moves by
// hundreds of megabytes between two measurements — 118 MB, then 187 MB, then 495 MB on the day this tier
// was first written. So the guard is measured, in front of the browser and in front of every case group,
// and it stops rather than writing the volume full underneath somebody else's database.

function freeBytes() {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', '[IO.DriveInfo]::new("C:").AvailableFreeSpace'],
    { encoding: 'utf8' });
  const n = Number(String(r.stdout ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) throw new Refusal('refused: free disk on C: could not be measured, '
    + 'and this tier is conditional on that measurement.');
  return n;
}

// ------------------------------------------------------------------------ the SQL channel

function makeChannel(target) {
  const sql = (text) => runPsql(target, text);
  // Asked once, before any literal leaves: the driver's quote-doubling rule is only a rule under
  // `standard_conforming_strings = on` (stage10-commerce-driver.mjs:405-413).
  ensureSafeEncoding(sql);
  const cell = (query, what) => {
    const lines = sql(query).split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length !== 1) throw new Refusal(`refused: ${what} answered ${lines.length} rows, not one.`);
    return lines[0];
  };
  return { sql, cell };
}

const countOf = (cell, fromWhere, what) => cell(`select count(*)::text ${fromWhere}`, what);

// ------------------------------------------------------------------------ the shipped prose

/** The module the page runs, loaded through the bundler that resolves the repo's own specifiers. This is
 *  not a second implementation of the sentences: it is `src/lib/commerceStatus.ts`, the same file the
 *  panel imports, read at run time so a drift in the copy is this tier's failure and not its blind spot. */
async function loadShippedReader() {
  const server = await createServer({
    root: REPO, configFile: `${REPO}vite.config.ts`, logLevel: 'error',
    server: { hmr: false, middlewareMode: true }, optimizeDeps: { noDiscovery: true },
  });
  try {
    const mod = await server.ssrLoadModule('/src/lib/commerceStatus.ts');
    if (typeof mod.stateWords !== 'function' || !Array.isArray(mod.HOST_STATES)) {
      throw new Refusal('refused: the shipped reader loaded but has no stateWords to compare against.');
    }
    return mod;
  } finally {
    await server.close();
  }
}

/** The CASE arms, in the order the body writes them — the only list this tier can check the reader's
 *  vocabulary against without either one grading itself. */
/** Every reading the CASE can answer with, in the order it tests them.
 *
 *  A `THEN` arm and the closing `ELSE` both produce a state, so both count: `captured_awaiting_entitlement`
 *  is named only by the `ELSE`, and an extractor that looked for `THEN` alone would report a twelve-arm
 *  substrate against a thirteen-word reader vocabulary and score the difference as a product defect. */
function migrationStateArms(path) {
  const text = readFileSync(path, 'utf8');
  const body = /v_state := CASE([\s\S]*?);/.exec(text);
  if (!body) throw new Refusal(`refused: no derived-state CASE was found in ${path}.`);
  const arms = [...body[1].matchAll(/\b(?:THEN|ELSE)\s+'([a-z_]+)'/g)].map((m) => m[1]);
  const defaults = [...body[1].matchAll(/\bELSE\s+'([a-z_]+)'/g)].map((m) => m[1]);
  if (arms.length === 0) throw new Refusal('refused: the derived-state CASE has no arms at all.');
  if (defaults.length !== 1 || arms[arms.length - 1] !== defaults[0]) {
    throw new Refusal(`refused: the derived-state CASE's default is not one final reading `
      + `(saw ${JSON.stringify(defaults)} of ${arms.length} arm(s)).`);
  }
  return arms;
}

// ------------------------------------------------------------------------ fixture bodies
// The two providers' documents are the shapes `stage10_commerce_http.test.mjs:516-532` established against
// the verifier: Razorpay amounts are minor units, Cashfree's are decimal rupees, and the merchant reference
// rides in the entity's notes.

const rzBody = (event, eventId, createdAt, payload) => JSON.stringify({
  entity: 'event', event, event_id: eventId, created_at: createdAt, payload,
});
/** Provider object ids are namespaced with the run tag, and not for tidiness.
 *  `commerce_attempts_payment_ref_uk` and `commerce_attempts_order_ref_uk` are unique on
 *  `(provider, provider_payment_ref)` / `(provider, provider_order_ref)` across the whole ledger, not per
 *  order, so a fixture that reuses a fixed id collides with an earlier run's row on a shared stack.
 *  Measured on 2026-10-19: the second run of this tier died inside `internal_api.record_commerce_event`
 *  re-minting the first run's `pay_FL`, and the driver reported only the CONTEXT line, so the refusal
 *  looked like a substrate fault rather than this file's own fixture. */
let NS = '';
const payEntity = (mr, ref, amount, status) => ({
  id: `pay_${NS}${ref}`, order_id: `order_${NS}${ref}`, currency: 'INR', amount, amount_paid: amount,
  status, notes: { merchant_reference: mr },
});
const orderEntity = (mr, ref) => ({
  id: `order_${NS}${ref}`, notes: { merchant_reference: mr }, currency: 'INR', status: 'paid',
});
const refundEntity = (mr, ref, amount) => ({
  id: `rfnd_${NS}${ref}`, order_id: `order_${NS}${ref}`, payment_id: `pay_${NS}${ref}`, amount, currency: 'INR',
  status: 'processed', notes: { merchant_reference: mr },
});
const cfDoc = (type, id, t, payload) => JSON.stringify({
  entity: 'webhook', type, notification_id: id, notification_type: type, notification_time: t, payload,
});

// ------------------------------------------------------------------------ the browser side

const SECTION = 'section[aria-labelledby="commerce-heading"]';

async function fillAndSubmit(page, fields, buttonWords) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    if (await page.waitForSelector(Object.keys(fields)[0], 8_000)) {
      const missing = [];
      for (const [selector, value] of Object.entries(fields)) {
        await page.setBySelector(selector, value);
        const readBack = await page.evaluate(
          `document.querySelector(${JSON.stringify(selector)})?.value ?? null`);
        if (readBack !== value) missing.push(selector);
      }
      if (missing.length === 0) return page.pressButton(buttonWords);
      if (attempt === 8) throw new Refusal(`the form would not hold its values: ${missing.join(', ')}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return 'absent';
}

async function waitForUrl(page, part, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const url = await page.currentUrl();
    if (url.includes(part)) return url;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** A host made the way the product makes a host, with a wedding made the way the product makes a wedding. */
async function signUpHost(browser, preview, { email, password, name, weddingTitle }) {
  const page = await browser.newPage(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  await page.goto(`${preview}/signup`);
  await page.waitForSelector('form');
  const signed = await fillAndSubmit(page, { '#name': name, '#email': email, '#password': password }, 'Sign up');
  if (signed !== 'pressed') throw new Refusal(`the sign-up button was not pressable (${signed}).`);
  await waitForUrl(page, '/login');
  const logged = await fillAndSubmit(page, { '#email': email, '#password': password }, 'Log in');
  if (await waitForUrl(page, '/dashboard') === null) {
    throw new Refusal(`the host never reached a dashboard (press answered ${logged}; page said: `
      + `${(await page.bodyText()).replace(/\s+/g, ' ').slice(0, 180)})`);
  }
  await page.clickLink('Create Invitation');
  await page.waitForSelector('#title');
  const created = await fillAndSubmit(page, { '#title': weddingTitle, '#language': 'en' }, 'Create Invitation Draft');
  const url = await waitForUrl(page, '/project/');
  const weddingId = url === null ? null : /\/project\/([0-9a-f-]{36})/.exec(url)?.[1];
  if (!weddingId || !UUID.test(weddingId)) {
    throw new Refusal(`the wedding was never formed (press answered ${created}; url ${url ?? 'none'})`);
  }
  return { page, weddingId };
}

/** The panel's own idle signal, then everything its section says. `busy` disables the section's Refresh
 *  button while a read is in flight (CommerceStatusPanel.tsx:105-114), so waiting for it to re-enable is
 *  waiting on the product's stated condition rather than sleeping — and a read that ends in an error also
 *  leaves it enabled, which is why `role="alert"` is read in the same pass. */
async function readPanel(page, preview, weddingId) {
  await page.goto(`${preview}/project/${weddingId}/edit`);
  if (!(await page.waitForSelector(SECTION, 25_000))) {
    throw new Refusal(`the commerce section never mounted at /project/${weddingId}/edit — page said: `
      + `${(await page.bodyText()).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  const idle = () => page.evaluate(`(() => {
    const s = document.querySelector(${JSON.stringify(SECTION)});
    if (!s) return 'no-section';
    const b = [...s.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Refresh');
    return b ? b.disabled === false : 'no-refresh-button';
  })()`);
  const deadline = Date.now() + 25_000;
  for (;;) {
    if (await idle() === true) break;
    if (Date.now() > deadline) throw new Refusal('the commerce panel never finished its read; Refresh stayed busy.');
    await new Promise((r) => setTimeout(r, 150));
  }
  return page.evaluate(`(() => {
    const s = document.querySelector(${JSON.stringify(SECTION)});
    const norm = (t) => (t || '').replace(/\\s+/g, ' ').trim();
    const status = s.querySelector('p[role="status"]');
    return {
      statusText: status ? norm(status.innerText) : null,
      statusClass: status ? (status.getAttribute('class') || '') : '',
      paragraphs: [...s.querySelectorAll('p')].map((p) => norm(p.innerText)),
      alerts: [...s.querySelectorAll('[role="alert"]')].map((p) => norm(p.innerText)),
      buttons: [...s.querySelectorAll('button')].map((b) => norm(b.textContent)),
      bodyText: norm(s.innerText),
    };
  })()`);
}

/** The same read a host gets by pressing the only control the panel offers. */
async function pressRefresh(page) {
  const pressed = await page.evaluate(`(() => {
    const s = document.querySelector(${JSON.stringify(SECTION)});
    const b = s ? [...s.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Refresh') : null;
    if (!b) return 'absent';
    if (b.disabled) return 'disabled';
    b.click();
    return 'pressed';
  })()`);
  if (pressed !== 'pressed') throw new Refusal(`Refresh could not be pressed (${pressed}).`);
  const deadline = Date.now() + 25_000;
  for (;;) {
    const state = await page.evaluate(`(() => {
      const s = document.querySelector(${JSON.stringify(SECTION)});
      const b = s ? [...s.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Refresh') : null;
      return b ? b.disabled === false : 'gone';
    })()`);
    if (state === true) break;
    if (Date.now() > deadline) throw new Refusal('the panel never settled after Refresh.');
    await new Promise((r) => setTimeout(r, 150));
  }
  return page.evaluate(`(() => {
    const s = document.querySelector(${JSON.stringify(SECTION)});
    const p = s ? s.querySelector('p[role="status"]') : null;
    return p ? p.innerText.replace(/\\s+/g, ' ').trim() : null;
  })()`);
}

/** The projection, fetched from inside the page with the credentials the page itself used for its last
 *  call. Headers leave this function never: `rpcHeaders` hands back live tokens, so only the status code,
 *  the body and a hash of each header value are ever kept. */
/** The projection the host's own door returns, fetched from inside that page with that page's own headers.
 *
 *  Two things this had to get right, both measured on 2026-10-19 rather than assumed:
 *   * `Content-Profile` is carried over from the captured call. Without it PostgREST answers
 *     `404 PGRST202 … Searched for the function public.commerce_host_summary`, because the door lives in
 *     the `api` schema and the app reaches it through `supabase.schema('api')`. A tier that dropped the
 *     header would read its own 404 as "the host's page cannot see a purchase" — an invented product
 *     fact, and the exact shape the first run of this file failed in.
 *   * The credentials are waited for. A page that has not mounted the commerce route has made no
 *     authenticated RPC call at all (creating a draft lands on `/configure`, whose panels read tables),
 *     so borrowing too early is borrowing nothing. */
async function pageProjection(page, apiOrigin, weddingId) {
  const deadline = Date.now() + 30_000;
  let headers = await page.rpcHeaders();
  while (headers === null) {
    if (Date.now() > deadline) {
      throw new Refusal('refused: this page never made an authenticated RPC call within 30 s, so it has '
        + 'no session for the tier to borrow. The panel read above should have produced one.');
    }
    await new Promise((r) => setTimeout(r, 200));
    headers = await page.rpcHeaders();
  }
  if (headers.profile === null) {
    throw new Refusal('refused: the page called its door without a Content-Profile header, so this tier '
      + 'has no schema routing to copy. The shipped client uses supabase.schema("api").');
  }
  const res = await page.fetchFromPage(`${apiOrigin}/rest/v1/rpc/commerce_host_summary`, {
    method: 'POST',
    headers: {
      apikey: headers.apikey, Authorization: headers.authorization, 'Content-Type': 'application/json',
      'Content-Profile': headers.profile,
    },
    body: JSON.stringify({ p_wedding_id: weddingId }),
  });
  let body = null;
  try { body = JSON.parse(res.text); } catch { /* a refusal page is not json */ }
  return { status: res.status, body, headerDigests: { apikey: sha(headers.apikey), authorization: sha(headers.authorization) } };
}

// ------------------------------------------------------------------------ the tier

function makeLog(path) {
  const lines = [];
  const log = (text) => { lines.push(text); process.stdout.write(`${text}\n`); };
  log.flush = () => { if (path !== null) writeFileSync(path, `${lines.join('\n')}\n`, 'utf8'); };
  return log;
}

async function main({ argv, env = process.env }) {
  const opts = readOptions(argv);
  const log = makeLog(opts.out);
  const started = new Date().toISOString();
  const secret = randomBytes(32).toString('hex');
  const RUN = opts.runTag;
  NS = `${RUN}-`;
  const password = `local-only-${RUN}`;
  const results = [];
  let failures = 0;

  const check = (id, ok, detail) => {
    results.push({ id, ok, detail });
    if (!ok) failures += 1;
    log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail === null || detail === undefined ? '' : ` — ${detail}`}`);
  };

  const floor = opts.floorMb * 1024 * 1024;
  const guard = (where) => {
    const free = freeBytes();
    if (free < floor) throw new Refusal(`stopped at ${where}: C: has ${(free / 1048576).toFixed(0)} MB free, `
      + `below the ${opts.floorMb} MB floor this tier sets for itself.`);
    return free;
  };

  const envFile = readEnvFile(`${REPO}.env.local`);
  const apiOrigin = opts.apiOrigin ?? envFile.SUPABASE_LOCAL_URL;
  if (!apiOrigin) throw new Refusal('refused: no API origin — set SUPABASE_LOCAL_URL in .env.local or pass --api-origin.');
  assertLoopback(apiOrigin, 'api origin');
  const preview = opts.preview;
  assertLoopback(preview, 'preview origin');

  const target = resolveTarget({ 'via-docker': opts.container }, {});
  const { sql, cell } = makeChannel(target);
  const reader = await loadShippedReader();

  log(`# Stage 10 browser tier — started ${started}`);
  log(`run tag ${RUN}; preview ${preview}; api ${apiOrigin}; container ${opts.container}`);
  log(`free on C: at start ${(guard('start') / 1048576).toFixed(0)} MB (floor ${opts.floorMb} MB)`);
  log(`head ${spawnSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()}`);

  // ---- the reader's vocabulary against the body that writes it
  const arms = migrationStateArms(`${REPO}supabase/migrations/20261019130000_stage10_host_failed_state.sql`);
  check('B01 the CASE arms are the reader\'s HOST_STATES, in order',
    arms.join(',') === reader.HOST_STATES.join(','),
    `migration [${arms.join(', ')}] vs reader [${reader.HOST_STATES.join(', ')}]`);
  const unknownWord = `not_a_state_${RUN.slice(-4)}`;
  check('B02 every known word gets a sentence of its own',
    reader.HOST_STATES.every((w) => reader.stateWords(w) !== reader.stateWords(unknownWord)),
    null);
  check('B03 an unfamiliar word is kept, not defaulted',
    reader.stateWords(unknownWord).includes(unknownWord) && reader.isKnownState(unknownWord) === false,
    reader.stateWords(unknownWord));
  const stateless = reader.HOST_STATES.filter((w) => !/^[a-z_]+$/.test(w) || w.length < 4);
  check('B04 no arm is a typo-shaped word', stateless.length === 0, stateless.join(',') || 'all thirteen read as states');

  // ---- the catalogue this run owns, and the policy it must not disturb
  const PRICE = { approved: 490000, unapproved: 550000, cashfree: 190000 };
  const CODE = { approved: `${RUN}-approved`, unapproved: `${RUN}-unapproved`, cashfree: `${RUN}-cashfree` };
  const before = {
    packages: countOf(cell, 'from private.commerce_packages', 'packages before'),
    orders: countOf(cell, 'from private.commerce_orders', 'orders before'),
    weddings: countOf(cell, 'from public.weddings', 'weddings before'),
    users: countOf(cell, 'from auth.users', 'auth users before'),
  };
  const policy = cell(`select 'gate='||publish_gate||' mode='||refund_revocation_mode
    from private.commerce_policy where id = 1`, 'the shipped policy row');
  log(`policy as found: ${policy} (this tier never writes it)`);
  for (const [code, amount, approved] of [
    [CODE.approved, PRICE.approved, true], [CODE.unapproved, PRICE.unapproved, false], [CODE.cashfree, PRICE.cashfree, true],
  ]) {
    sql(`insert into private.commerce_packages (package_code, currency, amount_minor, price_version, status, display_approved)
         values ('${code}', 'INR', ${amount}, 1, 'active', ${approved})`);
  }
  check('B05 three run-tagged price rows are the only catalogue this tier added',
    countOf(cell, `from private.commerce_packages where package_code like '${RUN}-%'`, 'this run\'s prices') === '3',
    null);

  const host = (key) => `${key}+${RUN}@example.test`;
  const uidOf = (key) => cell(`select u.id::text from auth.users u where u.email = '${host(key)}'`, `the id of ${key}`);
  const ledgerRow = (weddingId) => cell(`
    select 'order='||coalesce(o.status,'-')
      || ' attempt='||coalesce((select a.status from private.commerce_payment_attempts a
                                 where a.order_id = o.id order by a.initiated_at desc, a.created_at desc limit 1),'-')
      || ' ent='||coalesce((select e.status from public.entitlements e where e.id = o.entitlement_id),'-')
      || ' refund='||coalesce((select r.kind||'/'||r.status from private.commerce_refunds r
                                where r.order_id = o.id order by r.recorded_at desc limit 1),'-')
      || ' mr='||coalesce(o.merchant_reference,'-') || ' oid='||coalesce(o.id::text,'-')
    from private.commerce_orders o
    where o.wedding_id = '${weddingId}'
    order by (o.status in ('open','payment_pending','captured')) desc, o.created_at desc limit 1`,
    'the ledger rows behind the projection');

  const browser = await openBrowser({ cdpPort: opts.cdpPort });
  const opened = [];
  let exitCode = 0;
  try {
    const quote = (key, packageCode) => decodeLine(sql(quoteOrderSql({
      weddingId: hosts[key].weddingId, packageCode, actorUserId: uidOf(key),
    })));
    const deliver = (provider, body, eventId, actorKey, timestamp) => {
      const delivery = provider === 'razorpay'
        ? razorpayDelivery({ body, secret, eventId })
        : cashfreeDelivery({ body, secret, timestamp });
      const out = runDelivery({
        sql, delivery, secret, environment: 'synthetic', actorUserId: uidOf(actorKey),
      });
      if (out.verified !== true) {
        throw new Refusal(`a ${provider} fixture was refused by its own verifier (${out.reason ?? 'no reason'}), `
          + 'so the state this case wanted was never delivered.');
      }
      return out.result;
    };

    // The five fixtures, each with its own signed-in page (every `newPage` is its own browser context, so
    // no session leaks between them).
    const hosts = {};
    for (const [key, title] of [
      ['bare', `Bare ${RUN}`], ['flow', `Flow ${RUN}`], ['unapproved', `Unapproved ${RUN}`],
      ['refund', `Refund ${RUN}`], ['revoke', `Revoke ${RUN}`], ['dispute', `Dispute ${RUN}`],
      ['expire', `Expire ${RUN}`], ['stranger', `Stranger ${RUN}`],
    ]) {
      guard(`sign-up of ${key}`);
      hosts[key] = await signUpHost(browser, preview, {
        email: host(key), password, name: key, weddingTitle: title,
      });
      opened.push(hosts[key].page);
      log(`host ${key}: wedding ${hosts[key].weddingId}`);
    }

    // ---- no_purchase, on a wedding this tier made through the shipped form and touched no further
    {
      const w = hosts.bare.weddingId;
      const p = await readPanel(hosts.bare.page, preview, w);
      const proj = await pageProjection(hosts.bare.page, apiOrigin, w);
      check('B10 a wedding with no order reads no_purchase on the wire',
        proj.status === 200 && proj.body.state === 'no_purchase',
        `http ${proj.status}; state ${proj.body?.state}`);
      check('B11 and the page prints the shipped sentence for it',
        p.statusText === reader.stateWords('no_purchase'),
        `page: ${JSON.stringify(p.statusText)}`);
      // Every sentence this build writes for `no_purchase` is numeral-free, so any digit in the section
      // is a leaked figure, price-list version or order reference rather than product copy.
      check('B12 with no figure and no order reference on screen',
        !/[₹0-9]/.test(p.bodyText), p.bodyText.slice(0, 220));
      check('B13 the only control the panel offers is a re-read',
        p.buttons.join('|') === 'Refresh', p.buttons.join('|'));
      const parsed = reader.parseCommerceSummary(proj.body);
      check('B14 the shipped reader accepts the deployed body without softening it',
        parsed !== null && parsed.state === 'no_purchase' && parsed.amountMinor === null,
        parsed === null ? 'parseCommerceSummary refused the wire object the page just rendered' : 'parsed');
    }

    // ---- one purchase, five readings: quote_open → payment_pending → payment_attempt_failed →
    //      payment_pending (retry) → cancelled.
    {
      const w = hosts.flow.weddingId;
      const order = quote('flow', CODE.approved);
      const mr = order.merchant_reference;
      const t = Math.floor(Date.now() / 1000);
      let p = await readPanel(hosts.flow.page, preview, w);
      let proj = await pageProjection(hosts.flow.page, apiOrigin, w);
      check('B20 a fresh quote reads quote_open, with its figure because display is approved',
        proj.body.state === 'quote_open' && proj.body.amount_minor === PRICE.approved
        && p.statusText === reader.stateWords('quote_open'),
        `state ${proj.body.state}; page ${JSON.stringify(p.statusText)}`);
      // The figure sentence is compared against the shipped *reader*, not against this file's paraphrase:
      // `priceWords` takes a parsed `CommerceSummary`, so the wire object has to go through
      // `parseCommerceSummary` first — the same two steps the panel runs. Handing `priceWords` the raw
      // snake_case projection makes it return null (its own camelCase fields are absent), which the first
      // run of this tier scored as a page that "prints no approved figure" while the page printed it.
      const summary = reader.parseCommerceSummary(proj.body);
      const figure = summary === null ? null : reader.priceWords(summary);
      check('B21 the approved figure is the shipped priceWords sentence plus the quoted-not-taken tail',
        summary !== null && figure !== null
        && p.paragraphs.some((x) => x.startsWith(figure) && x.endsWith('— quoted, not yet taken.')),
        `${figure ?? 'reader returned nothing'} / ${JSON.stringify(summary?.amountMinor)}`);
      check('B22 the order reference is printed, and nothing provider-shaped is',
        /Order reference vv1_[0-9a-f]{32}/.test(p.bodyText) && !/razorpay|cashfree|pay_|order_/i.test(p.bodyText),
        p.bodyText.slice(0, 240));

      deliver('razorpay', rzBody('payment.created', `${RUN}-init`, t, {
        payment: { entity: payEntity(mr, 'FL', PRICE.approved, 'created') },
        order: { entity: orderEntity(mr, 'FL') },
      }), `${RUN}-init`, 'flow');
      await pressRefresh(hosts.flow.page);
      proj = await pageProjection(hosts.flow.page, apiOrigin, w);
      p = await readPanel(hosts.flow.page, preview, w);
      check('B30 an initiation moves the order to payment_pending and the panel follows it',
        proj.body.state === 'payment_pending' && proj.body.attempt_status === 'initiated'
        && p.statusText === reader.stateWords('payment_pending')
        && ledgerRow(w).startsWith('order=payment_pending attempt=initiated'),
        `state ${proj.body.state}; ledger ${ledgerRow(w)}`);

      deliver('razorpay', rzBody('payment.failed', `${RUN}-fail`, t + 1, {
        payment: { entity: payEntity(mr, 'FL', PRICE.approved, 'failed') },
        order: { entity: orderEntity(mr, 'FL') },
      }), `${RUN}-fail`, 'flow');
      p = await readPanel(hosts.flow.page, preview, w);
      proj = await pageProjection(hosts.flow.page, apiOrigin, w);
      check('B31 a failed attempt is its own host state while the order stays payment_pending',
        proj.body.state === 'payment_attempt_failed' && proj.body.order_status === 'payment_pending'
        && p.statusText === reader.stateWords('payment_attempt_failed'),
        `state ${proj.body.state}; order_status ${proj.body.order_status}; page ${JSON.stringify(p.statusText)}`);
      check('B32 and the sentence keeps the retry open rather than announcing a loss',
        /again|still/.test(p.statusText), p.statusText);

      deliver('razorpay', rzBody('payment.created', `${RUN}-init2`, t + 2, {
        payment: { entity: payEntity(mr, 'FL2', PRICE.approved, 'created') },
        order: { entity: orderEntity(mr, 'FL') },
      }), `${RUN}-init2`, 'flow');
      p = await readPanel(hosts.flow.page, preview, w);
      check('B33 a second attempt takes the failure off the screen (newest attempt wins)',
        p.statusText === reader.stateWords('payment_pending'), JSON.stringify(p.statusText));

      deliver('razorpay', rzBody('order.cancelled', `${RUN}-cancel`, t + 3, {
        order: { entity: orderEntity(mr, 'FL') },
      }), `${RUN}-cancel`, 'flow');
      p = await readPanel(hosts.flow.page, preview, w);
      proj = await pageProjection(hosts.flow.page, apiOrigin, w);
      check('B40 a cancellation closes the purchase and the page says so',
        proj.body.state === 'cancelled' && ledgerRow(w).startsWith('order=cancelled')
        && p.statusText === reader.stateWords('cancelled'),
        `state ${proj.body.state}; ledger ${ledgerRow(w)}`);
    }

    // ---- the unapproved price: absent from the projection, absent from the page.
    {
      const w = hosts.unapproved.weddingId;
      quote('unapproved', CODE.unapproved);
      const p = await readPanel(hosts.unapproved.page, preview, w);
      const proj = await pageProjection(hosts.unapproved.page, apiOrigin, w);
      check('B50 an unapproved price carries no amount_minor and no currency on the wire',
        proj.body.state === 'quote_open' && proj.body.price_display_enabled === false
        && !('amount_minor' in proj.body) && !('currency' in proj.body),
        `keys ${Object.keys(proj.body).sort().join(',')}`);
      check('B51 and the page prints no figure, saying why instead',
        !/[₹]/.test(p.bodyText) && p.paragraphs.some((x) => x.startsWith('No figure is printed here.')),
        p.bodyText.slice(0, 240));
      const paid = await pageProjection(hosts.flow.page, apiOrigin, hosts.flow.weddingId);
      check('B52 the same reader does show a figure for an approved price, so the silence is the rule not a bug',
        paid.body.price_display_enabled === true && paid.body.amount_minor === PRICE.approved,
        `approved projection keys ${Object.keys(paid.body).sort().join(',')}`);
    }

    // ---- capture, then a refund: entitlement_active → refunded_pending_review
    {
      const w = hosts.refund.weddingId;
      const order = quote('refund', CODE.approved);
      const mr = order.merchant_reference;
      const t = Math.floor(Date.now() / 1000);
      deliver('razorpay', rzBody('payment.created', `${RUN}-rcap1`, t, {
        payment: { entity: payEntity(mr, 'RF', PRICE.approved, 'created') },
        order: { entity: orderEntity(mr, 'RF') },
      }), `${RUN}-rcap1`, 'refund');
      deliver('razorpay', rzBody('payment.captured', `${RUN}-rcap2`, t + 1, {
        payment: { entity: payEntity(mr, 'RF', PRICE.approved, 'captured') },
        order: { entity: orderEntity(mr, 'RF') },
      }), `${RUN}-rcap2`, 'refund');
      const p1 = await readPanel(hosts.refund.page, preview, w);
      const j1 = await pageProjection(hosts.refund.page, apiOrigin, w);
      check('B60 a verified capture reads entitlement_active and mints the right in the ledger',
        j1.body.state === 'entitlement_active' && j1.body.entitlement_status === 'active'
        && p1.statusText === reader.stateWords('entitlement_active')
        && /ent=active/.test(ledgerRow(w)),
        `state ${j1.body.state}; ledger ${ledgerRow(w)}`);

      deliver('razorpay', rzBody('refund.processed', `${RUN}-ref`, t + 2, {
        refund: { entity: refundEntity(mr, 'RF', PRICE.approved) },
        order: { entity: orderEntity(mr, 'RF') },
      }), `${RUN}-ref`, 'refund');
      const p2 = await readPanel(hosts.refund.page, preview, w);
      const j2 = await pageProjection(hosts.refund.page, apiOrigin, w);
      check('B61 a refund under the shipped hold-for-review policy is a review, not a cut-off',
        j2.body.state === 'refunded_pending_review' && j2.body.refund_kind === 'refund'
        && j2.body.entitlement_status === 'active'
        && p2.statusText === reader.stateWords('refunded_pending_review'),
        `state ${j2.body.state}; entitlement ${j2.body.entitlement_status}; ledger ${ledgerRow(w)}`);
    }

    // ---- an operator revocation with no refund behind it
    {
      const w = hosts.revoke.weddingId;
      const order = quote('revoke', CODE.approved);
      const mr = order.merchant_reference;
      const t = Math.floor(Date.now() / 1000);
      deliver('razorpay', rzBody('payment.created', `${RUN}-rv1`, t, {
        payment: { entity: payEntity(mr, 'RV', PRICE.approved, 'created') },
        order: { entity: orderEntity(mr, 'RV') },
      }), `${RUN}-rv1`, 'revoke');
      deliver('razorpay', rzBody('payment.captured', `${RUN}-rv2`, t + 1, {
        payment: { entity: payEntity(mr, 'RV', PRICE.approved, 'captured') },
        order: { entity: orderEntity(mr, 'RV') },
      }), `${RUN}-rv2`, 'revoke');
      decodeLine(sql(revocationSql({ orderId: order.order_id, actorUserId: uidOf('revoke'), reason: `${RUN} qualification` })));
      const p = await readPanel(hosts.revoke.page, preview, w);
      const proj = await pageProjection(hosts.revoke.page, apiOrigin, w);
      check('B70 a revocation with no refund row reaches entitlement_revoked, not a refund state',
        proj.body.state === 'entitlement_revoked' && proj.body.refund_kind === null
        && p.statusText === reader.stateWords('entitlement_revoked'),
        `state ${proj.body.state}; refund_kind ${proj.body.refund_kind}; ledger ${ledgerRow(w)}`);
    }

    // ---- a Cashfree purchase whose chargeback is opened, never enacted
    {
      const w = hosts.dispute.weddingId;
      const order = quote('dispute', CODE.cashfree);
      const mr = order.merchant_reference;
      const nowSec = String(Math.floor(Date.now() / 1000));
      const cf = (name, to, extra) => deliver('cashfree', cfDoc('PAYMENT_STATE_CHANGED', `${RUN}-${name}`,
        new Date().toISOString(), {
          payment_order_id: mr, cf_payment_id: `pay_${RUN}`, cf_order_id: `order_${RUN}`,
          payment_amount: (PRICE.cashfree / 100).toFixed(2), currency_code: 'INR',
          payment_state_change: { to }, ...extra,
        }), null, 'dispute', nowSec);
      cf('cf1', 'PENDING');
      cf('cf2', 'COMPLETED');
      const cb = deliver('cashfree', cfDoc('CHARGEBACK_CREATED', `${RUN}-cf3`, new Date().toISOString(), {
        chargeback_id: `cb_${RUN}`, cf_payment_id: `pay_${RUN}`, cf_order_id: `order_${RUN}`,
        payment_order_id: mr, chargeback_amount: (PRICE.cashfree / 100).toFixed(2), currency_code: 'INR',
      }), null, 'dispute', nowSec);
      const p = await readPanel(hosts.dispute.page, preview, w);
      const proj = await pageProjection(hosts.dispute.page, apiOrigin, w);
      check('B80 a chargeback holds for review and leaves the purchase and the right in place',
        cb.applied_effect === 'chargeback_hold_for_review' && proj.body.state === 'dispute_open_review'
        && proj.body.order_status === 'captured' && proj.body.entitlement_status === 'active'
        && p.statusText === reader.stateWords('dispute_open_review'),
        `effect ${cb.applied_effect}; state ${proj.body.state}; order ${proj.body.order_status}`);
    }

    // ---- a quote whose own expiry has passed, closed by the designed function
    {
      const w = hosts.expire.weddingId;
      const order = quote('expire', CODE.approved);
      sql(`update private.commerce_orders set quote_expires_at = now() - interval '1 hour' where id = '${order.order_id}'`);
      decodeLine(sql(expireOrderSql({ orderId: order.order_id, actorUserId: uidOf('expire') })));
      const p = await readPanel(hosts.expire.page, preview, w);
      const proj = await pageProjection(hosts.expire.page, apiOrigin, w);
      check('B90 an expired quote reaches quote_expired on both layers',
        proj.body.state === 'quote_expired' && ledgerRow(w).startsWith('order=expired')
        && p.statusText === reader.stateWords('quote_expired'),
        `state ${proj.body.state}; ledger ${ledgerRow(w)}`);
    }

    // ---- the door, from a session that does not own the wedding
    {
      const stolen = hosts.flow.weddingId;
      // The stranger gets its own panel first, for a reason that is not tidiness: a page parked on
      // `/configure` has made no authenticated RPC call at all, so the tier would have no session to
      // borrow, and the cross-wedding answer would be an artefact of the harness rather than the door's.
      const ownPanel = await readPanel(hosts.stranger.page, preview, hosts.stranger.weddingId);
      check('B94 the second host has a real session, reading its own wedding as unpurchased',
        ownPanel.statusText === reader.stateWords('no_purchase'),
        `page ${JSON.stringify(ownPanel.statusText)}`);
      const proj = await pageProjection(hosts.stranger.page, apiOrigin, stolen);
      const code = String(proj.body?.code ?? '');
      check('B95 a signed-in non-owner is refused at the door, not answered',
        proj.status === 403 && (code === '42501' || /permission|privilege/i.test(String(proj.body?.message ?? ''))),
        `http ${proj.status}; code ${code || 'none'}; message ${String(proj.body?.message ?? '').slice(0, 80)}`);
      const strangerPanel = await readPanel(hosts.stranger.page, preview, stolen).catch((error) => ({
        bodyText: `navigation refused: ${error.message.slice(0, 120)}`, paragraphs: [], alerts: [], statusText: null,
      }));
      check('B96 and the host page offers that session no reading of the purchase',
        strangerPanel.statusText === null
        || /could not be read|no words|Loading/i.test(`${strangerPanel.alerts.join(' ')} ${strangerPanel.bodyText}`),
        JSON.stringify(strangerPanel.statusText ?? strangerPanel.bodyText.slice(0, 160)));
    }

    // ---- the guest, public and review doors carry no payment dependency
    {
      const door = await browser.newPage('doors');
      opened.push(door);
      const seen = [];
      for (const path of ['/g/nonexistent-token', '/i/nonexistent-token', '/r/nonexistent-token']) {
        await door.goto(`${preview}${path}`);
        await door.waitForSelector('main, body', 15_000);
        seen.push({ path, mounted: (await door.bodyText()).replace(/\s+/g, ' ').slice(0, 60) });
      }
      const requests = await door.networkLog();
      const commerce = requests.filter((e) => /commerce_host_summary|commerce/i.test(e.url));
      check('B100 a door page makes no commerce call, signed in or out',
        commerce.length === 0, `${commerce.length} commerce request(s) from ${seen.map((s) => s.path).join(', ')}`);
      const hosts_ = [...new Set(requests.map((e) => { try { return new URL(e.url).host; } catch { return 'relative'; } }))];
      check('B101 and the whole page load stayed on this machine',
        hosts_.every((h) => h.startsWith('127.0.0.1:') || h === 'relative' || h === preview.replace(/^http:\/\//, '')),
        hosts_.join(', '));
      log(`doors mounted: ${seen.map((s) => `${s.path} -> ${JSON.stringify(s.mounted.slice(0, 40))}`).join('; ')}`);
    }

    // ---- the built bytes
    {
      const dir = `${REPO}dist/assets`;
      const chunks = readdirSync(dir).filter((f) => f.endsWith('.js'));
      const withDoor = chunks.filter((f) => readFileSync(`${dir}/${f}`, 'utf8').includes('commerce_host_summary'));
      const guestChunk = chunks.find((f) => f.startsWith('GuestDoor-'));
      const publicChunk = chunks.find((f) => f.startsWith('PublicInvitation-'));
      const editChunk = chunks.find((f) => f.startsWith('EditProject-'));
      check('B110 the money door is reachable only from the host editor chunk',
        withDoor.length === 1 && withDoor[0] === editChunk,
        `chunks carrying it: ${withDoor.join(', ')} (edit ${editChunk})`);
      check('B111 and neither guest chunk mentions it',
        !withDoor.includes(guestChunk) && !withDoor.includes(publicChunk),
        `GuestDoor ${guestChunk}; PublicInvitation ${publicChunk}`);
    }

    // ---- what actually left the browser
    {
      const serviceHash = sha(envFile.SUPABASE_LOCAL_SERVICE_ROLE_KEY ?? '');
      const secretHash = sha(envFile.SUPABASE_LOCAL_SECRET_KEY ?? '');
      const publishableHash = sha(envFile.SUPABASE_LOCAL_PUBLISHABLE_KEY ?? '');
      const dbUrlHash = sha(envFile.SUPABASE_LOCAL_DB_URL ?? '');
      const captured = [];
      const urlLeaks = [];
      for (const p of opened) {
        const entries = await p.networkLog();
        for (const e of entries) {
          for (const [name, value] of Object.entries(e.headers ?? {})) {
            captured.push({ name, hash: sha(value) });
          }
          if (!/127\.0\.0\.1|localhost/.test(e.url)) urlLeaks.push(e.url.slice(0, 80));
        }
      }
      const never = (hash) => captured.every((c) => c.hash !== hash);
      check('B120 no captured request header is the stack\'s service-role key', never(serviceHash),
        `${captured.length} header value(s) hashed, none matched`);
      check('B121 no captured request header is the secret key', never(secretHash), null);
      check('B122 no captured request header is the maintenance database URL', never(dbUrlHash), null);
      check('B123 the host session authenticated with the publishable key',
        captured.some((c) => c.hash === publishableHash),
        `publishable key present: ${captured.some((c) => c.hash === publishableHash)}`);
      check('B124 no request left this machine', urlLeaks.length === 0, urlLeaks.join(', ') || 'all loopback');
      const leakedSecret = captured.filter((c) => c.hash === sha(secret));
      check('B125 the webhook signing key never reached the browser', leakedSecret.length === 0, null);
    }

    // ---- residue, stated rather than promised away
    {
      sql(`delete from private.commerce_packages where package_code like '${RUN}-%'`);
      const after = {
        packages: countOf(cell, 'from private.commerce_packages', 'packages after'),
        thisRunPackages: countOf(cell, `from private.commerce_packages where package_code like '${RUN}-%'`, 'leftover prices'),
      };
      check('B130 this run\'s catalogue rows are gone',
        after.thisRunPackages === '0' && after.packages === before.packages,
        `before ${before.packages}, after ${after.packages}`);
      const residue = {
        orders: countOf(cell, 'from private.commerce_orders', 'orders after'),
        weddings: countOf(cell, 'from public.weddings', 'weddings after'),
        users: countOf(cell, 'from auth.users', 'users after'),
      };
      log(`residue left on the shared stack: orders ${before.orders} -> ${residue.orders}, `
        + `weddings ${before.weddings} -> ${residue.weddings}, auth users ${before.users} -> ${residue.users}. `
        + 'The fixture hosts were made through the shipped sign-up form, and their weddings own draft '
        + 'version rows that are ON DELETE NO ACTION, so this tier deletes no accounts: a cascade written '
        + 'here would be a claim about the schema that the schema has not made.');
    }
  } catch (error) {
    failures += 1;
    exitCode = error.exitCode ?? 1;
    log(`RUN STOPPED: ${String(error.message).slice(0, 400)}`);
  } finally {
    for (const p of opened) { try { await p.close(); } catch { /* gone */ } }
    try {
      const closed = await browser.close();
      log(`browser closed: profileRemoved=${closed.profileRemoved}`);
    } catch { /* the socket already dropped; the profile path is printed in the log for the cleanup line */ }
    log(`\n${results.filter((r) => r.ok).length} passed, ${failures} failed of `
      + `${results.length} case(s); free on C: now ${(freeBytes() / 1048576).toFixed(0)} MB`);
    log(`# finished ${new Date().toISOString()}`);
    log.flush();
  }
  return failures === 0 ? 0 : (exitCode === 0 ? 1 : exitCode);
}

const invokedDirectly = import.meta.url.startsWith('file:')
  && process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main({ argv: process.argv.slice(2) }).then((code) => process.exit(code), (error) => {
    process.stderr.write(`${error.message ?? error}\n`);
    process.exit(error.exitCode ?? 1);
  });
}
