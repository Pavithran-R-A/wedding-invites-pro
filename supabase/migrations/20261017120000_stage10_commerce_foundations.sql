-- Stage 10 / file 1 of 1 — commerce foundations: one server-authoritative ledger, no price, no provider.
--
-- Written against `docs/architecture/commerce-foundations.md` §§2–5 and 7–9 and ADR 0005; the section
-- numbers in the comments below refer to that document, which is the reviewable statement of *why* each
-- object is shaped this way. Nothing in this file sets a price, names a provider as chosen, enables a
-- live capture, or gates publishing on by default.
--
-- What this migration does NOT do, and each of those is a decision rather than an omission:
--   * it does not insert a row into `private.commerce_packages` (§7 — the catalogue is created empty,
--     so every quote refuses, which is the shipped behaviour until the owner decides about price);
--   * it does not edit `internal_api.publish_invitation_version` (§8 — the gate is a trigger on the
--     row, so it gates every writer including ones this stage has not thought of yet);
--   * it does not add a column to `public.entitlements` or `public.weddings` (§2 — the order points at
--     the entitlement, not the other way round, and generated client types gain no money field);
--   * it creates no HTTP surface for a webhook (§12 — `[edge_runtime] enabled = false` in
--     `supabase/config.toml:60-61` means this stack has no server that could host one, and the ledger's
--     only writers are unreachable over REST as a property of `config.toml:32`);
--   * it stores no provider payload and no card, UPI, VPA, name, email or phone (§11).

-- ===========================================================================
-- 1. The absolute append-only refusal
-- ===========================================================================

-- `private.reject_client_write()` distinguishes roles; this one does not. The payment ledger is
-- evidence about what a provider told us, and evidence that the highest-privileged writer may rewrite
-- answers nothing: a replay, a forged body and an out-of-order pair all stop being answerable the moment
-- the row that describes them is editable. So the refusal is raised for every role, `postgres` and
-- `supabase_admin` included, and a correction is a new row plus an audit event (§11).
CREATE FUNCTION private.reject_any_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '%.% rows are append-only: a correction is a new row and an audit event, never a rewrite',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION private.reject_any_update() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.reject_any_update() IS
  'BEFORE UPDATE guard with no trusted branch: refuses every role, including the owner. Attached to the '
  'payment ledger only.';

-- ===========================================================================
-- 2. The price catalogue — created empty, on purpose
-- ===========================================================================

CREATE TABLE private.commerce_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_code text NOT NULL CHECK (length(btrim(package_code)) > 0),
  -- A CHECK list, not an enum (§3): widening the currency set is one forward migration and cannot
  -- become a shared type that other columns silently inherit.
  currency text NOT NULL CHECK (currency IN ('INR')),
  -- Minor units, provider-neutral: for INR the unit is the paise. A numeric rupee amount would put a
  -- rounding rule in the schema, and rounding is how a customer's price and a provider's charge part.
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  price_version integer NOT NULL CHECK (price_version >= 1),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'retired')),
  -- *Quotable* and *showable* are different decisions (§3). A price may be sellable while its copy,
  -- GST treatment or invoice wording is still uncleared, and the host projection reads this column
  -- rather than guessing.
  display_approved boolean NOT NULL DEFAULT false,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Every cross-column invariant below gets an explicit name, in all six tables. Unnamed table-level
  -- CHECKs land as `<table>_check`, `<table>_check1`, `<table>_check2` in declaration order, so an
  -- operator reading `new row … violates check constraint "commerce_orders_check2"` learns nothing about
  -- which money rule refused them — and inserting one CHECK earlier silently renames the ones after it,
  -- which would break any runbook or assertion keyed to the name. A `…_pair_check` is a status and its
  -- timestamp, agreeing in both directions.
  CONSTRAINT commerce_packages_retired_pair_check
    CHECK ((status = 'retired') = (retired_at IS NOT NULL)),
  UNIQUE (package_code, price_version)
);

-- At most one quotable price per package, forever. This is what makes "which price did this order get?"
-- answerable after the fact, and it is a partial unique rather than a status CHECK because a retired
-- row must survive alongside its replacement.
CREATE UNIQUE INDEX commerce_packages_one_active_per_code
  ON private.commerce_packages (package_code) WHERE status = 'active';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON private.commerce_packages
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER commerce_packages_no_client_write BEFORE INSERT OR UPDATE ON private.commerce_packages
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER commerce_packages_no_client_delete BEFORE DELETE ON private.commerce_packages
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

ALTER TABLE private.commerce_packages ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE private.commerce_packages IS
  'Versioned prices. Created EMPTY by this migration and asserted empty of active rows by the Stage 10 '
  'battery: until the owner approves a price, every quote refuses. No tax, GST or invoice column exists '
  'here because that accounting input is outstanding (§12).';

-- ===========================================================================
-- 3. The purchase order — the quote and the order as one frozen row
-- ===========================================================================

-- A separate quote object is the defect (§2): a quote that can be re-priced or swapped is exactly how
-- "the price the customer saw" diverges from "the amount that was charged". One row, frozen at creation,
-- carrying its own expiry.
CREATE TABLE private.commerce_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No ON DELETE clause: NO ACTION (§3, §11). Money does not vanish when a family leaves, and an
  -- account erasure must not be able to succeed by quietly deleting a wedding that carries a purchase.
  wedding_id uuid NOT NULL REFERENCES public.weddings(id),
  -- Copied from the wedding by the writer, never supplied (§3). SET NULL on erasure: deleting a user
  -- removes an account, not the evidence that the account was charged.
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The only order identifier that ever leaves this database, and the only thing a webhook may name.
  -- Server-minted, unique, not derived from `id`: guessing it is 122 bits of work, and it is not a
  -- second way to address the row.
  merchant_reference text NOT NULL UNIQUE CHECK (length(btrim(merchant_reference)) > 0),
  package_code text NOT NULL CHECK (length(btrim(package_code)) > 0),
  price_version integer NOT NULL CHECK (price_version >= 1),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency IN ('INR')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'payment_pending', 'captured', 'cancelled', 'expired')),
  -- A quote outlives nothing forever; §10's `stale_open_order` finding reads this column.
  quote_expires_at timestamptz NOT NULL,
  captured_at timestamptz,
  closed_at timestamptz,
  -- Set only by the activation step. A foreign key rather than a free code: the right this purchase
  -- bought must exist, and must not be deletable out from under the row that paid for it.
  entitlement_id uuid REFERENCES public.entitlements(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_orders_capture_pair_check
    CHECK ((status = 'captured') = (captured_at IS NOT NULL)),
  CONSTRAINT commerce_orders_closure_pair_check
    CHECK ((status IN ('cancelled', 'expired')) = (closed_at IS NOT NULL)),
  -- No right without money, and no right hanging off a row that is not the captured one. Refund does
  -- not move this status (§2): a refunded order stays captured, and the refund is its own row.
  CONSTRAINT commerce_orders_entitlement_needs_capture_check
    CHECK (entitlement_id IS NULL OR (status = 'captured' AND captured_at IS NOT NULL))
);

-- The double-clicked-checkout and parallel-initiation refusal, enforced where a race can actually hit
-- (§3). Two live orders for one wedding and one package is the state that lets a customer be charged
-- twice, so the database, not a client-side "disable the button", owns it.
CREATE UNIQUE INDEX commerce_orders_one_live_per_wedding_package
  ON private.commerce_orders (wedding_id, package_code)
  WHERE status IN ('open', 'payment_pending');

CREATE INDEX commerce_orders_wedding_idx ON private.commerce_orders (wedding_id, created_at DESC);

-- Immutability is asserted, not advised (§3). Design names the price four; identity and subject are
-- frozen alongside them, because a mutable `wedding_id` is a cross-wedding attack that the row itself
-- would permit, and a mutable `merchant_reference` breaks the only identifier a delivery can be
-- matched on. This trigger fires for trusted roles too — unlike `reject_client_write`, it is about
-- what changed, not who asked.
CREATE FUNCTION private.guard_commerce_order_freeze() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.wedding_id           <> OLD.wedding_id
     OR NEW.owner_user_id     IS DISTINCT FROM OLD.owner_user_id
     OR NEW.merchant_reference <> OLD.merchant_reference
     OR NEW.package_code      <> OLD.package_code
     OR NEW.price_version     <> OLD.price_version
     OR NEW.amount_minor      <> OLD.amount_minor
     OR NEW.currency          <> OLD.currency
     OR NEW.created_at        <> OLD.created_at THEN
    RAISE EXCEPTION
      'order % is a frozen quote: wedding, owner, reference, package, price version, amount and currency '
      'may never change. A different price is a different order.',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_commerce_order_freeze()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER commerce_orders_freeze BEFORE UPDATE ON private.commerce_orders
  FOR EACH ROW EXECUTE FUNCTION private.guard_commerce_order_freeze();
CREATE TRIGGER commerce_orders_no_client_write BEFORE INSERT OR UPDATE ON private.commerce_orders
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER commerce_orders_no_client_delete BEFORE DELETE ON private.commerce_orders
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON private.commerce_orders
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

ALTER TABLE private.commerce_orders ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE private.commerce_orders IS
  'Server-calculated quotes and the purchase orders they became. No column here is writable by a browser '
  'role, and no browser role can name this table at all (`config.toml:32`). The price four are frozen by '
  'trigger; the status column is moved only by the state machine in `record_commerce_event`.';

-- ===========================================================================
-- 4. Payment attempts — initiation is not capture
-- ===========================================================================

