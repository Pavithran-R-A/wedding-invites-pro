// Stage 7 §S7-6 — the family approval workflow, qualified over the transport the product uses.
//
// `supabase/tests/stage7/80_family_review.sql` and `90_review_boundary.sql` prove the workflow with
// `SET ROLE` inside psql, on a cluster built from zero, and they do the deeper half: the state
// machine's biconditionals, the digest arithmetic, the snapshot's immutability under a direct write,
// the canary rows a reviewer must never see. What that pair cannot see is the transport. It never had
// Kong turning an API key into a role, never had PostgREST resolving a call by signature before any
// grant is consulted, never had a credential that can only arrive as a request header, and never had
// the answer to "what does a caller who is not the host and not a reviewer actually receive".
//
// So this file is the transport, and — the rule this repository has kept since Stage 3 — every
// expectation in it is a measurement taken *before* an assertion was written. Five throwaway probes
// against this project's own stack produced the shapes below, each ending in a residue census:
//
//   q7-logs/s7-http-probe-discovery-02.log  the doors, the grant matrix, expiry, revoke, the queue
//   q7-logs/s7-http-probe-discovery-03.log  the answer sequence in the product's own order
//   q7-logs/s7-http-probe-discovery-04.log  the feedback row's real columns, the successor rule
//   q7-logs/s7-http-probe-discovery-05.log  every refusal's status and both accept boundaries
//   q7-logs/s7-http-probe-discovery-06.log  guest housekeeping against a live review credential
//
// Four measurements reversed what a reader of the design would predict, and each of them changed a
// test rather than a comment:
//
//   * A refused review credential is not a refusal. Every bad credential at the review door — absent,
//     empty, 42 characters, 44, padded with `=`, containing `+`, a well-formed string that was never
//     minted, a *guest* credential, a revoked one, an expired one, an answered one — answers
//     **200 `{"available": false}`**, byte-identical in all cases (`D-03`, `D-04`). Asserting 401 or
//     403 would have failed for the right reason; asserting a *distinguishable* status for any of them
//     would have asserted an existence oracle that the design does not have.
//   * `anon` and a stranger authenticated caller are refused at different layers, with different
//     numbers: the three host verbs answer **401 code 42501 `permission denied for function …`** to the
//     publishable key and **403 code 42501** with the verb's own sentence to another host's JWT
//     (`G-01`, `G-03`). `service_role` never reaches a Stage 7 function at all: **403 `permission
//     denied for schema api`** — the schema, not the function, because it has no USAGE there.
//   * The credential has exactly one channel, and the other channels are refused *before* the door
//     while echoing the value: as a body key the router answers 404 PGRST202 naming a parameter that
//     does not exist, and in a query string **400 PGRST100 whose message contains the credential**
//     (`T-02`, `T-03`). That echo is the reason `api.resolve_family_review()` takes no argument — a
//     volatile zero-argument function has no query string to leak through, and no URL to be logged.
//   * `link_state` in the host's queue describes the *credential*, not the ask. A request answered
//     three minutes ago still reports `live` while its unrevoked link exists (`Q-03`), and the door
//     still refuses it (`D-06`). A reader who took `live` to mean "a reviewer can still answer" would
//     be wrong, so the pair is asserted together rather than separately.
//
// Also measured rather than assumed: PostgREST needs `Content-Profile: api` for every one of these
// calls (`T-01`); header names arrive case-folded, so `X-Review-Token` opens the door too (`D-05`);
// the two length limits bite at 121 and 2001 and accept 120 and 2000, with the note stored at its
// full length rather than truncated (`K-05`, `A-08`); a padded reviewer name is trimmed where it is
// stored and where it is echoed (`K-03`); and a host's guest-link housekeeping — publish, rotate,
// revoke the publication — withdraws no family review link, while a review answer revokes no
// publication (`C-03`).
//
// The first execution of this file — `q7-logs/s7-http-battery-standalone-01.log`, which is the run that
// turned the last few forecast values into measurements — passed 58 of its 61 cases, and all three
// failures were this file's own bugs rather than the product's: a `{43}` pattern applied to a message
// that *contains* a credential instead of being one (`T-03`), a case that read "the current version"
// after an earlier case had moved it (`X-03`), and a two-row catalogue read handed to a one-row helper
// (`C-04`). They are recorded here because the facts they forced are now part of what the file asserts:
// the router's echo text is `failed to parse filter (<credential>)`, an ask against an older frozen
// version is allowed and shows the reviewer that version, and both guest verbs take `p_wedding_id uuid`
// and nothing else. A battery that never disagreed with its author would not have found them.
//
// What this file does not claim: no browser opened a review link, so the mobile, keyboard and
// screen-reader half of the Stage 7 directive is the browser tier's job, and the raw-credential
// claim about *logs* is qualified here only for the database and for the responses a caller can read.
// `private.audit_events` holds zero rows before and after the whole sequence (`C-05`), which is the
// measured fact — the Stage 7 verbs write no audit row today, and that is stated as a limitation in
// the Stage 7 audit section rather than presented as a control.
//
// Not part of `npm test`; run it with `bash supabase/tests/api/run.sh`, which refuses a stack that is
// not this repository's own, requires the migration ledger to match `supabase/migrations`, runs each
// suite serially against the shared database, and fails the run if a row count moves. Its own
// `after()` clears this run's rows child-before-parent — `approval_feedback`, then `access_tokens`,
// then `approval_requests`, then the publication, version and wedding the ask points at — and prints
// the census, because a leak here would otherwise be inherited by the next suite as a defect.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

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

const RUN_TAG = process.env.STAGE7_HTTP_RUN_TAG
  ?? `s7http-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// Interpolated into trusted cleanup statements and into SQL reads, so an inherited value is accepted
// only in the shape this file generates.
if (!/^[a-z0-9_-]+$/.test(RUN_TAG)) {
  throw new Error(`refusing to run: STAGE7_HTTP_RUN_TAG=${RUN_TAG} is not a run tag`);
}

/** A minted review credential: 32 random bytes, base64url, no padding. Measured length 43. */
const CRED = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Well-formed, and belonging to nothing in this database — the shape an existence oracle would have
 *  to answer differently from a real id for the oracle to exist. */
const NOT_A_WEDDING = '00000000-0000-4000-8000-000000000000';
const NOT_A_VERSION = '11111111-1111-4111-8111-111111111111';
const NOT_A_REQUEST = '22222222-2222-4222-8222-222222222222';
const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}`;

/** Anything this file prints or puts in an assertion message goes through here first. The rule is the
 *  one the runners use: mask the capture, never relax the check. (`s7-http-probe-discovery-06.log`
 *  shows why a bare 43-char scan is not sufficient evidence either way: two of its matches are foreign
 *  key *constraint names*, not credentials.) */
const shown = (value) => String(value).replace(/[A-Za-z0-9_-]{43}/g, '[REDACTED-43]');

// ---------------------------------------------------------------------------
// The measured shapes, named once so a drift says which one moved.
// ---------------------------------------------------------------------------
const ASK_KEYS = ['expires_at', 'request_id', 'review_token'];
const REVIEW_KEYS = ['expires_at', 'invitation', 'request_id', 'requested_at',
  'reviewer_display_name', 'section_keys', 'version_number'];
const INVITATION_KEYS = ['closing', 'design_template', 'event_notes', 'events', 'family_introduction',
  'language', 'people', 'sections', 'style', 'title', 'tradition_pack', 'welcome'];
const SECTION_KEYS = ['ceremonies', 'closing', 'event_notes', 'family', 'family_introduction', 'welcome'];
const ANSWER_KEYS = ['feedback_id', 'recorded', 'responded_at', 'status'];
const REVOKE_KEYS = ['credential_revoked', 'request_id', 'status', 'was_pending'];
const QUEUE_KEYS = ['history', 'invalidated_at', 'link_expires_at', 'link_last_used_at', 'link_state',
  'request_id', 'requested_at', 'responded_at', 'reviewer_display_name', 'status', 'version_id',
  'version_number'];
const HISTORY_KEYS = ['author_label', 'created_at', 'decision', 'id', 'kind', 'message', 'section_key'];
const UNAVAILABLE = { available: false };
const NOT_RECORDED = { recorded: false, reason: 'unavailable' };

/** The five sentences the workflow raises, transcribed from the probe logs rather than from the
 *  migration, because the product's promise to a caller is the string, not the source. */
const SAY = {
  decision: 'the review decision is not one this product records',
  label: 'say who is answering, in their own words',
  note: 'a request for changes needs a note saying what to change',
  noteLong: 'that note is too long to record',
  section: 'that note does not name a section of this invitation',
  sectionLong: 'that section reference is too long',
  name: 'name the reviewer you are asking',
  nameLong: 'that reviewer name is too long to record',
  expiry: 'a review link must be given a time in the future',
  notThisVersion: 'that version is not a version of this wedding',
  notThisWedding: 'the caller may not ask for a review of this wedding',
  notWithdraw: 'the caller may not withdraw this review request',
  notRead: 'the caller may not read these reviews',
};

function sqlRows(query) {
  const out = execFileSync('docker', ['exec', '-i', DB_CONTAINER,
    'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-F', '|', '-c', query],
  { encoding: 'utf8' });
  return out.split(/\r?\n/).filter((line) => line.length > 0);
}

/** A one-row read. The suites before this one printed SQL errors and carried on; a census that cannot
 *  be read is not a pass, so a missing row fails here with the query, never with `undefined`. */
function sqlCell(query, what) {
  const rows = sqlRows(query);
  assert.equal(rows.length, 1, `${what} did not read exactly one row: ${shown(JSON.stringify(rows))}`);
  return rows[0];
}

const people = {};
const tokenOf = (who) => people[who].token;
const uidOf = (who) => people[who].userId;
const weddingOf = (who) => people[who].weddingId;
const versionOf = (who) => people[who].versionId;
const WHO = ['hostA', 'hostB'];

/** Every credential this run mints, for the one census test that has to see all of them. */
const minted = [];

async function signUp(who) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: emailFor(who), password: PASSWORD });
  assert.equal(error, null, `signup failed for ${who}`);
  assert.ok(data.session, 'expected a session immediately');
  const { data: fresh } = await c.auth.getSession();
  return { client: c, userId: data.user.id, token: fresh.session.access_token };
}

async function call(method, path, { body, bearer = anonKey, headers = {} } = {}) {
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
  return { status: res.status, body: parsed };
}

/** An RPC the way the product's client sends one: `api` profile, POST, JSON. `profile: null` drops the
 *  header, which is the case `T-01` measures rather than the case any test should accidentally be. */
async function rpc(name, args, { as = 'anon', headers = {}, profile = 'api' } = {}) {
  const bearer = as === 'anon' ? anonKey : as === 'service' ? serviceKey : tokenOf(as);
  const all = { ...headers };
  if (profile) all['Content-Profile'] = profile;
  return call('POST', `/rest/v1/rpc/${name}`, { body: args, bearer, headers: all });
}

