// Stage 3 §6/§C/§M — the publication boundary, qualified over HTTP.
//
// `supabase/tests/stage3/30_publication.sql` proves the same properties with `SET
// ROLE` inside psql. That is the right place to prove a constraint or an ACL, and the
// wrong place to prove anything about the transport: it never had PostgREST choosing a
// schema profile, never had Kong turning an API key into a role, never had a request
// header arriving as `request.headers`, and never had a browser-shaped client try to
// read a token out of a query string. This file is those halves.
//
// The properties it exists to hold:
//   * `api` is the only callable surface, it is reachable, and `private` is not
//     reachable as a profile at all — a grant the schema-cache cannot see is a grant
//     nobody can use.
//   * The anonymous door is one function, takes no argument, and reads its credential
//     from a header. Every way of asking that could put the secret in a URL fails.
//   * The host RPCs take identity from the JWT and nowhere else, so a request cannot
//     name another owner's wedding and get an answer that says whether it exists.
//   * What a guest receives is a whitelist, and what a refusal looks like is one
//     value, byte for byte, for every kind of bad credential.
//
// Not part of `npm test`; run it with `bash supabase/tests/api/run.sh`, which checks
// the stack is this repository's own before this file is loaded.
//
// Error codes below are measured against this stack (PostgREST v16.3, Kong 2.8.1,
// GoTrue v2.197.0, PostgreSQL 17.6), not guessed:
//   grant refusal ................. 42501 "permission denied for function <name>"
//   function-raised refusal ....... its own ERRCODE, hint null
//   schema not exposed ............ PGRST106 "Only the following schemas are exposed: public, api"
//   table not in a profile ........ PGRST205
//   wrong arity/signature ......... PGRST202

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

// The runner exports its tag so the trusted cleanup below targets exactly this run's
// accounts. When the file is run directly the tag is generated here instead.
const RUN_TAG = process.env.STAGE3_RUN_TAG
  ?? `stage3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// The tag is interpolated into the trusted cleanup statement below, so an inherited
// value is only accepted if it is the shape this file generates.
if (!/^[a-z0-9-]+$/.test(RUN_TAG)) {
  throw new Error(`refusing to run: STAGE3_RUN_TAG=${RUN_TAG} is not a run tag`);
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

const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}-${RUN_TAG}`;

// Which container is this project's own database. The runner passes the name it has
// already verified; standing alone, the same name is derived from this repository's
// config.toml rather than from anything a hosted project could supply.
const PROJECT_ID = (() => {
  const toml = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');
  const m = /^project_id\s*=\s*"?([^"\n]+?)"?\s*$/m.exec(toml);
  if (!m) throw new Error('no project_id in supabase/config.toml');
  return m[1].trim();
})();
const DB_CONTAINER = process.env.STAGE3_DB_CONTAINER ?? `supabase_db_${PROJECT_ID}`;
// This name reaches a `docker exec ... psql -c` command line below, so it is checked
// to be the shape this file generates rather than an arbitrary string. RUN_TAG, which
// the same command interpolates, is validated where it is declared.
if (!/^[A-Za-z0-9_.-]+$/.test(DB_CONTAINER)) {
  throw new Error(`refusing to run: STAGE3_DB_CONTAINER=${DB_CONTAINER} is not a container name`);
}

// Wording used to make two frozen versions differ. Declared once because three tests
// read it from different sides of the boundary.
const V2_WORDING = 'the second wording, frozen only in v2';
const DRAFT_AFTER_V2 = `${V2_WORDING}, and then the draft moved on`;

// `private.access_tokens` has no HTTP surface — that absence is the design — so the
// credential history this suite mints can only be cleared by the trusted local route.
// This is a local `docker exec` against the container the runner already named; it
// makes no network request, and it is scoped to the accounts created by this run.
function trustedCleanup() {
  const ownerIds = `(select w.id from public.weddings w join auth.users u on u.id = w.owner_user_id
                      where u.email like '%+${RUN_TAG}@example.test')`;
  const sql = `
    delete from private.access_tokens where wedding_id in ${ownerIds};
    delete from public.publications where wedding_id in ${ownerIds};
    delete from public.invitation_versions where wedding_id in ${ownerIds};
    delete from public.weddings where id in ${ownerIds};
  `;
  execFileSync('docker', ['exec', '-i', DB_CONTAINER,
    'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql],
  { stdio: ['ignore', 'inherit', 'inherit'] });
}

const hosts = {};
const client = (who) => hosts[who].client;
const api = (who) => hosts[who].client.schema('api');
const anonApi = () => createClient(url, anonKey, { auth: { persistSession: false } }).schema('api');

/** One SQL read against this project's own container, pipe-separated and row-only.
 *  The catalogue assertions below need what the database says about its own grants, which
 *  no HTTP route reports — PostgREST will happily answer a call whose grant arrived after
 *  its schema cache was loaded, and `API01` is where the HTTP half is checked. */
function sqlRows(query) {
  const out = execFileSync('docker', ['exec', '-i', DB_CONTAINER,
    'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', query],
  { encoding: 'utf8' });
  return out.split(/\r?\n/).filter(line => line.length > 0);
}

async function signUp(who) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: emailFor(who), password: PASSWORD });
  assert.equal(error, null, `signup failed for ${who}`);
  assert.ok(data.session, 'expected a session immediately');
  return { client: c, userId: data.user.id };
}

