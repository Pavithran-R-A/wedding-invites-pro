// The plate: one address, one printable square of modules, at a scale a scanner can read.
//
// §5 promises three QR PNGs "for print (25 mm, 40 mm, 60 mm nominal)" and §9.4 promises "a canvas
// drawn at an exact integer module scale with the §5 quiet zone". Both are geometry, and geometry is
// where a QR either scans or does not, so this module is the only place that arithmetic lives and
// every number in `src/render/qrPlate.test.ts` was measured before it was asserted (the runs are in
// `q9-logs/qr-scratch/s9-qr-plate-pinned.txt`, `s9-qr-plate-toolong.txt` and
// `s9-qr-plate-matrix.txt`).
//
// Three rules, and the reason each is a rule rather than a preference:
//
//   * **The canvas is the nominal box, and the plate is drawn inside it.** A 40 mm artefact is 640 px
//     on a side whatever the address needs; the modules take the largest whole-pixel scale that fits,
//     centred, and the leftover pixels become extra quiet zone. Sizing the canvas to the drawn plate
//     instead would make "60 mm" a promise the file breaks whenever a host's address runs long, and a
//     host who ordered a 60 mm plate for a poster gets a 60 mm plate.
//   * **The scale is a whole number of pixels, and never fewer than 7.** A fractional module is worse
//     than a smaller one: a printer with a fixed dot grid would place the boundary between two dots,
//     so neighbouring modules blur into each other and the symbol fails at *every* size, not just the
//     dense ones. 7 px at 16 px/mm is 0.4375 mm, which is §4's legibility floor (0.4 mm) rounded up —
//     rounded down it would be a 0.375 mm dot and the floor would be a claim nobody measured.
//   * **Too dense is a refusal.** §5: "A URL that does not fit the chosen version/EC combination is a
//     refusal with a reason, not a smaller QR." The plate size is a decision about somebody's printed
//     invitation; quietly handing them a smaller one is not that decision, and it is invisible until a
//     guest's camera says no. So a long address on a 25 mm plate is `plate-too-dense`, and the same
//     address prints on 40 mm.
//
// The encoder is imported as `qrcode/lib/core/qrcode.js` and nothing else. That path is the matrix
// and the version/EC machinery only — the package's canvas, PNG and SVG renderers live behind
// `lib/browser.js`, and this app draws the modules itself in `./qrPaint`, because the plate's
// geometry has exactly one source of truth. The measured closure of the core path is 22 files and
// 64,098 bytes with one external package (`s9-qr-reachability-core.txt`); the full package would
// have been 29 files and 2.4 MB, and the whole dependency must stay reachable only from
// `dist/render.*`, never from a guest's bundle (§9.4).

import { create } from "qrcode/lib/core/qrcode.js";

/** Error correction level `M` is §5's choice: roughly 15 % of the codewords recoverable, which is
 *  what a plate that has been taped to a door, creased or printed on a slightly absorbent card needs.
 *  A higher level would need a bigger version for the same address, so this is a trade, not a maximum. */
export const QR_ERROR_CORRECTION_LEVEL = "M";

/** §5's quiet zone, in modules, on each of the four sides. */
export const QR_QUIET_ZONE_MODULES = 4;

/** The canvas's own density: 16 px to the millimetre, which makes 25/40/60 mm whole numbers of
 *  pixels and keeps "nominal print size" a fact about the file rather than a note in the UI. */
export const QR_PIXELS_PER_MILLIMETRE = 16;

/** §4's floor: a module narrower than this is a scan risk on a phone camera at arm's length. */
export const QR_MINIMUM_MODULE_MILLIMETRES = 0.4;

/** The floor expressed in the only unit a canvas has, rounded *up* — see the second rule above. */
export const QR_MINIMUM_MODULE_SCALE_PIXELS = Math.ceil(
  QR_MINIMUM_MODULE_MILLIMETRES * QR_PIXELS_PER_MILLIMETRE,
);

/** The three boxes §5 lists, in pixels at `QR_PIXELS_PER_MILLIMETRE`. */
export const QR_PRINT_BOX_PIXELS = {
  "25mm": 400,
  "40mm": 640,
  "60mm": 960,
} as const;

