// S9-6b: the PDF is the one artefact this worker cannot check by looking at its own pixels.
//
// A PNG says its size in its header, so `imageDimensions` can refuse a 1199×630 teaser before it
// reaches disk. A PDF says its size in an object dictionary, its page count in a page tree, and its
// glyph coverage in an embedded font stream — none of which the worker drew, and all of which a guest
// printing the file will discover instead of us. So the worker reads the bytes back, and this file
// pins what "reads" means.
//
// What these tests hold the reader to:
//
//   * **Only facts a produced PDF actually carries.** Every shape here is the shape Chrome 155's Skia
//     writer emits — measured in `q9-logs/pdf-controls2-measured.txt` over the files in
//     `q9-logs/pdf-probe/`: the structural keys answer in *uncompressed* object dictionaries
//     (`/ObjStm` 0 in all three files probed), one `/Count` per file while the tree stays flat, one
//     `/MediaBox` per page with the same numbers each time, `/Producer Skia/PDF m155`, and
//     `/CreationDate` and `/ModDate` present with **no `/ID` array**. That last pair is why §13's
//     determinism instrument normalises timestamps instead of claiming bytes: the design's earlier note
//     that a file ID also moves was measured false, and a test that pinned the false shape would
//     document a defect as a contract.
//     The "one `/Count`" half has since been measured false too, and it is the more interesting of the
//     two: a sixteen-sheet document is a *nested* tree (`/Count 8`, `/Count 8`, root `/Count 16` —
//     `q9-logs/pdf-count-investigated.txt` over `q9-logs/pdf-count-probe/`), so the count is read from
//     the largest `/Count` and cross-checked against the leaf page objects, never from whichever number
//     the scan happened to meet first.
//   * **Descriptions, not verdicts.** `readPdfStructure` never says "wrong paper" or "too many pages".
//     The refusal belongs to the write path, which is the one place that can still avoid putting a file
//     on disk; a reader that refused would make the guard possible to skip.
//   * **A refusal that is a refusal.** A buffer that is not a PDF, and a PDF whose page tree is not
//     there to read, come back as `ok: false` with a named reason. The write path treats a reason as
//     "no file", so the silent-zero shape — `pageCount: null` on a file we could not parse — would turn
//     an unreadable artefact into a one-pager.
//
// The fixtures are hand-written rather than a captured PDF because a committed byte-for-byte copy of a
// rendered file would be a second source of truth about what Chromium produces, and this stage's whole
// rule about PDFs is that the browser is the only one.

import { describe, expect, it } from 'vitest';

import { normalisePdfTimestamps, readBrowserPin, readPdfStructure } from './stage9-render-worker.mjs';

/** A one-page A4 in the order Skia writes it: catalog, page tree, page, annotation, font, info. */
const A4_PDF = `%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R /StructTreeRoot 9 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595.91998 841.91998] /Annots [5 0 R]
  /Resources << /Font << /F1 6 0 R >> >> /Contents 4 0 R >> endobj
4 0 obj << /Length 0 >> stream
endstream endobj
5 0 obj << /Type /Annot /Subtype /Link /S /URI /URI (https://maps.example/sri-kanchi-mahal) >> endobj
6 0 obj << /Type /Font /Subtype /TrueType /BaseFont /AAAAAA+NotoSansTamil-Regular
  /FirstChar 32 /LastChar 255 /Widths 7 0 R /FontDescriptor 8 0 R /ToUnicode 10 0 R >> endobj
8 0 obj << /Type /FontDescriptor /FontName /AAAAAA+NotoSansTamil-Regular /FontFile2 11 0 R >> endobj
10 0 obj << /Length 0 >> stream
endstream endobj
11 0 obj << /Length 0 >> stream
endstream endobj
12 0 obj << /Producer (Skia/PDF m155) /CreationDate (D:20261014060901+00'00')
  /ModDate (D:20261014060901+00'00') >> endobj
trailer << /Size 13 /Root 1 0 R /Info 12 0 R >>
startxref
0
%%EOF`;

/** The same document at the box Chromium answers for Letter, with one `/MediaBox` per sheet. */
const LETTER_TWO_PAGES = `%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R /StructTreeRoot 4 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /MediaBox [0 0 612 792] >> endobj
5 0 obj << /Type /Page /MediaBox [0 0 612 792] /Annots [6 0 R] >> endobj
6 0 obj << /Subtype /Link /S /URI /URI (https://maps.example/sri-kanchi-mahal) >> endobj
trailer << /Root 1 0 R >>
%%EOF`;

