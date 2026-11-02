#!/usr/bin/env node
// Pilot tier: the public surface a visitor or a crawler reaches without an account, read by a real browser
// and a raw fetch off the built bytes.
//
// Why this file exists. The copy repaired in `7a093e1` is pinned by `src/test/legalPagesTruth.test.tsx`,
// and that is a jsdom cell: it proves the shipped component writes those sentences when handed an empty
// session. Issue #1's rule is "never certify from code existence alone", and for customer-facing legal copy
// the next step up is the document a visitor actually gets. So this tier drives headless Chrome over the
// production bundle served by `vite preview`, reads what a person would read, and puts the browser's own
// network and storage logs underneath the two claims those pages make about this build: that nothing on them
// reaches a remote host, and that nothing is stored in the browser beyond the notice flag and the sign-in
// session. It needs no database, so it runs while the local stack is down.
//
// Cell families:
//   PV-*   the target really is the built bytes and not a dev server: the routes answer on loopback, the
//          served document carries `<meta name="referrer" content="no-referrer">`, and it loads hashed chunks.
//   LP-*   the sentences a visitor reads. Each page's own H1 is matched first, so a cell cannot pass by
//          reading another page's text; then the repaired claims are required and the retired claims are
//          forbidden, against `document.body.innerText` — the rendered surface, not the source.
//   NW-*   what Chrome actually put on the wire while loading these documents. The instrument proves it
//          observed traffic before reporting a clean list, names the origins it saw, and reads `sentHeaders`
//          (the network service's real header set) rather than the renderer's proposal, so a `Referer` the
//          browser dropped is not reported as a leak. One expectation here was wrong and the wire corrected it:
//          the first draft demanded zero `Referer` headers, went red at 15, and the census showed all 15 are
//          font files naming `/fonts/fonts.css` — exactly the behaviour `index.html:15-16` already measures,
//          where a stylesheet's subresources name the stylesheet instead of the page. NW-08/09/10 test the
//          claim the pages make (no page path and no `/i/<credential>` on any request or Referer, nothing
//          naming a foreign origin), and NW-11 feeds that predicate two fabricated leaks to prove it rejects
//          them rather than passing by construction.
//   ST-*   the browser's own storage census: the cookie jar, and local storage before and after pressing
//          "Got it", because the cookie policy now claims exactly two stored items and a third would falsify it.
//   LG-*   the path is visible, not merely routed: from the public landing page a real mouse press on the
//          footer's "Privacy Policy" link lands on `/privacy-policy` and renders it.
//   MD-*   the crawler's view: the raw served root document, fetched without running this bundle, declares
//          the title, description, Open Graph and Twitter card properties it is claimed to declare, and names
//          its own language. MD-04 measures whether a preview image is declared at all, because a card with
//          no image renders text-only — that is a launch observation, not a pass condition.
//   KB-*   the notice without a mouse: the acknowledgement is reached by real Tab presses (the number of
//          stops is printed, since the notice mounts last in the landing document), and Enter on it writes
//          the same flag the mouse press did. KB-04 is the control that makes KB-05 readable as a product
//          verdict: the same raw key dispatch has to activate the notice's own link first, so a silent Enter
//          on the button is the product's answer and not the harness failing to press anything. KB-06 reads
//          the first stop's accessible name the way assistive tech computes it, because the walk census prints
//          `textContent`, which also counts the wordmark's decorative halves.
//   RB-*   what this build tells a crawler. Two instruments, because the product gives crawlers two
//          instructions that reach different readers: `/robots.txt`, which needs no fetch to be honoured and
//          no JavaScript to run, and the `noindex, nofollow` meta that `src/hooks/use-noindex-route.ts` mounts
//          on the three credential-bearing routes. RB-01 prints the served file split into `user-agent`
//          records the way the standard does, so a `Disallow` written under one group is never credited to
//          another — the shape that would hide a missing rule. RB-02 pins the census, RB-03 the two private
//          doors refused in every group, RB-04 the published address reachable in every group (a
//          `Disallow: /i/` would destroy the share card MD-* describes), and RB-07 feeds the parser a
//          fabricated file that drops one door and blocks `/i/` to prove it reports both rather than passing
//          by construction. RB-06 shows the served bytes are the tracked ones. RB-08/09/10 read a live head on
//          each door route — a malformed credential, which all three adapters refuse locally, so the mount is
//          observed with the stack down and on the page a leaked link actually lands on — RB-11 is the scope
//          control (the public root's live head carries no such meta, or the rule would be taking the
//          marketing and legal pages out of the index with the doors), and RB-12 releases one: a
//          same-document transition out of a door must take the directive with it, proven by a marker set on
//          `window` before the transition, because a marker that survived is the only evidence that the
//          document never reloaded and the disappearance is the product's unmount rather than a fresh page.
//
// What it does NOT prove, so the report cannot over-claim: nothing about a signed-in screen or a guest door —
// those need the local stack, which is down and stays a human decision to start, and so the guest document's
// own server-rendered preview card is not observed here. Nothing about a
// hosted deployment; the target is loopback only. Nothing about what WhatsApp does after the clicked door,
// which happens on their servers. Nothing about a crawler's own cache or its user-agent-specific handling:
// MD-* reads the document this server hands to a plain fetch, which is the half of P0-5 that is decidable
// here. RB-* inherits that limit twice over — a meta written by script is read by a crawler that runs this
// bundle and by no one else, so the `X-Robots-Tag` that the unfurl-only crawlers would need is a hosting-layer
// requirement this tier cannot serve or test, and no cell here can show that any real crawler obeyed the
// instruction it reads. And the household/reviewer `last_used_at` behaviour the privacy copy describes is
// asserted here as *text on the page*; the behaviour underneath it belongs to the Stage 7/8 door batteries.
//
// Run it against the built bytes:
//   npm run build && npm run preview          (preview listens on 127.0.0.1:4173)
//   node scripts/pilot-browser-legal-pages.mjs --out ../p1-logs/pilot-legal-pages.txt 2>&1; echo "tier exit=$?"
// Nothing secret is taken from the command line and nothing secret is printed: the log records origins,
// header *names*, storage key names and counts only.

