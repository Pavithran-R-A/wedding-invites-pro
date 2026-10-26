// S11-8: the trusted operations instrument, proved with no database, no container and no stack.
//
// `scripts/stage11-operations-cli.mjs` is the one process in this repository that may name an operator door.
// It signs in as a named human and calls thirteen `api.operator_*` functions with that human's token, and it
// opens the peer-authenticated console for the three acts §10 left with no door at all
// (`docs/architecture/operations-admin-security.md` §10, §11). Nothing in the product calls it, so these
// cases are not about convenience either — they are about the four ways an operations tool turns a typo or a
// compromised log into an irreversible act:
//
//   1. **it drifts away from the shipped schema.** A door added with no verb, a parameter renamed (which
//      PostgREST answers by *not binding*), a vocabulary that gains a fifth takedown reason: each of those is
//      a silent difference between the tool and the database, and the operator finds out at the worst moment.
//      OD-01..OD-10 parse the six Stage 11 migrations on every run and pin the tool's own tables to them.
//   2. **it writes before being told to.** `--dry-run` is the default for every mutating verb, the plan prints
//      the exact statement, and the actor of a grant is a required argument that is never defaulted.
//      OD-11..OD-18, including the injection case: a hostile `--reason` is one escaped literal and nothing else.
//   3. **it reports a plan as an erasure.** §6's split survives only if the tool keeps saying so: the purge
//      prints the keys it was *given* and states that it deleted nothing, and the takedown's own two limit
//      fields are printed verbatim rather than paraphrased. OD-20..OD-24.
//   4. **it prints the credential it was handed.** The password, the bearer token and the refresh token are
//      refused outright if a line would carry them, the operator's address and the publishable key are
//      softened, and the run record is checked the same way as the log line. OD-30..OD-34, OD-40..OD-46.
//
// Where a case checks a signature, a word list, a bound or a grant, it re-derives the expected value from the
// migration text inside the test — never from a transcription of it, and never from a comment. A tool that
// agrees with itself proves nothing, so every absence asserted here is paired with a presence measured in the
// same expression: the three unexposed acts are pinned to *zero* GRANT lines against the thirteen doors'
// *one* GRANT line each; the shipped `src/` tree is pinned to zero operator-door names against the rule
// firing on all sixteen names in a synthetic file under the same path prefix.
//
// What these cells cannot reach, stated because §13's rows are read as a coverage claim: `runPsql`,
// `assertLoopback`, `signIn`, `callRpc`, `sqlLiteral` and `parseConsoleAnswer` are module-private, so the
// console channel's own one-line answer rule, its `psql` exit-status handling and the loopback parse are only
// observable through `runCli` with an injected transport — which is how OD-16, OD-32 and OD-44 do observe
// them. What no injection can substitute for is the real `docker exec`, the real Postgres and the real
// GoTrue: that is the SQL/HTTP/browser tier's job, it is owed at this head, and it is recorded as unproven
// in the Stage 11 report rather than claimed from here. OD-54 pins the exported surface these cases run
// against, so a future change to what is reachable is visible in this file.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_FLAGS,
  HOST_INTAKE_DOORS,
  VERBS,
  VOCAB,
  classifyHttp,
  describeCensus,
  makePrinter,
  makeRedactor,
  parseArgs,
  planCall,
  readEnvFile,
  readMigrationCensus,
  readOperatorCredentials,
  readOptions,
  runCli,
} from './stage11-operations-cli.mjs';
import { RULES, isScannedPath, scanContent, selfTest } from './check-product-contract.mjs';

// ------------------------------------------------------------------ the migrations are the authority

/** Every `.sql` file in the chain, in deployment order — the same order each stage's `run.sh` applies them
 *  in. `src/integrations/supabase/types.ts` is generated from a live stack and does not exist until the
 *  stack has these migrations on it, so the migration text is the only source of the schema's shape at this
 *  head; a hand-typed signature table would be a second copy to drift. */
const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase/migrations');
const FILES = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, relative: `supabase/migrations/${name}`, text: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));
const STAGE_FILES = FILES.filter((file) => file.name.includes('_stage11_'));
const STAGE_TEXT = STAGE_FILES.map((file) => file.text).join('\n');
const CLI_PATH = 'scripts/stage11-operations-cli.mjs';
const CLI_TEXT = readFileSync(resolve(process.cwd(), CLI_PATH), 'utf8');

