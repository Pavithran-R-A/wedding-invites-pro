-- Stage 2 / file 6 of 9 — privileges and row-level security for the canonical domain.
--
-- Order matters and is deliberate: revoke first, then grant only the operations
-- the domain needs, then attach policies. RLS is the second gate, not the first:
-- a role with no table privilege cannot reach a policy at all, and a policy that
-- grants a row does not confer UPDATE on a column set the grant omitted.
--
-- Stage 2 posture (directive Phase 31): **anon gets nothing**. There is no public
-- invitation, guest, RSVP or approval path yet, so there is no anonymous surface
-- to widen and nothing to hand back later under time pressure.

-- ===========================================================================
-- 1. Close the schema's inherited generosity
-- ===========================================================================

-- A hosting layer that hands every new table to every API role by default is the
-- failure this stage exists to remove; the local harness reproduces that default
-- on purpose so this statement has to be load-bearing rather than decorative.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON SCHEMA public FROM anon;

-- ===========================================================================
-- 2. Grants — read the customer's own domain, write only host-owned content
-- ===========================================================================

GRANT SELECT ON
  public.weddings,
  public.wedding_people,
  public.venues,
  public.wedding_events,
  public.invitation_drafts,
  public.invitation_versions,
  public.publications,
  public.guest_households,
  public.household_event_scopes,
  public.rsvp_responses,
  public.approval_requests,
  public.approval_feedback,
  public.wedding_assets,
  public.entitlements,
  public.design_templates,
  public.tradition_packs,
  public.profiles,
  public.user_roles
TO authenticated;

-- Host-editable: the wedding aggregate, its relational parts, the working draft,
-- the guest list and the host's own account record.
GRANT INSERT, UPDATE, DELETE ON
  public.weddings,
  public.wedding_people,
  public.venues,
  public.wedding_events,
  public.invitation_drafts,
  public.guest_households,
  public.household_event_scopes,
  public.rsvp_responses,
  public.wedding_assets,
  public.profiles
TO authenticated;

-- Deliberately absent for every browser role, with no INSERT/UPDATE/DELETE policy
-- to add later by accident:
--   invitation_versions  — immutable once created (file 3 trigger is the backstop)
--   publications         — publishing is a server decision (ADR 0005)
--   approval_requests    — Stage 6 opens the host-initiated request
--   approval_feedback    — a reviewer answers, not the host
--   entitlements         — billing state must not be client-writable, ever
--   design_templates / tradition_packs — platform content
--   user_roles           — authorization facts (signup trigger writes them as owner)

-- ===========================================================================
-- 3. Ownership predicate
-- ===========================================================================

-- Every scoped child uses the same shape: the caller must own the wedding named
-- by *this row's* wedding_id. Because each child already carries wedding_id and
-- is FK-pinned to it, that is one indexed EXISTS per statement rather than a
-- chain of subqueries, and it never reads the table being policy-checked, so
-- there is no recursive-RLS path to reason about.

ALTER TABLE public.weddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_event_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rsvp_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tradition_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- weddings: the aggregate itself needs no EXISTS, its owner column is on the row.
CREATE POLICY owners_read_own_weddings ON public.weddings
  FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);

CREATE POLICY owners_create_own_weddings ON public.weddings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY owners_update_own_weddings ON public.weddings
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY owners_delete_own_weddings ON public.weddings
  FOR DELETE TO authenticated USING (auth.uid() = owner_user_id);

CREATE POLICY owners_read_own_people ON public.wedding_people
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_people.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_manage_own_people ON public.wedding_people
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_people.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_update_own_people ON public.wedding_people
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_people.wedding_id AND w.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_people.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_delete_own_people ON public.wedding_people
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_people.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_read_own_venues ON public.venues
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = venues.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_manage_own_venues ON public.venues
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = venues.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_update_own_venues ON public.venues
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = venues.wedding_id AND w.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = venues.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_delete_own_venues ON public.venues
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = venues.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_read_own_events ON public.wedding_events
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_events.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_manage_own_events ON public.wedding_events
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_events.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_update_own_events ON public.wedding_events
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_events.wedding_id AND w.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_events.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_delete_own_events ON public.wedding_events
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_events.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_read_own_draft ON public.invitation_drafts
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = invitation_drafts.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_manage_own_draft ON public.invitation_drafts
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = invitation_drafts.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_update_own_draft ON public.invitation_drafts
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = invitation_drafts.wedding_id AND w.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = invitation_drafts.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_delete_own_draft ON public.invitation_drafts
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = invitation_drafts.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_read_versions ON public.invitation_versions
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = invitation_versions.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_read_publications ON public.publications
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = publications.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_read_households ON public.guest_households
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = guest_households.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_manage_households ON public.guest_households
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = guest_households.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_update_households ON public.guest_households
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = guest_households.wedding_id AND w.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = guest_households.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_delete_households ON public.guest_households
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = guest_households.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_read_scopes ON public.household_event_scopes
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = household_event_scopes.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_manage_scopes ON public.household_event_scopes
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = household_event_scopes.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_update_scopes ON public.household_event_scopes
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = household_event_scopes.wedding_id AND w.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = household_event_scopes.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_delete_scopes ON public.household_event_scopes
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = household_event_scopes.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_read_rsvps ON public.rsvp_responses
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = rsvp_responses.wedding_id AND w.owner_user_id = auth.uid()));

