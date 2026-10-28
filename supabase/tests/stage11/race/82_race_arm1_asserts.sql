-- ARM 1 and ARM 2, counted: RC00–RC09. The §13 row these belong to is "Race: two operators take the same
-- wedding down at once" (`docs/architecture/operations-admin-security.md:898`), which until this file was
-- written as a serial measurement of the state machine *because nothing could run two sessions*. The rows it
-- names — `K26`, `K42`–`K46`, `U25`, `Z11` — stay exactly as they are; what they could not say was which of
-- the two locks in the body did the serialising, and whether the second operator's own act left a mark.
--
-- Read together with the two session logs, which are the chronology and never the count:
--   `71_race_arm1_a.sql`  A applies a real takedown of w1 under its own key and holds the transaction open,
--                         then refuses to commit until it has seen B ungranted on its own transaction id;
--   `72_race_arm1_b.sql`  B, a *different* operator with a *different* ticket and a *different* key, reaches
--                         the shipped `v_pub.id IS NULL` refusal;
--   `73_race_arm2_a.sql`  A applies a takedown of w2 under key …0303 and holds;
--   `74_race_arm2_b.sql`  B delivers the *same* key to the *same* wedding and is answered from the record.
-- So arm 1 is the two-operator case the row names, and arm 2 is the replay case its neighbour row (:897)
-- names, run concurrently instead of serially. Both are counted here because a session file that printed its
-- own `PASS` lines would be a log claiming to be a battery.
--
-- This file writes nothing. Everything it reports is the committed residue of the four sessions above, read
-- from a fresh backend that never took part in the race — the only vantage from which "the refused act left no
-- row" means what it says, since a session cannot see its own rollback.
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
-- condition aborts the file: `suite … lines` then compares the number this file reports with the number of
-- `PASS` lines it printed, and an abort prints neither, so a cell that did not hold cannot be read as one
-- that did.
BEGIN
  IF NOT coalesce(p_condition, false) THEN
    RAISE EXCEPTION 'FAIL %: %', p_id, p_label;
  END IF;
  RAISE NOTICE 'PASS % — %', p_id, p_label;
  PERFORM pg_temp.s11r_add(1);
END $fn$;

DO $$
DECLARE
  v_w1 uuid := '0b0b0b00-0000-4000-8000-000000000001'::uuid;
  v_w2 uuid := '0b0b0b00-0000-4000-8000-000000000002'::uuid;
  v_keyA text := '0b0b0b00-0000-4000-8000-000000000301';
  v_keyB text := '0b0b0b00-0000-4000-8000-000000000302';
  v_key2 text := '0b0b0b00-0000-4000-8000-000000000303';
  v_opA uuid := '0b0b0b00-0000-4000-8000-000000000111'::uuid;
  v_caseA uuid := '0b0b0b00-0000-4000-8000-000000000901'::uuid;
  v_caseB uuid := '0b0b0b00-0000-4000-8000-000000000902'::uuid;
  v_case3 uuid := '0b0b0b00-0000-4000-8000-000000000903'::uuid;
  v_pub jsonb;
