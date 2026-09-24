-- Stage 0 RLS / security regression tests.
-- Run AFTER bootstrap + the three migration files, as a superuser (postgres).
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

  RAISE NOTICE 'STAGE0 RLS TESTS PASSED (%)', passed;
END
$$;
