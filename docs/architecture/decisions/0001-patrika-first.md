# ADR 0001 — Patrika-first: the invitation document is the product

**Status:** Accepted (Stage 1)
**Date:** 2026-09-25
**Affects:** Product scope, information architecture, design system, all rendering work

## Context

The repository began as a project-management scaffold: accounts, "projects", a dashboard of
projects, a configuration screen. That framing is technically accurate and commercially wrong.
Nobody buys a wedding invitation because they want to manage a project record. They buy it because
a document exists that their family will accept, that their guests can open on a phone, and that
carries the right language, names and blessings.

Adjacent products fail in two opposite ways. General design tools (Canva-class) hand the customer an
empty canvas and make them responsible for ceremonial correctness. Wedding-planner suites treat the
invitation as one module among budgets, seating and vendor lists, so the document itself stays
shallow. Both are reasonable businesses; neither is the wedge we are taking.

## Decision

Organise the product around the **patrika** — the invitation as a complete, structured, readable
ceremonial document — and treat everything else (accounts, drafts, dashboards, guest data,
payment) as infrastructure in service of that document.

Concretely:

1. Every screen is judged by whether it makes the document better, more correct, or more likely to
   be approved by a family.
2. The document, not the account, is the shareable artefact. A guest must never need an account.
3. Design quality of the document is non-negotiable and is protected by structural constraints
   (see ADR 0002), not by asking the host to design well.
4. Terminology follows the product, not the database. Internal `projects` rows are presented to
   users as invitation drafts.
5. The priority order in the product contract (emotional quality → family acceptance → language
   correctness → guest mobile → low-friction creation → trustworthy payment → premium services) is
   the tie-breaker when these conflict.

## Consequences

**Positive**

- A small, defensible scope: we can be excellent at one artefact rather than adequate at a suite.
- Marketing and onboarding become honest — show the document, describe what it does today.
- Multi-output work (page, image, PDF, QR) has a natural single source of truth (ADR 0004).
- Family acceptance becomes a first-class flow instead of an afterthought, which is the actual
  purchase blocker in this market.

**Negative / costs**

- We lose the "all-in-one planner" pitch and the revenue lines that come with it.
- Document fidelity is hard and unforgiving: typographic and language errors are immediately visible
  to the exact audience whose trust we need.
- Some scaffolding we already have (generic project dashboard language) now reads as slightly
  off-purpose and must be re-skinned rather than extended.
- It raises the bar for the template/design content, which needs reviewed cultural input (see
  `docs/product/content-governance.md`) rather than generated filler.

## Non-goals

- Not a wedding planner, budget tracker or vendor marketplace.
- Not a general design tool or a free-form canvas.
- Not a seating chart, travel assistant or guest-messaging automation platform.
- Not a social network around weddings.
- Not a source of authoritative religious or ceremonial instruction.
- Not a Canva competitor on feature count.
