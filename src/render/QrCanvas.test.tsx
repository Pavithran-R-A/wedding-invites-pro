// The plate, painted — and what a unit test can honestly reach about painting.
//
// This file covers the seam between `./qrPaint` and `./QrCanvas` together rather than one per file,
// because the instrument is the same fake 2D context and the property worth proving is the one that
// spans both: the element's commit is what makes the arithmetic run. Splitting them would duplicate
// the recorder and, worse, let a test pass while the component stopped calling the paint pass at all.
//
// jsdom has no 2D canvas, so this file cannot prove that a scanner reads the PNG. It proves the two
// things that are arithmetic rather than browser behaviour, which is exactly where a plate goes
// wrong before Chromium is involved:
//
//   * **The geometry the harness stamps is the geometry the harness draws.** The attributes on the
//     element are what the output tier asserts against, so if the painting pass used a different
//     scale or a different offset from the one it advertised, a manifest would describe a file that
//     is not that file. Both halves are read from the same `QrPlate` here and compared.
//   * **Every module is a whole rectangle of whole pixels.** One `fillRect` per dark module, at
//     `offset + column × scale`, sized `scale × scale`, and nothing fractional anywhere. A
//     sub-pixel module is the failure §5 refuses, and it would show up as a boundary that some
//     printers blur — invisible in a unit test, invisible in a preview, visible at a guest's door.
//
// What is deliberately *not* claimed here: that these rectangles became the right pixels in a real
// browser. That is measured against the served bundle with `getImageData` in the Stage 9 plate
// proof (`q9-logs/qr-scratch/`, recorded in the audit), because a fake context proves the caller's
// arithmetic and nothing about an implementation nobody has run.

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import QrCanvas from "./QrCanvas";
import { paintPlate } from "./qrPaint";
import {
  buildQrPlate,
  QR_MINIMUM_MODULE_SCALE_PIXELS,
  QR_PRINT_BOX_PIXELS,
  QR_QUIET_ZONE_MODULES,
  QR_VARIANTS,
  type QrPlate,
} from "./qrPlate";

const TOKEN = "Wm3vYq8ZkR2nT7xLpA4sDf6gHj9klNbPcQeRtYuiOpa";
const TARGET = `https://vivaahvarnam.in/i/${TOKEN}`;

/** One painted rectangle, with the fill colour it was drawn in. */
interface Paint {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}

const plateFor = (variant: (typeof QR_VARIANTS)[number]): QrPlate => {
  const outcome = buildQrPlate(variant, TARGET);
  if (outcome.ok === false) throw new Error(`the fixture plate refused: ${outcome.reason}`);
  return outcome.plate;
};

/** Replace jsdom's "no canvas" answer with a recorder, for the duration of one case. */
const withRecorder = () => {
  const paints: Paint[] = [];
  let fill = "";
  const context = {
    set fillStyle(value: string) {
      fill = value;
    },
    fillRect: (x: number, y: number, width: number, height: number) => {
      paints.push({ x, y, width, height, fill });
    },
  } as unknown as CanvasRenderingContext2D;
  const host = HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => CanvasRenderingContext2D | null;
  };
  const spy = vi.spyOn(host, "getContext").mockImplementation(() => context);
  return { paints, stop: () => spy.mockRestore() };
};

/** A canvas element outside any framework, for calling `paintPlate` on its own. */
const bareCanvas = (plate: QrPlate) => {
  const element = document.createElement("canvas");
  element.width = plate.canvasPixels;
  element.height = plate.canvasPixels;
  return element;
};

const darkPaints = (paints: Paint[]) => paints.filter((p) => p.fill === "#000000");
const lightPaints = (paints: Paint[]) => paints.filter((p) => p.fill === "#ffffff");

