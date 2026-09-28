// Stage 4 §21/§22/§26/§27 — the render, provenance, network and viewport qualification.
//
// This file is a *measurement instrument*, not a unit test. It drives the real local stack over
// the real HTTP API, then drives a real Chromium against the real production bundle served by
// `vite preview`, and prints what it observed. It exists because §21 asks for the journey "on real
// stack + production build" and §27 asks for a matrix no jsdom test can answer: horizontal
// overflow, clipping, touch-target sizes, running animations and font faces are facts about a
// layout engine.
//
// Prerequisites, checked rather than assumed:
//   * this repository's local stack running (`supabase_db_localvivaahvarnam` and its Kong), and
//   * `npm run build` having produced `dist`, and
//   * `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort` serving it.
//
// What it writes: rows in the *local* database for the duration of the run, deleted again in the
// teardown, and PNG screenshots under the OS temp directory. Guest credentials are held in memory
// and printed masked; no token is written to any file.
//
//   node scripts/stage4-render-qualification.mjs               everything
//   node scripts/stage4-render-qualification.mjs --skip-matrix §21/§22/§26 only
//
// Like `supabase/tests/api/run.sh`, it refuses to run against anything that is not loopback.

import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const PREVIEW_ORIGIN = process.env.STAGE4_PREVIEW_URL ?? 'http://127.0.0.1:4173';
const CHROME_PORT = Number(process.env.STAGE4_CDP_PORT ?? 9333);
const SKIP_MATRIX = process.argv.includes('--skip-matrix');
/** Created only when the matrix actually captures something, so a `--skip-matrix` run leaves no
 *  directory behind (§31's cleanup is scoped to what a run created). */
let screenshotDir;

// --------------------------------------------------------------------------- environment

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
const apiUrl = env.SUPABASE_LOCAL_URL;
const anonKey = env.SUPABASE_LOCAL_PUBLISHABLE_KEY;
const serviceKey = env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
const browserApiUrl = env.VITE_SUPABASE_URL;
if (!apiUrl || !anonKey || !serviceKey || !browserApiUrl) {
  throw new Error('.env.local is missing one of the local API targets this script reads');
}
if (!LOOPBACK.has(new URL(apiUrl).hostname)) {
  throw new Error(`refusing to run: SUPABASE_LOCAL_URL=${apiUrl} is not loopback`);
}
if (!LOOPBACK.has(new URL(browserApiUrl).hostname)) {
  throw new Error(`refusing to run: the bundle's VITE_SUPABASE_URL=${browserApiUrl} is not loopback`);
}
if (!LOOPBACK.has(new URL(PREVIEW_ORIGIN).hostname)) {
  throw new Error(`refusing to run: ${PREVIEW_ORIGIN} is not loopback`);
}

const toml = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');
const projectId = /^project_id\s*=\s*"?([^"\n]+?)"?\s*$/m.exec(toml)?.[1]?.trim();
if (projectId !== 'localvivaahvarnam') {
  throw new Error(`refusing to run: project_id is ${projectId}, not localvivaahvarnam`);
}
const DB_CONTAINER = process.env.STAGE3_DB_CONTAINER ?? `supabase_db_${projectId}`;
if (!/^[A-Za-z0-9_.-]+$/.test(DB_CONTAINER)) {
  throw new Error(`refusing to run: STAGE3_DB_CONTAINER=${DB_CONTAINER} is not a container name`);
}

const RUN_TAG = `stage4render-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}-${RUN_TAG}`;

// --------------------------------------------------------------------------- reporting

const results = [];
let failureCount = 0;

/** A minted credential is 43 URL-safe characters, which is what `private.mint_public_invitation_token`
 *  writes, so a report line can pick one up out of a URL or a JSON body without knowing which token
 *  it is. §31 forbids a raw test token being left anywhere a later reader finds it, and a console log
 *  is such a place — so every detail string passes through here. The shape is masked even when it is
 *  not this run's token; over-masking a printed string costs nothing, under-masking it is the leak. */
const TOKEN_SHAPED = /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g;
const mask = (value) => String(value).replace(TOKEN_SHAPED,
  (whole, lead) => `${lead}‹credential masked›`);

/** One measured fact. `ok === false` is a finding, not a thrown exception, so a single run reports
 *  every problem the tree has rather than the first one. */
function check(area, name, ok, detail) {
  const shown = detail === undefined ? '' : mask(detail);
  results.push({ area, name, ok: Boolean(ok), detail: shown });
  if (!ok) failureCount += 1;
  const mark = ok ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} [${area}] ${name}${shown ? ` — ${shown}` : ''}`);
}

function measure(area, name, value) {
  const shown = mask(value);
  console.log(`  ..   [${area}] ${name} — ${shown}`);
  results.push({ area, name, ok: true, detail: shown, measured: true });
}

/** What §21 forbids a guest from learning at all, so it is scanned for in the DTO as well as in
 *  the page: review records, machine-assistance disclosure, source references, and the candidate
 *  placeholder marker the draft artifact uses. */
const NEVER_PUBLIC = [
  'TEST FIXTURE REVIEW',
  'NOT A REAL CULTURAL REVIEW',
  'machine_assisted',
  'machine_assistance_notes',
  'review_label',
  'review_basis',
  'review_scope',
  'reviewed_by',
  'reviewed_at',
  'approved_at',
  'source_reference',
  'author_label',
  'changelog',
  '[placeholder]',
];

/** Platform identifiers that *are* in the guest DTO — the projection carries them so a later
 *  build can group rows — and which §27 forbids in the drawn text. Two lists, because "never sent"
 *  and "never drawn" are different claims, and conflating them would have this script fail on the
 *  first and pass the second by accident. */
const NEVER_DRAWN = [
  'role_key',
  'group_key',
  'event_key',
  'section_key',
  'body_source',
  'fallback_used',
  'overrode_pack_text',
  'definition_schema_version',
];

/** Everything that must never be *seen* by a guest, whether or not it is in the payload. */
const NEVER_IN_PAGE_TEXT = [...NEVER_PUBLIC, ...NEVER_DRAWN];
const inText = (text) => NEVER_IN_PAGE_TEXT.filter((needle) => text.includes(needle));

// --------------------------------------------------------------------------- the stack

function psqlRows(query) {
  const out = execFileSync('docker', ['exec', '-i', DB_CONTAINER,
    'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', query],
  { encoding: 'utf8' });
  return out.split(/\r?\n/).filter((line) => line.length > 0);
}

function psqlRun(statement) {
  execFileSync('docker', ['exec', '-i', DB_CONTAINER,
    'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement],
  { stdio: ['ignore', 'inherit', 'inherit'] });
}

function psqlFile(rel, vars = {}) {
  const bytes = readFileSync(resolve(ROOT, rel), 'utf8').replace(/\r/g, '');
  const args = ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-tA', '-F', '|'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  args.push('-f', '-');
  const out = execFileSync('docker', args, { input: bytes, encoding: 'utf8' });
  return out.split(/\r?\n/).filter((line) => line.length > 0);
}

const hosts = {};
const clientFor = (who) => hosts[who].client;

/** Every text file in the built bundle, concatenated, so §26's claim that the bundle calls the
 *  loopback target is read off `dist/` rather than inferred from which env file wins. */
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

async function signUp(who) {
  const c = createClient(apiUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: emailFor(who), password: PASSWORD });
  if (error) throw new Error(`signup failed for ${who}: ${error.message}`);
  if (!data.session) throw new Error(`no session for ${who}`);
  return { client: c, userId: data.user.id, token: data.session.access_token };
}

async function refresh(who) {
  const { data } = await hosts[who].client.auth.getSession();
  return data.session.access_token;
}

async function rest(method, rel, query, body, { as = 'anon', represent = false } = {}) {
  const key = as === 'anon' ? anonKey : hosts[as].client.supabaseKey;
  const jwt = as === 'anon' ? anonKey : await refresh(as);
  const res = await fetch(`${apiUrl}/rest/v1/${rel}${query}`, {
    method,
    headers: {
      apikey: key, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json',
      ...(represent ? { Prefer: 'return=representation' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : JSON.parse(text) };
}

/** `Prefer: return=representation` makes PostgREST answer with an *array* of rows even for a
 *  single insert, so reading `.id` off the body directly yields undefined and the row silently
 *  loses its foreign key. Measured: the first draft of this instrument created events with
 *  `venue_id` null and a guest page with no venue on it. */
const firstRow = (body) => (Array.isArray(body) ? body[0] : body);

/** A function call, and its answer as PostgREST actually shapes it: a refusal is a 4xx whose body
 *  is `{code, message, details, hint}`, and a success is a 2xx whose body is the function's own
 *  jsonb. `body.error` is neither of those, so `refused` is read off the status — the first draft of
 *  this helper tested for a key that never exists and let a refused freeze sail through as a
 *  missing `path`.
 *
 *  Every callable a guest or a host reaches lives in the `api` schema, which is not the root schema
 *  PostgREST was started with, so a POST to `/rpc/<name>` without `Content-Profile: api` answers
 *  PGRST202 "Could not find the function public.…". That header is what
 *  `client.schema('api').rpc(...)` sends; measured, not assumed. */
const rpc = async (who, fn, params) => {
  const jwt = who === 'anon' ? anonKey : await refresh(who);
  const key = who === 'anon' ? anonKey : hosts[who].client.supabaseKey;
  const res = await fetch(`${apiUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json',
      'Content-Profile': 'api' },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  const body = text === '' ? null : JSON.parse(text);
  return {
    status: res.status,
    body,
    refused: res.status >= 400,
    code: body?.code ?? null,
    message: body?.message ?? null,
    explain: `${res.status} ${body?.code ?? ''} ${body?.message ?? text}`,
  };
};

