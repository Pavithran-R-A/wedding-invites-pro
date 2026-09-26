-- ===========================================================================
-- Stage 3 §3 follow-up — close the one-draft-per-wedding invariant
--
-- Forward repair. File 20260926120000 installed an AFTER INSERT trigger that makes
-- the draft exist inside the statement that makes the wedding, and it disclosed, in
-- its own header, the one hole it left:
--
--   "it does NOT say a draft can never disappear. `owners_manage_own_draft` gives
--    the owner DELETE on its own rows, Stage 2 chose that deliberately, and a guard
--    refusing client deletes here would break the wedding-level cascade..."
--
-- That sentence was true when it was written and is false after this file, which is
-- why the earlier file is not edited (migrations are history) and the correction is
-- recorded here instead. The residual is closed, not restated: a browser may not
-- delete a draft, may not insert one, and therefore cannot leave a wedding
-- undrafted. The invariant is now total for every operation a customer can perform
-- through the API.
--
-- ---------------------------------------------------------------------------
-- THE CASCADE CLAIM WAS WRONG, AND THAT IS WHY THIS FILE IS SAFE TO WRITE
-- ---------------------------------------------------------------------------
--
-- The reasoning above feared that refusing client DELETE would break
-- wedding-cascade cleanup. Stage 2's own suite had already measured the fact that
-- defeats that fear (`supabase/tests/stage2/20_attacks.sql` group 11, and the
-- comment in file 20260925120000): a foreign-key cascade is executed as the *child
-- table's owner*, not as the role that deleted the parent, so a BEFORE DELETE guard
-- sees a trusted role and lets the row go. A cascade therefore never needed the
-- owner's DELETE privilege, and revoking it cannot break one. Test F in
-- supabase/tests/stage3/20_draft_invariant.sql re-measures it here rather than
-- trusting this paragraph; the overstatement is what the test exists to keep honest.
--
-- ---------------------------------------------------------------------------
-- WHY THE TRIGGER MUST BECOME SECURITY DEFINER IN THE SAME BREATH
-- ---------------------------------------------------------------------------
--
-- File 20260926120000 chose SECURITY INVOKER deliberately, so that the draft INSERT
-- was authorised by the caller's own row-level-security policy. That authorisation
-- mechanism is `owners_manage_own_draft` — the policy this file drops. Left INVOKER,
-- the trigger would insert as `authenticated` with no INSERT policy and no INSERT
-- grant, so every wedding creation in the product would start failing. The two
-- changes are therefore one change, and their order below matters.
--
-- The privilege it now runs with is the narrowest one that answers the concern
-- Stage 2 raised about DEFINER functions:
--   * it lives in `private`, so it is not a callable surface at all — a trigger
--     function is invoked by the executor of the triggering statement and needs no
--     EXECUTE grant for that (which is why file 20260926120000 could revoke EXECUTE
--     from an INVOKER version and still have the trigger fire; the revoke is
--     re-asserted below because it, not the grant, is what keeps `private` closed to
--     callers),
--   * `search_path` is pinned empty and the one relation it touches is written in
--     full, so an attacker-controlled search path has nothing to resolve,
--   * it reads `NEW.id` and writes `wedding_id`. It takes no argument from the
--     caller, branches on no session state, and touches no column a client could
--     steer, so the surface the DEFINER privilege can be talked into is one INSERT of
--     one default-valued row,
--   * EXECUTE stays revoked from PUBLIC, anon and authenticated, so the only way to
--     run it is to insert into `public.weddings`.
--
-- There is precedent in this schema for exactly this shape: `private.handle_new_user`
-- is a SECURITY DEFINER trigger function, revoked from the API roles, whose place in
-- the DEFINER inventory is asserted by Stage 2's catalogue check C26. This file adds
-- one name to that list, and the suite that owns the list is where it has to appear.
--
-- ---------------------------------------------------------------------------
-- WHAT REMAINS ALLOWED, AND WHY THAT IS THE RIGHT RESIDUAL
-- ---------------------------------------------------------------------------
--
--   * the owner SELECTs and UPDATEs its draft — the editing surface needs both, and
--     neither can create or destroy the row;
--   * deleting the wedding still removes its draft, through the FK cascade, because
--     a wedding and its draft are one aggregate and deleting the aggregate is a
--     documented owner right (file 20260925120500);
--   * a trusted role (postgres, service_role) can still delete a draft directly,
--     because support repair and future erasure work have to be possible. That is a
--     different claim from "no allowed browser operation can leave a wedding
--     undrafted", and the tests assert the second one, not the first.
-- ===========================================================================

-- 1. The trigger function becomes DEFINER before the caller loses the right that
--    made INVOKER viable. CREATE OR REPLACE keeps the trigger definition attached:
--    `weddings_have_draft` points at the function by name, so replacing the body
--    swaps the privilege without a DROP/CREATE window in which a wedding could be
--    created undrafted.
CREATE OR REPLACE FUNCTION private.attach_draft_on_wedding_create() RETURNS trigger
LANGUAGE plpgsql
-- Pinned like every other function in this schema: the body is fully qualified, so
-- an attacker-controlled search_path has nothing to resolve.
     SET search_path = ''
-- SECURITY DEFINER: its caller is no longer allowed to insert the row it inserts.
-- Deliberately not `secdef`-with-a-loose grant list; the REVOKE below is what keeps
-- it unreachable except as a trigger.
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.invitation_drafts (wedding_id)
  VALUES (NEW.id)
  ON CONFLICT (wedding_id) DO NOTHING;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.attach_draft_on_wedding_create()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.attach_draft_on_wedding_create() IS
  'AFTER INSERT trigger on public.weddings: guarantees the one-draft-per-wedding '
  'invariant inside the creating transaction. SECURITY DEFINER since the draft '
  'INSERT is no longer something the calling role may perform for itself.';

-- 2. Drafts are written by the schema, edited by the owner, and created or destroyed
--    by neither the owner nor any other browser role.
REVOKE INSERT, DELETE ON public.invitation_drafts FROM anon, authenticated;

-- 3. The policies that authorised those two commands go with them. Leaving an
--    INSERT/DELETE policy on a table no browser role can write would be a door that
--    opens onto a wall — harmless today, and a standing invitation to re-grant the
--    privilege that makes it live. UPDATE keeps its own policy (it always had one);
--    SELECT keeps `owners_read_own_draft`.
DROP POLICY IF EXISTS owners_manage_own_draft ON public.invitation_drafts;
DROP POLICY IF EXISTS owners_delete_own_draft ON public.invitation_drafts;

COMMENT ON TABLE public.invitation_drafts IS
  'The working invitation document. Created and destroyed by the database, alongside '
  'its wedding; readable and editable by its owner; never INSERTed or DELETEd by a '
  'browser role (file 20260926120000 installs the pairing, this file closes it).';