const open = (credential, opts = {}) => rpc('resolve_family_review', {}, {
  ...opts, headers: credential === undefined ? opts.headers ?? {}
    : { 'x-review-token': credential, ...opts.headers ?? {} } });

const answer = (credential, args, opts = {}) => rpc('submit_family_review', args, {
  headers: { 'x-review-token': credential, ...opts.headers ?? {} }, ...opts });

/** A host asking one named relative about one frozen version. Every mint this file makes goes through
 *  here, so the census in `C-01` counts asks the product actually performed. */
async function mint(who, name, { versionId = versionOf(who), expiresAt } = {}) {
  const args = { p_wedding_id: weddingOf(who), p_version_id: versionId, p_reviewer_display_name: name };
  if (expiresAt !== undefined) args.p_expires_at = expiresAt;
  const res = await rpc('request_family_review', args, { as: who });
  assert.equal(res.status, 200, `the host could not ask: ${shown(JSON.stringify(res.body))}`);
  const entry = {
    as: who, requestId: res.body.request_id, token: res.body.review_token,
    expiresAt: res.body.expires_at, name, bodyKeys: Object.keys(res.body).sort(),
  };
  assert.match(entry.token, CRED, 'the minted credential is not the measured shape');
  minted.push(entry);
  return entry;
}

/** The guest address is `/i/` plus the credential — three characters of prefix. Spelled once, in the
 *  same shape `stage3_publication.test.mjs` uses, because a second publish of a live wedding answers
 *  `path: null` rather than re-disclosing the string, so only the first publish can be read this way. */
const PATH_PREFIX = '/i/';
const guestTokenOf = (path) => {
  assert.match(path, /^\/i\/[A-Za-z0-9_-]{43}$/);
  return path.slice(PATH_PREFIX.length);
};

/** One field of one row, read as the trusted local role. Values returned here are database facts, so
 *  they are masked before they can reach a failure message. */
const cell = (query, what) => sqlCell(query, what);

/** The whole-database counts, taken before this file writes anything, so the teardown can prove it
 *  gave everything back. A scoped census would be vacuous here: the rows it scopes by are the very
 *  rows the teardown deletes, so a leak would fall outside its own `where` clause. */
let BASELINE = null;
const censusQuery = `select 'approval_requests='||count(*) from public.approval_requests
  union all select 'approval_feedback='||count(*) from public.approval_feedback
  union all select 'access_tokens='||count(*) from private.access_tokens
  union all select 'publications='||count(*) from public.publications
  union all select 'invitation_versions='||count(*) from public.invitation_versions
  union all select 'weddings='||count(*) from public.weddings
  union all select 'invitation_drafts='||count(*) from public.invitation_drafts
  union all select 'auth.users='||count(*) from auth.users
  union all select 'audit_events='||count(*) from private.audit_events`;
const census = () => Object.fromEntries(sqlRows(censusQuery).map((r) => r.split('=')));

before(async () => {
  BASELINE = census();

  // The surface first, from the catalog rather than from this file's constants. A stack at the Stage 6
  // head has none of these names, and every case below would then be about a function that is not
  // there — reported as 404s that would read exactly like the refusals this file is asserting.
  const names = sqlRows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'api'
                            and p.proname in ('request_family_review','revoke_family_review',
                                              'get_approval_requests','resolve_family_review',
                                              'submit_family_review') order by 1`);
  assert.deepEqual(names, ['get_approval_requests', 'request_family_review', 'resolve_family_review',
    'revoke_family_review', 'submit_family_review'],
    'refusing to run: the api schema does not expose all five Stage 7 doors');

  const zeroArg = cell(`select (pg_get_function_arguments(p.oid) = '')::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'api' and p.proname = 'resolve_family_review'`, 'the door signature');
  assert.equal(zeroArg, 'true',
    'refusing to run: resolve_family_review takes an argument, so a credential could be addressed '
    + 'in a query string and the T-03 case below measures a different product');

  // The stores the census reads. Names and shapes are taken from the live catalog, so a column that
  // moved fails here with its own name instead of failing thirty tests later as a comparison.
  const tokenColumns = cell(`select string_agg(column_name, ',' order by ordinal_position)
      from information_schema.columns where table_schema = 'private'
        and table_name = 'access_tokens'`, 'access_tokens columns');
  assert.equal(tokenColumns,
    'id,token_hash,token_kind,wedding_id,publication_id,household_id,approval_request_id,'
    + 'approval_version_id,expiry_policy,expires_at,revoked_at,last_used_at,created_by_role,created_at',
    `refusing to run: private.access_tokens has the shape ${shown(tokenColumns)}, which is not the `
    + 'hash-only store this file censuses');

  const feedbackColumns = cell(`select string_agg(column_name, ',' order by ordinal_position)
      from information_schema.columns where table_schema = 'public'
        and table_name = 'approval_feedback'`, 'approval_feedback columns');
  assert.ok(feedbackColumns.includes('author_label') && feedbackColumns.includes('field_key')
    && !/token|secret|raw/i.test(feedbackColumns),
    `refusing to run: approval_feedback is ${shown(feedbackColumns)}`);

  assert.equal(cell(`select count(*)::text from pg_indexes where schemaname = 'private'
      and tablename = 'access_tokens' and indexname = 'one_live_token_per_approval_request'`,
    'the one-live-credential index'), '1',
    'refusing to run: one_live_token_per_approval_request is not deployed, so C-02 would be measuring '
    + 'a guarantee no index provides');

  for (const who of WHO) people[who] = await signUp(who);

  // Weddings, drafts and one frozen version each, through the product's own path: the publishable key,
  // the owner's JWT, no privilege. `create_invitation_version` refuses a document that cannot be
  // frozen, so if a host cannot get a version here the cases below would be about a fixture rather
  // than about a review.
  for (const who of WHO) {
    const w = await call('POST', '/rest/v1/weddings', {
      bearer: tokenOf(who),
      body: { owner_user_id: uidOf(who), title: `S7 HTTP ${who} ${RUN_TAG}`, primary_language: 'en' },
      headers: { Prefer: 'return=representation' },
    });
    assert.equal(w.status, 201, `${who} could not create a wedding: ${shown(JSON.stringify(w.body))}`);
    people[who].weddingId = w.body[0].id;

    const d = await call('PATCH', `/rest/v1/invitation_drafts?wedding_id=eq.${people[who].weddingId}`, {
      bearer: tokenOf(who),
      body: {
        content: {
          welcome: 'With the blessings of both families, please join us.',
          family_introduction: 'The Iyer and Raman families invite you.',
          event_notes: null,
          closing: null,
        },
      },
      headers: { Prefer: 'return=representation' },
    });
    assert.equal(d.status, 200, `${who} could not write its draft: ${shown(JSON.stringify(d.body))}`);

    const v = await rpc('create_invitation_version', { p_wedding_id: people[who].weddingId },
      { as: who });
    assert.equal(v.status, 200, `${who} could not freeze v1: ${shown(JSON.stringify(v.body))}`);
    people[who].versionId = v.body.version_id;
    people[who].versionNumber = v.body.version_number;
  }
});

after(async () => {
  // Child before parent, in the order the foreign keys demand. `access_tokens` references the request
  // *and* the version (its constraint is composite over wedding, request and version), and
  // `approval_requests` references `invitation_versions`, so an ask has to go before the version it
  // was pinned to — and the credential before the ask. Proven the hard way by
  // `s7-http-probe-discovery-06.log`, whose own teardown put the request first and was refused.
  const weddings = WHO.map(weddingOf).filter(Boolean);
  if (weddings.length > 0) {
    const ids = weddings.map((w) => `'${w}'::uuid`).join(',');
    for (const stmt of [
      `delete from public.approval_feedback where wedding_id in (${ids})`,
      `delete from private.access_tokens where wedding_id in (${ids})`,
      `delete from public.approval_requests where wedding_id in (${ids})`,
      `delete from public.publications where wedding_id in (${ids})`,
      `delete from private.audit_events where wedding_id in (${ids})`,
      `delete from public.invitation_versions where wedding_id in (${ids})`,
      `delete from public.weddings where id in (${ids})`,
    ]) sqlRows(stmt);
  }
  for (const who of WHO) {
    if (!uidOf(who)) continue;
    const res = await fetch(`${url}/auth/v1/admin/users/${uidOf(who)}`, {
      method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    assert.ok(res.ok, `teardown could not remove a synthetic account (HTTP ${res.status})`);
  }

  // The database is back where this file found it. `run.sh` compares the same kind of counts over the
  // whole serial run; this is the per-file version, so a leak names the file that made it rather than
  // the suite that happened to run last.
  const now = census();
  const moved = Object.keys(BASELINE).filter((k) => BASELINE[k] !== now[k]);
  assert.deepEqual(moved, [],
    `teardown did not give everything back: ${shown(moved.map((k) => `${k} ${BASELINE[k]}->${now[k]}`).join(', '))}`);

  console.log('  residue census after the Stage 7 HTTP teardown (whole database):');
  for (const line of sqlRows(censusQuery)) console.log(shown(`    ${line}`));
});

// ---------------------------------------------------------------------------
// T — the transport: which schema, which verb, which channel
// ---------------------------------------------------------------------------
describe('S7 TRANSPORT', () => {
  test('T-01 a Stage 7 call is reachable through the api profile and through nothing else', async () => {
    const args = {
      p_wedding_id: weddingOf('hostA'), p_version_id: versionOf('hostA'),
      p_reviewer_display_name: 'Profile aunt',
    };
    const none = await rpc('request_family_review', args, { as: 'hostA', profile: null });
    assert.equal(none.status, 404, 'a call with no profile reached the verb');
    assert.equal(none.body.code, 'PGRST202');
    assert.match(none.body.message, /public\.request_family_review/,
      'the profileless refusal names a schema other than public');

    const pub = await rpc('request_family_review', args, { as: 'hostA', profile: 'public' });
    assert.equal(pub.status, 404, 'the public profile resolved a Stage 7 verb');

    const internal = await rpc('request_family_review', args, { as: 'hostA', profile: 'internal_api' });
    assert.equal(internal.status, 406, 'the unexposed schema was addressable');
    assert.equal(internal.body.code, 'PGRST106');
    assert.equal(internal.body.hint, 'Only the following schemas are exposed: public, api',
      'the exposure list moved; this file says what the router answers, not what the design hopes');

    const api = await rpc('request_family_review', args, { as: 'hostA' });
    assert.equal(api.status, 200, `the api profile did not reach the verb: ${shown(JSON.stringify(api.body))}`);
    minted.push({ as: 'hostA', requestId: api.body.request_id, token: api.body.review_token,
      expiresAt: api.body.expires_at, name: 'Profile aunt' });
  });

  test('T-02 the door has no parameter, in either of the two spellings a client might try', async () => {
    const ask = await mint('hostA', 'Channel cousin');
    const asArgument = await rpc('resolve_family_review', { p_token: ask.token });
    assert.equal(asArgument.status, 404);
    assert.equal(asArgument.body.code, 'PGRST202');
    assert.match(asArgument.body.message, /api\.resolve_family_review\(p_token\)/);

    const asBodyHeaderName = await rpc('resolve_family_review', { 'x-review-token': ask.token });
    assert.equal(asBodyHeaderName.status, 404);
    assert.match(asBodyHeaderName.body.message, /x-review-token/);

    const header = await open(ask.token);
    assert.equal(header.status, 200);
    assert.equal(header.body.available, true,
      'the same string arrived by header and did not open the door');
  });

  test('T-03 a credential addressed in a query string is echoed by the router — the reason there is no parameter', async () => {
    const ask = await mint('hostA', 'Query aunt');
    const res = await call('POST', `/rest/v1/rpc/resolve_family_review?x-review-token=${ask.token}`);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'PGRST100');
    // A boolean, not the message: the claim is that the value is *in* there, and putting the message in
    // an assertion's `actual` would reproduce the leak this test is about in the run log. Measured text:
    // `failed to parse filter (<the credential itself>)`, so the value is present inside a longer string
    // rather than being the whole of it — an anchored `{43}` test would have missed it.
    assert.equal(res.body.message.includes(ask.token), true,
      `the router's refusal did not carry the credential it was given: ${shown(res.body.message)}`);

    const get = await call('GET', '/rest/v1/rpc/resolve_family_review',
      { headers: { 'x-review-token': ask.token } });
    assert.equal(get.status, 404, 'a volatile function answered a GET');
    assert.equal(get.body.code, 'PGRST202');
  });

  test('T-04 both reviewer doors open with nothing but the publishable key', async () => {
    const ask = await mint('hostA', 'No account aunt');
    const noSession = await call('POST', '/rest/v1/rpc/resolve_family_review', {
      body: {}, headers: { 'Content-Profile': 'api', 'x-review-token': ask.token },
    });
    assert.equal(noSession.status, 200, 'an anonymous open did not reach the door');
    assert.equal(noSession.body.available, true, 'the publishable key could not open a live link');

    const answered = await call('POST', '/rest/v1/rpc/submit_family_review', {
      body: { p_decision: 'approved', p_reviewer_label: 'No account aunt', p_message: null,
        p_section_key: null },
      headers: { 'Content-Profile': 'api', 'x-review-token': ask.token },
    });
    assert.equal(answered.status, 200, `an anonymous answer did not reach the door: ${shown(JSON.stringify(answered.body))}`);
    assert.equal(answered.body.recorded, true, 'the publishable key could not record a decision');
  });

  test('T-05 the header name is case-folded by the router, so a browser that capitalises it still works', async () => {
    const ask = await mint('hostA', 'Capital cousin');
    const res = await rpc('resolve_family_review', {}, { headers: { 'X-Review-Token': ask.token } });
    assert.equal(res.body.available, true, 'a capitalised header did not open a live link');
    const mixed = await rpc('resolve_family_review', {}, { headers: { 'X-REVIEW-TOKEN': ask.token } });
    assert.equal(mixed.body.available, true, 'an all-caps header did not open a live link');
  });
});

