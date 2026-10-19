// Stage 10 §4/§5/§9/§10 at the HTTP layer: what the deployed stack answers when a real token, a real
// provider signature and a real browser door are involved — the three things no SQL battery can supply.
//
// What the SQL tier already covers, and what this file therefore refuses to repeat.
// `supabase/tests/stage10/80_commerce_ledger.sql` walks the whole state machine on a throwaway Postgres
// (every kind, every order status, every hold, the staleness rule, both idempotency levels).
// `supabase/tests/stage10/90_commerce_functions.sql` measures reachability four ways — catalog privilege
// facts, RLS posture, trigger wiring and live DML refusals per role — plus the thirteen derived projection
// states, the paid-status forgery suite, the publish gate as a trigger, and §12's negative build. That
// tier cannot see PostgREST, GoTrue, Kong's routing or a JWT, and `auth.uid()` — the only thing the host
// door authorises against — does not exist there. So this file asks only what needs the stack:
//
//   S  the summary door through a genuine JWT, in every credential spelling, including the fact that a
//      wedding that is not yours and a wedding that does not exist answer with one sentence;
//   P  what that door projects, per price posture: the amount *absent* (not null, not zero) while display
//      approval is missing, the three names an approval adds, and the names no state ever adds;
//   D  a purchase driven end to end by the instrument — signed Razorpay and Cashfree deliveries over real
//      bytes, the two idempotency levels, both adapters' refusal spellings, and the poisoning property
//      the ledger's own lookup order creates;
//   R  refunds, chargebacks, expiry, cancellation and reconciliation as the ledger records them, with the
//      §9 commercial question named where the schema forces an answer;
//   G  the publish gate behind the browser's own verb rather than behind a trigger test, in both row
//      shapes and with the array it renders when the policy names a package this wedding does not hold;
//   N  that money has no browser door: the six stores unreachable in three credential spellings, the six
//      bodies unreachable in two, the OpenAPI document's measured scope, and the one accepted write that
//      is labelled as accepted rather than quietly passed;
//   Z  that this run gives the shared posture back — the policy row byte-identical to the shipped default,
//      the catalogue empty again, every store at its baseline count, and every digest it wrote equal to
//      the bytes it signed.
//
// WHERE THE BOUNDARY OF THESE NUMBERS IS. Group D reaches the money through `psql` as the stack's own
// `postgres` role — inside its container by default, or over the loopback port it publishes (the channel
// block below picks one and `before()` proves the two are the same database), because that is the only
// role the six bodies answer to (migration §9, and N-03 measures that
// no token substitutes for it). Nothing in this file is evidence about a real provider: every delivery is
// signed with a secret generated for this run, so the HMAC, the timestamp window and the event-identity
// agreement are exercised for real while the counterparty is a fixture. No live order, checkout URL or
// hosted webhook exists in any row below, and `live_capture_enabled` stays false the entire time — D-12
// measures the database's own hold against a delivery that *claims* to be live, which is the backstop,
// not a plan.
//
// Teardown is child-before-parent in FK order (refunds → events → attempts → orders → entitlements), then
// the commerce audit trail, then publications/versions/tokens, then the weddings, then the synthetic
// accounts, then the two shared posture objects (catalogue rows and the policy singleton). The audit rows
// go while `wedding_id` still names them: `private.audit_events.wedding_id` is `ON DELETE SET NULL`, so
// deleting the wedding first would leave every commerce audit row behind with a null subject, which is the
// schema's right answer for a real family's erasure and the wrong answer for a run that promised to leave
// nothing. The ledger gets a second sweep by event identity (`event_id like '<run tag>%'`) because a
// `rejected_signature` row has no `order_id` at all — the wedding-scoped delete cannot see it, and probe
// nine left exactly one such row on this stack to prove the point.
//
// `run.sh` runs this file serially with the others and fails the whole gate if any census count moves, so
// the shared-posture writes below are only safe because `before()` refuses to start unless the stack is in
// the shipped posture and `after()` restores unconditionally.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import {
  cashfreeDelivery,
  decodeLine,
  ensureSafeEncoding,
  expireOrderSql,
  grantEntitlementSql,
  observeOrderSql,
  quoteOrderSql,
  razorpayDelivery,
  reconcileOrderSql,
  runDelivery,
  runPsql,
  revocationSql,
  sqlBigInt,
  sqlText,
  sqlUuid,
} from '../../../scripts/stage10-commerce-driver.mjs';

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
/** Two ways to reach this stack's own database, one of them chosen before the first statement and never
 *  fallen back to. `docker` runs the psql that ships inside `supabase_db_localvivaahvarnam` and is the
 *  shipped route. `url` runs a psql named by `STAGE10_PSQL` against the loopback URL in `STAGE10_DB_URL`;
 *  it exists because the daemon can be wedged while the database it published is still answering (both
 *  measured on this machine: `docker ps` timed out at 30 s while `psql -h 127.0.0.1 -p 54401` returned in
 *  1 s), and a battery that can only speak through `docker exec` would report that as a product failure.
 *  The URL is not trusted because it was typed: it must be loopback and its port must be the one this
 *  repository's own `[db]` section publishes — the same interlock `run.sh` applies to the API port, so a
 *  stale URL cannot silently aim the money fixtures at the DueWeave stack. And nothing here assumes the
 *  channel and the REST layer agree: `before()` writes a wedding over REST and reads it back through this
 *  channel, so a channel aimed at a different database fails its own first assertion. */
const DB_URL = process.env.STAGE10_DB_URL ?? '';
const PSQL_BIN = process.env.STAGE10_PSQL ?? 'psql';
const DB_CONTAINER = process.env.STAGE3_DB_CONTAINER ?? `supabase_db_${PROJECT_ID}`;
if (!/^[A-Za-z0-9_.-]+$/.test(DB_CONTAINER)) {
  throw new Error(`refusing to run: STAGE3_DB_CONTAINER=${DB_CONTAINER} is not a container name`);
}
const CONFIG_DB_PORT = (() => {
  const toml = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');
  const m = /^\[db\][\s\S]*?^port\s*=\s*(\d+)/m.exec(toml);
  if (!m) throw new Error('no [db] port in supabase/config.toml');
  return m[1];
})();
let TARGET;
if (DB_URL) {
  let parsed;
  try {
    parsed = new URL(DB_URL);
  } catch {
    throw new Error('refusing to run: STAGE10_DB_URL is not a postgres URL');
  }
  if (!LOOPBACK.has(parsed.hostname)) {
    throw new Error(`refusing to run: STAGE10_DB_URL resolves to ${parsed.hostname}, not a loopback host`);
  }
  if ((parsed.port || '5432') !== CONFIG_DB_PORT) {
    throw new Error(`refusing to run: STAGE10_DB_URL uses port ${parsed.port || '5432'} but this `
      + `repository's [db] port is ${CONFIG_DB_PORT}`);
  }
  if (!parsed.username) throw new Error('refusing to run: STAGE10_DB_URL names no database role');
  TARGET = { mode: 'url', url: DB_URL };
} else {
  TARGET = { mode: 'docker', container: DB_CONTAINER };
}

const RUN_TAG = process.env.STAGE10_HTTP_RUN_TAG
  ?? `s10http-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
if (!/^[a-z0-9_-]+$/.test(RUN_TAG)) {
  throw new Error(`refusing to run: STAGE10_HTTP_RUN_TAG=${RUN_TAG} is not a run tag`);
}

// The secret is generated per run and never leaves this process. Every fixture signature below is real
// HMAC over real bytes, so a passing delivery proves the scheme and a passing refusal proves the check —
// while no credential that outlives the run exists anywhere.
const SECRET = randomBytes(32).toString('hex');

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MERCHANT_REF = /^vv1_[0-9a-f]{32}$/;
/** Well-formed and belonging to nothing. S-07/S-08 use the pair to show that "not yours" and "not there"
 *  are one answer — the same no-oracle shape Stages 3, 7 and 8 measured at their own doors. */
const NOT_A_WEDDING = '00000000-0000-4000-8000-000000000000';
const NOT_A_WEDDING_2 = '00000000-0000-4000-8000-000000000001';
const NOT_AN_ORDER = '11111111-1111-4111-8111-111111111111';
/** Well-formed in the shape the quote mints (`vv1_` plus 32 hex) and belonging to no order this run, or
 *  any run, made (§4.2 rule 3: a delivery for a purchase we cannot find is kept, not dropped). */
const NOT_A_REFERENCE = 'vv1_0000000000000000000000000000dead';

const money = (code) => `${RUN_TAG}-${code}`;
/** Nine prices, one per lifecycle this file must drive. `run.sh` counts the catalogue, so all nine are
 *  deleted by code prefix at the end and the census comes back to the number it started on. */
const CODE = {
  classic: money('classic'),
  unapproved: money('unapproved'),
  second: money('second'),
  stale: money('stale'),
  expire: money('expire'),
  gate: money('gate'),
  retry: money('retry'),
  cashfree: money('cashfree'),
  poison: money('poison'),
  failed: money('failed'),
};
const PRICE = {
  classic: 490000, unapproved: 550000, second: 610000, stale: 300000, expire: 200000,
  gate: 250000, retry: 170000, cashfree: 190000, poison: 230000, failed: 210000,
};

const emailFor = (who) => `${who}+${RUN_TAG}@example.test`;
const PASSWORD = `local-only-${RUN_TAG}`;

/** A token is 43 characters and a body digest is 64 hex. Neither belongs in a run log that outlives the
 *  repository, so every string this file prints or puts into an assertion message passes through here.
 *  The checks themselves are never relaxed by it. */
const shown = (value) => String(value)
  .replace(/[A-Za-z0-9_-]{43}/g, '[REDACTED-43]')
  .replace(/[0-9a-f]{64}/g, '[REDACTED-64]');
const json = (value) => shown(JSON.stringify(value));

// ---------------------------------------------------------------------------
// The sentences, each transcribed from the migration rather than from a probe log.
// ---------------------------------------------------------------------------
const SAY = {
  // create_commerce_order (:617, :626, :630, :641, :653)
  quoteShape: 'a quote needs a wedding, a package code and the user it is being made for',
  noWedding: 'no wedding ',
  notOwner: "does not own wedding ",
  noPrice: 'no approved price exists for package ',
  liveOrder: 'already has live order ',
  // record_commerce_event (:941, :947, :951, :956)
  providerShape: 'record_commerce_event: provider must be razorpay or cashfree',
  kindShape: 'is not a kind this build understands',
  noIdentity: 'a delivery with no provider event identity cannot be recorded',
  digestShape: 'a delivery_verified verdict and a 64-hex raw_body_sha256 are required',
  // grant / revoke / expire (:725, :732, :802, :809, :853, :857, :865)
  noGrantOrder: 'no order ',
  notCaptured: 'and carries no captured money to grant a right for',
  noRevokeOrder: 'no order ',
  noLiveEnt: 'has no live entitlement to revoke',
  noExpireOrder: 'no order ',
  notLive: 'which is not a live order; a captured order is refunded, never expired',
  notOverage: 'which has not passed',
  noReconOrder: 'no order ',
  // commerce_host_summary (:1546) and the publish gate (:566-571)
  notRead: 'the caller may not read this wedding',
  gate: 'may not publish: the commerce policy requires an active entitlement for one of [',
  gateTail: 'Hiding a button is not a gate; this is.',
};

// --------------------------------------------------------------------------- SQL
/** `-q` is load-bearing, not cosmetic: measured on this stack, `psql -tA` prints a command tag line for
 *  every statement that writes or defines, and a one-row read that also got a tag would look exactly like
 *  a stray row. Both channels are asked the same question with the same flags; only the transport differs,
 *  and the URL channel carries its password in the child's environment rather than in argv. */
function sqlRows(query) {
  const flags = ['-v', 'ON_ERROR_STOP=1', '-tAq', '-F', '|', '-c', query];
  let out;
  if (TARGET.mode === 'url') {
    const u = new URL(TARGET.url);
    out = execFileSync(PSQL_BIN, [
      '-h', u.hostname, '-p', u.port || '5432', '-U', u.username, '-d', u.pathname.slice(1) || 'postgres',
      ...flags,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password), PGCLIENTENCODING: 'UTF8' },
    });
  } else {
    out = execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', ...flags],
      { encoding: 'utf8' });
  }
  return out.split(/\r?\n/).filter((line) => line.length > 0);
}

function sqlCell(query, what) {
  const rows = sqlRows(query);
  assert.equal(rows.length, 1, `${what} did not read exactly one row: ${json(rows)}`);
  return rows[0];
}
const cell = (query, what) => sqlCell(query, what);

const count = (fromWhere, what = fromWhere) => cell(`select count(*)::text ${fromWhere}`, what);

/** The driver's own channel: one statement in, one base64 line out. `ensureSafeEncoding` is asked once by
 *  `before()`, because the doubling rule in the driver's literals only holds under
 *  `standard_conforming_strings = on` and a session that answers otherwise would make every fixture below
 *  a possible injection rather than a measurement. */
const sql = (text) => runPsql(TARGET, text);
const run = (statement, what) => {
  let line;
  try {
    line = sql(statement);
  } catch (error) {
    throw new Error(`${what} failed: ${shown(String(error.message)).slice(0, 400)}`);
  }
  return decodeLine(line);
};

/** A statement that must be refused, in the form the SQL battery scores it: `SQLSTATE || ' ' || SQLERRM`.
 *  The driver's channel cannot carry this — `runPsql` re-throws `psql`'s last line, which on a plpgsql
 *  refusal is the CONTEXT line rather than the sentence — so the capture runs in a `DO` block and reads
 *  the pair itself. A statement that is accepted reports `ACCEPTED`, so every negative case also fails if
 *  the database said yes. */
function refusalOf(statement, what) {
  return cell(`
    set client_min_messages = warning;
    drop table if exists pg_temp.s10_http_refusal;
    create temp table pg_temp.s10_http_refusal(t text);
    do $body$ begin
      ${statement};
      insert into pg_temp.s10_http_refusal values ('ACCEPTED');
    exception when others then
      insert into pg_temp.s10_http_refusal values (sqlstate || ' ' || sqlerrm);
    end $body$;
    select coalesce(max(t), 'nothing') from pg_temp.s10_http_refusal`, what);
}

const refused = (statement, expectation, what) => {
  const answer = refusalOf(statement, what);
  assert.ok(answer !== 'ACCEPTED', `${what}: the database accepted a write it was meant to refuse `
    + `(statement ${shown(statement).slice(0, 200)})`);
  assert.match(answer, new RegExp(`^${expectation.code} `),
    `${what}: refused with the wrong SQLSTATE: ${shown(answer)}`);
  for (const part of expectation.sentence) {
    assert.ok(answer.includes(part),
      `${what}: expected the sentence to carry ${JSON.stringify(part)}, got ${shown(answer)}`);
  }
  return answer;
};
const say = (code, ...sentence) => ({ code, sentence });

/** The one mapping a fixture helper is allowed to trust: a run-tagged code back to the amount pinned for
 *  it. Built from the two tables rather than looked up by hand, because the failure mode of a hand-rolled
 *  lookup is the one measured in run r6 — `PRICE[CODE.classic]` is `undefined`, that interpolates the
 *  literal word `undefined` into the `insert`, and nine price fixtures and forty downstream assertions
 *  fall over on a single `column "undefined" does not exist`. */
const PRICE_OF = new Map(Object.keys(CODE).map((name) => [CODE[name], PRICE[name]]));

const insertPackage = (code, { amount = PRICE_OF.get(code), status = 'active', approved = true } = {}) => {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`refusing to write a price row for ${code}: no amount is pinned for it in PRICE `
      + `(got ${shown(String(amount))}); every fixture amount must be an integer of minor units`);
  }
  exec(`insert into private.commerce_packages
          (package_code, currency, amount_minor, price_version, status, display_approved)
        values ('${code}', 'INR', ${amount}, 1, '${status}', ${approved})`,
  `the price row for ${code}`);
};
/** Why a `psql` child said no. `execFileSync` puts the server's refusal on stderr and leaves stdout at
 *  the empty string, so `error.stdout ?? error.message` keeps the empty string and the battery reports
 *  `failed:` with nothing after it — measured in run r6, where the first fixture failure of the run hid
 *  its own SQLSTATE and forty downstream assertions had to be read as one undiagnosable cascade. */
const psqlFailure = (error) => [error?.stderr, error?.stdout, error?.message]
  .map((part) => (typeof part === 'string' ? part.trim() : ''))
  .find((part) => part.length > 0) ?? String(error);

const exec = (statement, what) => {
  try {
    return sqlRows(statement);
  } catch (error) {
    throw new Error(`${what} failed: ${shown(psqlFailure(error)).slice(0, 400)}`);
  }
};

/** The three postures a reader of §7 cares about, read from the catalog rather than asserted from a
 *  design document: RLS on, no client grant, and the two client-write guards wired. */
const COMMERCE_TABLES = ['commerce_packages', 'commerce_orders', 'commerce_payment_attempts',
  'commerce_payment_events', 'commerce_refunds', 'commerce_policy'];

const postureOf = (table) => cell(`
  select 'rls=' || c.relrowsecurity
    || ' grants=' || coalesce((select string_agg(distinct g.grantee || ':' || g.privilege_type, ' '
                                 order by g.grantee || ':' || g.privilege_type)
        from information_schema.role_table_grants g
       where g.table_schema = 'private' and g.table_name = '${table}'
         and g.grantee in ('anon','authenticated','service_role')), 'none')
    || ' guards=' || (count(*) filter (where tg.tgname like '%client%'))::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_trigger tg on tg.tgrelid = c.oid and not tg.tgisinternal
 where n.nspname = 'private' and c.relname = '${table}'
 group by c.relrowsecurity, c.oid`, `the posture of private.${table}`);

// --------------------------------------------------------------------------- REST
const people = {};
const WHO = ['hostA', 'hostB', 'stranger'];
const tokenOf = (who) => people[who].token;
const uidOf = (who) => people[who].userId;
const weddingOf = (who) => people[who].weddingId;

let transportRetries = 0;
const SOCKET_DEATHS = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE']);
const isSocketDeath = (err) => err instanceof TypeError && SOCKET_DEATHS.has(err?.cause?.code);
/** Only `STABLE`, DML-free reads may be sent twice. Measured at S-01 and again in the historical suites,
 *  Kong on this host sometimes closes a socket before any response while other stacks compete for it; a
 *  write keeps its single shot because the harness cannot tell a socket that died before the request from
 *  one that died after the server applied it. */
const READ_RPCS = new Set(['/rest/v1/rpc/commerce_host_summary']);
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

async function call(method, path, opts = {}) {
  const send = () => callOnce(method, path, opts);
  return isReadCall(method, path) ? withReadRetry(`${method} ${path}`, send) : send();
}

/** The summary door spelled four ways: the product's own client sends an `api` profile, and the three
 *  other spellings are what an attacker or a stale SDK would send. */
async function summary(who, weddingId, { profile = 'api' } = {}) {
  const headers = {};
  if (profile) headers['Content-Profile'] = profile;
  return call('POST', '/rest/v1/rpc/commerce_host_summary', {
    bearer: tokenOf(who), body: { p_wedding_id: weddingId }, headers,
  });
}

async function rpc(name, args, { as = 'anon', headers = {}, profile = 'api' } = {}) {
  const bearer = as === 'anon' ? anonKey : as === 'service' ? serviceKey : tokenOf(as);
  const all = { ...headers };
  if (profile) all['Content-Profile'] = profile;
  return call('POST', `/rest/v1/rpc/${name}`, { body: args, bearer, headers: all });
}

async function signUp(who) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: emailFor(who), password: PASSWORD });
  assert.equal(error, null, `signup failed for ${who}`);
  assert.ok(data.session, 'expected a session immediately');
  const { data: fresh } = await c.auth.getSession();
  return { client: c, userId: data.user.id, token: fresh.session.access_token };
}

const HOST_EVENTS = (label) => ([
  { event_key: 'muhoortam', display_name: `${label} Muhoortham`, starts_at_local: '2027-02-14T09:00:00',
    ends_at_local: '2027-02-14T11:00:00', display_order: 1, enabled: true },
  { event_key: 'reception', display_name: `${label} Reception`, starts_at_local: '2027-02-14T18:00:00',
    ends_at_local: '2027-02-14T22:00:00', display_order: 2, enabled: true },
]);

/** A wedding a browser could really have made: create, write the draft, add the two events, freeze a
 *  version. Nothing publishes here, because the publish gate in group G has to meet a wedding whose
 *  first publication is still ahead of it — and a row the browser could not create would make every
 *  refusal below a statement about a shape the product never writes. */
async function buildWedding(who, label) {
  const w = await call('POST', '/rest/v1/weddings', {
    bearer: tokenOf(who),
    body: { owner_user_id: uidOf(who), title: `S10 HTTP ${label} ${RUN_TAG}`, primary_language: 'en' },
    headers: { Prefer: 'return=representation' },
  });
  assert.equal(w.status, 201, `${who} could not create a wedding: ${json(w.body)}`);
  const weddingId = w.body[0].id;

  const d = await call('PATCH', `/rest/v1/invitation_drafts?wedding_id=eq.${weddingId}`, {
    bearer: tokenOf(who),
    body: { content: { welcome: `With the blessings of both families, join us for ${label}.`,
      family_introduction: `The families of ${label} invite you.`, event_notes: null, closing: null } },
    // The representation is what makes this a proof rather than a silence: measured on this stack, a PATCH
    // that matches no row answers 204 with no body, so without the preference a wedding whose draft row
    // never appeared would still let every fixture below freeze a version and quote a price.
    headers: { Prefer: 'return=representation' },
  });
  assert.equal(d.status, 200, `${who} could not write its draft: ${json(d.body)}`);
  assert.equal(d.body.length, 1,
    `${who}'s draft write did not come back with the row it wrote, so the freeze below would be `
    + `patching nothing: ${json(d.body)}`);
  assert.equal(d.body[0].wedding_id, weddingId, `${who}'s draft row is not the wedding just created`);

  for (const event of HOST_EVENTS(label)) {
    const e = await call('POST', '/rest/v1/wedding_events', {
      bearer: tokenOf(who),
      body: { ...event, wedding_id: weddingId, timezone: 'Asia/Kolkata' },
    });
    assert.equal(e.status, 201, `${who} could not create ${event.event_key}: ${json(e.body)}`);
  }

  const v = await rpc('create_invitation_version', { p_wedding_id: weddingId }, { as: who });
  assert.equal(v.status, 200, `${who} could not freeze a version: ${json(v.body)}`);
  return { weddingId, versionId: v.body.version_id };
}

