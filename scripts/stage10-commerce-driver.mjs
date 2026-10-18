// Stage 10 / commerce foundations — the trusted local commerce instrument.
//
// What this process is. Stage 10 deliberately ships no HTTP path that can move money: the six bodies in
// `internal_api` that quote, record, grant, revoke, expire and reconcile hold no EXECUTE grant for
// `anon`, `authenticated` or `service_role` (migration §9, and API39 in
// `supabase/tests/api/stage3_publication.test.mjs` proves it). Reachability is a property of the *role*:
// only a `postgres` maintenance session can call them. This file is that session, given a command line.
// It is the analogue of `scripts/stage9-output-publisher.mjs` for the money surface, and it is what
// `supabase/tests/api/stage10_commerce_http.test.mjs` imports so the HTTP tier drives a real signed
// delivery instead of a hand-written SQL literal.
//
// What it does, and the one rule each step exists to enforce:
//
//   * **It signs bytes to make a fixture, and reads bytes to make a decision.** `razorpayDelivery` and
//     `cashfreeDelivery` produce the digest each provider really sends, so a synthetic fixture is a
//     faithful delivery rather than a guess at one. `runDelivery` then hands those exact bytes to
//     `scripts/stage10-webhook-core.mjs` and records only what that verifier says.
//   * **A delivery never speaks for itself about money.** Every fact column comes from the verifier's
//     answer over authenticated bytes. An unverified body contributes one thing only: the identity the
//     *transport* named in a header. Nothing else in it is read, quoted, or stored.
//   * **That identity rule is load-bearing, and it is why this file refuses.** `record_commerce_event`
//     answers a repeat of `(provider, event_id)` from the row it already holds, before it looks at the
//     new delivery (`...20261017120000_stage10_commerce_foundations.sql:960-973`). A forged delivery that
//     quotes the id a later genuine one will carry therefore makes the genuine capture read as
//     `already_recorded` under `rejected_signature` and never grant. So: a refusal is ledgered under
//     `x-razorpay-event-id` when the transport supplied one — Razorpay names its event in a header — and
//     is **not ledgered at all** when it has no such identity. Cashfree signs `<timestamp>.<body>` and
//     keeps its id inside the body, so a refused Cashfree delivery is unverifiable *including* its
//     identity, and this instrument says so instead of inventing one. `no_trusted_event_identity` is that
//     sentence. A Stage 11 receiver that wants Cashfree refusals in the ledger must decide that trade
//     explicitly; this file will not decide it quietly.
//   * **The environment is declared, never derived.** The operator names `synthetic`/`sandbox`/`test`,
//     the value travels to the ledger as the operator's assertion, and a verifier that echoed a different
//     one is a refusal here rather than a row there. `live` is refused outright: a local instrument has
//     no business holding a live key, and §4.2's `live_capture_disabled` hold is the backstop, not the
//     plan.
//   * **Injection is impossible rather than unlikely.** Every value is one standard literal with its
//     quotes doubled, or a cast NULL, and every document leaves base64-encoded — the discipline
//     `scripts/tradition-pack-admin.mjs:139-151` and `scripts/stage9-publish-core.mjs:408-448` already
//     hold. `ensureSafeEncoding` asserts `standard_conforming_strings = on` before the first literal is
//     sent, because that doubling depends on it.
//   * **A key is read from an environment variable named by an option, and never printed.** argv is
//     refused for secrets and connection strings because a shell history is not a credential store, and
//     `assertSecretFree` stands in front of every line this process writes.
//
// Two things this file is not, stated because both would be easy to mistake it for. It is **not** a
// checkout: it mints a quote and records what a provider claims; it never opens a hosted order, returns a
// URL, or touches a provider's API. It has **no dry run**, because every statement it can emit is a
// function call rather than a visible `INSERT`/`UPDATE`, and a mode that prints "would have called
// record_commerce_event" is a mode that lies about what the code under it would have done.
//
// Usage:
//   node scripts/stage10-commerce-driver.mjs sign --provider razorpay --body-file capture.json \
//     --secret-env S10_SYNTHETIC_KEY --event-id evt_1 --out delivery.json
//   node scripts/stage10-commerce-driver.mjs deliver --delivery-file delivery.json \
//     --secret-env S10_SYNTHETIC_KEY --environment synthetic --actor <uuid> \
//     --via-docker supabase_db_localvivaahvarnam
//   node scripts/stage10-commerce-driver.mjs quote --wedding <uuid> --package <code> --actor <uuid> --via-docker ...
//   node scripts/stage10-commerce-driver.mjs observe|grant|revoke|expire|reconcile ... --via-docker ...
//
// Exit codes: 0 the command ran and its answer was printed; 1 a refusal reached the ledger or an outcome
// the operator has to read; 2 usage, target and credential problems that stopped the run before it spoke
// to Postgres.

import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CASHFREE_SIGNATURE_HEADER,
  CASHFREE_TIMESTAMP_HEADER,
  PROVIDERS,
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_SIGNATURE_HEADER,
  sha256Hex,
  verifyProviderWebhook,
} from './stage10-webhook-core.mjs';

