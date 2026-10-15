// S9-8e: the decisions the trusted publisher makes, separated from the channels it makes them over.
//
// Why this file exists. The publisher is one process that holds three dangerous things at once — a
// service-role credential, a database session that can write the manifest, and the bytes a browser
// just drew — so the part that decides *what may happen* has to be testable without any of them.
// Everything here is a pure function over values: no fetch, no psql, no filesystem, no environment.
// `stage9-output-publisher.mjs` is the only place that acts on these answers.
//
// What the functions hold the publisher to:
//   * **The manifest's vocabulary is imported, never re-spelled.** `OUTPUT_KINDS`, `OUTPUT_VARIANTS`
//     and `OUTPUT_FORMATS` come from `src/lib/invitationOutputs.ts`, which is the host panel's own
//     reading of the same CHECK sets in
//     `supabase/migrations/20261013120000_stage9_render_outputs.sql`. A third copy of a vocabulary is
//     a value that can be legal in one copy and refused by the database, and the failure would show up
//     as a publisher that "cannot address" an artefact the schema is perfectly willing to hold.
//   * **Pre-flight is for clarity, not for permission.** The refusals below exist so an operator gets
//     a named reason before a statement runs, not so the publisher can believe its own checks: every
//     write is still decided by the trigger and CHECK set that guards the table, and
//     `supabase/tests/stage9/80_render_manifest.sql` is what measures that. Nothing here re-enforces a
//     render shape (`kind` × `variant` × `format`) because a mismatch there costs one aborted
//     statement and leaves no row behind — a second copy of that table would only be able to disagree
//     with the database about it.
//   * **The lifecycle is the migration's six edges, and only six.** `LIFECYCLE_EDGES` restates
//     `private.guard_invitation_output_update()`'s forward list (`:341-350`) so the publisher never
//     sends an UPDATE the guard will refuse, and `patchForTransition()` attaches the columns each edge
//     is required to carry — `ready` its digest, `failed` exactly one new attempt and a named reason,
//     `invalidated` its reason. The three rules that are *not* edges are here too: a write that changes
//     no status may change no evidence (`:320-330`), an `invalidated` row is terminal (`:332-334`), and
//     a `failed` row that never proved bytes is removed rather than invalidated (`:366-369`).
//   * **Verification is read out of the bytes, never out of the record that describes them.**
//     `verifyReadBack()` re-runs the worker's own byte readers over what Storage handed back, so a
//     truncated object, a wrong mime, or a file that is not the artefact the row claims is refused
//     before any row can say `ready`.
//
// The one ambiguity this file has to resolve, stated rather than hidden: a `qr` plate renders no
// document, so it has no DTO to digest, while `source_dto_digest` is NOT NULL by design (§7.2 — "the
// proof that the artefact and the guest page read one document"). The publisher fills it with the
// digest of **the same immutable version's public DTO**, because that is the document whose address
// the plate encodes; the plate's own input is recorded where it belongs, in `target_url_digest`. A
// QR row's `source_dto_digest` therefore means "the version this plate belongs to", not "the bytes I
// drew", and `docs/audits/stage-9-render-exports.md` says so in the same words.

import { createHash } from 'node:crypto';

import {
  OUTPUT_FORMATS,
  OUTPUT_KINDS,
  OUTPUT_VARIANTS,
  INVALIDATION_REASONS,
} from '../src/lib/invitationOutputs.ts';
import { imageDimensions, readPdfStructure, withinByteCeiling } from './stage9-render-worker.mjs';
import { PDF_MEDIA_BOX_PT } from '../src/render/outputGeometry.ts';

/** §7.2's ceiling restated so a retry that cannot record a sixth attempt refuses before writing. The
 *  database keeps the authority: `CHECK (attempt_count >= 0 AND attempt_count <= 5)`. */
export const MAX_ATTEMPTS = 5;

