// Stage 4 §17 — the tradition-pack catalogue, selection, freeze and provenance boundary,
// qualified over HTTP.
//
// `supabase/tests/stage4/50_pack_release.sql` proves the same properties with `SET ROLE` inside
// psql, and it does that better than this file can: a trigger's ERRCODE, a guard's refusal of an
// illegal status step and a policy's exact row set are all facts about the catalogue, and the SQL
// battery walks them state by state. What that battery cannot see is the transport. It never had
// Kong turning an API key into a role, never had PostgREST choosing which columns a request may
// name, never had a JWT carrying `auth.uid()` into a governance trigger, and never had a browser
// client that could spell a UUID it was never told about. This file is those halves, and §17 asks
// for them by name: 40 numbered cases, each a refusal with a valid positive control beside it.
//
// Where a case cannot be reached over HTTP, that is reported here rather than quietly dropped:
//
//   * 19/20 (a draft or reviewed release cannot be frozen). A freeze is only ever about the
//     release the wedding *currently selects*, and 11/12 refuse that selection, so no HTTP caller
//     can ever be holding one. Measured as far as the transport allows — the selection refusal, and
//     the refusal of a direct write to `invitation_versions` — with the trigger's own behaviour
//     belonging to `50_pack_release.sql` group B.
//   * 29 (an unknown *required* section prevents a freeze). An unknown section kind cannot enter a
//     definition: the guard trigger validates `kind` on every write, and the freeze checker that
//     would refuse it reads the same three-kind vocabulary as that trigger — so the two can never
//     disagree, and the only way to a snapshot holding an unknown kind is to rewrite a frozen
//     snapshot behind the API's back. 30 measures that half by doing exactly that, on both arms of
//     §12's split (an unknown required kind refuses the guest document, an unknown optional one is
//     drawn inert), and the freeze-time arm of the same list is `invitation_freeze_issues`,
//     qualified in `50_pack_release.sql`.
//   * 16 (the error copy a UI shows stays app-authored). The app half is
//     `src/test/traditionReleases.test.ts`, which asserts the returned phrase is one this repo
//     chose. What is checkable *from here* is that the server's sentence leaks nothing, which
//     `SEL-06` measures.
//
// Not part of `npm test`; run it with `bash supabase/tests/api/run.sh`, which checks the stack is
// this repository's own before this file is loaded.
//
// Error codes and messages below are measured against this stack (PostgREST v16.3, Kong 2.8.1,
// GoTrue v2.197.0, PostgreSQL 17.6) with a throwaway probe, not guessed:
//   table grant refusal, anon ........ HTTP 401, code 42501, hint = the missing GRANT
//   table grant refusal, customer .... HTTP 403, code 42501, hint = the missing GRANT
//   column grant miss ................ "permission denied for table", not "for column"
//   function grant refusal ........... 42501, hint null
//   governance trigger refusal ....... its own ERRCODE, hint null
//   schema not exposed ............... PGRST106
//   table not in a profile ........... PGRST205
//   wrong arity/signature ............ PGRST202
//   an update RLS did not match ...... HTTP 204 with `Prefer: return=minimal`, an empty array
//                                     with `Prefer: return=representation`, and no error either way
//
// The fixture rows this file reads are committed on purpose, and they are all TEST ONLY.
// `supabase/tests/api/fixtures/stage4_http_pack.sql` explains why a rollback-based fixture cannot
// serve a running PostgREST; §31 of the directive asks for the residue to be measured, so LEDGER-01
// prints the whole catalogue of that pack family at the end of every run, including the one release
// `stage4_mint_release.sql` adds each time the deprecation journey runs.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

const RUN_TAG = process.env.STAGE4_HTTP_RUN_TAG
  ?? `stage4http-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// The tag is interpolated into trusted cleanup statements below, so an inherited value is only
// accepted if it is the shape this file generates.
if (!/^[a-z0-9-]+$/.test(RUN_TAG)) {
  throw new Error(`refusing to run: STAGE4_HTTP_RUN_TAG=${RUN_TAG} is not a run tag`);
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
const url = env.SUPABASE_LOCAL_URL;
const anonKey = env.SUPABASE_LOCAL_PUBLISHABLE_KEY;
const serviceKey = env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
if (!url) throw new Error('SUPABASE_LOCAL_URL is missing from .env.local');
if (!LOOPBACK.has(new URL(url).hostname)) {
  throw new Error(`refusing to run: ${url} is not a loopback Supabase target`);
}
if (!anonKey || !serviceKey) throw new Error('local keys are missing from .env.local');

const PROJECT_ID = (() => {
  const toml = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');
  const m = /^project_id\s*=\s*"?([^"\n]+?)"?\s*$/m.exec(toml);
  if (!m) throw new Error('no project_id in supabase/config.toml');
  return m[1].trim();
})();
// §17's "assert project_id is localvivaahvarnam". Named rather than derived: every other stage's
// suite is content to accept whatever config.toml says, and this suite's fixture writes rows into
// a *persistent* local database, so the one place where a mis-named project would be caught by a
// string rather than by a port number is here.
if (PROJECT_ID !== 'localvivaahvarnam') {
  throw new Error(`refusing to run: project_id is ${PROJECT_ID}, and this suite only writes to localvivaahvarnam`);
}
const DB_CONTAINER = process.env.STAGE3_DB_CONTAINER ?? `supabase_db_${PROJECT_ID}`;
if (!/^[A-Za-z0-9_.-]+$/.test(DB_CONTAINER)) {
  throw new Error(`refusing to run: STAGE3_DB_CONTAINER=${DB_CONTAINER} is not a container name`);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}-${RUN_TAG}`;

/** A trusted read/write against *this project's own* container — no network, and every statement
 *  below is scoped to a run tag, a validated uuid, or both. */
function sqlRows(query) {
  const out = execFileSync('docker', ['exec', '-i', DB_CONTAINER,
    'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', query],
  { encoding: 'utf8' });
  return out.split(/\r?\n/).filter((line) => line.length > 0);
}

function trustedSql(statement) {
  execFileSync('docker', ['exec', '-i', DB_CONTAINER,
    'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement],
  { stdio: ['ignore', 'inherit', 'inherit'] });
}

/** A trusted statement that is expected to be refused, and whose refusal text is the measurement.
 *  Kept apart from `trustedSql` rather than wrapped in a try/catch at each call site because a
 *  statement that *succeeded* has to fail the test in a way that says so: returning the error
 *  text, or null, makes "the gate fired" and "the row moved" two different observable outcomes.
 *  The statement is still passed as one argv element to `docker exec`, so nothing here is a shell. */
function trustedRefusal(statement) {
  try {
    execFileSync('docker', ['exec', '-i', DB_CONTAINER,
      'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    return null;
  } catch (err) {
    return `${err.stdout ?? ''}${err.stderr ?? ''}`.replace(/\r/g, '').trim();
  }
}

/** One of this suite's fixture files, applied through the same trusted route. Returns the lines
 *  the file printed, so a setup step is read rather than assumed. `\r` is stripped at the boundary
 *  for the reason `supabase/tests/stage4/run.sh` records: a Windows checkout can hand back CRLF and
 *  psql keeps those bytes inside dollar-quoted literals. */
function trustedFile(rel, vars = {}) {
  const bytes = readFileSync(resolve(ROOT, rel)).toString('utf8').replace(/\r/g, '');
  const args = ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-tA', '-F', '|'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  args.push('-f', '-');
  const out = execFileSync('docker', args, { input: bytes, encoding: 'utf8' });
  return out.split(/\r?\n/).filter((line) => line.startsWith('FIXTURE-')
    || (vars.rid !== undefined && line.includes(' | ')));
}

const hosts = {};
const client = (who) => hosts[who].client;
const api = (who) => hosts[who].client.schema('api');
const anonApi = () => createClient(url, anonKey, { auth: { persistSession: false } }).schema('api');

async function signUp(who) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: emailFor(who), password: PASSWORD });
  assert.equal(error, null, `signup failed for ${who}`);
  assert.ok(data.session, 'expected a session immediately');
  return { client: c, userId: data.user.id };
}

/** A read as a named role, spelled out because §17's cases are about which *column* a role may
 *  name, and a client library that quietly asked for another one would ruin the measurement. */
async function read(rel, select, { as = 'anon', headers = {} } = {}) {
  const key = as === 'anon' ? anonKey : hosts[as].client.supabaseKey;
  const jwt = as === 'anon' ? anonKey : await accessToken(as);
  const res = await fetch(`${url}/rest/v1/${rel}?select=${select}`, {
    headers: { apikey: key, Authorization: `Bearer ${jwt}`, ...headers },
  });
  return { status: res.status, body: await json(res) };
}

async function json(res) {
  const text = await res.text();
  return text === '' ? null : JSON.parse(text);
}

async function accessToken(who) {
  const { data, error } = await hosts[who].client.auth.getSession();
  assert.equal(error, null, error?.message);
  return data.session.access_token;
}

/** One write, with the response representation asked for explicitly: a 204 that says nothing and a
 *  200 that says which row moved are two different measurements, and the second is the one that
 *  distinguishes "refused" from "accepted someone else's row". */
