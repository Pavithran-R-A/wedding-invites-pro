-- ARM 4 session B (the waiter, and then the act that finishes anyway). The peer of
-- `77_race_arm4_holder.sql`; the driver runs `79_race_arm4_revoke.sql` between this session's block and its
-- release. Counted by `RC10`–`RC12`, and `RC11` re-reads the authority half from the grant table.
--
-- This session is the one the §13 row is actually about, and it measures the control from the inside: the
-- same account, in the same transaction, reads its own authority at the door (`api.operator_takedown_plan`
-- is the cheapest shipped surface that answers the predicate without writing anything), then parks on the
-- publication lock the holder owns, loses its grant while parked, and still completes the revocation when the
-- lock is released. The predicate is `private.actor_is_operator`
-- (`20261020190000_stage11_operator_authority.sql:148-167`) — a plain `EXISTS` read with no `FOR UPDATE` on
-- the grant row and no second call after the lock — and this file is the instrument that shows what that
-- shape means in practice rather than what a paragraph says it means.
--
-- Nothing here is a defect report. The design decision it tests is §6's: the authority question is answered
-- once, at the door, and the act it authorises is one transaction. What the tier owes the record is that the
-- mid-flight revocation *does not* stop the act, so that the row cannot be read as if it did.
BEGIN;
SET search_path = public, pg_temp;
SET application_name = 's11r-arm4-waiter';

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

DO $w$
DECLARE v_ans text; v jsonb; v_entry text;
BEGIN
  RAISE NOTICE 'W4_STARTED=pid %', (SELECT pg_backend_pid());

  -- Authority at entry, read through a door rather than asserted from a table: if this answers, the account
  -- really does hold the duty the moment the act begins, and the refusal of the same door after the commit
  -- below cannot be explained by an account that was never granted.
  v_entry := pg_temp.s11r_act('0b0b0b00-0000-4000-8000-000000000116'::uuid,
    'SELECT api.operator_takedown_plan('
    || '''0b0b0b00-0000-4000-8000-000000000005''::uuid)');
  IF v_entry LIKE 'RAISED %' THEN
    RAISE NOTICE 'W4_AUTH_AT_ENTRY=refused-before-the-act %', left(v_entry, 160);
    RAISE EXCEPTION 'FAIL arm 4: the waiter had no operations grant at entry — %', v_entry;
  END IF;
  RAISE NOTICE 'W4_AUTH_AT_ENTRY=granted';

  -- The act itself. It blocks inside the body, at the publication `FOR UPDATE`, and the holder does not
  -- release until the revocation is committed.
  v_ans := pg_temp.s11r_act('0b0b0b00-0000-4000-8000-000000000116'::uuid,
    'SELECT api.operator_takedown_publication('
    || '''0b0b0b00-0000-4000-8000-000000000005''::uuid, '
    || quote_literal((SELECT c.case_ref FROM private.support_cases c
                      WHERE c.id = '0b0b0b00-0000-4000-8000-000000000907'::uuid)) || ', '
    || '''terms_violation'', '
    || '''0b0b0b00-0000-4000-8000-000000000305''::uuid)');
  IF v_ans LIKE 'RAISED %' THEN
    RAISE NOTICE 'W4_PLANT_BROKEN=%', left(v_ans, 220);
    RAISE EXCEPTION 'FAIL arm 4: the waiter was refused rather than delayed — %', v_ans;
  END IF;
  v := v_ans::jsonb;
  RAISE NOTICE 'W4_APPLIED=replayed=%/tokens=%/outputs=%/audit_id=%',
    v ->> 'replayed', v ->> 'credentials_revoked', v ->> 'outputs_invalidated', v ->> 'audit_id';
END $w$;

COMMIT;

-- After the release, from a new transaction: the same door, the same account, the same wedding the *other*
-- half of this file asked about. `42501` here is the arm's premise — the grant really is gone now — and it is
-- read from a door so that no test-local privilege assumption is doing the work.
DO $w$
DECLARE v_after text;
BEGIN
  v_after := pg_temp.s11r_act('0b0b0b00-0000-4000-8000-000000000116'::uuid,
    'SELECT api.operator_takedown_plan('
    || '''0b0b0b00-0000-4000-8000-000000000007''::uuid)');
  IF v_after LIKE 'RAISED 42501 | the caller may not plan a takedown for this wedding%' THEN
    RAISE NOTICE 'W4_AUTH_AFTER=refused-as-revoked';
  ELSE
    RAISE NOTICE 'W4_AUTH_AFTER=UNEXPECTED %', left(v_after, 200);
  END IF;
  RAISE NOTICE 'W4_ENDED=act-completed-after-revocation';
END $w$;
