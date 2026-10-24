-- Stage 11 battery 5: operational health — a projection that reports only what it can reach, and a battery
-- that proves the report is neither empty, leaked, nor writable.
--
-- Run by `supabase/tests/stage11/run.sh authority` after `92_takedown_and_oversight.sql`, on the same chain,
-- in one transaction that commits. It therefore inherits batteries 1–4's rows: grants, tickets, threads,
-- privacy requests, takedowns and their trail. Every count this file claims about the projection is a delta
-- against an answer it captured inside this file, before its own plants, and read again after them. There is
-- no absolute count of a data table anywhere below — the only absolutes are `pg_proc`/`pg_class` inventories,
-- which no battery can move.
--
-- Scope. This file proves, at the database: the pair's declared posture and grant list; that every one of the
-- ten blocks is present with the exact field list §9 names; that the four refusals are four sentences and not
-- four behaviours (anon and service_role are refused by the grant layer, a signed-in account with no scope by
-- the body, and the superuser by the same sentence as any stranger); the window's bounds, its default, and
-- that the bound appears in the refusal; that the credential partition closes arithmetically and the
-- five lifecycle and five processing vocabularies do too; that `now()` is one instant for the whole answer;
-- that `blocks_not_measured` is derived from the blocks rather than written beside them; that no identifier
-- this schema holds crosses the projection while the one reconciliation category §9 asks for by name does;
-- that the `migrations` block answers `measured` when its store exists and `not_measured` when it does not,
-- reading one column either way; that the attempt ceiling this projection counts is the ceiling the schema
-- enforces; that a row of every store is byte-identical across a live call; and that the body cannot write
-- — by the engine's rule, by its own source, and by measurement.
--
-- It does not prove the screen is correct about a database it has not read. Every figure here is this
-- chain's, and §9's `auth_failures`, `rate_limits` and `token_abuse` tiles are `not_measured` because no such
-- store exists in this schema — the battery asserts that too, so the absence is a measured fact rather than
-- an untested claim.
--
-- Six postures carried from the earlier batteries because the naive version of each is wrong:
--   1. A door is called as a role through `pg_temp.s11h_as`, never as the owner, and a refusal is measured
--      through the wrapper and through the body directly; the answer must be one sentence.
--   2. Non-vacuity is built, not assumed. The liveness group reads the answer twice — once before this file's
--      plants and once after — and asserts the exact delta of every counter it can reach. A block that
--      reports nothing would report no delta, and the delta cells would fail. (Battery 4 records why a
--      probe's rolled-back answer cannot be carried out of its own subtransaction: a `set_config` written
--      inside an aborting block is reverted. So the plants here are committed, the way slice 4's are.)
--   3. An absence claim is paired with a presence control. Every "this string is not in the answer" cell sits
--      beside a cell showing the same scan does find a string that is in the answer.
--   4. A vocabulary is compared against the schema that enforces it, not against a copy in a comment. The
--      attempt ceiling is read from `pg_get_constraintdef` and the store list from `prosrc`.
--   5. A status count is an arithmetic identity, not a plausible number: partitions are required to sum to
--      their totals, and the answer's own totals are required not to move with the window that only the
--      window-labelled observations depend on.
--   6. "This body writes nothing" is never proven by its name or its comment. Three independent measurements
--      are made: `provolatile` against the engine's own refusal of a STABLE writer this file writes (with a
--      VOLATILE control that does write), a word-bounded DML scan of `prosrc` with a positive control against
--      a body that does insert, and eighteen table digests taken before and after a live call.

SET client_min_messages = notice;
SET search_path = public, pg_temp;

SELECT set_config('s11h.passed', '0', false);