// ---------------------------------------------------------------------------
// G — who may call what, measured at the layer that actually stops them
// ---------------------------------------------------------------------------
describe('S7 CALLER MATRIX', () => {
  const HOST_VERBS = [
    ['request_family_review', { p_wedding_id: null, p_version_id: null, p_reviewer_display_name: null,
      p_expires_at: null }],
    ['revoke_family_review', { p_request_id: null }],
    ['get_approval_requests', { p_wedding_id: null }],
  ];

  for (const [name, args] of HOST_VERBS) {
    test(`G-01 anon is refused ${name} at the function, with 401 and the grant sentence`, async () => {
      const res = await rpc(name, args);
      assert.equal(res.status, 401, `anon reached ${name}`);
      assert.equal(res.body.code, '42501');
      assert.equal(res.body.message, `permission denied for function ${name}`);
    });
  }

  test('G-02 service_role is stopped at the schema, which is where the wrappers are not exposed', async () => {
    for (const [name, args] of HOST_VERBS) {
      const res = await rpc(name, args, { as: 'service' });
      assert.equal(res.status, 403, `service_role reached ${name}`);
      assert.equal(res.body.code, '42501');
      assert.equal(res.body.message, 'permission denied for schema api',
        `${name} was refused at a layer other than the schema`);
    }
  });

  test('G-03 another host is refused by name, in all three of its own sentences', async () => {
    const ask = await rpc('request_family_review', { p_wedding_id: weddingOf('hostB'),
      p_version_id: versionOf('hostB'), p_reviewer_display_name: 'Wrong host' }, { as: 'hostA' });
    assert.equal(ask.status, 403, 'host A asked about host B');
    assert.equal(ask.body.code, '42501');
    assert.equal(ask.body.message, SAY.notThisWedding);

    const own = await mint('hostA', 'Withdraw cousin');
    const foreign = await rpc('revoke_family_review', { p_request_id: own.requestId }, { as: 'hostB' });
    assert.equal(foreign.status, 403, 'host B withdrew host A');
    assert.equal(foreign.body.message, SAY.notWithdraw);
    assert.equal(sqlCell(`select status from public.approval_requests where id='${own.requestId}'::uuid`,
      'the withdrawn-trying request'), 'pending', 'the refusal still moved the row');

    const queue = await rpc('get_approval_requests', { p_wedding_id: weddingOf('hostA') }, { as: 'hostB' });
    assert.equal(queue.status, 403, 'host B read host A');
    assert.equal(queue.body.message, SAY.notRead);

    // A well-formed uuid belonging to no wedding reads the same as host B's: the refusal is an
    // ownership answer, not a lookup, so a caller cannot probe which wedding ids exist.
    const unborn = await rpc('get_approval_requests', { p_wedding_id: NOT_A_WEDDING }, { as: 'hostA' });
    assert.deepEqual({ status: unborn.status, code: unborn.body.code, message: unborn.body.message },
      { status: queue.status, code: queue.body.code, message: queue.body.message },
      'a nonexistent wedding was distinguishable from another family\'s — an existence oracle over '
      + 'which weddings exist');
    assert.equal(unborn.status, 403);
  });

  test('G-04 null arguments are an ownership question first, and never a crash', async () => {
    const res = await rpc('request_family_review',
      { p_wedding_id: null, p_version_id: null, p_reviewer_display_name: null }, { as: 'hostA' });
    assert.equal(res.status, 403, `null arguments were not the ownership refusal: ${shown(JSON.stringify(res.body))}`);
    assert.equal(res.body.code, '42501');
    assert.equal(res.body.message, SAY.notThisWedding);
    const res2 = await rpc('submit_family_review',
      { p_decision: null, p_reviewer_label: null, p_message: null, p_section_key: null });
    assert.equal(res2.status, 400, 'a door with no credential accepted nulls');
    assert.equal(res2.body.message, SAY.decision, 'nulls at the answer door took the wrong refusal');
  });

  test('G-05 the approval tables stay off the client, in the owner\'s own session', async () => {
    const ask = await mint('hostA', 'Table aunt');
    const patch = await call('PATCH', `/rest/v1/approval_requests?id=eq.${ask.requestId}`, {
      body: { status: 'approved' }, bearer: tokenOf('hostA'),
      headers: { Prefer: 'return=representation' },
    });
    assert.equal(patch.status, 403, 'a host approved its own ask over the table');
    assert.equal(patch.body.code, '42501');
    assert.match(patch.body.hint, /GRANT UPDATE ON public\.approval_requests/,
      'the refusal stopped naming the grant, which is the sentence that tells a reader why');
    assert.equal(sqlCell(`select status from public.approval_requests where id='${ask.requestId}'::uuid`,
      'the patched request'), 'pending');

    for (const [method, rel, body, grant] of [
      ['POST', 'approval_feedback', { wedding_id: weddingOf('hostA'), feedback_kind: 'decision' }, 'INSERT'],
      ['DELETE', `approval_feedback?wedding_id=eq.${weddingOf('hostA')}`, undefined, 'DELETE'],
    ]) {
      const res = await call(method, `/rest/v1/${rel}`, { body, bearer: tokenOf('hostA') });
      assert.equal(res.status, 403, `the host could ${grant} approval_feedback directly`);
      assert.equal(res.body.code, '42501');
      assert.match(res.body.hint, new RegExp(`GRANT ${grant} ON public\\.approval_feedback`));
    }

    const tokens = await call('GET', '/rest/v1/access_tokens?select=*', { bearer: tokenOf('hostA') });
    assert.equal(tokens.status, 404, 'private.access_tokens is in the exposed catalogue');
    assert.equal(tokens.body.code, 'PGRST205');
  });

  test('G-06 a stranger\'s read of the approval table is an empty list, not a smaller row set', async () => {
    await mint('hostA', 'Invisible aunt');
    const own = await call('GET', '/rest/v1/approval_requests?select=id', { bearer: tokenOf('hostA') });
    const stranger = await call('GET', '/rest/v1/approval_requests?select=id', { bearer: tokenOf('hostB') });
    assert.equal(own.status, 200);
    assert.ok(own.body.length >= 1, 'the owner cannot see its own asks, so the next assertion proves nothing');
    assert.equal(stranger.status, 200);
    assert.deepEqual(stranger.body, [], 'a stranger read another family\'s asks');
  });
});

