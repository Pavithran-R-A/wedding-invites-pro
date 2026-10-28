-- ARM 2 session B (the second delivery of the same key). The peer of `73_race_arm2_a.sql`; counted as `RC07`
-- and `RC08`.
--
-- Identical arguments to A — the same account, the same wedding, the same ticket, the same key — because a
-- double-click is not a different operator. What differs is only the instant: the driver started this session
-- after A's `A2_APPLIED=` and A released only after observing this backend ungranted on its transaction id.
--
-- The expected answer is A's recorded delivery, not a refusal and not a second act: `replayed = true`, the
-- first delivery's payload, the first delivery's audit id, and no row written. The line this session prints
-- about the audit id is the session-side half of that claim; `RC07` re-measures from the tables, in a backend
-- that took no part in the race, that the key owns exactly one row, and `RC08` that the payload of that row is
-- the first delivery's answer — so a passing log line is never the only evidence for it.
BEGIN;
SET search_path = public, pg_temp;
SET application_name = 's11r-arm2-b';

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
DECLARE v_ans text; v jsonb; v_stored bigint;
BEGIN
  RAISE NOTICE 'B2_STARTED=pid %', (SELECT pg_backend_pid());
  -- Before the wait, in this session's own snapshot: the key looks unspent and the wedding looks live. If
  -- either were already decided, the replay below would be an artefact of the fixture rather than of the
  -- serialisation.
  RAISE NOTICE 'B2_PRE=%', (SELECT 'keyrows=' || (SELECT count(*) FROM private.audit_events a
      WHERE a.idempotency_key = '0b0b0b00-0000-4000-8000-000000000303'::text)
    || ' pub=' || p.status FROM public.publications p
   WHERE p.wedding_id = '0b0b0b00-0000-4000-8000-000000000002'::uuid);

  v_ans := pg_temp.s11r_act('0b0b0b00-0000-4000-8000-000000000113'::uuid,
    'SELECT api.operator_takedown_publication('
    || '''0b0b0b00-0000-4000-8000-000000000002''::uuid, '
    || quote_literal((SELECT c.case_ref FROM private.support_cases c
                      WHERE c.id = '0b0b0b00-0000-4000-8000-000000000903'::uuid)) || ', '
    || '''legal'', '
    || '''0b0b0b00-0000-4000-8000-000000000303''::uuid)');
  IF v_ans LIKE 'RAISED %' THEN
    RAISE NOTICE 'B2_OUTCOME=%', left(v_ans, 220);
    -- The word is load-bearing: this arm's expected answer is a replay, so a refusal is an outcome the tier
    -- must fail on rather than a nuance a reader sorts out from the log. `RC07`–`RC09` cannot separate the two
    -- routes — a delivery refused at the case lock and a delivery answered from the record leave the same
    -- committed state — so which branch actually answered is knowable only from this line, and `run.sh` fails
    -- the tier on any `UNEXPECTED` in a session log.
    RAISE NOTICE 'B2_ANSWERED=UNEXPECTED — refused, not replayed';
  ELSE
    v := v_ans::jsonb;
    RAISE NOTICE 'B2_OUTCOME=%', left(v_ans, 220);
    RAISE NOTICE 'B2_DETAIL=replayed=%/audit_id=%/tokens=%/outputs=%',
      v ->> 'replayed', v ->> 'audit_id', v ->> 'credentials_revoked',
      v ->> 'outputs_invalidated';
    -- A literal token with its own condition, not a formatted echo. The driver waits on this string, so an
    -- answer that arrived *without* `replayed = true` — a second act that happened to be accepted — must not
    -- print a word that reads as the arm's expected outcome; the fields it was judged from live on `B2_DETAIL`
    -- so a changed value can never silently unmake the token the tier is gated on.
    IF coalesce((v ->> 'replayed')::boolean, false) THEN
      RAISE NOTICE 'B2_ANSWERED=replayed-record-answer';
    ELSE
      RAISE NOTICE 'B2_ANSWERED=UNEXPECTED — answered, but not from the record';
    END IF;
    SELECT a.id INTO v_stored FROM private.audit_events a
     WHERE a.idempotency_key = '0b0b0b00-0000-4000-8000-000000000303'::text;
    -- The returned id against the row now in the table, from this session's own read. `RC07` counts the rows
    -- and `RC08` the payload of that row from a backend that took no part in the race; this is the narrower
    -- claim that the id *this answer carried* is that row's id, which no assert cell can make after the fact.
    IF coalesce((v ->> 'audit_id')::bigint = v_stored, false) THEN
      RAISE NOTICE 'B2_MATCHES_STORED=audit-id-equals-stored-row';
    ELSE
      RAISE NOTICE 'B2_MATCHES_STORED=UNEXPECTED — returned id is not the stored row';
    END IF;
  END IF;
  -- B wrote nothing, and this session can see its own transaction: one trail row for the key and one
  -- takedown for w2, which is A's, and nothing that arrived twice.
  RAISE NOTICE 'B2_ROWS_SEEN_BY_B=%', (SELECT 'keyrows=' || count(*)
    FROM private.audit_events a
   WHERE a.idempotency_key = '0b0b0b00-0000-4000-8000-000000000303'::text);
  RAISE NOTICE 'B2_TAKEDOWNS_SEEN_BY_B=%', (SELECT count(*) FROM private.audit_events a
    WHERE a.wedding_id = '0b0b0b00-0000-4000-8000-000000000002'::uuid
      AND a.action = 'publication_takedown');
END $b$;

ROLLBACK;

DO $b$
BEGIN
  RAISE NOTICE 'B2_ENDED=rolled-back';
END $b$;
