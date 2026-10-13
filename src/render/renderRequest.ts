// The one reader of a render request.
//
// A render request is the value a local operator's worker hands to `render.html`, and it is the
// only place an outside thing can talk to a document that draws somebody's wedding. So the
// interface is two fields, and the shape of this module is the reason the design's promise
// ("the render harness never accepts HTML, a file path, a remote URL, a font name or a stylesheet
// as input", §11.1) is a fact about the code rather than a hope about the caller.
//
// What a caller cannot do, in order of how much it would have cost:
//
//   * **Name a fourth field.** The result is built key by key, so `html`, `stylesheet`, `font`,
//     `file`, `url`, `width`, `csp` and anything else an object carries is dropped on the floor.
//     Not sanitised — dropped. Nothing here knows how to render markup, point at a path, or load
//     a stylesheet, because nothing here can be *given* one.
//   * **Smuggle a document.** `dto` goes through `parseInvitationObject`, the same wholesale
//     refusal a guest's page and a family reviewer's page already go through
//     (`src/lib/publicInvitation.ts:345`). A projection this parser refuses cannot print, which
//     keeps the render path from becoming a second, laxer reader of the same bytes.
//   * **Guess a surface.** Anything but one of the three exact strings is a refusal, so a typo
//     in a worker cannot quietly produce a full-page PDF filed as a teaser.
//
// A refusal says which rule fired and never repeats what it was handed: the reason string is the
// thing that ends up in a log line and a manifest column, and an echoed value would put a
// caller's bytes into an operator's terminal.

import { parseInvitationObject, type PublicInvitation } from "@/lib/publicInvitation";
import { isRenderSurface, type RenderSurface } from "@/lib/renderSurfaces";

/** A render request, after the door: one surface, one document, and nothing else. */
export interface RenderRequest {
  surface: RenderSurface;
  invitation: PublicInvitation;
}

/** Why the door closed. A fixed vocabulary — a reason is a fact about this module, not a quote
 *  from the caller. */
export type RenderRefusalReason = "not-an-object" | "surface-unknown" | "invitation-refused";

export const RENDER_REFUSAL_REASONS: readonly RenderRefusalReason[] = [
  "not-an-object",
  "surface-unknown",
  "invitation-refused",
];

export type RenderOutcome =
  | { ok: true; request: RenderRequest }
  | { ok: false; reason: RenderRefusalReason };

const refused = (reason: RenderRefusalReason): RenderOutcome => ({ ok: false, reason });

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Read a render request, or refuse it by rule name.
 *
 * Total and side-effect-free: nothing here fetches, opens a file, touches the DOM or throws on
 * hostile input, which is what lets the same function answer both the harness in a browser and
 * the unit battery in a Node process.
 */
export function parseRenderRequest(value: unknown): RenderOutcome {
  const raw = asObject(value);
  if (raw === null) return refused("not-an-object");
  if (!isRenderSurface(raw.surface)) return refused("surface-unknown");

  const invitation = parseInvitationObject(raw.dto);
  if (invitation === null) return refused("invitation-refused");

  // Built field by field, so `request` is a value this module constructed rather than an object
  // the caller owns: the two keys below are the whole interface, and a wider surface vocabulary
  // has to be widened in `src/lib/renderSurfaces.ts` first, where the CSS rules live beside it.
  return { ok: true, request: { surface: raw.surface, invitation } };
}
