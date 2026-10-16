// S9-8e: the publisher's decisions, pinned without a database, a bucket or a browser.
//
// `stage9-publish-core.mjs` is the half of the publisher that can be wrong in a way no live tier will
// notice. A false `ready` row is the worst outcome this stage can produce — it is a manifest entry
// promising bytes that were never verified, and the host's panel will offer a download for it until a
// human looks. Every case below is therefore about the *shape of a promise*: which writes the pure layer
// is willing to hand to the channels, and which it refuses before a statement is ever sent.
//
// What these tests hold it to:
//
//   * **The lifecycle is closed, not merely described.** The six legal edges each produce the exact
//     column map the guard requires, and a representative set of illegal ones each comes back with a
//     name. `registered → failed` is in that set because the guard's own HINT spells the two-step path,
//     and `invalidated → anything` is there because a terminal state that can be re-opened is the false
//     `ready` row arriving by another route. `LIFECYCLE_EDGES` is pinned at six entries so a future
//     migration that adds an edge cannot make the publisher silently wider than the table.
//   * **Evidence moves only with the fact it evidences.** `ready` carries a digest and nothing else,
//     `failed` carries exactly one new attempt plus a named reason, `invalidated` carries a reason from
//     the database's own vocabulary and requires the row to have proved bytes.
//   * **Verification reads the file, not the record.** Each `verifyReadBack` refusal is produced from
//     hand-written bytes with a *correct* digest for those bytes, so a refusal can only come from the
//     property the case names — a truncated object, a served `text/html`, a 1199-wide teaser, a plate
//     over §11.4's 1 MiB, a PDF on the wrong sheet.
//   * **The slot plan never destroys evidence.** Two rows cannot hold one uniqueness tuple, so the
//     `publish/verify/resume/refuse` branches are decided by status, and a tuple held by an
//     `invalidated` row is refused rather than re-issued. Nothing in any plan is a `DELETE`.
//   * **A statement cannot be bent by a value.** `sqlText` doubles quotes and refuses a NUL, the
//     emitters refuse identity columns and `object_key`, integers are emitted unquoted, and every
//     document leaves the statement base64-encoded.
//
// The fixtures are hand-written headers rather than captured renders for the same reason
// `pdfStructure.test.mjs` writes its PDFs by hand: a committed copy of a rendered file would be a second
// source of truth about what the browser produces, and these cases are about a *stored* object being
// checked, not about the encoder.

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ARTEFACT_MIME,
  LIFECYCLE_EDGES,
  MAX_ATTEMPTS,
  OUTPUT_BUCKET,
  STORAGE_DOMAIN,
  artefactIdentity,
  classifyRetirement,
  isHex64,
  patchForTransition,
  planRegistration,
  reconcileSlot,
  sqlInsertRegistration,
  sqlReadVersion,
  sqlSlotRows,
  sqlText,
  sqlTransition,
  sqlVersionManifest,
  verifyReadBack,
} from './stage9-publish-core.mjs';
import { INVALIDATION_REASONS } from '../src/lib/invitationOutputs.ts';

const WEDDING = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const ROW = '33333333-3333-4333-8333-333333333333';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digestOf = (seed) => createHash('sha256').update(seed).digest('hex');

/** A PNG that states the box it is asked for: signature, a 13-byte IHDR with the two dimensions, the
 *  five trailing IHDR fields, a placeholder CRC and `extra` padding bytes behind it. `imageDimensions`
 *  reads only the IHDR, which is the point — a file's claim about itself is its header. */
function pngBytes(width, height, extra = 0) {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'ascii');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.from([8, 6, 0, 0, 0]), Buffer.alloc(4), Buffer.alloc(extra)]);
}

/** A lossy WebP in the one chunk form that carries a canvas: `VP8X`, whose payload puts width−1 and
 *  height−1 at three bytes each, four and seven bytes in. */
function webpBytes(width, height, extra = 0) {
  const chunk = Buffer.alloc(18);
  chunk.write('VP8X', 0, 'ascii');
  chunk.writeUInt32LE(10, 4);
  chunk[8] = 0;
  chunk.writeUIntLE(width - 1, 12, 3);
  chunk.writeUIntLE(height - 1, 15, 3);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + chunk.length + extra, 4);
  riff.write('WEBP', 8, 'ascii');
  return Buffer.concat([riff, chunk, Buffer.alloc(extra)]);
}

/** One sheet of A4 in the order a producer writes it, with the `/MediaBox` Chromium answers with
 *  (`src/render/outputGeometry.ts` `PDF_MEDIA_BOX_PT.a4`, measured at five decimal places). */
function pdfBytes(box = '0 0 595.91998 841.91998', sheets = 1) {
  const pages = Array.from({ length: sheets }, (_, i) => `${i + 3} 0 obj << /Type /Page /MediaBox [${box}] >> endobj`).join('\n');
  return Buffer.from(`%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R /StructTreeRoot 9 0 R >> endobj
2 0 obj << /Type /Pages /Kids [${Array.from({ length: sheets }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${sheets} >> endobj
${pages}
12 0 obj << /Producer (Skia/PDF m155) >> endobj
trailer << /Size 13 /Root 1 0 R /Info 12 0 R >>
%%EOF`, 'latin1');
}

