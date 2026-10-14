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
//   * It checks the sheet out of the bytes the browser wrote, not out of the record that describes
//     them: the paper from the file's own `/MediaBox`, the sheet count from its page tree *and* its leaf
//     page objects together, the faces from `/BaseFont`+`/FontFile2`+`/ToUnicode`, the text layer from
//     `pdftotext` when the operator's PATH has it (§6.3 runs the structural half always and reports
//     `SKIPPED: no text extractor available` for the operational half rather than passing silently), and
//     Indic coverage per script — Tamil, Telugu, Kannada, Malayalam and English each has to arrive in
//     the file's text layer, not only on the page. What it does *not* claim is that anybody who reads
//     those scripts checked the shaping (§15's H-3, the same claim `render-contract.md` §8.4 withholds),
//     and share content taller than the last quantised box is still asserted to come back as `paginate`
//     with no artefact: page two of a share set is the next slice, not this one.
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

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BYTE_CEILINGS,
  MAX_PDF_PAGES,
  OG_BOX,
  OG_DROP_ORDER,
  OG_FIT,
  PDF_MEDIA_BOX_PT,
  SHARE_HEIGHTS,
  SHARE_WIDTH,
} from '../src/render/outputGeometry.ts';
import {
  RENDER_CAPABILITY_CALLS,
  WORKER_VERSION,
  browserMajor,
  checkBrowserPin,
  imageDimensions,
  normalisePdfTimestamps,
  openRenderWorker,
  readBrowserPin,
  readPdfStructure,
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
// not optional. §11.7's requirement is a property of the report's bytes, so it is also checked as one —
// at the end of the run the report's lines and every recorded result are grepped for this string
// (`report-lines-carry-no-credential`, `record-bodies-carry-no-credential`), because a masking rule that
// only rewrote *shaped* text would not be the guarantee.
//
// The shaped sweep is a canary for secrets this tier did not create (another run's token arriving in a
// header value or an error message). It leaves a run alone when that run carries no upper-case letter,
// no digit and no underscore, on the reasoning that a base64url credential has one of those with
// overwhelming probability, so an all-lowercase-and-hyphen run is an identifier rather than a secret —
// four of this file's own check ids are exactly 43 such characters
// (`only-plate-artefacts-came-from-the-qr-route` among them) and redacting a failing assertion's name
// would turn a finding into an unreadable line, which is how a privacy rule ends up hiding the very
// result it was written to protect.
//
// The carve-out's edge is not hypothetical: `pdf-a4-page-tree-settles-against-its-leaves` was 43
// characters too, and its `4` put it on the credential side of the line, so the run printed
// `PASS <credential>` for that assertion until the id was shortened. Since ids grow and their lengths
// are nobody's intention, the last section asserts that every verdict in the report still names itself
// (`every-assertion-kept-its-name`).
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
const longDocument = ({ blocks = 1, eventCount = 2, lead = 24, addressLines = 0, language = 'ta' } = {}) => {
  const document = clone(guestInvitation({
    language,
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

// --------------------------------------------------------------------- sheet instruments

/** §6.3's operational half, and it is an *instrument* dependency.
 *
 *  Poppler's `pdftotext` is on this host (`C:\Program Files\Git\mingw64\bin\pdftotext.exe`, measured in
 *  `q9-logs/pdf-controls2-measured.txt`, which is the same binary the design's §6.3 cites). It is never
 *  a product dependency and never installed by anything in this repository, so its absence is a
 *  possibility rather than a bug: when it is not there the cases below report
 *  `SKIPPED: no text extractor available` as a measured row instead of passing silently, which is what
 *  §6.3 asks for and what makes a machine without poppler produce a readable — if weaker — run.
 *  `PDFTOTEXT` on the environment points the instrument at a different build. */
const PDFTOTEXT = [process.env.PDFTOTEXT,
  'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe']
  .filter(Boolean).find((candidate) => existsSync(candidate)) ?? null;

/** The file's text, one array of trimmed lines per sheet, with the trailing empty sheet poppler always
 *  emits after the last `/f` dropped. Measured shape (`q9-logs/pdf-tier-lines-measured.txt`): a five-page
 *  document reads back as six arrays, the sixth empty. */
const extractedPages = (pdfPath, name) => {
  if (PDFTOTEXT === null) return null;
  const txtPath = join(SCRATCH, `extracted-${name}.txt`);
  execFileSync(PDFTOTEXT, ['-enc', 'UTF-8', pdfPath, txtPath]);
  return readFileSync(txtPath, 'utf8').split('\f')
    .map((page) => page.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((page) => page.length > 0);
};

const codepoints = (text) => new Set([...String(text)].filter((ch) => !/\s/.test(ch)));

/** The six families the render surface is allowed to draw with, read out of the generated stylesheet
 *  rather than restated here: `public/fonts/fonts.css` is the file the browser is handed, so a family
 *  that appears in a produced PDF's `/BaseFont` but not in it is a face this project does not ship. */
const pinnedFamilies = [...new Set([...readFileSync(join(ROOT, 'public', 'fonts', 'fonts.css'), 'utf8')
  .matchAll(/font-family:\s*'([^']+)'/g)].map((found) => found[1].replace(/\s+/g, '')))];

/** The family name a `/BaseFont` entry claims, with its subset tag removed:
 *  `/AAAAAA+NotoSansTamil-Regular` → `NotoSansTamil`. */
const familyOf = (baseFont) => baseFont.replace(/^\//, '').split('+')[1]?.split('-')[0] ?? baseFont;

/** The five scripts §6.3 names, with the same wording `src/test/invitationScripts.test.tsx` holds.
 *  Restated rather than imported because a node instrument cannot import a `.tsx`, and because the
 *  question here is a different one: not whether React draws the run, but whether the run survives into
 *  the text layer of a file somebody else will open. `run` is the codepoint range that sample's own
 *  script occupies (Latin for the English one, since its title is Latin too), taken from the range table
 *  the Stage 9 PDF probes measured with (`q9-logs/pdf-controls2-measured.txt` P4). */
const SCRIPT_RANGES = {
  latin: '[\\u0020-\\u024F]', ta: '[\\u0B80-\\u0BFF]', te: '[\\u0C00-\\u0C7F]',
  kn: '[\\u0C80-\\u0CFF]', ml: '[\\u0D00-\\u0D7F]',
};

const SCRIPT_SAMPLES = [
  { code: 'en', script: 'latin', font: 'Playfair Display', title: 'Arun weds Deepa',
    welcome: 'With the blessings of our elders, we invite you',
    closing: 'With love,\nArun and Deepa' },
  { code: 'ta', script: 'ta', font: 'Noto Sans Tamil', title: 'அருண் திருமணம்',
    welcome: 'எங்கள் பெரியோர்களின் ஆசீர்வாதத்துடன்',
    closing: 'அன்புடன்,\nஅருண் மற்றும் தீபா' },
  { code: 'te', script: 'te', font: 'Noto Sans Telugu', title: 'అరుణ్ వివాహం',
    welcome: 'మా పెద్దల ఆశీర్వదానంతో',
    closing: 'ప్రేమతో,\nఅరుణ్ మరియు దీప' },
  { code: 'ml', script: 'ml', font: 'Noto Sans Malayalam', title: 'അരുൺ വിവാഹം',
    welcome: 'ഞങ്ങളുടെ മുതിർന്നവരുടെ ആശീർവാദോടെ',
    closing: 'സ്നേഹത്തോടെ,\nഅരുൺ, ദീപ' },
  { code: 'kn', script: 'kn', font: 'Noto Sans Kannada', title: 'ಅರುಣ್ ಮದುವೆ',
    welcome: 'ನಮ್ಮ ಹಿರಿಯರ ಆಶೀರ್ವಾದದೊಂದಿಗೆ',
    closing: 'ಪ್ರೀತಿಯಿಂದ,\nಅರುಣ್ ಮತ್ತು ದೀಪ' },
];

/** A document whose only script-specific content is the sample's own three slots, built the way the
 *  fixture requires: through `draft`, so the host's words reach the flat key and the section body that
 *  names it together (`src/test/invitationFixture.ts:27-37`). A document that wrote only the flat copy
 *  would render a page missing the blessing line and the tier would read its own shortcut as a defect
 *  in the renderer. */
const scriptDocument = (sample) => {
  const document = clone(guestInvitation({
    language: sample.code,
    draft: { welcome: sample.welcome, closing: sample.closing },
  }));
  document.title = sample.title;
  document.style = { ...document.style, font: sample.font };
  return document;
};

/** The words an invitation promises a guest will be able to read: the title, each person's name, each
 *  ceremony's own name and where it is, and the four slots a host writes prose into. Deliberately not
 *  the whole DTO — a public DTO also carries keys no sheet draws (`role_label`, `timezone`, the
 *  template's display name), and asserting the file contains *those* would be a claim about the
 *  renderer this tier has not made. §5's PDF row is "the whole document", so the completeness test is
 *  whether everything the document says to show arrives. */
const declaredText = (document) => [
  document.title,
  ...document.people.map((person) => person.display_name),
  ...document.events.flatMap((event) => [
    event.display_name, event.venue.name, event.venue.address_text,
  ]),
  document.welcome, document.family_introduction, document.event_notes, document.closing,
].filter((value) => typeof value === 'string').join('\n');

/** The characters one of the five samples' own script occupies inside a document's declared words —
 *  the set a produced sheet has to carry for that script to count as delivered rather than as drawn on
 *  screen and lost on the way to the file. Whitespace is dropped from both sides (`codepoints`), which
 *  is not a relaxation: the sheet breaks a ceremonial line where the DTO wrote it on one, so the
 *  characters are the invariant and their positions are not. */
const scriptRun = (sample, text) => codepoints(
  (String(text).match(new RegExp(SCRIPT_RANGES[sample.script], 'g')) ?? []).join(''));

/** Every assertion one produced sheet has to pass, run against the bytes **on disk**.
 *
 *  The tier reads the file rather than trusting `result.pdf` because the two are different claims: the
 *  record is what the worker believes it printed, the file is what a guest opens. The record is then
 *  compared against the file, so a worker that described a sheet it had not produced goes red even when
 *  the sheet is fine. `label` keeps the ids readable per case (`a4`, `letter`, `long`, one per script). */
const sheetChecks = (label, { paper, result, bytes }) => {
  const row = result.artefacts[0];
  const file = readPdfStructure(bytes);
  const expected = PDF_MEDIA_BOX_PT[paper];
  check(`pdf-${label}-named-for-its-paper`, row.name === `pdf_${paper}_p1.pdf`, row.name);
  check(`pdf-${label}-reads-as-a-pdf`, file.ok === true, file.reason);
  if (file.ok === false) return file;
  check(`pdf-${label}-sheet-is-the-paper-it-was-asked-for`, file.mediaBoxes.length === 1
    && file.mediaBoxes[0].widthPt === expected.width
    && file.mediaBoxes[0].heightPt === expected.height,
  `${JSON.stringify(file.mediaBoxes)} against ${expected.width}x${expected.height}`);
  check(`pdf-${label}-tree-settles-against-its-leaves`, file.pageCount >= 1
    && file.pageObjectCount === file.pageCount
    && file.pageTreeCounts.every((count) => count <= file.pageCount),
  `count ${file.pageCount} · tree ${file.pageTreeCounts.join('/')} · leaves ${file.pageObjectCount}`);
  check(`pdf-${label}-faces-are-embedded-and-decodable`, file.fonts.fontFile2 > 0
    && file.fonts.toUnicode === file.fonts.fontFile2
    && file.fonts.fontFile3 === 0 && file.fonts.type3 === 0,
  JSON.stringify(file.fonts));
  check(`pdf-${label}-ships-only-self-hosted-families`, file.fonts.baseFonts.length > 0
    && file.fonts.baseFonts.every((name) => pinnedFamilies.includes(familyOf(name))),
  file.fonts.baseFonts.join(','));
  check(`pdf-${label}-tagged-and-no-document-id`, file.tagged === true
    && file.hasDocumentId === false,
  `tagged ${file.tagged} · /ID ${file.hasDocumentId}`);
  check(`pdf-${label}-names-its-producer`, typeof file.producer === 'string'
    && file.producer.length > 0, file.producer);
  check(`pdf-${label}-within-the-pdf-ceiling`, row.bytes <= BYTE_CEILINGS.pdf,
  `${row.bytes} bytes against ${BYTE_CEILINGS.pdf}`);
  check(`pdf-${label}-scaled-nothing-and-dropped-nothing`, result.fit_plan === null,
  JSON.stringify(result.fit_plan));
  // The record's account of the sheet, against the sheet. Key order is not a coincidence to lean on:
  // both sides come out of the same `readPdfStructure`, so this is checking that the worker carried the
  // file's own answer into the row rather than a number it computed for itself.
  check(`pdf-${label}-record-describes-the-file`,
    JSON.stringify(result.pdf.media_box) === JSON.stringify(file.mediaBoxes)
    && result.pdf.page_count === file.pageCount
    && JSON.stringify(result.pdf.fonts) === JSON.stringify(file.fonts)
    && result.pdf.tagged === file.tagged
    && result.pdf.has_document_id === file.hasDocumentId
    && result.pdf.link_annotations === file.linkTargets.length,
  JSON.stringify(result.pdf));
  return file;
};

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

  // ------------------------------------------------------------------- §5 / §6.3 the sheet
  //
  // Everything in this section reads the bytes the worker put on disk. `result.pdf` is the worker's own
  // account of the sheet it printed, and `sheetChecks` compares that account against the file — so a
  // worker that described a document it had not written goes red here even while the file it wrote is
  // fine, and a file a guest cannot search for their own ceremony goes red even while every record field
  // is self-consistent. The claims are §5's (the whole invitation, paginated, nothing scaled away, a
  // bounded sheet count with a named refusal) and §6.3's (each face embedded with a decodable text layer,
  // in all five scripts the product admits).
  say('');
  say('## R-G. §5/§6.3 the sheet, read back out of the file the browser wrote');
  const pdfA4 = record('pdf-a4', await worker.renderPdf({ dto: shortDoc, paper: 'a4' }));
  check('pdf-a4-rendered', pdfA4.ok === true, failure(pdfA4));
  const pdfLetter = record('pdf-letter', await worker.renderPdf({ dto: shortDoc, paper: 'letter' }));
  check('pdf-letter-rendered', pdfLetter.ok === true, failure(pdfLetter));
  if (pdfA4.ok && pdfLetter.ok) {
    const a4Row = pdfA4.artefacts[0];
    const a4File = sheetChecks('a4', {
      paper: 'a4', result: pdfA4, bytes: readFileSync(a4Row.path),
    });
    const letterRow = pdfLetter.artefacts[0];
    const letterFile = sheetChecks('letter', {
      paper: 'letter', result: pdfLetter, bytes: readFileSync(letterRow.path),
    });
    // The two papers are the same invitation on two sheets. `render_config_hash` covers the paper and
    // the print parameters, so it *has* to differ; `source_dto_digest` covers the parsed projection, so
    // it must not. Saying which half moved is the only way to tell "we print on two papers" apart from
    // "we print two different documents".
    check('pdf-letter-and-a4-are-the-same-invitation',
      pdfLetter.source_dto_digest === pdfA4.source_dto_digest,
    `${pdfLetter.source_dto_digest?.slice(0, 12)} vs ${pdfA4.source_dto_digest.slice(0, 12)}`);
    check('pdf-letter-is-a-different-sheet-from-a4',
      a4File.ok === true && letterFile.ok === true
      && JSON.stringify(letterFile.mediaBoxes) !== JSON.stringify(a4File.mediaBoxes)
      && pdfLetter.artefacts[0].render_config_hash !== a4Row.render_config_hash,
    `${JSON.stringify(a4File.mediaBoxes ?? null)} vs ${JSON.stringify(letterFile.mediaBoxes ?? null)}`);
    // One document, two surfaces: `shortDoc` is the same object R-C drew into 1200×630, so the sheet and
    // the teaser have to agree on which invitation they came from. The digest is over the *parsed*
    // projection, which makes equality the statement that both surfaces' parsers read one document —
    // not the statement that the caller passed the same object twice, which would be worth nothing.
    check('pdf-and-the-teaser-come-from-one-invitation',
      pdfA4.source_dto_digest === teaser.source_dto_digest,
    `${pdfA4.source_dto_digest.slice(0, 12)} vs ${teaser.source_dto_digest ?? '(the teaser refused)'}`);

    if (a4File.ok === true) {
      // §11.7 puts a URL in exactly one place: the artefact that needs it. A sheet's link annotations are
      // the venue maps a guest taps on a phone, so the addresses belong in *this* file's objects — and
      // because the record only carries a count, the file is the sole witness of which addresses went in.
      // A household `/g/` door or a family-review `/r/` door printed into an invitation a guest forwards
      // around is the failure §9.3's plate route refuses to even draw, and it is refused here on the same
      // terms: the annotation set must be the venues' own, https, and nothing else.
      const declaredMaps = [...new Set(shortDoc.events.map((event) => event.venue.map_url))].sort();
      check('pdf-a4-annotations-are-the-venues-own-addresses',
        JSON.stringify([...a4File.linkTargets].sort()) === JSON.stringify(declaredMaps),
      `${a4File.linkTargets.join(', ')} against ${declaredMaps.length} declared venue map(s)`);
      check('pdf-a4-annotations-are-https-and-carry-no-private-door',
        a4File.linkTargets.every((uri) => uri.startsWith('https://')
          && !uri.includes('/g/') && !uri.includes('/r/') && !uri.includes(credential)),
      a4File.linkTargets.join(', '));
      // The record's own silence, asserted rather than assumed: `link_annotations` is a number, and no
      // string in the row the caller gets should name an address at all.
      check('pdf-a4-record-carries-a-count-not-an-address',
        !JSON.stringify(pdfA4).includes('maps.example'),
      `${a4File.linkTargets.length} annotation(s) in the file, `
        + `${pdfA4.pdf.link_annotations} in the record`);
    }

    const a4Pages = extractedPages(a4Row.path, 'a4');
    if (a4Pages === null) {
      measured('pdf a4 text layer', 'SKIPPED: no text extractor available');
    } else {
      const a4Text = a4Pages.flat().join('\n');
      check('pdf-a4-text-layer-has-one-block-per-sheet', a4File.ok === true
        && a4Pages.length === a4File.pageCount,
      `${a4Pages.length} extracted vs ${a4File.pageCount ?? 'unreadable'} in the page tree`);
      check('pdf-a4-text-layer-carries-the-title-and-its-ceremony',
        a4Text.includes(shortDoc.title) && a4Pages.some((lines) => lines.includes('Ceremony 1')),
      a4Pages[0].slice(0, 3).join(' / '));
      const a4Missing = [...codepoints(declaredText(shortDoc))]
        .filter((ch) => !a4Text.includes(ch));
      check('pdf-a4-declared-characters-reach-the-text-layer', a4Missing.length === 0,
      `${a4Missing.length} absent: ${a4Missing.slice(0, 8).join('')}`);
      measured('a4 sheets / lines / bytes',
        `${a4File.pageCount ?? '?'} · ${a4Pages.map((lines) => lines.length).join(',')} · ${a4Row.bytes}`);
    }
  }

  // The five scripts §6.3 names, each drawn with its own family and read back out of the file. This is
  // the half of "correct Indic rendering" a DOM test cannot reach: `invitationScripts.test.tsx` proves
  // React puts the glyphs on the page, and the raster tier proves the pixels carry them, but a PDF is
  // only useful to a guest who can search it, copy a name into a message, or have a screen reader reach
  // it — all three of which run off the embedded `/ToUnicode` maps rather than off painted pixels. The
  // measured pair (`q9-logs/pdf-controls2-measured.txt` P4: page-only and file-only codepoint sets both
  // empty for all five) is what makes set containment, rather than a hand-picked character, the claim.
  for (const sample of SCRIPT_SAMPLES) {
    const sheetDto = scriptDocument(sample);
    const result = record(`pdf-script-${sample.code}`,
      await worker.renderPdf({ dto: sheetDto, paper: 'a4' }));
    check(`pdf-script-${sample.code}-rendered`, result.ok === true, failure(result));
    if (result.ok === false) continue;
    const sheetRow = result.artefacts[0];
    const sheetFile = sheetChecks(sample.code, {
      paper: 'a4', result, bytes: readFileSync(sheetRow.path),
    });
    if (sheetFile.ok === false) continue;
    // The face the host chose has to be the face the sheet carries. `PlayfairDisplay` also turns up in
    // the Indic sheets (the renderer's own UI chrome is set in it), so this is a `some`, not a
    // "the only base font is" — the claim is that the chosen family arrived, which is what §5's
    // "Indic text is never substituted by a fallback the product does not ship" asks.
    check(`pdf-script-${sample.code}-drew-with-its-own-face`,
      sheetFile.fonts.baseFonts.some((name) => familyOf(name) === sample.font.replace(/\s+/g, '')),
    sheetFile.fonts.baseFonts.join(','));
    const pages = extractedPages(sheetRow.path, `script-${sample.code}`);
    if (pages === null) {
      measured(`pdf script ${sample.code} text layer`, 'SKIPPED: no text extractor available');
      continue;
    }
    const sheetText = pages.flat().join('');
    const run = scriptRun(sample, declaredText(sheetDto));
    const absent = [...run].filter((ch) => !sheetText.includes(ch)).map((ch) => ch.codePointAt(0));
    check(`pdf-script-${sample.code}-reaches-the-text-layer`, run.size > 0 && absent.length === 0,
      `${run.size} codepoint(s) · absent ${absent.map((cp) => cp.toString(16)).join(',') || 'none'}`);
    measured(`script ${sample.code}`, `${run.size} codepoint(s) · ${sheetFile.fonts.fontFile2} `
      + `embedded face(s) · ${sheetFile.fonts.toUnicode} /ToUnicode · ${sheetRow.bytes} bytes`);
  }

  // The paginated case: twenty ceremonies is a document no sheet holds, so §5's answer is more sheets
  // with the reading order intact. The rules worth pinning are the ones a printer would notice: a
  // ceremony whose venue directions fell onto the next sheet reads as a wrong address, a heading left
  // alone at a foot reads as a section that never happened, and a missing ceremony reads as a
  // truncated invitation while the file still says it is the whole document. Line shapes are read off
  // the extraction of this exact document (`q9-logs/pdf-tier-lines-measured.txt`, `long-en.*`), not
  // guessed — a venue name shares its line with the first address line, so the matcher has to be the
  // prefix `/^Sri Kanchi Mahal (\d+) /` and an anchored `$` would silently match nothing and pass.
  const longPdfDto = longDocument({ blocks: 1, eventCount: 20, language: 'en' });
  const pdfLong = record('pdf-long', await worker.renderPdf({ dto: longPdfDto, paper: 'a4' }));
  check('pdf-long-rendered', pdfLong.ok === true, failure(pdfLong));
  if (pdfLong.ok) {
    const longRow = pdfLong.artefacts[0];
    const longFile = sheetChecks('long', {
      paper: 'a4', result: pdfLong, bytes: readFileSync(longRow.path),
    });
    check('pdf-long-is-a-paginated-sheet-within-the-named-ceiling', longFile.ok === true
      && longFile.pageCount > 1 && longFile.pageCount <= MAX_PDF_PAGES,
    `${longFile.pageCount ?? '?'} sheet(s) against ceiling ${MAX_PDF_PAGES}`);
    const pages = extractedPages(longRow.path, 'long');
    if (pages === null) {
      measured('pdf long text layer', 'SKIPPED: no text extractor available');
    } else if (longFile.ok === true) {
      check('pdf-long-text-layer-sheets-match-the-page-tree', pages.length === longFile.pageCount,
      `${pages.length} extracted vs ${longFile.pageCount} in the tree`);
      /** Which sheets a line pattern lands on, keeping every hit so a name printed twice is visible
       *  rather than overwritten by the last one. */
      const sheetsOf = (pattern) => {
        const hits = new Map();
        pages.forEach((lines, index) => {
          for (const line of lines) {
            const found = line.match(pattern);
            if (found === null) continue;
            const key = Number(found[1]);
            hits.set(key, [...(hits.get(key) ?? []), index + 1]);
          }
        });
        return hits;
      };
      const ceremonies = sheetsOf(/^Ceremony (\d+)$/);
      const venues = sheetsOf(/^Sri Kanchi Mahal (\d+) /);
      const once = (hits) => [...hits.entries()].filter(([, sheets]) => sheets.length !== 1);
      const named = longPdfDto.events.length;
      check('pdf-long-draws-every-declared-ceremony-exactly-once',
        ceremonies.size === named && once(ceremonies).length === 0,
      `${ceremonies.size} of ${named} · repeated ${JSON.stringify(once(ceremonies))}`);
      check('pdf-long-draws-every-declared-venue-exactly-once',
        venues.size === named && once(venues).length === 0,
      `${venues.size} of ${named} · repeated ${JSON.stringify(once(venues))}`);
      const split = [...ceremonies.entries()]
        .filter(([key, sheets]) => JSON.stringify(venues.get(key) ?? []) !== JSON.stringify(sheets))
        .map(([key, sheets]) => `${key}: ${sheets.join('/')} vs ${(venues.get(key) ?? []).join('/')}`);
      check('pdf-long-never-breaks-between-a-ceremony-and-where-it-is', split.length === 0,
      split.join(' | ') || `${named} ceremony/venue pair(s) share a sheet`);
      const isHeading = (line) => line === 'The ceremonies' || /^Ceremony \d+$/.test(line);
      const orphans = pages.slice(0, -1)
        .map((lines, index) => [index + 1, lines[lines.length - 1]])
        .filter(([, last]) => isHeading(last ?? ''));
      check('pdf-long-never-leaves-a-heading-alone-at-the-foot-of-a-sheet', orphans.length === 0,
      JSON.stringify(orphans) || pages.map((lines) => lines[lines.length - 1]).join(' | '));
      const longText = pages.flat().join('\n');
      const longMissing = [...codepoints(declaredText(longPdfDto))].filter((ch) => !longText.includes(ch));
      check('pdf-long-declared-characters-reach-the-text-layer', longMissing.length === 0,
      `${longMissing.length} absent: ${longMissing.slice(0, 8).join('')}`);
      measured('long sheet', `${longFile.pageCount} sheet(s) · ${longRow.bytes} bytes · lines per `
        + `sheet ${pages.map((lines) => lines.length).join(',')}`);
    }
  }

  // Three refusals, each fingerprinted against the output directory rather than believed from the return
  // value, because §5's promise about a sheet is the same promise it makes about a teaser: a document the
  // pipeline cannot honour produces a reason and no file. A partial PDF is worse than a partial PNG —
  // the first N sheets of a twenty-ceremony invitation look exactly like a complete ten-ceremony one.
  const sheetFiles = fingerprints(artefactDir);
  const wrongPaper = record('pdf-paper-legal', await worker.renderPdf({ dto: shortDoc, paper: 'legal' }));
  check('pdf-unknown-paper-refuses-by-name', wrongPaper.ok === false
    && wrongPaper.reason === 'paper-variant-unknown', JSON.stringify({
    ok: wrongPaper.ok, reason: wrongPaper.reason, paper: wrongPaper.paper }));
  const badSheet = record('pdf-broken-dto',
    await worker.renderPdf({ dto: { title: 'no such shape' }, paper: 'a4' }));
  check('pdf-refuses-an-unparseable-dto', badSheet.ok === false
    && badSheet.reason === 'invitation-refused', badSheet.reason);
  // The over-ceiling case is also the nested-page-tree case, and that is why it is kept rather than
  // shrunk: Chrome 155 hands a five-, seven- or eight-sheet document a flat tree and builds a two-level
  // one at sixteen (`q9-logs/pdf-count-investigated.txt`), so a reader that took the first `/Count` it
  // saw would answer 8 for this file and let a sixteen-sheet invitation through the ≤12 gate. The
  // refusal's own count is the read-back, and it is compared against the ceiling rather than a literal.
  const tooLong = record('pdf-too-many-pages',
    await worker.renderPdf({ dto: longDocument({ blocks: 1, eventCount: 45, language: 'en' }), paper: 'a4' }));
  check('pdf-over-the-page-ceiling-refuses-with-its-true-count', tooLong.ok === false
    && tooLong.reason === 'too-many-pages' && tooLong.pages > MAX_PDF_PAGES
    && tooLong.ceiling === MAX_PDF_PAGES && tooLong.pdf?.page_count === tooLong.pages,
  JSON.stringify({ reason: tooLong.reason, pages: tooLong.pages, ceiling: tooLong.ceiling }));
  check('pdf-refusals-wrote-no-file', writtenSince(artefactDir, sheetFiles).length === 0,
  writtenSince(artefactDir, sheetFiles).join(','));

  // ------------------------------------------------------------------- §11.4 bounds
  say('');
  say('## R-H. §11.4 bounds: the deadline names a reason and stops a file');
  const deadlineDir = join(SCRATCH, 'deadline');
  impatient = await openRenderWorker({
    origin: ORIGIN, outputDir: deadlineDir, renderDeadlineMs: 1, cdpPort: 9423 });
  const late = record('deadline', await impatient.renderOgTeaser({ dto: longDocument({ blocks: 1 }) }));
  check('deadline-refuses-instead-of-hanging', late.ok === false
    && late.reason === 'render-timeout', JSON.stringify({ ok: late.ok, reason: late.reason }));
  // The sheet is bounded by the same gate and has the most to lose from it: printing takes longer than a
  // screenshot, so a 1 ms deadline is answered before `Page.printToPDF` has even returned. §11.4's bound
  // is only worth something if the abandoned print does not land a file afterwards — a timed-out render
  // that still writes a PDF would hand the caller a reason *and* an artefact, which is how a stale sheet
  // ends up in an output manifest.
  const lateSheet = record('deadline-pdf',
    await impatient.renderPdf({ dto: longDocument({ blocks: 1 }), paper: 'a4' }));
  check('deadline-refuses-the-sheet-too', lateSheet.ok === false
    && lateSheet.reason === 'render-timeout', JSON.stringify({
    ok: lateSheet.ok, reason: lateSheet.reason }));
  // The callers were answered at 1 ms; both renders are still running on the serialised chain. The files
  // they would have written have to stay unwritten *after* that work lands, or §11.4's bound is a way of
  // not looking at the artefact rather than a way of not making one. One directory holds both kinds, so
  // one empty listing covers the teaser and the sheet.
  await sleep(20_000);
  check('deadline-wrote-nothing-even-after-the-abandoned-render-finished',
    listArtefacts(deadlineDir).length === 0, listArtefacts(deadlineDir).join(','));
  const impatientClose = await impatient.close();
  impatient = null;
  check('deadline-worker-profile-removed', impatientClose.profileRemoved === true,
  impatientClose.profilePath);

  // ------------------------------------------------------------------- §13 L3
  say('');
  say('## R-I. §13 L3: the same tuple re-rendered in-process, then by a second browser process');
  const l3Dto = longDocument({ blocks: 3 });
  const l3First = record('l3-first', await worker.renderOgTeaser({ dto: l3Dto }));
  const l3Second = record('l3-second-in-process', await worker.renderOgTeaser({ dto: l3Dto }));
  const l3Plate = record('l3-plate', await worker.renderQrPlate({
    variant: '40mm', target: PUBLIC_TARGET }));

  // The same tuple through the sheet path, and its bytes read off the disk after *each* render: every
  // render of one paper writes the same name (`pdf_a4_p1.pdf`), so the file is a live path that the next
  // render replaces, and the byte set has to be captured while it is the one this render wrote.
  //
  // The gap between the two in-process renders is longer than the stamp's own resolution (the pattern
  // the worker normalises carries whole seconds), which is what lets the tier say the stamp *moved*
  // rather than merely that a normalisation was applied to it.
  const l3SheetOne = record('l3-pdf-first', await worker.renderPdf({ dto: l3Dto, paper: 'a4' }));
  const sheetOneBytes = l3SheetOne.ok === true
    ? readFileSync(l3SheetOne.artefacts[0].path) : null;
  await sleep(1200);
  const l3SheetTwo = record('l3-pdf-second-in-process',
    await worker.renderPdf({ dto: l3Dto, paper: 'a4' }));
  const sheetTwoBytes = l3SheetTwo.ok === true
    ? readFileSync(l3SheetTwo.artefacts[0].path) : null;

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
  const l3SheetThree = record('l3-pdf-cross-process',
    await secondWorker.renderPdf({ dto: l3Dto, paper: 'a4' }));
  const sheetThreeBytes = l3SheetThree.ok === true
    ? readFileSync(l3SheetThree.artefacts[0].path) : null;
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

  // §13's byte claim for the one artefact that cannot make it whole, and the design's three-way split
  // (visual equivalence, content equivalence, byte-identity) applied where it actually bites: a produced
  // PDF carries a creation stamp, so two honest renders of one invitation are *not* byte-identical and
  // this tier does not claim they are. What it does claim is narrower and checkable — that the stamps are
  // the only difference between the two (which is what a re-render means for a file), that the arithmetic
  // behind `render_config_hash` keeps them out (so a sheet is not marked stale by its own clock), and
  // that a second browser process answers the same as the first.
  const sheetRaw = [sheetOneBytes, sheetTwoBytes, sheetThreeBytes];
  const sheetNormalised = sheetRaw.map((bytes) => (bytes === null ? null : normalisePdfTimestamps(bytes)));
  if (sheetNormalised.every((row) => row !== null && row.ok === true)) {
    // `replaced === 2` is the measured shape (`q9-logs/pdf-controls2-measured.txt` P3: one
    // `/CreationDate`, one `/ModDate`, and four differing bytes between two prints in the same second).
    // A producer that stamps once, or in a shape the pattern does not know, would make "normalised
    // equality" a comparison of two untouched files — so the count is asserted before the equality is
    // worth anything.
    check('pdf-sheets-carry-the-two-stamps-the-normaliser-names',
      sheetNormalised.every((row) => row.replaced === 2),
    JSON.stringify(sheetNormalised.map((row) => row.replaced)));
    const apart = (a, b) => {
      let differing = Math.abs(a.length - b.length);
      for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) differing += 1;
      return differing;
    };
    check('pdf-creation-stamp-actually-moved-between-the-two-renders',
      !sheetRaw[0].equals(sheetRaw[1]) && apart(sheetRaw[0], sheetRaw[1]) > 0,
    `${apart(sheetRaw[0], sheetRaw[1])} byte(s) differ across the gap`);
    check('pdf-stamps-are-the-only-difference-in-process',
      sheetNormalised[0].bytes.equals(sheetNormalised[1].bytes),
    `${apart(sheetNormalised[0].bytes, sheetNormalised[1].bytes)} byte(s) differ after normalisation`);
    check('pdf-stamps-are-the-only-difference-across-processes',
      sheetNormalised[0].bytes.equals(sheetNormalised[2].bytes),
    `${apart(sheetNormalised[0].bytes, sheetNormalised[2].bytes)} byte(s) differ after normalisation`);
    const rows = [l3SheetOne, l3SheetTwo, l3SheetThree].map((result) => result.artefacts[0]);
    check('l3-pdf-config-hash-identical-across-processes',
      rows[0].render_config_hash === rows[2].render_config_hash
      && rows[0].render_config_hash === rows[1].render_config_hash,
    `${rows[0].render_config_hash.slice(0, 16)} vs ${rows[2].render_config_hash.slice(0, 16)}`);
    check('l3-pdf-content-digest-moves-with-the-stamp-and-nothing-else',
      rows[0].content_digest !== rows[1].content_digest
      && rows[0].render_config_hash === rows[1].render_config_hash,
    `${rows[0].content_digest.slice(0, 16)} vs ${rows[1].content_digest.slice(0, 16)}`);
    check('l3-pdf-same-source-dto-three-times',
      [l3SheetOne, l3SheetTwo, l3SheetThree].every((result) =>
        result.source_dto_digest === l3SheetOne.source_dto_digest),
    [l3SheetOne, l3SheetTwo, l3SheetThree]
      .map((result) => result.source_dto_digest.slice(0, 12)).join(' vs '));
    // Cross-*kind* identity, which is the design's "consistency across outputs" claim in its cheapest
    // provable form: the teaser above and these three sheets came from one object, and all four surfaces
    // report the same digest of it.
    check('l3-pdf-and-teaser-share-one-invitation-digest',
      l3First.ok === true && l3First.source_dto_digest === l3SheetOne.source_dto_digest,
    `${l3First.source_dto_digest ?? '(no teaser)'} vs ${l3SheetOne.source_dto_digest}`);
    measured('pdf normalised digest',
      createHash('sha256').update(sheetNormalised[2].bytes).digest('hex').slice(0, 32));
    measured('pdf raw bytes across processes',
      `${sheetRaw[0].length} vs ${sheetRaw[2].length} · ${apart(sheetRaw[0], sheetRaw[2])} differ`);
  } else {
    check('l3-pdf-renders-produced-sheets', false,
    [l3SheetOne, l3SheetTwo, l3SheetThree].map((r) => r.reason).join(','));
  }

  // ------------------------------------------------------------------- §11.2 / §11.7 network
  say('');
  say('## R-J. §11.2/§11.7 the render sessions asked nothing off this machine, and leaked nothing');
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
  say('## R-K. what was written, and where');
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
  //
  // The two PDF names are the sheet's whole footprint: paper is in the name and page one is the only
  // page a `renderPdf` call writes (§5's sheet is one file with N pages inside it, not N files), so
  // eleven A4 renders — the two papers' cases and the five scripts and the long document and the three
  // refusals that produced nothing — are two names. Which is exactly why the census is paired with
  // `writtenSince` fingerprints on the refusals: a name set cannot see an unwanted overwrite, and the
  // refusal cases are the ones where an overwrite would be the defect.
  const expectedArtefacts = [
    'og_image_1200x630_p1.png', 'og_image_1200x630_p1.webp',
    'share_image_1080x1350_p1.png', 'share_image_1080x1350_p1.webp',
    'share_image_1080x1620_p1.png', 'share_image_1080x1620_p1.webp',
    'qr_25mm_p1.png', 'qr_40mm_p1.png', 'qr_60mm_p1.png',
    'pdf_a4_p1.pdf', 'pdf_letter_p1.pdf',
  ].sort().join(',');
  check('artefacts-are-exactly-the-cases-this-tier-ran',
    listArtefacts(artefactDir).sort().join(',') === expectedArtefacts,
  listArtefacts(artefactDir).sort().join(','));
  // The second worker was opened for one purpose: re-render the same teaser, the same plate and the same
  // sheet in a different browser process. Anything else in its directory would mean a render that was
  // never asked for, and the missing plate is as much a finding as an extra one — `L3` claims byte
  // identity for a QR too, so it has to have been drawn there, and the same holds for the sheet's
  // normalised identity.
  check('rerun-directory-holds-only-the-l3-renders',
    listArtefacts(secondDir).sort().join(',')
    === 'og_image_1200x630_p1.png,og_image_1200x630_p1.webp,pdf_a4_p1.pdf,qr_40mm_p1.png',
  listArtefacts(secondDir).sort().join(','));
  // Re-confirmed at the end of the run, after every abandoned render has had minutes to land: the
  // bounded worker drew a teaser and a sheet, both refused, and its directory holds neither.
  check('deadline-directory-is-empty', listArtefacts(deadlineDir).length === 0,
  listArtefacts(deadlineDir).join(','));

  // §11.7 applied to this tier's own two output files. The report's lines and every recorded result are
  // the exact bytes that go to `report.txt` and `records.json`, so grepping them here is the same
  // statement as grepping the files, made before either can be read by anybody else: the credential this
  // run minted appears in neither, in any form. The masking rules above are what make that true, and this
  // is what makes the rules *checked* rather than trusted.
  const reportBytes = `${lines.join('\n')}\n`;
  check('report-lines-carry-no-credential', !reportBytes.includes(credential),
  `${reportBytes.length} byte(s)`);
  const recordBytes = JSON.stringify(records);
  check('record-bodies-carry-no-credential', !recordBytes.includes(credential),
  `${records.length} record(s), ${recordBytes.length} byte(s)`);
  // And the canary's own cost, measured: a check id that happens to be 43 characters of the credential's
  // alphabet **including a digit** (`pdf-a4-…`) is indistinguishable from a token to the shaped sweep, so
  // it is redacted and the line loses its name. Left alone, that turns a privacy rule into the reason a
  // finding cannot be read. The assertion is on the shape of the failure (`PASS <credential>`: a verdict
  // with nothing named on it) rather than on a list of ids, because the ids keep growing.
  const nameless = lines.filter((row) => /^(PASS|FINDING) <credential>/.test(row));
  check('every-assertion-kept-its-name', nameless.length === 0,
  nameless.join(' | ')
    || `${lines.filter((row) => /^(PASS|FINDING) /.test(row)).length} named assertion(s)`);
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
