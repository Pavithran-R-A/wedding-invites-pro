// S9-8e: the publisher's *order*, pinned against fakes that record every statement and every byte.
//
// `stage9-publish-core.test.mjs` measures the decisions. This file measures the sequence, because the
// decisions are only safe in the order they are made: `ready` written after a verified read-back is a
// promise, the same write before it is a lie, and a unit test that only checks the final row state
// cannot tell those two runs apart. So every case here drives `runPublish` with injected channels that
// append to one shared timeline as they are called, and then reads that timeline — the statements it
// sent, the bytes it put where, and what it did before it decided to write.
//
// What these tests hold it to:
//
//   * **The promise is the last thing written.** A row reaches `ready` only after an upload that was
//     accepted and a download that verified, and the merged timeline is read to prove that rather than
//     implied by the final state.
//   * **Failure is delete-then-mark.** Every path that ends `failed` removes its object first and then
//     names the reason in `last_error`. Where a removal is refused the run still records the failure it
//     knows — and prints the key, because an orphan the operator can find is a different thing from an
//     orphan nobody names. A *retirement* whose object would not go away marks nothing: a `ready` row
//     whose bytes are still there is telling the truth.
//   * **A second run does not write.** The same render over a `ready` row verifies the stored object
//     against the bytes just drawn and sends no INSERT, no UPDATE and no upload — which is both what
//     makes the tool safe to re-run and the end-to-end instrument for §13's determinism claim.
//   * **A dry run is mechanical.** Not a log line saying "would have": the same sequence handed a
//     channel that throws on a statement that writes, so the SELECTs and downloads it did are real and
//     the first write it withheld is named.
//   * **Nothing that leaves the process carries a credential or a guest's address.** The service key and
//     a plate's target are checked for in every statement, every log line and every byte the run wrote.
//   * **No DELETE reaches the manifest, in any path.** Storage deletion is a fetch; the table is only
//     ever read, inserted into, and updated.
//
// The fake SQL channel is a small state machine that *parses the statement it was sent*. That is on
// purpose: an assertion read out of `status = 'ready'` in the emitted text is evidence about what the
// database would receive, while an assertion about a patch object is only evidence about this file.

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { guestInvitation } from '../src/test/invitationFixture.ts';
import { parseInvitationObject } from '../src/lib/publicInvitation.ts';
import { dtoDigest } from './stage9-render-worker.mjs';
import { OUTPUT_BUCKET } from './stage9-publish-core.mjs';
import {
  decodeLine,
  guardStorageWrites,
  makeRedactor,
  makeSqlChannel,
  makeStorageChannel,
  parseArgs,
  readOptions,
  runPublish,
} from './stage9-output-publisher.mjs';

const WEDDING = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const KEY = 'service-key-that-is-long-enough-to-be-scrubbed-abcdef0123456789';
const PLATE_TARGET = 'https://vivaahvarnam.in/i/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const seed = (text) => createHash('sha256').update(text).digest('hex');
const b64 = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

// The key the fake database mints for the Nth INSERT of a run: `object_key` is the database's to
// invent, so a test that wants to tamper with an object says which row it belongs to by counting.
const mintedKey = (number, kind = 'og_image') =>
  `outputs/${WEDDING}/${kind}/x/99999999-9999-4999-8999-00000000000${number}`;

// ------------------------------------------------------------------ artefact fixtures
/** A PNG that states its own box: signature, 13-byte IHDR with the two dimensions, the five trailing
 *  fields, a placeholder CRC. `imageDimensions` reads only the IHDR, which is the whole point. */
function pngBytes(width, height, extra = 0) {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'ascii');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.from([8, 6, 0, 0, 0]), Buffer.alloc(4), Buffer.alloc(extra)]);
}

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

/** One sheet in the order a producer writes it, with the `/MediaBox` Chromium answers with
 *  (`src/render/outputGeometry.ts` `PDF_MEDIA_BOX_PT`). */
function pdfBytes(box = '0 0 595.91998 841.91998', sheets = 1) {
  const pages = Array.from({ length: sheets }, (_, i) => `${i + 3} 0 obj << /Type /Page /MediaBox [${box}] >> endobj`).join('\n');
  return Buffer.from(`%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [${Array.from({ length: sheets }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${sheets} >> endobj
${pages}
12 0 obj << /Producer (Skia/PDF m155) >> endobj
trailer << /Size 13 /Root 1 0 R /Info 12 0 R >>
startxref
0
%%EOF`, 'utf8');
}

/** The worker's record for one file, in the shape `writeArtefact` returns it (minus `config_inputs`,
 *  which the worker strips before handing artefacts to a caller). `raw` is the only field that is not
 *  the worker's: it is the bytes the fake disk holds at `path`, so a case can hand the publisher real
 *  file contents while still asserting against the lengths and digests the record was built from. */
function artefactOf({ name, bytes, hash }) {
  return {
    ok: true, name, path: `/out/${name}`, bytes: bytes.length,
    content_digest: sha(bytes), render_config_hash: hash, raw: bytes,
  };
}

const DTO = guestInvitation();
const VERSION_DIGEST = dtoDigest(parseInvitationObject(DTO));

const ogPair = (hash = seed('og-config')) => [
  artefactOf({ name: 'og_image_1200x630_p1.png', bytes: pngBytes(1200, 630, 40), hash }),
  artefactOf({ name: 'og_image_1200x630_p1.webp', bytes: webpBytes(1200, 630, 40), hash }),
];
const pdfOf = ({ paper = 'a4', box = '0 0 595.91998 841.91998', hash = seed('pdf-config') } = {}) =>
  artefactOf({ name: `pdf_${paper}_p1.pdf`, bytes: pdfBytes(box), hash });
const plateOf = ({ variant = '40mm', hash = seed('plate-config') } = {}) =>
  artefactOf({ name: `qr_${variant}_p1.png`, bytes: pngBytes(440, 440, 20), hash });

// ------------------------------------------------------------------ the fakes
/** A Postgres-shaped fake: it reads the statement it was handed, keeps one row per primary key, and
 *  answers with the base64 JSON the real emitter asked for. Writes are recorded as the SQL text, so a
 *  test can assert against `status = 'ready'` rather than against a patch object. */