/** The expected block `planRegistration` returns, spelled once for the read-back cases. */
const expected = ({ kind, variant, format, bytes, contentTypeMime }) => ({
  kind,
  variant,
  format,
  mime: contentTypeMime ?? ARTEFACT_MIME[format],
  content_digest: sha(bytes),
  size_bytes: bytes.length,
  render_config_hash: digestOf('config'),
});

describe('artefactIdentity', () => {
  it('reads the four identity columns out of the name the worker wrote', () => {
    expect(artefactIdentity('og_image_1200x630_p1.png')).toEqual({
      ok: true, kind: 'og_image', variant: '1200x630', format: 'png', pageNumber: 1, mime: 'image/png',
    });
    expect(artefactIdentity('share_image_1080x2160_p3.webp')).toMatchObject({
      ok: true, kind: 'share_image', variant: '1080x2160', format: 'webp', pageNumber: 3,
    });
    expect(artefactIdentity('pdf_a4_p1.pdf')).toMatchObject({
      ok: true, kind: 'pdf', variant: 'a4', format: 'pdf', mime: 'application/pdf',
    });
    expect(artefactIdentity('qr_40mm_p1.png')).toMatchObject({
      ok: true, kind: 'qr', variant: '40mm', format: 'png',
    });
  });

  it('refuses a name it cannot read rather than guessing a geometry', () => {
    expect(artefactIdentity('teaser.png')).toMatchObject({ ok: false, reason: 'artefact-name-unreadable' });
    // A page zero is not a page: `page_number >= 1` is the table's own CHECK, and a name that claims
    // otherwise is a naming change, not a value to pass through.
    expect(artefactIdentity('og_image_1200x630_p0.png')).toMatchObject({ reason: 'artefact-name-unreadable' });
    expect(artefactIdentity(undefined)).toMatchObject({ reason: 'artefact-name-unreadable' });
  });

  it('names which vocabulary rejected a well-formed name', () => {
    expect(artefactIdentity('poster_1080x1350_p1.png')).toMatchObject({ reason: 'artefact-kind-unknown', kind: 'poster' });
    expect(artefactIdentity('og_image_999x999_p1.png')).toMatchObject({ reason: 'artefact-variant-unknown' });
    expect(artefactIdentity('og_image_1200x630_p1.jpg')).toMatchObject({ reason: 'artefact-format-unknown' });
    // A head with no underscore has no kind to read; guessing one would be inventing a column value.
    expect(artefactIdentity('1200x630_p1.png')).toMatchObject({ reason: 'artefact-kind-unknown', kind: '' });
  });
});

describe('planRegistration', () => {
  const artefact = (over = {}) => ({
    name: 'og_image_1200x630_p1.png',
    path: '/tmp/og_image_1200x630_p1.png',
    bytes: 2048,
    content_digest: digestOf('bytes'),
    render_config_hash: digestOf('config'),
    ...over,
  });
  const base = (over = {}) => ({
    identity: artefactIdentity('og_image_1200x630_p1.png'),
    artefact: artefact(),
    versionId: VERSION,
    weddingId: WEDDING,
    sourceDtoDigest: digestOf('dto'),
    ...over,
  });

  it('builds the column map the mint trigger will accept', () => {
    const plan = planRegistration(base());
    expect(plan.ok).toBe(true);
    expect(plan.insert).toEqual({
      wedding_id: WEDDING,
      version_id: VERSION,
      output_kind: 'og_image',
      variant: '1200x630',
      format: 'png',
      page_number: 1,
      render_config_hash: digestOf('config'),
      source_dto_digest: digestOf('dto'),
      target_url_digest: null,
      storage_domain: STORAGE_DOMAIN,
    });
    // The two columns the database owns are absent by construction, not null: a null `object_key` in an
    // INSERT is still a supplied value, and the mint trigger refuses one with 42501.
    expect('object_key' in plan.insert).toBe(false);
    expect('status' in plan.insert).toBe(false);
    expect(plan.expected).toEqual({
      content_digest: digestOf('bytes'),
      size_bytes: 2048,
      render_config_hash: digestOf('config'),
      format: 'png',
      kind: 'og_image',
      variant: '1200x630',
      mime: 'image/png',
    });
  });

  it('pairs a plate with the address it encodes and nothing else with one', () => {
    const target = digestOf('https://vivaahvarnam.in/i/abcdefghijklmnopabcdefghijklmnopqrstuvw');
    const plate = planRegistration(base({
      identity: artefactIdentity('qr_40mm_p1.png'),
      artefact: artefact({ name: 'qr_40mm_p1.png' }),
      targetUrlDigest: target,
    }));
    expect(plate.ok).toBe(true);
    expect(plate.insert.target_url_digest).toBe(target);
    expect(plate.insert.output_kind).toBe('qr');
    // The plate's `source_dto_digest` is the version's own document, which is the recorded reading of
    // §7.2's NOT NULL for a kind that draws no document at all.
    expect(plate.insert.source_dto_digest).toBe(digestOf('dto'));
    // `target_url_digest` never leaves as a URL: the record carries a hash, so there is no form of this
    // row in which the printed address can be read back out of the manifest.
    expect(JSON.stringify(plate)).not.toContain('vivaahvarnam.in');

    expect(planRegistration(base({
      identity: artefactIdentity('qr_40mm_p1.png'),
      artefact: artefact({ name: 'qr_40mm_p1.png' }),
    }))).toMatchObject({ ok: false, reason: 'registration-qr-needs-target-url-digest' });

    expect(planRegistration(base({ targetUrlDigest: digestOf('target') })))
      .toMatchObject({ ok: false, reason: 'registration-target-url-digest-belongs-to-a-qr-only' });
  });

  it.each([
    ['an unreadable identity', () => base({ identity: artefactIdentity('nope.png') }), 'registration-needs-a-parsed-identity'],
    ['no worker record', () => base({ artefact: null }), 'registration-needs-the-worker-record'],
    ['a wedding id that is not a uuid', () => base({ weddingId: 'wedding-one' }), 'registration-wedding-id-not-uuid'],
    ['a version id that is not a uuid', () => base({ versionId: 'latest' }), 'registration-version-id-not-uuid'],
    ['a config hash that is not sha256', () => base({ artefact: artefact({ render_config_hash: 'abc' }) }), 'registration-config-hash-not-sha256'],
    ['a content digest that is not sha256', () => base({ artefact: artefact({ content_digest: 'zz' }) }), 'registration-content-digest-not-sha256'],
    ['no DTO to be consistent with', () => base({ sourceDtoDigest: null }), 'registration-dto-digest-not-sha256'],
    ['an uppercase hex digest', () => base({ sourceDtoDigest: digestOf('dto').toUpperCase() }), 'registration-dto-digest-not-sha256'],
  ])('refuses %s before any INSERT can be built', (_label, build, reason) => {
    expect(planRegistration(build())).toMatchObject({ ok: false, reason });
  });
});

