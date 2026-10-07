// Stage 6 §S6-6 — the storage contract, qualified over the transport the product uses.
//
// `supabase/tests/stage6/80_asset_registry.sql` and `90_storage_policies.sql` prove the registry and
// policy halves of Stage 6 with `SET ROLE` inside psql, on a cluster built from zero each run, and they
// do that more thoroughly than this file can: an ERRCODE from a guard, a mint that refuses a presented
// key, a confirmation that reads `storage.objects`, the two orphan classes counted apart. What that
// pair cannot see is the transport. It never had Kong turning an API key into a role, never had the
// Storage service deciding which `storage.objects` INSERT its own caller may make, never had a JWT's
// `sub` stamped onto an object by a service rather than by a policy, and never had a client that could
// simply *ask for a byte*.
//
// So this file is the transport, and every expectation in it is a measurement rather than a forecast.
// The shapes were taken from this stack by `q6-logs/s6-probe3.sh`, `s6-probe4.sh` and `s6-probe5.sh`
// (logs `s6-p3-shapes-02.log`, `s6-p4-shapes-02.log`, `s6-p5-shapes-01.log`, each ending in a residue
// census of zero) *before* a single assertion here was written, and three of the measurements reversed
// what a reader of the design would predict:
//
//   * A refused Storage `DELETE` is **not** an error. `DELETE /storage/v1/object/wedding-assets` for a
//     key the caller may not remove — and for a key with no object at all — answers **200 with `[]`**:
//     the empty list *is* the refusal (`A3-BYTES-STRANGER`, `DEL-BYTES-WHILE-READY`,
//     `DEL-BYTES-2-ABSENT` measured identically). Asserting "status != 200 means refused" would have
//     failed the battery for the right reason and passed it for none, so each case below asserts the
//     empty list *and* that the object is still there.
//   * A stranger's `DELETE` of a registry row answers **204** while deleting nothing, because
//     PostgREST reports an RLS no-op as success unless `Prefer: return=representation` is sent. Every
//     "refused" here is therefore read, not inferred from a status code: either the representation is
//     empty, or the row is re-selected afterwards and still says what it said.
//   * An anonymous upload is refused at **400 with `statusCode:"403"` / `code:"AccessDenied"`**, not
//     with the 401 this file originally forecast. The Storage service answers on its own terms, so
//     Kong's auth layering is not what stops an upload, and the battery now says so.
//
// Statuses also depend on the `Prefer` header, so each call below sends exactly what the probe sent.
// Measured: `POST` with `Prefer: return=representation` → 201 + row; `PATCH` with it → 200 + row;
// `PATCH` without → 204 empty; `DELETE` without → 204; `DELETE` with it and nothing matched → 200 `[]`.
// A refusal carries its error body either way.
//
// Two refusals in here are the *repaired* edge, and they are the point of running this file after a
// `db reset` rather than before it: re-describing a `ready` row's `mime_type` without moving
// `upload_status` is answered by the same type comparison the confirmation performs (audit §14.2), and a
// `size_bytes` that disagrees with the stored object is answered with the object's own length. On a
// stack built from the pre-repair migration both cases return 200, which is the hole, not a pass.
//
// What this file does not claim: no browser rendered anything, so the UI half of §6's A1/A2/A3 is still
// the browser journey's job, and A12 (no privileged key anywhere a guest can read) is a node-tier and
// artifact-tier measurement, not an HTTP one — it is not represented here at all.
//
// Not part of `npm test`; run it with `bash supabase/tests/api/run.sh`, which checks the stack is this
// repository's own, that the port matches `config.toml`, and that the run leaves the database where it
// found it. Its own `after()` hook performs the product's removal order on everything it created and
// then prints the residue census, so a leak is visible in the run rather than inherited by the next one.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const BUCKET = 'wedding-assets';

/** The bucket's own two limits. Written here once because every size and type case needs them, and
 *  compared in `before()` against the row the migration wrote — a test that derived its expectation
 *  from the same constant it checks proves nothing. */
const EXPECTED_MAX_BYTES = 5242880;
const EXPECTED_ALLOWED_MIME = ['audio/mpeg', 'image/jpeg', 'image/png', 'image/webp'];

/** The columns a staged insert hands back, in the order PostgREST printed them (probe #4). The
 *  adapter's `ASSET_COLUMNS` is a subset of this, and a row shape that changed under either would
 *  otherwise show up as a confusing field-level failure thirty cases later. */
const INSERTED_ROW_COLUMNS = [
  'id', 'wedding_id', 'asset_kind', 'label', 'object_key', 'mime_type', 'size_bytes',
  'is_generated', 'created_at', 'updated_at', 'upload_status',
];

const RUN_TAG = process.env.STAGE6_HTTP_RUN_TAG
  ?? `s6http-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// Interpolated into trusted cleanup statements, so an inherited value is accepted only in the shape
// this file generates it.
if (!/^[a-z0-9_-]+$/.test(RUN_TAG)) {
  throw new Error(`refusing to run: STAGE6_HTTP_RUN_TAG=${RUN_TAG} is not a run tag`);
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
// This suite writes bytes into a running storage service and rows into a persistent database, so the
// project is named as a string rather than trusted from a port.
if (PROJECT_ID !== 'localvivaahvarnam') {
  throw new Error(`refusing to run: project_id is ${PROJECT_ID}, and this suite only writes to localvivaahvarnam`);
}
const DB_CONTAINER = process.env.STAGE3_DB_CONTAINER ?? `supabase_db_${PROJECT_ID}`;
if (!/^[A-Za-z0-9_.-]+$/.test(DB_CONTAINER)) {
  throw new Error(`refusing to run: STAGE3_DB_CONTAINER=${DB_CONTAINER} is not a container name`);
}

const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A 68-byte PNG, the same one the probes used so the measured numbers still describe it. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64');
const NOT_A_PNG = Buffer.from('not a png at all, just bytes with a claimed type', 'utf8');
/** One byte over the bucket's ceiling. */
const TOO_BIG = Buffer.alloc(EXPECTED_MAX_BYTES + 1, 0x41);

/** A read against *this project's own* container. Every statement is scoped to a validated uuid or to
 *  this run's tag. */
function sqlRows(query) {
  const out = execFileSync('docker', ['exec', '-i', DB_CONTAINER,
    'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', query],
  { encoding: 'utf8' });
  return out.split(/\r?\n/).filter((line) => line.length > 0);
}

const people = {};
const tokenOf = (who) => people[who].token;
const uidOf = (who) => people[who].userId;
const weddingOf = (who) => people[who].weddingId;
const WHO = ['hostA', 'hostB'];

async function signUp(who) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: emailFor(who), password: PASSWORD });
  assert.equal(error, null, `signup failed for ${who}`);
  assert.ok(data.session, 'expected a session immediately');
  const { data: fresh } = await c.auth.getSession();
  return { client: c, userId: data.user.id, token: fresh.session.access_token };
}

async function json(res) {
  const text = await res.text();
  return text === '' ? null : JSON.parse(text);
}

/** One REST call, spelled out rather than hidden behind the client library: the credential is a header
 *  and the representation preference is explicit, because the measured status depends on it. */
async function rest(method, rel, query, body, { as = 'anon', represent = false } = {}) {
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${as === 'anon' ? anonKey : tokenOf(as)}`,
    'Content-Type': 'application/json',
  };
  if (represent) headers.Prefer = 'return=representation';
  const res = await fetch(`${url}/rest/v1/${rel}${query ? `?${query}` : ''}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await json(res) };
}

/** The same call for a role that has no session at all: the publishable key is the only credential,
 *  which is what makes A4 a measurement of the grant rather than of a policy. */
const asAnon = (method, rel, query, body, opts) => rest(method, rel, query, body, { ...opts, as: 'anon' });

/** Storage API, as the browser calls it. `bytes` goes out as the request body with the stated
 *  `Content-Type`, because the bucket's MIME and size refusals are properties of that pair. */
async function storagePut(key, bytes, mime, { as, upsert = false } = {}) {
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${key}`, {
    method: upsert ? 'PUT' : 'POST',
    headers: {
      apikey: anonKey, Authorization: `Bearer ${as === 'anon' ? anonKey : tokenOf(as)}`,
      'Content-Type': mime, ...(upsert ? { 'x-upsert': 'true' } : {}),
    },
    body: bytes,
  });
  return { status: res.status, body: await json(res) };
}

