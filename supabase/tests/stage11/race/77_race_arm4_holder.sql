-- ARM 4 session A (the holder). Runs with `78_race_arm4_waiter.sql` and the driver's one-shot
-- `79_race_arm4_revoke.sql`; the counted half is `RC10`–`RC12` in `83_race_arm4_asserts.sql`.
--
-- §13's threat row is "an action against a grant revoked mid-flight", and the only way to *make* that state
-- rather than describe it is three clients: one holding the row the act will lock, one waiting on it, and one
-- taking the authority away while the second is parked. This file is the first of those.
--
-- The hold is a hand `SELECT … FOR UPDATE` on w5's active publication — the very lock the shipped takedown
-- takes at `20261020190400_stage11_takedown_and_oversight.sql:387-389`. A hand lock is honest here because
-- the holder's job is to be *some other act* that is in the row first; nothing about the arm depends on who
-- wrote the wait, and the file does not pretend an operator door produced it.
--
-- Two observations and one release, all synchronised rather than slept:
--   1. the waiter is ungranted on this transaction id (`pg_locks`, the same witness arms 1–3 use);
--   2. the revocation is a *committed* trail row naming this waiter's grant (`private.audit_events`, read in a
--      fresh statement so this transaction's snapshot is new for it);
--   only then `COMMIT`, which is what lets the waiter finish its act against an authority that no longer
--   exists. Waiting for (2) rather than for the driver's say-so is what makes the window a property of the
--   data and not of the shell's scheduling.
BEGIN;
SET search_path = public, pg_temp;
SET application_name = 's11r-arm4-holder';

CREATE FUNCTION pg_temp.s11r_waits(p_limit integer) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE i int := 0; v_any int; v_pids text;
BEGIN
  LOOP
    SELECT count(*), coalesce(string_agg(l.pid::text, ',' ORDER BY l.pid), '')
      INTO v_any, v_pids FROM pg_locks l
      WHERE l.locktype = 'transactionid' AND NOT l.granted
        AND l.transactionid = pg_current_xact_id()::xid;
    IF v_any > 0 THEN
      RETURN 'waiterpids=' || v_pids || ' txwait=' || v_any || ' after ' || i || ' polls';
    END IF;
    IF i >= p_limit THEN
      RETURN 'ARM_INVALID waiterpids=none txwait=0 after ' || p_limit || ' polls';
    END IF;
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;
END $fn$;

CREATE FUNCTION pg_temp.s11r_sees_revoke(p_user uuid, p_limit integer) RETURNS text
LANGUAGE plpgsql AS $fn$
-- The second rendezvous, and it is a data condition rather than a lock: `revoke_operator_role` writes one
-- `revoked` trail row whose payload names the account that lost the duty
-- (`20261020190000_stage11_operator_authority.sql:580-586`), and a row is only evidence once it is
-- committed. So this holds the publication row until the revocation is in the table for everyone, and a
-- timeout here says the revoke one-shot never landed — which is a broken plant, not a product refusal.
DECLARE i int := 0; v_n int;
BEGIN
  LOOP
    SELECT count(*) INTO v_n FROM private.audit_events a
      WHERE a.action = 'revoked' AND a.subject_type = 'operator_grant'
        AND a.payload ->> 'granted_user_id' = p_user::text;
    IF v_n > 0 THEN
      RETURN 'revoketrows=' || v_n || ' after ' || i || ' polls';
    END IF;
    IF i >= p_limit THEN
      RETURN 'ARM_INVALID revoketrows=0 after ' || p_limit || ' polls';
    END IF;
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;
END $fn$;

DO $h$
DECLARE v_pub public.publications; v_gate text; v_revoke text;
BEGIN
  RAISE NOTICE 'A4_STARTED=pid %', (SELECT pg_backend_pid());
  SELECT p.* INTO v_pub FROM public.publications p
   WHERE p.wedding_id = '0b0b0b00-0000-4000-8000-000000000005'::uuid AND p.status = 'active'
   FOR UPDATE OF p;
  IF v_pub.id IS NULL THEN
    RAISE NOTICE 'A4_PLANT_BROKEN=w5 has no active publication to hold';
    RAISE EXCEPTION 'FAIL arm 4: there is no publication to hold the waiter behind';
  END IF;
  -- `xact=` is the holder's own transaction id, and it is printed because it is the number the arm's whole
  -- premise turns on: the third client (`79_race_arm4_revoke.sql`) reads the waiter's ungranted lock from the
  -- other side and names the transaction id it saw. Two logs carrying the same id is what binds "the
  -- revocation was written while the act was parked on *this* lock" to a data fact rather than to the
  -- driver's ordering. An id is not evidence inside the assert files — the transaction is long gone by then,
  -- which is why the binding lives in the chronology and the effects live in the counted cells.
  RAISE NOTICE 'A4_LOCKED=pub=%/status=%/version=%/xact=%',
    v_pub.id, v_pub.status, v_pub.version_id, pg_current_xact_id();

  -- Both gates are checked before their tokens are printed, because the driver matches these lines by prefix:
  -- a value of `ARM_INVALID` under `A4_SEES_WAITER_BLOCKED=` would read as a rendezvous that never happened,
  -- and under `A4_SAW_REVOKE_COMMITTED=` the holder would release a lock whose arm had no revocation in it.
  v_gate := pg_temp.s11r_waits(600);
  IF v_gate LIKE 'ARM_INVALID%' THEN
    RAISE NOTICE 'A4_GATE_FAILED=no backend parked on this transaction: %', v_gate;
    RAISE EXCEPTION 'FAIL arm 4: the waiter never blocked on the held publication — %', v_gate;
  END IF;
  RAISE NOTICE 'A4_SEES_WAITER_BLOCKED=%', v_gate;

  v_revoke := pg_temp.s11r_sees_revoke('0b0b0b00-0000-4000-8000-000000000116'::uuid, 600);
  IF v_revoke LIKE 'ARM_INVALID%' THEN
    RAISE NOTICE 'A4_GATE_FAILED=the revocation never landed as a committed row: %', v_revoke;
    RAISE EXCEPTION 'FAIL arm 4: no committed revocation of the waiter''s grant — %', v_revoke;
  END IF;
  RAISE NOTICE 'A4_SAW_REVOKE_COMMITTED=%', v_revoke;
END $h$;

COMMIT;

DO $h$
BEGIN
  RAISE NOTICE 'A4_COMMITTED=%', (SELECT status FROM public.publications
    WHERE wedding_id = '0b0b0b00-0000-4000-8000-000000000005'::uuid);
END $h$;