describe('patchForTransition', () => {
  const row = (over = {}) => ({
    id: ROW,
    status: 'registered',
    attempt_count: 0,
    content_digest: null,
    render_config_hash: digestOf('config'),
    ...over,
  });

  it('is the migration\'s six edges and no more', () => {
    expect(LIFECYCLE_EDGES).toHaveLength(6);
    expect(LIFECYCLE_EDGES).toEqual([
      ['registered', 'uploading'],
      ['uploading', 'ready'],
      ['uploading', 'failed'],
      ['failed', 'uploading'],
      ['failed', 'invalidated'],
      ['ready', 'invalidated'],
    ]);
    expect(MAX_ATTEMPTS).toBe(5);
  });

  it('carries exactly the columns each legal edge is required to carry', () => {
    expect(patchForTransition({ from: 'registered', to: 'uploading', row: row() }))
      .toEqual({ ok: true, patch: { status: 'uploading' } });
    expect(patchForTransition({ from: 'uploading', to: 'ready', row: row({ status: 'uploading' }), digest: digestOf('bytes') }))
      .toEqual({ ok: true, patch: { status: 'ready', content_digest: digestOf('bytes') } });
    expect(patchForTransition({ from: 'uploading', to: 'failed', row: row({ status: 'uploading' }), reason: 'upload-refused-403' }))
      .toEqual({ ok: true, patch: { status: 'failed', attempt_count: 1, last_error: 'upload-refused-403' } });
    expect(patchForTransition({ from: 'failed', to: 'uploading', row: row({ status: 'failed', attempt_count: 2, last_error: 'x' }) }))
      .toEqual({ ok: true, patch: { status: 'uploading' } });
    // Retiring a proven artefact moves its status and its reason; the digest and `invalidated_at` are
    // the database's (`:361-362`), so a patch that tried to stamp either would be refused here.
    expect(patchForTransition({
      from: 'ready', to: 'invalidated', invalidationReason: 'superseded',
      row: row({ status: 'ready', content_digest: digestOf('bytes') }),
    })).toEqual({ ok: true, patch: { status: 'invalidated', invalidation_reason: 'superseded' } });
  });

  it.each([
    ['registered → ready', 'registered', 'ready'],
    ['registered → failed', 'registered', 'failed'],
    ['ready → failed', 'ready', 'failed'],
    ['ready → uploading', 'ready', 'uploading'],
    ['invalidated → anything', 'invalidated', 'uploading'],
    ['invalidated → registered', 'invalidated', 'registered'],
  ])('sends no %s write, because the guard has no such edge', (_label, from, to) => {
    const outcome = patchForTransition({ from, to, row: row({ status: from, content_digest: digestOf('bytes') }) });
    expect(outcome).toMatchObject({ ok: false, reason: `no-edge-${from}-to-${to}` });
  });

  it('refuses a same-status write before it can move evidence', () => {
    expect(patchForTransition({ from: 'ready', to: 'ready', row: row({ status: 'ready' }), digest: digestOf('bytes') }))
      .toMatchObject({ ok: false, reason: 'same-status-write-may-move-no-evidence' });
    expect(patchForTransition({ from: 'registered', to: 'registered', row: row() }))
      .toMatchObject({ ok: false, reason: 'same-status-write-may-move-no-evidence' });
    expect(patchForTransition({ from: undefined, to: 'ready', row })).toMatchObject({ ok: false, reason: 'transition-status-unreadable' });
  });

  it('will not make a row claim bytes it has not proved', () => {
    expect(patchForTransition({ from: 'uploading', to: 'ready', row: row({ status: 'uploading' }) }))
      .toMatchObject({ ok: false, reason: 'ready-requires-a-sha256-digest' });
    expect(patchForTransition({ from: 'uploading', to: 'ready', row: row({ status: 'uploading' }), digest: 'not-hex' }))
      .toMatchObject({ ok: false, reason: 'ready-requires-a-sha256-digest' });
  });

  it('records exactly one attempt per failure and stops at the ceiling', () => {
    expect(patchForTransition({ from: 'uploading', to: 'failed', row: row({ status: 'uploading', attempt_count: 3 }) }))
      .toMatchObject({ ok: false, reason: 'failure-must-name-its-reason' });
    expect(patchForTransition({ from: 'uploading', to: 'failed', row: row({ status: 'uploading', attempt_count: 4 }), reason: 'boom' }))
      .toMatchObject({ ok: true, patch: { attempt_count: 5 } });
    // A sixth attempt would breach `attempt_count BETWEEN 0 AND 5`, i.e. an UPDATE that aborts after the
    // bytes were already uploaded — so the ceiling refuses the *retry* too, not only the failure.
    expect(patchForTransition({ from: 'uploading', to: 'failed', row: row({ status: 'uploading', attempt_count: 5 }), reason: 'boom' }))
      .toMatchObject({ ok: false, reason: 'retry-ceiling-reached', attempts: 5 });
    expect(patchForTransition({ from: 'failed', to: 'uploading', row: row({ status: 'failed', attempt_count: 5 }) }))
      .toMatchObject({ ok: false, reason: 'retry-ceiling-reached', attempts: 5 });
    expect(patchForTransition({ from: 'failed', to: 'uploading', row: row({ status: 'failed', attempt_count: 4 }) }))
      .toMatchObject({ ok: true });
    expect(patchForTransition({ from: 'uploading', to: 'failed', row: row({ status: 'uploading', attempt_count: null }), reason: 'boom' }))
      .toMatchObject({ ok: false, reason: 'attempt-count-unreadable' });
  });

  it('only retires a row that proved bytes, with a reason the CHECK knows', () => {
    expect(patchForTransition({ from: 'failed', to: 'invalidated', row: row({ status: 'failed', attempt_count: 1 }), invalidationReason: 'superseded' }))
      .toMatchObject({ ok: false, reason: 'invalidation-requires-proven-bytes' });
    expect(patchForTransition({
      from: 'failed', to: 'invalidated', invalidationReason: 'superseded',
      row: row({ status: 'failed', content_digest: digestOf('bytes') }),
    })).toMatchObject({ ok: true });
    expect(patchForTransition({
      from: 'ready', to: 'invalidated', invalidationReason: 'obsolete',
      row: row({ status: 'ready', content_digest: digestOf('bytes') }),
    })).toMatchObject({ ok: false, reason: 'invalidation-reason-unknown' });
    expect(patchForTransition({
      from: 'ready', to: 'invalidated', row: row({ status: 'ready', content_digest: digestOf('bytes') }),
    })).toMatchObject({ ok: false, reason: 'invalidation-reason-unknown' });
  });
});

