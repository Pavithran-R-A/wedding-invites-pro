-- Stage 0 RLS / security regression tests.
-- Run AFTER bootstrap + every migration file, as a superuser (postgres).
-- The block impersonates each API role with SET ROLE, attempts a real-world
-- attack, and RAISEs on the FIRST violation of expectation. A clean run ends
-- with 'STAGE0 RLS TESTS PASSED'; any assertion failure aborts the transaction,
-- so the shell harness turns a non-zero psql exit into a hard failure.

SET client_min_messages = notice;

-- ===========================================================================
-- Seed (as owner / trusted backend, so RLS does not interfere with setup)
-- ===========================================================================
CREATE TEMP TABLE seed ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS user_a,
  gen_random_uuid() AS user_b,
  gen_random_uuid() AS project_a,
  gen_random_uuid() AS project_b,
  gen_random_uuid() AS guest_x,
  'tok-' || gen_random_uuid()::text AS guest_token,
  gen_random_uuid() AS printer_p;

-- Signups go through auth.users so the handle_new_user trigger is exercised.
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT s.user_a, 'a@example.test', jsonb_build_object('name','Asha') FROM seed s
UNION ALL
SELECT s.user_b, 'b@example.test', jsonb_build_object('name','Bala') FROM seed s;

INSERT INTO public.projects (id, user_id, title, paid_status)
SELECT s.project_a, s.user_a, 'Asha Wedding', 'unpaid'::public.paid_status FROM seed s
UNION ALL
SELECT s.project_b, s.user_b, 'Bala Wedding', 'unpaid'::public.paid_status FROM seed s;

INSERT INTO public.guests (id, project_id, name, token, rsvp_status)
SELECT s.guest_x, s.project_a, 'Guest One', s.guest_token, 'pending'::public.rsvp_status FROM seed s;

INSERT INTO public.printers (id, name, api_endpoint, payment_terms, active)
SELECT s.printer_p, 'Print Mart', 'https://partner.example/secret', 'NET-30', true FROM seed s;

-- ===========================================================================
-- Attack / control assertions
-- ===========================================================================
DO $$
DECLARE
  s        seed%ROWTYPE;
  n        integer;
  m        integer;
  status   public.paid_status;
  raised   boolean;
  passed   integer := 0;
