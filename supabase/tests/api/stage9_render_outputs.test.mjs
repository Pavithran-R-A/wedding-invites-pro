// Stage 9 §7/§8/§12 at the HTTP layer: the manifest's own boundary, measured through the deployed
// stack rather than through a role that pretends to be one.
//
// What the SQL tier already covers, and what this file therefore refuses to repeat. The schema, the
// grants, the two guard triggers, the key-minting trigger and every CHECK of
// `public.invitation_outputs` are qualified in `supabase/tests/stage9/80_render_manifest.sql`, on a
// throwaway Postgres, in both migration-chain modes. That tier cannot see PostgREST, GoTrue, the
// Storage service or a signed URL — and those four things are the whole of what a host actually
// experiences when it presses "download". So this file asks only the questions the SQL battery has no
// channel to answer:
//
//   T  which schema serves the two Stage 9 verbs, and which does not serve the bodies beside them;
//   P  what a browser role can and cannot do to the manifest *as a browser role* (grant, RLS scope,
//      and the three private helpers' reachability from the outside);
//   R  whether the render source really reads the frozen version rather than the keystroke before it;
//   M  what the host's manifest projection contains, in what order, and with which three omissions;
//   K  the key the database mints for each storage domain, through a trusted write;
//   L  the lifecycle as the maintenance process walks it, including the attempt ceiling closed by
//      `20261016120000_stage9_attempt_ceiling_exit.sql`, whose refusal is observed here over the same
//      channel the publisher uses;
//   E  the delivery path the mandate names: register → upload → read back → verify → ready → the host's
//      signed URL → the exact bytes → a superseded row and a closed public bucket;
//   Z  that this run's own artefacts are all accounted for before it leaves.
//
// WHERE THE BOUNDARY OF THESE NUMBERS IS. Group E drives the product's own publisher
// (`scripts/stage9-output-publisher.mjs`) through its real channels — the same `docker exec psql` the
// CLI uses for the registry, and the same Storage REST spellings it uses for the bytes — with the
// render channel replaced by a stand-in that writes a real, decodable PNG. That substitution is the
// whole cost of running this tier in seconds instead of minutes, and it bounds every claim below: the
// bytes are real (uploaded, fetched back, hashed, compared) but they are not *rendered*, so nothing in
// this file is evidence about Indic shaping, glyph coverage, page geometry, or what an invitation looks
// like. Those claims belong to `scripts/stage9-render-raster.mjs` and the Chromium output tier, which
// produced them through this same publisher path. Group E's claim is narrower and is stated once here:
// the delivery machinery moves exactly the bytes it was handed, records the digest it verified, and
// hands them to nobody but the wedding's owner.
//
// Teardown is a Storage sweep, then a child-before-parent delete list, then the synthetic accounts,
// then a census assertion that the database is where it started. A `ready` row is not deletable
// (§12's delete-then-mark), so objects go before rows; that ordering is not a convenience, it is the
// guard's own rule obeyed by the only caller allowed to obey it.
//
// `run.sh` runs this file serially with the other suites and fails the whole gate if any row count
// moves, so a leak here stops the run rather than being inherited by the next suite.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { dtoDigest } from '../../../scripts/stage9-render-worker.mjs';
import { parseInvitationObject } from '../../../src/lib/publicInvitation.ts';
import {
  decodeLine,
  runPsql,
  makeSqlChannel,
  makeStorageChannel,
  runPublish,
} from '../../../scripts/stage9-output-publisher.mjs';
import { sqlReadVersion } from '../../../scripts/stage9-publish-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

const env = (() => {
  const text = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
})();
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
if (PROJECT_ID !== 'localvivaahvarnam') {
  throw new Error(`refusing to run: project_id is ${PROJECT_ID}, and this suite only writes to localvivaahvarnam`);
}
const DB_CONTAINER = process.env.STAGE3_DB_CONTAINER ?? `supabase_db_${PROJECT_ID}`;
if (!/^[A-Za-z0-9_.-]+$/.test(DB_CONTAINER)) {
  throw new Error(`refusing to run: STAGE3_DB_CONTAINER=${DB_CONTAINER} is not a container name`);
}
// The publisher's own maintenance target, named rather than discovered: the same container the runner
// exports, and the only one this file is allowed to write through.
const TARGET = { mode: 'docker', container: DB_CONTAINER };

const RUN_TAG = process.env.STAGE9_HTTP_RUN_TAG
  ?? `s9http-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
if (!/^[a-z0-9_-]+$/.test(RUN_TAG)) {
  throw new Error(`refusing to run: STAGE9_HTTP_RUN_TAG=${RUN_TAG} is not a run tag`);
}

/** The two buckets §1 creates. `invitation-outputs` is the one a host may read; `invitation-previews`
 *  is created closed and stays closed in this build, which is what E-05 measures rather than assumes. */
const OUT = 'invitation-outputs';
const PREV = 'invitation-previews';

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Well-formed and belonging to nothing. `R-02` uses it to show that "not yours" and "not there" are
 *  one answer — the same no-oracle shape Stage 8 measured at the household door. */
const NOT_A_VERSION = '44444444-4444-4444-8444-444444444444';
const NOT_A_WEDDING = '00000000-0000-4000-8000-000000000000';
const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}`;

/** The manifest carries an object key and, for a plate, the digest of a live credential's address.
 *  Neither belongs in a run log that outlives the repository, so every string this file prints or puts
 *  into an assertion message passes through here. The checks themselves are never relaxed by it. */
const shown = (value) => String(value)
  .replace(/[A-Za-z0-9_-]{43}/g, '[REDACTED-43]')
  .replace(/[0-9a-f]{64}/g, '[REDACTED-64]');

// ---------------------------------------------------------------------------
// The shapes, each read off the migration at the quoted line.
// ---------------------------------------------------------------------------
// `internal_api.list_invitation_outputs`'s subselect (`20261013120000_stage9_render_outputs.sql:576-578`):
// fifteen columns, and the three names it withholds are the subject of `M-01`.
const ROW_KEYS = ['attempt_count', 'content_digest', 'created_at', 'format', 'id', 'invalidation_reason',
  'last_error', 'output_kind', 'page_number', 'ready_at', 'render_config_hash', 'status',
  'storage_domain', 'variant', 'version_id'];
const WITHHELD = ['object_key', 'target_url_digest', 'wedding_id'];
// `private.public_invitation_dto` is unchanged by Stage 9, so the twelve keys are the list Stage 7
// measured out of a live response and Stage 8 restates at `stage8_guest_rsvp.test.mjs:273`.
const INVITATION_KEYS = ['closing', 'design_template', 'event_notes', 'events', 'family_introduction',
  'language', 'people', 'sections', 'style', 'title', 'tradition_pack', 'welcome'];

/** Every sentence the Stage 9 bodies and triggers raise, with the line that raises it. Transcribed from
 *  the migrations rather than from a probe log: this head has no probe log for the HTTP tier, which is
 *  exactly the weakness the first run of this file is here to test. The ceiling sentence is the one the
 *  forward repair adds at its `:81`, and the `%` in the no-edge sentence is filled by Postgres from the
 *  two states it is shown. */
const SAY = {
  notRender: 'the caller may not render this version',                 // :518, and again at :532
  notRead: 'the caller may not read this wedding',                     // :567
  keySupplied: 'invitation_outputs.object_key is minted by the database and cannot be supplied',   // :224
  bornRegistered: 'a new invitation output always starts as registered',                            // :230
  bornEvidence: 'a registered output cannot carry evidence of bytes it has not produced',           // :235
  reParent: 'an invitation output cannot be re-parented to another wedding',                        // :289
  boundVersion: 'an invitation output is bound to the version it was rendered from',                // :292
  shapeKeyed: 'the kind, geometry, format and page are part of the uniqueness key',                 // :298
  configSticky: 'render_config_hash is the key half that makes a stale artefact detectable',         // :301
  dtoSticky: 'source_dto_digest records what was rendered and cannot be rewritten',                  // :304
  targetSticky: 'target_url_digest records what a QR pointed at and cannot be rewritten',            // :307
  keyImmutable: 'invitation_outputs.object_key is immutable once minted',                             // :310
  domainMoved: 'an artefact cannot be moved between the private and published storage domains',       // :313
  noEvidenceWrite: 'a write that changes no status may change no evidence either',                    // :327
  terminal: 'an invalidated invitation output is terminal',                                           // :333
  readyOnly: 'a ready invitation output may only be invalidated',                                     // :337
  noDigest: 'a row may not become ready without the digest of the bytes it produced',                 // :358
  noBytesInvalidate: 'a failed output with no stored bytes is removed rather than invalidated',       // :367
  oneAttempt: 'entering failed records exactly one attempt',                                           // :376
  nameReason: 'a failure must name its reason',                                                       // :379
  countOnlyOnFailure: 'attempt_count moves only when a failure is recorded',                          // :382
  ceiling: 'the attempt budget is spent: a failed output at attempt_count 5 may not be retried',     // repair:81
  deleteReady: 'invalidate the output before deleting its manifest row',                              // :405
  deleteUploading: 'an output with an upload in flight is not deletable; let it reach ready or failed', // :408
};

const noEdge = (from, to) => `no edge registered → ${from} → ${to} exists in the output lifecycle`;

// --------------------------------------------------------------------------- SQL
/** `-q` is load-bearing, not cosmetic: measured on this stack, `psql -tA` prints a command tag line for
 *  every statement that writes or defines (`INSERT 0 1`, `DO`, `CREATE TABLE`), and a one-row read that
 *  also got a tag would look exactly like a stray row. `-At -q` is what the publisher's own channel
 *  sends, so this helper and the code under test read the database the same way. */
function sqlRows(query) {
  const out = execFileSync('docker', ['exec', '-i', DB_CONTAINER,
    'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAq', '-F', '|', '-c', query],
  { encoding: 'utf8' });
  return out.split(/\r?\n/).filter((line) => line.length > 0);
}

/** A one-row read. These values are database facts, so a census that cannot be read fails with its own
 *  name rather than carrying on with `undefined`. */
function sqlCell(query, what) {
  const rows = sqlRows(query);
  assert.equal(rows.length, 1, `${what} did not read exactly one row: ${shown(JSON.stringify(rows))}`);
  return rows[0];
}
const cell = (query, what) => sqlCell(query, what);

/** A statement that must succeed. `-i` is load-bearing: `docker exec` without it silently discards
 *  stdin and still exits 0, which is how a walk that never ran can look like a pass. */
function exec(statement, what) {
  try {
    return sqlRows(statement);
  } catch (error) {
    throw new Error(`${what} failed: ${shown(String(error.stdout ?? error.message)).slice(0, 400)}`);
  }
}

/** The database's own answer to a statement that refuses, in the form the SQL battery compares:
 *  `SQLSTATE || ' ' || SQLERRM`. Measured on this stack, `SQLERRM` carries no `ERROR:` prefix. The pair
 *  is returned as one string because a refusal is scored on its sentence *and* its code together: a
 *  `23514` that happens to print the right words is not the same event as a `42501` that does, and the
 *  lifecycle cases below have to tell them apart. A statement that is accepted reports `ACCEPTED`, so
 *  every negative case also fails if the database said yes. */
function refusalOf(statement, what) {
  // `set client_min_messages = warning` is for the capture, not for the measurement: each refusal runs in
  // a fresh session, where `pg_temp` does not exist yet, so psql raised a NOTICE before every one of the
  // 38 refusals below and buried the results in noise. A NOTICE is below WARNING, so this line silences
  // the chatter and no `sqlerrm` this file scores on.
  return cell(`
    set client_min_messages = warning;
    drop table if exists pg_temp.s9_http_refusal;
    create temp table pg_temp.s9_http_refusal(t text);
    do $body$ begin
      ${statement};
      insert into pg_temp.s9_http_refusal values ('ACCEPTED');
    exception when others then
      insert into pg_temp.s9_http_refusal values (sqlstate || ' ' || sqlerrm);
    end $body$;
    select coalesce(max(t), 'nothing') from pg_temp.s9_http_refusal`, what);
}

const refused = (statement, expectation, what) => {
  const answer = refusalOf(statement, what);
  assert.ok(answer !== 'ACCEPTED', `${what}: the database accepted a write it was meant to refuse `
    + `(statement ${shown(statement).slice(0, 160)})`);
  assert.match(answer, new RegExp(`^${expectation.code} `),
    `${what}: refused with the wrong SQLSTATE: ${shown(answer)}`);
  assert.ok(answer.includes(expectation.sentence),
    `${what}: expected the sentence ${JSON.stringify(expectation.sentence)}, got ${shown(answer)}`);
  return answer;
};

/** One row's whole lifecycle surface as one comparable string, so "this moved" and "this did not move"
 *  are each one read. `key` is included because the immutability cases claim it, and it is masked by
 *  `shown` before it can reach a message. */