/** The publish door, spelled the way the host screen spells it. */
async function publish(who, weddingId, versionId) {
  return rpc('publish_invitation_version',
    { p_wedding_id: weddingId, p_version_id: versionId, p_expires_at: null }, { as: who });
}

// --------------------------------------------------------------------------- fixtures
const orders = {};
let baseline = null;

const quote = (key, { weddingId, packageCode, actor }) => {
  const answer = run(quoteOrderSql({ weddingId, packageCode, actorUserId: actor }), `the quote for ${key}`);
  orders[key] = { ...answer, packageCode, weddingId, actor };
  return answer;
};

const rzBody = (event, eventId, createdAt, payload) => JSON.stringify({
  entity: 'event', event, event_id: eventId, created_at: createdAt, payload,
});
const payEntity = (mr, ref, amount = PRICE.classic) => ({
  id: `pay_${ref}`, order_id: `order_${ref}`, currency: 'INR', amount, amount_paid: amount,
  status: 'captured', notes: { merchant_reference: mr },
});
const orderEntity = (mr, ref) => ({
  id: `order_${ref}`, notes: { merchant_reference: mr }, currency: 'INR', status: 'paid',
});
const refundEntity = (mr, ref, amount = PRICE.classic) => ({
  id: `rfnd_${ref}`, order_id: `order_${ref}`, payment_id: `pay_${ref}`, amount, currency: 'INR',
  status: 'processed', notes: { merchant_reference: mr },
});
const cfDoc = (type, id, t, payload) => JSON.stringify({
  entity: 'webhook', type, notification_id: id, notification_type: type, notification_time: t, payload,
});

/** One delivery through the instrument. `verified` is asserted; the refusals that must reach the ledger in
 *  the *un*verified form are spelled out with `verified: false` and their reason, so a case can ask for a
 *  refusal without the harness quietly recording something it did not mean to.
 *
 *  `signWith` exists for one reason: a forged delivery is a body signed by somebody who does not hold the
 *  secret, and the verifier must still be handed the real one. Defaulting it to `secret` would sign the
 *  forgery with the key it is supposed to lack, and every signature case below would measure nothing. */
function deliver(caseId, {
  provider = 'razorpay', body, eventId, secret = SECRET, signWith = secret, timestamp,
  environment = 'synthetic', as = 'hostA', verified = true, reason = null, now, toleranceMs,
}) {
  const delivery = provider === 'razorpay'
    ? razorpayDelivery({ body, secret: signWith, eventId })
    : cashfreeDelivery({ body, secret: signWith, timestamp, now: now ?? Date.now() });
  const out = runDelivery({
    sql, delivery, secret, environment, actorUserId: uidOf(as), now, timestampToleranceMs: toleranceMs,
  });
  assert.equal(out.verified, verified, `${caseId}: the verifier answered `
    + `${out.verified ? 'verified' : `refused (${out.reason})`} where this case asked for `
    + `${verified ? 'verified' : `refused (${reason})`}`);
  if (!verified) {
    if (reason !== null) assert.equal(out.reason, reason, `${caseId}: wrong refusal reason: ${json(out)}`);
    return out;
  }
  assert.equal(out.recorded, true, `${caseId}: a verified delivery must reach the ledger`);
  assert.match(out.digest, HEX64, `${caseId}: the digest this run computed is not 64-hex`);
  // Only a delivery that *wrote* a row goes on the evidence list. An `already_recorded` answer (D-02,
  // D-11b, D-16b) computed this run's digest over bytes the ledger deliberately kept unread, so the row
  // under that id holds somebody else's digest — comparing them is the poisoning property, which has its
  // own cases, and not the claim Z-01 makes about every row this run signed into the ledger.
  if (out.result?.disposition !== 'already_recorded') {
    digests.push({ caseId, provider, eventId: eventId ?? null, digest: out.digest, kind: out.kind });
  }
  return out;
}
const digests = [];

const resultOf = (caseId, out) => {
  assert.ok(out.result, `${caseId}: the ledger answered nothing`);
  return out.result;
};
const keysOf = (value) => Object.keys(value).sort().join(',');
/** A key set written the only way `keysOf` can compare it: sorted, then joined. Typed as a sorted line by
 *  hand, one of them was not — `entitlement_id` sat last in `APPLIED_KEYS` while `keysOf` sorted it fourth,
 *  and run r8 lost five cases (D-01, D-11b's neighbours, R-01, R-03, R-10a) to that ordering alone, each
 *  with a correct projection underneath. Building the string from names removes the whole failure class. */
const keySet = (...names) => [...names].sort().join(',');
const BASE_ORDER_KEYS = keySet('order_id', 'wedding_id', 'package_code', 'amount_minor', 'currency',
  'price_version', 'merchant_reference', 'status', 'quote_expires_at', 'price_display_approved');
const APPLIED_KEYS = keySet('disposition', 'event_row_id', 'order_id', 'order_status', 'attempt_id',
  'entitlement_id', 'hold_reason', 'applied_effect', 'processing_status', 'state_changed');
const RECORDED_KEYS = keySet('disposition', 'event_row_id', 'order_id', 'order_status', 'hold_reason',
  'applied_effect', 'processing_status', 'state_changed');
const ALREADY_KEYS = keySet('disposition', 'event_row_id', 'order_id', 'hold_reason', 'applied_effect',
  'processing_status');
const SUMMARY_KEYS = keySet('state', 'wedding_id', 'package_code', 'price_version', 'merchant_reference',
  'order_status', 'attempt_status', 'captured_at', 'closed_at', 'quote_expires_at', 'price_available',
  'price_display_enabled', 'entitlement_status', 'publish_gate', 'refund_kind', 'refund_status');
// §7: while display is unapproved the amount is *absent*, and `price_display_enabled` is already one of the
// base sixteen — it flips, it does not arrive. So approval adds exactly these two names. An earlier line
// here also counted the flag as an arrival and failed on its own guesswork, not on the product (run r8).
const PAID_SUMMARY_KEYS = keySet('amount_minor', 'currency');

/** One ledger row, read as the eight columns that describe what this build decided about it. `digest` is
 *  last so a case can end the line with the value it computed over the bytes it signed. */
const ledgerRow = (eventId, what = `the ledger row for ${eventId}`) => cell(`
  select 'kind=' || kind || ' status=' || processing_status
    || ' effect=' || coalesce(applied_effect, '-') || ' hold=' || coalesce(hold_reason, '-')
    || ' refusal=' || coalesce(refusal_reason, '-') || ' sig=' || signature_valid::text
    || ' order=' || coalesce(order_id::text, '-') || ' attempt=' || coalesce(attempt_id::text, '-')
    || ' mr=' || coalesce(merchant_reference, '-') || ' amount=' || coalesce(amount_minor::text, '-')
    || ' currency=' || coalesce(currency, '-') || ' environment=' || environment
    || ' digest=' || raw_body_sha256
  from private.commerce_payment_events where event_id = '${eventId}'`, what);

/** One named field out of `ledgerRow`'s single line. That line is built to be read in a failure message,
 *  so a case that needs a column asks for it *by name* rather than hoping two columns happen to be
 *  neighbours: run r8 measured two such hopes fail (`order=- attempt=- mr=-` and
 *  `amount=190000 currency=INR environment=synthetic`) on rows whose every column was correct. */
const rowField = (row, name) => {
  const found = new RegExp(`(?:^| )${name}=([^ ]*)`).exec(row);
  assert.ok(found, `the ledger line carries no ${name} field: ${shown(row)}`);
  return found[1];
};

/** The one column of that row a case needs on its own, because two ledger rows holding the same digest is
 *  how this file proves two deliveries carried the same bytes. */
const digestFor = (eventId) => cell(
  `select raw_body_sha256 from private.commerce_payment_events where event_id = '${eventId}'`,
`the body digest of ${eventId}`);

const OBSERVED_LISTS = ['events', 'attempts', 'refunds'];

/** The order and everything the ledger says about it, in the driver's own one-round-trip form. Used
 *  instead of reading the projection because group D puts four unfinished purchases on one wedding, where
 *  the projection's tie-break would answer about the newest of them and say nothing about this one.
 *
 *  The three lists are normalised here rather than at each call site: the driver builds them with
 *  `json_agg`, whose answer for no rows is SQL NULL, and a case that asks "did this delivery mint an
 *  attempt?" is asking a question about a list, not about which aggregate spelling the reader happened to
 *  use. */
const observe = (key) => {
  const o = run(observeOrderSql({ orderId: orders[key].order_id }), `observation of ${key}`);
  for (const name of OBSERVED_LISTS) o[name] ??= [];
  return o;
};

const reconcile = (key, actor = uidOf('hostA')) => run(
  reconcileOrderSql({ orderId: orders[key].order_id, actorUserId: actor }), `reconciliation of ${key}`);
const findingsOf = (sweep) => sweep.findings.map((f) => f.code).sort().join(',');

/** The driver's statement, re-cast for `refusalOf`: the envelope is a `SELECT` of a base64 digest, and a
 *  plpgsql block cannot hold a bare SELECT. Unwrapping the driver's own envelope rather than hand-writing
 *  fifteen arguments keeps the negative arms measuring the exact call the instrument would have made, and
 *  the two shape assertions below are what fail loudly if that envelope ever changes — a half-stripped
 *  statement would otherwise be refused for a syntax error and score as a pass. */
function performOf(statement, what) {
  const inner = statement
    .replace(/^SELECT encode\(convert_to\(\(/, '')
    .replace(/\)::text, 'utf8'\), 'base64'\);\s*$/, '');
  assert.match(inner, /^internal_api\.[a-z_]+\(/,
    `${what}: the driver's statement envelope is not the shape this unwrap knows: ${shown(statement).slice(0, 200)}`);
  assert.match(inner, /\)$/,
    `${what}: unwrapping the envelope lost the call's own closing parenthesis: ${shown(statement).slice(0, 200)}`);
  return `PERFORM ${inner}`;
}

/** The exact statement a signed delivery *would* send, captured without sending it. `runDelivery` takes
 *  its SQL channel as an argument, so a channel that records the text and answers with an empty document
 *  measures the same fifteen-argument call the ledger would have received. An arm that must be *refused*
 *  needs this: once a delivery has actually aborted its own transaction, the statement that aborted it is
 *  gone and only `psql`'s last CONTEXT line is left, which names no SQLSTATE. */
function statementFor(caseId, {
  provider = 'razorpay', body, eventId, secret = SECRET, signWith = secret, timestamp,
  environment = 'synthetic', as = 'hostA',
}) {
  const delivery = provider === 'razorpay'
    ? razorpayDelivery({ body, secret: signWith, eventId })
    : cashfreeDelivery({ body, secret: signWith, timestamp, now: Date.now() });
  const seen = [];
  const out = runDelivery({
    sql: (text) => { seen.push(text); return Buffer.from('{}').toString('base64'); },
    delivery, secret, environment, actorUserId: uidOf(as),
  });
  assert.equal(out.verified, true,
    `${caseId}: an unverified delivery has no statement to refuse: ${json(out)}`);
  assert.equal(seen.length, 1, `${caseId}: the delivery never reached a statement: ${json(out)}`);
  return out.statement;
}

/** A refusal that never reaches plpgsql, because the role is not allowed to ask: the server's own
 *  permission error, read from `psql`'s output rather than from an exception block. */
function refusedAtTheRole(statement, pattern, what) {
  let text = null;
  try {
    exec(statement, what);
  } catch (error) {
    text = String(error.message);
  }
  assert.notEqual(text, null, `${what}: ${shown(statement).slice(0, 160)} was accepted`);
  assert.match(text, pattern, `${what}: got ${shown(text).slice(0, 300)}`);
  return text;
}

const auditLine = (action, subjectKey, what = `the ${action} audit row`) => cell(`
  select coalesce(action, '-') || '/' || subject_type || '/' || actor_user_id::text
    || '/mode=' || coalesce(payload ->> 'revocation_mode', '-')
  from private.audit_events where action = '${action}' and subject_key = '${subjectKey}'::uuid
  order by id desc limit 1`, what);

/** Weddings this run creates beyond the two `before()` builds. Group D needs a wedding whose projection
 *  it never reads (four unfinished purchases live there at once), and `after()` must know about them. */
const extraWeddings = [];
async function weddingOnly(who, label) {
  const w = await call('POST', '/rest/v1/weddings', {
    bearer: tokenOf(who),
    body: { owner_user_id: uidOf(who), title: `S10 HTTP ${label} ${RUN_TAG}`, primary_language: 'en' },
    headers: { Prefer: 'return=representation' },
  });
  assert.equal(w.status, 201, `${who} could not create the ${label} wedding: ${json(w.body)}`);
  extraWeddings.push(w.body[0].id);
  return w.body[0].id;
}

const idFor = (name) => `${RUN_TAG}_${name}`;

// --------------------------------------------------------------------------- the census
const censusQuery = `select 'weddings='||count(*) from public.weddings
  union all select 'auth.users='||count(*) from auth.users
  union all select 'commerce_packages='||count(*) from private.commerce_packages
  union all select 'commerce_orders='||count(*) from private.commerce_orders
  union all select 'commerce_payment_attempts='||count(*) from private.commerce_payment_attempts
  union all select 'commerce_payment_events='||count(*) from private.commerce_payment_events
  union all select 'commerce_refunds='||count(*) from private.commerce_refunds
  union all select 'entitlements='||count(*) from public.entitlements
  union all select 'commerce_audit='||count(*) from private.audit_events
    where subject_type in ('commerce_order','commerce_event','entitlement','reconciliation')
  union all select 'publications='||count(*) from public.publications
  union all select 'invitation_versions='||count(*) from public.invitation_versions
  union all select 'invitation_outputs='||count(*) from public.invitation_outputs`;
const census = () => Object.fromEntries(sqlRows(censusQuery).map((r) => r.split('=')));

// The shipped posture, as one line: permissive, no package code demanded (`-` — `array_to_string` of the
// migration's own `'{}'` default is the empty string, and an empty field between two separators is easy to
// read as a missing column), capture off, refunds held for review.
const POLICY_DEFAULTS = 'permissive|-|false|hold_for_review';
const policyLine = () => cell(`
  select publish_gate || '|' || coalesce(nullif(array_to_string(publish_required_package_codes, ','), ''), '-')
    || '|' || live_capture_enabled::text || '|' || refund_revocation_mode
  from private.commerce_policy where id = 1`, 'the policy singleton');

const setPolicy = (sqlText_, what) => exec(`update private.commerce_policy set ${sqlText_} where id = 1`, what);

// --------------------------------------------------------------------------- the gate
let gate = null;   // { weddingId, versionId, orderRowId } for the wedding group G is built on

