# ADR 0008 — One provider-neutral payment ledger, and no provider chosen yet

**Status:** Accepted (Stage 10). This decision fixes the shape of the money data model. It does
**not** select a payment provider, authorise a price, enable live collection, or claim that any
payment works.
**Date:** 2026-10-17
**Affects:** `private` schema, `internal_api`, the publish path, `public.entitlements`, refunds, admin tooling
**Design record:** [`../commerce-foundations.md`](commerce-foundations.md)

## Context

ADR 0005 settled *who* may write financial and entitlement state, in the aftermath of a measured
defect: `projects.paid_status` was browser-writable through an `ALL` policy whose `WITH CHECK` was the
owner's `USING` expression, and the first repair guarded only `UPDATE` while the `INSERT` path stayed
open. What it deliberately did not do — "not modelling GST… not building a refund or invoicing
workflow", its own Non-goals — is the surface Stage 10 now has to stand on.

Two facts from the current repository shape the decision.

- **`public.entitlements` is already qualified and is not a draft.** It carries `package_code` (a
  code, never an amount, per `20260925120400_stage2_assets_entitlements_secrets.sql:49-51`),
  `source IN ('service','admin_manual')`, a partial unique index allowing one live grant per wedding
  and package, a `CHECK ((status = 'active') = (revoked_at IS NULL))`, and both
  `reject_client_write`/`reject_client_delete` triggers. A browser can read its own wedding's rows
  through `owners_read_entitlements` (`20260925120500_stage2_rls_and_grants.sql:337-340`) and can write
  none. Anything Stage 10 builds must terminate *in this table*, or the product has two answers to
  "has this wedding paid".
- **Nothing gated publishing on an entitlement when this decision was taken.** `internal_api.publish_invitation_version`
  checks ownership, version membership, expiry and the live row
  (`20260926150000_stage3_privileged_bodies_behind_wrappers.sql:199`, replaced at
  `20261009120000_stage8_guest_invitations_rsvp.sql:957`); the word `entitlement` does not appear in
  that file. The deferral is written down, not discovered: `docs/architecture/stage-2-domain-blueprint.md`
  said the check was "not enforced yet … Stage 10 owns it" — and Stage 10's implementation closed it with
  the `publications_commerce_publish_gate` trigger, which is why the blueprint's I-22 row now reads
  "enforced, and off by default" rather than the sentence quoted above.

The provider research (kickoff §2, and the same reading this document records for signatures) describes
two gateways whose mechanics differ in ways that a schema must not absorb: Razorpay signs the raw body
with HMAC-SHA256 and sends a **hex** digest in `x-razorpay-signature`, with no timestamp in the signed
input; Cashfree signs `"<timestamp>.<body>"` and sends a **base64** digest in `x-webhook-signature`
with `x-webhook-timestamp`. Both advertise promotional 0% platform fees whose eligibility, dates and GST
treatment are account-specific. A schema that encoded a provider's field names, or a price, or a
promotional rate, would be a schema that re-decides those questions every time the answer changes.

## Decision

**Stage 10 models money as a provider-neutral, append-only ledger in `private`, terminates in the
existing `public.entitlements`, and encodes no provider's wire format, no price and no promotional
terms in the data model.**

1. **One ledger, six tables, none of them browser-reachable.** `commerce_packages`,
   `commerce_orders`, `commerce_payment_attempts`, `commerce_payment_events`, `commerce_refunds` and a
   single-row `commerce_policy` live in `private`, which PostgREST never sees
   (`supabase/config.toml:32` exposes `["public", "api"]`), have no client grants, have RLS enabled
   with no policy, and carry the Stage 2 client-write/delete refusal triggers.
2. **The quote and the order are one immutable row.** A server-generated quote that exists apart from
   the order is a second source of truth about price. `commerce_orders` freezes
   `package_code`, `price_version`, `amount_minor`, `currency` at creation, refuses UPDATE of those
   columns by a dedicated trigger, and expires on its own `quote_expires_at`.
3. **Initiation, capture, activation, refund and revocation are four separate facts, not one status
   column.** Order state, attempt state, entitlement state and refund state advance independently, and
   the host's view is *derived* from all four. `refunded` is not an order status.
4. **Idempotency is asserted twice, differently.** Provider-event idempotency is
   `UNIQUE (provider, event_id)` on the ledger; business-order idempotency is the guarded state
   machine, so a *distinct* event cannot move a state twice either. Retries answer with the original
   recorded outcome.
