# ADR 0002 — Structured creator, not a canvas

**Status:** Accepted (Stage 1)
**Date:** 2026-09-25
**Affects:** Creation flow, invitation data model, editor scope, export pipeline

## Context

ADR 0001 commits us to the document as the product. The next question is how a host produces that
document. The two available models are a free-form editor (place anything anywhere) and a guided
structured creator (fill known fields, choose among curated options).

Free-form editors are the industry default because they are cheap to build and impressive in a demo.
They are wrong here for a specific reason: the failure that matters in this category is not
"it looks unfashionable" but "my mother says this is not how we invite people" — a missing elder, a
misordered invocation, an omitted function, the wrong language. A canvas cannot detect any of those,
because it does not know what the invitation is *made of*.

We also know the content has to be reflowed for a phone-rendered page, a share image, a PDF and a
print sheet, and reviewed by a relative over a chat link.

## Decision

Build creation as a **structured creator**. Invitation content is typed, addressable data (people,
relationships, events, venues, sections, wording) with design applied on top by curated directions.
Customisation is real but bounded: hosts choose direction, palette within a direction, optional
sections, photos into defined slots, and free text where expression is genuinely free.

Rules:

1. Facts that affect layout, logic or meaning are structured fields. Expression is freeform text.
2. No arbitrary element placement, and no per-node font sizing, in the shipped editor.
3. Required information is required by the model, so "missing grandfather's name" is a validation
   state, not an invisible hole.
4. Reviewed content (wording samples, motifs, translations) is selected by the host and never
   inferred from their identity — see ADR 0003 and `docs/product/content-governance.md`.
5. The creator must work on a phone, in one sitting, for someone with no design training.

## Consequences

**Positive**

- Correctness becomes enforceable: the model knows what an invitation contains, so it can warn,
  validate, and render reliably across outputs.
- Family approval becomes possible — a person reviews a document, not an arrangement of shapes.
- Accessibility and typography can be guaranteed centrally instead of hoped for per design.
- Multi-language and multi-script layout is a system property rather than a per-canvas repair.
- Support load is lower: fewer catastrophically broken outputs to unpick.

**Negative / costs**

- Slower to build; we own the layout engine instead of shipping a generic editor.
- Some sophisticated users will chafe at limits and ask for "just move this box". Answer with
  premium human designer help, not by reopening the canvas.
- Every supported expression of a tradition has to be enumerated, which requires reviewed cultural
  content and therefore a content process with real cost.
- The current styling panel (free font size, free colour picker) is contrary to this decision and is
  explicitly a `FOUNDATION` to be replaced, not extended.

## Non-goals

- Not a general-purpose design tool, and not a path towards one.
- Not pixel-level export fidelity controls (margins, absolute positions, layer order).
- Not unlimited custom fonts, custom colours, or user-supplied CSS.
- Not a template marketplace where arbitrary third-party layouts are trusted by default.
- Not "structure" that removes the host's voice: personal notes and editable wording remain.