before(async () => {
  console.log(`  sql channel=${TARGET.mode}`
    + (TARGET.mode === 'docker' ? ` container=${TARGET.container}`
      : ` psql=${PSQL_BIN} host=${new URL(TARGET.url).hostname}:${new URL(TARGET.url).port}`)
    + ` (REST target=${url})`);
  ensureSafeEncoding((probe) => runPsql(TARGET, probe));
  baseline = census();

  // The surface first, from the catalog rather than from this file's constants: a stack one migration
  // behind has none of these names, and every case below would then answer 404 — which reads exactly
  // like the refusals this file asserts.
  const apiNames = sqlRows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.proname like 'commerce%' order by 1`);
  assert.deepEqual(apiNames, ['commerce_host_summary'],
    'the Stage 10 exposed wrapper is not deployed, so every door below answers 404 for the wrong reason');
  // Measured against the catalog, name for name, and the names are the migration's own: the seven bodies
  // the trusted instrument calls live in `internal_api`, the two trigger guards in `private` (migration
  // :157 and :524), and only the summary wrapper is re-exposed under `api`. A count would let a renamed or
  // missing body through as long as another appeared.
  const internalNames = sqlRows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal_api' and p.proname in ('create_commerce_order','grant_commerce_entitlement',
      'revoke_commerce_entitlement','expire_commerce_order','record_commerce_event','commerce_reconcile',
      'commerce_host_summary') order by 1`);
  assert.deepEqual(internalNames,
    ['commerce_host_summary', 'commerce_reconcile', 'create_commerce_order', 'expire_commerce_order',
      'grant_commerce_entitlement', 'record_commerce_event', 'revoke_commerce_entitlement'],
    'the Stage 10 service bodies are not all deployed, so every door below answers 404 for the wrong reason');
  const guardNames = sqlRows(`select n.nspname||'.'||p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname in ('guard_publication_commerce_gate','guard_commerce_order_freeze') order by 1`);
  assert.deepEqual(guardNames, ['private.guard_commerce_order_freeze', 'private.guard_publication_commerce_gate'],
    `the Stage 10 trigger guards are not where the migration puts them: ${JSON.stringify(guardNames)}`);
  const gateTrigger = cell(`select count(*)::text from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'publications'
      and t.tgname = 'publications_commerce_publish_gate' and not t.tgisinternal`,
  'the publish-gate trigger count');
  assert.equal(gateTrigger, '1', 'the publish gate is not wired to public.publications');

  for (const table of COMMERCE_TABLES) {
    assert.equal(postureOf(table), 'rls=true grants=none guards=2',
      `private.${table} is not in the shipped four-layer posture, so N-01 would measure a different table`);
  }

  // The shared posture, asserted before anything touches it. `run.sh` runs suites serially against this
  // database; a stack that arrived out of posture would make every restoration below a lie.
  assert.equal(policyLine(), POLICY_DEFAULTS,
    'the policy singleton is not in the shipped posture at the start of the run');
  assert.equal(count('from private.commerce_packages'), '0',
    'the catalogue is not empty at the start of the run, so the price rows this suite writes would not '
    + 'be the only ones group P projects');
  // The four money stores too: they were created empty by the migration, and Z-03's claim that every row
  // in them belongs to this run is only measurable if that is still true when the run starts. A row left
  // here by an earlier probe is this suite's own residue, and it belongs in the probe that made it.
  for (const store of ['commerce_orders', 'commerce_payment_attempts', 'commerce_payment_events', 'commerce_refunds']) {
    assert.equal(count(`from private.${store}`), '0',
      `private.${store} is not empty at the start of the run, so Z-03 cannot attribute its rows`);
  }

  for (const who of WHO) Object.assign(people[who] ??= {}, await signUp(who));
  const a = await buildWedding('hostA', 'A');
  people.hostA.weddingId = a.weddingId;
  people.hostA.versionId = a.versionId;
  const b = await buildWedding('hostB', 'B');
  people.hostB.weddingId = b.weddingId;
  people.hostB.versionId = b.versionId;
  gate = { weddingId: b.weddingId, versionId: b.versionId };

  // And the two channels proved to be one database rather than assumed to be: both weddings above went in
  // over REST, so reading them back by id through this SQL channel is what turns every count, posture and
  // ledger row asserted below into a statement about the stack the product talks to. A channel aimed at
  // somebody else's cluster answers zero rows here and the run stops before it writes money.
  const roundTrip = sqlRows(`select id::text from public.weddings where id in ('${a.weddingId}', '${b.weddingId}')`);
  assert.deepEqual([...roundTrip].sort(), [a.weddingId, b.weddingId].sort(),
    `the SQL channel (${TARGET.mode}) does not see the weddings REST just wrote, so it is not this `
    + 'stack\'s database');
  assert.equal(cell(`select current_database()`, 'the SQL channel database name'), 'postgres',
    'the SQL channel is not connected to the stack\'s own `postgres` database');
});