-- --------------------------------------------------------------------------- the harness
CREATE FUNCTION pg_temp.s11h_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s11h.passed',
    (coalesce(nullif(current_setting('s11h.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s11h_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11h_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11h_array(label text, got text[], want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label,
      array_to_string(coalesce(got, ARRAY[]::text[]), ', '),
      array_to_string(coalesce(want, ARRAY[]::text[]), ', ');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11h_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % not an object', label, coalesce(jsonb_typeof(v), 'NULL');
  END IF;
  PERFORM pg_temp.s11h_array(label,
    (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
       FROM jsonb_object_keys(v) k), want);
END $fn$;

CREATE FUNCTION pg_temp.s11h_err_is(label text, got text, want_state text, want_like text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got IS NULL OR split_part(got, ' | ', 1) <> want_state OR got NOT LIKE want_like THEN
    RAISE EXCEPTION 'FAIL %: got [%] want [% / %]', label, got, want_state, want_like;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11h_same(label text, a text, b text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF a IS DISTINCT FROM b OR a IS NULL THEN
    RAISE EXCEPTION 'FAIL %: [%] vs [%] — these two refusals are not one sentence', label, a, b;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11h_as(p_role text, p_uid uuid, p_stmt text) RETURNS jsonb
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

-- A call that must succeed, returning the answer rather than an error string. Every snapshot below is taken
-- through this, so a door that began refusing is a sentence about the door, not a NULL path four groups later.
CREATE FUNCTION pg_temp.s11h_must(p_label text, p_role text, p_uid uuid, p_stmt text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  v := pg_temp.s11h_as(p_role, p_uid, p_stmt);
  IF v ? '_error' OR v ? '_null_answer' THEN
    RAISE EXCEPTION 'FAIL setup %: %', p_label, coalesce(v ->> '_error', 'the call answered NULL');
  END IF;
  RETURN v;
END $fn$;

CREATE FUNCTION pg_temp.s11h_err(v jsonb) RETURNS text
LANGUAGE sql STABLE AS $fn$ SELECT v ->> '_error' $fn$;

-- Used for the statements that are expected to fail: a table-wide cast, a STABLE writer, a client write.
CREATE FUNCTION pg_temp.s11h_try(p_role text, p_uid uuid, stmt text) RETURNS text
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

-- A statement that may legally succeed, run so that it leaves the chain exactly as it found it: the innermost
-- block captures the outcome, the middle raises a marker after the outcome is captured, and the outer swallows
-- the marker while aborting the subtransaction the accepted work merged into. Group T needs this because a
-- *control* — the second live guest credential the per-household index permits — is only a control if the
-- refused attack and the accepted control leave the same counts behind for group L to measure.
--
-- `@ID` in the statement is replaced by a fresh uuid before it runs, so a builder can name the row it is
-- about to attempt without this helper having to know which column the id lives in. Group P uses it so an
-- attack and its accepted sibling differ in the tested column and in nothing else, not even in how the row
-- id arrived.
CREATE FUNCTION pg_temp.s11h_probe(p_role text, p_uid uuid, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_answer text; v_id uuid := gen_random_uuid();
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  stmt := replace(stmt, '@ID', v_id::text);
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
      RAISE EXCEPTION 's11h_probe_rolled_back';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.uid', '', false);
  RETURN v_answer;
END $fn$;

-- The slice-1 doors, reached the only way they can be reached: as the owner, because no client role holds
-- EXECUTE. Group A depends on these to build the four authority shapes it argues about.
CREATE FUNCTION pg_temp.s11h_grant(p_acct uuid, p_scope text, p_reason text, p_actor uuid,
                                  p_expires timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  BEGIN
    SELECT internal_api.grant_operator_role(p_acct, p_scope, p_reason, p_actor, p_expires) INTO v;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('_error', SQLSTATE || ' | ' || SQLERRM);
  END;
  RETURN v;
END $fn$;

CREATE FUNCTION pg_temp.s11h_revoke(p_acct uuid, p_scope text, p_reason text, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  BEGIN
    SELECT internal_api.revoke_operator_role(p_acct, p_scope, p_reason, p_actor) INTO v;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('_error', SQLSTATE || ' | ' || SQLERRM);
  END;
  RETURN v;
END $fn$;

-- --------------------------------------------------------------------------- the ledgers
-- Created before the accessors below, because a `LANGUAGE sql` body is parsed at creation: `check_function_bodies`
-- resolves `pg_temp.s11h_s` while the CREATE FUNCTION runs, so a ledger created afterwards is a relation that
-- does not exist yet, not a name that will be looked up at call time.
CREATE TEMP TABLE s11h_s (tag text PRIMARY KEY, a jsonb) ON COMMIT DROP;
CREATE TEMP TABLE s11h_reg (tag text PRIMARY KEY, id uuid) ON COMMIT DROP;
CREATE TEMP TABLE s11h_key (tag text PRIMARY KEY, k uuid) ON COMMIT DROP;
-- The strings this battery plants and then requires the answer not to contain. Registered here so the
-- absence scan is a loop over a measured list rather than a hand-written list that can drift from the plants.
CREATE TEMP TABLE s11h_needle (tag text PRIMARY KEY, v text) ON COMMIT DROP;

-- --------------------------------------------------------------------------- the answer, read once per state
-- `jsonb_typeof` guards the path so a block that vanished is a sentence about the missing path, and not a
-- NULL that silently compares equal to another NULL three cells later.
CREATE FUNCTION pg_temp.s11h_snap(p_tag text) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$ SELECT a FROM pg_temp.s11h_s WHERE tag = p_tag $fn$;

CREATE FUNCTION pg_temp.s11h_num(p_tag text, p_path text[]) RETURNS numeric
LANGUAGE sql STABLE AS $fn$
  SELECT CASE jsonb_typeof(pg_temp.s11h_snap(p_tag) #> p_path)
           WHEN 'number' THEN (pg_temp.s11h_snap(p_tag) #>> p_path)::numeric
         END $fn$;

CREATE FUNCTION pg_temp.s11h_txt(p_tag text, p_path text[]) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT CASE jsonb_typeof(pg_temp.s11h_snap(p_tag) #> p_path)
           WHEN 'string' THEN pg_temp.s11h_snap(p_tag) #>> p_path
         END $fn$;

-- One numeric read of one captured answer. Absent is zero, because that is the honest reading of a grouped
-- counter over a store that holds no such row yet; present-but-not-a-number is NULL so the callers below can
-- say "this path is the wrong shape" rather than silently adding zero to a comparison.
CREATE FUNCTION pg_temp.s11h_val(p_tag text, p_path text[]) RETURNS numeric
LANGUAGE sql STABLE AS $fn$
  SELECT CASE
           WHEN pg_temp.s11h_snap(p_tag) #> p_path IS NULL THEN 0::numeric
           WHEN jsonb_typeof(pg_temp.s11h_snap(p_tag) #> p_path) = 'number'
             THEN (pg_temp.s11h_snap(p_tag) #>> p_path)::numeric
         END $fn$;

-- A grouped counter's whole answer, summed. The arithmetic-partition cells refuse to compare three plausible
-- numbers and instead require them to close over the total. Non-number members (`newest_at`) are skipped
-- rather than cast, because a partition identity is about the counts. A path that is *not* a grouped object
-- raises instead of returning zero: silently summing a scalar to zero is how a partition cell would pass by
-- never having measured anything.
CREATE FUNCTION pg_temp.s11h_sum(p_tag text, p_path text[]) RETURNS numeric
LANGUAGE plpgsql STABLE AS $fn$
DECLARE v jsonb; s numeric;
BEGIN
  v := pg_temp.s11h_snap(p_tag) #> p_path;
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'FAIL: % is % in the answer, not a grouped object that can be summed',
      array_to_string(p_path, '.'), coalesce(jsonb_typeof(v), 'absent');
  END IF;
  SELECT coalesce(sum((e.val #>> '{}')::numeric), 0::numeric) INTO s
    FROM jsonb_each(v) AS e(k, val) WHERE jsonb_typeof(e.val) = 'number';
  RETURN s;
END $fn$;

-- The delta of one numeric path between two captured answers. A missing path reads as zero on both sides,
-- which is the honest reading of a grouped counter over a store that holds no such row yet; a path that is
-- present but not a number is a failure, not a zero.
CREATE FUNCTION pg_temp.s11h_delta(label text, p_taga text, p_tagb text, p_path text[], p_want numeric)
RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_a numeric; v_b numeric; v_got numeric;
BEGIN
  v_a := pg_temp.s11h_val(p_taga, p_path);
  v_b := pg_temp.s11h_val(p_tagb, p_path);
  IF v_a IS NULL OR v_b IS NULL THEN
    RAISE EXCEPTION 'FAIL %: % is not a number in one of the two answers (a: % b: %)',
      label, array_to_string(p_path, '.'), v_a, v_b;
  END IF;
  v_got := v_a - v_b;
  IF v_got <> p_want THEN
    RAISE EXCEPTION 'FAIL %: % moved by % (want %), from % to %',
      label, array_to_string(p_path, '.'), v_got, p_want, v_b, v_a;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11h_dl(label text, p_path text[], p_want numeric) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_temp.s11h_delta(label, 'w24', 'base', p_path, p_want);
END $fn$;

-- The window-sensitivity form. Two post-plant answers at two windows cannot be subtracted directly: a row a
-- neighbour battery left is inside one window and outside the other, and its contribution is not something
-- this file knows. So the plant's own effect is the *difference of the two deltas* — what the window pair
-- measured after the plants, minus what the same window pair measured before them. Each half is a plain
-- delta against a baseline captured at that same window, which is why `base`, `b1` and `b720` all exist.
CREATE FUNCTION pg_temp.s11h_xd(label text, p_path text[], p_want numeric) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_got numeric;
BEGIN
  v_got := (pg_temp.s11h_val('w24', p_path) - pg_temp.s11h_val('w1', p_path))
        - (pg_temp.s11h_val('base', p_path) - pg_temp.s11h_val('b1', p_path));
  IF v_got IS NULL THEN
    RAISE EXCEPTION 'FAIL %: % is not a number in one of the four answers', label,
      array_to_string(p_path, '.');
  END IF;
  IF v_got <> p_want THEN
    RAISE EXCEPTION 'FAIL %: the hour/day boundary for % moved by % (want %)', label,
      array_to_string(p_path, '.'), v_got, p_want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11h_eqs(label text, p_tag text, p_path text[], p_want text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF pg_temp.s11h_txt(p_tag, p_path) IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION 'FAIL %: % is [%] want [%]', label, array_to_string(p_path, '.'),
      coalesce(pg_temp.s11h_txt(p_tag, p_path), '(not a string or absent)'), p_want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

-- --------------------------------------------------------------------------- the digests
-- Every store the projection can reach, plus the four it must not touch. `row_to_json` is used rather than a
-- column list because a hand-written list is the one place a digest can silently drop the column that moves.
CREATE FUNCTION pg_temp.s11h_d(p_tbl text) RETURNS text
LANGUAGE plpgsql STABLE AS $fn$
DECLARE v text;
BEGIN
  EXECUTE 'SELECT md5(coalesce(string_agg(x, ''~'' ORDER BY x), ''<empty>'')) '
       || 'FROM (SELECT row_to_json(t)::text AS x FROM ' || p_tbl || ' t) s'
    INTO v;
  RETURN v;
END $fn$;

CREATE FUNCTION pg_temp.s11h_digs() RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_object_agg(t.tbl, pg_temp.s11h_d(t.tbl))
    FROM (VALUES ('public.weddings'), ('public.invitation_versions'), ('public.publications'),
                 ('public.guest_households'), ('public.entitlements'), ('public.invitation_outputs'),
                 ('private.access_tokens'), ('private.commerce_payment_events'),
                 ('private.commerce_orders'), ('private.commerce_refunds'),
                 ('private.commerce_review_notes'), ('private.audit_events'),
                 ('private.support_cases'), ('private.support_case_events'),
                 ('private.privacy_requests'), ('private.operator_grants'),
                 ('storage.objects'), ('auth.users')) t(tbl) $fn$;

-- --------------------------------------------------------------------------- the artefact lifecycle walk
-- A registered row is the only shape a plant may insert, so the six artefacts this battery counts are walked
-- through the guard's own edges rather than written into the states. Entering `failed` is exactly one attempt
-- plus one named reason, so a row at the ceiling has been through the cycle five times like any real one.
CREATE FUNCTION pg_temp.s11h_ready(p_id uuid, p_tag text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE public.invitation_outputs SET status = 'uploading' WHERE id = p_id;
  UPDATE public.invitation_outputs
     SET status = 'ready', content_digest = pg_temp.s11h_h64('s11h-bytes-' || p_tag)
   WHERE id = p_id;
END $fn$;

CREATE FUNCTION pg_temp.s11h_fail(p_id uuid, p_times integer, p_err text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE i integer;
BEGIN
  FOR i IN 1..p_times LOOP
    UPDATE public.invitation_outputs SET status = 'uploading' WHERE id = p_id;
    UPDATE public.invitation_outputs
       SET status = 'failed', attempt_count = attempt_count + 1, last_error = p_err
     WHERE id = p_id;
  END LOOP;
END $fn$;

CREATE FUNCTION pg_temp.s11h_retire(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE public.invitation_outputs SET status = 'invalidated', invalidation_reason = p_reason
   WHERE id = p_id;
END $fn$;

-- The digests this schema demands are 64 hex characters and `md5` answers 32, so one more md5 is appended
-- rather than the shape being loosened. Every digest below is spelled from a label, so a re-run of the same
-- battery on the same chain produces the same fixture bytes and two runs can be diffed.
CREATE FUNCTION pg_temp.s11h_h64(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5(p) || md5(p || '::s11h') $fn$;

-- --------------------------------------------------------------------------- the cast
-- Five accounts and two weddings. Everything here is planted by the superuser because that is the only hand
-- that can build a fixture faster than a read-only projection can be talked into producing it, and every
-- plant is the shape a real product path would leave behind — taken from this chain's CHECKs and triggers,
-- which group P then measures.
CREATE TEMP TABLE s11h_cast ON COMMIT DROP AS
SELECT gen_random_uuid() AS op_a, gen_random_uuid() AS op_x, gen_random_uuid() AS op_r,
       gen_random_uuid() AS sup_a, gen_random_uuid() AS ghost, gen_random_uuid() AS host_1,
       gen_random_uuid() AS host_2,
       gen_random_uuid() AS w1, gen_random_uuid() AS w2,
       gen_random_uuid() AS v1, gen_random_uuid() AS v2,
       gen_random_uuid() AS pub1, gen_random_uuid() AS pub2, gen_random_uuid() AS pub3,
       gen_random_uuid() AS hh1, gen_random_uuid() AS hh2, gen_random_uuid() AS hh3,
       gen_random_uuid() AS t1, gen_random_uuid() AS t2, gen_random_uuid() AS t3,
       gen_random_uuid() AS t4, gen_random_uuid() AS t5, gen_random_uuid() AS t6,
       gen_random_uuid() AS t7, gen_random_uuid() AS t8,
       gen_random_uuid() AS o1, gen_random_uuid() AS o2, gen_random_uuid() AS o3,
       gen_random_uuid() AS o4, gen_random_uuid() AS o5, gen_random_uuid() AS o6,
       gen_random_uuid() AS ent1, gen_random_uuid() AS ord1, gen_random_uuid() AS ord2,
       gen_random_uuid() AS ord3,
       gen_random_uuid() AS rf1, gen_random_uuid() AS rf2, gen_random_uuid() AS rf3,
       gen_random_uuid() AS rf4,
       gen_random_uuid() AS cs1, gen_random_uuid() AS cs2, gen_random_uuid() AS cs3,
       gen_random_uuid() AS cs4,
       gen_random_uuid() AS pr1, gen_random_uuid() AS pr2;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT c.op_a,   's11h-op-a@stage11qual.test',    '{}'::jsonb FROM s11h_cast c
UNION ALL SELECT c.op_x,   's11h-op-x@stage11qual.test',    '{}'::jsonb FROM s11h_cast c
UNION ALL SELECT c.op_r,   's11h-op-r@stage11qual.test',    '{}'::jsonb FROM s11h_cast c
UNION ALL SELECT c.sup_a,  's11h-sup-a@stage11qual.test',   '{}'::jsonb FROM s11h_cast c
UNION ALL SELECT c.ghost,  's11h-ghost@stage11qual.test',   '{}'::jsonb FROM s11h_cast c
UNION ALL SELECT c.host_1, 's11h-host-1@stage11qual.test',  '{}'::jsonb FROM s11h_cast c
UNION ALL SELECT c.host_2, 's11h-host-2@stage11qual.test',  '{}'::jsonb FROM s11h_cast c;

-- The four authority shapes group A argues about, three of them minted through slice 1's trusted doors and all
-- finished before the baseline answer is read, so the baseline is a state this file understands rather than an
-- inheritance it has to guess at. `op_r`'s grant is revoked through the same door.
CREATE TEMP TABLE s11h_g ON COMMIT DROP AS
SELECT pg_temp.s11h_grant(c.op_a,  'operations', 'stage11 slice-5 battery reader', c.host_1, NULL) AS a1,
       pg_temp.s11h_grant(c.op_r,  'operations', 'revoked below',                  c.host_1, NULL) AS a3,
       pg_temp.s11h_grant(c.sup_a, 'support',    'wrong-scope control',            c.host_1, NULL) AS a4
  FROM s11h_cast c;

SELECT pg_temp.s11h_revoke((SELECT op_r FROM s11h_cast), 'operations',
                           'revoked so a stale grant is a measured shape', (SELECT host_1 FROM s11h_cast));

-- The fourth shape is the one no door will mint: `operator_role_grant` refuses a past expiry, so the row
-- whose status still says `active` while its window has closed is planted by hand with a back-dated grant,
-- exactly as slice 1's T11 plants it. The same shape cannot be reached afterwards by an UPDATE either — the
-- table requires `expires_at > granted_at` and this transaction's `now()` is one constant, so moving the
-- expiry into the past leaves it before the grant instant the door just stamped.
INSERT INTO private.operator_grants (user_id, scope, status, reason, granted_by_user_id,
                                     granted_at, expires_at)
SELECT c.op_x, 'operations', 'active', 'Battery 5 plant: a grant whose window has already closed.',
       c.host_1, now() - interval '2 days', now() - interval '1 hour' FROM s11h_cast c;

INSERT INTO s11h_reg (tag, id)
SELECT 'op_a', c.op_a FROM s11h_cast c
UNION ALL SELECT 'op_x', c.op_x FROM s11h_cast c
UNION ALL SELECT 'op_r', c.op_r FROM s11h_cast c
UNION ALL SELECT 'sup_a', c.sup_a FROM s11h_cast c
UNION ALL SELECT 'ghost', c.ghost FROM s11h_cast c
UNION ALL SELECT 'host_1', c.host_1 FROM s11h_cast c
UNION ALL SELECT 'host_2', c.host_2 FROM s11h_cast c
UNION ALL SELECT 'w1', c.w1 FROM s11h_cast c
UNION ALL SELECT 'w2', c.w2 FROM s11h_cast c;

-- ===========================================================================
-- 1. The answer before this file plants anything, so every liveness cell below is a measured delta.
--    Three windows, not one: the plants move a row across the hour/day boundary, and the rows this chain
--    already carries move across it too. `base`, `b1` and `b720` are the same door read at the three
--    windows the assertions below use, which is what makes the boundary claim a difference of differences
--    rather than a coincidence about what a neighbour battery happened to leave behind.
-- ===========================================================================
INSERT INTO s11h_s (tag, a)
SELECT 'base', pg_temp.s11h_must('B0 the same door that refuses a stranger answers a live operations grant',
                                 'authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
                                 'SELECT api.operator_operations_summary(24)')
UNION ALL SELECT 'b1', pg_temp.s11h_must('B0b the same door at the one-hour boundary, before any plant',
                                         'authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
                                         'SELECT api.operator_operations_summary(1)')
UNION ALL SELECT 'b720', pg_temp.s11h_must('B0c the same door at the thirty-day boundary, before any plant',
                                           'authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
                                           'SELECT api.operator_operations_summary(720)');

-- ===========================================================================
-- 2. The plants. Two weddings and the whole operational shape a real deployment would have on the morning
--    this screen is opened: three publications — each wedding's live row plus one wedding's retired
--    predecessor —, eight credentials spanning every class the partition can hold, six artefacts across the
--    five lifecycle states and both sides of the attempt ceiling, three orders, four refunds and one review
--    note, six payment events across all five processing statuses, four tickets in four states, a thread that
--    links an audit row to a case and one that does not, two privacy requests, and four audit rows in three
--    actor kinds.
-- ===========================================================================
INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages,
                             style_settings)
SELECT c.w1, c.host_1, 'S11h health wedding one', 'en', ARRAY[]::text[], '{}'::jsonb FROM s11h_cast c
UNION ALL SELECT c.w2, c.host_2, 'S11h health wedding two', 'en', ARRAY[]::text[], '{}'::jsonb
  FROM s11h_cast c;

INSERT INTO public.invitation_versions (id, wedding_id, version_number, snapshot,
                                        snapshot_schema_version, created_by)
SELECT c.v1, c.w1, 3, '{}'::jsonb, 1, c.host_1 FROM s11h_cast c
UNION ALL SELECT c.v2, c.w2, 3, '{}'::jsonb, 1, c.host_2 FROM s11h_cast c;

-- Three publications, and the shape they are allowed to take is set by `one_active_publication_per_wedding`
-- (measured from this chain's `pg_get_indexdef`, group P prints it): a wedding may be *re*published, so it may
-- hold one live row and any number of retired ones, but never two live rows. `pub1` and `pub2` therefore sit on
-- one wedding, which is what makes `weddings_with_active_publication` count weddings rather than rows; `pub2`
-- was retired inside the hour against a publication that went live inside it too, while `pub3` went live
-- outside the hour and inside the day, so `published_in_window` and `revoked_in_window` are shown to be counts
-- of different rows rather than one number printed twice.
INSERT INTO public.publications (id, wedding_id, version_id, status, published_at, revoked_at)
SELECT c.pub1, c.w1, c.v1, 'active',  now() - interval '30 minutes', NULL::timestamptz FROM s11h_cast c
UNION ALL SELECT c.pub2, c.w1, c.v1, 'revoked', now() - interval '200 hours',
       now() - interval '30 minutes' FROM s11h_cast c
UNION ALL SELECT c.pub3, c.w2, c.v2, 'active', now() - interval '3 hours', NULL FROM s11h_cast c;

-- Three households on two weddings. `guest_households` is a store the answer reaches only through the
-- credential block's grouping, never as a list, and the third household is what lets two live guest
-- credentials coexist under Stage 8's per-household index.
INSERT INTO public.guest_households (id, wedding_id, display_name)
SELECT c.hh1, c.w1, 'S11h household one' FROM s11h_cast c
UNION ALL SELECT c.hh2, c.w2, 'S11h household two' FROM s11h_cast c
UNION ALL SELECT c.hh3, c.w2, 'S11h household three' FROM s11h_cast c;

-- Eight credentials, and the only eight shapes the two partial unique indexes let coexist on two weddings.
-- The partition's three classes are all present and close over the store: five live (`t1`, `t2`, `t5`, `t6`,
-- `t7`), one expired (`t4`), two revoked (`t3`, `t8`). The two usage observations overlap those classes rather
-- than forming a fourth: four have never been used (`t2`, `t4`, `t5`, `t7`), three were used inside the day
-- (`t1`, `t6`, `t8`), of which two were used inside the hour (`t1`, `t6`), and one was used before the day
-- (`t3`). The shapes are the ones a console has to distinguish: a revoked row that also carries a *future*
-- expiry (`t8`, where revocation must win the classification and `expired` must not double-count it), an
-- expired row whose expiry still follows its own creation (`t4`, which `access_tokens_check1` requires), a
-- credential that has sat unused for four days (`t7`, which moves `newest_at` not at all), and an rsvp revoked
-- on the very household that also holds a live guest credential (`t3` against `t2` on `hh1`) — the pair the
-- indexes exist to allow.
--
-- `t1` and `t8` share `pub1`, and `t4` is the second unrevoked public token in the set: it sits on `pub2`,
-- which Stage 3's `one_live_public_token_per_publication` permits because that index is keyed on the
-- publication, not the wedding, and which the revoked state of `pub2` does not forbid either — a retired
-- publication can still hold a live link, and the screen has to say so. `t5` and `t7` share `hh2` because the
-- household index is keyed on `token_kind`, and `t2`/`t6`/`t7` are the three live guest tokens the
-- per-household predicate allows on three households.
INSERT INTO private.access_tokens (id, token_hash, token_kind, wedding_id, publication_id, household_id,
                                   expiry_policy, expires_at, revoked_at, last_used_at, created_at)
SELECT c.t1, pg_temp.s11h_h64('s11h-token-1'), 'public_invitation', c.w1, c.pub1, NULL,
       'no_expiry', NULL::timestamptz, NULL::timestamptz, now(), now() FROM s11h_cast c
UNION ALL SELECT c.t2, pg_temp.s11h_h64('s11h-token-2'), 'guest_invitation', c.w1, c.pub1, c.hh1,
       'fixed', now() + interval '30 days', NULL, NULL, now() - interval '1 hour' FROM s11h_cast c
UNION ALL SELECT c.t3, pg_temp.s11h_h64('s11h-token-3'), 'rsvp', c.w1, c.pub2, c.hh1,
       'no_expiry', NULL, now() - interval '1 hour', now() - interval '100 hours',
       now() - interval '110 hours' FROM s11h_cast c
UNION ALL SELECT c.t4, pg_temp.s11h_h64('s11h-token-4'), 'public_invitation', c.w1, c.pub2, NULL,
       'fixed', now() - interval '1 hour', NULL, NULL, now() - interval '2 hours' FROM s11h_cast c
UNION ALL SELECT c.t5, pg_temp.s11h_h64('s11h-token-5'), 'rsvp', c.w2, c.pub3, c.hh2,
       'fixed', now() + interval '30 days', NULL, NULL, now() FROM s11h_cast c
UNION ALL SELECT c.t6, pg_temp.s11h_h64('s11h-token-6'), 'guest_invitation', c.w2, c.pub3, c.hh3,
       'no_expiry', NULL, NULL, now() - interval '10 minutes', now() FROM s11h_cast c
UNION ALL SELECT c.t7, pg_temp.s11h_h64('s11h-token-7'), 'guest_invitation', c.w2, c.pub3, c.hh2,
       'no_expiry', NULL, NULL, NULL, now() - interval '100 hours' FROM s11h_cast c
UNION ALL SELECT c.t8, pg_temp.s11h_h64('s11h-token-8'), 'public_invitation', c.w1, c.pub1, NULL,
       'fixed', now() + interval '1 hour', now() - interval '30 minutes', now() - interval '3 hours',
       now() - interval '4 days' FROM s11h_cast c;

-- Six artefacts: one that never left registration, one mid-upload, one ready, one failed at the ceiling and
-- one failed below it, and one retired after it was ready. The first is the shape §9's stuck-queue number
-- must not count, and the pair of failures is what makes `failed_at_attempt_ceiling` a measurement rather
-- than a synonym for `failed`.
INSERT INTO public.invitation_outputs (id, wedding_id, version_id, output_kind, variant, format,
                                       render_config_hash, source_dto_digest, storage_domain)
SELECT c.o1, c.w1, c.v1, 'pdf',         'a4',       'pdf',  pg_temp.s11h_h64('s11h-cfg-o1'),
       pg_temp.s11h_h64('s11h-dto-o1'), 'host_private' FROM s11h_cast c
UNION ALL SELECT c.o2, c.w1, c.v1, 'og_image', '1200x630', 'webp', pg_temp.s11h_h64('s11h-cfg-o2'),
       pg_temp.s11h_h64('s11h-dto-o2'), 'host_private' FROM s11h_cast c
UNION ALL SELECT c.o3, c.w1, c.v1, 'share_image', '1080x1350', 'png', pg_temp.s11h_h64('s11h-cfg-o3'),
       pg_temp.s11h_h64('s11h-dto-o3'), 'host_private' FROM s11h_cast c
UNION ALL SELECT c.o4, c.w1, c.v1, 'pdf', 'letter', 'pdf', pg_temp.s11h_h64('s11h-cfg-o4'),
       pg_temp.s11h_h64('s11h-dto-o4'), 'host_private' FROM s11h_cast c
UNION ALL SELECT c.o5, c.w1, c.v1, 'share_image', '1080x1620', 'png', pg_temp.s11h_h64('s11h-cfg-o5'),
       pg_temp.s11h_h64('s11h-dto-o5'), 'host_private' FROM s11h_cast c
UNION ALL SELECT c.o6, c.w2, c.v2, 'og_image', '1200x630', 'webp', pg_temp.s11h_h64('s11h-cfg-o6'),
       pg_temp.s11h_h64('s11h-dto-o6'), 'host_private' FROM s11h_cast c;

SELECT pg_temp.s11h_ready(o.id, 'o2') FROM public.invitation_outputs o
 WHERE o.version_id = (SELECT v1 FROM s11h_cast) AND o.variant = '1200x630';
SELECT pg_temp.s11h_ready(o.id, 'o3') FROM public.invitation_outputs o
 WHERE o.version_id = (SELECT v1 FROM s11h_cast) AND o.variant = '1080x1350';
SELECT pg_temp.s11h_ready(o.id, 'o6') FROM public.invitation_outputs o
 WHERE o.version_id = (SELECT v2 FROM s11h_cast);
SELECT pg_temp.s11h_fail(o.id, 5, 'S11h render refusal: the page box was refused')
  FROM public.invitation_outputs o
 WHERE o.version_id = (SELECT v1 FROM s11h_cast) AND o.variant = 'letter';
SELECT pg_temp.s11h_fail(o.id, 2, 'S11h render refusal: the page box was refused')
  FROM public.invitation_outputs o
 WHERE o.version_id = (SELECT v1 FROM s11h_cast) AND o.variant = '1080x1620';
SELECT pg_temp.s11h_retire(o.id, 'publication_revoked') FROM public.invitation_outputs o
 WHERE o.version_id = (SELECT v2 FROM s11h_cast);

INSERT INTO public.entitlements (id, wedding_id, package_code, source, granted_at)
SELECT c.ent1, c.w1, 'classic', 'service', now() - interval '3 days' FROM s11h_cast c;

INSERT INTO private.commerce_orders (id, wedding_id, owner_user_id, merchant_reference, package_code,
                                     price_version, amount_minor, currency, status, quote_expires_at,
                                     captured_at, closed_at, entitlement_id)
SELECT c.ord1, c.w1, c.host_1, 's11h-merchant-ord1', 'classic', 1, 150000, 'INR', 'captured',
       now() + interval '1 day', now() - interval '3 days', NULL::timestamptz, c.ent1 FROM s11h_cast c
UNION ALL SELECT c.ord2, c.w1, c.host_1, 's11h-merchant-ord2', 'premium', 1, 300000, 'INR', 'open',
       now() + interval '1 day', NULL, NULL, NULL FROM s11h_cast c
UNION ALL SELECT c.ord3, c.w2, c.host_2, 's11h-merchant-ord3', 'classic', 1, 150000, 'INR', 'expired',
       now() - interval '9 days', NULL, now() - interval '8 days', NULL FROM s11h_cast c;

-- Four refunds, one per status the queue's own vocabulary admits. The recorded one earns the only review
-- note, which is what makes `without_review_note` a count of the other three rather than a synonym for
-- `total`.
INSERT INTO private.commerce_refunds (id, order_id, kind, status, amount_minor, currency,
                                      provider_refund_ref, recorded_at, completed_at)
SELECT c.rf1, c.ord1, 'refund',     'recorded',  50000, 'INR', NULL,          now() - interval '6 hours',
       NULL::timestamptz FROM s11h_cast c
UNION ALL SELECT c.rf2, c.ord1, 'refund',     'succeeded', 20000, 'INR', 's11h-refund-ref-2',
       now() - interval '5 hours', now() - interval '4 hours' FROM s11h_cast c
UNION ALL SELECT c.rf3, c.ord1, 'refund',     'failed',    10000, 'INR', 's11h-refund-ref-3',
       now() - interval '4 hours', NULL FROM s11h_cast c
UNION ALL SELECT c.rf4, c.ord1, 'chargeback', 'reversed',  150000, 'INR', 's11h-refund-ref-4',
       now() - interval '3 hours', NULL FROM s11h_cast c;

INSERT INTO s11h_key (tag, k) VALUES ('note1', gen_random_uuid()), ('link1', gen_random_uuid());

-- Six events, one per processing status and a second on the reconciliation hold. `rejected_signature` is the
-- only status whose signature flag the schema pins to `false` by equality, so the other five must all claim a
-- valid signature; `duplicate` is the one delivered outside the day, which is what makes `events_in_window` a
-- measurement of the window rather than a copy of `events_total`. Two holds share one reason so
-- `held_by_reason` is exercised as a grouping, not as a list of singletons.
INSERT INTO private.commerce_payment_events (provider, event_id, event_type, kind, environment, order_id,
                                             merchant_reference, amount_minor, currency, raw_body_sha256,
                                             signature_valid, refusal_reason, hold_reason, processing_status,
                                             applied_effect, received_at)
SELECT 'razorpay', 's11h-event-applied', 'payment_captured', 'payment_captured', 'synthetic', c.ord1,
       's11h-merchant-ord1', 150000, 'INR', pg_temp.s11h_h64('s11h-body-1'),
       true, NULL, NULL, 'applied', 'order_captured', now() - interval '3 hours' FROM s11h_cast c
UNION ALL SELECT 'razorpay', 's11h-event-dup', 'payment_captured', 'payment_captured', 'synthetic', c.ord1,
       's11h-merchant-ord1', 150000, 'INR', pg_temp.s11h_h64('s11h-body-2'),
       true, NULL, NULL, 'duplicate', NULL, now() - interval '100 hours' FROM s11h_cast c
UNION ALL SELECT 'cashfree', 's11h-event-reject', 'payment_failed', 'payment_failed', 'synthetic', c.ord2,
       's11h-merchant-ord2', 300000, 'INR', pg_temp.s11h_h64('s11h-body-3'),
       false, 'S11h signature refusal', NULL, 'rejected_signature', NULL, now() - interval '2 hours'
  FROM s11h_cast c
UNION ALL SELECT 'cashfree', 's11h-event-hold-1', 'other', 'other', 'synthetic', c.ord1,
       's11h-merchant-ord1', 50000, 'INR', pg_temp.s11h_h64('s11h-body-4'),
       true, NULL, 's11h_hold_amount_mismatch', 'held_for_reconciliation', NULL, now() - interval '1 hour'
  FROM s11h_cast c
UNION ALL SELECT 'razorpay', 's11h-event-hold-2', 'other', 'other', 'synthetic', c.ord1,
       's11h-merchant-ord1', 20000, 'INR', pg_temp.s11h_h64('s11h-body-5'),
       true, NULL, 's11h_hold_amount_mismatch', 'held_for_reconciliation', NULL, now() FROM s11h_cast c
UNION ALL SELECT 'razorpay', 's11h-event-stale', 'refund_failed', 'refund_failed', 'synthetic', c.ord1,
       's11h-merchant-ord1', 10000, 'INR', pg_temp.s11h_h64('s11h-body-6'),
       true, NULL, NULL, 'stale', NULL, now() - interval '4 hours' FROM s11h_cast c;

-- Four tickets in four states: one live and unclaimed since before the day, one triaged and claimed, one in
-- progress on the other wedding, and one resolved inside the window. `aged_outside_window` and
-- `unclaimed_live` are the two counters a queue screen is opened for, and each needs a row that the others do
-- not satisfy.
INSERT INTO private.support_cases (id, wedding_id, requester_user_id, opened_by_user_id, category, severity,
                                   status, host_summary, assigned_operator_user_id, resolution_code,
                                   resolved_at, opened_at)
SELECT c.cs1, c.w1, c.host_1, c.host_1, 'publication_delivery',   'normal', 'open',
       'S11h host summary sentence', NULL::uuid, NULL::text, NULL::timestamptz, now() - interval '100 hours'
  FROM s11h_cast c
UNION ALL SELECT c.cs2, c.w1, c.host_1, c.host_1, 'publication_delivery', 'high', 'triaged',
       'S11h host summary two', c.op_a, NULL, NULL, now() - interval '5 hours' FROM s11h_cast c
UNION ALL SELECT c.cs3, c.w2, c.host_2, c.host_2, 'billing_refund_inquiry', 'normal', 'in_progress',
       'S11h host summary three', c.op_a, NULL, NULL, now() - interval '6 hours' FROM s11h_cast c
UNION ALL SELECT c.cs4, c.w1, c.host_1, c.host_1, 'publication_delivery', 'normal', 'resolved',
       'S11h host summary four', c.op_a, 'resolved_by_operator', now(), now() - interval '5 hours'
  FROM s11h_cast c;

-- The thread that carries the link this projection counts. `ce1` is the case event whose uuid idempotency key
-- matches an operator audit row, and `ce2` is a host message whose prose must never reach the answer.
INSERT INTO private.support_case_events (case_id, kind, actor_user_id, actor_kind, body, idempotency_key)
SELECT c.cs2, 'operation_link', c.op_a, 'operator', NULL, k.k FROM s11h_cast c
  JOIN s11h_key k ON k.tag = 'link1'
UNION ALL SELECT c.cs1, 'message_host', c.host_1, 'host',
       'S11h case thread body that must stay inside its own row', NULL FROM s11h_cast c;

INSERT INTO private.commerce_review_notes (refund_id, case_ref, author_user_id, kind, note, idempotency_key)
SELECT c.rf1, s.case_ref, c.op_a, 'in_review',
       'S11h note prose for a refund that must stay in the note row', k.k
  FROM s11h_cast c
  JOIN private.support_cases s ON s.id = c.cs2
  JOIN s11h_key k ON k.tag = 'note1';

INSERT INTO private.privacy_requests (id, wedding_id, requester_user_id, kind, status, host_note,
                                      requested_at)
SELECT c.pr1, c.w1, c.host_1, 'export', 'received', 'S11h privacy host note',
       now() - interval '100 hours' FROM s11h_cast c
UNION ALL SELECT c.pr2, c.w2, c.host_2, 'erasure', 'queued_for_stage13', 'S11h privacy host note two',
       now() - interval '2 hours' FROM s11h_cast c;

-- Four trail rows in three actor kinds. Two are operator rows, and they are the pair decision 7 exists for:
-- `a1` names a uuid key that a case event also names, so it is linked, while `a2`'s key is a string
-- `audit_events` legally permits and `support_case_events` cannot hold, so it is unlinked. The naive join —
-- casting the audit column instead of widening the case column — raises `22P02` on this row, and group L
-- measures that this projection answered anyway.
INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, actor_kind,
                                  reason, idempotency_key, created_at)
SELECT c.w1, 'support_case', c.cs2, 's11hxq_operate_linked', c.op_a, 'operator',
       'S11h operator reason sentence', k.k::text, now() FROM s11h_cast c
  JOIN s11h_key k ON k.tag = 'link1'
UNION ALL SELECT c.w1, 'support_case', c.cs1, 's11hxq_operate_stray', c.op_a, 'operator',
       'S11h operator reason sentence two', 's11hxq-not-a-uuid-but-a-legal-audit-key',
       now() - interval '30 minutes' FROM s11h_cast c
UNION ALL SELECT c.w1, 'wedding', c.w1, 's11hxq_host_opened', c.host_1, 'host',
       'S11h host reason sentence', NULL, now() - interval '90 minutes' FROM s11h_cast c
UNION ALL SELECT c.w1, 'wedding', c.w1, 's11hxq_system_row', NULL, 'system',
       NULL, NULL, now() - interval '100 hours' FROM s11h_cast c;

-- ===========================================================================
-- 3. The strings this battery then requires the answer not to contain, read back from the rows rather than
--    re-typed, so a plant and its absence check cannot drift apart. Identifiers are the ids the projection
--    promises to keep out; prose is the free text it promises to group rather than quote.
-- ===========================================================================
INSERT INTO s11h_needle (tag, v)
SELECT 'wedding',        (SELECT w1::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'wedding_two',  (SELECT w2::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'title',        'S11h health wedding one' FROM s11h_cast
UNION ALL SELECT 'publication',  (SELECT pub1::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'version',      (SELECT v1::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'token',        (SELECT t1::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'token_hash',   pg_temp.s11h_h64('s11h-token-1') FROM s11h_cast
UNION ALL SELECT 'household',    (SELECT hh1::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'house_two',    (SELECT hh2::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'house_three',  (SELECT hh3::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'house_name',   h.display_name FROM public.guest_households h
 WHERE h.id = (SELECT hh1 FROM s11h_cast)
UNION ALL SELECT 'house_name_two', h.display_name FROM public.guest_households h
 WHERE h.id = (SELECT hh2 FROM s11h_cast)
UNION ALL SELECT 'house_name_three', h.display_name FROM public.guest_households h
 WHERE h.id = (SELECT hh3 FROM s11h_cast)
UNION ALL SELECT 'publication_two', (SELECT pub2::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'publication_three', (SELECT pub3::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'token_eight',  (SELECT t8::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'token_hash_six', pg_temp.s11h_h64('s11h-token-6') FROM s11h_cast
UNION ALL SELECT 'output',       (SELECT o1::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'object_key',   o.object_key FROM public.invitation_outputs o
 WHERE o.id = (SELECT o1 FROM s11h_cast)
UNION ALL SELECT 'last_error',   'S11h render refusal: the page box was refused' FROM s11h_cast
UNION ALL SELECT 'entitlement',  (SELECT ent1::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'order',        (SELECT ord1::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'merchant_ref', 's11h-merchant-ord1' FROM s11h_cast
UNION ALL SELECT 'refund',       (SELECT rf1::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'refund_ref',   's11h-refund-ref-2' FROM s11h_cast
UNION ALL SELECT 'note_prose',   'S11h note prose for a refund that must stay in the note row'
  FROM s11h_cast
UNION ALL SELECT 'event_id',     's11h-event-applied' FROM s11h_cast
UNION ALL SELECT 'case',         (SELECT cs1::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'case_ref',     s.case_ref FROM private.support_cases s WHERE s.id = (SELECT cs1 FROM s11h_cast)
UNION ALL SELECT 'host_summary', 'S11h host summary sentence' FROM s11h_cast
UNION ALL SELECT 'thread_body',  'S11h case thread body that must stay inside its own row' FROM s11h_cast
UNION ALL SELECT 'request',      (SELECT pr1::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'request_ref',  r.request_ref FROM private.privacy_requests r
 WHERE r.id = (SELECT pr1 FROM s11h_cast)
UNION ALL SELECT 'request_note', 'S11h privacy host note' FROM s11h_cast
UNION ALL SELECT 'audit_action', 's11hxq_operate_linked' FROM s11h_cast
UNION ALL SELECT 'audit_reason', 'S11h operator reason sentence' FROM s11h_cast
UNION ALL SELECT 'audit_key',    's11hxq-not-a-uuid-but-a-legal-audit-key' FROM s11h_cast
UNION ALL SELECT 'account_op',   (SELECT op_a::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'account_host', (SELECT host_1::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'email',        's11h-host-1@stage11qual.test' FROM s11h_cast;

-- Read back rather than re-typed: the first of these is minted by a trigger (`support_cases.case_ref` for the
-- linked ticket), and a needle copied from a comment is a needle that can be satisfied by accident.
INSERT INTO s11h_needle (tag, v)
SELECT 'case_ref_linked', s.case_ref FROM private.support_cases s WHERE s.id = (SELECT cs2 FROM s11h_cast)
UNION ALL SELECT 'order_two',    (SELECT ord2::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'merchant_two', 's11h-merchant-ord2' FROM s11h_cast
UNION ALL SELECT 'event_hold',   's11h-event-hold-1' FROM s11h_cast
UNION ALL SELECT 'account_ghost', (SELECT ghost::text FROM s11h_cast) FROM s11h_cast
UNION ALL SELECT 'account_op_revoked', (SELECT op_r::text FROM s11h_cast) FROM s11h_cast;

-- The rows group P and the delta groups need to name again. The weddings, accounts and version are already
-- registered above, so this half registers only what the plants themselves created.
INSERT INTO s11h_reg (tag, id)
SELECT 'v1', c.v1 FROM s11h_cast c
UNION ALL SELECT 'pub1', c.pub1 FROM s11h_cast c
UNION ALL SELECT 'pub2', c.pub2 FROM s11h_cast c
UNION ALL SELECT 'hh1', c.hh1 FROM s11h_cast c
UNION ALL SELECT 'hh3', c.hh3 FROM s11h_cast c
UNION ALL SELECT 'rf1', c.rf1 FROM s11h_cast c
UNION ALL SELECT 'cs1', c.cs1 FROM s11h_cast c
UNION ALL SELECT 'cs2', c.cs2 FROM s11h_cast c
UNION ALL SELECT 'pr1', c.pr1 FROM s11h_cast c
UNION ALL SELECT 'o1', c.o1 FROM s11h_cast c
UNION ALL SELECT 'o4', c.o4 FROM s11h_cast c;

-- ===========================================================================
-- 4. The same door, read again after the plants, at three windows. Every liveness cell below is a delta
--    against answer `base`, and every window-sensitivity cell is a delta between two of these.
-- ===========================================================================
INSERT INTO s11h_s (tag, a)
SELECT 'w24', pg_temp.s11h_must('S1 the operations grant still reads the summary after the plants',
                                'authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
                                'SELECT api.operator_operations_summary(24)')
UNION ALL SELECT 'w1', pg_temp.s11h_must('S2 the one-hour window is accepted',
                                'authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
                                'SELECT api.operator_operations_summary(1)')
UNION ALL SELECT 'w720', pg_temp.s11h_must('S3 the thirty-day window is accepted',
                                'authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
                                'SELECT api.operator_operations_summary(720)');

-- ===========================================================================
-- APPEND POINT
-- ===========================================================================

-- Two more readers, because the absence group and the arithmetic group both need the answer as one string
-- and as a sorted key list, and a hand-written scan in each cell is a scan that only covers its own wording.
CREATE FUNCTION pg_temp.s11h_text(p_tag text) RETURNS text
LANGUAGE sql STABLE AS $fn$ SELECT a #>> '{}' FROM pg_temp.s11h_s WHERE tag = p_tag $fn$;

-- One scan, one direction, named in the label. `s11h_present` is the control half of every `s11h_absent`:
-- a scanner that cannot emit a hit proves nothing about the misses it reports.
CREATE FUNCTION pg_temp.s11h_absent(label text, p_tag text, p_needle text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF position(p_needle IN pg_temp.s11h_text(p_tag)) <> 0 THEN
    RAISE EXCEPTION 'FAIL %: [%] is in the answer', label, p_needle;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11h_present(label text, p_tag text, p_needle text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF position(p_needle IN pg_temp.s11h_text(p_tag)) = 0 THEN
    RAISE EXCEPTION 'FAIL %: [%] is NOT in the answer, so the matching absence scan is unproven',
      label, p_needle;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

-- The same, by regular expression, for the shapes no single needle can name: any uuid, any 64-hex digest.
CREATE FUNCTION pg_temp.s11h_no_re(label text, p_tag text, p_pattern text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  SELECT m[1] INTO v FROM regexp_matches(pg_temp.s11h_text(p_tag), p_pattern, 'g') m;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL %: the answer carries % matching %', label, v, p_pattern;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11h_re_hits(label text, p_source text, p_pattern text, p_want integer)
RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v integer;
BEGIN
  SELECT count(*) INTO v FROM regexp_matches(p_source, p_pattern, 'g') m;
  IF v <> p_want THEN
    RAISE EXCEPTION 'FAIL %: % hits for % (want %)', label, v, p_pattern, p_want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

-- A block's own status, read so that a missing block is a sentence and not a NULL four cells later.
CREATE FUNCTION pg_temp.s11h_block(p_tag text, p_name text) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT CASE jsonb_typeof(pg_temp.s11h_snap(p_tag) #> ARRAY['blocks', p_name])
           WHEN 'object' THEN pg_temp.s11h_snap(p_tag) #> ARRAY['blocks', p_name] END $fn$;

-- Any path's object, guarded the same way: `s11h_keys` on a NULL is a sentence about the path, not a
-- comparison of two NULLs.
CREATE FUNCTION pg_temp.s11h_at(p_tag text, p_path text[]) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT CASE jsonb_typeof(pg_temp.s11h_snap(p_tag) #> p_path)
           WHEN 'object' THEN pg_temp.s11h_snap(p_tag) #> p_path END $fn$;

-- A timestamp field that must not be later than the instant the answer says it read the stores at.
CREATE FUNCTION pg_temp.s11h_stamped(label text, p_tag text, p_path text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  v := pg_temp.s11h_txt(p_tag, p_path);
  IF v IS NULL THEN
    RAISE EXCEPTION 'FAIL %: % is absent or not a string', label, array_to_string(p_path, '.');
  ELSIF v::timestamptz > (pg_temp.s11h_snap(p_tag) ->> 'as_of')::timestamptz THEN
    RAISE EXCEPTION 'FAIL %: % is [%], later than this answer''s as_of', label,
      array_to_string(p_path, '.'), v;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

-- ===========================================================================
-- 5. C — the field list §9 names, asserted as a key inventory rather than as a paragraph. A block that
--     gains a field, loses one, or renames one moves an array here; the counts themselves live in groups
--     L and M. Sorting is `COLLATE "C"` inside `s11h_keys`, so these literals are the engine's order and
--     not a hand-sorted guess.
--
--     The four grouped counters (`by_actor_kind`, `by_action_prefix`, `live_by_kind`, `held_by_reason`) are
--     this chain's *data*, not this projection's vocabulary — every one of their counts is independently
--     recomputed from the store in group M, and their vocabularies are pinned against the CHECK constraints
--     in group V. A neighbour battery that plants a new kind fails here loudly, which is the tripwire.
-- ===========================================================================
SELECT pg_temp.s11h_keys('C1 the answer carries exactly the eight fields §9 describes',
  pg_temp.s11h_snap('w24'),
  ARRAY['as_of', 'block_count', 'blocks', 'blocks_not_measured', 'from_inclusive',
        'identifiers_included', 'window_hours', 'writes_anything']);

SELECT pg_temp.s11h_keys('C2 ten blocks, named',
  pg_temp.s11h_at('w24', ARRAY['blocks']),
  ARRAY['audit', 'auth_failures', 'commerce', 'credentials', 'delivery', 'migrations',
        'publication', 'queue', 'rate_limits', 'token_abuse']);

SELECT pg_temp.s11h_keys('C3 publication fields',
  pg_temp.s11h_block('w24', 'publication'),
  ARRAY['active_total', 'as_of', 'newest_at', 'published_in_window', 'revoked_in_window',
        'revoked_total', 'status', 'total', 'weddings_with_active_publication', 'window_hours']);

SELECT pg_temp.s11h_keys('C4 credentials fields',
  pg_temp.s11h_block('w24', 'credentials'),
  ARRAY['as_of', 'expired', 'last_used_at', 'live', 'live_by_kind', 'never_used', 'newest_at',
        'revoked', 'status', 'total', 'used_in_window', 'window_hours']);

SELECT pg_temp.s11h_keys('C5 delivery fields, including the two Stage 9 states a screen must not average away',
  pg_temp.s11h_block('w24', 'delivery'),
  ARRAY['as_of', 'failed', 'failed_at_attempt_ceiling', 'invalidated',
        'invalidated_by_publication_revoked', 'newest_at', 'ready', 'registered', 'status',
        'total', 'uploading', 'window_hours']);

SELECT pg_temp.s11h_keys('C6 commerce fields',
  pg_temp.s11h_block('w24', 'commerce'),
  ARRAY['applied', 'as_of', 'duplicate', 'events_in_window', 'events_total', 'held_by_reason',
        'held_for_reconciliation', 'newest_at', 'orders', 'refunds', 'rejected_signature',
        'stale', 'status', 'window_hours']);

SELECT pg_temp.s11h_keys('C7 audit fields',
  pg_temp.s11h_block('w24', 'audit'),
  ARRAY['as_of', 'by_action_prefix', 'by_actor_kind', 'newest_at', 'operator_rows_without_case_link',
        'rows_in_window', 'status', 'total', 'window_hours', 'with_reason']);

SELECT pg_temp.s11h_keys('C8 queue fields',
  pg_temp.s11h_block('w24', 'queue'),
  ARRAY['as_of', 'cases', 'privacy_requests', 'status', 'window_hours']);

SELECT pg_temp.s11h_keys('C9 migrations fields: presence, reason and note, and no invented timestamp',
  pg_temp.s11h_block('w24', 'migrations'),
  ARRAY['as_of', 'note', 'reason', 'status']);

SELECT pg_temp.s11h_keys('C10 auth_failures fields', pg_temp.s11h_block('w24', 'auth_failures'),
  ARRAY['as_of', 'reason', 'status']);
SELECT pg_temp.s11h_keys('C11 rate_limits fields', pg_temp.s11h_block('w24', 'rate_limits'),
  ARRAY['as_of', 'reason', 'status']);
SELECT pg_temp.s11h_keys('C12 token_abuse fields', pg_temp.s11h_block('w24', 'token_abuse'),
  ARRAY['as_of', 'reason', 'status']);

SELECT pg_temp.s11h_keys('C13 the orders sub-object fields',
  pg_temp.s11h_at('w24', ARRAY['blocks', 'commerce', 'orders']),
  ARRAY['cancelled', 'captured', 'expired', 'newest_at', 'open', 'payment_pending', 'total']);
SELECT pg_temp.s11h_keys('C14 the refunds sub-object fields, including the note-existence count',
  pg_temp.s11h_at('w24', ARRAY['blocks', 'commerce', 'refunds']),
  ARRAY['failed', 'newest_at', 'recorded', 'reversed', 'succeeded', 'total', 'without_review_note']);
SELECT pg_temp.s11h_keys('C15 the case-queue fields, including the two a screen is opened for',
  pg_temp.s11h_at('w24', ARRAY['blocks', 'queue', 'cases']),
  ARRAY['aged_outside_window', 'awaiting_information', 'closed', 'in_progress', 'live_total',
        'newest_at', 'open', 'resolved', 'resolved_in_window', 'total', 'triaged',
        'unclaimed_live']);
SELECT pg_temp.s11h_keys('C16 the privacy-queue fields',
  pg_temp.s11h_at('w24', ARRAY['blocks', 'queue', 'privacy_requests']),
  ARRAY['declined', 'identity_verification_requested', 'newest_at', 'queued_for_stage13', 'received',
        'satisfied_outside_this_build', 'total', 'unresolved_outside_window', 'unresolved_total']);
SELECT pg_temp.s11h_keys('C17 the case-link count is an object, so it can carry a reason later',
  pg_temp.s11h_at('w24', ARRAY['blocks', 'audit', 'operator_rows_without_case_link']),
  ARRAY['count']);

SELECT pg_temp.s11h_keys('C18 credentials grouped by the four-value token vocabulary present here',
  pg_temp.s11h_at('w24', ARRAY['blocks', 'credentials', 'live_by_kind']),
  ARRAY['guest_invitation', 'public_invitation', 'rsvp']);
SELECT pg_temp.s11h_keys('C19 audit grouped by actor kind, and the vocabulary has no fifth bucket',
  pg_temp.s11h_at('w24', ARRAY['blocks', 'audit', 'by_actor_kind']),
  ARRAY['host', 'maintenance', 'operator', 'system']);
SELECT pg_temp.s11h_keys('C20 audit grouped by the first word of the action, which is where this battery''s own '
  || 'trail rows become visible as a prefix rather than as a leak',
  pg_temp.s11h_at('w24', ARRAY['blocks', 'audit', 'by_action_prefix']),
  ARRAY['case', 'commerce', 'granted', 'privacy', 'publication', 'revoked', 's11hxq', 'status']);
SELECT pg_temp.s11h_keys('C21 reconciliation holds grouped by reason: the one field §9 asks for by name',
  pg_temp.s11h_at('w24', ARRAY['blocks', 'commerce', 'held_by_reason']),
  ARRAY['s11h_hold_amount_mismatch']);

-- ===========================================================================
-- 6. W — the window: its default, its bound appearing in the answer, the one instant it is measured
--     against, and the saturation point where widening it stops changing anything.
-- ===========================================================================
INSERT INTO s11h_s (tag, a)
SELECT 'wn', pg_temp.s11h_must('W0 the default window is accepted as NULL', 'authenticated',
  (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
  'SELECT api.operator_operations_summary(null::integer)');

SELECT pg_temp.s11h_eq('W1 a NULL window labels itself 24 rather than leaving the caller to guess',
  pg_temp.s11h_num('wn', ARRAY['window_hours']), 24::numeric);

SELECT pg_temp.s11h_eq('W2 a NULL window is the same answer as an explicit 24, byte for byte',
  pg_temp.s11h_snap('wn'), pg_temp.s11h_snap('w24'));

SELECT pg_temp.s11h_ok('W3 from_inclusive is as_of minus the window, not minus a rounded day (24h)',
  (pg_temp.s11h_snap('w24') ->> 'as_of')::timestamptz - make_interval(hours => 24)
  = (pg_temp.s11h_snap('w24') ->> 'from_inclusive')::timestamptz);
SELECT pg_temp.s11h_ok('W3b the same identity holds at one hour, where a naive 86400-second window would drift',
  (pg_temp.s11h_snap('w1') ->> 'as_of')::timestamptz - make_interval(hours => 1)
  = (pg_temp.s11h_snap('w1') ->> 'from_inclusive')::timestamptz);
SELECT pg_temp.s11h_ok('W3c and at the widest window the bound admits',
  (pg_temp.s11h_snap('w720') ->> 'as_of')::timestamptz - make_interval(hours => 720)
  = (pg_temp.s11h_snap('w720') ->> 'from_inclusive')::timestamptz);

SELECT pg_temp.s11h_ok('W4 as_of is this transaction''s own now(), so ten blocks cannot describe ten instants',
  (pg_temp.s11h_snap('w24') ->> 'as_of')::timestamptz = now());

DO $loop$
DECLARE r record;
BEGIN
  FOR r IN SELECT key AS name FROM jsonb_each(pg_temp.s11h_snap('w24') -> 'blocks') LOOP
    PERFORM pg_temp.s11h_eqs('W5 block ' || r.name || ' is stamped with the answer''s own as_of',
      'w24', ARRAY['blocks', r.name, 'as_of'], pg_temp.s11h_txt('w24', ARRAY['as_of']));
  END LOOP;
END $loop$;

DO $loop$
DECLARE r record;
BEGIN
  FOR r IN SELECT p FROM (VALUES
      (ARRAY['blocks', 'publication', 'newest_at']::text[]),
      (ARRAY['blocks', 'credentials', 'newest_at']),
      (ARRAY['blocks', 'credentials', 'last_used_at']),
      (ARRAY['blocks', 'delivery', 'newest_at']),
      (ARRAY['blocks', 'commerce', 'newest_at']),
      (ARRAY['blocks', 'commerce', 'orders', 'newest_at']),
      (ARRAY['blocks', 'commerce', 'refunds', 'newest_at']),
      (ARRAY['blocks', 'audit', 'newest_at']),
      (ARRAY['blocks', 'queue', 'cases', 'newest_at']),
      (ARRAY['blocks', 'queue', 'privacy_requests', 'newest_at'])) s(p) LOOP
    PERFORM pg_temp.s11h_stamped('W6 no newest_at may be in the future that as_of does not share',
      'w24', r.p);
  END LOOP;
END $loop$;

DO $loop$
DECLARE r record;
BEGIN
  FOR r IN SELECT name FROM unnest(ARRAY['publication', 'credentials', 'delivery', 'commerce',
                                         'audit', 'queue']) AS name LOOP
    PERFORM pg_temp.s11h_eq('W7 the ' || r.name || ' block echoes the window it was measured over',
      pg_temp.s11h_num('w24', ARRAY['blocks', r.name, 'window_hours']),
      pg_temp.s11h_num('w24', ARRAY['window_hours']));
  END LOOP;
END $loop$;

SELECT pg_temp.s11h_eq('W7b the absence blocks carry no window, because nothing was measured over one',
  (SELECT count(*) FROM jsonb_each(pg_temp.s11h_snap('w24') -> 'blocks')
    WHERE (value ->> 'status') = 'not_measured' AND value ? 'window_hours'), 0::bigint);

SELECT pg_temp.s11h_eq('W8 the one-hour answer labels itself 1',
  pg_temp.s11h_num('w1', ARRAY['window_hours']), 1::numeric);
SELECT pg_temp.s11h_eq('W8b the thirty-day answer labels itself 720',
  pg_temp.s11h_num('w720', ARRAY['window_hours']), 720::numeric);

-- Saturation: at the widest legal window every "in window" counter must equal its own total, because a
-- counter that silently ignored the bound would look saturated here too and would have failed a delta cell
-- in group L instead. Together with L's `xd` cells this is the two-sided proof that the window is read.
SELECT pg_temp.s11h_eq('W9 at 720 hours every audit row is inside the window',
  pg_temp.s11h_num('w720', ARRAY['blocks', 'audit', 'rows_in_window']),
  pg_temp.s11h_num('w720', ARRAY['blocks', 'audit', 'total']));
SELECT pg_temp.s11h_eq('W9b at 720 hours every payment event is inside the window',
  pg_temp.s11h_num('w720', ARRAY['blocks', 'commerce', 'events_in_window']),
  pg_temp.s11h_num('w720', ARRAY['blocks', 'commerce', 'events_total']));
SELECT pg_temp.s11h_eq('W9c at 720 hours every publication was published inside it',
  pg_temp.s11h_num('w720', ARRAY['blocks', 'publication', 'published_in_window']),
  pg_temp.s11h_num('w720', ARRAY['blocks', 'publication', 'total']));
SELECT pg_temp.s11h_eq('W9d at 720 hours every revoked publication was revoked inside it',
  pg_temp.s11h_num('w720', ARRAY['blocks', 'publication', 'revoked_in_window']),
  pg_temp.s11h_num('w720', ARRAY['blocks', 'publication', 'revoked_total']));
SELECT pg_temp.s11h_eq('W9e at 720 hours no live case is aged out of the window',
  pg_temp.s11h_num('w720', ARRAY['blocks', 'queue', 'cases', 'aged_outside_window']), 0::numeric);
SELECT pg_temp.s11h_eq('W9f at 720 hours no unresolved privacy request is aged out',
  pg_temp.s11h_num('w720', ARRAY['blocks', 'queue', 'privacy_requests',
                                 'unresolved_outside_window']), 0::numeric);
SELECT pg_temp.s11h_eq('W9f at 720 hours a credential is either used or never used, and the two close total',
  pg_temp.s11h_num('w720', ARRAY['blocks', 'credentials', 'never_used'])
  + pg_temp.s11h_num('w720', ARRAY['blocks', 'credentials', 'used_in_window']),
  pg_temp.s11h_num('w720', ARRAY['blocks', 'credentials', 'total']));

-- ===========================================================================
-- 7. S — the pair's declared posture, read from the catalogue.
--    Nothing below paraphrases a comment: `provolatile`, `prosecdef`, `proconfig`, `proacl` and
--    `pg_get_function_arguments` are what the engine will actually enforce at call time, and the acl is the
--    reason group A's anon and service_role refusals happen before any body runs.
-- ===========================================================================
SELECT pg_temp.s11h_eq('S0 the door exists twice and only twice, in `api` and `internal_api`',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'operator_operations_summary'), 2::bigint);

SELECT pg_temp.s11h_eq('S0b neither half lives in a schema a client can enumerate',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'operator_operations_summary'
      AND n.nspname NOT IN ('api', 'internal_api')), 0::bigint);

SELECT pg_temp.s11h_eq('S1 the wrapper is STABLE (so a write inside it is impossible, not merely absent)',
  (SELECT p.provolatile::text FROM pg_proc p WHERE p.proname = 'operator_operations_summary'
     AND p.pronamespace = 'api'::regnamespace), 's');

SELECT pg_temp.s11h_eq('S2 the wrapper is SECURITY INVOKER, so the grant layer is not bypassed at the door',
  (SELECT p.prosecdef FROM pg_proc p WHERE p.proname = 'operator_operations_summary'
     AND p.pronamespace = 'api'::regnamespace), false);

SELECT pg_temp.s11h_eq('S3 the wrapper is plain SQL, so its whole body is readable as one expression',
  (SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.proname = 'operator_operations_summary' AND p.pronamespace = 'api'::regnamespace), 'sql');

SELECT pg_temp.s11h_eq('S4 the body is STABLE too, so neither half of the pair can write',
  (SELECT p.provolatile::text FROM pg_proc p WHERE p.proname = 'operator_operations_summary'
     AND p.pronamespace = 'internal_api'::regnamespace), 's');

SELECT pg_temp.s11h_eq('S5 the body is the only DEFINER half, and it is the one that holds the scope test',
  (SELECT p.prosecdef FROM pg_proc p WHERE p.proname = 'operator_operations_summary'
     AND p.pronamespace = 'internal_api'::regnamespace), true);

SELECT pg_temp.s11h_eq('S6 the body is plpgsql, so the refusal sentences are raised, not returned',
  (SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.proname = 'operator_operations_summary' AND p.pronamespace = 'internal_api'::regnamespace),
  'plpgsql');

-- Unnested rather than `proconfig::text`, because array-to-text quoting escapes the embedded double quotes and
-- would make this cell assert an escaping rule instead of a search path. The element is the engine's own
-- storage of `SET search_path = ''`: the literal text `search_path=""`.
SELECT pg_temp.s11h_array('S7 both halves run with no search path at all',
  (SELECT array_agg(x ORDER BY ns, x) FROM (
     SELECT unnest(p.proconfig) AS x, p.pronamespace::regnamespace::text AS ns
       FROM pg_proc p WHERE p.proname = 'operator_operations_summary') s(x, ns)),
  ARRAY['search_path=""', 'search_path=""']);

SELECT pg_temp.s11h_array('S8 both halves take exactly one integer window and nothing else',
  (SELECT array_agg(pg_get_function_arguments(p.oid) ORDER BY p.pronamespace::regnamespace::text)
     FROM pg_proc p WHERE p.proname = 'operator_operations_summary'),
  ARRAY['p_window_hours integer', 'p_window_hours integer']);

SELECT pg_temp.s11h_array('S9 both halves return jsonb and no typed row',
  (SELECT array_agg(p.prorettype::regtype::text ORDER BY p.pronamespace::regnamespace::text)
     FROM pg_proc p WHERE p.proname = 'operator_operations_summary'),
  ARRAY['jsonb', 'jsonb']);

SELECT pg_temp.s11h_array('S10 postgres owns both halves, so the DEFINER half has no weaker identity to assume',
  (SELECT array_agg(pg_get_userbyid(p.proowner) ORDER BY p.pronamespace::regnamespace::text)
     FROM pg_proc p WHERE p.proname = 'operator_operations_summary'),
  ARRAY['postgres', 'postgres']);

-- The grant list, exploded rather than string-compared, so a third grantee or a `WITH GRANT OPTION` is a
-- changed array and not a comment that drifted.
SELECT pg_temp.s11h_array('S11 exactly two grantee/privilege pairs exist across the pair, and both are EXECUTE',
  (SELECT array_agg(x ORDER BY x) FROM (
     SELECT a.grantee::regrole::text || '.' || a.privilege_type || '@' || p.pronamespace::regnamespace::text
       FROM pg_proc p, aclexplode(p.proacl) a
      WHERE p.proname = 'operator_operations_summary') s(x)),
  ARRAY['authenticated.EXECUTE@api', 'authenticated.EXECUTE@internal_api',
        'postgres.EXECUTE@api', 'postgres.EXECUTE@internal_api']);

-- PUBLIC is addressed by its pseudo-authorization id 0, not by a role name — this database has no role called
-- `public`, so `'public'::regrole` is itself an error and a scan written that way would pass by never running.
SELECT pg_temp.s11h_eq('S12 no PUBLIC, anon or service_role execution right exists on either half',
  (SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.proname = 'operator_operations_summary'
      AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'service_role'::regrole))), 0::bigint);

SELECT pg_temp.s11h_eq('S13 neither grant was made WITH GRANT OPTION, so this door cannot share itself',
  (SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.proname = 'operator_operations_summary' AND a.is_grantable), 0::bigint);

SELECT pg_temp.s11h_eq('S14 the wrapper body is one delegation and contains no other readable token',
  (SELECT btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')) FROM pg_proc p
     WHERE p.proname = 'operator_operations_summary' AND p.pronamespace = 'api'::regnamespace),
  'SELECT internal_api.operator_operations_summary(p_window_hours);');

SELECT pg_temp.s11h_eq('S15 the scope test is inside the body, not beside it',
  (SELECT (p.prosrc ~ 'private\.actor_is_operator\(''operations''\)')::int FROM pg_proc p
     WHERE p.proname = 'operator_operations_summary' AND p.pronamespace = 'internal_api'::regnamespace), 1);

-- The store list, read out of the body by the qualified relation names it SELECTs from. This is the field
-- §9's ten blocks are built on, and a block added without a store — or a store read without a block — moves
-- this array instead of passing quietly.
SELECT pg_temp.s11h_array('S16 the body reads exactly these twelve stores, and no others',
  (SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) FROM pg_proc p,
    LATERAL regexp_matches(p.prosrc,
      'FROM ((?:public|private|storage|supabase_migrations)\.[a-z_]+)', 'g') m
    WHERE p.proname = 'operator_operations_summary' AND p.pronamespace = 'internal_api'::regnamespace),
  ARRAY['private.access_tokens', 'private.audit_events', 'private.commerce_orders',
        'private.commerce_payment_events', 'private.commerce_refunds', 'private.commerce_review_notes',
        'private.privacy_requests', 'private.support_case_events', 'private.support_cases',
        'public.invitation_outputs', 'public.publications',
        'supabase_migrations.schema_migrations']);

SELECT pg_temp.s11h_present('S17 the scan instrument used by group I does register a hit on a string the '
  || 'answer carries, so its misses mean something', 'w24', 'measured');

SELECT pg_temp.s11h_eq('S18 the pair''s comments exist and carry the two sentences that bound this slice',
  (SELECT count(*) FROM pg_proc p
    WHERE p.proname = 'operator_operations_summary'
      AND (obj_description(p.oid) LIKE 'SECURITY INVOKER wrapper%'
           OR obj_description(p.oid) LIKE 'Scope `operations`. STABLE definer, ten blocks%')), 2::bigint);

-- ===========================================================================
-- 8. A — the four authority shapes, each reached as the role that would reach it, through the wrapper and
--    through the body. Two of these refusals are raised by the grant layer before this file's body runs at
--    all (which is why S11/S12 are measured first), and two are raised by the body's own scope test. They are
--    four sentences, not four behaviours, and `s11h_same` is what makes that claim instead of a comment.
-- ===========================================================================
SELECT pg_temp.s11h_err_is('A1 anon is refused at the wrapper by the grant layer',
  pg_temp.s11h_err(pg_temp.s11h_as('anon', NULL, 'SELECT api.operator_operations_summary(24)')),
  '42501', '%permission denied for function operator_operations_summary%');

SELECT pg_temp.s11h_err_is('A2 anon is refused at the body by the same grant-layer sentence',
  pg_temp.s11h_err(pg_temp.s11h_as('anon', NULL, 'SELECT internal_api.operator_operations_summary(24)')),
  '42501', '%permission denied for function operator_operations_summary%');

SELECT pg_temp.s11h_same('A3 the two anon halves are one sentence',
  pg_temp.s11h_err(pg_temp.s11h_as('anon', NULL, 'SELECT api.operator_operations_summary(24)')),
  pg_temp.s11h_err(pg_temp.s11h_as('anon', NULL, 'SELECT internal_api.operator_operations_summary(24)')));

SELECT pg_temp.s11h_err_is('A4 service_role cannot even name the schema the wrapper lives in',
  pg_temp.s11h_err(pg_temp.s11h_as('service_role', NULL, 'SELECT api.operator_operations_summary(24)')),
  '42501', '%permission denied for schema api%');

SELECT pg_temp.s11h_err_is('A5 service_role cannot name the body''s schema either, so no trusted role is above this',
  pg_temp.s11h_err(pg_temp.s11h_as('service_role', NULL, 'SELECT internal_api.operator_operations_summary(24)')),
  '42501', '%permission denied for schema internal_api%');

-- A forged `test.uid` is the attack this shape exists to stop: the role is checked by the grant layer, so a
-- claim about who the caller is cannot arrive at the body at all.
SELECT pg_temp.s11h_same('A6 an anon token that claims a live operator''s uid is refused as anon, not as the uid',
  pg_temp.s11h_err(pg_temp.s11h_as('anon', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
                                   'SELECT api.operator_operations_summary(24)')),
  pg_temp.s11h_err(pg_temp.s11h_as('anon', NULL, 'SELECT api.operator_operations_summary(24)')));

SELECT pg_temp.s11h_err_is('A7 a signed-in account with no uid is refused by the body''s own scope test',
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', NULL, 'SELECT api.operator_operations_summary(24)')),
  '42501', '%the caller may not read the operations summary%');

SELECT pg_temp.s11h_err_is('A8 an account that exists but holds no grant row is refused by the same sentence',
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'ghost'),
                                   'SELECT api.operator_operations_summary(24)')),
  '42501', '%the caller may not read the operations summary%');

SELECT pg_temp.s11h_err_is('A9 a support-scoped operator is refused: a scope is not a seniority',
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'sup_a'),
                                   'SELECT api.operator_operations_summary(24)')),
  '42501', '%the caller may not read the operations summary%');

SELECT pg_temp.s11h_err_is('A10 a revoked operations grant is refused',
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_r'),
                                   'SELECT api.operator_operations_summary(24)')),
  '42501', '%the caller may not read the operations summary%');

-- The fourth shape is the dangerous one: a row that still says `active` whose window has closed. A grant
-- table that only read `status` would answer here.
SELECT pg_temp.s11h_err_is('A11 an active grant whose expiry has passed is refused, not honoured',
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_x'),
                                   'SELECT api.operator_operations_summary(24)')),
  '42501', '%the caller may not read the operations summary%');

SELECT pg_temp.s11h_err_is('A12 a host is refused the cluster-wide screen',
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'host_1'),
                                   'SELECT api.operator_operations_summary(24)')),
  '42501', '%the caller may not read the operations summary%');

SELECT pg_temp.s11h_err_is('A13 the superuser is refused by the body''s sentence, not by its own privilege',
  pg_temp.s11h_try('postgres', (SELECT id FROM s11h_reg WHERE tag = 'ghost'),
                   'SELECT api.operator_operations_summary(24)'),
  '42501', '%the caller may not read the operations summary%');

SELECT pg_temp.s11h_same('A14 a stranger and the owner with a stranger''s uid hear one sentence',
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', NULL, 'SELECT api.operator_operations_summary(24)')),
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'ghost'),
                                   'SELECT api.operator_operations_summary(24)')));

SELECT pg_temp.s11h_same('A15 the wrapper and the body refuse the wrong scope in one sentence',
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'sup_a'),
                                   'SELECT api.operator_operations_summary(24)')),
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'sup_a'),
                                   'SELECT internal_api.operator_operations_summary(24)')));

-- The window bound is only reachable behind the door, so these three are run as `op_a`. The refusal names the
-- bound and the offending value, which is the difference between a screen that can be diagnosed and one that
-- can only be retried.
SELECT pg_temp.s11h_err_is('A16 window 0 is refused with the bound and the value in the sentence',
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
                                   'SELECT api.operator_operations_summary(0)')),
  '23514', '%between 1 and 720 hours, not 0%');

SELECT pg_temp.s11h_err_is('A17 window 721 is refused, so thirty days is a ceiling and not a suggestion',
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
                                   'SELECT api.operator_operations_summary(721)')),
  '23514', '%between 1 and 720 hours, not 721%');

SELECT pg_temp.s11h_err_is('A18 a negative window is refused, and its sign reaches the sentence',
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
                                   'SELECT api.operator_operations_summary(-1)')),
  '23514', '%between 1 and 720 hours, not -1%');

SELECT pg_temp.s11h_same('A19 the bound reads the same through the body as through the wrapper',
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
                                   'SELECT api.operator_operations_summary(0)')),
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
                                   'SELECT internal_api.operator_operations_summary(0)')));

SELECT pg_temp.s11h_ok('A20 the scope test runs before the window test, so a stranger cannot probe the bounds',
  pg_temp.s11h_err(pg_temp.s11h_as('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'ghost'),
                                   'SELECT api.operator_operations_summary(0)')) LIKE
  '42501%the caller may not read the operations summary%');

-- ===========================================================================
-- 9. L — non-vacuity, leaf by leaf.
--
-- Two numbers are recorded for every numeric leaf in this answer: `d24`, how much this file's own plants
-- moved it between the pre-plant answer `base` and the post-plant answer `w24`, and `xd`, the hour/day
-- boundary effect `(w24 - w1) - (base - b1)`. Both come from the captured readout of this chain, not from a
-- reading of the projection's source.
--
-- A block that reports nothing would report no delta, so `d24` is the proof that each of the ten blocks is
-- wired to a real store. `xd` is the proof that the window is actually applied: a leaf that ignores `v_from`
-- would show 0 here too, which is exactly why group W separately requires the widest legal window to
-- saturate every "in window" counter against its own total.
--
-- `L0` makes the list self-checking: the left array is every numeric leaf the live answer carries, walked
-- out of the captured jsonb, and the right is this table. Add a field to a block without adding a row and
-- this cell fails; drop a row and it fails. Without it, the 86 cells below could be quietly under-scoped.
-- ===========================================================================
CREATE TEMP TABLE s11h_exp (dotted text PRIMARY KEY, d24 numeric, xd numeric) ON COMMIT DROP;

-- Every leaf name in the answer, walking objects and arrays and keeping only numbers. Arrays are named with
-- a bracketed index so a leaf cannot collide with an object key of the same spelling.
CREATE FUNCTION pg_temp.s11h_leaves(v jsonb, p_prefix text)
RETURNS TABLE (dotted text, val numeric)
LANGUAGE plpgsql AS $fn$
DECLARE k text; i integer;
BEGIN
  IF jsonb_typeof(v) = 'object' THEN
    FOR k IN SELECT e.key FROM jsonb_object_keys(v) AS e(key) ORDER BY e.key COLLATE "C" LOOP
      RETURN QUERY SELECT * FROM pg_temp.s11h_leaves(v -> k,
        CASE WHEN p_prefix = '' THEN k ELSE p_prefix || '.' || k END);
    END LOOP;
  ELSIF jsonb_typeof(v) = 'array' THEN
    FOR i IN 0..jsonb_array_length(v) - 1 LOOP
      RETURN QUERY SELECT * FROM pg_temp.s11h_leaves(v -> i, p_prefix || '[' || i || ']');
    END LOOP;
  ELSIF jsonb_typeof(v) = 'number' THEN
    RETURN QUERY SELECT p_prefix, (v #>> '{}')::numeric;
  END IF;
END $fn$;

INSERT INTO s11h_exp (dotted, d24, xd) VALUES
 ('block_count',                                                    0,  0),
 ('blocks.audit.by_action_prefix.case',                             0,  0),
 ('blocks.audit.by_action_prefix.commerce',                         0,  0),
 ('blocks.audit.by_action_prefix.granted',                          0,  0),
 ('blocks.audit.by_action_prefix.privacy',                          0,  0),
 ('blocks.audit.by_action_prefix.publication',                      0,  0),
 ('blocks.audit.by_action_prefix.revoked',                          0,  0),
 ('blocks.audit.by_action_prefix.s11hxq',                           4,  0),
 ('blocks.audit.by_action_prefix.status',                           0,  0),
 ('blocks.audit.by_actor_kind.host',                                1,  0),
 ('blocks.audit.by_actor_kind.maintenance',                         0,  0),
 ('blocks.audit.by_actor_kind.operator',                            2,  0),
 ('blocks.audit.by_actor_kind.system',                              1,  0),
 ('blocks.audit.operator_rows_without_case_link.count',             1,  0),
 ('blocks.audit.rows_in_window',                                    3,  1),
 ('blocks.audit.total',                                             4,  0),
 ('blocks.audit.window_hours',                                      0,  0),
 ('blocks.audit.with_reason',                                       3,  0),
 ('blocks.commerce.applied',                                        1,  0),
 ('blocks.commerce.duplicate',                                      1,  0),
 ('blocks.commerce.events_in_window',                               5,  3),
 ('blocks.commerce.events_total',                                   6,  0),
 ('blocks.commerce.held_by_reason.s11h_hold_amount_mismatch',       2,  0),
 ('blocks.commerce.held_for_reconciliation',                        2,  0),
 ('blocks.commerce.orders.cancelled',                               0,  0),
 ('blocks.commerce.orders.captured',                                1,  0),
 ('blocks.commerce.orders.expired',                                 1,  0),
 ('blocks.commerce.orders.open',                                    1,  0),
 ('blocks.commerce.orders.payment_pending',                         0,  0),
 ('blocks.commerce.orders.total',                                   3,  0),
 ('blocks.commerce.refunds.failed',                                 1,  0),
 ('blocks.commerce.refunds.recorded',                               1,  0),
 ('blocks.commerce.refunds.reversed',                               1,  0),
 ('blocks.commerce.refunds.succeeded',                              1,  0),
 ('blocks.commerce.refunds.total',                                  4,  0),
 ('blocks.commerce.refunds.without_review_note',                    3,  0),
 ('blocks.commerce.rejected_signature',                             1,  0),
 ('blocks.commerce.stale',                                          1,  0),
 ('blocks.commerce.window_hours',                                   0,  0),
 ('blocks.credentials.expired',                                     1,  0),
 ('blocks.credentials.live',                                        5,  0),
 ('blocks.credentials.live_by_kind.guest_invitation',               3,  0),
 ('blocks.credentials.live_by_kind.public_invitation',              1,  0),
 ('blocks.credentials.live_by_kind.rsvp',                           1,  0),
 ('blocks.credentials.never_used',                                  4,  0),
 ('blocks.credentials.revoked',                                     2,  0),
 ('blocks.credentials.total',                                       8,  0),
 ('blocks.credentials.used_in_window',                              3,  1),
 ('blocks.credentials.window_hours',                                0,  0),
 ('blocks.delivery.failed',                                         2,  0),
 ('blocks.delivery.failed_at_attempt_ceiling',                      1,  0),
 ('blocks.delivery.invalidated',                                    1,  0),
 ('blocks.delivery.invalidated_by_publication_revoked',             1,  0),
 ('blocks.delivery.ready',                                          2,  0),
 ('blocks.delivery.registered',                                     1,  0),
 ('blocks.delivery.total',                                          6,  0),
 ('blocks.delivery.uploading',                                      0,  0),
 ('blocks.delivery.window_hours',                                   0,  0),
 ('blocks.publication.active_total',                                2,  0),
 ('blocks.publication.published_in_window',                         2,  1),
 ('blocks.publication.revoked_in_window',                           1,  0),
 ('blocks.publication.revoked_total',                               1,  0),
 ('blocks.publication.total',                                       3,  0),
 ('blocks.publication.weddings_with_active_publication',            2,  0),
 ('blocks.publication.window_hours',                                0,  0),
 ('blocks.queue.cases.aged_outside_window',                         1, -2),
 ('blocks.queue.cases.awaiting_information',                        0,  0),
 ('blocks.queue.cases.closed',                                      0,  0),
 ('blocks.queue.cases.in_progress',                                 1,  0),
 ('blocks.queue.cases.live_total',                                  3,  0),
 ('blocks.queue.cases.open',                                        1,  0),
 ('blocks.queue.cases.resolved',                                    1,  0),
 ('blocks.queue.cases.resolved_in_window',                          1,  0),
 ('blocks.queue.cases.total',                                       4,  0),
 ('blocks.queue.cases.triaged',                                     1,  0),
 ('blocks.queue.cases.unclaimed_live',                              1,  0),
 ('blocks.queue.privacy_requests.declined',                         0,  0),
 ('blocks.queue.privacy_requests.identity_verification_requested',  0,  0),
 ('blocks.queue.privacy_requests.queued_for_stage13',               1,  0),
 ('blocks.queue.privacy_requests.received',                         1,  0),
 ('blocks.queue.privacy_requests.satisfied_outside_this_build',     0,  0),
 ('blocks.queue.privacy_requests.total',                            2,  0),
 ('blocks.queue.privacy_requests.unresolved_outside_window',        1, -1),
 ('blocks.queue.privacy_requests.unresolved_total',                 2,  0),
 ('blocks.queue.window_hours',                                      0,  0),
 ('window_hours',                                                   0,  0);

SELECT pg_temp.s11h_array('L0 the pinned list is every numeric leaf this answer carries, and nothing else',
  (SELECT array_agg(dotted ORDER BY dotted COLLATE "C") FROM pg_temp.s11h_leaves(
     pg_temp.s11h_snap('w24'), '')),
  (SELECT array_agg(dotted ORDER BY dotted COLLATE "C") FROM s11h_exp));

DO $loop$
DECLARE r record;
BEGIN
  FOR r IN SELECT dotted, d24 FROM s11h_exp ORDER BY dotted COLLATE "C" LOOP
    PERFORM pg_temp.s11h_delta('L plants moved ' || r.dotted, 'w24', 'base',
                               string_to_array(r.dotted, '.'), r.d24);
  END LOOP;
END $loop$;

DO $loop$
DECLARE r record;
BEGIN
  FOR r IN SELECT dotted, xd FROM s11h_exp ORDER BY dotted COLLATE "C" LOOP
    PERFORM pg_temp.s11h_xd('Lx hour-versus-day boundary for ' || r.dotted,
                             string_to_array(r.dotted, '.'), r.xd);
  END LOOP;
END $loop$;

-- ===========================================================================
-- 10. V — the vocabularies, compared against the constraints that enforce them rather than against a list
--     in a comment, and the derived summary line, compared against the blocks it claims to summarise.
--     A CHECK that gains a status while this projection keeps counting five would turn one of the seven
--     `s11h_vocab` cells red: the intersection below is required to *equal* the schema's own value list.
-- ===========================================================================
CREATE FUNCTION pg_temp.s11h_vocab(label text, p_tbl regclass, p_con text, p_block text[])
RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v text[]; f text[];
BEGIN
  SELECT coalesce(array_agg(m[1] ORDER BY m[1] COLLATE "C"), '{}'::text[]) INTO v
    FROM pg_constraint c, LATERAL regexp_matches(pg_get_constraintdef(c.oid),
                                                 '''([a-zA-Z_0-9]+)''::text', 'g') m
   WHERE c.conrelid = p_tbl AND c.conname = p_con;
  IF v = '{}'::text[] THEN
    RAISE EXCEPTION 'FAIL %: % on % yields no vocabulary, so this cell proves nothing', label,
      p_con, p_tbl::text;
  END IF;
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[]) INTO f
    FROM jsonb_object_keys(pg_temp.s11h_snap('w24') #> p_block) k
   WHERE k = ANY(v);
  IF f IS DISTINCT FROM v THEN
    RAISE EXCEPTION 'FAIL %: the schema admits [%] and the answer counts [%]', label,
      array_to_string(v, ', '), array_to_string(f, ', ');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

-- A grouped counter whose keys are *data*, not fields: every key must be a legal value, and the value list
-- may legitimately be shorter than the vocabulary when the store holds no row of the missing kind.
CREATE FUNCTION pg_temp.s11h_in_vocab(label text, p_tag text, p_block text[], p_tbl regclass,
                                     p_con text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v text[]; k text;
BEGIN
  SELECT coalesce(array_agg(m[1]), '{}'::text[]) INTO v
    FROM pg_constraint c, LATERAL regexp_matches(pg_get_constraintdef(c.oid),
                                                 '''([a-zA-Z_0-9]+)''::text', 'g') m
   WHERE c.conrelid = p_tbl AND c.conname = p_con;
  -- Without this guard the cell passes vacuously when the constraint is not an enum at all: an empty `v`
  -- makes every key fail, which is loud, but an *empty key set* makes the loop run zero times, which is not.
  IF v = '{}'::text[] THEN
    RAISE EXCEPTION 'FAIL %: % on % enumerates no values, so this cell cannot check membership', label,
      p_con, p_tbl::text;
  END IF;
  FOR k IN SELECT key FROM jsonb_each(pg_temp.s11h_snap(p_tag) #> p_block) LOOP
    IF NOT (k = ANY(v)) THEN
      RAISE EXCEPTION 'FAIL %: the answer groups by [%], which % does not admit', label, k, p_con;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

SELECT pg_temp.s11h_vocab('V1 publication delivery counts the five statuses the outputs table enforces',
  'public.invitation_outputs'::regclass, 'invitation_outputs_status_check',
  ARRAY['blocks', 'delivery']);
SELECT pg_temp.s11h_vocab('V2 commerce counts the five processing statuses the events table enforces',
  'private.commerce_payment_events'::regclass, 'commerce_payment_events_processing_status_check',
  ARRAY['blocks', 'commerce']);
SELECT pg_temp.s11h_vocab('V3 orders are counted over the five statuses the orders table enforces',
  'private.commerce_orders'::regclass, 'commerce_orders_status_check',
  ARRAY['blocks', 'commerce', 'orders']);
SELECT pg_temp.s11h_vocab('V4 refunds are counted over the four statuses the refunds table enforces',
  'private.commerce_refunds'::regclass, 'commerce_refunds_status_check',
  ARRAY['blocks', 'commerce', 'refunds']);
SELECT pg_temp.s11h_vocab('V5 cases are counted over the six statuses this stage''s own table enforces',
  'private.support_cases'::regclass, 'support_cases_status_check',
  ARRAY['blocks', 'queue', 'cases']);
SELECT pg_temp.s11h_vocab('V6 privacy requests over the five statuses it enforces, including the two '
  || 'that end outside this build',
  'private.privacy_requests'::regclass, 'privacy_requests_status_check',
  ARRAY['blocks', 'queue', 'privacy_requests']);
SELECT pg_temp.s11h_vocab('V7 audit is grouped over the four actor kinds it enforces, so there is no '
  || 'fifth bucket for a state the table cannot hold',
  'private.audit_events'::regclass, 'audit_events_actor_kind_vocab_check',
  ARRAY['blocks', 'audit', 'by_actor_kind']);
SELECT pg_temp.s11h_in_vocab('V8 every credential kind the answer breaks out is a kind the token table admits',
  'w24', ARRAY['blocks', 'credentials', 'live_by_kind'],
  'private.access_tokens'::regclass, 'access_tokens_token_kind_check');

-- `hold_reason` is NOT an enumerated column: the reason strings are minted by Stage 10's
-- `record_commerce_event` body, and the column's only stored rule is "NULL or non-blank". So
-- `held_by_reason` groups over an open set, and an enum-membership cell written against it would be an
-- instrument that cannot emit its rule. The three cells below check what the schema actually imposes:
-- the vocabulary is open (V9a names the constraint's own text and proves no values are enumerated),
-- every key the answer groups by satisfies the non-blank rule (V9b), and the key set is exactly the
-- store's own distinct held reasons (V9c) — so the map cannot drop a reason the count includes.
SELECT pg_temp.s11h_eq('V9a the hold_reason CHECK enumerates no value, which is why the four closed '
  || 'vocabularies above and this open one are different instruments',
  (SELECT count(*) FROM pg_constraint c,
     LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-zA-Z_0-9]+)''::text', 'g') m
    WHERE c.conname = 'commerce_payment_events_hold_reason_check'), 0::bigint);
SELECT pg_temp.s11h_eq('V9a the same scan over a closed column does find values, so the zero above is an '
  || 'open column and not a regex that never matched',
  (SELECT count(*) FROM pg_constraint c,
     LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-zA-Z_0-9]+)''::text', 'g') m
    WHERE c.conname = 'access_tokens_token_kind_check') > 0, true);
SELECT pg_temp.s11h_eq('V9a the open rule, quoted from the store rather than paraphrased here',
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
    WHERE c.conname = 'commerce_payment_events_hold_reason_check'),
  'CHECK (((hold_reason IS NULL) OR (length(btrim(hold_reason)) > 0)))');

DO $loop$
DECLARE k text;
BEGIN
  FOR k IN SELECT key FROM jsonb_each(pg_temp.s11h_snap('w24') #>
             ARRAY['blocks', 'commerce', 'held_by_reason']) ORDER BY key COLLATE "C" LOOP
    IF length(btrim(k)) = 0 THEN
      RAISE EXCEPTION 'FAIL V9b the answer groups by a blank reconciliation reason';
    END IF;
    RAISE NOTICE 'PASS V9b reason [%] is non-blank, the only rule the store imposes on it', k;
    PERFORM pg_temp.s11h_add(1);
  END LOOP;
END $loop$;

SELECT pg_temp.s11h_array('V9c the reasons the answer groups by are exactly the reasons the events table '
  || 'holds, counted here instead of by the projection',
  (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
     FROM jsonb_object_keys(pg_temp.s11h_snap('w24') #>
           ARRAY['blocks', 'commerce', 'held_by_reason']) k),
  (SELECT coalesce(array_agg(r ORDER BY r COLLATE "C"), '{}'::text[])
     FROM (SELECT DISTINCT e.hold_reason AS r FROM private.commerce_payment_events e
            WHERE e.processing_status = 'held_for_reconciliation' AND e.hold_reason IS NOT NULL) d));

-- `status` is the field decision 8 turns the derived list into, so it is a closed two-value vocabulary and
-- nothing else may use it.
DO $loop$
DECLARE r record;
BEGIN
  FOR r IN SELECT key AS name, value AS b
             FROM jsonb_each(pg_temp.s11h_snap('w24') -> 'blocks') ORDER BY key COLLATE "C" LOOP
    IF r.b ->> 'status' NOT IN ('measured', 'not_measured') THEN
      RAISE EXCEPTION 'FAIL V10 block % has status [%]', r.name, coalesce(r.b ->> 'status', '(none)');
    END IF;
    RAISE NOTICE 'PASS V10 block % carries a status from the two-value vocabulary', r.name;
    PERFORM pg_temp.s11h_add(1);
  END LOOP;
END $loop$;

-- The summary line is derived, so recompute it the way the body did and require the same array.
SELECT pg_temp.s11h_eq('V11 blocks_not_measured is exactly the set of blocks whose own status says '
  || 'not_measured, recomputed here',
  pg_temp.s11h_snap('w24') -> 'blocks_not_measured',
  (SELECT coalesce(jsonb_agg(x.k ORDER BY x.k), '[]'::jsonb)
     FROM (SELECT key AS k FROM jsonb_each(pg_temp.s11h_snap('w24') -> 'blocks')
            WHERE (value ->> 'status') = 'not_measured') x));

SELECT pg_temp.s11h_array('V12 the derived list is the four this schema is short of, by name and in order',
  (SELECT array_agg(b.value #>> '{}' ORDER BY b.ordinality)
     FROM jsonb_array_elements(pg_temp.s11h_snap('w24') -> 'blocks_not_measured')
           WITH ORDINALITY b),
  ARRAY['auth_failures', 'migrations', 'rate_limits', 'token_abuse']);

SELECT pg_temp.s11h_eq('V13 block_count is the blocks object''s own size, not a hand-written ten',
  pg_temp.s11h_num('w24', ARRAY['block_count']),
  (SELECT count(*) FROM jsonb_each(pg_temp.s11h_snap('w24') -> 'blocks'))::numeric);

SELECT pg_temp.s11h_eqs('V14 auth_failures refuses with the sentence that says why', 'w24',
  ARRAY['blocks', 'auth_failures', 'reason'], 'no such store exists in this schema');
SELECT pg_temp.s11h_eqs('V15 rate_limits refuses with the same sentence, so the three are one mechanism', 'w24',
  ARRAY['blocks', 'rate_limits', 'reason'], 'no such store exists in this schema');
SELECT pg_temp.s11h_eqs('V16 token_abuse refuses with the same sentence again', 'w24',
  ARRAY['blocks', 'token_abuse', 'reason'], 'no such store exists in this schema');

DO $loop$
DECLARE r record;
BEGIN
  FOR r IN SELECT key AS name, value AS b FROM jsonb_each(pg_temp.s11h_snap('w24') -> 'blocks')
            WHERE (value ->> 'status') = 'not_measured' ORDER BY key COLLATE "C" LOOP
    IF coalesce(length(btrim(r.b ->> 'reason')), 0) = 0 THEN
      RAISE EXCEPTION 'FAIL V17 block % is not_measured with no reason', r.name;
    END IF;
    RAISE NOTICE 'PASS V17 block % names a non-blank reason for its own absence', r.name;
    PERFORM pg_temp.s11h_add(1);
  END LOOP;
END $loop$;

SELECT pg_temp.s11h_eq('V18 no measured block borrows the absence vocabulary',
  (SELECT count(*) FROM jsonb_each(pg_temp.s11h_snap('w24') -> 'blocks')
    WHERE (value ->> 'status') = 'measured' AND (value ? 'reason' OR value ? 'note')), 0::bigint);

SELECT pg_temp.s11h_eq('V19 writes_anything is the JSON boolean false, not the string "false"',
  jsonb_typeof(pg_temp.s11h_snap('w24') -> 'writes_anything'), 'boolean');
SELECT pg_temp.s11h_eq('V20 identifiers_included is the JSON boolean false',
  jsonb_typeof(pg_temp.s11h_snap('w24') -> 'identifiers_included'), 'boolean');
SELECT pg_temp.s11h_eq('V21 both flags answer false',
  (SELECT count(*) FROM jsonb_each(pg_temp.s11h_snap('w24'))
    WHERE key IN ('writes_anything', 'identifiers_included') AND value = 'false'::jsonb), 2::bigint);

-- ===========================================================================
-- 11. M — the arithmetic. Every partition in this answer is required to close over its own total, and every
--       total is required to equal what the store says when counted directly, in this same transaction, by
--       a query that is not the projection. A plausible number that is not the store's number fails here.
-- ===========================================================================
CREATE FUNCTION pg_temp.s11h_sql(label text, p_tag text, p_path text[], p_want numeric) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v numeric;
BEGIN
  v := pg_temp.s11h_num(p_tag, p_path);
  IF v IS NULL THEN
    RAISE EXCEPTION 'FAIL %: % is absent from the answer or not a number', label,
      array_to_string(p_path, '.');
  ELSIF v <> p_want THEN
    RAISE EXCEPTION 'FAIL %: the answer says % for % but the store itself says %', label, v,
      array_to_string(p_path, '.'), p_want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11h_add(1);
END $fn$;

SELECT pg_temp.s11h_eq('M1 credentials partition closes: live + expired + revoked is total',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'credentials', 'live'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'credentials', 'expired'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'credentials', 'revoked']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'credentials', 'total']));
SELECT pg_temp.s11h_eq('M2 the per-kind live counts close over live',
  pg_temp.s11h_sum('w24', ARRAY['blocks', 'credentials', 'live_by_kind']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'credentials', 'live']));
SELECT pg_temp.s11h_eq('M3 delivery lifecycle closes over its total',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'delivery', 'registered'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'delivery', 'uploading'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'delivery', 'ready'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'delivery', 'failed'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'delivery', 'invalidated']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'delivery', 'total']));
SELECT pg_temp.s11h_eq('M4 payment processing statuses close over events_total',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'applied'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'duplicate'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'rejected_signature'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'held_for_reconciliation'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'stale']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'events_total']));
SELECT pg_temp.s11h_eq('M5 the hold reasons close over the hold count they group',
  pg_temp.s11h_sum('w24', ARRAY['blocks', 'commerce', 'held_by_reason']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'held_for_reconciliation']));
