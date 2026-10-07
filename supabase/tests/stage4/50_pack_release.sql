-- Stage 4: the tradition-pack *document* battery — pinning, section order, bilingual
-- resolution, provenance, and what a guest is allowed to see once a pack is attached.
--
-- Run LAST in the chain, as the superuser, against the migrated schema.
--
-- Why it is last, and why that is a fact about the schema rather than a preference:
-- §6 of the Stage 4 design says an approved release is immutable and undeletable — the
-- guard refuses the DELETE, because a guest link that outlives its pack is the whole
-- point. A file that walks a release to `approved` therefore cannot erase its own
-- fixture, and any suite that counts catalogue rows after it would be counting this
-- file's rows. `run.sh` puts it after the outcome, draft-invariant, publication, attack
-- and catalog suites for exactly that reason, and the throwaway database is dropped
-- immediately afterwards.
--
-- Why it prints its own total instead of joining Stage 2's. `20_attacks.sql` proved the
-- *privilege* half of this stage — a customer cannot promote, forge, edit, delete or
-- select a release they were not shown — and kept its own counters. Everything here is
-- the other half, which no grant can express: whether "the guest reads what the host
-- approved, forever" is actually true of the frozen document. Two suites, two totals, one
-- reason each.
--
--   BASE    the counts this file starts from, remembered so T can state a delta instead of
--           an absolute that depends on which suite ran before it
--   L       the lifecycle itself: draft → reviewed → approved → deprecated, one way only,
--           the four backwards steps refused by name, and a row that never left draft staying
--           deletable while one that did is not (current §1, ruling A2)
--   P       a version pins the exact release; a later release or a deprecation moves not a
--           byte of what was frozen; and approval is enforced at BOTH moments — selection
--           and freeze — while a retired release stays readable (§11, ruling A1)
--   LC      the guard measured on a row this battery owns: every refusal read back through
--           both hashes, so a refusal that also wrote half of itself cannot pass, and a
--           legal step that moves `updated_at` shown not to look like content editing
--   D       the definition contract, case by case: each rule of the JSON shape refused on its
--           own, naming the rule, beside the accepted controls that prove the guard is not
--           simply refusing everything (§2)
--   S       section order and headings are *data* resolved by one function, with no
--           cultural or per-slot branch anywhere in reaching them (§12)
--   B       Tamil is served when a release has Tamil, English only when the release
--           declared the substitution, and neither when it did not — never an English
--           sentence passed off as Tamil (§14)
--   V       where the host wrote over the pack, the document says the host wrote it (§13)
--   F       the freeze boundary refuses an unresolved document on its own, not the UI
--   C       what a guest may read, named key by key, and what stays in the snapshot
--   A       the two gates kept apart — grants and row policy — and what an authenticated
--           customer can and cannot enumerate, including a holder of a retiring release (§4, §5)
--   I       the callable and trigger inventory of the whole boundary, with a probe that must
--           be detected and then must vanish, so the inventory is shown to be able to fail
--           (§5, current §16.5)
--   T       the ledger: the rows this file leaves behind, the honesty of its own fixtures,
--           the cleanup of its probes, and its total (§6, §7, §8)
--
-- One numbering caveat, because two directives shaped this file: the § numbers on the newer
-- groups (BASE, L, LC, A, I, T) are those of the current Stage 4 directive, §0–§16, while
-- P/S/B/V/F/C were written against the extended directive's §0–§33 and keep that numbering.
-- A `§` inside one of those older group headers therefore means the older document.
--
-- Nothing here reviews anything. Every pack, release, review record and string below is a
-- synthetic fixture carrying the words TEST ONLY, `machine_assisted = true`, a NULL
-- `reviewed_by`, and a scope statement that says out loud it endorses no tradition. The
-- Tamil is present so a two-language resolution path has two languages to resolve; no
-- assertion in this file measures how a string is spelled, and none of them should be
-- read as a native speaker's approval of one.

SET client_min_messages = notice;
SELECT set_config('s4.passed', '0', false);

-- --------------------------------------------------------------------------- helpers
-- The same four instruments the Stage 2 and Stage 3 suites use, because the properties
-- worth asserting are the same ones: an assertion that cannot be counted can be deleted,
-- a refusal that reports 'no-error' can pass by accident, and a JSON key set compared in
-- the machine's collation can differ between two runs of identical code.
CREATE FUNCTION pg_temp.s4_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s4.passed',
    (coalesce(nullif(current_setting('s4.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s4_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s4_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s4_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s4_add(1);
END $fn$;

-- The JSONB form of an equality assertion, with both documents printed. Most of this
-- file compares whole resolved sections, and "the arrays differ" is not a diagnosis.
CREATE FUNCTION pg_temp.s4_jq(label text, got jsonb, want jsonb) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label,
      coalesce(got::text, '<null>'), coalesce(want::text, '<null>');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s4_add(1);
END $fn$;

-- SQLSTATE || message, or 'no-error'. SECURITY INVOKER, so what it reports depends on
-- the role the session is holding at the time.
CREATE FUNCTION pg_temp.s4_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

-- The same instrument for the one call this file makes most: freezing a version through
-- the host's own function, as the host. Written once so no group below can accidentally
-- freeze as the superuser and report a trusted-path result as a customer-path one.
CREATE FUNCTION pg_temp.s4_freeze(p_host uuid, p_wedding uuid) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v_res jsonb;
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_host::text, false);
  SELECT api.create_invitation_version(p_wedding) INTO v_res;
  EXECUTE 'RESET ROLE';
  RETURN v_res;
EXCEPTION WHEN OTHERS THEN
  -- A `SET ROLE` inside a function outlives the function (measured, not assumed), so an
  -- escape from here without the reset would leave every later group running as a customer
  -- and turn the rest of the battery into a silently different test.
  EXECUTE 'RESET ROLE';
  RAISE;
END $fn$;

-- ... and its refusal form, with the role change restored on both paths.
CREATE FUNCTION pg_temp.s4_freeze_err(p_host uuid, p_wedding uuid) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_res jsonb;
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_host::text, false);
  SELECT api.create_invitation_version(p_wedding) INTO v_res;
  EXECUTE 'RESET ROLE';
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

-- The host's own preview of the same document, which is the half §O separates from the
-- freeze: a preview may show a document that may not be frozen.
CREATE FUNCTION pg_temp.s4_preview(p_host uuid, p_wedding uuid) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v_res jsonb;
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_host::text, false);
  SELECT api.preview_invitation(p_wedding) INTO v_res;
  EXECUTE 'RESET ROLE';
  RETURN v_res;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RETURN jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM);
END $fn$;

-- A selection made by the host through the same UPDATE the browser sends, which is the
-- only way the selection gate can be qualified: the UI is not part of this measurement.
-- A NULL release is the customer's "no tradition pack" choice, so it is spelled out here
-- rather than left to concatenate into a statement that cannot execute.
CREATE FUNCTION pg_temp.s4_select(p_host uuid, p_wedding uuid, p_release uuid)
RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_res text;
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_host::text, false);
  -- s4_err reports as the role the session holds, which is why the capture happens here
  -- rather than by letting the exception out: the refusal belongs to the customer's path,
  -- and a version of this helper that returned 'no-error' for a refusal would be an
  -- instrument that reports a gate as open.
  v_res := pg_temp.s4_err('UPDATE public.weddings w SET tradition_pack_release_id = '
    || coalesce(quote_literal(p_release::text), 'NULL')
    || ' WHERE w.id = ' || quote_literal(p_wedding::text));
  EXECUTE 'RESET ROLE';
  RETURN v_res;
END $fn$;

-- The catalogue as a customer sees it, which is the only form in which "an unshipped pack
-- has no identity" can be measured: this file's own role would see every row.
CREATE FUNCTION pg_temp.s4_packs_visible(p_uid uuid) RETURNS text[]
LANGUAGE plpgsql AS $fn$
DECLARE v_keys text[];
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_uid::text, false);
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[]) INTO v_keys
    FROM (SELECT p.pack_key AS k FROM public.tradition_packs p) q;
  EXECUTE 'RESET ROLE';
  RETURN v_keys;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RETURN ARRAY['error: ' || SQLSTATE || ' ' || SQLERRM];
END $fn$;

CREATE FUNCTION pg_temp.s4_releases_visible(p_uid uuid) RETURNS text[]
LANGUAGE plpgsql AS $fn$
DECLARE v_rows text[];
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_uid::text, false);
  SELECT coalesce(array_agg(q.row_key ORDER BY q.row_key COLLATE "C"), '{}'::text[]) INTO v_rows
    FROM (SELECT p.pack_key || '/' || r.release_number || '=' || r.status AS row_key
            FROM public.tradition_pack_releases r
            JOIN public.tradition_packs p ON p.id = r.pack_id) q;
  EXECUTE 'RESET ROLE';
  RETURN v_rows;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RETURN ARRAY['error: ' || SQLSTATE || ' ' || SQLERRM];
END $fn$;

