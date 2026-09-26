-- Stage 2 / file 9 of 9 — move the last privileged helpers out of the exposed schema.
--
-- After this file there are no SECURITY DEFINER functions in `public`, and the only
-- definer left in the database is private.handle_new_user(), which exists because
-- the signup trigger must write two tables a customer may not write. Every object
-- removed here had its consumers removed in files 6 and 8 first; nothing is dropped
-- out from under a live policy.

-- ===========================================================================
-- 1. Signup provisioning, relocated
-- ===========================================================================

CREATE FUNCTION private.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name)
    VALUES (NEW.id, coalesce(NEW.raw_user_meta_data ->> 'name', ''));
  INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user'::public.app_role);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.handle_new_user() IS
  'SECURITY DEFINER: provisions account metadata on signup. Not executable from the data API.';

-- No API role executes this: a trigger function is called by the table's writer,
-- and the only writer of auth.users is the Auth service (handled just below).
REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC, anon, authenticated;

-- The Auth service, not PostgREST, inserts into auth.users, so in a real deployment
-- that identity needs EXECUTE. It is absent from the local Postgres shim, hence the
-- guard: this grant is for production roles and must not be a reason the test chain
-- cannot run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION private.handle_new_user() TO supabase_auth_admin';
    RAISE NOTICE 'granted EXECUTE on private.handle_new_user() to supabase_auth_admin';
  ELSE
    RAISE NOTICE 'supabase_auth_admin absent (local shim): EXECUTE grant deferred';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

-- ===========================================================================
-- 2. Retire the superseded public helpers
-- ===========================================================================

-- Replaced by private.touch_updated_at(), which every canonical table shares.
DROP FUNCTION IF EXISTS public.update_updated_at_column();

-- Both existed to answer "is this caller an admin / does this project belong to
-- them" inside policies that have now been dropped or rewritten to read
-- weddings.owner_user_id directly. Keeping them would leave two SECURITY DEFINER
-- predicates executable by any authenticated caller for no reason.
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.is_project_owner(uuid, uuid);

-- Stage 0's paid-state guard protected `projects.paid_status`, a column that no
-- longer exists in the exposed schema. The guarantee it enforced is now carried by
-- structure rather than by code:
--   * public.weddings has no billing column, so there is nothing to escalate to;
--   * public.entitlements is writable only through the server-authoritative path
--     (private.reject_client_write + no INSERT/UPDATE policy + no client grant);
--   * legacy.projects is unreachable by every API role.
-- The Stage 2 suite asserts all three, and file 8 records each historical paid
-- claim in legacy.migration_findings without creating a single entitlement.
DROP FUNCTION IF EXISTS public.protect_paid_status();

-- Re-pointed to private.handle_new_user() above, so this definition is now
-- unreferenced. It is dropped here rather than at the end of the file so the
-- inventory check below describes the finished state instead of a mid-file one.
DROP FUNCTION IF EXISTS public.handle_new_user();

-- ===========================================================================
-- 3. Assert the intended end state, so a future migration cannot quietly regress it
-- ===========================================================================
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prosecdef;
  IF n <> 0 THEN
    RAISE EXCEPTION 'Stage 2 expected no SECURITY DEFINER functions in public, found %', n;
  END IF;

  SELECT count(*) INTO n
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'private' AND p.prosecdef;
  IF n <> 1 THEN
    RAISE EXCEPTION 'Stage 2 expected exactly 1 SECURITY DEFINER function in private, found %', n;
  END IF;

  -- The signup trigger lives on auth.users, so it must be found by function, not by
  -- the table's schema.
  SELECT count(*) INTO n
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal
     AND t.tgfoid = 'private.handle_new_user'::regproc;
  IF n <> 1 THEN
    RAISE EXCEPTION 'signup trigger must be bound to private.handle_new_user on exactly 1 table, found %', n;
  END IF;

  -- Found by name rather than by oid cast: a NULL comparison here would silently
  -- pass once the function is gone, which is not a check at all.
  SELECT count(*) INTO n
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE NOT t.tgisinternal AND ns.nspname = 'public' AND p.proname = 'handle_new_user';
  IF n <> 0 THEN
    RAISE EXCEPTION 'a public handle_new_user is still attached to % table(s)', n;
  END IF;
END
$$;