// ---------------------------------------------------------------------------
// K — the ask: one host, one frozen version, one named relative, one link
// ---------------------------------------------------------------------------
describe('S7 ASK', () => {
  test('K-01 an ask returns three fields, mints one credential, and stores only its digest', async () => {
    const ask = await mint('hostA', 'Digest aunt');
    assert.deepEqual(ask.bodyKeys, ASK_KEYS,
      `the ask returned ${shown(JSON.stringify(ask.bodyKeys))}`);
    assert.match(ask.requestId, UUID);
    assert.match(ask.token, CRED);

    const rows = sqlRows(`select 'kind=' || token_kind || ' revoked=' || (revoked_at is not null)::text
        || ' digest_matches=' || (token_hash = encode(digest('${ask.token}', 'sha256'), 'hex'))::text
        || ' hex64=' || (token_hash ~ '^[0-9a-f]{64}$')::text
      from private.access_tokens where approval_request_id = '${ask.requestId}'::uuid`);
    assert.deepEqual(rows, ["kind=approval_review revoked=false digest_matches=true hex64=true"],
      `the stored credential is not the digest of the one returned: ${shown(JSON.stringify(rows))}`);

    // The raw string is never a value in any row this run can reach. Checked for the token itself, so
    // the claim is about the credential rather than about a pattern that other data can match.
    const anywhere = sqlCell(`select count(*)::text from (
        select reviewer_display_name as t, coalesce(reviewer_contact_text,'') as c
          from public.approval_requests where wedding_id = '${weddingOf('hostA')}'::uuid
        union all select coalesce(message,''), coalesce(author_label,'')
          from public.approval_feedback where wedding_id = '${weddingOf('hostA')}'::uuid
        union all select token_hash, coalesce(approval_request_id::text,'')
          from private.access_tokens where wedding_id = '${weddingOf('hostA')}'::uuid
      ) x where x.t = '${ask.token}' or x.c = '${ask.token}'`, 'the raw-credential scan');
    assert.equal(anywhere, '0', 'a raw review credential was stored as a value');

    assert.equal(sqlCell(`select coalesce(reviewer_contact_text::text,'NULL') from public.approval_requests
        where id = '${ask.requestId}'::uuid`, 'the contact column'), 'NULL',
      'the ask recorded a contact channel it never collected');
  });

  test('K-02 the default lifetime is fourteen days, and the host is told the instant the row holds', async () => {
    const ask = await mint('hostA', 'Fortnight aunt');
    // The expiry lives on the credential, the asked-at moment on the request, and both are written by
    // one call in one transaction, so `now()` is the same instant for both and the span is exact.
    assert.equal(cell(`select count(*)::text || '/1' from private.access_tokens
        where approval_request_id = '${ask.requestId}'::uuid`, 'the ask\'s credentials'), '1/1',
      'an ask minted more than one credential, so the span below is not the link the host was given');
    const span = cell(`select ((select t.expires_at from private.access_tokens t
          where t.approval_request_id = r.id) - r.requested_at)::text
        from public.approval_requests r where r.id = '${ask.requestId}'::uuid`, 'the default lifetime');
    assert.equal(span, '14 days', `the default link lifetime is ${span}, not the documented fortnight`);
    const stored = cell(`select (extract(epoch from expires_at) * 1000)::bigint::text
        from private.access_tokens where approval_request_id = '${ask.requestId}'::uuid`, 'the expiry');
    assert.equal(stored, String(Date.parse(ask.expiresAt)),
      'the expires_at the host was told is not the instant stored on the credential');
  });

  test('K-03 the name is stored trimmed, and the door echoes the same words the host typed', async () => {
    const ask = await mint('hostA', '  Padded aunt  ');
    assert.equal(sqlCell(`select '[' || reviewer_display_name || '] len=' || length(reviewer_display_name)
        from public.approval_requests where id = '${ask.requestId}'::uuid`, 'the stored name'),
      '[Padded aunt] len=11', 'a padded name was stored as it arrived');
    const opened = await open(ask.token);
    assert.equal(opened.body.review.reviewer_display_name, 'Padded aunt',
      'the reviewer was told a different name than the host wrote');
  });

  test('K-04 the ask is pinned to one version, and that version answers', async () => {
    const ask = await mint('hostA', 'Versioned aunt');
    assert.equal(sqlCell(`select version_id::text from public.approval_requests
        where id = '${ask.requestId}'::uuid`, 'the pinned version'), versionOf('hostA'),
      'the ask did not name the version it was made against');
    const opened = await open(ask.token);
    assert.equal(opened.body.review.version_number, 1, 'the door reported another version');
    assert.equal(opened.body.review.request_id, ask.requestId);
  });

  test('K-05 a name that is not a name, or is too long, is refused before anything is written', async () => {
    const before = sqlCell(`select count(*)::text from public.approval_requests
        where wedding_id = '${weddingOf('hostA')}'::uuid`, 'the ask count');
    for (const [name, message] of [['   ', SAY.name], ['', SAY.name], ['n'.repeat(121), SAY.nameLong]]) {
      const res = await rpc('request_family_review', { p_wedding_id: weddingOf('hostA'),
        p_version_id: versionOf('hostA'), p_reviewer_display_name: name }, { as: 'hostA' });
      assert.equal(res.status, 400, `an invalid reviewer name was accepted: ${shown(name)}`);
      assert.equal(res.body.code, '23514');
      assert.equal(res.body.message, message, `the wrong sentence for ${shown(name)}`);
    }
    const accepted = await rpc('request_family_review', { p_wedding_id: weddingOf('hostA'),
      p_version_id: versionOf('hostA'), p_reviewer_display_name: 'n'.repeat(120) }, { as: 'hostA' });
    assert.equal(accepted.status, 200, 'the documented 120-character name was refused');
    minted.push({ as: 'hostA', requestId: accepted.body.request_id, token: accepted.body.review_token,
      expiresAt: accepted.body.expires_at, name: 'n'.repeat(120) });

    const after = sqlCell(`select count(*)::text from public.approval_requests
        where wedding_id = '${weddingOf('hostA')}'::uuid`, 'the ask count');
    assert.equal(after, String(Number(before) + 1),
      'a refused ask wrote a row; only the accepted one should have moved the count');
  });

  test('K-06 a lifetime in the past is refused, and no dead link is minted', async () => {
    const before = sqlCell(`select count(*)::text from private.access_tokens
        where wedding_id = '${weddingOf('hostA')}'::uuid`, 'the credential count');
    const res = await rpc('request_family_review', { p_wedding_id: weddingOf('hostA'),
      p_version_id: versionOf('hostA'), p_reviewer_display_name: 'Yesterday aunt',
      p_expires_at: new Date(Date.now() - 60000).toISOString() }, { as: 'hostA' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, '23514');
    assert.equal(res.body.message, SAY.expiry);
    assert.equal(sqlCell(`select count(*)::text from private.access_tokens
        where wedding_id = '${weddingOf('hostA')}'::uuid`, 'the credential count'), before,
      'the refusal still minted a credential');
  });

  test('K-07 a version that is not a version of this wedding is refused, named or not', async () => {
    const foreign = await rpc('request_family_review', { p_wedding_id: weddingOf('hostA'),
      p_version_id: versionOf('hostB'), p_reviewer_display_name: 'Cross aunt' }, { as: 'hostA' });
    assert.equal(foreign.status, 403, `a real version of another wedding: ${shown(JSON.stringify(foreign.body))}`);
    assert.equal(foreign.body.code, '42501');
    assert.equal(foreign.body.message, SAY.notThisVersion);

    // The same answer for a well-formed uuid that exists nowhere: a caller cannot use the refusal to
    // learn which version ids are real.
    const invented = await rpc('request_family_review', { p_wedding_id: weddingOf('hostA'),
      p_version_id: '11111111-1111-1111-1111-111111111111', p_reviewer_display_name: 'Ghost aunt' },
    { as: 'hostA' });
    assert.equal(invented.status, 403);
    assert.deepEqual({ status: invented.status, code: invented.body.code, message: invented.body.message },
      { status: foreign.status, code: foreign.body.code, message: foreign.body.message },
      'a nonexistent version was distinguishable from a foreign one — that is an existence oracle');
    assert.equal(sqlCell(`select count(*)::text from public.approval_requests where version_id in
        ('${versionOf('hostB')}'::uuid, '11111111-1111-1111-1111-111111111111'::uuid)`,
      'the cross-version asks'), '0', 'a refused cross-version ask wrote a row');
  });

  test('K-08 asking a second relative does not withdraw the first ask', async () => {
    const one = await mint('hostA', 'First of two');
    const two = await mint('hostA', 'Second of two');
    assert.notEqual(one.requestId, two.requestId);
    const statuses = sqlCell(`select string_agg(status, ',' order by reviewer_display_name)
        from public.approval_requests where reviewer_display_name in ('First of two','Second of two')`,
      'the two asks');
    assert.equal(statuses, 'pending,pending', 'a second ask silently invalidated the first');
    assert.equal((await open(one.token)).body.available, true, 'the first link stopped working');
    assert.equal((await open(two.token)).body.available, true, 'the second link never worked');
  });

  test('K-09 the host\'s own revoke withdraws a pending ask, and the row stays as the record it is', async () => {
    const ask = await mint('hostA', 'Withdrawn aunt');
    const res = await rpc('revoke_family_review', { p_request_id: ask.requestId }, { as: 'hostA' });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), REVOKE_KEYS);
    assert.deepEqual(res.body, { status: 'invalidated', request_id: ask.requestId,
      was_pending: true, credential_revoked: true });
    assert.deepEqual(await open(ask.token), { status: 200, body: UNAVAILABLE },
      'a revoked link still opened the review door');
    const answered = await answer(ask.token, { p_decision: 'approved',
      p_reviewer_label: 'Withdrawn aunt', p_message: null, p_section_key: null });
    assert.deepEqual(answered.body, NOT_RECORDED,
      'a revoked link still recorded an answer');
    assert.equal(sqlCell(`select status || ' ' || coalesce(invalidated_at::text,'NULL')
        from public.approval_requests where id = '${ask.requestId}'::uuid`, 'the revoked ask')
        .split(' ')[0], 'invalidated');
    assert.ok(sqlCell(`select coalesce(invalidated_at::text,'NULL') from public.approval_requests
        where id = '${ask.requestId}'::uuid`, 'the invalidation stamp') !== 'NULL',
      'an invalidated row carries no stamp');
    assert.equal(sqlCell(`select (revoked_at is not null)::text from private.access_tokens
        where approval_request_id = '${ask.requestId}'::uuid`, 'the revoked credential'), 'true');
  });

  test('K-10 withdrawing an ask that does not exist answers the same sentence as someone else\'s', async () => {
    const own = await mint('hostA', 'Ownership aunt');
    const mine = await rpc('revoke_family_review', { p_request_id: own.requestId }, { as: 'hostB' });
    const ghost = await rpc('revoke_family_review',
      { p_request_id: '00000000-0000-0000-0000-000000000000' }, { as: 'hostA' });
    assert.deepEqual({ status: ghost.status, code: ghost.body.code, message: ghost.body.message },
      { status: mine.status, code: mine.body.code, message: mine.body.message },
      'a nonexistent request id was distinguishable from another family\'s — an existence oracle '
      + 'over which wedding has an open ask');
    assert.equal(ghost.status, 403);
    await rpc('revoke_family_review', { p_request_id: own.requestId }, { as: 'hostA' });
  });
});

