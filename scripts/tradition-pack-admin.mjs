#!/usr/bin/env node
// VIVAAHVARNAM — tradition-pack maintenance CLI (§F of the Stage 5 directive).
//
// This is a LOCAL MAINTENANCE TOOL, not a product surface. It exists because a cultural reviewer
// must be able to author, hash, review, approve and retire a tradition pack without writing SQL
// by hand, and because the guarantee that makes a review mean anything — the digest is produced by
// the database, from the row's own material — has to survive being operated by a person.
//
// What it deliberately is not:
//   * not a web admin panel (§F refuses that build),
//   * not a customer tool (every function it calls is revoked from anon/authenticated/service_role,
//     so this tool must connect as the local maintenance identity; that is measured in
//     supabase/tests/stage5/50_review_binding.sql group M, not assumed here),
//   * not a deleter (there is no delete verb in this file, and reviewed/approved/deprecated releases
//     cannot be deleted by any role — see the Stage 4 guard),
//   * not a remote tool (it refuses anything that is not a loopback or an explicitly named local
//     container, and it refuses --linked/--project-ref rather than ignoring them).
//
// It also computes nothing about the review. The canonical payload and its SHA-256 come back from
// Postgres; `review-packet` renders exactly those bytes. Two implementations of "what a review
// covers" is the failure mode the whole of §E exists to avoid.
//
// Exit codes, pinned by supabase/tests/api/stage5_admin_cli.test.mjs: 0 answered, 2 an operator
// refusal (target, operand, or a review packet that has gone stale against the material — printed
// on stderr as `REFUSED:`), 1 the database or the route refused (`ERROR:`). A stale packet is
// category 2 because the operator can act on it; the check that reports it reads the database's
// own recomputation, so it is still the database that decides what the material digests to.
//
// Usage — the target is mandatory, and there is no default:
//   node scripts/tradition-pack-admin.mjs --via-docker supabase_db_localvivaahvarnam list
//   VIVAAHVARNAM_MAINT_DB_URL=postgresql://postgres@127.0.0.1:54401/postgres \
//     node scripts/tradition-pack-admin.mjs --db-url-env retention
//
// Commands (each prints what it is about to do before it does it, and mutates only with --yes):
//   list | inspect --release <uuid> | create-pack --key <slug> --name <..> --scope <..>
//   create-release --key <slug> --definition <file|-> [--dsv 2] [--languages en,ta]
//                  [--author <..>] [--machine-assisted no-op] [--notes <..>] [--source <..>] [--changelog <..>]
//   validate-release --release <uuid> | update-draft --release <uuid> --patch <file|->
//   review-packet --release <uuid> [--out <dir>] | submit-review --release <uuid> --decision <..>
//                  --reviewer <..> --basis <..> --scope <..> --languages <..> --hash <64hex>
//   approve --release <uuid> --hash <64hex> | deprecate --release <uuid> | retention
//
// No package dependency was added for this. It talks to Postgres through the psql that already
// ships with the local stack (in-container, peer-authenticated, so no password is in this process,
// its environment, or argv), or through a loopback URL supplied only by an environment variable.
// The rationale, and the measured proof that the production bundle does not contain this file's
// target, are recorded in docs/audits/stage-5-pack-driven-authoring-review.md §8.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const USAGE_ONLY = 2;

class Refusal extends Error {
  constructor(message, code = USAGE_ONLY) { super(message); this.exitCode = code; }
}

