// The gate in front of a deployment, and the tool that would run it.
//
// Why this file exists at all. `src/host/pages-worker.ts` answers a crawler's first byte, and
// `scripts/host-response-contract.mjs` measures that answer on a real Cloudflare runtime — on
// `127.0.0.1` only, because a tier that could be reached from outside the machine would itself be a
// deployment. This is the other half: the thing that would put those bytes on a public origin, and the
// reason the repository can say *how* it would be done without pretending it has been done.
//
// What it refuses, and why each refusal is here rather than in a checklist:
//
//   * **A missing or half-set configuration.** A Worker with one of its two browser-safe variables
//     answers `host-unconfigured` and serves no card, which is a correct fallback and a confusing
//     incident. The gate wants both values or neither, and says so before an upload rather than after.
//   * **A privileged value in any position.** A service-role JWT, a `sb_secret_…` key, a
//     `postgres://user:pass@…` connection string and a PEM private key are refused as a *binding*, as
//     an *inlined build value*, and inside anything wrangler prints back. One class, four doors, because
//     this is the failure that cannot be undone afterwards: a secret in a browser bundle is already in
//     every customer's hands, not sitting in a file somebody can rotate at leisure.
//   * **A built bundle that disagrees with the binding.** `vite build` inlines `VITE_SUPABASE_URL` and
//     `VITE_SUPABASE_PUBLISHABLE_KEY` into `dist/assets/*.js`; the Worker reads its own copy at request
//     time. If the two name different projects, the page a guest loads and the card a chat app reads
//     describe two different weddings, and neither runtime can see the mismatch. So each handed value
//     must be present in the bytes being uploaded.
//   * **An origin no guest can reach.** The URL goes through `originRefusal` from
//     `src/render/qrTarget.ts` — the same rule that refuses to print a QR pointing at a laptop — so a
//     deployment tool cannot start accepting what the printer refuses.
//   * **An existing project it does not recognise.** The account this runs on already holds unrelated
//     projects; creating is fine, writing over somebody else's site is not, so `--apply` needs
//     `--allow-existing-project` once the name is taken.
//
// What this has NOT done, stated because the file would otherwise read as a finished deployment: the
// `--apply` path has never been run. There is no hosted browser-safe pair to hand it yet — the
// dedicated Supabase project's keys have not been read into this repository, and the CLI that would
// print them is unauthenticated — so the only modes ever executed here are `--self-test` and the
// default dry-run, neither of which writes to Cloudflare. The pure guards are pinned by
// `scripts/deploy-pages.test.mjs`, which `npm test` picks up through `vitest.config.ts`.
//
// Secrets travel on stdin, never in argv: `wrangler pages secret put <name>` reads the value from its
// standard input, so the planned command list, a shell's job history, `ps`, and this tool's own
// transcript can each be read without anybody's key in them. The CLI offers no way to choose a Pages
// *environment* (`--project-name` is `secret put`'s only option, read from `--help`), so after an apply
// the operator confirms in the dashboard which environment the two bindings landed in — a preview URL
// is not proof that production got them.
//
// Usage:
//   npm run pages:build                          the artefacts this tool uploads
//   node scripts/deploy-pages.mjs --self-test     the guards, against fixed hostile and benign input
//   node scripts/deploy-pages.mjs                 preflight + the exact commands, no writes to anyone
//   node scripts/deploy-pages.mjs --apply         run them (refuses on any preflight problem)
//
// Env: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (the browser-safe pair, read from the
//      environment and never printed), PAGES_DIST_DIR, DEPLOY_EVIDENCE_DIR, WRANGLER_BIN.
// Exit 0 = the run did what it claimed. Exit 1 = a preflight problem or a failed wrangler step, each of
// which is a statement about this deployment. There is no third code: a missing build and a missing
// wrangler are reported as problems rather than as a skip, because a guard that could not see is not a
// guard that passed.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { originRefusal } from '../src/render/qrTarget.ts';
import { locateWrangler as locateWranglerFor } from './wrangler-location.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(process.env.PAGES_DIST_DIR ?? join(ROOT, 'dist'));
const EVIDENCE_ROOT = resolve(process.env.DEPLOY_EVIDENCE_DIR ?? join(ROOT, '..', 'p1-logs'));

