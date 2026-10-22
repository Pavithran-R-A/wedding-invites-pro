-- Stage 11 battery 2: the support workflow — who may open, read, claim, answer, move and close a case,
-- measured at the database rather than at a screen.
--
-- Run by `supabase/tests/stage11/run.sh authority` after `80_operator_authority.sql`, on the same chain, in
-- one transaction that commits. The ordering is load-bearing in both directions: slice 1's battery leaves
-- three grant rows and four trail rows behind, so every count in this file is either a *delta* against a
-- baseline captured at the head of its group or a *digest* re-taken after the cells that were supposed not
-- to write. A cell here that asserted "the grant table holds one row" would be measuring slice 1's residue,
-- and would pass for the wrong reason the moment slice 1 grew. S01–S04 re-state that residue as a tripwire:
-- if slice 1's census ever stops matching, this file fails loudly instead of quietly inheriting a different
-- world.
--
-- Scope, and what is deliberately not here. This battery is SQL. It proves the two tables, their CHECKs,
-- the minted ref, the minted seq, the twelve-edge status machine, the ten doors, the caller re-derivation,
-- the per-caller replay anchor, the cross-household refusals, the revocation path and the audit rows the
-- three acting doors write. It does not prove that an HTTP caller is refused: the caller class that matters
-- — a signed-in host or operator with a real JWT presented to PostgREST — cannot exist in a throwaway
-- Postgres, so `test.uid` stands in for the claim and the wire half belongs to
-- `supabase/tests/api/stage11_operations.test.mjs`. No browser opens a console.
--
--   S01–S24   what the migrations plus slice 1 ship: both new tables empty, RLS on with no policy, no
--             client DML, the three inventories, the trigger/constraint/index sets, the FK delete rules, and
--             the residue this file inherits.
--   P01–P18   the privilege layer, role by role: `anon` refused the function, a plain host refused by the
--             body of every operator door, `service_role` refused by the schema, and the direct
--             `internal_api` call answering with the *same* sentence as the wrapper — which is the proof
--             that hiding the wrapper would not be the boundary.
--   G01–G06   the two `support` grants this file's own cast needs, minted through slice 1's body so the
--             credential under test is the real one, and the wall that keeps the three other duties out.
--   O01–O73   the host's four doors: the open vocabulary and its bounds, the minted ref, the seq-1 row, the
--             list filters and the documented tie-break, the single-case read and its no-oracle sentence,
--             the reply rules, and the cross-wedding refusals in both directions.
--   R01–R33   replay, including the repair: the same key from the same account returns the same ticket and
--             writes nothing; the same key from a *different* account gets its own ticket and cannot read
--             the first one; both doors that take a key are measured both ways.
--   C01–C96   the operator's five doors: queue filters, the wider single-case projection, the two note
--             kinds, claim and handover, release, and the refusals a second operator meets.
--   L01–L89   the status machine: one legal walk, every ordered pair measured against the edge table, the
--             terminal state, the reopen that clears a resolution, and the resting-pair rules at the table.
--   X00–X32   cross-household reads and the no-oracle rule: a foreign ref and an invented ref must answer
--             with the identical sentence, and a host's read must not show the operator-only arms.
--   V01–V65   revocation: a revoked operator's doors shut on the same session that opened them, an expired
--             grant refuses without any cleanup job, and the wall between the four duties holds.
--   A00–A27   the trail: the acts that wrote audit rows, the notes that did not, the identity of the
--             actor/decider pair, and the append-only posture on every column.
--   T01–T72   the rules no door hands you: hand plants against every CHECK and both INSERT guards, the FK
--             that refuses to orphan a thread, the minter's refusals, the seq that stays contiguous, and
--             the statements the append-only triggers refuse.
--   T-RI0–T-RI2o  the accepting half of referential nulling: a host's ticket survives the erasure of its
--             requester with both links NULL, and the account every trail row names is erased while the
--             rows, the credentials it minted and every other byte of both tables stay.
--   Z01–Z10   the census this file leaves behind — seven tickets, contiguous threads, no dangling link, the
--             erasure's own authorless rows — and the floor.
--
-- Six postures this file takes because the naive version of each is wrong.
--   1. A door is called as a *role*, through `pg_temp.s11b_as`, never as the owner. Calling
--      `internal_api.x()` directly as `postgres` measures the body's own checks and hides the REVOKE that
--      is supposed to stop the request one layer earlier; P13 and P14 run both and assert they answer
--      alike, which is what §"don't expose an admin console by hiding links" actually claims.
--   2. Every refusal is asserted twice: as SQLSTATE plus sentence, and as the digest of the table that did
--      not move. A guard that raised after writing half its effects — a status row without the trail row, a
--      claim that took the case and lost the assignee — passes a message-only test.
--   3. The status machine is measured as a matrix, not as a list of favourite edges. `probe` opens a legal
--      case, walks it to one state, and tries one edge, in a nested block that always rolls back; the
--      accepted/refused answer for all 6×6 minus the trivially-equal pairs is therefore comparable, and a
--      thirteenth edge appearing in the table would show up as an ACCEPTED in a cell that expects a 23514.
--   4. Plants are undone and the undo is proved. A hand plant that reaches a CHECK the bodies cannot reach
--      is the only way to test that CHECK; leaving it behind would make the next cell's count a fiction, so
--      each group ends by re-taking the digest it started with.
--   5. The replay anchor is asserted in both directions. One cell proving "a repeat gives the same ticket"
--      is satisfied by a lookup on the key alone — which was the first draft's bug, measured in
--      `q11-logs/s11-s2-replay-probe-1.txt`. The repair only shows up as a second cell: a *different*
--      account, same key, must get its own ticket and must not be able to read the first.
--   6. Authorisation is asserted as a fact about the database, not about a UI. Every operator door is
--      refused by a real signed-in account before G01 grants anything and again after V01 revokes it, on
--      the same session GUCs, so "hidden controls" cannot be what is doing the work.

SET client_min_messages = notice;
SET search_path = public, pg_temp;

SELECT set_config('s11b.passed', '0', false);

-- --------------------------------------------------------------------------- the harness
-- Cloned from slice 1's battery rather than shared: two batteries in one namespace would mean a helper
-- rename in one file silently breaking the other, and the runner applies them to the same database in the
-- same session when a future slice globs a third file.
CREATE FUNCTION pg_temp.s11b_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s11b.passed',
    (coalesce(nullif(current_setting('s11b.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s11b_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11b_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11b_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11b_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11b_array(label text, got text[], want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label,
      array_to_string(coalesce(got, ARRAY[]::text[]), ', '),
      array_to_string(coalesce(want, ARRAY[]::text[]), ', ');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11b_add(1);
END $fn$;

-- The keys a door is allowed to answer with, sorted. A body that starts returning a whole row is how the
-- column the next migration adds reaches an operator screen without anybody reviewing it.
CREATE FUNCTION pg_temp.s11b_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % not an object', label, coalesce(jsonb_typeof(v), 'NULL');
  END IF;
  PERFORM pg_temp.s11b_array(label,
    (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
       FROM jsonb_object_keys(v) k), want);
END $fn$;

CREATE FUNCTION pg_temp.s11b_err_is(label text, got text, want_state text, want_like text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got IS NULL OR split_part(got, ' | ', 1) <> want_state OR got NOT LIKE want_like THEN
    RAISE EXCEPTION 'FAIL %: got [%] want [% / %]', label, got, want_state, want_like;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11b_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11b_accept(label text, got text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'FAIL %: expected the statement to be accepted, it heard [%]', label, got;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11b_add(1);
END $fn$;

-- Call a door as one of the three roles a request can arrive as, with that role's own claimed uid, and get
-- the answer back as jsonb. `_error` is how a refusal cell reads the body's own sentence instead of the
-- harness breaking; a cell that got a plain NULL answer would be asserting against a door that returned
-- nothing rather than against a door that refused. `RESET ROLE` and the cleared `test.uid` on both paths,
-- because the ordinary return is the success path and a probe that left the session inside `authenticated`
-- would make every later cell answer as the wrong caller.
CREATE FUNCTION pg_temp.s11b_as(p_role text, p_uid uuid, p_stmt text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  IF p_role NOT IN ('anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  PERFORM set_config('test.uid', coalesce(p_uid::text, ''), false);
  PERFORM set_config('test.role', p_role, false);
  BEGIN
    EXECUTE p_stmt INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('test.uid', '', false);
    RETURN jsonb_build_object('_error', SQLSTATE || ' | ' || SQLERRM);
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.uid', '', false);
  IF v IS NULL THEN
    RETURN jsonb_build_object('_null_answer', true);
  END IF;
  RETURN v;
END $fn$;

-- The error half of an answer, as text, for the cells that only need to be refused.
CREATE FUNCTION pg_temp.s11b_err(v jsonb) RETURNS text
LANGUAGE sql STABLE AS $fn$ SELECT v ->> '_error' $fn$;

-- A read as another role, for the cells whose subject is a table rather than a door.
CREATE FUNCTION pg_temp.s11b_try(p_role text, p_uid uuid, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  PERFORM set_config('test.uid', coalesce(p_uid::text, ''), false);
  PERFORM set_config('test.role', p_role, false);
  BEGIN
    EXECUTE stmt INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('test.uid', '', false);
    RETURN SQLSTATE || ' | ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.uid', '', false);
  RETURN coalesce(v, '(null)');
END $fn$;

-- A write probe that *always* rolls back, so an accepted plant and a refused plant leave the same chain
-- behind. The inner block catches everything; after a plant that was accepted the deliberate exception
-- unwinds it, and after a plant that was refused the same exception replaces the refusal's own message with
-- the marker — which is why the helper returns the pre-computed answer text rather than a SQLSTATE read
-- afterwards. This is the instrument the 25-pair status matrix and every hand plant runs through: without
-- it, "the edge open→resolved is refused" would require a legal case in state `open` for every cell, and
-- the accepted cells would destroy the ones that follow them.
CREATE FUNCTION pg_temp.s11b_probe(p_role text, p_uid uuid, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_answer text;
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  PERFORM set_config('test.uid', coalesce(p_uid::text, ''), false);
  PERFORM set_config('test.role', p_role, false);
  -- Three blocks, not two. The innermost one holds the statement so its own exception cannot escape and
  -- the answer can be captured; the middle one raises a marker *after* the answer is captured, and its
  -- handler swallows the marker while aborting the subtransaction that the inner block's successful work
  -- was merged into. Without the third level, an accepted plant would either stay on the chain or unwind
  -- the battery's own transaction, and the matrix below would measure whichever one it broke.
  BEGIN
    BEGIN
      BEGIN
        EXECUTE stmt;
        v_answer := 'ACCEPTED';
      EXCEPTION WHEN OTHERS THEN
        v_answer := SQLSTATE || ' | ' || SQLERRM;
      END;
      RAISE EXCEPTION 's11b_probe_rolled_back';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.uid', '', false);
  RETURN v_answer;
END $fn$;

-- --------------------------------------------------------------------------- the digests
-- Every column of the two new tables, plus the two slice-1 tables this file writes through, each as one
-- string in identity order. Six of the groups below take a digest before a set of refusals and re-take it
-- after; "the refusal wrote nothing" is only evidence when it is the same string, and the count alone
-- cannot see a row that was updated instead of inserted.
CREATE FUNCTION pg_temp.s11b_cstate() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || case_ref || '|' || coalesce(wedding_id::text,'') || '|'
           || requester_user_id::text || '|' || opened_by_user_id::text || '|' || category || '|'
           || severity || '|' || status || '|' || host_summary || '|'
           || coalesce(assigned_operator_user_id::text,'') || '|' || coalesce(resolution_code,'') || '|'
           || coalesce(resolved_at::text,'') || '|' || opened_at::text || '|' || updated_at::text || '|'
           || coalesce(open_idempotency_key::text,''), '~' ORDER BY id), ''))
    FROM private.support_cases $fn$;

CREATE FUNCTION pg_temp.s11b_ccount() RETURNS bigint
LANGUAGE sql STABLE AS $fn$ SELECT count(*) FROM private.support_cases $fn$;

CREATE FUNCTION pg_temp.s11b_estate() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || case_id::text || '|' || seq::text || '|' || kind || '|'
           || coalesce(actor_user_id::text,'') || '|' || actor_kind || '|'
           || coalesce(from_status,'') || '|' || coalesce(to_status,'') || '|'
           || coalesce(body,'') || '|' || coalesce(idempotency_key::text,'') || '|' || created_at::text,
             '~' ORDER BY id), ''))
    FROM private.support_case_events $fn$;

CREATE FUNCTION pg_temp.s11b_ecount() RETURNS bigint
LANGUAGE sql STABLE AS $fn$ SELECT count(*) FROM private.support_case_events $fn$;

-- Slice 1's two tables, digested rather than counted: this file grants a credential, acts through the
-- doors that depend on it, and revokes it, and the claim at the end of group V is that the *other* rows in
-- those tables — the ones slice 1's own battery left — did not move while mine were written.
CREATE FUNCTION pg_temp.s11b_gstate() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || user_id::text || '|' || scope || '|' || status || '|' || reason || '|'
           || coalesce(granted_by_user_id::text,'') || '|' || granted_at::text || '|'
           || coalesce(expires_at::text,'') || '|' || coalesce(revoked_at::text,'') || '|'
           || created_at::text || '|' || updated_at::text, '~' ORDER BY id), ''))
    FROM private.operator_grants $fn$;

CREATE FUNCTION pg_temp.s11b_adigest() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || coalesce(wedding_id::text,'') || '|' || subject_type || '|'
           || coalesce(subject_key::text,'') || '|' || action || '|' || actor_role || '|'
           || coalesce(actor_user_id::text,'') || '|' || payload::text || '|'
           || created_at::text || '|' || actor_kind || '|' || coalesce(reason,'') || '|'
           || coalesce(idempotency_key,'') || '|' || coalesce(before_state::text,'') || '|'
           || coalesce(after_state::text::text,''), '~' ORDER BY id), ''))
    FROM private.audit_events $fn$;

CREATE FUNCTION pg_temp.s11b_acount() RETURNS bigint
LANGUAGE sql STABLE AS $fn$ SELECT count(*) FROM private.audit_events $fn$;

-- The predicate, read the way the six operator doors read it: as the owner, with the caller's uid claimed
-- in the session. Group P and group V both need to know whether a refusal came from the predicate saying
-- no or from the body breaking on the way there.
CREATE FUNCTION pg_temp.s11b_is(p_uid uuid, p_scope text) RETURNS boolean
LANGUAGE plpgsql AS $fn$
DECLARE v boolean;
BEGIN
  PERFORM set_config('test.uid', coalesce(p_uid::text, ''), false);
  PERFORM set_config('test.role', 'authenticated', false);
  BEGIN
    SELECT private.actor_is_operator(p_scope) INTO v;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('test.uid', '', false);
    RETURN NULL;
  END;
  PERFORM set_config('test.uid', '', false);
  RETURN v;
END $fn$;

-- --------------------------------------------------------------------------- the cast
-- Seven accounts, three weddings and one uuid that is nobody.
--   host_a owns wedding `wa` and holds the thread this file walks; host_b owns `wb` and is the stranger
--     whose ref host_a must not be able to tell apart from a ref that does not exist; host_c owns nothing,
--     which is the shape of "a case may be about an account rather than a wedding"; host_x owns `wx` and
--     carries the FK and edge cells; host_d owns nothing and is *deleted* in group T to measure the
--     ON DELETE SET NULL on the requester column.
--   op1 and op2 are two granted support operators, because the claim/release rules are about two humans and
--     cannot be measured with one. `decider` mints the grants and never holds one, so every trail row this
--     file writes proves `actor_user_id` and the console's named human are different columns.
CREATE TEMP TABLE s11b_cast ON COMMIT DROP AS
SELECT gen_random_uuid() AS host_a, gen_random_uuid() AS host_b, gen_random_uuid() AS host_c,
       gen_random_uuid() AS host_x, gen_random_uuid() AS host_d,
       gen_random_uuid() AS op1, gen_random_uuid() AS op2, gen_random_uuid() AS decider,
       gen_random_uuid() AS ghost,
       gen_random_uuid() AS wa, gen_random_uuid() AS wb, gen_random_uuid() AS wx;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT c.host_a,   's11b-host-a@stage11qual.test',   '{}'::jsonb FROM s11b_cast c
UNION ALL SELECT c.host_b,  's11b-host-b@stage11qual.test',  '{}'::jsonb FROM s11b_cast c
UNION ALL SELECT c.host_c,  's11b-host-c@stage11qual.test',  '{}'::jsonb FROM s11b_cast c
UNION ALL SELECT c.host_x,  's11b-host-x@stage11qual.test',  '{}'::jsonb FROM s11b_cast c
UNION ALL SELECT c.host_d,  's11b-host-d@stage11qual.test',  '{}'::jsonb FROM s11b_cast c
UNION ALL SELECT c.op1,     's11b-op-1@stage11qual.test',    '{}'::jsonb FROM s11b_cast c
UNION ALL SELECT c.op2,     's11b-op-2@stage11qual.test',    '{}'::jsonb FROM s11b_cast c
UNION ALL SELECT c.decider, 's11b-decider@stage11qual.test', '{}'::jsonb FROM s11b_cast c;

INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages,
                             style_settings)
SELECT c.wa, c.host_a, 'Support A weds B', 'en', ARRAY[]::text[], '{}'::jsonb FROM s11b_cast c
UNION ALL
SELECT c.wb, c.host_b, 'Support C weds D', 'ta', ARRAY[]::text[], '{}'::jsonb FROM s11b_cast c
UNION ALL
SELECT c.wx, c.host_x, 'Support E weds F', 'en', ARRAY[]::text[], '{}'::jsonb FROM s11b_cast c;

-- Slice 1's live credential, *discovered* rather than re-minted: this file's cast is its own, and the
-- support grant its battery left is the only `support` row on the chain before G01 runs. Reading it out of
-- the table also means a change to slice 1's residue is caught by S03 below rather than silently inherited.
CREATE TEMP TABLE s11b_slice1 ON COMMIT DROP AS
SELECT g.user_id AS op_a,
       (SELECT count(*) FROM private.operator_grants WHERE status = 'active'
          AND scope = 'support')::int AS support_active_rows
  FROM private.operator_grants g
 WHERE g.scope = 'support' AND g.status = 'active';

-- The registry. Every case this file creates durably is registered under a tag, so a later group names the
-- ticket it means instead of re-deriving a ref from a uuid, and the census can count what was created.
CREATE TEMP TABLE s11b_case (tag text PRIMARY KEY, case_ref text, case_id uuid,
                             requester uuid) ON COMMIT DROP;