-- M6, M10 and M12 name each status explicitly rather than summing the enclosing object: those objects also
-- carry `total` and overlapping observations, so a whole-object sum would double-count and pass nothing.
-- The lists are the same closed vocabularies V3, V5 and V6 read out of the CHECK constraints, so this file
-- does not invent a status here — it reuses the store's own.
SELECT pg_temp.s11h_eq('M6 order statuses close over the order total',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'orders', 'open'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'orders', 'payment_pending'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'orders', 'captured'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'orders', 'cancelled'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'orders', 'expired']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'orders', 'total']));
SELECT pg_temp.s11h_eq('M7 refund statuses close over the refund total',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'refunds', 'recorded'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'refunds', 'succeeded'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'refunds', 'failed'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'refunds', 'reversed']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'refunds', 'total']));
SELECT pg_temp.s11h_eq('M8 actor kinds close over the audit total',
  pg_temp.s11h_sum('w24', ARRAY['blocks', 'audit', 'by_actor_kind']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'audit', 'total']));
SELECT pg_temp.s11h_eq('M9 action prefixes close over the same total, so the grouping has no remainder',
  pg_temp.s11h_sum('w24', ARRAY['blocks', 'audit', 'by_action_prefix']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'audit', 'total']));
SELECT pg_temp.s11h_eq('M10 case statuses close over the case total',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'open'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'triaged'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'in_progress'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'awaiting_information'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'resolved'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'closed']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'total']));
SELECT pg_temp.s11h_eq('M11 the four live case statuses are the live total',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'open'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'triaged'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'in_progress'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'awaiting_information']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'live_total']));
SELECT pg_temp.s11h_eq('M12 privacy statuses close over the request total',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'privacy_requests', 'received'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'privacy_requests',
                                  'identity_verification_requested'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'privacy_requests', 'queued_for_stage13'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'privacy_requests',
                                  'satisfied_outside_this_build'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'privacy_requests', 'declined']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'privacy_requests', 'total']));
