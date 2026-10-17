# Stage 10 — Commerce foundations: one server-authoritative ledger, no price, no provider

**Status: design and threat model, and the contract the Stage 10 migration is written against.** This
document authorises no price, no provider, no invoice, no tax treatment, no refund policy and no
live checkout. It is written before the migration because `docs/superpowers/specs/2026-10-17-stage10-commerce-kickoff.md`
§3 step 1 orders it that way, and because a billing schema written first is a billing schema whose
decisions nobody can name afterwards.

**Branch baseline:** `stage10/commerce-entitlements` at `e94c53ef0301318b1cb4858dc6584f562a5b8671`
(one documentation commit on top of merged Stage 9 at `6ac1a676…`).
**Binding sources:** [ADR 0005](decisions/0005-server-authoritative-commerce.md),
[`docs/product/commercial-model.md`](../product/commercial-model.md),
[`docs/product/v1-scope.md`](../product/v1-scope.md), the kickoff above, and the qualified
`public.entitlements` protection from Stage 2.

## 0. The evidence vocabulary this stage has to keep straight

A payment system fails in a way that "tests pass" does not describe. Every claim in Stage 10 is
therefore tagged with one of five levels, and the audit document repeats the tag rather than
upgrading it:

| Level | Means |
| --- | --- |
| **designed** | written down here, not yet in code |
| **implemented** | exists in a migration or a source file at a named SHA |
| **exercised locally** | run against the shared `localvivaahvarnam` Postgres/Stack, with a capture |
| **exercised against synthetic provider fixtures** | driven by signatures produced in this repository from test keys that never contacted a provider |
| **live-customer-verified** | **not reached by Stage 10, and not reachable from it.** Nothing here may be described as working with a real merchant account |

The gap between "exercised against synthetic provider fixtures" and the last row is the whole of the
commercial risk, and it is why §12 lists what this stage refuses to build.

## 1. What Stage 10 builds, in one paragraph

A place to put a purchase order, a payment, a provider event and a refund such that the database —
not the browser, not a redirect, not a person reading a webhook log — decides whether a wedding has
paid. The entitlement record itself already exists (`public.entitlements`, Stage 2) and is **not**
duplicated. Prices do not exist yet and the ledger refuses to quote without one, so the machinery can
be qualified end to end while the commercial decision is still genuinely open.

## 2. Objects, and why each one is separate

Six tables, all in `private`, which is a schema with no `USAGE` for `anon`/`authenticated` and which
PostgREST never sees: `supabase/config.toml:32` exposes exactly `schemas = ["public", "api"]`. Money
rows are therefore unreachable over REST as a property of the configuration, not a policy that could
be dropped by accident — the same belt that Stage 2 put on `private.audit_events`.

| Object | Holds | Why it is not merged into the one next to it |
| --- | --- | --- |
| `private.commerce_packages` | a price *version*: `package_code`, `currency`, `amount_minor`, `price_version`, `status`, `display_approved` | A price has to be versioned or an order cannot say which price it was sold at. `amount_minor` is a provider-neutral minor-unit integer; for `INR` the unit is the paise. |
| `private.commerce_orders` | the immutable purchase order — the server-calculated quote and the order, as one row | **A separate quote object is the defect.** A quote that can expire, be re-priced, or be swapped for a different wedding is exactly how "the price the customer saw" diverges from "the amount that was charged". One row, frozen at creation, with a `quote_expires_at`. |
| `private.commerce_payment_attempts` | one provider payment object: `provider`, `environment`, provider order/payment references, `initiated`→`confirmed`/`failed` | Initiation is not capture (kickoff §3 step 5 lists them as separate facts). Collapsing them makes "the customer opened checkout" indistinguishable from "the money is ours". |
| `private.commerce_payment_events` | the append-only ledger: `(provider, event_id)` unique, `raw_body_sha256`, `signature_valid`, `occurred_at`, `received_at`, `processing_status`, `applied_effect` | This is ADR 0005 rule 5. It records what arrived, including deliveries that were refused, so a replay, a forged body and an out-of-order pair are all answerable afterwards. It is *evidence*, not state: it never gets updated. |
| `private.commerce_refunds` | refund and chargeback records with their own identity and amount | A refund is money moving the other way against an order that remains captured. Overloading `orders.status` with `refunded` would erase the difference between "we have the money" and "we kept the money". |
| `private.commerce_policy` | one row: `publish_gate`, `publish_required_package_codes`, `live_capture_enabled`, `refund_revocation_mode` | Three of Stage 10's honest answers are *configuration the owner has not given yet*. Modelling them as data with a safe default is how the code can be finished before the decisions are. |

Reused rather than reinvented:

- **`public.entitlements`** (`20260925120400_stage2_assets_entitlements_secrets.sql:43-77`) stays the
  only record of a right. Its `package_code` is the catalogue's key, its `source` is already
  `('service','admin_manual')`, its partial unique index already allows one live grant per wedding and
  package, and its `CHECK ((status = 'active') = (revoked_at IS NULL))` already forbids the sloppy
  state. Stage 10 adds a writer, not a second ledger — and the order points at the entitlement
  (`commerce_orders.entitlement_id`), so `public.entitlements` needs no new column and the generated
  client types need no new field.
- **`private.audit_events`** (`:86-110`) is the only audit trail. Its `subject_type` namespace is
  explicitly free-form for this reason; Stage 10 writes `'commerce_order'`, `'commerce_event'`,
  `'entitlement'` and `'reconciliation'` rows into it. A second audit table would be a second place
  for the truth to disagree with itself.

Not created, deliberately: no `paid_status` (it is a forbidden canonical column —
`scripts/check-db-contract.mjs:61-72`), no billing column on `public.weddings`, no customer-readable
money table, no second entitlement shape, no `legacy` reuse (`legacy.payments`/`legacy.orders` are
archival evidence only, per kickoff §1).

## 3. Invariants each table carries in the DDL

Chosen because a rule that is only written in this document is a rule the next migration breaks.

`commerce_packages`
- `CHECK (amount_minor > 0)`, `CHECK (currency IN ('INR'))` — the currency list is a CHECK, not an
  enum, so widening it is one forward migration and not a shared type.
- `CHECK (price_version >= 1)`; `UNIQUE (package_code, price_version)`; partial
  `UNIQUE (package_code) WHERE status = 'active'` — **at most one quotable price per package**, which
  is what makes "which price did this order get?" answerable forever.
- `status IN ('draft','active','retired')`, and `CHECK ((status = 'retired') = (retired_at IS NOT NULL))`.
- `display_approved boolean NOT NULL DEFAULT false` — *quotable* and *showable* are different
  decisions. A price may be sellable while its copy, GST treatment or invoice wording is uncleared.

`commerce_orders`
- `wedding_id uuid NOT NULL REFERENCES public.weddings(id)` with **no ON DELETE clause** (NO ACTION) —
  the Stage 2 rule for frozen history: money does not vanish when a family leaves.
- `owner_user_id` is copied from `public.weddings.owner_user_id` at creation by the writer, never
  supplied; `REFERENCES auth.users(id) ON DELETE SET NULL` so an account erasure does not delete the
  order that proves what that account was charged.
- `amount_minor`, `currency`, `package_code`, `price_version` are frozen by a dedicated
  `BEFORE UPDATE` trigger that compares OLD and NEW — *immutability is asserted, not advised*.
- `merchant_reference text NOT NULL UNIQUE` — the provider-neutral reference this product mints. It
  is the only order identifier that ever leaves the database, and it is what a webhook must name.
- partial `UNIQUE (wedding_id, package_code) WHERE status IN ('open','payment_pending')` — the
  double-clicked-checkout and parallel-initiation refusal, enforced where a race can actually hit.
- `CHECK ((status = 'captured') = (captured_at IS NOT NULL))`,
  `CHECK ((status IN ('cancelled','expired')) = (closed_at IS NOT NULL))`, and `entitlement_id` set
  only by the activation step.

`commerce_payment_attempts`
- `UNIQUE (provider, provider_payment_ref) WHERE provider_payment_ref IS NOT NULL` and
  `UNIQUE (provider, provider_order_ref) WHERE provider_order_ref IS NOT NULL` — one provider payment
  object cannot be initiated twice inside our ledger.
- `CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))`; `environment IN ('live','sandbox','synthetic')`.
- its `order_id` FK is NO ACTION for the same reason as above.

`commerce_payment_events`
- `event_id` is required and non-blank: `CHECK (length(btrim(event_id)) > 0)`. A ledger row without
  the provider's own event identity is undeliverable evidence, so the table refuses it.
- `raw_body_sha256 text NOT NULL CHECK (raw_body_sha256 ~ '^[0-9a-f]{64}$')` — the same shape
  `private.access_tokens.token_hash` uses (`:125`). The raw body is **not** stored: it can carry
  card metadata, customer names and provider internals, and a digest is enough to prove later that the
  bytes we acted on are the bytes that were signed.
- `processing_status IN ('applied','duplicate','rejected_signature','held_for_reconciliation','stale')`
  and `applied_effect` a free namespace (`'attempt_initiated'`, `'order_captured'`,
  `'entitlement_granted'`, `'refund_recorded'`, `'ignored_already_captured'`, …) — the effect is
  recorded so a replay's *answer* is reproducible, not just its arrival.
- an absolute `BEFORE UPDATE` refusal (`private.reject_any_update()`, raised for every role including
  the trusted ones) and a `reject_client_delete` backstop. Append-only has to mean append-only for the
  writer, or it means nothing.