CREATE FUNCTION pg_temp.s11b_reg(p_tag text, p_answer jsonb, p_requester uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_answer ? '_error' THEN
    RAISE EXCEPTION 'FAIL: setup could not register case %, the door answered [%]', p_tag,
      p_answer ->> '_error';
  END IF;
  INSERT INTO s11b_case (tag, case_ref, case_id, requester)
    SELECT p_tag, p_answer ->> 'case_ref', c.id, p_requester
      FROM private.support_cases c WHERE c.case_ref = p_answer ->> 'case_ref';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: setup registered %, but no row carries that ref', p_tag;
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.s11b_ref(p_tag text) RETURNS text
LANGUAGE sql STABLE AS $fn$ SELECT case_ref FROM s11b_case WHERE tag = p_tag $fn$;

CREATE FUNCTION pg_temp.s11b_id(p_tag text) RETURNS uuid
LANGUAGE sql STABLE AS $fn$ SELECT case_id FROM s11b_case WHERE tag = p_tag $fn$;

-- One uuid, minted once and reused by every cell that needs a fresh key. Held in a temp table rather than
-- generated inside a statement string because the replay cells have to name the *same* key twice, and the
-- trail's partial unique index means two unrelated cells must not accidentally share one.
CREATE TEMP TABLE s11b_key ON COMMIT DROP AS
SELECT gen_random_uuid() AS k_open_a, gen_random_uuid() AS k_open_b,
       gen_random_uuid() AS k_open_c, gen_random_uuid() AS k_open_x,
       gen_random_uuid() AS k_reply_1, gen_random_uuid() AS k_reply_2,
       gen_random_uuid() AS k_note_1, gen_random_uuid() AS k_note_2,
       gen_random_uuid() AS k_claim_1, gen_random_uuid() AS k_claim_2,
       gen_random_uuid() AS k_claim_3, gen_random_uuid() AS k_release_1,
       gen_random_uuid() AS k_release_2, gen_random_uuid() AS k_trans_1,
       gen_random_uuid() AS k_trans_2, gen_random_uuid() AS k_trans_3,
       gen_random_uuid() AS k_trans_4, gen_random_uuid() AS k_trans_5,
       gen_random_uuid() AS k_shared;

-- Two literal builders, because every door below is called through a dynamic statement and a uuid has to
-- arrive as a uuid. `s11b_u(NULL)` renders the bare word NULL so the same builder serves the "no wedding"
-- case as the case that names one.
CREATE FUNCTION pg_temp.s11b_u(p uuid) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN p IS NULL THEN 'NULL' ELSE quote_literal(p::text) || '::uuid' END $fn$;

CREATE FUNCTION pg_temp.s11b_t(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT coalesce(quote_literal(p), 'NULL') $fn$;

CREATE FUNCTION pg_temp.s11b_n(p numeric) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT coalesce(p::text, 'NULL') $fn$;

-- The one door that takes five arguments is called from three dozen cells below, so its statement string
-- gets a builder rather than thirty hand-written concatenations: a cell that mistypes an argument name is a
-- cell that tests the builder instead of the door.
CREATE FUNCTION pg_temp.s11b_open_sql(p_wedding uuid, p_category text, p_severity text,
                                      p_summary text, p_key uuid)
RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT 'SELECT api.open_support_case(' || pg_temp.s11b_u(p_wedding) || ', '
      || pg_temp.s11b_t(p_category) || ', ' || pg_temp.s11b_t(p_severity) || ', '
      || pg_temp.s11b_t(p_summary) || ', ' || pg_temp.s11b_u(p_key) || ')'
$fn$;

-- ===========================================================================
-- 1. What the schema ships (S01–S24)
-- ===========================================================================
DO $s$
DECLARE c s11b_cast%ROWTYPE; v text;
BEGIN
  SELECT * INTO c FROM s11b_cast;

  -- §14's constraint, re-measured one slice later. Slice 1's battery writes no support row at all, so on
  -- the chain this file runs on the two new tables are still the empty tables the migration created, and
  -- "the workflow has no invented history" is a fact about the schema rather than about a fixture.
  PERFORM pg_temp.s11b_eq('S01 the case table is empty when this file starts: nothing in the migrations '
    || 'creates a ticket, and a chain that arrived here with a row already in it is not the chain this '
    || 'battery is measuring', (SELECT count(*)::int FROM private.support_cases), 0);
  PERFORM pg_temp.s11b_eq('S02 and so is the thread table, which means every seq this file reads back was '
    || 'minted by a door it called', (SELECT count(*)::int FROM private.support_case_events), 0);

  -- The ordering tripwire, stated rather than assumed. Slice 1 commits three grant rows and four trail rows
  -- before this file opens, which is why every number below that could be confused with an absolute is
  -- either a delta or a digest. If slice 1 ever changes its residue, these two cells fail and the reader is
  -- told why the rest of the file counts differently from the one before it.
  PERFORM pg_temp.s11b_eq('S03 slice 1 left the three grant rows its own census counted: this file is '
    || 'running after it on one chain, so its counts are deltas',
    (SELECT count(*)::int FROM private.operator_grants), 3);
  PERFORM pg_temp.s11b_eq('S04 and it left exactly four trail rows, all of them about a grant',
    (SELECT count(*)::int FROM private.audit_events), 4);
  PERFORM pg_temp.s11b_eq('S05 exactly one live `support` credential exists before this file grants '
    || 'anything, and G01 will read that uuid rather than mint a parallel one',
    (SELECT support_active_rows FROM s11b_slice1 LIMIT 1), 1);

  PERFORM pg_temp.s11b_ok('S06 both new tables have RLS enabled, and',
    (SELECT bool_and(c2.relrowsecurity) FROM pg_class c2
      WHERE c2.oid IN ('private.support_cases'::regclass,'private.support_case_events'::regclass)));
  PERFORM pg_temp.s11b_eq('S06b and neither has a policy: an operational table becomes readable through a '
    || 'body that decides, never through a rule a client role can satisfy, so a later mistaken GRANT of '
    || 'SELECT still reveals nothing',
    (SELECT count(*)::int FROM pg_policies
      WHERE schemaname = 'private' AND tablename IN ('support_cases','support_case_events')), 0);

  -- Per command and not per table, for slice 1's reason: `has_table_privilege(…, 'SELECT')` is false under a
  -- column grant, and the claim here is that there is no grant of any kind to hand back.
  PERFORM pg_temp.s11b_eq('S07 no role a request can arrive as holds INSERT/UPDATE/DELETE/SELECT on the '
    || 'case table — including the server key, which is the half a dashboard would silently rely on',
    (SELECT count(*)::int FROM pg_roles r
      WHERE r.rolname IN ('anon','authenticated','service_role')
        AND (has_table_privilege(r.oid,'private.support_cases'::regclass,'INSERT')
          OR has_table_privilege(r.oid,'private.support_cases'::regclass,'UPDATE')
          OR has_table_privilege(r.oid,'private.support_cases'::regclass,'DELETE')
          OR has_table_privilege(r.oid,'private.support_cases'::regclass,'SELECT'))), 0);
  PERFORM pg_temp.s11b_eq('S08 and the same four refusals hold on the thread table',
    (SELECT count(*)::int FROM pg_roles r
      WHERE r.rolname IN ('anon','authenticated','service_role')
        AND (has_table_privilege(r.oid,'private.support_case_events'::regclass,'INSERT')
          OR has_table_privilege(r.oid,'private.support_case_events'::regclass,'UPDATE')
          OR has_table_privilege(r.oid,'private.support_case_events'::regclass,'DELETE')
          OR has_table_privilege(r.oid,'private.support_case_events'::regclass,'SELECT'))), 0);

  PERFORM pg_temp.s11b_eq('S09 the declared api surface is 40 names at this head: the ten doors this '
    || 'slice adds on top of slice 1''s two, slice 3''s four privacy doors and slice 4''s four takedown and '
    || 'oversight doors',
    (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'api'::regnamespace), 40);
  PERFORM pg_temp.s11b_eq('S10 internal_api is 60, and PRIVATE is 52 — two mint triggers, the state-machine '
    || 'guard, and a specialised UPDATE/INSERT guard pair per trail, because a referential SET NULL has to be '
    || 'distinguishable from a rewrite and the anti-forgery rule must not fire on that UPDATE at all, plus '
    || 'slice 3''s four privacy mirrors and the three private functions behind `private.privacy_requests`, '
    || 'plus slice 4''s five bodies and four private functions — and note that slice 4 adds five bodies but '
    || 'only four wrappers, because the purge step has no door',
    (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'internal_api'::regnamespace), 60);
  PERFORM pg_temp.s11b_eq('S10b measured as its own cell so a helper leaking into a privileged namespace '
    || 'moves one number and not the other',
    (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'private'::regnamespace), 52);

  PERFORM pg_temp.s11b_array('S11 the ten host- and operator-facing names, by name rather than by count: '
    || 'a door renamed is a door a screen stops calling',
    (SELECT coalesce(array_agg(p.proname ORDER BY p.proname COLLATE "C"), '{}'::text[])
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api'
        AND p.proname IN ('open_support_case','get_my_support_cases','get_my_support_case',
                          'reply_to_support_case','operator_case_queue','get_operator_case',
                          'operator_add_case_note','operator_claim_case','operator_release_case',
                          'operator_transition_case')),
    ARRAY['get_my_support_case','get_my_support_cases','get_operator_case','open_support_case',
          'operator_add_case_note','operator_case_queue','operator_claim_case','operator_release_case',
          'operator_transition_case','reply_to_support_case']);
  PERFORM pg_temp.s11b_eq('S12 every wrapper has a body of the same name in `internal_api`, so the pair is '
    || 'ten and not nine-with-an-orphoned-wrapper',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'internal_api'
        AND p.proname IN ('open_support_case','get_my_support_cases','get_my_support_case',
                          'reply_to_support_case','operator_case_queue','get_operator_case',
                          'operator_add_case_note','operator_claim_case','operator_release_case',
                          'operator_transition_case')), 10);

  PERFORM pg_temp.s11b_eq('S13 all ten wrappers are SECURITY INVOKER with an empty search_path: the '
    || 'wrapper is a name, not a privilege',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api'
        AND p.proname IN ('open_support_case','get_my_support_cases','get_my_support_case',
                          'reply_to_support_case','operator_case_queue','get_operator_case',
                          'operator_add_case_note','operator_claim_case','operator_release_case',
                          'operator_transition_case')
        AND p.prosecdef = false AND p.proconfig @> ARRAY['search_path=""']), 10);
  PERFORM pg_temp.s11b_eq('S13b and all ten bodies are SECURITY DEFINER with an empty search_path, which '
    || 'is the only reason a caller with no privilege on `private` can still open a ticket',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'internal_api'
        AND p.proname IN ('open_support_case','get_my_support_cases','get_my_support_case',
                          'reply_to_support_case','operator_case_queue','get_operator_case',
                          'operator_add_case_note','operator_claim_case','operator_release_case',
                          'operator_transition_case')
        AND p.prosecdef = true AND p.proconfig @> ARRAY['search_path=""']), 10);

  -- The grant, read out of the ACL rather than through `has_function_privilege(…, 'public', …)`, because
  -- that pseudo-role has no lookupable OID and a NULL `proacl` *means* PUBLIC holds the privilege. Reading
  -- the list catches both halves: `authenticated=X` present, `=*X/` absent.
  PERFORM pg_temp.s11b_eq('S14 all twenty names carry an explicit EXECUTE grant to `authenticated` and no '
    || 'grant to PUBLIC — measured from pg_proc.proacl, where a NULL list would mean the opposite of what '
    || 'a REVOKE intended',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api','internal_api')
        AND p.proname IN ('open_support_case','get_my_support_cases','get_my_support_case',
                          'reply_to_support_case','operator_case_queue','get_operator_case',
                          'operator_add_case_note','operator_claim_case','operator_release_case',
                          'operator_transition_case')
        AND p.proacl::text[] IS NOT NULL
        AND array_to_string(p.proacl::text[], ',') LIKE '%authenticated=X/%'
        AND array_to_string(p.proacl::text[], ',') NOT LIKE '%=*X/%'), 20);
  PERFORM pg_temp.s11b_eq('S14b and neither `anon` nor `service_role` can execute any of the twenty: the '
    || 'server key is not an operator, which is the claim §4 makes about every stage since 3',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api','internal_api')
        AND p.proname IN ('open_support_case','get_my_support_cases','get_my_support_case',
                          'reply_to_support_case','operator_case_queue','get_operator_case',
                          'operator_add_case_note','operator_claim_case','operator_release_case',
                          'operator_transition_case')
        AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('service_role', p.oid, 'EXECUTE'))), 0);

  PERFORM pg_temp.s11b_array('S15 the case table''s fourteen constraints, named: this array is the '
    || 'evidence that the CHECKs and the two unique keys are the ones this slice wrote and not the ones a '
    || 'later edit quietly dropped',
    (SELECT coalesce(array_agg(conname ORDER BY conname COLLATE "C"), '{}'::text[])
       FROM pg_constraint WHERE conrelid = 'private.support_cases'::regclass),
    ARRAY['support_cases_assigned_operator_user_id_fkey','support_cases_case_ref_check',
          'support_cases_case_ref_key','support_cases_category_check',
          'support_cases_host_summary_check','support_cases_opened_by_user_id_fkey',
          'support_cases_pkey','support_cases_requester_user_id_fkey',
          'support_cases_resolution_code_check','support_cases_resting_after_open_check',
          'support_cases_resting_pair_check','support_cases_severity_check',
          'support_cases_status_check','support_cases_wedding_id_fkey']);
  PERFORM pg_temp.s11b_array('S16 and the thread''s twelve. The thirteenth that used to be here — '
    || '`support_case_events_actor_names_an_account_check` — was removed rather than renamed: a table CHECK '
    || 'also fires on the UPDATE the database performs for `ON DELETE SET NULL`, so as a CHECK it refused the '
    || 'very thread whose account was deleted, and made that account undeletable. The rule is now the '
    || 'BEFORE INSERT trigger S20 names, which refuses the same hand plant with the same SQLSTATE and is '
    || 'silent on an UPDATE — measured both ways in group T',
    (SELECT coalesce(array_agg(conname ORDER BY conname COLLATE "C"), '{}'::text[])
       FROM pg_constraint WHERE conrelid = 'private.support_case_events'::regclass),
    ARRAY['support_case_events_actor_kind_check',
          'support_case_events_actor_user_id_fkey','support_case_events_body_bounded_check',
          'support_case_events_body_pairs_message_check','support_case_events_case_id_fkey',
          'support_case_events_from_status_check','support_case_events_kind_check',
          'support_case_events_pkey','support_case_events_seq_check',
          'support_case_events_status_kind_check','support_case_events_status_moves_check',
          'support_case_events_to_status_check']);
  PERFORM pg_temp.s11b_array('S17 the case table''s five indexes, including the per-caller open-key index '
    || 'that makes a replay a lookup instead of a leak',
    (SELECT coalesce(array_agg(indexname ORDER BY indexname COLLATE "C"), '{}'::text[])
       FROM pg_indexes WHERE schemaname = 'private' AND tablename = 'support_cases'),
    ARRAY['support_cases_case_ref_key','support_cases_open_key_uniq','support_cases_pkey',
          'support_cases_requester_opened_idx','support_cases_status_opened_idx']);
  PERFORM pg_temp.s11b_array('S18 and the thread''s three: one key index, one seq index, one primary key',
    (SELECT coalesce(array_agg(indexname ORDER BY indexname COLLATE "C"), '{}'::text[])
       FROM pg_indexes WHERE schemaname = 'private' AND tablename = 'support_case_events'),
    ARRAY['support_case_events_one_row_per_key','support_case_events_pkey',
          'support_case_events_seq_per_case_uniq']);
  PERFORM pg_temp.s11b_array('S19 the case table''s five triggers: a ref mint, an update guard, the '
    || 'client-write and client-delete pair, and the shared timestamp touch',
    (SELECT coalesce(array_agg(t.tgname || '=' || p.proname
                              ORDER BY t.tgname COLLATE "C"), '{}'::text[])
       FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = 'private.support_cases'::regclass AND NOT t.tgisinternal),
    ARRAY['set_updated_at=touch_updated_at','support_cases_guard_update=guard_support_case_update',
          'support_cases_mint_ref=mint_support_case_ref',
          'support_cases_no_client_delete=reject_client_delete',
          'support_cases_no_client_write=reject_client_write']);
  PERFORM pg_temp.s11b_array('S20 and the thread''s five. `reject_case_event_update_except_referential_null` '
    || 'refuses UPDATE to every role including its own owner, because an insert-only history has no '
    || 'legitimate update — except the nulling of `actor_user_id` that arrives from inside the database''s own '
    || 'referential trigger, which is the one hole group T measures from both sides. '
    || '`support_case_events_actor_names_a_human` is the anti-forgery rule that moved out of a CHECK to sit '
    || 'beside it',
    (SELECT coalesce(array_agg(t.tgname || '=' || p.proname
                              ORDER BY t.tgname COLLATE "C"), '{}'::text[])
       FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = 'private.support_case_events'::regclass AND NOT t.tgisinternal),
    ARRAY['support_case_events_actor_names_a_human=reject_case_event_without_actor',
          'support_case_events_mint_seq=mint_support_case_seq',
          'support_case_events_no_client_delete=reject_client_delete',
          'support_case_events_no_client_write=reject_client_write',
          'support_case_events_no_update_any_role=reject_case_event_update_except_referential_null']);
  PERFORM pg_temp.s11b_array('S21 the six foreign keys with their delete rules: a thread refuses to be '
    || 'orphaned (a = NO ACTION) while an account leaving takes its names with it (n = SET NULL), and the '
    || 'two columns that must not vanish on their own are the ones the guard trigger protects',
    (SELECT coalesce(array_agg(con.conname || ':' || con.confdeltype::text
                                ORDER BY con.conname COLLATE "C"), '{}'::text[])
       FROM pg_constraint con
      WHERE con.conrelid IN ('private.support_cases'::regclass,
                             'private.support_case_events'::regclass)
        AND con.contype = 'f'),
    ARRAY['support_case_events_actor_user_id_fkey:n','support_case_events_case_id_fkey:a',
          'support_cases_assigned_operator_user_id_fkey:n',
          'support_cases_opened_by_user_id_fkey:n','support_cases_requester_user_id_fkey:n',
          'support_cases_wedding_id_fkey:a']);

  -- The structural half of "a browser cannot name the person it wants to become". Every argument on every
  -- one of the twenty names is a ref, a category, a severity, a status, a body, a limit or a key.
  PERFORM pg_temp.s11b_eq('S22 no door takes an argument that could be a person: nothing in the twenty '
    || 'signatures is named for an account, an email or an actor, so handover has to be two acts rather '
    || 'than one argument',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api','internal_api')
        AND p.proname IN ('open_support_case','get_my_support_cases','get_my_support_case',
                          'reply_to_support_case','operator_case_queue','get_operator_case',
                          'operator_add_case_note','operator_claim_case','operator_release_case',
                          'operator_transition_case')
        AND EXISTS (SELECT 1 FROM unnest(coalesce(p.proargnames, '{}'::text[])) AS arg
                     WHERE arg ~* '(user|actor|operator|email|assignee|decider)')), 0);
  PERFORM pg_temp.s11b_eq('S23 and there is no assign door at all: `operator_assign_case` does not exist '
    || 'in either namespace, which is the difference between this stage''s queue and an escalation tool',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api','internal_api') AND p.proname = 'operator_assign_case'), 0);

  v := pg_temp.s11b_try('authenticated', c.host_a,
    'SELECT private.mint_support_case_ref()');
  PERFORM pg_temp.s11b_err_is('S24 the two mint triggers and the guard are unreachable by hand: a host '
    || 'cannot mint its own ref, and the layer that stops it is the schema rather than the object, because '
    || '`authenticated` was never given USAGE on `private` — slice 1''s A09 measured the same wall',
    v, '42501', '%permission denied for schema private%');
END $s$;

-- ===========================================================================
-- 2. The privilege layer, before anybody in this file holds a credential (P01–P18)
-- ===========================================================================
-- Nothing here has granted anything yet: S05 measured exactly one live `support` row, and it belongs to
-- slice 1's cast, not to this one. So every refusal below is the state a fresh deployment is in, which is
-- the state §14's "no live operator authority is granted by this kickoff document" describes — and the
-- reason G01 has to come after this group rather than before it.
DO $p$
DECLARE c s11b_cast%ROWTYPE;
        v jsonb; t text;
        pairs text[][];
        d0c text; d0e text; d0a text; d0g text;
BEGIN
  SELECT * INTO c FROM s11b_cast;
  d0c := pg_temp.s11b_cstate(); d0e := pg_temp.s11b_estate();
  d0a := pg_temp.s11b_adigest(); d0g := pg_temp.s11b_gstate();

  -- `anon` has no EXECUTE on any door, so it hears the function denial one layer before a body could answer.
  v := pg_temp.s11b_as('anon', NULL,
    'SELECT api.open_support_case(NULL, NULL, NULL, NULL, NULL)');
  PERFORM pg_temp.s11b_err_is('P01 an anonymous caller cannot open a case: the refusal is the EXECUTE '
    || 'revocation, not a check inside the body', pg_temp.s11b_err(v), '42501',
    '%permission denied for function open_support_case%');

  v := pg_temp.s11b_as('anon', NULL, 'SELECT api.operator_case_queue(NULL, NULL, NULL)');
  PERFORM pg_temp.s11b_err_is('P02 and cannot read the operator queue either — the queue is not a public '
    || 'list that a screen hides', pg_temp.s11b_err(v), '42501',
    '%permission denied for function operator_case_queue%');

  v := pg_temp.s11b_as('anon', NULL, 'SELECT api.get_operator_case(' || quote_literal('SV-ABCDEFGH') || ')');
  PERFORM pg_temp.s11b_err_is('P03 and cannot read one case by ref, with or without a ref that looks real',
    pg_temp.s11b_err(v), '42501', '%permission denied for function get_operator_case%');

  -- The server key is refused by the schema, exactly as slice 1 measured: it is not an operator, and a
  -- dashboard that reaches for it has already lost the audit trail.
  v := pg_temp.s11b_as('service_role', NULL,
    'SELECT api.open_support_case(NULL, NULL, NULL, NULL, NULL)');
  PERFORM pg_temp.s11b_err_is('P04 the server key has no USAGE on `api`, so it cannot open a case as '
    || 'somebody else — the wall is one layer earlier than the function, and that is a fact about how this '
    || 'schema is exposed rather than about this door', pg_temp.s11b_err(v), '42501',
    '%permission denied for schema api%');

  v := pg_temp.s11b_as('service_role', NULL, 'SELECT api.operator_transition_case(NULL,NULL,NULL,NULL,NULL)');
  PERFORM pg_temp.s11b_err_is('P05 the same refusal covers the most dangerous door in the slice',
    pg_temp.s11b_err(v), '42501', '%permission denied for schema api%');

  v := pg_temp.s11b_as('service_role', NULL,
    'SELECT internal_api.operator_transition_case(NULL,NULL,NULL,NULL,NULL)');
  PERFORM pg_temp.s11b_err_is('P06 and going straight at the definer body is refused by its own schema: '
    || 'the bodies are reachable from a wrapper and from nothing else a request can present',
    pg_temp.s11b_err(v), '42501', '%permission denied for schema internal_api%');

  -- A session with no claimed account is the shape of a token that expired mid-form. The body answers,
  -- because `authenticated` does hold EXECUTE — which is the point: the grant is not the authorisation.
  v := pg_temp.s11b_as('authenticated', NULL,
    'SELECT api.open_support_case(NULL, NULL, NULL, NULL, NULL)');
  PERFORM pg_temp.s11b_err_is('P07 an authenticated session that re-derives no account is refused by the '
    || 'body''s own first line', pg_temp.s11b_err(v), '42501', '%this door needs a signed-in account%');

  v := pg_temp.s11b_as('authenticated', NULL, 'SELECT api.get_my_support_cases(NULL, NULL)');
  PERFORM pg_temp.s11b_err_is('P08 the same on the read side, where a NULL uid would otherwise have '
    || 'answered with an empty list and looked like an account with no tickets',
    pg_temp.s11b_err(v), '42501', '%this door needs a signed-in account%');

  -- The six operator doors, refused by a real signed-in host who holds nothing. This is the directive's
  -- hostile-role requirement measured as the database's answer, and it is measured *before* G01 so that
  -- the later success path cannot be read as the only path these doors know.
  pairs := ARRAY[
    ['api.operator_case_queue(NULL, NULL, NULL)',            'the caller may not read the case queue'],
    ['api.get_operator_case(' || quote_literal('SV-ABCDEFGH') || ')', 'the caller may not read this support case'],
    ['api.operator_add_case_note(NULL, NULL, NULL, NULL)',   'the caller may not add a note to this support case'],
    ['api.operator_claim_case(NULL, NULL)',                  'the caller may not claim this support case'],
    ['api.operator_release_case(NULL, NULL)',                'the caller may not release this support case'],
    ['api.operator_transition_case(NULL, NULL, NULL, NULL, NULL)', 'the caller may not change this support case']];
  FOR i IN 1 .. array_length(pairs, 1) LOOP
    v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT ' || pairs[i][1]);
    PERFORM pg_temp.s11b_err_is('P09.' || i || ' a signed-in host with no grant is refused by '
      || pairs[i][1] || ' — and refused by the predicate, not by an input rule, because the scoping check '
      || 'is the first statement in the body',
      pg_temp.s11b_err(v), '42501', '%' || pairs[i][2] || '%');
  END LOOP;

  -- The wrapper is not the boundary. The same six sentences come back when `authenticated` calls the
  -- `internal_api` body directly — which is possible, because Stage 3 gave the two request roles USAGE on
  -- that namespace so a wrapper could reach it. If the authorisation lived in the wrapper's existence,
  -- this is the cell that would break.
  v := pg_temp.s11b_as('authenticated', c.host_a,
    'SELECT internal_api.operator_case_queue(NULL, NULL, NULL)');
  PERFORM pg_temp.s11b_err_is('P10 the queue answers the *same* sentence when reached through the body '
    || 'instead of the wrapper: hiding the wrapper would not be the boundary',
    pg_temp.s11b_err(v), '42501', '%the caller may not read the case queue%');

  v := pg_temp.s11b_as('authenticated', c.host_a,
    'SELECT internal_api.operator_transition_case(NULL, NULL, NULL, NULL, NULL)');
  PERFORM pg_temp.s11b_err_is('P10b and so does the transition door — the definer body re-derives the '
    || 'caller rather than trusting how it was reached',
    pg_temp.s11b_err(v), '42501', '%the caller may not change this support case%');

  -- A uuid that is nobody is refused with the same sentence as a host who is somebody without a grant, so
  -- none of these doors is an oracle over which accounts exist.
  v := pg_temp.s11b_as('authenticated', c.ghost, 'SELECT api.operator_case_queue(NULL, NULL, NULL)');
  PERFORM pg_temp.s11b_err_is('P11 a claimed uid that matches no account hears the queue''s ordinary '
    || 'refusal: the predicate says no, and it does not explain why',
    pg_temp.s11b_err(v), '42501', '%the caller may not read the case queue%');

  t := pg_temp.s11b_try('authenticated', c.host_a, 'SELECT private.operator_grants.status FROM '
    || 'private.operator_grants LIMIT 1');
  PERFORM pg_temp.s11b_err_is('P12 the grant table itself is invisible to a request role by the same wall '
    || 'slice 1 built — a host cannot even ask who the operators are',
    t, '42501', '%permission denied for schema private%');

  PERFORM pg_temp.s11b_eq('P13 the predicate answers false for the host running this group',
    pg_temp.s11b_is(c.host_a, 'support'), false);
  PERFORM pg_temp.s11b_eq('P13b and false for an account that does not exist, without raising',
    pg_temp.s11b_is(c.ghost, 'support'), false);
  PERFORM pg_temp.s11b_eq('P13c and true only for the one credential slice 1 minted',
    pg_temp.s11b_is((SELECT op_a FROM s11b_slice1), 'support'), true);

  -- Eighteen refusals, one digest each for four tables. "Nothing was written" is the second half of every
  -- cell above: a door that raised on its way out after planting a row would still answer with the right
  -- sentence.
  PERFORM pg_temp.s11b_eq('P14 none of them wrote a case', pg_temp.s11b_cstate(), d0c);
  PERFORM pg_temp.s11b_eq('P15 none of them wrote a thread row', pg_temp.s11b_estate(), d0e);
  PERFORM pg_temp.s11b_eq('P16 none of them wrote a trail row: a refusal is not an event worth recording, '
    || 'and if it were, this stage''s trail would be mostly noise from scanning tools',
    pg_temp.s11b_adigest(), d0a);
  PERFORM pg_temp.s11b_eq('P17 and none of them touched the grant table', pg_temp.s11b_gstate(), d0g);
  PERFORM pg_temp.s11b_eq('P18 the emptiness S01 measured is still the state of both new tables',
    (SELECT count(*)::int FROM private.support_cases), 0);
END $p$;

-- ===========================================================================
-- 3. The credentials this file's own cast needs (G01–G06)
-- ===========================================================================
-- Minted through slice 1's body and nothing else. The alternative — inserting two rows into
-- `private.operator_grants` by hand — would test this file's doors against a credential shape the console
-- cannot produce, and would leave the trail without the two rows that say who decided. This is the point
-- where the two slices join: a support operator is a row the *other* slice's one legal writer made.
DO $g$
DECLARE c s11b_cast%ROWTYPE; v jsonb; g0 bigint; a0 bigint;
BEGIN
  SELECT * INTO c FROM s11b_cast;
  g0 := (SELECT count(*) FROM private.operator_grants);
  a0 := (SELECT count(*) FROM private.audit_events);

  v := (SELECT internal_api.grant_operator_role(c.op1, 'support',
        'battery 2: the operator who walks the thread', c.decider, NULL));
  PERFORM pg_temp.s11b_eq('G01 the first grant came back live rather than pending: the body writes the '
    || 'row and answers with it', v ->> 'status', 'active');
  PERFORM pg_temp.s11b_eq('G02 carrying the scope this file''s six doors ask for',
    v ->> 'scope', 'support');
  PERFORM pg_temp.s11b_ok('G02b and it answers with both ids a reader needs to follow the decision: the '
    || 'grant row''s own and the trail row''s',
    (v ? 'grant_id') AND (v ? 'audit_id')
    AND EXISTS (SELECT 1 FROM private.audit_events a WHERE a.id = (v ->> 'audit_id')::bigint));

  v := (SELECT internal_api.grant_operator_role(c.op2, 'support',
        'battery 2: the second operator, so handover has two humans', c.decider, NULL));
  PERFORM pg_temp.s11b_ok('G03 and the second grant names a different beneficiary: one duty held by two '
    || 'accounts is the queue''s premise',
    (v ->> 'user_id') = c.op2::text);

  PERFORM pg_temp.s11b_eq('G04 four live credentials now exist — the two slice 1 left (one `support`, one '
    || '`operations`) plus the two this group minted — and no account holds two rows for one duty',
    (SELECT count(*)::int FROM private.operator_grants WHERE status = 'active'), 4);
  PERFORM pg_temp.s11b_eq('G04b three of them are the duty this file runs, because slice 1''s battery '
    || 'ended with exactly one live `support` grant',
    (SELECT count(*)::int FROM private.operator_grants WHERE status = 'active'
      AND scope = 'support'), 3);
  PERFORM pg_temp.s11b_eq('G04b and the table grew by exactly the two rows this group asked for',
    (SELECT count(*)::int FROM private.operator_grants) - g0::int, 2);
  PERFORM pg_temp.s11b_eq('G05 each grant wrote its own trail row, so the three live credentials have '
    || 'three recorded decisions behind them',
    (SELECT count(*)::int FROM private.audit_events) - a0::int, 2);
  PERFORM pg_temp.s11b_ok('G06 the predicate now answers true for both operators and still false for the '
    || 'host — the same session GUCs, the same function, one row of difference',
    pg_temp.s11b_is(c.op1, 'support') AND pg_temp.s11b_is(c.op2, 'support')
    AND NOT pg_temp.s11b_is(c.host_a, 'support'));
END $g$;

-- ===========================================================================
-- 4. Opening, listing, reading and replying: the host's four doors (O01–O73)
-- ===========================================================================
-- This is the first group that writes durable rows, and it is deliberately the host's side rather than the
-- operator's: a ticket has to exist before a queue can hold it, and the four host doors are the only ones
-- reachable by an account that holds no credential — which is exactly the population that misuse report 1
-- (§2) puts at the centre of this slice.
DO $o$
DECLARE c s11b_cast%ROWTYPE; k s11b_key%ROWTYPE; v jsonb; t text;
        d0c text; d0e text; d0a text; d1c text; d1e text;
        n0c bigint; n0e bigint; n0a bigint;
        cats text[]; sevs text[]; acc int;
BEGIN
  SELECT * INTO c FROM s11b_cast;
  SELECT * INTO k FROM s11b_key;
  d0c := pg_temp.s11b_cstate(); d0e := pg_temp.s11b_estate(); d0a := pg_temp.s11b_adigest();
  n0c := pg_temp.s11b_ccount(); n0e := pg_temp.s11b_ecount(); n0a := pg_temp.s11b_acount();

  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wa, 'invitation_access',
        'normal', 'The QR code on the printed card does not open the invitation.', k.k_open_a));
  PERFORM pg_temp.s11b_eq('O01 a host who owns the wedding it names can open a ticket: the answer is not '
    || 'an error', pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_keys('O02 and it answers with the seven fields that describe a ticket and nothing '
    || 'else — no assignee, no resolution, no operator',
    v, ARRAY['case_ref','category','opened_at','replayed','severity','status','wedding_id']);
  PERFORM pg_temp.s11b_eq('O03 it says this is a new ticket rather than a remembered one',
    v ->> 'replayed', 'false');
  PERFORM pg_temp.s11b_eq('O04 the status is the lifecycle''s first word, chosen by the body rather than '
    || 'by an argument — there is no status argument to choose', v ->> 'status', 'open');
  PERFORM pg_temp.s11b_eq('O05 the category the host claimed comes back unchanged',
    v ->> 'category', 'invitation_access');
  PERFORM pg_temp.s11b_eq('O06 and so does the severity', v ->> 'severity', 'normal');
  PERFORM pg_temp.s11b_eq('O07 the wedding named on the ticket is the one the caller owns',
    v ->> 'wedding_id', c.wa::text);
  PERFORM pg_temp.s11b_ok('O08 the ref is the minted shape: the prefix outside the alphabet, eight base32 '
    || 'characters, nothing a human typed', (v ->> 'case_ref') ~ '^SV-[A-Z2-7]{8}$');
  PERFORM pg_temp.s11b_reg('main', v, c.host_a);

  PERFORM pg_temp.s11b_eq('O09 one case row exists, which is the whole durable effect of a legal open',
    (SELECT count(*)::int FROM private.support_cases), 1);
  PERFORM pg_temp.s11b_eq('O10 and exactly one thread row', (SELECT count(*)::int
    FROM private.support_case_events), 1);
  PERFORM pg_temp.s11b_eq('O11 that row is the edge into open, written by the door: a kind, an actor kind, '
    || 'no origin and the destination as its own status',
    (SELECT e.kind || '/' || e.actor_kind || '/' || coalesce(e.from_status,'(null)') || '/'
            || coalesce(e.to_status,'(null)') FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('main')), 'status/host/(null)/open');
  PERFORM pg_temp.s11b_eq('O12 and it is the thread''s first ordinal, it carries no text, it carries no '
    || 'key — the key rode the case row instead — and it names the host',
    (SELECT e.seq::text || '|' || coalesce(e.body,'(null)') || '|'
            || coalesce(e.idempotency_key::text,'(null)') || '|' || e.actor_user_id::text
       FROM private.support_case_events e WHERE e.case_id = pg_temp.s11b_id('main')),
    '1|(null)|(null)|' || c.host_a::text);
  PERFORM pg_temp.s11b_eq('O13 and the audit trail did not move: a host asking for help is recorded in the '
    || 'ticket and its thread, and §9 keeps the trail for acts on authority and on the domain',
    (SELECT count(*)::int FROM private.audit_events) - n0a::int, 0);
  PERFORM pg_temp.s11b_eq('O13b proved as the same string rather than as a count',
    pg_temp.s11b_adigest(), d0a);

  -- The input rules, each one on its own, and each with the sentence a triager would read off a screen.
  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wa, 'invitation_access',
        'normal', 'No key on this call.', NULL));
  PERFORM pg_temp.s11b_err_is('O14 an open with no idempotency key is refused: the double click that '
    || 'makes two tickets is the failure this argument exists to prevent', pg_temp.s11b_err(v),
    '23514', '%requires an idempotency key%');

  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wa, 'wedding_cancellation',
        'normal', 'A word from a different product.', k.k_open_b));
  PERFORM pg_temp.s11b_err_is('O15 an unknown category is refused by name rather than filed under '
    || '`other`: silence here is how a queue fills with untriageable rows', pg_temp.s11b_err(v),
    '23514', '%unknown support category ''wedding_cancellation''%');

  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wa, 'invitation_access',
        'urgent', 'A fifth severity would be a faster answer.', k.k_open_b));
  PERFORM pg_temp.s11b_err_is('O16 and an unknown severity is refused with the same structure',
    pg_temp.s11b_err(v), '23514', '%unknown support severity ''urgent''%');

  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wa, 'other', 'low', NULL,
        k.k_open_b));
  PERFORM pg_temp.s11b_err_is('O17 a ticket with no summary at all is refused: a queue entry nobody can '
    || 'read is worse than no entry', pg_temp.s11b_err(v), '23514', '%must say what is wrong%');

  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wa, 'other', 'low', '   ',
        k.k_open_b));
  PERFORM pg_temp.s11b_err_is('O18 and three spaces is no summary — the bound is on trimmed text, so the '
    || 'padding a form forgets to strip cannot satisfy it', pg_temp.s11b_err(v), '23514',
    '%must say what is wrong%');

  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wa, 'other', 'low',
        repeat('a', 2001), k.k_open_b));
  PERFORM pg_temp.s11b_err_is('O19 a summary one character over the bound is refused, and the sentence '
    || 'reports the length it saw', pg_temp.s11b_err(v), '23514', '%must fit in 2000 characters, got 2001%');

  t := pg_temp.s11b_probe('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wa, 'other', 'low',
        repeat('a', 2000), k.k_open_b));
  PERFORM pg_temp.s11b_accept('O20 and the bound itself is accepted: the limit is inclusive, which is the '
    || 'difference between 2000 and 1999 characters of a host''s own words', t);

  -- The two vocabularies, walked completely, through the rollback probe so that seven accepted opens do
  -- not become seven rows in the census. A list of words in a comment is not evidence that the door knows
  -- them; each one has to arrive.
  cats := ARRAY['invitation_access','publication_delivery','guest_rsvp','render_output',
                'billing_refund_inquiry','privacy_data_request','other'];
  acc := 0;
  FOR i IN 1 .. array_length(cats, 1) LOOP
    t := pg_temp.s11b_probe('authenticated', c.host_c, pg_temp.s11b_open_sql(NULL, cats[i], 'low',
          'probe: category vocabulary', k.k_shared));
    IF t = 'ACCEPTED' THEN acc := acc + 1; END IF;
    PERFORM pg_temp.s11b_eq('O21.' || i || ' category ' || cats[i] || ' reaches the table', t, 'ACCEPTED');
  END LOOP;
  PERFORM pg_temp.s11b_eq('O21e all seven categories of the vocabulary are reachable, so the queue''s '
    || 'filter words are the door''s words', acc, 7);

  v := pg_temp.s11b_as('authenticated', c.host_c, pg_temp.s11b_open_sql(NULL, 'invitations', 'low',
        'a near-miss word', k.k_shared));
  PERFORM pg_temp.s11b_err_is('O22 and the near-miss plural of one of them is refused — the check is the '
    || 'set, not a prefix match', pg_temp.s11b_err(v), '23514', '%unknown support category ''invitations''%');

  sevs := ARRAY['low','normal','high','critical'];
  acc := 0;
  FOR i IN 1 .. array_length(sevs, 1) LOOP
    t := pg_temp.s11b_probe('authenticated', c.host_c, pg_temp.s11b_open_sql(NULL, 'other', sevs[i],
          'probe: severity vocabulary', k.k_shared));
    IF t = 'ACCEPTED' THEN acc := acc + 1; END IF;
    PERFORM pg_temp.s11b_eq('O23.' || i || ' severity ' || sevs[i] || ' reaches the table', t, 'ACCEPTED');
  END LOOP;
  PERFORM pg_temp.s11b_eq('O23e four severities, and no fifth', acc, 4);

  v := pg_temp.s11b_as('authenticated', c.host_c, pg_temp.s11b_open_sql(NULL, 'other', 'blocker',
        'a word that means now', k.k_shared));
  PERFORM pg_temp.s11b_err_is('O24 refused, with the sentence that says what a fifth word would have '
    || 'bought', pg_temp.s11b_err(v), '23514', '%not a faster answer%');

  -- Ownership, stated as the one sentence §3's rule requires. Three different reasons a wedding argument
  -- can be wrong answer alike, so the door cannot be used to ask whether a wedding exists, who owns it, or
  -- whether an account is real.
  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wb, 'other', 'low',
        'a stranger''s wedding', k.k_open_b));
  PERFORM pg_temp.s11b_err_is('O25 a host may not open a ticket about somebody else''s wedding',
    pg_temp.s11b_err(v), '42501', '%the caller may not open a case about this wedding%');

  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.ghost, 'other', 'low',
        'a wedding that is nobody''s because it is not a wedding', k.k_open_b));
  PERFORM pg_temp.s11b_err_is('O26 a uuid that names no wedding at all hears the same sentence',
    pg_temp.s11b_err(v), '42501', '%the caller may not open a case about this wedding%');

  v := pg_temp.s11b_as('authenticated', c.ghost, pg_temp.s11b_open_sql(c.wa, 'other', 'low',
        'an account that is not an account', k.k_open_b));
  PERFORM pg_temp.s11b_err_is('O27 and so does an account that is not an account, naming a wedding that '
    || 'does exist: the answer is the caller''s scope, never the object''s history', pg_temp.s11b_err(v),
    '42501', '%the caller may not open a case about this wedding%');

  -- The order of the refusals, measured rather than assumed, because it is the order a host experiences.
  -- A door that checked ownership before the summary would let a stranger learn that the wedding is real.
  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wb, 'wedding_cancellation',
        'blocker', NULL, NULL));
  PERFORM pg_temp.s11b_err_is('O28 every rule broken at once still answers with the key first',
    pg_temp.s11b_err(v), '23514', '%requires an idempotency key%');

  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wb, 'wedding_cancellation',
        'blocker', NULL, k.k_open_b));
  PERFORM pg_temp.s11b_err_is('O29 then the category, ahead of the summary and ahead of ownership',
    pg_temp.s11b_err(v), '23514', '%unknown support category%');

  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wb, 'other', 'blocker',
        NULL, k.k_open_b));
  PERFORM pg_temp.s11b_err_is('O30 then the severity', pg_temp.s11b_err(v), '23514',
    '%unknown support severity%');

  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wb, 'other', 'low', '  ',
        k.k_open_b));
  PERFORM pg_temp.s11b_err_is('O31 then the summary — so a stranger typing a valid shape into somebody '
    || 'else''s wedding uuid is stopped by a word rule, and a caller who breaks every word rule never '
    || 'reaches the ownership question', pg_temp.s11b_err(v), '23514', '%must say what is wrong%');

  d1c := pg_temp.s11b_cstate(); d1e := pg_temp.s11b_estate();
  PERFORM pg_temp.s11b_ok('O32 the one legal open moved both digests, so the comparisons below are '
    || 'measuring a state that changed once and then stopped changing rather than a state that never '
    || 'changed at all', pg_temp.s11b_cstate() <> d0c AND pg_temp.s11b_estate() <> d0e);
  PERFORM pg_temp.s11b_eq('O32b twenty-one refusals and one rolled-back probe later, the case table holds '
    || 'the single legal ticket and its digest is the one the legal open left',
    pg_temp.s11b_cstate(), d1c);
  PERFORM pg_temp.s11b_eq('O33 and the thread holds its single minted row',
    pg_temp.s11b_estate(), d1e);
  PERFORM pg_temp.s11b_eq('O34 and the trail is still exactly what group G handed over',
    pg_temp.s11b_adigest(), d0a);
  PERFORM pg_temp.s11b_eq('O35 and the counts agree with the digests, which is the pair a count alone '
    || 'cannot prove', ARRAY[pg_temp.s11b_ccount()::text, pg_temp.s11b_ecount()::text],
    ARRAY[(n0c + 1)::text, (n0e + 1)::text]);

  -- The mint trigger's own refusal, reached only by hand: no door accepts a ref, so the shape this cell
  -- measures is a direct INSERT as the table owner. It rolls back, so what it proves is the rule rather
  -- than a row.
  t := pg_temp.s11b_probe('postgres', NULL, 'INSERT INTO private.support_cases (wedding_id, '
    || 'requester_user_id, opened_by_user_id, category, severity, status, host_summary, case_ref) VALUES '
    || '(NULL, ' || pg_temp.s11b_u(c.host_c) || ', ' || pg_temp.s11b_u(c.host_c)
    || ', ''other'', ''low'', ''open'', ''plant: a chosen ref'', ''SV-AAAAAAAA'')');
  PERFORM pg_temp.s11b_err_is('O36 a hand-supplied ref is refused by the trigger that mints it, with '
    || '42501 rather than a check violation because choosing somebody else''s ticket number is an '
    || 'authorisation failure, not a malformed word', t, '42501',
    '%a support case ref is minted by the database, never supplied%');

  t := pg_temp.s11b_probe('postgres', NULL, 'INSERT INTO private.support_cases (wedding_id, '
    || 'requester_user_id, opened_by_user_id, category, severity, status, host_summary) VALUES '
    || '(NULL, ' || pg_temp.s11b_u(c.host_c) || ', ' || pg_temp.s11b_u(c.host_c)
    || ', ''other'', ''low'', ''open'', ''plant: the same row with no ref'')');
  PERFORM pg_temp.s11b_accept('O37 and the identical plant with the ref left out is accepted: the trigger '
    || 'refuses the argument, not the row', t);

  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wa, 'guest_rsvp', 'low',
        'A second, unrelated question about the same wedding.', k.k_open_b));
  PERFORM pg_temp.s11b_reg('second', v, c.host_a);
  PERFORM pg_temp.s11b_ok('O38 a second key from the same host mints a second ticket with a different '
    || 'ref: two questions about one wedding are two pieces of work',
    (v ->> 'replayed') = 'false' AND (v ->> 'case_ref') <> pg_temp.s11b_ref('main'));

  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(NULL, 'privacy_data_request',
        'normal', 'A question about my account rather than my wedding.', k.k_open_c));
  PERFORM pg_temp.s11b_eq('O39 a ticket may name no wedding, and the answer says so with a NULL under the '
    || 'key rather than by dropping the key', (v ->> 'wedding_id'), NULL);
  PERFORM pg_temp.s11b_ok('O39b the key is present even when the value is not — a projection that omits '
    || 'a field its owner asked about is a field a screen will invent', v ? 'wedding_id');
  PERFORM pg_temp.s11b_reg('no_wed', v, c.host_a);

  -- The instant everything below is ordered by. `now()` is the transaction timestamp and this battery runs
  -- in one transaction, so every row this file writes carries the same instant to the microsecond. Saying
  -- so here is what makes the two ordering cells honest: they measure the tie-break the bodies document
  -- (`opened_at, case_ref`), not recency, and a race tier with two transactions is where recency lives.
  PERFORM pg_temp.s11b_eq('O40 every ticket so far opened at one instant, which is why the list cells '
    || 'below assert the tie-break rather than claiming to prove recency',
    (SELECT count(DISTINCT c2.opened_at)::int FROM private.support_cases c2), 1);

  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.get_my_support_cases(NULL, NULL)');
  PERFORM pg_temp.s11b_keys('O41 the host''s list answers with three fields', v,
    ARRAY['cases','limit','status_filter']);
  PERFORM pg_temp.s11b_eq('O42 the default page is the documented 25 rather than an unbounded read of a '
    || 'person''s whole history', v ->> 'limit', '25');
  PERFORM pg_temp.s11b_eq('O43 and no filter word was invented for an absent argument', v ->> 'status_filter',
    NULL);
  PERFORM pg_temp.s11b_array('O44 the list holds exactly this account''s three tickets, in the order the '
    || 'body''s own `ORDER BY` produces for equal instants: the case ref, ascending',
    (SELECT coalesce(array_agg(e ->> 'case_ref' ORDER BY ord), '{}'::text[])
       FROM jsonb_array_elements(v -> 'cases') WITH ORDINALITY AS t(e, ord)),
    (SELECT coalesce(array_agg(r ORDER BY r COLLATE "C"), '{}'::text[]) FROM (
        SELECT pg_temp.s11b_ref('main') AS r UNION ALL SELECT pg_temp.s11b_ref('second')
        UNION ALL SELECT pg_temp.s11b_ref('no_wed')) x));
  PERFORM pg_temp.s11b_keys('O45 each row of the list carries the ten fields a host is told about their '
    || 'own ticket — and no assignee, because a host is not told who holds it',
    jsonb_array_element(v -> 'cases', 0),
    ARRAY['case_ref','category','host_summary','opened_at','resolution_code','resolved_at','severity',
          'status','updated_at','wedding_id']);

  v := pg_temp.s11b_as('authenticated', c.host_b, 'SELECT api.get_my_support_cases(NULL, NULL)');
  PERFORM pg_temp.s11b_eq('O46 a second host sees an empty list rather than an error and rather than '
    || 'somebody else''s tickets', jsonb_array_length(v -> 'cases'), 0);

  v := pg_temp.s11b_as('authenticated', c.host_b, pg_temp.s11b_open_sql(c.wb, 'render_output', 'normal',
        'The share image renders the wrong date.', k.k_open_x));
  PERFORM pg_temp.s11b_reg('b1', v, c.host_b);
  v := pg_temp.s11b_as('authenticated', c.host_b, 'SELECT api.get_my_support_cases(NULL, NULL)');
  PERFORM pg_temp.s11b_eq('O47 and one ticket of their own comes back when they ask',
    jsonb_array_length(v -> 'cases'), 1);
  PERFORM pg_temp.s11b_eq('O47b it is the ticket they just opened', v -> 'cases' -> 0 ->> 'case_ref',
    pg_temp.s11b_ref('b1'));

  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.get_my_support_cases(NULL, NULL)');
  PERFORM pg_temp.s11b_eq('O48 and the first host''s list still holds three, not four: the boundary is '
    || 'the requester column and it did not move when a second account opened a ticket',
    jsonb_array_length(v -> 'cases'), 3);
  PERFORM pg_temp.s11b_ok('O49 and it contains none of the second host''s refs',
    NOT (v -> 'cases' @> jsonb_build_array(jsonb_build_object('case_ref',
      pg_temp.s11b_ref('b1')))));

  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.get_my_support_cases(''snooping'', NULL)');
  PERFORM pg_temp.s11b_err_is('O50 an unknown filter word is refused rather than answered as an empty '
    || 'list — the failure §5 names, because an account with tickets that reads as having none is a '
    || 'support case in itself', pg_temp.s11b_err(v), '23514', '%unknown support status%');

  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.get_my_support_cases(NULL, 0)');
  PERFORM pg_temp.s11b_err_is('O51 a page of zero is refused with the number it was given',
    pg_temp.s11b_err(v), '23514', '%between 1 and 100, got 0%');
  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.get_my_support_cases(NULL, 101)');
  PERFORM pg_temp.s11b_err_is('O52 and a page of one hundred and one likewise — the ceiling is what keeps '
    || 'a host''s own read from becoming a bulk export', pg_temp.s11b_err(v), '23514',
    '%between 1 and 100, got 101%');
  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.get_my_support_cases(NULL, 1)');
  PERFORM pg_temp.s11b_eq('O53 and a legal page is honoured exactly', jsonb_array_length(v -> 'cases'), 1);
  PERFORM pg_temp.s11b_eq('O53b with the limit echoed back so a reader can tell a short page from a '
    || 'filtered one', v ->> 'limit', '1');
  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.get_my_support_cases(''open'', NULL)');
  PERFORM pg_temp.s11b_eq('O54 the one filter word the lifecycle has is honoured',
    jsonb_array_length(v -> 'cases'), 3);

  -- The single-case read, and the no-oracle rule measured as two identical strings.
  v := pg_temp.s11b_as('authenticated', c.host_a,
    'SELECT api.get_my_support_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ')');
  PERFORM pg_temp.s11b_keys('O55 the thread read answers with thirteen fields: the ticket, the two '
    || 'derived flags a reply box needs, and the events', v,
    ARRAY['case_ref','category','events','host_summary','opened_at','reply_allowed','resolution_code',
          'resolved_at','resume_expected','severity','status','updated_at','wedding_id']);
  PERFORM pg_temp.s11b_eq('O56 a live ticket invites a reply', v -> 'reply_allowed', 'true');
  PERFORM pg_temp.s11b_eq('O57 and does not claim to be waiting on the host', v -> 'resume_expected',
    'false');
  PERFORM pg_temp.s11b_eq('O58 the thread it returns is the one edge row the open minted',
    jsonb_array_length(v -> 'events'), 1);

  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.get_my_support_case(''   '')');
  PERFORM pg_temp.s11b_err_is('O59 a blank ref is a word rule, refused before the read',
    pg_temp.s11b_err(v), '23514', '%a case ref must be supplied to read one case%');

  t := pg_temp.s11b_try('authenticated', c.host_a, 'SELECT api.get_my_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('b1')) || ')::text');
  PERFORM pg_temp.s11b_eq('O60 somebody else''s ref and a ref that was never minted answer with the same '
    || 'SQLSTATE and the same sentence, byte for byte, so this read is not an oracle over ticket numbers: '
    || 'the first half',
    split_part(t, ' | ', 1), '42501');
  PERFORM pg_temp.s11b_eq('O60b and the second half', t, pg_temp.s11b_try('authenticated', c.host_a,
    'SELECT api.get_my_support_case(''SV-ZZ23QRSX'')::text'));

  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.reply_to_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', '
    || pg_temp.s11b_t('It happens on the phone as well as on the laptop.') || ', '
    || pg_temp.s11b_u(k.k_reply_1) || ')');
  PERFORM pg_temp.s11b_keys('O61 a reply answers with four fields and no prose', v,
    ARRAY['case_ref','replayed','seq','status']);
  PERFORM pg_temp.s11b_eq('O62 it is the thread''s second ordinal', v ->> 'seq', '2');
  PERFORM pg_temp.s11b_eq('O62b and it is a new row rather than a remembered one', v ->> 'replayed', 'false');
  PERFORM pg_temp.s11b_eq('O63 the reply did not move the status: `open` is not a state a host''s own '
    || 'message resumes, and there is no target-status argument to move it with',
    v ->> 'status', 'open');

  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.reply_to_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('second')) || ', '
    || pg_temp.s11b_t('   padded words with the form''s whitespace around them   ') || ', '
    || pg_temp.s11b_u(k.k_reply_2) || ')');
  PERFORM pg_temp.s11b_eq('O64 a padded reply is accepted', pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('O65 and the body the door keeps is trimmed, so the thread holds the host''s '
    || 'sentence rather than their form''s padding — the row itself is the evidence, not the answer',
    (SELECT e.body = 'padded words with the form''s whitespace around them'
       FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('second') AND e.seq = 2), true);

  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.reply_to_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('   ') || ', '
    || pg_temp.s11b_u(k.k_shared) || ')');
  PERFORM pg_temp.s11b_err_is('O66 a reply that says nothing is refused', pg_temp.s11b_err(v), '23514',
    '%a reply must say something%');
  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.reply_to_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t(repeat('a', 4001)) || ', '
    || pg_temp.s11b_u(k.k_shared) || ')');
  PERFORM pg_temp.s11b_err_is('O67 and one over the thread''s own bound is refused with its length',
    pg_temp.s11b_err(v), '23514', '%must fit in 4000 characters, got 4001%');
  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.reply_to_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('no key again') || ', NULL)');
  PERFORM pg_temp.s11b_err_is('O68 and a reply with no key is refused by the key rule before the body '
    || 'rule, the same order the open door keeps', pg_temp.s11b_err(v), '23514',
    '%a reply requires an idempotency key%');
  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.reply_to_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('b1')) || ', ' || pg_temp.s11b_t('a stranger''s paragraph') || ', '
    || pg_temp.s11b_u(k.k_shared) || ')');
  PERFORM pg_temp.s11b_err_is('O69 writing into somebody else''s thread is a scoping refusal with its own '
    || 'sentence', pg_temp.s11b_err(v), '42501', '%the caller may not reply on this support case%');

  v := pg_temp.s11b_as('authenticated', c.host_a,
    'SELECT api.get_my_support_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ')');
  PERFORM pg_temp.s11b_eq('O70 the thread the host reads back is the two rows the two calls made',
    jsonb_array_length(v -> 'events'), 2);
  PERFORM pg_temp.s11b_eq('O71 and the message row carries the key this call sent, which is what makes '
    || 'the replay below a lookup rather than a guess',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('main') AND e.kind = 'message_host'
        AND e.idempotency_key = k.k_reply_1), 1);

  PERFORM pg_temp.s11b_eq('O72 no host act in this group wrote to the audit trail — opening, listing, '
    || 'reading and replying are recorded in the ticket and its thread, and the trail stays the record of '
    || 'authority and of acts on the domain', pg_temp.s11b_adigest(), d0a);
  PERFORM pg_temp.s11b_eq('O73 and every case the registry holds exists, and nothing outside the registry '
    || 'does: the census at the end of this file counts on that pairing',
    (SELECT count(*)::int FROM private.support_cases c2
      WHERE c2.case_ref NOT IN (SELECT r.case_ref FROM s11b_case r)), 0);
END $o$;

-- ===========================================================================
-- 5. The replay anchor, in both directions (R01–R33)
-- ===========================================================================
-- The first draft of this slice looked up a replay on the key alone. That is the shape every idempotency
-- guide recommends, and here it was a leak: a second account that happened to send the same uuid got the
-- *first* account's ticket back — ref, wedding and all — and lost its own request. The repair is one term in
-- one WHERE clause, measured in `q11-logs/s11-s2-replay-probe-1.txt` and `-2.txt`, and a cell that only
-- proves "the owner gets the same ticket again" is satisfied by the broken version. So this group asserts
-- both halves, then reaches the two indexes that make the anchor a lookup rather than a scan.
DO $r$
DECLARE c s11b_cast%ROWTYPE; k s11b_key%ROWTYPE; v jsonb; t text;
        n0c bigint; n0e bigint; n0a bigint; b0c text; b0e text;