/** A guest's read: the credential travels in the header the boundary was built for, exactly as
 *  `src/integrations/supabase/publicInvitation.ts` sends it. */
async function resolveAs(token) {
  const res = await fetch(`${apiUrl}/rest/v1/rpc/resolve_public_invitation`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json', 'Content-Profile': 'api', 'x-invitation-token': token },
  });
  return { status: res.status, body: await res.json() };
}

const sha = (value) => createHash('sha256').update(value).digest('hex');

// --------------------------------------------------------------------------- fixture facts

const REL = {
  r1: 'aaaaaaaa-0004-4000-8000-000000000101',
  gapFallback: 'aaaaaaaa-0004-4000-8000-000000000501',
};

/** Two release ids this instrument mints, retires and deletes for §22 alone.
 *  `REL.r1` is deliberately left approved: the API battery selects it, so deprecating a shared
 *  fixture row here would leave `stage4_http_pack.sql` raising on every later run. The minted
 *  pair belongs to this script, so its teardown can remove it. */
const MINT = {
  a: randomUUID().toLowerCase(),
  b: randomUUID().toLowerCase(),
};
const LONG_TA = 'வணக்கம் '.repeat(40) + 'இந்த அழைப்பு அனைவருக்கும். '.repeat(6);
const UNBROKEN_EN = 'A'.repeat(200) + 'B'.repeat(200);
const HOSTILE = '<img src=x onerror=alert(1)><script>alert(2)</script>'
  + '<svg onload=alert(3)></svg>"><b>bold</b> & "quotes"';

/** The ten shapes §27 numbers. Each is built through the same API a host's browser uses, so a
 *  shape is a document, not a fixture literal — and every one of them is frozen and published,
 *  because §27 measures the page a guest is given.
 *
 *  `style` is written to `weddings.style_settings` exactly as the editor writes it, so §27's font,
 *  size, alignment and contrast columns report the effect of real saved values rather than of the
 *  renderer's defaults. Three of them are deliberately out of range — a size above the clamp's
 *  ceiling, one below its floor, and one that is not a colour — because "the projection admits any
 *  one-to-three-digit number" is only a fact about a document a guest can be handed. */
const SHAPES = [
  { name: '1-no-pack-minimal', pack: null, lang: 'en', title: 'Asha weds Bala' },
  { name: '2-no-pack-full', pack: null, lang: 'en', title: 'Asha weds Bala',
    style: { font: 'Playfair Display', fontSize: '30', color: '#5c1a1b', alignment: 'left' },
    draft: { welcome: 'With love from the Kandasamy family.',
      family_introduction: 'Grandparents, parents and siblings invite you.',
      event_notes: 'A meal follows the ceremony on the terrace.',
      closing: 'Your presence is the only gift we ask for.' },
    people: [
      { display_name: 'Ravikumar Kandasamy', role_label: 'Father', group_label: "The groom's family", role_key: 'father', group_key: 'groom' },
      { display_name: 'Selvi Ravi', role_label: 'Mother', group_label: "The groom's family", role_key: 'mother', group_key: 'groom' },
      { display_name: 'Bala Murugan', group_label: "The bride's family", group_key: 'bride' },
    ],
    events: [{ event_key: 'muhurtham', display_name: 'Muhurtham',
      starts_at_local: '2026-11-14T07:30:00', ends_at_local: '2026-11-14T09:00:00',
      timezone: 'Asia/Kolkata', venue: { name: 'Kalyana Mantapa',
        address_text: '100 Pillar Road\nMadurai 625001', map_url: 'https://maps.example.test/kalyana' } }] },
  { name: '3-reviewed-tamil', pack: REL.r1, lang: 'ta', title: 'அஷா திருமணம் பாலா',
    people: [{ display_name: 'கந்தசாமி ரவிகுமார்', role_label: 'தந்தை', group_label: 'மருகன் குடும்பம்' }],
    events: [{ event_key: 'muhurtham', display_name: 'முஹூர்தம்',
      starts_at_local: '2026-11-14T07:30:00', timezone: 'Asia/Kolkata' }] },
  { name: '4-reviewed-english', pack: REL.r1, lang: 'en', title: 'Asha weds Bala',
    people: [{ display_name: 'Ravikumar Kandasamy', role_label: 'Father', group_label: 'The groom\'s family' }],
    events: [{ event_key: 'muhurtham', display_name: 'Muhurtham', starts_at_local: '2026-11-14T07:30:00' }] },
  { name: '5-tamil-fallback', pack: REL.gapFallback, lang: 'ta', title: 'அஷா திருமணம் பாலா',
    people: [{ display_name: 'கந்தசாமி ரவிகுமார்' }],
    events: [{ event_key: 'muhurtham', display_name: 'முஹூர்தம்', starts_at_local: '2026-11-14T07:30:00' }] },
  { name: '6-host-override', pack: REL.r1, lang: 'en', title: 'Asha weds Bala',
    draft: { welcome: 'Written by the family, in their own words.' },
    people: [{ display_name: 'Ravikumar Kandasamy', role_label: 'Father', group_label: 'The groom\'s family' }],
    events: [{ event_key: 'muhurtham', display_name: 'Muhurtham', starts_at_local: '2026-11-14T07:30:00' }] },
  { name: '7-long-tamil', pack: REL.r1, lang: 'ta', title: LONG_TA.slice(0, 120),
    style: { font: 'Noto Sans Tamil', fontSize: '60', color: '#3b1f2b', alignment: 'center' },
    draft: { welcome: LONG_TA },
    people: [{ display_name: 'கந்தசாமி ரவிகுமார் மகன் செல்வி கந்தசாமி மருமகள் அசா கந்தசாமி பாலாமுருகன்',
      role_label: 'குடும்பம்', group_label: 'இரண்டு குடும்பங்களின் நல்வாழ்த்துக்களுடன் இவ்வழைப்பு அனுப்பப்படுகிறது' }],
    events: [{ event_key: 'muhurtham', display_name: 'முஹூர்தம் and the reception later that evening',
      starts_at_local: '2026-11-14T07:30:00', timezone: 'Asia/Kolkata',
      venue: { name: 'மணமக்கள் மண்டபம்', address_text: LONG_TA.slice(0, 200) } }] },
  { name: '8-unbroken-english', pack: REL.r1, lang: 'en', title: UNBROKEN_EN,
    style: { fontSize: '8' },
    draft: { welcome: `A word with no break point: ${UNBROKEN_EN}` },
    people: [{ display_name: UNBROKEN_EN.slice(0, 120) }],
    events: [{ event_key: 'muhurtham', display_name: 'Muhurtham', starts_at_local: '2026-11-14T07:30:00',
      venue: { name: 'Venue', address_text: UNBROKEN_EN.slice(0, 160) } }] },
  { name: '9-mixed-script', pack: REL.r1, lang: 'ta', title: 'Asha ৺ Bala — அஷா · बाला · 2026',
    style: { font: 'DM Sans', color: '#1a1a1a', alignment: 'right' },
    draft: { welcome: 'Tamil வணக்கம், English "goodwill", Devanagari नमस्ते, Tamil digits ௧௨௩ and Arabic 123.' },
    people: [{ display_name: 'கந்தசாமி / Kandasamy / कंदसामी', role_label: 'Father · தந்தை', group_label: 'Family குடும்बம்' }],
    events: [{ event_key: 'muhurtham', display_name: 'முஹூர்தம் / Muhurtham',
      starts_at_local: '2026-11-14T07:30:00', timezone: 'Asia/Kolkata',
      venue: { name: 'Kalyana Mantapa மண்டபம்', address_text: '100 Pillar Road, மதுரை' } }] },
  { name: '10-hostile-markup', pack: REL.r1, lang: 'en', title: '"><script>alert(1)</script>',
    hostile: true,
    style: { font: '<script>font</script>', fontSize: '3', color: 'not-a-colour', alignment: 'justify' },
    draft: { welcome: HOSTILE, closing: "Line one\nLine two\t<em>not markup</em>" },
    people: [{ display_name: '<b>Bold</b> Person', role_label: '<a href="javascript:alert(1)">link</a>',
      group_label: '<img src=x alt=group>' }],
    events: [{ event_key: 'muhurtham', display_name: '<svg onload=alert(4)>Ceremony</svg>',
      starts_at_local: '2026-11-14T07:30:00',
      venue: { name: 'javascript:alert(5) Venue', address_text: 'x">y', map_url: 'javascript:alert(6)' } }] },
];

