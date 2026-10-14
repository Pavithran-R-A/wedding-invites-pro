// The geometry file is only worth having if its numbers and its ladder are pinned.
//
// `src/render/outputGeometry.ts` states boxes, papers, a fit ladder and a drop order; the worker
// that applies them needs a live Chromium, and a tier that needs a browser cannot pin a table.
// So the table is tested here, against a *fake* measurer the test controls, which is also the only
// way to prove the ladder's shape — that it scales before it drops, that it drops in the stated
// order, and that it refuses rather than clip — because a real render that happened to fit would
// never walk the rungs at all.
//
// What these tests do not claim: that the boxes are what a browser produces. That is the raster
// tier's measurement. Here, "the plan asked for 1080×1620" and "the file is 1080×1620" are two
// different facts, and only the second one is proved by a screenshot.

import { describe, expect, it } from 'vitest';
import {
  BYTE_CEILINGS,
  MAX_PDF_PAGES,
  MAX_SHARE_PAGES,
  OG_BOX,
  OG_DROP_ORDER,
  OG_FIT,
  PAPERS,
  PDF_MARGIN_IN,
  PDF_MEDIA_BOX_MM,
  PDF_MEDIA_BOX_PT,
  SHARE_HEIGHTS,
  SHARE_PAGE_HEIGHT_PX,
  SHARE_WIDTH,
  chooseShareBox,
  chooseShareSlices,
  isPaperVariant,
  pdfPrintParams,
  planOgFit,
  type OgFitPlan,
} from '@/render/outputGeometry';

describe('the boxes §5 names', () => {
  it('cuts the teaser at 1200×630, dpr 1, and calls it a teaser', () => {
    expect(OG_BOX).toEqual({ surface: 'og', width: 1200, height: 630, dpr: 1 });
  });

  it('keeps the share width fixed and quantises only the height', () => {
    expect(SHARE_WIDTH).toBe(1080);
    expect([...SHARE_HEIGHTS]).toEqual([1350, 1620, 1800, 2160]);
  });

  it('orders the four share boxes shortest first', () => {
    const ascending = SHARE_HEIGHTS.every((h, i) => i === 0 || SHARE_HEIGHTS[i - 1] < h);
    expect(ascending).toBe(true);
  });
});

describe('chooseShareBox', () => {
  it('takes the smallest box a document fits, at each boundary', () => {
    const cases = [
      { height: 1, expected: 1350 },
      { height: 1350, expected: 1350 },
      { height: 1351, expected: 1620 },
      { height: 1620, expected: 1620 },
      { height: 1621, expected: 1800 },
      { height: 1800, expected: 1800 },
      { height: 1801, expected: 2160 },
      { height: 2160, expected: 2160 },
    ];
    expect(cases.length).toBe(8);
    for (const testCase of cases) {
      const out = chooseShareBox(testCase.height);
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.box).toEqual({ surface: 'share', width: SHARE_WIDTH, height: testCase.expected, dpr: 1 });
      }
    }
  });

  it('paginates instead of growing the canvas past the last box', () => {
    expect(chooseShareBox(2161)).toEqual({ ok: false, reason: 'paginate' });
    expect(chooseShareBox(9000)).toEqual({ ok: false, reason: 'paginate' });
  });

  it('reports a broken measurement as a broken measurement, not as a short document', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(chooseShareBox(bad)).toEqual({ ok: false, reason: 'height-not-measurable' });
    }
  });
});

