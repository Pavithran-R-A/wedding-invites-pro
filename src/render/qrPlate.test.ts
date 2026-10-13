// The plate: how one address becomes one printable square of modules.
//
// §5 promises three PNG sizes "for print (25 mm, 40 mm, 60 mm nominal)" and §9.4 promises "a canvas
// drawn at an exact integer module scale with the §5 quiet zone". Both promises are geometry, and
// geometry is where a QR either scans or does not, so every number this file quotes was measured
// first — the runs live in `q9-logs/qr-scratch/s9-qr-plate-pinned.txt`, `s9-qr-plate-toolong.txt`
// and `s9-qr-plate-matrix.txt`, and each one is re-derivable from the constants below.
//
// The three rules those measurements fix:
//
//   * **The canvas is the nominal box.** A 40 mm plate is 640 px wide whatever the address needs;
//     the modules are drawn inside it at the largest whole-pixel scale that fits, centred, and the
//     leftover becomes extra quiet zone (more than four modules is always legal; fewer never is).
//     The alternative — sizing the canvas to the drawn plate — would make "60 mm" a promise the file
//     breaks whenever a host's address happens to run long.
//   * **The scale is a whole number of pixels, and at least 7 of them.** 7 px at 16 px/mm is 0.4375
//     mm per module, which is §4's legibility floor (0.4 mm) rounded *up*; 6 px would be a 0.375 mm
//     dot, and a fractional scale also puts a printer's dots between module boundaries.
//   * **Too dense is a refusal, not a shrink.** §5: "A URL that does not fit the chosen version/EC
//     combination is a refusal with a reason, not a smaller QR." A 40 mm plate is a decision somebody
//     made about their own invitation; quietly handing them a 35 mm one is not that decision.
//
// What this file deliberately does not decide: whether an address is *printable at all*. That is
// `./qrTarget`'s door, and a target reaching `buildQrPlate` is a string the door produced — an
// `https` URL with a `/i/<43>` path and no query, fragment or credentials. The one place the two
// overlap is a payload the encoder cannot hold, and the two refusals stay separate because they are
// facts about different things: one says the address is longer than any QR, the other says it is a
// QR this particular piece of paper cannot carry.

import { describe, expect, it } from "vitest";
import {
  buildQrPlate,
  isQrVariant,
  QR_ERROR_CORRECTION_LEVEL,
  QR_MINIMUM_MODULE_MILLIMETRES,
  QR_MINIMUM_MODULE_SCALE_PIXELS,
  QR_PLATE_REFUSALS,
  QR_PIXELS_PER_MILLIMETRE,
  QR_PRINT_BOX_PIXELS,
  QR_QUIET_ZONE_MODULES,
  QR_VARIANTS,
} from "./qrPlate";

// A realistic credential: a random base64url token has mixed case, so it cannot be packed into QR's
// alphanumeric mode and costs a version against an all-caps filler of the same length. That
// difference is measured (`s9-qr-plate-pinned.txt`: the same 69-character address in A-only form
// encodes at version 4, this one at version 5) and is the reason the numbers below are quoted from a
// run rather than worked out from a capacity table.
const TOKEN = "Wm3vYq8ZkR2nT7xLpA4sDf6gHj9klNbPcQeRtYuiOpa"; // 43 characters, URL-safe
const REAL_ADDRESS = `https://vivaahvarnam.in/i/${TOKEN}`; // 69 characters — the shape an address really has

// An address of exactly `chars` characters, in the form the door accepts: 8 for `https://`, the host,
// 3 for `/i/`, 43 for the token, so the host is `chars - 54` long and `.example.in` is 11 of those
// characters. Length is the only free variable once the path is fixed, which makes it the honest knob
// for walking a version ladder.
const addressOfLength = (chars: number) =>
  `https://${"v".repeat(chars - 65)}.example.in/i/${TOKEN}`;