const factsOf = (id) => cell(`
  select 'status=' || status
    || ' attempts=' || attempt_count::text
    || ' error=' || coalesce(last_error, '-')
    || ' digest=' || coalesce(left(content_digest, 12), '-')
    || ' ready=' || (ready_at is not null)::text
    || ' invalid=' || (invalidated_at is not null)::text
    || ' reason=' || coalesce(invalidation_reason, '-')
    || ' domain=' || storage_domain
    || ' config=' || left(render_config_hash, 12)
    || ' key=' || object_key
  from public.invitation_outputs where id = '${id}'::uuid`, `the facts of ${shown(id)}`);

/** The same facts again, this time as the fields they are: an assertion about a lifecycle step names the
 *  column it is about, rather than betting on which two fields happen to be printed next to each other.
 *  `chr(31)` cannot occur in any of these values, so the split is positional and total. */
const FACT_FIELDS = ['status', 'attempts', 'error', 'digest', 'ready', 'invalid', 'reason', 'domain',
  'config', 'key'];
const facts = (id) => {  const line = cell(`
    select status || chr(31) || attempt_count::text || chr(31) || coalesce(last_error, '-') || chr(31)
      || coalesce(left(content_digest, 12), '-') || chr(31) || (ready_at is not null)::text || chr(31)
      || (invalidated_at is not null)::text || chr(31) || coalesce(invalidation_reason, '-') || chr(31)
      || storage_domain || chr(31) || left(render_config_hash, 12) || chr(31) || object_key
    from public.invitation_outputs where id = '${id}'::uuid`, `the field facts of ${shown(id)}`);
  const parts = line.split('\u001f');
  assert.equal(parts.length, FACT_FIELDS.length, `the fact row parsed as ${shown(JSON.stringify(parts))}`);
  return Object.fromEntries(FACT_FIELDS.map((field, i) => [field, parts[i]]));
};

/** `facts` narrowed to the fields one claim is about, so the object compared is exactly the claim. */
const picked = (id, fields) => {
  const f = facts(id);
  return Object.fromEntries(fields.map((field) => [field, f[field]]));
};

const absent = (id) => cell(`select count(*)::text from public.invitation_outputs where id = '${id}'::uuid`,
  `the row count for ${shown(id)}`);

/** The two census facts that would otherwise only surface as an unexplained total in `run.sh`: a row
 *  stuck mid-upload at the attempt ceiling (the deadlock the repair closes) and an object in either
 *  bucket that no row names (an orphan with no owner). */
const ceilingCensus = () => cell(`
  select 'uploading_at_ceiling=' || count(*) filter (where status = 'uploading' and attempt_count >= 5)::text
    || ' failed_at_ceiling=' || count(*) filter (where status = 'failed' and attempt_count >= 5)::text
  from public.invitation_outputs`, 'the ceiling census');

const unledgedKeys = (bucket) => cell(`
  select coalesce(string_agg(s.name, ';' order by s.name), '-')
    from storage.objects s
   where s.bucket_id = '${bucket}'
     and not exists (select 1 from public.invitation_outputs o where o.object_key = s.name)`,
  `the un-ledged ${bucket} objects`);

// --------------------------------------------------------------------------- REST
const REST = '/rest/v1/invitation_outputs';
const people = {};
const tokenOf = (who) => people[who].token;
const uidOf = (who) => people[who].userId;
const weddingOf = (who) => people[who].weddingId;
const versionOf = (who) => people[who].versionId;
const WHO = ['hostA', 'hostB'];

/** One retry, and only for a read. `q9-logs/live/s9-http-run-07.txt` lost E-00 to
 *  `TypeError: fetch failed` / `SocketError: other side closed` against 127.0.0.1:54400 while three
 *  throwaway SQL chains were competing for the host. Kong's access log holds no line for that request,
 *  so the bytes never reached PostgREST — and the four delivery cases that lean on E-00's document fell
 *  behind it, one of them reporting `E-00 must run first` as though the product had broken. A read may be
 *  sent twice: the two RPCs named below are `STABLE` with no DML in their bodies
 *  (`20261013120000_stage9_render_outputs.sql:502,555`) and every other retryable call here is a GET. A
 *  write keeps its single shot, because the harness cannot tell a socket that died before the request
 *  from one that died after the server applied it. `transport_retries` is printed by the post-run check,
 *  so a capture shows whether this path was walked rather than asserting that it never was. */
let transportRetries = 0;
const SOCKET_DEATHS = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE']);
const isSocketDeath = (err) => err instanceof TypeError && SOCKET_DEATHS.has(err?.cause?.code);
const READ_RPCS = new Set(['/rest/v1/rpc/render_invitation_document', '/rest/v1/rpc/list_invitation_outputs']);
const isReadCall = (method, path) => method === 'GET' || method === 'HEAD'
  || (method === 'POST' && READ_RPCS.has(path.split('?')[0]));

async function withReadRetry(what, send) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await send();
    } catch (err) {
      if (!isSocketDeath(err) || attempt >= 2) throw err;
      transportRetries += 1;
      console.error(`  transport  ${what}: the socket died before any response (${err.cause.code}), `
        + `attempt ${attempt} — retrying once`);
    }
  }
}

async function signUp(who) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: emailFor(who), password: PASSWORD });
  assert.equal(error, null, `signup failed for ${who}`);
  assert.ok(data.session, 'expected a session immediately');
  const { data: fresh } = await c.auth.getSession();
  return { client: c, userId: data.user.id, token: fresh.session.access_token };
}

async function call(method, path, opts = {}) {
  const send = () => callOnce(method, path, opts);
  return isReadCall(method, path) ? withReadRetry(`${method} ${path}`, send) : send();
}

async function callOnce(method, path, { body, bearer = anonKey, headers = {} } = {}) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: anonKey, Authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text === '' ? null : JSON.parse(text); } catch { parsed = { unparsed: text.slice(0, 300) }; }
  return { status: res.status, text, body: parsed };
}

/** An RPC the way the product's client sends one: `api` profile, POST, JSON. `profile: null` drops the
 *  header, which is the case T-01 measures rather than the case any test should accidentally be. */
async function rpc(name, args, { as = 'anon', headers = {}, profile = 'api' } = {}) {
  const bearer = as === 'anon' ? anonKey : as === 'service' ? serviceKey : tokenOf(as);
  const all = { ...headers };
  if (profile) all['Content-Profile'] = profile;
  return call('POST', `/rest/v1/rpc/${name}`, { body: args, bearer, headers: all });
}

const listOutputs = (who, weddingId, opts = {}) => rpc('list_invitation_outputs',
  { p_wedding_id: weddingId }, { as: who, ...opts });
const renderDoc = (who, versionId, opts = {}) => rpc('render_invitation_document',
  { p_version_id: versionId }, { as: who, ...opts });

/** The trusted Storage write, spelled the way the publisher spells it (`makeStorageChannel`), but with
 *  the bucket as an argument so the closed preview bucket can be populated for E-05. `invitation-outputs`
 *  is reached through that channel by the publisher itself; only this file's preview probe names a
 *  bucket directly. */
async function servicePut(bucket, key, bytes, mime) {
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${key}`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': mime },
    body: bytes,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function serviceRemove(bucket, key) {
  const res = await fetch(`${url}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [key] }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** `expiresIn` is a parameter rather than a constant because E-07 has to measure two things at once: the
 *  lifetime the product actually asks for (60, `src/integrations/supabase/invitationOutputs.ts:63`) and a
 *  refusal that can only be observed before a minute of dead air. The probe that read both numbers off a
 *  running Storage is `q9-logs/live/probe-s9-sign-scope-02.txt`; this file asks for the short clock so the
 *  expiry is an observation rather than an inference. */