`commerce_refunds`
- `kind IN ('refund','chargeback')`, `status IN ('recorded','succeeded','failed','reversed')`,
  `CHECK ((status = 'succeeded') = (completed_at IS NOT NULL))`, `amount_minor > 0`, and an
  `event_id bigint` pointing at the ledger row that caused it: a refund with no originating delivery
  is a manual intervention, and `private.audit_events` records who did it.

`commerce_policy`
- `id integer PRIMARY KEY CHECK (id = 1)` — the singleton trick, so "the current policy" cannot
  become two rows that disagree.
- `publish_gate IN ('permissive','entitlement_required') DEFAULT 'permissive'`,
  `publish_required_package_codes text[] NOT NULL DEFAULT '{}'`,
  `live_capture_enabled boolean NOT NULL DEFAULT false`,
  `refund_revocation_mode IN ('hold_for_review','revoke') DEFAULT 'hold_for_review'`.

Every one of the six gets: `set_updated_at` (where it has `updated_at`),
`private.reject_client_write()` and `private.reject_client_delete()` triggers
(`20260925120000_stage2_privilege_baseline.sql:137-152`, `:169-186` — a `current_user` allowlist, so
the distinction is the role, never a value in the row), `ENABLE ROW LEVEL SECURITY` with **no policy**,
and no grant to `anon`/`authenticated`. RLS with no policy denies every read even if a later migration
mistakenly grants the table: the same duplication Stage 2 accepted for `audit_events` and
`access_tokens`, because two layers that must both fail is the only shape that has survived an audit.

## 4. The two levels of idempotency, and the state machine

Kickoff §3 step 3 asks for idempotency "at both provider-event and business-order levels". They are
different questions and get different mechanisms.

**Provider-event level** — `UNIQUE (provider, event_id)`. A retry of the same delivery cannot create a
second ledger row, so `record_commerce_event` detects the existing row and returns *its* recorded
outcome. Two deliveries of one event therefore produce one row and two identical answers, which is
what a provider's retry policy needs from us.

**Business-order level** — the state machine below. Even a *distinct*, genuinely-new event cannot move
a state twice, because every edge is guarded by the row's current state.

| Event kind | Order `open` | Order `payment_pending` | Order `captured` | Order `cancelled`/`expired` |
| --- | --- | --- | --- | --- |
| `payment_initiated` | attempt created, order → `payment_pending` | new or same attempt; recorded, no state change | **stale** — initiation cannot follow capture | refused for a closed order; held |
| `payment_captured` | accepted (capture does not require a prior initiation — §4.1) | attempt → `confirmed`, order → `captured`, entitlement granted | `duplicate capture evidence`, effect `ignored_already_captured` | **held for reconciliation** — a closed order with captured money is the most dangerous row in the system |
| `payment_failed` | recorded, no order change | attempt `initiated`→`failed`; order stays `payment_pending` (a later attempt may succeed) | **held** — a failure after capture is contradiction, not news | recorded only |
| `order_paid` | as `payment_captured`, but must name a provider payment ref | as `payment_captured` | `ignored_duplicate_capture_evidence` | held |
| `order_cancelled` | order → `cancelled` | order → `cancelled` | **held** | recorded, no change |
| `refund_succeeded` / `refund_failed` | recorded only | recorded only | refund row; entitlement follows `refund_revocation_mode` | recorded only |
| `chargeback_opened` | recorded only | recorded only | refund-kind row, `hold_for_review` regardless of policy | recorded only |
| `other` | recorded, never applied | | | |

### 4.1 Why a capture is honoured even if its initiation never arrived

The tempting rule — "no capture without a prior initiation" — makes our entitlement state depend on a
provider's delivery order, which is a property of their retries and our network, not of the money.
Razorpay signs the raw body and gives an event id (`x-razorpay-event-id`) but publishes no delivery
ordering guarantee; Cashfree's `x-webhook-timestamp` is a signature input, not a sequence number. So:
an out-of-order capture is **applied on its own evidence** (its amount, currency, order reference and
signature all check out), and the missing initiation is written as a reconciliation finding
`initiation_never_delivered`. The ledger keeps the truth about what arrived; the reconciler reports
what did not.

What is *not* done is letting `occurred_at` re-order history: an event older than the last applied
event for the same attempt is recorded as `stale` and changes nothing.

### 4.2 Refusals that are not state transitions

Checked before the table above, in this order, each producing a ledger row and no state change:

1. `signature_valid = false` → `rejected_signature`. Not applied, not retried, and **not** written to
   any other table. Verification happens over the unaltered body (§6); a body that fails is
   untrusted input and gets the treatment untrusted input gets.
2. `environment = 'live'` while `live_capture_enabled = false` → `held_for_reconciliation`. This is
   the hard stop that makes "no live payments" a database fact: even if somebody wires a live webhook
   endpoint tomorrow, nothing in the ledger can grant while that row says false, and flipping it is a
   trusted-role `UPDATE` that `private.reject_client_write` will refuse every browser.