function fakeSql({ slotRows = [], rowsById = {}, timeline = null } = {}) {
  const calls = [];
  const outputs = new Map(Object.entries(rowsById).map(([id, row]) => [id, { ...row }]));
  let minted = 0;
  const sql = (statement) => {
    calls.push(statement);
    timeline?.push({ kind: 'sql', text: statement });
    if (/AS version\b/.test(statement)) {
      return b64({ wedding_id: WEDDING, version_id: VERSION, snapshot_schema_version: 3, dto: DTO });
    }
    if (/AS rows\b/.test(statement)) {
      return b64(slotRows.map((row) => ({ ...row })));
    }
    if (/^INSERT INTO public\.invitation_outputs/m.test(statement)) {
      minted += 1;
      const id = `99999999-9999-4999-8999-00000000000${minted}`;
      const kind = /'([\w_]+)', '[\w.x]+', '(png|webp|pdf)',/.exec(statement)?.[1] ?? 'og_image';
      const objectKey = `outputs/${WEDDING}/${kind}/x/${id}`;
      outputs.set(id, {
        id, status: 'registered', attempt_count: 0, content_digest: null, last_error: null,
        invalidation_reason: null, ready_at: null, object_key: objectKey,
      });
      return b64({ id, object_key: objectKey, status: 'registered', storage_domain: 'host_private' });
    }
    if (/^UPDATE public\.invitation_outputs/m.test(statement)) {
      const id = /WHERE id = '([^']+)'/.exec(statement)[1];
      const row = outputs.get(id);
      if (row === undefined) throw new Error(`the run updated a row the fake never gave it: ${id}`);
      const status = /status = '(\w+)'/.exec(statement);
      if (status !== null) row.status = status[1];
      const digest = /content_digest = '([0-9a-f]{64})'/.exec(statement);
      if (digest !== null) row.content_digest = digest[1];
      const attempts = /attempt_count = (\d+)/.exec(statement);
      if (attempts !== null) row.attempt_count = Number(attempts[1]);
      const error = /last_error = '([^']*)'/.exec(statement);
      if (error !== null) row.last_error = error[1];
      const reason = /invalidation_reason = '(\w+)'/.exec(statement);
      if (reason !== null) row.invalidation_reason = reason[1];
      if (row.status === 'ready') row.ready_at = '2026-10-15T00:00:00Z';
      if (row.status === 'invalidated') row.invalidated_at = '2026-10-15T00:00:00Z';
      return b64({
        id: row.id, status: row.status, content_digest: row.content_digest,
        attempt_count: row.attempt_count, last_error: row.last_error,
        invalidation_reason: row.invalidation_reason, ready_at: row.ready_at,
        invalidated_at: row.invalidated_at ?? null,
      });
    }
    if (/AS manifest\b/.test(statement)) {
      return b64([...outputs.values()].map((row) => ({ ...row, object_key: undefined })));
    }
    throw new Error(`the fake sql channel was sent a statement it does not know: ${statement.slice(0, 60)}`);
  };
  return { sql, calls, outputs };
}

/** A bucket-shaped fake: bytes by key, the served content type is the one the upload claimed, and the
 *  two ways an object can be wrong about itself are named separately — `corrupt` tampers with the bytes
 *  and keeps the type, `wrongType` serves the right bytes under a type the format does not have. */
function fakeStorage({
  objects = {}, refuse = new Set(), failUpload = null, corrupt = new Set(), wrongType = new Set(), timeline = null,
} = {}) {
  const calls = [];
  const store = new Map(Object.entries(objects).map(([key, value]) => [key, value]));
  const note = (op, key) => {
    calls.push({ op, key, bytes: store.get(key)?.bytes?.length ?? null });
    timeline?.push({ kind: 'storage', text: op });
  };
  const tamper = (bytes) => {
    const copy = Buffer.from(bytes);
    copy[copy.length - 1] ^= 0xff;
    return copy;
  };
  return {
    calls,
    store,
    upload: async ({ key, bytes, mime }) => {
      if (failUpload?.verb === 'POST') { note('upload', key); return { ok: false, status: failUpload.status, verb: 'POST' }; }
      if (store.has(key)) { note('upload', key); return { ok: false, status: 409, verb: 'POST' }; }
      store.set(key, { bytes, mime });
      note('upload', key);
      return { ok: true, status: 200, verb: 'POST' };
    },
    upsert: async ({ key, bytes, mime }) => {
      if (failUpload?.verb === 'PUT') { note('upsert', key); return { ok: false, status: failUpload.status, verb: 'PUT' }; }
      store.set(key, { bytes, mime });
      note('upsert', key);
      return { ok: true, status: 200, verb: 'PUT' };
    },
    download: async ({ key }) => {
      const found = store.get(key);
      if (found === undefined) { note('download', key); return { ok: false, status: 404 }; }
      const bytes = corrupt.has(key) ? tamper(found.bytes) : found.bytes;
      const contentType = wrongType.has(key) ? 'text/html' : found.mime;
      note('download', key);
      return { ok: true, status: 200, bytes, contentType };
    },
    remove: async ({ key }) => {
      if (refuse.has(key)) { note('remove', key); return { ok: false, status: 403, absent: false }; }
      const had = store.delete(key);
      note('remove', key);
      return { ok: true, status: 200, absent: !had };
    },
  };
}

/** A worker-shaped fake. `artefacts` is what one call drew, `byPaper` lets a `pdf` call answer per
 *  sheet, and `digest` hands back a DTO digest that may disagree with the version the run read. */
function fakeRender({ kinds = {}, calls = [] } = {}) {
  const method = (kind, name) => async (arg) => {
    calls.push({ kind, name, arg });
    const answer = kinds[kind];
    if (answer === undefined) return { ok: false, reason: 'fake-has-no-such-kind' };
    if (answer.ok === false) return answer;
    const artefacts = answer.byPaper?.[arg.paper] ?? answer.artefacts;
    if (artefacts === undefined) return { ok: false, reason: 'fake-has-no-such-paper' };
    return {
      ok: true,
      kind,
      source_dto_digest: answer.digest ?? (kind === 'qr' ? null : VERSION_DIGEST),
      ...(kind === 'qr' ? { variant: arg.variant, target_url_digest: seed(PLATE_TARGET) } : {}),
      ...(kind === 'pdf' ? { paper: arg.paper } : {}),
      artefacts,
    };
  };
  return {
    renderOgTeaser: method('og_image', 'teaser'),
    renderShareImage: method('share_image', 'share'),
    renderPdf: method('pdf', 'pdf'),
    renderQrPlate: method('qr', 'plate'),
    calls,
  };
}

/** One run of the publisher over fakes, with the artefacts on a virtual disk.
 *
 *  `disk` overrides the bytes at a path — the way a truncated file reaches the real tool is a file
 *  whose contents stopped matching the worker's record, and a case that wants that shape says so here
 *  rather than by rewriting the record it is compared against. */
async function drive({
  artefacts = ogPair(),
  slotRows = [],
  rowsById = {},
  objects = {},
  yes = true,
  kinds = ['og_image'],
  papers = ['a4'],
  qrVariants = [],
  qrTarget = null,
  renderKinds = null,
  missing = new Set(),
  disk = {},
  ...storageOptions
} = {}) {
  const timeline = [];
  const { sql, calls: sqlCalls, outputs } = fakeSql({ slotRows, rowsById, timeline });
  const storage = fakeStorage({ objects, timeline, ...storageOptions });
  const lines = [];
  const raw = artefacts;
  const draw = renderKinds ?? { og_image: { artefacts: raw } };
  const render = fakeRender({ kinds: draw });
  const outcome = await runPublish({
    versionId: VERSION,
    kinds,
    papers,
    qrVariants,
    qrTarget,
    yes,
    log: (line) => lines.push(line),
    channels: {
      sql: makeSqlChannel(sql, yes),
      storage: guardStorageWrites(storage, yes),
      render,
      readArtefact: (path) => {
        if (missing.has(path)) throw new Error('ENOENT: no such file or directory');
        if (disk[path] !== undefined) return disk[path];
        const found = raw.find((artefact) => artefact.path === path);
        if (found === undefined) throw new Error(`the fake disk was asked for ${path}, which it never held`);
        return found.raw;
      },
    },
  });
  return {
    outcome, lines, render, timeline, outputs, storage,
    sqlCalls,
    statements: sqlCalls.join('\n'),
    writes: sqlCalls.filter((statement) => /^\s*(INSERT|UPDATE)/i.test(statement)),
    statuses: [...outputs.values()].map((row) => row.status),
  };
}