/** `POST` with no `Authorization` header at all — the second anon spelling probe #4 measured. */
async function storagePutNoAuth(key, bytes, mime) {
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${key}`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': mime }, body: bytes,
  });
  return { status: res.status, body: await json(res) };
}

async function storageRead(key, { as = 'anon', withAuth = true } = {}) {
  const res = await fetch(`${url}/storage/v1/object/authenticated/${BUCKET}/${key}`, {
    headers: withAuth
      ? { apikey: anonKey, Authorization: `Bearer ${as === 'anon' ? anonKey : tokenOf(as)}` }
      : { apikey: anonKey },
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  let body = null;
  if (res.status >= 400) body = JSON.parse(bytes.toString('utf8'));
  return { status: res.status, bytes, body };
}

async function storageDelete(keys, { as = 'anon' } = {}) {
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: {
      apikey: anonKey, Authorization: `Bearer ${as === 'anon' ? anonKey : tokenOf(as)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefixes: keys }),
  });
  return { status: res.status, body: await json(res) };
}

async function storageList(prefix, { as = 'anon' } = {}) {
  const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: {
      apikey: anonKey, Authorization: `Bearer ${as === 'anon' ? anonKey : tokenOf(as)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefix, limit: 50 }),
  });
  return { status: res.status, body: await json(res) };
}

async function storageSign(key, { as = 'anon' } = {}) {
  const res = await fetch(`${url}/storage/v1/object/sign/${BUCKET}/${key}`, {
    method: 'POST',
    headers: {
      apikey: anonKey, Authorization: `Bearer ${as === 'anon' ? anonKey : tokenOf(as)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  return { status: res.status, body: await json(res) };
}

/** The service hands back a path beginning `/object/sign/…?token=…`, and the token alone is the
 *  credential: fetched at the bare origin it is Kong's `no Route matched` 404, and with the
 *  `/storage/v1` prefix it serves the bytes without an `apikey` header. Both halves measured by probe
 *  #5 (`SIGNGET-BARE` 404, `SIGNGET-V1` 200, `SIGNGET-V1-KEY` 200). */
async function fetchSigned(signedURL, { withApikey = false } = {}) {
  const res = await fetch(`${url}/storage/v1${signedURL}`,
    { headers: withApikey ? { apikey: anonKey } : {} });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
}

const publicURL = (key) => `${url}/storage/v1/object/public/${BUCKET}/${key}`;

/** A staged registry row, created through the product's own route: no key, no status, no privilege.
 *  The row is read back from the response, never reconstructed. */
const stageRow = (who, weddingId, extra = {}) => rest('POST', 'wedding_assets', '', {
  wedding_id: weddingId, asset_kind: 'photo', label: RUN_TAG, ...extra,
}, { as: who, represent: true });

const inserted = (r) => {
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body[0];
};

/** A state write. `represent` is set only where the case reads the returned row, because the measured
 *  success status is 204 without it and 200 with it. */
const patchRow = (who, id, body, opts = {}) => rest('PATCH', 'wedding_assets', `id=eq.${id}`, body, { as: who, ...opts });
const deleteRow = (who, id, opts = {}) => rest('DELETE', 'wedding_assets', `id=eq.${id}`, undefined, { as: who, ...opts });
const selectRow = (who, id, select = '*') =>
  rest('GET', 'wedding_assets', `id=eq.${id}&select=${select}`, undefined, { as: who });

/** Does this key exist as an object in the bucket *right now*, from the database's side? Used wherever
 *  the transport's answer is ambiguous between "refused" and "removed nothing". */
const objectPresent = (key) =>
  sqlRows(`select (count(*) > 0)::text from storage.objects where bucket_id = '${BUCKET}' and name = '${key}'`)[0] === 'true';

const objectCount = (key) => Number(
  sqlRows(`select count(*)::text from storage.objects where bucket_id = '${BUCKET}' and name = '${key}'`)[0],
);

/** The three columns the state machine and the two repaired edges act on, read from the database
 *  rather than from the caller's own last write. */
function rowState(id) {
  const [mime, size, status] = sqlRows(
    `select coalesce(mime_type,'NULL')||'|'||coalesce(size_bytes::text,'NULL')||'|'||upload_status
       from public.wedding_assets where id = '${id}'`,
  )[0].split('|');
  return { mime, size, status };
}

before(async () => {
  // The bucket first. Every refusal below is attributed to *its* configuration, so its two settings are
  // read from the row the migration wrote rather than assumed from this file's constants — and if they
  // disagree, the suite says so instead of reporting thirty refusals that mean something else.
  const facts = sqlRows(`select public::text || '|' || coalesce(file_size_limit::text,'NULL') || '|' ||
                                 coalesce((select string_agg(m, ',' order by m)
                                             from unnest(allowed_mime_types) m), 'NULL')
                          from storage.buckets where id = '${BUCKET}'`);
  assert.equal(facts.length, 1,
    `refusing to run: no '${BUCKET}' row in storage.buckets, so every bucket-configured refusal below `
    + 'would be measuring a bucket that does not exist');
  const [isPublic, limit, mimes] = facts[0].split('|');
  assert.equal(isPublic, 'false',
    `refusing to run: the bucket is public=${isPublic}; §4 and A14 both assume it is not`);
  assert.equal(limit, String(EXPECTED_MAX_BYTES),
    `refusing to run: the bucket's file_size_limit is ${limit}, the design says ${EXPECTED_MAX_BYTES}`);
  assert.deepEqual(mimes.split(','), EXPECTED_ALLOWED_MIME,
    `refusing to run: the bucket allows [${mimes}], the design says [${EXPECTED_ALLOWED_MIME}]`);

  // And the registry columns the state machine lives in. A stack built from before the Stage 6
  // migration has no `upload_status`, which would make every case below a pass about a column that is
  // not there.
  const columns = sqlRows(`select column_name from information_schema.columns
                            where table_schema = 'public' and table_name = 'wedding_assets'`);
  for (const needed of ['upload_status', 'object_key', 'mime_type', 'size_bytes']) {
    assert.ok(columns.includes(needed),
      `refusing to run: public.wedding_assets has no ${needed}; re-apply this repository's migrations`);
  }

  for (const who of WHO) people[who] = await signUp(who);

  // Weddings through the product's own path: the publishable key, the owner's JWT, no privilege. If a
  // host could not create its own wedding here, the upload cases would be about a fixture rather than
  // about the app.
  for (const who of WHO) {
    const r = await rest('POST', 'weddings', '', {
      owner_user_id: uidOf(who), title: `S6 HTTP ${who} ${RUN_TAG}`, primary_language: 'en',
    }, { as: who, represent: true });
    assert.equal(r.status, 201, `${who} could not create a wedding: ${JSON.stringify(r.body)}`);
    people[who].weddingId = r.body[0].id;
    assert.match(people[who].weddingId, UUID);
  }
});

after(async () => {
  // Removal is the product's own sequence, applied to everything this run created: tombstone every row,
  // then collect the bytes, then delete the rows. The service-role key is used only for the sweep, and
  // only because a refused delete would otherwise leave the next run measuring this one's residue. The
  // triggers still run for that role, which is why the order here is not a convenience.
  const weddings = WHO.map(weddingOf);
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: myRows, error: rowsErr } = await svc.from('wedding_assets')
    .select('id, object_key, upload_status').in('wedding_id', weddings);
  assert.equal(rowsErr, null, rowsErr?.message);
  for (const row of myRows ?? []) {
    if (row.upload_status !== 'tombstoned') {
      const { error } = await svc.from('wedding_assets')
        .update({ upload_status: 'tombstoned' }).eq('id', row.id);
      assert.equal(error, null, `teardown could not tombstone ${row.id}: ${error?.message}`);
    }
  }
  const keys = (myRows ?? []).map((r) => r.object_key);
  if (keys.length > 0) {
    const res = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: {
        apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: keys }),
    });
    assert.ok(res.ok, `teardown could not collect this run's objects (HTTP ${res.status})`);
  }
  const { error: delErr } = await svc.from('wedding_assets').delete().in('wedding_id', weddings);
  assert.equal(delErr, null, `teardown could not delete this run's rows: ${delErr?.message}`);
  for (const who of WHO) {
    const { error } = await svc.from('weddings').delete().eq('id', weddingOf(who));
    assert.equal(error, null, `teardown could not delete ${who}'s wedding: ${error?.message}`);
  }
  const { data: leftRows } = await svc.from('wedding_assets').select('id').in('wedding_id', weddings);
  assert.deepEqual(leftRows, [], 'teardown left an asset row behind');
  for (const who of WHO) {
    const res = await fetch(`${url}/auth/v1/admin/users/${uidOf(who)}`, {
      method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    assert.ok(res.ok, `teardown could not remove a synthetic account (HTTP ${res.status})`);
  }

  // The census the run leaves, printed from the same database rather than asserted to be zero: the
  // local stack is shared with earlier stages' batteries, so a number here is a fact about this run
  // that the reader of the log can weigh. `wedding_assets` and the bucket's objects are the two the
  // Stage 6 tier is required to restore.
  console.log('  residue census after the Stage 6 HTTP teardown:');
  for (const line of sqlRows(`select '    wedding_assets total='||count(*) from public.wedding_assets
                              union all select '    objects in the bucket='||count(*) from storage.objects
                                 where bucket_id = '${BUCKET}'
                              union all select '    weddings owned by this run='||count(*) from public.weddings
                                 where title like '%${RUN_TAG}%'
                              union all select '    auth users matching the run tag='||count(*) from auth.users
                                 where email like '%${RUN_TAG}%'`)) {
    console.log(line);
  }
});