after(async () => {
  const weddings = [...new Set([weddingOf('hostA'), weddingOf('hostB'), ...extraWeddings].filter(Boolean))];
  if (weddings.length >= 2) {
    const ids = weddings.map((w) => `'${w}'::uuid`).join(',');
    // Child before parent, read off the migration's own FK clauses: refunds and events hang off orders,
    // attempts hang off orders, and `commerce_orders.entitlement_id` hangs off `public.entitlements`, so
    // the entitlements go last of the money five even though the orders point at them.
    for (const stmt of [
      `delete from private.commerce_refunds where order_id in (select id from private.commerce_orders where wedding_id in (${ids}))`,
      // The identity sweep first: a `rejected_signature` row has no `order_id` at all (migration :1201
      // nulls the link for `unknown_order`, and the refusal branch never resolved one), so the
      // wedding-scoped delete below cannot see it and probe nine's residue proved it.
      `delete from private.commerce_payment_events where order_id in (select id from private.commerce_orders where wedding_id in (${ids})) or event_id like '${RUN_TAG}%'`,
      `delete from private.commerce_payment_attempts where order_id in (select id from private.commerce_orders where wedding_id in (${ids}))`,
      `delete from private.commerce_orders where wedding_id in (${ids})`,
      `delete from public.entitlements where wedding_id in (${ids})`,
      `delete from private.audit_events where wedding_id in (${ids})
         and subject_type in ('commerce_order','commerce_event','entitlement','reconciliation')`,
      `delete from private.access_tokens where wedding_id in (${ids})
         or publication_id in (select id from public.publications where wedding_id in (${ids}))`,
      `delete from public.approval_requests where wedding_id in (${ids})`,
      // Stage 9's manifest hangs off both the wedding and the version with NO ACTION, so it goes before
      // either. A publish that registers nothing leaves this as a no-op; a publish that did register an
      // artefact would otherwise strand the whole teardown on a constraint error.
      `delete from public.invitation_outputs where wedding_id in (${ids})`,
      `delete from public.publications where wedding_id in (${ids})`,
      `delete from public.invitation_versions v where v.wedding_id in (${ids})
         and v.id not in (select supersedes_version_id from public.invitation_versions
                           where supersedes_version_id is not null)`,
      `delete from public.invitation_versions where wedding_id in (${ids})`,
      `delete from public.weddings where id in (${ids})`,
    ]) exec(stmt, `teardown of ${stmt.slice(0, 62)}`);
  }
  // The two shared posture objects go last and unconditionally: the catalogue this run wrote, and the
  // policy singleton this run flipped. `updated_at` moves with a trigger the run cannot and must not
  // suppress, so the posture is restored by value, not by re-writing the row verbatim.
  for (const stmt of [
    `delete from private.commerce_packages where package_code like '${RUN_TAG}%'`,
    `update private.commerce_policy set publish_gate = 'permissive',
       publish_required_package_codes = '{}'::text[], live_capture_enabled = false,
       refund_revocation_mode = 'hold_for_review' where id = 1`,
  ]) exec(stmt, `teardown of ${stmt.slice(0, 62)}`);

  for (const who of WHO) {
    if (!uidOf(who)) continue;
    const res = await fetch(`${url}/auth/v1/admin/users/${uidOf(who)}`, {
      method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    assert.ok(res.ok, `teardown could not remove a synthetic account (HTTP ${res.status})`);
  }

  const now = census();
  const moved = Object.keys(baseline).filter((k) => baseline[k] !== now[k]);
  assert.deepEqual(moved, [],
    `teardown did not give everything back: ${shown(moved.map((k) => `${k} ${baseline[k]}->${now[k]}`).join(', '))}`);
  assert.equal(policyLine(), POLICY_DEFAULTS, 'the policy singleton did not come back to the shipped posture');
  assert.equal(count(`from private.commerce_packages where package_code like '${RUN_TAG}%'`), '0',
    'a price row this run wrote outlived the run');
  assert.equal(count(`from private.commerce_payment_events where event_id like '${RUN_TAG}%'`), '0',
    'a ledger row this run signed outlived the run');
  assert.ok(!sqlRows(`select id::text from private.commerce_orders`).length
    || count('from private.commerce_orders') === baseline.commerce_orders,
  'a commerce order this run quoted outlived the run');
  console.log(`  transport_retries=${transportRetries} (reads whose socket died before any response, `
    + 'and were sent a second time; 0 means no contention was met, not that the path is untested)');
  console.log('  residue census after the Stage 10 HTTP teardown (whole database):');
  for (const line of sqlRows(censusQuery)) console.log(shown(`    ${line}`));
});

// ---------------------------------------------------------------------------
// S — the summary door: which credential spelling answers, and what it answers
// ---------------------------------------------------------------------------
describe('S10 SUMMARY DOOR', () => {
  test('S-01: the owner\'s own wedding through the product\'s spelling: 200 and the projection', async () => {
    const res = await summary('hostA', weddingOf('hostA'));
    assert.equal(res.status, 200, `S-01: ${res.status} ${json(res.body)}`);
    assert.equal(keysOf(res.body), SUMMARY_KEYS, 'S-01: the projection is not the sixteen names §7 measured');
  });

  test('S-02: anon at the same door is refused by the grant, not by the wedding', async () => {
    const res = await rpc('commerce_host_summary', { p_wedding_id: weddingOf('hostA') }, { as: 'anon' });
    assert.equal(res.status, 401, `S-02: ${json(res.body)}`);
    assert.equal(res.body.code, '42501', 'S-02: anon should be refused on EXECUTE');
    assert.match(res.body.message, /permission denied for function commerce_host_summary/,
      `S-02: ${json(res.body)}`);
  });

  test('S-03: the service key is refused at the schema, and no token substitutes for postgres', async () => {
    const withProfile = await rpc('commerce_host_summary', { p_wedding_id: weddingOf('hostA') },
      { as: 'service', profile: 'api' });
    assert.equal(withProfile.status, 403, `S-03a: ${json(withProfile.body)}`);
    assert.match(withProfile.body.message, /permission denied for schema api/, `S-03a: ${json(withProfile.body)}`);
    const noProfile = await rpc('commerce_host_summary', { p_wedding_id: weddingOf('hostA') },
      { as: 'service', profile: null });
    assert.equal(noProfile.status, 404, `S-03b: ${json(noProfile.body)}`);
    assert.equal(noProfile.body.code, 'PGRST202', 'S-03b: with no profile PostgREST searches public only');
    assert.match(noProfile.body.message, /public\.commerce_host_summary/,
      `S-03b: the 404 should name the public spelling it searched for: ${json(noProfile.body)}`);
  });

  test('S-04: a browser role naming the unexposed schema gets 406, not a privilege answer', async () => {
    const res = await rpc('commerce_host_summary', { p_wedding_id: weddingOf('hostA') },
      { as: 'hostA', profile: 'internal_api' });
    assert.equal(res.status, 406, `S-04: ${json(res.body)}`);
    assert.equal(res.body.code, 'PGRST106', 'S-04: internal_api is not an exposed schema');
    assert.match(res.body.hint, /Only the following schemas are exposed: public, api/,
      `S-04: ${json(res.body)}`);
  });

  test('S-05: the same door without a profile is a 404 about a different function', async () => {
    const res = await summary('hostA', weddingOf('hostA'), { profile: null });
    assert.equal(res.status, 404, `S-05: ${json(res.body)}`);
    assert.match(res.body.message, /public\.commerce_host_summary/,
      `S-05: the wrapper lives in api, so no profile must not reach it: ${json(res.body)}`);
  });

  test('S-06: one host cannot read the other host\'s wedding', async () => {
    const res = await summary('hostA', weddingOf('hostB'));
    assert.equal(res.status, 403, `S-06: ${json(res.body)}`);
    assert.equal(res.body.code, '42501', 'S-06: owner-only is an insufficient_privilege refusal');
    assert.ok(res.body.message.includes(SAY.notRead), `S-06: ${json(res.body)}`);
  });

  test('S-07 and S-08: a foreign well-formed uuid and a nonexistent one answer identically', async () => {
    const foreign = await summary('hostA', NOT_A_WEDDING);
    const missing = await summary('hostA', NOT_A_WEDDING_2);
    assert.equal(foreign.status, 403, `S-07: ${json(foreign.body)}`);
    assert.equal(missing.status, 403, `S-08: ${json(missing.body)}`);
    assert.equal(foreign.text, missing.text,
      'S-07/S-08: the two refusals differ, which would hand an attacker an oracle for "this wedding exists"');
    assert.ok(foreign.body.message.includes(SAY.notRead), `S-07: ${json(foreign.body)}`);
  });

  test('S-09: a malformed uuid is refused by the cast, before any commerce read happens', async () => {
    const res = await summary('hostA', 'not-a-uuid');
    assert.equal(res.status, 400, `S-09: ${json(res.body)}`);
    assert.equal(res.body.code, '22P02', 'S-09: the uuid cast, not a policy, should be what refuses');
  });

  test('S-10: a signed-in stranger with no wedding is refused like a foreign one', async () => {
    const res = await summary('stranger', weddingOf('hostA'));
    assert.equal(res.status, 403, `S-10: ${json(res.body)}`);
    assert.equal(res.text, (await summary('hostA', weddingOf('hostB'))).text,
      'S-10: a stranger gets a different sentence from a foreign owner, which is an oracle');
  });

  test('S-11: the empty catalogue projects no_purchase with price_available false', async () => {
    const res = await summary('hostA', weddingOf('hostA'));
    assert.equal(res.status, 200, `S-11: ${json(res.body)}`);
    assert.equal(res.body.state, 'no_purchase', 'S-11: a wedding with no order is not unpaid, it is unquoted');
    assert.equal(res.body.price_available, false,
      'S-11: §7 requires "not on sale" to be a different sentence from "unpaid"');
    assert.ok(!('amount_minor' in res.body) && !('currency' in res.body),
      `S-11: an amount appeared before any price row existed: ${json(res.body)}`);
    assert.equal(res.body.publish_gate, 'permissive', 'S-11: the projection carries the gate posture');
    assert.equal(res.body.merchant_reference, null, 'S-11: no order, so no reference');
  });
});

// ---------------------------------------------------------------------------
// P — the price posture: what display approval adds, and what nothing ever adds
// ---------------------------------------------------------------------------
describe('S10 PRICE POSTURE', () => {
  test('P-01: a quote with no active price is refused, which is every fresh install', () => {
    refused(`PERFORM internal_api.create_commerce_order(${sqlUuid(weddingOf('hostA'), 'wedding')}, `
      + `${sqlText(CODE.classic)}, ${sqlUuid(uidOf('hostA'), 'actor')})`,
    say('P0001', SAY.noPrice, CODE.classic), 'P-01: the empty-catalogue refusal');
  });

  test('P-02: one active, unapproved price exists', () => {
    insertPackage(CODE.classic, { approved: false });
    assert.equal(cell(`select status || '/' || display_approved::text from private.commerce_packages
      where package_code = '${CODE.classic}'`, 'the classic price row'), 'active/false');
  });

  test('P-03: the quote returns the frozen calculation, and no provider object', () => {
    const q = quote('classic', { weddingId: weddingOf('hostA'), packageCode: CODE.classic, actor: uidOf('hostA') });
    assert.equal(keysOf(q), BASE_ORDER_KEYS, `P-03: ${json(q)}`);
    assert.match(q.merchant_reference, MERCHANT_REF, `P-03: ${q.merchant_reference}`);
    assert.equal(q.status, 'open', 'P-03: a quote is open');
    assert.equal(q.amount_minor, PRICE.classic, 'P-03: the amount comes from the pinned price row');
    assert.equal(q.currency, 'INR', 'P-03: the currency comes from the pinned price row');
    assert.equal(q.price_display_approved, false, 'P-03: the quote reports the approval it read');
    assert.ok(!('checkout_url' in q) && !('provider' in q),
      `P-03: a quote handed back something that opens a checkout: ${json(q)}`);
  });

  test('P-04: while display is unapproved, the amount is absent from the host projection', async () => {
    const res = await summary('hostA', weddingOf('hostA'));
    assert.equal(res.status, 200, `P-04: ${json(res.body)}`);
    assert.equal(res.body.state, 'quote_open', `P-04: ${json(res.body)}`);
    assert.equal(res.body.price_available, true, 'P-04: a price row now exists for this package');
    assert.equal(res.body.price_display_enabled, false, 'P-04: approval is what the flag reports');
    assert.ok(!('amount_minor' in res.body),
      `P-04: the projection carried an amount (§7 requires absence, not null): ${json(res.body)}`);
    assert.ok(!('currency' in res.body), `P-04: ${json(res.body)}`);
    assert.equal(keysOf(res.body), SUMMARY_KEYS, 'P-04: the unapproved projection is the base sixteen');
  });

  test('P-05: approving the display adds exactly the two money names, and their values', async () => {
    exec(`update private.commerce_packages set display_approved = true where package_code = '${CODE.classic}'`,
    'the display approval');
    const res = await summary('hostA', weddingOf('hostA'));
    assert.equal(res.status, 200, `P-05: ${json(res.body)}`);
    const added = Object.keys(res.body).filter((k) => !SUMMARY_KEYS.split(',').includes(k)).sort();
    assert.equal(added.join(','), PAID_SUMMARY_KEYS, `P-05: approval added ${json(added)}`);
    assert.equal(added.length, 2, `P-05: approval added ${json(added)}`);
    assert.equal(res.body.price_display_enabled, true,
      `P-05: the flag is one of the base sixteen and must flip, not arrive: ${json(res.body)}`);
    assert.equal(res.body.amount_minor, PRICE.classic, 'P-05: the approved amount is the frozen quote');
    assert.equal(res.body.currency, 'INR', 'P-05: the approved currency is the frozen quote');
  });

  test('P-06: no posture of this door ever carries operational configuration', async () => {
    const FORBIDDEN = ['live_capture_enabled', 'publish_required_package_codes', 'refund_revocation_mode',
      'owner_user_id', 'price_display_approved', 'created_at', 'updated_at', 'snapshot'];
    const seen = [];
    seen.push((await summary('hostA', weddingOf('hostA'))).body);
    seen.push((await summary('hostB', weddingOf('hostB'))).body);
    for (const body of seen) {
      for (const name of FORBIDDEN) {
        assert.ok(!(name in body), `P-06: the projection carried ${name}: ${json(body)}`);
      }
    }
  });

  test('P-07: a draft price row is not a price, whatever its display flag says', () => {
    insertPackage(CODE.unapproved, { status: 'draft', approved: false });
    refused(`PERFORM internal_api.create_commerce_order(${sqlUuid(weddingOf('hostA'), 'wedding')}, `
      + `${sqlText(CODE.unapproved)}, ${sqlUuid(uidOf('hostA'), 'actor')})`,
    say('P0001', SAY.noPrice, CODE.unapproved), 'P-07: a draft price must not be quotable');
  });

  test('P-08: ownership is read from the wedding, not accepted from the caller', () => {
    // The cross-wedding attack at the quote: hostB names hostA's wedding.
    refused(`PERFORM internal_api.create_commerce_order(${sqlUuid(weddingOf('hostA'), 'wedding')}, `
      + `${sqlText(CODE.classic)}, ${sqlUuid(uidOf('hostB'), 'actor')})`,
    say('42501', SAY.notOwner, weddingOf('hostA')), 'P-08: a quote for somebody else\'s wedding');
    refused(`PERFORM internal_api.create_commerce_order(${sqlUuid(NOT_A_WEDDING, 'wedding')}, `
      + `${sqlText(CODE.classic)}, ${sqlUuid(uidOf('hostA'), 'actor')})`,
    say('P0001', SAY.noWedding, NOT_A_WEDDING), 'P-09: a quote for a wedding that is not there');
    refused(`PERFORM internal_api.create_commerce_order(NULL::uuid, ${sqlText(CODE.classic)}, `
      + `${sqlUuid(uidOf('hostA'), 'actor')})`,
    say('23514', SAY.quoteShape), 'P-10: a quote with no wedding');
    refused(`PERFORM internal_api.create_commerce_order(${sqlUuid(weddingOf('hostA'), 'wedding')}, `
      + `''::text, ${sqlUuid(uidOf('hostA'), 'actor')})`,
    say('23514', SAY.quoteShape), 'P-11: a quote with a blank package code');
  });

  test('P-12: one live order per wedding and package, and no second quote alongside the first', () => {
    const answer = refusalOf(`PERFORM internal_api.create_commerce_order(${sqlUuid(weddingOf('hostA'), 'wedding')}, `
      + `${sqlText(CODE.classic)}, ${sqlUuid(uidOf('hostA'), 'actor')})`, 'P-12: the second live quote');
    assert.match(answer, /^23505 /, `P-12: ${shown(answer)}`);
    assert.ok(answer.includes(SAY.liveOrder) && answer.includes(orders.classic.merchant_reference),
      `P-12: the refusal should name the live order it found: ${shown(answer)}`);
  });

  test('P-13: a quote cannot be minted against a nonexistent order or read back from one', () => {
    refused(`PERFORM internal_api.grant_commerce_entitlement(${sqlUuid(NOT_AN_ORDER, 'order')}, `
      + `${sqlUuid(uidOf('hostA'), 'actor')})`,
    say('P0001', SAY.noGrantOrder, NOT_AN_ORDER), 'P-13a: grant from nothing');
    refused(`PERFORM internal_api.expire_commerce_order(${sqlUuid(NOT_AN_ORDER, 'order')}, `
      + `${sqlUuid(uidOf('hostA'), 'actor')})`,
    say('P0001', SAY.noExpireOrder, NOT_AN_ORDER), 'P-13b: expire nothing');
    refused(`PERFORM internal_api.commerce_reconcile(${sqlUuid(NOT_AN_ORDER, 'order')}, `
      + `${sqlUuid(uidOf('hostA'), 'actor')})`,
    say('P0001', SAY.noReconOrder, NOT_AN_ORDER), 'P-13c: reconcile nothing');
    refused(`PERFORM internal_api.revoke_commerce_entitlement(${sqlUuid(NOT_AN_ORDER, 'order')}, `
      + `${sqlUuid(uidOf('hostA'), 'actor')}, ${sqlText('a reason')})`,
    say('P0001', SAY.noRevokeOrder, NOT_AN_ORDER), 'P-13d: revoke nothing');
  });

  test('P-14: a revocation that does not say why is refused', () => {
    refused(`PERFORM internal_api.revoke_commerce_entitlement(${sqlUuid(orders.classic.order_id, 'order')}, `
      + `${sqlUuid(uidOf('hostA'), 'actor')}, ''::text)`,
    say('23514', 'a revocation must say why'), 'P-14: a nameless revocation');
  });

  test('P-15: the ledger refuses a kind it has not read a rule for', () => {
    refused(`PERFORM internal_api.record_commerce_event('razorpay'::text, '${RUN_TAG}_shape'::text, `
      + `NULL::text, 'payment_miraculous'::text, 'synthetic'::text, '${'0'.repeat(64)}'::text, true, `
      + `NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::timestamptz, `
      + `${sqlUuid(uidOf('hostA'), 'actor')})`,
    say('23514', SAY.kindShape), 'P-15a: an unknown kind');
    refused(`PERFORM internal_api.record_commerce_event('paytm'::text, '${RUN_TAG}_shape2'::text, `
      + `NULL::text, 'other'::text, 'synthetic'::text, '${'0'.repeat(64)}'::text, true, `
      + `NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::timestamptz, `
      + `${sqlUuid(uidOf('hostA'), 'actor')})`,
    say('23514', SAY.providerShape), 'P-15b: an unread provider');
    refused(`PERFORM internal_api.record_commerce_event('razorpay'::text, ''::text, `
      + `NULL::text, 'other'::text, 'synthetic'::text, '${'0'.repeat(64)}'::text, true, `
      + `NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::timestamptz, `
      + `${sqlUuid(uidOf('hostA'), 'actor')})`,
    say('23514', SAY.noIdentity), 'P-15c: a delivery with no identity');
    refused(`PERFORM internal_api.record_commerce_event('razorpay'::text, '${RUN_TAG}_shape3'::text, `
      + `NULL::text, 'other'::text, 'synthetic'::text, 'not-a-digest'::text, true, `
      + `NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::timestamptz, `
      + `${sqlUuid(uidOf('hostA'), 'actor')})`,
    say('23514', SAY.digestShape), 'P-15d: a verdict with no digest');
  });

  test('P-16: granting from an un-captured order is refused rather than silently skipped', () => {
    refused(`PERFORM internal_api.grant_commerce_entitlement(${sqlUuid(orders.classic.order_id, 'order')}, `
      + `${sqlUuid(uidOf('hostA'), 'actor')})`,
    say('23514', SAY.notCaptured), 'P-16: an open order carries no captured money');
  });
});

// ---------------------------------------------------------------------------
// D — the purchase, driven by the instrument over signed bytes
// ---------------------------------------------------------------------------
describe('S10 DELIVERIES', () => {
  const t0 = Math.floor(Date.now() / 1000);
  const classicCapture = (name, createdAt = t0) => rzBody('payment.captured', idFor(name), createdAt, {
    payment: { entity: payEntity(orders.classic.merchant_reference, 'CL') },
    order: { entity: orderEntity(orders.classic.merchant_reference, 'CL') },
  });
  /** A wedding that is never read through the projection. Group D keeps four unfinished purchases alive
   *  at once, and `commerce_host_summary` answers one order per wedding by tie-break, so a projection read
   *  here would describe whichever of them happened to be newest rather than the one under test. */
  let workshop = null;
  const WRONG_SECRET = randomBytes(32).toString('hex');

  test('D-01: the projection follows the initiation into payment_pending', async () => {
    const out = deliver('D-01', {
      eventId: idFor('init'),
      body: rzBody('payment.created', idFor('init'), t0 - 60, {
        payment: { entity: { ...payEntity(orders.classic.merchant_reference, 'CL', PRICE.classic), status: 'created' } },
        order: { entity: orderEntity(orders.classic.merchant_reference, 'CL') },
      }),
    });
    const r = resultOf('D-01', out);
    assert.equal(keysOf(r), APPLIED_KEYS, `D-01: ${json(r)}`);
    assert.equal(r.disposition, 'applied', `D-01: ${json(r)}`);
    assert.equal(r.applied_effect, 'attempt_initiated', `D-01: ${json(r)}`);
    assert.equal(r.order_status, 'payment_pending', 'D-01: an initiation moves the order to pending');
    assert.equal(r.state_changed, true, 'D-01: the order really moved');
    assert.match(r.attempt_id, UUID, `D-01: ${json(r)}`);
    assert.equal(r.entitlement_id, null, 'D-01: an initiation grants nothing');
    const res = await summary('hostA', weddingOf('hostA'));
    assert.equal(res.body.state, 'payment_pending', `D-01: ${json(res.body)}`);
  });

  test('D-02: level-1 idempotency answers with the first row and writes nothing', () => {
    const replay = () => deliver('D-02', { eventId: idFor('init'), body: rzBody('payment.created', idFor('init'), t0 - 60, {
      payment: { entity: { ...payEntity(orders.classic.merchant_reference, 'CL'), status: 'created' } },
      order: { entity: orderEntity(orders.classic.merchant_reference, 'CL') },
    }) });
    const r = resultOf('D-02', replay());
    assert.equal(keysOf(r), ALREADY_KEYS, `D-02: ${json(r)}`);
    assert.equal(r.disposition, 'already_recorded', 'D-02: a retry is the same event');
    // Read the row the ledger actually holds rather than a variable D-01 assigned: a case that inherits
    // another case's local state reports a cascade when the earlier arm merely had a bad day (run r8 lost
    // D-01 on the key-set ordering and D-02 then failed on `8 !== null`, with neither value in the message).
    const stored = cell(`select id::text from private.commerce_payment_events
       where event_id = '${idFor('init')}'`, 'the row the first initiation wrote');
    assert.equal(String(r.event_row_id), stored,
      `D-02: the retry answered with a row that is not the one the first delivery wrote `
      + `(retry said ${shown(String(r.event_row_id))}, the ledger holds ${shown(stored)})`);
    assert.equal(count(`from private.commerce_payment_events where event_id = '${idFor('init')}'`), '1',
      'D-02: one event id has one ledger row to answer from');
    assert.equal(r.processing_status, 'applied', 'D-02: the retry re-states the first answer, not a new one');
    const again = resultOf('D-02b', replay()).event_row_id;
    assert.equal(String(again), stored,
      `D-02c: two retries answered with two different rows (${shown(String(again))} vs ${shown(stored)})`);
    assert.equal(count(`from private.commerce_payment_events where event_id = '${idFor('init')}'`), '1',
      'D-02: three deliveries of one event id produced more than one ledger row');
    assert.equal(observe('classic').attempts.length, 1,
      'D-02: the retry minted a second attempt as well as a second answer');
  });

  test('D-03: the capture confirms the attempt and mints the entitlement in one statement', () => {
    const before = count('from public.entitlements', 'entitlements before the capture');
    const out = deliver('D-03', { eventId: idFor('cap'), body: classicCapture('cap', t0) });
    const r = resultOf('D-03', out);
    assert.equal(r.applied_effect, 'entitlement_granted', `D-03: ${json(r)}`);
    assert.equal(r.order_status, 'captured', 'D-03: a capture closes the quote');
    assert.match(r.entitlement_id, UUID, `D-03: ${json(r)}`);
    assert.equal(r.hold_reason, null, 'D-03: an applied row carries no hold');
    assert.equal(count('from public.entitlements', 'entitlements after the capture'),
      String(Number(before) + 1), 'D-03: the capture did not produce exactly one entitlement');
  });

  test('D-04: the host projection after capture is entitlement_active with the approved amount', async () => {
    const res = await summary('hostA', weddingOf('hostA'));
    assert.equal(res.body.state, 'entitlement_active', `D-04: ${json(res.body)}`);
    assert.equal(res.body.amount_minor, PRICE.classic, 'D-04: the approved price is still what it projects');
    assert.equal(res.body.entitlement_status, 'active', `D-04: ${json(res.body)}`);
    assert.notEqual(res.body.captured_at, null, 'D-04: a captured order carries its capture instant');
  });

  test('D-05: the ledger row is the evidence the instrument signed, byte for byte', () => {
    const row = cell(`select 'sig=' || signature_valid::text || ' status=' || processing_status
      || ' effect=' || coalesce(applied_effect,'-') || ' attempt=' || (attempt_id is not null)::text
      || ' amount=' || coalesce(amount_minor::text,'-') || ' currency=' || coalesce(currency,'-')
      || ' environment=' || environment || ' occurred=' || (occurred_at is not null)::text
      || ' digest=' || raw_body_sha256
      from private.commerce_payment_events where event_id = '${idFor('cap')}'`, 'the capture ledger row');
    assert.ok(row.includes('sig=true status=applied effect=entitlement_granted attempt=true'),
      `D-05: ${shown(row)}`);
    assert.ok(row.includes(`amount=${PRICE.classic} currency=INR environment=synthetic occurred=true`),
      `D-05: ${shown(row)}`);
    const signed = digests.find((d) => d.eventId === idFor('cap'));
    assert.ok(row.endsWith(signed.digest),
      `D-05: the ledger's digest is not the digest this run computed over the bytes it signed`);
  });

  test('D-06: an amount that disagrees with the frozen quote is held, linked, and prices nothing', async () => {
    workshop = await weddingOnly('hostA', 'workshop');
    insertPackage(CODE.second);
    quote('second', { weddingId: workshop, packageCode: CODE.second, actor: uidOf('hostA') });
    const out = deliver('D-06', {
      eventId: idFor('drift'),
      body: rzBody('payment.captured', idFor('drift'), t0, {
        payment: { entity: payEntity(orders.second.merchant_reference, 'SC', PRICE.classic) },
        order: { entity: orderEntity(orders.second.merchant_reference, 'SC') },
      }),
    });
    const r = resultOf('D-06', out);
    assert.equal(keysOf(r), RECORDED_KEYS, `D-06: ${json(r)}`);
    assert.equal(r.disposition, 'recorded', 'D-06: a held delivery is recorded, never applied');
    assert.equal(r.processing_status, 'held_for_reconciliation', `D-06: ${json(r)}`);
    assert.equal(r.hold_reason, 'amount_mismatch', `D-06: ${json(r)}`);
    assert.equal(r.applied_effect, null, 'D-06: a price disagreement decides nothing about the money');
    assert.equal(r.state_changed, false, 'D-06: the order did not move');
    assert.equal(r.order_id, orders.second.order_id,
      'D-06: a row that says "this quote disagrees with that order" has to name the order (§4.2 rule 4)');
    assert.equal(r.order_status, 'open', 'D-06: the order keeps its own status while the delivery waits');

    const row = ledgerRow(idFor('drift'));
    assert.ok(row.includes('kind=payment_captured status=held_for_reconciliation effect=- hold=amount_mismatch'),
      `D-06: ${shown(row)}`);
    assert.ok(row.includes(`amount=${PRICE.classic} currency=INR`),
      `D-06: the delivery's own claim is the evidence and must be kept verbatim: ${shown(row)}`);

    const obs = observe('second');
    assert.equal(obs.order.status, 'open', 'D-06: a held capture did not price or pay the order');
    assert.equal(obs.order.amount_minor, PRICE.second,
      'D-06: the order kept its own price instead of moving to the webhook\'s');
    assert.deepEqual(obs.attempts, [], 'D-06: nothing was minted from a delivery this build declined');
    assert.equal(obs.entitlement, null, 'D-06: a disputed amount granted no right');

    const sweep = reconcile('second');
    assert.equal(findingsOf(sweep), 'amount_drift', `D-06: ${json(sweep.findings)}`);
    assert.ok(sweep.findings[0].detail.includes(String(PRICE.second)),
      `D-06: the finding should name the price the order kept: ${json(sweep.findings[0])}`);
  });

  test('D-07: an unknown merchant reference is held with the link removed and a 2xx answer', () => {
    const out = deliver('D-07', {
      eventId: idFor('ghost'),
      body: rzBody('payment.captured', idFor('ghost'), t0, {
        payment: { entity: payEntity(NOT_A_REFERENCE, 'GH') },
        order: { entity: orderEntity(NOT_A_REFERENCE, 'GH') },
      }),
    });
    const r = resultOf('D-07', out);
    assert.equal(keysOf(r), RECORDED_KEYS, `D-07: ${json(r)}`);
    assert.equal(r.processing_status, 'held_for_reconciliation', `D-07: ${json(r)}`);
    assert.equal(r.hold_reason, 'unknown_order', `D-07: ${json(r)}`);
    // §4.2 rule 3: the answer a provider retry is met with is a kept row and a 2xx, not an error — an
    // error is what makes a provider stop retrying a delivery this build might legitimately learn to
    // accept later. The row is kept, and it is kept *unlinked*, because inventing an order from a
    // message is the one way a ledger acquires a purchase nobody quoted.
    assert.equal(r.order_id, null, 'D-07: an unknown reference must not be attached to a guessed order');
    assert.equal(r.order_status, null, 'D-07: there is no order here to report a status for');
    assert.equal(r.state_changed, false, `D-07: ${json(r)}`);

    const row = ledgerRow(idFor('ghost'));
    assert.equal(rowField(row, 'order'), '-', 'D-07: the link should be absent, not faked');
    assert.equal(rowField(row, 'attempt'), '-', 'D-07: and so should an attempt');
    assert.equal(rowField(row, 'mr'), NOT_A_REFERENCE,
      'D-07: the reference is how a human finds this later');
    assert.equal(rowField(row, 'amount'), String(PRICE.classic), `D-07: ${shown(row)}`);
    assert.equal(count(`from private.commerce_orders where merchant_reference = '${NOT_A_REFERENCE}'`), '0',
      'D-07: a delivery minted an order that no quote ever made');
  });

  test('D-08: provider mismatches are decided by the attempt that is open, not by the message', () => {
    insertPackage(CODE.stale);
    quote('stale', { weddingId: workshop, packageCode: CODE.stale, actor: uidOf('hostA') });
    const mr = orders.stale.merchant_reference;
    const init = resultOf('D-08a', deliver('D-08a', {
      eventId: idFor('st_init'),
      body: rzBody('payment.created', idFor('st_init'), t0 - 60, {
        payment: { entity: { ...payEntity(mr, 'ST', PRICE.stale), status: 'created' } },
        order: { entity: orderEntity(mr, 'ST') },
      }),
    }));
    assert.equal(init.applied_effect, 'attempt_initiated', `D-08a: ${json(init)}`);

    const cross = resultOf('D-08b', deliver('D-08b', {
      provider: 'cashfree', eventId: idFor('st_cf'),
      body: cfDoc('PAYMENT_STATE_CHANGED', idFor('st_cf'), t0, {
        payment_state_change: { to: 'COMPLETED' }, payment_order_id: mr,
        cf_payment_id: 'cf_pay_ST', cf_order_id: 'cf_order_ST',
        payment_amount: '3000.00', currency_code: 'INR',
      }),
    }));
    assert.equal(keysOf(cross), RECORDED_KEYS, `D-08b: ${json(cross)}`);
    assert.equal(cross.hold_reason, 'provider_mismatch', `D-08b: ${json(cross)}`);
    assert.equal(cross.processing_status, 'held_for_reconciliation', `D-08b: ${json(cross)}`);
    assert.equal(cross.order_status, 'payment_pending', 'D-08b: the Razorpay attempt is still what the order says');
    assert.equal(cross.state_changed, false, 'D-08b: a Cashfree message cannot confirm a Razorpay payment');

    const cfRow = ledgerRow(idFor('st_cf'));
    assert.ok(cfRow.includes(`attempt=${init.attempt_id}`),
      `D-08b: the held row should name the attempt it declined to confirm — the other provider's: ${shown(cfRow)}`);

    const obs = observe('stale');
    assert.equal(obs.attempts.length, 1, 'D-08b: the declined capture minted a second attempt');
    assert.equal(obs.attempts[0].provider, 'razorpay', `D-08b: ${json(obs.attempts)}`);
    assert.equal(obs.attempts[0].status, 'initiated', `D-08b: ${json(obs.attempts)}`);

    // The other half of the same rule: §4.2 checks the price before it checks the provider, so a delivery
    // that gets both wrong is held for the amount. Without this arm the order of the chain is unfalsified.
    const both = resultOf('D-08c', deliver('D-08c', {
      provider: 'cashfree', eventId: idFor('st_cf2'),
      body: cfDoc('PAYMENT_STATE_CHANGED', idFor('st_cf2'), t0, {
        payment_state_change: { to: 'COMPLETED' }, payment_order_id: mr,
        cf_payment_id: 'cf_pay_ST2', cf_order_id: 'cf_order_ST2',
        payment_amount: '2900.00', currency_code: 'INR',
      }),
    }));
    assert.equal(both.hold_reason, 'amount_mismatch',
      `D-08c: §4.2's chain prices the delivery before it compares providers: ${json(both)}`);
  });

  test('D-09: a delivery older than the last applied event for its attempt is stale and changes nothing', () => {
    const mr = orders.stale.merchant_reference;
    const out = deliver('D-09', {
      eventId: idFor('st_late'),
      body: rzBody('payment.created', idFor('st_late'), t0 - 300, {
        payment: { entity: { ...payEntity(mr, 'ST', PRICE.stale), status: 'created' } },
        order: { entity: orderEntity(mr, 'ST') },
      }),
    });
    const r = resultOf('D-09', out);
    assert.equal(keysOf(r), RECORDED_KEYS, `D-09: ${json(r)}`);
    assert.equal(r.processing_status, 'stale', `D-09: ${json(r)}`);
    assert.equal(r.hold_reason, null, 'D-09: staleness is a verdict about time, not an escalation');
    assert.equal(r.applied_effect, null,
      'D-09: §4.1 nulls the effect, because the row that arrives out of order is not the row that decided');
    assert.equal(r.state_changed, false, `D-09: ${json(r)}`);

    const row = ledgerRow(idFor('st_late'));
    assert.ok(row.includes('kind=payment_initiated status=stale effect=- hold=-'), `D-09: ${shown(row)}`);
    const obs = observe('stale');
    assert.equal(obs.attempts.length, 1,
      'D-09: a stale initiation minted an attempt as well as declining to apply');
    assert.equal(obs.order.status, 'payment_pending', 'D-09: the order is where D-08a left it');

    const sweep = reconcile('stale');
    // The one finding this order owes is D-08c's wrong amount. A `stale` row is evidence that nothing
    // happened, and §10 has no finding for that — inventing one would make every out-of-order retry an
    // alarm. `held_event_unapplied` needs a fifteen-minute-old row, which no run of this file can have.
    assert.equal(findingsOf(sweep), 'amount_drift',
      `D-09: ${json(sweep.findings)} — the staleness rows should contribute no finding`);
  });

  test('D-10: a failed payment closes the attempt and leaves the purchase open', () => {
    insertPackage(CODE.retry);
    quote('retry', { weddingId: workshop, packageCode: CODE.retry, actor: uidOf('hostA') });
    const mr = orders.retry.merchant_reference;
    // A notification id per event, a payment id per attempt: Razorpay sends a distinct notification for
    // `payment.failed` about the same payment entity. Passing `ref` as the event id too (as this helper
    // did) made D-10b a second body under D-10a's already-seen id, which level-1 idempotency answers from
    // the first row — so the failure never reached the machine and D-10b reported `attempt_initiated`
    // (run r8). The property that swallowed it is now measured on its own terms in D-16.
    const rz = (caseId, notif, ref, event, status, createdAt) => deliver(caseId, {
      eventId: idFor(notif),
      body: rzBody(event, idFor(notif), createdAt, {
        payment: { entity: { ...payEntity(mr, ref, PRICE.retry), status } },
        order: { entity: orderEntity(mr, ref) },
      }),
    });

    const first = resultOf('D-10a', rz('D-10a', 'R1n', 'R1', 'payment.created', 'created', t0 - 240));
    assert.equal(first.applied_effect, 'attempt_initiated', `D-10a: ${json(first)}`);

    const failed = resultOf('D-10b', rz('D-10b', 'R1f', 'R1', 'payment.failed', 'failed', t0 - 180));
    assert.equal(failed.applied_effect, 'attempt_failed', `D-10b: ${json(failed)}`);
    assert.equal(failed.order_status, 'payment_pending',
      'D-10b: requirement 5 keeps a failed *attempt* separate from a closed *purchase* — a retry may '
      + 'still succeed, so the ledger refuses to answer a question the provider did not');
    assert.equal(failed.state_changed, false, 'D-10b: the order genuinely did not move');
    const mid = observe('retry');
    assert.equal(mid.attempts[0].status, 'failed', `D-10b: ${json(mid.attempts)}`);
    assert.notEqual(mid.attempts[0].failed_at, null, 'D-10b: the attempt carries when it failed');
    assert.equal(mid.order.status, 'payment_pending', 'D-10b: the order is still awaiting money');

    const second = resultOf('D-10c', rz('D-10c', 'R2n', 'R2', 'payment.created', 'created', t0 - 120));
    assert.equal(second.applied_effect, 'attempt_recorded',
      `D-10c: a second attempt on a pending order is recorded, not a second transition: ${json(second)}`);
    assert.equal(observe('retry').attempts.length, 2, 'D-10c: the retry minted no attempt row');

    const third = resultOf('D-10d', rz('D-10d', 'R2c', 'R2', 'payment.captured', 'captured', t0));
    assert.equal(third.applied_effect, 'entitlement_granted', `D-10d: ${json(third)}`);
    assert.equal(third.order_status, 'captured', 'D-10d: the successful retry is what pays');
    const obs = observe('retry');
    assert.deepEqual(obs.attempts.map((a) => `${a.provider}:${a.status}`), ['razorpay:failed', 'razorpay:confirmed'],
      `D-10: the two attempts keep their own histories side by side: ${json(obs.attempts)}`);
    assert.equal(obs.entitlement.status, 'active', 'D-10d: the entitlement is the retry\'s, not the failure\'s');
  });

  test('D-11: a forged delivery is ledgered under the transport\'s own claim, and that claim poisons the id', () => {
    insertPackage(CODE.poison);
    quote('poison', { weddingId: workshop, packageCode: CODE.poison, actor: uidOf('hostA') });
    const mr = orders.poison.merchant_reference;
    const captureBody = rzBody('payment.captured', idFor('poison'), t0, {
      payment: { entity: payEntity(mr, 'PS', PRICE.poison) },
      order: { entity: orderEntity(mr, 'PS') },
    });

    deliver('D-11a', { eventId: idFor('poison'), body: captureBody, signWith: WRONG_SECRET,
      verified: false, reason: 'signature_mismatch' });
    const forgery = ledgerRow(idFor('poison'));
    for (const [name, want] of [['kind', 'other'], ['status', 'rejected_signature'], ['effect', '-'],
      ['hold', '-'], ['refusal', 'signature_mismatch'], ['sig', 'false'], ['order', '-'],
      ['attempt', '-'], ['mr', '-'], ['amount', '-'], ['currency', '-']]) {
      assert.equal(rowField(forgery, name), want,
        `D-11a: an unverified body names nothing about itself — ${name}: ${shown(forgery)}`);
    }

    // The property that follows from level-1 idempotency reading before the refusal chain: whoever forged
    // first chooses the event id the genuine capture will later carry, and the genuine capture is then
    // answered with the forgery's verdict. It is a real consequence of the design, not a mistake in this
    // file's arithmetic, and it is reported to the human partner rather than quietly engineered away.
    const replay = resultOf('D-11b', deliver('D-11b', { eventId: idFor('poison'), body: captureBody }));
    assert.equal(keysOf(replay), ALREADY_KEYS, `D-11b: ${json(replay)}`);
    assert.equal(replay.disposition, 'already_recorded', `D-11b: ${json(replay)}`);
    assert.equal(replay.processing_status, 'rejected_signature',
      'D-11b: the genuine capture was answered with the forgery\'s verdict');
    assert.equal(replay.applied_effect, null, 'D-11b: and so nothing was granted');
    assert.equal(replay.order_id, null, 'D-11b: the poisoned row carries no link either');
    const poisoned = observe('poison');
    assert.equal(poisoned.order.status, 'open',
      'D-11b: the genuine capture, answered with the forgery\'s verdict, paid nothing');
    assert.deepEqual(poisoned.attempts, [], 'D-11b: and minted no attempt');
    assert.equal(poisoned.entitlement, null, 'D-11b: and granted no right');

    // The forger burned one id, so recovery is a re-delivery under a fresh one — and that re-delivery
    // cannot be the *same bytes*. `verifyRazorpayWebhook` cross-checks the header's claim against the body's
    // own `event_id` and refuses a disagreement with `event_id_mismatch`, which is what this arm asked for
    // when it reused `captureBody` under the new header id (measured in run r9). What has to be identical is
    // the money, so the assertion below says precisely that: the two documents differ only in the delivery's
    // own identity, which is the one field the forger chose.
    const recoveredBody = rzBody('payment.captured', idFor('poison_ok'), t0, {
      payment: { entity: payEntity(mr, 'PS', PRICE.poison) },
      order: { entity: orderEntity(mr, 'PS') },
    });
    assert.equal(recoveredBody.replace(idFor('poison_ok'), idFor('poison')), captureBody,
      'D-11c: the recovery delivery is not the same payment under a different id, so this arm proves '
      + 'nothing about poisoning');
    const recovered = resultOf('D-11c', deliver('D-11c', { eventId: idFor('poison_ok'), body: recoveredBody }));
    assert.equal(recovered.applied_effect, 'entitlement_granted',
      `D-11c: the same payment under an id nobody burned does pay: ${json(recovered)}`);
    assert.equal(digestFor(idFor('poison_ok')), digests.find((d) => d.eventId === idFor('poison_ok')).digest,
      'D-11c: the ledger\'s digest is not this run\'s digest of those bytes');
  });

  test('D-12: a live-environment delivery is held, and the instrument itself refuses to name live', () => {
    const out = deliver('D-12', { environment: 'live', eventId: idFor('live'), body: classicCapture('live', t0) });
    const r = resultOf('D-12', out);
    assert.equal(keysOf(r), RECORDED_KEYS, `D-12: ${json(r)}`);
    assert.equal(r.hold_reason, 'live_capture_disabled', `D-12: ${json(r)}`);
    assert.equal(r.processing_status, 'held_for_reconciliation', `D-12: ${json(r)}`);
    // The environment gate sits above the order lookup, so this row is deliberately unlinked even though
    // the reference it carries is real: nothing that needs a trusted order may run against a delivery the
    // policy has not opened.
    assert.equal(r.order_id, null, `D-12: ${json(r)}`);
    assert.equal(r.order_status, null, `D-12: ${json(r)}`);
    const row = ledgerRow(idFor('live'));
    assert.equal(rowField(row, 'order'), '-', `D-12: ${shown(row)}`);
    assert.equal(rowField(row, 'attempt'), '-', `D-12: ${shown(row)}`);
    assert.equal(rowField(row, 'mr'), orders.classic.merchant_reference,
      'D-12: the reference is kept as the evidence a human needs');
    assert.equal(rowField(row, 'environment'), 'live',
      `D-12: the operator's declaration is what the row records: ${shown(row)}`);

    const obs = observe('classic');
    assert.equal(obs.order.status, 'captured', 'D-12: the live delivery did not touch the synthetic purchase');
    assert.equal(obs.events.length, 2,
      'D-12: the held-live row is not attached to this order, exactly as the gate intends');
    assert.equal(obs.entitlement.status, 'active', 'D-12: a live delivery granted nothing while the flag is false');

    // The instrument's own refusal, measured over the real command line: no secret in the environment and
    // a delivery file that does not exist, both of which the refusal must precede. That the process dies
    // before it reads either is the proof that `live` is refused by policy here, not merely held downstream.
    let cli = null;
    try {
      execFileSync('node', [resolve(ROOT, 'scripts/stage10-commerce-driver.mjs'), 'deliver',
        '--environment', 'live', '--delivery-file', resolve(ROOT, `${RUN_TAG}-no-such-delivery.json`),
        '--actor', uidOf('hostA'), '--via-docker', DB_CONTAINER], { encoding: 'utf8' });
    } catch (error) {
      cli = error;
    }
    assert.ok(cli, 'D-12: the CLI accepted --environment live and ran a delivery');
    assert.equal(cli.status, 2, `D-12: a usage refusal should exit 2 before any database call: ${shown(cli?.stderr)}`);
    assert.match(String(cli.stderr), /live is not an environment a local instrument declares/,
      `D-12: ${shown(cli.stderr)}`);
  });

  test('D-13: a forged Cashfree delivery is unverifiable including its identity, so nothing is written', () => {
    const before = count('from private.commerce_payment_events', 'the ledger before a forgery');
    const out = deliver('D-13', {
      provider: 'cashfree', eventId: idFor('cf_forged'),
      body: cfDoc('PAYMENT_STATE_CHANGED', idFor('cf_forged'), t0, {
        payment_state_change: { to: 'COMPLETED' }, payment_order_id: NOT_A_REFERENCE,
        cf_payment_id: 'cf_pay_FORGED', cf_order_id: 'cf_order_FORGED',
        payment_amount: '4900.00', currency_code: 'INR',
      }),
      signWith: WRONG_SECRET, verified: false, reason: 'signature_mismatch',
    });
    assert.equal(out.recorded, false, `D-13: ${json(out)}`);
    assert.equal(out.refusal, 'no_trusted_event_identity',
      'D-13: Cashfree signs <timestamp>.<body> and keeps its id inside the body, so a forgery has no '
      + 'header claim to be recorded under and this instrument writes nothing');
    assert.equal(out.statement, null, `D-13: ${json(out)}`);
    assert.equal(out.result, null, `D-13: ${json(out)}`);
    assert.equal(count('from private.commerce_payment_events', 'the ledger after a forgery'), before,
      'D-13: an unverifiable Cashfree delivery wrote a row it was promised not to write');
    assert.equal(count(`from private.commerce_payment_events where event_id = '${idFor('cf_forged')}'`), '0',
      'D-13: the refusal reached the ledger under an id nobody chose');
  });

  test('D-14: a Cashfree initiation and capture drive the same state machine through the other adapter', () => {
    insertPackage(CODE.cashfree);
    quote('cashfree', { weddingId: workshop, packageCode: CODE.cashfree, actor: uidOf('hostA') });
    const mr = orders.cashfree.merchant_reference;
    const doc = (caseId, id, to, createdAt) => deliver(caseId, {
      provider: 'cashfree', eventId: id,
      body: cfDoc('PAYMENT_STATE_CHANGED', id, createdAt, {
        payment_state_change: { to }, payment_order_id: mr,
        cf_payment_id: 'cf_pay_CF', cf_order_id: 'cf_order_CF',
        payment_amount: '1900.00', currency_code: 'INR',
      }),
    });
    const init = resultOf('D-14a', doc('D-14a', idFor('cf_init'), 'PENDING', t0 - 120));
    assert.equal(init.applied_effect, 'attempt_initiated', `D-14a: ${json(init)}`);
    assert.equal(init.order_status, 'payment_pending', `D-14a: ${json(init)}`);

    const cap = resultOf('D-14b', doc('D-14b', idFor('cf_cap'), 'COMPLETED', t0));
    assert.equal(cap.applied_effect, 'entitlement_granted', `D-14b: ${json(cap)}`);
    assert.equal(cap.order_status, 'captured', `D-14b: ${json(cap)}`);
    assert.match(cap.entitlement_id, UUID, `D-14b: ${json(cap)}`);

    const obs = observe('cashfree');
    assert.equal(obs.attempts.length, 1, `D-14: the capture confirmed the initiation's attempt: ${json(obs.attempts)}`);
    assert.equal(obs.attempts[0].provider, 'cashfree', `D-14: ${json(obs.attempts)}`);
    assert.equal(obs.attempts[0].status, 'confirmed', `D-14: ${json(obs.attempts)}`);
    assert.deepEqual([obs.attempts[0].provider_payment_ref, obs.attempts[0].provider_order_ref],
      ['cf_pay_CF', 'cf_order_CF'], `D-14: both references the provider named are on the attempt: ${json(obs.attempts)}`);
    const cfRow = ledgerRow(idFor('cf_cap'));
    assert.equal(rowField(cfRow, 'amount'), '190000',
      `D-14: the rupee string became the minor-unit amount the quote froze: ${shown(cfRow)}`);
    assert.equal(rowField(cfRow, 'currency'), 'INR', `D-14: ${shown(cfRow)}`);
    assert.equal(rowField(cfRow, 'environment'), 'synthetic', `D-14: ${shown(cfRow)}`);
    assert.equal(auditLine('attempt_initiated', orders.cashfree.order_id),
      `attempt_initiated/commerce_event/${uidOf('hostA')}/mode=-`, 'D-14: the initiation audit row is missing');
    assert.equal(auditLine('order_captured', orders.cashfree.order_id),
      `order_captured/commerce_event/${uidOf('hostA')}/mode=-`, 'D-14: the capture audit row is missing');
  });

  test('D-16: one event id is one body — a second, different body under it never reaches the ledger', () => {
    // Level-1 idempotency reads the event id before the refusal chain and before the state machine, so the
    // first body an id arrives with is the only body that id will ever have in this ledger. D-11 measures
    // the exploitable form (a forgery chooses the id); this measures the property itself, on an unknown
    // reference so neither arm disturbs another case's order, and it exists because run r8 caught D-10b and
    // Z-01 hitting it by accident instead of on purpose.
    const ghost = (amount, at) => rzBody('payment.captured', idFor('dup'), at, {
      payment: { entity: payEntity(NOT_A_REFERENCE, 'G16', amount) },
      order: { entity: orderEntity(NOT_A_REFERENCE, 'G16') },
    });
    const first = resultOf('D-16a', deliver('D-16a', { eventId: idFor('dup'), body: ghost(PRICE.classic, t0) }));
    assert.equal(first.hold_reason, 'unknown_order', `D-16a: ${json(first)}`);
    const heldRow = first.event_row_id;
    const bytesA = digestFor(idFor('dup'));

    const again = resultOf('D-16b', deliver('D-16b',
      { eventId: idFor('dup'), body: ghost(PRICE.classic + 1000, t0 + 60) }));
    assert.equal(again.disposition, 'already_recorded', `D-16b: ${json(again)}`);
    assert.equal(again.event_row_id, heldRow,
      `D-16b: the second body was answered with row ${again.event_row_id}, not the first body's row ${heldRow}`);
    assert.equal(digestFor(idFor('dup')), bytesA,
      'D-16b: the second body replaced the bytes stored under a known event id — the ledger is not append-only');
    assert.equal(count(`from private.commerce_payment_events where event_id = '${idFor('dup')}'`), '1',
      'D-16: two bodies under one event id produced two ledger rows');
    assert.equal(count(`from private.commerce_payment_attempts where provider_payment_ref = 'pay_G16'`), '0',
      'D-16: a body the ledger never read still reached the machine');
  });

  test('D-15: the ledger refuses to be edited by any role, including the one that wrote it', () => {
    const rowsBefore = count('from private.commerce_payment_events', 'the ledger before the edit attempts');
    const fingerprint = () => cell(`select to_jsonb(e)::text from private.commerce_payment_events e
      where e.event_id = '${idFor('cap')}'`, 'the capture row before and after the edit attempts');
    const beforeText = fingerprint();

    refused(`update private.commerce_payment_events set processing_status = 'applied'
       where event_id = '${idFor('cap')}'`,
    say('42501', 'private.commerce_payment_events rows are append-only'),
    'D-15a: postgres, the role that wrote the row, editing it');

    for (const role of ['anon', 'authenticated']) {
      refusedAtTheRole(`set role ${role}; update private.commerce_payment_events
          set processing_status = 'applied' where event_id = '${idFor('cap')}'`,
      /permission denied for schema private/, `D-15b: ${role} updating the ledger`);
    }
    refusedAtTheRole('set role service_role; update private.commerce_payment_events '
      + `set processing_status = 'applied' where event_id = '${idFor('cap')}'`,
    /permission denied for table commerce_payment_events/,
    'D-15c: service_role, which has schema USAGE but no table grant');

    assert.equal(fingerprint(), beforeText,
      'D-15: a refused edit still changed the row, so one of the refusals above was not a refusal');
    assert.equal(count('from private.commerce_payment_events', 'the ledger after the edit attempts'), rowsBefore,
      'D-15: a refused UPDATE was answered by writing a second row');
  });

  test('D-17: the failure D-10 keeps off the order reaches the host door, and a retry in flight takes it off again', async () => {
    // Requirement 8's fourth word, over the wire. D-10b proves the *stored* answer — a failed attempt
    // closes the attempt and leaves the purchase `payment_pending` — and that is exactly why the door has
    // nothing to say to the host: pending and just-refused looked identical. `attempt_status` and the
    // `payment_attempt_failed` state read the newest attempt at the moment of the read, so this arm drives
    // the sequence the way a customer does — initiation, failure, retry — and asks the deployed door after
    // each step. On its own wedding, because the tie-break would otherwise answer for whichever of
    // workshop's four unfinished purchases is newest rather than the one under test.
    insertPackage(CODE.failed, { approved: false });
    const w = await weddingOnly('hostA', 'failed');
    quote('failed', { weddingId: w, packageCode: CODE.failed, actor: uidOf('hostA') });
    const mr = orders.failed.merchant_reference;
    const rz = (caseId, notif, ref, event, status, createdAt) => deliver(caseId, {
      eventId: idFor(notif),
      body: rzBody(event, idFor(notif), createdAt, {
        payment: { entity: { ...payEntity(mr, ref, PRICE.failed), status } },
        order: { entity: orderEntity(mr, ref) },
      }),
    });

    resultOf('D-17a', rz('D-17a', 'FA1n', 'FA1', 'payment.created', 'created', t0 - 300));
    const failed = resultOf('D-17b', rz('D-17b', 'FA1f', 'FA1', 'payment.failed', 'failed', t0 - 240));
    assert.equal(failed.applied_effect, 'attempt_failed', `D-17b: ${json(failed)}`);
    assert.equal(failed.order_status, 'payment_pending', `D-17b: ${json(failed)}`);

    const first = await summary('hostA', w);
    assert.equal(first.status, 200, `D-17: ${json(first.body)}`);
    assert.equal(keysOf(first.body), SUMMARY_KEYS, `D-17: ${json(first.body)}`);
    assert.equal(first.body.state, 'payment_attempt_failed',
      `D-17: the door still says pending, so requirement 8 has no failed word: ${json(first.body)}`);
    assert.equal(first.body.order_status, 'payment_pending',
      'D-17: the new word is derived, not written — the order the failure left behind still says pending');
    assert.equal(first.body.attempt_status, 'failed', `D-17: ${json(first.body)}`);
    assert.equal(first.body.entitlement_status, null, 'D-17: a refused card grants nothing');
    assert.equal(first.body.price_display_enabled, false, 'D-17: this arm is quoted on the unapproved price');
    assert.ok(!('amount_minor' in first.body) && !('currency' in first.body),
      `D-17: the failed state showed a host a price nobody approved: ${json(first.body)}`);
    // A host is told *that* it failed, not which of the provider's objects failed: §11 keeps the evidence
    // in the ledger, where `commerce_reconcile` — which no client can call — reads it.
    for (const name of ['provider_order_ref', 'provider_payment_ref', 'failed_at', 'checkout_url', 'attempt_id']) {
      assert.ok(!(name in first.body), `D-17: the projection carried ${name}: ${json(first.body)}`);
    }

    resultOf('D-17c', rz('D-17c', 'FA2n', 'FA2', 'payment.created', 'created', t0 - 180));
    const second = await summary('hostA', w);
    assert.equal(second.body.state, 'payment_pending',
      `D-17: the door kept the older failure on the screen after the customer already retried: ${json(second.body)}`);
    assert.equal(second.body.attempt_status, 'initiated', `D-17: ${json(second.body)}`);
    assert.equal(observe('failed').attempts.length, 2,
      'D-17: the retry minted no attempt row, so this reading proved nothing about "newest"');
  });
});

// ---------------------------------------------------------------------------
// R — the money coming back: refunds, a dispute, expiry, and the recovery sweep
// ---------------------------------------------------------------------------
describe('S10 REFUNDS, DISPUTES AND RECOVERY', () => {
  const t1 = Math.floor(Date.now() / 1000);

  /** The refund row a delivery wrote, found through the ledger row that caused it. §3's column list makes
   *  `event_id` the link, and a case that looked the row up by order instead would pass against the
   *  refund some *earlier* delivery wrote — which is exactly the mistake this group is here to catch. */
  const refundOf = (key, eventRowId, what) => {
    const rows = observe(key).refunds.filter((r) => r.event_id === eventRowId);
    assert.equal(rows.length, 1,
      `${what}: one recorded delivery should own exactly one refund row: ${json(observe(key).refunds)}`);
    return rows[0];
  };

  test('R-01: a succeeded refund is evidence about the refund, not a second copy of the payment', async () => {
    const before = observe('classic');
    assert.equal(before.attempts.length, 1, `R-01: the case expects one payment object: ${json(before.attempts)}`);
    const out = deliver('R-01', {
      eventId: idFor('ref1'),
      body: rzBody('refund.processed', idFor('ref1'), t1 + 60, {
        refund: { entity: refundEntity(orders.classic.merchant_reference, 'CL', PRICE.classic) },
        order: { entity: orderEntity(orders.classic.merchant_reference, 'CL') },
      }),
    });
    const r = resultOf('R-01', out);
    assert.equal(keysOf(r), APPLIED_KEYS, `R-01: ${json(r)}`);
    assert.equal(r.disposition, 'applied', `R-01: ${json(r)}`);
    assert.equal(r.applied_effect, 'refund_recorded', `R-01: ${json(r)}`);
    assert.equal(r.hold_reason, null, `R-01: ${json(r)}`);
    assert.equal(r.order_status, 'captured', 'R-01: a refund does not un-capture a purchase');
    assert.equal(r.state_changed, false, 'R-01: the order status did not move, so the flag says so');
    assert.equal(r.attempt_id, before.attempts[0].id,
      'R-01: the refund is evidence about the payment object the order already named');
    assert.equal(r.entitlement_id, before.order.entitlement_id,
      'R-01: under hold_for_review the right is untouched, and the answer says which one');

    const row = refundOf('classic', r.event_row_id, 'R-01');
    assert.equal(row.kind, 'refund', `R-01: ${json(row)}`);
    assert.equal(row.status, 'succeeded', `R-01: ${json(row)}`);
    assert.equal(Number(row.amount_minor), PRICE.classic, `R-01: ${json(row)}`);
    assert.equal(row.currency, 'INR', `R-01: ${json(row)}`);
    assert.ok(row.completed_at, `R-01: a processed refund carries its completion instant: ${json(row)}`);
    // The one column a person uses to find this movement again at the provider. `rfnd_…` is the refund's
    // own identity; `pay_…` is the payment it reverses, and recording that here would send the reader to
    // the charge instead of the credit. §3's comment and the migration's own note at :1307-1309 both say
    // the refund identity, so this arm is written before the adapter that satisfies it.
    assert.equal(row.provider_refund_ref, 'rfnd_CL',
      `R-01: provider_refund_ref must be the provider's refund id (migration :1307-1309), not the payment `
      + `it reverses: ${json(row)}`);

    assert.equal(auditLine('refund_succeeded', orders.classic.order_id),
      `refund_succeeded/commerce_event/${uidOf('hostA')}/mode=hold_for_review`,
      'R-01: the audit row is missing or names a mode other than the policy it ran under');
    const res = await summary('hostA', weddingOf('hostA'));
    assert.equal(res.body.state, 'refunded_pending_review', `R-01: ${json(res.body)}`);
    assert.equal(res.body.refund_kind, 'refund', `R-01: ${json(res.body)}`);
    assert.equal(res.body.refund_status, 'succeeded', `R-01: ${json(res.body)}`);
    assert.equal(res.body.entitlement_status, 'active', 'R-01: pending review is not revoked');
  });

  test('R-02: a failed refund is recorded and changes nothing about the right', async () => {
    const out = deliver('R-02', {
      eventId: idFor('ref2'),
      body: rzBody('refund.failed', idFor('ref2'), t1 + 120, {
        refund: { entity: { ...refundEntity(orders.classic.merchant_reference, 'CL'),
          id: 'rfnd_CLF', status: 'failed' } },
        order: { entity: orderEntity(orders.classic.merchant_reference, 'CL') },
      }),
    });
    const r = resultOf('R-02', out);
    assert.equal(r.applied_effect, 'refund_failed_recorded', `R-02: ${json(r)}`);
    assert.equal(r.state_changed, false, `R-02: ${json(r)}`);
    const row = refundOf('classic', r.event_row_id, 'R-02');
    assert.equal(row.kind, 'refund', `R-02: ${json(row)}`);
    assert.equal(row.status, 'failed', `R-02: ${json(row)}`);
    assert.equal(row.provider_refund_ref, 'rfnd_CLF',
      `R-02: a refused refund still names the refund it is evidence about: ${json(row)}`);
    assert.equal(row.completed_at, null, 'R-02: only a succeeded refund completes');
    const res = await summary('hostA', weddingOf('hostA'));
    assert.equal(res.body.state, 'entitlement_active', `R-02: ${json(res.body)}`);
    assert.equal(res.body.refund_status, 'failed', `R-02: ${json(res.body)}`);
  });

  test('R-03: a chargeback holds for review and never revokes, whatever §9 would otherwise allow', async () => {
    // A Cashfree dispute needs a Cashfree purchase: the ledger's attempt match is provider-scoped
    // (:1022), and a dispute about money that came through the other door is a different finding, not this
    // one. The wedding is fresh because the projection is read here, and `commerce_host_summary` answers
    // one order per wedding.
    const disputeW = await weddingOnly('hostA', 'dispute');
    quote('dispute', { weddingId: disputeW, packageCode: CODE.cashfree, actor: uidOf('hostA') });
    const mr = orders.dispute.merchant_reference;
    const cf = (caseId, name, type, payload, createdAt) => deliver(caseId, {
      provider: 'cashfree', eventId: idFor(name), body: cfDoc(type, idFor(name), createdAt, payload),
    });
    const state = (caseId, name, to, createdAt) => cf(caseId, name, 'PAYMENT_STATE_CHANGED', {
      payment_state_change: { to }, payment_order_id: mr, cf_payment_id: 'pay_DP', cf_order_id: 'order_DP',
      payment_amount: '1900.00', currency_code: 'INR',
    }, createdAt);
    assert.equal(resultOf('R-03a', cf('R-03a', 'dp_init', 'PAYMENT_STATE_CHANGED', {
      payment_state_change: { to: 'PENDING' }, payment_order_id: mr, cf_payment_id: 'pay_DP',
      cf_order_id: 'order_DP', payment_amount: '1900.00', currency_code: 'INR',
    }, t1 + 100)).applied_effect, 'attempt_initiated', 'R-03: the initiation did not land');
    assert.equal(resultOf('R-03b', state('R-03b', 'dp_cap', 'COMPLETED', t1 + 130)).applied_effect,
      'entitlement_granted', 'R-03: the capture did not land');

    const out = cf('R-03', 'dp_cb', 'CHARGEBACK_CREATED', {
      chargeback_id: 'cb_DP', cf_payment_id: 'pay_DP', cf_order_id: 'order_DP', payment_order_id: mr,
      chargeback_amount: '1900.00', currency_code: 'INR',
    }, t1 + 150);
    const r = resultOf('R-03', out);
    assert.equal(keysOf(r), APPLIED_KEYS, `R-03: ${json(r)}`);
    assert.equal(r.applied_effect, 'chargeback_hold_for_review', `R-03: ${json(r)}`);
    assert.equal(r.order_status, 'captured', 'R-03: an unadjudicated claim does not move the purchase');
    assert.equal(r.state_changed, false, `R-03: ${json(r)}`);
    assert.equal(r.attempt_id, observe('dispute').attempts[0].id, `R-03: ${json(r)}`);
    assert.ok(r.entitlement_id, 'R-03: the right is still there, because a dispute is reviewed, not enacted');

    const row = refundOf('dispute', r.event_row_id, 'R-03');
    assert.equal(row.kind, 'chargeback', `R-03: ${json(row)}`);
    assert.equal(row.status, 'recorded', `R-03: ${json(row)}`);
    assert.equal(row.completed_at, null, `R-03: ${json(row)}`);
    // The same argument as R-01, on the provider whose fixture also carries a payment id: the chargeback's
    // own identity is what a human needs, and `cf_payment_id` is present in this body precisely so that a
    // precedence mistake is visible rather than merely absent.
    assert.equal(row.provider_refund_ref, 'cb_DP',
      `R-03: provider_refund_ref must be the chargeback id, not the payment it disputes: ${json(row)}`);

    assert.equal(auditLine('chargeback_opened', orders.dispute.order_id),
      `chargeback_opened/commerce_event/${uidOf('hostA')}/mode=hold_for_review`,
      'R-03: the dispute audit row is missing');
    const res = await summary('hostA', disputeW);
    assert.equal(res.body.state, 'dispute_open_review', `R-03: ${json(res.body)}`);
    assert.equal(res.body.refund_kind, 'chargeback', `R-03: ${json(res.body)}`);
    assert.equal(res.body.entitlement_status, 'active', 'R-03: the guardrail holds, it does not cut off');
  });

  test('R-04: a Razorpay dispute arrives as a kind this build has not read, and is kept unlinked', () => {
    const out = deliver('R-04', {
      eventId: idFor('disp'),
      body: rzBody('dispute.created', idFor('disp'), t1 + 180, {
        dispute: { entity: { id: 'disp_CL', amount: PRICE.classic, currency: 'INR', status: 'open' } },
        order: { entity: orderEntity(orders.classic.merchant_reference, 'CL') },
      }),
    });
    const r = resultOf('R-04', out);
    assert.equal(keysOf(r), RECORDED_KEYS, `R-04: ${json(r)}`);
    assert.equal(r.disposition, 'recorded', `R-04: ${json(r)}`);
    assert.equal(r.processing_status, 'held_for_reconciliation', `R-04: ${json(r)}`);
    assert.equal(r.hold_reason, 'unknown_order', `R-04: ${json(r)}`);
    assert.equal(r.applied_effect, null, 'R-04: a kind with no rule decides nothing');
    assert.equal(r.order_id, null, 'R-04: an unread body gets to name no order (§6)');
    assert.equal(r.state_changed, false, `R-04: ${json(r)}`);
    const row = ledgerRow(idFor('disp'));
    for (const [name, want] of [['kind', 'other'], ['status', 'held_for_reconciliation'], ['effect', '-'],
      ['hold', 'unknown_order'], ['order', '-'], ['attempt', '-'], ['mr', '-'], ['amount', '-']]) {
      assert.equal(rowField(row, name), want, `R-04: ${name}: ${shown(row)}`);
    }
    // §9's dispute guardrail is reached through Cashfree's vocabulary only: measured against
    // `RAZORPAY_EVENT_KINDS` (:177-189), that table has no dispute entry, so a Razorpay dispute is an
    // unread kind and lands here rather than in `dispute_open_review`. Recorded, not repaired — which
    // provider vocabulary to adopt is a commercial decision for the owner, and the row keeps the evidence
    // until they make it.
  });

  test('R-05: under the revoke policy a succeeded refund ends the entitlement through the trusted step', () => {
    setPolicy(`refund_revocation_mode = 'revoke'`, 'the revoke policy');
    const out = deliver('R-05', {
      eventId: idFor('ref5'),
      body: rzBody('refund.processed', idFor('ref5'), t1 + 240, {
        refund: { entity: refundEntity(orders.classic.merchant_reference, 'CL5', PRICE.classic) },
        order: { entity: orderEntity(orders.classic.merchant_reference, 'CL') },
      }),
    });
    const r = resultOf('R-05', out);
    assert.equal(r.applied_effect, 'entitlement_revoked',
      `R-05: the effect names what the policy decided: ${json(r)}`);
    assert.equal(r.order_status, 'captured', 'R-05: the purchase stays what the money made it');
    assert.equal(r.state_changed, false, `R-05: ${json(r)}`);
    assert.equal(refundOf('classic', r.event_row_id, 'R-05').provider_refund_ref, 'rfnd_CL5',
      'R-05: the revoked grant still has to be traceable to the refund that caused it');

    const obs = observe('classic');
    assert.equal(obs.entitlement.status, 'revoked', `R-05: ${json(obs.entitlement)}`);
    assert.ok(obs.entitlement.revoked_at, `R-05: ${json(obs.entitlement)}`);
    assert.ok(String(obs.entitlement.metadata.revoked_reason).includes(
      'refund_succeeded while refund_revocation_mode = revoke'),
    `R-05: the reason the migration passes is not on the row: ${json(obs.entitlement.metadata)}`);
    assert.equal(obs.entitlement.metadata.revoked_by_order, orders.classic.order_id,
      `R-05: ${json(obs.entitlement.metadata)}`);
    assert.equal(auditLine('refund_succeeded', orders.classic.order_id),
      `refund_succeeded/commerce_event/${uidOf('hostA')}/mode=revoke`, 'R-05: the audit row names the wrong mode');
    assert.equal(auditLine('revoked', obs.entitlement.id),
      `revoked/entitlement/${uidOf('hostA')}/mode=-`, 'R-05: the revocation wrote no audit of its own');
  });

  test('R-06: a second refund-driven revocation aborts the whole delivery, ledger row included', () => {
    const stmt = statementFor('R-06', {
      eventId: idFor('ref6'),
      body: rzBody('refund.processed', idFor('ref6'), t1 + 300, {
        refund: { entity: refundEntity(orders.classic.merchant_reference, 'CL6', PRICE.classic) },
        order: { entity: orderEntity(orders.classic.merchant_reference, 'CL') },
      }),
    });
    refused(performOf(stmt, 'R-06'), say('P0001', SAY.noLiveEnt, orders.classic.order_id),
      'R-06: a refund whose nested revocation finds nothing live');
    // The finding, stated plainly: §9's nested `revoke_commerce_entitlement` raises when the entitlement is
    // already gone, and because the ledger INSERT is in the same statement's transaction the refund
    // evidence disappears with it — a provider retry keeps getting the same abort, and a human reading the
    // table later sees a refund that never arrived. `after()` restores the policy; the arms below run under
    // the shipped posture again.
    assert.equal(count(`from private.commerce_payment_events where event_id = '${idFor('ref6')}'`), '0',
      'R-06: an aborted delivery left a ledger row, which would make this a different finding');
    assert.equal(count(`from private.commerce_refunds r join private.commerce_payment_events e on e.id = r.event_id
      where e.event_id = '${idFor('ref6')}'`), '0', 'R-06: an aborted delivery left a refund row');
    setPolicy(`refund_revocation_mode = 'hold_for_review'`, 'the restore to hold_for_review');
  });

  test('R-07: a captured order refuses to be expired, and a cancellation about it is held', async () => {
    refused(performOf(expireOrderSql({ orderId: orders.classic.order_id, actorUserId: uidOf('hostA') }), 'R-07'),
      say('23514', SAY.notLive, orders.classic.order_id), 'R-07: expiring money already taken');

    const out = deliver('R-07b', {
      eventId: idFor('can1'),
      body: rzBody('order.cancelled', idFor('can1'), t1 + 360, {
        order: { entity: orderEntity(orders.classic.merchant_reference, 'CL') },
      }),
    });
    const r = resultOf('R-07b', out);
    assert.equal(keysOf(r), RECORDED_KEYS, `R-07b: ${json(r)}`);
    assert.equal(r.processing_status, 'held_for_reconciliation', `R-07b: ${json(r)}`);
    assert.equal(r.hold_reason, 'cancel_after_capture', `R-07b: ${json(r)}`);
    assert.equal(r.applied_effect, null, 'R-07b: a hold decides nothing about the money');
    assert.equal(r.order_status, 'captured', 'R-07b: the order keeps the status the capture gave it');
    assert.equal(r.state_changed, false, `R-07b: ${json(r)}`);
    // §4.2 rule 4's binding, read the other way: a row held *because of what this order says* still has to
    // name it, or the sweep that finds the disagreement cannot show anybody which purchase it is about.
    assert.ok(ledgerRow(idFor('can1')).includes(`attempt=${observe('classic').attempts[0].id}`),
      `R-07b: the cancellation names the payment it claims to cancel and should keep the link: `
      + shown(ledgerRow(idFor('can1'))));
  });

  test('R-08: an overage quote is found by the sweep, closed by its verb, and refuses a late capture', async () => {
    insertPackage(CODE.expire);
    quote('expire', { weddingId: weddingOf('hostB'), packageCode: CODE.expire, actor: uidOf('hostB') });
    const open = await summary('hostB', weddingOf('hostB'));
    assert.equal(open.body.state, 'quote_open', `R-08: ${json(open.body)}`);

    refused(performOf(expireOrderSql({ orderId: orders.expire.order_id, actorUserId: uidOf('hostB') }), 'R-08a'),
      say('23514', SAY.notOverage), 'R-08a: a quote may not be closed before its own expiry');

    exec(`update private.commerce_orders set quote_expires_at = now() - interval '1 minute'
       where id = '${orders.expire.order_id}'`, 'the backdated expiry');
    const sweep = reconcile('expire', uidOf('hostB'));
    assert.equal(findingsOf(sweep), 'stale_open_order', `R-08: ${json(sweep.findings)}`);

    const answer = run(expireOrderSql({ orderId: orders.expire.order_id, actorUserId: uidOf('hostB') }),
      'the expiry');
    assert.equal(answer.order_id, orders.expire.order_id, `R-08: ${json(answer)}`);
    assert.equal(answer.status, 'expired', `R-08: ${json(answer)}`);
    assert.equal(auditLine('expired', orders.expire.order_id),
      `expired/commerce_order/${uidOf('hostB')}/mode=-`, 'R-08: the expiry wrote no audit row');
    const closed = await summary('hostB', weddingOf('hostB'));
    assert.equal(closed.body.state, 'quote_expired', `R-08: ${json(closed.body)}`);

    const late = resultOf('R-08b', deliver('R-08b', {
      eventId: idFor('late'), as: 'hostB',
      body: rzBody('payment.captured', idFor('late'), t1 + 420, {
        payment: { entity: payEntity(orders.expire.merchant_reference, 'EX8', PRICE.expire) },
        order: { entity: orderEntity(orders.expire.merchant_reference, 'EX8') },
      }),
    }));
    assert.equal(keysOf(late), RECORDED_KEYS, `R-08b: ${json(late)}`);
    assert.equal(late.hold_reason, 'captured_on_closed_order', `R-08b: ${json(late)}`);
    assert.equal(late.order_status, 'expired', 'R-08b: the money is not retroactively applied');
    assert.equal(late.state_changed, false, `R-08b: ${json(late)}`);
    const obs = observe('expire');
    assert.equal(obs.order.status, 'expired', 'R-08b: a held capture did not re-open the quote');
    assert.deepEqual(obs.attempts, [], 'R-08b: a declined capture minted an attempt');
    assert.equal(obs.entitlement, null, 'R-08b: money after expiry granted no right');
  });

  test('R-09: a closed quote leaves the room a new one needs', () => {
    const again = quote('expire2', { weddingId: weddingOf('hostB'), packageCode: CODE.expire,
      actor: uidOf('hostB') });
    assert.notEqual(again.order_id, orders.expire.order_id,
      'R-09: the second quote returned the expired order itself');
    assert.notEqual(again.merchant_reference, orders.expire.merchant_reference,
      'R-09: a new quote reused the reference of the purchase it replaced');
    assert.equal(again.status, 'open', `R-09: ${json(again)}`);
  });

  test('R-10: a cancellation closes a live order, and an initiation after it is held', async () => {
    const mr = orders.expire2.merchant_reference;
    const r = resultOf('R-10a', deliver('R-10a', {
      eventId: idFor('can2'), as: 'hostB',
      body: rzBody('order.cancelled', idFor('can2'), t1 + 480, {
        order: { entity: orderEntity(mr, 'EX9') },
      }),
    }));
    assert.equal(keysOf(r), APPLIED_KEYS, `R-10a: ${json(r)}`);
    assert.equal(r.applied_effect, 'order_cancelled', `R-10a: ${json(r)}`);
    assert.equal(r.state_changed, true, 'R-10a: the order really moved');
    assert.equal(r.order_status, 'cancelled', `R-10a: ${json(r)}`);
    assert.equal(r.entitlement_id, null, 'R-10a: nothing was ever granted here to revoke');
    const obs = observe('expire2');
    assert.equal(obs.order.status, 'cancelled', `R-10: ${json(obs.order)}`);
    assert.ok(obs.order.closed_at, `R-10: a cancelled order without its close instant: ${json(obs.order)}`);
    assert.equal(auditLine('cancelled_by_provider', orders.expire2.order_id),
      `cancelled_by_provider/commerce_event/${uidOf('hostB')}/mode=-`, 'R-10: the cancellation audit is missing');

    const res = await summary('hostB', weddingOf('hostB'));
    assert.equal(res.body.state, 'cancelled', `R-10: ${json(res.body)}`);

    const after = resultOf('R-10b', deliver('R-10b', {
      eventId: idFor('late2'), as: 'hostB',
      body: rzBody('payment.created', idFor('late2'), t1 + 540, {
        payment: { entity: { ...payEntity(mr, 'EX9', PRICE.expire), status: 'created' } },
        order: { entity: orderEntity(mr, 'EX9') },
      }),
    }));
    assert.equal(keysOf(after), RECORDED_KEYS, `R-10b: ${json(after)}`);
    assert.equal(after.hold_reason, 'closed_order', `R-10b: ${json(after)}`);
    assert.equal(after.order_status, 'cancelled', `R-10b: ${json(after)}`);
    assert.deepEqual(observe('expire2').attempts, [],
      'R-10b: a declined initiation minted an attempt anyway');
  });

  test('R-11: the sweep finds a captured order whose right is gone, and the recovery grants it again', async () => {
    const first = reconcile('classic');
    // Exactly one finding, and the reason each of the other five stays silent is this order's own history:
    // the initiation was applied in D-01, so `initiation_never_delivered` cannot fire; every row that
    // disagrees with the frozen quote belongs to another order, so no `amount_drift`; the two rows held
    // against this order (`R-07b`) were written minutes ago, and `held_event_unapplied` waits fifteen; and
    // `entitlement_after_refund` needs the revoke policy while this sweep runs under hold_for_review.
    assert.equal(findingsOf(first), 'captured_without_entitlement', `R-11: ${json(first.findings)}`);
    assert.ok(first.findings[0].detail.includes(orders.classic.merchant_reference),
      `R-11: a finding that cannot be traced to a purchase is an alarm, not a report: ${json(first.findings[0])}`);

    const grant = run(grantEntitlementSql({ orderId: orders.classic.order_id, actorUserId: uidOf('hostA') }),
      'the recovery grant');
    assert.equal(grant.newly_granted, true, `R-11: the recovery did not grant: ${json(grant)}`);
    assert.match(grant.entitlement_id, UUID, `R-11: ${json(grant)}`);

    const rows = sqlRows(`select status from public.entitlements
      where wedding_id = '${weddingOf('hostA')}' and package_code = '${CODE.classic}' order by granted_at`);
    // The consequence of `grant_commerce_entitlement`'s `ON CONFLICT (wedding_id, package_code)
    // WHERE status = 'active' DO NOTHING`: recovery after a revocation cannot merge into the revoked row
    // (the table's own CHECK ties status to `revoked_at`), so it mints a second row and the first stays as
    // the record. One live grant per wedding and package still holds; two rows is the design, not a leak.
    assert.deepEqual(rows, ['revoked', 'active'],
      `R-11: the recovery left ${json(rows)} instead of one revoked and one active grant`);

    const second = reconcile('classic');
    assert.equal(findingsOf(second), '', `R-11: the sweep still finds something after its remedy: ${json(second.findings)}`);

    const res = await summary('hostA', weddingOf('hostA'));
    // The measured derivation, not the intuitive one: `commerce_host_summary` reads the newest refund row
    // before it looks at the entitlement (:1584-1589), and R-05's refund is still the newest, so a
    // recovered wedding reads as pending review even though the right is live again.
    assert.equal(res.body.state, 'refunded_pending_review', `R-11: ${json(res.body)}`);
    assert.equal(res.body.entitlement_status, 'active', `R-11: ${json(res.body)}`);
    assert.equal(res.body.order_status, 'captured', `R-11: ${json(res.body)}`);
  });
});

// ---------------------------------------------------------------------------
// G — the publish gate: a trigger, not a hidden button
// ---------------------------------------------------------------------------
describe('S10 PUBLISH GATE', () => {
  const t2 = Math.floor(Date.now() / 1000);
  const WB = () => gate.weddingId;
  const activePublications = (what) => cell(`
    select count(*)::text from public.publications where wedding_id = '${WB()}' and status = 'active'`, what);

  test('G-01: with the policy demanding an entitlement, the host\'s own publish verb is refused', async () => {
    setPolicy(`publish_gate = 'entitlement_required',
      publish_required_package_codes = array['${CODE.gate}']::text[]`, 'the gate opened');
    const res = await publish('hostB', WB(), gate.versionId);
    assert.equal(res.status, 403, `G-01: ${json(res.body)}`);
    assert.equal(res.body.code, '42501', `G-01: ${json(res.body)}`);
    assert.ok(String(res.body.message).includes(SAY.gate),
      `G-01: ${shown(res.body.message)}`);
    assert.ok(String(res.body.message).includes(`[${CODE.gate}]`),
      `G-01: the refusal should name the package the policy demands: ${shown(res.body.message)}`);
    assert.ok(String(res.body.message).includes(SAY.gateTail),
      `G-01: ${shown(res.body.message)}`);
    assert.equal(count(`from public.publications where wedding_id = '${WB()}'`), '0',
      'G-01: a refused publish still wrote a publication');
  });

  test('G-02: an empty code list refuses with the sentence that says so, rather than by silence', async () => {
    // The refusal itself is right and fail-closed: no code can satisfy an empty list, so nothing publishes.
    // What the migration intends to say and what it can say are different, and this is the measured defect:
    // `coalesce(array_to_string(v_policy.publish_required_package_codes, ', '), '(none named)')` in
    // 20261017120000_stage10_commerce_foundations.sql:560 never reaches its second argument, because
    // `array_to_string('{}'::text[], ', ')` is the empty string, not NULL. The operator therefore reads
    // "requires an active entitlement for one of []" and has to work out that the bracket is not a
    // formatting accident. Measured at run r10, on the shared stack, with the wedding id in the sentence:
    //   wedding 7d4cbe6a-… may not publish: … for one of [], and this wedding has none. …
    // Repaired by 20261019120000_stage10_publish_gate_empty_list.sql and pinned at the SQL tier by cells
    // G05c-G05g, which were measured red against a chain built without that migration and green against
    // one built with it. This arm stays red here for one reason only: the stack this tier talks to still
    // runs the pre-repair function, because `supabase db push` needs the Docker daemon this machine has
    // wedged. The assertion is not adjusted to match a schema that is behind — when the repair is applied
    // this arm goes green with the cells, and if it is ever re-red the sentence has regressed.
    setPolicy(`publish_required_package_codes = '{}'::text[]`, 'the gate with no codes named');
    const res = await publish('hostB', WB(), gate.versionId);
    assert.equal(res.status, 403, `G-02: ${json(res.body)}`);
    assert.ok(String(res.body.message).includes('(none named)'),
      `G-02: a policy that names nothing must say nothing is satisfiable: ${shown(res.body.message)}`);
  });

  test('G-03: the entitlement demanded is read per wedding, not per deployment', async () => {
    // hostA's wedding holds a live `classic` entitlement from R-11. Naming that code here and publishing
    // hostB's wedding is the test: if the gate asked "does anybody entitled to classic exist?", the answer
    // would be yes and this call would succeed.
    setPolicy(`publish_required_package_codes = array['${CODE.classic}']::text[]`, 'the gate on classic');
    const res = await publish('hostB', WB(), gate.versionId);
    assert.equal(res.status, 403, `G-03: ${json(res.body)}`);
    assert.ok(String(res.body.message).includes(`[${CODE.classic}]`),
      `G-03: ${shown(res.body.message)}`);
  });

  test('G-04: the gate stands on the table as well as the verb, and steps aside for a revocation', () => {
    refused(`insert into public.publications (wedding_id, version_id, status)
       values ('${WB()}'::uuid, '${gate.versionId}'::uuid, 'active')`,
    say('42501', SAY.gate), 'G-04a: a direct INSERT of an active publication');
    // A revoked row is legal by construction — `publications` requires `status = 'revoked'` to carry
    // `revoked_at` (20260925120200_stage2_versions_and_publication.sql:86), and an INSERT without it fails
    // the check before the commerce gate is ever consulted. Omitting it made this arm measure a fixture
    // error as though it were the gate (run r8: `publications_check`).
    exec(`insert into public.publications (wedding_id, version_id, status, revoked_at)
       values ('${WB()}'::uuid, '${gate.versionId}'::uuid, 'revoked', now())`, 'G-04b: the revoked row');
    assert.equal(count(`from public.publications where wedding_id = '${WB()}' and status = 'revoked'`), '1',
      'G-04b: a publication that records a revocation was refused — the gate guards activation, not history');
    exec(`delete from public.publications where wedding_id = '${WB()}' and status = 'revoked'`,
      'the G-04b revoked row');
  });

  test('G-05: purchase, capture, entitlement: the sequence the gate is waiting to see', async () => {
    setPolicy(`publish_required_package_codes = array['${CODE.gate}']::text[]`, 'the gate back on its own code');
    insertPackage(CODE.gate);
    quote('gate', { weddingId: WB(), packageCode: CODE.gate, actor: uidOf('hostB') });
    const mr = orders.gate.merchant_reference;
    const init = resultOf('G-05a', deliver('G-05a', {
      eventId: idFor('gt_init'), as: 'hostB',
      body: rzBody('payment.created', idFor('gt_init'), t2 - 60, {
        payment: { entity: { ...payEntity(mr, 'GT', PRICE.gate), status: 'created' } },
        order: { entity: orderEntity(mr, 'GT') },
      }),
    }));
    assert.equal(init.applied_effect, 'attempt_initiated', `G-05a: ${json(init)}`);
    const cap = resultOf('G-05b', deliver('G-05b', {
      eventId: idFor('gt_cap'), as: 'hostB',
      body: rzBody('payment.captured', idFor('gt_cap'), t2, {
        payment: { entity: payEntity(mr, 'GT', PRICE.gate) },
        order: { entity: orderEntity(mr, 'GT') },
      }),
    }));
    assert.equal(cap.applied_effect, 'entitlement_granted', `G-05b: ${json(cap)}`);
    assert.equal(observe('gate').entitlement.status, 'active', 'G-05: the capture did not mint a live right');
  });

  test('G-06: with the right in place, the same call that was refused now publishes', async () => {
    const res = await publish('hostB', WB(), gate.versionId);
    assert.equal(res.status, 200, `G-06: ${json(res.body)}`);
    assert.equal(keysOf(res.body), 'expires_at,link_reused,path,publication_id,version_id', `G-06: ${json(res.body)}`);
    assert.equal(res.body.version_id, gate.versionId, `G-06: ${json(res.body)}`);
    assert.match(res.body.path, /^\/i\//, `G-06: ${json(res.body)}`);
    assert.equal(res.body.link_reused, false, 'G-06: this wedding had no credential to reuse');
    assert.equal(activePublications('G-06: the live publication'), '1', 'G-06');
  });

  test('G-07: revoking the entitlement bars re-activation and never bars withdrawal', () => {
    run(revocationSql({ orderId: orders.gate.order_id, actorUserId: uidOf('hostB'),
      reason: 'qualification revocation' }), 'the gate entitlement revocation');
    assert.equal(observe('gate').entitlement.status, 'revoked', 'G-07: the revocation did not land');

    refused(`update public.publications set status = 'active', published_at = now()
       where wedding_id = '${WB()}' and status = 'active'`,
    say('42501', SAY.gate, SAY.gateTail), 'G-07a: re-activating a publication after the right was withdrawn');
    assert.equal(activePublications('G-07: the publication after the refused re-activation'), '1',
      'G-07a: the row the gate refused to re-activate is no longer what it was');

    exec(`update public.publications set status = 'revoked', revoked_at = now()
       where wedding_id = '${WB()}' and status = 'active'`, 'G-07b: withdrawing a publication');
    assert.equal(activePublications('G-07b: the live publication after withdrawal'), '0',
      'G-07b: a gate that blocks withdrawal as well as activation would trap a family behind a payment');
  });

  test('G-08: the policy singleton goes back to the shipped permissive posture', () => {
    setPolicy(`publish_gate = 'permissive', publish_required_package_codes = '{}'::text[],
      live_capture_enabled = false, refund_revocation_mode = 'hold_for_review'`, 'the posture restore');
    assert.equal(policyLine(), POLICY_DEFAULTS, `G-08: ${policyLine()}`);
  });
});

// ---------------------------------------------------------------------------
// N — what the browser can and cannot reach
// ---------------------------------------------------------------------------
describe('S10 SURFACE AND PRIVILEGE BOUNDARY', () => {
  const STORES = ['commerce_packages', 'commerce_orders', 'commerce_payment_attempts',
    'commerce_payment_events', 'commerce_refunds', 'commerce_policy'];
  const BODIES = ['create_commerce_order', 'grant_commerce_entitlement', 'revoke_commerce_entitlement',
    'expire_commerce_order', 'record_commerce_event', 'commerce_reconcile'];
  const EXPOSED = 'Only the following schemas are exposed: public, api';

  test('N-01: no money store is a route, for any key, in either direction', async () => {
    for (const store of STORES) {
      for (const [label, bearer] of [['anon', anonKey], ['service', serviceKey]]) {
        const res = await call('GET', `/rest/v1/${store}`, { bearer });
        assert.equal(res.status, 404,
          `N-01: ${label} GET /rest/v1/${store} answered ${res.status}: ${shown(res.text)}`);
        assert.equal(res.body.code, 'PGRST205', `N-01: ${shown(res.text)}`);
        assert.ok(String(res.body.message).includes(`'public.${store}'`),
          `N-01: the miss should name the schema it searched: ${shown(res.text)}`);

        // A client cannot choose the schema either: `private` is not in the exposed list, so the request
        // never reaches a table even in principle.
        const p = await call('GET', `/rest/v1/${store}`, {
          bearer, headers: { 'Accept-Profile': 'private' },
        });
        assert.equal(p.status, 406, `N-01: ${label} Accept-Profile private on ${store}: ${shown(p.text)}`);
        assert.equal(p.body.code, 'PGRST106', `N-01: ${shown(p.text)}`);
        assert.equal(p.body.hint, EXPOSED, `N-01: ${shown(p.text)}`);
      }

      // The write direction, which is the one requirement 6 is about: a customer cannot create or alter
      // their own paid state because there is nothing at that URL to write to.
      const post = await call('POST', `/rest/v1/${store}`, {
        bearer: tokenOf('hostA'), body: { wedding_id: weddingOf('hostA') },
      });
      assert.equal(post.status, 404, `N-01: POST /rest/v1/${store} as a host: ${shown(post.text)}`);
      assert.equal(post.body.code, 'PGRST205', `N-01: ${shown(post.text)}`);
    }
  });

  test('N-02: no money body is callable, and the schema it lives in is not a choice', async () => {
    for (const name of BODIES) {
      const viaApi = await rpc(name, {}, { as: 'hostA', profile: 'api' });
      assert.equal(viaApi.status, 404, `N-02: rpc ${name} with an api profile: ${shown(viaApi.text)}`);
      assert.equal(viaApi.body.code, 'PGRST202', `N-02: ${shown(viaApi.text)}`);
      assert.ok(String(viaApi.body.message).includes(`api.${name}`),
        `N-02: the miss should name the function it searched for: ${shown(viaApi.text)}`);

      const viaDefault = await rpc(name, {}, { as: 'hostA', profile: null });
      assert.equal(viaDefault.status, 404, `N-02: rpc ${name} with no profile: ${shown(viaDefault.text)}`);
      assert.ok(String(viaDefault.body.message).includes(`public.${name}`),
        `N-02: ${shown(viaDefault.text)}`);

      const viaInternal = await rpc(name, {}, { as: 'hostA', profile: 'internal_api' });
      assert.equal(viaInternal.status, 406, `N-02: rpc ${name} with an internal_api profile: ${shown(viaInternal.text)}`);
      assert.equal(viaInternal.body.hint, EXPOSED, `N-02: ${shown(viaInternal.text)}`);
    }
  });

  test('N-03: the service key is refused at the same doors, and by routing rather than by grant', async () => {
    const before = { orders: count('from private.commerce_orders'),
      events: count('from private.commerce_payment_events'),
      entitlements: count('from public.entitlements') };

    for (const name of BODIES) {
      const res = await rpc(name, {}, { as: 'service', profile: 'api' });
      // Measured on this engine: 404, not 403. PostgREST resolves the function out of the schema cache
      // before it consults any grant, so the sentence this key is answered with is "there is no such
      // callable" rather than "you may not call it". The distinction matters when someone reads a run log
      // and asks whether the bodies are merely ungranted — they are not exposed at all.
      assert.equal(res.status, 404, `N-03: service rpc ${name}: ${shown(res.text)}`);
      assert.equal(res.body.code, 'PGRST202', `N-03: ${shown(res.text)}`);
    }

    assert.equal(count('from private.commerce_orders'), before.orders,
      'N-03: a refused call still wrote an order');
    assert.equal(count('from private.commerce_payment_events'), before.events,
      'N-03: a refused call still wrote a ledger row');
    assert.equal(count('from public.entitlements'), before.entitlements,
      'N-03: a refused call still granted a right');
  });

  test('N-04: on the one commerce table a browser can see, reading is the whole of what it may do', async () => {
    const classic = observe('classic').entitlement;
    const gateEnt = observe('gate').entitlement;
    assert.ok(classic && gateEnt, `N-04: the two entitlements this arm needs: ${json([classic, gateEnt])}`);

    // Which caller is asking, because this helper is called with three different credentials and a bare
    // "GET entitlements" failure line cannot say which one was refused (run r8).
    const idsOf = async (bearer, who) => {
      const res = await call('GET', '/rest/v1/entitlements?select=id,status,wedding_id', { bearer });
      assert.equal(res.status, 200, `N-04: ${who} GET entitlements: ${shown(res.text)}`);
      return res.body.map((r) => r.id);
    };
    const asA = await idsOf(tokenOf('hostA'), 'hostA');
    const asB = await idsOf(tokenOf('hostB'), 'hostB');
    assert.ok(asA.includes(classic.id), `N-04: hostA cannot read its own grant: ${json(asA)}`);
    assert.ok(!asA.includes(gateEnt.id), `N-04: hostA read another wedding's grant: ${json(asA)}`);
    assert.ok(asB.includes(gateEnt.id),
      'N-04: a revoked grant is still the host\'s own history and should stay readable');
    assert.ok(!asB.includes(classic.id), `N-04: hostB read another wedding's grant: ${json(asB)}`);

    // The anonymous answer is a refusal, not an empty list. `20260925120500_stage2_rls_and_grants.sql`
    // grants SELECT on `entitlements` to `authenticated` and never to `anon`, so the grant is the first
    // door and RLS is never reached: an empty 200 would mean anon *can* read and policy hides the rows,
    // which is a different (and weaker) guarantee than the one the schema gives. Measured in run r8:
    // 401 / 42501 / "permission denied for table entitlements".
    const anonRead = await call('GET', '/rest/v1/entitlements?select=id,status,wedding_id', { bearer: anonKey });
    assert.equal(anonRead.status, 401, `N-04: anon read entitlements: ${shown(anonRead.text)}`);
    assert.equal(anonRead.body.code, '42501', `N-04: ${shown(anonRead.text)}`);
    assert.ok(String(anonRead.body.message).includes('permission denied for table entitlements'),
      `N-04: ${shown(anonRead.text)}`);

    for (const [method, path, body] of [
      ['POST', '/rest/v1/entitlements', { wedding_id: weddingOf('hostA'), package_code: CODE.classic,
        source: 'admin_manual', status: 'active' }],
      ['PATCH', `/rest/v1/entitlements?id=eq.${classic.id}`, { status: 'revoked' }],
      ['DELETE', `/rest/v1/entitlements?id=eq.${classic.id}`, undefined],
    ]) {
      const authed = await call(method, path, { bearer: tokenOf('hostA'), body });
      assert.equal(authed.status, 403, `N-04: authenticated ${method} entitlements: ${shown(authed.text)}`);
      assert.equal(authed.body.code, '42501', `N-04: ${shown(authed.text)}`);
      assert.ok(String(authed.body.message).includes('permission denied for table entitlements'),
        `N-04: ${shown(authed.text)}`);

      // Measured asymmetry, kept rather than smoothed over: PostgREST answers an anonymous grant refusal
      // with 401 and an authenticated one with 403, at the same SQLSTATE in the body.
      const anon = await call(method, path, { bearer: anonKey, body });
      assert.equal(anon.status, 401, `N-04: anon ${method} entitlements: ${shown(anon.text)}`);
      assert.equal(anon.body.code, '42501', `N-04: ${shown(anon.text)}`);
    }

    const dropPublication = await call('DELETE', `/rest/v1/publications?wedding_id=eq.${weddingOf('hostB')}`,
      { bearer: tokenOf('hostB') });
    assert.equal(dropPublication.status, 403, `N-04: a host deleting its own publication: ${shown(dropPublication.text)}`);
    assert.equal(dropPublication.body.code, '42501', `N-04: ${shown(dropPublication.text)}`);
    assert.ok(String(dropPublication.body.message).includes('permission denied for table publications'),
      `N-04: ${shown(dropPublication.text)}`);

    assert.equal(count(`from public.entitlements where id = '${classic.id}'`), '1',
      'N-04: a refused write still removed the grant');
    assert.equal(count(`from public.publications where wedding_id = '${weddingOf('hostB')}' and status = 'revoked'`),
      '1', 'N-04: the row the refused DELETE targeted is not what G-07 left it as');

    // The other half of the boundary, and the reason N-04's refusals are not an accident of the client
    // library: the service role reaches the same table at all, because it is the only writer the design
    // allows. Recorded as what it is — accepted — because this suite has no business calling it.
    const serviceWrite = await call('POST', '/rest/v1/entitlements', {
      bearer: serviceKey, headers: { Prefer: 'return=representation' },
      body: { wedding_id: weddingOf('hostB'), package_code: CODE.expire, source: 'admin_manual', status: 'active' },
    });
    assert.equal(serviceWrite.status, 201, `N-04: service_role could not write the grant table: ${shown(serviceWrite.text)}`);
    // A `return=representation` POST answers with an array, the same shape the wedding and draft writes
    // above already read as `body[0]`; asking for `.id` on it returned `undefined` and the cleanup below
    // then deleted a uuid called "undefined" (measured in run r9).
    assert.equal(Array.isArray(serviceWrite.body) && serviceWrite.body.length, 1,
      `N-04: the accepted write did not come back with its row: ${shown(serviceWrite.text)}`);
    const mintedId = serviceWrite.body[0].id;
    assert.ok(/^[0-9a-f-]{36}$/.test(String(mintedId)),
      `N-04: the row the service role minted carries no uuid: ${shown(serviceWrite.text)}`);
    exec(`delete from public.entitlements where id = '${mintedId}'::uuid`, 'the service-role probe row');
    assert.equal(count(`from public.entitlements where id = '${mintedId}'`), '0',
      'N-04: the accepted probe row was not given back');
  });

  test('N-05: the published API index describes none of this', async () => {
    const res = await call('GET', '/rest/v1/', { bearer: anonKey, headers: { Accept: 'application/json' } });
    assert.equal(res.status, 200, `N-05: ${res.status} ${shown(res.text.slice(0, 200))}`);
    // Read the document rather than a pretty-printed guess at its bytes: this stack serves the index
    // minified (`{"swagger":"2.0",…`, measured 200 / 2160 bytes), and an assertion on `"swagger": "2.0"`
    // with the space in it was measuring this file's formatting, not the product's (run r8).
    assert.equal(res.body?.swagger, '2.0', `N-05: the root document is not the API index: ${shown(res.text.slice(0, 200))}`);
    // Measured scope: the root index this stack serves lists one path, `/`, and 2160 bytes. Every needle
    // below is therefore absent because the surface is not described, which is the claim being made — not
    // because a full document was searched and found clean.
    for (const needle of ['internal_api', 'commerce_host_summary', 'entitlements', 'publications',
      ...STORES, ...BODIES]) {
      assert.ok(!res.text.includes(needle),
        `N-05: the served index advertises ${needle}: ${shown(res.text.slice(0, 300))}`);
    }
    assert.deepEqual(Object.keys(res.body.paths ?? {}), ['/'],
      `N-05: the served index stopped describing only the root path, so its scope needs re-reading: `
      + shown(JSON.stringify(Object.keys(res.body.paths ?? {}))));
  });
});

// ---------------------------------------------------------------------------
// Z — the evidence itself, and what must not survive the run
// ---------------------------------------------------------------------------
describe('S10 EVIDENCE AND RESIDUE', () => {
  test('Z-01: every ledger row stores the digest this run computed over the bytes it signed', () => {
    const signed = digests.filter((d) => d.eventId !== null);
    assert.ok(signed.length >= 20,
      `Z-01: only ${signed.length} verified deliveries were made, which is too few for this to mean anything`);
    for (const entry of signed) {
      assert.equal(digestFor(entry.eventId), entry.digest,
        `Z-01: ${entry.caseId} (${entry.eventId}) — the row's digest is not the digest over the signed bytes`);
    }
  });

  test('Z-02: nothing in this run was recorded as live money, and every live row is only a held refusal', () => {
    // D-12 deliberately delivers one row that *claims* the live environment, and the right answer is a kept,
    // unapplied, unlinked refusal — evidence for a human, not money. So the claim this case makes is not
    // "no live-environment row exists", which contradicted a passing case in this same file (run r8), but
    // the stronger and load-bearing one: a live row may never be applied, linked to an order, or carry an
    // effect — and there must be exactly the one D-12 made, listed here rather than counted.
    const liveRows = sqlRows(`select 'event=' || event_id || ' status=' || processing_status
        || ' effect=' || coalesce(applied_effect, '-') || ' hold=' || coalesce(hold_reason, '-')
        || ' order=' || coalesce(order_id::text, '-') || ' attempt=' || coalesce(attempt_id::text, '-')
      from private.commerce_payment_events where environment = 'live' order by event_id`);
    assert.equal(liveRows.length, 1,
      `Z-02: the live-environment rows are not only D-12's held refusal: ${shown(json(liveRows))}`);
    for (const row of liveRows) {
      assert.match(row,
        /status=held_for_reconciliation effect=- hold=live_capture_disabled order=- attempt=-/,
        `Z-02: a live-environment row was more than a held refusal: ${shown(row)}`);
    }
    assert.equal(count(`from private.commerce_payment_events
      where environment = 'live' and processing_status = 'applied'`, 'applied live rows'), '0',
    'Z-02: a live delivery was applied while live capture is switched off');
    assert.equal(cell(`select live_capture_enabled::text from private.commerce_policy where id = 1`,
      'the live capture flag'), 'false', 'Z-02: this run switched live capture on');
    assert.equal(count('from private.commerce_payment_attempts where environment = \'live\'',
      'live attempts'), '0', 'Z-02: an attempt was minted in the live environment');
  });

  test('Z-03: every commerce row on the shared stack belongs to this run', () => {
    const weddings = [...new Set([weddingOf('hostA'), weddingOf('hostB'), ...extraWeddings])]
      .map((w) => `'${w}'::uuid`).join(',');
    assert.ok(weddings.includes(weddingOf('hostA')), `Z-03: the run set is ${weddings}`);

    assert.equal(count(`from private.commerce_payment_events where event_id not like '${RUN_TAG}%'`), '0',
      'Z-03: a ledger row on this stack was not signed by this run');
    assert.equal(count(`from private.commerce_orders where wedding_id not in (${weddings})`), '0',
      'Z-03: an order exists for a wedding this run did not build');
    assert.equal(count(`from private.commerce_payment_attempts a
      where a.order_id not in (select id from private.commerce_orders where wedding_id in (${weddings}))`), '0',
    'Z-03: an attempt hangs off an order from another run');
    assert.equal(count(`from private.commerce_refunds r
      where r.order_id not in (select id from private.commerce_orders where wedding_id in (${weddings}))`), '0',
    'Z-03: a refund hangs off an order from another run');
    assert.equal(count(`from public.entitlements e
      where e.metadata ->> 'order_id' is not null
        and e.wedding_id not in (${weddings})`), '0',
    'Z-03: an entitlement granted by a commerce capture belongs to another wedding');
    assert.equal(count(`from private.commerce_packages where package_code not like '${RUN_TAG}%'`), '0',
      'Z-03: the price catalogue carries a row this run did not write and will not remove');
  });

  test('Z-04: the two shared posture objects are as they were found, before teardown does it for us', () => {
    assert.equal(policyLine(), POLICY_DEFAULTS, `Z-04: ${policyLine()}`);
  });
});