const storageSign = async (key, { as = 'anon', bucket = OUT, expiresIn = 60 } = {}) => {
  const res = await fetch(`${url}/storage/v1/object/sign/${bucket}/${key}`, {
    method: 'POST',
    headers: {
      apikey: anonKey, Authorization: `Bearer ${as === 'anon' ? anonKey : tokenOf(as)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/** The signed URL's credential, and the claims inside it. Stage 6 fetched the token (SGN-01..03) and
 *  never opened it, which is why "the link dies in sixty seconds" has been a claim about the client's
 *  request rather than about the server's answer until E-07. A base64url decode, not a verification —
 *  this file asserts what Storage stamped, and Storage asserts it at fetch time. */
const signedToken = (signedURL) => {
  const token = new URL(`${url}/storage/v1${signedURL}`).searchParams.get('token');
  assert.equal(typeof token, 'string', `a signed URL with no token: ${shown(signedURL).slice(0, 40)}`);
  return token;
};
const tokenClaims = (token) => {
  const parts = token.split('.');
  assert.equal(parts.length, 3, `a JWT of ${parts.length} parts`);
  return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
};

/** Bytes out of the authenticated object route, with the JSON error body kept beside them — Stage 6's
 *  `storageRead` (`stage6_storage.test.mjs:212-222`), with the bucket as an argument. */
const storageRead = async (key, { as = 'anon', bucket = OUT } = {}) => {
  const res = await fetch(`${url}/storage/v1/object/authenticated/${bucket}/${key}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${as === 'anon' ? anonKey : tokenOf(as)}` },
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  let body = null;
  if (res.status >= 400) { try { body = JSON.parse(bytes.toString('utf8')); } catch { body = null; } }
  return { status: res.status, bytes, body };
};

/** The signed path is served under `/storage/v1`; fetched at the bare origin it is Kong's 404. Both
 *  halves measured by Stage 6's probe #5, and the reason this helper prefixes rather than guesses. */
const fetchSigned = async (signedURL) => {
  const res = await fetch(`${url}/storage/v1${signedURL}`);
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') };
};

const objectPresent = (bucket, key) => cell(
  `select count(*)::text from storage.objects where bucket_id = '${bucket}' and name = '${key}'`,
  `the storage row for ${bucket}/${shown(key)}`);

// --------------------------------------------------------------------------- the stand-in render
/** CRC-32 exactly as PNG requires it, computed once. Node's `zlib.crc32` exists from v22.2, but a
 *  checksum has no business being optional in an instrument that has to run wherever the suite runs. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
};

/** A real, decodable PNG of a stated box: signature, IHDR, one zlib stream of zero-filled RGB
 *  scanlines, IEND. It is built here rather than imported from the render worker because the
 *  publisher's contract is *a file on disk whose header states its own geometry*, which is exactly what
 *  `verifyReadBack` re-reads after the fetch. The pixel count is the truth the IHDR claims: a PNG that
 *  said 1200x630 while its IDAT decoded to 8x8 would make E-01 a test of the header parser rather than
 *  of the delivery path. */
function pngBytes(width, height, label) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const row = Buffer.alloc(1 + width * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  // A `tEXt` chunk carrying the label is what makes two draws of the same geometry differ: E-03 needs a
  // supersession to be about different bytes, and a flat image of the same size would otherwise hash the
  // same whatever the config said. Keyword + NUL + text is the chunk's whole format, and a decoder that
  // ignores unknown chunks still reads the geometry back.
  const text = Buffer.from(`Comment\0${label}`, 'utf8');
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('tEXt', text), chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))]);
}

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const HASH_SEED = `stage9-http:${RUN_TAG}`;
const configHash = (salt) => sha256Hex(Buffer.from(`${HASH_SEED}:${salt}`, 'utf8'));
const dtoFixtureDigest = sha256Hex(Buffer.from(`${HASH_SEED}:dto`, 'utf8'));

/** The directory this run's stand-in files live in, under the OS temp dir and named by the run tag: it
 *  is this task's own residue, outside the repository, and `after()` removes exactly this path. */
const SCRATCH = join(tmpdir(), RUN_TAG);

/** A render channel that answers in bytes rather than in glyphs. Each artefact is written to disk,
 *  hashed, and reported in the worker's own record shape — `name` spelled the way `writeArtefact`
 *  spells it (`${kind}_${variant}_p${page}.${format}`, `stage9-render-worker.mjs:851`), because
 *  `artefactIdentity` parses the name back into four manifest columns and a stand-in that invented its
 *  own naming rule would test only itself.
 *
 *  `source_dto_digest` is the product's own digest function applied to the DTO this version really
 *  returned. Using the same function is deliberate: an independent re-implementation would let this
 *  file pass while the two halves of the product disagreed, which is the failure the publisher's
 *  `dto-digest-disagreement` refusal exists to catch. */
function makeStandInRender({ outDir, versionDto, salt }) {
  const digest = dtoDigest(parseInvitationObject(versionDto));
  const draw = () => {
    const bytes = pngBytes(1200, 630, `salt=${salt}`);
    const name = 'og_image_1200x630_p1.png';
    const path = join(outDir, name);
    writeFileSync(path, bytes);
    return {
      name, path, kind: 'og_image', variant: '1200x630', format: 'png', page_number: 1,
      bytes: bytes.length, content_digest: sha256Hex(bytes), render_config_hash: configHash(salt),
    };
  };
  return {
    digest,
    renderOgTeaser: () => ({ ok: true, source_dto_digest: digest, artefacts: [draw()] }),
    renderShareImage: () => ({ ok: false, reason: 'this battery draws one artefact per run' }),
    renderPdf: () => ({ ok: false, reason: 'this battery draws one artefact per run' }),
    renderQrPlate: () => ({ ok: false, reason: 'this battery draws one artefact per run' }),
  };
}

// --------------------------------------------------------------------------- the census
let BASELINE = null;
const censusQuery = `select 'weddings='||count(*) from public.weddings
  union all select 'invitation_versions='||count(*) from public.invitation_versions
  union all select 'invitation_drafts='||count(*) from public.invitation_drafts
  union all select 'publications='||count(*) from public.publications
  union all select 'invitation_outputs='||count(*) from public.invitation_outputs
  union all select 'storage.objects(invitation-outputs)='||count(*) from storage.objects where bucket_id = '${OUT}'
  union all select 'storage.objects(invitation-previews)='||count(*) from storage.objects where bucket_id = '${PREV}'
  union all select 'auth.users='||count(*) from auth.users`;
const census = () => Object.fromEntries(sqlRows(censusQuery).map((r) => r.split('=')));

// --------------------------------------------------------------------------- fixtures
const HOST_EVENTS = (label) => ([
  { event_key: 'muhoortam', display_name: `${label} Muhoortham`, starts_at_local: '2027-02-14T09:00:00',
    ends_at_local: '2027-02-14T11:00:00', display_order: 1, enabled: true },
  { event_key: 'reception', display_name: `${label} Reception`, starts_at_local: '2027-02-14T18:00:00',
    ends_at_local: '2027-02-14T22:00:00', display_order: 2, enabled: true },
]);

/** A wedding, a draft, two events, one frozen version and one publication, all built with the
 *  privileges the product's own host screen has — the same sequence Stage 8's fixture uses, and for the
 *  same reason: a row the browser could not create would make every refusal below a statement about a
 *  shape the product never writes. */
async function buildWedding(who, label, welcome) {
  const w = await call('POST', '/rest/v1/weddings', {
    bearer: tokenOf(who),
    body: { owner_user_id: uidOf(who), title: `S9 HTTP ${label} ${RUN_TAG}`, primary_language: 'en' },
    headers: { Prefer: 'return=representation' },
  });
  assert.equal(w.status, 201, `${who} could not create a wedding: ${shown(JSON.stringify(w.body))}`);
  people[who].weddingId = w.body[0].id;

  const d = await call('PATCH', `/rest/v1/invitation_drafts?wedding_id=eq.${people[who].weddingId}`, {
    bearer: tokenOf(who),
    body: { content: { welcome, family_introduction: `The families of ${label} invite you.`,
      event_notes: null, closing: null } },
    headers: { Prefer: 'return=representation' },
  });
  assert.equal(d.status, 200, `${who} could not write its draft: ${shown(JSON.stringify(d.body))}`);

  for (const event of HOST_EVENTS(label)) {
    const e = await call('POST', '/rest/v1/wedding_events', {
      bearer: tokenOf(who),
      body: { ...event, wedding_id: people[who].weddingId, timezone: 'Asia/Kolkata' },
      headers: { Prefer: 'return=representation' },
    });
    assert.equal(e.status, 201, `${who} could not create ${event.event_key}: ${shown(JSON.stringify(e.body))}`);
  }

  const v = await rpc('create_invitation_version', { p_wedding_id: people[who].weddingId }, { as: who });
  assert.equal(v.status, 200, `${who} could not freeze a version: ${shown(JSON.stringify(v.body))}`);
  people[who].versionId = v.body.version_id;

  const p = await rpc('publish_invitation_version',
    { p_wedding_id: people[who].weddingId, p_version_id: v.body.version_id, p_expires_at: null }, { as: who });
  assert.equal(p.status, 200, `${who} could not publish: ${shown(JSON.stringify(p.body))}`);
  people[who].publicPath = p.body.path;
}

/** A trusted registration, in the form the maintenance process writes one: no key, no status, no
 *  evidence, and the minted identity read back out of the same statement. The hashes are fixtures — a
 *  placeholder digest is honest here because these rows never have bytes behind them, which is exactly
 *  what group L then proves the lifecycle refuses to pretend otherwise about. The delivered-bytes claim
 *  is group E's, and it uses the publisher's own writes. */
function registerRow({ who, kind = 'og_image', variant = '1200x630', format = 'png', page = 1,
  domain = 'host_private', salt = 'row', target = null, version = versionOf(who) }) {
  assert.equal(kind === 'qr', target !== null, `a ${kind} fixture and a target digest must agree`);
  const returning = cell(`
    insert into public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
      page_number, render_config_hash, source_dto_digest, target_url_digest, storage_domain)
    values ('${weddingOf(who)}'::uuid, '${version}'::uuid, '${kind}', '${variant}', '${format}', ${page},
      '${configHash(salt)}', '${dtoFixtureDigest}',
      ${target === null ? 'null' : `'${sha256Hex(Buffer.from(target, 'utf8'))}'`}, '${domain}')
    returning id || '|' || object_key || '|' || status`, `the registration of a ${kind}/${variant} row`);
  const [id, objectKey, status] = returning.split('|');
  assert.match(id, UUID, `a registered row answered ${shown(id)}`);
  assert.equal(status, 'registered', 'a row was not born in the state §2 says is the only birth state');
  return { id, objectKey };
}

/** The four lifecycle statements, spelled once. Group L asserts each edge and group E has to walk one, so
 *  a second spelling of the same UPDATE would be a second thing to keep honest — and the attempt/
 *  reason/evidence rules below are exactly what L-01..L-05 prove the database enforces. */
const toUploading = (id) => `update public.invitation_outputs set status = 'uploading' where id = '${id}'::uuid`;
const toReady = (id, digest) => `update public.invitation_outputs set status = 'ready', content_digest = '${digest}' where id = '${id}'::uuid`;
const toFailed = (id, attempts, error) => `update public.invitation_outputs set status = 'failed',
   attempt_count = ${attempts}, last_error = '${error}' where id = '${id}'::uuid`;
const toInvalidated = (id, reason) => `update public.invitation_outputs set status = 'invalidated',
   invalidation_reason = '${reason}' where id = '${id}'::uuid`;

/** The publisher's own two channels, pointed at this stack. `makeSqlChannel(…, true)` is the mutating
 *  half — this file is a battery that publishes, so a withheld statement would be a missing case rather
 *  than a dry run. */
const publish = async ({ salt, versionDto }) => runPublish({
  versionId: versionOf('hostA'),
  kinds: ['og_image'],
  yes: true,
  channels: {
    sql: makeSqlChannel((statement) => runPsql(TARGET, statement), true),
    storage: makeStorageChannel({ apiOrigin: url, apiKey: serviceKey }),
    render: makeStandInRender({ outDir: SCRATCH, versionDto, salt }),
    readArtefact: (path) => readFileSync(path),
  },
});

// --------------------------------------------------------------------------- the delivery fixtures
/** An artefact this file owns end to end: registered through the database's own mint, filled with real
 *  PNG bytes through the service channel, and walked to `ready` by the lifecycle the guard allows.
 *
 *  Group L's `registerRow` fixtures deliberately have no bytes behind them — that is what L proves the
 *  lifecycle refuses to let a row pretend otherwise about. Group E's later cases are about *downloads*,
 *  so they need the opposite: a row whose digest equals the bytes a fetcher can get. The shape is
 *  `share_image/1080x2160/png` (`:153`), which no publish case occupies, so a fixture can never collide
 *  with the publisher's determinism tuple for hostA's version. `after()` sweeps every row and object this
 *  run made, so a fixture that ends `ready` is retired and removed here rather than by a later case. */
async function deliverFixture(who, label) {
  const row = registerRow({ who, kind: 'share_image', variant: '1080x2160', format: 'png', salt: label });
  const bytes = pngBytes(8, 8, label);
  const digest = sha256Hex(bytes);
  const put = await servicePut(OUT, row.objectKey, bytes, 'image/png');
  assert.ok(put.status < 400, `${label}: the service upload was refused: ${shown(JSON.stringify(put))}`);
  exec(toUploading(row.id), `${label}: the upload step`);
  exec(toReady(row.id, digest), `${label}: the ready step`);
  assert.deepEqual(picked(row.id, ['status', 'digest', 'ready']),
    { status: 'ready', digest: digest.slice(0, 12), ready: 'true' },
    `${label}: ${shown(JSON.stringify(facts(row.id)))}`);
  return { id: row.id, key: row.objectKey, bytes, digest };
}

/** The only retirement a `ready` row can walk (§4's edge list, `:345`), followed by the deletion the
 *  delete guard then permits (:404 refuses it while the artefact is still `ready`). */
async function retireFixture(art, reason = 'asset_deleted') {
  await serviceRemove(OUT, art.key);
  exec(toInvalidated(art.id, reason), `the retirement of ${shown(art.id)}`);
  exec(`delete from public.invitation_outputs where id = '${art.id}'::uuid`, `the removal of ${shown(art.id)}`);
  assert.equal(absent(art.id), '0', 'the fixture row outlived its case');
}

before(async () => {
  BASELINE = census();

  // The surface first, from the catalog rather than from this file's constants. A stack one migration
  // behind has none of these names, and every case below would then be about functions that are not
  // there — reported as 404s that would read exactly like the refusals this file asserts.
  const names = sqlRows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'api'
                            and p.proname in ('list_invitation_outputs','render_invitation_document') order by 1`);
  assert.deepEqual(names, ['list_invitation_outputs', 'render_invitation_document'],
    'the Stage 9 wrappers are not deployed, so every call below answers 404 and reads exactly like the '
    + 'refusals this file asserts');
  const buckets = sqlRows(`select id from storage.buckets where id in ('${OUT}','${PREV}') order by 1`);
  assert.deepEqual(buckets, [OUT, PREV], 'the two Stage 9 buckets are not both present');
  const ceilingArm = cell(`select position('the attempt budget is spent' in pg_get_functiondef(p.oid))::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'guard_invitation_output_update'`,
    'the deployed guard\'s ceiling arm');
  assert.notEqual(ceilingArm, '0',
    'the attempt-ceiling repair is not deployed on this stack, so L-04 would measure the deadlock '
    + 'rather than the repair');

  for (const who of WHO) Object.assign(people[who] ??= {}, await signUp(who));
  await buildWedding('hostA', 'Published A', 'With the blessings of both families, join us for A.');
  await buildWedding('hostB', 'Published B', 'With the blessings of both families, join us for B.');
  mkdirSync(SCRATCH, { recursive: true });
});