// ---------------------------------------------------------------------------
// MINT — the database names the object; the client only ever reads the name back
// ---------------------------------------------------------------------------
describe('S6 MINT', () => {
  test('MINT-01 an insert that names no key leaves a staged row whose key is the minted shape', async () => {
    const row = inserted(await stageRow('hostA', weddingOf('hostA')));
    assert.deepEqual(Object.keys(row), INSERTED_ROW_COLUMNS,
      'the representation the adapter reads changed shape; ASSET_COLUMNS and this file both need it');
    assert.equal(row.upload_status, 'staged',
      'a new row must arrive as staged; the state is the availability flag, not a hint');
    assert.equal(row.object_key, `weddings/${row.wedding_id}/photo/${row.id}`,
      'the key is weddings/<wedding>/<kind>/<row id> and nothing else');
    assert.match(row.id, UUID);
    assert.deepEqual([row.mime_type, row.size_bytes], [null, null],
      'a staged row claims nothing about bytes it has not got');
    // The row is the client's only source for the key, so a caller that never sent one can still find
    // its own bytes.
    const back = await selectRow('hostA', row.id, 'object_key');
    assert.equal(back.body[0].object_key, row.object_key);
    await dropStaged('hostA', row);
  });

  test('MINT-02 a presented key is refused in seven spellings, with the sentence that says to omit it', async () => {
    const wid = weddingOf('hostA');
    const presented = {
      'own prefix, real shape': `weddings/${wid}/photo/${crypto.randomUUID()}`,
      traversal: '../../etc/passwd',
      'leading slash': `/weddings/${wid}/photo/x`,
      "another wedding's prefix": `weddings/${weddingOf('hostB')}/photo/${crypto.randomUUID()}`,
      'over-long name': `weddings/${wid}/photo/${'a'.repeat(400)}`,
      'windows separators': `weddings\\${wid}\\photo\\x`,
      'space in the name': `weddings/${wid}/photo/x y.png`,
    };
    for (const [name, object_key] of Object.entries(presented)) {
      const r = await stageRow('hostA', wid, { object_key });
      assert.equal(r.status, 403, `${name}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, '42501', name);
      assert.match(r.body.message, /object_key is minted by the database and cannot be supplied/, name);
      assert.match(r.body.hint, /Omit object_key; read it back from the inserted row\./, name);
    }
    // And no row survived the seven attempts, so the refusal is not "the key was ignored". The read is
    // the owner's own — the default role for a bare `rest()` call is anon, which the registry refuses
    // at the grant, and that answer would look like a pass about the wrong thing.
    const rows = await rest('GET', 'wedding_assets', `wedding_id=eq.${wid}&select=id,object_key`,
      undefined, { as: 'hostA' });
    assert.deepEqual(rows.body, [], `a presented key still wrote a row: ${JSON.stringify(rows.body)}`);
  });

  test('MINT-03 an asset_kind outside the vocabulary is refused by the CHECK, before any key is minted', async () => {
    for (const asset_kind of ['generated_input', 'PHOTO', '']) {
      const r = await stageRow('hostA', weddingOf('hostA'), { asset_kind });
      assert.equal(r.status, 400, `${asset_kind}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, '23514', asset_kind);
      assert.match(r.body.message, /wedding_assets_asset_kind_check/, asset_kind);
    }
    const rows = await rest('GET', 'wedding_assets',
      `wedding_id=eq.${weddingOf('hostA')}&select=id`, undefined, { as: 'hostA' });
    assert.deepEqual(rows.body, [], 'a refused kind still wrote a row');
  });

  test('MINT-04 a stranger cannot register a row inside someone else\'s wedding, and the reason is the policy', async () => {
    const r = await stageRow('hostB', weddingOf('hostA'));
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.code, '42501');
    assert.match(r.body.message, /new row violates row-level security policy for table "wedding_assets"/,
      'this is RLS answering, which is the half a grant refusal cannot show');
    const rows = await rest('GET', 'wedding_assets', `wedding_id=eq.${weddingOf('hostA')}&select=id`,
      undefined, { as: 'hostA' });
    assert.deepEqual(rows.body, [], 'the RLS refusal wrote a row anyway');
  });

  test('MINT-05 anon cannot even ask: the registry refuses it at the table grant, one layer before RLS', async () => {
    const ins = await asAnon('POST', 'wedding_assets', '', {
      wedding_id: weddingOf('hostA'), asset_kind: 'photo', label: RUN_TAG,
    }, { represent: true });
    assert.equal(ins.status, 401, JSON.stringify(ins.body));
    assert.equal(ins.body.code, '42501');
    assert.match(ins.body.message, /permission denied for table wedding_assets/);
    const sel = await asAnon('GET', 'wedding_assets', 'select=id');
    assert.equal(sel.status, 401, JSON.stringify(sel.body));
    assert.match(sel.body.message, /permission denied for table wedding_assets/);
    assert.match(sel.body.hint, /GRANT SELECT ON public\.wedding_assets TO anon/,
      'the hint itself says the grant is what anon lacks — a policy would have answered []');
  });
});

