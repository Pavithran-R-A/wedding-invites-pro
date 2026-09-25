# VivaahVarnam — product documentation

These documents are the product contract. They exist so that a person (or an agent) opening this
repository can tell, without reading UI code, what VivaahVarnam is *for*, what actually works
today, and what is only a plan.

> **Current implementation ≠ Target V1.**
> Everything under "Preview works today" in these docs is backed by code in this repository.
> Everything labelled V1, later, or planned is a design intent — it is not available, not
> purchasable, and not promised to a date. UI copy must never present the second group as a
> capability.

## The documents, and how they relate

| Document | Answers | Read it when |
| --- | --- | --- |
| [`v1-scope.md`](v1-scope.md) | What is in the first real release, and what we refuse to build | Deciding whether a feature belongs in the product |
| [`invitation-semantics.md`](invitation-semantics.md) | What a *patrika* actually is: its sections, order, and who controls them | Modelling invitation data or rendering |
| [`structured-creator.md`](structured-creator.md) | Why creation is a guided form and not a canvas, and what stays freeform | Designing the creation flow |
| [`content-governance.md`](content-governance.md) | How tradition-pack wording, motifs and translations become trustworthy | Touching cultural/ceremonial content |
| [`design-principles.md`](design-principles.md) | Visual and editorial rules, accessibility targets | Making UI decisions |
| [`commercial-model.md`](commercial-model.md) | What we intend to charge for — and what we will never charge for | Evaluating pricing or paywall ideas |
| [`brand-clearance.md`](brand-clearance.md) | The legal status of the name "VivaahVarnam" | Writing brand copy or choosing a domain |
| [`feature-readiness.md`](feature-readiness.md) | Per-capability truth: IMPLEMENTED / FOUNDATION / PLANNED V1 / LATER / EXCLUDED | Before claiming anything works |

The chain of dependency runs roughly: **scope → invitation semantics → structured creator →
content governance → design**, with **commercial model** and **brand clearance** as constraints
that cut across them, and **feature readiness** as the audit of all of it against the code.

## Related engineering documents

- [`../architecture/decisions/`](../architecture/decisions/) — the five standing ADRs
- [`../architecture/stage-2-domain-blueprint.md`](../architecture/stage-2-domain-blueprint.md) —
  documentation-only domain design for Stage 2 (no schema, no migrations)
- [`../audits/stage-0-truth-security.md`](../audits/stage-0-truth-security.md) — the verified
  security and truthfulness baseline

## Vocabulary

- **Patrika** — the invitation as a complete, readable ceremonial document, not a graphic.
- **Tradition pack** — user-selected data describing section order, labels, event vocabulary,
  motifs, typography guidance and reviewed wording samples. Selection is always explicit.
- **Host** — the person or family issuing the invitation.
- **Household** — a group of guests reached through one link (a family, a flat, an office desk).
- **Event scope** — which functions a given recipient is invited to.
- **Version** — an immutable snapshot of an invitation that approvals and publications attach to.
