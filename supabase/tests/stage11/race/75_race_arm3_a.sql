-- ARM 3 session A (the act that wins one key). The peer of `76_race_arm3_b.sql`; the counted half of this
-- pair is `RD02` in `84_race_replay_asserts.sql`, and the *serial* half of the same rule is `RD03`.
--
-- Two different weddings, two different operators, two different authorising tickets — and one idempotency
-- key. Nothing in the two acts shares a row until the trail insert itself, so this is the arm that tests the
-- claim §13's replay row makes about the index rather than about the body: `audit_events` carries
-- `audit_events_one_row_per_idempotency_key`
-- (`20261020190000_stage11_operator_authority.sql:246`), and a key namespace is only "one namespace" if a
-- second inserter is stopped by it when no lock, no pre-read and no state check stopped it first.
--
-- The pre-read cannot help here, and that is the interesting part. A's trail row is written but uncommitted
-- while B runs, and B is READ COMMITTED, so B's `SELECT … WHERE idempotency_key = …`
-- (`20261020190400_stage11_takedown_and_oversight.sql:372-373`) sees nothing and does not replay; B does the
-- whole act on its own wedding — revokes, invalidates, appends — and only then reaches the INSERT that the
-- index refuses. So the loser's effects are not prevented, they are *undone*, and `RD01` reads the wedding
-- afterwards to prove the undo is complete rather than assuming it.
BEGIN;
SET search_path = public, pg_temp;
SET application_name = 's11r-arm3-a';

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
-- The same observation as the arm 1 and arm 2 pair: a blocked unique-index insertion looks identical to a
-- blocked `SELECT … FOR UPDATE` in `pg_locks` — `locktype='transactionid'`, ungranted, on the winner's xid —
-- so one helper covers both shapes and neither arm has to guess which one it caused.
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
  RAISE NOTICE 'A3_STARTED=pid %', (SELECT pg_backend_pid());
  RAISE NOTICE 'A3_PRE=%', (SELECT 'pub=' || p.status || ' keyrows='
      || (SELECT count(*) FROM private.audit_events a
           WHERE a.idempotency_key = '0b0b0b00-0000-4000-8000-000000000304'::text)
      || ' w4pub=' || (SELECT q.status FROM public.publications q
           WHERE q.wedding_id = '0b0b0b00-0000-4000-8000-000000000004'::uuid)
    FROM public.publications p
   WHERE p.wedding_id = '0b0b0b00-0000-4000-8000-000000000003'::uuid);

  v_ans := pg_temp.s11r_act('0b0b0b00-0000-4000-8000-000000000114'::uuid,
    'SELECT api.operator_takedown_publication('
    || '''0b0b0b00-0000-4000-8000-000000000003''::uuid, '
    || quote_literal((SELECT c.case_ref FROM private.support_cases c
                      WHERE c.id = '0b0b0b00-0000-4000-8000-000000000904'::uuid)) || ', '
    || '''safety'', '
    || '''0b0b0b00-0000-4000-8000-000000000304''::uuid)');
  IF v_ans LIKE 'RAISED %' THEN
    RAISE NOTICE 'A3_PLANT_BROKEN=%', v_ans;
    RAISE EXCEPTION 'FAIL arm 3: the key winner was refused — %', v_ans;
  END IF;
  v := v_ans::jsonb;
  RAISE NOTICE 'A3_APPLIED=replayed=%/tokens=%/outputs=%/audit_id=%',
    v ->> 'replayed', v ->> 'credentials_revoked', v ->> 'outputs_invalidated', v ->> 'audit_id';
  -- The gate's value is tested before its token is printed: `run.sh` matches this line by prefix, so an
  -- `ARM_INVALID` travelling under `A3_SEES_B_BLOCKED=` would let a non-interleaved pair read as a collision
  -- that the unique index serialised.
  v_gate := pg_temp.s11r_waits('s11r-arm3-b', 600);
  IF v_gate LIKE 'ARM_INVALID%' THEN
    RAISE NOTICE 'A3_GATE_FAILED=the peer never parked on this transaction: %', v_gate;
    RAISE EXCEPTION 'FAIL arm 3: session B never blocked on A''s transaction id — %', v_gate;
  END IF;
  RAISE NOTICE 'A3_SEES_B_BLOCKED=%', v_gate;
END $a$;

COMMIT;

-- The winner's own committed state. `RD01` re-measures the *loser's* wedding and `RD02` the winner's payload,
-- both from a fresh backend; this line is the chronology half, printed and never counted.
DO $a$
BEGIN
  RAISE NOTICE 'A3_COMMITTED=%', (SELECT 'keyrows=' || count(*) || ' w3pub=' ||
    (SELECT status FROM public.publications
      WHERE wedding_id = '0b0b0b00-0000-4000-8000-000000000003'::uuid)
    FROM private.audit_events a
   WHERE a.idempotency_key = '0b0b0b00-0000-4000-8000-000000000304'::text);
END $a$;
