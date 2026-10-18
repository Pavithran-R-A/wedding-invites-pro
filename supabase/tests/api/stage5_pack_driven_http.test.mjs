// Stage 5 §23 — the pack-driven authoring contract, qualified as an HTTP journey.
//
// `supabase/tests/stage5/*.sql` proves the same rules with `SET ROLE` inside psql, in a cluster
// built from zero on every run, and it does that better than this file can: a guard's ERRCODE, a
// review binding recomputed at one edge, an override rule's four-way resolution and the eight issue
// arms are all facts about functions, and the battery walks them argument by argument. What that
// battery cannot see is the transport. It never had Kong turning an API key into a role, never had
// PostgREST choosing which columns a request may name, never had a JWT carrying `auth.uid()` into a
// governance trigger, never had a response that has to survive being walked for a field it should
// never have carried, and — the half §M was incomplete about — it never once asked whether the
// document a host previews is the document a guest is later given.
//
// So this file is the transport, on version-2 material. That last clause is not a flourish: every
// preview arm §23 asks for (`required_list_empty`, `event_venue_missing`,
// `host_override_not_permitted`) sits behind `IF v_dsv >= 2` inside
// `private.invitation_issue_records`, so a battery that selected a Stage 4 fixture release would
// read a clean verdict on a document that is only clean because the contract it was resolved
// against predates the checks. `fixtures/stage5_http_pack.sql` therefore authors version-2 releases
// rather than only asserting about them.
//
// Where a case cannot be reached over HTTP, that is reported here rather than quietly dropped:
//
//   * A `contract_unsupported` refusal. A release with `definition_schema_version = 3` cannot exist:
//     the guard refuses any version other than 1 or 2 at write time, so no HTTP caller can ever be
//     holding one, and the only way to the arm is to hand the checker a snapshot directly — which is
//     what `70_document_resolution.sql` group L does.
//   * A `kind_unrenderable` refusal at freeze time, for the same reason: `kind` is validated on every
//     write against the same three-word vocabulary the checker reads, so the two cannot disagree.
//     `50_pack_release.sql` group R12 measures the arm itself.
//   * The review-packet digest's *content*. `review_packet_hash` is assigned by the trigger at
//     draft → reviewed, so what is measurable from here is that no caller can write it, alter it or
//     read it — `WRT-02` and `WRT-03` — while the digest's equality with the material in front of a
//     reviewer is `50_review_binding.sql`.
//   * "Approve the Tamil candidate." Deliberately absent, per §23. The candidate
//     (`content/tradition-packs/tamil-english-foundation.v1.json`) is not read, written, selected,
//     frozen or moved by this file, and RET-05 checks that it is still a draft at the end of the run.
//
// Not part of `npm test`; run it with `bash supabase/tests/api/run.sh`, which checks the stack is
// this repository's own before this file is loaded.
//
// Error codes and messages below are measured against this stack (PostgREST v16.3, Kong 2.8.1,
// GoTrue v2.197.0, PostgreSQL 17.6) with a throwaway probe of the deployed functions, not guessed:
//   an invisible release, selected ....... 403, 42501, "a wedding may only select an approved
//                                         tradition pack release (this one is not readable by this
//                                         role)" — and a well-formed uuid that exists nowhere gives
//                                         the identical sentence, because the BEFORE trigger answers
//                                         before the foreign key does. CAT-05 is the no-oracle claim.
//   a blocking issue at freeze time ...... 400, check_violation, "this invitation cannot be frozen
//                                         yet: " + the blocking sentences, sorted
//   a caller who does not own the
//     wedding ............................ 403, 42501, "the caller may not preview this wedding"
//   an RPC that lives in a schema PostgREST does not
//     serve .............................. 404, PGRST202, naming `public.<name>` — with no
//                                          `Content-Profile` the call is answered by the schema
//                                          allowlist's *default*, so "not found" here is PostgREST
//                                          saying it looked in the wrong door, not that the function
//                                          is missing. Naming the schema is the other refusal:
//   Content-Profile: internal_api ........ 406, PGRST106, "Only the following schemas are exposed:
//                                          public, api"
//   a column a role may not name ......... the same "permission denied for table" as a missing
//                                          table grant, because PostgREST cannot tell them apart
//   an update RLS did not match .......... 200 with an empty array under `return=representation`
//   the guest document ................... {available, invitation}, and `invitation` is
//                                          byte-identical to the preview's `invitation` for the same
//                                          selection — PRV/FRZ/PUB measure that equality, which is
//                                          what §M was missing.
//
// The fixture rows this file reads are committed on purpose, and they are all TEST ONLY.
// `fixtures/stage5_http_pack.sql` explains why a rollback-based fixture cannot serve a running
// PostgREST; `fixtures/stage5_mint_pair.sql` explains why the retirement journey mints its own pack
// every run. RET-05 prints what each run leaves behind.

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

