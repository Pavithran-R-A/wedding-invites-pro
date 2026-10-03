// Stage 5 §25 — the maintenance CLI, pinned by tests instead of by an operator's memory.
//
// §25's own framing is the whole reason this file exists: "The CLI exists and was manually
// exercised. Now pin it." A hand-run tool is a tool whose guarantees last until the next refactor,
// and this tool is the one surface that can move a tradition pack release from `draft` to
// `approved` — the moment a piece of platform wording becomes something a customer can select. So
// every refusal that keeps that power local, explicit and digest-bound is asserted here as a
// subprocess exit code, not as a paragraph in a header comment.
//
// Why a subprocess and not an import. The file's behaviour *is* its process contract: exit 2 for an
// operator refusal, exit 1 for a database refusal, stdout for what the operator asked to see,
// stderr for the `REFUSED:` line, and — the part §25 asks for last — nothing at all in either
// stream that looks like a credential. None of that is observable through `import`, which would
// also share the parent's `process.argv` and environment. `spawnSync` with an argv array means no
// shell, so nothing here is a quoting test either.
//
// What the other suites already prove, and what this one therefore deliberately does not repeat:
//
//   * `supabase/tests/stage5/50_review_binding.sql` proves the digest binding in SQL — that
//     `review_packet_hash` is produced by the database from the row's own material, that a
//     submission against a different digest writes nothing, and that the maintenance functions are
//     revoked from every browser role. This file does not re-derive a hash; it drives the tool
//     against those same functions and reads the row back.
//   * `stage4_tradition_packs.test.mjs` and `stage5_pack_driven_http.test.mjs` prove the same rules
//     over Kong → PostgREST → JWT. The CLI never touches the transport: it is `psql` as the local
//     maintenance identity, which is the only way to call a function no browser role may execute.
//   * The lifecycle edges themselves (draft → reviewed → approved → deprecated, forward-only,
//     deletion refused past draft) are the Stage 4 guard's subject, asserted in both batteries.
//
// Residue, stated rather than hidden. Ruling A2 refuses `DELETE` of a release that has left
// `draft`, so the one pack and one release this file mints to walk a real review through stay in
// the local catalogue for every later run — exactly like the retirement pair the §23 suite mints.
// The pack key carries this run's tag so a residue listing names the run that left it, every scope
// statement says TEST ONLY, and the final group prints what was left behind instead of pretending
// an empty catalogue is what a correct run looks like.
//
// Not part of `npm test`; run it with `bash supabase/tests/api/run.sh`, which refuses unless the
// four containers of *this* project are up and unless `SUPABASE_LOCAL_URL` is loopback and matches
// `supabase/config.toml`'s `[api] port`.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI = join(ROOT, 'scripts', 'tradition-pack-admin.mjs');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

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
if (!env.SUPABASE_LOCAL_URL || !LOOPBACK.has(new URL(env.SUPABASE_LOCAL_URL).hostname)) {
  throw new Error(`refusing to run: SUPABASE_LOCAL_URL is missing from .env.local or is not loopback`);
}

const PROJECT_ID = (() => {
  const toml = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');
  const m = /^project_id\s*=\s*"?([^"\n]+?)"?\s*$/m.exec(toml);
  if (!m) throw new Error('no project_id in supabase/config.toml');
  return m[1].trim();
})();
// Named rather than derived, for the reason `stage5_pack_driven_http.test.mjs` gives: this file
// writes rows into a persistent local database through a *container name*, so the check that keeps
// it off someone else's stack has to be a string, not a port.
if (PROJECT_ID !== 'localvivaahvarnam') {
  throw new Error(`refusing to run: project_id is ${PROJECT_ID}; this suite only writes to localvivaahvarnam`);
}
const DB_CONTAINER = process.env.STAGE3_DB_CONTAINER ?? `supabase_db_${PROJECT_ID}`;
if (DB_CONTAINER !== 'supabase_db_localvivaahvarnam') {
  throw new Error(`refusing to run: STAGE3_DB_CONTAINER=${DB_CONTAINER} is not this project's database`);
}

const RUN_TAG = process.env.STAGE5_CLI_RUN_TAG
  ?? `stage5cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// The tag reaches a `pack_key` and a scope statement below, so an inherited value is only accepted
// in the shape this file generates.
if (!/^[a-z0-9][a-z0-9-]{3,40}$/.test(RUN_TAG)) {
  throw new Error(`refusing to run: STAGE5_CLI_RUN_TAG=${RUN_TAG} is not a run tag`);
}
// `pack_key` is `^[a-z][a-z0-9]*(_[a-z0-9]*)*$` in the database and `^[a-z][a-z0-9_]{1,63}$` in the
// tool, so the hyphenated tag is folded to underscores rather than re-randomised — which is what
// makes a crashed run's residue traceable to the run that left it.
const PACK_KEY = `stage5_cli_${RUN_TAG.replace(/[^a-z0-9]+/g, '_').replace(/^_+/, '')}`.slice(0, 63);
if (!/^[a-z][a-z0-9_]{1,63}$/.test(PACK_KEY)) {
  throw new Error(`refusing to run: ${PACK_KEY} is not a pack_key slug`);
}
const SCOPE = `TEST ONLY — minted by supabase/tests/api/stage5_admin_cli.test.mjs (${RUN_TAG}) to `
  'pin the maintenance CLI. It endorses no tradition, community, ritual or language claim, no '
  + 'string in it was read by a human reviewer with cultural authority, and it is not customer content.';

// --------------------------------------------------------------- the canary set (§25's last ask)
// §25 asks for four secret classes to be looked for in the tool's output. A search that only looks
// for secrets the tool never had access to proves nothing, so each class is planted somewhere this
// process genuinely holds — the environment it hands every child — and then asserted absent from
// every byte the tool wrote. The password-bearing URL is also the *functional* input for two
// target-gate cases, so the same canary is both the bait and the payload.
const CANARY = {
  localDbUrl: `postgresql://postgres:canary-pw-${RUN_TAG}@127.0.0.1:54401/postgres`,
  hostedUrl: `postgresql://postgres:canary-pw-${RUN_TAG}@abcd1234efgh.supabase.co:6543/postgres`,
  otherHostUrl: `postgresql://postgres:canary-pw-${RUN_TAG}@10.20.30.40:5432/postgres`,
  serviceKey: `sb_secret-canary-${RUN_TAG}`,
  jwt: `eyJhbGciOiJIUzI1NiJ9.Y2FuYXJ5LW5vdC1hLXRva2Vu-${RUN_TAG}.c2lnbmF0dXJlaXNudGhpcw`,
  credential: `inv_${RUN_TAG}_raw_publication_credential`,
};
const REAL_SECRETS = [
  ['the service-role key', env.SUPABASE_LOCAL_SERVICE_ROLE_KEY],
  ['the database connection string', env.SUPABASE_DB_URL],
].filter(([, value]) => typeof value === 'string' && value.length > 0);