describe('reconcileSlot', () => {
  const held = (over = {}) => ({
    id: ROW,
    object_key: `outputs/${WEDDING}/og_image/1200x630/${ROW}`,
    status: 'ready',
    content_digest: digestOf('bytes'),
    render_config_hash: digestOf('config'),
    attempt_count: 0,
    ...over,
  });
  const hash = digestOf('config');

  it('publishes an empty slot', () => {
    const plan = reconcileSlot({ rows: [], candidateHash: hash });
    expect(plan).toMatchObject({ action: 'publish', resume: null, reuse: null });
    expect(plan.supersede).toEqual([]);
  });

  it('verifies a ready row instead of uploading over it', () => {
    const row = held();
    expect(reconcileSlot({ rows: [row], candidateHash: hash }))
      .toMatchObject({ action: 'verify', reuse: row });
  });

  it.each(['registered', 'uploading', 'failed'])('resumes an interrupted %s row on its own minted key', (status) => {
    const row = held({ status, attempt_count: status === 'failed' ? 2 : 0 });
    const plan = reconcileSlot({ rows: [row], candidateHash: hash });
    expect(plan).toMatchObject({ action: 'resume', resume: row });
    expect(plan.resume.object_key).toBe(row.object_key);
  });

  it('refuses a tuple held by a retired row rather than deleting the evidence', () => {
    const outcome = reconcileSlot({ rows: [held({ status: 'invalidated', invalidation_reason: 'token_rotated' })], candidateHash: hash });
    expect(outcome).toMatchObject({ action: 'refuse', reason: 'tuple-held-by-an-invalidated-row', row_id: ROW });
  });

  it('refuses an unreadable candidate and an impossible double hold', () => {
    expect(reconcileSlot({ rows: [], candidateHash: 'abc' })).toMatchObject({ action: 'refuse', reason: 'reconcile-candidate-hash-unreadable' });
    expect(reconcileSlot({ rows: [], candidateHash: undefined })).toMatchObject({ action: 'refuse' });
    // Unreachable while the unique index holds; kept because the alternative is silently picking one of
    // two rows that both claim to be the bytes at this slot.
    expect(reconcileSlot({ rows: [held(), held({ id: ROW })], candidateHash: hash }))
      .toMatchObject({ action: 'refuse', reason: 'reconcile-tuple-held-by-two-rows', count: 2 });
  });

  it('sorts the stale occupants of the slot by what may legally be done to each', () => {
    const staleReady = held({ id: '44444444-4444-4444-8444-444444444444', render_config_hash: digestOf('old-config') });
    const staleUploading = held({ id: '55555555-5555-5555-8555-555555555555', status: 'uploading', render_config_hash: digestOf('older') });
    const staleRegistered = held({ id: '66666666-6666-6666-8666-666666666666', status: 'registered', content_digest: null, render_config_hash: digestOf('oldest') });
    const staleFailed = held({ id: '77777777-7777-7777-8777-777777777777', status: 'failed', content_digest: null, attempt_count: 1, render_config_hash: digestOf('quite-old') });
    const staleRetired = held({ id: '88888888-8888-8888-8888-888888888888', status: 'invalidated', render_config_hash: digestOf('ancient') });
    const plan = reconcileSlot({
      rows: [staleReady, staleUploading, staleRegistered, staleFailed, staleRetired, held()],
      candidateHash: hash,
    });
    expect(plan).toMatchObject({ action: 'verify', reuse: held() });
    expect(plan.supersede).toEqual([staleReady]);
    expect(plan.reclaim).toEqual([staleUploading, staleRegistered]);
    expect(plan.orphan_check).toEqual([staleFailed]);
    expect(plan.retired).toEqual([staleRetired]);
  });

  it('names no deletion of a manifest row in any plan', () => {
    const plans = [
      reconcileSlot({ rows: [], candidateHash: hash }),
      reconcileSlot({ rows: [held()], candidateHash: hash }),
      reconcileSlot({ rows: [held({ status: 'failed', content_digest: null })], candidateHash: hash }),
      reconcileSlot({ rows: [held({ status: 'invalidated' })], candidateHash: hash }),
    ];
    for (const plan of plans) {
      expect(JSON.stringify(plan)).not.toMatch(/delete/i);
    }
  });
});