BEGIN
  SELECT * INTO s FROM seed;

  -- --- helper-free inline assertions -------------------------------------

  -- 1. anon must NOT be able to RSVP-UPDATE a guest by token (policy removed).
  EXECUTE 'SET ROLE anon';
  PERFORM set_config('test.role','anon', false);
  PERFORM set_config('test.uid', '', false);
  EXECUTE 'UPDATE public.guests SET rsvp_status = ''attending'' WHERE token = $1'
    USING s.guest_token;
  GET DIAGNOSTICS n = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 1: anon updated % guest rows via token', n; END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 1: anon guest-token update blocked (0 rows)';

  -- 2. owner must NOT be able to self-escalate paid_status (trigger freezes).
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.role','authenticated', false);
  PERFORM set_config('test.uid', s.user_a::text, false);
  EXECUTE 'UPDATE public.projects SET paid_status = ''fully_paid'' WHERE id = $1'
    USING s.project_a;
  EXECUTE 'SELECT paid_status FROM public.projects WHERE id = $1' INTO status USING s.project_a;
  EXECUTE 'RESET ROLE';
  IF status <> 'unpaid' THEN RAISE EXCEPTION 'FAIL 2: owner escalated paid_status to %', status; END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 2: client paid_status escalation frozen (still unpaid)';

  -- 3. cross-user project UPDATE must affect 0 rows (RLS USING).
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.user_b::text, false);
  EXECUTE 'UPDATE public.projects SET title = ''hijacked'' WHERE id = $1' USING s.project_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 3: user B modified user A project (% rows)', n; END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 3: cross-user project update blocked (0 rows)';

  -- 4. client INSERT into payments must be denied by RLS.
  EXECUTE 'SET ROLE authenticated';
  raised := false;
  BEGIN
    EXECUTE 'INSERT INTO public.payments (order_id, user_id, amount_paise) VALUES (NULL, $1, 100)'
      USING s.user_a;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT raised THEN RAISE EXCEPTION 'FAIL 4: client inserted a payment row'; END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 4: client payments INSERT denied';

  -- 5. client INSERT into orders must be denied by RLS.
  EXECUTE 'SET ROLE authenticated';
  raised := false;
  BEGIN
    EXECUTE 'INSERT INTO public.orders (project_id, type) VALUES ($1, ''print'')'
      USING s.project_a;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT raised THEN RAISE EXCEPTION 'FAIL 5: client inserted an order row'; END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 5: client orders INSERT denied';

  -- 6. client INSERT into activity_logs must be denied by RLS.
  EXECUTE 'SET ROLE authenticated';
  raised := false;
  BEGIN
    EXECUTE 'INSERT INTO public.activity_logs (user_id, project_id, action) VALUES ($1, $2, ''forge'')'
      USING s.user_a, s.project_a;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT raised THEN RAISE EXCEPTION 'FAIL 6: client forged an activity_log row'; END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 6: client activity_logs INSERT denied';

  -- 7. anon must NOT see printer operational data.
  EXECUTE 'SET ROLE anon';
  PERFORM set_config('test.role','anon', false);
  EXECUTE 'SELECT count(*) FROM public.printers' INTO n;
  EXECUTE 'RESET ROLE';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 7: anon saw % printer rows', n; END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 7: anon printer read blocked (0 rows)';

  -- 8. non-admin authenticated must NOT see printers.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.role','authenticated', false);
  PERFORM set_config('test.uid', s.user_a::text, false);
  EXECUTE 'SELECT count(*) FROM public.printers' INTO n;
  EXECUTE 'RESET ROLE';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 8: non-admin saw % printer rows', n; END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 8: non-admin printer read blocked (0 rows)';

  -- 9. CONTROL: owner CAN edit their own project's non-money column.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.user_a::text, false);
  EXECUTE 'UPDATE public.projects SET title = ''Renamed'' WHERE id = $1' USING s.project_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 9: owner could not edit own project (% rows)', n; END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 9: owner can still edit own project (title)';

  -- 10. CONTROL: owner CAN add a guest to their own project.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.user_a::text, false);
  EXECUTE 'INSERT INTO public.guests (project_id, name) VALUES ($1, ''Plus One'')' USING s.project_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 10: owner could not add guest (% rows)', n; END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 10: owner can still manage own guests';

  -- 11. TRUSTED BACKEND: service_role may set paid_status and write money rows.
  EXECUTE 'SET ROLE service_role';
  PERFORM set_config('test.role','service_role', false);
  PERFORM set_config('test.uid', s.user_a::text, false);
  EXECUTE 'UPDATE public.projects SET paid_status = ''base_paid'' WHERE id = $1' USING s.project_a;
  EXECUTE 'SELECT paid_status FROM public.projects WHERE id = $1' INTO status USING s.project_a;
  EXECUTE 'INSERT INTO public.payments (order_id, user_id, amount_paise) VALUES (NULL, $1, 500)' USING s.user_a;
  EXECUTE 'INSERT INTO public.orders (project_id, type) VALUES ($1, ''print'')' USING s.project_a;
  EXECUTE 'INSERT INTO public.activity_logs (user_id, project_id, action) VALUES ($1, $2, ''svc'')' USING s.user_a, s.project_a;
  EXECUTE 'RESET ROLE';
  IF status <> 'base_paid' THEN RAISE EXCEPTION 'FAIL 11: service_role could not set paid_status (got %)', status; END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 11: service_role backend path intact (paid_status + money rows)';

  -- 12. Signup trigger created profiles + default 'user' role.
  SELECT count(*) INTO n FROM public.profiles p WHERE p.user_id IN (s.user_a, s.user_b);
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 12: handle_new_user created % profiles (expected 2)', n; END IF;
  SELECT count(*) INTO n FROM public.user_roles ur
    WHERE ur.user_id IN (s.user_a, s.user_b) AND ur.role = 'user';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 12b: default role missing (% rows)', n; END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 12: signup trigger still provisions profile + user role';

  -- 13. SECURITY DEFINER helpers hardened to an empty search_path.
  --     Postgres records an empty SET value as search_path="" (or search_path=).
  SELECT count(*) INTO n FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('has_role','is_project_owner','handle_new_user')
     AND p.prosecdef = true
     AND EXISTS (
       SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
       WHERE c ~ '^search_path=(|"")$'
     );
  IF n <> 3 THEN
    RAISE EXCEPTION 'FAIL 13: only % of 3 definers pinned to empty search_path. configs=%', n,
      (SELECT string_agg(p.proname || '=>' || coalesce(array_to_string(p.proconfig, '|'), '<null>'), ', ')
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname IN ('has_role','is_project_owner','handle_new_user'));
  END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 13: SECURITY DEFINER helpers hardened (search_path = %%)';

  -- =======================================================================
  -- 14-22: paid-state INSERT bypass (found by independent review after the
  -- Stage 0 baseline was published). Each case asserts the FINAL STORED STATE
  -- and, for rejections, that no row exists at all — never merely that an
  -- exception was raised, so silent normalisation cannot masquerade as a pass.
  -- =======================================================================

  -- 14. authenticated must NOT be able to create an already-paid project.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.role','authenticated', false);
  PERFORM set_config('test.uid', s.user_a::text, false);
  raised := false;
  BEGIN
    EXECUTE 'INSERT INTO public.projects (user_id, title, paid_status) VALUES ($1, $2, $3)'
      USING s.user_a, 'forged-full', 'fully_paid'::public.paid_status;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  EXECUTE 'SELECT count(*) FROM public.projects WHERE title = ''forged-full''' INTO n;
  EXECUTE 'RESET ROLE';
  IF NOT raised OR n <> 0 THEN
    RAISE EXCEPTION 'FAIL 14: client created a fully_paid project (rejected=% rows=%)', raised, n;
  END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 14: client fully_paid project INSERT rejected, no row created';

  -- 15. Same for base_paid.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.user_a::text, false);
  raised := false;
  BEGIN
    EXECUTE 'INSERT INTO public.projects (user_id, title, paid_status) VALUES ($1, $2, $3)'
      USING s.user_a, 'forged-base', 'base_paid'::public.paid_status;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  EXECUTE 'SELECT count(*) FROM public.projects WHERE title = ''forged-base''' INTO n;
  EXECUTE 'RESET ROLE';
  IF NOT raised OR n <> 0 THEN
    RAISE EXCEPTION 'FAIL 15: client created a base_paid project (rejected=% rows=%)', raised, n;
  END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 15: client base_paid project INSERT rejected, no row created';

  -- 16. An explicit NULL billing state is not a legitimate client create.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.user_a::text, false);
  raised := false;
  BEGIN
    EXECUTE 'INSERT INTO public.projects (user_id, title, paid_status) VALUES ($1, $2, NULL)'
      USING s.user_a, 'forged-null';
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  EXECUTE 'SELECT count(*) FROM public.projects WHERE title = ''forged-null''' INTO n;
  EXECUTE 'RESET ROLE';
  IF NOT raised OR n <> 0 THEN
    RAISE EXCEPTION 'FAIL 16: client created a NULL paid_status project (rejected=% rows=%)', raised, n;
  END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 16: client NULL paid_status INSERT rejected, no row created';

  -- 17. CONTROL: the real create path (paid_status omitted) must still work and
  --     must land as unpaid, not be rejected by the tightened policy.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.user_a::text, false);
  EXECUTE 'INSERT INTO public.projects (user_id, title) VALUES ($1, $2)'
    USING s.user_a, 'honest-create';
  GET DIAGNOSTICS n = ROW_COUNT;
  EXECUTE 'SELECT paid_status FROM public.projects WHERE title = ''honest-create''' INTO status;
  EXECUTE 'RESET ROLE';
  IF n <> 1 OR status <> 'unpaid' THEN
    RAISE EXCEPTION 'FAIL 17: legitimate create broke (rows=% status=%)', n, status;
  END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 17: legitimate client create works and stores unpaid';

  -- 18. Creating on behalf of another user stays impossible.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.user_a::text, false);
  raised := false;
  BEGIN
    EXECUTE 'INSERT INTO public.projects (user_id, title, paid_status) VALUES ($1, $2, $3)'
      USING s.user_b, 'planted', 'fully_paid'::public.paid_status;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  EXECUTE 'SELECT count(*) FROM public.projects WHERE title = ''planted''' INTO n;
  EXECUTE 'RESET ROLE';
  IF NOT raised OR n <> 0 THEN
    RAISE EXCEPTION 'FAIL 18: client created a project for another user (rejected=% rows=%)', raised, n;
  END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 18: cross-user paid project INSERT rejected, no row created';

  -- 19. CONTROL: owner UPDATE/DELETE of their own project still works, and an
  --     UPDATE may not smuggle billing state back in.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.user_a::text, false);
  EXECUTE 'UPDATE public.projects SET title = ''renamed-again'', paid_status = ''fully_paid'' WHERE id = $1'
    USING (SELECT id FROM public.projects WHERE title = 'honest-create');
  EXECUTE 'SELECT paid_status FROM public.projects WHERE title = ''renamed-again''' INTO status;
  raised := false;
  BEGIN
    EXECUTE 'DELETE FROM public.projects WHERE title = ''renamed-again''';
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  EXECUTE 'SELECT count(*) FROM public.projects WHERE title = ''renamed-again''' INTO n;
  EXECUTE 'RESET ROLE';
  IF status IS DISTINCT FROM 'unpaid' THEN
    RAISE EXCEPTION 'FAIL 19: owner escalated paid_status via UPDATE (stored %)', status;
  END IF;
  IF raised OR n <> 0 THEN
    RAISE EXCEPTION 'FAIL 19b: owner could not delete own project (error=% rows=%)', raised, n;
  END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 19: owner update+delete intact, paid_status still frozen';

  -- 20. TRUSTED BACKEND: service_role may still create a project already paid.
  EXECUTE 'SET ROLE service_role';
  PERFORM set_config('test.role','service_role', false);
  EXECUTE 'INSERT INTO public.projects (user_id, title, paid_status) VALUES ($1, $2, $3)'
    USING s.user_a, 'backend-paid', 'fully_paid'::public.paid_status;
  EXECUTE 'SELECT paid_status FROM public.projects WHERE title = ''backend-paid''' INTO status;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.role','postgres', false);
  IF status IS DISTINCT FROM 'fully_paid' THEN
    RAISE EXCEPTION 'FAIL 20: service_role could not create a paid project (stored %)', status;
  END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 20: service_role paid-state INSERT path intact';

  -- 21. Authorization fact: a client must not be able to grant itself admin.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.role','authenticated', false);
  PERFORM set_config('test.uid', s.user_a::text, false);
  raised := false;
  BEGIN
    EXECUTE 'INSERT INTO public.user_roles (user_id, role) VALUES ($1, ''admin''::public.app_role)'
      USING s.user_a;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  EXECUTE 'SELECT count(*) FROM public.user_roles WHERE user_id = $1 AND role = ''admin''' INTO n USING s.user_a;
  EXECUTE 'RESET ROLE';
  IF NOT raised OR n <> 0 THEN
    RAISE EXCEPTION 'FAIL 21: client self-granted admin (rejected=% rows=%)', raised, n;
  END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 21: client cannot self-grant admin role';

  -- 22. Financial rows: an authenticated client must not be able to mark a
  --     payment collected or an order fulfilled (no UPDATE policy exists).
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.user_a::text, false);
  EXECUTE 'UPDATE public.payments SET status = ''captured'', amount_paise = 1 WHERE user_id = $1' USING s.user_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  EXECUTE 'UPDATE public.orders SET status = ''delivered'', price_platform_paise = 999999 WHERE project_id = $1' USING s.project_a;
  GET DIAGNOSTICS m = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  IF n <> 0 OR m <> 0 THEN
    RAISE EXCEPTION 'FAIL 22: client modified money rows (payments=% orders=%)', n, m;
  END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 22: client cannot update payments or orders rows (0 rows)';

  -- 23-24. The trigger's caller-role boundary is exercised in all four
  --        contexts that matter: anon, authenticated (14-19 above),
  --        service_role (20 above) and the migration/seed context (24 below).
  EXECUTE 'SET ROLE anon';
  PERFORM set_config('test.role','anon', false);
  raised := false;
  BEGIN
    EXECUTE 'INSERT INTO public.projects (user_id, title, paid_status) VALUES ($1, $2, $3)'
      USING s.user_a, 'anon-paid', 'fully_paid'::public.paid_status;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := true;
  END;
  EXECUTE 'SELECT count(*) FROM public.projects WHERE title = ''anon-paid''' INTO n;
  EXECUTE 'RESET ROLE';
  IF NOT raised OR n <> 0 THEN
    RAISE EXCEPTION 'FAIL 23: anon created a paid project (rejected=% rows=%)', raised, n;
  END IF;
  passed := passed + 1; RAISE NOTICE 'PASS 23: anon project INSERT rejected, no row created';

  -- 24. CONTROL: the migration/maintenance context is not frozen, otherwise the
  --     allowlist would break seeds, restores and legitimate backfill.
  EXECUTE 'INSERT INTO public.projects (user_id, title, paid_status) VALUES ($1, $2, $3)'
    USING s.user_b, 'maint-paid', 'base_paid'::public.paid_status;
  EXECUTE 'SELECT paid_status FROM public.projects WHERE title = ''maint-paid''' INTO status;
  IF status IS DISTINCT FROM 'base_paid' THEN
    RAISE EXCEPTION 'FAIL 24: maintenance context could not set paid state (stored %)', status;
  END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.role','postgres', false);
  passed := passed + 1; RAISE NOTICE 'PASS 24: migration/seed context can still set paid state';

  RAISE NOTICE 'STAGE0 RLS TESTS PASSED (%)', passed;
END
$$;