const asBytes = (text) => Buffer.from(text, 'latin1');

/** A six-sheet document whose page tree is **nested**, transcribed from the shape Chrome 155 writes for
 *  a sixteen-page run (`q9-logs/pdf-count-probe/long-45.pdf`, dumped in
 *  `q9-logs/pdf-count-investigated.txt`): two intermediate nodes of eight each and a root that totals
 *  them, each node carrying a `/Parent` or the children's back-pointer, and every value on its own line.
 *  This is the shape that made the first version of the reader refuse a legitimate long invitation. */
const NESTED_SIX_PAGES = `%PDF-1.7
1 0 obj
<</Type /Catalog
/Pages 91 0 R>>
endobj
2 0 obj
<</Type /Page
/MediaBox [0 0 595.91998 841.91998]
/Parent 89 0 R>>
endobj
14 0 obj
<</Type /Page
/MediaBox [0 0 595.91998 841.91998]
/Parent 89 0 R>>
endobj
19 0 obj
<</Type /Page
/MediaBox [0 0 595.91998 841.91998]
/Parent 89 0 R>>
endobj
49 0 obj
<</Type /Page
/MediaBox [0 0 595.91998 841.91998]
/Parent 90 0 R>>
endobj
54 0 obj
<</Type /Page
/MediaBox [0 0 595.91998 841.91998]
/Parent 90 0 R>>
endobj
59 0 obj
<</Type /Page
/MediaBox [0 0 595.91998 841.91998]
/Parent 90 0 R>>
endobj
89 0 obj
<</Type /Pages
/Count 3
/Kids [2 0 R 14 0 R 19 0 R]
/Parent 91 0 R>>
endobj
90 0 obj
<</Type /Pages
/Count 3
/Kids [49 0 R 54 0 R 59 0 R]
/Parent 91 0 R>>
endobj
91 0 obj
<</Type /Pages
/Count 6
/Kids [89 0 R 90 0 R]>>
endobj
trailer << /Root 1 0 R >>
%%EOF`;