SELECT pg_temp.s11h_eq('M13 the three unresolved privacy statuses are the unresolved total',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'privacy_requests', 'received'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'privacy_requests',
                                  'identity_verification_requested'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'privacy_requests', 'queued_for_stage13']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'privacy_requests', 'unresolved_total']));
SELECT pg_temp.s11h_eq('M14 publication statuses close over its total',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'publication', 'active_total'])
  + pg_temp.s11h_num('w24', ARRAY['blocks', 'publication', 'revoked_total']),
  pg_temp.s11h_num('w24', ARRAY['blocks', 'publication', 'total']));

-- Subset cells: these two fields overlap their partitions by design (decision 5), so they may not exceed
-- them, and the fact that they are *not* required to close is exactly what makes them observations.
SELECT pg_temp.s11h_ok('M15 unclaimed live cases cannot exceed live cases',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'unclaimed_live'])
  <= pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'live_total']));
SELECT pg_temp.s11h_ok('M16 aged cases cannot exceed live cases',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'aged_outside_window'])
  <= pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'cases', 'live_total']));
SELECT pg_temp.s11h_ok('M17 aged unresolved privacy requests cannot exceed the unresolved',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'privacy_requests', 'unresolved_outside_window'])
  <= pg_temp.s11h_num('w24', ARRAY['blocks', 'queue', 'privacy_requests', 'unresolved_total']));
SELECT pg_temp.s11h_ok('M18 a revoked publication cannot be revoked outside the window more often than it exists',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'publication', 'revoked_in_window'])
  <= pg_temp.s11h_num('w24', ARRAY['blocks', 'publication', 'revoked_total']));
SELECT pg_temp.s11h_ok('M19 one active publication per wedding is the schema''s own limit, so this cannot exceed it',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'publication', 'weddings_with_active_publication'])
  <= pg_temp.s11h_num('w24', ARRAY['blocks', 'publication', 'active_total']));
SELECT pg_temp.s11h_ok('M20 refunds without a note cannot exceed refunds',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'refunds', 'without_review_note'])
  <= pg_temp.s11h_num('w24', ARRAY['blocks', 'commerce', 'refunds', 'total']));
SELECT pg_temp.s11h_ok('M21 unlinked operator rows cannot exceed operator rows',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'audit', 'operator_rows_without_case_link', 'count'])
  <= pg_temp.s11h_num('w24', ARRAY['blocks', 'audit', 'by_actor_kind', 'operator']));
SELECT pg_temp.s11h_ok('M22 rows in the window cannot exceed all rows',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'audit', 'rows_in_window'])
  <= pg_temp.s11h_num('w24', ARRAY['blocks', 'audit', 'total']));
SELECT pg_temp.s11h_ok('M23 a failed output at the ceiling is a subset of failures',
  pg_temp.s11h_num('w24', ARRAY['blocks', 'delivery', 'failed_at_attempt_ceiling'])
  <= pg_temp.s11h_num('w24', ARRAY['blocks', 'delivery', 'failed']));

-- The answer counted against the stores, counted again here by ordinary SELECTs. `from_inclusive` is taken
-- from the answer itself, so this is the projection's own window being checked, not this file's guess at it.
SELECT pg_temp.s11h_sql('M24 publication.total is the publications table counted directly', 'w24',
  ARRAY['blocks', 'publication', 'total'],
  (SELECT count(*)::numeric FROM public.publications));
SELECT pg_temp.s11h_sql('M25 active publications, counted directly', 'w24',
  ARRAY['blocks', 'publication', 'active_total'],
  (SELECT count(*)::numeric FROM public.publications WHERE status = 'active'));
SELECT pg_temp.s11h_sql('M26 weddings holding an active publication, counted directly', 'w24',
  ARRAY['blocks', 'publication', 'weddings_with_active_publication'],
  (SELECT count(DISTINCT wedding_id)::numeric FROM public.publications WHERE status = 'active'));
SELECT pg_temp.s11h_sql('M27 publications published inside the answer''s own window', 'w24',
  ARRAY['blocks', 'publication', 'published_in_window'],
  (SELECT count(*)::numeric FROM public.publications p
    WHERE p.published_at >= (pg_temp.s11h_snap('w24') ->> 'from_inclusive')::timestamptz));
SELECT pg_temp.s11h_sql('M28 credentials.total is the token table counted directly', 'w24',
  ARRAY['blocks', 'credentials', 'total'], (SELECT count(*)::numeric FROM private.access_tokens));
SELECT pg_temp.s11h_sql('M29 the live credential predicate, written again from outside the body', 'w24',
  ARRAY['blocks', 'credentials', 'live'],
  (SELECT count(*)::numeric FROM private.access_tokens t
    WHERE t.revoked_at IS NULL
      AND (t.expires_at IS NULL
           OR t.expires_at >= (pg_temp.s11h_snap('w24') ->> 'as_of')::timestamptz)));
SELECT pg_temp.s11h_sql('M30 revoked credentials counted directly', 'w24',
  ARRAY['blocks', 'credentials', 'revoked'],
  (SELECT count(*)::numeric FROM private.access_tokens WHERE revoked_at IS NOT NULL));
SELECT pg_temp.s11h_sql('M31 delivery.total is the outputs table counted directly', 'w24',
  ARRAY['blocks', 'delivery', 'total'], (SELECT count(*)::numeric FROM public.invitation_outputs));
SELECT pg_temp.s11h_sql('M32 outputs at the attempt ceiling, counted directly against the same five the '
  || 'schema caps the column at', 'w24',
  ARRAY['blocks', 'delivery', 'failed_at_attempt_ceiling'],
  (SELECT count(*)::numeric FROM public.invitation_outputs
    WHERE status = 'failed' AND attempt_count >= 5));
SELECT pg_temp.s11h_sql('M33 commerce events counted directly', 'w24',
  ARRAY['blocks', 'commerce', 'events_total'],
  (SELECT count(*)::numeric FROM private.commerce_payment_events));
SELECT pg_temp.s11h_sql('M34 orders counted directly', 'w24',
  ARRAY['blocks', 'commerce', 'orders', 'total'],
  (SELECT count(*)::numeric FROM private.commerce_orders));
SELECT pg_temp.s11h_sql('M35 refunds counted directly', 'w24',
  ARRAY['blocks', 'commerce', 'refunds', 'total'],
  (SELECT count(*)::numeric FROM private.commerce_refunds));
SELECT pg_temp.s11h_sql('M36 refunds with no note row, by the same anti-join the body writes', 'w24',
  ARRAY['blocks', 'commerce', 'refunds', 'without_review_note'],
  (SELECT count(*)::numeric FROM private.commerce_refunds r
    WHERE NOT EXISTS (SELECT 1 FROM private.commerce_review_notes n WHERE n.refund_id = r.id)));
SELECT pg_temp.s11h_sql('M37 audit rows counted directly', 'w24',
  ARRAY['blocks', 'audit', 'total'], (SELECT count(*)::numeric FROM private.audit_events));
SELECT pg_temp.s11h_sql('M38 audit rows carrying a reason, counted directly', 'w24',
  ARRAY['blocks', 'audit', 'with_reason'],
  (SELECT count(*)::numeric FROM private.audit_events WHERE reason IS NOT NULL));
SELECT pg_temp.s11h_sql('M39 operator audit rows with no case event naming their key, counted by the '
  || 'widening join and not by casting the audit column', 'w24',
  ARRAY['blocks', 'audit', 'operator_rows_without_case_link', 'count'],
  (SELECT count(*)::numeric FROM private.audit_events a
    WHERE a.actor_kind = 'operator'
      AND NOT EXISTS (SELECT 1 FROM private.support_case_events e
                       WHERE e.idempotency_key::text = a.idempotency_key)));
SELECT pg_temp.s11h_sql('M40 support cases counted directly', 'w24',
  ARRAY['blocks', 'queue', 'cases', 'total'], (SELECT count(*)::numeric FROM private.support_cases));
SELECT pg_temp.s11h_sql('M41 privacy requests counted directly', 'w24',
  ARRAY['blocks', 'queue', 'privacy_requests', 'total'],
  (SELECT count(*)::numeric FROM private.privacy_requests));

-- ===========================================================================
-- 12. I — the privacy boundary as a scan rather than a paragraph. Decision 1 says the field list *is* the
--     boundary, so the boundary is only proven if the strings that would be visible if the projection leaked
--     a row are absent from the answer's own text. Every needle here was read back out of a planted row in
--     §3, so a plant and its absence check cannot drift apart, and every absence is paired with a presence
--     control that runs the same scanner over the same pattern: an instrument that cannot emit a hit proves
--     nothing about the misses it reports.
-- ===========================================================================
DO $loop$
DECLARE r record;
BEGIN
  FOR r IN SELECT tag, v FROM s11h_needle ORDER BY tag COLLATE "C" LOOP
    IF coalesce(length(btrim(r.v)), 0) = 0 THEN
      RAISE EXCEPTION 'FAIL I1 needle % is blank or absent, so scanning for it could not have failed', r.tag;
    END IF;
    PERFORM pg_temp.s11h_absent('I1 planted value ' || r.tag || ' does not cross the projection',
                                'w24', r.v);
  END LOOP;
END $loop$;

-- The three controls for the `position()` scanner above. Each of these strings *is* in the answer, and each
-- is a string this projection was allowed to surface only because it is a grouped key or a derived name,
-- never because it names a row: `s11hxq` is an audit action *prefix* counted over four rows, and
-- `s11h_hold_amount_mismatch` is a reconciliation category the count is filed under.
SELECT pg_temp.s11h_present('I2a the absence scanner does emit hits — it finds the grouped action prefix',
  'w24', 's11hxq');
SELECT pg_temp.s11h_present('I2b it finds the grouped reconciliation reason', 'w24',
  's11h_hold_amount_mismatch');
SELECT pg_temp.s11h_present('I2c it finds a name from the derived absence list', 'w24', 'auth_failures');
SELECT pg_temp.s11h_absent('I2d and the whole action name behind that prefix is still absent', 'w24',
  's11hxq_operate_linked');

-- Shape scans: no identifier of any kind crosses, whatever its column was called. Each pattern is then run
-- over the planted value it is meant to exclude, so a zero above is the answer's and not the regex's.
DO $scan$
DECLARE
  v_uuid text := '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  v_ref  text := '(SV|PR)-[A-Z234567]{8}';
BEGIN
  PERFORM pg_temp.s11h_no_re('I3 no uuid of any kind appears anywhere in the answer', 'w24', v_uuid);
  PERFORM pg_temp.s11h_re_hits('I3 the same pattern finds the wedding id it exists to exclude',
    (SELECT w1::text FROM s11h_cast), v_uuid, 1);
  PERFORM pg_temp.s11h_no_re('I4 no minted case or request reference appears in the answer', 'w24', v_ref);
  PERFORM pg_temp.s11h_re_hits('I4 the same pattern finds both references this battery planted',
    (SELECT n1.v || ' ' || n2.v FROM s11h_needle n1, s11h_needle n2
      WHERE n1.tag = 'case_ref' AND n2.tag = 'request_ref'), v_ref, 2);
END $scan$;

DO $scan$
DECLARE v_hex text := '[0-9a-f]{64}';
BEGIN
  PERFORM pg_temp.s11h_no_re('I5 no token digest crosses, and a credential is exactly what §9 forbids',
    'w24', v_hex);
  PERFORM pg_temp.s11h_re_hits('I5 the same pattern finds the digest of the credential that was planted',
    pg_temp.s11h_h64('s11h-token-1'), v_hex, 1);
END $scan$;

DO $scan$
DECLARE v_key text := '(outputs|weddings|p)/';
BEGIN
  PERFORM pg_temp.s11h_no_re('I6 no object key path appears in the answer', 'w24', v_key);
  PERFORM pg_temp.s11h_re_hits('I6 the same pattern finds the key minted for the planted output row',
    (SELECT v FROM s11h_needle WHERE tag = 'object_key'), v_key, 1);
END $scan$;

DO $scan$
DECLARE v_prov text := '(razorpay|cashfree)';
BEGIN
  PERFORM pg_temp.s11h_no_re('I7 no provider name appears in the answer: this screen counts events, it does '
    || 'not name the acquirer a host contracted with', 'w24', v_prov);
  PERFORM pg_temp.s11h_re_hits('I7 the same pattern finds both names in the column''s own CHECK',
    (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
      WHERE c.conname = 'commerce_payment_events_provider_check'), v_prov, 2);
END $scan$;

DO $scan$
DECLARE v_mail text := '[^@ ]+@[^@ ]+';
BEGIN
  PERFORM pg_temp.s11h_no_re('I8 no address crosses, so an operator cannot read a household off the health '
    || 'screen', 'w24', v_mail);
  PERFORM pg_temp.s11h_re_hits('I8 the same pattern finds the address this battery seeded into auth.users',
    (SELECT v FROM s11h_needle WHERE tag = 'email'), v_mail, 1);
END $scan$;

-- The prose scan. `S11h` is case-sensitive and appears in every free-text column this battery filled —
-- case threads, note prose, host summaries, render refusals, audit reasons — so a zero here means none of
-- that sentence crossed, while `s11hxq` (lowercase, group-counted) still does.
DO $scan$
DECLARE v_prose text := 'S11h [a-z]';
BEGIN
  PERFORM pg_temp.s11h_no_re('I9 no human sentence from any planted row crosses the projection',
    'w24', v_prose);
  PERFORM pg_temp.s11h_re_hits('I9 the same pattern finds the wedding title this battery gave the row',
    (SELECT v FROM s11h_needle WHERE tag = 'title'), v_prose, 1);
END $scan$;

-- The complete inventory of prose that *does* cross, pinned by path. Group C pins the field names and group
-- L pins every number; this pins every string, so a later slice that adds a `last_error`, a `note`, or a
-- `hold_reason` quote to the answer moves a line here instead of quietly widening the boundary. The list was
-- captured from this cell's own first failure run, not predicted. Timestamps are masked to the class
-- `<timestamp>` because their value is the transaction's `now()` (group W checks them against `as_of`);
-- every other string is compared literally, which is what makes the three absence sentences and the one
-- `note` sentence part of the answer's contract rather than part of its prose.
CREATE FUNCTION pg_temp.s11h_strv(v jsonb, p_prefix text)
RETURNS TABLE (dotted text, val text)
LANGUAGE plpgsql AS $fn$
DECLARE k text; i integer;
BEGIN
  IF jsonb_typeof(v) = 'object' THEN
    FOR k IN SELECT e.key FROM jsonb_object_keys(v) AS e(key) ORDER BY e.key COLLATE "C" LOOP
      RETURN QUERY SELECT * FROM pg_temp.s11h_strv(v -> k,
        CASE WHEN p_prefix = '' THEN k ELSE p_prefix || '.' || k END);
    END LOOP;
  ELSIF jsonb_typeof(v) = 'array' THEN
    FOR i IN 0..jsonb_array_length(v) - 1 LOOP
      RETURN QUERY SELECT * FROM pg_temp.s11h_strv(v -> i, p_prefix || '[' || i || ']');
    END LOOP;
  ELSIF jsonb_typeof(v) = 'string' THEN
    RETURN QUERY SELECT p_prefix, v #>> '{}';
  END IF;
END $fn$;

SELECT pg_temp.s11h_array('I10 every string that crosses this projection, by path',
  (SELECT coalesce(array_agg(dotted || ' = ' ||
                               CASE WHEN val ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]'
                                    THEN '<timestamp>' ELSE val END
                          ORDER BY dotted COLLATE "C"), '{}'::text[])
     FROM pg_temp.s11h_strv(pg_temp.s11h_snap('w24'), '')),
  ARRAY[
    'as_of = <timestamp>',
    'blocks.audit.as_of = <timestamp>',
    'blocks.audit.newest_at = <timestamp>',
    'blocks.audit.status = measured',
    'blocks.auth_failures.as_of = <timestamp>',
    'blocks.auth_failures.reason = no such store exists in this schema',
    'blocks.auth_failures.status = not_measured',
    'blocks.commerce.as_of = <timestamp>',
    'blocks.commerce.newest_at = <timestamp>',
    'blocks.commerce.orders.newest_at = <timestamp>',
    'blocks.commerce.refunds.newest_at = <timestamp>',
    'blocks.commerce.status = measured',
    'blocks.credentials.as_of = <timestamp>',
    'blocks.credentials.last_used_at = <timestamp>',
    'blocks.credentials.newest_at = <timestamp>',
    'blocks.credentials.status = measured',
    'blocks.delivery.as_of = <timestamp>',
    'blocks.delivery.newest_at = <timestamp>',
    'blocks.delivery.status = measured',
    'blocks.migrations.as_of = <timestamp>',
    'blocks.migrations.note = the applied-versus-on-disk comparison is the trusted CLI''s job, '
      || 'because a file listing is not a database fact',
    'blocks.migrations.reason = no supabase_migrations.schema_migrations table exists in this database',
    'blocks.migrations.status = not_measured',
    'blocks.publication.as_of = <timestamp>',
    'blocks.publication.newest_at = <timestamp>',
    'blocks.publication.status = measured',
    'blocks.queue.as_of = <timestamp>',
    'blocks.queue.cases.newest_at = <timestamp>',
    'blocks.queue.privacy_requests.newest_at = <timestamp>',
    'blocks.queue.status = measured',
    'blocks.rate_limits.as_of = <timestamp>',
    'blocks.rate_limits.reason = no such store exists in this schema',
    'blocks.rate_limits.status = not_measured',
    'blocks.token_abuse.as_of = <timestamp>',
    'blocks.token_abuse.reason = no such store exists in this schema',
    'blocks.token_abuse.status = not_measured',
    'blocks_not_measured[0] = auth_failures',
    'blocks_not_measured[1] = migrations',
    'blocks_not_measured[2] = rate_limits',
    'blocks_not_measured[3] = token_abuse',
    'from_inclusive = <timestamp>']);

-- The two halves of the masked field: a timestamp leaf must be *either* the answer's own instant or a moment
-- before it, and the mask above must not be hiding a stray value in the only position a reader trusts.
SELECT pg_temp.s11h_eq('I11 no string leaf is a timestamp that is later than the answer''s own instant',
  (SELECT count(*) FROM pg_temp.s11h_strv(pg_temp.s11h_snap('w24'), '')
    WHERE val ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]'
      AND val::timestamptz > (pg_temp.s11h_snap('w24') ->> 'as_of')::timestamptz), 0::bigint);
