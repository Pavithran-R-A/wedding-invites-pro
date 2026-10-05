#!/usr/bin/env node
// VIVAAHVARNAM — Stage 5 §32: the network and privacy recheck, on the final head.
//
// Why this is a separate instrument and not a paragraph in the journeys log:
//   * `scripts/stage4-render-qualification.mjs` §26 classifies the destinations of **one** surface — a
//     guest page — and the journeys print the same classification for the pages they happen to publish.
//     Neither says anything about the *authenticated* surfaces, where a bearer token is in play, nor about
//     what the browser keeps on disk afterwards.
//   * §32 asks for the traffic picture on the head that is actually being delivered, and it asks for it
//     **classified** rather than summarised: the app is not "zero network" — it reaches two Google font
//     hosts by design, in `index.html` — and a claim of silence would be false.
//
// What this file enforces before it opens a browser:
//   * the local API target, the bundle's own API target and the preview origin are all loopback, and
//     `project_id` in `supabase/config.toml` is this repository's disposable stack;
//   * the shipped `dist/` calls the loopback target and does not contain the hosted project reference that
//     `.env` still carries, so "no hosted Supabase contact" is read off the bytes handed to the browser;
//   * every anonymous surface is opened in its **own** browser context, so an anonymous visitor holds no
//     session by construction rather than by careful cleanup;
//   * nothing shaped like a credential, and nothing that is this run's password or email, is ever written
//     to the report: headers are reported by *name*, and values are compared, never printed.
//
//   npm run build
//   npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
//   node scripts/stage5-network-privacy.mjs
//
// Exit code 1 means a finding was recorded. A harness failure throws with exit 2.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { assertLoopback, openBrowser } from './stage5-browser-driver.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW_ORIGIN = assertLoopback(
  process.env.STAGE5_PREVIEW_URL ?? 'http://127.0.0.1:4173', 'STAGE5_PREVIEW_URL');
const CDP_PORT = Number(process.env.STAGE5_CDP_PORT ?? 9411);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const originOf = (value) => {
  const u = new URL(value);
  return `${u.protocol}//${u.host}`;
};
const hostOf = (value) => new URL(value).hostname;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
/** Schemes the browser answers from bytes it already holds. They are not destinations: a `data:` URL has
 *  no host, so there is nothing for it to reach. Measured rather than assumed, because run 1 of this pass
 *  put one in the same column as a network origin and called it an unclassified destination. */
const IN_PAGE_SCHEMES = new Set(['data:', 'blob:', 'about:', 'javascript:']);
const schemeOf = (value) => {
  try { return new URL(value).protocol; } catch { return '(unparseable)'; }
};
const hostFor = (value) => {
  try { return new URL(value).host; } catch { return '(unparseable)'; }
};

