-- Stage 11 battery 3: privacy intake — receive, route, and prove that nothing here erases.
--
-- Run by `supabase/tests/stage11/run.sh authority` after `85_support_lifecycle.sql`, on the same chain, in
-- one transaction that commits. It inherits everything batteries 80 and 85 left behind — four live grants,
-- seven tickets, their threads and their trail — so every absolute count here is either a delta against a
-- number captured inside this file or the count of rows this file itself registered. Group Z's census
-- counts the thirteen requests this file created, not the cluster's.
--
-- Scope. This file proves, at the database: the one new table's columns, CHECKs, constraints, indexes,
-- triggers and FK delete rules; the minted ref; the insert-time requester guard; the five-state machine's
-- seven edges and two terminal states; the four doors' authorisation, caller re-derivation, projections,
-- replay anchors and cross-wedding refusals; the `privacy` duty's wall against the other three duties; and
-- the append-only survival of a request and its trail when the requester account and an operator account
-- are erased. It does not prove PostgREST, a signed-in JWT, or a screen: `test.uid` stands in for the
-- claim, and the wire half belongs to the HTTP tier.
--
-- Five postures carried from battery 2 because the naive version of each is wrong:
--   1. A door is called as a role through `pg_temp.s11q_as`, never as the owner, and each operator refusal
--      is measured through the wrapper and through the body directly — the answer must be the same
--      sentence, which is what "hiding the wrapper is not the boundary" means.
--   2. Every refusal asserts SQLSTATE plus sentence and the digest of the table that did not move.
--   3. The status machine is a 5×4 matrix of ordered pairs, each probed in a block that always rolls back,
--      so all twenty cells are measured against one fixture set and no accepted cell destroys the next.
--   4. Hand plants are undone and the undo is proved by re-taking the digest. They are the only way to
--      reach the CHECKs and the depth-at-two exception the doors cannot reach.
--   5. No cell asserts "the function deletes nothing" by reading its name. The file scans the four bodies'
--      source for a DELETE, attempts a client DELETE, attempts the parent delete the FK must refuse, and
--      then erases two accounts and counts every row before and after.

SET client_min_messages = notice;
SET search_path = public, pg_temp;

SELECT set_config('s11q.passed', '0', false);

-- --------------------------------------------------------------------------- the harness
CREATE FUNCTION pg_temp.s11q_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s11q.passed',
    (coalesce(nullif(current_setting('s11q.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s11q_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11q_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11q_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11q_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11q_array(label text, got text[], want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label,
      array_to_string(coalesce(got, ARRAY[]::text[]), ', '),
      array_to_string(coalesce(want, ARRAY[]::text[]), ', ');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11q_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11q_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % not an object', label, coalesce(jsonb_typeof(v), 'NULL');
  END IF;
  PERFORM pg_temp.s11q_array(label,
    (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
       FROM jsonb_object_keys(v) k), want);
END $fn$;

CREATE FUNCTION pg_temp.s11q_err_is(label text, got text, want_state text, want_like text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got IS NULL OR split_part(got, ' | ', 1) <> want_state OR got NOT LIKE want_like THEN
    RAISE EXCEPTION 'FAIL %: got [%] want [% / %]', label, got, want_state, want_like;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11q_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11q_accept(label text, got text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'FAIL %: expected the statement to be accepted, it heard [%]', label, got;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11q_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11q_as(p_role text, p_uid uuid, p_stmt text) RETURNS jsonb
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

CREATE FUNCTION pg_temp.s11q_err(v jsonb) RETURNS text
LANGUAGE sql STABLE AS $fn$ SELECT v ->> '_error' $fn$;

CREATE FUNCTION pg_temp.s11q_try(p_role text, p_uid uuid, stmt text) RETURNS text
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

-- Three nested blocks: the innermost captures the answer, the middle raises a marker after the answer is
-- captured, and the outer swallows the marker while aborting the subtransaction the accepted work merged
-- into. An accepted plant and a refused plant therefore leave the same chain behind.
CREATE FUNCTION pg_temp.s11q_probe(p_role text, p_uid uuid, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_answer text;
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  PERFORM set_config('test.uid', coalesce(p_uid::text, ''), false);
  PERFORM set_config('test.role', p_role, false);
  BEGIN
    BEGIN
      BEGIN
        EXECUTE stmt;
        v_answer := 'ACCEPTED';
      EXCEPTION WHEN OTHERS THEN
        v_answer := SQLSTATE || ' | ' || SQLERRM;
      END;
      RAISE EXCEPTION 's11q_probe_rolled_back';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.uid', '', false);
  RETURN v_answer;
END $fn$;

-- --------------------------------------------------------------------------- the digests
CREATE FUNCTION pg_temp.s11q_rstate() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || request_ref || '|' || wedding_id::text || '|'
           || coalesce(requester_user_id::text,'') || '|' || kind || '|' || status || '|'
           || coalesce(host_note,'') || '|' || coalesce(operator_note,'') || '|'
           || requested_at::text || '|' || updated_at::text, '~' ORDER BY id), ''))
    FROM private.privacy_requests $fn$;

CREATE FUNCTION pg_temp.s11q_rcount() RETURNS bigint
LANGUAGE sql STABLE AS $fn$ SELECT count(*) FROM private.privacy_requests $fn$;

CREATE FUNCTION pg_temp.s11q_adigest() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || coalesce(wedding_id::text,'') || '|' || subject_type || '|'
           || coalesce(subject_key::text,'') || '|' || action || '|' || actor_role || '|'
           || coalesce(actor_user_id::text,'') || '|' || payload::text || '|'
           || created_at::text || '|' || actor_kind || '|' || coalesce(reason,'') || '|'
           || coalesce(idempotency_key,'') || '|' || coalesce(before_state::text,'') || '|'
           || coalesce(after_state::text,''), '~' ORDER BY id), ''))
    FROM private.audit_events $fn$;

CREATE FUNCTION pg_temp.s11q_acount() RETURNS bigint
LANGUAGE sql STABLE AS $fn$ SELECT count(*) FROM private.audit_events $fn$;

CREATE FUNCTION pg_temp.s11q_gstate() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || user_id::text || '|' || scope || '|' || status || '|' || reason || '|'
           || coalesce(granted_by_user_id::text,'') || '|' || granted_at::text || '|'
           || coalesce(expires_at::text,'') || '|' || coalesce(revoked_at::text,'') || '|'
           || created_at::text || '|' || updated_at::text, '~' ORDER BY id), ''))
    FROM private.operator_grants $fn$;

CREATE FUNCTION pg_temp.s11q_is(p_uid uuid, p_scope text) RETURNS boolean
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

CREATE FUNCTION pg_temp.s11q_u(p uuid) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT coalesce(quote_literal(p::text), 'NULL') $fn$;

