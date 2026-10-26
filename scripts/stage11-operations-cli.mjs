// Stage 11 / operations admin — the trusted operations instrument.
//
// What this process is. Stage 11 put thirteen operator doors on the `api` surface and left three acts with
// no door at all, and the split is the security design rather than an oversight (`docs/architecture/
// operations-admin-security.md` §10, §11). This file is the operator's hands on both halves: it signs in as
// a named human and calls the doors with *that human's* token, and it opens the peer-authenticated console
// session for the three acts that must not be reachable from any request.
//
//   * **Acting as an operator** (`case-*`, `privacy-*`, `takedown*`, `commerce-*`, `health`): a GoTrue
//     password grant over loopback, then `POST /rest/v1/rpc/<name>` with `Content-Profile: api` and the
//     resulting access token. The tool holds no privilege of its own — every authorisation is the database's
//     decision read from `private.operator_grants` through `auth.uid()`, which is why the batteries that
//     grant a hostile caller nothing also grant this tool nothing, and why a revoked or lapsed grant stops
//     this run mid-sentence. **No service-role key is read into this process, put in its environment,
//     printed by it, or left in a captured artefact**, and that is structural, not a habit: `readEnvFile`
//     is handed the two names it may read (`SUPABASE_LOCAL_URL`, `SUPABASE_LOCAL_PUBLISHABLE_KEY`) and so
//     the third line of `.env.local` never becomes a value here.
//   * **Granting authority, and planning the purge** (`grant`, `revoke`, `purge`): `psql` inside the local
//     stack's own database container, as `postgres`, authenticated by the socket rather than by a secret —
//     the channel `scripts/tradition-pack-admin.mjs` already uses for the same reason. Granting cannot
//     depend on already having a grant, and `internal_api.operator_purge_publication_objects` has no HTTP
//     surface by §10's choice, so the console is not a convenience here; it is the only correct place.
//
// What this file is not, stated because each would be easy to mistake it for. It is **not a host**: none of
// the six intake doors (`api.open_support_case`, `api.reply_to_support_case`, `api.get_my_support_case(s)`,
// `api.create_privacy_request`, `api.get_my_privacy_requests`) is callable from here, because they read
// `auth.uid()` to mean *the person whose ticket this is*, and an operator's session would answer the host's
// question about the wrong person. It is **not a deleter**: `purge` runs the plan body, which deletes
// nothing and returns the `object_key` list, and the byte removal lives in the trusted publisher, where the
// storage credential already is (§6, §10). It is **not a dashboard**: `health` prints the projection's own
// answer and adds the one figure a projection cannot hold — the count of migration files on disk — because
// §9 makes the file-versus-database comparison this tool's job.
//
// The rules each step exists to enforce:
//
//   * **Nothing happens until the operator says so.** `--dry-run` is the default for every mutating verb,
//     `--yes` is what makes it write, `--yes --dry-run` is a contradiction and is refused, and a plan prints
//     the exact statement or the exact named call it will make. `grant`/`revoke` print SQL, because the
//     argument order of a statement that hands somebody authority is the thing a reviewer should see.
//   * **A key is minted, not remembered.** Every idempotency-taking verb generates one unless `--key` names
//     it, and prints the `audit_id` and `replayed` the body returns, so a run is answerable afterwards. The
//     purge's second, distinct key is not this tool's memory either: the body compares it against the
//     recorded takedown's and refuses a single uuid buying both halves.
//   * **A closed word is checked against the shipped sentence.** Every vocabulary below was read out of the
//     six Stage 11 migrations and is re-pinned against them by `scripts/stage11-operations-cli.test.mjs` on
//     every run, so a body that gains a fifth takedown reason moves the tool or fails the test — never both
//     quietly. The tool's check is a pre-flight courtesy; the body remains the authority.
//   * **A credential is named by an environment variable, never passed.** `--secret-env NAME` and
//     `--account-env NAME` are the only way in for the operator's password and address; the banned-flag list
//     turns a mistake into a sentence instead of a silently missing secret, and there is no `--url`, no
//     `--api-origin` and no `--db-url-env` here either, because a flag that names a server is a flag that can
//     name a hosted one and §11's ban is not satisfied by a different spelling of the same option. The target
//     is `.env.local`'s loopback URL or the run refuses.
//   * **Injection is impossible rather than unlikely.** Every console value is one standard literal with its
//     quotes doubled and an explicit `::type` cast, or a cast NULL; every call uses named notation so a
//     swapped pair of facts is caught by the shape rather than written into a column nothing re-reads; and
//     `ensureSafeEncoding` asserts `standard_conforming_strings = on` before the first literal leaves,
//     because the doubling rule only holds under it. The same discipline as
//     `scripts/tradition-pack-admin.mjs` and `scripts/stage10-commerce-driver.mjs`, re-declared here rather
//     than imported for the reason Stage 10 recorded: an operations tool must not stop working because a
//     rendering tool's module graph moved.
//   * **Nothing this run prints carries a secret.** Three values (`password`, `access_token`,
//     `refresh_token`) are refused outright if a line would carry them, by slot name rather than by value, so
//     the refusal itself is safe to read; two more (the publishable key, the operator's own address) are
//     softened by the redactor, which has no length floor here because this tool holds exactly four named
//     values and knows all of them, unlike a publisher scanning an argv. A third copy of that redaction rule
//     exists in the tree (`scripts/stage9-output-publisher.mjs:375`); sharing one module across three tools is
//     out-of-stage work, and the unit cells below pin the copies to identical behaviour rather than to a
//     comment saying they match.
//   * **A database answer is delivered as one line, and its SQLSTATE with it.** The console channel wraps its
//     call in a `DO … EXCEPTION WHEN OTHERS` block that files `SQLSTATE` and `SQLERRM` into a temp table in
//     this session's own format, so a refusal arrives as a fact this file parses instead of as an accident in
//     whatever `psql` writes to stderr — a spawn that could not run is code 1, a row the database refused is
//     code 2, and the two are never confused.
//
// Usage:
//   node scripts/stage11-operations-cli.mjs case-queue --status open --limit 20 \
//     --account-env S11_OPERATOR_EMAIL --secret-env S11_OPERATOR_PASSWORD
//   node scripts/stage11-operations-cli.mjs case-transition --case SV-XXXXXXXX --to resolved \
//     --resolution resolved_by_operator --body 'reproduced and fixed' \
//     --account-env … --secret-env …            # add --yes to write
//   node scripts/stage11-operations-cli.mjs grant --user <uuid> --scope operations --reason '…' \
//     --actor <uuid> --expires 2026-12-31T00:00:00Z --via-docker supabase_db_localvivaahvarnam --yes
//   node scripts/stage11-operations-cli.mjs purge --case SV-XXXXXXXX --actor <uuid> \
//     --via-docker supabase_db_localvivaahvarnam --yes
//   node scripts/stage11-operations-cli.mjs health --window 72 --account-env … --secret-env …
//
// Exit codes, the convention §11 states: 0 the run answered (including a plan that deliberately wrote
// nothing); 2 a refusal that is itself the designed answer — a denial, a held state, a closed-vocabulary
// word, a banned flag, a target that is not loopback; 1 an instrument or transport failure — the process
// could not be run, the stack did not answer, the answer was not the shape this file expects, or a
// `PGRST202` that means the door is not on this database at all.

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESIGNED_REFUSAL = 2;
const INSTRUMENT_FAILURE = 1;

