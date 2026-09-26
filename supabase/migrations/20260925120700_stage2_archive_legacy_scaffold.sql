-- Stage 2 / file 8 of 9 — retire the Lovable-era scaffold into a non-exposed schema.
--
-- Nothing is deleted. Every row stays where it is so that a question asked in
-- six months ("did anyone ever pay us?") still has a primary source. What is
-- removed is *reachability*: the policies and triggers that made these tables part
-- of the application's contract, and every privilege that let an API role name them.
--
-- The tables move as one island because they reference each other: `projects` is
-- the referenced side for `guests`, `orders` and `activity_logs`, and `templates`
-- is referenced by `projects`. Moving a subset would strand a foreign key pointing
-- across schemas at a table whose privileges were just closed.

-- ===========================================================================
-- 1. Drop the policies that made this surface part of the product
-- ===========================================================================
--
-- Each of these is a Stage 0/1 guarantee about `public.projects`, and the
-- guarantee itself survives: it is simply no longer expressed as a policy on a
-- table the API cannot reach. The Stage 2 suite re-asserts every one of them
-- against the canonical schema (see docs/architecture/stage-2-migration-plan.md
-- section 8 for the per-assertion mapping).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname::text AS table_name, pol.polname::text AS policy_name
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('projects', 'templates', 'guests', 'orders',
                         'payments', 'printers', 'activity_logs')
     ORDER BY c.relname, pol.polname
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policy_name, r.table_name);
    RAISE NOTICE 'retired legacy policy: public.% %', r.table_name, r.policy_name;
  END LOOP;
END
$$;

-- ===========================================================================
-- 2. Drop the triggers, then the functions they alone kept alive
-- ===========================================================================
--
-- Dropped here rather than in step 9 because a function may not be removed while a
-- trigger still depends on it, and the trigger's table is about to change schema.
-- `protect_paid_status` and the projects updated_at mechanism have no other
-- consumer; the canonical tables use private.touch_updated_at() instead.

DROP TRIGGER IF EXISTS projects_paid_status_guard ON public.projects;
DROP TRIGGER IF EXISTS update_projects_updated_at ON public.projects;

-- ===========================================================================
-- 3. Move the island
-- ===========================================================================
--
-- Referencing tables first, so no foreign key ever spends an instant pointing at a
-- schema it cannot resolve.

ALTER TABLE public.guests SET SCHEMA legacy;
ALTER TABLE public.orders SET SCHEMA legacy;
ALTER TABLE public.payments SET SCHEMA legacy;
ALTER TABLE public.activity_logs SET SCHEMA legacy;
ALTER TABLE public.printers SET SCHEMA legacy;
ALTER TABLE public.projects SET SCHEMA legacy;
ALTER TABLE public.templates SET SCHEMA legacy;

-- The enum types exist only to type those columns. Leaving them in `public` would
-- put `paid_status` and `payment_status` in the schema inventory of a product that
-- has no billing column and no payments model.
ALTER TYPE public.paid_status SET SCHEMA legacy;
ALTER TYPE public.rsvp_status SET SCHEMA legacy;
ALTER TYPE public.order_status SET SCHEMA legacy;
ALTER TYPE public.payment_status SET SCHEMA legacy;

-- `app_role` stays in public: public.user_roles still uses it.

-- ===========================================================================
-- 4. Pin the archived money rows
-- ===========================================================================
--
-- `payments.user_id` arrived as ON DELETE CASCADE, so deleting an auth account
-- destroyed the record that account ever paid us — the one thing a financial
-- archive exists to keep. Nothing in the product can reach this schema any more,
-- but a maintenance session and a future migration can, and neither should have
-- to remember to look here first.
--
-- NO ACTION rather than RESTRICT because a real cleanup deletes the payments and
-- the account in one statement; RESTRICT is checked as each row goes and would
-- refuse that even when the referencing rows are in the same statement.
--
-- `legacy.projects` → `legacy.orders` is deliberately left CASCADE and recorded
-- that way in the migration plan: an order row carries no money of its own, so
-- that cascade moves scaffolding rather than financial history, and Stage 13's
-- retention decision owns the difference.
ALTER TABLE legacy.payments DROP CONSTRAINT payments_user_id_fkey;
ALTER TABLE legacy.payments
  ADD CONSTRAINT payments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE NO ACTION;

COMMENT ON CONSTRAINT payments_user_id_fkey ON legacy.payments IS
  'Archived money: an account deletion must fail loudly rather than erase payment history.';

-- ===========================================================================
-- 5. Close the schema
-- ===========================================================================

REVOKE ALL ON ALL TABLES IN SCHEMA legacy FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA legacy FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA legacy FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SCHEMA legacy FROM PUBLIC, anon, authenticated, service_role;

-- The archive is written by migrations only. Revoking from service_role is the
-- difference between "archived" and "still reachable by whoever holds the server
-- key", and a future stage cannot quietly start reading it without a migration.

COMMENT ON SCHEMA legacy IS
  'Pre-Stage-2 scaffold, retained for evidence. No API role may read or write it. '
  'Contents are not product truth and must never be reinterpreted as such.';

-- ===========================================================================
-- 6. Public surface check, stated as an assertion rather than a hope
-- ===========================================================================
--
-- If any pre-canonical table survived in public, fail the migration here instead of
-- letting a later stage build on a half-moved schema.
DO $$
DECLARE
  leftover text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO leftover
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN ('projects', 'templates', 'guests', 'orders',
                       'payments', 'printers', 'activity_logs');
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 2 archive incomplete: % still in public', leftover;
  END IF;
END
$$;