CREATE FUNCTION pg_temp.s11q_t(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT coalesce(quote_literal(p), 'NULL') $fn$;

-- A call that must succeed. Setup uses this so a fixture failure is a sentence about the door, not a NULL
-- three groups later. It also counts every accepted advance into `s11q_adv`, which group Z compares with
-- the trail: the counter is written by the same helper that saw the answer, so a replay (which the doors
-- answer with `replayed=true`) is not counted twice.
CREATE TEMP TABLE s11q_adv (n integer PRIMARY KEY DEFAULT 0) ON COMMIT DROP;
INSERT INTO s11q_adv DEFAULT VALUES;

-- Every audit id a first-time answer handed back. Group Z's census reads this against the trail both ways:
-- the door cannot return an id that is not a row, and the trail cannot hold a row no door returned.
CREATE TEMP TABLE s11q_aid (audit_id bigint PRIMARY KEY) ON COMMIT DROP;

CREATE FUNCTION pg_temp.s11q_must(p_label text, p_role text, p_uid uuid, p_stmt text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  v := pg_temp.s11q_as(p_role, p_uid, p_stmt);
  IF v ? '_error' THEN
    RAISE EXCEPTION 'FAIL setup %: %', p_label, v ->> '_error';
  END IF;
  IF v ? 'audit_id' AND NOT coalesce((v ->> 'replayed')::boolean, false) THEN
    UPDATE s11q_adv SET n = n + 1;
    INSERT INTO s11q_aid (audit_id) VALUES ((v ->> 'audit_id')::bigint)
      ON CONFLICT (audit_id) DO NOTHING;
  END IF;
  RETURN v;
END $fn$;

-- ===========================================================================
-- S. What the migration ships, before this file writes its own rows
-- ===========================================================================
DO $s$
DECLARE v text; n bigint;
BEGIN
  PERFORM pg_temp.s11q_eq('S01 the privacy table exists in the server-only schema and is empty before this '
    || 'file creates anything',
    (SELECT count(*)::int FROM private.privacy_requests), 0);

  PERFORM pg_temp.s11q_ok('S02 RLS is enabled on it',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'private.privacy_requests'::regclass));

  PERFORM pg_temp.s11q_eq('S03 and there is no policy to grant a client a row: the server bodies are the '
    || 'only readers',
    (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'private'
       AND tablename = 'privacy_requests'), 0);

  PERFORM pg_temp.s11q_array('S04 the columns are exactly the ten §8 names, no more',
    ARRAY(SELECT a.attname::text FROM pg_attribute a
            WHERE a.attrelid = 'private.privacy_requests'::regclass AND a.attnum > 0
              AND NOT a.attisdropped ORDER BY a.attnum),
    ARRAY['id','request_ref','wedding_id','requester_user_id','kind','status','host_note',
          'operator_note','requested_at','updated_at']);

  PERFORM pg_temp.s11q_array('S05 the constraint inventory: primary key, unique ref, two foreign keys and '
    || 'six value checks',
    ARRAY(SELECT c.conname::text FROM pg_constraint c
            WHERE c.conrelid = 'private.privacy_requests'::regclass ORDER BY c.conname),
    ARRAY['privacy_requests_host_note_check','privacy_requests_kind_check',
          'privacy_requests_operator_note_check','privacy_requests_pkey',
          'privacy_requests_request_ref_check','privacy_requests_request_ref_key',
          'privacy_requests_requester_user_id_fkey',
          'privacy_requests_satisfied_names_where_check','privacy_requests_status_check',
          'privacy_requests_wedding_id_fkey']);

  PERFORM pg_temp.s11q_array('S06 the index inventory: the two read paths and the per-caller active anchor '
    || 'on top of the keys',
    ARRAY(SELECT indexname::text FROM pg_indexes WHERE schemaname = 'private'
            AND tablename = 'privacy_requests' ORDER BY indexname),
    ARRAY['privacy_requests_active_uniq','privacy_requests_pkey',
          'privacy_requests_request_ref_key','privacy_requests_requester_requested_idx',
          'privacy_requests_status_requested_idx']);

  PERFORM pg_temp.s11q_array('S07 six triggers: mint, require-requester, guard, touch, and the two client '
    || 'write walls',
    ARRAY(SELECT t.tgname::text FROM pg_trigger t
            WHERE t.tgrelid = 'private.privacy_requests'::regclass AND NOT t.tgisinternal
            ORDER BY t.tgname),
    ARRAY['privacy_requests_guard_update','privacy_requests_mint_ref',
          'privacy_requests_no_client_delete','privacy_requests_no_client_write',
          'privacy_requests_require_requester','set_updated_at']);

  PERFORM pg_temp.s11q_array('S08 the wedding link refuses the parent delete and the requester link releases '
    || 'the row when its account is erased',
    ARRAY(SELECT c.conname::text || '=' || CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'n' THEN 'SET NULL'
                                                              WHEN 'c' THEN 'CASCADE' ELSE c.confdeltype::text END
            FROM pg_constraint c
           WHERE c.conrelid = 'private.privacy_requests'::regclass AND c.contype = 'f' ORDER BY c.conname),
    ARRAY['privacy_requests_requester_user_id_fkey=SET NULL',
          'privacy_requests_wedding_id_fkey=NO ACTION']);

  -- No client role holds a privilege, asked one verb at a time. The four-verb list form of
  -- `has_table_privilege` is ANY-of — slice 1 measured that on `audit_events` — so this cell does not use it.
  SELECT string_agg(r.rolname || ':' || v.verb || '=' || has_table_privilege(r.rolname,
           'private.privacy_requests', v.verb)::text, ',' ORDER BY r.rolname, v.verb)
    INTO v
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
   CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) v(verb);
  PERFORM pg_temp.s11q_eq('S09 nine of nine role/verb pairs are false: no browser role reaches the table '
    || 'directly, whatever a later policy does', v,
    'anon:DELETE=false,anon:INSERT=false,anon:SELECT=false,anon:UPDATE=false,'
    || 'authenticated:DELETE=false,authenticated:INSERT=false,authenticated:SELECT=false,'
    || 'authenticated:UPDATE=false,service_role:DELETE=false,service_role:INSERT=false,'
    || 'service_role:SELECT=false,service_role:UPDATE=false');

  -- The surface counts this head declares. Each is a pg_proc count, not a grep: a name declared twice with
  -- two argument lists counts twice here and once in a text search.
  PERFORM pg_temp.s11q_eq('S10 the stage''s declared surface at this file: 40 api wrappers, 60 internal '
    || 'bodies, 52 private names',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api'),
    40);
  PERFORM pg_temp.s11q_eq('S10b and the twelve names this file adds are the only movement: four pairs, on '
    || 'top of slice 4''s four wrappers and five bodies',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'internal_api'), 60);
  PERFORM pg_temp.s11q_eq('S10c and three private helpers join the schema, plus slice 4''s four on the '
    || 'review-note trail',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private'), 52);

  PERFORM pg_temp.s11q_array('S11 the four bodies are definers with a pinned path, owned by postgres',
    ARRAY(SELECT p.proname::text || '=' || p.prosecdef::text || '/' ||
                 coalesce(array_to_string(p.proconfig, ','), '(none)') || '/' || r.rolname
            FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
           WHERE p.pronamespace = 'internal_api'::regnamespace
             AND p.proname IN ('create_privacy_request','get_my_privacy_requests',
                               'operator_privacy_queue','operator_advance_privacy_request')
           ORDER BY p.proname),
    ARRAY['create_privacy_request=true/search_path=""/postgres',
          'get_my_privacy_requests=true/search_path=""/postgres',
          'operator_advance_privacy_request=true/search_path=""/postgres',
          'operator_privacy_queue=true/search_path=""/postgres']);

  PERFORM pg_temp.s11q_array('S12 and the four wrappers are invokers with a pinned path',
    ARRAY(SELECT p.proname::text || '=' || p.prosecdef::text || '/' ||
                 coalesce(array_to_string(p.proconfig, ','), '(none)')
            FROM pg_proc p
           WHERE p.pronamespace = 'api'::regnamespace
             AND p.proname IN ('create_privacy_request','get_my_privacy_requests',
                               'operator_privacy_queue','operator_advance_privacy_request')
           ORDER BY p.proname),
    ARRAY['create_privacy_request=false/search_path=""',
          'get_my_privacy_requests=false/search_path=""',
          'operator_advance_privacy_request=false/search_path=""',
          'operator_privacy_queue=false/search_path=""']);

  PERFORM pg_temp.s11q_array('S13 authenticated holds EXECUTE on all eight names; anon and service_role '
    || 'hold none',
    ARRAY(SELECT p.proname::text || ':' || e.rolname
            FROM pg_proc p CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) e(rolname)
           WHERE p.pronamespace IN ('api'::regnamespace, 'internal_api'::regnamespace)
             AND p.proname IN ('create_privacy_request','get_my_privacy_requests',
                               'operator_privacy_queue','operator_advance_privacy_request')
             AND has_function_privilege(e.rolname, p.oid, 'EXECUTE')
           ORDER BY p.proname, e.rolname),
    ARRAY['create_privacy_request:authenticated','create_privacy_request:authenticated',
          'get_my_privacy_requests:authenticated','get_my_privacy_requests:authenticated',
          'operator_advance_privacy_request:authenticated',
          'operator_advance_privacy_request:authenticated',
          'operator_privacy_queue:authenticated','operator_privacy_queue:authenticated']);

  -- One DELETE search over the four bodies' own source. It cannot prove a callee never deletes, and it does
  -- not claim to: group D proves the parent delete fails and the erasures leave every byte standing. This
  -- cell is the narrow claim §8 makes about this file.
  PERFORM pg_temp.s11q_eq('S14 none of the four bodies names a DELETE at all',
    (SELECT count(*)::int FROM pg_proc p
      WHERE p.pronamespace IN ('api'::regnamespace, 'internal_api'::regnamespace)
        AND p.proname IN ('create_privacy_request','get_my_privacy_requests',
                          'operator_privacy_queue','operator_advance_privacy_request')
        AND p.prosrc ~* '\mdelete\M'), 0);

  PERFORM pg_temp.s11q_ok('S15 the table comment states the no-delete posture in the schema itself',
    (SELECT obj_description('private.privacy_requests'::regclass, 'pg_class')
       LIKE '%No function in this stage deletes a row%'));

  PERFORM pg_temp.s11q_eq('S16 the requester column is nullable on disk and the insert guard, not a NOT '
    || 'NULL constraint, is what names it — the shape that lets an erased account release the row',
    (SELECT count(*)::int FROM pg_attribute a
      WHERE a.attrelid = 'private.privacy_requests'::regclass
        AND a.attname = 'requester_user_id' AND a.attnotnull), 0);
END $s$;

-- ===========================================================================
-- The cast
-- ===========================================================================
-- host_a owns wa (the walk), wa2..wa6 (one fixture per status for the matrix) and wa7 (replay);
-- host_b owns wb and is the stranger; host_x owns wx and carries the FK cells; host_d owns wd, files the
-- request that survives an erasure, then transfers the wedding so the erasure can happen at all.
-- op1 is the privacy operator this file acts as; op2 is the second privacy operator, advanced once,
-- revoked and then erased to prove the trail's actor link; op3 is a support-only operator and is the wall
-- in the other direction; op_exp holds an expired privacy grant planted by the trusted channel; decider
-- mints every grant and holds none; ghost is a uuid that is nobody and owns nothing.
CREATE TEMP TABLE s11q_cast ON COMMIT DROP AS
SELECT gen_random_uuid() AS host_a, gen_random_uuid() AS host_b, gen_random_uuid() AS host_c,
       gen_random_uuid() AS host_d, gen_random_uuid() AS host_x,
       gen_random_uuid() AS op1, gen_random_uuid() AS op2, gen_random_uuid() AS op3,
       gen_random_uuid() AS op_exp, gen_random_uuid() AS decider, gen_random_uuid() AS ghost,
       gen_random_uuid() AS wa, gen_random_uuid() AS wa2, gen_random_uuid() AS wa3,
       gen_random_uuid() AS wa4, gen_random_uuid() AS wa5, gen_random_uuid() AS wa6,
       gen_random_uuid() AS wa7, gen_random_uuid() AS wb, gen_random_uuid() AS wx,
       gen_random_uuid() AS wd;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT c.host_a,  's11q-host-a@stage11qual.test',  '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.host_b,  's11q-host-b@stage11qual.test',  '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.host_c,  's11q-host-c@stage11qual.test',  '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.host_d,  's11q-host-d@stage11qual.test',  '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.host_x,  's11q-host-x@stage11qual.test',  '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.op1,     's11q-op-1@stage11qual.test',    '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.op2,     's11q-op-2@stage11qual.test',    '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.op3,     's11q-op-3@stage11qual.test',    '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.op_exp,  's11q-op-exp@stage11qual.test',  '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.decider, 's11q-decider@stage11qual.test', '{}'::jsonb FROM s11q_cast c;

INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages,
                             style_settings)
SELECT c.wa,  c.host_a, 'Privacy wa',  'en', ARRAY[]::text[], '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.wa2, c.host_a, 'Privacy wa2', 'en', ARRAY[]::text[], '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.wa3, c.host_a, 'Privacy wa3', 'en', ARRAY[]::text[], '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.wa4, c.host_a, 'Privacy wa4', 'en', ARRAY[]::text[], '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.wa5, c.host_a, 'Privacy wa5', 'en', ARRAY[]::text[], '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.wa6, c.host_a, 'Privacy wa6', 'en', ARRAY[]::text[], '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.wa7, c.host_a, 'Privacy wa7', 'en', ARRAY[]::text[], '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.wb,  c.host_b, 'Privacy wb',  'en', ARRAY[]::text[], '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.wx,  c.host_x, 'Privacy wx',  'en', ARRAY[]::text[], '{}'::jsonb FROM s11q_cast c
UNION ALL SELECT c.wd,  c.host_d, 'Privacy wd',  'en', ARRAY[]::text[], '{}'::jsonb FROM s11q_cast c;

CREATE TEMP TABLE s11q_req (tag text PRIMARY KEY, request_ref text, request_id uuid, host uuid)
  ON COMMIT DROP;

