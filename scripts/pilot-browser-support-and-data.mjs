#!/usr/bin/env node
// Pilot tier: the support thread and the data-request queue, driven by two real signed-in hosts on the
// built bytes, with the ledger read underneath every screen.
//
// Why this file exists. Issue #1's rule is "never certify from code existence alone", and what is known
// about these two screens so far came from mocked-client page cells (`src/test/supportPage.test.tsx`,
// `src/test/myDataPage.test.tsx`) and from door batteries in `supabase/tests/`. Those prove a screen renders
// what it is handed and that a database function behaves when called directly. Neither proves the seam: that
// the screen's own call reaches a door exposed to the role the browser really holds, on the schema the client
// really asks PostgREST for (`supportCases.ts:79-81,99-101,123,149` and `privacyRequests.ts:65,87` all go
// through `.schema('api')`), and that the sentence printed after a real write is the sentence the shipped
// copy helper writes for the row the ledger really kept. A mocked cell cannot catch that class of fault.
//
// Three layers are read for each state, because agreeing with itself is not agreeing with the database:
// the ledger's own row (`psql`, the tie-break), the wire answer from the `api` door fetched with the *page's
// own captured* credentials, and the text the host actually sees. The rendered copy is compared against
// `statusLabel`/`statusWords`/`categoryWords`/`kindWords`/`packCoverageWords` loaded out of `src/lib/`
// through Vite's SSR loader, so parity is with the shipped prose rather than with a paraphrase typed here.
//
// Cell families:
//   CR-*  the create-project language picker on these bytes — the copy `cb87cc9` shipped, read against the
//         union of `languages` over the approved releases this stack really has. Two independent routes to
//         one fact: the page's own read, and a `psql` read of `public.tradition_pack_releases`. A stack with
//         no approved release must mark all five and print the no-pack notice; a stack with one must mark
//         only what it does not speak. What must never appear either way is a sentence saying the host's own
//         draft cannot be published: the freeze-time language guard reads the *pinned* release's `languages`
//         and fires only when that is an array, so an invitation with no pack attached is not held back
//         (`docs/audits/stage-5-pack-driven-authoring-review.md` §25 measured that path to a live guest link).
//   SP-*  opening a case, the reference the page is given, the row beneath it, the thread it opens, a host
//         reply appended as an event, the list door, and the door's one-key-one-ticket rule.
//   PR-*  filing an export ask and an erasure ask through the shipped form, the replay rule for a second ask
//         of the same kind (this door has no idempotency argument — `replayed` is its answer about an
//         already-live request), and that no sentence on the screen claims a delivery.
//   XB-*  the same reads and writes attempted by a second, unrelated signed-in account. The ledger's rows are
//         the boundary; a tier that only ever asked as the owner would never find out.
//   NW-*  that nothing on these journeys touched a commerce door (the pilot is free), that the stack's
//         service-role key is on no header Chrome actually put on the wire, and that every request stayed on
//         loopback. Secrets are compared by hash and only the boolean is printed.
//   RS-01 a census of what this run left behind, tagged so it is findable.
//
// What it does NOT prove, so the report cannot over-claim: nothing about a hosted deployment (this runs
// against the throwaway local stack `localvivaahvarnam` and a loopback preview of `dist/`); nothing about an
// operator's side of either queue (that boundary is task #234's, and this file never grants itself one);
// nothing about the delivery of a data copy, which this build does not do; nothing about email verification
// (#254) or the publish-to-guest journey (#255).
//
// Fixture rows are deliberately NOT deleted. `private.support_cases`, `private.support_case_events` and
// `private.privacy_requests` each carry a `*_no_client_delete` trigger
// (`supabase/migrations/20261020190100_stage11_support_cases.sql:317,481` and
// `supabase/migrations/20261020190300_stage11_privacy_intake.sql:224`), and the case table's own comment says
// a ticket "is evidence about a wedding, and it outlives an erased account". A tier that broke open an
// append-only ledger to tidy up after itself would be repairing the wrong thing, so RS-01 counts what is
// left and names the run tag that owns it. Accounts and rows are tagged `<who>+<run tag>@example.test`, the
// shape earlier journeys on this stack already used, so the residue is filterable.
//
// Run it against the built bytes and the running local stack:
//   npm run build && npm run preview            (preview listens on 127.0.0.1:4173)
//   node scripts/pilot-browser-support-and-data.mjs \
//     --via-docker supabase_db_localvivaahvarnam \
//     --out ../p1-logs/pilot-support-data-1.txt 2>&1; echo "tier exit=$?"
// The password is derived from the run tag and never printed. No connection string, key or token is taken
// from the command line, and none is written to the evidence log.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { createServer } from 'vite';
import { assertLoopback, openBrowser } from './stage5-browser-driver.mjs';
import { resolveTarget, runPsql } from './stage10-commerce-driver.mjs';

// `import.meta.url`'s pathname is percent-encoded and this account's name contains a space, so the repo
// root comes from `import.meta.dirname` (decoded) rather than from a URL. Trailing separator so callers can
// concatenate.
const REPO = `${resolve(import.meta.dirname, '..')}${sep}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The ledger's own grammars, copied from the CHECKs rather than invented: `case_ref` is minted from the
// base32 alphabet `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567` (`…support_cases.sql:172-173`) and constrained to
// `^SV-[A-Z2-7]{8}$` (`…:91`); `request_ref` to `^PR-[A-Z2-7]{8}$` (`…privacy_intake.sql:43`).
const SV_REF = /^SV-[A-Z2-7]{8}$/;
const PR_REF = /^PR-[A-Z2-7]{8}$/;
const FIELD_SEP = '~';

class Refusal extends Error {
  constructor(message, code = 2) { super(message); this.exitCode = code; }
}

const USAGE = `usage: node scripts/pilot-browser-support-and-data.mjs [options]
  --via-docker <supabase_db_...>  the local stack's database container (default
                                 supabase_db_localvivaahvarnam)
  --preview <origin>             the built app being measured (loopback only, default
                                 http://127.0.0.1:4173)
  --api-origin <origin>          the stack's API origin (loopback only; default is .env.local's
                                 SUPABASE_LOCAL_URL, which is what the built app is configured with)
  --cdp-port <n>                 the browser harness's own DevTools port (default 9421)
  --floor-mb <n>                 refuse to start, and stop mid-run, below this much free disk
                                 on C: (default 120)
  --run-tag <s>                  the label this run's fixture rows carry (default: a random one)
  --out <path>                   where to write the evidence log (default ../p1-logs/pilot-support-data.txt)
  --shots <dir>                  where to write the screenshots (default: beside --out)