BEGIN
  SELECT * INTO c FROM s11b_cast;
  SELECT * INTO k FROM s11b_key;
  n0c := pg_temp.s11b_ccount(); n0e := pg_temp.s11b_ecount(); n0a := pg_temp.s11b_acount();
  b0c := pg_temp.s11b_cstate(); b0e := pg_temp.s11b_estate();

  v := pg_temp.s11b_as('authenticated', c.host_a, pg_temp.s11b_open_sql(c.wa, 'invitation_access',
        'normal', 'The QR code on the printed card does not open the invitation.', k.k_open_a));
  PERFORM pg_temp.s11b_eq('R01 the host who sends the first delivery again is answered, not refused',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_keys('R02 the replay answers with the same seven fields as the original, so a '
    || 'screen that shows the answer of a successful open shows a sensible answer here too', v,
    ARRAY['case_ref','category','opened_at','replayed','severity','status','wedding_id']);
  PERFORM pg_temp.s11b_eq('R03 it says it is a replay', v ->> 'replayed', 'true');
  PERFORM pg_temp.s11b_eq('R04 it names the ticket the first delivery made', v ->> 'case_ref',
    pg_temp.s11b_ref('main'));
  PERFORM pg_temp.s11b_eq('R05 every field of the replay is the stored row rather than a re-reading of the '
    || 'arguments — a double click with a *different* summary still returns the ticket that exists',
    ARRAY[v ->> 'wedding_id', v ->> 'category', v ->> 'severity', v ->> 'status'],
    (SELECT ARRAY[q.wedding_id::text, q.category, q.severity, q.status]
       FROM private.support_cases q WHERE q.case_ref = pg_temp.s11b_ref('main')));
  PERFORM pg_temp.s11b_eq('R06 and it wrote nothing: the count this group started with is the count it '
    || 'ends with', ARRAY[pg_temp.s11b_ccount(), pg_temp.s11b_ecount()], ARRAY[n0c, n0e]);
  PERFORM pg_temp.s11b_eq('R06b and the thread''s digest is byte-identical to the one the group began '
    || 'with, which a count cannot see', pg_temp.s11b_estate(), b0e);
  PERFORM pg_temp.s11b_eq('R07 and the replay wrote no trail row: a resubmitted form is not an act on the '
    || 'domain', pg_temp.s11b_acount(), n0a);

  -- The other direction — the one the first draft failed.
  v := pg_temp.s11b_as('authenticated', c.host_b, pg_temp.s11b_open_sql(c.wb, 'publication_delivery',
        'high', 'I am a different host and I happened to send the same key.', k.k_open_a));
  PERFORM pg_temp.s11b_eq('R08 a second account using that same key is answered as a new request, not as '
    || 'somebody else''s old one', pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('R09 replayed=false, because for this account the key has never been used',
    v ->> 'replayed', 'false');
  PERFORM pg_temp.s11b_ok('R10 and the ref it got is not the first account''s ref',
    (v ->> 'case_ref') <> pg_temp.s11b_ref('main'));
  PERFORM pg_temp.s11b_eq('R11 nor is the wedding on it', v ->> 'wedding_id', c.wb::text);
  PERFORM pg_temp.s11b_reg('steal', v, c.host_b);
  PERFORM pg_temp.s11b_eq('R12 one more case row exists, which is the correct outcome of a foreign '
    || 'replay: the stranger keeps its own request instead of silently adopting another person''s',
    pg_temp.s11b_ccount(), n0c + 1);
  PERFORM pg_temp.s11b_eq('R13 with its own first thread row', pg_temp.s11b_ecount(), n0e + 1);

  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.get_my_support_cases(NULL, NULL)');
  PERFORM pg_temp.s11b_eq('R14 the first account''s list is still three tickets — the stranger''s replay '
    || 'did not enter it', jsonb_array_length(v -> 'cases'), 3);
  v := pg_temp.s11b_as('authenticated', c.host_b, 'SELECT api.get_my_support_cases(NULL, NULL)');
  PERFORM pg_temp.s11b_eq('R15 and the second account''s list is now two tickets, one of them minted '
    || 'under a key the first account had already used', jsonb_array_length(v -> 'cases'), 2);

  t := pg_temp.s11b_try('authenticated', c.host_a, 'SELECT api.get_my_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('steal')) || ')::text');
  PERFORM pg_temp.s11b_err_is('R16 and the first account cannot read the ticket that a shared key '
    || 'produced: the replay anchor is the only place the two key spaces meet, and it does not double as '
    || 'a grant', t, '42501', '%the caller may not read this support case%');
  t := pg_temp.s11b_try('authenticated', c.host_a, 'SELECT api.reply_to_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('steal')) || ', ' || pg_temp.s11b_t('mine now') || ', '
    || pg_temp.s11b_u(k.k_shared) || ')::text');
  PERFORM pg_temp.s11b_err_is('R17 nor write in it', t, '42501',
    '%the caller may not reply on this support case%');

  -- The index shape, reached by hand. These two cells are why the per-caller anchor is not only a scoping
  -- rule: `support_cases_open_key_uniq` is `(requester, key)`, so the door's replay probe is an index probe
  -- and one account's key can never physically collide with another's.
  t := pg_temp.s11b_probe('postgres', NULL,
    'WITH a AS (INSERT INTO private.support_cases (requester_user_id, opened_by_user_id, category, '
    || 'severity, status, host_summary, open_idempotency_key) VALUES (' || pg_temp.s11b_u(c.host_x) || ', '
    || pg_temp.s11b_u(c.host_x) || ', ''other'', ''low'', ''open'', ''plant: first'', '
    || pg_temp.s11b_u(k.k_shared) || ') RETURNING id), b AS (INSERT INTO private.support_cases '
    || '(requester_user_id, opened_by_user_id, category, severity, status, host_summary, '
    || 'open_idempotency_key) SELECT ' || pg_temp.s11b_u(c.host_x) || ', ' || pg_temp.s11b_u(c.host_x)
    || ', ''other'', ''low'', ''open'', ''plant: second, same caller same key'', '
    || pg_temp.s11b_u(k.k_shared) || ' FROM a RETURNING id) SELECT count(*) FROM b');
  PERFORM pg_temp.s11b_err_is('R18 two tickets for one caller under one key is refused by the index, not '
    || 'by a body — so the rule holds for a writer no door was written for', t, '23505',
    '%support_cases_open_key_uniq%');

  t := pg_temp.s11b_probe('postgres', NULL,
    'INSERT INTO private.support_cases (requester_user_id, opened_by_user_id, category, severity, status, '
    || 'host_summary, open_idempotency_key) SELECT u, u, ''other'', ''low'', ''open'', '
    || quote_literal('plant: two callers, one key') || ', ' || pg_temp.s11b_u(k.k_shared)
    || ' FROM (SELECT ' || pg_temp.s11b_u(c.host_x) || ' AS u UNION ALL SELECT '
    || pg_temp.s11b_u(c.host_c) || ') two_callers');
  PERFORM pg_temp.s11b_accept('R19 the same key held by two *different* accounts is accepted by that '
    || 'index in one statement — the composite is (caller, key), which is why the repaired probe in the '
    || 'body above is a lookup rather than a scan, and why a stranger''s uuid can never be a collision '
    || 'worth an error', t);

  t := pg_temp.s11b_probe('postgres', NULL,
    'INSERT INTO private.support_cases (requester_user_id, opened_by_user_id, category, severity, status, '
    || 'host_summary, open_idempotency_key) SELECT u, u, ''other'', ''low'', ''open'', '
    || quote_literal('plant: caller, one key, twice') || ', ' || pg_temp.s11b_u(k.k_shared)
    || ' FROM (SELECT ' || pg_temp.s11b_u(c.host_x) || ' AS u UNION ALL SELECT '
    || pg_temp.s11b_u(c.host_x) || ') one_caller_twice');
  PERFORM pg_temp.s11b_err_is('R20 and the same statement with one account repeated is refused: the '
    || 'duplicate half of R18 was the caller, not the shape of the plant', t, '23505',
    '%support_cases_open_key_uniq%');

  t := pg_temp.s11b_probe('postgres', NULL,
    'INSERT INTO private.support_cases (requester_user_id, opened_by_user_id, category, severity, status, '
    || 'host_summary) SELECT u, u, ''other'', ''low'', ''open'', '
    || quote_literal('plant: no key at all') || ' FROM (SELECT ' || pg_temp.s11b_u(c.host_x)
    || ' AS u UNION ALL SELECT ' || pg_temp.s11b_u(c.host_x) || ') two_keyless_rows');
  PERFORM pg_temp.s11b_accept('R21 two keyless rows for one caller are accepted, because the index is '
    || 'partial: a ticket that never carried a key is a row a hand-migration or a later slice may '
    || 'legitimately write, and the replay rule is about keys, not about rows', t);

  -- The event key space, the other half of the same mechanism: a key belongs to a *case*, so one client
  -- that reuses one uuid across two tickets collides with neither.
  t := pg_temp.s11b_probe('postgres', NULL,
    'WITH one_row AS (INSERT INTO private.support_case_events (case_id, kind, actor_user_id, actor_kind, '
    || 'body, idempotency_key) VALUES (' || pg_temp.s11b_u(pg_temp.s11b_id('main'))
    || ', ''message_host'', ' || pg_temp.s11b_u(c.host_a) || ', ''host'', ''plant: keyed row'', '
    || pg_temp.s11b_u(k.k_shared) || ') RETURNING id), two_row AS (INSERT INTO private.support_case_events '
    || '(case_id, kind, actor_user_id, actor_kind, body, idempotency_key) SELECT '
    || pg_temp.s11b_u(pg_temp.s11b_id('main')) || ', ''message_host'', ' || pg_temp.s11b_u(c.host_a)
    || ', ''host'', ''plant: the same key again'', ' || pg_temp.s11b_u(k.k_shared)
    || ' FROM one_row RETURNING id) SELECT count(*) FROM two_row');
  PERFORM pg_temp.s11b_err_is('R22 one key twice on one thread is refused by the event index', t, '23505',
    '%support_case_events_one_row_per_key%');

  t := pg_temp.s11b_probe('postgres', NULL,
    'WITH one_row AS (INSERT INTO private.support_case_events (case_id, kind, actor_user_id, actor_kind, '
    || 'body, idempotency_key) VALUES (' || pg_temp.s11b_u(pg_temp.s11b_id('main'))
    || ', ''message_host'', ' || pg_temp.s11b_u(c.host_a) || ', ''host'', ''plant: thread one'', '
    || pg_temp.s11b_u(k.k_shared) || ') RETURNING id), two_row AS (INSERT INTO private.support_case_events '
    || '(case_id, kind, actor_user_id, actor_kind, body, idempotency_key) SELECT '
    || pg_temp.s11b_u(pg_temp.s11b_id('second')) || ', ''message_host'', ' || pg_temp.s11b_u(c.host_a)
    || ', ''host'', ''plant: thread two, same key'', ' || pg_temp.s11b_u(k.k_shared)
    || ' FROM one_row RETURNING id) SELECT count(*) FROM two_row');
  PERFORM pg_temp.s11b_accept('R23 and the same key on two different threads is accepted: the key is '
    || 'scoped by case, which is the same decision the open key makes one level up', t);

  -- The reply door's own replay, both directions again.
  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.reply_to_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', '
    || pg_temp.s11b_t('It happens on the phone as well as on the laptop.') || ', '
    || pg_temp.s11b_u(k.k_reply_1) || ')');
  PERFORM pg_temp.s11b_eq('R24 a resubmitted reply answers instead of refusing', pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_keys('R25 with the reply''s own four fields', v,
    ARRAY['case_ref','replayed','seq','status']);
  PERFORM pg_temp.s11b_eq('R26 replayed=true', v ->> 'replayed', 'true');
  PERFORM pg_temp.s11b_eq('R27 and it names the ordinal of the row that already exists rather than minting '
    || 'a third one', v ->> 'seq', '2');
  PERFORM pg_temp.s11b_eq('R28 and the thread is still two rows deep',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('main')), 2);

  t := pg_temp.s11b_try('authenticated', c.host_b, 'SELECT api.reply_to_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('borrowed key') || ', '
    || pg_temp.s11b_u(k.k_reply_1) || ')::text');
  PERFORM pg_temp.s11b_err_is('R29 and a stranger who knows the key but not the ticket is refused by '
    || 'ownership before any replay lookup could answer with the first host''s seq: the case is scoped '
    || 'first, and the key is only ever read inside one case', t, '42501',
    '%the caller may not reply on this support case%');

  t := pg_temp.s11b_probe('authenticated', c.host_a, 'SELECT api.reply_to_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('fresh text, the open''s key')
    || ', ' || pg_temp.s11b_u(k.k_open_a) || ')');
  PERFORM pg_temp.s11b_accept('R30 the open door''s key is not the thread''s key space: reusing it on a '
    || 'reply is accepted, because one call one row means the key rides the row that records that call — '
    || 'measured here and rolled back so the seq numbering above stays the evidence', t);

  PERFORM pg_temp.s11b_eq('R31 and the durable residue of this group is exactly the tickets the registry '
    || 'holds: every plant above rolled back, and no refusal wrote a row',
    pg_temp.s11b_ccount(), (SELECT count(*)::bigint FROM s11b_case));
  PERFORM pg_temp.s11b_eq('R32 and the trail still holds what group G handed over: a replay in either '
    || 'direction is not an act worth recording', pg_temp.s11b_acount(), n0a);
  PERFORM pg_temp.s11b_eq('R33 and the thread rows add up to the registry''s own shape — one opening '
    || 'edge per ticket, plus the two replies and the one padded reply this file made on the first '
    || 'ticket''s thread', pg_temp.s11b_ecount(),
    (SELECT count(*)::bigint FROM s11b_case) + 2);
END $r$;

-- ===========================================================================
-- 6. The operator's five doors: queue, single-case read, notes, claim, release (C01–C96)
-- ===========================================================================
-- Group P measured these same doors as refusals; this group measures them as calls that work, from two
-- accounts whose only difference from the host in P09 is one row in `private.operator_grants`. Running both
-- halves is what makes the pair evidence: the predicate is the single variable, so a green C01 next to a
-- green P09.1 says the grant is doing the authorising and not a screen, an argument or the wrapper's name.
--
-- The durable end state this group leaves is deliberate, because groups L, X, V and A read it afterwards:
-- `main` carries an internal note, a host-facing note, one claim and one release; `second` is held by op2
-- after a handover that took two acts; `no_wed` is untouched and belongs to L's walk; `b1` and `steal` are
-- untouched and belong to X's cross-household cells. No ticket leaves this group in a resting state.
DO $c$
DECLARE c s11b_cast%ROWTYPE; k s11b_key%ROWTYPE; v jsonb; w jsonb; t text;
        n0c bigint; n0e bigint; n0a bigint; b0c text; b0e text; d0a text;
BEGIN
  SELECT * INTO c FROM s11b_cast;
  SELECT * INTO k FROM s11b_key;
  n0c := pg_temp.s11b_ccount(); n0e := pg_temp.s11b_ecount(); n0a := pg_temp.s11b_acount();
  b0c := pg_temp.s11b_cstate(); b0e := pg_temp.s11b_estate(); d0a := pg_temp.s11b_adigest();

  -- --- the queue ---
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_case_queue(NULL, NULL, NULL)');
  PERFORM pg_temp.s11b_eq('C01 the account with the live `support` grant is answered by the queue that '
    || 'P09.1 refused for the host — same role, same wrapper, one grant row of difference',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_keys('C02 the queue answers with four fields', v,
    ARRAY['cases','category_filter','limit','status_filter']);
  PERFORM pg_temp.s11b_eq('C03 and the default page is the documented 25, echoed rather than invented by '
    || 'the caller', v ->> 'limit', '25');
  PERFORM pg_temp.s11b_eq('C04 an absent filter is echoed as absent, not as a word that happens to match '
    || 'everything', v ->> 'status_filter', NULL);
  PERFORM pg_temp.s11b_eq('C04b and the same on the other filter', v ->> 'category_filter', NULL);
  PERFORM pg_temp.s11b_eq('C05 a support operator sees every ticket in the system, both households '
    || 'included: the scope is the duty, not a wedding, and §5 says so rather than leaving it to the UI',
    jsonb_array_length(v -> 'cases'), 5);
  PERFORM pg_temp.s11b_array('C06 and the order is the body''s own `ORDER BY opened_at, case_ref`. Every '
    || 'ticket here was opened at one instant (O40), so this cell honestly measures the tie-break and not '
    || 'recency: refs in byte order, oldest-first by construction',
    (SELECT coalesce(array_agg(e ->> 'case_ref' ORDER BY ord), '{}'::text[])
       FROM jsonb_array_elements(v -> 'cases') WITH ORDINALITY AS q(e, ord)),
    (SELECT coalesce(array_agg(r ORDER BY r COLLATE "C"), '{}'::text[]) FROM (
        SELECT c2.case_ref AS r FROM private.support_cases c2) y));
  PERFORM pg_temp.s11b_keys('C07 each queue row carries the operator''s ten fields, and the one of them a '
    || 'host''s list does not have is the assignee — a host is not told who holds their ticket',
    jsonb_array_element(v -> 'cases', 0),
    ARRAY['assigned_operator_user_id','case_ref','category','host_summary','opened_at',
          'requester_user_id','severity','status','updated_at','wedding_id']);
  PERFORM pg_temp.s11b_eq('C08 the assignee slot is present on every row and a JSON null on every row: '
    || 'nothing in this file has claimed anything yet, and a projection that dropped an unassigned name '
    || 'instead of stating it would teach the screen to keep the last name it rendered. Note the '
    || '`jsonb_typeof` test rather than `IS NULL` — a JSON null is a value, and a cell that confused the '
    || 'two would pass on a projection that omitted the key entirely',
    (SELECT count(*)::int FROM jsonb_array_elements(v -> 'cases') e
      WHERE e ? 'assigned_operator_user_id'
        AND jsonb_typeof(e -> 'assigned_operator_user_id') = 'null'), 5);

  w := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_case_queue(''open'', NULL, NULL)');
  PERFORM pg_temp.s11b_eq('C09 filtering to a status the lifecycle has gets the five live tickets',
    jsonb_array_length(w -> 'cases'), 5);
  w := pg_temp.s11b_as('authenticated', c.op1,
    'SELECT api.operator_case_queue(''resolved'', NULL, NULL)');
  PERFORM pg_temp.s11b_eq('C10 and filtering to a status nobody has reached is answered with an empty '
    || 'page, not with an error: the filter word is real, the result is merely nothing',
    jsonb_array_length(w -> 'cases'), 0);
  PERFORM pg_temp.s11b_eq('C10b the echo still says what was asked', w ->> 'status_filter', 'resolved');

  v := pg_temp.s11b_as('authenticated', c.op1,
    'SELECT api.operator_case_queue(''pending'', NULL, NULL)');
  PERFORM pg_temp.s11b_err_is('C11 an invented status word is refused rather than answered as an empty '
    || 'queue — the same reason the host''s list refuses one: a typo that returns nothing looks like a '
    || 'cleared backlog', pg_temp.s11b_err(v), '23514', '%unknown support status%');
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_case_queue(NULL, ''lost'', NULL)');
  PERFORM pg_temp.s11b_err_is('C12 and an invented category word likewise, on the door the directive says '
    || 'must not accept a filter it does not know', pg_temp.s11b_err(v), '23514',
    '%unknown support category%');

  w := pg_temp.s11b_as('authenticated', c.op1,
    'SELECT api.operator_case_queue(NULL, ''guest_rsvp'', NULL)');
  PERFORM pg_temp.s11b_eq('C13 the category filter selects the one ticket that carries it',
    jsonb_array_length(w -> 'cases'), 1);
  PERFORM pg_temp.s11b_eq('C13b and it is the ticket this file opened under that category',
    w -> 'cases' -> 0 ->> 'case_ref', pg_temp.s11b_ref('second'));

  w := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_case_queue(NULL, NULL, 1)');
  PERFORM pg_temp.s11b_eq('C14 a page of one is one row, and it is the first row of the unfiltered order: '
    || 'the limit trims the tail, it does not reorder', jsonb_array_length(w -> 'cases'), 1);
  PERFORM pg_temp.s11b_eq('C14b and it is the ticket the full queue leads with, read from the table''s own '
    || 'byte-order minimum rather than from a variable this group has already reused',
    w -> 'cases' -> 0 ->> 'case_ref',
    (SELECT c2.case_ref FROM private.support_cases c2 ORDER BY c2.case_ref COLLATE "C" LIMIT 1));
  w := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_case_queue(NULL, NULL, 100)');
  PERFORM pg_temp.s11b_eq('C15 the top of the range is inclusive', w ->> 'limit', '100');
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_case_queue(NULL, NULL, 0)');
  PERFORM pg_temp.s11b_err_is('C16 zero is refused with its own number rather than answered as an empty '
    || 'page — an operator who reads nothing and believes the queue is empty is the failure this bound '
    || 'exists to prevent', pg_temp.s11b_err(v), '23514', '%between 1 and 100, got 0%');
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_case_queue(NULL, NULL, 101)');
  PERFORM pg_temp.s11b_err_is('C17 and 101 is refused the same way, so no caller can ask for a page that '
    || 'turns a bounded read into a dump', pg_temp.s11b_err(v), '23514', '%between 1 and 100, got 101%');

  -- The refusal ORDER, read as a fact about the body rather than assumed from its shape. A console that
  -- sends a bad word and no key must hear the word first, or the operator reads "add a key" for a filter
  -- they invented.
  v := pg_temp.s11b_as('authenticated', c.op1,
    'SELECT api.operator_case_queue(''pending'', ''lost'', 999)');
  PERFORM pg_temp.s11b_err_is('C18 of the three argument rules the queue has, the status word is checked '
    || 'first', pg_temp.s11b_err(v), '23514', '%unknown support status%');
  v := pg_temp.s11b_as('authenticated', c.op1,
    'SELECT api.operator_case_queue(NULL, ''lost'', 999)');
  PERFORM pg_temp.s11b_err_is('C19 the category word before the page size', pg_temp.s11b_err(v), '23514',
    '%unknown support category%');

  -- But the scoping predicate is ahead of all three, which is the claim §"prove authorization in the
  -- database" actually makes: an unauthorised caller never learns whether its arguments were well-formed.
  v := pg_temp.s11b_as('authenticated', c.host_a,
    'SELECT api.operator_case_queue(''pending'', ''lost'', 999)');
  PERFORM pg_temp.s11b_err_is('C20 and the predicate is ahead of both: a host sending three bad arguments '
    || 'hears one sentence about their own authority and nothing about the words',
    pg_temp.s11b_err(v), '42501', '%the caller may not read the case queue%');
  v := pg_temp.s11b_as('authenticated', c.ghost, 'SELECT api.operator_case_queue(NULL, NULL, NULL)');
  PERFORM pg_temp.s11b_err_is('C21 an account that does not exist hears that same sentence, so the queue '
    || 'is not an oracle over who holds a grant', pg_temp.s11b_err(v), '42501',
    '%the caller may not read the case queue%');

  PERFORM pg_temp.s11b_eq('C22 twenty-odd queue reads wrote nothing to the case table',
    pg_temp.s11b_cstate(), b0c);
  PERFORM pg_temp.s11b_eq('C23 nothing to the thread, and', pg_temp.s11b_estate(), b0e);
  PERFORM pg_temp.s11b_eq('C23b nothing to the trail: STABLE means the word on the function and the '
    || 'absence of a row in the digest, not just the word', pg_temp.s11b_adigest(), d0a);

  -- --- the single-case read ---
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.get_operator_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ')');
  PERFORM pg_temp.s11b_eq('C24 the operator''s single-case read answers for a ticket in somebody '
    || 'else''s household — the duty is the scope, and this is the door §12 keeps boring',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_keys('C25 its fourteen fields, three of which no host read has: the requester, the '
    || 'opener and the assignee, all as uuids and none as an email', v,
    ARRAY['assigned_operator_user_id','case_ref','category','events','host_summary','opened_at',
          'opened_by_user_id','requester_user_id','resolution_code','resolved_at','severity','status',
          'updated_at','wedding_id']);
  PERFORM pg_temp.s11b_eq('C26 the thread it returns is both rows the host side made — the opening edge '
    || 'and the reply — and not only the host''s own arm', jsonb_array_length(v -> 'events'), 2);
  PERFORM pg_temp.s11b_keys('C27 each thread row carries eight fields, including the actor uuid the host '
    || 'projection drops', jsonb_array_element(v -> 'events', 1),
    ARRAY['actor_kind','actor_user_id','body','created_at','from_status','kind','seq','to_status']);
  PERFORM pg_temp.s11b_eq('C28 and the operator reads the host''s own sentence back, which is the point of '
    || 'a thread', jsonb_array_element(v -> 'events', 1) ->> 'body',
    'It happens on the phone as well as on the laptop.');

  w := pg_temp.s11b_as('authenticated', c.op2, 'SELECT api.get_operator_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ')');
  PERFORM pg_temp.s11b_eq('C29 and a second operator gets the identical bytes for the same ticket: the '
    || 'answer is the row, not the reader — two humans on one duty see one history', w::text, v::text);

  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.get_operator_case(''   '')');
  PERFORM pg_temp.s11b_err_is('C30 a blank ref is a word rule, refused with 23514 before any read',
    pg_temp.s11b_err(v), '23514', '%a case ref must be supplied to read one case%');
  t := pg_temp.s11b_try('authenticated', c.op1, 'SELECT api.get_operator_case(''SV-ZZ23QRSX'')::text');
  PERFORM pg_temp.s11b_err_is('C31 and a ref that was never minted is refused by the scoping sentence with '
    || 'a 42501, so an operator guessing at ticket numbers hears the answer a missing row always gives',
    t, '42501', '%the caller may not read this support case%');

  -- --- the two kinds of note ---
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_add_case_note('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('message_operator') || ', '
    || pg_temp.s11b_t('Printed cards are a known render-output defect; do not promise a reprint date.')
    || ', ' || pg_temp.s11b_u(k.k_note_1) || ')');
  PERFORM pg_temp.s11b_eq('C32 an internal note is accepted on a live ticket', pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_keys('C33 and answers with four fields — no audit id, because no audit row was '
    || 'written', v, ARRAY['case_ref','kind','replayed','seq']);
  PERFORM pg_temp.s11b_eq('C34 the ordinal continues the host''s thread rather than starting an internal '
    || 'one: one seq per case is the reason a reader can tell what came first', v ->> 'seq', '3');

  PERFORM pg_temp.s11b_array('C35 the row on the thread is the note, addressed to the operator arm and '
    || 'named to the account that wrote it',
    (SELECT ARRAY[e.kind, e.actor_kind, coalesce(e.actor_user_id::text, ''), e.body,
                  coalesce(e.from_status, '(null)'), coalesce(e.to_status, '(null)')]::text[]
       FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('main') AND e.seq = 3),
    ARRAY['message_operator','operator',c.op1::text,
          'Printed cards are a known render-output defect; do not promise a reprint date.','(null)','(null)']);

  w := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_add_case_note('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('message_operator') || ', '
    || pg_temp.s11b_t('a resubmitted internal note') || ', ' || pg_temp.s11b_u(k.k_note_1) || ')');
  PERFORM pg_temp.s11b_eq('C36 the same key with the same arm is a replay, and the replay''s body '
    || 'difference is ignored because the first row is the record', w ->> 'replayed', 'true');
  PERFORM pg_temp.s11b_eq('C37 and it names the original ordinal rather than minting a fourth',
    w ->> 'seq', '3');
  PERFORM pg_temp.s11b_eq('C38 the thread itself is still three rows deep — a replay is a lookup on one '
    || 'case, so it cannot lengthen the case it is looking in',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('main')), 3);

  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_add_case_note('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('message_host') || ', '
    || pg_temp.s11b_t('the arm is what the read surface filters on') || ', '
    || pg_temp.s11b_u(k.k_note_1) || ')');
  PERFORM pg_temp.s11b_err_is('C39 one key cannot buy a row on the *other* arm: the refusal names the row '
    || 'that exists, because a silent switch of arms would put operator prose in front of a host',
    pg_temp.s11b_err(v), '23514',
    '%this idempotency key already carries a message_operator row on this case: one key is one action%');
  PERFORM pg_temp.s11b_eq('C40 and that refusal wrote nothing: the global thread count is still the one '
    || 'this file''s own accepted note made it', pg_temp.s11b_ecount(), n0e + 1);
  PERFORM pg_temp.s11b_eq('C40b and the thread the crossed-arm call aimed at is still three rows deep',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('main')), 3);

  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_add_case_note('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('note') || ', '
    || pg_temp.s11b_t('a third arm would be a third read surface') || ', '
    || pg_temp.s11b_u(k.k_note_2) || ')');
  PERFORM pg_temp.s11b_err_is('C41 an arm outside the two is refused with the sentence that explains why '
    || 'there are exactly two', pg_temp.s11b_err(v), '23514',
    '%a case note is either message_host, which the requester can read, or message_operator, which they '
    || 'cannot%');

  -- The order of the three argument rules, measured by sending all three broken at once.
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_add_case_note('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('note') || ', NULL, NULL)');
  PERFORM pg_temp.s11b_err_is('C42 the arm is checked before the key', pg_temp.s11b_err(v), '23514',
    '%a case note is either message_host%');
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_add_case_note('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('message_host')
    || ', NULL, NULL)');
  PERFORM pg_temp.s11b_err_is('C43 the key before the body, so a screen that forgets a key is told about '
    || 'the key', pg_temp.s11b_err(v), '23514', '%a note requires an idempotency key%');
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_add_case_note('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('message_host') || ', '
    || pg_temp.s11b_t(repeat('x', 4001)) || ', ' || pg_temp.s11b_u(k.k_note_2) || ')');
  PERFORM pg_temp.s11b_err_is('C44 and the body rule reports the length it was given, and the two body '
    || 'refusals are distinguishable: a note that says nothing and a note that is too long are different '
    || 'mistakes', pg_temp.s11b_err(v), '23514', '%a note must fit in 4000 characters, got 4001%');
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_add_case_note('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('message_host') || ', '
    || pg_temp.s11b_t('   ') || ', ' || pg_temp.s11b_u(k.k_note_2) || ')');
  PERFORM pg_temp.s11b_err_is('C45 whitespace is nothing, by the same rule the host''s reply uses',
    pg_temp.s11b_err(v), '23514', '%a note must say something%');
  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.operator_add_case_note('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('note') || ', NULL, NULL)');
  PERFORM pg_temp.s11b_err_is('C46 and the predicate is ahead of all three rules: a host sending a '
    || 'three-way-broken note hears only the sentence about their own authority',
    pg_temp.s11b_err(v), '42501', '%the caller may not add a note to this support case%');

  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_add_case_note('
    || pg_temp.s11b_t('SV-ZZ23QRSX') || ', ' || pg_temp.s11b_t('message_host') || ', '
    || pg_temp.s11b_t('nobody''s ticket') || ', ' || pg_temp.s11b_u(k.k_shared) || ')');
  PERFORM pg_temp.s11b_err_is('C47 an operator''s note onto a ref that does not exist is refused by the '
    || 'lookup, with the ordinary scoping sentence and after every argument rule — an operator cannot '
    || 'write into a thread number they guessed', pg_temp.s11b_err(v), '42501',
    '%the caller may not add a note to this support case%');

  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_add_case_note('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_t('message_host') || ', '
    || pg_temp.s11b_t('   We have reproduced it on the printed cards and are checking the render path.   ')
    || ', ' || pg_temp.s11b_u(k.k_note_2) || ')');
  PERFORM pg_temp.s11b_eq('C48 a host-facing note is accepted with the thread''s next ordinal',
    v ->> 'seq', '4');
  PERFORM pg_temp.s11b_eq('C49 and the body stored is the sentence, not the padding — the same trim the '
    || 'host''s reply gets, measured on the durable row rather than on the answer',
    (SELECT e.body FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('main') AND e.seq = 4),
    'We have reproduced it on the printed cards and are checking the render path.');

  PERFORM pg_temp.s11b_eq('C50 four notes-worth of calls and a dozen refusals wrote no audit row: the note '
    || 'is the record, and copying caller prose into the trail is the thing §4''s payload rule refuses',
    pg_temp.s11b_adigest(), d0a);
  PERFORM pg_temp.s11b_eq('C51 the thread this group grew is the two notes on one case, and no more',
    (pg_temp.s11b_ecount() - n0e)::int, 2);
  PERFORM pg_temp.s11b_eq('C51b and the case table''s own digest is byte-identical to the one this group '
    || 'started with: a note is a row in a thread, not an edit of a ticket',
    pg_temp.s11b_cstate(), b0c);

  -- --- claim: the door that takes no name ---
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_claim_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_u(k.k_claim_1) || ')');
  PERFORM pg_temp.s11b_eq('C52 the first claim is accepted', pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_keys('C53 and answers with five fields — the fifth being an audit id, which is how '
    || 'this door differs from the note door two cells above', v,
    ARRAY['assigned_operator_user_id','audit_id','case_ref','replayed','seq']);
  PERFORM pg_temp.s11b_eq('C54 the answer names the caller as the holder, which is the whole claim of '
    || '"the identity is re-derived, never supplied"', v ->> 'assigned_operator_user_id', c.op1::text);
  PERFORM pg_temp.s11b_eq('C55 and the row itself says the same thing: the answer is read off the write, '
    || 'and a body that reported an intention the row did not carry would be reporting a guess',
    (SELECT q.assigned_operator_user_id::text FROM private.support_cases q
      WHERE q.case_ref = pg_temp.s11b_ref('main')), c.op1::text);

  PERFORM pg_temp.s11b_array('C56 the trail row this claim wrote, field by field: the act, the kind of '
    || 'actor, the human who did it, the subject it names, and the key that makes it unrepeatable',
    (SELECT ARRAY[a.action, a.actor_kind, coalesce(a.actor_user_id::text, ''), a.subject_type,
                  coalesce(a.subject_key::text, ''), coalesce(a.idempotency_key, ''),
                  coalesce(a.wedding_id::text, '(null)')]::text[]
       FROM private.audit_events a WHERE a.id = (v ->> 'audit_id')::bigint),
    ARRAY['case_claimed','operator',c.op1::text,'support_case',
          pg_temp.s11b_id('main')::text, k.k_claim_1::text, c.wa::text]);
  PERFORM pg_temp.s11b_array('C57 and its two state columns carry the change rather than a sentence about '
    || 'it: before nobody, after this account — the pair an incident review reads',
    (SELECT ARRAY[coalesce(a.before_state ->> 'assigned_operator_user_id', '(null)'),
                  coalesce(a.after_state ->> 'assigned_operator_user_id', '(null)')]::text[]
       FROM private.audit_events a WHERE a.id = (v ->> 'audit_id')::bigint),
    ARRAY['(null)', c.op1::text]);
  PERFORM pg_temp.s11b_eq('C58 and the reason is built from the act and the ref, with no caller prose in '
    || 'it — an operator''s free text cannot reach an audit column through this door',
    (SELECT left(a.reason, length('support case ') + length(pg_temp.s11b_ref('main'))
                  + length(' claimed')) FROM private.audit_events a
      WHERE a.id = (v ->> 'audit_id')::bigint),
    'support case ' || pg_temp.s11b_ref('main') || ' claimed');

  PERFORM pg_temp.s11b_array('C59 the thread row a claim writes is an assignment, not a status move: no '
    || 'from/to column is filled, because taking a ticket is not an edge in the lifecycle',
    (SELECT ARRAY[e.kind, e.actor_kind, coalesce(e.actor_user_id::text, ''),
                  coalesce(e.from_status, '(null)'), coalesce(e.to_status, '(null)'),
                  coalesce(e.body, '(null)'), coalesce(e.idempotency_key::text, ''),
                  e.seq::text]::text[]
       FROM private.support_case_events e WHERE e.case_id = pg_temp.s11b_id('main') AND e.seq = 5),
    ARRAY['assignment','operator',c.op1::text,'(null)','(null)','(null)',k.k_claim_1::text,'5']);

  w := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_claim_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_u(k.k_claim_2) || ')');
  PERFORM pg_temp.s11b_err_is('C60 the same operator claiming with a *fresh* key is refused: a second '
    || 'click is not a second act, and the refusal is about the state rather than the key',
    pg_temp.s11b_err(w), '23514', '%this case is already claimed by the caller%');

  w := pg_temp.s11b_as('authenticated', c.op2, 'SELECT api.operator_claim_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_u(k.k_shared) || ')');
  PERFORM pg_temp.s11b_err_is('C61 a second operator cannot take it either — and this sentence is the '
    || 'reason there are two verbs and no `operator_assign_case`: nobody receives work they did not ask '
    || 'for, and no caller holds a name argument to point at another human',
    pg_temp.s11b_err(w), '23514',
    '%another operator holds this case: it has to be released before it can be claimed%');
  PERFORM pg_temp.s11b_eq('C62 and the holder is still the first operator after both refusals',
    (SELECT q.assigned_operator_user_id::text FROM private.support_cases q
      WHERE q.case_ref = pg_temp.s11b_ref('main')), c.op1::text);

  w := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_claim_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_u(k.k_claim_1) || ')');
  PERFORM pg_temp.s11b_eq('C63 the same key from the same account is a replay, and the replay is answered '
    || 'rather than refused: a double click that lands twice is the caller''s bug, not their error',
    w ->> 'replayed', 'true');
  PERFORM pg_temp.s11b_eq('C64 and it names the original ordinal and the original trail row instead of '
    || 'minting either', ARRAY[w ->> 'seq', w ->> 'audit_id'],
    ARRAY[v ->> 'seq', v ->> 'audit_id']);
  PERFORM pg_temp.s11b_eq('C65 wrote nothing: the case table, the thread and the trail all hold the same '
    || 'bytes they held before the replay — the three counts a note pair and one claim have to leave '
    || 'alone when a third delivery of the first claim arrives',
    ARRAY[pg_temp.s11b_ccount(), pg_temp.s11b_ecount(), pg_temp.s11b_acount()],
    ARRAY[n0c, n0e + 3, n0a + 1]);

  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_claim_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', NULL)');
  PERFORM pg_temp.s11b_err_is('C66 a keyless claim is refused by the key rule', pg_temp.s11b_err(v),
    '23514', '%a claim requires an idempotency key: two clicks on one ticket must produce one claim%');
  w := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_claim_case(''SV-ZZ23QRSX'', NULL)');
  PERFORM pg_temp.s11b_err_is('C67 and the key rule comes before the lookup, so a console that loses its '
    || 'key hears about the key even when its ref is also wrong', pg_temp.s11b_err(w), '23514',
    '%a claim requires an idempotency key%');
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_claim_case(''SV-ZZ23QRSX'', '
    || pg_temp.s11b_u(k.k_shared) || ')');
  PERFORM pg_temp.s11b_err_is('C68 a ref that is not there is refused by the lookup, with the scoping '
    || 'sentence — an operator probing ticket numbers gets the same answer as one guessing a number that '
    || 'belongs to a household they cannot see', pg_temp.s11b_err(v), '42501',
    '%the caller may not claim this support case%');

  -- --- release: the other half of the same rule ---
  w := pg_temp.s11b_as('authenticated', c.op2, 'SELECT api.operator_release_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_u(k.k_release_1) || ')');
  PERFORM pg_temp.s11b_err_is('C69 a release by a non-holder is refused with 42501, not 23514: clearing '
    || 'another person''s claim is an act upon their work, and the lifecycle has no word for it',
    pg_temp.s11b_err(w), '42501',
    '%this case is held by another operator, and one release may not clear their claim%');
  PERFORM pg_temp.s11b_eq('C70 and the holder survived that attempt',
    (SELECT q.assigned_operator_user_id::text FROM private.support_cases q
      WHERE q.case_ref = pg_temp.s11b_ref('main')), c.op1::text);

  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_release_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_u(k.k_release_1) || ')');
  PERFORM pg_temp.s11b_eq('C71 the holder''s own release is accepted', pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('C71b and its answer carries the assignee key as an explicit JSON null: the '
    || 'door says "nobody holds this" rather than dropping the field and letting a screen keep the old '
    || 'name it rendered', jsonb_typeof(v -> 'assigned_operator_user_id'), 'null');
  PERFORM pg_temp.s11b_eq('C72 and the row is empty again — the release is a write of NULL, which is the '
    || 'one place in this slice where "nobody holds this" is a value rather than an absent row',
    (SELECT q.assigned_operator_user_id FROM private.support_cases q
      WHERE q.case_ref = pg_temp.s11b_ref('main')), NULL);

  PERFORM pg_temp.s11b_array('C73 the release''s trail row is the mirror of the claim''s: a different '
    || 'act name, the same subject, and the two states swapped',
    (SELECT ARRAY[a.action, a.actor_kind, coalesce(a.actor_user_id::text, ''),
                  coalesce(a.subject_key::text, ''), coalesce(a.idempotency_key, ''),
                  coalesce(a.before_state ->> 'assigned_operator_user_id', '(null)'),
                  coalesce(a.after_state ->> 'assigned_operator_user_id', '(null)')]::text[]
       FROM private.audit_events a WHERE a.id = (v ->> 'audit_id')::bigint),
    ARRAY['case_released','operator',c.op1::text,pg_temp.s11b_id('main')::text,
          k.k_release_1::text, c.op1::text, '(null)']);
  PERFORM pg_temp.s11b_eq('C74 and the two acts are two different rows: one key never buys two trail '
    || 'entries, which is what the claim replay above could not prove on its own',
    (v ->> 'audit_id') <> (SELECT a.id::text FROM private.audit_events a
      WHERE a.idempotency_key = k.k_claim_1::text), 'true');
  PERFORM pg_temp.s11b_eq('C75 the thread records the release as a second assignment row — claim and '
    || 'release share one kind, which is why the replay path also reads the trail''s `action` before it '
    || 'will answer',
    (SELECT ARRAY[e.kind, e.actor_user_id::text, coalesce(e.idempotency_key::text, '')]::text[]
       FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('main') AND e.seq = 6),
    ARRAY['assignment', c.op1::text, k.k_release_1::text]);

  w := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_release_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_u(k.k_release_1) || ')');
  PERFORM pg_temp.s11b_eq('C76 a resubmitted release is a replay of the release, not a second clearing',
    w ->> 'replayed', 'true');
  PERFORM pg_temp.s11b_eq('C77 and it answers with the release''s own ordinal and trail row, so the '
    || 'history a caller is handed is the act that happened rather than the act the caller meant',
    ARRAY[w ->> 'seq', w ->> 'audit_id'], ARRAY['6', v ->> 'audit_id']);

  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_release_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_u(k.k_shared) || ')');
  PERFORM pg_temp.s11b_err_is('C78 and once the case is genuinely unheld, a fresh key has nothing to '
    || 'release: the refusal is about the state, and it is not the same sentence as the non-holder''s',
    pg_temp.s11b_err(v), '23514', '%nobody holds this case, so there is nothing to release%');
  w := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_release_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', NULL)');
  PERFORM pg_temp.s11b_err_is('C79 a keyless release is refused by the key rule before the state rule — '
    || 'the mirror of the claim door''s order, which is the evidence that the pair was written as one '
    || 'shape', pg_temp.s11b_err(w), '23514',
    '%a release requires an idempotency key: two clicks on one ticket must produce one release%');
  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.operator_release_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ', ' || pg_temp.s11b_u(k.k_shared) || ')');
  PERFORM pg_temp.s11b_err_is('C80 and a host who happens to know that the ticket is unheld still cannot '
    || 'release it: the predicate is the first statement in the body, not a consequence of the assignee '
    || 'check', pg_temp.s11b_err(v), '42501', '%the caller may not release this support case%');

  -- --- handover, as the two acts the signature forces ---
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_claim_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('second')) || ', ' || pg_temp.s11b_u(k.k_claim_2) || ')');
  PERFORM pg_temp.s11b_eq('C81 op1 picks up the second ticket — this is the key that C60 refused on the '
    || 'first ticket, and the refusal rolled back, so it is free here: a refused act is not a used key',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('C82 and the thread of this ticket is three rows deep: an opening edge, a '
    || 'host''s reply, an assignment', v ->> 'seq', '3');
  w := pg_temp.s11b_as('authenticated', c.op2, 'SELECT api.operator_claim_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('second')) || ', ' || pg_temp.s11b_u(k.k_shared) || ')');
  PERFORM pg_temp.s11b_err_is('C83 op2 still cannot take it', pg_temp.s11b_err(w), '23514',
    '%another operator holds this case: it has to be released before it can be claimed%');
  w := pg_temp.s11b_as('authenticated', c.op2, 'SELECT api.operator_release_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('second')) || ', ' || pg_temp.s11b_u(k.k_release_2) || ')');
  PERFORM pg_temp.s11b_err_is('C84 and cannot put it down either', pg_temp.s11b_err(w), '42501',
    '%this case is held by another operator, and one release may not clear their claim%');
  w := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_release_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('second')) || ', ' || pg_temp.s11b_u(k.k_release_2) || ')');
  PERFORM pg_temp.s11b_eq('C85 op1 puts it down — the key that C84 refused with is now the key that '
    || 'succeeds, which is the durability half of "a refusal wrote nothing"',
    pg_temp.s11b_err(w), NULL);
  v := pg_temp.s11b_as('authenticated', c.op2, 'SELECT api.operator_claim_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('second')) || ', ' || pg_temp.s11b_u(k.k_claim_3) || ')');
  PERFORM pg_temp.s11b_eq('C86 and op2 picks it up: a handover is two acts with two named actors on the '
    || 'history, and no door in this slice ever took the name of the person receiving the work',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('C87 the ticket now names op2',
    (SELECT q.assigned_operator_user_id::text FROM private.support_cases q
      WHERE q.case_ref = pg_temp.s11b_ref('second')), c.op2::text);
  PERFORM pg_temp.s11b_array('C88 and its thread reads in order: open, host reply, claimed by op1, '
    || 'released by op1, claimed by op2 — five rows, four actors-or-nulls, one seq per act',
    (SELECT coalesce(array_agg(e.seq::text || ':' || e.kind || ':' ||
                              coalesce(left(e.actor_user_id::text, 8), '(null)')
                              ORDER BY e.seq), '{}'::text[])
       FROM private.support_case_events e WHERE e.case_id = pg_temp.s11b_id('second')),
    ARRAY['1:status:' || left(c.host_a::text, 8), '2:message_host:' || left(c.host_a::text, 8),
          '3:assignment:' || left(c.op1::text, 8), '4:assignment:' || left(c.op1::text, 8),
          '5:assignment:' || left(c.op2::text, 8)]);
  PERFORM pg_temp.s11b_array('C89 and the trail for this one ticket holds three acts in the same order, '
    || 'each with its own key and its own before/after pair — a handover that a later reader can '
    || 'reconstruct without asking which console was open',
    (SELECT coalesce(array_agg(a.action || ':' || left(a.actor_user_id::text, 8) ORDER BY a.id),
                     '{}'::text[])
       FROM private.audit_events a
      WHERE a.subject_type = 'support_case'
        AND a.subject_key = pg_temp.s11b_id('second')),
    ARRAY['case_claimed:' || left(c.op1::text, 8), 'case_released:' || left(c.op1::text, 8),
          'case_claimed:' || left(c.op2::text, 8)]);

  -- --- what the queue says now, and what the group leaves behind ---
  v := pg_temp.s11b_as('authenticated', c.op2, 'SELECT api.operator_case_queue(''open'', NULL, NULL)');
  PERFORM pg_temp.s11b_eq('C90 the queue op2 reads shows the handover: one ticket held, by this account',
    (SELECT count(*)::int FROM jsonb_array_elements(v -> 'cases') e
      WHERE jsonb_typeof(e -> 'assigned_operator_user_id') <> 'null'), 1);
  PERFORM pg_temp.s11b_eq('C91 and it is the ticket the trail says so about',
    (SELECT e ->> 'case_ref' FROM jsonb_array_elements(v -> 'cases') e
      WHERE jsonb_typeof(e -> 'assigned_operator_user_id') <> 'null'), pg_temp.s11b_ref('second'));
  PERFORM pg_temp.s11b_eq('C91b and the uuid in that slot is op2''s own, read back out of the queue '
    || 'rather than from the row — the projection and the table agree',
    (SELECT e ->> 'assigned_operator_user_id' FROM jsonb_array_elements(v -> 'cases') e
      WHERE jsonb_typeof(e -> 'assigned_operator_user_id') <> 'null'), c.op2::text);
  w := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.get_my_support_cases(NULL, NULL)');
  PERFORM pg_temp.s11b_eq('C92 and the host''s own list still has no assignee field at all — the '
    || 'information the operator queue gained is not information the host projection grew',
    (SELECT count(*)::int FROM jsonb_array_elements(w -> 'cases') e
      WHERE e ? 'assigned_operator_user_id'), 0);

  PERFORM pg_temp.s11b_eq('C93 five acts in this group wrote five trail rows, and nothing else wrote any: '
    || 'two notes, one claim replay, three refused claims and three refused releases wrote none',
    (pg_temp.s11b_acount() - n0a)::int, 5);
  PERFORM pg_temp.s11b_eq('C94 the thread grew by exactly the seven rows the accepted calls made',
    (pg_temp.s11b_ecount() - n0e)::int, 7);
  PERFORM pg_temp.s11b_eq('C95 and the case table grew by nothing — no operator door in this slice can '
    || 'create a ticket, which is the shape §5 keeps the queue from becoming a tool that files work on '
    || 'somebody''s behalf', pg_temp.s11b_ccount(), n0c);
  PERFORM pg_temp.s11b_eq('C96 and every ticket is still `open`: a claim, a release and two notes move no '
    || 'status, because assignment is not an edge',
    (SELECT count(*)::int FROM private.support_cases c2 WHERE c2.status <> 'open'), 0);
END $c$;

-- --------------------------------------------------------------------------- the transition door, built once
-- Five arguments, called from forty cells. Same reason `s11b_open_sql` exists: a cell that swaps two of
-- them silently tests the builder, so the builder is written once and read forty times.
CREATE FUNCTION pg_temp.s11b_trans_sql(p_ref text, p_to text, p_code text, p_body text, p_key uuid)
RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT 'SELECT api.operator_transition_case(' || pg_temp.s11b_t(p_ref) || ', '
      || pg_temp.s11b_t(p_to) || ', ' || pg_temp.s11b_t(p_code) || ', '
      || pg_temp.s11b_t(p_body) || ', ' || pg_temp.s11b_u(p_key) || ')'
$fn$;

-- A ticket in a named state, asked about directly, is built by `s11b_guard_write` below rather than by a
-- builder here: the door sweep walks a *durable* ticket through the six states it can genuinely reach, so
-- no edge has to be faked to be asked about.

-- The same shape for a hand-written UPDATE against the wall: plant, then move one named column.
--
-- This is two statements inside one function, and the reason it cannot be one is worth keeping in front of
-- the reader. Measured on the throwaway chain:
--
--   `WITH pl AS (INSERT INTO private.support_cases … RETURNING id) UPDATE private.support_cases c
--    SET status = 'in_progress' FROM pl WHERE c.id = pl.id`
--
-- answers `UPDATE 0` — a data-modifying CTE's new row is visible as the CTE's own output, but the primary
-- query scans the target table with the snapshot taken before the CTE wrote, so the row it planted is not
-- there. Every one of the thirty-six guard cells below would then have been an `ACCEPTED` that measured
-- nothing, including the eleven hand-wall refusals this file exists to prove. The door half does not have
-- this problem: it hands the ref to a function, and that function's own lookup is a fresh statement.
-- A plpgsql body's statements are each fresh statements, so an INSERT followed by an UPDATE in the same
-- function does reach the row.
--
-- `p_set` is already-rendered `col = value` text, assembled only from the literals this file writes, and
-- the whole body runs under the probe's savepoint, so a refusal — or an acceptance — leaves nothing behind.
CREATE FUNCTION pg_temp.s11b_guard_write(p_from text, p_set text, p_host uuid)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO private.support_cases
      (wedding_id, requester_user_id, opened_by_user_id, category, severity, host_summary, status,
       resolution_code, resolved_at)
    VALUES (NULL, p_host, p_host, 'other', 'low', 'A ticket planted by hand for the wall.',
            p_from,
            CASE WHEN p_from IN ('resolved','closed') THEN 'no_action_needed' END,
            CASE WHEN p_from IN ('resolved','closed') THEN now() END)
    RETURNING id INTO v_id;
  EXECUTE 'UPDATE private.support_cases c SET ' || p_set || ' WHERE c.id = $1' USING v_id;
  RETURN 'ACCEPTED';
END $fn$;

CREATE FUNCTION pg_temp.s11b_plant_upd_sql(p_from text, p_set text, p_host uuid)
RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT 'SELECT pg_temp.s11b_guard_write(' || quote_literal(p_from) || ', '
      || quote_literal(p_set) || ', ' || pg_temp.s11b_u(p_host) || ')'
$fn$;

-- Keys for the walk. Separate from `s11b_key` because the walk's six acts are one story and a reader of a
-- failure wants to know which act broke; the shared table above belongs to the doors that came before.
CREATE TEMP TABLE s11b_lkey ON COMMIT DROP AS
SELECT gen_random_uuid() AS k_triage, gen_random_uuid() AS k_await, gen_random_uuid() AS k_reply,
       gen_random_uuid() AS k_resolve, gen_random_uuid() AS k_reopen, gen_random_uuid() AS k_close,
       gen_random_uuid() AS k_late;

-- --------------------------------------------------------------------------- the edge table, as data
-- Thirty-six pairs, and each row carries two expectations rather than one because the same pair reaches
-- the same state machine through two doors. `door_want` is what `operator_transition_case` answers: the
-- twelve legal edges §5's diagram shows, plus the pair refusals the body makes *above* the UPDATE — every
-- move back to `open` and every ask for the status the row already holds. `guard_want` is what the row-level
-- wall answers to the same pair sent by hand: the same twelve edges, the five same-status writes the wall
-- deliberately waves through, and its terminal branch owning all six of the `closed` row.
--
-- The two columns differ on exactly eleven rows, and each difference is a fact about ordering rather than
-- about authorisation: `to = open` is refused by the body five times where the wall has to work it out from
-- an absent edge, the self-pair is named by the body but accepted by the wall, and a `closed` row is
-- terminal to the wall but reaches the body's self-pair check first when the caller asks for `closed`
-- again. Sweeping both is what makes the pair evidence: if the wall alone were swept, a body that skipped
-- its own checks would still pass, and if the door alone were swept, a hand at a console would be unmeasured.
CREATE TEMP TABLE s11b_edge (ord integer PRIMARY KEY, from_status text, to_status text,
                             door_want text, guard_want text) ON COMMIT DROP;
INSERT INTO s11b_edge (ord, from_status, to_status, door_want, guard_want) VALUES
  ( 1, 'open',                 'open',                 'back',   'ok'),
  ( 2, 'open',                 'triaged',              'ok',     'ok'),
  ( 3, 'open',                 'awaiting_information', 'noedge', 'noedge'),
  ( 4, 'open',                 'in_progress',          'noedge', 'noedge'),
  ( 5, 'open',                 'resolved',             'noedge', 'noedge'),
  ( 6, 'open',                 'closed',               'ok',     'ok'),
  ( 7, 'triaged',              'open',                 'back',   'noedge'),
  ( 8, 'triaged',              'triaged',              'self',   'ok'),
  ( 9, 'triaged',              'awaiting_information', 'ok',     'ok'),
  (10, 'triaged',              'in_progress',          'ok',     'ok'),
  (11, 'triaged',              'resolved',             'noedge', 'noedge'),
  (12, 'triaged',              'closed',               'ok',     'ok'),
  (13, 'awaiting_information', 'open',                 'back',   'noedge'),
  (14, 'awaiting_information', 'triaged',              'noedge', 'noedge'),
  (15, 'awaiting_information', 'awaiting_information', 'self',   'ok'),
  (16, 'awaiting_information', 'in_progress',          'ok',     'ok'),
  (17, 'awaiting_information', 'resolved',             'noedge', 'noedge'),
  (18, 'awaiting_information', 'closed',               'ok',     'ok'),
  (19, 'in_progress',          'open',                 'back',   'noedge'),
  (20, 'in_progress',          'triaged',              'noedge', 'noedge'),
  (21, 'in_progress',          'awaiting_information', 'ok',     'ok'),
  (22, 'in_progress',          'in_progress',          'self',   'ok'),
  (23, 'in_progress',          'resolved',             'ok',     'ok'),
  (24, 'in_progress',          'closed',               'ok',     'ok'),
  (25, 'resolved',             'open',                 'back',   'noedge'),
  (26, 'resolved',             'triaged',              'noedge', 'noedge'),
  (27, 'resolved',             'awaiting_information', 'noedge', 'noedge'),
  (28, 'resolved',             'in_progress',          'ok',     'ok'),
  (29, 'resolved',             'resolved',             'self',   'ok'),
  (30, 'resolved',             'closed',               'ok',     'ok'),
  (31, 'closed',               'open',                 'back',   'term'),
  (32, 'closed',               'triaged',              'term',   'term'),
  (33, 'closed',               'awaiting_information', 'term',   'term'),
  (34, 'closed',               'in_progress',          'term',   'term'),
  (35, 'closed',               'resolved',             'term',   'term'),
  (36, 'closed',               'closed',               'self',   'term');

-- One answer string, one bucket. Every arm below is a sentence already asserted verbatim earlier in this
-- file, so a sweep row that falls through to the `?` arm is a row whose answer the battery cannot name —
-- which is precisely what a thirty-six-row sweep would otherwise swallow inside an array mismatch. The
-- order is the order of the doors' own checks, not alphabetical: `back` before `self` because a body that
-- asked for `open` on a ticket already in `open` is answered by the first rule, and `term` before `noedge`
-- because the wall's terminal branch is above its edge table.
CREATE FUNCTION pg_temp.s11b_bucket(p_answer text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN p_answer = 'ACCEPTED' THEN 'ok'
    WHEN p_answer LIKE '%a case may not be moved back to open%' THEN 'back'
    WHEN p_answer LIKE '%this case is already%' THEN 'self'
    WHEN p_answer LIKE '%a closed support case is terminal%' THEN 'term'
    WHEN p_answer LIKE '%no edge%exists in the support case lifecycle%' THEN 'noedge'
    ELSE '?[<' || left(coalesce(p_answer, '(null)'), 90) || '>]?'
  END
$fn$;

-- The ledger both sweeps write into and the cells read out of. Kept as rows rather than compared inline
-- because the useful failure is not "the sweep disagreed" but "these are the pairs, in order, where it
-- did" — and because the door half is filled in six passes at six different moments in the walk below, so
-- a reader needs to see which state each row was asked from.
CREATE TEMP TABLE s11b_sweep (ord integer, kind text, from_status text, to_status text,
                              want text, got text) ON COMMIT DROP;

-- One pass of the door half, taken while the named ticket is in the named state. Every cell reuses one
-- key on purpose: `s11b_probe` rolls its own work back, so a key consumed by a refused or accepted probe
-- was never recorded and the next cell sees the same fresh thread it would see with a fresh uuid — which
-- is what lets the sweep ask about `closed` without needing six more rows in `s11b_lkey` that would each
-- have to be kept out of the walk's way.
CREATE FUNCTION pg_temp.s11b_door_sweep(p_ref text, p_from text, p_op uuid, p_key uuid)
RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO s11b_sweep (ord, kind, from_status, to_status, want, got)
    SELECT e.ord, 'door', e.from_status, e.to_status, e.door_want,
           pg_temp.s11b_bucket(
             pg_temp.s11b_probe('authenticated', p_op,
               pg_temp.s11b_trans_sql(p_ref, e.to_status,
                 CASE WHEN e.to_status IN ('resolved', 'closed') THEN 'duplicate' END,
                 NULL, p_key)))
      FROM s11b_edge e WHERE e.from_status = p_from;
END $fn$;

-- The whole guard half in one pass, because a hand at the wall needs no walked state: each row is planted
-- by `postgres` in the `from_status` and updated in the same rolled-back statement. `resolution_code` is
-- set alongside `status` so that the six pairs whose destination is a resting state are answered by the
-- edge table rather than by the code rule — the sweep measures edges, and the code rule has its own cell
-- below. Entering a resting state with `no_action_needed` is also what makes the plant legal: a hand
-- planted `closed` with no code would be refused by the table's own CHECK and the sweep would be measuring
-- its own fixture.
CREATE FUNCTION pg_temp.s11b_guard_sweep(p_host uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO s11b_sweep (ord, kind, from_status, to_status, want, got)
    SELECT e.ord, 'guard', e.from_status, e.to_status, e.guard_want,
           pg_temp.s11b_bucket(
             pg_temp.s11b_probe('postgres', NULL,
               pg_temp.s11b_plant_upd_sql(e.from_status,
                 'status = ' || pg_temp.s11b_t(e.to_status)
                 || ', resolution_code = CASE WHEN ' || pg_temp.s11b_t(e.to_status)
                 || ' IN (''resolved'',''closed'') THEN ''no_action_needed'' END', p_host)))
      FROM s11b_edge e;
END $fn$;

-- The sweep's answer, read as one array. The row count is folded into the same expression rather than
-- asserted separately because a pass that silently ran no rows is the failure mode a mismatch array cannot
-- see — it is empty, and it is empty for the wrong reason. `p_from IS NULL` takes the whole half, which is
-- how the guard pass is read: it needs no walked state and so has no state to name.
CREATE FUNCTION pg_temp.s11b_sweep_report(p_kind text, p_from text, p_n integer)
RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN count(*) <> p_n::bigint THEN
      ARRAY[coalesce(p_kind || ' on ' || p_from, p_kind || ' (all)') || ': the pass ran '
              || count(*)::text || ' rows instead of ' || p_n::text]
    ELSE coalesce(array_agg(s.from_status || '->' || s.to_status || ': want ' || s.want
                            || ', got ' || s.got ORDER BY s.ord)
                  FILTER (WHERE s.want IS DISTINCT FROM s.got), '{}'::text[])
  END
    FROM s11b_sweep s WHERE s.kind = p_kind
      AND (p_from IS NULL OR s.from_status = p_from)
$fn$;

-- ===========================================================================
-- 7. The lifecycle, asked directly (L01–L89)
-- ===========================================================================
-- Everything group C did to a ticket's *ownership*, this group does to its *state*, and it does it in the
-- order the reader needs: the door's own refusals first, then one ticket walked from `open` to `closed`
-- with every row it left named, then the whole edge table asked cell by cell against hand-planted states,
-- then the guard's two other refusals — the immutable facts and the resting evidence — which no door can
-- reach and which therefore have to be reached by hand.
DO $l$
DECLARE
  c s11b_cast%ROWTYPE;
  k s11b_key%ROWTYPE;
  kl s11b_lkey%ROWTYPE;
  v jsonb;
  w jsonb;
  t text;
  n0c bigint;
  n0e bigint;
  n0a bigint;
  b0c text;
  b0e text;
  d0a text;
  z0c text;
  z0e text;
  z0a text;
BEGIN
  SELECT * INTO c FROM s11b_cast;
  SELECT * INTO k FROM s11b_key;
  SELECT * INTO kl FROM s11b_lkey;
  n0c := pg_temp.s11b_ccount();  n0e := pg_temp.s11b_ecount();  n0a := pg_temp.s11b_acount();
  b0c := pg_temp.s11b_cstate();  b0e := pg_temp.s11b_estate();  d0a := pg_temp.s11b_adigest();

  -- --- the door's own refusals, and the order they arrive in (L01–L19) ---
  -- The order matters more than the sentences. A console that is not an operator must not be able to learn
  -- that `SV-XXXXXXXX` is a ticket in somebody else's household by watching which of two refusals it gets,
  -- and an operator with a mistyped argument must be told about the argument rather than about the ticket.
  t := pg_temp.s11b_try('authenticated', c.host_a,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('main'), 'not_a_status', NULL, NULL, NULL));
  PERFORM pg_temp.s11b_err_is('L01 a host is refused before the door has looked at anything else — the '
    || 'argument is wrong too, and the wrongness of the caller outranks it',
    t, '42501', '%may not change this support case%');

  t := pg_temp.s11b_try('authenticated', c.ghost,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('main'), 'triaged', NULL, 'A real message.', k.k_trans_1));
  PERFORM pg_temp.s11b_err_is('L02 and a signed-in account with no grant is refused with the same '
    || 'sentence as a host: the door has one answer for one question',
    t, '42501', '%may not change this support case%');

  t := pg_temp.s11b_try('authenticated', c.host_a,
        pg_temp.s11b_trans_sql('SV-ZZZZZZZZ', 'triaged', NULL, NULL, k.k_trans_1));
  PERFORM pg_temp.s11b_err_is('L03 a caller who is not an operator does not get to learn whether that ref '
    || 'exists, because the answer they get is the one every non-operator gets',
    t, '42501', '%may not change this support case%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('no_wed'), 'in_review', NULL, NULL, k.k_trans_1));
  PERFORM pg_temp.s11b_err_is('L04 an operator''s own invented status is refused as a word this lifecycle '
    || 'does not have, not as a ticket they may not touch',
    t, '23514', '%unknown support status%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('no_wed'), NULL, NULL, NULL, k.k_trans_1));
  PERFORM pg_temp.s11b_err_is('L05 and a missing status is the same refusal with the word NULL in it, '
    || 'which is what keeps an absent argument from looking like a different answer',
    t, '23514', '%unknown support status NULL%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('no_wed'), 'in_review', NULL, NULL, NULL));
  PERFORM pg_temp.s11b_err_is('L06 the status word is checked before the key: a caller with two mistakes '
    || 'hears about the vocabulary, because the vocabulary is what the queue is made of',
    t, '23514', '%unknown support status%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('no_wed'), 'triaged', NULL, NULL, NULL));
  PERFORM pg_temp.s11b_err_is('L07 a real status with no idempotency key is refused: a status change with '
    || 'no key is a double click waiting to write two rows',
    t, '23514', '%a status change requires an idempotency key%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('no_wed'), 'resolved', NULL, NULL, NULL));
  PERFORM pg_temp.s11b_err_is('L08 the key rule is checked before the resolution-code rule, so the same '
    || 'call with two omissions is answered once — and by the argument that applies to every status',
    t, '23514', '%a status change requires an idempotency key%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('no_wed'), 'resolved', NULL, NULL, k.k_trans_1));
  PERFORM pg_temp.s11b_err_is('L09 a move to `resolved` with no code is refused by name, and the sentence '
    || 'recites the six so that the console does not have to guess which word it lacked',
    t, '23514', '%entering resolved requires a resolution code from the six%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('no_wed'), 'closed', NULL, NULL, k.k_trans_1));
  PERFORM pg_temp.s11b_err_is('L10 `closed` owes the same evidence as `resolved`: an ending that does not '
    || 'say how it ended is the shape of a trail nobody can review',
    t, '23514', '%entering closed requires a resolution code from the six%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('no_wed'), 'resolved', 'fixed_by_magic', NULL,
                               k.k_trans_1));
  PERFORM pg_temp.s11b_err_is('L11 a code from outside the six is refused as an unknown code rather than '
    || 'absorbed as a free-text note about the ending',
    t, '23514', '%unknown resolution code%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('no_wed'), 'resolved', 'fixed_by_magic', '   ',
                               k.k_trans_1));
  PERFORM pg_temp.s11b_err_is('L12 the code rule is checked before the body rule: a call whose ending is '
    || 'invented is not made legal by also sending text',
    t, '23514', '%unknown resolution code%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('no_wed'), 'triaged', 'duplicate', NULL, k.k_trans_1));
  PERFORM pg_temp.s11b_err_is('L13 a code on a live status is refused with the target named, because the '
    || 'caller has just claimed an ending for a ticket that has not ended',
    t, '23514', '%a resolution code belongs to resolved or closed, and this case is going to triaged%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('no_wed'), 'triaged', NULL, '   ', k.k_trans_1));
  PERFORM pg_temp.s11b_err_is('L14 whitespace is not a message: the sentence counts the characters it was '
    || 'given rather than describing the text it did not get — three spaces answers with `3 characters`, '
    || 'not `0`, because the count is `length(p_body)` while the test that fires is `length(btrim(p_body)) '
    || '= 0`, so the number a caller reads is the size of what they sent',
    t, '23514', '%a transition message is either real text or absent, and 3 characters is neither%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('no_wed'), 'triaged', NULL, repeat('x', 4001),
                               k.k_trans_1));
  PERFORM pg_temp.s11b_err_is('L15 and the ceiling is stated as the number the caller sent, so a pasted '
    || 'log is refused with a fact rather than a mystery',
    t, '23514', '%a transition message is either real text or absent, and 4001 characters is neither%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql('SV-NOSUCHREF', 'triaged', NULL, '   ', k.k_trans_1));
  PERFORM pg_temp.s11b_err_is('L16 the body rule is checked before the ticket is looked up: an argument '
    || 'this door can reject alone must never be answered by a read of a row',
    t, '23514', '%either real text or absent%');

  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql('SV-NOSUCHREF', 'triaged', NULL, 'A valid message.', k.k_trans_1));
  PERFORM pg_temp.s11b_err_is('L17 a ref that is not there, and a ref that is somebody else''s, are the '
    || 'same 42501 with the same sentence — Stage 3''s rule, re-used now by the operator door as well as '
    || 'the host''s',
    t, '42501', '%may not change this support case%');

  -- The claim group's own key, reused here on purpose: `main` carries an assignment row bought by
  -- `k_claim_1`, so this call is one key asking for a second act.
  t := pg_temp.s11b_try('authenticated', c.op1,
        pg_temp.s11b_trans_sql(pg_temp.s11b_ref('main'), 'triaged', NULL, NULL, k.k_claim_1));
  PERFORM pg_temp.s11b_err_is('L18 a transition sent with the key that already bought a claim on the same '
    || 'ticket is refused rather than answered with the claim''s recorded result — the refusal that '
    || 'reports success, named in the sentence',
    t, '23514', '%already carries a assignment row on this case: one key is one action%');

  PERFORM pg_temp.s11b_ok('L19 eighteen refusals, and the thread holds exactly the rows the accepted '
    || 'calls before this group wrote: a refusal in this door cannot reach an INSERT because every '
    || 'argument rule is above the lookup',
    pg_temp.s11b_ecount() = n0e AND pg_temp.s11b_ccount() = n0c
      AND pg_temp.s11b_adigest() = d0a);

  PERFORM pg_temp.s11b_eq('L19b the case rows themselves did not move either — a digest, because a status '
    || 'steered by an UPDATE that then aborted would change the count by nothing and the row by everything',
    pg_temp.s11b_cstate(), b0c);

  -- --- the expectation table read out before any answer is in the ledger (L20–L21) ---
  -- This pair measures the fixture, and it is here because a thirty-six-row sweep that agreed with a wrong
  -- table would be worth nothing. Twelve legal edges is the count §5's diagram has; six moves back to
  -- `open` is one per state; five same-status pairs is the six states less `open`, which the door refuses by
  -- name before it can notice the state it was already in; four closed-row refusals is the `closed` row
  -- less `open` and less the self-pair; and the remainder is everything else.
  PERFORM pg_temp.s11b_array('L20 the door''s expectations say the lifecycle has twelve legal edges, one '
    || 'refused move back to `open` from each of the six states, five self-pairs, four terminal refusals '
    || 'and nine pairs with no edge',
    (SELECT coalesce(array_agg(b || '=' || n::text ORDER BY b COLLATE "C"), '{}'::text[]) FROM (
        SELECT e.door_want AS b, count(*) AS n FROM s11b_edge e GROUP BY e.door_want) x),
    ARRAY['back=6', 'noedge=9', 'ok=12', 'self=5', 'term=4']);
  PERFORM pg_temp.s11b_array('L21 and the wall''s say the same twelve edges, five same-status writes it '
    || 'deliberately waves through and six terminal refusals — all of the `closed` row, because the wall '
    || 'tests terminality before it tests anything else about the write',
    (SELECT coalesce(array_agg(b || '=' || n::text ORDER BY b COLLATE "C"), '{}'::text[]) FROM (
        SELECT e.guard_want AS b, count(*) AS n FROM s11b_edge e GROUP BY e.guard_want) x),
    ARRAY['noedge=13', 'ok=17', 'term=6']);

  -- --- one ticket, walked (L22–) ---
  -- `no_wed` carries it, and it carries it on purpose: it is the one case group C left with a single row and
  -- no owner, so every seq below is this group's doing and none of them is inherited. The walk takes the
  -- long way round the diagram — four edges down, the resting state, the reopen, and only then the ending —
  -- because the two facts worth measuring are the ones a short walk cannot see: that a case can be resolved
  -- and reopened without either act rewriting the other, and that the state the thread ends in is `closed`
  -- while the state the row passes through on the way is not.
  --
  -- Each pass of the door sweep runs immediately before the act that leaves the state, so the pass is asked
  -- of a ticket genuinely in it. The sweeps are all rolled back; the six acts below are the only durable
  -- writes this group makes.
  PERFORM pg_temp.s11b_door_sweep(pg_temp.s11b_ref('no_wed'), 'open', c.op1, kl.k_late);
  PERFORM pg_temp.s11b_array('L22 the six pairs asked of a ticket in `open`, answered: two edges, four '
    || 'pairs with no edge, and the self-pair refused by the door''s own `no move back to open` rather than '
    || 'by the wall''s absent edge',
    pg_temp.s11b_sweep_report('door', 'open', 6), '{}'::text[]);

  -- --- act 1: triage ---
  v := pg_temp.s11b_as('authenticated', c.op1, pg_temp.s11b_trans_sql(
         pg_temp.s11b_ref('no_wed'), 'triaged', NULL,
         'Picked up. Asking the host for the ceremony date before anything else.', kl.k_triage));
  PERFORM pg_temp.s11b_eq('L23 the first real edge is walked, and the door answers at all',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_keys('L24 six keys, and the two the queue''s rows do not carry are from_status and '
    || 'audit_id — a list tells an operator where a ticket is, a transition tells a reviewer where it came '
    || 'from and which trail row says so',
    v, ARRAY['audit_id','case_ref','from_status','replayed','seq','to_status']);
  PERFORM pg_temp.s11b_eq('L25 the pair the door names is the pair §5 draws',
    (v ->> 'from_status') || ' -> ' || (v ->> 'to_status'), 'open -> triaged');
  PERFORM pg_temp.s11b_eq('L26 seq 2, because this ticket''s own history is numbered from its opening and '
    || 'nothing in group C reached it', v ->> 'seq', '2');
  PERFORM pg_temp.s11b_eq('L27 and a live status is entered with no resolution evidence on the row',
    (SELECT q.status || '|' || coalesce(q.resolution_code, '(null)') || '|'
            || coalesce(q.resolved_at::text, '(null)')
       FROM private.support_cases q WHERE q.case_ref = pg_temp.s11b_ref('no_wed')),
    'triaged|(null)|(null)');

  PERFORM pg_temp.s11b_door_sweep(pg_temp.s11b_ref('no_wed'), 'triaged', c.op1, kl.k_late);
  PERFORM pg_temp.s11b_array('L27b the six pairs asked of a ticket in `triaged`, answered while the '
    || 'ticket is in it: three edges out, one pair with no edge, the move back to `open` refused by name, '
    || 'and the ask for `triaged` again refused as the state the row already holds rather than as the '
    || 'missing edge the wall would have called it',
    pg_temp.s11b_sweep_report('door', 'triaged', 6), '{}'::text[]);

  -- --- act 2: the second operator asks for information ---
  -- op2 moves a ticket op1 has picked up and does not hold. That is the shape of a duty rota, and it is
  -- also the cell that proves the claim is not a lock on the state machine: nothing in the transition door
  -- reads `assigned_operator_user_id`, so a handover left half-done cannot freeze the queue.
  v := pg_temp.s11b_as('authenticated', c.op2, pg_temp.s11b_trans_sql(
         pg_temp.s11b_ref('no_wed'), 'awaiting_information', NULL,
         'The date is missing — please send it and we can carry on.', kl.k_await));
  PERFORM pg_temp.s11b_eq('L28 an operator who is not the holder walks the next edge, and the door answers '
    || 'without mentioning the holder', pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('L29 seq 4: the decision carries the key and the message rides behind it '
    || 'keyless, so one call is two rows and only one of them claims to be idempotent',
    v ->> 'seq', '4');
  PERFORM pg_temp.s11b_eq('L30 and the message the same call sent is seq 5 — the transition door writes the '
    || 'decision first and the text second, which is the opposite of the reply door above and is why the '
    || 'thread has to be read by arm as well as by seq',
    (SELECT e.seq FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('no_wed') AND e.kind = 'message_host'
        AND e.actor_user_id = c.op2), 5);

  PERFORM pg_temp.s11b_door_sweep(pg_temp.s11b_ref('no_wed'), 'awaiting_information', c.op1, kl.k_late);
  PERFORM pg_temp.s11b_array('L30b the six pairs asked of a ticket waiting on the host: `triaged` and '
    || '`resolved` both have no edge from here, which is the lifecycle refusing to let an operator undo a '
    || 'hand-off by sending the ticket backwards, and the two exits are the resume and the ending',
    pg_temp.s11b_sweep_report('door', 'awaiting_information', 6), '{}'::text[]);

  -- --- act 3: the host answers, and the lifecycle moves by itself ---
  v := pg_temp.s11b_as('authenticated', c.host_a,
        'SELECT api.reply_to_support_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('no_wed'))
        || ', ' || pg_temp.s11b_t('The 14th of November, at the family house.')
        || ', ' || pg_temp.s11b_u(kl.k_reply) || ')');
  PERFORM pg_temp.s11b_eq('L31 a host''s reply on a ticket waiting for them is accepted',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_keys('L32 four keys, and the status one is the resumed state rather than the state '
    || 'the caller sent — the reply door has no target-status argument to forge',
    v, ARRAY['case_ref','replayed','seq','status']);
  PERFORM pg_temp.s11b_eq('L33 so the answer reports the edge the door took on the host''s behalf',
    v ->> 'status', 'in_progress');

  PERFORM pg_temp.s11b_array('L34 and the thread says the same in two rows: the host''s message carries the '
    || 'key and is seq 6, the resume is keyless and is seq 7, and the resume names the host as its actor '
    || 'because the host caused it even though no door let them ask for it',
    (SELECT coalesce(array_agg(e.seq::text || ':' || e.kind || ':' || e.actor_kind || ':'
                              || CASE WHEN e.idempotency_key IS NULL THEN 'nokey' ELSE 'key' END
                              ORDER BY e.seq), '{}'::text[])
       FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('no_wed') AND e.seq BETWEEN 6 AND 7),
    ARRAY['6:message_host:host:key', '7:status:host:nokey']);
  PERFORM pg_temp.s11b_eq('L35 the resume row names both ends of the edge, so the status CHECK cannot be '
    || 'satisfied by a row that only claims a destination',
    (SELECT e.from_status || ' -> ' || e.to_status FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('no_wed') AND e.seq = 7),
    'awaiting_information -> in_progress');

  PERFORM pg_temp.s11b_door_sweep(pg_temp.s11b_ref('no_wed'), 'in_progress', c.op1, kl.k_late);
  PERFORM pg_temp.s11b_array('L35b the six pairs asked of a ticket in `in_progress`, the state the host''s '
    || 'reply put it in rather than the one an operator sent — three edges out, `triaged` with no edge, and '
    || 'this pass is the one that would have had to notice a stale `awaiting_information` had the reply door '
    || 'failed to resume',
    pg_temp.s11b_sweep_report('door', 'in_progress', 6), '{}'::text[]);

  -- --- act 4: resolve, with the code and without a message ---
  v := pg_temp.s11b_as('authenticated', c.op1, pg_temp.s11b_trans_sql(
         pg_temp.s11b_ref('no_wed'), 'resolved', 'resolved_by_operator', NULL, kl.k_resolve));
  PERFORM pg_temp.s11b_eq('L36 resolving the ticket is accepted', pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('L37 seq 8, and the pair is the one the walk arrived at rather than the one the '
    || 'door was told to start from — from_status is read off the row, not off the caller''s screen',
    (v ->> 'seq') || ':' || (v ->> 'from_status') || '->' || (v ->> 'to_status'),
    '8:in_progress->resolved');
  PERFORM pg_temp.s11b_eq('L38 the resting state arrives with both of its pieces of evidence, stamped by '
    || 'the wall rather than by the door',
    (SELECT q.status || '|' || q.resolution_code FROM private.support_cases q
      WHERE q.case_ref = pg_temp.s11b_ref('no_wed')), 'resolved|resolved_by_operator');
  PERFORM pg_temp.s11b_ok('L39 and `resolved_at` is not null, which is the only column in this row that '
    || 'can say when — `now()` is the transaction timestamp, so it cannot say which act within the '
    || 'transaction wrote it, and the battery does not pretend otherwise',
    (SELECT q.resolved_at IS NOT NULL FROM private.support_cases q
      WHERE q.case_ref = pg_temp.s11b_ref('no_wed')));

  -- --- the replay, asked of a legal alternative destination ---
  -- The interesting property is not that a resubmit is absorbed — every door here does that — but that it is
  -- absorbed *instead of* being refused as an illegal edge or as a self-pair. The key is looked up before the
  -- row's status is consulted, so the operator's stale tab is answered with the act it already performed
  -- rather than with a new refusal it cannot act on.
  v := pg_temp.s11b_as('authenticated', c.op1, pg_temp.s11b_trans_sql(
         pg_temp.s11b_ref('no_wed'), 'closed', 'host_withdrew', NULL, kl.k_resolve));
  PERFORM pg_temp.s11b_eq('L40 the same key, this time asking to close the ticket: answered with the '
    || 'resolve it already bought, not with the close it is now asking for',
    (v ->> 'replayed') || ':' || (v ->> 'seq') || ':' || (v ->> 'from_status')
      || '->' || (v ->> 'to_status'), 'true:8:in_progress->resolved');
  PERFORM pg_temp.s11b_ok('L41 and the trail id the replay reports is the id the original act wrote, so a '
    || 'console that shows "this decision is recorded" is pointing at a real row rather than at the row a '
    || 'second delivery would have made',
    (v ->> 'audit_id') = (SELECT a.id::text FROM private.audit_events a
                           WHERE a.subject_type = 'support_case'
                             AND a.subject_key = pg_temp.s11b_id('no_wed')
                           ORDER BY a.id DESC LIMIT 1));
  PERFORM pg_temp.s11b_eq('L42 the ticket is still resolved: a replay cannot both report the earlier act '
    || 'and perform the later one',
    (SELECT q.status FROM private.support_cases q WHERE q.case_ref = pg_temp.s11b_ref('no_wed')),
    'resolved');

  PERFORM pg_temp.s11b_door_sweep(pg_temp.s11b_ref('no_wed'), 'resolved', c.op1, kl.k_late);
  PERFORM pg_temp.s11b_array('L42b the six pairs asked of a ticket in `resolved`: the reopening edge and '
    || 'the ending, no way back to `triaged` or `awaiting_information`, and the self-pair refused by the '
    || 'body — which is the row of this pass that a double-clicked console button is answered with one '
    || 'refusal rather than with a thread holding two claims of one change',
    pg_temp.s11b_sweep_report('door', 'resolved', 6), '{}'::text[]);

  -- --- act 5: the reopen, and the evidence the wall gives back ---
  v := pg_temp.s11b_as('authenticated', c.op1, pg_temp.s11b_trans_sql(
         pg_temp.s11b_ref('no_wed'), 'in_progress', NULL, NULL, kl.k_reopen));
  PERFORM pg_temp.s11b_eq('L43 reopening is the edge §5 gives a resolved case, and it is accepted',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('L44 seq 9', v ->> 'seq', '9');
  PERFORM pg_temp.s11b_eq('L45 and the row''s own resting evidence is cleared by the write, because the '
    || 'columns say what is true now and what was true before is held by the two status rows and the two '
    || 'trail rows rather than by a column that would have to be edited to lie',
    (SELECT coalesce(q.resolution_code, '(null)') || '|' || coalesce(q.resolved_at::text, '(null)')
       FROM private.support_cases q WHERE q.case_ref = pg_temp.s11b_ref('no_wed')),
    '(null)|(null)');
  PERFORM pg_temp.s11b_eq('L46 the reopen is not recorded as a resolution: the door sent no code and the '
    || 'wall had nothing to keep',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('no_wed') AND e.kind = 'status'
        AND e.to_status = 'in_progress' AND e.from_status = 'resolved'), 1);

  -- --- act 6: the ending ---
  v := pg_temp.s11b_as('authenticated', c.op1, pg_temp.s11b_trans_sql(
         pg_temp.s11b_ref('no_wed'), 'closed', 'host_withdrew',
         'The host withdrew the request. Nothing further to do on this ticket.', kl.k_close));
  PERFORM pg_temp.s11b_eq('L47 closed is reached, with the code that says how',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('L48 seq 10, and the message the same call sent is seq 11',
    (v ->> 'seq') || ':' || (v ->> 'from_status') || '->' || (v ->> 'to_status'),
    '10:in_progress->closed');
  PERFORM pg_temp.s11b_eq('L49 the closed row keeps its evidence, unlike the reopened one — the same wall '
    || 'branch, run in the other direction, is the whole difference between the two cells',
    (SELECT q.status || '|' || q.resolution_code FROM private.support_cases q
      WHERE q.case_ref = pg_temp.s11b_ref('no_wed')), 'closed|host_withdrew');

  -- --- the thread the walk left, in full ---
  PERFORM pg_temp.s11b_array('L50 eleven rows, in order, with the arm, the actor and whether the row was '
    || 'bought by a key — this is the shape a reviewer reconstructs the ticket from, so it is asserted as '
    || 'one string rather than as eleven counts',
    (SELECT coalesce(array_agg(e.seq::text || ':' || e.kind || ':' || e.actor_kind || ':'
                              || CASE WHEN e.idempotency_key IS NULL THEN 'nokey' ELSE 'key' END
                              ORDER BY e.seq), '{}'::text[])
       FROM private.support_case_events e WHERE e.case_id = pg_temp.s11b_id('no_wed')),
    ARRAY['1:status:host:nokey', '2:status:operator:key', '3:message_host:operator:nokey',
          '4:status:operator:key', '5:message_host:operator:nokey', '6:message_host:host:key',
          '7:status:host:nokey', '8:status:operator:key', '9:status:operator:key',
          '10:status:operator:key', '11:message_host:operator:nokey']);
  PERFORM pg_temp.s11b_array('L51 and every status row names a pair from the six edges, in the order the '
    || 'walk took them, with the host''s resume among them — seven pairs, six edges and one of them walked '
    || 'by an edge the operator doors do not offer. The first pair is written with a named nothing on the '
    || 'left rather than left NULL, because `array_agg` drops a NULL element and a cell that quietly lost '
    || 'the opening row would be a sweep with one fewer row than it claims',
    (SELECT coalesce(array_agg(coalesce(e.from_status, '(none)') || '->' || e.to_status
                       ORDER BY e.seq), '{}'::text[])
       FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('no_wed') AND e.kind = 'status'),
    ARRAY['(none)->open', 'open->triaged', 'triaged->awaiting_information',
          'awaiting_information->in_progress', 'in_progress->resolved', 'resolved->in_progress',
          'in_progress->closed']);
  PERFORM pg_temp.s11b_array('L52 the trail holds five rows for this ticket and they are the five acts that '
    || 'needed a granted authority: the host''s reply and the resume it caused are on the thread and not on '
    || 'the trail, which is slice 2''s line between the two tables and the asymmetry §5 has to be read '
    || 'knowing about',
    (SELECT coalesce(array_agg(a.action || ':' || left(a.actor_user_id::text, 8) ORDER BY a.id),
                     '{}'::text[])
       FROM private.audit_events a
      WHERE a.subject_type = 'support_case' AND a.subject_key = pg_temp.s11b_id('no_wed')),
    ARRAY['status_changed:' || left(c.op1::text, 8), 'status_changed:' || left(c.op2::text, 8),
          'status_changed:' || left(c.op1::text, 8), 'status_changed:' || left(c.op1::text, 8),
          'status_changed:' || left(c.op1::text, 8)]);

  -- --- the wall's half of the sweep, and the row it exists for ---
  -- The hand-written UPDATE needs no walked state: each of the thirty-six rows is planted in its own
  -- `from_status` by `postgres` and moved in the same rolled-back statement, which is also the only way to
  -- reach the wall at all — measured earlier in this run, `authenticated` has no USAGE on `private`, so a
  -- single statement cannot both plant a state and hand-write inside it. That asymmetry is why the door half
  -- above had to be taken one state at a time and this half does not.
  PERFORM pg_temp.s11b_guard_sweep(c.host_a);
  PERFORM pg_temp.s11b_array('L53 all thirty-six pairs asked of the wall by hand: seventeen writes it '
    || 'accepts — the twelve edges, plus the five same-status writes that are the claim, the release and '
    || 'every later slice''s assignee edit — thirteen that name the pair they have no edge for, and six '
    || 'terminal ones that are the whole `closed` row',
    pg_temp.s11b_sweep_report('guard', NULL, 36), '{}'::text[]);
  PERFORM pg_temp.s11b_eq('L54 and the ledger behind those two answers holds sixty-six rows — five passes '
    || 'of the door half at five walked states plus the whole hand-written half — so neither sweep could '
    || 'have passed by matching an empty set',
    (SELECT count(*)::int FROM s11b_sweep), 66);

  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_plant_upd_sql('closed',
        'assigned_operator_user_id = ' || pg_temp.s11b_u(c.op1), c.host_a));
  PERFORM pg_temp.s11b_err_is('L55 the exact statement this stage''s repair migration exists for: a write '
    || 'to a closed row that touches no status at all. Before `20261020190200_stage11_closed_is_terminal.sql` '
    || 'the wall waved this through its own same-status branch, which is how `operator_release_case` was '
    || 'appending to finished tickets — measured at `37a6989` in '
    || '`q11-logs/s11-s2-release-closed-probe2b.txt`, and this cell is the regression, not a restatement of '
    || 'the row above', t, '23514', '%a closed support case is terminal%');

  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_plant_upd_sql('in_progress',
        'assigned_operator_user_id = ' || pg_temp.s11b_u(c.op1), c.host_a));
  PERFORM pg_temp.s11b_accept('L56 and the identical write against a live row is still accepted: the repair '
    || 'closed the terminal case, it did not tighten the wall around assignment writes, which is what the '
    || 'claim and release doors in group C are built on', t);

  -- --- the wall's other two refusals, which no door in this slice can reach ---
  PERFORM pg_temp.s11b_err_is('L57 `case_ref` is the first immutable fact and the wall names the column '
    || 'rather than the act, because a rewrite of the ref would orphan every row that quotes it',
    pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_plant_upd_sql('triaged',
      'case_ref = ''SV-REWRITED1''', c.host_a)), '42501', '%case_ref is minted once and quoted forever%');
  PERFORM pg_temp.s11b_err_is('L58 re-parenting onto another wedding is refused, and this is the cell that '
    || 'makes the scope claim in §5 true below the doors: a case whose wedding can move is a case whose '
    || 'privacy scope can move with it',
    pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_plant_upd_sql('triaged',
      'wedding_id = ' || pg_temp.s11b_u(c.wb), c.host_a)),
    '42501', '%cannot be re-parented onto another wedding%');
  PERFORM pg_temp.s11b_err_is('L59 and a ticket cannot change hands, because whose read surface it appears '
    || 'on is derived from this column rather than stored anywhere',
    pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_plant_upd_sql('triaged',
      'requester_user_id = ' || pg_temp.s11b_u(c.host_b), c.host_a)),
    '42501', '%cannot change hands%');

  -- One sentence, three columns, three cells: the OR in the wall has three arms and a disjunct quietly
  -- dropped from it would leave the other two still refusing, so one cell for the sentence proves one arm.
  PERFORM pg_temp.s11b_err_is('L60 who opened the case',
    pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_plant_upd_sql('triaged',
      'opened_by_user_id = ' || pg_temp.s11b_u(c.host_b), c.host_a)),
    '42501', '%who opened this case and when are the first two facts%');
  PERFORM pg_temp.s11b_err_is('L61 when it was opened',
    pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_plant_upd_sql('triaged',
      'opened_at = now() + interval ''1 day''', c.host_a)),
    '42501', '%who opened this case and when are the first two facts%');
  PERFORM pg_temp.s11b_err_is('L62 and the key that opened it — the third arm, without which a back-dated '
    || 'open could be re-bought with a fresh key and the thread would hold two rows claiming one opening',
    pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_plant_upd_sql('triaged',
      'open_idempotency_key = ' || pg_temp.s11b_u(kl.k_late), c.host_a)),
    '42501', '%who opened this case and when are the first two facts%');
  PERFORM pg_temp.s11b_err_is('L63 category, which is the host''s own claim at the moment of opening',
    pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_plant_upd_sql('triaged',
      'category = ''billing''', c.host_a)), '42501', '%category and severity are the host%');
  PERFORM pg_temp.s11b_err_is('L64 and severity, in the same sentence with the reason the wall gives rather '
    || 'than the reason a reviewer would have invented',
    pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_plant_upd_sql('triaged',
      'severity = ''high''', c.host_a)), '42501', '%category and severity are the host%');

  PERFORM pg_temp.s11b_err_is('L65 a hand write that leaves the status alone may not mint a resolution for '
    || 'it — the branch the repair moved the terminal test above, measured here on a live row so the two '
    || 'arms of that branch are both seen',
    pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_plant_upd_sql('triaged',
      'status = ''triaged'', resolved_at = now()', c.host_a)),
    '42501', '%a status that did not change may not gain or lose its resolution%');
  PERFORM pg_temp.s11b_err_is('L66 and entering a resting state by hand without a code is refused by the '
    || 'wall itself: the door refuses this too (L10), but a hand at a console reaches the same sentence, '
    || 'which is the point of keeping the edge table in one place',
    pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_plant_upd_sql('in_progress',
      'status = ''closed''', c.host_a)), '23514',
    '%entering closed requires a resolution code: a ticket that ends without saying how it ended is not '
    || 'evidence%');

  -- --- the four write doors, asked of the ticket this group just finished ---
  -- Taken through `s11b_probe` rather than `s11b_try` so that a regression cannot leave a durable row: the
  -- digests below are the assertion, and a probe that wrote and then asserted would be reporting its own
  -- fixture. Every one of these four reuses `k_late`, which carries nothing on this case because every
  -- sweep that touched it was rolled back.
  z0c := pg_temp.s11b_cstate();  z0e := pg_temp.s11b_estate();  z0a := pg_temp.s11b_adigest();

  PERFORM pg_temp.s11b_door_sweep(pg_temp.s11b_ref('no_wed'), 'closed', c.op1, kl.k_late);
  PERFORM pg_temp.s11b_array('L67 the six pairs asked of the closed ticket, and the transition door''s four '
    || 'terminal refusals arrive from the wall rather than from its own body — the body has no terminal '
    || 'branch for a transition, because it delegates the edge table, and this pass is what proves the '
    || 'delegation is complete',
    pg_temp.s11b_sweep_report('door', 'closed', 6), '{}'::text[]);

  PERFORM pg_temp.s11b_err_is('L68 the repaired door, named for what it now refuses: the release is one of '
    || 'the four write doors and slice 2 left it the only one that was not, which made §10''s handover the '
    || 'way to end a ticket with a live assignee',
    pg_temp.s11b_probe('authenticated', c.op1,
      'SELECT api.operator_release_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('no_wed'))
      || ', ' || pg_temp.s11b_u(kl.k_late) || ')'),
    '23514', '%a closed support case is not rewritten, and releasing it is a rewrite%');
  PERFORM pg_temp.s11b_err_is('L69 the claim door says the same sentence about the same act, which is the '
    || 'pair the repair was written to complete — a policy in one door and not the other is not a policy',
    pg_temp.s11b_probe('authenticated', c.op1,
      'SELECT api.operator_claim_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('no_wed'))
      || ', ' || pg_temp.s11b_u(kl.k_late) || ')'),
    '23514', '%a closed support case is not rewritten, and claiming it is a rewrite%');
  PERFORM pg_temp.s11b_err_is('L70 and the terminal test sits *above* the holding rules in the release '
    || 'door, so a caller cannot use this ticket to learn whether anybody holds it: the answer for a closed '
    || 'case with no assignee is the same refusal the door would give for one with an assignee',
    pg_temp.s11b_probe('authenticated', c.op1,
      'SELECT api.operator_release_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('no_wed'))
      || ', ' || pg_temp.s11b_u(kl.k_late) || ')'),
    '23514', '%is not rewritten%');
  PERFORM pg_temp.s11b_err_is('L70b the host''s own door refuses the closed thread, from the requester and '
    || 'with the reason the door gives rather than a scoping refusal — a caller who is entitled to read this '
    || 'ticket is told it is finished, not that they may not touch it',
    pg_temp.s11b_probe('authenticated', c.host_a,
      'SELECT api.reply_to_support_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('no_wed'))
      || ', ' || pg_temp.s11b_t('Trying to add to a finished ticket.')
      || ', ' || pg_temp.s11b_u(kl.k_late) || ')'),
    '23514', '%a closed support case takes no further messages%');
  PERFORM pg_temp.s11b_err_is('L70c and the internal note, which is the door a reviewer would expect to be '
    || 'allowed — an operator may want to write down why a ticket ended, and slice 2''s answer is that they '
    || 'may write it on the ticket that reopened the question',
    pg_temp.s11b_probe('authenticated', c.op1,
      'SELECT api.operator_add_case_note(' || pg_temp.s11b_t(pg_temp.s11b_ref('no_wed'))
      || ', ''message_operator'', ' || pg_temp.s11b_t('Internal note on a finished ticket.')
      || ', ' || pg_temp.s11b_u(kl.k_late) || ')'),
    '23514', '%a closed support case takes no further rows%');

  PERFORM pg_temp.s11b_eq('L71 nothing in the closed ticket''s thread moved: six refusals, one pass of the '
    || 'door sweep and one pass of the guard sweep, and the digest is the proof rather than the count '
    || 'because an absorbed append would leave the count alone',
    pg_temp.s11b_estate(), z0e);
  PERFORM pg_temp.s11b_eq('L72 the row did not move either', pg_temp.s11b_cstate(), z0c);
  PERFORM pg_temp.s11b_eq('L73 and the trail did not grow behind the finished ticket — this is the third '
    || 'digest of that claim and the only one that would have failed at `37a6989`, where the release door '
    || 'accepted and wrote a `case_released` row whose subject was a closed case',
    pg_temp.s11b_adigest(), z0a);

  -- --- what the two projections say about the ticket the walk finished ---
  v := pg_temp.s11b_as('authenticated', c.host_a,
        'SELECT api.get_my_support_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('no_wed')) || ')');
  PERFORM pg_temp.s11b_eq('L74 the host still reads their own finished ticket: closure is not deletion, and '
    || 'the row the walk left is still theirs to look at', pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('L75 the reply box is told to disappear — derived from the status rather than '
    || 'stored, which is the only reason it can be trusted to agree with the door that refuses the reply',
    v -> 'reply_allowed', 'false');
  PERFORM pg_temp.s11b_eq('L76 and the resume flag is off: a closed ticket is waiting on nobody',
    v -> 'resume_expected', 'false');
  PERFORM pg_temp.s11b_eq('L77 the ending is stated, with the code that says how it ended',
    (v ->> 'status') || '|' || (v ->> 'resolution_code'), 'closed|host_withdrew');
  PERFORM pg_temp.s11b_eq('L78 and the host is shown the eleven rows of their own thread — this ticket was '
    || 'walked, never claimed, so its thread holds no operator-arm row and the count is an honest reading of '
    || 'a thread with nothing to hide. The filter itself is group X''s work: it measures an `assignment`, a '
    || '`message_operator` and an `operation_link` sitting in a case the host can read, on the one ticket in '
    || 'this battery whose thread was untouched before that group planted on it',
    jsonb_array_length(v -> 'events'), 11);

  w := pg_temp.s11b_as('authenticated', c.op1,
        'SELECT api.get_operator_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('no_wed')) || ')');
  PERFORM pg_temp.s11b_eq('L79 the operator reads the same finished ticket, and the read door has no '
    || 'terminal branch: a closed case is still evidence a second operator has to be able to look at',
    pg_temp.s11b_err(w), NULL);
  PERFORM pg_temp.s11b_eq('L80 and the two projections agree on the eleven rows for this ticket because '
    || 'this ticket has nothing to hide, which is stated so that a reader does not take L78 as the filter '
    || 'cell it is not',
    jsonb_array_length(w -> 'events'), jsonb_array_length(v -> 'events'));
  PERFORM pg_temp.s11b_eq('L81 the assignee slot is a JSON null rather than an absent key — the same rule '
    || 'C08 states for the queue, and a read surface that dropped the key would teach a console to keep '
    || 'showing the last operator who held a ticket',
    jsonb_typeof(w -> 'assigned_operator_user_id'), 'null');

  -- --- the queue, after the walk ---
  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_case_queue(NULL, NULL, NULL)');
  PERFORM pg_temp.s11b_eq('L82 the unfiltered queue still holds all five tickets: closure moves a case out '
    || 'of the states a filter names, not out of the table', jsonb_array_length(v -> 'cases'), 5);
  w := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_case_queue(''open'', NULL, NULL)');
  PERFORM pg_temp.s11b_eq('L83 the open page lost exactly the one ticket this group walked',
    jsonb_array_length(w -> 'cases'), 4);
  w := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_case_queue(''closed'', NULL, NULL)');
  PERFORM pg_temp.s11b_eq('L84 and the closed page has exactly that ticket, which is the first time in '
    || 'this file a filter returns a row at all — a screen that cannot list finished work is a screen that '
    || 'cannot be reviewed',
    coalesce((w -> 'cases' -> 0) ->> 'case_ref', '(none)'), pg_temp.s11b_ref('no_wed'));
  PERFORM pg_temp.s11b_eq('L84b one row on that page, no more: the four tickets group C left are all open',
    jsonb_array_length(w -> 'cases'), 1);
  w := pg_temp.s11b_as('authenticated', c.op1,
        'SELECT api.operator_case_queue(''resolved'', NULL, NULL)');
  PERFORM pg_temp.s11b_eq('L85 the resolved page is still empty, because the walk passed through '
    || '`resolved` and did not stop there: the count is the walk''s own evidence as much as the queue''s',
    jsonb_array_length(w -> 'cases'), 0);

  -- --- what the walk added, in total, against the counts the group started with ---
  PERFORM pg_temp.s11b_eq('L86 ten event rows added by this group: six status decisions, three messages '
    || 'to the host and one reply. The count is the group''s own delta — `main` carries two assignment rows '
    || 'bought by group C''s doors, and those are not this ticket''s story',
    pg_temp.s11b_ecount(), n0e + 10);
  PERFORM pg_temp.s11b_eq('L86b and the walked ticket itself holds no assignment row at all: it was walked '
    || 'rather than handed over, and the door that would have written one is the claim group''s, not this '
    || 'group''s',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('no_wed') AND e.kind = 'assignment'), 0);
  PERFORM pg_temp.s11b_eq('L87 five trail rows over the whole battery, one per act that needed the grant',
    pg_temp.s11b_acount(), n0a + 5);
  PERFORM pg_temp.s11b_eq('L88 and no case row was created or destroyed by any of the rolled-back probes '
    || 'in this group — the seventy-two sweep answers, eleven hand plants and four door refusals — which is '
    || 'what makes the walk''s counts the only durable result the sweeps had',
    pg_temp.s11b_ccount(), n0c);
  PERFORM pg_temp.s11b_eq('L89 the ledger finished at seventy-two rows, which is the last pass of the door '
    || 'half added to the sixty-six counted at L54: the sweep is a record of what was asked, as well as an '
    || 'answer',
    (SELECT count(*)::int FROM s11b_sweep), 72);
