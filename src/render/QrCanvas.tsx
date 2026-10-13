// The plate element: a canvas the size of the nominal print box, stamped with the geometry it was
// drawn at.
//
// The rectangles themselves are `./qrPaint`'s business; this file owns *when* they are drawn and
// *what the document says about them*. Both matter to a worker that captures on a reported state:
//
//   * **The paint happens in the commit, not after it.** `useLayoutEffect` runs synchronously inside
//     the `flushSync` that `./main.tsx` wraps its render in, so by the time the document says
//     `ready` the pixels are already in the backing store. A `useEffect` would schedule the drawing
//     after the browser paints, and a worker that captured on the reported state could file a white
//     square as a wedding invitation's QR code.
//   * **No echo.** The element carries the geometry as attributes, because those are the numbers the
//     output tier asserts against the plate it asked for. It does not carry the target address: the
//     pixels *are* the address, and a second copy in the DOM would be a channel that can drift from
//     them — and a token in markup a log might one day serialise.
//
// The attributes are read from the same `QrPlate` object the paint pass reads, which is what lets
// `QrCanvas.test.tsx` prove the stamped geometry and the drawn geometry cannot be two different
// claims about one file.

import { useLayoutEffect, useRef } from "react";
import { QR_SURFACE } from "@/lib/renderSurfaces";
import { QR_ERROR_CORRECTION_LEVEL, type QrPlate } from "./qrPlate";
import { paintPlate } from "./qrPaint";

export interface QrCanvasProps {
  plate: QrPlate;
}

const QrCanvas = ({ plate }: QrCanvasProps) => {
  const canvas = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const element = canvas.current;
    if (element !== null) paintPlate(element, plate);
  }, [plate]);

  return (
    <canvas
      ref={canvas}
      width={plate.canvasPixels}
      height={plate.canvasPixels}
      role="img"
      aria-label={`QR code plate, ${plate.variant} for print`}
      data-render-surface={QR_SURFACE}
      data-qr-variant={plate.variant}
      data-qr-version={plate.version}
      data-qr-modules={plate.modules}
      data-qr-quiet-modules={plate.quietModules}
      data-qr-module-scale={plate.moduleScale}
      data-qr-plate-pixels={plate.platePixels}
      data-qr-offset={plate.offsetX}
      data-qr-error-correction={QR_ERROR_CORRECTION_LEVEL}
    />
  );
};

export default QrCanvas;
