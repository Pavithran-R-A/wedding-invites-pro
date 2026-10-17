# Stage 10 kickoff — one-time commerce and server-authoritative entitlements

**Status:** discovery and implementation contract, NOT provider selection, rollout approval, prices, invoices, tax advice, or a claim that payments work.
**Prepared:** 2026-10-17
**Branch baseline:** Stage 9 merged at `6ac1a6765dcfd5c0f6659458f00a59032829edee`.

## 1. Repository constraints that already govern this stage

The binding sources are `docs/architecture/decisions/0005-server-authoritative-commerce.md`, `docs/product/commercial-model.md`, `docs/product/v1-scope.md`, and the qualified `public.entitlements` protection from Stage 2.

- The product sells a **one-time package per wedding**, not an automatic subscription or a charge per guest. Core guest access, maps, RSVP, QR, and access to one's own RSVP export must not become micro-add-ons.
- The illustrative ₹999 / ₹2,499 / ₹4,999 / ₹9,999+ package amounts are **TARGET / SUBJECT TO PILOT VALIDATION**, not prices or offers. Never surface them in the app or copy them into order creation without a separately approved price/tax configuration.
- The client cannot create a paid right, set a price, mark a payment complete, or override the publish-time entitlement check. Existing draft and guest protections must not be weakened by introducing billing.
- A browser redirect, checkout success callback, or guessed provider event is not permission to grant an entitlement. Apply ADR 0005's verified provider confirmation, idempotent append-only event ledger, trusted-role guards, and reconciled captured-payment evidence.
- `legacy.payments`, `legacy.orders`, and `legacy.projects.paid_status` are archival evidence, **not** a new billing ledger and not a source of existing customer rights.

## 2. Provider research — options, NOT a selection

