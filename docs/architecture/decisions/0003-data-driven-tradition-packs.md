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

## Cross-stage status — where the six hard constraints stand after Stage 5 (closure, 2026-10-03)

**Status:** Accepted, unchanged. The header sentence — "No pack engine is implemented in this stage" — was
true of Stage 1 and is the one line in this file a reader can now take the wrong way, so it is answered here
rather than edited away: [ADR 0007](0007-versioned-reviewed-tradition-pack-releases.md) is the decision that
built the engine, and Stage 5 moved inside it. Nothing below adds a rule.

| Rule | What enforces it now |
| --- | --- |
| 1 — no identity branching in the renderer | The renderer's vocabulary is three section kinds and a resolved value; six `src/`-scoped shape rules in `npm run product:check` (`tradition-pack-identity-branch` `:288`, `language-gated-rite` `:358`, and Stage 5's `pack-selection-derived-by-name` `:324`, `place-tested-for-a-tradition` `:347`) fire on the *shape* of a derivation, not on a banned word, and the checker's self-test carries a firing example for each (`scripts/check-product-contract.mjs:647-661`) |
| 2 — nothing inferred from a name, language, place or guest list | Same two shape rules, plus the selection being one explicit write (`weddings.tradition_pack_release_id`) that no browser code reaches by default, measured end to end by the no-pack journey — a wedding with `none` selected freezes, publishes and renders with no section claiming pack wording |
| 3 — language and tradition are independent axes | The resolver reports a fallback (`body_fallback_used`) instead of silently substituting English, and the request for `ta` that falls back to `en` is a frozen fact beside the wording, not a runtime accident |
| 4 — machine-assisted wording cannot silently become approved | `machine_assisted` + `machine_assistance_disclosure_required`, the guard's refusal of a lifecycle step that restates a review, and now a digest: a review binds to `review_packet_hash`, the guard pins it, and a submission against a stale digest is refused naming both. Stage 5's `machine-assisted-claimed-approved` rule is the documentation half — a machine-written pack cannot be called approved in prose either |
| 5 — published invitations pin the exact pack version | `versions_pack_release_gate` plus the snapshot's own copy of the release's wording, re-measured at the Stage 5 head: retiring the release behind a live publication, approving a newer one and re-selecting it all leave version 1's bytes unchanged |
| 6 — variants presented as variants | Still `scope_statement` and the release's own words; no mechanism decides this one, and it remains a content-judgment rule with no enforcement to claim |

The cost this file named first — "we need real reviewers with real language/tradition qualification, and
that costs money and time before any revenue" — is **still unpaid**, and Stage 5 made it easier to lose
sight of: the mechanism now records a review that is complete in every queryable field while the reviewer
behind it is a script and the wording is a `TEST ONLY` fixture. The second cost ("non-technical authoring
requires tooling") is partly paid at the maintenance boundary — `scripts/tradition-pack-admin.mjs` gives an
operator create/validate/review/approve/deprecate verbs and refuses to point at a hosted project — and
entirely unpaid at the reviewer boundary: no queue, no assignment, no onboarding, no qualified reader.

No release in this repository is customer content, none has been read by a native speaker for approval, and
nothing is deployed. See
[`../../audits/stage-5-pack-driven-authoring-review.md`](../../audits/stage-5-pack-driven-authoring-review.md)
§10 and §35 for the counts and the corrections.