// §12's design table says a token rotation retires a wedding's `qr` rows with reason `token_rotated`, and
// the host's panel has a sentence of its own for that reason (`src/lib/invitationOutputs.ts`
// `reprintWarnings`). The fact that makes a rotation a *new* row rather than a same-hash no-op is that a
// plate's `render_config_hash` covers its `target_url_digest` (`stage9-render-worker.mjs`'s qr
// derivation), so the dead plate lands in `plan.supersede`. Before these cases, `retireStale` named every
// supersession `superseded` — whose client wording is "an older version of this invitation than the one
// now published". For a rotated plate that sentence is wrong about the cause: the paper shows the same
// invitation and points at a dead address. So the classification is a named decision here, and the
// publisher's right answer is to refuse rather than to guess.
describe('classifyRetirement', () => {
  const STALE = digestOf('plate-target-old');
  const CANDIDATE = digestOf('plate-target-new');

  it.each(['og_image', 'share_image', 'pdf'])('calls a stale %s render superseded', (kind) => {
    expect(classifyRetirement({ kind, staleTargetDigest: null, candidateTargetDigest: null }))
      .toBe('superseded');
  });

  it('calls a plate whose encoded address changed a rotation', () => {
    expect(classifyRetirement({ kind: 'qr', staleTargetDigest: STALE, candidateTargetDigest: CANDIDATE }))
      .toBe('token_rotated');
  });

  it('keeps superseded for a plate re-drawn at the same address', () => {
    // The address is the only thing a plate can be stale about that is not a re-render: same target with
    // a different config hash means fonts, geometry or the engine moved, and the printed destination did not.
    expect(classifyRetirement({ kind: 'qr', staleTargetDigest: STALE, candidateTargetDigest: STALE }))
      .toBe('superseded');
  });

  it('refuses to name a reason it cannot prove', () => {
    // A `qr` row always carries a target digest (the migration's `invitation_outputs_qr_target` CHECK), so
    // a missing or malformed one is a broken read. Guessing `superseded` would print the wrong sentence to
    // a host who is about to decide whether their printed plates are dead.
    for (const stale of [undefined, null, '', 'not-a-digest', 'A'.repeat(64)]) {
      expect(classifyRetirement({ kind: 'qr', staleTargetDigest: stale, candidateTargetDigest: CANDIDATE }))
        .toBeNull();
    }
    for (const candidate of [undefined, null, '', 'not-a-digest']) {
      expect(classifyRetirement({ kind: 'qr', staleTargetDigest: STALE, candidateTargetDigest: candidate }))
        .toBeNull();
    }
  });

  it('answers only with the database\'s own reason vocabulary', () => {
    const answers = [
      classifyRetirement({ kind: 'qr', staleTargetDigest: STALE, candidateTargetDigest: CANDIDATE }),
      classifyRetirement({ kind: 'qr', staleTargetDigest: STALE, candidateTargetDigest: STALE }),
      classifyRetirement({ kind: 'pdf', staleTargetDigest: null, candidateTargetDigest: null }),
    ];
    for (const answer of answers) expect(INVALIDATION_REASONS).toContain(answer);
  });
});

