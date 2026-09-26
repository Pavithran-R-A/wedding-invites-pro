-- Stage 3 §3 — the wedding/draft creation invariant.
-- Run AFTER bootstrap + published migrations + the Stage 2 chain + the Stage 3 chain,
-- as superuser, in one transaction.
--
-- What is being proved, in the directive's own five parts:
--   1. every product-created wedding reaches the required draft state;
--   2. a duplicate draft cannot exist;
--   3. another account cannot create or replace it;
--   4. a failed creation cannot leave an invalid partial state;
--   5. migration-created historical weddings remain valid.
-- Plus the residual the mechanism genuinely does not cover, asserted rather than
-- glossed: `owners_manage_own_draft` gives the owner DELETE, so a deliberate owner
-- delete leaves the wedding with no draft, and the editing path has to recover.
--
-- Fault injection for (4) is a temporary BEFORE INSERT guard on `invitation_drafts`
-- that refuses the write. It is dropped in the same file that creates it, and the
-- half that matters is the control: with the guard gone, the identical INSERT
-- succeeds and is paired. Without that second half, "nothing was left behind" would
-- only mean the insert never worked for some other reason.
--
-- Refusals are told apart the way Stage 2 taught, because "it errored" proves
-- nothing on its own:
--   42501 + "permission denied"     the grant layer refused it
--   42501 + "row-level security"    a policy refused it
--   0 rows affected                 RLS hid the row from the caller
--   23505 / 23503                   the unique index / the foreign key refused it
-- A probe that reports 'no-error' is a failed test, never an unreported pass.
--
-- Scope note, stated rather than implied: this proves the *database* guarantee for
-- every create path, which is the repair Stage 2 asked for. The application's
-- `createWedding()` is covered by the API suite and the browser pass elsewhere in
-- Stage 3; a DB-level invariant does not need the app to cooperate, and that is the
-- point of choosing it.

SET client_min_messages = notice;
SELECT set_config('st3.passed', '0', false);

