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
    'profiles','user_roles']
    -- Stage 9's render manifest, declared as the head's addition rather than folded into the base.
    -- The reason is the one every later name here has: `supabase/tests/stage2/run.sh` stops its chain
    -- at Stage 4, so a table that does not exist yet in that chain must not be expected by it — and a
    -- Stage 9 chain that failed to create it must not be told it is absent. The list is an
    -- inventory *of the head*, which is what makes C05 a tripwire instead of a snapshot.
    || CASE WHEN pg_temp.st2_at_least('stage9')
            THEN ARRAY['invitation_outputs']
            ELSE ARRAY[]::text[] END;
  -- The one table on that list whose customer read path is a *column* projection rather than a
  -- table grant, and the seven columns it opens. Stage 4 §9 narrowed it: the reviewer record,
  -- the authorship and machine-assistance disclosure, the source reference, the changelog and
  -- the lifecycle timestamps are columns a browser cannot even name. Under a column grant
  -- `has_table_privilege(..., 'SELECT')` answers false while those seven still read, so C12
  -- asks about table-level grants and C12b about this projection, separately and by name.
  release_read_cols text[] := ARRAY[
    'definition', 'definition_schema_version', 'id', 'languages', 'pack_id',
    'release_number', 'status'];
  private_tbls    text[] := ARRAY['access_tokens','audit_events']
    -- Stage 10's commerce ledger, declared as the head's addition for the same reason
    -- `invitation_outputs` is declared above: `supabase/tests/stage2/run.sh` stops its chain at
    -- Stage 4 and must not be handed a list it cannot satisfy, while a Stage 10 chain that failed
    -- to create a ledger table must not be told it is absent. The whole point of this head is that
    -- the money model lives *here*: these six are in `private`, which no browser role can even
    -- name (C11, and 30_migration_empty's E12), and C06 is the assertion that says so by inventory
    -- rather than by a grant list — an order, an attempt or an event that arrived in `public` would
    -- fail this line before it could ever be read through the API.
    || CASE WHEN pg_temp.st2_at_least('stage10')
            THEN ARRAY['commerce_packages','commerce_orders',
                       'commerce_payment_attempts','commerce_payment_events',
                       'commerce_refunds','commerce_policy']
            ELSE ARRAY[]::text[] END
    -- Stage 11's tables, and their arrival here is the assertion that matters more than the count
    -- they move: operational authority is a credential, and C06 is the line that says a credential lives
    -- in the schema no browser role can even name. `20_attacks.sql` group 4 and C11/C14 prove the reach
    -- half; this inventory proves the location half, and a Stage 11 that had put `operator_grants` in
    -- `public` would fail here before any grant question was asked. Slice 2 adds the two support tables
    -- for the same reason and not a different one: a ticket carries a host's own words about a wedding,
    -- so `private.support_cases` and `private.support_case_events` are reachable only through the paired
    -- wrapper/body boundary, and the measured grant posture on both is false for `anon`,
    -- `authenticated` and `service_role` alike. Slice 3 adds `privacy_requests` on the same terms — a
    -- request names an account and the wedding it is about, and §10 gives it four paired doors and no
    -- table privilege for any client role. Measured on a chain that applied Stage 2 through Stage 11
    -- — twelve names, the eight above plus these four — in `q11-logs/s11-s2-readout-2.txt` section 6
    -- for the eleven-name head; slice 3's arrival is measured in `q11-logs/s11-s3-readout-1.txt`.
    -- Slice 1's nine-name readout is in `q11-logs/s11-catalog-readout-1.txt`. Slice 4 brings the
    -- thirteenth, `commerce_review_notes`, and its arrival here carries the same claim with more force
    -- than any of the other four: it is the first table in the product that records a human's *opinion*
    -- about money already taken — a refund or dispute read — so the schema question and the reach
    -- question are the same question, and C06 answers it by inventory. Measured on the same chain:
    -- thirteen names, the twelve above plus this one (`q11-logs/hist-clean-1006.txt` is the run that
    -- refused it at twelve).
    || CASE WHEN pg_temp.st2_at_least('stage11')
            THEN ARRAY['operator_grants','support_cases','support_case_events','privacy_requests',
                       'commerce_review_notes']
            ELSE ARRAY[]::text[] END;
  legacy_tbls     text[] := ARRAY[
    'projects','templates','guests','orders','payments','printers','activity_logs',
    'migration_findings'];
  -- Everything keyed by a wedding. Phase 71's denormalisation: each of these carries
  -- its own wedding_id so a policy can decide without walking a join chain.
  scoped_tbls     text[] := ARRAY[
    'wedding_people','venues','wedding_events','invitation_drafts','invitation_versions',
    'publications','guest_households','household_event_scopes','rsvp_responses',
    'approval_requests','approval_feedback','wedding_assets','entitlements']
    -- Stage 9's manifest carries its own `wedding_id`, is NOT NULL on it, is indexed on it, and its
    -- one policy resolves ownership through `public.weddings` exactly as C25b requires — so it joins
    -- this list, which is what makes C49, C50 and C25b look at it. A table added to `public_tbls`
    -- without joining this one would pass C05 and be unscoped.
    || CASE WHEN pg_temp.st2_at_least('stage9')
            THEN ARRAY['invitation_outputs']
            ELSE ARRAY[]::text[] END;
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
    'user_roles']
    -- Stage 9's output manifest: readable by its owner, written only by the trusted backend, with no
    -- INSERT/UPDATE/DELETE grant and therefore no write policy that a later convenience could add
    -- without noticing. Joining this list is what makes C22 look at it (no write policy may exist) and
    -- C33 look for the guard trigger that enforces the grant (it has one). It is *not* on
    -- `append_only_tbls`: a render row's status and evidence columns are exactly what its lifecycle
    -- transition writes, so it is server-authored and mutable rather than immutable.
    || CASE WHEN pg_temp.st2_at_least('stage9')
            THEN ARRAY['invitation_outputs']
            ELSE ARRAY[]::text[] END;
  -- Stage 10's six commerce tables and Stage 11's grant table deliberately do *not* join this list, and
  -- the reason is what the list means: "granted to `authenticated`, but written only by the server". A
  -- table in `private` is in the schema no browser role can name (C06/C14), so it has no write grant that
  -- could be the outer layer and no write policy for C22 to forbid — putting it here would assert a
  -- category it is not in. Their posture is claimed where it actually lives: C31's trigger inventory
  -- finds their guards, C06 finds their schema, and `90_commerce_functions.sql` / `80_operator_authority.sql`
  -- measure their grant matrices at the wire.
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
    'weddings(tradition_pack_release_id)->tradition_pack_releases=RESTRICT']
    -- Stage 9's two edges, and both are NO ACTION for the reason the rest of the render path is:
    -- deleting a wedding out from under a manifest row would orphan the record of an artefact a guest
    -- may still be holding a link to, and deleting a *version* would do the same to the outputs frozen
    -- against it. CASCADE was the wrong candidate twice over — it would erase the evidence trail that
    -- says which bytes were served, and a cascade runs as the child's owner, so the lifecycle guard
    -- below could not see it (the general rule is C35).
    || CASE WHEN pg_temp.st2_at_least('stage9')
            THEN ARRAY['invitation_outputs(wedding_id)->weddings=NOACTION',
                       'invitation_outputs(wedding_id+version_id)->invitation_versions=NOACTION']
            ELSE ARRAY[]::text[] END
    -- Stage 10's nine, and the split across them is the whole design of the ledger in one column: the
    -- rows that *decide* money reference NO ACTION, so a wedding, an attempt or an order cannot be
    -- deleted out from under a live quote; the rows that *record* what arrived reference SET NULL, so a
    -- piece of evidence outlives the row it is evidence about rather than being silently deleted with it
    -- or blocking the delete. `commerce_payment_events.order_id` is the load-bearing one of the five:
    -- the ledger's promise (§4) is that a delivery is never lost, and a RESTRICT would turn a retention
    -- delete of an order into a refusal to keep the audit, while a CASCADE would destroy exactly the
    -- receipt a dispute is settled with. `commerce_orders.owner_user_id` mirrors `audit_events`: a user
    -- delete nulls the attribution and keeps the row.
    --
    -- The ninth edge is the one the redelivery repair added, and it is NO ACTION rather than SET NULL for
    -- a reason specific to a self-reference: nulling `supersedes_event_row_id` would silently re-root a
    -- superseded arrival, making it once again the row that owns its provider identity, and a second root
    -- for one identity is precisely the state the partial unique index exists to refuse. CASCADE is worse
    -- still — deleting the refused row would delete the corrected capture that followed it. So a delete
    -- of an earlier ledger row is *refused*, which is the correct outcome for an append-only table whose
    -- own guards (`commerce_events_append_only_no_update`, `commerce_events_no_client_delete`) already
    -- mean no ordinary path deletes one at all.
    || CASE WHEN pg_temp.st2_at_least('stage10')
            THEN ARRAY[
              'commerce_orders(wedding_id)->weddings=NOACTION',
              'commerce_orders(entitlement_id)->entitlements=NOACTION',
              'commerce_orders(owner_user_id)->auth.users=SETNULL',
              'commerce_payment_attempts(order_id)->private.commerce_orders=NOACTION',
              'commerce_payment_events(order_id)->private.commerce_orders=SETNULL',
              'commerce_payment_events(attempt_id)->private.commerce_payment_attempts=SETNULL',
              'commerce_payment_events(supersedes_event_row_id)->private.commerce_payment_events=NOACTION',
              'commerce_refunds(order_id)->private.commerce_orders=NOACTION',
              'commerce_refunds(event_id)->private.commerce_payment_events=SETNULL']
            ELSE ARRAY[]::text[] END
    -- Stage 11's two edges are the two halves of one sentence about what an operator grant is for, and
    -- the first is the only FK to `auth.users` in this schema that is CASCADE rather than SET NULL. Every
    -- other edge to that table nulls its attribution because the row it sits on is evidence worth
    -- keeping after the person is gone — an order, an audit event, a review decision. A *live credential*
    -- pointing at a deleted account is the opposite: keeping it is the failure, not the cost, so an
    -- erased account must not leave an operational grant behind. `granted_by_user_id` keeps the rule
    -- because it is attribution of a decision that was made, and the granter's own erasure must not
    -- delete the record that a grant existed. The cascade runs as the child's owner, so
    -- `operator_grants_no_client_delete` cannot see it (the general rule is C35) — which is the same fact
    -- stated from the guard's side instead of the constraint's. Both names measured on
    -- `q11-logs/s11-catalog-readout-1.txt`.
    || CASE WHEN pg_temp.st2_at_least('stage11')
            THEN ARRAY['operator_grants(user_id)->auth.users=CASCADE',
                       'operator_grants(granted_by_user_id)->auth.users=SETNULL',
                       -- Slice 2's six, and the split is the same sentence the ledger rows learned:
                       -- a *recording* row keeps its attribution null and survives, because an event
                       -- that vanished with the person it was written by would be an audit hole; the
                       -- *thing recorded* likewise outlives the accounts it names. Nothing in Stage 11
                       -- CASCADEs from `auth.users` into a case, and that is deliberate — §5's whole
                       -- thesis is that a ticket is evidence about a wedding, so erasing an account
                       -- must not be an erasure path for the trail of who handled it.
                       -- `support_case_events(case_id)` is the one NO ACTION: an event cannot exist
                       -- for a case that does not, and `support_cases_no_client_delete` already means
                       -- no ordinary path deletes a case at all, so the restrict refuses a hand at the
                       -- console rather than blocking a designed lifecycle. `support_cases(wedding_id)`
                       -- is NO ACTION for the Stage 2 reason — a wedding with an open ticket is not
                       -- deletable, and inventing a cascade here would be inventing a data-retention
                       -- answer that §13 has not given. All six measured in
                       -- `q11-logs/s11-s2-readout-2.txt` section 10.
                       'support_case_events(actor_user_id)->auth.users=SETNULL',
                       'support_case_events(case_id)->private.support_cases=NOACTION',
                       'support_cases(assigned_operator_user_id)->auth.users=SETNULL',
                       'support_cases(opened_by_user_id)->auth.users=SETNULL',
                       'support_cases(requester_user_id)->auth.users=SETNULL',
                       'support_cases(wedding_id)->weddings=NOACTION',
                       -- Slice 3's two, and each is the choice its question forces. The wedding edge is
                       -- NO ACTION for the reason every request-like row above it is: the request is the
                       -- record of something a person asked for, and it must outlive the data it asks
                       -- about rather than being deleted by it or blocking the owner's own delete. The
                       -- requester edge is SET NULL, the opposite of `operator_grants`'s cascade and for
                       -- the complementary reason: a live credential must not outlive its subject, but
                       -- the request *is evidence* that a person asked, so erasing the account releases
                       -- the link and leaves the row standing (D13–D14, D21). Stated as SQL rather than
                       -- as prose the migration's COMMENT could carry and no assertion could check.
                       'privacy_requests(requester_user_id)->auth.users=SETNULL',
                       'privacy_requests(wedding_id)->weddings=NOACTION',
                       -- Slice 4's four, and they are one sentence about what a review note is: an
                       -- opinion a named human recorded about money that has already moved. The three
                       -- edges into the money and the ticket are NO ACTION — a note cannot describe a
                       -- refund, an order or a case that does not exist, and unlike the ledger's own
                       -- SET NULL rows this row has no independent meaning if its subject is gone. The
                       -- delete those refusals guard is already unreachable by design (the refund row
                       -- sits behind `commerce_refunds`' append-only posture and the case behind
                       -- `support_cases_no_client_delete`), so NO ACTION refuses a hand at the console
                       -- rather than blocking a lifecycle — the same reasoning `support_case_events`
                       -- gives for its `case_id` edge above. `author_user_id` is the SET NULL, mirroring
                       -- `audit_events` and `commerce_orders`: staff turnover must not erase the record
                       -- that a decision was reviewed, so the person is released and the note stands.
                       -- All four measured on `q11-logs/s11-s4-fk-probe-3.txt`.
                       'commerce_review_notes(author_user_id)->auth.users=SETNULL',
                       'commerce_review_notes(case_ref)->private.support_cases=NOACTION',
                       'commerce_review_notes(order_id)->private.commerce_orders=NOACTION',
                       'commerce_review_notes(refund_id)->private.commerce_refunds=NOACTION']
            ELSE ARRAY[]::text[] END;
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
    'weddings->tradition_pack_releases']
    -- Stage 10's three, and each is unindexed for a reason that is the same shape as one above it:
    -- the check it slows down is a rare one, not a customer path.
    --
    -- `commerce_orders.owner_user_id` is null-ness on a user delete, exactly like `audit_events` — the
    -- scan is bounded by the orders table, which is one row per wedding per package, and the column is
    -- never a query key because ownership is re-derived through the wedding, not searched by owner.
    --
    -- `commerce_orders.entitlement_id` is written once, when the entitlement is granted, and is never
    -- read back through this edge: the publish gate asks `public.entitlements` by wedding, not the order
    -- by entitlement. The FK check it would slow is an entitlement DELETE, and a client cannot delete one
    -- (`entitlements_no_client_delete`, C31) while a server revoke updates its status.
    --
    -- `commerce_refunds.event_id` points at the append-only ledger, which by construction has no DELETE
    -- path at all (`reject_any_update` plus the client-delete guard), so the check this index would
    -- serve is a check that never runs. Adding three indexes to serve three unreachable deletes would be
    -- write cost paid for nothing; naming them here is what keeps that from becoming a habit.
    || CASE WHEN pg_temp.st2_at_least('stage10')
            THEN ARRAY['commerce_orders->auth.users',
                       'commerce_orders->entitlements',
                       'commerce_refunds->private.commerce_payment_events']
            ELSE ARRAY[]::text[] END
    -- Stage 11's one, and the entry is `granted_by_user_id`: attribution, never a query key. The only FK
    -- check an index there would serve is a granter's account DELETE, which nulls a column across a table
    -- that is a handful of rows. The cascade that does matter — erasing an operator — is *not* in this
    -- list, because `user_id` is the leading column of `operator_grants_active_uniq`, so that check is an
    -- index probe; C48 names the edge once for the unindexed half and the absence of a second entry is
    -- the assertion that the indexed half is indexed. Measured against
    -- `q11-logs/s11-catalog-readout-1.txt`; the label count is `cardinality()` of this array, so the
    -- number in the sentence moves with the list instead of being re-typed.
    --
    -- Slice 2's four entries, and one label appears twice because the list is one row per *constraint*,
    -- not per edge: `support_cases` has three roads to `auth.users` and only `requester_user_id` is an
    -- index prefix (`support_cases_requester_opened_idx`), so the opening attribution and the holder are
    -- the two that are unindexed. Each is unindexed for the same reason `operator_grants` was: they are
    -- attribution and custody, not query keys, and the only FK check an index would serve is an account
    -- DELETE that nulls one column on a table whose ordinary path is a wrapper that never deletes.
    -- `support_cases->weddings` is the fourth for the reason above it — `wedding_id` on a case is a
    -- stamp, and the queue answers are scoped by requester or holder, so the column that *is* an index
    -- prefix (`status_opened_idx`) is not the one this edge needs. Twenty entries measured against
    -- `q11-logs/s11-s2-readout-2.txt` section 11, over the same predicate C48 runs.
    || CASE WHEN pg_temp.st2_at_least('stage11')
            THEN ARRAY['operator_grants->auth.users',
                       'support_case_events->auth.users',
                       'support_cases->auth.users',
                       'support_cases->auth.users',
                       'support_cases->weddings',
                       -- Slice 3's one: `requester_user_id` is the leading column of
                       -- `privacy_requests_requester_requested_idx`, so the SET NULL that erases an
                       -- account is an index probe and the edge is absent from this list. The wedding
                       -- edge is here because no index leads with `wedding_id` — the two indexes that
                       -- exist lead with the requester and with the status — and it is unindexed for
                       -- the same reason as `support_cases->weddings`: a wedding with a standing request
                       -- is not deletable by design, so the FK check is a rare refusal rather than a
                       -- customer path.
                       'privacy_requests->weddings',
                       -- Slice 4's two, and the pair is exactly the columns no index leads with. The
                       -- other two edges on the same table are *not* here because `refund_id` is the
                       -- leading column of both `commerce_review_notes_one_row_per_key` and
                       -- `commerce_review_notes_refund_created_idx`, and `case_ref` leads
                       -- `commerce_review_notes_case_idx` — so the two refusals that a delete of a
                       -- refund or a case would trigger are index probes, which is why the NO ACTION
                       -- edges above cost nothing to enforce. `order_id` is unindexed because it is a
                       -- derived stamp: `private.derive_commerce_review_note_order` fills it from the
                       -- refund at insert time and the update guard refuses any later write, so no
                       -- query path walks notes by order and the only FK check an index would serve is
                       -- an order DELETE that the ledger's own NO ACTION posture already refuses.
                       -- `author_user_id` is the attribution case again, the same reason every other
                       -- human-naming column in this list has. Four index definitions measured on
                       -- `q11-logs/s11-s4-fk-probe-3.txt`.
                       'commerce_review_notes->auth.users',
                       'commerce_review_notes->private.commerce_orders']
            ELSE ARRAY[]::text[] END;
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
  PERFORM pg_temp.st2_ok('C05 every public table is one of the '
    || CASE WHEN pg_temp.st2_at_least('stage9') THEN 'twenty' ELSE 'nineteen' END
    || ' canonical ones',
    (SELECT array_agg(c.relname::text ORDER BY c.relname)
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public') = (SELECT array_agg(x ORDER BY x) FROM unnest(public_tbls) x));
  PERFORM pg_temp.st2_ok('C06 private schema holds exactly the '
      || cardinality(private_tbls) || ' server tables',
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
        AND has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))
      -- The number does NOT move for Stage 10, and that is the point rather than an oversight: the
      -- server key is not given a table-level door into the money model. Every other head that added a
      -- `private` table added it to this count; Stage 10 added six and left it at twenty-two, because
      -- writes to those tables go through the seven bodies in `internal_api` and nowhere else. C15b is
      -- the assertion that says so in the affirmative, and the count staying put is what would make a
      -- later "just grant service_role on the commerce tables" repair noticeable instead of silent.
      --
      -- Stage 11 measures against this line and adds no branch to it, for a reason worth recording where
      -- the next reader will look for it: Stage 11 *revokes* UPDATE and DELETE on `private.audit_events`
      -- from `service_role`, and the count is still 22. It is still 22 because the four-privilege string
      -- above is answered as ANY-of rather than ALL-of — measured on a chain that applied Stage 2 through
      -- Stage 11, where that call on `audit_events` returns `t` while the single-privilege calls return
      -- `SELECT t / INSERT t / UPDATE f / DELETE f` (`q11-logs/s11-catalog-readout-1.txt`, and the probe
      -- beside it). So this was never a count of tables the key may fully write, and no partial
      -- revocation can lower it; the label says *reach*, and reach is what it measures. The revocation is
      -- asserted privilege by privilege in Stage 11's own battery (`80_operator_authority.sql` cells A08
      -- and AI02), which also names what the key keeps — INSERT, and with it forgery-by-addition — rather
      -- than leaving that residue to a number that cannot see the difference.
      = (CASE WHEN pg_temp.st2_at_least('stage9') THEN 22::bigint ELSE 21::bigint END));
  PERFORM pg_temp.st2_ok('C16 service_role holds nothing in legacy',
    NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r' AND n.nspname = 'legacy'
                   AND has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE')));
  -- The standing form of the requirement Stage 0 was created to close — "a customer cannot make
  -- themselves paid" — is here expressed one level below RLS: the tables that hold paid-ness are not
  -- nameable by any role a request can arrive as, *including* the server key. A policy on such a table
  -- would be the thing being trusted; with no grant there is no policy to reason about, and the only
  -- path in is a function body whose caller matrix C26e/C28b name one at a time. This is written as a
  -- pattern rather than a list so that a seventh money table arriving with a grant fails the check that
  -- exists to catch exactly that.
  PERFORM pg_temp.st2_ok('C15b no role a request can be holds any table privilege on the commerce model',
    NOT EXISTS (SELECT 1 FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                  CROSS JOIN LATERAL unnest(ARRAY['anon','authenticated','service_role']) r(rol)
                 WHERE c.relkind = 'r' AND n.nspname = 'private'
                   AND c.relname LIKE 'commerce%'
                   AND has_table_privilege(r.rol, c.oid,
                         'SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER')));
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
     WHERE n.nspname = 'public' AND pol.polcmd = 'r')
      = (CASE WHEN pg_temp.st2_at_least('stage9') THEN 20::bigint ELSE 19::bigint END));
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
  -- names stood at that head — the closure repair moved seven of them between schemas
  -- rather than adding an eighth, which is the point of the change — but *which* names
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
  PERFORM pg_temp.st2_set('C26 SECURITY DEFINER functions are exactly the privileged publication implementations plus the trigger definers',
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
                ELSE ARRAY[]::text[] END
        -- Stage 7: the family-review workflow's five bodies. Three are host verbs, two are the
        -- anonymous review door. All five are definers because all five act on rows the caller
        -- has no table privilege on (`approval_requests`, `approval_feedback`,
        -- `private.access_tokens`), which is the same reason the publication bodies are.
        || CASE WHEN pg_temp.st2_at_least('stage7')
                THEN ARRAY['internal_api.get_approval_requests',
                           'internal_api.request_family_review',
                           'internal_api.resolve_family_review',
                           'internal_api.revoke_family_review',
                           'internal_api.submit_family_review']
                ELSE ARRAY[]::text[] END
        -- Stage 8: the guest workflow's six bodies. Four are host verbs (mint, revoke, rotate,
        -- state) and two are the anonymous door (resolve, answer). All six are definers for the
        -- standing reason: each writes or reads `private.access_tokens` / `public.rsvp_responses`
        -- rows the calling role holds no table privilege on, and the guest who answers has no
        -- role at all. `internal_api.publish_invitation_version` and
        -- `internal_api.revoke_invitation_publication` are re-declared by Stage 8 §6 and appear
        -- above already — re-declaring a body changes no name, so this census does not move for
        -- them and C26e's count is the tripwire that would notice if it should have.
        || CASE WHEN pg_temp.st2_at_least('stage8')
                THEN ARRAY['internal_api.get_guest_invitation_state',
                           'internal_api.issue_guest_invitations',
                           'internal_api.resolve_guest_invitation',
                           'internal_api.revoke_guest_invitation',
                           'internal_api.rotate_guest_invitation',
                           'internal_api.submit_guest_rsvp']
                ELSE ARRAY[]::text[] END
        -- Stage 9 adds two, and neither is a write. Both are definers for the standing reason rather
        -- than by convenience: `render_invitation_document` reads a frozen version's snapshot out of
        -- `invitation_versions` and hands back the public DTO, and a host has no column-level SELECT on
        -- the snapshot it froze; `list_invitation_outputs` reads the manifest, which no browser role may
        -- write and therefore should not read through a table policy alone. Neither can be reached by a
        -- server key (`service_role` holds no USAGE on `api` or `internal_api`, C17c/C17e), so the
        -- renderer that writes the manifest writes it as the trusted backend over the table, and these
        -- two names stay read-only.
        || CASE WHEN pg_temp.st2_at_least('stage9')
                THEN ARRAY['internal_api.list_invitation_outputs',
                           'internal_api.render_invitation_document']
                ELSE ARRAY[]::text[] END
        -- Stage 10 adds two, and they are the two names this head was argued about.
        --
        -- `internal_api.commerce_host_summary` is a definer for the standing reason: the host panel
        -- asks "what state is my wedding's purchase in", and answering that needs a read of
        -- `private.commerce_orders` and `private.commerce_policy`, tables no browser role holds a
        -- single privilege on (C06, C11, C12). It is STABLE, owner-scoped by the wedding it is handed,
        -- and it deliberately returns the frozen amount only when the package's price is approved for
        -- display — so what it can give a caller is more than a table policy would, and less than the
        -- ledger holds.
        --
        -- `private.guard_publication_commerce_gate` is the third trigger definer, beside the draft
        -- attach and the signup handler, and it is a definer because it cannot be anything else: it
        -- must read `private.commerce_policy` while firing on an INSERT made by `authenticated`, and a
        -- SECURITY INVOKER trigger answering an API role would raise `permission denied for table
        -- commerce_policy` on every publish attempt. The privilege it therefore runs with is used for
        -- one config read and one entitlement lookup, and its only observable effect is to *refuse*;
        -- it writes nothing and returns NEW on every path it allows. C30 is the assertion that no API
        -- role can execute it, and C27 that its search_path is pinned.
        || CASE WHEN pg_temp.st2_at_least('stage10')
                THEN ARRAY['internal_api.commerce_host_summary',
                           'private.guard_publication_commerce_gate']
                ELSE ARRAY[]::text[] END
        -- Stage 11 adds one name, `private.actor_is_operator`, and it is the fourth definer in `private`
        -- — beside the draft attach, the signup handler and the publish gate — arrived at the same way as
        -- the third: the question "is this session an operator" has to read `private.operator_grants`,
        -- which no API role holds a privilege on, so a `SECURITY INVOKER` predicate asked by a later
        -- slice's `SECURITY INVOKER` body would answer `permission denied for table operator_grants`
        -- instead of `false`. A refusal that looks like a business rule is the failure this shape
        -- exists to avoid, and the privilege it takes is used for one indexed read of one table.
        --
        -- Stated as a reason rather than inferred, because nothing observable distinguishes the two
        -- choices yet: every role a request can arrive as is refused this function outright (cells
        -- A17–A19 of `80_operator_authority.sql` measure anon, `authenticated` and `service_role` each
        -- failing to reach it), so the definer posture buys a *nested* caller's answer and no caller of
        -- that kind exists until the slices that need one are written. What it costs is one name in a
        -- closed list, which is why the list is the assertion. Measured: 26 definers at Stage 11 slice 1,
        -- the 25 above plus this one (`q11-logs/s11-catalog-readout-1.txt`).
        --
        -- Slice 2 brings the count to 36 by adding the ten support bodies, and for the standing reason
        -- rather than a new one: each of the ten reads or writes `private.support_cases`,
        -- `private.support_case_events` or `private.operator_grants`, on which no browser role holds a
        -- single table privilege (C06, C11, C12 — readout `q11-logs/s11-s2-readout-2.txt` §12 measures
        -- the zero again), so an INVOKER body answering a host's "what is the status of my case" would
        -- raise `permission denied for table support_cases` where the answer is a row the caller owns.
        -- The four host-side doors are definers for that reason; the six operator-side doors are
        -- definers because the predicate that distinguishes an operator from a host is itself the
        -- definer `private.actor_is_operator` above, reached now by exactly the nested callers whose
        -- absence slice 1 could only predict. Nothing here is a definer that writes money, a credential
        -- or a cultural approval: the ten are the support queue and no other table.
        -- All thirty-six at slice 2, listed rather than counted, is what C26 asserts; `api` still holds
        -- none (C26b).
        --
        -- Slice 3 brings the count to forty with the four privacy bodies, and the reason is the standing
        -- one: `create_privacy_request` and `get_my_privacy_requests` read and write
        -- `private.privacy_requests`, on which no browser role holds a single table privilege (C06, C11,
        -- C12), so an INVOKER door answering a host's "where is my request" would raise `permission
        -- denied for table privacy_requests` instead of returning the row the host owns. The two desk
        -- doors are definers for the slice-2 reason: the predicate that decides whether the caller is an
        -- operator is `private.actor_is_operator`, itself a definer over `private.operator_grants`. All
        -- four are paired with wrappers (C26e), and nothing here writes money, a credential or a cultural
        -- approval: the four are the request queue and no other table.
        --
        -- Slice 4 brings the count to forty-six with five bodies and one predicate, and the two halves
        -- are refused for two different tables. `operator_takedown_plan`, `operator_takedown_publication`,
        -- `operator_commerce_review_queue` and `operator_add_commerce_review_note` read and write
        -- `private.commerce_orders`, `private.commerce_refunds`, `private.commerce_review_notes` and
        -- `private.support_cases` — none of which any browser role holds a single privilege on (C06, C11,
        -- C12) — so an INVOKER body would answer a queue request with `permission denied for table
        -- commerce_orders` instead of a row list. `operator_purge_publication_objects` is a definer for
        -- the storage half of the same act: it deletes `storage.objects` rows no client role may name,
        -- and it is the one slice-4 body with no `api` wrapper beside it, so C26e and C26b carry that
        -- asymmetry rather than this list. `private.operator_authorising_case` is the fifth definer in
        -- `private` for the predicate reason slice 1 established — it resolves a case reference against
        -- `private.support_cases` from inside a body that already runs above its caller.
        --
        -- What this list deliberately does *not* contain is slice 4's three guards on the review-note
        -- trail (`private.derive_commerce_review_note_order`, `private.reject_commerce_review_note_without_author`,
        -- `private.reject_commerce_review_note_update_except_referential_null`): all three are measured
        -- `prosecdef = false` on this chain, and they can afford to be, because the only statement that
        -- ever inserts a note is the definer body above it — so the row arrives as the owner, RLS is
        -- bypassed for the owner rather than for the guard, and the guard reads the NEW row as that same
        -- caller. The UPDATE guard has one further context, and it is the reason it exists in two
        -- halves: the `author_user_id` SET NULL cascade rewrites a note when its author's account is
        -- erased, and that rewrite is not issued by any body on this list. Measured as 46 definers at
        -- slice 4 — the 40 above plus these six — and 47 at slice 5, which adds one paired body over the
        -- health projection and no `private` definer. That body's own `FROM` clauses name twelve stores,
        -- read out of `prosrc` rather than from this comment: eleven that resolve — nine `private` ones
        -- that `authenticated` holds no SELECT on at all (and `anon` on none, and `service_role` on only
        -- `access_tokens` and `audit_events`) plus `public.publications` and `public.invitation_outputs`,
        -- which do grant SELECT to a signed-in caller but only through one RLS policy each, and a queue
        -- census has to count every operator's rows rather than the reader's — and a twelfth,
        -- `supabase_migrations.schema_migrations`, which does not resolve on this chain at all and is
        -- therefore the block the projection answers `not_measured`. So it must be a definer for the same
        -- forced reason every other paired body is.
        -- `q11-logs/s11-s5-doc-figures-2.txt` sections 5 and 8 are the per-name and per-store readings,
        -- and section 6 the absent migration store.
        || CASE WHEN pg_temp.st2_at_least('stage11')
                THEN ARRAY['private.actor_is_operator',
                           'internal_api.create_privacy_request',
                           'internal_api.get_my_privacy_requests',
                           'internal_api.operator_advance_privacy_request',
                           'internal_api.operator_privacy_queue',
                           'internal_api.get_my_support_case',
                           'internal_api.get_my_support_cases',
                           'internal_api.get_operator_case',
                           'internal_api.open_support_case',
                           'internal_api.operator_add_case_note',
                           'internal_api.operator_case_queue',
                           'internal_api.operator_claim_case',
                           'internal_api.operator_release_case',
                           'internal_api.operator_transition_case',
                           'internal_api.reply_to_support_case',
                           -- Slice 4's six, and the list keeps its shape: five paired bodies plus one
                           -- predicate that has to read a table no browser role can name.
                           'internal_api.operator_commerce_review_queue',
                           'internal_api.operator_add_commerce_review_note',
                           'internal_api.operator_purge_publication_objects',
                           'internal_api.operator_takedown_plan',
                           'internal_api.operator_takedown_publication',
                           -- Slice 5's one: the health projection. It is a definer for the same reason the
                           -- eighteen paired bodies above are — it reads `private.access_tokens`,
                           -- `private.audit_events`, the three commerce tables and both queue tables on
                           -- behalf of a caller holding no grant on any of them — and it is the only name
                           -- this slice adds anywhere, so `private` stays at 52 and `api`/`internal_api`
                           -- each move by one.
                           'internal_api.operator_operations_summary',
                           'private.operator_authorising_case']
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
  -- The wrapper count is the head's, not a constant: eight from Stage 5, which added the document
  -- preview, thirteen from Stage 7, which added the five family-review verbs, nineteen from
  -- Stage 8, which added the six household-invitation verbs, twenty-one from Stage 9, which added
  -- the two read doors over the render contract and its manifest, twenty-two from Stage 10, which
  -- added one door over the purchase state, thirty-two from Stage 11 slice 2, which added the
  -- support queue's ten, and thirty-six from slice 3, which added the privacy desk's four — the
  -- host's file/read pair and the operator's queue/advance pair, every one paired. Slice 4 makes it
  -- forty with the takedown plan, the takedown itself, the review queue and the review note — four of
  -- its five bodies paired, the fifth (`operator_purge_publication_objects`) deliberately left behind
  -- in the unexposed schema, which is why this count and C26e's differ by exactly one at this head.
  -- Slice 5 makes it forty-one with the health projection, whose body is the second half of that pair
  -- and adds no third name anywhere. Only one door was
  -- added by Stage 10's commerce slice, because the commerce write verbs stay
  -- server-side: a browser that could place an order could choose its own price, and the whole point of
  -- the quote is that it cannot. So the exposed surface grows by a read, and the six service-only
  -- implementations beside it are reachable from no wrapper at all.
  -- Stage 11's ten are the first doors whose authority is not wedding ownership, and the count is
  -- still what makes them visible: six of them are operator verbs presented to `authenticated` like
  -- any other, so this census is the file a reviewer reads to see the whole door list at once, while
  -- `85_support_lifecycle.sql` is the file that proves four of the ten refuse a non-operator.
  -- Every wrapper still has to be one line, whatever the number is.
  PERFORM pg_temp.st2_ok('C26d each wrapper is one fully-qualified delegation to its own implementation',
    (SELECT count(*) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'api') = (CASE WHEN pg_temp.st2_at_least('stage11') THEN 41
                                       WHEN pg_temp.st2_at_least('stage10') THEN 22
                                       WHEN pg_temp.st2_at_least('stage9') THEN 21
                                       WHEN pg_temp.st2_at_least('stage8') THEN 19
                                       WHEN pg_temp.st2_at_least('stage7') THEN 13
                                       WHEN pg_temp.st2_at_least('stage5') THEN 8
                                       ELSE 7 END)
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
                ELSE ARRAY[]::text[] END
        -- Stage 7 adds five, and each of the five is paired with a wrapper, so this census and
        -- C26d/C26f move together. None of them is a maintenance-only body: a browser role reaches
        -- every one through `api`, which is why C28a grows rather than this list quietly gaining
        -- an unpaired name.
        || CASE WHEN pg_temp.st2_at_least('stage7')
                THEN ARRAY['get_approval_requests',
                           'request_family_review',
                           'resolve_family_review',
                           'revoke_family_review',
                           'submit_family_review']
                ELSE ARRAY[]::text[] END
        -- Stage 8 adds six, and — the reason this is spelled out rather than counted — all six are
        -- paired, so this census, C26d's nineteen and C26f's nineteen are one nineteen-name set seen
        -- three ways. An unpaired guest body is the failure this catches: it would appear here and
        -- not in C26d/C26f, which is the asymmetry Stage 5 took on purpose for the eleven
        -- maintenance bodies and no reason exists to allow for a guest verb. `internal_api` is not
        -- exposed to the Data API, so an unpaired `submit_guest_rsvp` would be a write to
        -- `public.rsvp_responses` that no request can reach — dead code that reads as a hole to the
        -- next reader, which is worse than the refusal this line asks for.
        || CASE WHEN pg_temp.st2_at_least('stage8')
                THEN ARRAY['get_guest_invitation_state',
                           'issue_guest_invitations',
                           'resolve_guest_invitation',
                           'revoke_guest_invitation',
                           'rotate_guest_invitation',
                           'submit_guest_rsvp']
                ELSE ARRAY[]::text[] END
        -- Stage 9's two, and the point of writing them out is the same as Stage 8's: these are *paired*
        -- names, so this census, C26d's twenty-one and C26f's twenty-one are one twenty-one-name set
        -- seen three ways. A render body with no wrapper would be a way to read a frozen document that
        -- no request can reach — dead code to one reader and a hole to the next, which is the shape
        -- this asymmetry is only allowed for the eleven maintenance bodies Stage 5 took on purpose.
        -- Rendering is a product act, so both halves belong on the exposed surface, and the
        -- maintenance surface stays at eleven.
        || CASE WHEN pg_temp.st2_at_least('stage9')
                THEN ARRAY['list_invitation_outputs',
                           'render_invitation_document']
                ELSE ARRAY[]::text[] END
        -- Stage 10's seven, and this is the one place on this head where the census is allowed to be
        -- asymmetric for a *write*. Six of the seven have no wrapper — `create_commerce_order`,
        -- `grant_commerce_entitlement`, `revoke_commerce_entitlement`, `expire_commerce_order`,
        -- `record_commerce_event`, `commerce_reconcile` — and they are unpaired not because they are
        -- administrative, like the eleven maintenance bodies above, but because a wrapper would be a door
        -- a customer could walk through: `api.create_commerce_order` is a browser choosing what to buy and
        -- when its own quote dies, and `api.record_commerce_event` is a browser confirming its own payment.
        -- So reachability here is a property of the role, not of a token: each is SECURITY INVOKER with
        -- EXECUTE granted to nobody but the owner, which C28b measures by absence. The seventh,
        -- `commerce_host_summary`, is the one paired name, and it is a definer read of state the caller
        -- already owns — C26d therefore moves by exactly one for Stage 10, not seven.
        || CASE WHEN pg_temp.st2_at_least('stage10')
                THEN ARRAY['commerce_host_summary',
                           'commerce_reconcile',
                           'create_commerce_order',
                           'expire_commerce_order',
                           'grant_commerce_entitlement',
                           'record_commerce_event',
                           'revoke_commerce_entitlement']
                ELSE ARRAY[]::text[] END
        -- Stage 11 slice 1's two, and they are the second time this census is allowed to be asymmetric about a
        -- write — with a different reason, which is why it is spelled out again rather than folded into
        -- the paragraph above. Stage 10 left six bodies unpaired because a wrapper would be a door a
        -- *customer* could walk through; these two are unpaired because a wrapper would be a door an
        -- operator could walk through, and Stage 11's boundary is that no browser session may move
        -- operational authority at all — not that the wrong sessions are prevented from doing so.
        -- `40_catalog.sql` C28a/C28b therefore do not move for them, `30_publication.sql` G1f/G1g grows by
        -- exactly these two names, and `80_operator_authority.sql` A05 measures the posture they ship in
        -- (`SECURITY INVOKER`, following the 17-body precedent measured before the migration was written)
        -- with EXECUTE held by nobody — not the owner's delegate roles, not the server key.
        || CASE WHEN pg_temp.st2_at_least('stage11')
                THEN ARRAY['grant_operator_role',
                           'revoke_operator_role',
                           -- Slice 2's ten are the opposite case: every one of them paired, because a
                           -- support door has to be reachable by a browser — the host's own four to
                           -- open and answer a case, the operator's six to work the queue — and the
                           -- whole point of pairing them is that the *body* is where the operator test
                           -- lives. Each body takes its wrapper's name exactly, which is the shape
                           -- C26f checks pair by pair, including the mirrored caller matrix. Nothing
                           -- here is a body sitting unpaired in the unexposed schema waiting for a
                           -- caller that turns out to be a browser: C26e's census and C29a's list move
                           -- together by exactly ten, and `q11-logs/s11-s2-readout-2.txt` §12 measures
                           -- the two support tables' table-level privileges at zero for every client
                           -- role, so the pair is the only way in.
                           'get_my_support_case', 'get_my_support_cases', 'get_operator_case',
                           'open_support_case', 'operator_add_case_note', 'operator_case_queue',
                           'operator_claim_case', 'operator_release_case',
                           'operator_transition_case', 'reply_to_support_case',
                           -- Slice 3's four are the paired case again: two host doors to file and read
                           -- back a request, two desk doors to work the queue. C26d/C26f move with them
                           -- by exactly four, and no unpaired privacy body exists — a body sitting in the
                           -- unexposed schema with no wrapper would be a door no request can reach.
                           'create_privacy_request', 'get_my_privacy_requests',
                           'operator_advance_privacy_request', 'operator_privacy_queue',
                           -- Slice 4 brings five bodies and this census is where its asymmetry shows:
                           -- four are paired exactly as slices 2 and 3 were, and the fifth —
                           -- `operator_purge_publication_objects` — has no wrapper and cannot get one,
                           -- because it deletes `storage.objects` rows and a door that deletes files on
                           -- a caller's say-so is the surface this stage's threat model refuses. So
                           -- C26e moves by five while C26d and C26f move by four, and the difference is
                           -- the assertion rather than an accident of arithmetic.
                           'operator_add_commerce_review_note', 'operator_commerce_review_queue',
                           'operator_purge_publication_objects', 'operator_takedown_plan',
                           'operator_takedown_publication',
                           -- Slice 5's one, and it is a paired body: the health projection has a
                           -- wrapper, so C26e, C26d and C26f all move by exactly one here rather than
                           -- one of them moving alone. The asymmetry slice 4 left (five bodies, four
                           -- doors) does not widen — the purge stays the only Stage 11 body a request
                           -- cannot name.
                           'operator_operations_summary']
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
      = (CASE WHEN pg_temp.st2_at_least('stage11') THEN 41
              WHEN pg_temp.st2_at_least('stage10') THEN 22
              WHEN pg_temp.st2_at_least('stage9') THEN 21
              WHEN pg_temp.st2_at_least('stage8') THEN 19
              WHEN pg_temp.st2_at_least('stage7') THEN 13
              WHEN pg_temp.st2_at_least('stage5') THEN 8
              ELSE 7 END)
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
  -- change: the anonymous callable surface is named in full, and the full callable set of a
  -- signed-in role is named row by row.
  --
  -- `auth` is excluded because the local shim defines auth.uid()/auth.role() with
  -- the implicit PUBLIC execute that no ALTER DEFAULT PRIVILEGES can remove
  -- (measured, Stage 2 file 1) — those two are not our surface and cannot be.
  -- `api` is included because it is where the callable surface lives, and
  -- `internal_api` because "not served by PostgREST" is a property of the gateway's
  -- schema list, not of the database's privilege map: from inside SQL, every name below is
  -- one call apart from the wrapper beside it, and these assertions are what keep both sets
  -- from growing quietly. The HTTP-side half of the claim — that a request cannot name
  -- `internal_api` at all — is measured by `supabase/tests/api/stage3_security.test.mjs`.
  PERFORM pg_temp.st2_set('C28a the anonymous callable surface is the two guest doors and the reviewer verbs',
    (SELECT array_agg(p ORDER BY p) FROM (
       SELECT n.nspname || '.' || p.proname AS p
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public','api','private','legacy','internal_api')
          AND has_function_privilege('anon', p.oid, 'EXECUTE')) s),
    -- Stage 3's claim was that the anonymous callable surface is exactly one function, and it was
    -- true because a guest was the only roleless caller this product had. Stage 7 adds a second
    -- roleless caller: a family reviewer, who has no account by design. A reviewer needs two verbs,
    -- not one — `resolve_family_review` to open the invitation they were sent, and
    -- `submit_family_review` to answer it — because an answer is not a read and cannot share a door.
    -- Stage 8 adds a household guest, and it needs the same two, for the same reason:
    -- `resolve_guest_invitation` opens the household's own invitation and `submit_guest_rsvp` answers
    -- it. So the honest form of the claim is these names, each measured through its wrapper and its
    -- implementation, and nothing else on this head is anon-executable. That is what a forgotten
    -- revoke trips on here, which is the reason C63b exists.
    --
    -- The set is exactly four doors x two schemas = eight names from Stage 8, and the load-bearing
    -- half of that is what is *not* here: the host's four guest verbs
    -- (`issue_guest_invitations`, `revoke_guest_invitation`, `rotate_guest_invitation`,
    -- `get_guest_invitation_state`) take a `wedding_id` or `household_id` and are anon-refused, so an
    -- unauthenticated caller cannot mint a link for somebody else's family, withdraw one, or learn
    -- which households a wedding has invited. A guest that arrives with `anon` and a stolen token can
    -- read and answer; it cannot open the door for anyone else.
    --
    -- Stage 9 moves nothing here, and that is an assertion about the render architecture rather than an
    -- accident of it: the two names it adds take a `p_version_id` / `p_wedding_id` and are refused to
    -- `anon`, because deciding what a wedding's artefacts look like is a host act. What a crawler sees
    -- is an Open Graph *image*, served by the application from a bucket object, and serving it does not
    -- require anybody to be able to call `render_invitation_document` without a session. If a later
    -- head decides that an unauthenticated caller may ask for a rendered artefact, that decision arrives
    -- on this line as a name — which is the whole reason this census is a set rather than a count.
    (SELECT array_agg(x ORDER BY x) FROM unnest(
        ARRAY['api.resolve_public_invitation',
              'internal_api.resolve_public_invitation']
        || CASE WHEN pg_temp.st2_at_least('stage7')
                THEN ARRAY['api.resolve_family_review',
                           'internal_api.resolve_family_review',
                           'api.submit_family_review',
                           'internal_api.submit_family_review']
                ELSE ARRAY[]::text[] END
        || CASE WHEN pg_temp.st2_at_least('stage8')
                THEN ARRAY['api.resolve_guest_invitation',
                           'internal_api.resolve_guest_invitation',
                           'api.submit_guest_rsvp',
                           'internal_api.submit_guest_rsvp']
                ELSE ARRAY[]::text[] END) x));
  PERFORM pg_temp.st2_set('C28b a signed-in caller reaches exactly the wrappers and their implementations, as one set named by signature',
    (SELECT array_agg(p ORDER BY p) FROM (
       SELECT n.nspname || '.' || p.proname AS p
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public','api','private','legacy','internal_api')
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) s),
    -- Fourteen names when this was written, sixteen from Stage 5, which paired one more wrapper
    -- with one more body, twenty-six from Stage 7, which paired five, thirty-eight from Stage 8,
    -- which paired six, forty-two from Stage 9, which paired two, forty-four from Stage 10, which
    -- paired one of the seven commerce bodies it added and left six ungrantable, and sixty-four from
    -- Stage 11 slice 2, which paired all ten of its support doors. Slice 3 makes seventy-two and slice 4
    -- eighty, each by four pairs, and slice 4's five-body/four-pair split is the reason the two numbers
    -- do not move together with C26e's census. Slice 5 makes eighty-two with one pair — the health
    -- projection — which is the smallest movement a Stage 11 slice has ever made on this line, and the
    -- reason it is worth stating: five new `private` names plus one body plus one wrapper would have been
    -- a plausible shape for a read-side projection, and this slice deliberately ships two of the three.
    -- bodies are absent from every version of this list because they are granted to nobody a
    -- browser can be — that is C26e's asymmetry, checked here from the other side: an EXECUTE that
    -- appeared for one of them would show up as a diff in this set.
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
                ELSE ARRAY[]::text[] END
        -- Stage 7's five host-side verbs. Two of them (`resolve_family_review`,
        -- `submit_family_review`) also appear in C28a, because a reviewer reaches them without a
        -- session; the host's three (`request_family_review`, `revoke_family_review`,
        -- `get_approval_requests`) are signed-in only, and a signed-in reviewer is the same person
        -- at the same door, so the grant is anon *and* authenticated rather than one or the other.
        || CASE WHEN pg_temp.st2_at_least('stage7')
                THEN ARRAY['api.get_approval_requests',
                           'api.request_family_review',
                           'api.resolve_family_review',
                           'api.revoke_family_review',
                           'api.submit_family_review',
                           'internal_api.get_approval_requests',
                           'internal_api.request_family_review',
                           'internal_api.resolve_family_review',
                           'internal_api.revoke_family_review',
                           'internal_api.submit_family_review']
                ELSE ARRAY[]::text[] END
        -- Stage 8's six host guest verbs, each counted twice, wrapper and body. Two of the twelve
        -- (`api.resolve_guest_invitation`, `api.submit_guest_rsvp` and their bodies) also appear in
        -- C28a, for the same reason the reviewer's two do: the caller at that door has no session,
        -- and a signed-in host clicking the same link is the same person at the same door, so the
        -- grant is anon *and* authenticated rather than one or the other. The other eight are the
        -- host's own: a link may be minted, withdrawn, rotated and read only by somebody with a
        -- session that owns the wedding.
        || CASE WHEN pg_temp.st2_at_least('stage8')
                THEN ARRAY['api.get_guest_invitation_state',
                           'api.issue_guest_invitations',
                           'api.resolve_guest_invitation',
                           'api.revoke_guest_invitation',
                           'api.rotate_guest_invitation',
                           'api.submit_guest_rsvp',
                           'internal_api.get_guest_invitation_state',
                           'internal_api.issue_guest_invitations',
                           'internal_api.resolve_guest_invitation',
                           'internal_api.revoke_guest_invitation',
                           'internal_api.rotate_guest_invitation',
                           'internal_api.submit_guest_rsvp']
                ELSE ARRAY[]::text[] END
        -- Stage 9's four. Both of its names are counted twice, wrapper and body, and both are
        -- signed-in only: a caller that owns the wedding asks what was rendered and asks for a frozen
        -- document's DTO. Nothing here is a door a crawler walks through — the Open Graph image a
        -- crawler fetches is served by the application, not by an RPC that takes a version id — which
        -- is why C28a does not move for Stage 9 while this line does by exactly four.
        || CASE WHEN pg_temp.st2_at_least('stage9')
                THEN ARRAY['api.list_invitation_outputs',
                           'api.render_invitation_document',
                           'internal_api.list_invitation_outputs',
                           'internal_api.render_invitation_document']
                ELSE ARRAY[]::text[] END
        -- Stage 10's two, and the absence beside them is the point of writing this one out: the six
        -- service-only commerce bodies are *not* in this set, so a signed-in customer cannot call the
        -- code that places an order, applies a capture, expires a quote or records a payment event. That
        -- is the whole RLS-era question "can a client mark itself paid" answered one level up — the write
        -- verbs are not merely policy-restricted, they hold no grant for any browser role at all, which is
        -- why this census moves by two when Stage 10 adds seven implementations.
        || CASE WHEN pg_temp.st2_at_least('stage10')
                THEN ARRAY['api.commerce_host_summary',
                           'internal_api.commerce_host_summary']
                ELSE ARRAY[]::text[] END
        -- Stage 11 slice 2's twenty, and this is the set where the operator doors have to be seen
        -- plainly rather than inferred: all ten pairs are granted to `authenticated`, because the
        -- grant is what lets the request reach a body, and the body is what decides whether the
        -- caller is an operator. So this census moves by twenty while C28a — the anonymous surface —
        -- does not move at all, and the six operator doors' real boundary lives in the
        -- `operator_grants` read inside each body plus `85_support_lifecycle.sql`'s refusal cells,
        -- not in any list of roles. That is exactly the shape §4 asks for ("not merely by hiding
        -- links"), stated here so that a reviewer comparing this line with C26e can see the four
        -- host doors and the six operator doors are the same grant, and can then go and read the
        -- refusals rather than take the grant list on faith.
        -- Slice 3's eight are the same grant with the same reasoning one level down: the four privacy
        -- pairs are `authenticated`-granted on both halves, because the grant is what lets a request
        -- reach the body and the body is what decides. The two host doors are scoped by `auth.uid()`
        -- to the caller's own requests; the two desk doors answer a non-operator inside the body with
        -- `private.actor_is_operator`, exactly as the six support operator doors do. C28a does not move
        -- for them, because none of the four is an anonymous door.
        || CASE WHEN pg_temp.st2_at_least('stage11')
                THEN ARRAY['api.create_privacy_request',
                           'api.get_my_privacy_requests',
                           'api.get_my_support_case',
                           'api.get_my_support_cases',
                           'api.get_operator_case',
                           'api.open_support_case',
                           'api.operator_add_case_note',
                           'api.operator_advance_privacy_request',
                           'api.operator_case_queue',
                           'api.operator_claim_case',
                           'api.operator_privacy_queue',
                           'api.operator_release_case',
                           'api.operator_transition_case',
                           'api.reply_to_support_case',
                           'internal_api.create_privacy_request',
                           'internal_api.get_my_privacy_requests',
                           'internal_api.get_my_support_case',
                           'internal_api.get_my_support_cases',
                           'internal_api.get_operator_case',
                           'internal_api.open_support_case',
                           'internal_api.operator_add_case_note',
                           'internal_api.operator_advance_privacy_request',
                           'internal_api.operator_case_queue',
                           'internal_api.operator_claim_case',
                           'internal_api.operator_privacy_queue',
                           'internal_api.operator_release_case',
                           'internal_api.operator_transition_case',
                           'internal_api.reply_to_support_case',
                           -- Slice 4's eight, and this is the cell that records which of its five bodies
                           -- a browser can even name. The four takedown and review pairs are granted for
                           -- the same reason every operator door above them is: the grant lets the request
                           -- reach the body, the body decides. The fifth body,
                           -- `internal_api.operator_purge_publication_objects`, is *absent* here and that
                           -- absence is §10's whole claim — the irreversible step has no door at all.
                           -- Measured, not inferred: `anon`, `authenticated`, `service_role` all answer
                           -- false for it and only the owner is true (`q11-logs/s11-s4-purge-probe-1.txt`),
                           -- which is what lets a definer takedown body reach it over the peer-authenticated
                           -- channel while no key a browser can hold can. So C26e moves by five names for
                           -- slice 4 while this set moves by eight — four pairs — and the one body with no
                           -- pair is the one this census must not contain.
                           'api.operator_add_commerce_review_note',
                           'api.operator_commerce_review_queue',
                           'api.operator_takedown_plan',
                           'api.operator_takedown_publication',
                           'internal_api.operator_add_commerce_review_note',
                           'internal_api.operator_commerce_review_queue',
                           'internal_api.operator_takedown_plan',
                           'internal_api.operator_takedown_publication',
                           -- Slice 5's pair, and it enters this set for the same reason the twenty-six
                           -- above it do: `authenticated` holds EXECUTE on both halves so that a signed-in
                           -- operator's request can reach the body, and the body's own
                           -- `private.actor_is_operator('operations')` read is what refuses everybody else.
                           -- Unlike slice 4's purge, this one has no unpaired half — a read-only health
                           -- projection needs no irreversible step to be kept out of the boundary.
                           'api.operator_operations_summary',
                           'internal_api.operator_operations_summary']
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
  -- grew no boundary at all. The list is exact: another callable would have to be named
  -- here before it could ship — and from Stage 5 the document preview has been, from
  -- Stage 7 the five family-review verbs have, and from Stage 8 the six household-invitation
  -- verbs have, so each is declared with the head that introduced it rather than merged into
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
                ELSE ARRAY[]::text[] END
        || CASE WHEN pg_temp.st2_at_least('stage7')
                THEN ARRAY['get_approval_requests',
                           'request_family_review',
                           'resolve_family_review',
                           'revoke_family_review',
                           'submit_family_review']
                ELSE ARRAY[]::text[] END
        -- Stage 8's six. Named here, one at a time, because this list is the boundary: a seventh
        -- guest verb would have to be added before it could ship, and the alternative — a count —
        -- would pass for any six names whatsoever.
        || CASE WHEN pg_temp.st2_at_least('stage8')
                THEN ARRAY['get_guest_invitation_state',
                           'issue_guest_invitations',
                           'resolve_guest_invitation',
                           'revoke_guest_invitation',
                           'rotate_guest_invitation',
                           'submit_guest_rsvp']
                ELSE ARRAY[]::text[] END
        -- Stage 9's two, named rather than counted for the same reason: `render_invitation_document` is
        -- the one callable on this boundary that takes a *version* rather than a wedding, because the
        -- artefact a host reprints has to be the document that was frozen, not the draft beside it.
        || CASE WHEN pg_temp.st2_at_least('stage9')
                THEN ARRAY['list_invitation_outputs',
                           'render_invitation_document']
                ELSE ARRAY[]::text[] END
        -- Stage 10's one. It is the only name the exposed boundary gains, and the reason is the same as
        -- C26e's: the six write bodies are not on this list because a browser that could call them could
        -- place its own order or record its own capture. `commerce_host_summary` is here because a host
        -- asking "what state is my purchase in" is a read of the host's own rows, and it is the only
        -- commerce answer that has an HTTP shape.
        || CASE WHEN pg_temp.st2_at_least('stage10')
                THEN ARRAY['commerce_host_summary']
                ELSE ARRAY[]::text[] END
        -- Stage 11 slice 2's ten — the first names on this boundary whose authority is not ownership of
        -- the wedding they mention. Four are a host's own (`open_support_case` writes a case about a
        -- wedding the caller owns; `get_my_support_case(s)` and `reply_to_support_case` are scoped by
        -- `auth.uid()`, never by an argument a caller could point elsewhere). Six are an operator's, and
        -- they are on this list because a trusted-path console still needs an HTTP shape; their refusal
        -- path is the body's own `operator_grants` read, which C29c below cannot express and
        -- `85_support_lifecycle.sql` measures name by name. Naming all ten here is what makes "the
        -- admin surface is six verbs, not a hidden route" a checkable claim rather than a design
        -- assertion — an eleventh door has to be written into this file first.
        -- Slice 3's four are the same boundary one queue over: two host doors to file and read back
        -- their own request, two desk doors to list and advance the queue. They are named here for the
        -- same reason the support ten are — so that "the privacy surface is four verbs, and every one
        -- of them re-authorizes inside its body" is a checked claim; an unlisted fifth door would have
        -- to be written into this file before it could ship.
        -- Slice 4's four are the desk's money-and-taking-down doors: two to read and annotate the
        -- refund/dispute queue, two to plan and carry out a safe takedown. They join this list so that
        -- "the oversight surface is four verbs and the purge has no verb" is checkable — and the
        -- sentence that matters here is the absence. Slice 4 ships five privileged bodies and only four
        -- names on this boundary, because §10 rules the irreversible object-purge step to
        -- `internal_api.operator_purge_publication_objects`, which no request can reach: it is
        -- owner-only EXECUTE, measured false for `anon`, `authenticated` and `service_role` in
        -- `q11-logs/s11-s4-purge-probe-1.txt`. A fifth name on this list would be a browser able to
        -- delete a served artefact, and that is exactly what this cell is here to notice.
        -- Slice 5's one is the operations desk's read: a window-parameterised health projection whose
        -- answer is counts and timestamps only. It joins the boundary because a console must be able to
        -- ask it over HTTP; it is the *only* name slice 5 adds, which is what keeps `private` at 52
        -- while this list and C26d/C26e/C26f each move by one.
        || CASE WHEN pg_temp.st2_at_least('stage11')
                THEN ARRAY['create_privacy_request', 'get_my_privacy_requests',
                           'get_my_support_case', 'get_my_support_cases', 'get_operator_case',
                           'open_support_case', 'operator_add_case_note',
                           'operator_add_commerce_review_note',
                           'operator_advance_privacy_request', 'operator_case_queue',
                           'operator_claim_case', 'operator_commerce_review_queue',
                           'operator_operations_summary',
                           'operator_privacy_queue', 'operator_release_case',
                           'operator_takedown_plan', 'operator_takedown_publication',
                           'operator_transition_case', 'reply_to_support_case']
                ELSE ARRAY[]::text[] END) x));
  -- Zero arguments is not a style preference. It is the mechanism behind
  -- "the credential never appears in a query string": with no parameter to name, a
  -- request that puts `?p_token=` in a URL cannot be resolved to a function at all,
  -- which `supabase/tests/api/stage3_security.test.mjs` measures from the outside.
  --
  -- Stage 7 keeps the mechanism and widens its reach, so the assertion widened with it rather
  -- than being left to describe one function of fourteen. Two rules now, both measured:
  --   * every callable that *reads* a credential takes no arguments at all, so the credential
  --     has nowhere to be put except a header — this is `api.resolve_public_invitation` and,
  --     from Stage 7, `api.resolve_family_review`;
  --   * no callable anywhere on the boundary takes an argument whose name is credential-shaped,
  --     which is what makes `api.submit_family_review` (four content arguments, no token
  --     argument) conform to the same rule as the argument-free ones instead of exempting itself.
  --
  -- Stage 8 makes the first rule three names, because a household guest is a third kind of
  -- credential and the same mechanism has to hold for it: `api.resolve_guest_invitation` reads the
  -- bearer secret from the request's own GUC context and takes nothing. `api.submit_guest_rsvp`
  -- lands on the second rule rather than the first — it has one argument, `p_answers`, the guest's
  -- own reply and not a credential — so the answer door is held to the same test the review answer
  -- door already was. The count is of *no-argument readers*, so it moves only when a new kind of
  -- credential is given a door, which is the event worth failing on.
  PERFORM pg_temp.st2_ok('C29b no credential-reading callable takes arguments, and none takes a credential-shaped one',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api' AND p.proname IN ('resolve_public_invitation', 'resolve_family_review',
                                                'resolve_guest_invitation')
        AND p.pronargs = 0)
      = (CASE WHEN pg_temp.st2_at_least('stage8') THEN 3
              WHEN pg_temp.st2_at_least('stage7') THEN 2
              ELSE 1 END)
    AND NOT EXISTS (SELECT 1 FROM pg_proc p
                      JOIN pg_namespace n ON n.oid = p.pronamespace
                      JOIN LATERAL unnest(p.proargnames) AS a(argname) ON true
                     WHERE n.nspname IN ('api','internal_api')
                       AND a.argname ~* 'token|secret|credential|digest|signature'));
  -- The host operations take exactly the arguments their signatures declare and no more: a
  -- caller supplies identifiers, never an owner id. `p_owner_user_id` appearing anywhere in this
  -- schema would mean a request body could name a victim. Stage 7's reviewer-facing verbs are
  -- covered by the same regex for the same reason — a reviewer names themselves with a display
  -- string they were given, never with an account identity the schema could be steered into
  -- trusting.
  --
  -- Stage 10 makes the blanket form of that sentence false, and the honest response is to split it
  -- rather than to delete it. The rule that carries the weight — nothing a browser can execute takes
  -- an identity — stays absolute and is now measured *as* that, instead of as a stronger claim that
  -- happened to be true while nothing else existed. The six service-only commerce bodies do take
  -- `p_actor_user_id`, and they must: they are called by a trusted path that has no JWT to read, so
  -- the audit trail needs the human the operation is on behalf of, named by the caller. What makes
  -- that an attribution rather than a privilege is that none of the six believes it. Each re-derives
  -- ownership from `public.weddings` and raises `insufficient_privilege` when the named actor does not
  -- own the wedding, so naming somebody else cannot get a caller further than they could already go —
  -- it can only mislabel a row in a table that caller cannot write. C29c-b is the exception named, and
  -- its guard is the second half of the same line: an identity argument may only exist on a body no
  -- browser role can execute.
  PERFORM pg_temp.st2_ok('C29c no callable a browser role can execute takes a user or role identity',
    NOT EXISTS (SELECT 1 FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                  JOIN LATERAL unnest(p.proargnames) AS a(argname) ON true
                 WHERE n.nspname IN ('api','internal_api','private','public')
                   AND a.argname ~* 'user_id|owner|role|uid'
                   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))));
  PERFORM pg_temp.st2_ok('C29c-b the only identity-taking callables are '
    || (CASE WHEN pg_temp.st2_at_least('stage11')
             THEN 'the nine service-only bodies (six commerce, two operator-grant, one purge)'
             ELSE 'the six service-only commerce bodies' END)
    || ', and each is ungrantable to a browser role',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT n.nspname || '.' || p.proname || '.' || a.argname AS x
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN LATERAL unnest(p.proargnames) AS a(argname) ON true
        WHERE n.nspname IN ('api','internal_api','private','public')
          AND a.argname ~* 'user_id|owner|role|uid') s)
    = (CASE WHEN pg_temp.st2_at_least('stage11')
            THEN ARRAY['internal_api.commerce_reconcile.p_actor_user_id',
                       'internal_api.create_commerce_order.p_actor_user_id',
                       'internal_api.expire_commerce_order.p_actor_user_id',
                       'internal_api.grant_commerce_entitlement.p_actor_user_id',
                       'internal_api.grant_operator_role.p_actor_user_id',
                       'internal_api.grant_operator_role.p_user_id',
                       -- Slice 4's one, and it is the name this stage's §10 ruling is written into: the
                       -- purge takes an actor id because it runs only over the peer-authenticated channel,
                       -- where `auth.uid()` is NULL by construction and an irreversible act with no name
                       -- against it would be unanswerable afterwards (§2 of the migration). What keeps it
                       -- an attribution rather than a privilege is the second half of this assertion —
                       -- EXECUTE is false for `anon`, `authenticated` and `service_role` alike
                       -- (`q11-logs/s11-s4-purge-probe-1.txt`), so the only caller is the owner, reached
                       -- from inside a definer body, and no request can name it at all.
                       'internal_api.operator_purge_publication_objects.p_actor_user_id',
                       'internal_api.record_commerce_event.p_actor_user_id',
                       'internal_api.revoke_commerce_entitlement.p_actor_user_id',
                       'internal_api.revoke_operator_role.p_actor_user_id',
                       'internal_api.revoke_operator_role.p_user_id']
            WHEN pg_temp.st2_at_least('stage10')
            THEN ARRAY['internal_api.commerce_reconcile.p_actor_user_id',
                       'internal_api.create_commerce_order.p_actor_user_id',
                       'internal_api.expire_commerce_order.p_actor_user_id',
                       'internal_api.grant_commerce_entitlement.p_actor_user_id',
                       'internal_api.record_commerce_event.p_actor_user_id',
                       'internal_api.revoke_commerce_entitlement.p_actor_user_id']
            ELSE ARRAY[]::text[] END)
    AND NOT EXISTS (SELECT 1 FROM pg_proc p
                      JOIN pg_namespace n ON n.oid = p.pronamespace
                      JOIN LATERAL unnest(p.proargnames) AS a(argname) ON true
                     WHERE n.nspname IN ('api','internal_api','private','public')
                       AND a.argname ~* 'user_id|owner|role|uid'
                       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                         OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                         OR has_function_privilege('service_role', p.oid, 'EXECUTE'))));
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
                ELSE ARRAY[]::text[] END
        -- Stage 9's six on the manifest row, listed in the order that explains them rather than in
        -- collation order. Three are the house pattern every server-authored table carries —
        -- `reject_client_write`, `reject_client_delete`, `touch_updated_at` — and the timestamp trigger
        -- is named `set_updated_at` with no table prefix precisely because C37 identifies it by that
        -- name. The other three are this stage's own: the key minter, which refuses a presented key and
        -- writes one the caller cannot choose, and the pair of lifecycle guards that decide what a
        -- status transition may touch. All six are INVOKER, which is what C32 keeps them.
        || CASE WHEN pg_temp.st2_at_least('stage9')
                THEN ARRAY[
                  'public.invitation_outputs.invitation_outputs_mint_object_key=mint_invitation_output_key',
                  'public.invitation_outputs.invitation_outputs_guard_update=guard_invitation_output_update',
                  'public.invitation_outputs.invitation_outputs_guard_delete=guard_invitation_output_delete',
                  'public.invitation_outputs.invitation_outputs_no_client_write=reject_client_write',
                  'public.invitation_outputs.invitation_outputs_no_client_delete=reject_client_delete',
                  'public.invitation_outputs.set_updated_at=touch_updated_at']
                ELSE ARRAY[]::text[] END
        -- Stage 10's twenty-one, in the order that explains them. Twenty are on the six new server tables:
        -- nineteen follow the house pattern exactly and every commerce table that can be written by the
        -- trusted path carries `reject_client_write` + `reject_client_delete` + `touch_updated_at` — except
        -- `commerce_payment_events`, whose third trigger is `reject_any_update` instead of the delete
        -- guard's partner, because an append-only ledger must refuse an UPDATE from *any* role, owner
        -- included, rather than only from a browser. `commerce_orders` adds one more: the freeze guard,
        -- which is what makes "a quote's price and expiry cannot be edited after it is issued" a fact of
        -- the schema rather than a promise in a function. The twentieth is on `private.commerce_policy`
        -- too, and is the only one of the twenty that writes instead of refusing: the record a policy
        -- change leaves behind, which is what C31's whole point — noticing an arrival nobody qualified —
        -- was written for. The twenty-first is on `public.publications` and
        -- is the only definer in this whole inventory that Stage 10 adds, because it is the only one that
        -- has to read a table the caller cannot name (see C32).
        || CASE WHEN pg_temp.st2_at_least('stage10')
                THEN ARRAY[
                  'private.commerce_packages.commerce_packages_no_client_write=reject_client_write',
                  'private.commerce_packages.commerce_packages_no_client_delete=reject_client_delete',
                  'private.commerce_packages.set_updated_at=touch_updated_at',
                  'private.commerce_orders.commerce_orders_no_client_write=reject_client_write',
                  'private.commerce_orders.commerce_orders_no_client_delete=reject_client_delete',
                  'private.commerce_orders.set_updated_at=touch_updated_at',
                  'private.commerce_orders.commerce_orders_freeze=guard_commerce_order_freeze',
                  'private.commerce_payment_attempts.commerce_attempts_no_client_write=reject_client_write',
                  'private.commerce_payment_attempts.commerce_attempts_no_client_delete=reject_client_delete',
                  'private.commerce_payment_attempts.set_updated_at=touch_updated_at',
                  'private.commerce_payment_events.commerce_events_no_client_write=reject_client_write',
                  'private.commerce_payment_events.commerce_events_no_client_delete=reject_client_delete',
                  'private.commerce_payment_events.commerce_events_append_only_no_update=reject_any_update',
                  'private.commerce_refunds.commerce_refunds_no_client_write=reject_client_write',
                  'private.commerce_refunds.commerce_refunds_no_client_delete=reject_client_delete',
                  'private.commerce_refunds.set_updated_at=touch_updated_at',
                  'private.commerce_policy.commerce_policy_no_client_write=reject_client_write',
                  'private.commerce_policy.commerce_policy_no_client_delete=reject_client_delete',
                  'private.commerce_policy.set_updated_at=touch_updated_at',
                  -- The twenty-first, and the only one of the six commerce triggers that is not a refusal:
                  -- it writes the record a policy change leaves behind (20261020160000). Listed here for
                  -- the same reason as every other line in this array — an alarm for an arrival or a
                  -- disappearance that nobody qualified.
                  'private.commerce_policy.commerce_policy_change_trail=audit_commerce_policy_change',
                  'public.publications.publications_commerce_publish_gate=guard_publication_commerce_gate']
                ELSE ARRAY[]::text[] END
        -- Stage 11's five, and the first changes a standing claim instead of filling a pattern in.
        -- `private.audit_events` already carried the house pair, so `audit_no_update_any_role` is a
        -- *third* trigger on a table that has been called append-only since Stage 2 — and it earns the
        -- third spot by closing the half the pair never refused: `reject_client_write` steps aside for a
        -- trusted role and returns NEW, so until now the server key could rewrite an audit row and the
        -- word "append-only" meant "append-only for browsers". Its body is the specialised
        -- `reject_audit_update_except_referential_null` rather than the blunt `reject_any_update`, because
        -- the blunt form refused the database's own `ON DELETE SET NULL` on `actor_user_id` and would have
        -- made every account that ever acted undeletable; the hole is a link moving to NULL from inside
        -- another trigger, which is a depth the caller cannot reach. The fourth is the anti-forgery rule
        -- that used to be a table CHECK: an `actor_kind` that is not `system` with no account named. It is
        -- a BEFORE INSERT trigger because a CHECK also fires on that referential UPDATE, so as a CHECK it
        -- would have refused the very surviving row §12 requires. It keeps the CHECK's SQLSTATE (23514) so
        -- the error vocabulary did not move with the rule. The fifth is the house pattern on
        -- `private.operator_grants` — and these inventories are listed for the same reason as every other
        -- line here: this is the alarm for an arrival nobody qualified, and equally for a disappearance.
        -- Measured against `q11-logs/s11-s2-rebuild-1.txt` and the read-back in
        -- `q11-logs/s11-s2-triggers-1.txt`.
        --
        -- Slice 2's ten are in `q11-logs/s11-s2-census-2.txt`, and the two to read first are on
        -- `support_case_events`: `support_case_events_no_update_any_role` gives the events ledger the same
        -- posture `audit_events` was given above — a case's history is the artefact an operator is later
        -- judged against, and "append-only unless you hold the key" would be the same half-claim in a new
        -- table — and `support_case_events_actor_names_a_human` moved for the same reason the audit rule
        -- did. The remaining three on that side are the house pair and the seq minter; on the case row
        -- itself the house pair, the timestamp, the ref minter that replaces a presented
        -- `case_ref` with one the caller cannot choose, and `guard_support_case_update` — the guard that
        -- decides which columns a status transition may touch, so that a case's `opened_by_user_id` and
        -- `wedding_id` cannot be steered by an UPDATE that is otherwise legal. All ten are INVOKER,
        -- which is what C32 keeps: the definer triggers on canonical tables are still exactly the two
        -- named there, and the support queue added none.
        || CASE WHEN pg_temp.st2_at_least('stage11')
                THEN ARRAY[
                  'private.audit_events.audit_human_row_names_a_human=reject_audit_human_row_without_actor',
                  'private.audit_events.audit_no_update_any_role=reject_audit_update_except_referential_null',
                  'private.operator_grants.operator_grants_no_client_write=reject_client_write',
                  'private.operator_grants.operator_grants_no_client_delete=reject_client_delete',
                  'private.operator_grants.set_updated_at=touch_updated_at',
                  'private.support_case_events.support_case_events_actor_names_a_human=reject_case_event_without_actor',
                  'private.support_case_events.support_case_events_mint_seq=mint_support_case_seq',
                  'private.support_case_events.support_case_events_no_client_delete=reject_client_delete',
                  'private.support_case_events.support_case_events_no_client_write=reject_client_write',
                  'private.support_case_events.support_case_events_no_update_any_role=reject_case_event_update_except_referential_null',
                  'private.support_cases.set_updated_at=touch_updated_at',
                  'private.support_cases.support_cases_guard_update=guard_support_case_update',
                  'private.support_cases.support_cases_mint_ref=mint_support_case_ref',
                  'private.support_cases.support_cases_no_client_delete=reject_client_delete',
                  'private.support_cases.support_cases_no_client_write=reject_client_write',
                  -- Slice 3's six on the request row, in the order that explains them: the ref minter and
                  -- the insert-time requester guard are this table's two invariants a CHECK cannot carry
                  -- (a caller-chosen ref, and a row born without an account); the UPDATE guard is the
                  -- five-state machine; and the last three are the house pattern every server-authored
                  -- table carries. All six are INVOKER, so C32's pair of definer triggers on canonical
                  -- tables does not move, and the insert guards are ordered by name exactly as the
                  -- support table's are: `mint_ref` before `require_requester` is not a dependency, only
                  -- a stable order for the catalogue.
                  'private.privacy_requests.privacy_requests_guard_update=guard_privacy_request_update',
                  'private.privacy_requests.privacy_requests_mint_ref=mint_privacy_request_ref',
                  'private.privacy_requests.privacy_requests_no_client_delete=reject_client_delete',
                  'private.privacy_requests.privacy_requests_no_client_write=reject_client_write',
                  'private.privacy_requests.privacy_requests_require_requester=reject_privacy_request_without_requester',
                  'private.privacy_requests.set_updated_at=touch_updated_at',
                  -- Slice 4's five on the review-note row, and the set is worth reading as a shape: two
                  -- are the table's own invariants that no CHECK can carry (an author must name a real
                  -- account, and `order_id` must be the refund's own order rather than a supplied value),
                  -- one is the update rule and it is the interesting one — a note is a *statement*, so
                  -- the guard refuses UPDATE for every role and names the one null that may still move
                  -- through it, the `author_user_id` SET NULL this catalogue's C46 records. The last two
                  -- are the house pattern. All five are INVOKER (measured `prosecdef=false` for each on
                  -- `q11-logs/s11-s4-fk-probe-1.txt`), so C32's canonical definer-trigger pair does not
                  -- move for slice 4 either.
                  'private.commerce_review_notes.commerce_review_notes_author_names_a_human=reject_commerce_review_note_without_author',
                  'private.commerce_review_notes.commerce_review_notes_derive_order=derive_commerce_review_note_order',
                  'private.commerce_review_notes.commerce_review_notes_no_client_delete=reject_client_delete',
                  'private.commerce_review_notes.commerce_review_notes_no_client_write=reject_client_write',
                  'private.commerce_review_notes.commerce_review_notes_no_update_any_role=reject_commerce_review_note_update_except_referential_null']
                ELSE ARRAY[]::text[] END) x));
  -- The guards are INVOKER by design (they must report the role that issued the
  -- statement), so a DEFINER guard would mean the guard had a privilege of its own to
  -- use. That is the property this check carried in Stage 2, when the whole schema had
  -- one definer and no canonical table any. Stage 3 added a second definer, and it is
  -- a trigger on a canonical table, so the blanket form of the claim became false —
  -- the honest repair is to name the exception and keep the rule:
  --   * every `reject_client_*` / `touch_updated_at` guard is INVOKER (C32b), and
  --   * the definer triggers on canonical tables are named one at a time (C32) — one until Stage 10
  --     added the publish gate, two from there, and a third would have to earn its name here.
  PERFORM pg_temp.st2_set('C32 the SECURITY DEFINER triggers on canonical tables are exactly the draft pairing and the commerce publish gate',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT n.nspname || '.' || c.relname || '.' || t.tgname AS x
         FROM pg_trigger t
         JOIN pg_proc p ON p.oid = t.tgfoid
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT t.tgisinternal AND p.prosecdef
          AND n.nspname IN ('public','private')) s),
    -- Two names, each with a reason that is not the other's.
    --
    -- `weddings_have_draft` is Stage 3's, and it is a definer because the invariant it protects — every
    -- wedding has exactly one draft — had to survive an owner *delete*, which no INVOKER policy can
    -- authorise. `publications_commerce_publish_gate` is Stage 10's, and it is a definer because it must
    -- answer one question before a publish: does this wedding hold the entitlement the shipped policy
    -- requires? The tables that hold the answer (`private.commerce_policy`, and the entitlement read) are
    -- reachable by no API role, so an INVOKER trigger would raise `permission denied for table
    -- commerce_policy` on every publish attempt by an honest host, and would dress a privilege gap up as
    -- a business rule. What its privilege is *used for* is bounded by C26's own claim and by the body:
    -- one config read, one entitlement lookup, no write, and NEW returned on every path it allows. Its
    -- only observable effect is to refuse.
    -- Sorted on this side too: the left half is an ordered aggregate, so a want list written in the
    -- order that explains the two names would compare unequal to the same two names in collation order.
    (SELECT array_agg(x ORDER BY x) FROM unnest(
        ARRAY['public.weddings.weddings_have_draft']
        || CASE WHEN pg_temp.st2_at_least('stage10')
                THEN ARRAY['public.publications.publications_commerce_publish_gate']
                ELSE ARRAY[]::text[] END) x));
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
                                     'require_frozen_pack_release',
                                     -- Stage 10's two. The freeze guard decides whether a quote may still
                                     -- change, and a definer version of that decision could be made to see
                                     -- an entitlement the caller does not have; the ledger's update refusal
                                     -- is stricter than the house pattern, so it belongs on the list of
                                     -- guards that must never hold a privilege.
                                     'guard_commerce_order_freeze',
                                     'reject_any_update',
                                     -- Stage 11's four. Two refuse a rewrite of a trail except for the
                                     -- nulling the database performs for its own key, and two refuse an
                                     -- INSERT that claims a human author with no account named. Each of
                                     -- them decides a caller's write, so a definer version would be a
                                     -- guard with a privilege of its own to use — the same reason the
                                     -- house pair is on this list.
                                     'reject_audit_update_except_referential_null',
                                     'reject_audit_human_row_without_actor',
                                     'reject_case_event_update_except_referential_null',
                                     'reject_case_event_without_actor')));
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
  --
  -- Stage 2 wrote this as one blanket refusal over `public` and `private` together, and the reason was
  -- truthfulness rather than security: the customer-facing schema carried `price`/`amount` columns that
  -- backed no payment system, so the product's own data model claimed a money flow that did not exist.
  -- Stage 10 makes the columns real, and the honest form of the claim is now two halves instead of one,
  -- because the two schemas answer different questions. The half that carried the original weight is
  -- unchanged and absolute: nothing price-shaped may live in `public`, where an API role's SQL can name
  -- a column and a forged `paid` value has a place to be written. Money lives only in `private`, which
  -- no browser role can reach (C14) and whose tables no client can write (C31/C32b).
  PERFORM pg_temp.st2_ok('C41 no price-shaped column exists in the schema a client can write',
    NOT EXISTS (SELECT 1 FROM pg_attribute a
                  JOIN pg_class c ON c.oid = a.attrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind = 'r'
                   AND n.nspname = 'public'
                   AND a.attname ~* '(^|_)(paise|amount|price|cost|gst|tax|total|fee|discount)($|_)'));
  -- ... and the server half is a *named* set, so that "it lives in private" is not itself an excuse. A
  -- seventh price-shaped column arriving in `private` — a discount, a tax, a "total" that rounds
  -- something — fails here and has to be explained by whoever added it. Every name below is minor-unit
  -- or ordinal, never a decimal: `amount_minor` is an integer count of the smallest currency unit, which
  -- is what keeps C40 (numeric appears only as a venue coordinate) true, and `price_version` is the
  -- ordinal that lets an order freeze *which* published price it agreed to rather than inheriting the
  -- current one. Relkind is filtered because a table constraint carries an internal attribute named for
  -- the column it keys, and that is not a column pretending to be anything.
  PERFORM pg_temp.st2_set('C41b the price-shaped columns in the server schema are exactly the frozen-quote ledger fields',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT c.relname || '.' || a.attname AS x
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind = 'r'
          AND n.nspname = 'private'
          AND a.attname ~* '(^|_)(paise|amount|price|cost|gst|tax|total|fee|discount)($|_)') s),
    CASE WHEN pg_temp.st2_at_least('stage10')
         THEN ARRAY['commerce_orders.amount_minor', 'commerce_orders.price_version',
                    'commerce_packages.amount_minor', 'commerce_packages.price_version',
                    'commerce_payment_events.amount_minor', 'commerce_refunds.amount_minor']
         ELSE ARRAY[]::text[] END);
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
  PERFORM pg_temp.st2_set('C42b the quantity columns are exactly the '
    || CASE WHEN pg_temp.st2_at_least('stage9') THEN 'ten' ELSE 'eight' END || ' expected',
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
    --
    -- Stage 9's two are bounded for reasons that are each part of a claim rather than bookkeeping.
    -- `page_number` is a one-based ordinal, so a row claiming page zero or a negative page would be a
    -- row no document could contain; its *ceiling* is deliberately not here, because twelve-page and
    -- four-page limits live in `src/render/outputGeometry.ts` and a schema that restates them is a
    -- second source that can disagree with the first. `attempt_count` is bounded above because a
    -- renderer that retries without a ceiling is a queue that never drains, and the number a host is
    -- shown when a render has failed is the number this column keeps.
    --
    -- Both lists are written in the order the measured side sorts them, because this assertion is
    -- array equality, not set equality: a name that exists but sits in the wrong position is the same
    -- failing line as one that is missing, and that is the stricter reading.
    CASE WHEN pg_temp.st2_at_least('stage9') THEN
      ARRAY['guest_households.expected_party_size',
            'invitation_outputs.attempt_count','invitation_outputs.page_number',
            'invitation_versions.version_number',
            'rsvp_responses.party_size','tradition_pack_releases.release_number',
            'wedding_assets.size_bytes',
            'wedding_events.display_order','wedding_people.display_order',
            'weddings.estimated_guest_count']
    ELSE
      ARRAY['guest_households.expected_party_size','invitation_versions.version_number',
            'rsvp_responses.party_size','tradition_pack_releases.release_number',
            'wedding_assets.size_bytes',
            'wedding_events.display_order','wedding_people.display_order',
            'weddings.estimated_guest_count']
    END);
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
  PERFORM pg_temp.st2_set('C48 the unindexed foreign keys are exactly the accepted '
    || cardinality(unindexed_fks) || ', each with a reason above',
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
  -- comparing totals would otherwise look for a change that is not there. Stage 9 re-measured at its
  -- own head and the total was still 103 for that reason: one more public table, one more read
  -- policy, one more server-authored table, six more triggers, two more foreign keys, two more bounded
  -- quantities and two more paired callables were all absorbed by the inventories above, which are
  -- lists rather than counts. What Stage 9 asserts about the *shape* of a render row — that a key
  -- cannot be presented, that a status may only move along a registered edge, that a `ready` row
  -- carries the digest of bytes it did not invent — belongs to its own battery, not here.
  --
  -- Stage 10 measures 106, and the three are the first additions this file has accepted for a schema
  -- change since Stage 2 wrote it. Each is a rule that the money model made necessary rather than an
  -- inventory entry: C15b (no role a request can arrive as holds *any* table privilege on the commerce
  -- model, so the seven bodies are the only way in — this is requirement 6 stated below the policy
  -- layer, where RLS cannot be reasoned about because there is no policy to reason about), C29c-b
  -- (Stage 10's `p_actor_user_id` made the blanket "no callable takes an identity" false, so the
  -- exception is named and pinned to bodies no role can execute rather than deleted), and C41b
  -- (price-shaped columns are now real, so the file names the six of them and keeps `public` forbidden
  -- outright instead of refusing to distinguish the two schemas). Everything else Stage 10 added —
  -- six tables, one wrapper, seven implementations, twenty triggers, eight foreign keys, one definer
  -- trigger and one policy row — went into lists that grew in place and moved no count. Re-measure
  -- and say so whenever a check is added or removed: a floor nobody re-measures stops meaning anything.
  --
  -- Stage 11 re-measured at 106 (`q11-logs/s11-iter-catalog-5.txt`) — the same total as Stage 10, and the
  -- floor above therefore needs no branch, because the ladder is cumulative. The number is recorded
  -- rather than assumed: Stage 11 widens five of this file's inventories (one `private` table, one
  -- definer, two `internal_api` names, two identity-taking parameter pairs, four triggers, two foreign
  -- keys, one unindexed edge) and every one of them is a list that grows in place. What Stage 11's real
  -- assertions are — that no role may execute the grant bodies, that the audit table refuses an UPDATE
  -- from its own owner, that the predicate answers from the grant row and not a cookie — are the Stage 11
  -- battery's, not this file's, exactly as the same split held for Stage 9 and Stage 10.
  IF (current_setting('st2.passed'))::int <
     (CASE WHEN pg_temp.st2_at_least('stage10') THEN 106 ELSE 103 END) THEN
    RAISE EXCEPTION 'FAIL: only % catalog assertions ran — the expected floor for this head is %',
      (current_setting('st2.passed'))::int,
      (CASE WHEN pg_temp.st2_at_least('stage10') THEN 106 ELSE 103 END);
  END IF;
END $CATALOG$;

SELECT 'STAGE2 CATALOG TESTS PASSED (' || current_setting('st2.passed') || ')' AS result;
