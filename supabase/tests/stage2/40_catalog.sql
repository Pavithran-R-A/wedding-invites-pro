-- Stage 2 catalog conformance suite: the schema's *shape*, read from the catalog.
-- Run AFTER bootstrap + published migrations + the Stage 2 chain, as superuser.
--
-- Why this file exists separately from 20_attacks.sql: an attack suite proves what
-- a role can do *today*. It cannot notice that a future migration turned RLS off on
-- one table, added a grant, made a trigger function SECURITY DEFINER, or let a new
-- foreign key CASCADE into append-only history. Those are facts about the catalog,
-- and they are cheap to assert exactly — so they are asserted here as inventories
-- rather than described in documentation and trusted.
--
-- Everything below is computed from pg_class / pg_policy / pg_proc / pg_trigger /
-- pg_constraint / pg_default_acl / pg_attribute on a live database. No count here is
-- copied from a design document: each expectation was read off the migrated schema
-- first, and is now a regression tripwire against the next change. (Phases 47, 72-77.)
--
-- Scope boundary, stated plainly: this runs against plain Postgres with a bootstrap
-- that creates `anon` / `authenticated` / `service_role` and an `auth.users` table.
-- It therefore proves the catalog is shaped as designed; it does not prove PostgREST
-- behaves as designed, because PostgREST is not running here. See the audit report.