const RUN_TAG = process.env.STAGE5_HTTP_RUN_TAG
  ?? `stage5http-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// The tag is interpolated into trusted cleanup statements below, so an inherited value is only
// accepted if it is the shape this file generates.
if (!/^[a-z0-9-]+$/.test(RUN_TAG)) {
  throw new Error(`refusing to run: STAGE5_HTTP_RUN_TAG=${RUN_TAG} is not a run tag`);
}

// A pack_key must be unique and match `^[a-z][a-z0-9]*(_[a-z0-9]*)*$`. The run tag carries hyphens,
// so the minted key is built from the tag with them collapsed to underscores — derived rather than
// re-randomised, so a crashed run's residue is traceable to the run that left it.
const PACK_SLUG = RUN_TAG.replace(/[^a-z0-9]+/g, '_').replace(/^_+/, '');
const MINT_KEY = `stage5_retire_${PACK_SLUG}`.slice(0, 63);
if (!/^[a-z][a-z0-9]*(_[a-z0-9]*)*$/.test(MINT_KEY)) {
  throw new Error(`refusing to run: ${MINT_KEY} is not a pack_key slug`);
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
// Named rather than derived, as in the Stage 4 file: this suite writes rows into a *persistent*
// local database, so the one place a mis-named project can be caught by a string rather than by a
// port number is here.
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

/** A trusted read against *this project's own* container — no network, and every statement below is
 *  scoped to a run tag, a validated uuid, or both. */
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
 *  statement that *succeeded* has to fail the test in a way that says so. The statement is still
 *  passed as one argv element to `docker exec`, so nothing here is a shell. */
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

/** One of this suite's fixture files, applied through the same trusted route. Returns the lines the
 *  file printed, so a setup step is read rather than assumed. `\r` is stripped at the boundary for
 *  the reason `supabase/tests/stage5/run.sh` records: a Windows checkout can hand back CRLF and psql
 *  keeps those bytes inside dollar-quoted literals. */
function trustedFile(rel, vars = {}) {
  const bytes = readFileSync(resolve(ROOT, rel)).toString('utf8').replace(/\r/g, '');
  const args = ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-tA', '-F', '|'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  args.push('-f', '-');
  const out = execFileSync('docker', args, { input: bytes, encoding: 'utf8' });
  return out.split(/\r?\n/).filter((line) => line.startsWith('FIXTURE-'));
}

const people = {};
const client = (who) => people[who].client;
const api = (who) => people[who].client.schema('api');
const anonApi = () => createClient(url, anonKey, { auth: { persistSession: false } }).schema('api');
const uid = (who) => people[who].userId;

async function signUp(who) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: emailFor(who), password: PASSWORD });
  assert.equal(error, null, `signup failed for ${who}`);
  assert.ok(data.session, 'expected a session immediately');
  return { client: c, userId: data.user.id };
}

/** A read as a named role, spelled out because §23's write-security cases are about which *column*
 *  a role may name, and a client library that quietly asked for another one would ruin the
 *  measurement. */
async function read(rel, select, { as = 'anon', headers = {} } = {}) {
  const res = await fetch(`${url}/rest/v1/${rel}?select=${select}`, {
    headers: { apikey: keyFor(as), Authorization: `Bearer ${jwtFor(as)}`, ...headers },
  });
  return { status: res.status, body: await json(res) };
}

const keyFor = (as) => (as === 'anon' ? anonKey : people[as].client.supabaseKey);
const jwtFor = (as) => (as === 'anon' ? anonKey : people[as].token);

async function json(res) {
  const text = await res.text();
  return text === '' ? null : JSON.parse(text);
}

/** One write, with the response representation asked for explicitly: a 204 that says nothing and a
 *  200 that says which row moved are two different measurements, and the second is the one that
 *  distinguishes "refused" from "accepted someone else's row". */
async function write(method, rel, query, body, { as = 'anon', represent = true } = {}) {
  const res = await fetch(`${url}/rest/v1/${rel}${query}`, {
    method,
    headers: {
      apikey: keyFor(as), Authorization: `Bearer ${jwtFor(as)}`,
      'Content-Type': 'application/json',
      Prefer: represent ? 'return=representation' : 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await json(res) };
}

/** The one RPC §23's whole PREVIEW section is about, called the way the editor calls it. */
const preview = (who, weddingId) => api(who).rpc('preview_invitation_document', {
  p_wedding_id: weddingId,
});

/** The same RPC over a raw request, for the arms where the *transport's* answer is the measurement
 *  (an anonymous caller, whose refusal a client library would turn into an exception). */
async function previewRaw(token, weddingId) {
  const res = await fetch(`${url}/rest/v1/rpc/preview_invitation_document`, {
    method: 'POST',
    headers: {
      apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      'Content-Profile': 'api',
    },
    body: JSON.stringify({ p_wedding_id: weddingId }),
  });
  return { status: res.status, body: await json(res) };
}

const pointAt = (as, weddingId, releaseId) => write('PATCH', 'weddings',
  `?id=eq.${weddingId}`, { tradition_pack_release_id: releaseId }, { as });

const freeze = (who, weddingId) => api(who).rpc('create_invitation_version', {
  p_wedding_id: weddingId,
});

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

/** §11's own measure of "the bytes a guest was given": one JSON encoding of the whole response,
 *  taken before anything else happens and compared character for character afterwards. */
const bytesOf = (value) => JSON.stringify(value);

/** The catalogue's customer-visible column shapes, in one place, because three cases read them. */
const SAFE_RELEASE_COLUMNS = ['id', 'pack_id', 'release_number', 'status', 'languages',
  'definition', 'definition_schema_version'];

/** §23's eleven names, spelled as the database spells them, plus the maintenance timestamps that
 *  belong beside them. `PUB-02` searches a whole guest response for these; `WRT-02` refuses each one
 *  to `authenticated` at the HTTP layer, which is the half that stops a host asking for them. */
const INTERNAL_COLUMNS = ['review_packet_hash', 'review_label', 'review_basis', 'review_scope',
  'reviewed_by', 'reviewed_languages', 'machine_assistance_notes', 'source_reference',
  'approved_at', 'deprecated_at', 'reviewed_at', 'author_label', 'changelog',
  'created_at', 'updated_at'];

/** The raw definition's own vocabulary, which is what "no raw definition" means concretely: a guest
 *  response that carries any of these words has been handed the release rather than the document. */
const DEFINITION_WORDS = ['definition', 'pack_text', 'override_rule', 'requires_venue',
  'allow_english_fallback', 'event_vocabulary', 'design_guidance', 'heading_text'];

/** The internal identifiers a guest has no use for, including the credential it arrived on. */
const INTERNAL_ID_KEYS = ['id', 'wedding_id', 'version_id', 'publication_id', 'owner_user_id',
  'created_by', 'tradition_pack_release_id', 'venue_id', 'user_id', 'release_id', 'token'];

const PACK_KEYS = ['stage5_http_v2', 'stage5_http_draft_only', 'stage5_http_reviewed_only',
  'stage5_http_retired_only'];

/** The fixture's release ids. Deterministic because the seed writes them, and repeated here as
 *  literals rather than read from the seed's NOTICE output: a test that discovers its own subject by
 *  parsing log lines cannot tell a missing row from a changed format. */
const REL = {
  r1: 'aaaaaaaa-0005-4000-8000-000000000101',
  r2: 'aaaaaaaa-0005-4000-8000-000000000102',
  draft: 'aaaaaaaa-0005-4000-8000-000000000201',
  reviewed: 'aaaaaaaa-0005-4000-8000-000000000301',
  retiredOnly: 'aaaaaaaa-0005-4000-8000-000000000401',
};
const PACK = {
  main: 'aaaaaaaa-0005-4000-8000-000000000001',
  draftOnly: 'aaaaaaaa-0005-4000-8000-000000000002',
  reviewedOnly: 'aaaaaaaa-0005-4000-8000-000000000003',
  retiredOnly: 'aaaaaaaa-0005-4000-8000-000000000004',
};

/** The strings a guest must never see, taken from the fixture rather than invented: the review
 *  record, the machine disclosure and the provenance of the seed release. `PUB-02` searches every
 *  string *value* in the response for them, which is the half a key-name walk cannot reach — a
 *  reviewer's sentence could travel inside a field with an innocent name. */
const FORBIDDEN_VALUES = {
  review_label: 'TEST FIXTURE REVIEW — NOT A REAL CULTURAL REVIEW',
  machine_assistance_notes: 'drafted by a model from the Stage 5 section vocabulary',
  source_reference: 'supabase/tests/api/fixtures/stage5_http_pack.sql',
  author_label: 'TEST ONLY — synthetic Stage 5 fixture release',
};

/** The host's own words for a document that satisfies every v2 arm. Named, because three cases write
 *  them and one of them has to be able to say "this one is not in the guest's copy". */
const HOST = {
  closing: 'Please come and bless us on the day.',
  notSupplied: 'We wrote the family line ourselves, and it is not shown.',
  welcome: 'Asha and Bala welcome you.',
};

/** The venue each filled-out document needs. One row per wedding rather than one row shared by
 *  seven: `wedding_events` carries a composite key `(wedding_id, venue_id) -> venues(wedding_id, id)`,
 *  so a second wedding pointing at the first one's venue is refused by the database with a foreign
 *  key error (measured: 23503, "Key is not present in table \"venues\""). Measured the hard way, and
 *  the constraint is the right one — an event borrowing another couple's venue would be a data-model
 *  lie before it was a shortcut. */
const VENUE = {
  name: 'Kalyana Mantapa', address_text: '100 Pillar Road, Madurai',
  map_url: 'https://maps.example.test/kalyana-mantapa',
};

/** The wedding rows this file creates. Everything is synthetic, and the couple's names are as
 *  invented as the pack keys. */
const WEDDINGS = [
  ['incomplete', 'hostA', 'en', 'Isha weds Jai', REL.r1],
  ['venueGap', 'hostA', 'en', 'Kiran weds Leela', REL.r1],
  ['advisory', 'hostA', 'en', 'Meena weds Nikhil', REL.r1],
  ['complete', 'hostA', 'en', 'Asha weds Bala', REL.r1],
  ['taDocument', 'hostA', 'ta', 'Priya weds Ravi', REL.r1],
  ['noPack', 'hostA', 'en', 'Sana weds Tarun', null],
  ['mine', 'hostB', 'en', 'Uma weds Vinod', null],
  ['victim', 'hostB', 'en', 'Weda weds Xaviar', null],
  ['retire', 'hostA', 'en', 'Yasha weds Zaid', null],
];

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
  // The seed first, before any caller reads a catalogue: a missing release would turn every
  // "invisible" case below into a pass about a row that was never there.
  const lines = trustedFile('supabase/tests/api/fixtures/stage5_http_pack.sql');
  const ledger = lines.filter((l) => l.startsWith('FIXTURE-LEDGER|'));
  for (const key of PACK_KEYS) {
    assert.ok(ledger.some((l) => l.startsWith(`FIXTURE-LEDGER|${key}|`)),
      `refusing to run: the local stack has no fixture pack ${key}; it should hold `
      + `${PACK_KEYS.join(', ')}, and a missing one would make an invisibility case meaningless`);
  }
  // The states the cases below are told apart by, read back rather than trusted: the seed is
  // idempotent, so a hand-applied edit to one row shows up here instead of much later as a
  // confusing refusal.
  const want = [
    [REL.r1, 'approved'], [REL.r2, 'approved'], [REL.draft, 'draft'],
    [REL.reviewed, 'reviewed'], [REL.retiredOnly, 'deprecated'],
  ];
  const rows = sqlRows(`select id || '|' || status from public.tradition_pack_releases
                          where id in ('${want.map(([id]) => id).join("','")}')`);
  for (const [id, status] of want) {
    assert.ok(rows.includes(`${id}|${status}`),
      `refusing to run: fixture release ${id} is not '${status}' (${rows.join(' ')})`);
  }
  // And that this stack understands version 2 at all. The seed's rows are born as drafts and walked
  // forward by the guard, so a stack built from an older copy of the migration cannot hold them —
  // and every case below would then be measuring a contract this file does not test.
  const versions = sqlRows(`select distinct definition_schema_version::text
                              from public.tradition_pack_releases
                             where id::text like 'aaaaaaaa-0005-%'`);
  assert.deepEqual(versions, ['2'],
    'the fixture releases are not version-2 material, so the v2 preview arms below would have '
    + 'nothing to refuse; re-apply this repository\'s migrations from zero');

  for (const who of ['hostA', 'hostB']) people[who] = await signUp(who);
  for (const who of ['hostA', 'hostB']) {
    const { data, error } = await people[who].client.auth.getSession();
    assert.equal(error, null, error?.message);
    people[who].token = data.session.access_token;
  }

  for (const [slot, who, language, title, release] of WEDDINGS) {
    const { data, error } = await client(who).from('weddings').insert({
      owner_user_id: uid(who), title, primary_language: language,
      tradition_pack_release_id: release,
    }).select('id, tradition_pack_release_id, primary_language').single();
    assert.equal(error, null, `${who} could not create ${title}: ${JSON.stringify(error)}`);
    people[slot] = data;
  }

  // No venue here: every wedding that needs one creates its own, through the same API, inside the
  // case that needs it (`complete` below, and `completeFor` at the foot of the file). The composite
  // key on `wedding_events` makes a shared venue row an error rather than a shortcut, and the
  // venue's own scope is the owner's wedding.
});

after(async () => {
  trustedCleanup();
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
  const ids = Object.keys(people).filter((k) => people[k].userId).map((k) => people[k].userId);
  const { data: left, error } = await svc.from('weddings').select('id').in('owner_user_id', ids);
  assert.equal(error, null, error?.message);
  assert.deepEqual(left, [], 'teardown left a wedding behind');
  for (const id of ids) {
    const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    assert.ok(res.ok, `teardown could not remove a synthetic account (HTTP ${res.status})`);
  }
  // The residue of this suite is the minted retirement pack, and it is printed rather than assumed
  // away — see RET-05 for the assertion, which is about the *seed* staying unspent.
  console.log('  fixture catalogue left in the local stack:');
  for (const line of sqlRows(`select '    ' || p.pack_key || ' release ' || r.release_number
                                     || ' is ' || r.status
                                from public.tradition_pack_releases r
                                join public.tradition_packs p on p.id = r.pack_id
                               where p.pack_key like 'stage5_%'
                               order by p.pack_key, r.release_number`)) {
    console.log(line);
  }
});

// ---------------------------------------------------------------------------
// CATALOGUE — what each of the three roles may see, and what each may point a wedding at
// ---------------------------------------------------------------------------
describe('§23 CATALOGUE', () => {
  test('CAT-01 the anonymous web cannot enumerate the release catalogue, and the control shows it is the grant and not the transport', async () => {
    for (const rel of ['tradition_pack_releases', 'tradition_packs']) {
      const r = await read(rel, 'id');
      assert.equal(r.status, 401, rel);
      assert.equal(r.body.code, '42501', rel);
      assert.match(r.body.message, new RegExp(`permission denied for table ${rel}`));
      // The control: the same key, the same host, one function that is meant for it. Without this,
      // two refusals could just mean "anon cannot reach PostgREST".
      const control = await anonApi().rpc('resolve_public_invitation');
      assert.equal(control.error, null, control.error?.message);
      assert.deepEqual(control.data, { available: false });
    }
    // And the enumeration an attacker would actually try: not a table read but a guessed RPC name.
    // There is no `api` function that lists packs, so the answer is "no such function" rather than
    // "not allowed", which is the same refusal a caller gets for a name that does not exist
    // anywhere — the surface does not confirm that the catalogue has a door.
    //
    // Measured shape, corrected here from an assumption: PostgREST answers an unknown function with
    // **404** and code `PGRST202`, not 400. The sentence is
    // `Could not find the function api.<name> without parameters in the schema cache`, which names
    // the *exposed profile* it searched and says nothing about whether a pack catalogue exists.
    for (const name of ['tradition_pack_catalog', 'list_tradition_packs', 'get_tradition_pack_review_packet']) {
      const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json', 'Content-Profile': 'api' },
        body: '{}',
      });
      assert.equal(res.status, 404, name);
      const body = await json(res);
      assert.equal(body.code, 'PGRST202', name);
      assert.match(body.message, new RegExp(`Could not find the function api\\.${name}`), name);
    }
  });

  test('CAT-02 an authenticated host sees the approved selectable TEST ONLY release, and sees it in customer shape', async () => {
    const releases = await read('tradition_pack_releases',
      `id,pack_id,release_number,status,languages&pack_id=eq.${PACK.main}&order=release_number.asc`,
    { as: 'hostA' });
    assert.equal(releases.status, 200, JSON.stringify(releases.body));
    // The exact pair, pinned by id. The retirement journey mints its own pack rather than adding
    // releases here (`fixtures/stage5_mint_pair.sql` explains why), so unlike the Stage 4 battery
    // this one can name the whole answer rather than a set of statuses — and if a future run does
    // start minting into this pack, this assertion is the thing that says so.
    assert.deepEqual(releases.body.map((r) => [r.id, r.release_number, r.status]),
      [[REL.r1, 1, 'approved'], [REL.r2, 2, 'approved']]);
    for (const row of releases.body) {
      assert.deepEqual(row.languages.slice().sort(), ['en', 'ta'],
        'a customer read lost the coverage a picker needs');
    }

    const packs = await read('tradition_packs', `id,pack_key&id=eq.${PACK.main}`, { as: 'hostA' });
    assert.equal(packs.status, 200);
    assert.deepEqual(packs.body, [{ id: PACK.main, pack_key: 'stage5_http_v2' }]);
    assert.ok(packs.body[0].pack_key.startsWith('stage5_http_'),
      'every pack this suite offers a customer is named as a fixture');
  });

  test('CAT-03 a draft and a reviewed release are not selectable, and neither is visible as a choice', async () => {
    // Two different states, one outcome. `draft` has never been looked at; `reviewed` has been
    // looked at and bound to a digest but not shipped. A host may not choose either, and — the half
    // that only the transport can measure — may not see either, so the picker cannot be talked into
    // offering one by a hand-typed id.
    const seen = await read('tradition_pack_releases', 'id&status=eq.approved', { as: 'hostA' });
    assert.equal(seen.status, 200, JSON.stringify(seen.body));
    assert.ok(seen.body.length > 0, 'the picker read found nothing, so its absence proves nothing');
    const ids = seen.body.map((r) => r.id);
    assert.ok(ids.includes(REL.r1) && ids.includes(REL.r2), 'the approved fixtures are missing');
    assert.ok(!ids.includes(REL.draft), 'a draft release was offered as a choice');
    assert.ok(!ids.includes(REL.reviewed), 'a reviewed-but-unapproved release was offered');

    for (const [id, pack, label] of [[REL.draft, PACK.draftOnly, 'draft'],
                                     [REL.reviewed, PACK.reviewedOnly, 'reviewed']]) {
      // The row is really there in the state this case says is invisible, read from the trusted
      // side. §17's rule carries over to this battery: a refusal asserted against a row that does
      // not exist is not a pass, and an idempotent seed can quietly stop seeding if it is edited.
      const exists = sqlRows(`select status from public.tradition_pack_releases where id = '${id}'`);
      assert.deepEqual(exists, [label], `the ${label} fixture row is missing or has moved`);

      // Its own pack, filtered: the read a picker makes, which would list it if RLS let it through.
      const unfiltered = await read('tradition_pack_releases', `id&pack_id=eq.${pack}`,
        { as: 'hostA' });
      assert.equal(unfiltered.status, 200, label);
      assert.deepEqual(unfiltered.body, [], `a ${label} release was visible as a choice`);

      // Its owner, because a PATCH from a different account is refused by RLS as *silence* (CAT-06),
      // and silence would make this case pass without the gate ever running.
      const chosen = await pointAt('hostB', people.mine.id, id);
      assert.equal(chosen.status, 403, `${label}: selecting it was accepted`);
      assert.equal(chosen.body.code, '42501', label);
      assert.match(chosen.body.message, /^a wedding may only select an approved/, label);
      const still = await read('weddings', `id&tradition_pack_release_id=is.null&id=eq.${people.mine.id}`,
        { as: 'hostB' });
      assert.equal(still.body.length, 1,
        `${label}: the wedding moved even though the selection was refused`);
    }
  });

  test('CAT-04 a deprecated release cannot newly be selected, whatever its pack looks like', async () => {
    // `stage5_http_retired_only` is a pack with exactly one release and it was retired before any
    // wedding ever pointed at it, so hiding it is the difference between a retired product and a
    // vanished one. Both halves are measured: it is not offered, and it cannot be entered by hand.
    const offered = await read('tradition_pack_releases', `id&pack_id=eq.${PACK.retiredOnly}`,
      { as: 'hostA' });
    assert.equal(offered.status, 200, JSON.stringify(offered.body));
    assert.deepEqual(offered.body, [], 'a retired release was offered as a choice');

    const chosen = await pointAt('hostB', people.mine.id, REL.retiredOnly);
    assert.equal(chosen.status, 403, JSON.stringify(chosen.body));
    assert.match(chosen.body.message,
      /^a wedding may only select an approved tradition pack release/);

    // The control that makes the refusal above mean "gated" rather than "broken": the very same
    // request shape, with an approved release, moves the row.
    const control = await pointAt('hostB', people.mine.id, REL.r1);
    assert.equal(control.status, 200, JSON.stringify(control.body));
    assert.deepEqual(control.body.map((w) => w.tradition_pack_release_id), [REL.r1]);
    const back = await pointAt('hostB', people.mine.id, null);
    assert.equal(back.status, 200, JSON.stringify(back.body));
  });

  test('CAT-05 a guessed release id and a real-but-invisible one get the identical refusal, so the API is not an existence oracle', async () => {
    // Both as the wedding's own account, so the answer comes from the selection gate rather than
    // from RLS silence (see CAT-03's note — the same trap, and it was measured, not guessed: an
    // out-of-owner PATCH here returned HTTP 200 with an empty body).
    const invisible = await pointAt('hostB', people.mine.id, REL.draft);
    const guessed = await pointAt('hostB', people.mine.id, randomUUID());
    assert.equal(invisible.status, 403, JSON.stringify(invisible.body));
    assert.equal(guessed.status, 403, JSON.stringify(guessed.body));
    // Byte for byte, not "both were refused". Two different sentences — "not readable" beside "does
    // not exist" — would let a caller walk the uuid space and map the catalogue through the front
    // door, which is the entire point of reading the status as the calling role.
    assert.deepEqual(guessed.body, invisible.body,
      'a nonexistent release answered differently from an unreadable one');
    assert.match(invisible.body.message, /not readable by this role/);
    // The refusal is a product sentence, not a schema dump.
    assert.doesNotMatch(bytesOf(invisible.body),
      /public\.|internal_api|private\.|tradition_pack_releases|invitation_versions|column/i);

    // And the row is unchanged, read back as its owner.
    const still = await read('weddings', `id&tradition_pack_release_id=is.null&id=eq.${people.mine.id}`,
      { as: 'hostB' });
    assert.equal(still.body.length, 1, 'a refused selection still moved the pointer');
  });

  test('CAT-06 another account\'s wedding cannot be pointed anywhere, and the answer is silence rather than a refusal', async () => {
    // The owner policy is what makes this a *no* rather than an error, and the measurement has to be
    // of the row, because the response says nothing either way.
    const r = await pointAt('hostA', people.victim.id, REL.r1);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, [], 'an update that matched another user\'s row returned it');

    const victim = await read('weddings', `id,tradition_pack_release_id&id=eq.${people.victim.id}`,
      { as: 'hostB' });
    assert.equal(victim.status, 200);
    assert.deepEqual(victim.body, [{ id: people.victim.id, tradition_pack_release_id: null }],
      'host A moved host B\'s selection');

    // Control: the same PATCH, by the owner, on the same row.
    const own = await pointAt('hostB', people.victim.id, REL.r1);
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.deepEqual(own.body.map((w) => w.tradition_pack_release_id), [REL.r1]);
  });
});

// ---------------------------------------------------------------------------
// BROWSER WRITE SECURITY — the catalogue is maintenance's, and nothing about that is a client
// concern. Every case here is the same shape: a customer JWT trying a maintenance act, refused,
// with the customer's own legal write beside it as the control.
// ---------------------------------------------------------------------------
describe('§23 BROWSER WRITE SECURITY', () => {
  const refused = async (label, call) => {
    const r = await call();
    assert.notEqual(r.status, 200, `${label}: the write was accepted`);
    assert.notEqual(r.status, 204, `${label}: the write was accepted`);
    assert.equal(r.body.code, '42501', `${label}: ${bytesOf(r.body)}`);
    return r;
  };

  test('WRT-01 a customer cannot create a pack or a release, edit a draft release, or delete either', async () => {
    // 1. create pack
    await refused('insert into tradition_packs', () => write('POST', 'tradition_packs',
      '', { pack_key: 'stage5_forged_pack', display_name: 'A forged pack',
        scope_statement: 'This row should never have been writable by a customer JWT at all.' },
      { as: 'hostA' }));
    // 2. create release
    await refused('insert into tradition_pack_releases', () => write('POST',
      'tradition_pack_releases', '', {
        pack_id: PACK.main, release_number: 99, definition_schema_version: 2,
        languages: ['en'], definition: { sections: [] },
      }, { as: 'hostA' }));
    // 3. edit a release that is genuinely still a draft — the one row a maintenance identity may
    //    write, and the state where "the customer cannot" is a fact about grants rather than about
    //    the immutability trigger.
    await refused('update of a draft release', () => write('PATCH', 'tradition_pack_releases',
      `?id=eq.${REL.draft}`, { changelog: 'rewritten by a host' }, { as: 'hostA' }));
    // 4. delete either
    await refused('delete of a pack', () => write('DELETE', 'tradition_packs',
      `?id=eq.${PACK.draftOnly}`, {}, { as: 'hostA' }));
    await refused('delete of a release', () => write('DELETE', 'tradition_pack_releases',
      `?id=eq.${REL.r1}`, {}, { as: 'hostA' }));

    // Nothing moved. Read through the same transport that just refused the writes, so the check is
    // about the catalogue and not about a cached answer.
    const still = await read('tradition_pack_releases',
      `id,release_number&pack_id=eq.${PACK.main}`, { as: 'hostA' });
    assert.deepEqual(still.body.map((r) => r.release_number).sort(), [1, 2]);
    const forged = await read('tradition_packs', 'id&pack_key=eq.stage5_forged_pack',
      { as: 'hostA' });
    assert.deepEqual(forged.body, [], 'a customer-created pack exists');

    // Control: the same JWT, the same transport, a write the product does allow.
    const own = await write('PATCH', 'weddings', `?id=eq.${people.mine.id}`,
      { title: 'Renamed by its own host' }, { as: 'hostB' });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body[0].title, 'Renamed by its own host');
  });

  test('WRT-02 a customer cannot read or write a review, a machine disclosure, a digest or a maintenance timestamp, by name', async () => {
    // Read half: the column grant is the boundary, so each name is refused on its own rather than
    // the whole table being unreachable. `status` and `release_number` are asked for in the same
    // statement as the control, so a refusal can be told apart from a broken request.
    for (const col of INTERNAL_COLUMNS) {
      const r = await read('tradition_pack_releases', `id,release_number,status,${col}`,
        { as: 'hostA' });
      assert.equal(r.status, 403, `${col} was readable`);
      assert.match(r.body.message, /permission denied/, col);
    }
    const control = await read('tradition_pack_releases', 'id,release_number,status',
      { as: 'hostA' });
    assert.equal(control.status, 200, JSON.stringify(control.body));
    assert.ok(control.body.length > 0, 'the control read found nothing, so the refusals above are empty');

    // Write half. These are refused by the table grant rather than by the trigger, which is the
    // order PostgREST reaches them in; the trigger's own rule — that the digest has exactly one
    // writer, the draft → reviewed edge — is `50_review_binding.sql`.
    const writes = {
      review_packet_hash: 'f'.repeat(64),
      review_label: 'A review nobody performed',
      review_basis: 'Forged by a customer JWT, which is the point of this case.',
      review_scope: 'Nothing at all was assessed here, and this row says otherwise.',
      reviewed_languages: ['en', 'ta'],
      reviewed_at: '2026-01-01T00:00:00Z',
      reviewed_by: uid('hostA'),
      approved_at: '2026-01-01T00:00:00Z',
      deprecated_at: '2026-01-01T00:00:00Z',
      machine_assisted: false,
      machine_assistance_notes: 'No model was involved in this release, unlike the real disclosure.',
      source_reference: 'a book nobody wrote',
      author_label: 'Someone with authority',
      changelog: 'rewritten by a host',
    };
    for (const [col, value] of Object.entries(writes)) {
      const r = await write('PATCH', 'tradition_pack_releases', `?id=eq.${REL.draft}`,
        { [col]: value }, { as: 'hostA' });
      assert.notEqual(r.status, 200, `${col}: the write was accepted`);
      assert.equal(r.body.code, '42501', `${col}: ${bytesOf(r.body)}`);
    }
    // None of it landed, on the row that was attacked.
    const row = sqlRows(`select coalesce(review_packet_hash,'(null)') || '|' ||
                                coalesce(review_label,'(null)') || '|' ||
                                coalesce(author_label,'(null)') || '|' ||
                                machine_assisted::text
                           from public.tradition_pack_releases where id = '${REL.draft}'`);
    assert.deepEqual(row, ['(null)|(null)|TEST ONLY — synthetic Stage 5 fixture release|true'],
      'a customer write reached a review, authorship or disclosure field');
  });

  test('WRT-03 no maintenance step is callable over HTTP, in either spelling, and the maintenance surface is pinned to internal_api', async () => {
    const MAINTENANCE = ['approve_tradition_pack_release', 'create_tradition_pack',
      'create_tradition_pack_release', 'deprecate_tradition_pack_release',
      'get_tradition_pack_review_packet', 'inspect_tradition_pack_release',
      'submit_tradition_pack_review', 'tradition_pack_catalog',
      'tradition_pack_retention_report', 'update_draft_tradition_pack_release',
      'validate_tradition_pack_release'];
    const deployed = sqlRows(`select p.proname from pg_proc p join pg_namespace n
                                on n.oid = p.pronamespace
                               where n.nspname = 'internal_api'
                                 and p.proname like '%tradition_pack%' order by 1`);
    assert.deepEqual(deployed, MAINTENANCE.slice().sort(),
      'the maintenance surface changed shape; every name there has to be unreachable from here too');

    // No `api.` wrapper exists for any of them. The Stage 5 migration says the absence is
    // deliberate, and a deliberate absence needs a test or it becomes an oversight.
    const wrappers = sqlRows(`select count(*) from pg_proc p join pg_namespace n
                                on n.oid = p.pronamespace
                               where n.nspname = 'api' and p.proname like '%tradition_pack%'`);
    assert.deepEqual(wrappers, ['0'], 'a pack maintenance function gained a browser-exposed wrapper');

    // Spelling one: name the function on the exposed profile. PostgREST answers "no such function",
    // which is the same answer CAT-01 gets for a name that exists nowhere.
    for (const name of ['submit_tradition_pack_review', 'approve_tradition_pack_release',
      'deprecate_tradition_pack_release', 'create_tradition_pack',
      'update_draft_tradition_pack_release', 'tradition_pack_catalog']) {
      const r = await api('hostA').rpc(name, { p_release_id: REL.r1, p_expected_hash: 'f'.repeat(64) });
      assert.equal(r.data, null, name);
      assert.equal(r.error?.code, 'PGRST202',
        `${name} was callable: ${bytesOf(r.error ?? r.data)}`);
    }
    // Spelling two: ask for the maintenance schema directly.
    const profile = await fetch(`${url}/rest/v1/rpc/tradition_pack_catalog`, {
      method: 'POST',
      headers: { apikey: keyFor('hostA'), Authorization: `Bearer ${jwtFor('hostA')}`,
        'Content-Type': 'application/json', 'Content-Profile': 'internal_api' },
      body: '{}',
    });
    assert.equal(profile.status, 406);
    assert.equal((await json(profile)).code, 'PGRST106');

    // And the role the migration revokes even from: `service_role` is a server-side maintenance
    // identity with table rights, not a holder of this product's review workflow.
    const callable = sqlRows(`select p.proname from pg_proc p join pg_namespace n
                                on n.oid = p.pronamespace
                               where n.nspname = 'internal_api'
                                 and p.proname like '%tradition_pack%'
                                 and has_function_privilege('service_role', p.oid, 'EXECUTE')
                               order by 1`);
    assert.deepEqual(callable, [],
      'service_role holds EXECUTE on the review workflow it was deliberately refused');
    const browserRoles = sqlRows(`select p.proname from pg_proc p join pg_namespace n
                                on n.oid = p.pronamespace
                               where n.nspname = 'internal_api'
                                 and p.proname like '%tradition_pack%'
                                 and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                      or has_function_privilege('anon', p.oid, 'EXECUTE'))
                               order by 1`);
    assert.deepEqual(browserRoles, [], 'a browser role holds EXECUTE on a maintenance function');
  });

  test('WRT-04 the only internal_api function a browser role may call is the one §23 built a surface for', async () => {
    // The Stage 4 file pins what is in `api`. This pins what is in `internal_api` for the roles a
    // browser can hold, which is the half that decides whether the wrapper layer is doing any work:
    // if `authenticated` could call `internal_api` directly, every `api.` wrapper would be
    // decoration and every refusal above would be about a schema name rather than a privilege.
    // Stage 7 put five more names on this mirror — `get_approval_requests`, `request_family_review`
    // and `revoke_family_review` for the host, `resolve_family_review` and `submit_family_review`
    // for the reviewer — and the reason they belong here is the same sentence as above: a nested
    // call is checked as the invoking role, so a wrapper's caller must hold EXECUTE on the body
    // beside it. Read as an inventory rather than a count because the failure this list exists for
    // is a name appearing on one side only: a privileged body with no wrapper is a grant with no
    // transport, and a wrapper with no body is a 500. Stage 8 put six more names on the same mirror
    // (`get_guest_invitation_state`, `issue_guest_invitations`, `revoke_guest_invitation`,
    // `rotate_guest_invitation` for the host; `resolve_guest_invitation`, `submit_guest_rsvp` for the
    // guest), and it is the same rule again, because a guest door is still a body the wrapper's
    // caller has to be able to name. Stage 9 put the last two on it — `list_invitation_outputs` and
    // `render_invitation_document`, both host reads, both granted to `authenticated` and to no
    // anonymous caller — measured from `q9-logs/s9-http-census-readout-02.txt` rather than predicted.
    // Stage 10 added the twenty-second, `commerce_host_summary`, and it is the only money name on
    // this mirror: a host reading the state of its own purchase needs the same nested-execution grant
    // as every other wrapper's caller, while the six bodies that write the ledger hold no grant at all
    // and are inventoried by name in `stage3_publication.test.mjs` API39 instead. Measured from
    // `readSurface` against the deployed stack at this head.
    // Which of the twenty-two anon may also reach is the other half: the
    // five header-credential doors, three of which take no argument at all, are pinned per name in
    // `stage3_publication.test.mjs` §6.6, so this case pins only the half that is common to all
    // twenty-two.
    const direct = sqlRows(`select n.nspname || '.' || p.proname from pg_proc p
                              join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'internal_api'
                               and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                             order by 1`);
    assert.deepEqual(direct, ['internal_api.commerce_host_summary', 'internal_api.create_invitation_version',
      'internal_api.get_approval_requests', 'internal_api.get_guest_invitation_state',
      'internal_api.get_invitation_publication_state', 'internal_api.issue_guest_invitations',
      'internal_api.list_invitation_outputs',
      'internal_api.preview_invitation', 'internal_api.preview_invitation_document',
      'internal_api.publish_invitation_version', 'internal_api.render_invitation_document',
      'internal_api.request_family_review',
      'internal_api.resolve_family_review', 'internal_api.resolve_guest_invitation',
      'internal_api.resolve_public_invitation', 'internal_api.revoke_family_review',
      'internal_api.revoke_guest_invitation', 'internal_api.revoke_invitation_publication',
      'internal_api.rotate_guest_invitation', 'internal_api.rotate_invitation_token',
      'internal_api.submit_family_review', 'internal_api.submit_guest_rsvp'],
      'the privileged inner layer stopped being a mirror of the wrapper list');

    // And the wrapper layer is not decoration: calling the inner name through the exposed profile is
    // refused exactly as the maintenance names were.
    const inner = await api('hostA').rpc('preview_invitation_document_inner');
    assert.equal(inner.error?.code, 'PGRST202');
    const byName = await fetch(`${url}/rest/v1/rpc/preview_invitation`, {
      method: 'POST',
      headers: { apikey: keyFor('hostA'), Authorization: `Bearer ${jwtFor('hostA')}`,
        'Content-Type': 'application/json', 'Content-Profile': 'internal_api' },
      body: '{}',
    });
    assert.equal(byName.status, 406);
    assert.equal((await json(byName)).code, 'PGRST106');
  });
});

// ---------------------------------------------------------------------------
// PREVIEW — the host's own read, which is the first time §M's "the preview and the freeze are the
// same document" becomes measurable.
// ---------------------------------------------------------------------------
describe('§23 PREVIEW', () => {
  /** Fill a wedding out until every v2 arm is satisfied, except the ones a case is measuring. */
  const complete = async (slot, who = 'hostA', { venue = true, closing = true } = {}) => {
    const wedding = people[slot].id;
    if (closing) {
      const { error } = await client(who).from('invitation_drafts')
        .update({ content: { closing: HOST.closing } }).eq('wedding_id', wedding);
      assert.equal(error, null, JSON.stringify(error));
    }
    const { error: pe } = await client(who).from('wedding_people').insert({
      wedding_id: wedding, display_name: 'K. Selvi', role_key: 'mother', role_label: 'Mother',
      group_key: 'bride', group_label: "The bride's family",
    });
    assert.equal(pe, null, JSON.stringify(pe));
    let venueId = null;
    if (venue) {
      const { data: made, error: ve } = await client(who).from('venues').insert({
        wedding_id: wedding, ...VENUE,
      }).select('id').single();
      assert.equal(ve, null, JSON.stringify(ve));
      venueId = made.id;
    }
    const { data: event, error: ee } = await client(who).from('wedding_events').insert({
      wedding_id: wedding, event_key: 'muhurtham', display_name: 'Muhurtham',
      starts_at_local: '2026-11-14T07:30:00', venue_id: venueId,
    }).select('id').single();
    assert.equal(ee, null, JSON.stringify(ee));
    return { event, venueId };
  };

  const blocking = (issues) => issues.filter((i) => i.blocking);
  const codes = (issues) => issues.map((i) => `${i.code}@${i.section_key ?? '-'}`);

  test('PRV-01 the preview answer is a product shape: four named parts, records with six fields, rules with seven, and no words from the release', async () => {
    const r = await preview('hostA', people.incomplete.id);
    assert.equal(r.error, null, JSON.stringify(r.error));
    assert.deepEqual(Object.keys(r.data).sort(),
      ['authoring', 'invitation', 'issues', 'selected_release']);

    // The release the host is standing on, in the narrow form the retired notice is built from.
    assert.deepEqual(r.data.selected_release, {
      pack_key: 'stage5_http_v2',
      display_name: 'TEST ONLY — Stage 5 HTTP Version-2 Fixture',
      release_number: 1,
      definition_schema_version: 2,
      status_is_current: true,
    }, 'the preview leaked a review field, or lost the fact the editor shows a host');

    // The authoring rules, in the release's own order, with no wording in them.
    assert.deepEqual(r.data.authoring.map((a) => a.position), [1, 2, 3, 4, 5]);
    assert.deepEqual(r.data.authoring.map((a) => a.section_key),
      ['opening', 'family', 'ceremonies', 'invitation', 'closing']);
    for (const a of r.data.authoring) {
      assert.deepEqual(Object.keys(a).sort(),
        ['host_field', 'kind', 'override_rule', 'position', 'required', 'requires_venue',
          'section_key'], bytesOf(a));
      // A rule is emitted only where it can mean something: an override belongs to prose, a venue
      // requirement to an event list. A client that received both everywhere would have to guess.
      if (a.kind !== 'text') assert.equal(a.override_rule, null, bytesOf(a));
      if (a.kind !== 'event_list') assert.equal(a.requires_venue, null, bytesOf(a));
    }
    assert.deepEqual(r.data.authoring.find((a) => a.section_key === 'ceremonies').requires_venue,
      true, 'the venue declaration did not reach the screen that has to explain a missing venue');
    assert.deepEqual(r.data.authoring.find((a) => a.section_key === 'invitation').override_rule,
      'pack_only');
    assert.deepEqual(r.data.authoring.find((a) => a.section_key === 'closing'), {
      section_key: 'closing', position: 5, kind: 'text', required: true,
      host_field: 'closing', override_rule: 'host_must_supply', requires_venue: null,
    });

    // Every record: the same six names, a code from the closed vocabulary, and nothing a client has
    // to parse.
    const VOCABULARY = ['contract_unsupported', 'event_venue_missing', 'host_override_not_permitted',
      'kind_unrenderable', 'language_not_covered', 'position_unorderable', 'required_list_empty',
      'required_text_missing'];
    assert.ok(blocking(r.data.issues).length > 0, 'the document under test unexpectedly became freezable');
    for (const i of r.data.issues) {
      assert.deepEqual(Object.keys(i).sort(),
        ['blocking', 'code', 'field', 'message_key', 'params', 'section_key'], bytesOf(i));
      assert.ok(VOCABULARY.includes(i.code), `an unknown issue code reached a client: ${i.code}`);
      assert.equal(i.message_key, i.code, 'a record stopped being addressable by its own name');
      assert.equal(typeof i.blocking, 'boolean');
    }
    // No prose, no schema. The client renders a record by its code; a sentence from here would be a
    // second wording of the same fact, and the names below are the ones a leak would carry.
    assert.doesNotMatch(bytesOf(r.data.issues), /is required and has no|permission denied|public\.|private\.|internal_api|column|table/i);
    for (const w of DEFINITION_WORDS) {
      assert.doesNotMatch(bytesOf(r.data.issues), new RegExp(`\\b${w}\\b`), w);
    }
    // The document half is the guest's shape, which is the whole reason the two calls were merged.
    assert.deepEqual(Object.keys(r.data.invitation).sort(),
      ['closing', 'design_template', 'event_notes', 'events', 'family_introduction', 'language',
        'people', 'sections', 'style', 'title', 'tradition_pack', 'welcome']);
    assert.deepEqual(r.data.invitation.tradition_pack, {
      pack_key: 'stage5_http_v2',
      display_name: 'TEST ONLY — Stage 5 HTTP Version-2 Fixture',
      release_number: 1,
    });
  });

  test('PRV-02 an incomplete required host line is an HTTP success carrying a blocking record about that line', async () => {
    // "HTTP success with blocking issue record" is the design: a host with an unfinished invitation
    // still gets their document, so the editor can show the words beside the reason they cannot be
    // published yet. A 4xx here would be a worse product, not a safer one.
    const r = await preview('hostA', people.incomplete.id);
    assert.equal(r.error, null, JSON.stringify(r.error));
    const missing = r.data.issues.filter((i) => i.code === 'required_text_missing');
    assert.deepEqual(missing, [{
      code: 'required_text_missing', section_key: 'closing', field: 'closing', blocking: true,
      message_key: 'required_text_missing', params: { language: 'en' },
    }], `expected exactly the one host-prose refusal, got ${bytesOf(r.data.issues)}`);
    // The section itself resolves to nothing, and that is visible in the document as well as in the
    // verdict — a host reads the gap, not just a warning about it.
    const closing = r.data.invitation.sections.items.find((s) => s.section_key === 'closing');
    assert.equal(closing.body, null);
    assert.equal(closing.required, true);
    assert.equal(closing.host_field, 'closing');
  });

  test('PRV-03 missing required people and missing required events are each their own blocking record, named by kind', async () => {
    const r = await preview('hostA', people.incomplete.id);
    const lists = blocking(r.data.issues).filter((i) => i.code === 'required_list_empty');
    assert.deepEqual(lists.map((i) => [i.section_key, i.params.kind]),
      [['family', 'people_list'], ['ceremonies', 'event_list']],
      bytesOf(r.data.issues));
    // One record per section, not one per person or event: the arms read the document the renderer
    // will draw, and an empty list is a single fact about it.
    assert.equal(new Set(lists.map((i) => i.section_key)).size, 2);

    // Control inside the same suite: adding people clears the people arm and leaves the event arm
    // standing, so the two are two rules rather than one blanket refusal.
    const { error: pe } = await client('hostA').from('wedding_people').insert({
      wedding_id: people.incomplete.id, display_name: 'R. Kumar', role_key: 'father',
      role_label: 'Father', group_key: 'groom', group_label: "The groom's family",
    });
    assert.equal(pe, null, JSON.stringify(pe));
    const after = await preview('hostA', people.incomplete.id);
    assert.deepEqual(codes(after.data.issues), ['required_list_empty@ceremonies',
      'required_text_missing@closing'], bytesOf(after.data.issues));
  });

  test('PRV-04 a release that promises a venue refuses an event without one, and a release that does not promise one does not', async () => {
    const gap = await complete('venueGap', 'hostA', { venue: false });
    const r = await preview('hostA', people.venueGap.id);
    assert.equal(r.error, null, JSON.stringify(r.error));
    assert.deepEqual(blocking(r.data.issues), [{
      code: 'event_venue_missing', section_key: 'ceremonies', field: 'venue', blocking: true,
      message_key: 'event_venue_missing', params: { missing: 1 },
    }], bytesOf(r.data.issues));
    // The document still shows the event, with no venue invented for it: the refusal is about
    // publishing, not about hiding.
    const drawn = r.data.invitation.events;
    assert.equal(drawn.length, 1);
    assert.equal(drawn[0].venue, null);

    // The control that makes the arm's cause the *declaration* rather than the missing data: the
    // same event, with no venue, on a wedding whose built-in version-1 definition never asks for
    // one. If this freezes, `requires_venue` is doing the work.
    await complete('noPack', 'hostA', { venue: false });
    const v1 = await preview('hostA', people.noPack.id);
    assert.deepEqual(v1.data.issues, [], bytesOf(v1.data.issues));
    assert.equal(v1.data.selected_release, null);
    assert.deepEqual(v1.data.authoring.map((a) => a.requires_venue).filter((x) => x === true), [],
      'the built-in no-pack definition invented a venue requirement');
    const freezeV1 = await freeze('hostA', people.noPack.id);
    assert.equal(freezeV1.error, null, JSON.stringify(freezeV1.error));
    assert.equal(freezeV1.data.version_number, 1);
    // The key is present and null rather than absent: `private.build_invitation_snapshot` writes the
    // release block as `CASE WHEN r.id IS NULL THEN NULL ELSE … END`, and §11 pins that spelling so
    // a reader can tell "no release" from "a snapshot that forgot to say".
    assert.equal(Object.prototype.hasOwnProperty.call(freezeV1.data.snapshot, 'tradition_pack_release'),
      true, 'the snapshot shape moved, and §11 pins the key that carries the absence');
    assert.equal(freezeV1.data.snapshot.tradition_pack_release, null,
      'a no-pack version invented a release block');

    // Then the venue arrives — the *wedding's own* venue, which is what the composite key on
    // `wedding_events` requires — and the same document becomes freezable.
    const { data: made, error: venueErr } = await client('hostA').from('venues').insert({
      wedding_id: people.venueGap.id, ...VENUE,
    }).select('id').single();
    assert.equal(venueErr, null, JSON.stringify(venueErr));
    const { error: updv } = await client('hostA').from('wedding_events')
      .update({ venue_id: made.id }).eq('id', gap.event.id);
    assert.equal(updv, null, JSON.stringify(updv));
    const fixed = await preview('hostA', people.venueGap.id);
    assert.deepEqual(blocking(fixed.data.issues), [], bytesOf(fixed.data.issues));
  });

  test('PRV-05 a host line the release forbids is reported as an advisory, keeps the reviewed wording, and does not stop the freeze', async () => {
    await complete('advisory', 'hostA');
    const { error } = await client('hostA').from('invitation_drafts')
      .update({ content: { closing: HOST.closing, family_introduction: HOST.notSupplied } })
      .eq('wedding_id', people.advisory.id);
    assert.equal(error, null, JSON.stringify(error));

    const r = await preview('hostA', people.advisory.id);
    assert.equal(r.error, null, JSON.stringify(r.error));
    const advisory = r.data.issues.filter((i) => i.code === 'host_override_not_permitted');
    assert.deepEqual(advisory, [{
      code: 'host_override_not_permitted', section_key: 'invitation',
      field: 'family_introduction', blocking: false,
      message_key: 'host_override_not_permitted', params: { language: 'en' },
    }], bytesOf(r.data.issues));
    assert.deepEqual(blocking(r.data.issues), [],
      'a pack_only section turned a host warning into a refusal');

    // The two claims the advisory exists to make: the reviewed line is what the document carries,
    // and the host's words are still there as data rather than silently dropped — the guest's copy
    // is where PUB-02 checks they never reach a reader.
    const section = r.data.invitation.sections.items.find((s) => s.section_key === 'invitation');
    assert.equal(section.body.source, 'reviewed_pack');
    assert.equal(section.body.overrode_pack_text, false);
    assert.equal(r.data.invitation.family_introduction, HOST.notSupplied);

    const f = await freeze('hostA', people.advisory.id);
    assert.equal(f.error, null, JSON.stringify(f.error));
    assert.equal(f.data.version_number, 1, 'an advisory stopped the freeze');
    // PUB-01 publishes *this* version rather than FRZ-02's: a wedding has one live link, and a
    // second publish repoints it instead of minting a second credential, so a case that published a
    // version another case already published would be measuring reuse rather than a guest document.
    people.advisoryVersion = f.data;
  });

  test('PRV-06 a complete document carries no blocking entry, in either language the release covers', async () => {
    await complete('complete', 'hostA');
    const r = await preview('hostA', people.complete.id);
    assert.deepEqual(blocking(r.data.issues), [], bytesOf(r.data.issues));
    assert.deepEqual(codes(r.data.issues), [], bytesOf(r.data.issues));
    const bodies = Object.fromEntries(r.data.invitation.sections.items
      .map((s) => [s.section_key, s.body && s.body.source]));
    assert.deepEqual(bodies, {
      opening: 'reviewed_pack', family: null, ceremonies: null,
      invitation: 'reviewed_pack', closing: 'host',
    }, 'a resolved document stopped saying which line came from whom');

    // The same release in the other language it covers, because "no blocking entries" is only worth
    // two words if it holds for the document a Tamil-reading host actually gets.
    await complete('taDocument', 'hostA');
    const ta = await preview('hostA', people.taDocument.id);
    assert.deepEqual(blocking(ta.data.issues), [], bytesOf(ta.data.issues));
    assert.deepEqual(ta.data.invitation.sections.items.map((s) => s.body?.language ?? null),
      ['ta', null, null, 'ta', null], bytesOf(ta.data.invitation.sections.items));
    assert.equal(ta.data.invitation.sections.requested, 'ta');
  });

  test('PRV-07 the preview is the owner\'s, and the refusal names nothing about the row', async () => {
    const r = await previewRaw(jwtFor('hostA'), people.victim.id);
    assert.equal(r.status, 403, bytesOf(r.body));
    assert.equal(r.body.code, '42501');
    assert.equal(r.body.message, 'the caller may not preview this wedding');
    // No document, and no hint that one exists at that id.
    assert.equal(r.body.hint ?? null, null);

    const anon = await previewRaw(anonKey, people.complete.id);
    assert.equal(anon.status, 401, bytesOf(anon.body));
    assert.equal(anon.body.code, '42501');

    // Control: the same caller, the same call, their own wedding.
    const own = await previewRaw(jwtFor('hostB'), people.mine.id);
    assert.equal(own.status, 200, bytesOf(own.body));
    assert.ok(own.body.invitation);
  });
});

// ---------------------------------------------------------------------------
// FREEZE — the verdict is the server's, and the document it freezes is the one just previewed.
// ---------------------------------------------------------------------------
describe('§23 FREEZE', () => {
  test('FRZ-01 the document PRV-02 called incomplete is refused by name, and no version row appears', async () => {
    const before = sqlRows(`select count(*) from public.invitation_versions
                             where wedding_id = '${people.incomplete.id}'`);
    const r = await freeze('hostA', people.incomplete.id);
    assert.equal(r.data, null, bytesOf(r.data));
    // Measured, and it is not the code an earlier draft of this file assumed. The completeness
    // verdict is raised as `check_violation` (23514), which PostgREST carries out as **HTTP 400** —
    // a product refusal a host can be shown. The lifecycle verdicts are raised as
    // `insufficient_privilege` (42501 → 403): RET-02's retired-release freeze is the other half of
    // the pair, and the two codes are the difference between "your invitation is not ready" and
    // "you may not do this at all".
    assert.equal(r.error.code, '23514', bytesOf(r.error));
    const raw = await fetch(`${url}/rest/v1/rpc/create_invitation_version`, {
      method: 'POST',
      headers: { apikey: keyFor('hostA'), Authorization: `Bearer ${jwtFor('hostA')}`,
        'Content-Type': 'application/json', 'Content-Profile': 'api' },
      body: JSON.stringify({ p_wedding_id: people.incomplete.id }),
    });
    assert.equal(raw.status, 400, bytesOf(await json(raw)));
    assert.match(r.error.message, /^this invitation cannot be frozen yet: /);
    const sentences = r.error.message.replace(/^this invitation cannot be frozen yet: /, '')
      .split('; ');
    // `family` is not in this list: PRV-03 filled it on this same wedding, which is what makes the
    // sentence set a measurement of the *remaining* gaps rather than a recital of every rule.
    assert.deepEqual(sentences, [
      'section ceremonies is required and has no events to show yet',
      'section closing is required and has no wording in en, and the release does not allow it to fall back',
    ], bytesOf(r.error.message));
    // The advisory is not in there, and it cannot be: the freeze refuses on blocking records, which
    // is the same filter the preview's own records are read through. PRV-05's wedding carries one and
    // freezes in PRV-05; this list proves the two halves use one rule.
    assert.ok(!sentences.some((s) => s.includes('reviewed wording')), bytesOf(r.error.message));
    // One rule, two spellings of it: the freeze's sentences and the preview's records are the same
    // set counted the same way. A host who was told about two problems and then refused for three
    // would be chasing a verdict the preview never showed them.
    const p = await preview('hostA', people.incomplete.id);
    assert.equal(sentences.length, previewBlocking(p).length,
      'the freeze and the preview disagreed about how many things are wrong');
    // Which sections, not merely how many: every sentence names the section it is about, and every
    // blocking record carries one.
    const named = sentences.map((s) => /^section (\S+) /.exec(s)?.[1] ?? '(unreadable)');
    assert.deepEqual(named.sort(), previewBlocking(p).map((i) => i.section_key).sort(),
      'the freeze named different sections than the preview did');

    const after = sqlRows(`select count(*) from public.invitation_versions
                            where wedding_id = '${people.incomplete.id}'`);
    assert.deepEqual(after, before, 'a refused freeze still wrote a version');
  });

  test('FRZ-02 a complete document freezes, and the version pins the release the preview named', async () => {
    const r = await freeze('hostA', people.complete.id);
    assert.equal(r.error, null, JSON.stringify(r.error));
    assert.equal(r.data.version_number, 1);
    assert.deepEqual(Object.keys(r.data).sort(), ['snapshot', 'version_id', 'version_number']);
    assert.equal(r.data.snapshot.tradition_pack_release.release_number, 1);
    assert.equal(r.data.snapshot.tradition_pack_release.pack_key, 'stage5_http_v2');
    // The version row itself carries the pin. It is read from the database rather than from the
    // snapshot because the snapshot deliberately holds no uuid (`build_invitation_snapshot`'s own
    // comment: "an identifier in a published payload is a leak with no use case"), so the only place
    // the release id exists after a freeze is the row a guest can never reach.
    assert.deepEqual(sqlRows(`select tradition_pack_release_id from public.invitation_versions
                               where id = '${r.data.version_id}'`), [REL.r1],
      'the frozen version does not point at the release the preview named');
    // The eleven release facts a frozen document keeps about its release — read here to pin the
    // *shape*, because `PUB-02` is about how few of them survive into a guest's copy.
    assert.deepEqual(Object.keys(r.data.snapshot.tradition_pack_release).sort(), [
      'author_label', 'definition_schema_version', 'display_name', 'languages', 'machine_assisted',
      'pack_key', 'release_number', 'review_label', 'reviewed_languages', 'scope_statement',
      'source_reference',
    ]);
    assert.ok(UUID.test(r.data.version_id));
    people.completeVersion = r.data;

    const ta = await freeze('hostA', people.taDocument.id);
    assert.equal(ta.error, null, JSON.stringify(ta.error));
    people.taVersion = ta.data;
  });

  test('FRZ-03 the invitation a host previewed and the invitation a guest is given are the same bytes', async () => {
    const p = await preview('hostA', people.complete.id);
    const g = await publishAndResolve('complete', people.completeVersion);
    assert.deepEqual(p.data.invitation, g.invitation,
      'a host previewed one document and a guest received another');
    // Byte for byte, not merely equal after parsing: the two answers arrive over two routes, one as
    // a function result and one as a guest projection, and a field that only one of them has would
    // show up here even when a deep equality on the interesting subset passed.
    assert.equal(bytesOf(p.data.invitation), bytesOf(g.invitation));

    // And the same for the Tamil document, so the claim is not an accident of the one language whose
    // wording the release happens to have in English too.
    const pt = await preview('hostA', people.taDocument.id);
    const gt = await publishAndResolve('taDocument', people.taVersion);
    assert.equal(bytesOf(pt.data.invitation), bytesOf(gt.invitation));

    // The other half of parity: the preview keeps moving while a published guest document does not.
    const { error: editErr } = await client('hostA').from('invitation_drafts')
      .update({ content: { closing: 'Written after the guest link already went out.' } })
      .eq('wedding_id', people.complete.id);
    assert.equal(editErr, null, JSON.stringify(editErr));
    const moved = await preview('hostA', people.complete.id);
    const unchanged = await resolveAs(g.token);
    assert.notEqual(bytesOf(moved.data.invitation), bytesOf(p.data.invitation),
      'the preview stopped being live, so this pair proved nothing');
    assert.equal(bytesOf(unchanged.body.invitation), bytesOf(g.invitation),
      'a guest document changed because its host kept typing');
  });
});

/** Publish one frozen version and hand back the guest's answer plus the token it came in on. */
async function publishAndResolve(slot, version) {
  const pub = await api('hostA').rpc('publish_invitation_version', {
    p_wedding_id: people[slot].id, p_version_id: version.version_id, p_expires_at: null });
  assert.equal(pub.error, null, JSON.stringify(pub.error));
  const token = pub.data.path.slice('/i/'.length);
  const r = await resolveAs(token);
  assert.equal(r.status, 200, bytesOf(r.body));
  assert.equal(r.body.available, true);
  return { token, publication: pub.data, invitation: r.body.invitation, body: r.body };
}

// ---------------------------------------------------------------------------
// PUBLICATION — the guest's page, and everything it is not allowed to carry.
// ---------------------------------------------------------------------------
describe('§23 PUBLICATION', () => {
  test('PUB-01 an anonymous guest resolves the frozen version with the sections in the release\'s own order', async () => {
    // PRV-05's advisory wedding, published here for the first time: a wedding holds one live link,
    // and a second publish of another version repoints that link instead of minting a second
    // credential (measured, and Stage 3 owns the rule), so this block could not re-publish FRZ-02's
    // version and still be describing a guest document someone had just been given.
    const g = await publishAndResolve('advisory', people.advisoryVersion);
    assert.deepEqual(Object.keys(g.body).sort(), ['available', 'invitation']);
    const items = g.body.invitation.sections.items;
    assert.deepEqual(items.map((s) => s.section_key),
      ['opening', 'family', 'ceremonies', 'invitation', 'closing'],
      'a guest received sections in an order the release did not declare');
    assert.deepEqual(items.map((s) => s.position), [1, 2, 3, 4, 5]);
    // The order came from the release, not from the host typing things in a nice sequence: the
    // authoring rules PRV-01 read are the same list.
    const a = await preview('hostA', people.advisory.id);
    assert.deepEqual(a.data.authoring.map((s) => s.section_key), items.map((s) => s.section_key));
    assert.deepEqual(items.map((s) => s.kind),
      ['text', 'people_list', 'event_list', 'text', 'text']);
    // and the data behind the two list sections is really there
    assert.equal(g.body.invitation.people.length, 1);
    assert.equal(g.body.invitation.events.length, 1);
    assert.equal(g.body.invitation.events[0].venue.name, 'Kalyana Mantapa');
    people.guest = g;
  });

  test('PUB-02 a recursive walk of the whole guest response finds none of the review, disclosure, definition or maintenance fields', async () => {
    const { body, token } = people.guest;
    const keys = new Set();
    const strings = [];
    const arrays = { depth: 0 };
    const walk = (value, path) => {
      if (Array.isArray(value)) {
        arrays.depth = Math.max(arrays.depth, 1);
        for (const [i, item] of value.entries()) walk(item, `${path}[${i}]`);
        return;
      }
      if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          keys.add(k);
          walk(v, `${path}.${k}`);
        }
        return;
      }
      if (typeof value === 'string') strings.push([path, value]);
    };
    walk(body, '$');
    assert.ok(keys.size > 20, `the walk saw ${keys.size} keys, so it is not walking the response`);
    assert.ok(strings.length > 5, 'the walk found no strings, so a value leak could not be caught');

    // §23's eleven names. Spelled as the database spells them, because a field that reached a guest
    // under another name would be a different bug — and `reviewed_by` and `reviewed_at` in
    // particular are not the kind of key a projection invents.
    for (const name of [...INTERNAL_COLUMNS, 'reviewed_at', 'status', 'machine_assisted',
      'definition_schema_version', 'scope_statement']) {
      assert.ok(!keys.has(name), `the guest response carries internal column ${name}`);
    }
    for (const w of DEFINITION_WORDS) {
      assert.ok(!keys.has(w), `the guest response carries raw definition field ${w}`);
    }
    for (const id of INTERNAL_ID_KEYS) {
      assert.ok(!keys.has(id), `the guest response carries internal identifier ${id}`);
    }
    // The credential itself, and every uuid the release has, must not be lying inside the answer.
    const flat = bytesOf(body);
    assert.ok(!flat.includes(token), 'the guest token appears inside the guest document');
    for (const id of [REL.r1, PACK.main, people.advisory.id, people.advisoryVersion.version_id]) {
      assert.ok(!flat.includes(id), `the guest response carries internal id ${id}`);
    }
    // The names above are refused as *keys*; these are refused as *values*, which is the half that
    // catches a reviewer's sentence travelling inside a field with an innocent name.
    for (const [label, phrase] of Object.entries(FORBIDDEN_VALUES)) {
      for (const [path, value] of strings) {
        assert.ok(!value.includes(phrase),
          `the guest response leaks ${label} in ${path}: ${value}`);
      }
    }
    // What the guest is given about the release instead: three keys, and the words with their
    // provenance attached.
    assert.deepEqual(Object.keys(body.invitation.tradition_pack).sort(),
      ['display_name', 'pack_key', 'release_number']);
    assert.deepEqual(Object.keys(body.invitation.sections.items[0].body).sort(),
      ['fallback_used', 'language', 'overrode_pack_text', 'source', 'text']);
    // The host's unpublished words stay in the host's document. `invitation.family_introduction` is
    // a real field of the guest DTO — Stage 3 built it for the no-pack editor — so the honest claim
    // here is the one that matters: the section a host tried to override still shows the reviewed
    // line, and PRV-05 owns the record that explains why.
    assert.equal(body.invitation.sections.items.find((s) => s.section_key === 'invitation').body.source,
      'reviewed_pack');
  });

  test('PUB-03 a guest with no credential, the wrong credential, and a revoked credential all get the same shape of answer', async () => {
    const none = await resolveAs('');
    assert.equal(none.status, 200, bytesOf(none.body));
    assert.deepEqual(none.body, { available: false });
    const wrong = await resolveAs('not-a-token-at-all');
    assert.deepEqual(wrong.body, { available: false });
    // The published one still works, so the two answers above are refusals rather than a transport
    // that stopped being reachable.
    const good = await resolveAs(people.guest.token);
    assert.equal(good.body.available, true);

    const rev = await api('hostA').rpc('revoke_invitation_publication', {
      p_wedding_id: people.advisory.id });
    assert.equal(rev.error, null, JSON.stringify(rev.error));
    // The third shape, made rather than assumed: the same credential, handed back after its
    // publication was withdrawn, gets the identical two-key answer as no credential and a wrong one.
    // Nothing distinguishes "I never had a link" from "my link was withdrawn", which is what keeps a
    // guest page from being a probe.
    const revoked = await resolveAs(people.guest.token);
    assert.equal(revoked.status, 200, bytesOf(revoked.body));
    assert.deepEqual(revoked.body, { available: false });
    // And the frozen version survives its publication being withdrawn: revocation closes the door,
    // it does not delete the document — the same rule RET-02 measures for retirement.
    assert.deepEqual(sqlRows(`select count(*) from public.invitation_versions
                               where wedding_id = '${people.advisory.id}'`), ['1'],
      'a revocation destroyed a frozen version');
  });
});

// ---------------------------------------------------------------------------
// RETIREMENT — the lifecycle, walked from a minted pack so the second run sees the same story the
// first did (`fixtures/stage5_mint_pair.sql` explains why no fixed row can serve both).
// ---------------------------------------------------------------------------
describe('§23 RETIREMENT', () => {
  const MINTED = { pack: randomUUID(), r1: randomUUID(), r2: randomUUID() };
  const RELEASE1_TEXT = 'Minted to be retired in the middle of a test.';
  const RELEASE2_TEXT = 'Minted to be approved after the retirement, '
    + 'and reached only by an explicit host.';

  test('RET-01 a wedding selects a minted release, freezes it and gives a guest a document', async () => {
    const lines = trustedFile('supabase/tests/api/fixtures/stage5_mint_pair.sql',
      { pkey: MINT_KEY, pid: MINTED.pack, r1: MINTED.r1, r2: MINTED.r2 });
    const minted = lines.filter((l) => l.startsWith('FIXTURE-MINT|'));
    assert.equal(minted.length, 2, `the mint printed ${bytesOf(minted)}`);
    const [one, two] = minted.map((l) => l.split('|').slice(1));
    assert.deepEqual([one[0], one[1], one[2]], [MINTED.r1, '1', 'approved']);
    assert.deepEqual([two[0], two[1], two[2]], [MINTED.r2, '2', 'reviewed'],
      'release 2 did not stop at reviewed, so the approval in RET-04 is not an event inside this run');
    // Both bindings were made by the trigger, on the draft → reviewed edge — the same one writer
    // WRT-02 refuses a customer access to.
    for (const [, , , digest] of [one, two]) {
      assert.match(digest, /^[0-9a-f]{12}$/, 'a minted release carries no review binding');
    }

    const chose = await pointAt('hostA', people.retire.id, MINTED.r1);
    assert.equal(chose.status, 200, bytesOf(chose.body));
    await completeFor('retire', MINTED.r1);
    const f = await freeze('hostA', people.retire.id);
    assert.equal(f.error, null, JSON.stringify(f.error));
    assert.equal(f.data.snapshot.tradition_pack_release.pack_key, MINT_KEY);
    const g = await publishAndResolve('retire', f.data);
    assert.equal(g.body.invitation.sections.items[0].body.text, RELEASE1_TEXT);
    people.retireV1 = { version: f.data, guest: g };
    MINTED.digest1 = one[3];
  });

  test('RET-02 the published guest document survives its release being retired, byte for byte, while a new freeze is refused', async () => {
    const before = people.retireV1.guest.body;
    // No HTTP route does this — that absence is the design, and it is why this one statement is
    // trusted rather than called, exactly as in the Stage 4 battery.
    trustedSql(`update public.tradition_pack_releases
                   set status = 'deprecated', deprecated_at = now()
                 where id = '${MINTED.r1}' and status = 'approved'`);

    const again = await freeze('hostA', people.retire.id);
    assert.equal(again.error?.code, '42501', JSON.stringify(again.error));
    assert.match(again.error.message,
      /^a new invitation version may only be frozen from an approved tradition pack release \(this one is deprecated\); a version already frozen from it is unaffected$/);
    // The preview still works, and now says so: this is the state the retired notice is built from,
    // and `status_is_current` is the whole of what a host is told.
    const p = await preview('hostA', people.retire.id);
    assert.equal(p.error, null, JSON.stringify(p.error));
    assert.equal(p.data.selected_release.status_is_current, false);
    assert.equal(p.data.selected_release.release_number, 1);
    assert.deepEqual(Object.keys(p.data.selected_release).sort(),
      ['definition_schema_version', 'display_name', 'pack_key', 'release_number',
        'status_is_current'], 'the preview handed a host a maintenance diary about the retirement');
    assert.deepEqual(previewBlocking(p), [],
      'retirement made an otherwise-complete document unpreviewable as a document');

    const after = await resolveAs(people.retireV1.guest.token);
    assert.equal(after.status, 200, bytesOf(after.body));
    assert.equal(bytesOf(after.body), bytesOf(before),
      'a guest document moved because the catalogue behind its release did');
  });

  test('RET-03 a retired release cannot newly be selected, by its own host or by anybody else', async () => {
    // The wedding that already points at it may keep pointing at it (RET-02 owns that state); no
    // wedding may start. Ruling A1 is about the difference, and the two gates say it in two
    // different sentences.
    const outsider = await pointAt('hostB', people.victim.id, MINTED.r1);
    assert.equal(outsider.status, 403, bytesOf(outsider.body));
    assert.match(outsider.body.message, /^a wedding may only select an approved/);
    // Not readable either, to an account whose weddings never pointed at it.
    const seen = await read('tradition_pack_releases', `id&id=eq.${MINTED.r1}`, { as: 'hostB' });
    assert.deepEqual(seen.body, [], 'a retired release was visible to a host who never chose it');
    const mine = await read('tradition_pack_releases', `id,status&id=eq.${MINTED.r1}`,
      { as: 'hostA' });
    assert.deepEqual(mine.body, [{ id: MINTED.r1, status: 'deprecated' }],
      'the owning host lost the historical visibility ruling A1 keeps for it');
  });

  test('RET-04 approving a newer release moves nothing, and only an explicit host selection puts a second version on it', async () => {
    // The approval, by the maintenance route, while the wedding is pointing at the retired release.
    trustedSql(`update public.tradition_pack_releases
                   set status = 'approved', approved_at = now()
                 where id = '${MINTED.r2}' and status = 'reviewed'`);

    // 1. the wedding did not switch. This is the case the whole journey exists for: a catalogue
    //    event is not a host decision, and nothing may make it one.
    const pointer = sqlRows(`select coalesce(tradition_pack_release_id::text,'(none)')
                               from public.weddings where id = '${people.retire.id}'`);
    assert.deepEqual(pointer, [MINTED.r1],
      'a new approval silently moved a live wedding onto another release');
    const w = await read('weddings', `id,tradition_pack_release_id&id=eq.${people.retire.id}`,
      { as: 'hostA' });
    assert.deepEqual(w.body, [{ id: people.retire.id, tradition_pack_release_id: MINTED.r1 }]);

    // 2. the guest document from V1 is still the same bytes.
    const same = await resolveAs(people.retireV1.guest.token);
    assert.equal(bytesOf(same.body), bytesOf(people.retireV1.guest.body));

    // 3. a freeze is still refused, so "nothing moved" is a live fact rather than a historical one.
    const refused = await freeze('hostA', people.retire.id);
    assert.match(refused.error?.message ?? '', /this one is deprecated/);

    // 4. the newer release is now selectable, and only the host can decide to take it.
    const offered = await read('tradition_pack_releases',
      `id,release_number,status&pack_id=eq.${MINTED.pack}&order=release_number.asc`,
      { as: 'hostA' });
    assert.deepEqual(offered.body, [
      { id: MINTED.r1, release_number: 1, status: 'deprecated' },
      { id: MINTED.r2, release_number: 2, status: 'approved' },
    ], bytesOf(offered.body));

    const chose = await pointAt('hostA', people.retire.id, MINTED.r2);
    assert.equal(chose.status, 200, bytesOf(chose.body));
    const second = await freeze('hostA', people.retire.id);
    assert.equal(second.error, null, JSON.stringify(second.error));
    assert.equal(second.data.version_number, 2);
    assert.equal(second.data.snapshot.tradition_pack_release.release_number, 2);
    // Both rows' pins, read from the database for the same reason FRZ-02 reads one: the snapshot
    // carries no uuid on purpose, so the version row is the only place a pin exists.
    assert.deepEqual(sqlRows(`select coalesce(tradition_pack_release_id::text,'(none)')
                                from public.invitation_versions
                               where wedding_id = '${people.retire.id}'
                               order by version_number`), [MINTED.r1, MINTED.r2],
      'the two frozen versions do not each carry the release they were made from');
    const body = second.data.snapshot.sections.items[0];
    assert.equal(body.body_text, RELEASE2_TEXT,
      'V2 was frozen from the newer release but carries the older release\'s wording');

    // 5. the single live link moves, and the frozen bytes do not. A wedding has exactly one guest
    //    address, so publishing V2 repoints that address rather than minting a second credential —
    //    measured here, and Stage 3 owns the rule (the raw token appears in a response only in the
    //    call that created it). The thing the retirement is forbidden to move is the *frozen
    //    document*, not the link, and RET-02 already proved byte-identity across the retirement
    //    itself while the link still pointed at V1.
    const v2 = await api('hostA').rpc('publish_invitation_version', {
      p_wedding_id: people.retire.id, p_version_id: second.data.version_id, p_expires_at: null });
    assert.equal(v2.error, null, JSON.stringify(v2.error));
    assert.equal(v2.data.link_reused, true,
      'a second publish minted a second credential, so this wedding now has two live links');
    assert.equal(v2.data.path, null, 'a reused link returned a raw credential a second time');
    assert.equal(v2.data.version_id, second.data.version_id);

    const moved = await resolveAs(people.retireV1.guest.token);
    assert.equal(moved.status, 200, bytesOf(moved.body));
    assert.equal(moved.body.invitation.sections.items[0].body.text, RELEASE2_TEXT,
      'the address the host deliberately moved did not follow the version they published');

    // Both documents, read from their own rows rather than from a link: each version keeps the
    // wording of the release it was frozen from, whatever the live address now shows.
    assert.deepEqual(sqlRows(`select version_number || '|' || (snapshot -> 'sections' -> 'items'
                                     -> 0 ->> 'body_text')
                                from public.invitation_versions
                               where wedding_id = '${people.retire.id}'
                               order by version_number`),
      [`1|${RELEASE1_TEXT}`, `2|${RELEASE2_TEXT}`],
      'a frozen version lost the wording it was frozen with');
    // The mechanism the one-live-link rule runs on, as one active publication per wedding.
    assert.deepEqual(sqlRows(`select v.version_number || ' ' || p.status
                                from public.publications p
                                join public.invitation_versions v on v.id = p.version_id
                               where p.wedding_id = '${people.retire.id}'
                               order by v.version_number`), ['1 revoked', '2 active'],
      'publishing V2 left more than one publication live on one wedding');
    // The state a real host is left in: one address, two frozen releases behind it, the older one
    // still readable from the row it was frozen into.
    people.retireV2 = { token: people.retireV1.guest.token, version: second.data };
  });

  test('RET-05 what this run leaves behind, and the two things it must not have touched', async () => {
    // Ruling A2 refuses the DELETE of a release that has left draft, so the minted pack is
    // permanent residue in this repository's local stack. It is named here rather than asserted
    // away, and the count is read from the database at the end of the run.
    const rows = sqlRows(`select p.pack_key || ' ' || r.release_number || ' ' || r.status
        from public.tradition_pack_releases r join public.tradition_packs p on p.id = r.pack_id
        where p.pack_key like 'stage5_%' order by 1`);
    assert.ok(rows.length >= 5, `the Stage 5 fixture catalogue shrank to ${rows.length} rows`);
    console.log(`  Stage 5 fixture rows now in the local stack: ${rows.length}`);
    for (const line of rows) console.log(`    ${line}`);

    // The seed's four packs are exactly as their file declares them: this run spent only minted
    // rows, which is what makes the second run see the same story.
    const seed = sqlRows(`select r.id || '|' || r.status from public.tradition_pack_releases r
                            join public.tradition_packs p on p.id = r.pack_id
                           where p.pack_key = 'stage5_http_v2' order by r.release_number`);
    assert.deepEqual(seed, [`${REL.r1}|approved`, `${REL.r2}|approved`],
      'the retirement journey spent a fixed seed row, so the next run cannot have one');

    // §23: "Do not approve the Tamil candidate." The load-bearing claim is about *this stack at the
    // end of this run*, so it is written as a refusal rather than as a property of a row that may or
    // may not be here: no release whose provenance points at the candidate artifact may hold any
    // state past draft, and none may carry a reviewer. Read that way, the case says the same thing
    // whether the Stage 4 candidate probe happens to be in the database or not — and it is measured
    // that the artifact never got here by any route this battery knows:
    // `stage4_tradition_packs.test.mjs` CAND-01 offers it to the database as a draft and takes it
    // back again, and nothing in this file touches it.
    const pastDraft = sqlRows(`select p.pack_key || '|' || r.status
                                  from public.tradition_pack_releases r
                                  join public.tradition_packs p on p.id = r.pack_id
                                 where r.source_reference like '%tamil-english-foundation%'
                                   and r.status <> 'draft'`);
    assert.deepEqual(pastDraft, [],
      'the Tamil candidate left draft, which §23 forbids and no case in this file is allowed to do');
    const credited = sqlRows(`select p.pack_key || '|' || r.status
                                 from public.tradition_pack_releases r
                                 join public.tradition_packs p on p.id = r.pack_id
                                where r.source_reference like '%tamil-english-foundation%'
                                  and (r.reviewed_by is not null or not r.machine_assisted)`);
    assert.deepEqual(credited, [],
      'a candidate-shaped release carries a reviewer or claims human authorship');
    // And the states the *probe* row is allowed to be in, read by name so the run reports which
    // world it ran in rather than leaving an empty result set to mean "nothing happened".
    const candidate = sqlRows(`select p.pack_key || '|' || r.status || '|' || r.machine_assisted::text
                                 || '|' || coalesce(r.reviewed_by::text,'(nobody)')
                                from public.tradition_pack_releases r
                                join public.tradition_packs p on p.id = r.pack_id
                               where p.pack_key = 'stage4_candidate_probe'`);
    for (const line of candidate) {
      const [key, status, machine, reviewer] = line.split('|');
      assert.equal(status, 'draft', `${key} is no longer a draft`);
      assert.equal(machine, 'true', `${key} lost its machine disclosure`);
      assert.equal(reviewer, '(nobody)', `${key} was credited to a reviewer`);
    }
    console.log(`  Tamil-candidate-shaped rows visible here: ${candidate.length}`);
  });
});

/** The blocking half of a preview answer, named because four cases read it. */
function previewBlocking(r) {
  return r.data.issues.filter((i) => i.blocking);
}

/** Fill a wedding out until every v2 arm is satisfied. Its own function rather than PRV's inline
 *  copy because the retirement journey needs it too, and a document that quietly differs between
 *  the two would make RET-02's freeze refusal about the wrong thing. */
async function completeFor(slot, releaseId) {
  const wedding = people[slot].id;
  const { error: de } = await client('hostA').from('invitation_drafts')
    .update({ content: { closing: HOST.closing } }).eq('wedding_id', wedding);
  assert.equal(de, null, JSON.stringify(de));
  const { error: pe } = await client('hostA').from('wedding_people').insert({
    wedding_id: wedding, display_name: 'L. Mary', role_key: 'mother', role_label: 'Mother',
    group_key: 'bride', group_label: "The bride's family",
  });
  assert.equal(pe, null, JSON.stringify(pe));
  // A venue of this wedding's own: `venues` is scoped by owner, so reusing another wedding's row
  // would be a data-model lie before it was a shortcut.
  const { data: venue, error: ve } = await client('hostA').from('venues').insert({
    wedding_id: wedding, name: 'Rathna Bhavan', address_text: '5 High Court Road, Chennai',
  }).select('id').single();
  assert.equal(ve, null, JSON.stringify(ve));
  const { error: ee } = await client('hostA').from('wedding_events').insert({
    wedding_id: wedding, event_key: 'muhurtham', display_name: 'Muhurtham',
    starts_at_local: '2026-11-14T07:30:00', venue_id: venue.id,
  });
  assert.equal(ee, null, JSON.stringify(ee));
  const p = await preview('hostA', wedding);
  assert.equal(p.error, null, JSON.stringify(p.error));
  assert.deepEqual(previewBlocking(p), [], bytesOf(p.data.issues));
  assert.equal(p.data.selected_release.pack_key, MINT_KEY,
    `the document under test is not standing on the minted release ${releaseId}`);
}