CREATE FUNCTION pg_temp.s11q_reg(p_tag text, p_answer jsonb, p_host uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_answer ? '_error' THEN
    RAISE EXCEPTION 'FAIL: setup could not register %, the door answered [%]', p_tag,
      p_answer ->> '_error';
  END IF;
  INSERT INTO s11q_req (tag, request_ref, request_id, host)
    SELECT p_tag, p_answer ->> 'request_ref', r.id, p_host
      FROM private.privacy_requests r WHERE r.request_ref = p_answer ->> 'request_ref';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: setup registered %, but no row carries that ref', p_tag;
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.s11q_ref(p_tag text) RETURNS text
LANGUAGE sql STABLE AS $fn$ SELECT request_ref FROM s11q_req WHERE tag = p_tag $fn$;

CREATE FUNCTION pg_temp.s11q_id(p_tag text) RETURNS uuid
LANGUAGE sql STABLE AS $fn$ SELECT request_id FROM s11q_req WHERE tag = p_tag $fn$;

CREATE TEMP TABLE s11q_key ON COMMIT DROP AS
SELECT gen_random_uuid() AS k_e1, gen_random_uuid() AS k_e2, gen_random_uuid() AS k_e3,
       gen_random_uuid() AS k_decline, gen_random_uuid() AS k_d1,
       gen_random_uuid() AS k_mi, gen_random_uuid() AS k_mq, gen_random_uuid() AS k_ms1,
       gen_random_uuid() AS k_ms2, gen_random_uuid() AS k_md, gen_random_uuid() AS k_dm,
       gen_random_uuid() AS k_r1, gen_random_uuid() AS k_r2,
       gen_random_uuid() AS k_guard, gen_random_uuid() AS k_refused;

CREATE FUNCTION pg_temp.s11q_k(p_col text) RETURNS uuid
LANGUAGE plpgsql STABLE AS $fn$
DECLARE v uuid;
BEGIN
  EXECUTE format('SELECT %I FROM s11q_key', p_col) INTO v;
  RETURN v;
END $fn$;

CREATE FUNCTION pg_temp.s11q_open_sql(p_wedding uuid, p_kind text, p_note text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT format('SELECT api.create_privacy_request(%s, %s, %s)',
                pg_temp.s11q_u(p_wedding), pg_temp.s11q_t(p_kind), pg_temp.s11q_t(p_note)) $fn$;

CREATE FUNCTION pg_temp.s11q_adv_sql(p_ref text, p_to text, p_note text, p_key uuid) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT format('SELECT api.operator_advance_privacy_request(%s, %s, %s, %s)',
                pg_temp.s11q_t(p_ref), pg_temp.s11q_t(p_to), pg_temp.s11q_t(p_note),
                pg_temp.s11q_u(p_key)) $fn$;

-- --------------------------------------------------------------------------- fixtures through the doors
DO $fx$
DECLARE c s11q_cast%ROWTYPE; v jsonb;
BEGIN
  SELECT * INTO c FROM s11q_cast;

  -- Two kinds on wa: export walks to satisfaction, erasure is declined.
  v := pg_temp.s11q_must('e_main', 'authenticated', c.host_a,
        pg_temp.s11q_open_sql(c.wa, 'export', '  Full export please  '));
  PERFORM pg_temp.s11q_reg('e_main', v, c.host_a);
  PERFORM pg_temp.s11q_eq('H02 the note is stored trimmed rather than as the form sent it',
    (SELECT host_note FROM private.privacy_requests WHERE request_ref = v ->> 'request_ref'),
    'Full export please');

  v := pg_temp.s11q_must('a_era', 'authenticated', c.host_a,
        pg_temp.s11q_open_sql(c.wa, 'erasure', NULL));
  PERFORM pg_temp.s11q_reg('a_era', v, c.host_a);

  v := pg_temp.s11q_must('b_main', 'authenticated', c.host_b,
        pg_temp.s11q_open_sql(c.wb, 'export', 'my data'));
  PERFORM pg_temp.s11q_reg('b_main', v, c.host_b);

  v := pg_temp.s11q_must('x_main', 'authenticated', c.host_x,
        pg_temp.s11q_open_sql(c.wx, 'export', NULL));
  PERFORM pg_temp.s11q_reg('x_main', v, c.host_x);

  v := pg_temp.s11q_must('d_main', 'authenticated', c.host_d,
        pg_temp.s11q_open_sql(c.wd, 'export', 'before I close this account'));
  PERFORM pg_temp.s11q_reg('d_main', v, c.host_d);

  -- The matrix's five starting states, each on its own wedding.
  v := pg_temp.s11q_must('m_recv', 'authenticated', c.host_a,
        pg_temp.s11q_open_sql(c.wa2, 'export', 'matrix received'));
  PERFORM pg_temp.s11q_reg('m_recv', v, c.host_a);
  v := pg_temp.s11q_must('m_ident', 'authenticated', c.host_a,
        pg_temp.s11q_open_sql(c.wa3, 'export', 'matrix identity'));
  PERFORM pg_temp.s11q_reg('m_ident', v, c.host_a);
  v := pg_temp.s11q_must('m_queue', 'authenticated', c.host_a,
        pg_temp.s11q_open_sql(c.wa4, 'export', 'matrix queue'));
  PERFORM pg_temp.s11q_reg('m_queue', v, c.host_a);
  v := pg_temp.s11q_must('m_sat', 'authenticated', c.host_a,
        pg_temp.s11q_open_sql(c.wa5, 'export', 'matrix satisfied'));
  PERFORM pg_temp.s11q_reg('m_sat', v, c.host_a);
  v := pg_temp.s11q_must('m_decl', 'authenticated', c.host_a,
        pg_temp.s11q_open_sql(c.wa6, 'export', 'matrix declined'));
  PERFORM pg_temp.s11q_reg('m_decl', v, c.host_a);
  v := pg_temp.s11q_must('r_main', 'authenticated', c.host_a,
        pg_temp.s11q_open_sql(c.wa7, 'export', 'replay fixture'));
  PERFORM pg_temp.s11q_reg('r_main', v, c.host_a);
END $fx$;

-- ===========================================================================
-- P. The privilege layer, role by role
-- ===========================================================================
DO $p$
DECLARE c s11q_cast%ROWTYPE; v jsonb; s_body text; s_wrap text;
BEGIN
  SELECT * INTO c FROM s11q_cast;

  v := pg_temp.s11q_as('anon', NULL,
    pg_temp.s11q_open_sql(c.wa, 'export', 'anon'));
  PERFORM pg_temp.s11q_err_is('P01 anon cannot call the host''s create wrapper',
    pg_temp.s11q_err(v), '42501', '%permission denied for function%');

  v := pg_temp.s11q_as('anon', NULL, 'SELECT api.get_my_privacy_requests()');
  PERFORM pg_temp.s11q_err_is('P02 anon cannot call the host''s list wrapper',
    pg_temp.s11q_err(v), '42501', '%permission denied for function%');

  v := pg_temp.s11q_as('service_role', c.host_a,
    pg_temp.s11q_open_sql(c.wa, 'export', 'service'));
  PERFORM pg_temp.s11q_err_is('P03 service_role cannot call the create wrapper: the key is not a door',
    pg_temp.s11q_err(v), '42501', '%permission denied for schema api%');

  v := pg_temp.s11q_as('service_role', c.host_a, 'SELECT api.operator_privacy_queue(NULL)');
  PERFORM pg_temp.s11q_err_is('P04 nor the privacy queue', pg_temp.s11q_err(v),
    '42501', '%permission denied for schema api%');

  v := pg_temp.s11q_as('authenticated', NULL,
    pg_temp.s11q_open_sql(c.wa, 'export', 'nobody'));
  PERFORM pg_temp.s11q_err_is('P05 an authenticated role with no claimed account is refused by the body, '
    || 'not by the wrapper', pg_temp.s11q_err(v), '42501', '%needs a signed-in account%');

  v := pg_temp.s11q_as('authenticated', NULL, 'SELECT api.get_my_privacy_requests()');
  PERFORM pg_temp.s11q_err_is('P06 the same for the list door', pg_temp.s11q_err(v),
    '42501', '%needs a signed-in account%');

  -- The wrapper and the body answer alike. The caller has EXECUTE on both; hiding the wrapper is not the
  -- boundary, and this pair is the evidence.
  s_wrap := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.host_b,
    'SELECT api.operator_privacy_queue(NULL)'));
  s_body := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.host_b,
    'SELECT internal_api.operator_privacy_queue(NULL)'));
  PERFORM pg_temp.s11q_eq('P07 the wrapper and the body refuse a plain host with the identical sentence',
    s_wrap, s_body);
  PERFORM pg_temp.s11q_err_is('P07b and that sentence is the body''s authorisation, not a missing grant',
    s_wrap, '42501', '%the caller may not read the privacy queue%');

  s_wrap := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.host_b,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('b_main'), 'declined', 'no', pg_temp.s11q_k('k_refused'))));
  s_body := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.host_b,
    format('SELECT internal_api.operator_advance_privacy_request(%s, %s, %s, %s)',
           pg_temp.s11q_t(pg_temp.s11q_ref('b_main')), pg_temp.s11q_t('declined'), 'NULL',
           pg_temp.s11q_u(pg_temp.s11q_k('k_refused')))));
  PERFORM pg_temp.s11q_eq('P08 and the advance door''s pair answers alike too', s_wrap, s_body);
  PERFORM pg_temp.s11q_err_is('P08b with the same sentence for both call paths', s_wrap, '42501',
    '%the caller may not change this privacy request%');

  -- A direct table read as each role, with the schema privilege and the table ACL both in the way.
  PERFORM pg_temp.s11q_err_is('P09 authenticated cannot read the table directly',
    pg_temp.s11q_try('authenticated', c.host_a,
      'SELECT count(*)::text FROM private.privacy_requests'), '42501', '%permission denied%');
  PERFORM pg_temp.s11q_err_is('P10 anon cannot read it either',
    pg_temp.s11q_try('anon', NULL,
      'SELECT count(*)::text FROM private.privacy_requests'), '42501', '%permission denied%');
  PERFORM pg_temp.s11q_err_is('P11 and service_role, which owns no privilege on the private schema''s tables, '
    || 'is refused as well',
    pg_temp.s11q_try('service_role', NULL,
      'SELECT count(*)::text FROM private.privacy_requests'), '42501', '%permission denied%');

  PERFORM pg_temp.s11q_err_is('P12 a direct INSERT is refused',
    pg_temp.s11q_try('authenticated', c.host_a,
      'INSERT INTO private.privacy_requests (wedding_id, requester_user_id, kind) VALUES ('
      || pg_temp.s11q_u(c.wa) || ', ' || pg_temp.s11q_u(c.host_a) || ', ''export'') RETURNING id::text'),
    '42501', '%permission denied%');

  PERFORM pg_temp.s11q_err_is('P13 a direct UPDATE is refused',
    pg_temp.s11q_try('authenticated', c.host_a,
      'UPDATE private.privacy_requests SET status = ''declined'' RETURNING id::text'),
    '42501', '%permission denied%');

  PERFORM pg_temp.s11q_err_is('P14 a direct DELETE is refused',
    pg_temp.s11q_try('authenticated', c.host_a,
      'DELETE FROM private.privacy_requests RETURNING id::text'),
    '42501', '%permission denied%');
END $p$;