describe("the plate constants", () => {
  it("are §5's: error correction M, a four-module quiet zone, and three print boxes", () => {
    expect(QR_ERROR_CORRECTION_LEVEL).toBe("M");
    expect(QR_QUIET_ZONE_MODULES).toBe(4);
    expect(QR_PRINT_BOX_PIXELS).toEqual({ "25mm": 400, "40mm": 640, "60mm": 960 });
    // 25 mm x 16 px/mm = 400 and the other two the same way: the boxes are the promised print sizes
    // expressed in the canvas's own unit, so a raster at this density is exactly the paper.
    for (const [variant, box] of Object.entries(QR_PRINT_BOX_PIXELS)) {
      expect(box).toBe(Number(variant.replace("mm", "")) * QR_PIXELS_PER_MILLIMETRE);
    }
  });

  it("derive the minimum module scale from the legibility floor rather than stating it", () => {
    // 0.4 mm x 16 px/mm = 6.4 px, and a module cannot be 6.4 px, so the floor rounds *up*: 7 px is
    // the smallest scale that keeps a module at or above 0.4 mm. Rounding down would break §4's own
    // number, which is why the derivation is asserted and not just the resulting constant.
    expect(QR_PIXELS_PER_MILLIMETRE).toBe(16);
    expect(QR_MINIMUM_MODULE_MILLIMETRES).toBe(0.4);
    expect(QR_MINIMUM_MODULE_SCALE_PIXELS).toBe(
      Math.ceil(QR_MINIMUM_MODULE_MILLIMETRES * QR_PIXELS_PER_MILLIMETRE),
    );
    expect(QR_MINIMUM_MODULE_SCALE_PIXELS).toBe(7);
    expect(QR_MINIMUM_MODULE_SCALE_PIXELS / QR_PIXELS_PER_MILLIMETRE).toBeGreaterThanOrEqual(
      QR_MINIMUM_MODULE_MILLIMETRES,
    );
    expect((QR_MINIMUM_MODULE_SCALE_PIXELS - 1) / QR_PIXELS_PER_MILLIMETRE).toBeLessThan(
      QR_MINIMUM_MODULE_MILLIMETRES,
    );
  });

  it("put a ceiling on the QR version each box can print, and the ceilings are re-derivable", () => {
    // modules = 4 x version + 17, and the drawn side is modules plus two quiet zones, so the largest
    // version a box still draws at 7 px or more is the arithmetic below. Measured in
    // `s9-qr-plate-geometry.txt`; the version-8 and version-9 addresses further down are the
    // empirical proof that the 25 mm ceiling really sits where this says it does.
    const ceilingFor = (box: number) =>
      Math.floor(
        (Math.floor(box / QR_MINIMUM_MODULE_SCALE_PIXELS) - 2 * QR_QUIET_ZONE_MODULES - 17) / 4,
      );
    expect(ceilingFor(QR_PRINT_BOX_PIXELS["25mm"])).toBe(8);
    expect(ceilingFor(QR_PRINT_BOX_PIXELS["40mm"])).toBe(16);
    expect(ceilingFor(QR_PRINT_BOX_PIXELS["60mm"])).toBe(28);
  });
});

describe("isQrVariant", () => {
  it("accepts exactly the three names §5 lists, spelled exactly", () => {
    expect([...QR_VARIANTS]).toEqual(["25mm", "40mm", "60mm"]);
    for (const variant of QR_VARIANTS) expect(isQrVariant(variant)).toBe(true);
    for (const not of ["20mm", "25MM", "25 mm", "25mm ", "", 25, null, undefined, {}, ["25mm"]]) {
      expect(isQrVariant(not)).toBe(false);
    }
  });
});