/** The mime the Storage API is handed, and the one the bucket allow-list admits
 *  (`invitation-outputs` was created with exactly these three, nothing else). */
export const ARTEFACT_MIME = Object.freeze({
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
});

const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME = /^(.*)_p([1-9][0-9]*)\.([a-z]+)$/;

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const isHex64 = (value) => typeof value === 'string' && HEX64.test(value);
export const isUuid = (value) => typeof value === 'string' && UUID.test(value);

/** The private domain, which is the only one this build may write: `invitation-previews` has no read
 *  policy and its consent decision is open (§10.3), so publishing into it would activate an unapproved
 *  mechanism. */
export const STORAGE_DOMAIN = 'host_private';

/** The bucket §8 names for every file a host downloads. Spelled once here and once in the panel's
 *  transport, which is the same pair Stage 6 keeps for `wedding-assets`. */
export const OUTPUT_BUCKET = 'invitation-outputs';

/**
 * The worker's file name into the manifest's four identity columns.
 *
 * `writeArtefact()` builds `name` from exactly these values, so parsing it back is not a second source
 * of truth — it is the one place where a record that left the worker can be checked against the label
 * on its own file. A name this function cannot read is a worker that changed its naming rule, and the
 * publisher must refuse rather than guess a `variant` out of a string it does not recognise: guessing
 * would put a row in the manifest describing a geometry nothing drew.
 */
export function artefactIdentity(name) {
  const match = NAME.exec(String(name ?? ''));
  if (match === null) return { ok: false, reason: 'artefact-name-unreadable', name: String(name) };
  const [, head, page, format] = match;
  const cut = head.lastIndexOf('_');
  const kind = cut < 0 ? '' : head.slice(0, cut);
  const variant = cut < 0 ? head : head.slice(cut + 1);
  if (!(OUTPUT_KINDS).includes(kind)) return { ok: false, reason: 'artefact-kind-unknown', kind };
  if (!(OUTPUT_VARIANTS).includes(variant)) return { ok: false, reason: 'artefact-variant-unknown', variant };
  if (!(OUTPUT_FORMATS).includes(format)) return { ok: false, reason: 'artefact-format-unknown', format };
  return { ok: true, kind, variant, format, pageNumber: Number(page), mime: ARTEFACT_MIME[format] };
}

/**
 * The column map for one INSERT, or the reason there is none.
 *
 * `object_key` is absent by construction: the mint trigger refuses a supplied key with 42501 and the
 * key is read back from the inserted row. `status`, `attempt_count` and every evidence column are
 * absent too, because a row is born `registered` with no evidence of bytes it has not produced.
 *
 * `identity` is the parsed file name (`artefactIdentity`) and `artefact` the worker's record for that
 * one file, which is where `render_config_hash`, `content_digest` and the byte length come from. They
 * are kept as two arguments on purpose: a candidate that says one thing in its name and another in its
 * hash is a worker/record disagreement the tier has to be able to point at.
 */