const VIEWPORTS = [
  { width: 360, height: 740, dpr: 3, mobile: true },
  { width: 390, height: 844, dpr: 3, mobile: true },
  { width: 768, height: 1024, dpr: 2, mobile: false },
  { width: 1440, height: 900, dpr: 1, mobile: false },
];

const SHOT_SHAPES = new Set(['3-reviewed-tamil', '5-tamil-fallback', '6-host-override',
  '9-mixed-script', '10-hostile-markup']);

// --------------------------------------------------------------------------- building documents

async function createWedding(who, { title, lang, pack, style }) {
  const { data, error } = await clientFor(who).from('weddings')
    .insert({ owner_user_id: hosts[who].userId, title, primary_language: lang })
    .select('id').single();
  if (error) throw new Error(`could not create a wedding: ${error.message}`);
  // §27 measures font, size, alignment and contrast, and the renderer's clamp only has an
  // observable effect if a document actually carries a size — so the shapes that declare a style
  // have it written the way the editor writes it.
  if (style) {
    const s = await rest('PATCH', 'weddings', `?id=eq.${data.id}`, { style_settings: style }, { as: who });
    if (s.status !== 200 && s.status !== 204) throw new Error(`style write refused: ${JSON.stringify(s.body)}`);
  }
  if (pack) {
    const r = await rest('PATCH', 'weddings', `?id=eq.${data.id}`,
      { tradition_pack_release_id: pack }, { as: who, represent: true });
    if (r.status !== 200) throw new Error(`could not select the fixture release: ${JSON.stringify(r.body)}`);
  }
  return data.id;
}

async function writeContent(who, weddingId, shape) {
  if (shape.draft) {
    const r = await rest('PATCH', 'invitation_drafts', `?wedding_id=eq.${weddingId}`,
      { content: shape.draft }, { as: who, represent: true });
    if (r.status !== 200) throw new Error(`draft write refused: ${JSON.stringify(r.body)}`);
  }
  let venueId = null;
  for (const event of shape.events ?? []) {
    venueId = null;
    if (event.venue) {
      const first = await rest('POST', 'venues', '', { wedding_id: weddingId, ...event.venue },
        { as: who, represent: true });
      if (first.status === 201) {
        venueId = firstRow(first.body)?.id ?? null;
      } else if (shape.hostile) {
        // Shape 10 offers a `javascript:` map link. The store's own CHECK admits https only, so
        // the hostile link never becomes a row — which is the measurement, and is why the retry
        // drops that one field and keeps the venue.
        check('27', `${shape.name}: the store refuses a non-https venue map link`,
          first.status >= 400, JSON.stringify(first.body));
        const retry = await rest('POST', 'venues', '',
          { wedding_id: weddingId, ...event.venue, map_url: null }, { as: who, represent: true });
        if (retry.status !== 201) throw new Error(`venue write refused: ${JSON.stringify(retry.body)}`);
        venueId = firstRow(retry.body)?.id ?? null;
      } else {
        throw new Error(`venue write refused: ${JSON.stringify(first.body)}`);
      }
      if (venueId == null) throw new Error(`${shape.name}: a venue insert answered with no row id`);
    }
    const { venue: _venue, ...row } = event;
    const r = await rest('POST', 'wedding_events', '',
      { wedding_id: weddingId, ...row, venue_id: venueId }, { as: who, represent: true });
    if (r.status !== 201) throw new Error(`event write refused: ${JSON.stringify(r.body)}`);
  }
  for (const person of shape.people ?? []) {
    // `role_key` is NOT NULL in the schema and is a platform identifier the renderer never draws,
    // so a shape that names only the label gets the neutral key the editor would have written.
    const r = await rest('POST', 'wedding_people', '',
      { wedding_id: weddingId, role_key: 'guest', ...person }, { as: who, represent: true });
    if (r.status !== 201) throw new Error(`person write refused: ${JSON.stringify(r.body)}`);
  }
}

/** Freeze + publish a shape and hand back the version id, the credential, and the guest answer the
 *  link gives on the spot. */
async function build(who, shape) {
  const weddingId = await createWedding(who, shape);
  await writeContent(who, weddingId, shape);
  const frozen = await rpc(who, 'create_invitation_version', { p_wedding_id: weddingId });
  if (frozen.refused) throw new Error(`${shape.name}: freeze refused — ${frozen.explain}`);
  const versionId = frozen.body.version_id;
  const published = await rpc(who, 'publish_invitation_version', {
    p_wedding_id: weddingId, p_version_id: versionId, p_expires_at: null,
  });
  if (published.refused) throw new Error(`${shape.name}: publish refused — ${published.explain}`);
  const token = published.body.path.slice('/i/'.length);
  const guest = await resolveAs(token);
  return { weddingId, versionId, token, dto: guest.body, snapshot: frozen.body.snapshot };
}

// --------------------------------------------------------------------------- §21 CASE A and B

