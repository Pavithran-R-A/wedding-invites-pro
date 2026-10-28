-- ARM 4 and the stale shapes, counted: RC10–RC16. The §13 rows these belong to are "Operator authority
-- revoked while an action is waiting on a lock" and "A stale operator attempting a privileged action"
-- (`docs/architecture/operations-admin-security.md:899`). Before this file existed, both rows were prose plus
-- a serial assertion that a *revoked grant row* answers `false` — which is a statement about the predicate,
-- not about an act that was already in flight when the duty was withdrawn, and not about the four shapes of
-- staleness a console will actually meet.
--
-- Read together with the three session logs, which are the chronology and never the count:
--   `77_race_arm4_holder.sql`  a trusted hand write locks w5's publication row and holds, refusing to release
--                              until it has seen the waiter ungranted on its own transaction id *and* seen
--                              the revocation land as a committed trail row;
--   `78_race_arm4_waiter.sql`  the operator with a live `operations` grant reads its own authority at the
--                              door, then delivers a real takedown of w5 and parks inside the body on that
--                              same publication row;
--   `79_race_arm4_revoke.sql`  a third client withdraws that grant while the waiter is parked, and commits.
--
-- What the three of them measured is stated here before the numbers, because it is the finding and not an
-- accident of the schedule: **the act finished.** `private.actor_is_operator`
-- (`supabase/migrations/20261020190000_stage11_operator_authority.sql:159-166`) is one `EXISTS` read with no
-- `FOR UPDATE` on the grant row and no second call after the lock wait, so the authority question is answered
-- once, at the door, and the revocation that arrives mid-flight does not reach it. That is §6's design
-- decision — one transaction, one authorisation — and these cells record what the decision costs as well as
-- what it buys. Nothing in this file is a defect report, and nothing in it is allowed to read as if the
-- revocation had stopped the act: RC12 is the cell that pins the ordering in data rather than in a log line.
--
-- RC13–RC16 are the other half: four accounts, four different reasons for being stale, all four sent through
-- the *same shipped door* rather than against the predicate. §5's rule is that a refusal which reports
-- success is a defect, so the cells compare the sentences with each other and with the never-granted control,
-- and then prove that four attempts grew nothing in any store.
SET client_min_messages = notice;
SET search_path = public, pg_temp;

SELECT pg_catalog.set_config('s11f.passed', '0', false);