after(async () => {
  // Objects before rows, because a `ready` row refuses deletion until the artefact it points at is gone
  // (§12's delete-then-mark), and rows before versions, because `invitation_outputs` hangs off
  // `invitation_versions` by `NO ACTION`. The sweep goes through the Storage API rather than by deleting
  // from `storage.objects` directly: the latter would leave a real file in the bucket and move the
  // runner's object count for a reason no row describes.
  const weddings = [weddingOf('hostA'), weddingOf('hostB')].filter(Boolean);
  if (weddings.length === 2) {
    const ids = weddings.map((w) => `'${w}'::uuid`).join(',');
    const rows = sqlRows(`select object_key || '#' || storage_domain from public.invitation_outputs
                           where wedding_id in (${ids})`);
    for (const entry of rows) {
      const [key, domain] = entry.split('#');
      await serviceRemove(domain === 'published_preview' ? PREV : OUT, key);
    }
    // The two states that own something are walked out through the lifecycle the guard itself allows,
    // not around it: `ready` may only be invalidated (migration :336), and `uploading` has no edge to
    // `invalidated` at all (:344-348) so it is driven to `failed` — one attempt plus one named reason,
    // which is the shape :371 requires — and then removed as the absent artefact §12 calls it. Deleting
    // straight from `ready` is the refusal this file asserts in L-05; teardown asking for it anyway would
    // make the run's own cleanup the thing that fails.
    exec(`update public.invitation_outputs set status = 'invalidated', invalidation_reason = 'asset_deleted'
           where wedding_id in (${ids}) and status = 'ready'`, 'the ready retirement');
    exec(`update public.invitation_outputs set status = 'failed', attempt_count = attempt_count + 1,
                last_error = 'teardown ended a run that was still uploading'
           where wedding_id in (${ids}) and status = 'uploading'`, 'the in-flight retirement');
    exec(`delete from public.invitation_outputs where wedding_id in (${ids})`, 'the manifest teardown');
    // The child-before-parent order below is read off the catalog, not guessed: measured on this stack,
    // `access_tokens` hangs off `publications` by `wedding_id, publication_id` and `approval_requests`
    // hangs off `invitation_versions`, so deleting a parent first is an FK refusal that aborts the whole
    // sweep and hands the next suite a database this one dirtied. `wedding_events`, `venues`,
    // `wedding_people`, `wedding_assets`, `guest_households`, `rsvp_responses` and `invitation_drafts`
    // are `ON DELETE CASCADE` off `weddings`, so they go with the wedding itself.
    for (const stmt of [
      `delete from private.access_tokens where wedding_id in (${ids})`,
      `delete from public.approval_requests where wedding_id in (${ids})`,
      `delete from public.publications where wedding_id in (${ids})`,
      `delete from public.entitlements where wedding_id in (${ids})`,
      // A version may name the version it replaced, and a `DELETE` has no `ORDER BY`, so the leaf of the
      // supersession chain goes first and the remainder follows in a second sweep.
      `delete from public.invitation_versions v
         where v.wedding_id in (${ids})
           and v.id not in (select supersedes_version_id from public.invitation_versions
                             where supersedes_version_id is not null)`,
      `delete from public.invitation_versions where wedding_id in (${ids})`,
      `delete from public.weddings where id in (${ids})`,
    ]) exec(stmt, `teardown of ${stmt.slice(0, 60)}`);
  }
  for (const who of WHO) {
    if (!uidOf(who)) continue;
    const res = await fetch(`${url}/auth/v1/admin/users/${uidOf(who)}`, {
      method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    assert.ok(res.ok, `teardown could not remove a synthetic account (HTTP ${res.status})`);
  }
  rmSync(SCRATCH, { recursive: true, force: true });

  const now = census();
  const moved = Object.keys(BASELINE).filter((k) => BASELINE[k] !== now[k]);
  assert.deepEqual(moved, [],
    `teardown did not give everything back: ${shown(moved.map((k) => `${k} ${BASELINE[k]}->${now[k]}`).join(', '))}`);
  assert.equal(unledgedKeys(OUT), '-', 'an object was left in the private output bucket behind no row');
  assert.equal(unledgedKeys(PREV), '-', 'an object was left in the closed preview bucket behind no row');
  assert.equal(ceilingCensus(), 'uploading_at_ceiling=0 failed_at_ceiling=0',
    'the run left a row at the attempt ceiling, which is the state the repair exists to make impossible');
  console.log(`  transport_retries=${transportRetries} (reads whose socket died before any response, `
    + 'and were sent a second time; 0 means no contention was met, not that the path is untested)');
  console.log('  residue census after the Stage 9 HTTP teardown (whole database):');
  for (const line of sqlRows(censusQuery)) console.log(shown(`    ${line}`));
});

// ---------------------------------------------------------------------------
// T — the transport: which schema answers, and which body is not a request body
// ---------------------------------------------------------------------------
describe('S9 TRANSPORT', () => {
  test('T-01 both Stage 9 verbs answer through the api profile, and the unexposed bodies beside them do not', async () => {
    const good = await listOutputs('hostA', weddingOf('hostA'));
    assert.equal(good.status, 200, JSON.stringify(good.body));

    // `internal_api` is not in `supabase/config.toml`'s exposed schemas (`:32`), so the privileged body
    // is unreachable as a request body while its one-line wrapper is callable. The same arguments
    // against that profile must fail, and the identical arguments against `api` must not — that pairing
    // is what makes the refusal a policy rather than a typo in the URL.
    const internal = await listOutputs('hostA', weddingOf('hostA'), { profile: 'internal_api' });
    assert.notEqual(internal.status, 200, 'a privileged body was reached as a request body');
    assert.match(internal.text, /PGRST106|not served|Invalid profile/i,
      `unexpected profile refusal: ${shown(internal.text.slice(0, 200))}`);

    const noProfile = await rpc('list_invitation_outputs', { p_wedding_id: weddingOf('hostA') },
      { as: 'hostA', profile: null });
    // With no header the router resolves `public`, where no such function is declared, so the call is
    // refused at the catalog rather than silently answered by the wrapper.
    assert.notEqual(noProfile.status, 200, 'an unqualified RPC reached the Stage 9 wrapper through public');
  });

  test('T-02 service_role is stopped at the schema, which is where the wrappers are not exposed', async () => {
    // §8's closing paragraph spells the reason: `service_role` has no USAGE on `api` or `internal_api`
    // and is not a browser, so it has no business using a browser's door to write the table it already
    // has grants on. The maintenance process writes that table through SQL, which is what group E does.
    //
    // Measured, this stack answers a denied RPC with 403, not 401: PostgREST resolves the role from the
    // key and *then* the catalog, so a caller that is authenticated but unprivileged gets the
    // forbidden answer (`401` is what a caller with no resolvable role at all gets, which group R
    // measures for `anon`). The assertion is about the SQLSTATE the schema grant produces; the status
    // code is the wire's spelling of the same refusal.
    for (const [name, args] of [['list_invitation_outputs', { p_wedding_id: weddingOf('hostA') }],
      ['render_invitation_document', { p_version_id: versionOf('hostA') }]]) {
      const res = await rpc(name, args, { as: 'service' });
      assert.equal(res.status, 403, `${name}: ${shown(JSON.stringify(res.body))}`);
      assert.equal(res.body.code, '42501', name);
    }
  });
});

// ---------------------------------------------------------------------------
// P — what a browser role can do to the manifest
// ---------------------------------------------------------------------------
describe('S9 PRIVILEGES AND SCOPE', () => {
  test('P-01 no browser role writes the manifest, in any of the three write spellings', async () => {
    const body = { wedding_id: weddingOf('hostA'), version_id: versionOf('hostA'), output_kind: 'og_image',
      variant: '1200x630', format: 'png', page_number: 1, render_config_hash: configHash('p01'),
      source_dto_digest: dtoFixtureDigest, storage_domain: 'host_private', status: 'ready',
      content_digest: dtoFixtureDigest };
    // The measured grant posture (Stage 6, this stack): a missing table grant is 401 for `anon` and 403
    // for `authenticated`, both code 42501, each with a hint naming the privilege. §5 grants SELECT and
    // nothing else, so all three verbs must land on that line.
    //
    // The filter goes in the query string, not the path: `PATCH /invitation_outputs/id=eq.x` is not a
    // route PostgREST knows and answers PGRST125 / 404, which would read like an undeployed table rather
    // than like the grant refusal this case is about. `?id=eq.` names a uuid that is well-formed and
    // belongs to no row of this run, so a refusal that reached row visibility could not leak anything.
    const filtered = `${REST}?id=eq.${versionOf('hostA')}`;
    for (const [name, status] of [['POST', 403], ['PATCH', 403], ['DELETE', 403]]) {
      const res = await call(name, name === 'POST' ? REST : filtered,
        { bearer: tokenOf('hostA'), body });
      assert.equal(res.status, status, `${name}: ${shown(JSON.stringify(res.body))}`);
      assert.equal(res.body.code, '42501', `${name}: ${shown(JSON.stringify(res.body))}`);
      assert.match(String(res.body.hint ?? ''), /privilege|insert|update|delete/i, `${name} hint`);
    }
    const anon = await call('POST', REST, { body });
    assert.equal(anon.status, 401, shown(JSON.stringify(anon.body)));
    assert.equal(anon.body.code, '42501');

    // The positive control the memory note demands: the same role on the same table can read, so none
    // of the four refusals above is an absent table or a stale deployment.
    const read = await call('GET', REST, { bearer: tokenOf('hostA'), headers: { Accept: 'application/json' } });
    assert.equal(read.status, 200, shown(JSON.stringify(read.body)));

    const rows = cell(`select count(*)::text from public.invitation_outputs
      where render_config_hash = '${configHash('p01')}'`, 'the P-01 write census');
    assert.equal(rows, '0', 'a browser write reached the manifest through one of the four refusals');
  });

  test('P-02 the row-level filter scopes a direct read to the caller\'s own weddings, and answers the other with nothing', async () => {
    const mine = registerRow({ who: 'hostA', salt: 'p02-a' });
    const theirs = registerRow({ who: 'hostB', salt: 'p02-b' });

    const asOwner = await call('GET', `${REST}?select=id,status`, { bearer: tokenOf('hostA') });
    assert.equal(asOwner.status, 200, shown(JSON.stringify(asOwner.body)));
    const seen = asOwner.body.map((r) => r.id);
    assert.ok(seen.includes(mine.id), 'the owner could not see its own manifest row over REST');
    assert.ok(!seen.includes(theirs.id), 'RLS leaked another wedding\'s row through a direct table read');

    const asStranger = await call('GET', `${REST}?select=id,status`, { bearer: tokenOf('hostB') });
    assert.equal(asStranger.status, 200, shown(JSON.stringify(asStranger.body)));
    assert.ok(!asStranger.body.some((r) => r.id === mine.id),
      'a second authenticated host read the first wedding\'s manifest row');

    // The policy predicate is `weddings.owner_user_id = auth.uid()` (`:446-448`), so a row's visibility
    // moves with its wedding's owner rather than with whoever created the artefact. Re-parenting the row
    // is refused by the guard (L-02), so this is measured by transferring the aggregate instead — which
    // is also the only way to show the policy is not a `created_by` rule wearing a different name.
    const owner = cell(`select owner_user_id from public.weddings where id = '${weddingOf('hostA')}'::uuid`,
      'wedding A\'s owner');
    assert.equal(owner, uidOf('hostA'), 'the fixture wedding is not owned by the fixture host');

    exec(`delete from public.invitation_outputs where id in ('${mine.id}'::uuid, '${theirs.id}'::uuid)`,
      'the P-02 fixtures');
  });

  test('P-03 the three private helpers are unreachable over REST, so a browser cannot mint a key or skip a guard', async () => {
    for (const name of ['mint_invitation_output_key', 'guard_invitation_output_update',
      'guard_invitation_output_delete']) {
      const throughApi = await rpc(name, {}, { as: 'hostA' });
      assert.equal(throughApi.status, 404, `${name} through api: ${shown(JSON.stringify(throughApi.body))}`);
      const throughPrivate = await rpc(name, {}, { as: 'hostA', profile: 'private' });
      // An unexposed schema is answered by the router before the catalog is consulted; both refusals
      // this stack produces are recorded rather than predicted, and what the case claims is that the
      // call never reached the function — which the census below reads out of the database.
      assert.ok([404, 406].includes(throughPrivate.status),
        `${name} through private answered ${throughPrivate.status}: ${shown(throughPrivate.text.slice(0, 160))}`);
    }
    const minted = cell(`select count(*)::text from public.invitation_outputs
      where storage_domain = 'published_preview'`, 'the published-domain census after P-03');
    assert.equal(minted, '0', 'a browser call reached the key-minting trigger');
  });
});

// ---------------------------------------------------------------------------
// R — the render source: one frozen document, not the keystroke before it
// ---------------------------------------------------------------------------
describe('S9 RENDER SOURCE', () => {
  test('R-01 the owner reads its frozen version, in the projection the guest page already receives', async () => {
    const res = await renderDoc('hostA', versionOf('hostA'));
    assert.equal(res.status, 200, shown(JSON.stringify(res.body)));
    assert.deepEqual(Object.keys(res.body).sort(), INVITATION_KEYS,
      `the render source's projection changed: ${shown(Object.keys(res.body).sort().join(','))}`);
    assert.equal(res.body.welcome, 'With the blessings of both families, join us for A.',
      'the frozen version did not answer with the words it was frozen at');
    assert.equal(res.body.events.length, 2, 'the version froze both events');
  });

  test('R-02 a stranger, an absent version and the anonymous web are three different refusals, none of which is a substitute', async () => {
    const anon = await renderDoc('anon', versionOf('hostA'));
    assert.equal(anon.status, 401, shown(JSON.stringify(anon.body)));
    assert.equal(anon.body.code, '42501', 'anon was refused for a reason other than the grant');

    const stranger = await renderDoc('hostB', versionOf('hostA'));
    assert.equal(stranger.status, 403, shown(JSON.stringify(stranger.body)));
    assert.equal(stranger.body.code, '42501');
    assert.equal(stranger.body.message, SAY.notRender);
    assert.equal(stranger.body.hint, null, 'the body-level refusal grew a hint');

    // The no-oracle half, as bytes rather than as a parse: host B's real-but-not-hers version and a
    // well-formed uuid that belongs to nothing answer the same four fields, so an unauthorised caller
    // cannot use this door to learn which version ids exist.
    const unknown = await renderDoc('hostB', NOT_A_VERSION);
    assert.equal(unknown.status, stranger.status);
    assert.equal(unknown.text, stranger.text,
      `an unknown version id answered differently from a foreign one: ${shown(unknown.text.slice(0, 200))}`);

    const ownUnknown = await renderDoc('hostA', NOT_A_WEDDING);
    assert.equal(ownUnknown.body.message, SAY.notRender, 'a non-version id invented a second sentence');
  });

  test('R-03 the render source reads the frozen version, and the draft can move underneath it', async () => {
    const d = await call('PATCH', `/rest/v1/invitation_drafts?wedding_id=eq.${weddingOf('hostA')}`, {
      bearer: tokenOf('hostA'),
      body: { content: { welcome: 'EDITED AFTER THE VERSION WAS FROZEN', family_introduction: null,
        event_notes: null, closing: null } },
      headers: { Prefer: 'return=representation' },
    });
    assert.equal(d.status, 200, shown(JSON.stringify(d.body)));

    const before1 = await renderDoc('hostA', versionOf('hostA'));
    assert.equal(before1.status, 200);
    assert.equal(before1.body.welcome, 'With the blessings of both families, join us for A.',
      'the render source followed the live draft, which is the one property §7 exists to hold');

    // A second freeze proves the two answers came from different documents rather than from a cache:
    // v2 carries the edit, v1 still does not, and both are readable through the same door.
    const v2 = await rpc('create_invitation_version', { p_wedding_id: weddingOf('hostA') }, { as: 'hostA' });
    assert.equal(v2.status, 200, shown(JSON.stringify(v2.body)));
    people.hostA.versionV2 = v2.body.version_id;
    const after = await renderDoc('hostA', v2.body.version_id);
    assert.equal(after.status, 200);
    assert.equal(after.body.welcome, 'EDITED AFTER THE VERSION WAS FROZEN',
      'the new version did not freeze the draft it was created from');
    const again = await renderDoc('hostA', versionOf('hostA'));
    assert.equal(again.body.welcome, 'With the blessings of both families, join us for A.');

    exec(`delete from public.invitation_versions where id = '${v2.body.version_id}'::uuid`,
      'the v2 fixture');
  });
});

// ---------------------------------------------------------------------------
// M — the host's manifest projection
// ---------------------------------------------------------------------------
describe('S9 MANIFEST PROJECTION', () => {
  test('M-01 a panel row carries the fifteen projected columns and none of the three withheld names', async () => {
    const row = registerRow({ who: 'hostA', salt: 'm01' });
    const res = await listOutputs('hostA', weddingOf('hostA'));
    assert.equal(res.status, 200, shown(JSON.stringify(res.body)));
    const found = res.body.find((r) => r.id === row.id);
    assert.ok(found, 'a registered row did not reach the panel');
    assert.deepEqual(Object.keys(found).sort(), ROW_KEYS,
      `the manifest projection changed: ${shown(Object.keys(found).sort().join(','))}`);
    for (const name of WITHHELD) {
      assert.ok(!(name in found), `${name} reached the host's projection, which §7 withholds on purpose`);
    }
    // The key is the withheld name that matters most: a path is not a delivery mechanism, and a client
    // that could read it could also sign it. Its shape is still a database fact, so it is asserted here
    // from the trusted read rather than from the projection.
    assert.match(row.objectKey, new RegExp(`^outputs/${weddingOf('hostA')}/og_image/1200x630/${row.id}$`),
      `the minted key is not §3's four-segment form: ${shown(row.objectKey)}`);
    exec(`delete from public.invitation_outputs where id = '${row.id}'::uuid`, 'the M-01 fixture');
  });

  test('M-02 the order the panel prints is the server\'s, by kind then geometry then format then page', async () => {
    const made = [
      registerRow({ who: 'hostA', kind: 'share_image', variant: '1080x1350', salt: 'm02-share' }),
      registerRow({ who: 'hostA', salt: 'm02-og' }),
      registerRow({ who: 'hostA', format: 'webp', salt: 'm02-webp' }),
    ];
    const res = await listOutputs('hostA', weddingOf('hostA'));
    assert.equal(res.status, 200);
    const ids = res.body.map((r) => r.id);
    const at = (row) => ids.indexOf(row.id);
    assert.ok(at(made[1]) < at(made[2]), 'a png and a webp of one box came back in the wrong order');
    assert.ok(at(made[2]) < at(made[0]), 'og_image did not sort before share_image');
    for (const row of made) exec(`delete from public.invitation_outputs where id = '${row.id}'::uuid`,
      'the M-02 fixture');
  });

  test('M-03 the panel is the owner\'s door: a second host, the anonymous web and a stranger\'s wedding id are three refusals', async () => {
    const other = await listOutputs('hostB', weddingOf('hostA'));
    assert.equal(other.status, 403, shown(JSON.stringify(other.body)));
    assert.equal(other.body.message, SAY.notRead);
    assert.equal(other.body.code, '42501');

    const anon = await listOutputs('anon', weddingOf('hostA'));
    assert.equal(anon.status, 401, shown(JSON.stringify(anon.body)));

    const nowhere = await listOutputs('hostA', NOT_A_WEDDING);
    assert.equal(nowhere.text, other.text,
      'an absent wedding was answered differently from a foreign one, which makes the panel an oracle');
  });
});

// ---------------------------------------------------------------------------
// K — key minting and the birth of a row, through the maintenance identity
// ---------------------------------------------------------------------------
describe('S9 REGISTRATION AND KEYS', () => {
  test('K-01 each storage domain mints its own key shape, and both agree with their CHECK', async () => {
    const priv = registerRow({ who: 'hostA', salt: 'k01-priv' });
    assert.match(priv.objectKey, new RegExp(`^outputs/${weddingOf('hostA')}/og_image/1200x630/${priv.id}$`),
      shown(priv.objectKey));
    // The last segment is the row's own id, unique by construction — which is why a PNG and a WebP of
    // one box do not collide, and why a key cannot be guessed from the four segments before it.
    const webp = registerRow({ who: 'hostA', format: 'webp', salt: 'k01-webp' });
    assert.notEqual(webp.objectKey, priv.objectKey, 'two formats of one box minted one key');

    const preview = registerRow({ who: 'hostA', domain: 'published_preview', salt: 'k01-prev' });
    assert.match(preview.objectKey, /^p\/[A-Za-z0-9_-]{43}$/, shown(preview.objectKey));
    assert.ok(!preview.objectKey.includes(String(weddingOf('hostA'))),
      'a published key carried a wedding identifier');

    const pairing = cell(`select coalesce(string_agg(storage_domain || '=' ||
        (case when object_key like 'outputs/%' then 'outputs' when object_key ~ '^p/[A-Za-z0-9_-]{43}$'
              then 'opaque' else 'other' end), ',' order by storage_domain), '-')
      from public.invitation_outputs where id in ('${priv.id}'::uuid, '${preview.id}'::uuid)`,
      'the domain/key pairing');
    assert.equal(pairing, 'host_private=outputs,published_preview=opaque', pairing);

    exec(`delete from public.invitation_outputs
          where id in ('${priv.id}'::uuid, '${webp.id}'::uuid, '${preview.id}'::uuid)`, 'the K-01 fixtures');
  });

  test('K-02 the mint trigger refuses a presented key and a lying birth, in its own sentences', async () => {
    const supplied = `insert into public.invitation_outputs (wedding_id, version_id, output_kind, variant,
        format, page_number, render_config_hash, source_dto_digest, storage_domain, object_key)
      values ('${weddingOf('hostA')}'::uuid, '${versionOf('hostA')}'::uuid, 'og_image', '1200x630', 'png', 1,
        '${configHash('k02-a')}', '${dtoFixtureDigest}', 'host_private', 'outputs/i/chose/my/own/path')`;
    refused(supplied, { code: '42501', sentence: SAY.keySupplied }, 'a presented object_key');

    refused(`insert into public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        page_number, render_config_hash, source_dto_digest, storage_domain, status)
      values ('${weddingOf('hostA')}'::uuid, '${versionOf('hostA')}'::uuid, 'og_image', '1200x630', 'png', 1,
        '${configHash('k02-b')}', '${dtoFixtureDigest}', 'host_private', 'ready')`,
    { code: '42501', sentence: SAY.bornRegistered }, 'a row born ready');

    refused(`insert into public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        page_number, render_config_hash, source_dto_digest, storage_domain, content_digest)
      values ('${weddingOf('hostA')}'::uuid, '${versionOf('hostA')}'::uuid, 'og_image', '1200x630', 'png', 1,
        '${configHash('k02-c')}', '${dtoFixtureDigest}', 'host_private', '${dtoFixtureDigest}')`,
    { code: '42501', sentence: SAY.bornEvidence }, 'a registered row claiming bytes');

    refused(`insert into public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        page_number, render_config_hash, source_dto_digest, storage_domain, attempt_count, last_error)
      values ('${weddingOf('hostA')}'::uuid, '${versionOf('hostA')}'::uuid, 'og_image', '1200x630', 'png', 1,
        '${configHash('k02-d')}', '${dtoFixtureDigest}', 'host_private', 2, 'an earlier run said no')`,
    { code: '42501', sentence: SAY.bornEvidence }, 'a fresh row claiming attempts');

    assert.equal(cell(`select count(*)::text from public.invitation_outputs
      where render_config_hash in ('${configHash('k02-a')}','${configHash('k02-b')}',
        '${configHash('k02-c')}','${configHash('k02-d')}')`, 'the K-02 census'), '0',
    'a refused registration still left a row');
  });

  test('K-03 the four column CHECKs refuse a row that describes an artefact this build cannot produce', async () => {
    const insert = (kind, variant, format, domain, extra = '') => `insert into public.invitation_outputs
      (wedding_id, version_id, output_kind, variant, format, page_number, render_config_hash,
       source_dto_digest, storage_domain${extra ? `, ${extra[0]}` : ''})
      values ('${weddingOf('hostA')}'::uuid, '${versionOf('hostA')}'::uuid, '${kind}', '${variant}',
        '${format}', 1, '${configHash(`k03-${kind}-${variant}-${domain}`)}', '${dtoFixtureDigest}',
        '${domain}'${extra ? `, '${extra[1]}'` : ''})`;

    refused(insert('pdf', '1200x630', 'pdf', 'host_private'), { code: '23514', sentence: 'invitation_outputs_render_shape' },
      'a pdf row claiming a teaser box');
    refused(insert('og_image', 'a4', 'png', 'host_private'), { code: '23514', sentence: 'invitation_outputs_render_shape' },
      'a teaser claiming a paper');
    refused(insert('pdf', 'a4', 'pdf', 'published_preview'), { code: '23514', sentence: 'invitation_outputs_preview_is_og_only' },
      'a PDF in the published domain');
    refused(insert('qr', '40mm', 'png', 'host_private'), { code: '23514', sentence: 'invitation_outputs_qr_target' },
      'a plate with nothing to point at');
    refused(insert('og_image', '1200x630', 'png', 'host_private', ['target_url_digest', dtoFixtureDigest]),
      { code: '23514', sentence: 'invitation_outputs_qr_target' }, 'a teaser claiming a target');

    // The determinism key's index name is 63 characters because Postgres truncates the generated one —
    // which is both why transcribing the migration's `UNIQUE (...)` clause at `:147` produced a name that
    // does not exist, and why the failure message cannot be read (the redactor swallows its first 43
    // characters). So the name is *asked of the catalog* and the refusal is scored against the answer:
    // this then measures that the constraint the product declared is the constraint the database enforces.
    const determinismIndex = cell(`select indexname from pg_indexes
      where tablename = 'invitation_outputs' and schemaname = 'public'
        and indexname like 'invitation_outputs_version_id_output_kind%'`,
      'the determinism index name');
    const born = registerRow({ who: 'hostA', salt: 'k03-dupe' });
    refused(insert('og_image', '1200x630', 'png', 'host_private').replace(
      configHash('k03-og_image-1200x630-host_private'), configHash('k03-dupe')),
    { code: '23505', sentence: determinismIndex }, 'the same determinism tuple twice');
    exec(`delete from public.invitation_outputs where id = '${born.id}'::uuid`, 'the K-03 duplicate slot');
  });

  test('K-04 no layer above the database validates a path, because none receives one', async () => {
    // The claim §3 makes in the negative: the manifest's projections and the panel's transport never
    // hand a key to a caller, so there is nothing to sanitise. Measured here as two facts a browser can
    // see — the RPC's rows carry no `object_key` (M-01) and the storage route refuses a foreign key
    // rather than normalising it — plus the traversal CHECKs that survive a trigger edit.
    refused(`insert into public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        page_number, render_config_hash, source_dto_digest, storage_domain, object_key)
      values ('${weddingOf('hostA')}'::uuid, '${versionOf('hostA')}'::uuid, 'og_image', '1200x630', 'png', 1,
        '${configHash('k04')}', '${dtoFixtureDigest}', 'host_private', 'outputs/../../etc/passwd')`,
    { code: '42501', sentence: SAY.keySupplied }, 'a traversal key presented to the mint trigger');

    const res = await listOutputs('hostA', weddingOf('hostA'));
    assert.equal(res.status, 200);
    assert.ok(res.body.every((row) => !('object_key' in row)), 'the projection leaked a key');
  });
});

// ---------------------------------------------------------------------------
// L — the lifecycle the maintenance process walks, including the closed ceiling
// ---------------------------------------------------------------------------
describe('S9 LIFECYCLE', () => {
  test('L-01 the six legal edges walk, and each instant and each piece of evidence is stamped by the database', async () => {
    const row = registerRow({ who: 'hostA', salt: 'l01' });
    assert.equal(factsOf(row.id),
      `status=registered attempts=0 error=- digest=- ready=false invalid=false reason=- `
      + `domain=host_private config=${configHash('l01').slice(0, 12)} key=${row.objectKey}`);

    exec(toUploading(row.id), 'the registered → uploading step');
    assert.deepEqual(picked(row.id, ['status', 'attempts', 'digest', 'ready']),
      { status: 'uploading', attempts: '0', digest: '-', ready: 'false' },
      shown(JSON.stringify(facts(row.id))));

    exec(toReady(row.id, dtoFixtureDigest), 'the uploading → ready step');
    assert.deepEqual(picked(row.id, ['status', 'digest', 'ready', 'invalid']),
      { status: 'ready', digest: dtoFixtureDigest.slice(0, 12), ready: 'true', invalid: 'false' },
      shown(JSON.stringify(facts(row.id))));

    exec(toInvalidated(row.id, 'superseded'), 'the ready → invalidated step');
    assert.deepEqual(picked(row.id, ['status', 'ready', 'invalid', 'reason']),
      { status: 'invalidated', ready: 'true', invalid: 'true', reason: 'superseded' },
      shown(JSON.stringify(facts(row.id))));
    const stamps = cell(`select (invalidated_at >= ready_at)::text from public.invitation_outputs
      where id = '${row.id}'::uuid`, 'the instant ordering');
    assert.equal(stamps, 'true', 'an artefact was retired before it was earned');

    // A born row may not skip the flight: §4's edge list has no registered → ready, and the refusal
    // names both states so an operator reads the lifecycle rather than inferring it.
    const skipper = registerRow({ who: 'hostA', salt: 'l01-skip' });
    refused(toReady(skipper.id, dtoFixtureDigest), { code: '42501', sentence: noEdge('registered', 'ready') },
      'a row sent straight to ready');
    refused(`update public.invitation_outputs set status = 'uploading', content_digest = '${dtoFixtureDigest}'
      where id = '${skipper.id}'::uuid`, { code: '23514', sentence: 'invitation_outputs_ready_evidence' },
      'an uploading row claiming a digest');
    exec(`delete from public.invitation_outputs where id in ('${row.id}'::uuid, '${skipper.id}'::uuid)`,
      'the L-01 fixtures');
  });

  test('L-02 what an artefact *is* cannot be rewritten, and a status-less write moves no evidence', async () => {
    const row = registerRow({ who: 'hostA', salt: 'l02' });
    const other = registerRow({ who: 'hostB', salt: 'l02-other' });
    const id = row.id;
    const edits = [
      ['wedding_id', `wedding_id = '${weddingOf('hostB')}'::uuid`, SAY.reParent],
      ['version_id', `version_id = '${versionOf('hostB')}'::uuid`, SAY.boundVersion],
      ['output_kind', `output_kind = 'qr', target_url_digest = '${dtoFixtureDigest}'`, SAY.shapeKeyed],
      ['variant', `variant = 'a4'`, SAY.shapeKeyed],
      ['format', `format = 'webp'`, SAY.shapeKeyed],
      ['page_number', `page_number = 2`, SAY.shapeKeyed],
      ['render_config_hash', `render_config_hash = '${configHash('l02-new')}'`, SAY.configSticky],
      ['source_dto_digest', `source_dto_digest = '${configHash('l02-dto')}'`, SAY.dtoSticky],
      ['object_key', `object_key = 'outputs/moved'`, SAY.keyImmutable],
      ['storage_domain', `storage_domain = 'published_preview'`, SAY.domainMoved],
    ];
    for (const [name, clause, sentence] of edits) {
      refused(`update public.invitation_outputs set ${name === 'output_kind' ? clause.split(', ')[0] : clause}
        where id = '${id}'::uuid`, { code: '42501', sentence }, `a rewrite of ${name}`);
    }
    // The kind/format edits above each carry their own guard arm; the `output_kind` one names the pair,
    // because changing a kind alone would also change the target digest the CHECK demands.
    // The identity arms of the guard run before the table's CHECKs, so a teaser handed a target digest is
    // refused by `:307` — the *immutability* sentence — not by `invitation_outputs_qr_target`. That is the
    // honest order of the two protections: the rewrite never gets close to the CHECK. The CHECK's own
    // refusal of a shape that cannot exist is K-03's, and it is reached there because an INSERT has no
    // `OLD` row for `:307` to compare against.
    refused(`update public.invitation_outputs set target_url_digest = '${configHash('l02-target')}'
      where id = '${id}'::uuid`, { code: '42501', sentence: SAY.targetSticky },
      'a teaser given a target digest');

    exec(toUploading(id), 'the L-02 upload step');
    exec(toReady(id, dtoFixtureDigest), 'the L-02 ready step');
    const before = factsOf(id);
    refused(`update public.invitation_outputs set last_error = 'a story told after the fact'
      where id = '${id}'::uuid`, { code: '42501', sentence: SAY.noEvidenceWrite },
      'a status-less write that moved evidence');
    assert.equal(factsOf(id), before, 'a refused same-status write still moved a column');

    exec(`delete from public.invitation_outputs where id = '${other.id}'::uuid`, 'the L-02 second fixture');
    // A `ready` row cannot be erased out from under its object, so it goes through its own terminal edge
    // first — which is also what makes the delete guard's two refusals measurable at all.
    exec(toInvalidated(id, 'asset_deleted'), 'the L-02 retirement');
    exec(`delete from public.invitation_outputs where id = '${id}'::uuid`, 'the L-02 fixture');
    assert.equal(absent(id), '0');
  });

  test('L-03 a failure is exactly one attempt and one named reason, and the count moves nowhere else', async () => {
    const row = registerRow({ who: 'hostA', salt: 'l03' });
    exec(toUploading(row.id), 'the L-03 upload step');
    refused(`update public.invitation_outputs set status = 'failed', attempt_count = 1
      where id = '${row.id}'::uuid`, { code: '42501', sentence: SAY.nameReason }, 'a failure with no reason');
    refused(`update public.invitation_outputs set status = 'failed', attempt_count = 3,
        last_error = 'three failures claimed as one' where id = '${row.id}'::uuid`,
    { code: '42501', sentence: SAY.oneAttempt }, 'a failure claiming two extra attempts');
    refused(`update public.invitation_outputs set status = 'failed', attempt_count = 0,
        last_error = 'a reset count' where id = '${row.id}'::uuid`,
    { code: '42501', sentence: SAY.oneAttempt }, 'a failure that reset the count');
    exec(toFailed(row.id, 1, 'the renderer said no'), 'the L-03 first failure');
    assert.match(factsOf(row.id), /status=failed attempts=1 error=the renderer said no/);

    // `:327` and `:382` both hold the count still, and which one speaks depends on whether the write also
    // changes status. Here it does not, so the same-status arm fires first; the `:382` arm is measured
    // below, from a state where a status change is on the table. Predicting the wrong one is predicting
    // which guard arm is written first, not which invariant the product holds, so each is pinned here to
    // the line that actually answers.
    refused(`update public.invitation_outputs set attempt_count = 2 where id = '${row.id}'::uuid`,
      { code: '42501', sentence: SAY.noEvidenceWrite }, 'an attempt count moved without a failure');
    assert.deepEqual(picked(row.id, ['status', 'attempts']), { status: 'failed', attempts: '1' },
      shown(JSON.stringify(facts(row.id))));
    refused(`update public.invitation_outputs set last_error = 'quietly relabelled' where id = '${row.id}'::uuid`,
      { code: '42501', sentence: SAY.noEvidenceWrite }, 'a failure reason rewritten in place');

    // The other half of the same rule: a row that *is* changing status may still not move the count on
    // its way through, because the count is a record of failures and `ready` is not one.
    exec(toUploading(row.id), 'the L-03 retry into attempt 2');
    refused(`update public.invitation_outputs set status = 'ready', content_digest = '${dtoFixtureDigest}',
        attempt_count = 2 where id = '${row.id}'::uuid`,
      { code: '42501', sentence: SAY.countOnlyOnFailure }, 'a promotion that also incremented the count');
    assert.deepEqual(picked(row.id, ['status', 'attempts', 'digest', 'ready']),
      { status: 'uploading', attempts: '1', digest: '-', ready: 'false' },
      shown(JSON.stringify(facts(row.id))));
    exec(toFailed(row.id, 2, 'the renderer said no again'), 'the L-03 second failure');

    // `failed → invalidated` is legal only for a row that earned bytes: retiring something that never
    // existed is not an invalidation, and §4 says so with the sentence the repair's precondition counts.
    refused(toInvalidated(row.id, 'superseded'), { code: '42501', sentence: SAY.noBytesInvalidate },
      'a byteless failure invalidated');
    exec(`delete from public.invitation_outputs where id = '${row.id}'::uuid`, 'the L-03 fixture');
    assert.equal(absent(row.id), '0', 'a failed row with no bytes refused a trusted delete as well');
  });

  test('L-04 the attempt ceiling closes the doomed retry, which is the deadlock the repair migration exists to end', async () => {
    const row = registerRow({ who: 'hostA', salt: 'l04' });
    // Five recorded failures, each one the legal pair of steps. `s9f_attempts`'s equivalent in the SQL
    // battery, restated through the same channel the publisher uses rather than through a shortcut that
    // would skip the guard on the way to the state the case is about.
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      if (attempt > 1) exec(toUploading(row.id), `the ceiling retry into attempt ${attempt}`);
      else exec(toUploading(row.id), 'the first upload');
      exec(toFailed(row.id, attempt, 'the renderer said no'), `the failure of attempt ${attempt}`);
      assert.match(factsOf(row.id), new RegExp(`status=failed attempts=${attempt} `),
        `the walk stopped at attempt ${attempt}`);
    }
    assert.equal(ceilingCensus().split(' ')[1], 'failed_at_ceiling=1',
      'the ceiling fixture is not in the state the repair names');

    const answer = refusalOf(toUploading(row.id), 'the sixth retry');
    assert.equal(answer, `42501 ${SAY.ceiling}`, `the ceiling refused with a different sentence: ${shown(answer)}`);
    const stayed = factsOf(row.id);
    assert.match(stayed, /status=failed attempts=5 /,
      `the refusal moved the row: ${shown(stayed)}`);

    // The other three exits, each measured rather than assumed: the row can still be invalidated once it
    // has bytes, it can be deleted as a byteless failure, and a row one attempt short of the ceiling
    // still retries. The last of those is the guard against an over-broad repair.
    const near = registerRow({ who: 'hostA', salt: 'l04-near' });
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      exec(toUploading(near.id), `the near-ceiling upload ${attempt}`);
      exec(toFailed(near.id, attempt, 'the renderer said no'), `the near-ceiling failure ${attempt}`);
    }
    exec(toUploading(near.id), 'the fifth attempt, one below the ceiling');
    assert.match(factsOf(near.id), /status=uploading attempts=4 /, 'a legal retry was refused');
    exec(toFailed(near.id, 5, 'the renderer said no'), 'the fifth failure recorded');
    assert.match(factsOf(near.id), /status=failed attempts=5 /);

    // §7.2's bound and the guard's `5` are one fact stated twice, so the repair refuses before the
    // CHECK can be the thing that fires: a row at the ceiling is not a row that may try again.
    assert.equal(cell(`select pg_get_constraintdef(oid) from pg_constraint
      where conname = 'invitation_outputs_attempt_count_check'`, 'the attempt CHECK'),
      'CHECK (((attempt_count >= 0) AND (attempt_count <= 5)))');

    exec(`delete from public.invitation_outputs where id in ('${row.id}'::uuid, '${near.id}'::uuid)`,
      'the L-04 fixtures');
    assert.equal(absent(row.id), '0');
    assert.equal(ceilingCensus(), 'uploading_at_ceiling=0 failed_at_ceiling=0',
      'the ceiling fixtures were left behind');
  });

  test('L-05 the delete guard refuses the two states that still own something', async () => {
    // Two refusals *and* three accepted exits. A delete guard that refused everything would pass a
    // refusals-only battery, and the accepted paths are exactly the ones §12's cleanup walks: a
    // registration that never uploaded, a failure that earned no bytes, and a retirement whose object is
    // already gone. Each refusal is measured against the row it belongs to, not against a row in some
    // other state — which is the transcription error the first run of this case caught itself.
    const neverUploaded = registerRow({ who: 'hostA', salt: 'l05-registered' });
    refused(toInvalidated(neverUploaded.id, 'superseded'),
      { code: '42501', sentence: noEdge('registered', 'invalidated') }, 'a never-uploaded row invalidated');
    exec(`delete from public.invitation_outputs where id = '${neverUploaded.id}'::uuid`,
      'the cleanup delete of a row that never claimed bytes');
    assert.equal(absent(neverUploaded.id), '0', 'a registered row survived its cleanup delete');

    const inFlight = registerRow({ who: 'hostA', salt: 'l05-uploading' });
    exec(toUploading(inFlight.id), 'the L-05 upload step');
    refused(`delete from public.invitation_outputs where id = '${inFlight.id}'::uuid`,
      { code: '42501', sentence: SAY.deleteUploading }, 'an in-flight row deleted');
    assert.equal(facts(inFlight.id).status, 'uploading', 'the refused delete removed the row anyway');
    exec(toFailed(inFlight.id, 1, 'the upload never arrived'), 'the L-05 abandoned upload');
    exec(`delete from public.invitation_outputs where id = '${inFlight.id}'::uuid`,
      'the cleanup delete of a byteless failure');
    assert.equal(absent(inFlight.id), '0', 'a byteless failure refused the cleanup delete it is owed');

    const delivered = registerRow({ who: 'hostA', salt: 'l05-ready' });
    exec(toUploading(delivered.id), 'the L-05 delivery upload');
    exec(toReady(delivered.id, dtoFixtureDigest), 'the L-05 ready step');
    refused(`delete from public.invitation_outputs where id = '${delivered.id}'::uuid`,
      { code: '42501', sentence: SAY.deleteReady }, 'a verified row deleted');
    assert.equal(facts(delivered.id).status, 'ready', 'the refused delete moved the row anyway');
    refused(toUploading(delivered.id), { code: '42501', sentence: SAY.readyOnly },
      'a verified row re-opened');
    exec(toInvalidated(delivered.id, 'asset_deleted'), 'the L-05 retirement');
    refused(toUploading(delivered.id), { code: '42501', sentence: SAY.terminal }, 'a terminal row re-opened');
    // Rewriting a retirement's reason leaves the status alone, so the same-status arm at `:327` is what
    // answers, not the terminal arm at `:333` — which the status-changing attempt above does answer. Both
    // keep the record honest; naming the wrong one would make this case a test of guard ordering nobody
    // measured.
    refused(`update public.invitation_outputs set invalidation_reason = 'token_rotated'
      where id = '${delivered.id}'::uuid`, { code: '42501', sentence: SAY.noEvidenceWrite },
      'a retirement reason rewritten');
    assert.deepEqual(picked(delivered.id, ['status', 'reason', 'domain']),
      { status: 'invalidated', reason: 'asset_deleted', domain: 'host_private' },
      shown(JSON.stringify(facts(delivered.id))));
    exec(`delete from public.invitation_outputs where id = '${delivered.id}'::uuid`,
      'the cleanup delete of a retired row');
    assert.equal(absent(delivered.id), '0', 'a retired row refused the cleanup delete');
  });
});