// ---------------------------------------------------------------------------
// UPLOAD — bytes, and the two limits the bucket itself owns
// ---------------------------------------------------------------------------
describe('S6 UPLOAD', () => {
  test('UPL-01 the owner puts bytes at the minted key and the service stamps the object as its own', async () => {
    const row = inserted(await stageRow('hostA', weddingOf('hostA'),
      { mime_type: 'image/png', size_bytes: PNG.length }));
    const up = await storagePut(row.object_key, PNG, 'image/png', { as: 'hostA' });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal(up.body.Key, `${BUCKET}/${row.object_key}`);
    assert.match(up.body.Id, UUID);
    // The two facts the confirmation later reads. Both were observed on a real upload of this file:
    // `owner_id` from the JWT `sub`, and the type and length the service recorded itself.
    const stamped = sqlRows(`select coalesce(owner_id,'NULL')||'|'||
                                    coalesce(metadata->>'mimetype','NULL')||'|'||
                                    coalesce(metadata->>'size','NULL')
                             from storage.objects where bucket_id = '${BUCKET}' and name = '${row.object_key}'`)[0]
      .split('|');
    assert.deepEqual(stamped, [uidOf('hostA'), 'image/png', String(PNG.length)],
      'the service derives the owner from the JWT sub; a policy that read anything else would not be a boundary');
    await removeAsset('hostA', row);
  });

  test('UPL-02 a stranger holding a legitimate staged row of its own still cannot write into the owner\'s prefix', async () => {
    const mine = inserted(await stageRow('hostB', weddingOf('hostB')));
    const theirs = inserted(await stageRow('hostA', weddingOf('hostA')));
    for (const [name, key] of [
      ['the owner\'s live staged key', theirs.object_key],
      ['the owner\'s wedding with a made-up row id',
        `weddings/${weddingOf('hostA')}/photo/${crypto.randomUUID()}`],
      ['a key outside the weddings prefix', `gallery/${RUN_TAG}.png`],
    ]) {
      const up = await storagePut(key, PNG, 'image/png', { as: 'hostB' });
      assert.equal(up.status, 400, `${name}: ${JSON.stringify(up.body)}`);
      assert.equal(up.body.statusCode, '403', name);
      assert.equal(up.body.code, 'AccessDenied', name);
      assert.match(up.body.message, /new row violates row-level security policy/, name);
      assert.equal(objectPresent(key), false, `${name}: the bytes arrived anyway`);
    }
    // The stranger's own row remains staged with no object, which is the state a confirmation refuses.
    assert.deepEqual(rowState(mine.id), { mime: 'NULL', size: 'NULL', status: 'staged' });
    await dropStaged('hostB', mine);
    await dropStaged('hostA', theirs);
  });

  test('UPL-03 anon uploads are refused by the Storage service itself, in both credential spellings', async () => {
    const row = inserted(await stageRow('hostA', weddingOf('hostA'),
      { mime_type: 'image/png', size_bytes: PNG.length }));
    for (const [name, up] of [
      ['publishable key as the bearer token',
        await storagePut(row.object_key, PNG, 'image/png', { as: 'anon' })],
      ['no Authorization header at all',
        await storagePutNoAuth(row.object_key, PNG, 'image/png')],
    ]) {
      // Measured, and it is not the answer this file first predicted: Storage answers 400 with its own
      // 403 inside the body, so the refusal is the object policy rather than a Kong auth rejection.
      assert.equal(up.status, 400, `${name}: ${JSON.stringify(up.body)}`);
      assert.equal(up.body.statusCode, '403', name);
      assert.equal(up.body.code, 'AccessDenied', name);
      assert.match(up.body.message, /new row violates row-level security policy/, name);
      assert.equal(objectPresent(row.object_key), false, `${name}: an anonymous write landed`);
    }
    await dropStaged('hostA', row);
  });

  test('UPL-04 the bucket refuses a type it does not allow, leaves no object, and the confirmation then refuses the row', async () => {
    for (const mime of ['text/html', 'image/svg+xml', 'application/octet-stream']) {
      const row = inserted(await stageRow('hostA', weddingOf('hostA'),
        { mime_type: mime, size_bytes: PNG.length }));
      // The registry accepts the *claim*: `mime_type` is a column whose vocabulary is the bucket's, not
      // a CHECK. The refusal happens where the bytes are, and again at the edge that would call the row
      // ready. That is the design's "the database is not the only place a lie is caught", and it is only
      // a true statement because the upload itself was refused.
      const up = await storagePut(row.object_key, PNG, mime, { as: 'hostA' });
      assert.equal(up.status, 400, `${mime}: ${JSON.stringify(up.body)}`);
      assert.equal(up.body.statusCode, '415', mime);
      assert.equal(up.body.code, 'InvalidMimeType', mime);
      assert.equal(up.body.error, 'invalid_mime_type', mime);
      assert.match(up.body.message,
        new RegExp(`mime type ${escapeForRegex(mime)} is not supported`), mime);
      assert.equal(objectPresent(row.object_key), false, `${mime}: a refused type still stored bytes`);
      const confirm = await patchRow('hostA', row.id, { upload_status: 'ready' });
      assert.equal(confirm.status, 403, `${mime}: ${JSON.stringify(confirm.body)}`);
      assert.equal(confirm.body.code, '42501', mime);
      assert.match(confirm.body.message,
        new RegExp(`no stored object exists at ${escapeForRegex(row.object_key)}`), mime);
      assert.equal(rowState(row.id).status, 'staged', `${mime}: the failed confirm moved the state`);
      await dropStaged('hostA', row);
    }
  });

  test('UPL-05 one byte over the ceiling is refused by the bucket, and nothing is stored', async () => {
    const row = inserted(await stageRow('hostA', weddingOf('hostA'),
      { mime_type: 'image/png', size_bytes: EXPECTED_MAX_BYTES + 1 }));
    const up = await storagePut(row.object_key, TOO_BIG, 'image/png', { as: 'hostA' });
    assert.equal(up.status, 400, JSON.stringify(up.body));
    assert.equal(up.body.statusCode, '413');
    assert.equal(up.body.code, 'EntityTooLarge');
    assert.equal(up.body.error, 'Payload too large');
    assert.match(up.body.message, /exceeded the maximum allowed size/);
    assert.equal(objectPresent(row.object_key), false, 'an oversized object was left in the bucket');
    const confirm = await patchRow('hostA', row.id, { upload_status: 'ready' });
    assert.equal(confirm.status, 403, JSON.stringify(confirm.body));
    assert.match(confirm.body.message, /no stored object exists at/);
    await dropStaged('hostA', row);
  });

  test('UPL-06 a size claim that disagrees with the object is refused by name, and by the object\'s own length', async () => {
    const row = inserted(await stageRow('hostA', weddingOf('hostA'),
      { mime_type: 'image/png', size_bytes: PNG.length }));
    assert.equal((await storagePut(row.object_key, PNG, 'image/png', { as: 'hostA' })).status, 200);
    const confirm = await patchRow('hostA', row.id,
      { upload_status: 'ready', mime_type: 'image/png', size_bytes: 999999 },
      { represent: true });
    assert.equal(confirm.status, 403, JSON.stringify(confirm.body));
    assert.equal(confirm.body.code, '42501');
    assert.match(confirm.body.message, new RegExp(
      `the object at ${escapeForRegex(row.object_key)} is ${PNG.length} bytes, but this row claims 999999`),
    'the refusal should quote the length the service actually recorded');
    assert.equal(rowState(row.id).status, 'staged');
    // The honest version of the same write succeeds, which is what says the check ran rather than that
    // the PATCH was refused for a reason unrelated to the number.
    const truthful = await patchRow('hostA', row.id,
      { upload_status: 'ready', mime_type: 'image/png', size_bytes: PNG.length },
      { represent: true });
    assert.equal(truthful.status, 200, JSON.stringify(truthful.body));
    assert.equal(truthful.body[0].upload_status, 'ready');
    await removeAsset('hostA', row);
  });
});

