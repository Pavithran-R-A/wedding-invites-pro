-- ARM 2 session B (the colliding duplicate): the same provider, event id, digest, verdict, amount,
-- currency and refs A just delivered, arriving while A's transaction is still open.
--
-- ATTEMPT1 is expected to be *answered by the database*, not by the ledger's idempotency pre-read:
-- the pre-read cannot see A's uncommitted rows, and the first unique index the write path hits is
-- `commerce_attempts_payment_ref_uk`, which raises a raw 23505. That is the sharp edge §19 records —
-- a gateway would see a 500, and the provider's retry is what the second attempt here emulates.
-- ATTEMPT2 must converge: A has committed by now, so the pre-read finds the identity and answers
-- `already_recorded`, echoing the first delivery's effect without re-applying it.
--
-- The start/end wall clocks bracket ATTEMPT1: when they show elapsed seconds, the block sat across
-- A's open transaction; the 23505 itself is proof of overlap regardless of clock granularity.
SET application_name = 's10race_b2';
BEGIN;
SELECT 'B2_GATE=' || coalesce(pg_advisory_lock(7710)::text, '') || ' at ' ||
       (SELECT clock_timestamp()::time(0)::text);
DO $$
DECLARE v jsonb; t0 time;
BEGIN
  t0 := clock_timestamp()::time(0);
  BEGIN
    SELECT internal_api.record_commerce_event(
      'razorpay', 'r-conc-2', 'payment.candidate.payment_captured', 'payment_captured', 'synthetic',
      repeat('ef', 32), true, NULL,
      (SELECT o.merchant_reference FROM private.commerce_orders o
        WHERE o.wedding_id = '0a0a0a00-0000-4000-8000-000000000002'),
      499900, 'INR', 'po_conc2', 'pay_conc2', now(),
      '0a0a0a00-0000-4000-8000-000000000101'::uuid) INTO v;
    RAISE NOTICE 'B2_ATTEMPT1=%/% start=% end=%', v ->> 'disposition',
      coalesce(v ->> 'applied_effect', '(none)'), t0, clock_timestamp()::time(0);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'B2_ATTEMPT1=RAISED % on % start=% end=%', SQLSTATE, SQLERRM, t0,
      clock_timestamp()::time(0);
  END;
END $$;
DO $$
DECLARE v jsonb; t0 time;
BEGIN
  t0 := clock_timestamp()::time(0);
  BEGIN
    SELECT internal_api.record_commerce_event(
      'razorpay', 'r-conc-2', 'payment.candidate.payment_captured', 'payment_captured', 'synthetic',
      repeat('ef', 32), true, NULL,
      (SELECT o.merchant_reference FROM private.commerce_orders o
        WHERE o.wedding_id = '0a0a0a00-0000-4000-8000-000000000002'),
      499900, 'INR', 'po_conc2', 'pay_conc2', now(),
      '0a0a0a00-0000-4000-8000-000000000101'::uuid) INTO v;
    RAISE NOTICE 'B2_ATTEMPT2=%/% start=% end=%', v ->> 'disposition',
      coalesce(v ->> 'applied_effect', '(none)'), t0, clock_timestamp()::time(0);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'B2_ATTEMPT2=RAISED % on % start=% end=%', SQLSTATE, SQLERRM, t0,
      clock_timestamp()::time(0);
  END;
END $$;
COMMIT;
SELECT 'B2_COMMITTED=' || (SELECT clock_timestamp()::time(0)::text);
