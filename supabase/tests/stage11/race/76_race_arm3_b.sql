-- ARM 3 session B (the act that loses the same key). The peer of `75_race_arm3_a.sql`; counted in `RD01`.
--
-- w4, its own ticket …0905, its own operator …0115, and the key …0304 that w3's act is writing right now.
-- The driver starts this session only after `A3_APPLIED=`, so the winner's trail row exists and is not yet
-- visible: the pre-read answers `no such key`, the state check answers `active`, and the body does its whole
-- effect set on w4 before the INSERT into `audit_events` blocks on the winner's transaction and is refused
-- with 23505 the instant that transaction commits.
--
-- Which is why this session ends with `ROLLBACK` rather than `COMMIT`. The refusal arrives *inside* the act,
-- and the only thing that makes it harmless is that the act is one transaction. So the log states both
-- halves: what this backend could see of w4 while its own revocation was live, and what w4 actually reads
-- after the rollback. `RD01` re-measures the second half in a fresh backend, because a claim about residue
-- has to be read by someone who did not write it.
BEGIN;
SET search_path = public, pg_temp;
SET application_name = 's11r-arm3-b';

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
  RAISE NOTICE 'B3_STARTED=pid %', (SELECT pg_backend_pid());
  -- Read before the act, from this snapshot: the winner's trail row is committed-or-not by the time this
  -- prints, but this session's snapshot was taken at its own BEGIN, so `keyrows=0` here is the *pre-read's*
  -- answer and not a statement about the other session. Both are printed because the arm's claim is that the
  -- body did not replay, and a reader cannot tell that from a log that shows only one of them.
  RAISE NOTICE 'B3_PRE=%', (SELECT 'pub=' || p.status || ' keyrows='
      || (SELECT count(*) FROM private.audit_events a
           WHERE a.idempotency_key = '0b0b0b00-0000-4000-8000-000000000304'::text)
    FROM public.publications p
   WHERE p.wedding_id = '0b0b0b00-0000-4000-8000-000000000004'::uuid);

  v_ans := pg_temp.s11r_act('0b0b0b00-0000-4000-8000-000000000115'::uuid,
    'SELECT api.operator_takedown_publication('
    || '''0b0b0b00-0000-4000-8000-000000000004''::uuid, '
    || quote_literal((SELECT c.case_ref FROM private.support_cases c
                      WHERE c.id = '0b0b0b00-0000-4000-8000-000000000905'::uuid)) || ', '
    || '''duplicate'', '
    || '''0b0b0b00-0000-4000-8000-000000000304''::uuid)');
  RAISE NOTICE 'B3_OUTCOME=%', left(v_ans, 220);
  -- The refusal is the expected answer, and the token says so rather than the shell guessing. The needle names
  -- the *constraint*, not merely the SQLSTATE: 23505 is also what `support_case_events_one_row_per_key` or a
  -- primary key collision would print, and an arm that passed on "some unique index fired" would be a claim
  -- about the trail index that the trail index never had to honour. A 23505 from anywhere else, and any other
  -- SQLSTATE, both print `UNEXPECTED`, which the driver fails the tier on.
  IF v_ans LIKE 'RAISED 23505%duplicate key value violates unique constraint "audit_events_one_row_per_idempotency_key"%' THEN
    -- 27 characters, deliberately: the constraint's own name is 40 and `mask()` redacts any run of 36-43, so a
    -- verdict spelled out in index names arrives in the run log as `[REDACTED-LONG]`. The branch above is what
    -- actually binds this line to the trail index; the token has to survive on the page.
    RAISE NOTICE 'B3_REFUSAL=expected-trail-index-refusal';
  ELSIF v_ans LIKE 'RAISED 23505%' THEN
    RAISE NOTICE 'B3_REFUSAL=UNEXPECTED a unique violation, but not the trail index: %', v_ans;
  ELSE
    RAISE NOTICE 'B3_REFUSAL=UNEXPECTED %', v_ans;
  END IF;

  -- This backend's own view, mid-transaction: the revocation it did write is real here. Saying so out loud
  -- is what makes the rollback below a measurement instead of a relief.
  RAISE NOTICE 'B3_OWN_VIEW_MIDTX=%', (SELECT 'pub=' || p.status
      || ' tokrevoked=' || (SELECT count(*) FROM private.access_tokens t
            WHERE t.wedding_id = '0b0b0b00-0000-4000-8000-000000000004'::uuid
              AND t.revoked_at IS NOT NULL)::text
    FROM public.publications p
   WHERE p.wedding_id = '0b0b0b00-0000-4000-8000-000000000004'::uuid);
END $b$;

ROLLBACK;

-- A fresh transaction in the same backend, after the loser's whole act is gone. `RD01` reads the same thing
-- from a different connection; this line is here so the chronology and the count can be compared by eye when
-- they disagree.
DO $b$
BEGIN
  RAISE NOTICE 'B3_OWN_VIEW_AFTER_ROLLBACK=%', (SELECT 'pub=' || p.status
      || ' tokenlive=' || (SELECT count(*) FROM private.access_tokens t
            WHERE t.wedding_id = '0b0b0b00-0000-4000-8000-000000000004'::uuid
              AND t.revoked_at IS NULL)
      || ' ready=' || (SELECT count(*) FROM public.invitation_outputs o
            WHERE o.wedding_id = '0b0b0b00-0000-4000-8000-000000000004'::uuid
              AND o.status = 'ready')
      || ' keyrows=' || (SELECT count(*) FROM private.audit_events a
            WHERE a.wedding_id = '0b0b0b00-0000-4000-8000-000000000004'::uuid)
      || ' threadrows=' || (SELECT count(*) FROM private.support_case_events e
            WHERE e.case_id = '0b0b0b00-0000-4000-8000-000000000905'::uuid)
    FROM public.publications p
   WHERE p.wedding_id = '0b0b0b00-0000-4000-8000-000000000004'::uuid);
  RAISE NOTICE 'B3_ENDED=rolled-back';
END $b$;