SELECT pg_temp.s11h_eq('I12 the mask covers only fields whose own name says they hold a moment, so no '
  || 'reason, note or name field is allowed to carry a timestamp the list would stop comparing',
  (SELECT count(*) FROM pg_temp.s11h_strv(pg_temp.s11h_snap('w24'), '')
    WHERE val ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]'
      AND dotted NOT LIKE '%_at' AND dotted NOT LIKE '%as_of'
      AND dotted NOT LIKE '%from_inclusive'), 0::bigint);
SELECT pg_temp.s11h_eq('I13 the answer''s string leaves divide into the 22 moments the mask stands for and '
  || 'the 19 sentences it compares, and nothing else',
  (SELECT count(*) FILTER (WHERE val ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]')::numeric
     FROM pg_temp.s11h_strv(pg_temp.s11h_snap('w24'), '')),
  (SELECT count(*)::numeric FROM pg_temp.s11h_strv(pg_temp.s11h_snap('w24'), '')) - 19);

-- ===========================================================================
-- 13. P — the legality of the plants, read from the catalogue that made them legal.
--     Each rule is quoted out of `pg_get_constraintdef`, `pg_get_indexdef` or `prosrc`, and then broken, and
--     every breaking statement has an accepted sibling that differs only in the column the rule is about.
--     The sibling is not decoration: an attack that fails with no accepted neighbour proves only that this
--     INSERT fails, not that the named constraint is the reason — a wrong column list, a missing FK target
--     or a refused role would look identical from here. Where three attacks share one shape, the accepted
--     sibling is measured once and the labels say which attack each refusal answers, rather than restating
--     one outcome as three cells.
--
--     Attacks run through `s11h_probe`, and the accepted halves through `s11h_mint` below, which reads the
--     database''s own chosen value back before it aborts the subtransaction. Either way the statement is
--     rolled back, so the counts groups L and M measured above are counts of the same chain this battery
--     will leave behind.
-- ===========================================================================

-- Three builders, because the column lists below are long and a hand-typed list in each cell is where a
-- probe starts testing a different table than the one named in its label. `@ID` is substituted by the
-- runner so the accepted row can be read back inside the same subtransaction.
CREATE FUNCTION pg_temp.s11h_pub_ins(p_wedding text, p_version text, p_id text, p_status text,
                                     p_published text, p_revoked text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT 'INSERT INTO public.publications (id, wedding_id, version_id, status, published_at, revoked_at) '
      || 'VALUES (' || quote_literal(p_id) || ', ' || quote_literal(p_wedding::uuid) || ', '
      || quote_literal(p_version::uuid) || ', '
      || quote_literal(p_status) || ', ' || p_published || ', ' || p_revoked || ')' $fn$;

CREATE FUNCTION pg_temp.s11h_case_ins(p_wedding text, p_requester text, p_id text, p_ref text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT 'INSERT INTO private.support_cases (id, wedding_id, requester_user_id, opened_by_user_id, '
      || 'category, severity, status, host_summary'
      || CASE WHEN p_ref IS NULL THEN '' ELSE ', case_ref' END
      || ') VALUES (' || quote_literal(p_id) || ', ' || quote_literal(p_wedding::uuid) || ', '
      || quote_literal(p_requester::uuid) || ', ' || quote_literal(p_requester::uuid)
      || ', ''publication_delivery'', ''normal'', ''open'', ''S11h probe summary sentence'''
      || CASE WHEN p_ref IS NULL THEN '' ELSE ', ' || quote_literal(p_ref) END || ')' $fn$;

CREATE FUNCTION pg_temp.s11h_priv_ins(p_wedding text, p_requester text, p_id text, p_ref text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT 'INSERT INTO private.privacy_requests (id, wedding_id, requester_user_id, kind, status, '
      || 'host_note, requested_at'
      || CASE WHEN p_ref IS NULL THEN '' ELSE ', request_ref' END
      || ') VALUES (' || quote_literal(p_id) || ', ' || quote_literal(p_wedding::uuid) || ', '
      || quote_literal(p_requester::uuid) || ', ''erasure'', ''received'', ''S11h probe note'', now()'
      || CASE WHEN p_ref IS NULL THEN '' ELSE ', ' || quote_literal(p_ref) END || ')' $fn$;

CREATE FUNCTION pg_temp.s11h_out_ins(p_wedding text, p_version text, p_id text, p_variant text,
                                     p_cfg text, p_key text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT 'INSERT INTO public.invitation_outputs (id, wedding_id, version_id, output_kind, variant, format, '
      || 'render_config_hash, source_dto_digest, storage_domain'
      || CASE WHEN p_key IS NULL THEN '' ELSE ', object_key' END
      || ') VALUES (' || quote_literal(p_id) || ', ' || quote_literal(p_wedding::uuid) || ', '
      || quote_literal(p_version::uuid) || ', ''pdf'', ' || quote_literal(p_variant) || ', ''pdf'', '
      || quote_literal(p_cfg) || ', '
      || quote_literal(pg_temp.s11h_h64('s11p-dto-' || p_variant || '-' || p_cfg))
      || ', ''host_private'''
      || CASE WHEN p_key IS NULL THEN '' ELSE ', ' || quote_literal(p_key) END || ')' $fn$;

-- The accepted half of a mint is worth nothing unless the value the database chose for the row can be seen,
-- so this is `s11h_probe` with one more statement between the insert and the rollback. A real failure still
-- returns its sqlstate, so an insert that stopped being legal is a sentence about the insert.
CREATE FUNCTION pg_temp.s11h_mint(p_stmt text, p_read text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid := gen_random_uuid(); v text;
BEGIN
  BEGIN
    EXECUTE replace(p_stmt, '@ID', v_id::text);
    EXECUTE replace(p_read, '@ID', v_id::text) INTO v;
    RAISE EXCEPTION 's11h_mint_rolled_back';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 's11h_mint_rolled_back' THEN NULL;
    ELSE RETURN SQLSTATE || ' | ' || SQLERRM;
    END IF;
  END;
  RETURN v;
END $fn$;

SELECT pg_temp.s11h_eq('P1 the index that makes a second live publication impossible, quoted from the catalogue',
  (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'one_active_publication_per_wedding'),
  'CREATE UNIQUE INDEX one_active_publication_per_wedding ON public.publications USING btree (wedding_id) '
  || 'WHERE (status = ''active''::text)');

SELECT pg_temp.s11h_eq('P2 the rule that status and its timestamps may not disagree, quoted not paraphrased',
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'publications_check'),
  'CHECK (((status = ''active''::text) = (revoked_at IS NULL)))');

SELECT pg_temp.s11h_eq('P3 the rule that a revocation cannot precede the publication it ends, quoted',
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'publications_check1'),
  'CHECK (((revoked_at IS NULL) OR (revoked_at >= published_at)))');

SELECT pg_temp.s11h_eq('P4 the two words this column may hold, quoted from the CHECK that holds them',
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
    WHERE c.conname = 'publications_status_check'),
  'CHECK ((status = ANY (ARRAY[''active''::text, ''revoked''::text])))');

DO $pub$
DECLARE
  v_w1 text; v_w2 text; v_v1 text; v_v2 text;
  v_ctl text; v_a1 text; v_a2 text; v_a3 text; v_a4 text; v_a5 text;
BEGIN
  SELECT w1::text, w2::text, v1::text, v2::text INTO v_w1, v_w2, v_v1, v_v2 FROM s11h_cast;

  v_a1 := pg_temp.s11h_probe('postgres', NULL,
                             pg_temp.s11h_pub_ins(v_w1, v_v1, '@ID', 'active', 'now()', 'NULL'));
  PERFORM pg_temp.s11h_err_is('P5 a second live publication on the wedding that already has one is refused '
    || 'by the partial unique index', v_a1, '23505', '%one_active_publication_per_wedding%');

  v_a2 := pg_temp.s11h_probe('postgres', NULL,
                             pg_temp.s11h_pub_ins(v_w2, v_v2, '@ID', 'active', 'now()', 'NULL'));
  PERFORM pg_temp.s11h_err_is('P6 the same attack on the other wedding, which also holds a live row, is '
    || 'refused the same way', v_a2, '23505', '%one_active_publication_per_wedding%');

  PERFORM pg_temp.s11h_same('P7 both refusals are one sentence, so the rule is keyed on the wedding in the '
    || 'index and not on the particular row pub1', v_a1, v_a2);

  v_ctl := pg_temp.s11h_mint(pg_temp.s11h_pub_ins(v_w1, v_v1, '@ID', 'revoked', 'now()', 'now()'),
                             'SELECT status FROM public.publications WHERE id = ''@ID''::uuid');
  PERFORM pg_temp.s11h_eq('P8 the wedding may hold a second row as soon as it is retired, which is the '
    || 'accepted sibling of the three refusals below and of P5 and P6 above', v_ctl, 'revoked');

  v_a3 := pg_temp.s11h_probe('postgres', NULL,
                             pg_temp.s11h_pub_ins(v_w1, v_v1, '@ID', 'revoked', 'now()', 'NULL'));
  PERFORM pg_temp.s11h_err_is('P9 a revoked row that names no revocation instant is refused by '
    || 'publications_check, not by the index', v_a3, '23514', '%"publications_check"%');

  v_a4 := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_pub_ins(
    v_w1, v_v1, '@ID', 'revoked', 'now()', 'now() - interval ''1 hour'''));
  PERFORM pg_temp.s11h_err_is('P10 a revocation dated before its own publication is refused by '
    || 'publications_check1', v_a4, '23514', '%"publications_check1"%');

  v_a5 := pg_temp.s11h_probe('postgres', NULL,
                             pg_temp.s11h_pub_ins(v_w1, v_v1, '@ID', 'publishing', 'now()', 'now()'));
  PERFORM pg_temp.s11h_err_is('P11 a third status word is refused by publications_status_check, and this '
    || 'row is otherwise shaped exactly like the accepted one at P8', v_a5, '23514',
    '%"publications_status_check"%');
END $pub$;

DO $mint$
DECLARE
  v_w1 text; v_v1 text; v_host text;
  v_case_legal text; v_case_illegal text; v_minted_case text;
  v_priv_supplied text; v_minted_priv text;
  v_key_supplied text; v_key_minted text; v_key_blank text;
  v_dup text; v_newcfg text;
  v_cfg_o1 text;
BEGIN
  SELECT w1::text, v1::text, host_1::text INTO v_w1, v_v1, v_host FROM s11h_cast;
  v_cfg_o1 := pg_temp.s11h_h64('s11h-cfg-o1');

  -- The ref a caller would like to use, and a string that could never be one at all. Both are refused by
  -- the same sentence, which is what proves the refusal is about *who chose the value*: if the mint fired
  -- after the column CHECK, the second insert would have been refused for its shape instead.
  v_case_legal := pg_temp.s11h_probe('postgres', NULL,
    pg_temp.s11h_case_ins(v_w1, v_host, '@ID', 'SV-AAAAAAAA'));
  PERFORM pg_temp.s11h_err_is('P12 a support case that brings its own ref is refused outright, not '
    || 'normalised, because the ref is the string a later takedown or refund note names as its '
    || 'authorisation', v_case_legal, '42501', '%a support case ref is minted by the database%');

  v_case_illegal := pg_temp.s11h_probe('postgres', NULL,
    pg_temp.s11h_case_ins(v_w1, v_host, '@ID', 'a string that could never be a case ref'));
  PERFORM pg_temp.s11h_err_is('P13 a ref that could never satisfy the column''s own shape is refused by the '
    || 'same provenance sentence, so the CHECK on the shape never gets to speak',
    v_case_illegal, '42501', '%a support case ref is minted by the database%');
  PERFORM pg_temp.s11h_same('P13 the two refusals above are one sentence, which is how this pair separates '
    || 'a minting rule from a validation rule', v_case_legal, v_case_illegal);

  v_minted_case := pg_temp.s11h_mint(
    pg_temp.s11h_case_ins(v_w1, v_host, '@ID', NULL),
    'SELECT CASE WHEN case_ref ~ ''^SV-[A-Z2-7]{8}$'' THEN ''minted-shape'' ELSE coalesce(case_ref, '
    || '''<null>'') END FROM private.support_cases WHERE id = ''@ID''::uuid');
  PERFORM pg_temp.s11h_eq('P15 the row that names no ref is accepted and the ref the database chose for it '
    || 'has the shape P14 quotes from its column CHECK', v_minted_case, 'minted-shape');

  v_priv_supplied := pg_temp.s11h_probe('postgres', NULL,
    pg_temp.s11h_priv_ins(v_w1, v_host, '@ID', 'PR-AAAAAAAA'));
  PERFORM pg_temp.s11h_err_is('P17 the same rule on the other authorisation carrier: a privacy request '
    || 'that brings its own ref is refused', v_priv_supplied, '42501',
    '%a privacy request ref is minted by the database%');

  v_minted_priv := pg_temp.s11h_mint(
    pg_temp.s11h_priv_ins(v_w1, v_host, '@ID', NULL),
    'SELECT CASE WHEN request_ref ~ ''^PR-[A-Z2-7]{8}$'' THEN ''minted-shape'' ELSE '
    || 'coalesce(request_ref, ''<null>'') END FROM private.privacy_requests WHERE id = ''@ID''::uuid');
  PERFORM pg_temp.s11h_eq('P18 and the accepted one is minted with its own prefix, not the support case''s, '
    || 'so the two carriers cannot be confused on a phone screen', v_minted_priv, 'minted-shape');

  v_key_supplied := pg_temp.s11h_probe('postgres', NULL,
    pg_temp.s11h_out_ins(v_w1, v_v1, '@ID', 'a4', pg_temp.s11h_h64('s11p-cfg-attack'),
                         'outputs/any/wedding/any/path'));
  PERFORM pg_temp.s11h_err_is('P20 a storage path handed to the artefact table is refused rather than '
    || 'rewritten, so "the client chose it" can never be mistaken for "the server chose it"',
    v_key_supplied, '42501', '%object_key is minted by the database and cannot be supplied%');

  v_key_minted := pg_temp.s11h_mint(
    pg_temp.s11h_out_ins(v_w1, v_v1, '@ID', 'a4', pg_temp.s11h_h64('s11p-cfg-minted'), NULL),
    'SELECT CASE WHEN object_key = ''outputs/' || v_w1 || '/pdf/a4/@ID'' THEN ''composed-from-the-row'' '
    || 'ELSE coalesce(object_key, ''<null>'') END FROM public.invitation_outputs WHERE id = ''@ID''::uuid');
  PERFORM pg_temp.s11h_eq('P21 the omitted key comes back as the private-domain composition the trigger '
    || 'performs: wedding, kind, geometry, then the row''s own id', v_key_minted, 'composed-from-the-row');

  -- The trigger's own test is `IS NOT NULL AND btrim(key) <> ''`, so a blank string is not "supplied" by its
  -- definition and is minted anyway. Measured here rather than read off the source, because the source is
  -- what P23 quotes and this cell is what proves the quote means what it says.
  v_key_blank := pg_temp.s11h_mint(
    pg_temp.s11h_out_ins(v_w1, v_v1, '@ID', 'a4', pg_temp.s11h_h64('s11p-cfg-blank'), ''),
    'SELECT CASE WHEN object_key LIKE ''outputs/%'' THEN ''minted-not-blank'' ELSE '
    || 'coalesce(object_key, ''<null>'') END FROM public.invitation_outputs WHERE id = ''@ID''::uuid');
  PERFORM pg_temp.s11h_eq('P22 a blank key is accepted and still minted, which is the boundary the '
    || 'trigger''s own non-blank test draws', v_key_blank, 'minted-not-blank');

  v_dup := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_out_ins(v_w1, v_v1, '@ID', 'a4', v_cfg_o1, NULL));
  PERFORM pg_temp.s11h_err_is('P26 a second artefact for the same version, kind, geometry, format, page and '
    || 'config is refused by the determinism key', v_dup, '23505',
    '%invitation_outputs_version_id_output_kind_variant_format_pa_key%');

  v_newcfg := pg_temp.s11h_mint(
    pg_temp.s11h_out_ins(v_w1, v_v1, '@ID', 'a4', pg_temp.s11h_h64('s11p-cfg-other'), NULL),
    'SELECT CASE WHEN object_key LIKE ''outputs/%'' THEN ''re-render-is-a-new-row'' ELSE '
    || 'coalesce(object_key, ''<null>'') END FROM public.invitation_outputs WHERE id = ''@ID''::uuid');
  PERFORM pg_temp.s11h_eq('P27 the same artefact under a changed config is a new row, which is what makes '
    || '"this output predates that change" a query about two rows', v_newcfg, 're-render-is-a-new-row');
END $mint$;

SELECT pg_temp.s11h_eq('P14 the support case''s own shape rule, quoted from the catalogue so P15 checks the '
  || 'mint against a stated fact rather than a paraphrase',
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
    WHERE c.conname = 'support_cases_case_ref_check'),
  'CHECK ((case_ref ~ ''^SV-[A-Z2-7]{8}$''::text))');

SELECT pg_temp.s11h_ok('P16 the case-ref mint sentence is in the trigger body that raises it, not only in a '
  || 'comment beside it',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private' AND p.proname = 'mint_support_case_ref'
       AND p.prosrc LIKE '%a support case ref is minted by the database, never supplied%') = 1);

SELECT pg_temp.s11h_ok('P19 the privacy mint sentence is likewise inside the body that raises it',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private' AND p.proname = 'mint_privacy_request_ref'
       AND p.prosrc LIKE '%a privacy request ref is minted by the database, never supplied%') = 1);

SELECT pg_temp.s11h_ok('P23 the artefact trigger''s test for "supplied" is a non-blank test, quoted from the '
  || 'body — this is the sentence P22 measures',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private' AND p.proname = 'mint_invitation_output_key'
       AND p.prosrc LIKE '%IF NEW.object_key IS NOT NULL AND btrim(NEW.object_key) <> '''' THEN%') = 1);

SELECT pg_temp.s11h_ok('P24 and the refusal it raises for a supplied key is the sentence P20 saw on the wire',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private' AND p.proname = 'mint_invitation_output_key'
       AND p.prosrc LIKE '%invitation_outputs.object_key is minted by the database and cannot be supplied%') = 1);

-- Scoped to the six rows this file planted, on purpose: `invitation_outputs` also holds artefacts another
-- battery committed, and an `og_image` in the published domain legitimately carries the `p/…` shape the same
-- trigger chooses, so a store-wide "all keys look like this" would be a claim the schema never made.
SELECT pg_temp.s11h_eq('P25 the six artefacts this battery walked carry the key the database composed from '
  || 'their own columns, including the four that moved through the lifecycle since they were born',
  (SELECT count(*) FROM public.invitation_outputs o
     JOIN s11h_cast c ON c.o1 IN (o.id) OR c.o2 IN (o.id) OR c.o3 IN (o.id)
                     OR c.o4 IN (o.id) OR c.o5 IN (o.id) OR c.o6 IN (o.id)
    WHERE o.object_key IS DISTINCT FROM 'outputs/' || o.wedding_id::text || '/' || o.output_kind || '/'
                                          || o.variant || '/' || o.id::text),
  0::bigint);

SELECT pg_temp.s11h_eq('P25b and all six sit in the private storage domain, which is why the composition '
  || 'above is the branch the trigger took rather than the published-preview one',
  (SELECT count(*) FROM public.invitation_outputs o
     JOIN s11h_cast c ON c.o1 IN (o.id) OR c.o2 IN (o.id) OR c.o3 IN (o.id)
                     OR c.o4 IN (o.id) OR c.o5 IN (o.id) OR c.o6 IN (o.id)
    WHERE o.storage_domain IS DISTINCT FROM 'host_private'),
  0::bigint);

SELECT pg_temp.s11h_eq('P28 the uniqueness that stops two artefacts claiming one stored object, quoted from '
  || 'the catalogue',
  (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'invitation_outputs_object_key_key'),
  'CREATE UNIQUE INDEX invitation_outputs_object_key_key ON public.invitation_outputs USING btree '
  || '(object_key)');

-- ===========================================================================
-- 14. T — the rules the credential block counts *through*.
--     `api.operator_operations_summary` answers `live`, `expired`, `revoked`, `never_used`,
--     `used_in_window` and `live_by_kind` for `private.access_tokens`, a store no client can read. Group L
--     proved the arithmetic identity over those numbers, but an identity cannot notice that one publication
--     holds two live links — the count would simply report two. So the three `one_live_*` partial unique
--     indexes, the two vocabulary CHECKs, the three timestamp CHECKs, the shape CASE and the four composite
--     foreign keys are quoted out of the catalogue here and each one is then broken, with an accepted sibling
--     that differs only in the column the named rule governs.
--
--     The eight credentials in §2 were planted by hand, so this group doubles as the proof they are legal:
--     that is what makes them a fixture the counts were read over rather than an accident of what this chain
--     happened to allow.
--
--     Attacks run through `s11h_probe` and the accepted halves through `s11h_mint`, so the store keeps the
--     shape group L measured. Two permanent rows are added here — a fourth household and this chain's first
--     approval request — because an accepted sibling needs somewhere to sit that the live indexes have not
--     already claimed, and neither store is one the projection counts.
--
--     The last section answers a different question: what a client hand can do to this store at all. It is
--     measured in three layers, and the layers turn out not to be the one the schema comment implies, so it
--     is stated as measured rather than as designed.
-- ===========================================================================

-- The shape rule below is a CASE expression, which `pg_get_constraintdef` pretty-prints across several lines.
-- Pinning a multi-line literal would pin the printer as much as the rule, so whitespace is flattened first
-- and the pin says so.
CREATE FUNCTION pg_temp.s11h_flat(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT btrim(regexp_replace(p, '\s+', ' ', 'g')) $fn$;

-- `@ID` is a uuid in every builder below, so the accepted row can be named by the runner that inserts it and
-- read back inside the same subtransaction.
CREATE FUNCTION pg_temp.s11h_u(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN p IS NULL THEN 'NULL' ELSE quote_literal(p) || '::uuid' END $fn$;

CREATE FUNCTION pg_temp.s11h_tok_ins(p_id text, p_hash text, p_kind text, p_wedding text, p_pub text,
                                     p_hh text, p_apr text, p_ver text, p_policy text, p_expires text,
                                     p_revoked text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT 'INSERT INTO private.access_tokens (id, token_hash, token_kind, wedding_id, publication_id, '
      || 'household_id, approval_request_id, approval_version_id, expiry_policy, expires_at, revoked_at, '
      || 'created_at) VALUES (' || pg_temp.s11h_u(p_id) || ', ' || quote_literal(p_hash) || ', '
      || quote_literal(p_kind) || ', ' || pg_temp.s11h_u(p_wedding) || ', ' || pg_temp.s11h_u(p_pub)
      || ', ' || pg_temp.s11h_u(p_hh) || ', ' || pg_temp.s11h_u(p_apr) || ', ' || pg_temp.s11h_u(p_ver)
      || ', ' || quote_literal(p_policy) || ', ' || coalesce(p_expires, 'NULL') || ', '
      || coalesce(p_revoked, 'NULL') || ', now())' $fn$;

-- A client role given table privileges it does not normally hold, so the row-level rules of this store can be
-- reached from the client side at all. The grants, the statement and the read-back all live in one
-- subtransaction that a marker exception aborts, which was verified against this cluster before it was
-- written down here: after the abort `pg_class.relacl` for the schema and the table read back exactly as they
-- were. The read-back runs *after* `RESET ROLE`, so it is the superuser counting the store, not the client
-- counting the rows it is allowed to see — that distinction is what makes the UPDATE and DELETE cells below
-- mean something.
CREATE FUNCTION pg_temp.s11h_wide(p_role text, p_grants text, p_stmt text, p_read text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_out text; v_after text; v_id uuid := gen_random_uuid();
BEGIN
  IF p_role NOT IN ('anon', 'authenticated', 'service_role', 'postgres') THEN
    RAISE EXCEPTION 'FAIL: wide probe role % is not one this file may assume', p_role;
  END IF;
  BEGIN
    BEGIN
      BEGIN
        IF p_role IN ('anon', 'authenticated') THEN
          EXECUTE 'GRANT USAGE ON SCHEMA private TO ' || p_role;
        END IF;
        IF p_grants IS NOT NULL THEN
          EXECUTE replace(p_grants, '@ID', v_id::text);
        END IF;
        EXECUTE 'SET ROLE ' || p_role;
        BEGIN
          EXECUTE replace(p_stmt, '@ID', v_id::text);
          v_out := 'ACCEPTED';
        EXCEPTION WHEN OTHERS THEN
          v_out := SQLSTATE || ' | ' || SQLERRM;
        END;
        BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN OTHERS THEN NULL; END;
        IF p_read IS NOT NULL THEN
          EXECUTE replace(p_read, '@ID', v_id::text) INTO v_after;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN OTHERS THEN NULL; END;
        RAISE EXCEPTION 'FAIL s11h_wide setup as %: %', p_role, SQLERRM;
      END;
      RAISE EXCEPTION 's11h_wide_rolled_back';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 's11h_wide_rolled_back' THEN NULL; ELSE RAISE; END IF;
    END;
  END;
  RETURN CASE WHEN v_after IS NULL THEN v_out ELSE v_out || ' / ' || v_after END;
END $fn$;

CREATE TEMP TABLE s11h_t ON COMMIT DROP AS
SELECT gen_random_uuid() AS hh4, gen_random_uuid() AS apr, gen_random_uuid() AS apr0,
       gen_random_uuid() AS bogus;

-- The household every `guest_invitation` shape control needs: §2's three households each already hold a live
-- guest credential, which is the point of `one_live_guest_token_per_household`, so an *accepted* guest-shaped
-- row requires a fourth. `public.approval_requests` measured zero committed rows on this chain, and the
-- approval credential rules cannot be attacked without a request to bind to, so two are planted here in the
-- shape the schema's own CHECKs describe — `pending`, unanswered, on wedding `w1`'s version `v1`. They are
-- two rather than one because the per-request liveness index takes the same part twice: `apr0` is the request
-- group T keeps a live link on, to collide with, and `apr` is the request the shape and reference controls
-- bind to while still holding no link — a single request would force an accepted sibling to differ from its
-- refusal in the request as well as in the column the branch under test names.
INSERT INTO public.guest_households (id, wedding_id, display_name)
SELECT t.hh4, c.w1, 'S11h household four (group T shape control)' FROM s11h_cast c CROSS JOIN s11h_t t;

INSERT INTO public.approval_requests (id, wedding_id, version_id, reviewer_display_name, status,
                                      requested_at, created_at, updated_at)
SELECT t.k, c.w1, c.v1, 'S11h group T reviewer', 'pending', now(), now(), now()
  FROM s11h_cast c CROSS JOIN (SELECT apr AS k FROM s11h_t UNION ALL SELECT apr0 FROM s11h_t) t;

SELECT pg_temp.s11h_eq('T1 the rule that one publication holds at most one live public link, quoted from the '
  || 'catalogue — this is what makes `live_by_kind.public_invitation` a count of links rather than of rows',
  (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'one_live_public_token_per_publication'),
  'CREATE UNIQUE INDEX one_live_public_token_per_publication ON private.access_tokens USING btree '
  || '(publication_id) WHERE ((revoked_at IS NULL) AND (token_kind = ''public_invitation''::text) '
  || 'AND (publication_id IS NOT NULL))');

SELECT pg_temp.s11h_eq('T2 the same rule for a household''s guest link, keyed on the household and on the '
  || 'kind of credential',
  (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'one_live_guest_token_per_household'),
  'CREATE UNIQUE INDEX one_live_guest_token_per_household ON private.access_tokens USING btree '
  || '(household_id) WHERE ((revoked_at IS NULL) AND (token_kind = ''guest_invitation''::text) '
  || 'AND (household_id IS NOT NULL))');

SELECT pg_temp.s11h_eq('T3 and the third class the partition can hold: one live review link per approval '
  || 'request',
  (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'one_live_token_per_approval_request'),
  'CREATE UNIQUE INDEX one_live_token_per_approval_request ON private.access_tokens USING btree '
  || '(approval_request_id) WHERE ((revoked_at IS NULL) AND (token_kind = ''approval_review''::text) '
  || 'AND (approval_request_id IS NOT NULL))');

SELECT pg_temp.s11h_eq('T4 the uniqueness that stops two rows being one credential, quoted',
  (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'access_tokens_token_hash_key'),
  'CREATE UNIQUE INDEX access_tokens_token_hash_key ON private.access_tokens USING btree (token_hash)');

SELECT pg_temp.s11h_eq('T5 the digest this store accepts is lowercase hex, so `total` cannot be inflated by '
  || 'two spellings of one link',
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
    WHERE c.conname = 'access_tokens_token_hash_check'),
  'CHECK ((token_hash ~ ''^[0-9a-f]{64}$''::text))');

SELECT pg_temp.s11h_eq('T6 the rule that makes `expired` well-defined: a fixed window is exactly a row that '
  || 'carries an instant',
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'access_tokens_check'),
  'CHECK (((expiry_policy = ''fixed''::text) = (expires_at IS NOT NULL)))');

SELECT pg_temp.s11h_eq('T7 an expiry may not predate the row that holds it, which is why `expired` means a '
  || 'link that ran out and not a row that was never valid',
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'access_tokens_check1'),
  'CHECK (((expires_at IS NULL) OR (expires_at > created_at)))');

SELECT pg_temp.s11h_eq('T8 and a revocation may not predate its own row, for the same reason about '
  || '`revoked`',
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'access_tokens_check2'),
  'CHECK (((revoked_at IS NULL) OR (revoked_at >= created_at)))');

SELECT pg_temp.s11h_eq('T9 the three expiry words this store can hold, quoted from the CHECK that holds them',
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
    WHERE c.conname = 'access_tokens_expiry_policy_check'),
  'CHECK ((expiry_policy = ANY (ARRAY[''fixed''::text, ''event_date''::text, ''no_expiry''::text])))');