async function write(method, rel, query, body, { as = 'anon', represent = true } = {}) {
  const key = as === 'anon' ? anonKey : hosts[as].client.supabaseKey;
  const jwt = as === 'anon' ? anonKey : await accessToken(as);
  const res = await fetch(`${url}/rest/v1/${rel}${query}`, {
    method,
    headers: {
      apikey: key, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json',
      Prefer: represent ? 'return=representation' : 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await json(res) };
}

/** The catalogues' column shapes, in one place, because three cases read them and the whole point
 *  of case 7 is that the list is short and named. */
const SAFE_RELEASE_COLUMNS = ['id', 'pack_id', 'release_number', 'status', 'languages',
  'definition', 'definition_schema_version'];
const CUSTOMER_SAFE_PACK_COLUMNS = ['id', 'pack_key', 'display_name', 'scope_statement'];
/** The eleven §4 names, plus the four timestamps and labels that belong to maintenance rather than
 *  to a customer. Every one of these is refused to `authenticated` by a column grant, which is
 *  §17's case 8 and the reason `GRANT SELECT ON … TO authenticated` is not what the migration says. */
const INTERNAL_COLUMNS = ['review_label', 'review_basis', 'review_scope', 'reviewed_by',
  'reviewed_languages', 'reviewed_at', 'approved_at', 'deprecated_at', 'author_label',
  'machine_assisted', 'machine_assistance_notes', 'source_reference', 'changelog',
  'created_at', 'updated_at'];

const PACK_KEYS = ['stage4_http_fixture', 'stage4_http_draft_only', 'stage4_http_reviewed_only',
  'stage4_http_retired_only', 'stage4_http_language_gaps'];

/** The eleven keys §11 puts *inside* a frozen snapshot to make the document self-describing.
 *  `GST-01` measures the other half: none of these survives the guest projection, which keeps
 *  three. Pinning both lists is what turns "provenance is internal" from a comment into a fact. */
const SNAPSHOT_RELEASE_KEYS = ['author_label', 'definition_schema_version', 'display_name',
  'languages', 'machine_assisted', 'pack_key', 'release_number', 'review_label',
  'reviewed_languages', 'scope_statement', 'source_reference'].sort();

/** The fixture's release ids. Deterministic because the seed writes them, and repeated here as
 *  literals rather than read from the seed's NOTICE output: a test that discovers its own subject
 *  by parsing log lines cannot tell a missing row from a changed format. */
const REL = {
  r1: 'aaaaaaaa-0004-4000-8000-000000000101',
  r2: 'aaaaaaaa-0004-4000-8000-000000000102',
  r3: 'aaaaaaaa-0004-4000-8000-000000000103',
  draft: 'aaaaaaaa-0004-4000-8000-000000000201',
  reviewed: 'aaaaaaaa-0004-4000-8000-000000000301',
  retiredOnly: 'aaaaaaaa-0004-4000-8000-000000000401',
  gapFallback: 'aaaaaaaa-0004-4000-8000-000000000501',
  gapLocked: 'aaaaaaaa-0004-4000-8000-000000000502',
};
const PACK = {
  main: 'aaaaaaaa-0004-4000-8000-000000000001',
  draftOnly: 'aaaaaaaa-0004-4000-8000-000000000002',
  reviewedOnly: 'aaaaaaaa-0004-4000-8000-000000000003',
  retiredOnly: 'aaaaaaaa-0004-4000-8000-000000000004',
  gaps: 'aaaaaaaa-0004-4000-8000-000000000005',
};

/** Where `CAND-01` offers the real draft candidate artifact to the database, and takes it back
 *  again. The ids are fixed rather than generated so the case can name the row it is looking for
 *  in a customer's read, and the pack *key* is deliberately not `tamil_english_foundation`: the
 *  concept row is scaffolding, and a crashed run should leave behind a row that is unmistakably a
 *  probe rather than a candidate that looks like it was shipped. */
const CAND = {
  packKey: 'stage4_candidate_probe',
  pack: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  release: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',
};

/** The one thing a refusal must never be: an absence that could also be a typo. Every invisible-row
 *  case below pairs its empty answer with the same statement about a row that *is* visible. */
async function visibleReleaseIds(as = 'hostA') {
  const r = await read('tradition_pack_releases', 'id&order=id.asc', { as });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.map((row) => row.id);
}

/** The one write every SELECTION and FREEZE case is built on: the host pointing their own
 *  wedding at a release. Module scope, because the freeze journey needs to move a selection too
 *  and a helper that lives inside one `describe` would force a second copy of the same statement
 *  somewhere else. */
const pointAt = (as, weddingId, releaseId) => write('PATCH', 'weddings',
  `?id=eq.${weddingId}`, { tradition_pack_release_id: releaseId }, { as });

/** The only freeze route a customer has. Module scope because the provenance cases freeze a second
 *  document of their own after the FREEZE block has finished moving selections around. */
const freeze = (who, weddingId) => api(who).rpc('create_invitation_version', {
  p_wedding_id: weddingId,
});

function trustedCleanup() {
  const ownerIds = `(select w.id from public.weddings w join auth.users u on u.id = w.owner_user_id
                      where u.email like '%+${RUN_TAG}@example.test')`;
  trustedSql(`
    delete from private.access_tokens where wedding_id in ${ownerIds};
    delete from public.publications where wedding_id in ${ownerIds};
    delete from public.invitation_versions where wedding_id in ${ownerIds};
    delete from public.weddings where id in ${ownerIds};
  `);
}

before(async () => {
  // The seed first, before any caller reads a catalogue: a missing pack would turn every
  // "invisible" case below into a pass about a row that was never there.
  const lines = trustedFile('supabase/tests/api/fixtures/stage4_http_pack.sql');
  const ledger = lines.filter((l) => l.startsWith('FIXTURE-LEDGER|'));
  for (const key of PACK_KEYS) {
    assert.ok(ledger.some((l) => l.startsWith(`FIXTURE-LEDGER|${key}|`)),
      `refusing to run: the local stack has no fixture pack ${key}; it should hold `
      + `${PACK_KEYS.join(', ')}, and a missing one would make an invisibility case meaningless`);
  }
  // The states the cases below are told apart by. Read back rather than trusted: the seed is
  // idempotent, so a hand-applied edit to one row shows up here instead of much later as a
  // confusing refusal.
  const want = [
    [REL.r1, 'approved'], [REL.r2, 'approved'], [REL.r3, 'deprecated'],
    [REL.draft, 'draft'], [REL.reviewed, 'reviewed'], [REL.retiredOnly, 'deprecated'],
    [REL.gapFallback, 'approved'], [REL.gapLocked, 'approved'],
  ];
  const rows = sqlRows(`select id || '|' || status from public.tradition_pack_releases
                          where id in ('${want.map(([id]) => id).join("','")}')`);
  for (const [id, status] of want) {
    assert.ok(rows.includes(`${id}|${status}`),
      `refusing to run: fixture release ${id} is not '${status}' (${rows.join(' ')})`);
  }

  hosts.hostA = await signUp('s4-host-a');
  hosts.hostB = await signUp('s4-host-b');

  const create = async (who, title, language) => {
    const { data, error } = await hosts[who].client.from('weddings')
      .insert({ owner_user_id: hosts[who].userId, title, primary_language: language })
      .select('id, tradition_pack_release_id, primary_language').single();
    assert.equal(error, null, `${who} could not create ${title}: ${error?.message}`);
    return data;
  };
  // Five weddings, because these cases move a selection and a freeze, and a shared wedding would
  // make each later answer partly a measurement of the previous test.
  hosts.wedEn = await create('hostA', 'Asha weds Bala', 'en');
  hosts.wedTa = await create('hostA', 'Asha weds Bala (Tamil)', 'ta');
  hosts.wedMint = await create('hostA', 'Chitra weds Deepa', 'en');
  hosts.wedNoPack = await create('hostB', 'Deepa alone', 'en');
  hosts.victim = await create('hostB', 'Someone else\'s invitation', 'en');

  // A venue and a person on host A's English wedding, written through the same API the tests use.
  // Two of the fixture's sections are a `people_list` and an `event_list`, and §17's case 39 wants a
  // real link value to survive or fail the contract with.
  const { data: venue, error: venueErr } = await client('hostA').from('venues').insert({
    wedding_id: hosts.wedEn.id, name: 'Kalyana Mantapa',
    address_text: '100 Pillar Road, Madurai',
    map_url: 'https://maps.example.test/kalyana-mantapa',
  }).select('id').single();
  assert.equal(venueErr, null, venueErr?.message);
  hosts.venue = venue;
  const { data: ceremony, error: cerErr } = await client('hostA').from('wedding_events').insert({
    wedding_id: hosts.wedEn.id, event_key: 'muhurtham', display_name: 'Muhurtham',
    starts_at_local: '2026-11-14T07:30:00', venue_id: venue.id,
  }).select('id').single();
  assert.equal(cerErr, null, cerErr?.message);
  const { error: personErr } = await client('hostA').from('wedding_people').insert({
    wedding_id: hosts.wedEn.id, display_name: 'K. Selvi', role_key: 'mother',
    role_label: 'Mother', group_key: 'bride', group_label: "The bride's family",
  });
  assert.equal(personErr, null, personErr?.message);
});

after(async () => {
  trustedCleanup();
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
  const ids = Object.values(hosts).filter((h) => h.userId).map((h) => h.userId);
  const { data: left, error } = await svc.from('weddings').select('id').in('owner_user_id', ids);
  assert.equal(error, null, error?.message);
  assert.deepEqual(left, [], 'teardown left a wedding behind');
  for (const id of ids) {
    const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    assert.ok(res.ok, `teardown could not remove a synthetic account (HTTP ${res.status})`);
  }
  // §31: the residue of this suite is the minted release, and it is printed rather than assumed
  // away. `LEDGER-01` asserts nothing about it on purpose — an assertion about an accumulating row
  // would fail on the second run for a reason that is not a defect.
  console.log('  fixture catalogue left in the local stack:');
  for (const line of sqlRows(`select '    ' || p.pack_key || ' release ' || r.release_number
                                     || ' is ' || r.status
                                from public.tradition_pack_releases r
                                join public.tradition_packs p on p.id = r.pack_id
                               where p.pack_key like 'stage4_http_%'
                               order by p.pack_key, r.release_number`)) {
    console.log(line);
  }
});

// ---------------------------------------------------------------------------
// CATALOGUE — §17 cases 1-8, and the maintenance grants of 31-37
// ---------------------------------------------------------------------------
describe('§17 CATALOGUE', () => {
  test('CAT-01 (case 1) the anonymous web is refused both catalogue tables, and the control shows it is the grant and not the transport', async () => {
    for (const rel of ['tradition_pack_releases', 'tradition_packs']) {
      const r = await read(rel, 'id');
      assert.equal(r.status, 401, rel);
      assert.equal(r.body.code, '42501', rel);
      assert.match(r.body.message, new RegExp(`permission denied for table ${rel}`));
      // The control: the same key, the same host, one function that is meant for it. Without
      // this, two refusals could just mean "anon cannot reach PostgREST".
      const control = await anonApi().rpc('resolve_public_invitation');
      assert.equal(control.error, null, control.error?.message);
      assert.deepEqual(control.data, { available: false });
    }
  });

  test('CAT-02 (cases 2, 6) an approved release appears with its coverage, and its pack appears because of it', async () => {
    const releases = await read('tradition_pack_releases',
      'id,pack_id,release_number,status,languages&pack_id=eq.' + PACK.main, { as: 'hostA' });
    assert.equal(releases.status, 200);
    // The two things case 2 and case 6 actually claim, told apart. An exact list of this pack's
    // release numbers cannot be one of them: `stage4_mint_release.sql` adds a numbered release to
    // this very pack every time the deprecation journey runs, and a run that reached FRZ-06 left
    // an approved one behind. So the seed's own rows are pinned by id, the retired one is pinned
    // by its absence, and the answer as a whole is pinned to being nothing but approved — which
    // is the claim, and does not depend on how many times this suite has run.
    const byId = Object.fromEntries(releases.body.map((r) => [r.id, r]));
    assert.equal(byId[REL.r1]?.status, 'approved', 'release 1 of the fixture pack is missing or not approved');
    assert.equal(byId[REL.r2]?.status, 'approved', 'release 2 of the fixture pack is missing or not approved');
    assert.ok(!byId[REL.r3], 'a retired release of a pack that has approved ones sat in the same answer');
    assert.deepEqual([...new Set(releases.body.map((r) => r.status))].sort()
      .filter((s) => s !== 'approved' && s !== 'deprecated'), [],
      'the picker read returned a release in a state a customer has no use for; a deprecated one is '
      + 'only allowed when the wedding of the host making this read already points at it, which is '
      + 'checked next');
    if (releases.body.some((r) => r.status === 'deprecated')) {
      const mine = sqlRows(`select tradition_pack_release_id from public.weddings
                             where owner_user_id = '${hosts.hostA.userId}'
                               and tradition_pack_release_id is not null`);
      assert.ok(releases.body.filter((r) => r.status === 'deprecated')
        .every((r) => mine.includes(r.id)),
        'a deprecated release was readable by a host whose wedding does not point at it');
    }
    assert.ok(releases.body.every((r) => r.pack_id === PACK.main),
      'a filter on pack_id returned another pack');
    for (const id of [REL.r1, REL.r2]) {
      assert.deepEqual(byId[id].languages.slice().sort(), ['en', 'ta']);
    }

    const packs = await read('tradition_packs', 'id,pack_key&id=eq.' + PACK.main, { as: 'hostA' });
    assert.equal(packs.status, 200);
    assert.deepEqual(packs.body, [{ id: PACK.main, pack_key: 'stage4_http_fixture' }]);
  });

  test('CAT-03 (case 7) the catalogue answers carry only the columns a customer has a use for', async () => {
    const releases = await read('tradition_pack_releases',
      `id,pack_id,release_number,languages&pack_id=eq.${PACK.main}&status=eq.approved`, { as: 'hostA' });
    assert.equal(releases.status, 200);
    assert.ok(releases.body.length > 0, 'the control read found nothing, so its shape proves nothing');
    assert.deepEqual(Object.keys(releases.body[0]).sort(),
      ['id', 'languages', 'pack_id', 'release_number']);

    const packs = await read('tradition_packs',
      'id,pack_key,display_name,scope_statement', { as: 'hostA' });
    assert.equal(packs.status, 200);
    const fixture = packs.body.find((p) => p.id === PACK.main);
    assert.deepEqual(Object.keys(fixture).sort(), CUSTOMER_SAFE_PACK_COLUMNS.slice().sort());
    // The scope statement is the one sentence of the fixture that a host reads, and it is the
    // place where a TEST ONLY claim cannot be lost.
    assert.match(fixture.scope_statement, /TEST ONLY/);
    // The sentence as the fixture actually writes it, quoted rather than paraphrased: the point is
    // that this stage's test content says out loud that no culturally-qualified human read it, and
    // a regex that matches a paraphrase would survive the sentence being softened.
    assert.match(fixture.scope_statement,
      /no string in it was read by a human reviewer with cultural authority/);
  });

  test('CAT-04 (case 8) every reviewer, authorship, machine-disclosure and maintenance column is refused to a customer, by name', async () => {
    // Positive control first: the same role, the same table, one query naming only granted
    // columns. Without it, fifteen refusals would be one fact — the role cannot reach the table —
    // and §17 asks for the narrower claim.
    const allowed = await read('tradition_pack_releases',
      SAFE_RELEASE_COLUMNS.join(','), { as: 'hostA' });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
    assert.ok(allowed.body.length > 0);

    for (const column of INTERNAL_COLUMNS) {
      const r = await read('tradition_pack_releases', column, { as: 'hostA' });
      assert.equal(r.status, 403, `${column} was not refused`);
      assert.equal(r.body.code, '42501', column);
      // Measured wording: a column-level miss reports itself as the table, because that is the
      // object the missing privilege is on.
      assert.match(r.body.message, /permission denied for table tradition_pack_releases/, column);
    }

    // `select=*` is the shape a generated client emits when nobody decided anything, and it is
    // refused for the same reason — which is what makes "the UI does not display it" unnecessary
    // rather than sufficient.
    const star = await read('tradition_pack_releases', '*', { as: 'hostA' });
    assert.equal(star.status, 403);
    assert.equal(star.body.code, '42501');

    // A customer cannot read them through a filter either: a WHERE on a column the role cannot
    // name is the same privilege check. Spelled as one query string because a GET with a request
    // body is not a thing HTTP allows, and a refusal of the *transport* would prove nothing here.
    const filtered = await read('tradition_pack_releases',
      'id&review_label=like.*REVIEW*', { as: 'hostA' });
    assert.equal(filtered.status, 403, JSON.stringify(filtered.body));
    assert.equal(filtered.body.code, '42501');
    // And through an order, which is the other place a column name appears without being returned.
    const ordered = await read('tradition_pack_releases',
      'id&order=review_label.asc.nullslast', { as: 'hostA' });
    assert.equal(ordered.status, 403, JSON.stringify(ordered.body));
  });

  test('CAT-05 (cases 3, 4) a pack whose only release is unshipped is invisible, and so is the release itself', async () => {
    const visible = await visibleReleaseIds();
    for (const [id, key] of [[REL.draft, 'draft'], [REL.reviewed, 'reviewed']]) {
      assert.ok(!visible.includes(id),
        `a ${key} release was readable, so the selection refusals below would be about the gate rather than the catalogue`);
    }
    const packs = await read('tradition_packs', 'id,pack_key', { as: 'hostA' });
    assert.equal(packs.status, 200);
    const names = packs.body.map((p) => p.id);
    assert.ok(!names.includes(PACK.draftOnly), 'a pack with only a draft release was enumerable');
    assert.ok(!names.includes(PACK.reviewedOnly), 'a pack with only a reviewed release was enumerable');
    // The control inside the same answer: the pack that *does* have something approved is there.
    assert.ok(names.includes(PACK.main));
    assert.ok(names.includes(PACK.gaps));
  });

  test('CAT-06 (case 5) a retired release is not offered, and a pack left with nothing to choose goes with it', async () => {
    const offered = await read('tradition_pack_releases',
      'id,pack_id,release_number&status=eq.approved&order=id.asc', { as: 'hostA' });
    assert.equal(offered.status, 200);
    const ids = offered.body.map((r) => r.id);
    assert.ok(!ids.includes(REL.r3), 'a retired release came back from the picker read');
    assert.ok(!ids.includes(REL.retiredOnly));
    // Both retired rows do exist, so this is a refusal and not an absence — read as the
    // maintenance role, which is the only identity that can see them at all.
    const trusted = sqlRows(`select id from public.tradition_pack_releases
                               where id in ('${REL.r3}','${REL.retiredOnly}')`);
    assert.deepEqual(trusted.sort(), [REL.r3, REL.retiredOnly].sort());

    const packs = await read('tradition_packs', 'id,pack_key', { as: 'hostA' });
    assert.ok(!packs.body.map((p) => p.id).includes(PACK.retiredOnly),
      'a pack whose only release was retired is still enumerable, so a name would read as a promise');

    // And the release is not readable at all to a customer with no connection to it, which is the
    // half the *picker* cannot show on its own.
    const direct = await read('tradition_pack_releases', `id&status=eq.deprecated`, { as: 'hostB' });
    assert.equal(direct.status, 200);
    assert.deepEqual(direct.body, []);
  });

  test('CAT-07 (cases 31, 32) a customer cannot write the catalogue at all, so review metadata cannot be forged', async () => {
    const pack = PACK.main;
    const attempts = [
      ['POST', '', {
        pack_id: pack, release_number: 900, definition_schema_version: 1, languages: ['en'],
        definition: { sections: [] }, author_label: 'written by a browser', machine_assisted: false,
      }],
      ['PATCH', `?id=eq.${REL.r1}`, { review_label: 'Blessed by everybody' }],
      ['PATCH', `?id=eq.${REL.r1}`, { status: 'deprecated', deprecated_at: '2026-01-01T00:00:00Z' }],
      ['DELETE', `?id=eq.${REL.r1}`, {}],
    ];
    for (const [method, query, body] of attempts) {
      const r = await write(method, 'tradition_pack_releases', query, body, { as: 'hostA' });
      assert.equal(r.body?.code, '42501', `${method} ${query} was not a grant refusal: ${JSON.stringify(r.body)}`);
    }
    // Case 31 on the other half of the catalogue, and with every column the table requires
    // spelled out. §17 is explicit that a refusal which is really "I could not parse your
    // payload" is not a security pass: PostgREST answers a shapeless body with PGRST204 before
    // the database ever sees the request, so both tables are posted complete rows and the code
    // that comes back has to be the grants gate.
    const completeWrites = [
      ['tradition_pack_releases', {
        pack_id: pack, release_number: 901, definition_schema_version: 1, languages: ['en'],
        definition: { sections: [] }, author_label: 'written by a browser', machine_assisted: false,
        status: 'approved', review_label: 'Blessed by everybody',
      }],
      ['tradition_packs', {
        pack_key: 'stage4_http_forged', display_name: 'A pack no reviewer made',
        scope_statement: 'Created through the browser API to see whether the catalogue is writable.',
      }],
    ];
    for (const [rel, body] of completeWrites) {
      const r = await write('POST', rel, '', body, { as: 'hostA' });
      assert.equal(r.body?.code, '42501',
        `${rel} did not answer a complete browser-authored row with the grants gate: ${JSON.stringify(r.body)}`);
    }

    // Nothing changed, in both directions: the row a PATCH targeted still says what the seed
    // wrote, and no row appeared anywhere for the invented release number.
    const after1 = sqlRows(`select status || '|' || coalesce(review_label,'(none)')
                              from public.tradition_pack_releases where id = '${REL.r1}'`);
    assert.deepEqual(after1, ['approved|TEST FIXTURE REVIEW — NOT A REAL CULTURAL REVIEW']);
    const after2 = sqlRows(`select count(*) from public.tradition_pack_releases
                             where release_number in (900, 901)
                                or author_label = 'written by a browser'`);
    assert.deepEqual(after2, ['0']);
    const after3 = sqlRows(`select count(*) from public.tradition_packs
                             where pack_key = 'stage4_http_forged'`);
    assert.deepEqual(after3, ['0'], 'a browser-authored pack concept reached the catalogue');

    // The control: the same role, the same table, one read that works — and the same role can
    // still *point its own wedding at* a release, which is the write the design does allow.
    const readable = await read('tradition_pack_releases', 'id', { as: 'hostA' });
    assert.equal(readable.status, 200);
  });

  test('CAT-08 (cases 33, 34, 35, 36) no maintenance function is callable, and the exposed function inventory is pinned', async () => {
    // 35 + 36: what is callable over HTTP, enumerated from the catalogue rather than from the
    // migration file, and pinned to the exact set. A new pack-shaped RPC in `api` would show up
    // here, and so would a new RPC of any other kind.
    const exposed = sqlRows(`select routine_name from information_schema.routines
                               where routine_schema = 'api' order by 1`).join(',');
    assert.deepEqual(exposed.split(','), [
      'create_invitation_version', 'get_invitation_publication_state', 'preview_invitation',
      'preview_invitation_document',
      'publish_invitation_version', 'resolve_public_invitation', 'revoke_invitation_publication',
      'rotate_invitation_token',
    ], 'the callable surface changed shape; the pack design has no RPC of its own, and adding one '
      + 'without a ruling is exactly what this list is for');
    // Stage 5 added the eighth name, and there is a ruling: `preview_invitation_document` is the
    // document-plus-verdict read that §3.5 of
    // `docs/audits/stage-5-pack-driven-authoring-review.md` recorded before it was built, and the
    // reason it had to be an RPC at all is that a preview composed from two client calls can
    // straddle a save. It carries no pack wording beyond what `preview_invitation` already
    // returned — the release block is one narrow summary object, asserted in
    // `supabase/tests/stage5/70_document_resolution.sql` group P, at `:1037` and `:1085`.
    const maintenanceSchema = sqlRows(`select coalesce(string_agg(distinct n.nspname, ',' order by n.nspname), '(none)')
                                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                        where p.proname like '%tradition_pack%'`);
    assert.deepEqual(maintenanceSchema, ['internal_api,private'],
      'a tradition-pack function appeared in a schema other than the maintenance surface and the '
      + 'guard helpers, which is where a browser-exposed door would start');

    for (const name of ['resolve_public_invitation']) {
      assert.ok(!/pack|tradition/i.test(name));
    }
    const maintenance = sqlRows(`select coalesce(string_agg(p.proname, ', ' order by p.proname), '(none)')
                                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                  where n.nspname in ('api','public')
                                    and (p.proname ilike '%tradition%' or p.proname ilike '%pack%'
                                         or p.proname like 'guard_%' or p.proname like 'require_%')`);
    assert.deepEqual(maintenance, ['(none)'],
      'a maintenance or governance function became reachable from a browser-exposed schema');

    // 33 + 34: `private` is not a schema a caller may address at all, and the refusal is the
    // profile refusal rather than a privilege one.
    const profile = await fetch(`${url}/rest/v1/weddings?select=id`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Accept-Profile': 'private' },
    });
    assert.equal(profile.status, 406);
    assert.equal((await json(profile)).code, 'PGRST106');

    // And the function itself is refused to a customer even when addressed by its real signature,
    // because it lives in `private`: measured as a call through the exposed profile, which is the
    // only spelling a browser has.
    const guardCall = await api('hostA').rpc('resolve_invitation_sections', {
      p_definition: {}, p_language: 'en',
    });
    assert.equal(guardCall.data, null);
    assert.equal(guardCall.error.code, 'PGRST202',
      `a private resolver was callable: ${JSON.stringify(guardCall.error)}`);
  });

  test('CAT-09 (case 37) the maintenance role reaches the catalogue and no browser role does', async () => {
    // service_role is the identity the lifecycle triggers govern. "No broader than the schema
    // intentionally grants" is measured as the exact privilege vector, not as a claim.
    const acl = sqlRows(`select grantee || ' ' || privilege_type
        from information_schema.table_privileges
        where table_name = 'tradition_pack_releases' order by 1`);
    assert.deepEqual(acl, [
      'postgres DELETE', 'postgres INSERT', 'postgres REFERENCES', 'postgres SELECT',
      'postgres TRIGGER', 'postgres TRUNCATE', 'postgres UPDATE',
      'service_role DELETE', 'service_role INSERT', 'service_role REFERENCES',
      'service_role SELECT', 'service_role TRIGGER', 'service_role TRUNCATE',
      'service_role UPDATE',
    ], 'the release catalogue grants moved: authenticated must hold column-level SELECT only, and '
      + 'the maintenance identities must hold the write path the triggers govern');

    // The browser half of the same fact, by name, because the list above is silent about a role
    // that holds nothing.
    for (const role of ['anon', 'authenticated']) {
      const none = sqlRows(`select count(*) from information_schema.column_privileges
                              where table_name = 'tradition_pack_releases' and grantee = '${role}'
                                and privilege_type = 'SELECT'
                                and column_name not in ('${SAFE_RELEASE_COLUMNS.join("','")}')`);
      assert.deepEqual(none, ['0'], `${role} holds SELECT on a column beyond the customer-safe set`);
    }
    const authed = sqlRows(`select count(*) from information_schema.column_privileges
                              where table_name = 'tradition_pack_releases' and grantee = 'authenticated'
                                and privilege_type = 'SELECT'`);
    assert.deepEqual(authed, [String(SAFE_RELEASE_COLUMNS.length)],
      'authenticated must hold SELECT on exactly the seven columns the app reads');
  });

  test('CAND-01 (§23) the real draft candidate is accepted by the authoritative validator and stays invisible', async () => {
    // §23 asks three things of the candidate on disk: run it through the production parser, run it
    // through the definition validator, run it through the resolver, and keep it a draft. The
    // parser and the resolver are `src/test/traditionPackDraftCandidate.test.ts`, which imports the
    // modules the editor imports. This case is the validator, and the only authoritative one:
    // `private.guard_tradition_pack_release()` is what a release must satisfy before it can exist,
    // so a file that satisfies a TypeScript mirror of the column rules and not the trigger is a
    // candidate that cannot be loaded. That was not hypothetical — candidate 1 of this artifact
    // declared `["ta","en"]`, every mirrored check stayed green, and the trigger answered
    // `languages must be sorted and free of duplicates (got {ta,en})`. The value is offered here
    // exactly as the file spells it, with no sort applied on the way in.
    //
    // The row is a draft, so it can never be selected (SEL-03), never be frozen (§12) and never
    // reach a guest. What is measurable about it is therefore three things and no more: the
    // database will hold it, a customer cannot see it, and taking it back out is allowed because
    // it never left draft.
    const artifact = JSON.parse(readFileSync(
      resolve(ROOT, 'content/tradition-packs/tamil-english-foundation.v1.json'), 'utf8'));

    // Read here rather than assumed from the other file: this case writes provenance columns
    // straight from the artifact, so if the flags ever moved the write below would be seeding a
    // release that §23 forbids.
    assert.equal(artifact.status, 'draft');
    assert.equal(artifact.machine_assisted, true);
    assert.equal(artifact.human_reviewed, false);
    assert.equal(artifact.customer_selectable, false);
    assert.equal(artifact.review, null);

    const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
    // The array literal is the artifact's own order, spelled straight out of the file. `'{en,ta}'`
    // is what it says today; `'{ta,en}'` is what it said when this case was written, and the
    // trigger refused it while every mirrored check in the vitest file stayed green.
    const languages = `'{${artifact.languages.join(',')}}'::text[]`;

    // Idempotent: a run that died between the insert and the delete would otherwise make the next
    // one fail on a unique key and read like a schema problem.
    trustedSql(`delete from public.tradition_pack_releases where id = '${CAND.release}'::uuid;
                 delete from public.tradition_packs where id = '${CAND.pack}'::uuid;`);
    assert.deepEqual(sqlRows(`select count(*) from public.tradition_packs
                               where id = '${CAND.pack}'::uuid`), ['0'],
      'refusing to run: the probe pack could not be cleared before the candidate was offered');

    trustedSql(`
      insert into public.tradition_packs (id, pack_key, display_name, scope_statement)
        values ('${CAND.pack}'::uuid, ${q(CAND.packKey)}, ${q(artifact.display_name)},
                ${q(artifact.scope_statement)});
      insert into public.tradition_pack_releases
        (id, pack_id, release_number, status, definition_schema_version, languages, definition,
         author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
        values ('${CAND.release}'::uuid, '${CAND.pack}'::uuid, ${artifact.release_number},
                'draft', ${artifact.definition_schema_version}, ${languages},
                ${q(JSON.stringify(artifact.definition))}::jsonb,
                ${q(artifact.author_label)}, ${artifact.machine_assisted},
                ${q(artifact.machine_assistance_notes)}, ${q(artifact.source_reference)},
                ${q(artifact.changelog)});
    `);

    try {
      // The guard accepted it, and accepted it as a draft carrying no review record — the one
      // state §23 permits. `trustedSql` throws on a refused statement, so reaching this line is
      // the acceptance; what is asserted here is what was actually stored.
      const landed = sqlRows(`select r.status || '|' || r.machine_assisted::text
                                     || '|' || coalesce(r.review_label, '(none)')
                                     || '|' || coalesce(r.reviewed_at::text, '(none)')
                                     || '|' || array_to_string(r.languages, ',')
                                     || '|' || cardinality(r.languages)::text
                                  from public.tradition_pack_releases r
                                 where r.id = '${CAND.release}'::uuid`);
      assert.deepEqual(landed, ['draft|true|(none)|(none)|en,ta|2'],
        'the candidate did not land as the draft the artifact declares');

      // Nothing in the definition was rewritten on the way in. Two leaves are read back, picked by
      // `section_key` rather than by index: the Tamil heading, which is a bracketed placeholder and
      // has to arrive as one, and the couple body, whose English carries an apostrophe — the one
      // character in this artifact that a naive statement-builder would have truncated the JSON at.
      const leafOf = (sectionKey, slot, language) => {
        const index = artifact.definition.sections
          .findIndex((section) => section.section_key === sectionKey);
        assert.ok(index >= 0, `the artifact no longer declares a ${sectionKey} section`);
        const value = artifact.definition.sections[index][slot]?.[language];
        assert.equal(typeof value, 'string',
          `the artifact's ${sectionKey} section no longer carries a ${slot}.${language}`);
        return { path: `{sections,${index},${slot},${language}}`, value };
      };
      const openingHeading = leafOf('opening', 'heading', 'ta');
      const coupleBody = leafOf('couple', 'pack_text', 'en');
      const readLeaf = (leaf) => sqlRows(`select coalesce(definition #>> '${leaf.path}', '(absent)')
                                           from public.tradition_pack_releases
                                          where id = '${CAND.release}'::uuid`);
      const storedHeading = readLeaf(openingHeading);
      const storedBody = readLeaf(coupleBody);
      assert.equal(storedHeading.length, 1, 'the candidate row was not readable back through the trusted route');
      assert.deepEqual(storedHeading, [openingHeading.value],
        'the machine-authored Tamil placeholder did not survive the write verbatim');
      assert.deepEqual(storedBody, [coupleBody.value],
        'the stored English body differs from the file, which is what a mis-escaped apostrophe looks like');
      assert.ok(coupleBody.value.includes("'"),
        'the control above stopped being a control: the artifact no longer carries an apostrophe');
      assert.ok(storedHeading[0].startsWith('[placeholder]'));

      // No customer sees it, in either of the two ways that would matter: by id, and by the
      // catalogue query the picker actually issues.
      const byId = await read('tradition_pack_releases', 'id,status', { as: 'hostA' });
      assert.equal(byId.status, 200, JSON.stringify(byId.body));
      assert.ok(!byId.body.some((row) => row.id === CAND.release),
        'a customer read the draft candidate out of the release catalogue');
      const picker = await read('tradition_pack_releases',
        'id,pack_id,release_number,languages&status=eq.approved&order=release_number.desc',
        { as: 'hostA' });
      assert.equal(picker.status, 200, JSON.stringify(picker.body));
      assert.ok(!picker.body.some((row) => row.pack_id === CAND.pack),
        'the candidate reached the picker of things a host may choose');

      // And the concept row is hidden with it, because a pack with nothing to choose is not shown.
      const packs = await read('tradition_packs', 'id,pack_key', { as: 'hostA' });
      assert.equal(packs.status, 200, JSON.stringify(packs.body));
      assert.ok(!packs.body.some((row) => row.id === CAND.pack),
        'the candidate concept was readable by a customer');

      // Positive controls, because the three assertions above are absences and an absence is only
      // evidence when the same statement returns a row that exists.
      assert.ok(byId.body.some((row) => row.id === REL.r1),
        'the customer release read returns nothing at all, so the invisibility above is not a measurement');
      assert.ok(picker.body.some((row) => row.id === REL.r1));
      assert.ok(packs.body.some((row) => row.id === PACK.main),
        'the customer pack read returns nothing at all');

      // The provenance columns that would describe the candidate to a customer are not merely
      // absent from these lists — naming one is refused. This is the half of §23 that says the
      // machine-assistance note never reaches a screen.
      const withheld = await read('tradition_pack_releases', 'id,author_label', { as: 'hostA' });
      assert.equal(withheld.status, 403, JSON.stringify(withheld.body));
      assert.equal(withheld.body.code, '42501');

      // A host cannot adopt it either, and the refusal is the selection gate's one sentence, with
      // the reason spelled as the policy's outcome rather than the status — the release is not
      // readable by that role, which is the same answer a release that never existed gets.
      const adopted = await pointAt('hostA', hosts.wedEn.id, CAND.release);
      assert.equal(adopted.status, 403, JSON.stringify(adopted.body));
      assert.equal(adopted.body.code, '42501');
      assert.match(adopted.body.message,
        /^a wedding may only select an approved tradition pack release \(this one is [^)]*\)$/);
      const stillClear = await client('hostA').from('weddings')
        .select('id, tradition_pack_release_id').eq('id', hosts.wedEn.id).single();
      assert.equal(stillClear.error, null, stillClear.error?.message);
      assert.equal(stillClear.data.tradition_pack_release_id, null,
        'the candidate moved a wedding selection while being refused');
    } finally {
      trustedSql(`delete from public.tradition_pack_releases where id = '${CAND.release}'::uuid;
                   delete from public.tradition_packs where id = '${CAND.pack}'::uuid;`);
    }

    // No residue, and the deletion is itself a fact: the same trigger refuses a DELETE of any row
    // that has left draft, so these two statements only succeed because the candidate is still a
    // draft this build never promoted.
    assert.deepEqual(sqlRows(`select count(*) from public.tradition_pack_releases
                               where id = '${CAND.release}'::uuid`), ['0']);
    assert.deepEqual(sqlRows(`select count(*) from public.tradition_packs
                               where id = '${CAND.pack}'::uuid
                                  or pack_key = '${CAND.packKey}'`), ['0'],
      '§31 cleanup would find a candidate probe pack left behind by this case');
  });
});