**Razorpay** (primary pricing: https://razorpay.com/pricing/ ; integration: https://razorpay.com/docs/server-integration/python/test-app/ ):
public standard pricing describes approximately 2% platform fees on successful transactions, with no standard setup or AMC charges, plus GST on platform fees. Public 2026 introductory terms advertise a 0% platform-fee offer for eligible newly activated merchants, limited by time and turnover. Account-specific KYC, eligibility, accepted payment methods, settlement and refunds still require confirmation.

**Cashfree Payments** (primary pricing and offer terms: https://www.cashfree.com/payment-gateway-charges/ ; webhook signature example: https://www.cashfree.com/devstudio/preview/pg/tools/webhookVerification ):
public pricing describes approximately 1.95% standard platform fees after any eligible promotion, zero setup fee, and a promotional 0% platform-fee offer up to ₹20 lakh in eligible domestic GMV subject to campaign dates, activation/KYC, exclusions, GST and fair-use terms. The page expressly says GST may still be charged based on the standard platform fee during the promotion. Do **not** describe the offer as cost-free or guaranteed. International, EMI, subscription and other excluded methods can have different fees.

**Decision rule:** choose a provider by verified live merchant onboarding, API/webhook quality, supported UPI/cards, refund/dispute controls, compliance, and actual settled cost *after taxes and promotions*—not by a headline promotional rate. The offers can change, and public pricing does not prove the connected merchant's own rates. A PSP-neutral internal contract is appropriate until a provider is explicitly selected.

## 3. Safe order of implementation

1. **Threat model and commercial decision record first.** Identify which existing user flows remain freely usable, what human services each paid tier genuinely delivers, what cancellation/refund policy applies, what entity takes payment, and whether tax is inclusive/exclusive. These are open owner/accounting decisions, not coding defaults.
2. **Server-only quote/order contract.** Plan canonical package catalogue, currency minor units, price version, expiry, owner/wedding binding and a server-generated immutable quote. Refuse browser-supplied totals, wedding substitution, repeated checkout initialization and old quotes. Use a unique merchant order reference and idempotency key. Do not treat `estimated_guest_count` as a billable quantity.
3. **Append-only payment ledger.** Design separate new-commerce orders, payment attempts, provider event IDs, refunds/disputes and settlement/reconciliation evidence. Never repurpose legacy archived money tables. Define idempotency at both provider-event and business-order levels, with unique indexes and transitions that refuse out-of-order or replayed events.
4. **Signed webhook boundary.** Verify the provider signature against the **unaltered raw request body** (and required timestamp/header conditions) before JSON interpretation. Query provider status where necessary; compare order identity, exact amount/currency, capture state and ownership. No entitlement based on a callback or frontend message. Never write provider secrets to browser bundles, DB rows, source code, evidence or unmasked logs.
5. **Entitlement service and publish-time guard.** Only a trusted backend identity writes `public.entitlements`; preserve SQL RLS and trigger refusals for anon/authenticated. A completed payment is not automatically an entitlement unless package and service terms pass validated server checks. Make refunds, reversals and disputes explicit and auditable; do not silently delete finance history or revoke access incorrectly.
6. **Host UI only after server contract.** Show accurate hosted checkout state, pending confirmation, recovered state after reload, cancellation, support/refund route and denied payment conditions. Keep price copy disabled until commercial decisions have been approved. Guest link and RSVP routes must never depend on a guest's payment or session.
7. **Sandbox before live.** Test locally with synthetic signed webhook fixtures and sandbox interactions if credentials are available. Do not create real orders or charge real customers, deploy, set live webhook endpoints or claim live capability in this branch.

## 4. Mandatory negative and failure-path tests

- Forged signature, modified body, wrong timestamp, replayed event ID, late event, events delivered out of order, wrong environment, wrong merchant/order/wedding, wrong amount or currency, and browser-success without captured payment.
- Double-clicked checkout, parallel payment completions, network retry, webhook retry, failed capture, cancelled/expired orders, provider API outage, reconciliation drift, refund and chargeback.
- Attempted direct `entitlements` INSERT/UPDATE by unauthenticated, account A, account B, and even by an authenticated owner with a fabricated `paid` payload.
- Authorization on every server path; a user can never activate, revoke, refund or read another wedding's payment or entitlement by swapping an ID.
- Correct publishing decision at the *database/server* operation, including stale browser tabs and racing webhook/refund events.
- Money history survives intended privacy/account deletion workflows under a written retention and erasure contract; no accidental cascading finance deletion.
- Repeatable unit/SQL/HTTP/browser/sandbox runs with residue accounting and exact exit codes, including all Stage 2–9 historical security regressions. Do not label unrun tiers green.

## 5. Release and operating boundaries

- Work in `stage10/commerce-entitlements`; protect `main`; push each qualified atomic commit and verify `git ls-remote` SHA against local HEAD. GitHub Actions quota remains limited; never infer green CI from a queued run.
- No live checkout, no hosted Supabase contact or deployment, no live payment provider configuration, no paid infrastructure, and no Stage 11 work without explicit approval.
- The shared Windows host was last reported with essentially zero C: headroom. Do **not** launch Docker, `npm ci`, a build or Chromium until disk space is measured and safely recovered. Never prune shared volumes/images, delete unrelated project data, or reset the local stack. Continue analysis, code review and safe remote branch work without using that drive.
- Preserve the append-only audit discipline. Clearly label implemented, exercised locally, exercised in provider sandbox, and live-customer-verified as different levels of evidence.

## 6. Unresolved decisions that are genuinely owner-dependent

- Legal merchant/KYC identity and actual provider account suitability; final provider selection.
- Approved product package and actual checkout prices, inclusive/exclusive GST treatment and invoice responsibilities.
- Fair cancellation, refund and chargeback policy, and any manual human-service delivery terms.
- Hosting/server availability to receive signed webhooks and reconcile statuses.

**Nothing in this kickoff creates a payment endpoint, invoice, financial liability, entitlement, live offering, or a customer-facing price.**