/** Every invocation this file makes, so the secret audit at the end reads the whole run rather
 *  than a sample. Entries are `{ argv, status, out, err }`; the credential-bearing strings are
 *  never stored anywhere but in the canary constants above. */
const LEDGER = [];

function cli(argv, opts = {}) {
  const res = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: ROOT,
    encoding: 'utf8',
    // An explicit empty stdin rather than an inherited one: `--definition -` and `--patch -` read
    // standard input, and a suite must not be able to hang waiting for a terminal.
    input: opts.input ?? '',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      VIVAAHVARNAM_MAINT_DB_URL: opts.dbUrl ?? CANARY.localDbUrl,
      SUPABASE_SERVICE_ROLE_KEY: CANARY.serviceKey,
      SUPABASE_ANON_KEY: CANARY.jwt,
      INVITATION_RAW_CREDENTIAL: CANARY.credential,
    },
  });
  const entry = { argv, status: res.status, out: res.stdout ?? '', err: res.stderr ?? '' };
  LEDGER.push(entry);
  if (res.error) throw new Error(`the CLI could not be spawned: ${res.error.message}`);
  return {
    ...entry,
    all: entry.out + entry.err,
    /** The tool writes `# plan …` lines and then one JSON document to stdout, so the document is
     *  read from its first brace rather than by assuming stdout holds nothing else. */
    json() {
      const i = entry.out.indexOf('{');
      if (i < 0) throw new Error(`no JSON document on stdout:\n${entry.out.slice(0, 600)}`);
      return JSON.parse(entry.out.slice(i));
    },
    digest() {
      const m = /authoritative digest: ([0-9a-f]{64})/.exec(entry.out);
      if (!m) throw new Error(`no authoritative digest on stdout:\n${entry.out.slice(0, 600)}`);
      return m[1];
    },
  };
}

const LOCAL = ['--via-docker', DB_CONTAINER];

/** Refusals are asserted as a *line*, not as the start of the string, because the tool prints
 *  `# maintenance identity: …` on stderr as soon as it has opened a session — so a refusal that
 *  arrives after the target gate is preceded by that line, and one that arrives before it is not.
 *  Which side of the session guard a refusal falls on is itself a fact worth pinning, so each use
 *  below says so. */
const refusalLine = (text) => /(^|\n)REFUSED: /m.test(text);
const errorLine = (text) => /(^|\n)ERROR: /m.test(text);
const CONNECTED = (text) => text.includes('# maintenance identity: ');

/** A trusted read of the same database the CLI is pointed at. Every interpolation below is either
 *  a literal this file wrote or a value validated against `UUID_RE` first. */
function sqlValue(query) {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-tA', '-c', query], { encoding: 'utf8' }).trim();
}

/** The four counters that would move if anything here wrote, edited or deleted a row. `weddings`
 *  and `invitation_versions` are in the list because a maintenance tool that could touch a
 *  customer's selection would be the worst possible version of itself. */
const world = () => sqlValue(`
  select jsonb_build_object(
    'packs', (select count(*) from public.tradition_packs),
    'releases', (select count(*) from public.tradition_pack_releases),
    'weddings', (select count(*) from public.weddings),
    'versions', (select count(*) from public.invitation_versions))::text`);

/** Everything a review is allowed to have written, in one string: status, the digest binding, the
 *  reviewer's four fields and the timestamps. "Database unchanged" is asserted over all of it
 *  rather than over `status` alone, because a partial write is exactly the bug worth catching. */
const releaseState = (id) => sqlValue(`
  select jsonb_build_object(
    'status', r.status,
    'review_packet_hash', r.review_packet_hash,
    'review_label', r.review_label,
    'review_basis', r.review_basis,
    'review_scope', r.review_scope,
    'reviewed_languages', r.reviewed_languages,
    'reviewed_by', r.reviewed_by,
    'reviewed_at', r.reviewed_at,
    'approved_at', r.approved_at,
    'deprecated_at', r.deprecated_at,
    'definition', r.definition)::text
    from public.tradition_pack_releases r where r.id = ${`'${id}'`}::uuid`);

const TMP = mkdtempSync(join(tmpdir(), 'stage5-cli-'));
const definitionPath = join(TMP, 'definition.json');
// One builder, because the digest tests turn on exactly one thing being different between two
// documents: `heading.en` is the character that moves, and everything else has to be identical or
// a digest change would not prove the digest is of *this* byte.
const definitionWith = (openingHeading) => ({
  sections: [
    {
      section_key: 'opening',
      position: 1,
      kind: 'text',
      required: true,
      heading: { en: openingHeading, ta: 'அழைப்பு' },
      pack_text: { en: 'With the goodwill of both families.', ta: 'இரு குடும்பத்தின் அன்புடன்' },
      override_rule: 'host_may_replace',
      allow_english_fallback: true,
    },
    {
      section_key: 'blessing',
      position: 2,
      kind: 'text',
      required: false,
      heading: { en: 'Blessings' },
      pack_text: { en: 'With best wishes.' },
      override_rule: 'pack_only',
    },
  ],
});
writeFileSync(definitionPath, JSON.stringify(definitionWith('Invitation'), null, 2), 'utf8');

// One release, walked the way a reviewer would walk it, because §25's stale-hash and digest cases
// are only real if the digest under test was produced by this tool from this row.
const state = { releaseId: null, digestBefore: null, digestAfter: null };