import { mkdirSync, readFileSync, readdirSync, statfsSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { assertLoopback, openBrowser } from './stage5-browser-driver.mjs';

const REPO = `${resolve(import.meta.dirname, '..')}${sep}`;

class Refusal extends Error {}

const USAGE = `usage: node scripts/pilot-browser-legal-pages.mjs [options]
  --preview <origin>   the built app being measured (loopback only, default http://127.0.0.1:4173)
  --cdp-port <n>       this harness's own DevTools port (default 9431)
  --floor-mb <n>       refuse to start, and stop mid-run, below this much free disk on C: (default 120)
  --out <path>         where to write the evidence log (default ../p1-logs/pilot-legal-pages.txt)
  --shots <dir>        where to write the screenshots (default: beside --out)`;

const OPTION_KEYS = ['preview', 'cdp-port', 'floor-mb', 'out', 'shots'];

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
  const out = raw.out ?? resolve(REPO, '..', 'p1-logs', 'pilot-legal-pages.txt');
  const opts = {
    preview: raw.preview ?? 'http://127.0.0.1:4173',
    cdpPort: raw['cdp-port'] === undefined ? 9431 : Number(raw['cdp-port']),
    floorMb: raw['floor-mb'] === undefined ? 120 : Number(raw['floor-mb']),
    out: resolve(out),
    shots: resolve(raw.shots ?? dirname(out)),
  };
  try { assertLoopback(opts.preview, 'preview'); }
  catch { throw new Refusal(`refused: --preview=${opts.preview} is not a loopback origin.`); }
  if (!Number.isInteger(opts.cdpPort) || opts.cdpPort < 1 || opts.cdpPort > 65_535) {
    throw new Refusal('refused: --cdp-port is not a port.');
  }
  if (!Number.isInteger(opts.floorMb) || opts.floorMb < 0) {
    throw new Refusal('refused: --floor-mb is not a byte count.');
  }
  return opts;
}

const freeMiB = () => {
  const s = statfsSync('C:/');
  return Math.floor((s.bfree * s.bsize) / (1024 * 1024));
};

const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const shown = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

/** The sentences each page must say, and the ones it must not, taken from the copy as it shipped in
 *  `7a093e1`. Whitespace is normalised on both sides, so a paragraph that wraps differently at 390px still
 *  matches; the phrases are the page's own words, not a paraphrase typed here. */
const PAGES = [
  {
    id: 'privacy',
    path: '/privacy-policy',
    h1: 'Privacy Policy',
    must: [
      'what this build actually does today',
      'This is not formal legal advice',
      "carried with the build and asked for from this site's own address",
      'published address leaves no record',
      'date they were last opened',
      'no name, no device, no IP address',
      'opened, not by whom',
      'There is one door that leads out, and only you can open it',
      'Open in WhatsApp',
      '/support',
      '/my-data',
      'Filing either request records the ask and routes it. It does not produce a file',
      'does not process payments',
      'No account can hand itself that grant',
      'is not written down yet',
      'not an HttpOnly server-set session cookie',
    ],
    mustNot: [
      'Google Fonts',
      'fonts.googleapis.com',
      'fonts.gstatic.com',
      'does not record who opened',
      'will be provided in a later release',
      'email contact will be published',
      'retained for 30 days',
      'automatically deleted after',
      '₹199',
    ],
  },
  {
    id: 'cookie',
    path: '/cookie-policy',
    h1: 'Cookie & Storage Policy',
    must: [
      'sets no advertising, analytics, or third-party cookies',
      'Notice acknowledgement',
      'There is no optional storage to decline',
      'sets no Razorpay or PhonePe cookie',
      'sets no WhatsApp cookie',
      "passes your invitation's address to them when you press it",
      'no cookie-based session for one to protect',
      'Clearing the session signs you out',
      '/support',
      '/my-data',
      'There is no published email address for this preview yet',
    ],
    mustNot: [
      'those features are not present yet',
      'contact address will be published',
    ],
  },
  {
    id: 'terms',
    path: '/terms-of-service',
    h1: 'Terms of Service',
    must: [
      'not a commercial service yet',
      'not formal legal advice',
      '/support',
      '/my-data',
      'no published email address for this preview yet',
    ],
    mustNot: [
      'will be published alongside the production',
      '₹199',
    ],
  },
];

/** The doors that carry a credential in their path, and so are refused to crawlers by
 *  `public/robots.txt`. `/i/` is not one of them: the published address is the one a chat app has to
 *  fetch to draw a card, and RB-03 guards that. */
