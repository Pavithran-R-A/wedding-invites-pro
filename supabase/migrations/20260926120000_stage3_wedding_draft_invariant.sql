-- ===========================================================================
-- Stage 3 §3 — the wedding/draft creation invariant
--
-- Stage 2 disclosed the gap in its own words
-- (docs/audits/stage-2-domain-database.md §25 limitation 2): the domain says
-- every wedding has exactly one draft, the migration path honoured that for
-- historical rows (M31/M32), but `createWedding()` inserted only a `weddings`
-- row. So a wedding made through the product had no draft, and the invariant
-- lived in a document rather than in the database.
--
-- Three repairs were compared. The evidence, and why the first one won:
--
--   A. an AFTER INSERT trigger creates the draft alongside the wedding.
--      Atomicity is the database's, not the caller's: the trigger runs inside
--      the same statement and transaction as the wedding INSERT, so a draft
--      that cannot be written takes the wedding with it. Every present and
--      future path that creates a wedding inherits it — the app, a backfill, a
--      support repair, a seed — which is the whole reason an invariant belongs
--      in a schema. Authorization stays with the row's owner: the function is
--      SECURITY INVOKER, so the draft INSERT is checked against
--      `owners_manage_own_draft` as the calling role, exactly like the
--      `private.reject_client_*` guards Stage 2 already proved fire for
--      `authenticated` clients. No new privilege is introduced anywhere.
--   B. an application transaction, or an RPC that creates both rows.
--      Rejected. PostgREST gives a browser no multi-statement transaction, so
--      "atomically" here can only mean a SECURITY DEFINER RPC — which is a new
--      function reachable by API roles (Stage 2's C29 exists to keep `public`
--      function-free, and the measured default-privilege behaviour recorded in
--      file 20260925120000 is that a created function's EXECUTE-to-PUBLIC is
--      layered on top of the stored default list rather than replaced by it),
--      plus a second copy of the ownership check written in PL/pgSQL that can
--      now disagree with the RLS policy it is supposed to mirror. And it
--      protects only the one caller that happens to use it.
--   C. create the draft lazily when the editor first opens.
--      Rejected outright. The invariant would be enforced by whoever remembers
--      to call it, a read would become a write, and a wedding could exist in a
--      state the domain calls invalid — which is precisely the class of thing
--      Stage 2's report says must not be left in prose.
--
-- `ON CONFLICT DO NOTHING` is not laziness about duplicates. A conflict needs a
-- draft whose `wedding_id` already exists, and `invitation_drafts.wedding_id` is
-- a NOT NULL foreign key to `weddings`, so no row can precede its own wedding:
-- for a trigger firing on that wedding's INSERT the conflict is unrepresentable.
-- Refusing to swallow it anyway would mean that a bookkeeping row invisible to
-- the customer can fail the customer's create. Duplicate protection is the
-- UNIQUE constraint's job and stays there; the paired invariant is asserted by
-- name in supabase/tests/stage3/20_draft_invariant.sql rather than trusted.
--
-- What this guarantee does and does not say, stated exactly:
--   * every wedding created from now on has its draft when the creating
--     statement returns — including under a failing draft write, which rolls the
--     wedding back with it;
--   * no wedding ever has a second draft (the UNIQUE constraint, which this file
--     does not touch);
--   * it does NOT say a draft can never disappear. `owners_manage_own_draft`
--     gives the owner DELETE on its own rows, Stage 2 chose that deliberately,
--     and a guard refusing client deletes here would break the wedding-level
--     cascade that group 11 of the Stage 2 attack suite proves an owner is
--     entitled to (a cascade deletes as the child table's owner, which is the
--     measured reason role-name guards were rejected as an immutability
--     mechanism). So an owner who deletes its own draft is exercising a
--     documented right, and the editing surface must recreate it on next write.
--     That residual is tested, not assumed, in the Stage 3 suite.
--
-- Historical weddings keep the drafts the migration gave them. This trigger is
-- installed after file 20260925120600, so it never fired for them and cannot
-- double-create; the two mechanisms are separated in time, not racing each other.
--
-- Forward-only and additive: no table, column, policy, grant or constraint of an
-- earlier migration is altered. The one REVOKE below concerns this file's own new
-- function, and it is required by the project rule written into file
-- 20260925120000 — "a function that is created anywhere except `auth` is
-- followed by an explicit REVOKE" — because default privileges cannot provide it.
-- ===========================================================================

CREATE FUNCTION private.attach_draft_on_wedding_create() RETURNS trigger
LANGUAGE plpgsql
-- Pinned like every other function in this schema: the trigger body is fully
-- qualified, so an attacker-controlled search_path has nothing to resolve.
     SET search_path = ''
-- Explicitly not SECURITY DEFINER: this writes on behalf of the wedding's own
-- owner, and the owner's RLS policies are the correct authority for it.
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO public.invitation_drafts (wedding_id)
  VALUES (NEW.id)
  ON CONFLICT (wedding_id) DO NOTHING;
  RETURN NEW;
END $$;

-- The measured rule, not a stylistic one: without this line the function carries
-- the implicit EXECUTE-to-PUBLIC that `ALTER DEFAULT PRIVILEGES ... REVOKE ALL ON
-- FUNCTIONS FROM PUBLIC` does not remove, and Stage 2's C30 ("anon and
-- authenticated cannot execute anything in private") would be false.
REVOKE ALL ON FUNCTION private.attach_draft_on_wedding_create()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.attach_draft_on_wedding_create() IS
  'AFTER INSERT trigger on public.weddings: guarantees the one-draft-per-wedding '
  'invariant inside the creating transaction. SECURITY INVOKER, so the draft row '
  'is written under the caller''s own row-level-security policies.';

CREATE TRIGGER weddings_have_draft
  AFTER INSERT ON public.weddings
  FOR EACH ROW
  EXECUTE FUNCTION private.attach_draft_on_wedding_create();
