// S9-8e: the trusted local publisher — render, register, upload, read back, verify, then say `ready`.
//
// What this process is. It is the one place in Stage 9 that holds a service-role credential, a database
// session that can write `public.invitation_outputs`, and the bytes Chromium just drew, all at once. It
// runs on the operator's machine against the local stack, from a command line, and nothing in the
// product calls it. Everything a host sees is the manifest those rows leave behind.
//
// What it does per artefact, in this order and no other:
//
//   1. ask the worker to draw it (`scripts/stage9-render-worker.mjs`, the only renderer in the repo);
//   2. read the file back off disk and verify it against the worker's own record, *before* a write
//      statement runs — a truncated file costs a refusal, not a manifest row;
//   3. register it with an INSERT that cannot name `object_key` or `status`, and read the key the
//      trigger minted out of the same statement;
//   4. step the row `registered -> uploading`;
//   5. upload the actual bytes into the private bucket through the Storage API;
//   6. download the object again from Storage — not from disk, and not from the upload's answer;
//   7. verify those bytes: digest, length, served content type, and the geometry the file states about
//      itself;
//   8. only then `uploading -> ready`, carrying the digest that verification produced.
//
// The worst outcome this stage can produce is a row that says `ready` about bytes that are not there,
// so every rule below is that idea applied one step earlier: the status moves last; a failure removes
// the object before it names itself in `last_error` (delete-then-mark, §12); a superseded `ready` row is
// retired rather than overwritten; and a step that cannot be recorded is reported instead of skipped.
// A retired plate's `invalidation_reason` is decided before its object goes away, from the two target
// digests — the same-address `superseded` and the rotated-away `token_rotated` are different sentences
// on the host's panel, and a run that deleted first could only guess which one it had caused.
// The legal moves, the column map each one carries, the plan for a slot that already holds a row and
// the verification of a read-back all live in `scripts/stage9-publish-core.mjs`, which is pure. This
// file supplies the channels and the order, and `scripts/stage9-output-publisher.test.mjs` pins both.
//
// Two things this file never does, stated because both would be easy to slip in:
//   * **No DELETE against the manifest.** The migration refuses one while a row is `ready` or
//     `uploading` (`supabase/migrations/20261013120000_stage9_render_outputs.sql:404-410`), and §12's
//     answer to a stale artefact is remove-the-object-then-mark-the-row. `reconcileSlot` is built so
//     every stale row has a legal mark; a plan that needed a deletion would be a bug, and the core's
//     battery asserts the absence in the statements this file can emit.
//   * **No credential and no raw target address in any line it prints or writes.** The service key, the
//     publishable key and a plate's target URL pass through `makeRedactor()` on the way to stdout and
//     into the run record. A plate's target reaches this process only through an environment variable
//     named by an option — never as an argument, because argv lands in shell history — and is recorded
//     only as its SHA-256, which is the value the manifest stores. Recovering or minting an invitation
//     token is not this tool's job: an operator drawing a plate points it at the address the product
//     already published.
//
// Usage (a mutating run needs `--yes`; without it the channels themselves refuse a write):
//   node scripts/stage9-output-publisher.mjs --version <uuid> --via-docker supabase_db_localvivaahvarnam
//   node scripts/stage9-output-publisher.mjs --version <uuid> --db-url-env --kinds og,share,pdf,qr \
//     --qr-variants 40mm --qr-target-url-env VIVAAHVARNAM_QR_TARGET --yes
//
// Exit codes: 0 every artefact ended `ready` or was verified already-`ready`; 1 a refusal or a failed
// artefact; 2 usage, target and harness problems that stopped the run before it could publish.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OUTPUT_KINDS, OUTPUT_VARIANTS } from '../src/lib/invitationOutputs.ts';
import { parseInvitationObject } from '../src/lib/publicInvitation.ts';
import { assertLoopback } from './stage5-browser-driver.mjs';
import { ROOT, dtoDigest, openRenderWorker } from './stage9-render-worker.mjs';
import {
  artefactIdentity,
  classifyRetirement,
  isUuid,
  OUTPUT_BUCKET,
  patchForTransition,
  planRegistration,
  reconcileSlot,
  sqlInsertRegistration,
  sqlReadVersion,
  sqlSlotRows,
  sqlTransition,
  sqlVersionManifest,
  verifyReadBack,
} from './stage9-publish-core.mjs';

const USAGE_ONLY = 2;

/** A write this run is not allowed to send. Carried as a flag rather than a message match because the
 *  artefact loop has to tell it apart from a real fault: a withheld statement is what a dry run is for,
 *  and a crash half-way through an upload is not. */
class WithheldWrite extends Error {
  constructor(message) { super(message); this.withheld = true; }
}

class Refusal extends Error {
  constructor(message, code = USAGE_ONLY) {
    super(message);
    this.exitCode = code;
  }
}

// ------------------------------------------------------------------ the surface
const BOOLEAN_FLAGS = new Set(['yes', 'db-url-env', 'accept-unknown-browser', 'help']);

/** The shorthand an operator types for the four kinds the column spells out. Both spellings are taken,
 *  because the manifest and the panel use the long ones and the command line is where the short ones
 *  belong; anything outside either is refused rather than guessed. */