const DECLARATION = /CREATE (?:OR REPLACE )?FUNCTION ([a-z_]+)\.([a-z0-9_]+)\(/g;

/** The argument list of one declaration, read by matching parentheses rather than by a `)` that may appear
 *  inside a type, then split on commas at paren depth zero. Splitting on newlines instead would work for the
 *  wrapped declarations and silently merge a single-line one — `api.operator_case_queue(p_status text,
 *  p_category text, p_limit integer)` — into a single entry whose "type" is the rest of the list, which is
 *  exactly the shape of defect that reads as a passing signature comparison. */
function readArgumentList(text, openAt) {
  let depth = 1;
  let cursor = openAt;
  let buffer = '';
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
    buffer += char;
    cursor += 1;
  }
  const entries = [];
  let current = '';
  let level = 0;
  for (const char of buffer.replace(/--[^\n]*/g, ' ')) {
    if (char === '(') level += 1;
    if (char === ')') level -= 1;
    if (char === ',' && level === 0) {
      entries.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) entries.push(current);
  return entries
    .map((entry) => entry.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((entry) => ({ name: entry.split(' ')[0], type: entry.split(' ').slice(1).join(' ') }));
}

/** Every declaration in the chain, keyed by `schema.fn`, in filename order so the last entry is the head.
 *  A callable declared twice is normal here — `internal_api.operator_release_case` and
 *  `private.guard_support_case_update` were both amended by `…190200_stage11_closed_is_terminal.sql` — so
 *  "the migration declares it" is not enough; the pin has to be on the bytes the stack will end up holding. */
const DECLARATIONS = (() => {
  const found = [];
  for (const file of FILES) {
    DECLARATION.lastIndex = 0;
    let match;
    while ((match = DECLARATION.exec(file.text)) !== null) {
      found.push({
        schema: match[1],
        fn: match[2],
        file: file.name,
        relative: file.relative,
        text: file.text,
        openAt: DECLARATION.lastIndex,
        args: readArgumentList(file.text, DECLARATION.lastIndex),
      });
    }
  }
  return found;
})();

function declarationsOf(schema, fn) {
  return DECLARATIONS.filter((d) => d.schema === schema && d.fn === fn);
}

function headOf(schema, fn) {
  const rows = declarationsOf(schema, fn);
  if (rows.length === 0) throw new Error(`${schema}.${fn} is declared by no migration in this chain`);
  return rows[rows.length - 1];
}

/** The `AS $$ … $$;` body of a function's head declaration. Scoped to the body because the guards, the DML
 *  and the payload fields all live there, and because the `COMMENT ON` sentence above a body is prose that
 *  describes those facts rather than the facts themselves — the takedown's comment saying "no INSERT and no
 *  UPDATE anywhere in its body" must not be able to satisfy a cell about the body. */
function bodyOf(schema, fn) {
  const head = headOf(schema, fn);
  const start = head.text.indexOf('AS $$', head.openAt);
  if (start === -1) throw new Error(`${schema}.${fn}: no AS $$ after the declaration in ${head.relative}`);
  const end = head.text.indexOf('$$;', start);
  if (end === -1) throw new Error(`${schema}.${fn}: body of ${head.relative} never closes`);
  return { file: head.relative, text: head.text.slice(start + 5, end), args: head.args };
}

/** Words one body accepts for one parameter, read out of its own `… NOT IN ( … )` guard. The guard always
 *  names the parameter immediately before `NOT IN`, and the prefix before it varies (`IS NULL OR`,
 *  `IS NOT NULL AND`, a wrapped `AND`), so the pattern keys on that adjacency rather than on one shape. */
function guardWords(schema, fn, param) {
  const body = stripComments(bodyOf(schema, fn).text).replace(/\s+/g, ' ');
  const pattern = new RegExp(`${param} NOT IN \\(([\\s\\S]*?)\\)`, 'g');
  const lists = [...body.matchAll(pattern)].map((m) => [...m[1].matchAll(/'([^']*)'/g)].map((q) => q[1]));
  if (lists.length === 0) throw new Error(`${schema}.${fn} has no NOT IN guard on ${param}`);
  return { file: bodyOf(schema, fn).file, lists };
}

const stripComments = (text) => text.split('\n').filter((line) => !/^\s*--/.test(line)).join('\n');

/** Schema-qualified DML targets one body can reach, with the comment lines dropped first. A body with any
 *  target is one that can write, which is what `VERBS[…].mutating` claims to know. */
function dmlTargets(schema, fn) {
  const body = stripComments(bodyOf(schema, fn).text);
  return [...body.matchAll(/\b(INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+)\.([a-z_][a-z0-9_]*)/g)]
    .map(([, verb, targetSchema, table]) => `${verb.toLowerCase()} ${targetSchema}.${table}`)
    .sort();
}

const boundClauses = (schema, fn) => [...stripComments(bodyOf(schema, fn).text).matchAll(/< 1 OR \w+ > (\d+)/g)].map((m) => Number(m[1]));

/** The numbers one body applies to its own optional arguments. Two shapes carry them: a `coalesce` that
 *  supplies the default for a null argument, and a plain `:=` of a literal. A reader that only knew the
 *  first measured no default in `operator_commerce_review_queue` and no default in the health summary, and
 *  would have called those two a gap in the SQL rather than in itself. */
const inBodyDefaults = (schema, fn) => {
  const body = stripComments(bodyOf(schema, fn).text);
  return [...body.matchAll(/coalesce\(\s*\w+\s*,\s*(\d+)\s*\)/g), ...body.matchAll(/:=\s*(\d+)\s*;/g)].map((m) => Number(m[1]));
};

/** The longest prose a body accepts for one parameter, read from its own `length(…) > N`. A `btrim` wrapper
 *  is removed first, because a ceiling raised on trimmed text is still a ceiling on that parameter and the
 *  two shapes must not need two patterns. The real bytes put whitespace between the closing paren and the
 *  operator (`length(p_body) > 4000`) and a `\)?` alone cannot cross it — the first reader of this reported
 *  every one of these six ceilings as absent, which is the shape of a hole in an instrument, not a finding. */
const ceilingOf = (schema, fn, param) => [...stripComments(bodyOf(schema, fn).text)
  .replace(/\bbtrim\(\s*([a-z_][a-z0-9_]*)\s*\)/g, '$1')
  .matchAll(/length\(\s*([a-z_][a-z0-9_]*)\s*\)\s*>\s*(\d+)/g)]
  .filter((m) => m[1] === param).map((m) => Number(m[2]));

/** The bound one verb's refusal sentence states, in the tool's own words. Read from the refusal rather than
 *  from `VERBS[…].args[].bound`, because the `health` window argument carries no `bound` field at all — its
 *  limit lives only in the sentence that refuses `--window 721`. Both halves of that asymmetry are pinned by
 *  OD-08: the number here must equal the body's, and the two `limit` arguments that do declare a `bound` must
 *  declare the same number the refusal says. */
function refusedBound(verb, flags) {
  const error = capturedError(() => planOf(verb, flags));
  const stated = /between 1 and (\d+)/.exec(String(error?.message));
  if (!stated) throw new Error(`${verb} sent no "between 1 and N" sentence for ${flags.join(' ')}: ${String(error?.message).slice(0, 120)}`);
  return Number(stated[1]);
}

const httpVerbs = Object.entries(VERBS).filter(([, spec]) => spec.channel === 'http');
const psqlVerbs = Object.entries(VERBS).filter(([, spec]) => spec.channel === 'psql');
const doorNames = httpVerbs.map(([, spec]) => spec.fn).sort();
const actNames = psqlVerbs.map(([, spec]) => spec.fn).sort();

/** A `kind` is the tool's word for a parameter's shape; the SQL type is the database's. One table, asserted
 *  against both, so a new kind without a row here fails OD-04 rather than rendering `undefined` into a
 *  statement. */
const SQL_TYPE = { uuid: 'uuid', key: 'uuid', word: 'text', text: 'text', reasonText: 'text', caseRef: 'text', requestRef: 'text', limit: 'integer', window: 'integer', expires: 'timestamptz' };

/** Which body's guard carries which vocabulary list. Read from `VERBS` where the shape allows it, spelled out
 *  where a parameter is only pinned by a named pair — and every row is then *measured* against the migration
 *  in OD-07, so this map is a scope, not an assertion.
 *
 *  Every row is an `internal_api` or `private` body, never an `api` wrapper: a wrapper has no guard to read,
 *  because OD-05 pins it to exactly one delegation. A row naming one would be a claim about a shape the
 *  migrations deliberately do not have, and it fails — measured, not assumed, by the last two cells of OD-07. */
const VOCAB_GUARDS = [
  { vocab: 'caseStatus', schema: 'internal_api', fn: 'operator_case_queue', param: 'p_status' },
  { vocab: 'caseStatus', schema: 'internal_api', fn: 'operator_transition_case', param: 'p_to_status' },
  { vocab: 'caseCategory', schema: 'internal_api', fn: 'operator_case_queue', param: 'p_category' },
  { vocab: 'caseNoteKind', schema: 'internal_api', fn: 'operator_add_case_note', param: 'p_kind' },
  { vocab: 'resolutionCode', schema: 'internal_api', fn: 'operator_transition_case', param: 'p_resolution_code' },
  { vocab: 'privacyStatus', schema: 'internal_api', fn: 'operator_privacy_queue', param: 'p_status' },
  { vocab: 'privacyStatus', schema: 'internal_api', fn: 'operator_advance_privacy_request', param: 'p_status' },
  { vocab: 'takedownReason', schema: 'internal_api', fn: 'operator_takedown_publication', param: 'p_reason' },
  { vocab: 'reviewNoteKind', schema: 'internal_api', fn: 'operator_add_commerce_review_note', param: 'p_kind' },
  { vocab: 'refundStatus', schema: 'internal_api', fn: 'operator_commerce_review_queue', param: 'p_status' },
  { vocab: 'operatorScope', schema: 'internal_api', fn: 'grant_operator_role', param: 'p_scope' },
  { vocab: 'operatorScope', schema: 'internal_api', fn: 'revoke_operator_role', param: 'p_scope' },
  { vocab: 'operatorScope', schema: 'private', fn: 'actor_is_operator', param: 'p_scope' },
];

// ------------------------------------------------------------------ synthetic fixture values
// High-entropy and unmistakable: every one of them is a needle in OD-30, OD-33 and OD-41, where the claim is
// that a printed line or a run record carries none of them.

const ACCOUNT = 'ops@localvivaahvarnam.test';
const PASSWORD = 'synthetic-operator-password-0001';
const PUBLISHABLE = 'sb-publishable-synthetic-0001';
const ACCESS = 'synthetic-access-token-0001';
const REFRESH = 'synthetic-refresh-token-0001';
/** The credential this instrument must never hold. It is planted in every body and file the test hands the
 *  tool, so a reader that took a whole `.env.local` into an object, or printed a raw error body, is caught by
 *  a needle rather than by an inspection. */
const SERVICE_ROLE = 'synthetic-service-role-key-0001';
const CONTAINER = 'supabase_db_localvivaahvarnam';
const LOOPBACK = 'http://127.0.0.1:54321';
const ENV = { S11_OPERATOR_EMAIL: ACCOUNT, S11_OPERATOR_PASSWORD: PASSWORD };
const FILE_ENV = { SUPABASE_LOCAL_URL: LOOPBACK, SUPABASE_LOCAL_PUBLISHABLE_KEY: PUBLISHABLE };
const CREDENTIAL_FLAGS = ['--account-env', 'S11_OPERATOR_EMAIL', '--secret-env', 'S11_OPERATOR_PASSWORD'];
const ACTOR = '3f2a1b6c-0000-4000-8000-000000000001';
const TARGET = '7c9d0e1f-2222-4333-8444-555566667777';
const CASE_REF = 'SV-ABCDE23F';
const CREDS = { accountEnv: 'S11_OPERATOR_EMAIL', secretEnv: 'S11_OPERATOR_PASSWORD', account: ACCOUNT, password: PASSWORD };
/** Everything a run could leak, in one list, so OD-30 and OD-33 sweep the same set the printer guards. */
const NEEDLES = [PASSWORD, ACCESS, REFRESH, SERVICE_ROLE, ACCOUNT, PUBLISHABLE];

const b64 = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

const psqlArgs = (flags) => [...flags, '--via-docker', CONTAINER];
const doorArgs = (flags) => [...flags, ...CREDENTIAL_FLAGS];

/** The plan one command line builds, read through the same two steps `runCli` takes: `readOptions` first, then
 *  `planCall`. Going through `readOptions` is not extra ceremony — the unknown-flag, no-verb and two-verb
 *  refusals live there, so a cell that skipped it could report a command line the tool would never have run. */
function planOf(verb, flags = [], overrides = {}) {
  const spec = VERBS[verb];
  return planCall({ ...readOptions(parseArgs([verb, ...flags])),
    credentials: spec.channel === 'http' ? CREDS : undefined, ...overrides });
}

/** The one argument line the tool rendered for one parameter. */
function argLine(plan, param) {
  const row = plan.rendered.find((r) => r.name === param);
  if (!row) throw new Error(`the plan for ${plan.verb} rendered no ${param}`);
  return row;
}

function capturedError(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

function recorder() {
  const chunks = [];
  return { chunks, write: (chunk) => chunks.push(String(chunk)), printed: () => chunks.join('') };
}

/** A console session that records every statement and answers one line, the way `runPsql` promises to. */
function fakePsql(answer) {
  const calls = [];
  const fn = (container, statement) => {
    calls.push({ container, statement });
    if (/standard_conforming_strings/.test(statement)) return 'on';
    if (typeof answer === 'function') return answer(statement);
    if (answer instanceof Error) throw answer;
    return b64(answer);
  };
  return { fn, calls };
}

/** A stack that answers: GoTrue first, then one door. `rpc` may be a body or a function of the call. */
function fakeFetch({ session = { access_token: ACCESS, refresh_token: REFRESH }, rpc = { ok: true }, signInStatus = 0 }) {
  const calls = [];
  const response = (status, body, sentinel = false) => ({
    ok: status >= 200 && status < 400,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    ...(sentinel ? { body } : {}),
  });
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/auth/v1/token')) {
      if (signInStatus !== 0) return response(signInStatus, { message: 'Invalid login credentials', hint: SERVICE_ROLE });
      return response(200, session);
    }
    const value = typeof rpc === 'function' ? rpc({ url, init }) : rpc;
    if (value && value.__status !== undefined) return response(value.__status, value.body);
    return response(200, value);
  };
  return { impl, calls, rpcCalls: () => calls.filter((c) => c.url.includes('/rest/v1/rpc/')) };
}

const httpRefusal = (status, body) => ({ __status: status, body });

/** A transport that must never be touched: an http verb reaching `psql`, or an act reaching `fetch`, is a
 *  channel leak and this makes it a loud failure rather than a real `docker exec`. */
const unreachable = (label) => () => {
  throw new Error(`${label} was reached by a run that must not use it`);
};

async function runDoor(argv, options = {}) {
  const rec = recorder();
  const transport = fakeFetch(options);
  const result = await runCli({
    argv: doorArgs(argv),
    env: options.env ?? ENV,
    fileEnv: options.fileEnv ?? FILE_ENV,
    fetchImpl: transport.impl,
    psql: options.psql ?? unreachable('the console channel'),
    migrationsDir: options.migrationsDir,
    write: rec.write,
  });
  return { ...result, printed: rec.printed(), chunks: rec.chunks, transport };
}

async function runAct(argv, answer, options = {}) {
  const rec = recorder();
  const session = fakePsql(answer);
  const result = await runCli({
    argv: psqlArgs(argv),
    env: options.env ?? {},
    fetchImpl: unreachable('the operator channel'),
    psql: options.psql ?? session.fn,
    write: rec.write,
  });
  return { ...result, printed: rec.printed(), chunks: rec.chunks, session };
}

describe('OD surface: the tool holds exactly the doors the migrations ship', () => {
  it('OD-01 pins the thirteen http verbs to the thirteen api doors, and holds none of the six intake doors', () => {
    // Presence first: the six host intake doors really are on this schema, so "this tool holds none of them"
    // is a refusal rather than an empty set nobody looked for.
    const apiNames = new Set(DECLARATIONS.filter((d) => d.schema === 'api').map((d) => d.fn));
    expect([...HOST_INTAKE_DOORS]).toHaveLength(6);
    for (const door of HOST_INTAKE_DOORS) expect(apiNames.has(door)).toBe(true);
    expect(doorNames).toHaveLength(13);
    const verbsByFn = httpVerbs.map(([verb, spec]) => ({ verb, fn: spec.fn }));
    const drift = [];
    for (const { verb, fn } of verbsByFn) {
      if (!apiNames.has(fn)) drift.push(`${verb} calls ${fn}, which no migration declares on api`);
      if (HOST_INTAKE_DOORS.includes(fn)) drift.push(`${verb} calls the host intake door ${fn}`);
    }
    const unheld = [...apiNames].filter((name) => name.includes('operator') && !doorNames.includes(name));
    expect(drift).toEqual([]);
    expect(unheld).toEqual([]);
    expect(doorNames).toEqual([...apiNames].filter((name) => name.includes('operator')).sort());
    // The intake doors must not be reachable even as a value that could be pasted into a command line.
    const renderedFns = Object.values(VERBS).map((spec) => spec.fn);
    for (const door of HOST_INTAKE_DOORS) expect(renderedFns).not.toContain(door);
  });

  it('OD-02 pins all sixteen verbs to the sixteen internal_api bodies that take an identity', () => {
    const internal = DECLARATIONS
      .filter((d) => d.schema === 'internal_api' && d.fn.includes('operator'))
      .map((d) => d.fn);
    const unique = [...new Set(internal)].sort();
    expect(unique).toHaveLength(16);
    expect(Object.values(VERBS).map((spec) => spec.fn).sort()).toEqual(unique);
    expect(actNames).toEqual(['grant_operator_role', 'operator_purge_publication_objects', 'revoke_operator_role']);
  });

  it('OD-03 measures the three acts at zero EXECUTE grants against thirteen doors at one each', () => {
    const drift = [];
    for (const act of actNames) {
      const grants = [...STAGE_TEXT.matchAll(new RegExp(`GRANT EXECUTE ON FUNCTION (?:internal_api|api)\\.${act}\\(`, 'g'))];
      if (grants.length !== 0) drift.push(`${act} is granted EXECUTE ${grants.length} time(s) in the stage-11 files`);
      const twin = DECLARATIONS.filter((d) => d.schema === 'api' && d.fn === act);
      if (twin.length !== 0) drift.push(`${act} has an api wrapper in ${twin[0].relative}`);
      const revocations = [...STAGE_TEXT.matchAll(new RegExp(`REVOKE ALL ON FUNCTION internal_api\\.${act}\\(`, 'g'))];
      if (revocations.length < 1) drift.push(`${act} is never revoked, so the zero below measures nothing`);
    }
    for (const fn of doorNames) {
      const wrapper = [...STAGE_TEXT.matchAll(new RegExp(`GRANT EXECUTE ON FUNCTION api\\.${fn}\\(`, 'g'))];
      if (wrapper.length !== 1) drift.push(`api.${fn} carries ${wrapper.length} wrapper GRANT lines, expected one`);
    }
    expect(drift).toEqual([]);
    // The pair that makes the posture mean something: the same scanner finds grants where §10 says there are
    // grants, so the acts' zeros are a measurement and not an inert pattern.
    expect(doorNames.every((fn) => new RegExp(`GRANT EXECUTE ON FUNCTION api\\.${fn}\\(`).test(STAGE_TEXT))).toBe(true);
    expect(actNames.some((fn) => new RegExp(`GRANT EXECUTE ON FUNCTION (?:internal_api|api)\\.${fn}\\(`).test(STAGE_TEXT))).toBe(false);
  });

  it('OD-04 pins every verb parameter to the head internal_api declaration, in order and by type', () => {
    const drift = [];
    for (const [verb, spec] of Object.entries(VERBS)) {
      const head = headOf('internal_api', spec.fn);
      const expected = spec.args.map((a) => {
        if (!SQL_TYPE[a.kind]) drift.push(`${verb}: no SQL type row for kind ${a.kind}`);
        return `${a.param} ${SQL_TYPE[a.kind] ?? '?'}`;
      }).join(', ');
      const actual = head.args.map((a) => `${a.name} ${a.type}`).join(', ');
      if (expected !== actual) {
        drift.push(`${verb} -> internal_api.${spec.fn} (${head.file}):\n  tool: ${expected}\n  head: ${actual}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('OD-05 pins each api wrapper to the same list and to one delegation with the names in the same order', () => {
    const drift = [];
    for (const fn of doorNames) {
      const apiHead = headOf('api', fn);
      const internalHead = headOf('internal_api', fn);
      const asText = (rows) => rows.map((a) => `${a.name} ${a.type}`).join(', ');
      if (asText(apiHead.args) !== asText(internalHead.args)) {
        drift.push(`${fn}: the wrapper's list differs from the body's\n  api: ${asText(apiHead.args)}\n  internal: ${asText(internalHead.args)}`);
      }
      const body = bodyOf('api', fn).text;
      const delegated = new RegExp(`SELECT internal_api\\.${fn}\\(([\\s\\S]*?)\\);`).exec(body);
      if (!delegated) {
        drift.push(`${fn}: wrapper body is not one delegation: ${JSON.stringify(body.trim().slice(0, 120))}`);
        continue;
      }
      const passed = delegated[1].split(',').map((s) => s.trim()).filter(Boolean);
      const wanted = internalHead.args.map((a) => a.name);
      if (passed.join(',') !== wanted.join(',')) {
        drift.push(`${fn}: wrapper passes ${passed.join(', ')}, the body declares ${wanted.join(', ')}`);
      }
    }
    expect(drift).toEqual([]);
    expect(doorNames).toHaveLength(13);
  });

  it('OD-06 reads the head rather than the first declaration, proved on the callable that has two', () => {
    const twice = [...new Set(DECLARATIONS.map((d) => `${d.schema}.${d.fn}`))]
      .map((key) => {
        const [schema, fn] = key.split('.');
        const rows = declarationsOf(schema, fn);
        return { key, count: rows.length, files: rows.map((r) => r.file) };
      })
      .filter((row) => row.count > 1);
    const pinned = twice.filter((row) => Object.values(VERBS).some((spec) => `${row.key.split('.')[1]}` === spec.fn));
    expect(pinned.map((row) => row.key)).toEqual(['internal_api.operator_release_case']);
    const rows = declarationsOf('internal_api', 'operator_release_case');
    expect(rows.map((r) => r.file)).toEqual(['20261020190100_stage11_support_cases.sql', '20261020190200_stage11_closed_is_terminal.sql']);
    // The discriminator: the later body carries the terminal-case refusal the amendment added, the earlier one
    // does not. A pin that read the first file would be pinning superseded bytes and would still be green.
    const head = bodyOf('internal_api', 'operator_release_case');
    expect(head.file).toBe('supabase/migrations/20261020190200_stage11_closed_is_terminal.sql');
    expect(/status = 'closed'/.test(head.text)).toBe(true);
    const first = rows[0];
    const firstBodyStart = first.text.indexOf('AS $$', first.openAt);
    const firstBody = first.text.slice(firstBodyStart + 5, first.text.indexOf('$$;', firstBodyStart));
    expect(firstBody).not.toBe(head.text);
    expect(/status = 'closed'/.test(firstBody)).toBe(false);
  });

  it('OD-07 re-pins all nine closed vocabularies to the shipped guard sentences, with no orphan and no gap', () => {
    const drift = [];
    const used = new Set();
    for (const row of VOCAB_GUARDS) {
      used.add(row.vocab);
      const { lists, file } = guardWords(row.schema, row.fn, row.param);
      const expected = VOCAB[row.vocab];
      if (!expected) {
        drift.push(`${row.vocab} is named by a guard row but is not in VOCAB`);
        continue;
      }
      lists.forEach((list, index) => {
        if (list.join(',') !== expected.join(',')) {
          drift.push(`${row.schema}.${row.fn} (${file}) guard ${index} on ${row.param}:\n  body: ${list.join(', ')}\n  tool: ${expected.join(', ')}`);
        }
      });
    }
    const orphan = Object.keys(VOCAB).filter((key) => !used.has(key));
    expect(orphan).toEqual([]);
    // The title's "nine" is this number, and a vocabulary added to VOCAB without a guard row would make it move.
    expect([...used].sort()).toEqual(['caseCategory', 'caseNoteKind', 'caseStatus', 'operatorScope', 'privacyStatus',
      'refundStatus', 'resolutionCode', 'reviewNoteKind', 'takedownReason']);
    // No CLI-supplied word parameter is left unpinned: every `vocab`-bearing argument in VERBS has a guard row
    // naming the same body and the same parameter.
    const missing = [];
    for (const [verb, spec] of Object.entries(VERBS)) {
      for (const arg of spec.args) {
        if (!arg.vocab) continue;
        const hit = VOCAB_GUARDS.some((row) => row.vocab === arg.vocab
          && row.param === arg.param && row.fn === spec.fn);
        if (!hit) missing.push(`${verb}.${arg.param} uses VOCAB.${arg.vocab} with no guard row`);
      }
    }
    expect(missing).toEqual([]);
    // A guard row that named a body the tool never calls would be decoration: every row's function is in VERBS
    // except the shared predicate, which the doors themselves call.
    const callable = new Set(Object.values(VERBS).map((spec) => spec.fn));
    for (const row of VOCAB_GUARDS) {
      if (row.schema === 'private') expect(row.fn).toBe('actor_is_operator');
      else if (!callable.has(row.fn)) drift.push(`guard row names ${row.schema}.${row.fn}, which no verb calls`);
    }
    expect(drift).toEqual([]);
    // The scope of the table itself: no row may name the exposed schema, because a wrapper carries no guard and
    // cannot be asked for one. Presence control in the same cell — the wrapper that the removed row named is
    // measured to hold the delegation and no vocabulary, so the absence here is a fact about those bytes rather
    // than a shape this file forgot to write.
    expect(VOCAB_GUARDS.map((row) => row.schema)).not.toContain('api');
    const wrapper = bodyOf('api', 'operator_case_queue');
    expect(wrapper.text.trim()).toBe('SELECT internal_api.operator_case_queue(p_status, p_category, p_limit);');
    expect(/NOT IN/.test(wrapper.text)).toBe(false);
  });

  it('OD-08 pins the two row bounds and the window bound, and keeps every default in the body', () => {
    const drift = [];
    const boundOf = (verb) => VERBS[verb].args.find((a) => a.kind === 'limit' || a.kind === 'window');
    for (const [verb, schema, fn, expectedDefault] of [
      ['case-queue', 'internal_api', 'operator_case_queue', 25],
      ['commerce-queue', 'internal_api', 'operator_commerce_review_queue', 50],
      ['health', 'internal_api', 'operator_operations_summary', 24],
    ]) {
      const clauses = boundClauses(schema, fn);
      const arg = boundOf(verb);
      if (clauses.length !== 1) drift.push(`${fn} has ${clauses.length} bound clauses, expected exactly one`);
      // The tool's bound is whatever its own refusal says, so the one verb that spells the number only in a
      // sentence is measured the same way as the two that also store it in the spec.
      const stated = refusedBound(verb, [`--${arg.opt}`, '999']);
      if (clauses.length === 1 && clauses[0] !== stated) drift.push(`${fn} bounds at ${clauses[0]}, the tool's refusal says ${stated}`);
      if (arg.bound !== undefined && arg.bound !== stated) drift.push(`${fn}: spec bound ${arg.bound} disagrees with its own refusal ${stated}`);
      const defaults = inBodyDefaults(schema, fn);
      if (!defaults.includes(expectedDefault)) drift.push(`${fn} applies no in-body default of ${expectedDefault}`);
      // The tool's half of the same rule: send nothing, and let the body choose. A default minted here would be
      // a second copy of a number that already lives in SQL.
      const plan = planOf(verb);
      if (plan.params[arg.param] !== null) drift.push(`${verb} sends ${JSON.stringify(plan.params[arg.param])} where the body should apply its own default`);
    }
    expect(drift).toEqual([]);
    expect(boundOf('case-queue').bound).toBe(100);
    expect(boundOf('commerce-queue').bound).toBe(200);
    expect(boundOf('health').bound).toBeUndefined();
  });

  it('OD-09 pins the prose ceilings the bodies raise on, not the ones this tool would like', () => {
    const wanted = [
      ['internal_api', 'operator_add_case_note', 'p_body', 4000],
      ['internal_api', 'operator_transition_case', 'p_body', 4000],
      ['internal_api', 'operator_advance_privacy_request', 'p_note', 4000],
      ['internal_api', 'operator_add_commerce_review_note', 'p_note', 4000],
      ['internal_api', 'grant_operator_role', 'p_reason', 500],
      ['internal_api', 'revoke_operator_role', 'p_reason', 500],
    ];
    const drift = [];
    const kindOf = (fn, param) => {
      const spec = Object.values(VERBS).find((row) => row.fn === fn);
      return spec?.args.find((a) => a.param === param)?.kind;
    };
    for (const [schema, fn, param, ceiling] of wanted) {
      const found = ceilingOf(schema, fn, param);
      if (found.length === 0) drift.push(`${schema}.${fn} has no length ceiling on ${param}`);
      else if (!found.includes(ceiling)) drift.push(`${schema}.${fn} bounds ${param} at ${found.join('/')}, not ${ceiling}`);
      // The tool must send that parameter as prose, or the ceiling it quotes is not the ceiling it enforces.
      const kind = kindOf(fn, param);
      if (kind === undefined) drift.push(`${schema}.${fn}.${param} is bounded by a body but no verb sends it`);
      else if (ceiling === 4000 && kind !== 'text') drift.push(`${param} is bounded at 4000 by the body but sent as ${kind}`);
      else if (ceiling === 500 && kind !== 'reasonText') drift.push(`${param} is bounded at 500 by the body but sent as ${kind}`);
    }
    expect(drift).toEqual([]);
    // And the refusal is the tool's own, at the body's number: 4001 characters cannot leave this process.
    const long = 'x'.repeat(4001);
    const error = capturedError(() => planOf('case-note', ['--case', CASE_REF, '--kind', 'message_operator', '--body', long]));
    expect(String(error?.message)).toMatch(/ceiling is 4000/);
    expect(error?.exitCode).toBe(2);
    const reason = 'y'.repeat(501);
    const second = capturedError(() => planOf('grant', ['--user', TARGET, '--scope', 'operations', '--reason', reason, '--actor', ACTOR]));
    expect(String(second?.message)).toMatch(/body's own 500/);
  });

  it('OD-10 equates mutating with a reachable DML target, and the two irreversible acts with zero deletes', () => {
    const drift = [];
    for (const [verb, spec] of Object.entries(VERBS)) {
      const targets = dmlTargets('internal_api', spec.fn);
      const writes = targets.length > 0;
      if (writes !== spec.mutating) {
        drift.push(`${verb}: mutating=${spec.mutating} but ${targets.length} DML target(s) [${targets.join('; ')}]`);
      }
      const deletes = stripComments(bodyOf('internal_api', spec.fn).text).match(/DELETE FROM\s+(?:private|public)\./g) ?? [];
      if (deletes.length > 0) drift.push(`${verb} carries ${deletes.length} DELETE FROM clause(s), which §6 puts outside this stage`);
    }
    expect(drift).toEqual([]);
    const mutating = Object.entries(VERBS).filter(([, s]) => s.mutating).map(([v]) => v).sort();
    expect(mutating).toHaveLength(10);
    expect(Object.entries(VERBS)).toHaveLength(16);
    // Presence control for the DELETE sweep: the same scanner does see writes in these bodies, so its zeros are
    // a measurement. The purge is the sharpest case: two INSERTs, one plan, no removal. Both literals are
    // written in the scanner's own sort order, since `dmlTargets` sorts and an unsorted expectation would be a
    // failure of this file rather than of the SQL.
    const purge = dmlTargets('internal_api', 'operator_purge_publication_objects');
    expect(purge).toEqual(['insert into private.audit_events', 'insert into private.support_case_events']);
    const takedown = dmlTargets('internal_api', 'operator_takedown_publication');
    expect(takedown).toEqual(['insert into private.audit_events', 'insert into private.support_case_events',
      'update private.access_tokens', 'update public.invitation_outputs', 'update public.publications']);
  });
});

// ------------------------------------------------------------------ one complete command line per verb

/** A valid invocation of every verb, using the option names its shipped `args` list carries. This is a table
 *  rather than per-cell typing because five cells claim to cover "all sixteen verbs", and a claim that large
 *  needs a list behind it: OD-13 asserts this table's keys equal `VERBS`'s, so a verb added without a row here
 *  fails instead of being quietly skipped. */
const FULL = {
  'case-queue': ['--status', 'open', '--category', 'other', '--limit', '20'],
  'case-get': ['--case', CASE_REF],
  'case-note': ['--case', CASE_REF, '--kind', 'message_host', '--body', 'the host asked for a fresh link'],
  'case-claim': ['--case', CASE_REF],
  'case-release': ['--case', CASE_REF],
  'case-transition': ['--case', CASE_REF, '--to', 'in_progress', '--resolution', 'resolved_by_operator', '--body', 'closed after the second link'],
  'privacy-queue': ['--status', 'received'],
  'privacy-advance': ['--request', 'PR-ABCDE23F', '--status', 'queued_for_stage13', '--note', 'queued for the export run'],
  'takedown-plan': ['--wedding', TARGET],
  takedown: ['--wedding', TARGET, '--case', CASE_REF, '--reason', 'owner_request'],
  'commerce-queue': ['--status', 'recorded', '--limit', '10'],
  'commerce-note': ['--refund', TARGET, '--case', CASE_REF, '--kind', 'in_review', '--note', 'evidence requested from the ledger, not the provider'],
  health: ['--window', '72'],
  grant: ['--user', TARGET, '--scope', 'support', '--reason', 'on-call rota for the ticket queue', '--actor', ACTOR, '--expires', '2026-12-31T00:00:00Z'],
  revoke: ['--user', TARGET, '--scope', 'support', '--reason', 'the rota ended', '--actor', ACTOR],
  purge: ['--case', CASE_REF, '--actor', ACTOR],
};

/** One flag and its value, gone from a command line, so a cell about a missing required argument gets the rest
 *  of the same verb intact. */
function dropFlag(flags, opt) {
  const out = [];
  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i] === `--${opt}`) { i += 1; continue; }
    out.push(flags[i]);
  }
  return out;
}

/** The argument lines of one rendered call, exactly as the statement sends them. The two-space indent is part
 *  of the frame `renderNamedCall` builds, so a builder that reformatted a plan an operator had read would fail
 *  here rather than change shape in silence. */
function argumentLines(statement) {
  const match = /\(\n  ([\s\S]*?)\n\)/.exec(statement);
  if (!match) throw new Error('that statement carries no indented multi-line call');
  return match[1].split(',\n  ');
}

/** The top-level arguments of the call whose `(` sits at `openIdx`, counted with string contents held out of
 *  the tally, so neither a comma nor a paren inside a literal can end the scan one argument early. */
function topLevelArgs(src, openIdx) {
  const args = [];
  let depth = 0, current = '', inString = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (src[i + 1] === "'") { current += "'"; i++; } else inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; current += ch; continue; }
    if (ch === '(') { depth += 1; if (depth === 1) continue; }
    else if (ch === ')') { depth -= 1; if (depth === 0) { args.push(current); return args; } }
    else if (ch === ',' && depth === 1) { args.push(current); current = ''; continue; }
    current += ch;
  }
  throw new Error('a jsonb_build_object call never closed');
}

