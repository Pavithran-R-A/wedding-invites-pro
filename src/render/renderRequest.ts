// The one reader of a render request.
//
// A render request is the value a local operator's worker hands to `render.html`, and it is the
// only place an outside thing can talk to a document that draws somebody's wedding. So the
// interface is two fields per kind of artefact, and the shape of this module is the reason the
// design's promise ("the render harness never accepts HTML, a file path, a remote URL, a font name
// or a stylesheet as input", §11.1) is a fact about the code rather than a hope about the caller.
//
// There are two kinds of request because there are two kinds of artefact:
//
//   * a **document** on one of the three canvases (`og`, `share`, `pdf`), which is one frozen
//     invitation projected into `InvitationRenderer`;
//   * a **plate** (`qr`), which draws no document at all — it is one authorised public address put
//     through the §9.3 door and the §5 geometry, because an invitation's QR code is a function of
//     its URL, not of its content.
//
// What a caller cannot do, in order of how much it would have cost:
//
//   * **Name another field.** Each result is built key by key, so `html`, `stylesheet`, `font`,
//     `file`, `url`, `width`, `csp` and anything else an object carries is dropped on the floor.
//     Not sanitised — dropped. Nothing here knows how to render markup, point at a path, or load
//     a stylesheet, because nothing here can be *given* one. A `dto` alongside a `qr` request is
//     dropped the same way, and a `target` alongside a document request is dropped with it.
//   * **Smuggle a document.** `dto` goes through `parseInvitationObject`, the same wholesale
//     refusal a guest's page and a family reviewer's page already go through
//     (`src/lib/publicInvitation.ts:345`). A projection this parser refuses cannot print, which
//     keeps the render path from becoming a second, laxer reader of the same bytes.
//   * **Guess a surface.** Anything but one of the four exact strings is a refusal, so a typo in a
//     worker cannot quietly produce a full-page PDF filed as a teaser.
//   * **Point a plate at a private address.** `./qrTarget` refuses anything that is not `https`,
//     carries credentials or a query, resolves to a private origin, opens a household or
//     family-review door, or has a path other than `/i/` plus one 43-character token (§9.3). The
//     reason the *harness* repeats that door rather than trusting the worker: a printed plate is
//     the one output that leaves the house and ends up in a stranger's camera, and the credential
//     it would expose is one the operator may not even know they handed over.
//   * **Ask for a plate that cannot scan.** `./qrPlate` refuses a variant it does not know, a
//     target the encoder cannot fit, and a symbol whose modules would fall under §4's legibility
//     floor — `plate-too-dense`, not a smaller QR (§5).
//
// What the door does *not* decide is whether a well-shaped `https://…/i/<token>` belongs to *this*
// installation; `./qrTarget`'s header explains that non-claim and the compensating controls.
//
// A refusal says which rule fired and never repeats what it was handed: the reason string is the
// thing that ends up in a log line and a manifest column, and an echoed value would put a
// caller's bytes into an operator's terminal.

import { parseInvitationObject, type PublicInvitation } from "@/lib/publicInvitation";
import {
  isDocumentSurface,
  isRenderSurface,
  QR_SURFACE,
  type DocumentSurface,
  type QrSurface,
  type RenderSurface,
} from "@/lib/renderSurfaces";
import { buildQrPlate, type QrPlate, type QrPlateRefusal, type QrVariant } from "./qrPlate";
import { buildQrTarget, type QrTargetRefusal } from "./qrTarget";

/** A request for one of the three document canvases: one surface, one invitation, nothing else. */
export interface DocumentRenderRequest {
  surface: DocumentSurface;
  invitation: PublicInvitation;
}

/** A request for a printable plate. `target` is the canonicalised address `./qrTarget` produced,
 *  and `plate` is the geometry derived from it, so the pixels the harness paints and the numbers a
 *  manifest records are the same values rather than two readings of the caller's string. */
export interface QrRenderRequest {
  surface: QrSurface;
  variant: QrVariant;
  target: string;
  plate: QrPlate;
}

export type RenderRequest = DocumentRenderRequest | QrRenderRequest;

/** Why the door closed. A fixed vocabulary — a reason is a fact about this module, not a quote
 *  from the caller. The plate and target names are re-exported rather than renamed: one word for
 *  one rule, so a manifest column and a log line agree with the unit battery that pins them. */
export type RenderRefusalReason =
  | "not-an-object"
  | "surface-unknown"
  | "invitation-refused"
  | QrTargetRefusal
  | QrPlateRefusal;

export const RENDER_REFUSAL_REASONS: readonly RenderRefusalReason[] = [
  "not-an-object",
  "surface-unknown",
  "invitation-refused",
  "target-not-a-string",
  "target-unparsable",
  "target-not-https",
  "target-carries-credentials",
  "target-carries-query",
  "target-origin-not-public",
  "target-private-door",
  "target-path-shape",
  "qr-variant-unknown",
  "target-too-long",
  "plate-too-dense",
];

export type RenderOutcome =
  | { ok: true; request: RenderRequest }
  | { ok: false; reason: RenderRefusalReason };

const refused = (reason: RenderRefusalReason): RenderOutcome => ({ ok: false, reason });

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The plate branch: address first, geometry second, and both by rule name.
 *
 *  The order is the one that refuses the more dangerous thing first. A caller that hands over a
 *  household `/g/` credential and an impossible 60 mm box gets `target-private-door`, because the
 *  credential is the finding that matters; the geometry error would only ever be a log line about
 *  pixels. */
const parseQrRequest = (raw: Record<string, unknown>): RenderOutcome => {
  const target = buildQrTarget(raw.target);
  if (target.ok === false) return refused(target.reason);

  const plate = buildQrPlate(raw.variant, target.url);
  if (plate.ok === false) return refused(plate.reason);

  return {
    ok: true,
    request: {
      surface: QR_SURFACE,
      variant: plate.plate.variant,
      target: target.url,
      plate: plate.plate,
    },
  };
};

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

  if (raw.surface === QR_SURFACE) return parseQrRequest(raw);

  // The document branch is the only surface left, and it is still checked rather than assumed:
  // `isDocumentSurface` is what keeps this file honest if a fifth surface is added to the union in
  // `src/lib/renderSurfaces.ts` without a branch here to draw it.
  if (!isDocumentSurface(raw.surface)) return refused("surface-unknown");

  const invitation = parseInvitationObject(raw.dto);
  if (invitation === null) return refused("invitation-refused");

  // Built field by field, so `request` is a value this module constructed rather than an object
  // the caller owns: the keys below are the whole interface, and a wider surface vocabulary
  // has to be widened in `src/lib/renderSurfaces.ts` first, where the CSS rules live beside it.
  return { ok: true, request: { surface: raw.surface, invitation } };
}
