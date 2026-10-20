-- Stage 10 repair 4: a refused delivery cannot own its provider event identity for ever.
--
-- §14's finding 4 of `docs/audits/stage-10-commerce-foundations.md`, reproduced on purpose before being
-- repaired. The reproduction is group P of `supabase/tests/stage10/80_commerce_ledger.sql`; the run that
-- recorded it red is `q10-logs/s10r-P-red-2.txt`, which fails at the fourth cell of that group:
--
--   FAIL P04 a corrected delivery is recorded as a delivery, not echoed as an old row
--        — got [already_recorded] want [recorded]
--
-- The defect. Level-1 idempotency in `internal_api.record_commerce_event` looked a delivery up by
-- `(provider, event_id)` alone and returned the row it found, whatever that row had decided. So the first
-- body an event identity arrives with chooses the answer every later delivery under that identity gets.
-- Three facts compose into a strand:
--   * a refused delivery is a ledger row (`rejected_signature`, or a `held_for_reconciliation` reason),
--     because §4.2 records refusals rather than dropping them — the right posture for evidence;
--   * `commerce_payment_events` refuses UPDATE to every role, including the owner (battery 1's H13/H14),
--     so that row cannot be corrected in place;
--   * `commerce_events_provider_event_uk` made the identity globally unique per provider, so no corrected
--     row can be written either.
-- A delivery that failed verification — a rotated signing key, a body read through a proxy that reordered
-- bytes, a timestamp outside the verifier's window, a forgery that burned a real event id — therefore
-- permanently disabled the genuine capture that follows it. The order stays `open`, no attempt is minted,
-- no entitlement is granted, and the family's invitation stays unpaid for money the provider did take.
-- Worse, the answer is *misleading*: the `already_recorded` payload echoes `processing_status` from the old
-- row, so the caller is told the message it just verified failed verification.
--
-- §10's reconciler could not see it either. `held_event_unapplied` counts only
-- `held_for_reconciliation`, so a `rejected_signature` strand is invisible, and the advice the finding
-- prints — "re-record the delivery as a new event id" — asks a webhook handler for the one identifier it
-- does not own: the event id belongs to the provider.
--
-- The repair, and the key it moves to. One provider event identity no longer means one row; one provider
-- event identity *plus one body* does. The lookup now matches `(provider, event_id, raw_body_sha256,
-- signature_valid)`, which is the pair a genuine retry preserves and a corrected delivery changes. Both
-- promises survive intact: a retry still writes nothing and answers from its own row, verbatim (§4's "two
-- deliveries of one event produce one row and two identical answers", still measured by H15..H18, D12 and
-- the HTTP tier's D-02/D-11a), and a row's bytes are still never rewritten — the corrected delivery writes
-- a *new* row and names the row it follows in `supersedes_event_row_id`, so the chain is arrival order
-- without a rewrite. `already_recorded` now re-states the newest row carrying those bytes.
--
-- What the corrected row then does is decided by the machinery that already exists, not by new rules: the
-- refusal chain (§4.2) and the order's own status. That is the safety property, and it is why this repair
-- adds no branch of its own. A corrected capture with the frozen amount and currency is evaluated and
-- applied, and the grant is idempotent (`ON CONFLICT … DO NOTHING` on the entitlement), so a second
-- application cannot grant twice. A second body that disagrees about the amount is held by §4.2 rule 4, and
-- the order keeps its own price. A second body that agrees but arrives after the order was already captured
-- is answered by the state machine as `ignored_already_captured`. A conflicting payload is therefore
-- recorded and never auto-applied — the ledger keeps the disagreement and §10's `amount_drift` reports it.
--
-- Two postures taken deliberately, because the alternatives are wrong.
--   1. The answer payloads are unchanged — no `supersedes_event_row_id` key is added to what
--      `record_commerce_event` returns. The wire shape is asserted as a closed key set by the HTTP tier
--      (`ALREADY_KEYS` in `supabase/tests/api/stage10_commerce_http.test.mjs`) and read by the driver, so
--      widening it is a contract change this defect does not need: the link is evidence about the ledger,
--      and the ledger is where it is read.
--   2. No operator "redrive a held row" body is added. It would be a second implementation of "what does a
--      capture grant", sitting beside the state machine, and two implementations of that sentence is how
--      one of them drifts — plus privileged money-moving surface that would need its own grant,
--      reachability and actor-authentication qualification. Recovery is a re-delivery, which is the shape a
--      provider can actually produce and the shape this file now handles.
--
-- A forward migration rather than an edit of `20261017120000_stage10_commerce_foundations.sql`: that file
-- is already applied on the `localvivaahvarnam` stack, and `supabase db push` compares its recorded
-- statements, so changing it in place would look like drift and invite somebody to repair a schema that is
-- actually fine. `CREATE OR REPLACE FUNCTION` keeps the object's identity, so the `REVOKE ALL` the original
-- file issued for `anon`, `authenticated` and `service_role` survives it (a replace does not reset
-- `proacl`); the REVOKE is restated below anyway, because this file rewrites a service-only body and the
-- posture should be visible in the file that does it.
--
-- Concurrency, stated rather than papered over. The lookup-then-insert pair is not atomic, so two
-- simultaneous deliveries of one identity that carry different bytes can both decide to write, and the
-- loser raises 23505 on `commerce_events_provider_event_uk` and its transaction aborts — which is the
-- correct outcome, because a provider retrying an aborted delivery re-sends the same bytes and is then
-- answered `already_recorded`. What is *not* done is rescuing that loser with an exception handler: the
-- attempt row this function mints before the ledger INSERT would have to be rolled back to a savepoint, and
-- a half-rolled-back money write is a worse bug than a 23505. The invariant that makes the race harmless is
-- pinned by the two unique shapes below — at most one unsuperseded row per identity, at most one supersession
-- per row — and group P measures both as refusals. A true two-session race is not expressible inside one
-- `--single-transaction` battery; see §14's finding 2 for that gap and its disposition.

SET search_path = public, pg_temp;

-- --------------------------------------------------------------------------- the shape of the chain
ALTER TABLE private.commerce_payment_events
  ADD COLUMN supersedes_event_row_id bigint REFERENCES private.commerce_payment_events(id);

COMMENT ON COLUMN private.commerce_payment_events.supersedes_event_row_id IS
  'The ledger row this delivery follows: the newest row already recorded under the same (provider, '
  'event_id) with different bytes or a different verification verdict. NULL on the first delivery of an '
  'identity, which is the row the idempotency lookup answers a plain retry from. Not a correction of the '
  'row it points at — that row keeps its own verdict and is never rewritten (§3, ADR 0005 rule 5).';

-- A chain that points forward, or at itself, would let a row "follow" a delivery that had not arrived yet
-- and make the chain unreadable. `id` is an IDENTITY, so any row that exists when the head is looked up is
-- strictly smaller than the row being inserted; this makes that a fact rather than an artefact of ordering.
ALTER TABLE private.commerce_payment_events
  ADD CONSTRAINT commerce_events_supersedes_earlier_row_check
  CHECK (supersedes_event_row_id IS NULL OR supersedes_event_row_id < id);

-- One unsuperseded row per provider event identity: the shape the old global uniqueness had, narrowed to
-- the row that answers a retry. Keeps the name so a runbook or an assertion that reaches for
-- `commerce_events_provider_event_uk` still finds the invariant it was written about. The DROP is
-- qualified `private.` because an index lives in its table's schema and this file's search_path is
-- `public, pg_temp`.
DROP INDEX private.commerce_events_provider_event_uk;
CREATE UNIQUE INDEX commerce_events_provider_event_uk
  ON private.commerce_payment_events (provider, event_id)
  WHERE supersedes_event_row_id IS NULL;

-- A row is superseded at most once, which is what makes the chain a line and not a tree: two corrected
-- deliveries of one refusal cannot both claim to fix it, and the second gets a 23505 instead of a fork.
CREATE UNIQUE INDEX commerce_events_supersedes_uk
  ON private.commerce_payment_events (supersedes_event_row_id);

-- Both level-1 lookups — "have those bytes arrived under this identity?" and "which row does this delivery
-- follow?" — filter on `(provider, event_id)`, and the first orders by `id`. The replacement unique index
-- cannot serve either (its predicate is not implied by either query), so without this the ledger would be
-- scanned in full for every webhook. Ledger rows are append-only and never deleted, so the scan would grow
-- for as long as the deployment does.
CREATE INDEX commerce_events_provider_event_lookup_idx
  ON private.commerce_payment_events (provider, event_id, raw_body_sha256, id DESC);

CREATE OR REPLACE FUNCTION internal_api.record_commerce_event(
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
  v_supersedes  bigint;
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
  --
  -- Keyed on the bytes as well as the identity, which is the pair a retry preserves and a corrected
  -- delivery changes. `(provider, event_id)` alone made the first body an id arrives with the only body it
  -- would ever have here, and because the ledger refuses UPDATE and the identity index was global, a
  -- refused delivery poisoned the identity: the genuine capture that followed was answered with the
  -- forgery's verdict and the order could never be captured. §14's finding 4; group P of battery 1.
  --
  -- `ORDER BY id DESC` answers from the newest row carrying those bytes, so a delivery that flapped
  -- refused/correct/refused is described by the row that matches what the provider just sent.
  SELECT * INTO v_prev FROM private.commerce_payment_events e
   WHERE e.provider = p_provider AND e.event_id = btrim(p_event_id)
     AND e.raw_body_sha256 = p_raw_body_sha256
     AND e.signature_valid = p_delivery_verified
   ORDER BY e.id DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'disposition', 'already_recorded',
      'event_row_id', v_prev.id,
      'processing_status', v_prev.processing_status,
      'applied_effect', v_prev.applied_effect,
      'hold_reason', v_prev.hold_reason,
      'order_id', v_prev.order_id);
  END IF;

  -- Those bytes have not arrived under this identity before, so this delivery is either the first to
  -- arrive or a correction of one that did. `supersedes_event_row_id` records which, by naming the newest
  -- row already filed under the identity — arrival order as data, with no row rewritten. Nothing else in
  -- this function reads it: the refusal chain and the state machine below evaluate this delivery exactly as
  -- they would evaluate a delivery of an identity never seen, which is what keeps the money safe. Two
  -- shapes follow from that and are asserted in battery 1's group P: a corrected capture of a refusal is
  -- applied once, and a second body that disagrees about the amount is held by §4.2 rule 4 rather than
  -- applied, because the order's frozen quote is the reference on both paths.
  SELECT max(e.id) INTO v_supersedes FROM private.commerce_payment_events e
   WHERE e.provider = p_provider AND e.event_id = btrim(p_event_id);

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
    refusal_reason, hold_reason, processing_status, applied_effect, occurred_at, received_at,
    supersedes_event_row_id)
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
    p_occurred_at, v_now,
    -- NULL on the first delivery of an identity; otherwise the row this one follows. See the level-1
    -- comment above: this is arrival order as data, and the row it names keeps its own verdict.
    v_supersedes)
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
  'provider-event level by unique (provider, event_id, raw_body_sha256, signature_valid) — one identity '
  'plus one body, so a retry answers from its own row and a corrected delivery under an identity a '
  'refusal once owned is recorded and evaluated rather than echoed — and at the business-order level by '
  'the row''s own status. Refuses to apply an unverified body, a live delivery while live capture is off, an '
  'unrecognised reference, an amount that disagrees with the frozen quote, a cross-provider confirmation '
  'and an event older than the last one applied. Returns the answer rather than raising, because a '
  'provider retry must be answered 2xx with the first delivery''s outcome. See '
  '20261020120000_stage10_event_redelivery.sql.';

COMMENT ON TABLE private.commerce_payment_events IS
  'The append-only ledger required by ADR 0005 rule 5: what arrived, whether it verified, what this '
  'build did about it. Refused deliveries are recorded too, which is the only reason a replay or a '
  'forgery is answerable afterwards. UPDATE is refused for every role. No provider payload is stored. '
  'One row per (provider, event_id, raw_body_sha256, signature_valid); `supersedes_event_row_id` links a '
  'corrected delivery to the row it follows, so an identity is a line of arrivals rather than the first '
  'body that happened to land.';
