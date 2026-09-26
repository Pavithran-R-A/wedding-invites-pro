-- Local Postgres bootstrap that reproduces ONLY the pieces of the Supabase
-- hosting layer the migrations depend on (auth schema, the three API roles,
-- auth.uid()/auth.role(), and default grants). This lets the real migration
-- SQL run unmodified against a throwaway Postgres container for RLS testing.
-- It is a test fixture, not a production setup, and is never applied remotely.

-- ---------------------------------------------------------------------------
-- API roles (NOLOGIN; we reach them via SET ROLE in the tests)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$$;
-- The trusted backend bypasses RLS, exactly as Supabase configures service_role.
ALTER ROLE service_role BYPASSRLS;

-- Let the test login role switch into the API roles.
GRANT anon, authenticated, service_role TO postgres;

-- ---------------------------------------------------------------------------
-- auth schema + minimal users table the signup trigger writes against
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- auth.uid()/auth.role() normally read JWT claims. Here they read session GUCs
-- so a test can impersonate a caller with:  SET test.uid = '<uuid>'; SET test.role = 'authenticated';
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('test.uid', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('test.role', true), ''), 'anon')
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The `extensions` schema Supabase ships, with the one extension a migration
-- actually calls. Stage 3's token minting and lookup run
-- `extensions.gen_random_bytes` / `extensions.digest`, and a plpgsql body resolves
-- those names at first execution, so without this line the whole Stage 2 chain
-- still applies cleanly and the Stage 3 suite then dies on a missing schema —
-- which would read like a code failure and is a fixture gap. The local Supabase
-- image has this already, which is exactly why the shim has to say it out loud.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Default privileges so tables the migrations create (owned by postgres) are
-- reachable by the API roles; RLS — not table grants — is the gate under test.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
