-- ARM 1 session A (the flipper). Runs concurrently with `72_race_b1_publish.sql`; neither is a
-- `suite()` target — the counted assertions live in `73_race_arm1_asserts.sql`, and the shell gates
-- this session's markers.
--
-- The ordering problem this file exists to solve: if A commits before B's publish, B simply reads the
-- committed gate and refuses, which is the safe case and proves nothing. So a session-scoped advisory
-- lock 7700 holds B at its first statement until the flip is WRITTEN (uncommitted), and B then *holds*
-- 7701 after its publish INSERT while A polls `pg_locks` for another pid holding it. A plain second
-- `pg_advisory_lock` rendezvous cannot replace the poll: whoever arrives first wins it, and A (already
-- running) wins almost always — that flaw was measured in the round-1 probe before this shape was
-- adopted. When A commits, B's gate decision has provably already run against the pre-flip committed
-- value; `B1_POLICY_SEEN_BY_THIS_TX=permissive` is B's own statement of reading a stale policy.
BEGIN;
SELECT 'A1_LOCKED=' || coalesce(pg_advisory_lock(7700)::text, '') || ' at ' ||
       (SELECT clock_timestamp()::time(0)::text);
UPDATE private.commerce_policy
   SET publish_gate = 'entitlement_required',
       publish_required_package_codes = ARRAY['QCLASSIC']
 WHERE id = 1;
SELECT 'A1_FLIP_WRITTEN=' || (SELECT publish_gate FROM private.commerce_policy WHERE id = 1);
SELECT 'A1_RELEASE=' || coalesce(pg_advisory_unlock(7700)::text, '') || ' at ' ||
       (SELECT clock_timestamp()::time(0)::text);
DO $$
DECLARE i int := 0;
BEGIN
  WHILE i < 600 LOOP
    IF EXISTS (SELECT 1 FROM pg_locks
                WHERE locktype = 'advisory' AND classid = 0 AND objid = 7701
                  AND pid <> pg_backend_pid()) THEN
      RAISE NOTICE 'A1_SEES_B1_HOLDING_ANNOUNCE after % polls', i;
      RETURN;
    END IF;
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;
  RAISE NOTICE 'A1_B1_NEVER_ANNOUNCED (timeout after 600 polls) — arm invalid';
END $$;
COMMIT;
SELECT 'A1_COMMITTED=' || (SELECT publish_gate || '/' ||
       coalesce(array_to_string(publish_required_package_codes, ','), '(none)')
  FROM private.commerce_policy WHERE id = 1) || ' at ' ||
       (SELECT clock_timestamp()::time(0)::text);
