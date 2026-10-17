-- Stage 2 migration-outcome suite, LEGACY mode: what the mapping produced.
--
-- Run on a database built as: bootstrap + published migrations +
-- `10_seed_legacy.sql` + the Stage 2 chain — and *before* `20_attacks.sql`, whose
-- seed commits (psql's --single-transaction commits when the file succeeds). Every
-- expectation below is a row count or a value comparison, so a stray committed row
-- would turn this suite red rather than let it quietly measure something else.
--
-- The 91-phase brief asks for more than "it ran". Phases 37-39 want proof that the
-- mapping (a) preserved identity, (b) refused to guess, (c) recorded what it
-- refused, and (d) invented nothing. Those are four different questions, so they are
-- four groups of assertions here:
--
--   1. identity      — ids survive, so a bookmarked project still resolves
--   2. fidelity      — every canonical value is the legacy value or a documented
--                      normalisation of it, never a plausible-looking invention
--   3. refusal       — the rows/fields the schema cannot represent are absent, and
--                      each absence has exactly one finding explaining it
--   4. nothing more  — tables the migration had no evidence for are still empty,
--                      including the ones a careless mapping would fill from a
--                      billing flag or a `group_name`
--
-- Run as superuser. This file reads; it writes only into pg_temp and two probes that
-- are rolled back by the exception handler which expects them.

SET client_min_messages = notice;

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

-- "count = 5" in prose is the sort of claim that survives a wrong schema. This takes
-- a relation name and compares, so a failing check names the relation it counted.
CREATE FUNCTION pg_temp.st2_count(what text, rel text, want bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE got bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM ' || rel INTO got;
  IF got = want THEN
    PERFORM pg_temp.st2_ok(what || ' = ' || want, true);
    RETURN;
  END IF;
  RAISE EXCEPTION 'FAIL % — found % rows, expected %', what, got, want;
END $$;

-- M66 is the first assertion in this file that has to know which head it is reading, so the two helpers
-- below are the same pair `40_catalog.sql` runs its census on, spelled the same way and defaulted the
-- same way. The default is deliberately *low*: run this file against a Stage 10 schema with
-- `app.stage_head` unset and the pre-Stage-10 branch counts six price columns where it expects none and
-- fails loudly, which is the direction a missing GUC must fail in.
CREATE FUNCTION pg_temp.st2_head() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(current_setting('app.stage_head', true), 'stage4') $fn$;

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

DO $MIGRATION$
BEGIN

  -- =========================================================== 1. identity

  -- Precondition, not a mapping claim. Several checks below compare two sets built by
  -- joining to the fixture, and a set-vs-empty-set comparison passes silently on a
  -- database that was seeded in the wrong mode. Failing here makes that impossible to
  -- mistake for a pass.
  PERFORM pg_temp.st2_count('M00 the legacy fixture is present before anything is compared',
    'legacy.projects', 7);
  PERFORM pg_temp.st2_count('M00b and so are its templates', 'legacy.templates', 6);

  -- A legacy project that could migrate arrived with its own id unchanged. Asserting
  -- the set equality in both directions is the point: "5 rows" would also be true if
  -- the mapping had generated fresh uuids.
  PERFORM pg_temp.st2_set('M01 migrated wedding ids are exactly the migratable legacy project ids',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT w.id::text || '=' || p.id::text
         FROM public.weddings w
         JOIN legacy.projects p ON p.id = w.id
     ) s(x)),
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT p.id::text || '=' || p.id::text FROM legacy.projects p
        WHERE length(btrim(p.title)) > 0
     ) s(x)));

  PERFORM pg_temp.st2_count('M02 no wedding exists without a legacy project behind it',
    'public.weddings w2 WHERE NOT EXISTS (SELECT 1 FROM legacy.projects p WHERE p.id = w2.id)', 0);

  PERFORM pg_temp.st2_set('M03 the unmigratable legacy projects did not arrive',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT p.id::text FROM legacy.projects p
        WHERE length(btrim(p.title)) = 0
          AND NOT EXISTS (SELECT 1 FROM public.weddings w WHERE w.id = p.id)
     ) s(x)),
    ARRAY['c0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000004']);

  PERFORM pg_temp.st2_set('M04 migrated design_template ids are exactly the legacy template ids that could migrate',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT d.id::text || '=' || t.id::text
         FROM public.design_templates d
         JOIN legacy.templates t ON t.id = d.id
     ) s(x)),
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT t.id::text || '=' || t.id::text FROM legacy.templates t
        WHERE t.name IS NOT NULL AND length(btrim(t.name)) > 0
     ) s(x)));

  -- ========================================================== 2. fidelity

  -- Title: trimmed, never reworded. `Asha Wedding` in, `Asha Wedding` out.
  PERFORM pg_temp.st2_count('M05 every wedding title is the btrimmed legacy title',
    'public.weddings w JOIN legacy.projects p ON p.id = w.id WHERE w.title IS DISTINCT FROM btrim(p.title)', 0);

  -- Owner: preserved, and still a live account. There is no fallback owner, because
  -- legacy.projects.user_id is NOT NULL with a working foreign key.
  PERFORM pg_temp.st2_count('M06 owner preserved',
    'public.weddings w JOIN legacy.projects p ON p.id = w.id WHERE w.owner_user_id <> p.user_id', 0);
  PERFORM pg_temp.st2_count('M07 every migrated wedding resolves to a live account',
    'public.weddings w WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = w.owner_user_id)', 0);

  -- Timestamps: created_at carries the original date, so "when did this couple start"
  -- keeps its answer. updated_at is the legacy value too, not now().
  PERFORM pg_temp.st2_count('M08 created_at preserved verbatim',
    'public.weddings w JOIN legacy.projects p ON p.id = w.id WHERE w.created_at <> p.created_at', 0);
  PERFORM pg_temp.st2_count('M09 updated_at preserved verbatim, not stamped with migration time',
    'public.weddings w JOIN legacy.projects p ON p.id = w.id WHERE w.updated_at <> p.updated_at', 0);
  PERFORM pg_temp.st2_count('M10 design templates kept their catalogue date',
    'public.design_templates d JOIN legacy.templates t ON t.id = d.id WHERE d.created_at <> t.created_at', 0);

  -- Language: in-set survives, out-of-set becomes NULL. The forbidden outcome is a
  -- guess, and 'en' is the tempting one.
  PERFORM pg_temp.st2_set('M11 primary_language per wedding (unknown, not inferred)',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT right(w.id::text, 2) || '=' || coalesce(w.primary_language, 'NULL')
         FROM public.weddings w
     ) s(x)),
    ARRAY['01=ta','02=NULL','05=ml','06=NULL','07=en']);

  PERFORM pg_temp.st2_count('M12 no wedding was assigned a language its legacy row never claimed',
    'public.weddings w JOIN legacy.projects p ON p.id = w.id
     WHERE w.primary_language IS DISTINCT FROM
           (CASE WHEN p.language IN (''en'',''ta'',''te'',''ml'',''kn'') THEN p.language END)', 0);

  -- v1 shipped five languages; a legacy row cannot widen that set.
  PERFORM pg_temp.st2_count('M13 additional_languages empty everywhere',
    'public.weddings w WHERE coalesce(array_length(w.additional_languages, 1), 0) > 0', 0);

  -- Tradition packs are a reviewed, authored artefact. Nothing in the legacy schema
  -- named one, so nothing may claim a wedding belongs to one. Stage 4 moved the
  -- reference from a pack to a pack *release*; the guarantee is the same sentence about
  -- a narrower thing, so it is restated rather than dropped.
  PERFORM pg_temp.st2_count('M14 no tradition pack inferred from a language or a template name',
    'public.weddings w WHERE w.tradition_pack_release_id IS NOT NULL', 0);
  PERFORM pg_temp.st2_count('M15 the migration created no tradition pack',
    'public.tradition_packs', 0);
  PERFORM pg_temp.st2_count('M15b the migration created no tradition pack release either',
    'public.tradition_pack_releases', 0);

  -- Template link: kept only when that template itself arrived.
  PERFORM pg_temp.st2_set('M16 design_template link per wedding',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT right(w.id::text, 2) || '=' || coalesce(w.design_template_id::text, 'NULL')
         FROM public.weddings w
     ) s(x)),
    ARRAY['01=b0000000-0000-4000-8000-000000000001',
          '02=NULL',
          '05=NULL',
          '06=b0000000-0000-4000-8000-000000000003',
          '07=b0000000-0000-4000-8000-000000000001']);

  -- A retired template is still a template: it arrives as deprecated, and the link
  -- survives. Only a template that could not migrate breaks the link.
  PERFORM pg_temp.st2_count('M17 a link survives exactly when the template row exists',
    'public.weddings w WHERE (w.design_template_id IS NOT NULL) <>
       EXISTS (SELECT 1 FROM public.design_templates d WHERE d.id = w.design_template_id)', 0);

  -- Style: only the editor block, only when it was an object. The legacy catch-all
  -- also held `notes` and `beta_gifting`, which mean nothing canonical.
  PERFORM pg_temp.st2_set('M18 style_settings per wedding (editor block or empty)',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT right(w.id::text, 2) || '=' || w.style_settings::text
         FROM public.weddings w
     ) s(x)),
    ARRAY[
      '01={"font": "Playfair Display", "color": "#6b1e2a", "fontSize": "24", "alignment": "center", "foilEnabled": false}',
      '02={"font": "Noto Serif", "alignment": "left"}',
      '05={}',
      '06={}',
      '07={"font": "Inter"}']);

  PERFORM pg_temp.st2_count('M19 no style_settings value is a bare string or an array',
    'public.weddings w WHERE jsonb_typeof(w.style_settings) <> ''object''', 0);
  PERFORM pg_temp.st2_count('M20 unexplained legacy keys were not smuggled into style_settings',
    'public.weddings w WHERE w.style_settings ?| ARRAY[''beta_gifting'',''notes'',''editor'']', 0);

  -- Guest estimate: a negative number is not a count, so it becomes 0 (unknown-ish
  -- but representable) and the original claim is a finding, not a silent rewrite.
  PERFORM pg_temp.st2_set('M21 estimated_guest_count per wedding',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT right(w.id::text, 2) || '=' || w.estimated_guest_count::text FROM public.weddings w
     ) s(x)),
    ARRAY['01=120','02=0','05=10','06=0','07=250']);

  -- Everything arrives as a draft: the migration recovered content, not a state
  -- machine position nobody reviewed.
  PERFORM pg_temp.st2_count('M22 every migrated wedding is a draft',
    'public.weddings w WHERE w.lifecycle_status <> ''draft''', 0);

  -- Template status mapping: active flag -> catalogue state, never a review verdict.
  PERFORM pg_temp.st2_set('M23 design_template status per row (active=false deprecated, active=true draft)',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT d.template_key || '=' || d.status FROM public.design_templates d
     ) s(x)),
    ARRAY['gold-temple-b0000000=draft','hindi-experiment-b0000000=draft',
          'maroon-heritage-b0000000=draft','maroon-heritage-b1000000=draft',
          'old-layout-b0000000=deprecated']);

  PERFORM pg_temp.st2_count('M24 no legacy template arrived approved or reviewed',
    'public.design_templates d WHERE d.status = ''approved''
       OR d.reviewed_by IS NOT NULL OR d.reviewed_at IS NOT NULL', 0);

  -- Language set carried across only when every code is one the product ships.
  PERFORM pg_temp.st2_count('M25 no canonical template advertises a language outside the first-release set',
    'public.design_templates d WHERE NOT (d.supported_languages <@ ARRAY[''en'',''ta'',''te'',''ml'',''kn'']::text[])', 0);
  PERFORM pg_temp.st2_set('M26 supported_languages per template',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT right(d.id::text, 2) || '={' || array_to_string(d.supported_languages, ',') || '}'
         FROM public.design_templates d
     ) s(x)),
    ARRAY['01={en,ta}','02={te,kn}','03={en}','05={en}','06={en}']);

  -- Keys: derived from the name for legibility, salted with the id so two templates
  -- called "Maroon Heritage" stay two templates.
  PERFORM pg_temp.st2_count('M27 template_key unique across migrated rows',
    'public.design_templates WHERE template_key IN (SELECT template_key FROM public.design_templates GROUP BY 1 HAVING count(*) > 1)', 0);
  PERFORM pg_temp.st2_count('M28 the duplicate legacy name produced two distinct keys',
    'public.design_templates d WHERE d.display_name = ''Maroon Heritage''', 2);

  -- Display name preserved (trimmed), and the non-price metadata stayed behind.
  PERFORM pg_temp.st2_count('M29 display name is the btrimmed legacy name',
    'public.design_templates d JOIN legacy.templates t ON t.id = d.id WHERE d.display_name <> btrim(t.name)', 0);
  PERFORM pg_temp.st2_count('M30 every migrated template is revision 1',
    'public.design_templates d WHERE d.revision <> 1', 0);

  -- One empty working draft per wedding: a target for the editing surface, not
  -- recovered content.
  PERFORM pg_temp.st2_count('M31 exactly one draft per wedding',
    'public.invitation_drafts d WHERE d.wedding_id IN (SELECT id FROM public.weddings)
       AND (SELECT count(*) FROM public.invitation_drafts x WHERE x.wedding_id = d.wedding_id) <> 1', 0);
  PERFORM pg_temp.st2_count('M32 drafts exist for all five weddings',
    'public.invitation_drafts d WHERE d.wedding_id IN (SELECT id FROM public.weddings)', 5);
  PERFORM pg_temp.st2_count('M33 every migrated draft is empty, not reconstructed prose',
    'public.invitation_drafts d WHERE d.wedding_id IN (SELECT id FROM public.weddings)
       AND d.content <> ''{}''::jsonb', 0);

  -- ========================================================== 3. refusal

  -- The findings inventory, as an exact set. This is the assertion that stops a
  -- future migration from dropping a refusal silently: change the mapping and a
  -- count here moves.
  PERFORM pg_temp.st2_set('M34 findings inventory, exactly one row per recorded refusal',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT source_table || '.' || field || '=' || count(*)::text
         FROM legacy.migration_findings GROUP BY source_table, field
     ) s(x)),
    ARRAY[
      'activity_logs.action=2',
      'orders.status=2',
      'payments.amount_paise=2',
      'projects.guest_count=1',
      'projects.guests=2',
      'projects.invitation_versions=5',
      'projects.language=1',
      'projects.paid_status=4',
      'projects.selected_features->editor=1',
      'projects.selected_features=3',
      'projects.template_id=1',
      'projects.title=2',
      'projects.wedding_people=5',
      'templates.language_support=1',
      'templates.name=1']);

  PERFORM pg_temp.st2_count('M35 total findings recorded', 'legacy.migration_findings', 33);

  -- Each unmigratable project is explained exactly once, by a title finding.
  PERFORM pg_temp.st2_set('M36 the two skipped projects are the two title findings',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT source_id::text FROM legacy.migration_findings
        WHERE source_table = 'projects' AND field = 'title'
     ) s(x)),
    ARRAY['c0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000004']);

  -- A finding is evidence about old rows, so it must be attributable and quotable, and
  -- it must use one of the three verbs the mapping is allowed to claim: it refused, it
  -- normalised, or it created nothing.
  PERFORM pg_temp.st2_count('M37 every finding names a source table, field and a permitted action verb',
    'legacy.migration_findings WHERE source_table IS NULL OR field IS NULL
       OR btrim(action) = '''' OR action !~ ''^(not migrated|not created|migrated as|migrated with)''', 0);
  PERFORM pg_temp.st2_count('M38 every project-sourced finding points at a real legacy row',
    'legacy.migration_findings f WHERE f.source_table = ''projects''
       AND NOT EXISTS (SELECT 1 FROM legacy.projects p WHERE p.id = f.source_id)', 0);
  PERFORM pg_temp.st2_count('M39 a normalised value is stored in the finding, not just described',
    'legacy.migration_findings WHERE field IN (''language'',''guest_count'',''paid_status'',''title'',''template_id'')
       AND legacy_value IS NULL', 0);

  -- The language refusal is specific: 'hi' produced a finding AND a NULL, and the
  -- other out-of-set shapes produced no false finding.
  PERFORM pg_temp.st2_set('M40 which wedding was told "no language inferred"',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT right(source_id::text, 2) FROM legacy.migration_findings
        WHERE source_table = 'projects' AND field = 'language'
     ) s(x)),
    ARRAY['02']);

  -- The billing claims. Four legacy rows claimed paid; none of them bought anything
  -- the canonical domain can honour.
  PERFORM pg_temp.st2_set('M41 the four legacy paid claims, verbatim',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT right(source_id::text, 2) || '=' || legacy_value
         FROM legacy.migration_findings
        WHERE source_table = 'projects' AND field = 'paid_status'
     ) s(x)),
    ARRAY['03=fully_paid','04=base_paid','05=fully_paid','07=fully_paid']);

  -- ======================================================= 4. nothing more

  -- The whole of this group is a negative: a table whose contents the migration had
  -- no evidence for must be at zero. Each name is a place a guess would have fitted.
  PERFORM pg_temp.st2_count('M42 no entitlement created from a billing flag',
    'public.entitlements', 0);
  PERFORM pg_temp.st2_count('M43 no household invented from a per-person guest row',
    'public.guest_households', 0);
  PERFORM pg_temp.st2_count('M44 no event scope invented',
    'public.household_event_scopes', 0);
  PERFORM pg_temp.st2_count('M45 no RSVP answered on someone''s behalf',
    'public.rsvp_responses', 0);
  PERFORM pg_temp.st2_count('M46 no host/couple name parsed out of free text',
    'public.wedding_people', 0);
  PERFORM pg_temp.st2_count('M47 no venue invented from a title or a note',
    'public.venues', 0);
  PERFORM pg_temp.st2_count('M48 no wedding event invented',
    'public.wedding_events', 0);
  PERFORM pg_temp.st2_count('M49 no version minted without a renderer',
    'public.invitation_versions', 0);
  PERFORM pg_temp.st2_count('M50 nothing published',
    'public.publications', 0);
  PERFORM pg_temp.st2_count('M51 no approval request invented',
    'public.approval_requests', 0);
  PERFORM pg_temp.st2_count('M52 no approval feedback invented',
    'public.approval_feedback', 0);
  PERFORM pg_temp.st2_count('M53 no asset registered',
    'public.wedding_assets', 0);
  PERFORM pg_temp.st2_count('M54 no guest credential minted',
    'private.access_tokens', 0);
  PERFORM pg_temp.st2_count('M55 legacy log rows were not promoted into the audit trail',
    'private.audit_events', 0);

  -- The archived rows are still there, untouched: refusal to migrate must not become
  -- refusal to keep.
  PERFORM pg_temp.st2_count('M56 legacy projects archived intact', 'legacy.projects', 7);
  PERFORM pg_temp.st2_count('M57 legacy templates archived intact', 'legacy.templates', 6);
  PERFORM pg_temp.st2_count('M58 legacy guests archived intact', 'legacy.guests', 3);
  PERFORM pg_temp.st2_count('M59 legacy orders archived intact', 'legacy.orders', 2);
  PERFORM pg_temp.st2_count('M60 legacy payments archived intact', 'legacy.payments', 2);
  PERFORM pg_temp.st2_count('M61 legacy printers archived intact', 'legacy.printers', 1);
  PERFORM pg_temp.st2_count('M62 legacy activity logs archived intact', 'legacy.activity_logs', 2);

  -- Including the values the canonical schema refused: `paid_status` is still readable
  -- in the archive, which is the whole reason a finding is short.
  PERFORM pg_temp.st2_count('M63 the refused billing claims are still readable in the archive',
    'legacy.projects p WHERE p.paid_status IS NOT NULL AND p.paid_status <> ''unpaid''', 4);
  PERFORM pg_temp.st2_count('M64 the refused guest rows are still readable in the archive',
    'legacy.guests', 3);

  -- No legacy column survived into the canonical surface by accident.
  PERFORM pg_temp.st2_count('M65 no canonical wedding row carries a legacy billing or feature column',
    'information_schema.columns c WHERE c.table_schema = ''public''
       AND c.table_name = ''weddings''
       AND c.column_name IN (''paid_status'',''selected_features'',''guest_count'',''language'',''template_id'')', 0);
  -- Phase 77: the old commerce scaffolding must not reappear under a canonical name.
  -- Measured against the live catalog rather than remembered: on this schema the only
  -- columns in `public`/`private` matching these shapes are the two credential-digest
  -- columns of `private.access_tokens`, which hold a hash and a kind, never a token.
  --
  -- Stage 10 makes that sentence false, and the way it becomes false is the whole question. Its price
  -- model puts `amount_minor` on four tables and `price_version` on two, every one of them in `private`,
  -- so the needle above now counts six. Two repairs were available. Deleting those names from the search
  -- would have made this assertion blind to precisely the thing it was written to catch — a money column
  -- arriving somewhere a client can reach — so it is not what this file does. Instead the claim splits
  -- into the two halves that were always inside it: the schema a client can write carries no price,
  -- endpoint or credential at all, and the schema it cannot write carries a *named* set and nothing
  -- else. A seventh match — a discount, a tax, a rounded total, a printer endpoint, a raw token — fails
  -- M66b and has to be explained by whoever added it. Same split, reached from the other side, as
  -- `40_catalog.sql`'s C41/C41b.
  IF pg_temp.st2_at_least('stage10') THEN
    PERFORM pg_temp.st2_count('M66 no column in the schema a client can write carries a price, printer endpoint or raw credential',
      'information_schema.columns c WHERE c.table_schema = ''public''
         AND (c.column_name ~ ''(^|_)(price|cost|amount)(_|$)'' OR c.column_name LIKE ''%paise%''
              OR c.column_name LIKE ''%endpoint%''
              OR (c.column_name LIKE ''%token%''
                  AND c.column_name NOT IN (''token_hash'',''token_kind'')))', 0);
    PERFORM pg_temp.st2_set('M66b the match set across both schemas is exactly the six frozen-quote columns Stage 10 wrote into the server-owned schema, named rather than counted',
      (SELECT array_agg(x ORDER BY x COLLATE "C") FROM (
         SELECT c.table_schema || '.' || c.table_name || '.' || c.column_name AS x
           FROM information_schema.columns c
          WHERE c.table_schema IN ('public','private')
            AND (c.column_name ~ '(^|_)(price|cost|amount)(_|$)' OR c.column_name LIKE '%paise%'
                 OR c.column_name LIKE '%endpoint%'
                 OR (c.column_name LIKE '%token%'
                     AND c.column_name NOT IN ('token_hash','token_kind')))
       ) d),
      ARRAY['private.commerce_orders.amount_minor', 'private.commerce_orders.price_version',
            'private.commerce_packages.amount_minor', 'private.commerce_packages.price_version',
            'private.commerce_payment_events.amount_minor', 'private.commerce_refunds.amount_minor']);
  ELSE
    PERFORM pg_temp.st2_count('M66 no canonical column carries a legacy price, printer endpoint or raw credential',
      'information_schema.columns c WHERE c.table_schema IN (''public'',''private'')
         AND (c.column_name ~ ''(^|_)(price|cost|amount)(_|$)'' OR c.column_name LIKE ''%paise%''
              OR c.column_name LIKE ''%endpoint%''
              OR (c.column_name LIKE ''%token%''
                  AND c.column_name NOT IN (''token_hash'',''token_kind'')))', 0);
  END IF;
  PERFORM pg_temp.st2_count('M67 the legacy money columns are still readable where they were archived',
    'information_schema.columns c WHERE c.table_schema = ''legacy''
       AND c.column_name IN (''price_platform_paise'',''cost_printer_paise'',''api_endpoint'')', 3);

  -- Accounts and roles belong to Stage 2 only as far as the signup path is concerned.
  -- The fixture created three accounts, and the trigger provisioned one role each;
  -- the migration must have manufactured neither.
  PERFORM pg_temp.st2_count('M68 no account created by the migration',
    'auth.users a WHERE a.id NOT IN (''a0000000-0000-4000-8000-000000000001'',
                                      ''a0000000-0000-4000-8000-000000000002'',
                                      ''a0000000-0000-4000-8000-000000000003'')', 0);
  PERFORM pg_temp.st2_count('M69 role rows: three from the signup trigger, one inserted by the fixture',
    'public.user_roles', 4);
  PERFORM pg_temp.st2_count('M70 every role belongs to a fixture account',
    'public.user_roles r WHERE r.user_id NOT IN (SELECT id FROM auth.users)', 0);

  -- ================================== 5. re-application cannot double-write

  -- Forward-only migrations have no rollback, so a second application must fail loudly
  -- rather than add a second copy of history. The mapping preserves legacy ids as
  -- primary keys, which is exactly what makes that true; this proves it instead of
  -- asserting it in a comment. The insert below runs inside a plpgsql subtransaction
  -- and is rolled back by the handler that expects it.
  BEGIN
    INSERT INTO public.weddings (id, owner_user_id, title)
    SELECT p.id, p.user_id, btrim(p.title) FROM legacy.projects p
     WHERE length(btrim(p.title)) > 0
     LIMIT 1;
    PERFORM pg_temp.st2_ok('M71 re-applying the project mapping is refused', false);
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.st2_ok('M71 re-applying the project mapping is refused by the preserved primary key', true);
  END;

  BEGIN
    INSERT INTO public.design_templates (id, template_key, revision, display_name, status, supported_languages)
    SELECT d.id, d.template_key, d.revision, d.display_name, d.status, d.supported_languages
      FROM public.design_templates d LIMIT 1;
    PERFORM pg_temp.st2_ok('M72 re-applying the template mapping is refused', false);
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.st2_ok('M72 re-applying the template mapping is refused by the key or the primary key', true);
  END;

  -- The refusal above must not have left anything behind.
  PERFORM pg_temp.st2_count('M73 the refused re-application wrote nothing',
    'public.weddings', 5);

END
$MIGRATION$;

-- A suite that can be emptied one assertion at a time still prints "PASSED", so the
-- floor is checked before the word is used. Stage 4 raised this from 75 to 76 by adding
-- M15b; the number tracks the assertions in this file and must move with them.
--
-- It is a floor, not an equality, and Stage 10 is the reason the distinction now matters: M66 became
-- two cells at that head (above), so this file prints 77 there and 76 below it. Requiring 76 still
-- catches a section that stopped running, and requiring exactly 76 would have been a second way to
-- make this suite's future impossible. The added cell is a *stronger* claim at the new head, so the
-- head-aware count going up is the designed outcome, not drift.
DO $FLOOR$
DECLARE n int;
BEGIN
  n := coalesce(current_setting('st2.passed', true), '0')::int;
  IF n < 76 THEN
    RAISE EXCEPTION 'Stage 2 legacy-migration suite ran only % assertions (floor 76)', n;
  END IF;
END
$FLOOR$;

SELECT 'STAGE2 LEGACY MIGRATION TESTS PASSED (' || current_setting('st2.passed') || ')' AS result;