// ---------------------------------------------------------------------------
// D — the review door: what a link opens, and what it never does
// ---------------------------------------------------------------------------
describe('S7 REVIEW DOOR', () => {
  test('D-01 a live credential opens the frozen document, in the shape the reviewer renders', async () => {
    const ask = await mint('hostA', 'Projection aunt');
    const res = await open(ask.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.available, true);
    assert.deepEqual(Object.keys(res.body.review).sort(), REVIEW_KEYS);
    assert.deepEqual(Object.keys(res.body.review.invitation).sort(), INVITATION_KEYS);
    assert.deepEqual(res.body.review.section_keys, SECTION_KEYS);
    assert.equal(res.body.review.invitation.welcome,
      'With the blessings of both families, please join us.', 'the document is not the one the host wrote');
    assert.equal(res.body.review.invitation.title, `S7 HTTP hostA ${RUN_TAG}`);
  });

  test('D-02 opening the door stamps the credential\'s last use, and nothing else about it', async () => {
    const ask = await mint('hostA', 'Read stamp aunt');
    assert.equal(sqlCell(`select coalesce(last_used_at::text,'NULL') from private.access_tokens
        where approval_request_id = '${ask.requestId}'::uuid`, 'last use before'), 'NULL');
    await open(ask.token);
    assert.notEqual(sqlCell(`select coalesce(last_used_at::text,'NULL') from private.access_tokens
        where approval_request_id = '${ask.requestId}'::uuid`, 'last use after'), 'NULL',
      'the host cannot see that the link was opened, so the product has no review-attention signal');
    assert.equal(sqlCell(`select status from public.approval_requests
        where id = '${ask.requestId}'::uuid`, 'the status after a read'), 'pending',
      'opening a link answered it');
  });

  test('D-03 every unusable credential is the same answer, and it is not an error', async () => {
    const live = await mint('hostA', 'Junk control aunt');
    const cases = {
      'no header': undefined,
      'empty': '',
      '42 characters': 'A'.repeat(42),
      '44 characters': 'A'.repeat(44),
      'padded with =': `${live.token}=`,
      'a + in place of a character': `+${'A'.repeat(42)}`,
      'well formed but never minted': 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe',
    };
    for (const [name, value] of Object.entries(cases)) {
      const res = await open(value);
      assert.equal(res.status, 200, `${name} did not answer 200`);
      assert.deepEqual(res.body, UNAVAILABLE, `${name} answered something other than unavailable`);
    }
    assert.equal((await open(live.token)).body.available, true,
      'the control credential in this case list is not live, so the seven refusals above measured nothing');
  });

  test('D-04 a guest credential at the review door is refused exactly as junk is, and still opens its own door', async () => {
    // This is the one place the file publishes, and it carries two measurements: the cross-kind refusal
    // below, and `s7-http-probe-discovery-06.log`'s finding that publishing does *not* withdraw a live
    // family review link. The review ask is minted first so the publish is the thing being tested.
    const review = await mint('hostA', 'Published over aunt');
    const published = await rpc('publish_invitation_version',
      { p_wedding_id: weddingOf('hostA'), p_version_id: versionOf('hostA') }, { as: 'hostA' });
    assert.equal(published.status, 200, 'the guest link needed for this case could not be published');
    const guest = guestTokenOf(published.body.path);
    assert.match(guest, CRED, 'the guest credential is not the measured shape');

    const atReview = await open(guest);
    assert.deepEqual(atReview.body, UNAVAILABLE, 'a guest credential opened a review');
    const atReviewAnswer = await answer(guest, { p_decision: 'approved', p_reviewer_label: 'A guest',
      p_message: null, p_section_key: null });
    assert.deepEqual(atReviewAnswer.body, NOT_RECORDED, 'a guest credential recorded a review decision');
    assert.equal((await open(guest)).status, 200);

    const ownDoor = await rpc('resolve_public_invitation', {},
      { headers: { 'x-invitation-token': guest } });
    assert.equal(ownDoor.body.available, true,
      'the refused string is not a live guest credential either, so the refusal above proved nothing');

    assert.equal((await open(review.token)).body.available, true,
      'publishing the invitation withdrew the family review link');
    assert.equal(cell(`select (revoked_at is null)::text from private.access_tokens
        where approval_request_id = '${review.requestId}'::uuid`, 'the review credential after publish'),
      'true', 'the publish revoked the review credential while leaving the link usable');
  });

  test('D-05 the other direction: a review credential cannot reach the guest door or its RSVP', async () => {
    const ask = await mint('hostA', 'Review at guest door aunt');
    const guestDoor = await rpc('resolve_public_invitation', {},
      { headers: { 'x-invitation-token': ask.token } });
    assert.deepEqual(guestDoor.body, UNAVAILABLE, 'a review credential opened a public invitation');

    // The kind is stored with the credential, so the refusal is not a hash collision waiting to happen.
    // Scoped to this request rather than to the wedding: D-04 has published a guest credential by now,
    // and a wedding-wide "no public_invitation row" claim would be false for a good reason.
    assert.equal(sqlCell(`select token_kind from private.access_tokens
        where approval_request_id = '${ask.requestId}'::uuid`, 'the kind'), 'approval_review');
    assert.equal(sqlCell(`select count(*)::text from private.access_tokens
        where token_kind = 'public_invitation' and approval_request_id = '${ask.requestId}'::uuid`,
      'the same request under the guest kind'), '0',
      'a review credential was filed under the guest kind');
    assert.equal(sqlCell(`select count(*)::text from private.access_tokens
        where token_kind = 'public_invitation' and approval_request_id is not null`,
      'guest credentials carrying an approval'), '0',
      'a guest credential is filed against an approval request, so the two kinds share a row shape');
  });

  test('D-06 an answered request\'s link closes, and its history is what the host is shown instead', async () => {
    const ask = await mint('hostA', 'Answered then opened aunt');
    await answer(ask.token, { p_decision: 'approved', p_reviewer_label: 'Answered then opened aunt',
      p_message: null, p_section_key: null });
    assert.deepEqual(await open(ask.token), { status: 200, body: UNAVAILABLE },
      'a reviewer could re-read a document they had already answered');
    const queue = await rpc('get_approval_requests', { p_wedding_id: weddingOf('hostA') },
      { as: 'hostA' });
    const row = (queue.body ?? []).find((r) => r.request_id === ask.requestId);
    assert.equal(row.status, 'approved');
    assert.equal(row.history.length, 1);
  });

  test('D-07 a link past its stated expiry closes at both doors, and the queue says so', async () => {
    const expiresAt = new Date(Date.now() + 2000).toISOString();
    const ask = await mint('hostA', 'Soon gone aunt', { expiresAt });
    assert.equal((await open(ask.token)).body.available, true, 'the link never opened while valid');
    await new Promise((r) => setTimeout(r, 3000));
    assert.deepEqual(await open(ask.token), { status: 200, body: UNAVAILABLE },
      'an expired link still opened the review door');
    const refused = await answer(ask.token, { p_decision: 'approved', p_reviewer_label: 'Soon gone aunt',
      p_message: null, p_section_key: null });
    assert.deepEqual(refused.body, NOT_RECORDED, 'an expired link still recorded a decision');
    assert.equal(sqlCell(`select status from public.approval_requests
        where id = '${ask.requestId}'::uuid`, 'the expired ask'), 'pending',
      'expiry was answered as a decision rather than left as an unanswered ask');
    const queue = await rpc('get_approval_requests', { p_wedding_id: weddingOf('hostA') },
      { as: 'hostA' });
    const row = (queue.body ?? []).find((r) => r.request_id === ask.requestId);
    assert.equal(row.link_state, 'expired', 'the host was not told this link had run out');
  });

  test('D-08 the projection carries no credential material, in either direction', async () => {
    const ask = await mint('hostA', 'Leak canary aunt');
    const res = await open(ask.token);
    const text = JSON.stringify(res.body);
    assert.equal(text.includes(ask.token), false, 'the door response contains a credential');
    assert.deepEqual(Object.keys(res.body).sort(), ['available', 'review']);
    for (const name of ['review_token', 'token', 'token_hash', 'path', 'url']) {
      assert.equal(new RegExp(`"${name}"`).test(text), false, `the door names ${name}`);
    }
  });

  test('D-09 the reviewer sees the invitation, and none of the Stage 6 asset boundary or the guest list', async () => {
    const ask = await mint('hostA', 'Boundary aunt');
    const res = await open(ask.token);
    const text = JSON.stringify(res.body.review).toLowerCase();
    for (const word of ['object_key', 'signed_url', 'signed url', 'storage', 'bucket', 'wedding-assets',
      'rsvp', 'household', 'attendance', 'guest_list']) {
      assert.equal(text.includes(word), false, `the review projection names ${word}`);
    }
    for (const key of ['email', 'phone', 'mobile', 'whatsapp']) {
      assert.equal(new RegExp(`"${key}"`).test(text), false, `the review projection carries ${key}`);
    }
    assert.equal(text.includes('reviewer_contact'), false, 'the projection names the contact column');
  });

  test('D-10 one link opens one wedding: the projection never mentions the other family', async () => {
    const ask = await mint('hostA', 'Tenant canary aunt');
    const res = await open(ask.token);
    assert.equal(res.body.review.invitation.title, `S7 HTTP hostA ${RUN_TAG}`);
    assert.equal(JSON.stringify(res.body).includes(`S7 HTTP hostB`), false,
      'a review link disclosed another wedding\'s title');
    assert.equal(res.body.review.request_id, ask.requestId);
  });
});