const PRIVATE_DOORS = ['/r/', '/g/'];

/** The groups this file declares, in order. Pinned so a census over zero groups can never read as a
 *  clean one, and so a group added or renamed without a look goes red here. */
const EXPECTED_GROUPS = ['Googlebot', 'Bingbot', 'Twitterbot', 'facebookexternalhit', '*'];

/**
 * robots.txt as the standard defines it: `user-agent` records separated by a blank line, each carrying
 * its own `Allow`/`Disallow` list, comments stripped, unknown fields ignored. The blank line is the
 * whole point of doing this here rather than grepping the text — a `Disallow` written under one group
 * does not reach the next, so a flattened read would credit Googlebot with a rule only `*` carries and
 * report a missing disallow as a present one.
 */
function parseRobotRecords(text) {
  const records = [];
  let current = null;
  const close = () => { if (current !== null) { records.push(current); current = null; } };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') { close(); continue; }
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field !== 'user-agent' && field !== 'allow' && field !== 'disallow') continue;
    current ??= { agents: [], allow: [], disallow: [] };
    current[field === 'user-agent' ? 'agents' : field].push(value);
  }
  close();
  return records;
}

const groupName = (record) => record.agents.join('+');
const robotCensus = (records) => records.map((r) => `${groupName(r)}: allow=[${r.allow.join(' ')}] disallow=[${r.disallow.join(' ')}]`);
/** Groups that failed to refuse one of the private doors. */
const robotDoorMisses = (records) =>
  records.flatMap((r) => PRIVATE_DOORS.filter((door) => !r.disallow.includes(door)).map((door) => `${groupName(r)}:${door}`));
/** Groups that refused the published invitation, which no group may do. */
const robotInvitationBlocked = (records) => records.filter((r) => r.disallow.includes('/i/')).map(groupName);

const lines = [];
const findings = [];
const emit = (text) => { lines.push(text); process.stdout.write(`${text}\n`); };