const USAGE_ONLY = 2;

class Refusal extends Error {
  constructor(message, code = USAGE_ONLY) {
    super(message);
    this.exitCode = code;
  }
}

// The four environments the ledger's own CHECK accepts, restated here because this tool must be able to
// refuse an undeclared one before it sends anything, not be told about it by a constraint mid-statement.
const ENVIRONMENTS = Object.freeze(['synthetic', 'sandbox', 'test', 'live']);

// An event identity is a provider's opaque label, not free text. The ceiling and the character class are
// what keep an attacker-chosen string out of a unique key and out of a statement's syntax; a real
// Razorpay id is ~30 characters, so 200 refuses only the things that are not ids.
const MAX_EVENT_ID_LENGTH = 200;
const EVENT_ID_SHAPE = /^[A-Za-z0-9._:-]+$/;

// The ledger function's parameter list, in its own order and its own types. `recordEventSql` renders one
// value per row of this table and refuses anything else in that position, so a swapped pair of facts is
// caught here rather than written into a column nothing re-reads. CD-08 compares this against the
// migration's declaration on every test run.
const RECORD_EVENT_ARGS = Object.freeze([
  ['provider', 'text'],
  ['event_id', 'text'],
  ['event_type', 'text'],
  ['kind', 'text'],
  ['environment', 'text'],
  ['raw_body_sha256', 'text'],
  ['delivery_verified', 'boolean'],
  ['refusal_reason', 'text'],
  ['merchant_reference', 'text'],
  ['amount_minor', 'bigint'],
  ['currency', 'text'],
  ['provider_order_ref', 'text'],
  ['provider_payment_ref', 'text'],
  ['occurred_at', 'timestamptz'],
  ['actor_user_id', 'uuid'],
]);

// ------------------------------------------------------------------ literals
// Re-declared rather than imported from Stage 9's modules on purpose: the money instrument must not stop
// working because a rendering tool's module graph moved. The rules are the same ones, cited at §139-151
// of `scripts/tradition-pack-admin.mjs`.

/** One standard string literal, quotes doubled. Throws on a NUL, which `psql` would silently truncate. */
function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  const s = String(value);
  if (s.includes('\u0000')) throw new Refusal('refused: a value contains a NUL byte.');
  return `'${s.replaceAll("'", "''")}'`;
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const isUuid = (value) => typeof value === 'string' && UUID.test(value);

const sqlText = (value) => `${sqlLiteral(value)}::text`;

function sqlUuid(value, label) {
  if (!isUuid(value)) throw new Refusal(`refused: the ${label} is not a uuid, so it has no business in a uuid position.`);
  return `${sqlLiteral(value.toLowerCase())}::uuid`;
}

function sqlBigInt(value) {
  if (value === null || value === undefined) return 'NULL::bigint';
  // An integer too wide for the column is refused rather than clamped, and a fraction is refused rather
  // than rounded — the same two refusals the verifier makes, one layer further out.
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new Refusal('refused: an amount that is not a safe integer cannot be recorded as a minor-unit claim.');
  }
  return String(value);
}

function sqlBool(value) {
  if (typeof value !== 'boolean') throw new Refusal('refused: a boolean position was handed something else.');
  return value ? 'true' : 'false';
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function sqlTimestamp(value) {
  if (value === null || value === undefined) return 'NULL::timestamptz';
  if (typeof value !== 'string' || !ISO_8601.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Refusal('refused: a timestamp must be an ISO 8601 string before it can be cast to one.');
  }
  return `${sqlLiteral(value)}::timestamptz`;
}

/** A jsonb answer leaves the statement base64-encoded, so the CLI's parsing is total rather than
 *  best-effort and no quote, backslash or newline in the ledger's own sentence reaches the terminal. */
const b64Out = (expr) => `encode(convert_to((${expr})::text, 'utf8'), 'base64')`;

const call = (functionName, args) => `internal_api.${functionName}(\n  ${args.join(',\n  ')}\n)`;

const statement = (expr) => `SELECT ${b64Out(expr)};`;

/** The digest this instrument records. Computed over the bytes it was handed, by the same function the
 *  verifier used to decide about them, so the row and the verdict describe one byte string. */
const sha256Of = (rawBody) => sha256Hex(rawBody);

// ------------------------------------------------------------------ the six money statements

function recordEventSql(args) {
  if (!Array.isArray(args) || args.length !== RECORD_EVENT_ARGS.length) {
    throw new Refusal(`refused: the ledger takes fifteen arguments, this call carried ${args?.length ?? 'nothing'}.`);
  }
  const shape = {
    text: /^(?:'(?:[^']|'')*'|NULL)::text$/,
    boolean: /^(?:true|false)$/,
    bigint: /^(?:-?\d+|NULL::bigint)$/,
    timestamptz: /^(?:'(?:[^']|'')*'|NULL)::timestamptz$/,
    uuid: /^'[0-9a-f-]{36}'::uuid$/,
  };
  args.forEach((rendered, index) => {
    const [, type] = RECORD_EVENT_ARGS[index];
    if (typeof rendered !== 'string' || !shape[type].test(rendered)) {
      throw new Refusal(`refused: position ${index + 1} (${RECORD_EVENT_ARGS[index][0]}) is not a well-formed ${type}.`);
    }
  });
  return statement(call('record_commerce_event', args));
}