async function journeys() {
  console.log('\n==> §21 CASE A / CASE B — the frozen document, then the page a guest is given');
  const noPack = await build('hostA', SHAPES[1]);
  const withPack = await build('hostA', SHAPES[3]);

  // --- CASE A: a wedding that never selected a pack renders Stage 3's page, with nothing added.
  const a = noPack.dto.invitation;
  check('A', 'the no-pack document resolves', noPack.dto.available === true);
  check('A', 'no pack credit is present', a.tradition_pack === null,
    JSON.stringify(a.tradition_pack));
  measure('A', 'what a pack-less document carries as a section list',
    a.sections === null ? 'null' : `${a.sections.items.length} item(s): `
      + a.sections.items.map((s) => `${s.section_key}/${s.kind}/${s.body?.source ?? 'no body'}`).join(' '));
  const aItems = a.sections?.items ?? [];
  check('A', 'no section of a pack-less document claims reviewed pack wording',
    aItems.every((s) => s.body?.source !== 'reviewed_pack'));
  check('A', 'every body it does carry is a sentence the host wrote',
    aItems.filter((s) => s.body?.text != null)
      .every((s) => Object.values(SHAPES[1].draft).includes(s.body.text)),
    aItems.filter((s) => s.body?.text != null).map((s) => s.body.source).join(','));
  check('A', "the host's own four slots are the document",
    a.welcome === SHAPES[1].draft.welcome && a.closing === SHAPES[1].draft.closing);
  // The candidate's own marker, and the source word a host-less section would carry. Matched
  // against the *strings a guest is given*, not against the whole payload: an earlier draft of
  // this line searched the JSON for `pack_text` and hit the legitimate field name
  // `overrode_pack_text`, which is a key in the contract, not a sentence on the paper.
  const aWords = [a.welcome, a.familyIntroduction, a.eventNotes, a.closing,
    ...aItems.flatMap((s) => [s.heading?.text, s.body?.text])].filter((x) => typeof x === 'string');
  check('A', 'no placeholder ceremonial wording reaches the guest',
    aWords.every((word) => !word.includes('[placeholder]') && !word.includes('reviewed_pack')),
    aWords.filter((word) => word.includes('[placeholder]') || word.includes('reviewed_pack')).join(' | '));
  check('A', 'people and events carry what the host wrote',
    a.people.length === 3 && a.events.length === 1 && a.events[0].venue?.map_url === SHAPES[1].events[0].venue.map_url,
    JSON.stringify(a.events[0].venue));

  // --- CASE B: the TEST ONLY approved fixture release, through the same route.
  const b = withPack.dto.invitation;
  const items = b.sections.items;
  check('B', 'the synthetic approved release resolves', withPack.dto.available === true);
  check('B', 'the section order is the frozen release\'s own',
    items.map((s) => s.section_key).join(',') === 'opening,family,ceremonies',
    items.map((s) => s.section_key).join(','));
  check('B', 'the position written in the snapshot is what the list carries',
    items.map((s) => s.position).join(',') === '1,2,3');
  const untouched = items[0];
  check('B', 'a section the host left alone reads as reviewed_pack',
    untouched.body.source === 'reviewed_pack' && untouched.host_field === 'welcome',
    `${untouched.body.source}/${untouched.host_field}`);
  const overrideDoc = await build('hostA', SHAPES[5]);
  const overridden = overrideDoc.dto.invitation.sections.items[0];
  check('B', 'a section the host wrote reads as host',
    overridden.body.source === 'host'
    && overridden.body.text === SHAPES[5].draft.welcome
    && overridden.body.overrode_pack_text === true,
    `${overridden.body.source}/${overridden.body.overrode_pack_text}`);
  check('B', 'the fallback flag is false when both languages are present',
    untouched.heading.fallback_used === false && untouched.body.fallback_used === false);
  measure('B', 'the guest DTO\'s pack credit', JSON.stringify(b.tradition_pack));

  // What may NOT be in a guest's document, measured against the DTO *and* the rendered page below.
  const leaked = NEVER_PUBLIC.filter((s) => JSON.stringify(withPack.dto).includes(s));
  check('B', 'no reviewer, machine or internal key appears in the guest DTO',
    leaked.length === 0, leaked.join(', '));
  check('B', 'the pack credit is the three disclosed fields and nothing more',
    Object.keys(b.tradition_pack).sort().join(',') === 'display_name,pack_key,release_number',
    Object.keys(b.tradition_pack).join(','));

  return { noPack, withPack, overriddenDoc: overrideDoc };
}

// --------------------------------------------------------------------------- §22 R1 → R2

/** Mint one TEST ONLY approved release of the fixture pack, carrying its own English opening
 *  sentence, and walk it through the same birth → reviewed → approved steps the seed uses.
 *
 *  `supabase/tests/api/fixtures/stage4_mint_release.sql` mints a *fixed* sentence, and §22 needs
 *  two releases whose documents a reader can tell apart — "the guest sees the R2 document" is not
 *  observable if R1 and R2 say the same thing. So this instrument mints its own pair rather than
 *  editing a fixture the API battery depends on, and it leaves two more deprecated rows behind,
 *  which is the same disclosed residue class as FRZ-06's mint. */
function mintRelease(id, sentence, changelog) {
  const esc = (s) => s.replaceAll("'", "''");
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`refusing to mint on ${id}`);
  psqlRun(`
    insert into public.tradition_pack_releases
      (id, pack_id, release_number, definition_schema_version, languages, definition,
       author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
    select '${id}', r.pack_id,
           (select coalesce(max(x.release_number), 0) + 1
              from public.tradition_pack_releases x where x.pack_id = r.pack_id),
           1, r.languages,
           jsonb_set(r.definition, '{sections,0,pack_text,en}', to_jsonb('${esc(sentence)}'::text)),
           'TEST ONLY — minted by the Stage 4 render qualification', true,
           'TEST ONLY — copied from the Stage 4 HTTP fixture pack by a local qualification script '
           || 'and given one different English string. No human reader of Tamil reviewed any '
           || 'string in this release.',
           'TEST ONLY — scripts/stage4-render-qualification.mjs',
           '${esc(changelog)}'
      from public.tradition_pack_releases r where r.id = '${REL.r1}';
    update public.tradition_pack_releases
       set status = 'reviewed',
           review_label = 'TEST FIXTURE REVIEW — NOT A REAL CULTURAL REVIEW',
           review_basis = 'Automated Stage 4 render qualification only; no human qualification is '
                          || 'claimed by this record.',
           review_scope = 'Shape of the definition and the two declared languages. No ritual, '
                          || 'religious or community content was assessed.',
           reviewed_languages = array['en','ta'],
           reviewed_at = now()
     where id = '${id}';
    update public.tradition_pack_releases set status = 'approved', approved_at = now()
     where id = '${id}';
  `);
  const row = psqlRows(`select release_number::text || '|' || status from public.tradition_pack_releases
                         where id = '${id}'`)[0];
  if (!row?.endsWith('|approved')) throw new Error(`the mint did not reach approved: ${row}`);
  return Number(row.split('|')[0]);
}

