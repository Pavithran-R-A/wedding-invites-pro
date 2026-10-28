-- ARM 2 session A (the first delivery of one key). The peer of `74_race_arm2_b.sql`; the counted half of
-- this pair is `RC07`–`RC09` in `82_race_arm1_asserts.sql`.
--
-- One operator, one wedding, one authorising ticket and one idempotency key, delivered twice at once — the
-- double-click shape §6 refuses to turn into two acts. A applies under key …0303 and holds. The driver
-- starts B only after `A2_APPLIED=`, and A does not release until it has seen B ungranted on its own
-- transaction id, so the second delivery provably entered the body while the first one's trail row was
-- still invisible to every snapshot but its own.
--
-- What that makes B answer is the interesting part, and it is not a 23505: the body reads its authorising
-- case with `FOR UPDATE OF c` *before* it pre-reads the key
-- (`20261020190400_stage11_takedown_and_oversight.sql:361` through `:372`, and
-- `20261020190400_stage11_takedown_and_oversight.sql:237-240` for the lock itself), so the case row is the
-- queue and the pre-read runs after it. The key index is the backstop for the shape where nothing is
-- shared, which is arm 3.
BEGIN;
SET search_path = public, pg_temp;
SET application_name = 's11r-arm2-a';

CREATE FUNCTION pg_temp.s11r_act(p_uid uuid, p_stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_uid::text, false);
  PERFORM set_config('test.role', 'authenticated', false);
  BEGIN
    EXECUTE p_stmt INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('test.uid', '', false);
    RETURN 'RAISED ' || SQLSTATE || ' | ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.uid', '', false);
  RETURN v::text;
END $fn$;

CREATE FUNCTION pg_temp.s11r_waits(p_peer text, p_limit integer) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE i int := 0; v_tx int; v_any int; v_peer int;
BEGIN
  LOOP
    SELECT count(*) INTO v_any FROM pg_locks l
      WHERE l.locktype = 'transactionid' AND NOT l.granted
        AND l.transactionid = pg_current_xact_id()::text;
    SELECT count(*) INTO v_tx FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'transactionid' AND NOT l.granted
        AND l.transactionid = pg_current_xact_id()::text AND a.application_name = p_peer;
    SELECT count(*) INTO v_peer FROM pg_stat_activity a WHERE a.application_name = p_peer;
    IF v_tx > 0 THEN
      RETURN 'txwait=' || v_tx || ' anywait=' || v_any || ' peerseen=' || v_peer
             || ' after ' || i || ' polls';
    END IF;
    IF i >= p_limit THEN
      RETURN 'ARM_INVALID txwait=0 anywait=' || v_any || ' peerseen=' || v_peer
             || ' after ' || p_limit || ' polls';
    END IF;
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;
END $fn$;

DO $a$
DECLARE v_ans text; v jsonb; v_gate text;
BEGIN
  RAISE NOTICE 'A2_STARTED=pid %', (SELECT pg_backend_pid());
  v_ans := pg_temp.s11r_act('0b0b0b00-0000-4000-8000-000000000113'::uuid,
    'SELECT api.operator_takedown_publication('
    || '''0b0b0b00-0000-4000-8000-000000000002''::uuid, '
    || quote_literal((SELECT c.case_ref FROM private.support_cases c
                      WHERE c.id = '0b0b0b00-0000-4000-8000-000000000903'::uuid)) || ', '
    || '''legal'', '
    || '''0b0b0b00-0000-4000-8000-000000000303''::uuid)');
  IF v_ans LIKE 'RAISED %' THEN
    RAISE NOTICE 'A2_PLANT_BROKEN=%', v_ans;
    RAISE EXCEPTION 'FAIL arm 2: the first delivery was refused — %', v_ans;
  END IF;
  v := v_ans::jsonb;
  RAISE NOTICE 'A2_APPLIED=replayed=%/tokens=%/outputs=%/audit_id=%',
    v ->> 'replayed', v ->> 'credentials_revoked', v ->> 'outputs_invalidated', v ->> 'audit_id';
  -- The gate is checked before its own token is printed, in every holder of this tier, for one instrument
  -- reason: `run.sh`'s marker matches this line's prefix, so an `ARM_INVALID` that travelled under
  -- `A2_SEES_B_BLOCKED=` would let a pair that never interleaved read as a pair that serialised.
  v_gate := pg_temp.s11r_waits('s11r-arm2-b', 600);
  IF v_gate LIKE 'ARM_INVALID%' THEN
    RAISE NOTICE 'A2_GATE_FAILED=the peer never parked on this transaction: %', v_gate;
    RAISE EXCEPTION 'FAIL arm 2: session B never blocked on A''s transaction id — %', v_gate;
  END IF;
  RAISE NOTICE 'A2_SEES_B_BLOCKED=%', v_gate;
END $a$;

COMMIT;

DO $a$
BEGIN
  RAISE NOTICE 'A2_COMMITTED=%', (SELECT 'keyrows=' || count(*)
    FROM private.audit_events a
   WHERE a.idempotency_key = '0b0b0b00-0000-4000-8000-000000000303'::text);
END $a$;