describe('verifyReadBack', () => {
  const teaser = pngBytes(1200, 630);

  it('accepts a raster whose header says the box its row claims', () => {
    expect(verifyReadBack({
      bytes: teaser,
      expected: expected({ kind: 'og_image', variant: '1200x630', format: 'png', bytes: teaser }),
      contentType: 'image/png',
    })).toEqual({
      ok: true, content_digest: sha(teaser), size_bytes: teaser.length,
      properties: { ok: true, width: 1200, height: 630 },
    });
  });

  it('accepts a WebP and a PDF, reading the sheet out of the file', () => {
    const story = webpBytes(1080, 1350);
    expect(verifyReadBack({
      bytes: story,
      expected: expected({ kind: 'share_image', variant: '1080x1350', format: 'webp', bytes: story }),
      contentType: 'image/webp',
    })).toMatchObject({ ok: true, properties: { width: 1080, height: 1350 } });

    const sheet = pdfBytes();
    expect(verifyReadBack({
      bytes: sheet,
      expected: expected({ kind: 'pdf', variant: 'a4', format: 'pdf', bytes: sheet }),
      contentType: 'application/pdf',
    })).toMatchObject({
      ok: true,
      content_digest: sha(sheet),
      properties: { page_count: 1, producer: 'Skia/PDF m155', media_box: { widthPt: 595.91998, heightPt: 841.91998 } },
    });
  });

  it('accepts a square plate under its own 1 MiB ceiling', () => {
    const plate = pngBytes(440, 440);
    expect(verifyReadBack({
      bytes: plate,
      expected: expected({ kind: 'qr', variant: '40mm', format: 'png', bytes: plate }),
      contentType: 'image/png',
    })).toMatchObject({ ok: true, properties: { pixels: 440 } });
  });

  it('refuses a body that is not the artefact', () => {
    const good = expected({ kind: 'og_image', variant: '1200x630', format: 'png', bytes: teaser });
    expect(verifyReadBack({ bytes: null, expected: good })).toMatchObject({ ok: false, reason: 'readback-no-buffer' });
    expect(verifyReadBack({ bytes: 'a string', expected: good })).toMatchObject({ reason: 'readback-no-buffer' });
    expect(verifyReadBack({ bytes: Buffer.alloc(0), expected: good })).toMatchObject({ reason: 'readback-empty-object' });
    // One byte short of the record's length: the truncated-upload case, caught before `ready`.
    expect(verifyReadBack({ bytes: teaser.subarray(0, teaser.length - 1), expected: good }))
      .toMatchObject({ ok: false, reason: 'readback-size-mismatch', expected: teaser.length, found: teaser.length - 1 });
    expect(verifyReadBack({ bytes: pngBytes(1200, 631), expected: good }))
      .toMatchObject({ ok: false, reason: 'readback-digest-mismatch' });
    expect(verifyReadBack({ bytes: teaser, expected: { ...good, content_digest: digestOf('other') } }))
      .toMatchObject({ ok: false, reason: 'readback-digest-mismatch' });
    expect(verifyReadBack({ bytes: teaser, expected: { ...good, content_digest: 'short' } }))
      .toMatchObject({ ok: false, reason: 'readback-expected-digest-unreadable' });
  });

  it('refuses a served content type that is not the format', () => {
    expect(verifyReadBack({
      bytes: teaser, expected: expected({ kind: 'og_image', variant: '1200x630', format: 'png', bytes: teaser }),
      contentType: 'text/html',
    })).toMatchObject({ ok: false, reason: 'readback-mime-mismatch', served: 'text/html' });
    // An absent header is not a mismatch: the caller passes what the response carried, and a bucket that
    // served no `Content-Type` is still checked by digest, length and geometry.
    expect(verifyReadBack({
      bytes: teaser, expected: expected({ kind: 'og_image', variant: '1200x630', format: 'png', bytes: teaser }),
    })).toMatchObject({ ok: true });
    expect(verifyReadBack({
      bytes: teaser,
      expected: expected({ kind: 'og_image', variant: '1200x630', format: 'avif', bytes: teaser }),
    })).toMatchObject({ ok: false, reason: 'readback-format-unknown' });
  });

  it('refuses a file whose geometry disagrees with the row', () => {
    const wide = pngBytes(1199, 630);
    expect(verifyReadBack({
      bytes: wide,
      expected: expected({ kind: 'og_image', variant: '1200x630', format: 'png', bytes: wide }),
      contentType: 'image/png',
    })).toMatchObject({ ok: false, reason: 'readback-box-mismatch', expected: '1200x630', found: '1199x630' });

    const plate = pngBytes(440, 420);
    expect(verifyReadBack({
      bytes: plate,
      expected: expected({ kind: 'qr', variant: '40mm', format: 'png', bytes: plate }),
      contentType: 'image/png',
    })).toMatchObject({ ok: false, reason: 'readback-plate-not-square' });

    const letter = pdfBytes('0 0 612 792');
    expect(verifyReadBack({
      bytes: letter,
      expected: expected({ kind: 'pdf', variant: 'a4', format: 'pdf', bytes: letter }),
      contentType: 'application/pdf',
    })).toMatchObject({ ok: false, reason: 'readback-pdf-box-mismatch', expected: '595.91998x841.91998', found: '612x792' });
  });

  it('refuses bytes that are not the format they claim', () => {
    const notAnImage = Buffer.from('%PDF-1.7 something');
    expect(verifyReadBack({
      bytes: notAnImage,
      expected: expected({ kind: 'og_image', variant: '1200x630', format: 'png', bytes: notAnImage }),
    })).toMatchObject({ ok: false, reason: 'readback-image-header-png-signature' });

    const animated = Buffer.concat([
      Buffer.from('RIFF'), Buffer.alloc(4, 1), Buffer.from('WEBP'),
      Buffer.from('ANIM'), Buffer.alloc(4), Buffer.alloc(6),
    ]);
    expect(verifyReadBack({
      bytes: animated,
      expected: expected({ kind: 'share_image', variant: '1080x1350', format: 'webp', bytes: animated }),
    })).toMatchObject({ ok: false, reason: 'readback-image-header-animated-webp' });

    // A PNG whose first chunk is not the header: legal PNG, unreadable as a claim about a box.
    const noIhdr = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(4), Buffer.from('tEXt'), Buffer.alloc(8),
    ]);
    expect(verifyReadBack({
      bytes: noIhdr,
      expected: expected({ kind: 'og_image', variant: '1200x630', format: 'png', bytes: noIhdr }),
    })).toMatchObject({ ok: false, reason: 'readback-image-header-png-ihdr-not-first' });
  });

  it('refuses a PDF whose page tree cannot be read, and a paper with no box', () => {
    const headless = Buffer.from('%PDF-1.7\nno objects here\n%%EOF');
    expect(verifyReadBack({
      bytes: headless,
      expected: expected({ kind: 'pdf', variant: 'a4', format: 'pdf', bytes: headless }),
    })).toMatchObject({ ok: false, reason: 'readback-pdf-page-count-unreadable' });

    const plate = pdfBytes();
    expect(verifyReadBack({
      bytes: plate,
      expected: expected({ kind: 'pdf', variant: '60mm', format: 'pdf', bytes: plate }),
    })).toMatchObject({ ok: false, reason: 'readback-pdf-paper-unknown', variant: '60mm' });
  });

  it('holds a plate to §11.4\'s 1 MiB rather than the 5 MiB a PNG is allowed', () => {
    // The whole point of reading the ceiling off the *kind*: a 3 MiB plate is under the PNG bound and
    // over the printed-code bound, and a stored object that a print shop cannot use is not "ready".
    const fat = pngBytes(440, 440, 1024 * 1024);
    expect(verifyReadBack({
      bytes: fat,
      expected: expected({ kind: 'qr', variant: '40mm', format: 'png', bytes: fat }),
      contentType: 'image/png',
    })).toMatchObject({ ok: false, reason: 'readback-over-ceiling', ceiling: 1024 * 1024 });

    const withinPng = pngBytes(1200, 630, 1024 * 1024);
    expect(verifyReadBack({
      bytes: withinPng,
      expected: expected({ kind: 'og_image', variant: '1200x630', format: 'png', bytes: withinPng }),
      contentType: 'image/png',
    })).toMatchObject({ ok: true, size_bytes: withinPng.length });
  });
});

