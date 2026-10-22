-- Stage 11 battery 1: operator authority, and the one audit trail that has to be able to say who decided.
--
-- Run by `supabase/tests/stage11/run.sh authority` on a chain that has applied every migration and run
-- nothing else, as the owner role, in one transaction that commits. It sorts first in the runner's
-- `[89]*.sql` glob, and that ordering is load-bearing: group A's "the state the migrations ship" cells
-- measure the post-migration schema rather than a schema a battery has already written to, which is what
-- makes A01, the seeded-operator refusal that `operations-admin-security.md` §14 records as a standing
-- constraint, a measurement instead of a tautology. Slice 2's battery runs after this one on the same
-- chain and therefore inherits the three grant rows and four trail rows this file leaves, which is why it
-- measures its own effects as digests and deltas rather than as absolutes.
--
-- What this file is allowed to claim, and what it is not. Everything here is SQL: it proves the table, the
-- predicate, the two bodies, the five audit columns, the audit CHECKs, the idempotency index and the
-- privilege revocations. It does not prove that an HTTP caller is refused, because the caller class that
-- matters — a signed-in host with a real JWT presented to PostgREST — cannot exist in a throwaway Postgres.
-- The `test.uid` shim in `supabase/tests/rls/00_bootstrap.sql:37-40` stands in for the *claim*, so the
-- predicate cells measure which row a definer body would decide on, and the wire half of the same claim
-- belongs to `supabase/tests/api/stage11_operations.test.mjs`.
--
--   A01–A08c  what the migrations ship: empty, RLS with no policy, no client privilege, the declared
--             surface (32 / 51 / 45), the posture of the five new names, the five audit columns, the
--             revocation and the trigger pair.
--   A09–A26b  every privilege refusal, role by role, plus the digest proving none of them wrote a row.
--   R01–R17   what the two bodies refuse to write, and the shape of the sentence they answer with.
--   W01–W15b  the success path: a grant that reads back, the audit row it writes, the duplicate refusal,
--             a revocation that is a status write on the same row, and a re-grant that is a new row. W09
--             is written first on purpose — it is the revocation-before-any-grant refusal, and it has to
--             be measured before W10 creates the grant that would make the same sentence ambiguous.
--   T01–T11c  `actor_is_operator`'s truth table over the states W produced: no session, an account with
--             nothing, a uuid that is no account, an unknown word, a NULL, the scope granted and the three
--             that were not, an expiry in the past, and the human who minted every grant.
--   K01–K09b  the grant row's own CHECKs and its partial unique index, reachable only by a hand plant.
--   AI01–AI24 the trail: the whole privilege matrix, attribution as attribution, the six refused
--             mutations, the digest that does not move, the one power the server key still has, the replay
--             index, and the seven rules (six CHECKs and one INSERT guard).
--   Z01–Z08   the census this file leaves behind. Z01 prints a CENSUS line rather than a PASS, so the
--             runner's two numbers differ by one by design: 137 assertions and 137 PASS lines, plus the
--             census.
--
-- Two cells changed the migration rather than the expectation, and both are worth naming where the reader
-- will look for them. AI15 plants a human-kind audit row whose `reason` is NULL. Written against the first
-- draft of `20261020190000_stage11_operator_authority.sql`, the plant was *accepted*:
-- `CHECK (actor_kind = 'system' OR length(btrim(reason)) > 0)` evaluates to NULL for a NULL reason, and a
-- CHECK passes on NULL — so the rule §4 states ("a human decision with no stated reason is unrepresentable")
-- held for a blank string and not for the absence of one. The migration now wraps the length in
-- `coalesce(…, 0)`; the cell is the measurement of both halves, and the sweep for the same three-valued-logic
-- shape across every other migration CHECK found one sibling — `20260925120300_stage2_…:181` — already
-- written with the guard.
--
-- AI16's change is a *placement*, and it was forced by the measurement group T of `85_support_lifecycle.sql`
-- records. The sibling rule — a human-kind row must name an account — was a CHECK, and a CHECK also fires on
-- the UPDATE the database performs for `ON DELETE SET NULL` when an account is removed. Kept as a CHECK it
-- refused exactly the surviving rows §12 promises, and made every account that ever acted undeletable. It is
-- now a BEFORE INSERT guard, which refuses the same hand plants with the same SQLSTATE and says nothing about
-- an UPDATE. The UPDATE guard's own hole narrowed with it: a link may move only to NULL and only from inside
-- another trigger (`pg_trigger_depth() >= 2`), because the parent-existence test shipped in the first draft
-- was measured to be unreachable — a command cannot see its own in-flight deletion.
--
-- Five postures this file deliberately takes, each because the naive version of it is wrong.
--   1. A refusal is asserted twice: as the SQLSTATE and sentence, and as the row that did NOT appear. A
--      guard that raised after writing half its effects would pass a message-only test, and on the grant
--      path "half its effects" is a credential that exists.
--   2. "Changed nothing" is a digest of the grant table (`s11a_gstate`) taken before the refusal batteries
--      and re-taken after them, so a refusal that quietly wrote a row fails even when its sentence was
--      right. Same shape for the trail (`s11a_adigest`), which is why group AI's plants are deleted again.
--   3. Three refusal layers exist across these objects and they answer with different words. `anon` and
--      `authenticated` hold no USAGE on the `private` schema at all, so they hear `permission denied for
--      schema private` before any object check runs; `service_role` does hold schema USAGE (measured at
--      C17b) and therefore hears the object-level denial; and on `internal_api` the layering runs the other
--      way — the two request roles were given schema USAGE back at Stage 3 so a wrapper can reach them, so
--      they hear the *function* denial that proves the REVOKE, while `service_role` has no USAGE there and
--      hears a schema denial. A battery that asserted one sentence for all three roles would be asserting a
--      fiction about the least-privileged caller, so A09–A25 name the layer each role actually reaches.
--   4. Every cell that needs a row the bodies refuse to create is labelled as a plant, and the undo is
--      proved. Group AI's plants differ from group K's: audit rows refuse UPDATE to every role, so the
--      only way back is the trusted DELETE that AI12 measures, and the digest that returns to its baseline
--      is what shows the prune worked.
--   5. `p_actor_user_id` is asserted as attribution and never as authorisation. W04 reads it back naming a
--      human who is a *different* account from the beneficiary, and T11 shows that human answers `false`
--      for every scope — which is the whole reason §3's self-grant decision and C29c-b's exception are
--      honest: the column records whom the console said was deciding, and that caller could already have
--      written the row by hand.

SET client_min_messages = notice;
SET search_path = public, pg_temp;

SELECT set_config('s11a.passed', '0', false);

