# ADR 0003 — Data-driven tradition packs, always host-selected

**Status:** Accepted (Stage 1). No pack engine is implemented in this stage — this is an accepted
direction, recorded before the code exists.
**Date:** 2026-09-25
**Affects:** Cultural content model, renderer, seeding, CMS/authoring tooling, onboarding UX

## Context

VivaahVarnam's launch market spans several wedding traditions across Tamil, Telugu, Malayalam and
Kannada speakers, plus bilingual and non-religious presentations. The differences between them are
not cosmetic: which section opens the document, which names must appear, which functions exist and
what they are called, which motifs are appropriate versus offensive, and which phrases carry
devotional weight.

The obvious shortcuts all fail:

- **Hard-coded variants** (`if community == X render Y`) produce an unmaintainable matrix and, worse,
  encode our guesses about people's identities into the renderer.
- **One "Indian" default with decorative choice** is a stereotype engine. It reads as bindi-and-
  paisley clip-art to exactly the families we need to convince.
- **Asking the host to write everything** puts ceremonial correctness on the customer, which is the
  thing they are paying us to handle.
- **Inferring tradition from a name, language, location or guest list** is confidently wrong some
  percentage of the time, and the error appears in the document announcing a marriage.

## Decision

Represent cultural variation as **data — tradition packs** — and make pack selection an explicit,
host-driven choice.

A pack declaratively defines: section set and ordering, labels, required vs optional fields, event
vocabulary, motif assets, typography guidance, and reviewed wording samples. Packs are versioned
content with a lifecycle (`draft` → `reviewed` → `approved` → `deprecated`) and named human
reviewers per language/tradition (see `docs/product/content-governance.md`).

Hard constraints:

1. The renderer contains **no identity-based branching**. It consumes a pack definition.
2. Nothing is inferred from a name, language, surname, address, phone-number country, or guest list.
   Suggestions are questions the host can decline, never resolved defaults.
3. Language choice and tradition choice are **independent axes**; a pack does not imply a language
   and a language does not imply a pack.
4. Machine-assisted wording or translation may populate a `draft` pack only, must be labelled as
   such, and can never silently become `approved` pack content.
5. A published invitation pins the exact pack version it used; corrections to a pack never mutate
   an already-sent document.
6. Where practitioners genuinely differ, the pack exposes variants as variants. We do not publish
   one sequence as "the correct order" — there is no universal religious order.

## Consequences

**Positive**

- New traditions become content work with a review path, not a release.
- Cultural mistakes are fixable by editing data with an audit trail, and identifiable by reviewer and
  version when reported.
- The same model supports a future partner/authoring workflow for reviewers without touching code.
- Enforcement of "never infer" becomes structural: there is no field to infer into.
- Design directions and packs stay separable — a visual treatment can serve several packs.

**Negative / costs**

- We need real reviewers with real language/tradition qualification, and that costs money and time
  before any revenue.
- A pack schema is a long-lived contract; getting its expressive limits wrong means either a bloated
  schema or traditions that cannot be represented.
- Versioned, pinned content means storage duplication and a migration story for old invitations.
- Non-technical authoring requires tooling; without it, content work turns into pull-request review,
  which is slower and less accountable.
- Tempting to shortcut with generated text will be constant. Rule 4 exists to be enforceable, and
  `npm run product:check` plus review are how we keep it honest.

## Non-goals

- Not a religious authority, and not a source of authoritative ceremonial instruction.
- Not caste-based segmentation. Packs describe practices people choose; they are not identity
  classifications, and no feature may treat them as such.
- Not automatic matching of a customer to a pack.
- Not one canonical "traditional" ordering with deviations treated as wrong.
- Not an unmoderated user-contributed content library in V1.
- Not implementing the pack engine, schema or authoring UI in this stage.