function quoteOrderSql({ weddingId, packageCode, actorUserId }) {
  if (typeof packageCode !== 'string' || packageCode.trim() === '') {
    throw new Refusal('refused: a quote names a package code, and this tool will not guess one.');
  }
  return statement(call('create_commerce_order', [
    sqlUuid(weddingId, 'wedding'), sqlText(packageCode.trim()), sqlUuid(actorUserId, 'actor'),
  ]));
}

const grantEntitlementSql = ({ orderId, actorUserId }) =>
  statement(call('grant_commerce_entitlement', [sqlUuid(orderId, 'order'), sqlUuid(actorUserId, 'actor')]));

const expireOrderSql = ({ orderId, actorUserId }) =>
  statement(call('expire_commerce_order', [sqlUuid(orderId, 'order'), sqlUuid(actorUserId, 'actor')]));

const reconcileOrderSql = ({ orderId, actorUserId }) =>
  statement(call('commerce_reconcile', [sqlUuid(orderId, 'order'), sqlUuid(actorUserId, 'actor')]));

function revocationSql({ orderId, actorUserId, reason }) {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Refusal('refused: a revocation must carry a reason, because an entitlement is a right '
      + 'somebody was told they have.');
  }
  return statement(call('revoke_commerce_entitlement', [
    sqlUuid(orderId, 'order'), sqlUuid(actorUserId, 'actor'), sqlText(reason.trim()),
  ]));
}

/** Everything one purchase consists of, in one round trip. The ledger's columns are named rather than
 *  `row_to_json`-ed because the table's only body-derived column is the digest, and the observation must
 *  not acquire a wider read by accident. */
function observeOrderSql({ orderId }) {
  const id = sqlUuid(orderId, 'order');
  return statement(`json_build_object(
    'order', (SELECT json_build_object('id', o.id, 'wedding_id', o.wedding_id, 'owner_user_id', o.owner_user_id,
                                       'merchant_reference', o.merchant_reference, 'package_code', o.package_code,
                                       'price_version', o.price_version, 'amount_minor', o.amount_minor,
                                       'currency', o.currency, 'status', o.status, 'provider', o.provider,
                                       'quote_expires_at', o.quote_expires_at, 'captured_at', o.captured_at,
                                       'closed_at', o.closed_at, 'entitlement_id', o.entitlement_id)
                FROM private.commerce_orders o WHERE o.id = ${id}),
    'events', (SELECT json_agg(json_build_object('id', e.id, 'provider', e.provider, 'event_id', e.event_id,
                                                 'event_type', e.event_type, 'kind', e.kind, 'environment', e.environment,
                                                 'order_id', e.order_id, 'attempt_id', e.attempt_id,
                                                 'merchant_reference', e.merchant_reference, 'amount_minor', e.amount_minor,
                                                 'currency', e.currency, 'raw_body_sha256', e.raw_body_sha256,
                                                 'signature_valid', e.signature_valid, 'refusal_reason', e.refusal_reason,
                                                 'hold_reason', e.hold_reason, 'processing_status', e.processing_status,
                                                 'applied_effect', e.applied_effect, 'occurred_at', e.occurred_at,
                                                 'received_at', e.received_at) ORDER BY e.id)
                 FROM private.commerce_payment_events e WHERE e.order_id = ${id}),
    'attempts', (SELECT json_agg(json_build_object('id', a.id, 'provider', a.provider, 'provider_attempt_ref',
                                                  a.provider_attempt_ref, 'status', a.status, 'created_at', a.created_at)
                                   ORDER BY a.created_at)
                   FROM private.commerce_payment_attempts a WHERE a.order_id = ${id}),
    'refunds', (SELECT json_agg(json_build_object('id', r.id, 'event_id', r.event_id, 'provider_refund_ref',
                                                 r.provider_refund_ref, 'amount_minor', r.amount_minor, 'status', r.status)
                                  ORDER BY r.id)
                  FROM private.commerce_refunds r WHERE r.order_id = ${id}),
    'entitlement', (SELECT json_build_object('id', en.id, 'package_code', en.package_code, 'status', en.status,
                                            'revoked_at', en.revoked_at, 'metadata', en.metadata)
                      FROM public.entitlements en
                     WHERE en.id = (SELECT o.entitlement_id FROM private.commerce_orders o WHERE o.id = ${id}))
  )`);
}

// ------------------------------------------------------------------ verdict to fifteen values