async function deprecationJourney() {
  console.log('\n==> §22 — one release retired, the next one approved, the document in between');
  const numberA = mintRelease(MINT.a,
    'With the goodwill of both families, in the release that is about to be retired.',
    'Minted by the render qualification to be retired while a published document points at it');
  const shape = { ...SHAPES[3], title: 'Chitra weds Deepa', pack: MINT.a };
  const doc = await build('hostA', shape);
  const v1Id = doc.versionId;

  const v1Snapshot = psqlRows(`select snapshot::text from public.invitation_versions where id = '${v1Id}'`)[0];
  const v1Row = psqlRows(`select id || '|' || version_number || '|' || created_at::text
                            from public.invitation_versions where id = '${v1Id}'`)[0];
  const hashBefore = sha(v1Snapshot);
  const dtoBefore = JSON.stringify(doc.dto);
  measure('22', 'V1 snapshot bytes', `${v1Snapshot.length} B`);
  measure('22', 'V1 snapshot sha256', hashBefore);
  measure('22', 'V1 opening wording', doc.dto.invitation.sections.items[0].body.text);

  // C — a *new approved* release of the same pack must not move a wedding that is already pointing
  // at another one.
  const numberB = mintRelease(MINT.b,
    'With the goodwill of both families, in the release that replaces it.',
    'Minted by the render qualification to replace the retired one, by the host\'s own choice');
  const stillPoints = psqlRows(`select tradition_pack_release_id::text from public.weddings
                                  where id = '${doc.weddingId}'`)[0];
  check('22', 'C: approving a newer release did not move the wedding', stillPoints === MINT.a,
    `points at ${stillPoints}`);

  // Deprecate the release the document was frozen from. No HTTP route does this — that absence is
  // the design — so this one statement is trusted, exactly as it is in the HTTP battery.
  psqlRun(`update public.tradition_pack_releases set status = 'deprecated', deprecated_at = now()
            where id = '${MINT.a}' and status = 'approved'`);
  measure('22', 'retired release', `${MINT.a} (release ${numberA}) is now deprecated`);

  // A — the published document still resolves, byte for byte.
  const afterRetire = await resolveAs(doc.token);
  check('22', 'A: the guest link still resolves after the release was retired',
    afterRetire.status === 200 && afterRetire.body.available === true);
  check('22', 'A: and its answer is unchanged', JSON.stringify(afterRetire.body) === dtoBefore,
    `sha256 before ${sha(dtoBefore).slice(0, 12)}… after ${sha(JSON.stringify(afterRetire.body)).slice(0, 12)}…`);

  // B — a NEW freeze from a retired release is refused, while the retired release stays readable
  // to its own host.
  const refused = await rpc('hostA', 'create_invitation_version', { p_wedding_id: doc.weddingId });
  check('22', 'B: a new freeze from the retired release is refused at the freeze gate',
    refused.code === '42501'
    && /^a new invitation version may only be frozen from an approved tradition pack release \(this one is deprecated\)/
      .test(refused.message ?? ''),
    refused.explain);

  // D — the host chooses the newer release themselves, explicitly, and the next freeze works.
  const pointed = await rest('PATCH', 'weddings', `?id=eq.${doc.weddingId}`,
    { tradition_pack_release_id: MINT.b }, { as: 'hostA', represent: true });
  check('22', 'D: the host can select the newer approved release', pointed.status === 200,
    JSON.stringify(pointed.body));
  const v2 = await rpc('hostA', 'create_invitation_version', { p_wedding_id: doc.weddingId });
  check('22', 'D: and freezing from it succeeds', !v2.refused, v2.explain);
  const v2Id = v2.body.version_id;
  check('22', 'D: the new version names the release it froze from',
    v2.body.snapshot.tradition_pack_release.release_number === numberB,
    `release ${v2.body.snapshot.tradition_pack_release.release_number} vs minted ${numberB}`);
  // The positive control beside D: the *selection* gate still refuses the retired release, so what
  // moved was an approved row, not the retirement being ignored.
  const refusedSelect = await rest('PATCH', 'weddings', `?id=eq.${doc.weddingId}`,
    { tradition_pack_release_id: MINT.a }, { as: 'hostA' });
  check('22', 'D control: selecting the retired release is refused',
    refusedSelect.status === 403 && /^a wedding may only select an approved/.test(refusedSelect.body?.message ?? ''),
    `${refusedSelect.status} ${JSON.stringify(refusedSelect.body)}`);

  const republished = await rpc('hostA', 'publish_invitation_version', {
    p_wedding_id: doc.weddingId, p_version_id: v2Id, p_expires_at: null,
  });
  check('22', 'D: the same link is reused for the new version',
    !republished.refused && republished.body.link_reused === true,
    republished.explain ?? JSON.stringify(republished.body));

  // E — V1 is untouched by all of it.
  const v1SnapshotNow = psqlRows(`select snapshot::text from public.invitation_versions where id = '${v1Id}'`)[0];
  const v1RowNow = psqlRows(`select id || '|' || version_number || '|' || created_at::text
                               from public.invitation_versions where id = '${v1Id}'`)[0];
  check('22', 'E: the V1 snapshot is byte-for-byte unchanged', sha(v1SnapshotNow) === hashBefore,
    `${sha(v1SnapshotNow).slice(0, 16)}… vs ${hashBefore.slice(0, 16)}…`);
  check('22', 'E: and the V1 row itself is unchanged', v1RowNow === v1Row, v1RowNow);

  // F — the guest page now carries the document frozen from the newer release. The minted sentence
  // is the only difference between the two, which is why the two mints do not share their text.
  const afterRepublish = await resolveAs(doc.token);
  const credit = afterRepublish.body.invitation.tradition_pack;
  check('22', 'F: the guest sees the newer release', credit.release_number === numberB,
    JSON.stringify(credit));
  const openingText = afterRepublish.body.invitation.sections.items[0].body.text;
  check('22', 'F: with the wording the newer release carries',
    openingText === 'With the goodwill of both families, in the release that replaces it.',
    JSON.stringify(openingText));
  const changed = JSON.stringify(afterRepublish.body) !== dtoBefore;
  check('22', 'F: the document the guest is given did change when the host re-published', changed);

  return { doc, v2Id, token: doc.token, numberA, numberB };
}

// --------------------------------------------------------------------------- the browser

/** A minimal CDP client: enough to open an isolated context, set a viewport, navigate, evaluate,
 *  log the network and take a screenshot. Written here rather than installed because §31 of the
 *  directive keeps the dependency set as it is. */
async function openBrowser() {
  const userData = mkdtempSync(join(tmpdir(), 'stage4-chrome-'));
  const chrome = process.env.STAGE4_CHROME
    ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!existsSync(chrome)) throw new Error(`no Chromium at ${chrome}`);
  const child = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${CHROME_PORT}`, `--user-data-dir=${userData}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-timer-throttling',
  ], { stdio: 'ignore' });

  let version = null;
  for (let attempt = 0; attempt < 60 && !version; attempt += 1) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const res = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`);
      if (res.ok) version = await res.json();
    } catch {
      // not listening yet
    }
  }
  if (!version) throw new Error('Chromium did not open a DevTools endpoint');

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.addEventListener('open', ok); ws.addEventListener('error', err); });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== undefined) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (entry) entry.resolve(msg);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
      for (const fn of listeners.get('*') ?? []) fn(msg);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((ok, err) => {
    const id = nextId++;
    pending.set(id, { resolve: (msg) => (msg.error ? err(new Error(`${method}: ${msg.error.message}`)) : ok(msg.result)) });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); err(new Error(`${method} timed out`)); } }, 60_000);
  });
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };

  const context = await send('Target.createBrowserContext', { disposeOnDetach: true });
  const target = await send('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId });
  const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const session = attached.sessionId;
  const s = (method, params) => send(method, params, session);

  return {
    async close() {
      try { await send('Target.closeTarget', { targetId: target.targetId }); } catch { /* already gone */ }
      ws.close();
      child.kill();
      rmSync(userData, { recursive: true, force: true });
    },
    async viewport(v) {
      await s('Emulation.setDeviceMetricsOverride', {
        width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: v.mobile });
    },
    async goto(url) {
      await s('Page.enable');
      const r = await s('Page.navigate', { url });
      if (r.errorText) throw new Error(`navigation failed: ${r.errorText}`);
    },
    async waitFor(selector, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const { result } = await s('Runtime.evaluate', {
          expression: `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
          returnByValue: true,
        });
        if (result.value === true) return true;
        if (Date.now() > deadline) return false;
        await new Promise((r) => setTimeout(r, 120));
      }
    },
    async evaluate(expression) {
      const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) {
        throw new Error(`page evaluation threw: ${r.exceptionDetails.exception?.description
          ?? r.exceptionDetails.text}`);
      }
      return r.result.value;
    },
    async screenshot(path) {
      const r = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
      return r.data.length;
    },
    network: { on, s },
  };
}

/** Everything §27 asks to be measured, read out of the live page. Returned as plain JSON so the
 *  report is a table rather than a pile of console lines. */
const MEASURE = `(() => {
  const art = document.querySelector('article');
  if (!art) return { missing: true };
  const de = document.documentElement;
  const lum = (c) => {
    const m = c.match(/\\d+(\\.\\d+)?/g);
    if (!m) return null;
    const [r, g, b] = m.slice(0, 3).map(Number);
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bg = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const c = getComputedStyle(node).backgroundColor;
      if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return c;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)';
  };
  const ratio = (fg, back) => {
    const a = lum(fg), b = lum(back);
    if (a === null || b === null) return null;
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const px = (v) => Number.parseFloat(v);
  const h1 = art.querySelector('h1');
  const p = art.querySelector('p');
  const interactive = [...art.querySelectorAll('a,button')].map((el) => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName, href: el.getAttribute('href'), target: el.getAttribute('target'),
      rel: el.getAttribute('rel'), width: Math.round(r.width), height: Math.round(r.height) };
  });
  // Counted before the focus probe below: §27 asks whether the drawn document moves, and the
  // instrument's own focus() call must not become the thing it reports on.
  const anims = document.getAnimations().map((a) => {
    const t = a.effect ? a.effect.target : null;
    const name = a.animationName || (a.transitionProperty ? 'transition:' + a.transitionProperty : 'unnamed');
    return { name, tag: t ? t.tagName : '(detached)', insideArticle: t ? art.contains(t) : false };
  });
  let focus = null;
  const focusable = art.querySelector('a,button');
  if (focusable) {
    focusable.focus();
    const cs = getComputedStyle(focusable);
    focus = { active: document.activeElement === focusable,
      outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle, outlineColor: cs.outlineColor,
      boxShadow: cs.boxShadow.slice(0, 120) };
  }
  const clipped = [...art.querySelectorAll('*')].filter((el) => {
    const s = getComputedStyle(el);
    return s.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1;
  }).slice(0, 4).map((el) => el.tagName + '.' + (el.className || '').toString().slice(0, 28)
    + ' ' + el.scrollWidth + '>' + el.clientWidth);
  const inject = art.querySelectorAll('img,script,svg,iframe,object,embed,style,link[rel=stylesheet]');
  return {
    viewport: [de.clientWidth, de.clientHeight],
    documentScrollWidth: de.scrollWidth,
    horizontalOverflowPx: de.scrollWidth - de.clientWidth,
    articleWidth: Math.round(art.getBoundingClientRect().width),
    articleRight: Math.round(art.getBoundingClientRect().right),
    headings: [...art.querySelectorAll('h1,h2,h3,h4')].map((h) => h.tagName + '|' + h.textContent.trim().slice(0, 32)),
    lang: art.getAttribute('lang'),
    fontStack: getComputedStyle(art).fontFamily,
    leadPx: px(getComputedStyle(art).fontSize),
    h1Px: h1 ? px(getComputedStyle(h1).fontSize) : null,
    pPx: p ? px(getComputedStyle(p).fontSize) : null,
    align: getComputedStyle(art).textAlign,
    articleColor: getComputedStyle(art).color,
    contrastH1: h1 ? Number(ratio(getComputedStyle(h1).color, bg(h1))?.toFixed(2)) : null,
    contrastBody: p ? Number(ratio(getComputedStyle(p).color, bg(p))?.toFixed(2)) : null,
    interactive,
    focus,
    clipped,
    animations: anims.filter((a) => a.insideArticle).length,
    animationDetail: anims.map((a) => (a.insideArticle ? 'inside ' : 'outside ')
      + a.name + ' on ' + a.tag),
    injectedElements: inject.length,
    innerTextLength: art.innerText.length,
    innerText: art.innerText,
  };
})()`;