class Refusal extends Error {
  constructor(message, code = DESIGNED_REFUSAL) {
    super(message);
    this.exitCode = code;
  }
}

// ------------------------------------------------------------------ the words the database accepts
// Every list below is copied out of a shipped body's own `… NOT IN (…)` guard and is re-pinned against that
// body's text by the unit battery. They are not a design document's vocabulary.
export const VOCAB = Object.freeze({
  caseStatus: Object.freeze(['open', 'triaged', 'awaiting_information', 'in_progress', 'resolved', 'closed']),
  caseCategory: Object.freeze(['invitation_access', 'publication_delivery', 'guest_rsvp', 'render_output',
    'billing_refund_inquiry', 'privacy_data_request', 'other']),
  caseNoteKind: Object.freeze(['message_host', 'message_operator']),
  resolutionCode: Object.freeze(['resolved_by_operator', 'host_withdrew', 'no_action_needed', 'duplicate',
    'out_of_scope', 'event_cancelled']),
  privacyStatus: Object.freeze(['received', 'identity_verification_requested', 'queued_for_stage13',
    'satisfied_outside_this_build', 'declined']),
  takedownReason: Object.freeze(['owner_request', 'terms_violation', 'safety', 'legal', 'duplicate']),
  reviewNoteKind: Object.freeze(['evidence_requested', 'in_review', 'escalated_to_owner',
    'documented_outcome']),
  refundStatus: Object.freeze(['recorded', 'succeeded', 'failed', 'reversed']),
  operatorScope: Object.freeze(['support', 'operations', 'finance_review', 'privacy']),
});

// The refs are minted by triggers (`private.mint_support_case_ref`, `…_privacy_request_ref`) from 40 bits
// into eight characters of the RFC 4648 base32 alphabet; a caller cannot choose one, which is the whole
// reason a takedown can trust the string it names its authorisation by.
const CASE_REF = /^SV-[A-Z2-7]{8}$/;
const REQUEST_REF = /^PR-[A-Z2-7]{8}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

// ------------------------------------------------------------------ the verbs
// One entry per callable the tool is allowed to reach. `channel` is the security split; `fn` is the shipped
// name; `args` is the shipped parameter list in the shipped order, each row naming the option that fills it.
// The battery asserts that these names and parameters are exactly what the migrations declare, so an added
// door with no verb here — or a renamed parameter, which PostgREST would answer by *not binding* — fails a
// test rather than surprising an operator at 2 a.m.
export const VERBS = Object.freeze({
  'case-queue': {
    channel: 'http', fn: 'operator_case_queue', mutating: false,
    args: [
      { param: 'p_status', opt: 'status', kind: 'word', vocab: 'caseStatus' },
      { param: 'p_category', opt: 'category', kind: 'word', vocab: 'caseCategory' },
      { param: 'p_limit', opt: 'limit', kind: 'limit', bound: 100 },
    ],
  },
  'case-get': {
    channel: 'http', fn: 'get_operator_case', mutating: false,
    args: [{ param: 'p_case_ref', opt: 'case', kind: 'caseRef', required: true }],
  },
  'case-note': {
    channel: 'http', fn: 'operator_add_case_note', mutating: true,
    args: [
      { param: 'p_case_ref', opt: 'case', kind: 'caseRef', required: true },
      { param: 'p_kind', opt: 'kind', kind: 'word', vocab: 'caseNoteKind', required: true },
      { param: 'p_body', opt: 'body', kind: 'text', required: true },
      { param: 'p_idempotency_key', opt: 'key', kind: 'key' },
    ],
  },
  'case-claim': {
    channel: 'http', fn: 'operator_claim_case', mutating: true,
    args: [
      { param: 'p_case_ref', opt: 'case', kind: 'caseRef', required: true },
      { param: 'p_idempotency_key', opt: 'key', kind: 'key' },
    ],
  },
  'case-release': {
    channel: 'http', fn: 'operator_release_case', mutating: true,
    args: [
      { param: 'p_case_ref', opt: 'case', kind: 'caseRef', required: true },
      { param: 'p_idempotency_key', opt: 'key', kind: 'key' },
    ],
  },
  'case-transition': {
    channel: 'http', fn: 'operator_transition_case', mutating: true,
    args: [
      { param: 'p_case_ref', opt: 'case', kind: 'caseRef', required: true },
      { param: 'p_to_status', opt: 'to', kind: 'word', vocab: 'caseStatus', required: true },
      { param: 'p_resolution_code', opt: 'resolution', kind: 'word', vocab: 'resolutionCode' },
      { param: 'p_body', opt: 'body', kind: 'text' },
      { param: 'p_idempotency_key', opt: 'key', kind: 'key' },
    ],
  },
  'privacy-queue': {
    channel: 'http', fn: 'operator_privacy_queue', mutating: false,
    args: [{ param: 'p_status', opt: 'status', kind: 'word', vocab: 'privacyStatus' }],
  },
  'privacy-advance': {
    channel: 'http', fn: 'operator_advance_privacy_request', mutating: true,
    args: [
      { param: 'p_request_ref', opt: 'request', kind: 'requestRef', required: true },
      { param: 'p_status', opt: 'status', kind: 'word', vocab: 'privacyStatus', required: true },
      { param: 'p_note', opt: 'note', kind: 'text' },
      { param: 'p_idempotency_key', opt: 'key', kind: 'key' },
    ],
  },
  'takedown-plan': {
    channel: 'http', fn: 'operator_takedown_plan', mutating: false,
    args: [{ param: 'p_wedding_id', opt: 'wedding', kind: 'uuid', required: true }],
  },
  'takedown': {
    channel: 'http', fn: 'operator_takedown_publication', mutating: true,
    args: [
      { param: 'p_wedding_id', opt: 'wedding', kind: 'uuid', required: true },
      { param: 'p_case_ref', opt: 'case', kind: 'caseRef', required: true },
      { param: 'p_reason', opt: 'reason', kind: 'word', vocab: 'takedownReason', required: true },
      { param: 'p_idempotency_key', opt: 'key', kind: 'key' },
    ],
  },
  'commerce-queue': {
    channel: 'http', fn: 'operator_commerce_review_queue', mutating: false,
    args: [
      { param: 'p_status', opt: 'status', kind: 'word', vocab: 'refundStatus' },
      { param: 'p_limit', opt: 'limit', kind: 'limit', bound: 200 },
    ],
  },
  'commerce-note': {
    channel: 'http', fn: 'operator_add_commerce_review_note', mutating: true,
    args: [
      { param: 'p_refund_id', opt: 'refund', kind: 'uuid', required: true },
      { param: 'p_case_ref', opt: 'case', kind: 'caseRef', required: true },
      { param: 'p_kind', opt: 'kind', kind: 'word', vocab: 'reviewNoteKind', required: true },
      { param: 'p_note', opt: 'note', kind: 'text', required: true },
      { param: 'p_idempotency_key', opt: 'key', kind: 'key' },
    ],
  },
  'health': {
    channel: 'http', fn: 'operator_operations_summary', mutating: false,
    args: [{ param: 'p_window_hours', opt: 'window', kind: 'window' }],
  },
  'grant': {
    channel: 'psql', fn: 'grant_operator_role', mutating: true,
    args: [
      { param: 'p_user_id', opt: 'user', kind: 'uuid', required: true },
      { param: 'p_scope', opt: 'scope', kind: 'word', vocab: 'operatorScope', required: true },
      { param: 'p_reason', opt: 'reason', kind: 'reasonText', required: true },
      { param: 'p_actor_user_id', opt: 'actor', kind: 'uuid', required: true },
      { param: 'p_expires_at', opt: 'expires', kind: 'expires' },
    ],
  },
  'revoke': {
    channel: 'psql', fn: 'revoke_operator_role', mutating: true,
    args: [
      { param: 'p_user_id', opt: 'user', kind: 'uuid', required: true },
      { param: 'p_scope', opt: 'scope', kind: 'word', vocab: 'operatorScope', required: true },
      { param: 'p_reason', opt: 'reason', kind: 'reasonText', required: true },
      { param: 'p_actor_user_id', opt: 'actor', kind: 'uuid', required: true },
    ],
  },
  'purge': {
    channel: 'psql', fn: 'operator_purge_publication_objects', mutating: true,
    args: [
      { param: 'p_case_ref', opt: 'case', kind: 'caseRef', required: true },
      { param: 'p_actor_user_id', opt: 'actor', kind: 'uuid', required: true },
      { param: 'p_idempotency_key', opt: 'key', kind: 'key' },
    ],
  },
});

