// The plate a host scans from their own screen, tested against the two claims it makes.
//
// `ShareQrPlate` is Stage 9's browser-side half of §9.1: the QR is drawn from the address the session
// is holding, and it is the same picture the render worker files as a printable 25 mm PNG. Both halves
// are already tested where they live — `src/render/qrTarget.test.ts` owns the door, `src/render/qrPlate.test.ts`
// the geometry, `src/render/QrCanvas.test.tsx` the paint — so this file tests only the seam this
// component adds, which is nowhere else:
//
//   * **A refusal is drawn as a sentence, and never as a plate.** The eight target reasons and the
//     three plate reasons each have their own words here, because a host who is shown a square of
//     modules for a `http://` local address has been handed something that will not open for a guest
//     in six months, and a host who is shown nothing at all has been given no way to know which case
//     they are in.
//   * **The preview and the printable artefact are one geometry.** The attributes on the drawn canvas
//     are read from the same plate the encoder produced, so this asserts the component asks for the
//     25 mm box and not some looser "screen size" that would let a scanned preview disagree with the
//     sheet that gets printed.
//
// The leak assertion is the one this component can make that the render harness cannot: jsdom has no
// 2D canvas, so the fake context below records calls rather than pixels, and what is provable here is
// what reaches the document — the address must be in the pixels only, never in markup, never in
// storage. That is the same no-echo rule `QrCanvas` states in its header, checked from the caller's
// side.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ShareQrPlate from "@/components/invitation/ShareQrPlate";
import { QR_ERROR_CORRECTION_LEVEL, buildQrPlate } from "@/render/qrPlate";

const TOKEN = 'Wm3vYq8ZkR2nT7xLpA4sDf6gHj9klNbPcQeRtYuiOpa';
const PUBLIC = `https://vivaahvarnam.in/i/${TOKEN}`;

/** jsdom answers `null` for a 2D context, which would make the paint pass a no-op and let a case pass
 *  while nothing was drawn at all. A recorder instead: the canvas still gets stamped, and a test can
 *  see that drawing was attempted. */
const withRecorder = () => {
  const context = {
    set fillStyle(_value: string) {},
    fillRect: () => {},
  } as unknown as CanvasRenderingContext2D;
  const host = HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => CanvasRenderingContext2D | null;
  };
  const spy = vi.spyOn(host, 'getContext').mockImplementation(() => context);
  return () => spy.mockRestore();
};

const plate = (() => {
  const outcome = buildQrPlate('25mm', PUBLIC);
  if (outcome.ok === false) throw new Error(`the fixture plate refused: ${outcome.reason}`);
  return outcome.plate;
})();

describe('drawing the plate for a printable address', () => {
  it('stamps the same 25 mm geometry the render worker files', () => {
    const stop = withRecorder();
    try {
      render(<ShareQrPlate url={PUBLIC} />);
      const canvas = screen.getByRole('img') as HTMLCanvasElement;
      expect(canvas.tagName.toLowerCase()).toBe('canvas');
      expect(canvas.getAttribute('data-qr-variant')).toBe('25mm');
      expect(canvas.getAttribute('data-qr-version')).toBe(String(plate.version));
      expect(canvas.getAttribute('data-qr-modules')).toBe(String(plate.modules));
      expect(canvas.getAttribute('data-qr-quiet-modules')).toBe(String(plate.quietModules));
      expect(canvas.getAttribute('data-qr-module-scale')).toBe(String(plate.moduleScale));
      expect(canvas.getAttribute('data-qr-plate-pixels')).toBe(String(plate.platePixels));
      expect(canvas.getAttribute('data-qr-offset')).toBe(String(plate.offsetX));
      expect(canvas.getAttribute('data-qr-error-correction')).toBe(QR_ERROR_CORRECTION_LEVEL);
      expect(canvas.width).toBe(plate.canvasPixels);
      expect(canvas.height).toBe(plate.canvasPixels);
    } finally {
      stop();
    }
  });

  it('says what a host should do with it, and that nothing was stored', () => {
    const stop = withRecorder();
    try {
      const { container } = render(<ShareQrPlate url={PUBLIC} />);
      expect(screen.getByText(/Scan it with a phone camera/)).toBeInTheDocument();
      expect(screen.getByText(/disappears when this page reloads/)).toBeInTheDocument();
      // The no-echo rule, from the caller's side: the pixels carry the credential, so markup must not.
      expect(container.textContent).not.toContain(TOKEN);
      expect(container.innerHTML).not.toContain(TOKEN);
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    } finally {
      stop();
    }
  });
});

describe('refusing to draw', () => {
  /** Every refusal the component can reach, with the part of its sentence a host acts on. `…-not-a-string`
   *  is absent because the prop is a string and the panel only renders while an address exists; a reason
   *  this build cannot produce gets no test, which is the same honesty rule the panels use. */
  const cases: { url: string; says: RegExp }[] = [
    { url: `http://vivaahvarnam.in/i/${TOKEN}`, says: /not an https one/ },
    { url: `https://vivaahvarnam.in/g/${TOKEN}`, says: /household’s or a reviewer’s own door/ },
    { url: `https://vivaahvarnam.in/r/${TOKEN}`, says: /household’s or a reviewer’s own door/ },
    { url: `https://vivaahvarnam.in/i/${TOKEN}?utm_source=wa`, says: /extra parameters/ },
    { url: `https://vivaahvarnam.in/i/${TOKEN}#rsvp`, says: /extra parameters/ },
    { url: 'https://someone:secret@vivaahvarnam.in/i/abcdefghijabcdefghijabcdefghijabcdefghijabcde', says: /user name or password/ },
    { url: `https://localhost:5173/i/${TOKEN}`, says: /only resolves on the machine or network it came from/ },
    { url: `https://192.168.1.20/i/${TOKEN}`, says: /only resolves on the machine or network it came from/ },
    { url: `https://vivaahvarnam.in/w/${TOKEN}`, says: /not an invitation address this build recognises/ },
    { url: `https://vivaahvarnam.in/i/${TOKEN.slice(0, 40)}`, says: /not an invitation address this build recognises/ },
    { url: '', says: /not an address a browser can make sense of/ },
  ];

  it.each(cases)('names the refusal for $url instead of drawing anything', ({ url, says }) => {
    const stop = withRecorder();
    try {
      const { container } = render(<ShareQrPlate url={url} />);
      expect(screen.getByRole('status').textContent).toMatch(says);
      expect(container.querySelector('canvas')).toBeNull();
      expect(container.textContent).not.toContain(TOKEN);
    } finally {
      stop();
    }
  });
});
