-- Stage 0 repair — paid_status must be server-authoritative on INSERT as well
-- as UPDATE.
--
-- Independent review of the published Stage 0 baseline found that
-- 20260924000000_stage0_truth_security_baseline.sql froze paid_status only on
-- UPDATE (BEFORE UPDATE trigger + the RLS WITH CHECK that merely tests
-- ownership). The pre-existing "Users CRUD own projects" policy is FOR ALL, so
-- its WITH CHECK let an authenticated browser client INSERT a brand new
-- project already marked as paid. Reproduced against the published schema:
--
--   CASE 1 fully_paid INSERT: VULNERABLE — row created and stored as fully_paid
--   CASE 2 base_paid  INSERT: VULNERABLE — row created and stored as base_paid
--   CASE 3 NULL paid_status : ACCEPTED — stored as <null>
--
-- This migration closes that by (1) replacing the single broad policy with
-- operation-specific policies whose INSERT check pins the billing state, and
-- (2) widening the guard trigger to INSERT so the boundary holds even if a
-- future policy forgets to. The trusted backend (service_role) is unchanged.
--
-- Historical migrations, including the published Stage 0 baseline, are not
-- rewritten.

-- ===========================================================================
-- 1. Operation-specific project policies.
--    Ownership scoping is byte-for-byte the same predicate as the policy it
--    replaces (auth.uid() = user_id), so nothing is broadened; the only change
--    is that INSERT additionally requires the row to be created unpaid.
--    A client that omits paid_status is unaffected — the column DEFAULT
--    'unpaid' supplies the value before WITH CHECK is evaluated.
-- ===========================================================================
DROP POLICY IF EXISTS "Users CRUD own projects" ON public.projects;

CREATE POLICY "Owners read own projects" ON public.projects
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Owners create own unpaid projects" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND paid_status = 'unpaid');

CREATE POLICY "Owners update own projects" ON public.projects
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners delete own projects" ON public.projects
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ===========================================================================
-- 2. Guard trigger now covers INSERT as well as UPDATE.
--
--    Role boundary: a trigger function is SECURITY INVOKER, so current_user is
--    the role actually executing the statement (Supabase runs each API request
--    under anon / authenticated / service_role via SET LOCAL ROLE). This is a
--    plain PostgreSQL role check rather than the discouraged auth.role()-style
--    JWT-claim authorization, and it fails closed: anything not explicitly
--    trusted is treated as an untrusted caller.
--
--    INSERT: a non-trusted caller may only create an unpaid row. The attempt is
--    REJECTED rather than silently rewritten to unpaid, because normalising the
--    value would hide a client (or integrator) bug that is trying to mint paid
--    state. ERRCODE is deliberately insufficient_privilege (42501) so the
--    failure looks identical whether the RLS policy or this trigger catches it,
--    which also removes any dependence on the order the two are evaluated in.
--
--    UPDATE: unchanged behaviour — the stored value is preserved regardless of
--    what the caller asked for.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.protect_paid_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('service_role', 'supabase_admin', 'postgres') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.paid_status IS DISTINCT FROM 'unpaid'::public.paid_status THEN
      RAISE EXCEPTION 'client role % may not create a project with paid_status %; only the trusted backend may set billing state',
        current_user, coalesce(NEW.paid_status::text, 'NULL')
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.paid_status := OLD.paid_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_paid_status_guard ON public.projects;
CREATE TRIGGER projects_paid_status_guard
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.protect_paid_status();

-- No browser role needs to execute the guard directly.
REVOKE ALL ON FUNCTION public.protect_paid_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_paid_status() TO service_role;