// The six intake doors, named so the battery can assert this tool holds none of them rather than asserting
// the absence of a string nobody looked for.
export const HOST_INTAKE_DOORS = Object.freeze(['open_support_case', 'get_my_support_cases', 'get_my_support_case',
  'reply_to_support_case', 'create_privacy_request', 'get_my_privacy_requests']);

// A secret, a key, a price, a server or an address is never an argument. argv survives in shell history, in
// `ps` output and in whatever log prints the command line, and an amount or a URL typed here would be an
// amount the database was told to charge or a server this run chose to contact.
export const FORBIDDEN_FLAGS = Object.freeze(['service-key', 'token', 'price', 'sql', 'url', 'email',
  'account', 'secret', 'password', 'apikey', 'anon-key', 'anonkey', 'publishable-key', 'amount', 'db-url',
  'api-origin', 'origin', 'host', 'webhook-secret']);

const BOOLEAN_FLAGS = new Set(['yes', 'dry-run', 'help']);

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const USAGE = `usage: node scripts/stage11-operations-cli.mjs <verb> [options]

  operator channel (needs --account-env NAME --secret-env NAME, both naming environment variables):
    case-queue      --status --category --limit
    case-get        --case
    case-note       --case --kind --body            [--key]
    case-claim      --case                          [--key]
    case-release    --case                          [--key]
    case-transition --case --to [--resolution] [--body]   [--key]
    privacy-queue   --status
    privacy-advance --request --status [--note]     [--key]
    takedown-plan   --wedding
    takedown        --wedding --case --reason       [--key]
    commerce-queue  --status --limit
    commerce-note   --refund --case --kind --note   [--key]
    health          [--window]

  console channel (needs --via-docker supabase_db_<project>; no password, no key):
    grant           --user --scope --reason --actor [--expires]
    revoke          --user --scope --reason --actor
    purge           --case --actor                  [--key]

  every verb writes nothing unless --yes is present; --yes is refused together with --dry-run.
  there is no --email, --token, --service-key, --url, --api-origin, --price or --sql: see the header.
  the API target is SUPABASE_LOCAL_URL in .env.local and must be a loopback address.`;

// ------------------------------------------------------------------ literals and named calls
// `sqlLiteral`'s doubling rule is only a rule under `standard_conforming_strings = on`; `ensureSafeEncoding`
// asks the session before the first literal is sent, because that answer is a property of the session and
// not of the statement.

/** One standard string literal, quotes doubled. Throws on a NUL, which `psql` would silently truncate. */
function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  const text = String(value);
  if (text.includes('\u0000')) throw new Refusal('refused: a value contains a NUL byte.');
  return `'${text.replaceAll("'", "''")}'`;
}

const sqlText = (value) => (value === null || value === undefined ? 'NULL::text'
  : `${sqlLiteral(value)}::text`);

function sqlUuid(value, label) {
  if (!UUID.test(String(value ?? ''))) {
    throw new Refusal(`refused: the ${label} is not a uuid, so it has no business in a uuid position.`);
  }
  return `${sqlLiteral(String(value).toLowerCase())}::uuid`;
}

const sqlInteger = (value) => `${Math.trunc(Number(value))}::integer`;

const sqlTimestamp = (value) => (value === null || value === undefined ? 'NULL::timestamptz'
  : `${sqlLiteral(value)}::timestamptz`);

/** A jsonb answer leaves the console session base64-encoded, so this file's parsing is total rather than
 *  best-effort and no quote, newline or arrow in the database's own sentence reaches the terminal raw.
 *
 *  The `replace` is load-bearing, not tidiness. Postgres 17.11's base64 encoder is the multi-line MIME
 *  variant of RFC 2045: measured on the running stack, `encode(convert_to(…,'utf8'),'base64')` of a
 *  908-byte value came back 1,227 characters long with 15 newlines, the first at position 77, no trailing
 *  newline and no line longer than 76. `psql` prints such a value verbatim in unaligned mode — a 20,000
 *  character single-line value arrives as one line — so without this strip the console's answer is
 *  fourteen lines wide, this tool's one-line rule fails, and the act the `DO` block had *already committed*
 *  is reported as unread. That is exactly how a live run of `purge` and `revoke` behaved at 4ea2a97. */
const b64Out = (expr) => `replace(encode(convert_to((${expr})::text, 'utf8'), 'base64'), chr(10), '')`;

/** The one call form this tool renders: named notation, one argument per line, every value cast. Named
 *  notation is not decoration — it is what makes a swapped `p_user_id`/`p_actor_user_id` impossible rather
 *  than merely unlikely, and what lets the printed plan be read against the migration's own signature. */
function renderNamedCall(schema, fn, rendered) {
  return `${schema}.${fn}(\n  ${rendered.map((row) => `${row.name} => ${row.sql}`).join(',\n  ')}\n)`;
}

/** The statement the console channel actually sends. The call is wrapped, not bare: an unguarded
 *  `RAISE EXCEPTION` would leave this file guessing which line of `psql` stderr is the database's answer,
 *  and the guessing is how a constraint violation gets reported as a transport failure. */
function guardedStatement(call) {
  return [
    'CREATE TEMP TABLE s11cli_answer(payload text);',
    'DO $cli$ BEGIN',
    `  INSERT INTO pg_temp.s11cli_answer SELECT ${b64Out(call)};`,
    'EXCEPTION WHEN OTHERS THEN',
    "  INSERT INTO pg_temp.s11cli_answer VALUES ('ERR ' || SQLSTATE || ' ' || replace(SQLERRM, chr(10), ' '));",
    'END $cli$;',
    'SELECT payload FROM pg_temp.s11cli_answer;',
  ].join('\n');
}

// ------------------------------------------------------------------ the console channel