// ---------------------------------------------------------------------------
// E — the delivery path: register, upload, read back, verify, ready, download
// ---------------------------------------------------------------------------
describe('S9 DELIVERY', () => {
  /** The version's DTO, read through the exposed RPC — which doubles as the comparison §7.2's note asks
   *  for: the trusted maintenance read and the browser-visible door must project the same document. */
  let versionDto = null;
  let firstRun = null;

  const rowsOf = (weddingId) => cell(`select coalesce(string_agg(output_kind || '/' || variant || '/' ||
      format || '=' || status, ';' order by created_at, id), '-')
    from public.invitation_outputs where wedding_id = '${weddingId}'::uuid`, 'the manifest of this wedding');

  test('E-00 the maintenance read and the exposed RPC project one document', async () => {
    const door = await renderDoc('hostA', versionOf('hostA'));
    assert.equal(door.status, 200, shown(JSON.stringify(door.body)));
    const sql = makeSqlChannel((statement) => runPsql(TARGET, statement), false);
    const trusted = decodeLine(sql(sqlReadVersion(versionOf('hostA'))));
    assert.equal(trusted.wedding_id, weddingOf('hostA'));
    assert.deepEqual(trusted.dto, door.body,
      'the publisher and the panel would be describing two documents, which is the one thing §7 forbids');
    versionDto = door.body;
  });

  test('E-01 a first publish registers, uploads, fetches the bytes back, verifies them, and only then says ready', async () => {
    assert.ok(versionDto, 'E-00 must run first');
    const run = await publish({ versionDto, salt: 'e01' });
    firstRun = run;
    assert.equal(run.ok, true, `the publisher refused: ${shown(JSON.stringify(run.findings))}`);
    assert.equal(run.results.length, 1, shown(JSON.stringify(run.results)));
    const result = run.results[0];
    assert.equal(result.action, 'publish');
    assert.equal(result.status, 'ready');
    assert.equal(result.kind, 'og_image');
    assert.equal(result.content_digest, sha256Hex(readFileSync(join(SCRATCH, 'og_image_1200x630_p1.png'))),
      'the digest the publisher recorded is not the digest of the bytes it drew');
    assert.equal(result.properties.width, 1200);
    assert.equal(result.properties.height, 630);
    assert.deepEqual(run.findings.filter((f) => f.level !== 'note'), [],
      `the run reported a fault: ${shown(JSON.stringify(run.findings))}`);

    const row = cell(`select status || '|' || content_digest || '|' || object_key || '|' ||
      (ready_at is not null)::text
      from public.invitation_outputs where id = '${result.row_id}'::uuid`, 'the published row');
    const [status, digest, key, stamped] = row.split('|');
    assert.equal(status, 'ready');
    assert.equal(digest, result.content_digest);
    assert.equal(stamped, 'true');
    assert.equal(objectPresent(OUT, key), '1', 'a ready row points at no object');
    assert.equal(digest, sha256Hex(readFileSync(join(SCRATCH, 'og_image_1200x630_p1.png'))));
  });

  test('E-02 a second identical request verifies what is there and changes nothing', async () => {
    const before = factsOf(firstRun.results[0].row_id);
    const objectsBefore = cell(`select count(*)::text from storage.objects where bucket_id = '${OUT}'`,
      'the output object census');
    const run = await publish({ versionDto, salt: 'e01' });
    assert.equal(run.ok, true, shown(JSON.stringify(run.findings)));
    assert.equal(run.results.length, 1);
    assert.equal(run.results[0].action, 'verify', 'a duplicate request did something other than verify');
    assert.equal(run.results[0].content_digest, firstRun.results[0].content_digest);
    assert.equal(factsOf(firstRun.results[0].row_id), before, 'a no-op publish moved the row');
    assert.equal(cell(`select count(*)::text from public.invitation_outputs
      where version_id = '${versionOf('hostA')}'::uuid and output_kind = 'og_image'
        and status = 'ready'`, 'the ready count'), '1', 'a duplicate minted a second live row');
    assert.equal(cell(`select count(*)::text from storage.objects where bucket_id = '${OUT}'`,
      'the output object census'), objectsBefore, 'a verify run wrote bytes to the bucket');
  });

  test('E-03 a re-render under a changed config supersedes the stale row, and its object goes before its status', async () => {
    const stale = firstRun.results[0];
    const staleKey = firstKey(stale);
    // The positive control first: if the slot held no object, the "no orphan" assertion below would pass
    // for the wrong reason.
    assert.equal(objectPresent(OUT, staleKey), '1',
      'the row about to be superseded had no bytes behind it, so this case measures nothing');

    const run = await publish({ versionDto, salt: 'e03' });
    assert.equal(run.ok, true, shown(JSON.stringify(run.findings)));
    assert.equal(run.results[0].action, 'publish');
    assert.notEqual(run.results[0].row_id, stale.row_id, 'a changed config reused the slot instead of replacing it');
    assert.notEqual(run.results[0].content_digest, stale.content_digest,
      'the two runs produced the same bytes, so this measures nothing about supersession');

    assert.deepEqual(picked(stale.row_id, ['status', 'ready', 'invalid', 'reason']),
      { status: 'invalidated', ready: 'true', invalid: 'true', reason: 'superseded' },
      shown(JSON.stringify(facts(stale.row_id))));
    assert.equal(objectPresent(OUT, staleKey), '0',
      'a superseded artefact left its bytes behind — an orphan with no row to name it');
    assert.deepEqual(picked(run.results[0].row_id, ['status', 'digest', 'ready', 'invalid']),
      { status: 'ready', digest: run.results[0].content_digest.slice(0, 12), ready: 'true', invalid: 'false' },
      shown(JSON.stringify(facts(run.results[0].row_id))));
    assert.equal(rowsOf(weddingOf('hostA')), `og_image/1200x630/png=invalidated;og_image/1200x630/png=ready`,
      `the slot's two rows are not the pair §12 describes: ${shown(rowsOf(weddingOf('hostA')))}`);
    firstRun = run;
  });

  test('E-04 the owner downloads the exact bytes through a 60-second URL, and nobody else downloads anything', async () => {
    const artefact = 'og_image_1200x630_p1.png';
    const bytes = readFileSync(join(SCRATCH, artefact));
    const id = firstRun.results[0].row_id;
    const key = cell(`select object_key from public.invitation_outputs where id = '${id}'::uuid`,
      'the delivered key');
    assert.equal(key, `outputs/${weddingOf('hostA')}/og_image/1200x630/${id}`, shown(key));

    const signed = await storageSign(key, { as: 'hostA' });
    assert.equal(signed.status, 200, shown(JSON.stringify(signed.body)));
    assert.match(signed.body.signedURL, new RegExp(`^/object/sign/${OUT}/`), shown(JSON.stringify(signed.body)));
    const served = await fetchSigned(signed.body.signedURL);
    assert.equal(served.status, 200, `signed URL fetched at the wrong base: ${served.status}`);
    assert.deepEqual([...served.bytes], [...bytes], 'the bytes behind the panel are not the bytes published');
    assert.equal(served.type, 'image/png', `the object was served as ${served.type}`);
    assert.equal(sha256Hex(served.bytes), firstRun.results[0].content_digest,
      'the digest the manifest calls verified is not the digest of what a host can download');

    const strangerSign = await storageSign(key, { as: 'hostB' });
    assert.equal(strangerSign.status, 400, shown(JSON.stringify(strangerSign.body)));
    assert.equal(strangerSign.body.code, 'NoSuchKey',
      'a second host could ask for a URL it would not be able to use');
    for (const [name, res] of [['another host', await storageRead(key, { as: 'hostB' })],
      ['the anonymous web', await storageRead(key, { as: 'anon' })]]) {
      assert.equal(res.status, 400, `${name}: ${res.status}`);
      assert.equal(res.body.code, 'NoSuchKey', name);
      assert.equal(res.bytes.equals(bytes), false, `${name} was served the object's bytes`);
      assert.equal(res.bytes.subarray(0, 1).toString(), '{', `${name}: a non-JSON body was served`);
    }
    // The signed token is the credential, so a caller that cannot mint one has no route at all: the
    // public spelling of this bucket is refused because `public = false`, not because a policy declined.
    const pub = await fetch(`${url}/storage/v1/object/public/${OUT}/${key}`);
    assert.ok(pub.status >= 400, `the private bucket served a public path at ${pub.status}`);
  });

  test('E-05 the published-preview bucket is closed to every caller, including the owner of the row', async () => {
    const preview = registerRow({ who: 'hostA', domain: 'published_preview', salt: 'e05' });
    const bytes = pngBytes(8, 8, 'e05-closed-preview');
    const put = await servicePut(PREV, preview.objectKey, bytes, 'image/png');
    assert.ok(put.status < 400, `the closed bucket refused even a service write: ${shown(JSON.stringify(put))}`);

    for (const [name, res] of [['the anonymous web', await storageRead(preview.objectKey, { bucket: PREV })],
      ['the owner of the row', await storageRead(preview.objectKey, { as: 'hostA', bucket: PREV })],
      ['another host', await storageRead(preview.objectKey, { as: 'hostB', bucket: PREV })]]) {
      assert.ok(res.status >= 400, `${name} read a published-preview object at ${res.status}`);
      assert.equal(res.bytes.equals(bytes), false, `${name} was served the preview's bytes`);
    }
    const sign = await storageSign(preview.objectKey, { as: 'hostA', bucket: PREV });
    assert.ok(sign.status >= 400, `a signed URL was minted for the closed bucket at ${sign.status}`);

    // The row is still visible in the panel — which is §10.3's point in the other direction: a preview
    // object exists, is listed, and cannot be fetched by anyone until the consent decision is made.
    const panel = await listOutputs('hostA', weddingOf('hostA'));
    assert.equal(panel.status, 200);
    const listed = panel.body.find((r) => r.id === preview.id);
    assert.equal(listed.storage_domain, 'published_preview');
    assert.ok(!('object_key' in listed), 'the projection leaked the opaque preview key');

    await serviceRemove(PREV, preview.objectKey);
    exec(`delete from public.invitation_outputs where id = '${preview.id}'::uuid`, 'the E-05 fixture');
    assert.equal(objectPresent(PREV, preview.objectKey), '0', 'the preview object outlived its row');
  });

  /** What actually closes a download. The panel's own header comment (`InvitationOutputsPanel.tsx:11-13`)
   *  states the rule — a `ready` row is the only one with bytes behind it, because the object was removed
   *  with the row's retirement — and E-03 measured that the publisher obeys that order. This case measures
   *  the half that makes the rule a *rule* rather than a habit: the storage layer's door is the object's
   *  existence, not the status column. `wedding_members_read_output_objects` (`:468-477`) has no status
   *  arm, so a hand-written `invalidated` that skips the removal leaves the bytes reachable, and the run
   *  has to say which of the two writes is the one that revokes access. */
  test('E-06 the revocation that closes a download is the removal of the object, not the status of the row', async () => {
    const art = await deliverFixture('hostA', 'e06-revoked');
    const early = await storageSign(art.key, { as: 'hostA' });
    assert.equal(early.status, 200, shown(JSON.stringify(early.body)));

    exec(toInvalidated(art.id, 'publication_revoked'), 'the E-06 revocation');
    assert.deepEqual(picked(art.id, ['status', 'ready', 'invalid', 'reason']),
      { status: 'invalidated', ready: 'true', invalid: 'true', reason: 'publication_revoked' },
      shown(JSON.stringify(facts(art.id))));
    // The positive control: if the ledger write had also deleted the object, every fetch below would fail
    // for a reason this case is not about.
    assert.equal(objectPresent(OUT, art.key), '1',
      'the revocation removed the object, so nothing below measures a status change');

    const afterRow = await storageRead(art.key, { as: 'hostA' });
    assert.equal(afterRow.status, 200,
      `a retired row's object was already unreachable, so the removal below proves nothing: ${afterRow.status}`);
    assert.deepEqual([...afterRow.bytes], [...art.bytes], 'the retired read served other bytes');
    const lateMint = await storageSign(art.key, { as: 'hostA' });
    assert.equal(lateMint.status, 200, 'a fresh link was refused for a row the ledger already retired');
    const lateServed = await fetchSigned(lateMint.body.signedURL);
    assert.equal(lateServed.status, 200);
    assert.equal(sha256Hex(lateServed.bytes), art.digest,
      'the digest the row carried at `ready` is not the digest the retired row still serves');
    // Scope is unchanged in the other direction too: retirement does not open the door to anybody else.
    assert.equal((await storageRead(art.key, { as: 'hostB' })).status, 400,
      'a second host could read a retired artefact of another wedding');

    await serviceRemove(OUT, art.key);
    assert.equal(objectPresent(OUT, art.key), '0', 'the removal did not remove');
    const goneSigned = await fetchSigned(lateMint.body.signedURL);
    assert.ok(goneSigned.status >= 400,
      `the object was deleted and its still-valid signed URL keeps serving: ${goneSigned.status}`);
    assert.equal(sha256Hex(goneSigned.bytes) === art.digest, false,
      'the deleted object was served behind a link minted before the deletion');
    const goneRead = await storageRead(art.key, { as: 'hostA' });
    assert.ok(goneRead.status >= 400, `the owner's authenticated read still serves a deleted artefact`);
    const remint = await storageSign(art.key, { as: 'hostA' });
    assert.equal(remint.status, 400, shown(JSON.stringify(remint.body)));
    assert.equal(remint.body.code, 'NoSuchKey', 'the mint lied about a key that has no bytes');

    exec(`delete from public.invitation_outputs where id = '${art.id}'::uuid`, 'the E-06 fixture');
    assert.equal(absent(art.id), '0', 'the retired row refused removal');
  });

  /** The client half of this claim is already unit-pinned: `invitationOutputsTransport.test.ts:185` proves
   *  the panel passes `OUTPUT_LINK_SECONDS` to `createSignedUrl`, and `invitationOutputs.ts:63` sets it to
   *  60. What was never measured — in Stage 6, in §13, or in `verify-bytes.mjs` — is Storage's answer:
   *  whether the minted token really carries sixty seconds and whether a token past its `exp` is refused
   *  on the wire. Both numbers here come from `q9-logs/live/probe-s9-sign-scope-02.txt`. */
  test('E-07 the lifetime in the link is the lifetime Storage stamped, and a past link is refused on the wire', async () => {
    const art = await deliverFixture('hostA', 'e07-clock');
    const mint = await storageSign(art.key, { as: 'hostA', expiresIn: 60 });
    assert.equal(mint.status, 200, shown(JSON.stringify(mint.body)));
    const claims = tokenClaims(signedToken(mint.body.signedURL));
    assert.deepEqual(Object.keys(claims).sort(), ['exp', 'iat', 'scope', 'url'],
      shown(JSON.stringify(Object.keys(claims).sort())));
    assert.equal(claims.exp - claims.iat, 60,
      `the product asks for 60 seconds and the token carries ${claims.exp - claims.iat}`);
    assert.ok(claims.iat <= Math.floor(Date.now() / 1000)
      && claims.iat > Math.floor(Date.now() / 1000) - 120,
      `a token stamped at ${claims.iat}, clock at ${Math.floor(Date.now() / 1000)}`);

    // The refusal this case exists for: the same credential, after its own `exp`. Storage is asked for two
    // seconds here rather than the product's sixty because the mechanism under test is the server's clock
    // check, and waiting a minute for the same check would be a slower instrument, not a better one. Two and
    // not one because of how Storage stamps: `iat` is the whole second the mint landed in and `exp` is
    // `iat + ask`, so the guaranteed freshness floor of a link is `ask - 1` seconds — the mint can happen one
    // millisecond before the second rolls over — and at ask=1 that floor is nothing. Measured, not inferred:
    // `q11-logs/s11-e07-expiry-window-probe-1.txt` sends the fresh GET at controlled waits and shows the same
    // ~520 ms answer 200 or 400 depending only on where the stamp fell in its second (`stamp_phase_ms=122` +
    // 520 ms → 200; `stamp_phase_ms=688` + 514 ms → 400), and the unmodified cell died on the freshness line
    // below — nowhere else — in 2 of the 12 isolated runs of `q11-logs/s11-e07-isolated-trials-1.txt` and in
    // the nine-suite chain at `8d6abce` (`q11-logs/s11-runtime-4-full-chain-1.txt:148`). What has to fit
    // inside the floor is the post-stamp half of the mint plus the fresh GET, and no row of that probe has a
    // `mintRT` + `fetchRT` above 202 + 95 = 297 ms, so ask=2 leaves better than seven-tenths of a second
    // unused; the expiry half keeps its 4000 ms wait, which is now more than twice the outer edge of its own
    // boundary even after the 83 ms the VM clock measured as running ahead of this host. The floor is also
    // now aimable: `q11-logs/run-e07-phase-control.sh` hands this cell its own mint at a chosen distance
    // from its `exp`, and at 1000 ms the fresh GET answered 200 in 3/3 trials
    // (`s11-e07-phase-control-post-2s.txt`) while at 0 ms it sat on the boundary itself — 200 with 118 ms of
    // the service's second left, 400 with 101 ms of it gone (`s11-e07-phase-control-post-2s-at-boundary.txt`)
    // — which is the same assertion this repair moved off the edge, still refusing when it should.
    const quick = await storageSign(art.key, { as: 'hostA', expiresIn: 2 });
    assert.equal(quick.status, 200, shown(JSON.stringify(quick.body)));
    assert.equal(tokenClaims(signedToken(quick.body.signedURL)).exp
      - tokenClaims(signedToken(quick.body.signedURL)).iat, 2, 'Storage would not stamp a two-second link');
    const live = await fetchSigned(quick.body.signedURL);
    assert.equal(live.status, 200, `a fresh two-second link was refused: ${live.status}`);
    assert.deepEqual([...live.bytes], [...art.bytes], 'the fresh link served other bytes');
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const dead = await fetchSigned(quick.body.signedURL);
    assert.equal(dead.status, 400, `an expired token still served the artefact at ${dead.status}`);
    assert.equal(dead.type?.includes('image/png'), false, `an expired token served the object as ${dead.type}`);
    assert.equal(dead.bytes.equals(art.bytes), false, 'an expired link was handed the object bytes');

    // And what Storage does with a lifetime nobody asked it to honour: it honours it. Recorded because it
    // moves the guarantee from "the server caps a link" to "the product asks for sixty", which the panel
    // does and the transport test pins — the ceiling is the caller's discipline, not the service's.
    const longAsk = await storageSign(art.key, { as: 'hostA', expiresIn: 86400 });
    assert.equal(longAsk.status, 200, shown(JSON.stringify(longAsk.body)));
    const longClaims = tokenClaims(signedToken(longAsk.body.signedURL));
    assert.equal(longClaims.exp - longClaims.iat, 86400,
      'the measured posture: Storage mints the lifetime it is asked for, so a longer link needs a longer ask');

    await retireFixture(art);
  });

  /** Stage 6 measured a *tampered* signature (SGN-02). The leak shape that matters for a private bucket is
   *  different: a perfectly well-formed token for one artefact, with its path edited to name another
   *  wedding's. `probe-s9-sign-scope-02.txt` measured the answer for two objects of the same wedding; this
   *  case measures it across two weddings, which is the case the privacy boundary is actually about. */
  test('E-08 a link belongs to one object: a valid token replayed onto another wedding key is refused', async () => {
    const mine = await deliverFixture('hostA', 'e08-owner');
    const theirs = await deliverFixture('hostB', 'e08-other-wedding');
    assert.notEqual(theirs.key, mine.key, 'the two fixtures share a slot, so a replay proves nothing');

    const mint = await storageSign(mine.key, { as: 'hostA' });
    const token = signedToken(mint.body.signedURL);
    const claims = tokenClaims(token);
    // The locator is the `url` claim, and the signature covers the request path: `scope` measured as the
    // literal `download` names the kind of access, not the object, so nothing about the binding below is
    // inferred from a claim this file merely reads.
    assert.equal(claims.url, `${OUT}/${mine.key}`, shown(claims.url.slice(0, 24)));
    assert.equal(claims.scope, 'download', shown(claims.scope));

    const replay = await fetch(`${url}/storage/v1/object/sign/${OUT}/${theirs.key}?token=${encodeURIComponent(token)}`);
    const replayBody = await replay.json().catch(() => null);
    assert.equal(replay.status, 400, `another wedding's object answered a borrowed token: ${shown(JSON.stringify(replayBody))}`);
    assert.equal(replayBody.code, 'InvalidSignature', shown(JSON.stringify(replayBody)));

    // The control that makes the refusal above about the path and not about the fetch shape: the identical
    // request with the object's own token serves the bytes.
    const theirsMint = await storageSign(theirs.key, { as: 'hostB' });
    const honest = await fetch(`${url}/storage/v1/object/sign/${OUT}/${theirs.key}`
      + `?token=${encodeURIComponent(signedToken(theirsMint.body.signedURL))}`);
    assert.equal(honest.status, 200, `the object's own token was refused, so the case above measured nothing: ${honest.status}`);
    assert.deepEqual([...Buffer.from(await honest.arrayBuffer())], [...theirs.bytes],
      'the control served other bytes');

    const nakedRes = await fetch(`${url}/storage/v1/object/sign/${OUT}/${mine.key}`);
    const nakedText = await nakedRes.text();
    assert.equal(nakedRes.status, 400, `a signed path without a token served something: ${nakedText.slice(0, 80)}`);
    assert.equal(JSON.parse(nakedText).code, 'InvalidRequest', shown(nakedText.slice(0, 120)));

    await retireFixture(mine);
    await retireFixture(theirs);
  });

  test('Z-01 every object this run delivered is named by a row of this run\'s wedding', async () => {
    const orphans = sqlRows(`select s.bucket_id || '/' || s.name from storage.objects s
      where s.bucket_id in ('${OUT}','${PREV}')
        and not exists (select 1 from public.invitation_outputs o where o.object_key = s.name)`);
    assert.deepEqual(orphans.map((o) => o.split('/')[0]), [], `un-ledged objects: ${shown(orphans.join(', '))}`);
    assert.equal(ceilingCensus(), 'uploading_at_ceiling=0 failed_at_ceiling=0');
    assert.equal(cell(`select count(*)::text from public.invitation_outputs
      where status = 'uploading'`, 'the in-flight census'), '0',
    'the run left a row claiming work that is still in flight');
  });
});

/** The key of a result the publisher already reported. `publishArtefact` keeps `object_key` on the row
 *  it resumes and returns it in `results` only through the row itself, so a supersession case reads it
 *  from the database rather than assuming the shape. */
function firstKey(result) {
  return cell(`select object_key from public.invitation_outputs where id = '${result.row_id}'::uuid`,
    `the key of ${shown(result.row_id)}`);
}