3. `merchant_reference` unknown → `held_for_reconciliation` (`unknown_order`). Not an error to the
   provider — we answer 2xx and keep the evidence, because refusing loudly is how a provider stops
   retrying a delivery we might legitimately learn to accept later.
4. `amount_minor`/`currency` different from the order's frozen pair → `held_for_reconciliation`
   (`amount_mismatch`). **The order's price never moves to match a webhook.** This is ADR 0005 rule 3
   read literally: the browser may not determine a price, and neither may anyone else's message.
5. provider named by the event differs from the provider that owns the attempt → `held`
   (`provider_mismatch`), so a Razorpay event cannot confirm a Cashfree payment.
6. the event's wedding is reached only through the order. Nothing in the interface takes a wedding id
   from the delivery, so a cross-wedding attack has to guess a `merchant_reference` and then still
   pass signature and amount.

## 5. Who writes, and how a browser is excluded

Three postures, and the choice is made per function, readable from the catalogue:

- **Service-only bodies, `SECURITY INVOKER`, zero `EXECUTE` grants** —
  `internal_api.create_commerce_order`, `internal_api.record_commerce_event`,
  `internal_api.revoke_commerce_entitlement`, `internal_api.commerce_reconcile`. This is the Stage 5
  maintenance-body precedent: reachability is a property of the role, not of a token. They take an
  explicit `p_actor_user_id` because the trusted path has no JWT to read, and each one **re-derives**
  ownership from `public.weddings` instead of believing the actor it was handed. The accepted
  consequence, stated rather than buried: a leaked service credential can act for any host, which is
  exactly why ADR 0005 rule 2 says the distinction must be the role *and* why the real server
  component must authenticate the actor before it calls.
- **Browser-readable projection, `SECURITY DEFINER SET search_path = ''`, granted to
  `authenticated` only** — `internal_api.commerce_host_summary(uuid)`, wrapped by a one-line
  `api.commerce_host_summary(uuid)` `SECURITY INVOKER` wrapper, the shape `C26d` asserts and the shape
  `internal_api.list_invitation_outputs`/`api.list_invitation_outputs`
  (`20261013120000_stage9_render_outputs.sql:555-631`) already use. It re-derives the owner from
  `auth.uid()` and raises `insufficient_privilege` for anyone else.
- **The gate, not a function** — see §8.

No commerce function is granted to `anon`. The anonymous surface stays exactly the doors Stages 3, 7
and 8 opened, which is the claim `40_catalog.sql`'s C28a measures by name, and `internal_api` is not
in `config.toml`'s `schemas` list, so no HTTP request can name it regardless of any grant.

## 6. The webhook verification interface

Verification happens **outside** Postgres, over the raw bytes, because PostgREST parses a JSON body
into function arguments and a re-serialised JSON document is not the byte string that was signed.
Putting HMAC in SQL would mean verifying a string the provider never sent. The interface therefore
lives in a pure module — `scripts/stage10-webhook-core.mjs`, no I/O, no env, no fetch, the same shape
as `scripts/stage9-publish-core.mjs` — with one adapter per provider, and the database receives only
the facts a successful verification produced.

Contract, provider-neutral, as shipped in `scripts/stage10-webhook-core.mjs` and pinned case by case in
`scripts/stage10-webhook-core.test.mjs` (WH-00..WH-42):

```
verifyRazorpayWebhook({ rawBody, headers, secret, environment, now?, timestampToleranceMs? })
verifyCashfreeWebhook({ rawBody, headers, secret, environment, now?, timestampToleranceMs? })
verifyProviderWebhook({ provider, ...same })                  -> the one entry point a caller uses
minorUnitsFromDecimal(value, { source?: 'decimal' | 'minor' }) -> { ok, amountMinor } | { ok:false, reason }
sha256Hex(bytes)                                              -> lowercase hex

success -> { ok:true, provider, eventId, eventType, kind, occurredAt, environment,
             rawBodySha256, signedStringShape, facts?{ merchantReference, providerOrderRef,
             providerPaymentRef, amountMinor, currency, providerStatus } }
refusal -> { ok:false, reason }
```

- `rawBody` is the exact bytes, accepted as a Buffer or a UTF-8 string. The adapter is never handed a
  parsed object: Razorpay's own instruction is "Do not parse or cast the webhook request body".
- Digest comparison is constant-time (`node:crypto.timingSafeEqual`), preceded by a shape check, and
  never throws — a wrong-length header is a refusal, not a crash.
- `environment` is an **input the caller declares**, one of `synthetic | sandbox | test | live`, and an
  undeclared or invented value is refused before any crypto runs. It is not defaulted, because it is the
  fact that later gates `live_capture_enabled`, and a request body must not be able to influence it.