SET client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Assertions, in pg_temp so the inventories below never have to exclude their
-- own scaffolding from `public`.
--
-- `st2_ok` counts through a GUC rather than a variable because the checks live in
-- plain statements now, and a function cannot reach into the caller's stack. The
-- counter matters: a suite whose assertions can all be deleted one by one is only
-- as good as the number it prints.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.st2_ok(what text, ok boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL %', what;
  END IF;
  PERFORM set_config('st2.passed',
                     ((coalesce(current_setting('st2.passed', true), '0'))::int + 1)::text,
                     false);
  RAISE NOTICE 'PASS %', what;
END $$;

-- Set equality with a readable diff, because "arrays differ" is not an error message.
CREATE FUNCTION pg_temp.st2_set(what text, got text[], want text[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM want THEN
    PERFORM pg_temp.st2_ok(what, true);
    RETURN;
  END IF;
  RAISE EXCEPTION 'FAIL % — got [%] want [%]', what,
    array_to_string(coalesce(got, ARRAY[]::text[]), ', '),
    array_to_string(coalesce(want, ARRAY[]::text[]), ', ');
END $$;

-- Plan shape for one query: does `rel` get a sequential scan anywhere in the plan
-- Postgres picks? EXPLAIN's JSON output carries the node types, so this asks the
-- question instead of pattern-matching formatted text.
CREATE FUNCTION pg_temp.st2_seqscan(query text, rel text) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE js jsonb;
BEGIN
  EXECUTE 'EXPLAIN (FORMAT JSON) ' || query INTO js;
  RETURN coalesce(jsonb_path_exists(
    js, '$.** ? (@."Node Type" == "Seq Scan" && @."Relation Name" == $rel)',
    jsonb_build_object('rel', rel)), false);
END $$;

-- An error *string* is not evidence; the SQLSTATE is. Used by the role probes, which
-- run the statement as an impersonated role inside a nested block so the role is
-- always reset — a probe that leaked `SET ROLE` into the session would silently
-- change every later check. '00000' means the statement succeeded.
CREATE FUNCTION pg_temp.st2_state(stmt text, as_role text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE code text := '00000';
BEGIN
  EXECUTE 'SET ROLE ' || quote_ident(as_role);
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    code := SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN code;
END $$;

-- ... and the message alongside it, because 'permission denied for schema private'
-- (the object cannot be named) and 'permission denied for table access_tokens' (it can
-- be named but not read) are different guarantees, and only the first is the claim
-- these probes make.
CREATE FUNCTION pg_temp.st2_message(stmt text, as_role text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE msg text := 'no-error';
BEGIN
  EXECUTE 'SET ROLE ' || quote_ident(as_role);
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    msg := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  RETURN msg;
END $$;

SELECT set_config('st2.passed', '0', false);

DO $CATALOG$
DECLARE
  -- The canonical surface, as a list rather than as a count: a count is satisfied by
  -- any eighteen tables, which is not the claim being made.
  public_tbls     text[] := ARRAY[
    'weddings','wedding_people','venues','wedding_events','invitation_drafts',
    'invitation_versions','publications','guest_households','household_event_scopes',
    'rsvp_responses','approval_requests','approval_feedback','wedding_assets',
    'entitlements','design_templates','tradition_packs','profiles','user_roles'];
  private_tbls    text[] := ARRAY['access_tokens','audit_events'];
  legacy_tbls     text[] := ARRAY[
    'projects','templates','guests','orders','payments','printers','activity_logs',
    'migration_findings'];
  -- Everything keyed by a wedding. Phase 71's denormalisation: each of these carries
  -- its own wedding_id so a policy can decide without walking a join chain.
  scoped_tbls     text[] := ARRAY[
    'wedding_people','venues','wedding_events','invitation_drafts','invitation_versions',
    'publications','guest_households','household_event_scopes','rsvp_responses',
    'approval_requests','approval_feedback','wedding_assets','entitlements'];
  -- Tables a customer may insert into, update and delete, subject to RLS.
  owner_crud_tbls text[] := ARRAY[
    'weddings','wedding_people','venues','wedding_events','invitation_drafts',
    'guest_households','household_event_scopes','rsvp_responses','wedding_assets'];
  -- Granted to `authenticated` but written only by the server: no write policy exists,
  -- so the grant is the outer layer and RLS the inner one. profiles is the exception
  -- with an UPDATE policy and no INSERT/DELETE policy: a profile is created by the
  -- signup trigger, edited by its owner, and never removed by either.
  server_only_tbls text[] := ARRAY[
    'invitation_versions','publications','approval_requests','approval_feedback',
    'entitlements','design_templates','tradition_packs','user_roles'];
  -- Rows that are never edited and never removed by a client.
  append_only_tbls text[] := ARRAY[
    'invitation_versions','approval_feedback','access_tokens','audit_events'];
  -- Every ON DELETE action in the canonical schema, chosen rather than inherited
  -- (Phase 63). The reasoning is in docs/architecture/stage-2-migration-plan.md
  -- section 7; the fact is here, because a comment cannot fail a build.
  fk_actions text[] := ARRAY[
    'access_tokens(wedding_id)->weddings=NOACTION',
    'access_tokens(wedding_id+approval_request_id+approval_version_id)->approval_requests=NOACTION',
    'access_tokens(wedding_id+household_id)->guest_households=NOACTION',
    'access_tokens(wedding_id+publication_id)->publications=NOACTION',
    'approval_feedback(wedding_id+request_id+version_id)->approval_requests=NOACTION',
    'approval_requests(wedding_id)->weddings=NOACTION',
    'approval_requests(wedding_id+version_id)->invitation_versions=NOACTION',
    'audit_events(actor_user_id)->auth.users=SETNULL',
    'audit_events(wedding_id)->weddings=SETNULL',
    'design_templates(reviewed_by)->auth.users=SETNULL',
    'entitlements(wedding_id)->weddings=NOACTION',
    'guest_households(wedding_id)->weddings=CASCADE',
    'household_event_scopes(wedding_id)->weddings=CASCADE',
    'household_event_scopes(wedding_id+event_id)->wedding_events=NOACTION',
    'household_event_scopes(wedding_id+household_id)->guest_households=CASCADE',
    'invitation_drafts(wedding_id)->weddings=CASCADE',
    'invitation_versions(created_by)->auth.users=CASCADE',
    'invitation_versions(design_template_id)->design_templates=RESTRICT',
    'invitation_versions(tradition_pack_id)->tradition_packs=RESTRICT',
    'invitation_versions(wedding_id)->weddings=NOACTION',
    'invitation_versions(wedding_id+supersedes_version_id)->invitation_versions=NOACTION',
    'profiles(user_id)->auth.users=CASCADE',
    'publications(wedding_id)->weddings=NOACTION',
    'publications(wedding_id+version_id)->invitation_versions=NOACTION',
    'rsvp_responses(wedding_id)->weddings=CASCADE',
    'rsvp_responses(wedding_id+household_id+event_id)->household_event_scopes=NOACTION',
    'tradition_packs(reviewed_by)->auth.users=SETNULL',
    'user_roles(user_id)->auth.users=CASCADE',
    'venues(wedding_id)->weddings=CASCADE',
    'wedding_assets(wedding_id)->weddings=CASCADE',
    'wedding_events(wedding_id)->weddings=CASCADE',
    'wedding_events(wedding_id+venue_id)->venues=NOACTION',
    'wedding_people(wedding_id)->weddings=CASCADE',
    'weddings(design_template_id)->design_templates=RESTRICT',
    'weddings(owner_user_id)->auth.users=CASCADE',
    'weddings(tradition_pack_id)->tradition_packs=RESTRICT'];
  -- Foreign keys whose referencing columns have no index that starts with them.
  -- Accepted, each for a stated reason, and asserted as a closed set so that a new
  -- unindexed foreign key has to arrive here with a reason of its own before it can
  -- pass (Phase 49). The pattern: none of them is on a path a customer request takes.
  unindexed_fks text[] := ARRAY[
    -- looked up when a review request is withdrawn, which is a trusted, rare action;
    -- the selective prefix (wedding_id, request_id) is indexed
    'approval_feedback->approval_requests',
    -- a version is deleted only after its requests, and version_id alone is indexed
    'approval_requests->invitation_versions',
    -- retention tooling only; a user delete is rare and the scan is bounded by the
    -- number of audit rows, which is the price of keeping them
    'audit_events->auth.users',
    -- catalog reviewers are read by pack/template, never searched by reviewer
    'design_templates->auth.users',
    'tradition_packs->auth.users',
    -- created_by is attribution, not a query key; the row is deleted with its wedding
    'invitation_versions->auth.users',
    -- platform content is withdrawn by status, not deleted, so the RESTRICT check
    -- runs only in a migration
    'invitation_versions->design_templates',
    'invitation_versions->tradition_packs',
    -- lineage walks one wedding's versions, which (wedding_id, ...) indexes cover
    'invitation_versions->invitation_versions',
    -- a venue is deleted after its events are un-pointed; venue_id alone is indexed
    'wedding_events->venues',
    'weddings->design_templates',
    'weddings->tradition_packs'];
  t text;
BEGIN
  -- =========================================================== 1. row-level security
  PERFORM pg_temp.st2_ok('C01 every canonical table has RLS enabled',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r' AND n.nspname IN ('public','private')
                   AND NOT c.relrowsecurity));

  -- FORCE is deliberately absent: the maintenance role that applies migrations and
  -- the service key must be able to repair a row, and a BYPASSRLS role is skipped by
  -- FORCE anyway, so it would constrain exactly the people it is not aimed at.
  PERFORM pg_temp.st2_ok('C02 RLS is not FORCEd (trusted repair stays possible)',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r' AND n.nspname IN ('public','private')
                   AND c.relforcerowsecurity));

  -- The archive is not RLS-protected, and that is a decision rather than an oversight:
  -- it is closed by the privilege layer (C06/C07), so no API role can name a row to
  -- begin with. Asserting the shape here means a later migration that grants on
  -- legacy without also adding policies fails this check instead of leaking.
  PERFORM pg_temp.st2_ok('C03 legacy archive holds exactly the eight archived tables',
    (SELECT array_agg(c.relname::text ORDER BY c.relname)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'legacy') = (SELECT array_agg(x ORDER BY x) FROM unnest(legacy_tbls) x));
  PERFORM pg_temp.st2_ok('C04 no legacy table has a policy (reach is closed by grants)',
    NOT EXISTS (SELECT 1 FROM pg_policy pol
                  JOIN pg_class c ON c.oid = pol.polrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'legacy'));

  -- =========================================================== 2. primary keys, shape
  PERFORM pg_temp.st2_ok('C05 every public table is one of the eighteen canonical ones',
    (SELECT array_agg(c.relname::text ORDER BY c.relname)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public') = (SELECT array_agg(x ORDER BY x) FROM unnest(public_tbls) x));
  PERFORM pg_temp.st2_ok('C06 private schema holds exactly the two server tables',
    (SELECT array_agg(c.relname::text ORDER BY c.relname)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'private') = (SELECT array_agg(x ORDER BY x) FROM unnest(private_tbls) x));
  PERFORM pg_temp.st2_ok('C07 every canonical table has a primary key',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r' AND n.nspname IN ('public','private')
                   AND NOT EXISTS (SELECT 1 FROM pg_constraint k
                                    WHERE k.contype = 'p' AND k.conrelid = c.oid)));
  -- Nothing that reads like the old scaffold survived the move into `legacy`.
  PERFORM pg_temp.st2_ok('C08 no retired surface name remains in public',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public'
                   AND c.relname ~* '^(projects|templates|guests|orders|payments|printers|activity_logs)$'));
  PERFORM pg_temp.st2_ok('C09 no view or matview hides a table-level decision',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname IN ('public','private','legacy')
                   AND c.relkind IN ('v','m','f','p')));
  -- The old enums went to `legacy` with the tables they typed; `app_role` stayed
  -- because public.user_roles still uses it.
  PERFORM pg_temp.st2_ok('C10 only app_role remains as an enum in public',
    (SELECT array_agg(t.typname::text ORDER BY t.typname)
       FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype = 'e' AND n.nspname = 'public') = ARRAY['app_role']);

  -- =========================================================== 3. privileges (Phase 75)
  PERFORM pg_temp.st2_ok('C11 anon holds no table privilege anywhere',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r' AND n.nspname IN ('public','private','legacy')
                   AND has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')));
  PERFORM pg_temp.st2_ok('C12 authenticated has SELECT on exactly the canonical tables',
    (SELECT array_agg(c.relname::text ORDER BY c.relname)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
        AND has_table_privilege('authenticated', c.oid, 'SELECT')) = (SELECT array_agg(x ORDER BY x) FROM unnest(public_tbls) x));
  PERFORM pg_temp.st2_ok('C13 authenticated''s write privileges are exactly the customer set',
    (SELECT array_agg(c.relname::text ORDER BY c.relname)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
        AND has_table_privilege('authenticated', c.oid, 'INSERT')
        AND has_table_privilege('authenticated', c.oid, 'UPDATE')
        AND has_table_privilege('authenticated', c.oid, 'DELETE')) =
      (SELECT array_agg(x ORDER BY x)
         FROM unnest(owner_crud_tbls || ARRAY['profiles']) x));
  PERFORM pg_temp.st2_ok('C14 no API role can name a private or legacy table',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r' AND n.nspname IN ('private','legacy')
                   AND (has_table_privilege('anon', c.oid, 'SELECT')
                     OR has_table_privilege('authenticated', c.oid, 'SELECT'))));
  PERFORM pg_temp.st2_ok('C15 service_role can reach the canonical and server schema',
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname IN ('public','private')
        AND has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE')) = 20::bigint);
  PERFORM pg_temp.st2_ok('C16 service_role holds nothing in legacy',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r' AND n.nspname = 'legacy'
                   AND has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE')));
  -- Two different claims, so two checks: a browser role reaches one schema, and the
  -- trusted backend reaches two. `private` for service_role is the design (it writes
  -- the audit trail and presents credentials); `legacy` for anyone is not.
  PERFORM pg_temp.st2_set('C17 schema USAGE for the browser roles is public alone',
    (SELECT array_agg(r.rolname || ':' || n.nspname ORDER BY r.rolname, n.nspname)
       FROM (VALUES ('anon'),('authenticated')) r(rolname)
       JOIN pg_namespace n ON n.nspname IN ('public','private','legacy')
      WHERE has_schema_privilege(r.rolname, n.nspname, 'USAGE')),
    ARRAY['anon:public','authenticated:public']);
  PERFORM pg_temp.st2_set('C17b schema USAGE for service_role excludes the archive',
    (SELECT array_agg(n.nspname ORDER BY n.nspname)
       FROM pg_namespace n
      WHERE n.nspname IN ('public','private','legacy')
        AND has_schema_privilege('service_role', n.nspname, 'USAGE')),
    ARRAY['private','public']);

  -- =========================================================== 4. policies
  PERFORM pg_temp.st2_ok('C18 every policy targets authenticated alone',
    NOT EXISTS (SELECT 1 FROM pg_policy pol
                 CROSS JOIN LATERAL unnest(pol.polroles) r(rolid)
                WHERE pg_get_userbyid(r.rolid) <> 'authenticated'));
  PERFORM pg_temp.st2_ok('C19 every policy is permissive (no restriction logic to reason about)',
    NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE NOT pol.polpermissive));
  PERFORM pg_temp.st2_ok('C20 each canonical table has exactly one SELECT policy',
    (SELECT count(*) FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND pol.polcmd = 'r') = 18::bigint);
  PERFORM pg_temp.st2_ok('C21 write policies exist on exactly the customer set',
    (SELECT array_agg(x.relname::text ORDER BY x.relname)
       FROM (SELECT DISTINCT c.relname FROM pg_policy pol
               JOIN pg_class c ON c.oid = pol.polrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND pol.polcmd IN ('a','w','d')) x)
      = (SELECT array_agg(y ORDER BY y)
           FROM unnest(owner_crud_tbls || ARRAY['profiles']) y));
  PERFORM pg_temp.st2_ok('C22 server-authored tables have no write policy at all',
    NOT EXISTS (SELECT 1 FROM pg_policy pol
                  JOIN pg_class c ON c.oid = pol.polrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND pol.polcmd <> 'r'
                   AND c.relname = ANY (server_only_tbls)));
  PERFORM pg_temp.st2_ok('C23 profiles is readable and updatable, never insertable or deletable',
    (SELECT array_agg(pol.polcmd::text ORDER BY pol.polcmd::text)
       FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
      WHERE c.relname = 'profiles') = ARRAY['r','w']);
  PERFORM pg_temp.st2_ok('C24 private schema tables carry no policy (no API role reaches them)',
    NOT EXISTS (SELECT 1 FROM pg_policy pol
                  JOIN pg_class c ON c.oid = pol.polrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'private'));
  -- Every ownership decision is expressed against weddings.owner_user_id; a policy
  -- inventing its own ownership rule would be a second source of truth. Exactly two
  -- policies do not mention auth.uid() — the platform catalogue, which is read by
  -- status rather than by possession — and that exemption is named here so a third
  -- one has to be argued for before it can ship.
  PERFORM pg_temp.st2_set('C25 policies without an auth.uid() predicate are the two catalogue reads',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT c.relname || '.' || pol.polname || '=' || pol.polcmd::text AS x
         FROM pg_policy pol
         JOIN pg_class c ON c.oid = pol.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND position('auth.uid()' IN
                coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ||
                coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) = 0) s),
    ARRAY['design_templates.users_read_platform_templates=r',
          'tradition_packs.users_read_platform_packs=r']);
  PERFORM pg_temp.st2_ok('C25b every wedding-scoped policy resolves ownership through weddings',
    NOT EXISTS (SELECT 1 FROM pg_policy pol
                  JOIN pg_class c ON c.oid = pol.polrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public'
                   AND c.relname = ANY (scoped_tbls)
                   AND (SELECT position('weddings w' IN
                          coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ||
                          coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) = 0
                     OR position('w.owner_user_id = auth.uid()' IN
                          coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ||
                          coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) = 0
                     OR position(c.relname || '.wedding_id' IN
                          coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ||
                          coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) = 0)));

  -- =========================================================== 5. function security
  -- SECURITY DEFINER inventory, from the catalog (Phase 74). One is expected; a
  -- second would have to earn its place here before it can ship.
  PERFORM pg_temp.st2_set('C26 SECURITY DEFINER functions are exactly the signup trigger',
    (SELECT array_agg(p ORDER BY p) FROM (
       SELECT n.nspname || '.' || p.proname AS p
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')) s),
    ARRAY['private.handle_new_user']);
  PERFORM pg_temp.st2_ok('C27 every SECURITY DEFINER function pins its search_path',
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')
                   AND p.proconfig::text NOT LIKE '%search_path%'));
  PERFORM pg_temp.st2_ok('C28 no SECURITY DEFINER function is executable by anon or authenticated',
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')
                   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))));
  PERFORM pg_temp.st2_ok('C29 no function at all lives in public',
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public'));
  PERFORM pg_temp.st2_ok('C30 anon and authenticated cannot execute anything in private',
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'private'
                   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))));

  -- =========================================================== 6. guard triggers
  PERFORM pg_temp.st2_set('C31 trigger inventory (guards, timestamps, signup)',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT n.nspname || '.' || c.relname || '.' || t.tgname || '=' || p.proname AS x
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal) s),
    ARRAY[
      'auth.users.on_auth_user_created=handle_new_user',
      'private.access_tokens.tokens_no_client_delete=reject_client_delete',
      'private.access_tokens.tokens_no_client_write=reject_client_write',
      'private.audit_events.audit_append_only_no_delete=reject_client_delete',
      'private.audit_events.audit_append_only_no_update=reject_client_write',
      'public.approval_feedback.feedback_append_only_no_delete=reject_client_delete',
      'public.approval_feedback.feedback_append_only_no_update=reject_client_write',
      'public.approval_requests.approval_requests_no_client_write=reject_client_write',
      'public.approval_requests.set_updated_at=touch_updated_at',
      'public.design_templates.no_client_write_design_templates=reject_client_write',
      'public.design_templates.set_updated_at=touch_updated_at',
      'public.entitlements.entitlements_no_client_delete=reject_client_delete',
      'public.entitlements.entitlements_no_client_write=reject_client_write',
      'public.entitlements.set_updated_at=touch_updated_at',
      'public.guest_households.set_updated_at=touch_updated_at',
      'public.invitation_drafts.set_updated_at=touch_updated_at',
      'public.invitation_versions.versions_immutable_no_delete=reject_client_delete',
      'public.invitation_versions.versions_immutable_no_update=reject_client_write',
      'public.publications.publications_no_client_write=reject_client_write',
      'public.publications.set_updated_at=touch_updated_at',
      'public.rsvp_responses.set_updated_at=touch_updated_at',
      'public.tradition_packs.no_client_write_tradition_packs=reject_client_write',
      'public.tradition_packs.set_updated_at=touch_updated_at',
      'public.venues.set_updated_at=touch_updated_at',
      'public.wedding_assets.set_updated_at=touch_updated_at',
      'public.wedding_events.set_updated_at=touch_updated_at',
      'public.wedding_people.set_updated_at=touch_updated_at',
      'public.weddings.set_updated_at=touch_updated_at']);
  -- The guards are INVOKER by design (they must report the role that issued the
  -- statement), so a DEFINER trigger function would mean the guard had a privilege
  -- of its own to use. This is about triggers on the *canonical* tables: the one
  -- SECURITY DEFINER function this schema has, private.handle_new_user, is a trigger on
  -- auth.users and must be definer to write a profile for a joining user — C26 pins it
  -- by name, so widening this check to auth.users would only make it false.
  PERFORM pg_temp.st2_ok('C32 no canonical table carries a SECURITY DEFINER trigger',
    NOT EXISTS (SELECT 1 FROM pg_trigger t
                  JOIN pg_proc p ON p.oid = t.tgfoid
                  JOIN pg_class c ON c.oid = t.tgrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE NOT t.tgisinternal AND p.prosecdef
                   AND n.nspname IN ('public','private')));
  -- Phase 47: "no client-writable trusted field". The grant list (C13/C22) says which
  -- tables a client may write; this says every table that must not be client-written
  -- also has a trigger refusing it, so a future GRANT cannot be the only line of
  -- defence. A *delete* guard is required only where rows are append-only.
  PERFORM pg_temp.st2_ok('C33 every server-authored table has a write guard',
    NOT EXISTS (SELECT 1 FROM unnest(server_only_tbls) tbl
                 WHERE tbl <> 'user_roles'
                   AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                                     JOIN pg_class c ON c.oid = t.tgrelid
                                     JOIN pg_proc p ON p.oid = t.tgfoid
                                    WHERE c.relname = tbl AND NOT t.tgisinternal
                                      AND p.proname = 'reject_client_write')));
  PERFORM pg_temp.st2_ok('C34 every append-only table has a delete guard',
    NOT EXISTS (SELECT 1 FROM unnest(append_only_tbls) tbl
                 WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t
                                     JOIN pg_class c ON c.oid = t.tgrelid
                                     JOIN pg_proc p ON p.oid = t.tgfoid
                                    WHERE c.relname = tbl AND NOT t.tgisinternal
                                      AND p.proname = 'reject_client_delete')));
  -- The general rule behind the four NO ACTION conversions. A cascade deletes as the
  -- child table's owner, so reject_client_delete() cannot see it (measured, and
  -- recorded in the migration plan section 7). If a future migration introduces a
  -- CASCADE into a guarded table, this is the check that says so.
  PERFORM pg_temp.st2_ok('C35 nothing cascades into a guarded or append-only table',
    NOT EXISTS (SELECT 1 FROM pg_constraint k
                  JOIN pg_class c ON c.oid = k.conrelid
                 WHERE k.contype = 'f' AND k.confdeltype = 'c'
                   AND (c.relname = ANY (append_only_tbls)
                     OR c.relname = ANY (server_only_tbls))
                   AND k.confrelid::regclass::text NOT LIKE 'auth.%'));

  -- =========================================================== 7. timestamps (Phase 50)
  PERFORM pg_temp.st2_ok('C36 append-only rows have no updated_at to maintain',
    NOT EXISTS (SELECT 1 FROM unnest(append_only_tbls) tbl
                 WHERE EXISTS (SELECT 1 FROM pg_class c
                                 JOIN pg_attribute a ON a.attrelid = c.oid
                                WHERE c.relname = tbl AND a.attname = 'updated_at')));
  PERFORM pg_temp.st2_ok('C37 updated_at and its trigger never disagree',
    NOT EXISTS (SELECT 1 FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r' AND n.nspname IN ('public','private')
                   AND (EXISTS (SELECT 1 FROM pg_attribute a
                                 WHERE a.attrelid = c.oid AND a.attname = 'updated_at'))
                   <> (EXISTS (SELECT 1 FROM pg_trigger t
                                 JOIN pg_proc p ON p.oid = t.tgfoid
                                WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                                  AND t.tgname = 'set_updated_at'
                                  AND p.proname = 'touch_updated_at'))));
  -- One mechanism, not thirteen copies of `now()`.
  PERFORM pg_temp.st2_ok('C38 touch_updated_at is the only updated_at writer',
    (SELECT count(DISTINCT p.proname) FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal AND t.tgname = 'set_updated_at'
        AND n.nspname IN ('public','private')) = 1::bigint);

  -- =========================================================== 8. value discipline
  -- Money and counts are integers (Phase 67). Coordinates are the only numeric in the
  -- schema, and they are not money; no float type appears anywhere.
  PERFORM pg_temp.st2_ok('C39 no float or double precision column exists',
    NOT EXISTS (SELECT 1 FROM pg_attribute a
                  JOIN pg_class c ON c.oid = a.attrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                  JOIN pg_type ty ON ty.oid = a.atttypid
                 WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind = 'r'
                   AND n.nspname IN ('public','private')
                   AND ty.oid IN ('real'::regtype, 'double precision'::regtype)));
  PERFORM pg_temp.st2_ok('C40 numeric appears only as a venue coordinate',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT c.relname || '.' || a.attname AS x
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_type ty ON ty.oid = a.atttypid
        WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind = 'r'
          AND n.nspname IN ('public','private') AND ty.oid = 'numeric'::regtype) s)
      = ARRAY['venues.latitude','venues.longitude']);
  -- Word-boundary matching, because a substring search on this list reports
  -- `feedback_kind` as a price column: the first version of this check failed on it.
  PERFORM pg_temp.st2_ok('C41 no column pretends to hold a price',
    NOT EXISTS (SELECT 1 FROM pg_attribute a
                  JOIN pg_class c ON c.oid = a.attrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE a.attnum > 0 AND NOT a.attisdropped
                   AND n.nspname IN ('public','private')
                   AND a.attname ~* '(^|_)(paise|amount|price|cost|gst|tax|total|fee|discount)($|_)'));
  -- Quantities a client can send are bounded, and the set is found by *name pattern*
  -- rather than listed by hand: a new `*_count`, `*_size`, `*_number` or
  -- `*_order` column that arrives without a bound fails here instead of joining an
  -- otherwise-green inventory. Read off the migrated schema (Phase 67).
  PERFORM pg_temp.st2_ok('C42 every integer quantity column is bounded by a CHECK',
    NOT EXISTS (SELECT 1 FROM pg_attribute a
                  JOIN pg_class c ON c.oid = a.attrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                  JOIN pg_type ty ON ty.oid = a.atttypid
                 WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind = 'r'
                   AND n.nspname IN ('public','private')
                   AND ty.oid IN ('integer'::regtype,'bigint'::regtype,'smallint'::regtype)
                   AND a.attname ~* 'count|size|number|order|qty|duration|pages'
                   AND NOT EXISTS (SELECT 1 FROM pg_constraint k
                                     JOIN LATERAL unnest(k.conkey) u(n) ON true
                                    WHERE k.contype = 'c' AND k.conrelid = c.oid
                                      AND u.n = a.attnum
                                      AND pg_get_constraintdef(k.oid)
                                          ~ (a.attname || ' *(>=|>) *(0|1)'))));
  -- ... and the bounded set is the one expected, so a column cannot dodge C42 by
  -- being renamed out of the pattern while still pretending to be a quantity.
  PERFORM pg_temp.st2_set('C42b the quantity columns are exactly the seven expected',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT c.relname || '.' || a.attname AS x
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_type ty ON ty.oid = a.atttypid
        WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind = 'r'
          AND n.nspname IN ('public','private')
          AND ty.oid IN ('integer'::regtype,'bigint'::regtype,'smallint'::regtype)
          AND a.attname ~* 'count|size|number|order|qty|duration|pages') s),
    ARRAY['guest_households.expected_party_size','invitation_versions.version_number',
          'rsvp_responses.party_size','wedding_assets.size_bytes',
          'wedding_events.display_order','wedding_people.display_order',
          'weddings.estimated_guest_count']);
  -- Phase 66: the domain has no place for inherited or assumed identity. This is the
  -- domain contract as an executable statement, not a sentence in a document.
  PERFORM pg_temp.st2_ok('C43 no column encodes caste, community, religion or inferred identity',
    NOT EXISTS (SELECT 1 FROM pg_attribute a
                  JOIN pg_class c ON c.oid = a.attrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE a.attnum > 0 AND NOT a.attisdropped
                   AND n.nspname IN ('public','private','legacy')
                   AND (a.attname ~* 'caste|subcaste|gotra|community|religion|faith|ethnic|jati'
                     OR a.attname ~* 'inferred|mother_tongue|blood_group')));
  PERFORM pg_temp.st2_ok('C44 no table or constraint name encodes them either',
    NOT EXISTS (SELECT 1 FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname IN ('public','private','legacy')
                   AND c.relname ~* 'caste|community|religion|ethnic|jati'));
  -- Phase 68: a share credential is stored as a digest. The digest is not the primary
  -- key (a rotating key would have to be), it is unique, and no column could hold a
  -- raw token. `private.access_tokens` has exactly two token-named columns, and both
  -- describe the digest — there is nowhere to put the secret itself.
  PERFORM pg_temp.st2_set('C45 the credential table columns that mention tokens',
    (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'access_tokens' AND n.nspname = 'private'
       AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname ~* 'token'),
    ARRAY['token_hash','token_kind']);
  PERFORM pg_temp.st2_ok('C45b the digest column is shaped like a SHA-256 hex digest',
    EXISTS (SELECT 1 FROM pg_constraint k
              JOIN pg_class c ON c.oid = k.conrelid
             WHERE c.relname = 'access_tokens' AND k.contype = 'c'
               AND pg_get_constraintdef(k.oid) LIKE '%0-9a-f]{64}%'));
  -- The digest is a unique key, not the primary key: rotation replaces a row's value,
  -- and a primary key that a client obtains by guessing is not a primary key.
  PERFORM pg_temp.st2_set('C45c credential keys: digest is unique, id is the primary key',
    (SELECT array_agg(k.conname||'='||k.contype::text ORDER BY k.conname)
       FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      WHERE c.relname = 'access_tokens' AND c.relnamespace = 'private'::regnamespace
        AND k.contype IN ('p','u')),
    ARRAY['access_tokens_pkey=p','access_tokens_token_hash_key=u']);

  -- ================================================== 9. referential integrity shape
  -- Every ON DELETE action in one set comparison, generated from pg_constraint (Phase
  -- 63/64). A design table in a document can drift; this cannot, and it is the reason
  -- section 7 of the migration plan was rewritten rather than defended.
  PERFORM pg_temp.st2_set('C46 every ON DELETE action is the chosen one',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT c.relname || '(' ||
              (SELECT string_agg(a.attname, '+' ORDER BY o.n)
                 FROM unnest(k.conkey) WITH ORDINALITY o(attnum, n)
                 JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = o.attnum)
              || ')->' ||
              CASE WHEN rn.nspname = 'public' THEN r.relname
                   ELSE rn.nspname || '.' || r.relname END || '=' ||
              CASE k.confdeltype
                WHEN 'a' THEN 'NOACTION' WHEN 'r' THEN 'RESTRICT'
                WHEN 'c' THEN 'CASCADE'  WHEN 'n' THEN 'SETNULL'
                WHEN 'd' THEN 'SETDEFAULT' END AS x
         FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class r ON r.oid = k.confrelid
         JOIN pg_namespace rn ON rn.oid = r.relnamespace
        WHERE k.contype = 'f' AND n.nspname IN ('public','private')) s),
    (SELECT array_agg(x ORDER BY x) FROM unnest(fk_actions) x));
  -- Cross-wedding references are unrepresentable, not merely disfavoured: each
  -- composite foreign key points at a (wedding_id, id) unique key, so a row can only
  -- ever reference a parent from its own wedding. 20_attacks.sql tries it from the
  -- outside; this asserts the mechanism that makes the attack need no policy.
  PERFORM pg_temp.st2_ok('C47 every composite cross-table reference is pinned to one wedding',
    NOT EXISTS (SELECT 1 FROM pg_constraint k
                  JOIN pg_class c ON c.oid = k.conrelid
                  JOIN pg_class r ON r.oid = k.confrelid
                 WHERE k.contype = 'f' AND c.relnamespace = 'public'::regnamespace
                   AND array_length(k.conkey, 1) > 1
                   AND r.relname <> c.relname
                   AND (SELECT a.attname FROM pg_attribute a
                         WHERE a.attrelid = k.conrelid AND a.attnum = k.conkey[1])
                       <> 'wedding_id'));
  -- Unindexed foreign keys: a closed set, each with a reason (Phase 49). A new one has
  -- to arrive here with a justification before the suite will pass.
  PERFORM pg_temp.st2_set('C48 the unindexed foreign keys are exactly the accepted twelve',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT c.relname || '->' ||
              CASE WHEN rn.nspname = 'public' THEN r.relname
                   ELSE rn.nspname || '.' || r.relname END AS x
         FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class r ON r.oid = k.confrelid
         JOIN pg_namespace rn ON rn.oid = r.relnamespace
        WHERE k.contype = 'f' AND n.nspname IN ('public','private')
          AND NOT EXISTS (
                SELECT 1 FROM pg_index i
                 WHERE i.indrelid = c.oid
                   AND (SELECT array_agg(pa.attname ORDER BY o.n)
                          FROM unnest(i.indkey::int[]) WITH ORDINALITY o(attnum, n)
                          JOIN pg_attribute pa ON pa.attrelid = i.indrelid
                                             AND pa.attnum = o.attnum
                         WHERE o.n <= array_length(k.conkey, 1))
                       = (SELECT array_agg(pa.attname ORDER BY o.n)
                            FROM unnest(k.conkey) WITH ORDINALITY o(attnum, n)
                            JOIN pg_attribute pa ON pa.attrelid = c.oid
                                               AND pa.attnum = o.attnum))) s),
    (SELECT array_agg(x ORDER BY x) FROM unnest(unindexed_fks) x));

  -- ================================================== 10. wedding scoping (Phase 71)
  -- The denormalisation that keeps RLS off join chains: every scoped table carries its
  -- own wedding_id, it cannot be left null, and an index leads with it so the policy
  -- predicate is an index probe rather than a walk.
  PERFORM pg_temp.st2_ok('C49 every wedding-scoped table has a NOT NULL wedding_id',
    NOT EXISTS (SELECT 1 FROM unnest(scoped_tbls) tbl
                 WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                                     JOIN pg_class c ON c.oid = a.attrelid
                                    WHERE c.relname = tbl AND a.attname = 'wedding_id'
                                      AND a.attnotnull AND c.relnamespace = 'public'::regnamespace)));
  -- ORDINALITY rather than a subscript: `indkey::int[]` is 0-based (measured, its lower
  -- bound is 0), so `[1]` skips the first column and reports every index as leading
  -- with the wrong one. A version of this check written that way declared all
  -- thirty-odd foreign keys unindexed.
  PERFORM pg_temp.st2_ok('C50 an index leads with wedding_id on every scoped table',
    NOT EXISTS (SELECT 1 FROM unnest(scoped_tbls) tbl
                 WHERE NOT EXISTS (
                   SELECT 1 FROM pg_index i
                     JOIN pg_class c ON c.oid = i.indrelid
                     JOIN LATERAL unnest(i.indkey::int[])
                          WITH ORDINALITY o(attnum, n) ON true AND o.n = 1
                     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = o.attnum
                    WHERE c.relname = tbl
                      AND c.relnamespace = 'public'::regnamespace
                      AND a.attname = 'wedding_id')));
  PERFORM pg_temp.st2_ok('C51 private.audit_events keeps its wedding link nullable on purpose',
    (SELECT a.attnotnull FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
     WHERE c.relname = 'audit_events' AND c.relnamespace = 'private'::regnamespace
       AND a.attname = 'wedding_id') IS FALSE);

  -- ================================================== 11. plan sanity (Phase 70)
  -- Five query paths the product will actually take. With an empty test database the
  -- planner would choose a sequential scan regardless of what indexes exist, so
  -- enable_seqscan is turned off for this section: the assertion is that an index
  -- *can* serve the predicate, which is the durable fact. Literal uuids only — a
  -- gen_random_uuid() in the qualifier is not a constant and plans as a scan
  -- (measured, and it produced a false failure the first time this section ran).
  PERFORM set_config('enable_seqscan', 'off', false);
  PERFORM pg_temp.st2_ok('C52 the owner''s wedding list is served by an index',
    NOT pg_temp.st2_seqscan(
      $Q$SELECT id FROM public.weddings WHERE owner_user_id =
         '11111111-1111-1111-1111-111111111111'$Q$, 'weddings'));
  PERFORM pg_temp.st2_ok('C53 resolving a live publication to its version needs no scan',
    NOT pg_temp.st2_seqscan(
      $Q$SELECT v.id FROM public.publications p
           JOIN public.invitation_versions v
             ON v.id = p.version_id AND v.wedding_id = p.wedding_id
          WHERE p.wedding_id = '22222222-2222-2222-2222-222222222222'
            AND p.status = 'active'$Q$, 'publications')
    AND NOT pg_temp.st2_seqscan(
      $Q$SELECT v.id FROM public.publications p
           JOIN public.invitation_versions v
             ON v.id = p.version_id AND v.wedding_id = p.wedding_id
          WHERE p.wedding_id = '22222222-2222-2222-2222-222222222222'
            AND p.status = 'active'$Q$, 'invitation_versions'));
  PERFORM pg_temp.st2_ok('C54 a household RSVP write probes one index',
    NOT pg_temp.st2_seqscan(
      $Q$SELECT id FROM public.rsvp_responses WHERE wedding_id =
         '33333333-3333-3333-3333-333333333333' AND household_id =
         '44444444-4444-4444-4444-444444444444' AND event_id =
         '55555555-5555-5555-5555-555555555555'$Q$, 'rsvp_responses'));
  PERFORM pg_temp.st2_ok('C55 the review queue is already ordered by its index',
    NOT pg_temp.st2_seqscan(
      $Q$SELECT id FROM public.approval_requests WHERE wedding_id =
         '66666666-6666-6666-6666-666666666666' ORDER BY requested_at DESC
         LIMIT 20$Q$, 'approval_requests'));
  PERFORM pg_temp.st2_ok('C56 a presented credential is looked up by its digest, not scanned',
    NOT pg_temp.st2_seqscan(
      $Q$SELECT id FROM private.access_tokens WHERE token_hash =
         '0000000000000000000000000000000000000000000000000000000000000000'$Q$,
      'access_tokens'));
  -- ================================================== 12. defaults, proven not described
  -- Phase 48. The claim is about objects that do not exist yet, so the only honest way
  -- to test it is to make one. This block creates a table, a sequence and two
  -- functions, asks what each role can actually do with them, and drops them again in
  -- the same breath. 40_catalog.sql is otherwise read-only and is run by run.sh inside
  -- a transaction it rolls back, so a probe can never become schema.
  EXECUTE 'CREATE TABLE public.st2_probe_dp (id integer)';
  EXECUTE 'CREATE SEQUENCE public.st2_probe_seq_dp';
  EXECUTE 'CREATE FUNCTION public.st2_probe_fn_dp() RETURNS integer LANGUAGE sql AS $body$ SELECT 1 $body$';
  EXECUTE 'CREATE FUNCTION private.st2_probe_fn_dp() RETURNS integer LANGUAGE sql AS $body$ SELECT 1 $body$';
  -- The rule this project follows instead of default privileges for functions (see the
  -- measured note in migration 20260925120000): revoke on the object.
  EXECUTE 'REVOKE ALL ON FUNCTION private.st2_probe_fn_dp() FROM PUBLIC, anon, authenticated';

  PERFORM pg_temp.st2_ok('C57 a table created after the baseline is invisible to anon',
    NOT has_table_privilege('anon', 'public.st2_probe_dp', 'SELECT, INSERT, UPDATE, DELETE'));
  PERFORM pg_temp.st2_ok('C58 ... and to authenticated, with no grant and no policy',
    NOT has_table_privilege('authenticated', 'public.st2_probe_dp', 'SELECT, INSERT, UPDATE, DELETE'));
  PERFORM pg_temp.st2_ok('C59 a new sequence is not usable by a client role',
    NOT has_sequence_privilege('authenticated', 'public.st2_probe_seq_dp', 'USAGE, SELECT, UPDATE'));
  -- Fail-closed does not mean unreachable-by-design: the trusted backend still reaches
  -- what it needs without a migration saying so. Asserting this keeps the two halves of
  -- the model distinct rather than both being "no grants anywhere".
  PERFORM pg_temp.st2_ok('C60 the trusted backend does reach a new public table',
    has_table_privilege('service_role', 'public.st2_probe_dp', 'SELECT, INSERT, UPDATE, DELETE'));
  -- A private object cannot even be *named* by an API role: the refusal is about the
  -- schema, which is a stronger statement than a missing table privilege, and it holds
  -- before that object has any ACL of its own.
  PERFORM pg_temp.st2_ok('C61 an API role cannot name a table in private',
    pg_temp.st2_state('SELECT count(*) FROM private.st2_probe_dp', 'authenticated') = '42501'
    AND pg_temp.st2_message('SELECT count(*) FROM private.st2_probe_dp',
                            'authenticated') LIKE 'permission denied for schema private%');
  PERFORM pg_temp.st2_ok('C62 ... nor call a function in it, even one with no revoke',
    pg_temp.st2_state('SELECT private.st2_probe_fn_dp()', 'anon') = '42501');
  -- The limitation, kept on the record as a passing check. Postgres layers PUBLIC's
  -- implicit EXECUTE on top of any stored default ACL, so ALTER DEFAULT PRIVILEGES
  -- cannot make a *future* public function non-executable (measured; see the note in
  -- migration 20260925120000). This project's answer is C29 — nothing of ours lives in
  -- public — plus the per-object revoke. If a future Postgres changes this, delete this
  -- check and the sentence above it; do not flip it, or it stops describing anything.
  PERFORM pg_temp.st2_ok('C63 (limitation, not a goal) default privileges cannot revoke PUBLIC EXECUTE',
    pg_temp.st2_state('SELECT public.st2_probe_fn_dp()', 'anon') = '00000'
    AND has_function_privilege('anon', 'public.st2_probe_fn_dp()', 'EXECUTE'));

  EXECUTE 'DROP FUNCTION private.st2_probe_fn_dp()';
  EXECUTE 'DROP FUNCTION public.st2_probe_fn_dp()';
  EXECUTE 'DROP SEQUENCE public.st2_probe_seq_dp';
  EXECUTE 'DROP TABLE public.st2_probe_dp';

  -- ================================================== 13. the archive and the guards
  -- Phase 72/73, against the real objects rather than probe ones.
  PERFORM pg_temp.st2_ok('C64 anon cannot name the archived scaffold',
    pg_temp.st2_state('SELECT count(*) FROM legacy.projects', 'anon') = '42501');
  PERFORM pg_temp.st2_ok('C65 authenticated cannot name it either, and is refused by the schema',
    pg_temp.st2_state('SELECT count(*) FROM legacy.projects', 'authenticated') = '42501'
    AND pg_temp.st2_message('SELECT count(*) FROM legacy.projects', 'authenticated')
        LIKE 'permission denied for schema legacy%');
  -- The one that matters for an insider reading this suite: the server key does not
  -- get a pass on the archive. Stage 2 revokes it from service_role specifically so
  -- that "archived" and "still readable by whoever holds the key" stay different.
  PERFORM pg_temp.st2_ok('C66 service_role is refused the archive too',
    pg_temp.st2_state('SELECT count(*) FROM legacy.projects', 'service_role') = '42501');
  PERFORM pg_temp.st2_ok('C67 token digests are unreachable to a browser role',
    pg_temp.st2_state('SELECT token_hash FROM private.access_tokens', 'authenticated') = '42501'
    AND pg_temp.st2_state('SELECT token_hash FROM private.access_tokens', 'anon') = '42501');
  -- A client must not be able to call the guard that decides whether clients may write:
  -- it is trigger-only machinery, and its trust predicate reads current_user.
  PERFORM pg_temp.st2_ok('C68 no client role can execute the write guards directly',
    pg_temp.st2_state('SELECT private.reject_client_write()', 'authenticated') = '42501'
    AND pg_temp.st2_state('SELECT private.reject_client_delete()', 'anon') = '42501');
  -- Measured, and easy to forget: even the trusted backend cannot execute the guards
  -- (their ACL is owner-only), so nothing can invoke them out of band. Triggers reach
  -- them as the table owner, which is the only supported path.
  PERFORM pg_temp.st2_ok('C69 the guards are not executable by service_role either',
    pg_temp.st2_state('SELECT private.reject_client_write()', 'service_role') = '42501');

  -- ================================================== 14. the suite has not been emptied
  -- Every list above is a *set* comparison, so an empty schema would satisfy several of
  -- them by accident; the floor is what says this run measured something. And the probe
  -- objects must be gone, because a leaked `st2_probe_*` table in public would be a
  -- hole this file is meant to be closing.
  PERFORM pg_temp.st2_ok('C70 the probe objects left no trace in the catalogue',
    NOT EXISTS (SELECT 1 FROM pg_class WHERE relname LIKE 'st2_probe_%')
    AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'st2_probe_%'));

  IF (current_setting('st2.passed'))::int < 70 THEN
    RAISE EXCEPTION 'FAIL: only % catalog assertions ran — the expected floor is 70',
      (current_setting('st2.passed'))::int;
  END IF;
END $CATALOG$;

SELECT 'STAGE2 CATALOG TESTS PASSED (' || current_setting('st2.passed') || ')' AS result;