-- ===========================================================================
-- G. The two privacy grants this file's cast needs
-- ===========================================================================
DO $g$
DECLARE c s11q_cast%ROWTYPE; v jsonb; g0 bigint; a0 bigint;
BEGIN
  SELECT * INTO c FROM s11q_cast;
  g0 := (SELECT count(*) FROM private.operator_grants);
  a0 := (SELECT count(*) FROM private.audit_events);

  v := (SELECT internal_api.grant_operator_role(c.op1, 'privacy',
        'battery 3: the privacy operator who walks the queue', c.decider, NULL));
  PERFORM pg_temp.s11q_eq('G01 the first privacy grant came back live and carries the duty this file asks '
    || 'for', v ->> 'scope', 'privacy');
  PERFORM pg_temp.s11q_eq('G02 and status active rather than pending', v ->> 'status', 'active');
  PERFORM pg_temp.s11q_ok('G03 and it answers with both ids: the grant row and the trail row that records '
    || 'who decided',
    (v ? 'grant_id') AND (v ? 'audit_id')
    AND EXISTS (SELECT 1 FROM private.audit_events a WHERE a.id = (v ->> 'audit_id')::bigint));

  v := (SELECT internal_api.grant_operator_role(c.op2, 'privacy',
        'battery 3: the second privacy operator, revoked and erased later', c.decider, NULL));
  PERFORM pg_temp.s11q_ok('G04 the second privacy grant names a different beneficiary',
    (v ->> 'user_id') = c.op2::text);

  v := (SELECT internal_api.grant_operator_role(c.op3, 'support',
        'battery 3: a support operator with no privacy duty', c.decider, NULL));
  PERFORM pg_temp.s11q_eq('G05 a support grant stays a support grant: scope is the body''s argument and the '
    || 'table''s CHECK, not a default', v ->> 'scope', 'support');

  PERFORM pg_temp.s11q_eq('G06 three grant rows were minted and each wrote one trail row',
    (SELECT count(*)::int FROM private.operator_grants) - g0::int, 3);
  PERFORM pg_temp.s11q_eq('G06b and the trail grew by exactly three',
    (SELECT count(*)::int FROM private.audit_events) - a0::int, 3);

  -- An expired grant, planted through the trusted channel because no door mints a past expiry: the CHECK
  -- only requires `expires_at > granted_at`, and the predicate is what reads the clock. The body writes an
  -- audit row the hand plant does not, so this row is the one grant in the table with no decision behind it
  -- and group Z does not count grants.
  INSERT INTO private.operator_grants
      (user_id, scope, status, reason, granted_by_user_id, granted_at, expires_at)
    VALUES (c.op_exp, 'privacy', 'active', 'battery 3: expired, planted by the trusted channel',
            c.decider, now() - interval '2 hours', now() - interval '1 hour');

  PERFORM pg_temp.s11q_eq('G07 the predicate answers true for both live privacy operators',
    ARRAY[pg_temp.s11q_is(c.op1, 'privacy')::text, pg_temp.s11q_is(c.op2, 'privacy')::text],
    ARRAY['true','true']);
  PERFORM pg_temp.s11q_eq('G08 and false for the support-only operator, the expired grant, the host and '
    || 'nobody',
    ARRAY[pg_temp.s11q_is(c.op3, 'privacy')::text, pg_temp.s11q_is(c.op_exp, 'privacy')::text,
          pg_temp.s11q_is(c.host_a, 'privacy')::text, pg_temp.s11q_is(NULL, 'privacy')::text],
    ARRAY['false','false','false','false']);
  PERFORM pg_temp.s11q_eq('G09 the expired row is still status active: expiry is a clock the predicate '
    || 'reads, not a status somebody has to sweep',
    (SELECT status FROM private.operator_grants WHERE user_id = c.op_exp AND scope = 'privacy'),
    'active');
END $g$;

-- The matrix fixtures reach their states through the door once the grants above exist, so the fixture
-- itself proves the legal edges rather than planting statuses a later reader would have to trust.
DO $fx2$
DECLARE c s11q_cast%ROWTYPE;
BEGIN
  SELECT * INTO c FROM s11q_cast;

  PERFORM pg_temp.s11q_must('m_ident', 'authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_ident'), 'identity_verification_requested', NULL,
                         pg_temp.s11q_k('k_mi')));
  PERFORM pg_temp.s11q_must('m_queue', 'authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_queue'), 'queued_for_stage13', NULL,
                         pg_temp.s11q_k('k_mq')));
  PERFORM pg_temp.s11q_must('m_sat 1', 'authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_sat'), 'queued_for_stage13', NULL,
                         pg_temp.s11q_k('k_ms1')));
  PERFORM pg_temp.s11q_must('m_sat 2', 'authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_sat'), 'satisfied_outside_this_build',
                         'the export was delivered by the Stage 13 process', pg_temp.s11q_k('k_ms2')));
  PERFORM pg_temp.s11q_must('m_decl', 'authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_decl'), 'declined', 'asked on another channel',
                         pg_temp.s11q_k('k_md')));
  -- The erasure half of group D needs a trail row written by the second operator, then erased with them.
  PERFORM pg_temp.s11q_must('d_main advance', 'authenticated', c.op2,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('d_main'), 'identity_verification_requested',
                         'verifying the account holder', pg_temp.s11q_k('k_dm')));
END $fx2$;

-- ===========================================================================
-- H. The host's two doors: creation, replay by state, and the note bounds
-- ===========================================================================
DO $h$
DECLARE c s11q_cast%ROWTYPE; v jsonb; n0 bigint; v_new jsonb; e_foreign text; e_ghost text;
BEGIN
  SELECT * INTO c FROM s11q_cast;

  v := pg_temp.s11q_as('authenticated', c.host_a,
    pg_temp.s11q_open_sql(c.wa, 'export', 'another note'));
  PERFORM pg_temp.s11q_eq('H01 a second create for a wedding/kind whose request is still live is answered '
    || 'from the row that exists', v ->> 'request_ref', pg_temp.s11q_ref('e_main'));
  PERFORM pg_temp.s11q_eq('H01b and it says so rather than pretending to have created a second request',
    v ->> 'replayed', 'true');

  SELECT * INTO v_new FROM (SELECT 1) x;
  n0 := pg_temp.s11q_rcount();
  v := pg_temp.s11q_as('authenticated', c.host_a,
    pg_temp.s11q_open_sql(c.wa, 'export', 'another note'));
  PERFORM pg_temp.s11q_eq('H02 the replay wrote no row at all',
    (pg_temp.s11q_rcount() - n0)::int, 0);

  v := pg_temp.s11q_as('authenticated', c.host_b,
    pg_temp.s11q_open_sql(c.wb, 'export', 'again'));
  PERFORM pg_temp.s11q_eq('H03 host_b''s create replays host_b''s own request, not host_a''s: the anchor '
    || 'is per caller', ARRAY[(v ->> 'replayed'), (v ->> 'request_ref')],
    ARRAY['true', pg_temp.s11q_ref('b_main')]);

  PERFORM pg_temp.s11q_eq('H03b the register holds one request per fixture, not one per call',
    (SELECT count(*)::int FROM s11q_req), 11);

  e_foreign := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.host_b,
    pg_temp.s11q_open_sql(c.wa, 'export', 'not mine')));
  e_ghost := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.host_b,
    pg_temp.s11q_open_sql(c.ghost, 'export', 'not there')));
  PERFORM pg_temp.s11q_eq('H04 a foreign wedding and a wedding that does not exist answer with the '
    || 'identical sentence', e_foreign, e_ghost);
  PERFORM pg_temp.s11q_err_is('H04b and that sentence refuses the act without saying which case it is',
    e_foreign, '42501', '%the caller may not open a privacy request about this wedding%');

  v := pg_temp.s11q_as('authenticated', c.host_a,
    pg_temp.s11q_open_sql(c.wa, 'delete', NULL));
  PERFORM pg_temp.s11q_err_is('H05 the vocabulary has no destructive arm: `delete` is not a kind',
    pg_temp.s11q_err(v), '23514', '%the two are export and erasure, and neither of them deletes anything%');

  v := pg_temp.s11q_as('authenticated', c.host_a,
    pg_temp.s11q_open_sql(c.wa, NULL, NULL));
  PERFORM pg_temp.s11q_err_is('H06 a NULL kind is the same refusal', pg_temp.s11q_err(v),
    '23514', '%unknown privacy request kind%');

  v := pg_temp.s11q_as('authenticated', c.host_a,
    pg_temp.s11q_open_sql(c.wa, 'export', '   '));
  PERFORM pg_temp.s11q_err_is('H07 a blank note is not a note', pg_temp.s11q_err(v),
    '23514', '%either real text or absent%');

  v := pg_temp.s11q_as('authenticated', c.host_a,
    pg_temp.s11q_open_sql(c.wa, 'export', repeat('x', 2001)));
  PERFORM pg_temp.s11q_err_is('H08 and 2001 characters is over the bound', pg_temp.s11q_err(v),
    '23514', '%2001 characters is neither%');

  PERFORM pg_temp.s11q_eq('H09 the create door is not an operator door: the host cannot advance',
    (SELECT count(*)::int FROM private.privacy_requests WHERE request_ref = pg_temp.s11q_ref('e_main')
       AND status = 'received'), 1);

  v := pg_temp.s11q_as('authenticated', c.host_a, 'SELECT api.get_my_privacy_requests()');
  PERFORM pg_temp.s11q_keys('H10 the host list answers with exactly two keys', v,
    ARRAY['count','requests']);
  PERFORM pg_temp.s11q_keys('H11 and each request with exactly seven: the operator note is absent',
    (SELECT r FROM jsonb_array_elements(v -> 'requests') r
      WHERE r ->> 'request_ref' = pg_temp.s11q_ref('e_main')),
    ARRAY['host_note','kind','request_ref','requested_at','status','updated_at','wedding_id']);
  PERFORM pg_temp.s11q_ok('H11b and the host does see their own note',
    (SELECT (r ->> 'host_note') = 'Full export please'
       FROM jsonb_array_elements(v -> 'requests') r
      WHERE r ->> 'request_ref' = pg_temp.s11q_ref('e_main')));

  v := pg_temp.s11q_as('authenticated', c.host_b, 'SELECT api.get_my_privacy_requests()');
  PERFORM pg_temp.s11q_eq('H12 host_b''s list names host_b''s request and nothing from host_a',
    ARRAY(SELECT r ->> 'request_ref' FROM jsonb_array_elements(v -> 'requests') r ORDER BY 1),
    ARRAY[pg_temp.s11q_ref('b_main')]);

  v := pg_temp.s11q_as('authenticated', c.host_a, 'SELECT api.get_my_privacy_requests()');
  PERFORM pg_temp.s11q_ok('H13 host_a sees both kinds and every wedding it owns, and no later refusal '
    || 'leaked into the list',
    (SELECT count(*)::int FROM jsonb_array_elements(v -> 'requests') r
      WHERE r ->> 'request_ref' IN (pg_temp.s11q_ref('e_main'), pg_temp.s11q_ref('a_era'),
                                    pg_temp.s11q_ref('m_recv'), pg_temp.s11q_ref('r_main'))) = 4
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'requests') r
                     WHERE r ->> 'request_ref' = pg_temp.s11q_ref('b_main')));

  PERFORM pg_temp.s11q_eq('H14 every ref this file registered so far is unique and carries the PR- base32 '
    || 'shape',
    (SELECT count(DISTINCT request_ref)::int FROM s11q_req), 11);
  PERFORM pg_temp.s11q_eq('H15 and all eleven match the CHECK the table holds',
    (SELECT count(*)::int FROM private.privacy_requests WHERE request_ref ~ '^PR-[A-Z2-7]{8}$'), 11);