CREATE FUNCTION pg_temp.st3_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- Rows the CURRENT role can read. SECURITY INVOKER, so RLS applies.
CREATE FUNCTION pg_temp.st3_visible(select_sql text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || select_sql || ') q' INTO n;
  RETURN n;
END $$;

-- Rows a write touched. Used where success is the expected shape, or where a zero is
-- itself the answer (RLS hiding a row); a raised refusal propagates.
CREATE FUNCTION pg_temp.st3_changed(stmt text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Whether a row exists at all, seen past RLS. Only valid when the caller is not
-- holding a role: it switches to the trusted backend and back to the session user.
CREATE FUNCTION pg_temp.st3_real(select_sql text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SET ROLE service_role';
  EXECUTE 'SELECT count(*) FROM (' || select_sql || ') q' INTO n;
  EXECUTE 'RESET ROLE';
  RETURN n;
END $$;

CREATE FUNCTION pg_temp.st3_add(n integer) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('st3.passed',
    (coalesce(nullif(current_setting('st3.passed', true), ''), '0')::int + n)::text, false);
END $$;

-- ===========================================================================
-- Two accounts and their own weddings, created the way the product creates them:
-- as `authenticated`, through the RLS policies, with no help from the harness.
-- ===========================================================================
CREATE TEMP TABLE s3 ON COMMIT DROP AS
SELECT gen_random_uuid() AS owner_c, gen_random_uuid() AS owner_d,
       gen_random_uuid() AS wedding_c, gen_random_uuid() AS wedding_d,
       gen_random_uuid() AS wedding_svc, gen_random_uuid() AS aborted;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT s.owner_c, 'host-c@stage3.test', '{}'::jsonb FROM s3 s
UNION ALL SELECT s.owner_d, 'host-d@stage3.test', '{}'::jsonb FROM s3 s;

DO $S3A$
DECLARE
  s      s3%ROWTYPE;
  v      text;
  n      bigint;
  made   uuid;
BEGIN
  SELECT * INTO s FROM s3;
  PERFORM set_config('probe3.owner_c',   s.owner_c::text,   false);
  PERFORM set_config('probe3.owner_d',   s.owner_d::text,   false);
  PERFORM set_config('probe3.wedding_c', s.wedding_c::text, false);
  PERFORM set_config('probe3.wedding_d', s.wedding_d::text, false);
  PERFORM set_config('probe3.wedding_svc', s.wedding_svc::text, false);
  PERFORM set_config('probe3.aborted',   s.aborted::text,   false);

  -- ---------------------------------------------------------------- group A
  -- (1) a create arrives paired, and the draft is the database's own row: empty
  -- content, defaulted timestamps, nothing invented.
  n := pg_temp.st3_real('SELECT 1 FROM public.weddings WHERE id = current_setting(''probe3.aborted'')::uuid');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL A: the id reserved for the aborted-create test already exists (% rows)', n;
  END IF;
  PERFORM pg_temp.st3_add(1);

  PERFORM set_config('test.uid', s.owner_c::text, false);
  EXECUTE 'SET ROLE authenticated';
  EXECUTE $a$INSERT INTO public.weddings (id, owner_user_id, title, primary_language)
             VALUES (current_setting('probe3.wedding_c')::uuid,
                     current_setting('probe3.owner_c')::uuid, 'Asha Second Time', 'en')
             RETURNING id$a$ INTO made;
  EXECUTE 'RESET ROLE';
  IF made IS NULL OR made <> s.wedding_c THEN
    RAISE EXCEPTION 'FAIL A: an owner could not create a wedding through its own policies';
  END IF;
  PERFORM pg_temp.st3_add(1);

  n := pg_temp.st3_real(
    'SELECT 1 FROM public.invitation_drafts WHERE wedding_id = current_setting(''probe3.wedding_c'')::uuid');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL A: the wedding arrived with % drafts, expected exactly 1', n;
  END IF;
  PERFORM pg_temp.st3_add(1);

  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.owner_c::text, false);
  n := pg_temp.st3_visible(
    'SELECT 1 FROM public.invitation_drafts WHERE wedding_id = current_setting(''probe3.wedding_c'')::uuid');
  EXECUTE 'RESET ROLE';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL A: the owner cannot see the draft its wedding created (% visible)', n;
  END IF;
  PERFORM pg_temp.st3_add(1);

  -- "reaches the required draft state" means an editable empty draft, not a row the
  -- trigger filled in. If this ever stops being true, the trigger has started
  -- authoring content and Stage 2's "invents nothing" rule is gone.
  EXECUTE $a$SELECT count(*) FROM public.invitation_drafts
              WHERE wedding_id = current_setting('probe3.wedding_c')::uuid
                AND content = '{}'::jsonb AND created_at IS NOT NULL
                AND updated_at = created_at$a$ INTO n;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL A: the paired draft is not an untouched empty one (matching rows=%)', n;
  END IF;
  PERFORM pg_temp.st3_add(1);

  -- The second wedding belongs to the second account: it is what group C aims at
  -- from the wrong side, and it gives cleanup a pair that was never disturbed.
  PERFORM set_config('test.uid', s.owner_d::text, false);
  EXECUTE 'SET ROLE authenticated';
  EXECUTE $a$INSERT INTO public.weddings (id, owner_user_id, title, primary_language)
             VALUES (current_setting('probe3.wedding_d')::uuid,
                     current_setting('probe3.owner_d')::uuid, 'Bala Reprise', 'en')
             RETURNING id$a$ INTO made;
  EXECUTE 'RESET ROLE';
  IF made IS NULL THEN
    RAISE EXCEPTION 'FAIL A: the second account could not create a wedding';
  END IF;
  n := pg_temp.st3_real(
    'SELECT 1 FROM public.invitation_drafts WHERE wedding_id = current_setting(''probe3.wedding_d'')::uuid');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL A: the second wedding arrived with % drafts', n;
  END IF;
  PERFORM pg_temp.st3_add(2);

  -- The invariant is a schema property, so a trusted backend insert inherits it
  -- without anyone remembering. This is the half an application-side repair could
  -- never claim.
  EXECUTE 'SET ROLE service_role';
  EXECUTE $a$INSERT INTO public.weddings (id, owner_user_id, title, primary_language)
             VALUES (current_setting('probe3.wedding_svc')::uuid,
                     current_setting('probe3.owner_c')::uuid, 'Backfilled Wedding', 'en')$a$;
  EXECUTE 'RESET ROLE';
  n := pg_temp.st3_real(
    'SELECT 1 FROM public.invitation_drafts WHERE wedding_id = current_setting(''probe3.wedding_svc'')::uuid');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL A: a service_role wedding arrived with % drafts, expected exactly 1', n;
  END IF;
  PERFORM pg_temp.st3_add(1);
  RAISE NOTICE 'PASS A: every create path returns paired — owner creates, second owner creates, trusted backend creates (8)';

  -- ---------------------------------------------------------------- group B
  -- (2) a duplicate cannot exist, and the barrier is the index rather than the
  -- policy: what a caller is refused, the owner of the database is refused too.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.owner_c::text, false);
  v := pg_temp.st3_err($b$INSERT INTO public.invitation_drafts (wedding_id, content)
        VALUES (current_setting('probe3.wedding_c')::uuid, '{"second": true}'::jsonb)$b$);
  EXECUTE 'RESET ROLE';
  IF v NOT LIKE '23505%' OR v NOT LIKE '%invitation_drafts_wedding_id_key%' THEN
    RAISE EXCEPTION 'FAIL B: a second draft for one wedding was not refused by the unique index: %', v;
  END IF;
  PERFORM pg_temp.st3_add(1);

  v := pg_temp.st3_err($b$INSERT INTO public.invitation_drafts (wedding_id, content)
        VALUES (current_setting('probe3.wedding_c')::uuid, '{}'::jsonb)$b$);
  IF v NOT LIKE '23505%' THEN
    RAISE EXCEPTION 'FAIL B: the maintenance role could write a second draft (%). The duplicate barrier must not depend on RLS', v;
  END IF;
  PERFORM pg_temp.st3_add(1);

  -- The pairing cannot be forged from the draft end either: a draft needs a real
  -- wedding, so "it has a draft" can never be satisfied by an orphan.
  v := pg_temp.st3_err($b$INSERT INTO public.invitation_drafts (wedding_id, content)
        VALUES ('00000000-0000-0000-0000-000000000000'::uuid, '{}'::jsonb)$b$);
  IF v NOT LIKE '23503%' THEN
    RAISE EXCEPTION 'FAIL B: a draft for a wedding that does not exist was accepted: %', v;
  END IF;
  PERFORM pg_temp.st3_add(1);

  -- The draft is editable by its owner — the operation the editor performs. A
  -- paired-but-frozen draft would satisfy (1) and still be useless.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.owner_c::text, false);
  n := pg_temp.st3_changed($b$UPDATE public.invitation_drafts
        SET content = '{"heading": "Asha weds Bala again"}'::jsonb
        WHERE wedding_id = current_setting('probe3.wedding_c')::uuid$b$);
  EXECUTE 'RESET ROLE';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL B: the owner could not edit its own draft (rows=%)', n;
  END IF;
  PERFORM pg_temp.st3_add(1);
  RAISE NOTICE 'PASS B: one draft per wedding, enforced by the index not the policy, and still editable (4)';

  -- ---------------------------------------------------------------- group C
  -- (3) another account cannot create, replace, delete or even read it.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.owner_d::text, false);
  v := pg_temp.st3_err($c$INSERT INTO public.invitation_drafts (wedding_id, content)
        VALUES (current_setting('probe3.wedding_c')::uuid, '{"forged": true}'::jsonb)$c$);
  IF v NOT LIKE '42501%' OR v NOT LIKE '%row-level security%' THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL C: another account could attach a draft to a wedding it does not own, or was refused by something other than a policy: %', v;
  END IF;
  PERFORM pg_temp.st3_add(1);

  n := pg_temp.st3_changed($c$UPDATE public.invitation_drafts
        SET content = '{"replaced": true}'::jsonb
        WHERE wedding_id = current_setting('probe3.wedding_c')::uuid$c$);
  IF n <> 0 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL C: another account replaced the content of a draft it does not own (% rows)', n;
  END IF;
  PERFORM pg_temp.st3_add(1);

  n := pg_temp.st3_changed('DELETE FROM public.invitation_drafts WHERE wedding_id = current_setting(''probe3.wedding_c'')::uuid');
  IF n <> 0 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL C: another account deleted a draft it does not own (% rows)', n;
  END IF;
  EXECUTE 'RESET ROLE';
  n := pg_temp.st3_real(
    'SELECT 1 FROM public.invitation_drafts WHERE wedding_id = current_setting(''probe3.wedding_c'')::uuid');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL C: the refused delete left the wedding with % drafts instead of 1', n;
  END IF;
  PERFORM pg_temp.st3_add(2);

  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.owner_d::text, false);
  n := pg_temp.st3_visible(
    'SELECT 1 FROM public.invitation_drafts WHERE wedding_id = current_setting(''probe3.wedding_c'')::uuid');
  EXECUTE 'RESET ROLE';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL C: another account can read a draft it does not own (% rows)', n;
  END IF;
  PERFORM pg_temp.st3_add(1);

  EXECUTE 'SET ROLE anon';
  v := pg_temp.st3_err('SELECT count(*) FROM public.invitation_drafts');
  IF v NOT LIKE '42501%' OR v NOT LIKE '%permission denied%' THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL C: an anonymous caller reached the draft table at all: %', v;
  END IF;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.st3_add(1);
  RAISE NOTICE 'PASS C: create, replace, delete, read and the anonymous path are all closed to other accounts (6)';