END $l$;

-- ===========================================================================
-- 8. The privacy boundary: what the two reads filter, and what a stranger's ref looks like (X00–X32)
-- ===========================================================================
-- §5's whole claim about this slice is one WHERE clause inside `internal_api.get_my_support_case`: a host
-- sees the messages on their own thread and the status history, and never an operator's private note, never
-- an assignment, never the `operation_link` row a later slice will append when it takes something down.
-- Every other group in this file proves that clause by *authorisation* — a door refuses a caller who is not
-- entitled. This group proves it by *projection*, which is a different property and a different way to fail:
-- a door that refuses correctly can still hand the whole thread to the party it let through, and the host
-- who reads `message_operator` in their own browser has learned something the ticket was written to keep
-- from them without any privilege ever having been crossed.
--
-- Two methods, therefore. The operator-only kinds are planted as rows so that a real thread contains all
-- five arms at once — a thread that happens to hold only host rows cannot prove a filter exists, only that
-- it was never asked — and both projections are read over the same rows. Then the plants are deleted and the
-- before/after digests are compared, so the group leaves the chain exactly as it found it and the undo is
-- itself a cell. Deleting is done by `postgres` for the same reason every plant in this file is: the
-- client-write walls skip the trusted roles, and a battery that could not clean up after itself would be a
-- battery whose residue the next group has to guess about.
--
-- The subject of the planting is `steal`, not `main`, and that is a measured choice rather than a taste. The
-- first draft of this group planted on `main` and its pre-plant cell failed at once with three rows already
-- present: group C's claim and release each write an `assignment` row through the door, and group C's note
-- writes a `message_operator` row, all of them durably, so `main`'s thread is not an empty stage and a cell
-- that says "these arms are absent here" is false on that ticket. `steal` is the case group R opened for a
-- stranger and nobody else has written to — one `status` row, no message, no assignment — so the three arms
-- below really are the only rows of their kind on it, which is what makes the host's silence about them a
-- measurement of the filter instead of a measurement of an empty set.
--
-- The second half is the oracle rule. Stage 3 established that a missing ref and a foreign ref answer
-- alike, and group O measured it for the host's own doors; what group O did not do is compare the two
-- answers as *bytes*, which is the only form of the claim that a later reader can re-run without knowing
-- what the sentence was supposed to be. Every pair below is the same door, the same caller, two refs — one
-- belonging to another household and one that exists nowhere — and the assertion is that the two answer
-- strings are identical rather than merely both refusals.