// The guest's transport, spelled out rather than hidden behind the library: the
// credential is a request header, and the call names no argument.
async function resolveAs(token, { as = 'anon', withHeader = true } = {}) {
  const key = as === 'anon' ? anonKey : hosts[as] === undefined ? anonKey : hosts[as].accessToken;
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (as !== 'anon') headers.Authorization = `Bearer ${key}`;
  if (withHeader && token !== undefined) headers['x-invitation-token'] = token;
  const res = await fetch(`${url}/rest/v1/rpc/resolve_public_invitation`, {
    method: 'POST',
    headers: { ...headers, 'Content-Profile': 'api' },
    body: '{}',
  });
  return { status: res.status, code: res.status, body: await res.json() };
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const PATH_SHAPE = /^\/i\/[A-Za-z0-9_-]{43}$/;
// The address is `/i/` plus the credential — three characters of prefix, not four.
// Derived in one place so the length of that prefix is not re-counted at each call.
const PATH_PREFIX = '/i/';
const tokenOf = (path) => {
  assert.match(path, PATH_SHAPE);
  return path.slice(PATH_PREFIX.length);
};

function trustedSql(statement) {
  execFileSync('docker', ['exec', '-i', DB_CONTAINER,
    'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement],
  { stdio: ['ignore', 'inherit', 'inherit'] });
}

/** One trusted DELETE, for the state no HTTP route can produce: a wedding whose
 *  publication is live while its credential row is not. `private` is deliberately
 *  unreachable from the API — that is the boundary this suite is testing — so the only
 *  honest way to build the case is the same local `docker exec` route `trustedCleanup`
 *  uses. The id is a wedding this run created and read back from an API response, and it
 *  is validated as a uuid before it reaches the statement. */
function trustedDropLiveCredential(weddingId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(weddingId)) {
    throw new Error(`refusing to run: ${weddingId} is not a uuid`);
  }
  trustedSql(`delete from private.access_tokens where wedding_id = '${weddingId}' and revoked_at is null`);
}

before(async () => {
  hosts.hostA = await signUp('pub-host-a');
  hosts.hostB = await signUp('pub-host-b');
  for (const who of ['hostA', 'hostB']) {
    const { data, error } = await hosts[who].client
      .from('weddings')
      .insert({
        owner_user_id: hosts[who].userId,
        title: who === 'hostA' ? 'Asha weds Bala' : 'Chitra weds Deepa',
        primary_language: who === 'hostA' ? 'en' : 'ta',
      })
      .select()
      .single();
    assert.equal(error, null, `${who} could not create its own wedding: ${error?.message}`);
    hosts[who].wedding = data;
  }
  // A venue and an event on host A's wedding, written by its owner through the same
  // API the tests probe. Without a real event the map-link test below would read an
  // empty list and call it a refusal.
  const { data: venue, error: venueErr } = await hosts.hostA.client.from('venues').insert({
    wedding_id: hosts.hostA.wedding.id,
    name: 'Kalyana Mantapa',
    address_text: '100 Pillar Road, Madurai',
    map_url: 'https://maps.example.test/kalyana-mantapa',
  }).select('id').single();
  assert.equal(venueErr, null, `the control venue could not be written: ${venueErr?.message}`);
  hosts.hostA.venue = venue;

  const { data: event, error: eventErr } = await hosts.hostA.client.from('wedding_events').insert({
    wedding_id: hosts.hostA.wedding.id,
    event_key: 'muurtham',
    display_name: 'Muurtham',
    starts_at_local: '2026-11-14T07:30:00',
    venue_id: venue.id,
  }).select('id').single();
  assert.equal(eventErr, null, `the control event could not be written: ${eventErr?.message}`);
  hosts.hostA.event = event;

  // A third wedding with no language chosen, so the language refusal is about the
  // language and not about anything else in the row.
  const { data: bare, error: bareErr } = await hosts.hostA.client
    .from('weddings').insert({ owner_user_id: hosts.hostA.userId, title: 'No language yet' })
    .select().single();
  assert.equal(bareErr, null, `the control wedding without a language could not be created: ${bareErr?.message}`);
  hosts.bareWedding = bare;
});

after(async () => {
  // Child-before-parent, in the order the non-cascading foreign keys above demand:
  // credential, then publication, then frozen history, then the wedding itself. The
  // draft row goes with the wedding because its own key is the only cascade here.
  trustedCleanup();
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
  const ids = Object.values(hosts).filter((h) => h.userId).map((h) => h.userId);
  const { data: left, error } = await svc.from('weddings').select('id').in('owner_user_id', ids);
  assert.equal(error, null, error?.message);
  assert.deepEqual(left, [], 'teardown left a wedding behind');
  for (const id of ids) {
    const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    assert.ok(res.ok, `teardown could not remove a synthetic account (HTTP ${res.status})`);
  }
});

// ---------------------------------------------------------------------------
// §C — the surface, as a caller over HTTP can actually observe it
// ---------------------------------------------------------------------------
describe('§6.1 what is callable over HTTP', () => {
  // Every argument the function declares, spelled exactly: PostgREST resolves a call
  // by signature, so a short argument list is refused with PGRST202 by the router
  // before the grant is ever consulted — which would let this test pass for the wrong
  // reason if any name were missing.
  const HOST_FUNCTIONS = [
    ['create_invitation_version', { p_wedding_id: null }],
    ['publish_invitation_version', { p_wedding_id: null, p_version_id: null, p_expires_at: null }],
    ['revoke_invitation_publication', { p_wedding_id: null }],
    ['rotate_invitation_token', { p_wedding_id: null }],
    ['preview_invitation', { p_wedding_id: null }],
    ['get_invitation_publication_state', { p_wedding_id: null }],
  ];

  test('API01 the api profile is reachable, and an object inside it that is not a function is not there', async () => {
    // `private` as a profile is refused by name, and the refusal lists what is
    // exposed, so the boundary is legible from the outside rather than implied.
    const res = await fetch(`${url}/rest/v1/weddings?select=id`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Accept-Profile': 'private' },
    });
    assert.equal(res.status, 406);
    const body = await res.json();
    assert.equal(body.code, 'PGRST106');
    assert.match(body.message, /Invalid schema: private/);
    assert.match(body.hint, /exposed: public, api/);

    const tables = await fetch(`${url}/rest/v1/access_tokens?select=*`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Accept-Profile': 'api' },
    });
    assert.equal(tables.status, 404);
    assert.equal((await tables.json()).code, 'PGRST205');
  });

  test('API02 an anonymous key cannot call any host function, and is told so at the function, not the schema', async () => {
    for (const [name, args] of HOST_FUNCTIONS) {
      const { data, error } = await anonApi().rpc(name, { ...args, p_wedding_id: hosts.hostA.wedding.id });
      assert.equal(data, null, `anon called ${name}`);
      assert.equal(error?.code, '42501', `anon got something other than a privilege refusal from ${name}`);
      // "for function" rather than "for schema" is the proof that the refusal is this
      // grant on its own merits, and not `api` being out of reach for this caller —
      // which the control below shows is not the case.
      assert.match(error.message, new RegExp(`permission denied for function ${name}`));
      assert.equal(error.hint, null, `a grant hint was handed to an anonymous caller by ${name}`);
    }

    // Positive control: the same anonymous client, the same profile, one function
    // that is meant for it. Without this, six refusals could just mean "anon cannot
    // reach api at all".
    const ok = await anonApi().rpc('resolve_public_invitation');
    assert.equal(ok.error, null, `the control call was refused too: ${ok.error?.message}`);
    assert.deepEqual(ok.data, { available: false });
  });

  test('API03 the service key is not a browser and cannot use the browser boundary', async () => {
    const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await svc.schema('api').rpc('resolve_public_invitation');
    assert.equal(data, null, 'a server key resolved a guest invitation through the browser door');
    assert.equal(error?.code, '42501');
    // Measured: `service_role` holds no USAGE on `api` at all, so PostgreSQL stops the
    // request at the schema and never reaches the function's own EXECUTE check. Both
    // layers refuse; the schema layer is simply first.
    assert.match(error.message, /permission denied for schema api/);
    assert.equal(error.hint, null, `a grant hint was handed to a server key: ${error.hint}`);
  });

  test('API04 an owner holds EXECUTE on every host verb, and the refusal that follows is the function’s own', async () => {
    // The grant half of API02. A caller without EXECUTE is stopped by PostgreSQL with
    // "permission denied for function <name>" before any argument is read; an owner who
    // names somebody else's wedding gets the function's own sentence instead. Both arrive
    // as 42501 — the ownership check raises that SQLSTATE deliberately, so the message is
    // the only honest discriminator, and a verb that answered with the grant sentence here
    // would mean the owner's grant had quietly gone missing.
    for (const [name, args] of HOST_FUNCTIONS) {
      const { error } = await api('hostA').rpc(name, { ...args, p_wedding_id: hosts.hostB.wedding.id });
      assert.notEqual(error, null, `${name} answered another owner's wedding`);
      assert.doesNotMatch(error.message, /permission denied for (function|schema)/,
        `${name} refused an owner at the grant rather than in its own logic`);
      assert.match(error.message, /the caller may not /,
        `${name} refused with something other than the ownership sentence: ${error.message}`);
    }

    // Positive control beside six refusals: the same role and profile, this caller's own
    // wedding, answered with data. Without it the refusals could describe a surface that
    // refuses everyone.
    const { data, error } = await api('hostA').rpc('preview_invitation', {
      p_wedding_id: hosts.hostA.wedding.id,
    });
    assert.equal(error, null, `the owner's own preview was refused: ${error?.message}`);
    assert.ok(data && typeof data === 'object');
  });

  test('API05 no function in the public profile survives the rename', async () => {
    // Stage 3 moved these out of `public`; a leftover there would be a second,
    // un-audited door with the same names.
    for (const name of ['create_invitation_version', 'resolve_public_invitation', 'preview_invitation']) {
      const { error } = await client('hostA').rpc(name, {});
      assert.notEqual(error, null, `public.${name} still exists over REST`);
      assert.equal(error.code, 'PGRST202');
    }
  });

  test('API36 internal_api is not a profile, so its privileged bodies are not addressable at all', async () => {
    // Closure-repair directive §6. `internal_api` holds the SECURITY DEFINER bodies the
    // wrappers delegate to, and API34 shows that a browser role can EXECUTE them — which
    // is not a hole a grant list can close on its own, because PostgREST only serves the
    // schemas in its config. This is where that non-exposure is measured rather than
    // asserted from a TOML file: the same three ways a client can name a schema, each
    // refused before any function is looked up. Codes and wording below were taken from
    // these requests against this stack, not inferred.
    const profiled = await fetch(`${url}/rest/v1/weddings?select=id`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Accept-Profile': 'internal_api' },
    });
    assert.equal(profiled.status, 406);
    const readBack = await profiled.json();
    assert.equal(readBack.code, 'PGRST106');
    assert.match(readBack.message, /Invalid schema: internal_api/);
    assert.match(readBack.hint, /exposed: public, api/);

    const wrote = await fetch(`${url}/rest/v1/rpc/resolve_public_invitation`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json', 'Content-Profile': 'internal_api' },
      body: '{}',
    });
    assert.equal(wrote.status, 406);
    assert.equal((await wrote.json()).code, 'PGRST106');

    // And through the client the product actually uses, for both shapes of call — a
    // function and a table — so the refusal is about the schema, not about which verb.
    const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
    const rpc = await svc.schema('internal_api').rpc('resolve_public_invitation');
    assert.equal(rpc.error?.code, 'PGRST106', 'the privileged schema was callable through the client');
    const rel = await svc.schema('internal_api').from('access_tokens').select('*');
    assert.equal(rel.error?.code, 'PGRST106');

    // The name does not survive being qualified either: PostgREST reads it as a
    // function inside the served profile, which does not exist.
    const qualified = await fetch(`${url}/rest/v1/rpc/internal_api.resolve_public_invitation`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json', 'Content-Profile': 'api' },
      body: '{}',
    });
    assert.equal(qualified.status, 404);
    assert.equal((await qualified.json()).code, 'PGRST202');

    // Positive control beside four refusals: the wrapper beside the body that was just
    // refused is still callable, so none of the above is `api` having gone missing.
    const reachable = await anonApi().rpc('resolve_public_invitation');
    assert.equal(reachable.error, null, reachable.error?.message);
    assert.deepEqual(reachable.data, { available: false });
  });

  test('API37 the browser roles need USAGE on internal_api, and that is the whole size of the grant', async () => {
    // The one privilege the wrapper split was forced to take, measured rather than
    // argued. PostgreSQL authorises a nested call as the *invoking* role, so an
    // `api` wrapper that runs as `authenticated` must be able to name the body in
    // `internal_api` as `authenticated` too. If that is true, revoking the schema USAGE
    // has to break the browser verbs — and if revoking it broke nothing, the grant would
    // be decoration and the design claim would be wrong. Both halves are checked here,
    // and the grant is put back in a `finally`, because every suite after this one reads
    // the ACL as a literal.
    const weddingId = hosts.hostA.wedding.id;
    const call = () => api('hostA').rpc('preview_invitation', { p_wedding_id: weddingId });

    const baseline = await call();
    assert.equal(baseline.error, null, `the control preview was already failing: ${baseline.error?.message}`);
    assert.ok(baseline.data && typeof baseline.data === 'object');

    try {
      trustedSql('revoke usage on schema internal_api from authenticated');
      const { error } = await call();
      assert.notEqual(error, null,
        'the host verbs still worked with no USAGE on the privileged schema, so the grant was never load-bearing');
      assert.equal(error.code, '42501');
      // "for schema internal_api" rather than "for function preview_invitation" is the
      // proof that the wrapper itself was reachable and the *nested* name was not — the
      // distinction that says which privilege the split actually cost.
      assert.match(error.message, /permission denied for schema internal_api/, error.message);
    } finally {
      trustedSql('grant usage on schema internal_api to authenticated');
    }

    const restored = await call();
    assert.equal(restored.error, null, `the preview did not come back after re-granting: ${restored.error?.message}`);
    assert.deepEqual(
      sqlRows("select nspacl::text from pg_namespace where nspname = 'internal_api'"),
      ['{postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres}'],
      'the run left the privileged schema with a different ACL than the migration writes');
  });
});