before(async () => {
  const pack = cli([...LOCAL, 'create-pack', '--yes', '--key', PACK_KEY,
    '--name', 'TEST ONLY — CLI qualification pack', '--scope', SCOPE]);
  assert.equal(pack.status, 0, `create-pack --yes failed: ${pack.err.slice(0, 800)}`);
  const packBody = pack.json();
  assert.match(String(packBody.pack_id), UUID_RE, `create-pack did not report a pack id: ${pack.out.slice(0, 400)}`);
  assert.equal(packBody.has_content, false,
    'a new pack concept carries no wording; a tool that could ship content with the concept is a different tool');

  const release = cli([...LOCAL, 'create-release', '--yes', '--key', PACK_KEY,
    '--definition', definitionPath, '--dsv', '2', '--languages', 'en,ta',
    '--author', 'Machine-assisted draft minted by the Stage 5 §25 suite; no human cultural review '
      + 'has been recorded.', '--notes', 'TEST ONLY — created to pin the CLI.',
    '--source', 'supabase/tests/api/stage5_admin_cli.test.mjs']);
  assert.equal(release.status, 0, `create-release --yes failed: ${release.err.slice(0, 800)}`);
  const body = release.json();
  assert.match(String(body.release_id), UUID_RE);
  assert.equal(body.status, 'draft', 'a release is born a draft; a tool that could choose otherwise '
    + 'is not the tool this suite is pinning');
  state.releaseId = String(body.release_id);
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ============================================================================ §25's target gate
describe('CLI-TARGET the maintenance CLI refuses every target that is not this local stack', () => {
  test('a command with no target is exit 2 and names both supply routes, without inventing one', () => {
    const run = cli(['list']);
    assert.equal(run.status, 2);
    assert.match(run.err, /^REFUSED: /);
    assert.match(run.err, /no maintenance target was supplied/);
    assert.match(run.err, /--via-docker/);
    assert.match(run.err, /VIVAAHVARNAM_MAINT_DB_URL/);
    // The refusal must not become a confession of what it was holding.
    assert.ok(!run.all.includes(CANARY.localDbUrl), 'the target refusal echoed the connection string');
    assert.ok(!run.all.includes(`canary-pw-${RUN_TAG}`), 'the target refusal echoed a password');
    assert.equal(run.out, '', 'a refused run wrote nothing to stdout');
  });

  test('a hosted Supabase URL is exit 2, by name, before anything is read from it', () => {
    const run = cli(['--db-url-env', 'list'], { dbUrl: CANARY.hostedUrl });
    assert.equal(run.status, 2);
    assert.match(run.err, /the URL names a hosted target/);
    assert.ok(!run.all.includes(`canary-pw-${RUN_TAG}`),
      'the hosted-target refusal echoed the credential inside the URL it refused');
    assert.equal(run.out, '');
  });

  test('a non-loopback URL is exit 2, and the message names the host rather than the URL', () => {
    const run = cli(['--db-url-env', 'list'], { dbUrl: CANARY.otherHostUrl });
    assert.equal(run.status, 2);
    assert.match(run.err, /the URL's host is 10\.20\.30\.40/);
    assert.match(run.err, /Only a loopback address is a local maintenance target/);
    assert.ok(!run.all.includes(`canary-pw-${RUN_TAG}`),
      'the loopback refusal echoed the credential inside the URL it refused');
  });

  test('--db-url-env with the variable unset is exit 2 and explains argv rather than accepting it', () => {
    const run = cli(['--db-url-env', 'list'], { dbUrl: '' });
    assert.equal(run.status, 2);
    assert.match(run.err, /that variable is not set/);
    assert.match(run.err, /argv lands in shell history/);
  });

  test('--linked is exit 2 even next to a perfectly valid local target', () => {
    // Both spellings matter. Refusing `--linked` only when nothing else was supplied would be a
    // no-target refusal wearing a remote flag's name, and an operator would learn the wrong lesson.
    const alone = cli(['--linked', 'list']);
    assert.equal(alone.status, 2);
    assert.match(alone.err, /this tool is local-only/);
    const withTarget = cli(['--linked', ...LOCAL, 'list']);
    assert.equal(withTarget.status, 2);
    assert.match(withTarget.err, /--linked, --project-ref and any hosted target are not supported/);
    assert.equal(withTarget.out, '', 'a refused --linked must not have reached the catalogue');
  });

  test('--project-ref is exit 2 even next to a perfectly valid local target', () => {
    const alone = cli(['--project-ref', 'abcd1234efgh', 'list']);
    assert.equal(alone.status, 2);
    assert.match(alone.err, /this tool is local-only/);
    const withTarget = cli(['--project-ref', 'abcd1234efgh', ...LOCAL, 'retention']);
    assert.equal(withTarget.status, 2);
    assert.ok(!alone.all.includes(CANARY.serviceKey), 'the --project-ref refusal echoed a key');
  });

  test('a container name that is not the local database container is exit 2', () => {
    for (const bad of ['evil', 'supabase_db_', 'postgres', 'supabase_kong_localvivaahvarnam',
      'supabase_db_local vivaah']) {
      const run = cli(['--via-docker', bad, 'list']);
      assert.equal(run.status, 2, `--via-docker ${JSON.stringify(bad)} was not refused as a name`);
      assert.match(run.err, /wants the local stack's database container name/);
      assert.ok(!run.all.includes(`canary-pw-${RUN_TAG}`),
        'the name refusal echoed the connection string that was in the environment');
    }
    // The kong container is the pointed case: a real container of this project that is not a
    // database. The shape gate refuses it without ever asking docker.
    const equals = cli(['--via-docker=evil', 'list']);
    assert.equal(equals.status, 2, 'the --flag=value spelling is the same gate');
    assert.match(equals.err, /wants the local stack's database container name/);
  });

  test('a flag-shaped container name is still exit 2, and the reason is the parser rule, not the name', () => {
    // Measured rather than assumed, because the two refusals are different sentences and an
    // operator needs to know which rule bit them. `--via-docker --via-docker-x list` cannot bind a
    // value that starts with `--`, so the tool has no container name at all, `list` is swallowed as
    // the value of the next flag, and the answer is "no command given" — still exit 2, still before
    // any connection.
    const run = cli(['--via-docker', '--via-docker-x', 'list']);
    assert.equal(run.status, 2);
    assert.match(run.err, /no command given/);
    assert.ok(!run.all.includes(`canary-pw-${RUN_TAG}`), 'the refusal echoed a credential');
  });

  test('a well-shaped name docker cannot resolve is a database-route failure, exit 1 — measured, not assumed', () => {
    // This case is here because the answer is *not* 2, and an audit that claimed "every bad target
    // is a usage refusal" would be wrong. `supabase_db_<anything>` passes the name shape, so a
    // mis-typed but well-formed name reaches docker, and docker's non-zero answer is reported as a
    // route failure. The container named here is one no stack on this machine provides, so nothing
    // could be reached; the shape gate accepting an unrelated name is disclosed in the audit for
    // §33 rather than papered over here.
    const ghost = 'supabase_db_this_repo_has_no_such_stack';
    // Verified against docker itself rather than asserted from the header's prose, so the exit code
    // below cannot be the answer to a question about a container that exists.
    let ghostExists = true;
    try {
      execFileSync('docker', ['inspect', ghost], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      ghostExists = false;
    }
    assert.equal(ghostExists, false, `refusing to run: ${ghost} exists, so it is not a ghost`);
    const run = cli(['--via-docker', ghost, 'list']);
    assert.equal(run.status, 1);
    assert.match(run.err, /^ERROR: /);
    assert.ok(!run.all.includes(`canary-pw-${RUN_TAG}`), 'the route failure echoed a credential');
  });
});

// ======================================================================== §25's command surface
describe('CLI-SURFACE the verbs, the refusals, and the absence of a delete command', () => {
  test('no command is exit 2, after printing the verb list it offers', () => {
    const run = cli([...LOCAL]);
    assert.equal(run.status, 2);
    assert.match(run.out, /^commands: /);
    assert.match(run.err, /^REFUSED: refused: no command given/);
    const verbs = run.out.replace(/^commands: /, '').trim().split(/\s*\|\s*/).sort();
    assert.deepEqual(verbs, ['approve', 'create-pack', 'create-release', 'deprecate', 'inspect',
      'list', 'retention', 'review-packet', 'submit-review', 'update-draft', 'validate-release'],
      'the tool advertises a verb list nobody has pinned; this array is that pin');
  });

  test('a mutation without --yes is refused for every one of the six mutating verbs', () => {
    const before5 = world();
    const calls = {
      'create-pack': ['--key', 'stage5_cli_never_minted', '--name', 'TEST ONLY', '--scope', SCOPE],
      'create-release': ['--key', PACK_KEY, '--definition', definitionPath],
      'update-draft': ['--release', state.releaseId, '--patch', definitionPath],
      'submit-review': ['--release', state.releaseId, '--decision', 'accept',
        '--reviewer', 'TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW',
        '--basis', 'TEST ONLY — a qualification run, not a cultural reading.',
        '--scope', 'TEST ONLY — the whole definition, read for transport purposes only.',
        '--languages', 'en,ta', '--hash', '0'.repeat(64)],
      approve: ['--release', state.releaseId, '--hash', '0'.repeat(64)],
      deprecate: ['--release', state.releaseId],
    };
    for (const [verb, extra] of Object.entries(calls)) {
      const run = cli([...LOCAL, verb, ...extra]);
      assert.equal(run.status, 2, `${verb} without --yes was not an operator refusal`);
      assert.match(run.out, new RegExp(`^# plan for ${verb.replace(/-/g, '\\-')}`),
        `${verb} refused without telling the operator what it would have done`);
      assert.match(run.err, /nothing was executed/);
      assert.match(run.err, /Re-run with --yes/);
    }
    assert.equal(world(), before5, 'a --yes-less run moved a row');
    assert.match(releaseState(state.releaseId), /"status": "draft"/);
    assert.match(releaseState(state.releaseId), /"review_packet_hash": null/);
    assert.match(releaseState(state.releaseId), /"approved_at": null/);
  });

  test('no delete verb exists, at the surface and in the file', () => {
    const before5 = world();
    for (const verb of ['delete', 'delete-pack', 'delete-release', 'remove-release', 'purge',
      'destroy', 'drop-release', 'erase']) {
      const run = cli([...LOCAL, verb, '--release', state.releaseId, '--yes']);
      assert.equal(run.status, 2, `${verb} was not refused as an unknown command`);
      assert.match(run.err, new RegExp(`unknown command ${JSON.stringify(verb).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
    assert.equal(world(), before5, 'an attempt to delete changed the row counts');
    assert.match(releaseState(state.releaseId), /"status": "draft"/,
      'the release the suite mints is still present and still a draft');

    // The static half of the same claim, so "there is no delete verb" is not only a list of names
    // nobody thought to try: the tool's own source contains no statement that could delete a row.
    const source = readFileSync(CLI, 'utf8');
    assert.ok(!/\bdelete\s+from\b/i.test(source), 'the CLI contains a DELETE statement');
    assert.ok(!/\btruncate\b/i.test(source), 'the CLI contains a TRUNCATE statement');
    assert.ok(!/--delete|'delete'|case 'delete/.test(source), 'the CLI names a delete command');
    // `internal_api` has no delete function to call, so the absence is not a UI choice. Measured
    // against the catalogue rather than asserted from memory.
    assert.equal(sqlValue(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal_api' and (p.proname like '%delete%' or p.prosrc ilike '%delete from public.tradition_pack%')`), '0',
      'a delete path exists in internal_api, which would make the missing verb a UI convention');
  });

  test('an unknown verb is refused by name rather than answered with the usage list', () => {
    const run = cli([...LOCAL, 'frobnicate']);
    assert.equal(run.status, 2);
    assert.match(run.err, /unknown command "frobnicate"/);
    assert.equal(run.out, '', 'the unknown-verb refusal should not dump the verb list, which is the '
      + 'answer to a different question');
  });

  test('a malformed uuid, hash, slug, decision or language list is exit 2 before any call', () => {
    const before5 = world();
    // `--yes` is on every mutating case on purpose: without it the run would refuse for the right
    // exit code but the wrong reason (the --yes gate), and the operand validator would never be
    // measured. The target gate and the --yes gate still run first, so nothing reaches psql.
    const cases = [
      ['inspect', ['--release', 'not-a-uuid'], /--release wants a uuid/],
      ['validate-release', ['--release', state.releaseId.slice(0, 30)], /--release wants a uuid/],
      ['approve', ['--yes', '--release', state.releaseId, '--hash', 'deadbeef'], /--hash wants the 64-character/],
      ['approve', ['--yes', '--release', state.releaseId, '--hash', 'A'.repeat(64)], /--hash wants the 64-character/],
      ['create-pack', ['--yes', '--key', 'Bad-Key', '--name', 'x', '--scope', SCOPE], /--key must be a lower_snake slug/],
      ['submit-review', ['--yes', '--release', state.releaseId, '--decision', 'maybe',
        '--reviewer', 'r', '--basis', 'b', '--scope', 's', '--languages', 'en',
        '--hash', '0'.repeat(64)],
      /--decision is one of accept, accept_with_changes, reject/],
      ['submit-review', ['--yes', '--release', state.releaseId, '--decision', 'accept',
        '--reviewer', 'r', '--basis', 'b', '--scope', 's', '--languages', 'english',
        '--hash', '0'.repeat(64)],
      /english is not a language tag/],
    ];
    for (const [verb, extra, expected] of cases) {
      const run = cli([...LOCAL, verb, ...extra]);
      assert.equal(run.status, 2, `${verb} ${extra.join(' ')} was not a usage refusal: ${run.err.slice(0, 400)}`);
      assert.match(run.err, expected, `${verb} refused, but not for the reason under test: ${run.err.slice(0, 400)}`);
      // A mutating case reaches here with `--yes`, so it prints its plan — but it must print no
      // result document, because the operand never made it as far as a statement.
      assert.doesNotMatch(run.out, /"release_id"|"pack_id"|"status"/,
        `${verb} printed a result document for a call that was never made`);
    }
    assert.equal(world(), before5);
  });

  test('a document operand that cannot be read or parsed is exit 2, not a crash and not a route error', () => {
    const before5 = world();
    const stateBefore = releaseState(state.releaseId);
    const unparsable = join(TMP, 'unparsable.json');
    writeFileSync(unparsable, '{ "sections": [ ', 'utf8');
    for (const [verb, file, flag] of [
      ['update-draft', join(TMP, 'no-such-file.json'), '--patch'],
      ['create-release', join(TMP, 'no-such-definition.json'), '--definition'],
      ['update-draft', unparsable, '--patch'],
    ]) {
      const run = cli([...LOCAL, verb, '--yes', '--key', PACK_KEY, '--release', state.releaseId,
        flag, file]);
      assert.equal(run.status, 2, `${verb} ${flag} ${file} → exit ${run.status}: ${run.err.slice(0, 300)}`);
      assert.ok(refusalLine(run.err), `${flag} ${file}: ${run.err.slice(0, 400)}`);
      assert.ok(!errorLine(run.err), 'a document operand refusal must not be reported as a route error');
      // Measured ordering, not the ordering a header comment promises: the tool opens its session
      // and prints the maintenance identity *before* it reads this operand, so the refusal arrives
      // after that line. What makes it safe is not the order but the absence of a statement — the
      // row counts and the release's own state are asserted unchanged below.
      assert.ok(CONNECTED(run.err),
        `the session guard no longer runs before the operands are read: ${run.err.slice(0, 300)}`);
      assert.match(run.err, /could not be read|is not valid JSON/);
    }
    assert.equal(world(), before5, 'a refused document operand wrote or removed a row');
    assert.equal(releaseState(state.releaseId), stateBefore);
  });

  test('the argument parser does not swallow a command as a flag value', () => {
    // `--linked list` would otherwise be read as `--linked=<the string "list">` and refused for
    // having no command instead of for being remote — a refusal that names the wrong thing is a
    // refusal nobody learns from.
    const run = cli(['--linked', 'list']);
    assert.match(run.err, /local-only/);
    assert.doesNotMatch(run.err, /no command given/);
    const same = cli(['--yes', 'retention']);
    assert.equal(same.status, 2, 'a no-target refusal must still be the reason');
    assert.match(same.err, /no maintenance target was supplied/);
  });
});

// ========================================================================= §25's read-only verbs
describe('CLI-READ the five read-only verbs answer without writing', () => {
  let snapshot;
  test('list', () => {
    snapshot = world();
    const run = cli([...LOCAL, 'list']);
    assert.equal(run.status, 0, run.err.slice(0, 800));
    const body = run.json();
    assert.ok(Array.isArray(body.packs), 'list did not answer with a packs array');
    const mine = body.packs.find((p) => p.pack_key === PACK_KEY);
    assert.ok(mine, 'the pack this run minted is not in the catalogue list');
    assert.equal(mine.releases[0].status, 'draft');
    assert.equal(mine.releases[0].review_packet_hash, null,
      'a draft carries no digest; a list that showed one would be showing a review that never happened');
    assert.match(mine.scope_statement, /^TEST ONLY/);
  });

  test('retention', () => {
    const run = cli([...LOCAL, 'retention']);
    assert.equal(run.status, 0, run.err.slice(0, 800));
    const rows = run.json().releases;
    assert.ok(Array.isArray(rows));
    const mine = rows.find((r) => r.pack_key === PACK_KEY);
    assert.ok(mine, 'the retention report does not list the release this run minted');
    assert.equal(mine.status, 'draft');
    assert.equal(mine.weddings_selecting, 0);
    assert.equal(mine.versions_frozen, 0);
    // The retention report *does* print a `can_delete` boolean, and it is a statement about the
    // database guard (a draft may be deleted by the owner of the local cluster), not about this
    // tool: §25's "No delete command" is pinned above, against the verb list and the source.
    assert.equal(typeof mine.can_delete, 'boolean');
  });

  test('inspect', () => {
    const run = cli([...LOCAL, 'inspect', '--release', state.releaseId]);
    assert.equal(run.status, 0, run.err.slice(0, 800));
    const body = run.json();
    assert.deepEqual(Object.keys(body).sort(), ['binding_current', 'hash_recorded', 'pack_key',
      'release', 'review_payload_recomputed', 'transitions_available', 'versions_frozen',
      'weddings_selecting']);
    assert.equal(body.pack_key, PACK_KEY);
    assert.equal(body.hash_recorded, false, 'a draft has no recorded digest');
    assert.equal(body.binding_current, false,
      'binding_current compares a stored digest with a recomputed one; with nothing stored it must be false, not true');
    assert.match(String(body.review_payload_recomputed), HASH_RE,
      'inspect recomputes the digest rather than repeating the row');
    assert.deepEqual(body.transitions_available, ['reviewed']);
    assert.equal(body.release.status, 'draft');
  });

  test('validate-release', () => {
    const run = cli([...LOCAL, 'validate-release', '--release', state.releaseId]);
    assert.equal(run.status, 0, run.err.slice(0, 800));
    const body = run.json();
    assert.equal(String(body.release_id), state.releaseId);
    assert.equal(body.status, 'draft');
    assert.equal(body.definition_schema_version, 2);
    // `languages` is not a key of this answer: the language set is read from the arms that carry
    // the verdicts, which is the only way to notice a language that produced no verdict at all.
    assert.deepEqual(Object.keys(body).sort(), ['definition_schema_version', 'per_language',
      'release_id', 'release_number', 'status']);
    assert.deepEqual(body.per_language.map((d) => d.language), ['en', 'ta'],
      'validation is per language, which is what makes a missing Tamil line visible');
    for (const doc of body.per_language) {
      assert.equal(typeof doc.sections, 'number', `${doc.language} reported no section count`);
      assert.ok(doc.issues !== undefined && doc.issues !== null,
        `${doc.language} reported no issue verdict`);
    }
  });

  test('review-packet writes the artefact where it is told, and prints the digest it is bound to', () => {
    const out = join(TMP, 'packets');
    const run = cli([...LOCAL, 'review-packet', '--release', state.releaseId, '--out', out]);
    assert.equal(run.status, 0, run.err.slice(0, 800));
    const digest = run.digest();
    state.digestBefore = digest;
    // The path is compared as this platform renders it, not as a forward-slash string built by
    // hand — the tool writes with `join`, so that is the name under test.
    const mdPath = join(out, `${PACK_KEY}-r1.md`);
    const jsonPath = join(out, `${PACK_KEY}-r1.json`);
    assert.ok(run.out.includes(mdPath) && run.out.includes(jsonPath),
      `the tool did not report the paths it wrote: ${run.out.slice(0, 400)}`);
    assert.ok(existsSync(mdPath) && existsSync(jsonPath), 'the reported paths do not exist');
    const md = readFileSync(mdPath, 'utf8');
    const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
    assert.equal(json.review_packet_hash, digest);
    assert.ok(md.includes(digest), 'the packet must show the digest a submission has to name');
    assert.match(md, /## Canonical payload \(the bytes the digest is of\)/);
    assert.match(md, /produced inside Postgres by `private\.tradition_pack_review_hash`/,
      'the packet must say where the digest came from, or a reader assumes the tool computed it');
    assert.ok(md.includes(json.canonical_payload),
      'the payload printed must be the payload hashed');
    assert.equal(json.review_packet_hash_recorded, null);
    assert.match(md, /intentionally unanswered/);
    assert.equal(world(), snapshot, 'a read-only verb wrote a row');
  });

  test('the same bytes give the same digest, twice over', () => {
    const first = cli([...LOCAL, 'review-packet', '--release', state.releaseId, '--out', join(TMP, 'p1')]);
    const second = cli([...LOCAL, 'review-packet', '--release', state.releaseId, '--out', join(TMP, 'p2')]);
    assert.equal(first.status, 0, first.err.slice(0, 800));
    assert.equal(second.status, 0, second.err.slice(0, 800));
    assert.equal(second.digest(), first.digest(),
      'a digest that moves between readings of unchanged material cannot bind a review to anything');
    assert.equal(first.digest(), state.digestBefore);
    const a = readFileSync(join(TMP, 'p1', `${PACK_KEY}-r1.json`), 'utf8');
    const b = readFileSync(join(TMP, 'p2', `${PACK_KEY}-r1.json`), 'utf8');
    assert.equal(a, b, 'the packet artefact itself must be reproducible, not just its digest');
    assert.equal(world(), snapshot);
  });

  test('one character in the material changes the digest', () => {
    const edited = join(TMP, 'patch.json');
    writeFileSync(edited, JSON.stringify({ definition: definitionWith('Invitations') }), 'utf8');
    const run = cli([...LOCAL, 'update-draft', '--yes', '--release', state.releaseId,
      '--patch', edited]);
    assert.equal(run.status, 0, run.err.slice(0, 800));
    const body = run.json();
    assert.equal(body.transition, 'draft -> draft (content edited)');
    assert.equal(body.review_packet_hash_before, null, 'a draft held no digest before');
    assert.equal(body.review_packet_hash_after, null,
      'and editing a draft must not stamp one — the digest a review binds to is produced at submission');

    const packet = cli([...LOCAL, 'review-packet', '--release', state.releaseId, '--out', join(TMP, 'p3')]);
    assert.equal(packet.status, 0, packet.err.slice(0, 800));
    state.digestAfter = packet.digest();
    assert.notEqual(state.digestAfter, state.digestBefore,
      'the material moved by one character and the digest did not: the packet would be binding a review to bytes nobody read');
    assert.match(state.digestAfter, HASH_RE);
    const md = readFileSync(join(TMP, 'p3', `${PACK_KEY}-r1.md`), 'utf8');
    assert.ok(md.includes('Invitations'), 'the packet shows the edited heading, not the old one');
    assert.equal(sqlValue(`select definition #>> '{sections,0,heading,en}'
      from public.tradition_pack_releases where id = '${state.releaseId}'::uuid`), 'Invitations');
    assert.equal(world(), snapshot, 'a content edit changed a row count, which it must not');
  });

  test('a patch that names a field this surface does not have is refused and writes nothing', () => {
    const before5 = world();
    const stateBefore = releaseState(state.releaseId);
    const bad = join(TMP, 'bad-patch.json');
    writeFileSync(bad, JSON.stringify({ status: 'approved' }), 'utf8');
    const run = cli([...LOCAL, 'update-draft', '--yes', '--release', state.releaseId, '--patch', bad]);
    assert.equal(run.status, 1,
      'the closed patch key set is enforced by the database, so this is a database refusal, not a usage one');
    assert.match(run.err, /names fields this surface does not have/);
    assert.equal(world(), before5);
    assert.equal(releaseState(state.releaseId), stateBefore,
      '"promote this while I am here" must not be expressible, not merely discouraged');
  });

  test('a definition that is not valid v2 material is refused by the database, unchanged', () => {
    const before5 = world();
    const stateBefore = releaseState(state.releaseId);
    const bad = join(TMP, 'bad-definition.json');
    writeFileSync(bad, JSON.stringify({ sections: [{ section_key: 'ritual_instruction', position: 1 }] }), 'utf8');
    const run = cli([...LOCAL, 'create-release', '--yes', '--key', PACK_KEY, '--definition', bad]);
    assert.equal(run.status, 1);
    assert.match(run.err, /is not one of the section slots this build renders/);
    assert.equal(world(), before5, 'a rejected release left a row behind');
    assert.equal(releaseState(state.releaseId), stateBefore);
  });

  test('a review submitted against a stale digest is refused, and the database is unchanged', () => {
    // §25's requirement, and the heart of the file: the digest a reviewer was shown is not the
    // digest the material now has, so the submission must not be able to record a review of bytes
    // nobody read. `state.digestBefore` is exactly that stale value — the packet produced before
    // the one-character edit.
    const before5 = world();
    const stateBefore = releaseState(state.releaseId);
    const run = cli([...LOCAL, 'submit-review', '--yes', '--release', state.releaseId,
      '--decision', 'accept',
      '--reviewer', 'TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW',
      '--basis', 'TEST ONLY — a qualification run by an automated suite, not a cultural reading.',
      '--scope', 'TEST ONLY — the whole ordered definition, read for transport purposes only.',
      '--languages', 'en,ta', '--hash', state.digestBefore]);
    assert.equal(run.status, 2,
      `a stale digest must be an operator refusal (§25), got exit ${run.status} with ${run.err.slice(0, 600)}`);
    assert.ok(refusalLine(run.err), `not a REFUSED line: ${run.err.slice(0, 600)}`);
    assert.ok(!errorLine(run.err), 'a stale packet is an operator refusal, not a route error (§25)');
    // The other side of the same fact: the digest it was compared against came *from* the database,
    // so this refusal is necessarily after the session guard. Nothing was written — the row is
    // asserted unchanged below, which is what makes the ordering safe rather than merely tidy.
    assert.ok(CONNECTED(run.err), 'the pre-flight read the recomputed digest without connecting');
    assert.match(run.err, /stale/i);
    assert.ok(run.err.includes(state.digestBefore) && run.err.includes(state.digestAfter),
      'the refusal has to name both digests, or the operator cannot explain what moved');
    assert.equal(world(), before5, 'the stale submission wrote a row');
    assert.equal(releaseState(state.releaseId), stateBefore,
      'status, digest, reviewer fields and every timestamp must all be exactly as they were');
  });

  test('approve against a draft is the lifecycle refusal the database owns, not a digest refusal this tool invents', () => {
    // Pinned because the stale-digest pre-flight deliberately does *not* intercept this case: there
    // is no recorded binding yet, so "stale" would be a made-up reason for a row that has never
    // been reviewed. The guard's own sentence is the honest one, and it arrives as exit 1.
    const before5 = world();
    const stateBefore = releaseState(state.releaseId);
    const run = cli([...LOCAL, 'approve', '--yes', '--release', state.releaseId,
      '--hash', state.digestBefore]);
    assert.equal(run.status, 1, `got ${run.status}: ${run.err.slice(0, 600)}`);
    assert.match(run.err, /only a reviewed release can be approved/);
    assert.doesNotMatch(run.err, /stale/i, 'a draft has no binding to be stale against');
    assert.equal(world(), before5);
    assert.equal(releaseState(state.releaseId), stateBefore);
  });

  test('with the current digest the review is submitted, and the row records exactly the binding', () => {
    const run = cli([...LOCAL, 'submit-review', '--yes', '--release', state.releaseId,
      '--decision', 'accept',
      '--reviewer', 'TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW',
      '--basis', 'TEST ONLY — a qualification run by an automated suite, not a cultural reading.',
      '--scope', 'TEST ONLY — the whole ordered definition, read for transport purposes only.',
      '--languages', 'en,ta', '--hash', state.digestAfter]);
    assert.equal(run.status, 0, `submit-review with the current digest failed: ${run.err.slice(0, 900)}`);
    const body = run.json();
    assert.equal(body.status_before, 'draft');
    assert.equal(body.status_after, 'reviewed');
    assert.equal(body.recorded, true);
    assert.equal(body.review_packet_hash, state.digestAfter);
    assert.match(releaseState(state.releaseId), /"status": "reviewed"/);
    assert.ok(releaseState(state.releaseId).includes(state.digestAfter),
      'the digest the packet printed is the digest the row now carries');
    assert.match(releaseState(state.releaseId), /TEST FIXTURE REVIEWER/);
    // The reviewer is the label the operator typed, not an account id: a synthetic review must not
    // be able to point at a real user, and `reviewed_by` is the column that would hold one.
    assert.equal(sqlValue(`select coalesce(reviewed_by::text, '(null)')
      from public.tradition_pack_releases where id = '${state.releaseId}'::uuid`), '(null)',
      'the CLI submitted a review as some account; the maintenance identity must not be able to '
      + 'sign a cultural review as a person');
    assert.equal(sqlValue(`select review_label from public.tradition_pack_releases
      where id = '${state.releaseId}'::uuid`), 'TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW');
  });

  test('approve re-compares against the binding, so the stale digest still refuses and the fresh one works', () => {
    const before5 = world();
    const stateBefore = releaseState(state.releaseId);
    const stale = cli([...LOCAL, 'approve', '--yes', '--release', state.releaseId,
      '--hash', state.digestBefore]);
    assert.equal(stale.status, 2);
    assert.match(stale.err, /stale/i);
    assert.equal(world(), before5);
    assert.equal(releaseState(state.releaseId), stateBefore,
      'a refused approval must leave a reviewed row exactly reviewed');

    const ok = cli([...LOCAL, 'approve', '--yes', '--release', state.releaseId,
      '--hash', state.digestAfter]);
    assert.equal(ok.status, 0, `approve with the binding digest failed: ${ok.err.slice(0, 900)}`);
    assert.equal(ok.json().status_after, 'approved');
    assert.match(releaseState(state.releaseId), /"status": "approved"/);
    assert.notEqual(releaseState(state.releaseId), stateBefore);
  });

  test('deprecate closes the walk, and the digest binding survives it', () => {
    const run = cli([...LOCAL, 'deprecate', '--yes', '--release', state.releaseId]);
    assert.equal(run.status, 0, `deprecate failed: ${run.err.slice(0, 900)}`);
    const after = releaseState(state.releaseId);
    assert.match(after, /"status": "deprecated"/);
    assert.ok(after.includes(state.digestAfter),
      'retiring a release must not lose what its review was bound to');
    // And the reviewed-fields rule holds: a deprecated release is still readable, still bound, and
    // nothing here deleted it, because there is nothing here that could.
    assert.equal(sqlValue(`select count(*) from public.tradition_pack_releases where id = '${state.releaseId}'::uuid`), '1');
  });

  test('a retired release cannot be re-opened through this tool', () => {
    const before5 = world();
    const stateBefore = releaseState(state.releaseId);
    for (const [verb, extra] of [
      ['update-draft', ['--patch', definitionPath]],
      ['submit-review', ['--decision', 'accept', '--reviewer', 'TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW',
        '--basis', 'TEST ONLY — a second attempt by the qualification suite.',
        '--scope', 'TEST ONLY — the whole ordered definition, again.', '--languages', 'en,ta',
        '--hash', state.digestAfter]],
      ['approve', ['--hash', state.digestAfter]],
      ['deprecate', []],
    ]) {
      const run = cli([...LOCAL, verb, '--yes', '--release', state.releaseId, ...extra]);
      assert.ok(run.status !== 0, `${verb} succeeded against a deprecated release`);
      assert.match(run.err, /deprecated|draft|reviewed|refused|ERROR/);
    }
    assert.equal(releaseState(state.releaseId), stateBefore, 'a refused lifecycle step moved the row');
    assert.equal(world(), before5);
  });
});

// ======================================================================== §25's secret audit
describe('CLI-SECRET nothing the tool printed is a credential', () => {
  test('every invocation in this run, taken together, prints no secret of any class §25 names', () => {
    assert.ok(LEDGER.length >= 40, `only ${LEDGER.length} invocations were captured, so this audit is a sample`);
    const all = LEDGER.map((e) => `${e.out}\n${e.err}`).join('\n');

    // A password-bearing connection string, in either spelling libpq accepts.
    assert.ok(!/postgres(ql)?:\/\/[^\s/@]+:[^\s@]+@/.test(all),
      'output contains a URL with a user:password pair');
    for (const [name, value] of Object.entries(CANARY)) {
      assert.ok(!all.includes(value), `output contains the ${name} canary`);
    }
    assert.ok(!all.includes(`canary-pw-${RUN_TAG}`), 'output contains a canary password');
    for (const [name, value] of REAL_SECRETS) {
      assert.ok(!all.includes(value), `output contains ${name}`);
    }
    assert.ok(!/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(all),
      'output contains a JWT-shaped token');
    assert.ok(!/sb_secret|service_role_key|eyJhbGciOi/.test(all),
      'output names or carries a service-role credential');
    assert.ok(!/role\s*=\s*service_role/i.test(all), 'output reports a service_role session');
    // A raw invitation credential would be a long base64url run in a path segment.
    assert.ok(!/i\/[A-Za-z0-9_-]{20,}|\/p\/[A-Za-z0-9_-]{20,}/.test(all),
      'output contains something shaped like a live guest credential');
    assert.ok(!/PGPASS|~\/\.pgpass/.test(all), 'output points at a password file');

    // And the positive control on the control: the string the audit is *built* from must be
    // findable by the same search, or "no canary found" would only mean the canary was never there.
    const bait = `postgresql://postgres:canary-pw-${RUN_TAG}@10.20.30.40:5432/postgres`;
    assert.ok(/postgres(ql)?:\/\/[^\s/@]+:[^\s@]+@/.test(bait), 'the secret detector is mute');
    assert.ok(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(CANARY.jwt),
      'the JWT detector is mute');
  });

  test('the only identity the tool prints about itself is a role and a database, not a credential', () => {
    const run = cli([...LOCAL, 'list']);
    assert.match(run.err, /^# maintenance identity: (postgres|supabase_admin)@postgres$/m);
    assert.ok(!run.all.includes('@tcp'), 'the identity line printed a host');
    assert.ok(!run.all.includes(':5432'), 'the identity line printed a port');
  });

  test('the docker route — the one the header documents — needs no credential at all', () => {
    // The measured counterpart to the URL route: in `--via-docker` mode nothing secret is in this
    // process's environment (the psql runs inside the container, peer-authenticated), so the
    // strongest possible leak test is that a whole successful run mentions neither the canary URL
    // nor any part of it.
    const run = cli([...LOCAL, 'retention']);
    assert.equal(run.status, 0);
    assert.ok(!run.all.includes('127.0.0.1'), 'a loopback host appeared in a docker-routed run');
    assert.ok(!run.all.includes('54401'), 'a host port appeared in a docker-routed run');
    assert.ok(!run.all.includes('canary-pw'), 'a password appeared in a docker-routed run');
  });
});

// ============================================================================ the residue, printed
describe('CLI-RESIDUE what this run leaves behind, reported rather than asserted away', () => {
  test('the minted pack is TEST ONLY in every field a reader could mistake for a real review', (t) => {
    const row = sqlValue(`select jsonb_build_object(
        'pack_key', p.pack_key, 'scope', left(p.scope_statement, 9), 'status', r.status,
        'machine_assisted', r.machine_assisted, 'author_label', left(r.author_label, 24),
        'review_basis', left(r.review_basis, 9), 'hash', left(r.review_packet_hash, 12),
        'selected_by_weddings', (select count(*) from public.weddings w where w.tradition_pack_release_id = r.id),
        'versions_frozen', (select count(*) from public.invitation_versions v where v.tradition_pack_release_id = r.id))::text
      from public.tradition_pack_releases r join public.tradition_packs p on p.id = r.pack_id
      where p.pack_key = '${PACK_KEY}'`);
    t.diagnostic(`residue for run ${RUN_TAG}: ${row}`);
    assert.match(row, /"scope": "TEST ONLY"/);
    assert.match(row, /"status": "deprecated"/, 'the walk is supposed to end retired, and a run that '
      + 'left an approved pack behind would be adding a selectable choice to the local catalogue');
    assert.match(row, /"machine_assisted": true/);
    assert.match(row, /"review_basis": "TEST ONLY"/);
    // The disclosure, read whole rather than through a prefix: a machine-assisted release left in the
    // catalogue must not be able to imply that a person reviewed the wording. `machine_assisted` is
    // the flag §24 refuses to let a product silently treat as approved.
    const disclosure = sqlValue(`select jsonb_build_object(
        'author_label', r.author_label, 'notes', r.machine_assistance_notes,
        'review_basis', r.review_basis, 'review_scope', r.review_scope,
        'review_label', r.review_label)::text
      from public.tradition_pack_releases r join public.tradition_packs p on p.id = r.pack_id
      where p.pack_key = '${PACK_KEY}'`);
    t.diagnostic(`disclosure: ${disclosure.slice(0, 700)}`);
    assert.match(disclosure, /no human cultural review has been recorded/i,
      'the author label does not disclaim a human review');
    assert.match(disclosure, /"review_basis": "TEST ONLY/);
    assert.match(disclosure, /"review_scope": "TEST ONLY/);
    assert.match(disclosure, /NOT A REAL CULTURAL REVIEW/);
    assert.match(row, /"selected_by_weddings": 0/);
    assert.match(row, /"versions_frozen": 0/);
  });

  test('the local catalogue keeps growing by design, and that is stated, not hidden', (t) => {
    // Ruling A2 refuses DELETE of a release that has left `draft`, so this run's pack is permanent
    // until the next `npx supabase db reset --local --no-seed`. Every run mints its own key, so the
    // count of `stage5_cli_%` packs is a history of runs — printed, never depended on. The only
    // per-run assertion is about THIS run's key, which is what makes the file re-runnable.
    const previousRuns = Number(sqlValue(`select count(distinct p.pack_key)
      from public.tradition_pack_releases r join public.tradition_packs p on p.id = r.pack_id
      where p.pack_key like 'stage5_cli_%'`));
    t.diagnostic(`this run's key: ${PACK_KEY}; runs recorded in the catalogue so far: ${previousRuns};`
      + ` tradition_packs: ${sqlValue('select count(*) from public.tradition_packs')};`
      + ` tradition_pack_releases: ${sqlValue('select count(*) from public.tradition_pack_releases')}`);
    assert.equal(sqlValue(`select count(*) from public.tradition_pack_releases r
      join public.tradition_packs p on p.id = r.pack_id
      where p.pack_key = '${PACK_KEY}'`), '1',
      'this run minted exactly one release; a second would mean the file re-mints mid-walk');
    assert.equal(sqlValue(`select count(*) from public.tradition_packs p
      where p.scope_statement not like 'TEST ONLY%'`), '0',
      'a pack without a TEST ONLY scope statement is in the local catalogue');
    // The safety property behind that: nothing that is not a test fixture is customer-selectable.
    // This is also where the Tamil candidate is measured — it is a content FILE in this build, not a
    // catalogue row, so "no approved release of a non-fixture pack" is what this run can honestly
    // assert about it. §23's suite is what pins the candidate file itself.
    assert.equal(sqlValue(`select count(*) from public.tradition_packs p
      join public.tradition_pack_releases r on r.pack_id = p.id
      where p.scope_statement not like 'TEST ONLY%' and r.status = 'approved'`), '0',
      'a pack this file did not mint has become customer-selectable');
    const tamil = sqlValue(`select coalesce(string_agg(p.pack_key || '=' || r.status, ', '
        order by p.pack_key), '(no pack key matching %tamil%)')
      from public.tradition_packs p
      join public.tradition_pack_releases r on r.pack_id = p.id
      where p.pack_key like '%tamil%'`);
    t.diagnostic(`the Tamil candidate as the catalogue sees it: ${tamil}`);
  });
});
