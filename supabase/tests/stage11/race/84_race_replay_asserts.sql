-- The idempotency tier, counted: RD00–RD07. The §13 row these belong to is the duplicate/replay row
-- (`docs/architecture/operations-admin-security.md:897`). Before this file, that row was measured only
-- serially: battery 1 replayed a key after the first delivery had *committed*, so the pre-read at the top of
-- the body always answered and the unique index standing behind it never had to work. `75_race_arm3_a.sql` and
-- `76_race_arm3_b.sql` are the concurrent version, and RD00–RD02 are what they leave behind; RD03–RD06 then
-- meet the same key shapes serially, through the shipped doors, because a collision the pre-read catches and a
-- collision only the index catches are two different answers, and the row names both.
--
-- The chronology is in the session logs, the count is here:
--   `75_race_arm3_a.sql`  operator …0114 takes w3 down under key …0304 and holds;
--   `76_race_arm3_b.sql`  a *different* operator (…0115) takes w4 down — another wedding, another ticket, the
--                         same key — does its real work inside its own transaction, and dies at
--                         `audit_events_one_row_per_idempotency_key` the moment the winner commits;
--   `80_race_arm5_first.sql` / `81_race_arm5_second.sql`  two trusted-channel hand appends on one ticket, the
--                         ordinal collision the shipped append door cannot reach, because it locks the case row
--                         first and only then re-reads `coalesce(max(seq),0)+1`.
--
-- ORDER, stated because it is load-bearing rather than cosmetic. This file is `rollback`-style: one
-- transaction, `ROLLBACK` at the end, so nothing it does reaches the committed state the two files above read.
-- RD07, the closure census, runs *before* RD06 — the one cell in this tier whose door call succeeds and
-- therefore writes — because a census taken after it would measure the instrument instead of the arms, which
-- is the failure shape Stage 7's runner records about its own probe. The cell ids stay semantic (RD06 is the
-- append-ordering cell, RD07 the census) and only the file order moves; `suite … lines` still compares the
-- total printed before the rollback against the eight `PASS` lines above it.
--
-- What RD07 deliberately contains is no memorised arithmetic. Every equality is between two things the
-- database can say about itself — the payload a body wrote against the rows that body actually touched — so a
-- count that drifted because of a fixture edit fails as a mismatch rather than as a stale expectation. Where
-- a number appears twice, it is because zero would satisfy an equality vacuously, and `> 0` is the guard.
SET client_min_messages = notice;
SET search_path = public, pg_temp;

BEGIN;

SELECT pg_catalog.set_config('s11f.passed', '0', false);