const KIND_ALIASES = { og: 'og_image', share: 'share_image', pdf: 'pdf', qr: 'qr' };

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const name = a.slice(2);
    if (name.includes('=')) {
      const [k, v] = a.slice(2).split(/=(.*)/s, 2);
      out[k] = v;
      continue;
    }
    if (BOOLEAN_FLAGS.has(name)) { out[name] = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[name] = true;
    else { out[name] = next; i += 1; }
  }
  return out;
}

const csv = (value) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export function readOptions(args, env = {}) {
  if (args.help) return { help: true };
  const versionId = String(args.version ?? '').toLowerCase();
  if (!isUuid(versionId)) {
    throw new Refusal('refused: --version wants the uuid of one immutable invitation version. There is '
      + 'no default: a publisher that guesses which version to draw is a publisher that registers '
      + 'somebody\'s files under the wrong one.');
  }
  const kinds = (csv(args.kinds).length > 0 ? csv(args.kinds) : ['og', 'share', 'pdf'])
    .map((kind) => KIND_ALIASES[kind] ?? kind);
  for (const kind of kinds) {
    if (!(OUTPUT_KINDS).includes(kind)) {
      throw new Refusal(`refused: ${kind} is not an output kind. The manifest knows ${OUTPUT_KINDS.join(', ')}.`);
    }
  }
  if (new Set(kinds).size !== kinds.length) {
    throw new Refusal('refused: a kind was asked for twice; the run would draw it once and report it twice.');
  }
  const papers = csv(args.papers).length > 0 ? csv(args.papers) : ['a4'];
  for (const paper of papers) {
    if (!['a4', 'letter'].includes(paper)) {
      throw new Refusal(`refused: ${paper} is not a paper this build prints. Use a4 or letter.`);
    }
  }
  if (new Set(papers).size !== papers.length) throw new Refusal('refused: a paper was asked for twice.');
  const wantsQr = kinds.includes('qr');
  const qrVariants = wantsQr ? (csv(args['qr-variants']).length > 0 ? csv(args['qr-variants']) : ['40mm']) : [];
  for (const variant of qrVariants) {
    if (!(OUTPUT_VARIANTS).includes(variant) || !variant.endsWith('mm')) {
      throw new Refusal(`refused: ${variant} is not a plate variant. Use 25mm, 40mm or 60mm.`);
    }
  }
  if (args.papers !== undefined && !kinds.includes('pdf')) {
    // The same rule the plate target follows: an option that is silently ignored is worse than one that
    // is refused, and a paper only chooses which `pdf` rows are drawn.
    throw new Refusal('refused: --papers was given but no pdf kind was asked for.');
  }
  const qrTargetEnv = String(args['qr-target-url-env'] ?? '');
  if (wantsQr && qrTargetEnv === '') {
    throw new Refusal('refused: a QR plate points at an address and this tool will not invent one. Pass '
      + '--qr-target-url-env <NAME> to read the published /i/... address from the environment; argv is '
      + 'refused because a shell history is not a credential store, and the address is never derived '
      + 'from anything already in the database.');
  }
  if (!wantsQr && qrTargetEnv !== '') {
    throw new Refusal('refused: --qr-target-url-env was given but no qr kind was asked for.');
  }
  const qrTarget = qrTargetEnv === '' ? null : String(env[qrTargetEnv] ?? '');
  if (wantsQr && qrTarget === '') {
    throw new Refusal(`refused: ${qrTargetEnv} is not set, so there is no address to encode.`);
  }
  if (qrTarget !== null) {
    let url;
    try { url = new URL(qrTarget); } catch { throw new Refusal('refused: the QR target is not a URL.'); }
    // The same door the harness's QR surface holds a target to (`src/render/qrTarget.ts`), read here as
    // a shape test only so an operator gets one sentence rather than a mount refusal. The harness stays
    // the authority: this check cannot widen what it accepts.
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
      || url.search !== '' || url.hash !== '') {
      throw new Refusal('refused: a plate target must be an https address with no credentials, query '
        + 'or fragment. Everything else is refused by the renderer too.');
    }
  }
  return {
    help: false,
    versionId,
    kinds,
    papers,
    qrVariants,
    qrTarget,
    outDir: args.out ? String(args.out) : null,
    origin: String(args.origin ?? 'http://127.0.0.1:4173'),
    apiOrigin: args['api-origin'] ? String(args['api-origin']) : null,
    acceptUnknownBrowser: args['accept-unknown-browser'] === true,
    cdpPort: args['cdp-port'] ? Number(args['cdp-port']) : undefined,
    renderDeadlineMs: args['render-deadline-ms'] ? Number(args['render-deadline-ms']) : undefined,
    yes: args.yes === true,
    target: resolveTarget(args, env),
  };
}

// ------------------------------------------------------------------ the maintenance target
// The gate `scripts/tradition-pack-admin.mjs:83-118` already states: a container name, or a loopback
// URL that only ever arrives through an environment variable. Refusing by default matters more here
// than it does there, because this tool writes and uploads.
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
    try { host = new URL(url).hostname; } catch { throw new Refusal('refused: the URL in VIVAAHVARNAM_MAINT_DB_URL does not parse.'); }
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

// ------------------------------------------------------------------ the SQL channel
/** One base64 line out of `psql -At`, back into the value the statement was asked to build. A line that
 *  does not decode is not a partial result an operator can reason about, so it ends the run. */
