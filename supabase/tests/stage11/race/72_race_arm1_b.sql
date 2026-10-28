-- ARM 1 session B (the second operator, one second later). The peer of `71_race_arm1_a.sql`; the counted
-- half of this pair is `82_race_arm1_asserts.sql`.
--
-- B is a second authorised operator taking the *same* wedding down, with its own key and its own authorising
-- ticket (…0302 and …0902, both distinct from A's — that is what makes this arm say which lock serialised
-- the pair rather than leaving the case lock and the publication lock fused into one unattributable wait).
-- The driver starts this session only after A's `A1_APPLIED=`, and A does not release its lock until it has
-- seen this backend ungranted on its own transaction id, so B's wait is observed from both sides.
--
-- What B must answer is the shipped refusal, not a second revocation: `this wedding has no active
-- publication to take down`, 23514, from the `v_pub.id IS NULL` branch the body reaches after its `FOR
-- UPDATE` returns the row A committed.
BEGIN;
SET search_path = public, pg_temp;
SET application_name = 's11r-arm1-b';

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

DO $b$
DECLARE v_ans text;
BEGIN
  RAISE NOTICE 'B1_STARTED=pid %', (SELECT pg_backend_pid());
  -- B's own first read, in its own snapshot: the wedding still looks take-down-able here. If it did not,
  -- the refusal below would prove nothing about the race.
  RAISE NOTICE 'B1_PRE=%', (SELECT 'pub=' || p.status || ' keyrows='
      || (SELECT count(*) FROM private.audit_events a
           WHERE a.idempotency_key = '0b0b0b00-0000-4000-8000-000000000302'::text)
    FROM public.publications p
   WHERE p.wedding_id = '0b0b0b00-0000-4000-8000-000000000001'::uuid);

  v_ans := pg_temp.s11r_act('0b0b0b00-0000-4000-8000-000000000112'::uuid,
    'SELECT api.operator_takedown_publication('
    || '''0b0b0b00-0000-4000-8000-000000000001''::uuid, '
    || quote_literal((SELECT c.case_ref FROM private.support_cases c
                      WHERE c.id = '0b0b0b00-0000-4000-8000-000000000902'::uuid)) || ', '
    || '''terms_violation'', '
    || '''0b0b0b00-0000-4000-8000-000000000302''::uuid)');
  RAISE NOTICE 'B1_OUTCOME=%', left(v_ans, 220);
  IF v_ans LIKE 'RAISED 23514 | this wedding has no active publication%' THEN
    RAISE NOTICE 'B1_REFUSAL=expected-no-active-publication';
  ELSE
    RAISE NOTICE 'B1_REFUSAL=UNEXPECTED — the second operator did not meet the shipped refusal';
  END IF;

  -- A fresh statement after the wait, in the same transaction: this is B's own record that the row it
  -- finally read is the one A committed, which is the half a `FOR UPDATE` cannot give you from the outside.
  RAISE NOTICE 'B1_PUB_SEEN_AFTER_BLOCK=%', (SELECT status FROM public.publications
    WHERE wedding_id = '0b0b0b00-0000-4000-8000-000000000001'::uuid);
  -- And B's answer is a refusal, so nothing may have been written: read the effect set back from inside this
  -- session, where a second revocation would be visible even before the rollback.
  RAISE NOTICE 'B1_TAKEDOWN_ROWS_SEEN_BY_B=%', (SELECT count(*) FROM private.audit_events a
    WHERE a.wedding_id = '0b0b0b00-0000-4000-8000-000000000001'::uuid
      AND a.action = 'publication_takedown');
END $b$;

ROLLBACK;

DO $b$
BEGIN
  RAISE NOTICE 'B1_ENDED=rolled-back';
END $b$;
