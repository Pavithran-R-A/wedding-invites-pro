#!/usr/bin/env node
// VIVAAHVARNAM — Stage 9 §5/§6.4/§11/§13 tier: drive the render worker against real Chromium.
//
// Why this file exists. `src/test/outputGeometry.test.ts` pins the ladder's *arithmetic* — a pure
// function over a number someone else measured. Nothing there proves the three things this tier is
// about: that a real browser answers the CDP calls §6.4 pins, that the plan the ladder proposes is
// physically satisfiable on the canvas it names (a 1200×630 teaser whose measured article is 1,400 px
// tall is a defect no unit test can see), and that the bytes that come out are the bytes the record
// describes. §13's L3 claim — re-rendering the same tuple yields the same SHA-256 — is only worth
// anything measured across two browser processes, not twice inside one.
//
// What it asserts and what it deliberately does not:
//   * It asserts a refusal produced **no file**, every time, by diffing the output directory rather
//     than by believing a return value. That is the whole of §5's "never cropped": the interesting
//     failure is a teaser that quietly becomes a partial document.
//   * It asserts the drop order was honoured *structurally* (a prefix of `OG_DROP_ORDER`, never an
//     arbitrary set, and nothing hidden that the plan did not authorise) and that the title and the
//     first drawn ceremony still **paint** under every plan the ladder proposed. Which rung first
//     fits is a fact about Chromium's line breaking, so the tier reads that off the page instead of
//     hard-coding a px height a font update would move for the wrong reason.
//   * It does not check paper, PDF embedding, pagination or Indic glyph coverage — §6.3 and the second
//     half of §5, which are the next slice. Share content taller than the last quantised box is
//     asserted to come back as `paginate` with no artefact, which is this slice's honest boundary.
//   * The credential assertions are split the way §11.7 requires: a token-shaped string may appear in
//     exactly one place, the `qr` plate's pixels, and nowhere in a filename, record, request, header
//     or the report this tier writes. The same pass asserts the render session carried no JWT-shaped
//     header value at all, which is §6's "never expose a service-role credential in browser
//     JavaScript" read as bytes on the wire rather than as a code review.
//
// Usage:
//   npm run build                     (the tier renders dist/render.html; it never builds)
//   node scripts/stage9-render-raster.mjs
//
// Env: STAGE9_PREVIEW_ORIGIN (default http://127.0.0.1:4173), STAGE9_EVIDENCE_DIR,
//      STAGE5_CHROME — the last forwarded to the Stage 5 driver.
// Exit 1 = a finding; 2 = the harness, the browser or the origin made the tier unrunnable.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BYTE_CEILINGS,
  OG_BOX,
  OG_DROP_ORDER,
  OG_FIT,
  SHARE_HEIGHTS,
  SHARE_WIDTH,
} from '../src/render/outputGeometry.ts';
import {
  RENDER_CAPABILITY_CALLS,
  WORKER_VERSION,
  browserMajor,
  checkBrowserPin,
  imageDimensions,
  openRenderWorker,
  readBrowserPin,
  withinByteCeiling,
} from './stage9-render-worker.mjs';
import { guestInvitation } from '../src/test/invitationFixture.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = process.env.STAGE9_PREVIEW_ORIGIN ?? 'http://127.0.0.1:4173';
const RUN_TAG = `s9-raster-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const EVIDENCE_DIR = resolve(process.env.STAGE9_EVIDENCE_DIR ?? join(ROOT, '..', 'q9-logs'));
const SCRATCH = join(EVIDENCE_DIR, RUN_TAG);
mkdirSync(SCRATCH, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** A §9.3-shaped public address that is not a live capability: the token is derived from this tier's
 *  own run tag, so a rerun asks for a different plate and nothing here can be scanned into somebody's
 *  wedding. */
const credential = createHash('sha256')
  .update(`s9-raster-target:${RUN_TAG}`).digest('base64url').slice(0, 43);
const PUBLIC_TARGET = `https://vivaahvarnam.example/i/${credential}`;

// --------------------------------------------------------------------- reporting

