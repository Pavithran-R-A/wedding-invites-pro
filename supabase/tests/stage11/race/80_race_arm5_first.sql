-- ARM 5 session A (the first tab). Runs concurrently with `81_race_arm5_second.sql`; the counted half is
-- `RD06` in `84_race_replay_asserts.sql`.
--
-- `private.mint_support_case_seq` says what it expects to happen when two writers append to one thread at
-- once (`20261020190100_stage11_support_cases.sql:399-401`): "two sessions appending to the same thread at
-- once compute the same seq and one of them is refused by the unique index above … and the race tier names
-- it". Until this file that promise had no instrument. Naming it honestly needs the *shape* of the promise
-- kept, so this arm states which writer it is: the collision is reachable by a writer that does not lock the
-- case row first, and every shipped door does lock it (`operator_add_case_note` takes `FOR UPDATE OF c` at
-- `20261020190100_stage11_support_cases.sql:1063`, and the takedown's own `operation_link` row rides behind
-- `operator_authorising_case`'s lock). So the two sessions here write on the trusted channel — the same
-- channel `70_race_fixtures.sql` plants its rows on, permitted by `private.reject_client_write`'s `postgres`
-- branch (`20260925120000_stage2_privilege_baseline.sql:141-146`) — and the arm measures the index as the last
-- line for a writer that bypasses the doors. `RD06` then measures the door's half on the same thread,
-- serially: after the collision refused, a real append still mints a fresh ordinal rather than reusing one.
--
-- Why neither session blocks on the case row: a child INSERT takes `FOR KEY SHARE` on its parent, and `FOR
-- KEY SHARE` is compatible with itself. Two hand appenders to one case therefore hold no lock against each
-- other, both compute `max(seq)+1` from a snapshot that does not contain the peer's uncommitted row, and the
-- serialisation happens at `support_case_events_seq_per_case_uniq` — which is precisely the lock this arm
-- waits for, and `A5_SEES_B_BLOCKED=` is Postgres' own statement that it happened.
BEGIN;
SET search_path = public, pg_temp;
SET application_name = 's11r-arm5-first';

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
DECLARE v_id bigint; v_seq int; v_pre text; v_gate text;
BEGIN
  RAISE NOTICE 'A5_STARTED=pid %', (SELECT pg_backend_pid());
  -- The thread as this session sees it, before appending: empty. If it already carried a row, the ordinal
  -- this file mints would not be the one `RD06` expects and the collision would be an artefact of the plant.
  SELECT 'threadrows=' || count(*) || ' maxseq=' || coalesce(max(seq)::text, 'none')
    INTO v_pre FROM private.support_case_events
     WHERE case_id = '0b0b0b00-0000-4000-8000-000000000909'::uuid;
  RAISE NOTICE 'A5_PRE=%', v_pre;
  IF v_pre <> 'threadrows=0 maxseq=none' THEN
    RAISE NOTICE 'A5_PLANT_BROKEN=ticket 0909''s thread is not empty: %', v_pre;
    RAISE EXCEPTION 'FAIL arm 5: the thread was not planted empty — %', v_pre;
  END IF;

  INSERT INTO private.support_case_events
      (case_id, kind, actor_user_id, actor_kind, idempotency_key, body)
    VALUES ('0b0b0b00-0000-4000-8000-000000000909'::uuid, 'message_operator',
            '0b0b0b00-0000-4000-8000-000000000119'::uuid, 'operator',
            '0b0b0b00-0000-4000-8000-000000000307'::uuid,
            'arm 5 first tab: a note written while the second tab was already computing its ordinal')
  RETURNING id, seq INTO v_id, v_seq;
  RAISE NOTICE 'A5_APPLIED=row=%/seq=%', v_id, v_seq;

  v_gate := pg_temp.s11r_waits('s11r-arm5-second', 600);
  IF v_gate LIKE 'ARM_INVALID%' THEN
    RAISE NOTICE 'A5_GATE_FAILED=the peer never parked on this transaction: %', v_gate;
    RAISE EXCEPTION 'FAIL arm 5: session B never blocked on the ordinal A holds — %', v_gate;
  END IF;
  RAISE NOTICE 'A5_SEES_B_BLOCKED=%', v_gate;
END $a$;

COMMIT;

DO $a$
BEGIN
  RAISE NOTICE 'A5_COMMITTED=%', (SELECT 'threadrows=' || count(*)
      || ' seqs=' || coalesce(string_agg(seq::text, ',' ORDER BY seq), 'none')
      || ' keyrows=' || count(*) FILTER (WHERE idempotency_key IS NOT NULL)
    FROM private.support_case_events
   WHERE case_id = '0b0b0b00-0000-4000-8000-000000000909'::uuid);
END $a$;