function localEnv(rel) {
  const out = {};
  for (const line of readFileSync(resolve(ROOT, rel), 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
}

const env = localEnv('.env.local');
/** `.env` is the gitignored file that carries a *hosted* project URL, and this stage never contacts
 *  one, so a qualification clone has no reason to hold it. The needle this file supplies is a bonus
 *  identification, not the defence: `supabase.co` and `supabase.in` are in `TELEMETRY_HOSTS` on
 *  their own terms, so a hosted origin reaching the page is a finding with or without `.env`. */
const dotenv = (() => {
  try {
    return localEnv('.env');
  } catch {
    return {};
  }
})();
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

const RUN_TAG = `s32net-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const HOST_EMAIL = `s32-host+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}`;

/** The hosted project reference `.env` still carries, used only as a needle — never printed. If `.env`
 *  declares a loopback target there is no hosted reference to look for, and the prelude says so rather
 *  than reporting a vacuous pass. */
const hostedUrl = dotenv.VITE_SUPABASE_URL ?? '';
const hostedIsLoopback = LOOPBACK_HOSTS.has(hostOf(hostedUrl || 'http://127.0.0.1'));
const hostedRef = hostedIsLoopback ? '' : hostOf(hostedUrl).split('.')[0];

const API_ORIGIN = originOf(apiUrl);
const PREVIEW = originOf(PREVIEW_ORIGIN);
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
/** Origins that would be a finding if a single request reached one. The list is named, because "no
 *  analytics" is only a claim if the instrument knows what it looked for. */
const TELEMETRY_HOSTS = [
  'google-analytics.com', 'googletagmanager.com', 'analytics.google.com', 'sentry.io',
  'ingest.sentry.io', 'posthog.com', 'mixpanel.com', 'segment.io', 'segment.com', 'amplitude.com',
  'clarity.ms', 'hotjar.com', 'lovable.dev', 'vercel.app', 'supabase.co', 'supabase.in',
  ...(!hostedIsLoopback && hostedRef ? [hostedRef] : []),
];

/** The declared places each secret of this pass is allowed to appear, stated as places rather than as a
 *  ban. Run 1 asserted "no credential anywhere" and then failed on the guest credential in the guest's own
 *  page address and the host's own bearer on the host's own API calls — which is how publication and login
 *  are designed to work. What is refused here is travel *outside* the declared set, plus any third-party
 *  appearance of any of them, which the ban shape could not express. */
const TRAVEL = {
  shareToken: [
    { origin: PREVIEW, pathPrefix: '/i/', fields: ['url'] },
    { origin: API_ORIGIN, pathIncludes: '/rpc/resolve_public_invitation',
      fields: ['x-invitation-token'] },
  ],
  bearer: [{ origin: API_ORIGIN, fields: ['authorization'] }],
  serviceKey: [],
  hostedRef: [],
  password: [],
  email: [],
};
const needlesFor = (token, bearer) => ({
  shareToken: token, serviceKey, hostedRef, password: PASSWORD, email: HOST_EMAIL,
  ...(bearer ? { bearer } : {}),
});

// --------------------------------------------------------------------------- reporting

const TOKEN_SHAPED = /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g;
const JWT_SHAPED = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const mask = (value) => String(value)
  .replace(TOKEN_SHAPED, (whole, lead) => `${lead}‹credential masked›`)
  .replace(JWT_SHAPED, '‹jwt masked›')
  .split(PASSWORD).join('‹password masked›')
  .split(HOST_EMAIL).join('‹email masked›');

const results = [];
let failureCount = 0;
function check(area, name, ok, detail) {
  const shown = detail === undefined ? '' : mask(String(detail)).slice(0, 400);
  results.push({ area, name, ok: Boolean(ok), detail: shown });
  if (!ok) failureCount += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} [${area}] ${name}${shown ? ` — ${shown}` : ''}`);
}
function measure(area, name, value) {
  results.push({ area, name, ok: true, detail: mask(String(value)), measured: true });
  console.log(`  ..   [${area}] ${name} — ${mask(String(value))}`);
}

// --------------------------------------------------------------------------- the stack

function psqlRun(statement) {
  execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement], { stdio: ['ignore', 'inherit', 'inherit'] });
}
function psqlRows(query) {
  const out = execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', query], { encoding: 'utf8' });
  return out.split(/\r?\n/).filter((line) => line.length > 0);
}

/** Every text file in the built bundle, concatenated, so "the bytes handed to the browser call loopback"
 *  is read off `dist/` rather than inferred from which env file wins at build time. */
function bundleSources() {
  const parts = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(?:js|mjs|css|html)$/.test(entry.name)) parts.push(readFileSync(p, 'utf8'));
    }
  };
  walk(resolve(ROOT, 'dist'));
  return parts.join('\n');
}

const hosts = {};
const refresh = async (who) => (await hosts[who].client.auth.getSession()).data.session.access_token;
const firstRow = (body) => (Array.isArray(body) ? body[0] : body);

