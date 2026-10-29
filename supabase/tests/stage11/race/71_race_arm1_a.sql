-- ARM 1 session A (the first operator). Runs concurrently with `72_race_arm1_b.sql`; neither is a `suite()`
-- target — the counted assertions live in `82_race_arm1_asserts.sql`, and the shell gates this session's
-- markers.
--
-- What this session arranges, and how it is proved rather than hoped for: A delivers a real takedown of w1
-- under key …0301 and *holds*, so B meets a written-but-uncommitted revocation. The driver starts B only
-- after A's `A1_APPLIED=`, and A then polls `pg_locks` until another backend is ungranted on **A's own
-- transaction id** — which is Postgres' own statement that someone is waiting for A, not a guess about a
-- schedule — and the driver binds the pid A saw to the pid B printed about itself, which is what makes that
-- someone B rather than an unrelated client. Only then does A commit. So B's decision point provably ran
-- against the pre-commit state, and the row B's `FOR UPDATE` finally returns is the one A committed, which is
-- what makes the shipped `v_pub.id IS NULL` branch (`20261020190400_stage11_takedown_and_oversight.sql:390-393`) the answer
-- instead of a second revocation.
--
-- No advisory lock appears anywhere in this tier, deliberately: Stage 10's 7700/7701 rendezvous solved a
-- different problem (an uncommitted *policy* flip whose reader takes no row lock), and here the row lock the
-- product already takes is the synchronisation. Adding a second lock would let the arm pass while the
-- product's own serialisation went unobserved — and it would put this tier's lock ids in the same namespace
-- as Stage 10's, so a pair from the two tiers running against one cluster would collide with each other
-- rather than with the code under test.
BEGIN;
SET search_path = public, pg_temp;
SET application_name = 's11r-arm1-a';