/** The variant names a render request may ask for. Spelled exactly, because a typo in a worker must
 *  refuse rather than quietly print the wrong plate. */
export const QR_VARIANTS = ["25mm", "40mm", "60mm"] as const;
export type QrVariant = (typeof QR_VARIANTS)[number];

export const isQrVariant = (value: unknown): value is QrVariant =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(QR_PRINT_BOX_PIXELS, value);

/** What the canvas needs to draw, and what the manifest describes. `matrix` is the symbol's content
 *  only — the quiet ring is geometry, so it is arithmetic the canvas does from `quietModules` rather
 *  than a second copy of the same fact in bytes. */
export interface QrPlate {
  variant: QrVariant;
  version: number;
  modules: number;
  quietModules: number;
  moduleScale: number;
  platePixels: number;
  canvasPixels: number;
  offsetX: number;
  offsetY: number;
  matrix: Uint8Array;
}

/** Why there is no plate. `target-too-long` is about the address and `plate-too-dense` is about the
 *  paper, and keeping them apart is what lets a host be told "choose a bigger plate" instead of "that
 *  link is too long". */
export type QrPlateRefusal = "qr-variant-unknown" | "plate-too-dense" | "target-too-long";

export const QR_PLATE_REFUSALS: readonly QrPlateRefusal[] = [
  "qr-variant-unknown",
  "plate-too-dense",
  "target-too-long",
];

export type QrPlateOutcome = { ok: true; plate: QrPlate } | { ok: false; reason: QrPlateRefusal };

const refused = (reason: QrPlateRefusal): QrPlateOutcome => ({ ok: false, reason });

/** The part of the encoder's result this module reads. Declared here because `qrcode` ships no types
 *  and the shape is the one fact about the dependency worth pinning: a flat, row-major matrix whose
 *  side is `size`, and the version it chose. */
interface QrSymbol {
  version: number;
  modules: { size: number; data: Uint8Array };
}

const createSymbol = create as (
  data: string,
  options: { errorCorrectionLevel: string },
) => QrSymbol;

/**
 * Build the plate for one address at one print size, or refuse by rule name.
 *
 * Total over strings, side-effect-free and deterministic: the same address and variant produce the
 * same matrix byte for byte, which is where §13's reproducibility claim starts — a re-render that
 * chose a different version would move the PNG digest and invalidate every artefact in the manifest.
 * The `target` is a string the door in `./qrTarget` produced, so this function does not re-ask
 * whether the address is printable; it only decides whether it is printable *here*.
 */
export function buildQrPlate(variant: unknown, target: string): QrPlateOutcome {
  if (!isQrVariant(variant)) return refused("qr-variant-unknown");
  const box = QR_PRINT_BOX_PIXELS[variant];

  let symbol: QrSymbol;
  try {
    symbol = createSymbol(target, { errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL });
  } catch {
    // Past version 40 at this level there is no symbol that holds the address, and the encoder says so
    // instead of truncating — a cut-down address would send a guest somewhere else, which is the one
    // thing a QR generator must never do. The catch is broad on purpose: whatever a string does to the
    // encoder, the answer this module gives is one of its own three names and never the library's.
    return refused("target-too-long");
  }

  const modules = symbol.modules.size;
  const quietModules = modules + 2 * QR_QUIET_ZONE_MODULES;
  const moduleScale = Math.floor(box / quietModules);
  if (moduleScale < QR_MINIMUM_MODULE_SCALE_PIXELS) return refused("plate-too-dense");

  const platePixels = quietModules * moduleScale;
  // Centred, with any odd spare pixel going right and bottom: a half pixel is not something a canvas
  // has, and a plate that is one pixel off-centre is not worth a rule about which side loses.
  const offset = Math.floor((box - platePixels) / 2);

  return {
    ok: true,
    plate: {
      variant,
      version: symbol.version,
      modules,
      quietModules,
      moduleScale,
      platePixels,
      canvasPixels: box,
      offsetX: offset,
      offsetY: offset,
      matrix: symbol.modules.data,
    },
  };
}
