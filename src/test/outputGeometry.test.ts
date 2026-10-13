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
  SHARE_HEIGHTS,
  SHARE_WIDTH,
  chooseShareBox,
  isPaperVariant,
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