END $S3A$;

-- The injected failure, at file level: DDL around a probe must not be tangled in the
-- assertion block's savepoints.
CREATE FUNCTION private.st3_probe_reject_draft() RETURNS trigger
LANGUAGE plpgsql AS $probe$
BEGIN
  RAISE EXCEPTION 'STAGE3-PROBE draft write refused';
END $probe$;

CREATE TRIGGER st3_probe_draft_guard
  BEFORE INSERT ON public.invitation_drafts
  FOR EACH ROW EXECUTE FUNCTION private.st3_probe_reject_draft();

DO $S3D$
DECLARE
  s   s3%ROWTYPE;
  v   text;
  n   bigint;
BEGIN
  SELECT * INTO s FROM s3;

  -- ---------------------------------------------------------------- group D
  -- (4) a failed draft write takes the wedding with it.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.owner_c::text, false);
  v := pg_temp.st3_err($d$INSERT INTO public.weddings (id, owner_user_id, title, primary_language)
        VALUES (current_setting('probe3.aborted')::uuid,
                current_setting('probe3.owner_c')::uuid, 'Wedding That Never Was', 'en')$d$);
  EXECUTE 'RESET ROLE';
  IF v NOT LIKE '%STAGE3-PROBE%' THEN
    RAISE EXCEPTION 'FAIL D: the create did not fail at the draft write, so the two assertions below would be vacuous: %', v;
  END IF;
  PERFORM pg_temp.st3_add(1);

  n := pg_temp.st3_real('SELECT 1 FROM public.weddings WHERE id = current_setting(''probe3.aborted'')::uuid');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL D: the wedding outlived its own failed draft';
  END IF;
  PERFORM pg_temp.st3_add(1);

  n := pg_temp.st3_real('SELECT 1 FROM public.invitation_drafts WHERE wedding_id = current_setting(''probe3.aborted'')::uuid');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL D: a draft survived for a wedding that does not exist';
  END IF;
  PERFORM pg_temp.st3_add(1);

  -- A client cannot turn the invariant off. It is not a convention the caller can
  -- opt out of: switching a trigger requires owning the table, and the two forms
  -- differ in who is allowed to use them, so both are probed.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.owner_c::text, false);
  v := pg_temp.st3_err('ALTER TABLE public.weddings DISABLE TRIGGER weddings_have_draft');
  IF v NOT LIKE '42501%' THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL D: a customer role could disable the invariant trigger by name: %', v;
  END IF;
  PERFORM pg_temp.st3_add(1);

  v := pg_temp.st3_err('ALTER TABLE public.weddings DISABLE TRIGGER ALL');
  EXECUTE 'RESET ROLE';
  IF v NOT LIKE '42501%' THEN
    RAISE EXCEPTION 'FAIL D: a customer role could disable every trigger on weddings at once: %', v;
  END IF;
  PERFORM pg_temp.st3_add(1);
  RAISE NOTICE 'PASS D: the failed draft write left no wedding and no draft, and a client cannot disable the trigger either way (5)';