/** One `psql`, in-container, peer-authenticated: no password is in this process, its environment or argv. */
function runPsql(container, text) {
  const res = spawnSync('docker', ['exec', '-i', '-e', 'PGCLIENTENCODING=UTF8', container,
    'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-'],
  { input: text, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (res.error) {
    throw new Refusal(`refused: docker could not be run (${String(res.error.message).slice(0, 200)}). This `
      + 'tool has no second route to the database and does not try one, because an instrument that quietly '
      + 'falls back is how the wrong stack gets an operator grant.', INSTRUMENT_FAILURE);
  }
  if (res.status !== 0) {
    // First `ERROR:` line, because `psql` writes the sentence first and its CONTEXT/DETAIL frames after it;
    // `.pop()` returns the least informative line in the buffer (measured in Stage 10).
    const lines = `${res.stderr ?? ''}${res.stdout ?? ''}`.split('\n')
      .map((line) => line.trim()).filter((line) => line.length > 0);
    const seen = lines.find((line) => /^ERROR:/.test(line)) ?? lines[0] ?? 'the statement failed';
    throw afterSend(new Refusal(`refused: the console session ended at ${seen.slice(0, 300)}`,
      INSTRUMENT_FAILURE));
  }
  const out = String(res.stdout ?? '').split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  if (out.length !== 1) {
    throw afterSend(new Refusal(`refused: the console answered ${out.length} line(s) where this tool expects `
      + 'exactly one, so there is no answer to read.', INSTRUMENT_FAILURE));
  }
  return out[0];
}

/** Tags a refusal raised after `docker` had already run the statement. On this channel the write happens
 *  inside the `DO` block, which commits before the answer is read, so a failure to *read* is not evidence
 *  that nothing was written — and `executed: false` alone would send an operator off to repeat an act that
 *  may already be in the audit trail. Only the "docker could not be run" arm provably wrote nothing. */
function afterSend(error) {
  error.afterSend = true;
  return error;
}

function ensureSafeEncoding(session) {
  const value = String(session('SHOW standard_conforming_strings;') ?? '').trim();
  if (value !== 'on') {
    throw new Refusal('refused: standard_conforming_strings is not exactly `on`, so a backslash in a value '
      + 'could eat a quote. This tool sends no literal into that session.');
  }
  return value;
}

const DESIGNED_SQLSTATES = new Set(['42501', '23503', '23505', '23514', 'P0001', '22001', '22023']);

/** The console answer into a verdict: either the body's jsonb, or its SQLSTATE and its sentence. */
function parseConsoleAnswer(line) {
  if (line.startsWith('ERR ')) {
    const [, sqlstate, ...rest] = line.split(' ');
    return {
      refused: true,
      sqlstate,
      message: rest.join(' ').trim(),
      exit: DESIGNED_SQLSTATES.has(sqlstate) ? DESIGNED_REFUSAL : INSTRUMENT_FAILURE,
    };
  }
  try {
    return { refused: false, value: JSON.parse(Buffer.from(line, 'base64').toString('utf8')) };
  } catch {
    throw afterSend(new Refusal('refused: the console answered with something that is not the JSON it was '
      + 'asked to build, so this run cannot trust what it read.', INSTRUMENT_FAILURE));
  }
}

// ------------------------------------------------------------------ the operator channel

function assertLoopback(origin, label) {
  let host;
  try {
    host = new URL(String(origin)).hostname;
  } catch {
    throw new Refusal(`refused: ${label} is ${JSON.stringify(String(origin).slice(0, 120))}, which does not `
      + 'parse as a URL, so there is no server to address.');
  }
  if (/supabase\.co|supabase\.io/i.test(String(origin))) {
    throw new Refusal(`refused: ${label} names a hosted project. This instrument writes only to the local `
      + 'stack, and a hosted target is not the local stack under another address.');
  }
  if (!LOOPBACK.has(host)) {
    throw new Refusal(`refused: ${label} has host ${host}. Only a loopback address is the local stack.`);
  }
  return String(origin);
}

/** The two lines this tool may read out of `.env.local`, and no others. The allowlist is the point: the
 *  file on a real machine also carries the service-role key, and a reader that took the whole file into a
 *  object would put that credential in this process's memory for a value it never uses. */
export function readEnvFile(text, allowedKeys) {
  const wanted = new Set(allowedKeys);
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    if (!wanted.has(key)) continue;
    out[key] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
}

const readText = (file) => readFileSync(file, 'utf8');

/** GoTrue's password grant. On failure this prints the status and a fixed sentence and nothing else: a
 *  token endpoint's error body is not ours to forward, and its success body is the thing the printer is
 *  built to keep out of a line. */
async function signIn({ apiOrigin, publishableKey, email, password, fetchImpl }) {
  let res;
  try {
    res = await fetchImpl(`${apiOrigin}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    throw new Refusal(`refused: the sign-in request could not be made (${String(error?.message ?? error)
      .slice(0, 200)}).`, INSTRUMENT_FAILURE);
  }
  if (!res.ok) {
    throw new Refusal(`the auth service refused this operator's credentials (HTTP ${res.status}). Nothing `
      + 'was read from its body, and no call was made.', DESIGNED_REFUSAL);
  }
  let session;
  try {
    session = JSON.parse(await res.text());
  } catch {
    throw new Refusal('refused: the auth service answered 2xx with something that is not a session document.',
      INSTRUMENT_FAILURE);
  }
  if (typeof session.access_token !== 'string' || session.access_token === '') {
    throw new Refusal('refused: the session document carries no access token, so there is nothing to call '
      + 'the doors with.', INSTRUMENT_FAILURE);
  }
  return session;
}

async function callRpc({ apiOrigin, publishableKey, accessToken, fn, params, fetchImpl }) {
  let res;
  try {
    res = await fetchImpl(`${apiOrigin}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'api',
      },
      body: JSON.stringify(params),
    });
  } catch (error) {
    throw new Refusal(`refused: the request to /rest/v1/rpc/${fn} could not be made `
      + `(${String(error?.message ?? error).slice(0, 200)}).`, INSTRUMENT_FAILURE);
  }
  const text = await res.text();
  if (res.status >= 400) {
    return { refused: true, status: res.status, body: safeJson(text) };
  }
  const value = safeJson(text);
  if (value === null) {
    throw new Refusal(`refused: /rest/v1/rpc/${fn} answered HTTP ${res.status} with a body this tool cannot `
      + 'read as jsonb.', INSTRUMENT_FAILURE);
  }
  return { refused: false, status: res.status, value };
}

const safeJson = (text) => {
  const s = String(text ?? '');
  if (s === '') return null;
  try {
    return JSON.parse(s);
  } catch {
    return { unparsed: s.slice(0, 200) };
  }
};

/** PostgREST carries the database's own SQLSTATE in `code`, which is the only reliable way to tell a
 *  designed refusal from an accident: both arrive as 4xx, and the operator needs to know whether the
 *  sentence was written for them or about them. A missing door is an accident about the tree — it means
 *  the migration this tool was written against is not the database it is talking to. */
export function classifyHttp({ status, body }) {
  const code = typeof body?.code === 'string' ? body.code : '';
  if (code === 'PGRST202' || (status === 404 && code === '')) {
    const sentence = String(body?.message ?? '').slice(0, 200);
    return { exit: INSTRUMENT_FAILURE, kind: 'missing_door', code,
      message: `HTTP ${status} ${code || '(no code)'}: ${sentence}. The door this verb calls is not on this `
        + 'database, which means the migration that created it has not been applied here — a plan that ran '
        + 'against a repository is not a run that touched a stack.' };
  }
  if (DESIGNED_SQLSTATES.has(code)) {
    return { exit: DESIGNED_REFUSAL, kind: 'refused_by_the_database', code,
      message: `HTTP ${status} ${code}: ${String(body?.message ?? '(the database gave no sentence)')}` };
  }
  if (status === 401 || status === 403) {
    return { exit: DESIGNED_REFUSAL, kind: 'refused_at_the_door', code,
      message: `HTTP ${status} ${code || '(no code)'}: ${String(body?.message ?? 'no credential this run '
        + 'supplied was accepted')}` };
  }
  return { exit: INSTRUMENT_FAILURE, kind: 'transport_or_unexpected', code,
    message: `HTTP ${status} ${code || '(no code)'}: ${String(body?.message ?? JSON.stringify(body)
      ?? '').slice(0, 300)}` };
}

// ------------------------------------------------------------------ the migration census (§9)

/** The figures `api.operator_operations_summary` cannot hold: a file listing is not a database fact, so the
 *  projection names the CLI as the half that reads `supabase/migrations/` and prints the pair side by side.
 *  A name that does not start with the fourteen-digit version is reported, never dropped, because a census
 *  that quietly skips a file is how a pending migration stops being visible. */
const MIGRATION_FILE = /^\d{14}(?=_.+\.sql$)/;

export function readMigrationCensus(dir = resolve('supabase/migrations')) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (error) {
    return { read: false, dir, reason: String(error?.message ?? error).slice(0, 200) };
  }
  const sql = names.filter((n) => n.endsWith('.sql'));
  const versions = sql.map((n) => MIGRATION_FILE.exec(n)?.[0]).filter(Boolean);
  return {
    read: true,
    dir,
    files: sql.length,
    highest: versions.length ? versions.sort().at(-1) : null,
    unversioned: sql.length - versions.length,
  };
}

// ------------------------------------------------------------------ argv

export function parseArgs(argv) {
  const parsed = { _: [], given: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i]);
    if (!token.startsWith('--')) {
      parsed._.push(token);
      continue;
    }
    const name = token.slice(2);
    if (name.includes('=')) {
      const [key, value] = name.split(/=(.*)/s, 2);
      parsed.given.push(key);
      parsed[key] = value;
      continue;
    }
    parsed.given.push(name);
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

/** Everything the operator named, before a single value is used. Strict in both directions: a flag on the
 *  banned list gets its own sentence, and an unknown flag is refused rather than ignored, because a typo in
 *  `--reasn` would otherwise be a grant with no reason and a body that refuses it is a round trip the
 *  operator did not need to make. */
export function readOptions(args) {
  for (const flag of FORBIDDEN_FLAGS) {
    if (args[flag] !== undefined) {
      throw new Refusal(`refused: --${flag} is not an option this tool has. A credential is named by an `
        + 'environment variable (--secret-env NAME, --account-env NAME), the API target comes from '
        + '.env.local, an amount is decided by the database and a SQL statement is built one cast literal '
        + 'at a time here — never typed in.');
    }
  }
  if (args._.length === 0) throw new Refusal('refused: no verb. ' + USAGE.split('\n')[0]);
  if (args._.length > 1) {
    throw new Refusal(`refused: one verb per run, and this command line carried ${args._.length} `
      + `positional words (${args._.slice(0, 3).join(' ')}).`);
  }
  const verb = args._[0];
  if (!Object.hasOwn(VERBS, verb)) {
    throw new Refusal(`refused: ${verb} is not a verb this tool has. The sixteen are: `
      + `${Object.keys(VERBS).sort().join(', ')}.`);
  }
  const spec = VERBS[verb];
  for (const name of args.given) {
    const known = name === 'yes' || name === 'dry-run' || name === 'help' || name === 'account-env'
      || name === 'secret-env' || name === 'via-docker' || spec.args.some((a) => a.opt === name);
    if (!known) {
      throw new Refusal(`refused: --${name} means nothing to ${verb}. Its options are `
        + `${spec.args.map((a) => `--${a.opt}`).join(' ')} plus --yes, --dry-run, --key where the verb takes one.`);
    }
  }
  if (args['yes'] === true && args['dry-run'] === true) {
    throw new Refusal('refused: --yes and --dry-run in one command is a run that both writes and does not. '
      + 'Read the plan first, then run it again with --yes.');
  }
  return { verb, spec, args };
}

/** A value the operator typed, described without being repeated.
 *
 *  The printer that stands between this run and a log line is armed with a credential only after
 *  `readOperatorCredentials` returns, so a refusal built from raw argv is printed by a process that cannot
 *  yet tell which of those bytes is the secret. That is not a corner case: the two flags these sentences
 *  guard are the ones whose whole job is to *name* a secret, so the mistake they exist to catch is the
 *  operator typing the password itself where its name belongs — and a refusal that quotes the value back
 *  would write the credential into the same stdout stream, and the same captured artefact, the run was
 *  refusing to protect. Length and first character are what separate a variable name from a value, so the
 *  diagnosis survives and the bytes do not. */
function shapeOfValue(value) {
  const text = String(value);
  if (text === '') return 'nothing at all';
  const first = text.slice(0, 1);
  const kind = /^[A-Z]$/.test(first) ? 'an uppercase letter'
    : /^[a-z]$/.test(first) ? 'a lowercase letter'
      : /^[0-9]$/.test(first) ? 'a digit' : 'a character that is neither a letter nor a digit';
  return `${text.length} character(s) beginning with ${kind}`;
}

/** The same rule for the container slot, keeping the two facts that make the mistake fixable — whether the
 *  value is even the right shape of answer, and whether a dot has dragged a hostname in, which is §11's
 *  prohibition on this channel. A container name is not a credential, but the operator cannot be trusted to
 *  have typed the right kind of value into a slot that accepts any string, and this sentence has no way to
 *  know which one they meant. */
function describeContainerName(text) {
  const parts = [text.startsWith('supabase_db_')
    ? 'a value that begins with supabase_db_'
    : `a value that does not begin with supabase_db_ (${shapeOfValue(text)})`];
  if (text.includes('.')) parts.push('it contains a dot, which is how a hostname arrives here');
  if (text !== '' && !/^[\w.-]+$/.test(text)) {
    parts.push('it carries a character outside letters, digits, underscore, hyphen and dot');
  }
  return parts.join(', ');
}

const readEnvName = (value, flag) => {
  // The absent flag gets its own sentence because the other one tells the operator to look at a value they
  // never typed, and a run that refuses a grant over a misplaced pointer wastes the round trip it is refusing
  // to cause. `parseArgs` leaves an absent flag `undefined` and gives a bare one `true`, so these two arms
  // really are different command lines rather than two spellings of one.
  if (value === undefined) {
    throw new Refusal(`refused: --${flag} is not on this command line at all, and there is no default for `
      + 'it. Add the name of the environment variable that holds the value.');
  }
  if (typeof value !== 'string' || value === '') {
    throw new Refusal(`refused: --${flag} was given with no environment variable name after it.`);
  }
  if (!ENV_NAME.test(value)) {
    throw new Refusal(`refused: --${flag} wants the NAME of an environment variable (an uppercase `
      + `identifier such as S11_OPERATOR_PASSWORD), and got ${shapeOfValue(value)}. The `
      + 'value itself never belongs on a command line.');
  }
  return value;
};

/** The operator channel's two values, read from the variables the command line *names*. This happens
 *  before anything is planned, for one reason: the printer that stands between this run and a log line has
 *  to already know the password it is guarding, and a run that discovered the credential while printing its
 *  own refusal would be printing the refusal unguarded. */
export function readOperatorCredentials(args, env) {
  const accountEnv = readEnvName(args['account-env'], 'account-env');
  const secretEnv = readEnvName(args['secret-env'], 'secret-env');
  if (accountEnv === secretEnv) {
    throw new Refusal('refused: --account-env and --secret-env name the same variable, so the address and '
      + 'the password would be one value. Two variables, two purposes.');
  }
  const read = (name, label) => {
    const value = env[name];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Refusal(`refused: the ${label} is read from the environment variable ${name}, and that `
        + 'variable is unset or blank. This tool takes a credential from no other place and falls back to '
        + 'no other value.');
    }
    return value.trim();
  };
  return { accountEnv, secretEnv, account: read(accountEnv, "operator's own address"),
    password: read(secretEnv, "operator's own password") };
}

// ------------------------------------------------------------------ plan building

function coerce(specArg, options) {
  const { param, opt, kind, required } = specArg;
  const raw = options[opt];
  const absent = raw === undefined || raw === true || raw === '';
  if (absent && required) {
    throw new Refusal(`refused: ${opt} is required here — the body names the parameter ${param} and it has `
      + 'no value to fall back to.');
  }
  if (absent) {
    if (kind === 'key') return { name: param, js: randomUUID(), sql: `${sqlLiteral(randomUUID())}::uuid`,
      display: 'minted for this run' };
    return { name: param, js: null, sql: nullLiteral(specArg), display: null };
  }
  const value = String(raw);
  switch (kind) {
    case 'uuid':
      if (!UUID.test(value)) throw new Refusal(`refused: --${opt} is not a uuid, and ${param} is a uuid `
        + 'column; a truncated one would be refused by the database anyway, so this run says so first.');
      return { name: param, js: value.toLowerCase(), sql: sqlUuid(value, opt), display: value.toLowerCase() };
    case 'key': {
      if (!UUID.test(value)) {
        throw new Refusal(`refused: --key must be a uuid, because ${param} is one, and an idempotency key `
          + 'that is not a uuid is a sentence the ledger cannot dedupe on.');
      }
      return { name: param, js: value.toLowerCase(), sql: sqlUuid(value, opt), display: value.toLowerCase() };
    }
    case 'caseRef':
      if (!CASE_REF.test(value)) {
        throw new Refusal(`refused: --${opt} is not a case ref of the shape the trigger mints `
          + '(SV- plus eight characters A-Z or 2-7). A ref is minted, never typed from memory.');
      }
      return { name: param, js: value, sql: sqlText(value), display: value };
    case 'requestRef':
      if (!REQUEST_REF.test(value)) {
        throw new Refusal(`refused: --${opt} is not a privacy request ref of the shape the trigger mints `
          + '(PR- plus eight characters A-Z or 2-7).');
      }
      return { name: param, js: value, sql: sqlText(value), display: value };
    case 'word': {
      const list = VOCAB[specArg.vocab];
      if (!list.includes(value)) {
        // Measured, not assumed: the body's own unknown-scope sentence (`unknown operator scope %: the four
        // duties are …`, authority:429) is not this one's words, so this refusal claims only what it knows —
        // that its own check ran, and ran before anything was sent.
        throw new Refusal(`refused: ${JSON.stringify(value)} is not one of the ${list.length} ${specArg.vocab} `
          + `words this build ships (${list.join(', ')}). This check is the tool's own and it runs before `
          + 'anything is sent.');
      }
      return { name: param, js: value, sql: sqlText(value), display: value };
    }
    case 'text':
      if (value.trim() === '') throw new Refusal(`refused: --${opt} must be real text or absent.`);
      if (value.length > 4000) {
        throw new Refusal(`refused: --${opt} is ${value.length} characters and the column ceiling is 4000; `
          + 'this tool truncates nothing, because a note that lost its ending is a different note.');
      }
      return { name: param, js: value, sql: sqlText(value), display: `${value.length} chars` };
    case 'reasonText':
      if (value.trim() === '') {
        throw new Refusal('refused: a grant or revocation with a blank reason is refused by its own body — '
          + 'the person who gains or loses authority is entitled to read why.');
      }
      if (value.length > 500) {
        throw new Refusal(`refused: a reason of ${value.length} characters exceeds the body's own 500; make `
          + 'it say the thing, not the ticket.');
      }
      return { name: param, js: value, sql: sqlText(value), display: value };
    case 'limit': {
      const n = parseInteger(value, opt);
      if (n < 1 || n > specArg.bound) {
        throw new Refusal(`refused: --limit for this queue is between 1 and ${specArg.bound}, not ${n}. `
          + 'A limit a caller can raise to a million is a way to read a ledger through a support tool.');
      }
      return { name: param, js: n, sql: sqlInteger(n), display: n };
    }
    case 'window': {
      const n = parseInteger(value, opt);
      if (n < 1 || n > 720) {
        throw new Refusal(`refused: --window is between 1 and 720 hours, not ${n}.`);
      }
      return { name: param, js: n, sql: sqlInteger(n), display: n };
    }
    case 'expires':
      if (!ISO_8601.test(value) || Number.isNaN(Date.parse(value))) {
        throw new Refusal(`refused: --expires must be an ISO 8601 timestamp with an offset, and `
          + `${JSON.stringify(value.slice(0, 40))} is not one. An expiry read differently by two machines is `
          + 'a grant that lives longer than the decision that made it.');
      }
      return { name: param, js: value, sql: sqlTimestamp(value), display: value };
    default:
      throw new Refusal(`refused: this build has no rule for a ${param} of kind ${kind}, so it will not `
        + 'invent one at the console.', INSTRUMENT_FAILURE);
  }
}

const nullLiteral = (specArg) => {
  switch (specArg.kind) {
    case 'uuid':
    case 'key': return 'NULL::uuid';
    case 'limit':
    case 'window': return 'NULL::integer';
    case 'expires': return 'NULL::timestamptz';
    default: return 'NULL::text';
  }
};

function parseInteger(value, opt) {
  if (!/^-?\d+$/.test(String(value))) {
    throw new Refusal(`refused: --${opt} must be a whole number, and ${JSON.stringify(String(value).slice(0, 20))} `
      + 'is not one.');
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Refusal(`refused: --${opt} is outside the integers this tool can state.`);
  return n;
}

/** The whole run decided before the first byte leaves: the channel, the call, the rendered statement. A
 *  refusal here is the cheap kind — nothing was sent, and the sentence is about the command line. The
 *  operator channel's credential pair arrives already read, because the printer was armed with it before
 *  this ran; `planCall` only checks that the channel and the credentials agree with each other. */
export function planCall({ verb, spec, args, credentials }) {
  const rendered = spec.args.map((a) => coerce(a, args));
  const params = Object.fromEntries(rendered.map((row) => [row.name, row.js]));
  const plan = {
    verb,
    channel: spec.channel,
    mutating: spec.mutating === true,
    fn: spec.fn,
    rendered,
    params,
  };
  if (spec.channel === 'psql') {
    plan.schema = 'internal_api';
    plan.call = renderNamedCall('internal_api', spec.fn, rendered);
    plan.statement = guardedStatement(plan.call);
  } else {
    plan.schema = 'api';
    plan.call = renderNamedCall('api', spec.fn, rendered);
  }
  plan.dryRun = args['dry-run'] === true || (plan.mutating && args.yes !== true);
  plan.writes = plan.mutating && !plan.dryRun;
  if (spec.channel === 'psql') {
    if (args['account-env'] !== undefined || args['secret-env'] !== undefined) {
      throw new Refusal(`refused: ${verb} runs on the trusted channel as the container's own postgres `
        + 'role, which is authenticated by the local socket, not by a token — so --account-env and '
        + '--secret-env have nothing to name here. A run that thinks it needs an operator password for a '
        + 'grant is a run that has confused the two channels.');
    }
    const container = args['via-docker'];
    if (container === undefined || container === true) {
      throw new Refusal(`refused: ${verb} reaches the database through the local stack's own container, and `
        + 'no --via-docker was given. There is no default on purpose, and no connection-string route here '
        + 'either: a URL in this process would be a credential in this process.');
    }
    const name = String(container);
    // Dots are outside the allowed class, so no value that passes this test can spell a hostname: the shape
    // rule is the hosted-target ban on this channel, and a second `supabase.co` test after it could never fire.
    if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(name)) {
      throw new Refusal(`refused: --via-docker wants the local stack's database container name `
        + `(supabase_db_<project>), and got ${describeContainerName(name)}.`);
    }
    plan.container = name;
  } else {
    if (args['via-docker'] !== undefined) {
      throw new Refusal(`refused: --via-docker means the trusted channel, and ${verb} is an operator door. `
        + 'The operator channel goes over HTTP with the operator\'s own sign-in; a container here would be '
        + 'a way to act without being one.');
    }
    if (credentials === undefined) {
      throw new Refusal(`refused: ${verb} is an operator door and this run was handed no credential pair. `
        + 'Nothing reaches the operator channel unsigned in.', INSTRUMENT_FAILURE);
    }
    plan.account = credentials.account;
    plan.password = credentials.password;
    plan.accountEnv = credentials.accountEnv;
    plan.secretEnv = credentials.secretEnv;
  }
  return plan;
}

// ------------------------------------------------------------------ printing

const REDACTED = '[redacted]';

export function makeRedactor(values = []) {
  const known = values.filter((v) => typeof v === 'string' && v !== '');
  return (value) => {
    let text = String(value);
    for (const secret of known) text = text.split(secret).join(REDACTED);
    return text;
  };
}

const CONNECTION_STRING = /postgres(?:ql)?:\/\/[^/\s]+:[^/\s]+@/i;

/** The last gate before bytes leave this process. `refuse` pairs are checked before redaction and by slot
 *  name, because a line that carries a bearer credential is not a line to soften and print — it is a line
 *  that must not exist, and the operator has to be told which slot leaked.
 *
 *  Both lists are read at print time, not at arm time. The bearer token does not exist until the sign-in
 *  returns, so a printer built with the token's slot empty would be guarding nothing for the only answer
 *  that ever carries it — and a gate that cannot fire is how a clean run record proves nothing. */
export function makePrinter({ write, refuse, soften } = {}) {
  const out = write ?? ((chunk) => process.stdout.write(chunk));
  const pairs = (value) => {
    const resolved = typeof value === 'function' ? value() : value;
    return Array.isArray(resolved) ? resolved : [];
  };
  const lines = [];
  const print = (value) => {
    const text = makeRedactor(pairs(soften).map(([, secret]) => secret))(String(value));
    for (const [slot, secret] of pairs(refuse)) {
      if (typeof secret === 'string' && secret !== '' && text.includes(secret)) {
        const error = new Refusal(`refused: the line this run was about to print carries ${slot}. The line `
          + 'is not shown here, because showing it is the leak.', INSTRUMENT_FAILURE);
        error.unprintable = true;
        throw error;
      }
    }
    if (CONNECTION_STRING.test(text)) {
      const error = new Refusal('refused: the line this run was about to print carries a connection string '
        + 'with a credential in it.', INSTRUMENT_FAILURE);
      error.unprintable = true;
      throw error;
    }
    lines.push(text);
    out(text.endsWith('\n') ? text : `${text}\n`);
    return text;
  };
  return { print, lines };
}

// ------------------------------------------------------------------ the audit facts every mutating verb owes

/** The two fields §11 promises an operator after a write: which audit row this act is, and whether the body
 *  answered a replay instead of doing it twice. Both come out of the body's own answer, and neither is
 *  invented here when the answer does not carry them — a tool that prints `audit_id: null` as though it had
 *  been given one is how a run stops being answerable. */
function auditFacts(answer) {
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) return {};
  const out = {};
  if (answer.audit_id !== undefined) out.audit_id = answer.audit_id;
  if (answer.replayed !== undefined) out.replayed = answer.replayed;
  return out;
}