No connection string, key or token is taken from the command line, and none is printed.`;

const OPTION_KEYS = [
  'via-docker', 'preview', 'api-origin', 'cdp-port', 'floor-mb', 'run-tag', 'out', 'shots',
];

function readOptions(argv) {
  const raw = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { process.stdout.write(`${USAGE}\n`); process.exit(0); }
    const key = String(a).replace(/^--/, '');
    if (!OPTION_KEYS.includes(key)) throw new Refusal(`refused: unknown option --${key}.\n${USAGE}`);
    if (key in raw) throw new Refusal(`refused: --${key} was given twice.`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Refusal(`refused: --${key} wants a value.`);
    i += 1;
    raw[key] = value;
  }
  const out = raw.out ?? resolve(REPO, '..', 'p1-logs', 'pilot-support-data.txt');
  const opts = {
    'via-docker': raw['via-docker'] ?? 'supabase_db_localvivaahvarnam',
    preview: raw.preview ?? 'http://127.0.0.1:4173',
    'api-origin': raw['api-origin'] ?? null,
    cdpPort: raw['cdp-port'] === undefined ? 9421 : Number(raw['cdp-port']),
    floorMb: raw['floor-mb'] === undefined ? 120 : Number(raw['floor-mb']),
    runTag: raw['run-tag'] ?? `pilotui-${randomBytes(5).toString('hex')}`,
    out: resolve(out),
    shots: resolve(raw.shots ?? dirname(out)),
  };
  for (const label of ['preview', 'api-origin']) {
    if (opts[label] === null) continue;
    try { assertLoopback(opts[label], label); }
    catch { throw new Refusal(`refused: --${label}=${opts[label]} is not a loopback origin.`); }
  }
  if (!Number.isInteger(opts.cdpPort) || opts.cdpPort < 1 || opts.cdpPort > 65_535) {
    throw new Refusal('refused: --cdp-port is not a port.');
  }
  if (!Number.isInteger(opts.floorMb) || opts.floorMb < 0) {
    throw new Refusal('refused: --floor-mb is not a byte count.');
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,32}$/.test(opts.runTag)) {
    throw new Refusal('refused: --run-tag must be 3-33 characters of [a-z0-9._-], because it is embedded in '
      + 'an email address, in SQL literals and in file names.');
  }
  return opts;
}

const freeMiB = () => {
  const s = statfsSync('C:/');
  return Math.floor((s.bfree * s.bsize) / (1024 * 1024));
};

const sha = (value) => createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 16);

/** `.env.local`, for the API origin and the two keys. The service-role key is used exactly once — hashed
 *  against the headers Chrome put on the wire — so the only thing this process can print about it is a
 *  boolean. It is never written to the log. */
function readEnvLocal() {
  const text = readFileSync(`${REPO}.env.local`, 'utf8');
  const value = (name) => {
    const m = new RegExp(`^${name}=(.*)$`, 'm').exec(text);
    return m ? m[1].trim() : null;
  };
  return {
    apiUrl: value('SUPABASE_LOCAL_URL'),
    serviceRole: value('SUPABASE_LOCAL_SERVICE_ROLE_KEY'),
    publishable: value('VITE_SUPABASE_PUBLISHABLE_KEY'),
  };
}

/** What the browser is about to run on, as bytes rather than as a claim. The pushed commit, whether the
 *  tracked tree carried anything uncommitted (an uncommitted source file would mean these bytes are not the
 *  commit's), and the digest of the built entry plus the asset names it references. */
function readBuiltBytes() {
  const git = (args) => {
    try { return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim(); }
    catch (error) { throw new Refusal(`refused: git ${args.join(' ')} did not answer (${error.message}).`); }
  };
  const head = git(['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Refusal(`refused: HEAD is not a full sha (${head}).`);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const tracked = git(['status', '--porcelain', '--untracked-files=no']);
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('node_modules'));
  const indexPath = `${REPO}dist${sep}index.html`;
  if (!existsSync(indexPath)) {
    throw new Refusal('refused: dist/index.html is not there, so nothing has been built. '
      + 'Run `npm run build` and `npm run preview` first — this tier measures built bytes, not source.');
  }
  const indexBytes = readFileSync(indexPath);
  const assets = [...indexBytes.toString('utf8').matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)]
    .map((m) => m[1]);
  const missing = assets.filter((a) => !existsSync(resolve(REPO, 'dist', a.replace(/^\//, ''))));
  return {
    head,
    branch,
    dirty: tracked.length > 0,
    dirtyList: tracked.split('\n').map((l) => l.trim()).filter((l) => l.length > 0),
    untrackedCount: untracked.length,
    indexSha: sha(indexBytes),
    indexBytes: indexBytes.length,
    assets,
    missingAssets: missing,
  };
}

// ------------------------------------------------------------------------------ the report

const lines = [];
const findings = [];
let checks = 0;
let measurements = 0;

const emit = (text) => { lines.push(text); process.stdout.write(`${text}\n`); };
const norm = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
const shown = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

/** One falsifiable claim. `actual` is always printed, so a green line can be re-read later and still say
 *  what it saw. A red line is one finding — and only one, because a duplicated finding makes a count of
 *  faults meaningless. */
function check(id, claim, actual, pass) {
  checks += 1;
  emit(`${id} [${pass ? 'PASS' : 'FAIL'}] ${claim}\n        measured: ${shown(actual)}`);
  if (!pass) findings.push(`${id}: ${claim} — ${shown(actual)}`);
  return pass;
}

/** A number this tier is not entitled to judge, recorded so the report can carry it without a verdict. */
function measure(id, what, value) {
  measurements += 1;
  emit(`${id} [MEASURE] ${what}\n        value: ${shown(value)}`);
}

/** The one line a reader scans first, and the reason it is computed here rather than at the call site: a
 *  verdict is a claim about the checks this run actually made. An aborted run never reached its claims, and
 *  a run that made none has no standing to say anything held — printing GREEN for either would be exactly
 *  the false green `docs/audits/issue-1.md` forbids, and it happened in a probe before this arm existed. */
function verdictFor(extra) {
  if (extra.length > 0) {
    return `Verdict: ABORTED — no verdict. The tier stopped before it finished claiming `
      + `${checks} checks, so nothing here is certified.`;
  }
  if (findings.length > 0) return 'Verdict: RED — at least one claim this tier makes did not hold.';
  if (checks === 0) {
    return 'Verdict: NO VERDICT — the run ended without making a single check, so it certifies nothing.';
  }
  return 'Verdict: GREEN — every claim this tier makes held on these bytes, on this stack, in this browser.';
}

function writeEvidence(extra) {
  const verdict = verdictFor(extra);
  const totals = `Totals: ${checks} checks, ${measurements} measurements, ${findings.length} findings.`;
  const body = [...lines, ...extra, ...findings.map((f) => `FINDING ${f}`), '', totals, verdict].join('\n');
  if (evidencePath === null) {
    // The options never parsed, so there is no agreed destination. Say it on stderr rather than inventing
    // one, and still print the totals and the verdict so a truncated console capture is not left without one.
    for (const f of findings) process.stderr.write(`FINDING ${f}\n`);
    process.stderr.write(`${extra.join('\n')}\n\n${totals}\n${verdict}\n`);
    return;
  }
  try {
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${body}\n`, 'utf8');
  } catch (error) {
    process.stderr.write(`could not write the evidence log (${error.message})\n`);
  }
  emit(totals);
  emit(verdict);
}

let evidencePath = null;

// ---------------------------------------------------------------------------------- the page tools

async function sleep(ms) { return new Promise((done) => setTimeout(done, ms)); }

async function waitForUrl(page, part, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const url = await page.currentUrl();
    if (url.includes(part)) return url;
    if (Date.now() > deadline) return null;
    await sleep(200);
  }
}

/** Types every field, reads each one back, and only then presses. A press aimed at a form the page had not
 *  yet painted is how an earlier tier reported a write that never happened. */
async function fillAndSubmit(page, fields, buttonWords) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    if (await page.waitForSelector(Object.keys(fields)[0], 8_000)) {
      const missing = [];
      for (const [selector, value] of Object.entries(fields)) {
        await page.setBySelector(selector, value);
        const readBack = await page.evaluate(
          `document.querySelector(${JSON.stringify(selector)})?.value ?? null`);
        if (readBack !== value) missing.push(`${selector}=${shown(readBack)}`);
      }
      if (missing.length === 0) return page.pressButton(buttonWords);
      if (attempt === 8) throw new Refusal(`the form would not hold its values: ${missing.join(', ')}`);
    }
    await sleep(300);
  }
  return 'absent';
}