/** The Worker's two bindings, named exactly as `src/host/pages-worker.ts` declares them and exactly as
 *  the browser build reads them. One pair of names on both sides is what makes the parity check below
 *  meaningful: two spellings of "the project URL" is how a staging origin ends up calling a production
 *  database. */
const SAFE_BINDINGS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];

/** The runtime the loopback tier is certified against, reused deliberately: a Worker deployed under a
 *  different compatibility date than the one that measured it is a Worker that measurement does not
 *  describe. */
export const COMPATIBILITY_DATE = '2026-09-26';

/** wrangler colours its own output even into a pipe, which is the same hazard
 *  `scripts/host-response-contract.mjs` documents for its log reader. */
const stripAnsi = (text) => text.replace(/\u001B\[[0-9;]*m/g, '');

// ------------------------------------------------------------- the privileged class, in one list

/** The three base64url segments of a JWT, loose enough to catch a real key and tight enough that a
 *  dot-separated version string is not mistaken for one. */
const JWT_CANDIDATE = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

const jwtPayloadText = (token) => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return Buffer.from(parts[1], 'base64url').toString('utf8');
  } catch {
    return null;
  }
};

/**
 * Every shape that must never reach a browser, a Worker binding, a log line or a transcript.
 *
 * A *shape*, not a value: the tool has no list of this project's keys, and a rule that only matched a
 * known secret would be a rule about yesterday. Each `find` returns the matches rather than a boolean,
 * because a refusal that cannot say which door it closed is a refusal an operator cannot act on.
 *
 * Deliberately narrower than it looks. `sb_secret_` **followed by token characters** is Supabase's
 * secret-key format; the bare nine characters also occur inside `@supabase/supabase-js`, whose own
 * key-shape predicate is `t.startsWith("sb_publishable_")||t.startsWith("sb_secret_")`, and that
 * appears in every bundle this product ships — the finding is recorded and explained in
 * `docs/audits/stage-6-storage-assets.md` §1324. A scanner that flagged the library's own comparison
 * would be a scanner that always says no, which is how a real guard gets switched off.
 */