-- The seq is minted by `support_case_events_mint_seq`, measured on a rolled-back plant that arrived at 12
-- after a thread of eleven, so this helper names no seq — a battery that supplied the ordinal would be
-- testing its own arithmetic instead of the trigger's, and group T owns that question.
CREATE FUNCTION pg_temp.s11b_plant_ev(p_tag text, p_kind text, p_actor_kind text, p_actor uuid,
                                      p_body text)
RETURNS bigint
LANGUAGE plpgsql AS $fn$
DECLARE v_id bigint;
BEGIN
  INSERT INTO private.support_case_events
      (case_id, kind, actor_user_id, actor_kind, body)
    VALUES (pg_temp.s11b_id(p_tag), p_kind, p_actor, p_actor_kind, p_body)
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

CREATE FUNCTION pg_temp.s11b_unplant_ev(p_ids bigint[]) RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE v_n integer;
BEGIN
  DELETE FROM private.support_case_events e WHERE e.id = ANY(p_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;

-- The thread as the *table* holds it, one string per row in seq order, for the cells whose subject is a row
-- rather than a payload. The projections are read through the doors separately; keeping the two arrays
-- distinct is what lets a cell say "the filter held" without saying "the row is gone".
CREATE FUNCTION pg_temp.s11b_thread(p_tag text) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(e.seq::text || ':' || e.kind || ':' || e.actor_kind
                            ORDER BY e.seq), '{}'::text[])
    FROM private.support_case_events e
   WHERE e.case_id = pg_temp.s11b_id(p_tag)
$fn$;

-- The kinds a payload actually shows, in the order the payload shows them.
CREATE FUNCTION pg_temp.s11b_shown(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(e ->> 'kind' ORDER BY (e ->> 'seq')::int), '{}'::text[])
    FROM jsonb_array_elements(v -> 'events') e
$fn$;

DO $x$
DECLARE
  c s11b_cast%ROWTYPE;
  x0 text[];
  xh text[];
  h0 text;
  v jsonb;
  r1 text;
  r2 text;
  n0e bigint;
  n0c bigint;
  a bigint;
  b bigint;
  d bigint;
  mail_ref text;