const readyWrite = (writes) => writes.filter((statement) => /status = 'ready'/.test(statement));
const failedWrite = (writes) => writes.filter((statement) => /status = 'failed'/.test(statement));
const invalidatedWrite = (writes) => writes.filter((statement) => /status = 'invalidated'/.test(statement));
const firstIndexOf = (timeline, kind, test) => timeline.findIndex((entry) => entry.kind === kind && test(entry.text));
const reasons = (outcome) => outcome.findings.map((finding) => finding.reason);
/** The columns a statement actually moves. Every emitter ends with a `RETURNING` that names the whole
 *  lifecycle, so an assertion about "this write did not touch that column" has to read the SET half. */
const setClause = (statement) => /SET([\s\S]*?)\n\s*WHERE/.exec(statement)?.[1] ?? statement;

// ------------------------------------------------------------------ the happy path
describe('a first publish of the two teaser files', () => {
  it('registers, uploads, reads back and only then writes ready', async () => {
    const run = await drive();
    expect(run.outcome.ok).toBe(true);
    expect(run.outcome.results).toHaveLength(2);
    expect(run.outcome.results.map((result) => result.status)).toEqual(['ready', 'ready']);
    expect(run.outcome.results.map((result) => result.action)).toEqual(['publish', 'publish']);

    expect(run.storage.calls.map((call) => call.op)).toEqual(['upload', 'download', 'upload', 'download']);
    const order = run.sqlCalls.map((statement) => (/AS version\b/.test(statement) ? 'read-version'
      : /AS rows/.test(statement) ? 'read-slot'
        : /^INSERT/.test(statement) ? 'insert'
          : /^UPDATE/.test(statement)
            ? /status = 'uploading'/.test(statement) ? 'to-uploading'
              : /status = 'ready'/.test(statement) ? 'to-ready' : 'other-update'
            : /AS manifest/.test(statement) ? 'read-manifest' : 'other'));
    expect(order).toEqual(['read-version', 'read-slot', 'insert', 'to-uploading', 'to-ready',
      'read-slot', 'insert', 'to-uploading', 'to-ready', 'read-manifest']);
    // both files of the pair are registered under the one render
    expect(run.render.calls.map((call) => call.name)).toEqual(['teaser']);
  });

  it('sends the upload before the ready write, read off one merged timeline', async () => {
    const run = await drive();
    const firstUpload = firstIndexOf(run.timeline, 'storage', (text) => text === 'upload');
    const firstDownload = firstIndexOf(run.timeline, 'storage', (text) => text === 'download');
    const firstReady = firstIndexOf(run.timeline, 'sql', (text) => /status = 'ready'/.test(text));
    expect(firstUpload).toBeGreaterThanOrEqual(0);
    expect(firstDownload).toBeGreaterThan(firstUpload);
    expect(firstReady).toBeGreaterThan(firstDownload);
    // and nothing at all is written for the first file before its own slot was read
    expect(firstIndexOf(run.timeline, 'sql', (text) => /^INSERT/.test(text)))
      .toBeGreaterThan(firstIndexOf(run.timeline, 'sql', (text) => /AS rows/.test(text)));
  });

  it('names the row with the digest of the bytes it read back out of the bucket', async () => {
    const artefacts = ogPair();
    const run = await drive({ artefacts });
    expect(run.statements).toContain(`content_digest = '${artefacts[0].content_digest}'`);
    expect(run.outcome.results[0].content_digest).toBe(artefacts[0].content_digest);
    expect(run.outcome.results[0].properties).toEqual({ ok: true, width: 1200, height: 630 });
    expect(run.outcome.results[0].size_bytes).toBe(artefacts[0].bytes);
    expect(run.outputs.get(run.outcome.results[0].row_id).content_digest).toBe(artefacts[0].content_digest);
  });

  it('asks the bucket for the mime each format is stored under', async () => {
    const run = await drive();
    expect(run.storage.calls.filter((call) => call.op === 'upload').map((call) => call.key))
      .toEqual([mintedKey(1), mintedKey(2)]);
    expect(run.outcome.results.map((result) => result.format)).toEqual(['png', 'webp']);
  });

  it('never sends a DELETE against the manifest, whatever it drew', async () => {
    const run = await drive({
      kinds: ['og_image', 'pdf'],
      artefacts: [...ogPair(), pdfOf()],
      renderKinds: { og_image: { artefacts: [ogPair()[0]] }, pdf: { artefacts: [pdfOf()] } },
    });
    expect(run.statements).not.toMatch(/DELETE/i);
    expect(run.outcome.results.map((result) => result.kind)).toEqual(['og_image', 'pdf']);
  });

  it('reads the manifest back without a key, a URL or a target digest', async () => {
    const run = await drive();
    const last = run.sqlCalls.at(-1);
    expect(last).toMatch(/AS manifest/);
    expect(last).not.toMatch(/object_key/);
    expect(last).not.toMatch(/target_url_digest/);
  });

  it('draws one pdf row per sheet it was asked for', async () => {
    const a4 = pdfOf();
    const letter = pdfOf({ paper: 'letter', box: '0 0 612 792', hash: seed('letter-config') });
    const run = await drive({
      kinds: ['pdf'],
      papers: ['a4', 'letter'],
      artefacts: [a4, letter],
      renderKinds: { pdf: { byPaper: { a4: [a4], letter: [letter] } } },
    });
    expect(run.render.calls.map((call) => call.arg.paper)).toEqual(['a4', 'letter']);
    expect(run.outcome.results.map((result) => result.variant)).toEqual(['a4', 'letter']);
    expect(run.statements).toContain(`'pdf', 'a4', 'pdf', 1,`);
    expect(run.statements).toContain(`'pdf', 'letter', 'pdf', 1,`);
  });
});

// ------------------------------------------------------------------ the second run
describe('a run over work that is already delivered', () => {
  const readyArtefacts = ogPair();
  const id = '33333333-3333-4333-8333-333333333333';
  const key = `outputs/${WEDDING}/og_image/1200x630/${id}`;
  const readyRow = (over = {}) => ({
    id, object_key: key, status: 'ready', content_digest: readyArtefacts[0].content_digest,
    render_config_hash: readyArtefacts[0].render_config_hash, attempt_count: 0, last_error: null,
    invalidation_reason: null, ready_at: '2026-10-14T00:00:00Z', created_at: '2026-10-14T00:00:00Z',
    ...over,
  });

  it('verifies a ready row in place and writes nothing at all', async () => {
    const ready = readyRow();
    const run = await drive({
      artefacts: [readyArtefacts[0]],
      slotRows: [ready],
      rowsById: { [id]: ready },
      objects: { [key]: { bytes: readyArtefacts[0].raw, mime: 'image/png' } },
    });
    expect(run.outcome.results).toEqual([
      { name: 'og_image_1200x630_p1.png', kind: 'og_image', variant: '1200x630', format: 'png', page: 1,
        action: 'verify', row_id: id, status: 'ready', content_digest: readyArtefacts[0].content_digest,
        size_bytes: 73, properties: { ok: true, width: 1200, height: 630 } },
    ]);
    expect(run.writes).toHaveLength(0);
    expect(run.storage.calls.map((call) => call.op)).toEqual(['download']);
    expect(run.outcome.findings.filter((finding) => finding.level !== 'note')).toHaveLength(0);
    expect(reasons(run.outcome)).toContain('ready-object-verified');
    expect(run.outcome.ok).toBe(true);
  });

  it('refuses when the stored object is not the bytes this build draws, and changes nothing', async () => {
    const ready = readyRow();
    const run = await drive({
      artefacts: [readyArtefacts[0]],
      slotRows: [ready],
      rowsById: { [id]: ready },
      objects: { [key]: { bytes: pngBytes(1200, 630, 44), mime: 'image/png' } },
    });
    expect(reasons(run.outcome)).toContain('ready-object-differs-readback-size-mismatch');
    expect(run.writes).toHaveLength(0);
    expect(run.outcome.ok).toBe(false);
    expect(run.outputs.get(id).status).toBe('ready');
  });

  it('refuses an object whose bytes were changed inside the bucket', async () => {
    const ready = readyRow();
    const run = await drive({
      artefacts: [readyArtefacts[0]],
      slotRows: [ready],
      rowsById: { [id]: ready },
      objects: { [key]: { bytes: readyArtefacts[0].raw, mime: 'image/png' } },
      corrupt: new Set([key]),
    });
    expect(reasons(run.outcome)).toContain('ready-object-differs-readback-digest-mismatch');
    expect(run.writes).toHaveLength(0);
  });

  it('refuses a ready row that carries no object key to read', async () => {
    const ready = readyRow({ object_key: '' });
    const run = await drive({
      artefacts: [readyArtefacts[0]], slotRows: [ready], rowsById: { [id]: ready },
    });
    expect(reasons(run.outcome)).toContain('ready-row-carries-no-key');
    expect(run.storage.calls).toHaveLength(0);
  });

  it('reports a ready row whose object has gone away', async () => {
    const ready = readyRow();
    const run = await drive({ artefacts: [readyArtefacts[0]], slotRows: [ready], rowsById: { [id]: ready }, objects: {} });
    expect(reasons(run.outcome)).toContain('ready-object-cannot-be-read');
    expect(run.outcome.ok).toBe(false);
  });
});