export function planRegistration({ identity, artefact, versionId, weddingId, sourceDtoDigest, targetUrlDigest = null } = {}) {
  if (identity?.ok !== true) return { ok: false, reason: 'registration-needs-a-parsed-identity' };
  if (artefact === null || typeof artefact !== 'object') {
    return { ok: false, reason: 'registration-needs-the-worker-record' };
  }
  if (!isUuid(weddingId)) return { ok: false, reason: 'registration-wedding-id-not-uuid' };
  if (!isUuid(versionId)) return { ok: false, reason: 'registration-version-id-not-uuid' };
  if (!isHex64(artefact.render_config_hash)) {
    return { ok: false, reason: 'registration-config-hash-not-sha256' };
  }
  if (!isHex64(artefact.content_digest)) {
    return { ok: false, reason: 'registration-content-digest-not-sha256' };
  }
  if (!isHex64(sourceDtoDigest)) return { ok: false, reason: 'registration-dto-digest-not-sha256' };
  // `invitation_outputs_qr_target` makes the pair one fact: a plate must say what it points at, and
  // nothing else may. Reaching the database with only half of it would abort the INSERT for a reason
  // an operator has to reverse-engineer, so it is refused here with the sentence the design uses.
  if (identity.kind === 'qr' && !isHex64(targetUrlDigest)) {
    return { ok: false, reason: 'registration-qr-needs-target-url-digest' };
  }
  if (identity.kind !== 'qr' && targetUrlDigest !== null && targetUrlDigest !== undefined) {
    return { ok: false, reason: 'registration-target-url-digest-belongs-to-a-qr-only' };
  }
  if (!Number.isInteger(identity.pageNumber) || identity.pageNumber < 1) {
    return { ok: false, reason: 'registration-page-number-not-positive' };
  }
  return {
    ok: true,
    insert: {
      wedding_id: weddingId,
      version_id: versionId,
      output_kind: identity.kind,
      variant: identity.variant,
      format: identity.format,
      page_number: identity.pageNumber,
      render_config_hash: artefact.render_config_hash,
      source_dto_digest: sourceDtoDigest,
      target_url_digest: identity.kind === 'qr' ? targetUrlDigest : null,
      storage_domain: STORAGE_DOMAIN,
    },
    expected: {
      content_digest: artefact.content_digest,
      size_bytes: artefact.bytes,
      render_config_hash: artefact.render_config_hash,
      format: identity.format,
      kind: identity.kind,
      variant: identity.variant,
      mime: identity.mime,
    },
  };
}

/** The six forward edges of the output lifecycle, copied from the guard trigger's own list. */
export const LIFECYCLE_EDGES = Object.freeze([
  ['registered', 'uploading'],
  ['uploading', 'ready'],
  ['uploading', 'failed'],
  ['failed', 'uploading'],
  ['failed', 'invalidated'],
  ['ready', 'invalidated'],
]);

/**
 * The column map for one UPDATE, or the reason that write must not be sent.
 *
 * Each rule is the mirror of a guard the database enforces, and the shape of the patch is what makes
 * the guard reachable rather than surprising:
 *   * a same-status write carries no column at all ("a write that changes no status may change no
 *     evidence either", `:320-330`);
 *   * `ready` carries the digest the `ready_evidence` CHECK demands and nothing else — `ready_at` is
 *     stamped by the trigger from the database's clock (`:355-360`), so a worker that supplied its own
 *     would make a superseded artefact look newer than the row that replaced it;
 *   * `failed` carries exactly `attempt_count + 1` and a named reason, and refuses at the ceiling;
 *   * `invalidated` carries a reason from the CHECK-bounded set and requires the row to have proven
 *     bytes, because retiring a row that never became ready is the absence of an artefact, not a
 *     statement about one.
 */
export function patchForTransition({ from, to, row, digest = null, reason = null, invalidationReason = null }) {
  if (typeof from !== 'string' || typeof to !== 'string') {
    return { ok: false, reason: 'transition-status-unreadable' };
  }
  if (from === to) return { ok: false, reason: 'same-status-write-may-move-no-evidence' };
  if (LIFECYCLE_EDGES.some(([a, b]) => a === from && b === to) === false) {
    return { ok: false, reason: `no-edge-${from}-to-${to}` };
  }
  if (to === 'uploading') {
    if (row?.attempt_count >= MAX_ATTEMPTS && from === 'failed') {
      return { ok: false, reason: 'retry-ceiling-reached', attempts: row.attempt_count };
    }
    return { ok: true, patch: { status: 'uploading' } };
  }
  if (to === 'ready') {
    if (!isHex64(digest)) return { ok: false, reason: 'ready-requires-a-sha256-digest' };
    return { ok: true, patch: { status: 'ready', content_digest: digest } };
  }
  if (to === 'failed') {
    if (typeof reason !== 'string' || reason.trim() === '') {
      return { ok: false, reason: 'failure-must-name-its-reason' };
    }
    const attempts = row?.attempt_count;
    if (!Number.isInteger(attempts) || attempts < 0) {
      return { ok: false, reason: 'attempt-count-unreadable' };
    }
    if (attempts + 1 > MAX_ATTEMPTS) {
      return { ok: false, reason: 'retry-ceiling-reached', attempts };
    }
    return { ok: true, patch: { status: 'failed', attempt_count: attempts + 1, last_error: reason } };
  }
  // `invalidated`
  if (!(INVALIDATION_REASONS).includes(invalidationReason)) {
    return { ok: false, reason: 'invalidation-reason-unknown', invalidationReason };
  }
  if (!isHex64(row?.content_digest)) {
    return { ok: false, reason: 'invalidation-requires-proven-bytes' };
  }
  return { ok: true, patch: { status: 'invalidated', invalidation_reason: invalidationReason } };
}