BEGIN
  SELECT * INTO c FROM s11b_cast;
  n0e := pg_temp.s11b_ecount();
  n0c := pg_temp.s11b_ccount();
  x0 := pg_temp.s11b_thread('steal');
  v := pg_temp.s11b_as('authenticated', c.host_a,
        'SELECT api.get_my_support_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ')');
  PERFORM pg_temp.s11b_eq('X00 setup: the host can read their own busiest ticket at all',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('X00a and that ticket really does hold three operator-arm rows — two assignments '
    || 'bought by group C''s claim and release, one internal note — which is the measurement that rejected '
    || 'it as the subject of the planting below: a thread with rows already in the arms under test cannot '
    || 'show whether an absent name was filtered or never there',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('main')
        AND e.kind IN ('assignment','message_operator','operation_link')), 3);
  PERFORM pg_temp.s11b_eq('X00b and yet none of those three rows is in the payload the host gets: the same '
    || 'filter, measured on a thread that genuinely holds all five arms, without any plant by this group',
    (SELECT count(*)::int FROM jsonb_array_elements(v -> 'events') e
      WHERE e ->> 'kind' IN ('assignment','message_operator','operation_link')), 0);
  v := pg_temp.s11b_as('authenticated', c.host_b,
        'SELECT api.get_my_support_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('steal')) || ')');
  PERFORM pg_temp.s11b_eq('X00c the subject this group does plant on is host_b''s own ticket, readable by '
    || 'its owner, and its thread is the single opening edge group R minted',
    pg_temp.s11b_err(v), NULL);
  xh := pg_temp.s11b_shown(v);
  h0 := (v -> 'events')::text;

  -- --- the filter, over a thread that holds all five arms at once ---
  PERFORM pg_temp.s11b_eq('X01 before anything is planted, the host''s view of their own thread is exactly '
    || 'the table''s two host-visible arms in seq order: the filter agrees with the row set it is supposed '
    || 'to be a subset of',
    xh, (SELECT coalesce(array_agg(e.kind::text ORDER BY e.seq), '{}'::text[])
           FROM private.support_case_events e
          WHERE e.case_id = pg_temp.s11b_id('steal') AND e.kind IN ('message_host','status')));
  PERFORM pg_temp.s11b_eq('X02 and none of the three arms this group is about to write is in this case''s '
    || 'thread yet, so the cells that follow measure the filter against rows only this file put there',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('steal')
        AND e.kind IN ('assignment','message_operator','operation_link')), 0);

  a := pg_temp.s11b_plant_ev('steal', 'assignment', 'operator', c.op1, NULL);
  b := pg_temp.s11b_plant_ev('steal', 'message_operator', 'operator', c.op1,
                             'Internal note for the review meeting: contact s11b-host-b@stage11qual.test.');
  d := pg_temp.s11b_plant_ev('steal', 'operation_link', 'operator', c.op1, NULL);

  PERFORM pg_temp.s11b_eq('X03 three rows planted by hand, and the table has them: without this cell the '
    || 'four cells below prove only that an empty thread is quiet',
    array_length(pg_temp.s11b_thread('steal'), 1) - array_length(x0, 1), 3);

  v := pg_temp.s11b_as('authenticated', c.host_b,
        'SELECT api.get_my_support_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('steal')) || ')');
  PERFORM pg_temp.s11b_eq('X04 the host''s thread did not grow: the same rows in the same order, with three '
    || 'operator-arm rows sitting in the case they cannot see',
    pg_temp.s11b_shown(v), xh);
  PERFORM pg_temp.s11b_eq('X05 and the payload is byte-identical to the one taken before the plants — a '
    || 'count can be matched by an absorbed row and a dropped one, a digest cannot',
    (v -> 'events')::text, h0);
  PERFORM pg_temp.s11b_eq('X06 none of the three arm names appears anywhere in the host payload, including '
    || 'in a `kind` the projection did not show: the filter is a WHERE clause, not a label the client hides',
    (SELECT count(*)::int FROM unnest(ARRAY['assignment','message_operator','operation_link']) bad
      WHERE position(bad in v::text) > 0), 0);
  PERFORM pg_temp.s11b_eq('X07 nor does the internal note''s text, which is the sentence this group exists '
    || 'to write: the note names the host''s own address, and the host who reads their own thread is not '
    || 'shown the note that was written about them',
    (v::text LIKE '%review meeting%')::int, 0);
  PERFORM pg_temp.s11b_eq('X08 and the host''s events carry no actor column at all: not a null one, not an '
    || 'empty one — the key is absent, which is why the two projections can be told apart by a reader who '
    || 'has only the payloads',
    (SELECT count(*)::int FROM jsonb_array_elements(v -> 'events') e WHERE e ? 'actor_user_id'), 0);

  v := pg_temp.s11b_as('authenticated', c.op1,
        'SELECT api.get_operator_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('steal')) || ')');
  PERFORM pg_temp.s11b_eq('X09 the operator reads the same case and gets the arms the host did not: this '
    || 'is the same table, the same rows, the same order, and the only difference is the scope the caller '
    || 'holds',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_array('X10 and the three planted kinds arrive in seq order at the end of the '
    || 'thread, named exactly as the table spells them',
    (SELECT coalesce(array_agg(e ->> 'kind' ORDER BY (e ->> 'seq')::int), '{}'::text[])
       FROM jsonb_array_elements(v -> 'events') e
      WHERE (e ->> 'seq')::int > (SELECT coalesce(max(seq),0) - 3
                                    FROM private.support_case_events WHERE case_id = pg_temp.s11b_id('steal'))),
    ARRAY['assignment','message_operator','operation_link']);
  PERFORM pg_temp.s11b_eq('X11 the internal note is visible to the operator because it was written for '
    || 'them — the same text X07 refused the host, measured as present here so that a reader can see the '
    || 'filter hides nothing from the party entitled to it',
    (v::text LIKE '%review meeting%')::int, 1);
  PERFORM pg_temp.s11b_eq('X12 and every event the operator is shown names its actor as a uuid — the '
    || 'column that makes a trail useful is present on the surface entitled to carry it, and it carries an '
    || 'account rather than a name, an email or anything a reader could look up',
    (SELECT count(*)::int FROM jsonb_array_elements(v -> 'events') e
      WHERE (e ->> 'actor_user_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    jsonb_array_length(v -> 'events'));

  -- --- the undo, and what it leaves ---
  PERFORM pg_temp.s11b_eq('X13 the three plants are deleted by the trusted role, which is the one role the '
    || 'client-write wall skips: an operator-facing arm the battery could not remove would be residue the '
    || 'next group reads as fact',
    pg_temp.s11b_unplant_ev(ARRAY[a,b,d]), 3);
  PERFORM pg_temp.s11b_eq('X14 and `steal''s thread is the array this group captured before it planted '
    || 'anything — same seqs, same kinds, same actors',
    pg_temp.s11b_thread('steal'), x0);
  PERFORM pg_temp.s11b_eq('X15 the host''s payload is byte-identical to X05''s baseline again, which is the '
    || 'cell that says the group read the same rows it started with rather than a different set that happens '
    || 'to be the same size',
    (pg_temp.s11b_as('authenticated', c.host_b,
        'SELECT api.get_my_support_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('steal')) || ')')
        -> 'events')::text, h0);
  PERFORM pg_temp.s11b_eq('X16 and no ordinal was left behind: the thread''s highest seq is its length, so '
    || 'the mint trigger will hand the next act the number the reader would expect',
    (SELECT (coalesce(max(e.seq),0) - count(*))::int FROM private.support_case_events e
      WHERE e.case_id = pg_temp.s11b_id('steal')), 0);
  PERFORM pg_temp.s11b_eq('X17 nothing anywhere on the chain is an `operation_link` row now — that arm is '
    || 'written by slice 4, and a Stage 11 battery that left one behind would be pretending a takedown '
    || 'happened',
    (SELECT count(*)::int FROM private.support_case_events WHERE kind = 'operation_link'), 0);
  PERFORM pg_temp.s11b_eq('X18 the whole thread table is the size it was when this group opened: three '
    || 'plants and three deletes, and no side effect',
    pg_temp.s11b_ecount(), n0e);

  -- --- the stranger's ref, compared as bytes ---
  r1 := pg_temp.s11b_probe('authenticated', c.host_a,
        'SELECT api.reply_to_support_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('b1'))
        || ', ' || pg_temp.s11b_t('A message that will not be delivered.') || ', '
        || pg_temp.s11b_u(gen_random_uuid()) || ')');
  r2 := pg_temp.s11b_probe('authenticated', c.host_a,
        'SELECT api.reply_to_support_case(' || pg_temp.s11b_t('SV-NOSUCHREF')
        || ', ' || pg_temp.s11b_t('A message that will not be delivered.') || ', '
        || pg_temp.s11b_u(gen_random_uuid()) || ')');
  PERFORM pg_temp.s11b_eq('X19 a real ticket in another household and a ref that exists nowhere answer the '
    || 'reply door with the same bytes, not merely the same SQLSTATE: the message is compared as a string so '
    || 'that a future sentence which echoes the ref would be caught by this cell rather than by a reader',
    r1, r2);
  PERFORM pg_temp.s11b_err_is('X20 and the answer both callers get is the scoping refusal rather than the '
    || 'lifecycle one — host_a learning that `b1` is closed would be learning something about `b1`',
    r1, '42501', '%may not reply on this support case%');

  r1 := pg_temp.s11b_probe('authenticated', c.host_a,
        'SELECT api.get_my_support_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('steal')) || ')');
  r2 := pg_temp.s11b_probe('authenticated', c.host_a,
        'SELECT api.get_my_support_case(' || pg_temp.s11b_t('SV-NOSUCHREF') || ')');
  PERFORM pg_temp.s11b_eq('X21 the same pair, asked of the read door: the read is the door a console probes '
    || 'for a list of valid refs, so this is the half of the rule that matters most and the half a write '
    || 'door''s refusal would not have covered',
    r1, r2);

  r1 := pg_temp.s11b_probe('authenticated', c.host_c,
        'SELECT api.get_my_support_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ')');
  r2 := pg_temp.s11b_probe('authenticated', c.host_c,
        'SELECT api.get_my_support_case(' || pg_temp.s11b_t('SV-NOSUCHREF') || ')');
  PERFORM pg_temp.s11b_eq('X22 and a third shape of the same fact: host_c owns no wedding and no ticket, so '
    || 'for them *every* ref in the system is somebody else''s, and the answer for host_a''s real ticket is '
    || 'the answer for a made-up one',
    r1, r2);

  r1 := pg_temp.s11b_probe('authenticated', c.host_a,
        'SELECT api.open_support_case(' || pg_temp.s11b_u(c.wx) || ', ''other'', ''low'', '
        || pg_temp.s11b_t('A case about a wedding that is not mine.') || ', '
        || pg_temp.s11b_u(gen_random_uuid()) || ')');
  r2 := pg_temp.s11b_probe('authenticated', c.host_a,
        'SELECT api.open_support_case(' || pg_temp.s11b_u(c.ghost) || ', ''other'', ''low'', '
        || pg_temp.s11b_t('A case about a wedding that is not mine.') || ', '
        || pg_temp.s11b_u(gen_random_uuid()) || ')');
  PERFORM pg_temp.s11b_eq('X23 the opening door takes a uuid rather than a ref, and the rule holds there '
    || 'too: host_x''s real wedding and a uuid that names no row are the same answer',
    r1, r2);
  PERFORM pg_temp.s11b_eq('X24 and neither opened anything — the count this group started with is the count '
    || 'it has now, so a refusal in the opening door cannot be a ticket with no ref',
    pg_temp.s11b_ccount(), n0c);

  r1 := pg_temp.s11b_probe('anon', NULL,
        'SELECT api.get_my_support_case(' || pg_temp.s11b_t(pg_temp.s11b_ref('main')) || ')');
  r2 := pg_temp.s11b_probe('anon', NULL,
        'SELECT api.get_my_support_case(' || pg_temp.s11b_t('SV-NOSUCHREF') || ')');
  PERFORM pg_temp.s11b_eq('X25 the anonymous caller is refused before the ref is read at all, which is the '
    || 'one case in this group where the two answers are identical for a reason that has nothing to do with '
    || 'ownership: the door never reaches the lookup, so it cannot be an oracle about anything',
    r1, r2);

  -- --- the host's own words, which are not a leak and are measured as they are ---
  v := pg_temp.s11b_as('authenticated', c.host_c, pg_temp.s11b_open_sql(NULL, 'privacy_data_request',
        'normal',
        'Please remove my email address s11b-host-c@stage11qual.test from anything you print about this '
        || 'wedding.', gen_random_uuid()));
  PERFORM pg_temp.s11b_eq('X26 host_c, who owns nothing, can still open a case about their account: '
    || '`wedding_id` NULL is the shape §5 reserves for exactly this, and it is the ticket this sub-group '
    || 'needs because its summary is prose with an address in it',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_reg('mail', v, c.host_c);
  PERFORM pg_temp.s11b_ok('X27 and the ref it answers with is registered, so the two projections below and '
    || 'the census both read the row rather than a ref guessed out of the payload',
    pg_temp.s11b_ref('mail') = v ->> 'case_ref');
  mail_ref := v ->> 'case_ref';

  v := pg_temp.s11b_as('authenticated', c.host_c,
        'SELECT api.get_my_support_case(' || pg_temp.s11b_t(mail_ref) || ')');
  PERFORM pg_temp.s11b_eq('X28 the host reads back the words they typed, address included — the summary is '
    || 'the host''s own claim, and a projection that edited it would be a projection that could not be '
    || 'quoted back in a reply',
    v ->> 'host_summary',
    'Please remove my email address s11b-host-c@stage11qual.test from anything you print about this wedding.');

  v := pg_temp.s11b_as('authenticated', c.op1,
        'SELECT api.get_operator_case(' || pg_temp.s11b_t(mail_ref) || ')');
  PERFORM pg_temp.s11b_eq('X29 and the operator reads the same summary, which is the honest boundary and '
    || 'not the one a reviewer would guess: this stage promises the *system* will not put an address in a '
    || 'generated file, a telemetry line or an unrelated surface, and it does not promise to hide what the '
    || 'host wrote on the ticket from the person working the ticket',
    v ->> 'host_summary',
    'Please remove my email address s11b-host-c@stage11qual.test from anything you print about this wedding.');
  PERFORM pg_temp.s11b_eq('X30 but the address appears exactly once in that payload: the projection adds no '
    || 'copy of it to the event rows, and one mention travelling to the party the host chose to write to is '
    || 'a different fact from three surfaces each holding it',
    (length(v::text) - length(replace(v::text, '@', '')))::int, 1);
  PERFORM pg_temp.s11b_eq('X31 and the thread of that ticket holds no address at all, because the host''s '
    || 'opening edge is a `status` row with no body — the only prose on this ticket is the column it belongs '
    || 'to',
    (SELECT count(*)::int FROM jsonb_array_elements(v -> 'events') e
      WHERE position('@' in coalesce(e ->> 'body','')) > 0), 0);

  PERFORM pg_temp.s11b_ok('X32 the group leaves one durable ticket behind — `mail`, opened by an account '
    || 'with no wedding — and the census in group Z counts it rather than the chain''s total',
    mail_ref IS NOT NULL AND pg_temp.s11b_ccount() = n0c + 1);
END $x$;

-- ===========================================================================
-- 9. Revocation, expiry and the wall between the four duties (V01–V65)
-- ===========================================================================
-- Group P proved that no door opens for an account that never held the credential. That is the easy half:
-- nothing has to be undone. This group takes an account that does hold one, hands it a real ticket, and then
-- withdraws the credential through slice 1's one legal revocation path — because the property §3 cares about
-- is the one a stale session, a cached console or a half-migrated grant table breaks: authority has to stop
-- the instant the row says revoked, and acts that were legal a moment ago have to be refused by the same
-- statement strings, not merely by a screen that hides the button.
--
-- Three choices inside the group are worth stating before the cells.
--
--   1. The subject is `mail`, and the group claims it for real rather than probing the claim. A probe proves
--      the door would answer; only a durable claim lets the release door be measured on the after-side
--      without a second confound, because `operator_release_case` carries its own holder check and a release
--      refused from somebody who never held the ticket would not tell you which of two 42501 sentences
--      stopped it. The claim is undone at V56, by the same account after its credential is restored, so the
--      group hands `mail` back unassigned and its extra trail rows are counted by the census in group Z
--      rather than hidden from it.
--   2. Every door is refused on its own line. The six authority guards share one predicate and one SQLSTATE,
--      and group P loops them; here each gets its own cell, because the claim after a revocation is that six
--      separate bodies each re-ask, and "the caller was refused" with no name attached is a count with no
--      list behind it.
--   3. Expiry is produced by moving two timestamps by hand, not by minting an already-dead grant. The mint
--      body refuses an expiry in the past and the table refuses an expiry before its own `granted_at`, so the
--      only honest way to stand a lapsed credential in front of the predicate is a write on the trusted
--      channel that moves both columns together. That write is durable and named in the census, and V47
--      measures the single-column version of it as the refusal it is rather than pretending it never happens.
DO $v$
DECLARE
  c s11b_cast%ROWTYPE;
  v jsonb;
  t text;
  t2 text;
  mail_ref text;
  q_sql text;
  get_sql text;
  note_sql text;
  claim_sql text;
  rel_sql text;
  tr_sql text;
  k_claim uuid;
  k_rel uuid;
  k_note uuid;
  k_tr uuid;
  g0 bigint;
  ga0 bigint;
  ag0 bigint;
  a0 bigint;
  e0 bigint;
  c0 bigint;
  b_c text;
  b_e text;
  b_a text;
  b_g text;
  aid bigint;
  bg0 text;
  op_a uuid;
  op_b uuid;
  gid_revoked uuid;
  gid_lapsed uuid;
  gid_second uuid;
BEGIN
  SELECT * INTO c FROM s11b_cast;
  mail_ref := pg_temp.s11b_ref('mail');
  k_claim := gen_random_uuid();
  k_rel := gen_random_uuid();
  k_note := gen_random_uuid();
  k_tr := gen_random_uuid();

  -- The six statement strings, built once. The point of building them here instead of writing each call
  -- twice is that the before-and-after cells cannot drift apart by a token: the same text that group V
  -- proves ACCEPTED is the text it then proves refused, and a later edit to one door is an edit to both
  -- halves of the pair.
  q_sql := 'SELECT api.operator_case_queue(' || pg_temp.s11b_t('open') || ', NULL, NULL)';
  get_sql := 'SELECT api.get_operator_case(' || pg_temp.s11b_t(mail_ref) || ')';
  note_sql := 'SELECT api.operator_add_case_note(' || pg_temp.s11b_t(mail_ref) || ', '
    || pg_temp.s11b_t('message_operator') || ', '
    || pg_temp.s11b_t('A note that must not survive the revocation.') || ', '
    || pg_temp.s11b_u(k_note) || ')';
  claim_sql := 'SELECT api.operator_claim_case(' || pg_temp.s11b_t(mail_ref) || ', '
    || pg_temp.s11b_u(k_claim) || ')';
  rel_sql := 'SELECT api.operator_release_case(' || pg_temp.s11b_t(mail_ref) || ', '
    || pg_temp.s11b_u(k_rel) || ')';
  tr_sql := pg_temp.s11b_trans_sql(mail_ref, 'triaged', NULL,
    'A move that must not survive the revocation.', k_tr);

  -- --- the credential is live, and six doors know it (V01–V07) ---
  t := pg_temp.s11b_probe('authenticated', c.op1, claim_sql);
  PERFORM pg_temp.s11b_accept('V01 the claim door answers ACCEPTED for op1 while its grant row says active '
    || '— this is the same string V25 will ask for a refusal, and the probe rolls the claim back so the '
    || 'durable half below is the first one that really takes the ticket', t);

  v := pg_temp.s11b_as('authenticated', c.op1, claim_sql);
  PERFORM pg_temp.s11b_eq('V02 and the durable claim goes through the real door rather than a hand plant: '
    || 'no error at all, which is the only way this group can say the credential was working instead of '
    || 'assuming it', pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('V02b the ticket now carries op1 as its holder, which is the fact the release cell '
    || 'below depends on and the fact V32 re-reads after the revocation',
    (SELECT x.assigned_operator_user_id FROM private.support_cases x
      WHERE x.id = pg_temp.s11b_id('mail')), c.op1);

  t := pg_temp.s11b_probe('authenticated', c.op1, rel_sql);
  PERFORM pg_temp.s11b_accept('V03 the release door answers for the operator who holds the case — while '
    || 'both credentials are live this is the door''s ordinary success, and after V08 it becomes the '
    || 'sharpest refusal in the group because the caller is still the holder', t);
  t := pg_temp.s11b_probe('authenticated', c.op1, note_sql);
  PERFORM pg_temp.s11b_accept('V04 the note door answers for a live support operator on an open case', t);
  t := pg_temp.s11b_probe('authenticated', c.op1, tr_sql);
  PERFORM pg_temp.s11b_accept('V05 and so does the transition door, on an edge the lifecycle genuinely '
    || 'allows from open — a refusal here would have made V27 measure the edge table instead of the '
    || 'credential', t);

  v := pg_temp.s11b_as('authenticated', c.op1, q_sql);
  PERFORM pg_temp.s11b_eq('V06 the queue read answers, which is the read-side half of the same fact: a '
    || 'revocation that only stopped the writes would still be a hole, and V22 is where it gets measured',
    pg_temp.s11b_err(v), NULL);
  v := pg_temp.s11b_as('authenticated', c.op1, get_sql);
  PERFORM pg_temp.s11b_eq('V07 and the single-case read answers for a case belonging to another household, '
    || 'because the support scope is the whole queue by design — group X proved what that read filters, '
    || 'this group proves who may make it', pg_temp.s11b_err(v), NULL);

  -- Everything the revocation path is about to touch, measured from here on as a delta.
  g0 := (SELECT count(*) FROM private.operator_grants);
  a0 := pg_temp.s11b_acount();
  e0 := pg_temp.s11b_ecount();
  c0 := pg_temp.s11b_ccount();
  ga0 := (SELECT count(*) FROM private.operator_grants WHERE status = 'active');
  ag0 := (SELECT count(*) FROM private.audit_events
            WHERE subject_type = 'operator_grant');

  -- --- the revocation itself (V08–V21) ---
  v := (SELECT internal_api.revoke_operator_role(c.op1, 'support',
        'battery 2: this account''s qualification run on the support duty is over', c.decider));
  aid := (v ->> 'audit_id')::bigint;
  gid_revoked := (v ->> 'grant_id')::uuid;
  PERFORM pg_temp.s11b_eq('V08 the revocation answers with the row it just wrote, and the word it writes is '
    || 'revoked rather than deleted, disabled or blank', v ->> 'status', 'revoked');
  PERFORM pg_temp.s11b_ok('V09 the row named by that answer is the one the group started from: it still '
    || 'exists, its status is revoked, and revoked_at is set — the pair CHECK means the timestamp cannot be '
    || 'missing from a row that claims to be revoked',
    EXISTS (SELECT 1 FROM private.operator_grants g
             WHERE g.id = gid_revoked AND g.user_id = c.op1 AND g.scope = 'support'
               AND g.status = 'revoked' AND g.revoked_at IS NOT NULL));
  PERFORM pg_temp.s11b_eq('V10 and the predicate the six doors ask now answers false for that account — '
    || 'nothing was cached, nothing was reloaded, one row moved', pg_temp.s11b_is(c.op1, 'support'), false);
  PERFORM pg_temp.s11b_eq('V11 the grant table holds exactly the rows it held a moment ago: the revocation '
    || 'is a status write and no row vanished', (SELECT count(*) FROM private.operator_grants), g0);
  PERFORM pg_temp.s11b_eq('V12 the grant row''s own reason still says why the credential was minted, because '
    || 'the revocation''s reason belongs on the trail row and a status write that overwrote it would destroy '
    || 'the record of the decision it is correcting',
    (SELECT g.reason FROM private.operator_grants g WHERE g.id = gid_revoked),
    'battery 2: the operator who walks the thread');

  PERFORM pg_temp.s11b_eq('V13 the revocation wrote exactly one trail row',
    ((SELECT count(*) FROM private.audit_events) - a0)::int, 1);
  PERFORM pg_temp.s11b_eq('V14 and that row names the duty, the decision and the row it decided about',
    (SELECT a.action || '/' || a.subject_type FROM private.audit_events a WHERE a.id = aid),
    'revoked/operator_grant');
  PERFORM pg_temp.s11b_eq('V14b its subject key is the grant id rather than a ref, so the trail survives the '
    || 'grant row''s own deletion by cascade',
    (SELECT a.subject_key FROM private.audit_events a WHERE a.id = aid), gid_revoked);
  PERFORM pg_temp.s11b_eq('V15 it is recorded as a maintenance act by the named human who decided, with no '
    || 'wedding attached — a revocation is not a household event',
    (SELECT a.actor_kind || '/' || coalesce(a.actor_user_id::text, 'nobody') || '/'
          || coalesce(a.wedding_id::text, 'NULL') FROM private.audit_events a WHERE a.id = aid),
    'maintenance/' || c.decider::text || '/NULL');
  PERFORM pg_temp.s11b_eq('V16 and the one thing this path does not have: no idempotency key. Measured '
    || 'rather than assumed, because the three support doors that write the trail all carry one, so the '
    || 'absence here is an asymmetry a reviewer would otherwise read as an oversight — the console can ask '
    || 'a second query to find the row, and V18 shows what a replay actually does',
    (SELECT coalesce(a.idempotency_key, 'ABSENT') FROM private.audit_events a WHERE a.id = aid), 'ABSENT');
  PERFORM pg_temp.s11b_eq('V17 the two state projections carry exactly the facts a review of a revocation '
    || 'asks for: which status was live, when it was granted, what expiry was attached, who granted it, and '
    || 'what replaced it',
    (SELECT (before_state ->> 'status') || '/' || (after_state ->> 'status') || '/'
          || (before_state ? 'granted_by_user_id')::text || '/' || (after_state ? 'revoked_at')::text
       FROM private.audit_events a WHERE a.id = aid), 'active/revoked/true/true');

  -- Taken *after* V08 rather than with the other baselines above: the durable revocation is the event these
  -- two replays must not repeat, so a digest captured before it would compare the refusals against a state
  -- the group itself already changed and V21 would fail for the wrong reason.
  bg0 := pg_temp.s11b_gstate();

  -- Both replays run on the trusted channel, the same way V08 ran. Asked through `authenticated` they would
  -- be refused by the function ACL before the body ever looked for an active row, and the cell would prove
  -- the grant table is not readable by a client role — which is group P's finding, not this one. What V18
  -- has to measure is what the *body* does with a second request for an act that already happened.
  BEGIN
    v := (SELECT internal_api.revoke_operator_role(c.op1, 'support',
          'a second attempt at the same act', c.decider));
    t := 'ACCEPTED/' || coalesce(v ->> 'status', 'no status');
  EXCEPTION WHEN OTHERS THEN
    t := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM pg_temp.s11b_err_is('V18 a replayed revocation is refused rather than absorbed: the body looks for '
    || 'an active row and finds only the one it already wrote down, so "already done" is not an answer this '
    || 'path can give', t, 'P0001', '%no active support grant for account%to revoke%');
  BEGIN
    v := (SELECT internal_api.revoke_operator_role(c.op1, 'privacy',
          'a duty this account never held', c.decider));
    t2 := 'ACCEPTED/' || coalesce(v ->> 'status', 'no status');
  EXCEPTION WHEN OTHERS THEN
    t2 := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM pg_temp.s11b_err_is('V19 and the refusal for a scope the account never held is the same shape, '
    || 'which is the point: the body will not say whether this account once had the duty',
    t2, 'P0001', '%no active privacy grant for account%to revoke%');
  PERFORM pg_temp.s11b_eq('V20 compared as bytes with the two caller-supplied words normalised out — the '
    || 'account id and the scope word, which are the only parts of the sentence that come from the request — '
    || 'the two refusals are one sentence, so the trail''s absence of a "was never granted" branch holds',
    replace(replace(t, c.op1::text, '<uid>'), 'support', '<scope>'),
    replace(replace(t2, c.op1::text, '<uid>'), 'privacy', '<scope>'));
  PERFORM pg_temp.s11b_eq('V21 and two refusals left the grant table exactly where V08 left it: the failed '
    || 'revocation did not rewrite the revoked row''s status, its reason or its timestamp',
    pg_temp.s11b_gstate(), bg0);

  -- --- the six doors, each one asked by name, after the revocation (V22–V32) ---
  b_c := pg_temp.s11b_cstate();
  b_e := pg_temp.s11b_estate();
  b_a := pg_temp.s11b_adigest();
  b_g := pg_temp.s11b_gstate();

  t := pg_temp.s11b_try('authenticated', c.op1, q_sql);
  PERFORM pg_temp.s11b_err_is('V22 the queue door refuses the revoked operator with its own sentence, as a '
    || 'real signed-in account asking for the list it was reading thirty seconds ago',
    t, '42501', '%the caller may not read the case queue%');
  t := pg_temp.s11b_try('authenticated', c.op1, get_sql);
  PERFORM pg_temp.s11b_err_is('V23 the single-case read refuses, and with the sentence the host read uses, '
    || 'so a revoked operator probing refs learns nothing about them',
    t, '42501', '%the caller may not read this support case%');
  t := pg_temp.s11b_try('authenticated', c.op1, note_sql);
  PERFORM pg_temp.s11b_err_is('V24 the note door refuses — including the private arm, which is the one a '
    ||' console left open after a revocation would still be able to write',
    t, '42501', '%the caller may not add a note to this support case%');
  t := pg_temp.s11b_try('authenticated', c.op1, claim_sql);
  PERFORM pg_temp.s11b_err_is('V25 the claim door refuses the byte-for-byte string V01 proved ACCEPTED and '
    || 'V02 ran for real: the authority guard is reached before the replay lookup, so even the key that '
    || 'already bought this act cannot be used to re-read it',
    t, '42501', '%the caller may not claim this support case%');
  t := pg_temp.s11b_try('authenticated', c.op1, rel_sql);
  PERFORM pg_temp.s11b_err_is('V26 the release door refuses the very operator who holds the ticket, and '
    || 'with the authority sentence rather than the holder sentence — which is the distinction V03 was built '
    || 'to make measurable', t, '42501', '%the caller may not release this support case%');
  t := pg_temp.s11b_try('authenticated', c.op1, tr_sql);
  PERFORM pg_temp.s11b_err_is('V27 and so does the transition door: six bodies, six refusals, one predicate '
    || 'each of them re-asks', t, '42501', '%the caller may not change this support case%');

  PERFORM pg_temp.s11b_eq('V28 the six refusals moved no case row: the digest V22 started from is the digest '
    || 'V28 re-takes', pg_temp.s11b_cstate(), b_c);
  PERFORM pg_temp.s11b_eq('V29 no thread row either, including on the ticket op1 still holds',
    pg_temp.s11b_estate(), b_e);
  PERFORM pg_temp.s11b_eq('V30 no trail row either', pg_temp.s11b_adigest(), b_a);
  PERFORM pg_temp.s11b_eq('V31 and no grant row either — a refusal cannot retire a second credential or '
    || 'reopen the one it refused', pg_temp.s11b_gstate(), b_g);
  PERFORM pg_temp.s11b_eq('V32 the assignment did not travel with the credential: the revoked operator is '
    || 'still the holder of the ticket they claimed while authorised, which is the honest consequence rather '
    || 'than the one a reviewer would hope for — the queue keeps the work, and what stops is the ability to '
    || 'act on it',
    (SELECT x.assigned_operator_user_id FROM private.support_cases x
      WHERE x.id = pg_temp.s11b_id('mail')), c.op1);

  -- --- the revocation is one row, not a switch (V33–V36) ---
  PERFORM pg_temp.s11b_eq('V33 the second operator''s predicate is untouched by the first one''s '
    || 'revocation', pg_temp.s11b_is(c.op2, 'support'), true);
  v := pg_temp.s11b_as('authenticated', c.op2, q_sql);
  PERFORM pg_temp.s11b_eq('V34 and that account is still reading the same queue the revoked one was '
    || 'refused a moment earlier — the same statement string, the same session shape, one row of grant '
    || 'difference', pg_temp.s11b_err(v), NULL);
  SELECT g.user_id INTO op_a FROM private.operator_grants g
   WHERE g.scope = 'support' AND g.status = 'active' AND g.user_id <> ALL (ARRAY[c.op1, c.op2]);
  PERFORM pg_temp.s11b_ok('V35 slice 1''s own live support credential is discoverable and still live — this '
    || 'group revoked one row out of a table three duties share, and the third holder is the proof',
    op_a IS NOT NULL AND pg_temp.s11b_is(op_a, 'support'));
  v := pg_temp.s11b_as('authenticated', c.host_a,
        'SELECT api.get_my_support_cases(NULL, NULL)');
  PERFORM pg_temp.s11b_eq('V36 a host door still answers, which is the precision claim: withdrawing an '
    || 'operational scope is not a session kill and does not turn a person into a stranger on their own '
    || 'tickets', pg_temp.s11b_err(v), NULL);

  -- --- the wall between the four duties (V37–V44) ---
  SELECT g.user_id INTO op_b FROM private.operator_grants g
   WHERE g.scope = 'operations' AND g.status = 'active';
  PERFORM pg_temp.s11b_ok('V37 there is exactly one live operations credential on the chain, and it is not '
    || 'a support credential — slice 1 minted it to be revoked and re-granted, so this is its second row',
    op_b IS NOT NULL AND NOT pg_temp.s11b_is(op_b, 'support'));
  PERFORM pg_temp.s11b_eq('V38 the predicate says yes for the duty it holds',
    pg_temp.s11b_is(op_b, 'operations'), true);
  PERFORM pg_temp.s11b_eq('V39 and no for the duty it does not: one scope is one scope, and the four words '
    || 'in the CHECK are four separate permissions rather than a single operator flag',
    pg_temp.s11b_is(op_b, 'support'), false);
  t := pg_temp.s11b_try('authenticated', op_b, q_sql);
  PERFORM pg_temp.s11b_err_is('V40 the operations holder is refused the queue by name, with the support '
    || 'door''s own sentence', t, '42501', '%the caller may not read the case queue%');
  t := pg_temp.s11b_try('authenticated', op_b, tr_sql);
  PERFORM pg_temp.s11b_err_is('V41 refused by the transition door too — three doors asked individually '
    || 'rather than one, because the guards live in six bodies and a copy-paste that checked operations '
    || 'instead of support in one of them would show up as an ACCEPTED here',
    t, '42501', '%the caller may not change this support case%');
  t := pg_temp.s11b_try('authenticated', op_b, claim_sql);
  PERFORM pg_temp.s11b_err_is('V42 and refused by the claim door, which is the one that would hand a queue '
    || 'ticket to a person whose duty is something else entirely',
    t, '42501', '%the caller may not claim this support case%');
  t := pg_temp.s11b_try('authenticated', c.op2,
        'SELECT internal_api.grant_operator_role(' || pg_temp.s11b_u(c.host_a) || ', '
        || pg_temp.s11b_t('support') || ', ' || pg_temp.s11b_t('a self-issued second credential')
        || ', ' || pg_temp.s11b_u(c.op2) || ', NULL)');
  PERFORM pg_temp.s11b_err_is('V43 a live support operator cannot mint a credential — not for somebody else '
    || 'and not for themselves. This is the kickoff''s own boundary restated as a database fact: an operator '
    || 'may not grant an entitlement, and the refusal comes from the function ACL rather than from the '
    || 'body, so it arrives before any argument is read',
    t, '42501', '%permission denied for function grant_operator_role%');
  t := pg_temp.s11b_try('authenticated', c.op2,
        'SELECT internal_api.revoke_operator_role(' || pg_temp.s11b_u(c.op1) || ', '
        || pg_temp.s11b_t('support') || ', ' || pg_temp.s11b_t('an operator retiring a peer')
        || ', ' || pg_temp.s11b_u(c.op2) || ')');
  PERFORM pg_temp.s11b_err_is('V44 and a support operator cannot revoke one either: the escalation this '
    || 'slice exists to prevent is the peer revocation as much as the peer grant',
    t, '42501', '%permission denied for function revoke_operator_role%');

  -- --- expiry, with no cleanup job anywhere (V45–V52) ---
  v := (SELECT internal_api.grant_operator_role(c.host_b, 'support',
        'battery 2: a credential that will lapse while the battery is still running', c.decider,
        now() + interval '10 minutes'));
  gid_lapsed := (v ->> 'grant_id')::uuid;
  PERFORM pg_temp.s11b_eq('V45 the mint accepts a future expiry and answers with the row, expiry included',
    (v ->> 'status') || '/' || (v ? 'expires_at')::text, 'active/true');
  PERFORM pg_temp.s11b_eq('V46 and while it is inside that window the predicate says yes, so the expiry '
    || 'column is not doing nothing by accident', pg_temp.s11b_is(c.host_b, 'support'), true);
  t := pg_temp.s11b_probe('postgres', NULL,
        'UPDATE private.operator_grants SET expires_at = ''2026-01-02T00:00:00+00''::timestamptz'
        || ' WHERE id = ' || pg_temp.s11b_u(gid_lapsed));
  PERFORM pg_temp.s11b_err_is('V47 a hand write that moves only the expiry is refused by the table: a '
    || 'credential cannot be back-dated into validity or lapsed into a shape its own granted_at contradicts, '
    || 'and the battery needs the refusal stated because the two-column write below is otherwise '
    || 'indistinguishable from an override', t, '23514', '%operator_grants_expiry_after_grant_check%');
  UPDATE private.operator_grants
     SET granted_at = '2026-01-01T00:00:00+00'::timestamptz,
         expires_at = '2026-01-02T00:00:00+00'::timestamptz
   WHERE id = gid_lapsed;
  PERFORM pg_temp.s11b_eq('V48 moving both timestamps together is accepted on the trusted channel, and the '
    || 'row still says active afterwards — nothing in the schema marks a lapsed grant, and this battery has '
    || 'no scheduler, so this is the state a real expired credential sits in until somebody acts on it',
    (SELECT g.status FROM private.operator_grants g WHERE g.id = gid_lapsed), 'active');
  PERFORM pg_temp.s11b_eq('V49 and the predicate refuses it anyway, on the strength of the expiry alone: '
    || 'this is the cell that makes §17''s "no cleanup job is required for safety" a measurement rather than '
    || 'a hope', pg_temp.s11b_is(c.host_b, 'support'), false);
  t := pg_temp.s11b_try('authenticated', c.host_b, q_sql);
  PERFORM pg_temp.s11b_err_is('V50 the lapsed credential cannot read the queue — the door asks the same '
    || 'predicate V49 just answered false for, which is why one rule covers six bodies',
    t, '42501', '%the caller may not read the case queue%');
  t := pg_temp.s11b_try('authenticated', c.host_b, claim_sql);
  PERFORM pg_temp.s11b_err_is('V51 and cannot claim a case with it either; host_b is a host, and the '
    || 'host-side doors below are unaffected because they never asked this predicate',
    t, '42501', '%the caller may not claim this support case%');
  v := (SELECT internal_api.revoke_operator_role(c.host_b, 'support',
        'battery 2: retiring the lapsed credential so the live set is honest about what it contains',
        c.decider));
  PERFORM pg_temp.s11b_eq('V52 the retired-by-expiry row can still be revoked, and that is the finding '
    || 'rather than a failure: the expiry makes the credential harmless and only the console makes it '
    || 'revoked, so an operator review that wants a clean live set has to act, not wait',
    v ->> 'status', 'revoked');

  -- --- restoration is a new decision, and the doors come back (V53–V57) ---
  v := (SELECT internal_api.grant_operator_role(c.op1, 'support',
        'battery 2: the same account granted again, to measure that a revoked row does not block a new '
        || 'decision', c.decider, NULL));
  gid_second := (v ->> 'grant_id')::uuid;
  PERFORM pg_temp.s11b_eq('V53 a re-grant after a revocation is a second row rather than a resurrection of '
    || 'the first, and the partial unique index is what makes that legal: it constrains one active row per '
    || 'account and scope, not one row forever',
    (v ->> 'status') || '/' || (gid_second <> gid_revoked)::text, 'active/true');
  PERFORM pg_temp.s11b_eq('V54 this account now holds two rows for the duty and exactly one is live — the '
    || 'history an operator review asks for and the reason an UPDATE in place would have destroyed it',
    (SELECT count(*)::int || '/' || count(*) FILTER (WHERE g.status = 'active')::int
       FROM private.operator_grants g WHERE g.user_id = c.op1 AND g.scope = 'support'), '2/1');
  PERFORM pg_temp.s11b_eq('V55 the predicate says yes again', pg_temp.s11b_is(c.op1, 'support'), true);
  v := pg_temp.s11b_as('authenticated', c.op1, rel_sql);
  PERFORM pg_temp.s11b_eq('V56 and the door it was refused at V26 answers now, so the restoration is real at '
    || 'the body rather than only in the grant table — this is also the act that hands the ticket back',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('V57 the ticket is unassigned again: the group leaves the case as it found it, and '
    || 'the two assignment rows it wrote stay on the thread as the record that this happened',
    (SELECT x.assigned_operator_user_id FROM private.support_cases x
      WHERE x.id = pg_temp.s11b_id('mail')), NULL::uuid);

  -- --- the group''s own footprint, so group Z counts it rather than guessing (V58–V65) ---
  PERFORM pg_temp.s11b_eq('V58 the grant table grew by exactly two rows — the lapsed credential and the '
    || 'second support grant — and no row was removed',
    ((SELECT count(*) FROM private.operator_grants) - g0)::int, 2);
  PERFORM pg_temp.s11b_eq('V59 the live set is the same size it was when this group started: four duties, '
    || 'two of them now held by different rows than at the head of the group',
    (SELECT count(*) FROM private.operator_grants WHERE status = 'active'), ga0);
  PERFORM pg_temp.s11b_eq('V60 the trail grew by five rows from this baseline: the release, and the four '
    || 'decisions this group made about credentials. The claim is not in the count because V02 performed it '
    || 'before a0 was read — the same reason V62 counts one thread row rather than two',
    ((SELECT count(*) FROM private.audit_events) - a0)::int, 5);
  PERFORM pg_temp.s11b_eq('V61 four of them are grant decisions, which is the count that would double if a '
    || 'replay ever wrote a second record of one act',
    ((SELECT count(*) FROM private.audit_events
       WHERE subject_type = 'operator_grant') - ag0)::int, 4);
  PERFORM pg_temp.s11b_eq('V62 and the thread table grew by exactly one row — the release, because the claim '
    || 'was already counted in the baseline this delta is taken from. Every other act in this group was a '
    || 'probe that rolled back or a refusal that wrote nothing',
    ((SELECT count(*) FROM private.support_case_events) - e0)::int, 1);
  PERFORM pg_temp.s11b_eq('V63 no case was created or destroyed by any of it',
    (SELECT count(*) FROM private.support_cases), c0);
  PERFORM pg_temp.s11b_eq('V64 the revoked row V09 named is still on the table by its id — the only '
    || 'revocation path in this stage writes, and nothing here deletes',
    EXISTS (SELECT 1 FROM private.operator_grants g WHERE g.id = gid_revoked
      AND g.status = 'revoked')::text, 'true');
  PERFORM pg_temp.s11b_ok('V65 all three grant rows this group created or retired are each named by a trail '
    || 'row of their own — the first revocation, the lapsed mint, the re-grant — so the ledger of who held '
    || 'what is complete without reading a single UI surface',
    (SELECT count(DISTINCT a.subject_key)::int FROM private.audit_events a
      WHERE a.subject_type = 'operator_grant'
        AND a.subject_key IN (gid_revoked, gid_lapsed, gid_second)) = 3);
END $v$;

-- ===========================================================================
-- 10. What the doors write into the audit trail (A00–A27)
-- ===========================================================================
-- Groups C, L and X proved what the doors *do* to the two support tables and what they let a caller *see*.
-- Group V proved who may stand in front of them. This group is about the third record — the trail — and it
-- exists because the other batteries cannot reach it: a cell inside group C asserts that a claim moved the
-- ticket, and a cell inside group V asserts that a revoked operator was refused, and neither of them looks
-- at what the ledger says afterwards about the act. That is the artefact §4's whole argument rests on, so it
-- gets its own group, worked on one ticket from first click to last.
--
-- Four choices inside the group are worth stating before the cells.
--
--   1. The subject is `mail` and the arc is real. Every row the group reads is written by a door called
--      through `s11b_as` by a granted operator, not by a hand plant: a planted audit row can demonstrate a
--      CHECK but it cannot demonstrate what the bodies choose to project, and "the trail records the
--      decision" is a claim about the bodies. The arc — claim, triage with a message to the host, take it
--      in hand, resolve it, release it — is five durable acts, which is the minimum that covers both
--      assignment verbs and all three status rows a resting state needs.
--   2. `payload`, not the row. The two assignment bodies and the transition body each hand the trail a
--      two-field projection and a four-field before/after pair, and none of them is constrained to by the
--      table: `payload` is jsonb, and `audit_events_before_state_is_object_check` only refuses an array or
--      a scalar. So the shape is asserted per row as a sorted key set plus the values, and a migration that
--      started copying `host_summary` into the ledger would fail A02 or A10 rather than being reviewed in
--      a screen.
--   3. The prose goes one way. `mail` was chosen as the subject because its summary is a host email address
--      (group X left it there deliberately), and the transition call carries an operator sentence with a
--      marker in it. Both halves are measured: the marker reaches the ticket exactly once and the trail
--      zero times, and the address reaches the trail zero times in all five rows. §4 promises no body copies
--      caller text into an audit column, and this is the only place in Stage 11 where a caller text and an
--      audit write are in the same statement, so it is the only place that promise can actually break.
--   4. The key namespace is measured, not assumed. Three scopes are in play on this chain: the open door's
--      key is per requester, a thread key is per case, and the trail's key is global. The first two are
--      proved in groups R and C; the third has a consequence nobody has yet named, so A23 aims one already
--      used key at a second ticket and reads the refusal, and A24 then proves the refusal left nothing
--      behind. What the refusal *means* for an operator who reuses a key across tickets is recorded as a
--      finding rather than written off as a passing test.
--
-- `actor_role` is measured here too and it does not say what the column name suggests — see A05. Notes are
-- deliberately not re-proved: the note door writes no trail row, and group C measures that on its own terms.
-- Groups C, V and X also leave their durable footprints on this ticket and on `steal`, which is why A00 and
-- A00b state the inherited state before the arc starts: if an earlier group changes, this group fails loudly
-- instead of asserting a story about five rows that are no longer five rows.

-- The whole-table digest the harness already has, cut off at a row id. Group A's closing claim is that the
-- rows which were on the trail before it started did not move while its own five appeared, and a whole-table
-- digest can only say that by comparing two strings that each already contain the new rows — which would be
-- a comparison that cannot fail for the reason it claims to test.
CREATE FUNCTION pg_temp.s11b_adigest_upto(p_max bigint) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || subject_type || '|' || coalesce(subject_key::text, '') || '|' || action || '|'
           || actor_role || '|' || coalesce(actor_user_id::text, '') || '|' || payload::text || '|'
           || coalesce(reason, '') || '|' || coalesce(idempotency_key, '') || '|'
           || coalesce(before_state::text, '') || '|' || coalesce(after_state::text, '') || '|'
           || coalesce(wedding_id::text, ''), '~' ORDER BY id), ''))
    FROM private.audit_events WHERE id <= p_max $fn$;

DO $a$
DECLARE
  c s11b_cast%ROWTYPE;
  v jsonb;
  w jsonb;
  marker text := 'S11B-PROSE-MARKER-7f3a';
  mail_ref text;
  mail_id uuid;
  steal_ref text;
  k_claim uuid;
  k_tri uuid;
  k_prog uuid;
  k_res uuid;
  k_rel uuid;
  k_steal uuid;
  aid_claim bigint;
  aid_tri bigint;
  aid_res bigint;
  aid_rel bigint;
  a0 bigint;
  max0 bigint;
  ad_old text;
  cd0 text;
  ed0 text;
  ad0 text;
BEGIN
  SELECT * INTO c FROM s11b_cast;
  mail_ref := pg_temp.s11b_ref('mail');
  mail_id := pg_temp.s11b_id('mail');
  steal_ref := pg_temp.s11b_ref('steal');
  k_claim := gen_random_uuid();
  k_tri := gen_random_uuid();
  k_prog := gen_random_uuid();
  k_res := gen_random_uuid();
  k_rel := gen_random_uuid();
  k_steal := gen_random_uuid();

  -- Everything below is measured against this moment: the count for the delta, the highest id for the
  -- bounded digest and the row-selection cells, and the thread length for the six rows this group adds.
  a0 := pg_temp.s11b_acount();
  max0 := (SELECT max(id) FROM private.audit_events);
  ad_old := pg_temp.s11b_adigest_upto(max0);

  PERFORM pg_temp.s11b_array('A00 setup: the ticket this group works on is back on the queue exactly as '
    || 'group V handed it — open, held by nobody, and its history is the opening row plus the claim and '
    || 'release V left durable. Stating the inheritance rather than assuming it is what lets A19 say '
    || '"five rows" about the trail instead of about the table',
    ARRAY[(SELECT x.status FROM private.support_cases x WHERE x.id = mail_id),
          coalesce((SELECT x.assigned_operator_user_id::text FROM private.support_cases x
                     WHERE x.id = mail_id), '(nobody)')],
    ARRAY['open', '(nobody)']);
  PERFORM pg_temp.s11b_array('A00b and the thread this group starts from is those three rows, in order — '
    || 'the seq the six new rows continue from is a measured fact about the chain, not a number the cells '
    || 'below have to remember',
    pg_temp.s11b_thread('mail'),
    ARRAY['1:status:host', '2:assignment:operator', '3:assignment:operator']);

  -- --- the two assignment verbs, and what each one writes (A01–A08) ---
  v := pg_temp.s11b_as('authenticated', c.op2,
        'SELECT api.operator_claim_case(' || pg_temp.s11b_t(mail_ref) || ', '
        || pg_temp.s11b_u(k_claim) || ')');
  PERFORM pg_temp.s11b_eq('A01 op2 takes the ticket through the real door',
    pg_temp.s11b_err(v), NULL);
  aid_claim := (v ->> 'audit_id')::bigint;

  PERFORM pg_temp.s11b_keys('A02 the trail row that claim wrote carries a two-field projection — the ref '
    || 'and the wedding — which is everything an incident review can ask of a support act without lifting '
    || 'the ticket itself, and nothing else. The table would have accepted a whole row: `payload` is jsonb '
    || 'and its CHECK only refuses arrays and scalars, so this key set is the body''s own discipline and is '
    || 'therefore only evidence when it is measured',
    (SELECT a.payload FROM private.audit_events a WHERE a.id = aid_claim),
    ARRAY['case_ref', 'wedding_id']);

  PERFORM pg_temp.s11b_eq('A03 and both fields answer for this ticket: the ref is the one the door returned, '
    || 'and the wedding is a JSON null rather than a missing key, because `mail` is about an account and the '
    || 'projection states that instead of hiding it',
    (SELECT (a.payload ->> 'case_ref') || '/' || jsonb_typeof(a.payload -> 'wedding_id')
       FROM private.audit_events a WHERE a.id = aid_claim),
    mail_ref || '/null');

  PERFORM pg_temp.s11b_eq('A04 the trail''s own `wedding_id` column agrees with the ticket''s, which is the '
    || 'fact that makes a per-wedding audit query work at all — and here both sides are null, so the cell '
    || 'also proves the body did not reach for *some* wedding to fill the column with',
    (SELECT coalesce(a.wedding_id::text, '(null)') FROM private.audit_events a WHERE a.id = aid_claim)
      || '/' || coalesce((SELECT x.wedding_id::text FROM private.support_cases x WHERE x.id = mail_id),
                         '(null)'),
    '(null)/(null)');

  PERFORM pg_temp.s11b_eq('A05 `actor_role` on that row is the definer role and not the caller role. Every '
    || 'support body is SECURITY DEFINER, so the session role PostgREST set never reaches this column and '
    || 'the value cannot distinguish a browser request from a console call. Recorded as a finding rather '
    || 'than a wish: attribution in this stage rests entirely on `actor_kind` plus `actor_user_id`, and '
    || 'nothing on the trail can tell a reviewer which role asked',
    (SELECT a.actor_role FROM private.audit_events a WHERE a.id = aid_claim), 'postgres');

  PERFORM pg_temp.s11b_eq('A06 while the human is recorded once, as the pair the table demands: kind '
    || '`operator` and the id the body derived from `auth.uid()`. There is no argument anywhere on this door '
    || 'that could have carried it, which is the difference between attribution and assertion',
    (SELECT a.actor_kind || '/' || coalesce(a.actor_user_id::text, '(nobody)')
       FROM private.audit_events a WHERE a.id = aid_claim),
    'operator/' || c.op2::text);

  PERFORM pg_temp.s11b_eq('A07 and the same is true of every human-kind row already on the trail, from '
    || 'slice 1''s grant mints to group V''s revocation: the finding generalises because the architecture '
    || 'does, and no body in Stage 11 writes an audit row as the caller',
    (SELECT count(*)::int FROM private.audit_events a
      WHERE a.actor_kind IN ('operator', 'host', 'maintenance') AND a.actor_role <> 'postgres'), 0);

  PERFORM pg_temp.s11b_eq('A08 the ticket''s newest history row carries the same key the trail row does, so '
    || 'one reader holding only the ticket can find the ledger entry for the act, and a reader holding only '
    || 'the ledger can find the ticket',
    (SELECT e.idempotency_key::text FROM private.support_case_events e
      WHERE e.case_id = mail_id ORDER BY e.seq DESC LIMIT 1), k_claim::text);

  -- --- the transition door, which takes a decision and a sentence in the same call (A09–A16) ---
  v := pg_temp.s11b_as('authenticated', c.op2, pg_temp.s11b_trans_sql(mail_ref, 'triaged', NULL,
        'Looking at this now — please allow a day. Internal reference ' || marker || '.', k_tri));
  PERFORM pg_temp.s11b_eq('A09 the first status move is accepted with a message to the host attached, which '
    || 'is the only door on this stage that writes two history rows for one call',
    pg_temp.s11b_err(v), NULL);
  aid_tri := (v ->> 'audit_id')::bigint;

  PERFORM pg_temp.s11b_eq('A10 and the sentence that reached the host did not reach the ledger. The marker '
    || 'is searched for across every text-bearing column of the trail row that call wrote — reason, payload, '
    || 'both states, action, subject type, key — and appears nowhere. §4 promises no body copies caller text '
    || 'into an audit column, and this door is the one place that promise can break: it is handed prose and '
    || 'a decision in the same statement',
    coalesce((SELECT strpos(
        coalesce(a.reason, '') || a.payload::text
      || coalesce(a.before_state::text, '') || coalesce(a.after_state::text, '')
      || a.action || a.subject_type || coalesce(a.idempotency_key, ''), marker)
       FROM private.audit_events a WHERE a.id = aid_tri), 0)::int, 0);

  PERFORM pg_temp.s11b_eq('A11 but it is on the ticket exactly once, in the message row the same call wrote. '
    || 'The prose lives where the host reads it and nowhere else — one copy, not three surfaces each holding '
    || 'a version of it',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.case_id = mail_id AND strpos(coalesce(e.body, ''), marker) > 0), 1);

  PERFORM pg_temp.s11b_eq('A12 the reason the trail does carry is a sentence the body built out of the act — '
    || 'the ref, the from-state, the to-state — which is what makes it quotable in a review without quoting '
    || 'anybody, and is the design reason behind A10 rather than an accident of this particular message',
    (SELECT a.reason FROM private.audit_events a WHERE a.id = aid_tri),
    'support case ' || mail_ref || ' moved open to triaged');

  v := pg_temp.s11b_as('authenticated', c.op2,
        pg_temp.s11b_trans_sql(mail_ref, 'in_progress', NULL, NULL, k_prog));
  PERFORM pg_temp.s11b_eq('A12b the same door with no message is accepted',
    pg_temp.s11b_err(v), NULL);
  PERFORM pg_temp.s11b_eq('A12c and the thread shows the difference: two transitions with one message '
    || 'between them, so exactly one `message_host` row exists for the two moves. A body that wrote an empty '
    || 'message whenever the argument was NULL would have doubled the ticket''s history',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.case_id = mail_id AND e.seq > 3 AND e.kind = 'message_host'), 1);

  v := pg_temp.s11b_as('authenticated', c.op2,
        pg_temp.s11b_trans_sql(mail_ref, 'resolved', 'resolved_by_operator', NULL, k_res));
  PERFORM pg_temp.s11b_eq('A13 and the resting state is entered through the door with its code',
    pg_temp.s11b_err(v), NULL);
  aid_res := (v ->> 'audit_id')::bigint;

  PERFORM pg_temp.s11b_keys('A14 the trail row for that move states the before half as four fields — status, '
    || 'code, instant, holder — and the four are the whole question a reviewer asks about a status change',
    (SELECT a.before_state FROM private.audit_events a WHERE a.id = aid_res),
    ARRAY['assigned_operator_user_id', 'resolution_code', 'resolved_at', 'status']);
  PERFORM pg_temp.s11b_keys('A14b and the after half is stated as the same four fields, so the two are '
    || 'diffable by a reader who never sees the body''s source',
    (SELECT a.after_state FROM private.audit_events a WHERE a.id = aid_res),
    ARRAY['assigned_operator_user_id', 'resolution_code', 'resolved_at', 'status']);

  PERFORM pg_temp.s11b_eq('A15 read as values, the two halves differ exactly where the act happened: the '
    || 'code and the instant are absent before and present after, and the instant''s JSON type is a string '
    || 'the body could not have written because it never mentions it — `resolved_at` is stamped by the '
    || 'trigger and then read back, which is the posture §4 asks of a resting state',
    (SELECT coalesce(a.before_state ->> 'status', '(null)') || '/'
          || coalesce(a.before_state ->> 'resolution_code', '(null)') || '/'
          || coalesce(a.after_state  ->> 'status', '(null)') || '/'
          || coalesce(a.after_state  ->> 'resolution_code', '(null)') || '/'
          || coalesce(a.before_state ->> 'resolved_at', '(null)') || '/'
          || jsonb_typeof(a.after_state -> 'resolved_at')
       FROM private.audit_events a WHERE a.id = aid_res),
    'in_progress/(null)/resolved/resolved_by_operator/(null)/string');

  PERFORM pg_temp.s11b_eq('A16 and the row the trail describes is the row itself: same status, same code, '
    || 'and an instant that is now not null. The ledger and the domain are describing one fact, which is the '
    ||'only way an audit trail is worth reading',
    (SELECT x.status || '/' || coalesce(x.resolution_code, '(null)') || '/' || (x.resolved_at IS NOT NULL)::text
       FROM private.support_cases x WHERE x.id = mail_id),
    'resolved/resolved_by_operator/true');

  -- --- release, the count, and the key namespace (A17–A27) ---
  v := pg_temp.s11b_as('authenticated', c.op2,
        'SELECT api.operator_release_case(' || pg_temp.s11b_t(mail_ref) || ', '
        || pg_temp.s11b_u(k_rel) || ')');
  PERFORM pg_temp.s11b_eq('A17 releasing a resolved ticket is accepted, and that is a rule worth naming here '
    || 'rather than in the lifecycle group: `closed` is terminal and `resolved` is not, so a resting state '
    || 'can still be handed on. The claim edge that refuses `closed` is measured by L55',
    pg_temp.s11b_err(v), NULL);
  aid_rel := (v ->> 'audit_id')::bigint;

  PERFORM pg_temp.s11b_eq('A18 and the release''s payload is byte-identical to the claim''s. Two bodies '
    || 'projected the same two fields from the same row, which is the cheap proof that the shape in A02 is '
    || 'a contract rather than one function''s mood',
    (SELECT a.payload::text FROM private.audit_events a WHERE a.id = aid_rel),
    (SELECT a.payload::text FROM private.audit_events a WHERE a.id = aid_claim));

  PERFORM pg_temp.s11b_array('A19 the five acts this group made are on the trail in the order they happened, '
    || 'one row each — claim, three status changes, release. A sixth row for the message that travelled with '
    || 'the first transition, or a missing row for the transition that carried none, both fail here rather '
    || 'than in a count',
    coalesce((SELECT array_agg(a.action ORDER BY a.id) FROM private.audit_events a
               WHERE a.id > max0), ARRAY[]::text[]),
    ARRAY['case_claimed', 'status_changed', 'status_changed', 'status_changed', 'case_released']);

  PERFORM pg_temp.s11b_eq('A20 the count agrees with the list: five rows, taken as a delta from the baseline '
    || 'captured before this group''s first click',
    (pg_temp.s11b_acount() - a0)::int, 5);

  PERFORM pg_temp.s11b_array('A21 and the ticket''s own history tells the same story from the other side: '
    || 'the three rows group V left, then the claim, the move with its message, two bare moves, and the '
    || 'release. Six rows added, each named by kind and by the actor kind the body derived rather than one '
    || 'the caller supplied',
    pg_temp.s11b_thread('mail'),
    ARRAY['1:status:host', '2:assignment:operator', '3:assignment:operator', '4:assignment:operator',
          '5:status:operator', '6:message_host:operator', '7:status:operator', '8:status:operator',
          '9:assignment:operator']);

  PERFORM pg_temp.s11b_eq('A22 the rows that were on the trail before this group started are the same bytes '
    || 'they were — id, subject, action, role, actor, payload, reason, key, both states and wedding for every '
    || 'one of them. That is the append-only claim made about a named set of rows instead of about a table, '
    || 'which is the only form of it this battery can evidence without a second session',
    pg_temp.s11b_adigest_upto(max0), ad_old);

  -- The three digests the collision below must not move, taken after the five rows exist.
  cd0 := pg_temp.s11b_cstate();
  ed0 := pg_temp.s11b_estate();
  ad0 := pg_temp.s11b_adigest();

  w := pg_temp.s11b_as('authenticated', c.op2,
        'SELECT api.operator_claim_case(' || pg_temp.s11b_t(steal_ref) || ', '
        || pg_temp.s11b_u(k_claim) || ')');
  PERFORM pg_temp.s11b_err_is('A23 the key op2 used on `mail` one cell ago, now aimed at a second ticket, '
    || 'is refused by the trail''s global index rather than by the thread''s per-case one: the claim on `steal` '
    || 'passes every check the door itself makes — live credential, unheld ticket, unused key on that case — '
    || 'and then one row aborts it. This is the honest limit of the design, recorded as a finding: an '
    || 'operator who reuses one key across two tickets loses the second act, and the sentence they hear names '
    || 'a constraint instead of describing their own mistake',
    pg_temp.s11b_err(w), '23505', '%audit_events_one_row_per_idempotency_key%');

  PERFORM pg_temp.s11b_array('A24 and the refusal wrote nothing anywhere. All three tables digest '
    || 'byte-identical to the state this group reached after its fifth row: the door had already taken the '
    || 'ticket and inserted its history row before the ledger rejected the key, and a guard that aborts '
    || 'after its own earlier writes would leave a holder with no claim row and no trail row. A count cannot '
    || 'see that; three digests can',
    ARRAY[pg_temp.s11b_cstate(), pg_temp.s11b_estate(), pg_temp.s11b_adigest()],
    ARRAY[cd0, ed0, ad0]);

  PERFORM pg_temp.s11b_array('A25 the ticket the collision was aimed at is exactly as the earlier groups '
    || 'left it — open, unheld, one row of history — read from the row rather than inferred from the digest '
    || 'above, because a digest that covers both tables can hide a moved row in a table this group is not '
    || 'asking about',
    ARRAY[(SELECT x.status FROM private.support_cases x WHERE x.case_ref = steal_ref),
          coalesce((SELECT x.assigned_operator_user_id::text FROM private.support_cases x
                     WHERE x.case_ref = steal_ref), '(nobody)'),
          (SELECT count(*)::text FROM private.support_case_events e
            WHERE e.case_id = pg_temp.s11b_id('steal'))],
    ARRAY['open', '(nobody)', '1']);

  PERFORM pg_temp.s11b_eq('A26 and the ticket this group worked ends where its own lifecycle says a resolved '
    || 'case is allowed to sit: resolved, held by nobody. Nothing in this stage reaches for `closed` from '
    || 'here, and the census in group Z counts the ticket in that state',
    (SELECT x.status || '/' || coalesce(x.assigned_operator_user_id::text, '(nobody)')
       FROM private.support_cases x WHERE x.id = mail_id),
    'resolved/(nobody)');

  PERFORM pg_temp.s11b_eq('A27 the host''s own address — still in that ticket''s summary, and therefore '
    || 'read by every door above — appears in none of the five trail rows written about it, in any column. '
    || 'The summary is a column on the ticket and the trail is a ledger of decisions; this is the cell that '
    || 'keeps those two facts from being confused by a later migration that finds `payload` convenient',
    (SELECT count(*)::int FROM private.audit_events a WHERE a.id > max0
      AND strpos(coalesce(a.reason, '') || a.payload::text
                 || coalesce(a.before_state::text, '') || coalesce(a.after_state::text, '')
                 || a.action || a.subject_type || coalesce(a.idempotency_key, ''), '@') > 0), 0);
END $a$;

-- ===========================================================================
-- 11. The rules a door will not hand you (T01–T72, T-RI0–T-RI2o)
-- ===========================================================================
-- Everything above is reached through a door, which means it is measured with the arguments a door is
-- willing to accept. Half of this slice's rules are not door rules: the CHECKs that bound a category, a
-- resting pair, a body's length and a status vocabulary; the two foreign keys that refuse to point at an
-- account or a wedding that does not exist; the insert guard that refuses a human thread row naming
-- nobody; and the `ON DELETE SET NULL` links, which only fire when an *account* is deleted and therefore
-- cannot be reached by any caller at all. A door hands none of these a bad value — its own body refuses
-- first — so the only instrument left is a statement written by hand, run as the one role that gets past
-- `reject_client_write`.
--
-- That role is `postgres`, and the limit is stated before the cells that lean on it rather than after:
-- S07/S08 measured that no role a request can arrive as holds INSERT, UPDATE or DELETE on these tables,
-- and T01/T02 re-measure it, because every plant below is a claim about *the schema*, not about a request.
-- What these cells certify is what a writer who already holds the database key still cannot do — a later
-- migration, a repair at a console, or the trusted operations CLI this stage ships. Rules that bind the
-- owner bind everybody; the reverse does not follow, and no cell here is offered as evidence about HTTP.
--
-- Two debts this group pays to another file:
--
--   * `80_operator_authority.sql` measured the *refusal* half of the referential nulling (A06c, AI10b: an
--     UPDATE of `actor_user_id` issued by a caller is refused by the append-only guard) and named these
--     cells for the accepting half. T-RI2 is it: the same column moved by the database's own trigger.
--   * This slice's migration cites `q11-logs/s11-probe-fk-null-1.txt` for the case table's two protected
--     columns and promises "the surviving row" as a measurement, not a claim. T-RI1 is that after-side.
--
-- Each plant runs through `s11b_probe`, which unwinds whatever it accepted, so the chain group Z counts is
-- the chain group A left — except for the two accounts T-RI1 and T-RI2 delete, `host_d` and `decider`,
-- cast members whose only part in this file is being deleted. The deletions that must *not* land — the
-- operator whose credential vanishes with her (T65–T71) and the thread whose case is removed from under it
-- (T45) — run through `s11b_rollback_read`, which reads the inside of the statement and then discards it.
CREATE FUNCTION pg_temp.s11b_t_case(p_cat text DEFAULT 'other', p_sev text DEFAULT 'low',
                                    p_status text DEFAULT 'open', p_summary text DEFAULT 'auto',
                                    p_code text DEFAULT 'auto', p_resolved text DEFAULT 'auto',
                                    p_opened text DEFAULT 'auto', p_wedding uuid DEFAULT NULL,
                                    p_requester uuid DEFAULT NULL, p_opened_by uuid DEFAULT NULL,
                                    p_assignee uuid DEFAULT NULL, p_key uuid DEFAULT NULL,
                                    p_ref text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $fn$
-- One plant, six columns that normally take their default, and sentinels so a cell breaks exactly one rule
-- rather than the neighbouring one. `auto` means "whatever the rest of this row needs to stay legal", which
-- is what makes a refusal name the constraint under test; `null` renders the bare word NULL so a NOT NULL
-- cell can reach it; `none` clears a column a status would otherwise imply. The over-long and exact
-- summaries are rendered as `repeat()` calls, because a 2001-character literal carried through a statement
-- text measures the harness rather than the CHECK.
DECLARE v_resting boolean; v_cat text; v_sev text; v_status text; v_sum text;
        v_code text; v_res text; v_open text;
BEGIN
  v_resting := (p_status IN ('resolved', 'closed'));
  v_cat    := CASE WHEN p_cat = 'null' THEN 'NULL' ELSE quote_literal(p_cat) END;
  v_sev    := CASE WHEN p_sev = 'null' THEN 'NULL' ELSE quote_literal(p_sev) END;
  v_status := CASE WHEN p_status = 'null' THEN 'NULL' ELSE quote_literal(p_status) END;
  v_sum := CASE p_summary
             WHEN 'auto'  THEN quote_literal('A hand plant, aimed at a rule no door can reach.')
             WHEN 'blank' THEN quote_literal('   ')
             WHEN 'long'  THEN 'repeat(' || quote_literal('x') || ', 2001)'
             WHEN 'exact' THEN 'repeat(' || quote_literal('x') || ', 2000)'
             WHEN 'null'  THEN 'NULL'
             ELSE quote_literal(p_summary) END;
  v_code := CASE WHEN p_code = 'auto' THEN (CASE WHEN v_resting
                                                   THEN quote_literal('no_action_needed')
                                                   ELSE 'NULL' END)
                 WHEN p_code IN ('none', 'null') THEN 'NULL'
                 ELSE quote_literal(p_code) END;
  v_res := CASE WHEN p_resolved = 'auto' THEN (CASE WHEN v_resting THEN 'now()' ELSE 'NULL' END)
                WHEN p_resolved IN ('none', 'null') THEN 'NULL'
                WHEN p_resolved = 'now' THEN 'now()'
                WHEN p_resolved = 'before' THEN '(now() - interval ' || quote_literal('2 hours') || ')'
                ELSE quote_literal(p_resolved) END;
  v_open := CASE p_opened WHEN 'auto' THEN 'now()'
                          WHEN 'null' THEN 'NULL'
                          WHEN 'past' THEN '(now() - interval ' || quote_literal('7 days') || ')'
                          WHEN 'future' THEN '(now() + interval ' || quote_literal('7 days') || ')'
                          ELSE quote_literal(p_opened) END;
  RETURN 'INSERT INTO private.support_cases (wedding_id, requester_user_id, opened_by_user_id, '
      || 'assigned_operator_user_id, category, severity, status, host_summary, resolution_code, '
      || 'resolved_at, opened_at, open_idempotency_key'
      || CASE WHEN p_ref IS NULL THEN '' ELSE ', case_ref' END
      || ') VALUES (' || pg_temp.s11b_u(p_wedding) || ', ' || pg_temp.s11b_u(p_requester) || ', '
      || pg_temp.s11b_u(p_opened_by) || ', ' || pg_temp.s11b_u(p_assignee) || ', '
      || v_cat || ', ' || v_sev || ', ' || v_status || ', ' || v_sum || ', ' || v_code || ', '
      || v_res || ', ' || v_open || ', ' || pg_temp.s11b_u(p_key)
      || CASE WHEN p_ref IS NULL THEN '' ELSE ', ' || quote_literal(p_ref) END || ')';
END $fn$;

CREATE FUNCTION pg_temp.s11b_t_ev(p_case uuid, p_kind text DEFAULT 'assignment',
                                  p_actor_kind text DEFAULT 'operator', p_actor uuid DEFAULT NULL,
                                  p_from text DEFAULT NULL, p_to text DEFAULT NULL,
                                  p_body text DEFAULT 'auto', p_seq text DEFAULT 'auto',
                                  p_key uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $fn$
-- The thread half of the same instrument. `seq` is left out of the column list unless a cell asks for it,
-- because the minter below refuses a supplied ordinal and a cell that always supplied one could never tell
-- the minter's refusal apart from its own arithmetic.
DECLARE v_body text;
BEGIN
  v_body := CASE p_body
              WHEN 'auto'  THEN (CASE WHEN p_kind IN ('message_host', 'message_operator')
                                        THEN quote_literal('A line written by hand into the thread.')
                                        ELSE 'NULL' END)
              WHEN 'blank' THEN quote_literal('  ')
              WHEN 'long'  THEN 'repeat(' || quote_literal('x') || ', 4001)'
              WHEN 'exact' THEN 'repeat(' || quote_literal('x') || ', 4000)'
              WHEN 'null'  THEN 'NULL'
              ELSE quote_literal(p_body) END;
  RETURN 'INSERT INTO private.support_case_events (case_id, kind, actor_kind, actor_user_id, '
      || 'from_status, to_status, body, idempotency_key'
      || CASE WHEN p_seq = 'auto' THEN '' ELSE ', seq' END
      || ') VALUES (' || pg_temp.s11b_u(p_case) || ', ' || pg_temp.s11b_t(p_kind) || ', '
      || pg_temp.s11b_t(p_actor_kind) || ', ' || pg_temp.s11b_u(p_actor) || ', '
      || pg_temp.s11b_t(p_from) || ', ' || pg_temp.s11b_t(p_to) || ', ' || v_body || ', '
      || pg_temp.s11b_u(p_key)
      || CASE WHEN p_seq = 'auto' THEN ''
              ELSE ', ' || CASE WHEN p_seq = 'null' THEN 'NULL' ELSE p_seq END END
      || ')';
END $fn$;

CREATE FUNCTION pg_temp.s11b_t_audit(p_action text DEFAULT 'stage11.support.hand_plant',
                                     p_actor_kind text DEFAULT 'operator', p_actor uuid DEFAULT NULL,
                                     p_subject_type text DEFAULT 'support_case',
                                     p_subject_key uuid DEFAULT NULL, p_wedding uuid DEFAULT NULL,
                                     p_reason text DEFAULT 'auto', p_payload text DEFAULT 'auto',
                                     p_key uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $fn$
-- Slice 1 moved one rule on this table out of a CHECK and into a BEFORE INSERT guard, and left the other
-- five as CHECKs. A plant here therefore measures both kinds at once, which is the point: the guard and
-- the constraint have to answer with the same SQLSTATE a caller can be routed on.
BEGIN
  RETURN 'INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, '
      || 'actor_kind, actor_user_id, reason, payload, idempotency_key) VALUES ('
      || pg_temp.s11b_u(p_wedding) || ', ' || pg_temp.s11b_t(p_subject_type) || ', '
      || pg_temp.s11b_u(p_subject_key) || ', ' || pg_temp.s11b_t(p_action) || ', '
      || pg_temp.s11b_t(p_actor_kind) || ', ' || pg_temp.s11b_u(p_actor) || ', '
      || CASE p_reason WHEN 'auto'  THEN quote_literal('A hand plant against the audit table''s own rules.')
                       WHEN 'blank' THEN quote_literal('  ')
                       WHEN 'long'  THEN 'repeat(' || quote_literal('r') || ', 501)'
                       WHEN 'null'  THEN 'NULL'
                       ELSE quote_literal(p_reason) END || ', '
      || CASE p_payload WHEN 'auto'  THEN quote_literal('{}') || '::jsonb'
                        WHEN 'array' THEN quote_literal('[]') || '::jsonb'
                        WHEN 'null'  THEN 'NULL'
                        ELSE quote_literal(p_payload) || '::jsonb' END || ', '
      || pg_temp.s11b_u(p_key) || ')';
END $fn$;

-- A write whose *effect* is the measurement, read from inside the same statement and then discarded. This
-- is how the two destructive findings below are taken without costing the chain a row: the deletion
-- happens, the reads see what it did, and the savepoint unwinds it, so group Z still counts the tickets
-- group A left behind. A `p_do` that is refused answers with the same `SQLSTATE | message` shape as
-- `s11b_probe`, so one assertion helper serves both instruments.
CREATE FUNCTION pg_temp.s11b_rollback_read(p_do text, p_reads text[]) RETURNS text[]
LANGUAGE plpgsql AS $fn$
DECLARE v_out text[] := '{}'::text[]; v_one text; v_sql text;
BEGIN
  EXECUTE p_do;
  FOREACH v_sql IN ARRAY p_reads LOOP
    EXECUTE v_sql INTO v_one;
    v_out := v_out || coalesce(v_one, '(null)');
  END LOOP;
  RAISE EXCEPTION 's11b_rollback_read' USING ERRCODE = 'P0099';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = 'P0099' THEN
    RETURN v_out;
  END IF;
  RETURN ARRAY[SQLSTATE || ' | ' || SQLERRM];
END $fn$;

-- Three rows on one existing thread, so the seq question is asked about a thread that already has a
-- history rather than an empty one: a minter that is right only on the first row is a minter that is wrong.
CREATE FUNCTION pg_temp.s11b_t_seqthread(p_tag text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_i int;
BEGIN
  FOR v_i IN 1..3 LOOP
    PERFORM pg_temp.s11b_plant_ev(p_tag, 'assignment', 'system', NULL, NULL);
  END LOOP;
  RETURN (SELECT coalesce(string_agg(e.seq::text, ',' ORDER BY e.seq), '(none)')
            FROM private.support_case_events e
           WHERE e.case_id = pg_temp.s11b_id(p_tag));
END $fn$;

-- The same thread read twice in one string: how many rows, and which ordinals. A gap and a missing row
-- are different failures and a cell that cannot tell them apart cannot report one.
CREATE FUNCTION pg_temp.s11b_t_threadshape(p_tag text) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT count(*)::text || '/' || coalesce(string_agg(e.seq::text, ',' ORDER BY e.seq), '-')
    FROM private.support_case_events e
   WHERE e.case_id = pg_temp.s11b_id(p_tag) $fn$;

-- The delete question, both sides, in one rolled-back unit: a ticket that has a history refuses to be
-- removed, and a ticket that has none can be, by the one role that gets this far. The second half is a
-- limit of this schema rather than a finding in its favour, and group Z states it as a limit.
CREATE FUNCTION pg_temp.s11b_t_bare_delete(p_requester uuid) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO private.support_cases (requester_user_id, opened_by_user_id, category, severity,
                                     status, host_summary)
    VALUES (p_requester, p_requester, 'other', 'low', 'open',
            'A bare ticket: minted by hand, deleted by hand.')
  RETURNING id INTO v_id;
  DELETE FROM private.support_cases c WHERE c.id = v_id;
  IF FOUND THEN
    RETURN 'ACCEPTED';
  END IF;
  RETURN 'the row was not deleted';
END $fn$;

-- Keys of this group's own, because the durable ticket T-RI0 opens belongs to `host_d` and must not share
-- a key space with any ticket an earlier group filed.
CREATE TEMP TABLE s11b_tkey ON COMMIT DROP AS
SELECT gen_random_uuid() AS k_vanish, gen_random_uuid() AS k_vreply,
       gen_random_uuid() AS k_dupe;

-- Two content digests that leave one attribution column out. `s11b_adigest` and `s11b_gstate` include the
-- links, so after an account deletion they answer "something changed" even when the only change is the
-- deletion. These answer "what the row says, without who it names", which is the whole claim a referential
-- nulling has to make: one column wide, and no other byte of any row moved by it. `updated_at` stays in the
-- grant digest because `touch_updated_at` writes `now()`, the transaction timestamp, which every row in this
-- single-transaction battery already carries.
CREATE FUNCTION pg_temp.s11b_adigest_attrs() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || coalesce(wedding_id::text,'') || '|' || subject_type || '|'
           || coalesce(subject_key::text,'') || '|' || action || '|' || actor_role || '|'
           || payload::text || '|' || created_at::text || '|' || actor_kind || '|'
           || coalesce(reason,'') || '|' || coalesce(idempotency_key,'') || '|'
           || coalesce(before_state::text,'') || '|' || coalesce(after_state::text,''), '~' ORDER BY id), ''))
    FROM private.audit_events $fn$;

CREATE FUNCTION pg_temp.s11b_gdigest_attrs() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || user_id::text || '|' || scope || '|' || status || '|' || reason || '|'
           || granted_at::text || '|' || coalesce(expires_at::text,'') || '|'
           || coalesce(revoked_at::text,'') || '|' || created_at::text || '|' || updated_at::text,
             '~' ORDER BY id), ''))
    FROM private.operator_grants $fn$;