// ---------------------------------------------------------------------------
// SELECTION — §17 cases 9-16
// ---------------------------------------------------------------------------
describe('§17 SELECTION', () => {
  test('SEL-01 (case 9) an owner points their own wedding at an approved release, and it reads back', async () => {
    const r = await pointAt('hostA', hosts.wedEn.id, REL.r1);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.length, 1, 'the write matched something other than exactly one row');
    assert.equal(r.body[0].id, hosts.wedEn.id);
    assert.equal(r.body[0].tradition_pack_release_id, REL.r1);

    const back = await client('hostA').from('weddings')
      .select('id, tradition_pack_release_id').eq('id', hosts.wedEn.id).single();
    assert.equal(back.error, null, back.error?.message);
    assert.equal(back.data.tradition_pack_release_id, REL.r1);
  });

  test('SEL-02 (case 10) "No tradition pack" is a choice, and it is always legal', async () => {
    const r = await pointAt('hostA', hosts.wedEn.id, null);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body[0].tradition_pack_release_id, null);
    // The control that makes SEL-03 a measurement: the same statement one moment later, with a
    // real approved release in it, succeeds.
    const back = await pointAt('hostA', hosts.wedEn.id, REL.r1);
    assert.equal(back.status, 200);
    assert.equal(back.body[0].tradition_pack_release_id, REL.r1);
  });

  test('SEL-03 (cases 11, 12, 13, 15) every release that is not approved is refused, and the refusal is the same sentence whatever the reason', async () => {
    const cases = [
      ['draft', REL.draft], ['reviewed', REL.reviewed], ['deprecated', REL.r3],
      ['a retired release of another pack', REL.retiredOnly],
      ['a uuid that is not a release at all', randomUUID()],
      ['the zero uuid', '00000000-0000-4000-8000-000000000000'],
    ];
    const messages = new Set();
    for (const [label, id] of cases) {
      const r = await pointAt('hostA', hosts.wedTa.id, id);
      assert.equal(r.body?.code, '42501', `${label} was accepted: ${JSON.stringify(r.body)}`);
      assert.equal(r.status, 403, label);
      // A governance refusal carries no GRANT hint, unlike a table privilege miss — measured, and
      // the difference is what tells a caller this was a decision rather than a missing grant.
      assert.equal(r.body.hint, null, label);
      assert.match(r.body.message,
        /^a wedding may only select an approved tradition pack release \(this one is [^)]*\)$/,
        `${label} refused with something other than the gate's own sentence`);
      messages.add(r.body.message);
    }
    // The no-oracle half, spelled out: an unshipped release, a retired one and one that has never
    // existed are refused with one string. Before SEL-01 this was not a claim anyone could check.
    assert.equal(messages.size, 1, `the refusals differed, so a caller could tell the cases apart: ${[...messages].join(' // ')}`);

    // Nothing moved.
    const back = await client('hostA').from('weddings')
      .select('id, tradition_pack_release_id').eq('id', hosts.wedTa.id).single();
    assert.equal(back.data.tradition_pack_release_id, null);

    // The positive control, on the same wedding one statement later.
    const ok = await pointAt('hostA', hosts.wedTa.id, REL.r1);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  test('SEL-04 (case 14) another user\'s wedding cannot be pointed anywhere, and the answer is silence rather than a refusal', async () => {
    const r = await pointAt('hostA', hosts.victim.id, REL.r1);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, [], 'a cross-tenant write matched a row');

    const back = await client('hostB').from('weddings')
      .select('id, tradition_pack_release_id').eq('id', hosts.victim.id).single();
    assert.equal(back.error, null, back.error?.message);
    assert.equal(back.data.tradition_pack_release_id, null,
      'host A moved host B\'s wedding while believing the write had matched nothing');

    // Control: host B moves their own wedding with the identical statement.
    const own = await pointAt('hostB', hosts.victim.id, REL.r1);
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body[0].tradition_pack_release_id, REL.r1);
  });

  test('SEL-05 (case 16) a refusal a host can actually reach never names a table, a column, a schema or a function', async () => {
    // Scoped deliberately, and the scope is the finding. What a host's own editor can produce is
    // the selection gate's sentence, in each of the three reasons it fires; what a *grant* refusal
    // looks like is measured below and disclosed rather than wished away, because a Postgres
    // privilege miss arrives with the table's name and a GRANT statement in its hint, and that
    // text is a fact about the caller's own privileges rather than about anybody's review record.
    const refusals = [
      await pointAt('hostA', hosts.wedMint.id, REL.draft),
      await pointAt('hostA', hosts.wedMint.id, REL.reviewed),
      await pointAt('hostA', hosts.wedMint.id, randomUUID()),
    ];
    for (const r of refusals) {
      const text = JSON.stringify(r.body);
      for (const internal of ['private.', 'internal_api', 'require_approved_pack_release',
        'weddings_pack_release_gate', 'guard_tradition_pack_release', 'search_path',
        'tradition_pack_releases', 'PL/pgSQL', 'ERROR:']) {
        assert.ok(!text.includes(internal),
          `a refusal carried an internal identifier a customer has no use for: ${internal} in ${text}`);
      }
      // And nothing in it is a stack frame or a constraint name either.
      assert.doesNotMatch(r.body.message, /(check|constraint|trigger|function) _?[a-z0-9_]+/i,
        r.body.message);
    }
    // The one thing that must be present: the reason, in a sentence the host can act on.
    assert.match(refusals[0].body.message, /approved/);
    assert.equal(refusals[0].body.hint, null,
      'a governance refusal arrived with a GRANT hint, which is the shape of a missing privilege');

    // The grant refusal, recorded as measured. Reached from here only because this suite also
    // qualifies the grants (CAT-04, CAT-07); no journey in the product asks a browser to write
    // the catalogue, so this sentence is not copy a host sees. What it does leak is the table's
    // own name and the statement that would open it — and no column of the review record.
    const grantRefusal = await write('POST', 'tradition_pack_releases', '',
      { pack_id: PACK.main }, { as: 'hostA' });
    assert.equal(grantRefusal.body?.code, '42501');
    assert.match(grantRefusal.body.message, /permission denied for table tradition_pack_releases/);
    for (const column of INTERNAL_COLUMNS) {
      assert.ok(!JSON.stringify(grantRefusal.body).includes(column),
        `a privilege refusal named the internal column ${column}`);
    }
    for (const internal of ['private.', 'internal_api', 'reviewed_by', 'PL/pgSQL']) {
      assert.ok(!JSON.stringify(grantRefusal.body).includes(internal));
    }
  });

  test('SEL-06 (ruling A1) no identity, not even the maintenance role, can newly point a wedding at a retired release', async () => {
    // Ruling A1 has two halves, and this is the half that decides where the other one gets
    // measured. `weddings_pack_release_gate` is a table trigger that fires for every role, the
    // maintenance role included, so the state "a wedding points at a retired release" cannot be
    // written into existence by anybody who was not there before the release was retired. It can
    // only be *grown*, by selecting an approved release and retiring it afterwards.
    const moved = await pointAt('hostB', hosts.victim.id, REL.r3);
    assert.equal(moved.body?.code, '42501', 'a wedding was newly pointed at a retired release');
    assert.equal(moved.status, 403);

    // The same attempt through the trusted route, refused by the same sentence. This is what turns
    // the readable half of A1 into a claim about a reachable state rather than a convenient
    // fixture: if this write succeeded, every "a retired release stays readable" case in this file
    // would be measuring a row the shipped schema cannot produce.
    const refusal = trustedRefusal(`update public.weddings set tradition_pack_release_id = '${REL.r3}'
                 where id = '${hosts.wedMint.id}'`);
    assert.ok(refusal,
      'the maintenance role moved a wedding onto a retired release, so the dangling state this suite '
      + 'is about cannot be produced and belongs in a migration instead');
    assert.match(refusal,
      /a wedding may only select an approved tradition pack release \(this one is deprecated\)/);

    // The row did not move, which is the difference between a refused statement and a statement
    // that ran and hid its error.
    assert.deepEqual(
      sqlRows(`select coalesce(tradition_pack_release_id::text, '(none)') from public.weddings
                where id = '${hosts.wedMint.id}'`),
      ['(none)']);

    // Control on the same wedding, one statement later: an approved release is pointable by the
    // route the editor uses, which is what the retired case above is the exception to.
    const ok = await pointAt('hostA', hosts.wedMint.id, REL.r1);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    // ... and the readable half of A1 is measured in FRZ-06b, where a release is selected first and
    // retired second, which is the only order the schema permits.
  });
});