describe('chooseShareSlices', () => {
  /** The tier's own measured document, in the numbers the browser answered with
   *  (`q9-logs/share-pagination2-measured.txt` G): a three-block, eight-ceremony invitation lays out
   *  2923.78 px tall at 1080 wide and offers one legal break, at the bottom of the fifth ceremony.
   *  Using the measured pair rather than invented round numbers is what makes this test about the
   *  arithmetic and not about a tidy example. */
  const threeByEight = { breaks: [2038.97], bottom: 2923.78 };

  it('cuts every page of a set at the tallest rung, so one set has one shape', () => {
    expect(SHARE_PAGE_HEIGHT_PX).toBe(SHARE_HEIGHTS[SHARE_HEIGHTS.length - 1]);
    const out = chooseShareSlices(threeByEight.breaks, threeByEight.bottom);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.slices.map((slice) => slice.box)).toEqual([
      { surface: 'share', width: SHARE_WIDTH, height: 2160, dpr: 1 },
      { surface: 'share', width: SHARE_WIDTH, height: 2160, dpr: 1 },
    ]);
  });

  it('pages 1 of N run from the top of the document to its bottom, with no gap and no overlap', () => {
    const out = chooseShareSlices(threeByEight.breaks, threeByEight.bottom);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.page_count).toBe(2);
    expect(out.slices.map((slice) => slice.pageNumber)).toEqual([1, 2]);
    expect(out.slices[0].topPx).toBe(0);
    expect(out.slices[0].bottomPx).toBe(2038.97);
    expect(out.slices[1].topPx).toBe(2038.97);
    expect(out.slices[1].bottomPx).toBe(2923.78);
    // Contiguity expressed as a property of the whole list: whatever the breaks are, the set covers
    // the document exactly once.
    const contiguous = out.slices.every((slice, index) => index === 0
      ? slice.topPx === 0
      : slice.topPx === out.slices[index - 1].bottomPx);
    expect(contiguous).toBe(true);
    expect(out.slices[out.slices.length - 1].bottomPx).toBe(threeByEight.bottom);
  });

  it('takes the furthest legal break that fits, because the page count is the cost of paginating', () => {
    // 1000, 2038.97 and 2100 all fit under a 2160 limit, and 2100 is the one to take: a shorter first
    // page spends a page the document does not need and leaves a shorter card in a set people swipe
    // through. 2200 does not fit, and cannot be reached by rounding.
    const out = chooseShareSlices([1000, 2038.97, 2100, 2200], 4000);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.slices.map((slice) => slice.bottomPx)).toEqual([2100, 4000]);
    // The same list with the reachable break removed falls back to the next one that fits.
    expect(chooseShareSlices([1000, 2038.97, 2161], 4000)).toEqual({
      ok: true,
      page_count: 2,
      slices: [
        { pageNumber: 1, topPx: 0, bottomPx: 2038.97,
          box: { surface: 'share', width: SHARE_WIDTH, height: 2160, dpr: 1 } },
        { pageNumber: 2, topPx: 2038.97, bottomPx: 4000,
          box: { surface: 'share', width: SHARE_WIDTH, height: 2160, dpr: 1 } },
      ],
    });
  });

  it('fills a page to exactly the rung and no further', () => {
    const exact = chooseShareSlices([2160, 2160.01], 4320);
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    expect(exact.slices.map((slice) => slice.bottomPx)).toEqual([2160, 4320]);
  });

  it('treats the document’s own bottom edge as a legal last break', () => {
    // 40 px of bottom padding is not content and draws no unit's box, so a fill that had to land on a
    // candidate would report `unbreakable-content` about the end of a finished invitation.
    const out = chooseShareSlices([], 500);
    expect(out).toEqual({
      ok: true,
      page_count: 1,
      slices: [{ pageNumber: 1, topPx: 0, bottomPx: 500,
        box: { surface: 'share', width: SHARE_WIDTH, height: 2160, dpr: 1 } }],
    });
  });

  it('refuses past §5’s ceiling with the count and the ceiling, and names the ceiling it used', () => {
    const breaks = [2000, 4000, 6000, 8000, 10000, 12000];
    const out = chooseShareSlices(breaks, 12043.31);
    expect(out).toEqual({ ok: false, reason: 'too-many-pages', pages: 6, ceiling: MAX_SHARE_PAGES });
    expect(MAX_SHARE_PAGES).toBe(4);
  });

  it('refuses an over-tall unit rather than separating a ceremony from where it is', () => {
    // The measured 44 px-lead, forty-direction-line case: the opening ends at 336.66 and the single
    // ceremony runs to 3478.06 — 3113.4 px, taller than any page the ladder offers.
    expect(chooseShareSlices([336.66, 3478.06], 3563.06)).toEqual({
      ok: false,
      reason: 'unbreakable-content',
      pages_before_stuck: 1,
      stuck_at_px: 336.66,
      next_break_px: 3478.06,
      page_height_px: SHARE_PAGE_HEIGHT_PX,
    });
    // …and a document whose very first unit is the over-tall one gets no page at all.
    expect(chooseShareSlices([3113.4], 3563.06)).toEqual({
      ok: false,
      reason: 'unbreakable-content',
      pages_before_stuck: 0,
      stuck_at_px: 0,
      next_break_px: 3113.4,
      page_height_px: SHARE_PAGE_HEIGHT_PX,
    });
  });

  it('reports a broken measurement as a broken measurement', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(chooseShareSlices([100], bad)).toEqual({ ok: false, reason: 'content-not-measurable' });
    }
  });

  it('ignores a candidate that is not an offset inside the document', () => {
    // The collector is supposed to hand only drawn units' bottoms, but this is the function that turns
    // a list into a page count, so a stray non-number or an offset past the document has to be unable to
    // invent a page break — the same defence `chooseShareBox` keeps against a negative height.
    const out = chooseShareSlices([0, -40, Number.NaN, Number.POSITIVE_INFINITY, 12000, 2038.97], 2923.78);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.slices.map((slice) => slice.bottomPx)).toEqual([2038.97, 2923.78]);
  });
});

