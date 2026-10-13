// The geometry an exported artefact is cut to, in one file, with no DOM and no browser.
//
// Why this lives beside the renderer instead of inside a worker script: every number here is a
// promise a manifest row, an artefact's pixels and a qualification tier all have to agree about.
// Put in `scripts/`, it would be re-derivable only by reading an instrument; put here, it is
// pinned by `src/test/outputGeometry.test.ts` and imported by the worker that applies it, so an
// artefact cut to the wrong box fails at the same source the unit battery reads.
//
// Why the worker still owns the *decision*: `render.css:9-16` records that fitting a teaser to a
// box needs a measured content height, which no stylesheet has. So this file states the ladder —
// which boxes exist, what steps may be taken down it, in what order lines may be dropped, and
// which lines may never be dropped — and the worker walks it against what Chromium actually laid
// out. The two halves of that division are what keeps §5's "never cropped, no mid-string
// truncation" a rule rather than a hope: nothing here can clip, and nothing in a browser can
// invent a step this file does not list.
//
// What is deliberately *not* here: colours, spacings, and any restatement of the renderer's own
// lead clamp. The floor of the teaser ladder is the smallest lead the product already agrees to
// draw for a guest (§ `InvitationRenderer.leadSize`: 22 px), because "legible on a phone in a chat
// window" has one defensible anchor in this repository and inventing a second number would be a
// design opinion dressed as a measurement.

/** The teaser box, exactly as §5 states it. DPR 1: a crawler's card is fetched and re-encoded by
 *  the messenger, so a hi-DPI source buys nothing a real preview will show. */
export const OG_BOX = { surface: 'og', width: 1200, height: 630, dpr: 1 } as const;

/** The share canvas's fixed width. Height is quantised; width never is, because a chat window
 *  scales a tall image and a wide one alike, but a variable width would make the four boxes
 *  incomparable — and the boxes exist so "legible at thumbnail size" is a testable claim (§5). */
export const SHARE_WIDTH = 1080;

/** The four quantised share heights, shortest first. */
export const SHARE_HEIGHTS = [1350, 1620, 1800, 2160] as const;

export type ShareHeight = (typeof SHARE_HEIGHTS)[number];

export interface ShareBox {
  surface: 'share';
  width: number;
  height: ShareHeight;
  dpr: number;
}

/**
 * Pick the smallest quantised box a laid-out document fits, or say it does not fit any.
 *
 * Returning `'paginate'` rather than a taller box is the whole of §5's overflow contract: a
 * document longer than 1080×2160 continues onto a second page *of the same set*, which is why
 * `variant` and `page_number` are separate columns in the manifest §7.2 specifies — a shape this
 * file is written against, not yet a table that exists; the migration is a later slice of this
 * stage — and why no number in this file is a ceiling on content. A negative or non-finite height
 * is a broken measurement, not a small document, and is reported as such rather than quietly
 * choosing the first box.
 */
export function chooseShareBox(
  contentHeightPx: number,
): { ok: true; box: ShareBox } | { ok: false; reason: 'height-not-measurable' | 'paginate' } {
  if (!Number.isFinite(contentHeightPx) || contentHeightPx <= 0) {
    return { ok: false, reason: 'height-not-measurable' };
  }
  for (const height of SHARE_HEIGHTS) {
    if (contentHeightPx <= height) {
      return { ok: true, box: { surface: 'share', width: SHARE_WIDTH, height, dpr: 1 } };
    }
  }
  return { ok: false, reason: 'paginate' };
}

/** Print papers in inches, which is the unit `Page.printToPDF` takes. A4 is 210×297 mm exactly
 *  (8.2677…×11.6929…); US Letter is 215.9×279.4 mm. Kept as the metric pair plus the derived
 *  inches so a reader can check the conversion instead of trusting it. */
export const PAPERS = {
  a4: { label: 'A4 · 210 × 297 mm', widthMm: 210, heightMm: 297, widthIn: 210 / 25.4, heightIn: 297 / 25.4 },
  letter: { label: 'US Letter · 215.9 × 279.4 mm', widthMm: 215.9, heightMm: 279.4, widthIn: 215.9 / 25.4, heightIn: 279.4 / 25.4 },
} as const;

export type PaperVariant = keyof typeof PAPERS;

export const isPaperVariant = (value: unknown): value is PaperVariant =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PAPERS, value);

/** Page margins in inches. 12.7 mm is the widest margin the paper can carry without pushing the
 *  renderer's own column out of the sheet, and it is stated here rather than left to Chromium's
 *  default (0.39 in on every side, plus a header and footer the product never asked for). */
export const PDF_MARGIN_IN = 0.5;

/**
 * The teaser's fit ladder.
 *
 * `leadFloorPx` is the product's own minimum lead (see the file header). `steps` are the lead
 * sizes, descending, the worker may draw the teaser at: the document's own clamped lead first,
 * then each step down, stopping at the floor. A ladder of *sizes* rather than of scale factors
 * keeps the recorded value a px number a manifest can state and a re-render can honour exactly —
 * a factor would depend on what the lead happened to be, and two hosts with different leads would
 * get different artefacts from the same rendered size.
 */
export const OG_FIT = {
  leadFloorPx: 22,
  leadCeilingPx: 44,
  steps: [44, 40, 36, 32, 28, 26, 24, 22] as const,
} as const;