END $S3D$;

DROP TRIGGER st3_probe_draft_guard ON public.invitation_drafts;
DROP FUNCTION private.st3_probe_reject_draft();

DO $S3E$
DECLARE
  s    s3%ROWTYPE;
  v    text;
  n    bigint;
  made uuid;
BEGIN
  SELECT * INTO s FROM s3;

  -- The control half of (4): with the guard gone, the identical statement succeeds
  -- and is paired. This is what makes the refusals above mean something rather than
  -- just reporting a broken environment.
  PERFORM set_config('test.uid', s.owner_c::text, false);
  EXECUTE 'SET ROLE authenticated';
  EXECUTE $e$INSERT INTO public.weddings (id, owner_user_id, title, primary_language)
             VALUES (current_setting('probe3.aborted')::uuid,
                     current_setting('probe3.owner_c')::uuid, 'Wedding That Never Was', 'en')
             RETURNING id$e$ INTO made;
  EXECUTE 'RESET ROLE';
  IF made IS NULL THEN
    RAISE EXCEPTION 'FAIL E (control): the same create still fails after the injected fault was removed';
  END IF;
  PERFORM pg_temp.st3_add(1);

  n := pg_temp.st3_real(
    'SELECT 1 FROM public.invitation_drafts WHERE wedding_id = current_setting(''probe3.aborted'')::uuid');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL E (control): the retried create is unpaired (% drafts)', n;
  END IF;
  PERFORM pg_temp.st3_add(1);

  -- ---------------------------------------------------------------- group F
  -- (5) the shape of the whole database, and the historical rows.
  SELECT count(*) INTO n FROM (
    SELECT wedding_id FROM public.invitation_drafts
     GROUP BY wedding_id HAVING count(*) > 1) d;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL F: % weddings carry more than one draft', n;
  END IF;
  PERFORM pg_temp.st3_add(1);

  SELECT count(*) INTO n FROM public.invitation_drafts d
    LEFT JOIN public.weddings w ON w.id = d.wedding_id WHERE w.id IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL F: % drafts point at a wedding that is not there', n;
  END IF;
  PERFORM pg_temp.st3_add(1);

  -- The Stage 3 function follows the project rule for functions: not executable by
  -- an API role, and not even by the trusted backend, because a trigger is the only
  -- supported way to reach it (Stage 2 measured both halves of C68/C69).
  IF has_function_privilege('anon', 'private.attach_draft_on_wedding_create()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.attach_draft_on_wedding_create()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL F: a browser role can execute the invariant function directly';
  END IF;
  PERFORM pg_temp.st3_add(1);

  IF has_function_privilege('service_role', 'private.attach_draft_on_wedding_create()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL F: even the trusted backend can call the invariant function out of band';
  END IF;
  PERFORM pg_temp.st3_add(1);

  -- Historical rows. In the legacy chain the migrated weddings are identifiable
  -- because the migration reused `legacy.projects.id` as `weddings.id`, so this
  -- asks the database, not a hard-coded count: every archived project that became a
  -- wedding has exactly one draft, and that draft still carries the timestamp the
  -- migration gave it (equal to the wedding's own) rather than a `now()` from the
  -- Stage 3 trigger. In the clean chain there are no archived rows and the
  -- assertion is not run — saying so is the point, not passing on an empty set.
  SELECT count(*) INTO n FROM legacy.projects;
  IF n > 0 THEN
    EXECUTE $f$SELECT count(*) FROM legacy.projects p
                 JOIN public.weddings w ON w.id = p.id$f$ INTO n;
    IF n = 0 THEN
      RAISE EXCEPTION 'FAIL F (legacy): archived projects exist but none became a wedding — the fixture and this probe disagree';
    END IF;
    PERFORM pg_temp.st3_add(1);

    SELECT count(*) INTO n FROM legacy.projects p
      JOIN public.weddings w ON w.id = p.id
     WHERE (SELECT count(*) FROM public.invitation_drafts d
             WHERE d.wedding_id = w.id) <> 1;
    IF n <> 0 THEN
      RAISE EXCEPTION 'FAIL F (legacy): % migrated weddings do not have exactly one draft', n;
    END IF;
    PERFORM pg_temp.st3_add(1);

    SELECT count(*) INTO n FROM legacy.projects p
      JOIN public.weddings w ON w.id = p.id
      JOIN public.invitation_drafts d ON d.wedding_id = w.id
     WHERE d.created_at <> w.created_at OR d.updated_at <> w.updated_at;
    IF n <> 0 THEN
      RAISE EXCEPTION 'FAIL F (legacy): % migrated drafts were rewritten by the Stage 3 trigger instead of left as the migration wrote them', n;
    END IF;
    SELECT count(*) INTO n FROM legacy.projects p JOIN public.weddings w ON w.id = p.id;
    RAISE NOTICE 'PASS F (legacy): % migrated weddings each keep exactly one draft, still stamped by the migration rather than by the Stage 3 trigger', n;
    PERFORM pg_temp.st3_add(1);
  ELSE
    RAISE NOTICE 'PASS F (clean chain): no archived projects exist here, so the historical half is proved by the legacy chain only';
  END IF;

  -- ---------------------------------------------------------------- group G
  -- The residual, measured instead of assumed: the owner's DELETE right really does
  -- leave a wedding undrafted, and the recovery path really does restore exactly one.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.owner_c::text, false);
  n := pg_temp.st3_changed('DELETE FROM public.invitation_drafts WHERE wedding_id = current_setting(''probe3.wedding_c'')::uuid');
  IF n <> 1 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL G: the owner could not delete its own draft (rows=%). Stage 2 granted this right, so refusing it would be a behaviour change', n;
  END IF;
  PERFORM pg_temp.st3_add(1);

  n := pg_temp.st3_visible(
    'SELECT 1 FROM public.invitation_drafts WHERE wedding_id = current_setting(''probe3.wedding_c'')::uuid');
  IF n <> 0 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL G: the deleted draft is still visible to its owner';
  END IF;
  PERFORM pg_temp.st3_add(1);

  -- The editor's recovery: one statement, as the owner, restores the pair.
  n := pg_temp.st3_changed($g$INSERT INTO public.invitation_drafts (wedding_id, content)
        VALUES (current_setting('probe3.wedding_c')::uuid, '{"recovered": true}'::jsonb)$g$);
  IF n <> 1 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL G: the owner could not recover its draft (rows=%)', n;
  END IF;
  PERFORM pg_temp.st3_add(1);

  v := pg_temp.st3_err($g$INSERT INTO public.invitation_drafts (wedding_id)
        VALUES (current_setting('probe3.wedding_c')::uuid)$g$);
  EXECUTE 'RESET ROLE';
  IF v NOT LIKE '23505%' THEN
    RAISE EXCEPTION 'FAIL G: after a delete-and-recover, a second draft was not refused: %', v;
  END IF;
  PERFORM pg_temp.st3_add(1);
  RAISE NOTICE 'PASS G: the DELETE right, the recovery path, and the duplicate wall after it (4)';
END $S3E$;

-- --------------------------------------------------------------------- cleanup
-- This file commits when it succeeds, so the suites that run after it would
-- otherwise be counting this probe's rows.
DO $S3Z$
DECLARE
  s   s3%ROWTYPE;
  n   bigint;
BEGIN
  SELECT * INTO s FROM s3;

  DELETE FROM public.weddings
   WHERE id IN (s.wedding_c, s.wedding_d, s.wedding_svc, s.aborted);
  DELETE FROM auth.users WHERE id IN (s.owner_c, s.owner_d);

  n := (SELECT count(*) FROM public.weddings
         WHERE id IN (s.wedding_c, s.wedding_d, s.wedding_svc, s.aborted));
  IF n <> 0 THEN RAISE EXCEPTION 'CLEANUP: % probe weddings survived', n; END IF;
  PERFORM pg_temp.st3_add(1);

  n := (SELECT count(*) FROM public.invitation_drafts
         WHERE wedding_id IN (s.wedding_c, s.wedding_d, s.wedding_svc, s.aborted));
  IF n <> 0 THEN RAISE EXCEPTION 'CLEANUP: % probe drafts survived their weddings', n; END IF;
  PERFORM pg_temp.st3_add(1);

  n := (SELECT count(*) FROM auth.users WHERE email LIKE '%@stage3.test');
  IF n <> 0 THEN RAISE EXCEPTION 'CLEANUP: % probe accounts survived', n; END IF;
  PERFORM pg_temp.st3_add(1);

  n := (SELECT count(*) FROM pg_class WHERE relname LIKE 'st3_probe_%')
     + (SELECT count(*) FROM pg_proc WHERE proname LIKE 'st3_probe_%');
  IF n <> 0 THEN RAISE EXCEPTION 'CLEANUP: % probe objects leaked into the catalogue', n; END IF;
  PERFORM pg_temp.st3_add(1);

  -- Deleting a wedding takes its draft with it (ON DELETE CASCADE) — so the pair
  -- cannot outlive the wedding, which is the other half of "no orphan state".
  n := (SELECT count(*) FROM public.invitation_drafts d
          LEFT JOIN public.weddings w ON w.id = d.wedding_id WHERE w.id IS NULL);
  IF n <> 0 THEN RAISE EXCEPTION 'CLEANUP: % orphan drafts remain database-wide', n; END IF;
  PERFORM pg_temp.st3_add(1);

  RAISE NOTICE 'PASS Z: the probe removed its own rows, its accounts, and its schema objects (5)';
END $S3Z$;

DO $S3FLOOR$
DECLARE passed integer;
BEGIN
  passed := coalesce(nullif(current_setting('st3.passed', true), ''), '0')::int;
  IF passed < 38 THEN
    RAISE EXCEPTION 'FAIL: only % assertions ran — the expected floor is 38, so a probe set went empty', passed;
  END IF;
END $S3FLOOR$;

SELECT 'STAGE3 DRAFT INVARIANT TESTS PASSED ('
    || coalesce(nullif(current_setting('st3.passed', true), ''), '0') || ')' AS result;
