// The plate's geometry, turned into rectangles — the only place that mapping lives.
//
// `./qrPlate` decides the numbers (version, module scale, centred offset, quiet zone) and
// `./QrCanvas` is the element; this file is the pass between them. It is separate from the
// component for the reason §9.4 records: the encoder's own canvas and PNG renderers compute a
// *fractional* module size from a total image size, which is exactly the thing §5 refuses. The
// harness draws the squares itself so an integer scale has one owner and one test surface.
//
// Two properties this function owns:
//
//   * **The background is painted, not assumed.** A canvas starts transparent; a scanner that
//     composites a PNG onto a dark viewer page sees no contrast at all. So the whole nominal box is
//     filled white first, which is also what makes the leftover pixels around the plate a *quiet
//     zone* rather than an undefined area.
//   * **Every module is a whole rectangle at a whole-pixel position.** Nothing here divides by
//     anything: `scale`, `offsetX` and `offsetY` arrive integers from `./qrPlate`, so a sub-pixel
//     module — the failure §5 refuses, and the one a printer blurs at a guest's door — cannot be
//     introduced by this file.
//
// A canvas with no 2D context is not a condition this file can render around: the only honest answer
// is to fail the mount, so the caller gets a rejection instead of a `ready` state and a blank
// artefact. Chromium always gives one; that is a measurement from the Stage 9 plate proof, recorded
// in `docs/audits/stage-9-render-exports.md`, not an assumption made here.

import { QR_QUIET_ZONE_MODULES, type QrPlate } from "./qrPlate";

const DARK = "#000000";
const LIGHT = "#ffffff";

/** Paint `plate` into `canvas`, at whole pixels per module, centred in the nominal box.
 *
 *  The symbol starts at `offsetX + 4 × scale`, not at `offsetX`: `platePixels` already counts the
 *  quiet zone (§5's four modules on each side), so mapping module (0,0) to the plate's own corner
 *  would place the finder pattern against the quiet zone and leave all eight spare columns on the
 *  far side. That is the difference between a plate whose margins are a stated geometry and a plate
 *  whose margins are wherever the drawing happened to stop.
 *
 *  Exported for the unit battery: a jsdom canvas has no 2D context, so what the test can prove is
 *  the arithmetic this function performs — which pixels it would set and where. */
export const paintPlate = (canvas: HTMLCanvasElement, plate: QrPlate): void => {
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("qr plate: this canvas has no 2D context");
  }
  const { moduleScale, offsetX, offsetY, modules, matrix } = plate;
  const symbolX = offsetX + QR_QUIET_ZONE_MODULES * moduleScale;
  const symbolY = offsetY + QR_QUIET_ZONE_MODULES * moduleScale;
  context.fillStyle = LIGHT;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = DARK;
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (matrix[row * modules + column] === 1) {
        context.fillRect(
          symbolX + column * moduleScale,
          symbolY + row * moduleScale,
          moduleScale,
          moduleScale,
        );
      }
    }
  }
};