// ---------------------------------------------------------------------------
// §D — identity comes from the JWT
// ---------------------------------------------------------------------------
describe('§6.2 the host RPCs decide ownership from the token', () => {
  test('API06 the owner creates a version, and the answer is the version, not a row count', async () => {
    const { data, error } = await api('hostA').rpc('create_invitation_version', {
      p_wedding_id: hosts.hostA.wedding.id,
    });
    assert.equal(error, null, error?.message);
    assert.deepEqual(Object.keys(data).sort(), ['snapshot', 'version_id', 'version_number']);
    assert.equal(data.version_number, 1);
    hosts.hostA.v1 = data;
  });

  test('API07 a second version freezes different words, and the first keeps its own', async () => {
    // The draft is changed *before* v2 is created. Two versions with identical
    // snapshots would let every "the guest is reading the published version"
    // assertion below pass by accident, so the pair is made to differ in the one
    // field a guest reads.
    const { data: draftEdit, error: editErr } = await client('hostA').from('invitation_drafts')
      .update({ content: { welcome: V2_WORDING } })
      .eq('wedding_id', hosts.hostA.wedding.id).select('content').single();
    assert.equal(editErr, null, editErr?.message);
    assert.equal(draftEdit.content.welcome, V2_WORDING);

    const { data, error } = await api('hostA').rpc('create_invitation_version', {
      p_wedding_id: hosts.hostA.wedding.id,
    });
    assert.equal(error, null, error?.message);
    assert.equal(data.version_number, 2);
    hosts.hostA.v2 = data;

    assert.equal(data.snapshot.draft.welcome, V2_WORDING);
    assert.notEqual(hosts.hostA.v1.snapshot.draft.welcome, V2_WORDING,
      'v1 already carried this wording, so freezing v2 proves nothing');

    // The draft then moves on again, so a guest reading a frozen version can be
    // told apart from a guest reading whatever is typed right now.
    const { error: laterErr } = await client('hostA').from('invitation_drafts')
      .update({ content: { welcome: DRAFT_AFTER_V2 } })
      .eq('wedding_id', hosts.hostA.wedding.id);
    assert.equal(laterErr, null, laterErr?.message);
  });

  test('API08 a foreign wedding is refused with one sentence that reveals nothing about it', async () => {
    for (const [label, target] of [
      ['another account’s complete wedding', hosts.hostB.wedding.id],
      ['a wedding that never existed', '00000000-0000-0000-0000-000000000000'],
    ]) {
      const { error } = await api('hostA').rpc('create_invitation_version', { p_wedding_id: target });
      assert.equal(error?.code, '42501', `host A was allowed to version ${label}`);
      assert.match(error.message, /the caller may not create a version of this wedding/);
      // The same words for both halves is the assertion: an outsider cannot tell a
      // real foreign row from an invented one.
      assert.equal(error.hint, null);
      assert.equal(error.details, null);
    }
  });

  test('API09 a missing language is refused, and only to the owner who can see it', async () => {
    const { error } = await api('hostA').rpc('create_invitation_version', {
      p_wedding_id: hosts.bareWedding.id,
    });
    assert.equal(error?.code, '23514');
    assert.match(error.message, /choose the invitation language before creating a version/);

    // The same wedding, asked for by somebody else, must produce the ownership
    // sentence rather than the content sentence.
    const foreign = await api('hostB').rpc('create_invitation_version', {
      p_wedding_id: hosts.bareWedding.id,
    });
    assert.match(foreign.error.message, /the caller may not create a version of this wedding/);
  });

  test('API10 a malformed identifier is a typed rejection, not a crash and not an existence answer', async () => {
    const { error } = await api('hostA').rpc('create_invitation_version', {
      p_wedding_id: 'not-a-uuid',
    });
    assert.equal(error?.code, '22P02');
    assert.doesNotMatch(error.message, /trace|panic|plpgsql/i);
  });

  test('API11 preview reaches the owner before anything is published', async () => {
    const { data, error } = await api('hostA').rpc('preview_invitation', {
      p_wedding_id: hosts.hostA.wedding.id,
    });
    assert.equal(error, null, error?.message);
    assert.equal(data.welcome, DRAFT_AFTER_V2);
    // The language a guest needs to render the text, as the pair the host chose
    // rather than as a single code the renderer would have to guess the rest from.
    assert.deepEqual(data.language, { primary: 'en', additional: [] });
    const foreign = await api('hostB').rpc('preview_invitation', { p_wedding_id: hosts.hostA.wedding.id });
    assert.equal(foreign.error?.code, '42501');
    assert.match(foreign.error.message, /the caller may not preview this wedding/);
  });
});