// ------------------------------------------------------------------ argument surface
// Flags that carry no value. Without this list `--linked list` would swallow the command as the
// flag's value, and the tool would then refuse for the wrong reason — a refusal that names the
// wrong thing is a refusal nobody learns from.
const BOOLEAN_FLAGS = new Set(['yes', 'linked', 'debug', 'machine-assisted', 'db-url-env']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const name = a.slice(2);
    if (name.includes('=')) { const [k, v] = a.slice(2).split(/=(.*)/s, 2); out[k] = v; continue; }
    if (BOOLEAN_FLAGS.has(name)) { out[name] = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[name] = true; }
    else { out[name] = next; i += 1; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

// ------------------------------------------------------------------ target gate (§F)
// Refusing by default is the point: a maintenance tool that will happily connect wherever it is
// pointed is how a local-only guarantee gets broken by an tired operator at 11pm.
function resolveTarget() {
  const supabaseHost = /supabase\.co|supabase\.io/i;
  if (args['via-docker']) {
    const name = String(args['via-docker']);
    if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(name)) {
      throw new Refusal(`refused: --via-docker wants the local stack's database container name `
        + `(supabase_db_<project>), got ${JSON.stringify(name)}.`);
    }
    return { mode: 'docker', container: name };
  }
  if (args['db-url-env']) {
    const url = process.env.VIVAAHVARNAM_MAINT_DB_URL;
    if (!url) {
      throw new Refusal('refused: --db-url-env means "read the URL from '
        + 'VIVAAHVARNAM_MAINT_DB_URL", and that variable is not set. A connection string is never '
        + 'accepted on the command line, because argv lands in shell history.');
    }
    if (supabaseHost.test(url)) throw new Refusal('refused: the URL names a hosted target.');
    let host;
    try { host = new URL(url).hostname; }
    catch { throw new Refusal('refused: the URL in VIVAAHVARNAM_MAINT_DB_URL does not parse.'); }
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      throw new Refusal(`refused: the URL's host is ${host}. Only a loopback address is a local `
        + 'maintenance target; anything else is a network the qualification suite does not own.');
    }
    return { mode: 'url', url };
  }
  throw new Refusal(
    'refused: no maintenance target was supplied.\n'
    + '  Pass --via-docker <local database container>, or set VIVAAHVARNAM_MAINT_DB_URL to a\n'
    + '  loopback postgresql:// URL and pass --db-url-env. There is no default target on purpose:\n'
    + '  a tool that guesses a database is a tool that eventually writes to the wrong one.');
}

// ------------------------------------------------------------------ SQL emission
// Two rules make injection impossible rather than merely unlikely:
//   * every JSON document travels base64-encoded and is decoded inside Postgres, so the payload
//     cannot contain a quote, a backslash or a newline that the statement's own syntax would see;
//   * every text value is emitted as a standard string literal with its quotes doubled, and the
//     session is required to report standard_conforming_strings = on before anything is sent,
//     because that is what makes doubling sufficient.
function lit(value) {
  if (value === null || value === undefined) return 'NULL';
  const s = String(value);
  if (s.includes('\u0000')) throw new Refusal('refused: a value contains a NUL byte.');
  return `'${s.replaceAll("'", "''")}'`;
}

function jsonLit(value, label) {
  const b64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  return `convert_from(decode(${lit(b64)}, 'base64'), 'UTF8')::jsonb /* ${label} */`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const SLUG_RE = /^[a-z][a-z0-9_]{1,63}$/;
const LANG_RE = /^[a-z]{2}(-[a-z]{2})?$/;

function needUuid(value, flag) {
  if (!value || !UUID_RE.test(String(value))) {
    throw new Refusal(`refused: --${flag} wants a uuid, got ${JSON.stringify(value)}.`);
  }
  return String(value).toLowerCase();
}

function needHash(value, flag) {
  if (!value || !HASH_RE.test(String(value))) {
    throw new Refusal(`refused: --${flag} wants the 64-character SHA-256 the packet printed, `
      + `got ${JSON.stringify(value)}.`);
  }
  return String(value).toLowerCase();
}

function langArray(value) {
  const list = String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) throw new Refusal('refused: --languages needs at least one language tag.');
  for (const l of list) if (!LANG_RE.test(l)) throw new Refusal(`refused: ${l} is not a language tag.`);
  return list;
}

