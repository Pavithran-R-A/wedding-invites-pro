# ADR 0004 — One canonical invitation, many outputs

**Status:** Accepted (Stage 1)
**Date:** 2026-09-25
**Affects:** Data model, versioning, render/export pipeline, OG and QR generation, print path

## Context

The same wedding document has to appear as: a live page a guest opens in a chat app's browser, an
Open Graph preview image so that link looks like an invitation rather than a blank card, a static
image for family WhatsApp groups, a PDF an elder can keep or hand to a printer, a QR code that
points at the page, a print-ready sheet if we coordinate printing, and possibly a video later.

The failure mode of "just build the page first" is that each output becomes a separate bespoke
implementation with its own layout logic, after which the PDF quietly disagrees with the link, the
share image shows stale names, and every correction has to be made N times. Corrections made after
a document is already in hundreds of phones are not cosmetic — they are wrong names on a wedding.

## Decision

Maintain **one canonical invitation version** as the source of truth, and derive every output from
it through a shared rendering and token layer.

1. An invitation *version* is an immutable snapshot: structured content, resolved tradition pack,
   chosen design direction, design tokens, and per-recipient salutation rules.
2. Outputs (page, OG image, static image, PDF, QR target, print asset, video) are **renderings of a
   version**, never independent sources of layout truth.
3. Design tokens are the single mechanism for cross-output consistency: type scale, spacing rhythm,
   palette and margins logic are shared, so an output that only looks right with off-token values is
   a signal the token set is incomplete.
4. Personalisation is a **render-time parameter** (household name, invited events), not a copy of the
   document. One version serves all recipients.
5. A published URL points at an immutable version. Editing produces a new version; republishing
   explicitly moves the pointer (see ADR 0001 and `docs/architecture/stage-2-domain-blueprint.md`).
6. Rendering must be reproducible: the same version plus the same inputs must produce byte-similar
   output, so a share image taken yesterday is provably still the current document.

## Consequences

**Positive**

- One correctness fix repairs every output.
- Stale-output bugs become structurally impossible: nothing caches layout independently.
- Approvals mean something, because what was approved is the exact thing that renders.
- New outputs (video, print, a physical card partner) become renderers, not product forks.
- Reproducibility gives us a defensible answer when a host reports a discrepancy.

**Negative / costs**

- The versioning model must exist before publication does; we cannot ship "publish the live page now,
  add PDF later" without accruing exactly the debt this ADR prevents.
- Print fidelity is genuinely harder than web fidelity: colour management, bleed, and CMYK expectations
  may force an output-specific layer that only adjusts units and colour space, never layout truth.
- Font subsetting for four Indic scripts must work identically in browser and server-side render, or
  the PDF will not match the page.
- Snapshot-per-version costs storage; per-recipient rendering costs compute at share time.
- Rendering must move server-side for image/PDF outputs, which the current client-only SPA does not
  have.

## Non-goals

- Not implementing any render pipeline in this stage. Live page, OG generation, PDF, QR generator and
  video renderer are later stages (Stage 3 / Stage 9 in the plan).
- Not a general-purpose PDF or image composition service.
- Not pixel-identical output across devices at the expense of accessibility — the page reflows;
  fixed-format outputs are fixed, and that difference is accepted and designed for.
- Not editing published documents in place. There is no "fix the typo silently"; there is a new
  version and a republish.
- Not caching personalised guest views in a way that can leak one household's salutation to another.