async function rest(who, method, rel, query, body) {
  const jwt = await refresh(who);
  const res = await fetch(`${apiUrl}/rest/v1/${rel}${query}`, {
    method,
    headers: { apikey: anonKey, Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : JSON.parse(text) };
}

async function rpc(who, fn, params) {
  const jwt = await refresh(who);
  const res = await fetch(`${apiUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json', 'Content-Profile': 'api' },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  const body = text === '' ? null : JSON.parse(text);
  return { status: res.status, body, refused: res.status >= 400,
    explain: `${res.status} ${body?.code ?? ''} ${body?.message ?? text}` };
}

/** The guest's own read, from this process, with the credential in the header — the same two facts the
 *  browser is later checked against rather than assumed. */
async function resolveAs(token) {
  const res = await fetch(`${apiUrl}/rest/v1/rpc/resolve_public_invitation`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json',
      'Content-Profile': 'api', 'x-invitation-token': token },
  });
  return { status: res.status, body: await res.json() };
}

async function seedPublishedInvitation() {
  const c = createClient(apiUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: HOST_EMAIL, password: PASSWORD });
  if (error || !data.session) {
    throw new Error(`the local stack would not create this run's host: ${error?.message ?? 'no session'}`);
  }
  hosts.host = { client: c, userId: data.user.id };

  const created = await c.from('weddings')
    .insert({ owner_user_id: data.user.id, title: 'Stage 32 network pass', primary_language: 'en' })
    .select('id').single();
  if (created.error) throw new Error(`wedding write refused: ${created.error.message}`);
  const weddingId = created.data.id;

  const draft = { welcome: 'With love from the Kandasamy family.',
    family_introduction: 'Grandparents, parents and siblings invite you.',
    event_notes: 'A meal follows the ceremony on the terrace.',
    closing: 'Your presence is the only gift we ask for.' };
  const draftWrite = await rest('host', 'PATCH', 'invitation_drafts', `?wedding_id=eq.${weddingId}`,
    { content: draft });
  if (draftWrite.status !== 200 || !firstRow(draftWrite.body)?.content?.welcome) {
    throw new Error(`the draft write did not land: ${draftWrite.status} `
      + JSON.stringify(draftWrite.body).slice(0, 200));
  }

  const venue = await rest('host', 'POST', 'venues', '',
    { wedding_id: weddingId, name: 'Kalyana Mantapa', address_text: '100 Pillar Road',
      map_url: 'https://maps.example.test/kalyana' });
  if (venue.status !== 201) throw new Error(`venue write refused: ${JSON.stringify(venue.body)}`);
  const venueId = firstRow(venue.body).id;

  const event = await rest('host', 'POST', 'wedding_events', '', {
    wedding_id: weddingId, event_key: 'muhurtham', display_name: 'Muhurtham',
    starts_at_local: '2026-11-14T07:30:00', timezone: 'Asia/Kolkata', venue_id: venueId });
  if (event.status !== 201) throw new Error(`event write refused: ${JSON.stringify(event.body)}`);

  const person = await rest('host', 'POST', 'wedding_people', '', {
    wedding_id: weddingId, display_name: 'Ravikumar Kandasamy', role_label: 'Father',
    role_key: 'father', group_label: "The groom's family" });
  if (person.status !== 201) throw new Error(`person write refused: ${JSON.stringify(person.body)}`);

  const frozen = await rpc('host', 'create_invitation_version', { p_wedding_id: weddingId });
  if (frozen.refused) throw new Error(`freeze refused — ${frozen.explain}`);
  const published = await rpc('host', 'publish_invitation_version', {
    p_wedding_id: weddingId, p_version_id: frozen.body.version_id, p_expires_at: null });
  if (published.refused) throw new Error(`publish refused — ${published.explain}`);
  const token = published.body.path.slice('/i/'.length);
  const guest = await resolveAs(token);
  return { weddingId, versionId: frozen.body.version_id, token,
    available: guest.body.available === true };
}

// --------------------------------------------------------------------------- the classification

/** The needles this pass hunts through every request URL and every captured header value. Empty needles
 *  are dropped: `String(x).includes('')` is true for everything, and a vacuous needle would have the
 *  instrument report a leak where there is none. */
function hunt(requests, needles) {
  const active = Object.entries(needles).filter(([, value]) => typeof value === 'string' && value !== '');
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

/** Where a secret is *allowed* to appear, stated as places rather than as a ban. Run 1 proved the ban
 *  shape is wrong: the guest credential and the host's own bearer are supposed to travel — to the
 *  loopback preview address and the loopback API, respectively — so a blanket "no credential anywhere"
 *  check fires on the design. What matters, and what is asserted, is that nothing reaches a third party
 *  and that each secret's local travel is exactly the declared set of places. */
function travelReport(area, label, requests, needles, allowed) {
  const hits = hunt(requests, needles);
  const thirdParty = hits.filter((h) => !LOOPBACK_HOSTS.has(h.host));
  const unexpected = hits.filter((h) => {
    const set = allowed[h.needleName];
    if (!set) return true;
    return !set.some((a) => (a.origin === undefined || a.origin === h.origin)
      && (a.pathIncludes === undefined || h.url.includes(a.pathIncludes))
      && (a.pathPrefix === undefined || h.path.startsWith(a.pathPrefix))
      && (a.fields === undefined || a.fields.includes(h.field)));
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

const headerGet = (headers, name) => {
  const key = Object.keys(headers ?? {}).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? null : headers[key];
};
const headerNames = (headers) => Object.keys(headers ?? {}).map((k) => k.toLowerCase()).sort();

/** One surface, in its own browser context, classified. `cumulative: false` because each anonymous page is
 *  a fresh context and a fresh target — the authenticated half reuses a page and says so in its labels. */
function classify(area, label, requests, needles, allowed = TRAVEL) {
  const network = requests.filter((r) => ['http:', 'https:'].includes(schemeOf(r.url)));
  const inPage = requests.filter((r) => IN_PAGE_SCHEMES.has(schemeOf(r.url)));
  const other = requests.filter((r) => !['http:', 'https:'].includes(schemeOf(r.url))
    && !IN_PAGE_SCHEMES.has(schemeOf(r.url)));

  const byOrigin = new Map();
  for (const r of network) byOrigin.set(originOf(r.url), (byOrigin.get(originOf(r.url)) ?? 0) + 1);
  for (const [o, count] of [...byOrigin].sort()) {
    const kind = o === PREVIEW ? 'LOCAL PREVIEW (the production bundle)'
      : o === API_ORIGIN ? 'LOCAL API (this repository\'s own stack)'
        : FONT_HOSTS.has(hostOf(o)) ? 'THIRD-PARTY FONT CDN (declared in index.html)'
          : 'UNCLASSIFIED';
    measure(area, `${label} · ${o} — ${count} request(s)`, kind);
  }
  if (inPage.length) {
    measure(area, `${label} · ${inPage.length} in-page request(s) — no host, nothing left the machine`,
      [...new Set(inPage.map((r) => `${r.type} ${r.url.slice(0, 42)}`))].join(', '));
  }
  check(area, `${label}: every in-page request has no host to send to`,
    inPage.every((r) => hostFor(r.url) === ''),
    inPage.filter((r) => hostFor(r.url) !== '').map((r) => r.url.slice(0, 60)).join(', ')
      || `${inPage.length} in-page request(s), all hostless`);
  check(area, `${label}: every scheme this page used is http(s) or an in-page one`,
    other.length === 0, other.map((r) => schemeOf(r.url)).join(', ') || 'no other scheme appeared');

  const offMachine = [...byOrigin.keys()].filter((o) => {
    const h = hostOf(o);
    return !LOOPBACK_HOSTS.has(h) && !FONT_HOSTS.has(h);
  });
  check(area, `${label}: every http(s) destination is loopback or a declared font host`,
    offMachine.length === 0, offMachine.join(', ') || 'nothing else was reached');
  const telemetry = [...byOrigin.keys()].filter((o) =>
    TELEMETRY_HOSTS.some((h) => hostOf(o) === h || hostOf(o).endsWith(`.${h}`)));
  check(area, `${label}: no analytics, tag-manager, error-reporting or hosted-Supabase destination`,
    telemetry.length === 0, telemetry.join(', ') || 'none of the named hosts was reached');
  const travel = travelReport(area, label, requests, needles, allowed);
  return { byOrigin, offMachine, telemetry, network, inPage, other, ...travel };
}

async function reportPrivacyState(area, label, privacy, cookies) {
  measure(area, `${label} · what the browser holds for this origin`, JSON.stringify({
    documentCookieChars: privacy.cookie.length, localKeys: privacy.local,
    sessionKeys: privacy.session, localBytes: privacy.localBytes, chromeCookies: cookies }));
}

async function openSurface(browser, { label, path, wait, area, needles, settleMs = 2_500 }) {
  const page = await browser.newPage(label);
  await page.viewport({ name: '1280x800', width: 1280, height: 800, dpr: 1, mobile: false });
  await page.goto(`${PREVIEW_ORIGIN}${path}`);
  const drew = await page.waitForSelector(wait, 25_000);
  await sleep(settleMs);
  const requests = await page.networkLog();
  const privacy = await page.privacyState();
  const cookies = await page.cookiesForOrigin();
  const url = await page.currentUrl();

  console.log(`\n--- ${label} @ ${mask(url.replace(PREVIEW_ORIGIN, ''))}`);
  check(area, `${label}: the surface drew something to observe`, drew,
    `selector "${wait}" never appeared on ${url}`);
  measure(area, `${label} · requests seen on this session`, `${requests.length}`);
  const out = classify(area, label, requests, needles);
  await reportPrivacyState(area, label, privacy, cookies);

  // What the font CDN is actually told, per request. Run 1's claim here — "nothing is handed over as a
  // referrer" — was wrong in both directions, so it is replaced by a measurement: the stylesheet the page
  // itself requests carries an **empty** Referer (the `no-referrer` meta in index.html doing its job),
  // while the font *files* are requested by Google's own stylesheet and so carry the CDN's own origin as
  // their referrer. Neither names this app's address, and the credential is in neither.
  const toFonts = requests.filter((r) => FONT_HOSTS.has(hostOf(r.url)));
  const refClass = (value) => {
    if (value === null) return 'absent';
    if (value === '') return 'empty';
    let name;
    try { name = hostOf(value); } catch { return 'unparseable-value'; }
    if (LOOPBACK_HOSTS.has(name)) return 'OUR-OWN-ORIGIN';
    if (FONT_HOSTS.has(name)) return `cdn-self (${name})`;
    return `other-host (${name})`;
  };
  const referred = toFonts.map((r) => {
    const v = headerGet(r.headers, 'referer') ?? headerGet(r.headers, 'referrer');
    return { type: r.type ?? '(unknown)', value: v, klass: refClass(v) };
  });
  measure(area, `${label} · ${toFonts.length} request(s) toward the font CDN, by referrer class`,
    [...new Set(referred.map((x) => `${x.type}: ${x.klass}`))].join(' | ') || 'no CDN request');
  const pageInitiated = referred.filter((x) => x.type !== 'Font');
  check(area, `${label}: the requests this page makes to the CDN carry no referrer at all`,
    pageInitiated.every((x) => x.klass === 'absent' || x.klass === 'empty'),
    pageInitiated.filter((x) => x.klass !== 'absent' && x.klass !== 'empty')
      .map((x) => `${x.type}: ${x.klass}`).join(', ') || 'nothing of ours was named');
  check(area, `${label}: nothing sent to the CDN names this app's own origin`,
    referred.every((x) => x.klass !== 'OUR-OWN-ORIGIN' && !x.klass.startsWith('other-host')),
    referred.filter((x) => x.klass === 'OUR-OWN-ORIGIN' || x.klass.startsWith('other-host'))
      .map((x) => `${x.type}: ${x.klass}`).join(', ')
      || 'only the CDN\'s own origin ever appears, on files its own CSS asked for');
  const originsSent = [...new Set(toFonts.map((r) => headerGet(r.headers, 'origin')).filter(Boolean))];
  measure(area, `${label} · Origin the browser puts on CDN requests (not suppressible by referrer policy;`
    + ` the preconnect in index.html reveals it by design)`, originsSent.join(', ') || 'none');
  check(area, `${label}: the Origin handed to the CDN is the bare preview origin, with no path`,
    originsSent.every((o) => o === PREVIEW), originsSent.join(', ') || 'none');
  return { page, requests, privacy, cookies, url, ...out };
}

// --------------------------------------------------------------------------- anonymous surfaces

async function anonymousHalf(browser, doc) {
  console.log('\n==> §32 A — the surfaces a person reaches before they sign in');
  const needles = needlesFor(doc.token);
  const surfaces = {};
  for (const [key, spec] of Object.entries({
    landing: { label: 'landing /', path: '/', wait: 'header' },
    login: { label: 'login /login', path: '/login', wait: '#email' },
    signup: { label: 'signup /signup', path: '/signup', wait: '#email' },
    guest404: { label: 'guest /i/<a credential that was never minted>',
      path: '/i/neverminted0000000000000000000000000000000000000000000', wait: 'body' },
  })) {
    surfaces[key] = await openSurface(browser, { ...spec, area: 'surface', needles });
    const api = surfaces[key].requests.filter((r) => originOf(r.url) === API_ORIGIN
      && r.method !== 'OPTIONS');
    measure('surface', `${spec.label} · API calls made before anyone signed in`,
      api.length === 0 ? 'none'
        : [...new Set(api.map((r) => new URL(r.url).pathname))].join(', '));
    check('surface', `${spec.label}: no API call it made was authorised with anything but the anonymous key`,
      api.every((r) => {
        const value = headerGet(r.headers, 'authorization');
        return value === null || value === `Bearer ${anonKey}`;
      }),
      api.filter((r) => {
        const value = headerGet(r.headers, 'authorization');
        return value !== null && value !== `Bearer ${anonKey}`;
      }).map((r) => new URL(r.url).pathname).join(', ') || 'no other authorisation was sent');
    check('surface', `${spec.label}: no request carried a session cookie`,
      surfaces[key].requests.every((r) => !headerNames(r.headers).includes('cookie')),
      surfaces[key].requests.filter((r) => headerNames(r.headers).includes('cookie'))
        .map((r) => hostOf(r.url)).join(', ') || 'none carried one');
  }
  return surfaces;
}

// --------------------------------------------------------------------------- the guest page

async function guestHalf(browser, doc) {
  console.log('\n==> §32 B — one cold load of a real guest page, request by request');
  const needles = needlesFor(doc.token);
  const seen = await openSurface(browser, {
    label: 'guest /i/<credential>', path: `/i/${doc.token}`, wait: 'article', area: 'guest', needles });
  check('guest', 'the guest page resolved the invitation this pass published', doc.available);

  const apiAll = seen.requests.filter((r) => originOf(r.url) === API_ORIGIN);
  const preflights = apiAll.filter((r) => r.method === 'OPTIONS');
  const apiCalls = apiAll.filter((r) => r.method !== 'OPTIONS');
  measure('guest', 'CORS preflights to the local API', `${preflights.length}`);
  const resolver = apiCalls.filter((r) => new URL(r.url).pathname
    .endsWith('/rpc/resolve_public_invitation'));
  check('guest', 'exactly one API call was made, and it was the resolver',
    apiCalls.length === 1 && resolver.length === 1,
    `${apiCalls.length} call(s): ${apiCalls.map((r) => new URL(r.url).pathname).join(', ')}`);
  measure('guest', 'resolver request URL', resolver[0]?.url ?? '(none)');

  const headers = resolver[0]?.headers ?? {};
  measure('guest', 'resolver header names', JSON.stringify(headerNames(headers)));
  check('guest', 'the credential travelled in the x-invitation-token header',
    headerGet(headers, 'x-invitation-token') === doc.token);
  check('guest', 'the guest\'s apikey and bearer are the same anonymous key, and neither is a user session',
    headerGet(headers, 'apikey') === anonKey
    && headerGet(headers, 'authorization') === `Bearer ${anonKey}`,
    `apikey ${headerGet(headers, 'apikey') === anonKey ? 'is' : 'is NOT'} the anonymous key; `
    + `authorization ${headerGet(headers, 'authorization') === `Bearer ${anonKey}` ? 'is' : 'is NOT'} it too`);
  check('guest', 'the service-role key reaches no header on this page',
    !Object.values(headers).some((v) => String(v).includes(serviceKey)));
  check('guest', 'the resolver call sent no cookie', !headerNames(headers).includes('cookie'));
  measure('guest', 'content profile on the resolver call', headerGet(headers, 'content-profile') ?? '(none)');
  check('guest', 'no auth, admin, publish, revoke, rotate or write endpoint was reached',
    apiCalls.every((r) => !/auth|admin|token|publish|revoke|rotate|create_invitation|patch|delete/i
      .test(new URL(r.url).pathname)),
    apiCalls.map((r) => new URL(r.url).pathname).join(', '));

  // The disclosed Stage 3 residual, restated rather than hidden: `/i/<credential>` is the address a host
  // pastes into a chat, so the credential *is* in the navigation request to the preview server, and in
  // browser history, which no header policy reaches.
  const navWithToken = seen.requests.filter((r) => originOf(r.url) === PREVIEW
    && r.url.includes(doc.token));
  measure('guest', 'disclosed residual — the credential is in the page address, not in the API call',
    `${navWithToken.length} navigation request(s) to ${PREVIEW} carry it in the path /i/‹credential masked›;`
    + ` ${apiCalls.length} API request(s) do not`);
  check('guest', 'the anonymous visitor holds no session anywhere the browser keeps one',
    seen.privacy.local.length === 0 && seen.privacy.session.length === 0
    && seen.privacy.cookie.length === 0 && seen.cookies.length === 0,
    JSON.stringify({ local: seen.privacy.local, session: seen.privacy.session,
      documentCookieChars: seen.privacy.cookie.length, chromeCookies: seen.cookies.map((c) => c.name) }));

  // A second visit must not turn into a different number of destinations, and the page must not start
  // talking to the API on interaction it never asked for.
  await seen.page.reload();
  await sleep(2_000);
  const afterReload = await seen.page.networkLog();
  measure('guest', 'requests after one reload of the same address', `${afterReload.length}`);
  classify('guest', 'guest page after reload', afterReload, needles);
  return seen;
}

// --------------------------------------------------------------------------- the signed-in host

async function hostHalf(browser, doc) {
  console.log('\n==> §32 C — the authenticated surfaces, where a session token exists');
  const host = await browser.newPage('host-session');
  await host.viewport({ name: '1280x800', width: 1280, height: 800, dpr: 1, mobile: false });
  await host.goto(`${PREVIEW_ORIGIN}/login`);
  await host.waitForSelector('#email', 20_000);
  await host.setBySelector('#email', HOST_EMAIL);
  await host.setBySelector('#password', PASSWORD);
  const pressed = await host.pressButton('Log in');
  const landed = await waitForUrl(host, '/dashboard');
  check('host', 'this run\'s own host signed in through the real login screen',
    pressed === 'pressed' && Boolean(landed),
    `press ${pressed}, ${landed ?? await host.currentUrl()}`);

  // The bearer the app minted, read so the leak hunt can search for *it*. Never returned to the report.
  const bearer = await host.authHeader();
  check('host', 'the app persisted a session for the signed-in host', Boolean(bearer),
    bearer ? 'a token is in storage' : 'no access token found in storage');
  const needles = needlesFor(doc.token, bearer);

  const surfaces = {};
  for (const [key, spec] of Object.entries({
    dashboard: { path: '/dashboard', wait: 'main' },
    configure: { path: `/project/${doc.weddingId}/configure`, wait: 'main' },
    editor: { path: `/project/${doc.weddingId}/edit`, wait: 'h1' },
  })) {
    await host.goto(`${PREVIEW_ORIGIN}${spec.path}`);
    const drew = await host.waitForSelector(spec.wait, 25_000);
    await sleep(2_500);
    const requests = await host.networkLog();
    const privacy = await host.privacyState();
    const cookies = await host.cookiesForOrigin();
    const url = await host.currentUrl();
    console.log(`\n--- host ${mask(spec.path)} @ ${mask(url.replace(PREVIEW_ORIGIN, ''))}`);
    check('host', `host ${key}: the surface drew something to observe`, drew, `selector "${spec.wait}"`);
    measure('host', `host ${key} · requests seen in this one browser session, cumulative`,
      `${requests.length}`);
    // Cumulative by design — a signed-in session is the unit being measured — so the *new* traffic on
    // this surface is named separately, and the claim below is about the session as a whole.
    classify('host', `host ${key} (session-cumulative)`, requests, needles);
    await reportPrivacyState('host', `host ${key}`, privacy, cookies);

    const api = requests.filter((r) => originOf(r.url) === API_ORIGIN && r.method !== 'OPTIONS');
    const authClass = (v) => (v === `Bearer ${bearer}` ? 'host bearer'
      : v === `Bearer ${anonKey}` ? 'anonymous key' : v === null ? 'none' : 'another token');
    const pathOf = (r) => new URL(r.url).pathname;
    // The login exchange is the one API call that is authorised with the anonymous key **by design**: it
    // is the call that creates the session, so demanding a bearer on it is a category error. Run 1 counted
    // it against the session because its tally was cumulative over the whole page, and reported a finding
    // on the sign-in itself. The boundary is now drawn at the path, and both sides are asserted.
    const authCalls = api.filter((r) => pathOf(r).startsWith('/auth/'));
    const dataCalls = api.filter((r) => !pathOf(r).startsWith('/auth/'));
    measure('host', `host ${key} · API paths reached`,
      api.length === 0 ? 'none' : [...new Set(api.map(pathOf))].join(', '));
    measure('host', `host ${key} · how the data calls were authorised`, JSON.stringify(
      dataCalls.reduce((acc, r) => {
        const c = authClass(headerGet(r.headers, 'authorization'));
        return { ...acc, [c]: (acc[c] ?? 0) + 1 };
      }, {})));
    measure('host', `host ${key} · the auth endpoint calls in this session`,
      authCalls.length === 0 ? 'none'
        : authCalls.map((r) => `${r.method} ${pathOf(r)} → ${
          authClass(headerGet(r.headers, 'authorization'))}`).join(', '));
    check('host', `host ${key}: every data call carried the host's own bearer`,
      dataCalls.every((r) => headerGet(r.headers, 'authorization') === `Bearer ${bearer}`),
      dataCalls.filter((r) => headerGet(r.headers, 'authorization') !== `Bearer ${bearer}`)
        .map((r) => `${pathOf(r)} → ${authClass(headerGet(r.headers, 'authorization'))}`)
        .join(', ') || `${dataCalls.length} data call(s), all on the host bearer`);
    check('host', `host ${key}: no data call was made with only the anonymous key`,
      !dataCalls.some((r) => headerGet(r.headers, 'authorization') === `Bearer ${anonKey}`),
      dataCalls.filter((r) => headerGet(r.headers, 'authorization') === `Bearer ${anonKey}`)
        .map(pathOf).join(', ') || 'none');
    check('host', `host ${key}: the token exchange was the anonymous-key call, and the session was not needed for it`,
      authCalls.every((r) => headerGet(r.headers, 'authorization') === `Bearer ${anonKey}`
        || headerGet(r.headers, 'authorization') === `Bearer ${bearer}`),
      authCalls.map((r) => `${pathOf(r)} → ${authClass(headerGet(r.headers, 'authorization'))}`)
        .join(', ') || 'no auth call');
    check('host', `host ${key}: the session lives in this origin's storage and in no cookie`,
      cookies.length === 0 && privacy.local.some((k) => k.startsWith('sb-')),
      JSON.stringify({ chromeCookies: cookies.map((c) => c.name), localKeys: privacy.local,
        sbKeySeen: privacy.local.some((k) => k.startsWith('sb-')) }));
    check('host', `host ${key}: no request carried the guest credential`,
      !requests.some((r) => r.url.includes(doc.token)
        || Object.values(r.headers ?? {}).some((v) => String(v).includes(doc.token))));
    surfaces[key] = { requests, privacy, cookies };
  }
  return surfaces;
}

async function waitForUrl(page, part, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const url = await page.currentUrl();
    if (url.includes(part)) return url;
    if (Date.now() > deadline) return null;
    await sleep(200);
  }
}

// --------------------------------------------------------------------------- main

async function main() {
  console.log(`Stage 5 §32 network and privacy · run tag ${RUN_TAG} · preview ${PREVIEW_ORIGIN}`);
  const bundle = bundleSources();
  check('prelude', 'the shipped bundle calls the loopback API target',
    bundle.includes(browserApiUrl), `the URL baked into dist/ is the one .env.local declares`);
  if (hostedIsLoopback) {
    check('prelude', 'a hosted project reference exists for the bundle to be searched for', false,
      '.env declares no non-loopback VITE_SUPABASE_URL, so this pass has nothing to compare against');
  } else {
    check('prelude', 'the hosted project reference .env declares is absent from the bundle',
      !bundle.includes(hostedRef), 'the hosted value is not printed here');
    measure('prelude', 'the hosted reference class this pass searched dist/ for',
      `one label of a .supabase host, ${hostedRef.length} characters`);
  }

  const doc = await seedPublishedInvitation();
  check('prelude', 'a real invitation was frozen and published on the local stack for this pass',
    doc.available, `wedding ${doc.weddingId.slice(0, 8)}, version ${doc.versionId.slice(0, 8)}`);
  measure('prelude', 'the guest address this pass measured, as the report shows it',
    `/i/‹credential masked› (${doc.token.length} characters)`);

  const browser = await openBrowser({ cdpPort: CDP_PORT });
  let profile = null;
  try {
    await anonymousHalf(browser, doc);
    await guestHalf(browser, doc);
    await hostHalf(browser, doc);
  } finally {
    profile = await browser.close();
  }

  console.log('\n==> §32 teardown');
  check('cleanup', 'the browser profile that held the host session was deleted by the driver',
    profile?.profileRemoved === true,
    profile?.profileRemoved ? 'removed' : `still present at ${profile?.profilePath}`);

  const ownerIds = `(select w.id from public.weddings w join auth.users u on u.id = w.owner_user_id
                      where u.email = '${HOST_EMAIL}')`;
  psqlRun(`
    delete from private.access_tokens where wedding_id in ${ownerIds};
    delete from public.publications where wedding_id in ${ownerIds};
    delete from public.invitation_versions where wedding_id in ${ownerIds};
    delete from public.invitation_drafts where wedding_id in ${ownerIds};
    delete from public.weddings where id in ${ownerIds};
  `);
  const svc = createClient(apiUrl, serviceKey, { auth: { persistSession: false } });
  await svc.auth.admin.deleteUser(hosts.host.userId);
  const left = psqlRows(`select count(*) from public.weddings w
                         join auth.users u on u.id = w.owner_user_id where u.email = '${HOST_EMAIL}'`);
  check('cleanup', 'the rows and the account this pass created are gone', left[0] === '0',
    `left ${left[0]}`);

  console.log(`\n==> checks ${results.filter((r) => !r.measured).length}, `
    + `measurements ${results.filter((r) => r.measured).length}, findings ${failureCount}`);
  if (failureCount > 0) {
    console.log('FINDINGS:');
    for (const r of results.filter((x) => !x.ok)) console.log(`  - [${r.area}] ${r.name}: ${r.detail}`);
    console.log('STAGE 5 §32: FINDINGS ABOVE');
    process.exit(1);
  }
  console.log('STAGE 5 §32 NETWORK / PRIVACY: PASS');
}

main().catch((err) => {
  console.error(`\nHARNESS FAILURE: ${err?.stack ?? err}`);
  process.exit(2);
});
