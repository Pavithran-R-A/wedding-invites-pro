-- Stage 2 migration-outcome suite, CLEAN mode: the chain applied to a database with
-- no historical rows must produce an empty canonical domain — not a seeded one.
--
-- Run on a database built as: bootstrap + published migrations + the Stage 2 chain,
-- with `10_seed_legacy.sql` deliberately skipped, and before `20_attacks.sql` (whose
-- seed commits, because psql's --single-transaction commits when a file succeeds).
--
-- Why bother with this direction at all: the legacy-mode suite proves the mapping
-- carries real rows across correctly. It cannot prove the mapping *only* carries rows
-- across. A migration that inserts a starter template, a demo tradition pack, a
-- courtesy entitlement or a convenience admin role is invisible while the source
-- tables already hold data, and it is exactly the failure the brief warns about for a
-- pre-launch product with no real customers: content that looks shipped because a
-- script wrote it (phases 37-39, 80).
--
-- The inventory check comes first and is deliberately rigid — a Stage 2 table nobody
-- declared here fails the suite. Row counts are then taken from that same declared
-- list, so a new canonical table cannot arrive unasserted.
--
-- Empty is not the same as missing, so the last group checks the structure is still
-- there: an app reading `weddings` on a fresh database must get an empty result set,
-- not a 42P01, and must still be refused by RLS.
--
-- Run as superuser.

SET client_min_messages = notice;

CREATE FUNCTION pg_temp.st2_ok(what text, ok boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL %', what;
  END IF;
  PERFORM set_config('st2.passed',
                     ((coalesce(current_setting('st2.passed', true), '0'))::int + 1)::text,
                     false);
  RAISE NOTICE 'PASS %', what;
END $$;

CREATE FUNCTION pg_temp.st2_set(what text, got text[], want text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM want THEN
    PERFORM pg_temp.st2_ok(what, true);
    RETURN;
  END IF;
  RAISE EXCEPTION 'FAIL % — got [%] want [%]', what,
    array_to_string(coalesce(got, ARRAY[]::text[]), ', '),
    array_to_string(coalesce(want, ARRAY[]::text[]), ', ');
END $$;

CREATE FUNCTION pg_temp.st2_count(what text, rel text, want bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE got bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM ' || rel INTO got;
  IF got = want THEN
    PERFORM pg_temp.st2_ok(what || ' = ' || want, true);
    RETURN;
  END IF;
  RAISE EXCEPTION 'FAIL % — found % rows, expected %', what, got, want;
END $$;

-- Run a statement as an impersonated role and report only its SQLSTATE. The role is
-- reset on every path, because a probe that leaked `SET ROLE` into the session would
-- silently change every check that follows it. '00000' means it succeeded.
CREATE FUNCTION pg_temp.st2_state(stmt text, as_role text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE code text := '00000';
BEGIN
  EXECUTE 'SET ROLE ' || quote_ident(as_role);
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    code := SQLSTATE;
  END;
  RESET ROLE;
  RETURN code;
END $$;

-- Which head this file is being read at. Same idiom as `40_catalog.sql`, and it is here for the same
-- reason: E01 and E02 compare against a *declared* inventory, so a stage that adds a canonical table
-- has to say so without changing what the older chains are expected to contain. Unset means the
-- pre-Stage-5 runners, which keep their own numbers.
CREATE FUNCTION pg_temp.st2_head() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(current_setting('app.stage_head', true), 'stage4') $fn$;

-- Ordinal, not equality, because heads are cumulative: a check keyed on `= 'stage9'` would hand the
-- Stage 9 chain the pre-Stage-9 expectation the moment a Stage 10 appeared. A malformed head raises
-- instead of choosing a branch, so a typo in PGOPTIONS reports itself rather than passing.
CREATE FUNCTION pg_temp.st2_at_least(want text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $fn$
DECLARE h int; w int;
BEGIN
  IF pg_temp.st2_head() !~ '^stage[0-9]+$' OR want !~ '^stage[0-9]+$' THEN
    RAISE EXCEPTION 'st2_at_least: a stage head must be spelled stage<n> — got head=% want=%',
      pg_temp.st2_head(), want;
  END IF;
  h := regexp_replace(pg_temp.st2_head(), '^stage', '')::int;
  w := regexp_replace(want, '^stage', '')::int;
  RETURN h >= w;
END
$fn$;

DO $EMPTY$
DECLARE
  r record;
  n bigint;
  rels text;
  -- Every table the Stage 2 chain owns. `profiles` and `user_roles` are absent on
  -- purpose: they predate Stage 2 and remain live account tables.
  --
  -- Head-aware because E01 is a set comparison and E02 loops this same list: a stage that
  -- legitimately adds a canonical table must say so here, and a chain that does not have it
  -- must not be handed the later expectation. The Stage 9 manifest is the first arrival since
  -- Stage 4's catalogue tables.
  canonical text[] := ARRAY[
    'public.approval_feedback', 'public.approval_requests', 'public.design_templates',
    'public.entitlements', 'public.guest_households', 'public.household_event_scopes',
    'public.invitation_drafts', 'public.invitation_versions', 'public.publications',
    'public.rsvp_responses', 'public.tradition_pack_releases', 'public.tradition_packs',
    'public.venues', 'public.wedding_assets', 'public.wedding_events',
    'public.wedding_people', 'public.weddings',
    'private.access_tokens', 'private.audit_events',
    'legacy.activity_logs', 'legacy.guests', 'legacy.migration_findings',
    'legacy.orders', 'legacy.payments', 'legacy.printers', 'legacy.projects',
    'legacy.templates'
  ] || CASE WHEN pg_temp.st2_at_least('stage9')
            THEN ARRAY['public.invitation_outputs']
            ELSE ARRAY[]::text[] END;
BEGIN

  -- ============================================== 1. the inventory is declared

  PERFORM pg_temp.st2_set('E01 the Stage 2 chain created exactly the declared canonical tables',
    (SELECT array_agg(t ORDER BY t) FROM (
       SELECT table_schema || '.' || table_name AS t
         FROM information_schema.tables
        WHERE table_schema IN ('public','private','legacy')
          AND table_type = 'BASE TABLE'
          AND (table_schema || '.' || table_name) <> ALL
                (ARRAY['public.profiles','public.user_roles'])
     ) s),
    (SELECT array_agg(x ORDER BY x) FROM unnest(canonical) x));

  -- =============================================== 2. and produced no rows at all

  FOR r IN SELECT unnest(canonical) AS rel LOOP
    EXECUTE format('SELECT count(*) FROM %s', r.rel) INTO n;
    PERFORM pg_temp.st2_ok('E02 ' || r.rel || ' is empty on a clean chain (found ' || n || ')',
                           n = 0);
  END LOOP;

  -- Accounts are only ever created by signing up. Nothing signed up here, so the
  -- three tables that describe people must agree with each other at zero.
  PERFORM pg_temp.st2_count('E03 no account exists', 'auth.users', 0);
  PERFORM pg_temp.st2_count('E04 no profile exists', 'public.profiles', 0);
  PERFORM pg_temp.st2_count('E05 no role row exists, so no convenience admin was invented',
    'public.user_roles', 0);

  -- Belt and braces against a migration that hardcodes the fixture's uuids: those
  -- identifiers must appear nowhere in the canonical domain.
  PERFORM pg_temp.st2_count('E06 no canonical wedding is owned by a fixture account',
    'public.weddings w WHERE w.owner_user_id::text LIKE ''a0000000-%''', 0);
  PERFORM pg_temp.st2_count('E07 no canonical design template carries a fixture id',
    'public.design_templates d WHERE d.id::text LIKE ''b0000000-%'' OR d.id::text LIKE ''b1000000-%''', 0);

  -- Findings are statements about old rows. With no old rows, the archive's only
  -- content-bearing table must be silent — this is what makes the legacy-mode count
  -- of 33 a measurement instead of a constant.
  PERFORM pg_temp.st2_count('E08 the migration had nothing to refuse, and said nothing',
    'legacy.migration_findings', 0);

  -- ==================================================== 3. the schema is still there

  -- Derived rather than remembered: E01 has just proved that the live inventory equals
  -- `canonical`, so the only thing this check adds is that the two account tables are still
  -- present alongside it. Asking for a literal here would mean this line moves every time a
  -- stage declares a table, and a line that always moves is a line nobody checks.
  PERFORM pg_temp.st2_count('E09 every base table the chain owns exists ('
      || cardinality(canonical) || ' canonical + profiles + user_roles)',
    'information_schema.tables WHERE table_schema IN (''public'',''private'',''legacy'')
       AND table_type = ''BASE TABLE''', cardinality(canonical) + 2);

  -- RLS state is identical whether or not rows arrived: an empty table with RLS off is
  -- still a hole waiting for its first INSERT.
  --
  -- The name list is built from `canonical` instead of being typed out a second time, which
  -- is what keeps the two halves of this file able to disagree. Stage 9's manifest is
  -- server-written and read by its owner over exactly one SELECT policy, so an INSERT
  -- landing on it from a browser role would have nowhere to hide.
  SELECT string_agg(quote_literal(replace(x, 'public.', '')), ',' ORDER BY x)
    INTO rels FROM unnest(canonical) x WHERE x LIKE 'public.%';
  PERFORM pg_temp.st2_count('E10 RLS is enabled on every canonical public table',
    'pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ''public'' AND c.relrowsecurity = false
       AND c.relname IN (' || rels || ')', 0);

  PERFORM pg_temp.st2_count('E11 the browser roles can name only the public schema',
    '(VALUES (''anon''),(''authenticated'')) x(rolname)
     WHERE NOT has_schema_privilege(x.rolname, ''public'', ''USAGE'')
        OR has_schema_privilege(x.rolname, ''private'', ''USAGE'')
        OR has_schema_privilege(x.rolname, ''legacy'', ''USAGE'')', 0);

  -- A clean chain must not have softened the archive either. What is measured here,
  -- rather than remembered from the migration text: the archived tables kept no
  -- policies and no triggers (step 8 removes them, because the control that now
  -- protects them is reachability), and no grant reaches them.
  PERFORM pg_temp.st2_count('E12 no table in a protected schema is granted to a browser role',
    'information_schema.role_table_grants g WHERE g.grantee IN (''anon'',''authenticated'')
       AND g.table_schema IN (''private'',''legacy'')', 0);

  PERFORM pg_temp.st2_count('E13 no RLS policy is left on an archived table',
    'pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ''legacy''', 0);
  PERFORM pg_temp.st2_count('E14 no trigger is left on an archived table (the Stage 0 paid-state guard was table-scoped and went with the table)',
    'pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ''legacy'' AND NOT t.tgisinternal', 0);

  -- E15/E16 replace the trigger with the thing that actually holds: try to name the
  -- relation as the role. A message is not evidence, so the SQLSTATE is compared.
  IF pg_temp.st2_state('SELECT count(*) FROM legacy.projects', 'authenticated') = '42501' THEN
    PERFORM pg_temp.st2_ok('E15 authenticated cannot even resolve legacy.projects (42501)', true);
  ELSE
    PERFORM pg_temp.st2_ok('E15 authenticated cannot even resolve legacy.projects (42501)', false);
  END IF;

  IF pg_temp.st2_state('SELECT count(*) FROM private.access_tokens', 'anon') = '42501' THEN
    PERFORM pg_temp.st2_ok('E16 anon cannot even resolve private.access_tokens (42501)', true);
  ELSE
    PERFORM pg_temp.st2_ok('E16 anon cannot even resolve private.access_tokens (42501)', false);
  END IF;

END
$EMPTY$;

-- A suite whose assertions can all be deleted one at a time still prints "PASSED", so
-- the floor is checked before that word is used. The floor is derived, not remembered:
-- 1 inventory check (E01) + one emptiness check per canonical table (E02) + the 14 fixed
-- probes (E03-E16). E02's count is the declared inventory's size, so declaring a new
-- canonical table moves this number by exactly one and deleting an assertion breaks it.
DO $FLOOR$
DECLARE n int; floor int;
BEGIN
  n := coalesce(current_setting('st2.passed', true), '0')::int;
  floor := 1 + 14 + CASE WHEN pg_temp.st2_at_least('stage9') THEN 28 ELSE 27 END;
  IF n < floor THEN
    RAISE EXCEPTION 'Stage 2 clean-chain suite ran only % assertions (floor %)', n, floor;
  END IF;
END
$FLOOR$;

SELECT 'STAGE2 CLEAN-CHAIN TESTS PASSED (' || current_setting('st2.passed') || ')' AS result;