// ------------------------------------------------------------------ the run

export async function runCli({
  argv = process.argv.slice(2),
  env = process.env,
  fileEnv,
  fetchImpl = globalThis.fetch,
  psql = runPsql,
  migrationsDir,
  write,
} = {}) {
  // Every value this run could leak, in one place, read by the printer at print time rather than armed once.
  const leaks = { account: '', password: '', publishableKey: '', accessToken: '', refreshToken: '' };
  const printer = makePrinter({
    write,
    refuse: () => [['the operator password from the variable it was named in', leaks.password],
      ['a bearer token', leaks.accessToken], ['a refresh token', leaks.refreshToken]],
    soften: () => [['the operator address', leaks.account], ['the publishable key', leaks.publishableKey]],
  });
  const args = parseArgs(argv);
  if (args.help === true || args._.length === 0) {
    printer.print(USAGE);
    return { exit: args._.length === 0 && args.help !== true ? DESIGNED_REFUSAL : 0, lines: printer.lines };
  }

  let plan;
  try {
    const options = readOptions(args);
    const credentials = options.spec.channel === 'http' ? readOperatorCredentials(args, env) : undefined;
    if (credentials !== undefined) {
      leaks.account = credentials.account;
      leaks.password = credentials.password;
    }
    plan = planCall({ ...options, credentials });
  } catch (error) {
    printer.print(`refused: ${firstSentence(error)}`);
    return { exit: exitOf(error), lines: printer.lines, refusal: messageOf(error) };
  }

  const record = {
    verb: plan.verb,
    channel: plan.channel,
    mutating: plan.mutating,
    executed: false,
    exit: INSTRUMENT_FAILURE,
  };

  try {
    if (plan.channel === 'psql' && plan.dryRun) {
      printer.print(`${plan.verb}: plan only (no --yes). This is the exact statement the session would run:`);
      printer.print(plan.statement);
      record.exit = 0;
      printer.print(`run record: ${JSON.stringify(record)}`);
      return { exit: 0, lines: printer.lines, record, plan };
    }
    if (plan.channel === 'http' && plan.dryRun) {
      printer.print(`${plan.verb}: plan only (no --yes). This is the exact call and body:`);
      printer.print(`POST /rest/v1/rpc/${plan.fn}  (Content-Profile: api)`);
      printer.print(JSON.stringify(plan.params));
      record.exit = 0;
      printer.print(`run record: ${JSON.stringify(record)}`);
      return { exit: 0, lines: printer.lines, record, plan };
    }

    let answer;
    if (plan.channel === 'psql') {
      const session = (statement) => psql(plan.container, statement);
      ensureSafeEncoding(session);
      const line = session(plan.statement);
      const parsed = parseConsoleAnswer(line);
      if (parsed.refused) {
        record.exit = parsed.exit;
        record.sqlstate = parsed.sqlstate;
        printer.print(`the database refused this ${plan.verb} (SQLSTATE ${parsed.sqlstate}): ${parsed.message}`);
        if (parsed.exit === INSTRUMENT_FAILURE) {
          printer.print('note: that SQLSTATE is not one of the refusals this build ships, so the run is '
            + 'reported as an instrument failure rather than as an answer.');
        }
        printer.print(`run record: ${JSON.stringify(record)}`);
        return { exit: parsed.exit, lines: printer.lines, record, refusal: parsed.message };
      }
      answer = parsed.value;
      record.executed = true;
      printer.print(`${plan.verb}: ${JSON.stringify(answer)}`);
    } else {
      const file = fileEnv ?? readEnvFile(readText(resolve('.env.local')),
        ['SUPABASE_LOCAL_URL', 'SUPABASE_LOCAL_PUBLISHABLE_KEY']);
      const apiOrigin = assertLoopback(file.SUPABASE_LOCAL_URL, 'SUPABASE_LOCAL_URL in .env.local');
      if (typeof file.SUPABASE_LOCAL_PUBLISHABLE_KEY !== 'string'
        || file.SUPABASE_LOCAL_PUBLISHABLE_KEY === '') {
        throw new Refusal('refused: .env.local carries no SUPABASE_LOCAL_PUBLISHABLE_KEY, so this run cannot '
          + 'address the local API.', INSTRUMENT_FAILURE);
      }
      leaks.publishableKey = file.SUPABASE_LOCAL_PUBLISHABLE_KEY;
      const transport = {
        apiOrigin,
        publishableKey: file.SUPABASE_LOCAL_PUBLISHABLE_KEY,
        email: plan.account,
        password: plan.password,
        fetchImpl,
      };
      const session = await signIn(transport);
      leaks.accessToken = session.access_token;
      if (typeof session.refresh_token === 'string') leaks.refreshToken = session.refresh_token;
      printer.print(`signed in as the account named by --account-env; calling ${plan.fn}.`);
      const result = await callRpc({ ...transport, accessToken: session.access_token, fn: plan.fn,
        params: plan.params });
      if (result.refused) {
        const verdict = classifyHttp({ status: result.status, body: result.body });
        record.exit = verdict.exit;
        record.code = verdict.code;
        printer.print(verdict.message);
        printer.print(`run record: ${JSON.stringify(record)}`);
        return { exit: verdict.exit, lines: printer.lines, record, refusal: verdict.message };
      }
      answer = result.value;
      record.executed = true;
      printer.print(`${plan.verb}: ${JSON.stringify(answer)}`);
      if (plan.verb === 'health') printer.print(describeCensus(answer, migrationsDir));
    }

    const facts = auditFacts(answer);
    for (const [key, value] of Object.entries(facts)) record[key] = value;
    // Reaching this line with a mutating plan means it wrote: `--yes` is what makes a mutating verb not a
    // dry run, and a dry run returned above, so there is no "but it did not write" arm left to print.
    if (plan.mutating) {
      printer.print(`this act is recorded as audit_id ${facts.audit_id ?? '(the answer named none)'}`
        + `${facts.replayed === true ? ' — the body answered a replay of this key, so it ran once' : ''}.`);
    }
    if (plan.verb === 'purge') {
      printer.print('nothing was deleted: the body you called plans, and the keys above are the list it '
        + 'returned. §10 puts the removal in the trusted publisher, which is where the storage credential is.');
    }
    record.exit = 0;
    printer.print(`run record: ${JSON.stringify(record)}`);
    return { exit: 0, lines: printer.lines, record, answer, plan };
  } catch (error) {
    if (error instanceof Refusal && error.unprintable === true) {
      // The refusal is itself unprintable by construction, so say the only safe thing about it.
      (write ?? ((c) => process.stdout.write(c)))('refused: this run\'s own explanation carried a '
        + 'credential, so nothing else was printed.\n');
      return { exit: INSTRUMENT_FAILURE, lines: printer.lines, refusal: 'unprintable explanation' };
    }
    record.exit = exitOf(error);
    if (error?.afterSend === true) {
      // The session had already run the statement, so `executed: false` must not be readable as "nothing
      // was written": on the console channel a write commits before the answer is ever looked at.
      record.answer_unreadable_after_send = true;
      printer.print('note: the statement was already sent when this run lost its answer, so this act may '
        + 'be written even though it cannot be confirmed here. Read the row back before sending it again; '
        + 'do not treat this line as a refusal that wrote nothing.');
    }
    try {
      printer.print(`refused: ${firstSentence(error)}`);
      printer.print(`run record: ${JSON.stringify(record)}`);
    } catch {
      (write ?? ((c) => process.stdout.write(c)))('refused: the failure could not be reported without a '
        + 'credential; nothing further was printed.\n');
    }
    return { exit: exitOf(error), lines: printer.lines, record, refusal: messageOf(error) };
  }
}