describe('the papers', () => {
  it('converts A4 and US Letter from their metric pair, not from memory', () => {
    expect(PAPERS.a4.widthMm).toBe(210);
    expect(PAPERS.a4.heightMm).toBe(297);
    expect(PAPERS.a4.widthIn).toBeCloseTo(8.2677, 3);
    expect(PAPERS.a4.heightIn).toBeCloseTo(11.6929, 3);
    expect(PAPERS.letter.widthIn).toBeCloseTo(8.5, 3);
    expect(PAPERS.letter.heightIn).toBeCloseTo(11, 3);
  });

  it('refuses any paper it was not given rules for', () => {
    expect(isPaperVariant('a4')).toBe(true);
    expect(isPaperVariant('letter')).toBe(true);
    for (const not of ['A4', 'legal', 'a5', '', null, undefined, 4, { variant: 'a4' }]) {
      expect(isPaperVariant(not)).toBe(false);
    }
  });

  it('states its margin rather than leaving it to Chromium', () => {
    expect(PDF_MARGIN_IN).toBe(0.5);
  });
});

describe('the print parameter set', () => {
  // `PDF_MEDIA_BOX_PT` is the only number in this file that came from a browser rather than from a
  // product decision, and these tests do not re-measure it. They check that the table is *internally*
  // true — that one sheet in points and the same sheet in millimetres are the same sheet — and that the
  // delta from the nominal paper is the delta the probe found. Confirming it against a live Chromium is
  // the raster tier's `pdf-box-*` assertions; this file is what makes a changed expectation visible
  // without a browser open.
  const ptToMm = (points: number) => (points * 25.4) / 72;

  it('asks for every field by name, so a Chromium default cannot decide the sheet', () => {
    // The set is pinned as a key list, not just a value check, because the dangerous addition is a
    // `scale` or a `pageRanges` arriving unnoticed: either one would change what a page of the
    // document *is* while still writing a valid file under the same name.
    const expectedKeys = [
      'marginBottom', 'marginLeft', 'marginRight', 'marginTop',
      'generateTaggedPDF', 'paperHeight', 'paperWidth', 'preferCSSPageSize', 'printBackground',
    ].sort();
    for (const variant of ['a4', 'letter'] as const) {
      expect(Object.keys(pdfPrintParams(variant)).sort()).toEqual(expectedKeys);
    }
  });

  it('prints the paper `PAPERS` declares, in the unit CDP takes', () => {
    expect(pdfPrintParams('a4')).toMatchObject({
      paperWidth: PAPERS.a4.widthIn,
      paperHeight: PAPERS.a4.heightIn,
    });
    expect(pdfPrintParams('letter')).toMatchObject({
      paperWidth: PAPERS.letter.widthIn,
      paperHeight: PAPERS.letter.heightIn,
    });
  });

  it('keeps the margin on all four sides and identical across papers', () => {
    for (const variant of ['a4', 'letter'] as const) {
      const params = pdfPrintParams(variant);
      expect([params.marginTop, params.marginBottom, params.marginLeft, params.marginRight])
        .toEqual([PDF_MARGIN_IN, PDF_MARGIN_IN, PDF_MARGIN_IN, PDF_MARGIN_IN]);
    }
    // Choosing a paper must not be a way to choose a margin.
    const sides = (p: ReturnType<typeof pdfPrintParams>) =>
      [p.marginTop, p.marginBottom, p.marginLeft, p.marginRight];
    expect(sides(pdfPrintParams('a4'))).toEqual(sides(pdfPrintParams('letter')));
  });

  it('states the two flags the probe measured as inherited or inert', () => {
    // `generateTaggedPDF` because Chromium 155 tags a print even when the flag is absent, and a flipped
    // upstream default would otherwise silently stop shipping §5's tagged file; `preferCSSPageSize: false`
    // because an injected `@page` was measured as not heard at all, so the stylesheet is not a second
    // source of paper geometry in this pipeline.
    for (const variant of ['a4', 'letter'] as const) {
      expect(pdfPrintParams(variant)).toMatchObject({
        generateTaggedPDF: true,
        preferCSSPageSize: false,
        printBackground: true,
      });
    }
  });

  it('is a pure function of the variant', () => {
    expect(pdfPrintParams('a4')).toEqual(pdfPrintParams('a4'));
  });

  it('keeps the point table and the millimetre table the same sheet', () => {
    // Three decimals in the millimetre table against the exact conversion is the measured rounding, so
    // the check is at that precision — a looser one would let a wrong box through, a tighter one would
    // fail on the rounding the probe itself reported.
    for (const variant of ['a4', 'letter'] as const) {
      expect(ptToMm(PDF_MEDIA_BOX_PT[variant].width)).toBeCloseTo(PDF_MEDIA_BOX_MM[variant].width, 3);
      expect(ptToMm(PDF_MEDIA_BOX_PT[variant].height)).toBeCloseTo(PDF_MEDIA_BOX_MM[variant].height, 3);
    }
  });

  it('discloses A4\'s quantisation instead of deriving around it', () => {
    // Both 8.27 in and the exact 210/25.4 in produce 595.91998 pt on this browser, which is why the
    // delta is a recorded number rather than something this file can compute from `PAPERS`.
    expect(PDF_MEDIA_BOX_MM.a4.deltaWidthMm).toBeGreaterThan(0);
    expect(ptToMm(PDF_MEDIA_BOX_PT.a4.width) - PAPERS.a4.widthMm)
      .toBeCloseTo(PDF_MEDIA_BOX_MM.a4.deltaWidthMm, 3);
    expect(ptToMm(PDF_MEDIA_BOX_PT.a4.height) - PAPERS.a4.heightMm)
      .toBeCloseTo(PDF_MEDIA_BOX_MM.a4.deltaHeightMm, 3);
    expect(PDF_MEDIA_BOX_MM.letter.deltaWidthMm).toBe(0);
    expect(PDF_MEDIA_BOX_MM.letter.deltaHeightMm).toBe(0);
    expect(ptToMm(PDF_MEDIA_BOX_PT.letter.width)).toBeCloseTo(PAPERS.letter.widthMm, 6);
    expect(ptToMm(PDF_MEDIA_BOX_PT.letter.height)).toBeCloseTo(PAPERS.letter.heightMm, 6);
  });
});