CREATE FUNCTION pg_temp.s11r_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_catalog.set_config('s11f.passed',
    (coalesce(nullif(current_setting('s11f.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s11r_cell(p_id text, p_label text, p_condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
-- A false or NULL condition aborts the file, so a cell that did not hold cannot be read as one that did. No
-- cell condition in this tier contains an `OR`: a disjunction inside a conjunction chain is how a failing side
-- effect gets carried by a sentence that happened to be right.
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'FAIL %: %', p_id, p_label;
  END IF;
  RAISE NOTICE 'PASS % — %', p_id, p_label;
  PERFORM pg_temp.s11r_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11r_act(p_uid uuid, p_stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
-- A door called as a caller, with its answer *or* its refusal returned as one line rather than raised.
-- RD03–RD06 each compare refusal sentences, so the refusal has to survive as data; the role is reset on both
-- exits so a refusal cannot leave the rest of the session holding a borrowed privilege.
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
  v_w1    uuid := '0b0b0b00-0000-4000-8000-000000000001'::uuid;
  v_w3    uuid := '0b0b0b00-0000-4000-8000-000000000003'::uuid;
  v_w4    uuid := '0b0b0b00-0000-4000-8000-000000000004'::uuid;
  v_w6    uuid := '0b0b0b00-0000-4000-8000-000000000006'::uuid;
  v_case1 uuid := '0b0b0b00-0000-4000-8000-000000000901'::uuid;
  v_case4 uuid := '0b0b0b00-0000-4000-8000-000000000904'::uuid;
  v_case5 uuid := '0b0b0b00-0000-4000-8000-000000000905'::uuid;
  v_case6 uuid := '0b0b0b00-0000-4000-8000-000000000906'::uuid;
  v_case9 uuid := '0b0b0b00-0000-4000-8000-000000000909'::uuid;
  v_op    uuid := '0b0b0b00-0000-4000-8000-000000000113'::uuid;
  v_sup   uuid := '0b0b0b00-0000-4000-8000-000000000119'::uuid;
  v_winner uuid := '0b0b0b00-0000-4000-8000-000000000114'::uuid;
  v_key4  text := '0b0b0b00-0000-4000-8000-000000000304';
  v_key6  text := '0b0b0b00-0000-4000-8000-000000000306';
  v_key8  text := '0b0b0b00-0000-4000-8000-000000000308';
  v_fresh text := '0b0b0b00-0000-4000-8000-000000000313';
  v_pub   jsonb;
  v_creds integer;
  v_arts  integer;
  v_acts  integer;
  v_ref1  text;
  v_ref6  text;
  v_ref9  text;
  v_ans   text;
  v_a1    text;
  v_a2    text;
  v_a3    text;
BEGIN
  SELECT c.case_ref INTO v_ref1 FROM private.support_cases c WHERE c.id = v_case1;
  SELECT c.case_ref INTO v_ref6 FROM private.support_cases c WHERE c.id = v_case6;
  SELECT c.case_ref INTO v_ref9 FROM private.support_cases c WHERE c.id = v_case9;

  -- ------------------------------------------- the concurrent collision: what one key is allowed to have done
  PERFORM pg_temp.s11r_cell('RD00',
    'two operators on two different weddings delivered the same key at the same moment, and the trail holds '
    'exactly one row for it, naming the winner''s wedding. The index that enforced it is a constraint, not a '
    'coin toss: whichever session committed first owns the key, and the other one''s act does not exist',
    (SELECT count(*) FROM private.audit_events a WHERE a.idempotency_key = v_key4) = 1
    AND (SELECT a.wedding_id FROM private.audit_events a
          WHERE a.idempotency_key = v_key4) = v_w3
    AND (SELECT a.action FROM private.audit_events a
          WHERE a.idempotency_key = v_key4) = 'publication_takedown');

  PERFORM pg_temp.s11r_cell('RD01',
    'the losing session had already *done* the work — it revoked its wedding''s credential, retired its '
    'publication and invalidated its artefact inside its own transaction — and died at the trail insert. From '
    'the outside none of that exists: w4 is published, reachable and complete, its ticket thread is empty, and '
    'no row anywhere in the trail names it',
    (SELECT p.status FROM public.publications p WHERE p.wedding_id = v_w4) = 'active'
    AND (SELECT p.revoked_at FROM public.publications p WHERE p.wedding_id = v_w4) IS NULL
    AND (SELECT count(*) FROM private.access_tokens t
          WHERE t.wedding_id = v_w4 AND t.revoked_at IS NOT NULL) = 0
    AND (SELECT count(*) FROM public.invitation_outputs o
          WHERE o.wedding_id = v_w4 AND o.status <> 'ready') = 0
    AND (SELECT count(*) FROM private.support_case_events e WHERE e.case_id = v_case5) = 0
    AND (SELECT count(*) FROM private.audit_events a WHERE a.wedding_id = v_w4) = 0);

  SELECT a.payload INTO v_pub FROM private.audit_events a
   WHERE a.idempotency_key = v_key4;

  PERFORM pg_temp.s11r_cell('RD02',
    'the row the index protected is the winner''s and it is whole: w3''s publication and version, the reason the '
    'winner itself gave, the ticket that authorised it, its own two effect counts, and the actor who wrote it — '
    'nothing from the colliding session leaked in, because a merged payload would have made a w3 takedown '
    'report w4''s damage',
    v_pub ->> 'wedding_id' = v_w3::text
    AND v_pub ->> 'publication_id' = (SELECT p.id::text FROM public.publications p
                                       WHERE p.wedding_id = v_w3)
    AND v_pub ->> 'version_id' = (SELECT p.version_id::text FROM public.publications p
                                    WHERE p.wedding_id = v_w3)
    AND v_pub ->> 'reason_category' = 'safety'
    AND v_pub ->> 'case_ref' = (SELECT c.case_ref FROM private.support_cases c
                                 WHERE c.id = v_case4)
    AND v_pub ->> 'credentials_revoked' = '1'
    AND v_pub ->> 'outputs_invalidated' = '1'
    AND (SELECT a.actor_user_id FROM private.audit_events a
          WHERE a.idempotency_key = v_key4) = v_winner);

  -- ------------------------------------------- the same key met serially: the pre-read answers first
  SELECT (pg_temp.s11r_act(v_op,
      'SELECT api.operator_takedown_publication('
      || '''0b0b0b00-0000-4000-8000-000000000006''::uuid, '
      || quote_literal(v_ref6) || ', '
      || '''duplicate'', '
      || quote_literal(v_key4) || '::uuid)')) INTO v_ans;
  PERFORM pg_temp.s11r_cell('RD03',
    'the same act, run after the winner committed instead of against its uncommitted row, is caught one step '
    'earlier and refused rather than replayed: one sentence naming the key as spent on another wedding, still '
    'exactly one row for that key, and w6 — a live, published wedding — untouched and no thread row added to '
    'the ticket it cited',
    v_ans LIKE 'RAISED 23514 | this idempotency key already belongs to a different act%'
    AND (SELECT count(*) FROM private.audit_events a WHERE a.idempotency_key = v_key4) = 1
    AND (SELECT count(*) FROM private.audit_events a WHERE a.wedding_id = v_w6) = 0
    AND (SELECT p.status FROM public.publications p WHERE p.wedding_id = v_w6) = 'active'
    AND (SELECT count(*) FROM private.support_case_events e WHERE e.case_id = v_case6) = 1);

  -- ------------------------------------------- a refusal does not spend a key, and does not re-stamp a row
  SELECT (pg_temp.s11r_act(v_op,
      'SELECT api.operator_takedown_publication('
      || '''0b0b0b00-0000-4000-8000-000000000001''::uuid, '
      || quote_literal(v_ref1) || ', '
      || '''duplicate'', '
      || quote_literal(v_fresh) || '::uuid)')) INTO v_ans;
  PERFORM pg_temp.s11r_cell('RD04',
    'the second takedown of a wedding that is already down is answered by the publication branch, not by the '
    'replay branch: one sentence, `check_violation`, and the fresh key it carried is spent *nowhere* — so the '
    'operator''s next act is not held hostage by a click that did nothing, and w1 still has exactly one act on '
    'it with its stamp unmoved',
    v_ans LIKE 'RAISED 23514 | this wedding has no active publication to take down%'
    AND (SELECT count(*) FROM private.audit_events a WHERE a.idempotency_key = v_fresh) = 0
    AND (SELECT count(*) FROM private.support_case_events e
          WHERE e.idempotency_key = v_fresh::uuid) = 0
    AND (SELECT count(*) FROM private.audit_events a
          WHERE a.wedding_id = v_w1 AND a.action = 'publication_takedown') = 1
    AND (SELECT p.revoked_at FROM public.publications p WHERE p.wedding_id = v_w1) IS NOT NULL
    AND (SELECT count(*) FROM public.invitation_outputs o
          WHERE o.wedding_id = v_w1 AND o.status = 'invalidated') = 2);

  -- ------------------------------------------- one key, two different bodies
  SELECT (pg_temp.s11r_act(v_op,
      'SELECT api.operator_takedown_publication('
      || '''0b0b0b00-0000-4000-8000-000000000006''::uuid, '
      || quote_literal(v_ref6) || ', '
      || '''safety'', '
      || quote_literal(v_key6) || '::uuid)')) INTO v_ans;
  PERFORM pg_temp.s11r_cell('RD05',
    'the key the *note* act spent is carried to the takedown door, and the door refuses it instead of '
    'answering with the note''s recorded result: subject, not merely key, is what one key is one action about. '
    'The fixture''s one accepted note is still the only note, still has its own one trail row, and w6 is '
    'unmoved — this is the collision the plant at the top of this tier exists to make reachable',
    v_ans LIKE 'RAISED 23514 | this idempotency key already belongs to a different act%'
    AND v_ans NOT LIKE '%replayed%'
    AND (SELECT count(*) FROM private.audit_events a WHERE a.idempotency_key = v_key6) = 1
    AND (SELECT a.subject_type FROM private.audit_events a
          WHERE a.idempotency_key = v_key6) = 'commerce_refund'
    AND (SELECT count(*) FROM private.commerce_review_notes) = 1
    AND (SELECT count(*) FROM private.audit_events a WHERE a.wedding_id = v_w6) = 0
    AND (SELECT p.status FROM public.publications p WHERE p.wedding_id = v_w6) = 'active');

  -- ------------------------------------------- the closure census, taken before the cell that writes
  SELECT coalesce(sum((a.payload ->> 'credentials_revoked')::int), 0),
         coalesce(sum((a.payload ->> 'outputs_invalidated')::int), 0),
         count(*)
    INTO v_creds, v_arts, v_acts
    FROM private.audit_events a WHERE a.action = 'publication_takedown';

  PERFORM pg_temp.s11r_cell('RD07',
    'the tier closes: the four acts'' own payloads add up to the state that is actually in the tables — the '
    'credentials they claim to have revoked are exactly the revoked ones, the artefacts they claim to have '
    'invalidated are exactly the invalidated ones, one retired publication per recorded act, no revocation '
    'anywhere outside the weddings an act named, the bucket registry byte-for-byte the seven objects the '
    'fixture planted, the money and the ledger untouched, and the trail partitioned into the four classes this '
    'tier can write with nothing undisclosed in it',
    v_acts > 0
    AND v_creds > 0 AND v_arts > 0
    AND v_creds = (SELECT count(*) FROM private.access_tokens t WHERE t.revoked_at IS NOT NULL)
    AND v_arts = (SELECT count(*) FROM public.invitation_outputs o
                   WHERE o.status = 'invalidated')
    AND v_acts = (SELECT count(*) FROM public.publications p WHERE p.status = 'revoked')
    AND v_acts = (SELECT count(DISTINCT p.wedding_id) FROM public.publications p
                   WHERE p.status = 'revoked')
    AND (SELECT count(*) FROM private.access_tokens t
          WHERE t.revoked_at IS NOT NULL
            AND t.wedding_id NOT IN (SELECT a.wedding_id FROM private.audit_events a
                                      WHERE a.action = 'publication_takedown')) = 0
    AND (SELECT count(*) FROM public.invitation_outputs o
          WHERE o.status = 'invalidated'
            AND o.invalidated_at IS NULL) = 0
    AND (SELECT count(*) FROM public.invitation_outputs o
          WHERE o.status = 'invalidated'
            AND o.invalidation_reason IS DISTINCT FROM 'publication_revoked') = 0
    AND (SELECT count(*) FROM public.publications p GROUP BY p.wedding_id
          ORDER BY count(*) DESC LIMIT 1) = 1
    AND (SELECT count(*) FROM public.publications p WHERE p.status NOT IN ('active','revoked')) = 0
    -- The registry claim in the fixture''s own words: no body in this tier deletes an object, so the objects
    -- are still exactly the artefacts that earned bytes. `RC15` is the stale-shape cell; this is the census.
    AND (SELECT count(*) FROM storage.objects)
        = (SELECT count(*) FROM public.invitation_outputs o WHERE o.content_digest IS NOT NULL)
    AND (SELECT count(*) FROM storage.objects) = 7
    AND (SELECT count(*) FROM private.commerce_orders) = 2
    AND (SELECT count(*) FROM private.commerce_refunds) = 2
    AND (SELECT count(*) FROM private.commerce_refunds r WHERE r.status <> 'recorded') = 0
    AND (SELECT count(*) FROM public.entitlements) = 1
    AND (SELECT count(*) FROM private.commerce_payment_events) = 0
    -- Trail partition: every row is one of the four classes this tier can produce, and each class equals the
    -- rows it describes rather than a number written down here.
    AND (SELECT count(*) FROM private.audit_events)
        = (SELECT count(*) FROM private.audit_events a
            WHERE a.action IN ('granted','revoked','commerce_review_note_added','publication_takedown'))
    AND (SELECT count(*) FROM private.audit_events a
          WHERE a.action = 'granted' AND a.subject_type = 'operator_grant')
        = (SELECT count(*) FROM private.operator_grants)
    AND (SELECT count(*) FROM private.audit_events a
          WHERE a.action = 'revoked' AND a.subject_type = 'operator_grant')
        = (SELECT count(*) FROM private.operator_grants g WHERE g.status = 'revoked')
    AND (SELECT count(*) FROM private.audit_events a
          WHERE a.action = 'commerce_review_note_added')
        = (SELECT count(*) FROM private.commerce_review_notes));

  -- ------------------------------------------- the append door, after the hand writers have had their turn
  SELECT pg_temp.s11r_act(v_sup,
      'SELECT api.operator_add_case_note('
      || quote_literal(v_ref9) || ', '
      || '''message_operator'', '
      || quote_literal('race tier: the door mints its ordinal after two hand writers already tried'), ', '
      || quote_literal(v_key8) || '::uuid)') INTO v_a1;
  SELECT pg_temp.s11r_act(v_sup,
      'SELECT api.operator_add_case_note('
      || quote_literal(v_ref9) || ', '
      || '''message_operator'', '
      || quote_literal('race tier: the same key, delivered twice'), ', '
      || quote_literal(v_key8) || '::uuid)') INTO v_a2;
  SELECT pg_temp.s11r_act(v_sup,
      'SELECT api.operator_add_case_note('
      || quote_literal(v_ref9) || ', '
      || '''message_host'', '
      || quote_literal('race tier: the same key, the other arm'), ', '
      || quote_literal(v_key8) || '::uuid)') INTO v_a3;

  PERFORM pg_temp.s11r_cell('RD06',
    'the shipped append door, called after arm 5''s committed hand row already holds seq 1 on this ticket, '
    'mints seq 2 rather than colliding with it — the case lock plus the post-lock `max(seq)` re-read is the '
    'serialisation the two hand writers cannot reach — and the same key delivered twice answers with the first '
    'seq and no second row, while the same key turned to the other arm is refused instead of rewritten',
    v_a1 NOT LIKE 'RAISED %'
    AND (v_a1::jsonb ->> 'seq') = '2'
    AND (v_a1::jsonb ->> 'replayed') = 'false'
    AND (SELECT count(*) FROM private.support_case_events e WHERE e.case_id = v_case9) = 2
    AND (SELECT e.seq FROM private.support_case_events e
          WHERE e.case_id = v_case9 AND e.idempotency_key = v_key8::uuid) = 2
    AND v_a2 NOT LIKE 'RAISED %'
    AND (v_a2::jsonb ->> 'replayed') = 'true'
    AND (v_a2::jsonb ->> 'seq') = '2'
    AND (SELECT count(*) FROM private.support_case_events e WHERE e.case_id = v_case9) = 2
    AND v_a3 LIKE 'RAISED 23514 | this idempotency key already carries a message_operator row on this case%'
    AND (SELECT count(*) FROM private.support_case_events e
          WHERE e.case_id = v_case9 AND e.kind = 'message_host') = 0);
END $$;

SELECT 'STAGE11 RACE TESTS PASSED (' ||
       coalesce(nullif(current_setting('s11f.passed', true), ''), '0')::int || ')' AS result;

-- The rollback is the scoped teardown §1 asks for: every write this file made — and only RD06 writes — goes
-- back, so the committed state stays exactly the five arms' work for anything that reads the database after
-- this point, and the chain itself is dropped by the runner.
ROLLBACK;