const FONT_PROBE = `(async () => {
  const art = document.querySelector('article');
  const drawn = art ? art.innerText : '';
  const tamilRun = (drawn.match(/[\\u0B80-\\u0BFF]+/g) || []).join('');
  const teluguRun = (drawn.match(/[\\u0C00-\\u0C7F]+/g) || []).join('');
  // Ask for the faces this page's own text needs and wait for them. Reading document.fonts before
  // the subset files land is what made the first sweep order-dependent: the same probe
  // answered false on the first Tamil page it visited and true on the last.
  await document.fonts.load('16px "Noto Sans Tamil"', tamilRun + teluguRun);
  await document.fonts.load('16px "Noto Sans Telugu"', teluguRun);
  await document.fonts.ready;
  const faces = [...document.fonts];
  const byStatus = {};
  for (const f of faces) byStatus[f.status] = (byStatus[f.status] || 0) + 1;
  const loadedFor = (re) => faces.filter((f) => re.test(f.family) && f.status === 'loaded').length;
  // Per code point, because a boolean over a whole run only says "something in here is missing"
  // and names nothing. Google serves these families as unicode-range subsets, so the honest
  // question is whether every character the page drew has a loaded face in that family.
  const unique = [...new Set(tamilRun)];
  return {
    total: faces.length,
    byStatus,
    tamilFacesLoaded: loadedFor(/Tamil/),
    teluguFacesLoaded: loadedFor(/Telugu/),
    tamilRunChars: tamilRun.length,
    tamilUniqueChars: unique.length,
    tamilCodePointsWithoutFace: unique
      .filter((ch) => !document.fonts.check('16px "Noto Sans Tamil"', ch))
      .map((ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')),
    familyOnArticle: getComputedStyle(art).fontFamily.slice(0, 60),
  };
})()`;

// --------------------------------------------------------------------------- the matrix

async function matrix(browser, docs) {
  console.log('\n==> §27 — ten shapes × four viewports, measured in the page');
  console.log('  shape                      viewport  overflow  clip  article  h1px  bodypx align  contrast(h1/body) animA targets  injected keys/provenance');
  const summary = [];
  for (const shape of SHAPES) {
    const doc = docs[shape.name];
    if (!doc) throw new Error(`no document was built for shape ${shape.name}`);
    for (const v of VIEWPORTS) {
      await browser.viewport(v);
      await browser.goto(`${PREVIEW_ORIGIN}/i/${doc.token}`);
      const ready = await browser.waitFor('article');
      if (!ready) {
        check('27', `${shape.name} @ ${v.width}x${v.height}`, false,
          'the article never appeared — the page answered unavailable or threw');
        continue;
      }
      const m = await browser.evaluate(MEASURE);
      const keysFound = inText(m.innerText);
      const unsafe = m.interactive.filter((a) => a.href !== null
        && !/^https?:/i.test(a.href) && !a.href.startsWith('#'));
      const small = m.interactive.filter((a) => a.width < 24 || a.height < 24);
      summary.push({ shape: shape.name, viewport: `${v.width}x${v.height}@${v.dpr}`, ...m, keysFound, unsafe, small });
      console.log(
        `  ${shape.name.padEnd(26)} ${(v.width + 'x' + v.height).padEnd(9)}`
        + ` ${String(m.horizontalOverflowPx + 'px').padEnd(9)} ${String(m.clipped.length).padEnd(5)}`
        + ` ${String(m.articleWidth + 'px').padEnd(8)} ${String(m.h1Px).padEnd(5)} ${String(m.pPx).padEnd(7)}`
        + ` ${String(m.align).padEnd(6)} ${(m.contrastH1 + '/' + m.contrastBody).padEnd(17)}`
        + ` ${String(m.animations).padEnd(5)} ${String(m.interactive.length + '/' + small.length + 'small').padEnd(10)}`
        + ` ${String(m.injectedElements).padEnd(8)} ${keysFound.length === 0 ? 'none' : keysFound.join(',')}`,
      );
    }
    // The per-shape findings, asserted once per shape rather than once per viewport, so a real
    // problem is reported four times as a shape fact and not as sixteen viewport facts.
    const rows = summary.filter((r) => r.shape === shape.name);
    check('27', `${shape.name}: no horizontal overflow at any viewport`,
      rows.every((r) => r.horizontalOverflowPx === 0),
      rows.map((r) => `${r.viewport}:${r.horizontalOverflowPx}px`).join(' '));
    check('27', `${shape.name}: no clipped element inside the article`,
      rows.every((r) => r.clipped.length === 0), JSON.stringify(rows.find((r) => r.clipped.length)?.clipped ?? []));
    check('27', `${shape.name}: nothing a host wrote became an element`,
      rows.every((r) => r.injectedElements === 0));
    check('27', `${shape.name}: no internal key or provenance string in the page text`,
      rows.every((r) => r.keysFound.length === 0));
    check('27', `${shape.name}: no unsafe link scheme reaches the page`,
      rows.every((r) => r.unsafe.length === 0), JSON.stringify(rows[0]?.unsafe ?? []));
    check('27', `${shape.name}: the article is labelled with the frozen language`,
      rows.every((r) => r.lang !== null), rows[0]?.lang);
    // Scope matters here: the route's own "Loading…" line runs a transition before the article
    // exists, and the first sweep counted `document.getAnimations()`, so the instrument reported
    // the page shell as if it were the invitation. The two are separated and both are disclosed.
    check('27', `${shape.name}: the document itself runs no animation`,
      rows.every((r) => r.animations === 0),
      JSON.stringify([...new Set(rows.flatMap((r) => r.animationDetail))]));

    // A saved style is a *request*. The projection whitelists it and the renderer clamps it, and
    // §27 asks what the page was actually drawn with — so each out-of-range value these shapes
    // carry is asserted to have been clamped or refused rather than obeyed. Shape 1 carries no
    // style at all, which makes it the control the refused values are compared against.
    const base = summary.find((r) => r.shape === '1-no-pack-minimal');
    const seen = (key) => [...new Set(rows.map((r) => r[key]))].join('/');
    if (shape.style?.fontSize != null) {
      const wanted = Number(shape.style.fontSize);
      const expected = Math.min(44, Math.max(22, wanted));
      check('27', `${shape.name}: the saved ${wanted}px lead is drawn at the clamped ${expected}px`,
        rows.every((r) => r.leadPx === expected), `measured ${seen('leadPx')}px`);
    } else if (base) {
      check('27', `${shape.name}: a document that never chose a size is drawn readable, not at 16px`,
        rows.every((r) => r.leadPx === 26), `measured ${seen('leadPx')}px`);
    }
    if (shape.style?.alignment != null) {
      const known = ['left', 'center', 'right'].includes(shape.style.alignment);
      check('27', known
        ? `${shape.name}: the saved alignment is the one applied`
        : `${shape.name}: an alignment outside the vocabulary is not applied`,
        rows.every((r) => r.align === (known ? shape.style.alignment : 'center')), seen('align'));
    }
    if (shape.style?.color != null) {
      const valid = /^#[0-9a-fA-F]{6}$/.test(shape.style.color);
      const expected = valid ? 'not the default' : base?.articleColor;
      check('27', valid
        ? `${shape.name}: the saved colour is the one the paper carries`
        : `${shape.name}: a saved value that is not a colour is not applied`,
        valid
          ? rows.every((r) => r.articleColor !== base?.articleColor)
          : rows.every((r) => r.articleColor === expected),
        `${shape.style.color} → ${seen('articleColor')}`);
      if (valid) measure('27', `${shape.name}: contrast of the frozen colour on the paper`,
        `h1 ${seen('contrastH1')} · body ${seen('contrastBody')} (ratio, reported not asserted)`);
    }
    if (shape.style?.font != null) {
      const known = /^[A-Za-z ]{1,40}$/.test(shape.style.font);
      check('27', known
        ? `${shape.name}: the saved font leads the stack`
        : `${shape.name}: a saved value that is not a font name is not applied`,
        known
          ? rows.every((r) => r.fontStack.startsWith(`"${shape.style.font}"`))
          : rows.every((r) => r.fontStack === base?.fontStack),
        seen('fontStack').slice(0, 90));
    }
    // The face probe runs while a document that actually needs the script is on screen, after
    // waiting for the faces that text selects. Measuring at the end of the sweep instead made the
    // answer depend on which page happened to be loaded — Stage 3 recorded the same class of
    // false finding from a font probe that asked the wrong document.
    if (/tamil|mixed/.test(shape.name)) {
      const f = await browser.evaluate(FONT_PROBE);
      measure('27', `${shape.name}: the faces this document's script needs`,
        `${f.total} declared · status ${JSON.stringify(f.byStatus)}`
        + ` · Tamil subset files loaded=${f.tamilFacesLoaded} · Telugu=${f.teluguFacesLoaded}`
        + ` · family on the article=${f.familyOnArticle}`);
      if (f.tamilRunChars > 0) {
        check('27', `${shape.name}: every Tamil code point the page drew has a loaded Tamil face`,
          f.tamilCodePointsWithoutFace.length === 0 && f.tamilFacesLoaded > 0,
          `${f.tamilRunChars} Tamil chars · ${f.tamilUniqueChars} distinct ·`
          + ` loaded Tamil faces=${f.tamilFacesLoaded}`
          + ` · without a face=${f.tamilCodePointsWithoutFace.join(',') || 'none'}`);
      }
    }
    if (SHOT_SHAPES.has(shape.name)) {
      screenshotDir ??= join(mkdtempSync(join(tmpdir(), 'stage4-render-')), 'shots');
      mkdirSync(screenshotDir, { recursive: true });
      const path = join(screenshotDir, `${shape.name}-390x844.png`);
      await browser.viewport(VIEWPORTS[1]);
      await browser.goto(`${PREVIEW_ORIGIN}/i/${doc.token}`);
      await browser.waitFor('article');
      const base64Bytes = await browser.screenshot(path);
      measure('27', `screenshot ${shape.name}`, `${path} (${Math.round(base64Bytes * 0.75)} bytes)`);
    }
  }
  const withLink = summary.find((r) => r.interactive.length > 0 && r.focus);
  measure('27', 'focus indicator on the one interactive element the sweep found',
    withLink ? `${withLink.shape} @ ${withLink.viewport}: ${JSON.stringify(withLink.focus)}`
      : 'no shape in the sweep drew a link or button');
  measure('27', 'shapes whose article carries no interactive element',
    summary.filter((r) => r.interactive.length === 0).map((r) => `${r.shape}@${r.viewport}`).join(' '));
  return summary;
}