describe('the teaser ladder’s numbers', () => {
  it('floors the ladder at the smallest lead the product itself will draw', () => {
    expect(OG_FIT.leadFloorPx).toBe(22);
    expect(OG_FIT.leadCeilingPx).toBe(44);
  });

  it('lists steps that all sit inside its own range, descending', () => {
    const inside = OG_FIT.steps.every((s) => s >= OG_FIT.leadFloorPx && s <= OG_FIT.leadCeilingPx);
    expect(inside).toBe(true);
    const descending = OG_FIT.steps.every((s, i) => i === 0 || OG_FIT.steps[i - 1] > s);
    expect(descending).toBe(true);
    expect(OG_FIT.steps.length).toBeGreaterThan(0);
  });

  it('includes the renderer’s default lead, so an unstyled document starts on the ladder', () => {
    expect([...OG_FIT.steps]).toContain(26);
  });

  it('caps pages and bytes, because §11.4’s bounds need numbers', () => {
    expect(MAX_PDF_PAGES).toBe(12);
    expect(MAX_SHARE_PAGES).toBe(4);
    expect(BYTE_CEILINGS.png).toBe(5 * 1024 * 1024);
    expect(BYTE_CEILINGS.pdf).toBe(20 * 1024 * 1024);
  });
});

describe('the drop order', () => {
  it('is a fixed list, named in the order it is applied', () => {
    expect([...OG_DROP_ORDER].map((d) => d.id)).toEqual([
      'closing-prose',
      'opening-prose',
      'body-text',
      'later-event-lists',
      'people-list',
    ]);
  });

  it('selects only elements the renderer already stamps, never a tag or a class', () => {
    // A selector that named `h1`, `.prose` or an `nth-child` position would make the teaser’s
    // content depend on how the component happens to be marked up this week. `data-render-*` is
    // the renderer’s own contract, asserted where the sections are drawn.
    //
    // The form is constrained further than “a data-render attribute”, because the one way to write
    // these selectors wrongly is the way that fails silently: a space turns a compound selector into
    // a descendant one, a body section stamps its own wrapper and nothing inside it, and the drop
    // then matches no node at all. The ladder would still measure, still refuse, and the tier would
    // read a no-op drop as a genuine attempt to give up content.
    for (const drop of OG_DROP_ORDER) {
      expect(drop.selector).toMatch(
        /^\[data-render-[a-z-]+(='[a-z_]+')?\](\[data-render-[a-z-]+(='[a-z_]+')?\])?$/);
    }
  });

  it('keeps the first ceremony — the teaser’s whole point — and drops only later ones', () => {
    // The addressable unit is the event the renderer drew, not the section that lists them:
    // `data-render-event-position` counts drawn events, so “first” means the first one a guest sees
    // rather than the first row of a frozen array.
    const events = OG_DROP_ORDER.find((d) => d.id === 'later-event-lists');
    expect(events?.keepFirstOf).toBe(1);
    expect(events?.selector).toBe('[data-render-event-position]');
    const wholeLists = OG_DROP_ORDER.filter((d) => d.selector.includes('event_list')).length;
    expect(wholeLists).toBe(0);
  });

  it('carries no entry that could remove the title', () => {
    // There is no `title` region or kind to select, which is the structural reason the ladder
    // cannot drop it: the refusal below is the only remaining answer.
    expect(OG_DROP_ORDER.some((d) => /title|header|h1/i.test(d.selector))).toBe(false);
  });
});