const exitOf = (error) => (error instanceof Refusal ? error.exitCode : INSTRUMENT_FAILURE);
const messageOf = (error) => String(error?.message ?? error ?? '(no message)');
const firstSentence = (error) => messageOf(error).replace(/^refused:\s*/, '');

/** The two migration figures side by side, or the honest sentence about the one that is missing. Written as
 *  a function of the answer rather than as a second read of the database, because the answer is the only
 *  thing this run is entitled to print about the stack. */
export function describeCensus(answer, migrationsDir) {
  const block = answer?.blocks?.migrations;
  const disk = readMigrationCensus(migrationsDir);
  const diskText = disk.read
    ? `${disk.files} file(s) on disk under ${disk.dir}, highest version ${disk.highest ?? '(none named with a '
      + '14-digit version)'}`
      + `${disk.unversioned > 0 ? `, ${disk.unversioned} of them not named with a 14-digit version` : ''}`
    : `the files under ${disk.dir} could not be read (${disk.reason}), so this run prints one figure `
      + 'rather than the pair';
  if (!block || block.status === 'not_measured') {
    return `migrations: ${diskText}; the database's own answer is not_measured — `
      + `${block?.reason ?? 'the projection named no reason'}. A count of files is not a count of applied `
      + 'migrations, and this run says so instead of implying the pair matched.';
  }
  const applied = `migrations: applied ${block.applied_count} (highest version `
    + `${block.highest_version ?? '(none)'})`;
  if (!disk.read) {
    return `${applied}, and ${diskText}. This run prints one figure and refuses to compare it to a number `
      + 'it does not have — "the counts agree" is not available from a directory that could not be read.';
  }
  const verdict = Number(block.applied_count) === disk.files
    ? 'The two figures are equal, which is the state the chain should be in.'
    : 'They differ, which is the difference between a migration in the repository and a migration on the '
      + 'stack — read supabase_migrations.schema_migrations for the versions, because this projection '
      + 'answers a count and a maximum, not a list.';
  return `${applied}, and ${diskText}. ${verdict}`;
}

const invokedDirectly = import.meta.url.startsWith('file:')
  && process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const result = await runCli();
  process.exitCode = result.exit;
}