// ---------------------------------------------------------------------------
// FREEZE — §17 cases 17-22, and the provenance half of 23-24
// ---------------------------------------------------------------------------
describe('§17 FREEZE', () => {
  test('FRZ-01 (case 17) a wedding with no pack freezes, and its snapshot invents no release block', async () => {
    const { data, error } = await freeze('hostB', hosts.wedNoPack.id);
    assert.equal(error, null, error?.message);
    assert.equal(data.version_number, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(data.snapshot, 'tradition_pack_release'),
      true, 'the snapshot shape moved, and §11 pins the key that carries the absence');
    assert.equal(data.snapshot.tradition_pack_release, null);
    assert.equal(data.snapshot.sections.requested, 'en');
    // Stage 3's contract survives, and §24's "no-pack behaviour must come from the same
    // normalized-section contract" is what makes that measurable: `private.build_invitation_snapshot`
    // resolves a pack-less wedding against `private.default_invitation_definition()`, which is
    // written in the shape of a release definition on purpose. So a no-pack freeze returns six
    // sections — and the load-bearing claim is not "zero sections", it is that *none of them is
    // attributed to a pack and none of them carries wording nobody wrote*.
    assert.deepEqual(Object.keys(data.snapshot.sections).sort(), ['items', 'requested']);
    const items = data.snapshot.sections.items;
    assert.deepEqual(items.map((s) => s.section_key),
      ['welcome', 'family_introduction', 'family', 'ceremonies', 'event_notes', 'closing'],
      'the built-in no-pack section set moved, which is a render-contract change and not this suite\'s business');
    assert.deepEqual(items.map((s) => s.kind),
      ['text', 'text', 'people_list', 'event_list', 'text', 'text']);
    assert.ok(items.every((s) => s.body_source === null),
      `a pack-less section claimed a source: ${JSON.stringify(items.filter((s) => s.body_source !== null))}`);
    assert.ok(items.every((s) => s.body_text === null),
      'a pack-less invitation was frozen with wording the host never typed');
    assert.ok(items.every((s) => s.overrode_pack_text === null),
      'a pack-less section reported overriding a pack it never had');
    // One heading exists in the built-in set, and it is structural ("The ceremonies"), not
    // ceremonial wording. Naming it here is what keeps "no placeholder wording" a measurement
    // rather than a mood.
    assert.deepEqual(items.filter((s) => s.heading_text !== null)
      .map((s) => [s.section_key, s.heading_text, s.heading_language]),
      [['ceremonies', 'The ceremonies', 'en']]);
    assert.equal(items.filter((s) => s.required).length, 0,
      'the built-in set marks something required, so a plain invitation could no longer freeze');
  });

  test('FRZ-02 (cases 18, 23) a freeze from the approved release pins it, and the reviewed wording is marked reviewed_pack', async () => {
    const { data, error } = await freeze('hostA', hosts.wedEn.id);
    assert.equal(error, null, error?.message);
    // The snapshot names the release by *pack key and number*, never by uuid — §11's rule is that
    // the answer to "what did the guest read" has to be spellable by a human holding the release
    // catalogue, and an identifier inside a document that gets copied around is a leak with no use
    // case. So this assertion is about the twelve keys the block does carry, and the absence of an
    // id is one of the things it proves.
    const block = data.snapshot.tradition_pack_release;
    assert.deepEqual(Object.keys(block).sort(), SNAPSHOT_RELEASE_KEYS,
      `the snapshot's release block is ${JSON.stringify(Object.keys(block))}`);
    assert.ok(!('id' in block), 'a uuid reached a frozen document');
    assert.equal(block.pack_key, 'stage4_http_fixture');
    assert.equal(block.release_number, 1);
    assert.equal(block.definition_schema_version, 1);
    assert.deepEqual(block.languages, ['en', 'ta']);
    // §5/D: the machine-assistance disclosure is *inside* the frozen record, so a document stays
    // self-describing even if the catalogue behind it is gone tomorrow.
    assert.equal(block.machine_assisted, true);
    assert.match(block.review_label, /TEST FIXTURE REVIEW — NOT A REAL CULTURAL REVIEW/);

    const opening = data.snapshot.sections.items.find((s) => s.section_key === 'opening');
    assert.equal(opening.body_source, 'reviewed_pack');
    assert.equal(opening.body_text, 'With the goodwill of both families.');
    assert.equal(opening.overrode_pack_text, false);
    assert.equal(opening.host_field, 'welcome');

    // The pin is a row, not an answer: read it back from the version the API created, because a
    // snapshot that merely *describes* a release is a different fact from a version that names one.
    const row = await client('hostA').from('invitation_versions')
      .select('id, version_number, tradition_pack_release_id, snapshot_schema_version')
      .eq('id', data.version_id).single();
    assert.equal(row.error, null, row.error?.message);
    assert.equal(row.data.tradition_pack_release_id, REL.r1);
    assert.equal(row.data.snapshot_schema_version, 2);

    hosts.pin = { versionId: data.version_id, snapshot: data.snapshot };
  });

  test('FRZ-03 (case 24) the host replaces a reviewed section and the snapshot says `host`, not a blend', async () => {
    const { error: editErr } = await client('hostA').from('invitation_drafts')
      .update({ content: { welcome: 'Written by the family, in their own words.' } })
      .eq('wedding_id', hosts.wedEn.id);
    assert.equal(editErr, null, editErr?.message);

    const { data, error } = await freeze('hostA', hosts.wedEn.id);
    assert.equal(error, null, error?.message);
    const opening = data.snapshot.sections.items.find((s) => s.section_key === 'opening');
    assert.equal(opening.body_source, 'host',
      'a host paragraph kept the pack\'s provenance, which is §12\'s false-provenance case');
    assert.equal(opening.overrode_pack_text, true);
    // §12: "do not store reviewed_pack but modified by host". The words live in `draft` once, and
    // the section points at the field, so a version cannot hold two spellings of one paragraph.
    assert.equal(opening.body_text, null);
    assert.equal(data.snapshot.draft.welcome, 'Written by the family, in their own words.');
    // `language` and `fallback_used` describe which reviewed node a pack string came from. The
    // platform does not know what language a host typed, so a host body carries neither.
    assert.equal(opening.body_language, null);
    assert.equal(opening.body_fallback_used, null);
    hosts.v2 = data;
  });

  test('FRZ-04 (cases 19, 20) no HTTP route can freeze from a draft or a reviewed release', async () => {
    // 19/20 cannot be reached by their own name: the freeze gate reads the release the wedding
    // currently selects, and SEL-03 refused that selection for both states. What is checkable from
    // here is that there is no *other* door — a caller cannot hand `create_invitation_version` a
    // release id, and cannot write the version row directly.
    const withReleaseArg = await api('hostA').rpc('create_invitation_version', {
      p_wedding_id: hosts.wedEn.id, p_tradition_pack_release_id: REL.draft,
    });
    assert.equal(withReleaseArg.error?.code, 'PGRST202',
      `a freeze accepted a release argument: ${JSON.stringify(withReleaseArg.error)}`);

    const forged = await write('POST', 'invitation_versions', '', {
      wedding_id: hosts.wedEn.id, version_number: 999, snapshot: {}, snapshot_schema_version: 2,
      tradition_pack_release_id: REL.draft, created_by: hosts.hostA.userId,
    }, { as: 'hostA' });
    assert.equal(forged.body?.code, '42501', JSON.stringify(forged.body));
    const left = sqlRows(`select count(*) from public.invitation_versions
                           where tradition_pack_release_id = '${REL.draft}'
                              or tradition_pack_release_id = '${REL.reviewed}'`);
    assert.deepEqual(left, ['0']);

    // Control: the same POST shape for a release that *is* approved is refused just as hard, so
    // the two refusals above are the grant and not an accident of the payload.
    const forgedApproved = await write('POST', 'invitation_versions', '', {
      wedding_id: hosts.wedEn.id, version_number: 998, snapshot: {}, snapshot_schema_version: 2,
      tradition_pack_release_id: REL.r1, created_by: hosts.hostA.userId,
    }, { as: 'hostA' });
    assert.equal(forgedApproved.body?.code, '42501');
  });

  test('FRZ-05 (cases 25, 26, 27, 28) language resolution, and the two ways a missing translation answers', async () => {
    // 26: a release that covers Tamil, asked in Tamil, resolves in Tamil with no fallback.
    await pointAt('hostA', hosts.wedTa.id, REL.r1);
    const ta = await freeze('hostA', hosts.wedTa.id);
    assert.equal(ta.error, null, ta.error?.message);
    const taOpening = ta.data.snapshot.sections.items.find((s) => s.section_key === 'opening');
    assert.equal(taOpening.body_language, 'ta');
    assert.equal(taOpening.body_fallback_used, false);
    assert.equal(taOpening.heading_language, 'ta');
    assert.equal(ta.data.snapshot.sections.requested, 'ta');

    // 27: the same question of a release whose Tamil is missing, where the fallback is declared.
    await pointAt('hostA', hosts.wedMint.id, REL.gapFallback);
    const gap = await client('hostA').from('weddings')
      .update({ primary_language: 'ta' }).eq('id', hosts.wedMint.id);
    assert.equal(gap.error, null, gap.error?.message);
    const fb = await freeze('hostA', hosts.wedMint.id);
    assert.equal(fb.error, null, fb.error?.message);
    const fbOpening = fb.data.snapshot.sections.items.find((s) => s.section_key === 'opening');
    assert.equal(fbOpening.body_language, 'en');
    assert.equal(fbOpening.body_fallback_used, true,
      'a substituted string was frozen without saying it was substituted');
    assert.equal(fbOpening.heading_fallback_used, true);

    // 28: the same hole with the fallback refused. This is the case where a silent English
    // invitation would be the easy answer, and §17 asks for a validation issue instead.
    const locked = await pointAt('hostA', hosts.wedMint.id, REL.gapLocked);
    assert.equal(locked.status, 200, JSON.stringify(locked.body));
    const refused = await freeze('hostA', hosts.wedMint.id);
    assert.equal(refused.error?.code, '23514', JSON.stringify(refused.error));
    assert.match(refused.error.message,
      /section opening is required and has no wording in ta, and the release does not allow it to fall back/);
    // Control inside the same test: the sibling release, same wedding, same language, freezes.
    await pointAt('hostA', hosts.wedMint.id, REL.gapFallback);
    const ok = await freeze('hostA', hosts.wedMint.id);
    assert.equal(ok.error, null, JSON.stringify(ok.error));

    // A release that does not cover the invitation's language at all is named rather than
    // half-resolved: the same wedding, moved to English, cannot freeze from a Tamil-only ask.
    const wrongLang = await client('hostA').from('weddings')
      .update({ primary_language: 'ml' }).eq('id', hosts.wedTa.id);
    assert.equal(wrongLang.error, null, wrongLang.error?.message);
    const ml = await freeze('hostA', hosts.wedTa.id);
    assert.match(ml.error.message, /the invitation language ml is not one of the languages this release covers/);
    await client('hostA').from('weddings').update({ primary_language: 'ta' }).eq('id', hosts.wedTa.id);
  });

  test('FRZ-06 (cases 21, 22) a release retired after it was chosen refuses a new freeze and leaves the published one alone', async () => {
    // The one scenario that cannot be idempotent: deprecation is one-way, so this journey needs a
    // release nobody else can use. `stage4_mint_release.sql` writes it through the same trusted
    // route as the seed, one per run, and the residue is printed by the `after` hook.
    const minted = randomUUID();
    const lines = trustedFile('supabase/tests/api/fixtures/stage4_mint_release.sql',
      { rid: minted });
    assert.ok(UUID.test(minted));
    const landed = lines.find((l) => l.includes(' | '));
    assert.ok(landed, `the mint printed no row: ${lines.join(' / ')}`);
    const [id, number, status] = landed.split(' | ');
    assert.equal(id, minted);
    assert.equal(status, 'approved', 'the mint did not reach the state the journey starts from');
    assert.ok(Number(number) > 3, `the mint was numbered ${number} inside a pack that has three fixed fixture releases`);

    const chose = await pointAt('hostA', hosts.wedMint.id, minted);
    assert.equal(chose.status, 200, JSON.stringify(chose.body));
    const first = await freeze('hostA', hosts.wedMint.id);
    assert.equal(first.error, null, first.error?.message);
    assert.equal(first.data.snapshot.tradition_pack_release.release_number, Number(number));

    const pub = await api('hostA').rpc('publish_invitation_version', {
      p_wedding_id: hosts.wedMint.id, p_version_id: first.data.version_id, p_expires_at: null,
    });
    assert.equal(pub.error, null, pub.error?.message);
    const token = pub.data.path.slice('/i/'.length);
    const before = await resolveAs(token);
    assert.equal(before.status, 200);

    // Retire it. No HTTP route does this — that absence is the design, and it is the reason this
    // one statement is trusted rather than called.
    trustedSql(`update public.tradition_pack_releases
                   set status = 'deprecated', deprecated_at = now()
                 where id = '${minted}' and status = 'approved'`);

    // 21: a NEW freeze from it is refused, by name, at the freeze gate rather than the selection
    // gate — the wedding is still pointing at it, which is exactly the state ruling A1 is about.
    const again = await freeze('hostA', hosts.wedMint.id);
    assert.equal(again.error?.code, '42501', JSON.stringify(again.error));
    assert.match(again.error.message,
      /^a new invitation version may only be frozen from an approved tradition pack release \(this one is deprecated\); a version already frozen from it is unaffected$/);
    // Control inside the same statement: the *selection* gate's sentence is different, so the two
    // rulings are visibly two gates and not one message reused.
    const selectRefusal = await pointAt('hostB', hosts.wedNoPack.id, minted);
    assert.match(selectRefusal.body.message, /^a wedding may only select an approved/);

    // 22: the document a guest was given does not move when the catalogue does.
    const after = await resolveAs(token);
    assert.equal(after.status, 200, JSON.stringify(after.body));
    assert.deepEqual(after.body, before.body,
      'a published invitation changed because the release behind it was retired');
    assert.equal(after.body.invitation.tradition_pack.release_number, Number(number));
    hosts.mintToken = token;
    hosts.mintRelease = { id: minted, number: Number(number) };
  });

  test('FRZ-06b (ruling A1, readable half, over HTTP) the retired release this wedding still points at stays readable to its owner and to nobody else', async () => {
    // The state SEL-06 proved cannot be written by anybody — selected while approved, retired
    // afterwards — grown by the journey above. Ruling A1 asks for a deprecated release to remain
    // referenced "for historical visibility", and §17's editor note ("the pack you chose has been
    // retired") needs the row, not just its uuid. Two halves, both measured here: the owning host
    // can read it, and another host cannot read it just because it exists.
    const { id: minted, number } = hosts.mintRelease;
    const mine = await read('tradition_pack_releases',
      `id,release_number,status&pack_id=eq.${PACK.main}&order=release_number.asc`, { as: 'hostA' });
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    const retiredRow = mine.body.find((r) => r.id === minted);
    assert.deepEqual([retiredRow?.release_number, retiredRow?.status], [number, 'deprecated'],
      'the editor cannot say "this pack was retired", because the release the wedding points at is not readable');

    // The same release, asked for by the customer who never selected it. The control inside the
    // same statement is the two approved seeds, which host B does see.
    const theirs = await read('tradition_pack_releases',
      `id,release_number,status&pack_id=eq.${PACK.main}&order=release_number.asc`, { as: 'hostB' });
    assert.equal(theirs.status, 200, JSON.stringify(theirs.body));
    assert.ok(!theirs.body.some((r) => r.id === minted),
      'a retired release leaked to a customer whose wedding never pointed at it');
    // Pinned by the seed ids rather than by a release-number set: this pack accumulates a minted
    // release every time the journey above runs, so "host B sees exactly two rows" would be a
    // claim about how many times this file has been executed. What it is a claim about is the
    // shape of host B's answer — the approved seeds are in it, and nothing retired is.
    const theirsIds = theirs.body.map((r) => r.id);
    assert.ok(theirsIds.includes(REL.r1) && theirsIds.includes(REL.r2),
      'the approved catalogue host B reads is missing the seed rows');
    assert.deepEqual([...new Set(theirs.body.map((r) => r.status))], ['approved'],
      'a non-approved status reached a customer who never selected it');

    // The picker's own read — the exact query `listSelectableTraditionReleases` issues — still
    // excludes it, so "readable" here is historical visibility and not a second way to select it.
    const offered = await read('tradition_pack_releases',
      `id&status=eq.approved&pack_id=eq.${PACK.main}`, { as: 'hostA' });
    assert.ok(!offered.body.map((r) => r.id).includes(minted),
      'the picker offered a retired release');

    // And the one way out of a retired selection, measured on the way: a wedding may be moved *off*
    // it. Nothing can move it onto one (SEL-06), so this is the only transition the state has.
    const cleared = await pointAt('hostA', hosts.wedMint.id, null);
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    const afterClear = await read('tradition_pack_releases',
      `id,status&pack_id=eq.${PACK.main}`, { as: 'hostA' });
    assert.ok(!afterClear.body.some((r) => r.id === minted),
      'the retired release stayed readable after the wedding stopped pointing at it, so the row policy is keyed on something other than the selection');
    // Control in the same answer: the approved seeds are still there for the same role, so the row
    // disappearing above is the policy losing a subject rather than the read losing everything.
    const stillThere = afterClear.body.map((r) => r.id);
    assert.ok(stillThere.includes(REL.r1) && stillThere.includes(REL.r2),
      'clearing the selection also removed the approved catalogue');
  });

  test('FRZ-07 (cases 22, 30) the guest reads a frozen snapshot and nothing else, and an unknown section kind is a refusal rather than a half-document', async () => {
    const pub = await api('hostA').rpc('publish_invitation_version', {
      p_wedding_id: hosts.wedEn.id, p_version_id: hosts.pin.versionId, p_expires_at: null,
    });
    assert.equal(pub.error, null, pub.error?.message);
    const token = pub.data.path.slice('/i/'.length);
    const r1 = await resolveAs(token);
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r1.body.available, true);

    // §11's sentence, measured: the guest answer is reproducible from `snapshot` alone. Move the
    // wedding off the pack and the *wording of the published document* does not change by one byte.
    const moved = await pointAt('hostA', hosts.wedEn.id, null);
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const r2 = await resolveAs(token);
    assert.deepEqual(r2.body, r1.body,
      'the guest page moved when the wedding\'s selection moved, so the invitation is not being read from its snapshot');

    // Then publish the *newer* version and show the same link following the publication rather
    // than the first freeze — the pair of assertions that makes the one above a measurement of
    // `invitation_versions.snapshot` rather than of a page that never reads anything.
    const v2 = await api('hostA').rpc('publish_invitation_version', {
      p_wedding_id: hosts.wedEn.id, p_version_id: hosts.v2.version_id, p_expires_at: null,
    });
    assert.equal(v2.error, null, v2.error?.message);
    assert.equal(v2.data.link_reused, true, 'a second publish minted a second credential');
    const r3 = await resolveAs(token);
    assert.notDeepEqual(r3.body, r1.body);
    assert.equal(r3.body.invitation.welcome, 'Written by the family, in their own words.');
    assert.equal(r3.body.invitation.sections.items.find((s) => s.section_key === 'opening').body.source,
      'host');
    // And the retired-release link from FRZ-06 is unaffected by all of this.
    if (hosts.mintToken) {
      const still = await resolveAs(hosts.mintToken);
      assert.equal(still.status, 200, JSON.stringify(still.body));
    }

    // 30: a frozen snapshot that claims a kind this build has no renderer for. Nothing reachable
    // through the API can write such a snapshot — the guard refuses the definition and the freeze
    // builds the snapshot itself, and both read the same three-kind vocabulary — so the only way to
    // *have* one is to rewrite a frozen snapshot behind the API's back. That is what follows, and
    // it measures §12's split rather than one refusal: an unknown section the document marks
    // REQUIRED takes the whole guest answer down, because a promise this build cannot draw is a
    // promise the page would be making falsely. An unknown section that is OPTIONAL does not: it
    // keeps its identity in the projection and carries no content, so the rest of the invitation
    // still reaches the guest.
    //
    // The item below carries all thirteen keys a freeze writes (migration `resolve_invitation_
    // sections`'s output object) rather than the four a hand-written literal would give it, so the
    // only thing the tamper changes is the one fact under test — the value of `kind` — and the
    // required flag. `jsonb_build_object` rather than a JSON string literal, because a JSON text
    // split across operands is parsed as jsonb before the concatenation and fails on syntax.
    const tampered = hosts.v2.version_id;
    const tamperWith = (required) => trustedSql(`update public.invitation_versions
         set snapshot = jsonb_set(snapshot::jsonb, '{sections,items}',
               ((select coalesce(jsonb_agg(i), '[]'::jsonb)
                   from jsonb_array_elements(snapshot::jsonb -> 'sections' -> 'items') i
                  where i ->> 'kind' in ('text','people_list','event_list')))
             || jsonb_build_array(jsonb_build_object(
                  'section_key', 'ritual', 'position', 9, 'kind', 'ritual_sequence',
                  'required', ${required ? 'true' : 'false'}::boolean, 'host_field', null,
                  'heading_text', 'A section this build cannot draw',
                  'heading_language', 'en', 'heading_fallback_used', false,
                  'body_text', 'Words no renderer in this build will reach.',
                  'body_source', 'reviewed_pack', 'body_language', 'en',
                  'body_fallback_used', false, 'overrode_pack_text', false)))
       where id = '${tampered}'`);
    const cleanTamper = () => trustedSql(`update public.invitation_versions
         set snapshot = jsonb_set(snapshot::jsonb, '{sections,items}',
               (select coalesce(jsonb_agg(i), '[]'::jsonb)
                  from jsonb_array_elements(snapshot::jsonb -> 'sections' -> 'items') i
                 where i ->> 'kind' in ('text','people_list','event_list')))
       where id = '${tampered}'`);

    const baseline = r3.body;
    tamperWith(true);
    const refused = await resolveAs(token);
    assert.equal(refused.status, 200, JSON.stringify(refused.body));
    assert.deepEqual(refused.body, { available: false },
      'an unknown REQUIRED section kind was answered with something other than the one refusal shape');
    assert.ok(!JSON.stringify(refused.body).includes('ritual_sequence'),
      'the refusal named the kind it could not draw, so a stranger learned about a future contract');

    tamperWith(false);
    const partial = await resolveAs(token);
    assert.equal(partial.status, 200, JSON.stringify(partial.body));
    assert.equal(partial.body.available, true,
      'an unknown OPTIONAL section kind took the whole guest document down, so the required/optional split is not being measured');
    const items = partial.body.invitation.sections.items;
    assert.equal(items.length, baseline.invitation.sections.items.length + 1,
      'the optional unknown section was dropped rather than drawn inert');
    const inert = items[items.length - 1];
    assert.equal(inert.kind, 'ritual_sequence',
      'an inert section hid the kind it could not draw, so a later build could not tell what was skipped');
    assert.equal(inert.section_key, 'ritual');
    assert.equal(inert.position, 9);
    assert.equal(inert.required, false);
    assert.equal(inert.host_field, null);
    assert.equal(inert.heading, null);
    assert.equal(inert.body, null);
    // The text of the section a build cannot draw is not in the answer at all — only its name.
    assert.ok(!JSON.stringify(partial.body).includes('Words no renderer'),
      'an inert section still shipped the body text to a browser that could not place it');
    assert.ok(!JSON.stringify(partial.body).includes('A section this build cannot draw'),
      'an inert section still shipped the heading text to a browser that could not place it');
    // And the document around it is untouched: the same known sections, in the same order, with
    // the same wording as the answer measured one statement earlier.
    assert.deepEqual(items.slice(0, -1), baseline.invitation.sections.items,
      'adding an optional unknown section changed the sections around it');

    // Control: the same link answers the full document once the unknown section is removed, so the
    // refusal and the inert arm above both came from the projection and not from a broken link, a
    // revoked token, or a snapshot the tamper had damaged past repair.
    cleanTamper();
    const restored = await resolveAs(token);
    assert.deepEqual(restored.body, baseline,
      'the snapshot did not round-trip back to the exact answer it gave before the tamper');
  });
});

