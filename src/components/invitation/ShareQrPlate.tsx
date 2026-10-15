// The QR plate a host can scan right now, drawn from the address this session is holding.
//
// §9.1 puts the QR at the two moments a raw address legitimately exists in a browser: the call that
// minted it (`api.publish_invitation_version` with `link_reused = false`, and
// `api.rotate_invitation_token`). Both return `path` in the response and nowhere else — the credential
// store keeps only its SHA-256 (`20260925120400…sql:125`) — so this component is offered while the
// address is on screen and cannot be offered afterwards. That is also why it draws rather than
// downloads: a downloadable plate is the render worker's artefact, recorded in the manifest with the
// digest of the bytes it produced, and nothing a browser paints here belongs in that record.
//
// Two rules are inherited rather than restated, and both are the reason this file is thin:
//
//   * **The door is `src/render/qrTarget.ts`.** Only an `https` origin, only a `/i/` path of the
//     43-character shape, never `/g/` or `/r/`, never a query, never credentials, never a hostname that
//     only resolves in this room. §9.3's ruling is that a printed sheet is read by whoever holds the
//     paper, so a household's own door must never be encoded on a general-purpose artefact — and a
//     local run's address must never be encoded either, because it cannot outlive the laptop. This
//     component does not soften either case for the sake of a demo: on the local stack the honest
//     answer is the refusal sentence below, and the plate appears when the invitation lives on a public
//     domain.
//   * **The geometry is `src/render/qrPlate.ts`.** The same encoder, the same error-correction level,
//     the same 4-module quiet zone and the same integer module scale the worker screenshots at 25 mm,
//     40 mm and 60 mm. What is on a host's screen and what goes on a sweet box are therefore one
//     picture at two sizes, which is the only way the printable artefact can be trusted to scan when
//     the preview scanned.
//
// It is loaded lazily, from `PublicationPanel` only, on the host's press. The encoder is a dependency
// §9.4 confines to the render entry and the guest bundle; a host's editor chunk may carry it and a
// guest's page may not, so the split is what keeps that claim true while this affordance exists. The
// Stage 9 built-chunk sweep reads `dist/` for exactly that.

import { useMemo } from 'react';
import QrCanvas from '@/render/QrCanvas';
import { buildQrPlate, type QrPlateRefusal } from '@/render/qrPlate';
import { buildQrTarget, type QrTargetRefusal } from '@/render/qrTarget';

/** The plate a host scans from a screen: the smallest box the product offers, because it is the one
 *  that fits beside an address without scrolling. The printable 40 mm and 60 mm plates are the
 *  worker's artefacts, listed by `InvitationOutputsPanel`. */
const SCREEN_VARIANT = '25mm';

const TARGET_WORDS: Record<QrTargetRefusal, string> = {
  'target-not-a-string':
    'There is no address to draw yet, so nothing was encoded. A plate is only offered while this page is '
    + 'holding the link that minted it.',
  'target-unparsable': 'This is not an address a browser can make sense of, so nothing was drawn.',
  'target-not-https':
    'This address is not an https one, so no code is drawn for it. A printed plate has to outlive the '
    + 'machine it was made on, and until this invitation is served over https there is nothing safe to '
    + 'print — the address above still works for sharing.',
  'target-origin-not-public':
    'This address only resolves on the machine or network it came from, so nothing printed from it '
    + 'would open for a guest six months from now. Publish this invitation on a public domain and the '
    + 'same address draws a plate.',
  'target-private-door':
    'This is a household’s or a reviewer’s own door, not the invitation’s public address. A general-'
    + 'purpose printed card must never carry one: it would put a family’s salutation, party size or '
    + 'answers behind a code that anyone could photograph.',
  'target-path-shape':
    'This is not an invitation address this build recognises, so it is not encoded. A plate that points '
    + 'somewhere other than the page your guest opens is worse than no plate.',
  'target-carries-credentials':
    'This address carries a user name or password in it, so it was refused rather than printed.',
  'target-carries-query':
    'This address carries extra parameters, and a parameter on paper is a second channel of information '
    + 'leaving whoever scans it. Nothing was drawn.',
};

const PLATE_WORDS: Record<QrPlateRefusal, string> = {
  'plate-too-dense':
    'This address needs more squares than a 25 mm plate can hold and still be scanned. The printable '
    + '40 mm and 60 mm plates are drawn by the render worker; ask for those.',
  'target-too-long':
    'This address is too long for any QR code to hold, so nothing was drawn rather than a shortened one '
    + 'that sends a guest somewhere else.',
  'qr-variant-unknown': 'This build does not know that plate size, so nothing was drawn.',
};

export interface ShareQrPlateProps {
  /** The absolute address this session was handed. Read, never stored, never sent anywhere. */
  url: string;
}

const ShareQrPlate = ({ url }: ShareQrPlateProps) => {
  const outcome = useMemo(() => {
    const target = buildQrTarget(url);
    if (target.ok === false) return { ok: false as const, text: TARGET_WORDS[target.reason] };
    const plate = buildQrPlate(SCREEN_VARIANT, target.url);
    if (plate.ok === false) return { ok: false as const, text: PLATE_WORDS[plate.reason] };
    return { ok: true as const, plate: plate.plate };
  }, [url]);

  if (outcome.ok === false) {
    return (
      <p role="status" aria-live="polite" className="text-xs leading-snug text-warning">
        {outcome.text}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="inline-block rounded-lg border border-gold/50 bg-white p-2">
        <QrCanvas plate={outcome.plate} />
      </div>
      <p role="status" aria-live="polite" className="text-[11px] leading-snug text-muted-foreground">
        Scan it with a phone camera. This is the {SCREEN_VARIANT} plate — the same picture the render
        worker files as a printable {SCREEN_VARIANT} PNG, at the same size, so what you check here is
        what gets printed. Nothing about this code is stored: it is drawn from the address on screen and
        disappears when this page reloads.
      </p>
    </div>
  );
};

export default ShareQrPlate;
