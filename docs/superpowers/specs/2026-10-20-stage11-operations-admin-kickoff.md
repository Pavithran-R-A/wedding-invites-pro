# Stage 11 — Basic operations, support and incident administration

**Status:** implementation kickoff, not deployed operational tooling, not live commerce activation or approval of irreversible actions.
**Date:** 2026-10-20
**Starting baseline:** main at `c9eb27aa2e27422d9da3bdc29bedd3e49b8adb21` with locally qualified Stages 1–10.
**Work branch:** `stage11/operations-admin`

## 1. Binding scope and prior decisions

The V1 scope says: **Basic operations/admin — support, refunds, takedowns, incident response**; separately **Deletion/privacy — guests' data must be removable on request**. Stage 13 retains the financial retention-and-erasure decision. Stage 10 created a provider-neutral, **non-live** commerce foundation; it must remain non-live and must not create a pretend refund or money-moving interface.

Keep ADR 0005 (server-authoritative commerce), ADR 0008 (no provider selected), the Stage 10 security dispositions in `docs/audits/stage-10-commerce-foundations.md` §20, and all Stage 3/6/7/8 publication, storage, review, guest, RSVP and token protections intact.

## 2. Stage 11 V1 objective

Build the minimum **trustworthy operational workflow** for a small invitation business, not a broad CRM or general back-office platform:

1. **Support case lifecycle:** authenticated, scoped tickets tied to an owning wedding or user when possible. Explicit states, assignments, evidence/time history and a clear resolution trail. Guard against forging another owner's identity or leaking a guest roster.
2. **Read-only operational health:** local/on-premise dashboard or trusted maintenance CLI to inspect migration parity, auth/delivery failures, token abuse, rate-limit events, publication states and output delivery; distinguish current state from stale logs.
3. **Publication takedowns:** scoped, audited revoke/disable operation with guarded authorization, host-impact messaging, fail-closed credential and object-access semantics. Demonstrate that previously issued signed Storage URLs may survive until expiry unless objects are deleted or delivery is otherwise revoked; do not claim immediate invalidation without measuring it.
4. **Refund/support oversight:** allow a trusted operator to *record/review/triage* a refund inquiry or dispute and read existing Stage 10 ledger projections. No automatic refund initiation, capture, entitlement modification, retroactive policy change, or charge, absent an approved provider and explicit business policy.
5. **Incident response and operator audit:** append-only reasoned operations with actor identity, affected wedding, timestamp, safe before/after state, idempotency and explicit permission guards. Distinguish system-generated evidence from a human administrative decision.
6. **Privacy and data export/erasure intake:** allow properly authenticated requests to be registered and routed; avoid promising destructive deletion of financial records. Stage 13 owns the actual legal retention, identity-verification and complete erasure model.

Treat a human/owner-only approval as required for irreversible operations that would impact unrelated real customers, but build safe testing and dry-run paths with fully synthetic data.

## 3. Boundaries and threats

- Do not expose an admin console merely by hiding links in the browser. Internal/admin APIs must authenticate and authorize roles **server-side**, with explicit SQL grants and RLS/SECURITY DEFINER review. Every privilege needs denial tests for anonymous, authenticated normal host, hostile host and intended operator.
- Do not place a service-role/secret key in browser code or logs. Avoid making arbitrary SQL, custom URLs, raw credentials, account emails, token digests or customer PII available through an operational UI.
- Keep all role and operator-grant changes migration-backed and audit-tested. Avoid blanket service_role DML grants.
- A support operator may not claim ceremonial-language approval, invent a price, activate paid publishing, grant an entitlement or alter a historical refund.
- Never touch DueWeave, ClaimKhoj or any unrelated project's keys, deployment, Docker resources or customer data.
- Keep the existing published guest documents accessible by default unless a verified, authorized takedown actually changes their status.

## 4. Evidence plan

Start by inspecting current support/admin interfaces and database records. Write a precise authorization and threat-model matrix before migrations or endpoints. Implement in small atomic slices with test-first refusal cases. For every slice:

- Local SQL/catalog/role/RLS attack tests, including replay, race conditions and incorrect-scoped target IDs.
- HTTP/API tests proving actual codes/bodies and database postconditions, including hostile callers and teardown residue.
- Authenticated operator-browser or CLI workflows with measured outcomes; no fake claims of deployed services.
- Cross-stage regression suites (Stages 2–10), product-contract, dbtypes, render/bundle, typecheck, lint, unit and build gates.
- Log redaction and secrets checks; capture exact exit codes and the head each test used.
- Independent verification that public invitation/guest/RSVP/review doors still refuse unrelated credentials.
- Explicit provisional/non-live status in `docs/product/feature-readiness.md` until actually measured.

## 5. Environment and release policy

Stage 10's closing report recorded C: at about 1.94 GB free, volatile; this is not evidence of today's space. Measure actual headroom before Docker, Chromium, npm installations or large builds; recover only verified disposable, task-owned bytes and never prune shared data without specific approval.

GitHub Actions triggered by commits to main currently returns failed jobs without exposed execution steps and has had quota limits. Local test captures, not CI, are certification until independently confirmed otherwise.

Commit narrow, tested slices to `stage11/operations-admin`; push and verify remote SHA after each one. Preserve untracked files and all other projects. Do not force-push, deploy, contact hosted Supabase, enable live payments, decide tax/refunds, delete production records, merge into main or begin Stage 12.

## 6. Handoff and unresolved decisions

Qoder should do all safe research, coding, local testing, narrow commits and GitHub pushes autonomously. Escalate only human-owned permissions, legal/retention decisions, real merchant-account activation, or host recovery that would risk shared state. Return the exact final SHA, changes, role/grant map, security tests, regression counts, operational limitations and unresolved owner approvals to ChatGPT for independent review and merging.

**No live operator authority is granted by this kickoff document.**