// ------------------------------------------------------------------ crash and resume
describe('a row a previous run left behind', () => {
  const leftover = (over = {}) => ({
    id: '44444444-4444-4444-8444-444444444444',
    object_key: `outputs/${WEDDING}/og_image/1200x630/44444444-4444-4444-8444-444444444444`,
    status: 'uploading', content_digest: null, render_config_hash: seed('og-config'),
    attempt_count: 0, last_error: null, invalidation_reason: null, ready_at: null, created_at: null,
    ...over,
  });

  it('continues an uploading row with the verb that overwrites, and does not re-open it', async () => {
    const artefacts = ogPair();
    const row = leftover({ render_config_hash: artefacts[0].render_config_hash });
    const run = await drive({ artefacts: [artefacts[0]], slotRows: [row], rowsById: { [row.id]: row } });
    expect(run.outcome.results[0].action).toBe('resume');
    expect(run.sqlCalls.filter((statement) => /status = 'uploading'/.test(statement))).toHaveLength(0);
    expect(run.storage.calls.map((call) => call.op)).toEqual(['upsert', 'download']);
    expect(run.storage.calls[0].key).toBe(row.object_key);
    expect(run.writes.at(-1)).toMatch(/status = 'ready'/);
  });

  it('retries a failed row, and only its own attempt count moves', async () => {
    const artefacts = ogPair();
    const row = leftover({ status: 'failed', attempt_count: 2, last_error: 'upload-POST-refused-500', render_config_hash: artefacts[0].render_config_hash });
    const run = await drive({ artefacts: [artefacts[0]], slotRows: [row], rowsById: { [row.id]: row } });
    // Opening a retry is a claim about intent, not a new attempt: the attempt only moves when a run
    // *finishes* as failed. The `RETURNING` clause names `attempt_count` on every statement, so this
    // reads the SET half of it and nothing else.
    expect(run.writes[0]).toMatch(/status = 'uploading'/);
    expect(setClause(run.writes[0])).not.toMatch(/attempt_count/);
    expect(run.outputs.get(row.id).attempt_count).toBe(2);
    expect(run.outcome.ok).toBe(true);
  });

  it('refuses to retry past the ceiling and uploads nothing', async () => {
    const artefacts = ogPair();
    const row = leftover({ status: 'failed', attempt_count: 5, render_config_hash: artefacts[0].render_config_hash });
    const run = await drive({ artefacts: [artefacts[0]], slotRows: [row], rowsById: { [row.id]: row } });
    expect(reasons(run.outcome)).toContain('cannot-open-upload-retry-ceiling-reached');
    expect(run.storage.calls).toHaveLength(0);
    expect(run.writes).toHaveLength(0);
  });

  it('refuses a slot held by an invalidated row instead of re-issuing it', async () => {
    const artefacts = ogPair();
    const row = leftover({ status: 'invalidated', invalidation_reason: 'superseded', content_digest: artefacts[0].content_digest, render_config_hash: artefacts[0].render_config_hash });
    const run = await drive({ artefacts: [artefacts[0]], slotRows: [row], rowsById: { [row.id]: row } });
    expect(reasons(run.outcome)).toContain('tuple-held-by-an-invalidated-row');
    expect(run.writes).toHaveLength(0);
  });

  it('refuses a tuple two rows claim', async () => {
    const artefacts = ogPair();
    const a = leftover({ render_config_hash: artefacts[0].render_config_hash });
    const b = { ...a, id: '55555555-5555-4555-8555-555555555555' };
    const run = await drive({ artefacts: [artefacts[0]], slotRows: [a, b], rowsById: { [a.id]: a, [b.id]: b } });
    expect(reasons(run.outcome)).toContain('reconcile-tuple-held-by-two-rows');
    expect(run.writes).toHaveLength(0);
  });

  it('refuses a row to resume that has no key behind it', async () => {
    const artefacts = ogPair();
    const row = leftover({ object_key: '', render_config_hash: artefacts[0].render_config_hash });
    const run = await drive({ artefacts: [artefacts[0]], slotRows: [row], rowsById: { [row.id]: row } });
    expect(reasons(run.outcome)).toContain('resume-row-carries-no-key');
    expect(run.storage.calls).toHaveLength(0);
    expect(run.writes).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ failure paths
describe('a publish that does not finish', () => {
  it('removes the object before it records the failure', async () => {
    const artefacts = ogPair();
    const run = await drive({ artefacts: [artefacts[0]], failUpload: { verb: 'POST', status: 500 } });
    expect(run.storage.calls.map((call) => call.op)).toEqual(['upload', 'remove']);
    expect(firstIndexOf(run.timeline, 'storage', (text) => text === 'remove'))
      .toBeLessThan(firstIndexOf(run.timeline, 'sql', (text) => /status = 'failed'/.test(text)));
    expect(run.writes.at(-1)).toMatch(/status = 'failed'/);
    expect(run.writes.at(-1)).toMatch(/last_error = 'upload-POST-refused-500'/);
    expect(run.writes.at(-1)).toMatch(/attempt_count = 1/);
    expect(readyWrite(run.writes)).toHaveLength(0);
    expect(reasons(run.outcome)).toContain('artefact-failed');
    expect(run.outcome.ok).toBe(false);
  });

  it('names the cause separately from the finding it belongs to', async () => {
    const artefacts = ogPair();
    const run = await drive({ artefacts: [artefacts[0]], failUpload: { verb: 'POST', status: 500 } });
    const failure = run.outcome.findings.find((finding) => finding.reason === 'artefact-failed');
    expect(failure).toMatchObject({ level: 'failure', failed_because: 'upload-POST-refused-500', attempts: 1 });
  });

  it('marks the failure when the object read back is not the bytes it sent', async () => {
    const artefacts = ogPair();
    const key = mintedKey(1);
    const run = await drive({ artefacts: [artefacts[0]], corrupt: new Set([key]) });
    expect(readyWrite(run.writes)).toHaveLength(0);
    expect(run.writes.at(-1)).toMatch(/last_error = 'readback-digest-mismatch'/);
    expect(failedWrite(run.writes)).toHaveLength(1);
    // the object that could not be verified does not stay behind
    expect(run.storage.store.has(key)).toBe(false);
    expect(run.outcome.ok).toBe(false);
  });

  it('marks the failure when the bucket serves the wrong kind of file', async () => {
    const artefacts = ogPair();
    const key = mintedKey(1);
    const run = await drive({ artefacts: [artefacts[0]], wrongType: new Set([key]) });
    expect(run.writes.at(-1)).toMatch(/last_error = 'readback-mime-mismatch'/);
    expect(reasons(run.outcome)).toContain('artefact-failed');
  });

  it('names an object its own refusal left behind, and still records the failure', async () => {
    const artefacts = ogPair();
    const key = mintedKey(1);
    const id = key.slice(-36);
    const run = await drive({ artefacts: [artefacts[0]], refuse: new Set([key]), failUpload: { verb: 'POST', status: 500 } });
    const note = run.outcome.findings.find((finding) => finding.reason === 'orphan-object-remains');
    expect(note).toMatchObject({ level: 'note', row_id: id, object_key: key, status: 403 });
    expect(failedWrite(run.writes)).toHaveLength(1);
    expect(run.writes.at(-1)).toMatch(/last_error = 'upload-POST-refused-500'/);
    expect(run.outputs.get(id).last_error).toBe('upload-POST-refused-500');
    expect(run.outcome.ok).toBe(false);
  });

  it('fails an artefact whose file never reached the disk, without registering it', async () => {
    const artefacts = ogPair();
    const run = await drive({ artefacts, missing: new Set([artefacts[0].path]) });
    expect(reasons(run.outcome)).toContain('artefact-file-missing');
    // the missing file cost no slot read and no INSERT of its own
    expect(run.sqlCalls.filter((statement) => /AS rows/.test(statement))).toHaveLength(1);
    expect(run.writes.filter((statement) => /^INSERT/.test(statement))).toHaveLength(1);
    expect(run.statements).toContain(`'og_image', '1200x630', 'webp', 1,`);
    expect(run.outcome.results.map((result) => result.format)).toEqual(['webp']);
  });

  it('refuses a file shorter than the record claims, before the slot is even read', async () => {
    const artefacts = ogPair();
    const run = await drive({
      artefacts: [artefacts[0]],
      disk: { [artefacts[0].path]: pngBytes(1200, 630, 8) },
    });
    expect(reasons(run.outcome)).toContain('local-readback-size-mismatch');
    expect(run.sqlCalls.filter((statement) => /AS rows/.test(statement))).toHaveLength(0);
    expect(run.writes).toHaveLength(0);
    expect(run.storage.calls).toHaveLength(0);
  });

  it('refuses a local file whose bytes were tampered with, at the same length', async () => {
    const artefacts = ogPair();
    const tampered = Buffer.from(artefacts[0].raw);
    tampered[tampered.length - 1] ^= 0xff;
    const run = await drive({ artefacts: [artefacts[0]], disk: { [artefacts[0].path]: tampered } });
    expect(reasons(run.outcome)).toContain('local-readback-digest-mismatch');
    expect(run.writes).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ stale rows
describe('a slot holding a stale render of the same box', () => {
  const staleReady = (hash) => ({
    id: '66666666-6666-4666-8666-666666666666',
    object_key: `outputs/${WEDDING}/og_image/1200x630/66666666-6666-4666-8666-666666666666`,
    status: 'ready', content_digest: seed('old-bytes'), render_config_hash: hash,
    attempt_count: 0, last_error: null, invalidation_reason: null, ready_at: null, created_at: null,
  });

  it('removes the stale object, marks the stale row superseded, then publishes', async () => {
    const artefacts = ogPair();
    const old = staleReady(seed('different-config'));
    const run = await drive({
      artefacts: [artefacts[0]],
      slotRows: [old],
      rowsById: { [old.id]: old },
      objects: { [old.object_key]: { bytes: pngBytes(1200, 630, 4), mime: 'image/png' } },
    });
    expect(firstIndexOf(run.timeline, 'storage', (text) => text === 'remove'))
      .toBeLessThan(firstIndexOf(run.timeline, 'sql', (text) => /status = 'invalidated'/.test(text)));
    expect(run.writes[0]).toMatch(/status = 'invalidated'/);
    expect(run.writes[0]).toMatch(/invalidation_reason = 'superseded'/);
    expect(run.writes[1]).toMatch(/^INSERT/);
    expect(run.outputs.get(old.id).status).toBe('invalidated');
    expect(run.outcome.results[0].status).toBe('ready');
  });

  it('leaves a stale ready row ready when its object would not go away', async () => {
    const artefacts = ogPair();
    const old = staleReady(seed('different-config'));
    const run = await drive({
      artefacts: [artefacts[0]],
      slotRows: [old],
      rowsById: { [old.id]: old },
      objects: { [old.object_key]: { bytes: pngBytes(1200, 630, 4), mime: 'image/png' } },
      refuse: new Set([old.object_key]),
    });
    const note = run.outcome.findings.find((finding) => finding.reason === 'retirement-refused-object-present');
    expect(note).toMatchObject({ level: 'note', row_id: old.id, object_key: old.object_key });
    expect(invalidatedWrite(run.writes)).toHaveLength(0);
    expect(run.outputs.get(old.id).status).toBe('ready');
    // the new artefact is unaffected by the row it could not retire
    expect(run.outcome.results[0].status).toBe('ready');
  });

  it('steps a stale registered row through uploading before failing it', async () => {
    const artefacts = ogPair();
    const old = { ...staleReady(seed('other')), status: 'registered', content_digest: null };
    const run = await drive({ artefacts: [artefacts[0]], slotRows: [old], rowsById: { [old.id]: old } });
    const about = run.writes.filter((statement) => statement.includes(old.id));
    expect(about).toHaveLength(2);
    expect(about[0]).toMatch(/status = 'uploading'/);
    expect(about[1]).toMatch(/status = 'failed'/);
    expect(about[1]).toMatch(/last_error = 'stale-slot-reclaimed'/);
    expect(failedWrite(run.writes)).toHaveLength(1);
  });

  it('keeps a stale registered row registered when its object would not go away', async () => {
    const artefacts = ogPair();
    const old = { ...staleReady(seed('other')), status: 'registered', content_digest: null };
    const run = await drive({
      artefacts: [artefacts[0]],
      slotRows: [old],
      rowsById: { [old.id]: old },
      objects: { [old.object_key]: { bytes: pngBytes(1200, 630, 4), mime: 'image/png' } },
      refuse: new Set([old.object_key]),
    });
    expect(reasons(run.outcome)).toContain('reclaim-refused-object-present');
    expect(run.writes.filter((statement) => statement.includes(old.id))).toHaveLength(0);
    expect(run.outputs.get(old.id).status).toBe('registered');
  });

  it('keeps a failed stale row and only takes its object', async () => {
    const artefacts = ogPair();
    const old = { ...staleReady(seed('other')), status: 'failed', attempt_count: 1 };
    const run = await drive({
      artefacts: [artefacts[0]],
      slotRows: [old],
      rowsById: { [old.id]: old },
      objects: { [old.object_key]: { bytes: pngBytes(1200, 630, 4), mime: 'image/png' } },
    });
    expect(run.storage.calls[0]).toMatchObject({ op: 'remove', key: old.object_key });
    expect(run.writes.filter((statement) => statement.includes(old.id))).toHaveLength(0);
    expect(run.outputs.get(old.id).status).toBe('failed');
  });

  it('names an orphan it cannot take and marks nothing', async () => {
    const artefacts = ogPair();
    const old = { ...staleReady(seed('other')), status: 'failed', attempt_count: 1 };
    const run = await drive({
      artefacts: [artefacts[0]],
      slotRows: [old],
      rowsById: { [old.id]: old },
      objects: { [old.object_key]: { bytes: pngBytes(1200, 630, 4), mime: 'image/png' } },
      refuse: new Set([old.object_key]),
    });
    const note = run.outcome.findings.find((finding) => finding.reason === 'orphan-object-remains');
    expect(note).toMatchObject({ level: 'note', row_id: old.id, object_key: old.object_key });
    expect(run.writes.filter((statement) => statement.includes(old.id))).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ dry run
describe('a run without --yes', () => {
  it('reads everything it can and withholds the first statement that writes', async () => {
    const run = await drive({ yes: false });
    expect(run.outcome.dryRun).toBe(true);
    expect(run.outcome.ok).toBe(true);
    expect(run.outcome.results).toHaveLength(0);
    expect(run.writes).toHaveLength(0);
    expect(run.storage.calls).toHaveLength(0);
    const withheld = run.outcome.findings.find((finding) => finding.reason === 'write-withheld-by-dry-run');
    expect(withheld).toMatchObject({ level: 'note', name: 'og_image_1200x630_p1.png' });
    expect(withheld.detail).toContain('insert');
    // the read-only half of the sequence really ran
    expect(run.sqlCalls[0]).toMatch(/AS version\b/);
    expect(run.sqlCalls[1]).toMatch(/AS rows/);
    expect(run.sqlCalls.at(-1)).toMatch(/AS manifest/);
  });

  it('still verifies a ready object, because a download cannot change one', async () => {
    const artefacts = ogPair();
    const id = '33333333-3333-4333-8333-333333333333';
    const key = `outputs/${WEDDING}/og_image/1200x630/${id}`;
    const ready = {
      id, object_key: key, status: 'ready', content_digest: artefacts[0].content_digest,
      render_config_hash: artefacts[0].render_config_hash, attempt_count: 0, last_error: null,
      invalidation_reason: null, ready_at: null, created_at: null,
    };
    const run = await drive({
      yes: false,
      artefacts: [artefacts[0]],
      slotRows: [ready],
      rowsById: { [id]: ready },
      objects: { [key]: { bytes: artefacts[0].raw, mime: 'image/png' } },
    });
    expect(run.storage.calls.map((call) => call.op)).toEqual(['download']);
    expect(run.outcome.results[0].status).toBe('ready');
    expect(run.writes).toHaveLength(0);
  });

  it('draws and checks the bytes even when nothing may be written', async () => {
    const artefacts = ogPair();
    const run = await drive({ yes: false, artefacts: [artefacts[0]], disk: { [artefacts[0].path]: pngBytes(1200, 630, 9) } });
    expect(reasons(run.outcome)).toContain('local-readback-size-mismatch');
    expect(run.outcome.ok).toBe(false);
    expect(run.writes).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ the documents
describe('the version and its document', () => {
  it('refuses a version id that reads back as nothing, before drawing', async () => {
    const run = await driveWithVersion(null);
    expect(reasons(run.outcome)).toContain('version-not-found');
    expect(run.renderCalls).toHaveLength(0);
    expect(run.sqlCalls).toHaveLength(1);
    expect(run.outcome.ok).toBe(false);
  });

  it('refuses a document the guest parser would not show', async () => {
    const run = await driveWithVersion({ wedding_id: WEDDING, dto: { title: 'not a document' } });
    expect(reasons(run.outcome)).toContain('invitation-refused');
    expect(run.renderCalls).toHaveLength(0);
  });

  it('refuses a render that claims a different document than the row it read', async () => {
    const artefacts = ogPair();
    const run = await drive({
      artefacts: [artefacts[0]],
      renderKinds: { og_image: { artefacts: [artefacts[0]], digest: seed('some-other-document') } },
    });
    expect(reasons(run.outcome)).toContain('dto-digest-disagreement');
    expect(run.writes).toHaveLength(0);
    expect(run.storage.calls).toHaveLength(0);
  });

  it('reports a render refusal with the worker reason kept beside it', async () => {
    const artefacts = ogPair();
    const run = await drive({
      artefacts,
      kinds: ['og_image', 'share_image'],
      renderKinds: { og_image: { artefacts: [artefacts[0]] }, share_image: { ok: false, reason: 'unbreakable-content' } },
    });
    const failure = run.outcome.findings.find((finding) => finding.level === 'failure');
    expect(failure).toMatchObject({ level: 'failure', reason: 'render-refused', kind: 'share_image', render_reason: 'unbreakable-content' });
    expect(run.outcome.results).toHaveLength(1);
    expect(run.outcome.ok).toBe(false);
    expect(run.lines.join('\n')).toContain('FAILURE render-refused');
    expect(run.lines.join('\n')).toContain('kind=share_image');
  });
});

async function driveWithVersion(version) {
  const sqlCalls = [];
  const renderCalls = [];
  const artefacts = ogPair();
  const outcome = await runPublish({
    versionId: VERSION,
    kinds: ['og_image'],
    yes: true,
    log: () => {},
    channels: {
      sql: (statement) => {
        sqlCalls.push(statement);
        if (/AS version/.test(statement)) return version === null ? '' : b64(version);
        if (/AS rows/.test(statement)) return b64([]);
        if (/AS manifest/.test(statement)) return b64([]);
        throw new Error('unexpected statement');
      },
      storage: fakeStorage({}),
      render: {
        renderOgTeaser: async () => { renderCalls.push('og'); return { ok: true, kind: 'og_image', source_dto_digest: VERSION_DIGEST, artefacts }; },
        renderShareImage: async () => ({ ok: false, reason: 'unused' }),
        renderPdf: async () => ({ ok: false, reason: 'unused' }),
        renderQrPlate: async () => ({ ok: false, reason: 'unused' }),
      },
      readArtefact: (path) => artefacts.find((artefact) => artefact.path === path).raw,
    },
  });
  return { outcome, sqlCalls, renderCalls };
}

// ------------------------------------------------------------------ the plate
describe('a QR plate', () => {
  const plateRun = () => {
    const artefacts = [plateOf()];
    return drive({ artefacts, kinds: ['qr'], qrVariants: ['40mm'], qrTarget: PLATE_TARGET, renderKinds: { qr: { artefacts } } });
  };

  it('registers the version digest and the target digest, and never the address', async () => {
    const run = await plateRun();
    expect(run.outcome.ok).toBe(true);
    expect(run.statements).toContain(`'qr', '40mm', 'png', 1,`);
    expect(run.statements).toContain(seed(PLATE_TARGET));
    expect(run.statements).toContain(VERSION_DIGEST);
    expect(run.outcome.results[0].properties).toEqual({ pixels: 440 });
    expect(run.statements).not.toContain('vivaahvarnam.in');
    expect(run.lines.join('\n')).not.toContain('vivaahvarnam.in');
  });

  it('holds the plate target out of every statement and every log line', async () => {
    const run = await plateRun();
    for (const statement of run.sqlCalls) expect(statement).not.toContain(PLATE_TARGET);
    expect(run.lines.join('\n')).not.toContain(PLATE_TARGET);
    for (const call of run.storage.calls) expect(JSON.stringify(call)).not.toContain(PLATE_TARGET);
  });

  it('refuses a plate whose render answered without a target digest', async () => {
    // `invitation_outputs_qr_target` makes the pair one fact, so a plate row with no target digest is a
    // registration that cannot be planned — and the refusal has to arrive before an INSERT does.
    const artefacts = [plateOf()];
    const { sql, calls: sqlCalls } = fakeSql({});
    const outcome = await runPublish({
      versionId: VERSION, kinds: ['qr'], qrVariants: ['40mm'], qrTarget: PLATE_TARGET, yes: true, log: () => {},
      channels: {
        sql, storage: fakeStorage({}),
        render: { renderQrPlate: async () => ({ ok: true, kind: 'qr', source_dto_digest: null, artefacts }) },
        readArtefact: (path) => artefacts.find((artefact) => artefact.path === path).raw,
      },
    });
    expect(reasons(outcome)).toContain('registration-qr-needs-target-url-digest');
    expect(sqlCalls.filter((statement) => /^INSERT/.test(statement))).toHaveLength(0);
  });

  it('holds a plate to its own byte ceiling', async () => {
    const big = artefactOf({ name: 'qr_40mm_p1.png', bytes: pngBytes(440, 440, 1024 * 1024), hash: seed('plate-config') });
    const run = await drive({ artefacts: [big], kinds: ['qr'], qrVariants: ['40mm'], qrTarget: PLATE_TARGET, renderKinds: { qr: { artefacts: [big] } } });
    expect(reasons(run.outcome)).toContain('local-readback-over-ceiling');
    expect(run.writes).toHaveLength(0);
  });

  it('refuses a plate that is not square', async () => {
    // A plate is square by construction, so a stored object that is not one is either the wrong file or
    // a truncated one. Either way `ready` is the last thing it should be offered.
    const flat = artefactOf({ name: 'qr_40mm_p1.png', bytes: pngBytes(440, 400, 20), hash: seed('plate-config') });
    const run = await drive({ artefacts: [flat], kinds: ['qr'], qrVariants: ['40mm'], qrTarget: PLATE_TARGET, renderKinds: { qr: { artefacts: [flat] } } });
    expect(reasons(run.outcome)).toContain('local-readback-plate-not-square');
    expect(run.writes).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ the surface
describe('the command line', () => {
  const base = ['--version', VERSION, '--via-docker', 'supabase_db_localvivaahvarnam'];

  it('takes the three document kinds by default and no plate', () => {
    const opts = readOptions(parseArgs(base), {});
    expect(opts.kinds).toEqual(['og_image', 'share_image', 'pdf']);
    expect(opts.papers).toEqual(['a4']);
    expect(opts.qrVariants).toEqual([]);
    expect(opts.qrTarget).toBeNull();
    expect(opts.yes).toBe(false);
    expect(opts.target).toEqual({ mode: 'docker', container: 'supabase_db_localvivaahvarnam' });
  });

  it('accepts the long spelling of a kind as well as the short one', () => {
    const opts = readOptions(parseArgs([...base, '--kinds', 'og_image,qr', '--qr-target-url-env', 'T']), { T: PLATE_TARGET });
    expect(opts.kinds).toEqual(['og_image', 'qr']);
    expect(opts.qrVariants).toEqual(['40mm']);
    expect(opts.qrTarget).toBe(PLATE_TARGET);
  });

  it('takes both sheets in one run, because they are different slots', () => {
    const opts = readOptions(parseArgs([...base, '--papers', 'a4,letter']), {});
    expect(opts.papers).toEqual(['a4', 'letter']);
  });

  it('refuses a sheet asked for with no pdf to print', () => {
    expect(() => readOptions(parseArgs([...base, '--kinds', 'og', '--papers', 'letter']), {}))
      .toThrow(/--papers was given but no pdf kind/);
  });

  it('refuses a version it was not given', () => {
    expect(() => readOptions(parseArgs(['--via-docker', 'supabase_db_localvivaahvarnam']), {}))
      .toThrow(/--version/);
  });

  it('refuses a kind the manifest does not know, and says what it does', () => {
    expect(() => readOptions(parseArgs([...base, '--kinds', 'banner']), {}))
      .toThrow(/og_image, share_image, pdf, qr/);
  });

  it('refuses a kind asked for twice, and a sheet asked for twice', () => {
    expect(() => readOptions(parseArgs([...base, '--kinds', 'og,og']), {})).toThrow(/asked for twice/);
    expect(() => readOptions(parseArgs([...base, '--papers', 'a4,a4']), {})).toThrow(/asked for twice/);
  });

  it('refuses a plate with no address to encode', () => {
    expect(() => readOptions(parseArgs([...base, '--kinds', 'qr']), {}))
      .toThrow(/--qr-target-url-env/);
  });

  it('refuses a named variable that is not set', () => {
    expect(() => readOptions(parseArgs([...base, '--kinds', 'qr', '--qr-target-url-env', 'NOT_SET']), {}))
      .toThrow(/NOT_SET is not set/);
  });

  it.each([
    ['http', 'http://vivaahvarnam.in/i/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['a query', 'https://vivaahvarnam.in/i/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?utm=1'],
    ['credentials', 'https://user:pass@vivaahvarnam.in/i/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['a fragment', 'https://vivaahvarnam.in/i/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA#name'],
    ['not a url at all', 'vivaahvarnam.in/i/x'],
  ])('refuses a plate address that is %s', (unused, value) => {
    expect(() => readOptions(parseArgs([...base, '--kinds', 'qr', '--qr-target-url-env', 'T']), { T: value }))
      .toThrow(/refused/);
  });

  it('refuses an address-bearing target that is not a plate kind', () => {
    expect(() => readOptions(parseArgs([...base, '--qr-target-url-env', 'T']), { T: PLATE_TARGET }))
      .toThrow(/no qr kind/);
  });

  it('refuses a plate variant the manifest does not know', () => {
    expect(() => readOptions(parseArgs([...base, '--kinds', 'qr', '--qr-variants', '50mm', '--qr-target-url-env', 'T']), { T: PLATE_TARGET }))
      .toThrow(/is not a plate variant/);
  });

  it('refuses a container name that is not the local stack', () => {
    expect(() => readOptions(parseArgs(['--version', VERSION, '--via-docker', 'postgres16']), {}))
      .toThrow(/supabase_db_<project>/);
  });

  it('refuses no target at all, and names both ways in', () => {
    expect(() => readOptions(parseArgs(['--version', VERSION]), {}))
      .toThrow(/--via-docker[\s\S]*--db-url-env/);
  });

  it('refuses a hosted maintenance URL', () => {
    expect(() => readOptions(parseArgs(['--version', VERSION, '--db-url-env']), {
      VIVAAHVARNAM_MAINT_DB_URL: 'postgresql://postgres:pw@aws-1-us-east-1.pooler.supabase.co:6543/postgres',
    })).toThrow(/hosted target/);
  });

  it('takes a loopback maintenance URL from the environment only', () => {
    const opts = readOptions(parseArgs(['--version', VERSION, '--db-url-env']), {
      VIVAAHVARNAM_MAINT_DB_URL: 'postgresql://postgres@127.0.0.1:54401/postgres',
    });
    expect(opts.target).toEqual({ mode: 'url', url: 'postgresql://postgres@127.0.0.1:54401/postgres' });
  });

  it('refuses a maintenance URL whose host is not loopback', () => {
    expect(() => readOptions(parseArgs(['--version', VERSION, '--db-url-env']), {
      VIVAAHVARNAM_MAINT_DB_URL: 'postgresql://postgres@10.1.2.3:5432/postgres',
    })).toThrow(/Only a loopback address/);
  });

  it('reads flags in both the spaced and the equals form', () => {
    expect(parseArgs(['--kinds=og,qr', '--yes']).kinds).toBe('og,qr');
    expect(parseArgs(['--kinds=og,qr', '--yes']).yes).toBe(true);
    expect(parseArgs(['--yes', '--kinds', 'og']).kinds).toBe('og');
  });

  it('does not swallow the next flag as a value', () => {
    const args = parseArgs(['--kinds', '--yes']);
    expect(args.kinds).toBe(true);
    expect(args.yes).toBe(true);
  });

  it('stops at help before it needs a target', () => {
    expect(readOptions(parseArgs(['--help']), {})).toEqual({ help: true });
  });
});

// ------------------------------------------------------------------ the channels
describe('the channels and the redactor', () => {
  it('withholds a statement that writes and passes one that reads', () => {
    const seen = [];
    const channel = makeSqlChannel((statement) => { seen.push(statement); return 'ok'; }, false);
    expect(channel('SELECT 1;')).toBe('ok');
    expect(() => channel('INSERT INTO x VALUES (1);')).toThrow(/withheld by the dry run/);
    try { channel('UPDATE x SET a = 1'); } catch (error) { expect(error.withheld).toBe(true); }
    expect(() => channel('DELETE FROM x;')).toThrow(/delete/);
    expect(seen).toEqual(['SELECT 1;']);
  });

  it('passes a write when the run is allowed to mutate', () => {
    const channel = makeSqlChannel(() => 'ok', true);
    expect(channel('INSERT INTO x VALUES (1);')).toBe('ok');
    expect(channel('UPDATE x SET a = 1;')).toBe('ok');
  });

  it('holds the storage writes shut and leaves the download open', async () => {
    const calls = [];
    const guarded = guardStorageWrites({
      upload: async () => { calls.push('upload'); return { ok: true }; },
      upsert: async () => { calls.push('upsert'); return { ok: true }; },
      download: async () => { calls.push('download'); return { ok: true }; },
      remove: async () => { calls.push('remove'); return { ok: true }; },
    }, false);
    await expect(guarded.upload({})).rejects.toThrow(/withheld/);
    await expect(guarded.upsert({})).rejects.toThrow(/withheld/);
    await expect(guarded.remove({})).rejects.toThrow(/withheld/);
    expect(await guarded.download({})).toEqual({ ok: true });
    expect(calls).toEqual(['download']);
    expect(guardStorageWrites({ upload: async () => ({ ok: true }) }, true).upload).toBeInstanceOf(Function);
  });

  it('scrubs a credential and an address, and leaves a uuid alone', () => {
    const redact = makeRedactor([KEY, 'sb_publishable_AAAAAAAAAAAAAAAAAAAA', PLATE_TARGET]);
    expect(redact(`authorization: Bearer ${KEY}`)).toBe('authorization: Bearer [redacted]');
    expect(redact(`pointing at ${PLATE_TARGET}`)).toContain('[redacted]');
    expect(redact(`version ${VERSION} slice ${VERSION.slice(0, 8)}`)).toContain(VERSION.slice(0, 8));
    // Everything the run hands it is turned into text rather than thrown over: a log line made from a
    // missing value is still a line, and still cannot carry a secret it never had.
    expect(redact(null)).toBe('null');
    expect(redact([null, KEY])).toBe(',[redacted]');
    expect(makeRedactor(['short'])('short word')).toBe('short word');
    expect(makeRedactor([])('nothing at all')).toBe('nothing at all');
  });

  it('decodes a line back into the value it was built from, and refuses a lie', () => {
    expect(decodeLine(b64({ a: 1 }))).toEqual({ a: 1 });
    expect(() => decodeLine('not base64 json at all')).toThrow(/cannot trust what it read/);
    try { decodeLine('nonsense'); } catch (error) { expect(error.exitCode).toBe(1); }
  });

  it('speaks the Storage REST the browser uses', async () => {
    const requests = [];
    const fakeFetch = async (url, init) => {
      requests.push({ url, method: init.method, headers: init.headers, body: init.body });
      return {
        status: 200,
        headers: { get: () => 'image/png' },
        json: async () => ({}),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    };
    const storage = makeStorageChannel({ apiOrigin: 'http://127.0.0.1:54400', apiKey: KEY, fetchImpl: fakeFetch });
    await storage.upload({ key: 'k', bytes: Buffer.from([1]), mime: 'image/png' });
    await storage.upsert({ key: 'k', bytes: Buffer.from([1]), mime: 'image/png' });
    const back = await storage.download({ key: 'k' });
    await storage.remove({ key: 'k' });
    expect(requests.map((request) => request.method)).toEqual(['POST', 'PUT', 'GET', 'DELETE']);
    expect(requests[0].url).toBe(`http://127.0.0.1:54400/storage/v1/object/${OUTPUT_BUCKET}/k`);
    expect(requests[0].headers['content-type']).toBe('image/png');
    expect(requests[1].headers['x-upsert']).toBe('true');
    expect(requests[2].url).toContain(`/storage/v1/object/authenticated/${OUTPUT_BUCKET}/k`);
    expect(requests[3].url).toBe(`http://127.0.0.1:54400/storage/v1/object/${OUTPUT_BUCKET}`);
    expect(requests[3].body).toBe(JSON.stringify({ prefixes: ['k'] }));
    expect(requests[0].headers.apikey).toBe(KEY);
    expect(requests[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(back.bytes).toEqual(Buffer.from([1, 2, 3]));
    expect(back.contentType).toBe('image/png');
  });

  it('treats a 404 as absent and a refusal as a refusal', async () => {
    const respond = (status, payload) => async () => ({
      status, headers: { get: () => null }, json: async () => payload, arrayBuffer: async () => new ArrayBuffer(0),
    });
    const empty = makeStorageChannel({ apiOrigin: 'http://h', apiKey: KEY, fetchImpl: respond(200, []) });
    expect(await empty.remove({ key: 'k' })).toMatchObject({ ok: true, absent: true });
    const gone = makeStorageChannel({ apiOrigin: 'http://h', apiKey: KEY, fetchImpl: respond(404, { message: 'not found' }) });
    expect(await gone.remove({ key: 'k' })).toMatchObject({ ok: false, absent: true, status: 404 });
    const refused = makeStorageChannel({ apiOrigin: 'http://h', apiKey: KEY, fetchImpl: respond(400, { error: 'no' }) });
    expect(await refused.remove({ key: 'k' })).toMatchObject({ ok: false, absent: true, status: 400 });
    const read = makeStorageChannel({ apiOrigin: 'http://h', apiKey: KEY, fetchImpl: respond(400, { error: 'no' }) });
    expect(await read.download({ key: 'k' })).toMatchObject({ ok: false, status: 400 });
  });

  it('reports an accepted upload by the verb the API answered', async () => {
    const channel = makeStorageChannel({
      apiOrigin: 'http://h', apiKey: KEY,
      fetchImpl: async () => ({ status: 201, headers: { get: () => null }, json: async () => ({ Key: 'k' }), arrayBuffer: async () => new ArrayBuffer(0) }),
    });
    expect(await channel.upload({ key: 'k', bytes: Buffer.from([1]), mime: 'image/png' })).toMatchObject({ ok: true, status: 201, verb: 'POST' });
    expect(await channel.upsert({ key: 'k', bytes: Buffer.from([1]), mime: 'image/png' })).toMatchObject({ ok: true, verb: 'PUT' });
  });
});