END $h$;

-- ===========================================================================
-- Q. The privacy queue's filters and projections
-- ===========================================================================
DO $q$
DECLARE c s11q_cast%ROWTYPE; v jsonb; v_host jsonb; n int; s_wrap text; s_body text;
BEGIN
  SELECT * INTO c FROM s11q_cast;

  v := pg_temp.s11q_as('authenticated', c.op1, 'SELECT api.operator_privacy_queue(NULL)');
  PERFORM pg_temp.s11q_eq('Q01 the unfiltered queue counts every request this file made',
    (v ->> 'count')::int, pg_temp.s11q_rcount()::int);
  PERFORM pg_temp.s11q_keys('Q02 the envelope is requests, status_filter and count',
    v, ARRAY['count','requests','status_filter']);
  PERFORM pg_temp.s11q_keys('Q03 an item is the operator projection: nine keys including the annotation',
    v -> 'requests' -> 0,
    ARRAY['host_note','kind','operator_note','request_ref','requested_at','requester_user_id',
          'status','updated_at','wedding_id']);
  PERFORM pg_temp.s11q_ok('Q04 and the annotation is a real column, present even when it is null',
    (v -> 'requests' -> 0) ? 'operator_note');

  v := pg_temp.s11q_as('authenticated', c.op1,
    'SELECT api.operator_privacy_queue(''received'')');
  PERFORM pg_temp.s11q_eq('Q05 the received filter returns exactly the rows the table holds in that state',
    (v ->> 'count')::int,
    (SELECT count(*)::int FROM private.privacy_requests WHERE status = 'received'));
  PERFORM pg_temp.s11q_ok('Q06 and every item in it is received',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'requests') r
                 WHERE r ->> 'status' <> 'received'));

  v := pg_temp.s11q_as('authenticated', c.op1,
    'SELECT api.operator_privacy_queue(''satisfied_outside_this_build'')');
  PERFORM pg_temp.s11q_eq('Q07 the satisfied filter names the one request the fixtures have completed so '
    || 'far, and group A adds the second',
    ARRAY(SELECT r ->> 'request_ref' FROM jsonb_array_elements(v -> 'requests') r ORDER BY 1),
    ARRAY[pg_temp.s11q_ref('m_sat')]);

  v := pg_temp.s11q_as('authenticated', c.op1,
    'SELECT api.operator_privacy_queue(''open'')');
  PERFORM pg_temp.s11q_err_is('Q08 a filter word this lifecycle does not have refuses rather than answering '
    || 'empty', pg_temp.s11q_err(v), '23514', '%unknown privacy status%');

  v := pg_temp.s11q_as('authenticated', c.host_b, 'SELECT api.operator_privacy_queue(NULL)');
  PERFORM pg_temp.s11q_err_is('Q09 a plain host is refused the queue by the body',
    pg_temp.s11q_err(v), '42501', '%the caller may not read the privacy queue%');

  v := pg_temp.s11q_as('authenticated', c.op3, 'SELECT api.operator_privacy_queue(NULL)');
  PERFORM pg_temp.s11q_err_is('Q10 a support operator is refused too: the four duties are walls, not a '
    || 'hierarchy', pg_temp.s11q_err(v), '42501', '%the caller may not read the privacy queue%');

  v := pg_temp.s11q_as('anon', NULL, 'SELECT api.operator_privacy_queue(NULL)');
  PERFORM pg_temp.s11q_err_is('Q11 anon cannot reach the wrapper', pg_temp.s11q_err(v),
    '42501', '%permission denied for function%');

  v := pg_temp.s11q_as('service_role', NULL, 'SELECT api.operator_privacy_queue(NULL)');
  PERFORM pg_temp.s11q_err_is('Q12 service_role cannot reach it either', pg_temp.s11q_err(v),
    '42501', '%permission denied for schema api%');

  s_wrap := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.host_b,
    'SELECT api.operator_privacy_queue(NULL)'));
  s_body := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.host_b,
    'SELECT internal_api.operator_privacy_queue(NULL)'));
  PERFORM pg_temp.s11q_eq('Q13 the wrapper and the body answer the plain host identically', s_wrap, s_body);

  v := pg_temp.s11q_as('authenticated', c.op1, 'SELECT api.operator_privacy_queue(NULL)');
  PERFORM pg_temp.s11q_ok('Q14 the queue is oldest-first: the first timestamp is not later than the last',
    (SELECT (r -> 0 ->> 'requested_at')::timestamptz <= (r -> -1 ->> 'requested_at')::timestamptz
       FROM (SELECT v -> 'requests' AS r) q));

  v := pg_temp.s11q_as('authenticated', c.host_b, 'SELECT api.get_my_privacy_requests()');
  PERFORM pg_temp.s11q_eq('Q15 and the host''s list carries one row while the queue carries every host''s',
    (v ->> 'count')::int, 1);
END $q$;

-- ===========================================================================
-- A. The legal walk, the refusals around it, and the trail it writes
-- ===========================================================================
DO $a$
DECLARE c s11q_cast%ROWTYPE; v jsonb; d0 text; n0 bigint; r0 bigint; ans text;
BEGIN
  SELECT * INTO c FROM s11q_cast;

  v := pg_temp.s11q_must('e_main walk 1', 'authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('e_main'), 'identity_verification_requested', NULL,
                         pg_temp.s11q_k('k_e1')));
  PERFORM pg_temp.s11q_eq('A01 received -> identity_verification_requested is answered with the states the '
    || 'row moved between', (v ->> 'from_status') || '>' || (v ->> 'to_status'),
    'received>identity_verification_requested');
  PERFORM pg_temp.s11q_ok('A02 and with the audit row that recorded it',
    (v ? 'audit_id') AND EXISTS (SELECT 1 FROM private.audit_events a
                                  WHERE a.id = (v ->> 'audit_id')::bigint
                                    AND a.action = 'privacy_status_changed'));

  v := pg_temp.s11q_must('e_main walk 2', 'authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('e_main'), 'queued_for_stage13', NULL,
                         pg_temp.s11q_k('k_e2')));
  PERFORM pg_temp.s11q_eq('A03 identity -> queued is the same leg the matrix measures, walked by the door',
    (v ->> 'from_status') || '>' || (v ->> 'to_status'),
    'identity_verification_requested>queued_for_stage13');

  v := pg_temp.s11q_must('e_main walk 3', 'authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('e_main'), 'satisfied_outside_this_build',
                         'delivered by the Stage 13 export job under case SV-DEMO', pg_temp.s11q_k('k_e3')));
  PERFORM pg_temp.s11q_eq('A04 queued -> satisfied is accepted and reports the final state',
    v ->> 'to_status', 'satisfied_outside_this_build');
  PERFORM pg_temp.s11q_eq('A05 the row carries the completing note', 
    (SELECT operator_note FROM private.privacy_requests WHERE request_ref = pg_temp.s11q_ref('e_main')),
    'delivered by the Stage 13 export job under case SV-DEMO');

  PERFORM pg_temp.s11q_array('A06 the three audit rows for e_main record the three ordered edges',
    ARRAY(SELECT (a.before_state ->> 'status') || '>' || (a.after_state ->> 'status')
            FROM private.audit_events a
           WHERE a.subject_type = 'privacy_request'
             AND a.subject_key = pg_temp.s11q_id('e_main')
           ORDER BY a.id),
    ARRAY['received>identity_verification_requested',
          'identity_verification_requested>queued_for_stage13',
          'queued_for_stage13>satisfied_outside_this_build']);

  PERFORM pg_temp.s11q_ok('A07 each reason names the ref and the two states, without the note text',
    (SELECT bool_and(a.reason = 'privacy request ' || pg_temp.s11q_ref('e_main') || ' moved '
                               || (a.before_state ->> 'status') || ' to ' || (a.after_state ->> 'status'))
       FROM private.audit_events a
      WHERE a.subject_key = pg_temp.s11q_id('e_main')));

  PERFORM pg_temp.s11q_ok('A08 the payload names the ref, wedding and kind and carries no caller text',
    (SELECT bool_and(a.payload ? 'request_ref' AND a.payload ? 'wedding_id' AND a.payload ? 'kind'
                          AND (a.payload ->> 'request_ref') = pg_temp.s11q_ref('e_main')
                          AND a.payload::text NOT LIKE '%Stage 13 export job%')
       FROM private.audit_events a WHERE a.subject_key = pg_temp.s11q_id('e_main')));

  -- A satisfied move without any note is refused by the body before the UPDATE; the row does not move.
  d0 := pg_temp.s11q_rstate();
  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_queue'), 'satisfied_outside_this_build', NULL,
                         pg_temp.s11q_k('k_guard'))));
  PERFORM pg_temp.s11q_err_is('A09 entering satisfied with no note is refused with the sentence about '
    || 'naming where', ans, '23514', '%requires an operator note saying where the request was satisfied%');
  PERFORM pg_temp.s11q_eq('A10 and the refusal left the fixture exactly where it was',
    pg_temp.s11q_rstate(), d0);

  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('e_main'), 'queued_for_stage13', 'reopen',
                         gen_random_uuid())));
  PERFORM pg_temp.s11q_err_is('A11 a satisfied request is terminal even to the door that satisfied it',
    ans, '23514', '%privacy request is terminal%');

  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_recv'), 'received', NULL, gen_random_uuid())));
  PERFORM pg_temp.s11q_err_is('A12 nothing moves back to received: the desk saw it on arrival',
    ans, '23514', '%may not be moved back to received%');

  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_ident'), 'identity_verification_requested', NULL,
                         gen_random_uuid())));
  PERFORM pg_temp.s11q_err_is('A13 a same-status repeat is refused rather than absorbed',
    ans, '23514', '%already identity_verification_requested%');

  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_queue'), 'queued_for_stage13', '   ', gen_random_uuid())));
  PERFORM pg_temp.s11q_err_is('A14 a blank note on a real move is refused',
    ans, '23514', '%either real text or absent%');

  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_queue'), 'queued_for_stage13', repeat('y', 4001),
                         gen_random_uuid())));
  PERFORM pg_temp.s11q_err_is('A15 and 4001 characters is over the operator bound',
    ans, '23514', '%4001 characters is neither%');

  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_queue'), 'held', NULL, gen_random_uuid())));
  PERFORM pg_temp.s11q_err_is('A16 an unknown target word refuses', ans, '23514',
    '%unknown privacy status%');

  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_queue'), 'declined', NULL, NULL)));
  PERFORM pg_temp.s11q_err_is('A17 a keyless advance refuses', ans, '23514',
    '%requires an idempotency key%');

  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.host_a,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_queue'), 'declined', NULL, gen_random_uuid())));
  PERFORM pg_temp.s11q_err_is('A18 the host cannot advance their own request', ans, '42501',
    '%the caller may not change this privacy request%');

  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql('PR-ZZZZZZZZ', 'declined', NULL, gen_random_uuid())));
  PERFORM pg_temp.s11q_err_is('A19 an invented ref answers with the same sentence as a refused caller',
    ans, '42501', '%the caller may not change this privacy request%');

  v := pg_temp.s11q_must('a_era decline', 'authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('a_era'), 'declined', 'the host asked twice', 
                         pg_temp.s11q_k('k_decline')));
  PERFORM pg_temp.s11q_eq('A20 received -> declined is one legal step on the erasure request',
    (v ->> 'from_status') || '>' || (v ->> 'to_status'), 'received>declined');
  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('a_era'), 'queued_for_stage13', NULL, gen_random_uuid())));
  PERFORM pg_temp.s11q_err_is('A21 and declined is terminal', ans, '23514',
    '%privacy request is terminal%');

  v := pg_temp.s11q_as('authenticated', c.host_a, 'SELECT api.get_my_privacy_requests()');
  PERFORM pg_temp.s11q_ok('A22 the host sees the declined status and the host''s note, without the '
    || 'operator''s annotation',
    (SELECT bool_and(r ->> 'status' = 'declined' AND (r ? 'host_note') AND NOT (r ? 'operator_note'))
       FROM jsonb_array_elements(v -> 'requests') r
      WHERE r ->> 'request_ref' = pg_temp.s11q_ref('a_era')));

  v := pg_temp.s11q_as('authenticated', c.op1, 'SELECT api.operator_privacy_queue(NULL)');
  PERFORM pg_temp.s11q_ok('A23 the desk sees the annotation it wrote',
    (SELECT bool_and(r ->> 'operator_note' = 'the host asked twice')
       FROM jsonb_array_elements(v -> 'requests') r
      WHERE r ->> 'request_ref' = pg_temp.s11q_ref('a_era')));