// ---------------------------------------------------------------------------
// The guest's answer, and the hostile-input half
// ---------------------------------------------------------------------------
describe('§17 PROVENANCE AND SECURITY', () => {
  test('GST-01 (case 25) the guest document carries no reviewer, authorship, machine-disclosure or maintenance field', async () => {
    const token = hosts.mintToken ?? (await publishFresh());
    const r = await resolveAs(token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const text = JSON.stringify(r.body);

    for (const name of INTERNAL_COLUMNS) {
      assert.ok(!text.includes(`"${name}"`), `${name} appeared in the guest document`);
    }
    for (const phrase of ['TEST FIXTURE REVIEW', 'NOT A REAL CULTURAL REVIEW',
      'Automated Stage 4', 'synthetic fixture release', 'No human reader of Tamil',
      'machine_assisted', 'reviewed_languages']) {
      assert.ok(!text.includes(phrase),
        `a maintenance-only string reached a stranger's browser: ${phrase}`);
    }
    // The three-key credit line is the whole of what a guest is told about the pack, and its
    // exact shape is the claim §12 makes.
    assert.deepEqual(Object.keys(r.body.invitation.tradition_pack).sort(),
      ['display_name', 'pack_key', 'release_number']);
    // The definition itself — every string the pack holds, in both languages — is not in the
    // document either; only the resolved sections are.
    assert.ok(!text.includes('event_vocabulary'));
    assert.ok(!text.includes('allow_english_fallback'));
  });

  test('GST-02 (cases 38, 39) hostile text stays text, and an unsafe link does not survive the contract', async () => {
    const hostile = '<img src=x onerror="alert(1)"> & <script>alert(\'hi\')</script> "quotes"';
    const { error: editErr } = await client('hostB').from('invitation_drafts')
      .update({ content: { welcome: hostile } }).eq('wedding_id', hosts.wedNoPack.id);
    assert.equal(editErr, null, editErr?.message);

    // 39, first line of defence, measured: the transport refuses the unsafe link before it is
    // ever frozen. `venues_map_url_check` allows https or nothing, and PostgREST hands back the
    // check violation as its own ERRCODE with no hint — a governance-shaped refusal, not a
    // missing-grant refusal.
    const unsafe = await client('hostB').from('venues').insert({
      wedding_id: hosts.wedNoPack.id, name: 'A hall', address_text: 'Somewhere',
      map_url: 'javascript:alert(1)',
    });
    assert.equal(unsafe.error?.code, '23514', JSON.stringify(unsafe.error));
    assert.equal(unsafe.error.hint, null, JSON.stringify(unsafe.error));
    // Positive control in the same statement: the only difference is the scheme, and it lands.
    const { data: safeVenue, error: safeErr } = await client('hostB').from('venues').insert({
      wedding_id: hosts.wedNoPack.id, name: 'A hall', address_text: 'Somewhere',
      map_url: 'https://maps.example.test/a-hall',
    }).select('id, map_url').single();
    assert.equal(safeErr, null, safeErr?.message);
    assert.equal(safeVenue.map_url, 'https://maps.example.test/a-hall');

    const { error: cErr } = await client('hostB').from('wedding_events').insert({
      wedding_id: hosts.wedNoPack.id, event_key: 'reception', display_name: 'Reception',
      starts_at_local: '2026-12-01T18:00:00', venue_id: safeVenue.id,
    });
    assert.equal(cErr, null, cErr?.message);

    const v = await freeze('hostB', hosts.wedNoPack.id);
    assert.equal(v.error, null, v.error?.message);
    const p = await api('hostB').rpc('publish_invitation_version', {
      p_wedding_id: hosts.wedNoPack.id, p_version_id: v.data.version_id, p_expires_at: null });
    assert.equal(p.error, null, p.error?.message);
    const token = p.data.path.slice('/i/'.length);

    const r = await resolveAs(token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // The hostile string comes back as a JSON string and nothing else: no new key, no attribute,
    // no rewritten shape. Neutralising it is the renderer's job and is qualified by
    // `invitationRenderer.test.tsx` and the browser sweep; what this case owns is that the
    // transport hands the same string to every reader.
    assert.equal(r.body.invitation.welcome, hostile);
    const welcomeSection = r.body.invitation.sections.items
      .find((s) => s.section_key === 'welcome');
    assert.equal(welcomeSection.body.source, 'host');
    assert.equal(welcomeSection.body.text, hostile);
    assert.deepEqual(Object.keys(welcomeSection).sort(),
      ['body', 'heading', 'host_field', 'kind', 'position', 'required', 'section_key']);
    assert.equal(r.body.invitation.events[0].venue.map_url, 'https://maps.example.test/a-hall',
      'the one safe link the host gave was dropped, so the nulling below would be a blanking bug');
    assert.deepEqual(Object.keys(r.body.invitation.events[0].venue).sort(),
      ['address_text', 'map_url', 'name']);

    // 39, second line: a snapshot that *already* holds an unsafe link — which is what a document
    // frozen before the constraint existed looks like — is answered by the projection, not by the
    // writer. Nothing reachable over the API produces this state, so it is created the only honest
    // way left: behind the API's back, on a row this suite owns, and undone two statements later.
    const tamperedId = v.data.version_id;
    trustedSql(`update public.invitation_versions
                  set snapshot = jsonb_set(snapshot::jsonb,
                        '{events,0,venue,map_url}', '"javascript:alert(1)"'::jsonb)
                where id = '${tamperedId}'`);
    const nulled = await resolveAs(token);
    assert.equal(nulled.status, 200, JSON.stringify(nulled.body));
    assert.equal(nulled.body.available, true,
      'an unsafe link voided the whole document instead of being dropped on its own');
    assert.equal(nulled.body.invitation.events[0].venue.map_url, null,
      'a javascript: URL survived the public contract');
    assert.ok(!JSON.stringify(nulled.body).includes('javascript:'), JSON.stringify(nulled.body));
    // Control: the same link answers the safe URL again the moment the tampering is reversed, so
    // the null above is `map_link_or_null` and not a broken projection.
    trustedSql(`update public.invitation_versions
                  set snapshot = jsonb_set(snapshot::jsonb,
                        '{events,0,venue,map_url}', '"https://maps.example.test/a-hall"'::jsonb)
                where id = '${tamperedId}'`);
    const restored = await resolveAs(token);
    assert.equal(restored.body.invitation.events[0].venue.map_url, 'https://maps.example.test/a-hall');
  });

  test('GST-03 (case 40) identity and language fields never move a pack selection', async () => {
    const before = await client('hostA').from('weddings')
      .select('id, tradition_pack_release_id, primary_language').eq('id', hosts.wedEn.id).single();
    assert.equal(before.error, null, before.error?.message);

    // A Tamil name, a Tamil-named venue, a community-shaped group label, and a language change:
    // every field a system could be tempted to infer a tradition from, written by the owner.
    const { error: pErr } = await client('hostA').from('wedding_people').insert({
      wedding_id: hosts.wedEn.id, display_name: 'முத்துலட்சுமி', role_key: 'father',
      role_label: 'Father', group_key: 'iyengar', group_label: "The groom's community",
    });
    assert.equal(pErr, null, pErr?.message);
    // `weddings_check` refuses a language in its own additional list, so the control write is
    // measured against the real constraint: Tamil primary, English as the secondary.
    const { error: lErr } = await client('hostA').from('weddings')
      .update({ primary_language: 'ta', additional_languages: ['en'] })
      .eq('id', hosts.wedEn.id);
    assert.equal(lErr, null, lErr?.message);

    const after = await client('hostA').from('weddings')
      .select('id, tradition_pack_release_id, primary_language').eq('id', hosts.wedEn.id).single();
    assert.equal(after.data.tradition_pack_release_id, before.data.tradition_pack_release_id,
      'the selection moved on its own: something inferred a tradition from identity data');
    assert.equal(after.data.primary_language, 'ta',
      'the control failed — the language write itself did not land, so the comparison above proves nothing');

    // And the same in the other direction: a wedding with no pack stays with no pack however many
    // identity-shaped rows it accumulates.
    const { error: p2 } = await client('hostB').from('wedding_people').insert({
      wedding_id: hosts.wedNoPack.id, display_name: 'A. Krishnan', role_key: 'groom',
      role_label: 'Groom', group_key: 'chettiar', group_label: 'Family',
    });
    assert.equal(p2, null, p2?.message);
    const np = await client('hostB').from('weddings')
      .select('tradition_pack_release_id').eq('id', hosts.wedNoPack.id).single();
    assert.equal(np.data.tradition_pack_release_id, null);
  });

  test('LEDGER-01 the fixture catalogue this run read and left behind', async () => {
    // §31's "no synthetic releases" is not satisfiable for a release that has been approved — the
    // guard refuses the DELETE, which is ruling A2 and the point of the lifecycle. So the residue
    // is named here instead of being asserted away, and the count is a measurement rather than a
    // promise: it is read from the database at the end of the run.
    const rows = sqlRows(`select p.pack_key || ' ' || r.release_number || ' ' || r.status
        from public.tradition_pack_releases r join public.tradition_packs p on p.id = r.pack_id
        where p.pack_key like 'stage4_http_%' order by 1`);
    assert.ok(rows.length >= 8, `the fixture catalogue shrank to ${rows.length} rows`);
    assert.ok(rows.some((r) => r.startsWith('stage4_http_fixture')), rows.join('\n'));
  });
});

// ---------------------------------------------------------------------------
// helpers used by more than one describe block
// ---------------------------------------------------------------------------
async function publishFresh() {
  const v = await api('hostA').rpc('create_invitation_version', { p_wedding_id: hosts.wedTa.id });
  assert.equal(v.error, null, v.error?.message);
  const p = await api('hostA').rpc('publish_invitation_version', {
    p_wedding_id: hosts.wedTa.id, p_version_id: v.data.version_id, p_expires_at: null });
  assert.equal(p.error, null, p.error?.message);
  return p.data.path.slice('/i/'.length);
}

/** The guest's transport, spelled out rather than hidden behind a library: the credential is a
 *  request header and the call names no argument, which is what makes "the token is not in a URL"
 *  a property of this suite's own requests. */
async function resolveAs(token) {
  const res = await fetch(`${url}/rest/v1/rpc/resolve_public_invitation`, {
    method: 'POST',
    headers: {
      apikey: anonKey, 'Content-Type': 'application/json', 'Content-Profile': 'api',
      'x-invitation-token': token,
    },
    body: '{}',
  });
  return { status: res.status, body: await json(res) };
}