describe('readPdfStructure', () => {
  it('reads the paper the file actually declares', () => {
    const out = readPdfStructure(asBytes(A4_PDF));
    expect(out.ok).toBe(true);
    expect(out.mediaBoxes).toEqual([
      { widthPt: 595.91998, heightPt: 841.91998, widthMm: 210.227, heightMm: 297.011 },
    ]);
  });

  it('collapses the per-page boxes a multipage file repeats into the one box it used', () => {
    // Chrome writes one `/MediaBox` per page, so a reader that returned a list per occurrence would
    // make the write path compare the first page and stay silent about a file whose second sheet was a
    // different size. Measured on `q9-logs/pdf-probe/p2-long-a4.pdf`: 5 occurrences, 1 distinct box.
    const out = readPdfStructure(asBytes(LETTER_TWO_PAGES));
    expect(out.mediaBoxes).toEqual([
      { widthPt: 612, heightPt: 792, widthMm: 215.9, heightMm: 279.4 },
    ]);
    expect(out.pageCount).toBe(2);
  });

  it('keeps two genuinely different boxes visible as two', () => {
    // A document that starts on A4 and ends on Letter is a defect, and the reader's job is to say so
    // rather than to average it away or report whichever sheet it happened to scan first.
    const firstSheetA4 = asBytes(LETTER_TWO_PAGES
      .replace('3 0 obj << /Type /Page /MediaBox [0 0 612 792]',
        '3 0 obj << /Type /Page /MediaBox [0 0 595.91998 841.91998]'));
    expect(readPdfStructure(firstSheetA4).mediaBoxes.length).toBe(2);
  });

  it('settles the page count from the tree total and the leaf objects together', () => {
    // `/Type /Page` is both a leaf marker and a prefix of `/Type /Pages`, and a producer writes objects
    // in any order, so neither reading is trustworthy alone: the leaves count sheets by construction, the
    // largest `/Count` is the producer's own arithmetic, and §11.4's bound needs the two to answer the
    // same number.
    const flat = readPdfStructure(asBytes(A4_PDF));
    expect(flat.pageTreeCounts).toEqual([1]);
    expect(flat.pageObjectCount).toBe(1);
    expect(flat.pageCount).toBe(1);
    const two = readPdfStructure(asBytes(LETTER_TWO_PAGES));
    expect(two.pageCount).toBe(2);
    expect(two.pageObjectCount).toBe(2);
  });

  it('reads a nested page tree as its root total instead of refusing it', () => {
    // The regression this case exists for: a sixteen-sheet Chrome print is three `/Type /Pages` nodes,
    // and a guard that demanded every `/Count` match refused such an invitation as ambiguous — a real
    // document turned into no document, and §5's sheet bound could never be reached by its own reason.
    const out = readPdfStructure(asBytes(NESTED_SIX_PAGES));
    expect(out.ok).toBe(true);
    expect(out.pageTreeCounts).toEqual([3, 3, 6]);
    expect(out.pageObjectCount).toBe(6);
    expect(out.pageCount).toBe(6);
    expect(out.mediaBoxes).toEqual([
      { widthPt: 595.91998, heightPt: 841.91998, widthMm: 210.227, heightMm: 297.011 },
    ]);
  });

  it('refuses a page tree that does not add up to its own leaves', () => {
    // The disagreement is still a refusal, just with the honest trigger: a root claiming more sheets than
    // the file contains means whichever number is picked, §11.4's bound is being checked against a
    // fiction.
    const shortRoot = asBytes(LETTER_TWO_PAGES.replace('/Count 2', '/Count 3'));
    const out = readPdfStructure(shortRoot);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('pdf-page-count-ambiguous');
    expect(out.pageTreeCounts).toEqual([3]);
    expect(out.pageObjectCount).toBe(2);
    expect(out.pageCount).toBe(3);
  });

  it('reports an absent page tree as unreadable, not as a one-page document', () => {
    const noCount = asBytes(A4_PDF.replace(' /Count 1', ''));
    const out = readPdfStructure(noCount);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('pdf-page-count-unreadable');
    expect(out.pageCount).toBeNull();
    // The mirror case: a tree that totals sheets the file does not draw, with no `/Count` to believe.
    const noLeaves = asBytes(A4_PDF.replace('/Type /Page /Parent', '/Type /Sheet /Parent'));
    expect(readPdfStructure(noLeaves).reason).toBe('pdf-page-count-unreadable');
    expect(readPdfStructure(noLeaves).pageObjectCount).toBe(0);
  });

  it('names embedded outlines and refusals instead of guessing at them', () => {
    expect(readPdfStructure(asBytes('%PDF-1.7 but no body here')).ok).toBe(false);
    expect(readPdfStructure(asBytes('not a pdf at all')).reason).toBe('pdf-header-missing');
    expect(readPdfStructure(Buffer.alloc(0)).reason).toBe('pdf-header-missing');
  });

  it('separates a missing MediaBox from a zero one', () => {
    const noBox = asBytes(A4_PDF.replace(' /MediaBox [0 0 595.91998 841.91998]', ''));
    const out = readPdfStructure(noBox);
    expect(out.mediaBoxes).toEqual([]);
  });

  it('counts the font structures §6.3 asks about, by name and by kind', () => {
    const out = readPdfStructure(asBytes(A4_PDF));
    expect(out.fonts).toEqual({
      baseFonts: ['/AAAAAA+NotoSansTamil-Regular'],
      fontFile2: 1,
      fontFile3: 0,
      type3: 0,
      toUnicode: 1,
    });
  });

  it('collects every link target the file carries, once each', () => {
    // An annotation is a second place a URL can land in a delivered file beside the text the page
    // paints, so the privacy assertion needs the set of them — and needs it deduplicated, because a
    // paginated invitation repeats the venue's map link on every sheet
    // (`q9-logs/pdf-controls2-measured.txt`: 28 `/URI` occurrences in the five-page file).
    expect(readPdfStructure(asBytes(A4_PDF)).linkTargets)
      .toEqual(['https://maps.example/sri-kanchi-mahal']);
    const twice = asBytes(A4_PDF.replace('%%EOF',
      '13 0 obj << /Subtype /Link /S /URI /URI (https://maps.example/sri-kanchi-mahal) >> endobj\n%%EOF'));
    expect(readPdfStructure(twice).linkTargets).toEqual(['https://maps.example/sri-kanchi-mahal']);
  });

  it('reads the metadata a determinism claim has to survive', () => {
    const out = readPdfStructure(asBytes(A4_PDF));
    expect(out.producer).toBe('Skia/PDF m155');
    expect(out.dates).toEqual({
      creation: `D:20261014060901+00'00'`,
      modified: `D:20261014060901+00'00'`,
    });
    // Measured false for this writer: the design note claimed a file ID as well as a date.
    expect(out.hasDocumentId).toBe(false);
    expect(out.tagged).toBe(true);
  });

  it('sees a document ID when one is actually there', () => {
    const withId = asBytes(A4_PDF.replace('trailer <<', 'trailer << /ID [<aaaa> <bbbb>]'));
    expect(readPdfStructure(withId).hasDocumentId).toBe(true);
  });

  it('reports an untagged file as untagged rather than failing to read it', () => {
    const plain = asBytes(A4_PDF.replace(' /StructTreeRoot 9 0 R', ''));
    expect(readPdfStructure(plain).ok).toBe(true);
    expect(readPdfStructure(plain).tagged).toBe(false);
  });

  it('answers the same object for the same bytes, twice', () => {
    expect(readPdfStructure(asBytes(A4_PDF))).toEqual(readPdfStructure(asBytes(A4_PDF)));
  });

  it('takes a string as readily as a buffer, because callers hold both', () => {
    expect(readPdfStructure(A4_PDF)).toEqual(readPdfStructure(asBytes(A4_PDF)));
  });
});