// --------------------------------------------------------------------------- §26 network

const originOf = (value) => {
  const u = new URL(value);
  return `${u.protocol}//${u.host}`;
};

async function network(browser, doc) {
  console.log('\n==> §26 — every destination the production bundle reaches');
  const requests = [];
  browser.network.on('Network.requestWillBeSent', (p) => {
    requests.push({ url: p.request.url, method: p.request.method, type: p.request.resourceType,
      headers: p.request.headers ?? {}, initiator: p.initiator?.type });
  });
  const failures = [];
  browser.network.on('Network.loadingFailed', (p) => failures.push({ id: p.requestId, text: p.errorText, blocked: p.blockedReason }));
  const responses = [];
  browser.network.on('Network.responseReceived', (p) => {
    responses.push({ url: p.response.url, status: p.response.status });
  });
  await browser.network.s('Network.enable', {});
  await browser.viewport(VIEWPORTS[0]);
  await browser.goto(`${PREVIEW_ORIGIN}/i/${doc.token}`);
  const ready = await browser.waitFor('article');
  await new Promise((r) => setTimeout(r, 2_500));
  check('26', 'the guest page rendered from the production bundle', ready);

  // Comparing hostnames alone would call the preview server an API call: both listen on
  // 127.0.0.1 and differ only by port, and the claims below turn on which of the two was reached.
  const apiOrigin = originOf(browserApiUrl);
  const previewOrigin = originOf(PREVIEW_ORIGIN);
  const buckets = new Map();
  for (const r of requests) {
    const label = originOf(r.url);
    buckets.set(label, (buckets.get(label) ?? 0) + 1);
  }
  for (const [label, count] of [...buckets].sort()) {
    const kind = label === apiOrigin ? 'LOCAL API (this repository\'s own stack)'
      : label === previewOrigin ? 'LOCAL PREVIEW (the production bundle)'
        : /fonts\.(googleapis|gstatic)\.com$/.test(new URL(label).hostname)
          ? 'THIRD-PARTY FONT CDN (declared in index.html)'
          : 'UNCLASSIFIED';
    measure('26', `${label} — ${count} request(s)`, kind);
  }
  const hosted = requests.filter((r) => !LOOPBACK.has(new URL(r.url).hostname)
    && !/fonts\.(googleapis|gstatic)\.com$/.test(new URL(r.url).hostname));
  check('26', 'no request left this machine except the declared font CDN', hosted.length === 0,
    hosted.map((r) => r.url).join(', '));
  check('26', 'zero hosted-Supabase requests',
    !requests.some((r) => /\.supabase\.(co|in|api)\b/.test(new URL(r.url).hostname)));

  const apiRequests = requests.filter((r) => originOf(r.url) === apiOrigin);
  // A CORS preflight is an OPTIONS to the same path the POST goes to. Counting it as a second
  // resolver call would be a false finding, and ignoring it entirely would hide that the guest
  // page is cross-origin to its own API — so it is measured, and then set aside from the counts.
  const preflights = apiRequests.filter((r) => r.method === 'OPTIONS');
  measure('26', 'CORS preflights to the local API', `${preflights.length}`);
  const apiCalls = apiRequests.filter((r) => r.method !== 'OPTIONS');
  const withToken = apiCalls.filter((r) => r.url.includes(doc.token));
  check('26', 'the credential appears in no API request URL', withToken.length === 0,
    withToken.map((r) => r.url).join(', '));
  // The guest address *is* the credential — /i/<token> is what a host pastes into a chat — so it
  // necessarily sits in the browser address and in the navigation request to the preview server.
  // Stage 3 disclosed that as a residual; reporting "no credential in any URL" would hide it.
  const inPreview = requests.filter((r) => originOf(r.url) === previewOrigin
    && r.url.includes(doc.token));
  measure('26', 'disclosed Stage 3 residual — the credential is in the page address, not the API call',
    `${inPreview.length} navigation request(s) to ${previewOrigin} carry it in the path `
    + `${mask(`/i/${doc.token}`)}; ${apiCalls.length} API request(s) do not`);
  const resolver = apiCalls.filter((r) => new URL(r.url).pathname.endsWith('/rpc/resolve_public_invitation'));
  check('26', 'exactly one resolver call was made', resolver.length === 1,
    `saw ${resolver.length}`);
  measure('26', 'resolver request URL', resolver[0]?.url ?? '(none)');
  measure('26', 'resolver headers observable in the log', JSON.stringify(
    Object.keys(resolver[0]?.headers ?? {}).map((k) => k.toLowerCase()).sort()));
  const headerSent = Object.keys(resolver[0]?.headers ?? {})
    .some((k) => k.toLowerCase() === 'x-invitation-token');
  check('26', 'the credential travelled in the x-invitation-token header', headerSent);
  const otherPaths = apiCalls.filter((r) => !r.url.includes('/rpc/resolve_public_invitation'));
  measure('26', 'other API paths the guest page touched',
    otherPaths.length === 0 ? 'none' : [...new Set(otherPaths.map((r) => new URL(r.url).pathname))].join(', '));
  check('26', 'no maintenance or admin endpoint was reached from the browser',
    otherPaths.every((r) => !/admin|service|publish|revoke|rotate|create_invitation|patch/.test(r.url)),
    [...new Set(otherPaths.map((r) => new URL(r.url).pathname))].join(', '));
  if (failures.length) measure('26', 'requests the browser reported as failed', JSON.stringify(failures));
  return { requestCount: requests.length, buckets: Object.fromEntries(buckets), failures };
}

