-- ARM 4's third client: the hand that takes the authority away *while the act is parked*. It is not a session
-- in the arms' sense — it opens, writes, commits and exits — but the driver starts it the same way, gated on
-- its own marker, because its commit is the event `77_race_arm4_holder.sql` waits for before it releases the
-- publication row. The counted half of the whole arm is `RC10`–`RC12` in `83_race_arm4_asserts.sql`.
--
-- Why this has to be a third connection at all: the arm's subject is an act whose authority is removed
-- mid-flight, and the removal cannot come from either party inside the act. `internal_api.revoke_operator_role`
-- is revoked from `anon`, `authenticated`, `service_role` and PUBLIC
-- (`20261020190000_stage11_operator_authority.sql:601-602`), so the waiter cannot revoke itself and the holder
-- has no reason to. This file therefore runs on the driver's own connection — the same trusted hand
-- `70_race_fixtures.sql` uses for its pre-arm revocation, which is also why the grant exists in the revoked
-- state at all. That is a premise of the arm rather than a shortcut: an operator door did not produce the
-- mid-flight event, and nothing in the counted cells claims one did.
--
-- The ordering is an observation, not a schedule. This file will not write the revocation until it has *seen*,
-- from its own snapshot of `pg_locks`, that the waiter is ungranted on a transaction id, and it prints that id
-- in `R4_SEES_WAITER_BLOCKED=`. The holder prints its own transaction id in `A4_LOCKED=…/xact=…`. When the two
-- logs name the same id, the statement "the revocation was written while the act was waiting on the held
-- publication row" is supported by Postgres' own lock table from two sides, and the only remaining step — that
-- the holder releases only after this commit is readable — is the holder's own second gate. If the ids differ,
-- the arm has not interleaved the way its header says, and that is what the assert file's prose will be wrong
-- about; the numbers would still be true of a different sequence.
BEGIN;
SET search_path = public, pg_temp;
SET application_name = 's11r-arm4-revoke';

CREATE FUNCTION pg_temp.s11r_peer_waits(p_peer text, p_limit integer) RETURNS text
LANGUAGE plpgsql AS $fn$
-- The same witness arms 1–4 use inside the holder, read from outside it: how many transactions this named
-- backend is ungranted on, and *which* ids those are. The ids come back as text because they are the thing
-- the holder's log is compared against. `peerseen` again distinguishes "the stats view has not published this
-- backend yet" from "this backend is not waiting", so a timeout is diagnosable rather than merely red.
DECLARE i int := 0; v_tx int; v_ids text; v_seen int;
BEGIN
  LOOP
    SELECT count(*), string_agg(DISTINCT l.transactionid::text, ',')
      INTO v_tx, v_ids
      FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
     WHERE l.locktype = 'transactionid' AND NOT l.granted AND a.application_name = p_peer;
    SELECT count(*) INTO v_seen FROM pg_stat_activity a WHERE a.application_name = p_peer;
    IF v_tx > 0 THEN
      RETURN 'txwait=' || v_tx || ' xid=' || coalesce(v_ids, 'NULL')
             || ' peerseen=' || v_seen || ' after ' || i || ' polls';
    END IF;
    IF i >= p_limit THEN
      RETURN 'ARM_INVALID txwait=0 peerseen=' || v_seen || ' after ' || p_limit || ' polls';
    END IF;
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;
END $fn$;

DO $r$
DECLARE v jsonb; v_gate text; v_live int;
BEGIN
  RAISE NOTICE 'R4_STARTED=pid %', (SELECT pg_backend_pid());

  -- The premise, read before any write: exactly one *active* `operations` grant for the waiter's account. If
  -- that is not true here, the revocation below refuses with `no active operations grant … to revoke` and the
  -- arm reports a plant failure instead of silently measuring a second refusal.
  SELECT count(*) INTO v_live FROM private.operator_grants g
    WHERE g.user_id = '0b0b0b00-0000-4000-8000-000000000116'::uuid
      AND g.scope = 'operations' AND g.status = 'active';
  IF v_live <> 1 THEN
    RAISE NOTICE 'R4_PLANT_BROKEN=active operations grant rows=%', v_live;
    RAISE EXCEPTION 'FAIL arm 4: the waiter holds % active operations grants, expected 1', v_live;
  END IF;

  -- Do not write until the act is provably parked. The limit is shorter than the holder's own two gates on
  -- purpose: this is the client whose failure should surface first, because the holder's second gate can only
  -- time out as a consequence of this one.
  v_gate := pg_temp.s11r_peer_waits('s11r-arm4-waiter', 400);
  IF v_gate LIKE 'ARM_INVALID%' THEN
    RAISE NOTICE 'R4_GATE_FAILED=the act never reached a lock wait: %', v_gate;
    RAISE EXCEPTION 'FAIL arm 4: the waiter never blocked, so there was no mid-flight to revoke into — %',
      v_gate;
  END IF;
  RAISE NOTICE 'R4_SEES_WAITER_BLOCKED=%', v_gate;

  v := internal_api.revoke_operator_role(
    '0b0b0b00-0000-4000-8000-000000000116'::uuid,
    'operations',
    'race tier arm 4: the duty is withdrawn while a takedown of w5 waits on the publication row, to measure '
      || 'whether the act re-reads its own authority after the wait',
    '0b0b0b00-0000-4000-8000-000000000101'::uuid);
  RAISE NOTICE 'R4_REVOKED=grant_id=%/status=%/revoked_at=%/audit_id=%',
    v ->> 'grant_id', v ->> 'status', v ->> 'revoked_at', v ->> 'audit_id';
END $r$;

COMMIT;

-- After the commit, from a fresh transaction: what the rest of the tier can now see. Printed, never counted —
-- `RC10` re-reads both halves in the assert session.
DO $r$
BEGIN
  RAISE NOTICE 'R4_COMMITTED=%', (SELECT 'grant=' || g.status
      || ' revoked_at_set=' || (g.revoked_at IS NOT NULL)::text
    FROM private.operator_grants g
   WHERE g.user_id = '0b0b0b00-0000-4000-8000-000000000116'::uuid AND g.scope = 'operations');
  RAISE NOTICE 'R4_TRAIL=%', (SELECT 'revoketrows=' || count(*)
    FROM private.audit_events a
   WHERE a.action = 'revoked' AND a.subject_type = 'operator_grant'
     AND a.payload ->> 'granted_user_id' = '0b0b0b00-0000-4000-8000-000000000116'::text);
  RAISE NOTICE 'R4_ENDED=committed';
END $r$;
