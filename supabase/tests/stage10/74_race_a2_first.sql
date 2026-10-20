-- ARM 2 session A (the first capture). Runs concurrently with `75_race_b2_second.sql`; the counted
-- assertions live in `76_race_arm2_asserts.sql` and the shell gates this session's markers.
--
-- Advisory lock 7710 releases B the instant A's delivery *attempt* is underway, but A's transaction
-- then stays open (`A2_WINDOW`, a measured pause) so B has a real window to reach the ledger's unique
-- index while A's rows are still uncommitted — the collision this arm exists to produce. Wall clocks
-- (`clock_timestamp()`) are printed on every milestone: round 2 of the probe proved `now()` is frozen
-- at transaction start and cannot order anything, so an elapsed-second bracket on B's answer line is
-- the chronology evidence, and B's raw 23505 on its FIRST attempt is the logical proof of overlap
-- (a fully-committed A would have been answered gracefully by the idempotency pre-read instead).
BEGIN;
SELECT 'A2_LOCK=' || coalesce(pg_advisory_lock(7710)::text, '') || ' at ' ||
       (SELECT clock_timestamp()::time(0)::text);
DO $$
DECLARE v jsonb;
BEGIN
  BEGIN
    SELECT internal_api.record_commerce_event(
      'razorpay', 'r-conc-2', 'payment.candidate.payment_captured', 'payment_captured', 'synthetic',
      repeat('ef', 32), true, NULL,
      (SELECT o.merchant_reference FROM private.commerce_orders o
        WHERE o.wedding_id = '0a0a0a00-0000-4000-8000-000000000002'),
      499900, 'INR', 'po_conc2', 'pay_conc2', now(),
      '0a0a0a00-0000-4000-8000-000000000101'::uuid) INTO v;
    RAISE NOTICE 'A2_OUT=%/% at %', v ->> 'disposition',
      coalesce(v ->> 'applied_effect', '(none)'), clock_timestamp()::time(0);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'A2_OUT=RAISED % on % at %', SQLSTATE, SQLERRM, clock_timestamp()::time(0);
  END;
END $$;
SELECT 'A2_RELEASE=' || coalesce(pg_advisory_unlock(7710)::text, '') || ' at ' ||
       (SELECT clock_timestamp()::time(0)::text);
SELECT 'A2_WINDOW=' || (SELECT pg_sleep(2)::text);
COMMIT;
SELECT 'A2_COMMITTED=' || (SELECT clock_timestamp()::time(0)::text);