/** The keys one body puts in the jsonb it hands back, read by *argument position* inside a balanced
 *  `jsonb_build_object( … )` call. Position, not line position: these bodies wrap their calls across lines,
 *  and the line-anchored rule this cell used to carry saw `'case_ref'` at a line start while `audit_id` sat
 *  three arguments later on the same line — so `operator_claim_case`, `operator_release_case`, `revoke_operator_role`
 *  and `grant_operator_role` were read as naming no audit id, and the census below asserted that reading.
 *  Scoped to the three shapes that actually reach the caller — `RETURN jsonb_build_object( … )`, the
 *  `RETURN v_payload || jsonb_build_object( … )` merge, and the `v_payload := jsonb_build_object( … )` that
 *  merge reads — because a vocabulary guard is a list of quoted lowercase words too, and a reader that did
 *  not care which parentheses they sat inside would call `'billing_refund_inquiry'` a payload field. */
function payloadKeys(schema, fn) {
  const body = bodyOf(schema, fn).text;
  const calls = [...body.matchAll(
    /(?:\bRETURN\s+v_payload\s*\|\|\s*|\bRETURN\s+|\bv_payload\s*:=\s*)jsonb_build_object\s*\(/g)];
  if (calls.length === 0) throw new Error(`${schema}.${fn} builds no jsonb payload`);
  const keys = [];
  for (const call of calls) {
    const args = topLevelArgs(body, call.index + call[0].length - 1);
    for (let i = 0; i + 1 < args.length; i += 2) {
      const key = /^'([a-z0-9_]+)'$/.exec(args[i].trim());
      if (key) keys.push(key[1]);
    }
  }
  return [...new Set(keys)];
}

/** A console session that answers the encoding probe with a chosen word and every statement with the same
 *  jsonb, recording the order. `ensureSafeEncoding` is module-private, so the gate's *position* — before the
 *  statement, not after it — is only observable as a call list like this one. */
function psqlProbe(setting, answer = { ok: true }) {
  const calls = [];
  const fn = (container, statement) => {
    calls.push({ container, statement });
    if (/standard_conforming_strings/.test(statement)) return setting;
    return typeof answer === 'function' ? answer(statement) : b64(answer);
  };
  return { fn, calls };
}

/** Both transports, rigged to say so if they are touched. A dry run that reached either one would throw, so
 *  `exit === 0` is the proof and `touched` is the measurement of the same fact. */
function silentTransport() {
  const touched = { psql: 0, fetch: 0 };
  return {
    touched,
    psql: () => { touched.psql += 1; throw new Error('the console channel was reached by a run that must not use it'); },
    fetchImpl: () => { touched.fetch += 1; throw new Error('the operator channel was reached by a run that must not use it'); },
  };
}

/** A complete command line for one verb: the verb itself, its flags, and whatever that channel needs to have
 *  a target at all — the container name for an act, the credential pair for a door. */
const lineFor = (verb, flags) => [verb, ...(VERBS[verb].channel === 'psql' ? psqlArgs(flags) : doorArgs(flags))];

async function runQuiet(verb, flags = FULL[verb], { env = ENV, fileEnv = FILE_ENV } = {}) {
  const rec = recorder();
  const transport = silentTransport();
  const result = await runCli({ argv: lineFor(verb, flags), env, fileEnv, psql: transport.psql,
    fetchImpl: transport.fetchImpl, write: rec.write });
  return { ...result, printed: rec.printed(), chunks: rec.chunks, touched: transport.touched };
}

/** The files a repository scan would read under one prefix, named the way the checker names them. Bounded on
 *  purpose: OD-46 needs a real census of `src/`, and a count with no list behind it is not a scope.
 *
 *  The separator is converted here rather than reached for with `path.posix`, because `process.cwd()` and
 *  `join` are the host's own: on Windows `relative` returns backslashes whatever object does the work, and
 *  `isScannedPath` compares POSIX prefixes (`src/`), so a backslashed name would silently scan nothing.
 *  This helper's first execution was OD-45's, and its first measurement was that defect. */
function walkScanned(prefix) {
  const found = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) { visit(absolute); continue; }
      const relativePath = relative(process.cwd(), absolute).split('\\').join('/');
      if (isScannedPath(relativePath)) found.push({ relativePath, text: readFileSync(absolute, 'utf8') });
    }
  };
  visit(resolve(process.cwd(), prefix));
  return found;
}