function verifiedEventArgs(verdict, { environment, actorUserId }) {
  if (!verdict || verdict.ok !== true) {
    throw new Refusal('refused: this is not a verified verdict, so it has no facts to record.');
  }
  // The verifier echoes the environment it was *handed*, which the operator declared. Reading them both
  // and comparing is what makes a mis-wired route a refusal here rather than a wrong row there.
  if (verdict.environment !== environment) {
    throw new Refusal('refused: the verdict names one environment and this run declared another.');
  }
  if (typeof verdict.rawBodySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(verdict.rawBodySha256)) {
    throw new Refusal('refused: a verdict without a 64-hex body digest describes no bytes.');
  }
  const facts = verdict.facts ?? {};
  return [
    sqlText(verdict.provider), sqlText(verdict.eventId), sqlText(verdict.eventType ?? null),
    sqlText(verdict.kind), sqlText(environment), sqlText(verdict.rawBodySha256), sqlBool(true),
    sqlText(null), sqlText(facts.merchantReference ?? null), sqlBigInt(facts.amountMinor ?? null),
    sqlText(facts.currency ?? null), sqlText(facts.providerOrderRef ?? null),
    sqlText(facts.providerPaymentRef ?? null), sqlTimestamp(verdict.occurredAt ?? null),
    sqlUuid(actorUserId, 'actor'),
  ];
}

/** A refusal, spelled the way the ledger wants it: the verdict and the reason are facts about the bytes,
 *  the kind is the one value that says "this build understood nothing", and every fact column is NULL
 *  because nothing in an unauthenticated body was read. */
function refusedEventArgs({ provider, eventId, rawBodySha256, reason, environment, actorUserId }) {
  if (!PROVIDERS.includes(provider)) throw new Refusal('refused: a refusal must still name the provider it was about.');
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new Refusal('refused: a refusal without its reason is not evidence, it is a silence.');
  }
  return [
    sqlText(provider), sqlText(eventId), sqlText(null), sqlText('other'), sqlText(environment),
    sqlText(rawBodySha256), sqlBool(false), sqlText(reason.trim()), sqlText(null), sqlBigInt(null),
    sqlText(null), sqlText(null), sqlText(null), sqlTimestamp(null), sqlUuid(actorUserId, 'actor'),
  ];
}

/** The identity a *refused* delivery may be recorded under: the transport's own header claim, shape-
 *  checked, or nothing. Reading a body here would quote an attacker's string into the ledger's unique
 *  key, which is the poisoning the header comment describes. */
function claimedRefusalIdentity({ provider, headers }) {
  if (provider !== 'razorpay') return null;
  const wanted = RAZORPAY_EVENT_ID_HEADER.toLowerCase();
  let value;
  for (const [name, candidate] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() === wanted && typeof candidate === 'string') value = candidate.trim();
  }
  if (!value || value.length > MAX_EVENT_ID_LENGTH || !EVENT_ID_SHAPE.test(value)) return null;
  return value;
}

// ------------------------------------------------------------------ one delivery, start to finish

function runDelivery({
  sql, delivery, secret, environment, actorUserId, now, timestampToleranceMs,
}) {
  if (typeof sql !== 'function') throw new Refusal('refused: no SQL channel was supplied.');
  if (!PROVIDERS.includes(delivery?.provider)) {
    throw new Refusal('refused: a delivery must name a provider this build has read a scheme for.');
  }
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Refusal('refused: no webhook secret was supplied, so nothing here could be verified.');
  }
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Refusal('refused: the environment is declared by the operator and never inferred.');
  }
  // Checked here rather than at the end of the argument list: a run that cannot name who paid should not
  // spend the verifier's work finding that out.
  sqlUuid(actorUserId, 'actor');
  const digest = sha256Of(delivery.rawBody);

  const verdict = verifyProviderWebhook({
    provider: delivery.provider,
    rawBody: delivery.rawBody,
    headers: delivery.headers ?? {},
    secret,
    environment,
    now,
    timestampToleranceMs,
  });

  let args;
  if (verdict.ok === true) {
    args = verifiedEventArgs(verdict, { environment, actorUserId });
  } else {
    const eventId = claimedRefusalIdentity(delivery);
    if (eventId === null) {
      return {
        verified: false, reason: verdict.reason, recorded: false,
        refusal: 'no_trusted_event_identity', statement: null, result: null,
      };
    }
    args = refusedEventArgs({
      provider: delivery.provider, eventId, rawBodySha256: digest,
      reason: verdict.reason ?? 'signature_mismatch', environment, actorUserId,
    });
  }

  const built = recordEventSql(args);
  return {
    verified: verdict.ok === true,
    reason: verdict.ok === true ? null : verdict.reason,
    recorded: true,
    kind: verdict.ok === true ? verdict.kind : 'other',
    digest,
    statement: built,
    result: decodeLine(sql(built)),
  };
}

// ------------------------------------------------------------------ the channels

/** One base64 line out of `psql -At`, back into the value the statement was asked to build. */
function decodeLine(line) {
  try {
    return JSON.parse(Buffer.from(String(line).trim(), 'base64').toString('utf8'));
  } catch {
    throw new Refusal('refused: a statement answered with something that is not the JSON it was asked to '
      + 'build, so this run cannot trust what it read.', 1);
  }
}

