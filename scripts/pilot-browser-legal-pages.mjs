#!/usr/bin/env node
// Pilot tier: the three standing legal pages, read by a real browser off the built bytes.
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
//
// What it does NOT prove, so the report cannot over-claim: nothing about a signed-in screen, a guest door or
// a crawler — those need the local stack, which is down and stays a human decision to start. Nothing about a
// hosted deployment; the target is loopback only. Nothing about what WhatsApp does after the clicked door,
// which happens on their servers. And the household/reviewer `last_used_at` behaviour the privacy copy
// describes is asserted here as *text on the page*; the behaviour underneath it belongs to the Stage 7/8 door
// batteries.
//
// Run it against the built bytes:
//   npm run build && npm run preview          (preview listens on 127.0.0.1:4173)
//   node scripts/pilot-browser-legal-pages.mjs --out ../p1-logs/pilot-legal-pages.txt 2>&1; echo "tier exit=$?"
// Nothing secret is taken from the command line and nothing secret is printed: the log records origins,
// header *names*, storage key names and counts only.

import { mkdirSync, readdirSync, statfsSync, writeFileSync } from 'node:fs';
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

    await land.clickLink('Privacy Policy');
    const landedUrl = await land.currentUrl();
    check('LG-01', 'a real mouse press on the landing footer reaches the privacy policy',
      `url=${landedUrl}`, /\/privacy-policy$/.test(landedUrl));
    const landedH1 = norm(await land.evaluate("document.querySelector('h1')?.textContent ?? null"));
    check('LG-02', 'and the page it lands on is the policy, not a redirect to sign-in',
      `h1="${landedH1}"`, landedH1 === 'Privacy Policy');

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
    emit(`verdict: ${findings.length === 0 ? 'PASS' : 'FAIL'} — the legal pages as one real browser saw them on the built bytes`);
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