export function decodeLine(line) {
  try {
    return JSON.parse(Buffer.from(String(line).trim(), 'base64').toString('utf8'));
  } catch {
    throw Object.assign(new Error('a statement answered with something that is not the JSON it was '
      + 'asked to build, so this run cannot trust what it read.'), { exitCode: 1 });
  }
}

/** The write gate, and nothing else. A dry run is not a promise that the code under it would have
 *  behaved: it is the same call sequence handed a channel that refuses a statement that writes, so the
 *  statements it does send are the ones a real run sends, and the first one it withheld is the answer to
 *  "what would this have done". */
export function makeSqlChannel(run, allowsMutation) {
  return (statement) => {
    if (!allowsMutation && /^\s*(INSERT|UPDATE|DELETE)\b/i.test(statement)) {
      throw new WithheldWrite(`the statement that would ${/^\s*(\w+)/i.exec(statement.trim())[1].toLowerCase()} `
        + 'a row was withheld by the dry run');
    }
    return run(statement);
  };
}

/** The `psql` that already ships with the local stack, in-container (peer-authenticated, so no password
 *  is in this process, its environment or argv) or through the loopback URL an operator supplied by
 *  name. The statement goes on stdin with `ON_ERROR_STOP=1`, exactly as the Stage 5 maintenance tool
 *  sends it; the battery never reaches here, because it injects `sql`. */