-- The per-session helpers, repeated in every file in this directory because `pg_temp` is one backend's
-- namespace and a helper the peer cannot see is a helper nobody shares.
CREATE FUNCTION pg_temp.s11r_act(p_uid uuid, p_stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
-- A door called as a caller, with its answer *or its refusal* returned as one line. Raising instead would
-- abort this session's transaction and destroy the interleaving the arm exists to observe; `SET ROLE` plus
-- the `test.uid` shim is the shape every Stage 11 battery uses, and the role is reset on both exits.
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

CREATE FUNCTION pg_temp.s11r_waits(p_limit integer) RETURNS text
LANGUAGE plpgsql AS $fn$
-- The rendezvous, spelled as an observation: `txwait` counts backends ungranted on *this* transaction id and
-- `waiterpids` names them, which is what both a blocked `SELECT … FOR UPDATE` and a blocked unique-index
-- insertion look like in `pg_locks`. `pg_current_xact_id()` needs an assigned id, so every caller takes this
-- poll *after* it has written or locked something of its own.
-- Identity is the pid, never the peer's `application_name`: inside one open transaction a session's
-- `pg_stat_activity` reads are frozen at the backends that existed when that transaction began, so a peer that
-- connects and parks *after* the holder began is invisible there under all three legal
-- `stats_fetch_consistency` values (measured — the holder counted six rows on every poll while an outside
-- session listed the peer among eight). `pg_locks` is not frozen, so the holder reports the waiter's pid and
-- the driver binds it to the pid that peer printed about itself, the same way ARM 4 binds two logs by
-- transaction id. A name a session sets for itself is not evidence about who it is; a lock row Postgres wrote
-- and that same backend's own log line, in a file the driver opened for that client alone, are.
-- `pg_locks.transactionid` is type `xid` while `pg_current_xact_id()` returns `xid8`, so the comparison lands
-- in the lock domain through the catalogue's only xid cast (`::xid`); a `::text` right operand has no `=`
-- operator for `xid` and aborts the arm at its first poll.
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

DO $a$
DECLARE v_ans text; v jsonb; v_gate text;
BEGIN
  RAISE NOTICE 'A1_STARTED=pid %', (SELECT pg_backend_pid());
  -- One line per arm subject, read before anything is decided: if this ever prints something other than
  -- active/0/0, the fixture did not plant what the arm assumes and every claim below is void rather than
  -- failed.
  RAISE NOTICE 'A1_PRE=%', (SELECT 'pub=' || p.status || ' takedownrows='
      || (SELECT count(*) FROM private.audit_events a
           WHERE a.wedding_id = '0b0b0b00-0000-4000-8000-000000000001'::uuid
             AND a.action = 'publication_takedown')
      || ' keyrows=' || (SELECT count(*) FROM private.audit_events a
           WHERE a.idempotency_key = '0b0b0b00-0000-4000-8000-000000000301'::text)
    FROM public.publications p
   WHERE p.wedding_id = '0b0b0b00-0000-4000-8000-000000000001'::uuid);

  v_ans := pg_temp.s11r_act('0b0b0b00-0000-4000-8000-000000000111'::uuid,
    'SELECT api.operator_takedown_publication('
    || '''0b0b0b00-0000-4000-8000-000000000001''::uuid, '
    || quote_literal((SELECT c.case_ref FROM private.support_cases c
                      WHERE c.id = '0b0b0b00-0000-4000-8000-000000000901'::uuid)) || ', '
    || '''owner_request'', '
    || '''0b0b0b00-0000-4000-8000-000000000301''::uuid)');
  IF v_ans LIKE 'RAISED %' THEN
    -- A refusal here is not an arm outcome, it is a broken plant: the operator is granted, the case is
    -- open and about this wedding, the publication is active and the key is unspent. Say so loudly, and
    -- under a token that is *not* the one the driver gates on — a failure line that began `A1_APPLIED=`
    -- would satisfy the gate and then the peer would be started against a wedding nothing had touched.
    RAISE NOTICE 'A1_PLANT_BROKEN=%', v_ans;
    RAISE EXCEPTION 'FAIL arm 1: the first operator was refused — %', v_ans;
  END IF;
  v := v_ans::jsonb;
  RAISE NOTICE 'A1_APPLIED=replayed=%/tokens=%/outputs=%/audit_id=%/objects_deleted=%',
    v ->> 'replayed', v ->> 'credentials_revoked', v ->> 'outputs_invalidated',
    v ->> 'audit_id', v ->> 'objects_deleted_by_this_call';

  -- The hold is the point: everything below happens while A's revocation is still invisible to every other
  -- session, which is the only state in which B can meet a stale-but-live publication row.
  --
  -- The gate, and why the value is checked before the token is printed: `run.sh`'s marker greps this line's
  -- prefix, so a poll that gave up and returned `ARM_INVALID` would satisfy the driver's gate exactly as
  -- strongly as the rendezvous it is supposed to report — the driver would then read an arm that never
  -- interleaved as an arm that serialised on the product's lock. So the failure branch names itself under a
  -- token the gate cannot match, and aborts the session.
  v_gate := pg_temp.s11r_waits(600);
  IF v_gate LIKE 'ARM_INVALID%' THEN
    RAISE NOTICE 'A1_GATE_FAILED=no backend parked on this transaction: %', v_gate;
    RAISE EXCEPTION 'FAIL arm 1: session B never blocked on A''s transaction id — %', v_gate;
  END IF;
  RAISE NOTICE 'A1_SEES_B_BLOCKED=%', v_gate;
END $a$;

COMMIT;

-- After the release, read the same row back: A's own committed state, for the log only. The counted version
-- of this claim is `RC02` in `82_race_arm1_asserts.sql`, which reads it in a fresh session.
DO $a$
BEGIN
  RAISE NOTICE 'A1_COMMITTED=%', (SELECT status || '/' ||
    coalesce(revoked_at::text, 'no-revoked-at') FROM public.publications
    WHERE wedding_id = '0b0b0b00-0000-4000-8000-000000000001'::uuid);
END $a$;
