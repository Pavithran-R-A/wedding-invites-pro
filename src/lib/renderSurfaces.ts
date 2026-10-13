// The three render surfaces Stage 9 exports, named in one place.
//
// Why this lives in `src/lib/` rather than in the harness: the same word has to reach two
// different kinds of file, and a drift between them is a silent layout bug. The renderer stamps
// it onto the article as `data-render-surface`, which is a *hook* — with no stylesheet bound to
// it, nothing about a guest's page changes. `src/render/render.css` is that stylesheet, and it
// only exists for the harness document, so an artefact's geometry can never be shipped to a
// browser that renders the live invitation.
//
// Each surface is a *canvas*, not a document type:
//
//   `og`     1200×630, the crawler-facing teaser. Drawn from the same component, but it is a
//            teaser by contract (§5) and the manifest must never describe it as the invitation.
//   `share`  1080 wide, quantised to one of four heights, the whole document a guest can attach
//            in a chat. Never cropped — a longer document paginates within the same set.
//   `pdf`    A4 or US Letter, paginated, with the map link kept because a PDF can carry a real
//            link annotation and a PNG cannot.
//
// The set is closed on purpose. A fourth value is a refusal at the harness door rather than a
// string that reaches CSS, because an unrecognised surface would render the live page's geometry
// and be filed as an artefact of whichever box the worker asked for.

/** The surfaces a render request may name. Extend this list, `render.css` and the §7 `variant`
 *  CHECK together, or the export tier goes red on the artefact that has no rules. */
export const RENDER_SURFACES = ["og", "share", "pdf"] as const;

export type RenderSurface = (typeof RENDER_SURFACES)[number];

/** Is this string one of the surfaces? Written as a predicate so the harness, the worker and any
 *  later UI share one answer instead of each keeping a `Set` of the same three words. */
export const isRenderSurface = (value: unknown): value is RenderSurface =>
  typeof value === "string" && (RENDER_SURFACES as readonly string[]).includes(value);