describe('normalisePdfTimestamps', () => {
  it('rewrites both dates and says it did', () => {
    const out = normalisePdfTimestamps(asBytes(A4_PDF));
    expect(out.ok).toBe(true);
    expect(out.replaced).toBe(2);
    const before = readPdfStructure(asBytes(A4_PDF));
    const after = readPdfStructure(out.bytes);
    expect(before.dates.creation).toContain('2026');
    expect(after.dates.creation).toBe(`D:19700101000000+00'00'`);
    expect(after.dates.modified).toBe(`D:19700101000000+00'00'`);
  });

  it('leaves the byte length alone, so the file stays a readable PDF', () => {
    // A PDF's cross-reference table holds absolute offsets. Replacing a date with a *different length*
    // string would produce bytes that no viewer can open, and a determinism check built on them would
    // be comparing garbage. The epoch stamp is exactly as long as what Skia writes.
    const out = normalisePdfTimestamps(asBytes(A4_PDF));
    expect(out.bytes.length).toBe(asBytes(A4_PDF).length);
    expect(out.bytes.toString('latin1').indexOf('%PDF-1.7')).toBe(0);
    expect(readPdfStructure(out.bytes).pageCount).toBe(1);
  });

  it('normalises a differing second away, which is the whole point', () => {
    // Measured: two prints of the same tuple minutes apart differ in nothing else
    // (`q9-logs/pdf-override-measured.txt`, where the only differing bytes between the two cycles were
    // the date pair).
    const early = asBytes(A4_PDF);
    const late = asBytes(A4_PDF.replace(/D:20261014060901/g, `D:20261014061259`));
    expect(early.equals(late)).toBe(false);
    expect(normalisePdfTimestamps(early).bytes.equals(normalisePdfTimestamps(late).bytes)).toBe(true);
  });

  it('refuses a file with no dates instead of reporting a normalisation that did nothing', () => {
    const undated = asBytes(A4_PDF
      .replace(`/CreationDate (D:20261014060901+00'00')`, '')
      .replace(`/ModDate (D:20261014060901+00'00')`, ''));
    const out = normalisePdfTimestamps(undated);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no-pdf-timestamps');
    expect(out.replaced).toBe(0);
  });

  it('is pure: the input buffer comes back untouched', () => {
    const input = asBytes(A4_PDF);
    const copy = Buffer.from(input);
    normalisePdfTimestamps(input);
    expect(input.equals(copy)).toBe(true);
  });
});

describe('the browser pin reader survives the line endings a Windows checkout produces', () => {
  // `readBrowserPin` reads a documentation file through the same `core.autocrlf=true` that the
  // `.gitattributes` block had to pin the digested sources against, and a pin that failed to parse on
  // a fresh clone would refuse every render in `checkBrowserPin` for a reason about git config. Proved
  // once in `q9-logs/pin-crlf-check.mjs`; pinned here so the tolerance is a contract rather than an
  // accident of one regex.
  it('accepts LF, CRLF and trailing whitespace alike', () => {
    for (const line of ['validated_against: 155', 'validated_against:   155  ',
      'validated_against:\t155']) {
      expect(readBrowserPin(`# doc\n${line}\nmore`)).toEqual({ ok: true, major: 155 });
      expect(readBrowserPin(`# doc\r\n${line}\r\nmore`)).toEqual({ ok: true, major: 155 });
    }
  });

  it('still refuses when the line is not there', () => {
    expect(readBrowserPin('validated against 155')).toEqual({ ok: false, reason: 'pin-line-missing' });
    expect(readBrowserPin('validated_against: one-fifty-five'))
      .toEqual({ ok: false, reason: 'pin-line-missing' });
  });
});