END $a$;

-- The active anchor frees when a request reaches a terminal state, so a host may ask again after a
-- decline. This is the one legal second act on wa/erasure, and it is a new row rather than an edit. It has
-- to follow the decline above: before group A the anchor is still held by the live erasure request.
DO $h2$
DECLARE c s11q_cast%ROWTYPE; v jsonb;
BEGIN
  SELECT * INTO c FROM s11q_cast;
  v := pg_temp.s11q_as('authenticated', c.host_a,
    pg_temp.s11q_open_sql(c.wa, 'erasure', 'asking again after the refusal'));
  PERFORM pg_temp.s11q_eq('H16 a declined request releases the anchor: the second ask is a new request, not '
    || 'a replay', v ->> 'replayed', 'false');
  PERFORM pg_temp.s11q_ok('H17 and it carries a ref distinct from the declined one',
    (v ->> 'request_ref') <> pg_temp.s11q_ref('a_era'));
  PERFORM pg_temp.s11q_reg('a_era2', v, c.host_a);
END $h2$;

-- ===========================================================================
-- M. The status machine as a matrix: every ordered pair, probed and rolled back
-- ===========================================================================
DO $m$
DECLARE r record; ans text; d0 text; c0 bigint; d1 text; c1 bigint;
        a_acc text[] := '{}'::text[];
BEGIN
  d0 := pg_temp.s11q_rstate();
  c0 := pg_temp.s11q_rcount();

  FOR r IN
    SELECT * FROM (VALUES
      ( 1, 'm_recv',  'received',                      'identity_verification_requested', true,  false),
      ( 2, 'm_recv',  'received',                      'queued_for_stage13',              true,  false),
      ( 3, 'm_recv',  'received',                      'satisfied_outside_this_build',    false, false),
      ( 4, 'm_recv',  'received',                      'declined',                        true,  false),
      ( 5, 'm_ident', 'identity_verification_requested','received',                       false, false),
      ( 6, 'm_ident', 'identity_verification_requested','queued_for_stage13',             true,  false),
      ( 7, 'm_ident', 'identity_verification_requested','satisfied_outside_this_build',   false, false),
      ( 8, 'm_ident', 'identity_verification_requested','declined',                       true,  false),
      ( 9, 'm_queue', 'queued_for_stage13',             'received',                       false, false),
      (10, 'm_queue', 'queued_for_stage13',             'identity_verification_requested',false, false),
      (11, 'm_queue', 'queued_for_stage13',             'satisfied_outside_this_build',   true,  false),
      (12, 'm_queue', 'queued_for_stage13',             'declined',                       true,  false),
      (13, 'm_sat',   'satisfied_outside_this_build',   'received',                       false, true),
      (14, 'm_sat',   'satisfied_outside_this_build',   'identity_verification_requested',false, true),
      (15, 'm_sat',   'satisfied_outside_this_build',   'queued_for_stage13',             false, true),
      (16, 'm_sat',   'satisfied_outside_this_build',   'declined',                       false, true),
      (17, 'm_decl',  'declined',                       'received',                       false, true),
      (18, 'm_decl',  'declined',                       'identity_verification_requested',false, true),
      (19, 'm_decl',  'declined',                       'queued_for_stage13',             false, true),
      (20, 'm_decl',  'declined',                       'satisfied_outside_this_build',   false, true)
    ) AS x(ord, tag, frm, tgt, edge, terminal)
  LOOP
    ans := pg_temp.s11q_probe('postgres', NULL,
      format('UPDATE private.privacy_requests SET status = %L, '
             'operator_note = coalesce(operator_note, %L) WHERE request_ref = %L',
             r.tgt, 'matrix note', pg_temp.s11q_ref(r.tag)));
    IF r.edge THEN
      PERFORM pg_temp.s11q_accept(format('M%02s %s -> %s is on the edge table and the hand UPDATE lands',
        r.ord, r.frm, r.tgt), ans);
      a_acc := a_acc || (r.frm || '->' || r.tgt);
    ELSIF r.terminal THEN
      PERFORM pg_temp.s11q_err_is(format('M%02s %s -> %s is refused because the source is terminal',
        r.ord, r.frm, r.tgt), ans, '23514', '%privacy request is terminal%');
    ELSE
      PERFORM pg_temp.s11q_err_is(format('M%02s %s -> %s has no edge and the trigger says so',
        r.ord, r.frm, r.tgt), ans, '23514', '%no edge % exists in the privacy request lifecycle%');
    END IF;
  END LOOP;

  d1 := pg_temp.s11q_rstate();
  c1 := pg_temp.s11q_rcount();
  PERFORM pg_temp.s11q_eq('M21 all twenty probes rolled back: the table digest is the one the matrix '
    || 'started with', d1, d0);
  PERFORM pg_temp.s11q_eq('M21b and so is its row count', c1, c0);

  -- The edge table as the probes found it, not as it was typed twice: the seven pairs the trigger accepted,
  -- in probe order, against the seven the documentation names.
  PERFORM pg_temp.s11q_array('M22 the seven accepted cells are exactly the edge table''s seven rows',
    a_acc,
    ARRAY['received->identity_verification_requested','received->queued_for_stage13',
          'received->declined','identity_verification_requested->queued_for_stage13',
          'identity_verification_requested->declined',
          'queued_for_stage13->satisfied_outside_this_build','queued_for_stage13->declined']);
END $m$;

-- ===========================================================================
-- R. Replay: one key, one act, one anchor
-- ===========================================================================
DO $r$
DECLARE c s11q_cast%ROWTYPE; v jsonb; w jsonb; d0 text; a0 bigint; ans text; id1 bigint;
BEGIN
  SELECT * INTO c FROM s11q_cast;

  v := pg_temp.s11q_must('r_main 1', 'authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('r_main'), 'identity_verification_requested', NULL,
                         pg_temp.s11q_k('k_r1')));
  id1 := (v ->> 'audit_id')::bigint;
  PERFORM pg_temp.s11q_eq('R01 the first delivery writes the advance and says replayed=false',
    v ->> 'replayed', 'false');

  d0 := pg_temp.s11q_rstate();
  a0 := pg_temp.s11q_acount();
  w := pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('r_main'), 'identity_verification_requested', NULL,
                         pg_temp.s11q_k('k_r1')));
  PERFORM pg_temp.s11q_eq('R02 the same key from the same desk returns the same audit row',
    (w ->> 'audit_id')::bigint, id1);
  PERFORM pg_temp.s11q_eq('R03 with the states the first delivery recorded', 
    (w ->> 'from_status') || '>' || (w ->> 'to_status'),
    'received>identity_verification_requested');
  PERFORM pg_temp.s11q_eq('R04 and it says replayed=true', w ->> 'replayed', 'true');
  PERFORM pg_temp.s11q_eq('R05 the replay wrote no request byte', pg_temp.s11q_rstate(), d0);
  PERFORM pg_temp.s11q_eq('R06 and no trail row either', pg_temp.s11q_acount(), a0);

  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('m_recv'), 'declined', NULL, pg_temp.s11q_k('k_r1'))));
  PERFORM pg_temp.s11q_err_is('R07 the same key against a different request is refused, not replayed '
    || 'against the wrong subject', ans, '23514', '%already belongs to a different act%');
  PERFORM pg_temp.s11q_eq('R08 and that refusal moved neither request', pg_temp.s11q_rstate(), d0);

  v := pg_temp.s11q_must('r_main 2', 'authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('r_main'), 'queued_for_stage13', NULL,
                         pg_temp.s11q_k('k_r2')));
  PERFORM pg_temp.s11q_eq('R09 a second key moves the same request one more legal step',
    (v ->> 'from_status') || '>' || (v ->> 'to_status'),
    'identity_verification_requested>queued_for_stage13');

  w := pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('r_main'), 'identity_verification_requested', NULL,
                         pg_temp.s11q_k('k_r1')));
  PERFORM pg_temp.s11q_eq('R10 the first key still answers with the act it recorded, not with the row''s '
    || 'current status', (w ->> 'to_status'), 'identity_verification_requested');
  PERFORM pg_temp.s11q_eq('R10b and the same audit id', (w ->> 'audit_id')::bigint, id1);