// ---------------------------------------------------------------------------
// A — the answer: what may be said, and what one answer is allowed to do
// ---------------------------------------------------------------------------
describe('S7 REVIEW ANSWER', () => {
  test('A-01 an approval records one row, moves one request, and returns four fields', async () => {
    const ask = await mint('hostA', 'Approved aunt');
    const res = await answer(ask.token, { p_decision: 'approved', p_reviewer_label: 'Approved aunt',
      p_message: null, p_section_key: null });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ANSWER_KEYS);
    assert.equal(res.body.recorded, true);
    assert.equal(res.body.status, 'approved');
    assert.match(res.body.feedback_id, UUID);

    assert.equal(sqlCell(`select status || ' responded=' || (responded_at is not null)::text
        || ' invalidated=' || coalesce(invalidated_at::text,'NULL')
      from public.approval_requests where id = '${ask.requestId}'::uuid`, 'the answered ask'),
      'approved responded=true invalidated=NULL', 'the state transition is not the one §2.4 defines');
  });

  test('A-02 a request for changes is stored with the reviewer\'s words, pinned to the asked version', async () => {
    const ask = await mint('hostA', 'Padded uncle');
    const res = await answer(ask.token, { p_decision: 'changes_requested',
      p_reviewer_label: '  Padded uncle  ',
      p_message: '  The morning slot for the muurtham is unclear for elders travelling out of town.  ',
      p_section_key: 'ceremonies' });
    assert.equal(res.status, 200, shown(JSON.stringify(res.body)));
    assert.deepEqual(sqlRows(`select 'kind=' || feedback_kind || ' decision=' || coalesce(decision,'-')
        || ' section=' || coalesce(section_key,'-') || ' field=' || coalesce(field_key,'-')
        || ' label=[' || coalesce(author_label,'-') || '] msg=[' || coalesce(message,'-') || ']'
        || ' pinned=' || (version_id = '${versionOf('hostA')}'::uuid)::text
        || ' wedding=' || (wedding_id = '${weddingOf('hostA')}'::uuid)::text
      from public.approval_feedback where request_id = '${ask.requestId}'::uuid`),
      ["kind=decision decision=changes_requested section=ceremonies field=- "
        + 'label=[Padded uncle] msg=[The morning slot for the muurtham is unclear for elders '
        + 'travelling out of town.] pinned=true wedding=true'],
      'the stored feedback row is not the measured shape');
  });

  test('A-03 a second answer is refused, and the first row is the only row', async () => {
    const ask = await mint('hostA', 'Twice aunt');
    await answer(ask.token, { p_decision: 'approved', p_reviewer_label: 'Twice aunt',
      p_message: null, p_section_key: null });
    const replay = await answer(ask.token, { p_decision: 'changes_requested',
      p_reviewer_label: 'Twice aunt', p_message: 'a second thought', p_section_key: null });
    assert.equal(replay.status, 200, 'a replay was an error rather than the product\'s refusal');
    assert.deepEqual(replay.body, NOT_RECORDED);
    const census = sqlCell(`select count(*)::text from public.approval_feedback
        where request_id = '${ask.requestId}'::uuid`, 'the replayed feedback');
    assert.equal(census, '1', 'a replay changed the history');
    assert.equal(sqlCell(`select decision from public.approval_feedback
        where request_id = '${ask.requestId}'::uuid`, 'the surviving decision'), 'approved',
      'the replay overwrote the first answer even though it was refused');
  });

  test('A-04 a decision the product does not record is refused, including a JSON null', async () => {
    const ask = await mint('hostA', 'Vocabulary aunt');
    for (const decision of ['maybe', 'APPROVED', '', null]) {
      const res = await answer(ask.token, { p_decision: decision, p_reviewer_label: 'Vocabulary aunt',
        p_message: null, p_section_key: null });
      assert.equal(res.status, 400, `a decision of ${shown(JSON.stringify(decision))} was accepted`);
      assert.equal(res.body.code, '23514');
      assert.equal(res.body.message, SAY.decision);
    }
    assert.equal(sqlCell(`select status from public.approval_requests
        where id = '${ask.requestId}'::uuid`, 'the asked-after-refusals'), 'pending');
  });

  test('A-05 a partial argument list is resolved by the router before the door is consulted', async () => {
    const ask = await mint('hostA', 'Short list aunt');
    const missing = await rpc('submit_family_review', { p_reviewer_label: 'only a label' },
      { headers: { 'x-review-token': ask.token } });
    assert.equal(missing.status, 404, 'a partial argument list reached the door');
    assert.equal(missing.body.code, 'PGRST202');
    assert.match(missing.body.message, /api\.submit_family_review\(p_reviewer_label\)/);
    const noteless = await answer(ask.token, { p_decision: 'changes_requested',
      p_reviewer_label: 'Short list aunt', p_section_key: null });
    assert.equal(noteless.status, 404, 'omitting p_message is not the same call the door declares');
  });

  test('A-06 who is answering is required, and 120 characters of it is not', async () => {
    const ask = await mint('hostA', 'Label aunt');
    for (const label of ['', '   ', 'l'.repeat(121)]) {
      const res = await answer(ask.token, { p_decision: 'approved', p_reviewer_label: label,
        p_message: null, p_section_key: null });
      assert.equal(res.status, 400, `a label of length ${label.length} was accepted`);
      assert.equal(res.body.code, '23514');
      assert.equal(res.body.message, SAY.label);
    }
    const ok = await answer(ask.token, { p_decision: 'approved', p_reviewer_label: 'l'.repeat(120),
      p_message: null, p_section_key: null });
    assert.equal(ok.status, 200, `the 120-character label was refused: ${shown(JSON.stringify(ok.body))}`);
    assert.equal(ok.body.recorded, true);
  });

  test('A-07 a rejection without a note is refused, and whitespace is not a note', async () => {
    const ask = await mint('hostA', 'Silent dissenter aunt');
    const res = await answer(ask.token, { p_decision: 'changes_requested',
      p_reviewer_label: 'Silent dissenter aunt', p_message: '   ', p_section_key: null });
    assert.equal(res.status, 400);
    assert.equal(res.body.message, SAY.note);
    assert.equal(sqlCell(`select status from public.approval_requests
        where id = '${ask.requestId}'::uuid`, 'the refused rejection'), 'pending');
  });

  test('A-08 the note\'s ceiling is 2000 characters, stored in full rather than truncated', async () => {
    const ask = await mint('hostA', 'Long note aunt');
    const over = await answer(ask.token, { p_decision: 'changes_requested',
      p_reviewer_label: 'Long note aunt', p_message: 'm'.repeat(2001), p_section_key: null });
    assert.equal(over.status, 400, 'a 2001-character note was accepted');
    assert.equal(over.body.message, SAY.noteLong);

    const at = await answer(ask.token, { p_decision: 'changes_requested',
      p_reviewer_label: 'Long note aunt', p_message: 'm'.repeat(2000), p_section_key: 'welcome' });
    assert.equal(at.status, 200, `the 2000-character note was refused: ${shown(JSON.stringify(at.body))}`);
    assert.equal(sqlCell(`select length(message)::text from public.approval_feedback
        where request_id = '${ask.requestId}'::uuid`, 'the stored note'), '2000',
      'the note was not stored at full length, so the reviewer\'s words were changed on the way in');
  });

  test('A-09 a note may only pin itself to a section the frozen snapshot contains', async () => {
    const ask = await mint('hostA', 'Section aunt');
    const opened = await open(ask.token);
    assert.deepEqual(opened.body.review.section_keys, SECTION_KEYS,
      'the door no longer names the sections the guard reads');
    for (const [key, message] of [['not_a_section', SAY.section], ['welcome-x', SAY.section],
      ['k'.repeat(121), SAY.sectionLong]]) {
      const res = await answer(ask.token, { p_decision: 'approved', p_reviewer_label: 'Section aunt',
        p_message: null, p_section_key: key });
      assert.equal(res.status, 400, `a section key of ${shown(key).slice(0, 24)} was accepted`);
      assert.equal(res.body.code, '23514');
      assert.equal(res.body.message, message, `the wrong sentence for ${shown(key).slice(0, 24)}`);
    }
    assert.equal(sqlCell(`select status from public.approval_requests
        where id = '${ask.requestId}'::uuid`, 'the ask after three section refusals'), 'pending',
      'a refused section key still answered the ask');
    assert.equal(sqlCell(`select count(*)::text from public.approval_feedback
        where request_id = '${ask.requestId}'::uuid`, 'feedback after section refusals'), '0');

    const pinned = await answer(ask.token, { p_decision: 'changes_requested',
      p_reviewer_label: 'Section aunt', p_message: 'the heading reads oddly',
      p_section_key: 'ceremonies' });
    assert.equal(pinned.body.recorded, true, 'a legitimate section key was refused');
  });

  test('A-10 an answer with no credential at all is the same refusal as a forged one', async () => {
    const none = await rpc('submit_family_review', { p_decision: 'approved',
      p_reviewer_label: 'Nobody', p_message: null, p_section_key: null });
    assert.equal(none.status, 200, 'the doorless answer was an error rather than a refusal');
    assert.deepEqual(none.body, NOT_RECORDED);
    const forged = await answer('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe', { p_decision: 'approved',
      p_reviewer_label: 'Nobody', p_message: null, p_section_key: null });
    assert.deepEqual(forged.body, none.body, 'a forged credential was answered differently from none');
  });

  test('A-11 two refusals cannot become an answer: the request, the version and the snapshot are inert', async () => {
    const ask = await mint('hostA', 'Inert aunt');
    const before = sqlCell(`select md5(v.snapshot::text) from public.invitation_versions v
        where v.id = '${versionOf('hostA')}'::uuid`, 'the snapshot digest');
    const versions = sqlCell(`select count(*)::text || '/' || max(version_number)::text
        from public.invitation_versions where wedding_id = '${weddingOf('hostA')}'::uuid`, 'the versions');
    for (const body of [
      { p_decision: 'approved', p_reviewer_label: '', p_message: null, p_section_key: null },
      { p_decision: 'changes_requested', p_reviewer_label: 'Inert aunt', p_message: null, p_section_key: null },
      { p_decision: 'approved', p_reviewer_label: 'Inert aunt', p_message: null, p_section_key: 'ghost' },
    ]) {
      await answer(ask.token, body);
    }
    const after = sqlCell(`select md5(v.snapshot::text) from public.invitation_versions v
        where v.id = '${versionOf('hostA')}'::uuid`, 'the snapshot digest');
    assert.equal(after, before, 'a review round changed a frozen snapshot');
    assert.equal(sqlCell(`select count(*)::text || '/' || max(version_number)::text
        from public.invitation_versions where wedding_id = '${weddingOf('hostA')}'::uuid`, 'the versions'),
      versions, 'a review round added a version');
    assert.equal(sqlCell(`select status from public.approval_requests
        where id = '${ask.requestId}'::uuid`, 'the status'), 'pending');
  });

  test('A-12 the reviewer\'s note cannot rewrite the invitation, and the host\'s draft is untouched', async () => {
    const ask = await mint('hostA', 'Rewriter aunt');
    const res = await answer(ask.token, { p_decision: 'changes_requested',
      p_reviewer_label: 'Rewriter aunt', p_message: 'REWRITE THE WHOLE CARD NOW',
      p_section_key: 'welcome' });
    assert.equal(res.body.recorded, true);
    const draft = sqlCell(`select content->>'welcome' from public.invitation_drafts
        where wedding_id = '${weddingOf('hostA')}'::uuid`, 'the draft');
    assert.equal(draft, 'With the blessings of both families, please join us.',
      'a reviewer note reached the host\'s draft');
    // Asserted as absence rather than as a path: the snapshot's own shape is Stage 5's contract, and the
    // claim here is only that the reviewer's words never appear inside it, wherever they would live.
    assert.equal(sqlCell(`select count(*)::text from public.invitation_versions
        where wedding_id = '${weddingOf('hostA')}'::uuid
          and position('REWRITE THE WHOLE CARD NOW' in snapshot::text) > 0`, 'the rewritten snapshots'), '0',
      'a reviewer note reached a frozen snapshot');
    assert.equal(sqlCell(`select count(*)::text from public.approval_feedback
        where request_id = '${ask.requestId}'::uuid and message = 'REWRITE THE WHOLE CARD NOW'`,
      'the note as stored'), '1', 'the note was not kept verbatim where the host will read it');
  });
});