export const PRIVILEGED_SHAPES = [
  {
    name: 'supabase-secret-key',
    find: (text) => text.match(/sb_secret_[A-Za-z0-9_-]{6,}/g) ?? [],
  },
  {
    name: 'service-role-jwt',
    find: (text) => (text.match(JWT_CANDIDATE) ?? []).filter((t) => {
      const payload = jwtPayloadText(t);
      return payload !== null && (payload.includes('service_role') || payload.includes('"scope":"privileged"'));
    }),
  },
  {
    name: 'connection-string-with-credentials',
    find: (text) => text.match(/post(?:gres|gresql):\/\/[^\s"'`]*?:[^\s"'`@]*@[^\s"'`]*/g) ?? [],
  },
  {
    name: 'private-key-block',
    find: (text) => text.match(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g) ?? [],
  },
];

/** `{ rule, count }` for every privileged shape present in `text`, longest name first so the report
 *  reads as a list of findings rather than a boolean that says nothing. */
export const privilegedFindings = (text) =>
  PRIVILEGED_SHAPES.map((rule) => ({ rule: rule.name, count: rule.find(text).length })).filter(
    (finding) => finding.count > 0,
  );

/** What kind of value this is, in words that are safe to print. Publishable by construction, or
 *  unnamed — and unnamed is refused below rather than waved through, because "it isn't a secret key" is
 *  not the same claim as "it is the browser-safe key", and only the second one is checkable here. */
export const keyKind = (value) => {
  if (value.startsWith('sb_publishable_')) return 'supabase-publishable-key';
  const payload = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
    ? jwtPayloadText(value)
    : null;
  if (payload !== null && /"role"\s*:\s*"anon"/.test(payload)) return 'legacy-anon-jwt';
  return 'unrecognised-key-shape';
};

// ------------------------------------------------------------- the preflight, as a pure function

/**
 * Every reason this deployment should not happen, or an empty list.
 *
 * Pure and value-blind by construction: it takes the built text and the two strings, and returns
 * sentences. Nothing in it can print a value, which is the property that lets the transcript, the
 * exit code and a unit test all speak the same language about a key nobody should ever see.
 *
 * @param {{ url: string, key: string, builtFiles: {path:string,text:string}[],
 *           missingArtefacts: string[], existingProject: boolean,
 *           allowExistingProject: boolean }} input
 * @returns {string[]}
 */
export function preflight({
  url,
  key,
  builtFiles,
  missingArtefacts,
  existingProject,
  allowExistingProject,
}) {
  const problems = [];

  for (const [name, value] of [
    ['VITE_SUPABASE_URL', url],
    ['VITE_SUPABASE_PUBLISHABLE_KEY', key],
  ]) {
    if (value === undefined || value.trim() === '') {
      problems.push(`${name} is not set — a Worker without both bindings answers host-unconfigured.`);
      continue;
    }
    const privileged = privilegedFindings(value);
    if (privileged.length > 0) {
      problems.push(
        `${name} carries a privileged shape (${privileged.map((f) => `${f.rule} ×${f.count}`).join(', ')}) — ` +
          'service-role and secret values never belong in a browser bundle or a Worker binding.',
      );
    }
  }

  if (url !== undefined && url.trim() !== '' && privilegedFindings(url).length === 0) {
    const refusal = originRefusal(url);
    if (refusal !== null) {
      problems.push(`VITE_SUPABASE_URL origin refused by the printed-address rule: ${refusal}.`);
    }
  }

  if (key !== undefined && key.trim() !== '' && privilegedFindings(key).length === 0) {
    const kind = keyKind(key);
    if (kind === 'unrecognised-key-shape') {
      problems.push(
        'VITE_SUPABASE_PUBLISHABLE_KEY is neither a sb_publishable_… key nor an anon JWT — ' +
          'the tool refuses a key it cannot name, because "not a secret" and "browser-safe" are different claims.',
      );
    }
  }

  for (const artefact of missingArtefacts) {
    problems.push(`${artefact} is missing from the build — run \`npm run pages:build\` first.`);
  }

  for (const file of builtFiles) {
    const privileged = privilegedFindings(file.text);
    if (privileged.length > 0) {
      problems.push(
        `built bytes at ${file.path} carry privileged shapes: ` +
          privileged.map((f) => `${f.rule} ×${f.count}`).join(', '),
      );
    }
  }

  // The parity rule, and the reason it is a presence test rather than a comparison: the bundle was
  // built with whatever the environment held at build time, and the Worker will be handed whatever the
  // environment holds now. Both facts are available here; the build log is not.
  for (const [name, value] of [
    ['VITE_SUPABASE_URL', url],
    ['VITE_SUPABASE_PUBLISHABLE_KEY', key],
  ]) {
    if (value === undefined || value.trim() === '' || privilegedFindings(value).length > 0) continue;
    if (!builtFiles.some((file) => file.text.includes(value))) {
      problems.push(
        `${name} was handed to the Worker but is not present in the built bundle — ` +
          'the page and the card would describe two different projects. Rebuild with the same environment.',
      );
    }
  }

  if (existingProject && !allowExistingProject) {
    problems.push(
      'the Pages project name already exists on this account — pass --allow-existing-project ' +
        'only after confirming it is this product\'s own project.',
    );
  }

  return problems;
}

// ------------------------------------------------------------- what would be run

/**
 * The command list, as data.
 *
 * No value is in any `argv`: the two bindings go to wrangler's standard input, which is why the dry run
 * is safe to print in full and safe to keep. `secret` marks the steps whose stdin carries a value, so
 * a future transcript writer can see which lines it must not echo.
 */
export function planCommands({ project, branch, productionBranch, distDir, createProject, commit }) {
  const steps = [
    { label: 'read the project list (no writes)', secret: false, argv: ['pages', 'project', 'list'] },
  ];
  if (createProject) {
    steps.push({
      label: 'create the Pages project',
      secret: false,
      argv: [
        'pages',
        'project',
        'create',
        project,
        '--production-branch',
        productionBranch,
        '--compatibility-date',
        COMPATIBILITY_DATE,
      ],
    });
  }
  for (const binding of SAFE_BINDINGS) {
    steps.push({
      label: `bind ${binding} (value on stdin, never in argv)`,
      secret: true,
      argv: ['pages', 'secret', 'put', binding, '--project-name', project],
    });
  }
  const deployArgv = ['pages', 'deploy', distDir, '--project-name', project, '--branch', branch];
  if (commit !== null) {
    deployArgv.push('--commit-hash', commit.sha, '--commit-message', commit.message);
    if (commit.dirty) deployArgv.push('--commit-dirty');
  }
  steps.push({ label: 'upload the built directory', secret: false, argv: deployArgv });
  return steps;
}

/** Every `https://…pages.dev` URL wrangler printed, deduplicated and ordered as seen. Read out of the
 *  tool's own words rather than composed here, because a guessed Pages URL shape is how a report ends
 *  up naming an address that answers nothing. */
export const deploymentUrls = (text) =>
  [...new Set(stripAnsi(text).match(/https:\/\/[A-Za-z0-9._-]+\.pages\.dev/g) ?? [])];

/**
 * Is this project name in `wrangler pages project list`'s output?
 *
 * wrangler prints a box-drawing table and takes no `--json` flag (`wrangler pages project list --help`,
 * whose global flags are `--cwd`, `--env-file`, `--install-skills`, `--profile`, `-h`, `-v`), so this
 * reads a *cell*: a name bounded by the table's own verticals. A plain substring test would answer "yes,
 * it exists" for a name that is merely a prefix of somebody else's domain, which is exactly the
 * wrong-project collision this check exists to catch.
 */
export function projectListContains(text, name) {
  const verticals = '[│|]';
  const pattern = new RegExp(
    `${verticals}\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*${verticals}`,
  );
  return pattern.test(stripAnsi(text));
}

/** Replace anything privileged-shaped, and either handed value, with a named mask. Applied to every
 *  captured wrangler stream before it reaches the transcript or the console. */
export function redact(text, values = []) {
  let out = text;
  for (const rule of PRIVILEGED_SHAPES) {
    for (const hit of rule.find(out)) out = out.split(hit).join(`‹masked:${rule.name} len=${hit.length}›`);
  }
  for (const value of values) {
    if (value === undefined || value === '') continue;
    out = out.split(value).join(`‹masked:binding-value len=${value.length}›`);
  }
  return out;
}

// ------------------------------------------------------------- the harness

const artefactPresent = (name) => existsSync(join(OUT_DIR, name));

/** Everything under `dist` that is text, so the built-bytes scan sees what a customer would download.
 *  Binary artefacts (fonts, images) are counted and named in the report rather than silently skipped: a
 *  scan that quietly ignores half the upload directory is not a scan. */
function readBuiltFiles(dir) {
  const textFiles = [];
  const binary = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      const rel = join(prefix, entry.name);
      if (entry.isDirectory()) walk(abs, rel);
      else if (/\.(?:js|mjs|cjs|css|html|json|txt|svg|xml|map)$/i.test(entry.name)) {
        textFiles.push({ path: rel, text: readFileSync(abs, 'utf8') });
      } else binary.push(rel);
    }
  };
  walk(dir, '');
  return { textFiles, binary };
}