describe("buildQrPlate draws the whole plate, at a whole-pixel scale, inside the nominal box", () => {
  it("lays out a real 69-character address at version 5 in all three boxes", () => {
    // Every field here is from `s9-qr-plate-pinned.txt`. The reason to pin them together is that they
    // are not independent: the scale, the drawn side and the centring offset all fall out of
    // (box, 45 quiet modules, 7 px floor), so a change to any one of them has to show up here.
    const expectations: Record<string, Record<string, number>> = {
      "25mm": { modules: 37, quietModules: 45, moduleScale: 8, platePixels: 360, canvasPixels: 400, offsetX: 20, offsetY: 20 },
      "40mm": { modules: 37, quietModules: 45, moduleScale: 14, platePixels: 630, canvasPixels: 640, offsetX: 5, offsetY: 5 },
      "60mm": { modules: 37, quietModules: 45, moduleScale: 21, platePixels: 945, canvasPixels: 960, offsetX: 7, offsetY: 7 },
    };
    for (const variant of QR_VARIANTS) {
      const outcome = buildQrPlate(variant, REAL_ADDRESS);
      expect(outcome.ok, variant).toBe(true);
      if (outcome.ok === false) continue;
      expect(outcome.plate.version, variant).toBe(5);
      expect(outcome.plate, variant).toMatchObject(expectations[variant]);
      // 8 px at 16 px/mm is 0.5 mm per module — comfortably above the floor, which is why an
      // ordinary short address never trips the density refusal.
      expect(outcome.plate.moduleScale / QR_PIXELS_PER_MILLIMETRE).toBeGreaterThanOrEqual(
        QR_MINIMUM_MODULE_MILLIMETRES,
      );
    }
  });

  it("prints the densest address a 25 mm plate can still carry, at exactly the floor scale", () => {
    // 135 characters needs version 8: 49 modules plus the quiet zone is a 57-module side, and
    // floor(400 / 57) = 7 px. 7 x 57 = 399, so the plate is one pixel narrower than the box and the
    // centring offset is zero — the odd-remainder case, where the spare pixel goes to the right and
    // bottom rather than being split in half, because a half pixel is not a thing a canvas has.
    const outcome = buildQrPlate("25mm", addressOfLength(135));
    expect(outcome.ok).toBe(true);
    if (outcome.ok === false) return;
    expect(outcome.plate).toMatchObject({
      version: 8,
      modules: 49,
      quietModules: 57,
      moduleScale: QR_MINIMUM_MODULE_SCALE_PIXELS,
      platePixels: 399,
      canvasPixels: 400,
      offsetX: 0,
      offsetY: 0,
    });
    expect(outcome.plate.matrix.length).toBe(49 * 49);
  });

  it("refuses the next address up at 25 mm instead of printing it smaller", () => {
    // §5's rule, stated as the pair it is really about: the *same* address is printable on a 40 mm
    // and a 60 mm plate and is refused on a 25 mm one. A generator that "just scaled it down" would
    // produce a 0.375 mm module here, and the refusal that never happened would be invisible until a
    // guest's phone camera said no.
    const dense = addressOfLength(165); // version 9: a 61-module side, so floor(400/61) = 6 px < 7
    const small = buildQrPlate("25mm", dense);
    expect(small.ok).toBe(false);
    if (small.ok === false) expect(small.reason).toBe("plate-too-dense");

    const medium = buildQrPlate("40mm", dense);
    expect(medium.ok).toBe(true);
    if (medium.ok === false) return;
    expect(medium.plate).toMatchObject({
      version: 9,
      modules: 53,
      quietModules: 61,
      moduleScale: 10,
      platePixels: 610,
      canvasPixels: 640,
      offsetX: 15,
      offsetY: 15,
    });

    const large = buildQrPlate("60mm", dense);
    expect(large.ok).toBe(true);
    if (large.ok === false) return;
    expect(large.plate).toMatchObject({
      version: 9,
      moduleScale: 15,
      platePixels: 915,
      canvasPixels: 960,
      offsetX: 22,
      offsetY: 22,
    });
  });

  it("refuses an address longer than any QR exists for, at every size", () => {
    // The other refusal, for the other reason. 2331 characters is the last length of this shape the
    // encoder accepts at error correction M — measured in `s9-qr-plate-toolong.txt`, and it matches
    // version 40's published byte-mode capacity, which is a cross-check between the library and the
    // standard rather than a number this module trusts. One character past it there is no symbol, so
    // truncating would print an address that resolves somewhere else; that is the one thing a QR
    // generator must never do.
    for (const variant of QR_VARIANTS) {
      const outcome = buildQrPlate(variant, addressOfLength(2332));
      expect(outcome.ok, variant).toBe(false);
      if (outcome.ok === false) expect(outcome.reason, variant).toBe("target-too-long");
    }
    // And the pair that keeps the two names meaning different things: 2331 characters *is*
    // encodable — version 40, a 177-module symbol — and is simply unsignably dense on paper.
    expect(buildQrPlate("60mm", addressOfLength(2331))).toMatchObject({
      ok: false,
      reason: "plate-too-dense",
    });
  });

  it("counts the payload in bytes, which is why a character budget is not a safety margin", () => {
    // 157 characters of this address hold 357 UTF-8 bytes, and the encoder needs version 14 for it
    // (`s9-qr-plate-multibyte.txt`). A host label in Devanagari is the realistic case the door
    // removes — it hands over `URL.href`, which punycodes the host, see qrTarget.test.ts — so what
    // this case pins is the plate's arithmetic: the refusal is decided by the version the encoder
    // chose, not by `String.length`, and a check written on characters would have called this safe
    // and printed it at 4 px per module.
    const multibyte = `https://${"व".repeat(100)}.in/i/${TOKEN}`;
    expect(multibyte.length).toBe(157);
    expect(new TextEncoder().encode(multibyte).length).toBe(357);

    const small = buildQrPlate("25mm", multibyte);
    expect(small.ok).toBe(false);
    if (small.ok === false) expect(small.reason).toBe("plate-too-dense");

    const medium = buildQrPlate("40mm", multibyte);
    expect(medium.ok).toBe(true);
    if (medium.ok === false) return;
    expect(medium.plate).toMatchObject({
      version: 14,
      modules: 73,
      quietModules: 81,
      moduleScale: QR_MINIMUM_MODULE_SCALE_PIXELS,
      platePixels: 567,
      canvasPixels: 640,
      offsetX: 36,
      offsetY: 36,
    });
  });

  it("names an unknown variant before it looks at the address", () => {
    // The variant is the harness's own field and the cheapest thing to check; a worker that asks for
    // a 20 mm plate should hear "no such plate", not "that address is too long".
    for (const variant of ["20mm", "25MM", undefined, 25, ["25mm"]]) {
      const outcome = buildQrPlate(variant, REAL_ADDRESS);
      expect(outcome.ok).toBe(false);
      if (outcome.ok === false) expect(outcome.reason).toBe("qr-variant-unknown");
      const alsoUnprintable = buildQrPlate(variant, addressOfLength(2332));
      expect(alsoUnprintable.ok).toBe(false);
      if (alsoUnprintable.ok === false) expect(alsoUnprintable.reason).toBe("qr-variant-unknown");
    }
  });

  it("holds every geometric relation across a table of addresses, not one lucky example", () => {
    const addresses = [
      REAL_ADDRESS,
      addressOfLength(85), // version 6
      addressOfLength(107), // version 7
      addressOfLength(123), // version 8, the last one a 25 mm plate can carry
      addressOfLength(135),
      addressOfLength(165), // version 9, refused at 25 mm
      addressOfLength(193), // version 10
      `https://wedding.vivaahvarnam.in:8443/i/${TOKEN}`,
    ];
    const checked: string[] = [];
    let printed = 0;
    let refused = 0;
    for (const target of addresses) {
      for (const variant of QR_VARIANTS) {
        const outcome = buildQrPlate(variant, target);
        checked.push(`${target}@${variant}`);
        if (outcome.ok === false) {
          refused += 1;
          expect(QR_PLATE_REFUSALS, variant).toContain(outcome.reason);
          continue;
        }
        printed += 1;
        const plate = outcome.plate;
        const box = QR_PRINT_BOX_PIXELS[variant];
        expect(plate.variant, variant).toBe(variant);
        // One module per QR module, and the quiet zone is exactly §5's count on each side.
        expect(plate.modules).toBe(4 * plate.version + 17);
        expect(plate.quietModules).toBe(plate.modules + 2 * QR_QUIET_ZONE_MODULES);
        // The canvas is the nominal box; the plate inside it is a whole number of modules.
        expect(plate.canvasPixels, variant).toBe(box);
        expect(plate.platePixels).toBe(plate.quietModules * plate.moduleScale);
        expect(plate.platePixels % plate.quietModules).toBe(0);
        expect(plate.platePixels).toBeLessThanOrEqual(box);
        // Exactly the largest whole scale that fits — the rule, not just a scale that happens to fit.
        expect(plate.moduleScale).toBe(Math.floor(box / plate.quietModules));
        expect(plate.moduleScale).toBeGreaterThanOrEqual(QR_MINIMUM_MODULE_SCALE_PIXELS);
        expect(plate.moduleScale / QR_PIXELS_PER_MILLIMETRE).toBeGreaterThanOrEqual(
          QR_MINIMUM_MODULE_MILLIMETRES,
        );
        // Centred, with at most one spare pixel to the right and bottom.
        expect(plate.offsetX).toBe(Math.floor((box - plate.platePixels) / 2));
        expect(plate.offsetY).toBe(plate.offsetX);
        expect(box - plate.platePixels - 2 * plate.offsetX).toBeLessThanOrEqual(1);
        // The matrix is the content only: the quiet ring is geometry the canvas already knows.
        expect(plate.matrix.length).toBe(plate.modules * plate.modules);
      }
    }
    // Two non-emptiness guards: a loop over an empty table would satisfy every assertion above, and a
    // table that only ever refused (or only ever printed) would not test the branch it appears to.
    expect(checked.length).toBe(addresses.length * QR_VARIANTS.length);
    expect(printed).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });

  it("hands the canvas a flat row-major matrix the drawing code can index directly", () => {
    const outcome = buildQrPlate("25mm", REAL_ADDRESS);
    expect(outcome.ok).toBe(true);
    if (outcome.ok === false) return;
    const plate = outcome.plate;
    expect(plate.matrix).toBeInstanceOf(Uint8Array);
    expect(plate.matrix.length).toBe(plate.modules * plate.modules);
    expect(plate.matrix.length % plate.modules).toBe(0);
    // 0 and 1, not true/false and not 255 — measured in `s9-qr-plate-matrix.txt`, and the reason the
    // canvas can write a module without translating between two conventions.
    expect(Array.from(new Set(Array.from(plate.matrix))).sort((a, b) => a - b)).toEqual([0, 1]);

    // Finder patterns: the three 7x7 corner squares are the only parts of a symbol whose colour at a
    // named coordinate is fixed by the format rather than by the payload, which is what makes these
    // six reads an assertion about orientation instead of about this invitation's bytes. The
    // separator beside a finder pattern is the light one, and it is what proves the matrix is not
    // merely "mostly dark" — a transposed or inverted array would fail one of the seven.
    const at = (row: number, column: number) => plate.matrix[row * plate.modules + column];
    expect(at(0, 0)).toBe(1);
    expect(at(0, 6)).toBe(1);
    expect(at(6, 0)).toBe(1);
    expect(at(6, 6)).toBe(1);
    expect(at(0, plate.modules - 1)).toBe(1);
    expect(at(plate.modules - 1, 0)).toBe(1);
    expect(at(7, 0)).toBe(0);
  });

  it("gives the same plate twice for the same address, which is where reproducibility starts", () => {
    // §13's ladder begins here: if the encoder chose a version by a search that could differ between
    // runs, the digest of a re-rendered PNG would move and every artefact in the manifest would look
    // invalidated. Two calls, byte for byte.
    const first = buildQrPlate("40mm", REAL_ADDRESS);
    const second = buildQrPlate("40mm", REAL_ADDRESS);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok === false || second.ok === false) return;
    expect(Array.from(second.plate.matrix)).toEqual(Array.from(first.plate.matrix));
    expect(second.plate).toEqual(first.plate);
    // And a different box is a different plate, not a rescaled copy of it: the module count is the
    // same and the scale is not, which is what §13's "same DTO, same file" claim has to allow for.
    const smaller = buildQrPlate("25mm", REAL_ADDRESS);
    expect(smaller.ok).toBe(true);
    if (smaller.ok === false) return;
    expect(smaller.plate.modules).toBe(first.plate.modules);
    expect(smaller.plate.moduleScale).not.toBe(first.plate.moduleScale);
  });
});

