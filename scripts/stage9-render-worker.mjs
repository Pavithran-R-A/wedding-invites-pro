#!/usr/bin/env node
// VIVAAHVARNAM — Stage 9 §5/§6.4/§11: the locally operated Chromium render worker.
//
// What this file is. The harness (`render.html` + `src/render/main.tsx`) turns a validated canonical
// DTO into a *document*; something else has to say how big the box is, whether the drawn document fits
// that box, what to do when it does not, and what bytes came out. That something is this worker, and
// the split is not incidental: `src/render/render.css` states that the fitting decision "needs a
// measured content height, which is why [it is] absent from this file and present in the worker that
// has one", and only a browser has one. So the worker owns measurement and decision, while the
// geometry it decides *with* lives in `src/render/outputGeometry.ts` — one file, importable by the
// unit battery that pins it, so a box number is never a fact remembered in two places.
//
// What it refuses, in order of the cost of getting it wrong:
//
//   * **An unqualified browser.** §6.4: the major version Chrome answers with on `/json/version` must
//     equal the `validated_against:` line in `docs/architecture/render-outputs.md`, unless the operator
//     passed `acceptUnknownBrowser`, which then travels into every record this run produces. The Chrome
//     154 removals recorded at `scripts/stage5-browser-driver.mjs:434-438` are why this is a gate and
//     not a note: a method that disappears should cost a run, not a customer's wedding file.
//   * **A capability that is not there.** Each CDP call the worker uses is called before anything is
//     drawn, and an unsupported one is named rather than discovered halfway through a page.
//   * **A document the guest's parser would not show.** `parseInvitationObject` is the same door the
//     guest page and the harness go through (§11.1), and it is consulted here *before* the request is
//     mounted, so the worker cannot be used to print bytes the product has already refused to draw.
//   * **Content that does not fit.** A teaser that still overflows after the ladder is
//     `teaser-does-not-fit`. Share content taller than the last quantised box becomes a *set* of
//     `1080x2160` pages (§5: "continues onto a second page of the same set … Never cropped"), and only
//     when the cut can be made honestly: past four pages it is `too-many-pages`, and a single ceremony
//     taller than a page is `unbreakable-content`. Neither produces a file — §5 makes "never cropped"
//     and "never a complete document" two different promises, and both are kept by refusing to hand over
//     the wrong artefact rather than handing it over quietly. A set that stops partway also deletes the
//     pages it already wrote, so no orphan sheet can outlive its refusal; the tier drives that loop only
//     as far as a §11.4 timeout on page one (R-H), which is why the deletion is a code path here and not
//     a measured result.
//   * **A sheet that is not the paper it was asked for.** `Page.printToPDF` is sent the inches
//     `pdfPrintParams()` states and the answer is read back out of the file's own `/MediaBox` and
//     `/Count`. Wrong numbers, a page tree the reader cannot settle, or more sheets than §5's bound is
//     `pdf-box-mismatch`, `pdf-page-count-*` and `too-many-pages`, and none of them reaches disk.
//   * **A byte past the ceiling, a render past its deadline, a plate that is not an integer box.**
//     §11.4's bounds are arithmetic here — one serialised chain, one page in one context, a wall-clock
//     race, a size test on the bytes before they reach disk — and each overrun is a named reason with
//     nothing written.
//
// Digests. `source_dto_digest` is taken over the *parsed* projection in canonical JSON, not over the
// caller's bytes, so a payload carrying fields the parser already dropped does not look like a different
// invitation (§4 of `docs/architecture/render-outputs.md` states the rule this file and the tier both
// re-derive from). `render_config_hash` covers the browser, the geometry file, both stylesheets, the
// font bytes, the encoder settings, the box and the applied plan — which is what turns §13's "is this
// artefact stale?" from a conversation into a query.
//
// What is deliberately NOT here yet, because a slice boundary is a claim and not a silence: Storage
// upload and the `invitation_outputs` rows. The paginated share set *is* here now — page 1 of N at one
// box, with every cut taken from the drawn document's own unit bottoms — as is PDF output, the whole
// document on either paper, with the sheet size and page count read back from the produced bytes before
// they are written. §6.3's text-layer and per-script glyph checks are the output tier's, because they
// belong to the artefact a guest will hold rather than to the call that made it.
// The record this file returns already carries the manifest's columns, so the migration changes where a
// record goes, not what it says.
//
// Usage (as a module — the entry point is `scripts/stage9-render-raster.mjs`):
//
//   const worker = await openRenderWorker({ origin: 'http://127.0.0.1:4173', outputDir });
//   const teaser = await worker.renderOgTeaser({ dto });
//   const sheet = await worker.renderPdf({ dto, paper: 'a4' });
//   await worker.close();

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertLoopback, openBrowser } from './stage5-browser-driver.mjs';
import { parseInvitationObject } from '../src/lib/publicInvitation.ts';
import { QR_SURFACE } from '../src/lib/renderSurfaces.ts';
import {
  BYTE_CEILINGS,
  MAX_PDF_PAGES,
  OG_BOX,
  OG_DROP_ORDER,
  PDF_MEDIA_BOX_PT,
  SHARE_WIDTH,
  chooseShareBox,
  chooseShareSlices,
  isPaperVariant,
  pdfPrintParams,
  planOgFit,
} from '../src/render/outputGeometry.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Travels in every record, so a manifest row says which worker arithmetic produced it and an old row
 *  stops being confusable with a new one the moment this file's logic changes. `/2` is the slice that
 *  turns a too-tall share document into a paginated set: `/1` could only refuse it, and a record from
 *  either arithmetic describes a different thing the worker does with the same DTO. Bumping this
 *  changes every `render_config_hash`, not a single artefact byte. */
export const WORKER_VERSION = 'stage9-render-worker/2';
export const ENGINE_TAG = 'chromium-cdp';

/** Lossy WebP is the chat-attachable type §5 asks for, and a quality *default* is not a fact about an
 *  artefact. Pinned here and hashed, so a re-render that means to be identical says so. */
export const WEBP_QUALITY = 92;

/** §6.4's list, in the order the worker needs them. `Page.printToPDF` is probed even by a run that
 *  draws no PDF: the question the pin answers is "can this browser be trusted with this stage's
 *  contract", and the contract includes paper. */
export const RENDER_CAPABILITY_CALLS = [
  'Target.createBrowserContext',
  'Page.navigate',
  'Runtime.evaluate',
  'Emulation.setDeviceMetricsOverride',
  'Page.captureScreenshot',
  'Page.printToPDF',
];

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Keys sorted, recursively, then stringified. §4 of the architecture doc defines both digests over
 *  exactly this, because plain `JSON.stringify` would make a digest depend on the order a parser
 *  happened to build its object in — a fact about an object literal, not about an invitation. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export const dtoDigest = (invitation) => sha256Hex(Buffer.from(canonicalJson(invitation), 'utf8'));

/** The `validated_against:` major from `docs/architecture/render-outputs.md`.
 *
 *  A missing or unparseable line is a refusal, not a default: an absent pin would make every browser
 *  acceptable, which is the exact state the gate exists to prevent. */
export function readBrowserPin(docText) {
  const match = /^validated_against:\s*([0-9]+)\s*$/m.exec(docText);
  return match === null
    ? { ok: false, reason: 'pin-line-missing' }
    : { ok: true, major: Number(match[1]) };
}

/** Chrome answers `/json/version` with `Browser: "Chrome/155.0.8059.40"`. The major is the unit §6.4
 *  pins on: a point release that changes nothing does not re-qualify the stage, and a release that
 *  removes a method is caught by the probe instead of by an artefact. */