/**
 * What the slot already holds, and what may therefore be done.
 *
 * The uniqueness tuple is `(version_id, output_kind, variant, format, page_number,
 * render_config_hash)`, so at most one row may carry the candidate's hash. The three things that can
 * be true of that row decide the run:
 *
 *   * `ready` → nothing to upload; re-verify the object and leave the row alone (a second identical
 *     publish is a no-op, which is what makes the tool safe to re-run).
 *   * `registered` / `uploading` / `failed` → a previous run stopped mid-flight. Its key is already
 *     minted and immutable, so the row is continued, not replaced.
 *   * `invalidated` → the tuple is held by a retired row and cannot be re-issued: `ready → failed` and
 *     `invalidated → anything` are both illegal, and replacing the row would mean deleting the evidence
 *     that the artefact ever existed. The slot is refused with a name.
 *
 * Rows with a *different* hash are the stale versions of the same slot. A `ready` one is superseded —
 * its object removed, then the row marked `invalidated` with reason `superseded`, which is §12's
 * delete-then-mark and the only edge out of `ready`. A `registered` or `uploading` one is reclaimed:
 * its object removed, then failed with a named reason so the manifest says "this render did not finish"
 * rather than leaving a row that claims work is in flight forever — and because the lifecycle has no
 * `registered → failed` edge, a `registered` row is stepped through `uploading` first, which is exactly
 * what the guard's own HINT spells. A `failed` one keeps its evidence and loses only any object still
 * sitting behind it. Nothing is deleted from the table by this plan: a row that failed is retry
 * evidence, and the publisher's own header says it is not a deleter.
 */
export function reconcileSlot({ rows = [], candidateHash } = {}) {
  if (!isHex64(candidateHash)) return { action: 'refuse', reason: 'reconcile-candidate-hash-unreadable' };
  const same = rows.filter((row) => row.render_config_hash === candidateHash);
  const other = rows.filter((row) => row.render_config_hash !== candidateHash);
  if (same.length > 1) {
    return { action: 'refuse', reason: 'reconcile-tuple-held-by-two-rows', count: same.length };
  }
  const plan = {
    action: 'publish',
    resume: null,
    reuse: null,
    supersede: [],
    reclaim: [],
    orphan_check: [],
    retired: [],
  };
  const row = same[0];
  if (row !== undefined) {
    if (row.status === 'ready') {
      plan.action = 'verify';
      plan.reuse = row;
    } else if (row.status === 'invalidated') {
      return { action: 'refuse', reason: 'tuple-held-by-an-invalidated-row', row_id: row.id };
    } else {
      plan.action = 'resume';
      plan.resume = row;
    }
  }
  for (const stale of other) {
    if (stale.status === 'ready') plan.supersede.push(stale);
    else if (stale.status === 'registered' || stale.status === 'uploading') plan.reclaim.push(stale);
    else if (stale.status === 'failed') plan.orphan_check.push(stale);
    else plan.retired.push(stale);
  }
  return plan;
}