describe("a refusal names its rule and never repeats the address", () => {
  it("keeps the vocabulary closed to three names", () => {
    expect([...QR_PLATE_REFUSALS].sort()).toEqual([
      "plate-too-dense",
      "qr-variant-unknown",
      "target-too-long",
    ]);
  });

  it("says nothing about what it was handed", () => {
    // The reason ends up in a worker's log line and a manifest column (§11.5), so an echoed value
    // would put a caller's bytes — including a live credential — in an operator's terminal.
    const hostile = `https://vivaahvarnam.in/i/${TOKEN}${'<script>alert("evil.example")</script>'.repeat(40)}`;
    expect(hostile.length).toBeGreaterThan(1400);
    let seen = 0;
    for (const variant of ["25mm", "bogus", "40mm", "60mm"]) {
      const outcome = buildQrPlate(variant, hostile);
      seen += 1;
      expect(outcome.ok, variant).toBe(false);
      if (outcome.ok === false) {
        expect(QR_PLATE_REFUSALS).toContain(outcome.reason);
        expect(outcome.reason).not.toContain("script");
        expect(outcome.reason).not.toContain("evil");
        expect(outcome.reason).not.toContain(TOKEN);
        expect(outcome.reason).not.toContain("vivaahvarnam");
      }
    }
    expect(seen).toBe(4);
  });
});