export function browserMajor(browserString) {
  const match = /^([A-Za-z][A-Za-z ]*)\/(\d+)/.exec(String(browserString ?? ''));
  return match === undefined || match === null
    ? { ok: false, reason: 'browser-version-unparsable' }
    : { ok: true, product: match[1], major: Number(match[2]) };
}

export function checkBrowserPin(version, pinMajor, acceptUnknownBrowser) {
  const read = browserMajor(version?.Browser);
  if (read.ok === false) return read;
  if (pinMajor === null || pinMajor === undefined) return { ok: false, reason: 'pin-line-missing' };
  if (read.major === pinMajor) return { ok: true, ...read, acceptedUnknown: false };
  if (acceptUnknownBrowser === true) return { ok: true, ...read, acceptedUnknown: true };
  return { ok: false, reason: 'browser-major-unvalidated', found: read.major, pinned: pinMajor };
}

/** Width and height out of the bytes of a PNG or a WebP — no image library, because §9.4's restraint
 *  says one raster route and one encoder, and a decoder added to check our own encoder would be a
 *  second of both. */
export function imageDimensions(bytes, format) {
  if (format === 'png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!signature.every((byte, index) => bytes[index] === byte)) {
      return { ok: false, reason: 'png-signature' };
    }
    if (bytes.toString('ascii', 12, 16) !== 'IHDR') return { ok: false, reason: 'png-ihdr-not-first' };
    return { ok: true, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (format === 'webp') {
    if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
      return { ok: false, reason: 'riff-header' };
    }
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const fourcc = bytes.toString('ascii', offset, offset + 4);
      const size = bytes.readUInt32LE(offset + 4);
      const payload = offset + 8;
      if (fourcc === 'VP8X') {
        return {
          ok: true,
          width: 1 + bytes.readUIntLE(payload + 4, 3),
          height: 1 + bytes.readUIntLE(payload + 7, 3),
        };
      }
      if (fourcc === 'VP8 ') {
        return {
          ok: true,
          width: bytes.readUInt16LE(payload + 7) & 0x3fff,
          height: bytes.readUInt16LE(payload + 9) & 0x3fff,
        };
      }
      if (fourcc === 'VP8L') {
        const bits = bytes.readUInt32LE(payload + 1);
        return { ok: true, width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (fourcc === 'ANIM' || fourcc === 'ANMF') return { ok: false, reason: 'animated-webp' };
      offset = payload + size + (size % 2);
    }
    return { ok: false, reason: 'no-dimension-chunk' };
  }
  return { ok: false, reason: 'format-unknown' };
}

/** §11.4's byte ceiling as a predicate rather than a side effect, so the bound is testable without
 *  manufacturing a five-megabyte raster. */
export function withinByteCeiling(bytes, format) {
  const ceiling = BYTE_CEILINGS[format];
  if (ceiling === undefined) return { ok: false, reason: 'format-unknown' };
  return bytes.length <= ceiling
    ? { ok: true, ceiling }
    : { ok: false, reason: 'bytes-over-ceiling', bytes: bytes.length, ceiling };
}

const PT_PER_MM = 72 / 25.4;
const mmFromPt = (points) => Number((points / PT_PER_MM).toFixed(3));
const asPdfText = (bytes) => (typeof bytes === 'string' ? bytes : bytes.toString('latin1'));

/** The empty answer every refusal shape carries, so a caller reading `out.pageCount` after a failure
 *  gets `null` rather than `undefined` and cannot mistake "unreadable" for "no pages". */
const NO_PDF_STRUCTURE = {
  mediaBoxes: [],
  pageCount: null,
  pageTreeCounts: [],
  pageObjectCount: null,
  fonts: { baseFonts: [], fontFile2: 0, fontFile3: 0, type3: 0, toUnicode: 0 },
  linkTargets: [],
  producer: null,
  dates: { creation: null, modified: null },
  hasDocumentId: false,
  tagged: false,
};

/** What a produced PDF says about itself, read out of its own bytes.
 *
 *  This is a description, not a verdict: it never says "wrong paper" or "too many pages". Those are
 *  refusals, and a refusal has to happen at the one place that can still avoid putting a file on disk
 *  (`writeArtefact`), so a reader that also refused would make the guard possible to walk around.
 *
 *  It reads the uncompressed object dictionaries and nothing else, which is a measurement rather than
 *  an assumption: every key asked for here answers in plain text in Chrome 155's output —
 *  `q9-logs/pdf-probe/{c2-a4,p2-long-a4,p4-ta}.pdf` carry `/ObjStm` zero times, and the raw bytes of
 *  those files contain `/MediaBox`, `/Count`, `/Producer`, `/FontFile2`, `/ToUnicode`, `/URI`,
 *  `/StructTreeRoot` and `/CreationDate` (`q9-logs/pdf-controls2-measured.txt` counted them). A future
 *  producer that moved the page tree into a compressed object stream would therefore produce
 *  `pdf-page-count-unreadable` and no file, which is the right half of the bargain: an unreadable
 *  artefact is a refusal, never a silent one-pager.
 *
 *  `/MediaBox` is *deduplicated* because Chrome writes one per page — five occurrences in the
 *  five-page probe file, all the same numbers. Keeping them distinct is what lets a document that
 *  changes paper mid-run be seen as two boxes instead of averaged into whichever sheet was read first.
 */
export function readPdfStructure(bytes) {
  const text = asPdfText(bytes);
  if (/^%PDF-[0-9]/.test(text) === false) {
    return { ok: false, reason: 'pdf-header-missing', ...NO_PDF_STRUCTURE };
  }

  const mediaBoxes = [];
  for (const found of text.matchAll(/\/MediaBox\s*\[\s*([-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+)\s*\]/g)) {
    const numbers = found[1].trim().split(/\s+/).map(Number);
    const box = {
      widthPt: numbers[2], heightPt: numbers[3],
      widthMm: mmFromPt(numbers[2]), heightMm: mmFromPt(numbers[3]),
    };
    if (mediaBoxes.some((seen) => seen.widthPt === box.widthPt && seen.heightPt === box.heightPt)) {
      continue;
    }
    mediaBoxes.push(box);
  }

  const pageTreeCounts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((found) => Number(found[1]));
  const pageObjectCount = (text.match(/\/Type\s*\/Page(?![s])/g) || []).length;
  if (pageTreeCounts.length === 0 || pageObjectCount === 0) {
    return {
      ok: false, reason: 'pdf-page-count-unreadable',
      ...NO_PDF_STRUCTURE, mediaBoxes, pageTreeCounts, pageObjectCount,
    };
  }
  // Two independent readings of "how many sheets", and both have to answer.
  //
  // The leaf dictionaries are one per sheet by construction. The `/Count` values are the producer's own
  // arithmetic, and measured on this browser they are **not** one number per file: a document of five and
  // of seven sheets is a flat tree (`/Count 5`, `/Count 7`), but a sixteen-sheet document nests —
  // `/Count 8`, `/Count 8` and a root `/Count 16` (`q9-logs/pdf-count-investigated.txt`, files in
  // `q9-logs/pdf-count-probe/`). The root total is therefore the largest value, and the earlier shape of
  // this guard ("all `/Count` must be equal") refused legitimate long invitations as ambiguous — a false
  // refusal is as much a broken export as a silent wrong count, and it also hid §5's sheet bound behind
  // the wrong reason. What neither reading can settle on its own, the pair can: if the biggest `/Count`
  // is not the number of page objects, the tree does not add up to its own leaves.
  const pageCount = Math.max(...pageTreeCounts);
  if (pageCount !== pageObjectCount) {
    return {
      ok: false, reason: 'pdf-page-count-ambiguous',
      ...NO_PDF_STRUCTURE, mediaBoxes, pageTreeCounts, pageObjectCount, pageCount,
    };
  }

  return {
    ok: true,
    mediaBoxes,
    pageCount,
    pageTreeCounts,
    pageObjectCount,
    fonts: {
      baseFonts: [...new Set([...text.matchAll(/\/BaseFont\s*\/([^\s/>]+)/g)]
        .map((found) => `/${found[1]}`))],
      fontFile2: (text.match(/\/FontFile2/g) || []).length,
      fontFile3: (text.match(/\/FontFile3/g) || []).length,
      type3: (text.match(/\/Subtype\s*\/Type3/g) || []).length,
      toUnicode: (text.match(/\/ToUnicode/g) || []).length,
    },
    linkTargets: [...new Set([...text.matchAll(/\/URI\s*\(([^)]*)\)/g)].map((found) => found[1]))],
    producer: text.match(/\/Producer\s*\(([^)]*)\)/)?.[1] ?? null,
    dates: {
      creation: text.match(/\/CreationDate\s*\(([^)]*)\)/)?.[1] ?? null,
      modified: text.match(/\/ModDate\s*\(([^)]*)\)/)?.[1] ?? null,
    },
    hasDocumentId: /\/ID\s*\[/.test(text),
    tagged: /\/StructTreeRoot/.test(text),
  };
}