BEGIN
  -- ------------------------------------------------------------------ arm 1: two operators, one wedding
  PERFORM pg_temp.s11r_cell('RC00',
    'both operators were authorised, both cited a live ticket about w1 and one of them was refused, yet the '
    || 'trail records exactly one publication_takedown for w1 — the serialisation is the act, not the session',
    (SELECT count(*) FROM private.audit_events a
      WHERE a.wedding_id = v_w1 AND a.action = 'publication_takedown') = 1);

  SELECT a.payload INTO v_pub FROM private.audit_events a
   WHERE a.wedding_id = v_w1 AND a.action = 'publication_takedown';

  PERFORM pg_temp.s11r_cell('RC01',
    'the one recorded act is the *first* operator''s, not whichever session happened to finish last: the trail '
    || 'row names A''s account as its operator actor, the publication as its subject, A''s ticket as the reason''s '
    || 'case, and the before/after pair the body writes',
    (SELECT a.actor_user_id = v_opA AND a.actor_kind = 'operator'
              AND a.subject_type = 'publication'
              AND a.subject_key = (SELECT p.id FROM public.publications p
                                    WHERE p.wedding_id = v_w1)
              AND a.reason LIKE '%case ' || (SELECT c.case_ref FROM private.support_cases c
                                              WHERE c.id = v_caseA) || ' as owner_request%'
              AND a.before_state = jsonb_build_object('publication_status', 'active')
              AND a.after_state = jsonb_build_object('publication_status', 'revoked',
                    'credentials_revoked', 2, 'outputs_invalidated', 2)
              AND a.idempotency_key = v_keyA
       FROM private.audit_events a WHERE a.wedding_id = v_w1
         AND a.action = 'publication_takedown'));

  PERFORM pg_temp.s11r_cell('RC02',
    'the second operator''s own key is unspent anywhere in the trail: a refusal that was reached after a lock '
    || 'wait writes no row, which is the half a serial battery cannot separate from "the row was never looked '
    || 'for"',
    (SELECT count(*) FROM private.audit_events a WHERE a.idempotency_key = v_keyB) = 0);

  PERFORM pg_temp.s11r_cell('RC03',
    'w1 presents one publication row, terminal in the state machine with a revocation stamp, and no wedding in '
    || 'the fixture ends the race holding two live rows — `one_active_publication_per_wedding` held while two '
    || 'sessions were inside the same body',
    (SELECT count(*) FROM public.publications p WHERE p.wedding_id = v_w1) = 1
    AND (SELECT count(*) FROM public.publications p WHERE p.wedding_id = v_w1
          AND p.status = 'revoked' AND p.revoked_at IS NOT NULL) = 1
    AND (SELECT count(*) FROM (SELECT p.wedding_id FROM public.publications p
                                WHERE p.status = 'active' GROUP BY p.wedding_id
                               HAVING count(*) > 1) d) = 0);

  PERFORM pg_temp.s11r_cell('RC04',
    'the guest roster half is exact rather than approximate: w1''s public and household credentials are the two '
    || 'that went, its rsvp credential survived the statement that names two kinds, and no credential of a '
    || 'wedding this tier never took down is revoked anywhere',
    (SELECT count(*) FROM private.access_tokens t WHERE t.wedding_id = v_w1
          AND t.token_kind IN ('public_invitation', 'guest_invitation')
          AND t.revoked_at IS NOT NULL) = 2
    AND (SELECT count(*) FROM private.access_tokens t WHERE t.wedding_id = v_w1
          AND t.token_kind = 'rsvp' AND t.revoked_at IS NULL) = 1
    AND (SELECT count(*) FROM private.access_tokens t WHERE t.revoked_at IS NOT NULL
          AND t.wedding_id NOT IN (v_w1, v_w2,
                '0b0b0b00-0000-4000-8000-000000000003'::uuid,
                '0b0b0b00-0000-4000-8000-000000000005'::uuid)) = 0);

  PERFORM pg_temp.s11r_cell('RC05',
    'only the artefacts that had bytes were invalidated, and only on the taken-down wedding: w1''s two ready '
    || 'rows carry the shipped reason and a stamp, while its registered and failed rows keep their status, '
    || 'their attempt count and their error text',
    (SELECT count(*) FROM public.invitation_outputs o WHERE o.wedding_id = v_w1
          AND o.status = 'invalidated' AND o.invalidation_reason = 'publication_revoked'
          AND o.invalidated_at IS NOT NULL) = 2
    AND (SELECT count(*) FROM public.invitation_outputs o WHERE o.wedding_id = v_w1
          AND o.status = 'invalidated' AND o.id = '0b0b0b00-0000-4000-8000-000000000703'::uuid) = 0
    AND (SELECT count(*) FROM public.invitation_outputs o
          WHERE o.id = '0b0b0b00-0000-4000-8000-000000000703'::uuid
            AND o.status = 'registered' AND o.invalidated_at IS NULL) = 1
    AND (SELECT count(*) FROM public.invitation_outputs o
          WHERE o.id = '0b0b0b00-0000-4000-8000-000000000704'::uuid
            AND o.status = 'failed' AND o.attempt_count = 1
            AND o.last_error = 'the render worker refused the page box'
            AND o.invalidated_at IS NULL) = 1);

  PERFORM pg_temp.s11r_cell('RC06',
    'the thread is scoped to the act: A''s ticket carries exactly one operation_link row, minted with the '
    || 'ordinal this case has never had before, keyless of the two refusals and with no body or status move on '
    || 'a message-free arm; B''s ticket, which was refused, carries none',
    (SELECT count(*) FROM private.support_case_events e WHERE e.case_id = v_caseA) = 1
    AND (SELECT count(*) FROM private.support_case_events e WHERE e.case_id = v_caseA
          AND e.kind = 'operation_link' AND e.seq = 1 AND e.body IS NULL
          AND e.to_status IS NULL AND e.actor_kind = 'operator'
          AND e.idempotency_key = '0b0b0b00-0000-4000-8000-000000000301'::uuid) = 1
    AND (SELECT count(*) FROM private.support_case_events e WHERE e.case_id = v_caseB) = 0);

  -- ------------------------------------------------------------------ arm 2: one key, two deliveries
  PERFORM pg_temp.s11r_cell('RC07',
    'the replayed key bought exactly one act: one trail row for w2, one for the key, and the key''s row is the '
    || 'wedding''s row — the pre-read at the top of the body is what answered the second delivery, so the '
    || 'unique index never had to',
    (SELECT count(*) FROM private.audit_events a WHERE a.idempotency_key = v_key2) = 1
    AND (SELECT count(*) FROM private.audit_events a WHERE a.wedding_id = v_w2
          AND a.action = 'publication_takedown') = 1
    AND (SELECT count(*) FROM private.audit_events a WHERE a.wedding_id = v_w2
          AND a.idempotency_key = v_key2) = 1);

  PERFORM pg_temp.s11r_cell('RC08',
    'what a replay returns is the first delivery''s own recorded answer, field for field: the stored payload '
    || 'names w2, its publication, the reason the operator gave, the case that authorised it, and the two '
    || 'effect counts — and it states its own limit twice, that the file links survive and that no object was '
    || 'deleted',
    v_pub ->> 'wedding_id' = v_w2::text
    AND v_pub ->> 'publication_id' = (SELECT p.id::text FROM public.publications p
                                       WHERE p.wedding_id = v_w2)
    AND v_pub ->> 'reason_category' = 'legal'
    AND v_pub ->> 'case_ref' = (SELECT c.case_ref FROM private.support_cases c
                                 WHERE c.id = v_case3)
    AND v_pub ->> 'credentials_revoked' = '1'
    AND v_pub ->> 'outputs_invalidated' = '1'
    AND (v_pub -> 'file_links_still_valid_until_object_purge')::text = 'true'
    AND (v_pub -> 'objects_deleted_by_this_call')::text = 'false');

  PERFORM pg_temp.s11r_cell('RC09',
    'the second delivery moved nothing at all, in any of the four stores the body writes: w2 has one revoked '
    || 'credential, one invalidated artefact, one thread row and one trail row for two deliveries — which is '
    || 'the difference between a replay and a second revocation, and the reason a re-stamped revoked_at would '
    || 'have been a finding',
    (SELECT count(*) FROM private.access_tokens t WHERE t.wedding_id = v_w2
          AND t.revoked_at IS NOT NULL) = 1
    AND (SELECT count(*) FROM public.invitation_outputs o WHERE o.wedding_id = v_w2
          AND o.status = 'invalidated') = 1
    AND (SELECT count(*) FROM private.support_case_events e WHERE e.case_id = v_case3) = 1
    AND (SELECT count(*) FROM private.audit_events a WHERE a.wedding_id = v_w2) = 1);
END $$;

SELECT 'STAGE11 RACE TESTS PASSED (' ||
       coalesce(nullif(current_setting('s11f.passed', true), ''), '0')::int || ')' AS result;