/**
 * The lines a teaser may drop, in the order it drops them, and the last thing the ladder will do
 * before refusing.
 *
 * Each entry is an attribute selector over the elements the renderer already stamps
 * (`data-render-region`, `data-render-kind`, `data-render-event-position`) plus one instruction the
 * worker applies by rule, not by CSS: `keepFirstOf` hides every match except the first in document
 * order. The order is a product decision, stated once: a sign-off and a blessing line are the first
 * casualties, a second ceremony's detail list is next, and the people block — who is being called —
 * goes last, because §5's teaser contract is *title, the people block, the first event's date/time
 * and venue*. The title and the first event are in no entry at all: when the floor and the drops are
 * both used up, the answer is `teaser-does-not-fit` (§12's named refusal), never a clipped file.
 *
 * Two of these selectors are compound (no space) and one targets `data-render-event-position`, and
 * each is that way for a reason a loose selector would hide. A body section stamps its **own**
 * wrapper with both `data-render-region='body'` and `data-render-kind=…` — the elements inside it
 * carry no stamps (`src/components/invitation/InvitationRenderer.tsx:341-354`) — so a descendant
 * selector would match nothing,
 * and a drop that matches nothing is a silent no-op the tier would read as "the ladder tried
 * dropping it and the document still did not fit". The ceremony list is deliberately not addressed by
 * its section: the unit that may be given up is one ceremony, which is what the renderer's per-event
 * position stamp means, and `keepFirstOf: 1` over those stamps is "show the first ceremony" in the
 * same words the renderer uses.
 */
export const OG_DROP_ORDER = [
  { id: 'closing-prose', selector: "[data-render-region='closing']", keepFirstOf: null },
  { id: 'opening-prose', selector: "[data-render-region='opening']", keepFirstOf: null },
  { id: 'body-text', selector: "[data-render-region='body'][data-render-kind='text']", keepFirstOf: null },
  { id: 'later-event-lists', selector: '[data-render-event-position]', keepFirstOf: 1 },
  { id: 'people-list', selector: "[data-render-kind='people_list']", keepFirstOf: null },
] as const;

export type OgDropId = (typeof OG_DROP_ORDER)[number]['id'];

/** The ladder's shape: a lead size plus the drops applied to reach it, in order. The worker
 *  reports one of these per artefact, and the manifest folds it into `render_config_hash` (§7.2)
 *  so "this teaser was drawn at 24 px with the sign-off gone" is a fact about the file, not a
 *  guess from its pixels. */
export interface OgFitPlan {
  leadPx: number;
  dropped: OgDropId[];
}

/**
 * The ladder's *rule*, given what the document's own lead is and how tall it laid out.
 *
 * `measure` is the worker's, because only a browser knows the height; this function decides what
 * may be tried with it, in what order, and when to stop. It makes no measurement of its own and
 * holds no state, so the whole ladder — including the refusal — is testable without a Chromium
 * process, and a tier that measures a real render and a unit that plans one are checking the same
 * table.
 *
 * It is `async` because its one dependency is: a real `measure` is a CDP round trip. Accepting a
 * promise is what keeps the *order* here rather than re-implementing it in the worker, and a test
 * can still hand it a synchronous fake — `await` of a plain number is that number.
 *
 * Order of attempts, fixed: the host's own lead with nothing dropped, then each remaining step at
 * nothing dropped, then the floor with drops one at a time. Scaling before dropping, because a
 * smaller type keeps the host's words and a dropped line does not — and losing content is the
 * worse outcome of the two.
 */
export async function planOgFit(
  documentLeadPx: number,
  measure: (plan: OgFitPlan) => number | Promise<number>,
): Promise<
  { ok: true; plan: OgFitPlan; measuredHeightPx: number }
  | { ok: false; reason: 'teaser-does-not-fit' | 'height-not-measurable' }
> {
  const lead = Math.min(OG_FIT.leadCeilingPx, Math.max(OG_FIT.leadFloorPx, documentLeadPx));
  const sizes = [lead, ...OG_FIT.steps.filter((step) => step < lead && step >= OG_FIT.leadFloorPx)];

  for (const size of sizes) {
    const height = await measure({ leadPx: size, dropped: [] });
    if (!Number.isFinite(height) || height <= 0) return { ok: false, reason: 'height-not-measurable' };
    if (height <= OG_BOX.height) return { ok: true, plan: { leadPx: size, dropped: [] }, measuredHeightPx: height };
    if (size === OG_FIT.leadFloorPx) break;
  }

  // At the floor, start dropping — one line at a time, in the order above, re-measuring each
  // width because a single drop can free the whole box.
  const dropped: OgDropId[] = [];
  for (const drop of OG_DROP_ORDER) {
    dropped.push(drop.id);
    const plan: OgFitPlan = { leadPx: OG_FIT.leadFloorPx, dropped: [...dropped] };
    const height = await measure(plan);
    if (!Number.isFinite(height) || height <= 0) return { ok: false, reason: 'height-not-measurable' };
    if (height <= OG_BOX.height) return { ok: true, plan, measuredHeightPx: height };
  }
  return { ok: false, reason: 'teaser-does-not-fit' };
}

/** Ceiling on pages the worker will lay out for one document, and the reason it exists: §11.4's
 *  "bounded execution" is meaningless without a number, and a document that reaches it is a
 *  finding about that document rather than an infinite render. */
export const MAX_PDF_PAGES = 12;
export const MAX_SHARE_PAGES = 4;

/** Byte ceilings, from §8's bucket limits, applied *before* a file is written or uploaded: an
 *  overrun is a `failed` row with a named reason (§12), never a truncated artefact. */
export const BYTE_CEILINGS = {
  png: 5 * 1024 * 1024,
  webp: 5 * 1024 * 1024,
  pdf: 20 * 1024 * 1024,
  qr: 1 * 1024 * 1024,
} as const;

export type ArtefactFormat = keyof typeof BYTE_CEILINGS;