- `timestampToleranceMs` is applied only where the provider puts a timestamp inside the signed input
  (Cashfree); passing one to the Razorpay adapter changes nothing, and a fixture proves it is inert
  rather than silently trusting an unsigned header. `null` opts out explicitly.
- **Nothing in the verifier grants anything.** It answers "who signed this and what does it say", and
  `record_commerce_event` decides. A valid signature is not authorisation; it is provenance.

The refusal vocabulary is closed, so a caller can branch on it without guessing:
`unknown_provider`, `secret_missing`, `environment_undeclared`, `missing_signature`, `signature_shape`,
`signature_mismatch`, `missing_timestamp`, `timestamp_shape`, `timestamp_stale`, `missing_event_id`,
`event_id_mismatch`, `missing_event_shape`, `missing_payment_identity`, `unresolved_order_reference`,
`unsupported_currency`, `payment_status_unrecognised`, `amount_unrepresentable`, `amount_not_positive`,
`amount_out_of_range`.

Two rules decided during implementation, because the byte-shape reality forced them:

- **An unrecognised provider event is recorded, not refused.** Its kind is `other` and it carries no
  facts. A provider adding an event type must not be able to make this build act on something it has not
  read, and must not be able to make a delivery *disappear* by naming it newly — the ledger still sees it.
- **Only a kind that could grant an entitlement must be attributable.** A payment `initiated`, `captured`
  or `failed` delivery that names no order reference is refused, because the amount comparison that
  authorises an entitlement would have no subject. A refund or chargeback delivery is recorded with
  whatever it names: refusing one for the shape of a payment webhook would discard exactly the evidence
  §9's hold-for-review and the reconciliation findings are built to read.

The two adapters, as read from public documentation on 2026-10-17:

| | Razorpay | Cashfree |
| --- | --- | --- |
| signature header | `x-razorpay-signature` | `x-webhook-signature` |
| timestamp header | — | `x-webhook-timestamp` |
| signed string | the raw body, exactly | `"<timestamp>.<raw body>"` |
| algorithm / encoding | HMAC-SHA256, **hex** | HMAC-SHA256, **base64** |
| key | the per-endpoint webhook secret | the PG secret key |
| duplicate identity | `x-razorpay-event-id` header and `event_id` in the payload | `notification_id` in the payload |

Two things follow from that table and both are tested rather than assumed. First, hex and base64 are
different encodings of the same digest, so an adapter that compares against the wrong encoding fails
closed — a fixture proves it. Second, the mismatch between a header event id and a payload event id is
itself a rejection case (`event_id_mismatch`), because Razorpay's replay protection depends on the
header while the ledger's unique key is one column.

**The browser callback is not a path.** Razorpay's standard checkout hands the page an
`HMAC-SHA256("<order_id>|<payment_id>", key_secret)` and its integration steps warn against using the
`razorpay_order_id` the browser returns as your own order identity; Cashfree's return path has a
similarly page-visible scheme. Both are therefore treated as *claims*, and the interface has no
function that accepts a signature from a browser. The qualification tier includes a **forged callback
with a mathematically valid signature**, computed from a test secret, and the assertion is that it
changes nothing — because nothing can receive it.

Provider selection itself is **not made here**. The `CHECK (provider IN ('razorpay','cashfree'))` list
exists so an unknown provider cannot be written at all — the safe failure of a closed list — and
adding a third is one forward migration plus its adapter. Per kickoff §2, the decision is taken on
onboarding, settled cost after tax, refund/dispute controls and webhook quality, never on a headline
promotional rate.

## 7. Price authority: the refusal is the shipped behaviour

`private.commerce_packages` is created **empty**. The ₹999 / ₹2,499 / ₹4,999 / ₹9,999+ ladder in
`docs/product/commercial-model.md` is not copied into a migration, because "TARGET / SUBJECT TO PILOT
VALIDATION" figures in seeded data would become the price by the force of being present, and the
kickoff forbids exactly that. The consequences are the point:

- `create_commerce_order` finds no `status = 'active'` row and raises
  `no approved price exists for package <code>`. **Every quote refuses.** The product is not gated on
  money because there is no money to gate on yet.
- `commerce_host_summary` reports `price_display_enabled = false` and omits `amount_minor` entirely —
  the field is not in the projection, so a stale UI cannot print it, and a future copy change cannot
  surface it by accident.
- The batteries create a synthetic package row (unmistakable code, e.g. `s10-synthetic-vivaah`,
  `environment='synthetic'` fixtures) inside the transaction they roll back or the fixture wedding
  they clean up, the way Stage 4/5 used a test-only pack fixture rather than a shipped one. Every
  transition in §4 is then genuinely exercised — and a named assertion checks that a production
  migration never inserted an active price.

That is how the foundation can be finished, reviewed and load-bearing before the owner decides
anything about price, GST or refund policy.

## 8. The publish gate is a trigger, not a button