SELECT pg_temp.s11h_eq('T10 the four credential classes `live_by_kind` can ever have keys for',
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
    WHERE c.conname = 'access_tokens_token_kind_check'),
  'CHECK ((token_kind = ANY (ARRAY[''public_invitation''::text, ''guest_invitation''::text, '
  || '''rsvp''::text, ''approval_review''::text])))');

SELECT pg_temp.s11h_eq('T11 the shape rule that ties each class to the bindings it must carry, quoted with '
  || 'its whitespace flattened (see s11h_flat above)',
  pg_temp.s11h_flat((SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                      WHERE c.conname = 'access_tokens_kind_shape')),
  'CHECK ( CASE token_kind WHEN ''public_invitation''::text THEN ((publication_id IS NOT NULL) '
  || 'AND (household_id IS NULL) AND (approval_request_id IS NULL) AND (approval_version_id IS NULL)) '
  || 'WHEN ''guest_invitation''::text THEN ((publication_id IS NOT NULL) AND (household_id IS NOT NULL) '
  || 'AND (approval_request_id IS NULL) AND (approval_version_id IS NULL)) '
  || 'WHEN ''rsvp''::text THEN ((publication_id IS NOT NULL) AND (household_id IS NOT NULL) '
  || 'AND (approval_request_id IS NULL) AND (approval_version_id IS NULL)) '
  || 'WHEN ''approval_review''::text THEN ((approval_request_id IS NOT NULL) '
  || 'AND (approval_version_id IS NOT NULL) AND (publication_id IS NULL) AND (household_id IS NULL)) '
  || 'ELSE NULL::boolean END)');

-- Each key is a *pair* with the wedding, which is the difference between a credential that belongs to a host
-- and a credential that merely names a row from somewhere else. A single-column reference would have let the
-- second through, and the block would have counted it.
SELECT pg_temp.s11h_array('T12 the four bindings this store keeps, quoted: every one of them carries '
  || 'wedding_id beside the row it points at',
  (SELECT coalesce(array_agg(pg_get_constraintdef(c.oid) ORDER BY c.conname COLLATE "C"), '{}'::text[])
     FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'access_tokens' AND c.contype = 'f'),
  ARRAY['FOREIGN KEY (wedding_id, approval_request_id, approval_version_id) REFERENCES '
        || 'approval_requests(wedding_id, id, version_id)',
        'FOREIGN KEY (wedding_id) REFERENCES weddings(id)',
        'FOREIGN KEY (wedding_id, household_id) REFERENCES guest_households(wedding_id, id)',
        'FOREIGN KEY (wedding_id, publication_id) REFERENCES publications(wedding_id, id)']);

DO $live$
DECLARE
  v_w1 text; v_w2 text; v_pub1 text; v_pub3 text; v_v1 text; v_hh1 text; v_hh4 text; v_apr0 text;
  v_a1 text; v_a2 text; v_a3 text; v_c1 text; v_c2 text; v_c3 text; v_apr_live integer;
BEGIN
  SELECT w1::text, w2::text, v1::text, pub1::text, pub3::text, hh1::text INTO v_w1, v_w2, v_v1, v_pub1,
         v_pub3, v_hh1 FROM s11h_cast;
  SELECT hh4::text, apr0::text INTO v_hh4, v_apr0 FROM s11h_t;

  v_a1 := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-tok-a1'), 'public_invitation', v_w1, v_pub1, NULL, NULL, NULL,
        'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T13 a second live public link on the publication that already has one is '
    || 'refused by the index quoted at T1', v_a1, '23505', '%one_live_public_token_per_publication%');

  v_c1 := pg_temp.s11h_mint(pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-tok-c1'), 'public_invitation', v_w1, v_pub1, NULL, NULL, NULL,
        'no_expiry', NULL, 'now()'),
        'SELECT CASE WHEN revoked_at IS NULL THEN ''live'' ELSE ''revoked'' END '
        || 'FROM private.access_tokens WHERE id = ''@ID''::uuid');
  PERFORM pg_temp.s11h_eq('T14 the accepted sibling of T13 is the same row with a revocation instant, which '
    || 'is the one column the index predicate names — so the refusal is about liveness, not about pub1', v_c1,
    'revoked');

  v_a2 := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-tok-a2'), 'guest_invitation', v_w1, v_pub1, v_hh1, NULL, NULL,
        'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T15 a second live guest link for the household that already has one is refused '
    || 'by the index quoted at T2', v_a2, '23505', '%one_live_guest_token_per_household%');

  v_c2 := pg_temp.s11h_mint(pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-tok-c2'), 'guest_invitation', v_w1, v_pub1, v_hh4, NULL, NULL,
        'no_expiry', NULL, NULL),
        'SELECT token_kind FROM private.access_tokens WHERE id = ''@ID''::uuid');
  PERFORM pg_temp.s11h_eq('T16 and the same statement is legal the moment the household changes, which is '
    || 'what proves the key is the household and not the wedding', v_c2, 'guest_invitation');

  v_c3 := pg_temp.s11h_mint(pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-tok-c3'), 'rsvp', v_w1, v_pub1, v_hh1, NULL, NULL,
        'no_expiry', NULL, NULL),
        'SELECT token_kind FROM private.access_tokens WHERE id = ''@ID''::uuid');
  PERFORM pg_temp.s11h_eq('T17 an rsvp link coexists with the live guest link on the same household, because '
    || 'the household index is keyed on the kind — the pair §2''s t2/t3 plant relies on', v_c3, 'rsvp');

  -- The first review link is planted *here*, permanently, because §2's eight credentials deliberately carry
  -- none and group V has already read the credential block by the time this line runs: a ninth row there
  -- would move the counts V measures. A collision attack needs a row that outlives the probe that inserts
  -- it, which is the one difference between this group and T13/T15, whose first links §2 already holds.
  INSERT INTO private.access_tokens (id, token_hash, token_kind, wedding_id, publication_id, household_id,
                                     approval_request_id, approval_version_id, expiry_policy, expires_at,
                                     revoked_at, created_at)
  SELECT gen_random_uuid(), pg_temp.s11h_h64('s11h-tok-apr-live'), 'approval_review', c.w1, NULL, NULL,
         t.apr0, c.v1, 'no_expiry', NULL::timestamptz, NULL::timestamptz, now()
    FROM s11h_cast c CROSS JOIN s11h_t t;

  SELECT count(*) INTO v_apr_live FROM private.access_tokens
    WHERE approval_request_id = v_apr0::uuid AND revoked_at IS NULL;
  PERFORM pg_temp.s11h_eq('T18 the live review link this block just planted is there to collide with — one '
    || 'row, unrevoked, on the request group T keeps a live link on', v_apr_live::text, '1');

  v_a3 := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-tok-a3'), 'approval_review', v_w1, NULL, NULL, v_apr0, v_v1,
        'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T19 a second live link for the request that already holds one is refused by '
    || 'the index quoted at T3', v_a3, '23505', '%one_live_token_per_approval_request%');

  PERFORM pg_temp.s11h_eq('T20 the same second link is legal once revoked, so T19 refuses the live pair and '
    || 'not the row',
    pg_temp.s11h_mint(pg_temp.s11h_tok_ins('@ID',
      pg_temp.s11h_h64('s11h-tok-b2'), 'approval_review', v_w1, NULL, NULL, v_apr0, v_v1,
      'no_expiry', NULL, 'now()'),
      'SELECT CASE WHEN revoked_at IS NULL THEN ''live'' ELSE ''revoked'' END '
      || 'FROM private.access_tokens WHERE id = ''@ID''::uuid'), 'revoked');
END $live$;

DO $hash$
DECLARE
  v_w2 text; v_pub3 text;
  v_dup text; v_fresh text; v_plain text; v_upper text;
BEGIN
  SELECT w2::text, pub3::text INTO v_w2, v_pub3 FROM s11h_cast;

  v_dup := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-token-1'), 'public_invitation', v_w2, v_pub3, NULL, NULL, NULL,
        'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T21 a second row carrying t1''s own digest is refused by the uniqueness at T4 '
    || 'even though it sits on a publication with no live public link — the store deduplicates credentials, '
    || 'not placements', v_dup, '23505', '%access_tokens_token_hash_key%');

  v_fresh := pg_temp.s11h_mint(pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-tok-fresh'), 'public_invitation', v_w2, v_pub3, NULL, NULL, NULL,
        'no_expiry', NULL, NULL),
        'SELECT token_kind FROM private.access_tokens WHERE id = ''@ID''::uuid');
  PERFORM pg_temp.s11h_eq('T22 the accepted sibling of T21 differs only in the digest', v_fresh,
    'public_invitation');

  v_plain := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
        'not-a-digest', 'public_invitation', v_w2, v_pub3, NULL, NULL, NULL, 'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T23 a value that is not a digest at all is refused by the CHECK at T5',
    v_plain, '23514', '%"access_tokens_token_hash_check"%');

  v_upper := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
        upper(pg_temp.s11h_h64('s11h-tok-upper')), 'public_invitation', v_w2, v_pub3, NULL, NULL, NULL,
        'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T24 and so is the same 64 hex characters in uppercase, which is the abnormal '
    || 'value that a producer writing a differently-cased digest would leave behind — T5 is case-sensitive, '
    || 'so `total` cannot count one link twice', v_upper, '23514', '%"access_tokens_token_hash_check"%');
END $hash$;

DO $when$
DECLARE
  v_w1 text; v_pub1 text; v_hh1 text;
  v_fixed_null text; v_open_set text; v_when_past text; v_revoked_past text;
  c_fixed text; c_revoked text;
BEGIN
  SELECT w1::text, pub1::text, hh1::text INTO v_w1, v_pub1, v_hh1 FROM s11h_cast;

  v_fixed_null := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-tok-w1'), 'rsvp', v_w1, v_pub1, v_hh1, NULL, NULL,
        'fixed', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T25 a `fixed` window with no instant in it is refused by the CHECK at T6',
    v_fixed_null, '23514', '%"access_tokens_check"%');

  v_open_set := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-tok-w2'), 'rsvp', v_w1, v_pub1, v_hh1, NULL, NULL,
        'no_expiry', 'now() + interval ''1 hour''', NULL));
  PERFORM pg_temp.s11h_err_is('T26 and a `no_expiry` row that carries an instant is refused the same way, so '
    || 'the block''s `expired` filter cannot silently miss a class', v_open_set, '23514',
    '%"access_tokens_check"%');

  PERFORM pg_temp.s11h_same('T27 both directions of T6 are one sentence, which is what makes it one rule '
    || 'rather than two coincidences', v_fixed_null, v_open_set);

  c_fixed := pg_temp.s11h_mint(pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-tok-w3'), 'rsvp', v_w1, v_pub1, v_hh1, NULL, NULL,
        'fixed', 'now() + interval ''1 hour''', NULL),
        'SELECT expiry_policy FROM private.access_tokens WHERE id = ''@ID''::uuid');
  PERFORM pg_temp.s11h_eq('T28 the accepted sibling of T25 and T26 differs only in matching the policy to '
    || 'the instant', c_fixed, 'fixed');

  v_when_past := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-tok-w4'), 'rsvp', v_w1, v_pub1, v_hh1, NULL, NULL,
        'fixed', 'now() - interval ''1 hour''', NULL));
  PERFORM pg_temp.s11h_err_is('T29 an expiry dated before the row''s own creation is refused by T7 — §2''s t4 '
    || 'is the legal shape of the same idea, created two hours ago and expiring an hour ago', v_when_past,
    '23514', '%"access_tokens_check1"%');

  v_revoked_past := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-tok-w5'), 'rsvp', v_w1, v_pub1, v_hh1, NULL, NULL,
        'no_expiry', NULL, 'now() - interval ''2 hours'''));
  PERFORM pg_temp.s11h_err_is('T30 and a revocation dated before the row is refused by T8', v_revoked_past,
    '23514', '%"access_tokens_check2"%');

  c_revoked := pg_temp.s11h_mint(pg_temp.s11h_tok_ins('@ID',
        pg_temp.s11h_h64('s11h-tok-w6'), 'rsvp', v_w1, v_pub1, v_hh1, NULL, NULL,
        'no_expiry', NULL, 'now()'),
        'SELECT CASE WHEN revoked_at IS NULL THEN ''live'' ELSE ''revoked'' END '
        || 'FROM private.access_tokens WHERE id = ''@ID''::uuid');
  PERFORM pg_temp.s11h_eq('T31 the accepted sibling of T30 differs only in the direction of the two hours',
    c_revoked, 'revoked');
END $when$;

DO $shape$
DECLARE
  v_w1 text; v_w2 text; v_v1 text; v_pub1 text; v_pub3 text; v_hh1 text; v_hh2 text; v_hh4 text; v_apr text;
  v_kind text; v_policy text; v_s1 text; v_s2 text; v_s3 text; v_s4 text;
  v_c1 text; v_c2 text; v_c3 text; v_c4 text;
BEGIN
  SELECT w1::text, w2::text, v1::text, pub1::text, pub3::text, hh1::text, hh2::text
    INTO v_w1, v_w2, v_v1, v_pub1, v_pub3, v_hh1, v_hh2 FROM s11h_cast;
  SELECT hh4::text, apr::text INTO v_hh4, v_apr FROM s11h_t;

  v_kind := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-k1'), 'super_token', v_w1, v_pub1, NULL, NULL, NULL,
    'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T32 a fifth credential class is refused by the vocabulary at T10, so '
    || 'live_by_kind cannot grow a key the screen has no meaning for', v_kind, '23514',
    '%"access_tokens_token_kind_check"%');

  v_policy := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-k2'), 'public_invitation', v_w2, v_pub3, NULL, NULL, NULL,
    'session', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T33 a fourth expiry word is refused by the vocabulary at T9', v_policy,
    '23514', '%"access_tokens_expiry_policy_check"%');

  v_s1 := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-s1'), 'public_invitation', v_w2, v_pub3, v_hh2, NULL, NULL,
    'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T34 a public link that also names a household is refused by the shape rule — '
    || 'branch 1 of T11', v_s1, '23514', '%"access_tokens_kind_shape"%');
  v_c1 := pg_temp.s11h_mint(pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-s1c'), 'public_invitation', v_w2, v_pub3, NULL, NULL, NULL,
    'no_expiry', NULL, NULL),
    'SELECT token_kind FROM private.access_tokens WHERE id = ''@ID''::uuid');

  v_s2 := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-s2'), 'guest_invitation', v_w1, NULL, v_hh4, NULL, NULL,
    'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T35 a guest link that names no publication is refused by the same rule — '
    || 'branch 2 of T11', v_s2, '23514', '%"access_tokens_kind_shape"%');
  v_c2 := pg_temp.s11h_mint(pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-s2c'), 'guest_invitation', v_w1, v_pub1, v_hh4, NULL, NULL,
    'no_expiry', NULL, NULL),
    'SELECT token_kind FROM private.access_tokens WHERE id = ''@ID''::uuid');

  v_s3 := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-s3'), 'approval_review', v_w1, v_pub1, NULL, v_apr, v_v1,
    'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T36 a review link that also carries a publication is refused by the same rule '
    || '— branch 4 of T11', v_s3, '23514', '%"access_tokens_kind_shape"%');
  v_c3 := pg_temp.s11h_mint(pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-s3c'), 'approval_review', v_w1, NULL, NULL, v_apr, v_v1,
    'no_expiry', NULL, NULL),
    'SELECT token_kind FROM private.access_tokens WHERE id = ''@ID''::uuid');

  v_s4 := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-s4'), 'rsvp', v_w1, v_pub1, v_hh4, v_apr, NULL,
    'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T37 an rsvp link that reaches into the approval machinery is refused by the '
    || 'same rule — branch 3 of T11', v_s4, '23514', '%"access_tokens_kind_shape"%');
  v_c4 := pg_temp.s11h_mint(pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-s4c'), 'rsvp', v_w1, v_pub1, v_hh4, NULL, NULL,
    'no_expiry', NULL, NULL),
    'SELECT token_kind FROM private.access_tokens WHERE id = ''@ID''::uuid');

  PERFORM pg_temp.s11h_array('T38 all four shape refusals are one sentence, so the rule is the CASE quoted at '
    || 'T11 rather than four unrelated columns each failing on their own',
    ARRAY[v_s1, v_s2, v_s3, v_s4], ARRAY[v_s1, v_s1, v_s1, v_s1]);

  PERFORM pg_temp.s11h_array('T39 and each refusal has an accepted sibling that differs only in the column '
    || 'that branch names, which is what makes the four refusals above about the shape and not about the '
    || 'fixture', ARRAY[v_c1, v_c2, v_c3, v_c4],
    ARRAY['public_invitation', 'guest_invitation', 'approval_review', 'rsvp']);

  PERFORM pg_temp.s11h_ok('T40 the CASE''s ELSE arm yields NULL, which a CHECK treats as satisfied — so the '
    || 'shape rule is not total on its own, and it is T32''s vocabulary CHECK that makes the permissive arm '
    || 'unreachable. Measured from the quoted definition rather than assumed from the migration text',
    (SELECT position('ELSE NULL::boolean' IN
              pg_temp.s11h_flat(pg_get_constraintdef(c.oid))) > 0 FROM pg_constraint c
       WHERE c.conname = 'access_tokens_kind_shape'));
END $shape$;

DO $fk$
DECLARE
  v_w1 text; v_w2 text; v_v1 text; v_pub1 text; v_pub3 text; v_hh2 text; v_apr text; v_bogus text;
  v_missing text; v_other text; v_other_hh text; v_other_apr text; v_other_wedding text;
BEGIN
  SELECT w1::text, w2::text, v1::text, pub1::text, pub3::text, hh2::text INTO v_w1, v_w2, v_v1, v_pub1,
         v_pub3, v_hh2 FROM s11h_cast;
  SELECT apr::text, bogus::text INTO v_apr, v_bogus FROM s11h_t;

  v_missing := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-f1'), 'public_invitation', v_w1, v_bogus, NULL, NULL, NULL,
    'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T41 a credential pointing at a publication that does not exist is refused by '
    || 'the pair quoted at T12', v_missing, '23503', '%access_tokens_wedding_id_publication_id_fkey%');

  v_other := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-f2'), 'public_invitation', v_w1, v_pub3, NULL, NULL, NULL,
    'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T42 and so is one pointing at a *real* publication belonging to another '
    || 'wedding — the row exists, so a single-column reference would have accepted it and the block would '
    || 'have counted a link against the wrong host', v_other, '23503',
    '%access_tokens_wedding_id_publication_id_fkey%');

  PERFORM pg_temp.s11h_same('T43 the missing row and the foreign row fail with one sentence, which is the '
    || 'measurement that the key being checked is the pair, not the publication', v_missing, v_other);

  -- The rsvp class, not the guest class, because §2 leaves no household in this chain without a live guest
  -- link — which is `one_live_guest_token_per_household` doing its job — and the index check fires before the
  -- foreign-key trigger. An rsvp row is the one shape the liveness indexes do not police, so the pair quoted
  -- at T12 is the rule this row actually reaches.
  v_other_hh := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-f3'), 'rsvp', v_w1, v_pub1, v_hh2, NULL, NULL,
    'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T44 the household pair refuses the same trick from the side the liveness '
    || 'indexes do not cover: a real household belonging to the other wedding', v_other_hh,
    '23503', '%access_tokens_wedding_id_household_id_fkey%');

  v_other_apr := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-f4'), 'approval_review', v_w2, NULL, NULL, v_apr, v_v1,
    'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T45 and the review triple refuses a request claimed under a wedding that does '
    || 'not own it', v_other_apr, '23503',
    '%access_tokens_wedding_id_approval_request_id_approval_vers_fkey%');

  -- A wedding that does not exist breaks two of the four references quoted at T12 at once — the bare one on
  -- `wedding_id` and the composite the row's own class requires — and which of them speaks is an engine
  -- ordering, not a fact this file should depend on. The claim measured here is the one that survives both:
  -- the refusal comes from a reference *keyed on the wedding column*, and the identical row with a real
  -- wedding lands.
  v_other_wedding := pg_temp.s11h_probe('postgres', NULL, pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-f5'), 'public_invitation', v_bogus, v_pub3, NULL, NULL, NULL,
    'no_expiry', NULL, 'now()'));
  PERFORM pg_temp.s11h_err_is('T46 a credential for a wedding this schema has never heard of is refused by '
    || 'a reference on the wedding column, quoted at T12, rather than by a CHECK or the liveness indexes',
    v_other_wedding, '23503', '%access_tokens_wedding_id%');

  PERFORM pg_temp.s11h_eq('T46b the identical row is accepted the moment the wedding column names the host '
    || 'that really owns that publication — so T46 measures the reference and not the row''s shape',
    pg_temp.s11h_mint(pg_temp.s11h_tok_ins('@ID',
      pg_temp.s11h_h64('s11h-tok-f5c'), 'public_invitation', v_w2, v_pub3, NULL, NULL, NULL,
      'no_expiry', NULL, 'now()'),
      'SELECT CASE WHEN revoked_at IS NULL THEN ''live'' ELSE ''revoked'' END '
      || 'FROM private.access_tokens WHERE id = ''@ID''::uuid'), 'revoked');
END $fk$;

DO $bound$
DECLARE
  v_w1 text; v_w2 text; v_pub3 text; v_bogus text;
  v_plain text; v_plain_anon text; v_wide text; v_wide_anon text;
  v_upd_blocked text; v_upd_allowed text; v_del_blocked text; v_del_allowed text;
  v_srv text; v_srv_ok text; v_rsvp integer; v_pre integer;
BEGIN
  SELECT w1::text, w2::text, pub3::text INTO v_w1, v_w2, v_pub3 FROM s11h_cast;
  SELECT bogus::text INTO v_bogus FROM s11h_t;

  -- Layer one, as this chain actually stands: the client hand never reaches this store.
  v_plain := pg_temp.s11h_try('authenticated', NULL, pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-b1'), 'public_invitation', v_w2, v_pub3, NULL, NULL, NULL,
    'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_err_is('T47 an authenticated INSERT into the credential store is refused today at the '
    || 'schema, before any rule in this group is reached', v_plain, '42501',
    '%permission denied for schema private%');

  v_plain_anon := pg_temp.s11h_try('anon', NULL, pg_temp.s11h_tok_ins('@ID',
    pg_temp.s11h_h64('s11h-tok-b2'), 'public_invitation', v_w2, v_pub3, NULL, NULL, NULL,
    'no_expiry', NULL, NULL));
  PERFORM pg_temp.s11h_same('T48 and the anonymous hand is stopped by the same sentence, so this store has no '
    || 'unauthenticated reachability at all', v_plain, v_plain_anon);

  -- Layer two, reached only by handing the role the table privilege it does not have. This is what the write
  -- trigger actually says, and it is the reason the trigger is quoted from the catalogue rather than trusted.
  v_wide := pg_temp.s11h_wide('authenticated',
    'GRANT INSERT ON private.access_tokens TO authenticated',
    pg_temp.s11h_tok_ins('@ID', pg_temp.s11h_h64('s11h-tok-b3'), 'public_invitation', v_w2, v_pub3,
      NULL, NULL, NULL, 'no_expiry', NULL, NULL), NULL);
  PERFORM pg_temp.s11h_err_is('T49 give it the table privilege anyway and `tokens_no_client_write` emits its '
    || 'own sentence: the second layer is real, it is just not the binding one', v_wide, '42501',
    '%may not write private.access_tokens: this table is server-authoritative%');

  v_wide_anon := pg_temp.s11h_wide('anon',
    'GRANT INSERT ON private.access_tokens TO anon',
    pg_temp.s11h_tok_ins('@ID', pg_temp.s11h_h64('s11h-tok-b4'), 'public_invitation', v_w2, v_pub3,
      NULL, NULL, NULL, 'no_expiry', NULL, NULL), NULL);
  PERFORM pg_temp.s11h_ok('T50 the same sentence names the role that tried, so it is the trigger speaking '
    || 'rather than a fixed string', v_wide_anon LIKE '%role anon may not write%');

  -- Layer three: for UPDATE and DELETE the binding rule is row-level security, not the trigger, because RLS
  -- filters the rows before any per-row trigger runs. Measured both ways against the same statement, over the
  -- rsvp population the store actually holds rather than over a hand-written number: §2 plants two, and the
  -- groups that ran before this one may have left others, so the pair's arithmetic is read, not assumed.
  SELECT count(*) INTO v_rsvp FROM private.access_tokens WHERE token_kind = 'rsvp';
  SELECT count(*) INTO v_pre FROM private.access_tokens
    WHERE token_kind = 'rsvp' AND revoked_at = now();
  PERFORM pg_temp.s11h_eq('T51 the population this pair counts over is §2''s two rsvp links plus any the '
    || 'earlier groups left standing, and none of them carries this transaction''s instant before the first '
    || 'probe runs', (v_rsvp >= 2 AND v_pre = 0)::text, 'true');

  v_upd_blocked := pg_temp.s11h_wide('authenticated',
    'GRANT SELECT, UPDATE, DELETE ON private.access_tokens TO authenticated',
    'UPDATE private.access_tokens SET revoked_at = now() WHERE token_kind = ''rsvp''',
    'SELECT count(*)::text FROM private.access_tokens WHERE token_kind = ''rsvp'' '
    || 'AND revoked_at = now()');
  PERFORM pg_temp.s11h_eq('T52 with every table privilege and no policy, the same UPDATE a server role can '
    || 'run reaches nothing at all — accepted, and no rsvp row carrying the marker when the store is counted '
    || 'afterwards', v_upd_blocked, 'ACCEPTED / 0');

  v_upd_allowed := pg_temp.s11h_wide('postgres',
    NULL, 'UPDATE private.access_tokens SET revoked_at = now() WHERE token_kind = ''rsvp''',
    'SELECT count(*)::text FROM private.access_tokens WHERE token_kind = ''rsvp'' '
    || 'AND revoked_at = now()');
  PERFORM pg_temp.s11h_eq('T52b the identical statement run by the owner marks every rsvp row in the store, '
    || 'which is what makes T52 a measurement of reach rather than a statement that happens to return zero',
    v_upd_allowed, 'ACCEPTED / ' || v_rsvp::text);

  v_del_blocked := pg_temp.s11h_wide('authenticated',
    'GRANT SELECT, UPDATE, DELETE ON private.access_tokens TO authenticated',
    'DELETE FROM private.access_tokens WHERE token_kind = ''rsvp''',
    'SELECT count(*)::text FROM private.access_tokens WHERE token_kind = ''rsvp''');
  PERFORM pg_temp.s11h_eq('T53 and the same holds for the append-only delete trigger: no row is visible, so '
    || 'no row is deleted and `reject_client_delete` is never invoked', v_del_blocked,
    'ACCEPTED / ' || v_rsvp::text);

  v_del_allowed := pg_temp.s11h_wide('postgres',
    NULL, 'DELETE FROM private.access_tokens WHERE token_kind = ''rsvp''',
    'SELECT count(*)::text FROM private.access_tokens WHERE token_kind = ''rsvp''');
  PERFORM pg_temp.s11h_eq('T53b the owner''s identical DELETE removes them all, so T53 measures visibility '
    || 'and not a broken instrument', v_del_allowed, 'ACCEPTED / 0');

  PERFORM pg_temp.s11h_eq('T54 the reason is in the catalogue: the store is row-secured and holds no policy '
    || 'for anyone, which is the same unexposed-schema shape slice 1 through 4 qualified for `private`',
    (SELECT jsonb_build_object('row_security', c.relrowsecurity, 'policies',
              (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid))
       FROM pg_class c WHERE c.oid = 'private.access_tokens'::regclass)::text,
    '{"policies": 0, "row_security": true}');

  -- The trusted hand: `reject_client_write` exempts members of service_role, so this is measured and stated
  -- as it is rather than filed under "server-authoritative". No client-facing door passes a caller-controlled
  -- credential row to it; that is slice 1's grant story, argued in group A.
  v_srv := pg_temp.s11h_wide('service_role',
    NULL, pg_temp.s11h_tok_ins('@ID', pg_temp.s11h_h64('s11h-tok-b5'),
      'public_invitation', v_bogus, v_pub3, NULL, NULL, NULL, 'no_expiry', NULL, NULL), NULL);
  PERFORM pg_temp.s11h_err_is('T55 service_role writing this store is not refused by the trigger: the row '
    || 'reaches the constraints and fails on a reference keyed on its wedding, which is the exemption quoted '
    || 'below and not a claim that it should be used', v_srv, '23503', '%access_tokens_wedding_id%');

  v_srv_ok := pg_temp.s11h_wide('service_role', NULL,
    pg_temp.s11h_tok_ins('@ID', pg_temp.s11h_h64('s11h-tok-b6'), 'public_invitation', v_w2, v_pub3,
      NULL, NULL, NULL, 'no_expiry', NULL, NULL),
    'SELECT count(*)::text FROM private.access_tokens WHERE id = ''@ID''::uuid');
  PERFORM pg_temp.s11h_eq('T56 and a well-shaped service_role row does land, so the exemption is a live write '
    || 'path — the reason §11 keeps credential minting inside definer bodies is operational, and this cell is '
    || 'the measurement behind it', v_srv_ok, 'ACCEPTED / 1');

  PERFORM pg_temp.s11h_ok('T57 the exemption is exactly the two server roles plus the superuser, quoted from '
    || 'the trigger function''s own body',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'private' AND p.proname = 'reject_client_write'
         AND position('''service_role'', ''supabase_admin''' IN p.prosrc) > 0
         AND position('current_user = ''postgres''' IN p.prosrc) > 0
         AND position('pg_has_role(current_user' IN p.prosrc) > 0) = 1);

  PERFORM pg_temp.s11h_eq('T58 and both guards are attached to this store, quoted from the catalogue rather '
    || 'than named: one for INSERT/UPDATE, one for DELETE',
    (SELECT coalesce(array_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname COLLATE "C"), '{}'::text[])
       FROM pg_trigger t WHERE t.tgrelid = 'private.access_tokens'::regclass AND NOT t.tgisinternal),
    ARRAY['CREATE TRIGGER tokens_no_client_delete BEFORE DELETE ON private.access_tokens FOR EACH ROW '
          || 'EXECUTE FUNCTION private.reject_client_delete()',
          'CREATE TRIGGER tokens_no_client_write BEFORE INSERT OR UPDATE ON private.access_tokens FOR EACH '
          || 'ROW EXECUTE FUNCTION private.reject_client_write()']);
END $bound$;

-- ===========================================================================
-- 15. D — the attempt ceiling. The delivery block reports one number that an operator acts on, and migration
--       decision 6 promises that number is read back out of the schema rather than paraphrased from a comment.
--       So the bound is *parsed* here: out of `pg_get_constraintdef` for the column, out of the projection's
--       `prosrc` for the filter, and out of the guard's `prosrc` for the door. The schema bound is pinned to a
--       literal exactly once (D2) so the equality cells cannot pass on two parse failures, and every probe
--       below is built from the parsed digit — including the refusal sentence, which is asserted with the
--       number the database interpolated into it, not with a `%` standing in for it.
--
--       The second half of this group is the honest shape of the ceiling: the constraint is real but no
--       reachable write ever crosses it, because the guard refuses first, and the two refusals are different
--       sentences. That is measured both ways — the door on a row that has spent its budget (D11) versus one
--       that has not (D13), the count that cannot be fabricated (D18), and the constraint firing on its own
--       only once a superuser-only setting has taken the triggers away (D22).
-- ===========================================================================

CREATE TEMP TABLE s11h_ceil ON COMMIT DROP AS
SELECT (SELECT substring(pg_get_constraintdef(c.oid) from 'attempt_count <= ([0-9]+)')
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public' AND t.relname = 'invitation_outputs'
           AND c.conname = 'invitation_outputs_attempt_count_check') AS schema_bound,
       (SELECT substring(p.prosrc from 'o.attempt_count >= ([0-9]+)')
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'internal_api' AND p.proname = 'operator_operations_summary') AS projection_bound,
       (SELECT substring(p.prosrc from 'OLD.attempt_count >= ([0-9]+)')
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'private' AND p.proname = 'guard_invitation_output_update') AS guard_bound;