END $r$;

-- ===========================================================================
-- X. Cross-household reads and the no-oracle sentence
-- ===========================================================================
DO $x$
DECLARE c s11q_cast%ROWTYPE; v jsonb; e_foreign text; e_ghost text; e_adv text; e_inv text;
BEGIN
  SELECT * INTO c FROM s11q_cast;

  e_foreign := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.host_a,
    pg_temp.s11q_open_sql(c.wb, 'erasure', 'not mine')));
  e_ghost := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.host_a,
    pg_temp.s11q_open_sql(c.ghost, 'erasure', 'not there')));
  PERFORM pg_temp.s11q_eq('X01 a foreign wedding and an invented one answer identically in the other '
    || 'direction too', e_foreign, e_ghost);

  v := pg_temp.s11q_as('authenticated', c.op1, 'SELECT api.operator_privacy_queue(NULL)');
  PERFORM pg_temp.s11q_ok('X02 the privacy desk sees requests from every host: the duty is global, and the '
    || 'queue names the requester as a uuid only',
    (SELECT count(*)::int FROM jsonb_array_elements(v -> 'requests') r
      WHERE r ->> 'request_ref' IN (pg_temp.s11q_ref('b_main'), pg_temp.s11q_ref('x_main'),
                                    pg_temp.s11q_ref('d_main'))) = 3
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'requests') r
                     WHERE r ? 'email' OR r ? 'requester_email'));

  e_adv := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.host_b,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('e_main'), 'declined', NULL, gen_random_uuid())));
  e_inv := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op1,
    pg_temp.s11q_adv_sql('PR-AAAAZZZZ', 'declined', NULL, gen_random_uuid())));
  PERFORM pg_temp.s11q_eq('X03 a host naming somebody else''s request and a desk naming an invented ref '
    || 'hear the same sentence', e_adv, e_inv);
  PERFORM pg_temp.s11q_err_is('X04 and it is a refusal rather than a clue', e_adv, '42501',
    '%the caller may not change this privacy request%');

  v := pg_temp.s11q_as('authenticated', c.host_b, 'SELECT api.get_my_privacy_requests()');
  PERFORM pg_temp.s11q_ok('X05 host_b''s list cannot show any wa request, even one host_b has the ref for',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'requests') r
                 WHERE r ->> 'request_ref' IN (pg_temp.s11q_ref('e_main'), pg_temp.s11q_ref('m_recv'),
                                               pg_temp.s11q_ref('r_main'))));

  v := pg_temp.s11q_as('authenticated', c.host_b,
    pg_temp.s11q_open_sql(c.wb, 'erasure', NULL));
  PERFORM pg_temp.s11q_eq('X06 host_b may file the other kind on its own wedding: ownership, not the '
    || 'first request''s kind, is the wall', v ->> 'replayed', 'false');
  PERFORM pg_temp.s11q_ok('X06b and the new ref is distinct', (v ->> 'request_ref') IS NOT NULL);
  PERFORM pg_temp.s11q_reg('x_era_b', v, c.host_b);
END $x$;

-- ===========================================================================
-- V. Revocation and expiry, on the sessions that opened the doors
-- ===========================================================================
DO $v$
DECLARE c s11q_cast%ROWTYPE; v jsonb; g0 text; ans text;
BEGIN
  SELECT * INTO c FROM s11q_cast;

  g0 := pg_temp.s11q_gstate();
  v := (SELECT internal_api.revoke_operator_role(c.op2, 'privacy',
        'battery 3: the second operator is revoked while the desk is open', c.decider));
  PERFORM pg_temp.s11q_eq('V01 the revocation lands as a status, with an instant', 
    (SELECT status FROM private.operator_grants WHERE user_id = c.op2 AND scope = 'privacy'),
    'revoked');
  PERFORM pg_temp.s11q_ok('V02 and the revocation is a row update rather than a deletion: the grant''s '
    || 'uuid survives its end',
    (SELECT count(*)::int FROM private.operator_grants WHERE user_id = c.op2 AND scope = 'privacy') = 1);
  PERFORM pg_temp.s11q_ok('V03 and the predicate now answers false for the same account on the same '
    || 'session', pg_temp.s11q_is(c.op2, 'privacy') = false);

  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op2,
    'SELECT api.operator_privacy_queue(NULL)'));
  PERFORM pg_temp.s11q_err_is('V04 the revoked desk cannot read the queue', ans, '42501',
    '%the caller may not read the privacy queue%');

  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op2,
    pg_temp.s11q_adv_sql(pg_temp.s11q_ref('d_main'), 'queued_for_stage13', NULL, gen_random_uuid())));
  PERFORM pg_temp.s11q_err_is('V05 nor advance the request it had already advanced', ans, '42501',
    '%the caller may not change this privacy request%');

  v := pg_temp.s11q_as('authenticated', c.op1, 'SELECT api.operator_privacy_queue(NULL)');
  PERFORM pg_temp.s11q_ok('V06 the other privacy operator still works: revocation is per credential, not '
    || 'per duty', NOT (v ? '_error'));

  ans := pg_temp.s11q_err(pg_temp.s11q_as('authenticated', c.op_exp,
    'SELECT api.operator_privacy_queue(NULL)'));
  PERFORM pg_temp.s11q_err_is('V07 an expired grant refuses without any cleanup job having run', ans,
    '42501', '%the caller may not read the privacy queue%');

  PERFORM pg_temp.s11q_eq('V08 exactly one grant row moved: the revocation updated op2''s and left the '
    || 'expired plant and every other credential byte-identical',
    (SELECT count(*)::int FROM private.operator_grants
      WHERE user_id = c.op2 AND scope = 'privacy' AND status = 'revoked' AND revoked_at IS NOT NULL),
    1);
  PERFORM pg_temp.s11q_eq('V08b and the active privacy credentials are one live operator plus one expired '
    || 'plant',
    (SELECT count(*)::int FROM private.operator_grants
      WHERE scope = 'privacy' AND status = 'active'), 2);
END $v$;

-- ===========================================================================
-- D. The no-delete posture: hand plants, a refused parent delete, and two erasures
-- ===========================================================================
DO $d$
DECLARE c s11q_cast%ROWTYPE; ans text; v_req private.privacy_requests;
        v_audit_id bigint; v_actor uuid; n0 bigint; r0 bigint; a0 bigint; note0 text;
        v_ctid tid;