// A document operand is an argument, not a route: a typo in a path and a truncated file are both
// usage errors, and they leave this process before it has spoken to Postgres. Reported as exit 1
// they would read as "the database refused me", which sends an operator looking in the wrong place.
// The message names the source, never its contents.
function readMaybeStdin(spec) {
  if (spec === undefined) throw new Refusal('refused: a file argument is required here.');
  const source = spec === '-' ? 'standard input' : String(spec);
  let text;
  try {
    text = readFileSync(spec === '-' ? 0 : source, 'utf8');
  } catch {
    throw new Refusal(`refused: the JSON document at ${source} could not be read.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Refusal(`refused: ${source} is not valid JSON, so there is no document to send.`);
  }
}

// ------------------------------------------------------------------ the runner
function runPsql(target, sql) {
  const base = target.mode === 'docker'
    ? ['exec', '-i', '-e', 'PGCLIENTENCODING=UTF8', target.container,
       'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-']
    : ['-v', 'ON_ERROR_STOP=1', '-At', '-q', target.url, '-'];
  const res = spawnSync(target.mode === 'docker' ? 'docker' : 'psql', base, {
    input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    throw new Refusal(`refused: ${target.mode === 'docker' ? 'docker' : 'psql'} could not be run `
      + `(${res.error.message}). This tool does not fall back to anything, because a maintenance `
      + 'tool that quietly tries another route is how the wrong database gets written to.');
  }
  if (res.status !== 0) {
    const text = `${res.stderr || ''}${res.stdout || ''}`.trim();
    throw Object.assign(new Error(text || 'the statement failed'), { exitCode: 1 });
  }
  return res.stdout;
}

// A session guard rather than a trust assumption: doubling quotes is only sufficient while the
// server is not treating backslashes as escapes, and the only honest way to know that is to ask.
function assertSession(out, target) {
  const scs = runPsql(target, 'SHOW standard_conforming_strings;').trim();
  if (scs !== 'on') {
    throw new Refusal('refused: this session reports standard_conforming_strings = '
      + `${scs}. The literal-escaping rules this tool relies on are the standard ones, and it will `
      + 'not guess its way around a non-standard server.');
  }
  const who = runPsql(target, "SELECT current_user || '@' || current_database();").trim();
  process.stderr.write(`# maintenance identity: ${who}\n`);
  if (!/^postgres@/.test(who) && !/^supabase_admin@/.test(who)) {
    process.stderr.write('# note: the measured grants give the maintenance surface to the local '
      + 'owner role; a different identity will be refused by the database rather than by this tool.\n');
  }
  return out;
}

// Every value that reaches an emitted statement goes through `lit`, `jsonLit` or this helper —
// including the ids. That is not a style rule: an unquoted uuid is a numeric literal with junk
// after it, and a value that was never quoted is a value that was never escaped.
const uuidLit = (value) => `${lit(value)}::uuid`;

const fn = {
  catalog: 'internal_api.tradition_pack_catalog()',
  inspect: (r) => `internal_api.inspect_tradition_pack_release(${uuidLit(r)})`,
  createPack: (k, n, s) => `internal_api.create_tradition_pack(${lit(k)}, ${lit(n)}, ${lit(s)})`,
  createRelease: (args2) => 'internal_api.create_tradition_pack_release('
    + [lit(args2.key), jsonLit(args2.definition, 'definition'), String(args2.dsv),
       `ARRAY[${langArray(args2.languages).map((l) => lit(l)).join(',')}]::text[]`,
       lit(args2.author), String(args2.machineAssisted), lit(args2.notes),
       lit(args2.source), lit(args2.changelog)].join(', ') + ')',
  updateDraft: (r, patch) => `internal_api.update_draft_tradition_pack_release(${uuidLit(r)}, `
    + `${jsonLit(patch, 'patch')}::jsonb)`,
  packet: (r) => `internal_api.get_tradition_pack_review_packet(${uuidLit(r)})`,
  submit: (a) => 'internal_api.submit_tradition_pack_review('
    + [uuidLit(a.release), lit(a.decision), lit(a.reviewer), lit(a.basis), lit(a.scope),
       `ARRAY[${langArray(a.languages).map((l) => lit(l)).join(',')}]::text[]`,
       lit(a.hash)].join(', ') + ')',
  approve: (r, h) => `internal_api.approve_tradition_pack_release(${uuidLit(r)}, ${lit(h)})`,
  deprecate: (r) => `internal_api.deprecate_tradition_pack_release(${uuidLit(r)})`,
  validate: (r) => `internal_api.validate_tradition_pack_release(${uuidLit(r)})`,
  retention: 'internal_api.tradition_pack_retention_report()',
};

const DECISIONS = ['accept', 'accept_with_changes', 'reject'];

// ------------------------------------------------------------------ the stale-packet pre-flight
// A review is a claim about specific bytes. When the digest an operator is holding no longer
// matches the material, that is not a database error waiting to happen — it is a packet that has
// gone stale, and it is exactly as actionable as a bad target or a malformed uuid, so it leaves
// this process as an operator refusal (exit 2) rather than as a route failure (exit 1).
//
// What keeps this honest is where the second digest comes from: it is read back from
// `internal_api.inspect_tradition_pack_release`, which recomputes it inside Postgres from the row's
// own material. This tool still computes nothing about a review, and the same comparison happens
// again inside the write statement, so the database remains the authority and this is a courtesy.
//
// The two lifecycle-shaped cases are deliberately left to the database: a review submitted against
// a release that is not a draft, and an approval for a release that has no recorded binding yet,
// have no digest to be stale against, and inventing one here would replace the guard's true reason
// with this tool's guess.
function assertDigestStillBinds(target) {
  const expected = needHash(args.hash, 'hash');
  const seen = extractJson(
    runPsql(target, `SELECT ${fn.inspect(needUuid(args.release, 'release'))} AS result;`));
  const current = seen.review_payload_recomputed;
  const recorded = seen.release?.review_packet_hash ?? null;

  if (command === 'submit-review' && seen.release?.status === 'draft' && expected !== current) {
    throw new Refusal(`refused: this review names packet ${expected}, but the material as it now `
      + `stands digests to ${current}. Nothing was written: that packet is stale, so produce it `
      + 'again with review-packet and submit against the digest it prints.');
  }
  if (command === 'approve' && recorded !== null) {
    if (expected !== recorded) {
      throw new Refusal(`refused: release ${seen.release.release_number} is reviewed against `
        + `packet ${recorded}, and this approval names ${expected}. Nothing was written: the `
        + 'digest named here is stale relative to the review the row carries.');
    }
    if (recorded !== current) {
      throw new Refusal(`refused: release ${seen.release.release_number} is bound to packet `
        + `${recorded}, but the material as it now stands digests to ${current}. Nothing was `
        + 'written: the review this approval would sign off has gone stale.');
    }
  }
}

// ------------------------------------------------------------------ the packet renderer
// §E's artefact. It renders the payload and the digest the database produced, and the only thing
// it decides for itself is layout. The hash printed at the top of the file and the hash stored in
// the row are the same string because the same function made both.
function renderPacket(packet) {
  const p = packet;
  const sections = (p.definition?.sections ?? []).map((s) => [
    `### position ${s.position} — ${s.section_key}`,
    `- kind: \`${s.kind}\` · required: **${s.required}**`,
    `- host may change the wording (\`override_rule\`): \`${s.override_rule ?? 'host_may_replace (the version-1 default)'}\``,
    `- host field: ${s.host_field ? `\`${s.host_field}\`` : '—'}`,
    ...(s.requires_venue !== undefined ? [`- every event must have a venue: **${s.requires_venue}**`] : []),
    `- heading: ${JSON.stringify(s.heading ?? null)}`,
    `- reviewed wording: ${JSON.stringify(s.pack_text ?? null)}`,
    ...(s.allow_english_fallback !== undefined
      ? [`- English fallback permitted: **${s.allow_english_fallback}**`] : []),
  ].join('\n')).join('\n\n');
  return [
    '# Tradition pack — cultural review packet',
    '',
    `Generated by \`scripts/tradition-pack-admin.mjs review-packet\`. The canonical payload and the`,
    `SHA-256 below are produced inside Postgres by \`private.tradition_pack_review_hash\`, not here.`,
    '',
    '| field | value |',
    '| --- | --- |',
    `| pack key | \`${p.pack_key}\` |`,
    `| pack display name | ${p.pack_display_name} |`,
    `| pack scope statement | ${p.pack_scope_statement} |`,
    `| release number | ${p.release_number} |`,
    `| release status | \`${p.status}\` |`,
    `| definition schema version | ${p.definition_schema_version} |`,
    `| languages covered | ${(p.languages ?? []).join(', ')} |`,
    `| author label | ${p.author_label} |`,
    `| machine assistance | **${p.machine_assisted}** |`,
    `| machine-assistance note | ${p.machine_assistance_notes ?? '(none)'} |`,
    `| source reference | ${p.source_reference ?? '(none)'} |`,
    `| changelog | ${p.changelog ?? '(none)'} |`,
    '',
    '## Authoritative review digest',
    '',
    '```',
    p.review_packet_hash,
    '```',
    p.review_packet_hash_recorded
      ? `\n_(already recorded on the row: \`${p.review_packet_hash_recorded}\` — a submission must `
        + 'name the digest above, and a different value means the material moved since.)_'
      : '\n_(not yet recorded: the digest is stamped by the database when this review is submitted.)_',
    '',
    '## Ordered sections',
    '',
    sections || '_the definition declares no sections_',
    '',
    p.definition?.event_vocabulary
      ? ['## Event vocabulary', '', ...p.definition.event_vocabulary.map(
          (ev) => `- \`${ev.event_key}\` — ${JSON.stringify(ev.labels)}`)].join('\n') + '\n' : '',
    p.definition?.design_guidance
      ? `## Design guidance\n\n\`\`\`json\n${JSON.stringify(p.definition.design_guidance, null, 2)}\n\`\`\`\n`
      : '',
    '## Canonical payload (the bytes the digest is of)',
    '',
    '```text',
    p.canonical_payload,
    '```',
    '',
    '## Open cultural questions for the reviewer',
    '',
    'This section is intentionally unanswered. A reviewer records what they read in',
    '`review_scope`, what qualified them to read it in `review_basis`, and which languages that',
    'covers in `reviewed_languages` — all of which are **outside** the digest above, because they',
    'are the answer rather than the material.',
    '',
    '1. Does any wording here speak for a community, a lineage or a religious act?',
    '2. Is each language represented by a reader of that language, rather than by a translation?',
    '3. Should any of this wording exist at all, or should the release ask the host to write it?',
    '',
    '## Reviewer record — to be completed, and deliberately outside the digest',
    '',
    'These are the reviewer\'s ANSWER, not the material, which is why they are not hashed above:',
    'the digest is of what a reviewer was shown, and a value written in the same statement that',
    'computes it cannot be inside it.',
    '',
    '| field | reviewer fills in |',
    '| --- | --- |',
    '| reviewer identity | |',
    '| qualification / basis | |',
    '| scope of what was actually read | |',
    '| languages reviewed | |',
    `| reviewed against digest | \`${p.review_packet_hash}\` |`,
    '',
    '## Decision',
    '',
    'One of `ACCEPT`, `ACCEPT WITH CHANGES`, `REJECT`, submitted with the digest printed above.',
    'A rejection is not a lifecycle state: the release stays a draft and this packet is the record.',
    '',
  ].join('\n');
}

// ------------------------------------------------------------------ commands
function main() {
  // The remote-target refusal runs before anything else, including the command check: an
  // invocation that asks for a hosted database is refused for asking, not for what it typed.
  if (args.linked || args['project-ref'] || args.hosted !== undefined) {
    throw new Refusal(
      'refused: this tool is local-only. --linked, --project-ref and any hosted target are not '
      + 'supported here, by design.');
  }
  if (!command) {
    process.stdout.write('commands: list | inspect | create-pack | create-release | '
      + 'validate-release | update-draft | review-packet | submit-review | approve | deprecate | '
      + 'retention\n');
    throw new Refusal('refused: no command given.');
  }
  const target = resolveTarget();
  assertSession(null, target);

  const mutates = ['create-pack', 'create-release', 'update-draft', 'submit-review', 'approve',
    'deprecate'].includes(command);
  if (mutates && args.yes !== true) {
    printPlan(command);
    throw new Refusal('refused: nothing was executed. Re-run with --yes to perform the '
      + 'transition printed above.');
  }
  printPlan(command);

  const sql = buildCall(command);
  // After `buildCall`, so a malformed operand is answered before this spends a round-trip on it.
  if (command === 'submit-review' || command === 'approve') assertDigestStillBinds(target);

  const wrapped = mutates ? `BEGIN;\nSELECT ${sql} AS result;\nCOMMIT;\n`
                          : `SELECT ${sql} AS result;\n`;
  const text = runPsql(target, wrapped);
  const json = extractJson(text);

  if (command === 'review-packet') {
    const dir = String(args.out ?? 'docs/reviews/packets');
    mkdirSync(dir, { recursive: true });
    const base = join(dir, `${json.pack_key}-r${json.release_number}.`);
    writeFileSync(`${base}md`, renderPacket(json));
    writeFileSync(`${base}json`, JSON.stringify(json, null, 2));
    process.stdout.write(`packet written: ${base}md and ${base}json\n`);
    process.stdout.write(`authoritative digest: ${json.review_packet_hash}\n`);
    return;
  }
  process.stdout.write(JSON.stringify(json, null, 2) + '\n');
}

// The psql -At output for one row of one jsonb column, with the `AS result` header absent,
// is the JSON document itself. Anything else means the statement printed something unexpected.
function extractJson(text) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const candidate = lines[lines.length - 1];
  try { return JSON.parse(candidate); }
  catch {
    throw new Error(`unexpected output:\n${lines.join('\n').slice(0, 1200)}`);
  }
}

function buildCall(cmd) {
  switch (cmd) {
    case 'list': return fn.catalog;
    case 'retention': return fn.retention;
    case 'inspect': return fn.inspect(needUuid(args.release, 'release'));
    case 'validate-release': return fn.validate(needUuid(args.release, 'release'));
    case 'deprecate': return fn.deprecate(needUuid(args.release, 'release'));
    case 'approve': return fn.approve(needUuid(args.release, 'release'),
                                      needHash(args.hash, 'hash'));
    case 'update-draft': return fn.updateDraft(needUuid(args.release, 'release'),
                                               readMaybeStdin(args.patch));
    case 'review-packet': return fn.packet(needUuid(args.release, 'release'));
    case 'create-pack': {
      if (!SLUG_RE.test(String(args.key ?? ''))) {
        throw new Refusal(`refused: --key must be a lower_snake slug, got ${JSON.stringify(args.key)}.`);
      }
      return fn.createPack(args.key, args.name, args.scope);
    }
    case 'create-release': {
      if (!SLUG_RE.test(String(args.key ?? ''))) {
        throw new Refusal(`refused: --key must be a lower_snake slug, got ${JSON.stringify(args.key)}.`);
      }
      return fn.createRelease({
        key: args.key,
        definition: readMaybeStdin(args.definition),
        dsv: Number(args.dsv ?? 2),
        languages: args.languages ?? 'en,ta',
        author: args.author ?? 'Machine-assisted draft; no human cultural review has been recorded.',
        // A release minted through this tool is machine-assisted, and there is no form of the
        // command that claims otherwise. `BOOLEAN_FLAGS` makes `--machine-assisted` parse to
        // `true` or `undefined`, so the ternary this line used to hold could never reach `false`
        // — the value was right and the expression was a lie about having a choice. The Stage 5
        // audit's §33 closure section records it as FINDING 6, repaired here by saying what the
        // tool does; the
        // disclosure itself is pinned by `stage5_admin_cli.test.mjs`, which asserts
        // `"machine_assisted": true` on a release this CLI created.
        machineAssisted: true,
        notes: args.notes ?? null,
        source: args.source ?? null,
        changelog: args.changelog ?? null,
      });
    }
    case 'submit-review': {
      if (!DECISIONS.includes(String(args.decision))) {
        throw new Refusal(`refused: --decision is one of ${DECISIONS.join(', ')}.`);
      }
      return fn.submit({
        release: needUuid(args.release, 'release'),
        decision: args.decision,
        reviewer: args.reviewer,
        basis: args.basis,
        scope: args.scope,
        languages: args.languages ?? 'en,ta',
        hash: needHash(args.hash, 'hash'),
      });
    }
    default: throw new Refusal(`refused: unknown command ${JSON.stringify(cmd)}.`);
  }
}

// Every mutating step says what it is about to do, in the terms §F lists: the pack, the release
// number where it is known, the status it is in now, the transition requested, and the review
// digest the step will be bound to. This is printed before the --yes check, so a refused run has
// still told the operator what it would have done.
function printPlan(cmd) {
  const lines = [];
  switch (cmd) {
    case 'create-pack':
      lines.push(`create the pack concept ${JSON.stringify(args.key)}`);
      break;
    case 'create-release':
      lines.push(`pack key: ${args.key}`);
      lines.push('current status: (none — a release is born a draft; status is not an argument)');
      lines.push('requested transition: (none — created as draft)');
      break;
    case 'update-draft':
      lines.push(`release: ${args.release}`);
      lines.push('requested transition: draft -> draft (content edited)');
      lines.push('note: a draft carries no digest; the digest a review binds to is produced when '
        + 'the review is submitted, from whatever the content is then');
      break;
    case 'submit-review':
      lines.push(`release: ${args.release}`);
      lines.push(`requested transition: draft -> reviewed (decision ${args.decision}); `
        + 'a rejection is not a state and leaves the release a draft');
      lines.push(`review digest this submission is bound to: ${args.hash}`);
      break;
    case 'approve':
      lines.push(`release: ${args.release}`);
      lines.push('requested transition: reviewed -> approved');
      lines.push(`review digest the approval re-compares against the material: ${args.hash}`);
      break;
    case 'deprecate':
      lines.push(`release: ${args.release}`);
      lines.push('requested transition: approved -> deprecated');
      lines.push('note: existing invitations and every version already frozen from it are '
        + 'unaffected; no new wedding may select it and no new version may be frozen from it');
      break;
    default:
      return;
  }
  process.stdout.write(`# plan for ${cmd}\n${lines.map((l) => `  ${l}`).join('\n')}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err instanceof Refusal ? 'REFUSED' : 'ERROR'}: ${err.message}\n`);
  process.exit(err.exitCode ?? 1);
}