// ---------------------------------------------------------------------------
// Q — the host\'s queue: what a host is told about its own asks
// ---------------------------------------------------------------------------
describe('S7 HOST QUEUE', () => {
  test('Q-01 a wedding with no asks answers an empty list, not an error', async () => {
    const res = await rpc('get_approval_requests', { p_wedding_id: weddingOf('hostB') }, { as: 'hostB' });
    assert.equal(res.status, 200, `an empty queue was an error: ${shown(JSON.stringify(res.body))}`);
    assert.deepEqual(res.body, []);
  });

  test('Q-02 the queue names each ask, its version, its link state and its history, and nothing else', async () => {
    const ask = await mint('hostA', 'Queue aunt');
    const res = await rpc('get_approval_requests', { p_wedding_id: weddingOf('hostA') }, { as: 'hostA' });
    assert.equal(res.status, 200);
    const row = (res.body ?? []).find((r) => r.request_id === ask.requestId);
    assert.ok(row, 'the ask this test just made is not in the host\'s own queue');
    assert.deepEqual(Object.keys(row).sort(), QUEUE_KEYS);
    assert.equal(row.reviewer_display_name, 'Queue aunt');
    assert.equal(row.status, 'pending');
    assert.equal(row.version_number, 1);
    assert.equal(row.version_id, versionOf('hostA'));
    assert.deepEqual(row.history, []);
    assert.equal(row.responded_at, null);
    assert.equal(row.invalidated_at, null);
  });

  test('Q-03 link_state is about the credential, so it is read together with what the door answers', async () => {
    const pending = await mint('hostA', 'Live link aunt');
    const answered = await mint('hostA', 'Answered link aunt');
    await answer(answered.token, { p_decision: 'approved', p_reviewer_label: 'Answered link aunt',
      p_message: null, p_section_key: null });
    const revoked = await mint('hostA', 'Revoked link aunt');
    await rpc('revoke_family_review', { p_request_id: revoked.requestId }, { as: 'hostA' });

    const res = await rpc('get_approval_requests', { p_wedding_id: weddingOf('hostA') }, { as: 'hostA' });
    const byId = new Map((res.body ?? []).map((r) => [r.request_id, r]));
    assert.equal(byId.get(pending.requestId).link_state, 'live');
    assert.equal(byId.get(revoked.requestId).link_state, 'revoked');
    // The measured nuance: an answered request whose credential was never revoked still reads `live`.
    // The ask is closed (Q-02/D-06), the string is not, and conflating the two would mis-state what a
    // host sees in their own dashboard.
    assert.equal(byId.get(answered.requestId).link_state, 'live');
    assert.equal(byId.get(answered.requestId).status, 'approved');
    assert.deepEqual(await open(answered.token), { status: 200, body: UNAVAILABLE },
      'the answered ask\'s live credential still opened the door, which is a different claim');
    assert.equal(byId.get(revoked.requestId).status, 'invalidated');
  });

  test('Q-04 the history the host reads is the reviewer\'s own words, in the measured shape', async () => {
    const ask = await mint('hostA', 'History aunt');
    await answer(ask.token, { p_decision: 'changes_requested', p_reviewer_label: 'History aunt',
      p_message: 'Two hours is too early for the elders.', p_section_key: 'ceremonies' });
    const res = await rpc('get_approval_requests', { p_wedding_id: weddingOf('hostA') }, { as: 'hostA' });
    const row = (res.body ?? []).find((r) => r.request_id === ask.requestId);
    assert.equal(row.history.length, 1);
    assert.deepEqual(Object.keys(row.history[0]).sort(), HISTORY_KEYS);
    assert.deepEqual(row.history[0], {
      id: row.history[0].id, kind: 'decision', decision: 'changes_requested',
      author_label: 'History aunt', message: 'Two hours is too early for the elders.',
      section_key: 'ceremonies', created_at: row.history[0].created_at });
    assert.match(row.history[0].id, UUID);
    assert.equal(row.responded_at, row.history[0].created_at,
      'the ask\'s answer time and the note\'s own time disagree');
  });

  test('Q-05 no credential of any kind appears in the queue, though its states do', async () => {
    const ask = await mint('hostA', 'Needle aunt');
    const res = await rpc('get_approval_requests', { p_wedding_id: weddingOf('hostA') }, { as: 'hostA' });
    const text = JSON.stringify(res.body);
    assert.equal(text.includes(ask.requestId), true,
      'the row this test just minted is not in the queue at all, so the credential scan below is vacuous');
    // Checked against every credential this run minted for this host, not against a pattern: an
    // anchored `^[…]{43}$` test over the whole document would pass while naming no string at all, and a
    // reviewer name of 120 characters is itself a run of 43-word characters.
    for (const m of minted.filter((x) => x.as === 'hostA')) {
      assert.equal(text.includes(m.token), false,
        `the queue carried a review credential (${shown(m.name).slice(0, 24)})`);
    }
    for (const name of ['review_token', 'token_hash', 'x-review-token']) {
      assert.equal(text.includes(name), false, `the queue names ${name}`);
    }
    // and the same read by the other host tells them nothing about this one
    const stranger = await rpc('get_approval_requests', { p_wedding_id: weddingOf('hostA') },
      { as: 'hostB' });
    assert.equal(stranger.status, 403);
  });

  test('Q-06 every ask this run made is in its own host\'s queue, and none is in the other\'s', async () => {
    const res = await rpc('get_approval_requests', { p_wedding_id: weddingOf('hostA') }, { as: 'hostA' });
    const ids = new Set((res.body ?? []).map((r) => r.request_id));
    const mine = minted.filter((m) => m.as === 'hostA');
    for (const m of mine) assert.equal(ids.has(m.requestId), true, `an ask this suite made is missing from the queue: ${m.name.slice(0, 24)}`);
    const theirs = minted.filter((m) => m.as === 'hostB').map((m) => m.requestId);
    for (const id of theirs) assert.equal(ids.has(id), false, `host A's queue holds ${id}`);
    assert.ok(mine.length >= 10, `this test is only meaningful once the suite has asked several times; saw ${mine.length}`);
  });
});

// ---------------------------------------------------------------------------
// X — the successor rule, and the boundary between versions
// ---------------------------------------------------------------------------
describe('S7 VERSION SUCCESSOR', () => {
  test('X-01 freezing a new version invalidates the pending asks and revokes their live links', async () => {
    const pending = await mint('hostA', 'Superseded aunt');
    const answered = await mint('hostA', 'Answered before successor');
    await answer(answered.token, { p_decision: 'changes_requested',
      p_reviewer_label: 'Answered before successor', p_message: 'Already said.', p_section_key: null });
    const snapshotBefore = sqlCell(`select md5(v.snapshot::text) from public.invitation_versions v
        where v.id = '${versionOf('hostA')}'::uuid`, 'v1 digest');

    const next = await rpc('create_invitation_version', { p_wedding_id: weddingOf('hostA') },
      { as: 'hostA' });
    assert.equal(next.status, 200, `the successor could not be frozen: ${shown(JSON.stringify(next.body))}`);
    assert.equal(next.body.version_number, 2);
    // The file tracks the current version the way the host app does, so the cases after this one ask
    // about v2 unless they name v1 themselves.
    people.hostA.versionId = next.body.version_id;
    people.hostA.versionNumber = next.body.version_number;

    assert.equal(sqlCell(`select status || ' ' || (invalidated_at is not null)::text
        || ' ' || (responded_at is null)::text from public.approval_requests
        where id = '${pending.requestId}'::uuid`, 'the superseded ask'),
      'invalidated true true', 'a pending ask survived its document being superseded');
    assert.equal((await open(pending.token)).body.available, false,
      'a reviewer could still answer a document the host has moved past');
    assert.deepEqual(await answer(pending.token, { p_decision: 'approved',
      p_reviewer_label: 'Superseded aunt', p_message: null, p_section_key: null })
      .then((r) => r.body), NOT_RECORDED, 'a superseded ask could still be answered');
    assert.equal(sqlCell(`select (revoked_at is not null)::text from private.access_tokens
        where approval_request_id = '${pending.requestId}'::uuid`, 'the superseded credential'), 'true');

    assert.equal(sqlCell(`select status || ' ' || (invalidated_at is null)::text
        from public.approval_requests where id = '${answered.requestId}'::uuid`, 'the answered ask'),
      'changes_requested true', 'a decision already given was rewritten by a successor');
    assert.equal(sqlCell(`select count(*)::text from public.approval_feedback
        where request_id = '${answered.requestId}'::uuid`, 'the surviving history'), '1');
    assert.equal(sqlCell(`select md5(v.snapshot::text) from public.invitation_versions v
        where v.id = '${versionOf('hostA')}'::uuid`, 'v1 digest'), snapshotBefore,
      'the successor rewrote the version it replaced');
  });

  test('X-02 a new ask against the new version is independent of the old one\'s history', async () => {
    const nextVersion = sqlCell(`select id::text from public.invitation_versions
        where wedding_id = '${weddingOf('hostA')}'::uuid and version_number = 2`, 'v2');
    const fresh = await mint('hostA', 'V2 aunt', { versionId: nextVersion });
    assert.equal(sqlCell(`select version_id::text from public.approval_requests
        where id = '${fresh.requestId}'::uuid`, 'the new ask\'s pin'), nextVersion,
      'an ask against the new version was pinned to something else');
    const opened = await open(fresh.token);
    assert.equal(opened.body.review.version_number, 2, 'the new link reports the old version');
    assert.equal(opened.body.available, true);

    const oldAsk = minted.filter((m) => m.name === 'Superseded aunt').pop();
    assert.equal((await open(oldAsk.token)).body.available, false,
      'the new version revived the old link');
    const res = await rpc('get_approval_requests', { p_wedding_id: weddingOf('hostA') }, { as: 'hostA' });
    const byId = new Map((res.body ?? []).map((r) => [r.request_id, r]));
    assert.equal(byId.get(fresh.requestId).version_number, 2);
    assert.equal(byId.get(oldAsk.requestId).version_number, 1);
    assert.equal(byId.get(oldAsk.requestId).status, 'invalidated',
      'the queue no longer shows which ask the successor closed');
  });

  test('X-03 an ask against an older frozen version is allowed, and the reviewer is shown that version', async () => {
    // Read from the version table rather than from the fixture pointer: X-01 moved this wedding's
    // current version to v2, and `versionOf('hostA')` now means "the one the cases after it ask about".
    // The first measurement pass found this test asserting version 1 while asking about v2 — its own
    // alias was stale, not the product.
    const historical = cell(`select id::text from public.invitation_versions
        where wedding_id = '${weddingOf('hostA')}'::uuid and version_number = 1`, 'v1');
    assert.notEqual(historical, versionOf('hostA'),
      'the fixture no longer tracks the successor, so this case would be asking about the current version');

    const res = await rpc('request_family_review', { p_wedding_id: weddingOf('hostA'),
      p_version_id: historical, p_reviewer_display_name: 'Stale version aunt' }, { as: 'hostA' });
    // Measured: the product does allow an ask against an older frozen version — the reviewer is then
    // shown that version, and it is a *successor* freeze that closes pending asks (X-01), not the act of
    // asking about a historical one. That is the behaviour the migration documents rather than a hole,
    // and it is what a host re-asking an elder about the card they already commented on needs.
    assert.equal(res.status, 200, `asking about a frozen older version was refused: ${shown(JSON.stringify(res.body))}`);
    minted.push({ as: 'hostA', requestId: res.body.request_id, token: res.body.review_token,
      expiresAt: res.body.expires_at, name: 'Stale version aunt' });

    const opened = await open(res.body.review_token);
    assert.equal(opened.body.available, true, 'a link to a historical version never opened');
    assert.equal(opened.body.review.version_number, 1, 'the reviewer was shown the current version instead');
    assert.equal(cell(`select version_id::text from public.approval_requests
        where id = '${res.body.request_id}'::uuid`, 'the historical pin'), historical,
      'the ask was not pinned to the version it was made against');
  });

  test('X-04 withdrawing a review ask leaves the frozen versions and the published guest link alone', async () => {
    // No publish here: D-04 already holds this file's one publication, and a second publish of the same
    // wedding is a different measurement (`stage3_publication.test.mjs` shows a re-publish answers
    // `path: null` rather than re-disclosing the string). The counts are therefore read before and
    // compared after, rather than asserted as absolute numbers.
    const before = {
      activePublications: cell(`select count(*)::text from public.publications
          where wedding_id = '${weddingOf('hostA')}'::uuid and status = 'active'`, 'the active publications'),
      liveGuestLinks: cell(`select count(*)::text from private.access_tokens
          where wedding_id = '${weddingOf('hostA')}'::uuid and token_kind = 'public_invitation'
            and revoked_at is null`, 'the live guest credentials'),
      versions: cell(`select count(*)::text from public.invitation_versions
          where wedding_id = '${weddingOf('hostA')}'::uuid`, 'the versions'),
    };
    const ask = await mint('hostA', 'Withdraw after publish');
    const revoked = await rpc('revoke_family_review', { p_request_id: ask.requestId }, { as: 'hostA' });
    assert.equal(revoked.status, 200, shown(JSON.stringify(revoked.body)));
    assert.equal(revoked.body.credential_revoked, true);

    assert.equal(cell(`select count(*)::text from public.publications
        where wedding_id = '${weddingOf('hostA')}'::uuid and status = 'active'`, 'the active publications'),
      before.activePublications, 'withdrawing a review ask unpublished the invitation');
    assert.equal(cell(`select count(*)::text from private.access_tokens
        where wedding_id = '${weddingOf('hostA')}'::uuid and token_kind = 'public_invitation'
          and revoked_at is null`, 'the live guest credentials'), before.liveGuestLinks,
      'withdrawing a review ask revoked the guest link too — the two kinds are not separate stores');
    assert.equal(cell(`select count(*)::text from public.invitation_versions
        where wedding_id = '${weddingOf('hostA')}'::uuid`, 'the versions'), before.versions,
      'withdrawing a review ask touched the version history');
    assert.equal(cell(`select (revoked_at is not null)::text from private.access_tokens
        where approval_request_id = '${ask.requestId}'::uuid`, 'the review credential'), 'true');
  });
});