Kickoff §3 step 5 and the V1 journey put "payment where required" immediately before "publish". The
existing publisher is `internal_api.publish_invitation_version`
(`20260926150000_stage3_privileged_bodies_behind_wrappers.sql:199`, replaced in
`20261009120000_stage8_guest_invitations_rsvp.sql:957`), and Stage 10 does **not** edit it. Two
reasons, both about blast radius: a `CREATE OR REPLACE` that re-types a body is where a gate quietly
loses a check, and a gate inside one RPC gates only that RPC.

Instead, a `BEFORE INSERT ... FOR EACH ROW EXECUTE` and a matching `BEFORE UPDATE` trigger on
`public.publications`, firing only for a row that is or becomes `live`, read
`private.commerce_policy`:

- `publish_gate = 'permissive'` (the shipped default) → no behaviour change. The four free capabilities
  in `v1-scope.md` — sign up, draft, preview, and a guest reading the invitation — keep working, and
  the 367 HTTP cases and every historical SQL chain that publishes stay green without being weakened.
- `publish_gate = 'entitlement_required'` → publication demands an `active` row in
  `public.entitlements` for that wedding whose `package_code` is in
  `publish_required_package_codes`. With the default empty set, **nothing can publish** — an owner
  turning the gate on without naming a package is refused rather than silently sold nothing.
- The trigger never reads a client argument for its decision; it re-derives from the row's own
  `wedding_id`, which is why a stale tab and a racing webhook land on the same answer.

Both modes are exercised in SQL, in a transaction that sets the policy and rolls it back. "Hiding a
button is not a gate" (ADR 0005 rule 6) is discharged by a case that inserts a publication row
directly as a trusted role under `entitlement_required` and is refused by the database.

## 9. Refunds, revocations, and the decision Stage 10 will not make for the owner

`commercial-model.md` open question 5 asks what refund behaviour is fair when a wedding is called off,
and answers that it "should be designed before money is taken, not during a dispute". ADR 0005 rule 7
says refunds *reduce* entitlement. Those two together produce a genuine tension: the code can be
finished now, the policy cannot.

`refund_revocation_mode` is where that gap is recorded instead of papered over:

- `hold_for_review` (the default) — a verified `refund_succeeded` inserts the refund record, writes
  `private.audit_events`, and leaves the entitlement alone while the host state becomes
  `refunded_pending_review`. Nothing is silently taken away from a family whose wedding is cancelled,
  and nothing is silently kept when it should not be.
- `revoke` — the same delivery also calls the revocation step, which sets `status='revoked'` and
  `revoked_at` on the live entitlement through the trusted path, and a later regrant becomes a **new
  row** (the Stage 2 partial unique index already requires that).

A `chargeback_opened` is recorded and always `hold_for_review`, whatever the policy says, because a
dispute decided by an automated revocation is a family locked out of their own wedding on an
unadjudicated claim.

Revocation is a server-authoritative function, not a DELETE. No path in Stage 10 deletes an
entitlement, a ledger row or an order.

## 10. Reconciliation and failure recovery

Recovery is not a retry loop; it is a comparison, because the dangerous states in billing are the ones
where two true facts disagree. `internal_api.commerce_reconcile(order_id)` — read-only, service-only —
returns findings, each with a named code:

| Finding | Means | Recovery |
| --- | --- | --- |
| `initiation_never_delivered` | a capture exists with no initiation | evidence-only; no state change |
| `held_event_unapplied` | a ledger row sits in `held_for_reconciliation` past a grace window | the operator corrects the *facts* or the price row, then the delivery is re-recorded as a new event id; nothing is edited retroactively |
| `captured_without_entitlement` | order is `captured`, no active entitlement | the grant step is re-invoked; it is idempotent by the partial unique index, so recovery cannot double-grant |
| `entitlement_after_refund` | refund succeeded, entitlement still live under `revoke` mode | revocation invoked; recorded either way |
| `amount_drift` | an applied capture's amount differs from the order's | the order is never re-priced; escalated, and the fact is that the row pair exists |
| `stale_open_order` | order `open`/`payment_pending` past `quote_expires_at` | `expire_commerce_order` closes it; a late capture on an expired order is `held`, not applied |

A trusted instrument runs reconciliation as a sweep and writes a summary `audit_events` row per order
it touched. Provider API outage is represented honestly: the provider keeps retrying, we keep
recording, the order waits, and `held_event_unapplied` is the finding that tells a human. Nothing in
Stage 10 pretends to have recovered an event we never received.

## 11. Retention, erasure and privacy of money rows

- Money rows reference `auth.users` with `ON DELETE SET NULL` and `public.weddings` with NO ACTION. An
  account erasure therefore **cannot** cascade away what was charged, and cannot succeed by quietly
  deleting a wedding that carries a purchase. The delete fails, which is the designed behaviour, and
  it is tested rather than asserted: a cascade runs as the child table's owner, so
  `reject_client_delete` would not have caught it — the mechanics Stage 2 measured and wrote down at
  `20260925120000_stage2_privilege_baseline.sql:156-168`.