-- What T-RI2's deletion cost, kept for group Z. The erasure's own numbers live in a DO block's locals and
-- are gone when it ends; group Z needs the one of them that a later write could forge — the count of
-- human-kind trail rows that name nobody — so the block records it here and Z compares the table against it.
CREATE TEMP TABLE s11b_ri (ord integer PRIMARY KEY, spent_human_trail integer,
                           authorless_human integer) ON COMMIT DROP;

DO $t$
DECLARE
  c s11b_cast%ROWTYPE;
  k s11b_tkey%ROWTYPE;
  t text;
  v jsonb;
  arr text[];
  v_g1 int; v_a1 int; v_an int;
  n0c bigint; n0e bigint; n0a bigint; n0g bigint;
  b0c text; b0e text; b0g text; b0a text;
BEGIN
  SELECT * INTO c FROM s11b_cast;
  SELECT * INTO k FROM s11b_tkey;
  b0c := pg_temp.s11b_cstate(); b0e := pg_temp.s11b_estate();
  b0g := pg_temp.s11b_gstate(); b0a := pg_temp.s11b_adigest();
  n0c := pg_temp.s11b_ccount(); n0e := pg_temp.s11b_ecount();
  n0g := (SELECT count(*) FROM private.operator_grants);
  n0a := pg_temp.s11b_acount();

  -- The precondition of every cell below, taken first so a later reader cannot mistake the instrument for
  -- the finding.
  t := pg_temp.s11b_probe('authenticated', c.host_a, pg_temp.s11b_t_case(p_requester := c.host_a));
  PERFORM pg_temp.s11b_err_is('T01 a signed-in host cannot write a ticket with a statement, and the refusal '
    || 'comes one layer further out than the table: `private` grants USAGE only to the server identity, so '
    || 'the caller cannot even name the schema the ticket lives in. That is why the CHECKs below are only '
    || 'reachable through the trusted channel; T02 measures the second layer, for the role that does hold '
    || 'the schema', t, '42501', '%permission denied for schema private%');
  t := pg_temp.s11b_probe('service_role', NULL, pg_temp.s11b_t_case(p_requester := c.host_a));
  PERFORM pg_temp.s11b_err_is('T02 nor can the server key, and that is the difference between this slice '
    || 'and the blanket service_role DML the kickoff forbids: the role that used to be able to write '
    || 'anything in the schema is refused by these two tables', t, '42501',
    '%permission denied for table support_cases%');
  t := pg_temp.s11b_probe('anon', NULL, pg_temp.s11b_t_case());
  PERFORM pg_temp.s11b_err_is('T03 and the anonymous role hears the same schema refusal, so no '
    || 'unauthenticated request can even reach a rule about what a ticket may contain — and the two roles '
    || 'that would read a table grant hear the same sentence, which is the shape of a boundary that has '
    || 'one door', t, '42501', '%permission denied for schema private%');

  -- ---- the case table's own rules, reached as the owner --------------------------------------------
  -- Four vocabularies, then the shape of a resting state, then the two instants. Each plant differs from
  -- the legal row in exactly one column, and the legal row is the default of the builder above, so a
  -- refusal that names the constraint is the only answer these cells can produce.
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_cat := 'invitation'));
  PERFORM pg_temp.s11b_err_is('T04 a category the seven do not include is refused by the table, not by a '
    || 'body that could be edited out of existence later', t, '23514',
    '%support_cases_category_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_sev := 'urgent'));
  PERFORM pg_temp.s11b_err_is('T05 a fifth severity word — the one a host reaches for when they want a '
    || 'faster answer — is refused here too, which is the column''s promise that no word in it buys time',
    t, '23514', '%support_cases_severity_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_status := 'pending'));
  PERFORM pg_temp.s11b_err_is('T06 and a status that is not in the machine cannot be planted, so the six '
    || 'states the edge table walks are the only six a row can ever hold', t, '23514',
    '%support_cases_status_check%');
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_case(p_status := 'resolved', p_code := 'refunded'));
  PERFORM pg_temp.s11b_err_is('T07 `refunded` is not a resolution code, and the plant that tries to write '
    || 'it is the strongest form of the promise §5 makes about money: a ticket may *say* a refund was '
    || 'discussed, and may not become a record that one happened', t, '23514',
    '%support_cases_resolution_code_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_summary := 'blank'));
  PERFORM pg_temp.s11b_err_is('T08 a summary of spaces is not a summary — `btrim` runs inside the CHECK, so '
    || 'the queue cannot be filled with a ticket that says nothing', t, '23514',
    '%support_cases_host_summary_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_summary := 'long'));
  PERFORM pg_temp.s11b_err_is('T09 2001 characters is refused', t, '23514',
    '%support_cases_host_summary_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_summary := 'exact'));
  PERFORM pg_temp.s11b_accept('T10 and 2000 is not, which is what makes T09 a length rule rather than a '
    || 'rule about this particular string', t);
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_cat := 'null'));
  PERFORM pg_temp.s11b_err_is('T11 a missing category is refused: the queue filter is the only thing that '
    || 'makes these tickets routable, so it has no empty case. The sentence names the column and not the '
    || 'constraint — Postgres'' NOT NULL message carries no constraint name — which is why this cell matches '
    || 'the relation and the column rather than an identifier', t, '23502',
    '%null value in column "category" of relation "support_cases"%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_status := 'null'));
  PERFORM pg_temp.s11b_err_is('T12 nor a missing status, with the same sentence naming the column. These '
    || 'are the two NOT NULLs the queue depends on — its filter reads category and its order reads the '
    || 'lifecycle — so the pair is the one that decides whether an unroutable row can exist at all', t,
    '23502', '%null value in column "status" of relation "support_cases"%');

  -- The resting pair, in both directions, plus the instant it names.
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_status := 'resolved',
                                                              p_code := 'none'));
  PERFORM pg_temp.s11b_err_is('T13 a resolved ticket with no code is refused by the pair CHECK rather than '
    || 'by a body that remembers to ask', t, '23514', '%support_cases_resting_pair_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_status := 'closed',
                                                              p_resolved := 'none'));
  PERFORM pg_temp.s11b_err_is('T14 and a closed ticket whose resolution instant is missing: the CHECK is '
    || 'an equality, so it refuses the half-empty row from either side', t, '23514',
    '%support_cases_resting_pair_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_status := 'open',
                                                              p_resolved := 'now',
                                                              p_code := 'no_action_needed'));
  PERFORM pg_temp.s11b_err_is('T15 the other direction is the one a naive CHECK would miss: a *live* '
    || 'ticket that already carries both halves of the resting evidence is refused, so a resolution cannot '
    || 'sit on a ticket that is still being worked', t, '23514', '%support_cases_resting_pair_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_status := 'closed'));
  PERFORM pg_temp.s11b_accept('T16 a hand-planted closed ticket with both halves is accepted — the pair '
    || 'CHECK is about the pairing, not about which writer set the values, and a repair that has to write '
    || 'a resting row by hand can do it honestly', t);
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_status := 'resolved',
                                                              p_opened := 'future'));
  PERFORM pg_temp.s11b_err_is('T17 resolved before it was opened is refused by the ordering CHECK. The '
    || 'plant opens the ticket a week in the future rather than resolving it in the past because the '
    || 'columns are only reachable by hand here — the doors set both from `now()` — and the rule is the '
    || 'same either way: a ticket cannot rest at a moment before it began', t, '23514',
    '%support_cases_resting_after_open_check%');

  -- The two minted columns, measured as unreachable rather than as unenforced.
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_ref := 'SV-AAAAAAAA'));
  PERFORM pg_temp.s11b_err_is('T18 a ref supplied by hand never reaches the CHECK that bounds its shape: '
    || 'the BEFORE INSERT minter refuses it first, with 42501 rather than 23514, because the failure is '
    || '''somebody chose the string a later act will be authorised by'' and not ''somebody mistyped it''',
    t, '42501', '%minted by the database, never supplied%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_key := k.k_dupe,
    p_requester := c.host_x));
  PERFORM pg_temp.s11b_accept('T19 and a key planted by hand is accepted on its own: the replay rule is '
    || 'the partial unique index, which R18–R21 measured, so this cell exists to show the plant builder '
    || 'reaches that column rather than hiding it', t);

  -- The keys that refuse to point at nothing.
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_wedding := c.ghost));
  PERFORM pg_temp.s11b_err_is('T20 a ticket about a wedding that does not exist is refused by the key. '
    || 'The door could not have made this row in the first place, and the refusal is the difference '
    || 'between a nullable column and an optional one', t, '23503', '%support_cases_wedding_id_fkey%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_requester := c.ghost));
  PERFORM pg_temp.s11b_err_is('T21 nor a ticket owned by an account that does not exist', t, '23503',
    '%support_cases_requester_user_id_fkey%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_assignee := c.ghost));
  PERFORM pg_temp.s11b_err_is('T22 and the same rule on the holder column, which no door can write without '
    || 'already being the holder', t, '23503', '%support_cases_assigned_operator_user_id_fkey%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_case(p_wedding := c.wa,
    p_requester := c.host_c, p_opened_by := c.host_c));
  PERFORM pg_temp.s11b_accept('T23 but a ticket about *your* wedding and filed by *somebody else* is '
    || 'accepted by the schema — and that is the honest answer, not a gap. A foreign key checks existence; '
    || 'ownership of the named wedding is decided by `open_support_case`, measured in P04 and O07, because '
    || 'a key cannot know that a wedding belongs to a caller. Stated here so a later reader does not '
    || 'mistake the trigger for the boundary', t);

  -- ---- the thread's own rules ---------------------------------------------------------------------
  -- Every one of these rows is written by `internal_api` bodies for a caller who cannot name a kind, a '
  -- status or a seq, so the table is the only place the rules can live. The case they point at is `main`,
  -- the ticket group P opened, because a minter tested only on an empty thread has not been tested.
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_ev(c.ghost, p_actor := c.op1));
  PERFORM pg_temp.s11b_err_is('T24 a row on a thread that does not exist is refused: this is the key that '
    || 'makes deleting a ticket an act that has to say what it does to the history first', t, '23503',
    '%support_case_events_case_id_fkey%');
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_ev(pg_temp.s11b_id('main'), p_actor_kind := 'operator', p_actor := NULL));
  PERFORM pg_temp.s11b_err_is('T25 an `operator` row that names no account is refused at the instant it is '
    || 'written — the rule slice 1 moved out of a table CHECK and into a BEFORE INSERT guard, so that '
    || 'deleting the named account stays possible at all', t, '23514',
    '%must name the account that wrote it%');
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_ev(pg_temp.s11b_id('main'), p_actor_kind := 'host', p_actor := NULL));
  PERFORM pg_temp.s11b_err_is('T26 the host arm is refused by the same guard with the same state: an '
    || 'unattributable line in somebody''s thread is a forgery whichever side of the conversation it '
    || 'claims to be on', t, '23514', '%must name the account that wrote it%');
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_ev(pg_temp.s11b_id('main'), p_actor_kind := 'system', p_actor := NULL));
  PERFORM pg_temp.s11b_accept('T27 and a `system` row with no account is accepted, which is what makes '
    || 'the guard a rule about humans rather than a rule about columns', t);
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_ev(pg_temp.s11b_id('main'), p_actor_kind := 'robot', p_actor := c.op1));
  PERFORM pg_temp.s11b_err_is('T28 a fourth actor kind cannot be planted even with a real account behind '
    || 'it: the three arms the read surfaces project are the three that exist', t, '23514',
    '%support_case_events_actor_kind_check%');
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_ev(pg_temp.s11b_id('main'), p_kind := 'note', p_actor := c.op1));
  PERFORM pg_temp.s11b_err_is('T29 `note` is not an arm of this table. A note an operator writes is a '
    || '`message_operator` row, and a private arm invented at the console would be an arm no host read '
    || 'surface can ever be checked against', t, '23514', '%support_case_events_kind_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_ev(pg_temp.s11b_id('main'),
    p_kind := 'status', p_actor_kind := 'system', p_actor := NULL));
  PERFORM pg_temp.s11b_err_is('T30 a `status` row that names no destination is refused: the arm exists to '
    || 'record a move, and a status row that moved nothing is a hole in the history rather than an entry '
    || 'in it', t, '23514', '%support_case_events_status_kind_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_ev(pg_temp.s11b_id('main'),
    p_kind := 'assignment', p_actor := c.op1, p_to := 'triaged'));
  PERFORM pg_temp.s11b_err_is('T31 and the reverse is refused too: a row of a non-status arm that claims '
    || 'a destination cannot be told apart, by anything downstream, from a move that never happened',
    t, '23514', '%support_case_events_status_kind_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_ev(pg_temp.s11b_id('main'),
    p_kind := 'status', p_actor_kind := 'system', p_actor := NULL, p_from := 'open', p_to := 'open'));
  PERFORM pg_temp.s11b_err_is('T32 a move from a state to itself is refused, so the thread cannot accrue '
    || 'rows that look like progress', t, '23514', '%support_case_events_status_moves_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_ev(pg_temp.s11b_id('main'),
    p_kind := 'message_host', p_actor := c.host_a, p_body := 'null'));
  PERFORM pg_temp.s11b_err_is('T33 an empty message row is refused. Two of the five arms carry text and '
    || 'the other three must not — the filter a host read applies is the shape of the row', t, '23514',
    '%support_case_events_body_pairs_message_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_ev(pg_temp.s11b_id('main'),
    p_kind := 'assignment', p_actor := c.op1, p_body := 'a note smuggled past the filter'));
  PERFORM pg_temp.s11b_err_is('T34 and text on an arm that is not a message is refused by the same CHECK, '
    || 'which is the direction that matters for privacy: a body hidden inside a machine row is a body no '
    || 'host surface will ever show', t, '23514', '%support_case_events_body_pairs_message_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_ev(pg_temp.s11b_id('main'),
    p_kind := 'message_host', p_actor := c.host_a, p_body := 'blank'));
  PERFORM pg_temp.s11b_err_is('T35 a message of spaces is refused by `btrim` inside the CHECK', t, '23514',
    '%support_case_events_body_bounded_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_ev(pg_temp.s11b_id('main'),
    p_kind := 'message_host', p_actor := c.host_a, p_body := 'long'));
  PERFORM pg_temp.s11b_err_is('T36 4001 characters is refused', t, '23514',
    '%support_case_events_body_bounded_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_ev(pg_temp.s11b_id('main'),
    p_kind := 'message_host', p_actor := c.host_a, p_body := 'exact'));
  PERFORM pg_temp.s11b_accept('T37 and 4000 is not, so T36 is a length rule', t);
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_ev(pg_temp.s11b_id('main'),
    p_actor := c.op1, p_seq := '9999'));
  PERFORM pg_temp.s11b_err_is('T38 a hand-supplied ordinal is refused by the minter before any constraint '
    || 'runs, with the ref column''s sentence and the ref column''s state: the ordinal a client reads back '
    || 'is the database''s, never the caller''s', t, '42501', '%seq is minted by the database%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_ev(pg_temp.s11b_id('main'),
    p_actor := c.op1, p_seq := '0'));
  PERFORM pg_temp.s11b_err_is('T39 and so is zero — from the minter, not from `CHECK (seq > 0)`. That '
    || 'CHECK is unreachable by any writer this schema allows, and the cell names it instead of leaving a '
    || 'reader to assume a rule that never fires is untested: the guard is the one doing the work',
    t, '42501', '%seq is minted by the database%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_ev(pg_temp.s11b_id('main'),
    p_kind := 'assignment', p_actor := c.op1, p_from := 'pending'));
  PERFORM pg_temp.s11b_err_is('T40 a `from_status` outside the six is refused even on an arm that is not a '
    || 'move, because a history full of states the machine does not have is not a history', t, '23514',
    '%support_case_events_from_status_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_ev(pg_temp.s11b_id('main'),
    p_kind := 'status', p_actor_kind := 'system', p_actor := NULL, p_to := 'pending'));
  PERFORM pg_temp.s11b_err_is('T41 and the destination half is refused by its own CHECK', t, '23514',
    '%support_case_events_to_status_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_ev(pg_temp.s11b_id('main'),
    p_kind := 'operation_link', p_actor := c.op1));
  PERFORM pg_temp.s11b_accept('T42 the `operation_link` arm is structurally ready and still has no door: '
    || 'the fifth kind is in the vocabulary now so slice 4 can write it, and until then the only way to '
    || 'make one is a hand plant like this — which is the honest state of an authorisation carrier that is '
    || 'not yet in use', t);

  -- ---- the ordinal, the deletes, and the nulling a caller is not allowed to do -------------------
  -- The seq question group L left open on purpose: three rows added to a thread that already carries its
  -- own history, read from inside the statement that wrote them, and then unwound.
  arr := pg_temp.s11b_rollback_read(
    'SELECT pg_temp.s11b_t_seqthread(' || quote_literal('main') || ')',
    ARRAY['SELECT pg_temp.s11b_t_threadshape(' || quote_literal('main') || ')']);
  PERFORM pg_temp.s11b_eq('T43 three rows planted onto a thread that already had six come out as 7, 8, 9: '
    || 'the minter reads the case''s own maximum, so a thread cannot gain a gap or renumber a row that was '
    || 'already read by somebody', arr[1], '9/1,2,3,4,5,6,7,8,9');
  PERFORM pg_temp.s11b_eq('T44 and none of it landed: the thread this group started with is the thread it '
    || 'still has, byte for byte — the rolled-back plant is an instrument, not a write',
    pg_temp.s11b_estate(), b0e);

  t := pg_temp.s11b_probe('postgres', NULL, 'DELETE FROM private.support_cases c WHERE c.id = '
    || pg_temp.s11b_u(pg_temp.s11b_id('main')));
  PERFORM pg_temp.s11b_err_is('T45 the owner cannot delete a ticket that has a history: the thread''s key '
    || 'is NO ACTION, so the append-only posture is enforced by the schema rather than promised by a '
    || 'trigger a later migration could drop', t, '23503', '%support_case_events_case_id_fkey%');
  t := pg_temp.s11b_probe('postgres', NULL,
    'SELECT pg_temp.s11b_t_bare_delete(' || pg_temp.s11b_u(c.host_x) || ')');
  PERFORM pg_temp.s11b_accept('T46 but a ticket with no history at all is deletable by the trusted channel, '
    || 'and this is a limit of the schema rather than a finding in its favour: `reject_client_delete` fires '
    || 'inside a cascade and for the owner role it steps aside, because `current_user` there is the table''s '
    || 'own owner. So an evidence row can be removed by a human at the console, and the only thing standing '
    || 'between that and a vanished ticket is the thread underneath it', t);
  arr := pg_temp.s11b_rollback_read(
    'SELECT pg_temp.s11b_t_bare_delete(' || pg_temp.s11b_u(c.host_x) || ')',
    ARRAY['SELECT count(*)::text FROM private.support_cases c WHERE c.host_summary = '
          || quote_literal('A bare ticket: minted by hand, deleted by hand.')]);
  PERFORM pg_temp.s11b_eq('T47 and the deletion above is a deletion, not a refusal dressed as one: read '
    || 'from inside the same statement, the planted row is gone — which is what makes T46 a measurement of '
    || 'the guard rather than of the probe', arr[1], '0');

  -- The both-ways pair slice 1 promised: the same column, the same NULL, one issued by a statement and one
  -- issued by the database's own trigger. The first half is here; the accepting half is T-RI1 and T-RI2.
  t := pg_temp.s11b_probe('postgres', NULL,
    'UPDATE private.support_case_events e SET actor_user_id = NULL WHERE e.case_id = '
    || pg_temp.s11b_u(pg_temp.s11b_id('main')));
  PERFORM pg_temp.s11b_err_is('T48 an UPDATE that clears the human behind a thread row is refused by every '
    || 'role, the owner included: the guard''s depth test is what separates ''the account was deleted'' from '
    || '''somebody erased who wrote this''', t, '42501', '%append-only: a correction is a new row%');
  t := pg_temp.s11b_probe('postgres', NULL,
    'UPDATE private.support_cases c SET requester_user_id = NULL WHERE c.id = '
    || pg_temp.s11b_u(pg_temp.s11b_id('main')));
  PERFORM pg_temp.s11b_err_is('T49 the same rule on the ticket''s owner column, at trigger depth 1: a '
    || 'statement of your own cannot orphan a ticket from the account it belongs to, and the only way that '
    || 'column goes NULL is the account ceasing to exist', t, '42501', '%cannot change hands%');
  t := pg_temp.s11b_probe('postgres', NULL,
    'UPDATE private.support_cases c SET opened_by_user_id = NULL WHERE c.id = '
    || pg_temp.s11b_u(pg_temp.s11b_id('main')));
  PERFORM pg_temp.s11b_err_is('T50 and on the provenance column, with the sentence that says why the two '
    || 'columns share one guard: who opened this and when are the first two facts in its history', t,
    '42501', '%first two facts in its history%');
  t := pg_temp.s11b_probe('postgres', NULL,
    'UPDATE private.audit_events a SET actor_user_id = NULL WHERE a.actor_user_id IS NOT NULL');
  PERFORM pg_temp.s11b_err_is('T51 the audit table takes the same refusal — and this is the cell that '
    || 'slice 1''s A06c left half-finished: the guard is a pair of tests, one for the column moving at all '
    || 'and one for the depth it moved at, and both are measured before T-RI2 accepts the second one', t,
    '42501', '%append-only: a correction is a new row%');
  PERFORM pg_temp.s11b_eq('T52 nothing in this stretch landed: the case table, the thread, the '
    || 'credentials and the trail all carry the digests this group opened with, so every refusal above is '
    || 'a refusal that wrote no row and no half-row',
    ARRAY[pg_temp.s11b_cstate(), pg_temp.s11b_estate(), pg_temp.s11b_gstate(), pg_temp.s11b_adigest()],
    ARRAY[b0c, b0e, b0g, b0a]);

  -- ---- the trail's own rules ----------------------------------------------------------------------
  -- Slice 1 moved one of these six out of a CHECK and into a BEFORE INSERT guard, and left the other five
  -- where they were. A plant is the only instrument that measures both kinds in one file, and the SQLSTATE
  -- has to come out the same either way — a reviewer routing on 23514 must not care which of the two the
  -- rule lives in.
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_audit(p_actor := NULL));
  PERFORM pg_temp.s11b_err_is('T53 an `operator` trail row that names no account is refused with the state '
    || 'the table CHECK used to give, which is what makes the move out of a CHECK invisible to a caller',
    t, '23514', '%must name the account that acted%');
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_audit(p_actor_kind := 'host', p_actor := NULL));
  PERFORM pg_temp.s11b_err_is('T54 the host arm, refused by the same guard', t, '23514',
    '%must name the account that acted%');
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_audit(p_actor_kind := 'maintenance', p_actor := NULL));
  PERFORM pg_temp.s11b_err_is('T55 and the maintenance arm — the fourth word in this vocabulary exists for '
    || 'the trusted CLI this stage ships, so the anti-forgery rule has to cover it before that CLI does',
    t, '23514', '%must name the account that acted%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_audit(p_actor_kind := 'system',
    p_actor := NULL, p_reason := 'null'));
  PERFORM pg_temp.s11b_accept('T56 a `system` row names no account and states no reason, and is accepted: '
    || 'the guard is about humans, and the reason CHECK is written as a disjunction for the same reason', t);
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_audit(p_actor := c.op1, p_reason := 'null'));
  PERFORM pg_temp.s11b_err_is('T57 a human trail row with an author and no stated reason is refused by the '
    || 'CHECK that stayed: an act on somebody''s invitation has to say why, whoever did it', t, '23514',
    '%audit_events_human_action_has_reason_check%');
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_audit(p_actor_kind := 'robot', p_actor := c.op1));
  PERFORM pg_temp.s11b_err_is('T58 a fifth actor kind cannot be planted, so no later migration can invent '
    || 'an arm that every existing read surface would silently ignore', t, '23514',
    '%audit_events_actor_kind_vocab_check%');
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_audit(p_actor := c.op1, p_payload := 'array'));
  PERFORM pg_temp.s11b_err_is('T59 a payload that is not an object is refused. The rule that keeps a '
    || 'customer''s words out of this table is a shape rule first: an array is how a body full of '
    || 'somewhere else''s data arrives', t, '23514', '%audit_events_payload_check%');
  t := pg_temp.s11b_probe('postgres', NULL, pg_temp.s11b_t_audit(p_actor := c.op1, p_action := '  '));
  PERFORM pg_temp.s11b_err_is('T60 a blank action is refused, so no row can enter the trail without '
    || 'saying what happened', t, '23514', '%audit_events_action_check%');
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_audit(p_actor := c.op1, p_reason := 'long'));
  PERFORM pg_temp.s11b_err_is('T61 a reason of 501 characters is refused — the bound is what stops the '
    || 'note column from becoming the place a whole ticket is copied into', t, '23514',
    '%audit_events_reason_is_bounded_check%');
  t := pg_temp.s11b_probe('postgres', NULL,
    pg_temp.s11b_t_audit(p_actor := c.op1, p_wedding := c.ghost));
  PERFORM pg_temp.s11b_err_is('T62 and a trail row about a wedding that does not exist is refused by its '
    || 'key, even though that key is SET NULL: nullable is not the same as unenforced', t, '23503',
    '%audit_events_wedding_id_fkey%');

  arr := pg_temp.s11b_rollback_read(pg_temp.s11b_t_audit(p_actor := c.op1),
    ARRAY['SELECT a.actor_role FROM private.audit_events a WHERE a.action = '
          || quote_literal('stage11.support.hand_plant') || ' ORDER BY a.id DESC LIMIT 1',
          'SELECT a.actor_role FROM private.audit_events a WHERE a.subject_type = '
          || quote_literal('support_case') || ' ORDER BY a.id DESC LIMIT 1']);
  PERFORM pg_temp.s11b_eq('T63 the role a hand plant records is `postgres`, because a plant is made as the '
    || 'owner', arr[1], 'postgres');
  PERFORM pg_temp.s11b_eq('T64 and the role a door records is the same word — every body behind these ten '
    || 'doors is SECURITY DEFINER, so `actor_role` cannot tell a console from a request. That is why the '
    || 'columns an operator review reads are `actor_kind` and `actor_user_id`, and why the census below '
    || 'counts those rather than this one', arr[2], arr[1]);

  -- ---- what an account''s deletion actually costs -------------------------------------------------
  v_g1 := (SELECT count(*)::int FROM private.operator_grants g WHERE g.user_id = c.op1);
  v_a1 := (SELECT count(*)::int FROM private.audit_events a WHERE a.actor_user_id = c.op1);
  v_an := (SELECT count(*)::int FROM private.audit_events a WHERE a.actor_user_id IS NULL);
  PERFORM pg_temp.s11b_ok('T65 the setup this measurement needs is true before it is measured: op1 holds at '
    || 'least one live credential and her acts are named in the trail', v_g1 >= 1 AND v_a1 >= 1);
  arr := pg_temp.s11b_rollback_read(
    'DELETE FROM auth.users WHERE id = ' || quote_literal(c.op1::text) || '::uuid',
    ARRAY['SELECT count(*)::text FROM private.operator_grants g WHERE g.user_id = '
          || quote_literal(c.op1::text) || '::uuid',
          'SELECT count(*)::text FROM private.operator_grants',
          'SELECT count(*)::text FROM private.audit_events a WHERE a.actor_user_id = '
          || quote_literal(c.op1::text) || '::uuid',
          'SELECT count(*)::text FROM private.audit_events a WHERE a.actor_user_id IS NULL',
          'SELECT count(*)::text FROM private.support_case_events e WHERE e.actor_user_id = '
          || quote_literal(c.op1::text) || '::uuid']);
  PERFORM pg_temp.s11b_eq('T66 a deleted operator loses her credential with her: `operator_grants.user_id` '
    || 'is the one link in this slice declared CASCADE, and the grant row is removed rather than nulled. '
    || 'The revocation an account deletion performs is therefore not itself audited — the trail row that '
    || 'minted the credential stays, and the row that says it stopped existing does not',
    arr[1], '0');
  PERFORM pg_temp.s11b_eq('T67 while every other credential on the chain is untouched: the total falls by '
    || 'exactly the number of rows she held — `v_g1`, measured by T65 rather than assumed to be one, because '
    || 'a scope-per-row credential store gives one operator several — and by no more, so the cascade is '
    || 'scoped to the account and not to the table', arr[2], (n0g - v_g1)::text);
  PERFORM pg_temp.s11b_eq('T68 and her acts survive: no trail row that named her is deleted', arr[3], '0');
  PERFORM pg_temp.s11b_eq('T69 they are nulled, and the count of authorless rows grows by exactly the '
    || 'number that named her — the audit table''s own `ON DELETE SET NULL`, carried out as an UPDATE no '
    || 'caller can issue', arr[4], (v_an + v_a1)::text);
  PERFORM pg_temp.s11b_eq('T70 and the thread she wrote loses its author the same way, not its rows',
    arr[5], '0');
  PERFORM pg_temp.s11b_eq('T71 none of that landed: the credentials and the trail still hold the digests '
    || 'this group opened with, so T66 through T70 measured a deletion the chain never saw',
    ARRAY[pg_temp.s11b_gstate(), pg_temp.s11b_adigest()], ARRAY[b0g, b0a]);

  arr := pg_temp.s11b_rollback_read(
    'DELETE FROM auth.users WHERE id = ' || quote_literal(c.host_a::text) || '::uuid',
    ARRAY['SELECT count(*)::text FROM private.support_cases']);
  PERFORM pg_temp.s11b_err_is('T72 and a host who owns a wedding that a ticket names cannot be deleted at '
    || 'all: the cascade that would remove her wedding runs into the case''s NO ACTION key, and the '
    || 'erasure order §12 states for a household — tickets first, by a trusted role — is a rule with teeth '
    || 'rather than a procedure. The second read never runs, which is the answer', arr[1], '23503',
    '%fkey%');