/** Everything the create page says about the five language codes, read where the choice is actually made —
 *  the `<option>` nodes — plus the normalised text of the whole page, which is where its prose lives. */
const readPicker = (page) => page.evaluate(`(() => {
  const select = document.querySelector('#language');
  if (!select) return null;
  const main = document.querySelector('main');
  return {
    options: [...select.options].map((o) => ({
      value: o.value,
      text: (o.textContent || '').replace(/\\s+/g, ' ').trim(),
    })),
    helper: main ? (main.innerText || '').replace(/\\s+/g, ' ') : '',
  };
})()`);

/** The create page's own idle signal. It reads pack coverage once on mount and prints a "Checking which of
 *  these…" line while that is in flight, so waiting for the sentence to leave is waiting on the product's
 *  stated condition rather than on a sleep — and either landing state (a read that came back, a read that
 *  failed and says so) is a settled answer. What the tier may not accept is a half-read. */
async function settledPicker(page, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const picker = await readPicker(page);
    if (picker === null) {
      if (Date.now() > deadline) throw new Refusal('the language picker never mounted at /create-project.');
      await sleep(150);
      continue;
    }
    if (!picker.helper.includes('Checking which of these a reviewed pack')) return picker;
    if (Date.now() > deadline) {
      throw new Refusal('the create page never finished reading the reviewed packs; its own "Checking" '
        + 'sentence was still on the page when the tier gave up.');
    }
    await sleep(150);
  }
}

/** A host made the way the product makes a host, and a wedding made the way the product makes a wedding —
 *  both through the shipped forms, so the picker reading returned with them is a receipt for the page the
 *  pilot branch shipped rather than a description of its source. */
async function signUpHost(browser, preview, { who, email, password, weddingTitle }) {
  const page = await browser.newPage(who);
  await page.goto(`${preview}/signup`);
  await page.waitForSelector('form');
  const signed = await fillAndSubmit(page, { '#name': who, '#email': email, '#password': password }, 'Sign up');
  if (signed !== 'pressed') throw new Refusal(`${who}: the sign-up button was not pressable (${signed}).`);
  await waitForUrl(page, '/login');
  const logged = await fillAndSubmit(page, { '#email': email, '#password': password }, 'Log in');
  if (await waitForUrl(page, '/dashboard') === null) {
    throw new Refusal(`${who}: never reached a dashboard (log-in press answered ${logged}; page said: `
      + `${norm(await page.bodyText()).slice(0, 220)})`);
  }
  await page.goto(`${preview}/create-project`);
  if (!(await page.waitForSelector('#title', 20_000))) {
    throw new Refusal(`${who}: /create-project never painted its form; page said: `
      + `${norm(await page.bodyText()).slice(0, 220)}`);
  }
  const picker = await settledPicker(page);
  const created = await fillAndSubmit(page, { '#title': weddingTitle, '#language': 'en' }, 'Create Invitation Draft');
  // The shipped route after a draft is `/project/<id>/configure` (`CreateProject.tsx:87`); there is no bare
  // `/project/<id>` route, so a journey that stopped at the id would be reading a 404.
  const url = await waitForUrl(page, '/configure');
  const weddingId = url === null ? null : /\/project\/([0-9a-f-]{36})\//.exec(url)?.[1] ?? null;
  if (!weddingId || !UUID.test(weddingId)) {
    throw new Refusal(`${who}: the wedding was never formed (draft press answered ${created}; url ${url ?? 'none'}; `
      + `page said: ${norm(await page.bodyText()).slice(0, 220)})`);
  }
  const account = await page.evaluate(`(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (!key.startsWith('sb-')) continue;
      let v = null;
      try { v = JSON.parse(window.localStorage.getItem(key) || 'null'); } catch { continue; }
      const u = v?.currentSession?.user ?? v?.session?.user;
      if (u?.id) return { id: u.id, email: u.email ?? null };
    }
    return null;
  })()`);
  if (account === null || !UUID.test(account.id)) {
    throw new Refusal(`${who}: no persisted session account id could be read back from the page.`);
  }
  return { page, weddingId, account, picker, who };
}

/** The door called the way the app calls it: the `api` schema, this page's own captured bearer token, and a
 *  JSON body — never a maintenance token, because that would not be the host's session. */
async function callDoor(page, apiOrigin, name, args, label) {
  const captured = await page.rpcHeaders();
  if (captured === null) {
    throw new Refusal(`${label}: this page had not made a credentialed RPC by the time ${name} was due, so `
      + 'there is no host session for the tier to borrow.');
  }
  if (captured.profile !== 'api') {
    throw new Refusal(`${label}: the headers captured from this page route to schema ${shown(captured.profile)}, `
      + 'not `api`. The shipped readers call supabase.schema("api"), so borrowing them would be testing a '
      + 'request the product never makes.');
  }
  const res = await page.fetchFromPage(`${apiOrigin}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: captured.apikey,
      Authorization: captured.authorization,
      'Content-Type': 'application/json',
      'Content-Profile': captured.profile,
    },
    body: JSON.stringify(args),
  });
  let body = null;
  try { body = JSON.parse(res.text); } catch { body = { notJson: String(res.text).slice(0, 200) }; }
  return { status: res.status, body };
}

const statusOf = (answer) => (answer && typeof answer === 'object'
  ? `${answer.status ?? answer.code ?? '?'}${answer.message ? ` ${String(answer.message).slice(0, 120)}` : ''}`
  : String(answer).slice(0, 120));

/** One `psql` call, verbatim SQL. The literals this file sends are its own fixture strings (guarded below),
 *  never host prose, so no escaping is left to chance. */
function sqlOut(target, sql) {
  return runPsql(target, sql);
}

/** The stack's own session setting, checked before any literal is sent: with
 *  `standard_conforming_strings` off, a backslash in a value could eat a quote and the tier would be
 *  writing SQL it had not meant to write. */
function assertLiteralSafe(target) {
  const value = sqlOut(target, 'SHOW standard_conforming_strings');
  if (value !== 'on') {
    throw new Refusal('refused: standard_conforming_strings is not exactly `on`, so this tier will not send '
      + 'literals into that session.');
  }
}

const lit = (text) => {
  if (/['\\~|]/.test(text)) {
    throw new Refusal(`a fixture string carries a quote or a separator (${text.slice(0, 40)}); the tier's own `
      + 'inputs must stay out of that argument.');
  }
  return `'${text.replaceAll("'", "''")}'`;
};

// ------------------------------------------------------------------------------- the journeys

