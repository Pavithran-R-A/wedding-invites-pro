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

-- Which schema head this run is qualifying, as a fact about the run rather than about the
-- catalogue. Unset means this file's own head, so `supabase/tests/stage2/run.sh` — whose chain
-- stops at Stage 4 — needs no change and still measures the inventories it was written against.
CREATE FUNCTION pg_temp.st2_head() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(current_setting('app.stage_head', true), 'stage4') $fn$;

-- Cumulative, and an ordinal rather than an equality, because heads are cumulative: a census keyed
-- on `= 'stage5'` would silently hand the Stage 6 chain the Stage 5 expectations, which is the
-- defect class this repair exists to remove. A malformed head raises instead of choosing a branch,
-- so a typo in `PGOPTIONS` reports itself rather than passing.
CREATE FUNCTION pg_temp.st2_at_least(want text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $fn$
DECLARE h int; w int;
BEGIN
  IF pg_temp.st2_head() !~ '^stage[0-9]+$' OR want !~ '^stage[0-9]+$' THEN
    RAISE EXCEPTION 'st2_at_least: a stage head must be spelled stage<n> — got head=% want=%',
      pg_temp.st2_head(), want;
  END IF;
  h := regexp_replace(pg_temp.st2_head(), '^stage', '')::int;
  w := regexp_replace(want, '^stage', '')::int;
  RETURN h >= w;
END
$fn$;

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
  -- any nineteen tables, which is not the claim being made.
  public_tbls     text[] := ARRAY[
    'weddings','wedding_people','venues','wedding_events','invitation_drafts',
    'invitation_versions','publications','guest_households','household_event_scopes',
    'rsvp_responses','approval_requests','approval_feedback','wedding_assets',
    'entitlements','design_templates','tradition_packs','tradition_pack_releases',
    'profiles','user_roles'];
  -- The one table on that list whose customer read path is a *column* projection rather than a
  -- table grant, and the seven columns it opens. Stage 4 §9 narrowed it: the reviewer record,
  -- the authorship and machine-assistance disclosure, the source reference, the changelog and
  -- the lifecycle timestamps are columns a browser cannot even name. Under a column grant
  -- `has_table_privilege(..., 'SELECT')` answers false while those seven still read, so C12
  -- asks about table-level grants and C12b about this projection, separately and by name.
  release_read_cols text[] := ARRAY[
    'definition', 'definition_schema_version', 'id', 'languages', 'pack_id',
    'release_number', 'status'];
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
  -- ... and the same list after Stage 3 §3 closed the draft invariant. `invitation_drafts`
  -- leaves it: the row is created by the wedding's trigger and destroyed by its
  -- cascade, so no browser role may insert or delete one. It keeps SELECT and UPDATE.
  -- The two lists are both kept because they assert different things — C21 asks which
  -- tables have a write *policy* (the draft still has one, for UPDATE) and C13 asks
  -- which have a write *grant* per command.
  owner_insert_tbls text[] := ARRAY[
    'weddings','wedding_people','venues','wedding_events',
    'guest_households','household_event_scopes','rsvp_responses','wedding_assets'];
  -- Granted to `authenticated` but written only by the server: no write policy exists,
  -- so the grant is the outer layer and RLS the inner one. profiles is the exception
  -- with an UPDATE policy and no INSERT/DELETE policy: a profile is created by the
  -- signup trigger, edited by its owner, and never removed by either.
  server_only_tbls text[] := ARRAY[
    'invitation_versions','publications','approval_requests','approval_feedback',
    'entitlements','design_templates','tradition_packs','tradition_pack_releases',
    'user_roles'];
  -- Rows that are never edited and never removed by a client.
  append_only_tbls text[] := ARRAY[
    'invitation_versions','approval_feedback','access_tokens','audit_events'];
  -- Every ON DELETE action in the canonical schema, chosen rather than inherited
  -- (Phase 63). The reasoning is in docs/architecture/stage-2-migration-plan.md
  -- section 7; the fact is here, because a comment cannot fail a build.
  --
  -- Stage 4 added three of these and they are the load-bearing ones for snapshot
  -- pinning: a version's `tradition_pack_release_id`, a wedding's, and a release's
  -- `pack_id` are all RESTRICT. A frozen invitation asks for the release it was
  -- pinned to, so the schema has to make that release undiggable-from-under-it rather
  -- than leaving it to a status flag — deprecation is a status change (and stays
  -- renderable forever, §11), while the DELETE that would actually break an old guest
  -- link is refused by the constraint. Cascade was the other candidate and is wrong
  -- here twice over: it would delete a guest-visible artefact because of an upstream
  -- delete, and a cascade runs as the child's owner, so the guard triggers below
  -- could not see it.
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
    'invitation_versions(tradition_pack_release_id)->tradition_pack_releases=RESTRICT',
    'invitation_versions(wedding_id)->weddings=NOACTION',
    'invitation_versions(wedding_id+supersedes_version_id)->invitation_versions=NOACTION',
    'profiles(user_id)->auth.users=CASCADE',
    'publications(wedding_id)->weddings=NOACTION',
    'publications(wedding_id+version_id)->invitation_versions=NOACTION',
    'rsvp_responses(wedding_id)->weddings=CASCADE',
    'rsvp_responses(wedding_id+household_id+event_id)->household_event_scopes=NOACTION',
    'tradition_pack_releases(pack_id)->tradition_packs=RESTRICT',
    'tradition_pack_releases(reviewed_by)->auth.users=SETNULL',
    'user_roles(user_id)->auth.users=CASCADE',
    'venues(wedding_id)->weddings=CASCADE',
    'wedding_assets(wedding_id)->weddings=CASCADE',
    'wedding_events(wedding_id)->weddings=CASCADE',
    'wedding_events(wedding_id+venue_id)->venues=NOACTION',
    'wedding_people(wedding_id)->weddings=CASCADE',
    'weddings(design_template_id)->design_templates=RESTRICT',
    'weddings(owner_user_id)->auth.users=CASCADE',
    'weddings(tradition_pack_release_id)->tradition_pack_releases=RESTRICT'];
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
    -- catalog reviewers are read by pack/template, never searched by reviewer. Stage 4
    -- moved the reviewer FK onto the release row, where the same reasoning holds; the
    -- release->pack edge is *not* here because it is the leading column of
    -- UNIQUE (pack_id, release_number), which the catalogue read uses anyway.
    'design_templates->auth.users',
    'tradition_pack_releases->auth.users',
    -- created_by is attribution, not a query key; the row is deleted with its wedding
    'invitation_versions->auth.users',
    -- platform content is withdrawn by status, not deleted, so the RESTRICT check
    -- runs only in a migration. That is now the *designed* lifecycle for a pack
    -- release too: deprecating is a status write, and an approved-once release cannot
    -- be deleted at all (the guard refuses, and this key is what the refusal protects)
    'invitation_versions->design_templates',
    'invitation_versions->tradition_pack_releases',
    -- lineage walks one wedding's versions, which (wedding_id, ...) indexes cover
    'invitation_versions->invitation_versions',
    -- a venue is deleted after its events are un-pointed; venue_id alone is indexed
    'wedding_events->venues',
    'weddings->design_templates',
    'weddings->tradition_pack_releases'];
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
  PERFORM pg_temp.st2_ok('C05 every public table is one of the nineteen canonical ones',
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
  -- Stage 2 wrote this as one list of nineteen readable tables, and for eighteen of them that
  -- is still the shape. Naming the exception rather than dropping it is what keeps the
  -- inventory exact: a later `GRANT SELECT ON public.tradition_pack_releases TO authenticated`
  -- added for convenience would put the table back in the first list and fail C12 as a
  -- mismatch, instead of quietly widening a read path that §9 narrowed on purpose.
  PERFORM pg_temp.st2_ok('C12 authenticated has table-level SELECT on exactly the canonical tables minus the one whose read path is a column projection',
    (SELECT array_agg(c.relname::text ORDER BY c.relname)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
        AND has_table_privilege('authenticated', c.oid, 'SELECT')) = (SELECT array_agg(x ORDER BY x) FROM unnest(array_remove(public_tbls, 'tradition_pack_releases')) x));
  -- ... and that table is readable, not closed. The projection is measured from the catalogue
  -- rather than from this file's list, so a column added later and granted shows up here as a
  -- difference in a set, not as a comment nobody re-read.
  PERFORM pg_temp.st2_ok('C12b and exactly these seven columns of that table are nameable by a signed-in role — the release''s own identity, status, language coverage and reviewed wording, with the reviewer''s identity and qualification and the maintenance timestamps withheld',
    (SELECT array_agg(q.attname::text ORDER BY q.attname)
       FROM pg_attribute q
       JOIN pg_class c ON c.oid = q.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'tradition_pack_releases'
        AND q.attnum > 0 AND NOT q.attisdropped
        AND has_column_privilege('authenticated', 'public.tradition_pack_releases',
                                 q.attname, 'SELECT'))
      = (SELECT array_agg(x ORDER BY x) FROM unnest(release_read_cols) x));
  -- Three commands, three inventories. Stage 2 wrote this as one check over
  -- INSERT AND UPDATE AND DELETE, which could only ever describe a table a customer
  -- owned outright — and so it was blind to the difference this stage now depends on:
  -- `invitation_drafts` is UPDATE-able and nothing else. A single conjunctive list
  -- cannot express "can edit but cannot create", which is exactly the shape of the
  -- invariant, so the commands are asked separately.
  PERFORM pg_temp.st2_ok('C13a authenticated''s INSERT privileges are exactly the customer set minus the draft',
    (SELECT array_agg(c.relname::text ORDER BY c.relname)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
        AND has_table_privilege('authenticated', c.oid, 'INSERT')) =
      (SELECT array_agg(x ORDER BY x)
         FROM unnest(owner_insert_tbls || ARRAY['profiles']) x));
  PERFORM pg_temp.st2_ok('C13b authenticated''s UPDATE privileges are the customer set including the draft',
    (SELECT array_agg(c.relname::text ORDER BY c.relname)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
        AND has_table_privilege('authenticated', c.oid, 'UPDATE')) =
      (SELECT array_agg(x ORDER BY x)
         FROM unnest(owner_crud_tbls || ARRAY['profiles']) x));
  PERFORM pg_temp.st2_ok('C13c authenticated''s DELETE privileges are exactly the customer set minus the draft',
    (SELECT array_agg(c.relname::text ORDER BY c.relname)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
        AND has_table_privilege('authenticated', c.oid, 'DELETE')) =
      (SELECT array_agg(x ORDER BY x)
         FROM unnest(owner_insert_tbls || ARRAY['profiles']) x));
  -- The draft on its own, in both directions, because the three lists above would
  -- also be satisfied by a table nobody can write at all. The trusted backend keeps
  -- every command: repair and erasure have to remain possible.
  PERFORM pg_temp.st2_ok('C13d the draft is readable and editable by a customer, never created or removed by one',
    has_table_privilege('authenticated', 'public.invitation_drafts', 'SELECT')
    AND has_table_privilege('authenticated', 'public.invitation_drafts', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.invitation_drafts', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.invitation_drafts', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.invitation_drafts', 'SELECT, INSERT, UPDATE, DELETE')
    AND has_table_privilege('service_role', 'public.invitation_drafts',
                            'SELECT, INSERT, UPDATE, DELETE'));
  PERFORM pg_temp.st2_ok('C14 no API role can name a private or legacy table',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r' AND n.nspname IN ('private','legacy')
                   AND (has_table_privilege('anon', c.oid, 'SELECT')
                     OR has_table_privilege('authenticated', c.oid, 'SELECT'))));
  PERFORM pg_temp.st2_ok('C15 service_role can reach the canonical and server schema',
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname IN ('public','private')
        AND has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE')) = 21::bigint);
  PERFORM pg_temp.st2_ok('C16 service_role holds nothing in legacy',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r' AND n.nspname = 'legacy'
                   AND has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE')));
  -- Two different claims, so two checks: a browser role reaches one schema, and the
  -- trusted backend reaches two. `private` for service_role is the design (it writes
  -- the audit trail and presents credentials); `legacy` for anyone is not.
  --
  -- Stage 3 adds a third namespace to the browser roles' reach: `api`, which holds no
  -- table and exists only so the callable boundary has a home of its own. That makes
  -- "which schemas can a client name" a load-bearing fact rather than a detail, so
  -- this is the check that notices a fourth one arriving.
  --
  -- The closure repair's `internal_api` is the fourth, and it arrives *with* a reason
  -- written down rather than after one: nested execution from a SECURITY INVOKER wrapper
  -- is permission-checked as the invoking role, so a client that may call the wrapper
  -- must be able to name the implementation (C26f pins the mirror exactly). Being
  -- nameable in SQL is not being reachable over HTTP — `internal_api` is absent from the
  -- schemas PostgREST serves, which `stage3_security.test.mjs` measures from the outside
  -- rather than trusting this file to know.
  PERFORM pg_temp.st2_set('C17 schema USAGE for the browser roles is public plus the two RPC schemas',
    (SELECT array_agg(r.rolname || ':' || n.nspname ORDER BY r.rolname, n.nspname)
       FROM (VALUES ('anon'),('authenticated')) r(rolname)
       JOIN pg_namespace n ON n.nspname IN ('public','api','private','legacy','internal_api')
      WHERE has_schema_privilege(r.rolname, n.nspname, 'USAGE')),
    ARRAY['anon:api','anon:internal_api','anon:public',
          'authenticated:api','authenticated:internal_api','authenticated:public']);
  PERFORM pg_temp.st2_set('C17b schema USAGE for service_role excludes the archive',
    (SELECT array_agg(n.nspname ORDER BY n.nspname)
       FROM pg_namespace n
      WHERE n.nspname IN ('public','api','private','legacy','internal_api')
        AND has_schema_privilege('service_role', n.nspname, 'USAGE')),
    ARRAY['private','public']);
  -- The server key deliberately cannot reach the browser boundary. It has no need to:
  -- every operation `api` offers is a re-derivation of ownership from `auth.uid()`,
  -- which a trusted role does not have. If this ever has to flip, the reason belongs
  -- in the migration that flips it, not here.
  PERFORM pg_temp.st2_ok('C17c service_role holds no USAGE on the browser RPC schema',
    NOT has_schema_privilege('service_role', 'api', 'USAGE')
    AND NOT has_schema_privilege('service_role', 'api', 'CREATE'));
  -- `api` is a callable surface, not a data surface. Anything else living there would
  -- mean the separation this schema exists to draw has been blurred.
  PERFORM pg_temp.st2_ok('C17d the RPC schema holds functions only — no tables, views or sequences',
    NOT EXISTS (SELECT 1 FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'api')
    AND EXISTS (SELECT 1 FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'api'));
  -- Same rule for the schema that holds the privileged bodies, stated separately because
  -- the reason is sharper: an `internal_api` that grew a table would be a table in a
  -- schema with no RLS, no exposed profile and no policy review — the worst of both.
  PERFORM pg_temp.st2_ok('C17d2 the privileged schema holds functions only, and no policy is defined in it',
    NOT EXISTS (SELECT 1 FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'internal_api')
    AND NOT EXISTS (SELECT 1 FROM pg_policy pol
                      JOIN pg_class c ON c.oid = pol.polrelid
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'internal_api')
    AND EXISTS (SELECT 1 FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'internal_api'));
  -- The privileged half of C17c. `service_role` is the role a trusted backend uses to
  -- write these tables directly, so handing it a browser's RPC bodies would be a second,
  -- weaker way of doing what it already does exactly. `anon` may not CREATE in the
  -- schema either, which is the difference between "usable for nested execution" and
  -- "somebody can add to it".
  PERFORM pg_temp.st2_ok('C17e no role may add to or take the privileged schema as a server key',
    NOT has_schema_privilege('service_role', 'internal_api', 'USAGE')
    AND NOT has_schema_privilege('service_role', 'internal_api', 'CREATE')
    AND NOT has_schema_privilege('anon', 'internal_api', 'CREATE')
    AND NOT has_schema_privilege('authenticated', 'internal_api', 'CREATE'));

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
     WHERE n.nspname = 'public' AND pol.polcmd = 'r') = 19::bigint);
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
  -- status or by what has been approved rather than by possession — and that exemption
  -- is named here so a third one has to be argued for before it can ship.
  --
  -- The release table used to be one of them and no longer is. Ruling A1 requires a host
  -- to keep reading the *deprecated* release their own wedding selected, which is a
  -- statement about possession, so that policy names auth.uid() like every other
  -- customer-facing one. Being dropped from this exemption list is therefore the
  -- assertion: an approved release is still visible to everyone, and the only widening is
  -- per-host. stage4/50_pack_release.sql measures the behaviour both ways.
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
          'tradition_packs.users_read_packs_with_approved_releases=r']);
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
  -- SECURITY DEFINER inventory, from the catalog (Phase 74).
  --
  -- Stage 2 wrote this as "one is expected; a second would have to earn its place
  -- here before it can ship". Stage 3 collected the seven callable boundary
  -- functions of the published invitation, and made the signup-adjacent draft
  -- trigger a definer so the one-draft-per-wedding invariant could be closed. Nine
  -- names still stand here — the closure repair moved seven of them between schemas
  -- rather than adding an eighth, which is the point of the change — but *which* nine
  -- is now the interesting fact: after independent review the privileged bodies left
  -- the exposed `api` schema, whose wrappers are SECURITY INVOKER one-liners, and the
  -- definers live in `internal_api`, which PostgREST does not serve. Each name here is
  -- either a privileged body a browser role can only reach through the wrapper beside
  -- it, or a function no role can call at all and only the executor of a trigger
  -- reaches (the two in `private`). The grant set beside each is asserted by
  -- C28a/C28b/C26f/C30 rather than asserted in a comment.
  --
  -- What did NOT change is the reason the check exists: a definer function is the
  -- one shape in this schema that can act above its caller, so the list is the
  -- audit surface, and a new name arriving here must be readable in one line.
  --
  -- The declared set is therefore built per head: the Stage 2-4 base, plus the name each later
  -- stage added. Nothing from Stage 5 onwards is folded into the base, so this line still says
  -- which head introduced which definer — and a head that declares Stage 5 against a schema that
  -- has no such definer fails, exactly as it should.
  PERFORM pg_temp.st2_set('C26 SECURITY DEFINER functions are exactly the privileged publication implementations plus the two trigger definers',
    (SELECT array_agg(p ORDER BY p) FROM (
       SELECT n.nspname || '.' || p.proname AS p
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')) s),
    (SELECT array_agg(x ORDER BY x) FROM unnest(
        ARRAY['internal_api.create_invitation_version',
              'internal_api.get_invitation_publication_state',
              'internal_api.preview_invitation',
              'internal_api.publish_invitation_version',
              'internal_api.resolve_public_invitation',
              'internal_api.revoke_invitation_publication',
              'internal_api.rotate_invitation_token',
              'private.attach_draft_on_wedding_create',
              'private.handle_new_user']
        -- Stage 5 §7: the document preview is the eighth privileged body, reached through the
        -- wrapper beside it and by nothing else.
        || CASE WHEN pg_temp.st2_at_least('stage5')
                THEN ARRAY['internal_api.preview_invitation_document']
                ELSE ARRAY[]::text[] END) x));
  PERFORM pg_temp.st2_ok('C27 every SECURITY DEFINER function pins its search_path',
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')
                   AND p.proconfig::text NOT LIKE '%search_path%'));
  -- The other half of the split C26 only partly states: `api` being absent from the
  -- definer list is a fact worth pinning on its own, because "we moved the privileged
  -- bodies" is only true if nothing privileged stayed behind. A wrapper that kept
  -- `SECURITY DEFINER` while delegating to a definer would escalate twice and read as
  -- a single hop to anyone auditing the exposed surface.
  PERFORM pg_temp.st2_ok('C26b nothing exposed through the Data API acts above its caller',
    NOT EXISTS (SELECT 1 FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'api' AND p.prosecdef));
  -- C27 pins the search_path for every definer, which covers `internal_api` already.
  -- The wrappers need the same pinning for a different reason: they resolve the name
  -- `internal_api` themselves, so an inherited path is a steering opportunity — the one
  -- thing an otherwise empty function body could still be made to carry.
  PERFORM pg_temp.st2_ok('C26c every exposed wrapper pins its search_path',
    NOT EXISTS (SELECT 1 FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'api'
                   AND p.proconfig::text NOT LIKE '%search_path%'));
  -- A wrapper is only as trustworthy as how little it decides. This reads the stored
  -- source and accepts exactly one qualified delegation, so a wrapper that grew an `IF`,
  -- a second call or an ownership test of its own would fail here rather than in review.
  -- A text check on purpose: it is proving the absence of logic, which no behavioural
  -- test can show, and it is the shape C63b's limitation makes worth watching.
  --
  -- The wrapper count is the head's, not a constant: eight from Stage 5, which added the
  -- document preview. Every wrapper still has to be one line, whatever the number is.
  PERFORM pg_temp.st2_ok('C26d each wrapper is one fully-qualified delegation to its own implementation',
    (SELECT count(*) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'api') = (CASE WHEN pg_temp.st2_at_least('stage5') THEN 8 ELSE 7 END)
    AND NOT EXISTS (SELECT 1 FROM pg_proc p
                      JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'api'
                       -- body must begin with the delegation …
                       AND (p.prosrc !~ ('^[[:space:]]*SELECT[[:space:]]+internal_api\.'
                                         || p.proname || '\(')
                       -- … and be nothing but it: one qualified reference, one statement
                            OR (SELECT count(*) FROM regexp_matches(p.prosrc,
                                      'internal_api\.', 'g')) <> 1
                            OR (SELECT count(*) FROM regexp_matches(p.prosrc,
                                      ';', 'g')) <> 1)));
  -- The implementations are the same names the wrappers have, and no eighth arrived to sit in the
  -- unexposed schema where no HTTP request can reach it — except that from Stage 5 the census is
  -- deliberately asymmetric, so it is written as the head's own set: the paired bodies, plus the
  -- pack-maintenance bodies that have no wrapper because a browser must not be able to call them at
  -- all. Which eleven those are, and that they carry no browser grant, is measured by
  -- `supabase/tests/stage3/30_publication.sql` G1f/G1g and by Stage 5's own suites; this line is the
  -- tripwire that notices a twelfth arriving.
  PERFORM pg_temp.st2_set('C26e internal_api holds exactly the paired implementations plus the maintenance bodies its declared head adds',
    (SELECT array_agg(p ORDER BY p) FROM (
       SELECT p.proname AS p FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'internal_api') s),
    (SELECT array_agg(x ORDER BY x) FROM unnest(
        ARRAY['create_invitation_version',
              'get_invitation_publication_state',
              'preview_invitation',
              'publish_invitation_version',
              'resolve_public_invitation',
              'revoke_invitation_publication',
              'rotate_invitation_token']
        || CASE WHEN pg_temp.st2_at_least('stage5')
                THEN ARRAY['preview_invitation_document',
                           'approve_tradition_pack_release',
                           'create_tradition_pack',
                           'create_tradition_pack_release',
                           'deprecate_tradition_pack_release',
                           'get_tradition_pack_review_packet',
                           'inspect_tradition_pack_release',
                           'submit_tradition_pack_review',
                           'tradition_pack_catalog',
                           'tradition_pack_retention_report',
                           'update_draft_tradition_pack_release',
                           'validate_tradition_pack_release']
                ELSE ARRAY[]::text[] END) x));
  -- Posture and caller matrix, paired by name. The wrappers are definers' delegates, so
  -- two things must hold: every implementation is a pinned definer, and a role that can
  -- call a wrapper can call its implementation and no more — which is what makes the
  -- nested-execution grant a consequence of the design rather than an oversight in it.
  -- `service_role` appears on neither side, asserted in the same pass.
  PERFORM pg_temp.st2_ok('C26f every implementation is a pinned definer whose caller matrix mirrors its wrapper',
    (SELECT count(*) FROM pg_proc impl
        JOIN pg_namespace n ON n.oid = impl.pronamespace
        JOIN pg_proc wrap ON wrap.proname = impl.proname
        JOIN pg_namespace wn ON wn.oid = wrap.pronamespace
       WHERE n.nspname = 'internal_api' AND wn.nspname = 'api')
      = (CASE WHEN pg_temp.st2_at_least('stage5') THEN 8 ELSE 7 END)
    AND NOT EXISTS (SELECT 1 FROM pg_proc impl
                      JOIN pg_namespace n ON n.oid = impl.pronamespace
                      JOIN pg_proc wrap ON wrap.proname = impl.proname
                      JOIN pg_namespace wn ON wn.oid = wrap.pronamespace
                     WHERE n.nspname = 'internal_api' AND wn.nspname = 'api'
                       AND (NOT impl.prosecdef
                         OR impl.proconfig::text NOT LIKE '%search_path%'
                         OR has_function_privilege('anon', impl.oid, 'EXECUTE')
                            IS DISTINCT FROM
                            has_function_privilege('anon', wrap.oid, 'EXECUTE')
                         OR has_function_privilege('authenticated', impl.oid, 'EXECUTE')
                            IS DISTINCT FROM
                            has_function_privilege('authenticated', wrap.oid, 'EXECUTE')
                         OR has_function_privilege('service_role', impl.oid, 'EXECUTE')
                         OR has_function_privilege('service_role', wrap.oid, 'EXECUTE'))));
  -- Stage 2's C28 read "no SECURITY DEFINER function is executable by anon or
  -- authenticated", which was true only because nothing of ours was a definer at
  -- all. Replaced by two statements that carry the same weight and survive the
  -- change: the anonymous callable surface is exactly one function, and the full
  -- callable set of a signed-in role is named row by row.
  --
  -- `auth` is excluded because the local shim defines auth.uid()/auth.role() with
  -- the implicit PUBLIC execute that no ALTER DEFAULT PRIVILEGES can remove
  -- (measured, Stage 2 file 1) — those two are not our surface and cannot be.
  -- `api` is included because it is where the callable surface lives, and
  -- `internal_api` because "not served by PostgREST" is a property of the gateway's
  -- schema list, not of the database's privilege map: from inside SQL, the fourteen
  -- names below are all one call apart, and this assertion is what keeps that set from
  -- growing quietly. The HTTP-side half of the claim — that a request cannot name
  -- `internal_api` at all — is measured by `supabase/tests/api/stage3_security.test.mjs`.
  PERFORM pg_temp.st2_set('C28a the anonymous callable surface is the resolver and its implementation',
    (SELECT array_agg(p ORDER BY p) FROM (
       SELECT n.nspname || '.' || p.proname AS p
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public','api','private','legacy','internal_api')
          AND has_function_privilege('anon', p.oid, 'EXECUTE')) s),
    ARRAY['api.resolve_public_invitation',
          'internal_api.resolve_public_invitation']);
  PERFORM pg_temp.st2_set('C28b a signed-in caller reaches exactly the wrappers and their implementations, as one set named by signature',
    (SELECT array_agg(p ORDER BY p) FROM (
       SELECT n.nspname || '.' || p.proname AS p
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public','api','private','legacy','internal_api')
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) s),
    -- Fourteen names when this was written, sixteen from Stage 5, which paired one more wrapper
    -- with one more body. The pack-maintenance bodies are absent from both lists because they are
    -- granted to nobody a browser can be — that is C26e's asymmetry, checked here from the other
    -- side: an EXECUTE that appeared for one of them would show up as a diff in this set.
    (SELECT array_agg(x ORDER BY x) FROM unnest(
        ARRAY['api.create_invitation_version',
              'api.get_invitation_publication_state',
              'api.preview_invitation',
              'api.publish_invitation_version',
              'api.resolve_public_invitation',
              'api.revoke_invitation_publication',
              'api.rotate_invitation_token',
              'internal_api.create_invitation_version',
              'internal_api.get_invitation_publication_state',
              'internal_api.preview_invitation',
              'internal_api.publish_invitation_version',
              'internal_api.resolve_public_invitation',
              'internal_api.revoke_invitation_publication',
              'internal_api.rotate_invitation_token']
        || CASE WHEN pg_temp.st2_at_least('stage5')
                THEN ARRAY['api.preview_invitation_document',
                           'internal_api.preview_invitation_document']
                ELSE ARRAY[]::text[] END) x));
  -- Stage 2 asserted "no function at all lives in public", and said why in its own
  -- comment: a function in `public` is reachable by name through the data API, so an
  -- empty `public` meant the data API could not be asked to run anything of ours.
  -- Stage 3 needs callable functions, and this is where the schema answers instead of
  -- the comment: the callables went to a separate, deliberately exposed `api`
  -- namespace, so the original assertion is restored at full strength rather than
  -- weakened to fit. `public` is data and RLS only; `api` is behaviour only.
  PERFORM pg_temp.st2_ok('C29 no function at all lives in public',
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public'));
  -- ... and the counterpart, since C29 alone would also be satisfied by a schema that
  -- grew no boundary at all. The list is exact: an eighth callable would have to be
  -- named here before it could ship — and from the Stage 5 head it has been, so the
  -- eighth name is declared with the head that introduced it rather than merged into
  -- the base.
  PERFORM pg_temp.st2_set('C29a the callable boundary is exactly the named RPCs this head declares',
    (SELECT array_agg(p ORDER BY p) FROM (
       SELECT p.proname AS p FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'api') s),
    (SELECT array_agg(x ORDER BY x) FROM unnest(
        ARRAY['create_invitation_version',
              'get_invitation_publication_state',
              'preview_invitation',
              'publish_invitation_version',
              'resolve_public_invitation',
              'revoke_invitation_publication',
              'rotate_invitation_token']
        || CASE WHEN pg_temp.st2_at_least('stage5')
                THEN ARRAY['preview_invitation_document']
                ELSE ARRAY[]::text[] END) x));
  -- Zero arguments is not a style preference. It is the mechanism behind
  -- "the credential never appears in a query string": with no parameter to name, a
  -- request that puts `?p_token=` in a URL cannot be resolved to a function at all,
  -- which `supabase/tests/api/stage3_security.test.mjs` measures from the outside.
  PERFORM pg_temp.st2_ok('C29b the anonymous resolver takes no arguments',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api' AND p.proname = 'resolve_public_invitation'
        AND p.pronargs = 0) = 1);
  -- The six host operations take exactly the arguments their signature declares and
  -- no more: a caller supplies identifiers, never an owner id. `p_owner_user_id`
  -- appearing anywhere in this schema would mean a request body could name a victim.
  PERFORM pg_temp.st2_ok('C29c no callable takes a user or role identity as an argument',
    NOT EXISTS (SELECT 1 FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                  JOIN LATERAL unnest(p.proargnames) AS a(argname) ON true
                 WHERE n.nspname IN ('api','internal_api','private','public')
                   AND a.argname ~* 'user_id|owner|role|uid'));
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
    -- Sorted on both sides, so a later stage's additions can be declared in the order that
    -- explains them rather than in collation order.
    (SELECT array_agg(x ORDER BY x) FROM unnest(
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
      -- Stage 4 §11: a frozen version may only point at the release its wedding
      -- pointed at when it was frozen. INVOKER, and reads as the calling role, so a
      -- freeze cannot be laundered through a definer that sees more than the host does.
      'public.invitation_versions.versions_pack_release_gate=require_frozen_pack_release',
      'public.publications.publications_no_client_write=reject_client_write',
      'public.publications.set_updated_at=touch_updated_at',
      'public.rsvp_responses.set_updated_at=touch_updated_at',
      -- Stage 4: the release row's own lifecycle gate plus the standard write and delete
      -- guards. All three are INVOKER — a guard that reported anything other than the
      -- role which issued the statement would be a guard with a privilege of its own to
      -- use. Same-name-order rule as the other guarded tables, so on an UPDATE the
      -- browser role is refused by `no_client_write_*` before the lifecycle gate sees
      -- the row, and the gate fires last on INSERT/UPDATE/DELETE; that ordering is what
      -- 20_attacks.sql group 8b measures from a customer role, and the gate's own
      -- transitions are group 15.
      'public.tradition_pack_releases.no_client_delete_tradition_pack_releases=reject_client_delete',
      'public.tradition_pack_releases.no_client_write_tradition_pack_releases=reject_client_write',
      'public.tradition_pack_releases.set_updated_at=touch_updated_at',
      'public.tradition_pack_releases.tradition_pack_release_guard=guard_tradition_pack_release',
      'public.tradition_packs.no_client_write_tradition_packs=reject_client_write',
      'public.tradition_packs.set_updated_at=touch_updated_at',
      'public.venues.set_updated_at=touch_updated_at',
      'public.wedding_assets.set_updated_at=touch_updated_at',
      'public.wedding_events.set_updated_at=touch_updated_at',
      'public.wedding_people.set_updated_at=touch_updated_at',
      'public.weddings.set_updated_at=touch_updated_at',
      -- Stage 3 §3: the wedding/draft pairing invariant. Installed by file
      -- 20260926120000 as an INVOKER trigger authorised by the owner's own INSERT
      -- policy, and made SECURITY DEFINER by file 20260926140000 when that policy was
      -- dropped — because the alternative to defining it was leaving the invariant
      -- open to an owner delete. It is in this inventory because this assertion is the
      -- alarm for a trigger arriving or disappearing without being qualified.
      'public.weddings.weddings_have_draft=attach_draft_on_wedding_create',
      -- Stage 4 §10: a wedding may only point at an *approved* release. INVOKER, and it
      -- reads the release as the calling role, so a host cannot select a release through
      -- a definer that sees rows the host was never shown.
      'public.weddings.weddings_pack_release_gate=require_approved_pack_release']
        -- Stage 6 has no definer in this group (see C32), and the census is unfiltered, so the
        -- platform's own Storage triggers arrive here too: the three that mint and guard the
        -- asset registry, and the six that protect `storage.buckets` / `storage.objects`. They
        -- are listed because they are measured — an inventory that quietly ignores a schema it
        -- did not write is an inventory that cannot notice one disappearing either.
        || CASE WHEN pg_temp.st2_at_least('stage6')
                THEN ARRAY[
                  'public.wedding_assets.wedding_assets_mint_object_key=mint_wedding_asset_object_key',
                  'public.wedding_assets.wedding_assets_guard_update=guard_wedding_asset_update',
                  'public.wedding_assets.wedding_assets_guard_delete=guard_wedding_asset_delete',
                  'storage.buckets.enforce_bucket_name_length_trigger=enforce_bucket_name_length',
                  'storage.buckets.protect_bucket_control_insert=protect_bucket_control_columns',
                  'storage.buckets.protect_bucket_control_update=protect_bucket_control_columns',
                  'storage.buckets.protect_buckets_delete=protect_delete',
                  'storage.objects.protect_objects_delete=protect_delete',
                  'storage.objects.update_objects_updated_at=update_updated_at_column']
                ELSE ARRAY[]::text[] END) x));
  -- The guards are INVOKER by design (they must report the role that issued the
  -- statement), so a DEFINER guard would mean the guard had a privilege of its own to
  -- use. That is the property this check carried in Stage 2, when the whole schema had
  -- one definer and no canonical table any. Stage 3 added a second definer, and it is
  -- a trigger on a canonical table, so the blanket form of the claim became false —
  -- the honest repair is to name the exception and keep the rule:
  --   * every `reject_client_*` / `touch_updated_at` guard is INVOKER (C32b), and
  --   * exactly one canonical table carries a definer trigger, and it is this one (C32).
  PERFORM pg_temp.st2_set('C32 the only SECURITY DEFINER trigger on a canonical table is the draft pairing',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT n.nspname || '.' || c.relname || '.' || t.tgname AS x
         FROM pg_trigger t
         JOIN pg_proc p ON p.oid = t.tgfoid
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND p.prosecdef
          AND n.nspname IN ('public','private')) s),
    ARRAY['public.weddings.weddings_have_draft']);
  PERFORM pg_temp.st2_ok('C32b no write guard or timestamp trigger is SECURITY DEFINER',
    NOT EXISTS (SELECT 1 FROM pg_trigger t
                  JOIN pg_proc p ON p.oid = t.tgfoid
                 WHERE NOT t.tgisinternal AND p.prosecdef
                   AND p.proname IN ('reject_client_write','reject_client_delete',
                                     'touch_updated_at',
                                     -- Stage 4's three pack gates. Named here because
                                     -- each one reads a row it is deciding about, and a
                                     -- definer body would decide against the privileged
                                     -- schema's view rather than the caller's — which is
                                     -- exactly the difference between "this release is
                                     -- not approved" and "this release is invisible to
                                     -- you", and only the second is a secret.
                                     'guard_tradition_pack_release',
                                     'require_approved_pack_release',
                                     'require_frozen_pack_release')));
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
  PERFORM pg_temp.st2_set('C42b the quantity columns are exactly the eight expected',
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
    -- Stage 4's entry is not a bookkeeping number: `release_number` is the ordinal that
    -- makes "revise this pack" mean *insert a row* rather than edit one, so a bound on it
    -- (and the UNIQUE (pack_id, release_number) key) is part of the immutability claim.
    ARRAY['guest_households.expected_party_size','invitation_versions.version_number',
          'rsvp_responses.party_size','tradition_pack_releases.release_number',
          'wedding_assets.size_bytes',
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
  -- to test it is to make one. This block creates a table, a sequence and three
  -- functions, asks what each role can actually do with them, and drops them again in
  -- the same breath. run.sh applies each file with `psql --single-transaction`, which
  -- *commits* when the file succeeds rather than rolling it back, so the objects have
  -- to be dropped here and C70 asserts that they were.
  EXECUTE 'CREATE TABLE public.st2_probe_dp (id integer)';
  EXECUTE 'CREATE SEQUENCE public.st2_probe_seq_dp';
  EXECUTE 'CREATE FUNCTION public.st2_probe_fn_dp() RETURNS integer LANGUAGE sql AS $body$ SELECT 1 $body$';
  EXECUTE 'CREATE FUNCTION private.st2_probe_fn_dp() RETURNS integer LANGUAGE sql AS $body$ SELECT 1 $body$';
  EXECUTE 'CREATE FUNCTION api.st2_probe_fn_dp() RETURNS integer LANGUAGE sql AS $body$ SELECT 1 $body$';
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
  -- migration 20260925120000). Stage 2's answer was to keep `public` empty of
  -- functions. Stage 3 needed callable functions and did not want to reopen `public`,
  -- so it moved the callables to `api` — which changes what protects them, not how
  -- much they need protecting: a schema a client has USAGE on is a schema whose
  -- un-revoked functions that client can run, as this probe is about to show. The
  -- defence is therefore the per-object revoke plus three exact inventories — C29a
  -- lists every function in `api`, C28a every one `anon` may execute, C28b every one
  -- a signed-in caller may execute. A future forgotten revoke shows up as C28a
  -- reporting two names. If a future Postgres changes the default-ACL behaviour,
  -- delete this check and the sentence above it; do not flip it, or it stops
  -- describing anything.
  PERFORM pg_temp.st2_ok('C63 (limitation, not a goal) default privileges cannot revoke PUBLIC EXECUTE',
    pg_temp.st2_state('SELECT public.st2_probe_fn_dp()', 'anon') = '00000'
    AND has_function_privilege('anon', 'public.st2_probe_fn_dp()', 'EXECUTE'));
  -- The same limitation restated for the schema Stage 3 actually added, because the
  -- tempting wrong reading of `api` is "a private namespace a client happens to be
  -- allowed into", which a forgotten revoke would turn into a callable surface with no
  -- inventory noticing. USAGE is what makes C28a load-bearing.
  PERFORM pg_temp.st2_ok('C63b a forgotten revoke in api is reachable, which is why C28a exists',
    has_schema_privilege('anon', 'api', 'USAGE')
    AND pg_temp.st2_state('SELECT api.st2_probe_fn_dp()', 'anon') = '00000');
  -- And in the schema the closure repair added, where it matters more: `internal_api`
  -- carries USAGE for the browser roles because nested execution needs it (see the
  -- migration header), so an un-revoked function there would be SQL-callable by a
  -- signed-in role the same way. What protects it is not a revoke nobody can rely on
  -- being remembered, it is that no HTTP request can name the schema — asserted from
  -- outside in `stage3_security.test.mjs`, because this file cannot see the gateway.
  EXECUTE 'CREATE FUNCTION internal_api.st2_probe_fn_dp() RETURNS integer LANGUAGE sql AS $body$ SELECT 1 $body$';
  PERFORM pg_temp.st2_ok('C63c a forgotten revoke in internal_api is equally reachable by SQL, so non-exposure is measured over HTTP',
    has_schema_privilege('anon', 'internal_api', 'USAGE')
    AND pg_temp.st2_state('SELECT internal_api.st2_probe_fn_dp()', 'anon') = '00000');

  EXECUTE 'DROP FUNCTION internal_api.st2_probe_fn_dp()';

  EXECUTE 'DROP FUNCTION api.st2_probe_fn_dp()';
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

  -- ===================== 13b. the pack lifecycle is a schema property (Stage 4 §5, §6)
  -- 20_attacks.sql group 15 proves a customer cannot walk a release through the
  -- lifecycle. This section asks the quieter question: is the lifecycle even *encoded*,
  -- or does it live inside a trigger body where a later migration could rewrite it
  -- without anything noticing? A stage whose whole purpose is "content is reviewed,
  -- versioned and explicitly selected" has to be able to fail when the vocabulary of
  -- review stops being a fact about the table.
  --
  -- Each expectation below was read off the migrated schema. They compare *normalised*
  -- constraint definitions (whitespace collapsed) rather than generated constraint names,
  -- because an unnamed table-level CHECK is auto-named `tradition_pack_releases_checkN`
  -- and Postgres renumbers those in column order — a column added above one silently
  -- retargets any test that asserts on the number. The definition is the claim itself.
  --
  -- The six rules this stage depends on are therefore named in the migration, and C72b
  -- below is what makes the naming a contract rather than a style choice: 20_attacks.sql
  -- group 15 asserts that a forged promotion is refused *by the constraint called
  -- `review_metadata_is_mandatory`, and a refusal that names a constraint nobody pinned
  -- would be a test of whichever rule happened to hold that number.
  PERFORM pg_temp.st2_set('C71a a release status is one of exactly four lifecycle states',
    (SELECT array_agg(v ORDER BY v) FROM (
       SELECT (regexp_matches(
                 pg_get_constraintdef(k.oid), '''([a-z_]+)''::text', 'g'))[1] AS v
         FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        WHERE c.relname = 'tradition_pack_releases' AND k.contype = 'c'
          -- the vocabulary rule specifically, not the four pairing rules that also
          -- mention `status` — matched on the shape of the expression for the same
          -- reason the closed set below is: generated names are Postgres' to change
          AND pg_get_constraintdef(k.oid) LIKE 'CHECK ((status = ANY%') s),
    ARRAY['approved','deprecated','draft','reviewed']);
  -- The language vocabulary is bounded for a different reason than the status one: a
  -- release may only claim locales this product can actually render, so an unserved
  -- language cannot be approved into existence and then silently fall back to English.
  -- §14 forbids pretending an English string is Tamil, and this is the schema half of
  -- that sentence.
  PERFORM pg_temp.st2_set('C71b a release claims only languages the product serves',
    (SELECT array_agg(v ORDER BY v) FROM (
       SELECT (regexp_matches(
                 pg_get_constraintdef(k.oid), '''([a-z_]+)''::text', 'g'))[1] AS v
         FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        WHERE c.relname = 'tradition_pack_releases' AND k.contype = 'c'
          AND pg_get_constraintdef(k.oid) LIKE '%(cardinality(languages) > 0)%') s),
    ARRAY['en','kn','ml','ta','te']);
  -- Five rules, as a closed set: draft carries no review record at all; a reviewed
  -- release carries the whole one; "approved" and "deprecated" each mean exactly one
  -- timestamp and nothing else; and the vocabulary check above. The pairing is what
  -- makes promotion unforgable — a client that sets `status = 'approved'` without the
  -- review record hits this, and one that sets it *with* a fabricated record still has
  -- to pass the transition guard, which group 15 measures from both sides.
  PERFORM pg_temp.st2_set('C72 the lifecycle is five paired CHECKs on the release row, no more',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT regexp_replace(pg_get_constraintdef(k.oid), '\s+', ' ', 'g') AS x
         FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        WHERE c.relname = 'tradition_pack_releases' AND k.contype = 'c'
          AND pg_get_constraintdef(k.oid) LIKE '%status%') s),
    ARRAY[
      'CHECK (((status <> ''draft''::text) OR ((review_label IS NULL) AND (review_basis IS NULL) AND (review_scope IS NULL) AND (reviewed_languages IS NULL) AND (reviewed_by IS NULL) AND (reviewed_at IS NULL) AND (approved_at IS NULL) AND (deprecated_at IS NULL))))',
      'CHECK (((status <> ALL (ARRAY[''reviewed''::text, ''approved''::text, ''deprecated''::text])) OR ((review_label IS NOT NULL) AND (review_basis IS NOT NULL) AND (review_scope IS NOT NULL) AND (reviewed_languages IS NOT NULL) AND (reviewed_at IS NOT NULL))))',
      'CHECK (((status = ''deprecated''::text) = (deprecated_at IS NOT NULL)))',
      'CHECK (((status = ANY (ARRAY[''approved''::text, ''deprecated''::text])) = (approved_at IS NOT NULL)))',
      'CHECK ((status = ANY (ARRAY[''draft''::text, ''reviewed''::text, ''approved''::text, ''deprecated''::text])))']);
  -- The named half of the same fact: every rule this stage's refusals quote by name, and
  -- nothing else that was named by hand. Auto-generated column checks are excluded by
  -- shape (`<table>_<column>_check`), so this is a closed list of the rules whose *identity*
  -- is load-bearing. A seventh appears here the moment someone names a rule in the
  -- migration, and one that loses its name disappears from this list — which is the
  -- failure mode 20_attacks.sql would otherwise report as a wrong-constraint mystery.
  PERFORM pg_temp.st2_set('C72b the release rules this stage quotes by name are exactly six named CHECKs',
    (SELECT array_agg(k.conname ORDER BY k.conname)
       FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      WHERE c.relname = 'tradition_pack_releases' AND k.contype = 'c'
        AND left(k.conname, length(c.relname) + 1) <> c.relname || '_'),
    ARRAY['approved_at_matches_status','deprecated_at_matches_status',
          'draft_carries_no_review_metadata','machine_assistance_disclosure_required',
          'review_metadata_is_mandatory','reviewed_languages_are_supported_ones']);
  -- §5: the pack body is "NOT arbitrary JSON". Two halves — the column is jsonb with an
  -- object CHECK (so it can be inspected by `jsonb_typeof` and by the section resolver,
  -- and is versioned by `definition_schema_version`), and no content column anywhere in
  -- the canonical schema is the weaker `json` type, which would quietly skip every
  -- containment or type assertion a later migration thought it was making.
  PERFORM pg_temp.st2_ok('C73a a pack definition is a versioned jsonb object, not free-form text',
    (SELECT ty.typname FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_type ty ON ty.oid = a.atttypid
      WHERE c.relname = 'tradition_pack_releases' AND a.attname = 'definition') = 'jsonb'
    AND EXISTS (SELECT 1 FROM pg_constraint k
                  JOIN pg_class c ON c.oid = k.conrelid
                 WHERE c.relname = 'tradition_pack_releases' AND k.contype = 'c'
                   AND pg_get_constraintdef(k.oid)
                       LIKE '%jsonb_typeof(definition) = ''object''%')
    AND EXISTS (SELECT 1 FROM pg_constraint k
                  JOIN pg_class c ON c.oid = k.conrelid
                 WHERE c.relname = 'tradition_pack_releases' AND k.contype = 'c'
                   AND pg_get_constraintdef(k.oid) LIKE '%(definition_schema_version > 0)%'));
  PERFORM pg_temp.st2_ok('C73b no jsonb-carrying column in the canonical schema is plain json',
    NOT EXISTS (SELECT 1 FROM pg_attribute a
                  JOIN pg_class c ON c.oid = a.attrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                  JOIN pg_type ty ON ty.oid = a.atttypid
                 WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind = 'r'
                   AND n.nspname IN ('public','private') AND ty.typname = 'json'));
  -- §10: "No tradition pack / Write my own" is the *default* state of a wedding, so it
  -- has to be representable without inventing a sentinel row that a guest could
  -- otherwise be served. A nullable column with no default is that representation; a
  -- NOT NULL version of this table would have forced a fake pack into existence, and
  -- that is the kind of decision worth failing a build over.
  PERFORM pg_temp.st2_ok('C74 selecting no tradition pack is a schema state, not a sentinel row',
    (SELECT count(*) FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname IN ('weddings','invitation_versions')
        AND a.attname = 'tradition_pack_release_id'
        AND NOT a.attnotnull
        AND NOT EXISTS (SELECT 1 FROM pg_attrdef d
                         WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum)) = 2::bigint);
  -- §18: review provenance is prose with a floor, so "reviewed" cannot be satisfied by a
  -- tick box or a space. Closed set of the length-bounded text columns on the two pack
  -- tables, read off the schema — a tenth field that needs a bound has to arrive here,
  -- and one that loses its bound stops being a claim about anything.
  --
  -- Single-column checks only, on purpose. §B's machine-assistance disclosure is a *pairing*
  -- rule (`machine_assisted` true ⇒ the notes column is filled in) and its definition
  -- mentions btrim length while contributing two columns to it; folding it in here would
  -- list the boolean as a prose field and add the notes column twice. The notes column is
  -- in the set below through its own bound, which is the one that actually holds it.
  PERFORM pg_temp.st2_set('C75 the pack tables'' bounded prose is exactly the nine review/author fields',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT c.relname || '.' || a.attname AS x
         FROM pg_constraint k
         JOIN pg_class c ON c.oid = k.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN LATERAL unnest(k.conkey) u(n) ON true
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = u.n
        WHERE n.nspname = 'public'
          AND c.relname IN ('tradition_packs','tradition_pack_releases')
          AND k.contype = 'c'
          AND cardinality(k.conkey) = 1
          AND pg_get_constraintdef(k.oid) LIKE '%length(btrim%') s),
    ARRAY['tradition_pack_releases.author_label','tradition_pack_releases.changelog',
          'tradition_pack_releases.machine_assistance_notes',
          'tradition_pack_releases.review_basis','tradition_pack_releases.review_label',
          'tradition_pack_releases.review_scope','tradition_pack_releases.source_reference',
          'tradition_packs.display_name','tradition_packs.scope_statement']);

  -- ================================================== 14. the suite has not been emptied
  -- Every list above is a *set* comparison, so an empty schema would satisfy several of
  -- them by accident; the floor is what says this run measured something. And the probe
  -- objects must be gone, because a leaked `st2_probe_*` table in public would be a
  -- hole this file is meant to be closing.
  PERFORM pg_temp.st2_ok('C70 the probe objects left no trace in the catalogue',
    NOT EXISTS (SELECT 1 FROM pg_class WHERE relname LIKE 'st2_probe_%')
    AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'st2_probe_%'));

  -- The file ran 76 at Stage 2's head commit. Stage 3 added ten by splitting two claims
  -- that could no longer be made whole — C13 became C13a-d (one per command, plus the
  -- draft itself) and C28 became C28a/C28b (the anonymous surface, the signed-in
  -- surface) — plus C17c/C17d for the `api` schema, C29a/C29c for the callable inventory
  -- and its argument shape, C32b for the guard privilege that C32's blanket form can no
  -- longer state, and C63b for the limitation the new schema inherits. That measurement
  -- was 86; the independent-review closure repair added eight more, all of them about the
  -- second RPC schema rather than about new subject matter — C17d2 (internal_api holds
  -- functions and no policy), C17e (no USAGE or CREATE for a server role there), C26b
  -- (nothing exposed through `api` acts above its caller), C26c (the wrappers pin their
  -- own path), C26d (a wrapper is one delegation and nothing else), C26e (internal_api is
  -- exactly the seven bodies), C26f (each body is a pinned definer whose caller matrix
  -- mirrors its wrapper), and C63c (the limitation C63b states applies inside
  -- internal_api too). Stage 4 then added eight, all of them about the pack lifecycle
  -- rather than about a schema it had to re-describe: C71a/C71b (the two closed
  -- vocabularies), C72 (the five status rules as one set), C72b (the same rules' *names*,
  -- which 20_attacks.sql quotes in its refusal assertions), C73a/C73b (a versioned jsonb
  -- object, and no plain json anywhere), C74 (selecting no pack is representable), C75
  -- (review prose is bounded). Measured on this branch: 102, then 103 once §9's column grant
  -- split C12 — the readable-table inventory can no longer be one list, because one table on it
  -- is now readable by projection rather than by a table grant, so C12 counts the eighteen and
  -- C12b names the seven columns of the nineteenth. Note what did *not* move:
  -- the inventories that grew in place — one more public table, one more read policy, one
  -- more server-authored table, five more triggers, three more foreign keys, one more
  -- bounded quantity — changed no assertion count, which is worth saying because a reader
  -- comparing totals would otherwise look for a change that is not there. Re-measure and
  -- say so whenever a check is added or removed: a floor nobody re-measures stops
  -- meaning anything.
  IF (current_setting('st2.passed'))::int < 103 THEN
    RAISE EXCEPTION 'FAIL: only % catalog assertions ran — the expected floor is 103',
      (current_setting('st2.passed'))::int;
  END IF;
END $CATALOG$;

SELECT 'STAGE2 CATALOG TESTS PASSED (' || current_setting('st2.passed') || ')' AS result;