-- Collapsing the two makes "the customer opened checkout" indistinguishable from "the money is ours"
-- (§2, kickoff §3 step 5). `failed_at` is the symmetric counterpart of the `confirmed_at` invariant §3
-- names; without it a failed attempt records that it failed and not when.
CREATE TABLE private.commerce_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES private.commerce_orders(id),
  -- A closed list (§6): an unknown provider cannot be written at all, which is the safe failure, and
  -- adding a third is one forward migration plus its adapter. It is not a decision about which
  -- provider this product will use.
  provider text NOT NULL CHECK (provider IN ('razorpay', 'cashfree')),
  -- The verifier's four-value vocabulary (`scripts/stage10-webhook-core.mjs`). §3 lists three; 'test'
  -- is included because a ledger row has to be able to record any environment a declared delivery may
  -- carry, and an undeclared environment is refused before crypto runs rather than filed under a
  -- nearest match.
  environment text NOT NULL CHECK (environment IN ('synthetic', 'sandbox', 'test', 'live')),
  provider_order_ref text CHECK (provider_order_ref IS NULL OR length(btrim(provider_order_ref)) > 0),
  provider_payment_ref text CHECK (provider_payment_ref IS NULL OR length(btrim(provider_payment_ref)) > 0),
  status text NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'confirmed', 'failed')),
  initiated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_attempts_confirmation_pair_check
    CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL)),
  CONSTRAINT commerce_attempts_failure_pair_check
    CHECK ((status = 'failed') = (failed_at IS NOT NULL)),
  CONSTRAINT commerce_attempts_not_both_outcomes_check
    CHECK (confirmed_at IS NULL OR failed_at IS NULL)
);

-- One provider payment object cannot be initiated twice inside our ledger (§3). Partial because both
-- references are legitimately absent before the provider names them.
CREATE UNIQUE INDEX commerce_attempts_payment_ref_uk
  ON private.commerce_payment_attempts (provider, provider_payment_ref)
  WHERE provider_payment_ref IS NOT NULL;
CREATE UNIQUE INDEX commerce_attempts_order_ref_uk
  ON private.commerce_payment_attempts (provider, provider_order_ref)
  WHERE provider_order_ref IS NOT NULL;

CREATE INDEX commerce_attempts_order_idx
  ON private.commerce_payment_attempts (order_id, initiated_at DESC);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON private.commerce_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER commerce_attempts_no_client_write
  BEFORE INSERT OR UPDATE ON private.commerce_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER commerce_attempts_no_client_delete
  BEFORE DELETE ON private.commerce_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

ALTER TABLE private.commerce_payment_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE private.commerce_payment_attempts IS
  'One provider payment object per row: opened, then confirmed or failed. Nothing in this table grants '
  'anything; a confirmed attempt is the evidence an order transition was decided from.';

-- ===========================================================================
-- 5. The event ledger — append-only evidence, never state
-- ===========================================================================

CREATE TABLE private.commerce_payment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('razorpay', 'cashfree')),
  -- The provider's own event identity, required and non-blank: a ledger row that cannot name which
  -- delivery it describes is undeliverable evidence (§3).
  event_id text NOT NULL CHECK (length(btrim(event_id)) > 0),
  -- What the provider called it, kept beside what this build understood it as. The two can diverge
  -- when a provider invents an event, and the pair is what makes that answerable afterwards. Nullable
  -- because a delivery whose body could not be parsed has no readable name, and filling it in from the
  -- kind would be a fabrication about a message we could not read.
  event_type text CHECK (event_type IS NULL OR length(btrim(event_type)) > 0),
  -- `verifyRazorpayWebhook`/`verifyCashfreeWebhook` produce this vocabulary and the verifier's own
  -- battery pins it (WH-11); the closed list means an event this build has not read cannot be applied.
  kind text NOT NULL CHECK (kind IN ('payment_initiated', 'payment_captured', 'payment_failed',
                                     'order_cancelled', 'refund_succeeded', 'refund_failed',
                                     'chargeback_opened', 'other')),
  -- Nullable and closed, in that order: an undeclared environment is held (§4.2's second rule) and the
  -- row that says so must record that nothing was declared, rather than pick the nearest safe value.
  environment text CHECK (environment IS NULL OR environment IN ('synthetic', 'sandbox', 'test', 'live')),
  -- Nullable, because a held delivery for a reference this product never issued still gets recorded
  -- (§4.2 rule 3). The link is resolved here rather than trusted from the delivery.
  order_id uuid REFERENCES private.commerce_orders(id) ON DELETE SET NULL,
  attempt_id uuid REFERENCES private.commerce_payment_attempts(id) ON DELETE SET NULL,
  merchant_reference text,
  -- These two columns record what a delivery *claimed*, not what this product sells, and the difference
  -- is load-bearing. §4.2 rule 4 holds a mismatched delivery precisely so the claim is kept, §9.6's
  -- `amount_drift` finding reads it back out of these columns, and a CHECK borrowed from the price list
  -- (`currency IN ('INR')`) would refuse the row instead — losing the evidence and turning a provider's
  -- wrong message into a 500 and a delivery the provider will retry forever. So neither column carries a
  -- vocabulary or shape CHECK: the only writer normalizes case and blanks (below) so §9.6's comparison
  -- stays sound, and an unusable claim is still a recorded claim. The `> 0` rule lives on the price row
  -- and the order row, where it can only ever refuse a number *we* are selling.
  amount_minor bigint,
  currency text,
  -- The raw body is NOT stored: it can carry card metadata, customer names and provider internals. A
  -- digest is enough to prove later that the bytes we acted on are the bytes that were signed (§3),
  -- and it is the same shape `private.access_tokens.token_hash` uses.
  raw_body_sha256 text NOT NULL CHECK (raw_body_sha256 ~ '^[0-9a-f]{64}$'),
  signature_valid boolean NOT NULL,
  -- The verifier's closed refusal vocabulary, kept verbatim when a delivery was refused.
  refusal_reason text CHECK (refusal_reason IS NULL OR length(btrim(refusal_reason)) > 0),
  -- Why a held row is held. Named by §4.2 (unknown_order, amount_mismatch, provider_mismatch,
  -- live_capture_disabled) and by §4's closed-order cells; it is not an effect, because nothing was
  -- applied, so it does not live in `applied_effect`.
  hold_reason text CHECK (hold_reason IS NULL OR length(btrim(hold_reason)) > 0),
  processing_status text NOT NULL
    CHECK (processing_status IN ('applied', 'duplicate', 'rejected_signature',
                                 'held_for_reconciliation', 'stale')),
  -- A free namespace, deliberately (§3): the effect is recorded so a replay's *answer* is reproducible,
  -- not merely its arrival. `applied` therefore always names what it did, including when what it did
  -- was nothing (`recorded_only`).
  applied_effect text CHECK (applied_effect IS NULL OR length(btrim(applied_effect)) > 0),
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- §4.2 rule 1 read as a schema invariant: an unverified delivery is refused, and a refused delivery
  -- is the only thing that carries that status.
  CONSTRAINT commerce_events_rejection_matches_signature_check
    CHECK ((processing_status = 'rejected_signature') = (signature_valid = false)),
  CONSTRAINT commerce_events_applied_needs_effect_check
    CHECK (processing_status <> 'applied' OR applied_effect IS NOT NULL),
  CONSTRAINT commerce_events_held_needs_reason_check
    CHECK (processing_status <> 'held_for_reconciliation' OR hold_reason IS NOT NULL),
  CONSTRAINT commerce_events_reason_needs_hold_check
    CHECK (processing_status = 'held_for_reconciliation' OR hold_reason IS NULL),
  -- §4.2 rule 6: the wedding is reached only through the order, so a row that names no order has no
  -- business naming an attempt.
  CONSTRAINT commerce_events_attempt_needs_order_check
    CHECK (attempt_id IS NULL OR order_id IS NOT NULL)
);

-- Provider-event idempotency (§4): a retry of one delivery cannot create a second row, so two deliveries
-- produce one row and two identical answers.
CREATE UNIQUE INDEX commerce_events_provider_event_uk
  ON private.commerce_payment_events (provider, event_id);

CREATE INDEX commerce_events_order_idx
  ON private.commerce_payment_events (order_id, received_at DESC);
-- The staleness rule (§4.1) asks "has anything newer been applied for this attempt?"; this is that
-- lookup, and the reconciler's grace-window sweep uses the same shape.
CREATE INDEX commerce_events_attempt_applied_idx
  ON private.commerce_payment_events (attempt_id, occurred_at DESC)
  WHERE processing_status = 'applied';
CREATE INDEX commerce_events_held_idx
  ON private.commerce_payment_events (received_at DESC)
  WHERE processing_status = 'held_for_reconciliation';

CREATE TRIGGER commerce_events_append_only_no_update
  BEFORE UPDATE ON private.commerce_payment_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_any_update();
CREATE TRIGGER commerce_events_no_client_write
  BEFORE INSERT OR UPDATE ON private.commerce_payment_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER commerce_events_no_client_delete
  BEFORE DELETE ON private.commerce_payment_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

ALTER TABLE private.commerce_payment_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE private.commerce_payment_events IS
  'The append-only ledger required by ADR 0005 rule 5: what arrived, whether it verified, what this '
  'build did about it. Refused deliveries are recorded too, which is the only reason a replay or a '
  'forgery is answerable afterwards. UPDATE is refused for every role. No provider payload is stored.';

-- ===========================================================================
-- 6. Refunds and chargebacks
-- ===========================================================================

-- A refund is money moving the other way against an order that remains captured (§2). Overloading
-- `orders.status` with 'refunded' would erase the difference between "we have the money" and "we kept
-- the money", which is the difference §9's whole policy question turns on.
CREATE TABLE private.commerce_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES private.commerce_orders(id),
  -- The ledger row that caused this record. Nullable by design (§3): a refund with no originating
  -- delivery is a manual intervention, and `private.audit_events` records who did it.
  event_id bigint REFERENCES private.commerce_payment_events(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('refund', 'chargeback')),
  status text NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'succeeded', 'failed', 'reversed')),
  -- Nullable (§6's second implementation rule): refund and chargeback deliveries are recorded with
  -- whatever they name, because refusing one for the shape of a payment webhook would discard the very
  -- evidence §9's hold-for-review is built to read.
  amount_minor bigint CHECK (amount_minor IS NULL OR amount_minor > 0),
  -- No vocabulary CHECK, for §5's reason: a refund delivery that names no amount reaches this row with
  -- the provider's currency verbatim, and a price-list CHECK here would discard the record of a refund
  -- rather than keep it. `amount_minor` keeps its `> 0` because the only writer that can supply a value
  -- has already been compared against the frozen positive quote by §4.2 rule 4 and cannot reach here
  -- disagreeing with it.
  currency text,
  provider_refund_ref text
    CHECK (provider_refund_ref IS NULL OR length(btrim(provider_refund_ref)) > 0),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_refunds_completion_pair_check
    CHECK ((status = 'succeeded') = (completed_at IS NOT NULL))
);

