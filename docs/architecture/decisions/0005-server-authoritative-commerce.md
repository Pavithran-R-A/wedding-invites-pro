# ADR 0005 — Server-authoritative commerce and entitlement state

**Status:** Accepted (Stage 1). This decision records a constraint; it does **not** authorise or
implement payment collection, provider integration, pricing UI or GST handling.
**Date:** 2026-09-25
**Affects:** Database policies, backend/service design, publishing gates, refunds, admin tooling

## Context

Stage 0 audit of this repository found that billing state was client-writable. `projects.paid_status`
(an enum of `unpaid` / `base_paid` / `fully_paid`) was being sent from browser code, and the
owner-only row-level-security policy — `USING (auth.uid() = user_id)` on an `ALL` policy — reuses its
`USING` expression as the `WITH CHECK`, so an authenticated customer could insert or update a project
row that claimed to be paid. The first hardening pass guarded `UPDATE`; a reproduction then showed
the **`INSERT` path was still open**, which required the repair now carried in
`20260924213540_stage0_protect_project_paid_state.sql`.

Two non-obvious mechanics came out of that work, and they are the reason this ADR exists as a
standing rule rather than a review comment:

- **A column `DEFAULT` resolves before `WITH CHECK` and before `BEFORE` triggers.** A policy that
  tests a column value cannot assume the client omitted it; and a trigger that repairs a value runs
  too late to satisfy a check that already failed.
- **A `SECURITY INVOKER` guard function runs with the caller's privileges**, so a privileged
  service path must be distinguished by role, not by a flag in the row. The repair uses a
  `current_user` allowlist so the service role may still set billing state while `authenticated`
  may not.

The full evidence — including the 24-assertion Docker regression suite and the reproduction probes —
is in [`../../audits/stage-0-truth-security.md`](../../audits/stage-0-truth-security.md).

## Decision

**Financial, payment, entitlement and publication-gating state is never browser-authoritative. It
is written only by server-side code paths that are authenticated by role, and enforced in the
database.**

Rules, binding on all future commerce work:

1. **Clients cannot write trusted columns.** Billing, entitlement, publication approval, refund and
   credit state are guarded by both `WITH CHECK` policies on every write path **and** a `BEFORE`
   trigger covering `INSERT` and `UPDATE`. Column `DEFAULT`s must resolve to the *least* privileged
   value.
2. **Guards distinguish caller by role**, using a `current_user` allowlist for service paths, and
   raise `insufficient_privilege` (SQLSTATE 42501) for client roles. Never by a value inside the
   row, and never by trusting a request header alone.
3. **Price is computed server-side, from configuration**, at the moment of order creation. The
   browser may display a figure; it may not determine one. Amounts, currency, tax treatment and
   package identity are re-derived server-side from the order, never accepted from the client.
4. **Entitlement activation happens on verified provider confirmation**, not on a client callback,
   not on a page the user can reopen, and not on a checkout-complete redirect. Webhook signature
   verification and idempotency are prerequisites, as is reconciling against provider state.
5. **Provider webhooks are the only writer of payment state**, and every transition is recorded in an
   append-only ledger with the provider's event identity so replays cannot double-grant.
6. **Publishing gates are enforced at publish time on the server.** Hiding a button is not a gate. A
   client-side feature flag is a convenience, never an authorisation check.
7. **Refunds and revocations reduce entitlement** through the same server-authoritative path; no
   client route may re-grant.
8. **Every trusted column gets an attack test.** Adding one requires a case in the RLS suite proving
   (a) client `INSERT` cannot set it, (b) client `UPDATE` cannot change it, (c) the service role can.
   `bash supabase/tests/rls/run.sh` is the gate, and its assertion count changes only when a case is
   added deliberately.

## Consequences

**Positive**

- A pricing bug, a stale browser tab, or a determined customer with a proxy cannot manufacture a
  paid wedding invitation.
- Revenue leakage becomes a detectable class of failure with an audit trail, rather than an
  explanation offered after the fact.
- The same discipline already covers security-adjacent fields (owner, generation metadata), so there
  is one pattern to test rather than several.
- Regressions in this area are caught by an executable harness in minutes, not by a support ticket.
- Future payment work has an unambiguous contract: implement the writer, then prove the guard.

**Negative / costs**

- More backend work: no "just store what the client told us", and a paid happy path needs a server
  component that a static SPA cannot provide.
- Two places must agree — policies and triggers — which is duplication that exists because a single
  layer was shown to be insufficient. Keep them consistent deliberately.
- Service-role paths need careful, auditable identity, so secrets and role boundaries become real
  operational concerns.
- Local development gets harder: a mock checkout cannot shortcut by writing `paid_status` directly.
- Webhooks, retries, idempotency and reconciliation have to be built before money moves. Nothing
  here may be skipped as "stage 1 is free anyway" and then quietly inherited by the stage that
  charges.

## Non-goals

- **Not implementing payment in this stage.** No provider integration, no checkout UI, no order
  creation, no webhook receiver.
- **Not naming a payment provider.** Any provider mentioned in planning documents is an example, not
  a selection.
- **Not modelling GST or tax.** No tax column, no inclusive/exclusive claim, no invoice number
  format. Those belong to the commerce stage with accounting input.
- **Not exposing prices in the product.** Target figures live in `docs/product/commercial-model.md`
  marked `TARGET / SUBJECT TO PILOT VALIDATION`, and must not be hardcoded into UI.
- **Not building a refund or invoicing workflow.**
- **Not trusting client-supplied identifiers as authorisation.** Knowing a project id is not
  permission to modify it; ownership and role are checked on every path.