/** The one line this tool prints about each binding. Exported because "never print the value" is the
 *  rule most likely to be broken by a well-intentioned diagnostic, and a rule like that is worth a test
 *  that hands it a value and looks for it in the sentence. */
export function describeBinding(name, value) {
  if (value === undefined || value.trim() === '') return `${name}: <absent>`;
  if (name.endsWith('_URL')) {
    let host = 'unparsable';
    try {
      host = new URL(value).host;
    } catch {
      /* reported as a problem below */
    }
    return `${name}: host=${host} length=${value.length} originRule=${originRefusal(value) ?? 'accepted'}`;
  }
  const privileged = privilegedFindings(value);
  const shape = privileged.length > 0 ? `PRIVILEGED(${privileged.map((f) => f.rule).join(',')})` : keyKind(value);
  return `${name}: length=${value.length} shape=${shape}`;
};

const arg = (name, argv) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1] ?? null;
};

function gitCommit() {
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  if (sha.status !== 0) return null;
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const short = sha.stdout.trim().slice(0, 7);
  return {
    sha: sha.stdout.trim(),
    dirty: dirty.status === 0 && dirty.stdout.trim() !== '',
    message: `deployed by scripts/deploy-pages.mjs from ${branch.status === 0 ? branch.stdout.trim() : 'unknown-branch'} @ ${short}`,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const selfTest = argv.includes('--self-test');
  const project = arg('project', argv) ?? 'vivaahvarnam-pilot';
  const branch = arg('branch', argv) ?? 'pilot-staging';
  const productionBranch = arg('production-branch', argv) ?? 'main';

  if (selfTest) {
    const { passed, failed } = selfTestGuards();
    console.log(`deploy-pages self-test: ${passed} passed, ${failed.length} failed`);
    for (const line of failed) console.log(`  FAIL ${line}`);
    process.exitCode = failed.length === 0 ? 0 : 1;
    return;
  }

  const url = process.env.VITE_SUPABASE_URL ?? '';
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  const missing = ['index.html', '_worker.js', '_routes.json'].filter((name) => !artefactPresent(name));
  const { textFiles, binary } = missing.length === 0 ? readBuiltFiles(OUT_DIR) : { textFiles: [], binary: [] };
  const located = locateWranglerFor(import.meta.url);

  console.log('deploy-pages preflight');
  console.log(`  project=${project} branch=${branch} production-branch=${productionBranch}`);
  console.log(`  dist=${OUT_DIR} text files scanned=${textFiles.length} binary files not scanned=${binary.length}`);
  console.log(`  ${describeBinding('VITE_SUPABASE_URL', url)}`);
  console.log(`  ${describeBinding('VITE_SUPABASE_PUBLISHABLE_KEY', key)}`);
  console.log(`  wrangler: ${located === null ? 'NOT FOUND' : `${located.path} (via ${located.from})`}`);

  // Every wrangler step runs from an empty directory of its own, outside the repository. Two measured
  // reasons, both taken from scripts/host-response-contract.mjs's header: `pages dev` discovers a
  // `.env.local` in its *working directory* — where this repository's copy carries the local stack's
  // service-role key — and wrangler writes its miniflare cache as `.wrangler/` relative to the same
  // directory. Neither belongs next to a deploy, and the second one is why a run of this tool must not
  // leave anything inside the tree a whole-gate sweep reads.
  const runDir = join(EVIDENCE_ROOT, `h3-deploy-${Date.now().toString(36)}`);
  let existingProject = false;
  let projectListVerified = false;
  if (located !== null) {
    mkdirSync(runDir, { recursive: true });
    const listRun = runWrangler(located, ['pages', 'project', 'list'], { cwd: runDir, mask: [url, key] });
    if (listRun.status === 0) {
      existingProject = projectListContains(listRun.text, project);
      projectListVerified = true;
      console.log(`  project list read from an empty directory: ${existingProject ? 'name is taken' : 'name is free'}`);
    } else {
      console.log(`  project list failed (exit=${listRun.status}); the name is unverified.`);
    }
  }

  const problems = preflight({
    url,
    key,
    builtFiles: textFiles,
    missingArtefacts: missing,
    existingProject,
    allowExistingProject: argv.includes('--allow-existing-project'),
  });
  if (!projectListVerified) {
    problems.push(
      'wrangler was not found or its project list failed, so this run cannot prove the name is free — ' +
        'a create over an unknown project is exactly the wrong-project write the check above exists to stop.',
    );
  }

  const steps = planCommands({
    project,
    branch,
    productionBranch,
    distDir: OUT_DIR,
    createProject: !existingProject,
    commit: gitCommit(),
  });

  console.log('  planned commands (each line is the invocation this run would make; a secret step reads its value on stdin):');
  for (const step of steps) {
    console.log(`    ${showArgv(located, step.argv)}${step.secret ? '   [value on stdin]' : ''}`);
  }

  if (problems.length > 0) {
    console.log(`  PREFLIGHT PROBLEMS (${problems.length}):`);
    for (const problem of problems) console.log(`    - ${problem}`);
    console.log('  nothing was uploaded.');
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log('  preflight clean. Dry run only: no project was created, no binding set, no bytes uploaded.');
    console.log('  Re-run with --apply once the hosted browser-safe pair is in the environment.');
    process.exitCode = 0;
    return;
  }

  // Only reached with a clean preflight, which already requires a wrangler that answered a project list.
  const transcript = [];
  for (const step of steps) {
    const value = step.secret ? (step.argv[3] === 'VITE_SUPABASE_URL' ? url : key) : undefined;
    const run = runWrangler(located, step.argv, { cwd: runDir, value, mask: [url, key] });
    transcript.push(`$ ${showArgv(located, step.argv)}${step.secret ? ' [value on stdin, not shown]' : ''}\n${run.text}\nexit=${run.status}`);
    console.log(`  ${step.label}: exit=${run.status}`);
    if (run.status !== 0) {
      writeFileSync(join(runDir, 'transcript.txt'), transcript.join('\n---\n'));
      console.log(`  FAILED at ${step.label}; transcript (masked) at ${join(runDir, 'transcript.txt')}`);
      console.log('  the deployment is partial: check `wrangler pages deployment list` before retrying.');
      process.exitCode = 1;
      return;
    }
    if (step.argv[1] === 'deploy') {
      const urls = deploymentUrls(run.text);
      console.log(`  uploaded. URLs read back from wrangler: ${urls.length === 0 ? '(none printed)' : urls.join(', ')}`);
    }
  }
  writeFileSync(join(runDir, 'transcript.txt'), transcript.join('\n---\n'));
  console.log(`  transcript (masked) at ${join(runDir, 'transcript.txt')}`);
  console.log('  Still to verify by hand, in the Cloudflare dashboard: which environment holds the two bindings.');
  process.exitCode = 0;
}

/** One planned command, printed as the invocation it describes: the literal word `node` for the
 *  interpreter (this file runs its steps through `process.execPath`, and the interpreter's own path is
 *  not what an operator needs to see), the resolved wrangler entry that will actually be executed, then
 *  every argument — each quoted when it contains whitespace, which it certainly does on this machine,
 *  where every path runs through `Pavithran R A`. An unquoted transcript line is not a transcript: a
 *  copied `--commit-message` whose value is three words would create a different deployment than the
 *  one that was planned.
 *
 *  It never prints a value: the secret steps carry the value on standard input, so their arguments are
 *  all this function can see, and the caller marks them by hand. */
const showArgv = (located, argv) => {
  const quote = (value) => (/\s/.test(value) ? `"${value}"` : value);
  const entry = located === null ? 'wrangler' : located.path;
  return ['node', entry, ...argv].map(quote).join(' ');
};

/** One wrangler invocation, with its output stripped of colour and of anything privileged-shaped before
 *  anything reads it. `value` is written to standard input only when a step needs it — the `input`
 *  option is added conditionally so a non-secret step never inherits a pipe it did not ask for. */
function runWrangler(located, argv, { cwd, value, mask = [] }) {
  const options = { cwd, encoding: 'utf8' };
  if (value !== undefined) options.input = value;
  const run = spawnSync(process.execPath, [located.path, ...argv], options);
  const text = redact(stripAnsi(`${run.stdout ?? ''}\n${run.stderr ?? ''}`), mask);
  return { status: run.status === null ? 'signal' : run.status, text, error: run.error ?? null };
}

/** The guard battery, run by `--self-test`.
 *
 *  It is written the way `docs/audits/stage-6-storage-assets.md` §1324 insists instrumentation be
 *  written: every hostile input is paired with the benign thing it resembles, because a rule that
 *  fires on everything is indistinguishable from a rule that fires on nothing, and a guard that always
 *  says "stop" is a guard the next operator deletes. Exported so `scripts/deploy-pages.test.mjs` runs
 *  the same battery `npm test` sees, in the same order, rather than a paraphrase of it. */
export function selfTestGuards() {
  const checks = [];
  const expect = (label, condition) => checks.push({ label, ok: condition === true });

  const benignUrl = 'https://bohtowyresjgroaeashi.supabase.co';
  const benignKey = 'sb_publishable_AAAAAAAAAAAAAAAAAAAAAA';
  const serviceRoleJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(
    '{"role":"service_role","iss":"supabase"}',
  ).toString('base64url')}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  const anonJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(
    '{"role":"anon","iss":"supabase"}',
  ).toString('base64url')}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  const built = [{ path: 'assets/index.js', text: `${benignUrl} ${benignKey}` }];

  expect('a browser-safe pair with a matching bundle passes', preflight({
    url: benignUrl, key: benignKey, builtFiles: built, missingArtefacts: [], existingProject: false, allowExistingProject: false,
  }).length === 0);
  expect('a service-role JWT is refused as a binding', preflight({
    url: benignUrl, key: serviceRoleJwt, builtFiles: built, missingArtefacts: [], existingProject: false, allowExistingProject: false,
  }).some((p) => p.includes('service-role-jwt')));
  expect('an anon JWT of the same length is not', privilegedFindings(anonJwt).length === 0);
  expect('a sb_secret_ value is refused', privilegedFindings('sb_secret_ABCDEFGHIJKLMNOP').length === 1);
  expect('the library\'s bare sb_secret_ predicate is not', privilegedFindings('t.startsWith("sb_secret_")').length === 0);
  expect('a connection string with credentials is refused', privilegedFindings('postgres://u:p@host:5432/db').length === 1);
  expect('a private key block is refused', privilegedFindings('-----BEGIN PRIVATE KEY-----').length === 1);
  expect('a missing binding is a problem, not a silent pass', preflight({
    url: '', key: benignKey, builtFiles: built, missingArtefacts: [], existingProject: false, allowExistingProject: false,
  }).some((p) => p.includes('VITE_SUPABASE_URL')));
  expect('a loopback origin is refused by the printed-address rule', preflight({
    url: 'http://127.0.0.1:54321', key: benignKey, builtFiles: built, missingArtefacts: [], existingProject: false, allowExistingProject: false,
  }).some((p) => p.includes('target-not-https')));
  expect('a localhost origin is refused by name', preflight({
    url: 'https://localhost:54321', key: benignKey, builtFiles: built, missingArtefacts: [], existingProject: false, allowExistingProject: false,
  }).some((p) => p.includes('target-origin-not-public')));
  expect('a key the tool cannot name is refused', preflight({
    url: benignUrl, key: 'hunter2hunter2', builtFiles: built, missingArtefacts: [], existingProject: false, allowExistingProject: false,
  }).some((p) => p.includes('cannot name')));
  expect('a bundle that disagrees with the bindings is refused', preflight({
    url: benignUrl, key: benignKey, builtFiles: [{ path: 'assets/index.js', text: 'https://other.supabase.co sb_publishable_BBBBBBBBBBBBBBBBBBBBBB' }],
    missingArtefacts: [], existingProject: false, allowExistingProject: false,
  }).filter((p) => p.includes('two different projects')).length === 2);
  expect('a privileged value hidden inside the built bytes is refused', preflight({
    url: benignUrl, key: benignKey,
    builtFiles: [{ path: 'assets/index.js', text: `${benignUrl} ${benignKey} ${serviceRoleJwt}` }],
    missingArtefacts: [], existingProject: false, allowExistingProject: false,
  }).some((p) => p.includes('built bytes at assets/index.js')));
  expect('a missing worker bundle is refused', preflight({
    url: benignUrl, key: benignKey, builtFiles: built, missingArtefacts: ['_worker.js'], existingProject: false, allowExistingProject: false,
  }).some((p) => p.includes('_worker.js')));
  expect('an existing project is refused without the explicit flag', preflight({
    url: benignUrl, key: benignKey, builtFiles: built, missingArtefacts: [], existingProject: true, allowExistingProject: false,
  }).some((p) => p.includes('already exists')));
  expect('no create step is planned for an existing project', planCommands({
    project: 'p', branch: 'b', productionBranch: 'main', distDir: 'd', createProject: false, commit: null,
  }).every((s) => !s.argv.includes('create')));
  expect('a planned command never carries a value in its arguments', planCommands({
    project: 'p', branch: 'b', productionBranch: 'main', distDir: 'd', createProject: true, commit: null,
  }).every((s) => !s.argv.join(' ').includes(benignKey) && !s.argv.join(' ').includes(benignUrl)));
  expect('the binding steps put values on stdin instead', planCommands({
    project: 'p', branch: 'b', productionBranch: 'main', distDir: 'd', createProject: true, commit: null,
  }).filter((s) => s.secret).length === SAFE_BINDINGS.length);
  const printedPlan = planCommands({
    project: 'vivaahvarnam-pilot', branch: 'b', productionBranch: 'main', distDir: 'dist',
    createProject: true, commit: { sha: 'aaaa1111', message: 'pilot build from head', dirty: false },
  }).map((step) => showArgv({ path: 'C:\\a b\\cli.js' }, step.argv)).join('\n');
  expect('the printed plan quotes a multi-word commit message', printedPlan.includes('"pilot build from head"'));
  expect('the printed plan carries no binding value', !printedPlan.includes(benignKey) && !printedPlan.includes(benignUrl));
  expect('urls are read back from wrangler words, not composed', deploymentUrls('\u001B[32mDeployed https://abc123.p.pages.dev!\u001B[0m').length === 1);
  // Transcribed from `wrangler pages project list` run against this account (which holds one unrelated
  // project), because that table is the only input this check has ever had and a fixture invented from
  // memory of a CLI's ASCII art is how a name-free run turns into a name-taken run.
  const realTable =
    '┌──────────────┬────────────────────────┬──────────────┬───────────────┐\n' +
    '│ Project Name │ Project Domains        │ Git Provider │ Last Modified │\n' +
    '├──────────────┼────────────────────────┼──────────────┼───────────────┤\n' +
    '│ sonamark-web │ sonamark-web.pages.dev │ No           │ 1 month ago   │\n' +
    '└──────────────┴────────────────────────┴──────────────┴───────────────┘';
  expect('the name in that table is found', projectListContains(realTable, 'sonamark-web') === true);
  expect('a name that is not in it is not found', projectListContains(realTable, 'vivaahvarnam-pilot') === false);
  expect('a prefix of a domain cell is not the project name', projectListContains(realTable, 'sonamark') === false);
  expect('a privileged value in a transcript is masked', redact(`got ${serviceRoleJwt}`, [serviceRoleJwt]).includes('masked:service-role-jwt'));
  expect('masking leaves the surrounding words intact', !redact(`got ${serviceRoleJwt}`, []).includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
  expect('the compatibility date matches the certified runtime', COMPATIBILITY_DATE === '2026-09-26');

  const failed = checks.filter((c) => !c.ok).map((c) => c.label);
  return { passed: checks.length - failed.length, failed };
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