describe('OD argv and plan: the run is decided before the first byte leaves', () => {
  it('OD-11 reads a command line the way the tool claims to, and swallows no value', () => {
    const a = parseArgs(['grant', '--user', TARGET, '--yes', '--reason=two words=here', '--dry-run']);
    expect(a._).toEqual(['grant']);
    expect(a.user).toBe(TARGET);
    expect(a.yes).toBe(true);
    expect(a['dry-run']).toBe(true);
    // `=` splits once, so a note carrying an equals sign is not silently cut in half.
    expect(a.reason).toBe('two words=here');
    expect(a.given).toEqual(['user', 'yes', 'reason', 'dry-run']);

    // A flag with nothing after it, or with another flag after it, is `true` — never the next token's value.
    expect(parseArgs(['case-get', '--case']).case).toBe(true);
    expect(parseArgs(['case-get', '--case', '--yes']).case).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);

    // The three boolean flags never consume the token after them, so `--yes --user X` is both halves.
    const b = parseArgs(['grant', '--yes', '--user', TARGET]);
    expect(b.yes).toBe(true);
    expect(b.user).toBe(TARGET);

    // An operator who pastes a flag where the note goes is told the note is missing, rather than writing
    // `--yes` into a support case as though the host had said it.
    const c = parseArgs(['case-note', '--body', '--yes', '--case', CASE_REF]);
    expect(c.body).toBe(true);
    expect(c.yes).toBe(true);

    // Measured behaviour, recorded so a future change is visible from here: a repeated flag resolves to the
    // last one and both are named in `given`. Nothing asks about the first, and the body only sees what won.
    const d = parseArgs(['case-get', '--case', 'SV-AAAAAAAA', '--case', CASE_REF]);
    expect(d.case).toBe(CASE_REF);
    expect(d.given.filter((name) => name === 'case')).toHaveLength(2);
  });

  it('OD-12 makes the actor a named argument on every act, and refuses a run that has not thought about it', () => {
    const drift = [];
    for (const verb of ['grant', 'revoke', 'purge']) {
      const spec = VERBS[verb];
      const row = spec.args.find((arg) => arg.param === 'p_actor_user_id');
      if (!row) { drift.push(`${verb} has no actor parameter at all`); continue; }
      if (row.required !== true) drift.push(`${verb}.${row.opt} is not required, so a run could name nobody`);
      if (row.default !== undefined) drift.push(`${verb} gives the actor a default identity`);
      const error = capturedError(() => planOf(verb, psqlArgs(dropFlag(FULL[verb], 'actor'))));
      if (!/actor is required here/.test(String(error?.message))) {
        drift.push(`${verb} without --actor said: ${String(error?.message).slice(0, 120)}`);
      }
      if (error?.exitCode !== 2) drift.push(`${verb} without --actor exited ${error?.exitCode}, not 2`);
      const plan = planOf(verb, psqlArgs(FULL[verb]));
      if (plan.params.p_actor_user_id !== ACTOR) drift.push(`${verb} lost the actor value`);
      // Named notation is what makes the two identity slots unswitchable, even in a call where both uuids are
      // the same person.
      if (!plan.call.includes(`p_actor_user_id => '${ACTOR}'::uuid`)) drift.push(`${verb} rendered no named actor`);
    }
    expect(drift).toEqual([]);

    // Exactly three verbs name an actor, and all three are acts. A door never asks for one because the operator
    // channel already carries it: `auth.uid()`, from the sign-in the body reads.
    const actorVerbs = Object.entries(VERBS)
      .filter(([, spec]) => spec.args.some((arg) => arg.param === 'p_actor_user_id'))
      .map(([verb]) => verb).sort();
    expect(actorVerbs).toEqual(['grant', 'purge', 'revoke']);
    for (const [, spec] of httpVerbs) {
      expect(spec.args.some((arg) => arg.param === 'p_actor_user_id')).toBe(false);
    }

    // Self-granting is not refused by this tool, and the migration's own prelude says that is a decision rather
    // than an oversight. Both halves pinned: the plan builds with one human in both slots, and the body carries
    // no equality guard between them — while still reading the actor, which is what makes that zero a measure.
    const self = planOf('grant', psqlArgs(['--user', ACTOR, '--scope', 'operations',
      '--reason', 'the first operations grant', '--actor', ACTOR]));
    expect(self.params.p_user_id).toBe(ACTOR);
    expect(self.params.p_actor_user_id).toBe(ACTOR);
    expect(self.call).toContain(`p_user_id => '${ACTOR}'::uuid`);
    const grantBody = bodyOf('internal_api', 'grant_operator_role').text;
    expect(/p_user_id\s*=\s*p_actor_user_id/.test(grantBody)).toBe(false);
    expect((grantBody.match(/p_actor_user_id/g) ?? []).length).toBeGreaterThan(2);
    // And the prelude that records the decision is really in the file this reads the body from.
    expect(/Self-granting is \*not\* refused/.test(STAGE_TEXT)).toBe(true);
  });

  it('OD-13 plans every mutating verb with zero transport contact, and lets a read run when told to', async () => {
    expect(Object.keys(FULL).sort()).toEqual(Object.keys(VERBS).sort());
    const mutating = Object.entries(VERBS).filter(([, spec]) => spec.mutating).map(([verb]) => verb).sort();
    const reads = Object.entries(VERBS).filter(([, spec]) => !spec.mutating).map(([verb]) => verb).sort();
    expect(mutating).toHaveLength(10);
    expect(reads).toHaveLength(6);
    expect([...mutating, ...reads].sort()).toEqual(Object.keys(VERBS).sort());

    for (const verb of mutating) {
      const run = await runQuiet(verb);
      expect(run.exit, `${verb} planned without --yes`).toBe(0);
      expect(run.plan.dryRun).toBe(true);
      expect(run.plan.writes).toBe(false);
      expect(run.record.executed).toBe(false);
      expect(run.touched, `${verb} touched a transport`).toEqual({ psql: 0, fetch: 0 });
      expect(run.printed).toContain('plan only (no --yes)');
      expect(run.printed).toContain('run record:');
      if (VERBS[verb].channel === 'psql') {
        expect(run.printed).toContain('CREATE TEMP TABLE s11cli_answer(payload text);');
      } else {
        expect(run.printed).toContain(`POST /rest/v1/rpc/${VERBS[verb].fn}`);
      }
    }

    // A read has no plan-only mode of its own, because there is nothing to hold back: `--dry-run` is the flag
    // that previews one, and without it a read runs. Both halves pinned so neither verb can silently flip.
    for (const verb of reads) {
      const plain = planOf(verb, FULL[verb]);
      expect(plain.dryRun, `${verb} with no flag`).toBe(false);
      expect(plain.writes).toBe(false);
      const preview = planOf(verb, [...FULL[verb], '--dry-run']);
      expect(preview.dryRun, `${verb} with --dry-run`).toBe(true);
      const run = await runQuiet(verb, [...FULL[verb], '--dry-run']);
      expect(run.exit).toBe(0);
      expect(run.touched).toEqual({ psql: 0, fetch: 0 });
      const live = await runQuiet(verb);
      expect(live.exit, `${verb} is a read, so without --dry-run it must reach its channel`).toBe(1);
      expect(live.touched.fetch, `${verb} previewed instead of running`).toBe(1);
      expect(live.touched.psql).toBe(0);
    }

    // The two flags that both write and do not write cannot share a line, and the refusal costs no contact.
    for (const verb of mutating) {
      const run = await runQuiet(verb, [...FULL[verb], '--yes', '--dry-run']);
      expect(run.exit).toBe(2);
      expect(run.printed).toContain('both writes and does not');
      expect(run.touched).toEqual({ psql: 0, fetch: 0 });
    }
  });

  it('OD-14 mints an idempotency key when the operator named none, and refuses one that is not a uuid', () => {
    const keyed = Object.entries(VERBS).filter(([, spec]) => spec.args.some((a) => a.kind === 'key'))
      .map(([verb]) => verb).sort();
    expect(keyed).toEqual(['case-claim', 'case-note', 'case-release', 'case-transition', 'commerce-note',
      'privacy-advance', 'purge', 'takedown']);
    const drift = [];
    for (const verb of keyed) {
      const flags = VERBS[verb].channel === 'psql' ? psqlArgs(FULL[verb]) : FULL[verb];
      const plan = planOf(verb, flags);
      const row = argLine(plan, 'p_idempotency_key');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.js)) {
        drift.push(`${verb} minted ${JSON.stringify(row.js)}, not a v4 uuid`);
      }
      if (!/^'[0-9a-f-]{36}'::uuid$/.test(row.sql)) drift.push(`${verb} rendered the key as ${row.sql}`);
      if (row.display !== 'minted for this run') drift.push(`${verb} displayed the key as ${row.display}`);
      // The keyed bodies refuse a null key — `operator_add_commerce_review_note` says so in its own guard — so
      // a tool that sent NULL would ship a verb that cannot be run at all, and `NULL::uuid` must not appear.
      if (plan.params.p_idempotency_key === null) drift.push(`${verb} sent no key`);
      if (String(plan.call ?? '').includes('NULL::uuid')) drift.push(`${verb} rendered a NULL uuid key`);
      if (plan.params.p_idempotency_key !== row.js) drift.push(`${verb}: the printed plan and the sent value disagree`);
      const second = planOf(verb, flags);
      if (second.params.p_idempotency_key === plan.params.p_idempotency_key) drift.push(`${verb} minted the same key twice`);
      const named = planOf(verb, [...flags, '--key', TARGET]);
      if (named.params.p_idempotency_key !== TARGET) drift.push(`${verb} ignored --key`);
      const hostile = capturedError(() => planOf(verb, [...flags, '--key', 'not-a-uuid']));
      if (!/--key must be a uuid/.test(String(hostile?.message))) drift.push(`${verb} accepted a non-uuid --key`);
      if (hostile?.exitCode !== 2) drift.push(`${verb}'s key refusal exited ${hostile?.exitCode}, not 2`);
    }
    expect(drift).toEqual([]);
    // The two acts that take no key, and the shipped reason: replay defence lives where a client can retry, and
    // a double grant is itself a refusal. Pinned against the bodies, which ask for no key parameter at all.
    expect(VERBS.grant.args.some((a) => a.kind === 'key')).toBe(false);
    expect(VERBS.revoke.args.some((a) => a.kind === 'key')).toBe(false);
    for (const fn of ['grant_operator_role', 'revoke_operator_role']) {
      expect(headOf('internal_api', fn).args.map((a) => a.name)).not.toContain('p_idempotency_key');
    }
    // An uppercase uuid is normalised before the cast, so the ledger holds one spelling of one key.
    const upper = planOf('case-claim', ['--case', CASE_REF, '--key', TARGET.toUpperCase()]);
    expect(upper.params.p_idempotency_key).toBe(TARGET);
    expect(argLine(upper, 'p_idempotency_key').sql).toBe(`'${TARGET}'::uuid`);
  });

  it('OD-15 renders one guarded statement in named notation, and a hostile reason stays one string', () => {
    const plan = planOf('grant', psqlArgs(FULL.grant));
    const statement = plan.statement;
    expect(statement.split('\n')[0]).toBe('CREATE TEMP TABLE s11cli_answer(payload text);');
    expect(statement).toContain('DO $cli$ BEGIN');
    expect(statement).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(statement).toContain("INSERT INTO pg_temp.s11cli_answer VALUES ('ERR ' || SQLSTATE || ' ' || replace(SQLERRM, chr(10), ' '));");
    expect(statement.split('\n').at(-1)).toBe('SELECT payload FROM pg_temp.s11cli_answer;');
    // The call is wrapped, not bare, and its answer leaves encoded exactly once: no quote, newline or arrow in
    // the database's own sentence reaches the terminal raw on this channel. The count is the half that matters
    // — a second `encode(convert_to( … ))` around the same expression is invisible to a reader and fatal to the
    // run, because `parseConsoleAnswer` decodes one layer and then tries to read the other as JSON. This cell
    // caught one such wrap, which had made every act on the console channel an instrument failure.
    // The `chr(10)` strip is the other half of that sentence being true: Postgres's base64 encoder is RFC 2045
    // multi-line and breaks after 76 characters (measured on the running stack), so an encoded answer arrives as
    // several lines unless the wrapper removes them — which is how `purge` and `revoke` came to write their acts
    // and then report them unread at 4ea2a97.
    expect(statement).toContain('INSERT INTO pg_temp.s11cli_answer SELECT replace(encode(convert_to((internal_api.grant_operator_role(');
    expect(statement).toContain("::text, 'utf8'), 'base64'), chr(10), '');");
    expect((statement.match(/encode\(convert_to\(/g) ?? []).length).toBe(1);
    expect((statement.match(/SELECT payload FROM pg_temp\.s11cli_answer;/g) ?? []).length).toBe(1);

    // Named notation, declaration order, one cast literal per argument.
    expect(headOf('internal_api', 'grant_operator_role').args.map((a) => a.name))
      .toEqual(['p_user_id', 'p_scope', 'p_reason', 'p_actor_user_id', 'p_expires_at']);
    expect(argumentLines(statement)).toEqual([
      `p_user_id => '${TARGET}'::uuid`,
      "p_scope => 'support'::text",
      "p_reason => 'on-call rota for the ticket queue'::text",
      `p_actor_user_id => '${ACTOR}'::uuid`,
      "p_expires_at => '2026-12-31T00:00:00Z'::timestamptz",
    ]);

    // The injection case: a reason that opens and closes a literal is still one value, and the proof is
    // structural rather than a hope — replace the hostile literal with the benign one and the two statements
    // are byte-identical, which is "nothing outside the literal changed" said as a fact.
    const hostile = "'); DROP TABLE private.audit_events; --";
    const attack = planOf('grant', psqlArgs(['--user', TARGET, '--scope', 'support', '--reason', hostile,
      '--actor', ACTOR, '--expires', '2026-12-31T00:00:00Z']));
    const hostileLiteral = "'''); DROP TABLE private.audit_events; --'::text";
    expect(argLine(attack, 'p_reason').sql).toBe(hostileLiteral);
    expect(attack.statement.replace(hostileLiteral, "'on-call rota for the ticket queue'::text")).toBe(statement);
    expect(attack.statement.match(/DROP TABLE/g) ?? []).toHaveLength(1);
    expect(argumentLines(attack.statement)).toHaveLength(5);

    // A NUL is refused rather than sent: `psql` would truncate the rest of the statement at it, which shortens
    // an act the operator described in full, silently.
    const nul = capturedError(() => planOf('case-note', ['--case', CASE_REF, '--kind', 'message_host',
      '--body', 'a note with a \u0000 in the middle']));
    expect(String(nul?.message)).toContain('a value contains a NUL byte');
    expect(nul?.exitCode).toBe(2);
    const nulAct = capturedError(() => planOf('grant', psqlArgs(['--user', TARGET, '--scope', 'support',
      '--reason', 'a \u0000 reason', '--actor', ACTOR])));
    expect(String(nulAct?.message)).toContain('a value contains a NUL byte');
  });

  it('OD-16 asks the session about its encoding before it sends a literal, and sends nothing after a no', async () => {
    const PROBE = 'SHOW standard_conforming_strings;';
    const statement = planOf('grant', psqlArgs(FULL.grant)).statement;

    /** One run of the act over a session that answers the probe with `setting`, returning what left this
     *  process in order. `ensureSafeEncoding` is module-private, so its position — asked, then the act, never
     *  the act alone — is only observable as a call list like this one. */
    const asks = async (setting) => {
      const probe = psqlProbe(setting);
      const rec = recorder();
      const run = await runCli({ argv: lineFor('grant', [...FULL.grant, '--yes']), env: {}, psql: probe.fn,
        fetchImpl: unreachable('the operator channel'), write: rec.write });
      return { run, sent: probe.calls.map((c) => c.statement), containers: probe.calls.map((c) => c.container), printed: rec.printed() };
    };

    // The yes: two calls, probe first, then the plan's own statement byte for byte.
    const accepted = await asks('on');
    expect(accepted.run.exit).toBe(0);
    expect(accepted.sent).toEqual([PROBE, statement]);
    expect(accepted.containers).toEqual([CONTAINER, CONTAINER]);

    // `exactly on` after the trim the gate does itself: a padded answer is the same session setting and is
    // accepted, while a word that merely means yes is refused, because `standard_conforming_strings = off` is
    // the case where the doubling rule stops holding.
    for (const setting of ['ON', 'ON ', 'off', 'OFF', '', 'true', 'one', 'standard_conforming_strings=on']) {
      const refused = await asks(setting);
      expect(refused.run.exit, JSON.stringify(setting)).toBe(2);
      expect(refused.sent, `${JSON.stringify(setting)} sent the act anyway`).toEqual([PROBE]);
      expect(refused.run.record.executed).toBe(false);
      expect(refused.printed).toContain('standard_conforming_strings is not exactly `on`');
      expect(refused.printed).not.toContain('grant_operator_role');
    }
    for (const setting of ['on', ' on ', 'on\n']) {
      const padded = await asks(setting);
      expect(padded.run.exit, JSON.stringify(setting)).toBe(0);
      expect(padded.sent).toEqual([PROBE, statement]);
    }

    // A plan-only run has no session to ask, so it asks nothing: the probe belongs to the byte that is about
    // to leave, and printing a statement is not sending one.
    const preview = psqlProbe('off');
    const dry = await runCli({ argv: lineFor('grant', FULL.grant), env: {}, psql: preview.fn,
      fetchImpl: unreachable('the operator channel'), write: () => {} });
    expect(dry.exit).toBe(0);
    expect(preview.calls).toEqual([]);

    // The round trip, measured against a session that encodes exactly as many times as its own statement asks
    // for. A fake that hands back one prepared line cannot notice a second wrap; a fake that reads the
    // statement's bytes can, and this is the cell that fails if the encoder and its caller both wrap.
    //
    // It also answers the way Postgres does rather than the way `Buffer` does, because that is where the second
    // console defect came from: SQL's base64 is the multi-line MIME variant of RFC 2045, broken after every 76
    // characters. Measured on the running stack, `encode(convert_to(…,'utf8'),'base64')` of a 908-byte value
    // came back 1,227 characters long with 15 newlines, the first at position 77, none trailing, no line longer
    // than 76. `runPsql` accepts exactly one line and its `DO` block commits before that is checked, so at
    // 4ea2a97 `purge` and `revoke` wrote their acts and then reported them unread. The one-line rule lives in
    // `runPsql`, which no injection reaches; what this cell measures is the same quantity the rule reads.
    const payload = { ok: true, audit_id: 'b1c2d3e4-0000-4000-8000-000000000009', replayed: false };
    const mimeBreak = (value) => value.replace(/(.{76})(?=.)/gs, '$1\n');
    const encodeAsWritten = (text) => {
      let answer = JSON.stringify(payload);
      for (let i = 0; i < (text.match(/encode\(convert_to\(/g) ?? []).length; i += 1) {
        answer = mimeBreak(Buffer.from(answer, 'utf8').toString('base64'));
      }
      return answer;
    };
    /** The statement's own instruction, applied: `chr(10)` removed is what hands `psql` one line. */
    const consoleAnswer = (text) => (/\breplace\(encode\(convert_to\(/.test(text)
      ? encodeAsWritten(text).replace(/\n/g, '')
      : encodeAsWritten(text));
    const shape = [];
    const emulate = (container, text) => {
      if (/standard_conforming_strings/.test(text)) return 'on';
      const line = consoleAnswer(text);
      shape.push({ lines: line.split('\n').length, width: line.length });
      return line;
    };
    const trip = recorder();
    const roundTrip = await runCli({ argv: lineFor('grant', [...FULL.grant, '--yes']), env: {}, psql: emulate,
      fetchImpl: unreachable('the operator channel'), write: trip.write });
    expect(roundTrip.exit).toBe(0);
    expect(trip.printed()).toContain(JSON.stringify(payload));
    expect(roundTrip.record.audit_id).toBe(payload.audit_id);
    expect(roundTrip.record.executed).toBe(true);
    expect(shape).toEqual([{ lines: 1, width: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64').length }]);
    // The teeth behind that one line: the same answer with the statement's `chr(10)` strip left out is two
    // lines, so `lines: 1` above is the strip working, not a payload that was never wide enough to break.
    expect(mimeBreak(Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')).split('\n')).toHaveLength(2);

    // The control for that control: the same fake, answering one layer deeper than the statement asks, is read
    // back as an unreadable answer rather than as half a payload — so the cell above measures the decode and is
    // not a tautology. What this file cannot settle is the encoder's own behaviour; the fake only reproduces
    // what was measured on the running stack. The live console run of `grant`, `revoke` and `purge` is the SQL
    // tier's half, and this file pins that the tool writes one wrap, decodes one and asks for one line.
    const doubleEncoded = (container, text) => (/standard_conforming_strings/.test(text)
      ? 'on'
      : Buffer.from(consoleAnswer(text), 'utf8').toString('base64'));
    const poisoned = await runCli({ argv: lineFor('grant', [...FULL.grant, '--yes']), env: {},
      psql: doubleEncoded, fetchImpl: unreachable('the operator channel'), write: () => {} });
    expect(poisoned.exit).toBe(1);
    expect(String(poisoned.refusal)).toContain('not the JSON it was asked to build');
  });

  it('OD-17 keeps the two channels apart, and refuses a command line that has confused them', () => {
    const drift = [];
    const check = (label, build, pattern, exit = 2) => {
      const error = capturedError(build);
      if (!pattern.test(String(error?.message))) drift.push(`${label} said: ${String(error?.message).slice(0, 130)}`);
      if (error?.exitCode !== exit) drift.push(`${label} exited ${error?.exitCode}, expected ${exit}`);
    };
    /** The act's command line with its container named by `value` — the one flag whose whole job is to say
     *  which database this run is allowed to touch. */
    const withContainer = (value) => [...FULL.grant, '--via-docker', String(value)];
    check('an act with a credential flag', () => planOf('grant', psqlArgs([...FULL.grant, ...CREDENTIAL_FLAGS])),
      /authenticated by the local socket, not by a token/);
    check('a door on the console channel', () => planOf('case-get', ['--case', CASE_REF, ...CREDENTIAL_FLAGS, '--via-docker', CONTAINER]),
      /means the trusted channel, and case-get is an operator door/);
    check('an act with no container', () => planCall({ verb: 'grant', spec: VERBS.grant,
      args: parseArgs(['grant', ...FULL.grant]), credentials: undefined }),
      /reaches the database through the local stack's own container/);
    check('an act with the container flag but no name', () => planOf('grant', ['--via-docker', ...FULL.grant]),
      /no --via-docker was given/);
    check('a container that is not the local stack', () => planOf('grant', withContainer('postgres16')),
      /wants the local stack's database container name/);
    check('a container that spells a hosted project', () => planOf('grant', withContainer('supabase_db_hosted.supabase.co')),
      /wants the local stack's database container name/);
    check('an unknown flag', () => planOf('grant', [...psqlArgs(FULL.grant), '--reasn', 'oops']),
      /--reasn means nothing to grant/);
    check('two verbs on one line', () => readOptions(parseArgs(['grant', 'revoke'])), /one verb per run/);
    check('no verb at all', () => readOptions(parseArgs([])), /no verb/);
    check('a verb the tool does not have', () => readOptions(parseArgs(['operator_case_queue'])),
      /is not a verb this tool has\. The sixteen are/);
    // A door with no credential pair is not a designed refusal but a broken instrument: nothing reaches the
    // operator channel unsigned, and a run that got here has lost the pair rather than declined to use it.
    check('a door handed no credential pair', () => planCall({ verb: 'case-get', spec: VERBS['case-get'],
      args: parseArgs(['case-get', '--case', CASE_REF]), credentials: undefined }),
      /Nothing reaches the operator channel unsigned/, 1);

    // The shape rule is the whole of the hosted ban on this channel, and it is the stronger gate: every name
    // that passes holds no dot, so no spelling of a hostname can reach `docker exec`. Both sides of that line
    // are measured rather than asserted, because widening the class to admit the `.` Docker itself allows is
    // exactly the change that would make a hosted target nameable here.
    for (const name of ['supabase_db_localvivaahvarnam', 'supabase_db_x', 'supabase_db_A-1', 'supabase_db_2']) {
      const planned = capturedError(() => planOf('grant', withContainer(name)));
      if (planned) drift.push(`the legal container name ${name} was refused: ${String(planned.message).slice(0, 90)}`);
      else if (planOf('grant', withContainer(name)).container !== name) drift.push(`${name} was not the planned container`);
    }
    for (const name of ['supabase_db_', 'supa_x_db_local', 'supabase db_local', 'supabase_db_local;drop',
      '/var/run/docker.sock', 'SUPABASE_DB_local', 'supabase_db_localvivaahvarnam.', 'db_localvivaahvarnam']) {
      const error = capturedError(() => planOf('grant', withContainer(name)));
      if (!error) drift.push(`the container name ${JSON.stringify(name)} was accepted`);
      else if (error.exitCode !== 2) drift.push(`${JSON.stringify(name)} exited ${error.exitCode}, not 2`);
      else if (!/wants the local stack's database container name/.test(String(error.message))) {
        drift.push(`${JSON.stringify(name)} said: ${String(error.message).slice(0, 110)}`);
      }
    }
    expect(drift).toEqual([]);

    // Presence control for the flag list: the same credentials on a real door plan cleanly, and the same
    // container on a real act plans cleanly, so every refusal above names a shape rather than the flag itself.
    expect(planOf('case-get', ['--case', CASE_REF, ...CREDENTIAL_FLAGS]).channel).toBe('http');
    expect(planOf('revoke', psqlArgs(FULL.revoke)).channel).toBe('psql');
    // And the intake doors are not verbs, so a run cannot even reach the channel question with one.
    expect(capturedError(() => readOptions(parseArgs(['open_support_case'])))).toBeTruthy();
  });

  it('OD-18 refuses every malformed value at the console, by the rule for its own kind', () => {
    const drift = [];
    // Bare flags only: the loop below adds `--via-docker` to the acts, so a row cannot accidentally test a
    // psql verb on the operator channel or the other way round.
    const cases = [
      ['takedown-plan', ['--wedding', 'not-a-uuid'], /--wedding is not a uuid/],
      ['takedown-plan', ['--wedding', TARGET.slice(0, 30)], /--wedding is not a uuid/],
      ['takedown-plan', [], /wedding is required here/],
      ['case-get', ['--case', 'SV-short'], /not a case ref of the shape the trigger mints/],
      ['case-get', ['--case', 'PR-ABCDE23F'], /not a case ref/],
      // A flag given with nothing after it and a flag not given at all are the same refusal, because `parseArgs`
      // hands `true` and `coerce` calls that absent: one sentence covers both shapes, and a run that typed
      // `--case` alone is told the body has no value to fall back to rather than being quoted its own typo.
      ['case-get', ['--case'], /case is required here/],
      ['case-get', [], /case is required here/],
      ['privacy-advance', ['--request', 'SV-ABCDE23F', '--status', 'received'], /not a privacy request ref/],
      ['privacy-advance', ['--status', 'received'], /request is required here/],
      ['commerce-note', dropFlag(FULL['commerce-note'], 'note'), /note is required here/],
      ['commerce-note', [...dropFlag(FULL['commerce-note'], 'note'), '--note'], /note is required here/],
      ['case-note', ['--case', CASE_REF, '--kind', 'message_everyone', '--body', 'text'],
        /is not one of the 2 caseNoteKind words this build ships/],
      ['case-queue', ['--status', 'CLOSED'], /is not one of the 6 caseStatus words/],
      ['case-queue', ['--category', 'other ', '--status', 'open'], /is not one of the 7 caseCategory words/],
      ['case-note', ['--case', CASE_REF, '--kind', 'message_host', '--body', '   '], /must be real text or absent/],
      ['grant', [...dropFlag(FULL.grant, 'reason'), '--reason', ' '],
        /a grant or revocation with a blank reason is refused by its own body/],
      ['revoke', ['--user', TARGET, '--scope', 'support', '--reason', 'y'.repeat(501), '--actor', ACTOR],
        /exceeds the body's own 500/],
      ['grant', [...dropFlag(FULL.grant, 'scope'), '--scope', 'billing'],
        /is not one of the 4 operatorScope words this build ships/],
      ['case-note', ['--case', CASE_REF, '--kind', 'message_host', '--body', 'x'.repeat(4001)],
        /the column ceiling is 4000/],
      ['case-queue', ['--limit', '12x'], /--limit must be a whole number/],
      ['case-queue', ['--limit', '0'], /--limit for this queue is between 1 and 100, not 0/],
      ['case-queue', ['--limit', '-1'], /--limit for this queue is between 1 and 100, not -1/],
      ['commerce-queue', ['--limit', '201'], /--limit for this queue is between 1 and 200, not 201/],
      ['health', ['--window', '0'], /--window is between 1 and 720 hours, not 0/],
      ['health', ['--window', '721'], /--window is between 1 and 720 hours, not 721/],
      ['health', ['--window', '1e3'], /--window must be a whole number/],
      ['grant', [...dropFlag(FULL.grant, 'expires'), '--expires', '2026-13-45'],
        /must be an ISO 8601 timestamp with an offset/],
      ['grant', [...dropFlag(FULL.grant, 'expires'), '--expires', '2026-12-31T00:00:00'],
        /ISO 8601 timestamp with an offset/],
      ['grant', [...dropFlag(FULL.grant, 'expires'), '--expires', '31/12/2026'],
        /ISO 8601 timestamp with an offset/],
    ];
    for (const [verb, flags, pattern] of cases) {
      const line = VERBS[verb].channel === 'psql' ? psqlArgs(flags) : flags;
      const error = capturedError(() => planOf(verb, line));
      if (error === null) drift.push(`${verb} ${JSON.stringify(flags)} was accepted`);
      else if (!pattern.test(String(error.message))) {
        drift.push(`${verb} ${JSON.stringify(flags)} said: ${String(error.message).slice(0, 140)}`);
      } else if (error.exitCode !== 2) drift.push(`${verb} ${JSON.stringify(flags)} exited ${error.exitCode}, not 2`);
    }
    expect(drift).toEqual([]);

    // Presence control per kind, or the sweep above only proves that nothing works: each of these plans builds.
    expect(planOf('takedown-plan', ['--wedding', TARGET]).params.p_wedding_id).toBe(TARGET);
    expect(planOf('case-queue', ['--status', 'closed', '--limit', '100']).params.p_status).toBe('closed');
    expect(planOf('case-queue', ['--status', 'closed', '--category', 'other']).params.p_category).toBe('other');
    expect(planOf('health', ['--window', '720']).params.p_window_hours).toBe(720);
    expect(planOf('health', []).params.p_window_hours).toBeNull();
    expect(planOf('commerce-note', FULL['commerce-note']).params.p_note)
      .toBe('evidence requested from the ledger, not the provider');
    expect(planOf('grant', psqlArgs(FULL.grant)).params.p_expires_at).toBe('2026-12-31T00:00:00Z');
    expect(planOf('grant', psqlArgs(dropFlag(FULL.grant, 'expires'))).params.p_expires_at).toBeNull();
    // The two empty-value kinds disagree on purpose, and the tool quotes the body rather than inventing a rule:
    // a note that is all spaces is refused as text, a reason that is all spaces is refused as a reason, and the
    // two sentences name different authorities.
    const blankNote = capturedError(() => planOf('case-note', ['--case', CASE_REF, '--kind', 'message_host',
      '--body', '\t ']));
    expect(String(blankNote?.message)).toContain('must be real text or absent');
    const blankReason = capturedError(() => planOf('revoke', psqlArgs(['--user', TARGET, '--scope', 'support',
      '--reason', '\t ', '--actor', ACTOR])));
    expect(String(blankReason?.message)).toContain('refused by its own body');
  });
});
// ------------------------------------------------------------------ group 3: the answer side
/** The audit row id one answer can name. Nothing in this group reads it from the tool's own source: it is put
 *  into a fake body answer and expected back in the operator's sentence, so a printer that invented an id, or
 *  that dropped one it was handed, fails. */
const AUDIT_ROW = '9ab1c2d3-4444-4000-8000-0000000000aa';

/** The mutating verbs, each read against the body that actually runs: the keys its own `jsonb_build_object`
 *  hands back, and whether its own DML reaches `private.audit_events`. `internal_api` is authoritative for
 *  both channels because OD-05 pins every `api` wrapper to a one-line delegation to the same name. */
const MUTATING = Object.entries(VERBS).filter(([, spec]) => spec.mutating);

const auditCensus = () => MUTATING.map(([verb, spec]) => {
  const keys = payloadKeys('internal_api', spec.fn);
  return {
    verb,
    channel: spec.channel,
    fn: spec.fn,
    keys,
    namesAuditId: keys.includes('audit_id'),
    namesReplayed: keys.includes('replayed'),
    writesAuditRow: dmlTargets('internal_api', spec.fn).includes('insert into private.audit_events'),
  };
});

describe('OD answers: what the body handed back is the only thing the operator is told', () => {
  it('OD-20 pins the audit-fact census to the bodies, and prints each act from its own keys', async () => {
    const census = auditCensus();
    expect(census.length).toBe(10);

    // The list behind the count. Measured at this head, nine of the ten mutating verbs name the audit row they
    // wrote in the very payload that reports the act, and the tenth — `case-note` — writes no `audit_events`
    // row at all (it appends a case event, and the body says the omission is deliberate), so there is no id
    // for it to name and no silent trail anywhere in the set. `grant` and `revoke` are the two verbs that take
    // no `p_idempotency_key` at all — measured as the statement each one prints (`q11-logs/s11-grant-revoke-key-probe-1.txt`)
    // and as the absence of the parameter in their own signatures (`q11-logs/s11-idempotency-param-probe-1.txt`) —
    // so they cannot answer a replay and the replay half of the sentence is off by design, not by omission.
    //
    // The four lists this cell carried before measured something else: this file's `payloadKeys` read a payload
    // key only when it began a line, and these bodies wrap their calls, so it missed the `audit_id` sitting
    // mid-line in `operator_claim_case` and `operator_release_case` and reported six verbs instead of nine. Both
    // the instrument and the lists are repaired here; before/after captures are
    // `q11-logs/s11-od20-before.txt`, `q11-logs/s11-payloadkeys-diagnostic-1.txt` (the old rule, replayed on the
    // current bytes) and `q11-logs/s11-body-arm-probe-1.txt` (the independent extraction the new lists match).
    expect(census.filter((row) => row.namesAuditId).map((row) => row.verb).sort())
      .toEqual(['case-claim', 'case-release', 'case-transition', 'commerce-note', 'grant',
        'privacy-advance', 'purge', 'revoke', 'takedown']);
    expect(census.filter((row) => !row.namesAuditId).map((row) => row.verb).sort())
      .toEqual(['case-note']);
    expect(census.filter((row) => !row.writesAuditRow).map((row) => row.verb))
      .toEqual(['case-note']);
    expect(census.filter((row) => row.writesAuditRow && !row.namesAuditId).map((row) => row.verb).sort())
      .toEqual([]);
    expect(census.filter((row) => row.namesReplayed).map((row) => row.verb).sort())
      .toEqual(['case-claim', 'case-note', 'case-release', 'case-transition', 'commerce-note',
        'privacy-advance', 'purge', 'takedown']);

    // Two controls on the instrument itself, because a census that can only read what the old rule happened
    // to see would pass on a wrong reading in both directions. The first is the exact projection of one verb,
    // the verb whose `audit_id` the line-anchored rule dropped: if extraction under-reads, this fails. The
    // second is that a body's own vocabulary guard is never mistaken for a payload field — those quoted words
    // sit in the same body, and the merge arm of this very cell would light up if the reader stopped caring
    // which parentheses a quoted word sat inside.
    const claim = census.find((row) => row.verb === 'case-claim');
    expect([...claim.keys].sort()).toEqual(['assigned_operator_user_id', 'audit_id', 'case_ref', 'replayed', 'seq']);
    const kindWords = guardWords('internal_api', 'operator_add_commerce_review_note', 'p_kind').lists.flat();
    expect(kindWords.length).toBeGreaterThan(0);
    const commerceRow = census.find((row) => row.verb === 'commerce-note');
    expect(commerceRow.keys.filter((key) => kindWords.includes(key))).toEqual([]);
    for (const row of census) {
      const answer = {};
      for (const key of row.keys) {
        if (key === 'audit_id') answer[key] = AUDIT_ROW;
        else if (key === 'replayed') answer[key] = true;
        else answer[key] = null;
      }
      const flags = [...FULL[row.verb], '--yes'];
      const run = row.channel === 'psql'
        ? await runAct([row.verb, ...flags], answer)
        : await runDoor([row.verb, ...flags], { rpc: answer });
      expect(run.exit).toBe(0);
      expect(run.record.executed).toBe(true);
      if (row.namesAuditId) {
        expect(run.printed).toContain(`this act is recorded as audit_id ${AUDIT_ROW}`);
        expect(run.printed).not.toContain('(the answer named none)');
        expect(run.record.audit_id).toBe(AUDIT_ROW);
      } else {
        expect(run.printed).toContain('this act is recorded as audit_id (the answer named none)');
        expect(run.printed).not.toContain(AUDIT_ROW);
        expect('audit_id' in run.record).toBe(false);
      }
      if (row.namesReplayed) {
        expect(run.printed).toContain('— the body answered a replay of this key, so it ran once');
        expect(run.record.replayed).toBe(true);
      } else {
        expect(run.printed).not.toContain('so it ran once');
        expect('replayed' in run.record).toBe(false);
      }
    }

    // The two halves compose into one sentence, in the order the operator reads them, and the row above that
    // proves it is not two separate prints: case-note names no audit id but does answer a replay.
    const note = await runDoor(['case-note', ...FULL['case-note'], '--yes'],
      { rpc: { case_ref: CASE_REF, replayed: true } });
    expect(note.printed).toContain('this act is recorded as audit_id (the answer named none)'
      + ' — the body answered a replay of this key, so it ran once.');
  });

  it('OD-21 reads only the two facts it was promised, and never from a key it has to go looking for', async () => {
    const shapes = [
      ['the id under a different name', { audit_event_id: AUDIT_ROW, id: AUDIT_ROW, audit_row_id: AUDIT_ROW }],
      ['the id nested one level down', { audit: { id: AUDIT_ROW, event_id: AUDIT_ROW } }],
      ['the id inside a row array', [{ audit_id: AUDIT_ROW, replayed: true }]],
      ['no object at all', 'the body answered a bare string'],
      ['a bare null', null],
      ['the key present with a null value', { audit_id: null, replayed: null }],
      ['the key present with a value', { audit_id: AUDIT_ROW, replayed: true }],
    ];
    const seen = [];
    for (const [label, answer] of shapes) {
      const run = await runAct(['purge', ...FULL.purge, '--yes'], answer);
      expect(run.exit).toBe(0);
      // Nothing else from the body reaches the record: a run record that grew a `wedding_id`, an `object_keys`
      // list or a `note` would be a second place an answer can end up in a log.
      expect(Object.keys(run.record).filter((key) => !['verb', 'channel', 'mutating', 'executed', 'exit',
        'audit_id', 'replayed'].includes(key))).toEqual([]);
      seen.push({
        label,
        saysNone: run.printed.includes('(the answer named none)'),
        saysId: run.printed.includes(`audit_id ${AUDIT_ROW}`),
        saysReplay: run.printed.includes('so it ran once'),
        recordNamesId: 'audit_id' in run.record,
        recordId: run.record.audit_id,
        recordNamesReplayed: 'replayed' in run.record,
      });
    }
    // The first five rows are the cell's point: an id that has to be *found* — under another name, one level
    // down, inside a row array, or in an answer that is not an object — is not read, and saying so is the
    // honest output. The last two are the measured asymmetry, kept deliberately: the operator's line collapses
    // a key the body never named and a key it named with a null into the same `(the answer named none)`,
    // because either way the run has no id to give and the tool never prints an id it was not handed. The
    // record keeps the two apart — `audit_id: null` against no key at all — and that is the only place a body
    // which inserts an audit row and answers a null id can still be recognised as that body.
    expect(seen).toEqual([
      { label: 'the id under a different name', saysNone: true, saysId: false, saysReplay: false,
        recordNamesId: false, recordId: undefined, recordNamesReplayed: false },
      { label: 'the id nested one level down', saysNone: true, saysId: false, saysReplay: false,
        recordNamesId: false, recordId: undefined, recordNamesReplayed: false },
      { label: 'the id inside a row array', saysNone: true, saysId: false, saysReplay: false,
        recordNamesId: false, recordId: undefined, recordNamesReplayed: false },
      { label: 'no object at all', saysNone: true, saysId: false, saysReplay: false,
        recordNamesId: false, recordId: undefined, recordNamesReplayed: false },
      { label: 'a bare null', saysNone: true, saysId: false, saysReplay: false,
        recordNamesId: false, recordId: undefined, recordNamesReplayed: false },
      { label: 'the key present with a null value', saysNone: true, saysId: false, saysReplay: false,
        recordNamesId: true, recordId: null, recordNamesReplayed: true },
      { label: 'the key present with a value', saysNone: false, saysId: true, saysReplay: true,
        recordNamesId: true, recordId: AUDIT_ROW, recordNamesReplayed: true },
    ]);

    // A replay the body answered with anything other than a literal true is not reported as a replay — a
    // stringified true, a 1 and a truthy object all fail this test if the clause is widened to `if (replayed)`.
    for (const value of ['true', 1, {}, [], 'yes']) {
      const run = await runAct(['purge', ...FULL.purge, '--yes'], { audit_id: AUDIT_ROW, replayed: value });
      expect(run.exit).toBe(0);
      expect(run.printed).not.toContain('so it ran once');
      expect(run.record.replayed).toEqual(value);
    }
    // The same two rules on the operator channel, so the census is not a psql-only property.
    const door = await runDoor(['case-transition', ...FULL['case-transition'], '--yes'],
      { rpc: { case_ref: CASE_REF, to_status: 'closed', audit_event_id: AUDIT_ROW } });
    expect(door.exit).toBe(0);
    expect(door.printed).toContain('audit_id (the answer named none)');
    expect('audit_id' in door.record).toBe(false);
  });

  it('OD-22 turns every console SQLSTATE into the exit code its own class earns, and says so', async () => {
    const designed = [
      ['42501', 'permission denied for function grant_operator_role'],
      ['23503', 'insert or update on table "operator_grants" violates foreign key constraint'],
      ['23505', 'duplicate key value violates unique constraint "operator_grants_pkey"'],
      ['23514', 'new row for relation "operator_grants" violates check constraint'],
      ['P0001', 'the reason for a revocation must name the rota that ended'],
      ['22001', 'value too long for type character varying(4000)'],
      ['22023', 'invalid input value for enum'],
    ];
    for (const [code, message] of designed) {
      const run = await runAct(['grant', ...FULL.grant, '--yes'], () => `ERR ${code} ${message}`);
      expect(run.exit).toBe(2);
      expect(run.record.exit).toBe(2);
      expect(run.record.sqlstate).toBe(code);
      expect(run.record.executed).toBe(false);
      expect(run.printed).toContain(`the database refused this grant (SQLSTATE ${code}): ${message}`);
      expect(run.printed).not.toContain('not one of the refusals this build ships');
      expect(run.refusal).toBe(message);
      // A designed refusal is still an answer, so the run record is printed and the exit is 2; nothing in the
      // output claims the act happened.
      expect(run.printed).toContain('run record:');
      expect(run.printed).not.toContain('this act is recorded as audit_id');
    }

    const undesigned = [
      ['57014', 'canceling statement due to statement timeout'],
      ['P0002', 'no_data_found: the case named by --case is not in the queue'],
      ['00000', 'the database answered with the success state inside an error frame'],
      ['99999', 'a code that is not a Postgres SQLSTATE at all'],
    ];
    for (const [code, message] of undesigned) {
      const run = await runAct(['revoke', ...FULL.revoke, '--yes'], () => `ERR ${code} ${message}`);
      expect(run.exit).toBe(1);
      expect(run.record.exit).toBe(1);
      expect(run.record.sqlstate).toBe(code);
      expect(run.record.executed).toBe(false);
      expect(run.printed).toContain(`the database refused this revoke (SQLSTATE ${code}): ${message}`);
      expect(run.printed).toContain('note: that SQLSTATE is not one of the refusals this build ships, so the '
        + 'run is reported as an instrument failure rather than as an answer.');
    }
    // The two sets are read from the tool, not retyped here, so widening one without the other fails.
    const printed = await runAct(['purge', ...FULL.purge, '--yes'], () => 'ERR 23505');
    expect(printed.exit).toBe(2);
    expect(printed.refusal).toBe('');
    expect(printed.printed).toContain('the database refused this purge (SQLSTATE 23505):');
    // A refusal frame with no sentence is still a refusal: the code decides the exit, and the empty message is
    // printed as the body's silence rather than as a guess about what the console meant.
    expect(printed.printed).not.toContain('nothing was deleted');
    // and the same frame with an undesigned code and no message earns the note and exit 1.
    const silent = await runAct(['purge', ...FULL.purge, '--yes'], () => 'ERR 57014');
    expect(silent.exit).toBe(1);
    expect(silent.refusal).toBe('');
  });

  it('OD-23 sends the probe and one statement per act, retries nothing, and never touches the other channel', async () => {
    const counted = async (verb, flags, answer) => {
      const rec = recorder();
      const session = fakePsql(answer);
      let fetches = 0;
      const result = await runCli({
        argv: psqlArgs([verb, ...flags]),
        env: {},
        psql: session.fn,
        fetchImpl: async () => { fetches += 1; return { ok: true, status: 200, text: async () => '{}' }; },
        write: rec.write,
      });
      return { ...result, printed: rec.printed(), session, fetches };
    };

    const executed = await counted('grant', [...FULL.grant, '--yes'], { audit_id: AUDIT_ROW });
    expect(executed.exit).toBe(0);
    expect(executed.session.calls.length).toBe(2);
    expect(executed.session.calls[0].statement).toBe('SHOW standard_conforming_strings;');
    expect(executed.session.calls[1].statement).toContain('CREATE TEMP TABLE s11cli_answer');
    expect(executed.session.calls[1].statement).toContain('internal_api.grant_operator_role');
    expect(executed.session.calls.map((call) => call.container))
      .toEqual([CONTAINER, CONTAINER]);
    expect(executed.fetches).toBe(0);

    // A refusal is an answer, not a transport accident: the statement is sent once, and a tool that retried
    // would write twice for an operator who asked once.
    const refused = await counted('grant', [...FULL.grant, '--yes'], () => 'ERR 23505 duplicate key value');
    expect(refused.exit).toBe(2);
    expect(refused.session.calls.length).toBe(2);
    expect(refused.fetches).toBe(0);

    const cancelled = await counted('revoke', [...FULL.revoke, '--yes'], () => 'ERR 57014 statement timeout');
    expect(cancelled.exit).toBe(1);
    expect(cancelled.session.calls.length).toBe(2);
    expect(cancelled.fetches).toBe(0);

    // A console that could not run at all is the third shape, and it also sends once: the failure is reported,
    // not retried into the stack.
    const broken = await counted('purge', [...FULL.purge, '--yes'],
      () => { throw new Error('docker exec failed: container is not running'); });
    expect(broken.exit).toBe(1);
    expect(broken.session.calls.length).toBe(2);
    expect(broken.printed).toContain('refused: docker exec failed');
    expect(broken.fetches).toBe(0);

    for (const [verb] of psqlVerbs) {
      const run = await counted(verb, [...FULL[verb], '--yes'], { ok: true });
      expect(run.exit).toBe(0);
      expect(run.session.calls.length).toBe(2);
      expect(run.fetches).toBe(0);
    }

    // The two facts that make "the operator channel is not reachable from an act" a measurement rather than a
    // hope: a plan-only act sends nothing at all, and a door never reaches the console.
    const planOnly = await counted('grant', FULL.grant, { ok: true });
    expect(planOnly.exit).toBe(0);
    expect(planOnly.session.calls.length).toBe(0);
    expect(planOnly.fetches).toBe(0);
    const door = await runDoor(['case-get', ...FULL['case-get']], { rpc: { case_ref: CASE_REF },
      psql: unreachable('the console channel') });
    expect(door.exit).toBe(0);
    expect(door.transport.rpcCalls().length).toBe(1);
  });

  it('OD-24 keeps the purge sentence on the run that planned, and off the ones that refused or only read', async () => {
    const censusRow = auditCensus().find((row) => row.verb === 'purge');
    const answer = {};
    for (const key of censusRow.keys) {
      answer[key] = key === 'audit_id' ? AUDIT_ROW : key === 'objects_planned' ? 3
        : key === 'objects_deleted_by_this_call' ? false : null;
    }
    const executed = await runAct(['purge', ...FULL.purge, '--yes'], answer);
    expect(executed.exit).toBe(0);
    expect(executed.record.executed).toBe(true);
    expect(executed.printed).toContain('purge: ');
    expect(executed.printed).toContain('"objects_planned":3');
    expect(executed.printed).toContain('nothing was deleted: the body you called plans, and the keys above '
      + 'are the list it returned. §10 puts the removal in the trusted publisher, which is where the storage '
      + 'credential is.');
    expect(executed.printed).toContain(`this act is recorded as audit_id ${AUDIT_ROW}`);

    // The sentence is not the tool's inference about what it did: the body itself answers the deletion flag as
    // `false`, and no body in the chain answers it `true`, so `nothing was deleted` restates a stack fact.
    const body = stripComments(bodyOf('internal_api', 'operator_purge_publication_objects').text);
    expect(/'objects_deleted_by_this_call',\s*false/.test(body)).toBe(true);
    expect(STAGE_TEXT).not.toContain("'objects_deleted_by_this_call', true");
    expect(executed.answer.objects_deleted_by_this_call).toBe(false);

    // A plan-only purge prints the statement it would run and no claim about deletion — the run has touched
    // nothing, and "nothing was deleted" would still be the wrong sentence for a run that never spoke.
    const planned = await runAct(['purge', ...FULL.purge], { ok: true });
    expect(planned.exit).toBe(0);
    expect(planned.printed).toContain('purge: plan only (no --yes)');
    expect(planned.printed).not.toContain('nothing was deleted');
    expect(planned.printed).not.toContain('this act is recorded as audit_id');
    expect(planned.session.calls.length).toBe(0);

    // A refused purge is refused before any answer exists, so it cannot print the sentence either; and the
    // other acts, which do write, never print it — the wording belongs to one body's contract.
    const refused = await runAct(['purge', ...FULL.purge, '--yes'],
      () => 'ERR 23514 new row violates check constraint');
    expect(refused.exit).toBe(2);
    expect(refused.printed).toContain('the database refused this purge');
    expect(refused.printed).not.toContain('nothing was deleted');
    for (const verb of ['grant', 'revoke']) {
      const run = await runAct([verb, ...FULL[verb], '--yes'], { audit_id: AUDIT_ROW });
      expect(run.exit).toBe(0);
      expect(run.printed).not.toContain('nothing was deleted');
    }
    const door = await runDoor(['takedown', ...FULL.takedown, '--yes'], { rpc: { audit_id: AUDIT_ROW } });
    expect(door.exit).toBe(0);
    expect(door.printed).not.toContain('nothing was deleted');
    // A read verb is not mutating, so even the one whose answer carries an audit id prints no audit sentence.
    const read = await runDoor(['takedown-plan', ...FULL['takedown-plan']],
      { rpc: { audit_id: AUDIT_ROW } });
    expect(read.exit).toBe(0);
    expect(read.printed).not.toContain('this act is recorded as audit_id');
    expect(read.record.mutating).toBe(false);
  });
});

// ------------------------------------------------------------------ group 4: the printing gate
/** Every string a run could leak, checked for in a set of texts. Read as a function of `NEEDLES` rather than
 *  as six hand-typed `not.toContain` lines so that OD-30's control can prove the same list detects all six in
 *  a poisoned text — a sweep that cannot report a hit is a sweep that proves nothing. */
const needleHits = (...texts) => NEEDLES.filter((needle) => texts.some((text) => String(text).includes(needle)));

describe('OD printing: nothing that leaves this process may be a credential', () => {
  it('OD-30 sweeps every printed chunk of all sixteen verbs, and the sweep itself is proved able to fire', async () => {
    const poisoned = `the operator ${ACCOUNT} signed in with ${PASSWORD}; the bearer is ${ACCESS}, the refresh `
      + `is ${REFRESH}, the file also holds ${SERVICE_ROLE} and the apikey ${PUBLISHABLE}`;
    expect(needleHits(poisoned)).toEqual(NEEDLES);
    expect(NEEDLES.length).toBe(6);

    for (const [verb, spec] of Object.entries(VERBS)) {
      const answer = { ok: true, verb, rows: 3, note: 'three cases open, none of them named here' };
      const flags = [...FULL[verb], '--yes'];
      const run = spec.channel === 'psql'
        ? await runAct([verb, ...flags], answer)
        : await runDoor([verb, ...flags], { rpc: answer });
      expect(run.exit).toBe(0);
      // The non-vacuity half: a verb that printed nothing would sweep clean by being silent, so the same
      // measurement has to show that output exists before the absence of a needle can mean anything.
      expect(run.chunks.length).toBeGreaterThan(0);
      expect(run.printed).toContain(verb);
      expect(needleHits(run.printed, ...run.chunks, run.lines.join(''), JSON.stringify(run.record))).toEqual([]);
    }

    // The same sweep over the shapes that fail, because a failure path is where an implementation echoes a raw
    // error body, a whole session document, or a file it read.
    const failures = [
      await runDoor(['case-get', ...FULL['case-get']], { signInStatus: 403 }),
      await runAct(['grant', ...FULL.grant, '--yes'], () => 'not base64 and not an ERR frame'),
      await runAct(['grant', ...FULL.grant, '--yes'], () => { throw new Error('docker daemon is not running'); }),
      await runDoor(['case-get', '--case', 'not-a-case-ref']),
    ];
    for (const run of failures) {
      expect(run.exit).toBeGreaterThan(0);
      expect(run.chunks.length).toBeGreaterThan(0);
      expect(needleHits(run.printed, ...run.chunks, run.lines.join(''))).toEqual([]);
    }
  });

  it('OD-31 keeps the three slots that must not be printed apart from the two that may only be softened', async () => {
    const refusedSlots = [
      ['a bearer token in the body', { echoed_token: ACCESS }],
      ['a refresh token in the body', { echoed_refresh: REFRESH }],
      ['the operator password in the body', { echoed_password: PASSWORD }],
    ];
    const seen = [];
    for (const [label, answer] of refusedSlots) {
      const run = await runDoor(['case-get', ...FULL['case-get']], { rpc: answer });
      // The line that was about to be printed never is: `lines` keeps only what the operator got, so a second
      // reader of this run's own log cannot recover the dropped line from it.
      seen.push({
        label,
        exit: run.exit,
        refusal: run.refusal,
        answerLineSurvived: run.lines.some((line) => line.includes('case-get: ')),
        fixedSentence: run.printed.includes("refused: this run's own explanation carried a credential, so "
          + 'nothing else was printed.'),
        hits: needleHits(run.printed, ...run.chunks, run.lines.join('')),
      });
    }
    expect(seen).toEqual([
      { label: 'a bearer token in the body', exit: 1, refusal: 'unprintable explanation',
        answerLineSurvived: false, fixedSentence: true, hits: [] },
      { label: 'a refresh token in the body', exit: 1, refusal: 'unprintable explanation',
        answerLineSurvived: false, fixedSentence: true, hits: [] },
      { label: 'the operator password in the body', exit: 1, refusal: 'unprintable explanation',
        answerLineSurvived: false, fixedSentence: true, hits: [] },
    ]);

    // The same shape, softened rather than refused: an answer that carries the operator's own address or the
    // publishable key is still a readable run, with those two words replaced. These two rows are what make the
    // three above a decision about the slot class rather than an artefact of a hostile answer.
    for (const value of [ACCOUNT, PUBLISHABLE]) {
      const run = await runDoor(['case-get', ...FULL['case-get']], { rpc: { echo: value, ok: true } });
      expect(run.exit).toBe(0);
      expect(run.printed).toContain('[redacted]');
      expect(run.printed).not.toContain(value);
      expect(needleHits(run.printed, ...run.chunks)).toEqual([]);
    }

    // The softening is not a general redactor: a value that is not one of the armed slots survives intact, so a
    // case ref or an audit id is never silently blanked on the way into a log.
    const benign = await runDoor(['case-get', ...FULL['case-get']],
      { rpc: { case_ref: CASE_REF, audit_event_id: AUDIT_ROW } });
    expect(benign.exit).toBe(0);
    expect(benign.printed).toContain(CASE_REF);
    expect(benign.printed).toContain(AUDIT_ROW);
    expect(benign.printed).not.toContain('[redacted]');

    // The measured boundary of the guard, recorded rather than papered over: a console act is run as the peer
    // database user and is handed no credential by this tool, so every armed slot is empty and a body that
    // echoes a token prints verbatim. Nothing has leaked *from this run*, and the token an act's body could
    // name is the stack's own answer — which is what the SQL tier's `leak_census` case set is for, owed at the
    // stack rather than provable here.
    const actEcho = await runAct(['grant', ...FULL.grant, '--yes'], { note: ACCESS });
    expect(actEcho.exit).toBe(0);
    expect(actEcho.printed).toContain(ACCESS);
    // The one thing that is still refused on that channel is a connection string, which the printer recognises
    // from its own shape with every slot empty — OD-32 pins that half, so this row is a boundary and not a hole.
    const uriEcho = await runAct(['grant', ...FULL.grant, '--yes'], { note: `postgres://postgres:x@h/d ${ACCESS}` });
    expect(uriEcho.exit).toBe(1);
    expect(uriEcho.refusal).toBe('unprintable explanation');
  });

  it('OD-32 arms the printer at print time, names the slot rather than the secret, and gatekeeps a connection string', () => {
    const leaks = { token: '', address: '' };
    const rec = recorder();
    const printer = makePrinter({
      write: rec.write,
      refuse: () => [['a bearer token', leaks.token]],
      soften: () => [['the operator address', leaks.address]],
    });

    // Before the sign-in returns, the slot is empty and the same text prints. This is the property that makes
    // the guard real: a printer armed once, at construction, would be guarding an empty string for the only
    // answer that ever carries a token.
    expect(printer.print(`token ${ACCESS}`)).toBe(`token ${ACCESS}`);
    leaks.token = ACCESS;
    const error = capturedError(() => printer.print(`token ${ACCESS}`));
    expect(String(error?.message)).toContain('refused: the line this run was about to print carries a bearer token');
    expect(String(error?.message)).not.toContain(ACCESS);
    expect(error?.unprintable).toBe(true);
    expect(error?.exitCode).toBe(1);

    // A refused line reaches neither output, and a slot whose value is empty cannot fire: the second is why
    // `print` tests the value before calling `includes`, since `text.includes('')` is true of everything.
    leaks.token = '';
    expect(printer.print(`token ${ACCESS}`)).toBe(`token ${ACCESS}`);
    expect(rec.printed()).toContain(ACCESS);
    expect(printer.lines.filter((line) => line.includes(ACCESS)).length).toBe(2);

    // Softening happens first and by value, so a refused slot is checked against the text the operator reads.
    leaks.address = ACCOUNT;
    expect(printer.print(`signed in as ${ACCOUNT}`)).toBe('signed in as [redacted]');
    expect(printer.lines[printer.lines.length - 1]).toBe('signed in as [redacted]');

    // The connection-string gate holds with every slot empty, because a URI carrying a user and a password is a
    // credential whatever slot it came from. Two shapes trip it; a location with no authority credential does
    // not, and neither does prose about the database — the gate is a shape, not a ban on the word `postgres`.
    const plain = makePrinter({ write: () => {} });
    for (const uri of ['postgresql://postgres:s3cr3t@127.0.0.1:54321/postgres',
      'postgres://supabase_admin:pw@localhost:5432/postgres']) {
      const thrown = capturedError(() => plain.print(uri));
      expect(String(thrown?.message)).toContain('carries a connection string with a credential in it');
      expect(String(thrown?.message)).not.toContain(uri);
      expect(thrown?.unprintable).toBe(true);
    }
    expect(plain.print('postgres://localhost:5432/postgres')).toBe('postgres://localhost:5432/postgres');
    expect(plain.print('the session ran in the postgres database on the local stack'))
      .toBe('the session ran in the postgres database on the local stack');
  });

  it('OD-33 decodes the console answer exactly, and refuses a line that is neither jsonb nor an ERR frame', async () => {
    const answer = {
      note: 'a "quote", an arrow →, a newline\nand a tab\there',
      keys: ['public/media/a b.png', 'back\\slash'],
      nested: { object_keys: [], 'unicode-é': '✓' },
      audit_id: AUDIT_ROW,
    };
    const run = await runAct(['purge', ...FULL.purge, '--yes'], answer);
    expect(run.exit).toBe(0);
    expect(run.answer).toEqual(answer);
    // The operator reads the payload on one line: the embedded newline stays inside the JSON string as an
    // escape, so none of the body's answer is split across console lines the way a raw text print would do it.
    const payloadLine = run.lines.find((line) => line.startsWith('purge: '));
    expect(payloadLine).toBeDefined();
    expect(payloadLine.includes('\n')).toBe(false);
    expect(JSON.parse(payloadLine.slice('purge: '.length))).toEqual(answer);
    expect(payloadLine).toContain('→');

    // A console that answers with prose is an instrument failure, not an answer, and the prose is not repeated:
    // whatever the stack wrote could itself be the thing that carries a credential.
    const garbage = 'SEVERE: while parsing a row at character 41';
    const refused = await runAct(['grant', ...FULL.grant, '--yes'], () => garbage);
    expect(refused.exit).toBe(1);
    expect(refused.printed).toContain('refused: the console answered with something that is not the JSON it '
      + 'was asked to build, so this run cannot trust what it read.');
    expect(refused.printed).not.toContain('SEVERE');
    expect(refused.record.executed).toBe(false);
    expect(refused.record.exit).toBe(1);
    // `executed: false` alone would be read as "nothing was written", and on this channel that is not what a
    // lost answer proves: the console's `DO` block commits before the client ever looks at the reply. Measured
    // live against the stack, `runPsql` wrapped a wide answer into 11 lines, refused to read it, and had
    // already written the act it then reported as unread.
    expect(refused.record.answer_unreadable_after_send).toBe(true);
    expect(refused.printed).toContain('the statement was already sent when this run lost its answer');
    expect(refused.printed).toContain('do not treat this line as a refusal that wrote nothing');

    // Base64 that decodes to something that is not JSON is refused the same way, whether it names a word or
    // nothing at all: the tool never treats an answer it cannot parse as an empty success.
    for (const line of [Buffer.from('grant', 'utf8').toString('base64'), '']) {
      const decoded = await runAct(['grant', ...FULL.grant, '--yes'], () => line);
      expect(decoded.exit).toBe(1);
      expect(decoded.printed).toContain('not the JSON it was asked to build');
      expect(decoded.record.executed).toBe(false);
    }
  });

  it('OD-34 fails a sign-in with its status alone, after exactly one request and no body read', async () => {
    for (const status of [401, 403, 429]) {
      const run = await runDoor(['case-get', ...FULL['case-get']], { signInStatus: status });
      expect(run.exit).toBe(2);
      expect(run.printed).toContain(`the auth service refused this operator's credentials (HTTP ${status}). `
        + 'Nothing was read from its body, and no call was made.');
      expect(run.printed).not.toContain('Invalid login credentials');
      expect(run.printed).not.toContain(SERVICE_ROLE);
      expect(run.transport.calls.length).toBe(1);
      expect(run.transport.rpcCalls().length).toBe(0);
      expect(run.record.executed).toBe(false);
      expect(run.record.exit).toBe(2);
      expect(needleHits(run.printed, ...run.chunks, JSON.stringify(run.record))).toEqual([]);
    }

    // A session document that is not JSON, and one that is JSON with no token in it, are both instrument
    // failures: the run cannot proceed, and neither sentence quotes what the service actually sent.
    const notJson = await runDoor(['case-get', ...FULL['case-get']], { session: '<html>502 bad gateway</html>' });
    expect(notJson.exit).toBe(1);
    expect(notJson.printed).toContain('refused: the auth service answered 2xx with something that is not a '
      + 'session document.');
    expect(notJson.printed).not.toContain('502 bad gateway');
    const noToken = await runDoor(['case-get', ...FULL['case-get']], { session: { message: 'no token here' } });
    expect(noToken.exit).toBe(1);
    expect(noToken.printed).toContain('refused: the session document carries no access token, so there is '
      + 'nothing to call the doors with.');
    expect(noToken.transport.calls.length).toBe(1);

    // And a transport that never got an answer: the failure sentence names the cause, and the request count is
    // the proof that the tool reported the failure instead of retrying into a stack that was not listening.
    const rec = recorder();
    let attempts = 0;
    const thrown = await runCli({
      argv: doorArgs(['case-get', ...FULL['case-get']]),
      env: ENV,
      fileEnv: FILE_ENV,
      fetchImpl: async () => { attempts += 1; throw new Error('connect ECONNREFUSED 127.0.0.1:54321'); },
      psql: unreachable('the console channel'),
      write: rec.write,
    });
    expect(thrown.exit).toBe(1);
    expect(attempts).toBe(1);
    expect(rec.printed()).toContain('refused: the sign-in request could not be made (connect ECONNREFUSED '
      + '127.0.0.1:54321).');
    expect(needleHits(rec.printed())).toEqual([]);
  });
});

/** `makePrinter` terminates every line it prints, so a whole-line comparison is a comparison of the line
 *  plus its terminator. `line0` checks the terminator and hands back the line; `onlyLine` additionally
 *  checks that the run spoke exactly once, which is the half that tells an operator the refusal was not
 *  followed by a partial plan. A plan-stage refusal (bad flag, bad credential name) prints one line and no
 *  run record; a target-stage refusal prints both, so the two helpers are used in different cells. */
function line0(chunks) {
  expect(chunks[0].endsWith('\n')).toBe(true);
  return chunks[0].slice(0, -1);
}

function onlyLine(chunks) {
  expect(chunks.length).toBe(1);
  return line0(chunks);
}

describe('OD boundary: the command line, the target and the tree decide what this process may become', () => {
  it('OD-40 refuses all nineteen flags that could carry a secret, an amount or a server, before a transport exists', async () => {
    // The frame is transcribed from the tool's own bytes and then pinned back against them, so a wording
    // change fires this cell rather than turning the transcription into the authority.
    const BANNED = (flag) => `refused: --${flag} is not an option this tool has. A credential is named by an `
      + 'environment variable (--secret-env NAME, --account-env NAME), the API target comes from '
      + '.env.local, an amount is decided by the database and a SQL statement is built one cast literal '
      + 'at a time here — never typed in.';
    for (const fragment of [
      'is not an option this tool has. A credential is named by an ',
      'environment variable (--secret-env NAME, --account-env NAME), the API target comes from ',
      '.env.local, an amount is decided by the database and a SQL statement is built one cast literal ',
      'at a time here — never typed in.',
    ]) expect(CLI_TEXT).toContain(fragment);

    expect(new Set(FORBIDDEN_FLAGS).size).toBe(FORBIDDEN_FLAGS.length);
    expect(FORBIDDEN_FLAGS.length).toBe(19);
    const rows = [];
    for (const flag of FORBIDDEN_FLAGS) {
      for (const verb of ['case-get', 'grant']) {
        for (const [spelling, extra] of [['bare', [`--${flag}`]], ['assigned', [`--${flag}=a-value`]]]) {
          const run = await runQuiet(verb, [...FULL[verb], ...extra]);
          rows.push({ flag, verb, spelling, exit: run.exit, refusal: run.refusal, line: onlyLine(run.chunks),
            hasRecord: run.record !== undefined, psql: run.touched.psql, fetch: run.touched.fetch });
        }
      }
    }
    // Seventy-six command lines: nineteen names, both channels, both spellings. Every one is a designed
    // refusal that prints one line, writes no record and reaches neither transport.
    expect(rows.length).toBe(19 * 2 * 2);
    expect(rows.map((row) => `${row.exit}|${row.hasRecord}|${row.psql}|${row.fetch}`))
      .toEqual(rows.map(() => '2|false|0|0'));
    for (const row of rows) {
      expect(row.line).toBe(BANNED(row.flag));
      // The line the operator sees and the message the run carried out are the same sentence, so a log
      // capture and a returned error cannot disagree about which flag was refused.
      expect(row.line).toBe(row.refusal);
    }
    // Each flag earns its own sentence, naming that flag: a list refused with one generic message would
    // leave an operator unable to tell which of two typos the run saw.
    expect(new Set(rows.map((row) => row.refusal)).size).toBe(19);

    // The banned list never quotes the value, so the mistake it refuses cannot be written into the refusal.
    const echo = await runQuiet('grant', [...FULL.grant, `--password=${PASSWORD}`]);
    expect(echo.refusal).toBe(BANNED('password'));
    expect(echo.printed).not.toContain(PASSWORD);

    // The three flags this tool does have for the same purposes are not on the list, and two of them are
    // spelled as a banned flag plus `-env` — the asymmetry a reviewer is entitled to see stated.
    const ALLOWED_META = ['account-env', 'secret-env', 'via-docker', 'key', 'yes', 'dry-run', 'help'];
    expect(ALLOWED_META.filter((name) => FORBIDDEN_FLAGS.includes(name))).toEqual([]);
    expect(FORBIDDEN_FLAGS).toContain('account');
    expect(FORBIDDEN_FLAGS).toContain('secret');
    expect(ALLOWED_META.filter((name) => FORBIDDEN_FLAGS.some((flag) => name.startsWith(`${flag}-`))))
      .toEqual(['account-env', 'secret-env']);
    const doorPlan = await runQuiet('privacy-advance', [...FULL['privacy-advance'], '--dry-run']);
    expect(doorPlan.exit).toBe(0);
    expect(doorPlan.touched).toEqual({ psql: 0, fetch: 0 });
    const actPlan = await runQuiet('grant', [...FULL.grant, '--dry-run']);
    expect(actPlan.exit).toBe(0);
    expect(actPlan.touched).toEqual({ psql: 0, fetch: 0 });

    // The usage line's list is a subset, not the scope. The twelve names it does not speak are refused by
    // the sweep above, and none of them is an option any verb declares — so the list could be widened into
    // the sentence without shadowing a real flag.
    const rec = recorder();
    const help = await runCli({ argv: ['--help'], env: {}, fileEnv: {}, psql: unreachable('the console channel'),
      fetchImpl: unreachable('the operator channel'), write: rec.write });
    expect(help.exit).toBe(0);
    const listed = /^ {2}there is no (.+?): see the header\./m.exec(line0(rec.chunks));
    expect(listed).not.toBeNull();
    const named = listed[1].match(/--[a-z-]+/g);
    expect(named).toEqual(['--email', '--token', '--service-key', '--url', '--api-origin', '--price', '--sql']);
    expect(named.map((flag) => flag.slice(2)).filter((name) => !FORBIDDEN_FLAGS.includes(name))).toEqual([]);
    const omitted = FORBIDDEN_FLAGS.filter((name) => !named.includes(`--${name}`));
    expect(omitted).toEqual(['account', 'secret', 'password', 'apikey', 'anon-key', 'anonkey',
      'publishable-key', 'amount', 'db-url', 'origin', 'host', 'webhook-secret']);
    expect(omitted.length).toBe(12);
    const declaredOptions = new Set(Object.values(VERBS).flatMap((spec) => spec.args.map((arg) => arg.opt)));
    expect(omitted.filter((name) => declaredOptions.has(name))).toEqual([]);
  });

  it('OD-41 reads the two names it is handed from .env.local and cannot be argued into a third', () => {
    const ALLOWED = ['SUPABASE_LOCAL_URL', 'SUPABASE_LOCAL_PUBLISHABLE_KEY'];
    // The hostile file is shaped like the real one on this machine: the same keys, the same three secrets
    // the header comment refuses to read, and the connection string that carries the database password.
    const file = [
      '# local stack, five secrets on one machine',
      `VITE_SUPABASE_URL=${LOOPBACK}`,
      `SUPABASE_LOCAL_URL=${LOOPBACK}`,
      'SUPABASE_LOCAL_PUBLISHABLE_KEY="quoted-publishable-key"',
      '',
      `SUPABASE_LOCAL_SERVICE_ROLE_KEY=${SERVICE_ROLE}`,
      'SUPABASE_LOCAL_SECRET_KEY=secret-key-never-read',
      '   SUPABASE_LOCAL_DB_URL=postgres://postgres:db-password-never-read@127.0.0.1:54322/postgres   ',
      'A_LINE_WITH_NO_EQUALS_SIGN',
      '=a_value_with_no_name',
      'SUPABASE_LOCAL_PUBLISHABLE_KEY_TRAILING=sb-not-this-name',
    ].join('\r\n');
    const out = readEnvFile(file, ALLOWED);
    expect(out).toEqual({ SUPABASE_LOCAL_URL: LOOPBACK, SUPABASE_LOCAL_PUBLISHABLE_KEY: 'quoted-publishable-key' });
    const asText = JSON.stringify(out);
    for (const secret of [SERVICE_ROLE, 'secret-key-never-read', 'db-password-never-read', '54322']) {
      expect(asText).not.toContain(secret);
    }
    // Presence control: the reader is not blind. Widen the allowlist and the service-role key arrives, so
    // what keeps the credential out of this process is the two-name list at the call site, not a limit of
    // `readEnvFile` that could silently stop working.
    expect(readEnvFile(file, [...ALLOWED, 'SUPABASE_LOCAL_SERVICE_ROLE_KEY']))
      .toEqual({ ...out, SUPABASE_LOCAL_SERVICE_ROLE_KEY: SERVICE_ROLE });
    expect(readEnvFile(file, [])).toEqual({});
    expect(readEnvFile('', ALLOWED)).toEqual({});
    expect(readEnvFile(file.replace(/\r\n/g, '\n'), ALLOWED)).toEqual(out);

    // The three shapes a hand-edited file actually produces, measured rather than assumed: a later line of
    // the same key wins, and its blank value wins too, which is how OD-44's `""` refusal row is reached;
    // padding around a name is trimmed and significant; single quotes are content, not delimiters.
    expect(readEnvFile([`SUPABASE_LOCAL_URL=${LOOPBACK}`, 'SUPABASE_LOCAL_URL='].join('\n'), ALLOWED))
      .toEqual({ SUPABASE_LOCAL_URL: '' });
    expect(readEnvFile(` SUPABASE_LOCAL_URL = ${LOOPBACK} `, ALLOWED)).toEqual({ SUPABASE_LOCAL_URL: LOOPBACK });
    expect(readEnvFile(`SUPABASE_LOCAL_URL='${LOOPBACK}'`, ALLOWED))
      .toEqual({ SUPABASE_LOCAL_URL: `'${LOOPBACK}'` });
    expect(readEnvFile(`SUPABASE_LOCAL_URL=${LOOPBACK}/auth/v1/token?grant_type=password`, ALLOWED))
      .toEqual({ SUPABASE_LOCAL_URL: `${LOOPBACK}/auth/v1/token?grant_type=password` });

    // Source-level: the file names two `SUPABASE_*` identifiers, anywhere at all, and the word
    // `service-role` only in prose. A third name added to the reader would show up here first.
    expect([...new Set(CLI_TEXT.match(/SUPABASE_[A-Z0-9_]+/g))].sort())
      .toEqual(['SUPABASE_LOCAL_PUBLISHABLE_KEY', 'SUPABASE_LOCAL_URL']);
    expect(CLI_TEXT).not.toContain('SERVICE_ROLE');
    expect(CLI_TEXT.split('\n').filter((line) => line.includes('service-role'))
      .every((line) => /^\s*(\/\/|\*)/.test(line))).toBe(true);
    expect(CLI_TEXT.match(/readEnvFile\(/g).length).toBe(2);
    expect(CLI_TEXT).toMatch(/readEnvFile\(readText\(resolve\('\.env\.local'\)\),\s*\['SUPABASE_LOCAL_URL', 'SUPABASE_LOCAL_PUBLISHABLE_KEY'\]\)/);
  });

  it('OD-42 makes exactly two loopback requests per door, with the plan it printed as the body', async () => {
    const doors = Object.entries(VERBS).filter(([, spec]) => spec.channel === 'http');
    expect(doors.length).toBe(13);
    const rpcUrls = [];
    for (const [verb, spec] of doors) {
      const run = await runDoor([verb, ...FULL[verb], '--yes']);
      expect(run.exit).toBe(0);
      const calls = run.transport.calls;
      expect(calls.length).toBe(2);
      const [signIn, rpc] = calls;
      expect(`${signIn.url}|${signIn.init.method}`).toBe(`${LOOPBACK}/auth/v1/token?grant_type=password|POST`);
      expect(signIn.init.headers).toEqual({ apikey: PUBLISHABLE, 'Content-Type': 'application/json' });
      expect(JSON.parse(signIn.init.body)).toEqual({ email: ACCOUNT, password: PASSWORD });
      expect(rpc.url).toBe(`${LOOPBACK}/rest/v1/rpc/${spec.fn}`);
      expect(rpc.init.method).toBe('POST');
      expect(rpc.init.headers).toEqual({ apikey: PUBLISHABLE, Authorization: `Bearer ${ACCESS}`,
        'Content-Type': 'application/json', 'Content-Profile': 'api' });
      for (const url of [signIn.url, rpc.url]) {
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:54321\/(auth\/v1\/token\?grant_type=password|rest\/v1\/rpc\/[0-9a-z_]+)$/);
      }
      rpcUrls.push(rpc.url);

      // The body is the plan, parameter for parameter, in the order the declaration lists them. The one
      // value allowed to differ is the minted key, and it must differ: two runs of the same command line
      // are two acts, not one act replayed.
      const plan = planOf(verb, [...FULL[verb], '--yes']);
      const body = JSON.parse(rpc.init.body);
      expect(Object.keys(body)).toEqual(Object.keys(plan.params));
      for (const key of Object.keys(body)) {
        if (key === 'p_idempotency_key') {
          expect(body[key]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
          expect(body[key]).not.toBe(plan.params[key]);
        } else expect(body[key]).toEqual(plan.params[key]);
      }

      // The password is sent, because signing in is the point; it is not printed, because the log is not a
      // place a credential belongs. Both halves in one cell so neither can be read as the other.
      expect(signIn.init.body).toContain(PASSWORD);
      expect(run.printed).not.toContain(PASSWORD);
      expect(needleHits(run.printed, JSON.stringify(run.record))).toEqual([]);
    }
    // The census the two assertions above are a list of: thirteen doors, and no act or intake name anywhere.
    expect([...new Set(rpcUrls)].sort())
      .toEqual(doorNames.map((name) => `${LOOPBACK}/rest/v1/rpc/${name}`));
    expect(actNames.length).toBe(3);
    expect(HOST_INTAKE_DOORS.length).toBe(6);
    expect([...actNames, ...HOST_INTAKE_DOORS].filter((name) => rpcUrls.some((url) => url.endsWith(`/rpc/${name}`))))
      .toEqual([]);
    expect(rpcUrls.filter((url) => !url.startsWith(`${LOOPBACK}/`))).toEqual([]);
  });

  it('OD-43 refuses a credential flag that is missing, bare, misnamed or empty, and never repeats the value', async () => {
    const credRun = async (flags, env = ENV) => {
      const rec = recorder();
      const transport = silentTransport();
      const result = await runCli({ argv: ['case-get', '--case', CASE_REF, ...flags], env, fileEnv: FILE_ENV,
        fetchImpl: transport.fetchImpl, psql: transport.psql, write: rec.write });
      return { exit: result.exit, chunks: rec.chunks, printed: rec.printed(), refusal: result.refusal,
        touched: transport.touched };
    };
    const ABSENT = (flag) => `refused: --${flag} is not on this command line at all, and there is no default `
      + 'for it. Add the name of the environment variable that holds the value.';
    const BARE = (flag) => `refused: --${flag} was given with no environment variable name after it.`;
    const RULE_HEAD = (flag) => `refused: --${flag} wants the NAME of an environment variable (an uppercase `
      + 'identifier such as S11_OPERATOR_PASSWORD), and got ';
    const RULE_TAIL = '. The value itself never belongs on a command line.';
    const SHAPE = (value) => {
      const first = value.slice(0, 1);
      const kind = /^[A-Z]$/.test(first) ? 'an uppercase letter'
        : /^[a-z]$/.test(first) ? 'a lowercase letter'
          : /^[0-9]$/.test(first) ? 'a digit' : 'a character that is neither a letter nor a digit';
      return `${value.length} character(s) beginning with ${kind}`;
    };
    const UNSET = (label, name) => `refused: the ${label} is read from the environment variable ${name}, and `
      + 'that variable is unset or blank. This tool takes a credential from no other place and falls back to '
      + 'no other value.';
    const BOTH = ['--account-env', 'S11_OPERATOR_EMAIL', '--secret-env', 'S11_OPERATOR_PASSWORD'];

    // Four character classes, one row each. Whole-sentence equality is the echo test: the expected line is
    // built from the flag name, the length and the class of the first character, so a run that quoted the
    // typed value back could not produce this string. (`_OPERATOR` is a substring of the example identifier
    // inside the sentence, which is why the assertion is equality and not `not.toContain(value)`.)
    for (const value of ['AB_C-D', 's11_operator_password', '1A_OPERATOR', '_OPERATOR']) {
      const run = await credRun(['--account-env', value, '--secret-env', 'S11_OPERATOR_PASSWORD']);
      expect(run.exit).toBe(2);
      expect(onlyLine(run.chunks)).toBe(`${RULE_HEAD('account-env')}${SHAPE(value)}${RULE_TAIL}`);
      expect(run.touched).toEqual({ psql: 0, fetch: 0 });
    }

    // The repair this cell exists to hold: a password typed into the slot that should name its variable is
    // refused without quoting it, on either credential flag. Each row is the value, the flag it was put
    // into, and the sentence that must name only its shape.
    const leakRows = [
      [PASSWORD, 'secret-env', ['--account-env', 'S11_OPERATOR_EMAIL', '--secret-env', PASSWORD]],
      [ACCOUNT, 'account-env', ['--account-env', ACCOUNT, '--secret-env', 'S11_OPERATOR_PASSWORD']],
      ['synthetic-Pass-Word-0001', 'secret-env', ['--account-env', 'S11_OPERATOR_EMAIL',
        '--secret-env', 'synthetic-Pass-Word-0001']],
    ];
    for (const [value, flag, flags] of leakRows) {
      const run = await credRun(flags);
      expect(run.exit).toBe(2);
      expect(onlyLine(run.chunks)).toBe(`${RULE_HEAD(flag)}${SHAPE(value)}${RULE_TAIL}`);
      expect(needleHits(run.printed)).toEqual([]);
      expect(run.touched).toEqual({ psql: 0, fetch: 0 });
    }

    // The three ways a flag can carry no name, and the two ways the named variable can be empty. All seven
    // are designed refusals that print one line and reach neither transport; `--account-env=` is the shape
    // that reaches the bare-flag sentence rather than the shape sentence, because the empty value is caught
    // before the pattern is tried.
    const missingRows = [
      [[], ABSENT('account-env')],
      [['--account-env', 'S11_OPERATOR_EMAIL'], ABSENT('secret-env')],
      [['--secret-env', 'S11_OPERATOR_PASSWORD'], ABSENT('account-env')],
      [['--account-env', '--secret-env', 'S11_OPERATOR_PASSWORD'], BARE('account-env')],
      [['--account-env', 'S11_OPERATOR_EMAIL', '--secret-env'], BARE('secret-env')],
      [['--account-env=', '--secret-env=S11_OPERATOR_PASSWORD'], BARE('account-env')],
    ];
    for (const [flags, message] of missingRows) {
      const run = await credRun(flags);
      expect(run.exit).toBe(2);
      expect(onlyLine(run.chunks)).toBe(message);
      expect(run.refusal).toBe(message);
      expect(run.touched).toEqual({ psql: 0, fetch: 0 });
      expect(needleHits(run.printed)).toEqual([]);
    }
    for (const [flags, label, name] of [
      [['--account-env', 'NOT_SET_ANYWHERE', '--secret-env', 'S11_OPERATOR_PASSWORD'], "operator's own address", 'NOT_SET_ANYWHERE'],
      [['--account-env', 'S11_OPERATOR_EMAIL', '--secret-env', 'NOT_SET_ANYWHERE'], "operator's own password", 'NOT_SET_ANYWHERE'],
      [['--account-env', 'S11_OPERATOR_EMAIL', '--secret-env', 'BLANK'], "operator's own password", 'BLANK'],
      [['--account-env', 'S11_OPERATOR_EMAIL', '--secret-env', 'ZERO'], "operator's own password", 'ZERO'],
      [['--account-env', 'S11_OPERATOR_EMAIL', '--secret-env', 'NUMBER'], "operator's own password", 'NUMBER'],
    ]) {
      const run = await credRun(flags, { ...ENV, BLANK: '   ', ZERO: '', NUMBER: 42 });
      expect(run.exit).toBe(2);
      expect(onlyLine(run.chunks)).toBe(UNSET(label, name));
      expect(run.touched).toEqual({ psql: 0, fetch: 0 });
    }
    // One variable for both purposes is refused by its own sentence, and it is the read of the *names* that
    // fails — neither value has been looked up yet, so the address is not in the line either.
    const sameVar = await credRun(['--account-env', 'S11_OPERATOR_EMAIL', '--secret-env', 'S11_OPERATOR_EMAIL']);
    expect(sameVar.exit).toBe(2);
    expect(onlyLine(sameVar.chunks)).toBe('refused: --account-env and --secret-env name the same variable, so '
      + 'the address and the password would be one value. Two variables, two purposes.');
    expect(sameVar.printed).not.toContain(ACCOUNT);

    // The boundary the masking stops at: a value that passes the identifier pattern *is* a name as far as
    // this tool can tell, so the unset-variable sentence speaks it. An operator whose password is a legal
    // uppercase identifier would see it named here, and the rule that decides that is `ENV_NAME`, not a
    // judgement about bytes. Recorded rather than wished away.
    const identifierShapedSecret = 'SYNTHETIC_PASSWORD_0001';
    const boundary = await credRun(['--account-env', 'S11_OPERATOR_EMAIL', '--secret-env', identifierShapedSecret]);
    expect(onlyLine(boundary.chunks)).toBe(UNSET("operator's own password", identifierShapedSecret));

    // The happy read: four facts, trimmed, and nothing else leaves the function. The run itself is a dry
    // run, because a read door with a real transport behind it is not a test of credential reading.
    const read = readOperatorCredentials(parseArgs(BOTH), { ...ENV, S11_OPERATOR_EMAIL: `  ${ACCOUNT}  `,
      S11_OPERATOR_PASSWORD: `${PASSWORD}\n` });
    expect(Object.keys(read).sort()).toEqual(['account', 'accountEnv', 'password', 'secretEnv']);
    expect(read).toEqual({ accountEnv: 'S11_OPERATOR_EMAIL', secretEnv: 'S11_OPERATOR_PASSWORD',
      account: ACCOUNT, password: PASSWORD });
    const happy = await credRun([...BOTH, '--dry-run']);
    expect(happy.exit).toBe(0);
    expect(happy.touched).toEqual({ psql: 0, fetch: 0 });
    expect(happy.printed).toContain('case-get: plan only');
  });

  it('OD-44 addresses only a loopback origin, and decides that before a request exists', async () => {
    const target = async (fileEnv) => {
      const rec = recorder();
      const urls = [];
      const result = await runCli({
        argv: lineFor('case-get', FULL['case-get']),
        env: ENV,
        fileEnv: { SUPABASE_LOCAL_PUBLISHABLE_KEY: PUBLISHABLE, ...fileEnv },
        fetchImpl: async (url) => {
          urls.push(String(url));
          // A session document for the token endpoint and an answer for the door, because a transport that
          // answers both the same way is refused by the tool's own "no access token" rule and the cell would
          // then be measuring its own fixture rather than the origin decision it is about.
          const body = url.includes('/auth/v1/token')
            ? { access_token: ACCESS, refresh_token: REFRESH }
            : { answered: true };
          return { ok: true, status: 200, text: async () => JSON.stringify(body) };
        },
        psql: unreachable('the console channel'),
        write: rec.write,
      });
      return { exit: result.exit, chunks: rec.chunks, urls, printed: rec.printed(), first: line0(rec.chunks) };
    };
    const URL_HEAD = 'refused: SUPABASE_LOCAL_URL in .env.local is ';
    const HOSTED_MSG = 'refused: SUPABASE_LOCAL_URL in .env.local names a hosted project. This instrument '
      + 'writes only to the local stack, and a hosted target is not the local stack under another address.';

    // Accepted, each with exactly the two requests a door makes behind it and nothing else. The three
    // unusual spellings are accepted for the reason the URL parser accepts them: `[::1]` and `localhost`
    // are in the tool's own set, and the compressed IPv4 form arrives already normalised to `127.0.0.1`,
    // which is also in it.
    for (const url of [LOOPBACK, 'http://localhost:54321', 'http://[::1]:54321', 'http://127.1:54321',
      'http://LocalHost:54321']) {
      const run = await target({ SUPABASE_LOCAL_URL: url });
      expect(run.exit).toBe(0);
      expect(run.urls).toEqual([`${url}/auth/v1/token?grant_type=password`,
        `${url}/rest/v1/rpc/${VERBS['case-get'].fn}`]);
      expect(run.printed).toContain('signed in as the account named by --account-env');
      // The origin decision and the printing rule are independent, and both have to hold on the same run:
      // a loopback spellings' success path is also a run whose session this log must not carry.
      expect(needleHits(run.printed)).toEqual([]);
    }

    // Refused, each with zero contact. The sentences are the tool's, and they differ because the reasons do:
    // a hosted project is not the local stack under another address, and a host that is merely not loopback
    // has never been claimed to be one. A target-stage refusal is two lines — the sentence and the run
    // record — which is the difference OD-43's plan-stage refusals pin from the other side.
    const hosted = await target({ SUPABASE_LOCAL_URL: 'https://abc-def.supabase.co' });
    expect(CLI_TEXT).toContain('names a hosted project. This instrument writes only to the local ');
    expect(hosted.exit).toBe(2);
    expect(hosted.urls).toEqual([]);
    expect(hosted.first).toBe(HOSTED_MSG);
    expect(hosted.chunks.length).toBe(2);
    expect(hosted.chunks[1].startsWith('run record: ')).toBe(true);
    for (const [url, host] of [['http://10.0.0.5:54321', '10.0.0.5'],
      ['http://localhost.evil.test:54321', 'localhost.evil.test'],
      ['http://192.168.1.7:54321', '192.168.1.7'], ['http://localvivaahvarnam:54321', 'localvivaahvarnam']]) {
      const run = await target({ SUPABASE_LOCAL_URL: url });
      expect(run.exit).toBe(2);
      expect(run.urls).toEqual([]);
      expect(run.first).toBe(`refused: SUPABASE_LOCAL_URL in .env.local has host ${host}. `
        + 'Only a loopback address is the local stack.');
    }
    for (const [value, quoted] of [['not a url at all', '"not a url at all"'], ['', '""'],
      [undefined, '"undefined"']]) {
      const run = await target({ SUPABASE_LOCAL_URL: value });
      expect(run.exit).toBe(2);
      expect(run.urls).toEqual([]);
      expect(run.first).toBe(`${URL_HEAD}${quoted}, which does not parse as a URL, so there is no server to `
        + 'address.');
    }

    // The hosted test reads the whole origin string, so a loopback URL that spells the hosted domain in a
    // path or a query is refused with the hosted sentence even though the loopback test would have caught it
    // too. Measured and recorded: the run refuses either way, and the sentence it prints is the stronger one.
    for (const url of ['http://127.0.0.1:54321/supabase.co', 'http://127.0.0.1:54321?target=supabase.io',
      'http://supabase.co.localhost:54321']) {
      const run = await target({ SUPABASE_LOCAL_URL: url });
      expect(run.exit).toBe(2);
      expect(run.urls).toEqual([]);
      expect(run.first).toBe(HOSTED_MSG);
    }

    // The second line of the file is guarded by its own sentence, and it is an instrument failure rather
    // than a designed refusal: a stack with no publishable key is a broken target, not a wrong command line.
    const noKey = await target({ SUPABASE_LOCAL_URL: LOOPBACK, SUPABASE_LOCAL_PUBLISHABLE_KEY: '' });
    expect(noKey.exit).toBe(1);
    expect(noKey.urls).toEqual([]);
    expect(noKey.first).toBe('refused: .env.local carries no SUPABASE_LOCAL_PUBLISHABLE_KEY, so this run '
      + 'cannot address the local API.');
    for (const run of [hosted, noKey]) expect(needleHits(run.printed)).toEqual([]);
  });

  it('OD-45 keeps the sixteen operator names out of the shipped bundle, measured against the rule and the tree', () => {
    const id = 'operator-rpc-referenced-outside-cli';
    const rule = RULES.find((row) => row.id === id);
    expect(rule).toBeDefined();
    expect(rule.scope).toEqual(['src/']);
    expect(rule.exclude).toEqual(['src/integrations/supabase/types.ts']);
    expect(rule.pattern.source).toBe('\\b(?:get_|grant_|revoke_)?operator_[a-z0-9_]+\\b');
    expect(rule.pattern.global).toBe(true);
    expect(rule.fix).toContain(CLI_PATH);
    expect(rule.message).toContain('§10');
    expect(selfTest()).toEqual([]);

    const allSixteen = [...doorNames, ...actNames].sort();
    expect(allSixteen.length).toBe(16);
    for (const name of allSixteen) {
      const hits = scanContent('src/integrations/operations.ts', `export const call = () => api.${name}({});\n`)
        .filter((violation) => violation.rule === id);
      expect(hits.map((hit) => [hit.line, hit.matched])).toEqual([[1, name]]);
    }
    // The two silences, on the same sixteen names: the tool that is allowed to speak them, and the generated
    // catalogue that will name them the moment the chain is applied and that nobody wrote.
    expect(allSixteen.map((name) => scanContent(CLI_PATH, `api.${name}({});\n`)
      .filter((violation) => violation.rule === id).length)).toEqual(allSixteen.map(() => 0));
    expect(allSixteen.map((name) => scanContent('src/integrations/supabase/types.ts', `  ${name}: never;\n`)
      .filter((violation) => violation.rule === id).length)).toEqual(allSixteen.map(() => 0));
    // …and the exclusion is a decision about this rule, not a blind spot: the same path is inside the
    // scanned tree, and the CLI is outside it altogether.
    expect(isScannedPath('src/integrations/supabase/types.ts')).toBe(true);
    expect(isScannedPath(CLI_PATH)).toBe(false);

    const src = walkScanned('src');
    expect(src.length).toBeGreaterThan(0);
    expect(src.flatMap((file) => scanContent(file.relativePath, file.text))
      .filter((violation) => violation.rule === id)).toEqual([]);
  });

  it('OD-46 has no product path to this instrument, and the migration chain names the only two readers', () => {
    const referenced = walkScanned('src').filter((file) => file.text.includes(CLI_PATH));
    expect(referenced.map((file) => file.relativePath)).toEqual([]);
    expect(walkScanned('src').length).toBeGreaterThan(0);

    // Presence control: the name really is written down, once in each of two Stage 11 migrations, and each
    // mention is the kind it claims to be — a comment about the console channel, and the takedown plan's own
    // `delete_channel` payload. A search that finds nothing in `src/` proves something only if it can find
    // the same string somewhere else.
    const authority = STAGE_FILES.find((file) => file.name === '20261020190000_stage11_operator_authority.sql');
    const oversight = STAGE_FILES.find((file) => file.name === '20261020190400_stage11_takedown_and_oversight.sql');
    expect(authority).toBeDefined();
    expect(oversight).toBeDefined();
    const authorityLines = authority.text.split('\n').filter((line) => line.includes(CLI_PATH));
    expect(authorityLines.length).toBe(1);
    expect(authorityLines[0].trimStart().startsWith('--')).toBe(true);
    const oversightLines = oversight.text.split('\n').filter((line) => line.includes(CLI_PATH));
    expect(oversightLines.length).toBe(1);
    expect(oversightLines[0]).toContain("'delete_channel'");
    expect(STAGE_FILES.filter((file) => file.text.includes(CLI_PATH)).map((file) => file.name).sort())
      .toEqual([authority.name, oversight.name]);

    // The security document is the third place the name appears, and it is prose: the census is over the
    // code that could reach a door, and this file is that census rather than a comment about it.
    expect(readFileSync(resolve(process.cwd(), 'docs/architecture/operations-admin-security.md'), 'utf8'))
      .toContain(CLI_PATH);
  });
});

describe('OD census, verdicts and surface: the numbers a run may print and the names it may hold', () => {
  /** A throwaway directory holding exactly the file names one census row needs. The path comes from
   *  `mkdtempSync`, so the recursive remove at the end of the cell can only ever reach a directory this cell
   *  made; nothing in the repository or in another project's state is inside it. */
  function censusFixture(names) {
    const dir = mkdtempSync(join(tmpdir(), 's11-census-'));
    for (const name of names) writeFileSync(join(dir, name), '-- synthetic, read by the census and nothing else\n');
    return dir;
  }

  it('OD-50 counts migration files the way §9 promises, and reports a name it cannot place', () => {
    const MIXED = censusFixture(['20260101000000_alpha.sql', '20260102000000_beta.sql',
      'not_a_versioned_name.sql', 'README.md', 'notes.txt']);
    const THREE = censusFixture(['20260103000000_gamma.sql', '20260101000000_alpha.sql',
      '20260102000000_beta.sql']);
    const EMPTY = censusFixture([]);
    try {
      // Four `.sql` names, one of them without the fourteen-digit version: the uncounted file is reported,
      // never dropped — a census that quietly skips a file is how a pending migration stops being visible.
      expect(readMigrationCensus(MIXED)).toEqual({ read: true, dir: MIXED, files: 3,
        highest: '20260102000000', unversioned: 1 });
      // Highest is the maximum, not the last entry readdir happened to return, so the three names above are
      // deliberately written out of order.
      expect(readMigrationCensus(THREE)).toEqual({ read: true, dir: THREE, files: 3,
        highest: '20260103000000', unversioned: 0 });
      expect(readMigrationCensus(EMPTY)).toEqual({ read: true, dir: EMPTY, files: 0,
        highest: null, unversioned: 0 });

      // The two shapes the version rule refuses, both of them counted and neither of them highest: a name
      // with the digits but no `_`, and a name with fifteen digits.
      const ODD = censusFixture(['20260101000000.sql', '202601010000000_seven.sql', '20260101000000_ok.sql']);
      try {
        expect(readMigrationCensus(ODD)).toEqual({ read: true, dir: ODD, files: 3,
          highest: '20260101000000', unversioned: 2 });
      } finally {
        rmSync(ODD, { recursive: true, force: true });
      }

      // A directory that is not there: an instrument failure would be the wrong shape for this, because the
      // census is a decoration on the health answer. It comes back unread, with the reason, and no throw.
      const missing = join(EMPTY, 'no-such-directory');
      const unread = readMigrationCensus(missing);
      expect(unread.read).toBe(false);
      expect(unread.dir).toBe(missing);
      expect(typeof unread.reason).toBe('string');
      expect(unread.reason.length).toBeGreaterThan(0);
      expect(unread.reason.length).toBeLessThanOrEqual(200);
      expect(Object.keys(unread).sort()).toEqual(['dir', 'read', 'reason']);
      // Presence control: the same reader on a directory that does exist reports no reason at all, so the
      // `reason` field is a property of the failure and not a leftover.
      expect(Object.keys(readMigrationCensus(THREE)).sort())
        .toEqual(['dir', 'files', 'highest', 'read', 'unversioned']);
    } finally {
      for (const dir of [MIXED, THREE, EMPTY]) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OD-51 prints the two migration figures side by side, or says which one it does not have', () => {
    const dir = censusFixture(['20260101000000_alpha.sql', '20260102000000_beta.sql', 'loose.sql']);
    const missing = join(dir, 'no-such-directory');
    // The sentence tails are transcribed from the tool's own bytes and pinned back against them, so a reword
    // fires this cell instead of turning the transcription into the authority. Two of them are written in the
    // source as a concatenation across a line break, so each is pinned in the pieces the source spells: the
    // joined runtime sentence is the `toBe` cells below, and a guard that demanded a whole sentence out of a
    // line-wrapped literal would measure this file's own wrapping rather than the tool's wording.
    for (const fragment of [
      'A count of files is not a count of applied ',
      'migrations, and this run says so instead of implying the pair matched.',
      'This run prints one figure and refuses to compare it to a number ',
      'it does not have — "the counts agree" is not available from a directory that could not be read.',
      'The two figures are equal, which is the state the chain should be in.',
      'read supabase_migrations.schema_migrations for the versions, because this projection ',
    ]) expect(CLI_TEXT).toContain(fragment);
    try {
      // Three files, one of them unversioned — the clause has to be spoken, not merely available.
      const DISK = '3 file(s) on disk under ';
      const UNVERSIONED = ', 1 of them not named with a 14-digit version';

      const noBlock = describeCensus({}, dir);
      expect(noBlock).toBe(`migrations: ${DISK}${dir}, highest version 20260102000000${UNVERSIONED}; the `
        + "database's own answer is not_measured — the projection named no reason. A count of files is not a "
        + 'count of applied migrations, and this run says so instead of implying the pair matched.');

      const measured = describeCensus({ blocks: { migrations: { status: 'not_measured',
        reason: 'the chain was never pushed to this stack' } } }, dir);
      expect(measured).toBe(`migrations: ${DISK}${dir}, highest version 20260102000000${UNVERSIONED}; the `
        + "database's own answer is not_measured — the chain was never pushed to this stack. A count of files "
        + 'is not a count of applied migrations, and this run says so instead of implying the pair matched.');

      const equal = describeCensus({ blocks: { migrations: { status: 'measured', applied_count: 3,
        highest_version: '20260102000000' } } }, dir);
      expect(equal).toBe(`migrations: applied 3 (highest version 20260102000000), and ${DISK}${dir}, `
        + `highest version 20260102000000${UNVERSIONED}. The two figures are equal, which is the state the `
        + 'chain should be in.');

      const differ = describeCensus({ blocks: { migrations: { status: 'measured', applied_count: 31,
        highest_version: '20260101000000' } } }, dir);
      expect(differ).toBe(`migrations: applied 31 (highest version 20260101000000), and ${DISK}${dir}, `
        + `highest version 20260102000000${UNVERSIONED}. They differ, which is the difference between a `
        + 'migration in the repository and a migration on the stack — read '
        + 'supabase_migrations.schema_migrations for the versions, because this projection answers a count '
        + 'and a maximum, not a list.');

      // A count with no highest version on the database side is still a count, and it prints `(none)` rather
      // than the disk figure it could have borrowed.
      const noVersion = describeCensus({ blocks: { migrations: { status: 'measured', applied_count: 2 } } }, dir);
      expect(noVersion.startsWith('migrations: applied 2 (highest version (none)), and ')).toBe(true);

      // The unreadable-directory arm: one figure, and the sentence refuses the comparison out loud. The
      // reason string inside it is the reader's own (OD-50 pins what that reader promises), because a Node
      // error message is not something this file should retype.
      const unread = readMigrationCensus(missing);
      expect(unread.read).toBe(false);
      const alone = describeCensus({ blocks: { migrations: { status: 'measured', applied_count: 37,
        highest_version: '20261020190500' } } }, missing);
      expect(alone).toBe(`migrations: applied 37 (highest version 20261020190500), and the files under `
        + `${missing} could not be read (${unread.reason}), so this run prints one figure rather than the `
        + 'pair. This run prints one figure and refuses to compare it to a number it does not have — "the '
        + 'counts agree" is not available from a directory that could not be read.');

      // The pair no arm may produce: neither sentence above says the figures agree when only one was read,
      // and a `not_measured` answer never lends the stack a number of its own.
      expect(alone).not.toContain('The two figures are equal');
      expect(noBlock).not.toContain('migrations: applied ');
      expect(noBlock).not.toContain('They differ');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('OD-52 reads this repository as it is and wires both census verdicts into a run', async () => {
    // The real tree, re-derived by a reader that does not share the tool's regular expression: `FILES` came
    // from `readdirSync` filtered to `.sql`, so the count is independent of `readMigrationCensus` even
    // though it must agree with it.
    const real = readMigrationCensus();
    expect(FILES.length).toBeGreaterThan(0);
    expect(real).toEqual({ read: true, dir: MIGRATIONS_DIR, files: FILES.length,
      highest: FILES[FILES.length - 1].name.slice(0, 14), unversioned: 0 });
    expect(FILES.filter((file) => !/^\d{14}_/.test(file.name))).toEqual([]);
    expect(STAGE_FILES.length).toBe(6);
    expect(STAGE_FILES.every((file) => /^\d{14}_stage11_/.test(file.name))).toBe(true);
    expect(real.highest).toBe(STAGE_FILES[STAGE_FILES.length - 1].name.slice(0, 14));

    // Both arms of the wiring, through `runCli` with a fixture directory: the health door prints the pair,
    // and the sentence it prints follows the numbers rather than the wish.
    const PAIR = censusFixture(['20260101000000_alpha.sql', '20260102000000_beta.sql']);
    try {
      const answer = { ok: true, blocks: { migrations: { status: 'measured', applied_count: 2,
        highest_version: '20260102000000' } } };
      const equal = await runDoor(['health', ...FULL.health], { rpc: answer, migrationsDir: PAIR });
      expect(equal.exit).toBe(0);
      expect(equal.chunks).toContain(`migrations: applied 2 (highest version 20260102000000), and 2 file(s) `
        + `on disk under ${PAIR}, highest version 20260102000000. The two figures are equal, which is the `
        + "state the chain should be in.\n");

      const behind = await runDoor(['health', ...FULL.health],
        { rpc: { ...answer, blocks: { migrations: { status: 'measured', applied_count: 1,
          highest_version: '20260101000000' } } }, migrationsDir: PAIR });
      expect(behind.exit).toBe(0);
      expect(behind.chunks.map((chunk) => chunk.replace(/\n$/, ''))
        .find((line) => line.startsWith('migrations: applied ')))
        .toContain('They differ, which is the difference between a migration in the repository and a '
          + 'migration on the stack');

      // And the honest arm against this repository's own files: a stack that has answered `not_measured`
      // gets the real disk figures plus the sentence that refuses to call a file count an applied count.
      const silent = await runDoor(['health', ...FULL.health], { rpc: { ok: true,
        blocks: { migrations: { status: 'not_measured', reason: 'the chain was never pushed here' } } } });
      expect(silent.exit).toBe(0);
      expect(silent.chunks).toContain(`migrations: ${real.files} file(s) on disk under ${real.dir}, highest `
        + `version ${real.highest}; the database's own answer is not_measured — the chain was never pushed `
        + 'here. A count of files is not a count of applied migrations, and this run says so instead of '
        + 'implying the pair matched.\n');
      expect(silent.printed).not.toContain('The two figures are equal');
      expect(needleHits(silent.printed)).toEqual([]);
    } finally {
      rmSync(PAIR, { recursive: true, force: true });
    }
  });

  it('OD-53 turns four HTTP shapes into four verdicts, and stops a connection string at the printer', () => {
    const DESIGNED = (() => {
      const line = /const DESIGNED_SQLSTATES = new Set\(\[([^\]]+)\]\)/.exec(CLI_TEXT);
      expect(line).not.toBeNull();
      return [...line[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
    })();
    expect(DESIGNED).toEqual(['42501', '23503', '23505', '23514', 'P0001', '22001', '22023']);

    // A missing door is never an answer: it means the migration this tool was written against is not the
    // database it is talking to, which is a fact about the tree and not about the operator's command line.
    for (const [status, body] of [
      [404, { code: '', message: 'Could not find the function api.operator_case_get' }],
      [400, { code: 'PGRST202', message: 'Could not find the function api.operator_case_get' }],
    ]) {
      expect(classifyHttp({ status, body })).toEqual({ exit: 1, kind: 'missing_door', code: body.code,
        message: `HTTP ${status} ${body.code || '(no code)'}: ${body.message}. The door this verb calls is `
          + 'not on this database, which means the migration that created it has not been applied here — a '
          + 'plan that ran against a repository is not a run that touched a stack.' });
    }
    // The 200-character cap on that sentence, measured at the boundary rather than assumed.
    const long = 'x'.repeat(400);
    expect(classifyHttp({ status: 400, body: { code: 'PGRST202', message: long } }).message)
      .toBe(`HTTP 400 PGRST202: ${long.slice(0, 200)}. The door this verb calls is not on this database, `
        + 'which means the migration that created it has not been applied here — a plan that ran against a '
        + 'repository is not a run that touched a stack.');

    // Every state the build ships a refusal sentence for, read out of the tool's own set above: exit 2, and
    // the database's words carried through unchanged.
    for (const code of DESIGNED) {
      expect(classifyHttp({ status: 400, body: { code, message: `refused by the ${code} guard` } }))
        .toEqual({ exit: 2, kind: 'refused_by_the_database', code,
          message: `HTTP 400 ${code}: refused by the ${code} guard` });
    }
    // A designed refusal with no sentence from the database still says so rather than printing `undefined`.
    expect(classifyHttp({ status: 400, body: { code: '42501' } }).message)
      .toBe('HTTP 400 42501: (the database gave no sentence)');

    for (const status of [401, 403]) {
      expect(classifyHttp({ status, body: { code: 'PGRST301', message: 'JWT expired' } }))
        .toEqual({ exit: 2, kind: 'refused_at_the_door', code: 'PGRST301',
          message: `HTTP ${status} PGRST301: JWT expired` });
      expect(classifyHttp({ status, body: {} }).message)
        .toBe(`HTTP ${status} (no code): no credential this run supplied was accepted`);
    }

    // The residue: anything else is an accident, and an accident is an instrument failure. Two shapes reach
    // it — a state outside the set, and a body that carries no sentence at all, which is printed as JSON.
    expect(classifyHttp({ status: 400, body: { code: 'XX000', message: 'raise fired' } }))
      .toEqual({ exit: 1, kind: 'transport_or_unexpected', code: 'XX000',
        message: 'HTTP 400 XX000: raise fired' });
    expect(classifyHttp({ status: 500, body: { code: '' } }))
      .toEqual({ exit: 1, kind: 'transport_or_unexpected', code: '',
        message: 'HTTP 500 (no code): {"code":""}' });
    const unwieldy = 'y'.repeat(400);
    expect(classifyHttp({ status: 500, body: { code: 'PGRST100', message: unwieldy } }).message)
      .toBe(`HTTP 500 PGRST100: ${unwieldy.slice(0, 300)}`);

    // A body that is not an object is not a missing door: only `PGRST202` or a bare 404 says the function is
    // absent, and the classifier reads a code out of a body it cannot read as `null`. Measured, not assumed:
    // the JSON fallback turns `null` into the word `null` in the sentence.
    expect(classifyHttp({ status: 400, body: null }))
      .toEqual({ exit: 1, kind: 'transport_or_unexpected', code: '', message: 'HTTP 400 (no code): null' });
    // The code wins over the status: a `PGRST202` is a missing door whatever number arrived with it, because
    // `callRpc` only consults this for a 4xx and a 200 here is the classifier's rule, not the transport's.
    expect(classifyHttp({ status: 200, body: { code: 'PGRST202' } }).kind).toBe('missing_door');

    // The verdict message goes to the printer unchanged, so the last line of defence against a database
    // sentence that carries a connection string is the printer itself. Both halves: a benign 500 prints, a
    // 500 quoting `postgres://user:pass@host` throws before a byte is written.
    const quiet = recorder();
    const printer = makePrinter({ write: quiet.write, refuse: () => [], soften: () => [] });
    const benign = classifyHttp({ status: 500, body: { code: 'XX000', message: 'connection closed' } });
    printer.print(benign.message);
    expect(quiet.chunks).toEqual([`${benign.message}\n`]);

    const hostile = classifyHttp({ status: 500, body: { code: 'XX000',
      message: 'failed while reading postgres://operator:db-password-never-read@db.internal:5432/postgres' } });
    const thrown = capturedError(() => printer.print(hostile.message));
    expect(thrown?.unprintable).toBe(true);
    expect(quiet.chunks.length).toBe(1);
    expect(quiet.printed()).not.toContain('db-password-never-read');
    expect(quiet.printed()).not.toContain('postgres://');

    // `makeRedactor` is the soften path's whole mechanism, so its two silent shapes are pinned here: a value
    // that is not a string and a value that is empty can neither be matched nor printed, and one occurrence
    // is not enough — every occurrence goes.
    const redact = makeRedactor([ACCESS, '', 42, undefined, PASSWORD]);
    expect(redact(`token ${ACCESS} and ${ACCESS} again, password ${PASSWORD}`))
      .toBe('token [redacted] and [redacted] again, password [redacted]');
    expect(redact(4217)).toBe('4217');
    expect(redact(null)).toBe('null');
    expect(makeRedactor()('nothing to do')).toBe('nothing to do');
    expect(makeRedactor([])(ACCESS)).toBe(ACCESS);
  });

  it('OD-54 holds fifteen exported names and keeps the six that touch the stack module-private', async () => {
    const moduleExports = Object.keys(await import('./stage11-operations-cli.mjs'));
    expect([...moduleExports].sort()).toEqual([
      'FORBIDDEN_FLAGS', 'HOST_INTAKE_DOORS', 'VERBS', 'VOCAB', 'classifyHttp', 'describeCensus',
      'makePrinter', 'makeRedactor', 'parseArgs', 'planCall', 'readEnvFile', 'readMigrationCensus',
      'readOperatorCredentials', 'readOptions', 'runCli',
    ]);
    expect(new Set(moduleExports).size).toBe(moduleExports.length);
    expect(moduleExports).not.toContain('default');

    // The six that must stay private, each checked twice: this file really declares it, and the namespace
    // really does not offer it. This is the census behind the header's claim that the console channel and
    // the loopback parse are observable only through `runCli` with an injected transport — a claim that
    // would be false the moment one of them was exported and tested directly.
    for (const name of ['runPsql', 'assertLoopback', 'signIn', 'callRpc', 'sqlLiteral', 'parseConsoleAnswer']) {
      expect(CLI_TEXT).toMatch(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
      expect(moduleExports).not.toContain(name);
    }
    // Presence control on the other half of the boundary: the export statements in the source are as many as
    // the names in the namespace, so nothing leaves the module through a re-export this file cannot see.
    expect(CLI_TEXT.split('\n').filter((line) => /^export /.test(line)).length).toBe(moduleExports.length);
    expect(CLI_TEXT).not.toMatch(/^export \{ /m);
    expect(CLI_TEXT).not.toMatch(/^export default /m);
  });
});