/** The doubling rule in `sqlLiteral` is only a rule under `standard_conforming_strings = on`. Asked once,
 *  before any literal is sent, because the answer is a property of the session and not of the statement. */
function ensureSafeEncoding(sql) {
  const value = String(sql('SHOW standard_conforming_strings;') ?? '').trim();
  if (value !== 'on') {
    throw new Refusal('refused: standard_conforming_strings is not exactly `on`, so a backslash in a value '
      + 'could eat a quote. This instrument does not send literals into that session.');
  }
  return value;
}

/** The `psql` that already ships with the local stack, in-container (peer-authenticated, so no password
 *  is in this process, its environment or argv) or through the loopback URL an operator named. */
function runPsql(target, text) {
  const docker = target.mode === 'docker';
  const args = docker
    ? ['exec', '-i', '-e', 'PGCLIENTENCODING=UTF8', target.container,
      'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-']
    : ['-v', 'ON_ERROR_STOP=1', '-At', '-q', target.url, '-'];
  const res = spawnSync(docker ? 'docker' : 'psql', args, {
    input: text, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) {
    throw new Refusal(`refused: ${docker ? 'docker' : 'psql'} could not be run (${res.error.message}). `
      + 'This tool does not fall back to another route, because an instrument that quietly tries one is '
      + 'how the wrong database gets a payment event.', 1);
  }
  if (res.status !== 0) {
    const text2 = `${res.stderr ?? ''}${res.stdout ?? ''}`.trim().split('\n').pop() ?? 'the statement failed';
    // The database's own sentence, first line only: it names the constraint or the RAISE that fired,
    // which is the thing an operator needs, and it cannot contain a credential.
    throw Object.assign(new Error(text2.slice(0, 300)), { exitCode: 1 });
  }
  return res.stdout.trim();
}

// ------------------------------------------------------------------ the signers

const toText = (body) => {
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  if (typeof body === 'string') return body;
  throw new Refusal('refused: a body is bytes or text; a document is neither.');
};

const requireSecret = (secret) => {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Refusal('refused: no webhook secret was supplied, so signing would produce a fixture that '
      + 'nothing could verify.');
  }
  return secret;
};

/** Razorpay's wire format: a lowercase-hex HMAC-SHA256 of the raw body, and the event id in a header too. */
function razorpayDelivery({ body, secret, eventId }) {
  requireSecret(secret);
  if (typeof eventId !== 'string' || eventId.trim() === '') {
    throw new Refusal('refused: a Razorpay delivery names its event.');
  }
  const rawBody = toText(body);
  return {
    provider: 'razorpay',
    rawBody,
    headers: {
      [RAZORPAY_SIGNATURE_HEADER]: hexHmac(secret, rawBody),
      [RAZORPAY_EVENT_ID_HEADER]: eventId.trim(),
    },
  };
}

/** Cashfree's wire format: a base64 HMAC-SHA256 of `"<seconds>.<raw body>"`, with the timestamp on the
 *  header it is signed under. Defaults to now, because a fixture drawn at a stale timestamp is a refusal
 *  rather than a delivery. */
function cashfreeDelivery({ body, secret, timestamp, now = Date.now() }) {
  requireSecret(secret);
  const stamp = timestamp ?? String(Math.floor(now / 1000));
  if (!/^[1-9][0-9]{0,9}$/.test(stamp)) {
    throw new Refusal('refused: the Cashfree timestamp must be whole seconds, because it is inside the signed string.');
  }
  const rawBody = toText(body);
  return {
    provider: 'cashfree',
    rawBody,
    headers: {
      [CASHFREE_SIGNATURE_HEADER]: base64Hmac(secret, `${stamp}.${rawBody}`),
      [CASHFREE_TIMESTAMP_HEADER]: stamp,
    },
  };
}

// Both signers use one primitive with a different encoding and a different input, which is exactly the
// difference between the two providers' schemes; there is no third form to drift into.
const hexHmac = (secret, input) => createHmac('sha256', secret).update(Buffer.from(input, 'utf8')).digest('hex');
const base64Hmac = (secret, input) => createHmac('sha256', secret).update(Buffer.from(input, 'utf8')).digest('base64');

// ------------------------------------------------------------------ the command line

const COMMANDS = Object.freeze(['sign', 'deliver', 'quote', 'grant', 'revoke', 'expire', 'reconcile', 'observe']);
const BOOLEAN_FLAGS = new Set(['db-url-env', 'help']);

// A key or a connection string is never an argument. argv survives in shell history, in `ps` output and in
// whatever log prints the command line, so the only way in is to name an environment variable. Listing the
// spellings an operator might reach for — rather than ignoring unknown flags — is what turns a mistake
// into a sentence instead of a silently missing secret.
const FORBIDDEN_CREDENTIAL_FLAGS = Object.freeze([
  'secret', 'db-url', 'service-key', 'apikey', 'anon-key', 'anonkey', 'password', 'webhook-key', 'webhook-secret',
]);