const findings = [];
const lines = [];
// Two masks, in this order, because they are answering different questions.
//
// The exact value first: this tier's own credential is the one secret it created, and redacting it is
// not optional. §11.7's requirement is a property of the report's bytes, so it is also checked as one
// — after the run, `report.txt` is grepped for this string, and a masking rule that only rewrote
// *shaped* text would not be the guarantee.
//
// The shaped sweep is a canary for secrets this tier did not create (another run's token arriving in
// a header value or an error message). It deliberately skips runs made only of lowercase letters,
// digits and hyphens: three of this file's own check ids are exactly 43 such characters
// (`only-plate-artefacts-came-from-the-qr-route` among them), and redacting a failing assertion's name
// would turn a finding into an unreadable line — which is how a privacy rule ends up hiding the very
// result it was written to protect. A base64url credential carries an upper-case letter, a digit or an
// underscore with overwhelming probability, so the skipped shape is an identifier rather than a secret.
const TOKEN_SHAPED = /(^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
const mask = (text) => String(text)
  .split(credential).join('<credential>')
  .replace(TOKEN_SHAPED, (match, lead) => (/[A-Z0-9_]/.test(match.slice(lead.length))
    ? `${lead}<credential>` : match));
const say = (text) => { const out = mask(text); lines.push(out); console.log(out); };
const check = (id, ok, detail) => {
  say(`${ok ? 'PASS' : 'FINDING'} ${id}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) findings.push(`${id}${detail === undefined ? '' : `: ${mask(detail)}`}`);
};
const measured = (label, value) => say(`  ${label}: ${mask(value)}`);

/** Every artefact the worker wrote, by name, so "a refusal produced no file" is a statement about the
 *  directory rather than about a return value the tier chose to believe. */
const listArtefacts = (dir) => (existsSync(dir) ? readdirSync(dir) : []).filter(
  (name) => !name.startsWith('.'));
/** A directory snapshot keyed by name, whose value describes the **bytes** behind that name.
 *
 *  Fingerprints rather than a name set, because artefacts are named `kind_box_pN.format`: every teaser
 *  in this tier answers the same 1200×630 page-one box, so a refusal that wrongly wrote a file would
 *  *overwrite* a name that is already on disk, and a name-only diff would report "nothing added" for a
 *  file that was very much written. "A refusal produced no file" is §5's central promise, so the
 *  instrument behind it has to notice a replacement as well as an arrival. */
const fingerprints = (dir) => new Map(listArtefacts(dir).map((name) => {
  const bytes = readFileSync(join(dir, name));
  return [name, `${bytes.length}:${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`];
}));
const writtenSince = (dir, before) => {
  const now = fingerprints(dir);
  return [...now.keys()].filter((name) => now.get(name) !== before.get(name));
};

// --------------------------------------------------------------------- documents

const clone = (value) => JSON.parse(JSON.stringify(value));
const prose = (seed, blocks) => Array.from(
  { length: blocks }, (unused, index) => `${seed} ${index + 1}`).join('\n');

/** A no-pack document with all four prose slots filled and `eventCount` ceremonies, built through the
 *  shared fixture's own `draft` parameter rather than by editing keys afterwards: a v2 document writes
 *  a host's words **twice** — once as the flat `welcome`/`closing` keys and again as the `host` body of
 *  the section whose `host_field` names them (`src/test/invitationFixture.ts:26-37`). A helper that
 *  wrote only the flat copy would render a one-line document and the tier's "must overflow" case would
 *  quietly become a "fits at the host's own lead" case.
 *
 *  `addressLines` re-writes each ceremony's venue directions as that many separate lines. It exists
 *  for the teaser's refusal case: the drop order can give up prose, later ceremonies and the people
 *  block, but the *first* ceremony is §5's undroppable content, so a document whose own address block
 *  is taller than the canvas is the only honest way to reach `teaser-does-not-fit` in a real layout.
 *  The public DTO parser sets no length ceiling on host text (the authoring bounds are the database's,
 *  and the harness deliberately re-uses a guest's parser rather than inventing a render-shaped one),
 *  so this is content the pipeline can be handed — which is exactly why the refusal has to exist. */
const longDocument = ({ blocks = 1, eventCount = 2, lead = 24, addressLines = 0 } = {}) => {
  const document = clone(guestInvitation({
    language: 'ta',
    draft: {
      welcome: prose('with the blessings of our elders,', blocks),
      family_introduction: prose('we invite you to share in the joy of', blocks),
      event_notes: prose('please arrive a half hour before the muhurtham,', blocks),
      closing: prose('with love from the families of', blocks),
    },
  }));
  document.style.fontSize = String(lead);
  const base = clone(document.events[0]);
  document.events = Array.from({ length: eventCount }, (unused, index) => ({
    ...base,
    event_key: `muhurtham_${index + 1}`,
    display_name: `Ceremony ${index + 1}`,
    starts_at_local: `${index % 2 === 0 ? '2026-11-14' : '2026-11-15'}T07:30:00`,
    ends_at_local: `${index % 2 === 0 ? '2026-11-14' : '2026-11-15'}T09:00:00`,
    venue: {
      ...base.venue,
      name: `Sri Kanchi Mahal ${index + 1}`,
      address_text: addressLines === 0
        ? base.venue.address_text
        : Array.from({ length: addressLines },
          (unusedLine, line) => `Directions line ${line + 1}`).join('\n'),
    },
  }));
  return document;
};

/** The two facts §5 refuses to trade away, read out of the DOM evidence every teaser render carries:
 *  nothing was hidden that the plan did not ask for, and the title and first ceremony still paint. */
const planAuthorisesEveryHiddenStamp = (result) => result.applied_dom !== null
  && result.applied_dom.hidden.every((entry) => result.fit_plan.dropped.includes(entry.drop));
const protectedStillPainted = (applied) => applied !== null
  && applied.protected.length === 2
  && applied.protected.every((entry) => entry.present === true && entry.painted === true);

/** Every drop the plan named hid at least one real element.
 *
 *  This is the check that keeps the drop table honest in a way no unit test can: each selector is
 *  written against elements the renderer stamps, and the failure mode of a drifted stamp — a compound
 *  selector written with a space, a `data-render-kind` that moved to a different element — is a drop
 *  that matches nothing. Such a ladder still measures, still walks its order, still answers a reason,
 *  and never gives up the content it claims to have given up. The DOM's own list of what went
 *  `display: none` is the only witness. */
const everyPlannedDropHidANode = (applied) => applied !== null
  && applied.plan.dropped.every((id) => applied.hidden.some((entry) => entry.drop === id));

// --------------------------------------------------------------------- pure gates (no browser)

say(`# ${RUN_TAG} — Stage 9 render worker, real Chromium`);
say(`origin ${ORIGIN} · node ${process.version} · ${WORKER_VERSION}`);
say('');

say('## R-A. the pin and the arithmetic the worker refuses on, before any browser starts');
{
  const docText = readFileSync(join(ROOT, 'docs', 'architecture', 'render-outputs.md'), 'utf8');
  const pin = readBrowserPin(docText);
  check('pin-line-present', pin.ok === true, pin.ok ? `validated_against ${pin.major}` : pin.reason);
  check('pin-line-missing-is-a-refusal', readBrowserPin('the browser section, prose only').reason
    === 'pin-line-missing');
  check('pin-mismatch-refuses', checkBrowserPin(
    { Browser: 'Chrome/999.0.0.0' }, pin.major, false).reason === 'browser-major-unvalidated');
  const accepted = checkBrowserPin({ Browser: 'Chrome/999.0.0.0' }, pin.major, true);
  check('explicit-accept-travels-in-the-record',
    accepted.ok === true && accepted.acceptedUnknown === true);
  check('matching-major-is-not-an-unknown', checkBrowserPin(
    { Browser: `Chrome/${pin.major}.0.8059.40` }, pin.major, false).acceptedUnknown === false);
  check('unparsable-version-refuses', browserMajor('Chrome').ok === false
    && browserMajor('').ok === false && browserMajor(null).ok === false);

  // §11.2's loopback bound, proven on the way in: a worker pointed at a hosted origin must refuse
  // before it launches a browser, so "this instrument cannot reach somebody's deployment" is not a
  // promise about operator good behaviour.
  let refusedOrigin = null;
  await openRenderWorker({ origin: 'https://example.com', outputDir: join(SCRATCH, 'nope') })
    .catch((error) => { refusedOrigin = String(error.message ?? error); });
  check('non-loopback-origin-refuses-before-a-browser',
    refusedOrigin !== null && /not loopback/.test(refusedOrigin), refusedOrigin ?? '(it started)');

  // §11.4's byte ceiling, exercised on fabricated bytes: the bound is arithmetic, and manufacturing a
  // five-megabyte raster to prove the arithmetic would only prove Chromium can write a big file.
  check('ceiling-accepts-under-and-refuses-over', withinByteCeiling(
    Buffer.alloc(BYTE_CEILINGS.png - 1), 'png').ok === true
    && withinByteCeiling(Buffer.alloc(BYTE_CEILINGS.png + 1), 'png').reason === 'bytes-over-ceiling'
    && withinByteCeiling(Buffer.alloc(BYTE_CEILINGS.qr + 1), 'qr').reason === 'bytes-over-ceiling'
    && withinByteCeiling(Buffer.alloc(10), 'gif').reason === 'format-unknown');

  // The header readers are checked against real bytes before they are trusted to certify a screenshot.
  const pngBytes = Buffer.alloc(24);
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach((byte, index) => { pngBytes[index] = byte; });
  pngBytes.write('IHDR', 12, 'ascii');
  pngBytes.writeUInt32BE(1200, 16);
  pngBytes.writeUInt32BE(630, 20);
  check('png-header-reader', imageDimensions(pngBytes, 'png').width === 1200
    && imageDimensions(pngBytes, 'png').height === 630
    && imageDimensions(Buffer.alloc(24), 'png').reason === 'png-signature');

  // `VP8X` keeps its canvas size in three-byte little-endian fields at payload+4 and payload+7, and
  // each one is one-less-than-the-true — the same off-by-one the reader has to get right. Payload
  // starts at 20 here (12 + the 8-byte chunk header), so a fabricated buffer aimed at any other offset
  // would test nothing: both the writer below and the reader above would be wrong in the same way.
  const vp8x = Buffer.alloc(30);
  vp8x.write('RIFF', 0, 'ascii'); vp8x.writeUInt32LE(18, 4); vp8x.write('WEBP', 8, 'ascii');
  vp8x.write('VP8X', 12, 'ascii'); vp8x.writeUInt32LE(10, 16);
  vp8x.writeUIntLE(1079, 24, 3);
  vp8x.writeUIntLE(1349, 27, 3);
  const webpDims = imageDimensions(vp8x, 'webp');
  check('webp-header-reader-vp8x', webpDims.ok === true
    && webpDims.width === 1080 && webpDims.height === 1350, JSON.stringify(webpDims));
  const vp8l = Buffer.alloc(30);
  vp8l.write('RIFF', 0, 'ascii'); vp8l.writeUInt32LE(18, 4); vp8l.write('WEBP', 8, 'ascii');
  vp8l.write('VP8L', 12, 'ascii'); vp8l.writeUInt32LE(10, 16);
  vp8l[20] = 0x2f;
  vp8l.writeUInt32LE((1199 & 0x3fff) | ((629 & 0x3fff) << 14), 21);
  const lossless = imageDimensions(vp8l, 'webp');
  check('webp-header-reader-vp8l', lossless.ok === true
    && lossless.width === 1200 && lossless.height === 630, JSON.stringify(lossless));
  const animated = Buffer.alloc(20);
  animated.write('RIFF', 0, 'ascii'); animated.write('WEBP', 8, 'ascii');
  animated.write('ANIM', 12, 'ascii');
  check('animated-webp-is-not-a-still-artefact',
    imageDimensions(animated, 'webp').reason === 'animated-webp');
}

// --------------------------------------------------------------------- browser tier

const artefactDir = join(SCRATCH, 'artefacts');
const secondDir = join(SCRATCH, 'artefacts-rerun');
const records = [];
const networkLogs = [];
let worker = null;
let impatient = null;
let secondWorker = null;

/** A failed render as the tier reports it: the rule name, plus the worker's `detail` when there is
 *  one. `worker-error` is deliberately generic — §11.5 keeps the caller's bytes out of a log line, so
 *  the reason alone cannot be triaged — and the detail is the CDP or parse message that says which.
 *  `check` masks the token shape on the way in, so printing it costs no privacy. A success returns
 *  `undefined`, which is what keeps a passing line as quiet as it is today. */
const failure = (result) => {
  if (result.ok === true) return undefined;
  const detail = result.detail;
  return detail === undefined || detail === null || detail === ''
    ? String(result.reason)
    : `${result.reason} · ${mask(JSON.stringify(detail))}`;
};

const record = (name, result) => { records.push({ case: name, result }); return result; };

try {
  worker = await openRenderWorker({
    origin: ORIGIN, outputDir: artefactDir, renderDeadlineMs: 60_000, cdpPort: 9421 });

  // ------------------------------------------------------------------- §6.4
  say('');
  say('## R-B. §6.4 the browser is qualified before it draws');
  measured('Browser', worker.version.Browser);
  measured('answered-keys', Object.keys(worker.version).sort().join(','));
  measured('Protocol-Version', worker.version['Protocol-Version']);
  measured('User-Agent', worker.version['User-Agent']);
  measured('pin', `validated_against ${worker.pin.validated_against}`
    + ` · accepted_unknown ${worker.pin.acceptedUnknown}`);
  check('pin-matched-this-browser', worker.pin.ok === true
    && worker.pin.acceptedUnknown === false,
  `${worker.version.Browser} against ${worker.pin.validated_against}`);
  // §4 says a browser upgrade has to be detectable from the record, and the only way it is detectable
  // is if the engine identity in `render_config_hash` is a value rather than a null. An earlier revision
  // of this file printed `Version: undefined` / `Revision: undefined` and passed, because nothing asked
  // whether the fields the worker records were actually answered by the endpoint — so the hash was
  // silently hashing nulls. This asks.
  check('browser-endpoint-answered-identity-fields',
    ['Browser', 'Protocol-Version', 'User-Agent'].every((key) => typeof worker.version[key] === 'string'
      && worker.version[key].length > 0),
  `answered ${Object.keys(worker.version).join(', ')}`);
  // A run that got here had no failed probe (one throws and ends the run), so what this row actually
  // buys is coverage: the six §6.4 names are the six that were answered, in order, none skipped.
  check('all-six-capabilities-answered',
    worker.capabilities.map((row) => row.method).join(',') === RENDER_CAPABILITY_CALLS.join(',')
    && worker.capabilities.every((row) => row.ok === true),
  worker.capabilities.map((row) => `${row.method}=${row.ok ? 'yes' : 'no'}`).join(' '));
  measured('font provenance', `${worker.fonts.faceCount} faces · `
    + `${worker.fonts.byteCount} bytes · ${worker.fonts.digest.slice(0, 16)}…`);
  check('font-provenance-covers-the-pinned-faces', worker.fonts.familyCount === 6
    && worker.fonts.faceCount === 72 && worker.fonts.byteCount > 0);
  check('geometry-file-digest-is-part-of-the-config',
    /^[0-9a-f]{64}$/.test(worker.styles.output_geometry)
    && worker.styles.output_geometry !== worker.styles.render_css);

  // ------------------------------------------------------------------- teaser
  say('');
  say('## R-C. §5 the 1200×630 teaser, and the ladder that has to make it fit');

  // The fixture is the smallest document that still carries the teaser's undroppable content — the
  // title and the first ceremony with its venue directions — because the check below asks for the
  // host's own lead to survive untouched. Measured on this canvas, one prose block in each of the four
  // slots with two ceremonies makes the ladder both shrink and drop (24 px → 22 px plus four drops,
  // 591.9375 px); no prose and one ceremony measures 591.4375 px at the fixture's own 24 px lead,
  // which is inside the 630 px box without moving anything.
  const shortDoc = longDocument({ blocks: 0, eventCount: 1 });
  const teaser = record('teaser-short', await worker.renderOgTeaser({ dto: shortDoc }));
  check('teaser-short-ok', teaser.ok === true, failure(teaser));
  if (teaser.ok) {
    const box = teaser.config_inputs.box;
    check('teaser-short-box', box.width === 1200 && box.height === 630 && box.dpr === 1,
    `${box.width}x${box.height}@${box.dpr}`);
    check('teaser-short-formats', teaser.artefacts.map((row) => row.name).join(',')
      === 'og_image_1200x630_p1.png,og_image_1200x630_p1.webp',
    teaser.artefacts.map((row) => row.name).join(','));
    // The identity above has to reach the artefact, not just the worker's own memory of it.
    check('artefact-config-carries-a-complete-browser-record',
      Object.entries(teaser.config_inputs.browser).every(([, value]) => typeof value === 'string'
        && value.length > 0),
    JSON.stringify(teaser.config_inputs.browser));
    for (const row of teaser.artefacts) {
      const format = row.name.split('.').pop();
      const dims = imageDimensions(readFileSync(row.path), format);
      check(`teaser-short-dimensions-${format}`,
        dims.ok === true && dims.width === 1200 && dims.height === 630,
      `${dims.width ?? dims.reason}x${dims.height ?? ''}`);
      check(`teaser-short-within-ceiling-${format}`, row.bytes <= BYTE_CEILINGS[format],
      `${row.bytes} bytes`);
    }
    check('teaser-short-fits-the-box', teaser.measured_height_px <= OG_BOX.height,
    `measured ${teaser.measured_height_px}`);
    check('teaser-short-keeps-the-hosts-own-lead', teaser.fit_plan.dropped.length === 0
      && teaser.fit_plan.lead_px === teaser.document_lead_px,
    `${teaser.document_lead_px}px → ${teaser.fit_plan.lead_px}px`);
    check('teaser-short-title-and-first-ceremony-painted', protectedStillPainted(teaser.applied_dom),
    JSON.stringify(teaser.applied_dom?.protected ?? null));
    check('teaser-short-dto-digest-shaped', /^[0-9a-f]{64}$/.test(teaser.source_dto_digest));
    // §4 of the architecture doc lists `format` among the `render_config_hash` inputs, so a PNG and a
    // WebP of one invitation are two configurations and must not share a hash.
    const [pngRow, webpRow] = teaser.artefacts;
    check('teaser-formats-have-distinct-config-hashes',
      pngRow.render_config_hash !== webpRow.render_config_hash
      && pngRow.content_digest !== webpRow.content_digest,
    `${pngRow.render_config_hash.slice(0, 12)} vs ${webpRow.render_config_hash.slice(0, 12)}`);
    measured('bytes png / webp', `${pngRow.bytes} / ${webpRow.bytes}`);
    measured('source_dto_digest', teaser.source_dto_digest.slice(0, 20));
  }

  // The scale-before-drop case, engineered rather than guessed. It is the same document as
  // `teaser-short`, from a host who chose the largest lead the product admits (44 px): the ladder then
  // has seven rungs to walk before dropping anything is allowed, and the measured walk uses four of
  // them — 26 px, nothing dropped, 618.984375 px inside the 630 px box. Trying to show the same rule
  // with the fixture's own 24 px lead would need a document that overflows at 24 and fits at 22: one
  // rung of travel, a case a font metrics change turns into either "no scaling needed" or "drop
  // something", and a tier that fails for that reason teaches nothing.
  //
  // The wrong case at the other end would be a document so long that only dropping prose rescues it —
  // that is the `teaser-wordy` case below, and the two must not be confused.
  const tallHost = longDocument({ blocks: 0, eventCount: 1, lead: 44 });
  const scaled = record('teaser-scaled', await worker.renderOgTeaser({ dto: tallHost }));
  check('teaser-scaled-ok', scaled.ok === true, failure(scaled));
  if (scaled.ok) {
    check('teaser-scaled-shrank-the-type-before-losing-a-line',
      scaled.fit_plan.dropped.length === 0 && scaled.fit_plan.lead_px < scaled.document_lead_px,
    `${scaled.document_lead_px}px → ${scaled.fit_plan.lead_px}px, dropped `
      + JSON.stringify(scaled.fit_plan.dropped));
    check('teaser-scaled-landed-on-a-listed-rung', OG_FIT.steps.includes(scaled.fit_plan.lead_px)
      && scaled.fit_plan.lead_px >= OG_FIT.leadFloorPx, `lead ${scaled.fit_plan.lead_px}`);
    check('teaser-scaled-inside-box', scaled.measured_height_px <= OG_BOX.height,
    `measured ${scaled.measured_height_px} at ${scaled.fit_plan.lead_px}px`);
    check('teaser-scaled-title-and-first-ceremony-painted',
      protectedStillPainted(scaled.applied_dom));
    measured('ladder walk', `document ${scaled.document_lead_px} → applied `
      + `${scaled.applied_dom?.plan?.leadPx} · height ${scaled.applied_dom?.height_px}`);
  }

  // A document that must lose lines: 4×40 prose lines do not fit 630 px even at 22 px, and the three
  // prose drops are all removable, so a refusal here is a defect in the ladder rather than a legitimate
  // answer. Which rung and which prefix first fit is Chromium's line breaking, so the tier pins the
  // *shape* of the plan and the parts that must never move.
  const wordy = longDocument({ blocks: 40 });
  const dropped = record('teaser-wordy', await worker.renderOgTeaser({ dto: wordy }));
  check('teaser-wordy-planned-a-drop', dropped.ok === true, dropped.ok
    ? `planned at ${dropped.fit_plan.lead_px}px`
    : `${dropped.reason} · ${JSON.stringify(dropped.detail ?? null)}`);
  if (dropped.ok) {
    const order = OG_DROP_ORDER.map((entry) => entry.id);
    const expectedPrefix = order.slice(0, dropped.fit_plan.dropped.length);
    check('teaser-wordy-drop-order-is-a-prefix',
      JSON.stringify(dropped.fit_plan.dropped) === JSON.stringify(expectedPrefix),
    `dropped ${JSON.stringify(dropped.fit_plan.dropped)} against order ${JSON.stringify(order)}`);
    check('teaser-wordy-dropped-something', dropped.fit_plan.dropped.length > 0);
    check('teaser-wordy-at-the-floor', dropped.fit_plan.lead_px === OG_FIT.leadFloorPx,
    `lead ${dropped.fit_plan.lead_px}`);
    check('teaser-wordy-inside-box', dropped.measured_height_px <= OG_BOX.height,
    `measured ${dropped.measured_height_px}`);
    check('teaser-wordy-hid-nothing-unauthorised',
      planAuthorisesEveryHiddenStamp(dropped),
    JSON.stringify(dropped.applied_dom?.hidden ?? null));
    check('teaser-wordy-every-drop-hid-a-real-element',
      everyPlannedDropHidANode(dropped.applied_dom),
    `${dropped.applied_dom?.hidden?.length ?? null} hidden stamps for `
      + `${dropped.applied_dom?.plan?.dropped?.length ?? null} drops`);
    check('teaser-wordy-title-and-first-ceremony-painted',
      protectedStillPainted(dropped.applied_dom),
    JSON.stringify(dropped.applied_dom?.protected ?? null));
    measured('hidden stamps', JSON.stringify(dropped.applied_dom?.hidden ?? null));
  }

  // The refusal case: content that is *undroppable* by construction. 300 ceremonies are droppable —
  // `later-event-lists` keeps the first drawn one — so what is put past the canvas here is the first
  // ceremony's own venue directions, which §5 names as teaser content and no drop may remove. After
  // scaling to the floor and applying every drop in the order, the document still overflows, and
  // §5's answer is a reason and no file. The alternative is a teaser that quietly stops being an
  // invitation: a screenshot clipped at 630 px would print half a venue address and call it done.
  const enormousFiles = fingerprints(artefactDir);
  const enormous = longDocument({ blocks: 40, eventCount: 300, addressLines: 40 });
  const refused = record('teaser-enormous', await worker.renderOgTeaser({ dto: enormous }));
  check('teaser-enormous-refuses-by-name', refused.ok === false
    && refused.reason === 'teaser-does-not-fit', JSON.stringify({
    ok: refused.ok, reason: refused.reason, lead: refused.document_lead_px,
    height: refused.applied_dom?.height_px ?? null }));
  check('teaser-enormous-tried-every-drop-first',
    refused.applied_dom !== null
    && refused.applied_dom.plan.dropped.length === OG_DROP_ORDER.length,
  JSON.stringify(refused.applied_dom?.plan?.dropped ?? null));
  check('teaser-enormous-every-drop-hid-a-real-element',
    everyPlannedDropHidANode(refused.applied_dom),
  `${refused.applied_dom?.hidden?.length ?? null} hidden stamps for `
    + `${refused.applied_dom?.plan?.dropped?.length ?? null} drops`);
  check('teaser-enormous-wrote-no-file',
    writtenSince(artefactDir, enormousFiles).length === 0,
  writtenSince(artefactDir, enormousFiles).join(','));
  check('teaser-enormous-still-protected-the-title',
    protectedStillPainted(refused.applied_dom),
  JSON.stringify(refused.applied_dom?.protected ?? null));
  measured('refusal height', refused.applied_dom?.height_px);

  // ------------------------------------------------------------------- share
  say('');
  say('## R-D. §5 the share image: four quantised boxes, and pagination as the designed outcome');
  const shareShort = record('share-short',
    await worker.renderShareImage({ dto: longDocument({ blocks: 1 }) }));
  check('share-short-ok', shareShort.ok === true, failure(shareShort));
  if (shareShort.ok) {
    const box = shareShort.config_inputs.box;
    check('share-short-is-1080-wide-and-quantised', box.width === SHARE_WIDTH
      && SHARE_HEIGHTS.includes(box.height), `${box.width}x${box.height}`);
    check('share-short-is-the-smallest-box-that-holds-it',
      box.height === SHARE_HEIGHTS.find((height) => height >= shareShort.content_height_px),
    `content ${shareShort.content_height_px} → box ${box.height}`);
    check('share-short-never-scales-the-host', shareShort.fit_plan === null);
    for (const row of shareShort.artefacts) {
      const format = row.name.split('.').pop();
      const dims = imageDimensions(readFileSync(row.path), format);
      check(`share-short-dimensions-${format}`, dims.ok === true
        && dims.width === box.width && dims.height === box.height,
      `${dims.width ?? dims.reason}x${dims.height ?? ''} for a ${box.height} box`);
    }
    measured('content height / box / png bytes',
      `${shareShort.content_height_px} → ${box.height} · ${shareShort.artefacts[0].bytes}`);
  }

  // Enough content to leave the first box standing but stay inside the ladder of four: three blocks in
  // each of the four prose slots measures 1394.34 px, past 1350 and inside 1620, so the box that comes
  // back has to be a *later* one, and still the earliest that fits. Ten blocks measured 2486.34 px —
  // past the last box, which is `share-tall`'s answer rather than this one.
  const shareMid = record('share-mid',
    await worker.renderShareImage({ dto: longDocument({ blocks: 3 }) }));
  check('share-mid-ok', shareMid.ok === true, failure(shareMid));
  if (shareMid.ok) {
    const box = shareMid.config_inputs.box;
    check('share-mid-took-a-later-box', SHARE_HEIGHTS.indexOf(box.height) > 0,
    `${box.height} for ${shareMid.content_height_px} of content`);
    check('share-mid-box-is-the-earliest-that-fits',
      box.height === SHARE_HEIGHTS.find((height) => height >= shareMid.content_height_px)
      && shareMid.content_height_px > SHARE_HEIGHTS[0],
    `content ${shareMid.content_height_px} → box ${box.height}`);
    check('share-mid-dropped-nothing', shareMid.fit_plan === null);
  }

  // Past the last box the answer is a second page, which this slice does not draw: §5's contract is
  // that the document continues, never that it gets cropped.
  const tallFiles = fingerprints(artefactDir);
  const shareTall = record('share-tall',
    await worker.renderShareImage({ dto: longDocument({ blocks: 60, eventCount: 8 }) }));
  check('share-tall-paginates-instead-of-cropping', shareTall.ok === false
    && shareTall.reason === 'paginate', JSON.stringify({
    ok: shareTall.ok, reason: shareTall.reason, height: shareTall.content_height_px }));
  check('share-tall-content-really-is-past-the-last-box',
    shareTall.content_height_px > SHARE_HEIGHTS[SHARE_HEIGHTS.length - 1],
  `measured ${shareTall.content_height_px} against a ${SHARE_HEIGHTS[SHARE_HEIGHTS.length - 1]} ceiling`);
  check('share-tall-wrote-no-file', writtenSince(artefactDir, tallFiles).length === 0,
  writtenSince(artefactDir, tallFiles).join(','));
  measured('share-tall content height', shareTall.content_height_px);

  const shareEnormous = record('share-enormous',
    await worker.renderShareImage({ dto: longDocument({ eventCount: 300 }) }));
  check('share-enormous-paginates', shareEnormous.ok === false
    && shareEnormous.reason === 'paginate', JSON.stringify({
    ok: shareEnormous.ok, reason: shareEnormous.reason }));

  // ------------------------------------------------------------------- qr
  say('');
  say('## R-E. §5/§9.3 the plate: the same raster route, and §9.3 refusing before pixels exist');
  const plates = {};
  for (const variant of ['25mm', '40mm', '60mm']) {
    const plate = record(`qr-${variant}`, await worker.renderQrPlate({ variant, target: PUBLIC_TARGET }));
    plates[variant] = plate;
    check(`qr-${variant}-ok`, plate.ok === true, failure(plate));
    if (plate.ok) {
      const row = plate.artefacts[0];
      const dims = imageDimensions(readFileSync(row.path), 'png');
      check(`qr-${variant}-square-integer-box`, dims.ok === true
        && dims.width === dims.height && dims.width === plate.plate_pixels,
      `${dims.width}x${dims.height} recorded ${plate.plate_pixels}`);
      check(`qr-${variant}-within-the-plate-ceiling`, row.bytes <= BYTE_CEILINGS.qr,
      `${row.bytes} bytes against ${BYTE_CEILINGS.qr}`);
      check(`qr-${variant}-named-for-its-variant`, row.name === `qr_${variant}_p1.png`, row.name);
      // The record binds the address without repeating it (§11.7): a digest the tier can re-derive,
      // and no copy of the token anywhere in the JSON the worker returned.
      check(`qr-${variant}-record-binds-the-target-by-digest`,
        plate.config_inputs.target_url_digest === sha256Hex(PUBLIC_TARGET),
      plate.config_inputs.target_url_digest?.slice(0, 16));
      check(`qr-${variant}-record-repeats-nothing-of-the-address`,
        !JSON.stringify(plate).includes(credential));
      measured(`qr-${variant} pixels / bytes`, `${dims.width} · ${row.bytes}`);
    }
  }
  // The variant has to be the thing that changes the geometry. Comparing the three measured plates is
  // how the tier says that without re-deriving `canvasPixels` from the variant name — a second
  // opinion about the same pixels is the failure mode §5's one-raster-route rule exists to prevent.
  check('qr-variant-changes-the-plate-size', [plates['25mm'], plates['40mm'], plates['60mm']]
    .every((plate) => plate.ok === true)
    && plates['25mm'].plate_pixels < plates['40mm'].plate_pixels
    && plates['40mm'].plate_pixels < plates['60mm'].plate_pixels,
  ['25mm', '40mm', '60mm'].map((v) => plates[v].plate_pixels).join(' < '));

  const qrFiles = fingerprints(artefactDir);
  const privateDoor = record('qr-private-door', await worker.renderQrPlate({
    variant: '25mm', target: `https://vivaahvarnam.example/g/${credential}` }));
  check('qr-refuses-a-household-door', privateDoor.ok === false
    && privateDoor.reason === 'target-private-door', privateDoor.reason);
  const reviewDoor = record('qr-review-door', await worker.renderQrPlate({
    variant: '25mm', target: `https://vivaahvarnam.example/r/${credential}` }));
  check('qr-refuses-a-family-review-door', reviewDoor.ok === false
    && reviewDoor.reason === 'target-private-door', reviewDoor.reason);
  const httpTarget = await worker.renderQrPlate({
    variant: '25mm', target: `http://vivaahvarnam.example/i/${credential}` });
  check('qr-refuses-a-clear-text-target', httpTarget.ok === false
    && httpTarget.reason === 'target-not-https', httpTarget.reason);
  const badVariant = await worker.renderQrPlate({ variant: '99mm', target: PUBLIC_TARGET });
  check('qr-refuses-an-unknown-variant', badVariant.ok === false
    && badVariant.reason === 'qr-variant-unknown', badVariant.reason);
  const queryTarget = await worker.renderQrPlate({
    variant: '25mm', target: `${PUBLIC_TARGET}?utm=1` });
  check('qr-refuses-a-query-string', queryTarget.ok === false
    && queryTarget.reason === 'target-carries-query', queryTarget.reason);
  const wrongPath = await worker.renderQrPlate({
    variant: '25mm', target: `https://vivaahvarnam.example/household/${credential}` });
  check('qr-refuses-a-path-that-is-not-an-invitation', wrongPath.ok === false
    && wrongPath.reason === 'target-path-shape', wrongPath.reason);
  check('every-plate-refusal-wrote-no-file', writtenSince(artefactDir, qrFiles).length === 0,
  writtenSince(artefactDir, qrFiles).join(','));

  // ------------------------------------------------------------------- §11.1 input door
  say('');
  say('## R-F. §11.1 what the worker will not accept, and what the harness will not draw');
  const brokenFiles = fingerprints(artefactDir);
  const broken = await worker.renderOgTeaser({ dto: { title: 'no such shape' } });
  check('worker-refuses-an-unparseable-dto', broken.ok === false
    && broken.reason === 'invitation-refused', broken.reason);
  check('worker-refusal-wrote-no-file', writtenSince(artefactDir, brokenFiles).length === 0,
  writtenSince(artefactDir, brokenFiles).join(','));

  // A caller that hands over `html`, a stylesheet path or a font name gets the *same invitation*, not
  // a styled one: the digest is over the parsed projection, so equality here is the statement that the
  // extra keys were dropped rather than honoured and then hidden.
  const clean = record('teaser-clean-for-smuggle-compare',
    await worker.renderOgTeaser({ dto: longDocument({ blocks: 1 }) }));
  const smuggled = longDocument({ blocks: 1 });
  smuggled.html = '<script>alert(1)</script>';
  smuggled.stylesheet = 'file:///etc/passwd';
  smuggled.font = 'Comic Sans';
  smuggled.width = 4000;
  const withUnknown = record('teaser-smuggled-fields', await worker.renderOgTeaser({ dto: smuggled }));
  check('unknown-fields-are-dropped-not-honoured', withUnknown.ok === true, failure(withUnknown));
  check('dropping-unknown-fields-does-not-change-the-invitation',
    withUnknown.source_dto_digest === clean.source_dto_digest,
  `${withUnknown.source_dto_digest?.slice(0, 12)} vs ${clean.source_dto_digest?.slice(0, 12)}`);
  check('a-smuggled-width-does-not-change-the-box',
    withUnknown.ok === true && withUnknown.config_inputs.box.width === 1200);

  const hostile = longDocument({ blocks: 1 });
  hostile.title = '"><script>alert(1)</script>';
  const hostileText = record('teaser-hostile-title', await worker.renderOgTeaser({ dto: hostile }));
  check('hostile-markup-in-a-text-slot-still-renders', hostileText.ok === true,
  failure(hostileText));
  check('hostile-title-changes-the-invitation-but-nothing-else',
    hostileText.ok === true && hostileText.source_dto_digest !== clean.source_dto_digest
    && hostileText.config_inputs.box.width === 1200);

  // ------------------------------------------------------------------- §11.4 bounds
  say('');
  say('## R-G. §11.4 bounds: the deadline names a reason and stops a file');
  const deadlineDir = join(SCRATCH, 'deadline');
  impatient = await openRenderWorker({
    origin: ORIGIN, outputDir: deadlineDir, renderDeadlineMs: 1, cdpPort: 9423 });
  const late = record('deadline', await impatient.renderOgTeaser({ dto: longDocument({ blocks: 1 }) }));
  check('deadline-refuses-instead-of-hanging', late.ok === false
    && late.reason === 'render-timeout', JSON.stringify({ ok: late.ok, reason: late.reason }));
  // The caller was answered at 1 ms; the render itself is still running on the serialised chain. The
  // file it would have written has to stay unwritten *after* that work lands, or §11.4's bound is a
  // way of not looking at the artefact rather than a way of not making one.
  await sleep(20_000);
  check('deadline-wrote-nothing-even-after-the-abandoned-render-finished',
    listArtefacts(deadlineDir).length === 0, listArtefacts(deadlineDir).join(','));
  const impatientClose = await impatient.close();
  impatient = null;
  check('deadline-worker-profile-removed', impatientClose.profileRemoved === true,
  impatientClose.profilePath);

  // ------------------------------------------------------------------- §13 L3
  say('');
  say('## R-H. §13 L3: the same tuple re-rendered in-process, then by a second browser process');
  const l3Dto = longDocument({ blocks: 3 });
  const l3First = record('l3-first', await worker.renderOgTeaser({ dto: l3Dto }));
  const l3Second = record('l3-second-in-process', await worker.renderOgTeaser({ dto: l3Dto }));
  const l3Plate = record('l3-plate', await worker.renderQrPlate({
    variant: '40mm', target: PUBLIC_TARGET }));

  networkLogs.push({ whose: 'first worker', entries: await worker.networkLog() });
  const firstClose = await worker.close();
  worker = null;
  measured('first worker profile', String(firstClose.profileRemoved));
  measured('renders on the first worker', firstClose.renders);

  secondWorker = await openRenderWorker({
    origin: ORIGIN, outputDir: secondDir, renderDeadlineMs: 60_000, cdpPort: 9425 });
  const l3Third = record('l3-cross-process', await secondWorker.renderOgTeaser({ dto: l3Dto }));
  const l3PlateAgain = record('l3-plate-cross-process', await secondWorker.renderQrPlate({
    variant: '40mm', target: PUBLIC_TARGET }));
  networkLogs.push({ whose: 'second worker', entries: await secondWorker.networkLog() });
  const secondClose = await secondWorker.close();
  secondWorker = null;
  check('second-worker-profile-removed', secondClose.profileRemoved === true,
  secondClose.profilePath);

  const pngOf = (result) => result.artefacts?.find((row) => row.name.endsWith('.png'));
  const webpOf = (result) => result.artefacts?.find((row) => row.name.endsWith('.webp'));
  if (l3First.ok && l3Second.ok && l3Third.ok && l3Plate.ok && l3PlateAgain.ok) {
    check('l3-same-source-dto', l3First.source_dto_digest === l3Second.source_dto_digest
      && l3Second.source_dto_digest === l3Third.source_dto_digest);
    check('l3-png-bytes-identical-in-process',
      pngOf(l3First).content_digest === pngOf(l3Second).content_digest,
    `${pngOf(l3First).content_digest.slice(0, 16)} vs ${pngOf(l3Second).content_digest.slice(0, 16)}`);
    check('l3-png-bytes-identical-across-processes',
      pngOf(l3First).content_digest === pngOf(l3Third).content_digest,
    `${pngOf(l3First).content_digest.slice(0, 16)} vs ${pngOf(l3Third).content_digest.slice(0, 16)}`);
    check('l3-webp-bytes-identical-across-processes',
      webpOf(l3First).content_digest === webpOf(l3Third).content_digest,
    `${webpOf(l3First).content_digest.slice(0, 16)} vs ${webpOf(l3Third).content_digest.slice(0, 16)}`);
    check('l3-config-hash-identical',
      pngOf(l3First).render_config_hash === pngOf(l3Third).render_config_hash);
    check('l3-plan-identical', JSON.stringify(l3First.fit_plan) === JSON.stringify(l3Third.fit_plan),
    `${JSON.stringify(l3First.fit_plan)} vs ${JSON.stringify(l3Third.fit_plan)}`);
    check('l3-qr-plate-identical-across-processes',
      pngOf(l3Plate).content_digest === pngOf(l3PlateAgain).content_digest,
    `${pngOf(l3Plate).content_digest.slice(0, 16)} vs ${pngOf(l3PlateAgain).content_digest.slice(0, 16)}`);
    measured('png digest', pngOf(l3Third).content_digest.slice(0, 32));
    measured('render_config_hash', pngOf(l3Third).render_config_hash.slice(0, 32));
  } else {
    check('l3-renders-produced-artefacts', false, 'one of the three teaser renders or a plate failed');
  }

  // ------------------------------------------------------------------- §11.2 / §11.7 network
  say('');
  say('## R-I. §11.2/§11.7 the render sessions asked nothing off this machine, and leaked nothing');
  const log = networkLogs.flatMap((whose) => whose.entries);
  const seenBy = networkLogs.map((whose) => `${whose.whose}: ${whose.entries.length}`).join(', ');
  const hosts = [...new Set(log.map((entry) => {
    try { return new URL(entry.url).host; } catch { return 'unparsable'; }
  }))];
  check('requests-were-actually-seen', log.length > 0, seenBy);
  check('every-render-request-is-loopback', hosts.every((host) => host.startsWith('127.0.0.1')
    || host.startsWith('localhost') || host.startsWith('[::1]')), hosts.join(','));
  measured('hosts requested', hosts.join(', ') || '(none)');
  measured('request count', `${log.length} (${seenBy})`);
  const paths = log.map((entry) => {
    try { return new URL(entry.url).pathname; } catch { return entry.url; }
  });
  check('the-harness-document-was-navigated', paths.some((p) => p === '/render.html'),
  paths.filter((p) => p.endsWith('.html')).join(',') || '(none)');
  check('font-files-came-from-self',
    paths.some((p) => p.startsWith('/fonts/')), `${paths.filter((p) => p.includes('.woff')).length} face paths`);
  const headerValues = log.flatMap((entry) => [
    ...Object.values(entry.headers ?? {}), ...Object.values(entry.sentHeaders ?? {})])
    .map(String);
  check('no-request-carried-the-credential', !log.some((entry) => entry.url.includes(credential)
    || headerValues.some((value) => value.includes(credential))));
  // §6's "never expose a service-role credential in browser JavaScript or render output", read as
  // bytes: a Supabase key travels as `apikey`/`Bearer ey…`, and neither belongs in a session whose
  // only input was a value handed to `mount()`.
  check('no-request-carried-a-jwt-or-an-api-key',
    !headerValues.some((value) => /eyJ[A-Za-z0-9_-]{8,}\./.test(value))
    && !log.some((entry) => /apikey|anon|service_role/i.test(entry.url)),
  headerValues.length + ' header values inspected');
  // §11.2's referrer bound, stated as the exact set rather than as an absence, because the absence is
  // not this document's to deliver. Six controls, measured against Chrome 155 on a harness-shaped page
  // (`q9-logs/referrer-controls.mjs`, output `referrer-controls-measured.txt`, table in
  // `docs/architecture/render-outputs.md` §7). Each control fetches its stylesheet and its face — the
  // probe polls for both and cache-busts every URL, because a control that requested nothing would make
  // "no Referer" true for the wrong reason:
  //
  //   * no policy anywhere — the stylesheet arrives with `Referer: <the harness URL>` and the face that
  //     stylesheet names arrives with `Referer: <…/fonts/fonts.css>`;
  //   * the document `<meta name="referrer">` alone, the `<link referrerpolicy>` alone, or both together
  //     — the stylesheet request goes silent, and the face still names the stylesheet. Chromium takes a
  //     stylesheet's subresource referrer policy from the *stylesheet's* own fetch, so a `<link>`
  //     attribute governs the link, not the CSS it loads;
  //   * a `Referrer-Policy: no-referrer` HTTP header on the stylesheet — the face goes silent, and the
  //     stylesheet itself still names the harness unless the document tags are there too;
  //   * header plus both tags — nothing on the wire carries a Referer.
  //
  // So the mechanism that silences the font requests belongs to the origin that serves the file, which
  // is a delivery requirement rather than a harness edit, and it is listed as one. What the harness can
  // be held to is this: the only Referer any request in a render session may carry is the pinned
  // stylesheet's own path on the same origin the bytes came from. Asserting the set rather than allowing
  // it is the point — a new referrer, to any other URL, is a finding instead of a widened tolerance.
  const ownStylesheetReferrer = `${ORIGIN}/fonts/fonts.css`;
  const referrers = log.flatMap((entry) => Object.entries(entry.sentHeaders ?? {})
    .filter(([name]) => name.toLowerCase() === 'referer')
    .map(([, value]) => {
      let path = entry.url;
      try { path = new URL(entry.url).pathname; } catch { /* keep the raw target */ }
      return { requested: path, value: String(value) };
    }));
  const offenders = referrers.filter((row) => row.value !== ownStylesheetReferrer);
  check('every-referrer-is-the-harness-own-stylesheet-on-its-own-origin',
    offenders.length === 0, offenders.length === 0
      ? `${referrers.length} of ${log.length} requests name ${ownStylesheetReferrer}`
      : offenders.map((row) => `${row.requested} (referer: ${row.value})`).join(' | '));

  const allNames = [...listArtefacts(artefactDir), ...listArtefacts(secondDir)];
  check('no-artefact-name-carries-the-credential', !allNames.some((name) => name.includes(credential)),
  `${allNames.length} names`);
  check('only-plate-artefacts-came-from-the-qr-route',
    allNames.filter((name) => name.startsWith('qr_')).every((name) => /^qr_\d+mm_p1\.png$/.test(name)),
  allNames.filter((name) => name.startsWith('qr_')).join(','));

  // ------------------------------------------------------------------- output census
  say('');
  say('## R-J. what was written, and where');
  for (const dir of [artefactDir, secondDir, deadlineDir]) {
    const names = listArtefacts(dir).sort();
    say(`  ${dir.replace(EVIDENCE_DIR, 'q9-logs')} (${names.length} file(s))`);
    for (const name of names) {
      say(`    ${name} · ${statSync(join(dir, name)).size} bytes`);
    }
  }
  // The census is a set of *names*, not a count of files. An artefact is named
  // `kind_box_pN.format`, so every teaser render in this tier answers the same 1200×630 page-one box
  // and writes the same pair of names — each one replacing the last. `records` is the witness that a
  // render happened, and each case's own `artefacts` check is the witness for its bytes; what this
  // check can say is that the directory holds exactly the outputs the tier asked for, with
  // `share_image_1080x1620_*` the one pair no other case can produce.
  const expectedArtefacts = [
    'og_image_1200x630_p1.png', 'og_image_1200x630_p1.webp',
    'share_image_1080x1350_p1.png', 'share_image_1080x1350_p1.webp',
    'share_image_1080x1620_p1.png', 'share_image_1080x1620_p1.webp',
    'qr_25mm_p1.png', 'qr_40mm_p1.png', 'qr_60mm_p1.png',
  ].sort().join(',');
  check('artefacts-are-exactly-the-cases-this-tier-ran',
    listArtefacts(artefactDir).sort().join(',') === expectedArtefacts,
  listArtefacts(artefactDir).sort().join(','));
  // The second worker was opened for one purpose: re-render the same teaser and the same plate in a
  // different browser process. Anything else in its directory would mean a render that was never
  // asked for, and the missing plate is as much a finding as an extra one — `L3` claims byte identity
  // for a QR too, so it has to have been drawn there.
  check('rerun-directory-holds-only-the-l3-renders',
    listArtefacts(secondDir).sort().join(',')
    === 'og_image_1200x630_p1.png,og_image_1200x630_p1.webp,qr_40mm_p1.png',
  listArtefacts(secondDir).join(','));
  check('deadline-directory-is-empty', listArtefacts(deadlineDir).length === 0);
} catch (error) {
  say(`\nHARNESS FAILURE: ${mask(String(error.stack ?? error)).split('\n').slice(0, 6).join('\n')}`);
  for (const open of [worker, impatient, secondWorker]) {
    if (open !== null && open !== undefined) await open.close().catch(() => undefined);
  }
  writeFileSync(join(SCRATCH, 'report.txt'), `${lines.join('\n')}\n`);
  writeFileSync(join(SCRATCH, 'records.json'), `${JSON.stringify(records, null, 2)}\n`);
  process.exit(2);
}

if (findings.length === 0) {
  say('');
  say(`ALL CHECKS PASSED (${lines.filter((row) => row.startsWith('PASS')).length} assertions, `
    + `${records.length} render records, ${lines.filter((row) => row.startsWith('  ')).length} measured rows)`);
} else {
  say('');
  say(`${findings.length} FINDING(S)`);
  for (const finding of findings) say(`  - ${finding}`);
}
writeFileSync(join(SCRATCH, 'report.txt'), `${lines.join('\n')}\n`);
writeFileSync(join(SCRATCH, 'records.json'), `${JSON.stringify(records, null, 2)}\n`);
say(`\nwrote ${join(SCRATCH, 'report.txt')}`);
process.exit(findings.length === 0 ? 0 : 1);