5. **Signature verification lives outside the database.** PostgREST parses a body into arguments, and
   a re-serialised JSON document is not the byte string a provider signed. The verifier is a pure
   module over the raw bytes, constant-time comparison, one adapter per provider; it decides
   *provenance* and nothing else. `record_commerce_event` decides state. A valid signature is input to
   the decision, never authorisation by itself.
6. **The browser callback is not a writable path.** No function accepts a signature from a page, so a
   forged checkout callback — including one whose HMAC is arithmetically correct under a test secret —
   has nothing to reach.
7. **Price is data the owner has not supplied, and the absence is enforced.** `commerce_packages` is
   created empty; the `commercial-model.md` targets are not seeded, because a target copied into
   migration data becomes the price by being present. `create_commerce_order` therefore refuses every
   quote, and `commerce_host_summary` omits the amount while `display_approved` is false. Turning the
   figures into an offer is one trusted `INSERT`, reviewable as data.
8. **The publish gate is a trigger on `public.publications`, not an edit to the publisher.**
   `publish_gate` defaults to `permissive`, so no existing behaviour changes and every historical
   chain that publishes stays green; `entitlement_required` demands an active entitlement whose
   package is named in `publish_required_package_codes`, re-derived from the row's own `wedding_id`.
   A gate placed in one RPC gates one RPC.
9. **A refund does not silently revoke a right.** `refund_revocation_mode` is `hold_for_review` by
   default, because `commercial-model.md` asks that refund fairness be *designed before money is
   taken* and that design is still the owner's. Revocation remains a server-authoritative function,
   never a DELETE, and a chargeback is held for review whatever the policy says.
10. **Money history does not cascade and is never rewritten.** Foreign keys to `public.weddings` are
    NO ACTION and to `auth.users` `SET NULL`, so an account erasure fails rather than deleting what was
    charged. The ledger carries an absolute `BEFORE UPDATE` refusal that binds trusted roles too: a
    correction is a new row plus an audit event.

## Consequences

**Positive**

- A provider can be added, replaced or run in parallel by writing an adapter and a `provider` value,
  not a migration — and dropping a provider cannot orphan its evidence.
- "Is this wedding entitled?" has exactly one answer, in the table Stage 2 already proved.
- The dangerous transitions are refused by constraints the database enforces (unique indexes, frozen
  columns, guarded edges), not by an instrument behaving itself well.
- Every claim Stage 10 can make is bounded: the same code that qualifies against synthetic fixtures is
  what a sandbox run will exercise, so a green local tier means something specific and no more.
- The unresolved commercial questions are recorded as configuration with safe defaults, so engineering
  is not blocked by them and nobody can mistake the default for a decision.

**Negative / costs**

- Six `private` tables, seven `internal_api` bodies and the one `api.commerce_host_summary` wrapper paired
  to a definer function — all of which have to be enumerated in
  `supabase/tests/stage2/40_catalog.sql` behind `st2_at_least('stage10')` — the catalogue is deliberately
  a census, so new surface is invisible only if it is also unreviewed.
- Duplication between DDL constraints and the state machine's refusals, accepted for the reason ADR
  0005 gives for policies *and* triggers: one layer was already shown to be insufficient.
- No live webhook receiver exists, so the ledger's assumptions about delivery (retries, ordering,
  at-least-once) are modelled from documentation and synthetic fixtures rather than observed. §0 of the
  design record is written so this gap cannot be read as a pass.
- `hold_for_review` means a refund leaves an entitlement standing by default. That is a deliberate
  refusal to invent policy, and it needs an owner's answer before real money moves.
- Promotional platform-fee terms (Razorpay's 0% offer, Cashfree's up to ₹20 lakh domestic GMV) are
  excluded from the model entirely, so "what does this cost us" stays an accounting exercise, not a
  column.

## Non-goals

- **Not selecting a provider.** `CHECK (provider IN ('razorpay','cashfree'))` is a closed list to make an
  unknown provider impossible, not a shortlist decision.
- **Not enabling live collection.** No credentials, no endpoint, no `live_capture_enabled` flip.
- **Not modelling tax, GST, invoices or credit notes.** No `tax*`, `gst*`, `invoice*` column.
- **Not pricing anything.** The catalogue is empty and the refusal is the shipped behaviour.
- **Not gating guests, RSVP, maps, QR or exports.** Those paths gain no commerce dependency, and the
  historical guest tiers must stay green as proof.
- **Not building subscription or usage billing.** One-time per wedding, per `commercial-model.md`.
- **Not deleting finance history.** The erasure contract is the owner's decision; Stage 10 only makes
  accidental deletion impossible.