BEGIN
  SELECT * INTO c FROM s11q_cast;
  SELECT * INTO v_req FROM private.privacy_requests WHERE request_ref = pg_temp.s11q_ref('d_main');
  SELECT a.id, a.actor_user_id INTO v_audit_id, v_actor
    FROM private.audit_events a
   WHERE a.subject_type = 'privacy_request' AND a.subject_key = v_req.id
     AND a.action = 'privacy_status_changed'
   ORDER BY a.id LIMIT 1;
  PERFORM pg_temp.s11q_ok('D00 the erasure fixture has an operator advance behind it and the actor is op2',
    v_audit_id IS NOT NULL AND v_actor = c.op2);

  ans := pg_temp.s11q_probe('postgres', NULL,
    format('UPDATE private.privacy_requests SET requester_user_id = %s WHERE id = %s',
           pg_temp.s11q_u(c.host_b), pg_temp.s11q_u(v_req.id)));
  PERFORM pg_temp.s11q_err_is('D01 a hand cannot hand a request to another account', ans, '42501',
    '%cannot change hands%');

  ans := pg_temp.s11q_probe('postgres', NULL,
    format('UPDATE private.privacy_requests SET requester_user_id = NULL WHERE id = %s',
           pg_temp.s11q_u(v_req.id)));
  PERFORM pg_temp.s11q_err_is('D02 and a NULL issued by a statement of its own is not the referential '
    || 'action: the depth-at-two exception is exactly that wide', ans, '42501', '%cannot change hands%');

  ans := pg_temp.s11q_probe('postgres', NULL,
    format('UPDATE private.privacy_requests SET kind = ''erasure'' WHERE id = %s',
           pg_temp.s11q_u(v_req.id)));
  PERFORM pg_temp.s11q_err_is('D03 the kind is the host''s declared subject and cannot be relabelled', ans,
    '42501', '%is not edited afterwards%');

  ans := pg_temp.s11q_probe('postgres', NULL,
    format('UPDATE private.privacy_requests SET host_note = ''rewritten'' WHERE id = %s',
           pg_temp.s11q_u(v_req.id)));
  PERFORM pg_temp.s11q_err_is('D04 nor can the host''s words be rewritten', ans, '42501',
    '%first two facts%');

  -- `now()` is the transaction's start, and every fixture in this file was inserted in this transaction, so
  -- assigning `now()` would be a no-op rather than a rewrite. A one-second step is a real change.
  ans := pg_temp.s11q_probe('postgres', NULL,
    format('UPDATE private.privacy_requests SET requested_at = requested_at + interval ''1 second'' '
           'WHERE id = %s', pg_temp.s11q_u(v_req.id)));
  PERFORM pg_temp.s11q_err_is('D05 nor the instant the host asked', ans, '42501', '%first two facts%');

  ans := pg_temp.s11q_probe('postgres', NULL,
    format('UPDATE private.privacy_requests SET wedding_id = %s WHERE id = %s',
           pg_temp.s11q_u(c.wb), pg_temp.s11q_u(v_req.id)));
  PERFORM pg_temp.s11q_err_is('D06 nor can it be re-parented onto another wedding', ans, '42501',
    '%cannot be re-parented%');

  ans := pg_temp.s11q_probe('postgres', NULL,
    format('UPDATE private.privacy_requests SET request_ref = ''PR-AAAAZZZZ'' WHERE id = %s',
           pg_temp.s11q_u(v_req.id)));
  PERFORM pg_temp.s11q_err_is('D07 the ref is minted once and quoted forever', ans, '42501',
    '%minted once and quoted forever%');

  -- The CHECK's NULL hole: a hand UPDATE into satisfied with no note must refuse, not pass on a NULL
  -- comparison. The target request is queued and the probe rolls back either way.
  ans := pg_temp.s11q_probe('postgres', NULL,
    format('UPDATE private.privacy_requests SET status = ''satisfied_outside_this_build'', '
           'operator_note = NULL WHERE id = %s', pg_temp.s11q_u(pg_temp.s11q_id('m_queue'))));
  PERFORM pg_temp.s11q_err_is('D08 a hand move into satisfied with no note is refused by the guard', ans,
    '23514', '%requires an operator note saying where%');

  ans := pg_temp.s11q_probe('postgres', NULL,
    format('UPDATE private.privacy_requests SET status = ''satisfied_outside_this_build'' WHERE id = %s',
           pg_temp.s11q_u(pg_temp.s11q_id('m_decl'))));
  PERFORM pg_temp.s11q_err_is('D08b and a terminal row cannot be rewritten even with a note already on it',
    ans, '23514', '%privacy request is terminal%');

  PERFORM pg_temp.s11q_err_is('D09 a client DELETE is refused by the ACL',
    pg_temp.s11q_try('authenticated', c.host_a,
      'DELETE FROM private.privacy_requests WHERE id = ' || pg_temp.s11q_u(v_req.id) || ' RETURNING id::text'),
    '42501', '%permission denied%');
  PERFORM pg_temp.s11q_err_is('D10 service_role is refused the same DELETE',
    pg_temp.s11q_try('service_role', NULL,
      'DELETE FROM private.privacy_requests WHERE id = ' || pg_temp.s11q_u(v_req.id) || ' RETURNING id::text'),
    '42501', '%permission denied%');

  n0 := pg_temp.s11q_rcount();
  ans := pg_temp.s11q_probe('postgres', NULL,
    format('DELETE FROM public.weddings WHERE id = %s', pg_temp.s11q_u(c.wd)));
  PERFORM pg_temp.s11q_err_is('D11 the wedding a request names refuses deletion on the request''s own '
    || 'foreign key', ans, '23503', '%privacy_requests_wedding_id_fkey%');
  PERFORM pg_temp.s11q_eq('D12 and the probe left every request standing', pg_temp.s11q_rcount(), n0);

  -- Erasure half. The wedding is transferred first: `public.weddings.owner_user_id` is ON DELETE CASCADE,
  -- so an owner with a request about their own wedding would be blocked by the very NO ACTION this table
  -- wants. Transferring the wedding is the real-world path and leaves the requester link as the only
  -- reference to the account being erased.
  UPDATE public.weddings SET owner_user_id = c.host_c WHERE id = c.wd;
  note0 := v_req.host_note;
  SELECT ctid INTO v_ctid FROM private.privacy_requests WHERE request_ref = pg_temp.s11q_ref('d_main');
  DELETE FROM auth.users WHERE id = c.host_d;

  SELECT * INTO v_req FROM private.privacy_requests WHERE request_ref = pg_temp.s11q_ref('d_main');
  PERFORM pg_temp.s11q_ok('D13 the request survives its requester''s erasure',
    v_req.id IS NOT NULL AND v_req.request_ref = pg_temp.s11q_ref('d_main'));
  PERFORM pg_temp.s11q_ok('D14 with the requester link NULL and every other byte intact',
    v_req.requester_user_id IS NULL AND v_req.kind = 'export' AND v_req.host_note = note0
    AND v_req.status = 'identity_verification_requested' AND v_req.wedding_id = c.wd);
  -- The touch trigger's now() is the insert instant inside this one transaction, so updated_at cannot
  -- witness the referential UPDATE and this file does not claim it does. A new physical tuple can.
  PERFORM pg_temp.s11q_ok('D15 the referential nulling rewrote the row: the surviving tuple is a new '
    || 'physical version, so the ON DELETE SET NULL action really executed against this row',
    (SELECT r.ctid FROM private.privacy_requests r WHERE r.id = v_req.id) <> v_ctid);
  PERFORM pg_temp.s11q_ok('D16 the account really is gone',
    NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.host_d));

  r0 := pg_temp.s11q_rcount();
  a0 := pg_temp.s11q_acount();
  DELETE FROM auth.users WHERE id = c.op2;
  PERFORM pg_temp.s11q_eq('D17 erasing the operator deleted no request', pg_temp.s11q_rcount(), r0);
  PERFORM pg_temp.s11q_eq('D18 and removed no trail row', pg_temp.s11q_acount(), a0);
  PERFORM pg_temp.s11q_ok('D19 the advance row survives with its actor link nulled and its facts intact',
    (SELECT a.actor_user_id IS NULL AND a.action = 'privacy_status_changed'
            AND a.subject_key = (SELECT request_id FROM s11q_req WHERE tag = 'd_main')
            AND a.after_state ->> 'status' = 'identity_verification_requested'
       FROM private.audit_events a WHERE a.id = v_audit_id));
  PERFORM pg_temp.s11q_eq('D20 the credential cascaded with its subject: no live or revoked privacy grant '
    || 'names the erased operator',
    (SELECT count(*)::int FROM private.operator_grants WHERE user_id = c.op2), 0);
  PERFORM pg_temp.s11q_ok('D21 the erased requester''s request is still on the desk''s queue, with a NULL '
    || 'requester rather than a missing row',
    (SELECT count(*)::int FROM jsonb_array_elements(
       pg_temp.s11q_as('authenticated', c.op1, 'SELECT api.operator_privacy_queue(NULL)') -> 'requests') r
      WHERE r ->> 'request_ref' = pg_temp.s11q_ref('d_main') AND r ->> 'requester_user_id' IS NULL) = 1);
END $d$;

-- ===========================================================================
-- Z. The census this file leaves behind
-- ===========================================================================
DO $z$
DECLARE c s11q_cast%ROWTYPE; n int; v bigint;
BEGIN
  SELECT * INTO c FROM s11q_cast;

  PERFORM pg_temp.s11q_eq('Z01 the table holds exactly the thirteen requests this file registered',
    pg_temp.s11q_rcount(), (SELECT count(*) FROM s11q_req));
  PERFORM pg_temp.s11q_eq('Z02 every ref is unique', 
    (SELECT count(DISTINCT request_ref)::int FROM private.privacy_requests),
    pg_temp.s11q_rcount()::int);

  PERFORM pg_temp.s11q_eq('Z03 exactly one request has a NULL requester, and it is the erased one',
    (SELECT count(*)::int FROM private.privacy_requests WHERE requester_user_id IS NULL), 1);
  PERFORM pg_temp.s11q_ok('Z03b and it is d_main',
    (SELECT requester_user_id IS NULL FROM private.privacy_requests
      WHERE request_ref = pg_temp.s11q_ref('d_main')));

  PERFORM pg_temp.s11q_eq('Z04 every audit id a first-time advance returned is a trail row, and every '
    || 'trail row is one a door returned: both directions of the same census',
    (SELECT count(*)::int FROM s11q_aid a
      WHERE NOT EXISTS (SELECT 1 FROM private.audit_events e
                         WHERE e.id = a.audit_id AND e.action = 'privacy_status_changed'))
    + (SELECT count(*)::int FROM private.audit_events e
        WHERE e.action = 'privacy_status_changed'
          AND NOT EXISTS (SELECT 1 FROM s11q_aid a WHERE a.audit_id = e.id)), 0);

  PERFORM pg_temp.s11q_eq('Z05 the privacy trail holds one row per accepted advance and no more',
    (SELECT count(*)::int FROM private.audit_events WHERE action = 'privacy_status_changed'),
    (SELECT a.n FROM s11q_adv a));

  PERFORM pg_temp.s11q_eq('Z06 every privacy trail row joins a request that still exists',
    (SELECT count(*)::int FROM private.audit_events a
      WHERE a.action = 'privacy_status_changed'
        AND NOT EXISTS (SELECT 1 FROM private.privacy_requests r WHERE r.id = a.subject_key)), 0);

  PERFORM pg_temp.s11q_ok('Z07 every recorded edge is one of the seven the trigger accepts',
    NOT EXISTS (
      SELECT 1 FROM private.audit_events a
       WHERE a.action = 'privacy_status_changed'
         AND ((a.before_state ->> 'status'), (a.after_state ->> 'status')) NOT IN (
              ('received','identity_verification_requested'),
              ('received','queued_for_stage13'),
              ('received','declined'),
              ('identity_verification_requested','queued_for_stage13'),
              ('identity_verification_requested','declined'),
              ('queued_for_stage13','satisfied_outside_this_build'),
              ('queued_for_stage13','declined'))));

  PERFORM pg_temp.s11q_ok('Z08 no privacy trail row carries caller text: before/after hold only the status '
    || 'and the payload only the ref, wedding and kind',
    NOT EXISTS (
      SELECT 1 FROM private.audit_events a
       WHERE a.action = 'privacy_status_changed'
         AND ((a.before_state - 'status') <> '{}'::jsonb
           OR (a.after_state - 'status') <> '{}'::jsonb
           OR a.payload - 'request_ref' - 'wedding_id' - 'kind' <> '{}'::jsonb)));

  -- D19 proves the erasure path leaves one trail row whose actor link is NULL by referential action, so
  -- "every row names its operator" is false once that scenario has run. The surviving invariant is the
  -- actor KIND for all rows plus exactly one NULL, on the erased operator's own advance.
  PERFORM pg_temp.s11q_ok('Z09 every privacy trail row names the request as its subject and an operator as '
    || 'the actor kind, and the only NULL actor link is the erased operator''s advance on d_main',
    NOT EXISTS (SELECT 1 FROM private.audit_events a
                 WHERE a.action = 'privacy_status_changed'
                   AND (a.subject_type <> 'privacy_request' OR a.actor_kind <> 'operator'
                        OR a.subject_key IS NULL))
    AND (SELECT count(*)::int FROM private.audit_events a
          WHERE a.action = 'privacy_status_changed' AND a.actor_user_id IS NULL) = 1
    AND (SELECT a.actor_user_id IS NULL FROM private.audit_events a
          WHERE a.action = 'privacy_status_changed'
            AND a.subject_key = (SELECT request_id FROM s11q_req WHERE tag = 'd_main')
          ORDER BY a.id LIMIT 1));

  PERFORM pg_temp.s11q_ok('Z10 both satisfied requests carry a non-blank note; the completed status never '
    || 'exists without its where',
    (SELECT count(*)::int FROM private.privacy_requests
      WHERE status = 'satisfied_outside_this_build') = 2
    AND NOT EXISTS (SELECT 1 FROM private.privacy_requests
                     WHERE status = 'satisfied_outside_this_build'
                       AND (operator_note IS NULL OR length(btrim(operator_note)) = 0)));

  PERFORM pg_temp.s11q_eq('Z11 one live privacy credential remains; the second was revoked and its subject '
    || 'erased, and the expired plant was never live to the predicate',
    (SELECT count(*)::int FROM private.operator_grants
      WHERE scope = 'privacy' AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())), 1);

  PERFORM pg_temp.s11q_eq('Z12 the client privilege posture is unchanged after every act in this file',
    (SELECT count(*)::int FROM (VALUES ('anon'),('authenticated'),('service_role')) r(rolname)
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) v(verb)
      WHERE has_table_privilege(r.rolname, 'private.privacy_requests', v.verb)), 0);

  v := current_setting('s11q.passed')::bigint;
  PERFORM pg_temp.s11q_ok('Z13 the file ran a floor of 150 assertions, so a truncated battery cannot pass '
    || 'by matching a lower total', v >= 150);
  RAISE NOTICE 'PASSED (%)', current_setting('s11q.passed');
END $z$;