// The price of a wedding is calculated by `create_commerce_order` from the pinned policy row and then
// matched against a verified delivery. A command line that could state an amount is a command line that
// pays what the operator typed, so this tool has no such option and says so.
const FORBIDDEN_PRICE_FLAGS = Object.freeze(['amount', 'amount-minor', 'currency', 'price']);

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

const USAGE = `usage: node scripts/stage10-commerce-driver.mjs <command> [options]

  sign      build one faithful synthetic delivery from a body file; needs no database
  deliver   verify a delivery file and record what the verifier said, in the ledger
  quote     mint a server-calculated order for one wedding
  grant     grant the entitlement a captured order earned
  revoke    revoke an entitlement, with a reason
  expire    expire a quote that went past its own expiry
  reconcile read one order's own facts back as findings
  observe   read the order, ledger, attempts, refunds and entitlement as one document

Options: --wedding <uuid> --package <code> --order <uuid> --actor <uuid> --reason <text>
         --provider razorpay|cashfree --body-file <path> --event-id <id> --delivery-file <path>
         --environment synthetic|sandbox|test (default synthetic) --secret-env <NAME>
         --out <path> --via-docker supabase_db_<project> | --db-url-env

There is no --dry-run: every statement this tool can send is a call to a function in internal_api, so a
mode that printed "would have called record_commerce_event" would be printing a guess about the code under
it. There is no --amount: the amount comes from the quote and the verified bytes. There is no live: a
local instrument has no business holding a live key, and §4.2's live hold is a backstop, not a plan.`;

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      parsed._.push(a);
      continue;
    }
    const name = a.slice(2);
    if (name.includes('=')) {
      const [key, value] = name.split(/=(.*)/s, 2);
      parsed[key] = value;
      continue;
    }
    if (BOOLEAN_FLAGS.has(name)) {
      parsed[name] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) parsed[name] = true;
    else {
      parsed[name] = next;
      i += 1;
    }
  }
  return parsed;
}

/** The target gate, carried over from `scripts/stage9-output-publisher.mjs:211-241` in the same form: a
 *  container name of the local stack's own shape, or a loopback URL an operator named, and nothing else.
 *  A hosted address is refused here rather than discovered by a request that already left the machine. */
function resolveTarget(args, env = {}) {
  const hosted = /supabase\.co|supabase\.io/i;
  if (args['via-docker']) {
    const name = String(args['via-docker']);
    if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(name)) {
      throw new Refusal(`refused: --via-docker wants the local stack's database container name `
        + `(supabase_db_<project>), got ${JSON.stringify(name)}.`);
    }
    if (hosted.test(name)) throw new Refusal('refused: the container name names a hosted target.');
    return { mode: 'docker', container: name };
  }
  if (args['db-url-env']) {
    const url = env.VIVAAHVARNAM_MAINT_DB_URL;
    if (!url) {
      throw new Refusal('refused: --db-url-env means "read the URL from VIVAAHVARNAM_MAINT_DB_URL", '
        + 'and that variable is not set. A connection string is never accepted on the command line, '
        + 'because argv lands in shell history.');
    }
    if (hosted.test(url)) throw new Refusal('refused: the URL names a hosted target.');
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      throw new Refusal('refused: the URL in VIVAAHVARNAM_MAINT_DB_URL does not parse.');
    }
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new Refusal(`refused: the URL's host is ${host}. Only a loopback address is a local `
        + 'maintenance target.');
    }
    return { mode: 'url', url };
  }
  throw new Refusal('refused: no maintenance target was supplied.\n'
    + '  Pass --via-docker <local database container>, or set VIVAAHVARNAM_MAINT_DB_URL to a\n'
    + '  loopback postgresql:// URL and pass --db-url-env. There is no default on purpose.');
}

function readSecret(env, name) {
  if (typeof name !== 'string' || !ENV_NAME.test(name)) {
    throw new Refusal(`refused: --secret-env wants an environment variable name such as S10_SYNTHETIC_KEY, `
      + `got ${JSON.stringify(name ?? '(none)')}.`);
  }
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Refusal(`refused: --secret-env names ${name} and that environment variable is unset or blank. `
      + 'This tool takes a key from no other place and falls back to no other value.');
  }
  return { secretEnv: name, secret: value };
}

const CONNECTION_STRING = /postgres(?:ql)?:\/\/[^/\s]+:[^/\s]+@/i;

function assertNoConnectionString(text) {
  if (CONNECTION_STRING.test(text)) {
    throw new Refusal('refused: a line this run was about to print contains a connection string with a '
      + 'credential in it.', 1);
  }
  return text;
}

/** The last gate before bytes leave this process. A key is what the run was handed, so a line that
 *  carries one is a line that would publish the credential in whatever log reads stdout. A connection
 *  string is the same accident in the other direction, and a guard handed nothing to guard against is a
 *  guard that was never armed, so it refuses rather than passes. */
