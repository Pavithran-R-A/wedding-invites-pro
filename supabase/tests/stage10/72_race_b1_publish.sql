-- ARM 1 session B (the publisher). Blocks on advisory lock 7700 until A1's `entitlement_required`
-- flip is written-but-uncommitted, then publishes an un-entitled wedding through the real
-- `publications_commerce_publish_gate` trigger and holds 7701 after the INSERT so A1's pg_locks poll
-- can see the publish actually ran inside the window (see `71_race_a1_flip.sql` for why the announce
-- is held rather than symmetric).
--
-- `B1_POLICY_SEEN_BY_THIS_TX` is the direct evidence line: under READ COMMITTED this session still
-- reads `permissive` while A1's flip is written, because the gate reads the last-committed policy and
-- was never designed to see an in-flight one. ON_ERROR_STOP is on, so the publish is wrapped — a
-- refusal here is a finding, and the shell's marker gate reads which branch happened.
\set ON_ERROR_STOP on
BEGIN;
SELECT 'B1_GATE=' || coalesce(pg_advisory_lock(7700)::text, '') || ' at ' ||
       (SELECT clock_timestamp()::time(0)::text);
SELECT 'B1_POLICY_SEEN_BY_THIS_TX=' || publish_gate
  FROM private.commerce_policy WHERE id = 1;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.publications (wedding_id, version_id, status)
    SELECT w.id, ver.id, 'active'
      FROM public.weddings w JOIN public.invitation_versions ver ON ver.wedding_id = w.id
     WHERE w.id = '0a0a0a00-0000-4000-8000-000000000001'::uuid;
    RAISE NOTICE 'B1_OUTCOME=ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'B1_OUTCOME=REFUSED % | %', SQLSTATE, SQLERRM;
  END;
END $$;
SELECT 'B1_ROWCOUNT_IN_OWN_TX=' || count(*)::text FROM public.publications
 WHERE wedding_id = '0a0a0a00-0000-4000-8000-000000000001';
SELECT 'B1_ANNOUNCE=' || coalesce(pg_advisory_lock(7701)::text, '') || ' at ' ||
       (SELECT clock_timestamp()::time(0)::text);
SELECT 'B1_HOLD=' || (SELECT pg_sleep(0.3)::text);
SELECT 'B1_RELEASE=' || coalesce(pg_advisory_unlock(7701)::text, '') || ' at ' ||
       (SELECT clock_timestamp()::time(0)::text);
COMMIT;
SELECT 'B1_COMMITTED at ' || (SELECT clock_timestamp()::time(0)::text);