async function main(argv) {
  const opts = readOptions(argv);
  evidencePath = opts.out;
  mkdirSync(opts.shots, { recursive: true });
  const RUN = opts.runTag;
  const PASSWORD = `local-only-${RUN}`;
  const emailFor = (who) => `${who}+${RUN}@example.test`;

  const bytes = readBuiltBytes();
  const env = readEnvLocal();
  const apiOrigin = opts['api-origin'] ?? env.apiUrl;
  if (!apiOrigin) {
    throw new Refusal('refused: neither --api-origin nor .env.local\'s SUPABASE_LOCAL_URL named an API origin.');
  }
  assertLoopback(apiOrigin, 'api-origin');
  if (freeMiB() < opts.floorMb) {
    throw new Refusal(`refused: C: has ${freeMiB()} MiB free and this tier wants ${opts.floorMb} MiB.`);
  }
  const target = resolveTarget({ 'via-docker': opts['via-docker'] });

  emit('pilot support + data-request browser tier');
  emit(`run tag      : ${RUN}`);
  emit(`branch       : ${bytes.branch}`);
  emit(`head         : ${bytes.head}`);
  emit(`tracked tree : ${bytes.dirty ? `DIRTY — ${bytes.dirtyList.join(' | ')}` : 'clean'}`);
  emit(`untracked    : ${bytes.untrackedCount} path(s) outside git (none of them in the build unless imported)`);
  emit(`dist/index   : ${bytes.indexBytes} bytes, sha256 ${bytes.indexSha}…`);
  emit(`built assets : ${bytes.assets.length} referenced, ${bytes.missingAssets.length} missing on disk`);
  emit(`preview      : ${opts.preview}`);
  emit(`api origin   : ${apiOrigin}`);
  emit(`db container : ${opts['via-docker']}`);
  emit(`free disk    : ${freeMiB()} MiB`);

  // The preview must be serving the bytes just read, or the receipt would be about some other build.
  let served = null;
  try {
    const res = await fetch(`${opts.preview}/`, { headers: { accept: 'text/html' } });
    served = { status: res.status, text: await res.text() };
  } catch (error) {
    throw new Refusal(`refused: ${opts.preview} did not answer (${error.message}). Start it with `
      + '`npm run build && npm run preview`.');
  }
  check('ENV-01', 'the preview origin is serving exactly the dist/index.html this run digested, so every '
    + 'claim below is about these bytes.',
    { servedStatus: served.status, servedSha: sha(served.text), distSha: `${bytes.indexSha}…`,
      assets: bytes.assets.map((a) => a.split('/').pop()).slice(0, 4) },
    served.status === 200 && sha(served.text) === bytes.indexSha && bytes.missingAssets.length === 0);

  // The stack must answer before a browser opens, and the answer must name the Stage 11 ledger. A tier that
  // could not reach the database would otherwise report an empty list as a product verdict.
  assertLiteralSafe(target);
  const tables = sqlOut(target, `select coalesce(string_agg(table_schema||'.'||table_name, ',' order by 1),'(none)')
      from information_schema.tables
     where (table_schema, table_name) in
       (('private','support_cases'),('private','support_case_events'),('private','privacy_requests'))`);
  const want = ['private.privacy_requests', 'private.support_case_events', 'private.support_cases'];
  const haveAll = want.every((t) => tables.split(',').includes(t));
  if (!haveAll) {
    throw new Refusal(`refused: this stack does not carry the Stage 11 intake ledger (saw ${tables || 'nothing'}); `
      + 'the journeys would be measuring an absent schema, not a product.');
  }
  check('ENV-02', 'the local stack carries the support and privacy ledger these journeys write to.',
    tables, haveAll);

  // Shipped prose, loaded from source, so every parity claim compares the page with the copy that ships.
  const vite = await createServer({ root: REPO, server: { middlewareMode: true }, logLevel: 'error' });
  const supportLib = await vite.ssrLoadModule('/src/lib/supportCases.ts');
  const privacyLib = await vite.ssrLoadModule('/src/lib/privacyRequests.ts');
  const i18nLib = await vite.ssrLoadModule('/src/lib/i18n.ts');
  const codes = i18nLib.LANGUAGES.map((l) => l.code);
  if (codes.length !== 5) throw new Refusal(`refused: expected five rollout codes, got ${shown(codes)}.`);

  const browser = await openBrowser({ cdpPort: opts.cdpPort });
  let hostA = null;
  let hostB = null;
  let caseRef = null;
  let prRef = null;
  let erRef = null;
  try {
    const replyText = `Pilot ${RUN} reply: the function is at the Kalyana Mantapa, not the hall.`;
    const summaryText = `Pilot ${RUN}: the preview shows the wrong date on my second function.`;
    const noteExport = `Pilot ${RUN}: please send everything you hold for this invitation.`;
    const noteErasure = `Pilot ${RUN}: after the wedding, remove this invitation's data.`;
    for (const text of [replyText, summaryText, noteExport, noteErasure]) lit(text);

    // ---------------------------------------------- the ledger's own pack coverage, independent of the page
    const ledgerCoverage = sqlOut(target, `
      select coalesce(string_agg(l, ',' order by l), '(none)')
        from (select distinct unnest(r.languages) as l
                from public.tradition_pack_releases r
                join public.tradition_packs p on p.id = r.pack_id
               where r.status = 'approved') q`);
    const approvedCount = sqlOut(target, `select count(*) from public.tradition_pack_releases
        where status = 'approved'`);
    const ledgerCodes = ledgerCoverage === '(none)' ? [] : ledgerCoverage.split(',');
    measure('CR-00', 'the languages union over approved releases whose pack the host can also read, straight '
      + 'from the ledger (this is the fact the create page is supposed to tell a host)',
      { approvedReleases: approvedCount, codesCovered: ledgerCodes });

    // ----------------------------------------------------- CR-* the create-project language picker
    hostA = await signUpHost(browser, opts.preview, {
      who: 'pilot-host-a', email: emailFor('pilot-host-a'), password: PASSWORD,
      weddingTitle: `Pilot ${RUN} A`,
    });
    hostB = await signUpHost(browser, opts.preview, {
      who: 'pilot-host-b', email: emailFor('pilot-host-b'), password: PASSWORD,
      weddingTitle: `Pilot ${RUN} B`,
    });

    const picker = hostA.picker;
    const marked = picker.options
      .filter((o) => o.text.includes('no reviewed pack speaks this language'))
      .map((o) => o.value);
    const expectMarked = codes.filter((c) => !ledgerCodes.includes(c));

    check('CR-01', 'all five rollout codes are still offered — the page may warn about one, but narrowing '
      + 'the list would be this screen inventing a limit the product does not have.',
      picker.options.map((o) => o.value),
      codes.every((c) => picker.options.some((o) => o.value === c)));

    check('CR-02', 'the page did not report a failed pack read: its own two `.from()` reads resolve against '
      + 'the deployed stack, which is the seam a mocked cell cannot reach.',
      { failedReadSentence: picker.helper.includes('could not be read just now'),
        pageSaid: picker.helper.slice(0, 200) },
      !picker.helper.includes('could not be read just now'));

    check('CR-03', 'the picker marks exactly the languages the ledger says no approved pack speaks — the '
      + 'page\'s read and a direct `psql` read of the same fact agree.',
      { pageMarked: marked, ledgerUncovered: expectMarked },
      JSON.stringify([...marked].sort()) === JSON.stringify([...expectMarked].sort()));

    check('CR-04', 'no sentence on the page tells a host their own draft cannot be published. What a missing '
      + 'pack holds back is reviewed wording, not the host\'s words: the freeze guard reads the pinned '
      + 'release\'s `languages` and fires only when it is an array, so a packless invitation still freezes '
      + 'and publishes (§25 measured that path to a live guest link).',
      { publishRefusalSentences: [
        ...picker.options.filter((o) => /cannot be published|can not be sent|not be published/i
          .test(o.text)).map((o) => o.value),
      ].join('+') || 'none',
        helperMentions: /draft .*cannot be published|cannot publish this/i.test(picker.helper) },
      picker.options.every((o) => !/cannot be published|can not be sent|not be published/i.test(o.text))
        && !/draft .*cannot be published|cannot publish this/i.test(picker.helper));

    const noPack = ledgerCodes.length === 0;
    check('CR-05', noPack
      ? 'with no approved pack on this stack the page says so outright and says the host\'s own words are '
        + 'enough to publish.'
      : 'with an approved pack on this stack the page does not print the no-pack notice — that sentence '
        + 'belongs to a different database state.',
      { approvedReleases: approvedCount,
        noticeRendered: picker.helper.includes('No reviewed pack is installed in this build at all') },
      noPack
        ? picker.helper.includes('No reviewed pack is installed in this build at all')
          && picker.helper.includes('that is enough to publish')
        : !picker.helper.includes('No reviewed pack is installed in this build at all'));

    check('CR-06', 'a second, independent session saw the same picker — the coverage read is a fact about '
      + 'the stack, not about one page\'s luck.',
      { hostA: marked, hostB: hostB.picker.options
        .filter((o) => o.text.includes('no reviewed pack speaks this language')).map((o) => o.value) },
      JSON.stringify([...marked].sort()) === JSON.stringify([...hostB.picker.options]
        .filter((o) => o.text.includes('no reviewed pack speaks this language')).map((o) => o.value).sort()));

    check('CR-07', 'a draft was still created through that form on this stack, for both accounts — the '
      + 'picker\'s verdict did not stop the product.',
      { hostAWedding: `${hostA.weddingId.slice(0, 8)}…`, hostBWedding: `${hostB.weddingId.slice(0, 8)}…`,
        distinct: hostA.weddingId !== hostB.weddingId },
      UUID.test(hostA.weddingId) && UUID.test(hostB.weddingId) && hostA.weddingId !== hostB.weddingId);

    await hostA.page.goto(`${opts.preview}/create-project`);
    await hostA.page.waitForSelector('#language');
    await settledPicker(hostA.page);
    await hostA.page.screenshot(`${opts.shots}${sep}pilot-${RUN}-create-picker.png`);

    // --------------------------------------------------------- SP-* the support journey, as its host
    await hostA.page.goto(`${opts.preview}/support`);
    await hostA.page.waitForSelector('h1');
    const openCompose = await hostA.page.pressButton('Write a new message');
    const formMounted = await hostA.page.waitForSelector('#support-summary', 15_000);
    const subjectOptions = await hostA.page.evaluate(`(() => {
      const s = document.querySelector('#support-subject');
      return s ? { values: [...s.options].map((o) => o.value), count: s.options.length } : null;
    })()`);
    check('SP-01', 'the support screen offers a host the way to write, and pressing it mounts the form the '
      + 'product actually files from.',
      { openCompose, formMounted,
        subject: subjectOptions === null ? 'no subject picker'
          : { weddingIsAnOption: subjectOptions.values.includes(hostA.weddingId),
              accountOption: subjectOptions.values.includes('account'), count: subjectOptions.count } },
      openCompose === 'pressed' && formMounted === true
        && subjectOptions !== null && subjectOptions.values.includes(hostA.weddingId)
        && subjectOptions.values.includes('account'));

    await hostA.page.setBySelector('#support-subject', hostA.weddingId);
    await hostA.page.setBySelector('#support-category', 'invitation_access');
    await hostA.page.setBySelector('#support-severity', 'normal');
    await hostA.page.setBySelector('#support-summary', summaryText);
    const readBack = await hostA.page.evaluate(`(() => {
      const v = (s) => document.querySelector(s)?.value ?? null;
      return { subject: v('#support-subject'), category: v('#support-category'),
        severity: v('#support-severity'), summary: v('#support-summary') };
    })()`);
    check('SP-02', 'every value the host chose is what the form holds when it is pressed — including the '
      + 'invitation, which is carried as an id rather than as its label.',
      { subjectIsWeddingId: readBack.subject === hostA.weddingId, category: readBack.category,
        severity: readBack.severity, summaryIsTypedText: readBack.summary === summaryText },
      readBack.subject === hostA.weddingId && readBack.category === 'invitation_access'
        && readBack.severity === 'normal' && readBack.summary === summaryText);

    const sentPress = await hostA.page.pressButtonWhenReady('Send message');
    const receiptShown = await hostA.page.waitForText('Sent. Its reference is', 25_000);
    const afterSend = norm(await hostA.page.bodyText());
    caseRef = receiptShown ? /Sent\. Its reference is (SV-[A-Z2-7]{8})/.exec(afterSend)?.[1] ?? null : null;
    check('SP-03', 'the send went through the shipped surface and the page gave the host a reference in the '
      + 'grammar its own ledger enforces (`^SV-[A-Z2-7]{8}$`).',
      { sentPress, receiptShown, caseRef, pageSaid: caseRef === null ? afterSend.slice(0, 260) : 'ok' },
      sentPress === 'pressed' && receiptShown === true && caseRef !== null && SV_REF.test(caseRef));

    const ledgerRow = sqlOut(target, `
      select case_ref||'${FIELD_SEP}'||category||'${FIELD_SEP}'||severity||'${FIELD_SEP}'||status
             ||'${FIELD_SEP}'||coalesce(wedding_id::text,'null')||'${FIELD_SEP}'||requester_user_id::text
             ||'${FIELD_SEP}'||opened_by_user_id::text||'${FIELD_SEP}'||host_summary
        from private.support_cases where case_ref = ${lit(caseRef ?? 'SV-IMPOSSIBLE')}`);
    const f = ledgerRow.split(FIELD_SEP);
    check('SP-04', 'the ledger kept one row whose topic, urgency, status, subject invitation, owner and '
      + 'summary are the ones this host named — nothing on the page is decorative.',
      { ref: f[0], category: f[1], severity: f[2], status: f[3], wedding: `${(f[4] ?? '').slice(0, 8)}…`,
        ownerIsThisAccount: f[5] === hostA.account.id, openedByMatchesOwner: f[6] === f[5],
        summaryIsWhatWasTyped: f[7] === summaryText },
      f[1] === 'invitation_access' && f[2] === 'normal' && f[3] === 'open'
        && f[4] === hostA.weddingId && f[5] === hostA.account.id && f[6] === f[5]
        && f[7] === summaryText);

    const threadCall = caseRef === null
      ? { status: 'not attempted', body: null }
      : await callDoor(hostA.page, apiOrigin, 'get_my_support_case', { p_case_ref: caseRef }, 'host A thread');
    check('SP-05', 'the deployed `api` door answers for the row this page just wrote, using the host\'s own '
      + 'captured token — the seam between the screen\'s `.schema("api")` call and what the stack exposes.',
      { status: threadCall.status, doorRef: threadCall.body?.case_ref ?? null,
        replyAllowed: threadCall.body?.reply_allowed ?? null,
        eventsSent: Array.isArray(threadCall.body?.events) ? threadCall.body.events.length : null,
        hostWordsBack: threadCall.body?.host_summary === summaryText },
      threadCall.status === 200 && threadCall.body?.case_ref === caseRef
        && threadCall.body?.host_summary === summaryText
        && threadCall.body?.reply_allowed === true);

    // Layer 3: the thread the host is now looking at, opened from the receipt the product itself printed.
    const openThread = await hostA.page.pressButton('open the thread');
    const threadMounted = await hostA.page.waitForSelector('#support-reply', 20_000);
    const threadText = norm(await hostA.page.bodyText());
    const expectedStatusWords = supportLib.statusWords('open');
    const expectedStatusLabel = supportLib.statusLabel('open');
    check('SP-06', 'the receipt\'s own link opens the thread, which shows the host their words back and says '
      + 'where it stands in the shipped `statusWords` sentence — not a page-local paraphrase.',
      { openThread, replyBoxMounted: threadMounted, refShown: threadText.includes(`Reference ${caseRef}`),
        hostWordsShown: threadText.includes(summaryText),
        statusSentenceShown: threadText.includes(expectedStatusWords) },
      openThread === 'pressed' && threadMounted === true
        && threadText.includes(`Reference ${caseRef}`)
        && threadText.includes(summaryText) && threadText.includes(expectedStatusWords));
    measure('SP-07', 'the shipped short label for this status, recorded so the list cell below has something '
      + 'to look for that was not typed into this file', expectedStatusLabel);

    const beforeReplyEvents = sqlOut(target, `
      select count(*) from private.support_case_events e
        join private.support_cases c on c.id = e.case_id
       where c.case_ref = ${lit(caseRef)}`);
    await hostA.page.setBySelector('#support-reply', replyText);
    const replyPress = await hostA.page.pressButtonWhenReady('Send reply');
    const replyShown = await hostA.page.waitForText(replyText, 25_000);
    const hostMessageRows = sqlOut(target, `
      select count(*)||'${FIELD_SEP}'||coalesce(max(e.seq)::text,'none')
        from private.support_case_events e
        join private.support_cases c on c.id = e.case_id
       where c.case_ref = ${lit(caseRef)} and e.kind = 'message_host'
         and e.actor_kind = 'host' and e.body = ${lit(replyText)}`);
    const afterReplyEvents = sqlOut(target, `
      select count(*) from private.support_case_events e
        join private.support_cases c on c.id = e.case_id
       where c.case_ref = ${lit(caseRef)}`);
    const [replyRows, replySeq] = hostMessageRows.split(FIELD_SEP);
    check('SP-08', 'a host reply appends exactly one event row of the message kind written by the host, '
      + 'carrying the reply\'s own text, and the thread re-reads it back to them.',
      { replyPress, replyShown, rowsHoldingThatBody: replyRows, seq: replySeq,
        eventsBefore: beforeReplyEvents, eventsAfter: afterReplyEvents },
      replyPress === 'pressed' && replyShown === true && replyRows === '1'
        && Number(afterReplyEvents) === Number(beforeReplyEvents) + 1);

    const threadDoor = await callDoor(hostA.page, apiOrigin, 'get_my_support_case', { p_case_ref: caseRef },
      'host A thread after reply');
    const doorEvents = Array.isArray(threadDoor.body?.events) ? threadDoor.body.events : [];
    const doorReply = doorEvents.find((e) => e.body === replyText);
    check('SP-09', 'the door\'s thread projection carries the reply as a host message, and no other kind of '
      + 'row — the projection\'s filter (`message_host` and `status` only) is what a host sees, not the '
      + 'whole ledger.',
      { status: threadDoor.status, eventCount: doorEvents.length,
        kindsSeen: [...new Set(doorEvents.map((e) => e.kind))],
        replyFound: doorReply === undefined ? null
          : { seq: doorReply.seq, actorKind: doorReply.actor_kind } },
      threadDoor.status === 200 && doorReply !== undefined && doorReply.actor_kind === 'host'
        && doorEvents.every((e) => e.kind === 'message_host' || e.kind === 'status'));

    const listDoor = await callDoor(hostA.page, apiOrigin, 'get_my_support_cases',
      { p_status: null, p_limit: null }, 'host A list');
    const listed = Array.isArray(listDoor.body?.cases) ? listDoor.body.cases : null;
    check('SP-10', 'the list door, called with this host\'s token, returns the case they just opened — and '
      + 'only their own.',
      { status: listDoor.status, refs: listed ? listed.map((c) => c.case_ref) : statusOf(listDoor.body) },
      listDoor.status === 200 && listed !== null && listed.some((c) => c.case_ref === caseRef));

    // The product's own list row, reopened after a fresh load, addressed by the words on the row.
    await hostA.page.goto(`${opts.preview}/support`);
    await hostA.page.waitForSelector('h1');
    const rowLabel = supportLib.categoryWords('invitation_access');
    const rowPress = await hostA.page.pressButton(rowLabel);
    const reopened = await hostA.page.waitForSelector('#support-reply', 20_000);
    const reopenText = norm(await hostA.page.bodyText());
    check('SP-11', 'a ticket that is only in the ledger is still reachable from the screen after a reload: '
      + 'the row is labelled with the shipped topic words, and opening it brings back this host\'s own '
      + 'thread and their reply.',
      { rowLabel, rowPress, reopened, refShown: reopenText.includes(`Reference ${caseRef}`),
        replyStillThere: reopenText.includes(replyText) },
      rowPress === 'pressed' && reopened === true && reopenText.includes(`Reference ${caseRef}`)
        && reopenText.includes(replyText));
    await hostA.page.screenshot(`${opts.shots}${sep}pilot-${RUN}-support-thread.png`);

    // One key, one ticket — the door's rule, seen twice through one real session. Not through the UI: the
    // shipped form mints a fresh key per submission (`Support.tsx`'s `keyRef`), so a double press there is
    // *meant* to be two tickets, and asserting otherwise would be testing the wrong claim.
    const dupKey = await hostA.page.evaluate('crypto.randomUUID()');
    const dupArgs = {
      p_wedding_id: hostA.weddingId, p_category: 'other', p_severity: 'low',
      p_summary: `Pilot ${RUN}: idempotency probe, sent twice with one key.`,
      p_idempotency_key: dupKey,
    };
    lit(dupArgs.p_summary);
    const firstDup = await callDoor(hostA.page, apiOrigin, 'open_support_case', dupArgs, 'host A dup 1');
    const secondDup = await callDoor(hostA.page, apiOrigin, 'open_support_case', dupArgs, 'host A dup 2');
    const rowsForKey = sqlOut(target, `
      select count(*)||'${FIELD_SEP}'||coalesce(string_agg(case_ref, ',' order by case_ref),'none')
        from private.support_cases where open_idempotency_key = ${lit(dupKey)}::uuid`);
    const [dupCount, dupRefs] = rowsForKey.split(FIELD_SEP);
    check('SP-12', 'one idempotency key files one ticket: the second call with the same key answers with the '
      + 'same reference, flags itself a replay, and leaves exactly one row in the ledger.',
      { firstStatus: firstDup.status, secondStatus: secondDup.status,
        firstRef: firstDup.body?.case_ref ?? null, secondRef: secondDup.body?.case_ref ?? null,
        secondReplayed: secondDup.body?.replayed ?? null, rowsForKey: dupCount, refs: dupRefs },
      firstDup.status === 200 && secondDup.status === 200
        && firstDup.body?.case_ref !== undefined && firstDup.body?.case_ref === secondDup.body?.case_ref
        && secondDup.body?.replayed === true && dupCount === '1');

    // --------------------------------------------------- PR-* the data-request queue, as the same host
    await hostA.page.goto(`${opts.preview}/my-data`);
    await hostA.page.waitForSelector('h1');
    const filePress = await hostA.page.pressButton('File a request');
    const privacyForm = await hostA.page.waitForSelector('#privacy-kind', 15_000);
    check('PR-01', 'the data screen offers a request form and mounts it when asked.',
      { filePress, formMounted: privacyForm,
        kinds: await hostA.page.evaluate(`(() => {
          const s = document.querySelector('#privacy-kind');
          return s ? [...s.options].map((o) => o.value || '(empty)') : null;
        })()`) },
      filePress === 'pressed' && privacyForm === true);

    await hostA.page.setBySelector('#privacy-kind', 'export');
    await hostA.page.setBySelector('#privacy-wedding', hostA.weddingId);
    await hostA.page.setBySelector('#privacy-note', noteExport);
    const filedPress = await hostA.page.pressButtonWhenReady('File this request');
    const filedText = norm(await hostA.page.bodyText());
    prRef = /Filed\. Its reference is (PR-[A-Z2-7]{8})/.exec(filedText)?.[1] ?? null;
    check('PR-02', 'a filed copy request comes back with a reference in the grammar the ledger enforces, '
      + 'and the page closes the form it filed from.',
      { filedPress, prRef, pageSaid: prRef === null ? filedText.slice(0, 260) : 'ok' },
      filedPress === 'pressed' && prRef !== null && PR_REF.test(prRef));

    const prRow = sqlOut(target, `
      select request_ref||'${FIELD_SEP}'||kind||'${FIELD_SEP}'||status||'${FIELD_SEP}'
             ||coalesce(wedding_id::text,'null')||'${FIELD_SEP}'||requester_user_id::text||'${FIELD_SEP}'
             ||coalesce(host_note,'null')
        from private.privacy_requests where request_ref = ${lit(prRef ?? 'PR-IMPOSSIBLE')}`);
    const pf = prRow.split(FIELD_SEP);
    check('PR-03', 'the ledger kept the ask as a received copy request, owned by this account, about this '
      + 'invitation, carrying the host\'s own note.',
      { ref: pf[0], kind: pf[1], status: pf[2], wedding: `${(pf[3] ?? '').slice(0, 8)}…`,
        ownerIsThisAccount: pf[4] === hostA.account.id, noteIsWhatWasTyped: pf[5] === noteExport },
      pf[1] === 'export' && pf[2] === 'received' && pf[3] === hostA.weddingId
        && pf[4] === hostA.account.id && pf[5] === noteExport);

    const privacyDoor = await callDoor(hostA.page, apiOrigin, 'get_my_privacy_requests', {},
      'host A privacy queue');
    const queue = Array.isArray(privacyDoor.body?.requests) ? privacyDoor.body.requests : null;
    check('PR-04', 'the queue door, called with this host\'s token, lists the request they just filed.',
      { status: privacyDoor.status, count: privacyDoor.body?.count ?? null,
        refs: queue ? queue.map((r) => r.request_ref) : statusOf(privacyDoor.body) },
      privacyDoor.status === 200 && queue !== null && queue.some((r) => r.request_ref === prRef));

    const queueText = norm(await hostA.page.bodyText());
    const expectedPrivacyWords = privacyLib.statusWords('received');
    check('PR-05', 'the queue row prints the shipped `statusWords` for the row\'s real status next to the '
      + 'reference and the host\'s own note — a state in words, not a badge colour.',
      { sentenceShown: queueText.includes(expectedPrivacyWords), kindShown: queueText
        .includes(privacyLib.kindWords('export')), noteShown: queueText.includes(noteExport) },
      queueText.includes(expectedPrivacyWords) && queueText.includes(privacyLib.kindWords('export'))
        && queueText.includes(noteExport));

    // The same kind, same wedding, same account: the door has no idempotency argument, so the replay rule is
    // its answer about an already-live request. Through the shipped form this time.
    await hostA.page.pressButton('File a request');
    await hostA.page.waitForSelector('#privacy-kind', 15_000);
    await hostA.page.setBySelector('#privacy-kind', 'export');
    await hostA.page.setBySelector('#privacy-wedding', hostA.weddingId);
    await hostA.page.setBySelector('#privacy-note', `Pilot ${RUN}: pressing the same ask again.`);
    const replayPress = await hostA.page.pressButtonWhenReady('File this request');
    const replayText = norm(await hostA.page.bodyText());
    const rowsForReplay = sqlOut(target, `
      select count(*) from private.privacy_requests
       where requester_user_id = ${lit(hostA.account.id)}::uuid and wedding_id = ${lit(hostA.weddingId)}::uuid
         and kind = 'export' and status in ('received','identity_verification_requested','queued_for_stage13')`);
    check('PR-06', 'a second copy ask for the same invitation is answered as the one already open — the page '
      + 'says nothing new was filed, quotes the original reference, and the live count is still one.',
      { replayPress, replaySentence: replayText.includes('You already had this request open'),
        sameRefQuoted: prRef !== null && replayText.includes(prRef), liveRows: rowsForReplay,
        pageSaid: replayText.slice(0, 240) },
      replayPress === 'pressed' && prRef !== null && rowsForReplay === '1'
        && replayText.includes('You already had this request open') && replayText.includes(prRef));

    await hostA.page.pressButton('File a request');
    await hostA.page.waitForSelector('#privacy-kind', 15_000);
    await hostA.page.setBySelector('#privacy-kind', 'erasure');
    await hostA.page.setBySelector('#privacy-wedding', hostA.weddingId);
    await hostA.page.setBySelector('#privacy-note', noteErasure);
    const erasurePress = await hostA.page.pressButtonWhenReady('File this request');
    const erasureText = norm(await hostA.page.bodyText());
    erRef = /Filed\. Its reference is (PR-[A-Z2-7]{8})/.exec(erasureText)?.[1] ?? null;
    const erRow = sqlOut(target, `
      select kind||'${FIELD_SEP}'||status from private.privacy_requests
       where request_ref = ${lit(erRef ?? 'PR-IMPOSSIBLE')}`);
    check('PR-07', 'an erasure ask files as its own live row, distinct from the copy ask — the two kinds a '
      + 'customer can name are both reachable, and neither cancels the other.',
      { erasurePress, erRef, erRow, distinctFromExport: erRef !== null && erRef !== prRef },
      erasurePress === 'pressed' && erRef !== null && erRow.split(FIELD_SEP)[0] === 'erasure'
        && erRow.split(FIELD_SEP)[1] === 'received' && erRef !== prRef);

    const overclaim = /\b(has been|we have|we just|will be)\s+(deleted|removed|erased|exported|sent to you)\b/i
      .exec(await hostA.page.bodyText());
    check('PR-08', 'nothing on the screen says a copy was delivered or a removal happened: it records the '
      + 'ask and says a person does the work.',
      { overclaimFound: overclaim === null ? 'none' : overclaim[0],
        honestyLine: (await hostA.page.bodyText()).replace(/\s+/g, ' ')
          .includes('this product records the ask and a person does the work') },
      overclaim === null
        && (await hostA.page.bodyText()).replace(/\s+/g, ' ')
          .includes('this product records the ask and a person does the work'));
    await hostA.page.screenshot(`${opts.shots}${sep}pilot-${RUN}-my-data-queue.png`);

    // ---------------------------------------------- XB-* the account boundary, as the other host
    const bList = await callDoor(hostB.page, apiOrigin, 'get_my_support_cases',
      { p_status: null, p_limit: null }, 'host B list');
    const bCases = Array.isArray(bList.body?.cases) ? bList.body.cases : null;
    check('XB-01', 'the second host\'s own ticket list is empty — it does not contain the first host\'s case, '
      + 'and an empty list arrives as data rather than as an error sentence.',
      { status: bList.status, refs: bCases ? bCases.map((c) => c.case_ref) : statusOf(bList.body) },
      bList.status === 200 && bCases !== null && !bCases.some((c) => c.case_ref === caseRef));

    const stealThread = await callDoor(hostB.page, apiOrigin, 'get_my_support_case', { p_case_ref: caseRef },
      'host B steals thread');
    check('XB-02', 'the same read, attempted by the other account, is refused by the door — the token in the '
      + 'room is not the owner\'s — and the answer carries no part of the thread.',
      { status: stealThread.status, answer: statusOf(stealThread.body),
        leakedWords: JSON.stringify(stealThread.body).includes(summaryText)
          || JSON.stringify(stealThread.body).includes(replyText) },
      stealThread.status === 403 && caseRef !== null
        && !JSON.stringify(stealThread.body).includes(summaryText)
        && !JSON.stringify(stealThread.body).includes(caseRef));

    const stealFile = await callDoor(hostB.page, apiOrigin, 'create_privacy_request', {
      p_wedding_id: hostA.weddingId, p_kind: 'erasure', p_note: `Pilot ${RUN}: another account's invitation.`,
    }, 'host B files about A wedding');
    const bRowsOnAWedding = sqlOut(target, `
      select count(*) from private.privacy_requests
       where requester_user_id = ${lit(hostB.account.id)}::uuid
         and wedding_id = ${lit(hostA.weddingId)}::uuid`);
    check('XB-03', 'the other account cannot file a data request about someone else\'s invitation: the door '
      + 'refuses it and no row exists for that pair.',
      { status: stealFile.status, answer: statusOf(stealFile.body), rowsForThatPair: bRowsOnAWedding },
      stealFile.status === 403 && bRowsOnAWedding === '0');

    const stealQueue = await callDoor(hostB.page, apiOrigin, 'get_my_privacy_requests', {}, 'host B queue');
    const bQueue = Array.isArray(stealQueue.body?.requests) ? stealQueue.body.requests : null;
    check('XB-04', 'the privacy queue is scoped the same way: the second host sees no row for either of the '
      + 'first host\'s requests.',
      { status: stealQueue.status, refs: bQueue ? bQueue.map((r) => r.request_ref) : statusOf(stealQueue.body) },
      stealQueue.status === 200 && bQueue !== null
        && !bQueue.some((r) => r.request_ref === prRef || r.request_ref === erRef));

    await hostB.page.goto(`${opts.preview}/support`);
    await hostB.page.waitForSelector('h1');
    const bSupportText = norm(await hostB.page.bodyText());
    check('XB-05', 'the second host\'s support screen shows its own empty state in the shipped words, and '
      + 'never the other account\'s reference, subject or thread.',
      { ownEmptyState: bSupportText.includes('You have not written to support from this account'),
        otherRefShown: caseRef !== null && bSupportText.includes(caseRef),
        otherWordsShown: bSupportText.includes(summaryText) },
      bSupportText.includes('You have not written to support from this account')
        && caseRef !== null && !bSupportText.includes(caseRef) && !bSupportText.includes(summaryText));

    await hostB.page.goto(`${opts.preview}/my-data`);
    await hostB.page.waitForSelector('h1');
    const bDataText = norm(await hostB.page.bodyText());
    check('XB-06', 'and the same on the data screen: its own empty state, no other account\'s request.',
      { ownEmptyState: bDataText.includes('You have not filed a data request from this account'),
        otherRefShown: prRef !== null && bDataText.includes(prRef)
          || erRef !== null && bDataText.includes(erRef) },
      bDataText.includes('You have not filed a data request from this account')
        && prRef !== null && erRef !== null
        && !bDataText.includes(prRef) && !bDataText.includes(erRef));

    // ------------------------------------------------- NW-* money and secrets, over the wire as sent
    const log = [...(await hostA.page.networkLog()), ...(await hostB.page.networkLog())];
    // The needle names the shipped commerce surface rather than a brand list: the one money call any page in
    // `src/` makes is `api.commerce_host_summary` (`src/integrations/supabase/commerceStatus.ts:65`), reached
    // only from the panel mounted at `src/pages/EditProject.tsx:932`. `api` also *names* two operator money
    // doors (`src/integrations/supabase/types.ts:264,291`) — they are addressable by URL, so a request to one
    // would land in this list, which is the point. The bare word `order` is deliberately NOT in here:
    // PostgREST puts `&order=` in the query string of an ordinary sorted read (`traditionReleases.ts:95,102`
    // sort with it), so including it would report the create page's own pack-coverage read as a payment call.
    const money = log.filter((r) => /commerce|payment|checkout|razorpay|cashfree|stripe/i
      .test(String(r.url)));
    check('NW-01', 'no request these journeys made — sign-up, log-in, dashboard, create, support, my-data — '
      + 'was a commerce or payment endpoint. Scoped to the pages this tier visits, which is where the pilot '
      + 'money question actually lives: the only money door the product reads, `api.commerce_host_summary`, '
      + 'is called from the host\'s edit page (`EditProject.tsx:932`), which no journey here opens.',
      { requestsObserved: log.length, moneyEndpoints: money.map((m) => m.url).slice(0, 4) },
      log.length > 0 && money.length === 0);

    const observedHeaders = log.filter((r) => r.sentHeaders !== undefined);
    const wireHeaderValues = log.flatMap((r) => Object.values(r.sentHeaders ?? r.headers ?? {}));
    const serviceRoleHash = sha(env.serviceRole);
    const serviceRoleOnWire = wireHeaderValues.some((v) => sha(v) === serviceRoleHash);
    check('NW-02', 'the stack\'s service-role key is on no header Chrome actually put on the wire. The key is '
      + 'hashed here and only the boolean is printed.',
      { requestsWithWireHeaders: observedHeaders.length, headerValuesHashed: wireHeaderValues.length,
        present: serviceRoleOnWire },
      observedHeaders.length > 0 && serviceRoleOnWire === false && env.serviceRole !== null);

    const nonLoopback = [...new Set(log.map((r) => {
      try { return new URL(String(r.url)).hostname; } catch { return `unparseable:${String(r.url).slice(0, 40)}`; }
    }))].filter((h) => !['127.0.0.1', 'localhost', '::1'].includes(h));
    check('NW-03', 'every hostname these journeys contacted was a loopback address — no hosted Supabase '
      + 'project, third-party origin or CDN was reached from this tier.',
      { distinctHostnames: nonLoopback.length === 0 ? 'all loopback' : nonLoopback,
        hostnamesSeen: [...new Set(log.map((r) => {
          try { return new URL(String(r.url)).hostname; } catch { return '?'; }
        }))], requestsObserved: log.length },
      nonLoopback.length === 0);

    // --------------------------------------------------------------- RS-01 what this run left behind
    const census = sqlOut(target, `
      select (select count(*) from private.support_cases
               where host_summary like 'Pilot ${RUN}%')
            ||'${FIELD_SEP}'
            ||(select count(*) from private.support_case_events e
                 where e.body like 'Pilot ${RUN}%')
            ||'${FIELD_SEP}'
            ||(select count(*) from private.privacy_requests
                 where host_note like 'Pilot ${RUN}%')
            ||'${FIELD_SEP}'
            ||(select count(*) from auth.users where email like '%+${RUN}@example.test')
            ||'${FIELD_SEP}'
            ||(select count(*) from public.weddings where title like 'Pilot ${RUN}%')`);
    const [cases, events, requests, accounts, weddings] = census.split(FIELD_SEP);
    measure('RS-01', 'rows and accounts left on the throwaway local stack under this run tag '
      + '(cases | thread rows | privacy requests | accounts | weddings). They are left in place on purpose: '
      + 'each ledger table carries a `*_no_client_delete` trigger and the case table\'s own comment says a '
      + 'ticket outlives an erased account, so a tier that broke that rule to tidy up would be repairing the '
      + 'wrong thing. Filter by the tag above to find them.',
      { cases, threadRows: events, requests, accounts, weddings });
  } finally {
    const closed = await browser.close();
    emit(`browser closed: profileRemoved=${closed?.profileRemoved ?? 'not reported'}`);
    await vite.close();
  }
}

try {
  await main(process.argv.slice(2));
  writeEvidence([]);
} catch (error) {
  const code = error instanceof Refusal ? error.exitCode : 1;
  const message = error instanceof Error ? error.message : String(error);
  writeEvidence([`ABORTED: ${message}`]);
  process.stderr.write(`pilot-browser-support-and-data: ${message}\n`);
  process.exit(code);
}