-- response_source is pinned here, not left to the column CHECK: a host may record
-- that a relative phoned an answer in, and may not label their own guess as the
-- guest's own submission. 'guest' rows arrive through the backend in Stage 8.
CREATE POLICY owners_record_manual_rsvps ON public.rsvp_responses
  FOR INSERT TO authenticated WITH CHECK (
    response_source = 'host_manual'
    AND EXISTS (
      SELECT 1 FROM public.weddings w
      WHERE w.id = rsvp_responses.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_update_manual_rsvps ON public.rsvp_responses
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = rsvp_responses.wedding_id AND w.owner_user_id = auth.uid()))
  WITH CHECK (
    response_source = 'host_manual'
    AND EXISTS (
      SELECT 1 FROM public.weddings w
      WHERE w.id = rsvp_responses.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_delete_rsvps ON public.rsvp_responses
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = rsvp_responses.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_read_approval_requests ON public.approval_requests
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = approval_requests.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_read_approval_feedback ON public.approval_feedback
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = approval_feedback.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_read_assets ON public.wedding_assets
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_assets.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_manage_assets ON public.wedding_assets
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_assets.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_update_assets ON public.wedding_assets
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_assets.wedding_id AND w.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_assets.wedding_id AND w.owner_user_id = auth.uid()));

CREATE POLICY owners_delete_assets ON public.wedding_assets
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = wedding_assets.wedding_id AND w.owner_user_id = auth.uid()));

-- Read-only and narrow: a customer sees what the backend has granted them and can
-- change nothing about it.
CREATE POLICY owners_read_entitlements ON public.entitlements
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = entitlements.wedding_id AND w.owner_user_id = auth.uid()));

-- Platform content: readable, never writable, and rows retired from the catalogue
-- stop being readable. Migrated legacy templates land as 'draft' because no
-- reviewer has assessed them, not 'approved' — that word is earned in Stage 4.
CREATE POLICY users_read_platform_templates ON public.design_templates
  FOR SELECT TO authenticated USING (status IN ('draft', 'approved'));

CREATE POLICY users_read_platform_packs ON public.tradition_packs
  FOR SELECT TO authenticated USING (status IN ('draft', 'approved'));

-- The last policy in `public` that was visible to an anonymous caller. It is
-- retired here rather than in the archive step so that from this file onward no
-- public table has an anon-readable policy at all, instead of relying only on the
-- privilege revocation in section 1 to make it inert.
DROP POLICY IF EXISTS "Public read active templates" ON public.templates;
DROP POLICY IF EXISTS "Admins manage templates" ON public.templates;

-- ===========================================================================
-- 4. Account tables (kept deliberately small — no new role vocabulary)
-- ===========================================================================

DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;

CREATE POLICY owners_read_own_profile ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY owners_update_own_profile ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- SELECT only. The old "Admins manage roles" policy was the one path by which a
-- row in this database could confer authority on another row; role grants now
-- belong to the backend, and `has_role` loses its last consumer in file 9.
CREATE POLICY owners_read_own_roles ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 'planner' was scaffold fiction: no planner workflow exists or is planned. The
-- enum literal is left in place (narrowing an enum in place is a rewrite of
-- published history) and closed off at the column instead.
ALTER TABLE public.user_roles
  DROP CONSTRAINT IF EXISTS user_roles_role_no_vocabulary_lie;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_no_vocabulary_lie
  CHECK (role::text IN ('admin', 'user'));