// ---------------------------------------------------------------------------
// READ — who can ask for a byte, and who is told nothing
// ---------------------------------------------------------------------------
describe('S6 READ', () => {
  test('READ-01 the owner reads its own object back, byte for byte', async () => {
    const row = await liveAsset('hostA');
    const got = await storageRead(row.object_key, { as: 'hostA' });
    assert.equal(got.status, 200, `${got.status}`);
    assert.deepEqual([...got.bytes], [...PNG],
      'the bytes a host uploaded are not the bytes it got back');
    await removeAsset('hostA', row);
  });

  test('A1 a second authenticated account is answered "no such key", not "forbidden"', async () => {
    const row = await liveAsset('hostA');
    const stranger = await storageRead(row.object_key, { as: 'hostB' });
    assert.equal(stranger.status, 400, `${stranger.status}`);
    assert.equal(stranger.body.statusCode, '404');
    assert.equal(stranger.body.error, 'not_found');
    assert.equal(stranger.body.code, 'NoSuchKey');
    // The identical answer to a key that does not exist anywhere (A5), which is the no-oracle property:
    // a stranger cannot probe the bucket to enumerate which weddings have photographs.
    assert.equal(objectPresent(row.object_key), true,
      'the object is really there, so this refusal is the policy and not an absent file');
    await removeAsset('hostA', row);
  });

  test('A4 the publishable key with no session gets the identical answer, with or without a bearer header', async () => {
    const row = await liveAsset('hostA');
    for (const [name, anon] of [
      ['bearer set to the publishable key', await storageRead(row.object_key, { as: 'anon' })],
      ['no Authorization header', await storageRead(row.object_key, { withAuth: false })],
    ]) {
      assert.equal(anon.status, 400, `${name}: ${anon.status}`);
      assert.equal(anon.body.code, 'NoSuchKey', name);
      // The refusal arrives *as* the response body, so the byte count is not the claim; what matters is
      // that no part of the object's own bytes was served to a caller that has no policy for it.
      assert.equal(anon.bytes.equals(PNG), false, `${name}: the object's bytes were served`);
      assert.equal(anon.bytes.subarray(0, 1).toString(), '{', `${name}: a non-JSON body was served`);
    }
    await removeAsset('hostA', row);
  });

  test('A5 a guessed key for a wedding that has no row reads as absent and lists as nothing', async () => {
    const guessed = `weddings/${crypto.randomUUID()}/photo/${crypto.randomUUID()}`;
    const read = await storageRead(guessed, { as: 'hostA' });
    assert.equal(read.status, 400);
    assert.equal(read.body.code, 'NoSuchKey');
    const list = await storageList(guessed.split('/').slice(0, 2).join('/') + '/', { as: 'hostA' });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, [], 'a prefix walk harvested something for a wedding with no assets');
  });

  test('SGN-01 the owner mints a short-lived URL that serves the bytes; a stranger mints nothing', async () => {
    const row = await liveAsset('hostA');
    const signed = await storageSign(row.object_key, { as: 'hostA' });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    assert.match(signed.body.signedURL, new RegExp(`^/object/sign/${BUCKET}/`));
    const served = await fetchSigned(signed.body.signedURL);
    assert.equal(served.status, 200, `signed URL fetched at the wrong base: ${served.status}`);
    assert.deepEqual([...served.bytes], [...PNG]);
    // The token is the credential, so an `apikey` header changes nothing about what it grants.
    const withKey = await fetchSigned(signed.body.signedURL, { withApikey: true });
    assert.equal(withKey.status, 200);
    // A tampered signature is refused rather than treated as absent, which is the other half of the
    // same claim: the URL works because of the token, not because the route is open.
    const tampered = await fetchSigned(`${signed.body.signedURL.split('?')[0]}?token=not-a-token`);
    assert.equal(tampered.status, 400);
    const strangerSign = await storageSign(row.object_key, { as: 'hostB' });
    assert.equal(strangerSign.status, 400, JSON.stringify(strangerSign.body));
    assert.equal(strangerSign.body.code, 'NoSuchKey',
      'a stranger cannot even obtain a URL it would not be able to use');
    await removeAsset('hostA', row);
  });

  test('A14 the bucket has no public path at all, while the object lives and after it is tombstoned', async () => {
    const row = await liveAsset('hostA');
    const stages = [['live', await fetch(publicURL(row.object_key), { headers: { apikey: anonKey } })]];
    await patchRow('hostA', row.id, { upload_status: 'tombstoned' });
    stages.push(['after tombstone',
      await fetch(publicURL(row.object_key), { headers: { apikey: anonKey } })]);
    for (const [stage, res] of stages) {
      const body = await json(res);
      assert.equal(res.status, 400, `${stage}: ${JSON.stringify(body)}`);
      assert.equal(body.code, 'NoSuchBucket', stage);
      assert.equal(body.error, 'Bucket not found', stage);
    }
    await removeAsset('hostA', row);
  });

  test('A13 the owner can see its own folder and its own object; a stranger sees an empty bucket', async () => {
    const row = await liveAsset('hostA');
    const ownerRoot = await storageList('', { as: 'hostA' });
    assert.equal(ownerRoot.status, 200);
    assert.deepEqual(ownerRoot.body.map((e) => e.name), ['weddings'],
      'the list surface is a folder walk, and the only folder this owner has made is its own wedding tree');
    const ownerPrefix = await storageList(`weddings/${weddingOf('hostA')}/photo/`, { as: 'hostA' });
    assert.equal(ownerPrefix.status, 200);
    assert.deepEqual(ownerPrefix.body.map((e) => e.name), [row.id],
      'the owner cannot see its own object by name, which is the listing the adapter would need');
    const strangerRoot = await storageList('', { as: 'hostB' });
    assert.equal(strangerRoot.status, 200);
    assert.deepEqual(strangerRoot.body, [],
      'a co-tenant harvested object names from the bucket — the list policy is the only thing between them');
    const acrossTheYard = await storageList(`weddings/${weddingOf('hostA')}/`, { as: 'hostB' });
    assert.deepEqual(acrossTheYard.body, [],
      'a prefix that names the owner\'s wedding walked on a stranger\'s authority');
    await removeAsset('hostA', row);
  });
});