// ---------------------------------------------------------------------------
// §F/§G/§H — publish, and the credential that comes back
// ---------------------------------------------------------------------------
describe('§6.3 publishing mints a link and freezes a version', () => {
  test('API12 publish returns a 43-character URL-safe address exactly once', async () => {
    const { data, error } = await api('hostA').rpc('publish_invitation_version', {
      p_wedding_id: hosts.hostA.wedding.id, p_version_id: hosts.hostA.v1.version_id, p_expires_at: null,
    });
    assert.equal(error, null, error?.message);
    assert.equal(data.link_reused, false);
    assert.match(data.path, PATH_SHAPE);
    assert.match(tokenOf(data.path), TOKEN_SHAPE);
    hosts.hostA.token = tokenOf(data.path);
    hosts.hostA.publicationId = data.publication_id;
  });

  test('API13 the state a host reads back never carries credential material', async () => {
    const { data, error } = await api('hostA').rpc('get_invitation_publication_state', {
      p_wedding_id: hosts.hostA.wedding.id,
    });
    assert.equal(error, null, error?.message);
    assert.equal(data.link_active, true);
    assert.equal(data.version_number, 1);
    const text = JSON.stringify(data);
    assert.ok(!text.includes(hosts.hostA.token), 'the raw token came back from the state read');
    assert.doesNotMatch(text, /[A-Za-z0-9_-]{40,}/, 'something token-shaped is in the state answer');
  });

  test('API14 a published credential resolves for a visitor with no session', async () => {
    const r = await resolveAs(hosts.hostA.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.available, true);
    assert.ok(r.body.invitation.title);
  });

  test('API15 the token never appears in a URL, and the only URL that could carry it is refused', async () => {
    // The function takes no argument, so every spelling of "token in the query
    // string" is a signature that does not exist. Measured, not assumed.
    for (const q of [`?p_token=${hosts.hostA.token}`, `?token=${hosts.hostA.token}`, `?p_raw_token=${hosts.hostA.token}`]) {
      const res = await fetch(`${url}/rest/v1/rpc/resolve_public_invitation${q}`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Accept-Profile': 'api' },
      });
      assert.equal(res.status, 404, `GET ${q} was not refused`);
      const body = await res.json();
      assert.equal(body.code, 'PGRST202');
      assert.ok(!JSON.stringify(body).includes(hosts.hostA.token),
        'the refusal itself echoed the credential back');
    }
  });

  test('API16 the credential is not stored anywhere a reader can recover it', async () => {
    // The digest is a SHA-256 hex string; neither it nor the secret may surface in
    // any answer this caller can ask for.
    const calls = [
      ['state', await api('hostA').rpc('get_invitation_publication_state', { p_wedding_id: hosts.hostA.wedding.id })],
      ['preview', await api('hostA').rpc('preview_invitation', { p_wedding_id: hosts.hostA.wedding.id })],
      ['guest', (await resolveAs(hosts.hostA.token)).body],
    ];
    for (const [label, { data, error }] of calls.map(([l, v]) => [l, { data: v?.invitation ?? v, error: null }])) {
      const text = JSON.stringify(data);
      assert.doesNotMatch(text, /\b[a-f0-9]{64}\b/, `${label} leaked a digest`);
      assert.ok(!text.includes(hosts.hostA.token), `${label} leaked the raw credential`);
      assert.doesNotMatch(text, /token_hash|token_kind|expiry_policy|revoked_at/i, `${label} leaked the credential store`);
    }
  });

  test('API17 republishing the same version is refused, and publishing a foreign version is refused', async () => {
    const again = await api('hostA').rpc('publish_invitation_version', {
      p_wedding_id: hosts.hostA.wedding.id, p_version_id: hosts.hostA.v1.version_id, p_expires_at: null,
    });
    assert.equal(again.error?.code, '23514');
    assert.match(again.error.message, /this version is already the published one/);

    const foreign = await api('hostA').rpc('publish_invitation_version', {
      p_wedding_id: hosts.hostA.wedding.id, p_version_id: hosts.hostB.wedding.id, p_expires_at: null,
    });
    assert.equal(foreign.error?.code, '42501');
    assert.match(foreign.error.message, /that version is not a version of this wedding/);
  });

  test('API18 a link cannot be given an expiry that has already passed', async () => {
    const { error } = await api('hostA').rpc('publish_invitation_version', {
      p_wedding_id: hosts.hostA.wedding.id, p_version_id: hosts.hostA.v2.version_id,
      p_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    assert.equal(error?.code, '23514');
    assert.match(error.message, /an expiring link must be given a time in the future/);
  });

  test('API19 publishing v2 keeps the address already shared and the guest reads v2', async () => {
    // Read the link *before* the second publish. Without this half, "the guest now
    // sees v2" would only show that something resolves.
    const before = (await resolveAs(hosts.hostA.token)).body;
    assert.equal(before.available, true);
    assert.equal(before.invitation.welcome, hosts.hostA.v1.snapshot.draft.welcome,
      'the guest was not reading v1 before the republish, so the comparison below proves nothing');

    const { data, error } = await api('hostA').rpc('publish_invitation_version', {
      p_wedding_id: hosts.hostA.wedding.id, p_version_id: hosts.hostA.v2.version_id, p_expires_at: null,
    });
    assert.equal(error, null, error?.message);
    assert.equal(data.link_reused, true, 'a live link was replaced instead of repointed');
    assert.equal(data.path, null, 'the raw credential was handed out a second time');

    const after = (await resolveAs(hosts.hostA.token)).body;
    assert.equal(after.available, true);
    assert.equal(after.invitation.welcome, V2_WORDING,
      'the same address still served the older version');
    assert.notEqual(after.invitation.welcome, before.invitation.welcome);
    // The draft has moved past v2 since API07, so the guest is reading neither the
    // live draft nor the stale version.
    const state = await api('hostA').rpc('get_invitation_publication_state', {
      p_wedding_id: hosts.hostA.wedding.id,
    });
    assert.equal(state.data.version_number, 2);
    assert.equal(state.data.link_active, true);
  });

  test('API20 a guest reading a frozen link is not reading the live draft', async () => {
    const { error } = await client('hostA').from('invitation_drafts')
      .update({ content: { welcome: 'written after the link was published' } })
      .eq('wedding_id', hosts.hostA.wedding.id);
    assert.equal(error, null, error?.message);
    const guest = (await resolveAs(hosts.hostA.token)).body;
    assert.notEqual(guest.invitation.welcome, 'written after the link was published');
    const hostView = await api('hostA').rpc('preview_invitation', { p_wedding_id: hosts.hostA.wedding.id });
    assert.equal(hostView.data.welcome, 'written after the link was published',
      'the host’s own preview went stale, so the comparison above proved nothing');
  });
});

// ---------------------------------------------------------------------------
// §I/§J — the guest door, and exactly what comes back through it
// ---------------------------------------------------------------------------
describe('§6.4 the guest door', () => {
  const GUEST_KEYS = ['available', 'invitation'];

  // The same eleven names `supabase/tests/stage3/30_publication.sql` pins against the
  // projection function itself, asserted here over HTTP: a guest gets the whitelist,
  // the transport, and nothing that identifies a row.
  const DTO_KEYS = ['title', 'language', 'style', 'design_template', 'tradition_pack',
    'people', 'events', 'welcome', 'family_introduction', 'event_notes', 'closing'];

  test('API21 a successful resolution is the flag plus one whitelisted object', async () => {
    const r = await resolveAs(hosts.hostA.token);
    assert.deepEqual(Object.keys(r.body).sort(), [...GUEST_KEYS].sort());
    assert.equal(r.body.available, true);
    const dto = r.body.invitation;
    assert.deepEqual(Object.keys(dto).sort(), [...DTO_KEYS].sort());
    // Two shapes inside the whitelist, named because a client has to read them: the
    // language is the pair the host chose, and the style is the four keys the editor
    // writes. `foilEnabled` is absent on purpose (see the projection's comment).
    assert.deepEqual(Object.keys(dto.language).sort(), ['additional', 'primary']);
    assert.deepEqual(Object.keys(dto.style).sort(), ['alignment', 'color', 'font', 'fontSize']);
    // Absent by design, and worth naming rather than leaving to inference: a version
    // counter is a fact about the database, not about the wedding.
    assert.equal(dto.version_number, undefined);
    assert.equal(dto.heading, undefined);
  });

  test('API22 nothing a snapshot carries can reach a guest unnamed by the whitelist', async () => {
    const banned = ['token', 'token_hash', 'raw', 'secret', 'hash', 'owner_user_id', 'user_id',
      'email', 'phone', 'household_id', 'wedding_id', 'publication_id', 'rsvp', 'entitlement',
      'paid_status', 'payment', 'approval', 'audit', 'created_by', 'supersedes', 'sql',
      'internal', 'draft_history', 'id'];
    const seen = [];
    const walk = (node, key) => {
      if (key) seen.push(key);
      if (Array.isArray(node)) node.forEach((n) => walk(n, null));
      else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, k);
    };
    walk((await resolveAs(hosts.hostA.token)).body, null);
    const offenders = seen.filter((k) => banned.includes(k.toLowerCase()));
    assert.deepEqual(offenders, [], `a guest answer carried ${offenders.join(', ')}`);
  });

  test('API23 every bad credential is the same four bytes, whatever kind of bad it was', async () => {
    // Padding a header with spaces is deliberately *not* in this list. RFC 9110 §5.5
    // has the recipient strip leading and trailing whitespace from a field value, so
    // `' <token> '` is the token as far as any HTTP server can tell — measured: the
    // first version of this test asserted a generic refusal and got the DTO back.
    // Anything that survives the transport is still refused.
    const cases = [
      ['no header at all', undefined],
      ['empty', ''],
      ['too short', 'abc'],
      ['right length, wrong alphabet', '!'.repeat(43)],
      ['right alphabet, short', 'a'.repeat(42)],
      ['right shape, never minted', 'Z'.repeat(43)],
      ['twice the length', hosts.hostA.token + hosts.hostA.token],
      ['base64 padding on the end', `${hosts.hostA.token}=`],
      ['a real token with one character changed',
        hosts.hostA.token.slice(0, -1) + (hosts.hostA.token.slice(-1) === 'A' ? 'B' : 'A')],
      // A space in the middle is not whitespace the transport may remove.
      ['a real token with a space inside it',
        `${hosts.hostA.token.slice(0, 20)} ${hosts.hostA.token.slice(21)}`],
      ['a sql fragment', `${hosts.hostA.token}' or 1=1--`],
    ];
    for (const [label, token] of cases) {
      const r = await resolveAs(token);
      assert.equal(r.status, 200, `${label} produced HTTP ${r.status}, not the generic answer`);
      assert.deepEqual(r.body, { available: false }, `${label} was distinguishable from a wrong address`);
    }
  });

  test('API24 the door is the same for a signed-in visitor', async () => {
    const r = await fetch(`${url}/rest/v1/rpc/resolve_public_invitation`, {
      method: 'POST',
      headers: {
        apikey: anonKey, Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json', 'Content-Profile': 'api',
        'x-invitation-token': hosts.hostA.token,
      },
      body: '{}',
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), (await resolveAs(hosts.hostA.token)).body);
  });

  test('API25 plain text stays plain text, and a script tag is not sanitised into markup', async () => {
    const needle = '<img src=x onerror="alert(1)"> &amp; <script>boom()<\/script>';
    const { error } = await client('hostA').from('invitation_drafts')
      .update({ content: { welcome: needle } }).eq('wedding_id', hosts.hostA.wedding.id);
    assert.equal(error, null, error?.message);
    const version = await api('hostA').rpc('create_invitation_version', { p_wedding_id: hosts.hostA.wedding.id });
    assert.equal(version.error, null, version.error?.message);
    const publish = await api('hostA').rpc('publish_invitation_version', {
      p_wedding_id: hosts.hostA.wedding.id, p_version_id: version.data.version_id, p_expires_at: null,
    });
    assert.equal(publish.error, null, publish.error?.message);
    // This wedding already has a live address, so the answer carries no credential —
    // the one the host already sent now shows these words (API19 is where that was
    // first proven; naming it here keeps the reader from expecting a new path).
    assert.equal(publish.data.link_reused, true);
    assert.equal(publish.data.path, null);
    const guest = (await resolveAs(hosts.hostA.token)).body;
    // Byte-identical is the contract: the database does not rewrite a host's words,
    // and the renderer is the only place that decides how they appear.
    assert.equal(guest.invitation.welcome, needle);
    hosts.hostA.welcomeNeedle = needle;
  });

  test('API26 a map link that is not https never reaches a guest', async () => {
    // Two layers guard this, and over HTTP only the first one is reachable: the
    // column has a `^https://` CHECK, so a browser role cannot put a dangerous
    // scheme in a venue at all. The projection's independent re-check — needed
    // because a frozen snapshot is older than tomorrow's constraint — is proven
    // against the function itself in `30_publication.sql` (D32), which is the only
    // place a hand-built history row can be fed to it.
    for (const [label, link] of [['javascript:', 'javascript:alert(1)'], ['data:', 'data:text/html,<b>x'],
      ['file:', 'file:///etc/passwd'], ['protocol-relative', '//maps.example/ok'],
      ['upper-case scheme', 'HTTPS://maps.example/ok']]) {
      const { error } = await client('hostA').from('venues')
        .update({ map_url: link }).eq('id', hosts.hostA.venue.id);
      assert.equal(error?.code, '23514', `${label} was written into a venue: ${error?.message}`);
      assert.match(error.message, /violates check constraint/);
    }

    // The legal half, so the refusals above are about the scheme and not about the
    // write: an https link is accepted and reaches the guest through a published
    // version. The one live address is repointed rather than re-minted (API19).
    const { error: okErr } = await client('hostA').from('venues')
      .update({ map_url: 'https://maps.example/hall' }).eq('id', hosts.hostA.venue.id);
    assert.equal(okErr, null, `an https link was refused at the write: ${okErr?.message}`);
    const v = await api('hostA').rpc('create_invitation_version', { p_wedding_id: hosts.hostA.wedding.id });
    assert.equal(v.error, null, v.error?.message);
    const p = await api('hostA').rpc('publish_invitation_version', {
      p_wedding_id: hosts.hostA.wedding.id, p_version_id: v.data.version_id, p_expires_at: null,
    });
    assert.equal(p.error, null, p.error?.message);
    assert.equal(p.data.link_reused, true, 'a wedding with a live link was given a second one');
    const guest = (await resolveAs(hosts.hostA.token)).body;
    const urls = (guest.invitation.events ?? []).map((e) => e.venue?.map_url);
    assert.ok(urls.includes('https://maps.example/hall'),
      `the published guest never saw the map link, so the refusals above proved nothing: ${JSON.stringify(urls)}`);
  });
});