CREATE INDEX commerce_refunds_order_idx ON private.commerce_refunds (order_id, recorded_at DESC);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON private.commerce_refunds
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER commerce_refunds_no_client_write
  BEFORE INSERT OR UPDATE ON private.commerce_refunds
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER commerce_refunds_no_client_delete
  BEFORE DELETE ON private.commerce_refunds
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

ALTER TABLE private.commerce_refunds ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE private.commerce_refunds IS
  'Refund and chargeback records with their own identity and amount. A chargeback is a row of kind '
  '"chargeback", never a revoked entitlement: §9 keeps an unadjudicated dispute from locking a family '
  'out of their own wedding.';

-- ===========================================================================
-- 7. Policy: the three honest answers that are "not decided yet", as data
-- ===========================================================================

CREATE TABLE private.commerce_policy (
  -- The singleton trick (§3): "the current policy" cannot become two rows that disagree.
  id integer PRIMARY KEY CHECK (id = 1),
  publish_gate text NOT NULL DEFAULT 'permissive'
    CHECK (publish_gate IN ('permissive', 'entitlement_required')),
  -- Deliberately has no CHECK that it is non-empty. An owner who turns the gate on without naming a
  -- package must be met by a refusal at publish time (§8), not by a schema that will not hold the
  -- half-made decision they are still entitled to change.
  publish_required_package_codes text[] NOT NULL DEFAULT '{}'::text[],
  -- The hard stop that makes "no live payments" a database fact rather than a deployment note (§4.2).
  live_capture_enabled boolean NOT NULL DEFAULT false,
  refund_revocation_mode text NOT NULL DEFAULT 'hold_for_review'
    CHECK (refund_revocation_mode IN ('hold_for_review', 'revoke')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON private.commerce_policy
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER commerce_policy_no_client_write
  BEFORE INSERT OR UPDATE ON private.commerce_policy
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER commerce_policy_no_client_delete
  BEFORE DELETE ON private.commerce_policy
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

ALTER TABLE private.commerce_policy ENABLE ROW LEVEL SECURITY;

-- The one row the gate and the ledger read. Every value here is the shipped *safe* default: publishing
-- is not gated on money, live capture is off, and a refund revokes nothing without a human. This insert
-- is not a commercial decision — it is the opposite, the record that the decisions have not been made.
INSERT INTO private.commerce_policy (id) VALUES (1);

COMMENT ON TABLE private.commerce_policy IS
  'One row. Three of Stage 10''s honest answers are configuration the owner has not given yet (§2), so '
  'they are data with safe defaults rather than code with opinions. Changing any column is a trusted-role '
  'UPDATE that no browser can issue.';

-- ===========================================================================
-- 7b. The ledger's own ACL, written down instead of inherited
-- ===========================================================================

-- Every relation above was created by `postgres` inside the `private` schema and left with a NULL
-- `relacl`, which is the catalog's spelling of "no ACL has ever been written for this object". Stage 3's
-- G9b refuses that state for anything in `private`, and it is right to, even though the exposure it
-- guards against is not present on the qualification cluster — measured there, a NULL relacl gives
-- PUBLIC nothing (`has_table_privilege('public', 'private.commerce_payment_events', 'SELECT')` is
-- `false`, and `ALTER DEFAULT PRIVILEGES` in the bootstrap and in `20260925120000` is scoped to
-- `public`, not `private`). So nothing was reachable, and the repair is not a fix for a live hole.
--
-- The reason to write it anyway is that this migration's central claim is *negative* — no request-bearing
-- role may touch the money model — and a negative claim has no evidence while the ACL column is blank.
-- `REVOKE ALL … FROM PUBLIC` is what turns the absence of a grant into a row a reviewer can read and a
-- battery can assert, which is exactly the posture the two older `private` tables already have
-- (`access_tokens` and `audit_events`: their relacl lists `postgres` and, for the two the backend
-- writes, `service_role`). A cluster whose `private`
-- schema does carry default privileges — which is a hosting decision, not a schema one — would otherwise
-- mint these tables granted, and only an explicit statement here would survive that.
--
-- The grants deliberately go nowhere else. `service_role` gets no table privilege on any of these six,
-- because the six write bodies are `SECURITY INVOKER` (§9) and are reached by the owner role; Stage 2's
-- `40_catalog.sql` C15b asserts the grantlessness by name, and C15's service-role DML count of 22 is
-- expected to stay where it is for exactly this reason.

REVOKE ALL ON TABLE private.commerce_packages FROM PUBLIC;
REVOKE ALL ON TABLE private.commerce_orders FROM PUBLIC;
REVOKE ALL ON TABLE private.commerce_payment_attempts FROM PUBLIC;
REVOKE ALL ON TABLE private.commerce_payment_events FROM PUBLIC;
REVOKE ALL ON TABLE private.commerce_refunds FROM PUBLIC;
REVOKE ALL ON TABLE private.commerce_policy FROM PUBLIC;

-- The one identity sequence the ledger owns. USAGE on a sequence lets its holder mint a row's key
-- without any table privilege at all, so leaving this on defaults while revoking the table above it
-- would reopen the door through a narrower hinge.
REVOKE ALL ON SEQUENCE private.commerce_payment_events_id_seq FROM PUBLIC;

-- ===========================================================================
-- 8. The publish gate — a trigger on the row, not a button (§8)
-- ===========================================================================

-- Two choices in this function are load-bearing and both are here for a reason.
--
-- It is SECURITY DEFINER, unlike every other guard in `private`. The reason is narrow and measurable:
-- the decision needs `private.commerce_policy`, which §3 requires have no client grants at all, and a
-- SECURITY INVOKER trigger would therefore answer an `authenticated` publication INSERT with
-- `permission denied for table commerce_policy` — an error that looks like a misconfiguration and would
-- tempt somebody to "fix" it by granting a client role into the money schema. A definer that only *reads
-- configuration in order to refuse* widens nothing: it cannot let a caller do anything the caller could
-- not already do, and it is not a callable door (`private` has no USAGE for anon/authenticated, and
-- `internal_api` is not in `config.toml`'s schema list). It is owned by the same role that owns
-- `public.publications`, which is what PostgreSQL 16.8+/17.x requires of a SECURITY DEFINER trigger
-- function; the Stage 3 chain proves the trigger fires for an impersonated API role rather than raising.
--
-- A missing policy row is read as permissive. That is the one fail-open choice in this file and it is
-- deliberate: the DDL default is permissive, the gate cannot be *required* without a package list that
-- would also be gone, and turning a deleted row into a product-wide inability to publish would be a far
-- worse incident than a family publishing without paying. The row is protected by no client grants, no
-- RLS policy and `reject_client_delete`; §13's RB cases keep it that way.
CREATE FUNCTION private.guard_publication_commerce_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_policy private.commerce_policy;
  v_entitled boolean;
BEGIN
  -- Only a row that is or becomes the wedding's live publication needs a right to publish. Revocation
  -- is the opposite of selling nothing, so it must never be gated: status leaves 'active' here and the
  -- trigger stands aside. (`public.publications` spells its live state 'active' — the row-level status
  -- list is ('active','revoked'), from
  -- 20260925120200_stage2_versions_and_publication.sql:60-92.)
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_policy FROM private.commerce_policy WHERE id = 1;
  IF NOT FOUND OR v_policy.publish_gate = 'permissive' THEN
    RETURN NEW;
  END IF;

  -- Re-derived from the row's own wedding_id, never from a client argument (§8): a stale tab and a
  -- racing webhook therefore land on the same answer, because both are asked about the row they touched.
  SELECT EXISTS (
    SELECT 1
      FROM public.entitlements e
     WHERE e.wedding_id = NEW.wedding_id
       AND e.status = 'active'
       AND e.package_code = ANY (v_policy.publish_required_package_codes)
  ) INTO v_entitled;

  IF NOT v_entitled THEN
    RAISE EXCEPTION
      'wedding % may not publish: the commerce policy requires an active entitlement for one of [%], '
      'and this wedding has none. Hiding a button is not a gate; this is.',
      NEW.wedding_id,
      coalesce(array_to_string(v_policy.publish_required_package_codes, ', '), '(none named)')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_publication_commerce_gate()
  FROM PUBLIC, anon, authenticated, service_role;

-- One trigger covering both shapes rather than two clauses (§8 asks for both): an INSERT that arrives
-- already active and an UPDATE that re-activates a row are the same question, and one body means one
-- place for the rule to be wrong or right. BEFORE ROW, so the refusal happens before the row exists and
-- the partial unique index never gets to be the thing that notices.
CREATE TRIGGER publications_commerce_publish_gate
  BEFORE INSERT OR UPDATE ON public.publications
  FOR EACH ROW EXECUTE FUNCTION private.guard_publication_commerce_gate();

COMMENT ON FUNCTION private.guard_publication_commerce_gate() IS
  'The Stage 10 publish gate. Reads private.commerce_policy and, under entitlement_required, demands an '
  'active entitlement for the row''s own wedding whose package_code is in publish_required_package_codes. '
  'Under the shipped default (permissive) it changes nothing, which is why the 367 HTTP cases and every '
  'historical chain that publishes stay green without being weakened.';

-- ===========================================================================
-- 9. The service-only bodies (§5)
-- ===========================================================================
-- All `SECURITY INVOKER`, all with zero EXECUTE grants: reachability is a property of the role, not of a
-- token. The owner of every one of these is `postgres`, so the trusted maintenance connection can call
-- them and can reach the tables they write, and nothing else in this cluster can. That posture is the
-- Stage 5 maintenance-body precedent, and it is why `record_commerce_event` may call the grant and
-- revocation steps as nested INVOKER functions rather than duplicating them: a nested INVOKER call is
-- privilege-checked against whoever issued the statement, which here is the same trusted owner. A future
-- deployment that connects as another role must gain an explicit, reviewed grant, not a looser default.
--
-- Each takes an explicit p_actor_user_id because the trusted path has no JWT to read, and each re-derives
-- ownership from public.weddings instead of believing the actor it was handed (§5).

-- ------------------------------------------------------------------ 9.1 quote

CREATE FUNCTION internal_api.create_commerce_order(
  p_wedding_id uuid,
  p_package_code text,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_owner     uuid;
  v_pkg       private.commerce_packages;
  v_live      private.commerce_orders;
  v_id        uuid;
  v_reference text;
BEGIN
  IF p_wedding_id IS NULL OR p_actor_user_id IS NULL
     OR p_package_code IS NULL OR length(btrim(p_package_code)) = 0 THEN
    RAISE EXCEPTION 'a quote needs a wedding, a package code and the user it is being made for'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Ownership is read from the wedding, not accepted from the caller (§5). An actor who names somebody
  -- else's wedding is refused by this comparison, and an actor who names a nonexistent one is refused by
  -- the same statement, because there is no branch that treats "not found" as permission.
  SELECT w.owner_user_id INTO v_owner FROM public.weddings w WHERE w.id = p_wedding_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no wedding % exists to quote for', p_wedding_id
      USING ERRCODE = 'raise_exception';
  END IF;
  IF v_owner <> p_actor_user_id THEN
    RAISE EXCEPTION 'user % does not own wedding %; a quote is made for the wedding''s owner and no one else',
      p_actor_user_id, p_wedding_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- §7: the shipped catalogue has no active price, so every branch of this function that could succeed
  -- is unreachable in a fresh install, and this is the message the product prints.
  SELECT * INTO v_pkg
    FROM private.commerce_packages p
   WHERE p.package_code = btrim(p_package_code) AND p.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no approved price exists for package %', btrim(p_package_code)
      USING ERRCODE = 'raise_exception';
  END IF;

  -- For the message, not the guarantee: `commerce_orders_one_live_per_wedding_package` is what holds
  -- under two concurrent calls, and a 23505 from that index is the same refusal with a worse sentence.
  SELECT * INTO v_live
    FROM private.commerce_orders o
   WHERE o.wedding_id = p_wedding_id AND o.package_code = v_pkg.package_code
     AND o.status IN ('open', 'payment_pending')
   ORDER BY o.created_at DESC LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'wedding % already has live order % for package % at version %; a second order is made by '
      'cancelling or letting the first expire, never alongside it',
      p_wedding_id, v_live.merchant_reference, v_pkg.package_code, v_pkg.price_version
      USING ERRCODE = 'unique_violation';
  END IF;

  -- One-time payment per wedding and package, with no quantity of any kind in this row: a guest count
  -- is not a billable thing (§12), which is why there is nothing here for it to multiply by.
  --
  -- The thirty minutes is a server knob, not a commercial decision: it says how long one calculation of
  -- a price stays valid, and §10's `stale_open_order` finding is what reads it. It is named here rather
  -- than in a config table because moving it is a reviewed code change, not an owner setting.
  v_id := gen_random_uuid();
  v_reference := 'vv1_' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO private.commerce_orders (
    id, wedding_id, owner_user_id, merchant_reference, package_code, price_version,
    amount_minor, currency, status, quote_expires_at)
  VALUES (
    v_id, p_wedding_id, v_owner, v_reference, v_pkg.package_code, v_pkg.price_version,
    v_pkg.amount_minor, v_pkg.currency, 'open', now() + interval '30 minutes');

  INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
    VALUES (p_wedding_id, 'commerce_order', v_id, 'quote_created', p_actor_user_id,
      jsonb_build_object('merchant_reference', v_reference,
                         'package_code', v_pkg.package_code,
                         'price_version', v_pkg.price_version,
                         'amount_minor', v_pkg.amount_minor,
                         'currency', v_pkg.currency));

  -- No provider object, no checkout token, no URL: this returns a frozen quote and nothing else. The
  -- amount appears here because a server-side caller is allowed to know the price it just computed; the
  -- browser projection in §9.6 is where display_approved is enforced.
  RETURN jsonb_build_object(
    'order_id', v_id,
    'merchant_reference', v_reference,
    'wedding_id', p_wedding_id,
    'package_code', v_pkg.package_code,
    'price_version', v_pkg.price_version,
    'amount_minor', v_pkg.amount_minor,
    'currency', v_pkg.currency,
    'status', 'open',
    'price_display_approved', v_pkg.display_approved,
    'quote_expires_at', now() + interval '30 minutes');
END;
$$;

REVOKE ALL ON FUNCTION internal_api.create_commerce_order(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.create_commerce_order(uuid, text, uuid) IS
  'Service-only, SECURITY INVOKER, no EXECUTE grant. Calculates a quote from the active price row, mints '
  'the merchant reference, freezes both into one order row. Takes no amount, no currency and no provider '
  'argument, because a caller that could supply a price is the defect ADR 0005 rule 3 names. Refuses while '
  'the catalogue has no active price, which is every fresh install.';

-- --------------------------------------------------------------- 9.2 activation

CREATE FUNCTION internal_api.grant_commerce_entitlement(
  p_order_id uuid,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_order  private.commerce_orders;
  v_ent    uuid;
  v_granted boolean := false;
BEGIN
  SELECT * INTO v_order FROM private.commerce_orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no order % to grant from', p_order_id USING ERRCODE = 'raise_exception';
  END IF;

  -- The step is reached by a verified capture and by the reconciler's recovery of a capture that did not
  -- grant (§10). Neither may be able to make a right out of money that has not been confirmed, so a
  -- non-captured order is refused here rather than filtered by the caller.
  IF v_order.status <> 'captured' THEN
    RAISE EXCEPTION 'order % is % and carries no captured money to grant a right for',
      v_order.id, v_order.status USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotent by the Stage 2 partial unique index, which is what makes recovery unable to double-grant
  -- (§10). The conflict target spells the index's own predicate; nothing about a grant is decided by
  -- this body reading a row it is about to write.
  INSERT INTO public.entitlements (wedding_id, package_code, status, source, metadata)
    VALUES (v_order.wedding_id, v_order.package_code, 'active', 'service',
      jsonb_build_object('order_id', v_order.id,
                         'merchant_reference', v_order.merchant_reference,
                         'price_version', v_order.price_version,
                         'granted_by', 'commerce_capture'))
  ON CONFLICT (wedding_id, package_code) WHERE status = 'active' DO NOTHING;

  GET DIAGNOSTICS v_granted = ROW_COUNT;

  SELECT e.id INTO v_ent
    FROM public.entitlements e
   WHERE e.wedding_id = v_order.wedding_id
     AND e.package_code = v_order.package_code
     AND e.status = 'active';

  UPDATE private.commerce_orders o
     SET entitlement_id = v_ent
   WHERE o.id = v_order.id;

  IF v_granted THEN
    INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
      VALUES (v_order.wedding_id, 'entitlement', v_ent, 'granted_by_commerce_capture', p_actor_user_id,
        jsonb_build_object('order_id', v_order.id, 'package_code', v_order.package_code,
                           'price_version', v_order.price_version));
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'entitlement_id', v_ent,
    'newly_granted', v_granted,
    'already_granted', NOT v_granted);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.grant_commerce_entitlement(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.grant_commerce_entitlement(uuid, uuid) IS
  'Service-only. The only writer of a paid entitlement. Idempotent through '
  'one_active_entitlement_per_wedding_package, so re-invoking it during recovery cannot double-grant. '
  'Refuses an order that is not captured.';

-- ------------------------------------------------------------ 9.3 revocation

CREATE FUNCTION internal_api.revoke_commerce_entitlement(
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_order private.commerce_orders;
  v_ent   public.entitlements;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a revocation must say why: an entitlement is a right somebody was told they have'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_order FROM private.commerce_orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no order % to revoke for', p_order_id USING ERRCODE = 'raise_exception';
  END IF;

  SELECT * INTO v_ent
    FROM public.entitlements e
   WHERE e.id = v_order.entitlement_id AND e.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % has no live entitlement to revoke', v_order.id
      USING ERRCODE = 'raise_exception';
  END IF;

  -- A UPDATE, never a DELETE (§9): the row stays as the record that this wedding was entitled and then
  -- was not. The table's own CHECK keeps status and revoked_at in step, and its partial unique index is
  -- what forces any later regrant to be a new row.
  UPDATE public.entitlements e
     SET status = 'revoked', revoked_at = now(),
         metadata = coalesce(e.metadata, '{}'::jsonb)
                   || jsonb_build_object('revoked_reason', btrim(p_reason),
                                         'revoked_by_order', v_order.id)
   WHERE e.id = v_ent.id;

  INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
    VALUES (v_order.wedding_id, 'entitlement', v_ent.id, 'revoked', p_actor_user_id,
      jsonb_build_object('order_id', v_order.id, 'reason', btrim(p_reason),
                         'package_code', v_order.package_code));

  RETURN jsonb_build_object('order_id', v_order.id, 'entitlement_id', v_ent.id, 'status', 'revoked');
END;
$$;

REVOKE ALL ON FUNCTION internal_api.revoke_commerce_entitlement(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.revoke_commerce_entitlement(uuid, uuid, text) IS
  'Service-only, and the only revocation path. Sets status and revoked_at on the live entitlement, takes '
  'a required reason, writes an audit row. Nothing in Stage 10 deletes an entitlement, an order or a '
  'ledger row.';

-- --------------------------------------------------------------- 9.4 expiry

CREATE FUNCTION internal_api.expire_commerce_order(
  p_order_id uuid,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_order private.commerce_orders;
BEGIN
  SELECT * INTO v_order FROM private.commerce_orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no order % to expire', p_order_id USING ERRCODE = 'raise_exception';
  END IF;

  IF v_order.status NOT IN ('open', 'payment_pending') THEN
    RAISE EXCEPTION 'order % is %, which is not a live order; a captured order is refunded, never expired',
      v_order.id, v_order.status USING ERRCODE = 'check_violation';
  END IF;

  -- Refuses an expiry that has not arrived rather than allowing one that has: §10's `stale_open_order`
  -- finding is the thing that decides a quote is overage, and a sweep that could close a fresh quote
  -- would make the finding and its remedy disagree.
  IF v_order.quote_expires_at > now() THEN
    RAISE EXCEPTION 'order % is quoted until %, which has not passed',
      v_order.id, v_order.quote_expires_at USING ERRCODE = 'check_violation';
  END IF;

  UPDATE private.commerce_orders o
     SET status = 'expired', closed_at = now()
   WHERE o.id = v_order.id;

  INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
    VALUES (v_order.wedding_id, 'commerce_order', v_order.id, 'expired', p_actor_user_id,
      jsonb_build_object('merchant_reference', v_order.merchant_reference,
                         'status_before', v_order.status));

  RETURN jsonb_build_object('order_id', v_order.id, 'status', 'expired');
END;
$$;

REVOKE ALL ON FUNCTION internal_api.expire_commerce_order(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.expire_commerce_order(uuid, uuid) IS
  'Service-only. Closes a quote whose own expiry has passed. A late capture on the expired order it '
  'produces is held for reconciliation by record_commerce_event, never applied retroactively (§4).';

-- ------------------------------------------------------------ 9.5 the ledger

CREATE FUNCTION internal_api.record_commerce_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_kind text,
  p_environment text,
  p_raw_body_sha256 text,
  -- The ledger column this fills is `signature_valid`; the argument is not named after it, on purpose.
  -- C29b refuses any callable argument in `api`/`internal_api` whose name is credential-shaped, so
  -- `p_signature_valid` would fail a rule that exists to keep a *secret* out of a query string. Renaming
  -- it here is the repair; adding a type-aware carve-out to the rule would be the weakening, and a
  -- boolean verdict is not the thing the rule is hunting.
  p_delivery_verified boolean,
  p_refusal_reason text,
  p_merchant_reference text,
  p_amount_minor bigint,
  p_currency text,
  p_provider_order_ref text,
  p_provider_payment_ref text,
  p_occurred_at timestamptz,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_policy      private.commerce_policy;
  v_order       private.commerce_orders;
  v_after       private.commerce_orders;
  v_attempt     private.commerce_payment_attempts;
  v_open        private.commerce_payment_attempts;
  v_prev        private.commerce_payment_events;
  v_order_found boolean := false;
  v_order_id    uuid;
  v_event_id    bigint;
  v_attempt_id  uuid;
  v_target_id   uuid;
  v_refund_id   uuid;
  v_ent_result  jsonb;
  v_now         timestamptz := now();
  v_status      text;
  v_effect      text;
  v_hold        text;
  v_state_order text;
  v_newest      timestamptz;
BEGIN
  -- ------------------------------------------------------------------ input
  -- These four exist so a caller that mis-wired its adapter gets a sentence about which argument it
  -- mis-wired instead of a 23514 about a row it never saw. The rest of the shape rules are the table's
  -- own CHECKs — except on the ledger's `amount_minor`/`currency`, which deliberately have none (§5).
  IF p_provider IS NULL OR p_provider NOT IN ('razorpay', 'cashfree') THEN
    RAISE EXCEPTION 'record_commerce_event: provider must be razorpay or cashfree (got %)',
      coalesce(p_provider, '(none)') USING ERRCODE = 'check_violation';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('payment_initiated', 'payment_captured', 'payment_failed',
                                      'order_cancelled', 'refund_succeeded', 'refund_failed',
                                      'chargeback_opened', 'other') THEN
    RAISE EXCEPTION 'record_commerce_event: % is not a kind this build understands',
      coalesce(p_kind, '(none)') USING ERRCODE = 'check_violation';
  END IF;
  IF p_event_id IS NULL OR length(btrim(p_event_id)) = 0 THEN
    RAISE EXCEPTION 'record_commerce_event: a delivery with no provider event identity cannot be recorded '
                    'as evidence of anything' USING ERRCODE = 'check_violation';
  END IF;
  IF p_delivery_verified IS NULL OR p_raw_body_sha256 IS NULL
     OR p_raw_body_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'record_commerce_event: a delivery_verified verdict and a 64-hex raw_body_sha256 are required'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ---------------------------------------------- level 1: provider-event idempotency
  -- Read before writing, so a retry cannot raise the unique index and abort the caller's transaction.
  -- Two deliveries of one event produce one row and two identical answers (§4).
  SELECT * INTO v_prev FROM private.commerce_payment_events e
   WHERE e.provider = p_provider AND e.event_id = btrim(p_event_id);
  IF FOUND THEN
    RETURN jsonb_build_object(
      'disposition', 'already_recorded',
      'event_row_id', v_prev.id,
      'processing_status', v_prev.processing_status,
      'applied_effect', v_prev.applied_effect,
      'hold_reason', v_prev.hold_reason,
      'order_id', v_prev.order_id);
  END IF;

  SELECT * INTO v_policy FROM private.commerce_policy WHERE id = 1;

  -- --------------------------- level 2: the refusal chain (§4.2), in the order it is written
  v_status := 'applied';
  IF NOT p_delivery_verified THEN
    -- Not applied, not retried, and not written to any other table (§4.2 rule 1). Everything below needs
    -- a trusted body, and an unverified body is not one: no order resolution, no attempt, no state.
    v_status  := 'rejected_signature';
    v_hold    := NULL;
    v_effect  := NULL;
  ELSIF p_environment IS NULL OR p_environment NOT IN ('synthetic', 'sandbox', 'test', 'live') THEN
    -- §6's `environment_undeclared` is refused by the verifier before crypto; this is the second layer,
    -- because the value is what gates live capture and an unclassifiable environment must never be
    -- allowed to read as a non-live one.
    v_status := 'held_for_reconciliation';
    v_hold   := 'environment_undeclared';
  ELSIF coalesce(v_policy.live_capture_enabled, false) = false AND p_environment = 'live' THEN
    -- §4.2 rule 2: even if somebody wires a live endpoint tomorrow, nothing in this ledger can grant
    -- while that row says false.
    v_status := 'held_for_reconciliation';
    v_hold   := 'live_capture_disabled';
  ELSE
    SELECT * INTO v_order FROM private.commerce_orders o
     WHERE o.merchant_reference = btrim(p_merchant_reference);
    v_order_found := FOUND;
    -- Bound as soon as the lookup succeeds, not only on the branch that goes on to act. A held row that
    -- was held *because of what this order says* has to keep naming the order: §10's `amount_drift` and
    -- the person doing the reconciliation both reach the purchase through this link, and a row that
    -- records "this quote disagrees with that order" while pointing at neither is an alarm nobody can
    -- answer. Only `unknown_order` may leave the link absent, and the ledger write below says so.
    IF v_order_found THEN
      v_order_id := v_order.id;
    END IF;
    IF NOT v_order_found THEN
      -- A 2xx to the provider and a kept row: refusing loudly is how a provider stops retrying a
      -- delivery we might legitimately learn to accept later (§4.2 rule 3).
      v_status := 'held_for_reconciliation';
      v_hold   := 'unknown_order';
    ELSIF p_amount_minor IS NOT NULL
          AND (p_amount_minor <> v_order.amount_minor
               OR p_currency IS DISTINCT FROM v_order.currency) THEN
      -- §4.2 rule 4, read literally: the order's price never moves to match a webhook, and neither does
      -- anything else's message.
      v_status := 'held_for_reconciliation';
      v_hold   := 'amount_mismatch';
    ELSE
      SELECT * INTO v_attempt FROM private.commerce_payment_attempts a
       WHERE a.order_id = v_order.id AND a.provider = p_provider
         AND ((p_provider_payment_ref IS NOT NULL
               AND a.provider_payment_ref = btrim(p_provider_payment_ref))
           OR (p_provider_order_ref IS NOT NULL
               AND a.provider_order_ref = btrim(p_provider_order_ref)))
       ORDER BY a.initiated_at DESC LIMIT 1;

      SELECT * INTO v_open FROM private.commerce_payment_attempts a
       WHERE a.order_id = v_order.id AND a.status = 'initiated'
       ORDER BY a.initiated_at DESC LIMIT 1;

      IF FOUND AND v_open.provider <> p_provider THEN
        -- §4.2 rule 5: a Razorpay event cannot confirm a Cashfree payment.
        v_status := 'held_for_reconciliation';
        v_hold   := 'provider_mismatch';
      ELSE
        -- The state machine (§4), then the §4.1 staleness rule on top of it.
        CASE p_kind
          WHEN 'payment_initiated' THEN
            IF v_order.status = 'open' THEN
              v_effect := 'attempt_initiated';
            ELSIF v_order.status = 'payment_pending' THEN
              v_effect := 'attempt_recorded';
            ELSIF v_order.status = 'captured' THEN
              -- Initiation cannot follow capture.
              v_status := 'stale';
            ELSE
              v_status := 'held_for_reconciliation';
              v_hold   := 'closed_order';
            END IF;

          WHEN 'payment_captured' THEN
            IF v_order.status IN ('open', 'payment_pending') THEN
              v_effect := 'entitlement_granted';
            ELSIF v_order.status = 'captured' THEN
              v_status := 'duplicate';
              v_effect := 'ignored_already_captured';
            ELSE
              -- The most dangerous row in the system: closed order, captured money. Held, and §10's
              -- sweep is what puts a human in front of it.
              v_status := 'held_for_reconciliation';
              v_hold   := 'captured_on_closed_order';
            END IF;

          WHEN 'payment_failed' THEN
            IF v_order.status = 'payment_pending' THEN
              v_effect := 'attempt_failed';
            ELSIF v_order.status = 'open' THEN
              v_effect := 'failure_recorded';
            ELSIF v_order.status = 'captured' THEN
              v_status := 'held_for_reconciliation';
              v_hold   := 'failure_after_capture';
            ELSE
              v_effect := 'recorded_only';
            END IF;

          WHEN 'order_cancelled' THEN
            IF v_order.status IN ('open', 'payment_pending') THEN
              v_effect := 'order_cancelled';
            ELSIF v_order.status = 'captured' THEN
              v_status := 'held_for_reconciliation';
              v_hold   := 'cancel_after_capture';
            ELSE
              v_effect := 'recorded_only';
            END IF;

          WHEN 'refund_succeeded' THEN
            IF v_order.status = 'captured' THEN
              -- The effect names what the policy decided, because the ledger row is written before the
              -- revocation step runs and must already say what is about to happen to the entitlement.
              v_effect := CASE WHEN v_policy.refund_revocation_mode = 'revoke'
                               THEN 'entitlement_revoked' ELSE 'refund_recorded' END;
            ELSE
              v_effect := 'recorded_only';
            END IF;

          WHEN 'refund_failed' THEN
            IF v_order.status = 'captured' THEN
              v_effect := 'refund_failed_recorded';
            ELSE
              v_effect := 'recorded_only';
            END IF;

          WHEN 'chargeback_opened' THEN
            IF v_order.status = 'captured' THEN
              -- Always hold-for-review whatever the policy row says (§9): a dispute decided by an
              -- automated revocation is a family locked out of their own wedding on an unadjudicated
              -- claim. The effect name says so out loud so a reader of the ledger cannot mistake it.
              v_effect := 'chargeback_hold_for_review';
            ELSE
              v_effect := 'recorded_only';
            END IF;

          ELSE
            -- 'other': recorded, never applied (§4). §6's rule is that an event this build has not read
            -- must not be able to make it act, and must not be able to make a delivery disappear.
            v_effect := 'recorded_only';
        END CASE;

        -- §4.1's last paragraph: occurred_at may not re-order history. Only meaningful for a row that
        -- names the attempt and is still going to change something.
        IF v_status = 'applied' AND v_attempt.id IS NOT NULL AND p_occurred_at IS NOT NULL THEN
          SELECT max(e.occurred_at) INTO v_newest
            FROM private.commerce_payment_events e
           WHERE e.attempt_id = v_attempt.id AND e.processing_status = 'applied';
          IF v_newest IS NOT NULL AND p_occurred_at < v_newest THEN
            v_status := 'stale';
            v_effect := NULL;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- --------------------------------------------- the attempt object, before the ledger row
  -- Resolved or minted here so the ledger row can name the attempt it is evidence about. §4.1's
  -- honour-a-capture-without-an-initiation rule means a capture can be the first delivery that ever
  -- arrived, and then the attempt is created already confirmed, from its own evidence, not from a
  -- message we never received.
  v_target_id := coalesce(v_attempt.id, v_open.id);

  IF v_status = 'applied' AND p_kind = 'payment_initiated' AND v_attempt.id IS NULL THEN
    INSERT INTO private.commerce_payment_attempts (
      order_id, provider, environment, provider_order_ref, provider_payment_ref,
      status, initiated_at)
      VALUES (v_order_id, p_provider, p_environment,
              nullif(btrim(coalesce(p_provider_order_ref, '')), ''),
              nullif(btrim(coalesce(p_provider_payment_ref, '')), ''),
              'initiated', coalesce(p_occurred_at, v_now))
    RETURNING id INTO v_attempt_id;
    v_target_id := v_attempt_id;
  ELSIF v_status = 'applied' AND p_kind = 'payment_captured' THEN
    IF v_attempt.id IS NULL THEN
      INSERT INTO private.commerce_payment_attempts (
        order_id, provider, environment, provider_order_ref, provider_payment_ref,
        status, initiated_at, confirmed_at)
        VALUES (v_order_id, p_provider, p_environment,
                nullif(btrim(coalesce(p_provider_order_ref, '')), ''),
                nullif(btrim(coalesce(p_provider_payment_ref, '')), ''),
                'confirmed', coalesce(p_occurred_at, v_now), coalesce(p_occurred_at, v_now))
      RETURNING id INTO v_attempt_id;
      v_target_id := v_attempt_id;
    ELSIF v_attempt.status = 'initiated' THEN
      -- Confirming also carries the references the capture names. An initiation delivery legitimately
      -- knows only the order reference, so without this the row stays `provider_payment_ref IS NULL` for
      -- the rest of its life — and that breaks two things the schema promises. §3's partial
      -- `commerce_attempts_payment_ref_uk` cannot protect a payment object whose reference was never
      -- written, so "one provider payment object cannot be initiated twice" stops holding for the most
      -- common sequence in the product; and a later refund or chargeback, which names a payment reference
      -- and nothing else, could not be matched back to the payment it concerns. Existing values win: a
      -- reference already on the row is evidence, and a newer message does not overwrite it.
      UPDATE private.commerce_payment_attempts a
         SET status = 'confirmed',
             confirmed_at = coalesce(p_occurred_at, v_now),
             provider_payment_ref = coalesce(a.provider_payment_ref,
               nullif(btrim(coalesce(p_provider_payment_ref, '')), '')),
             provider_order_ref = coalesce(a.provider_order_ref,
               nullif(btrim(coalesce(p_provider_order_ref, '')), ''))
       WHERE a.id = v_attempt.id
      RETURNING a.id INTO v_attempt_id;
      v_target_id := v_attempt_id;
    END IF;
  END IF;

  -- ------------------------------------------------------------- the ledger row
  -- Exactly one row per accepted delivery, on every branch above — including the refusals, which is the
  -- whole point of ADR 0005 rule 5.
  --
  -- `kind` is forced to 'other' when the signature did not verify. The caller's kind came from the body,
  -- and a body that failed verification gets to name nothing about itself: a forgery that claims to be a
  -- capture is recorded as an unverified delivery, which is what it is.
  INSERT INTO private.commerce_payment_events (
    provider, event_id, event_type, kind, environment, order_id, attempt_id,
    merchant_reference, amount_minor, currency, raw_body_sha256, signature_valid,
    refusal_reason, hold_reason, processing_status, applied_effect, occurred_at, received_at)
  VALUES (
    p_provider, btrim(p_event_id), nullif(btrim(coalesce(p_event_type, '')), ''),
    CASE WHEN NOT p_delivery_verified THEN 'other' ELSE p_kind END,
    CASE WHEN p_environment IN ('synthetic', 'sandbox', 'test', 'live') THEN p_environment END,
    CASE WHEN v_hold = 'unknown_order' THEN NULL ELSE v_order_id END,
    CASE WHEN v_hold = 'unknown_order' THEN NULL ELSE v_target_id END,
    nullif(btrim(coalesce(p_merchant_reference, '')), ''),
    p_amount_minor, p_currency, p_raw_body_sha256, p_delivery_verified,
    CASE WHEN v_status = 'rejected_signature'
         THEN coalesce(nullif(btrim(coalesce(p_refusal_reason, '')), ''), 'signature_mismatch') END,
    v_hold, v_status,
    -- The decision, named, whenever this build made one — including when what it decided was to decline.
    -- Gating this on `v_status = 'applied'` would leave a declined capture's row reading
    -- `duplicate` with nothing beside it, while the answer the same caller got said
    -- `ignored_already_captured`: two accounts of one delivery, which is the one thing an evidence table
    -- exists to prevent. §3 records the same intent ("the effect is recorded so a replay's *answer* is
    -- reproducible, not merely its arrival"). Refusals and holds still land here as NULL, because for
    -- those the build decided nothing about the money.
    v_effect,
    p_occurred_at, v_now)
  RETURNING id INTO v_event_id;

  -- A refused, held, stale or duplicate delivery stops here: §4.2 says each of those produces a ledger row
  -- and no state change, and this is the single place that decides it. Note that `rejected_signature`
  -- therefore writes nothing but this row — no audit event, no attempt, no entitlement, no order touch.
  IF v_status <> 'applied' THEN
    RETURN jsonb_build_object(
      'disposition', 'recorded',
      'event_row_id', v_event_id,
      'processing_status', v_status,
      'applied_effect', v_effect,
      'hold_reason', v_hold,
      'order_id', v_order_id,
      'order_status', v_order.status,
      'state_changed', false);
  END IF;

  v_state_order := v_order.status;

  -- ------------------------------------------------------------ applying effects
  IF p_kind = 'payment_initiated' THEN
    IF v_order.status = 'open' THEN
      UPDATE private.commerce_orders o SET status = 'payment_pending' WHERE o.id = v_order_id;
      INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
        VALUES (v_order.wedding_id, 'commerce_event', v_order.id, 'attempt_initiated', p_actor_user_id,
          jsonb_build_object('event_row_id', v_event_id, 'attempt_id', v_target_id,
                             'provider', p_provider, 'order_status_before', v_state_order));
    ELSIF v_order.status = 'payment_pending' THEN
      -- A second, distinct initiation for an order already pending: the attempt row above is the record,
      -- and the order does not move twice.
      INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
        VALUES (v_order.wedding_id, 'commerce_event', v_order.id, 'attempt_recorded', p_actor_user_id,
          jsonb_build_object('event_row_id', v_event_id, 'attempt_id', v_target_id,
                             'provider', p_provider));
    END IF;

  ELSIF p_kind = 'payment_captured' THEN
    UPDATE private.commerce_orders o
       SET status = 'captured', captured_at = v_now
     WHERE o.id = v_order_id;

    -- The one place a paid right comes into existence. Called rather than inlined because the
    -- reconciler's recovery (§10) re-invokes the identical step, and two implementations of "what a
    -- capture grants" is how one of them drifts.
    v_ent_result := internal_api.grant_commerce_entitlement(v_order_id, p_actor_user_id);

    INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
      VALUES (v_order.wedding_id, 'commerce_event', v_order.id, 'order_captured', p_actor_user_id,
        jsonb_build_object('event_row_id', v_event_id, 'attempt_id', v_target_id,
                           'entitlement_id', v_ent_result -> 'entitlement_id',
                           'newly_granted', v_ent_result -> 'newly_granted',
                           'order_status_before', v_state_order,
                           'initiation_never_delivered', v_state_order = 'open'));

  ELSIF p_kind = 'payment_failed' THEN
    IF v_order.status = 'payment_pending' AND v_target_id IS NOT NULL THEN
      -- The reference gap-fill is the same rule as the confirm path above: a failed attempt is still the
      -- provider's payment object, and its reference is what any later message about that object names.
      UPDATE private.commerce_payment_attempts a
         SET status = 'failed', failed_at = v_now,
             provider_payment_ref = coalesce(a.provider_payment_ref,
               nullif(btrim(coalesce(p_provider_payment_ref, '')), '')),
             provider_order_ref = coalesce(a.provider_order_ref,
               nullif(btrim(coalesce(p_provider_order_ref, '')), ''))
       WHERE a.id = v_target_id AND a.status = 'initiated';
      -- The order deliberately stays payment_pending: a failed attempt is not a closed purchase, and a
      -- later attempt may succeed (§4). Closing it here would be the ledger deciding a business question
      -- the provider did not answer.
      INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
        VALUES (v_order.wedding_id, 'commerce_event', v_order.id, 'attempt_failed', p_actor_user_id,
          jsonb_build_object('event_row_id', v_event_id, 'attempt_id', v_target_id));
    ELSIF v_order.status = 'open' THEN
      INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
        VALUES (v_order.wedding_id, 'commerce_event', v_order.id, 'failure_recorded', p_actor_user_id,
          jsonb_build_object('event_row_id', v_event_id, 'attempt_id', v_target_id));
    END IF;

  ELSIF p_kind = 'order_cancelled' THEN
    UPDATE private.commerce_orders o
       SET status = 'cancelled', closed_at = v_now
     WHERE o.id = v_order_id;
    INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
      VALUES (v_order.wedding_id, 'commerce_event', v_order.id, 'cancelled_by_provider', p_actor_user_id,
        jsonb_build_object('event_row_id', v_event_id, 'order_status_before', v_state_order));

  ELSIF p_kind IN ('refund_succeeded', 'refund_failed', 'chargeback_opened') THEN
    -- The refund row is written only for a captured order (§4's row): money that was never captured has
    -- nothing moving back, and inventing a refund row against an open quote would be a second, false
    -- account of the same purchase.
    IF v_order.status = 'captured' THEN
      -- For a refund or chargeback delivery the verifier's providerPaymentRef carries the provider's own
      -- refund/chargeback identity (`scripts/stage10-webhook-core.mjs:400`), which is what this column
      -- records.
      INSERT INTO private.commerce_refunds (
        order_id, event_id, kind, status, amount_minor, currency,
        provider_refund_ref, completed_at)
        VALUES (v_order_id, v_event_id,
                CASE WHEN p_kind = 'chargeback_opened' THEN 'chargeback' ELSE 'refund' END,
                CASE p_kind WHEN 'refund_succeeded' THEN 'succeeded'
                            WHEN 'refund_failed' THEN 'failed'
                            ELSE 'recorded' END,
                p_amount_minor, p_currency,
                nullif(btrim(coalesce(p_provider_payment_ref, '')), ''),
                CASE WHEN p_kind = 'refund_succeeded' THEN v_now END)
      RETURNING id INTO v_refund_id;

      INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
        VALUES (v_order.wedding_id, 'commerce_event', v_order.id,
                CASE WHEN p_kind = 'chargeback_opened' THEN 'chargeback_opened'
                     ELSE 'refund' || substring(p_kind from 7) END,
                p_actor_user_id,
          jsonb_build_object('event_row_id', v_event_id, 'refund_id', v_refund_id,
                             'kind', CASE WHEN p_kind = 'chargeback_opened' THEN 'chargeback' ELSE 'refund' END,
                             'revocation_mode',
                             CASE WHEN p_kind = 'chargeback_opened' THEN 'hold_for_review'
                                  ELSE v_policy.refund_revocation_mode END));

      -- §9: a chargeback never revokes, whatever the policy row says. A refund does only under `revoke`,
      -- and the revocation is the same trusted step a human would invoke, so the entitlement ends in one
      -- state with one reason recorded, not two.
      IF p_kind = 'refund_succeeded' AND v_policy.refund_revocation_mode = 'revoke' THEN
        PERFORM internal_api.revoke_commerce_entitlement(v_order_id, p_actor_user_id,
          'refund_succeeded while refund_revocation_mode = revoke');
      END IF;
    END IF;

  ELSE
    -- 'other': a recognised-but-inert delivery, or an event this build has not read. The ledger row above
    -- is the entire effect, and that is the designed outcome, not an unimplemented one.
    NULL;
  END IF;

  SELECT * INTO v_after FROM private.commerce_orders o WHERE o.id = v_order_id;

  RETURN jsonb_build_object(
    'disposition', 'applied',
    'event_row_id', v_event_id,
    'processing_status', v_status,
    'applied_effect', v_effect,
    'hold_reason', NULL,
    'order_id', v_order_id,
    'attempt_id', v_target_id,
    'order_status', v_after.status,
    'entitlement_id', v_after.entitlement_id,
    'state_changed', v_after.status IS DISTINCT FROM v_state_order);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.record_commerce_event(
  text, text, text, text, text, text, boolean, text, text, bigint, text, text, text, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.record_commerce_event(text, text, text, text, text, text, boolean, text, text, bigint, text, text, text, timestamptz, uuid) IS
  'Service-only. The ledger''s only writer and the only place the state machine lives. Idempotent at the '
  'provider-event level by unique (provider, event_id) and at the business-order level by the row''s own '
  'status. Refuses to apply an unverified body, a live delivery while live capture is off, an '
  'unrecognised reference, an amount that disagrees with the frozen quote, a cross-provider confirmation '
  'and an event older than the last one applied. Returns the answer rather than raising, because a '
  'provider retry must be answered 2xx with the first delivery''s outcome.';

-- ------------------------------------------------------- 9.6 reconciliation (§10)

-- Recovery is a comparison, not a retry loop, because the dangerous states in billing are the ones where
-- two true facts disagree. This body reads rows and names findings; it changes no state. The remedies
-- beside each finding are the other service bodies in this file, re-invoked by an operator, which is what
-- keeps "the reconciler fixed it" out of the audit trail.
--
-- It writes exactly one thing: a summary row in `private.audit_events`, so that "this order was swept and
-- these were the findings at that moment" is answerable later. That is the reading of §10 the design
-- asks for — read-only about the commerce state, not a claim to have read nothing.
CREATE FUNCTION internal_api.commerce_reconcile(
  p_order_id uuid,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_order    private.commerce_orders;
  v_policy   private.commerce_policy;
  v_findings jsonb := '[]'::jsonb;
  v_capture  integer;
  v_open     integer;
  v_entitled integer;
BEGIN
  SELECT * INTO v_order FROM private.commerce_orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no order % to reconcile', p_order_id USING ERRCODE = 'raise_exception';
  END IF;

  SELECT * INTO v_policy FROM private.commerce_policy WHERE id = 1;

  -- initiation_never_delivered — evidence-only. §4.1 makes this a normal outcome of a provider retry
  -- policy, not a corruption, which is exactly why it is a finding a human reads rather than an error a
  -- transaction raises.
  SELECT count(*) INTO v_capture
    FROM private.commerce_payment_events e
   WHERE e.order_id = v_order.id AND e.processing_status = 'applied'
     AND e.kind = 'payment_captured';
  IF v_capture > 0 THEN
    SELECT count(*) INTO v_open
      FROM private.commerce_payment_events e
     WHERE e.order_id = v_order.id AND e.processing_status = 'applied'
       AND e.kind = 'payment_initiated';
    IF v_open = 0 THEN
      v_findings := v_findings || jsonb_build_object(
        'code', 'initiation_never_delivered',
        'detail', 'a capture was applied for this order and no initiation was ever recorded for it; the '
                  || 'capture stands on its own evidence and nothing here rewrites history to invent one');
    END IF;
  END IF;

  -- captured_without_entitlement — the grant step is what recovers this, and it is idempotent, so
  -- recovery cannot double-grant.
  IF v_order.status = 'captured' THEN
    SELECT count(*) INTO v_entitled
      FROM public.entitlements e
     WHERE e.wedding_id = v_order.wedding_id
       AND e.package_code = v_order.package_code
       AND e.status = 'active';
    IF v_entitled = 0 THEN
      v_findings := v_findings || jsonb_build_object(
        'code', 'captured_without_entitlement',
        'detail', 'order ' || v_order.merchant_reference || ' is captured and this wedding holds no '
                  || 'active entitlement for ' || v_order.package_code || '; re-invoke '
                  || 'grant_commerce_entitlement');
    END IF;

    -- entitlement_after_refund — only meaningful under `revoke`, and recorded either way so the row pair
    -- is on file whether or not the owner's policy says it is a problem.
    IF coalesce(v_policy.refund_revocation_mode, 'hold_for_review') = 'revoke' AND v_entitled > 0
       AND EXISTS (SELECT 1 FROM private.commerce_refunds r
                    WHERE r.order_id = v_order.id AND r.status = 'succeeded') THEN
      v_findings := v_findings || jsonb_build_object(
        'code', 'entitlement_after_refund',
        'detail', 'a refund succeeded while refund_revocation_mode is revoke and the entitlement is still '
                  || 'live; re-invoke revoke_commerce_entitlement with the reason');
    END IF;
  END IF;

  -- held_event_unapplied — the finding that represents a provider outage honestly: the provider kept
  -- retrying, we kept recording, the order waited, and a grace window is what turns that into a signal.
  SELECT count(*) INTO v_capture
    FROM private.commerce_payment_events e
   WHERE e.order_id = v_order.id
     AND e.processing_status = 'held_for_reconciliation'
     AND e.received_at < now() - interval '15 minutes';
  IF v_capture > 0 THEN
    v_findings := v_findings || jsonb_build_object(
      'code', 'held_event_unapplied',
      'detail', v_capture || ' delivery row(s) have been held for more than fifteen minutes; correct the '
              || 'facts or the price row and re-record the delivery as a new event id — nothing here '
              || 'edits a held row retroactively');
  END IF;

  -- amount_drift — the order is never re-priced; the fact this finding reports is that the row pair
  -- exists. Held rows count, because a refusal to apply is not a disagreement that went away.
  SELECT count(*) INTO v_capture
    FROM private.commerce_payment_events e
   WHERE e.order_id = v_order.id
     AND e.amount_minor IS NOT NULL
     AND (e.amount_minor <> v_order.amount_minor OR e.currency IS DISTINCT FROM v_order.currency);
  IF v_capture > 0 THEN
    v_findings := v_findings || jsonb_build_object(
      'code', 'amount_drift',
      'detail', v_capture || ' recorded delivery(ies) name an amount or currency other than the frozen '
              || 'quote (' || v_order.amount_minor || ' ' || v_order.currency || '); escalated, and the '
              || 'order keeps its own price');
  END IF;

  -- stale_open_order
  IF v_order.status IN ('open', 'payment_pending') AND v_order.quote_expires_at < now() THEN
    v_findings := v_findings || jsonb_build_object(
      'code', 'stale_open_order',
      'detail', 'the quote expired at ' || v_order.quote_expires_at || '; expire_commerce_order closes it, '
              || 'and a capture that arrives afterwards is held rather than applied');
  END IF;

  INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
    VALUES (v_order.wedding_id, 'reconciliation', v_order.id, 'swept', p_actor_user_id,
      jsonb_build_object('order_id', v_order.id,
                         'merchant_reference', v_order.merchant_reference,
                         'order_status', v_order.status,
                         'findings', v_findings));

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'merchant_reference', v_order.merchant_reference,
    'wedding_id', v_order.wedding_id,
    'order_status', v_order.status,
    'finding_count', jsonb_array_length(v_findings),
    'findings', v_findings);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.commerce_reconcile(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.commerce_reconcile(uuid, uuid) IS
  'Service-only. Compares the ledger, the order, the attempts, the refunds and the entitlement for one '
  'order and returns the named findings of §10. Changes no commerce state; writes one audit row recording '
  'that the sweep ran. Nothing here claims to have recovered an event that was never received.';

-- ---------------------------------------------------- 9.7 the host's own projection

-- The one browser-readable commerce surface, and the reason the projection is written as an explicit
-- column list rather than `row_to_json` of the order is that the order row contains `amount_minor`. §7
-- requires the amount to be *absent* from this function's output while `display_approved` is false — not
-- null, not zero, absent — so that a stale UI cannot print a figure and a future copy change cannot
-- surface one by accident.
CREATE FUNCTION internal_api.commerce_host_summary(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller  uuid;
  v_order   private.commerce_orders;
  v_pkg     private.commerce_packages;
  v_ent     public.entitlements;
  v_refund  private.commerce_refunds;
  v_policy  private.commerce_policy;
  v_state   text;
  v_out     jsonb;
BEGIN
  -- Re-derived from auth.uid(), exactly like every other host read surface: the wedding id alone is not
  -- authorisation, and this is the check §13's CO-03 and HD-02 exist to prove cannot be talked around.
  v_caller := auth.uid();
  IF v_caller IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_caller) THEN
    RAISE EXCEPTION 'the caller may not read this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_order FROM private.commerce_orders o
   WHERE o.wedding_id = p_wedding_id
   ORDER BY (o.status IN ('open', 'payment_pending', 'captured')) DESC, o.created_at DESC
   LIMIT 1;

  SELECT * INTO v_policy FROM private.commerce_policy WHERE id = 1;

  -- Which price this order was quoted at, and whether showing its amount is approved. Joined through the
  -- order's own frozen pair rather than the catalogue's current active row, which is the whole reason a
  -- price version exists.
  IF FOUND THEN
    SELECT * INTO v_pkg FROM private.commerce_packages p
     WHERE p.package_code = v_order.package_code
       AND p.price_version = v_order.price_version;
  END IF;

  IF v_order.entitlement_id IS NOT NULL THEN
    SELECT * INTO v_ent FROM public.entitlements e WHERE e.id = v_order.entitlement_id;
  END IF;

  SELECT * INTO v_refund FROM private.commerce_refunds r
   WHERE r.order_id = coalesce(v_order.id, '00000000-0000-0000-0000-000000000000'::uuid)
   ORDER BY r.recorded_at DESC LIMIT 1;

  -- The host's state, derived rather than stored: §2 keeps exactly one record of a right, so this is a
  -- reading of the rows, never a seventh status column somebody could write. `v_order.id IS NULL` is
  -- tested as a value rather than with NOT FOUND, because three lookups have run since that query and the
  -- flag describes only the last one.
  v_state := CASE
    WHEN v_order.id IS NULL                        THEN 'no_purchase'
    WHEN v_order.status = 'open'                   THEN 'quote_open'
    WHEN v_order.status = 'payment_pending'        THEN 'payment_pending'
    WHEN v_order.status = 'cancelled'              THEN 'cancelled'
    WHEN v_order.status = 'expired'                THEN 'quote_expired'
    WHEN v_refund.kind = 'chargeback'              THEN 'dispute_open_review'
    WHEN v_refund.status = 'succeeded'
         AND coalesce(v_policy.refund_revocation_mode, 'hold_for_review') = 'hold_for_review'
                                                   THEN 'refunded_pending_review'
    WHEN v_refund.status = 'succeeded'             THEN 'refunded_entitlement_revoked'
    WHEN v_ent.status = 'active'                   THEN 'entitlement_active'
    WHEN v_ent.status = 'revoked'                  THEN 'entitlement_revoked'
    WHEN v_ent.status = 'expired'                  THEN 'entitlement_expired'
    ELSE 'captured_awaiting_entitlement'
  END;

  v_out := jsonb_build_object(
    'wedding_id', p_wedding_id,
    'state', v_state,
    -- Not on sale is a different sentence from unpaid, and the panel needs the first one while the
    -- catalogue is empty (§7). Computed from the same active-row lookup the quote uses.
    'price_available', EXISTS (
      SELECT 1 FROM private.commerce_packages p
       WHERE p.status = 'active'
         AND (v_order.package_code IS NULL OR p.package_code = v_order.package_code)),
    'package_code', v_order.package_code,
    'price_version', v_order.price_version,
    'order_status', v_order.status,
    'merchant_reference', v_order.merchant_reference,
    'quote_expires_at', v_order.quote_expires_at,
    'captured_at', v_order.captured_at,
    'closed_at', v_order.closed_at,
    'entitlement_status', v_ent.status,
    'refund_kind', v_refund.kind,
    'refund_status', v_refund.status,
    'publish_gate', v_policy.publish_gate);

  -- The amount appears only when its display is approved. This is an if-statement rather than a field
  -- set to null, which is the difference between "the projection does not carry it" and "the projection
  -- carries it and something downstream must remember not to print it".
  IF coalesce(v_pkg.display_approved, false) THEN
    v_out := v_out || jsonb_build_object(
      'price_display_enabled', true,
      'amount_minor', v_order.amount_minor,
      'currency', v_order.currency);
  ELSE
    v_out := v_out || jsonb_build_object('price_display_enabled', false);
  END IF;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION internal_api.commerce_host_summary(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.commerce_host_summary(uuid) TO authenticated;

-- ===========================================================================
-- 10. The exposed wrapper — one line of delegation
-- ===========================================================================
-- Same two-posture shape Stage 9 ships (`20261013120000_stage9_render_outputs.sql:555-631`): a
-- SECURITY DEFINER implementation that re-derives the caller, and an INVOKER wrapper whose only decision
-- is which implementation to hand its arguments to. No authorization is duplicated here.
--
-- `authenticated` only. No commerce function is granted to `anon`, and the four service bodies above
-- keep zero grants, so the anonymous surface is still exactly the doors Stages 3, 7 and 8 opened.

CREATE FUNCTION api.commerce_host_summary(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.commerce_host_summary(p_wedding_id);
$$;

REVOKE ALL ON FUNCTION api.commerce_host_summary(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.commerce_host_summary(uuid) TO authenticated;

COMMENT ON FUNCTION internal_api.commerce_host_summary(uuid) IS
  'SECURITY DEFINER. The state of this wedding''s purchase, for the owner of that wedding. Owner-only, '
  'like every other host read surface. Carries no amount while the price''s display_approved is false, and '
  'never carries live_capture_enabled or publish_required_package_codes: operational configuration is not '
  'a host''s business.';

COMMENT ON FUNCTION api.commerce_host_summary(uuid) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.commerce_host_summary. Authenticated only. A '
  'description of a purchase state, with no write path and no price to act on.';

-- ===========================================================================
-- 11. Closing notes a reader of this file should not have to infer
-- ===========================================================================
--
-- Privileges, stated once. `private` has no USAGE for anon/authenticated (`config.toml:32` exposes only
-- `public` and `api`, and `internal_api` is not in that list either), Stage 2's ALTER DEFAULT PRIVILEGES
-- gives the six new tables no client grants, this file adds none, RLS is enabled with no policy on all
-- six, and every one carries `reject_client_write` plus `reject_client_delete`. Four independent layers
-- have to fail before a browser can name a money row, which is the duplication Stage 2 accepted for
-- `audit_events` and `access_tokens` and §3 requires here.
--
-- What Stage 10 does not build, and is asserted not to have built (§12): no `paid_status` anywhere
-- (`scripts/check-db-contract.mjs:61-72` forbids the canonical column by name), no billing column on
-- `public.weddings`, no tax/GST/invoice column in any table above, no quantity column on an order or a
-- price, no DELETE path granted to any product role, and no route or handler that could receive a
-- webhook.