// ---------------------------------------------------------------------------
// STATE — the machine, its refusals, and the two edges the repair was about
// ---------------------------------------------------------------------------
describe('S6 STATE', () => {
  test('STA-01 a staged row with no object cannot be confirmed, in the owner\'s own session', async () => {
    const row = inserted(await stageRow('hostA', weddingOf('hostA'),
      { mime_type: 'image/png', size_bytes: PNG.length }));
    const r = await patchRow('hostA', row.id, { upload_status: 'ready' });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.code, '42501');
    assert.match(r.body.message, /no stored object exists at/);
    await dropStaged('hostA', row);
  });

  test('STA-02 ready does not go backwards, and it only goes to tombstoned', async () => {
    const row = await liveAsset('hostA');
    const back = await patchRow('hostA', row.id, { upload_status: 'staged' });
    assert.equal(back.status, 403, JSON.stringify(back.body));
    assert.equal(back.body.code, '42501');
    assert.match(back.body.message, /a ready wedding asset may only be tombstoned/);
    assert.equal(rowState(row.id).status, 'ready', 'the refusal moved the state');
    await removeAsset('hostA', row);
  });

  test('STA-03 re-describing a ready row\'s type is refused by the object, in the session that made it ready', async () => {
    // audit §14.2 over HTTP. The row is `ready`, `upload_status` does not move, and `mime_type` is an
    // ordinary column a PATCH may name — so before the repair this write answered 200 and left a
    // published asset described as something its bytes never were.
    const row = await liveAsset('hostA');
    const lie = await patchRow('hostA', row.id, { mime_type: 'text/html' }, { represent: true });
    assert.equal(lie.status, 403, JSON.stringify(lie.body));
    assert.equal(lie.body.code, '42501');
    assert.match(lie.body.message, /is stored as image\/png, but this row claims text\/html/);
    // The row carries its claims from the moment `liveAsset` staged them, and the confirmation checked
    // them rather than recording new ones — so the refused lie leaves the true pair standing, which is
    // the observable form of "the write did not land".
    assert.deepEqual(rowState(row.id), { mime: 'image/png', size: String(PNG.length), status: 'ready' },
      'the refused write still landed');
    const still = await selectRow('hostA', row.id, 'upload_status');
    assert.equal(still.body[0].upload_status, 'ready', 'the refusal moved the state');
    // Dropping a claim is not a lie, so it is allowed; re-declaring it truthfully is allowed too, and
    // the pair is what proves the comparison ran instead of the whole PATCH being blocked.
    const drop = await patchRow('hostA', row.id, { mime_type: null, size_bytes: null },
      { represent: true });
    assert.equal(drop.status, 200, JSON.stringify(drop.body));
    const declare = await patchRow('hostA', row.id,
      { mime_type: 'image/png', size_bytes: PNG.length }, { represent: true });
    assert.equal(declare.status, 200, JSON.stringify(declare.body));
    assert.equal(declare.body[0].mime_type, 'image/png');
    await removeAsset('hostA', row);
  });

  test('A10 the row cannot be moved: wedding, key and kind are each immovable over PATCH', async () => {
    const row = await liveAsset('hostA');
    const cases = [
      ['wedding_id', { wedding_id: weddingOf('hostB') }, /a wedding asset cannot be re-parented/],
      ['object_key', { object_key: `weddings/${weddingOf('hostA')}/photo/${crypto.randomUUID()}` },
        /wedding_assets\.object_key is immutable once minted/],
      ['asset_kind', { asset_kind: 'audio' }, /asset_kind is part of the minted object key/],
    ];
    for (const [name, patch, pattern] of cases) {
      const r = await patchRow('hostA', row.id, patch);
      assert.equal(r.status, 403, `${name}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, '42501', name);
      assert.match(r.body.message, pattern, name);
    }
    const unchanged = await selectRow('hostA', row.id, 'wedding_id,object_key,asset_kind');
    assert.equal(unchanged.body[0].wedding_id, weddingOf('hostA'));
    assert.equal(unchanged.body[0].object_key, row.object_key);
    assert.equal(unchanged.body[0].asset_kind, 'photo');
    await removeAsset('hostA', row);
  });

  test('A7 an overwrite is refused because no UPDATE policy exists, and the original bytes survive it', async () => {
    const row = await liveAsset('hostA');
    const up = await storagePut(row.object_key, NOT_A_PNG, 'image/png', { as: 'hostA', upsert: true });
    assert.equal(up.status, 400, JSON.stringify(up.body));
    assert.equal(up.body.statusCode, '403');
    assert.equal(up.body.code, 'AccessDenied');
    assert.match(up.body.message, /new row violates row-level security policy/);
    const back = await storageRead(row.object_key, { as: 'hostA' });
    assert.deepEqual([...back.bytes], [...PNG],
      'the overwrite was refused, but the object it would have replaced is gone or changed');
    // And the row still describes the same evidence as it did before the attempt.
    assert.deepEqual(rowState(row.id), { mime: 'image/png', size: String(PNG.length), status: 'ready' });
    await removeAsset('hostA', row);
  });

  test('A7b a second write to a live key without upsert is refused as a duplicate, and stays one object', async () => {
    const row = inserted(await stageRow('hostA', weddingOf('hostA'),
      { mime_type: 'image/png', size_bytes: PNG.length }));
    assert.equal((await storagePut(row.object_key, PNG, 'image/png', { as: 'hostA' })).status, 200);
    const again = await storagePut(row.object_key, NOT_A_PNG, 'image/png', { as: 'hostA' });
    assert.equal(again.status, 400, JSON.stringify(again.body));
    assert.equal(again.body.statusCode, '409');
    assert.equal(again.body.error, 'Duplicate');
    assert.equal(again.body.code, 'KeyAlreadyExists');
    assert.equal(objectCount(row.object_key), 1, 'a second write put a second object under the same name');
    const back = await storageRead(row.object_key, { as: 'hostA' });
    assert.deepEqual([...back.bytes], [...PNG], 'the refused second write changed the stored bytes');
    await removeAsset('hostA', row);
  });
});

// ---------------------------------------------------------------------------
// REMOVE — the ordering, and the difference between "refused" and "removed nothing"
// ---------------------------------------------------------------------------
describe('S6 REMOVE', () => {
  test('DEL-01 the registry row cannot be deleted while it is ready, in the owner\'s own session', async () => {
    const row = await liveAsset('hostA');
    const r = await deleteRow('hostA', row.id);
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.code, '42501');
    assert.match(r.body.message, /tombstone the asset before deleting the registry row/);
    assert.equal(rowState(row.id).status, 'ready');
    assert.equal(objectPresent(row.object_key), true);
    await removeAsset('hostA', row);
  });

  test('A3 the bytes cannot be collected while the row says ready: the answer is an empty list, and the object is still there', async () => {
    // The measured shape that makes this case worth writing down. A Storage DELETE does not answer an
    // RLS refusal with an error status; it answers with the list of what it removed, which is empty.
    const row = await liveAsset('hostA');
    const ownerTooEarly = await storageDelete([row.object_key], { as: 'hostA' });
    assert.equal(ownerTooEarly.status, 200, JSON.stringify(ownerTooEarly.body));
    assert.deepEqual(ownerTooEarly.body, [], 'a delete that matched the policy returned something');
    assert.equal(objectPresent(row.object_key), true,
      'the empty list was not a refusal — the object is gone, and the assertion above is vacuous');
    const stranger = await storageDelete([row.object_key], { as: 'hostB' });
    assert.deepEqual(stranger.body, []);
    assert.equal(objectPresent(row.object_key), true, 'a co-tenant collected the owner\'s bytes');
    await removeAsset('hostA', row);
  });

  test('DEL-02 the full sequence, in order, each step observed', async () => {
    const row = await liveAsset('hostA');
    const tomb = await patchRow('hostA', row.id, { upload_status: 'tombstoned' });
    assert.equal(tomb.status, 204, JSON.stringify(tomb.body));
    assert.equal(rowState(row.id).status, 'tombstoned');
    const bytes = await storageDelete([row.object_key], { as: 'hostA' });
    assert.equal(bytes.status, 200, JSON.stringify(bytes.body));
    assert.deepEqual(bytes.body.map((e) => e.name), [row.object_key],
      'the service reports the object it collected, and it collected this one');
    assert.equal(objectPresent(row.object_key), false);
    const gone = await deleteRow('hostA', row.id);
    assert.equal(gone.status, 204, JSON.stringify(gone.body));
    const after = await selectRow('hostA', row.id, 'id');
    assert.deepEqual(after.body, [], 'the row is still selectable after its delete answered 204');
  });

  test('DEL-03 a tombstoned row is terminal in both directions, and still removable afterwards', async () => {
    const row = await liveAsset('hostA');
    assert.equal((await patchRow('hostA', row.id, { upload_status: 'tombstoned' })).status, 204);
    for (const upload_status of ['ready', 'staged']) {
      const r = await patchRow('hostA', row.id, { upload_status });
      assert.equal(r.status, 403, `${upload_status}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, '42501', upload_status);
      assert.match(r.body.message, /a tombstoned wedding asset cannot change state/, upload_status);
    }
    assert.equal(rowState(row.id).status, 'tombstoned');
    // Terminal means no availability claim, not unremovable: the two remaining steps still work.
    const bytes = await storageDelete([row.object_key], { as: 'hostA' });
    assert.deepEqual(bytes.body.map((e) => e.name), [row.object_key]);
    assert.equal((await deleteRow('hostA', row.id)).status, 204);
  });

  test('DEL-04 a stranger\'s delete of a row is a 204 that deletes nothing, so the refusal is the re-read', async () => {
    const row = inserted(await stageRow('hostA', weddingOf('hostA')));
    const r = await deleteRow('hostB', row.id);
    assert.equal(r.status, 204, 'the transport answered differently than measured');
    const still = await selectRow('hostA', row.id, 'id,upload_status');
    assert.equal(still.body?.[0]?.id, row.id,
      'RLS matched no row for the stranger, yet the owner\'s own row is gone');
    assert.equal(still.body[0].upload_status, 'staged');
    const seenByStranger = await selectRow('hostB', row.id, 'id');
    assert.deepEqual(seenByStranger.body, [], 'the stranger can now see the row it could not delete');
    await dropStaged('hostA', row);
  });

  test('DEL-05 a staged row is deletable without ever having been confirmed, so an abandoned upload leaves no residue', async () => {
    // Measured by probe #4 (`DELETE-STAGED-NO-PREFER` 204, then the row counted zero). This is the
    // host's "cancel this upload" path, and the guard that protects a `ready` row deliberately does not
    // protect this one.
    const row = inserted(await stageRow('hostA', weddingOf('hostA')));
    assert.equal((await deleteRow('hostA', row.id)).status, 204);
    assert.deepEqual((await selectRow('hostA', row.id, 'id')).body, []);
  });
});