- No provider payload is stored, only its digest. No card, UPI, VPA, customer name, email or phone
  number is stored by any Stage 10 table. `raw_body_sha256` is a hash of bytes we deliberately did not
  keep.
- The ledger's absolute no-UPDATE trigger means a correction is a new row plus an audit event, never a
  rewrite.
- Amounts are not personal data, but a payment history attached to a named wedding is close enough
  that no browser-reachable projection returns one. `commerce_host_summary` gives the *state* of a
  purchase to its own owner and, while `display_approved` is false, not even the amount.
- Erasure of finance history is a written retention decision the owner owes (kickoff §6), not a
  feature Stage 10 ships. The tables make it possible without accidental collateral: nothing cascades.

## 12. What Stage 10 refuses to build, and why each refusal is testable

| Refused | Why | The assertion that keeps it refused |
| --- | --- | --- |
| an HTTP webhook endpoint | no live provider configuration is authorised, and `[edge_runtime] enabled = false` in `supabase/config.toml:60-61` means this stack has no server to host one | no route, no handler, and the ledger's only writer is unreachable over REST (HTTP tier names the schema and the function and shows the refusal) |
| provider credentials anywhere | kickoff §3 step 4 | secret scan of the tracked set: no `*_SECRET` identifier and no provider-shaped key. The unit battery's two fixture keys are named `*_TEST_KEY` and valued as self-describing synthetic strings that sign nothing outside that file; `product:check`'s service-key rule keeps them out of any bundle |
| an active price | §7 | catalogue is empty of `status='active'` rows after migrations, asserted in SQL |
| a checkout UI | prices are not approved; a spinner that cannot produce a real order is the Stage 0 defect class this repository already removed | `product:check` rule set; the host panel renders a *state*, never a "Pay now" affordance |
| tax/invoice modelling | accounting input is outstanding | no `tax*`, `gst*`, `invoice*` column exists anywhere in the new DDL |
| subscription or per-guest charging | `commercial-model.md` rejects per-guest fees, and `estimated_guest_count` is never a billable quantity | no quantity column in `commerce_packages`/`commerce_orders`; a test proves a quote for the same wedding+package is one order regardless of guest count |
| charging a guest | `v1-scope.md` — guests never pay to be seen | guest, RSVP and household paths gain no commerce dependency; historical guest tiers must stay green |
| deleting finance history | §11 | cascade attempts fail; no DELETE path is granted to any product role |
| touching `main`, deploying, hosted Supabase, Stage 11 | the work order | push read-back of `stage10/commerce-entitlements` only |

## 13. Threat model → control → test

Case ids are the ones the SQL (`supabase/tests/stage10/*`), unit (`scripts/*.test.mjs`) and HTTP
(`supabase/tests/api/stage10_commerce.test.mjs`) tiers print.

| Threat | Control | Cases |
| --- | --- | --- |
| Client `INSERT`/`UPDATE` sets its own paid state | `private` unreachable over REST, no client grants, no RLS policy, `reject_client_write`/`reject_client_delete` | RB-01..05 (anon, owner A, owner B, `service_role`-as-browser, direct `entitlements` write) |
| Browser supplies a price | no amount/currency parameter exists on the order-creating function | QU-02, QU-03 |
| Unapproved price surfaced | catalogue has no active row; DTO omits amount when `display_approved` is false | PR-01..04 |
| Forged webhook signature | verify over raw bytes, constant-time compare, `rejected_signature` records and applies nothing | WH-01..WH-03, WH-20..WH-23, EV-01 |
| Tampered body around a valid signature | same, plus digest recorded | WH-03, WH-04, WH-23 |
| One provider's digest presented to the other's scheme | each header checked for the encoding its own scheme requires, before comparison | WH-05, WH-21, WH-22 |
| Wrong/absent timestamp on a timestamped scheme | Cashfree's signed string includes the timestamp, so a window is enforceable; Razorpay's does not, so the knob is inert there | WH-23, WH-24, WH-25 |
| Body parsed before verifying, so a proxy's re-serialisation passes | signature first, JSON second | WH-04, WH-06 |
| Amount rounded, truncated or too wide for the column | string arithmetic, no rounding, safe-integer ceiling | WH-30..WH-33 |
| Replayed event | `UNIQUE (provider, event_id)`; second delivery returns the first answer | EV-02, EV-03 |
| Out-of-order delivery | capture applied on its own evidence; missing initiation becomes a finding | EV-04, RC-01 |
| Late event after a newer one | `stale`, no state change | EV-05 |
| Wrong amount / wrong currency | `held_for_reconciliation`, order never re-priced | EV-06, EV-07, RC-05 |
| Wrong environment (live events while live is off) | `live_capture_enabled` default false | EV-08 |
| Cross-wedding attack | wedding reached through the order; ownership re-derived on every read and write | CO-03, HD-02, RB-03 |
| Merchant-reference guessing / substitution | unique server-minted reference, signature over the body that names it | QU-04, EV-09 |
| Browser callback forgery, even with a valid signature | no function accepts a browser-supplied signature | WH-12, WH-41, CB-01, CB-02 |
| A secret echoed back through a refusal or a log line | every branch returns a reason name, and each branch is scanned for the secret it was given | WH-01, WH-02, WH-42 |
| Double-clicked / parallel checkout | partial unique live order per wedding+package | QU-05, QU-06 |
| Duplicate capture (two events, one truth) | state machine refuses a second grant; `captured` is terminal for granting | EN-02, EN-03 |
| Refunded order / chargeback | refund row, `hold_for_review` default, revocation only through the trusted path | RF-01..05 |
| Publish without paying | `publications` trigger under `entitlement_required` | PG-01..04 |
| Stale tab publishes after a race | the gate is at the row, so the last writer is checked, not the last clicker | PG-03 |
| Accidental cascade deletion of money history | NO ACTION to weddings, SET NULL to users | DL-01, DL-02 |
| Ledger rewritten after the fact | absolute no-UPDATE trigger | EV-10 |
| Provider outage / drift | held rows + reconciliation sweep | RC-02, RC-03 |
| A new migration quietly exposes a money table | `40_catalog.sql` inventories under `st2_at_least('stage10')`, `check-db-contract.mjs` `NON_CLIENT_SCHEMAS`, `product:check` service-key rule | CD-01..03 |