function assertSecretFree(text, secret) {
  const line = String(text);
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Refusal('refused: assertSecretFree was asked to guard a line against an empty secret, so it '
      + 'does not know what it is protecting and prints nothing.', 1);
  }
  if (line.includes(secret)) {
    throw new Refusal('refused: a line this run was about to print contains the secret it was handed.', 1);
  }
  return assertNoConnectionString(line);
}

function readOptions(args, env = {}) {
  if (args.help) return { help: true };
  for (const flag of FORBIDDEN_CREDENTIAL_FLAGS) {
    if (args[flag] !== undefined) {
      throw new Refusal(`refused: --${flag} is not an option this tool has. A secret, key or connection `
        + 'string is named by an environment variable (--secret-env NAME, or --db-url-env with '
        + 'VIVAAHVARNAM_MAINT_DB_URL) and never passed as an argument, because a shell history is not a '
        + 'credential store.');
    }
  }
  for (const flag of FORBIDDEN_PRICE_FLAGS) {
    if (args[flag] !== undefined) {
      throw new Refusal(`refused: --${flag} is not an option this tool has. The amount and the currency of `
        + 'a purchase come from create_commerce_order and from a verified delivery; a command line that '
        + 'could state one is a command line that sets its own price.');
    }
  }
  const command = String(args._[0] ?? '');
  if (command === '') throw new Refusal(`refused: no command was given.\n${USAGE}`);
  if (!COMMANDS.includes(command)) {
    throw new Refusal(`refused: ${command} is an unknown command. This tool has ${COMMANDS.join(', ')}.\n${USAGE}`);
  }

  const option = (flag) => (typeof args[flag] === 'string' && args[flag].trim() !== '' ? args[flag].trim() : null);
  const need = (flag, what) => {
    const value = option(flag);
    if (value === null) throw new Refusal(`refused: ${command} needs --${flag}, which is ${what}.`);
    return value;
  };
  // Validated by the renderer that will use it, then handed back as the plain lowercased value: an option
  // is data, and the cast belongs to the builder, not to the reading of a command line.
  const needUuid = (flag, label) => {
    const value = need(flag, `the ${label} this run acts on, as a uuid`);
    sqlUuid(value, label);
    return value.toLowerCase();
  };

  const now = option('now') === null ? undefined : Number(option('now'));
  if (now !== undefined && (!Number.isFinite(now) || !Number.isInteger(now))) {
    throw new Refusal('refused: --now wants whole milliseconds, because it is what a freshness window is measured against.');
  }
  const toleranceMs = option('tolerance-ms') === null ? undefined : Number(option('tolerance-ms'));
  if (toleranceMs !== undefined && (!Number.isFinite(toleranceMs) || toleranceMs < 0)) {
    throw new Refusal('refused: --tolerance-ms wants a non-negative number of milliseconds.');
  }

  const out = {
    command,
    secretEnv: null,
    secret: null,
    environment: null,
    actorUserId: null,
    weddingId: null,
    packageCode: null,
    orderId: null,
    reason: null,
    provider: null,
    bodyFile: null,
    eventId: null,
    timestamp: null,
    deliveryFile: null,
    outFile: option('out'),
    now,
    toleranceMs,
    target: command === 'sign' ? null : resolveTarget(args, env),
  };

  if (command === 'sign') {
    out.provider = need('provider', 'the provider whose scheme the fixture must follow');
    if (!PROVIDERS.includes(out.provider)) {
      throw new Refusal(`refused: ${out.provider} is not a provider this build has a scheme for (${PROVIDERS.join(', ')}).`);
    }
    out.bodyFile = need('body-file', 'the file whose exact bytes become the request body');
    const resolved = readSecret(env, option('secret-env'));
    out.secretEnv = resolved.secretEnv;
    out.secret = resolved.secret;
    if (out.provider === 'razorpay') out.eventId = need('event-id', 'the event id that delivery names');
    out.timestamp = option('timestamp');
    return out;
  }

  if (command === 'deliver') {
    // Declared before the target's own value is used, and before the ledger is asked anything: a live
    // environment is refused by this tool, not held by the database as a courtesy.
    const environment = option('environment') ?? 'synthetic';
    if (environment === 'live') {
      throw new Refusal('refused: live is not an environment a local instrument declares. This run holds '
        + 'no live key, and a tool that could name live is a tool that can be pointed at a real wedding.');
    }
    if (!ENVIRONMENTS.includes(environment)) {
      throw new Refusal(`refused: --environment ${environment} is not one this tool offers (${ENVIRONMENTS.filter((e) => e !== 'live').join(', ')}).`);
    }
    out.environment = environment;
    out.deliveryFile = need('delivery-file', 'the JSON carrying the raw body and the headers as they arrived');
    out.actorUserId = needUuid('actor', 'actor');
    const resolved = readSecret(env, option('secret-env'));
    out.secretEnv = resolved.secretEnv;
    out.secret = resolved.secret;
    return out;
  }

  if (command === 'quote') {
    out.weddingId = needUuid('wedding', 'wedding being quoted');
    out.packageCode = need('package', 'the package code whose pinned price the quote must use');
  } else {
    out.orderId = needUuid('order', 'the commerce order this step is about');
  }
  if (command !== 'observe') out.actorUserId = needUuid('actor', 'the host user whose name the action is taken in');
  if (command === 'revoke') out.reason = need('reason', 'the sentence an entitlement holder will be told');
  return out;
}

