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
//   * Every anonymous door reads its credential from a header, never from an argument. Three of the
//     five — `resolve_public_invitation`, `resolve_family_review` and `resolve_guest_invitation` —
//     take no argument at all; the two `submit_*` doors take the answer only, because an answer has
//     to arrive somehow. Every way of asking that could put the secret in a URL fails.
//   * The host RPCs take identity from the JWT and nowhere else, so a request cannot
//     name another owner's wedding and get an answer that says whether it exists. From
//     Stage 8 this list is eleven names: Stage 7's three host-side review verbs and
//     Stage 8's two wedding-keyed household verbs are host-only in exactly the same way,
//     because a reviewer reaches an invitation through its token, never through a wedding
//     id, and a household reaches its own through its link and nothing else. Stage 8's two
//     verbs keyed by a household id are refused the same grant, and are probed against a
//     real household in that stage's own file rather than with a null id here.
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
    // Stage 7's three host-side verbs, listed here because the rule they are under is the same
    // rule: a host acts on its own wedding through its JWT, and an anonymous key is refused at
    // the function. The reviewer half of Stage 7 is deliberately *not* in this list — a reviewer
    // has no account, so `resolve_family_review` and `submit_family_review` are granted to `anon`
    // and are qualified as anonymous doors in `stage7_family_approval.test.mjs` instead.
    //
    // Every declared argument is spelled, including `p_expires_at`, which has a DEFAULT: the
    // signature is how PostgREST resolves the call, and a short argument list would be refused
    // with PGRST202 by the router before this grant is consulted, which is the wrong reason.
    ['request_family_review', {
      p_wedding_id: null, p_version_id: null, p_reviewer_display_name: null, p_expires_at: null,
    }],
    ['revoke_family_review', { p_request_id: null }],
    ['get_approval_requests', { p_wedding_id: null }],
    // Stage 8's two wedding-keyed household verbs, on the same rule again. Two more of Stage 8's
    // host verbs are deliberately *not* here, and the reason is this matrix's own device: every
    // argument is spelled as null so no real row is named, `revoke_guest_invitation` and
    // `rotate_guest_invitation` are keyed by a household id, and a null household id is answered by
    // their own "name the household" refusal before the ownership sentence this test reads — which
    // is a different fact, and API04 exists to hold one fact. Both are qualified in
    // `stage8_guest_rsvp.test.mjs` against a real household belonging to the other host, which is
    // the stronger case anyway. The two doors are absent for Stage 7's reason: a guest has no
    // account, so `resolve_guest_invitation` and `submit_guest_rsvp` are granted to `anon` like the
    // reviewer pair above, and they are qualified as anonymous doors in that file too.
    ['get_guest_invitation_state', { p_wedding_id: null }],
    ['issue_guest_invitations', { p_wedding_id: null, p_household_ids: null, p_expires_at: null }],
  ];

  // PostgREST binds an RPC call by argument *name*, so a key the signature does not declare
  // would give a request a second reason to fail — and these two tests are each about one
  // reason. The wedding id is therefore substituted only where the verb takes one;
  // `revoke_family_review` is keyed by the request id and Stage 8's two link verbs by the
  // household id, so each gets exactly what it declares.
  const withWedding = (args, weddingId) => {
    const call = { ...args };
    if ('p_wedding_id' in call) call.p_wedding_id = weddingId;
    return call;
  };

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
      const { data, error } = await anonApi().rpc(name, withWedding(args, hosts.hostA.wedding.id));
      assert.equal(data, null, `anon called ${name}`);
      assert.equal(error?.code, '42501', `anon got something other than a privilege refusal from ${name}`);
      // "for function" rather than "for schema" is the proof that the refusal is this
      // grant on its own merits, and not `api` being out of reach for this caller —
      // which the control below shows is not the case.
      assert.match(error.message, new RegExp(`permission denied for function ${name}`));
      assert.equal(error.hint, null, `a grant hint was handed to an anonymous caller by ${name}`);
    }

    // Positive control: the same anonymous client, the same profile, one function
    // that is meant for it. Without this, eleven refusals could just mean "anon cannot
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
      const { error } = await api('hostA').rpc(name, withWedding(args, hosts.hostB.wedding.id));
      assert.notEqual(error, null, `${name} answered another owner's wedding`);
      assert.doesNotMatch(error.message, /permission denied for (function|schema)/,
        `${name} refused an owner at the grant rather than in its own logic`);
      assert.match(error.message, /the caller may not /,
        `${name} refused with something other than the ownership sentence: ${error.message}`);
    }

    // Positive control beside eleven refusals: the same role and profile, this caller's own
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

  // The same twelve names `supabase/tests/stage3/30_publication.sql` pins against the
  // projection function itself (its D9, D40 and F6c), asserted here over HTTP: a guest
  // gets the whitelist, the transport, and nothing that identifies a row. Stage 4 added
  // the twelfth, `sections`, and the SQL battery counted it then; this list is the HTTP
  // half of the same contract, so it counts it the same way.
  const DTO_KEYS = ['title', 'language', 'style', 'design_template', 'tradition_pack',
    'sections', 'people', 'events', 'welcome', 'family_introduction', 'event_notes', 'closing'];

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
    // The section block, likewise, because the renderer walks it: the request the freeze
    // was resolved against, and the ordered items — and one item is the seven keys the
    // projection builds, no release identifier among them.
    assert.deepEqual(Object.keys(dto.sections).sort(), ['items', 'requested']);
    assert.deepEqual(Object.keys(dto.sections.items[0]).sort(),
      ['body', 'heading', 'host_field', 'kind', 'position', 'required', 'section_key']);
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
// the split a fact rather than a claim: the same names, in two postures, with the same
// caller sets — forty-one names on the reachable half at this head, and sixty-one on the
// inner half, the twenty extra being the doorless bodies the three lists below enumerate.
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
    // Stage 5's one new door. Paired like the rest: an SQL wrapper in `api` that a browser may
    // call, over a SECURITY DEFINER body in `internal_api` that it may not. The parity claim it
    // exists for — the document and the server's verdict on it arrive from one resolution — is
    // qualified over PostgREST in `stage5_pack_driven_http.test.mjs`, and at the SQL head in
    // `supabase/tests/stage5/70_document_resolution.sql`; what this map proves is posture.
    ['preview_invitation_document', { args: 'p_wedding_id uuid', grantees: ['authenticated'] }],
    // Stage 7's five family-review doors, and the reason they are five and not one: opening an
    // invitation and answering it are different acts, so they cannot share a door, and a host
    // asking who has been invited is a third caller class again. Signatures and grantees for the
    // five below are read from `q7-logs/s7-census-readout-03.log`, which is a census of the whole
    // published chain applied through the Stage 7 head — not from the migration's intent. What
    // this map proves over HTTP is that every name on it sits in the same two postures behind the
    // transport, with `service_role` on none of them.
    ['get_approval_requests', { args: 'p_wedding_id uuid', grantees: ['authenticated'] }],
    ['request_family_review', {
      args: 'p_wedding_id uuid, p_version_id uuid, p_reviewer_display_name text, p_expires_at timestamp with time zone',
      grantees: ['authenticated'],
    }],
    ['revoke_family_review', { args: 'p_request_id uuid', grantees: ['authenticated'] }],
    // Argument-free like the guest resolver, for the same reason: the credential is a header, and
    // a function that took it as an argument would put a review token in a query string.
    ['resolve_family_review', { args: '', grantees: ['anon', 'authenticated'] }],
    ['submit_family_review', {
      args: 'p_decision text, p_reviewer_label text, p_message text, p_section_key text',
      grantees: ['anon', 'authenticated'],
    }],
    // Stage 8's six household verbs: four host operations on the caller's own wedding, and two doors
    // a guest reaches with no account at all. Both doors read the secret from the `x-guest-token`
    // header, and `resolve_guest_invitation` therefore takes no argument — an argument is a query
    // string, and a household link in a query string is a household link in a proxy log, a browser
    // history file and a referrer. `submit_guest_rsvp` carries the answer only, never the credential,
    // for the same reason. The provenance of these six lines is weaker than the five above them and
    // says so: Stage 7 had a live census to copy from and this head does not, so the signatures are
    // transcribed from `supabase/migrations/20261009120000_stage8_guest_invitations_rsvp.sql` (the
    // six bodies at `:153`, `:315`, `:373`, `:483`, `:562`, `:722`; the six paired wrappers at
    // `:1120`-`:1170`) and the caller sets from that file's §8. Two of the renderings are forms this
    // instrument has never printed from a live row: `p_household_ids uuid[]` and `p_answers jsonb`,
    // both predicted from what `format_type` does rather than from a measurement. The `timestamptz`
    // expansion in `issue_guest_invitations` is not a prediction — `publish_invitation_version` and
    // `request_family_review` have each been measured printing the long form here, on a stack that
    // passed. Reading those two renderings back out of `pg_get_function_identity_arguments` is an
    // obligation the first HTTP run at this head carries, and until that run these six lines are a
    // claim about a schema nobody has deployed.
    ['get_guest_invitation_state', { args: 'p_wedding_id uuid', grantees: ['authenticated'] }],
    ['issue_guest_invitations', {
      args: 'p_wedding_id uuid, p_household_ids uuid[], p_expires_at timestamp with time zone',
      grantees: ['authenticated'],
    }],
    ['resolve_guest_invitation', { args: '', grantees: ['anon', 'authenticated'] }],
    ['revoke_guest_invitation', { args: 'p_household_id uuid', grantees: ['authenticated'] }],
    ['rotate_guest_invitation', { args: 'p_household_id uuid', grantees: ['authenticated'] }],
    ['submit_guest_rsvp', { args: 'p_answers jsonb', grantees: ['anon', 'authenticated'] }],
    // Stage 9's two render reads. Both are host reads keyed by an id the caller's own JWT already
    // bounds — the manifest by the wedding, the document by the frozen version a render worker is
    // told about — and neither is anonymous, because an output row's existence is not public information
    // even when its bytes are. The signatures and caller sets below are read from
    // `q9-logs/s9-http-census-readout-01.txt`, a census of the published chain applied through the
    // Stage 9 head on the throwaway Postgres, taken with this file's own `readSurface` query; the HTTP
    // run at this head is what re-confirms them against the deployed stack.
    ['list_invitation_outputs', { args: 'p_wedding_id uuid', grantees: ['authenticated'] }],
    ['render_invitation_document', { args: 'p_version_id uuid', grantees: ['authenticated'] }],
    // Stage 10's one new door, and the reason it is one and not seven: a host may read the state of
    // its own purchase, but every act that moves money — quoting, recording a provider event,
    // granting, revoking, expiring, reconciling — belongs to a trusted connection that names its
    // actor explicitly, because a browser cannot be trusted to say who paid. So the write path has no
    // HTTP surface at all, and the inventory below (`COMMERCE_SERVICE_ONLY`) is what keeps that
    // absence a fact. The signature and caller set here are measured from the deployed stack at this
    // head with this file's own `readSurface` projection, not transcribed from
    // `20261017120000_stage10_commerce_foundations.sql:1646-1652`.
    ['commerce_host_summary', { args: 'p_wedding_id uuid', grantees: ['authenticated'] }],
    // Stage 11's nineteen operational doors: thirteen that only a granted operator may open, and six
    // intake doors a signed-in host may open on its own wedding. They are nineteen and not twenty-two
    // because three of this stage's bodies are deliberately given no door at all — the grant pair and
    // the object purge plan are reached only from a trusted connection, and that absence is inventoried
    // by name in `OPERATOR_SERVICE_ONLY` below rather than left to this map's silence. Every one of the
    // nineteen is `authenticated`-only: a door an anonymous caller could open would be a way to read
    // somebody else's support queue without a session, which is the opposite of what a queue is for.
    // The signatures, postures and caller sets are read from the deployed stack's catalog, not
    // transcribed from the six `202610*_*_stage11_*.sql` files and not predicted from what the design
    // said would ship. The record is `q11-logs/s11-http-surface-readout-1.txt`: section A the 41 names
    // in `api` with args, acl, definer, language, config and owner, section B the 41 `authenticated`
    // -executable bodies in `internal_api` — those same columns, which are this file's `readSurface`
    // projection — and `api_count=41` / `authenticated_execute_count=41` printed as the section totals.
    // Two things about that capture are stated rather than glossed. It prints `HEAD:
    // 4ea2a9787d9105b128d0af822aeb26f35115b141`, one commit behind this one, so it is evidence about the
    // stack at that head; the commit in between touched `scripts/stage11-operations-cli.mjs` and its
    // unit test and no file under `supabase/migrations/`, which is why the surface cannot have moved
    // between the two — measured, not assumed. And the catalog query that emitted the capture was run
    // out-of-band: only its output is saved in the evidence directory, so the numbers in it are the
    // record of one measurement rather than a re-runnable instrument. `readSurface` re-measures the
    // same catalog facts every time this suite runs against a live stack, and the Stage 11 doors are
    // asserted name-by-name in `stage11_operations_http.test.mjs`'s `before()` hook.
    ['create_privacy_request', { args: 'p_wedding_id uuid, p_kind text, p_note text', grantees: ['authenticated'] }],
    ['get_my_privacy_requests', { args: '', grantees: ['authenticated'] }],
    ['get_my_support_case', { args: 'p_case_ref text', grantees: ['authenticated'] }],
    ['get_my_support_cases', { args: 'p_status text, p_limit integer', grantees: ['authenticated'] }],
    ['get_operator_case', { args: 'p_case_ref text', grantees: ['authenticated'] }],
    ['open_support_case', {
      args: 'p_wedding_id uuid, p_category text, p_severity text, p_summary text, p_idempotency_key uuid',
      grantees: ['authenticated'],
    }],
    ['operator_add_case_note', {
      args: 'p_case_ref text, p_kind text, p_body text, p_idempotency_key uuid', grantees: ['authenticated'],
    }],
    ['operator_add_commerce_review_note', {
      args: 'p_refund_id uuid, p_case_ref text, p_kind text, p_note text, p_idempotency_key uuid',
      grantees: ['authenticated'],
    }],
    ['operator_advance_privacy_request', {
      args: 'p_request_ref text, p_status text, p_note text, p_idempotency_key uuid', grantees: ['authenticated'],
    }],
    ['operator_case_queue', { args: 'p_status text, p_category text, p_limit integer', grantees: ['authenticated'] }],
    ['operator_claim_case', { args: 'p_case_ref text, p_idempotency_key uuid', grantees: ['authenticated'] }],
    ['operator_commerce_review_queue', { args: 'p_status text, p_limit integer', grantees: ['authenticated'] }],
    ['operator_operations_summary', { args: 'p_window_hours integer', grantees: ['authenticated'] }],
    ['operator_privacy_queue', { args: 'p_status text', grantees: ['authenticated'] }],
    ['operator_release_case', { args: 'p_case_ref text, p_idempotency_key uuid', grantees: ['authenticated'] }],
    ['operator_takedown_plan', { args: 'p_wedding_id uuid', grantees: ['authenticated'] }],
    ['operator_takedown_publication', {
      args: 'p_wedding_id uuid, p_case_ref text, p_reason text, p_idempotency_key uuid',
      grantees: ['authenticated'],
    }],
    ['operator_transition_case', {
      args: 'p_case_ref text, p_to_status text, p_resolution_code text, p_body text, p_idempotency_key uuid',
      grantees: ['authenticated'],
    }],
    ['reply_to_support_case', { args: 'p_case_ref text, p_body text, p_idempotency_key uuid', grantees: ['authenticated'] }],
  ]);

  // The maintenance surface Stage 5 added, named here rather than left to be discovered: the
  // assertion below is that all eleven exist in `internal_api`, none of them has a wrapper in
  // `api`, and none of them is granted to any role but the owner. That is §B's rule stated as
  // an inventory, and an inventory is the only form in which "a twelfth privileged function
  // appeared" becomes a failure rather than a surprise. Stage 10's six money bodies are the same
  // kind of surface and are listed separately below, because their owner-answer is a different
  // one — Stage 5's are human-review acts, Stage 10's are the ledger's write path.
  const MAINTENANCE_ONLY = [
    'approve_tradition_pack_release',
    'create_tradition_pack',
    'create_tradition_pack_release',
    'deprecate_tradition_pack_release',
    'get_tradition_pack_review_packet',
    'inspect_tradition_pack_release',
    'submit_tradition_pack_review',
    'tradition_pack_catalog',
    'tradition_pack_retention_report',
    'update_draft_tradition_pack_release',
    'validate_tradition_pack_release',
  ].sort();

  // Stage 10's write path, inventoried for the reason the list above is inventoried: an unlisted
  // privileged function is a hole nobody read yet. These six hold the money model's every verb, and
  // each is deliberately in the posture §9 of `20261017120000_stage10_commerce_foundations.sql:588-594`
  // states — SECURITY INVOKER, `search_path` pinned, owned by `postgres`, granted to no role at all.
  // INVOKER is not an oversight here: a body that cannot escalate is a body whose reachability is a
  // property of the connecting role rather than of a token, which is why all six take an explicit
  // `p_actor_user_id` and re-derive ownership from `public.weddings` instead of believing it. The
  // names and the posture are measured from the deployed stack at this head; the signatures are not
  // pinned, for the same reason API38 does not pin the eleven above — an unreachable door has no
  // caller to keep a promise to, and API33's per-name signature audit belongs to the reachable half.
  const COMMERCE_SERVICE_ONLY = [
    'commerce_reconcile',
    'create_commerce_order',
    'expire_commerce_order',
    'grant_commerce_entitlement',
    'record_commerce_event',
    'revoke_commerce_entitlement',
  ].sort();

  // Stage 11's three bodies without a door, listed because the nineteen above are the whole of this
  // stage's HTTP surface and an operator who mints a grant over REST would be granting themselves the
  // product. Two postures, and the difference is the reason this list does not copy the sentence from
  // either of the two above it: `grant_operator_role` and `revoke_operator_role` are SECURITY INVOKER,
  // like Stage 5's review acts and Stage 10's money verbs, while `operator_purge_publication_objects`
  // is SECURITY DEFINER, because planning a purge has to read `private` and `storage` on behalf of a
  // caller that holds neither. The three clauses are read off the migration text where each is created —
  // `20261020190000_stage11_operator_authority.sql:416` and `:527` both say `LANGUAGE plpgsql SECURITY
  // INVOKER SET search_path = ''`, `20261020190400_stage11_takedown_and_oversight.sql:499` says the same
  // with `DEFINER` — and `q11-logs/s11-http-surface-readout-1.txt` section C prints the deployed
  // catalog's own `false` / `false` / `true` beside the three names.
  // What this file does NOT check for them, stated because the list above it checks more: API33's
  // posture loop skips any name with no `INTENDED` entry, and API38/API39 are scoped to the maintenance
  // and money lists, so no case here asserts an operator body's `prosecdef`. Three facts are asserted,
  // all by `stage11_operations_http.test.mjs`: the trio exists in `internal_api` and has no twin in
  // `api` (its `before()` hook, from the catalog), and no client role holds EXECUTE (twice — the hook,
  // and A-05's `has_function_privilege` census across `anon`, `authenticated` and `service_role`). The
  // posture is inventoried here so a fourth fact cannot arrive uncounted; asserting it needs the stack.
  const OPERATOR_SERVICE_ONLY = [
    'grant_operator_role',
    'operator_purge_publication_objects',
    'revoke_operator_role',
  ].sort();

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

  test('API33 both RPC schemas hold exactly the intended functions, in the posture each is meant to have', () => {
    const surfaces = SURFACES.map(({ schema }) => ({ schema, rows: readSurface(schema) }));

    for (const { schema, rows } of surfaces) {
      // `internal_api` is allowed the maintenance names, the money bodies, the three doorless operator
      // bodies and nothing else; `api` is allowed the paired wrappers and nothing else. Separating the
      // two is what keeps a *new* privileged function from passing by having been added to the wrong
      // list. At this head the two intended sets are 41 and 61, and the difference between them is the
      // twenty twin-less names the three lists above enumerate — a twenty-first appearing in
      // `internal_api` without a twin, or a name appearing on both sides with only one of the two
      // postures, is what these three lines refuse.
      const intended = schema === 'internal_api'
        ? new Set([...INTENDED.keys(), ...MAINTENANCE_ONLY, ...COMMERCE_SERVICE_ONLY, ...OPERATOR_SERVICE_ONLY])
        : INTENDED;
      const extra = rows.filter(row => !intended.has(row.name));
      assert.deepEqual(extra.map(row => row.name), [],
        `unexpected callable in ${schema}: ${extra.map(r => `${r.name}(${r.args})`).join(', ')}`);
      const missing = [...intended.keys()].filter(k => !rows.some(r => r.name === k));
      assert.deepEqual(missing, [], `intended callable missing from ${schema}: ${missing.join(', ')}`);
      assert.equal(rows.length, intended.size, `${schema} does not hold exactly ${intended.size} functions`);
    }

    // Paired by name, so a body without a wrapper and a wrapper without a body cannot
    // both be present and cancel out into equal row counts.
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
        // Only the paired surface is checked here: a maintenance function is deliberately not a
        // wrapper, so its own posture is asserted in API35 rather than bent to fit this loop.
        const intent = INTENDED.get(row.name);
        if (!intent) continue;
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

  test('API38 the Stage 5 maintenance surface exists, has no wrapper, and is unreachable over HTTP', async () => {
    // §B's rule as an inventory: privileged functions live in `internal_api`, none of them has a
    // twin in the exposed `api` schema, none of them is SECURITY DEFINER (every step one of them
    // takes is one the calling identity could already perform on the row), and none of them is
    // granted to any role but the owner — not to `anon`, not to `authenticated`, and not to
    // `service_role` either, because the product never needs to approve a pack.
    const internal = readSurface('internal_api');
    const exposed = readSurface('api');
    const missing = MAINTENANCE_ONLY.filter(n => !internal.some(r => r.name === n));
    assert.deepEqual(missing, [], `maintenance functions missing from internal_api: ${missing.join(', ')}`);

    for (const row of internal.filter(r => MAINTENANCE_ONLY.includes(r.name))) {
      assert.equal(row.securer, 'false',
        `${row.name} is SECURITY DEFINER; the maintenance surface was built to need no escalation`);
      assert.equal(row.language, 'plpgsql', `${row.name} is written in ${row.language}`);
      assert.ok(row.config.includes('search_path=""'),
        `${row.name} does not pin its search_path: '${row.config}'`);
      assert.equal(row.owner, 'postgres', `${row.name} is owned by ${row.owner}`);
      assert.deepEqual(row.grantees, [],
        `${row.name} is granted to ${row.grantees.join(', ')}; a browser role must not be able to execute it`);
      assert.ok(!exposed.some(r => r.name === row.name),
        `${row.name} has a wrapper in api, which would put a maintenance act behind an HTTP door`);
    }

    // The same facts as a client experiences them. The catalogue loop above proves what was
    // granted; this proves the transport cannot route around it — the distinction Stage 2's
    // C63c had to learn, because `internal_api` holds schema USAGE for the browser roles so that
    // nested execution works, and a forgotten revoke there would be SQL-callable even though no
    // HTTP request can name the schema.
    //
    // Measured on this stack, the refusal is PGRST202 / 404 rather than 401 or 403: PostgREST
    // resolves the name inside the exposed profile before it reaches any privilege check, and
    // `tradition_pack_catalog` is not in `api` to resolve. That is a stronger answer than a
    // permission error, and it is the same answer for every credential shape below — including
    // the server key, which is the role that holds the most elsewhere — so the endpoint is not a
    // way to learn whether a maintenance function exists.
    const byName = {};
    for (const [label, key] of [
      ['apikey only', anonKey],
      ['as a bearer token', anonKey],
      ['the server key', serviceKey],
    ]) {
      for (const [target, name] of [
        ['/rest/v1/rpc/tradition_pack_catalog', 'unqualified'],
        ['/rest/v1/rpc/internal_api.tradition_pack_catalog', 'schema-qualified'],
      ]) {
        const res = await fetch(`${url}${target}`, {
          method: 'POST',
          headers: {
            apikey: key, Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json', 'Content-Profile': 'api',
          },
          body: '{}',
        });
        const body = await res.json().catch(() => ({}));
        assert.equal(res.status, 404,
          `${label} / ${name}: a maintenance call was routed rather than refused (${res.status} ${JSON.stringify(body)})`);
        assert.equal(body.code, 'PGRST202',
          `${label} / ${name}: refused with ${body.code}, not the catalogue-miss code: ${JSON.stringify(body)}`);
        (byName[name] ??= []).push(JSON.stringify(body));
      }
    }
    // One value, byte for byte, whatever the caller presented — per requested name, since the two
    // names are different questions and their miss messages say which they were asked. A refusal
    // that varied by credential would be an oracle into whether the function exists.
    for (const [name, bodies] of Object.entries(byName)) {
      assert.equal(bodies.length, 3, `${name}: fewer credential shapes probed than this test lists`);
      assert.ok(bodies.every((b) => b === bodies[0]),
        `the ${name} refusal differs by credential: ${new Set(bodies).size} distinct bodies`);
    }
  });

  test('API39 the Stage 10 money surface exists, has no wrapper, and is unreachable over HTTP', async () => {
    // The ledger's six write and recovery verbs, inventoried in the same shape §B puts Stage 5's
    // review acts in and for the same reason — a browser must not be able to say it paid. What
    // differs is the escalation story: these are SECURITY INVOKER, so even the role that owns them
    // acts as itself, which is what lets `record_commerce_event` nest the grant and revocation steps
    // instead of duplicating them, and is why each takes an explicit actor instead of reading a JWT.
    const internal = readSurface('internal_api');
    const exposed = readSurface('api');
    const missing = COMMERCE_SERVICE_ONLY.filter(n => !internal.some(r => r.name === n));
    assert.deepEqual(missing, [], `money bodies missing from internal_api: ${missing.join(', ')}`);

    const bodies = internal.filter(r => COMMERCE_SERVICE_ONLY.includes(r.name));
    // By length as well as by name, because a same-name overload with a second signature would pass
    // a name census and still be a second door.
    assert.equal(bodies.length, COMMERCE_SERVICE_ONLY.length,
      `internal_api holds ${bodies.length} rows for ${COMMERCE_SERVICE_ONLY.length} money bodies; an overload is not a reviewed addition`);

    for (const row of bodies) {
      assert.equal(row.securer, 'false',
        `${row.name} is SECURITY DEFINER; the money surface was built to need no escalation`);
      assert.equal(row.language, 'plpgsql', `${row.name} is written in ${row.language}`);
      assert.ok(row.config.includes('search_path=""'),
        `${row.name} does not pin its search_path: '${row.config}'`);
      assert.equal(row.owner, 'postgres', `${row.name} is owned by ${row.owner}`);
      assert.deepEqual(row.grantees, [],
        `${row.name} is granted to ${row.grantees.join(', ')}; no role a request can hold may record a payment`);
      assert.ok(!exposed.some(r => r.name === row.name),
        `${row.name} has a wrapper in api, which would put a money act behind an HTTP door`);
    }

    // The other direction, and the one the six-name list cannot see: no *seventh* commerce verb grew a
    // door. `create_commerce_order` and `record_commerce_event` are the two verbs a front end could
    // most plausibly be handed by mistake, so the exposed half is censused by substring rather than
    // left to the paired list above.
    //
    // Stage 11 is the first head that makes the substring wider than the money model, because its two
    // refund-oversight doors carry `commerce` in their names: `operator_commerce_review_queue` reads the
    // ledger and `operator_add_commerce_review_note` appends a note to a refund row. Neither is a money
    // verb, and that is not assumed here — it is measured one case at a time in
    // `supabase/tests/api/stage11_operations_http.test.mjs`'s refund-queue group (`R-01`–`R-07`), which
    // reads the ledger's digests and the policy singleton before and after every call through these two
    // doors. What this line keeps holding is the claim it was written for: no name from
    // `COMMERCE_SERVICE_ONLY` has an HTTP door, and a third commerce-shaped door appearing here without
    // being one of these three is still a failure.
    assert.deepEqual(exposed.filter(r => r.name.includes('commerce')).map(r => r.name).sort(),
      ['commerce_host_summary', 'operator_add_commerce_review_note', 'operator_commerce_review_queue'],
      'the exposed RPC schema holds a commerce name outside the host read and Stage 11\'s two '
      + 'refund-oversight doors');

    // The same facts as a client experiences them. Two spelling per name, three credential shapes,
    // and the same refusal the maintenance surface gets: PostgREST resolves the name inside the
    // exposed profile before it reaches any privilege check, so the answer is 404 / PGRST202 rather
    // than 401 or 403 — and it must not vary by credential, or the endpoint has become a way to learn
    // whether a money body exists. The bodies are probed with an empty object on purpose: an argument
    // list would be a second question, and a 400 here would read like a routed call.
    const byName = {};
    for (const [label, key] of [
      ['apikey only', anonKey],
      ['as a bearer token', anonKey],
      ['the server key', serviceKey],
    ]) {
      for (const fn of ['create_commerce_order', 'record_commerce_event']) {
        for (const [target, spelling] of [
          [`/rest/v1/rpc/${fn}`, 'unqualified'],
          [`/rest/v1/rpc/internal_api.${fn}`, 'schema-qualified'],
        ]) {
          const res = await fetch(`${url}${target}`, {
            method: 'POST',
            headers: {
              apikey: key, Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json', 'Content-Profile': 'api',
            },
            body: '{}',
          });
          const body = await res.json().catch(() => ({}));
          assert.equal(res.status, 404,
            `${label} / ${fn} ${spelling}: a money call was routed rather than refused (${res.status} ${JSON.stringify(body)})`);
          assert.equal(body.code, 'PGRST202',
            `${label} / ${fn} ${spelling}: refused with ${body.code}, not the catalogue-miss code: ${JSON.stringify(body)}`);
          (byName[`${fn} ${spelling}`] ??= []).push(JSON.stringify(body));
        }
      }
    }
    for (const [name, refusals] of Object.entries(byName)) {
      assert.equal(refusals.length, 3, `${name}: fewer credential shapes probed than this test lists`);
      assert.ok(refusals.every((b) => b === refusals[0]),
        `the ${name} refusal differs by credential: ${new Set(refusals).size} distinct bodies`);
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
    // the twenty-two bodies that have a wrapper beside them *are* browser-callable, by
    // necessity — PostgreSQL checks a nested call as the invoking role, so a wrapper's
    // caller must also hold EXECUTE on the body beside it. API33 is what keeps that
    // necessary grant to exactly those twenty-two paired names, API38 is what proves the
    // eleven maintenance bodies behind them are granted to nobody but the owner, API39 does
    // the same for Stage 10's six money bodies, and
    // `stage3_security.test.mjs` is what measures that none of it is reachable as an HTTP
    // profile.
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