// --------------------------------------------------------------------------- §21 DOM half

async function domHalf(browser, docs, journey) {
  console.log('\n==> §21 — the same two documents, drawn by the shipped bundle');
  for (const [label, doc] of [['A (no pack)', docs['2-no-pack-full']], ['B (synthetic approved pack)', journey.overriddenDoc]]) {
    await browser.viewport(VIEWPORTS[3]);
    await browser.goto(`${PREVIEW_ORIGIN}/i/${doc.token}`);
    const ready = await browser.waitFor('article');
    check('21', `case ${label} renders an article`, ready);
    const m = await browser.evaluate(MEASURE);
    const keys = inText(m.innerText);
    check('21', `case ${label}: no internal key or provenance string is drawn`,
      keys.length === 0, keys.join(', '));
    measure('21', `case ${label} heading order`, m.headings.join(' / '));
    measure('21', `case ${label} text length`, `${m.innerTextLength} chars`);
    if (label.startsWith('A')) {
      check('21', 'case A draws the host\'s own words and nothing else',
        m.innerText.includes('With love from the Kandasamy family.')
        && !/\[placeholder\]|reviewed_pack|Rev\. /.test(m.innerText));
    } else {
      check('21', 'case B draws the host\'s override where they wrote one',
        m.innerText.includes('Written by the family, in their own words.'));
      check('21', 'case B draws the release\'s heading labels in the frozen order',
        m.headings.some((h) => h.includes('Opening'))
        && m.innerText.indexOf('Opening') < m.innerText.indexOf('Our families')
        && m.innerText.indexOf('Our families') < m.innerText.indexOf('The ceremonies'));
      check('21', 'case B prints no reviewer label, release number or machine note',
        !/release|rev\.|fixture|machine|review/i.test(m.innerText), m.innerText.slice(0, 0));
    }
  }
}

// --------------------------------------------------------------------------- teardown

function teardown() {
  const ownerIds = `(select w.id from public.weddings w join auth.users u on u.id = w.owner_user_id
                      where u.email like '%+${RUN_TAG}@example.test')`;
  psqlRun(`
    delete from private.access_tokens where wedding_id in ${ownerIds};
    delete from public.publications where wedding_id in ${ownerIds};
    delete from public.invitation_versions where wedding_id in ${ownerIds};
    delete from public.weddings where id in ${ownerIds};
  `);
  // §22 mints two releases so the retirement journey is real. The governance guard refuses to
  // delete a release that has left draft — "retired by status, never removed" — so the honest
  // cleanup is the retirement the schema prescribes, and the two rows stay visible as the
  // disclosed residue class already recorded for FRZ-06's mint.
  const retired = psqlRows(`
    update public.tradition_pack_releases
       set status = 'deprecated', deprecated_at = now()
     where id in ('${MINT.a}', '${MINT.b}') and status = 'approved'
    returning release_number::text || '=' || status;
  `);
  console.log(`  cleanup: minted releases retired rather than deleted — `
    + `${retired.length ? retired.join(' ') : 'none still approved'}`
    + `; both TEST ONLY rows remain in the local catalogue by design`);
}

async function removeAccounts() {
  const svc = createClient(apiUrl, serviceKey, { auth: { persistSession: false } });
  for (const who of Object.keys(hosts)) {
    const { error } = await svc.auth.admin.deleteUser(hosts[who].userId);
    if (error) console.log(`  !! teardown could not remove ${who}: ${error.message}`);
  }
}

/** This run's own footprint, counted while its accounts still exist — derived from the run tag, so
 *  a non-zero number here names this instrument and no one else. `weddings` is keyed by its own id;
 *  the child tables name the wedding. */
const OWNED = [
  ['weddings', 'id'],
  ['invitation_versions', 'wedding_id'],
  ['publications', 'wedding_id'],
  ['invitation_drafts', 'wedding_id'],
];

function ownedRows() {
  const owners = `(select w.id from public.weddings w join auth.users u on u.id = w.owner_user_id
                    where u.email like '%+${RUN_TAG}@example.test')`;
  return OWNED.map(([t, key]) => `${t}=${psqlRows(
    `select count(*)::text from public.${t} where ${key} in ${owners}`)[0]}`).join(' ');
}

/** Whole-table totals after cleanup. These tables also hold the SQL batteries' fixture rows, so the
 *  totals are only meaningful next to the owned counts printed before teardown. */
function residue() {
  return OWNED.map(([t]) => `${t}=${psqlRows(`select count(*)::text from public.${t}`)[0]}`).join(' ');
}

// --------------------------------------------------------------------------- main

async function main() {
  console.log(`Stage 4 render qualification · run tag ${RUN_TAG}`);
  const preview = await fetch(`${PREVIEW_ORIGIN}/`).catch(() => null);
  if (!preview?.ok) {
    throw new Error(`no production bundle at ${PREVIEW_ORIGIN}. Run \`npm run build\` then `
      + '`npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`.');
  }
  const bundleText = bundleSources();
  const hostedUrl = readFileSync(resolve(ROOT, '.env'), 'utf8')
    .match(/^VITE_SUPABASE_URL\s*=\s*"?(.+?)"?\s*$/m)?.[1];
  check('prelude', 'the built bundle calls the loopback API target',
    bundleText.includes(browserApiUrl), 'the URL baked into dist/ is the one .env.local declares');
  if (hostedUrl) {
    check('prelude', 'the hosted target .env declares is absent from the built bundle',
      !bundleText.includes(hostedUrl), 'the hosted value is not printed here');
  }

  psqlFile('supabase/tests/api/fixtures/stage4_http_pack.sql');
  hosts.hostA = await signUp('s4r-host-a');

  // In a `finally`, and not only when the browser half runs: a build that throws halfway through
  // the ten shapes would otherwise leave its rows and its account behind, which is exactly the
  // residue §31 asks this stage not to create.
  try {
    const docs = {};
    for (const shape of SHAPES) docs[shape.name] = await build('hostA', shape);
    const cases = await journeys();
    await deprecationJourney();

    const browser = await openBrowser();
    try {
      await domHalf(browser, docs, cases);
      await network(browser, docs['3-reviewed-tamil']);
      if (!SKIP_MATRIX) await matrix(browser, docs);
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    console.log(`\n==> rows this run owned: ${ownedRows()}`);
    teardown();
    await removeAccounts();
  }

  console.log(`==> table totals after cleanup (these tables also hold the SQL batteries' fixtures): ${residue()}`);
  console.log('==> fixture catalogue left in the local stack:');
  for (const line of psqlRows(`select '    ' || p.pack_key || ' release ' || r.release_number
    || ' is ' || r.status from public.tradition_pack_releases r
    join public.tradition_packs p on p.id = r.pack_id
    where p.pack_key like 'stage4_http_%' order by p.pack_key, r.release_number`)) console.log(line);
  console.log(`\n==> checks: ${results.filter((r) => !r.measured).length}, `
    + `measurements: ${results.filter((r) => r.measured).length}, findings: ${failureCount}`);
  if (failureCount > 0) {
    console.log('FINDINGS:');
    for (const r of results.filter((x) => !x.ok)) console.log(`  - [${r.area}] ${r.name}: ${r.detail}`);
    process.exitCode = 1;
  } else {
    console.log('STAGE 4 RENDER QUALIFICATION: PASS');
  }
}

await main();