export function runPsql(target, statement) {
  const docker = target.mode === 'docker';
  const args = docker
    ? ['exec', '-i', '-e', 'PGCLIENTENCODING=UTF8', target.container,
      'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-']
    : ['-v', 'ON_ERROR_STOP=1', '-At', '-q', target.url, '-'];
  const res = spawnSync(docker ? 'docker' : 'psql', args, {
    input: statement, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    throw new Refusal(`refused: ${docker ? 'docker' : 'psql'} could not be run (${res.error.message}). `
      + 'This tool does not fall back to another route, because a publisher that quietly tries one is '
      + 'how the wrong database gets written to.', 1);
  }
  if (res.status !== 0) {
    const text = `${res.stderr ?? ''}${res.stdout ?? ''}`.trim().split('\n').pop() ?? 'the statement failed';
    // The database's own sentence, first line only: it names the constraint that fired, which is the
    // thing an operator needs, and it cannot contain a credential.
    throw Object.assign(new Error(text.slice(0, 300)), { exitCode: 1 });
  }
  return res.stdout.trim();
}

// ------------------------------------------------------------------ the Storage channel
/** The REST spellings the browser uses (`supabase/tests/api/stage6_storage.test.mjs:192-254`), with the
 *  service-role key as both `apikey` and bearer — which is what makes the private bucket addressable by
 *  a process that has no user session. `upload` creates and `upsert` replaces; the publisher picks
 *  between them by whether the row it is continuing has already put bytes at the key once. */
export function makeStorageChannel({ apiOrigin, apiKey, fetchImpl = fetch }) {
  const url = (path) => `${apiOrigin}${path}`;
  const headers = (mime, extra) => ({
    apikey: apiKey,
    authorization: `Bearer ${apiKey}`,
    ...(mime ? { 'content-type': mime } : {}),
    ...(extra ?? {}),
  });
  const json = async (res) => {
    try { return await res.json(); } catch { return null; }
  };
  return {
    upload: async ({ key, bytes, mime }) => {
      const res = await fetchImpl(url(`/storage/v1/object/${OUTPUT_BUCKET}/${key}`), {
        method: 'POST', headers: headers(mime), body: bytes,
      });
      return { ok: res.status < 400, status: res.status, verb: 'POST', body: await json(res) };
    },
    upsert: async ({ key, bytes, mime }) => {
      const res = await fetchImpl(url(`/storage/v1/object/${OUTPUT_BUCKET}/${key}`), {
        method: 'PUT', headers: headers(mime, { 'x-upsert': 'true' }), body: bytes,
      });
      return { ok: res.status < 400, status: res.status, verb: 'PUT', body: await json(res) };
    },
    download: async ({ key }) => {
      const res = await fetchImpl(url(`/storage/v1/object/authenticated/${OUTPUT_BUCKET}/${key}`), {
        method: 'GET', headers: headers(),
      });
      if (res.status >= 400) return { ok: false, status: res.status, body: await json(res) };
      return {
        ok: true,
        status: res.status,
        bytes: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type'),
      };
    },
    remove: async ({ key }) => {
      // `absent` is the answer the caller actually needs: a bucket that says "nothing matched that
      // prefix" is a state the publisher can mark a row from, while a refusal is not. The API answers a
      // missing prefix with 200 and an empty list, so the body has to be read to tell those apart.
      const res = await fetchImpl(url(`/storage/v1/object/${OUTPUT_BUCKET}`), {
        method: 'DELETE', headers: headers('application/json'), body: JSON.stringify({ prefixes: [key] }),
      });
      const body = await json(res);
      const removed = Array.isArray(body) ? body.length : (res.status < 400 ? 1 : 0);
      return { ok: res.status < 400, absent: res.status === 404 || removed === 0, status: res.status, body };
    },
  };
}

/** The same channel with the writes held shut, and held shut the same way the SQL channel holds a
 *  statement shut — by throwing, not by answering `ok: false`. A refusal that looked like a failed
 *  upload would send the run down its own error path and have a dry run mark rows `failed` for a reason
 *  that was never true. `download` stays open: reading an object back is how a dry run answers "what is
 *  there now", and it cannot change it. */
export function guardStorageWrites(storage, allowsMutation) {
  if (allowsMutation) return storage;
  const withheld = (op) => Promise.reject(new WithheldWrite(
    `the call that would ${op} an object was withheld by the dry run`));
  return {
    upload: (arg) => { void arg; return withheld('upload'); },
    upsert: (arg) => { void arg; return withheld('upsert'); },
    remove: (arg) => { void arg; return withheld('remove'); },
    download: (arg) => storage.download(arg),
  };
}

// ------------------------------------------------------------------ redaction
const REDACTED = '[redacted]';

/** The three things that must not leave this process in a line of text: two credentials and one address
 *  a guest can walk. Built from values rather than names, because a credential is an opaque string this
 *  file has no business knowing the shape of, and short values are skipped so `--version`'s first eight
 *  characters cannot be mistaken for a key. */
export function makeRedactor(secrets = []) {
  const known = secrets.filter((s) => typeof s === 'string' && s.length >= 12);
  return (value) => {
    let text = String(value);
    for (const secret of known) text = text.split(secret).join(REDACTED);
    return text;
  };
}

// ------------------------------------------------------------------ the run
/**
 * Publish every artefact of one version. `channels` is the whole outside world:
 *   `sql(statement)` → one base64 line; `storage` → `{upload, upsert, download, remove}`;
 *   `render` → the worker; `readArtefact(path)` → the bytes on disk.
 * Nothing here reads `process.env`, the clock or the filesystem, which is what lets the unit battery
 * drive a full publish, a crash-resume, a supersession and a dry run without a database, a browser or
 * Docker — and assert the order the real run would have used.
 */
export async function runPublish({
  versionId,
  kinds = ['og_image', 'share_image', 'pdf'],
  papers = ['a4'],
  qrVariants = [],
  qrTarget = null,
  yes = false,
  channels,
  log = () => {},
} = {}) {
  const { sql, storage, render, readArtefact } = channels;
  const findings = [];
  const results = [];
  const record = (level, reason, detail = {}) => {
    // `reason` is the field an operator greps for, so it is written last: a detail object that happens
    // to carry its own `reason` would otherwise replace the name of the finding with a child's message.
    const finding = { level, ...detail, reason };
    findings.push(finding);
    if (level !== 'note') log(`${level.toUpperCase()} ${reason} ${shortForm(detail)}`);
  };

  const versionLine = sql(sqlReadVersion(versionId));
  const version = versionLine === '' ? null : decodeLine(versionLine);
  if (version?.wedding_id === undefined || version?.dto === undefined) {
    record('refusal', 'version-not-found', { version_id: versionId });
    return { ok: false, dryRun: !yes, findings, results, manifest: [] };
  }
  const { wedding_id: weddingId } = version;
  const parsed = parseInvitationObject(version.dto);
  if (parsed === null) {
    record('refusal', 'invitation-refused', { version_id: versionId });
    return { ok: false, dryRun: !yes, findings, results, manifest: [] };
  }
  // The one projection, digested. On a plate row this is what `source_dto_digest` holds, because a
  // plate draws no document — see the note at the head of `stage9-publish-core.mjs`.
  const versionDtoDigest = dtoDigest(parsed);

  const draws = [];
  for (const kind of kinds) {
    if (kind === 'qr') {
      for (const variant of qrVariants) {
        draws.push({ kind, call: () => render.renderQrPlate({ variant, target: qrTarget }) });
      }
    } else if (kind === 'pdf') {
      for (const paper of papers) draws.push({ kind, call: () => render.renderPdf({ dto: version.dto, paper }) });
    } else if (kind === 'og_image') {
      draws.push({ kind, call: () => render.renderOgTeaser({ dto: version.dto }) });
    } else {
      draws.push({ kind, call: () => render.renderShareImage({ dto: version.dto }) });
    }
  }

  for (const draw of draws) {
    const parent = await draw.call();
    if (parent?.ok !== true) {
      record('failure', 'render-refused', { kind: draw.kind, render_reason: parent?.reason ?? 'answered-nothing' });
      continue;
    }
    if (draw.kind !== 'qr' && parent.source_dto_digest !== versionDtoDigest) {
      // The mount and this read would be describing different documents. Both halves come from the same
      // projection in the same version, so a disagreement means one of them stopped being that call.
      record('refusal', 'dto-digest-disagreement', { kind: draw.kind });
      continue;
    }
    for (const artefact of parent.artefacts) {
      try {
        await publishArtefact({
          artefact, parent, versionId, weddingId, versionDtoDigest, sql, storage, readArtefact, log, record, results,
        });
      } catch (error) {
        if (error?.withheld === true) {
          // The dry run's answer to "what would this have done": everything up to the first write was
          // really done, and the withheld statement is named here rather than pretended away.
          record('note', 'write-withheld-by-dry-run', { name: artefact.name, detail: String(error.message ?? error).slice(0, 200) });
        } else {
          record('failure', 'publish-step-threw', { name: artefact.name, detail: String(error.message ?? error).slice(0, 200) });
          log(`THREW ${artefact.name}: ${String(error.message ?? error).slice(0, 200)}`);
        }
      }
    }
  }

  // The manifest as the panel will read it: no key, no URL, no target digest.
  const manifestLine = sql(sqlVersionManifest(versionId));
  const manifest = manifestLine === '' ? [] : decodeLine(manifestLine);
  const blocking = findings.filter((finding) => finding.level !== 'note');
  // A mutating run that delivered nothing is not a success, however few findings it printed; a dry run
  // is *supposed* to deliver nothing, and its report is the withheld statement.
  const ok = blocking.length === 0 && (results.length > 0 || !yes);
  return {
    ok,
    dryRun: !yes,
    mutation: yes,
    weddingId,
    versionId,
    versionDtoDigest,
    findings,
    results,
    manifest,
  };
}

const shortForm = (detail) => Object.entries(detail)
  .filter(([, value]) => value !== undefined)
  .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
  .join(' ');

/**
 * One artefact, start to finish. Appends a row to `results` and names every refusal, failure and note
 * through `record`; it throws only if a statement channel throws, which the caller reports as that
 * artefact's failure.
 */
async function publishArtefact({
  artefact, parent, versionId, weddingId, versionDtoDigest,
  sql, storage, readArtefact, log, record, results,
}) {
  const identity = artefactIdentity(artefact.name);
  if (identity.ok !== true) {
    record('refusal', identity.reason, { name: String(artefact.name) });
    return;
  }
  const label = {
    name: artefact.name,
    kind: identity.kind,
    variant: identity.variant,
    format: identity.format,
    page: identity.pageNumber,
  };
  const registration = planRegistration({
    identity,
    artefact,
    versionId,
    weddingId,
    sourceDtoDigest: identity.kind === 'qr' ? versionDtoDigest : parent.source_dto_digest,
    targetUrlDigest: identity.kind === 'qr' ? parent.target_url_digest : null,
  });
  if (registration.ok !== true) {
    record('refusal', registration.reason, label);
    return;
  }

  // (2) the bytes on disk, checked before a write can leave. No content type is claimed here: locally
  // the question is only whether the file still is what the worker recorded.
  let local;
  try {
    local = readArtefact(artefact.path);
  } catch {
    record('failure', 'artefact-file-missing', label);
    return;
  }
  const localCheck = verifyReadBack({ bytes: local, expected: registration.expected });
  if (localCheck.ok !== true) {
    record('refusal', `local-${localCheck.reason}`, {
      ...label, ...(localCheck.expected === undefined ? {} : { expected: localCheck.expected }),
      ...(localCheck.found === undefined ? {} : { found: localCheck.found }),
    });
    return;
  }

  // (3) what already occupies this slot.
  const slotLine = sql(sqlSlotRows({
    versionId,
    kind: identity.kind,
    variant: identity.variant,
    format: identity.format,
    pageNumber: identity.pageNumber,
  }));
  const rows = slotLine === '' ? [] : decodeLine(slotLine);
  const slot = reconcileSlot({ rows, candidateHash: artefact.render_config_hash });
  if (slot.action === 'refuse') {
    record('refusal', slot.reason, { ...label, count: slot.count, row_id: slot.row_id });
    return;
  }

  // Stale occupants go first: the manifest should not hold two live rows for one slot while this run is
  // still in flight, and §12's order is remove-then-mark.
  for (const stale of slot.supersede) {
    await retireStale({
      row: stale,
      invalidating: true,
      kind: identity.kind,
      candidateTargetDigest: identity.kind === 'qr' ? parent.target_url_digest : null,
      sql,
      storage,
      log,
      record,
    });
  }
  for (const stale of slot.reclaim) await retireStale({ row: stale, invalidating: false, sql, storage, log, record });
  for (const stale of slot.orphan_check) {
    if (typeof stale.object_key !== 'string' || stale.object_key === '') continue;
    const gone = await storage.remove({ key: stale.object_key });
    // Named, not hidden: a key this run could not remove is the one thing an operator has to be able to
    // find, and it is the only place in this file's output where an object path is printed.
    if (gone.ok !== true) record('note', 'orphan-object-remains', { row_id: stale.id, object_key: stale.object_key, status: gone.status });
  }
  for (const stale of slot.retired) record('note', 'retired-row-left-alone', { row_id: stale.id });

  if (slot.action === 'verify') {
    const outcome = await verifyExisting({ row: slot.reuse, expected: registration.expected, storage, record, label, log });
    if (outcome.ok === true) {
      results.push({
        ...label, action: 'verify', row_id: slot.reuse.id, status: 'ready',
        content_digest: outcome.content_digest, size_bytes: outcome.size_bytes, properties: outcome.properties,
      });
    }
    return;
  }

  // (4) the row that will carry this artefact: one that is already ours, or a fresh registration.
  let row;
  let verb;
  if (slot.action === 'publish') {
    const inserted = decodeLine(sql(sqlInsertRegistration(registration.insert)));
    if (typeof inserted?.object_key !== 'string' || inserted.object_key === '') {
      record('refusal', 'registration-answered-without-a-key', label);
      return;
    }
    row = { id: inserted.id, object_key: inserted.object_key, status: inserted.status ?? 'registered', attempt_count: 0 };
    verb = 'POST';
    log(`REGISTERED ${artefact.name} row=${row.id}`);
  } else {
    row = { ...slot.resume };
    if (typeof row.object_key !== 'string' || row.object_key === '') {
      record('refusal', 'resume-row-carries-no-key', { ...label, row_id: row.id });
      return;
    }
    // A key this row already put bytes behind once may hold a partial object, so the write that continues
    // it is the one Storage will accept over an existing name.
    verb = 'PUT';
    log(`RESUMING ${artefact.name} row=${row.id} status=${row.status}`);
  }

  // (5) `uploading`, unless the row already says it — a same-status write is refused by the guard, and
  // correctly so: the step is a claim about intent and a row that made it needs no second one.
  if (row.status !== 'uploading') {
    const step = patchForTransition({ from: row.status, to: 'uploading', row });
    if (step.ok !== true) {
      record('refusal', `cannot-open-upload-${step.reason}`, { ...label, row_id: row.id });
      return;
    }
    // Merged, not replaced: `sqlTransition`'s RETURNING answers with the lifecycle columns, and
    // `object_key` is not one of them. A run that overwrote its row here would lose the address it
    // still has to upload to — and on a failure, the object it still has to remove.
    row = { ...row, ...decodeLine(sql(sqlTransition(row.id, step.patch))) };
  }

  // (6) the bytes away, then (7) the same bytes read back out of Storage rather than off the disk.
  const put = verb === 'PUT'
    ? await storage.upsert({ key: row.object_key, bytes: local, mime: registration.expected.mime })
    : await storage.upload({ key: row.object_key, bytes: local, mime: registration.expected.mime });
  if (put.ok !== true) {
    await markFailed({ row, reason: `upload-${put.verb ?? verb}-refused-${put.status ?? 'unknown'}`, sql, storage, record, log });
    return;
  }
  const back = await storage.download({ key: row.object_key });
  if (back.ok !== true) {
    await markFailed({ row, reason: `readback-refused-${back.status ?? 'unknown'}`, sql, storage, record, log });
    return;
  }
  const checked = verifyReadBack({ bytes: back.bytes, expected: registration.expected, contentType: back.contentType });
  if (checked.ok !== true) {
    await markFailed({ row, reason: checked.reason, sql, storage, record, log });
    return;
  }

  // (8) and only now, the promise.
  const ready = patchForTransition({ from: row.status, to: 'ready', row, digest: checked.content_digest });
  if (ready.ok !== true) {
    record('refusal', `cannot-record-ready-${ready.reason}`, { ...label, row_id: row.id });
    return;
  }
  const done = decodeLine(sql(sqlTransition(row.id, ready.patch)));
  if (done?.status !== 'ready') {
    record('failure', 'ready-write-did-not-land', { ...label, row_id: row.id });
    return;
  }
  log(`READY ${artefact.name} row=${row.id} digest=${checked.content_digest}`);
  results.push({
    ...label,
    action: slot.action,
    row_id: row.id,
    status: done.status,
    content_digest: checked.content_digest,
    size_bytes: checked.size_bytes,
    properties: checked.properties,
  });
}

/** Remove an object, then let the row say what happened to it. A `ready` row whose object would not go
 *  away stays `ready` — it is still telling the truth about bytes a host can download, and retiring it
 *  with `superseded` would be a lie about why.
 *
 *  The reason a retired plate carries is decided *before* the object is removed, and `classifyRetirement`
 *  decides it: a stale row that points at a different address was rotated away from, not replaced by a
 *  newer invitation, and the panel tells the host to reprint for a different reason. A row whose digest
 *  cannot be read refuses here rather than after the deletion — the bytes cannot be un-deleted, and a
 *  wrong reason stamped on the row is not recoverable by the run that stamped it. */
async function retireStale({ row, invalidating, kind, candidateTargetDigest, sql, storage, log, record }) {
  let invalidationReason = 'superseded';
  if (invalidating) {
    invalidationReason = classifyRetirement({
      kind, staleTargetDigest: row.target_url_digest, candidateTargetDigest,
    });
    if (invalidationReason === null) {
      record('refusal', 'retirement-reason-unclassifiable', { row_id: row.id, kind });
      return;
    }
  }
  if (typeof row.object_key === 'string' && row.object_key !== '') {
    const gone = await storage.remove({ key: row.object_key });
    if (gone.ok !== true) {
      record('note', invalidating ? 'retirement-refused-object-present' : 'reclaim-refused-object-present',
        { row_id: row.id, object_key: row.object_key, status: gone.status });
      return;
    }
  }
  if (invalidating) {
    const patch = patchForTransition({ from: row.status, to: 'invalidated', row, invalidationReason });
    if (patch.ok !== true) {
      record('note', `supersede-could-not-be-marked-${patch.reason}`, { row_id: row.id });
      return;
    }
    sql(sqlTransition(row.id, patch.patch));
    log(`SUPERSEDED row=${row.id} reason=${invalidationReason}`);
    return;
  }
  // The lifecycle has no `registered -> failed` edge, so the guard's own HINT is followed through
  // `uploading` — the same step a fresh publish takes before it can ever fail.
  let current = { ...row };
  if (current.status === 'registered') {
    const open = patchForTransition({ from: 'registered', to: 'uploading', row: current });
    if (open.ok !== true) {
      record('note', `reclaim-could-not-be-marked-${open.reason}`, { row_id: row.id });
      return;
    }
    current = { ...current, ...decodeLine(sql(sqlTransition(current.id, open.patch))) };
  }
  const fail = patchForTransition({ from: current.status, to: 'failed', row: current, reason: 'stale-slot-reclaimed' });
  if (fail.ok !== true) {
    record('note', `reclaim-could-not-be-marked-${fail.reason}`, { row_id: row.id });
    return;
  }
  sql(sqlTransition(current.id, fail.patch));
  log(`RECLAIMED row=${row.id}`);
}

/** What a `ready` row promises is its own `content_digest`, so that is what an in-place check reads the
 *  object against — it is the digest a host's signed download is served against, and the one the SQL
 *  lifecycle guards. The fresh draw is still compared and still reported, because Chromium stamps
 *  `/CreationDate`/`/ModDate` into a printed PDF, so the second run of an identical command draws a PDF
 *  whose bytes differ by five characters while every raster and plate draw reproduces exactly. Using the
 *  draw as the reference would refuse a correctly delivered PDF forever; ignoring the difference would
 *  hide a renderer that stopped being pure. */
async function verifyExisting({ row, expected, storage, record, label, log }) {
  if (typeof row.object_key !== 'string' || row.object_key === '') {
    record('refusal', 'ready-row-carries-no-key', { ...label, row_id: row.id });
    return { ok: false };
  }
  const back = await storage.download({ key: row.object_key });
  if (back.ok !== true) {
    record('failure', 'ready-object-cannot-be-read', { ...label, row_id: row.id, status: back.status });
    return { ok: false };
  }
  const checked = verifyReadBack({
    bytes: back.bytes,
    expected: { kind: expected.kind, format: expected.format, variant: expected.variant, content_digest: row.content_digest },
    contentType: back.contentType,
  });
  if (checked.ok !== true) {
    // The row promises bytes that are not in the bucket. Neither `superseded` nor a retry describes
    // that, so the run names it and changes nothing for an operator to decide.
    record('refusal', `ready-object-differs-${checked.reason}`, { ...label, row_id: row.id });
    return { ok: false };
  }
  const reproduced = expected.content_digest === row.content_digest;
  if (reproduced !== true) {
    record('note', 'ready-object-not-reproduced-by-this-draw', {
      ...label, row_id: row.id, row_digest: row.content_digest, draw_digest: expected.content_digest,
    });
  }
  log(`VERIFIED-IN-PLACE ${label.name} row=${row.id}${reproduced ? '' : ' draw-not-reproduced'}`);
  record('note', 'ready-object-verified', { ...label, row_id: row.id });
  return { ok: true, ...checked };
}

/** A row that cannot become `ready` becomes `failed`, object first and reason second. If the failure
 *  itself cannot be recorded, that is said out loud: a row left at `uploading` is a state the next run
 *  will find and resume, and a row left there silently is how a publisher starts to lie. */
async function markFailed({ row, reason, sql, storage, record, log }) {
  let current = { ...row };
  if (current.status === 'registered') {
    const open = patchForTransition({ from: 'registered', to: 'uploading', row: current });
    if (open.ok !== true) {
      record('failure', `could-not-record-failure-${open.reason}`, { row_id: row.id, failed_because: reason });
      return;
    }
    // Merged, for the reason `publishArtefact` gives: the transition's answer carries no `object_key`,
    // and this path still needs it to remove the object before it marks the row.
    current = { ...current, ...decodeLine(sql(sqlTransition(current.id, open.patch))) };
  }
  if (typeof current.object_key === 'string' && current.object_key !== '') {
    const gone = await storage.remove({ key: current.object_key });
    if (gone.ok !== true) record('note', 'orphan-object-remains', { row_id: current.id, object_key: current.object_key, status: gone.status });
  }
  const patch = patchForTransition({ from: current.status, to: 'failed', row: current, reason });
  if (patch.ok !== true) {
    record('failure', `could-not-record-failure-${patch.reason}`, {
      row_id: current.id, failed_because: reason, ...(current.attempt_count === undefined ? {} : { attempts: current.attempt_count }),
    });
    return;
  }
  const written = decodeLine(sql(sqlTransition(current.id, patch.patch)));
  log(`FAILED row=${current.id} attempt=${written?.attempt_count} reason=${reason}`);
  record('failure', 'artefact-failed', { row_id: current.id, failed_because: reason, attempts: written?.attempt_count });
}

// ------------------------------------------------------------------ the process
const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** `.env.local` is read the way every other local-stack instrument reads it: this script's own parser,
 *  no dependency, and the values never leave the process. */
function localEnv(rel) {
  const out = {};
  for (const line of readFileSync(resolve(ROOT, rel), 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
}

/** The two statements that decide whether this session may build the literals `sqlText` emits, and who
 *  it is. A guard, not an assumption: doubling quotes is only sufficient while the server is not
 *  treating backslashes as escapes, and the honest way to know is to ask. */
function assertSession(sql) {
  if (String(sql('SHOW standard_conforming_strings;')).trim() !== 'on') {
    throw new Refusal('refused: this session does not report standard_conforming_strings = on, so the '
      + 'literal-escaping rule this tool writes under is not the one the server applies.', 1);
  }
  return String(sql("SELECT current_user || '@' || current_database();")).trim();
}

export async function mainCli({ argv = process.argv.slice(2), env = process.env, stdout = process.stdout } = {}) {
  const opts = readOptions(parseArgs(argv), env);
  if (opts.help) {
    stdout.write('usage: see the header of this file. --yes is what makes it write.\n');
    return 0;
  }
  const fileEnv = localEnv('.env.local');
  const apiOrigin = (() => {
    try { return assertLoopback(opts.apiOrigin ?? fileEnv.SUPABASE_LOCAL_URL, 'the Storage API origin'); } catch (error) {
      throw new Refusal(`refused: ${error.message}`, 2);
    }
  })();
  if (/supabase\.co|supabase\.io/i.test(apiOrigin)) throw new Refusal('refused: a hosted Storage target.', 2);
  const serviceKey = fileEnv.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
  if (typeof serviceKey !== 'string' || serviceKey === '') {
    throw new Refusal('refused: .env.local carries no service-role key, and this publisher has no other '
      + 'way to address the private bucket.', 2);
  }
  try { assertLoopback(opts.origin, 'the render origin'); } catch (error) {
    throw new Refusal(`refused: ${error.message}`, 2);
  }

  const redact = makeRedactor([serviceKey, fileEnv.SUPABASE_LOCAL_PUBLISHABLE_KEY, opts.qrTarget]);
  const log = (line) => stdout.write(`${redact(line)}\n`);
  const sql = makeSqlChannel((statement) => runPsql(opts.target, statement), opts.yes);
  const who = assertSession(sql);
  log(`maintenance identity: ${who}`);
  if (!/^postgres@/.test(who) && !/^supabase_admin@/.test(who)) {
    log('note: the measured grants give this surface to the local owner role; a different identity '
      + 'will be refused by the database rather than by this tool.');
  }

  const evidenceDir = resolve(env.STAGE9_EVIDENCE_DIR ?? join(ROOT, '..', 'q9-logs'));
  const outDir = opts.outDir ?? join(evidenceDir, 'publish', opts.versionId.slice(0, 8));
  mkdirSync(outDir, { recursive: true });

  const workerOptions = { origin: opts.origin, outputDir: outDir, acceptUnknownBrowser: opts.acceptUnknownBrowser };
  if (opts.cdpPort !== undefined) workerOptions.cdpPort = opts.cdpPort;
  if (opts.renderDeadlineMs !== undefined) workerOptions.renderDeadlineMs = opts.renderDeadlineMs;
  let worker;
  try {
    worker = await openRenderWorker(workerOptions);
  } catch (error) {
    throw new Refusal(`refused: the render harness could not start (${String(error.message ?? error).slice(0, 200)}). `
      + 'Is the local stack up and is a `vite preview` of the built bundle answering the render origin?', 2);
  }

  let outcome;
  try {
    outcome = await runPublish({
      versionId: opts.versionId,
      kinds: opts.kinds,
      papers: opts.papers,
      qrVariants: opts.qrVariants,
      qrTarget: opts.qrTarget,
      yes: opts.yes,
      log,
      channels: {
        sql,
        storage: guardStorageWrites(makeStorageChannel({ apiOrigin, apiKey: serviceKey }), opts.yes),
        render: worker,
        readArtefact: (path) => readFileSync(path),
      },
    });
  } finally {
    const closed = await worker
      .close()
      .catch((error) => ({ profileRemoved: false, renders: null, reason: String(error?.message ?? error) }));
    // The driver answers a failed teardown with the `rm` refusal beside it, and a refusal is exactly
    // the fact a later run has to root-cause, so it travels in the log line rather than being dropped.
    log(
      `browser closed: profileRemoved=${closed.profileRemoved} renders=${closed.renders}` +
        (closed.profilePath ? ` profile=${closed.profilePath}` : "") +
        (closed.reason ? ` reason=${closed.reason}` : ""),
    );
  }

  mkdirSync(evidenceDir, { recursive: true });
  const runFile = join(evidenceDir, `publish-${opts.versionId.slice(0, 8)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const runRecord = {
    version_id: opts.versionId,
    wedding_id: outcome.weddingId ?? null,
    version_dto_digest: outcome.versionDtoDigest ?? null,
    dry_run: !opts.yes,
    mutation: opts.yes,
    kinds: opts.kinds,
    papers: opts.papers,
    qr_variants: opts.qrVariants,
    // The digest the manifest stores, not the address: this file is read by people who do not hold the
    // guest's link, and §11.7 says the address belongs in the plate's pixels and nowhere else.
    qr_target_digest: opts.qrTarget === null ? null : sha256Hex(opts.qrTarget),
    render_origin: opts.origin,
    api_origin: apiOrigin,
    output_dir: outDir,
    maintenance_identity: who,
    artefacts: outcome.results,
    findings: outcome.findings,
    manifest: outcome.manifest,
    ok: outcome.ok,
  };
  writeFileSync(runFile, redact(JSON.stringify(runRecord, null, 2)));
  log(`run record: ${runFile}`);
  log(`summary: ${outcome.results.length} artefact(s) delivered, ${outcome.findings.filter((f) => f.level !== 'note').length} blocking finding(s)`);
  return outcome.ok ? 0 : 1;
}

/** Only the command line runs the process. Importing this file from the battery must never reach for
 *  Docker, a browser or a credential, and a top-level `await main()` would do all three at import. */
const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    process.exitCode = await mainCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Refusal ? 'REFUSED' : 'ERROR'}: ${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