// ---------------------------------------------------------------------------
// §K/§L — rotation, revocation, expiry
// ---------------------------------------------------------------------------
describe('§6.5 taking a link down', () => {
  test('API27 rotation gives a new address, reports the old one stopping, and keeps history', async () => {
    // `hosts[x].token` is this run's live address: publishing new versions repoints it
    // (API19, API26) and only rotation or a fresh mint replaces it.
    const old = hosts.hostA.token;
    const { data, error } = await api('hostA').rpc('rotate_invitation_token', {
      p_wedding_id: hosts.hostA.wedding.id,
    });
    assert.equal(error, null, error?.message);
    assert.match(data.path, PATH_SHAPE);
    const fresh = tokenOf(data.path);
    assert.notEqual(fresh, old);
    assert.notEqual(data.previous_revoked_at, null);
    assert.equal((await resolveAs(old)).body.available, false, 'the retired address still resolves');
    assert.equal((await resolveAs(fresh)).body.available, true, 'the new address does not resolve');
    hosts.hostA.finalToken = fresh;
  });

  test('API28 rotation is the owner’s verb', async () => {
    const { error } = await api('hostB').rpc('rotate_invitation_token', {
      p_wedding_id: hosts.hostA.wedding.id,
    });
    assert.equal(error?.code, '42501');
    assert.match(error.message, /the caller may not rotate this wedding/);
  });

  test('API29 revocation stops the link for a guest and says so to the host', async () => {
    const { data, error } = await api('hostA').rpc('revoke_invitation_publication', {
      p_wedding_id: hosts.hostA.wedding.id,
    });
    assert.equal(error, null, error?.message);
    assert.equal(data.revoked, true);
    assert.equal(data.tokens_revoked, 1);
    assert.deepEqual((await resolveAs(hosts.hostA.finalToken)).body, { available: false });
    const state = await api('hostA').rpc('get_invitation_publication_state', {
      p_wedding_id: hosts.hostA.wedding.id,
    });
    assert.equal(state.data.link_active, false);
  });

  test('API30 republishing mints a different secret instead of waking the revoked one', async () => {
    const { data, error } = await api('hostA').rpc('publish_invitation_version', {
      p_wedding_id: hosts.hostA.wedding.id, p_version_id: hosts.hostA.v2.version_id, p_expires_at: null,
    });
    assert.equal(error, null, error?.message);
    assert.equal(data.link_reused, false);
    assert.notEqual(tokenOf(data.path), hosts.hostA.finalToken);
    assert.deepEqual((await resolveAs(hosts.hostA.finalToken)).body, { available: false },
      'the revoked address came back to life');
    assert.equal((await resolveAs(tokenOf(data.path))).body.available, true);
    hosts.hostA.finalToken = tokenOf(data.path);
  });

  test('API31 a link that runs out is indistinguishable from a link that was never real', async () => {
    const v = await api('hostB').rpc('create_invitation_version', { p_wedding_id: hosts.hostB.wedding.id });
    assert.equal(v.error, null, v.error?.message);
    const soon = new Date(Date.now() + 1500).toISOString();
    const p = await api('hostB').rpc('publish_invitation_version', {
      p_wedding_id: hosts.hostB.wedding.id, p_version_id: v.data.version_id, p_expires_at: soon,
    });
    assert.equal(p.error, null, p.error?.message);
    const token = tokenOf(p.data.path);
    assert.equal((await resolveAs(token)).body.available, true, 'an in-date link did not resolve');
    await new Promise((r) => setTimeout(r, 2000));
    assert.deepEqual((await resolveAs(token)).body, { available: false });

    // The host’s own read has to agree with what a guest can actually do. An expired
    // credential is not revoked — its row is still there, unrevoked, which is what
    // API32 counts — so `link_active` has to read the expiry as well as the revocation.
    const state = await api('hostB').rpc('get_invitation_publication_state', {
      p_wedding_id: hosts.hostB.wedding.id,
    });
    assert.equal(state.error, null, state.error?.message);
    assert.equal(state.data.link_active, false,
      'the host was told a link is live that a guest cannot open');
    assert.notEqual(state.data.link_expires_at, null,
      'the expiry was not recorded, so the assertion above is about nothing');
  });

  test('API32 revoking a wedding with nothing published answers that nothing was revoked', async () => {
    // host B's published wedding has an *expired* credential, which is a different
    // thing from an unrevoked one: expiry is read at resolution time, so this verb
    // still counts it. The claim "nothing was revoked" therefore needs a wedding
    // that was never published at all, which is written here rather than assumed
    // about another test's leftover.
    const { data: fresh, error: cErr } = await client('hostB').from('weddings')
      .insert({ owner_user_id: hosts.hostB.userId, title: 'Never published', primary_language: 'ta' })
      .select('id').single();
    assert.equal(cErr, null, `the never-published wedding could not be created: ${cErr?.message}`);

    const { data, error } = await api('hostB').rpc('revoke_invitation_publication', {
      p_wedding_id: fresh.id,
    });
    assert.equal(error, null, error?.message);
    assert.deepEqual(data, { publication_id: null, revoked: false, tokens_revoked: 0 });

    // The same verb one call later, with a link standing: the zero above was the
    // absence of a publication, not a function that always answers zero.
    const v = await api('hostB').rpc('create_invitation_version', { p_wedding_id: fresh.id });
    assert.equal(v.error, null, v.error?.message);
    const p = await api('hostB').rpc('publish_invitation_version', {
      p_wedding_id: fresh.id, p_version_id: v.data.version_id, p_expires_at: null,
    });
    assert.equal(p.error, null, p.error?.message);
    const second = await api('hostB').rpc('revoke_invitation_publication', { p_wedding_id: fresh.id });
    assert.equal(second.error, null, second.error?.message);
    assert.equal(second.data.revoked, true);
    assert.equal(second.data.tokens_revoked, 1);
    assert.deepEqual((await resolveAs(tokenOf(p.data.path))).body, { available: false });
  });

  test('API35 revocation takes the publication down even when no credential row is there', async () => {
    // Closure-repair directive §9. The body used to end with `IF FOUND THEN UPDATE
    // public.publications …`, and `FOUND` had already been rewritten by the credential
    // UPDATE above it — so this exact shape, an active publication whose live credential
    // is missing, left the publication `active` and answered `revoked: false`. The HTTP
    // half matters because it is the shape a host's own screen can reach: a link that
    // reports itself taken down while visitors can still open it.
    const { data: wedding, error: cErr } = await client('hostA').from('weddings')
      .insert({ owner_user_id: hosts.hostA.userId, title: 'Credential missing', primary_language: 'ta' })
      .select('id').single();
    assert.equal(cErr, null, `the wedding could not be created: ${cErr?.message}`);

    const version = await api('hostA').rpc('create_invitation_version', { p_wedding_id: wedding.id });
    assert.equal(version.error, null, version.error?.message);
    const published = await api('hostA').rpc('publish_invitation_version', {
      p_wedding_id: wedding.id, p_version_id: version.data.version_id, p_expires_at: null,
    });
    assert.equal(published.error, null, published.error?.message);
    const token = tokenOf(published.data.path);
    assert.equal((await resolveAs(token)).body.available, true, 'the fresh link did not resolve');

    trustedDropLiveCredential(wedding.id);

    const { data, error } = await api('hostA').rpc('revoke_invitation_publication', {
      p_wedding_id: wedding.id,
    });
    assert.equal(error, null, error?.message);
    assert.deepEqual(data, {
      revoked: true,
      publication_id: published.data.publication_id,
      tokens_revoked: 0,
    }, 'a missing credential decided whether the publication was taken down');
    assert.deepEqual((await resolveAs(token)).body, { available: false });

    // The database row, read through the host's own RPC rather than by counting rows in
    // `private`: with no active publication the state comes back empty, which is the only
    // answer that means "there is no live link", as opposed to `link_active: false`
    // beside a publication id, which would mean a link that is out of date.
    const state = await api('hostA').rpc('get_invitation_publication_state', {
      p_wedding_id: wedding.id,
    });
    assert.equal(state.error, null, state.error?.message);
    assert.deepEqual([state.data.publication_id, state.data.link_active], [null, false]);

    // And the same verb again reports a no-op, so `revoked: true` above cannot be this
    // function always answering true — the assertion that would otherwise be unfalsified.
    const again = await api('hostA').rpc('revoke_invitation_publication', { p_wedding_id: wedding.id });
    assert.equal(again.error, null, again.error?.message);
    assert.deepEqual(again.data, { revoked: false, publication_id: null, tokens_revoked: 0 });
  });
});