/**
 * The read-back, checked against the artefact rather than against the record that made it.
 *
 * Four properties, all of them facts about the bytes: the digest, the length, the served content type,
 * and the geometry the file itself states (a PNG/WebP header for a raster, the `/MediaBox` the producer
 * wrote for a PDF). A plate is additionally held to its own 1 MiB ceiling, which is a property of the
 * kind rather than of the encoding.
 *
 * Nothing here re-derives a hash from the object's storage metadata or believes a `Content-Length`
 * without comparing the buffer it came with, because the whole point of reading the object back is that
 * the upload's own answer is the thing under test.
 */
export function verifyReadBack({ bytes, expected, contentType }) {
  if (Buffer.isBuffer(bytes) === false) return { ok: false, reason: 'readback-no-buffer' };
  if (bytes.length === 0) return { ok: false, reason: 'readback-empty-object' };
  if (expected?.format !== undefined && ARTEFACT_MIME[expected.format] === undefined) {
    return { ok: false, reason: 'readback-format-unknown' };
  }
  if (typeof contentType === 'string' && contentType !== ARTEFACT_MIME[expected.format]) {
    return { ok: false, reason: 'readback-mime-mismatch', served: contentType };
  }
  if (Number.isInteger(expected?.size_bytes) && bytes.length !== expected.size_bytes) {
    return {
      ok: false,
      reason: 'readback-size-mismatch',
      expected: expected.size_bytes,
      found: bytes.length,
    };
  }
  const digest = sha256Hex(bytes);
  if (isHex64(expected?.content_digest) === false) {
    return { ok: false, reason: 'readback-expected-digest-unreadable' };
  }
  if (digest !== expected.content_digest) {
    return { ok: false, reason: 'readback-digest-mismatch', expected: expected.content_digest, found: digest };
  }

  const ceiling = withinByteCeiling(bytes, expected.kind === 'qr' ? 'qr' : expected.format);
  if (ceiling.ok === false) {
    return { ok: false, reason: 'readback-over-ceiling', bytes: ceiling.bytes, ceiling: ceiling.ceiling };
  }

  if (expected.format === 'pdf') {
    const structure = readPdfStructure(bytes);
    if (structure.ok === false) return { ok: false, reason: `readback-${structure.reason}` };
    const want = PDF_MEDIA_BOX_PT[expected.variant];
    if (want === undefined) return { ok: false, reason: 'readback-pdf-paper-unknown', variant: expected.variant };
    if (structure.mediaBoxes.length !== 1
      || structure.mediaBoxes[0].widthPt !== want.width
      || structure.mediaBoxes[0].heightPt !== want.height) {
      return {
        ok: false,
        reason: 'readback-pdf-box-mismatch',
        expected: `${want.width}x${want.height}`,
        found: structure.mediaBoxes.map((b) => `${b.widthPt}x${b.heightPt}`).join(', ') || 'none',
      };
    }
    return {
      ok: true,
      content_digest: digest,
      size_bytes: bytes.length,
      properties: { page_count: structure.pageCount, producer: structure.producer, media_box: structure.mediaBoxes[0] },
    };
  }

  const dims = imageDimensions(bytes, expected.format);
  if (dims.ok === false) return { ok: false, reason: `readback-image-header-${dims.reason}` };
  if (expected.kind === 'qr') {
    // The plate is square by construction (§5 draws it at an integer module scale), and its side is a
    // property of the browser's canvas, not of the `25mm/40mm/60mm` label, so the only geometry claim
    // a stored plate can honestly be checked against is squareness plus the ceiling above.
    if (dims.width !== dims.height) {
      return { ok: false, reason: 'readback-plate-not-square', width: dims.width, height: dims.height };
    }
    return { ok: true, content_digest: digest, size_bytes: bytes.length, properties: { pixels: dims.width } };
  }
  const [wantW, wantH] = String(expected.variant).split('x').map(Number);
  if (dims.width !== wantW || dims.height !== wantH) {
    return {
      ok: false,
      reason: 'readback-box-mismatch',
      expected: `${wantW}x${wantH}`,
      found: `${dims.width}x${dims.height}`,
    };
  }
  return { ok: true, content_digest: digest, size_bytes: bytes.length, properties: dims };
}