-- A count written with the number the schema states. M32 writes the same count with a literal, and the pair is
-- what makes the drift decision 6 promises to catch a failure rather than a coincidence.
CREATE FUNCTION pg_temp.s11h_cnt(p_bound integer) RETURNS numeric
LANGUAGE plpgsql STABLE AS $fn$
DECLARE v numeric;
BEGIN
  EXECUTE 'SELECT count(*)::numeric FROM public.invitation_outputs '
       || 'WHERE status = ''failed'' AND attempt_count >= ' || p_bound::text
    INTO v;
  RETURN v;
END $fn$;

-- Several statements that must run as one walk, then the statement under test, then the read — all inside a
-- subtransaction a marker exception aborts. Group D needs this because a row cannot be *found* at the ceiling
-- with an inflated count: it has to be walked there through the guard's own edges first, exactly as §2 walked
-- o4, and the fabrication attack then lands on the row that walk produced.
CREATE FUNCTION pg_temp.s11h_seq(p_role text, p_walk text[], p_attack text, p_read text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_stmt text; v_out text; v_after text;
BEGIN
  IF p_role NOT IN ('anon', 'authenticated', 'service_role', 'postgres') THEN
    RAISE EXCEPTION 'FAIL: sequence probe role % is not one this file may assume', p_role;
  END IF;
  BEGIN
    BEGIN
      BEGIN
        EXECUTE 'SET ROLE ' || p_role;
        FOREACH v_stmt IN ARRAY p_walk LOOP
          EXECUTE v_stmt;
        END LOOP;
        BEGIN
          EXECUTE p_attack;
          v_out := 'ACCEPTED';
        EXCEPTION WHEN OTHERS THEN
          v_out := SQLSTATE || ' | ' || SQLERRM;
        END;
        BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN OTHERS THEN NULL; END;
        IF p_read IS NOT NULL THEN
          EXECUTE p_read INTO v_after;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN OTHERS THEN NULL; END;
        RAISE EXCEPTION 'FAIL s11h_seq setup as %: %', p_role, SQLERRM;
      END;
      RAISE EXCEPTION 's11h_seq_rolled_back';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 's11h_seq_rolled_back' THEN NULL; ELSE RAISE; END IF;
    END;
  END;
  RETURN CASE WHEN v_after IS NULL THEN v_out ELSE v_out || ' / ' || v_after END;
END $fn$;

SELECT pg_temp.s11h_eq('D1 the column bound, quoted from the catalogue: the attempt ceiling is a schema fact and not a comment about one',
  (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'invitation_outputs'
      AND c.conname = 'invitation_outputs_attempt_count_check'),
  'CHECK (((attempt_count >= 0) AND (attempt_count <= 5)))');

SELECT pg_temp.s11h_eq('D2 the digit parsed out of that definition, pinned once so no equality cell below can pass on two parse failures',
  (SELECT schema_bound FROM s11h_ceil), '5');

SELECT pg_temp.s11h_eq('D3 the projection''s own filter is on the same number the column is capped at, which is decision 6 as a cell: move the ceiling without moving this body and the screen stops being believed',
  (SELECT projection_bound FROM s11h_ceil), (SELECT schema_bound FROM s11h_ceil));

SELECT pg_temp.s11h_eq('D4 and the guard that refuses the retry is on that number too, so the count an operator reads and the door a worker hits cannot disagree',
  (SELECT guard_bound FROM s11h_ceil), (SELECT schema_bound FROM s11h_ceil));

-- The bodies are matched on whole reconstructed clauses, with whitespace flattened by the harness reader
-- §13 already uses, because a migration writes these across two lines and matching a fragment would accept a
-- body that had lost the status half of its own predicate.
SELECT pg_temp.s11h_ok('D5 the filter clause itself, rebuilt from the parsed bound, is what the projection body contains — not merely the same digit somewhere in it',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'internal_api' AND p.proname = 'operator_operations_summary'
       AND position('count(*) FILTER (WHERE o.status = ''failed'' AND o.attempt_count >= '
                    || (SELECT schema_bound FROM s11h_ceil) || ')'
                    IN pg_temp.s11h_flat(p.prosrc)) > 0) = 1);

SELECT pg_temp.s11h_ok('D6 the door''s own condition, likewise rebuilt, is in the guard body that fires on the transition',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private' AND p.proname = 'guard_invitation_output_update'
       AND position('IF OLD.status = ''failed'' AND NEW.status = ''uploading'' AND OLD.attempt_count >= '
                    || (SELECT schema_bound FROM s11h_ceil) || ' THEN'
                    IN pg_temp.s11h_flat(p.prosrc)) > 0) = 1);

-- `%` is the format marker inside this sentence, so the needle is matched by `position` and not by `LIKE`.
SELECT pg_temp.s11h_ok('D7 the refusal is the one documented, quoted from the trigger function that raises it',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private' AND p.proname = 'guard_invitation_output_update'
       AND position('the attempt budget is spent: a failed output at attempt_count % may not be retried'
                    IN p.prosrc) > 0) = 1);

SELECT pg_temp.s11h_eq('D8 the door is attached to the table the projection counts, quoted from the catalogue',
  (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'invitation_outputs'
      AND t.tgname = 'invitation_outputs_guard_update'),
  'CREATE TRIGGER invitation_outputs_guard_update BEFORE UPDATE ON public.invitation_outputs '
  || 'FOR EACH ROW EXECUTE FUNCTION private.guard_invitation_output_update()');

DO $ceil$
DECLARE v_bound text; v_o1 text; v_o4 text; v_o5 text;
        v_state text; v_got text; v_att text; v_anon text; v_over text; v_neg text; v_at text;
        v_exit text; v_before text; v_after_dig text; v_above integer;
BEGIN
  SELECT c.schema_bound, b.o1::text, b.o4::text, b.o5::text
    INTO v_bound, v_o1, v_o4, v_o5
    FROM s11h_ceil c CROSS JOIN s11h_cast b;

  -- The two fixtures this group's door cells differ in nothing except the budget they have spent.
  SELECT status || '/' || attempt_count::text INTO v_state
    FROM public.invitation_outputs WHERE id = v_o4::uuid;
  PERFORM pg_temp.s11h_eq('D9 §2''s ceiling fixture is sitting on the door: failed, at exactly the number the constraint states',
    v_state, 'failed/' || v_bound);

  SELECT status || '/' || attempt_count::text INTO v_state
    FROM public.invitation_outputs WHERE id = v_o5::uuid;
  PERFORM pg_temp.s11h_eq('D10 and its sibling is failed with three attempts still unspent, which is the only difference the next two cells test',
    v_state, 'failed/2');

  -- The spent door, as the render worker's own hand, and the row as the store still holds it.
  v_got := pg_temp.s11h_wide('service_role', NULL,
    'UPDATE public.invitation_outputs SET status = ''uploading'' WHERE id = ' || pg_temp.s11h_u(v_o4),
    'SELECT status || ''/'' || attempt_count::text FROM public.invitation_outputs WHERE id = '
    || pg_temp.s11h_u(v_o4));
  PERFORM pg_temp.s11h_err_is('D11 the spent budget refuses its own retry, naming the number parsed out of the constraint rather than a paraphrase of it',
    v_got, '42501',
    '%the attempt budget is spent: a failed output at attempt_count ' || v_bound || ' may not be retried%');
  PERFORM pg_temp.s11h_eq('D12 and the refused row is exactly where it was when the door closed: the refusal does not half-apply and leave a moved attempt behind',
    split_part(v_got, ' / ', 2), 'failed/' || v_bound);

  v_got := pg_temp.s11h_wide('service_role', NULL,
    'UPDATE public.invitation_outputs SET status = ''uploading'' WHERE id = ' || pg_temp.s11h_u(v_o5),
    'SELECT status || ''/'' || attempt_count::text FROM public.invitation_outputs WHERE id = '
    || pg_temp.s11h_u(v_o5));
  PERFORM pg_temp.s11h_eq('D13 the identical statement on the half-spent row is accepted, which is what makes D11 a measurement of the budget and not of the transition',
    v_got, 'ACCEPTED / uploading/2');

  -- The client hand never reaches this door. Same three-layer question group T asked of the credential store,
  -- answered here for the public table the projection counts.
  v_att := pg_temp.s11h_try('authenticated', NULL,
    'UPDATE public.invitation_outputs SET status = ''uploading'' WHERE id = ' || pg_temp.s11h_u(v_o4));
  v_anon := pg_temp.s11h_try('anon', NULL,
    'UPDATE public.invitation_outputs SET status = ''uploading'' WHERE id = ' || pg_temp.s11h_u(v_o4));
  PERFORM pg_temp.s11h_err_is('D14 a host session is stopped by the table privilege, one layer before the ceiling door exists to be reached',
    v_att, '42501', '%permission denied for table invitation_outputs%');
  PERFORM pg_temp.s11h_same('D15 and the anonymous hand hears the same sentence, so no unauthenticated path can probe an output''s budget',
    v_att, v_anon);
  PERFORM pg_temp.s11h_eq('D16 measured rather than inferred: no write grant for the browser role on this table at all',
    has_table_privilege('authenticated'::regrole, 'public.invitation_outputs', 'UPDATE')::text, 'false');
  PERFORM pg_temp.s11h_eq('D17 and the row-level layer agrees with it: one SELECT policy, no write policy, so the guard triggers on this table are the backstop the migration comment calls them',
    (SELECT 'policies=' || count(*)::text || ' write_policies='
            || coalesce(count(*) FILTER (WHERE polcmd IN ('a', 'w', 'd')), 0)::text
       FROM pg_policy WHERE polrelid = 'public.invitation_outputs'::regclass),
    'policies=1 write_policies=0');

  -- The count is earned, not declared: walk a fresh row to the door's edge, then try to arrive already spent.
  v_got := pg_temp.s11h_seq('service_role',
    ARRAY['UPDATE public.invitation_outputs SET status = ''uploading'' WHERE id = ' || pg_temp.s11h_u(v_o1)],
    'UPDATE public.invitation_outputs SET status = ''failed'', attempt_count = ' || v_bound
      || ', last_error = ''S11h fabricated budget'' WHERE id = ' || pg_temp.s11h_u(v_o1),
    'SELECT status || ''/'' || attempt_count::text FROM public.invitation_outputs WHERE id = '
    || pg_temp.s11h_u(v_o1));
  PERFORM pg_temp.s11h_err_is('D18 a row cannot be walked straight to a spent budget: entering failed records exactly one attempt, so the ceiling number in the answer cannot be inflated by a caller',
    v_got, '42501', '%entering failed records exactly one attempt%');
  PERFORM pg_temp.s11h_eq('D19 inside that same aborted sequence the row still reads zero attempts, which is the read-back that makes D18 a refusal and not a delay',
    split_part(v_got, ' / ', 2), 'uploading/0');

  v_got := pg_temp.s11h_seq('service_role',
    ARRAY['UPDATE public.invitation_outputs SET status = ''uploading'' WHERE id = ' || pg_temp.s11h_u(v_o1)],
    'UPDATE public.invitation_outputs SET status = ''failed'', attempt_count = 1, '
      || 'last_error = ''S11h one honest attempt'' WHERE id = ' || pg_temp.s11h_u(v_o1),
    'SELECT status || ''/'' || attempt_count::text FROM public.invitation_outputs WHERE id = '
    || pg_temp.s11h_u(v_o1));
  PERFORM pg_temp.s11h_eq('D20 and the honest single attempt on the same walk is accepted, so D18 refuses the number and not the transition into failed',
    v_got, 'ACCEPTED / failed/1');

  -- The constraint's own half of the story. Every write the chain can reach is refused by the guard first, so
  -- the CHECK can only be seen to fire by taking the triggers away — and the only setting that does that is
  -- superuser-context, which no product connection holds. D24 pins that fact instead of assuming it.
  v_before := pg_temp.s11h_d('public.invitation_outputs');
  EXECUTE 'SET session_replication_role = replica';
  v_over := pg_temp.s11h_wide('postgres', NULL,
    'UPDATE public.invitation_outputs SET status = ''failed'', attempt_count = '
      || ((v_bound::integer + 1)::text) || ', last_error = ''S11h beyond the ceiling'' WHERE id = '
      || pg_temp.s11h_u(v_o4), NULL);
  v_neg := pg_temp.s11h_wide('postgres', NULL,
    'UPDATE public.invitation_outputs SET status = ''failed'', attempt_count = -1, '
      || 'last_error = ''S11h below the floor'' WHERE id = ' || pg_temp.s11h_u(v_o4), NULL);
  v_at := pg_temp.s11h_wide('postgres', NULL,
    'UPDATE public.invitation_outputs SET status = ''failed'', attempt_count = ' || v_bound
      || ', last_error = ''S11h at the ceiling'' WHERE id = ' || pg_temp.s11h_u(v_o4),
    'SELECT status || ''/'' || attempt_count::text FROM public.invitation_outputs WHERE id = '
      || pg_temp.s11h_u(v_o4));
  EXECUTE 'RESET session_replication_role';
  PERFORM pg_temp.s11h_err_is('D21 one attempt past the bound and the constraint itself speaks, by name, with the guard taken out of the way',
    v_over, '23514', '%violates check constraint "invitation_outputs_attempt_count_check"%');
  PERFORM pg_temp.s11h_err_is('D22 so does the floor half, which is the other side of the same definition D1 quoted',
    v_neg, '23514', '%violates check constraint "invitation_outputs_attempt_count_check"%');
  PERFORM pg_temp.s11h_eq('D23 at the bound the same statement in the same mode is accepted, so D21 refuses the number and not the setting',
    v_at, 'ACCEPTED / failed/' || v_bound);
  PERFORM pg_temp.s11h_eq('D24 the excursion is only available to a superuser-context setting, which is why it proves the constraint is live without pretending a worker can reach it',
    (SELECT count(*)::text FROM pg_settings
      WHERE name = 'session_replication_role' AND context = 'superuser'), '1');
  PERFORM pg_temp.s11h_eq('D25 and the setting is back where the battery found it',
    current_setting('session_replication_role'), 'origin');
  v_after_dig := pg_temp.s11h_d('public.invitation_outputs');
  PERFORM pg_temp.s11h_same('D26 the store is byte-identical after the excursion, which is the licence for every read-only cell that runs after this one',
    v_before, v_after_dig);

  -- What the reported number therefore means, and the exit an operator is meant to take with it.
  SELECT count(*) INTO v_above FROM public.invitation_outputs WHERE attempt_count > v_bound::integer;
  PERFORM pg_temp.s11h_eq('D27 no row in the store is above the bound, so the filter can say at-least while the schema says at-most and still name exactly the spent rows',
    v_above::text, '0');
  PERFORM pg_temp.s11h_sql('D28 the answer''s ceiling count against the same count written with the parsed bound',
    'w24', ARRAY['blocks', 'delivery', 'failed_at_attempt_ceiling'],
    pg_temp.s11h_cnt(v_bound::integer));

  v_exit := pg_temp.s11h_wide('service_role', NULL,
    'DELETE FROM public.invitation_outputs WHERE id = ' || pg_temp.s11h_u(v_o4),
    'SELECT count(*)::text FROM public.invitation_outputs WHERE id = ' || pg_temp.s11h_u(v_o4));
  PERFORM pg_temp.s11h_eq('D29 the spent row''s exit is the trusted delete its own refusal points at, and the probe aborts it again so the count D28 checked is still the count the store holds',
    v_exit, 'ACCEPTED / 0');
  PERFORM pg_temp.s11h_eq('D30 both doors on this table are catalogued: the update guard this group probed and the delete guard that lets a spent row go',
    (SELECT coalesce(array_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname COLLATE "C"), '{}'::text[])
       FROM pg_trigger t WHERE t.tgrelid = 'public.invitation_outputs'::regclass
         AND t.tgname IN ('invitation_outputs_guard_update', 'invitation_outputs_guard_delete')),
    ARRAY['CREATE TRIGGER invitation_outputs_guard_delete BEFORE DELETE ON public.invitation_outputs '
          || 'FOR EACH ROW EXECUTE FUNCTION private.guard_invitation_output_delete()',
          'CREATE TRIGGER invitation_outputs_guard_update BEFORE UPDATE ON public.invitation_outputs '
          || 'FOR EACH ROW EXECUTE FUNCTION private.guard_invitation_output_update()']);
END $ceil$;

-- ===========================================================================
-- 16. N — the migrations block's other branch. Everything above this section measures the `not_measured`
--       half, because on this chain `to_regclass('supabase_migrations.schema_migrations')` answers NULL: the
--       store belongs to a tool that does not run here. Decision 3 promises both branches are exercised, so
--       the battery builds a table at exactly that name, reads the door again into snapshot tags of its own,
--       and drops it — inside this same transaction, which is what makes the fixture disposable rather than
--       a mutation of the chain.
--
--       What is deliberately *not* claimed is the real CLI's column set. No `supabase_migrations` schema
--       exists on either qualified chain, so the fixture's shape is this battery's invention: `version` as
--       primary key, plus the three columns a migration history plausibly carries and this projection must
--       not read (`name`, `running_time`, `created_at`). That is why the load-bearing cell here is N5, which
--       reads the branch's column references out of `pg_proc.prosrc` rather than inferring them from the
--       fixture, and why the closing report records the CLI's shape as unproven instead of tested.
--
--       The five snapshots this section takes (`npre`, `nmeas`, `nempty`, `nbig`, `nback`) are read by the same
--       caller through the same door as `w24`, so the only thing that varies between them is whether the store
--       is there, what it holds, and what its `version` column is typed as.
-- ===========================================================================

-- N1 states the precondition the whole group depends on: the absence every block above reported was produced
-- by the gate, not left behind by an earlier fixture.
SELECT pg_temp.s11h_ok('N1 neither the schema nor the table exists before the fixture is built, so the '
  || 'not_measured block above came from the gate itself',
  to_regclass('supabase_migrations.schema_migrations') IS NULL
  AND to_regnamespace('supabase_migrations') IS NULL);

-- Every product store, digested before the excursion, so N45 can measure the round trip rather than trust that
-- DDL in a schema nobody else touches is harmless.
CREATE TEMP TABLE s11h_dig_a ON COMMIT DROP AS SELECT pg_temp.s11h_digs()::text AS d;

-- The door read once more, immediately before the excursion. `w24` is the wrong comparator for a "nothing
-- changed" claim and this file has the measurement to prove it: the first draft of N44 pointed at `w24` and
-- the two answers differed in the credentials block (total 13 against 14, a live `approval_review` token),
-- because the groups between §4 and here plant rows on purpose. So the round trip is measured against the
-- answer this section starts with, and the drift that N44 first reported is left to the groups that caused it.
INSERT INTO pg_temp.s11h_s (tag, a)
SELECT 'npre', pg_temp.s11h_must('N-setup the door read immediately before the fixture', 'authenticated',
  (SELECT id FROM s11h_reg WHERE tag = 'op_a'), 'SELECT api.operator_operations_summary(24)');

-- The branch is located by two anchors, so its text is measured rather than paraphrased. Both anchors must
-- occur exactly once, or the slice could be some neighbouring statement and every cell below it a coincidence.
CREATE TEMP TABLE s11h_mig ON COMMIT DROP AS
WITH b AS (
  SELECT pg_temp.s11h_flat((SELECT p.prosrc FROM pg_proc p
                              JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE p.oid = 'internal_api.operator_operations_summary(integer)'::regprocedure)) AS flat)