END $t$;

-- ---- the deletion whose row survives with a NULL ------------------------------------------------
-- `80_operator_authority.sql` measured the refusing half of referential nulling (A06c, AI10b: a caller's
-- UPDATE of `actor_user_id` is refused by the append-only guard) and named T-RI1/T-RI2 for the accepting
-- half. Group T measured it too, but inside `s11b_rollback_read`: one statement that read its own insides
-- and then unwound. What these cells add is durability — the *next* statement sees the same chain — and the
-- "nothing else moved" claim that only a digest re-taken on the far side of a committed change can make.
--
-- Two accounts are spent. `host_d` owns nothing and has filed exactly one ticket in this block; `decider`
-- owns nothing, holds no credential, and is the account every durable trail row of this stage names as its
-- actor. A deleted account is two different questions and they are measured on the two different people the
-- schema treats differently: the requester link is SET NULL and the ticket survives, while the grant subject
-- is CASCADE and the credential does not. Deleting `op1` — the account t66–t71 measured — is what group Z
-- must not do, because it would remove a live grant the census counts.
DO $ri$
DECLARE
  c s11b_cast%ROWTYPE;
  k s11b_tkey%ROWTYPE;
  v jsonb;
  t text;
  n0c bigint; n0e bigint; n0a bigint; n0g bigint;
  n0h bigint; v_ad int; v_adh int; v_an int; v_gd int; v_gn int;
  b0a text; b0ac text; b0g text; b0gc text;
BEGIN
  SELECT * INTO c FROM s11b_cast;
  SELECT * INTO k FROM s11b_tkey;
  n0c := pg_temp.s11b_ccount(); n0e := pg_temp.s11b_ecount();
  n0a := pg_temp.s11b_acount(); n0g := (SELECT count(*) FROM private.operator_grants);
  b0a := pg_temp.s11b_adigest(); b0ac := pg_temp.s11b_adigest_attrs();
  b0g := pg_temp.s11b_gstate(); b0gc := pg_temp.s11b_gdigest_attrs();
  n0h := (SELECT count(*) FROM private.audit_events a
           WHERE a.actor_kind <> 'system' AND a.actor_user_id IS NULL);

  -- ---- T-RI0: a ticket that belongs to exactly one account, filed through the door -------------------
  v := pg_temp.s11b_as('authenticated', c.host_d,
    pg_temp.s11b_open_sql(NULL, 'privacy_data_request', 'normal',
      'Please remove the account details you hold about me.', k.k_vanish));
  PERFORM pg_temp.s11b_reg('vanish', v, c.host_d);
  PERFORM pg_temp.s11b_eq('T-RI0 host_d opens the one ticket this block deletes her over, and it names no '
    || 'wedding: the requester column is the only thread tying the row to an account',
    v ->> 'wedding_id', NULL);

  v := pg_temp.s11b_as('authenticated', c.host_d, 'SELECT api.reply_to_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('vanish')) || ', '
    || pg_temp.s11b_t('My account details, not my wedding.') || ', '
    || pg_temp.s11b_u(k.k_vreply) || ')');
  PERFORM pg_temp.s11b_eq('T-RI0b and answers her own thread once', v ->> 'seq', '2');

  PERFORM pg_temp.s11b_array('T-RI0c the thread before the deletion is the shape the doors made: the '
    || 'opening edge and one host message, both marked as host acts',
    pg_temp.s11b_thread('vanish'), ARRAY['1:status:host', '2:message_host:host']);

  SELECT coalesce(cs.requester_user_id::text, '(none)') || '/'
         || coalesce(cs.opened_by_user_id::text, '(none)')
    INTO t FROM private.support_cases cs WHERE cs.id = pg_temp.s11b_id('vanish');
  PERFORM pg_temp.s11b_eq('T-RI0d before the deletion both attribution columns name the same account: '
    || 'the requester and the opener of a host-filed ticket are one person', t,
    c.host_d::text || '/' || c.host_d::text);

  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.get_operator_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('vanish')) || ')');
  PERFORM pg_temp.s11b_eq('T-RI0e and the duty reaches it, naming her as a uuid and never as an email — '
    || 'this is the read that has to still work after the account behind that uuid is gone',
    v ->> 'requester_user_id', c.host_d::text);

  -- ---- T-RI1: the requester is erased and the ticket is kept -----------------------------------------
  t := pg_temp.s11b_try('postgres', NULL, 'DELETE FROM auth.users WHERE id = '
    || quote_literal(c.host_d::text) || '::uuid RETURNING id::text');
  PERFORM pg_temp.s11b_eq('T-RI1 the account that filed the ticket is gone, and this deletion is not '
    || 'unwound: every read below is a statement after the one that erased her', t, c.host_d::text);

  PERFORM pg_temp.s11b_eq('T-RI1b the ticket survives: `requester_user_id` is declared SET NULL, so the '
    || 'work someone did is kept after the person is not', pg_temp.s11b_ccount(), n0c + 1);

  SELECT coalesce(cs.requester_user_id::text, '(none)') || '/'
         || coalesce(cs.opened_by_user_id::text, '(none)')
    INTO t FROM private.support_cases cs WHERE cs.case_ref = pg_temp.s11b_ref('vanish');
  PERFORM pg_temp.s11b_eq('T-RI1c both attribution columns are NULL and the row is still there to read '
    || 'them from: the referential action is an UPDATE no caller issued, which is the only reason the '
    || 'append-only guard let it through', t, '(none)/(none)');

  PERFORM pg_temp.s11b_eq('T-RI1d and `case_ref` is unchanged — a ticket number is not derived from the '
    || 'account, so an operator''s bookmark still resolves',
    (SELECT cs.case_ref FROM private.support_cases cs WHERE cs.id = pg_temp.s11b_id('vanish')),
    pg_temp.s11b_ref('vanish'));

  PERFORM pg_temp.s11b_array('T-RI1e the thread keeps both rows and both ordinals: the deletion removed '
    || 'a parent link, not a history', pg_temp.s11b_thread('vanish'),
    ARRAY['1:status:host', '2:message_host:host']);

  SELECT coalesce(string_agg(e.seq::text || ':' || e.actor_kind || ':'
                   || coalesce(e.actor_user_id::text, '(none)'), ',' ORDER BY e.seq), '-')
    INTO t FROM private.support_case_events e WHERE e.case_id = pg_temp.s11b_id('vanish');
  PERFORM pg_temp.s11b_eq('T-RI1f and both rows still say a host wrote them while naming no account: '
    || '`actor_kind` is the fact that survives erasure and `actor_user_id` is the link that does not',
    t, '1:host:(none),2:host:(none)');

  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.get_operator_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('vanish')) || ')');
  PERFORM pg_temp.s11b_eq('T-RI1g the duty still reaches it, and the answer still carries the ref: '
    || 'erasing a requester must not orphan the work', v ->> 'case_ref', pg_temp.s11b_ref('vanish'));
  PERFORM pg_temp.s11b_ok('T-RI1h and the requester field is present and null rather than missing, so a '
    || 'console renders "no account" instead of inventing one',
    (v ? 'requester_user_id') AND (v -> 'requester_user_id') = 'null'::jsonb);

  v := pg_temp.s11b_as('authenticated', c.op1, 'SELECT api.operator_case_queue(NULL, NULL, 100)');
  PERFORM pg_temp.s11b_eq('T-RI1i and the queue lists it beside the tickets that still name somebody: the '
    || 'queue reads rows, not accounts',
    (SELECT count(*)::int FROM jsonb_array_elements(v -> 'cases') e
      WHERE e ->> 'case_ref' = pg_temp.s11b_ref('vanish')), 1);

  t := pg_temp.s11b_try('authenticated', c.host_a, 'SELECT api.get_my_support_case('
    || pg_temp.s11b_t(pg_temp.s11b_ref('vanish')) || ')::text');
  PERFORM pg_temp.s11b_err_is('T-RI1j and no host inherits it: a ticket whose requester is NULL answers '
    || 'the next signed-in account with the same refusal an invented ref gets — the privacy rule holds '
    || 'after the account it belonged to is gone', t, '42501',
    '%the caller may not read this support case%');

  v := pg_temp.s11b_as('authenticated', c.host_a, 'SELECT api.get_my_support_cases(NULL, NULL)');
  PERFORM pg_temp.s11b_eq('T-RI1k and it is absent from that host''s list rather than listed with a blank '
    || 'requester', (SELECT count(*)::int FROM jsonb_array_elements(v -> 'cases') e
      WHERE e ->> 'case_ref' = pg_temp.s11b_ref('vanish')), 0);

  PERFORM pg_temp.s11b_eq('T-RI1l the erasure of a requester wrote nothing to the authority trail: the '
    || 'host doors wrote none of her acts there, and the deletion of an account is not an act this schema '
    || 'records. The ticket and its thread are the whole record of what happened, which is why they are '
    || 'the two things the deletion may not take', pg_temp.s11b_adigest(), b0a);

  -- ---- T-RI2: the actor every trail row names is erased --------------------------------------------
  v_ad  := (SELECT count(*)::int FROM private.audit_events a WHERE a.actor_user_id = c.decider);
  v_adh := (SELECT count(*)::int FROM private.audit_events a
             WHERE a.actor_user_id = c.decider AND a.actor_kind <> 'system');
  v_an  := (SELECT count(*)::int FROM private.audit_events a WHERE a.actor_user_id IS NULL);
  v_gd  := (SELECT count(*)::int FROM private.operator_grants g WHERE g.granted_by_user_id = c.decider);
  v_gn  := (SELECT count(*)::int FROM private.operator_grants g WHERE g.granted_by_user_id IS NULL);
  PERFORM pg_temp.s11b_ok('T-RI2 the setup this half needs is true before it is measured: the decider is '
    || 'named as the actor in the trail and as the granter in the credential table, every row that names '
    || 'her is a human act, and no human-kind trail row is authorless yet',
    v_ad >= 1 AND v_adh = v_ad AND v_gd >= 1 AND n0h = 0);

  t := pg_temp.s11b_try('postgres', NULL, 'DELETE FROM auth.users WHERE id = '
    || quote_literal(c.decider::text) || '::uuid RETURNING id::text');
  PERFORM pg_temp.s11b_eq('T-RI2b the account every durable trail row of this stage names as its actor is '
    || 'gone too, and again the deletion is not unwound', t, c.decider::text);

  PERFORM pg_temp.s11b_eq('T-RI2c no trail row is deleted: `actor_user_id` is SET NULL, so the record of '
    || 'what was decided outlives the account that decided it', pg_temp.s11b_acount(), n0a);
  PERFORM pg_temp.s11b_eq('T-RI2d and no row names her any more', (SELECT count(*)::int
    FROM private.audit_events a WHERE a.actor_user_id = c.decider), 0);
  PERFORM pg_temp.s11b_eq('T-RI2e the authorless count grew by exactly the rows that named her, which was '
    || 'the whole population of them', (SELECT count(*)::int FROM private.audit_events a
      WHERE a.actor_user_id IS NULL), v_an + v_ad);
  PERFORM pg_temp.s11b_eq('T-RI2f and every human-kind row that now names nobody was made by this '
    || 'deletion rather than by a writer: the INSERT guard left the table with zero of them, and the only '
    || 'way to produce one is to erase an account that had already acted',
    (SELECT count(*) FROM private.audit_events a
      WHERE a.actor_kind <> 'system' AND a.actor_user_id IS NULL), n0h + v_adh);
  PERFORM pg_temp.s11b_eq('T-RI2g and nothing else in any trail row moved: with the attribution column '
    || 'left out, the digest of every other byte of every row is the one this block opened with, so the '
    || 'nulling is one column wide', pg_temp.s11b_adigest_attrs(), b0ac);

  PERFORM pg_temp.s11b_eq('T-RI2h the credentials the decider minted survive her: `granted_by_user_id` is '
    || 'declared SET NULL, not CASCADE, because the granter''s erasure must not revoke a duty somebody '
    || 'else is carrying', (SELECT count(*) FROM private.operator_grants), n0g);
  PERFORM pg_temp.s11b_eq('T-RI2i and none of them still names her as the granter', (SELECT count(*)::int
    FROM private.operator_grants g WHERE g.granted_by_user_id = c.decider), 0);
  PERFORM pg_temp.s11b_eq('T-RI2j while the count with no granter grew by exactly the rows she had signed',
    (SELECT count(*)::int FROM private.operator_grants g WHERE g.granted_by_user_id IS NULL),
    v_gn + v_gd);
  PERFORM pg_temp.s11b_eq('T-RI2k and with that column left out the credential rows are the ones they '
    || 'were: the duty, its reason, its scope, its expiry, its revoke state and its timestamps are '
    || 'untouched', pg_temp.s11b_gdigest_attrs(), b0gc);
  PERFORM pg_temp.s11b_ok('T-RI2l the grant digest that includes the granter did move, so T-RI2k compares '
    || 'a table that changed once in a known column rather than one that never changed at all',
    pg_temp.s11b_gstate() <> b0g);

  PERFORM pg_temp.s11b_eq('T-RI2m the two deletions are the only rows this block removed from the chain '
    || 'it reads: the case table holds the one ticket T-RI0 opened', pg_temp.s11b_ccount(), n0c + 1);
  PERFORM pg_temp.s11b_eq('T-RI2n and the thread holds the two rows it added, with no row deleted from '
    || 'any other ticket', pg_temp.s11b_ecount(), n0e + 2);
  PERFORM pg_temp.s11b_ok('T-RI2o and both spent accounts are gone from auth, which is what makes group '
    || 'Z''s census a census of a chain carrying two erasures rather than a claim about one',
    (SELECT count(*)::int FROM auth.users u WHERE u.id IN (c.host_d, c.decider)) = 0);

  INSERT INTO s11b_ri (ord, spent_human_trail, authorless_human)
    VALUES (1, v_adh, n0h + v_adh);
END $ri$;

-- ===========================================================================
-- 12. The census this file leaves behind, and the floor (Z01–Z10)
-- ===========================================================================
-- Three limits this file records rather than closes, because a census that counted only what the schema
-- stops would be a census that hides what it permits:
--
--   * The owner channel can delete a ticket that has no thread and no children (T45/T46): the FK from
--     `support_case_events` refuses to orphan a history, and nothing refuses to remove a ticket nobody has
--     written in yet. No request role can reach either table (S07/S08), so this is a fact about a database
--     key, not about a request — but it is a fact, and §12's erasure order is a procedure because of it.
--   * A human-kind trail row can come to name nobody, and the only way to make one is to erase an account
--     that had already acted (T-RI2f). The INSERT guard refuses every hand-plant, which is why Z08 can say
--     the authorless rows are exactly the erased actor's.
--   * The trail does not record erasure itself (T-RI1l): a host's acts were never trail rows, and deleting
--     the host is not one either. The ticket and its thread are the whole record of that workflow, which is
--     why T-RI1 spends its cells on keeping them.
DO $z$
DECLARE
  -- Not `n`: the four census reads below alias `count(*)` as `n`, and a PL/pgSQL variable of that name
  -- makes every one of them ambiguous at parse time.
  v_ran int;
  v_ri s11b_ri%ROWTYPE;
BEGIN
  SELECT * INTO v_ri FROM s11b_ri WHERE ord = 1;

  RAISE NOTICE 'CENSUS Z01 cases by status: %', (SELECT string_agg(status || '=' || n, ', '
    ORDER BY status COLLATE "C") FROM (SELECT status, count(*) AS n FROM private.support_cases
    GROUP BY status) s);
  RAISE NOTICE 'CENSUS Z01b thread rows by kind: %', (SELECT string_agg(kind || '=' || n, ', '
    ORDER BY kind COLLATE "C") FROM (SELECT kind, count(*) AS n FROM private.support_case_events
    GROUP BY kind) s);
  RAISE NOTICE 'CENSUS Z01c grants by scope+status: %', (SELECT string_agg(scope || '/' || status || '='
    || n, ', ' ORDER BY scope COLLATE "C", status COLLATE "C")
    FROM (SELECT scope, status, count(*) AS n FROM private.operator_grants GROUP BY scope, status) s);
  RAISE NOTICE 'CENSUS Z01d trail rows by action: %', (SELECT string_agg(action || '=' || n, ', '
    ORDER BY action COLLATE "C") FROM (SELECT action, count(*) AS n FROM private.audit_events
    GROUP BY action) s);

  PERFORM pg_temp.s11b_eq('Z02 the case table holds exactly the seven tickets this file''s doors opened: no '
    || 'group left a plant behind and none was lost', pg_temp.s11b_ccount(), 7::bigint);
  PERFORM pg_temp.s11b_eq('Z03 and every one of them is in the registry, so Z02 counts seven named tickets '
    || 'rather than seven rows', (SELECT count(*)::int FROM private.support_cases c2
      WHERE c2.case_ref NOT IN (SELECT r.case_ref FROM s11b_case r)), 0);
  PERFORM pg_temp.s11b_eq('Z04 every ticket has the seq-1 row the open door mints, and it is a status row '
    || 'written by a host: the first fact in every history is that somebody asked',
    (SELECT count(*)::int FROM private.support_cases c2
      WHERE NOT EXISTS (SELECT 1 FROM private.support_case_events e
                         WHERE e.case_id = c2.id AND e.seq = 1
                           AND e.kind = 'status' AND e.actor_kind = 'host')), 0);
  PERFORM pg_temp.s11b_eq('Z05 and no thread anywhere has a gap or a repeated ordinal: the minter is right '
    || 'per case, not right for the cells that happened to concatenate',
    (SELECT count(*)::int FROM (SELECT e.case_id FROM private.support_case_events e
                                 GROUP BY e.case_id
                                 HAVING max(e.seq) <> count(*) OR count(*) <> count(DISTINCT e.seq)) g), 0);
  PERFORM pg_temp.s11b_eq('Z06 exactly one ticket names nobody on either attribution column — the erased '
    || 'requester''s, measured as a count of one rather than described as a class',
    (SELECT count(*)::int FROM private.support_cases c2
      WHERE c2.requester_user_id IS NULL AND c2.opened_by_user_id IS NULL), 1);
  PERFORM pg_temp.s11b_eq('Z06b and that row is the ticket T-RI0 opened, still carrying the ref its '
    || 'requester was given before her account went',
    (SELECT c2.case_ref FROM private.support_cases c2
      WHERE c2.requester_user_id IS NULL AND c2.opened_by_user_id IS NULL), pg_temp.s11b_ref('vanish'));
  PERFORM pg_temp.s11b_eq('Z07 every link that still names somebody names an account that exists: three '
    || 'case columns and two grant columns, checked as one set because a dangling link would be the same '
    || 'defect in all five places',
    (SELECT count(*)::int FROM private.support_cases c2
      WHERE (c2.requester_user_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c2.requester_user_id))
         OR (c2.opened_by_user_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c2.opened_by_user_id))
         OR (c2.assigned_operator_user_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c2.assigned_operator_user_id)))
    + (SELECT count(*)::int FROM private.operator_grants g
        WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = g.user_id)
           OR (g.granted_by_user_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = g.granted_by_user_id))), 0);
  PERFORM pg_temp.s11b_eq('Z08 the trail''s human-kind authorless rows are exactly the ones T-RI2''s '
    || 'erasure made: nothing written after that deletion added one, so the only writer of an authorless '
    || 'human row in this schema is a deleted account',
    (SELECT count(*)::int FROM private.audit_events a
      WHERE a.actor_kind <> 'system' AND a.actor_user_id IS NULL), v_ri.authorless_human);
  PERFORM pg_temp.s11b_ok('Z08b and the erasure left more than zero of them, so Z08 compares a number that '
    || 'moved rather than two zeroes', v_ri.authorless_human > 0 AND v_ri.spent_human_trail > 0);
  PERFORM pg_temp.s11b_eq('Z09 every trail row about a grant names a grant row that exists: the trail and '
    || 'the credential table are two records of the same acts, and a revocation is a row rather than a '
    || 'deletion in both', (SELECT count(*)::int FROM private.audit_events a
      WHERE a.subject_type = 'operator_grant'
        AND (a.subject_key IS NULL
             OR NOT EXISTS (SELECT 1 FROM private.operator_grants g WHERE g.id = a.subject_key))), 0);

  -- The floor counts this cell too, so the number it compares against is the number the file prints.
  -- A floor, not an equality: a cell added later moves the printed total upward and must not move this.
  -- Re-pinned on the first green run over the repaired guard (2026-10-21): 641 printed, floor 638. The
  -- three cells of slack are room for a future repair to retire stale cases without re-pinning; a whole
  -- group that silently stops running still falls through it.
  PERFORM pg_temp.s11b_add(1);
  v_ran := coalesce(nullif(current_setting('s11b.passed', true), ''), '0')::int;
  IF v_ran < 638 THEN
    RAISE EXCEPTION 'FAIL Z10 the support battery ran % assertions, which is fewer than the floor', v_ran;
  END IF;
  RAISE NOTICE 'PASS Z10 the support battery ran at least its floor of assertions (%)', v_ran;
END $z$;

SELECT 'STAGE11 SUPPORT TESTS PASSED ('
    || coalesce(nullif(current_setting('s11b.passed', true), ''), '0') || ')';

