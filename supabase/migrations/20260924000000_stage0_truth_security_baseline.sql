-- Stage 0 — Truth, Security and Re-Baseline (forward-only hardening).
--
-- This migration tightens the database so it cannot be used to fake the
-- money / RSVP / order paths that the product does not actually implement yet,
-- stops exposing print-partner operational data to anonymous callers, and
-- closes the search_path hijack surface on the SECURITY DEFINER helpers.
--
-- It is ADDITIVE: it never rewrites the historical migrations above it, and it
-- only removes access that a browser client (anon / authenticated keys) should
-- never have had. The trusted backend (service_role) is unaffected.

-- ===========================================================================
-- 1. Financial integrity — a client may never set paid_status on a project.
--    paid_status is a billing state owned by the server. The owner can still
--    edit every other column of their own project under the existing policy;
--    this trigger simply freezes the money field for browser roles.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.protect_paid_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Only freeze the field for requests that originate from a browser key.
  -- service_role and non-JWT contexts (migrations, seeds, maintenance) keep
  -- full control of the billing state.
  IF auth.role() IN ('anon', 'authenticated') THEN
    NEW.paid_status := OLD.paid_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_paid_status_guard ON public.projects;
CREATE TRIGGER projects_paid_status_guard
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.protect_paid_status();

-- ===========================================================================
-- 2. RSVP — no authenticated token-based RSVP flow exists yet, so an anonymous
--    caller must not be able to mutate guest rows (rsvp_status, contact data,
--    even project_id) merely by guessing/holding a token. Remove the write path.
-- ===========================================================================
DROP POLICY IF EXISTS "Public RSVP via token" ON public.guests;

-- ===========================================================================
-- 3. Payments & print orders — these are backend/service_role facts, not
--    something a client may insert. Owner/ admin read-only policies are kept so
--    users can still see their own orders/payments.
-- ===========================================================================
DROP POLICY IF EXISTS "Users create orders" ON public.orders;
DROP POLICY IF EXISTS "Users create payments" ON public.payments;

-- ===========================================================================
-- 4. Print partners — api_endpoint / contact / payment_terms are operational
--    secrets and must not be readable by anonymous users. Admins retain full
--    access via the existing "Admins manage printers" policy.
-- ===========================================================================
DROP POLICY IF EXISTS "Public read active printers" ON public.printers;

-- ===========================================================================
-- 5. Activity logs are a server-side audit trail. A client must not be able to
--    forge entries (including pointing them at another project_id). Writes are
--    service_role-only now; admins keep read access.
-- ===========================================================================
DROP POLICY IF EXISTS "Authenticated insert own logs" ON public.activity_logs;
DROP POLICY IF EXISTS "System insert logs" ON public.activity_logs;

-- ===========================================================================
-- 6. Harden SECURITY DEFINER helpers — pin an empty search_path (so a hostile
--    role cannot shadow referenced objects) and schema-qualify every name.
--    Behaviour is otherwise identical, so the signup trigger keeps working.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_project_owner(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = _project_id AND user_id = _user_id
  );
END;
$$;

-- Preserve auto-profile / default-role creation on signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'name', ''));
  INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user'::public.app_role);
  RETURN NEW;
END;
$$;

-- ===========================================================================
-- 7. Least-privilege EXECUTE on the definers. RLS expressions run as the
--    querying role, so authenticated needs the two predicates; anonymous and
--    PUBLIC do not, and the signup trigger is invoked internally only.
-- ===========================================================================
REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.is_project_owner(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_project_owner(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_paid_status() FROM PUBLIC, anon, authenticated;