// ---------------------------------------------------------------------------
// A11 — the storage metadata is not a REST surface
// ---------------------------------------------------------------------------
describe('S6 METADATA', () => {
  test('A11 no client reaches storage.objects or storage.buckets over REST, in any of the four doors', async () => {
    const dotted = await asAnon('GET', 'storage.objects', 'select=name');
    assert.equal(dotted.status, 404, JSON.stringify(dotted.body));
    assert.equal(dotted.body.code, 'PGRST205');
    assert.match(dotted.body.message, /Could not find the table 'public\.storage\.objects'/,
      'PostgREST looked for a *relation named with a dot* in its exposed schemas — the storage schema is not one');
    const buckets = await rest('GET', 'storage.buckets', 'select=id', undefined, { as: 'hostA' });
    assert.equal(buckets.status, 404, JSON.stringify(buckets.body));
    assert.equal(buckets.body.code, 'PGRST205');

    const namedProfile = await fetch(`${url}/rest/v1/objects?select=name`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${tokenOf('hostA')}`, 'Accept-Profile': 'storage' },
    });
    assert.equal(namedProfile.status, 406);
    const profile = await json(namedProfile);
    assert.equal(profile.code, 'PGRST106');
    assert.match(profile.hint, /Only the following schemas are exposed: public, api/,
      'this is the config.toml schema list answering, which is the reachability half of the design');

    const rpc = await fetch(`${url}/rest/v1/rpc/protect_delete`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${tokenOf('hostA')}`,
        'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(rpc.status, 404);
    assert.equal((await json(rpc)).code, 'PGRST202');
  });

  test('A11b the tables and the policies do exist, so every refusal above is about reachability, not absence', async () => {
    assert.equal(sqlRows(`select to_regclass('storage.objects')::text`)[0], 'storage.objects');
    assert.equal(sqlRows(`select to_regclass('storage.buckets')::text`)[0], 'storage.buckets');
    const policies = sqlRows(`select policyname from pg_policies where schemaname = 'storage'
                              and tablename = 'objects' order by policyname`);
    assert.equal(policies.length, 3,
      `the Stage 6 bucket has ${policies.length} storage.objects policies, the design says three: ${policies}`);
    // No UPDATE policy is the whole of the overwrite refusal, so its absence is asserted as a fact.
    const updatePolicies = sqlRows(`select count(*)::text from pg_policies where schemaname = 'storage'
                                    and tablename = 'objects' and cmd = 'UPDATE'`)[0];
    assert.equal(updatePolicies, '0',
      'an UPDATE policy exists, so A7 no longer proves what it claims to');
    const row = await liveAsset('hostA');
    assert.equal(objectPresent(row.object_key), true);
    await removeAsset('hostA', row);
  });

  test('A11c neither is the policy catalog, in either spelling a client could try', async () => {
    const plain = await rest('GET', 'pg_policies', 'schemaname=eq.storage', undefined, { as: 'hostA' });
    assert.equal(plain.status, 404, JSON.stringify(plain.body));
    assert.equal(plain.body.code, 'PGRST205');
    assert.match(plain.body.message, /Could not find the table 'public\.pg_policies'/);
    const dotted = await rest('GET', 'storage.policies', 'policyname=eq.x', undefined, { as: 'hostA' });
    assert.equal(dotted.status, 404, JSON.stringify(dotted.body));
    assert.equal(dotted.body.code, 'PGRST205');
  });
});

// ---------------------------------------------------------------------------
// Helpers the cases above share, kept below them so each case reads as a claim
// ---------------------------------------------------------------------------

const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** A staged row with bytes at the minted key, confirmed ready, with the claims the confirmation reads. */
async function liveAsset(who) {
  const row = inserted(await stageRow(who, weddingOf(who),
    { mime_type: 'image/png', size_bytes: PNG.length }));
  const up = await storagePut(row.object_key, PNG, 'image/png', { as: who });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const confirm = await patchRow(who, row.id, { upload_status: 'ready' }, { represent: true });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  assert.equal(confirm.body[0].upload_status, 'ready');
  return row;
}

/** A staged row that never had bytes: the row is directly deletable (measured by probe #4). */
async function dropStaged(who, row) {
  const r = await deleteRow(who, row.id);
  assert.equal(r.status, 204, JSON.stringify(r.body));
  assert.deepEqual((await selectRow(who, row.id, 'id')).body, [],
    `teardown of ${row.id} answered success but left the row`);
}

/** The product's removal order, asserted step by step so a leak names itself instead of accumulating. */
async function removeAsset(who, row) {
  const tomb = await patchRow(who, row.id, { upload_status: 'tombstoned' });
  assert.equal(tomb.status, 204, JSON.stringify(tomb.body));
  const bytes = await storageDelete([row.object_key], { as: who });
  assert.equal(bytes.status, 200, JSON.stringify(bytes.body));
  assert.equal(objectPresent(row.object_key), false, `${row.object_key}: bytes survived their tombstone`);
  const gone = await deleteRow(who, row.id);
  assert.equal(gone.status, 204, JSON.stringify(gone.body));
  assert.deepEqual((await selectRow(who, row.id, 'id')).body, [],
    `teardown of ${row.id} answered success but left the row`);
}