let observed = 0;
function check(id, claim, actual, pass) {
  observed += 1;
  emit(`  ${id.padEnd(14)} ${pass ? 'PASS' : 'FAIL'}  ${claim}`);
  emit(`${' '.repeat(17)}observed: ${shown(actual)}`);
  if (!pass) findings.push(`${id}: ${claim}`);
}
function measure(id, what, value) {
  emit(`  ${id.padEnd(14)} MEAS  ${what}: ${shown(value)}`);
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const DESKTOP = { width: 1280, height: 900, dpr: 1, mobile: false };
const PHONE = { width: 390, height: 844, dpr: 2, mobile: true };

async function main(argv) {
  const opts = readOptions(argv);
  mkdirSync(opts.shots, { recursive: true });
  emit(`pilot legal-pages tier — target ${opts.preview}`);
  measure('ENV-00', 'free MiB on C: at start', `${freeMiB()} (floor ${opts.floorMb})`);
  if (freeMiB() < opts.floorMb) {
    throw new Refusal(`refused: ${freeMiB()} MiB free is below the ${opts.floorMb} MiB floor.`);
  }

  // ------------------------------------------------------------------ PV-* : the target is the built bytes
  const served = [];
  for (const spec of PAGES) {
    try {
      const res = await fetch(`${opts.preview}${spec.path}`);
      served.push({ path: spec.path, ok: res.ok, status: res.status, html: await res.text() });
    } catch (e) {
      served.push({ path: spec.path, ok: false, status: null, html: '', why: e.message });
    }
  }
  check('PV-01', 'every legal route answers on the loopback preview target',
    served.map((s) => `${s.path}=${s.status ?? s.why}`).join(' '),
    served.every((s) => s.ok === true));

  const html = served[0].html;
  const referrerTags = (html.match(/name="referrer"\s+content="no-referrer"/g) ?? []).length;
  check('PV-02', 'the served document declares the referrer policy the pages rely on',
    `no-referrer meta tag(s)=${referrerTags}`, referrerTags === 1);

  const chunks = [...html.matchAll(/\/assets\/[A-Za-z0-9._-]+\.js/g)].map((m) => m[0]);
  check('PV-03', 'the route is served from hashed build chunks, not a dev-server entry point',
    `${chunks.length} chunk reference(s): ${chunks.join(', ') || 'none'}; /src/main.tsx present=${html.includes('/src/main.tsx')}`,
    chunks.length >= 1 && !html.includes('/src/main.tsx'));

  let shippedChunks = null;
  try {
    shippedChunks = readdirSync(`${REPO}dist/assets`).filter((f) => f.endsWith('.js')).length;
  } catch { shippedChunks = 'dist/assets unreadable'; }
  measure('PV-04', 'JS chunk files in dist/assets (the figure feature-readiness row 282 quotes)', shippedChunks);

  // ------------------------------------------------------------------ MD-* : what a crawler is handed
  // Read from the raw served bytes, not the live DOM: a link-previewing crawler does not run this build's
  // JavaScript, so the only metadata that reaches it is what the server put in the document.
  let rootHtml = '';
  let rootStatus = null;
  try {
    const res = await fetch(`${opts.preview}/`);
    rootStatus = res.status;
    rootHtml = await res.text();
  } catch (e) { rootStatus = `fetch failed: ${e.message}`; }
  const metas = [...rootHtml.matchAll(/<meta\b[^>]*>/gi)].map((m) => ({
    key: /(?:name|property)="([^"]+)"/i.exec(m[0])?.[1] ?? null,
    content: /content="([^"]*)"/i.exec(m[0])?.[1] ?? null,
  }));
  const metaValue = (k) => metas.find((m) => m.key === k)?.content ?? null;
  const DECLARED = ['description', 'og:title', 'og:description', 'og:type',
    'twitter:card', 'twitter:title', 'twitter:description'];
  const missingMeta = DECLARED.filter((k) => !norm(metaValue(k)));
  check('MD-01', 'the root document a crawler fetches declares its own title, description and card type',
    `served=${rootStatus} declared=${DECLARED.length} missing or empty=${JSON.stringify(missingMeta)}`,
    missingMeta.length === 0 && metas.length > 0);
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(rootHtml)?.[1] ?? null;
  const langAttr = /<html\b[^>]*\blang="([^"]*)"/i.exec(rootHtml)?.[1] ?? null;
  check('MD-02', 'the document names itself and declares its language without running any script',
    `title="${norm(titleTag ?? '')}" lang="${langAttr}"`,
    norm(titleTag ?? '').includes('VivaahVarnam') && norm(langAttr ?? '').length > 0);
  measure('MD-03', 'every crawler-facing property the root document declares, with its value',
    metas.filter((m) => m.key && (/^(og:|twitter:)/.test(m.key) || m.key === 'description'))
      .map((m) => `${m.key}="${String(m.content).slice(0, 60)}"`));
  measure('MD-04', 'preview-image properties on the root document (a card with no image renders text-only)',
    metas.filter((m) => m.key && /image/i.test(m.key)).map((m) => `${m.key}=${m.content}`));

  // ------------------------------------------------------------------ RB-01..06 : the file a crawler reads first
  // Fetched, not rendered, and read as records rather than as text. `dist/robots.txt` is a build input
  // copied from `public/`, so this is the same artifact a hosted crawler would be handed.
  let robotsText = '';
  let robotsStatus = null;
  let robotsWhy = null;
  try {
    const res = await fetch(`${opts.preview}/robots.txt`);
    robotsStatus = res.status;
    robotsText = await res.text();
  } catch (e) { robotsWhy = e.message; }
  const servedRobots = parseRobotRecords(robotsText);
  const trackedRobots = (() => {
    try { return readFileSync(`${REPO}public/robots.txt`, 'utf8'); } catch (e) { return `<<unreadable: ${e.message}>>`; }
  })();
  measure('RB-01', 'the served robots.txt, group by group as a crawler splits it',
    `status=${robotsStatus ?? `failed: ${robotsWhy}`} chars=${robotsText.length} records=${servedRobots.length} ` +
    robotCensus(servedRobots).join(' | '));
  check('RB-02', 'the served file declares exactly the groups this build is shipped with',
    `groups=${JSON.stringify(servedRobots.map((r) => r.agents.join('+')))} expected=${JSON.stringify(EXPECTED_GROUPS)}`,
    servedRobots.length === EXPECTED_GROUPS.length &&
      servedRobots.every((r) => r.agents.length === 1) &&
      servedRobots.map((r) => r.agents[0]).join('|') === EXPECTED_GROUPS.join('|'));
  const doorMisses = robotDoorMisses(servedRobots);
  check('RB-03', 'every group in the served file refuses the reviewer door and the household door',
    `records=${servedRobots.length} groups that failed to refuse one of ${PRIVATE_DOORS.join(', ')}=${JSON.stringify(doorMisses)}`,
    servedRobots.length > 0 && doorMisses.length === 0);
  const blockedInvitation = robotInvitationBlocked(servedRobots);
  check('RB-04', 'and no group refuses the published invitation, which is the address the share card is drawn from',
    `groups that disallow /i/=${JSON.stringify(blockedInvitation)} (an entry here would break MD-01 for every unfurl bot)`,
    servedRobots.length > 0 && blockedInvitation.length === 0);
  const servedToLf = robotsText.replace(/\r\n/g, '\n');
  const trackedToLf = trackedRobots.replace(/\r\n/g, '\n');
  measure('RB-05', 'served bytes against the tracked file, raw and after unifying line endings',
    `identical=${robotsText === trackedRobots} identical-ignoring-CRLF=${servedToLf === trackedToLf} ` +
    `served=${robotsText.length} tracked=${trackedRobots.length}`);
  check('RB-06', 'the file the preview serves is the file the repository ships',
    `directives after line-ending unification differ=${servedToLf !== trackedToLf}`, servedToLf === trackedToLf);
  // Positive control on the instrument itself: the same two predicates, handed a file that drops one private
  // door and blocks the published one. If they name both, then RB-03 and RB-04 are readings of the served
  // bytes rather than answers the parser always gives.
  const weakened = parseRobotRecords(
    'User-agent: Googlebot\nAllow: /\nDisallow: /g/\n\nUser-agent: *\nAllow: /\nDisallow: /r/\nDisallow: /g/\nDisallow: /i/\n',
  );
  const controlMisses = robotDoorMisses(weakened);
  const controlBlocks = robotInvitationBlocked(weakened);
  check('RB-07', 'control: the record parser reports a dropped door and a blocked /i/ rather than scoring them clean',
    `weakened groups=${weakened.length} door misses=${JSON.stringify(controlMisses)} /i/ blocked by=${JSON.stringify(controlBlocks)}`,
    weakened.length === 2 && controlMisses.join('|') === 'Googlebot:/r/' && controlBlocks.join('|') === '*');

  const browser = await openBrowser({ cdpPort: opts.cdpPort });
  const shots = [];
  const wire = [];
  try {
    // ------------------------------------------------------------------ ST-* + LG-* : landing, notice, path
    const land = await browser.newPage('landing');
    await land.viewport(DESKTOP);
    await land.goto(`${opts.preview}/`);
    await land.waitForSelector('footer');
    const noticeVisible = await land.waitForText('Your privacy', 8_000);
    check('ST-01', 'the public site shows its privacy notice before it stores anything about it',
      `notice copy on screen=${noticeVisible}`, noticeVisible === true);

    const beforeDismiss = await land.localStorageSnapshot();
    measure('ST-02', 'local storage keys while the notice is still open', Object.keys(beforeDismiss));
    check('ST-03', 'the acknowledgement is not written before the visitor presses anything',
      `cookie-consent=${shown(beforeDismiss['cookie-consent'] ?? null)}`,
      beforeDismiss['cookie-consent'] === undefined);

    const pressed = await land.pressButton('Got it');
    await sleep(400);
    const afterDismiss = await land.localStorageSnapshot();
    check('ST-04', 'pressing "Got it" writes exactly the one flag the cookie policy names',
      `press=${pressed} keys=${JSON.stringify(Object.keys(afterDismiss))} cookie-consent=${shown(afterDismiss['cookie-consent'] ?? null)}`,
      pressed === 'pressed' && afterDismiss['cookie-consent'] === 'acknowledged');

    const jar = await land.cookiesForOrigin();
    check('ST-05', 'the browser holds no cookie for this origin, which is why there is nothing to decline',
      `cookie count=${jar.length} names=${JSON.stringify(jar.map((c) => c.name))}`, jar.length === 0);

    // ------------------------------------------------------------------ KB-* : the notice without a mouse
    // The notice is mounted last in the landing document (`src/pages/Index.tsx:22`), so how far a keyboard
    // visitor has to travel to dismiss it is a fact about this build rather than an assumption, and the
    // `Input.dispatchKeyEvent` pair below is a real key event rather than a synthetic `element.click()`.
    // KB-04 is the control: the same dispatch has to activate the notice's own link, or a silent KB-05 would
    // be the harness's fault and not the product's.
    const enterKey = async () => {
      await land.cdp('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r', modifiers: 0 });
      await land.cdp('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13, modifiers: 0 });
      await sleep(350);
    };
    const armNotice = async () => {
      await land.evaluate("localStorage.removeItem('cookie-consent')");
      await land.goto(`${opts.preview}/`);
      await land.waitForSelector('footer');
      return land.waitForText('Your privacy', 8_000);
    };
    /** The notice leaves through a 400 ms exit animation (`src/components/landing/CookieConsent.tsx:25-30`),
     *  so a fixed short sleep races the product: one run read the text still on screen 350 ms after Enter had
     *  already written the flag. Poll for the departure instead, and let a real hang surface as a failure. */
    const waitForGone = async (text, timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (!(await land.hasText(text))) return true;
        if (Date.now() > deadline) return false;
        await sleep(120);
      }
    };
    const walkToNotice = async (limit = 60) => {
      const walk = [];
      for (let i = 0; i < limit; i += 1) {
        await land.pressTab();
        const info = await land.focusInfo();
        walk.push(info);
        if (norm(info?.label) === 'Got it') return { walk, at: i + 1 };
      }
      return { walk, at: -1 };
    };

    const rearmed = await armNotice();
    const first = await walkToNotice();
    check('KB-01', 'the notice is reachable by keyboard alone, and how many stops that takes',
      `notice on screen=${rearmed} Tab stops to "Got it"=${first.at} of ${first.walk.length}`,
      rearmed === true && first.at > 0);
    measure('KB-02', 'the focus order a keyboard visitor walks to get there',
      first.walk.map((w, i) => `${i + 1}:${w.tag}${norm(w.label) ? ` "${norm(w.label).slice(0, 22)}"` : ''}`));
    const onButton = await land.focusInfo();
    measure('KB-03', 'what the focused "Got it" actually shows',
      `outline=${onButton.outlineStyle} ${onButton.outlineWidth} ${onButton.outlineColor} ` +
      `boxShadow=${onButton.boxShadow} size=${onButton.width}x${onButton.height}`);
    await land.pressTab();
    const onLink = await land.focusInfo();
    await enterKey();
    const afterEnterUrl = await land.currentUrl();
    check('KB-04', 'control: the same raw Enter activates the notice\'s own link, so the harness can press keys',
      `second stop=${onLink.tag} "${norm(onLink.label)}" url after Enter=${afterEnterUrl}`,
      /\/cookie-policy$/.test(afterEnterUrl));
    const rearmedAgain = await armNotice();
    const second = await walkToNotice();
    await enterKey();
    const kbStore = await land.localStorageSnapshot();
    const noticeGone = await waitForGone('Your privacy');
    check('KB-05', 'Enter on "Got it" writes the flag and takes the notice off the screen',
      `re-armed=${rearmedAgain} stops=${second.at} cookie-consent=${shown(kbStore['cookie-consent'] ?? null)} ` +
      `notice still on screen=${!noticeGone}`,
      second.at > 0 && kbStore['cookie-consent'] === 'acknowledged' && noticeGone);

    // KB-02 prints `textContent`, which counts every node — including the two-tone wordmark's decorative
    // halves, which `src/components/brand/BrandLockup.tsx:26-31` hides from assistive tech while naming the
    // product once more in an `sr-only` span. That is why the census reads "VivaahVarnamVivaahVarnam" where a
    // screen reader says it once. KB-06 measures the name the way AT computes it, so the doubling is recorded
    // as this harness's reading rather than reported as a product defect.
    await land.goto(`${opts.preview}/`);
    await land.waitForSelector('footer');
    await land.pressTab();
    const axName = await land.evaluate(`(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const walk = (node) => {
        if (node.nodeType === 3) return node.textContent;
        if (node.nodeType !== 1) return '';
        if (node.getAttribute('aria-hidden') === 'true') return '';
        let out = '';
        for (const child of node.childNodes) out += walk(child);
        return out;
      };
      return [el.tagName, walk(el).replace(/\\s+/g, ' ').trim()];
    })()`);
    const rawFirstLabel = (await land.focusInfo())?.label ?? null;
    check('KB-06', 'the first Tab stop announces the product name once, not twice',
      `stop=${axName?.[0] ?? 'none'} accessible="${axName?.[1] ?? ''}" raw textContent="${rawFirstLabel}"`,
      Array.isArray(axName) && axName[1] === 'VivaahVarnam');

    await land.clickLink('Privacy Policy');
    const landedUrl = await land.currentUrl();
    check('LG-01', 'a real mouse press on the landing footer reaches the privacy policy',
      `url=${landedUrl}`, /\/privacy-policy$/.test(landedUrl));
    const landedH1 = norm(await land.evaluate("document.querySelector('h1')?.textContent ?? null"));
    check('LG-02', 'and the page it lands on is the policy, not a redirect to sign-in',
      `h1="${landedH1}"`, landedH1 === 'Privacy Policy');

    // ------------------------------------------------------------------ RB-08..12 : the live head on each door
    // A malformed credential is what makes the mount observable with the stack down: all three adapters
    // refuse the shape before any request (`publicInvitation.ts:42`, `publicReview.ts:39`,
    // `guestDoor.ts:51` — each one's `TOKEN_SHAPE`), so the page renders its refusal and the
    // directive is still there to read — and
    // that is the claim, because a posture mounted only on a successful resolve would leave precisely this
    // page, the one a leaked or retired link actually lands on, indexable. The heading is matched per route
    // so a cell cannot pass by reading a different page's head.
    const BAD_CREDENTIAL = 'tooshort';
    const headRobots = async (page) => page.evaluate(`(() => {
      const tag = document.head.querySelector('meta[name="robots"]');
      return tag === null ? null : tag.getAttribute('content');
    })()`);
    const doors = await browser.newPage('doors');
    await doors.viewport(DESKTOP);
    for (const [id, route, heading] of [
      ['RB-08', 'i', 'This invitation is not available'],
      ['RB-09', 'r', 'This review link is not available.'],
      ['RB-10', 'g', 'This invitation link is not available.'],
    ]) {
      await doors.goto(`${opts.preview}/${route}/${BAD_CREDENTIAL}`);
      const mounted = await doors.waitForSelector('h1', 20_000);
      const robotsHere = await headRobots(doors);
      const headingHere = norm(await doors.evaluate("document.querySelector('h1')?.textContent ?? null"));
      check(id, `/${route}/<credential> mounts the directive for a crawler that runs this bundle`,
        `h1 mounted=${mounted} h1="${headingHere}" robots=${shown(robotsHere)}`,
        headingHere === heading && robotsHere === 'noindex, nofollow');
    }

    await doors.goto(`${opts.preview}/`);
    await doors.waitForSelector('footer');
    const rootRobots = await headRobots(doors);
    check('RB-11', 'the public root asks for nothing — the rule is route-scoped, not a shell declaration',
      `robots=${shown(rootRobots)} (a value here would take the marketing and legal pages out of the index too)`,
      rootRobots === null);

    // The release, proven from a door and as the product's own unmount rather than a fresh document: the
    // directive is read *while standing on the door* before the transition, and a marker written on `window`
    // is still there after it, which is only possible inside one document. Without that first reading this
    // cell would pass from any page that never mounted the rule — a null compared against a null.
    // A `history.pushState` alone would change the address bar and leave React Router on the old route, so
    // the `popstate` the product's own router listens for is dispatched next — and the heading that comes
    // back is what shows the route actually changed rather than the URL string having moved.
    await doors.goto(`${opts.preview}/i/${BAD_CREDENTIAL}`);
    await doors.waitForSelector('h1', 20_000);
    const robotsBeforeRelease = await headRobots(doors);
    const released = await doors.evaluate(`(() => {
      window.__rbSameDocumentMarker = 'alive-through-the-transition';
      window.history.pushState({}, '', '/cookie-policy');
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      return document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;
    })()`);
    const policyMounted = await doors.waitForText('Cookie & Storage Policy', 8_000);
    const marker = await doors.evaluate("window.__rbSameDocumentMarker ?? 'gone — the document reloaded'");
    const robotsAfterRelease = await headRobots(doors);
    const urlAfterRelease = await doors.currentUrl();
    check('RB-12', 'leaving a door for a public page takes the directive with it, in the same document',
      `on the door robots=${shown(robotsBeforeRelease)} route changed client-side=${policyMounted === true} ` +
      `url=${urlAfterRelease} marker=${shown(marker)} during=${shown(released)} after=${shown(robotsAfterRelease)}`,
      robotsBeforeRelease === 'noindex, nofollow' && policyMounted === true &&
        marker === 'alive-through-the-transition' && robotsAfterRelease === null);

    // ------------------------------------------------------------------ LP-* per page, each in its own tab
    for (const spec of PAGES) {
      const page = await browser.newPage(spec.id);
      await page.viewport(DESKTOP);
      await page.goto(`${opts.preview}${spec.path}`);
      const hasH1 = await page.waitForSelector('h1', 20_000);
      const h1Text = norm(await page.evaluate("document.querySelector('h1')?.textContent ?? null"));
      check(`LP-${spec.id}-01`, `${spec.path} renders its own heading before any copy is read`,
        `h1 mounted=${hasH1} text="${h1Text}"`, h1Text === spec.h1);

      const body = norm(await page.bodyText());
      const missing = spec.must.filter((needle) => !body.includes(needle));
      check(`LP-${spec.id}-02`, `all ${spec.must.length} required sentences are on the ${spec.id} document`,
        missing.length === 0 ? 'all present' : `missing: ${JSON.stringify(missing)}`, missing.length === 0);
      const leaked = spec.mustNot.filter((needle) => body.includes(needle));
      check(`LP-${spec.id}-03`, `none of the ${spec.mustNot.length} retired or invented sentences survives there`,
        leaked.length === 0 ? 'none found' : `found: ${JSON.stringify(leaked)}`, leaked.length === 0);
      measure(`LP-${spec.id}-04`, `${spec.path} rendered surface`, `words=${body.split(' ').length}`);

      await page.viewport(PHONE);
      await sleep(300);
      await page.screenshot(resolve(opts.shots, `${spec.id}-390.png`));
      await page.viewport(DESKTOP);
      await sleep(200);
      await page.screenshot(resolve(opts.shots, `${spec.id}-1280.png`));
      shots.push(`${spec.id}-390.png`, `${spec.id}-1280.png`);

      const log = await page.networkLog();
      wire.push(...log.map((e) => ({ page: spec.id, ...e })));
    }

    // ------------------------------------------------------------------ NW-* : the wire underneath those documents
    check('NW-01', 'the instrument observed this run\'s traffic (an empty list is not a clean list)',
      `requests recorded=${wire.length}`, wire.length > 0);
    const origins = [...new Set(wire.map((e) => { try { return new URL(e.url).origin; } catch { return 'unparsable'; } }))];
    const nonLoopback = origins.filter((o) => !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o));
    check('NW-02', 'every request these three documents made stayed on loopback',
      `origins=${JSON.stringify(origins)} non-loopback=${JSON.stringify(nonLoopback)}`,
      nonLoopback.length === 0);
    measure('NW-03', 'distinct host names on the wire',
      [...new Set(wire.map((e) => { try { return new URL(e.url).hostname; } catch { return 'unparsable'; } }))]);
    const fontRequests = wire.filter((e) => e.type === 'Font' || /\.(woff2?|ttf|otf)(\?|$)/.test(e.url));
    const fontSameOrigin = fontRequests.every((e) => {
      try { return new URL(e.url).origin === opts.preview; } catch { return false; }
    });
    check('NW-04', 'the faces these pages draw are asked for from this origin, as the policy now says',
      `font requests=${fontRequests.length}, all from the preview origin=${fontSameOrigin}`,
      fontRequests.length > 0 && fontSameOrigin);
    const refererOf = (e) => {
      const h = e.sentHeaders ?? {};
      const key = Object.keys(h).find((k) => k.toLowerCase() === 'referer');
      return key ? String(h[key]) : null;
    };
    const withReferer = wire.filter((e) => refererOf(e) !== null);
    // The census comes before the verdict, because the shape of the leakage is the finding: a bare count
    // could not tell a stylesheet naming itself from a page handing over a guest's address.
    measure('NW-05', `requests that carried a wire Referer: ${withReferer.length} of ${wire.length}`, withReferer.map((e) => {
      let path = e.url;
      let refPath = refererOf(e);
      try { path = new URL(e.url).pathname; } catch { /* keep raw */ }
      try { refPath = new URL(refererOf(e)).pathname; } catch { /* keep raw */ }
      return `${e.page} ${e.type ?? '?'} ${path} <= Referer ${refPath}`;
    }));
    const credentialed = wire.filter((e) => Object.keys(e.sentHeaders ?? {})
      .some((h) => ['apikey', 'authorization'].includes(h.toLowerCase())));
    measure('NW-06', 'requests carrying credentials',
      `${credentialed.length} urls=${JSON.stringify(credentialed.map((e) => e.url.slice(0, 70)))}`);
    measure('NW-07', 'requests that failed on the wire (the stack is down, so a refused loopback call is expected)',
      `${wire.filter((e) => e.status === undefined || e.status >= 400).length} of ${wire.length}`);

    // The first draft of this section demanded *zero* wire Referers and went red at 15. The census above says
    // why, and it is the same measured fact `index.html:15-16` already records: a stylesheet's subresources
    // name the stylesheet, not the page that loaded it. That is not the `no-referrer` tag failing — no legal
    // page path, and no guest address, reaches any request. So the cells below test what the pages actually
    // claim (nothing tells a foreign host where the visitor came from; a guest's `/i/<credential>` never
    // travels), and NW-11 proves that predicate rejects a real leak instead of always agreeing.
    const refererParts = (e) => {
      const v = refererOf(e);
      if (v === null) return null;
      try {
        const u = new URL(v);
        return { origin: u.origin, path: u.pathname, raw: v };
      } catch {
        return { origin: 'unparsable', path: v, raw: v };
      }
    };
    const benignReferer = (e) => {
      const r = refererParts(e);
      return r !== null && r.origin === opts.preview && r.path === '/fonts/fonts.css' && e.type === 'Font';
    };
    const pathOf = (u) => { try { return new URL(u).pathname; } catch { return String(u).slice(0, 80); } };
    const named = (e) => `${e.page} ${e.type ?? '?'} ${pathOf(e.url)} <= ${refererParts(e)?.raw ?? '(none)'}`;
    const refererLeaks = withReferer.filter((e) => !benignReferer(e));
    check('NW-08', 'the only thing any Referer names on this run is the stylesheet that asked for the faces',
      `referer-bearing=${withReferer.length} outside the measured shape=${JSON.stringify(refererLeaks.map(named))}`,
      refererLeaks.length === 0);
    const foreign = withReferer.filter((e) => refererParts(e)?.origin !== opts.preview);
    check('NW-09', 'no Referer names an origin other than this preview — nothing leaves for a foreign host to log',
      `referer origins=${JSON.stringify([...new Set(withReferer.map((e) => refererParts(e)?.origin))])} foreign=${JSON.stringify(foreign.map(named))}`,
      foreign.length === 0);
    const paths = wire.map((e) => pathOf(e.url)).concat(withReferer.map((e) => refererParts(e)?.path ?? ''));
    const credentialShapes = [...new Set(paths.filter((p) => p.includes('/i/')))];
    check('NW-10', 'the guest-credential shape never appears on this run, in a request or in a Referer',
      `paths scanned=${paths.length} matching /i/=${JSON.stringify(credentialShapes)}`,
      paths.length > 0 && credentialShapes.length === 0);
    // Positive control: the same predicate, fed the leak this tier is guarding against. Must reject it.
    const fabricated = {
      page: 'control', type: 'Document', url: `${opts.preview}/fonts/fonts.css`,
      sentHeaders: { Referer: `${opts.preview}/i/AAAA1111bbbb` },
    };
    const fabricatedDocument = {
      page: 'control', type: 'Font', url: `${opts.preview}/fonts/files/dm-sans-latin-400-normal.woff2`,
      sentHeaders: { Referer: `${opts.preview}/privacy-policy` },
    };
    check('NW-11', 'control: the Referer predicate rejects a credential-bearing and a page-naming Referer',
      `rejects /i/ leak=${benignReferer(fabricated) === false} rejects page-path leak=${benignReferer(fabricatedDocument) === false}`,
      benignReferer(fabricated) === false && benignReferer(fabricatedDocument) === false);

    // ------------------------------------------------------------------ ST-06/07 after the whole sweep
    await land.goto(`${opts.preview}/terms-of-service`);
    await land.waitForSelector('h1');
    const finalStore = await land.localStorageSnapshot();
    measure('ST-06', 'local storage keys after all three pages were read', Object.keys(finalStore));
    check('ST-07', 'the sidebar provider\'s cookie name never appears in this build',
      `sidebar:state present=${'sidebar:state' in finalStore}`, !('sidebar:state' in finalStore));
    const extra = Object.keys(finalStore).filter((k) => k !== 'cookie-consent');
    check('ST-08', 'nothing beyond the two items the cookie policy lists is stored for a signed-out visitor',
      `keys=${JSON.stringify(Object.keys(finalStore))} unexpected=${JSON.stringify(extra)}`, extra.length === 0);
  } finally {
    await browser.close();
    measure('SH-01', 'screenshots written', `${shots.length} into ${opts.shots}`);
    emit('');
    emit(`cells observed = ${observed}, findings = ${findings.length}`);
    for (const f of findings) emit(`FINDING ${f}`);
    emit(`verdict: ${findings.length === 0 ? 'PASS' : 'FAIL'} — the account-free public surface (legal copy, the crawler's own document, and the three doors' posture) as one real browser and one raw fetch saw them on the built bytes`);
    writeFileSync(opts.out, `${lines.join('\n')}\n`);
    process.stdout.write(`evidence written to ${opts.out}\n`);
  }
  if (findings.length > 0) process.exitCode = 1;
}

main(process.argv.slice(2)).catch((err) => {
  if (err instanceof Refusal) {
    process.stdout.write(`${err.message}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`tier threw: ${err?.stack ?? err}\n`);
  try {
    writeFileSync(resolve(REPO, '..', 'p1-logs', 'pilot-legal-pages-crash.txt'), lines.join('\n'));
    process.stdout.write(`partial evidence written to p1-logs/pilot-legal-pages-crash.txt\n`);
  } catch { /* the log is best effort; the throw is the finding */ }
  process.exitCode = 1;
});
