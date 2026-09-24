-- Baseline SNAPSHOT (informational, NOT an assertion suite).
-- Run against the schema built from ONLY the two original migrations (no
-- Stage 0 hardening). It REPORTS what an anonymous / authenticated browser
-- caller can actually do, so the Stage 0 write-up states the "before" picture
-- truthfully — including any issue that turns out to be latent rather than
-- directly exploitable. Every case is exception-guarded so the probe always
-- completes; nothing here should be read as "validated against Supabase Cloud".

DO $$
DECLARE
  user_a   uuid := gen_random_uuid();
  proj_a   uuid := gen_random_uuid();
  guest_id uuid := gen_random_uuid();
  tok      text := 'tok-' || gen_random_uuid()::text;
  prn      uuid := gen_random_uuid();
  n        integer;
  st       public.paid_status;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (user_a, 'a@example.test');
  INSERT INTO public.projects (id, user_id, title, paid_status)
    VALUES (proj_a, user_a, 'Asha', 'unpaid'::public.paid_status);
  INSERT INTO public.guests (id, project_id, name, token)
    VALUES (guest_id, proj_a, 'Guest', tok);
  INSERT INTO public.printers (id, name, api_endpoint, active)
    VALUES (prn, 'Print Mart', 'https://partner.example/secret', true);

  -- (A) Anonymous token-only RSVP write.
  BEGIN
    EXECUTE 'SET ROLE anon';
    PERFORM set_config('test.role','anon', false);
    EXECUTE 'UPDATE public.guests SET rsvp_status = ''attending'' WHERE token = $1' USING tok;
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    IF n > 0 THEN
      RAISE NOTICE 'BASELINE A (anon RSVP write): OPEN — % row(s) updated', n;
    ELSE
      RAISE NOTICE 'BASELINE A (anon RSVP write): not directly effective — 0 rows, because anon has no guests SELECT policy making rows visible to an updater; the "Public RSVP via token" grant is nevertheless an over-broad anonymous write path and is removed defensively in Stage 0.';
    END IF;
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    RAISE NOTICE 'BASELINE A (anon RSVP write): BLOCKED by %', SQLERRM;
  END;

  -- (B) Owner self-escalating paid_status (billing state) via the CRUD policy.
  BEGIN
    EXECUTE 'SET ROLE authenticated';
    PERFORM set_config('test.role','authenticated', false);
    PERFORM set_config('test.uid', user_a::text, false);
    EXECUTE 'UPDATE public.projects SET paid_status = ''fully_paid'' WHERE id = $1' USING proj_a;
    EXECUTE 'SELECT paid_status FROM public.projects WHERE id = $1' INTO st USING proj_a;
    EXECUTE 'RESET ROLE';
    IF st = 'fully_paid' THEN
      RAISE NOTICE 'BASELINE B (client paid_status): OPEN — owner self-set paid_status to fully_paid';
    ELSE
      RAISE NOTICE 'BASELINE B (client paid_status): contained (still %)', st;
    END IF;
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    RAISE NOTICE 'BASELINE B (client paid_status): BLOCKED by %', SQLERRM;
  END;

  -- (C) Client inserting a payment row directly.
  BEGIN
    EXECUTE 'SET ROLE authenticated';
    PERFORM set_config('test.uid', user_a::text, false);
    EXECUTE 'INSERT INTO public.payments (order_id, user_id, amount_paise) VALUES (NULL, $1, 1)' USING user_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    IF n > 0 THEN
      RAISE NOTICE 'BASELINE C (client payment INSERT): OPEN — % row(s) inserted', n;
    ELSE
      RAISE NOTICE 'BASELINE C (client payment INSERT): not effective (0 rows)';
    END IF;
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    RAISE NOTICE 'BASELINE C (client payment INSERT): BLOCKED by %', SQLERRM;
  END;

  -- (D) Anonymous read of printer operational data (api_endpoint etc.).
  BEGIN
    EXECUTE 'SET ROLE anon';
    PERFORM set_config('test.role','anon', false);
    EXECUTE 'SELECT count(*) FROM public.printers WHERE api_endpoint IS NOT NULL' INTO n;
    EXECUTE 'RESET ROLE';
    IF n > 0 THEN
      RAISE NOTICE 'BASELINE D (anon printer read): OPEN — anon saw % row(s) incl. api_endpoint', n;
    ELSE
      RAISE NOTICE 'BASELINE D (anon printer read): contained (0 rows)';
    END IF;
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    RAISE NOTICE 'BASELINE D (anon printer read): BLOCKED by %', SQLERRM;
  END;

  RAISE NOTICE 'BASELINE SNAPSHOT COMPLETE (see lines above for the real pre-hardening state)';
END
$$;