CREATE FUNCTION pg_temp.s11r_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_catalog.set_config('s11f.passed',
    (coalesce(nullif(current_setting('s11f.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s11r_cell(p_id text, p_label text, p_condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
-- One line per cell, with the id first so a reader can find the same claim in the threat row. A false or NULL
-- condition aborts the file, and `suite … lines` then compares the total this file reports with the `PASS`
-- lines it printed, so a cell that did not hold cannot be read as one that did.
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'FAIL %: %', p_id, p_label;
  END IF;
  RAISE NOTICE 'PASS % — %', p_id, p_label;
  PERFORM pg_temp.s11r_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11r_act(p_uid uuid, p_stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
-- A door called as a caller — `SET ROLE` plus the `test.uid` shim — with its answer *or* its refusal returned
-- as one line instead of raised. RC13–RC16 exist to compare refusal sentences, so a refusal has to be
-- readable data here; raising would abort the transaction that is measuring the other three accounts. The
-- role is reset on both exits so a refusal cannot leave the rest of the session holding a borrowed privilege.
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

DO $$
DECLARE
  v_w5    uuid := '0b0b0b00-0000-4000-8000-000000000005'::uuid;
  v_w7    uuid := '0b0b0b00-0000-4000-8000-000000000007'::uuid;
  v_case7 uuid := '0b0b0b00-0000-4000-8000-000000000908'::uuid;
  v_waiter uuid := '0b0b0b00-0000-4000-8000-000000000116'::uuid;
  v_revoked uuid := '0b0b0b00-0000-4000-8000-000000000117'::uuid;
  v_lapsed  uuid := '0b0b0b00-0000-4000-8000-000000000118'::uuid;
  v_other   uuid := '0b0b0b00-0000-4000-8000-000000000119'::uuid;
  v_none    uuid := '0b0b0b00-0000-4000-8000-000000000120'::uuid;
  v_k13 text := '0b0b0b00-0000-4000-8000-000000000309';
  v_k14 text := '0b0b0b00-0000-4000-8000-000000000310';
  v_k15 text := '0b0b0b00-0000-4000-8000-000000000311';
  v_k16 text := '0b0b0b00-0000-4000-8000-000000000312';
  v_td    private.audit_events;
  v_rv    private.audit_events;
  v_old   private.audit_events;
  v_ans   text;
  v_ref   text;
  v_sent  text;
BEGIN
  SELECT c.case_ref INTO v_ref FROM private.support_cases c WHERE c.id = v_case7;

  -- ------------------------------------------------------------------ the act that outran its own authority
  SELECT a.* INTO v_td FROM private.audit_events a
   WHERE a.wedding_id = v_w5 AND a.action = 'publication_takedown';
  SELECT a.* INTO v_rv FROM private.audit_events a
   WHERE a.action = 'revoked' AND a.subject_type = 'operator_grant'
     AND a.payload ->> 'granted_user_id' = v_waiter::text;
  SELECT a.* INTO v_old FROM private.audit_events a
   WHERE a.action = 'revoked' AND a.subject_type = 'operator_grant'
     AND a.payload ->> 'granted_user_id' = v_revoked::text;

  PERFORM pg_temp.s11r_cell('RC10',
    'the takedown the waiter delivered while parked completed and is the only act on w5: one trail row naming '
    'that account as its operator, the publication revoked with a stamp, and the effect counts the body wrote '
    'into its own payload — so the answer a console reads is the act that happened, not the authority that '
    'happens to exist now',
    v_td.id IS NOT NULL
    AND v_td.actor_user_id = v_waiter
    AND v_td.actor_kind = 'operator'
    AND v_td.subject_type = 'publication'
    AND (SELECT count(*) FROM private.audit_events a
          WHERE a.wedding_id = v_w5 AND a.action = 'publication_takedown') = 1
    AND (SELECT p.status FROM public.publications p WHERE p.wedding_id = v_w5) = 'revoked'
    AND (SELECT p.revoked_at IS NOT NULL FROM public.publications p
          WHERE p.wedding_id = v_w5)
    AND v_td.payload ->> 'credentials_revoked' = '1'
    AND v_td.payload ->> 'outputs_invalidated' = '1'
    AND (SELECT count(*) FROM private.support_case_events e
          WHERE e.case_id = '0b0b0b00-0000-4000-8000-000000000907'::uuid) = 1);

  PERFORM pg_temp.s11r_cell('RC11',
    'the same transaction that completed the act is not the transaction that withdrew the duty: the grant row '
    'is `revoked` with a stamp and the trail carries exactly one revocation naming this account, written by '
    'the maintenance channel with no wedding attached — which is what an audit reader sees, and why RC10''s '
    'row cannot be re-read as a machine write',
    v_rv.id IS NOT NULL
    AND (SELECT g.status FROM private.operator_grants g
          WHERE g.user_id = v_waiter AND g.scope = 'operations') = 'revoked'
    AND (SELECT g.revoked_at IS NOT NULL FROM private.operator_grants g
          WHERE g.user_id = v_waiter AND g.scope = 'operations')
    AND v_rv.actor_kind = 'maintenance'
    AND v_rv.wedding_id IS NULL
    AND v_rv.subject_type = 'operator_grant'
    AND (SELECT count(*) FROM private.audit_events a
          WHERE a.action = 'revoked' AND a.subject_type = 'operator_grant'
            AND a.payload ->> 'granted_user_id' = v_waiter::text) = 1);

  PERFORM pg_temp.s11r_cell('RC12',
    'the window is a fact about the data and not about the driver: the act''s own trail row is stamped before '
    'the revocation that arrived while it was parked, and both are after the fixture''s pre-arm revocation — '
    'so the ordering RC10 and RC11 claim is readable from the trail alone, three years after anyone remembers '
    'which session started first',
    v_td.created_at < v_rv.created_at
    AND v_old.created_at < v_td.created_at
    -- `now()` is transaction-start time, so this is the comparison that holds. The tempting one — the grant's
    -- `revoked_at` against the takedown's stamp — does not: the waiter stamps its own row with its own
    -- xact-start, which is *earlier* than the revocation it waited through. A cell asserting the opposite
    -- would have failed, and that is the reason it is not here.
    AND v_rv.created_at IS NOT NULL AND v_td.created_at IS NOT NULL);

  -- ------------------------------------------------------------------ the four stale shapes, one door
  SELECT (pg_temp.s11r_act(v_revoked,
      'SELECT api.operator_takedown_publication('
      || '''0b0b0b00-0000-4000-8000-000000000007''::uuid, '
      || quote_literal(v_ref) || ', '
      || '''owner_request'', '
      || '''0b0b0b00-0000-4000-8000-000000000309''::uuid)')) INTO v_ans;
  v_sent := v_ans;
  PERFORM pg_temp.s11r_cell('RC13',
    'an account whose grant was revoked *before anything ran* is refused the takedown door outright — 42501, '
    'the one sentence §5 allows, no publication touched and its own fresh key spent nowhere. This is the shape '
    'RC10''s account used to be, one transaction earlier',
    v_ans LIKE 'RAISED 42501 | the caller may not take this publication down%'
    AND (SELECT count(*) FROM private.audit_events a WHERE a.idempotency_key = v_k13) = 0
    AND (SELECT count(*) FROM private.support_case_events e
          WHERE e.idempotency_key = '0b0b0b00-0000-4000-8000-000000000309'::uuid) = 0
    AND (SELECT count(*) FROM private.audit_events a WHERE a.wedding_id = v_w7) = 0);

  SELECT (pg_temp.s11r_act(v_none,
      'SELECT api.operator_takedown_publication('
      || '''0b0b0b00-0000-4000-8000-000000000007''::uuid, '
      || quote_literal(v_ref) || ', '
      || '''terms_violation'', '
      || '''0b0b0b00-0000-4000-8000-000000000310''::uuid)')) INTO v_ans;
  PERFORM pg_temp.s11r_cell('RC14',
    'an account that was never granted answers with the *same* sentence and the same code as the revoked one: '
    'the door is not an oracle over which humans once held a duty, and nothing about w7 moved for it either',
    v_ans = v_sent
    AND v_ans LIKE 'RAISED 42501 |%'
    AND (SELECT count(*) FROM private.operator_grants g WHERE g.user_id = v_none) = 0
    AND (SELECT count(*) FROM private.audit_events a WHERE a.idempotency_key = v_k14) = 0
    AND (SELECT count(*) FROM private.audit_events a WHERE a.wedding_id = v_w7) = 0);

  SELECT (pg_temp.s11r_act(v_lapsed,
      'SELECT api.operator_takedown_publication('
      || '''0b0b0b00-0000-4000-8000-000000000007''::uuid, '
      || quote_literal(v_ref) || ', '
      || '''safety'', '
      || '''0b0b0b00-0000-4000-8000-000000000311''::uuid)')) INTO v_ans;
  PERFORM pg_temp.s11r_cell('RC15',
    'the lapsed credential is the interesting one: its row is still `active` in the table — nothing cleans it '
    'up, and no cleanup job ships — and the door still refuses it with the same sentence, because the '
    'predicate reads the expiry rather than the status column. An operator console that read the table '
    'instead of asking the door would have let this call through',
    v_ans = v_sent
    AND (SELECT g.status FROM private.operator_grants g
          WHERE g.user_id = v_lapsed AND g.scope = 'operations') = 'active'
    AND (SELECT g.expires_at < now() FROM private.operator_grants g
          WHERE g.user_id = v_lapsed AND g.scope = 'operations')
    AND (SELECT count(*) FROM private.audit_events a WHERE a.idempotency_key = v_k15) = 0
    AND (SELECT count(*) FROM private.audit_events a WHERE a.wedding_id = v_w7) = 0);

  SELECT (pg_temp.s11r_act(v_other,
      'SELECT api.operator_takedown_publication('
      || '''0b0b0b00-0000-4000-8000-000000000007''::uuid, '
      || quote_literal(v_ref) || ', '
      || '''legal'', '
      || '''0b0b0b00-0000-4000-8000-000000000312''::uuid)')) INTO v_ans;
  PERFORM pg_temp.s11r_cell('RC16',
    'the fourth shape is scope, not staleness: an account holding a live `support` grant is refused the '
    '`operations` door with that same sentence — and the *same account* still reads its own scope''s case '
    'through its own door, so the refusal is per duty and not a global lockout. Four accounts, four reasons, '
    'one sentence, and w7''s publication, credential, artefact and thread are exactly as the fixture left them',
    v_ans = v_sent
    -- `42501` and not `23514`: the predicate answers before any argument is looked at, so a wrong-scope
    -- account cannot learn anything from the vocabulary, the ticket or the key it sent. The conjunction below
    -- is one `AND` chain — no `OR` appears in a cell condition anywhere in this tier, because a disjunction
    -- here would let the sentence alone carry a cell whose side effects had in fact happened.
    AND v_ans LIKE 'RAISED 42501 |%'
    AND (SELECT count(*) FROM private.audit_events a WHERE a.idempotency_key = v_k16) = 0
    AND (SELECT pg_temp.s11r_act(v_other,
           'SELECT api.get_operator_case(' || quote_literal(v_ref) || ')'))
        NOT LIKE 'RAISED %'
    AND (SELECT p.status FROM public.publications p WHERE p.wedding_id = v_w7) = 'active'
    AND (SELECT count(*) FROM private.access_tokens t
          WHERE t.wedding_id = v_w7 AND t.revoked_at IS NOT NULL) = 0
    AND (SELECT count(*) FROM public.invitation_outputs o
          WHERE o.wedding_id = v_w7 AND o.status <> 'ready') = 0
    AND (SELECT count(*) FROM private.support_case_events e WHERE e.case_id = v_case7) = 0);
END $$;

SELECT 'STAGE11 RACE TESTS PASSED (' ||
       coalesce(nullif(current_setting('s11f.passed', true), ''), '0')::int || ')' AS result;