describe("QrCanvas, painted by qrPaint", () => {
  it("paints the whole nominal box white before a single module, so nothing is transparent", () => {
    const { paints, stop } = withRecorder();
    try {
      const plate = plateFor("40mm");
      paintPlate(bareCanvas(plate), plate);
      expect(paints.length).toBeGreaterThan(1);
      expect(paints[0]).toEqual({
        x: 0,
        y: 0,
        width: plate.canvasPixels,
        height: plate.canvasPixels,
        fill: "#ffffff",
      });
      // The background is the only light rectangle: the modules themselves are light by absence, so
      // a second white pass would mean the loop was drawing over its own work.
      expect(lightPaints(paints)).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it.each([...QR_VARIANTS])("draws exactly one whole-pixel rectangle per dark module on the %s box", (variant) => {
    const { paints, stop } = withRecorder();
    try {
      const plate = plateFor(variant);
      paintPlate(bareCanvas(plate), plate);
      const dark = darkPaints(paints);
      const expected = [...plate.matrix].filter((cell) => cell === 1).length;
      expect(expected).toBeGreaterThan(0);
      expect(dark).toHaveLength(expected);
      for (const paint of dark) {
        expect(Number.isInteger(paint.x)).toBe(true);
        expect(Number.isInteger(paint.y)).toBe(true);
        expect(paint.width).toBe(plate.moduleScale);
        expect(paint.height).toBe(plate.moduleScale);
        expect(Number.isInteger(plate.moduleScale)).toBe(true);
      }
    } finally {
      stop();
    }
  });

  it("places every module at offset + (4 + column) × scale, so the grid cannot drift across the plate", () => {
    const { paints, stop } = withRecorder();
    try {
      const plate = plateFor("25mm");
      paintPlate(bareCanvas(plate), plate);
      const { moduleScale: scale, offsetX, offsetY, modules } = plate;
      const quiet = QR_QUIET_ZONE_MODULES * scale;
      // Rebuild the expected set from the matrix and compare sets, not counts: a plate drawn with
      // the right number of squares in the wrong places would otherwise pass, and would decode as a
      // different URL or as nothing. The `4 +` is the quiet zone `platePixels` already paid for.
      const expected = new Set<string>();
      for (let row = 0; row < modules; row += 1) {
        for (let column = 0; column < modules; column += 1) {
          if (plate.matrix[row * modules + column] === 1) {
            expected.add(`${offsetX + quiet + column * scale},${offsetY + quiet + row * scale}`);
          }
        }
      }
      const actual = new Set(darkPaints(paints).map((p) => `${p.x},${p.y}`));
      expect(actual.size).toBe(darkPaints(paints).length);
      expect([...actual].sort()).toEqual([...expected].sort());
    } finally {
      stop();
    }
  });

  it("keeps §5's four quiet modules of light between the symbol and the plate edge", () => {
    const { paints, stop } = withRecorder();
    try {
      for (const variant of QR_VARIANTS) {
        const plate = plateFor(variant);
        // One plate's paints at a time: the recorder is shared across the three boxes, and a list
        // that mixes them would compare 25 mm pixels against 40 mm bounds.
        paints.length = 0;
        paintPlate(bareCanvas(plate), plate);
        const { offsetX, offsetY, platePixels, moduleScale, canvasPixels } = plate;
        const quiet = QR_QUIET_ZONE_MODULES * moduleScale;
        const dark = darkPaints(paints);
        expect(dark.length).toBeGreaterThan(0);
        expect(offsetX).toBe(offsetY);
        expect(offsetX + platePixels).toBeLessThanOrEqual(canvasPixels);
        for (const paint of dark) {
          expect(paint.x).toBeGreaterThanOrEqual(offsetX + quiet);
          expect(paint.y).toBeGreaterThanOrEqual(offsetY + quiet);
          expect(paint.x + paint.width).toBeLessThanOrEqual(offsetX + platePixels - quiet);
          expect(paint.y + paint.height).toBeLessThanOrEqual(offsetY + platePixels - quiet);
        }
        // And the band is *used*, not merely allowed: a QR's finder patterns sit in the symbol's four
        // corners, so the nearest painted pixel must land exactly on the quiet boundary. An
        // implementation that shifted the whole symbol away from it would pass the loop above.
        expect(Math.min(...dark.map((p) => p.x))).toBe(offsetX + quiet);
        expect(Math.min(...dark.map((p) => p.y))).toBe(offsetY + quiet);
        expect(Math.max(...dark.map((p) => p.x + p.width))).toBe(offsetX + platePixels - quiet);
        expect(Math.max(...dark.map((p) => p.y + p.height))).toBe(offsetY + platePixels - quiet);
        // The centring margin is symmetric to the pixel, except for the one spare pixel §5's
        // whole-number rule gives to the right and bottom.
        expect(canvasPixels - (offsetX + platePixels)).toBeLessThanOrEqual(offsetX + 1);
        expect(moduleScale).toBeGreaterThanOrEqual(QR_MINIMUM_MODULE_SCALE_PIXELS);
      }
    } finally {
      stop();
    }
  });

  it("stamps the geometry the drawing used, in the same commit that made the element", () => {
    const { paints, stop } = withRecorder();
    try {
      const plate = plateFor("60mm");
      const { container } = render(<QrCanvas plate={plate} />);
      const canvas = container.querySelector("canvas");
      expect(canvas).not.toBeNull();
      expect(canvas?.getAttribute("data-render-surface")).toBe("qr");
      expect(canvas?.width).toBe(QR_PRINT_BOX_PIXELS["60mm"]);
      expect(canvas?.height).toBe(QR_PRINT_BOX_PIXELS["60mm"]);
      expect(canvas?.getAttribute("data-qr-variant")).toBe("60mm");
      expect(canvas?.getAttribute("data-qr-version")).toBe(String(plate.version));
      expect(canvas?.getAttribute("data-qr-modules")).toBe(String(plate.modules));
      expect(canvas?.getAttribute("data-qr-quiet-modules")).toBe(String(plate.quietModules));
      expect(canvas?.getAttribute("data-qr-module-scale")).toBe(String(plate.moduleScale));
      expect(canvas?.getAttribute("data-qr-plate-pixels")).toBe(String(plate.platePixels));
      expect(canvas?.getAttribute("data-qr-offset")).toBe(String(plate.offsetX));
      expect(canvas?.getAttribute("data-qr-error-correction")).toBe("M");
      // The layout effect ran during the commit, not after it: `main.tsx` reports `ready` the moment
      // `flushSync` returns, so if this list were empty the worker would capture an unpainted canvas.
      expect(darkPaints(paints).length).toBeGreaterThan(0);
    } finally {
      stop();
    }
  });

  it("labels the plate as an image and carries no copy of the address in the DOM", () => {
    const { stop } = withRecorder();
    try {
      const plate = plateFor("25mm");
      const { container } = render(<QrCanvas plate={plate} />);
      const canvas = container.querySelector("canvas");
      expect(canvas?.getAttribute("role")).toBe("img");
      expect(canvas?.getAttribute("aria-label")).toContain("25mm");
      // The pixels are the address. An attribute holding the same string would be a second channel
      // that can disagree with the first — and a token in a DOM a log might one day serialise.
      expect(container.innerHTML).not.toContain(TOKEN);
      expect(container.innerHTML).not.toContain("vivaahvarnam.in");
    } finally {
      stop();
    }
  });

  it("refuses to pretend: a canvas with no 2D context fails the mount instead of reporting ready", () => {
    const host = HTMLCanvasElement.prototype as unknown as {
      getContext: (kind: string) => CanvasRenderingContext2D | null;
    };
    const spy = vi.spyOn(host, "getContext").mockImplementation(() => null);
    try {
      const plate = plateFor("25mm");
      expect(() => paintPlate(bareCanvas(plate), plate)).toThrow(/no 2D context/);
    } finally {
      spy.mockRestore();
    }
  });

  it("draws the same symbol at a different scale, not a different symbol", () => {
    // The three artefacts of one address must agree module for module, or a guest scanning a 25 mm
    // card and a guest scanning a 60 mm poster would be sent to different places.
    const small = plateFor("25mm");
    const large = plateFor("60mm");
    expect(large.modules).toBe(small.modules);
    expect(Array.from(large.matrix)).toEqual(Array.from(small.matrix));
    expect(large.moduleScale).toBeGreaterThan(small.moduleScale);

    // One recorder for both paints, and the grid read as module indices rather than pixels: the
    // second call has a larger canvas and a larger scale, so only the normalised grid can compare.
    const { paints, stop } = withRecorder();
    try {
      paintPlate(bareCanvas(small), small);
      const smallGrid = gridOf(paints, small);
      paints.length = 0;
      paintPlate(bareCanvas(large), large);
      expect(gridOf(paints, large)).toEqual(smallGrid);
      expect(smallGrid.size).toBeGreaterThan(0);
    } finally {
      stop();
    }
  });
});

/** The painted dark modules as `row:column` indices, so two scales of the same symbol are equal. */
const gridOf = (paints: Paint[], plate: QrPlate) => {
  const { moduleScale: scale, offsetX, offsetY } = plate;
  const quiet = QR_QUIET_ZONE_MODULES * scale;
  const grid = new Set<string>();
  for (const paint of darkPaints(paints)) {
    grid.add(`${Math.round((paint.y - offsetY - quiet) / scale)}:${Math.round((paint.x - offsetX - quiet) / scale)}`);
  }
  return grid;
};