// ---------------------------------------------------------------------------
// C — the credential store, and the boundary between the two anonymous doors
// ---------------------------------------------------------------------------
describe('S7 CREDENTIAL STORE', () => {
  test('C-01 every ask this run minted has exactly one live credential, and no ask has two', async () => {
    const census = sqlRows(`select approval_request_id::text || '=' || count(*)::text
      from private.access_tokens
      where wedding_id in (${WHO.map((w) => `'${weddingOf(w)}'::uuid`).join(',')})
        and token_kind = 'approval_review' and revoked_at is null
      group by approval_request_id having count(*) > 1`);
    assert.deepEqual(census, [], `a request holds more than one live review credential: ${shown(JSON.stringify(census))}`);
    const total = Number(sqlCell(`select count(distinct approval_request_id)::text from private.access_tokens
        where wedding_id in (${WHO.map((w) => `'${weddingOf(w)}'::uuid`).join(',')})
          and token_kind = 'approval_review'`, 'the requests with credentials'));
    assert.ok(total >= 10, `only ${total} asks recorded a credential, so the census above is thin`);
  });

  test('C-02 nothing in the credential store is a raw string, in either kind', async () => {
    const bad = sqlCell(`select count(*)::text from private.access_tokens
        where wedding_id in (${WHO.map((w) => `'${weddingOf(w)}'::uuid`).join(',')})
          and token_hash !~ '^[0-9a-f]{64}$'`, 'non-digest credentials');
    assert.equal(bad, '0', 'a credential is stored as something other than a SHA-256 digest');
    const shape = sqlCell(`select coalesce(string_agg(distinct token_kind, ','), '-')
        from private.access_tokens where wedding_id in
        (${WHO.map((w) => `'${weddingOf(w)}'::uuid`).join(',')})`, 'the kinds');
    assert.deepEqual(shape.split(',').sort(), ['approval_review', 'public_invitation'],
      `this run stored kinds ${shape}; the guest half is needed by D-04 and the review half by everything`);
    for (const m of minted) {
      assert.equal(CRED.test(m.token), true, 'a minted credential in this file\'s own list is not the shape');
    }
  });

  test('C-03 a host\'s guest-link housekeeping withdraws no family review link, and a review answer revokes no publication', async () => {
    // Operates on the publication D-04 made, because publishing twice is not what this case is about.
    // Every count is read before and compared after: the absolute numbers belong to whichever cases ran
    // earlier in the file, and a suite that reorders should not have to be re-counted.
    const ask = await mint('hostA', 'Housekeeping aunt');
    const activeBefore = cell(`select count(*)::text from public.publications
        where wedding_id = '${weddingOf('hostA')}'::uuid and status = 'active'`, 'the active publications');
    const liveGuestBefore = cell(`select count(*)::text from private.access_tokens
        where wedding_id = '${weddingOf('hostA')}'::uuid and token_kind = 'public_invitation'
          and revoked_at is null`, 'the live guest credentials');
    assert.equal(activeBefore, '1', 'D-04 left this wedding with one active publication');
    assert.equal(liveGuestBefore, '1', 'D-04 left this wedding without exactly one live guest link, '
      + 'so the rotation below is not measuring the boundary it names');

    assert.equal((await open(ask.token)).body.available, true,
      'a review ask made against a published wedding never opened');

    const rotated = await rpc('rotate_invitation_token', { p_wedding_id: weddingOf('hostA') },
      { as: 'hostA' });
    assert.equal(rotated.status, 200, shown(JSON.stringify(rotated.body)));
    assert.equal((await open(ask.token)).body.available, true,
      'rotating the guest link withdrew the family review link');
    assert.equal(cell(`select (revoked_at is null)::text from private.access_tokens
        where approval_request_id = '${ask.requestId}'::uuid`, 'the review credential after rotation'), 'true',
      'rotation withdrew the review credential while leaving its door open');
    assert.equal(cell(`select count(*)::text from private.access_tokens
        where wedding_id = '${weddingOf('hostA')}'::uuid and token_kind = 'public_invitation'
          and revoked_at is null`, 'the live guest credentials'), liveGuestBefore,
      'rotation did not replace the guest link with the same number of live ones');

    const answered = await answer(ask.token, { p_decision: 'approved', p_reviewer_label: 'Housekeeping aunt',
      p_message: null, p_section_key: null });
    assert.equal(answered.body.recorded, true, shown(JSON.stringify(answered.body)));
    assert.equal(cell(`select count(*)::text from public.publications
        where wedding_id = '${weddingOf('hostA')}'::uuid and status = 'active'`, 'the active publications'), '1',
      'a review answer withdrew the family\'s guest link');

    const revokedPub = await rpc('revoke_invitation_publication', { p_wedding_id: weddingOf('hostA') },
      { as: 'hostA' });
    assert.deepEqual(Object.keys(revokedPub.body).sort(), ['publication_id', 'revoked', 'tokens_revoked']);
    assert.equal(revokedPub.body.revoked, true);
    assert.equal(cell(`select (revoked_at is null)::text from private.access_tokens
        where approval_request_id = '${ask.requestId}'::uuid`, 'the review credential after the guest revoke'),
      'true', 'withdrawing the publication also withdrew the family review credential');
  });

  test('C-04 no guest verb can name a review request, and no review verb can name a publication', async () => {
    // Aggregated into one row per side: the first pass read two functions with a one-row helper and
    // failed on the row count, which is a census bug rather than a product fact.
    const guestArgs = cell(`select string_agg(p.proname || '(' || pg_get_function_arguments(p.oid) || ')', ' | ')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'api' and p.proname in ('rotate_invitation_token','revoke_invitation_publication')`,
      'the guest verbs');
    assert.equal(/request|approval/i.test(guestArgs), false,
      `a guest verb now takes something that names an approval: ${shown(guestArgs)}`);
    assert.match(guestArgs, /p_wedding_id uuid/,
      `the guest verbs are not the measured shape: ${shown(guestArgs)}`);

    const reviewArgs = cell(`select string_agg(p.proname || '(' || pg_get_function_arguments(p.oid) || ')', ' | ')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'api' and p.proname in ('request_family_review','revoke_family_review',
                                                  'get_approval_requests','submit_family_review')`,
      'the review verbs');
    assert.equal(/publication/i.test(reviewArgs), false,
      `a review verb now takes something that names a publication: ${shown(reviewArgs)}`);
    assert.equal(/hash|token/i.test(reviewArgs), false,
      `a review verb takes a credential as an argument, which is the channel T-02/T-03 refuse: `
      + shown(reviewArgs));
  });

  test('C-05 the audit table is not written by this workflow, so it holds no credential either', async () => {
    // Measured across all five probes: `private.audit_events` is empty before and after a full review
    // sequence. Stating that as a control would be false — an empty table cannot leak. Stating it as a
    // limitation is what the Stage 7 audit section does, and this test exists so the claim is re-read
    // rather than remembered: if a future migration starts auditing these verbs, this census moves and
    // the raw-string scan below becomes the load-bearing one.
    const rows = Number(sqlCell(`select count(*)::text from private.audit_events where wedding_id in
        (${WHO.map((w) => `'${weddingOf(w)}'::uuid`).join(',')})`, 'the audit rows for this run'));
    assert.equal(rows, 0,
      `the workflow wrote ${rows} audit rows; scan them for credentials before changing this test`);
    const needles = Number(sqlCell(`select count(*)::text from private.audit_events
        where payload::text ~ '[A-Za-z0-9_-]{43}' or subject_key::text ~ '[A-Za-z0-9_-]{43}'`,
      'audit rows carrying a credential-shaped string'));
    assert.equal(needles, 0, 'an audit payload carries a credential-shaped string');
  });

  test('C-06 the whole run\'s credentials appear nowhere in the product\'s readable records', async () => {
    // Per credential, and by substring rather than by equality: a credential that had been pasted into
    // the middle of a note or a snapshot field would be the leak, and an `=` comparison would miss it.
    // `position()` rather than `LIKE`, because base64url carries `_`, which `LIKE` reads as a wildcard.
    for (const m of minted) {
      const found = Number(cell(`select count(*)::text from (
          select coalesce(reviewer_display_name,'') as v from public.approval_requests
            where wedding_id = '${weddingOf(m.as)}'::uuid
          union all select coalesce(reviewer_contact_text,'') from public.approval_requests
            where wedding_id = '${weddingOf(m.as)}'::uuid
          union all select coalesce(message,'') from public.approval_feedback
            where wedding_id = '${weddingOf(m.as)}'::uuid
          union all select coalesce(author_label,'') from public.approval_feedback
            where wedding_id = '${weddingOf(m.as)}'::uuid
          union all select coalesce(section_key,'') from public.approval_feedback
            where wedding_id = '${weddingOf(m.as)}'::uuid
          union all select coalesce(field_key,'') from public.approval_feedback
            where wedding_id = '${weddingOf(m.as)}'::uuid
          union all select token_hash from private.access_tokens
            where wedding_id = '${weddingOf(m.as)}'::uuid
          union all select snapshot::text from public.invitation_versions
            where wedding_id = '${weddingOf(m.as)}'::uuid
          union all select content::text from public.invitation_drafts
            where wedding_id = '${weddingOf(m.as)}'::uuid
        ) x where position('${m.token}' in x.v) > 0`, 'the credential scan'));
      assert.equal(found, 0,
        `a raw review credential (${shown(m.name).slice(0, 24)}) was found inside this family's records`);
    }
    assert.ok(minted.length >= 10, `the scan ran over ${minted.length} credentials`);
  });
});