-- --------------------------------------------------------------------------- the harness
CREATE FUNCTION pg_temp.s11a_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s11a.passed',
    (coalesce(nullif(current_setting('s11a.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s11a_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11a_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11a_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11a_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11a_array(label text, got text[], want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label,
      array_to_string(coalesce(got, ARRAY[]::text[]), ', '),
      array_to_string(coalesce(want, ARRAY[]::text[]), ', ');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11a_add(1);
END $fn$;

-- The keys a returned object is allowed to have, in sorted order. A body that starts returning a whole row
-- is how a column the next migration adds reaches an operator screen without anybody reviewing it.
CREATE FUNCTION pg_temp.s11a_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % not an object', label, coalesce(jsonb_typeof(v), 'NULL');
  END IF;
  PERFORM pg_temp.s11a_array(label,
    (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
       FROM jsonb_object_keys(v) k), want);
END $fn$;

-- A refusal measured as both halves of one answer: the code and the sentence. `left(SQLSTATE,5)` alone
-- cannot tell a 42501 from a psql syntax error — this repository has done exactly that once — and a cell
-- that only checks the sentence cannot tell this refusal from that one.
CREATE FUNCTION pg_temp.s11a_err_is(label text, got text, want_state text, want_like text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got IS NULL OR split_part(got, ' | ', 1) <> want_state OR got NOT LIKE want_like THEN
    RAISE EXCEPTION 'FAIL %: got [%] want [% / %]', label, got, want_state, want_like;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11a_add(1);
END $fn$;

-- The opposite assertion, for the two cells whose finding is that a statement was *allowed*. It prints
-- what the role actually heard on failure, because a leaked-key cell that quietly stopped leaking would
-- otherwise read as a harness mistake rather than as a change in the boundary.
CREATE FUNCTION pg_temp.s11a_accept(label text, got text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'FAIL %: expected the statement to be accepted, it heard [%]', label, got;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11a_add(1);
END $fn$;

-- A read as another role, answer text included, so a cell can assert what a refusal looked like *to that
-- role*. `RESET ROLE` on every path: a probe that left the session inside `authenticated` would make every
-- later cell answer as the wrong caller, and because the capture helper swallows the statement's own
-- exception, the ordinary return is the success path — so the reset belongs there too.
CREATE FUNCTION pg_temp.s11a_cap_read(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  BEGIN
    EXECUTE stmt INTO v;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' | ' || SQLERRM;
  END;
  RETURN coalesce(v, '(null)');
END $fn$;

-- A write probe, for the statements that return no rows and therefore cannot go through `EXECUTE … INTO`.
CREATE FUNCTION pg_temp.s11a_cap_write(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' | ' || SQLERRM;
  END;
  RETURN 'ACCEPTED';
END $fn$;

CREATE FUNCTION pg_temp.s11a_try(p_role text, p_uid text, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  PERFORM set_config('test.uid', coalesce(p_uid, ''), false);
  PERFORM set_config('test.role', p_role, false);
  BEGIN
    v := pg_temp.s11a_cap_read(stmt);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL: probe harness broke on % — %', stmt, SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $fn$;

CREATE FUNCTION pg_temp.s11a_try_write(p_role text, p_uid text, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  PERFORM set_config('test.uid', coalesce(p_uid, ''), false);
  PERFORM set_config('test.role', p_role, false);
  BEGIN
    v := pg_temp.s11a_cap_write(stmt);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL: probe harness broke on % — %', stmt, SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $fn$;

-- --------------------------------------------------------------------------- the cast
-- Four accounts and one uuid that is nobody. `op_a` is the support operator-to-be, `op_b` holds the scope
-- that gets revoked and re-granted, `plain` is a signed-in host who never gets anything, and `decider` is
-- the human the console names behind every act — deliberately never one of the three beneficiaries, so
-- every audit row this file writes proves the two ids are different columns rather than one copied twice.
-- `ghost` is never inserted into `auth.users`: it is the uuid a caller names to reach the refusals that
-- say "no such account".
CREATE TEMP TABLE s11r ON COMMIT DROP AS
SELECT gen_random_uuid() AS op_a, gen_random_uuid() AS op_b,
       gen_random_uuid() AS plain, gen_random_uuid() AS decider,
       gen_random_uuid() AS ghost;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT s.op_a,     's11-op-a@stage11qual.test',     '{}'::jsonb FROM s11r s
UNION ALL SELECT s.op_b,     's11-op-b@stage11qual.test',     '{}'::jsonb FROM s11r s
UNION ALL SELECT s.plain,    's11-plain@stage11qual.test',    '{}'::jsonb FROM s11r s
UNION ALL SELECT s.decider,  's11-decider@stage11qual.test',  '{}'::jsonb FROM s11r s;

-- The two bodies, called the only way they can be called: as the owner, because no role this file may
-- switch into holds EXECUTE — which is A20–A25, measured rather than asserted. `_error` in the answer is
-- how a refusal cell reads the body's own sentence instead of the harness breaking.
CREATE FUNCTION pg_temp.s11a_grant(p_acct uuid, p_scope text, p_reason text,
                                  p_actor uuid, p_expires timestamptz DEFAULT NULL) RETURNS jsonb
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

CREATE FUNCTION pg_temp.s11a_revoke(p_acct uuid, p_scope text, p_reason text, p_actor uuid) RETURNS jsonb
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

-- The predicate, read the way a definer wrapper reads it: as the owner, with the caller's uid claimed in
-- the session. NOT an HTTP measurement — that is the API battery's job — but it is the measurement of
-- which row the predicate decides on, which no HTTP test can see.
CREATE FUNCTION pg_temp.s11a_is(p_uid uuid, p_scope text) RETURNS boolean
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

-- Every column of every audit row, in identity order. Taken at the head of group AI and re-taken after the
-- refused mutations and the undone plants: "the trail did not move" is a digest, not an adjective.
CREATE FUNCTION pg_temp.s11a_adigest() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || coalesce(wedding_id::text,'') || '|' || subject_type || '|'
           || coalesce(subject_key::text,'') || '|' || action || '|' || actor_role || '|'
           || coalesce(actor_user_id::text,'') || '|' || payload::text || '|'
           || created_at::text || '|' || actor_kind || '|' || coalesce(reason,'') || '|'
           || coalesce(idempotency_key,'') || '|' || coalesce(before_state::text,'') || '|'
           || coalesce(after_state::text,''), '~' ORDER BY id), ''))
    FROM private.audit_events $fn$;

CREATE FUNCTION pg_temp.s11a_acount() RETURNS bigint
LANGUAGE sql STABLE AS $fn$ SELECT count(*) FROM private.audit_events $fn$;

-- The grant table as one string, for the "a refusal wrote nothing" half.
CREATE FUNCTION pg_temp.s11a_gstate() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || user_id::text || '|' || scope || '|' || status || '|' || reason || '|'
           || coalesce(granted_by_user_id::text,'') || '|' || granted_at::text || '|'
           || coalesce(expires_at::text,'') || '|' || coalesce(revoked_at::text,'') || '|'
           || created_at::text || '|' || updated_at::text, '~' ORDER BY id), ''))
    FROM private.operator_grants $fn$;

CREATE FUNCTION pg_temp.s11a_gcount() RETURNS bigint
LANGUAGE sql STABLE AS $fn$ SELECT count(*) FROM private.operator_grants $fn$;

-- One audit row, by the pair that is unique for the rows this file's bodies write: one `granted` and one
-- `revoked` per grant id.
CREATE FUNCTION pg_temp.s11a_row(p_action text, p_subject uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT to_jsonb(a)::jsonb FROM private.audit_events a
   WHERE a.action = p_action AND a.subject_key = p_subject $fn$;

CREATE FUNCTION pg_temp.s11a_grant_id(p_acct uuid, p_scope text) RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT g.id FROM private.operator_grants g
   WHERE g.user_id = p_acct AND g.scope = p_scope ORDER BY g.granted_at DESC LIMIT 1 $fn$;

-- ===========================================================================
-- 1 + 2. The state the migrations ship, and every privilege refusal (A01–A26)
-- ===========================================================================
DO $a$
DECLARE s s11r%ROWTYPE; v text; g0 text;
BEGIN
  SELECT * INTO s FROM s11r;

  -- §14's standing constraint: "No live operator authority is granted by this kickoff document." On this
  -- chain nothing has run but the migrations, so emptiness here is a schema fact and not a policy line.
  PERFORM pg_temp.s11a_eq('A01 the chain ships no operator: private.operator_grants is empty after every '
    || 'migration and before this file writes anything',
    (SELECT count(*)::int FROM private.operator_grants), 0);

  PERFORM pg_temp.s11a_eq('A02 authority lives behind RLS with zero policies — a later GRANT of table '
    || 'SELECT still reveals nothing, because there is no policy that would let a row through',
    (SELECT count(*)::int FROM pg_policies
      WHERE schemaname = 'private' AND tablename = 'operator_grants'), 0);
  PERFORM pg_temp.s11a_ok('A02b the table has RLS *enabled*, which is the half A02 needs in order to mean '
    || 'anything at all',
    (SELECT c.relrowsecurity FROM pg_class c
      WHERE c.relname = 'operator_grants' AND c.relnamespace = 'private'::regnamespace));

  -- The privilege half, by command and not by table: `has_table_privilege(..., 'SELECT')` is false under a
  -- column grant, and this stage's claim is that there is no grant of any kind to hand back.
  PERFORM pg_temp.s11a_ok('A03 no role a request can arrive as — including the server key — holds any DML '
    || 'privilege on the grant table, so the two service-only bodies are the only way in',
    NOT EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) r(rol)
      CROSS JOIN LATERAL unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','REFERENCES','TRIGGER']) c(cmd)
     WHERE has_table_privilege(r.rol, 'private.operator_grants', c.cmd)));

  PERFORM pg_temp.s11a_ok('A04 the predicate is a definer because it must read a table its callers cannot '
    || 'name, it pins an empty search_path, and it is executable by no request-bearing role',
    (SELECT p.prosecdef FROM pg_proc p
      WHERE p.proname = 'actor_is_operator' AND p.pronamespace = 'private'::regnamespace)
    AND (SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_proc p
      WHERE p.proname = 'actor_is_operator' AND p.pronamespace = 'private'::regnamespace)
    AND NOT has_function_privilege('anon', 'private.actor_is_operator(text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'private.actor_is_operator(text)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'private.actor_is_operator(text)', 'EXECUTE'));

  PERFORM pg_temp.s11a_ok('A05 the two writing bodies exist in internal_api, are SECURITY INVOKER on the '
    || '17-body precedent measured before this migration was written, and are executable by no role at '
    || 'all — not even the server key',
    (SELECT count(*) = 2 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'internal_api'
        AND p.proname IN ('grant_operator_role','revoke_operator_role')
        AND NOT p.prosecdef)
    AND NOT has_function_privilege('anon',
          'internal_api.grant_operator_role(uuid,text,text,uuid,timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
          'internal_api.grant_operator_role(uuid,text,text,uuid,timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('service_role',
          'internal_api.grant_operator_role(uuid,text,text,uuid,timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('anon',
          'internal_api.revoke_operator_role(uuid,text,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
          'internal_api.revoke_operator_role(uuid,text,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role',
          'internal_api.revoke_operator_role(uuid,text,text,uuid)', 'EXECUTE'));

  PERFORM pg_temp.s11a_eq('A05b none of the three new names has an `api` wrapper: a browser asking to be an '
    || 'operator is not a surface this stage chooses not to have, and this is the cell that notices if one '
    || 'ever arrives',
    (SELECT count(*)::int FROM pg_proc p
      WHERE p.pronamespace = 'api'::regnamespace
        AND p.proname IN ('grant_operator_role','revoke_operator_role','actor_is_operator')), 0);

  -- The declared surface for this head, counted from `pg_proc` rather than grepped from source, so a name
  -- declared twice with two argument lists counts twice here. Slice 1 moved these numbers by three names in
  -- total and added no wrapper; slice 2 moved all three; slice 3 moves all three again with its four
  -- wrappers, four bodies and three private trigger functions: api 36, internal_api 55 and private 48. The
  -- step is worth stating as a sum rather than as a number because the difference between the slices is the
  -- finding this file exists to make: slice 1's half of Stage 11 is reachable by no browser at all, slice
  -- 2's half is a support surface, and slice 3's is a privacy surface with a state machine behind it.
  PERFORM pg_temp.s11a_eq('A06a the declared api surface is 36 names: Stage 10''s twenty-two plus slice '
    || '2''s ten support wrappers plus slice 3''s four privacy wrappers',
    (SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'api'::regnamespace), 36);
  PERFORM pg_temp.s11a_eq('A06b internal_api is 55: thirty-nine at Stage 10, plus slice 1''s pair, plus '
    || 'slice 2''s ten support bodies, plus slice 3''s four privacy bodies',
    (SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'internal_api'::regnamespace), 55);
  PERFORM pg_temp.s11a_eq('A06c private is 48: thirty-seven at Stage 10, plus the predicate slice 1 '
    || 'added and its audit pair, plus slice 2''s five trigger functions, plus slice 3''s three — the ref '
    || 'minter, the insert-time requester guard, and the state-machine guard',
    (SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'private'::regnamespace), 48);

  PERFORM pg_temp.s11a_array('A07 the audit trail gained exactly the five columns §4 names, and no existing '
    || 'column was repurposed: the new half of the row is named, not counted',
    (SELECT array_agg(a.attname ORDER BY a.attname COLLATE "C") FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
     WHERE c.relname = 'audit_events' AND c.relnamespace = 'private'::regnamespace
       AND a.attname = ANY (ARRAY['actor_kind','reason','idempotency_key','before_state','after_state'])),
    ARRAY['actor_kind','after_state','before_state','idempotency_key','reason']);

  PERFORM pg_temp.s11a_eq('A07b the default for a row that says nothing about a human is `system`, which is '
    || 'why the existing Stage 10 audit INSERT sites needed no edit and why a machine row cannot silently '
    || 'claim a person',
    (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      JOIN pg_class c ON c.oid = a.attrelid
     WHERE c.relname = 'audit_events' AND c.relnamespace = 'private'::regnamespace
       AND a.attname = 'actor_kind'), '''system''::text');

  PERFORM pg_temp.s11a_ok('A08 the revocation is real, and it is asymmetric on purpose: the server key '
    || 'keeps its evidence-gathering powers (SELECT, INSERT) and loses its rewriting ones',
    has_table_privilege('service_role', 'private.audit_events', 'SELECT')
    AND has_table_privilege('service_role', 'private.audit_events', 'INSERT')
    AND NOT has_table_privilege('service_role', 'private.audit_events', 'UPDATE')
    AND NOT has_table_privilege('service_role', 'private.audit_events', 'DELETE'));

  PERFORM pg_temp.s11a_array('A08b the absolute refusal is attached, by name and by function, beside the '
    || 'client guard it does not replace — two BEFORE UPDATE triggers, firing in the order group AI measures',
    (SELECT array_agg(t.tgname || '=' || p.proname ORDER BY t.tgname COLLATE "C") FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE c.relname = 'audit_events' AND c.relnamespace = 'private'::regnamespace
       AND NOT t.tgisinternal AND t.tgtype::int & 16 = 16 AND t.tgtype::int & 2 = 2),
    ARRAY['audit_append_only_no_update=reject_client_write',
          'audit_no_update_any_role=reject_audit_update_except_referential_null']);

  PERFORM pg_temp.s11a_array('A08c the grant table carries the two baseline guards plus the updated_at '
    || 'touch, and nothing else — a third writer-side trigger here would be a rule nobody described',
    (SELECT array_agg(t.tgname || '=' || p.proname ORDER BY t.tgname COLLATE "C") FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE c.relname = 'operator_grants' AND c.relnamespace = 'private'::regnamespace
       AND NOT t.tgisinternal),
    ARRAY['operator_grants_no_client_delete=reject_client_delete',
          'operator_grants_no_client_write=reject_client_write',
          'set_updated_at=touch_updated_at']);

  PERFORM pg_temp.s11a_array('A08d every trigger on the trail, on any edge: four names, and the fourth is '
    || 'the one this slice moved from a table CHECK to a BEFORE INSERT guard so that the UPDATE an account '
    || 'deletion performs is not refused by an anti-forgery rule — an inventory of only the UPDATE half '
    || 'would not notice the guard being dropped',
    (SELECT array_agg(t.tgname || '=' || p.proname ORDER BY t.tgname COLLATE "C") FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE c.relname = 'audit_events' AND c.relnamespace = 'private'::regnamespace
       AND NOT t.tgisinternal),
    ARRAY['audit_append_only_no_delete=reject_client_delete',
          'audit_append_only_no_update=reject_client_write',
          'audit_human_row_names_a_human=reject_audit_human_row_without_actor',
          'audit_no_update_any_role=reject_audit_update_except_referential_null']);

  -- --------------------------------------------------------------------------- the refusals
  -- Every attempt below is made *as that role*, and the residue is re-counted after all of them. A refusal
  -- whose SQLSTATE was right and whose effects happened anyway is the failure shape this half exists to
  -- catch, and on this table "its effects" would be a credential.
  g0 := pg_temp.s11a_gstate();

  -- anon and authenticated hold no USAGE on the `private` schema (C17), so their denial names the schema
  -- and not the table — measured here rather than assumed, because the sentence is what a log would show.
  v := pg_temp.s11a_try('anon', '', 'SELECT count(*)::text FROM private.operator_grants');
  PERFORM pg_temp.s11a_err_is('A09 an anonymous read of the grant table is refused at the schema layer',
    v, '42501', '%permission denied for schema private%');

  v := pg_temp.s11a_try_write('anon', '',
    'INSERT INTO private.operator_grants (user_id, scope, reason) VALUES ('
    || quote_literal(s.op_a::text) || ', ' || quote_literal('support') || ', '
    || quote_literal('an anonymous caller minting itself authority') || ')');
  PERFORM pg_temp.s11a_err_is('A10 an anonymous write of a credential is refused at the same layer',
    v, '42501', '%permission denied for schema private%');

  v := pg_temp.s11a_try('authenticated', s.plain::text,
    'SELECT count(*)::text FROM private.operator_grants');
  PERFORM pg_temp.s11a_err_is('A11 a signed-in host cannot even ask who the operators are',
    v, '42501', '%permission denied for schema private%');

  v := pg_temp.s11a_try_write('authenticated', s.plain::text,
    'INSERT INTO private.operator_grants (user_id, scope, reason) VALUES ('
    || quote_literal(s.plain::text) || ', ' || quote_literal('support') || ', '
    || quote_literal('self-service from a host session') || ')');
  PERFORM pg_temp.s11a_err_is('A12 a signed-in host cannot grant itself support authority: the hostile-host '
    || 'case §14 asks for, refused before the row exists',
    v, '42501', '%permission denied for schema private%');

  -- service_role does hold schema USAGE (C17b), so it reaches the object check and hears the object's name.
  v := pg_temp.s11a_try('service_role', '', 'SELECT count(*)::text FROM private.operator_grants');
  PERFORM pg_temp.s11a_err_is('A13 the server key cannot read who holds authority — the key that can reach '
    || 'every customer row in this schema is refused this one',
    v, '42501', '%permission denied for table operator_grants%');

  v := pg_temp.s11a_try_write('service_role', '',
    'INSERT INTO private.operator_grants (user_id, scope, reason) VALUES ('
    || quote_literal(s.op_a::text) || ', ' || quote_literal('operations') || ', '
    || quote_literal('a server key deciding') || ')');
  PERFORM pg_temp.s11a_err_is('A14 the server key cannot write a credential',
    v, '42501', '%permission denied for table operator_grants%');

  v := pg_temp.s11a_try_write('service_role', '',
    'UPDATE private.operator_grants SET status = ' || quote_literal('active') || ' WHERE user_id = '
    || quote_literal(s.op_a::text));
  PERFORM pg_temp.s11a_err_is('A15 the server key cannot resurrect a revoked credential',
    v, '42501', '%permission denied for table operator_grants%');

  v := pg_temp.s11a_try_write('service_role', '', 'DELETE FROM private.operator_grants');
  PERFORM pg_temp.s11a_err_is('A16 the server key cannot erase the record that a credential existed',
    v, '42501', '%permission denied for table operator_grants%');

  -- The predicate, reached directly. This is the call a browser-facing wrapper would make, and there is no
  -- wrapper — so what is measured is that even the schema-qualified name is unreachable.
  v := pg_temp.s11a_try('anon', '', 'SELECT private.actor_is_operator(' || quote_literal('support') || ')');
  PERFORM pg_temp.s11a_err_is('A17 an anonymous caller cannot reach the predicate at all',
    v, '42501', '%permission denied for schema private%');

  v := pg_temp.s11a_try('authenticated', s.plain::text,
    'SELECT private.actor_is_operator(' || quote_literal('support') || ')');
  PERFORM pg_temp.s11a_err_is('A18 a signed-in host cannot reach it either — the refusal happens before '
    || 'the predicate could answer false, which is why the definer shape matters for the wrapper case and '
    || 'not for this one',
    v, '42501', '%permission denied for schema private%');

  v := pg_temp.s11a_try('service_role', '',
    'SELECT private.actor_is_operator(' || quote_literal('support') || ')');
  PERFORM pg_temp.s11a_err_is('A19 the server key reaches the schema and is refused the function',
    v, '42501', '%permission denied for function actor_is_operator%');

  v := pg_temp.s11a_try_write('anon', '',
    'SELECT internal_api.grant_operator_role(' || quote_literal(s.op_a::text) || ', '
    || quote_literal('support') || ', ' || quote_literal('via the wire') || ', '
    || quote_literal(s.op_a::text) || ', NULL)');
  PERFORM pg_temp.s11a_err_is('A20 an anonymous caller cannot invoke the granting body',
    v, '42501', '%permission denied for function grant_operator_role%');

  v := pg_temp.s11a_try_write('authenticated', s.plain::text,
    'SELECT internal_api.grant_operator_role(' || quote_literal(s.plain::text) || ', '
    || quote_literal('support') || ', ' || quote_literal('via the wire') || ', '
    || quote_literal(s.plain::text) || ', NULL)');
  PERFORM pg_temp.s11a_err_is('A21 a signed-in host cannot invoke it either, even naming itself as both '
    || 'beneficiary and decider',
    v, '42501', '%permission denied for function grant_operator_role%');

  v := pg_temp.s11a_try_write('service_role', '',
    'SELECT internal_api.grant_operator_role(' || quote_literal(s.op_a::text) || ', '
    || quote_literal('support') || ', ' || quote_literal('via the server key') || ', '
    || quote_literal(s.op_a::text) || ', NULL)');
  PERFORM pg_temp.s11a_err_is('A22 the server key is refused one layer earlier again — it holds no USAGE on '
    || 'internal_api at all, so a leaked key cannot even name the schema these bodies live in, which is a '
    || 'second barrier independent of the function REVOKE that A20 and A21 measure for the roles that do',
    v, '42501', '%permission denied for schema internal_api%');

  v := pg_temp.s11a_try_write('anon', '',
    'SELECT internal_api.revoke_operator_role(' || quote_literal(s.op_a::text) || ', '
    || quote_literal('support') || ', ' || quote_literal('via the wire') || ', '
    || quote_literal(s.op_a::text) || ')');
  PERFORM pg_temp.s11a_err_is('A23 an anonymous caller cannot invoke the revoking body',
    v, '42501', '%permission denied for function revoke_operator_role%');

  v := pg_temp.s11a_try_write('authenticated', s.plain::text,
    'SELECT internal_api.revoke_operator_role(' || quote_literal(s.op_a::text) || ', '
    || quote_literal('support') || ', ' || quote_literal('spite') || ', '
    || quote_literal(s.plain::text) || ')');
  PERFORM pg_temp.s11a_err_is('A24 a signed-in host cannot revoke another account''s authority',
    v, '42501', '%permission denied for function revoke_operator_role%');

  v := pg_temp.s11a_try_write('service_role', '',
    'SELECT internal_api.revoke_operator_role(' || quote_literal(s.op_a::text) || ', '
    || quote_literal('support') || ', ' || quote_literal('via the server key') || ', '
    || quote_literal(s.op_a::text) || ')');
  PERFORM pg_temp.s11a_err_is('A25 and the revoking body is refused to the server key at the same schema '
    || 'layer — neither direction of a credential change is reachable with the API key',
    v, '42501', '%permission denied for schema internal_api%');

  -- The residue: eighteen probes, and not one byte moved.
  PERFORM pg_temp.s11a_eq('A26 the grant table''s digest is identical after all seventeen privilege probes, '
    || 'so none of them wrote the row its sentence refused',
    pg_temp.s11a_gstate(), g0);
  PERFORM pg_temp.s11a_eq('A26b and the row count is still zero',
    (SELECT count(*)::int FROM private.operator_grants), 0);
END $a$;

-- ===========================================================================
-- 3. What the two bodies refuse to write (R01–R13)
-- ===========================================================================
DO $r$
DECLARE s s11r%ROWTYPE; v jsonb; t text; g0 text; a0 text; n0 bigint; c0 bigint;
BEGIN
  SELECT * INTO s FROM s11r;
  g0 := pg_temp.s11a_gstate();
  a0 := pg_temp.s11a_adigest();
  n0 := pg_temp.s11a_gcount();
  c0 := pg_temp.s11a_acount();

  -- The scope vocabulary, the reason, both accounts, the expiry: the body checks every input before it
  -- touches the table, so a refusal here leaves no half-decision behind. The table's own CHECKs are the
  -- same rules and group K reaches them directly.
  v := pg_temp.s11a_grant(s.op_a, 'qa', 'Battery 1: the fifth word nobody reviewed.', s.decider);
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('R01 an unknown scope is refused, and the sentence names the four duties '
    || 'rather than saying "invalid input"', t, '23514',
    '%a fifth word here would be a grant nobody reviewed%');

  v := pg_temp.s11a_grant(s.op_a, 'support', NULL, s.decider);
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('R02 a grant with no reason is refused: a credential that cannot say why it '
    || 'exists is a permanent one with no account of itself', t, '23514', '%must say why%');

  v := pg_temp.s11a_grant(s.op_a, 'support', '     ', s.decider);
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('R03 whitespace is not a reason — the refusal trims before it decides, '
    || 'which is what makes the table''s own CHECK and this sentence agree', t, '23514',
    '%must say why%');

  v := pg_temp.s11a_grant(s.op_a, 'support', repeat('x', 501), s.decider);
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('R04 a 501-character reason is refused with its own length in the sentence, '
    || 'because the limit is what keeps a console readable', t, '23514',
    '%must fit in 500 characters, got 501%');

  v := pg_temp.s11a_grant(s.ghost, 'support', 'Battery 1: a beneficiary who is nobody.', s.decider);
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('R05 granting to a uuid that is not an account is refused — authority '
    || 'attaches to a login, and a grant nobody can look up is a grant nobody can revoke', t, 'P0001',
    '%authority attaches to a login%');

  v := pg_temp.s11a_grant(s.op_a, 'support', 'Battery 1: a decision nobody made.', s.ghost);
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('R06 and naming a uuid that is not an account as the decider is refused too, '
    || 'which is the same rule the audit row''s own CHECK would enforce later', t, 'P0001',
    '%behind this grant%');

  v := pg_temp.s11a_grant(s.op_a, 'support', 'Battery 1: an expiry already past.', s.decider,
                          now() - interval '1 hour');
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('R07 an expiry in the past is refused rather than stored: a grant minted '
    || 'already dead is a typo that would otherwise sit in the table answering false forever', t, '23514',
    '%a grant minted already dead%');

  v := pg_temp.s11a_grant(s.op_a, 'support', 'Battery 1: an expiry exactly now.', s.decider, now());
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('R08 the boundary is strict: `<= now()` refuses, so a grant cannot be born '
    || 'already at its expiry instant', t, '23514', '%must be in the future%');

  v := pg_temp.s11a_revoke(s.op_a, 'qa', 'Battery 1: revoking a duty that does not exist.', s.decider);
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('R09 the revoking body has its own scope guard — one body drifting from the '
    || 'other is how a fifth duty arrives on only the revoke path', t, '23514',
    '%the four duties are support, operations, finance_review and privacy%');

  v := pg_temp.s11a_revoke(s.op_a, 'support', '  ', s.decider);
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('R10 a revocation with no reason is refused, and the sentence names who is '
    || 'entitled to read it: the person who loses the authority', t, '23514',
    '%the person who loses authority%');

  v := pg_temp.s11a_revoke(s.op_a, 'support', repeat('y', 600), s.decider);
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('R11 and the same bound applies on this side, with its own sentence',
    t, '23514', '%reason for a revocation must fit in 500 characters, got 600%');

  v := pg_temp.s11a_revoke(s.op_a, 'support', 'Battery 1: no human behind it.', s.ghost);
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('R12 a revocation naming no real decider is refused', t, 'P0001',
    '%who took authority away%');

  v := pg_temp.s11a_revoke(s.op_a, 'privacy', 'Battery 1: revoking what never existed.', s.decider);
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('R13 revoking a grant that was never made is refused with the sentence this '
    || 'file measures again at W14 — W14 proves the two cases cannot be told apart, which is the claim',
    t, 'P0001', '%no active privacy grant for account%to revoke%');

  PERFORM pg_temp.s11a_eq('R14 thirteen refusals through the only two writers, and the grant digest has not '
    || 'moved by one byte', pg_temp.s11a_gstate(), g0);
  PERFORM pg_temp.s11a_eq('R15 nor has the row count',
    (SELECT count(*) FROM private.operator_grants), n0);
  PERFORM pg_temp.s11a_eq('R16 and a refused write left no audit row behind either: the trail''s digest is '
    || 'exactly what it was before group R ran', pg_temp.s11a_adigest(), a0);
  PERFORM pg_temp.s11a_eq('R17 its count too', (SELECT count(*) FROM private.audit_events), c0);
END $r$;

-- ===========================================================================
-- 4. The success path: what a grant and a revocation actually write (W01–W15)
-- ===========================================================================
DO $w$
DECLARE s s11r%ROWTYPE; v jsonb; w jsonb; t text; i uuid; j uuid; m1 text; m2 text;
        r_own constant text := 'Battery 1: a synthetic support operator, for the qualification run only.';
        r_ops constant text := 'Battery 1: a second duty, granted to be revoked and re-granted.';
        n0 bigint;
BEGIN
  SELECT * INTO s FROM s11r;
  n0 := pg_temp.s11a_gcount();

  -- W09 has to run before W10 so that the "never had it" and "already revoked" refusals are measured on
  -- one (account, scope) pair and their sentences can be compared character for character.
  v := pg_temp.s11a_revoke(s.op_b, 'operations', 'Battery 1: before anything was granted.', s.decider);
  m1 := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('W09 revoking an account that never held the scope is refused',
    m1, 'P0001', '%no active operations grant for account%to revoke%');

  v := pg_temp.s11a_grant(s.op_a, 'support', r_own, s.decider);
  PERFORM pg_temp.s11a_keys('W01 the grant answer is a projection of seven named fields, not the row: a '
    || 'body that returned to_jsonb of the grant would start carrying whatever column the next migration '
    || 'adds', v,
    ARRAY['audit_id','expires_at','grant_id','granted_at','scope','status','user_id']);
  i := v ->> 'grant_id';

  w := (SELECT to_jsonb(g) FROM private.operator_grants g WHERE g.id = i);
  PERFORM pg_temp.s11a_ok('W02 the row exists, active, naming op_a as its beneficiary and decider as its '
    || 'granter, with the reason trimmed and no expiry chosen',
    (w ->> 'user_id')::uuid = s.op_a AND (w ->> 'scope') = 'support'
    AND (w ->> 'status') = 'active' AND (w ->> 'granted_by_user_id')::uuid = s.decider
    AND w ->> 'reason' = btrim(r_own) AND (w ->> 'expires_at') IS NULL
    AND (w ->> 'revoked_at') IS NULL);
  PERFORM pg_temp.s11a_eq('W02b and the id the body answered with is the row''s own id',
    i, (v ->> 'grant_id')::uuid);

  w := pg_temp.s11a_row('granted', i);
  PERFORM pg_temp.s11a_ok('W03 the granted audit row exists, keyed by the grant id, subject-typed as an '
    || 'operator grant, and names no wedding — an authority decision is not a property of a couple',
    w IS NOT NULL AND (w ->> 'subject_type') = 'operator_grant'
    AND (w ->> 'subject_key')::uuid = i AND (w ->> 'wedding_id') IS NULL);
  PERFORM pg_temp.s11a_eq('W04 the row names the human the console said was deciding, while its subject '
    || 'belongs to a different account — the two ids are different columns, which is the whole content of '
    || 'the attribution claim §4 makes',
    (w ->> 'actor_user_id')::uuid, s.decider);
  PERFORM pg_temp.s11a_eq('W04b and its kind is `maintenance`, the console''s kind: not a privilege, and '
    || 'not any scope an account can be granted', w ->> 'actor_kind', 'maintenance');
  PERFORM pg_temp.s11a_eq('W05 its reason is the grant''s reason, verbatim', w ->> 'reason', btrim(r_own));
  PERFORM pg_temp.s11a_keys('W06 a grant has no before-state — there was nothing before it — and its '
    || 'after-state is the five fields §4 names, built field by field rather than copied from the row',
    w -> 'after_state',
    ARRAY['expires_at','grant_id','granted_at','granted_by_user_id','status']);
  PERFORM pg_temp.s11a_ok('W06b before_state is present and empty on this row, not absent: a reader of the '
    || 'trail sees that there was nothing before, rather than wondering whether the body forgot to write it',
    jsonb_typeof(w -> 'before_state') = 'null' AND (w ->> 'before_state') IS NULL);
  PERFORM pg_temp.s11a_keys('W07 the payload carries the four fields a reader needs to reconstruct the '
    || 'decision without joining back to a row that may be cascaded away', w -> 'payload',
    ARRAY['expires_at','granted_user_id','scope','status']);
  PERFORM pg_temp.s11a_eq('W07b and the grant id inside after_state survives the grant row''s own deletion: '
    || 'the audit subject may legitimately vanish while the record of deciding must not',
    (w -> 'after_state' ->> 'grant_id')::uuid, i);

  v := pg_temp.s11a_grant(s.op_a, 'support',
        'Battery 1: a second live grant for the same duty.', s.decider);
  t := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('W08 a duplicate active grant is refused rather than absorbed, and the '
    || 'sentence names the live grant''s id — silently idempotent would report success for a request to '
    || 'extend an expiry', t, '23514', '%already holds an active support grant%revoke it first%');
  PERFORM pg_temp.s11a_eq('W08b and it refused without writing: still one active support row',
    (SELECT count(*)::int FROM private.operator_grants
      WHERE user_id = s.op_a AND scope = 'support' AND status = 'active'), 1);

  v := pg_temp.s11a_grant(s.op_b, 'operations', r_ops, s.decider, now() + interval '7 days');
  PERFORM pg_temp.s11a_eq('W10 a grant carrying a real expiry stores it, and the answer echoes it back',
    jsonb_typeof(v -> 'expires_at'), 'string');
  j := v ->> 'grant_id';

  v := pg_temp.s11a_revoke(s.op_b, 'operations',
        'Battery 1: the duty is withdrawn again before it is used.', s.decider);
  PERFORM pg_temp.s11a_keys('W11 the revocation answer is six named fields, with revoked_at where the '
    || 'grant answer had granted_at', v,
    ARRAY['audit_id','grant_id','revoked_at','scope','status','user_id']);
  PERFORM pg_temp.s11a_eq('W11b it names the same grant id it changed', (v ->> 'grant_id')::uuid, j);

  w := (SELECT to_jsonb(g) FROM private.operator_grants g WHERE g.id = j);
  PERFORM pg_temp.s11a_ok('W12 a revocation is a status write on the same row and not a delete of it: the '
    || 'row still exists, now revoked, with its instant set',
    (w ->> 'status') = 'revoked' AND (w -> 'revoked_at') IS NOT NULL
    AND (w ->> 'user_id')::uuid = s.op_b AND (w ->> 'granted_at') IS NOT NULL);
  PERFORM pg_temp.s11a_eq('W12b and the table has not shrunk: two grants were made, one row per decision',
    (SELECT count(*) FROM private.operator_grants), n0 + 2);

  w := pg_temp.s11a_row('revoked', j);
  PERFORM pg_temp.s11a_keys('W13 the revoked row carries both halves: which expiry and which granter were '
    || 'live before, and what status and instant replaced them. This is the first real use of the two '
    || 'columns slice 1 adds, and an incident review''s question — what was true before this was decided — '
    || 'is answerable from the trail alone',
    w -> 'before_state', ARRAY['expires_at','granted_at','granted_by_user_id','status']);
  PERFORM pg_temp.s11a_keys('W13b and after_state is the two fields that changed', w -> 'after_state',
    ARRAY['revoked_at','status']);

  v := pg_temp.s11a_revoke(s.op_b, 'operations', 'Battery 1: revoking it a second time.', s.decider);
  m2 := coalesce(v ->> '_error', 'ACCEPTED');
  PERFORM pg_temp.s11a_err_is('W14 revoking an already-revoked grant is refused', m2, 'P0001',
    '%no active operations grant for account%to revoke%');
  PERFORM pg_temp.s11a_eq('W14b and the sentence is character-for-character the one W09 answered with for '
    || 'an account that never held the scope: whether an account ever had a grant is not information a '
    || 'caller is entitled to', m2, m1);

  v := pg_temp.s11a_grant(s.op_b, 'operations',
        'Battery 1: the same duty, granted again as a new decision.', s.decider);
  PERFORM pg_temp.s11a_eq('W15 a re-grant after a revocation is legal and is a NEW row: the history '
    || 'granted / revoked / granted-again is the thing an operator review needs, which is why the '
    || 'revocation could not have been an UPDATE in place',
    (SELECT count(*)::int FROM private.operator_grants
      WHERE user_id = s.op_b AND scope = 'operations'), 2);
  PERFORM pg_temp.s11a_ok('W15b the old revoked row is untouched beside it, and the new row''s id differs',
    (SELECT count(*)::int FROM private.operator_grants
      WHERE user_id = s.op_b AND scope = 'operations' AND status = 'revoked') = 1
    AND (v ->> 'grant_id')::uuid IS DISTINCT FROM j);
END $w$;

-- ===========================================================================
-- 5. The predicate's truth table, over the states W produced (T01–T11)
-- ===========================================================================
DO $t$
DECLARE s s11r%ROWTYPE; b boolean; x uuid; n0 bigint; g0 text;
BEGIN
  SELECT * INTO s FROM s11r;
  n0 := pg_temp.s11a_gcount();
  g0 := pg_temp.s11a_gstate();

  -- The three "nobody here" cases, which is what the console's own door looks like: no session at all, an
  -- account with nothing granted, and a uuid that is not an account. All three answer false rather than
  -- raising, and that is the property that lets a definer wrapper call it mid-authorisation.
  b := pg_temp.s11a_is(NULL, 'support');
  PERFORM pg_temp.s11a_eq('T01 with no session at all the predicate answers false, so granting authority '
    || 'cannot itself require authority (and the psql path is this case)', b, false);

  b := pg_temp.s11a_is(s.plain, 'support');
  PERFORM pg_temp.s11a_eq('T02 a signed-in host who holds nothing answers false for the scope the file has '
    || 'granted to somebody else', b, false);

  b := pg_temp.s11a_is(s.ghost, 'support');
  PERFORM pg_temp.s11a_eq('T03 a uuid that is not an account answers false rather than raising: the '
    || 'predicate never has to know whether an identity exists', b, false);

  b := pg_temp.s11a_is(s.op_a, 'qa');
  PERFORM pg_temp.s11a_eq('T04 an unknown duty word answers false and does NOT raise, even for an account '
    || 'that genuinely holds a grant — a refusal here would leak the accepted vocabulary to a caller that '
    || 'is mid-authorisation', b, false);

  b := pg_temp.s11a_is(s.op_a, NULL);
  PERFORM pg_temp.s11a_eq('T05 a NULL scope answers false on the same branch', b, false);

  b := pg_temp.s11a_is(s.op_a, 'support');
  PERFORM pg_temp.s11a_eq('T06 the grant W01 wrote is visible to the predicate, read from the session uid '
    || 'rather than from an argument — there is no argument that could have asked about another account',
    b, true);

  b := pg_temp.s11a_is(s.op_a, 'operations');
  PERFORM pg_temp.s11a_eq('T07 the same account answers false for a scope it was never given: scopes are '
    || 'not a ladder, and a support operator does not become an operator at large', b, false);

  b := pg_temp.s11a_is(s.op_a, 'finance_review');
  PERFORM pg_temp.s11a_eq('T08 nor does it answer true for a third scope nobody in this file has used',
    b, false);

  b := pg_temp.s11a_is(s.op_b, 'operations');
  PERFORM pg_temp.s11a_eq('T09 the re-granted row W15 wrote answers true again, which is the other half of '
    || 'making a revocation a status write: authority comes back by a new decision, not by an edit',
    b, true);

  b := pg_temp.s11a_is(s.decider, 'support');
  PERFORM pg_temp.s11a_eq('T10 the human who minted every grant in this file holds nothing themselves. '
    || 'Attribution grants no authority — which is what makes §3''s decision not to refuse a self-grant a '
    || 'reporting choice rather than a privilege escalation', b, false);

  -- The expiry is the one state the bodies will not produce (R07 refuses a past expiry) and the predicate
  -- must still answer correctly for, so it is planted by hand and removed again.
  INSERT INTO private.operator_grants (user_id, scope, status, reason, granted_by_user_id,
                                       granted_at, expires_at)
    VALUES (s.op_a, 'privacy', 'active',
            'Battery 1 plant: a grant whose window has already closed.', s.decider,
            now() - interval '2 days', now() - interval '1 day')
  RETURNING id INTO x;

  b := pg_temp.s11a_is(s.op_a, 'privacy');
  PERFORM pg_temp.s11a_eq('T11 a live-status row whose expiry has passed answers false: the status column '
    || 'is not the whole rule, and `status = ''active''` alone would be a door left open by an expiry that '
    || 'nobody honoured', b, false);

  DELETE FROM private.operator_grants WHERE id = x;
  PERFORM pg_temp.s11a_eq('T11b the plant is gone and the table is exactly what it was before it: the '
    || 'digest, not an adjective', pg_temp.s11a_gstate(), g0);
  PERFORM pg_temp.s11a_eq('T11c and the row count is back to the three the success path left',
    (SELECT count(*) FROM private.operator_grants), n0);
END $t$;

-- ===========================================================================
-- 6. The grant row's own rules, reachable only by a hand plant (K01–K08)
-- ===========================================================================
DO $k$
DECLARE s s11r%ROWTYPE; v text; g0 text; n0 bigint;
        ins constant text := 'INSERT INTO private.operator_grants '
          || '(user_id, scope, status, reason, granted_by_user_id, granted_at, expires_at, revoked_at) VALUES (';
BEGIN
  SELECT * INTO s FROM s11r;
  g0 := pg_temp.s11a_gstate();
  n0 := pg_temp.s11a_gcount();

  -- The bodies refuse all of these shapes earlier (group R), and a caller that bypasses them — a hand at
  -- the console, a body written next slice — meets the table instead. Each plant is expected to be refused,
  -- so nothing here needs undoing; K08 proves that by digest.
  v := pg_temp.s11a_try_write('postgres', NULL, ins
    || quote_literal(s.op_a::text) || ', ' || quote_literal('support') || ', '
    || quote_literal('revoked') || ', ' || quote_literal('plant: revoked with no instant') || ', '
    || quote_literal(s.decider::text) || ', now(), NULL, NULL)');
  PERFORM pg_temp.s11a_err_is('K01 a status of revoked with no revoked_at is refused by the pair CHECK, by '
    || 'name — the naming matters because the next reader has to find which rule fired', v, '23514',
    '%operator_grants_revoked_pair_check%');

  v := pg_temp.s11a_try_write('postgres', NULL, ins
    || quote_literal(s.op_a::text) || ', ' || quote_literal('privacy') || ', '
    || quote_literal('active') || ', ' || quote_literal('plant: active carrying an instant') || ', '
    || quote_literal(s.decider::text) || ', now(), NULL, now())');
  PERFORM pg_temp.s11a_err_is('K02 and the other direction is refused by the same rule: the pair binds both '
    || 'ways, so a writer cannot lie with one half of it', v, '23514',
    '%operator_grants_revoked_pair_check%');

  v := pg_temp.s11a_try_write('postgres', NULL, ins
    || quote_literal(s.op_a::text) || ', ' || quote_literal('privacy') || ', '
    || quote_literal('active') || ', ' || quote_literal('plant: expiry before grant') || ', '
    || quote_literal(s.decider::text) || ', now(), now() - interval ''1 hour'', NULL)');
  PERFORM pg_temp.s11a_err_is('K03 an expiry that does not follow its own grant is refused — the body '
    || 'checks "future", the table checks "after granted_at", and only the second of those is true for a '
    || 'back-dated grant', v, '23514', '%operator_grants_expiry_after_grant_check%');

  v := pg_temp.s11a_try_write('postgres', NULL, ins
    || quote_literal(s.op_a::text) || ', ' || quote_literal('privacy') || ', '
    || quote_literal('revoked') || ', ' || quote_literal('plant: revoked before granted') || ', '
    || quote_literal(s.decider::text) || ', now(), NULL, now() - interval ''1 hour'')');
  PERFORM pg_temp.s11a_err_is('K04 a revocation that precedes its grant is refused: a history that reads '
    || 'backwards is not a history', v, '23514', '%operator_grants_revoke_after_grant_check%');

  v := pg_temp.s11a_try_write('postgres', NULL, ins
    || quote_literal(s.op_a::text) || ', ' || quote_literal('superuser') || ', '
    || quote_literal('active') || ', ' || quote_literal('plant: a fifth duty') || ', '
    || quote_literal(s.decider::text) || ', now(), NULL, NULL)');
  PERFORM pg_temp.s11a_err_is('K05 the duty vocabulary is a table rule as well as a body rule, and the '
    || 'inline CHECK''s generated name is what a reviewer has to be able to grep', v, '23514',
    '%operator_grants_scope_check%');

  v := pg_temp.s11a_try_write('postgres', NULL, ins
    || quote_literal(s.op_a::text) || ', ' || quote_literal('support') || ', '
    || quote_literal('retired') || ', ' || quote_literal('plant: a status nobody knows') || ', '
    || quote_literal(s.decider::text) || ', now(), NULL, NULL)');
  PERFORM pg_temp.s11a_err_is('K06 and so is the status vocabulary: a third status would be a credential '
    || 'whose meaning no reader was told', v, '23514', '%operator_grants_status_check%');

  v := pg_temp.s11a_try_write('postgres', NULL, ins
    || quote_literal(s.op_a::text) || ', ' || quote_literal('support') || ', '
    || quote_literal('active') || ', ' || quote_literal('   ') || ', '
    || quote_literal(s.decider::text) || ', now(), NULL, NULL)');
  PERFORM pg_temp.s11a_err_is('K07 a blank reason is refused by the row itself, which is the rule that '
    || 'survives even if a future body forgets to check', v, '23514', '%operator_grants_reason_check%');

  -- Two consoles, one intent. The body's duplicate refusal (W08) is the friendly sentence; this index is
  -- the thing that is true when both consoles are mid-transaction, and it is the only half a single-process
  -- battery can measure.
  v := pg_temp.s11a_try_write('postgres', NULL, ins
    || quote_literal(s.op_a::text) || ', ' || quote_literal('support') || ', '
    || quote_literal('active') || ', ' || quote_literal('plant: a second live grant by hand') || ', '
    || quote_literal(s.decider::text) || ', now(), NULL, NULL)');
  PERFORM pg_temp.s11a_err_is('K08 a hand-written second live grant for one account and one duty collides '
    || 'with the partial unique index, which is what makes W08''s promise hold under concurrency',
    v, '23505', '%operator_grants_active_uniq%');

  PERFORM pg_temp.s11a_eq('K09 eight plants attempted, eight refused: the digest is what it was',
    pg_temp.s11a_gstate(), g0);
  PERFORM pg_temp.s11a_eq('K09b and the count is the three the success path left',
    (SELECT count(*) FROM private.operator_grants), n0);
END $k$;

-- ===========================================================================
-- 7. The one trail (AI01–AI24)
-- ===========================================================================
DO $ai$
DECLARE s s11r%ROWTYPE; a0 text; c0 bigint; w jsonb; w2 jsonb; w3 jsonb; x uuid; v text;
        k1 constant text := 's11a-replay-key-1';
        r_own constant text := 'Battery 1: a synthetic support operator, for the qualification run only.';
BEGIN
  SELECT * INTO s FROM s11r;
  a0 := pg_temp.s11a_adigest();
  c0 := pg_temp.s11a_acount();

  PERFORM pg_temp.s11a_ok('AI01 every audit row this file''s bodies wrote names a human as its actor, '
    || 'states a reason, and is typed as an operator grant — the three-column shape §4 promises, measured '
    || 'on the rows the product path produced rather than on a plant',
    (SELECT count(*) FROM private.audit_events WHERE subject_type = 'operator_grant') = 4
    AND NOT EXISTS (SELECT 1 FROM private.audit_events WHERE subject_type = 'operator_grant'
                      AND (actor_user_id IS NULL OR btrim(reason) = ''
                           OR actor_kind <> 'maintenance' OR wedding_id IS NOT NULL)));

  -- The absolute refusal, in three layers, each answered with the words that layer actually produces.
  PERFORM pg_temp.s11a_ok('AI02 the whole privilege matrix rather than the one role A08 names: no client '
    || 'role holds the two powers this migration took away (UPDATE, DELETE) — at the table level or the '
    || 'column level — and none holds REFERENCES or TRIGGER either. A column grant is invisible to the '
    || 'table probe, so both levels are asked, and the column-level SELECT/INSERT that service_role does '
    || 'report is the same grant A08 already counts rather than a second one',
    NOT EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) r(rol)
      CROSS JOIN LATERAL unnest(ARRAY['UPDATE','DELETE','REFERENCES','TRIGGER']) c(cmd)
     WHERE has_table_privilege(r.rol, 'private.audit_events', c.cmd))
    AND NOT EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) r(rol)
      CROSS JOIN LATERAL unnest(ARRAY['UPDATE','REFERENCES']) c(cmd)
     WHERE has_column_privilege(r.rol, 'private.audit_events', 'reason', c.cmd))
    AND NOT EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated')) r(rol)
      CROSS JOIN LATERAL unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','REFERENCES','TRIGGER']) c(cmd)
     WHERE has_table_privilege(r.rol, 'private.audit_events', c.cmd))
    AND NOT EXISTS (SELECT 1 FROM (VALUES ('anon'),('authenticated')) r(rol)
      CROSS JOIN LATERAL unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) c(cmd)
     WHERE has_column_privilege(r.rol, 'private.audit_events', 'reason', c.cmd)));

  x := (SELECT subject_key FROM private.audit_events WHERE action = 'granted' LIMIT 1);
  w := pg_temp.s11a_row('granted', x);

  v := pg_temp.s11a_try_write('postgres', NULL,
    'UPDATE private.audit_events SET reason = ' || quote_literal('rewritten by the owner')
    || ' WHERE subject_key = ' || quote_literal(x::text) || ' AND action = '
    || quote_literal('granted'));
  PERFORM pg_temp.s11a_err_is('AI03 the owner itself is refused on UPDATE, and hears the absolute guard''s '
    || 'sentence rather than the client guard''s: two BEFORE UPDATE triggers exist and this names which one '
    || 'a trusted role actually meets', v, '42501',
    '%a correction is a new row and an audit event, never a rewrite%');

  v := pg_temp.s11a_try_write('postgres', NULL,
    'UPDATE private.audit_events SET action = ' || quote_literal('never_happened')
    || ' WHERE subject_key = ' || quote_literal(x::text) || ' AND action = '
    || quote_literal('granted'));
  PERFORM pg_temp.s11a_err_is('AI04 a second column meets the same refusal, so the guard is on the row and '
    || 'not on one column''s name', v, '42501', '%append-only%never a rewrite%');

  v := pg_temp.s11a_try_write('service_role', NULL,
    'UPDATE private.audit_events SET reason = ' || quote_literal('rewritten by the server key')
    || ' WHERE subject_key = ' || quote_literal(x::text) || ' AND action = '
    || quote_literal('granted'));
  PERFORM pg_temp.s11a_err_is('AI05 the server key never reaches the trigger at all: the revocation refuses '
    || 'it earlier, which is why the revocation is the load-bearing half and the trigger is what stops the '
    || 'owner being the exception', v, '42501', '%permission denied for table audit_events%');

  v := pg_temp.s11a_try_write('authenticated', s.plain::text,
    'UPDATE private.audit_events SET reason = ' || quote_literal('rewritten by a host')
    || ' WHERE subject_key = ' || quote_literal(x::text) || ' AND action = '
    || quote_literal('granted'));
  PERFORM pg_temp.s11a_err_is('AI06 a signed-in host is refused at the schema layer', v, '42501',
    '%permission denied for schema private%');

  v := pg_temp.s11a_try_write('service_role', NULL,
    'DELETE FROM private.audit_events WHERE subject_key = ' || quote_literal(x::text));
  PERFORM pg_temp.s11a_err_is('AI07 the server key cannot remove a row either — a leaked key can no longer '
    || 'make a decision look like it never happened', v, '42501',
    '%permission denied for table audit_events%');

  v := pg_temp.s11a_try_write('authenticated', s.plain::text,
    'DELETE FROM private.audit_events WHERE subject_key = ' || quote_literal(x::text));
  PERFORM pg_temp.s11a_err_is('AI08 and a host cannot: the hostile-role half of the trail claim', v,
    '42501', '%permission denied for schema private%');

  PERFORM pg_temp.s11a_eq('AI09 six refused mutations later the whole trail digests identically — every '
    || 'column of every row, not a count', pg_temp.s11a_adigest(), a0);
  w2 := pg_temp.s11a_row('granted', x);
  PERFORM pg_temp.s11a_eq('AI10 and the row the attempts aimed at re-reads byte-identical, which is the '
    || 'half AI09 cannot show on its own: a guard that rewrote a column and refused the rest would still '
    || 'leave a matching digest if the digest omitted that column', w2, w);

  -- The seventh refusal, and the only one that tests the hole in the guard rather than its wall. The guard
  -- lets `actor_user_id` move to NULL, because that is the signature of the referential action an account
  -- deletion performs — so the question is who else can produce that signature. This caller can: a `postgres`
  -- UPDATE that nulls the attribution is the forgery the column exists to prevent, dressed as the one shape
  -- the hole admits. It is refused because the hole is not "a link that becomes NULL" but "a link the
  -- database is nulling from inside its own trigger", which is a trigger depth a statement caller cannot
  -- reach. The accepting half — the deletion whose row survives with a NULL — is group T of
  -- `85_support_lifecycle.sql`, cells T-RI1/T-RI2.
  v := pg_temp.s11a_try_write('postgres', NULL,
    'UPDATE private.audit_events SET actor_user_id = NULL'
    || ' WHERE subject_key = ' || quote_literal(x::text) || ' AND action = '
    || quote_literal('granted'));
  PERFORM pg_temp.s11a_err_is('AI10b the owner cannot null the attribution by hand: the guard''s one hole is '
    || 'a trigger depth, not a value, so this arrives at depth 1 and hears the same sentence as AI03',
    v, '42501', '%a correction is a new row and an audit event, never a rewrite%');
  w3 := pg_temp.s11a_row('granted', x);
  PERFORM pg_temp.s11a_eq('AI10c and the row still names the human who decided — a guard that raised after '
    || 'nulling the column would be the forgery with an error message appended', w3, w);

  -- The residue, as a cell rather than a comment. Stating it here is the point: §4's promise is narrower
  -- than "a leaked key cannot touch the trail", and the measurement of the narrow version is what makes
  -- the sentence honest.
  v := pg_temp.s11a_try_write('service_role', NULL,
    'INSERT INTO private.audit_events (subject_type, subject_key, action, actor_kind, reason, '
    || 'actor_user_id) VALUES (' || quote_literal('operator_grant') || ', '
    || quote_literal(s.ghost::text) || ', ' || quote_literal('granted') || ', '
    || quote_literal('maintenance') || ', ' || quote_literal('a row that never happened') || ', '
    || quote_literal(s.decider::text) || ')');
  PERFORM pg_temp.s11a_accept('AI11 the limit of this file: a leaked server key may still APPEND a row that '
    || 'never happened. UPDATE and DELETE are gone; forgery-by-addition is not, and closing it needs an '
    || 'anchor this stage does not build — §4 states it and this cell measures it', v);
  PERFORM pg_temp.s11a_eq('AI11b the forged row exists, which is the finding, and it is the only row in the '
    || 'trail keyed to an account that does not exist',
    (SELECT count(*)::int FROM private.audit_events
      WHERE actor_user_id = s.decider AND reason = 'a row that never happened'), 1);

  v := pg_temp.s11a_try_write('postgres', NULL,
    'DELETE FROM private.audit_events WHERE reason = ' || quote_literal('a row that never happened'));
  PERFORM pg_temp.s11a_accept('AI12 the trusted roles can still prune, and that is the only removal path '
    || 'there is — the boundary Stage 13''s retention decision sits on, stated rather than discovered '
    || 'later', v);
  PERFORM pg_temp.s11a_eq('AI12b and it is gone: the trail is back to its baseline count',
    (SELECT count(*) FROM private.audit_events), c0);

  -- The replay defence, which is what makes a retried operator action one record rather than two. The
  -- first delivery is planted directly because the index — not a body's check — is the thing measured.
  INSERT INTO private.audit_events (subject_type, action, actor_kind, reason, actor_user_id,
                                    idempotency_key)
    VALUES ('operator_grant', 'granted', 'maintenance', 'plant: a replayed action.', s.decider, k1);
  v := pg_temp.s11a_try_write('postgres', NULL,
    'INSERT INTO private.audit_events (subject_type, action, actor_kind, reason, actor_user_id, '
    || 'idempotency_key) VALUES (' || quote_literal('operator_grant') || ', '
    || quote_literal('granted') || ', ' || quote_literal('maintenance') || ', '
    || quote_literal('plant: the same action delivered twice') || ', '
    || quote_literal(s.decider::text) || ', ' || quote_literal(k1) || ')');
  PERFORM pg_temp.s11a_err_is('AI13 a second delivery of one operator action collides with the partial '
    || 'unique index and names it, which is the shape §4''s replay defence has to take — a body cannot '
    || 'promise uniqueness by checking first', v, '23505',
    '%audit_events_one_row_per_idempotency_key%');

  INSERT INTO private.audit_events (subject_type, action, actor_kind, payload)
    VALUES ('s11a_plant', 'plant_one', 'system', '{}'::jsonb);
  INSERT INTO private.audit_events (subject_type, action, actor_kind, payload)
    VALUES ('s11a_plant', 'plant_two', 'system', '{}'::jsonb);
  PERFORM pg_temp.s11a_eq('AI14 two keyless rows coexist, which is the other half of AI13: the ordinary '
    || 'machine row — all 29 of the existing audit sites — keeps its NULL and stays unconstrained',
    (SELECT count(*)::int FROM private.audit_events
      WHERE subject_type = 's11a_plant'), 2);

  DELETE FROM private.audit_events WHERE idempotency_key = k1;
  DELETE FROM private.audit_events WHERE subject_type = 's11a_plant';

  -- The rules this file adds to the trail, each reached by a plant because no body produces these shapes.
  -- Six are CHECKs and the seventh (AI16) is a BEFORE INSERT guard that keeps a CHECK's SQLSTATE; the split
  -- is measured, not preferred, and `85_support_lifecycle.sql` group T is the half that proves why.
  -- Names are asserted because a reviewer of a refusal has to be able to find the rule.
  v := pg_temp.s11a_try_write('postgres', NULL,
    'INSERT INTO private.audit_events (subject_type, action, actor_kind, reason, actor_user_id) VALUES ('
    || quote_literal('s11a_plant') || ', ' || quote_literal('planted') || ', '
    || quote_literal('operator') || ', NULL, ' || quote_literal(s.decider::text) || ')');
  PERFORM pg_temp.s11a_err_is('AI15 a human-kind row with no reason is refused: the pairing that makes the '
    || 'column worth reading', v, '23514', '%audit_events_human_action_has_reason_check%');

  v := pg_temp.s11a_try_write('postgres', NULL,
    'INSERT INTO private.audit_events (subject_type, action, actor_kind, reason, actor_user_id) VALUES ('
    || quote_literal('s11a_plant') || ', ' || quote_literal('planted') || ', '
    || quote_literal('operator') || ', ' || quote_literal('plant: nobody decided') || ', NULL)');
  PERFORM pg_temp.s11a_err_is('AI16 and a human-kind row that names no human is refused by the guard that '
    || 'replaced the CHECK — same SQLSTATE, same refusal, and a rule that no longer fires on the UPDATE an '
    || 'account deletion performs; the sentence in R06 is the friendly version of this rule', v, '23514',
    '%must name the account that acted%');

  v := pg_temp.s11a_try_write('postgres', NULL,
    'INSERT INTO private.audit_events (subject_type, action, actor_kind, reason, actor_user_id) VALUES ('
    || quote_literal('s11a_plant') || ', ' || quote_literal('planted') || ', '
    || quote_literal('superuser') || ', ' || quote_literal('plant: a fifth kind') || ', '
    || quote_literal(s.decider::text) || ')');
  PERFORM pg_temp.s11a_err_is('AI17 a fifth actor kind is refused: four values, and `maintenance` is the '
    || 'one this stage added because a sessionless console act is neither a system process nor a host',
    v, '23514', '%audit_events_actor_kind_vocab_check%');

  v := pg_temp.s11a_try_write('postgres', NULL,
    'INSERT INTO private.audit_events (subject_type, action, actor_kind, reason) VALUES ('
    || quote_literal('s11a_plant') || ', ' || quote_literal('planted') || ', '
    || quote_literal('system') || ', ' || quote_literal('   ') || ')');
  PERFORM pg_temp.s11a_err_is('AI18 a blank reason is refused even on a machine row, so boundedness is not '
    || 'only a rule about humans', v, '23514', '%audit_events_reason_is_bounded_check%');

  v := pg_temp.s11a_try_write('postgres', NULL,
    'INSERT INTO private.audit_events (subject_type, action, actor_kind, before_state) VALUES ('
    || quote_literal('s11a_plant') || ', ' || quote_literal('planted') || ', '
    || quote_literal('system') || ', ' || quote_literal('[1,2,3]') || '::jsonb)');
  PERFORM pg_temp.s11a_err_is('AI19 a state that is a list of rows is refused: the projection is an object '
    || 'or nothing, which is what keeps a column the next migration adds from arriving as a payload',
    v, '23514', '%audit_events_before_state_is_object_check%');

  v := pg_temp.s11a_try_write('postgres', NULL,
    'INSERT INTO private.audit_events (subject_type, action, actor_kind, after_state) VALUES ('
    || quote_literal('s11a_plant') || ', ' || quote_literal('planted') || ', '
    || quote_literal('system') || ', ' || quote_literal('"just a string"') || '::jsonb)');
  PERFORM pg_temp.s11a_err_is('AI20 and a scalar is refused on the other side too', v, '23514',
    '%audit_events_after_state_is_object_check%');

  v := pg_temp.s11a_try_write('postgres', NULL,
    'INSERT INTO private.audit_events (subject_type, action, actor_kind, idempotency_key) VALUES ('
    || quote_literal('s11a_plant') || ', ' || quote_literal('planted') || ', '
    || quote_literal('system') || ', ' || quote_literal(repeat('k', 201)) || ')');
  PERFORM pg_temp.s11a_err_is('AI21 an over-long idempotency key is refused with its own bound: the key is '
    || 'a client-supplied string in a row that is read by a human', v, '23514',
    '%audit_events_idempotency_key_is_bounded_check%');

  -- The vocabulary in the other direction: all four values must be reachable, or the trail cannot describe
  -- the four kinds of actor that exist.
  INSERT INTO private.audit_events (subject_type, action, actor_kind, reason, actor_user_id)
    VALUES ('s11a_vocab', 'planted', 'system', NULL, NULL);
  INSERT INTO private.audit_events (subject_type, action, actor_kind, reason, actor_user_id)
    VALUES ('s11a_vocab', 'planted', 'operator', 'plant: an operator row.', s.decider);
  INSERT INTO private.audit_events (subject_type, action, actor_kind, reason, actor_user_id)
    VALUES ('s11a_vocab', 'planted', 'host', 'plant: a host row.', s.plain);
  INSERT INTO private.audit_events (subject_type, action, actor_kind, reason, actor_user_id)
    VALUES ('s11a_vocab', 'planted', 'maintenance', 'plant: a console row.', s.decider);
  PERFORM pg_temp.s11a_eq('AI22 all four kinds are writable, including the machine row that sets neither a '
    || 'reason nor an actor — which is the shape every existing Stage 10 audit site still has',
    (SELECT count(*)::int FROM private.audit_events WHERE subject_type = 's11a_vocab'), 4);

  DELETE FROM private.audit_events WHERE subject_type = 's11a_vocab';

  PERFORM pg_temp.s11a_eq('AI23 every plant in this group is removed again, and the trail digests exactly '
    || 'as it did before the group ran — which is what makes the residue cell above evidence rather than '
    || 'damage', pg_temp.s11a_adigest(), a0);
  PERFORM pg_temp.s11a_eq('AI23b and the count is back to its baseline',
    (SELECT count(*) FROM private.audit_events), c0);

  PERFORM pg_temp.s11a_ok('AI24 the four rows that remain are the ones the bodies wrote, and nothing in '
    || 'this file was inserted into the trail by hand',
    (SELECT count(*) FROM private.audit_events WHERE subject_type = 'operator_grant')
    = (SELECT count(*) FROM private.audit_events));
END $ai$;

-- ===========================================================================
-- 8. The census this file leaves behind (Z01–Z09)
-- ===========================================================================
DO $print$
DECLARE n int;
BEGIN
  RAISE NOTICE 'CENSUS Z01 grants by scope+status: %',
    array_to_string(ARRAY(SELECT scope || '/' || status || '=' || count(*)::text
      FROM private.operator_grants GROUP BY scope, status
      ORDER BY scope, status COLLATE "C"), ', ');
  PERFORM pg_temp.s11a_eq('Z02 the ledger this file leaves is three grant rows: two live and one revoked',
    (SELECT count(*)::int FROM private.operator_grants), 3);
  PERFORM pg_temp.s11a_eq('Z03 of which exactly two are active, and no account holds two active rows for '
    || 'one duty',
    (SELECT count(*)::int FROM private.operator_grants WHERE status = 'active'), 2);
  PERFORM pg_temp.s11a_eq('Z04 no (account, duty) pair anywhere in the table has more than one live grant',
    (SELECT count(*)::int FROM (SELECT user_id, scope FROM private.operator_grants
                                WHERE status = 'active' GROUP BY user_id, scope
                                HAVING count(*) > 1) d), 0);
  PERFORM pg_temp.s11a_eq('Z05 the trail holds exactly the four rows the two bodies wrote: three grants and '
    || 'one revocation',
    (SELECT count(*)::int FROM private.audit_events
      WHERE subject_type = 'operator_grant'), 4);
  PERFORM pg_temp.s11a_eq('Z06 and nothing else is in it: no plant from group AI survived this file',
    (SELECT count(*)::int FROM private.audit_events), 4);
  -- Re-counted at the end rather than only at the start: this file defines twenty-odd helper callables of
  -- its own, all in `pg_temp`, and the claim a reader needs is that none of them reached a published
  -- namespace. `'pg_temp'::regnamespace` cannot express that — the alias resolves only through the search
  -- path, and the cast raises — so each namespace is named directly instead.
  PERFORM pg_temp.s11a_eq('Z07 the declared api surface is still the 36 names this file found at A06a, '
    || 'measured after every group has run',
    (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'api'::regnamespace), 36);
  PERFORM pg_temp.s11a_eq('Z07b and internal_api is still 55: a battery that leaked a helper into a '
    || 'privileged namespace would move this number and nothing else here would notice',
    (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'internal_api'::regnamespace), 55);

  -- The floor counts this cell too, so the number it compares against is the number the file prints and
  -- not one less than it: a floor a reader has to adjust mentally is a floor that gets mis-set at its next
  -- re-pin. A floor, not an equality — a future cell added to any group moves the printed total upward and
  -- must not move this one downward. /* FLOOR-RE-PIN */
  PERFORM pg_temp.s11a_add(1);
  n := coalesce(nullif(current_setting('s11a.passed', true), ''), '0')::int;
  IF n < 134 THEN
    RAISE EXCEPTION 'FAIL Z08 the authority battery ran % assertions, which is fewer than the floor', n;
  END IF;
  RAISE NOTICE 'PASS Z08 the authority battery ran at least its floor of assertions (%)', n;
END $print$;

SELECT 'STAGE11 AUTHORITY TESTS PASSED ('
    || coalesce(nullif(current_setting('s11a.passed', true), ''), '0') || ')';