describe('planOgFit', () => {
  it('keeps the document’s own lead when it already fits', async () => {
    const out = await planOgFit(30, () => 500);
    expect(out).toEqual({ ok: true, plan: { leadPx: 30, dropped: [] }, measuredHeightPx: 500 });
  });

  it('clamps an out-of-range lead before it plans, so a saved 3 px cannot print small', async () => {
    expect(await planOgFit(3, () => 500)).toEqual({
      ok: true,
      plan: { leadPx: 22, dropped: [] },
      measuredHeightPx: 500,
    });
    expect(await planOgFit(120, () => 500)).toEqual({
      ok: true,
      plan: { leadPx: 44, dropped: [] },
      measuredHeightPx: 500,
    });
  });

  it('walks the ladder down to the size that fits', async () => {
    const seen: number[] = [];
    const out = await planOgFit(44, (plan) => {
      seen.push(plan.leadPx);
      return plan.leadPx <= 32 ? 620 : 700;
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.plan).toEqual({ leadPx: 32, dropped: [] });
    expect(seen).toEqual([44, 40, 36, 32]);
  });

  // The planner is `async` for exactly one reason: a real `measure` is a CDP round trip, and taking a
  // promise is what keeps the ladder's order in this file instead of re-implemented in the worker. A
  // synchronous fake proves the arithmetic; the delayed one below proves the sequencing survives the
  // awaits, which is what would break if a rung could ever be tried twice out of order.
  it('waits for a measurement rather than assuming one', async () => {
    const out = await planOgFit(44, (plan) => new Promise((resolveHeight) => {
      setTimeout(() => resolveHeight(plan.leadPx <= 36 ? 610 : 900), 1);
    }));
    expect(out).toEqual({ ok: true, plan: { leadPx: 36, dropped: [] }, measuredHeightPx: 610 });
  });

  it('scales before it drops — losing type is better than losing a line', async () => {
    const attempts: OgFitPlan[] = [];
    await planOgFit(44, (plan) => {
      attempts.push(plan);
      return plan.dropped.length === 0 ? 700 : 500;
    });
    // Every rung of the ladder is tried with nothing dropped before the first drop is proposed.
    const rungs = attempts.filter((a) => a.dropped.length === 0);
    expect(rungs.length).toBe(OG_FIT.steps.length);
    expect(rungs.map((a) => a.leadPx)).toEqual([...OG_FIT.steps]);
    expect(attempts[rungs.length - 1].dropped).toEqual([]);
    expect(attempts[rungs.length].dropped).toEqual(['closing-prose']);
  });

  it('drops in the stated order, one at a time, only at the floor', async () => {
    const attempts: OgFitPlan[] = [];
    const out = await planOgFit(30, (plan) => {
      attempts.push(plan);
      if (plan.dropped.length === 0) return 800;
      return plan.dropped.includes('opening-prose') ? 600 : 700;
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.plan).toEqual({ leadPx: 22, dropped: ['closing-prose', 'opening-prose'] });
    }
    const dropAttempts = attempts.filter((a) => a.dropped.length > 0);
    expect(dropAttempts.map((a) => a.dropped)).toEqual([
      ['closing-prose'],
      ['closing-prose', 'opening-prose'],
    ]);
    // and every drop happened at the floor, never at a larger lead.
    expect(dropAttempts.every((a) => a.leadPx === OG_FIT.leadFloorPx)).toBe(true);
  });

  it('refuses with a named reason when the floor and every drop are not enough', async () => {
    const out = await planOgFit(26, () => 4000);
    expect(out).toEqual({ ok: false, reason: 'teaser-does-not-fit' });
  });

  it('tries every rung and every drop before it refuses — a loop over nothing is not a ladder', async () => {
    const calls: OgFitPlan[] = [];
    await planOgFit(44, (plan) => {
      calls.push(plan);
      return 5000;
    });
    const rungs = [44, 40, 36, 32, 28, 26, 24, 22];
    expect(calls.length).toBe(rungs.length + OG_DROP_ORDER.length);
    expect(calls[0]).toEqual({ leadPx: 44, dropped: [] });
    expect(calls[calls.length - 1].dropped.length).toBe(OG_DROP_ORDER.length);
  });

  it('reports a broken measurement instead of planning around it', async () => {
    expect(await planOgFit(30, () => 0)).toEqual({ ok: false, reason: 'height-not-measurable' });
    expect(await planOgFit(30, () => Number.NaN)).toEqual({ ok: false, reason: 'height-not-measurable' });
    expect(await planOgFit(30, () => -4)).toEqual({ ok: false, reason: 'height-not-measurable' });
  });

  it('is deterministic: the same measurements plan the same artefact', async () => {
    const height = (plan: OgFitPlan) => (plan.leadPx <= 24 ? 620 : 700);
    const first = await planOgFit(40, height);
    const second = await planOgFit(40, height);
    expect(second).toEqual(first);
    expect(first.ok).toBe(true);
  });
});