describe('the emitted SQL', () => {
  it('quotes a literal by doubling, answers NULL for absence, and refuses a NUL', () => {
    expect(sqlText(null)).toBe('NULL');
    expect(sqlText(undefined)).toBe('NULL');
    expect(sqlText("it's")).toBe(`'it''s'`);
    expect(sqlText("a'; DROP TABLE invitation_outputs; --")).toBe(`'a''; DROP TABLE invitation_outputs; --'`);
    expect(sqlText('')).toBe(`''`);
    expect(() => sqlText('a\u0000b')).toThrow(/NUL/);
  });

  it('reads the version through the guest projection, not a second copy of it', () => {
    const sql = sqlReadVersion(VERSION);
    expect(sql).toContain('private.public_invitation_dto(v.snapshot_schema_version, v.snapshot)');
    expect(sql).toContain(`'${VERSION}'::uuid`);
    expect(sql).toContain("encode(convert_to(");
    expect(sql).toMatch(/AS version/);
    // A uuid-shaped value is lower-cased, because the column is `uuid` and a mixed-case literal would
    // still cast — so this is about the report matching what the database echoes back.
    expect(sqlReadVersion(VERSION.toUpperCase())).toContain(`'${VERSION}'::uuid`);
    expect(() => sqlReadVersion('latest')).toThrow(/not a uuid/);
  });

  it('reads a slot at any config hash and withholds nothing the publisher needs', () => {
    const sql = sqlSlotRows({ versionId: VERSION, kind: 'og_image', variant: '1200x630', format: 'png', pageNumber: 2 });
    expect(sql).toContain('FROM public.invitation_outputs o');
    expect(sql).toContain('o.page_number = 2');
    expect(sql).toContain("'1200x630'");
    expect(sql).toContain('o.object_key');
    // The digest, not the address: retiring a plate has to say whether the encoded destination moved, and
    // this is the one read that is allowed to answer. `sqlVersionManifest` — the panel-shaped read — is
    // pinned below to keep withholding it.
    expect(sql).toContain('o.target_url_digest');
    expect(sql).not.toMatch(/target_url(?!_digest)/);
    expect(sql).toMatch(/AS rows/);
    expect(() => sqlSlotRows({ versionId: VERSION, kind: 'poster', variant: 'a4', format: 'png', pageNumber: 1 }))
      .toThrow(/unknown output_kind/);
    expect(() => sqlSlotRows({ versionId: VERSION, kind: 'pdf', variant: '33x33', format: 'png', pageNumber: 1 }))
      .toThrow(/unknown variant/);
    expect(() => sqlSlotRows({ versionId: VERSION, kind: 'pdf', variant: 'a4', format: 'jpg', pageNumber: 1 }))
      .toThrow(/unknown format/);
    expect(() => sqlSlotRows({ versionId: VERSION, kind: 'pdf', variant: 'a4', format: 'pdf', pageNumber: 0 }))
      .toThrow(/page_number must be positive/);
  });

  it('cannot spell the columns the database owns', () => {
    const registration = {
      wedding_id: WEDDING,
      version_id: VERSION,
      output_kind: 'qr',
      variant: '40mm',
      format: 'png',
      page_number: 1,
      render_config_hash: digestOf('config'),
      source_dto_digest: digestOf('dto'),
      target_url_digest: digestOf('target'),
      storage_domain: STORAGE_DOMAIN,
    };
    const sql = sqlInsertRegistration(registration);
    expect(sql).toContain('INSERT INTO public.invitation_outputs');
    // The column list is the registration map, in order, and holds neither of the two columns the
    // database owns. `object_key` does appear later in the statement — in `RETURNING`, which is how the
    // minted key is read back out of the same write — so the assertion is about the *inserted* columns.
    const columns = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map((s) => s.trim());
    expect(columns).toEqual(Object.keys(registration));
    expect(columns).not.toContain('object_key');
    expect(columns).not.toContain('status');
    const values = sql.split('\n').find((line) => line.startsWith('VALUES ('));
    expect(values).toContain(`'${WEDDING}'::uuid`);
    expect(values).toContain(`'${VERSION}'::uuid`);
    expect(values).toContain(`'qr', '40mm', 'png', 1,`);
    expect(values).toContain(`'${digestOf('target')}'`);
    expect(values).toContain(`'${STORAGE_DOMAIN}'`);
    expect(sql).toMatch(/AS inserted/);
    expect(sql).toContain("json_build_object('id', id::text, 'object_key', object_key");
    expect(() => sqlInsertRegistration({ ...registration, object_key: 'x' })).toThrow(/minted by the database/);
    expect(() => sqlInsertRegistration({ ...registration, status: 'ready' })).toThrow(/always registered/);
    expect(() => sqlInsertRegistration({ ...registration, page_number: '1' })).toThrow(/must be positive/);
  });

  it('moves only lifecycle columns, and integers stay integers', () => {
    const sql = sqlTransition(ROW, { status: 'failed', attempt_count: 2, last_error: "upload said 'no' -- \\ drop" });
    expect(sql).toContain('UPDATE public.invitation_outputs');
    expect(sql).toContain("status = 'failed'");
    expect(sql).toContain('attempt_count = 2');
    expect(sql).toContain(`last_error = 'upload said ''no'' -- \\ drop'`);
    expect(sql).toContain(`'${ROW}'::uuid`);
    expect(sql).toMatch(/AS row/);
    expect(() => sqlTransition(ROW, {})).toThrow(/same-status/);
    expect(() => sqlTransition(ROW, { status: 'ready' })).not.toThrow();
    expect(() => sqlTransition(ROW, { object_key: 'someone-elses' })).toThrow(/may only move/);
    expect(() => sqlTransition(ROW, { version_id: VERSION })).toThrow(/may only move/);
    expect(() => sqlTransition(ROW, { attempt_count: 1 })).toThrow(/must move a status/);
    expect(() => sqlTransition(ROW, { status: 'failed', attempt_count: 1.5 })).toThrow(/non-integer/);
    expect(() => sqlTransition('not-a-uuid', { status: 'ready' })).toThrow(/not a uuid/);
  });

  it('answers the panel with the projection the exposed RPC answers with', () => {
    const sql = sqlVersionManifest(VERSION);
    expect(sql).toContain('AS manifest');
    expect(sql).toContain('o.content_digest');
    expect(sql).not.toMatch(/object_key/);
    expect(sql).not.toMatch(/target_url_digest/);
  });

  it('emits no DELETE against the manifest, in any builder', () => {
    const statements = [
      sqlReadVersion(VERSION),
      sqlSlotRows({ versionId: VERSION, kind: 'pdf', variant: 'a4', format: 'pdf', pageNumber: 1 }),
      sqlInsertRegistration({
        wedding_id: WEDDING, version_id: VERSION, output_kind: 'pdf', variant: 'a4', format: 'pdf',
        page_number: 1, render_config_hash: digestOf('config'), source_dto_digest: digestOf('dto'),
        target_url_digest: null, storage_domain: STORAGE_DOMAIN,
      }),
      sqlTransition(ROW, { status: 'invalidated', invalidation_reason: 'superseded' }),
      sqlVersionManifest(VERSION),
    ];
    for (const sql of statements) expect(sql).not.toMatch(/DELETE/i);
  });

  it('keeps the bucket and the domain the migration made', () => {
    expect(OUTPUT_BUCKET).toBe('invitation-outputs');
    expect(STORAGE_DOMAIN).toBe('host_private');
    expect(isHex64(digestOf('x'))).toBe(true);
    expect(isHex64('x'.repeat(64))).toBe(false);
  });
});
