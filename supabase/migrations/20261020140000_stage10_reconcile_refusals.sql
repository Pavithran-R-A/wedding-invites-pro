-- stage10: let the reconciliation sweep see, and correctly describe, an uncorrected refusal.
--
-- This file is the second half of the repair started by
-- `20261020120000_stage10_event_redelivery.sql`, and it exists because that repair changes what an
-- operator can honestly be told to do.
--
-- §10's sweep (`internal_api.commerce_reconcile`) answers one question — "is this order's money story
-- consistent?" — by reading the ledger, the order, the attempts, the refunds and the entitlement, and
-- naming findings. It changes nothing. Two of its properties stopped being true when redelivery was
-- repaired, and a third gap the original defect exploited was never covered at all:
--
--   1. Every finding queries `e.order_id = v_order.id`. A refused delivery has no `order_id`: §4.2 stops a
--      delivery whose signature did not verify before the link is resolved, so the row is written with
--      `order_id IS NULL` and what it *claims* about itself survives only in `merchant_reference`,
--      `amount_minor` and `currency` — the three columns whose whole design note says they record what a
--      delivery claimed, not what this product sells. So an unverified delivery naming a real order is
--      invisible to that order's sweep, and this was the mechanism that made the stranding silent: an
--      operator swept the poisoned order, got `finding_count = 0`, and read that as "nothing is wrong"
--      when it meant "nothing that reaches this order by its resolved link is wrong".
--
--   2. `held_event_unapplied` told the operator to "correct the facts or the price row and re-record the
--      delivery as a new event id". Two things are wrong with that sentence now. The provider owns its
--      event ids, so "re-record as a new event id" was never an instruction anyone could follow — that is
--      why the defect was unrecoverable. And after the repair, a corrected body delivered under the
--      provider's *own* identity is admitted as its own row, so the advice now points an operator away
--      from the route that exists and towards fabricating one that the provider never sent.
--
-- Both are fixed here, in the shape §10 already uses: a finding whose remedy is a real action, and an
-- advice sentence that describes the ledger as it now behaves.
--
-- What is deliberately *not* added: a finding for "one provider identity arrived with two different
-- bodies". After the repair that pair is the healthy shape of a correction, and the two states an operator
-- would want to distinguish from it are already named — the uncorrected half by `refusal_uncorrected`
-- below, and a conflicting amount by `amount_drift`, which counts held rows precisely because "a refusal
-- to apply is not a disagreement that went away". A third finding that fires on a successful recovery
-- would train its reader to ignore it, which is how an evidence surface becomes decoration.
--
-- The limitation this file cannot close, stated rather than hidden. `refusal_uncorrected` reaches a refusal
-- through the reference the refused body *claimed*, so it can only fire for a refusal row that carries one —
-- and the delivery path over a wire writes none: `scripts/stage10-commerce-driver.mjs`'s `refusedEventArgs`
-- NULLs every fact column, merchant reference included, because an unverified body gets to name nothing
-- about itself (measured at the Node tier by CD-22, which pins the whole cast-NULL argument list, and CD-23,
-- which pins that a forged body's reference and amount never reach the statement). So a refusal that
-- arrived through the instrument is invisible to every per-order sweep, and the
-- row the SQL battery's group P plants — the same verdict, with a reference — is the shape this finding can
-- actually see. What that leaves uncovered is stated exactly, because the repair on the other side of this
-- file changed which kind of gap it is: post-repair, a genuine delivery of that order's capture is admitted
-- on its own bytes and applied, so nothing is stranded and the residual loss is *awareness* — an operator
-- sweeping that order is never told a forged delivery was refused against it. Reading a reference-less
-- refusal needs a cluster-wide view of the `rejected_signature` strand, which §10 does not define and this
-- stage does not invent. The recoverability half of the defect is closed by
-- `20261020120000_stage10_event_redelivery.sql` and measured in group P; the awareness half stays open and
-- is named here rather than smoothed over.
--
-- Shape of the change: `CREATE OR REPLACE FUNCTION` of an existing body, same signature, same
-- SECURITY INVOKER posture, same `search_path = ''`, no new table, column, index, grant or exposed name.
-- The declared-surface census is therefore unchanged at 22 `api` names and 39 `internal_api` names, and
-- the sweep remains read-only about commerce state: it still writes exactly one `swept` audit row.
-- Forward-only, because a later head may have acted on a finding this body raised; replacing the body is
-- the only move that does not rewrite what was already reported.

CREATE OR REPLACE FUNCTION internal_api.commerce_reconcile(
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
      -- The remedy, stated as the ledger actually behaves. A held row is a decision already made about an
      -- arrival, and the append-only guards mean this body could not take it back even if it wanted to;
      -- so what an operator can do is wait for a *new arrival*, and the honest sentence says which arrivals
      -- are new. Same identity plus corrected bytes is a new arrival and is decided on its own (§4.2 runs
      -- again for it); the identical bytes are not, because level 1 answers them from this row. That second
      -- half is why "correct the price row" is not listed as a remedy any more: fixing the price does not
      -- re-decide a delivery, and a sentence that implied it could would send an operator to a lever that
      -- does nothing.
      'detail', v_capture || ' delivery row(s) have been held for more than fifteen minutes; only a new '
              || 'arrival is decided again — the same provider event id with a corrected body lands as its '
              || 'own row and is judged from the top, while the identical bytes are answered from the '
              || 'recorded row, so nothing here edits a held row retroactively');
  END IF;

  -- refusal_uncorrected — the blind spot in point 1 above, closed. Keyed on `merchant_reference` because a
  -- refusal has no resolved order to key on, and read as a *claim* for exactly that reason: this finding
  -- reports that an unverified body said it was about this order, and it applies nothing on the strength of
  -- that statement. The `NOT EXISTS` arm is what makes it a remedy rather than a tally: once a corrected
  -- delivery supersedes the refusal, the refusal stops being the row that owns its identity and the finding
  -- disappears on the next sweep, the way `captured_without_entitlement` disappears once the grant runs.
  SELECT count(*) INTO v_capture
    FROM private.commerce_payment_events e
   WHERE e.merchant_reference = v_order.merchant_reference
     AND e.processing_status = 'rejected_signature'
     AND NOT EXISTS (SELECT 1 FROM private.commerce_payment_events s
                      WHERE s.supersedes_event_row_id = e.id);
  IF v_capture > 0 THEN
    v_findings := v_findings || jsonb_build_object(
      'code', 'refusal_uncorrected',
      'detail', v_capture || ' unverified delivery row(s) name this order''s reference ('
              || v_order.merchant_reference || ') and none has been superseded; the reference is what that '
              || 'body claimed, not a fact this build confirmed, and the recovery is the provider '
              || 're-delivering the same event id with bytes that verify — which is recorded as its own row '
              || 'and decided again from the top');
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

-- Re-issued rather than assumed: `CREATE OR REPLACE FUNCTION` preserves the existing object's ACL, so the
-- sweep is still refused to every role a request can arrive as, including the server key, exactly as
-- §10 requires. It is restated here so this file says what the function's privileges are instead of
-- relying on a reader to have opened the earlier one.
REVOKE ALL ON FUNCTION internal_api.commerce_reconcile(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.commerce_reconcile(uuid, uuid) IS
  'Service-only. Compares the ledger, the order, the attempts, the refunds and the entitlement for one '
  'order and returns the named findings of §10. Changes no commerce state; writes one audit row recording '
  'that the sweep ran. Nothing here claims to have recovered an event that was never received. A refusal '
  'is reached through the merchant reference its own body claimed, because §4.2 resolves no order for an '
  'unverified delivery; see 20261020140000_stage10_reconcile_refusals.sql.';

COMMENT ON TABLE private.commerce_payment_events IS
  'Append-only record of every delivery this build was given, one row per (provider, event_id, '
  'raw_body_sha256, signature_valid); `supersedes_event_row_id` links a corrected delivery to the row it '
  'follows, so an identity is a line of arrivals rather than the first body that happened to land. Amount, '
  'currency and merchant reference record what the delivery claimed, not what this product sells, and a '
  'refused row''s claim is read as a claim by every query that touches it.';
