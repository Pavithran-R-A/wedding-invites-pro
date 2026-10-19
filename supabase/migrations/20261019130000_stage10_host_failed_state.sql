-- Stage 10 repair 3: a host can be told that an attempt failed.
--
-- Requirement 8 of the Stage 10 work order asks for "appropriate host-side pending, failed, cancelled and
-- verified states". Three of those four existed. `payment_pending`, `cancelled` and `entitlement_active`
-- are all derivable from `private.commerce_orders.status`, and §4 of the architecture deliberately keeps
-- the *order* at `payment_pending` after a failed attempt — battery 1's C08 asserts it, because one
-- refused card is not a closed purchase and a state machine that closes orders on failures loses the
-- customer's ability to try again. That is right for the ledger and leaves the host panel with nothing to
-- say: a failed attempt and an attempt that never happened both render as "awaiting payment".
--
-- So the fourth state cannot be stored, and should not be. §2 keeps exactly one record of a right and §4
-- keeps the order's status list closed against a fifth value; the fact the host needs is already in the
-- ledger as `private.commerce_payment_attempts.status = 'failed'` with its `failed_at`. This file derives
-- it: read the order's newest attempt, and when the order is `payment_pending` while that attempt is
-- `failed`, answer `payment_attempt_failed`.
--
-- Newest, not "any": an order can carry several attempts (C10/C11 exist to prove a later success after a
-- failure is a second attempt object on the same order, not a rewrite), and the host's sentence has to
-- follow the one the customer is looking at now. `ORDER BY initiated_at DESC, created_at DESC` is the
-- existing `commerce_attempts_order_idx (order_id, initiated_at DESC)` shape
-- (20261017120000_stage10_commerce_foundations.sql:1096-1097), so this reads the ledger the way the
-- reconciliation sweep already does. Battery 2's H30..H32 pin the ordering: after a second initiation the
-- answer is `payment_pending` again, not a stale `payment_attempt_failed`.
--
-- One key is added, `attempt_status`, and nothing else. It is the attempt's own status word — the same
-- three-value vocabulary the table CHECK allows — and not a timestamp, provider reference or amount,
-- because a failure's *evidence* belongs to the ledger and §11 keeps money detail off the browser: a host
-- needs "your last attempt did not go through", and an operator who needs more has
-- `internal_api.commerce_reconcile`, which no client can call.
--
-- A forward migration rather than an edit of the Stage 10 file: that file is already applied on the
-- `localvivaahvarnam` stack and `supabase db push` compares its recorded statements, so changing it in
-- place would look like drift.
--
-- `CREATE OR REPLACE FUNCTION` keeps the object's identity, so the original file's revokes survive it (a
-- replace does not reset `proacl`). The REVOKE and the single GRANT are restated anyway: this file adds a
-- reading of a private table to a SECURITY DEFINER body that authenticated users can call, and the
-- posture — execute for `authenticated` only, nothing for `anon`, `service_role` or `PUBLIC` — should be
-- visible in the file that writes the body rather than inherited from a file a reviewer may not have open.

CREATE OR REPLACE FUNCTION internal_api.commerce_host_summary(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller  uuid;
  v_order   private.commerce_orders;
  v_att     private.commerce_payment_attempts;
  v_pkg     private.commerce_packages;
  v_ent     public.entitlements;
  v_refund  private.commerce_refunds;
  v_policy  private.commerce_policy;
  v_state   text;
  v_out     jsonb;
BEGIN
  -- Re-derived from auth.uid(), unchanged from the original: the wedding id alone is not authorisation,
  -- and adding a state must not add a way to read somebody else's purchase.
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

  -- The order's newest attempt. Absent order, absent attempt: `SELECT * INTO` a row variable with no rows
  -- leaves every field NULL rather than raising, so `v_att.status` is NULL and the arm below cannot fire
  -- for a wedding that never quoted.
  SELECT * INTO v_att FROM private.commerce_payment_attempts a
   WHERE a.order_id = v_order.id
   ORDER BY a.initiated_at DESC, a.created_at DESC
   LIMIT 1;

  SELECT * INTO v_policy FROM private.commerce_policy WHERE id = 1;

  IF v_order.id IS NOT NULL THEN
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

  -- The host's state, derived rather than stored — thirteen readings of the rows now, and still no status
  -- column anybody could write. The new arm sits above the plain `payment_pending` one, which is the whole
  -- point of it: CASE takes the first match, so an order that is pending *and* whose latest attempt failed
  -- answers with the failure, and one that is pending with any other (or no) attempt keeps the old answer.
  v_state := CASE
    WHEN v_order.id IS NULL                        THEN 'no_purchase'
    WHEN v_order.status = 'open'                   THEN 'quote_open'
    WHEN v_order.status = 'payment_pending'
         AND v_att.status = 'failed'               THEN 'payment_attempt_failed'
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
    -- The attempt's own status word: null, 'initiated', 'confirmed' or 'failed' — the vocabulary
    -- commerce_payment_attempts.status is CHECKed to. Deliberately the only thing said about the attempt:
    -- no failed_at, no provider order or payment reference, no amount. §11.
    'attempt_status', v_att.status,
    'merchant_reference', v_order.merchant_reference,
    'quote_expires_at', v_order.quote_expires_at,
    'captured_at', v_order.captured_at,
    'closed_at', v_order.closed_at,
    'entitlement_status', v_ent.status,
    'refund_kind', v_refund.kind,
    'refund_status', v_refund.status,
    'publish_gate', v_policy.publish_gate);

  -- The amount appears only when its display is approved — unchanged, and still an if-statement rather
  -- than a field set to null, which is what H28 (battery 2) proves a new state did not disturb: a failed
  -- attempt on a price that is not approved to display shows a host no figure at all.
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

COMMENT ON FUNCTION internal_api.commerce_host_summary(uuid) IS
  'SECURITY DEFINER. The state of this wedding''s purchase, for the owner of that wedding. Owner-only, '
  'like every other host read surface. Thirteen derived states, one of them — payment_attempt_failed — '
  'read from the newest payment attempt because §4 keeps the ORDER at payment_pending after a failure. '
  'Carries no amount while the price''s display_approved is false, and never carries live_capture_enabled, '
  'publish_required_package_codes, an attempt timestamp or a provider reference: operational configuration '
  'and payment evidence are not a host''s business.';