// ------------------------------------------------------------------ SQL text
// Two rules make injection impossible rather than merely unlikely, copied from the Stage 5
// maintenance tool's own discipline (`scripts/tradition-pack-admin.mjs:139-151`): every text value is
// a standard string literal with its quotes doubled, and every document travels base64-encoded and is
// decoded inside Postgres, so a payload cannot contain a quote, a backslash or a newline the
// statement's syntax would see. The runner asserts `standard_conforming_strings = on` before any of
// these strings is sent.
/** One standard string literal, quotes doubled. Exported because the unit battery pins it: `last_error`
 *  is the only column that ever carries a sentence with punctuation in it, and it is the one place a
 *  statement could be bent. */
export function sqlText(value) {
  if (value === null || value === undefined) return 'NULL';
  const s = String(value);
  if (s.includes('\u0000')) throw new Error('a value contains a NUL byte');
  return `'${s.replaceAll("'", "''")}'`;
}

const uuidSql = (value, label) => {
  if (!isUuid(value)) throw new Error(`${label} is not a uuid`);
  return `${sqlText(value.toLowerCase())}::uuid`;
};

const intSql = (value) => {
  if (!Number.isInteger(value)) throw new Error('an integer column was handed a non-integer');
  return String(value);
};

/** A document leaves the statement base64-encoded and is decoded inside Postgres, so no quote,
 *  backslash or newline in a JSON payload can reach the statement's own syntax. `psql -At` then answers
 *  with one unbroken line, which is what makes the CLI's parsing total rather than best-effort. */
const b64Out = (expr) => `encode(convert_to((${expr})::text, 'utf8'), 'base64')`;

/** The version, its wedding, and the one projection the guest page also reads.
 *
 *  `private.public_invitation_dto(...)` is the same expression
 *  `internal_api.render_invitation_document` evaluates (`:540`), reached through the local maintenance
 *  identity because that body is revoked from `service_role` and takes its authority from `auth.uid()`,
 *  which a maintenance session does not have. Reading the snapshot and projecting it here instead would
 *  be a second implementation of "what a guest sees", which is the one thing this stage's determinism
 *  claim cannot survive; the HTTP tier compares this result against the RPC's for the same version. */
export function sqlReadVersion(versionId) {
  return `SELECT ${b64Out(`json_build_object(
    'wedding_id', v.wedding_id::text,
    'version_id', v.id::text,
    'snapshot_schema_version', v.snapshot_schema_version,
    'dto', private.public_invitation_dto(v.snapshot_schema_version, v.snapshot)
  )`)} AS version
  FROM public.invitation_versions v
  WHERE v.id = ${uuidSql(versionId, 'version_id')};`;
}

/** Every row that already occupies this (version, kind, variant, format, page) slot, at any config.
 *
 *  The publisher reads `object_key`, which the client-facing RPC deliberately withholds: this process
 *  is the one that has to address the object, and the panel still gets no path from anywhere. */