SELECT b.flat AS flat_body,
       substring(b.flat from '''applied_count''.*?FROM supabase_migrations\.schema_migrations;') AS branch_slice,
       (SELECT pg_temp.s11h_txt('w24', ARRAY['blocks', 'migrations', 'reason'])) AS absent_reason,
       (SELECT pg_temp.s11h_txt('w24', ARRAY['blocks', 'migrations', 'note']))   AS absent_note
  FROM b;

SELECT pg_temp.s11h_re_hits('N2 the slice''s leading anchor appears once in the body',
  (SELECT flat_body FROM s11h_mig), '''applied_count''', 1);
SELECT pg_temp.s11h_re_hits('N3 and its trailing anchor appears once, so the slice is exactly one statement',
  (SELECT flat_body FROM s11h_mig), 'FROM supabase_migrations\.schema_migrations;', 1);
SELECT pg_temp.s11h_ok('N4 the slice was found between them',
  length(coalesce((SELECT branch_slice FROM s11h_mig), '')) > 0);

-- The claim decision 3 makes in prose — the branch reads `count(*)` and `max(version)` and nothing else —
-- becomes a set here: of the four columns this fixture will carry, the branch's own text names one.
SELECT pg_temp.s11h_array('N5 the measured branch names exactly one column of the store, and it is version',
  (SELECT array_agg(x ORDER BY x COLLATE "C")
     FROM (SELECT DISTINCT m[1] AS x FROM regexp_matches((SELECT branch_slice FROM s11h_mig),
              '\m(version|name|created_at|running_time)\M', 'g') m) q),
  ARRAY['version']);

CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (
  version      text PRIMARY KEY,
  name         text,
  running_time integer,
  created_at   timestamptz);
INSERT INTO supabase_migrations.schema_migrations (version, name, running_time, created_at) VALUES
  ('20261020190500', 'stage11 operations health', 424242, TIMESTAMPTZ '2020-01-01 00:00:00+00'),
  ('20261013120000', 'stage9 render outputs',    8675310, TIMESTAMPTZ '2021-02-02 02:02:02+00');

-- The greater of the two planted versions, written once. N15 points the projection at it and N16 points the
-- store at the same value, so the pair proves both readings agree rather than that either one agrees with
-- itself.
CREATE TEMP TABLE s11h_fx ON COMMIT DROP AS SELECT '20261020190500'::text AS hi_version;

-- N6 is N5's control: the same scanner over the store's own catalogue finds all four names, so a one-element
-- answer above is the branch's reading and not the pattern's blindness.
SELECT pg_temp.s11h_array('N6 the same scanner over the store''s own catalogued columns finds all four, so N5 '
  || 'is a refusal and not a blind pattern',
  (SELECT array_agg(x ORDER BY x COLLATE "C")
     FROM (SELECT DISTINCT m[1] AS x FROM regexp_matches(
              array_to_string((SELECT array_agg(a.attname ORDER BY a.attname COLLATE "C")
                                 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                                 JOIN pg_namespace n ON n.oid = c.relnamespace
                                WHERE n.nspname = 'supabase_migrations'
                                  AND c.relname = 'schema_migrations'
                                  AND a.attnum > 0 AND NOT a.attisdropped), ', '),
              '\m(version|name|created_at|running_time)\M', 'g') m) q),
  ARRAY['created_at', 'name', 'running_time', 'version']);

SELECT pg_temp.s11h_eq('N7 the fixture really is the shape the branch is written against: version is its '
  || 'primary key, so max(version) is taken over a unique column',
  (SELECT pg_get_constraintdef(con.oid) FROM pg_constraint con
    WHERE con.conrelid = 'supabase_migrations.schema_migrations'::regclass AND con.contype = 'p'),
  'PRIMARY KEY (version)');

-- Why a fixture owned by the superuser can be read by a door its caller cannot reach: the read happens in the
-- definer's identity, and the definer is this chain's owner. N8/N9 pin both halves from the catalogue; N10
-- then measures the client side of the same boundary.
SELECT pg_temp.s11h_eq('N8 the body that reads the store is SECURITY DEFINER and owned by the role that owns '
  || 'the fixture',
  (SELECT p.proowner::regrole::text || '/definer=' || p.prosecdef::text FROM pg_proc p
    WHERE p.oid = 'internal_api.operator_operations_summary(integer)'::regprocedure),
  'postgres/definer=true');
SELECT pg_temp.s11h_eq('N9 and the surface the caller actually reaches is the SECURITY INVOKER wrapper, so no '
  || 'client role is ever handed the store',
  (SELECT p.proowner::regrole::text || '/definer=' || p.prosecdef::text FROM pg_proc p
    WHERE p.oid = 'api.operator_operations_summary(integer)'::regprocedure),
  'postgres/definer=false');

SELECT pg_temp.s11h_array('N10 no client role can reach the store at all — not by schema usage, not by table '
  || 'select — while the answer counts it',
  (SELECT array_agg(rolname || ' usage=' || has_schema_privilege(rolname, 'supabase_migrations', 'USAGE')
                            || ' select=' || has_table_privilege(rolname,
                                  'supabase_migrations.schema_migrations', 'SELECT')
             ORDER BY rolname COLLATE "C")
     FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')),
  ARRAY['anon usage=false select=false', 'authenticated usage=false select=false',
        'service_role usage=false select=false']);
SELECT pg_temp.s11h_ok('N11 the same instruments do report access where it exists, so N10 is a refusal',
  has_table_privilege('postgres', 'supabase_migrations.schema_migrations', 'SELECT')
  AND has_schema_privilege('postgres', 'supabase_migrations', 'USAGE'));

-- The door, re-read with the store present, by the same operator at the same window as `w24`.
INSERT INTO pg_temp.s11h_s (tag, a)
SELECT 'nmeas', pg_temp.s11h_must('N-setup the door answers with the store installed', 'authenticated',
                                  (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
                                  'SELECT api.operator_operations_summary(24)');

SELECT pg_temp.s11h_keys('N12 the measured block''s field list is the boundary decision 1 says it is: a count, '
  || 'a max, an instant and a status',
  pg_temp.s11h_block('nmeas', 'migrations'),
  ARRAY['applied_count', 'as_of', 'highest_version', 'status']);
SELECT pg_temp.s11h_eqs('N13 its status is the other half of the two-value vocabulary', 'nmeas',
  ARRAY['blocks', 'migrations', 'status'], 'measured');
SELECT pg_temp.s11h_eq('N14 applied_count is the store''s own row count, counted here by a query that is not '
  || 'the projection',
  pg_temp.s11h_num('nmeas', ARRAY['blocks', 'migrations', 'applied_count']),
  (SELECT count(*)::numeric FROM supabase_migrations.schema_migrations));
SELECT pg_temp.s11h_eqs('N15 highest_version is the planted greatest version, surfaced as a JSON string '
  || 'because the column is a text column', 'nmeas',
  ARRAY['blocks', 'migrations', 'highest_version'], (SELECT hi_version FROM s11h_fx));
SELECT pg_temp.s11h_eq('N16 and the store''s own max over both planted rows is that same value, so N15 is an '
  || 'agreement between two readings and not a comparison of the projection with the row it just planted',
  (SELECT max(version) FROM supabase_migrations.schema_migrations), (SELECT hi_version FROM s11h_fx));
SELECT pg_temp.s11h_eq('N17 the block''s as_of is the answer''s own read instant, not a timestamp taken from '
  || 'the migration history',
  pg_temp.s11h_txt('nmeas', ARRAY['blocks', 'migrations', 'as_of']),
  pg_temp.s11h_txt('w24', ARRAY['as_of']));

-- The three columns the branch refuses are each measured against the answer, and by two routes: as a value of
-- a leaf, which a rendering difference cannot hide, and for the prose columns as a substring of the whole
-- answer. N19 is their shared control — it is the same walker over the same answer, and it must find the one
-- value the projection is permitted to surface.
SELECT pg_temp.s11h_eq('N18 no string leaf of the answer is a migration name',
  (SELECT count(*) FROM pg_temp.s11h_strv(pg_temp.s11h_snap('nmeas'), '')
    WHERE val IN (SELECT name FROM supabase_migrations.schema_migrations)), 0::bigint);
SELECT pg_temp.s11h_eq('N19 exactly one string leaf is a value of the store''s version column, so the walker '
  || 'does reach this block and only the max crosses',
  (SELECT count(*) FROM pg_temp.s11h_strv(pg_temp.s11h_snap('nmeas'), '')
    WHERE val IN (SELECT version FROM supabase_migrations.schema_migrations)), 1::bigint);
SELECT pg_temp.s11h_eq('N20 no string leaf is one of the store''s created_at values, rendered the way jsonb '
  || 'would have rendered it had the branch read the column',
  (SELECT count(*) FROM pg_temp.s11h_strv(pg_temp.s11h_snap('nmeas'), '')
    WHERE val IN (SELECT to_jsonb(created_at) #>> '{}' FROM supabase_migrations.schema_migrations)), 0::bigint);
SELECT pg_temp.s11h_eq('N21 no numeric leaf is a running_time (group L0 already proves this walker reports '
  || 'every numeric leaf, so no separate control is needed here)',
  (SELECT count(*) FROM pg_temp.s11h_leaves(pg_temp.s11h_snap('nmeas'), '')
    WHERE val IN (SELECT running_time::numeric FROM supabase_migrations.schema_migrations)), 0::bigint);

-- Date-shaped prose is the field §9 refuses to invent, so it is bounded structurally rather than by needle.
SELECT pg_temp.s11h_eq('N22 the measured block carries exactly one date-shaped string, whatever the fixture '
  || 'claims about its own history',
  (SELECT count(*) FROM jsonb_each_text(pg_temp.s11h_block('nmeas', 'migrations'))
    WHERE value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'), 1::bigint);
SELECT pg_temp.s11h_eq('N23 and that one is the as_of, so no timestamp is hiding behind a migration field name',
  (SELECT coalesce(string_agg(key, ',' ORDER BY key COLLATE "C"), '(none)')
     FROM jsonb_each_text(pg_temp.s11h_block('nmeas', 'migrations'))
    WHERE value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'), 'as_of');

-- The absence vocabulary must not leak into a present store's answer. Both sentences are read back out of the
-- `not_measured` answer rather than retyped, so a wording change in the migration moves a cell here instead of
-- silently widening a gap.
SELECT pg_temp.s11h_absent('N24 the not_measured reason sentence is not in an answer that measured the store',
  'nmeas', (SELECT absent_reason FROM s11h_mig));
SELECT pg_temp.s11h_absent('N25 nor is its note, which is a claim about the CLI and would be a lie here',
  'nmeas', (SELECT absent_note FROM s11h_mig));
SELECT pg_temp.s11h_present('N26 and the same scanner does find that reason sentence in the pre-fixture answer, '
  || 'so N24 is the answer''s property', 'w24', (SELECT absent_reason FROM s11h_mig));
SELECT pg_temp.s11h_eq('N27 group V18''s instrument, run over this different population: no measured block '
  || 'anywhere in the answer carries a reason or a note',
  (SELECT count(*) FROM jsonb_each(pg_temp.s11h_snap('nmeas') -> 'blocks')
    WHERE (value ->> 'status') = 'measured' AND (value ? 'reason' OR value ? 'note')), 0::bigint);

SELECT pg_temp.s11h_array('N28 the summary line shrinks to the three stores this schema is genuinely short of, '
  || 'by name and in order',
  (SELECT array_agg(b.value #>> '{}' ORDER BY b.ordinality)
     FROM jsonb_array_elements(pg_temp.s11h_snap('nmeas') -> 'blocks_not_measured') WITH ORDINALITY b),
  ARRAY['auth_failures', 'rate_limits', 'token_abuse']);
SELECT pg_temp.s11h_eq('N29 and the derived list still equals the recomputation over this answer, so it is a '
  || 'function of the blocks and not the four names V12 pinned',
  pg_temp.s11h_snap('nmeas') -> 'blocks_not_measured',
  (SELECT coalesce(jsonb_agg(x.k ORDER BY x.k), '[]'::jsonb)
     FROM (SELECT key AS k FROM jsonb_each(pg_temp.s11h_snap('nmeas') -> 'blocks')
            WHERE (value ->> 'status') = 'not_measured') x));
SELECT pg_temp.s11h_eq('N30 giving the projection a new store changes a status, not its surface: block_count is '
  || 'the same number the pre-fixture answer reported',
  pg_temp.s11h_num('nmeas', ARRAY['block_count']), pg_temp.s11h_num('w24', ARRAY['block_count']));
SELECT pg_temp.s11h_keys('N31 and the ten blocks are still exactly those ten, in the same order',
  pg_temp.s11h_snap('nmeas') -> 'blocks',
  ARRAY['audit', 'auth_failures', 'commerce', 'credentials', 'delivery', 'migrations',
        'publication', 'queue', 'rate_limits', 'token_abuse']);

-- An existing store that holds nothing. This is the state a real `supabase migrations up` can leave behind, and
-- it must not collapse into the absent branch.
DELETE FROM supabase_migrations.schema_migrations;
INSERT INTO pg_temp.s11h_s (tag, a)
SELECT 'nempty', pg_temp.s11h_must('N-setup the door answers with the store present but empty',
  'authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
  'SELECT api.operator_operations_summary(24)');

SELECT pg_temp.s11h_eqs('N32 an empty store is still a store: the status says measured', 'nempty',
  ARRAY['blocks', 'migrations', 'status'], 'measured');
SELECT pg_temp.s11h_eq('N33 and the honest count of it is zero',
  pg_temp.s11h_num('nempty', ARRAY['blocks', 'migrations', 'applied_count']), 0::numeric);
SELECT pg_temp.s11h_eq('N34 with no max to report, the field stays present as a JSON null rather than being '
  || 'dropped or defaulted',
  (SELECT (pg_temp.s11h_block('nempty', 'migrations') ? 'highest_version')::text || '/'
          || coalesce(jsonb_typeof(pg_temp.s11h_block('nempty', 'migrations') -> 'highest_version'),
                      '(absent)')), 'true/null');
SELECT pg_temp.s11h_ok('N35 so the two branches are distinguishable on identical row populations: measured-with-'
  || 'nothing is not not_measured',
  pg_temp.s11h_txt('nempty', ARRAY['blocks', 'migrations', 'status'])
  IS DISTINCT FROM pg_temp.s11h_txt('w24', ARRAY['blocks', 'migrations', 'status']));

-- The JSON type follows the column type: nothing in the branch casts. A tool that stored `version` as a number
-- would be reported as a number, which is what makes N15's string a reading rather than a shape.
DROP TABLE supabase_migrations.schema_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version bigint PRIMARY KEY, name text);
INSERT INTO supabase_migrations.schema_migrations (version, name)
  VALUES (20261020190500, 'stage11 operations health');
INSERT INTO pg_temp.s11h_s (tag, a)
SELECT 'nbig', pg_temp.s11h_must('N-setup the door answers a bigint version column', 'authenticated',
  (SELECT id FROM s11h_reg WHERE tag = 'op_a'), 'SELECT api.operator_operations_summary(24)');

SELECT pg_temp.s11h_eq('N36 a bigint version column comes back as a JSON number, because the branch casts '
  || 'nothing and invents nothing',
  jsonb_typeof(pg_temp.s11h_block('nbig', 'migrations') -> 'highest_version'), 'number');
SELECT pg_temp.s11h_eq('N37 and it is the store''s own max, read directly',
  pg_temp.s11h_num('nbig', ARRAY['blocks', 'migrations', 'highest_version']),
  (SELECT max(version)::numeric FROM supabase_migrations.schema_migrations));
SELECT pg_temp.s11h_keys('N38 the field list is unchanged across both store shapes',
  pg_temp.s11h_block('nbig', 'migrations'),
  ARRAY['applied_count', 'as_of', 'highest_version', 'status']);
SELECT pg_temp.s11h_absent('N39 and the prose column is still absent from a differently typed store',
  'nbig', (SELECT min(name) FROM supabase_migrations.schema_migrations));

-- The fixture goes away, and the door is read once more from the other side of the gate.
DROP SCHEMA supabase_migrations CASCADE;
CREATE TEMP TABLE s11h_dig_b ON COMMIT DROP AS SELECT pg_temp.s11h_digs()::text AS d;
INSERT INTO pg_temp.s11h_s (tag, a)
SELECT 'nback', pg_temp.s11h_must('N-setup the door answers again with no store present', 'authenticated',
  (SELECT id FROM s11h_reg WHERE tag = 'op_a'), 'SELECT api.operator_operations_summary(24)');

SELECT pg_temp.s11h_keys('N40 the block is back to the presence-gated field list C9 pinned',
  pg_temp.s11h_block('nback', 'migrations'), ARRAY['as_of', 'note', 'reason', 'status']);
SELECT pg_temp.s11h_present('N41 with its reason sentence, the same string, byte for byte', 'nback',
  (SELECT absent_reason FROM s11h_mig));
SELECT pg_temp.s11h_array('N42 and the summary line is back to the four names V12 pinned',
  (SELECT array_agg(b.value #>> '{}' ORDER BY b.ordinality)
     FROM jsonb_array_elements(pg_temp.s11h_snap('nback') -> 'blocks_not_measured') WITH ORDINALITY b),
  ARRAY['auth_failures', 'migrations', 'rate_limits', 'token_abuse']);
SELECT pg_temp.s11h_ok('N43 nothing of the fixture is left: no table, and no schema either',
  to_regclass('supabase_migrations.schema_migrations') IS NULL
  AND to_regnamespace('supabase_migrations') IS NULL);
SELECT pg_temp.s11h_same('N44 and the whole answer is byte-identical to the one read immediately before the '
  || 'excursion, so installing and dropping the store left every other block alone and left no stale plan '
  || 'behind the gate',
  pg_temp.s11h_text('npre'), pg_temp.s11h_text('nback'));
SELECT pg_temp.s11h_same('N45 with every product store this projection can reach unchanged across it, counted '
  || 'rather than asserted', (SELECT d FROM s11h_dig_a), (SELECT d FROM s11h_dig_b));

-- ===========================================================================
-- 17. R — the body cannot write, measured rather than believed.
--
--     The answer prints `writes_anything: false` and the migration comment calls the pair a read, and both of
--     those are the claim under test, not evidence for it. Header rule 6 promises three independent
--     measurements and three are made here.
--
--     (1) The `provolatile` flag group S reads is shown to be a rule the *engine* enforces, by two functions
--     this file writes with byte-identical bodies one flag apart: the STABLE one is refused and the VOLATILE
--     one writes a row. A flag nobody checks would pin as happily as one the executor obeys, so the pair, not
--     the flag, is the measurement.
--     (2) A word-bounded scan of the body's own bytes finds no DML verb — calibrated twice on those very
--     bytes, once by gluing an INSERT clause to them and watching the count become 1, and once by running the
--     same scan over a neighbouring body that really does write.
--     (3) A transaction-level read-only fence, which is the only one of the three that also covers what the
--     body cannot see: it refuses a write from a trigger, from a callee, and from `postgres` itself, which is
--     the identity that bypasses every row-level rule in this schema.
--
--     Then the eighteen digests rule 6 names, taken around a live call, with the sensitivity of the instrument
--     that took them measured rather than assumed. The fence is released by the same marker-abort idiom group
--     T uses, and that release was verified against this cluster before it was relied on here: `SET LOCAL
--     transaction_read_only` cannot be lowered from inside the transaction (25001), yet the aborted
--     subtransaction that set it gives the flag back — so the fence belongs to R28 alone and every cell after
--     it runs against an ordinary read-write transaction, which R28 measures rather than hopes.
-- ===========================================================================

-- The three scanners, each in one place, so a cell that reports an absence and the cell that proves the same
-- scanner can report a presence cannot be different scanners wearing one label.
CREATE FUNCTION pg_temp.s11h_rn_body(p_schema text, p_name text) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT pg_temp.s11h_flat(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = p_schema AND p.proname = p_name $fn$;

CREATE FUNCTION pg_temp.s11h_rn_strict_hits(p_src text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT count(*)::int FROM regexp_matches(p_src,
    '\m(insert|update|delete|merge|truncate|create|drop|alter|grant|revoke|copy|lock|setval|nextval|txid_current)\M',
    'gi') $fn$;

CREATE FUNCTION pg_temp.s11h_rn_strict_words(p_src text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT coalesce(array_agg(w ORDER BY w COLLATE "C"), '{}'::text[]) FROM (
    SELECT DISTINCT lower(m[1]) AS w FROM regexp_matches(p_src,
      '\m(insert|update|delete|merge|truncate|create|drop|alter|grant|revoke|copy|lock|setval|nextval|txid_current)\M',
      'gi') m) s(w) $fn$;

-- The loose twin of the same verb list, with the boundaries opened: every word that merely *contains* a verb.
CREATE FUNCTION pg_temp.s11h_rn_loose_hits(p_src text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT count(*)::int FROM regexp_matches(p_src,
    '(\m\w*(insert|update|delete|merge|truncate|create|drop|alter|grant|revoke|copy|lock|setval|nextval|txid_current)\w*\M)',
    'gi') $fn$;

CREATE FUNCTION pg_temp.s11h_rn_loose_words(p_src text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT coalesce(array_agg(w ORDER BY w COLLATE "C"), '{}'::text[]) FROM (
    SELECT DISTINCT lower(m[1]) AS w FROM regexp_matches(p_src,
      '(\m\w*(insert|update|delete|merge|truncate|create|drop|alter|grant|revoke|copy|lock|setval|nextval|txid_current)\w*\M)',
      'gi') m) s(w) $fn$;

-- Which names in the source are call-shaped, and which of those name a function of *this* database. The
-- second is the closure: an unqualified call could only be a built-in or a function of these six schemas, and
-- the schemas are the ones this slice's own grants live in.
CREATE FUNCTION pg_temp.s11h_rn_refs(p_src text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT coalesce(array_agg(w ORDER BY w COLLATE "C"), '{}'::text[]) FROM (
    SELECT DISTINCT m[1] AS w FROM regexp_matches(p_src,
      '(\m(?:internal_api|private|api|public|storage|auth)\.[a-z_0-9_]+\()', 'g') m) s(w) $fn$;

CREATE FUNCTION pg_temp.s11h_rn_local_calls(p_src text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT coalesce(array_agg(w ORDER BY w COLLATE "C"), '{}'::text[]) FROM (
    SELECT DISTINCT m[1] AS w FROM regexp_matches(p_src, '(\m[a-z_][a-z_0-9]*\M)\s*\(', 'gi') m
     WHERE EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('internal_api', 'private', 'api', 'public', 'storage', 'auth')
         AND p.proname = m[1])) s(w) $fn$;

-- ---------- half 1: two bodies, one flag apart, and the engine between them ----------
-- Byte-identical on purpose: `prosrc` for plpgsql is the body text alone, so the only difference the
-- catalogue can see between this pair is the flag R4 pins. The store they aim at is the one the projection
-- reads for the `audit`-adjacent grant counts, and `reason` is a free-text column no cell of this file's
-- answer carries, so the excursion cannot show up as a changed number somewhere else.
CREATE FUNCTION pg_temp.s11h_rn_stable() RETURNS text
LANGUAGE plpgsql STABLE AS $body$
DECLARE n integer;
BEGIN
  UPDATE private.operator_grants SET reason = reason || '!'
   WHERE id = (SELECT id FROM private.operator_grants WHERE scope = 'operations'
                 AND status = 'active' ORDER BY id LIMIT 1);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN 'rows_touched ' || n::text;
END $body$;

CREATE FUNCTION pg_temp.s11h_rn_volatile() RETURNS text
LANGUAGE plpgsql VOLATILE AS $body$
DECLARE n integer;
BEGIN
  UPDATE private.operator_grants SET reason = reason || '!'
   WHERE id = (SELECT id FROM private.operator_grants WHERE scope = 'operations'
                 AND status = 'active' ORDER BY id LIMIT 1);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN 'rows_touched ' || n::text;
END $body$;

SELECT pg_temp.s11h_ok('R1 the two writers are the same bytes: their `prosrc` is equal, character for '
  || 'character, so nothing but the flag can explain what happens next',
  (SELECT a.prosrc = b.prosrc FROM pg_proc a, pg_proc b
    WHERE a.oid = 'pg_temp.s11h_rn_stable()'::regprocedure
      AND b.oid = 'pg_temp.s11h_rn_volatile()'::regprocedure));

SELECT pg_temp.s11h_array('R2 and the catalogue really does hold them apart, one `s` and one `v`',
  (SELECT array_agg(x ORDER BY x COLLATE "C") FROM (
     SELECT proname || '=' || flag AS x FROM (
       SELECT p.proname AS proname, p.provolatile::text AS flag FROM pg_proc p
         WHERE p.oid IN ('pg_temp.s11h_rn_stable()'::regprocedure,
                         'pg_temp.s11h_rn_volatile()'::regprocedure)) t) s(x)),
  ARRAY['s11h_rn_stable=s', 's11h_rn_volatile=v']);

SELECT pg_temp.s11h_eq('R3 the STABLE half is refused by the executor, not by a rule this file wrote',
  pg_temp.s11h_try('postgres', NULL, 'SELECT pg_temp.s11h_rn_stable()'),
  '0A000 | UPDATE is not allowed in a non-volatile function');

-- The refused write is the measurement; the accepted one is only admissible because it is undone. One
-- `s11h_wide` call does both: its read-back runs inside the aborting subtransaction, after `RESET ROLE`, so
-- the digest below is the superuser seeing the row the control just touched.
CREATE TEMP TABLE s11h_rn_pre ON COMMIT DROP AS SELECT pg_temp.s11h_d('private.operator_grants') AS d;
CREATE TEMP TABLE s11h_rn_wide ON COMMIT DROP AS
SELECT pg_temp.s11h_wide('postgres', NULL, 'SELECT pg_temp.s11h_rn_volatile()',
  'SELECT pg_temp.s11h_d(''private.operator_grants'')') AS t;

SELECT pg_temp.s11h_eq('R4 the VOLATILE half is accepted by the same executor, with the same bytes',
  split_part((SELECT t FROM s11h_rn_wide), ' / ', 1), 'ACCEPTED');
SELECT pg_temp.s11h_ok('R5 and it wrote: the digest taken inside that subtransaction differs from the one '
  || 'taken immediately before it, so this control moved a row and did not merely run',
  (SELECT split_part(t, ' / ', 2) FROM s11h_rn_wide) <> (SELECT d FROM s11h_rn_pre));
SELECT pg_temp.s11h_same('R6 and the control put it back: the digest read after the aborted subtransaction is '
  || 'the digest read before it, which is the licence for every cell below this one',
  (SELECT d FROM s11h_rn_pre), pg_temp.s11h_d('private.operator_grants'));

SELECT pg_temp.s11h_array('R7 the door''s own flag is the one R3 was refused for and R4 was accepted for, so '
  || 'the `s` group S pinned is load-bearing rather than decorative',
  (SELECT array_agg(x ORDER BY x COLLATE "C") FROM (
     SELECT p.proname || '=' || p.provolatile::text AS x FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE (n.nspname = 'internal_api' AND p.proname = 'operator_operations_summary')
         OR p.oid IN ('pg_temp.s11h_rn_stable()'::regprocedure,
                      'pg_temp.s11h_rn_volatile()'::regprocedure)) s(x)),
  ARRAY['operator_operations_summary=s', 's11h_rn_stable=s', 's11h_rn_volatile=v']);

-- ---------- half 2: the body''s own bytes, scanned ----------
SELECT pg_temp.s11h_eq('R8 no DML verb appears as a word anywhere in the body''s source — including its '
  || 'comments, because `prosrc` carries them',
  pg_temp.s11h_rn_strict_hits(pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary')), 0);

-- Rule 3, applied to the scanner itself: a scan that cannot emit a hit is not a scan that found nothing.
SELECT pg_temp.s11h_eq('R9 the same verb list with the word boundaries opened finds 47 hits in those same '
  || 'bytes, so R8''s zero is the boundary doing the work and not an inert pattern',
  pg_temp.s11h_rn_loose_hits(pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary')), 47);

SELECT pg_temp.s11h_array('R10 and all thirteen of those words are identifiers of this projection''s own '
  || 'vocabulary — block names, column names, one plpgsql variable — never statements',
  pg_temp.s11h_rn_loose_words(pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary')),
  ARRAY['block', 'block_count', 'blocks', 'blocks_not_measured', 'created_at',
        'invalidated_by_publication_revoked', 'publication_revoked', 'revoked', 'revoked_at',
        'revoked_in_window', 'revoked_total', 'updated_at', 'v_blocks']);

SELECT pg_temp.s11h_eq('R11 glue one INSERT clause onto the end of those very bytes and the same scan '
  || 'returns 1, on this body and not on a body of the scanner''s choosing',
  pg_temp.s11h_rn_strict_hits(pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary')
    || ' INSERT INTO private.audit_events (actor_kind) VALUES (''control'')'), 1);

SELECT pg_temp.s11h_array('R12 and the hit it returns is the verb that clause added',
  pg_temp.s11h_rn_strict_words(pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary')
    || ' INSERT INTO private.audit_events (actor_kind) VALUES (''control'')'),
  ARRAY['insert']);

-- The positive control, chosen because it is this slice''s own neighbour: a DEFINER body that does write, and
-- the only reason R8 could be a scanner that never fires is if no writing body lit it up.
SELECT pg_temp.s11h_eq('R13 the slice-4 publication body, scanned by the same instrument, lights up 8 times',
  pg_temp.s11h_rn_strict_hits(pg_temp.s11h_rn_body('internal_api', 'operator_takedown_publication')), 8);
SELECT pg_temp.s11h_array('R14 with these four verbs, and it is a real statement rather than prose about one',
  pg_temp.s11h_rn_strict_words(pg_temp.s11h_rn_body('internal_api', 'operator_takedown_publication')),
  ARRAY['insert', 'lock', 'revoke', 'update']);
SELECT pg_temp.s11h_ok('R15 so R8''s zero is a reading of this body, not of a pattern that cannot fire — '
  || 'matched by position rather than LIKE, because `audit_events` carries an underscore and LIKE would spend it',
  position('INSERT INTO private.audit_events'
    IN pg_temp.s11h_rn_body('internal_api', 'operator_takedown_publication')) > 0);

-- The one gap a source scan has: a body that writes nothing itself can still reach a function that writes, or
-- a trigger. Both halves of that are measured, the reachable name here and the runtime consequence in half 3.
SELECT pg_temp.s11h_array('R16 exactly one schema-qualified name in the body is call-shaped, and it is the '
  || 'scope test S15 located',
  pg_temp.s11h_rn_refs(pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary')),
  ARRAY['private.actor_is_operator(']);

SELECT pg_temp.s11h_array('R17 and of every call-shaped token in the body, exactly one names a function of '
  || 'these six schemas, so the rest are built-ins this slice did not write',
  pg_temp.s11h_rn_local_calls(pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary')),
  ARRAY['actor_is_operator']);

SELECT pg_temp.s11h_eq('R18 that one hop lands on a function the engine also refuses writes in: STABLE, '
  || 'DEFINER, boolean, one argument',
  (SELECT p.provolatile::text || '/' || p.prosecdef::text || '/' || p.prorettype::regtype::text || '/'
     || p.pronargs::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname = 'actor_is_operator'), 's/true/boolean/1');

SELECT pg_temp.s11h_eq('R19 and its own bytes are verb-clean too, so the closure is two deep and stops there',
  pg_temp.s11h_rn_strict_hits(pg_temp.s11h_rn_body('private', 'actor_is_operator')), 0);

-- ---------- half 2b: the two disclaimers are constants ----------
SELECT pg_temp.s11h_eq('R20 the word `true` never appears in the body, so neither disclaimer field can be a '
  || 'computed value that happens to come out wrong',
  (SELECT count(*)::int FROM regexp_matches(
     pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary'), '\mtrue\M', 'g')), 0);
SELECT pg_temp.s11h_eq('R21 and `false` appears exactly twice, once per field',
  (SELECT count(*)::int FROM regexp_matches(
     pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary'), '\mfalse\M', 'g')), 2);
SELECT pg_temp.s11h_re_hits('R22 each of them is a field name glued to the word false, once, and the '
  || 'instrument that counts R20 and R21 is the one doing it',
  pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary'), '''writes_anything'', false', 1);
SELECT pg_temp.s11h_re_hits('R23 and the same for the privacy disclaimer',
  pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary'),
  '''identifiers_included'', false', 1);
SELECT pg_temp.s11h_eq('R24 and they are the last thing the body does: the source ends with the two '
  || 'disclaimers inside the returned object, immediately before END',
  (SELECT right(pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary'), 62)),
  '''writes_anything'', false, ''identifiers_included'', false); END;');

-- ---------- half 3: the transaction-level fence ----------
-- Everything the fence reports is carried out in plpgsql variables rather than in a temp table, because a
-- table created inside the aborting subtransaction goes away with it — a mechanic battery 4 wrote down and
-- this file re-measured while drafting this group.
CREATE FUNCTION pg_temp.s11h_rn_fence(p_role text, p_uid uuid, p_stmt text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v_answer jsonb; v_door text; v_write text; v_lower text;
        v_state_inside text; v_state_outside text; v_role_outside text;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL transaction_read_only = on';
    BEGIN
      UPDATE private.operator_grants SET reason = reason || '!'
       WHERE id = (SELECT id FROM private.operator_grants WHERE scope = 'operations'
                     AND status = 'active' ORDER BY id LIMIT 1);
      v_write := 'ACCEPTED';
    EXCEPTION WHEN OTHERS THEN
      v_write := SQLSTATE || ' | ' || SQLERRM;
    END;
    BEGIN
      EXECUTE 'SET LOCAL transaction_read_only = off';
      v_lower := 'ACCEPTED';
    EXCEPTION WHEN OTHERS THEN
      v_lower := SQLSTATE || ' | ' || SQLERRM;
    END;
    EXECUTE 'SET ROLE ' || p_role;
    PERFORM set_config('test.uid', coalesce(p_uid::text, ''), false);
    PERFORM set_config('test.role', p_role, false);
    BEGIN
      EXECUTE p_stmt INTO v_answer;
      v_door := 'ACCEPTED';
    EXCEPTION WHEN OTHERS THEN
      v_door := SQLSTATE || ' | ' || SQLERRM;
    END;
    v_state_inside := current_setting('transaction_read_only');
    RAISE EXCEPTION 's11h_rn_fence_rolled_back';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 's11h_rn_fence_rolled_back' THEN NULL; ELSE
      RAISE EXCEPTION 'FAIL s11h_rn_fence setup: [%] %', SQLSTATE, SQLERRM;
    END IF;
  END;
  v_state_outside := current_setting('transaction_read_only');
  v_role_outside := current_user::text;
  RETURN jsonb_build_object('door', v_door, 'answer', v_answer, 'write_under_fence', v_write,
    'lower_under_fence', v_lower, 'state_inside', v_state_inside, 'state_outside', v_state_outside,
    'role_outside', v_role_outside);
END $fn$;

-- The door read once with no fence, as the same account, immediately before the fenced call. The digest pair
-- straddles both calls, so one measurement covers the plain read and the fenced one.
CREATE TEMP TABLE s11h_rn_dig_a ON COMMIT DROP AS SELECT pg_temp.s11h_digs()::text AS d;

INSERT INTO pg_temp.s11h_s (tag, a)
SELECT 'rplain', pg_temp.s11h_must('R-setup the door read with no fence, as the operations grant holder',
  'authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
  'SELECT api.operator_operations_summary(24)');

CREATE TEMP TABLE s11h_rn ON COMMIT DROP AS
SELECT pg_temp.s11h_rn_fence('authenticated', (SELECT id FROM s11h_reg WHERE tag = 'op_a'),
  'SELECT api.operator_operations_summary(24)') AS o;

INSERT INTO pg_temp.s11h_s (tag, a) SELECT 'rfence', o -> 'answer' FROM s11h_rn;

CREATE TEMP TABLE s11h_rn_dig_b ON COMMIT DROP AS SELECT pg_temp.s11h_digs()::text AS d;

SELECT pg_temp.s11h_eq('R25 the projection answers inside a read-only transaction, which is what a pure read '
  || 'owes the fence: nothing here needed an exception',
  (SELECT o ->> 'door' FROM s11h_rn), 'ACCEPTED');
SELECT pg_temp.s11h_eq('R26 and the fence bites before the door is reached: the owner of this cluster, the '
  || 'identity that bypasses every row-level rule, is refused the same UPDATE R4 was allowed',
  (SELECT o ->> 'write_under_fence' FROM s11h_rn),
  '25006 | cannot execute UPDATE in a read-only transaction');
SELECT pg_temp.s11h_eq('R27 and it cannot be lowered from inside, so a body that talked its way past the door '
  || 'would still be inside it',
  (SELECT o ->> 'lower_under_fence' FROM s11h_rn),
  '25001 | cannot set transaction read-write mode inside a read-only transaction');
SELECT pg_temp.s11h_array('R28 on inside, off outside, and the role did not survive it either: the fence is '
  || 'this group''s subtransaction and not the battery''s',
  ARRAY[(SELECT o ->> 'state_inside' FROM s11h_rn), (SELECT o ->> 'state_outside' FROM s11h_rn),
        (SELECT o ->> 'role_outside' FROM s11h_rn)],
  ARRAY['on', 'off', 'postgres']);
SELECT pg_temp.s11h_keys('R29 the fenced answer is the whole answer, not a shrunk one: C1''s eight fields',
  pg_temp.s11h_snap('rfence'),
  ARRAY['as_of', 'block_count', 'blocks', 'blocks_not_measured', 'from_inclusive',
        'identifiers_included', 'window_hours', 'writes_anything']);
SELECT pg_temp.s11h_eq('R30 and C2''s ten blocks, counted from the field that says how many there are',
  pg_temp.s11h_num('rfence', ARRAY['block_count']), 10::numeric);
SELECT pg_temp.s11h_same('R31 and it is byte-identical to the answer the same account read one statement '
  || 'earlier with no fence at all: the fence changes what a transaction may write, and nothing about this '
  || 'projection''s reading',
  pg_temp.s11h_text('rplain'), pg_temp.s11h_text('rfence'));
SELECT pg_temp.s11h_same('R32 and identical to N''s last reading too, which is the second proof that the '
  || 'VOLATILE control at R4 put the row back — an answer is a witness the way a digest is not',
  pg_temp.s11h_text('nback'), pg_temp.s11h_text('rplain'));

-- ---------- half 4: the eighteen digests, and the instrument that took them ----------
SELECT pg_temp.s11h_eq('R33 the digest set is eighteen stores, which is the number rule 6 promised and this '
  || 'file can now count instead of assert',
  (SELECT count(*) FROM jsonb_object_keys(pg_temp.s11h_digs())), 18::bigint);
SELECT pg_temp.s11h_eq('R34 and every one of the eighteen is a real relation on this chain, so no digest is '
  || 'quietly the md5 of nothing',
  (SELECT count(*) FROM jsonb_object_keys(pg_temp.s11h_digs()) k WHERE to_regclass(k) IS NOT NULL),
  18::bigint);
SELECT pg_temp.s11h_array('R35 of the twelve stores S16 read out of the body, the only one this set does not '
  || 'hold is the migration table — and N1 already measured that it does not exist here, so there is nothing '
  || 'to digest',
  (SELECT coalesce(array_agg(w ORDER BY w COLLATE "C"), '{}'::text[]) FROM (
     SELECT DISTINCT m[1] AS w FROM regexp_matches(
        pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary'),
        'FROM ((?:public|private|storage|supabase_migrations)\.[a-z_]+)', 'g') m
      WHERE m[1] NOT IN (SELECT jsonb_object_keys(pg_temp.s11h_digs()))) s(w)),
  ARRAY['supabase_migrations.schema_migrations']);
SELECT pg_temp.s11h_array('R36 and seven stores are digested that the body never reads: the witness is wider '
  || 'than the mirror, which is the only way it can see a write the projection did not need',
  (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
     FROM jsonb_object_keys(pg_temp.s11h_digs()) k
    WHERE k NOT IN (SELECT DISTINCT m[1] FROM regexp_matches(
        pg_temp.s11h_rn_body('internal_api', 'operator_operations_summary'),
        'FROM ((?:public|private|storage|supabase_migrations)\.[a-z_]+)', 'g') m)),
  ARRAY['auth.users', 'private.operator_grants', 'public.entitlements', 'public.guest_households',
        'public.invitation_versions', 'public.weddings', 'storage.objects']);
SELECT pg_temp.s11h_same('R37 all eighteen digests are the same bytes on both sides of the live call and the '
  || 'fenced call: one write to any of them, by any route, would move exactly one md5 of this string',
  (SELECT d FROM s11h_rn_dig_a), (SELECT d FROM s11h_rn_dig_b));
SELECT pg_temp.s11h_eq('R38 and the empty set is named rather than implied: no store in the eighteen '
  || 'disagrees with itself across the two calls',
  (SELECT coalesce(string_agg(k, ','), '(none)')
     FROM jsonb_object_keys((SELECT d FROM s11h_rn_dig_a)::jsonb) k
    WHERE (SELECT d FROM s11h_rn_dig_a)::jsonb -> k
       IS DISTINCT FROM (SELECT d FROM s11h_rn_dig_b)::jsonb -> k),
  '(none)');

-- ===========================================================================
-- 18. Z — the floor, and the total the committed runner reads.
--
--     `run.sh` runs every `[89]*.sql` here through `suite … lines`, which fails the run when a battery prints
--     no `PASSED (n)` total at all, and then fails it when that total disagrees with the number of `PASS` lines
--     it counted. So the emitter below is not decoration: without it a green 626-cell replay in this file's own
--     driver is a red runner, and the discrepancy check is what turns the exact count into a two-sided
--     instrument rather than a number printed for optics.
--
--     The count is pinned to the measured total of run 41 — the fourteen letter groups this file emits,
--     `B`, `C`, `W`, `S`, `A`, `L`, `V`, `M`, `I`, `P`, `T`, `D`, `N` and `R`, at
--     `exit=0`, `pass=626`, `CELLS=626`, one `PASS` line per cell — rather than to a round expectation, and it
--     is exact rather than a `>=` floor because a battery that silently gains a cell has as much right to stop
--     the run as one that loses it. A lost cell is a promise unmeasured; a gained one is usually a duplicate
--     id or a section copied twice, and both make every count in the closing report a guess.
-- ===========================================================================
DO $f$
DECLARE v integer;
BEGIN
  v := coalesce(nullif(current_setting('s11h.passed', true), ''), '0')::int;
  IF v <> 626 THEN
    RAISE EXCEPTION 'FAIL floor: this battery is a fixed catalogue of 626 cells and counted % — a '
      'suite that silently gains or loses cells is worse than one that fails', v;
  END IF;
  RAISE NOTICE 'PASSED (%)', v;
END $f$;