/** The stamp `readPdfStructure` writes into both date keys, exactly as long as what Skia writes
 *  (`D:` + 14 digits + a `±HH'MM'` offset) so the replacement cannot move a byte offset. */
const PDF_DATE_EPOCH = `D:19700101000000+00'00'`;
const PDF_DATE = /(\/(?:CreationDate|ModDate)\s*\()D:\d{14}[+-]\d{2}'\d{2}'(?=\))/g;

/** The metadata half of §13's determinism question, taken out of the comparison.
 *
 *  A produced PDF carries a creation time, so two honest renders of the same invitation minutes apart
 *  are not byte-identical and never claimed to be (the design separates visual equivalence, content
 *  equivalence and byte-identity for exactly this reason). Measured on this browser
 *  (`q9-logs/pdf-override-measured.txt`): two cycles of the worker's own print sequence differed in
 *  four bytes, which is the `CreationDate`/`ModDate` digit pair and nothing else.
 *
 *  So the determinism check compares normalised bytes, and a normalisation that changed the file's
 *  length would be worse than no normalisation: a PDF's cross-reference table is absolute offsets, so
 *  the instrument would then be comparing two broken files. That is why the pattern is strict —
 *  a stamp in an unexpected shape is left alone and the whole call refuses as `no-pdf-timestamps`
 *  rather than quietly returning the input and reading as a successful normalisation. */
export function normalisePdfTimestamps(bytes) {
  const text = asPdfText(bytes);
  let replaced = 0;
  const normalised = text.replace(PDF_DATE, (whole, prefix) => {
    replaced += 1;
    return `${prefix}${PDF_DATE_EPOCH}`;
  });
  if (replaced === 0) {
    return { ok: false, reason: 'no-pdf-timestamps', replaced: 0, bytes };
  }
  if (normalised.length !== text.length) {
    // Unreachable through the pattern above, and kept as a named refusal rather than an assertion
    // because the consequence — an unopenable file that compares "deterministic" — is silent.
    return { ok: false, reason: 'pdf-normalisation-changed-length', replaced, bytes };
  }
  return { ok: true, replaced, bytes: Buffer.from(normalised, 'latin1') };
}

/** SHA-256 over the face bytes **as they are on disk now**, plus each family's pinned package, version
 *  and licence (§5 of the architecture doc). Reading the manifest's own numbers would let a manifest
 *  that has drifted from its files vouch for itself. */