// ------------------------------------------------------------------ running the commands

/** One session, checked once. `standard_conforming_strings` is a property of the connection, so asking on
 *  the first statement covers every literal that follows it in the same channel. */
function channel(target) {
  let checked = false;
  return (text) => {
    if (!checked) {
      ensureSafeEncoding((probe) => runPsql(target, probe));
      checked = true;
    }
    return runPsql(target, text);
  };
}

function emit(opts, value) {
  const line = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  const safe = assertSecretFree(line, opts.secret ?? '');
  if (opts.outFile !== null) writeFileSync(resolve(opts.outFile), safe, 'utf8');
  process.stdout.write(safe.endsWith('\n') ? safe : `${safe}\n`);
  return safe;
}

function readBodyFile(path) {
  try {
    return readFileSync(resolve(path), 'utf8');
  } catch {
    throw new Refusal(`refused: the body file ${path} could not be read, so there are no bytes to sign.`);
  }
}

/** The delivery a `sign` run produced, read back. The digest is deliberately *not* taken from this file:
 *  `runDelivery` computes it over these bytes, so a delivery document cannot assert a digest about body it
 *  does not carry. */
function readDeliveryFile(path) {
  let document;
  try {
    document = JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch {
    throw new Refusal(`refused: the delivery file ${path} is not one JSON document.`);
  }
  const headers = document.headers ?? {};
  if (typeof headers !== 'object' || Array.isArray(headers)) {
    throw new Refusal('refused: a delivery file carries its headers as an object of names to values.');
  }
  return {
    provider: String(document.provider ?? ''),
    rawBody: String(document.rawBody ?? document.body ?? ''),
    headers,
  };
}

async function mainCli(argv) {
  const opts = readOptions(parseArgs(argv), process.env);
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const sql = opts.target === null ? null : channel(opts.target);

  if (opts.command === 'sign') {
    const body = readBodyFile(opts.bodyFile);
    const delivery = opts.provider === 'razorpay'
      ? razorpayDelivery({ body, secret: opts.secret, eventId: opts.eventId })
      : cashfreeDelivery({ body, secret: opts.secret, timestamp: opts.timestamp ?? undefined, now: opts.now });
    emit(opts, { provider: delivery.provider, rawBody: delivery.rawBody, headers: delivery.headers });
    return 0;
  }

  if (opts.command === 'deliver') {
    const result = runDelivery({
      sql,
      delivery: readDeliveryFile(opts.deliveryFile),
      secret: opts.secret,
      environment: opts.environment,
      actorUserId: opts.actorUserId,
      now: opts.now,
      timestampToleranceMs: opts.toleranceMs,
    });
    emit(opts, result);
    // A refusal that reached the ledger, and a refusal that could not be ledgered at all, are both things
    // an operator has to read, so both exit 1. Only a verified capture leaves this run at zero.
    if (!result.recorded) return 1;
    return result.verified ? 0 : 1;
  }

  const built = {
    quote: () => quoteOrderSql(opts),
    grant: () => grantEntitlementSql(opts),
    revoke: () => revocationSql(opts),
    expire: () => expireOrderSql(opts),
    reconcile: () => reconcileOrderSql(opts),
    observe: () => observeOrderSql(opts),
  }[opts.command]();
  emit(opts, decodeLine(sql(built)));
  return 0;
}

// The scheme test is not paranoia: this module is also loaded by `scripts/stage10-commerce-driver.test.mjs`
// under this project's jsdom environment, where `import.meta.url` is an http URL and `fileURLToPath` of it
// throws. A module imported by a test is by definition not the process on the command line.
const invokedDirectly = import.meta.url.startsWith('file:')
  && process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    process.exitCode = await mainCli(process.argv.slice(2));
  } catch (error) {
    if (error instanceof Refusal) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode ?? USAGE_ONLY;
    } else {
      throw error;
    }
  }
}

export {
  ENVIRONMENTS,
  MAX_EVENT_ID_LENGTH,
  RECORD_EVENT_ARGS,
  assertSecretFree,
  cashfreeDelivery,
  claimedRefusalIdentity,
  decodeLine,
  ensureSafeEncoding,
  expireOrderSql,
  grantEntitlementSql,
  observeOrderSql,
  parseArgs,
  quoteOrderSql,
  razorpayDelivery,
  readOptions,
  recordEventSql,
  reconcileOrderSql,
  refusedEventArgs,
  resolveTarget,
  revocationSql,
  runDelivery,
  runPsql,
  sha256Of,
  sqlBigInt,
  sqlBool,
  sqlLiteral,
  sqlText,
  sqlTimestamp,
  sqlUuid,
  verifiedEventArgs,
};