## 14. Tiers, and what each is allowed to claim

1. **Unit (engine-independent)** — the verifier core and adapters, the order/quote decision rules, the
   DTO projection, the state-machine edge table as data. Runs with no database, so it works under the
   disk constraint the host is currently in.
2. **SQL battery** — `supabase/tests/stage10/80_commerce_ledger.sql`, `90_commerce_functions.sql`,
   driven by `supabase/tests/stage10/run.sh` with `commerce|guest|family|historic|all`, in a throwaway
   database built from the migration chain, and `40_catalog.sql` widened behind the head gate.
3. **HTTP battery** — `supabase/tests/api/stage10_commerce.test.mjs` against the live
   `localvivaahvarnam` stack through Kong/PostgREST: what a browser can and cannot reach, plus the
   host DTO. `api/run.sh`'s `leak_census` (`:105-123`) gains the new stores so residue is measured, not
   assumed.
4. **Browser tier** — the host panel's states, and proof that guest and RSVP routes gained no payment
   dependency. Requires headroom; if it cannot run, it is reported as unrun.
5. **Regressions** — every historical chain and suite. A foundation that weakens Stage 3's publication
   or Stage 8's guest privacy is not a foundation.
6. **Sandbox tier** — **not run.** No credentials, no provider contact.

**Measured versus pending, as of this writing.** Tier 1 has been run: the verifier core's 32 WH cases
pass on Node alone, with no engine, no network and no provider, and the whole unit suite is green at
1279 tests across 59 files. Tiers 2, 3, 4 and 5 have **not** been run against the Stage 10 schema,
because the migration that creates it is written next and an engine is not currently available to this
host; the EV, QU, ST, EN, RF, PG, HD, RC, RB, CB, DL and CD cases named above are therefore promises
the rest of this stage has to discharge, not results. Reading any of them as a pass would be exactly
the claim class Stage 0 was written to remove.

## 15. Open decisions that are genuinely the owner's

Stage 10 proceeds without each of these; none of them blocks the ledger, the guards or the tests.

1. **Provider** — Razorpay or Cashfree, chosen on verified onboarding, settled cost after GST,
   refund/dispute controls and webhook quality. What is blocked without it: nothing in this document.
   What is genuinely blocked: a live adapter's credentials and the sandbox tier.
2. **Prices, GST treatment and invoicing** — which ladder rungs become `active`, inclusive or
   exclusive, who issues the invoice. Blocked without it: any quote succeeding at all, which is the
   designed default.
3. **Refund/chargeback policy** — `hold_for_review` or `revoke`. Blocked: the honest host copy for a
   refunded wedding, and the support script.
4. **Whether payment gates publishing, and for which packages** — `publish_gate`. Blocked: turning the
   gate on; the mechanism and both modes' tests do not need the answer.
5. **The server component that receives webhooks** — hosting and its availability commitment
   (`edge_runtime` is off locally; kickoff §6 lists server availability as open).
6. **Merchant/KYC identity** — which legal entity takes the money. Blocks everything that moves real
   funds; blocks nothing here.

Reporting any one of these as decided would be the kind of claim Stage 0 was written to remove from
this repository.