-- What a role can reach on one table, named as an outcome rather than as a row count: a
-- grant refusal and an empty result are different facts and this file must not confuse
-- them, because the two are the grants gate and the row-policy gate. Group A needs the
-- same instrument twice over — once as `anon`, once as `authenticated` — so that "the
-- grant is open and the policy is narrow" is one measurement instead of two helpers that
-- could drift apart.
CREATE FUNCTION pg_temp.s4_read_gate(p_role text, p_rel text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_n bigint;
BEGIN
  EXECUTE 'SET ROLE ' || quote_ident(p_role);
  PERFORM set_config('test.uid', '', false);
  BEGIN
    EXECUTE 'SELECT count(*) FROM public.' || p_rel INTO v_n;
  EXCEPTION WHEN insufficient_privilege THEN
    EXECUTE 'RESET ROLE';
    RETURN 'refused-by-grants';
  WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN 'error: ' || SQLSTATE || ' ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  RETURN 'readable:' || v_n::text;
END $fn$;

-- The battery's own role, asserted at each group head: a leaked `SET ROLE` would otherwise
-- turn every later assertion into a test of something else.
CREATE FUNCTION pg_temp.s4_is_superuser(label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'FAIL % — running as %', label, current_user;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s4_add(1);
END $fn$;

-- Which schema head this run is qualifying, as a fact about the run rather than about the
-- schema. Stage 5 re-declares four of this file's functions forward and adds a maintenance
-- surface, so four assertions below measure a *shape* that legitimately differs between the
-- Stage 4 head and the Stage 5 head: the closed-walk name list, the two "this build does not
-- understand that contract version" cases, and the function-inventory group. Each of them
-- states both expectations and picks one by this setting, which `supabase/tests/stage5/run.sh`
-- supplies through `PGOPTIONS=-c app.stage_head=stage5`; unset means the Stage 4 head, so
-- `supabase/tests/stage4/run.sh` needs no change and both chains stay qualifiable.
--
-- The head is *declared*, not read from the catalog. Deriving an expectation from the schema
-- under measurement would make those four assertions unable to fail, which is the opposite of
-- the reason they were written.
CREATE FUNCTION pg_temp.s4_head() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(current_setting('app.stage_head', true), 'stage4') $fn$;

-- "Is the declared head this one or later?" Every branch below that grew with Stage 5 asks that
-- question, not "is the head exactly stage5". The distinction is not cosmetic: heads are cumulative,
-- so a chain that qualifies Stage 6 still contains everything Stage 5 added, and an equality test
-- would silently hand a Stage 6 run the *Stage 4* expectations — a suite that goes quiet about a
-- shape it was written to catch. A malformed token is refused rather than defaulted, because a
-- runner that cannot name the head it is qualifying must not produce a green.
CREATE FUNCTION pg_temp.s4_at_least(want text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $fn$
DECLARE h int; w int;
BEGIN
  IF pg_temp.s4_head() !~ '^stage[0-9]+$' OR want !~ '^stage[0-9]+$' THEN
    RAISE EXCEPTION 's4_at_least: a stage head must be spelled stage<n> — got head=% want=%',
      pg_temp.s4_head(), want;
  END IF;
  h := regexp_replace(pg_temp.s4_head(), '^stage', '')::int;
  w := regexp_replace(want, '^stage', '')::int;
  RETURN h >= w;
END;
$fn$;

-- Keys at every depth, sorted in C order on both sides of every comparison.
CREATE FUNCTION pg_temp.s4_sorted(want text[]) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM unnest(coalesce(want, '{}'::text[])) u(k) $fn$;

CREATE FUNCTION pg_temp.s4_keys(v jsonb) RETURNS TABLE(k text)
LANGUAGE plpgsql AS $fn$
DECLARE r record;
BEGIN
  IF jsonb_typeof(v) = 'object' THEN
    FOR r IN SELECT jsonb_object_keys(v) AS key LOOP
      k := r.key;
      RETURN NEXT;
      RETURN QUERY SELECT * FROM pg_temp.s4_keys(v -> r.key);
    END LOOP;
  ELSIF jsonb_typeof(v) = 'array' THEN
    RETURN QUERY
      SELECT q.k FROM jsonb_array_elements(v) AS e(j)
                 JOIN LATERAL pg_temp.s4_keys(e.j) q ON true;
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.s4_all_keys(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT pg_temp.s4_sorted(coalesce(array_agg(DISTINCT s.k), '{}'::text[]))
    FROM pg_temp.s4_keys(v) s $fn$;

-- The projection's whole universe of key names is exactly this set — so a field can
-- reach a guest only if this file names it first.
CREATE FUNCTION pg_temp.s4_universe(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_temp.s4_eq(label, pg_temp.s4_all_keys(v), pg_temp.s4_sorted(want));
END $fn$;

-- ... and none of the banned names appears anywhere, with the offender named.
CREATE FUNCTION pg_temp.s4_no_forbidden(label text, v jsonb, banned text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE offenders text[];
BEGIN
  SELECT coalesce(array_agg(k), '{}'::text[]) INTO offenders
    FROM unnest(pg_temp.s4_all_keys(v)) u(k)
   WHERE k = ANY (banned);
  IF cardinality(offenders) > 0 THEN
    RAISE EXCEPTION 'FAIL % — leaked [%]', label, array_to_string(offenders, ', ');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s4_add(1);
END $fn$;

-- Membership, stated as a fact about a list rather than as its exact contents. The
-- visibility groups need this form because the real chain runs after `20_attacks.sql`,
-- which seeds catalogue rows of its own: "this customer can read that release" is the
-- claim, and an equality assertion on the whole list would test the fixture order of
-- whichever chain happened to run the file.
-- A guard on the guard. The visibility helpers below report a refusal as an element
-- beginning `error:` instead of raising, so that a group can assert on what a customer
-- *sees*; measured here, an `error:` element silently satisfied an absence assertion
-- ("that release is not among what they can read" was true of a list that said
-- `error: column "x" does not exist`). Membership assertions therefore refuse a broken
-- instrument before they accept a result from it.
CREATE FUNCTION pg_temp.s4_readable(label text, got text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(coalesce(got, '{}'::text[])) u(k)
              WHERE k LIKE 'error:%') THEN
    RAISE EXCEPTION 'FAIL % — the visibility instrument reported [%] instead of a list',
      label, array_to_string(got, ', ');
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.s4_has(label text, got text[], want text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_temp.s4_readable(label, got);
  IF NOT (coalesce(got, '{}'::text[]) @> ARRAY[want]) THEN
    RAISE EXCEPTION 'FAIL % — [%] is not among [%]', label, want,
      array_to_string(coalesce(got, '{}'::text[]), ', ');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s4_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s4_lacks(label text, got text[], absent text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_temp.s4_readable(label, got);
  IF (coalesce(got, '{}'::text[]) @> ARRAY[absent]) THEN
    RAISE EXCEPTION 'FAIL % — [%] is readable, and should not be: [%]', label, absent,
      array_to_string(coalesce(got, '{}'::text[]), ', ');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s4_add(1);
END $fn$;

-- The one true path from a version row to a guest document, so no group below has to
-- remember which two arguments the projection takes.
CREATE FUNCTION pg_temp.s4_dto(p_version uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT private.public_invitation_dto(v.snapshot_schema_version, v.snapshot)
    FROM public.invitation_versions v WHERE v.id = p_version $fn$;

-- The section list of a resolved document, as (position, key, kind, body source, body
-- language, fallback, overrode, heading language) — the shape most of P/S/B/V ask about.
-- Written once so an assertion cannot be satisfied by reading a different projection of
-- the same fact than the one the renderer consumes.
CREATE FUNCTION pg_temp.s4_rows(p_snapshot jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(
           (q ->> 'position') || '|' ||
           coalesce(q ->> 'section_key', '-') || '|' ||
           coalesce(q ->> 'kind', '-') || '|' ||
           coalesce(q ->> 'body_source', '-') || '|' ||
           coalesce(q ->> 'body_language', '-') || '|' ||
           coalesce(q ->> 'body_fallback_used', '-') || '|' ||
           coalesce(q ->> 'overrode_pack_text', '-') || '|' ||
           coalesce(q ->> 'heading_language', '-')
           ORDER BY (q ->> 'position')::integer), '{}'::text[])
    FROM jsonb_array_elements(p_snapshot -> 'sections' -> 'items') e(q) $fn$;

-- One resolved section by key, for the assertions that are about a single slot rather
-- than about the ordering of all of them.
CREATE FUNCTION pg_temp.s4_section(p_snapshot jsonb, p_key text) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT q FROM jsonb_array_elements(p_snapshot -> 'sections' -> 'items') e(q)
   WHERE q ->> 'section_key' = p_key $fn$;

-- One projected section by key, from a guest document.
CREATE FUNCTION pg_temp.s4_dto_section(p_dto jsonb, p_key text) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT q FROM jsonb_array_elements(p_dto -> 'sections' -> 'items') e(q)
   WHERE q ->> 'section_key' = p_key $fn$;

-- Try to author a release with one candidate definition, everything else about the row
-- being valid and stated here once. This exists so that no refusal in group D can be
-- blamed on an unrelated missing column, and no acceptance can be blamed on a laxer row:
-- each case changes exactly one thing about the definition, and the caller asserts both
-- the outcome and the stored state afterwards.
CREATE FUNCTION pg_temp.s4_def_err(
  p_definition jsonb,
  p_languages text[] DEFAULT ARRAY['en', 'ta'],
  p_schema integer DEFAULT 1,
  p_machine boolean DEFAULT true,
  p_notes text DEFAULT 'TEST ONLY — drafted by a model and checked for shape and language '
                       'coverage. No human reader of Tamil reviewed any string in this row.'
) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN pg_temp.s4_err(format(
    'INSERT INTO public.tradition_pack_releases '
    || '(id, pack_id, release_number, definition_schema_version, languages, definition, '
    || 'author_label, machine_assisted, machine_assistance_notes, source_reference) '
    || 'SELECT gen_random_uuid(), x.id, 900, %s, %L::text[], %L::jsonb, %L, %L, %L, %L '
    || 'FROM (SELECT pack_unshipped AS id FROM sf) x',
    p_schema, p_languages, p_definition,
    'TEST ONLY — definition probe', p_machine, p_notes, 'TEST ONLY — no external source'));
END $fn$;

-- The two halves of a release row, each hashed into one comparable value, with the split
-- drawn exactly where the guard draws it: `s4_chash` is the content-and-provenance tuple
-- the guard freezes once a release leaves `draft`, and `s4_rhash` is the review record the
-- guard freezes beside it. `status` and the lifecycle timestamps appear in neither, because
-- those are what a legal step is allowed to write — which is the property LC7 measures.
-- Reading the row back through these two hashes is how LC asserts that a refusal wrote
-- nothing, including the columns a hand-written assertion would forget.
CREATE FUNCTION pg_temp.s4_chash(p_rel uuid) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(concat_ws('|', r.pack_id, r.release_number, r.definition_schema_version,
                       r.definition, r.languages, r.machine_assisted,
                       r.machine_assistance_notes, r.author_label, r.source_reference,
                       r.changelog))
    FROM public.tradition_pack_releases r WHERE r.id = p_rel $fn$;

CREATE FUNCTION pg_temp.s4_rhash(p_rel uuid) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(concat_ws('|', r.review_label, r.review_basis, r.review_scope,
                       r.reviewed_languages, r.reviewed_by, r.reviewed_at,
                       r.approved_at, r.deprecated_at))
    FROM public.tradition_pack_releases r WHERE r.id = p_rel $fn$;

CREATE FUNCTION pg_temp.s4_hash_of(p_rel uuid) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT pg_temp.s4_chash(p_rel) || '|' || pg_temp.s4_rhash(p_rel) $fn$;

-- The column-level cases in group D write their own statements through `pg_temp.s4_err`,
-- because a rule about a column is only proved when the rest of the row is valid — which
-- is the same reason `s4_def_err` exists above.

-- ------------------------------------------------------ the baseline this file starts from
-- The catalogue is not empty when this file runs, and pretending otherwise would be a
-- lie on the real chain and an accident waiting to happen on the clean one. So the entry
-- counts are measured and remembered, and the assertion at the end is about the *delta*
-- this file caused. `30_migration_empty.sql` is where "a migration ships no pack" is
-- asserted, on the chain that has not been attacked; repeating it here would be
-- repeating it after 20_attacks.sql had seeded rows of its own.
DO $BASE$
DECLARE v_packs bigint;
        v_rels  bigint;
        v_vers  bigint;
        v_weds  bigint;
        v_tmpl  bigint;
        v_users bigint;
BEGIN
  SELECT count(*) INTO v_packs FROM public.tradition_packs;
  SELECT count(*) INTO v_rels FROM public.tradition_pack_releases;
  SELECT count(*) INTO v_vers FROM public.invitation_versions;
  SELECT count(*) INTO v_weds FROM public.weddings;
  SELECT count(*) INTO v_tmpl FROM public.design_templates;
  SELECT count(*) INTO v_users FROM auth.users;
  PERFORM set_config('s4.base_packs', v_packs::text, false);
  PERFORM set_config('s4.base_rels', v_rels::text, false);
  PERFORM set_config('s4.base_vers', v_vers::text, false);
  PERFORM set_config('s4.base_weds', v_weds::text, false);
  PERFORM set_config('s4.base_tmpl', v_tmpl::text, false);
  PERFORM set_config('s4.base_users', v_users::text, false);
  RAISE NOTICE 'PASS BASE the catalogue at entry is measured, not assumed (packs=%, releases=%, versions=%, weddings=%, templates=%, users=%)',
    v_packs, v_rels, v_vers, v_weds, v_tmpl, v_users;
  PERFORM pg_temp.s4_add(1);
END $BASE$;

-- ------------------------------------------------------------------------- fixtures
-- One host, one bystander host, three weddings, three packs, six releases. `ON COMMIT
-- DROP` because psql commits the file only when the whole battery has passed, and a
-- dropped database makes the same erasure moot for the approved rows this file cannot
-- delete.
CREATE TEMP TABLE sf ON COMMIT DROP AS
SELECT gen_random_uuid() AS host_a,    gen_random_uuid() AS host_b,
       gen_random_uuid() AS pack_pin,  gen_random_uuid() AS rel_1,
       gen_random_uuid() AS rel_2,     gen_random_uuid() AS rel_3,
       gen_random_uuid() AS pack_unshipped,
       gen_random_uuid() AS rel_draft, gen_random_uuid() AS rel_reviewed,
       gen_random_uuid() AS pack_dep,  gen_random_uuid() AS rel_dep,
       gen_random_uuid() AS wed,       gen_random_uuid() AS wed_ml,
       gen_random_uuid() AS wed_none,  gen_random_uuid() AS wed_dep,
       gen_random_uuid() AS tmpl;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT host_a, 'stage4-doc-host-a@example.test', jsonb_build_object('name', 'Asha') FROM sf
UNION ALL
SELECT host_b, 'stage4-doc-host-b@example.test', jsonb_build_object('name', 'Bala') FROM sf;

-- A draft template, which is what a migrated or unreviewed template actually is; no
-- assertion here depends on its state, and `stage2/20_attacks.sql` qualifies the
-- approved-template half of the boundary.
INSERT INTO public.design_templates (id, template_key, revision, display_name,
                                     layout_settings, preview_svg)
SELECT tmpl, 'stage4-doc-template', 1, 'TEST ONLY — Stage 4 document battery template',
       '{"margins":"SENTINEL-LAYOUT"}'::jsonb,
       '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
  FROM sf;

-- The main wedding: Tamil, with English alongside, and no pack attached yet. v0 is the
-- document a host writes themselves, and it has to keep working after Stage 4 rather
-- than becoming a special case the resolver tolerates.
INSERT INTO public.weddings (id, owner_user_id, title, primary_language,
                             additional_languages, style_settings, design_template_id)
SELECT wed, host_a, 'Asha weds Bala', 'ta', ARRAY['en'],
       '{"font":"Mukta Malar","fontSize":"20","color":"#7A1F1F","alignment":"left"}',
       tmpl
  FROM sf;

-- A wedding in a language no release of this pack covers, and one where the host has
-- not chosen a language at all. Both exist because both are reachable states of a real
-- editor, and §O's rules are about what the freeze does with them.
INSERT INTO public.weddings (id, owner_user_id, title, primary_language, style_settings)
SELECT wed_ml, host_a, 'Asha weds Bala (Malayalam)', 'ml',
       '{"font":"Anek Malayalam","fontSize":"20","color":"#1F3A5C","alignment":"left"}'
  FROM sf;

INSERT INTO public.weddings (id, owner_user_id, title, primary_language, style_settings)
SELECT wed_none, host_a, 'Asha weds Bala (language undecided)', NULL,
       '{"font":"Mukta Malar","fontSize":"20","color":"#7A1F1F","alignment":"center"}'
  FROM sf;

-- A wedding whose only pack is one that gets retired underneath it: the A1 historical
-- case, held apart from the pinning wedding so its selection is never also the fixture
-- for something else.
INSERT INTO public.weddings (id, owner_user_id, title, primary_language, style_settings)
SELECT wed_dep, host_a, 'Chellam weds Vijay', 'en',
       '{"font":"Mukta Malar","fontSize":"18","color":"#2E4A2E","alignment":"left"}'
  FROM sf;

INSERT INTO public.wedding_people (wedding_id, display_name, role_key, role_label,
                                   group_key, group_label, display_order)
SELECT wed, 'Maran', 'father', 'Father', 'bride-side', 'The families of', 0 FROM sf;

INSERT INTO public.venues (wedding_id, name, address_text, map_url)
SELECT wed, 'Kalyana Mantapa', '1 Museum Road, Madurai', 'https://maps.example.test/km' FROM sf;

INSERT INTO public.wedding_events (wedding_id, event_key, display_name, venue_id,
                                   starts_at_local, ends_at_local, timezone,
                                   display_order, enabled)
SELECT wed, 'muhurtham', 'Muhurtham',
       (SELECT v.id FROM public.venues v WHERE v.wedding_id = sf.wed),
       '2027-02-14 09:30', '2027-02-14 11:00', 'Asia/Kolkata', 0, true FROM sf;

-- The host's own words, and one field deliberately blank so the pack's offer for it can
-- be resolved instead. Written as the maintenance role: the owner's edit path is
-- qualified by `stage3/20_draft_invariant.sql`, and group V below re-writes it as the
-- host to measure an override.
UPDATE public.invitation_drafts d
   SET content = jsonb_build_object(
         'welcome', 'Written by the host, in the host''s own words.',
         'event_notes', '   ',
         'closing', NULL)
  FROM sf
 WHERE d.wedding_id = sf.wed;

-- The Malayalam wedding gets a host welcome on purpose: group F wants the freeze refusal
-- to name ONE cause, the unsupported language, rather than a pile of empty sections.
UPDATE public.invitation_drafts d
   SET content = jsonb_build_object('welcome', 'A host welcome written in English.')
  FROM sf
 WHERE d.wedding_id = sf.wed_ml;

-- The pack: a concept with a scope statement, not a claim about anybody's heritage.
INSERT INTO public.tradition_packs (id, pack_key, display_name, scope_statement)
SELECT pack_pin, 'stage4_doc_pinned', 'TEST ONLY — document battery pinned pack',
       'TEST ONLY — a synthetic pack shape used by the Stage 4 document battery. It '
       'orders sections and offers placeholder wording; it claims no tradition, reviews '
       'no religious text, and is never shipped.'
  FROM sf
UNION ALL
SELECT pack_unshipped, 'stage4_doc_unshipped', 'TEST ONLY — nothing approved pack',
       'TEST ONLY — a pack whose every release is still unapproved, so neither its name '
       'nor any of its wording may reach a customer at all.'
  FROM sf
UNION ALL
SELECT pack_dep, 'stage4_doc_retired', 'TEST ONLY — retired-only pack',
       'TEST ONLY — a pack whose one release was approved, chosen by a test wedding and '
       'then retired, so it is a historical fact and never a fresh choice.'
  FROM sf;

-- Release 1. The sections are written into the JSON array out of position order on
-- purpose: S1 below checks the resolved document is ordered by `position`, so the file
-- proves the ordering rule rather than relying on a fixture that happens to be sorted.
--
-- The fixture is shaped to hold one instance of every resolution outcome at once: a host
-- override of offered pack wording (`opening`), a people list, an event list, an optional
-- section whose only wording is English with fallback refused (`blessing`), and an
-- optional section the host left blank so the pack's English offer arrives as a declared
-- fallback (`event_notes`).
INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT rel_1, pack_pin, 1, 1, ARRAY['en', 'ta'], $r1${
  "sections": [
    {"section_key": "blessing", "position": 4, "kind": "text", "required": false,
     "allow_english_fallback": false,
     "heading": {"en": "A closing line", "ta": "முடிப்பு"},
     "pack_text": {"en": "English-only wording, which a Tamil invitation may not read as Tamil."}},
    {"section_key": "event_notes", "position": 5, "kind": "text", "required": false,
     "host_field": "event_notes", "allow_english_fallback": true,
     "heading": {"en": "Note", "ta": "குறிப்பு"},
     "pack_text": {"en": "Wording A, as the first release wrote the note."}},
    {"section_key": "ceremonies", "position": 3, "kind": "event_list", "required": true,
     "heading": {"en": "The ceremonies", "ta": "நிகழ்ச்சிகள்"}},
    {"section_key": "family", "position": 2, "kind": "people_list", "required": true,
     "heading": {"en": "Our families", "ta": "குடும்பம்"}},
    {"section_key": "opening", "position": 1, "kind": "text", "required": true,
     "host_field": "welcome", "allow_english_fallback": true,
     "heading": {"en": "Opening", "ta": "தொடக்கம்"},
     "pack_text": {"en": "With the goodwill of both families.", "ta": "வணக்கம்"}}
  ],
  "event_vocabulary": [
    {"event_key": "muhurtham", "labels": {"en": "Muhurtham", "ta": "முஹூர்தம்"}}
  ]
}$r1$::jsonb,
  'TEST ONLY — synthetic authored fixture', true,
  'TEST ONLY — drafted by a model from product structure and checked for shape and '
  'language coverage. No human reader of Tamil reviewed any string in this release.',
  'TEST ONLY — no external source', 'First pinned release of the document battery' FROM sf;

-- Release 2: the same five keys, deliberately re-ordered, with two English headings
-- reworded and the note rewritten. This is what §6 means by "a changed approved pack is
-- never edited in place — create a new release", and P3 below is what makes it worth
-- doing.
INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT rel_2, pack_pin, 2, 1, ARRAY['en', 'ta'], $r2${
  "sections": [
    {"section_key": "blessing", "position": 1, "kind": "text", "required": false,
     "allow_english_fallback": false,
     "heading": {"en": "A closing line", "ta": "முடிப்பு"},
     "pack_text": {"en": "English-only wording, which a Tamil invitation may not read as Tamil."}},
    {"section_key": "opening", "position": 2, "kind": "text", "required": true,
     "host_field": "welcome", "allow_english_fallback": true,
     "heading": {"en": "Welcome words", "ta": "தொடக்கம்"},
     "pack_text": {"en": "With the goodwill of both families.", "ta": "வணக்கம்"}},
    {"section_key": "family", "position": 3, "kind": "people_list", "required": true,
     "heading": {"en": "The families", "ta": "குடும்பம்"}},
    {"section_key": "ceremonies", "position": 4, "kind": "event_list", "required": true,
     "heading": {"en": "When and where", "ta": "நிகழ்ச்சிகள்"}},
    {"section_key": "event_notes", "position": 5, "kind": "text", "required": false,
     "host_field": "event_notes", "allow_english_fallback": true,
     "heading": {"en": "Note", "ta": "குறிப்பு"},
     "pack_text": {"en": "Wording B, as the second release rewrote the note."}}
  ],
  "event_vocabulary": [
    {"event_key": "muhurtham", "labels": {"en": "Muhurtham", "ta": "முஹூர்தம்"}}
  ]
}$r2$::jsonb,
  'TEST ONLY — synthetic authored fixture', true,
  'TEST ONLY — drafted by a model from product structure and checked for shape and '
  'language coverage. No human reader of Tamil reviewed any string in this release.',
  'TEST ONLY — no external source',
  'Second release: sections reordered, two headings reworded, the note rewritten' FROM sf;

-- Release 3: a release that is well-formed to the authoring guard and un-freezable to
-- the document — a required text section whose only wording is English with the fallback
-- refused, on a Tamil invitation. Group F is about the boundary that catches it.
INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT rel_3, pack_pin, 3, 1, ARRAY['en', 'ta'], $r3${
  "sections": [
    {"section_key": "opening", "position": 1, "kind": "text", "required": true,
     "host_field": "welcome", "allow_english_fallback": true,
     "heading": {"en": "Opening", "ta": "தொடக்கம்"},
     "pack_text": {"en": "With the goodwill of both families.", "ta": "வணக்கம்"}},
    {"section_key": "blessing", "position": 2, "kind": "text", "required": true,
     "allow_english_fallback": false,
     "heading": {"en": "A closing line", "ta": "முடிப்பு"},
     "pack_text": {"en": "English-only wording for a section this release calls required."}}
  ]
}$r3$::jsonb,
  'TEST ONLY — synthetic authored fixture', true,
  'TEST ONLY — drafted by a model. Deliberately unresolvable in Tamil so the freeze '
  'boundary has something to refuse.',
  'TEST ONLY — no external source', 'Third release: a required section with no Tamil' FROM sf;

-- The never-approved candidate, and the release that will be retired under a wedding.
INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference)
SELECT rel_draft, pack_unshipped, 1, 1, ARRAY['en', 'ta'], $rd${
  "sections": [
    {"section_key": "opening", "position": 1, "kind": "text", "required": false,
     "host_field": "welcome", "heading": {"en": "Opening", "ta": "தொடக்கம்"}}
  ]
}$rd$::jsonb,
  'TEST ONLY — unreviewed draft candidate', true,
  'TEST ONLY — drafted by a model. Nobody has reviewed this one at all, which is what '
  'makes it the thing a customer must not be able to see.',
  'TEST ONLY — no external source' FROM sf
UNION ALL
SELECT rel_reviewed, pack_unshipped, 2, 1, ARRAY['en', 'ta'], $rr${
  "sections": [
    {"section_key": "opening", "position": 1, "kind": "text", "required": false,
     "host_field": "welcome", "heading": {"en": "Opening", "ta": "தொடக்கம்"},
     "pack_text": {"en": "Wording nobody approved a customer to read.",
                   "ta": "வணக்கம்"}}
  ]
}$rr$::jsonb,
  'TEST ONLY — reviewed but never approved', true,
  'TEST ONLY — a synthetic review record was written against this release; no human '
  'reader of Tamil reviewed its strings and no approver ever accepted it.',
  'TEST ONLY — no external source' FROM sf
UNION ALL
SELECT rel_dep, pack_dep, 1, 1, ARRAY['en'], $rz${
  "sections": [
    {"section_key": "opening", "position": 1, "kind": "text", "required": false,
     "host_field": "welcome", "heading": {"en": "Opening"}}
  ]
}$rz$::jsonb,
  'TEST ONLY — approved once, then retired', true,
  'TEST ONLY — drafted by a model and checked for shape only. No human reader of any '
  'language reviewed it.',
  'TEST ONLY — no external source' FROM sf;

-- ------------------------------------------------------------------ the lifecycle, walked
-- Every release walks the legal steps, because the guard makes an approved row
-- unwritable in one statement and that is the property under test, not an obstacle to
-- getting past it. The never-approved candidate is left exactly where it is: a draft
-- that has never been reviewed, and a reviewed row that was never approved.
DO $L$
DECLARE v_err text;
BEGIN
  -- draft -> reviewed states the review, so it has to say when, what and who read which
  -- languages of it.
  UPDATE public.tradition_pack_releases r
     SET status = 'reviewed', reviewed_at = now(),
         review_label = 'TEST ONLY — REVIEWED FIXTURE',
         review_basis = 'TEST ONLY — a synthetic record written by the Stage 4 document '
                        'battery. No human reader of Tamil reviewed these strings.',
         review_scope = 'TEST ONLY — section order and structure only. No language review, '
                        'no religious or community endorsement, no customer validation.',
         reviewed_languages = ARRAY['en', 'ta']
    FROM sf WHERE r.id IN (sf.rel_1, sf.rel_2, sf.rel_3);
  PERFORM pg_temp.s4_eq('L0 the three releases of the pinned pack are reviewed, and reviewed is a step that happened rather than a field that was typed',
    (SELECT count(*) FROM public.tradition_pack_releases
      WHERE id IN (SELECT rel_1 FROM sf UNION SELECT rel_2 FROM sf UNION SELECT rel_3 FROM sf)
        AND status = 'reviewed' AND reviewed_at IS NOT NULL), 3::bigint);

  -- The one release of the retired-only pack is reviewed on `en` alone, which is legal
  -- for a release that only ever covered `en`.
  UPDATE public.tradition_pack_releases r
     SET status = 'reviewed', reviewed_at = now(),
         review_label = 'TEST ONLY — REVIEWED FIXTURE',
         review_basis = 'TEST ONLY — a synthetic record written by the Stage 4 document '
                        'battery.',
         review_scope = 'TEST ONLY — structure only, English only, no language review.',
         reviewed_languages = ARRAY['en']
    FROM sf WHERE r.id = sf.rel_dep;

  -- The never-approved candidate's second release is walked to `reviewed` and no further.
  -- It has to exist, because §10 names `reviewed` as a state a customer must not be able
  -- to see; a pack whose releases were only ever drafts could not measure that half of
  -- ruling A3, and its first release stays a draft so both invisible states are present.
  UPDATE public.tradition_pack_releases r
     SET status = 'reviewed', reviewed_at = now(),
         review_label = 'TEST ONLY — REVIEWED, NEVER APPROVED',
         review_basis = 'TEST ONLY — a synthetic record written by the Stage 4 document '
                        'battery for a release no approver ever accepted.',
         review_scope = 'TEST ONLY — structure only, no language review.',
         reviewed_languages = ARRAY['en', 'ta']
    FROM sf WHERE r.id = sf.rel_reviewed;

  PERFORM pg_temp.s4_eq('L0b the unshipped pack has exactly one draft and one reviewed release, and nothing approved',
    (SELECT array_agg(x.status ORDER BY x.release_number)
       FROM public.tradition_pack_releases x
      WHERE x.pack_id = (SELECT pack_unshipped FROM sf)),
    ARRAY['draft', 'reviewed']::text[]);

  -- reviewed -> approved must not restate the review it was reviewed under, and this call
  -- does not: it changes one column and lets the trigger fill in the timestamp.
  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET status = ''approved'', '
                          || 'review_label = ''TEST ONLY — RESTATED'' '
                          || 'WHERE id = (SELECT rel_1 FROM sf)');
  PERFORM pg_temp.s4_ok('L1 approving a release cannot rewrite the review it was approved against (' || v_err || ')',
    v_err LIKE '23514%cannot change the review record%');
  PERFORM pg_temp.s4_eq('L1b and the refused write left the row exactly where it was',
    (SELECT r.status || '|' || r.review_label FROM public.tradition_pack_releases r
      WHERE r.id = (SELECT rel_1 FROM sf)), 'reviewed|TEST ONLY — REVIEWED FIXTURE');

  UPDATE public.tradition_pack_releases r SET status = 'approved'
    FROM sf WHERE r.id IN (sf.rel_1, sf.rel_2, sf.rel_3, sf.rel_dep);
  PERFORM pg_temp.s4_eq('L2 the honest four-step walk reaches approved, with the approval timestamp written by the lifecycle rather than by the caller',
    (SELECT count(*) FROM public.tradition_pack_releases
      WHERE status = 'approved' AND approved_at IS NOT NULL),
    (SELECT count(*) FROM public.tradition_pack_releases WHERE status = 'approved'));
END $L$;

-- ===========================================================================
-- P. PINNING, AND THE TWO MOMENTS APPROVAL IS ENFORCED
-- ===========================================================================
-- §11 of the design and reviewer ruling A1. "We pin it" is a sentence; this group is the
-- measurement of it, in the order the ruling dictates and in no other order, because the
-- order is what separates the two claims:
--   select approved R1 -> freeze V1 -> retire R1 ->
--     V1's bytes have not moved, V1 still projects for a guest, the wedding still knows
--     it selected R1, and the *read* path is alive — while a NEW freeze is refused and
--     choosing R1 afresh is refused, at the database boundary, not in the UI;
--   then the host moves to approved R2 themselves (nothing switches behind their back),
--     V1 is still byte-identical, and freezing works again.
-- "A version already frozen from it is unaffected" and "no new version may be published
-- from it" are different sentences, and each gets its own assertion below.
DO $P$
DECLARE
  v_host   uuid;
  v_wed    uuid;
  v_r1     uuid;
  v_r2     uuid;
  v_res    jsonb;
  v_snap0  jsonb;
  v_snap1  jsonb;
  v_snap2  jsonb;
  v_txt1   text;
  v_dto1   jsonb;
  v_dto2   jsonb;
  v_prev   jsonb;
  v_ver0   uuid;
  v_ver1   uuid;
  v_ver2   uuid;
  v_ver3   uuid;
  v_err    text;
  v_n      bigint;
BEGIN
  PERFORM pg_temp.s4_is_superuser('P0 the pinning group starts as the maintenance role, so a leaked SET ROLE cannot be silently re-labelled as a customer result');
  SELECT host_a, wed, rel_1, rel_2 INTO v_host, v_wed, v_r1, v_r2 FROM sf;

  -- v0: a document with no pack at all, frozen first so every later version is measured
  -- against a wedding that has a history rather than a wedding that has nothing yet.
  v_res := pg_temp.s4_freeze(v_host, v_wed);
  v_ver0 := v_res ->> 'version_id';
  v_snap0 := v_res -> 'snapshot';
  PERFORM pg_temp.s4_eq('P1 the pack-less document freezes through the same call as a packed one, and its release block is a JSON null rather than an invented one',
    jsonb_typeof(v_snap0 -> 'tradition_pack_release'), 'null'::text);
  PERFORM pg_temp.s4_eq('P1b and the version row records no release',
    (SELECT count(*) FROM public.invitation_versions v
      WHERE v.id = v_ver0 AND v.tradition_pack_release_id IS NULL), 1::bigint);
  PERFORM pg_temp.s4_eq('P1c so there is exactly one resolution path, with a pack and without one: the sections are the default definition''s',
    (SELECT array_agg(q ->> 'section_key' ORDER BY (q ->> 'position')::integer)
       FROM jsonb_array_elements(v_snap0 -> 'sections' -> 'items') e(q)),
    ARRAY['welcome', 'family_introduction', 'family', 'ceremonies', 'event_notes',
          'closing']);

  -- The selection, made by the host through the same UPDATE the browser sends.
  v_err := pg_temp.s4_select(v_host, v_wed, v_r1);
  PERFORM pg_temp.s4_eq('P2 an approved release is the one selection that succeeds, and the wedding holds exactly the row that was named',
    ARRAY[v_err, (SELECT (w.tradition_pack_release_id = v_r1)::text
                    FROM public.weddings w WHERE w.id = v_wed)],
    ARRAY['no-error', 'true']);

  v_res := pg_temp.s4_freeze(v_host, v_wed);
  v_ver1 := v_res ->> 'version_id';
  v_snap1 := v_res -> 'snapshot';
  v_txt1 := v_snap1::text;
  v_dto1 := pg_temp.s4_dto(v_ver1);

  PERFORM pg_temp.s4_eq('P3 the frozen document names the pack *and* the exact release number, which is the only pair that answers "what did this guest read?"',
    ARRAY[v_snap1 -> 'tradition_pack_release' ->> 'pack_key',
          v_snap1 -> 'tradition_pack_release' ->> 'release_number'],
    ARRAY['stage4_doc_pinned', '1']);
  PERFORM pg_temp.s4_eq('P3b and the version row pins the release the wedding selected, not a release the freeze picked for it',
    (SELECT (v.tradition_pack_release_id = v_r1)::text FROM public.invitation_versions v
      WHERE v.id = v_ver1), 'true');
  PERFORM pg_temp.s4_eq('P3c the document declares the contract shape it actually is, which is the only shape the projection honours',
    (SELECT v.snapshot_schema_version FROM public.invitation_versions v WHERE v.id = v_ver1),
    2);
  PERFORM pg_temp.s4_eq('P3d and the release block carries no identifier of any kind, because a published payload has no use for one',
    (SELECT count(*) FROM pg_temp.s4_keys(v_snap1 -> 'tradition_pack_release') k
      WHERE k.k IN ('id', 'release_id', 'pack_id', 'reviewed_by')), 0::bigint);

  -- ------------------------------------------------------------------ the retirement
  -- This is the moment the ruling is about: the release stops being a fresh choice while
  -- the document already frozen from it keeps existing.
  UPDATE public.tradition_pack_releases r SET status = 'deprecated' WHERE r.id = v_r1;

  PERFORM pg_temp.s4_eq('P4 retiring the release did not touch the frozen snapshot',
    (SELECT v.snapshot::text FROM public.invitation_versions v WHERE v.id = v_ver1), v_txt1);
  PERFORM pg_temp.s4_jq('P4b retiring the release did not change a byte of the guest document it projects to',
    pg_temp.s4_dto(v_ver1), v_dto1);
  PERFORM pg_temp.s4_eq('P4c and the version still names the release it was frozen from: a fact about the past is not re-decided',
    (SELECT (v.tradition_pack_release_id = v_r1)::text FROM public.invitation_versions v
      WHERE v.id = v_ver1), 'true');
  PERFORM pg_temp.s4_eq('P4d the wedding that selected it still points at it, for the same reason, which is why the FK is RESTRICT and the guard refuses the DELETE',
    (SELECT (w.tradition_pack_release_id = v_r1)::text FROM public.weddings w
      WHERE w.id = v_wed), 'true');
  PERFORM pg_temp.s4_eq('P4e and the retired row is still a row, with its content and its review record intact',
    (SELECT r.status || '|' || r.review_label FROM public.tradition_pack_releases r
      WHERE r.id = v_r1), 'deprecated|TEST ONLY — REVIEWED FIXTURE');

  -- The read path stays open, which is what "historical visibility" means in the product.
  v_prev := pg_temp.s4_preview(v_host, v_wed);
  PERFORM pg_temp.s4_eq('P5 the host can still preview the document that names the retired release, so retirement is not deletion',
    ARRAY[coalesce(v_prev ->> 'error', 'ok'),
          v_prev -> 'tradition_pack' ->> 'release_number'],
    ARRAY['ok', '1']);

  -- Ruling A1's second moment: a NEW freeze from the retired release is refused, at the
  -- boundary, while everything already published keeps resolving.
  v_n := (SELECT count(*) FROM public.invitation_versions WHERE wedding_id = v_wed);
  v_err := pg_temp.s4_freeze_err(v_host, v_wed);
  PERFORM pg_temp.s4_ok('P6 freezing a new version from a retired release is refused by the database and not by the UI (' || left(v_err, 120) || ')',
    v_err LIKE '42501%may only be frozen from an approved tradition pack release (this one is deprecated)%');
  PERFORM pg_temp.s4_eq('P6b and the refused freeze created no version',
    (SELECT count(*) FROM public.invitation_versions WHERE wedding_id = v_wed), v_n);
  PERFORM pg_temp.s4_eq('P6c it moved no selection, which is the silent switch the ruling forbids',
    (SELECT (w.tradition_pack_release_id = v_r1)::text FROM public.weddings w
      WHERE w.id = v_wed), 'true');
  PERFORM pg_temp.s4_eq('P6d and it changed no byte of the version already frozen from that release',
    (SELECT snapshot::text FROM public.invitation_versions v WHERE v.id = v_ver1), v_txt1);
  PERFORM pg_temp.s4_jq('P6e while the guest document of the pinned version still projects after the refusal, which is the whole point of pinning',
    pg_temp.s4_dto(v_ver1), v_dto1);

  -- Ruling A1's first moment, and a different claim from P6: readable is not selectable.
  v_err := pg_temp.s4_select(v_host, v_wed, v_r1);
  PERFORM pg_temp.s4_ok('P7 choosing the retired release afresh is refused too, naming its status (' || left(v_err, 120) || ')',
    v_err LIKE '42501%may only select an approved tradition pack release (this one is deprecated)%');
  PERFORM pg_temp.s4_eq('P7b and the refused selection left the wedding on the release it was already on',
    (SELECT (w.tradition_pack_release_id = v_r1)::text FROM public.weddings w
      WHERE w.id = v_wed), 'true');

  -- The way off is the host's own, and it is the only write this moment allows.
  v_err := pg_temp.s4_select(v_host, v_wed, v_r2);
  PERFORM pg_temp.s4_eq('P8 selecting the still-approved release 2 is the one write that succeeds, so P6 and P7 refused a status rather than the account, the wedding or the table',
    v_err, 'no-error');

  v_res := pg_temp.s4_freeze(v_host, v_wed);
  v_ver2 := v_res ->> 'version_id';
  v_snap2 := v_res -> 'snapshot';
  v_dto2 := pg_temp.s4_dto(v_ver2);

  PERFORM pg_temp.s4_eq('P8b freezing works again, and the new version pins release 2',
    ARRAY[v_snap2 -> 'tradition_pack_release' ->> 'pack_key',
          v_snap2 -> 'tradition_pack_release' ->> 'release_number'],
    ARRAY['stage4_doc_pinned', '2']);
  PERFORM pg_temp.s4_eq('P8c while the older version still pins release 1: selecting a newer release never moves an older one',
    (SELECT (v.tradition_pack_release_id = v_r1)::text FROM public.invitation_versions v
      WHERE v.id = v_ver1), 'true');
  PERFORM pg_temp.s4_jq('P8d and V1''s guest document is unchanged by the existence of V2, which is what makes the two links two documents rather than one document that was edited',
    pg_temp.s4_dto(v_ver1), v_dto1);
  PERFORM pg_temp.s4_ok('P8e the two documents are genuinely different, so P8c is not a tautology about identical rows',
    v_txt1 IS DISTINCT FROM v_snap2::text);
  PERFORM pg_temp.s4_eq('P8f and the difference is the second release''s own wording, in the section it rewrote',
    ARRAY[(SELECT q -> 'body' ->> 'text'
              FROM jsonb_array_elements(v_dto1 -> 'sections' -> 'items') q
             WHERE q ->> 'section_key' = 'event_notes'),
          (SELECT q -> 'body' ->> 'text'
              FROM jsonb_array_elements(v_dto2 -> 'sections' -> 'items') q
             WHERE q ->> 'section_key' = 'event_notes')],
    ARRAY['Wording A, as the first release wrote the note.',
          'Wording B, as the second release rewrote the note.']);

  -- The freeze as a pure function of the rows behind it: nothing in the document comes
  -- from the clock, so a republished invitation reads exactly as the same invitation did.
  v_res := pg_temp.s4_freeze(v_host, v_wed);
  v_ver3 := v_res ->> 'version_id';
  PERFORM pg_temp.s4_jq('P9 freezing twice with nothing else changed produces the same document bytes, so no assertion above is measuring a timestamp',
    v_res -> 'snapshot', v_snap2);

  -- Clearing the selection is legal, and only then does historical visibility fall away:
  -- a deprecated release is readable while one of this customer's weddings points at it.
  v_err := pg_temp.s4_select(v_host, v_wed, NULL);
  PERFORM pg_temp.s4_eq('P10 the host may always let go of a pack, and "no pack, I write it myself" is the choice the guard never refuses',
    v_err, 'no-error');
  PERFORM pg_temp.s4_eq('P10b and the wedding now holds no release rather than a stale pointer',
    (SELECT w.tradition_pack_release_id::text FROM public.weddings w WHERE w.id = v_wed),
    NULL);
  PERFORM pg_temp.s4_lacks('P11 once the last wedding lets go of it, the retired release is not a row this customer can read at all',
    pg_temp.s4_releases_visible(v_host), 'stage4_doc_pinned/1=deprecated');
  PERFORM pg_temp.s4_has('P11b while the approved release of the same pack stays readable, so letting go of one release does not hide the concept',
    pg_temp.s4_releases_visible(v_host), 'stage4_doc_pinned/2=approved');
  v_err := pg_temp.s4_select(v_host, v_wed, v_r1);
  PERFORM pg_temp.s4_ok('P11c and reaching for the retired release after letting go is refused as well, by the row policy now rather than by the status check (' || left(v_err, 120) || ')',
    v_err LIKE '42501%');

  -- The ledger, which is the form a customer can be told about: nothing was overwritten.
  PERFORM pg_temp.s4_eq('P12 all four freezes are still in the ledger, and the refused one added no fifth',
    (SELECT count(*) FROM public.invitation_versions WHERE wedding_id = v_wed), 4::bigint);
  PERFORM pg_temp.s4_eq('P12b numbered in the order they happened',
    (SELECT array_agg(v.version_number ORDER BY v.version_number)
       FROM public.invitation_versions v WHERE v.wedding_id = v_wed),
    ARRAY[1, 2, 3, 4]);
  PERFORM pg_temp.s4_eq('P12c every one of them still projects a guest document, so no published link sags',
    (SELECT count(*) FROM public.invitation_versions v
      WHERE v.wedding_id = v_wed
        AND private.public_invitation_dto(v.snapshot_schema_version, v.snapshot) IS NOT NULL),
    4::bigint);
  PERFORM pg_temp.s4_eq('P12d and each one names the release it was frozen from, never the one the wedding happens to select now',
    (SELECT array_agg(x.dto -> 'tradition_pack' ->> 'release_number' ORDER BY x.n)
       FROM (SELECT v.version_number AS n,
                    private.public_invitation_dto(v.snapshot_schema_version, v.snapshot)
                      AS dto
              FROM public.invitation_versions v WHERE v.wedding_id = v_wed) x),
    ARRAY[NULL, '1', '2', '2']::text[]);
END $P$;
-- ===========================================================================
-- LC. THE LIFECYCLE GUARD, MEASURED ON A ROW THIS BATTERY OWNS
-- ===========================================================================
-- Reviewer ruling A2: forward-only, four states, and a release that has left `draft` is a
-- frozen review unit. Every case below constructs a fully valid row, names the mechanism it
-- expects to refuse it, and then reads the row back through `s4_chash` / `s4_rhash` —
-- because a refusal that also wrote half of itself is the failure mode this guard exists to
-- prevent, and it is invisible unless the state is measured afterwards.
--
-- The battery authors its own release rather than reusing `rel_1`, for two reasons: `rel_1`
-- has already been retired by group P and so has no legal step left to take, and an
-- approved row cannot be deleted, so the deletion cases need a row nothing references.
--
-- The legal steps are walked, not just refused. A guard that refuses everything is not a
-- lifecycle, and ruling A2's warning about the automatic `updated_at` trigger is only
-- qualified by taking a transition that moves the timestamp and proving the content guard
-- stayed out of it.

DO $LC$
DECLARE
  v_pack   uuid;
  v_rel    uuid;
  v_gone   uuid;
  v_host   uuid;
  v_def    jsonb;
  v_def2   jsonb;
  v_ch     text;
  v_rh     text;
  v_all    text;
  v_upd0   timestamptz;
  v_review jsonb;
  v_err    text;
  v_item   record;
BEGIN
  PERFORM pg_temp.s4_is_superuser('LC0 the lifecycle group runs as the maintenance role, which is the only role that can author a release at all');
  SELECT host_a INTO v_host FROM sf;
  v_pack := gen_random_uuid();
  v_rel  := gen_random_uuid();
  v_gone := gen_random_uuid();

  INSERT INTO public.tradition_packs (id, pack_key, display_name, scope_statement)
  VALUES (v_pack, 'stage4_doc_lifecycle', 'TEST ONLY — lifecycle probe pack',
          'TEST ONLY — a synthetic pack this battery walks through every legal lifecycle '
          'step so the forward-only guard is measured on a row nothing else references. It '
          'claims no tradition, reviews no religious text and ships to no customer.');

  v_def := jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
    'section_key', 'opening', 'position', 1, 'kind', 'text', 'required', false,
    'host_field', 'welcome',
    'heading', jsonb_build_object('en', 'Opening', 'ta', 'தொடக்கம்'))));

  ------------------------------------------------------- a row cannot be born at the far end
  -- §6: `approved` is a conclusion, so it cannot be a starting value. Each refusal is
  -- measured against a row that is valid in every other column, with the review metadata
  -- supplied so the status is the only reason it could fail.
  FOR v_item IN SELECT s AS status FROM (VALUES ('reviewed'), ('approved'), ('deprecated')) s(status)
  LOOP
    v_err := pg_temp.s4_err(format(
      'INSERT INTO public.tradition_pack_releases '
      || '(id, pack_id, release_number, definition_schema_version, languages, definition, '
      || 'author_label, machine_assisted, machine_assistance_notes, source_reference, '
      || 'status, review_label, review_basis, review_scope, reviewed_languages, '
      || 'reviewed_at, approved_at, deprecated_at) '
      || 'VALUES (gen_random_uuid(), %L, 500, 1, ARRAY[''en'',''ta''], %L::jsonb, %L, true, %L, '
      || '''TEST ONLY — no external source'', %L, '
      || '''TEST ONLY — REVIEWED FIXTURE'', '
      || '''TEST ONLY — a synthetic record written by the battery, for a release nobody '
      || 'actually read.'', '
      || '''TEST ONLY — structure only, no language review.'', '
      || 'ARRAY[''en'',''ta''], now(), '
      || 'CASE WHEN %L IN (''approved'',''deprecated'') THEN now() END, '
      || 'CASE WHEN %L = ''deprecated'' THEN now() END)',
      v_pack, v_def, 'TEST ONLY — born-already probe',
      'TEST ONLY — drafted by a model and checked for shape only. No human reader of Tamil '
      'reviewed any string in this row.',
      v_item.status, v_item.status, v_item.status));
    PERFORM pg_temp.s4_ok('LC1 a release cannot be created already ' || v_item.status
      || ' (' || left(v_err, 100) || ')',
      v_err LIKE '23514%begins life as draft%');
  END LOOP;
  PERFORM pg_temp.s4_eq('LC1b and none of the three refused births left a row behind',
    (SELECT count(*) FROM public.tradition_pack_releases WHERE pack_id = v_pack), 0::bigint);

  -- The positive control on the same statement shape, so LC1 measures the status value and
  -- not the fixture's ability to insert at all.
  INSERT INTO public.tradition_pack_releases
    (id, pack_id, release_number, definition_schema_version, languages, definition,
     author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
  VALUES (v_rel, v_pack, 1, 1, ARRAY['en', 'ta'], v_def,
          'TEST ONLY — lifecycle probe', true,
          'TEST ONLY — drafted by a model and checked for shape and language coverage. No '
          'human reader of Tamil reviewed any string in this row.',
          'TEST ONLY — no external source', 'First release of the lifecycle probe');
  PERFORM pg_temp.s4_eq('LC2 the same row created as a draft is created, because draft is the only status a birth may have',
    (SELECT r.status FROM public.tradition_pack_releases r WHERE r.id = v_rel), 'draft');

  ------------------------------------------------------------- while it is a draft, it is a draft
  v_ch := pg_temp.s4_chash(v_rel);
  v_def2 := jsonb_set(v_def, '{sections,0,heading,en}', '"Opening, revised while draft"');
  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET definition = '
                          || quote_literal(v_def2::text) || '::jsonb WHERE id = '
                          || quote_literal(v_rel::text));
  PERFORM pg_temp.s4_eq('LC3 a draft is editable, which is the entire point of it being a draft (' || v_err || ')',
    v_err, 'no-error');
  PERFORM pg_temp.s4_eq('LC3b and the edit is what landed, so the guard is not silently reverting drafts either',
    (SELECT r.definition -> 'sections' -> 0 -> 'heading' ->> 'en'
       FROM public.tradition_pack_releases r WHERE r.id = v_rel),
    'Opening, revised while draft');
  PERFORM pg_temp.s4_ok('LC3c and the content hash moved, which is what makes the refusals below measurements of a change rather than of a no-op',
    pg_temp.s4_chash(v_rel) IS DISTINCT FROM v_ch);
  v_ch := pg_temp.s4_chash(v_rel);

  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET review_label = '
                          || '''TEST ONLY — a reviewer who has not reviewed this yet'' '
                          || 'WHERE id = ' || quote_literal(v_rel::text));
  PERFORM pg_temp.s4_ok('LC4 a draft cannot acquire review metadata by an edit, which is the door an in-place approval would use (' || left(v_err, 100) || ')',
    v_err LIKE '23514%draft_carries_no_review_metadata%');
  PERFORM pg_temp.s4_eq('LC4b and the refused write left the draft describing no review at all',
    (SELECT count(*) FROM public.tradition_pack_releases r WHERE r.id = v_rel
       AND r.review_label IS NULL AND r.reviewed_at IS NULL AND r.approved_at IS NULL),
    1::bigint);

  -- The one status the undeletable rule does not cover, measured rather than assumed:
  -- otherwise "a release may not be deleted" would be a claim about the table instead of
  -- about the lifecycle.
  INSERT INTO public.tradition_pack_releases
    (id, pack_id, release_number, definition_schema_version, languages, definition,
     author_label, machine_assisted, machine_assistance_notes, source_reference)
  VALUES (v_gone, v_pack, 2, 1, ARRAY['en', 'ta'], v_def,
          'TEST ONLY — disposable draft', true,
          'TEST ONLY — drafted by a model and checked for shape only. No human reader of '
          'Tamil reviewed any string in this row.', 'TEST ONLY — no external source');
  v_err := pg_temp.s4_err('DELETE FROM public.tradition_pack_releases WHERE id = '
                          || quote_literal(v_gone::text));
  PERFORM pg_temp.s4_eq('LC5 a draft nobody has read may be deleted, so the deletion rule is about status (' || v_err || ')',
    v_err, 'no-error');
  PERFORM pg_temp.s4_eq('LC5b and it is gone',
    (SELECT count(*) FROM public.tradition_pack_releases WHERE id = v_gone), 0::bigint);

  ------------------------------------------------------------- the legal step, timestamp and all
  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET status = ''reviewed'' '
                          || 'WHERE id = ' || quote_literal(v_rel::text));
  PERFORM pg_temp.s4_ok('LC6 marking a release reviewed has to say when, so a review cannot be asserted without a date (' || left(v_err, 100) || ')',
    v_err LIKE '23514%has to say when%');
  PERFORM pg_temp.s4_eq('LC6b and the refused step left the release a draft, with no review record',
    (SELECT r.status FROM public.tradition_pack_releases r WHERE r.id = v_rel), 'draft');

  v_upd0 := (SELECT r.updated_at FROM public.tradition_pack_releases r WHERE r.id = v_rel);
  v_review := (SELECT jsonb_build_object('label', r.review_label, 'basis', r.review_basis,
                                        'scope', r.review_scope, 'langs', r.reviewed_languages,
                                        'at', r.reviewed_at, 'by', r.reviewed_by)
                 FROM public.tradition_pack_releases r WHERE r.id = v_rel);
  UPDATE public.tradition_pack_releases SET status = 'reviewed', reviewed_at = now(),
         review_label = 'TEST ONLY — REVIEWED FIXTURE',
         review_basis = 'TEST ONLY — a synthetic record written by the Stage 4 document '
                        'battery. No human reader of Tamil reviewed these strings.',
         review_scope = 'TEST ONLY — section order and structure only. No language review, '
                        'no religious or community endorsement, no customer validation.',
         reviewed_languages = ARRAY['en', 'ta']
   WHERE id = v_rel;

  PERFORM pg_temp.s4_eq('LC7 the honest step draft→reviewed is taken, and the review record is the caller''s statement rather than the trigger''s invention',
    (SELECT r.status FROM public.tradition_pack_releases r WHERE r.id = v_rel), 'reviewed');
  -- Measured, not assumed: this file runs inside one transaction (`run.sh` uses
  -- `--single-transaction`, so a file that fails leaves nothing behind), and `now()` is the
  -- transaction timestamp. The touch trigger therefore rewrites `updated_at` with *the same
  -- instant* on every step, and a clock difference is not available as evidence here. LC7d
  -- tests the mechanism with an explicit timestamp instead, which is the version of the
  -- question that has a deterministic answer.
  PERFORM pg_temp.s4_eq('LC7b and the touch trigger wrote the bookkeeping column on the legal step, with the transaction timestamp it always has',
    (SELECT r.updated_at FROM public.tradition_pack_releases r WHERE r.id = v_rel), v_upd0);
  PERFORM pg_temp.s4_eq('LC7c and the content guard stayed out of it, so a legal lifecycle step is never a false positive for content editing',
    pg_temp.s4_chash(v_rel), v_ch);

  -- The ruling A2 warning, in the form that can actually be measured: a step that *also*
  -- carries a written value for the timestamp column must still be judged only on the
  -- frozen columns, and the mechanism must still own that column.
  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET status = status, '
                          || 'updated_at = ''2020-01-01T00:00:00+00''::timestamptz '
                          || 'WHERE id = ' || quote_literal(v_rel::text));
  v_all := pg_temp.s4_hash_of(v_rel);
  PERFORM pg_temp.s4_eq('LC7d a legal write that names the automatic timestamp column is not read as content editing (' || v_err || ')',
    v_err, 'no-error');
  PERFORM pg_temp.s4_eq('LC7e and the mechanism overwrote the caller''s timestamp, which is exactly why it cannot be part of the frozen tuple',
    (SELECT r.updated_at = now() AND r.updated_at <> '2020-01-01T00:00:00+00'::timestamptz
       FROM public.tradition_pack_releases r WHERE r.id = v_rel), true);
  PERFORM pg_temp.s4_eq('LC7f and neither the content nor the review record moved',
    pg_temp.s4_hash_of(v_rel), v_all);

  ------------------------------------------------------------------ the edges that do not exist
  PERFORM pg_temp.s4_eq('LC8a the review record the caller wrote is stored, so LC10 below refuses a *change* to it rather than an absence of it',
    (SELECT jsonb_build_object('label', r.review_label, 'basis', r.review_basis,
                               'scope', r.review_scope, 'langs', r.reviewed_languages,
                               'at', r.reviewed_at IS NOT NULL, 'by', r.reviewed_by)
       FROM public.tradition_pack_releases r WHERE r.id = v_rel),
    jsonb_build_object('label', 'TEST ONLY — REVIEWED FIXTURE',
      'basis', 'TEST ONLY — a synthetic record written by the Stage 4 document battery. '
               'No human reader of Tamil reviewed these strings.',
      'scope', 'TEST ONLY — section order and structure only. No language review, no '
               'religious or community endorsement, no customer validation.',
      'langs', ARRAY['en', 'ta'], 'at', true, 'by', NULL));
  v_ch := pg_temp.s4_chash(v_rel);
  v_rh := pg_temp.s4_rhash(v_rel);
  v_all := pg_temp.s4_hash_of(v_rel);
  -- The record as it stands now, which is the value LC13c expects to still be there after
  -- the approval step. Captured here rather than at the top of the group, because the top
  -- of the group is a draft and a draft carries no record at all.
  v_review := (SELECT jsonb_build_object('label', r.review_label, 'basis', r.review_basis,
                                        'scope', r.review_scope, 'langs', r.reviewed_languages,
                                        'at', r.reviewed_at, 'by', r.reviewed_by)
                 FROM public.tradition_pack_releases r WHERE r.id = v_rel);

  FOR v_item IN SELECT f AS from_status, t AS to_status
                  FROM (VALUES ('reviewed', 'draft')) e(f, t)
  LOOP
    v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET status = '
      || quote_literal(v_item.to_status) || ' WHERE id = ' || quote_literal(v_rel::text));
    PERFORM pg_temp.s4_ok('LC8b a release cannot move from ' || v_item.from_status || ' to '
      || v_item.to_status || ': un-reviewing it would either leave a review claim on wording '
      'nobody read or destroy the record of what was read (' || left(v_err, 100) || ')',
      v_err LIKE '23514%cannot move from%');
    PERFORM pg_temp.s4_eq('LC8c and the refused edge left the release in ' || v_item.from_status,
      (SELECT r.status FROM public.tradition_pack_releases r WHERE r.id = v_rel),
      v_item.from_status);
    PERFORM pg_temp.s4_eq('LC8d and it wrote neither content nor review record',
      pg_temp.s4_hash_of(v_rel), v_all);
  END LOOP;

  --------------------------------------------------------- the frozen unit, column by column
  -- The content half, at a status that has left `draft`. The loop exists for coverage
  -- rather than ceremony: a guard that froze `definition` and forgot `changelog` would let
  -- a release keep its review claim while its own history was rewritten underneath it.
  FOR v_item IN
    SELECT * FROM (VALUES
      ('definition',
       $$definition = jsonb_set(definition, '{sections,0,heading,en}', '"refused"')$$),
      -- Sorted, because the guard's own language-shape rule is evaluated first and an
      -- unsorted list would be refused for the wrong reason. See LC9x for the case where
      -- that ordering of the two rules is itself the finding.
      ('languages', $$languages = ARRAY['en', 'ml', 'ta']::text[]$$),
      ('machine_assisted', $$machine_assisted = false$$),
      ('machine_assistance_notes',
       $$machine_assistance_notes = 'TEST ONLY — a different disclosure than the one filed.'$$),
      ('author_label',
       $$author_label = 'TEST ONLY — a different author than the one named'$$),
      ('source_reference', $$source_reference = 'TEST ONLY — a source nobody cited'$$),
      ('changelog', $$changelog = 'TEST ONLY — a history written after the fact'$$),
      ('release_number', $$release_number = 77$$),
      ('pack_id', $$pack_id = gen_random_uuid()$$)
    ) c(name, expr)
  LOOP
    v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET ' || v_item.expr
                            || ' WHERE id = ' || quote_literal(v_rel::text));
    PERFORM pg_temp.s4_ok('LC9 the content column ' || v_item.name || ' is frozen at '
      || (SELECT r.status FROM public.tradition_pack_releases r WHERE r.id = v_rel)
      || ', so a change means a new release_number (' || left(v_err, 100) || ')',
      v_err LIKE '23514%content is frozen%');
    PERFORM pg_temp.s4_eq('LC9b and the refused write to ' || v_item.name
      || ' changed nothing, not even a byte of the wording that was reviewed',
      pg_temp.s4_hash_of(v_rel), v_all);
  END LOOP;

  -- The contract rule is evaluated before the freeze rule, so a release at a frozen status
  -- that tries to claim a definition contract this build does not understand is refused by
  -- name rather than by immutability. Either way the row cannot move, and the difference is
  -- worth printing rather than hiding behind one generic expectation.
  --
  -- Which version is "not understood" is a fact about the build, and Stage 5 moved it: the
  -- Stage 4 head implements contract 1, the Stage 5 head implements 1 and 2, so the unknown
  -- version is 2 there and 3 here. Both heads are qualified, so both literals are written
  -- down rather than one of them being dropped.
  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases '
                          || 'SET definition_schema_version = '
                          || CASE WHEN pg_temp.s4_at_least('stage5') THEN '3' ELSE '2' END
                          || ' WHERE id = ' || quote_literal(v_rel::text));
  PERFORM pg_temp.s4_ok('LC9x a frozen release cannot adopt a contract version this build does not understand (' || left(v_err, 100) || ')',
    v_err LIKE '23514%is not understood by this build%');
  PERFORM pg_temp.s4_eq('LC9y and the refused write left the release on the contract it was reviewed under',
    pg_temp.s4_hash_of(v_rel), v_all);

  -- A no-op write of a frozen column is not a content change, and that is the correct
  -- reading of `IS DISTINCT FROM`: refusing it would refuse the lifecycle itself, because
  -- `set_updated_at` rewrites the row on every legal step.
  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET '
                          || 'definition_schema_version = definition_schema_version, '
                          || 'pack_id = pack_id WHERE id = ' || quote_literal(v_rel::text));
  PERFORM pg_temp.s4_eq('LC9c a write that leaves a frozen column exactly where it was is not a content change, and the guard says so (' || v_err || ')',
    v_err, 'no-error');
  PERFORM pg_temp.s4_eq('LC9d and the row is still the same content',
    pg_temp.s4_hash_of(v_rel), v_all);

  -- The record half of the same unit. Ruling A2: the metadata describes the wording beside
  -- it, so correcting the record is also a new release rather than an edit.
  FOR v_item IN
    SELECT * FROM (VALUES
      ('review_label', $$review_label = 'TEST ONLY — a label nobody was given'$$),
      ('review_basis', $$review_basis = 'TEST ONLY — a basis that was not the one the review had.'$$),
      ('review_scope', $$review_scope = 'TEST ONLY — a wider scope than anybody read.'$$),
      ('reviewed_languages', $$reviewed_languages = ARRAY['en']::text[]$$),
      ('reviewed_at', $$reviewed_at = reviewed_at - interval '5 years'$$),
      ('approved_at', $$approved_at = now()$$)
    ) c(name, expr)
  LOOP
    v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET ' || v_item.expr
                            || ' WHERE id = ' || quote_literal(v_rel::text));
    PERFORM pg_temp.s4_ok('LC10 the review column ' || v_item.name || ' is part of the frozen unit at '
      || (SELECT r.status FROM public.tradition_pack_releases r WHERE r.id = v_rel)
      || ', so it is corrected by a new release, never rewritten (' || left(v_err, 100) || ')',
      v_err LIKE '23514%review record is part of the frozen unit%');
    PERFORM pg_temp.s4_eq('LC10b and the refused write left the record describing the same reading as before',
      pg_temp.s4_hash_of(v_rel), v_all);
  END LOOP;

  -- `reviewed_by` is the column a back-dated approval would use, and it is the one the
  -- lifecycle never writes, so it is measured apart from the loop above.
  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET reviewed_by = '
    || quote_literal(v_host::text) || '::uuid WHERE id = ' || quote_literal(v_rel::text));
  PERFORM pg_temp.s4_ok('LC10c naming a reviewer after the fact is refused too, so "who read this" cannot be filled in later (' || left(v_err, 100) || ')',
    v_err LIKE '23514%review record is part of the frozen unit%');
  PERFORM pg_temp.s4_eq('LC10d and the row still records no reviewer, exactly as it did at the step',
    pg_temp.s4_hash_of(v_rel), v_all);

  v_err := pg_temp.s4_err('DELETE FROM public.tradition_pack_releases WHERE id = '
                          || quote_literal(v_rel::text));
  PERFORM pg_temp.s4_ok('LC11 a reviewed release may not be deleted: it is retired by status, never removed (' || left(v_err, 100) || ')',
    v_err LIKE '23001%may not be deleted%');
  PERFORM pg_temp.s4_eq('LC11b and the refused deletion left the row exactly where it was',
    pg_temp.s4_hash_of(v_rel), v_all);

  -------------------------------------------------------------------- reviewed → approved
  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET status = ''approved'', '
                          || 'reviewed_at = now() - interval ''1 day'' WHERE id = '
                          || quote_literal(v_rel::text));
  PERFORM pg_temp.s4_ok('LC12 approval cannot restate the review it was based on, so the publishable row is the row that was read (' || left(v_err, 100) || ')',
    v_err LIKE '23514%cannot change the review record%');
  PERFORM pg_temp.s4_eq('LC12b and the refused approval left the release reviewed',
    (SELECT r.status FROM public.tradition_pack_releases r WHERE r.id = v_rel), 'reviewed');

  UPDATE public.tradition_pack_releases SET status = 'approved' WHERE id = v_rel;
  PERFORM pg_temp.s4_eq('LC13 the honest approval step is taken, and the trigger wrote the approval timestamp the caller never supplied',
    (SELECT r.status || '|' || (r.approved_at IS NOT NULL)::text || '|'
            || (r.deprecated_at IS NULL)::text
       FROM public.tradition_pack_releases r WHERE r.id = v_rel), 'approved|true|true');
  v_all := pg_temp.s4_hash_of(v_rel);
  PERFORM pg_temp.s4_eq('LC13b and the content the approval made publishable is the content that was reviewed',
    pg_temp.s4_chash(v_rel), v_ch);
  PERFORM pg_temp.s4_eq('LC13c and the review record is unchanged except for the approval timestamp the lifecycle owns',
    (SELECT jsonb_build_object('label', r.review_label, 'basis', r.review_basis,
                               'scope', r.review_scope, 'langs', r.reviewed_languages,
                               'at', r.reviewed_at, 'by', r.reviewed_by)
       FROM public.tradition_pack_releases r WHERE r.id = v_rel),
    (v_review - 'at') || jsonb_build_object('at',
      (SELECT r.reviewed_at FROM public.tradition_pack_releases r WHERE r.id = v_rel)));

  FOR v_item IN SELECT f AS from_status, t AS to_status
                  FROM (VALUES ('approved', 'draft'), ('approved', 'reviewed')) e(f, t)
  LOOP
    v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET status = '
      || quote_literal(v_item.to_status) || ' WHERE id = ' || quote_literal(v_rel::text));
    PERFORM pg_temp.s4_ok('LC14 a release cannot move from ' || v_item.from_status || ' to '
      || v_item.to_status || ' (' || left(v_err, 100) || ')',
      v_err LIKE '23514%cannot move from%');
    PERFORM pg_temp.s4_eq('LC14b and the refused edge left the release in ' || v_item.from_status
      || ' with its content intact',
      pg_temp.s4_hash_of(v_rel), v_all);
  END LOOP;

  -- The second half of ruling A2's timestamp warning: the touch trigger rewrites
  -- `updated_at` on *every* UPDATE, so the guard must not read a no-op as an edit even when
  -- no lifecycle step is intended.
  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET status = status '
                          || 'WHERE id = ' || quote_literal(v_rel::text));
  PERFORM pg_temp.s4_eq('LC15 writing the same status back is not a transition, and the guard does not refuse it as one (' || v_err || ')',
    v_err, 'no-error');
  PERFORM pg_temp.s4_eq('LC15b and the only thing that moved is the bookkeeping timestamp',
    pg_temp.s4_hash_of(v_rel), v_all);

  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET status = ''approved'', '
                          || 'definition = jsonb_set(definition, ''{sections,0,heading,en}'', '
                          || '''"refused"'') WHERE id = ' || quote_literal(v_rel::text));
  PERFORM pg_temp.s4_ok('LC16 a content edit beside a legal-looking status write is still a content edit (' || left(v_err, 100) || ')',
    v_err LIKE '23514%content is frozen%');
  PERFORM pg_temp.s4_eq('LC16b and the smuggled edit landed nothing',
    pg_temp.s4_hash_of(v_rel), v_all);

  ------------------------------------------------------------------ approved → deprecated
  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET status = ''deprecated'', '
                          || 'review_scope = ''TEST ONLY — restated on the way out.'' '
                          || 'WHERE id = ' || quote_literal(v_rel::text));
  PERFORM pg_temp.s4_ok('LC17 retiring a release cannot restate the review it was approved under (' || left(v_err, 100) || ')',
    v_err LIKE '23514%cannot change the review it was approved under%');
  PERFORM pg_temp.s4_eq('LC17b and the refused retirement left the release approved, with the approval record it had',
    ARRAY[(SELECT r.status FROM public.tradition_pack_releases r WHERE r.id = v_rel),
          pg_temp.s4_hash_of(v_rel)],
    ARRAY['approved', v_all]);

  UPDATE public.tradition_pack_releases SET status = 'deprecated' WHERE id = v_rel;
  PERFORM pg_temp.s4_eq('LC18 the honest retirement step is taken, with the retirement timestamp written by the lifecycle',
    (SELECT r.status || '|' || (r.deprecated_at IS NOT NULL)::text
       FROM public.tradition_pack_releases r WHERE r.id = v_rel), 'deprecated|true');

  FOR v_item IN SELECT t AS to_status FROM (VALUES ('draft'), ('reviewed'), ('approved')) s(t)
  LOOP
    v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET status = '
      || quote_literal(v_item.to_status) || ' WHERE id = ' || quote_literal(v_rel::text));
    PERFORM pg_temp.s4_ok('LC19 deprecated is terminal: there is no step from it to '
      || v_item.to_status || ' (' || left(v_err, 100) || ')',
      v_err LIKE '23514%cannot move from%');
  END LOOP;
  v_all := pg_temp.s4_hash_of(v_rel);
  PERFORM pg_temp.s4_eq('LC19b and none of the three refused returns moved the release or its record',
    ARRAY[(SELECT r.status FROM public.tradition_pack_releases r WHERE r.id = v_rel),
          pg_temp.s4_hash_of(v_rel)],
    ARRAY['deprecated', v_all]);

  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET '
                          || 'definition = jsonb_set(definition, ''{sections,0,heading,en}'', '
                          || '''"refused"'') WHERE id = ' || quote_literal(v_rel::text));
  PERFORM pg_temp.s4_ok('LC20 and its wording is frozen at the far end too, so text a guest once read can never be edited into something else (' || left(v_err, 100) || ')',
    v_err LIKE '23514%content is frozen%');
  PERFORM pg_temp.s4_eq('LC20b and the refused edit changed nothing',
    pg_temp.s4_hash_of(v_rel), v_all);

  v_err := pg_temp.s4_err('DELETE FROM public.tradition_pack_releases WHERE id = '
                          || quote_literal(v_rel::text));
  PERFORM pg_temp.s4_ok('LC21 a retired release may still not be deleted, because a guest link can outlive the pack it came from (' || left(v_err, 100) || ')',
    v_err LIKE '23001%may not be deleted%');

  -- The claim the whole group exists for, stated once across the walk: the bytes that were
  -- approved are the bytes that were retired, and the lifecycle timestamps are the only
  -- things the walk ever wrote.
  PERFORM pg_temp.s4_eq('LC22 the content hash taken at the last legal draft edit is the hash this release still carries after review, approval and retirement',
    pg_temp.s4_chash(v_rel), v_ch);
  PERFORM pg_temp.s4_eq('LC22b and the release is still exactly one row, with its own number, in the catalogue',
    (SELECT r.release_number::text || '|' || r.status
       FROM public.tradition_pack_releases r WHERE r.id = v_rel), '1|deprecated');
  PERFORM pg_temp.s4_eq('LC22c the probe pack keeps its own identity through all of it, which is what a scope statement is for',
    (SELECT count(*) FROM public.tradition_packs WHERE id = v_pack), 1::bigint);
END $LC$;

-- ===========================================================================
-- D. THE DEFINITION CONTRACT, ONE RULE PER CASE
-- ===========================================================================
-- §2 of the continuation names the rules a release definition has to satisfy, and the
-- directive's closing instruction is the reason this group is a table of cases rather than
-- one big negative test: "do not make JSON CHECKs so opaque that nobody can identify which
-- rule failed." Every row below therefore states the rule it expects, prints the message the
-- database actually gave, and the loop refuses a case whose refusal came from a *different*
-- rule than the one named. A guard that rejects everything is not a contract; a contract
-- nobody can diagnose is not a guard.
--
-- Each case changes exactly one thing about a definition that is otherwise valid, through
-- `pg_temp.s4_def_err`, so no refusal can be blamed on an unrelated missing column. The
-- accepted controls at the end are the other half: they prove the same instrument accepts
-- the shapes the product needs, and each is then deleted — which is only possible because a
-- draft is the one status the undeletable rule does not cover (measured in LC5).
--
-- Two facts about the mechanism shaped this list, both measured rather than assumed. The
-- guard trigger fires BEFORE the table CHECKs, so where a rule exists in both places the
-- guard's sentence is the one a caller hears, and the cases below name the mechanism that
-- actually spoke instead of the one that was intended. And every section must declare
-- `required` as a boolean, so each hand-built section in the case list carries one —
-- otherwise four cases would be proved by the wrong rule.
CREATE TEMP TABLE s4_dc (
  seq serial, name text, expects text, definition jsonb,
  languages text[], schema_version integer, machine boolean, notes text
) ON COMMIT DROP;

DO $D$
DECLARE
  v_base jsonb;
  v_en   jsonb;
  v_err  text;
  v_case record;
  v_n    integer := 0;
  v_row  uuid;
  v_ids  uuid[] := ARRAY[]::uuid[];
  v_pack uuid;
BEGIN
  PERFORM pg_temp.s4_is_superuser('D0 the contract group runs as the maintenance role, the only role that authors a release');
  SELECT pack_unshipped INTO v_pack FROM sf;

  -- The reference document: one valid section, covering both languages the probe release
  -- declares, with a reviewed line and a host field.
  v_base := $basedef${
    "sections": [
      {"section_key": "opening", "position": 1, "kind": "text", "required": false,
       "host_field": "welcome", "allow_english_fallback": true,
       "heading": {"en": "Opening", "ta": "தொடக்கம்"},
       "pack_text": {"en": "With the goodwill of both families.", "ta": "வணக்கம்"}}
    ]
  }$basedef$::jsonb;

  -- The same document with one language, for the cases whose whole point is the language
  -- list: a definition that mentions only `en` lets a rule about an unsupported code be
  -- the only thing left to refuse it.
  v_en := jsonb_set(
            jsonb_set(
              jsonb_set(v_base, '{sections,0,allow_english_fallback}', 'false'),
              '{sections,0,heading}', jsonb_build_object('en', 'Opening')),
            '{sections,0,pack_text}',
            jsonb_build_object('en', 'With the goodwill of both families.'));

  -- ------------------------------------------------------------------ the refusals
  INSERT INTO s4_dc (name, expects, definition, languages, schema_version)
  VALUES
    ('the definition is not an object at all',
     '23514%must be a JSON object%', $$[]$$::jsonb, ARRAY['en', 'ta'], 1),
    ('a top-level key this build does not understand',
     '23514%carries keys this build does not understand%',
     v_base || '{"theme": "temple-gold"}'::jsonb, ARRAY['en', 'ta'], 1),
    ('a definition whose sections array is empty',
     '23514%at least one section%', $$ {"sections": []} $$::jsonb,
     ARRAY['en', 'ta'], 1),
    ('a section that is a word rather than an object',
     '23514%every section must be a JSON object%',
     jsonb_set(v_base, '{sections,0}', '"opening"'::jsonb), ARRAY['en', 'ta'], 1),
    ('a section carrying a key this build ignores',
     '23514%carries unknown keys%',
     jsonb_set(v_base, '{sections,0,alignment}', '"center"'::jsonb),
     ARRAY['en', 'ta'], 1),
    ('a section slot outside the pinned vocabulary',
     '23514%is not one of the section slots this build renders%',
     jsonb_set(v_base, '{sections,0,section_key}', '"prasadham"'),
     ARRAY['en', 'ta'], 1),
    ('the same section key twice in one release',
     '23514%appears twice in one release%',
     jsonb_set(v_base, '{sections}', (v_base -> 'sections') || (v_base -> 'sections')),
     ARRAY['en', 'ta'], 1),
    ('a section with no position',
     '23514%has no numeric position%',
     jsonb_set(v_base, '{sections,0}', (v_base -> 'sections' -> 0) - 'position'),
     ARRAY['en', 'ta'], 1),
    ('a position of zero, which is not a first place',
     '23514%outside 1..%',
     jsonb_set(v_base, '{sections,0,position}', '0'), ARRAY['en', 'ta'], 1),
    ('a position beyond the number of sections',
     '23514%outside 1..%',
     jsonb_set(v_base, '{sections,0,position}', '9'), ARRAY['en', 'ta'], 1),
    ('a position that is not a number',
     '23514%has no numeric position%',
     jsonb_set(v_base, '{sections,0,position}', '"first"'::jsonb),
     ARRAY['en', 'ta'], 1),
    ('two sections claiming the same position',
     '23514%is claimed by two sections%',
     jsonb_build_object('sections', v_base -> 'sections' ||
       jsonb_build_array(jsonb_build_object('section_key', 'closing', 'position', 1,
         'kind', 'text', 'required', false,
         'heading', jsonb_build_object('en', 'Closing', 'ta', 'முடிப்பு')))),
     ARRAY['en', 'ta'], 1),
    ('a kind no renderer knows',
     '23514%claims kind%that no renderer knows%',
     jsonb_set(v_base, '{sections,0,kind}', '"photo_frame"'), ARRAY['en', 'ta'], 1),
    ('two people lists in one invitation',
     '23514%at most one people list%',
     jsonb_build_object('sections', v_base -> 'sections' || jsonb_build_array(
       jsonb_build_object('section_key', 'family', 'position', 2, 'kind', 'people_list',
         'required', false, 'heading', jsonb_build_object('en', 'Families')),
       jsonb_build_object('section_key', 'couple', 'position', 3, 'kind', 'people_list',
         'required', false, 'heading', jsonb_build_object('en', 'The couple')))),
     ARRAY['en', 'ta'], 1),
    ('two event lists in one invitation',
     '23514%at most one event list%',
     jsonb_build_object('sections', v_base -> 'sections' || jsonb_build_array(
       jsonb_build_object('section_key', 'ceremonies', 'position', 2, 'kind', 'event_list',
         'required', false, 'heading', jsonb_build_object('en', 'Ceremonies')),
       jsonb_build_object('section_key', 'venue', 'position', 3, 'kind', 'event_list',
         'required', false, 'heading', jsonb_build_object('en', 'Where')))),
     ARRAY['en', 'ta'], 1),
    ('a people list that tries to read a host field',
     '23514%may not read a host field%',
     jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
       'section_key', 'family', 'position', 1, 'kind', 'people_list', 'required', false,
       'host_field', 'welcome', 'heading', jsonb_build_object('en', 'Families')))),
     ARRAY['en', 'ta'], 1),
    ('a host field that does not exist on the draft',
     '23514%reads unknown host field%',
     jsonb_set(v_base, '{sections,0,host_field}', '"gift_registry"'),
     ARRAY['en', 'ta'], 1),
    ('two sections reading the same host field',
     '23514%two sections read host field%',
     jsonb_build_object('sections', v_base -> 'sections' ||
       jsonb_build_array(jsonb_build_object('section_key', 'closing', 'position', 2,
         'kind', 'text', 'required', false, 'host_field', 'welcome',
         'heading', jsonb_build_object('en', 'Closing')))),
     ARRAY['en', 'ta'], 1),
    ('`required` written as a word instead of a boolean',
     '23514%must declare required as a boolean%',
     jsonb_set(v_base, '{sections,0,required}', '"yes"'::jsonb),
     ARRAY['en', 'ta'], 1),
    ('`allow_english_fallback` written as a word',
     '23514%must declare allow_english_fallback as a boolean%',
     jsonb_set(v_base, '{sections,0,allow_english_fallback}', '"maybe"'::jsonb),
     ARRAY['en', 'ta'], 1),
    ('an English fallback offered by a release that has no English',
     '23514%does not cover en%', v_base, ARRAY['ta'], 1),
    ('a heading that is a sentence rather than a language map',
     '23514%heading must be an object of language keys%',
     jsonb_set(v_base, '{sections,0,heading}', '"Our families"'::jsonb),
     ARRAY['en', 'ta'], 1),
    ('a heading in a language this release does not cover',
     '23514%heading in a language this release does not cover%',
     jsonb_set(v_base, '{sections,0,heading}',
               jsonb_build_object('en', 'Opening', 'ml', 'തുടക്കം')),
     ARRAY['en', 'ta'], 1),
    ('a heading that is only whitespace',
     '23514%heading that is empty, too long, or not a string%',
     jsonb_set(v_base, '{sections,0,heading}', jsonb_build_object('en', '   ')),
     ARRAY['en', 'ta'], 1),
    ('a heading that is not a string',
     '23514%heading that is empty, too long, or not a string%',
     jsonb_set(v_base, '{sections,0,heading}', jsonb_build_object('en', 3)),
     ARRAY['en', 'ta'], 1),
    ('reviewed wording on a list section, which renders no prose',
     '23514%cannot carry reviewed wording%',
     jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
       'section_key', 'family', 'position', 1, 'kind', 'people_list', 'required', false,
       'pack_text', jsonb_build_object('en', 'Our families'),
       'heading', jsonb_build_object('en', 'Families')))),
     ARRAY['en', 'ta'], 1),
    ('`pack_text` written as a sentence rather than a language map',
     '23514%pack_text must be an object of language keys%',
     jsonb_set(v_base, '{sections,0,pack_text}', '"With goodwill."'::jsonb),
     ARRAY['en', 'ta'], 1),
    ('wording in a language this release does not cover',
     '23514%wording in a language this release does not cover%',
     jsonb_set(v_base, '{sections,0,pack_text}',
               jsonb_build_object('en', 'With goodwill.', 'te', 'శుభం')),
     ARRAY['en', 'ta'], 1),
    ('an empty reviewed line',
     '23514%wording that is empty, over 4000 characters, or not a string%',
     jsonb_set(v_base, '{sections,0,pack_text}', jsonb_build_object('en', '')),
     ARRAY['en', 'ta'], 1),
    ('a reviewed line longer than a section may hold',
     '23514%wording that is empty, over 4000 characters, or not a string%',
     jsonb_set(v_base, '{sections,0,pack_text}',
               jsonb_build_object('en', repeat('a', 4001))),
     ARRAY['en', 'ta'], 1),
    ('a text section that says nothing at all',
     '23514%says nothing%',
     jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
       'section_key', 'blessing', 'position', 1, 'kind', 'text', 'required', false))),
     ARRAY['en', 'ta'], 1),
    ('a definition contract this build does not implement',
     '23514%is not understood by this build%', v_base, ARRAY['en', 'ta'], 9),
    ('`event_vocabulary` that is not a list',
     '23514%event_vocabulary must be an array%',
     v_base || jsonb_build_object('event_vocabulary', 'muhurtham'),
     ARRAY['en', 'ta'], 1),
    ('an event key that is not a slug',
     '23514%slug event_key%',
     v_base || jsonb_build_object('event_vocabulary', jsonb_build_array(
       jsonb_build_object('event_key', 'Muhurtham Day',
         'labels', jsonb_build_object('en', 'Muhurtham', 'ta', 'முஹூர்தம்')))),
     ARRAY['en', 'ta'], 1),
    ('an event label in a language this release does not cover',
     '23514%label strings in languages this release covers%',
     v_base || jsonb_build_object('event_vocabulary', jsonb_build_array(
       jsonb_build_object('event_key', 'muhurtham',
         'labels', jsonb_build_object('en', 'Muhurtham', 'ml', 'മുഹൂർത്തം')))),
     ARRAY['en', 'ta'], 1),
    ('an event vocabulary entry with a key nobody specified',
     '23514%event_vocabulary entry carries an unknown key%',
     v_base || jsonb_build_object('event_vocabulary', jsonb_build_array(
       jsonb_build_object('event_key', 'muhurtham', 'auspicious', true,
         'labels', jsonb_build_object('en', 'Muhurtham')))),
     ARRAY['en', 'ta'], 1),
    ('`design_guidance` that is not an object',
     '23514%design_guidance must be an object%',
     v_base || jsonb_build_object('design_guidance', 'gold border'),
     ARRAY['en', 'ta'], 1),
    ('design guidance carrying a key this build would have to invent meaning for',
     '23514%design_guidance carries a key this build does not understand%',
     v_base || jsonb_build_object('design_guidance',
       jsonb_build_object('deity', 'Meenakshi')),
     ARRAY['en', 'ta'], 1),
    ('a lead size outside the range a renderer can lay out',
     '23514%design_guidance is out of range%',
     v_base || jsonb_build_object('design_guidance', jsonb_build_object('lead_size', 400)),
     ARRAY['en', 'ta'], 1),
    ('a motif reference that is a whole paragraph',
     '23514%design_guidance is out of range%',
     v_base || jsonb_build_object('design_guidance',
       jsonb_build_object('motif_reference', repeat('koli', 60))),
     ARRAY['en', 'ta'], 1),
    -- A machine-assisted release with no disclosure beside it is the hollow tick box §B of
    -- the design refuses. It is a table CHECK rather than a guard rule, and the guard has
    -- nothing to complain about in the row, so the constraint names itself.
    ('machine assistance declared with nothing said about it',
     '23514%disclosure_required%', v_base, ARRAY['en', 'ta'], 1);

  -- Every case gets the same fully valid provenance columns, so the rule named in its
  -- `expects` is the only thing left in the row that can refuse it. The one exception is
  -- the case whose subject is the disclosure itself, which is valid in every other way.
  UPDATE s4_dc SET machine = true,
         notes = 'TEST ONLY — drafted by a model and checked for shape and language '
                 'coverage. No human reader of Tamil reviewed any string in this row.';
  UPDATE s4_dc SET notes = NULL
   WHERE name = 'machine assistance declared with nothing said about it';

  -- `seq` rather than physical row order: the two provenance UPDATEs below rewrite rows,
  -- and a battery whose case numbers move between runs cannot be compared against a
  -- reported count. Measured before the fix — the disclosure case printed as D31.
  FOR v_case IN SELECT * FROM s4_dc ORDER BY seq LOOP
    v_err := pg_temp.s4_def_err(v_case.definition, v_case.languages, v_case.schema_version,
                                v_case.machine, v_case.notes);
    v_n := v_n + 1;
    PERFORM pg_temp.s4_ok('D' || v_n || ' the contract refuses ' || v_case.name || ' ('
      || left(coalesce(v_err, '<null>'), 120) || ')', v_err LIKE v_case.expects);
  END LOOP;
  -- Scoped to this battery's own pack, and that is a measurement, not a convenience: on the
  -- real chain `stage2/20_attacks.sql` runs first and *keeps* a release at number 900 on its
  -- own `unshipped_pack` for its lifecycle cases. Measured on the clean chain — an unscoped
  -- count of 900 reported 1 there and 0 on the scratch chain, which is two different answers
  -- to a question about this file's own probes. The zero below is about the rows this loop
  -- tried to author, and `Dc4` right underneath it is the control that says a row at one of
  -- these numbers is perfectly creatable in this very pack.
  PERFORM pg_temp.s4_eq('D' || (v_n + 1) || ' and not one of the ' || v_n
    || ' refused definitions left a row in the pack they were authored against',
    (SELECT count(*) FROM public.tradition_pack_releases
      WHERE pack_id = v_pack AND release_number = 900),
    0::bigint);

  -- ------------------------------------------------------------------ the accepted controls
  -- Each shape the product genuinely needs, accepted, stored, read back and then deleted.
  -- Without these the loop above would be satisfied by a guard that refuses everything.
  v_row := gen_random_uuid();
  INSERT INTO public.tradition_pack_releases
    (id, pack_id, release_number, definition_schema_version, languages, definition,
     author_label, machine_assisted, machine_assistance_notes, source_reference)
  VALUES (v_row, v_pack, 901, 1, ARRAY['en', 'ta'], v_base,
          'TEST ONLY — accepted control', true,
          'TEST ONLY — drafted by a model and checked for shape and language coverage. No '
          'human reader of Tamil reviewed any string in this row.',
          'TEST ONLY — no external source');
  PERFORM pg_temp.s4_eq('Dc1 the reference definition is accepted, and stored as the draft it was created as',
    (SELECT r.status || '|' || (r.definition = v_base)::text
       FROM public.tradition_pack_releases r WHERE r.id = v_row), 'draft|true');
  v_ids := v_ids || v_row;

  -- A list section with nothing but a heading: the people and events come from the host's
  -- own rows, so the release offers structure and no prose.
  v_row := gen_random_uuid();
  INSERT INTO public.tradition_pack_releases
    (id, pack_id, release_number, definition_schema_version, languages, definition,
     author_label, machine_assisted, machine_assistance_notes, source_reference)
  VALUES (v_row, v_pack, 902, 1, ARRAY['en', 'ta'], jsonb_build_object(
      'sections', jsonb_build_array(
        jsonb_build_object('section_key', 'family', 'position', 1, 'kind', 'people_list',
          'required', false,
          'heading', jsonb_build_object('en', 'Our families', 'ta', 'குடும்பம்')),
        jsonb_build_object('section_key', 'ceremonies', 'position', 2, 'kind', 'event_list',
          'required', false,
          'heading', jsonb_build_object('en', 'The ceremonies', 'ta', 'நிகழ்ச்சிகள்'))),
      'event_vocabulary', jsonb_build_array(jsonb_build_object(
        'event_key', 'muhurtham',
        'labels', jsonb_build_object('en', 'Muhurtham', 'ta', 'முஹூர்தம்'))),
      'design_guidance', jsonb_build_object('lead_size', 18, 'motif_reference',
        'a kolam border, drawn thin')),
          'TEST ONLY — accepted control', true,
          'TEST ONLY — drafted by a model and checked for shape and language coverage. No '
          'human reader of Tamil reviewed any string in this row.',
          'TEST ONLY — no external source');
  PERFORM pg_temp.s4_eq('Dc2 the full shape the render model needs — two lists, an event vocabulary and design guidance — is accepted',
    (SELECT count(*) FROM public.tradition_pack_releases r
      WHERE r.id = v_row AND r.status = 'draft'
        AND jsonb_typeof(r.definition -> 'event_vocabulary') = 'array'
        AND jsonb_typeof(r.definition -> 'design_guidance') = 'object'), 1::bigint);
  v_ids := v_ids || v_row;

  -- A Tamil-only release with no fallback offered anywhere: legal, and the resolution rules
  -- in group B are what decide what a guest reads.
  v_row := gen_random_uuid();
  INSERT INTO public.tradition_pack_releases
    (id, pack_id, release_number, definition_schema_version, languages, definition,
     author_label, machine_assisted, source_reference)
  VALUES (v_row, v_pack, 903, 1, ARRAY['ta'],
          jsonb_set(jsonb_set(jsonb_set(v_base,
              '{sections,0,allow_english_fallback}', 'false'),
              '{sections,0,heading}', jsonb_build_object('ta', 'தொடக்கம்')),
              '{sections,0,pack_text}', jsonb_build_object('ta', 'வணக்கம்')),
          'TEST ONLY — accepted control', false, 'TEST ONLY — no external source');
  PERFORM pg_temp.s4_eq('Dc3 a single-language release that offers no fallback is accepted, and a release with no machine assistance may say so by leaving the disclosure absent',
    (SELECT r.status || '|' || cardinality(r.languages)::text || '|'
            || (r.machine_assistance_notes IS NULL)::text
       FROM public.tradition_pack_releases r WHERE r.id = v_row), 'draft|1|true');
  v_ids := v_ids || v_row;

  PERFORM pg_temp.s4_eq('Dc4 the three accepted controls are the only rows the case list added at release numbers 901 to 903',
    (SELECT count(*) FROM public.tradition_pack_releases
      WHERE pack_id = v_pack AND release_number BETWEEN 901 AND 903), 3::bigint);

  DELETE FROM public.tradition_pack_releases WHERE id = ANY (v_ids);
  PERFORM pg_temp.s4_eq('Dc5 and every accepted control is deleted again, because a draft nobody has read is the one row the undeletable rule does not cover',
    (SELECT count(*) FROM public.tradition_pack_releases
      WHERE pack_id = v_pack AND release_number >= 900), 0::bigint);
  PERFORM pg_temp.s4_eq('Dc6 and the deletion left no orphan: the unshipped pack still holds exactly the two releases the lifecycle group knows',
    (SELECT count(*) FROM public.tradition_pack_releases WHERE pack_id = v_pack), 2::bigint);

  -- --------------------------------------------------------------- the column-level rules
  -- Rules about the row rather than the JSON. A definition rule and a column rule are the
  -- same kind of contract, and the directive asks for both to be diagnosable. Each case
  -- keeps every other column valid, so the named rule is the only thing left to refuse it.
  v_err := pg_temp.s4_err('INSERT INTO public.tradition_pack_releases '
    || '(pack_id, release_number, definition_schema_version, languages, definition, '
    || 'author_label, machine_assisted) VALUES (' || quote_literal(v_pack::text)
    || '::uuid, 910, 1, ARRAY[''ta'',''en''], ' || quote_literal(v_base::text)
    || '::jsonb, ''TEST ONLY — column probe'', false)');
  PERFORM pg_temp.s4_ok('Dx1 an unsorted language list is refused by name, because two releases covering the same languages must have the same value (' || left(v_err, 120) || ')',
    v_err LIKE '23514%languages must be sorted%');

  v_err := pg_temp.s4_err('INSERT INTO public.tradition_pack_releases '
    || '(pack_id, release_number, definition_schema_version, languages, definition, '
    || 'author_label, machine_assisted) VALUES (' || quote_literal(v_pack::text)
    || '::uuid, 910, 1, ARRAY[''en'',''en''], ' || quote_literal(v_base::text)
    || '::jsonb, ''TEST ONLY — column probe'', false)');
  PERFORM pg_temp.s4_ok('Dx2 a duplicate in the language list is refused by the same rule, which covers both halves of its name (' || left(v_err, 120) || ')',
    v_err LIKE '23514%sorted and free of duplicates%');

  v_err := pg_temp.s4_err('INSERT INTO public.tradition_pack_releases '
    || '(pack_id, release_number, definition_schema_version, languages, definition, '
    || 'author_label, machine_assisted) VALUES (' || quote_literal(v_pack::text)
    || '::uuid, 910, 1, ARRAY[''en'',''hi''], ' || quote_literal(v_en::text)
    || '::jsonb, ''TEST ONLY — column probe'', false)');
  PERFORM pg_temp.s4_ok('Dx3 a language outside the five the schema lists is refused by the table CHECK, not by the guard, because the definition itself is honest about which languages it writes (' || left(v_err, 120) || ')',
    v_err LIKE '23514%tradition_pack_releases_languages_check%');

  v_err := pg_temp.s4_err('INSERT INTO public.tradition_pack_releases '
    || '(pack_id, release_number, definition_schema_version, languages, definition, '
    || 'author_label, machine_assisted) VALUES (' || quote_literal(v_pack::text)
    || '::uuid, 1, 1, ARRAY[''en'',''ta''], ' || quote_literal(v_base::text)
    || '::jsonb, ''TEST ONLY — column probe'', false)');
  PERFORM pg_temp.s4_ok('Dx4 a second release_number one inside a pack is refused: identity within the concept is what a guest citation names (' || left(v_err, 120) || ')',
    v_err LIKE '23505%pack_id_release_number_key%');

  v_err := pg_temp.s4_err('INSERT INTO public.tradition_pack_releases '
    || '(pack_id, release_number, definition_schema_version, languages, definition, '
    || 'author_label, machine_assisted) VALUES (' || quote_literal(v_pack::text)
    || '::uuid, 0, 1, ARRAY[''en'',''ta''], ' || quote_literal(v_base::text)
    || '::jsonb, ''TEST ONLY — column probe'', false)');
  PERFORM pg_temp.s4_ok('Dx5 a release number of zero is refused, so no citation can point at a place that does not exist (' || left(v_err, 120) || ')',
    v_err LIKE '23514%release_number_check%');

  -- `status` has two guards, and the one that speaks is the earlier one: the trigger fires
  -- before the CHECKs. Asserting the CHECK's name here would have been an assertion about a
  -- sentence nobody ever hears, so this case names the mechanism that actually refused it —
  -- and the pair below proves the backstop still exists for the day a trigger is dropped.
  v_err := pg_temp.s4_err('INSERT INTO public.tradition_pack_releases '
    || '(pack_id, release_number, definition_schema_version, languages, definition, '
    || 'author_label, machine_assisted, status) VALUES (' || quote_literal(v_pack::text)
    || '::uuid, 911, 1, ARRAY[''en'',''ta''], ' || quote_literal(v_base::text)
    || '::jsonb, ''TEST ONLY — column probe'', false, ''published'')');
  PERFORM pg_temp.s4_ok('Dx6 a status the lifecycle does not know cannot even be born: the born-as-draft rule refuses it, and says which word it objected to (' || left(v_err, 120) || ')',
    v_err LIKE '23514%begins life as draft%published%');
  PERFORM pg_temp.s4_has('Dx6b and the vocabulary CHECK is still there behind the guard, so dropping the trigger would not silently widen the status domain',
    (SELECT coalesce(array_agg(con.conname ORDER BY con.conname COLLATE "C"), '{}'::text[])
       FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'tradition_pack_releases' AND con.contype = 'c'),
    'tradition_pack_releases_status_check');

  -- A too-short review basis is only reachable through the legal step that demands a review
  -- record, which is exactly where it matters: the CHECK is the last line before a claim of
  -- having read something gets stored.
  v_row := gen_random_uuid();
  INSERT INTO public.tradition_pack_releases
    (id, pack_id, release_number, definition_schema_version, languages, definition,
     author_label, machine_assisted, source_reference)
  VALUES (v_row, v_pack, 912, 1, ARRAY['en', 'ta'], v_base,
          'TEST ONLY — column probe', false, 'TEST ONLY — no external source');
  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET status = ''reviewed'', '
    || 'reviewed_at = now(), review_label = ''TEST ONLY — REVIEWED FIXTURE'', '
    || 'review_basis = ''too short'', review_scope = ''TEST ONLY — structure only, nothing '
    || 'else was read.'', reviewed_languages = ARRAY[''en'',''ta''] WHERE id = '
    || quote_literal(v_row::text));
  PERFORM pg_temp.s4_ok('Dx7 a review basis shorter than a sentence cannot be filed, so "reviewed" always carries a real claim (' || left(v_err, 120) || ')',
    v_err LIKE '23514%review_basis_check%');
  PERFORM pg_temp.s4_eq('Dx7b and the refused step left the release a draft with no review record',
    (SELECT r.status || '|' || coalesce(r.reviewed_at::text, 'none')
       FROM public.tradition_pack_releases r WHERE r.id = v_row), 'draft|none');

  v_err := pg_temp.s4_err('UPDATE public.tradition_pack_releases SET status = ''reviewed'', '
    || 'reviewed_at = now(), review_label = ''TEST ONLY — REVIEWED FIXTURE'', '
    || 'review_basis = ''TEST ONLY — a synthetic record written by the battery, longer than '
    || 'the minimum.'', review_scope = ''TEST ONLY — structure only.'', '
    || 'reviewed_languages = ARRAY[''ml''] WHERE id = ' || quote_literal(v_row::text));
  PERFORM pg_temp.s4_ok('Dx8 a review cannot claim to have read a language the release does not contain (' || left(v_err, 120) || ')',
    v_err LIKE '23514%reviewed_languages_are_supported_ones%');

  DELETE FROM public.tradition_pack_releases WHERE id = v_row;
  PERFORM pg_temp.s4_eq('Dx9 and the probe draft is removed again, leaving the pack exactly as the lifecycle group left it',
    (SELECT count(*) FROM public.tradition_pack_releases WHERE pack_id = v_pack), 2::bigint);
END $D$;

-- ===========================================================================
-- S. ORDER IS DATA, AND NOTHING IN THE PATH ASKS WHERE THE WORDS CAME FROM
-- ===========================================================================
-- Directive §12's neutrality rule has two halves, and they need different instruments.
-- The first is behavioural: if section order, labels and wording are carried by the
-- release, then two releases holding the same five slots in different orders must produce
-- two documents in those two orders — and choosing a different invitation language must
-- change what each section *says*, never where it sits. The second is structural: the path
-- that produces the document must contain no test on a pack's identity, a religion, a
-- community, a surname, or a language-specific layout, because the moment one such branch
-- exists the release is decoration rather than source.
--
-- The structural half is a text scan, and a text scan over SQL source is trivially
-- satisfied by scanning the wrong thing, so three properties are measured here instead of
-- assumed. The scan strips comments before matching — these functions' own comments discuss
-- caste and religion at length, and matching prose would be a false positive while
-- ignoring it everywhere else would be a false negative. It matches whole words with `\m`
-- and `\M`, because a bare substring test on `sect` hits every `section` in the codebase.
-- It is run through the same instrument on a planted sentence, so a scanner that always
-- returns nothing cannot report a clean path. And the set of functions it covers is
-- computed as the call closure of the decision points rather than hand-written, so a new
-- helper added to the path is caught as a closure element this group did not name.
CREATE FUNCTION pg_temp.s4_code_only(src text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT lower(
           regexp_replace(
             regexp_replace(coalesce(src, ''), '/\*.*?\*/', ' ', 'gn'),
             '--[^\n]*', ' ', 'g')) $fn$;

-- What a neutral resolution path may not test for. Language *codes* are deliberately not on
-- this list: `p_requested <> 'en'` inside `pack_text_for` is the declared-fallback rule the
-- release itself switches on, which is data the author wrote.
--
-- What is banned is a branch on which pack, faith, community or family a subject belongs
-- to, and a layout chosen because the text happens to be Tamil. The rule is therefore split
-- in two, and the split is the honest form of the claim. A *concept* word — religion, caste,
-- a community name, a place of worship, an astrological term — may not appear in the code of
-- these functions at all, because its presence would mean the path is reasoning about it. A
-- pack's *identifier* is different: `build_invitation_snapshot` legitimately credits the
-- release a document came from, so naming `pack_key` is required behaviour, while comparing
-- it to a literal string is the branch §12 forbids. Measured, not assumed: the first draft of
-- this group flagged the credit field as if it were the branch.
CREATE FUNCTION pg_temp.s4_cultural_hits(src text) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT pg_temp.s4_sorted(coalesce(array_agg(DISTINCT u.k), '{}'::text[]))
    FROM (
      SELECT m[1] AS k
        FROM regexp_matches(
               pg_temp.s4_code_only(src),
               '\m(religion|religious|caste|jati|gotra|biradari|community|sect|sampradaya|'
               || 'hindu|muslim|christian|jain|sikh|buddhist|parivar|kula|gotriya|'
               || 'brahmin|bramin|kshatriya|vaishya|shudra|temple|church|mosque|gurudwara|'
               || 'deity|god|goddess|priest|pandit|purohit|archaka|auspicious|muhurat|'
               || 'horoscope|rahu|zodiac|astrolog|surname|pedigree|vedic|mantra|sanskrit|'
               || 'use_tamil_layout|tamil_layout|tamil_only|tamiz_only)\M', 'g') m
      UNION ALL
      -- `pack_key` on either side of a comparison to a quoted literal, in either order.
      SELECT 'pack_key compared to a literal' AS k
        WHERE pg_temp.s4_code_only(src)
              ~ '(pack_key[^a-z_0-9]*(=|<>|!~|~|<|>)[^a-z_0-9]*''[a-z0-9_-]+''|''[a-z0-9_-]+''[^a-z_0-9]*(=|<>)[^a-z_0-9]*pack_key)'
      UNION ALL
      -- A test against one specific pack, however it is spelled.
      SELECT 'tradition_pack_key compared to a literal' AS k
        WHERE pg_temp.s4_code_only(src)
              ~ '(tradition_pack_id[^a-z_0-9]*(=|<>)[^a-z_0-9]*''[a-f0-9-]{36}''|[a-f0-9-]{36}[^a-z_0-9]*(=|<>)[^a-z_0-9]*tradition_pack_id)'
    ) u $fn$;

DO $S$
DECLARE
  v_def1    jsonb;
  v_def2    jsonb;
  v_rows1   text[];
  v_seq1    text[];
  v_seq2    text[];
  v_path    text[];
  v_front   text[];
  v_more    text[];
  v_hits    text[];
  v_src     text;
  v_name    text;
BEGIN
  PERFORM pg_temp.s4_is_superuser('S0 the order group reads definitions as the maintenance role that authored them');
  SELECT definition INTO v_def1 FROM public.tradition_pack_releases WHERE id = (SELECT rel_1 FROM sf);
  SELECT definition INTO v_def2 FROM public.tradition_pack_releases WHERE id = (SELECT rel_2 FROM sf);

  -- ---------------------------------------------------- the two releases, three languages
  -- The fixture writes release 1's JSON array out of position order on purpose, so the
  -- sequence below is produced by the resolver's `ORDER BY position` and not by the order
  -- the bytes happen to sit in.
  PERFORM pg_temp.s4_eq('S1 release 1 resolves to sections in the order the release declares them, which is not the order the JSON array holds them in',
    pg_temp.s4_rows(jsonb_build_object('sections',
      jsonb_build_object('items', private.resolve_invitation_sections(v_def1, 'ta', '{}'::jsonb)))),
    ARRAY[
      '1|opening|text|reviewed_pack|ta|false|false|ta',
      '2|family|people_list|-|-|-|-|ta',
      '3|ceremonies|event_list|-|-|-|-|ta',
      '4|blessing|text|-|-|-|-|ta',
      '5|event_notes|text|reviewed_pack|en|true|false|ta'
    ]::text[]);

  -- The same release, read as English: every position, key and kind identical, only the
  -- language columns moved. A resolver that sorted by heading text, or that picked a
  -- different slot order for a script, would break this while still producing a
  -- plausible-looking document.
  PERFORM pg_temp.s4_eq('S2 asking the same release for English changes what the sections say and not where they are',
    (SELECT coalesce(array_agg((q ->> 'position') || '|' || (q ->> 'section_key') || '|' ||
                               (q ->> 'kind') ORDER BY (q ->> 'position')::integer), '{}'::text[])
       FROM jsonb_array_elements(private.resolve_invitation_sections(v_def1, 'en', '{}'::jsonb)) q),
    (SELECT coalesce(array_agg((q ->> 'position') || '|' || (q ->> 'section_key') || '|' ||
                               (q ->> 'kind') ORDER BY (q ->> 'position')::integer), '{}'::text[])
       FROM jsonb_array_elements(private.resolve_invitation_sections(v_def1, 'ta', '{}'::jsonb)) q));

  -- A language the release does not cover at all: the sections stay, in order, with only
  -- the two that declared a fallback carrying text. Group F refuses this document at the
  -- freeze boundary — refusing it is the freeze's job; the resolver's job is to report
  -- honestly rather than to drop the rows a host would then never see.
  PERFORM pg_temp.s4_eq('S3 a language the release does not cover keeps every section in its place and reports which ones it could not fill',
    pg_temp.s4_rows(jsonb_build_object('sections',
      jsonb_build_object('items', private.resolve_invitation_sections(v_def1, 'ml', '{}'::jsonb)))),
    ARRAY[
      '1|opening|text|reviewed_pack|en|true|false|en',
      '2|family|people_list|-|-|-|-|-',
      '3|ceremonies|event_list|-|-|-|-|-',
      '4|blessing|text|-|-|-|-|-',
      '5|event_notes|text|reviewed_pack|en|true|false|en'
    ]::text[]);
  PERFORM pg_temp.s4_eq('S3b and the unresolvable optional section is still in the list rather than being hidden from the host who has to fix it',
    (SELECT count(*) FROM jsonb_array_elements(
       private.resolve_invitation_sections(v_def1, 'ml', '{}'::jsonb))), 5::bigint);

  -- Release 2 holds the same five keys with different positions. If any part of the order
  -- came from application code — a fixed slot list, a sort by key, a per-community template
  -- — the two releases would resolve to the same sequence.
  v_seq1 := (SELECT coalesce(array_agg(q ->> 'section_key' ORDER BY (q ->> 'position')::integer),
                             '{}'::text[])
               FROM jsonb_array_elements(private.resolve_invitation_sections(v_def1, 'ta', '{}'::jsonb)) q);
  v_seq2 := (SELECT coalesce(array_agg(q ->> 'section_key' ORDER BY (q ->> 'position')::integer),
                             '{}'::text[])
               FROM jsonb_array_elements(private.resolve_invitation_sections(v_def2, 'ta', '{}'::jsonb)) q);
  PERFORM pg_temp.s4_eq('S4 release 2 declares a different order for the same five slots and the resolver obeys it',
    v_seq2, ARRAY['blessing', 'opening', 'family', 'ceremonies', 'event_notes']::text[]);
  PERFORM pg_temp.s4_ok('S4b the two releases therefore produce two genuinely different documents, which is the whole claim that a pack is a source of structure',
    v_seq1 <> v_seq2);
  PERFORM pg_temp.s4_eq('S4c and both documents hold exactly the same five slots, so "reordered" means reordered and not replaced',
    pg_temp.s4_sorted((SELECT coalesce(array_agg(DISTINCT q ->> 'section_key'), '{}'::text[])
       FROM jsonb_array_elements(private.resolve_invitation_sections(v_def2, 'ta', '{}'::jsonb)) q)),
    pg_temp.s4_sorted((SELECT coalesce(array_agg(DISTINCT q ->> 'section_key'), '{}'::text[])
       FROM jsonb_array_elements(private.resolve_invitation_sections(v_def1, 'ta', '{}'::jsonb)) q)));

  -- ------------------------------------------------------ one shape, no matter the input
  -- The resolver emits a fixed set of thirteen field names, so no definition — however
  -- inventive its author — can put a new field in front of a renderer. What the resolver
  -- does not name cannot reach a guest document: the same boundary §11 draws on the
  -- projection side, measured one step earlier.
  PERFORM pg_temp.s4_universe('S5 a resolved section can carry only the thirteen fields the resolver names, whatever the definition asked for',
    private.resolve_invitation_sections(v_def1, 'ta', '{}'::jsonb),
    ARRAY['body_fallback_used', 'body_language', 'body_source', 'body_text',
          'heading_fallback_used', 'heading_language', 'heading_text', 'host_field',
          'kind', 'overrode_pack_text', 'position', 'required', 'section_key']);
  PERFORM pg_temp.s4_eq('S5b a definition smuggling an extra key into a section resolves to the same thirteen fields, because the resolver copies named facts and ignores the rest',
    (SELECT count(*) FROM unnest(pg_temp.s4_all_keys(
        private.resolve_invitation_sections(
          jsonb_set(v_def1, '{sections,0,deity}', '"Meenakshi"'::jsonb),
          'ta', '{}'::jsonb))) u(k)),
    13::bigint);

  -- ---------------------------------------------------------- the no-pack path is this path
  PERFORM pg_temp.s4_eq('S6 a wedding with no pack resolves against the same function and the same shape, so there is no second code path to keep honest',
    (SELECT coalesce(array_agg((q ->> 'position') || ':' || (q ->> 'section_key') || ':' ||
                               (q ->> 'kind') ORDER BY (q ->> 'position')::integer), '{}'::text[])
       FROM jsonb_array_elements(
         private.resolve_invitation_sections(private.default_invitation_definition(),
                                             'en', '{}'::jsonb)) q),
    ARRAY['1:welcome:text', '2:family_introduction:text', '3:family:people_list',
          '4:ceremonies:event_list', '5:event_notes:text', '6:closing:text']::text[]);

  -- ----------------------------------------- the path, computed as a closure not a wish
  -- Start from the five places a document is decided, then add every function those bodies
  -- call, until nothing new appears. The result is the scan's coverage, measured from the
  -- catalog. The `12` is the assertion: a helper added to the path enlarges the closure, and
  -- this group reports the difference instead of scanning a smaller set than it claims.
  v_path := ARRAY['private.build_invitation_snapshot', 'private.public_invitation_dto',
                  'private.invitation_freeze_issues', 'private.require_approved_pack_release',
                  'private.require_frozen_pack_release'];
  v_front := v_path;
  WHILE cardinality(v_front) > 0 LOOP
    SELECT pg_temp.s4_sorted(coalesce(array_agg(DISTINCT (m[1] || '.' || m[2])),
                                       '{}'::text[]))
      INTO v_more
      FROM (SELECT p.proname AS nm, p.prosrc AS src
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'private'
               AND 'private.' || p.proname = ANY (v_front)) c,
           regexp_matches(pg_temp.s4_code_only(c.src),
                          '(private|public)\.([a-z_0-9]+)\(', 'g') m
     WHERE (m[1] || '.' || m[2]) <> ALL (v_path);
    EXIT WHEN cardinality(v_more) = 0;
    v_path := v_path || v_more;
    v_front := v_more;
  END LOOP;
  -- Stage 5 put two more names on this path, and they belong here rather than being carved
  -- out of the walk: `private.invitation_freeze_issues` is now a projection over
  -- `private.invitation_issue_records` and `private.invitation_issue_messages`, so the
  -- functions that decide whether a document may freeze really are in the closure. The walk
  -- finds them the same way it found the rest; the only head-dependent part below is which
  -- list of names the result is compared against, and Stage 5's own battery asserts the
  -- *newly added* arms directly.
  PERFORM pg_temp.s4_eq('S7 the resolution path is these '
    || CASE WHEN pg_temp.s4_at_least('stage5') THEN 'twelve' ELSE 'ten' END
    || ' functions, found by walking the call closure rather than by a hand-written list ('
    || array_to_string(pg_temp.s4_sorted(v_path), ', ') || ')',
    pg_temp.s4_sorted(v_path),
    pg_temp.s4_sorted(CASE WHEN pg_temp.s4_at_least('stage5') THEN ARRAY[
      'private.build_invitation_snapshot', 'private.public_invitation_dto',
      'private.invitation_freeze_issues', 'private.require_approved_pack_release',
      'private.require_frozen_pack_release', 'private.resolve_invitation_sections',
      'private.default_invitation_definition', 'private.pack_text_for',
      'private.dto_text', 'private.map_link_or_null',
      'private.invitation_issue_records', 'private.invitation_issue_messages']
    ELSE ARRAY[
      'private.build_invitation_snapshot', 'private.public_invitation_dto',
      'private.invitation_freeze_issues', 'private.require_approved_pack_release',
      'private.require_frozen_pack_release', 'private.resolve_invitation_sections',
      'private.default_invitation_definition', 'private.pack_text_for',
      'private.dto_text', 'private.map_link_or_null'] END));

  FOR v_name IN SELECT u.k FROM unnest(pg_temp.s4_sorted(v_path)) u(k) LOOP
    SELECT pg_temp.s4_cultural_hits(p.prosrc) INTO v_hits
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = split_part(v_name, '.', 1)
       AND n.nspname || '.' || p.proname = v_name;
    PERFORM pg_temp.s4_eq('S8 ' || v_name || ' contains no test on a pack identity, a faith, a community, a family name or a script-specific layout',
      v_hits, '{}'::text[]);
  END LOOP;

  -- The instrument's own controls: the same scan over a sentence that does the forbidden
  -- thing must find it, and the same scan over that sentence inside a comment must not.
  -- Without these two rows S8 would be satisfiable by a scanner that returns nothing.
  PERFORM pg_temp.s4_eq('S8b and the scan does catch a planted branch, so the clean results above are a measurement and not a mute instrument',
    pg_temp.s4_cultural_hits(
      'IF w.religion = ''hindu'' OR p.pack_key = ''tamil-english'' THEN use_tamil_layout := true; -- temple'),
    ARRAY['hindu', 'pack_key compared to a literal', 'religion',
          'use_tamil_layout']::text[]);
  PERFORM pg_temp.s4_eq('S8c and it reads a comment as a comment: the same words behind -- do not count, which is what lets these functions discuss caste in prose without being scanned for it',
    pg_temp.s4_cultural_hits('SELECT 1; -- if the family is brahmin the temple sends a priest'),
    '{}'::text[]);
  -- The other side of the same distinction: crediting the release a document came from is
  -- required behaviour, so a bare reference to the field must not be flagged. Without this
  -- row the group would be satisfied by a scanner that objects to every mention.
  PERFORM pg_temp.s4_eq('S8e and naming the pack a document came from is not treated as branching on it, because a frozen document has to credit its release',
    pg_temp.s4_cultural_hits(
      'SELECT jsonb_build_object(''pack_key'', p.pack_key, ''release_number'', r.release_number)'),
    '{}'::text[]);
  PERFORM pg_temp.s4_eq('S8d and a word that merely looks like a banned one is not a hit: `section` is not `sect`, and `community_id` is a column this product does not have',
    pg_temp.s4_cultural_hits('SELECT count(*) FROM sections WHERE community_id = 3 /* contemplate */'),
    '{}'::text[]);

  -- The ordering claim, restated where it actually matters: a frozen document keeps the
  -- release's order, forever.
  v_rows1 := pg_temp.s4_rows((SELECT v.snapshot FROM public.invitation_versions v
                               WHERE v.tradition_pack_release_id = (SELECT rel_1 FROM sf)
                               ORDER BY v.version_number LIMIT 1));
  PERFORM pg_temp.s4_eq('S9 the frozen document group P pinned from release 1 still holds release 1''s order',
    (SELECT coalesce(array_agg(split_part(r, '|', 1) || ':' || split_part(r, '|', 2)
                          ORDER BY split_part(r, '|', 1)::integer), '{}'::text[])
       FROM unnest(v_rows1) r),
    ARRAY['1:opening', '2:family', '3:ceremonies', '4:blessing', '5:event_notes']);
END $S$;
-- ===========================================================================
-- B. THE BILINGUAL RESOLUTION MATRIX
-- ===========================================================================
-- §14 of the continuation names what has to be true before any of the UI is polished:
-- language resolution, an explicit Tamil→English fallback, no implicit fallback, and an
-- unsupported language. All four are one function's behaviour — `private.pack_text_for`
-- takes a language map, the language the invitation asked for, and the one boolean the
-- release set for that section, and returns the line plus *how it was arrived at*.
--
-- The reason the matrix is run against the function directly, before it is run against a
-- whole document, is that the interesting cases are the degenerate ones. A section whose
-- Tamil is a row of spaces, a wording that is a number, a fallback target that exists but
-- is empty, a missing language: none of these appear in a well-behaved fixture, and all of
-- them are reachable from a definition somebody typed. Each one has exactly two acceptable
-- outcomes — the requested language, or nothing — and "nothing" is the safe one. The
-- unacceptable outcome, the one the whole group exists to refuse, is an English sentence
-- arriving with a Tamil tag on it.
--
-- The document-level cases below then measure the same rule where it matters: release 1
-- holds one section that permits the substitution (`event_notes`) and one that forbids it
-- (`blessing`), both of them carrying English-only wording, in an invitation written for a
-- Tamil wedding. A resolver that fell back quietly would produce a plausible-looking
-- document out of that fixture; the measured output has one English line, marked as a
-- substitution, and one section that says nothing at all.

-- The matrix's one-line rendering of a `pack_text_for` result: the text, the language it is
-- tagged as, and whether that tag was reached by a declared fallback. A refusal prints as
-- `<nothing>|-|-` so a case cannot pass by comparing NULL to NULL and never noticing the
-- difference between "no wording" and "wording nobody claims".
CREATE FUNCTION pg_temp.s4_ptext(p_node jsonb, p_requested text, p_allow boolean)
RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(q ->> 'text', '<nothing>') || '|'
      || coalesce(q ->> 'language', '-') || '|'
      || coalesce(q ->> 'fallback_used', '-')
    FROM (SELECT private.pack_text_for(p_node, p_requested, p_allow) AS q) x $fn$;

-- Case table, in the order written. `node` is JSON *text* rather than jsonb so the
-- degenerate shapes — a number where a line should be, a list where a map should be —
-- survive being typed as a column.
CREATE TEMP TABLE s4_bc (seq serial, name text, node text, requested text,
                         allow_fb boolean, expects text) ON COMMIT DROP;
TRUNCATE s4_bc;

DO $B$
DECLARE
  v_case    record;
  v_def1    jsonb;
  v_draft   jsonb;
  v_n       integer := 0;
  v_res     jsonb;
  v_rows    text[];
  v_count   bigint;
BEGIN
  PERFORM pg_temp.s4_is_superuser('B0 the resolution matrix reads the release as the role that authored it');
  SELECT definition INTO v_def1 FROM public.tradition_pack_releases WHERE id = (SELECT rel_1 FROM sf);
  SELECT content INTO v_draft FROM public.invitation_drafts WHERE wedding_id = (SELECT wed FROM sf);

  INSERT INTO s4_bc (name, node, requested, allow_fb, expects) VALUES
    ('the language the invitation asks for is on the shelf, the release does not even get asked about a fallback',
     '{"en": "English line", "ta": "Tamil line"}', 'ta', true, 'Tamil line|ta|false'),
    ('and an invitation written in English reads English wording without calling it a substitution',
     '{"en": "English line", "ta": "Tamil line"}', 'en', true, 'English line|en|false'),
    ('English wording in a release that never declared a fallback is *not* read for a Tamil invitation',
     '{"en": "English line"}', 'ta', false, '<nothing>|-|-'),
    ('where the release did declare it, the guest reads English and the document records that it is English',
     '{"en": "English line"}', 'ta', true, 'English line|en|true'),
    ('a release with no English cannot fall back to a language it does not hold',
     '{"ta": "Tamil line"}', 'en', true, '<nothing>|-|-'),
    ('blank Tamil is not Tamil wording, so a declared fallback is what a guest reads',
     '{"ta": "   ", "en": "English line"}', 'ta', true, 'English line|en|true'),
    ('blank Tamil with no fallback declared leaves the section with nothing, not with spaces',
     '{"ta": "   "}', 'ta', false, '<nothing>|-|-'),
    ('a real line with stray spaces around it is trimmed rather than sent out padded',
     '{"ta": "  வணக்கம்  "}', 'ta', false, 'வணக்கம்|ta|false'),
    ('a number where a line should be is not text in the requested language, so the declared fallback speaks',
     '{"ta": 7, "en": "English line"}', 'ta', true, 'English line|en|true'),
    ('and a number with no fallback is simply not wording',
     '{"en": 456}', 'en', true, '<nothing>|-|-'),
    ('a fallback target that exists but is empty is not a place to land',
     '{"en": "  "}', 'ta', true, '<nothing>|-|-'),
    ('a node that is a list rather than a language map yields nothing',
     '["en", "English line"]', 'en', true, '<nothing>|-|-'),
    ('a section that offers no wording at all yields nothing',
     NULL, 'ta', true, '<nothing>|-|-'),
    ('an invitation whose host has not chosen a language reads no pack wording — the absence is recorded, not guessed at',
     '{"en": "English line", "ta": "Tamil line"}', NULL, true, '<nothing>|-|-'),
    ('a section that forgot the fallback flag is read as one that forbade it',
     '{"en": "English line"}', 'ta', NULL, '<nothing>|-|-'),
    ('a language the release has never heard of may still use the substitution it declared',
     '{"en": "English line"}', 'ml', true, 'English line|en|true'),
    ('and a line written in a third language keeps that language as its tag rather than borrowing the requested one',
     '{"en": "English line", "te": "తెలుగు లైన్"}', 'te', false, 'తెలుగు లైన్|te|false'),
    ('the same Telugu-only offer, asked for in Malayalam with a fallback, arrives as English and never as Telugu',
     '{"en": "English line", "te": "తెలుగు లైన్"}', 'ml', true, 'English line|en|true');

  FOR v_case IN SELECT * FROM s4_bc ORDER BY seq LOOP
    v_n := v_n + 1;
    PERFORM pg_temp.s4_eq('B' || v_n || ' ' || v_case.name,
      pg_temp.s4_ptext(v_case.node::jsonb, v_case.requested, v_case.allow_fb),
      v_case.expects);
  END LOOP;

  -- ---------------------------------------------------------------- the whole document
  -- Release 1 resolved for the Tamil wedding, with that wedding's real draft: the host's
  -- own welcome over the pack's opening, a row of spaces in the note field, and no closing
  -- line at all. Every outcome the release can produce is in this one array.
  PERFORM pg_temp.s4_eq('B' || (v_n + 1) || ' a Tamil invitation reads the pack''s Tamil where it has Tamil, the host''s own words where the host wrote them, and no wording at all where the release offered only English and refused to substitute',
    pg_temp.s4_rows(jsonb_build_object('sections',
      jsonb_build_object('items', private.resolve_invitation_sections(v_def1, 'ta', v_draft)))),
    ARRAY[
      '1|opening|text|host|-|-|true|ta',
      '2|family|people_list|-|-|-|-|ta',
      '3|ceremonies|event_list|-|-|-|-|ta',
      '4|blessing|text|-|-|-|-|ta',
      '5|event_notes|text|reviewed_pack|en|true|false|ta'
    ]::text[]);

  -- The same wedding, the same release, asked for in English. `blessing` now has wording,
  -- and its `fallback_used` is false: the line was always English and the invitation is
  -- English, so nothing was substituted. That distinction is the difference between an
  -- honest document and one that cannot be audited later.
  PERFORM pg_temp.s4_eq('B' || (v_n + 2) || ' the same document in English reads the English line as itself rather than as a fallback, which is why the flag is stored per section instead of being inferred from the language',
    pg_temp.s4_rows(jsonb_build_object('sections',
      jsonb_build_object('items', private.resolve_invitation_sections(v_def1, 'en', v_draft)))),
    ARRAY[
      '1|opening|text|host|-|-|true|en',
      '2|family|people_list|-|-|-|-|en',
      '3|ceremonies|event_list|-|-|-|-|en',
      '4|blessing|text|reviewed_pack|en|false|false|en',
      '5|event_notes|text|reviewed_pack|en|false|false|en'
    ]::text[]);

  -- Every language tag the resolver can emit, for five requested languages including one
  -- the host never chose. The claim is a containment one and it is the group's whole
  -- purpose: nothing outside the release's declared `{en, ta}` ever appears on a line, so
  -- no reader of a frozen document can be told that a string is in a language nobody wrote
  -- it in. `ml` and `te` are here because an unsupported language must produce *less*, not
  -- something invented.
  PERFORM pg_temp.s4_eq('B' || (v_n + 3) || ' and across every requested language — including two this release has never heard of and one the host never chose — no line is ever tagged with a language the release does not declare',
    (SELECT coalesce(array_to_string(array_agg(x ORDER BY x), ' ;; '), '<none>') FROM (
        SELECT coalesce(l.lang, '(none)') || ' body='
               || array_to_string(pg_temp.s4_sorted(
                    array_agg(DISTINCT s ->> 'body_language')), '+')
               || '|head='
               || array_to_string(pg_temp.s4_sorted(
                    array_agg(DISTINCT s ->> 'heading_language')), '+') AS x
          FROM (SELECT unnest(ARRAY['ta', 'en', 'ml', 'te', NULL])::text AS lang) l
          JOIN LATERAL jsonb_array_elements(private.resolve_invitation_sections(
                 v_def1, l.lang, '{}'::jsonb)) s ON true
         GROUP BY coalesce(l.lang, '(none)')) q),
    '(none) body=|head= ;; en body=en|head=en ;; ml body=en|head=en ;; ta body=en+ta|head=ta ;; te body=en|head=en');

  PERFORM pg_temp.s4_eq('B' || (v_n + 4) || ' so the refusal this whole stage exists for holds exactly: an English line reached by fallback is never labelled Tamil, in any section of any resolution of this release',
    (SELECT count(*) FROM (
        SELECT l.lang, s
          FROM (SELECT unnest(ARRAY['ta', 'en', 'ml', 'te'])::text AS lang) l
         CROSS JOIN LATERAL jsonb_array_elements(
                 private.resolve_invitation_sections(v_def1, l.lang, v_draft)) s
     ) x
      WHERE (x.s ->> 'body_fallback_used')::boolean AND x.s ->> 'body_language' = 'ta'
         OR (x.s ->> 'heading_fallback_used')::boolean AND x.s ->> 'heading_language' = 'ta'),
    0::bigint);

  -- The wording itself, at the two ends of the substitution rule. An assertion on the tags
  -- alone would be satisfied by a resolver that returned the right language and the wrong
  -- sentence.
  PERFORM pg_temp.s4_jq('B' || (v_n + 5) || ' and a Tamil guest reads the release''s Tamil line, byte for byte as it was authored',
    jsonb_build_object('text', pg_temp.s4_section(jsonb_build_object('sections',
      jsonb_build_object('items', private.resolve_invitation_sections(v_def1, 'ta', '{}'::jsonb))),
      'opening') -> 'body_text'),
    jsonb_build_object('text', 'வணக்கம்'));

  PERFORM pg_temp.s4_jq('B' || (v_n + 6) || ' and an English guest of the same wedding reads the release''s English line, so the difference between the two documents is the language and nothing else',
    jsonb_build_object('text', pg_temp.s4_section(jsonb_build_object('sections',
      jsonb_build_object('items', private.resolve_invitation_sections(v_def1, 'en', '{}'::jsonb))),
      'opening') -> 'body_text'),
    jsonb_build_object('text', 'With the goodwill of both families.'));

  -- A host field of spaces must not swallow the pack's offer; a host field with real words
  -- must. Both halves in one pair, because the boundary is the rule.
  PERFORM pg_temp.s4_jq('B' || (v_n + 7) || ' whitespace a host left in a field is not a host line, so the reviewed wording still reaches the guest — as English, and marked as the substitution it is',
    (SELECT jsonb_build_array(s ->> 'body_source', s ->> 'overrode_pack_text',
                              s ->> 'body_language')
       FROM jsonb_array_elements(private.resolve_invitation_sections(
              v_def1, 'ta', jsonb_build_object('event_notes', '   '))) s
      WHERE s ->> 'section_key' = 'event_notes'),
    '["reviewed_pack","false","en"]'::jsonb);

  -- A host line carries no text of its own in the resolved section: the words live once, in
  -- the document's `draft` block, and the section names the field to read them from. The
  -- pair below measures both halves — the attribution and the absence — because a resolver
  -- that copied the host's paragraph into the section *and* left it in `draft` would freeze
  -- the same sentence twice with two spellings, and the second copy would go stale the
  -- moment the host edited the first.
  PERFORM pg_temp.s4_jq('B' || (v_n + 8) || ' and a host line is attributed to the host with no language tag on it, since the release''s review record covers the wording it wrote and never the words typed over it',
    (SELECT jsonb_build_array(s ->> 'body_source', s ->> 'overrode_pack_text',
                              s ->> 'body_language', s -> 'body_text')
       FROM jsonb_array_elements(private.resolve_invitation_sections(
              v_def1, 'ta', jsonb_build_object('event_notes', 'Please arrive by nine.'))) s
      WHERE s ->> 'section_key' = 'event_notes'),
    '["host","true",null,null]'::jsonb);

  PERFORM pg_temp.s4_jq('B' || (v_n + 9) || ' and the section says where the host''s words are instead of repeating them, so a document cannot hold two copies of one sentence',
    (SELECT jsonb_build_array(s ->> 'host_field', s -> 'body_text')
       FROM jsonb_array_elements(private.resolve_invitation_sections(
              v_def1, 'ta', jsonb_build_object('event_notes', 'Please arrive by nine.'))) s
      WHERE s ->> 'section_key' = 'event_notes'),
    '["event_notes",null]'::jsonb);

  -- The path a wedding with no pack takes, which is the same function over a generated
  -- definition. §13 requires the no-pack document to keep rendering as it did before Stage
  -- 4, and "as before" here means something measurable: no section of it can be credited to
  -- a reviewed pack, because there is none.
  v_rows := pg_temp.s4_rows(jsonb_build_object('sections',
    jsonb_build_object('items', private.resolve_invitation_sections(
      private.default_invitation_definition(), 'ta', v_draft))));
  PERFORM pg_temp.s4_eq('B' || (v_n + 10) || ' a wedding with no pack resolves through the same function, and the sections it gets are the neutral six with the host''s own wording where the host wrote any',
    v_rows,
    ARRAY[
      '1|welcome|text|host|-|-|false|-',
      '2|family_introduction|text|-|-|-|-|-',
      '3|family|people_list|-|-|-|-|-',
      '4|ceremonies|event_list|-|-|-|-|-',
      '5|event_notes|text|-|-|-|-|-',
      '6|closing|text|-|-|-|-|-'
    ]::text[]);

  SELECT count(*) INTO v_count FROM jsonb_array_elements(
    private.resolve_invitation_sections(private.default_invitation_definition(), 'ta',
                                        v_draft)) s
   WHERE s ->> 'body_source' = 'reviewed_pack';
  PERFORM pg_temp.s4_eq('B' || (v_n + 11) || ' and nothing in a packless document is credited to a reviewed pack, in any language',
    v_count, 0::bigint);

  v_res := private.resolve_invitation_sections(
    private.default_invitation_definition(), 'ta', v_draft);
  PERFORM pg_temp.s4_eq('B' || (v_n + 12) || ' nor does the default definition smuggle a heading nobody authored: the one English heading it carries is withheld from a Tamil invitation rather than shown as a substitution it never declared',
    (SELECT jsonb_build_array(s ->> 'section_key', coalesce(s ->> 'heading_language', '-'))
       FROM jsonb_array_elements(v_res) s
      WHERE s ->> 'section_key' = 'ceremonies'),
    '["ceremonies","-"]'::jsonb);
END $B$;
-- ===========================================================================
-- V. WHERE THE HOST WROTE OVER THE PACK, THE DOCUMENT SAYS THE HOST WROTE IT
-- ===========================================================================
-- §12 of the continuation, in the form it was given: pack wording left alone is
-- `reviewed_pack`; wording the host replaced is `host`; and the middle ground somebody
-- might reach for — `reviewed_pack but modified by host` — is refused because it is false
-- provenance. A guest reading the second form would be crediting a reviewed authority with
-- a sentence no reviewer ever saw, which is the exact failure this stage exists to make
-- impossible.
--
-- So this group is not about whether the host *may* override; the editor has always allowed
-- that. It measures three properties of an override, each of which has to hold in a frozen
-- document rather than only in the client that displayed it:
--
--   * the attribution is one of exactly two values, and the second is not a decorated
--     version of the first;
--   * the host's words exist in one place in the document, so two copies cannot drift apart
--     and leave a review credit attached to a stale paragraph;
--   * an override written tomorrow cannot move what was frozen yesterday — including an
--     override written to try and make it move.
--
-- The writes go through the owner's own UPDATE on `public.invitation_drafts`, as the host
-- role, because a provenance rule measured by a superuser writing a JSON blob is a rule
-- about this file. The pack row is hashed before and after every case here; a host edit that
-- reached into the catalogue would show up as a changed hash.

-- How many times a string occurs inside a document, as one number a test can assert on.
CREATE FUNCTION pg_temp.s4_occurrences(p_haystack text, p_needle text) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN coalesce(p_needle, '') = '' THEN 0::bigint
         ELSE (length(coalesce(p_haystack, ''))
               - length(replace(p_haystack, p_needle, ''))) / length(p_needle)
    END $fn$;

-- The host's own draft write, reported the way every other customer-path write in this file
-- is reported, with the role restored on both paths. An earlier draft of this helper
-- `RETURN`ed from inside the role change, which leaked `authenticated` into every group
-- after it — the same trap `s4_freeze` documents above.
CREATE FUNCTION pg_temp.s4_write_draft(p_host uuid, p_wedding uuid, p_content jsonb)
RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_res text;
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_host::text, false);
  v_res := pg_temp.s4_err('UPDATE public.invitation_drafts SET content = '
    || quote_literal(coalesce(p_content, '{}'::jsonb)::text)
    || '::jsonb WHERE wedding_id = ' || quote_literal(p_wedding::text));
  EXECUTE 'RESET ROLE';
  RETURN v_res;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

DO $V$
DECLARE
  v_host    uuid;
  v_wed     uuid;
  v_rel     uuid;
  v_orig    jsonb;
  v_words   text;
  v_def     jsonb;
  v_chash   text;
  v_rhash   text;
  v_snap    jsonb;
  v_res     jsonb;
  v_dto     jsonb;
  v_ver     uuid;
  v_ver2    uuid;
  v_ver3    uuid;
  v_before  text;
  v_hostile text;
  v_sources text[];
  v_odd     bigint;
  v_named   text;
BEGIN
  PERFORM pg_temp.s4_is_superuser('V0 the provenance group starts as the maintenance role, and hands the pen to the host from there');
  SELECT host_a, wed, rel_2 INTO v_host, v_wed, v_rel FROM sf;
  SELECT content INTO v_orig FROM public.invitation_drafts WHERE wedding_id = v_wed;
  SELECT definition INTO v_def FROM public.tradition_pack_releases WHERE id = v_rel;
  v_words := v_orig ->> 'welcome';
  v_chash := pg_temp.s4_chash(v_rel);
  v_rhash := pg_temp.s4_rhash(v_rel);

  -- Everything below hangs on this: the host chose release 2, the approved one, through the
  -- same UPDATE a browser sends. Group P left the wedding holding no release, so the
  -- selection is made here rather than inherited from an earlier group's leftover.
  PERFORM pg_temp.s4_eq('V1 the host selects the approved release whose provenance is about to be measured',
    pg_temp.s4_select(v_host, v_wed, v_rel), 'no-error');

  ---------------------------------------------------------- the two states of one section
  PERFORM pg_temp.s4_eq('V2 with the host''s pen lifted, release 2''s opening is credited to the review that wrote it',
    pg_temp.s4_rows(jsonb_build_object('sections',
      jsonb_build_object('items', private.resolve_invitation_sections(v_def, 'ta', '{}'::jsonb)))),
    ARRAY[
      '1|blessing|text|-|-|-|-|ta',
      '2|opening|text|reviewed_pack|ta|false|false|ta',
      '3|family|people_list|-|-|-|-|ta',
      '4|ceremonies|event_list|-|-|-|-|ta',
      '5|event_notes|text|reviewed_pack|en|true|false|ta'
    ]::text[]);

  PERFORM pg_temp.s4_eq('V2b and with the pen down on the same field, the identical section is credited to the host — same key, same position, same heading, different author',
    pg_temp.s4_rows(jsonb_build_object('sections',
      jsonb_build_object('items', private.resolve_invitation_sections(v_def, 'ta', v_orig)))),
    ARRAY[
      '1|blessing|text|-|-|-|-|ta',
      '2|opening|text|host|-|-|true|ta',
      '3|family|people_list|-|-|-|-|ta',
      '4|ceremonies|event_list|-|-|-|-|ta',
      '5|event_notes|text|reviewed_pack|en|true|false|ta'
    ]::text[]);

  -- The vocabulary, closed. `overrode_pack_text` is the field that carries "the pack had
  -- something here", so the source has no room to grow a compound value — and this is the
  -- assertion that would fail the day somebody writes `reviewed_pack_modified_by_host`
  -- because it looked more informative.
  SELECT pg_temp.s4_sorted(array_agg(DISTINCT s ->> 'body_source')) INTO v_sources
    FROM jsonb_array_elements(private.resolve_invitation_sections(v_def, 'ta', v_orig)) s
   WHERE s ->> 'body_source' IS NOT NULL;
  PERFORM pg_temp.s4_eq('V3 the only wordings a document can be credited to are the two the review model can honour',
    v_sources, ARRAY['host', 'reviewed_pack']::text[]);

  SELECT count(*) INTO v_odd
    FROM jsonb_array_elements(private.resolve_invitation_sections(v_def, 'ta', v_orig)) s
   WHERE s ->> 'body_source' IS NOT NULL
     AND s ->> 'body_source' NOT IN ('host', 'reviewed_pack');
  PERFORM pg_temp.s4_eq('V3b and there is no third spelling, decorated or otherwise, of "the pack wrote it but somebody changed it"',
    v_odd, 0::bigint);

  ------------------------------------------------------------- the frozen document
  v_res := pg_temp.s4_freeze(v_host, v_wed);
  v_ver := (v_res ->> 'version_id')::uuid;
  v_snap := v_res -> 'snapshot';

  PERFORM pg_temp.s4_eq('V4 the frozen document says the host wrote the opening, in the document rather than in a client that could be pointed at other data',
    jsonb_build_array(v_snap -> 'sections' -> 'items' -> 1 ->> 'body_source',
                      v_snap -> 'sections' -> 'items' -> 1 ->> 'overrode_pack_text'),
    '["host","true"]'::jsonb);

  -- One spelling. The host's paragraph lives in `draft` and is *referenced* by the section;
  -- a resolver that copied it into the section too would produce two strings with one
  -- meaning, and only one of them would ever be edited again.
  PERFORM pg_temp.s4_eq('V5 and the host''s sentence occurs in the frozen document exactly once, so no second copy can go stale under the first one''s credit',
    pg_temp.s4_occurrences(v_snap::text, v_words), 1::bigint);

  PERFORM pg_temp.s4_eq('V5b while the pack line the host wrote over is absent from the document entirely — an override replaces wording, it does not archive it beside the host''s',
    pg_temp.s4_occurrences(v_snap::text, 'வணக்கம்'), 0::bigint);

  ------------------------------------------------- an override cannot reach into the past
  v_before := (SELECT md5(v.snapshot::text) FROM public.invitation_versions v WHERE v.id = v_ver);
  PERFORM pg_temp.s4_write_draft(v_host, v_wed,
    jsonb_build_object('welcome', 'A second thought, written after the invitation went out.'));
  v_res := pg_temp.s4_freeze(v_host, v_wed);
  v_ver2 := (v_res ->> 'version_id')::uuid;

  PERFORM pg_temp.s4_eq('V6 an override written afterwards leaves the earlier frozen document byte-for-byte where it was, including its credit to the host''s earlier words',
    (SELECT md5(v.snapshot::text) FROM public.invitation_versions v WHERE v.id = v_ver),
    v_before);
  PERFORM pg_temp.s4_eq('V6b and the new version credits the new sentence, which is the only way the two of them can be told apart later',
    pg_temp.s4_occurrences((v_res -> 'snapshot')::text,
                           'A second thought, written after the invitation went out.'),
    1::bigint);
  PERFORM pg_temp.s4_eq('V6c and the earlier version still holds the earlier sentence exactly once, so the second freeze did not append a copy of it anywhere',
    pg_temp.s4_occurrences((SELECT v.snapshot::text FROM public.invitation_versions v
                             WHERE v.id = v_ver), v_words),
    1::bigint);
  PERFORM pg_temp.s4_eq('V6d two versions of one wedding, each a document of its own',
    (SELECT count(*) FROM public.invitation_versions v
      WHERE v.wedding_id = v_wed AND v.id IN (v_ver, v_ver2)), 2::bigint);

  ------------------------------------------------------ a hostile override, written by the host
  -- §12's "test hostile override strings", through the owner's own write path. The claim
  -- measured here is narrow and it is the one that matters: whatever the host types, the
  -- document holds it as text in a field the host owns, attributed to the host, and nothing
  -- in the resolution or freezing of a section turns it into structure, into pack wording,
  -- or into an instruction.
  v_hostile := $hs$<script>alert('the host typed this')</script> & "quoted" ]]#>>{a,b}$hs$;
  PERFORM pg_temp.s4_eq('V7 a host may write markup-looking words into their own field through the owner path without the draft being refused',
    pg_temp.s4_write_draft(v_host, v_wed, jsonb_build_object('welcome', v_hostile)),
    'no-error');

  v_res := pg_temp.s4_freeze(v_host, v_wed);
  v_ver3 := (v_res ->> 'version_id')::uuid;
  v_snap := v_res -> 'snapshot';
  v_dto := pg_temp.s4_dto(v_ver3);
  PERFORM pg_temp.s4_eq('V7b and the section that renders it is still credited to the host, with the reviewed pack marked as what was overridden',
    jsonb_build_array(v_snap -> 'sections' -> 'items' -> 1 ->> 'body_source',
                      v_snap -> 'sections' -> 'items' -> 1 ->> 'overrode_pack_text'),
    '["host","true"]'::jsonb);

  -- A guest is served the host's words at the top level of the projection (Stage 3's shape,
  -- unchanged) *and* inside the section that points at them. That is not the document holding
  -- two copies — the frozen snapshot has one, measured at V5 — it is a derived view writing
  -- the same value into the two places a renderer looks. Both halves are asserted, because
  -- the interesting property is that the string arrives as a string.
  PERFORM pg_temp.s4_eq('V8 the projected document holds the hostile string as a string in the host''s own field, unchanged and unescaped, so nothing has to re-interpret it to display it',
    jsonb_build_object('dto_type', jsonb_typeof(v_dto),
                       'welcome_type', jsonb_typeof(v_dto -> 'welcome'),
                       'welcome', v_dto ->> 'welcome'),
    jsonb_build_object('dto_type', 'object', 'welcome_type', 'string',
                       'welcome', v_hostile));

  PERFORM pg_temp.s4_eq('V8e and the section the renderer walks resolves its host pointer to that same string, with no language and no fallback attached to it',
    (SELECT jsonb_build_array(b ->> 'source', b ->> 'text', b -> 'language',
                              b -> 'fallback_used')
       FROM (SELECT q -> 'body' AS b
               FROM jsonb_array_elements(v_dto -> 'sections' -> 'items') q
              WHERE q ->> 'section_key' = 'opening') y),
    jsonb_build_array('host', v_hostile, null, null));

  PERFORM pg_temp.s4_eq('V8b and the section list carries no key for it either: the resolved document is still the same thirteen fields per section, with the override only ever named in `host_field`',
    (SELECT count(*) FROM unnest(pg_temp.s4_all_keys(v_snap -> 'sections')) u(k)
      WHERE k NOT IN (SELECT x.k FROM unnest(ARRAY[
        'body_fallback_used', 'body_language', 'body_source', 'body_text', 'heading_fallback_used',
        'heading_language', 'heading_text', 'host_field', 'items', 'kind', 'overrode_pack_text',
        'position', 'requested', 'required', 'section_key']) x(k))),
    0::bigint);

  PERFORM pg_temp.s4_eq('V8c and the pack''s reviewed wording is nowhere near it: the release row''s content hash has not moved across every override in this group',
    pg_temp.s4_chash(v_rel), v_chash);
  PERFORM pg_temp.s4_eq('V8d nor has its review record, which a host edit has no business rewriting however the field is spelled',
    pg_temp.s4_rhash(v_rel), v_rhash);

  ------------------------------------------------------- provenance, and who may see it
  -- The document keeps its review facts — that is why pinning a release is worth doing —
  -- and a guest page keeps the credit line. §12's warning is that the first must not become
  -- the second merely because provenance exists. This is the small version of that rule;
  -- group C measures the whole key universe of a guest document.
  SELECT array_to_string(pg_temp.s4_sorted(array_agg(DISTINCT u.k)), ',') INTO v_named
    FROM unnest(pg_temp.s4_all_keys(v_snap)) u(k)
   WHERE k IN ('review_label', 'review_basis', 'review_scope', 'reviewed_languages',
               'author_label', 'source_reference', 'machine_assisted');
  PERFORM pg_temp.s4_eq('V9 the snapshot does carry review facts, so the guest-document assertions below refuse real content rather than an empty object (the names it carries)',
    v_named, 'author_label,machine_assisted,review_label,reviewed_languages,source_reference');

  PERFORM pg_temp.s4_no_forbidden('V10 and none of them is in the document a guest is served, because a host override makes the invitation the host''s and does not make the reviewers theirs',
    v_dto,
    ARRAY['review_label', 'review_basis', 'review_scope', 'reviewed_by', 'reviewed_at',
          'approved_at', 'reviewed_languages', 'author_label', 'source_reference',
          'machine_assistance_notes', 'definition', 'definition_schema_version']);

  PERFORM pg_temp.s4_eq('V11 what the guest document does keep is the pair that answers "which wording was this credited to", release number and all',
    jsonb_build_array(v_dto -> 'tradition_pack' ->> 'pack_key',
                      v_dto -> 'tradition_pack' ->> 'release_number'),
    '["stage4_doc_pinned","2"]'::jsonb);

  ------------------------------------------------------------- clear, and re-attribute
  -- The last property is the one an editor can break silently: provenance describes the
  -- document as it stands now. A field emptied by the host must return the section to the
  -- pack, not freeze a `host` credit around nothing.
  PERFORM pg_temp.s4_write_draft(v_host, v_wed, jsonb_build_object('welcome', '   '));
  PERFORM pg_temp.s4_eq('V12 a field the host emptied is not a host line, so release 2''s own Tamil is credited to the release again',
    (SELECT (s ->> 'body_source') || '|' || (s ->> 'body_language')
       FROM jsonb_array_elements(private.resolve_invitation_sections(
              v_def, 'ta', jsonb_build_object('welcome', '   '))) s
      WHERE s ->> 'section_key' = 'opening'),
    'reviewed_pack|ta');

  PERFORM pg_temp.s4_eq('V12b and the document that state produces has nothing at all for the freeze boundary to refuse, so "the host deleted the field" is a legal state rather than a provenance error',
    (SELECT cardinality(private.invitation_freeze_issues(
              private.build_invitation_snapshot(v_wed)))),
    0::integer);

  -- The fixture's own words go back, so F, C and A inherit the draft the header describes
  -- rather than a residue of this group's probes.
  PERFORM pg_temp.s4_eq('V13 the host''s original draft is restored through the same owner path, and the restore is measured rather than assumed',
    pg_temp.s4_write_draft(v_host, v_wed, v_orig), 'no-error');
  PERFORM pg_temp.s4_eq('V13b with the content equal to what this group found, key for key',
    (SELECT d.content FROM public.invitation_drafts d WHERE d.wedding_id = v_wed), v_orig);
  PERFORM pg_temp.s4_eq('V13c and the wedding still points at the release this group chose, so no later group inherits a cleared selection by accident',
    (SELECT w.tradition_pack_release_id FROM public.weddings w WHERE w.id = v_wed), v_rel);
END $V$;
-- ===========================================================================
-- F. THE FREEZE BOUNDARY REFUSES ON ITS OWN, AND SAYS WHY
-- ===========================================================================
-- §O of the design and ruling A1's second half. The host's editor is going to show a
-- warning; this group measures the thing that makes the warning more than a suggestion —
-- the database refusing the same document when no client was consulted at all. Every call
-- below goes through `api.create_invitation_version` as the host role, which is the path a
-- browser takes, and every expected message is read out of the refusal rather than
-- paraphrased.
--
-- Three properties, in this order:
--
--   * a document with an unresolved required section may not be frozen, and the refusal
--     names one cause, in one sentence, with the section and the language in it. A list
--     that says "something is missing" tells a host nothing they can act on;
--   * previewing the same document still works, and shows the hole rather than filling it.
--     The boundary is the freeze, not the reading;
--   * an unnameable issue is worse than none, which is why `invitation_freeze_issues`
--     guards its language arm against a NULL request — measured at F12/F13 below, including
--     the aggregation fact that makes the guard load-bearing rather than decorative.
--
-- Release 3 exists for the first property: it is well-formed to the authoring guard —
-- approved, ordered, bilingual headings — and un-freezable on a Tamil invitation, because
-- one of its required text sections holds English only and refuses the substitution. That
-- combination is the case no schema check can see, because it is not a fact about the
-- release; it is a fact about the release *and* the wedding reading it.

DO $F$
DECLARE
  v_host    uuid;
  v_wed     uuid;
  v_wed_ml  uuid;
  v_wed_no  uuid;
  v_r2      uuid;
  v_r3      uuid;
  v_snap    jsonb;
  v_issues  text[];
  v_prev_n  bigint;
  v_now_n   bigint;
  v_err     text;
  v_prev    jsonb;
  v_unnamed   jsonb;  -- a document whose requested language was never chosen
  v_unguarded text[]; -- the same document checked without the guard on the language arm
BEGIN
  PERFORM pg_temp.s4_is_superuser('F0 the freeze-boundary group starts as the maintenance role and refuses to use it for a freeze');
  SELECT host_a, wed, wed_ml, wed_none, rel_2, rel_3
    INTO v_host, v_wed, v_wed_ml, v_wed_no, v_r2, v_r3 FROM sf;

  -- ---------------------------------------------------------------- the unresolvable release
  PERFORM pg_temp.s4_eq('F1 an approved release whose wording cannot fill a required section is still selectable, because "was this reviewed" and "does it fit this wedding" are different gates',
    pg_temp.s4_select(v_host, v_wed, v_r3), 'no-error');

  SELECT count(*) INTO v_prev_n FROM public.invitation_versions WHERE wedding_id = v_wed;
  v_err := pg_temp.s4_freeze_err(v_host, v_wed);
  PERFORM pg_temp.s4_ok('F2 the host''s own freeze call refuses the document it would have produced (' || left(v_err, 140) || ')',
    v_err LIKE '23514%cannot be frozen yet%');

  v_snap := private.build_invitation_snapshot(v_wed);
  v_issues := private.invitation_freeze_issues(v_snap);
  PERFORM pg_temp.s4_eq('F3 and the refusal names exactly one cause: the required section, the language it was wanted in, and the rule that stopped the substitution',
    v_issues,
    ARRAY['section blessing is required and has no wording in ta, and the release does not allow it to fall back']);

  PERFORM pg_temp.s4_eq('F4 which is the whole of the sentence the host is shown — one cause, not a pile of consequences',
    array_to_string(v_issues, '; '),
    'section blessing is required and has no wording in ta, and the release does not allow it to fall back');

  -- ------------------------------------------------------------------ preview still works
  v_prev := pg_temp.s4_preview(v_host, v_wed);
  PERFORM pg_temp.s4_eq('F5 the same document previews, so the boundary is the freeze and not the reading',
    jsonb_build_object('is_error', (v_prev ? 'error')::text,
                       'requested', v_prev -> 'sections' ->> 'requested',
                       'sections', jsonb_array_length(v_prev -> 'sections' -> 'items')),
    jsonb_build_object('is_error', 'false', 'requested', 'ta', 'sections', 2));

  -- Measured, not assumed: the projection keeps the `body` *key* and sets it to JSON null,
  -- and jsonb does not treat that as SQL NULL — `IS NOT NULL` and the `?` existence
  -- operator both answer "present" for it. The only reading that separates the three
  -- states (filled, published-null, key absent) is `jsonb_typeof`.
  PERFORM pg_temp.s4_eq('F5b and the previewed hole is a hole: the section is there, in its place, with its body published as JSON null rather than invented',
    (SELECT jsonb_build_object('key', q ->> 'section_key', 'required', q -> 'required',
                              'body_type', jsonb_typeof(q -> 'body'),
                              'heading', q -> 'heading' ->> 'text')
       FROM jsonb_array_elements(v_prev -> 'sections' -> 'items') q
      WHERE q ->> 'section_key' = 'blessing'),
    jsonb_build_object('key', 'blessing', 'required', true, 'body_type', 'null',
                       'heading', 'முடிப்பு'));
  PERFORM pg_temp.s4_eq('F5c and the section the host did write is the one carrying a body, so F5b is a measurement of that document and not a projection that never fills anything',
    (SELECT jsonb_build_object('key', q ->> 'section_key', 'source', q -> 'body' ->> 'source',
                              'text', q -> 'body' ->> 'text')
       FROM jsonb_array_elements(v_prev -> 'sections' -> 'items') q
      WHERE q ->> 'section_key' = 'opening'),
    jsonb_build_object('key', 'opening', 'source', 'host',
                       'text', 'Written by the host, in the host''s own words.'));

  SELECT count(*) INTO v_now_n FROM public.invitation_versions WHERE wedding_id = v_wed;
  PERFORM pg_temp.s4_eq('F6 and the refused freeze added no version, so a guest link cannot exist for a document nobody could resolve',
    v_now_n, v_prev_n);

  -- --------------------------------------------------------- an unsupported language, once
  PERFORM pg_temp.s4_eq('F7 a Malayalam wedding may select the same bilingual release, which is the gap between what a customer is allowed to point at and what will read well',
    pg_temp.s4_select(v_host, v_wed_ml, v_r2), 'no-error');
  v_err := pg_temp.s4_freeze_err(v_host, v_wed_ml);
  PERFORM pg_temp.s4_ok('F7b and the freeze refuses it by naming the language and the coverage it found (' || left(v_err, 150) || ')',
    v_err LIKE '23514%invitation language ml is not one of the languages this release covers (en, ta)%');

  PERFORM pg_temp.s4_eq('F7c with the host''s own welcome in place the language is the *only* cause, which is the difference between "fix the language" and a list of empty sections',
    private.invitation_freeze_issues(private.build_invitation_snapshot(v_wed_ml)),
    ARRAY['the invitation language ml is not one of the languages this release covers (en, ta)']);

  -- The distinguishing half, run one variable at a time. F7c reported a single cause; the
  -- question is whether the list enumerates or merely stops early. Emptying the host's
  -- words is the change a reader might expect to add a second cause — and it does not,
  -- because release 2 lets every text section fall back, so the host having nothing to say
  -- is not an unresolved *required* section. The release switch is the change that does,
  -- because release 3 holds a required English-only section that refuses the substitution
  -- in any language. Both measurements are in the ledger so neither result is inferred.
  PERFORM pg_temp.s4_write_draft(v_host, v_wed_ml, '{}'::jsonb);
  PERFORM pg_temp.s4_eq('F7d and losing the host''s words adds no cause on this release, because every text section in it may fall back — the checker reports what is unresolved, not what is empty',
    private.invitation_freeze_issues(private.build_invitation_snapshot(v_wed_ml)),
    ARRAY['the invitation language ml is not one of the languages this release covers (en, ta)']);

  PERFORM pg_temp.s4_eq('F7e the same wedding moving to release 3, the one with the unresolvable required section',
    pg_temp.s4_select(v_host, v_wed_ml, v_r3), 'no-error');
  v_issues := private.invitation_freeze_issues(private.build_invitation_snapshot(v_wed_ml));
  PERFORM pg_temp.s4_eq('F7f which reports both causes, named separately and countable — the list is a real enumeration, and F7c was not a truncation',
    v_issues,
    ARRAY['section blessing is required and has no wording in ml, and the release does not allow it to fall back',
          'the invitation language ml is not one of the languages this release covers (en, ta)']);

  v_err := pg_temp.s4_freeze_err(v_host, v_wed_ml);
  PERFORM pg_temp.s4_ok('F7g and the freeze on the two-cause document names both of them in its own sentence (' || left(v_err, 170) || ')',
    v_err LIKE '23514%section blessing is required and has no wording in ml%; the invitation language ml is not one of the languages this release covers (en, ta)%');

  PERFORM pg_temp.s4_eq('F7h back on release 2, with the host''s words still gone, the blessing cause disappears — so it belonged to the release, not to the language or the emptied draft',
    pg_temp.s4_select(v_host, v_wed_ml, v_r2), 'no-error');
  PERFORM pg_temp.s4_eq('F7i which leaves the single language cause exactly as F7c found it',
    private.invitation_freeze_issues(private.build_invitation_snapshot(v_wed_ml)),
    ARRAY['the invitation language ml is not one of the languages this release covers (en, ta)']);
  PERFORM pg_temp.s4_eq('F7j and the host''s own welcome comes back, because this group changed a fixture to make a point',
    pg_temp.s4_write_draft(v_host, v_wed_ml,
      jsonb_build_object('welcome', 'A host welcome written in English.')),
    'no-error');

  SELECT count(*) INTO v_now_n FROM public.invitation_versions WHERE wedding_id = v_wed_ml;
  PERFORM pg_temp.s4_eq('F7k none of the refusals froze anything', v_now_n, 0::bigint);

  -- ----------------------------------------------------------- a language nobody chose
  v_err := pg_temp.s4_freeze_err(v_host, v_wed_no);
  PERFORM pg_temp.s4_ok('F8 a wedding whose host has not chosen a language is refused before any document is resolved (' || left(v_err, 90) || ')',
    v_err LIKE '23514%choose the invitation language%');

  v_prev := pg_temp.s4_preview(v_host, v_wed_no);
  PERFORM pg_temp.s4_eq('F8b and the same wedding previews as a packless document that records the absence rather than guessing a language for it',
    jsonb_build_object('requested_is_null', (v_prev -> 'sections' ->> 'requested' IS NULL)::text,
                       'sections', jsonb_array_length(v_prev -> 'sections' -> 'items')),
    jsonb_build_object('requested_is_null', 'true', 'sections', 6));

  -- ------------------------------------------------------------------------ recovery
  v_err := pg_temp.s4_err('SET ROLE authenticated');
  PERFORM set_config('test.uid', v_host::text, false);
  v_err := pg_temp.s4_err('UPDATE public.weddings SET primary_language = ''ta'' WHERE id = '
                          || quote_literal(v_wed_no::text));
  PERFORM pg_temp.s4_err('RESET ROLE');
  PERFORM pg_temp.s4_eq('F9 the host choosing a language is the whole fix, through the owner''s own write (' || left(v_err, 60) || ')',
    v_err, 'no-error');
  v_err := pg_temp.s4_freeze_err(v_host, v_wed_no);
  PERFORM pg_temp.s4_eq('F9b and the freeze now succeeds, from the same wedding that was refused a moment ago',
    left(v_err, 12), 'no-error');
  PERFORM pg_temp.s4_eq('F9c with nothing left for the checker to say about it',
    private.invitation_freeze_issues(private.build_invitation_snapshot(v_wed_no)),
    '{}'::text[]);

  -- ------------------------------------------------------- the two defensive arms
  -- No writer can produce either document: the release guard refuses an unknown `kind` and
  -- an unimplemented contract version at the row. They are reachable only by handing the
  -- checker a snapshot directly — which is what the freeze does with whatever it is given,
  -- and the reason §O is written as a re-check rather than a trust in the writer.
  v_unnamed := jsonb_build_object(
    'sections', jsonb_build_object(
      'requested', NULL,
      'items', jsonb_build_array(jsonb_build_object(
        'section_key', 'blessing', 'position', 1, 'kind', 'text', 'required', true,
        'body_source', NULL))),
    'tradition_pack_release', jsonb_build_object(
      'languages', ARRAY['en', 'ta'], 'definition_schema_version', 1));

  -- Measured rather than assumed: the unknown kind is the *only* cause. The required-wording
  -- arm is scoped to `kind = 'text'`, so a section this build cannot render is refused for
  -- the reason the renderer actually has — not accompanied by an invented claim that its
  -- wording is missing.
  PERFORM pg_temp.s4_eq('F10 a document with a kind this build has no renderer for is refused by section and by kind, and by nothing else',
    private.invitation_freeze_issues(jsonb_set(v_unnamed,
      '{sections,items,0,kind}', '"photo_frame"')),
    ARRAY['section blessing claims kind photo_frame, which this build has no renderer for']);

  -- The first draft of the case above found both conditions folded into one arm, so a
  -- section with a perfectly renderable kind and an unusable position was reported as a
  -- kind the build does not know — a reason the host could not act on. The migration now
  -- states each rule with its own sentence; F10b/F10c hold that split.
  PERFORM pg_temp.s4_eq('F10b and a section with a renderable kind but a position that is not a number is refused for its position, not for a type it does not have',
    private.invitation_freeze_issues(jsonb_set(v_unnamed,
      '{sections,items,0,position}', '"first"')),
    ARRAY['section blessing has a position that is not a number, so this build cannot order it',
          'section blessing is required and has no wording in the chosen language, and the release does not allow it to fall back']);

  PERFORM pg_temp.s4_eq('F10c and a section that breaks both rules is reported as two separate causes, which is what lets a host tell an unrenderable section apart from an unordered one',
    private.invitation_freeze_issues(jsonb_set(jsonb_set(v_unnamed,
      '{sections,items,0,kind}', '"photo_frame"'),
      '{sections,items,0,position}', '"first"')),
    ARRAY['section blessing claims kind photo_frame, which this build has no renderer for',
          'section blessing has a position that is not a number, so this build cannot order it']);

  -- The same head-dependent literal as LC9x, on the checker side rather than the writer's:
  -- the version this build cannot interpret is 2 at the Stage 4 head and 3 at the Stage 5 one.
  -- The sentence is otherwise byte-identical, which is the point of the case.
  PERFORM pg_temp.s4_eq('F11 and a release whose definition contract this build cannot interpret says which version it found',
    private.invitation_freeze_issues(jsonb_set(v_unnamed,
      '{tradition_pack_release,definition_schema_version}',
      (CASE WHEN pg_temp.s4_at_least('stage5') THEN '3' ELSE '2' END)::jsonb)),
    ARRAY['section blessing is required and has no wording in the chosen language, and the release does not allow it to fall back',
          'this release''s definition uses contract version '
          || CASE WHEN pg_temp.s4_at_least('stage5') THEN '3' ELSE '2' END
          || ', which this build does not understand']);

  -- ------------------------------------------------------- an issue nobody can name
  -- The guard on the language arm, and the reason it is not decoration. `requested` is NULL
  -- for a wedding whose host has not chosen a language, so the arm's sentence would
  -- concatenate into NULL — and because `array_agg` keeps NULL elements (measured at F13a
  -- the same way the shipped function uses it), the list would grow an entry that
  -- `array_to_string` cannot print while `cardinality` still counts. The freeze would then
  -- refuse a document for a reason it could not state. The RPC refuses such a wedding
  -- earlier, so this is unreachable today; it is checked because a rule that only holds
  -- while its one caller behaves is not a rule.
  PERFORM pg_temp.s4_eq('F12 the shipped checker, handed a document with no requested language, reports one cause and reports it in words',
    private.invitation_freeze_issues(v_unnamed),
    ARRAY['section blessing is required and has no wording in the chosen language, and the release does not allow it to fall back']);

  PERFORM pg_temp.s4_eq('F12b and no element of that list is silent',
    (SELECT count(*) FROM unnest(private.invitation_freeze_issues(v_unnamed)) u(i)
      WHERE i IS NULL), 0::bigint);

  PERFORM pg_temp.s4_eq('F13a the aggregation the checker uses keeps a NULL input as an element of the array, which is what makes an unnameable issue countable',
    (SELECT cardinality(array_agg(x ORDER BY x)) FROM (VALUES ('a'), (NULL::text)) v(x)),
    2::integer);

  -- The list the guard prevents, built here from the same inputs and the same arm, so the
  -- comparison below is between two ways of writing one sentence rather than between a
  -- function and a hope.
  SELECT array_agg(i ORDER BY i) INTO v_unguarded FROM (
    SELECT 'section blessing is required and has no wording in '
           || coalesce(v_unnamed -> 'sections' ->> 'requested', 'the chosen language')
           || ', and the release does not allow it to fall back' AS i
    UNION ALL
    SELECT 'the invitation language '
           || (v_unnamed -> 'sections' ->> 'requested')
           || ' is not one of the languages this release covers' AS i
     WHERE jsonb_typeof(v_unnamed -> 'tradition_pack_release' -> 'languages') = 'array'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(
                         v_unnamed -> 'tradition_pack_release' -> 'languages') l
                        WHERE l = v_unnamed -> 'sections' ->> 'requested')
  ) q;

  PERFORM pg_temp.s4_eq('F13b and the same document without that guard yields a two-element list, the second of which is NULL',
    v_unguarded,
    ARRAY['section blessing is required and has no wording in the chosen language, and the release does not allow it to fall back',
          NULL]::text[]);

  PERFORM pg_temp.s4_eq('F13c which is precisely the failure the guard removes: the sentence a host would be shown names one cause, while the length the freeze tests names two',
    jsonb_build_object('printed', array_to_string(v_unguarded, '; '),
                       'counted', cardinality(v_unguarded),
                       'silent', (SELECT count(*) FROM unnest(v_unguarded) u(i)
                                   WHERE i IS NULL)),
    jsonb_build_object('printed',
      'section blessing is required and has no wording in the chosen language, '
      || 'and the release does not allow it to fall back',
      'counted', 2, 'silent', 1));

  -- The wedding this group pinned to an unresolvable release goes back to the release that
  -- fills it, so C and A inherit a document that freezes rather than one that refuses.
  PERFORM pg_temp.s4_eq('F14 and the Tamil wedding returns to release 2, whose wording its language can resolve',
    pg_temp.s4_select(v_host, v_wed, v_r2), 'no-error');
  v_err := pg_temp.s4_freeze_err(v_host, v_wed);
  PERFORM pg_temp.s4_eq('F14b which lets it freeze again — the refusal at F2 was about the document, not about the wedding being broken',
    left(v_err, 12), 'no-error');
  PERFORM pg_temp.s4_eq('F14c and release 3 stays approved and unreadable-by-nobody: retiring it was never needed to stop a freeze',
    (SELECT r.status || '|' || (SELECT count(*) FROM public.invitation_versions v
                                 WHERE v.tradition_pack_release_id = v_r3)::text
       FROM public.tradition_pack_releases r WHERE r.id = v_r3),
    'approved|0');
END $F$;

-- ===========================================================================
-- C. WHAT A STRANGER'S BROWSER IS ACTUALLY SENT
-- ===========================================================================
-- §4 and §11's second sentence: the public invitation must be reproducible from the
-- frozen snapshot alone, and everything the platform knows *about* the pack — who
-- labelled it reviewed, which languages a reviewer claims to have read, what the source
-- reference was, whether a model drafted it — has to stay out of the guest document.
--
-- This is the group that makes "stays out" a statement about a closed set rather than a
-- list of things somebody remembered to remove. Two directions are measured:
--
--   * forward — the guest document's whole universe of key names, at every depth, is
--     exactly a fixed list. A field cannot reach a guest by being added to the projection
--     and forgotten here; the assertion fails and names the intruder.
--   * backward — the same version's own snapshot is dumped the same way, and *does* carry
--     the review vocabulary. Without that pair the forward test would be satisfied by a
--     projection that published nothing at all, which is the vacuous pass the header of
--     this file warns about.
--
-- Values are walked as well as names, because an identifier is a leak whatever key it
-- sits under, and §4 forbids exposing reviewer identity "merely because provenance
-- exists internally".

-- Every scalar value at every depth, the companion to `s4_all_keys`. Written for this
-- group's uuid scan; the whitelist alone cannot see a uuid sitting inside a string.
CREATE FUNCTION pg_temp.s4_vals(v jsonb) RETURNS TABLE(val text)
LANGUAGE plpgsql AS $fn$
DECLARE r record;
BEGIN
  IF jsonb_typeof(v) = 'object' THEN
    FOR r IN SELECT jsonb_object_keys(v) AS key LOOP
      RETURN QUERY SELECT * FROM pg_temp.s4_vals(v -> r.key);
    END LOOP;
  ELSIF jsonb_typeof(v) = 'array' THEN
    RETURN QUERY
      SELECT q.val FROM jsonb_array_elements(v) AS e(j)
                 JOIN LATERAL pg_temp.s4_vals(e.j) q ON true;
  ELSIF jsonb_typeof(v) IN ('string', 'number', 'boolean') THEN
    val := v #>> '{}';
    RETURN NEXT;
  END IF;
END $fn$;

DO $C$
DECLARE
  v_host    uuid;
  v_wed     uuid;
  v_wed_no  uuid;
  v_ver     uuid;
  v_ver_no  uuid;
  v_dto     jsonb;
  v_dto_np  jsonb;
  v_snap    jsonb;
  v_v1      jsonb;
  v_bad     jsonb;
  v_err     text;
  v_ok      text[];
  v_banned  text[];
  v_src     text;
  v_ctl     text;
  v_nvals   bigint;
BEGIN
  PERFORM pg_temp.s4_is_superuser('C0 the guest-document group reads as the maintenance role so it can hold the snapshot and the projection side by side');
  SELECT host_a, wed, wed_none INTO v_host, v_wed, v_wed_no FROM sf;

  -- The document under test is one the host's own freeze produced. Nothing in this group
  -- is measured against a hand-written JSON shape: the projection is only interesting for
  -- what the freeze actually stores.
  v_err := pg_temp.s4_freeze_err(v_host, v_wed);
  PERFORM pg_temp.s4_eq('C1 the subject is a version the freeze accepted, so every refusal below is about the projection and not about a broken document',
    left(v_err, 12), 'no-error');
  SELECT id, snapshot INTO v_ver, v_snap FROM public.invitation_versions
   WHERE wedding_id = v_wed ORDER BY version_number DESC LIMIT 1;
  v_dto := pg_temp.s4_dto(v_ver);

  -- ------------------------------------------------------------- the closed set of names
  v_ok := ARRAY[
    'additional', 'address_text', 'alignment', 'body', 'closing', 'color',
    'design_template', 'display_name', 'ends_at_local', 'event_key', 'event_notes',
    'events', 'fallback_used', 'family_introduction', 'font', 'fontSize', 'group_key',
    'group_label', 'heading', 'host_field', 'items', 'kind', 'language', 'map_url',
    'name', 'overrode_pack_text', 'pack_key', 'people', 'position', 'primary',
    'release_number', 'requested', 'required', 'revision', 'role_key', 'role_label',
    'section_key', 'sections', 'source', 'starts_at_local', 'style', 'template_key',
    'text', 'timezone', 'title', 'tradition_pack', 'venue', 'welcome'];
  PERFORM pg_temp.s4_eq('C1b the whitelist this file holds is the 48 names it measured, so the count is stated before the comparison',
    cardinality(v_ok), 48::integer);

  PERFORM pg_temp.s4_universe('C2 a guest document may contain these 48 names at any depth and no others — anything the projection grows without this file learning is a leak this battery refuses',
    v_dto, v_ok);

  -- A second document, produced by a different path: no pack at all, so no credit block,
  -- no provenance and no fallback facts. The whitelist has to bound it too, otherwise C2
  -- is a photograph of one fixture rather than a rule.
  SELECT id INTO v_ver_no FROM public.invitation_versions
   WHERE wedding_id = v_wed_no ORDER BY version_number DESC LIMIT 1;
  v_dto_np := pg_temp.s4_dto(v_ver_no);
  PERFORM pg_temp.s4_ok('C3 the packless guest document is inside the same 48 names ('
                          || cardinality(pg_temp.s4_all_keys(v_dto_np)) || ' of them, since it has no release to credit)',
    pg_temp.s4_all_keys(v_dto_np) <@ v_ok);
  PERFORM pg_temp.s4_ok('C3b and it really is a different document — fewer names, with the credit block published as an explicit absence',
    cardinality(pg_temp.s4_all_keys(v_dto_np)) < cardinality(pg_temp.s4_all_keys(v_dto))
      AND (v_dto_np -> 'tradition_pack')::text = 'null'
      AND (v_dto -> 'tradition_pack')::text <> 'null');

  -- ------------------------------------------------------------- the names that must never
  -- appear, grouped by what they are:
  v_banned := ARRAY[
    -- identifiers of any kind
    'id', 'pack_id', 'wedding_id', 'tradition_pack_release_id', 'host_user_id',
    'user_id', 'created_by', 'snapshot_schema_version',
    -- the governance record of the release
    'status', 'definition', 'definition_schema_version', 'languages', 'changelog',
    'content_hash', 'created_at', 'updated_at', 'reviewed_at', 'approved_at',
    'deprecated_at',
    -- §4: reviewer qualification, internal notes, source internals, machine prompting
    'author_label', 'review_label', 'reviewed_languages', 'machine_assisted',
    'machine_assistance_notes', 'source_reference', 'scope_statement', 'notes',
    'internal_notes', 'rejection_reason', 'prompt', 'model', 'ai_prompt',
    'generation_notes',
    -- §12: the provenance fields are the platform's vocabulary for the host's own view of
    -- their invitation, not part of a stranger's payload
    'body_text', 'body_source', 'body_language', 'body_fallback_used', 'heading_text',
    'heading_language', 'heading_fallback_used',
    -- the frozen inputs the projection flattens rather than forwards
    'draft', 'snapshot', 'wedding', 'style_settings', 'layout_settings',
    'primary_language', 'additional_languages',
    -- §P: nothing in the guest document is a slot for an inherited identity
    'religion', 'religious', 'caste', 'jati', 'gotra', 'biradari', 'community',
    'sect', 'sampradaya', 'surname', 'lineage', 'pedigree', 'family_tree',
    'temple', 'church', 'mosque', 'gurudwara', 'deity', 'priest', 'pandit',
    'purohit', 'muhurat', 'rahu', 'zodiac', 'astrolog', 'auspicious'];

  PERFORM pg_temp.s4_no_forbidden('C4 none of the governance, reviewer, machine-prompting or inherited-identity vocabulary appears anywhere in the guest document',
    v_dto, v_banned);
  PERFORM pg_temp.s4_no_forbidden('C4b and the same is true of the packless document, so C4 is not a property of one fixture',
    v_dto_np, v_banned);

  -- The backward half: the same version's snapshot, walked the same way, carries the
  -- vocabulary C4 just refused. This is what turns C4 from "the projection is empty" into
  -- "the projection removed them".
  PERFORM pg_temp.s4_eq('C5 the release block of the frozen snapshot is the eleven names the review record actually is',
    (SELECT jsonb_agg(k ORDER BY k) FROM (
       SELECT jsonb_object_keys(v_snap -> 'tradition_pack_release') k) q),
    jsonb_build_array('author_label', 'definition_schema_version', 'display_name',
                      'languages', 'machine_assisted', 'pack_key', 'release_number',
                      'review_label', 'reviewed_languages', 'scope_statement',
                      'source_reference'));
  PERFORM pg_temp.s4_eq('C5b and the guest credit block keeps exactly the three a stranger needs: which pack, which release, displayed how',
    (SELECT jsonb_agg(k ORDER BY k) FROM (
       SELECT jsonb_object_keys(v_dto -> 'tradition_pack') k) q),
    jsonb_build_array('display_name', 'pack_key', 'release_number'));
  PERFORM pg_temp.s4_ok('C5c so C4 measured a projection that had every one of those names available and dropped them, not a document that never had them',
    (v_snap ? 'tradition_pack_release')
      AND (v_snap -> 'tradition_pack_release' ? 'author_label')
      AND (v_snap -> 'tradition_pack_release' ? 'review_label')
      AND (v_snap -> 'tradition_pack_release' ? 'reviewed_languages')
      AND (v_snap -> 'tradition_pack_release' ? 'machine_assisted')
      AND (v_snap -> 'tradition_pack_release' ? 'source_reference')
      AND (v_snap -> 'tradition_pack_release' ? 'scope_statement')
      AND (v_snap ? 'draft'));

  -- ---------------------------------------------------------------- values, not just names
  v_nvals := (SELECT count(*) FROM pg_temp.s4_vals(v_dto));
  PERFORM pg_temp.s4_ok('C6 the value walk looked at a real document (' || v_nvals::text || ' scalar values at every depth), so the scan below is not counting an empty set',
    v_nvals > 50);
  PERFORM pg_temp.s4_eq('C6b and no value in the guest document is an identifier — a uuid does not become safe by being stored inside a string',
    (SELECT coalesce(jsonb_agg(DISTINCT q.val), '[]'::jsonb) FROM pg_temp.s4_vals(v_dto) q
      WHERE q.val ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
    '[]'::jsonb);
  PERFORM pg_temp.s4_eq('C6c nor is the version row''s own id hiding under a friendly key name',
    (SELECT count(*) FROM pg_temp.s4_vals(v_dto) q WHERE q.val = v_ver::text), 0::bigint);

  -- ------------------------------------------------------- the host field whitelist, both ways
  -- Measured, not assumed: an unknown `host_field` in a snapshot does not simply lose its
  -- name — the section's wording goes with it, because the projection reaches the draft
  -- *through* that name. So a patched snapshot cannot be used to point a guest at a column
  -- the projection has not agreed to publish, and it cannot leak the name either.
  PERFORM pg_temp.s4_eq('C7 the control: this section''s wording reaches the guest because the snapshot names the one draft field the projection knows',
    (v_dto -> 'sections' -> 'items' -> 1 -> 'host_field')::text
      || '|' || (v_dto -> 'sections' -> 'items' -> 1 -> 'body' ->> 'source'),
    '"welcome"|host');
  v_bad := jsonb_set(v_snap, '{sections,items,1,host_field}', '"secret_internal_column"');
  PERFORM pg_temp.s4_eq('C7b and a snapshot claiming a field outside those four publishes no name for it',
    (private.public_invitation_dto(2, v_bad)
       -> 'sections' -> 'items' -> 1 -> 'host_field')::text,
    'null');
  PERFORM pg_temp.s4_ok('C7c and no wording is published through the unrecognised name either, while the host''s own welcome still reaches the guest under its real field',
    (SELECT count(*) FROM pg_temp.s4_vals(private.public_invitation_dto(2, v_bad)) q
      WHERE q.val LIKE '%secret_internal%') = 0
      AND private.public_invitation_dto(2, v_bad) ->> 'welcome'
          = 'Written by the host, in the host''s own words.');

  -- ------------------------------------------------------------ the provenance vocabulary
  -- A third value is not published because it is not in the two-name vocabulary, rather
  -- than because somebody filtered the word out.
  PERFORM pg_temp.s4_eq('C8 the control: reviewed_pack wording is published, with its source stated',
    (v_dto -> 'sections' -> 'items' -> 4 -> 'body' ->> 'source')
      || '|' || coalesce(v_dto -> 'sections' -> 'items' -> 4 -> 'body' ->> 'text', '-'),
    'reviewed_pack|Wording B, as the second release rewrote the note.');
  PERFORM pg_temp.s4_eq('C8b and a body claiming a source this build does not know is published as an absence rather than as a claim about where the words came from',
    (private.public_invitation_dto(2,
       jsonb_set(v_snap, '{sections,items,4,body_source}', '"ai_generated"'))
       -> 'sections' -> 'items' -> 4 -> 'body')::text,
    'null');

  -- ----------------------------------------------------- all-or-nothing, split in two
  -- This case read "any unknown kind takes the whole document down" until directive §24 put
  -- the question the way a customer would ask it: *what happens to an invitation frozen by a
  -- future build when today's app reads it?* Refusing the document answers it with a blank
  -- page, which is the crash §24 names. So the projection now splits on the one field that
  -- distinguishes the two situations — whether the frozen document promised the section — and
  -- the pair below holds the split. The original shape is left described here rather than
  -- rewritten out of history: it was a defensible rule, it was wrong about optional sections,
  -- and a guest who was promised a paragraph must still get a refusal rather than a silent gap.
  --
  -- Neither arm is reachable from this build's own API: the release guard refuses an unknown
  -- `kind` when a definition is written and the freeze (group F) re-checks it, which is why
  -- C9b still expects the checker to name the document. The projection is the *reader* half of
  -- the answer, and the reader is the half that has to survive the writer changing.
  v_bad := jsonb_set(jsonb_set(v_snap, '{sections,items,2,kind}', '"photo_frame"'),
                     '{sections,items,2,required}', 'true');
  PERFORM pg_temp.s4_eq('C9 an unknown kind the document marks REQUIRED still takes the whole guest document down: a promised paragraph with no renderer is not something a guest should be shown a gap for',
    (private.public_invitation_dto(2, v_bad) IS NULL)::text, 'true');
  PERFORM pg_temp.s4_eq('C9b and the freeze checker names that same document before it could ever be stored, so the refusal is a second gate and not the only one',
    private.invitation_freeze_issues(v_bad),
    ARRAY['section family claims kind photo_frame, which this build has no renderer for']);

  v_bad := jsonb_set(v_bad, '{sections,items,2,required}', 'false');
  PERFORM pg_temp.s4_eq('C9c an unknown kind that is OPTIONAL leaves the document available — §24: a historical publication must not blank because today''s app has no renderer for somebody else''s future section',
    (private.public_invitation_dto(2, v_bad) IS NOT NULL)::text, 'true');
  PERFORM pg_temp.s4_eq('C9d and the unrecognised section is carried as the three facts this build can verify about it, with no heading and no body: nothing is invented for a section nobody recognised',
    (private.public_invitation_dto(2, v_bad) -> 'sections' -> 'items' -> 2)::text,
    (jsonb_build_object('section_key', v_snap -> 'sections' -> 'items' -> 2 -> 'section_key',
                        'position', v_snap -> 'sections' -> 'items' -> 2 -> 'position',
                        'kind', 'photo_frame', 'required', false,
                        'host_field', NULL, 'heading', NULL, 'body', NULL))::text);
  PERFORM pg_temp.s4_eq('C9e and the known sections around it still project, in the frozen order, which is what makes C9c a surviving document rather than an empty one',
    (SELECT count(*) FROM jsonb_array_elements(
        private.public_invitation_dto(2, v_bad) -> 'sections' -> 'items'))::text,
    (SELECT count(*) FROM jsonb_array_elements(
        v_snap -> 'sections' -> 'items'))::text);
  PERFORM pg_temp.s4_eq('C9f and the section order is the frozen one, not the order a sorted scan happened to produce',
    (SELECT string_agg(i ->> 'section_key', ',' ORDER BY ord)
       FROM jsonb_array_elements(
             private.public_invitation_dto(2, v_bad) -> 'sections' -> 'items')
            WITH ORDINALITY AS e(i, ord)),
    (SELECT string_agg(i ->> 'section_key', ',' ORDER BY ord)
       FROM jsonb_array_elements(v_snap -> 'sections' -> 'items')
            WITH ORDINALITY AS e(i, ord)));

  v_bad := jsonb_set(v_snap, '{sections,items,2}',
    ('{"section_key": "orphan", "kind": "text", "required": false, "body_source": "reviewed_pack",'
     || ' "heading_text": "X", "heading_language": "en"}')::jsonb);
  PERFORM pg_temp.s4_eq('C10 and a section with no position at all is refused by the projection as well',
    (private.public_invitation_dto(2, v_bad) IS NULL)::text, 'true');
  PERFORM pg_temp.s4_eq('C10b and stated as a fault the host can read: the checker no longer drops a NULL comparison and reports nothing for a document it cannot order',
    private.invitation_freeze_issues(v_bad),
    ARRAY['section orphan has a position that is not a number, so this build cannot order it']);

  PERFORM pg_temp.s4_ok('C11 a document of a shape this build does not have is unavailable rather than partially rendered — version, missing block, and a NULL document all refuse',
    private.public_invitation_dto(1, v_snap) IS NULL
      AND private.public_invitation_dto(3, v_snap) IS NULL
      AND private.public_invitation_dto(2, v_snap - 'wedding') IS NULL
      AND private.public_invitation_dto(2, v_snap - 'draft') IS NULL
      AND private.public_invitation_dto(2, v_snap - 'people') IS NULL
      AND private.public_invitation_dto(2, v_snap - 'events') IS NULL
      AND private.public_invitation_dto(2, v_snap - 'sections') IS NULL
      AND private.public_invitation_dto(2, NULL) IS NULL);
  PERFORM pg_temp.s4_eq('C11b and the unpatched document still projects, which is what makes every refusal above a measurement rather than a function that returns NULL for everything',
    (private.public_invitation_dto(2, v_snap) IS NOT NULL)::text, 'true');

  -- C11 refused a *version number* attached to this build's own bytes. The case that
  -- matters to a customer is the other one: a version this repository's Stage 3 build
  -- actually froze, whose stored `snapshot_schema_version` reads 1 and whose body has no
  -- `sections` block, because Stage 3 wrote none. Those bytes below are transcribed from
  -- `private.build_invitation_snapshot` as committed in
  -- `20260926130000_stage3_publication_resolution_boundary.sql:284-366` — the six blocks
  -- that function selected, in that shape — and both reasons for the refusal are stated
  -- rather than one, because the pair is what tells a reader which gate they are standing
  -- at: a Stage 3 document is unavailable to this build by version, and it would still be
  -- unavailable if the version were relabelled, because the projection needs a section
  -- list Stage 3 never wrote.
  --
  -- What this case is NOT, and is here so nobody reads it as more: both chains of this
  -- battery apply every migration before they freeze anything, so no row frozen by the
  -- Stage 3 build exists in either database to be re-read. The consequence for a real
  -- pre-Stage-4 link is therefore measured at the projection, not through the guest door.
  --
  -- The pointer that used to sit in this paragraph claimed Stage 4's audit "states it as a
  -- disclosed gap". It does not: `grep` for `disclosed gap` across
  -- `docs/audits/stage-4-tradition-pack-foundation.md` returns no line, and the other
  -- searches a reader would try (`Stage 3 snapshot`, `pre-Stage-4`) return none either. The
  -- wording is corrected rather than deleted because the *behaviour* the paragraph describes
  -- is real and is now written down where it can be found — Stage 5's audit, §20.4, which
  -- adds the consequence a reader needs: a guest link pinned to a pre-Stage-4 version
  -- reaches the *unavailable* state, not the document, and whether any such row exists is a
  -- deployment question this repository has never been able to answer.
  --
  -- The concatenation is parenthesised because `::` binds tighter than `||`: written
  -- without them Postgres casts only the final fragment, and the run measured exactly that
  -- as `invalid input syntax for type json … Expected end of input, but found ":"`.
  v_v1 := ('{"wedding":{"title":"Arun weds Deepa","primary_language":"ta",'
    || '"additional_languages":["en"],"style_settings":{"font":"Noto Sans Tamil",'
    || '"fontSize":"26","color":"#6b1e2a","alignment":"center"}},'
    || '"design_template":{"template_key":"maroon-gold","revision":1,'
    || '"display_name":"Maroon and Gold","layout_settings":{},"supported_languages":["ta","en"]},'
    || '"tradition_pack":{"pack_key":"tamil-generic","revision":2,"display_name":"Tamil wedding patrika",'
    || '"structure":{},"supported_languages":["ta","en"]},'
    || '"people":[{"display_name":"Arun Kumar","role_key":"groom","role_label":"Groom",'
    || '"group_key":"groom_family","group_label":"Family of the groom"}],'
    || '"events":[{"event_key":"ceremony_muhurtham","display_name":"The wedding",'
    || '"starts_at_local":"2026-11-14T07:30:00","ends_at_local":null,"timezone":"Asia/Kolkata",'
    || '"venue":{"name":"Sri Kanchi Mahal","address_text":"1 Maktal Road","map_url":"https://maps.example/x"}}],'
    || '"draft":{"welcome":"With the blessings of our elders","family_introduction":null,'
    || '"event_notes":null,"closing":"With love"}}')::jsonb;

  PERFORM pg_temp.s4_ok('C11c a document in the shape this repository''s own Stage 3 build froze is unavailable to this build, by version and by the missing section list, and not half-rendered',
    private.public_invitation_dto(1, v_v1) IS NULL
      AND private.public_invitation_dto(2, v_v1) IS NULL);
  PERFORM pg_temp.s4_ok('C11d and the copy is a real document rather than a strawman: every block an older build wrote is present and typed, so the refusals above name the gate and not the prose',
    jsonb_typeof(v_v1 -> 'wedding') = 'object'
      AND jsonb_typeof(v_v1 -> 'draft') = 'object'
      AND jsonb_typeof(v_v1 -> 'people') = 'array'
      AND jsonb_typeof(v_v1 -> 'events') = 'array'
      AND NOT (v_v1 ? 'sections')
      AND (v_v1 -> 'wedding' ->> 'title') = 'Arun weds Deepa');

  -- ------------------------------------------------------------- reproducible from the snapshot
  -- §11's sentence: "the public invitation must be reproducible from
  -- `invitation_versions.snapshot` alone", and "do not make the guest resolver query
  -- `tradition_pack_releases`". The structural form of that claim is the projection's own
  -- source: with comments stripped, it names no relation at all, so the only thing it can
  -- read is the JSON it was handed. The scan is run against a function that genuinely does
  -- read the tables first, because a pattern that matches nothing anywhere would also
  -- "prove" this one.
  SELECT pg_temp.s4_code_only(prosrc) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'private' AND p.proname = 'public_invitation_dto';
  SELECT pg_temp.s4_code_only(prosrc) INTO v_ctl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'internal_api' AND p.proname = 'create_invitation_version';

  PERFORM pg_temp.s4_ok('C12 the scan works before it is trusted: the freeze wrapper''s own code, stripped of comments, names the relations it reads',
    v_ctl ~ 'public\.[a-z_]+'
      AND v_ctl ~ 'invitation_versions|weddings|invitation_drafts|tradition_pack_releases');

  PERFORM pg_temp.s4_eq('C12b and the guest projection reads nothing: no relation name appears in its code at all, which is the structural form of "reproducible from the snapshot alone"',
    jsonb_build_object(
      'qualified', (SELECT count(*)::text FROM regexp_matches(v_src, 'public\.[a-z_]+', 'g')),
      'catalogue', (SELECT count(*)::text FROM regexp_matches(
                      v_src,
                      'tradition_pack_releases|tradition_packs|invitation_versions|invitation_drafts|weddings',
                      'g'))),
    jsonb_build_object('qualified', '0', 'catalogue', '0'));

  -- A different kind of leak than a key name: a value that *claims* somebody read this
  -- wording. §7 and the directive's prohibition on fabricated human review make this a
  -- property of the guest document itself, so it is scanned rather than assumed from the
  -- key whitelist.
  PERFORM pg_temp.s4_eq('C13 no value in the guest document claims a human, cultural or linguistic reading of the wording',
    coalesce((SELECT jsonb_agg(DISTINCT q.val) FROM pg_temp.s4_vals(v_dto) q
      WHERE q.val ~* '(reviewed by|human review|native speaker|cultural authority|religious authority|approved by)'),
      '[]'::jsonb),
    '[]'::jsonb);
  PERFORM pg_temp.s4_ok('C13b and the snapshot of the same version does carry review vocabulary in its values, so C13 measured a projection that dropped them rather than a document that never had any',
    (SELECT count(*) FROM pg_temp.s4_vals(v_snap) q WHERE q.val ~* 'TEST ONLY|REVIEW') > 0);
END $C$;

-- ===========================================================================
-- A. THE TWO GATES, AND WHO MAY SEE A RELEASE AT ALL
-- ===========================================================================
-- §4, §5, and the half of ruling A3 that no earlier group in this file could state.
--
-- Everything above this point is a write-side or document-side measurement: `20_attacks.sql`
-- proved that a customer cannot promote, forge, edit, delete or select a release, and P/S/B/V/F/C
-- proved what a frozen document does with the release it pins. None of that answers the
-- question §4 asks, which is a *read* question: when a release exists but has not been
-- approved, does anybody with an account find out that it exists at all?
--
-- §5's warning is the reason this group is shaped the way it is: "grants and RLS are
-- separate gates. Set both deliberately." A suite that only runs a SELECT and counts rows
-- cannot tell those two gates apart, because both answer "no rows" — one by refusing the
-- statement, the other by filtering it. So the group is built as four distinct measurements:
--
--   1. the grants gate, as an outcome (`refused-by-grants`, never an empty set), for the
--      anonymous web and for every column §4 names;
--   2. the policy inventory, because "the policy is right" is not the same claim as "there
--      is only one policy, and it is the one that was written here";
--   3. the row-policy gate, as a *closed set* over this battery's own rows — including
--      ruling A3's second arm, a pack whose only release was retired without ever being
--      chosen, which a pack-level "has an approved release" rule cannot express on its own;
--   4. the historical case from ruling A1, built through the product's own steps and with a
--      holder this file has never used before, so that "a deprecated release stays readable
--      *by the customer who holds it*" is measured as an owner-scoped fact rather than as a
--      global widening that would also leak it to everyone else.
--
-- `invitation_versions` is deliberately not re-measured here. Stage 3 qualified the anon path
-- to that table and `20_attacks.sql` qualified writes to the catalogue; repeating either would
-- add a number to this suite without adding a fact.

-- The visibility helpers above return the whole catalogue, which is correct for a membership
-- assertion and wrong for an exact-set one: on the real chain `20_attacks.sql` has seeded
-- releases of its own before this file runs, so an equality assertion on "every release this
-- customer can read" would be a test of fixture order. These two are the same instruments
-- filtered to the keys this battery owns, which makes the exact sets below both meaningful and
-- independent of the chain.
CREATE FUNCTION pg_temp.s4_my_packs(p_uid uuid) RETURNS text[]
LANGUAGE plpgsql AS $fn$
DECLARE v_keys text[];
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_uid::text, false);
  SELECT coalesce(array_agg(q.k ORDER BY q.k COLLATE "C"), '{}'::text[]) INTO v_keys
    FROM (SELECT p.pack_key AS k FROM public.tradition_packs p
           WHERE p.pack_key LIKE 'stage4\_doc%') q;
  EXECUTE 'RESET ROLE';
  RETURN v_keys;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RETURN ARRAY['error: ' || SQLSTATE || ' ' || SQLERRM];
END $fn$;

CREATE FUNCTION pg_temp.s4_my_releases(p_uid uuid) RETURNS text[]
LANGUAGE plpgsql AS $fn$
DECLARE v_rows text[];
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_uid::text, false);
  SELECT coalesce(array_agg(q.row_key ORDER BY q.row_key COLLATE "C"), '{}'::text[]) INTO v_rows
    FROM (SELECT p.pack_key || '/' || r.release_number || '=' || r.status AS row_key
            FROM public.tradition_pack_releases r
            JOIN public.tradition_packs p ON p.id = r.pack_id
           WHERE p.pack_key LIKE 'stage4\_doc%') q;
  EXECUTE 'RESET ROLE';
  RETURN v_rows;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RETURN ARRAY['error: ' || SQLSTATE || ' ' || SQLERRM];
END $fn$;

-- The columns §4 lists as internal, in one place so A2, A2b and A2c cannot drift into checking
-- different lists: the review record, the authorship record, the machine-assistance
-- disclosure, the source reference and the changelog, plus the three lifecycle timestamps.
-- `definition` and `definition_schema_version` are deliberately NOT in this list: §9's column
-- grant hands both to `authenticated`, because the reviewed wording is the product a host
-- chooses and a build has to be able to name a contract it cannot resolve. A list that called
-- them internal would be a list of what an earlier draft of this stage believed, not of what
-- the shipped grant does.
CREATE FUNCTION pg_temp.s4_internal_cols() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ARRAY['review_label', 'review_basis', 'review_scope', 'reviewed_by',
               'reviewed_languages', 'reviewed_at', 'approved_at', 'deprecated_at',
               'author_label', 'machine_assisted', 'machine_assistance_notes',
               'source_reference', 'changelog'] $fn$;

-- ... and the seven names that same grant does hand out. The withheld list alone would still
-- pass if a convenience grant widened the projection, so the opened side is named too.
CREATE FUNCTION pg_temp.s4_customer_cols() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ARRAY['id', 'pack_id', 'release_number', 'status', 'languages',
               'definition', 'definition_schema_version'] $fn$;

DO $A$
DECLARE
  v_host_a   uuid;
  v_host_b   uuid;
  v_rel_3    uuid;
  v_wed_b    uuid := gen_random_uuid();
  v_style    text := '{"font":"Mukta Malar","fontSize":"20","color":"#7A1F1F","alignment":"left"}';
  v_rels_a   text[];
  v_rels_b   text[];
  v_packs_a  text[];
  v_packs_b  text[];
  v_err      text;
  v_before   text;
  v_after    text;
  v_bad      text;
  v_n        bigint;
  v_n_txt    text;
BEGIN
  PERFORM pg_temp.s4_is_superuser('A0 the visibility group starts as the maintenance role, so a leaked SET ROLE cannot be silently read as a customer result');

  SELECT host_a, host_b, rel_3 INTO v_host_a, v_host_b, v_rel_3 FROM sf;

  -- ------------------------------------------------ 1. the grants gate, as an outcome
  PERFORM pg_temp.s4_eq('A1 the anonymous web is refused at the grants gate on the release table — and refused, which is a different fact from an empty result, because the empty result is what the row policy would answer',
    pg_temp.s4_read_gate('anon', 'tradition_pack_releases'), 'refused-by-grants');
  PERFORM pg_temp.s4_eq('A1b and on the pack-concept table, so a stranger cannot even enumerate a tradition that has not shipped',
    pg_temp.s4_read_gate('anon', 'tradition_packs'), 'refused-by-grants');

  -- The control §Q asks for, on the instrument rather than on the schema: the same
  -- statement through the same helper, one role over, must *not* answer 'refused'. Without
  -- it A1 would be satisfied by a helper that returns 'refused-by-grants' for every role.
  PERFORM pg_temp.s4_ok('A1c and the control: the identical statement as `authenticated` is not refused, so A1 measured the grants gate rather than a query that cannot execute — '
    || pg_temp.s4_read_gate('authenticated', 'tradition_pack_releases'),
    pg_temp.s4_read_gate('authenticated', 'tradition_pack_releases') <> 'refused-by-grants');

  -- Column by column, because §4 does not forbid "the table", it forbids six specific
  -- things. A table-level refusal implies them; measuring them by name is what makes the
  -- claim survive someone later adding a column grant for convenience.
  SELECT coalesce(string_agg(q.c, ', ' ORDER BY q.c), '(none)') INTO v_bad
    FROM unnest(pg_temp.s4_internal_cols()) q(c)
   WHERE has_column_privilege('anon', 'public.tradition_pack_releases', q.c, 'SELECT');
  PERFORM pg_temp.s4_eq('A2 none of the internals §4 names is reachable by the anonymous web even through a column-level grant — reviewer identity, review scope and basis, machine disclosure, source reference, the definition and its contract version',
    v_bad, '(none)');

  -- ... and the same thirteen names ARE reachable by the identity that maintains the
  -- catalogue, which is what turns A2 from "those columns do not exist" (has_column_privilege
  -- raises on a misspelt name, so this is also the sanity check on the list) into a
  -- measurement of the gate.
  SELECT count(*) INTO v_n FROM unnest(pg_temp.s4_internal_cols()) q(c)
   WHERE has_column_privilege('service_role', 'public.tradition_pack_releases', q.c, 'SELECT');
  PERFORM pg_temp.s4_eq('A2b and the control: all thirteen columns exist and the content-maintenance role holds the column privilege on every one of them, so A2 is a grants measurement and not a typo',
    v_n, 13::bigint);

  -- The customer role measured on the same thirteen names. A2 alone would also be satisfied by
  -- a role that cannot read the table at all, which is a different fact from a narrow
  -- projection; A2c says an account that *can* read this table still cannot read these.
  SELECT coalesce(string_agg(q.c, ', ' ORDER BY q.c), '(none)') INTO v_bad
    FROM unnest(pg_temp.s4_internal_cols()) q(c)
   WHERE has_column_privilege('authenticated', 'public.tradition_pack_releases', q.c, 'SELECT');
  PERFORM pg_temp.s4_eq('A2c a signed-in host, who can read the catalogue, cannot read any of the thirteen either — the reviewer''s identity and qualification, the machine-assistance disclosure, the source reference, the changelog and the lifecycle timestamps are not columns a browser can name',
    v_bad, '(none)');

  -- The opened side, read from the catalogue rather than from this file's expectations, so a
  -- column added later and granted for convenience shows up here instead of in a customer's
  -- JSON. This is the assertion that makes §9's "the subset they genuinely need" a set
  -- equality and not a list of complaints about the other half.
  SELECT coalesce(string_agg(q.attname, ', ' ORDER BY q.attname), '(none)') INTO v_bad
    FROM pg_attribute q
    JOIN pg_class c ON c.oid = q.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'tradition_pack_releases'
     AND q.attnum > 0 AND NOT q.attisdropped
     AND has_column_privilege('authenticated', 'public.tradition_pack_releases', q.attname, 'SELECT');
  PERFORM pg_temp.s4_eq('A2d and exactly these seven, no more, are readable by a customer: the release''s name, its number, the status the gates read, the language coverage, the reviewed wording and the contract version it claims',
    v_bad, 'definition, definition_schema_version, id, languages, pack_id, release_number, status');

  -- The deliberate shape of the grants, role by role, stated once as a table rather than
  -- implied by three separate refusals. `authenticated` holds no *table*-level SELECT at all —
  -- under a column grant `has_table_privilege` is false even though the seven columns above
  -- read fine, which is the point of the narrowing, and A2c/A2d are where the customer's
  -- read path is actually measured. `service_role` is the content-maintenance identity this
  -- migration's comments name, and the browser never holds it (Stage 3's §6/§9 qualified that
  -- at the API surface).
  PERFORM pg_temp.s4_jq('A3 the grants are set deliberately on both sides: anon has no SELECT, authenticated has no table-level SELECT and no write path (its read path is the column projection A2c and A2d measure), and the maintenance role keeps the write path the lifecycle triggers run under',
    (SELECT jsonb_build_object(
              'anon_select',     has_table_privilege('anon', 'public.tradition_pack_releases', 'SELECT'),
              'auth_select',     has_table_privilege('authenticated', 'public.tradition_pack_releases', 'SELECT'),
              'auth_write',      has_table_privilege('authenticated', 'public.tradition_pack_releases', 'INSERT')
                                 OR has_table_privilege('authenticated', 'public.tradition_pack_releases', 'UPDATE')
                                 OR has_table_privilege('authenticated', 'public.tradition_pack_releases', 'DELETE'),
              'maint_select',    has_table_privilege('service_role', 'public.tradition_pack_releases', 'SELECT'),
              'maint_insert',    has_table_privilege('service_role', 'public.tradition_pack_releases', 'INSERT'))),
    jsonb_build_object('anon_select', false, 'auth_select', false, 'auth_write', false,
                       'maint_select', true, 'maint_insert', true));

  PERFORM pg_temp.s4_eq('A3b and the same refusal to mint a pack concept, because a row in `tradition_packs` is the half of ruling A3 that decides whether a name is enumerable at all',
    has_table_privilege('authenticated', 'public.tradition_packs', 'INSERT')::text, 'false');

  -- ---------------------------------------------------- 2. the policy inventory
  -- "The policy does the right thing" and "no other policy exists" are separate claims, and
  -- the second one is the one that fails quietly when a later migration adds a convenience
  -- policy. Both are measured here, per table, by name.
  PERFORM pg_temp.s4_eq('A4 the release table carries exactly one policy, and it is the one written in this migration — a second, forgotten, permissive policy widening access would appear in this string',
    (SELECT coalesce(string_agg(q.policyname || '[' || q.cmd || ' to '
                                || array_to_string(q.roles, ',') || ' ' || q.permissive || ']', ' / '),
                     '(none)')
       FROM pg_policies q
      WHERE q.schemaname = 'public' AND q.tablename = 'tradition_pack_releases'),
    'users_read_approved_and_own_retired_pack_releases[SELECT to authenticated PERMISSIVE]');

  PERFORM pg_temp.s4_eq('A4b and the pack table carries exactly one policy too, the "has something approved" rule',
    (SELECT coalesce(string_agg(q.policyname || '[' || q.cmd || ' to '
                                || array_to_string(q.roles, ',') || ' ' || q.permissive || ']', ' / '),
                     '(none)')
       FROM pg_policies q
      WHERE q.schemaname = 'public' AND q.tablename = 'tradition_packs'),
    'users_read_packs_with_approved_releases[SELECT to authenticated PERMISSIVE]');

  -- Row security enabled, and nothing addresses the two roles that must never reach these
  -- tables. `relforcerowsecurity` is stated false on purpose and read as what it means: the
  -- table owner (the maintenance path) is not filtered, which is why §5 wants the *grants*
  -- and the *policy* both set rather than one of them trusted.
  PERFORM pg_temp.s4_jq('A4c row security is enabled on both catalogue tables, no policy addresses anon, public or service_role, and no policy opens a write path',
    jsonb_build_object(
      'rls_enabled', (SELECT count(*)::text FROM pg_class t
                       JOIN pg_namespace n ON n.oid = t.relnamespace
                      WHERE n.nspname = 'public'
                        AND t.relname IN ('tradition_packs', 'tradition_pack_releases')
                        AND t.relrowsecurity),
      'owner_filtered', (SELECT count(*)::text FROM pg_class t
                          JOIN pg_namespace n ON n.oid = t.relnamespace
                         WHERE n.nspname = 'public'
                           AND t.relname IN ('tradition_packs', 'tradition_pack_releases')
                           AND t.relforcerowsecurity),
      'role_widening', (SELECT count(*)::text FROM pg_policies q
                         WHERE q.schemaname = 'public'
                           AND q.tablename IN ('tradition_packs', 'tradition_pack_releases')
                           AND q.roles && ARRAY['public', 'anon', 'service_role']::name[]),
      'write_policies', (SELECT count(*)::text FROM pg_policies q
                          WHERE q.schemaname = 'public'
                            AND q.tablename IN ('tradition_packs', 'tradition_pack_releases')
                            AND q.cmd <> 'SELECT')),
      jsonb_build_object('rls_enabled', '2', 'owner_filtered', '0',
                         'role_widening', '0', 'write_policies', '0'));

  -- ----------------------------------------- 3. the row-policy gate, as a closed set
  v_rels_a  := pg_temp.s4_my_releases(v_host_a);
  v_packs_a := pg_temp.s4_my_packs(v_host_a);

  PERFORM pg_temp.s4_eq('A5 the row policy is narrower than the grant: of this battery''s seven releases an account may address, exactly the three approved ones are readable, each named with the status that made it readable',
    v_rels_a,
    ARRAY['stage4_doc_pinned/2=approved', 'stage4_doc_pinned/3=approved',
          'stage4_doc_retired/1=approved']::text[]);

  PERFORM pg_temp.s4_eq('A5b and the grant really is wider — all seven rows exist for the role that wrote them, so A5 is measuring a policy and not a missing fixture',
    (SELECT count(*) FROM public.tradition_pack_releases r
      JOIN public.tradition_packs p ON p.id = r.pack_id
     WHERE p.pack_key LIKE 'stage4\_doc%'), 7::bigint);

  -- Nothing unapproved is in the readable set, stated as a property of what is readable
  -- rather than as the absence of one row somebody thought of.
  PERFORM pg_temp.s4_eq('A5c and no readable row carries a status short of approved, so §4''s "no unapproved content" is a fact about the whole set rather than about the two cases the fixture happens to include',
    (SELECT coalesce(string_agg(q.x, ' ' ORDER BY q.x), '')
       FROM unnest(v_rels_a) q(x) WHERE q.x NOT LIKE '%=approved%'), '');

  PERFORM pg_temp.s4_eq('A6 a pack with nothing approved has no identity a customer can enumerate — the unshipped pack''s name is not readable, its draft is not readable, and its reviewed-but-never-approved candidate is not readable either (§10, ruling A3)',
    v_packs_a, ARRAY['stage4_doc_pinned', 'stage4_doc_retired']::text[]);

  -- Ruling A3's second arm. `stage4_doc_lifecycle` reached `approved` in no release at all;
  -- its one candidate was walked to `reviewed`, refused onward, and ended `deprecated`
  -- without any wedding ever selecting it. A pack-level "exists an approved release" rule
  -- hides it, and it has to be hidden — otherwise "there is a tradition pack called X" is a
  -- promise this platform has not approved making.
  PERFORM pg_temp.s4_lacks('A6b and a pack whose only release was retired without ever being chosen is invisible too, which is the arm a pack-level rule cannot express by itself',
    v_packs_a, 'stage4_doc_lifecycle');

  PERFORM pg_temp.s4_eq('A6c and both concepts are real rows with real scope statements, so A6 and A6b refused a policy rather than an absent fixture',
    (SELECT count(*) FROM public.tradition_packs WHERE pack_key IN ('stage4_doc_unshipped', 'stage4_doc_lifecycle')),
    2::bigint);

  -- §4's prohibition is about the *anonymous* web, and the row policy is not a column
  -- filter: an account that can read a visible release reads its whole row, review record
  -- included. What makes that survivable is not the policy but the prose — no review record
  -- anywhere in this catalogue claims to be a human reading — so the claim has to be measured
  -- over the whole catalogue rather than over this battery's own rows.
  --
  -- This assertion is the second D42-class repair, and it was found the same way: it used to
  -- read `count(*) ... WHERE reviewed_by IS NOT NULL = 0` over the whole table, and it failed
  -- the moment this file was wired into `run.sh both` ("got [1] want [0]"). The row it found
  -- is real and belongs to `stage2/20_attacks.sql`, whose group 16 keeps release 902 of its
  -- own `unshipped_pack` with `reviewed_by = owner_a` as the positive control for "a reviewer
  -- may honestly be named" (20_attacks.sql:2958-2984). A global zero was therefore a claim
  -- about fixture order, which is exactly what the filtered helpers above exist to avoid.
  -- Measured, the two chains answer differently: 0 rows name an auditor on the scratch chain,
  -- 1 on the attacked one, and that row is `reviewed`, so the row policy already keeps it from
  -- any customer. What is true on both, and is the fact §4 relies on, is that no review
  -- record presents itself as anything but synthetic. The scanned sizes travel with the
  -- offender list so the zero cannot come from an empty scan.
  PERFORM pg_temp.s4_jq('A7 no release anywhere in the catalogue carries a review record that does not disclose itself as synthetic — reviewer identity, label, basis and scope all read as TEST ONLY prose, and the scan covers every release row that exists on this chain, not this battery''s own',
    (SELECT jsonb_build_object(
              'rows_scanned', count(*) >= 7,
              'review_records', count(*) FILTER (WHERE q.has_record) >= 6,
              'undisclosed', count(*) FILTER (WHERE q.has_record AND NOT q.discloses),
              'offenders', coalesce(string_agg(CASE WHEN q.has_record AND NOT q.discloses
                                               THEN q.row_key END, ' ; '), '(none)'))
         FROM (SELECT (   r.reviewed_by IS NOT NULL
                       OR r.review_label  IS NOT NULL
                       OR r.review_basis  IS NOT NULL
                       OR r.review_scope  IS NOT NULL) AS has_record,
                       lower(coalesce(r.review_label, '') || ' '
                             || coalesce(r.review_basis, '') || ' '
                             || coalesce(r.review_scope, '')) LIKE '%test only%' AS discloses,
                       p.pack_key || '/' || r.release_number::text AS row_key
                  FROM public.tradition_pack_releases r
                  JOIN public.tradition_packs p ON p.id = r.pack_id) q),
      '{"rows_scanned": true, "review_records": true, "undisclosed": 0, "offenders": "(none)"}'::jsonb);

  -- ... and the half that is about *this* stage rather than about the catalogue: §12 forbids
  -- fabricating a reader, so the seven releases this file authored must name nobody, however
  -- many of them are walked through a review step. Group T counts the same seven again as part
  -- of its ledger; the two agree because they read the same rows.
  SELECT count(*)::text,
         count(*) FILTER (WHERE r.reviewed_by IS NOT NULL)::text
    INTO v_bad, v_n_txt
    FROM public.tradition_pack_releases r
    JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE p.pack_key LIKE 'stage4\_doc%';
  PERFORM pg_temp.s4_eq('A7a and the seven releases this battery wrote name no auditor at all — the fabrication §12 forbids is absent from the rows this stage is responsible for, measured against the seven rows scanned',
    ARRAY[v_bad, v_n_txt], ARRAY['7', '0']);

  -- The catalogue is not a function of who is asking: a Tamil host who holds a release and a
  -- bystander who holds nothing, speaks no language and owns no wedding read the same three
  -- rows. This is the property the directive asks for when it forbids inferring
  -- tradition/language/caste from identity — the read path has no such branch to find.
  v_rels_b  := pg_temp.s4_my_releases(v_host_b);
  v_packs_b := pg_temp.s4_my_packs(v_host_b);
  PERFORM pg_temp.s4_eq('A7b the bystander reads the identical release set to the host who holds a pack, so nothing about identity or language selects a catalogue row',
    v_rels_b, v_rels_a);
  PERFORM pg_temp.s4_eq('A7c and the identical pack set', v_packs_b, v_packs_a);

  -- §4's "no source internals / no machine prompt details", measured at the schema rather
  -- than at the rows: there is no column that could hold one. The count of columns scanned
  -- is asserted in the same document so the zero cannot come from an empty result set —
  -- the same guard C6 and C12 put on their own instruments.
  -- The column count is the only head-dependent part of this instrument, and the reason it is
  -- printed as a number is that it can move: Stage 5 adds exactly one column to the catalogue,
  -- `review_packet_hash`, which is a digest of content rather than a place to hide an
  -- instruction, so `prompt_shaped` stays 0 while the scan grows by one. A stage that added a
  -- prompt-shaped column would show up here as a non-zero first arm, which is what the count
  -- is being held steady to prove.
  PERFORM pg_temp.s4_jq('A7d the ban on machine prompt details is structural: neither catalogue table has a prompt-, instruction- or system-shaped column, and the scan ran over the '
    || CASE WHEN pg_temp.s4_at_least('stage5') THEN '29' ELSE '28' END
    || ' columns that do exist',
    jsonb_build_object(
      'prompt_shaped', (SELECT count(*)::text FROM information_schema.columns c
                         WHERE c.table_schema = 'public'
                           AND c.table_name IN ('tradition_pack_releases', 'tradition_packs')
                           AND (c.column_name ILIKE '%prompt%'
                                OR c.column_name ILIKE '%instruction%'
                                OR c.column_name ILIKE '%system%')),
      'columns_scanned', (SELECT count(*)::text FROM information_schema.columns c
                           WHERE c.table_schema = 'public'
                             AND c.table_name IN ('tradition_pack_releases', 'tradition_packs'))),
    jsonb_build_object('prompt_shaped', '0', 'columns_scanned',
      CASE WHEN pg_temp.s4_at_least('stage5') THEN '29' ELSE '28' END));

  -- --------------------------------- 4. ruling A1's historical case, with a new holder
  -- P11 measured the *other* half: a host who lets go of a retired release loses the row.
  -- What is left unproved is the half the editor depends on — that the row stays readable
  -- **to the customer who holds it**, and only to them. A global "deprecated is readable"
  -- arm would satisfy P11 and leak an unchosen release, so the pair below is the
  -- measurement that distinguishes the two.
  --
  -- Every step is the product's own: the wedding is created by an INSERT the account is
  -- allowed to make, the selection goes through `s4_select` (the same UPDATE the browser
  -- sends), and the retirement is the lifecycle step group L qualified, written by the
  -- maintenance role with one column in the statement.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', v_host_b::text, false);
  v_err := pg_temp.s4_err('INSERT INTO public.weddings (id, owner_user_id, title, primary_language, style_settings) VALUES ('
    || quote_literal(v_wed_b::text) || ', ' || quote_literal(v_host_b::text)
    || ', ''Stage 4 visibility wedding'', ''en'', ' || quote_literal(v_style) || '::jsonb)');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.s4_eq('A8 the bystander''s wedding is created through the account''s own INSERT, not through a fixture shortcut, so the holder below is a customer rather than a row',
    v_err, 'no-error');

  v_err := pg_temp.s4_select(v_host_b, v_wed_b, v_rel_3);
  PERFORM pg_temp.s4_eq('A8b and selecting the still-approved release 3 is the legal step it has to be for the historical case to exist (' || v_err || ')',
    v_err, 'no-error');
  PERFORM pg_temp.s4_eq('A8c and the wedding holds exactly that release',
    (SELECT count(*) FROM public.weddings WHERE id = v_wed_b
       AND tradition_pack_release_id = v_rel_3), 1::bigint);

  v_before := pg_temp.s4_chash(v_rel_3);
  UPDATE public.tradition_pack_releases SET status = 'deprecated' WHERE id = v_rel_3;
  PERFORM pg_temp.s4_eq('A8d the maintenance role retires the release the bystander now holds, with a statement that names one column',
    (SELECT status || '|' || (deprecated_at IS NOT NULL)::text
       FROM public.tradition_pack_releases WHERE id = v_rel_3), 'deprecated|true');
  v_after := pg_temp.s4_chash(v_rel_3);
  PERFORM pg_temp.s4_eq('A8e and the retirement changed no byte of the content the holder is about to read, which is what makes the readable row a fact rather than a placeholder',
    v_after, v_before);

  -- The pair. Same table, same policy, same grant, same product, two customers, different
  -- rows — because the policy's second arm is `w.owner_user_id = auth.uid()` and not
  -- "some wedding holds this release".
  v_rels_b := pg_temp.s4_my_releases(v_host_b);
  v_rels_a := pg_temp.s4_my_releases(v_host_a);
  PERFORM pg_temp.s4_has('A8f the holder reads the retired release, so the editor can say "the pack you chose has been retired" instead of showing a blank where a choice used to be (§3, ruling A1)',
    v_rels_b, 'stage4_doc_pinned/3=deprecated');
  PERFORM pg_temp.s4_lacks('A8g and the non-holder does not — the widening is owner-scoped, and this is the assertion that separates ruling A1 from a leak',
    v_rels_a, 'stage4_doc_pinned/3=deprecated');
  PERFORM pg_temp.s4_eq('A8h and holding a retired row costs the holder no approved one: it reads its three, the same as before plus the row it owns',
    v_rels_b,
    ARRAY['stage4_doc_pinned/2=approved', 'stage4_doc_pinned/3=deprecated',
          'stage4_doc_retired/1=approved']::text[]);
  PERFORM pg_temp.s4_eq('A8i while the non-holder''s set has narrowed to the two releases that are still approved, which is the same data seen by two accounts',
    v_rels_a,
    ARRAY['stage4_doc_pinned/2=approved', 'stage4_doc_retired/1=approved']::text[]);

  -- The pack-level and release-level policies are separate rules, and the retirement had to
  -- leave the pack visible: `stage4_doc_pinned` still has release 2 approved, so hiding the
  -- concept because one of its releases became unreadable would drop a live choice off the
  -- picker rather than retire it.
  PERFORM pg_temp.s4_has('A8j and the pack itself stays readable to the non-holder, because the pack rule asks only whether something approved exists — retiring one release does not hide a live choice',
    pg_temp.s4_my_packs(v_host_a), 'stage4_doc_pinned');

  -- The refusal that pairs with A8f: readability is not selectability. The two gates are
  -- different mechanisms (a row policy and a trigger on the wedding), and a suite that
  -- conflated them would report "the customer can read it" as "the customer can choose it".
  v_err := pg_temp.s4_select(v_host_b, v_wed_b, v_rel_3);
  PERFORM pg_temp.s4_ok('A8k and the selection gate still refuses a release the same account can read, so A8f is a read permission and not an offer to choose again (' || v_err || ')',
    v_err LIKE '42501%may only select an approved tradition pack release (this one is deprecated)%');
  PERFORM pg_temp.s4_eq('A8k2 and the refused write moved nothing: the wedding still holds the release it has been holding, which is the silent switch ruling A1 forbids',
    (SELECT (w.tradition_pack_release_id = v_rel_3)::text FROM public.weddings w WHERE w.id = v_wed_b), 'true');

  -- ------------------------------------------------------------------------ instrument
  -- The group's own role at the end, because A8 is the only place in this file that writes
  -- a row as `authenticated` outside a helper and an escaped SET ROLE would leak into the
  -- inventory and totals groups after it.
  PERFORM pg_temp.s4_is_superuser('A9 the group ends as the maintenance role, with no role change escaping from the wedding INSERT above');
END $A$;

-- ===========================================================================
-- I. THE MAINTENANCE-FUNCTION INVENTORY
-- ===========================================================================
-- §5 and §16.5 ask for this by name: an inventory of the privileged functions, plus the
-- negative assertion that an accidental new wrapper fails it, plus the standing rule "do not
-- create api wrappers merely for test setup".
--
-- The stage's design leaves three places a function can live, and each one means something
-- different about who may call it:
--
--   `api`           — the customer-facing surface PostgREST exposes, every function in it
--                     SECURITY INVOKER, so it executes with the account's own privileges;
--   `internal_api`  — the privileged bodies behind that surface, SECURITY DEFINER, pinned
--                     search paths, the half Stage 3 §6/§9 moved out of `api`;
--   `private`       — the governance machinery: lifecycle guards, the selection and freeze
--                     gates, the resolver, the projection. Not a schema an account has USAGE
--                     on at all, which is why its functions are reached through triggers and
--                     through `internal_api`, never through a call a browser can make.
--
-- An inventory is worth writing down only if it can fail, so the group ends by creating a
-- wrapper that must not exist, showing the same instrument report it, and dropping it again.

DO $I$
DECLARE
  v_api     text[];
  v_names   text[];
  v_scanned bigint;
  v_temp_scanned bigint;
  v_temp_dirty   bigint;
BEGIN
  PERFORM pg_temp.s4_is_superuser('I0 the inventory group starts as the maintenance role, so the privilege questions below are asked from outside the roles they measure');

  -- ------------------------------------------------------ the customer-facing surface
  SELECT coalesce(array_agg(p.proname ORDER BY p.proname COLLATE "C"), '{}'::text[]) INTO v_api
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api';
  PERFORM pg_temp.s4_eq('I1 the customer-facing surface is exactly the '
    || CASE WHEN pg_temp.s4_at_least('stage5') THEN 'eight' ELSE 'seven' END
    || ' entry points: Stage 4 added no wrapper to it, because a release selection is an ordinary UPDATE the row policy and the wedding trigger already govern (§5)'
    || CASE WHEN pg_temp.s4_at_least('stage5') THEN ', and Stage 5 added exactly one — the preview/freeze-parity read (§3.5) — which is the only new name a browser can reach' ELSE '' END,
    v_api,
    CASE WHEN pg_temp.s4_at_least('stage5') THEN
      ARRAY['create_invitation_version', 'get_invitation_publication_state',
            'preview_invitation', 'preview_invitation_document',
            'publish_invitation_version', 'resolve_public_invitation',
            'revoke_invitation_publication', 'rotate_invitation_token']::text[]
    ELSE
      ARRAY['create_invitation_version', 'get_invitation_publication_state',
            'preview_invitation', 'publish_invitation_version', 'resolve_public_invitation',
            'revoke_invitation_publication', 'rotate_invitation_token']::text[]
    END);

  SELECT coalesce(array_agg(p.proname ORDER BY p.proname COLLATE "C"), '{}'::text[]) INTO v_names
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'internal_api';
  -- At the Stage 4 head the two surfaces were the same seven names, and that identity is what
  -- made "no privileged function without a public twin" checkable. Stage 5 deliberately breaks
  -- the identity in one direction only: it adds eleven privileged functions that must NOT have
  -- a public twin. So the Stage 5 expectation is not a loosening of the rule but its
  -- enumerated form — the surface is these nineteen names, the eight with twins are exactly the
  -- customer-facing ones, and the eleven maintenance names are listed here by name. An
  -- accidental twelfth is a failing line, which is strictly more than the old equality said.
  PERFORM pg_temp.s4_eq('I2 and the privileged surface is '
    || CASE WHEN pg_temp.s4_at_least('stage5')
         THEN 'exactly these nineteen names — the eight public twins plus the eleven maintenance functions, listed so an unlisted privilege is a failing assertion'
         ELSE 'the same seven names, so there is no fourth way into a publication action and no privileged function without a public twin' END,
    v_names,
    CASE WHEN pg_temp.s4_at_least('stage5') THEN
      ARRAY['approve_tradition_pack_release', 'create_invitation_version',
            'create_tradition_pack', 'create_tradition_pack_release',
            'deprecate_tradition_pack_release', 'get_invitation_publication_state',
            'get_tradition_pack_review_packet', 'inspect_tradition_pack_release',
            'preview_invitation', 'preview_invitation_document',
            'publish_invitation_version', 'resolve_public_invitation',
            'revoke_invitation_publication', 'rotate_invitation_token',
            'submit_tradition_pack_review', 'tradition_pack_catalog',
            'tradition_pack_retention_report', 'update_draft_tradition_pack_release',
            'validate_tradition_pack_release']::text[]
    ELSE v_api END);

  PERFORM pg_temp.s4_jq('I3 the shape that makes that split mean something: every `api` function runs as the caller, every `internal_api` one has a pinned search path, and '
    || CASE WHEN pg_temp.s4_at_least('stage5')
         THEN 'exactly the eight with a public twin are DEFINER — the eleven maintenance bodies are INVOKER, so they add a workflow and no privilege'
         ELSE 'seven each side' END,
    (SELECT jsonb_build_object(
              'api_invoker', (SELECT count(*)::text FROM pg_proc p
                               JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'api' AND NOT p.prosecdef),
              'api_pinned', (SELECT count(*)::text FROM pg_proc p
                              JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'api' AND p.proconfig @> ARRAY['search_path=""']),
              'internal_definer', (SELECT count(*)::text FROM pg_proc p
                                    JOIN pg_namespace n ON n.oid = p.pronamespace
                                   WHERE n.nspname = 'internal_api' AND p.prosecdef),
              'internal_pinned', (SELECT count(*)::text FROM pg_proc p
                                   JOIN pg_namespace n ON n.oid = p.pronamespace
                                  WHERE n.nspname = 'internal_api'
                                    AND p.proconfig @> ARRAY['search_path=""']))),
      CASE WHEN pg_temp.s4_at_least('stage5')
             THEN jsonb_build_object('api_invoker', '8', 'api_pinned', '8',
                                     'internal_definer', '8', 'internal_pinned', '19')
             ELSE jsonb_build_object('api_invoker', '7', 'api_pinned', '7',
                                     'internal_definer', '7', 'internal_pinned', '7') END);

  -- ------------------------------------------------------------ the governance machinery
  -- Stage 6 adds three functions to `private` — the key minter and the two registry guards — and no
  -- name to `api` or `internal_api`, which is the shape this line measures. The count is not the
  -- interesting half: `usage_anon`/`usage_auth` staying false is what makes the growth invisible to an
  -- account, and Stage 6's own battery (90_storage_policies.sql G6) holds those three functions to an
  -- owner-only ACL, which is the property this census was written to protect.
  PERFORM pg_temp.s4_jq('I4 the whole privileged inventory is '
    || CASE WHEN pg_temp.s4_at_least('stage6') THEN '57'
             WHEN pg_temp.s4_at_least('stage5') THEN '54'
             ELSE '32' END
    || ' functions across the three schemas, and none of the machinery is in a schema an account can even name',
    (SELECT jsonb_build_object(
              'api', (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'api'),
              'internal_api', (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'internal_api'),
              'private', (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'private'),
              'public', (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'),
              'usage_anon', (SELECT has_schema_privilege('anon', 'private', 'USAGE')::text),
              'usage_auth', (SELECT has_schema_privilege('authenticated', 'private', 'USAGE')::text),
              'usage_maint', (SELECT has_schema_privilege('service_role', 'private', 'USAGE')::text))),
      CASE WHEN pg_temp.s4_at_least('stage6')
             THEN jsonb_build_object('api', '8', 'internal_api', '19', 'private', '30',
                                     'public', '0', 'usage_anon', 'false',
                                     'usage_auth', 'false', 'usage_maint', 'true')
             WHEN pg_temp.s4_at_least('stage5')
             THEN jsonb_build_object('api', '8', 'internal_api', '19', 'private', '27',
                                     'public', '0', 'usage_anon', 'false',
                                     'usage_auth', 'false', 'usage_maint', 'true')
             ELSE jsonb_build_object('api', '7', 'internal_api', '7', 'private', '18',
                                     'public', '0', 'usage_anon', 'false',
                                     'usage_auth', 'false', 'usage_maint', 'true') END);

  -- The six functions this migration authors, named rather than counted. An inventory that
  -- only reports a number cannot tell a renamed guard from a deleted one.
  SELECT coalesce(array_agg(n.nspname || '.' || p.proname ORDER BY p.proname COLLATE "C"), '{}'::text[]) INTO v_names
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'private'
     AND p.proname IN ('guard_tradition_pack_release', 'require_approved_pack_release',
                       'require_frozen_pack_release', 'resolve_invitation_sections',
                       'pack_text_for', 'default_invitation_definition');
  PERFORM pg_temp.s4_eq('I5 the six functions Stage 4 authors are all present in `private`, each named, so a renamed guard is a failing assertion and not a silent absence',
    v_names,
    ARRAY['private.default_invitation_definition', 'private.guard_tradition_pack_release',
          'private.pack_text_for', 'private.require_approved_pack_release',
          'private.require_frozen_pack_release', 'private.resolve_invitation_sections']::text[]);

  -- Ruling A1's enforcement-point claim, stated as the only form that can be checked: of
  -- every function body that mentions the catalogue, exactly one is callable by an account,
  -- and it is the freeze call — which is why the directive's "not only in the UI and not
  -- only on wedding UPDATE" is a property of the database.
  SELECT coalesce(array_agg(n.nspname || '.' || p.proname ORDER BY n.nspname, p.proname COLLATE "C"), '{}'::text[]) INTO v_names
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('api', 'internal_api', 'private')
     AND p.prosrc ILIKE '%tradition_pack%';
  PERFORM pg_temp.s4_eq('I6 '
    || CASE WHEN pg_temp.s4_at_least('stage5') THEN 'twenty-two function bodies name the catalogue tables: Stage 4''s seven plus the review-hash pair, the definition accessor, the record engine and the eleven maintenance bodies'
            ELSE 'seven function bodies name the catalogue tables, and they are these — the selection gate, the freeze gate, the lifecycle guard, the resolver inputs, the checker and the projection' END,
    v_names,
    CASE WHEN pg_temp.s4_at_least('stage5') THEN
      ARRAY['internal_api.approve_tradition_pack_release',
            'internal_api.create_invitation_version', 'internal_api.create_tradition_pack',
            'internal_api.create_tradition_pack_release',
            'internal_api.deprecate_tradition_pack_release',
            'internal_api.get_tradition_pack_review_packet',
            'internal_api.inspect_tradition_pack_release',
            'internal_api.preview_invitation_document',
            'internal_api.submit_tradition_pack_review', 'internal_api.tradition_pack_catalog',
            'internal_api.tradition_pack_retention_report',
            'internal_api.update_draft_tradition_pack_release',
            'internal_api.validate_tradition_pack_release', 'private.build_invitation_snapshot',
            'private.guard_tradition_pack_release', 'private.invitation_issue_records',
            'private.public_invitation_dto', 'private.require_approved_pack_release',
            'private.require_frozen_pack_release', 'private.tradition_pack_review_hash',
            'private.tradition_pack_review_payload', 'private.wedding_invitation_definition']::text[]
    ELSE
      ARRAY['internal_api.create_invitation_version', 'private.build_invitation_snapshot',
            'private.guard_tradition_pack_release', 'private.invitation_freeze_issues',
            'private.public_invitation_dto', 'private.require_approved_pack_release',
            'private.require_frozen_pack_release']::text[] END);

  -- The count of the list is a Stage 5 number; the *point* is unchanged and is the head-neutral
  -- half: of every body that touches the catalogue, only the customer-facing paths are
  -- EXECUTE-able by an account, and the maintenance bodies are not. That is why the widened
  -- surface in I2 is not a widened attack surface.
  PERFORM pg_temp.s4_eq('I6b and exactly '
    || CASE WHEN pg_temp.s4_at_least('stage5') THEN 'two of them' ELSE 'one of them' END
    || ' are EXECUTE-able by an authenticated account, which '
    || CASE WHEN pg_temp.s4_at_least('stage5')
         THEN 'are the freeze call and the parity preview — the other twenty sit behind `private` USAGE no client role holds, or a revoked maintenance grant'
         ELSE 'is the freeze path itself — the other six sit behind `private` USAGE that only the maintenance role holds' END,
    (SELECT coalesce(string_agg(q.f, ', ' ORDER BY q.f), '(none)')
       FROM (SELECT n.nspname || '.' || p.proname AS f
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('api', 'internal_api', 'private')
                AND p.prosrc ILIKE '%tradition_pack%'
                AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) q),
    CASE WHEN pg_temp.s4_at_least('stage5')
         THEN 'internal_api.create_invitation_version, internal_api.preview_invitation_document'
         ELSE 'internal_api.create_invitation_version' END);

  -- The other half of "the database enforces it": the gates are attached to the tables as
  -- triggers, so an INSERT or UPDATE that never calls a function still passes through them.
  -- The full catalogue-side trigger inventory is asserted by name, which makes a dropped or
  -- added trigger a failing line rather than a changed row count.
  PERFORM pg_temp.s4_eq('I7 every write path into a governed table passes through a named trigger — four on the release table, two on the pack, one on the wedding selection, three on the version ledger, and no extra one somebody forgot to remove',
    (SELECT coalesce(array_agg(q.k ORDER BY q.k COLLATE "C"), '{}'::text[])
       FROM (SELECT t.relname || ' . ' || c.tgname || ' -> ' || n.nspname || '.' || p.proname AS k
               FROM pg_trigger c
               JOIN pg_class t ON t.oid = c.tgrelid
               JOIN pg_proc p ON p.oid = c.tgfoid
               JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE NOT c.tgisinternal
                AND t.relname IN ('tradition_packs', 'tradition_pack_releases',
                                  'weddings', 'invitation_versions')) q),
    ARRAY[
      'invitation_versions . versions_immutable_no_delete -> private.reject_client_delete',
      'invitation_versions . versions_immutable_no_update -> private.reject_client_write',
      'invitation_versions . versions_pack_release_gate -> private.require_frozen_pack_release',
      'tradition_pack_releases . no_client_delete_tradition_pack_releases -> private.reject_client_delete',
      'tradition_pack_releases . no_client_write_tradition_pack_releases -> private.reject_client_write',
      'tradition_pack_releases . set_updated_at -> private.touch_updated_at',
      'tradition_pack_releases . tradition_pack_release_guard -> private.guard_tradition_pack_release',
      'tradition_packs . no_client_write_tradition_packs -> private.reject_client_write',
      'tradition_packs . set_updated_at -> private.touch_updated_at',
      'weddings . set_updated_at -> private.touch_updated_at',
      'weddings . weddings_have_draft -> private.attach_draft_on_wedding_create',
      'weddings . weddings_pack_release_gate -> private.require_approved_pack_release']::text[]);

  -- --------------------------------------- "no wrapper merely for test setup", as a check
  -- The rule is only measurable as a property of bodies, because a wrapper written for a
  -- test would arrive with a normal-looking name. Every one of the 32 functions is scanned
  -- for the fixture marker this stage's own data carries, and the scan is then pointed at
  -- this session's own temporary schema — the battery's helpers, which *do* carry the marker — so a zero in the
  -- first half is known to be a clean schema rather than a pattern that matches nothing.
  PERFORM pg_temp.s4_jq('I8 no function in api, internal_api or private is test-shaped: the scan finds none of this stage''s fixture markers in any of the '
    || CASE WHEN pg_temp.s4_at_least('stage6') THEN '57'
             WHEN pg_temp.s4_at_least('stage5') THEN '54'
             ELSE '32' END
    || ' real bodies, so no privileged wrapper exists to serve a test (§5)',
    (SELECT jsonb_build_object(
              'real_scanned', (SELECT count(*)::text FROM pg_proc p
                                JOIN pg_namespace n ON n.oid = p.pronamespace
                               WHERE n.nspname IN ('api', 'internal_api', 'private')),
              'real_dirty', (SELECT count(*)::text FROM pg_proc p
                              JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname IN ('api', 'internal_api', 'private')
                               AND (p.prosrc ILIKE '%TEST ONLY%'
                                    OR p.prosrc ILIKE '%fixture%'
                                     OR p.proname ILIKE '%test%')))),
    jsonb_build_object('real_scanned',
      CASE WHEN pg_temp.s4_at_least('stage6') THEN '57'
             WHEN pg_temp.s4_at_least('stage5') THEN '54'
             ELSE '32' END,
      'real_dirty', '0'));

  -- ... and the control on that scan, pointed at the one schema where the marker really does
  -- live. Without it I8 would be satisfied by a pattern that matches nothing anywhere.
  SELECT count(*), count(*) FILTER (WHERE p.prosrc ILIKE '%TEST ONLY%'
                                      OR p.prosrc ILIKE '%fixture%'
                                      OR p.proname ILIKE '%test%')
    INTO v_temp_scanned, v_temp_dirty
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.oid = pg_my_temp_schema();
  PERFORM pg_temp.s4_ok('I8b and the same pattern is not vacuous: pointed at this battery''s own helpers it finds the marker in '
    || v_temp_dirty || ' of ' || v_temp_scanned || ' bodies, so I8''s zero is a clean schema rather than a scan that matches nothing',
    v_temp_dirty >= 1 AND v_temp_scanned >= 20);

  -- ------------------------------------------------------- the guard on the guard (§16.5)
  -- Everything above is a list of things that must not appear. A list that cannot fail is
  -- decoration, so the group ends by committing the sin it is inventoried against: create a
  -- wrapper on the customer-facing surface, have the same instrument name it, remove it, and
  -- have the instrument agree again. The temporary wrapper is created inside the battery's
  -- own transaction and dropped before the group returns, so nothing it could expose outlives
  -- the run.
  EXECUTE 'CREATE FUNCTION api.stage4_inventory_probe(p_wedding_id uuid) '
          || 'RETURNS void LANGUAGE sql AS $probe$ SELECT 1 $probe$';
  SELECT coalesce(array_agg(p.proname ORDER BY p.proname COLLATE "C"), '{}'::text[]) INTO v_api
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api';
  PERFORM pg_temp.s4_has('I9 the inventory really does fail when a wrapper appears: with one added for no reason, the instrument reports the intruder by name — '
    || array_to_string(v_api, ', '), v_api, 'stage4_inventory_probe');
  PERFORM pg_temp.s4_eq('I9b and I1''s exact equality is what rejects it, so the assertion below is the same one a future migration would trip',
    cardinality(v_api)::bigint,
    CASE WHEN pg_temp.s4_at_least('stage5') THEN 9::bigint ELSE 8::bigint END);

  EXECUTE 'DROP FUNCTION api.stage4_inventory_probe(p_wedding_id uuid)';
  SELECT coalesce(array_agg(p.proname ORDER BY p.proname COLLATE "C"), '{}'::text[]) INTO v_api
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api';
  PERFORM pg_temp.s4_eq('I10 and with the probe removed the surface is the '
    || CASE WHEN pg_temp.s4_at_least('stage5') THEN 'eight' ELSE 'seven' END
    || ' again, which is the state the rest of the suite and the application both depend on',
    v_api,
    CASE WHEN pg_temp.s4_at_least('stage5') THEN
      ARRAY['create_invitation_version', 'get_invitation_publication_state',
            'preview_invitation', 'preview_invitation_document',
            'publish_invitation_version', 'resolve_public_invitation',
            'revoke_invitation_publication', 'rotate_invitation_token']::text[]
    ELSE
      ARRAY['create_invitation_version', 'get_invitation_publication_state',
            'preview_invitation', 'publish_invitation_version', 'resolve_public_invitation',
            'revoke_invitation_publication', 'rotate_invitation_token']::text[]
    END);

  SELECT count(*) INTO v_scanned FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('api', 'internal_api', 'private');
  PERFORM pg_temp.s4_eq('I10b and no residue of the probe is left anywhere in the inventory', v_scanned,
    CASE WHEN pg_temp.s4_at_least('stage6') THEN 57::bigint
         WHEN pg_temp.s4_at_least('stage5') THEN 54::bigint
         ELSE 32::bigint END);
END $I$;
-- ---------------------------------------------------- what this file actually leaves behind
-- `BASE` remembered the catalogue as this file found it. Everything above then wrote to it:
-- fixtures, lifecycle steps that cannot be undone, versions that cannot be edited, one
-- release retired underneath a customer while group A watched it happen. This group measures
-- the footprint instead of describing it, for three reasons, each a different failure mode:
--
--   * A file that adds rows it cannot delete is a file whose own numbers move when the chain
--     order changes. Naming exactly which rows survive is what lets a reader check every
--     earlier group in a different sequence, and it is the only place in this file that
--     states the answer rather than depending on it.
--   * Every honesty claim §7 demands of a real candidate pack is a claim this file has to
--     make about itself first. Its fixtures walk releases to `approved`, and an approved row
--     in a catalogue reads as a reviewed thing to whoever finds it. If one of them carried a
--     reviewer's name, an unmarked author label, or a scope statement that implied somebody
--     had read the Tamil, this battery would be the thing it falsifies.
--   * The zeros below are the cleanup half of §8. Each one is printed beside the nonzero
--     count of the rows it scanned, because "no probe row survived" means nothing unless the
--     probes were capable of making a row in the first place.
--
-- The total this file prints is its own, and the floor at the end is measured, in the same
-- shape `stage2/40_catalog.sql` uses for Stage 2. T15 then checks the separation as a fact of
-- the run rather than as a claim in a comment: `run.sh` gives every suite its own psql
-- session, so Stage 2's counter is not even set here, and nothing in this file's number
-- depends on how many assertions Stage 2 happened to run.
DO $T$
DECLARE
  v_host_a uuid;
  v_host_b uuid;
  v_d_pack bigint;
  v_d_rel  bigint;
  v_d_ver  bigint;
  v_d_wed  bigint;
  v_d_tmpl bigint;
  v_d_user bigint;
  v_a      text;
  v_b      text;
  v_c      text;
  v_e      text;
  v_off    text;
  v_set    text[];
BEGIN
  PERFORM pg_temp.s4_is_superuser('T0 the ledger group starts as the maintenance role, because it is about to count every row this file wrote, including the ones no customer may read');
  SELECT host_a, host_b INTO v_host_a, v_host_b FROM sf;

  -- ------------------------------------------------------------------ the footprint
  SELECT (SELECT count(*) FROM public.tradition_packs) - current_setting('s4.base_packs')::int,
         (SELECT count(*) FROM public.tradition_pack_releases) - current_setting('s4.base_rels')::int,
         (SELECT count(*) FROM public.invitation_versions) - current_setting('s4.base_vers')::int,
         (SELECT count(*) FROM public.weddings) - current_setting('s4.base_weds')::int,
         (SELECT count(*) FROM public.design_templates) - current_setting('s4.base_tmpl')::int,
         (SELECT count(*) FROM auth.users) - current_setting('s4.base_users')::int
    INTO v_d_pack, v_d_rel, v_d_ver, v_d_wed, v_d_tmpl, v_d_user;

  PERFORM pg_temp.s4_jq('T1 the rows this file adds to the catalogue, measured against the counts BASE took at entry: four packs, seven releases, ten frozen versions, five weddings, one template, two users',
    jsonb_build_object('packs', v_d_pack, 'releases', v_d_rel, 'versions', v_d_ver,
                       'weddings', v_d_wed, 'templates', v_d_tmpl, 'users', v_d_user),
    '{"packs": 4, "releases": 7, "versions": 10, "weddings": 5, "templates": 1, "users": 2}'::jsonb);

  PERFORM pg_temp.s4_eq('T1b and every one of those six deltas is nonzero, which is what makes T1 a measurement instead of an instrument that reads nothing',
    ARRAY[coalesce(v_d_pack > 0, false)::text, coalesce(v_d_rel > 0, false)::text,
          coalesce(v_d_ver > 0, false)::text, coalesce(v_d_wed > 0, false)::text,
          coalesce(v_d_tmpl > 0, false)::text, coalesce(v_d_user > 0, false)::text],
    ARRAY['true', 'true', 'true', 'true', 'true', 'true']);

  PERFORM pg_temp.s4_eq('T2 the four packs left behind are exactly these four, named',
    ARRAY(SELECT q.k FROM (SELECT p.pack_key AS k FROM public.tradition_packs p
                            WHERE p.pack_key LIKE 'stage4\_doc%') q
           ORDER BY q.k COLLATE "C"),
    ARRAY['stage4_doc_lifecycle', 'stage4_doc_pinned', 'stage4_doc_retired',
          'stage4_doc_unshipped']);

  -- The sentence a reader needs before the next line makes sense: `pinned/3` is deprecated
  -- here because group A retired it while measuring what a holder of it sees, and
  -- `lifecycle/1` reached `approved` and was walked on to `deprecated` by the lifecycle
  -- group. Neither is a state the fixtures began in, and neither can be undone.
  PERFORM pg_temp.s4_eq('T3 the seven releases left behind, each with the status it is actually in — three of them retired by the battery''s own rulings, which is why this is not the set the fixtures began as',
    ARRAY(SELECT q.row_key FROM (SELECT p.pack_key || '/' || r.release_number || '=' || r.status
                                        AS row_key
                                   FROM public.tradition_pack_releases r
                                   JOIN public.tradition_packs p ON p.id = r.pack_id
                                  WHERE p.pack_key LIKE 'stage4\_doc%') q
           ORDER BY q.row_key COLLATE "C"),
    ARRAY['stage4_doc_lifecycle/1=deprecated', 'stage4_doc_pinned/1=deprecated',
          'stage4_doc_pinned/2=approved', 'stage4_doc_pinned/3=deprecated',
          'stage4_doc_retired/1=approved', 'stage4_doc_unshipped/1=draft',
          'stage4_doc_unshipped/2=reviewed']);

  PERFORM pg_temp.s4_jq('T4 the same seven rows as a histogram, which is the shape the governance boundary is written in',
    (SELECT jsonb_build_object(
            'draft', count(*) FILTER (WHERE r.status = 'draft'),
            'reviewed', count(*) FILTER (WHERE r.status = 'reviewed'),
            'approved', count(*) FILTER (WHERE r.status = 'approved'),
            'deprecated', count(*) FILTER (WHERE r.status = 'deprecated'))
       FROM public.tradition_pack_releases r
       JOIN public.tradition_packs p ON p.id = r.pack_id
      WHERE p.pack_key LIKE 'stage4\_doc%'),
    '{"draft": 1, "reviewed": 1, "approved": 2, "deprecated": 3}'::jsonb);

  SELECT count(*)::text,
         count(*) FILTER (WHERE r.status = ANY (ARRAY['draft', 'reviewed', 'approved',
                                                     'deprecated']))::text
    INTO v_a, v_b
    FROM public.tradition_pack_releases r
    JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE p.pack_key LIKE 'stage4\_doc%';
  PERFORM pg_temp.s4_eq('T4b and the four histogram arms add up to the seven rows, so no release sat outside the vocabulary the histogram counts',
    ARRAY[v_a, v_b], ARRAY['7', '7']);

  -- ------------------------------------------------------------------ the honesty of the fixtures
  -- Seven rows, each of them machine-authored, each saying so in all three disclosure
  -- fields. The scanned count travels with the offender list in every assertion below for
  -- the reason given at the head of this group: a scan over nothing reports no offenders.
  SELECT count(*) FILTER (WHERE r.author_label IS NULL OR r.author_label NOT LIKE 'TEST ONLY%'
                             OR r.machine_assistance_notes IS NULL
                             OR r.machine_assistance_notes NOT LIKE 'TEST ONLY%'
                             OR r.source_reference IS NULL
                             OR r.source_reference NOT LIKE 'TEST ONLY%')::text,
         count(*)::text,
         coalesce(string_agg(CASE WHEN r.author_label IS NULL
                                    OR r.author_label NOT LIKE 'TEST ONLY%'
                                    OR r.machine_assistance_notes IS NULL
                                    OR r.machine_assistance_notes NOT LIKE 'TEST ONLY%'
                                    OR r.source_reference IS NULL
                                    OR r.source_reference NOT LIKE 'TEST ONLY%'
                              THEN p.pack_key || '/' || r.release_number END, ' ; '), '(none)')
    INTO v_a, v_b, v_off
    FROM public.tradition_pack_releases r
    JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE p.pack_key LIKE 'stage4\_doc%';
  PERFORM pg_temp.s4_eq('T5 every release this file leaves behind discloses itself in author_label, machine_assistance_notes and source_reference — not one row a later reader could mistake for a human contribution',
    ARRAY[v_b, v_a, v_off], ARRAY['7', '0', '(none)']);

  SELECT count(*) FILTER (WHERE r.machine_assisted)::text,
         count(*) FILTER (WHERE r.machine_assisted IS DISTINCT FROM true)::text,
         coalesce(string_agg(CASE WHEN r.machine_assisted IS DISTINCT FROM true
                                THEN p.pack_key || '/' || r.release_number END, ' ; '), '(none)')
    INTO v_a, v_b, v_off
    FROM public.tradition_pack_releases r
    JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE p.pack_key LIKE 'stage4\_doc%';
  PERFORM pg_temp.s4_eq('T5b and the boolean agrees with the prose: all seven set machine_assisted, so no row discloses in words while denying it in the column a review dashboard would read',
    ARRAY[v_a, v_b, v_off], ARRAY['7', '0', '(none)']);

  -- A review *record* is not a review *by somebody*. The battery walks six releases through
  -- a review step, so six rows carry `reviewed_at`; none of them may carry an identity.
  SELECT count(*)::text,
         count(*) FILTER (WHERE r.reviewed_at IS NOT NULL)::text,
         count(*) FILTER (WHERE r.reviewed_by IS NOT NULL)::text
    INTO v_a, v_b, v_c
    FROM public.tradition_pack_releases r
    JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE p.pack_key LIKE 'stage4\_doc%';
  PERFORM pg_temp.s4_eq('T6 reviewed_by is NULL on all seven rows, so nothing here claims a human reader existed — and the scan had seven rows to read, including the six that do carry a review timestamp',
    ARRAY[v_a, v_b, v_c], ARRAY['7', '6', '0']);

  SELECT count(*) FILTER (WHERE r.reviewed_at IS NOT NULL AND r.reviewed_by IS NOT NULL)::text,
         count(*) FILTER (WHERE r.reviewed_at IS NOT NULL)::text
    INTO v_a, v_b
    FROM public.tradition_pack_releases r
    JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE p.pack_key LIKE 'stage4\_doc%';
  PERFORM pg_temp.s4_eq('T6b and the specific dishonesty that is absent is the pairing: not one row sets a review timestamp beside a reviewer identity, which is the combination that would read as a real person having approved a tradition',
    ARRAY[v_b, v_a], ARRAY['6', '0']);

  SELECT count(*)::text,
         coalesce(string_agg(CASE WHEN p.scope_statement IS NULL
                                    OR p.scope_statement NOT LIKE 'TEST ONLY%'
                                THEN p.pack_key END, ' ; '), '(none)')
    INTO v_a, v_off
    FROM public.tradition_packs p WHERE p.pack_key LIKE 'stage4\_doc%';
  PERFORM pg_temp.s4_eq('T7 every pack says out loud that it claims no tradition: the disclosure is in the pack''s scope statement, not only in the release rows',
    ARRAY[v_a, v_off], ARRAY['4', '(none)']);

  -- The review *scope* is the field most likely to be read as an endorsement, so it is
  -- checked as prose rather than as a flag. Case-insensitive, and that is a measurement, not
  -- a style choice: four of these rows write 'No language review' after a full stop and two
  -- write it in lower case, so a scan matching one spelling alone would have reported the
  -- other four as offenders — an instrument failure wearing the costume of a finding.
  --
  -- What this first arm does *not* claim is worth stating, because the assertion above it is
  -- easy to over-read: measured, six of the seven rows disclaim a language review, and only
  -- four of them additionally disclaim religion and customer validation in the release's own
  -- scope text — `stage4_doc_retired/1` and `stage4_doc_unshipped/2` are the two that do not,
  -- because their rows were written for the English-only and never-approved cases. T7c
  -- measures that split instead of demanding a uniform sentence, and the claim that no
  -- tradition is endorsed lives at the pack, which T7 checks for all four.
  SELECT count(*) FILTER (WHERE r.status <> 'draft')::text,
         coalesce(string_agg(CASE WHEN r.status <> 'draft' AND (
                    r.review_scope IS NULL
                 OR lower(r.review_scope) NOT LIKE '%no language review%'
                 OR r.review_basis IS NULL
                 OR lower(r.review_basis) NOT LIKE '%synthetic%')
                                THEN p.pack_key || '/' || r.release_number END, ' ; '), '(none)')
    INTO v_a, v_off
    FROM public.tradition_pack_releases r
    JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE p.pack_key LIKE 'stage4\_doc%';
  PERFORM pg_temp.s4_eq('T7b every row that left draft states in its own review record that it reviewed no language, and calls its own review synthetic',
    ARRAY[v_a, v_off], ARRAY['6', '(none)']);

  SELECT count(*) FILTER (WHERE lower(r.review_scope) LIKE '%no religious%'
                             AND lower(r.review_scope) LIKE '%no customer validation%')::text,
         count(*) FILTER (WHERE r.status <> 'draft'
                             AND (lower(r.review_scope) NOT LIKE '%no religious%'
                                  OR lower(r.review_scope) NOT LIKE '%no customer validation%'))::text,
         coalesce(string_agg(CASE WHEN r.status <> 'draft'
                                    AND (lower(r.review_scope) NOT LIKE '%no religious%'
                                         OR lower(r.review_scope) NOT LIKE '%no customer validation%')
                                THEN p.pack_key || '/' || r.release_number
                                END, ' ; '
                                ORDER BY (p.pack_key || '/' || r.release_number::text) COLLATE "C"),
                  '(none)')
    INTO v_a, v_b, v_off
    FROM public.tradition_pack_releases r
    JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE p.pack_key LIKE 'stage4\_doc%';
  PERFORM pg_temp.s4_eq('T7c and the narrower disclaimers are named rather than averaged away: four of the seven releases additionally disclaim religion and customer validation in their own scope text, the two that do not are these two, and this file does not describe all six as making that claim',
    ARRAY[v_a, v_b, v_off], ARRAY['4', '2', 'stage4_doc_retired/1 ; stage4_doc_unshipped/2']);

  -- The draft/reviewed boundary from the fixture side: an unreviewed row must not look
  -- reviewed, and a reviewed row must not be blank about it.
  SELECT count(*) FILTER (WHERE r.status = 'draft')::text,
         count(*) FILTER (WHERE r.status <> 'draft')::text,
         count(*) FILTER (WHERE r.status = 'draft' AND r.review_label IS NOT NULL)::text,
         count(*) FILTER (WHERE r.status <> 'draft' AND r.review_label IS NULL)::text
    INTO v_a, v_b, v_c, v_e
    FROM public.tradition_pack_releases r
    JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE p.pack_key LIKE 'stage4\_doc%';

  PERFORM pg_temp.s4_eq('T8 the one draft left behind carries no review label and the six that are not draft all carry one, so how a row appears in a review list matches what it is',
    ARRAY[v_a, v_b, v_c, v_e], ARRAY['1', '6', '0', '0']);

  -- ------------------------------------------------------------------ the cleanup half of §8
  -- The definition battery authored rows at release numbers 900 and 901-903 and the column
  -- probes aimed at 910. `Dc5` checked one pack; this is every pack this file touched, which
  -- is where a probe that used a different one would leave its residue.
  SELECT count(*) FILTER (WHERE r.release_number >= 900)::text,
         coalesce(max(r.release_number), 0)::text
    INTO v_a, v_b
    FROM public.tradition_pack_releases r
    JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE p.pack_key LIKE 'stage4\_doc%';
  PERFORM pg_temp.s4_eq('T9 no probe release survives in any pack this file wrote to, and the highest release number that does survive is the battery''s own third release',
    ARRAY[v_a, v_b], ARRAY['0', '3']);

  -- ------------------------------------------------------------------ the frozen documents
  -- A snapshot pins a release by *name inside JSON*, which no foreign key can reach: the
  -- uuid column is constrained, the jsonb pair is not. T10 is therefore the assertion that
  -- the two halves of every pin still agree after a release has been retired underneath
  -- them — the case §11 says a guest link must survive.
  SELECT ARRAY[
           count(*) FILTER (WHERE v.tradition_pack_release_id IS NOT NULL)::text,
           count(*) FILTER (WHERE jsonb_typeof(v.snapshot -> 'tradition_pack_release')
                              = 'null')::text,
           count(*) FILTER (WHERE r.id IS NOT NULL
                              AND v.snapshot -> 'tradition_pack_release' ->> 'pack_key'
                                  = p.pack_key
                              AND v.snapshot -> 'tradition_pack_release' ->> 'release_number'
                                  = r.release_number::text)::text,
           count(*) FILTER (WHERE jsonb_typeof(v.snapshot -> 'tradition_pack_release')
                                = 'object'
                              AND (r.id IS NULL
                                   OR v.snapshot -> 'tradition_pack_release' ->> 'pack_key'
                                       IS DISTINCT FROM p.pack_key
                                   OR v.snapshot -> 'tradition_pack_release' ->> 'release_number'
                                       IS DISTINCT FROM r.release_number::text))::text,
           count(*) FILTER (WHERE v.snapshot IS NULL)::text,
           count(*)::text
         ]
    INTO v_set
    FROM public.invitation_versions v
    LEFT JOIN public.tradition_pack_releases r ON r.id = v.tradition_pack_release_id
    LEFT JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE v.wedding_id IN (SELECT wed FROM sf UNION ALL SELECT wed_ml FROM sf
                          UNION ALL SELECT wed_none FROM sf UNION ALL SELECT wed_dep FROM sf);
  PERFORM pg_temp.s4_eq('T10 of the ten documents this file froze, eight point at a release by uuid and name the same release inside their own JSON, two carry a JSON null because the host chose no pack, none has a snapshot-less row, and no jsonb pin disagrees with its uuid',
    v_set, ARRAY['8', '2', '8', '0', '0', '10']);

  PERFORM pg_temp.s4_eq('T10b and the jsonb pins name exactly the two releases the pinning group ever froze from, which is why two of the seven releases sit at zero holders the way groups A and I counted them',
    ARRAY(SELECT q.k FROM (
            SELECT DISTINCT (v.snapshot -> 'tradition_pack_release' ->> 'pack_key') || '/' ||
                            (v.snapshot -> 'tradition_pack_release' ->> 'release_number') AS k
              FROM public.invitation_versions v
             WHERE jsonb_typeof(v.snapshot -> 'tradition_pack_release') = 'object'
               AND v.wedding_id IN (SELECT wed FROM sf UNION ALL SELECT wed_ml FROM sf
                                    UNION ALL SELECT wed_none FROM sf
                                    UNION ALL SELECT wed_dep FROM sf)
          ) q ORDER BY q.k COLLATE "C"),
    ARRAY['stage4_doc_pinned/1', 'stage4_doc_pinned/2']);

  SELECT count(*)::text,
         count(*) FILTER (WHERE pg_temp.s4_dto(v.id) IS NOT NULL)::text
    INTO v_a, v_b
    FROM public.invitation_versions v
   WHERE v.wedding_id IN (SELECT wed FROM sf UNION ALL SELECT wed_ml FROM sf
                          UNION ALL SELECT wed_none FROM sf UNION ALL SELECT wed_dep FROM sf);
  PERFORM pg_temp.s4_eq('T11 every document this file froze still projects a guest document today, including the ones frozen from the release group A retired underneath them',
    ARRAY[v_a, v_b], ARRAY['10', '10']);

  -- ------------------------------------------------------------------ the rows around them
  SELECT count(*) FILTER (WHERE w.owner_user_id IN (SELECT host_a FROM sf
                                                    UNION ALL SELECT host_b FROM sf))::text,
         v_d_wed::text,
         (SELECT count(*) FROM public.invitation_drafts d
           WHERE d.wedding_id IN (SELECT wed FROM sf UNION ALL SELECT wed_ml FROM sf
                                  UNION ALL SELECT wed_none FROM sf
                                  UNION ALL SELECT wed_dep FROM sf))::text
    INTO v_a, v_b, v_c
    FROM public.weddings w;
  PERFORM pg_temp.s4_eq('T12 all five weddings this file added belong to one of its two fixture users — nothing was written in somebody else''s name — and the four fixture weddings each still hold the editable draft §3 says a wedding never loses',
    ARRAY[v_a, v_b, v_c], ARRAY['5', '5', '4']);

  SELECT count(*) FILTER (WHERE t.template_key = 'stage4-doc-template')::text,
         coalesce(string_agg(CASE WHEN t.template_key = 'stage4-doc-template'
                               THEN t.status END, ','), '(none)'),
         count(*) FILTER (WHERE t.template_key = 'stage4-doc-template'
                              AND t.status = 'approved')::text
    INTO v_a, v_b, v_c
    FROM public.design_templates t;
  PERFORM pg_temp.s4_eq('T12b the one template this file added is a single draft row and is not approved, so no layout a guest can be shown came from this battery uninvited',
    ARRAY[v_a, v_b, v_c], ARRAY['1', 'draft', '0']);

  SELECT count(*) FILTER (WHERE u.email LIKE 'stage4-doc-%@example.test')::text,
         count(*) FILTER (WHERE u.email LIKE 'stage4-doc-%'
                             AND u.email NOT LIKE '%@example.test')::text,
         v_d_user::text
    INTO v_a, v_b, v_c
    FROM auth.users u;
  PERFORM pg_temp.s4_eq('T12c both fixture users live under the reserved .example.test domain and neither looks like a mail route a message could ever reach',
    ARRAY[v_a, v_b, v_c], ARRAY['2', '0', '2']);

  -- ------------------------------------------------------------------ §6 separation, as a measurement
  PERFORM pg_temp.s4_jq('T13 the suites are separate sessions, checked rather than asserted in a comment: Stage 2''s counter is not set in this one, and this file''s own counter and its remembered baseline both are',
    jsonb_build_object('st2_passed_unset',
                       current_setting('st2.passed', true) IS NULL,
                       's4_passed_set',
                       nullif(current_setting('s4.passed', true), '') IS NOT NULL,
                       'baseline_remembered',
                       nullif(current_setting('s4.base_packs', true), '') IS NOT NULL),
    '{"st2_passed_unset": true, "s4_passed_set": true, "baseline_remembered": true}'::jsonb);

  -- ------------------------------------------------------------------ the floor
  -- Every list above is a set or a count, so an empty catalogue would satisfy several of
  -- them by accident; the floor is what says this run measured something. It is the number
  -- this chain printed, not one carried over from another branch, and it is this file's own
  -- total: Stage 2's 102 and Stage 3's are counted where they are printed, and T13 above
  -- checks that this session never read them.
  --
  -- Per group, counted from the PASS lines this chain actually printed (the run recorded in
  -- `supabase/tests/stage4/run.sh`'s header): BASE 1, L 5, P 38, LC 89, D 60 (43 refused
  -- definition cases, 6 accepted controls, 11 column rules), S 27, B 31, V 28, F 37, C 35,
  -- A 37, I 15, T 23 — 426 in all. Nothing here was ever part of Stage 2's total, and the two
  -- suites stay separate because §6 says they answer different questions. Re-measure and say
  -- so whenever an assertion is added or removed: a floor nobody re-measures stops meaning
  -- anything. The move from the 418 this file first printed is two repairs, each of which
  -- turned one vague claim into several measured ones: the unknown-section-kind case in C was
  -- split into the required/optional refusal, the freeze checker's naming of it, the inert
  -- projection, the preserved item count and the preserved order (C 29 → 35), and group A's
  -- grants claims were restated after §9 narrowed the customer's read path to a column grant,
  -- which added the customer-role refusal on the internals and the exact seven-column
  -- projection (A 35 → 37).
  IF (current_setting('s4.passed'))::int < 426 THEN
    RAISE EXCEPTION 'FAIL: only % Stage 4 document assertions ran — the measured floor is 426',
      (current_setting('s4.passed'))::int;
  END IF;
END $T$;

SELECT 'STAGE4 DOCUMENT TESTS PASSED (' || current_setting('s4.passed') || ')' AS result;
