-- Pre-fix / post-fix probe for the paid-state INSERT bypass.
--
-- This script is INFORMATIONAL: it never RAISEs, so it can be executed against
-- a vulnerable schema and against a repaired schema and report what actually
-- happened. Run it via supabase/tests/rls/run-repro.sh.
--
-- It answers one question: can a browser-authenticated client create a project
-- that carries trusted billing state (base_paid / fully_paid) straight through
-- the API, bypassing any payment?
--
-- Each case is attempted as role `authenticated` with auth.uid() set to the
-- attacker's own user id, exactly as PostgREST would issue it.

SET client_min_messages = notice;

DO $$
DECLARE
  user_a   uuid;
  user_b   uuid;
  status   text;
  rows     integer;
  err_state text;
  err_msg  text;
BEGIN
  user_a := gen_random_uuid();
  user_b := gen_random_uuid();

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (user_a, 'attacker@example.test', '{}'::jsonb),
         (user_b, 'victim@example.test',  '{}'::jsonb);

  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.role', 'authenticated', false);
  PERFORM set_config('test.uid', user_a::text, false);

  -- Case 1: explicit fully_paid on INSERT of own project.
  err_state := NULL; err_msg := NULL;
  BEGIN
    EXECUTE 'INSERT INTO public.projects (user_id, title, paid_status) VALUES ($1, $2, $3)'
      USING user_a, 'Malicious paid project', 'fully_paid'::public.paid_status;
    GET DIAGNOSTICS rows = ROW_COUNT;
    EXECUTE 'SELECT coalesce(paid_status::text, ''<null>'') FROM public.projects
              WHERE user_id = $1 AND title = $2' INTO status USING user_a, 'Malicious paid project';
    IF status = 'fully_paid' THEN
      RAISE NOTICE 'CASE 1 fully_paid INSERT: VULNERABLE — row created and stored as %', status;
    ELSIF status = 'unpaid' THEN
      RAISE NOTICE 'CASE 1 fully_paid INSERT: NORMALISED — stored as % (not rejected)', status;
    ELSE
      RAISE NOTICE 'CASE 1 fully_paid INSERT: stored as % — inspect', status;
    END IF;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
    RAISE NOTICE 'CASE 1 fully_paid INSERT: REJECTED (SQLSTATE %) — no row created', err_state;
  END;

  -- Case 2: explicit base_paid on INSERT of own project.
  err_state := NULL; err_msg := NULL;
  BEGIN
    EXECUTE 'INSERT INTO public.projects (user_id, title, paid_status) VALUES ($1, $2, $3)'
      USING user_a, 'Malicious base project', 'base_paid'::public.paid_status;
    EXECUTE 'SELECT coalesce(paid_status::text, ''<null>'') FROM public.projects
              WHERE user_id = $1 AND title = $2' INTO status USING user_a, 'Malicious base project';
    IF status = 'base_paid' THEN
      RAISE NOTICE 'CASE 2 base_paid INSERT: VULNERABLE — row created and stored as %', status;
    ELSIF status = 'unpaid' THEN
      RAISE NOTICE 'CASE 2 base_paid INSERT: NORMALISED — stored as % (not rejected)', status;
    ELSE
      RAISE NOTICE 'CASE 2 base_paid INSERT: stored as % — inspect', status;
    END IF;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
    RAISE NOTICE 'CASE 2 base_paid INSERT: REJECTED (SQLSTATE %) — no row created', err_state;
  END;

  -- Case 3: NULL paid_status explicitly.
  err_state := NULL;
  BEGIN
    EXECUTE 'INSERT INTO public.projects (user_id, title, paid_status) VALUES ($1, $2, NULL)'
      USING user_a, 'Null paid project';
    EXECUTE 'SELECT coalesce(paid_status::text, ''<null>'') FROM public.projects
              WHERE user_id = $1 AND title = $2' INTO status USING user_a, 'Null paid project';
    RAISE NOTICE 'CASE 3 NULL paid_status INSERT: ACCEPTED — stored as %', status;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
    RAISE NOTICE 'CASE 3 NULL paid_status INSERT: REJECTED (SQLSTATE %)', err_state;
  END;

  -- Case 4: legitimate create path (paid_status omitted).
  err_state := NULL;
  BEGIN
    EXECUTE 'INSERT INTO public.projects (user_id, title) VALUES ($1, $2)'
      USING user_a, 'Honest unpaid project';
    EXECUTE 'SELECT coalesce(paid_status::text, ''<null>'') FROM public.projects
              WHERE user_id = $1 AND title = $2' INTO status USING user_a, 'Honest unpaid project';
    IF status = 'unpaid' THEN
      RAISE NOTICE 'CASE 4 legitimate create: WORKS — stored as %', status;
    ELSE
      RAISE NOTICE 'CASE 4 legitimate create: UNEXPECTED — stored as %', status;
    END IF;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
    RAISE NOTICE 'CASE 4 legitimate create: BROKEN (SQLSTATE %: %)', err_state, err_msg;
  END;

  -- Case 5: cross-user create (user_id = victim).
  err_state := NULL;
  BEGIN
    EXECUTE 'INSERT INTO public.projects (user_id, title, paid_status) VALUES ($1, $2, $3)'
      USING user_b, 'Planted for victim', 'fully_paid'::public.paid_status;
    EXECUTE 'SELECT count(*) FROM public.projects WHERE user_id = $1' INTO rows USING user_b;
    RAISE NOTICE 'CASE 5 cross-user INSERT: VULNERABLE — % rows owned by victim', rows;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
    RAISE NOTICE 'CASE 5 cross-user INSERT: REJECTED (SQLSTATE %)', err_state;
  END;

  EXECUTE 'RESET ROLE';

  -- What the trusted backend can still do, for comparison.
  EXECUTE 'SET ROLE service_role';
  PERFORM set_config('test.role', 'service_role', false);
  BEGIN
    EXECUTE 'INSERT INTO public.projects (user_id, title, paid_status) VALUES ($1, $2, $3)'
      USING user_a, 'Backend-paid project', 'fully_paid'::public.paid_status;
    EXECUTE 'SELECT paid_status::text FROM public.projects
              WHERE user_id = $1 AND title = $2' INTO status USING user_a, 'Backend-paid project';
    RAISE NOTICE 'CASE 6 service_role INSERT paid state: ACCEPTED — stored as %', status;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
    RAISE NOTICE 'CASE 6 service_role INSERT paid state: REJECTED (SQLSTATE %) — BACKEND REGRESSION', err_state;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.role', 'postgres', false);
END
$$;