export function fontProvenance(root = ROOT) {
  const manifest = JSON.parse(
    readFileSync(join(root, 'public', 'fonts', 'font-manifest.json'), 'utf8'));
  const families = manifest.families.map((family) => ({
    package: family.package,
    version: family.version,
    license: family.license,
    faces: family.faces.map((face) => {
      const bytes = readFileSync(join(root, 'public', 'fonts', face.file.replace(/^\.?\//, '')));
      return {
        label: face.label, file: face.file, bytes: bytes.length, sha256: sha256Hex(bytes),
      };
    }).sort((a, b) => (a.label < b.label ? -1 : 1)),
  }));
  return {
    digest: sha256Hex(Buffer.from(canonicalJson({ families }), 'utf8')),
    familyCount: families.length,
    faceCount: families.reduce((total, family) => total + family.faces.length, 0),
    byteCount: families.reduce(
      (total, family) => total + family.faces.reduce((sum, face) => sum + face.bytes, 0), 0),
  };
}

/** The two things §5's teaser contract says no plan may ever remove: the host's title and the first
 *  drawn ceremony. They are addressed by the renderer's own stamps (`h1` is part of its accessibility
 *  contract, `data-render-event-position` counts the events it drew) and read back as *painted* rather
 *  than as "not the node we hid", because a rule that hid an ancestor would otherwise look compliant. */
const PROTECTED_SELECTORS = ["[data-render-surface] h1", "[data-render-event-position='1']"];

/** The applied-plan half of the harness DOM, as one atomic page operation.
 *
 *  Restore-then-apply, in that order and in the same call, because React reuses the article's DOM nodes
 *  across mounts: a `display: none` written for one invitation would otherwise still sit on the next
 *  one's section, silently dropping a ceremony from a document that never needed it dropped. Restoring
 *  first makes the operation idempotent from any starting state — including one a timed-out render left.
 *  The lead the renderer wrote is saved the first time it is overwritten for the same reason
 *  (`CLEAR_APPLIED` restores it): React only writes `fontSize` when the *prop* changes, so two hosts who
 *  both chose 24 px would leave the second document sitting at the first one's ladder size.
 *
 *  Drops are addressed only through the renderer's own `data-render-*` stamps, never a tag name, a
 *  class or a position, because the stamp vocabulary is part of the renderer's surface contract and is
 *  asserted elsewhere, while a class name is a styling decision the next release may change. The lead
 *  size is written to the article's `style` attribute — the same attribute the component owns, which is
 *  why the plan's size is what a captured artefact shows and a stylesheet never overrides it.
 *
 *  What comes back is the measurement plus the DOM's own account of the plan — which stamps were hidden,
 *  under which drop, and whether the protected elements still paint. §5's promise that a teaser keeps the
 *  title, the people and the first ceremony is only a promise if something reads the page afterwards. */
const APPLY_AND_MEASURE = `((plan) => {
  const article = document.querySelector('[data-render-surface]');
  if (!article) return { ok: false, reason: 'no-render-root' };
  const applied = window.__s9Applied || [];
  for (const record of applied) record.node.style.display = record.previous;
  window.__s9Applied = [];
  if (window.__s9BaseLead === undefined) window.__s9BaseLead = article.style.fontSize;
  article.style.fontSize = plan.leadPx + 'px';
  const hidden = [];
  for (const drop of plan.drops) {
    let nodes = [...document.querySelectorAll(drop.selector)];
    if (drop.keepFirstOf !== null) nodes = nodes.slice(drop.keepFirstOf);
    for (const node of nodes) {
      window.__s9Applied.push({ node, previous: node.style.display });
      node.style.display = 'none';
      hidden.push({
        drop: drop.id,
        kind: node.getAttribute('data-render-kind'),
        region: node.getAttribute('data-render-region'),
        position: node.getAttribute('data-render-event-position'),
      });
    }
  }
  void article.offsetHeight;
  const box = article.getBoundingClientRect();
  return {
    ok: true,
    widthPx: box.width,
    heightPx: box.height,
    hidden,
    protected: plan.protected.map((selector) => {
      const node = document.querySelector(selector);
      return { selector, present: node !== null, painted: node !== null && node.getClientRects().length > 0 };
    }),
  };
})`;

/** Where a share document may be cut, as the drawn document itself states it.
 *
 *  Offsets are document-space CSS pixels, which is the space `Page.captureScreenshot`'s `clip.y` answers
 *  in (measured at `q9-logs/share-pagination-measured.txt`: a clip at `y` returns document row `y` at
 *  both a 1350 and a 2160 device-metrics override, and two captures overlapping by 1160 px agree on all
 *  5,011,200 overlapped subpixel values).
 *
 *  The list is deliberately not "every element's bottom". A page break is only honest if it lands where
 *  nothing was mid-thought, so the same restraint `src/render/render.css:126-138` states for paper is
 *  computed here against the renderer's own stamps and its own paragraphs, structurally rather than as a
 *  filter afterwards:
 *
 *    * a stamped section or paragraph contributes its bottom — the unit is finished there;
 *    * every paragraph outside a ceremony contributes its bottom and each *line box*'s bottom, from
 *      `Range.getClientRects()`, because a twelve-line blessing is pageable between its lines and a whole
 *      section is not the smallest unit a guest would accept. This one is deliberately wider than the
 *      stamps: a body section stamps its wrapper and leaves the paragraph inside it unlabelled
 *      (`InvitationRenderer.tsx:347-350`), so a collector that walked only `[data-render-kind]` would
 *      offer a single cut for a thirty-line blessing and none between its lines. Measured on the tier's
 *      own documents — 4 pages where the fill needs 3 for 5,606.34 px, and an `unbreakable-content`
 *      refusal where the honest answer is `too-many-pages` for 11,815.78 px
 *      (`q9-logs/raster-pagination-run1.txt`);
 *    * a roster contributes each `<li>` bottom — one name is an atomic line, and a family list that
 *      ran past a page would otherwise refuse an ordinary wedding rather than paginate it;
 *    * a ceremony (`[data-render-event-position]`) contributes ONLY its own bottom. Nothing from inside
 *      one is a candidate — its address lines are `p` elements, so the exclusion is expressed as
 *      `closest('[data-render-event-position]')` rather than as a shape filter afterwards — because a
 *      muhurtham time on one card and its hall on the next is the wrong-day, wrong-hall confusion §5's
 *      "never cropped" is protecting against;
 *    * an `h2` contributes nothing at all, which is what keeps a heading with the block it introduces —
 *      the first candidate after a heading is the bottom of that block, so no break can fall between
 *      them. The element name is safe to address here for the same reason render.css addresses it: the
 *      heading level is part of the renderer's accessibility contract and asserted elsewhere.
 *
 *  `events` and `headings` come back alongside the candidates so the output tier can check the rule from
 *  the browser's own evidence rather than taking the worker's arithmetic on trust. */
const SHARE_LAYOUT = `(() => {
  const round = (value) => Math.round(value * 100) / 100;
  const article = document.querySelector('[data-render-surface]');
  if (!article) return { ok: false, reason: 'no-render-root' };
  const root = article.getBoundingClientRect();
  if (!(root.height > 0) || !Number.isFinite(root.height)) {
    return { ok: false, reason: 'content-not-measurable' };
  }
  const scroll = window.scrollY;
  const docTop = (node) => round(node.getBoundingClientRect().top + scroll);
  const docBottom = (node) => round(node.getBoundingClientRect().bottom + scroll);

  const events = [...article.querySelectorAll('[data-render-event-position]')].map((node) => ({
    position: Number(node.getAttribute('data-render-event-position')),
    topPx: docTop(node),
    bottomPx: docBottom(node),
  }));
  const headings = [...article.querySelectorAll('h2')].map((node) => ({
    text: (node.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 40),
    topPx: docTop(node),
    bottomPx: docBottom(node),
  }));

  const breaks = [];
  const add = (px, label) => {
    if (Number.isFinite(px) && px > 0) breaks.push({ px, label });
  };
  /** The section an element belongs to, as the renderer stamped it. For a paragraph inside a body
   *  section that means its wrapper: InvitationRenderer.tsx:347-350 deliberately puts the stamp on the
   *  wrapper and leaves the h2 and p inside it unlabelled, so that a guest's DOM and a render
   *  surface's differ only in what carries the label, not in what is drawn. */
  const labelOf = (node) => {
    const unit = node.closest('[data-render-kind]');
    return unit === null
      ? 'unstamped'
      : unit.getAttribute('data-render-kind') + '/' + unit.getAttribute('data-render-region');
  };

  for (const node of article.querySelectorAll('[data-render-kind]')) {
    if (node.tagName === 'H2') continue;
    add(docBottom(node), labelOf(node));
  }
  for (const node of article.querySelectorAll('p')) {
    if (node.closest('[data-render-event-position]')) continue;
    add(docBottom(node), 'para:' + labelOf(node));
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      add(round(rect.bottom + scroll), 'line:' + labelOf(node));
    }
  }
  for (const event of events) add(event.bottomPx, 'event#' + event.position);
  for (const row of article.querySelectorAll('[data-render-kind="people_list"] li')) {
    add(docBottom(row), 'roster-row');
  }

  return {
    ok: true,
    widthPx: round(root.width),
    contentHeightPx: round(root.height),
    documentTopPx: round(root.top + scroll),
    breaks,
    events,
    headings,
  };
})()`;

/** Undo what an applied plan did to the page.
 *
 *  The lead is restored alongside the hidden nodes, and that half is not decoration: React writes the
 *  article's `fontSize` from the *prop*, so a later mount of a document whose host chose the same size
 *  produces no DOM write at all and would inherit the 22 px the ladder used for the last one. The next
 *  render's `RENDERED_LEAD` would then read the previous artefact's plan as the host's own choice, and
 *  a ladder that starts at the wrong rung is a ladder that silently draws every teaser small. Restoring
 *  only when a base was recorded keeps this safe to call at any point, including after a timeout that
 *  interrupted a render mid-ladder. */
const CLEAR_APPLIED = `(() => {
  const applied = window.__s9Applied || [];
  for (const record of applied) record.node.style.display = record.previous;
  window.__s9Applied = [];
  const article = document.querySelector('[data-render-surface]');
  if (article && window.__s9BaseLead !== undefined) {
    article.style.fontSize = window.__s9BaseLead;
    delete window.__s9BaseLead;
  }
  return applied.length;
})()`;

const RENDERED_LEAD = `(() => {
  const article = document.querySelector('[data-render-surface]');
  if (!article) return null;
  return Number.parseFloat(window.getComputedStyle(article).fontSize);
})()`;

/** The plate's box, read back rather than assumed: the harness's own door turned the variant into
 *  geometry, so a worker that re-derived it from the variant name would be a second opinion about the
 *  same pixels — the thing §5's "one raster route" exists to prevent. */
const CANVAS_BOX = `(() => {
  const canvas = document.querySelector('[data-render-surface="qr"]');
  if (!canvas) return { ok: false, reason: 'no-plate-root' };
  const box = canvas.getBoundingClientRect();
  return {
    ok: true,
    intrinsicWidth: canvas.width,
    intrinsicHeight: canvas.height,
    cssWidthPx: box.width,
    cssHeightPx: box.height,
  };
})()`;

/** `main.tsx` puts the refusal rule name on `#render-root`, and never on a caller's bytes — which is
 *  why a reason is safe to put in a record, a log line and eventually a manifest column (§11.5).
 *
 *  The attribute is read in the *same* page operation as the mount promise resolves, and that is the
 *  whole of the reason this is one expression rather than two calls: the worker's serialised chain is
 *  a promise queue, so a task that is already running inside it cannot await a second task on the same
 *  queue. Reading the refusal as a separate `serialised(...)` call inside `mount()` therefore deadlocked
 *  on every refused request — measured, a refused mount answers in 2–3 ms when the reason is read
 *  outside the chain while the nested form was still pending after 3 s — and each `render-timeout` it
 *  produced left the jam in place for the next render on that page. */
const MOUNT_AND_STATE = `(async (request) => {
  const reached = await window.__vivaahvarnamRender.mount(request);
  return {
    reached,
    refusal: document.getElementById('render-root')?.getAttribute('data-render-refusal') ?? null,
  };
})`;

/** The drop ids `planOgFit` speaks, mapped to the page-side instruction, built from the same array so a
 *  new entry in `outputGeometry.ts` is applicable without touching this file. */
const DROP_INSTRUCTIONS = Object.fromEntries(OG_DROP_ORDER.map((entry) =>
  [entry.id, { id: entry.id, selector: entry.selector, keepFirstOf: entry.keepFirstOf }]));

/** The engine identity that travels into every artefact's `render_config_hash` (§4).
 *
 *  This records the fields the endpoint answers *invariantly*, measured rather than taken from the CDP
 *  documentation. Chrome 155.0.8059.40 on this host replies with `Browser`, `Protocol-Version`,
 *  `User-Agent`, `V8-Version`, `WebKit-Version` and `webSocketDebuggerUrl` — the raster tier prints the
 *  key set as `answered-keys` on every run — and it has never once answered a `Version` or `Revision`
 *  key here. An earlier revision of this function read exactly those two missing keys, so every record
 *  stored `null` where the engine build should have been and the hash was hashing nulls: §6.4's
 *  "a browser upgrade is detectable" was false while the run still printed `Version: undefined` and
 *  passed, because nothing asked whether the fields it records were ever answered.
 *
 *  `V8-Version` and `WebKit-Version` are deliberately *not* in the hash. One early probe of a different
 *  CDP port answered four keys only, and a field that can be absent makes the hash depend on which
 *  answer arrived rather than on the browser — the opposite of a staleness query. `Browser` carries the
 *  full build (`Chrome/155.0.8059.40`), from which both engine versions follow, so nothing is lost that
 *  the hash needs. Changing this list changes every `render_config_hash` this worker reports; it does
 *  not change a single artefact byte. */
const browserRecord = (version) => ({
  browser: version?.Browser ?? null,
  protocol: version?.['Protocol-Version'] ?? null,
  user_agent: version?.['User-Agent'] ?? null,
});

export async function openRenderWorker({
  origin,
  outputDir,
  root = ROOT,
  acceptUnknownBrowser = false,
  renderDeadlineMs = 45_000,
  pinPath = 'docs/architecture/render-outputs.md',
  cdpPort = 9419,
} = {}) {
  assertLoopback(origin, 'render origin');
  mkdirSync(outputDir, { recursive: true });

  const pin = readBrowserPin(readFileSync(join(root, pinPath), 'utf8'));
  if (pin.ok === false) throw new Error(`worker: ${pin.reason} in ${pinPath}`);

  const browser = await openBrowser({ cdpPort });
  try {
    const pinCheck = checkBrowserPin(browser.version, pin.major, acceptUnknownBrowser);
    if (pinCheck.ok === false) {
      throw new Error(`worker: ${pinCheck.reason}`
        + ` (found ${pinCheck.found ?? 'unparsable'}, pinned ${pinCheck.pinned ?? pin.major})`);
    }

    // The probe opens with the one browser-level call, before any page exists, so §11.4's single
    // context holds for the whole run: create and dispose an empty context, then never again.
    const capabilities = [];
    const probed = async (method, call) => {
      try {
        await call();
        capabilities.push({ method, ok: true });
      } catch (error) {
        capabilities.push({ method, ok: false, note: String(error.message ?? error).slice(0, 140) });
      }
    };
    await probed('Target.createBrowserContext', async () => {
      const created = await browser.cdp('Target.createBrowserContext', { disposeOnDetach: true });
      await browser.cdp('Target.disposeBrowserContext', {
        browserContextId: created.browserContextId });
    });
    const failures = capabilities.filter((entry) => entry.ok === false);
    if (failures.length > 0) {
      throw new Error(`worker: browser lacks ${failures.map((f) => f.method).join(', ')}`);
    }

    const page = await browser.newPage('render');
    // `Page.navigate` is itself under test, so the remaining calls are probed on the harness document
    // after a navigation that has to succeed — a method "available" on a page the worker cannot reach
    // would be a green probe over an unusable browser.
    await probed('Page.navigate', () => page.goto(`${origin}/render.html`));
    await probed('Runtime.evaluate', () => page.evaluate('1 + 1'));
    await probed('Emulation.setDeviceMetricsOverride', () => page.cdp(
      'Emulation.setDeviceMetricsOverride', {
        width: 320, height: 240, deviceScaleFactor: 1, mobile: false }));
    await probed('Page.captureScreenshot', () => page.cdp('Page.captureScreenshot', {
      format: 'png', clip: { x: 0, y: 0, width: 8, height: 8, scale: 1 } }));
    await probed('Page.printToPDF', () => page.cdp('Page.printToPDF', { printBackground: true }));
    const unsupported = capabilities.filter((entry) => entry.ok === false);
    if (unsupported.length > 0) {
      throw new Error(`worker: browser lacks ${
        unsupported.map((entry) => `${entry.method} (${entry.note})`).join(', ')}`);
    }

    const provenance = fontProvenance(root);
    const styles = {
      output_geometry: sha256Hex(readFileSync(join(root, 'src', 'render', 'outputGeometry.ts'))),
      render_css: sha256Hex(readFileSync(join(root, 'src', 'render', 'render.css'))),
      index_css: sha256Hex(readFileSync(join(root, 'src', 'index.css'))),
    };
    const state = { chain: Promise.resolve(), renders: 0, closed: false };

    /** One CDP operation at a time, on one page in one context (§11.4). A chain rather than a refusal:
     *  a caller that asks for three artefacts gets three serialised renders, not two it has to retry,
     *  and no two renders ever interleave their DOM mutations. */
    const serialised = (work) => {
      const run = state.chain.then(work);
      // Advance on a settled-but-rejected run: without the catch, one operation that threw would leave
      // every later call chained to a rejection that never runs — a worker that silently stops drawing.
      state.chain = run.catch(() => undefined);
      return run;
    };

    /** §11.4's wall clock. The deadline answers the caller with a named reason and stops the artefact
     *  from being written; the in-flight chain still runs to its own CDP timeout, which is why nothing
     *  here treats a timeout as "the page is clean" — the next render's restore-first apply is what
     *  makes a poisoned page impossible to inherit.
     *
     *  The `gate` is what makes the second half of that sentence true. A deadline that only stops
     *  *answering* would let the still-running render write its file a second later, so a caller that
     *  was told `render-timeout` would find an artefact on disk it never asked for and never recorded —
     *  §11.4 says an overrun is a named failure, never a file. `writeArtefact` refuses once the gate
     *  has expired, and each render checks before capturing so a late render stops doing work at all. */
    const withDeadline = (work) => new Promise((resolveResult) => {
      let settled = false;
      const gate = { expired: false };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        gate.expired = true;
        resolveResult({ ok: false, reason: 'render-timeout', deadline_ms: renderDeadlineMs });
      }, renderDeadlineMs);
      work(gate).then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveResult(value);
      }, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveResult({
          ok: false, reason: 'worker-error',
          detail: String(error.message ?? error).slice(0, 200),
        });
      });
    });

    const mount = (request) => serialised(() =>
      page.evaluate(`${MOUNT_AND_STATE}(${JSON.stringify(request)})`).then((outcome) => {
        if (outcome?.reached === 'ready') return { ok: true, state: outcome.reached };
        return {
          ok: false,
          reason: outcome?.refusal ?? `harness-state-${String(outcome?.reached)}`,
        };
      }));

    const applyPlanAndMeasure = ({ leadPx, dropped }) => serialised(() => {
      const drops = dropped.map((id) => {
        const instruction = DROP_INSTRUCTIONS[id];
        if (instruction === undefined) throw new Error(`worker: unknown drop id ${id}`);
        return instruction;
      });
      return page.evaluate(
        `${APPLY_AND_MEASURE}(${JSON.stringify(
          { leadPx, drops, protected: PROTECTED_SELECTORS },
        )})`);
    });

    const clearApplied = () => serialised(() => page.evaluate(CLEAR_APPLIED));

    /** `topPx` is a document-space offset, not a viewport one: page 2 of a share set is captured at the
     *  y its slice record carries, with `captureBeyondViewport` doing the reaching. Left at 0 for every
     *  single-box artefact, which is what keeps an og image or a plate byte-identical to the one the
     *  `/1` worker produced for the same document. */
    const capture = (format, box, { topPx = 0 } = {}) => serialised(() => page.cdp('Page.captureScreenshot', {
      format,
      ...(format === 'webp' ? { quality: WEBP_QUALITY } : {}),
      clip: { x: 0, y: topPx, width: box.width, height: box.height, scale: 1 },
      captureBeyondViewport: true,
    }).then((r) => Buffer.from(r.data, 'base64')));

    /** Bytes → ceiling → dimension read-back → disk → digests. The dimension check is not paranoia
     *  about Chromium: §5's contract is a *box*, and a 1199×630 file is a different artefact wearing
     *  the same content digest. For a PDF the read-back is the `/MediaBox` the producer wrote and the
     *  `/Count` in its page tree, which is the same idea applied to the one artefact kind that states
     *  its own size. The gate is checked here, at the one point where bytes would reach a filesystem,
     *  so a render whose caller already got `render-timeout` cannot leave a file behind. */
    const writeArtefact = async ({
      kind, variant, format, pageNumber, box, bytes, derivation, gate,
    }) => {
      if (gate.expired) {
        return { ok: false, reason: 'render-timeout', deadline_ms: renderDeadlineMs, wrote: false };
      }
      // The plate's ceiling is a fact about the artefact kind, not about its encoding: §11.4 caps a QR
      // at 1 MiB because a printed code has no business being a megabyte of pixels, and reading the PNG
      // ceiling for one would let a 3 MiB plate pass as "under the limit for its format".
      const ceiling = withinByteCeiling(bytes, kind === 'qr' ? 'qr' : format);
      if (ceiling.ok === false) {
        return { ok: false, reason: ceiling.reason, bytes: ceiling.bytes, ceiling: ceiling.ceiling };
      }
      if (format === 'pdf') {
        // A PDF has no IHDR, so its "did I get the box I asked for" question is answered by the
        // `/MediaBox` the producer wrote — which is the browser's own account of the sheet, not this
        // worker's request. Compared exactly: `PDF_MEDIA_BOX_PT` holds the numbers Chrome answers with
        // (`q9-logs/pdf-controls2-measured.txt` P1, five decimal places on both papers), so a future
        // producer that rounds differently has changed the artefact and should say so in a refusal
        // rather than be absorbed by a tolerance.
        const expected = PDF_MEDIA_BOX_PT[variant];
        if (expected === undefined) return { ok: false, reason: 'pdf-paper-unknown', variant };
        const pdf = readPdfStructure(bytes);
        if (pdf.ok === false) return { ok: false, reason: pdf.reason };
        if (pdf.mediaBoxes.length !== 1
          || pdf.mediaBoxes[0].widthPt !== expected.width
          || pdf.mediaBoxes[0].heightPt !== expected.height) {
          return {
            ok: false,
            reason: 'pdf-box-mismatch',
            expected: `${expected.width}x${expected.height}`,
            found: pdf.mediaBoxes.map((b) => `${b.widthPt}x${b.heightPt}`).join(', ') || 'none',
          };
        }
        if (pdf.pageCount > MAX_PDF_PAGES) {
          // §5's bounded sheet count. Refusing rather than clipping is what makes "the whole
          // invitation, paginated" and "a truncated invitation" two different answers.
          return { ok: false, reason: 'too-many-pages', pages: pdf.pageCount, ceiling: MAX_PDF_PAGES };
        }
      } else {
        const dims = imageDimensions(bytes, format);
        if (dims.ok === false) return { ok: false, reason: `image-header-${dims.reason}` };
        if (dims.width !== box.width || dims.height !== box.height) {
          return {
            ok: false,
            reason: 'artefact-box-mismatch',
            expected: `${box.width}x${box.height}`,
            found: `${dims.width}x${dims.height}`,
          };
        }
      }
      const name = `${kind}_${variant}_p${pageNumber}.${format}`;
      const path = join(outputDir, name);
      writeFileSync(path, bytes);
      const configInputs = {
        worker: WORKER_VERSION,
        engine: ENGINE_TAG,
        browser: browserRecord(browser.version),
        pin: { validated_against: pin.major, accepted_unknown: pinCheck.acceptedUnknown },
        styles,
        fonts: provenance.digest,
        encoder: { png: 'chromium', webp_quality: WEBP_QUALITY },
        kind,
        variant,
        format,
        page_number: pageNumber,
        box: { width: box.width, height: box.height, dpr: box.dpr },
        ...derivation,
      };
      return {
        ok: true,
        name,
        path,
        bytes: bytes.length,
        content_digest: sha256Hex(bytes),
        render_config_hash: sha256Hex(Buffer.from(canonicalJson(configInputs), 'utf8')),
        config_inputs: configInputs,
      };
    };

    const parseGate = (dto) => {
      const parsed = parseInvitationObject(dto);
      return parsed === null
        ? { ok: false, reason: 'invitation-refused' }
        : { ok: true, invitation: parsed, source_dto_digest: dtoDigest(parsed) };
    };

    return {
      version: browser.version,
      pin: { validated_against: pin.major, ...pinCheck },
      capabilities,
      fonts: provenance,
      styles,
      outputDir,

      /** 1200×630 teaser: §5's "never a complete document", produced by the ladder in
       *  `outputGeometry.ts` and applied here against the real measured height.
       *
       *  `applied_dom` travels in every outcome, including a refusal: the ladder's arithmetic is pinned
       *  by a unit battery, but "the title and the first ceremony were still painted under the plan
       *  that was tried last" is a fact about a layout, and an artefact record that cannot say which
       *  stamps it hid is a record an output tier has to take on trust. */
      async renderOgTeaser({ dto }) {
        const parsed = parseGate(dto);
        if (parsed.ok === false) return parsed;
        return withDeadline(async (deadline) => {
          await serialised(() => page.viewport({
            width: OG_BOX.width, height: OG_BOX.height, dpr: OG_BOX.dpr, mobile: false }));
          const mounted = await mount({ surface: OG_BOX.surface, dto });
          if (mounted.ok === false) return mounted;
          try {
            const documentLead = await serialised(() => page.evaluate(RENDERED_LEAD));
            if (typeof documentLead !== 'number' || !Number.isFinite(documentLead)) {
              return { ok: false, reason: 'height-not-measurable' };
            }

            let applied = null;
            const fit = await planOgFit(documentLead, (plan) =>
              applyPlanAndMeasure(plan).then((measured) => {
                if (measured.ok === false) return Number.NaN;
                applied = {
                  plan,
                  width_px: measured.widthPx,
                  height_px: measured.heightPx,
                  hidden: measured.hidden,
                  protected: measured.protected,
                };
                return measured.heightPx;
              }));

            const derivation = {
              fit_plan: fit.ok === true
                ? { lead_px: fit.plan.leadPx, dropped: fit.plan.dropped }
                : null,
              measured_height_px: fit.ok === true ? fit.measuredHeightPx : null,
              document_lead_px: documentLead,
              applied_dom: applied,
            };
            if (fit.ok === false) return { ...fit, ...derivation };
            if (fit.measuredHeightPx > OG_BOX.height) {
              return {
                ok: false, reason: 'plan-says-fit-but-measurement-did-not',
                ...derivation,
              };
            }

            const box = { width: OG_BOX.width, height: OG_BOX.height, dpr: OG_BOX.dpr };
            const png = await capture('png', box);
            const webp = await capture('webp', box);
            state.renders += 1;

            const artefacts = [];
            for (const [format, bytes] of [['png', png], ['webp', webp]]) {
              const written = await writeArtefact({
                kind: 'og_image',
                variant: `${OG_BOX.width}x${OG_BOX.height}`,
                format,
                pageNumber: 1,
                box,
                bytes,
                derivation,
                gate: deadline,
              });
              if (written.ok === false) return { ...written, ...derivation };
              artefacts.push(written);
            }
            return {
              ok: true,
              kind: 'og_image',
              source_dto_digest: parsed.source_dto_digest,
              ...derivation,
              artefacts: artefacts.map(({ config_inputs, ...row }) => row),
              config_inputs: artefacts[0].config_inputs,
            };
          } finally {
            // Undo the plan even on a path that threw, so the next document is not measured at this
            // one's lead. `renderOgTeaser` is the only method that writes the article's style, and a
            // `finally` is what makes "the page is clean before the next render" true without each
            // return path having to remember it.
            await clearApplied().catch(() => undefined);
          }
        });
      },

      /** Measurement only: the same page script the share route runs, handed to the output tier so the
       *  break rule can be checked against the drawn document instead of against this file's arithmetic.
       *  "Never inside a ceremony, never between a heading and its block" is a claim about a layout, and
       *  the tier is the place that has to be able to witness it — including the failure mode where the
       *  renderer's stamps drift and the collector silently offers no candidates at all, which would make
       *  every restraint check pass on an empty list. No capture, no bytes, no file. */
      async measureShareLayout({ dto }) {
        const parsed = parseGate(dto);
        if (parsed.ok === false) return parsed;
        return withDeadline(async () => {
          await clearApplied();
          await serialised(() => page.viewport({
            width: SHARE_WIDTH, height: 1350, dpr: 1, mobile: false }));
          const mounted = await mount({ surface: 'share', dto });
          if (mounted.ok === false) return mounted;
          return await serialised(() => page.evaluate(SHARE_LAYOUT));
        });
      },

      /** 1080-wide share image: the whole document at the host's own lead size, into the smallest of §5's
       *  four quantised boxes that holds it — and when none does, into a set of pages that between them
       *  *are* the whole document. §5 states the rule and the reason for it ("content taller than the
       *  last box continues onto a second page of the same set … Never cropped"), and `variant` +
       *  `page_number` exist as separate manifest columns (§7) precisely so a set is N records of one
       *  shape rather than one truncated record.
       *
       *  So `paginate` out of `chooseShareBox` is no longer an answer a caller receives: it is the signal
       *  to measure the document's legal cuts and run the arithmetic in `chooseShareSlices`. What a caller
       *  can still receive instead of files is a *named* refusal — `too-many-pages` past §5's ceiling of
       *  four, or `unbreakable-content` when one ceremony that must stay whole is taller than a page —
       *  and both leave nothing on disk.
       *
       *  Every page of a set is cut at the same box (`SHARE_PAGE_HEIGHT_PX`, the tallest rung), including
       *  the last one even when its content is shorter: a set is swiped through as one thing, and the
       *  strip under short content is the paper token the harness already paints, not a colour this file
       *  invents (measured at `q9-logs/share-pagination-measured.txt`: the canvas foot of a 2160 box
       *  under a 903 px article is `rgb(255, 246, 240)` — `paper` — at both sampled rows). */
      async renderShareImage({ dto }) {
        const parsed = parseGate(dto);
        if (parsed.ok === false) return parsed;
        return withDeadline(async (deadline) => {
          await clearApplied();
          await serialised(() => page.viewport({
            width: SHARE_WIDTH, height: 1350, dpr: 1, mobile: false }));
          const mounted = await mount({ surface: 'share', dto });
          if (mounted.ok === false) return mounted;
          const layout = await serialised(() => page.evaluate(SHARE_LAYOUT));
          if (layout.ok === false) return { ok: false, reason: layout.reason };

          let slices;
          const single = chooseShareBox(layout.contentHeightPx);
          if (single.ok === true) {
            slices = [{ pageNumber: 1, topPx: 0, bottomPx: layout.contentHeightPx, box: single.box }];
          } else {
            const paginated = chooseShareSlices(
              layout.breaks.map((candidate) => candidate.px),
              layout.contentHeightPx,
            );
            if (paginated.ok === false) {
              return {
                ...paginated,
                kind: 'share_image',
                content_height_px: layout.contentHeightPx,
                width_px: SHARE_WIDTH,
                break_candidates: layout.breaks.length,
              };
            }
            slices = paginated.slices;
          }

          const pageBox = { width: slices[0].box.width, height: slices[0].box.height, dpr: 1 };
          await serialised(() => page.viewport({ ...pageBox, mobile: false }));

          const derivation = {
            fit_plan: null,
            content_height_px: layout.contentHeightPx,
            quantised_box: `${pageBox.width}x${pageBox.height}`,
            page_count: slices.length,
          };
          const artefacts = [];
          const writtenPaths = [];
          for (const slice of slices) {
            const png = await capture('png', pageBox, { topPx: slice.topPx });
            const webp = await capture('webp', pageBox, { topPx: slice.topPx });
            const record = {
              ...derivation,
              page_number: slice.pageNumber,
              page_top_px: slice.topPx,
              page_bottom_px: slice.bottomPx,
            };
            for (const [format, bytes] of [['png', png], ['webp', webp]]) {
              const written = await writeArtefact({
                kind: 'share_image',
                variant: `${pageBox.width}x${pageBox.height}`,
                format,
                pageNumber: slice.pageNumber,
                box: pageBox,
                bytes,
                derivation: record,
                gate: deadline,
              });
              if (written.ok === false) {
                // A set arrives whole or not at all. Page 1 of a three-page document that failed on page
                // 3 would sit on disk under a record the caller never got, which is §11.4's "never a
                // silent loss" read from the other side; these are the exact paths this route wrote, in
                // this call, and nothing else. R-H drives the route past its deadline only on page one,
                // so this loop has never yet had a file it needed to remove.
                for (const path of writtenPaths) rmSync(path);
                return { ...written, ...record };
              }
              writtenPaths.push(written.path);
              artefacts.push(written);
            }
          }
          state.renders += 1;

          return {
            ok: true,
            kind: 'share_image',
            source_dto_digest: parsed.source_dto_digest,
            ...derivation,
            page_breaks_px: slices.map((slice) => slice.bottomPx),
            artefacts: artefacts.map(({ config_inputs, ...row }) => row),
            config_inputs: artefacts[0].config_inputs,
          };
        });
      },

      /** The whole document on paper: §5's paginated sheet, at the host's own lead size, with nothing
       *  scaled and nothing dropped — the same restraint the share image obeys, for the same reason.
       *
       *  The paper is stated in inches to the browser and read back in points from the file, because
       *  those are two different facts: `pdfPrintParams(paper)` is the request, `PDF_MEDIA_BOX_PT` is
       *  the answer Chrome 155 gives to that request, and the guard in `writeArtefact` compares the
       *  answer against the latter so a mismatch refuses rather than delivering a differently-sized
       *  sheet (`q9-logs/pdf-controls2-measured.txt` P1: A4 comes out 595.91998 × 841.91998 pt —
       *  0.227 mm wider than nominal, from both the exact metric inches and the rounded 8.27 × 11.69).
       *
       *  No device-metrics reset happens here, and that is a measurement rather than an omission: the
       *  raster path leaves a viewport override on this page, so the obvious defence was to clear it
       *  before printing. It changes nothing. Printing the same document with a 1200×630 override
       *  active, after clearing, and again after a 1080×2160 override produced byte-identical one-pagers
       *  and the same `/Count 5` for the five-page one — 0 differing bytes across every state, at both
       *  document lengths (`q9-logs/pdf-override-measured.txt`, `q9-logs/pdf-override-long-measured.txt`).
       *  `Page.printToPDF` lays out against the paper it is given. A `clearDeviceMetricsOverride` call
       *  whose stated reason the browser contradicts would be superstition in worker clothing, and it
       *  would also widen §6.4's capability list with a method this stage's contract does not depend on. */
      async renderPdf({ dto, paper }) {
        if (isPaperVariant(paper) === false) {
          return { ok: false, reason: 'paper-variant-unknown', paper: String(paper) };
        }
        const parsed = parseGate(dto);
        if (parsed.ok === false) return parsed;
        return withDeadline(async (deadline) => {
          await clearApplied();
          const mounted = await mount({ surface: 'pdf', dto });
          if (mounted.ok === false) return mounted;
          const printed = await serialised(() => page.cdp('Page.printToPDF', pdfPrintParams(paper)));
          const bytes = Buffer.from(printed.data, 'base64');
          const structure = readPdfStructure(bytes);
          state.renders += 1;

          // Two shapes, split on whether the field can move while the document does not. Everything in
          // `derivation` is hashed into `render_config_hash`, so it holds the file's geometry, its font
          // structure and its page count — the facts that say *this* artefact came from *this*
          // arithmetic. The creation stamps cannot go in there: `readPdfStructure` reads them because
          // §13's determinism check has to normalise them, and a timestamp inside a staleness hash
          // would mark every PDF stale the second it was printed. `pdf_metadata` therefore travels in
          // the record and not in the digest.
          const derivation = {
            fit_plan: null,
            paper,
            print_params: pdfPrintParams(paper),
            pdf: {
              media_box: structure.mediaBoxes,
              page_count: structure.pageCount,
              fonts: structure.fonts,
              tagged: structure.tagged,
              has_document_id: structure.hasDocumentId,
              // A count, not the addresses: §11.7 keeps a URL out of every place the product writes
              // except the artefact that needs it, and the output tier that has to prove the
              // annotations are public reads them out of the file itself.
              link_annotations: structure.linkTargets.length,
            },
          };
          if (structure.ok === false) {
            return { ...structure, ...derivation, pdf_metadata: null };
          }

          const expected = PDF_MEDIA_BOX_PT[paper];
          const written = await writeArtefact({
            kind: 'pdf',
            variant: paper,
            format: 'pdf',
            pageNumber: 1,
            box: { width: expected.width, height: expected.height, dpr: 1 },
            bytes,
            derivation,
            gate: deadline,
          });
          if (written.ok === false) return { ...written, ...derivation };
          return {
            ok: true,
            kind: 'pdf',
            paper,
            source_dto_digest: parsed.source_dto_digest,
            ...derivation,
            pdf_metadata: {
              producer: structure.producer,
              dates: structure.dates,
              has_document_id: structure.hasDocumentId,
            },
            artefacts: [written].map(({ config_inputs, ...row }) => row),
            config_inputs: written.config_inputs,
          };
        });
      },

      /** A plate is not a document: the request carries no DTO, the harness's own door turns the address
       *  into geometry, and every §9.3 refusal (a `/g/` door, a private origin, a query string, an
       *  unknown variant) arrives as the *harness's* refusal reason rather than a second copy of that
       *  rule written here. */
      async renderQrPlate({ variant, target }) {
        return withDeadline(async (deadline) => {
          const mounted = await mount({ surface: QR_SURFACE, variant, target });
          if (mounted.ok === false) return mounted;
          const canvas = await serialised(() => page.evaluate(CANVAS_BOX));
          if (canvas.ok === false) return canvas;
          // §5's plate is drawn at an exact integer module scale, so an intrinsic size that disagrees
          // with its CSS size means the canvas was *scaled*, which is the failure mode a printed code
          // cannot survive. Read back, not assumed.
          if (canvas.intrinsicWidth !== canvas.intrinsicHeight
            || Math.abs(canvas.cssWidthPx - canvas.intrinsicWidth) > 0.5
            || Math.abs(canvas.cssHeightPx - canvas.intrinsicHeight) > 0.5) {
            return { ok: false, reason: 'plate-not-integer-box', ...canvas };
          }
          const box = {
            width: Math.round(canvas.intrinsicWidth),
            height: Math.round(canvas.intrinsicHeight),
            dpr: 1,
          };
          await serialised(() => page.viewport({ ...box, mobile: false }));
          const png = await capture('png', box);
          state.renders += 1;
          const derivation = {
            fit_plan: null,
            plate_pixels: box.width,
            // §11.7: the address belongs in this PNG's pixels and nowhere else, so the record carries a
            // digest of it rather than the string.
            target_url_digest: sha256Hex(Buffer.from(target, 'utf8')),
          };
          const written = await writeArtefact({
            kind: 'qr',
            variant: String(variant),
            format: 'png',
            pageNumber: 1,
            box,
            bytes: png,
            derivation,
            gate: deadline,
          });
          if (written.ok === false) return { ...written, ...derivation };
          return {
            ok: true,
            kind: 'qr',
            variant: String(variant),
            source_dto_digest: null,
            ...derivation,
            artefacts: [written].map(({ config_inputs, ...row }) => row),
            config_inputs: written.config_inputs,
          };
        });
      },

      async networkLog() { return page.networkLog(); },

      async close() {
        if (state.closed) return { profileRemoved: false, renders: state.renders };
        state.closed = true;
        const closed = await browser.close();
        return { ...closed, renders: state.renders };
      },
    };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}
