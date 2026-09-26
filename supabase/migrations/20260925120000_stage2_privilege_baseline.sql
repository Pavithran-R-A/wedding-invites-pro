-- Stage 2, step 1 of 9: schema boundaries and a fail-closed privilege baseline.
--
-- Everything later in Stage 2 depends on this file, so it runs first and creates
-- nothing that holds domain data.
--
-- Two schemas are added alongside `public`:
--   private  server-only implementation details — guard functions, the central
--            updated_at mechanism, hashed access credentials, audit events.
--   legacy   the archived Lovable-era scaffold, moved in step 8. Rows preserved,
--            reachable by no browser role.
--
-- Why the default-privilege work belongs here rather than at the end: Supabase
-- grants `anon`/`authenticated` broad privileges on new `public` tables through
-- *default* privileges, so a table created after this file would otherwise
-- inherit access it was never designed to give. Stage 0 found the same class of
-- problem elsewhere in this project. Revoking the defaults before any canonical
-- table exists means every later grant in step 6 is a decision we made visible,
-- and a future forgotten grant fails closed instead of opening a hole.
--
-- That last sentence holds for tables and sequences. It does not hold for
-- functions, whose implicit PUBLIC EXECUTE cannot be revoked by default
-- privileges at all; see the measured note above the ALTER DEFAULT PRIVILEGES
-- block for the rule that replaces it.

CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS legacy;

-- Nobody but the owner and the trusted backend may even name these schemas.
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA legacy  FROM PUBLIC, anon, authenticated;
REVOKE CREATE ON SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE CREATE ON SCHEMA legacy  FROM PUBLIC, anon, authenticated;

-- service_role is the server-side identity in this design, so it gets USAGE on
-- `private`. It deliberately does *not* get USAGE on `legacy`: an archived scaffold
-- table has no reader in the API surface, backend included. Step 8 closes that
-- schema completely once the data has been carried across.
GRANT USAGE ON SCHEMA private TO service_role;

-- ---------------------------------------------------------------------------
-- Fail-closed defaults — and what they cannot do.
--
-- These statements are the reason a future forgotten GRANT is a *visible* missing
-- grant rather than an open door. Their reach is not uniform, and the difference
-- was measured on this schema rather than assumed (on both engines this stage
-- qualifies against: PostgreSQL 16.15 in the plain-Postgres chains, 17.6 in the
-- Supabase local image):
--
--   TABLES / SEQUENCES   a role created after this point inherits nothing usable by
--                        anon or authenticated. Revoking here is what keeps that
--                        true on a Supabase-managed project, where the platform's
--                        own default privileges *do* name the API roles; on the
--                        plain-Postgres test shim these REVOKEs record no row,
--                        because no default grant names them in the first place.
--                        40_catalog.sql probes both cases with a rolled-back object.
--
--   FUNCTIONS            cannot be made fail-closed this way. `REVOKE ALL ON
--                        FUNCTIONS FROM PUBLIC` inside ALTER DEFAULT PRIVILEGES
--                        changes nothing: a created function's ACL is measured to be
--                        `=X/postgres, postgres=X/postgres, service_role=X/postgres`
--                        even after the revoke, because the implicit EXECUTE-to-PUBLIC
--                        is layered on top of the stored default list rather than
--                        replaced by it. An equivalent revoke written against the
--                        function itself does work (`postgres=X/postgres`, anon not
--                        executable), so the rule for this project is per-object:
--                        a function that is created anywhere except `auth` is
--                        followed by an explicit REVOKE, and 40_catalog.sql asserts
--                        that no non-`auth` function is executable by an API role.
--                        `private` additionally has no schema USAGE for those roles,
--                        which is the outer layer for everything in it.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA legacy
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA legacy
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA legacy
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared guard functions. These live in `private` because no caller outside the
-- database should ever execute them, and because moving them out of `public` is
-- the whole point of ADR-consistent helper placement.
--
-- Both are SECURITY INVOKER on purpose: they only ever *reduce* what the current
-- caller may do, so they must not be able to do anything the caller could not.
-- search_path is pinned empty and every relation is schema-qualified.
-- ---------------------------------------------------------------------------

-- Centralised updated_at mechanism (one function for every table, instead of a
-- copy per table). Never attached to immutable/history rows.
CREATE FUNCTION private.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.touch_updated_at() FROM PUBLIC, anon, authenticated;

-- Rejects writes by browser roles on rows whose values the browser must not be
-- able to assert: immutable snapshots, entitlements, publications, approval
-- records, audit events.
--
-- Trusted identities are recognised by *role*. A trigger function is SECURITY
-- INVOKER, so `current_user` here is the role that issued the statement — which is
-- exactly why this check means something: it cannot be talked into a higher
-- privilege the way a SECURITY DEFINER helper could, because it has none.
--
-- `pg_has_role(..., 'MEMBER')` is used rather than `current_user = 'service_role'`
-- because PostgREST connects with a real database login and then `SET ROLE`s to the
-- API role, so the effective role at trigger time is the API role. Membership is the
-- fact that survives the switch, and it keeps working if a deployment grants the
-- backend identity through a role it owns.
--
-- Membership is tested through `pg_roles`, by oid, rather than by role name:
-- `pg_has_role(user, 'supabase_admin', ...)` raises 42704 when that role does not
-- exist in the cluster, so a name-based test would replace the guard's own refusal
-- with an "invalid role name" error on any deployment that has no Supabase roles.
-- Measured on the local shim: name-based returned 42704 for `authenticated`; the
-- join below returns false. The refusal must come from this function's message.
CREATE FUNCTION private.reject_client_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF current_user = 'postgres' OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles trusted
        WHERE trusted.rolname IN ('service_role', 'supabase_admin')
          AND pg_catalog.pg_has_role(current_user, trusted.oid, 'MEMBER')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'role % may not write %.%: this table is server-authoritative',
    current_user, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION private.reject_client_write() FROM PUBLIC, anon, authenticated;

-- Same idea for DELETE-only protection (append-only comment history).
--
-- Scope, and it is narrower than the message sounds. This fires for a DELETE a
-- client role issues itself. It also *fires* when a cascading foreign key removes
-- the row — measured, not reasoned about: a parent delete by an API role does run
-- the child's BEFORE DELETE trigger — but inside that cascade `current_user` is the
-- child table's *owner*, not the role that deleted the parent, so the trusted branch
-- above returns OLD and the row goes. (PostgreSQL 16.15 and 17.6 both; see the
-- executed case in `supabase/tests/stage2/20_attacks.sql` group 11.)
--
-- So this guard is the backstop for a mistaken grant or policy, and immutability
-- against a cascade has to be an ON DELETE clause instead — which is exactly how the
-- frozen-history tables are written. The same division of labour RLS has here.
CREATE FUNCTION private.reject_client_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF current_user = 'postgres' OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles trusted
        WHERE trusted.rolname IN ('service_role', 'supabase_admin')
          AND pg_catalog.pg_has_role(current_user, trusted.oid, 'MEMBER')) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'role % may not delete from %.%: rows are append-only',
    current_user, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION private.reject_client_delete() FROM PUBLIC, anon, authenticated;

COMMENT ON SCHEMA private IS
  'Server-only implementation details. Never exposed through the data API.';
COMMENT ON SCHEMA legacy IS
  'Archived pre-Stage-2 scaffold. History and evidence, not product truth.';
COMMENT ON FUNCTION private.reject_client_write() IS
  'BEFORE INSERT/UPDATE guard: browser roles may not write server-authoritative rows.';