// ---------------------------------------------------------------------------
// §C/§AH — the catalogue itself
// ---------------------------------------------------------------------------
//
// Everything above asks "does this door behave?". This block asks the other question, the
// one a behaviour test cannot ask: "is the set of doors exactly the set this stage
// intended?". A grant that arrived by `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA api`
// would satisfy every positive and negative test above and still be a hole, because the
// hole is a function nobody read yet. So the list below is a literal, its length is a
// literal, and a callable that is not on it fails the run.
//
// Read from the database rather than from `information_schema.routines`, because the
// columns needed — `prosecdef`, `proconfig`, `proacl` — are the ones that record the
// SECURITY DEFINER posture and the grants, and `pg_proc` is where PostgREST's own
// privilege check ends up.
//
// Since the closure repair there are two RPC schemas, and the catalogue reads both:
// `api`, which PostgREST serves and which now holds only one-line SECURITY INVOKER
// wrappers, and `internal_api`, which it does not serve and which holds the privileged
// SECURITY DEFINER bodies those wrappers name. Asserting them in one pass is what makes
// the split a fact rather than a claim: the same seven names, in two postures, with the
// same seven callers.
describe('§6.6 the callable catalogue is closed', () => {
  /** `grantees` lists the roles this build intends to reach the function. The owner is
   *  always allowed and is not a caller; nothing else may appear. */
  const INTENDED = new Map([
    ['create_invitation_version', { args: 'p_wedding_id uuid', grantees: ['authenticated'] }],
    ['get_invitation_publication_state', { args: 'p_wedding_id uuid', grantees: ['authenticated'] }],
    ['preview_invitation', { args: 'p_wedding_id uuid', grantees: ['authenticated'] }],
    ['publish_invitation_version', {
      args: 'p_wedding_id uuid, p_version_id uuid, p_expires_at timestamp with time zone',
      grantees: ['authenticated'],
    }],
    ['resolve_public_invitation', { args: '', grantees: ['anon', 'authenticated'] }],
    ['revoke_invitation_publication', { args: 'p_wedding_id uuid', grantees: ['authenticated'] }],
    ['rotate_invitation_token', { args: 'p_wedding_id uuid', grantees: ['authenticated'] }],
  ]);

  // The two halves of the boundary and what each is allowed to be. `definer` and
  // `language` are opposite by design: an exposed body that could act above its caller
  // is what the review asked to remove, and an implementation that ran as its caller
  // could not read `private` at all.
  const SURFACES = [
    { schema: 'api', definer: 'false', language: 'sql' },
    { schema: 'internal_api', definer: 'true', language: 'plpgsql' },
  ];

  const readSurface = (schema) => {
    // The name is interpolated into the statement, so it is checked to be a schema
    // identifier — the two values above are the only ones this is ever called with.
    assert.match(schema, /^[a-z_]+$/);
    return sqlRows(`
      select p.proname,
             pg_get_function_identity_arguments(p.oid),
             p.prosecdef::text,
             l.lanname,
             coalesce(array_to_string(p.proconfig, ';'), ''),
             coalesce(array_to_string(p.proacl, ','), ''),
             pg_get_userbyid(p.proowner)
      from pg_proc p
        join pg_namespace ns on ns.oid = p.pronamespace
        join pg_language l on l.oid = p.prolang
      where ns.nspname = '${schema}'
      order by p.proname
    `).map(line => {
      const [name, args, securer, language, config, acl, owner] = line.split('|');
      // `role=X/owner` — an empty role name is PUBLIC, which is the default grant this
      // stage revokes rather than leaves in place.
      const grantees = acl.split(',').filter(Boolean)
        .map(entry => entry.split('=')[0])
        .filter(role => role !== '' && role !== owner);
      return { name, args, securer, language, config, grantees, owner };
    });
  };

  test('API33 both RPC schemas hold exactly the seven intended functions, in the posture each is meant to have', () => {
    const surfaces = SURFACES.map(({ schema }) => ({ schema, rows: readSurface(schema) }));

    for (const { schema, rows } of surfaces) {
      const extra = rows.filter(row => !INTENDED.has(row.name));
      assert.deepEqual(extra.map(row => row.name), [],
        `unexpected callable in ${schema}: ${extra.map(r => `${r.name}(${r.args})`).join(', ')}`);
      const missing = [...INTENDED.keys()].filter(k => !rows.some(r => r.name === k));
      assert.deepEqual(missing, [], `intended callable missing from ${schema}: ${missing.join(', ')}`);
      assert.equal(rows.length, INTENDED.size, `${schema} does not hold exactly ${INTENDED.size} functions`);
    }

    // Paired by name, so a body without a wrapper and a wrapper without a body cannot
    // both be present and cancel out into seven rows each.
    for (const name of INTENDED.keys()) {
      for (const { schema, rows } of surfaces) {
        assert.ok(rows.some(r => r.name === name), `${name} is missing from ${schema}`);
      }
      const [wrapper, body] = surfaces.map(({ rows }) => rows.find(r => r.name === name));
      assert.equal(wrapper.args, body.args, `${name} has a wrapper for a different signature than it implements`);
      assert.deepEqual(wrapper.grantees.slice().sort(), body.grantees.slice().sort(),
        `${name} is callable by different roles through the wrapper than through its body`);
    }

    for (const { schema, rows } of SURFACES) {
      const wanted = { definer: schema === 'internal_api' ? 'true' : 'false', language: schema === 'internal_api' ? 'plpgsql' : 'sql' };
      for (const row of readSurface(schema)) {
        const intent = INTENDED.get(row.name);
        // PostgREST resolves by signature, so a changed argument type is a different door
        // even under the same name.
        assert.equal(row.args, intent.args, `${schema}.${row.name} has a different signature than audited`);
        assert.equal(row.securer, wanted.definer,
          `${schema}.${row.name} is SECURITY ${row.securer === 'true' ? 'DEFINER' : 'INVOKER'}; this build intends the other half of the boundary`);
        assert.equal(row.language, wanted.language,
          `${schema}.${row.name} is written in ${row.language}; an exposed body that can branch is not a wrapper`);
        // A pinned empty search_path is what makes running as the owner harmless, and it
        // is needed on the wrapper for a different reason: the wrapper resolves the name
        // `internal_api` itself, so an inherited path is a steering opportunity.
        assert.ok(row.config.includes('search_path=""'),
          `${schema}.${row.name} does not pin its search_path: '${row.config}'`);
        assert.equal(row.owner, 'postgres',
          `${schema}.${row.name} is owned by ${row.owner}, not the migration role`);
        assert.deepEqual(row.grantees.slice().sort(), intent.grantees.slice().sort(),
          `${schema}.${row.name} is granted to ${row.grantees.join(', ') || 'nobody'}`);
        assert.ok(!row.grantees.includes('PUBLIC'), `${schema}.${row.name} carries a PUBLIC grant`);
      }
    }
  });

  test('API34 the RPC schemas are functions only, and nothing else is callable by a browser role', () => {
    // An allow-listed API surface with a table in it is a second kind of door: PostgREST
    // would serve it with row-level security as its only guard, and the whole publication
    // design assumes a guest cannot read the canonical rows directly. `internal_api` is
    // the same hazard in a sharper form — a table there would be read by functions that
    // run as their owner, with no policy in front of it — so the rule is stated for both.
    for (const schema of ['api', 'internal_api']) {
      assert.match(schema, /^[a-z_]+$/);
      const relations = sqlRows(`
        select ns.nspname || '.' || c.relkind::text || coalesce(c.relname, '')
        from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = '${schema}' and c.relkind in ('r', 'v', 'm', 'f', 'p')
        order by c.relname
      `);
      assert.deepEqual(relations, [], `${schema} exposes relations: ${relations.join(', ')}`);
    }

    // `service_role` reaching the browser boundary would mean a key in frontend code
    // could be swapped for a session and the refusals above would not apply. Measured:
    // it holds no USAGE on `api` at all, which is what API03 observes from HTTP. The
    // privileged half is checked the same way, because a body that a server key could
    // call directly would be a second, weaker route to exactly what the wrapper already
    // does. `supabase_admin` is deliberately not in this list: it is a member of
    // `postgres`, which owns these functions, so it inherits their privileges the way any
    // owner does. What matters, and what is asserted, is that no *request* role can call
    // the door.
    const servers = sqlRows(`
      select r.rolname || ' -> ' || ns.nspname
      from pg_roles r
      cross join (values ('api.resolve_public_invitation()'::regprocedure),
                         ('internal_api.resolve_public_invitation()'::regprocedure)) as door(fn)
      join pg_proc p on p.oid = door.fn
      join pg_namespace ns on ns.oid = p.pronamespace
      where r.rolname in ('service_role', 'authenticator', 'supabase_auth_admin', 'supabase_functions_admin')
        and has_function_privilege(r.rolname, door.fn, 'EXECUTE')
      order by 1
    `);
    assert.deepEqual(servers, [], `server-side roles hold EXECUTE on the guest door: ${servers.join(', ')}`);

    // The other half of "exactly one door": no function in `public` or `private` is
    // executable by a browser role. A leftover in `public` would be reachable through the
    // default profile without anybody changing a setting, and API05 only proves three
    // particular names are gone. `internal_api` is excluded from this scan on purpose:
    // its seven bodies *are* browser-callable, by necessity — PostgreSQL checks a nested
    // call as the invoking role, so a wrapper's caller must also hold EXECUTE on the body
    // beside it. API33 is what keeps that necessary grant to exactly the seven paired
    // names, and `stage3_security.test.mjs` is what measures that none of them is
    // reachable as an HTTP profile.
    const strays = sqlRows(`
      select ns.nspname || '.' || p.proname
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname in ('public', 'private')
        and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      order by 1
    `);
    assert.deepEqual(strays, [], `browser-callable functions outside the RPC schemas: ${strays.join(', ')}`);
  });
});