export function sqlSlotRows({ versionId, kind, variant, format, pageNumber }) {
  if (!(OUTPUT_KINDS).includes(kind)) throw new Error(`unknown output_kind: ${kind}`);
  if (!(OUTPUT_VARIANTS).includes(variant)) throw new Error(`unknown variant: ${variant}`);
  if (!(OUTPUT_FORMATS).includes(format)) throw new Error(`unknown format: ${format}`);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error('page_number must be positive');
  return `SELECT ${b64Out(`coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at), '[]'::jsonb)`)} AS rows
  FROM (
    SELECT o.id::text AS id, o.object_key, o.status, o.content_digest, o.render_config_hash,
           o.attempt_count, o.last_error, o.invalidation_reason, o.ready_at, o.created_at
      FROM public.invitation_outputs o
     WHERE o.version_id = ${uuidSql(versionId, 'version_id')}
       AND o.output_kind = ${sqlText(kind)}
       AND o.variant = ${sqlText(variant)}
       AND o.format = ${sqlText(format)}
       AND o.page_number = ${pageNumber}
  ) x;`;
}

/** The registration, with the minted identity read back out of the same statement.
 *
 *  Refusing to emit a statement that names `object_key` or `status` is the mechanical half of "the key
 *  is minted by the database": the publisher cannot write what it cannot spell. */
export function sqlInsertRegistration(registration) {
  const columns = Object.keys(registration);
  if (columns.includes('object_key')) throw new Error('object_key is minted by the database');
  if (columns.includes('status')) throw new Error('a new row is always registered');
  const values = columns.map((column) => {
    const value = registration[column];
    if (column === 'page_number') {
      if (!Number.isInteger(value) || value < 1) throw new Error('page_number must be positive');
      return String(value);
    }
    if (column === 'wedding_id' || column === 'version_id') return `${sqlText(value)}::uuid`;
    return sqlText(value);
  });
  return `INSERT INTO public.invitation_outputs (${columns.join(', ')})
VALUES (${values.join(', ')})
RETURNING ${b64Out(`json_build_object('id', id::text, 'object_key', object_key,
                                      'status', status, 'storage_domain', storage_domain)`)} AS inserted;`;
}

/** One lifecycle step. Only the columns the transition is allowed to carry are named, so a patch that
 *  tried to move an identity column could not reach the database through this function. */
export function sqlTransition(rowId, patch) {
  const allowed = new Set(['status', 'content_digest', 'attempt_count', 'last_error', 'invalidation_reason']);
  const keys = Object.keys(patch);
  if (keys.length === 0) throw new Error('an empty patch would be a same-status write, which is refused');
  if (keys.some((key) => !allowed.has(key))) {
    throw new Error(`a lifecycle patch may only move ${[...allowed].join(', ')}`);
  }
  if (!keys.includes('status')) throw new Error('a lifecycle patch must move a status');
  const set = keys.map((key) => `${key} = ${key === 'attempt_count' ? intSql(patch[key]) : sqlText(patch[key])}`)
    .join(',\n       ');
  return `UPDATE public.invitation_outputs
    SET ${set}
  WHERE id = ${uuidSql(rowId, 'row_id')}
  RETURNING ${b64Out(`json_build_object('id', id::text, 'status', status,
                                        'content_digest', content_digest, 'attempt_count', attempt_count,
                                        'last_error', last_error, 'invalidation_reason', invalidation_reason,
                                        'ready_at', ready_at, 'invalidated_at', invalidated_at)`)} AS row;`;
}

/** The manifest as the panel will see it, for the run report. Same projection the exposed RPC returns:
 *  no key, no URL, no target digest. */
export function sqlVersionManifest(versionId) {
  return `SELECT ${b64Out(`coalesce(jsonb_agg(row_to_json(x)::jsonb
      ORDER BY x.output_kind, x.variant, x.format, x.page_number, x.created_at), '[]'::jsonb)`)} AS manifest
  FROM (
    SELECT o.id::text AS id, o.version_id::text AS version_id, o.output_kind, o.variant, o.format,
           o.page_number, o.status, o.content_digest, o.render_config_hash, o.storage_domain,
           o.ready_at, o.invalidation_reason, o.attempt_count, o.last_error, o.created_at
      FROM public.invitation_outputs o
     WHERE o.version_id = ${uuidSql(versionId, 'version_id')}
  ) x;`;
}
