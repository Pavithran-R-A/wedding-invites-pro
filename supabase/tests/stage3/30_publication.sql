-- Stage 3 §6/§14/§15/§16/§17 — the publication and credential rules, at the layer
-- where they are actually decided.
--
-- Run AFTER bootstrap + published migrations + the Stage 2, 3 and 4 chains, as the
-- trusted login role, in one transaction. `supabase/tests/stage2/run.sh`
-- applies this file between the draft invariant and the attack suites, so a Stage 3
-- loosening of a Stage 2 guarantee shows up here too. It cleans up after itself
-- (group Z) because `--single-transaction` *commits* a file that succeeds, and the
-- attack suite's exact counts run next.
--
-- Why a database-level file at all, when the headline of Stage 3 is the real API
-- stack: three rules have no HTTP shape that a test can reach.
--
--   * an *expired* credential — no test may sleep until a deadline, so the row is
--     aged honestly by moving `created_at` back with `expires_at` (the CHECK
--     requires `expires_at > created_at`, and honouring it is the point);
--   * the liveness predicates themselves, which the HTTP resolver reaches only
--     through a `request.headers` GUC that PostgREST writes;
--   * the composite foreign keys and the shape CHECK that make a cross-family or
--     mis-scoped credential *unrepresentable*, which need a row attempted rather
--     than a role switched.
--
-- Everything that depends on a real JWT — who may call what, what `auth.uid()`
-- resolves to, what an anonymous caller can enumerate, what a query string can
-- carry — is measured over HTTP in `supabase/tests/api/stage3_security.test.mjs`.
-- This file's `SET ROLE` plus `test.uid` is the shim's idea of a caller, and it is
-- labelled as such in `docs/audits/stage-3-public-invitation.md` rather than
-- described as an authentication test.
--
-- Refusals are told apart the way Stage 2 taught, because "it errored" proves
-- nothing: SQLSTATE *and* message are both matched, so a probe that passes because
-- of some unrelated failure (a missing column, a broken FK path, a typo in an id)
-- reports itself. A probe reporting 'no-error' is a failure, never a skipped line.
--
-- Two rules shape where statements may run, and both come from measured behaviour
-- rather than preference:
--
--   * row references inside probe statements come from `probe.*` settings, not from
--     the temp fixture table, because an impersonated role can call the pg_temp
--     helpers but cannot read a temp table it does not own;
--   * only `api.*` functions are ever called while holding `anon` or
--     `authenticated`. `private` has no USAGE for a browser role, so a helper call
--     there would fail for the very reason this file is testing and would be
--     indistinguishable from a real defect. Every read of `private.access_tokens`,
--     every snapshot patch and every direct write happens with the session back at
--     its own trusted role. That asymmetry is the property, not an inconvenience.

SET client_min_messages = notice;
SELECT set_config('st3p.passed', '0', false);

-- --------------------------------------------------------------------------- helpers
CREATE FUNCTION pg_temp.st3p_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('st3p.passed',
    (coalesce(nullif(current_setting('st3p.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.st3p_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.st3p_add(1);
END $fn$;

CREATE FUNCTION pg_temp.st3p_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.st3p_add(1);
END $fn$;

-- Which schema head this run is qualifying, as a fact about the run rather than about the schema.
-- Unset means this file's own head, so `supabase/tests/stage3/run.sh` needs no change and every
-- later chain can still qualify this suite by declaring its own head.
CREATE FUNCTION pg_temp.st3p_head() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(current_setting('app.stage_head', true), 'stage3') $fn$;

-- Cumulative, and spelled as an ordinal rather than an equality, because heads are cumulative: an
-- expectation keyed on `= 'stage5'` would hand the Stage 6 chain the Stage 5 expectations by
-- accident, which is the defect class this repair exists to remove. A malformed head raises instead
-- of silently selecting a branch, so a typo in `PGOPTIONS` reports itself rather than passing.
CREATE FUNCTION pg_temp.st3p_at_least(want text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $fn$
DECLARE h int; w int;
BEGIN
  IF pg_temp.st3p_head() !~ '^stage[0-9]+$' OR want !~ '^stage[0-9]+$' THEN
    RAISE EXCEPTION 'st3p_at_least: a stage head must be spelled stage<n> — got head=% want=%',
      pg_temp.st3p_head(), want;
  END IF;
  h := regexp_replace(pg_temp.st3p_head(), '^stage', '')::int;
  w := regexp_replace(want, '^stage', '')::int;
  RETURN h >= w;
END
$fn$;

-- SQLSTATE || message, or 'no-error'. SECURITY INVOKER, so the statement inside it
-- is checked against whatever role the session is holding.
CREATE FUNCTION pg_temp.st3p_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

-- The keys of one JSON object, byte-ordered on *both* sides so the comparison cannot
-- depend on the collation of the machine running it. Stage 2's catalogue check C26
-- failed once for exactly that reason: `ORDER BY` over names is locale-sensitive and
-- a hand-written expectation is not. Sorting the expected array here as well means a
-- reviewer reads a set, and no future edit has to know C order.
CREATE FUNCTION pg_temp.st3p_sorted(want text[]) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM unnest(coalesce(want, '{}'::text[])) u(k) $fn$;

CREATE FUNCTION pg_temp.st3p_top_keys(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM jsonb_object_keys(v) u(k) $fn$;

CREATE FUNCTION pg_temp.st3p_has_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % , not an object', label, jsonb_typeof(v);
  END IF;
  PERFORM pg_temp.st3p_eq(label, pg_temp.st3p_top_keys(v), pg_temp.st3p_sorted(want));
END $fn$;

-- Every key a projection carries, at any depth and including inside arrays. §14's
-- forbidden-field rule is a *closed set*, so it has to be enumerable from outside
-- the object rather than checked one name at a time.
CREATE FUNCTION pg_temp.st3p_keys(v jsonb) RETURNS TABLE(k text)
LANGUAGE plpgsql AS $fn$
DECLARE r record;
BEGIN
  IF jsonb_typeof(v) = 'object' THEN
    FOR r IN SELECT jsonb_object_keys(v) AS key LOOP
      k := r.key;
      RETURN NEXT;
      RETURN QUERY SELECT * FROM pg_temp.st3p_keys(v -> r.key);
    END LOOP;
  ELSIF jsonb_typeof(v) = 'array' THEN
    -- A RETURNS TABLE function with one column is not a composite value, so the
    -- array branch joins it laterally rather than expanding it with `(f(x)).k`.
    RETURN QUERY
      SELECT s.k FROM jsonb_array_elements(v) AS e(j)
                JOIN LATERAL pg_temp.st3p_keys(e.j) s ON true;
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.st3p_all_keys(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT pg_temp.st3p_sorted(coalesce(array_agg(DISTINCT q.k), '{}'::text[]))
    FROM pg_temp.st3p_keys(v) q $fn$;

-- The projection's whole universe of key names is exactly the documented set, so
-- nothing can leave that the whitelist never named.
CREATE FUNCTION pg_temp.st3p_universe(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_temp.st3p_eq(label, pg_temp.st3p_all_keys(v), pg_temp.st3p_sorted(want));
END $fn$;

-- ...and none of the banned names appears anywhere, named in the failure so a
-- regression says which field leaked rather than merely that one did.
CREATE FUNCTION pg_temp.st3p_no_forbidden(label text, v jsonb, banned text[])
RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE offenders text[];
BEGIN
  SELECT coalesce(array_agg(k), '{}'::text[]) INTO offenders
    FROM unnest(pg_temp.st3p_all_keys(v)) u(k)
   WHERE k = ANY (banned);
  IF cardinality(offenders) > 0 THEN
    RAISE EXCEPTION 'FAIL % — leaked %', label, offenders;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.st3p_add(1);
END $fn$;

-- A credential as an anonymous visitor experiences it: the header PostgREST itself
-- writes, and the zero-argument resolver. `raw IS NULL` means "sent no header at
-- all", which is how the missing-credential branch is reached without inventing one.
CREATE FUNCTION pg_temp.st3p_resolve(raw text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v_out jsonb;
BEGIN
  PERFORM set_config('request.headers',
    CASE WHEN raw IS NULL THEN '{}'::text
         ELSE jsonb_build_object('x-invitation-token', raw)::text END, false);
  EXECUTE 'SET ROLE anon';
  BEGIN
    SELECT api.resolve_public_invitation() INTO v_out;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v_out;
END $fn$;

-- The name a CHECK actually got. An unnamed table-level CHECK takes a positional
-- suffix (`access_tokens_check1`), which is both unstable across edit order and
-- unreadable in a failure message, so an expected refusal resolves the name from the
-- catalogue by what the constraint *says*. Ambiguity is an error rather than a pick.
CREATE FUNCTION pg_temp.st3p_check_name(p_ns text, p_rel text, p_like text)
RETURNS text
LANGUAGE plpgsql STABLE AS $fn$
DECLARE v_names text[];
BEGIN
  SELECT array_agg(c.conname) INTO v_names
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = p_ns AND t.relname = p_rel AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE p_like;
  IF v_names IS NULL OR cardinality(v_names) <> 1 THEN
    RAISE EXCEPTION 'FAIL: "%" on %.% matches % check constraint(s) %',
      p_like, p_ns, p_rel, coalesce(cardinality(v_names), 0), v_names;
  END IF;
  RETURN v_names[1];
END $fn$;

-- One probe set per expected refusal, consumed by the loop at the end of each group
-- so a missing expectation cannot pass silently: every row must report the state and
-- the sentence it asks for, and an empty group is itself a failure.
CREATE TEMP TABLE probes (grp text, label text, stmt text, want_state text, want_like text)
  ON COMMIT DROP;

CREATE FUNCTION pg_temp.st3p_run(p_grp text, p_role text, p_uid text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  v_labels text[];
  v_stmts  text[];
  v_states text[];
  v_likes  text[];
  v        text;
  i        integer;
  n        integer := 0;
BEGIN
  -- The role name is interpolated into a statement, so it is a whitelist rather than
  -- a parameter a fixture could steer.
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;

  -- Loaded before the role changes, for the reason in this file's header.
  SELECT array_agg(label), array_agg(stmt), array_agg(want_state), array_agg(want_like)
    INTO v_labels, v_stmts, v_states, v_likes
    FROM (SELECT p.label, p.stmt, p.want_state, p.want_like
            FROM probes p WHERE p.grp = st3p_run.p_grp ORDER BY p.label) s;

  IF v_labels IS NULL THEN
    RAISE EXCEPTION 'FAIL: probe group % ran no probes', p_grp;
  END IF;

  FOR i IN 1 .. cardinality(v_labels) LOOP
    EXECUTE 'SET ROLE ' || p_role;
    IF p_uid IS NOT NULL THEN
      PERFORM set_config('test.uid', p_uid, false);
    END IF;

    v := pg_temp.st3p_err(v_stmts[i]);
    EXECUTE 'RESET ROLE';

    IF v = 'no-error' THEN
      RAISE EXCEPTION 'FAIL %: "%" was allowed through', p_grp, v_labels[i];
    END IF;
    IF split_part(v, ' ', 1) <> v_states[i] OR v NOT LIKE v_likes[i] THEN
      RAISE EXCEPTION 'FAIL %: "%" got [%] want [% / %]',
        p_grp, v_labels[i], v, v_states[i], v_likes[i];
    END IF;

    n := n + 1;
    PERFORM pg_temp.st3p_add(1);
  END LOOP;

  RAISE NOTICE 'PASS %: % probes refused exactly as expected', p_grp, n;
END $fn$;

-- ===========================================================================
-- Fixture: two complete families
-- ===========================================================================
--
-- Both weddings carry people, a venue, an event and a drafted invitation before
-- anything is attacked. §22's rule is that a refusal which would fail anyway (for
-- want of a required row) is not evidence, so every cross-account probe below aims
-- at a wedding that genuinely has content to publish.
--
-- The sentinels are load-bearing. Each one names the thing it must never become: a
-- draft key outside the contract, a template or pack internal, a host-only note, a
-- guest-list entry. If any appears in a guest-facing string, the assertion that
-- fails says which one.
CREATE TEMP TABLE pf ON COMMIT DROP AS
SELECT gen_random_uuid() AS owner_c, gen_random_uuid() AS owner_d,
       gen_random_uuid() AS wed_c,   gen_random_uuid() AS wed_d,
       gen_random_uuid() AS wed_bare, gen_random_uuid() AS household_c,
       gen_random_uuid() AS household_d, gen_random_uuid() AS tmpl_c,
       gen_random_uuid() AS no_such;

INSERT INTO auth.users (id, email) VALUES
  ((SELECT owner_c FROM pf), 'host-c@stage3pub.test'),
  ((SELECT owner_d FROM pf), 'host-d@stage3pub.test');

SELECT set_config('probe.owner_c',     (SELECT owner_c::text     FROM pf), false);
SELECT set_config('probe.owner_d',     (SELECT owner_d::text     FROM pf), false);
SELECT set_config('probe.wed_c',       (SELECT wed_c::text       FROM pf), false);
SELECT set_config('probe.wed_d',       (SELECT wed_d::text       FROM pf), false);
SELECT set_config('probe.wed_bare',    (SELECT wed_bare::text    FROM pf), false);
SELECT set_config('probe.household_c', (SELECT household_c::text FROM pf), false);
SELECT set_config('probe.household_d', (SELECT household_d::text FROM pf), false);
SELECT set_config('probe.no_such',     (SELECT no_such::text     FROM pf), false);
-- Two digests of known text, so a probe can name a value it is allowed to invent:
-- nothing here ever needs a raw token back.
SELECT set_config('probe.hash_a',
  encode(extensions.digest(convert_to('stage3-probe-a', 'UTF8'), 'sha256'), 'hex'), false);
SELECT set_config('probe.hash_b',
  encode(extensions.digest(convert_to('stage3-probe-b', 'UTF8'), 'sha256'), 'hex'), false);

-- Neither wedding selects a tradition pack. Stage 3 left this file seeding one, and a
-- pack release is now a row that walks a lifecycle: an approved release cannot be
-- deleted by anybody, by design (`supabase/migrations/20260927120000_…sql` §3), so this
-- file's group Z erasure could no longer remove its own fixture. The pack-bearing guest
-- document — including every closure property this file asserts for the pack-less one,
-- and the release-pinning rules Stage 4 exists for — is qualified in
-- `supabase/tests/stage4/50_pack_release.sql`, which runs last in the chain for exactly
-- that reason and leaves its approved rows to the throwaway database that dies with them.
INSERT INTO public.design_templates (id, template_key, revision, display_name,
                                     layout_settings, preview_svg)
SELECT tmpl_c, 'stage3-probe-template', 2, 'Stage 3 Probe Template',
       '{"margins":"SENTINEL-LAYOUT-SETTINGS"}'::jsonb,
       '<svg><text>SENTINEL-PREVIEW-SVG</text></svg>' FROM pf;

-- Seeded by the maintenance role: this file is about publication, and the owner's
-- own create path is already proved by the draft-invariant suite that runs before it.
INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages,
                             style_settings, design_template_id)
SELECT wed_c, owner_c, 'Asha weds Bala', 'en', ARRAY['ta'],
       '{"font":"Playfair Display","fontSize":"24","color":"#C9972F","alignment":"center","foilEnabled":true}',
       tmpl_c
  FROM pf;
-- The second family has no template attached either: the branch that must produce a
-- JSON null rather than an invented one.
INSERT INTO public.weddings (id, owner_user_id, title, primary_language, style_settings)
SELECT wed_d, owner_d, 'Bala weds Divya', 'ta',
       '{"font":"Mukta Malar","fontSize":"20","color":"#7a1f1f","alignment":"left"}' FROM pf;
-- A third wedding with no language chosen, which Stage 3 must refuse to version.
INSERT INTO public.weddings (id, owner_user_id, title) SELECT wed_bare, owner_c, 'No language yet' FROM pf;

INSERT INTO public.wedding_people (wedding_id, display_name, role_key, role_label, group_key, group_label, display_order)
SELECT wed_c, 'Maran', 'father', 'Father', 'bride-side', 'The families of', 0 FROM pf
UNION ALL SELECT wed_c, 'Kali', 'mother', 'Mother', 'bride-side', 'The families of', 1 FROM pf
UNION ALL SELECT wed_c, 'Sivakami', 'sibling', NULL, NULL, NULL, 2 FROM pf
UNION ALL SELECT wed_d, 'Thevars', 'family', NULL, NULL, NULL, 0 FROM pf;

INSERT INTO public.venues (wedding_id, name, address_text, map_url, notes)
SELECT wed_c, 'Kalyana Mantapa', '1 Museum Road, Madurai', 'https://maps.example.test/km',
       'SENTINEL-VENUE-NOTE' FROM pf;
INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local, ends_at_local,
                                   timezone, venue_id, display_order, notes)
SELECT wed_c, 'muurtham', 'Muurtham', '2026-11-14 07:30', '2026-11-14 11:00', 'Asia/Kolkata',
       (SELECT id FROM public.venues v JOIN pf ON v.wedding_id = pf.wed_c), 0,
       'SENTINEL-EVENT-NOTE' FROM pf;
-- A disabled event and an unused venue: neither is part of the message, so both have
-- to be absent from a frozen version written while they existed.
INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local, display_order, enabled)
SELECT wed_c, 'reception', 'SENTINEL-DISABLED-EVENT', '2026-11-14 19:00', 1, false FROM pf;
INSERT INTO public.venues (wedding_id, name, address_text)
SELECT wed_c, 'SENTINEL-UNUSED-HALL', 'Nowhere' FROM pf;
INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local, display_order)
SELECT wed_d, 'muurtham', 'Muhurtham', '2026-12-01 06:00', 0 FROM pf;

INSERT INTO public.guest_households (id, wedding_id, display_name, salutation, host_notes)
SELECT household_c, wed_c, 'SENTINEL-HOUSEHOLD The Raman family', 'Dear Raman family',
       'Vegetarian, needs a ride' FROM pf
UNION ALL SELECT household_d, wed_d, 'SENTINEL-HOUSEHOLD-D', 'Dear Thevar family', NULL FROM pf;

-- The draft rows arrive by trigger; filling them in is the only edit needed.
UPDATE public.invitation_drafts d SET content =
  '{"welcome":"With the blessings of our families","family_introduction":"Our families invite you",
    "event_notes":"Lunch follows the ceremony","closing":"With love","heading":"SENTINEL-HEADING-KEY"}'::jsonb
  FROM pf WHERE d.wedding_id = pf.wed_c;
UPDATE public.invitation_drafts d SET content =
  '{"welcome":"Invoker words","closing":"Nandri"}'::jsonb
  FROM pf WHERE d.wedding_id = pf.wed_d;

DO $A$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.weddings
   WHERE id IN (current_setting('probe.wed_c')::uuid, current_setting('probe.wed_d')::uuid,
                current_setting('probe.wed_bare')::uuid);
  PERFORM pg_temp.st3p_eq('A1 all three fixture weddings exist', v_count, 3::bigint);

  SELECT count(*) INTO v_count FROM public.invitation_drafts d
   WHERE d.wedding_id IN (current_setting('probe.wed_c')::uuid,
                          current_setting('probe.wed_d')::uuid,
                          current_setting('probe.wed_bare')::uuid);
  PERFORM pg_temp.st3p_eq('A2 every one arrived with exactly the draft the trigger creates', v_count, 3::bigint);

  SELECT count(*) INTO v_count FROM public.wedding_events e
   WHERE e.wedding_id = current_setting('probe.wed_c')::uuid AND e.enabled;
  PERFORM pg_temp.st3p_eq('A3 exactly one of the two events is enabled, so the freeze has something to drop',
    v_count, 1::bigint);

  PERFORM pg_temp.st3p_ok('A4 the language-less wedding really is language-less, so B''s refusal aims at a real row',
    (SELECT w.primary_language IS NULL FROM public.weddings w
      WHERE w.id = current_setting('probe.wed_bare')::uuid));

  PERFORM pg_temp.st3p_ok('A5 the positional CHECK names this file refuses against are unique and resolved',
    pg_temp.st3p_check_name('private', 'access_tokens', $q$%expiry_policy = 'fixed'::text%$q$) IS NOT NULL
    AND pg_temp.st3p_check_name('private', 'access_tokens', '%expires_at > created_at%') IS NOT NULL
    AND pg_temp.st3p_check_name('public', 'publications', $q$%status = 'active'%$q$) IS NOT NULL);
END $A$;

-- ===========================================================================
-- B. Version creation, by its owner, through the api boundary
-- ===========================================================================
DO $B$
DECLARE
  v_res  jsonb;
  v_res2 jsonb;
  v_snap jsonb;
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  SELECT api.create_invitation_version(current_setting('probe.wed_c')::uuid) INTO v_res;
  SELECT api.create_invitation_version(current_setting('probe.wed_c')::uuid) INTO v_res2;
  EXECUTE 'RESET ROLE';

  v_snap := v_res -> 'snapshot';

  PERFORM pg_temp.st3p_has_keys('B1 the host gets back exactly what it needs and nothing else',
    v_res, ARRAY['snapshot', 'version_id', 'version_number']);
  PERFORM pg_temp.st3p_has_keys('B2 the snapshot is the seven-part document',
    v_snap, ARRAY['wedding', 'design_template', 'tradition_pack_release', 'sections',
                  'people', 'events', 'draft']);
  PERFORM pg_temp.st3p_eq('B3 the first version is number 1', (v_res ->> 'version_number')::int, 1);
  PERFORM pg_temp.st3p_eq('B4 the second numbers itself after the first', (v_res2 ->> 'version_number')::int, 2);
  PERFORM pg_temp.st3p_eq('B5 the stored version declares the shape the projection understands',
    (SELECT iv.snapshot_schema_version FROM public.invitation_versions iv
      WHERE iv.id = (v_res ->> 'version_id')::uuid), 2);
  PERFORM pg_temp.st3p_eq('B6 both versions are stored as separate rows',
    (SELECT count(*) FROM public.invitation_versions
      WHERE wedding_id = current_setting('probe.wed_c')::uuid), 2::bigint);
  PERFORM pg_temp.st3p_ok('B7 the second names the first in its lineage',
    (SELECT iv.supersedes_version_id FROM public.invitation_versions iv
      WHERE iv.id = (v_res2 ->> 'version_id')::uuid) = (v_res ->> 'version_id')::uuid);
  PERFORM pg_temp.st3p_ok('B8 the first supersedes nothing',
    (SELECT iv.supersedes_version_id FROM public.invitation_versions iv
      WHERE iv.id = (v_res ->> 'version_id')::uuid) IS NULL);
  PERFORM pg_temp.st3p_ok('B9 the stored snapshot is the one that was handed back',
    (SELECT iv.snapshot::text FROM public.invitation_versions iv
      WHERE iv.id = (v_res ->> 'version_id')::uuid) = v_snap::text);
  PERFORM pg_temp.st3p_eq('B10 versioning wrote no credential and no publication',
    ARRAY[(SELECT count(*) FROM public.publications),
          (SELECT count(*) FROM private.access_tokens)], ARRAY[0::bigint, 0::bigint]);
  PERFORM pg_temp.st3p_ok('B11 the row is attributed to the host who asked, not to a role name',
    (SELECT iv.created_by FROM public.invitation_versions iv
      WHERE iv.id = (v_res ->> 'version_id')::uuid) = current_setting('probe.owner_c')::uuid);
  PERFORM pg_temp.st3p_eq('B12 with nothing edited in between, the second document is identical',
    (v_res2 -> 'snapshot') = v_snap, true);

  -- ---- what the snapshot is made of -------------------------------------
  PERFORM pg_temp.st3p_has_keys('B13 the wedding block is title, languages and style only',
    v_snap -> 'wedding',
    ARRAY['title', 'primary_language', 'additional_languages', 'style_settings']);
  PERFORM pg_temp.st3p_has_keys('B14 the template block carries identity and display settings',
    v_snap -> 'design_template',
    ARRAY['template_key', 'revision', 'display_name', 'layout_settings', 'supported_languages']);
  PERFORM pg_temp.st3p_eq('B15 a wedding with no pack records no pack, and does not invent one',
    jsonb_typeof(v_snap -> 'tradition_pack_release'), 'null');
  PERFORM pg_temp.st3p_has_keys('B15b the section list says what was asked for and what resolved',
    v_snap -> 'sections', ARRAY['requested', 'items']);
  PERFORM pg_temp.st3p_eq('B15c this wedding asked for English',
    v_snap -> 'sections' ->> 'requested', 'en');
  PERFORM pg_temp.st3p_eq('B15d with no pack selected the platform default gives six ordered sections',
    ARRAY(SELECT s ->> 'section_key' FROM jsonb_array_elements(v_snap -> 'sections' -> 'items') s
           ORDER BY (s ->> 'position')::integer),
    ARRAY['welcome', 'family_introduction', 'family', 'ceremonies', 'event_notes', 'closing']);
  PERFORM pg_temp.st3p_eq('B15e a host-authored section resolves to the host, and a list section to nothing',
    ARRAY(SELECT coalesce(s ->> 'body_source', '(none)')
            FROM jsonb_array_elements(v_snap -> 'sections' -> 'items') s
           ORDER BY (s ->> 'position')::integer),
    ARRAY['host', 'host', '(none)', '(none)', 'host', 'host']);
  PERFORM pg_temp.st3p_eq('B15f and nothing claims to have overridden a pack it never had',
    (SELECT count(*) FROM jsonb_array_elements(v_snap -> 'sections' -> 'items') s
      WHERE coalesce((s ->> 'overrode_pack_text')::boolean, false)), 0::bigint);
  PERFORM pg_temp.st3p_eq('B15g the one section the default gives a heading to is the event list',
    ARRAY(SELECT coalesce(s ->> 'heading_text', '(none)')
            FROM jsonb_array_elements(v_snap -> 'sections' -> 'items') s
           ORDER BY (s ->> 'position')::integer),
    ARRAY['(none)', '(none)', '(none)', 'The ceremonies', '(none)', '(none)']);
  PERFORM pg_temp.st3p_has_keys('B16 the draft contributes its four sections, not the whole blob',
    v_snap -> 'draft',
    ARRAY['welcome', 'family_introduction', 'event_notes', 'closing']);
  PERFORM pg_temp.st3p_has_keys('B17 a person is a name and two optional labels',
    v_snap -> 'people' -> 0,
    ARRAY['display_name', 'role_key', 'role_label', 'group_key', 'group_label']);
  PERFORM pg_temp.st3p_has_keys('B18 an event is a time and a place',
    v_snap -> 'events' -> 0,
    ARRAY['event_key', 'display_name', 'starts_at_local', 'ends_at_local', 'timezone', 'venue']);
  PERFORM pg_temp.st3p_has_keys('B19 the venue is resolved inline, so the version reads on its own',
    v_snap -> 'events' -> 0 -> 'venue',
    ARRAY['name', 'address_text', 'map_url']);
  PERFORM pg_temp.st3p_eq('B20 the event list dropped the disabled one',
    (SELECT count(*) FROM jsonb_array_elements(v_snap -> 'events')), 1::bigint);
  PERFORM pg_temp.st3p_eq('B21 people are in display order',
    ARRAY(SELECT p ->> 'display_name' FROM jsonb_array_elements(v_snap -> 'people') p),
    ARRAY['Maran', 'Kali', 'Sivakami']);
  PERFORM pg_temp.st3p_eq('B22 the event carries the wall-clock time, unshifted',
    v_snap -> 'events' -> 0 ->> 'starts_at_local', '2026-11-14T07:30:00');
  PERFORM pg_temp.st3p_eq('B23 and its end time beside it',
    v_snap -> 'events' -> 0 ->> 'ends_at_local', '2026-11-14T11:00:00');
  PERFORM pg_temp.st3p_ok('B24 no uuid-shaped value appears anywhere in the snapshot',
    v_snap::text !~ '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}');
  PERFORM pg_temp.st3p_ok('B25 no email-shaped value appears anywhere in it',
    v_snap::text !~ '@[A-Za-z0-9.-]+\.[A-Za-z]{2,}');
  PERFORM pg_temp.st3p_no_forbidden('B26 the snapshot carries no internal name of any kind', v_snap,
    ARRAY['created_at', 'updated_at', 'published_at', 'revoked_at', 'expires_at', 'reviewed_at',
          'preview_svg', 'reviewed_by', 'review_notes', 'id', 'wedding_id', 'venue_id',
          'token_hash', 'owner_user_id', 'email', 'password', 'notes', 'enabled', 'status']);
  PERFORM pg_temp.st3p_ok('B27 every sentinel planted outside the contract is absent',
    v_snap::text NOT LIKE '%SENTINEL-HEADING-KEY%'
    AND v_snap::text NOT LIKE '%SENTINEL-PREVIEW-SVG%'
    AND v_snap::text NOT LIKE '%SENTINEL-VENUE-NOTE%'
    AND v_snap::text NOT LIKE '%SENTINEL-EVENT-NOTE%'
    AND v_snap::text NOT LIKE '%SENTINEL-DISABLED-EVENT%'
    AND v_snap::text NOT LIKE '%SENTINEL-UNUSED-HALL%'
    AND v_snap::text NOT LIKE '%SENTINEL-HOUSEHOLD%');
  PERFORM pg_temp.st3p_ok('B28 the assets and the entitlements are not part of an invitation',
    v_snap::text NOT LIKE '%object_key%' AND v_snap::text NOT LIKE '%package_code%'
    AND v_snap::text NOT LIKE '%entitlement%');

  -- ---- refusals ---------------------------------------------------------
  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('B', 'another account cannot version this family''s invitation',
     $t$SELECT api.create_invitation_version(current_setting('probe.wed_c')::uuid)$t$,
     '42501', '%may not create a version of this wedding%'),
    ('B', 'a wedding that does not exist is refused with the same words',
     $t$SELECT api.create_invitation_version(current_setting('probe.no_such')::uuid)$t$,
     '42501', '%may not create a version of this wedding%'),
    ('B', 'and so is a half-built wedding belonging to someone else',
     $t$SELECT api.create_invitation_version(current_setting('probe.wed_bare')::uuid)$t$,
     '42501', '%may not create a version of this wedding%');
  PERFORM pg_temp.st3p_run('B', 'authenticated', current_setting('probe.owner_d'));

  -- The language rule is therefore only reachable by its own owner, and that is the
  -- half of the claim worth making: ownership is decided before content.
  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('B4', 'a wedding of mine with no language chosen cannot be frozen',
     $t$SELECT api.create_invitation_version(current_setting('probe.wed_bare')::uuid)$t$,
     '23514', '%choose the invitation language before creating a version%');
  PERFORM pg_temp.st3p_run('B4', 'authenticated', current_setting('probe.owner_c'));
END $B$;

-- ===========================================================================
-- B2/B3. Who may not reach the boundary at all
-- ===========================================================================
--
-- These are grant-layer refusals, and they are the ones `SET ROLE` can honestly
-- produce: the error names the schema or the function, never a row. What a real JWT
-- buys is measured over HTTP.
DO $B2$
BEGIN
  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('B2', 'anon cannot create a version',
     $t$SELECT api.create_invitation_version(current_setting('probe.wed_c')::uuid)$t$,
     '42501', '%permission denied for function create_invitation_version%'),
    ('B2', 'anon cannot publish',
     $t$SELECT api.publish_invitation_version(current_setting('probe.wed_c')::uuid, NULL, NULL)$t$,
     '42501', '%permission denied for function publish_invitation_version%'),
    ('B2', 'anon cannot rotate',
     $t$SELECT api.rotate_invitation_token(current_setting('probe.wed_c')::uuid)$t$,
     '42501', '%permission denied for function rotate_invitation_token%'),
    ('B2', 'anon cannot revoke',
     $t$SELECT api.revoke_invitation_publication(current_setting('probe.wed_c')::uuid)$t$,
     '42501', '%permission denied for function revoke_invitation_publication%'),
    ('B2', 'anon cannot preview',
     $t$SELECT api.preview_invitation(current_setting('probe.wed_c')::uuid)$t$,
     '42501', '%permission denied for function preview_invitation%'),
    ('B2', 'anon cannot read the publication state',
     $t$SELECT api.get_invitation_publication_state(current_setting('probe.wed_c')::uuid)$t$,
     '42501', '%permission denied for function get_invitation_publication_state%');
  PERFORM pg_temp.st3p_run('B2', 'anon', NULL);

  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('B3', 'service_role does not enter through the browser''s front door',
     $t$SELECT api.resolve_public_invitation()$t$,
     '42501', '%permission denied for schema api%'),
    ('B3', 'and not the host boundary either',
     $t$SELECT api.create_invitation_version(current_setting('probe.wed_c')::uuid)$t$,
     '42501', '%permission denied for schema api%');
  PERFORM pg_temp.st3p_run('B3', 'service_role', NULL);
END $B2$;

-- ===========================================================================
-- C. Publishing, and what a minted credential is made of
-- ===========================================================================
DO $C$
DECLARE
  v_pub     jsonb;
  v_pub_d   jsonb;
  v_new     jsonb;
  v_vid     uuid;
  v_vid_d   uuid;
  v_token   text;
  v_row     private.access_tokens%ROWTYPE;
  v_row_id  uuid;
  v_draft   jsonb;
  v_frozen  text;
  v_nop     jsonb;
  v_future  timestamptz := now() + interval '7 days';
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  SELECT (api.create_invitation_version(current_setting('probe.wed_c')::uuid) ->> 'version_id')::uuid
    INTO v_vid;
  SELECT api.publish_invitation_version(current_setting('probe.wed_c')::uuid, v_vid, NULL)
    INTO v_pub;
  EXECUTE 'RESET ROLE';

  v_token := substr(v_pub ->> 'path', 4);
  -- Carried forward in a session setting. The raw credential exists in exactly one
  -- place after this call returns and no later group can re-derive it from a digest;
  -- that is the property, so the test honours it.
  PERFORM set_config('probe.token_c', v_token, false);

  PERFORM pg_temp.st3p_has_keys('C1 publish returns the five fields a host needs',
    v_pub, ARRAY['publication_id', 'version_id', 'path', 'link_reused', 'expires_at']);
  PERFORM pg_temp.st3p_ok('C2 the address is /i/ plus 43 url-safe characters and nothing else',
    (v_pub ->> 'path') ~ '^/i/[A-Za-z0-9_-]{43}$' AND length(v_token) = 43);
  PERFORM pg_temp.st3p_eq('C3 the first publish mints rather than reuses',
    (v_pub ->> 'link_reused')::boolean, false);
  PERFORM pg_temp.st3p_eq('C4 with no expiry requested the answer says so in JSON, not by omission',
    jsonb_typeof(v_pub -> 'expires_at'), 'null');
  PERFORM pg_temp.st3p_eq('C5 the publication points at exactly the version that was published',
    v_pub ->> 'version_id', v_vid::text);
  PERFORM pg_temp.st3p_eq('C6 the publication row is active and unrevoked',
    (SELECT ARRAY[p.status, (p.revoked_at IS NULL)::text] FROM public.publications p
      WHERE p.id = (v_pub ->> 'publication_id')::uuid), ARRAY['active', 'true']);

  SELECT * INTO v_row FROM private.access_tokens
   WHERE wedding_id = current_setting('probe.wed_c')::uuid;
  v_row_id := v_row.id;
  PERFORM pg_temp.st3p_eq('C7 exactly one credential row exists for this family',
    (SELECT count(*) FROM private.access_tokens
      WHERE wedding_id = current_setting('probe.wed_c')::uuid), 1::bigint);
  PERFORM pg_temp.st3p_ok('C8 what is stored is a 64-hex digest', v_row.token_hash ~ '^[0-9a-f]{64}$');
  PERFORM pg_temp.st3p_eq('C9 the stored digest is the digest of the token that was handed out',
    v_row.token_hash, encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'));
  PERFORM pg_temp.st3p_ok('C10 the stored value is not the token', v_row.token_hash <> v_token);
  PERFORM pg_temp.st3p_ok('C11 the raw token appears nowhere in the row as stored',
    row_to_json(v_row)::text NOT LIKE '%' || v_token || '%');
  PERFORM pg_temp.st3p_eq('C12 the credential is a public invitation and nothing else',
    v_row.token_kind, 'public_invitation');
  PERFORM pg_temp.st3p_ok('C13 it names one publication, one wedding, and no other scope',
    v_row.publication_id = (v_pub ->> 'publication_id')::uuid
    AND v_row.household_id IS NULL AND v_row.approval_request_id IS NULL
    AND v_row.approval_version_id IS NULL);
  PERFORM pg_temp.st3p_eq('C14 a null expiry is a declared policy, not an omission',
    ARRAY[v_row.expiry_policy, (v_row.expires_at IS NULL)::text, (v_row.revoked_at IS NULL)::text],
    ARRAY['no_expiry', 'true', 'true']);
  PERFORM pg_temp.st3p_ok('C15 the mint is attributed to the trusted path, not to the browser role',
    v_row.created_by_role IN ('postgres', 'service_role'));
  PERFORM set_config('probe.hash_live', v_row.token_hash, false);

  -- Superseding keeps the address the family already shared, so a typo fix does not
  -- strand a hundred guests. The draft and the frozen version must both survive it.
  SELECT d.content INTO v_draft FROM public.invitation_drafts d
   WHERE d.wedding_id = current_setting('probe.wed_c')::uuid;

  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  SELECT api.create_invitation_version(current_setting('probe.wed_c')::uuid) INTO v_new;
  v_vid    := (v_new ->> 'version_id')::uuid;
  v_frozen := (v_new -> 'snapshot')::text;
  SELECT api.publish_invitation_version(current_setting('probe.wed_c')::uuid, v_vid, NULL)
    INTO v_pub;
  EXECUTE 'RESET ROLE';

  PERFORM pg_temp.st3p_eq('C16 republishing a new version reports a reuse rather than a new secret',
    (v_pub ->> 'link_reused')::boolean, true);
  PERFORM pg_temp.st3p_eq('C17 and hands back no address, because there is nothing new to send',
    jsonb_typeof(v_pub -> 'path'), 'null');
  PERFORM pg_temp.st3p_ok('C18 the credential row that moved is the one that already existed',
    (SELECT t.id FROM private.access_tokens t
      WHERE t.wedding_id = current_setting('probe.wed_c')::uuid) = v_row_id);
  PERFORM pg_temp.st3p_ok('C19 it now points at the new publication',
    (SELECT t.publication_id FROM private.access_tokens t WHERE t.id = v_row_id)
      = (v_pub ->> 'publication_id')::uuid);
  PERFORM pg_temp.st3p_eq('C20 the previous publication is revoked history, not rewritten',
    (SELECT count(*) FROM public.publications p
      WHERE p.wedding_id = current_setting('probe.wed_c')::uuid AND p.status = 'revoked'), 1::bigint);
  PERFORM pg_temp.st3p_eq('C21 exactly one publication is active for the wedding',
    (SELECT count(*) FROM public.publications
      WHERE wedding_id = current_setting('probe.wed_c')::uuid AND status = 'active'), 1::bigint);
  PERFORM pg_temp.st3p_eq('C22 and exactly one live credential',
    (SELECT count(*) FROM private.access_tokens
      WHERE wedding_id = current_setting('probe.wed_c')::uuid AND revoked_at IS NULL), 1::bigint);
  PERFORM pg_temp.st3p_ok('C23 publishing did not touch the draft',
    (SELECT d.content FROM public.invitation_drafts d
      WHERE d.wedding_id = current_setting('probe.wed_c')::uuid) = v_draft);
  PERFORM pg_temp.st3p_ok('C24 publishing did not touch the version it published',
    (SELECT iv.snapshot::text FROM public.invitation_versions iv WHERE iv.id = v_vid) = v_frozen);
  PERFORM pg_temp.st3p_ok('C25 the address the guest was given still resolves after the reuse',
    (pg_temp.st3p_resolve(current_setting('probe.token_c')) ->> 'available')::boolean);

  -- ---- the expiry branch, on the second family --------------------------
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_d'), false);
  SELECT (api.create_invitation_version(current_setting('probe.wed_d')::uuid) ->> 'version_id')::uuid
    INTO v_vid_d;
  SELECT api.publish_invitation_version(current_setting('probe.wed_d')::uuid, v_vid_d, v_future)
    INTO v_pub_d;
  EXECUTE 'RESET ROLE';

  PERFORM pg_temp.st3p_eq('C26 a future expiry comes back as the expiry it was given',
    (v_pub_d ->> 'expires_at')::timestamptz, v_future);
  PERFORM pg_temp.st3p_eq('C27 and the row says the same thing',
    (SELECT ARRAY[t.expiry_policy, (t.expires_at = v_future)::text] FROM private.access_tokens t
      WHERE t.wedding_id = current_setting('probe.wed_d')::uuid), ARRAY['fixed', 'true']);
  PERFORM pg_temp.st3p_ok('C28 the expiring link is still a link a guest can open',
    (v_pub_d ->> 'path') ~ '^/i/[A-Za-z0-9_-]{43}$');
  PERFORM set_config('probe.token_d', substr(v_pub_d ->> 'path', 4), false);
  PERFORM pg_temp.st3p_eq('C29 the two families hold two different secrets',
    (SELECT count(DISTINCT t.token_hash) FROM private.access_tokens t), 2::bigint);
  PERFORM pg_temp.st3p_eq('C30 no expiry was asked for the first family, so none was invented',
    (SELECT t.expires_at IS NULL FROM private.access_tokens t
      WHERE t.wedding_id = current_setting('probe.wed_c')::uuid), true);

  -- The address a host is handed is a path, not a claim about a host name: no
  -- deployment's domain may be baked into frozen content (directive §7).
  PERFORM pg_temp.st3p_ok('C31 the path carries no scheme, host or port to bake into a link',
    (v_pub_d ->> 'path') !~ '://'
    AND (v_pub_d ->> 'path') !~ '//'
    AND (v_pub_d ->> 'path') !~ ':'
    AND (v_pub_d ->> 'path') !~ '\.');

  -- Read while still the maintenance role: a probe runs impersonated, and an
  -- impersonated caller cannot reach `private` to fetch the id it wants to misuse.
  PERFORM set_config('probe.pub_d_c', (SELECT t.publication_id::text FROM private.access_tokens t
    WHERE t.wedding_id = current_setting('probe.wed_d')::uuid), false);
  -- Likewise the version the first family is currently showing: the probe that
  -- republishes it must not have to read `publications` as a host, which is denied.
  PERFORM set_config('probe.ver_live_c', (SELECT p.version_id::text FROM public.publications p
    WHERE p.wedding_id = current_setting('probe.wed_c')::uuid AND p.status = 'active'), false);

  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('C', 'an expiry in the past is refused',
     $t$SELECT api.publish_invitation_version(current_setting('probe.wed_d')::uuid,
            (SELECT (array_agg(iv.id ORDER BY iv.version_number))[1] FROM public.invitation_versions iv
              WHERE iv.wedding_id = current_setting('probe.wed_d')::uuid),
            (now() - interval '1 hour'))$t$,
     '23514', '%an expiring link must be given a time in the future%'),
    ('C', 'someone else''s wedding refuses before anyone is asked which version',
     $t$SELECT api.publish_invitation_version(current_setting('probe.wed_c')::uuid,
            (SELECT (array_agg(iv.id ORDER BY iv.version_number))[1] FROM public.invitation_versions iv
              WHERE iv.wedding_id = current_setting('probe.wed_d')::uuid), NULL)$t$,
     '42501', '%the caller may not publish this wedding%'),
    ('C', 'a foreign version of one''s own wedding is refused by the function, not by a key',
     $t$SELECT api.publish_invitation_version(current_setting('probe.wed_d')::uuid,
            (SELECT (array_agg(iv.id ORDER BY iv.version_number))[1] FROM public.invitation_versions iv
              WHERE iv.wedding_id = current_setting('probe.wed_c')::uuid), NULL)$t$,
     '42501', '%that version is not a version of this wedding%'),
    ('C', 'a version that never existed is refused with the same words as someone else''s',
     $t$SELECT api.publish_invitation_version(current_setting('probe.wed_d')::uuid,
            current_setting('probe.no_such')::uuid, NULL)$t$,
     '42501', '%that version is not a version of this wedding%'),
    ('C', 'a publication id supplied where a version id belongs is refused the same way',
     $t$SELECT api.publish_invitation_version(current_setting('probe.wed_d')::uuid,
            current_setting('probe.pub_d_c')::uuid, NULL)$t$,
     '42501', '%that version is not a version of this wedding%');
  PERFORM pg_temp.st3p_run('C', 'authenticated', current_setting('probe.owner_d'));

  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('C2', 'a version cannot be published on top of itself',
     $t$SELECT api.publish_invitation_version(current_setting('probe.wed_c')::uuid,
            current_setting('probe.ver_live_c')::uuid, NULL)$t$,
     '23514', '%this version is already the published one%'),
    ('C2', 'and a past expiry on one''s own real version is still refused',
     $t$SELECT api.publish_invitation_version(current_setting('probe.wed_c')::uuid,
            (SELECT (array_agg(iv.id ORDER BY iv.version_number))[1] FROM public.invitation_versions iv
              WHERE iv.wedding_id = current_setting('probe.wed_c')::uuid),
            (now() - interval '1 second'))$t$,
     '23514', '%an expiring link must be given a time in the future%'),
    ('C2', 'rotating a wedding that was never published says so and mints nothing',
     $t$SELECT api.rotate_invitation_token(current_setting('probe.wed_bare')::uuid)$t$,
     '23514', '%there is no published invitation to rotate%');
  PERFORM pg_temp.st3p_run('C2', 'authenticated', current_setting('probe.owner_c'));

  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('C4', 'a foreign wedding''s link refuses with the ownership words, not with "nothing was published"',
     $t$SELECT api.rotate_invitation_token(current_setting('probe.wed_d')::uuid)$t$,
     '42501', '%the caller may not rotate this wedding%'),
    ('C4', 'and the same for a foreign revoke',
     $t$SELECT api.revoke_invitation_publication(current_setting('probe.wed_d')::uuid)$t$,
     '42501', '%the caller may not revoke this wedding%'),
    ('C4', 'and for a foreign preview',
     $t$SELECT api.preview_invitation(current_setting('probe.wed_d')::uuid)$t$,
     '42501', '%the caller may not preview this wedding%'),
    ('C4', 'and for a foreign state read',
     $t$SELECT api.get_invitation_publication_state(current_setting('probe.wed_d')::uuid)$t$,
     '42501', '%the caller may not read this wedding%');
  PERFORM pg_temp.st3p_run('C4', 'authenticated', current_setting('probe.owner_c'));

  -- Revoking a wedding that was never published is not an error and not a lie: it
  -- reports that nothing was revoked, because nothing had been.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  SELECT api.revoke_invitation_publication(current_setting('probe.wed_bare')::uuid) INTO v_nop;
  EXECUTE 'RESET ROLE';
  -- A literal rather than jsonb_build_object(): that drops a NULL key instead of
  -- writing `"publication_id": null`, which is the half of this claim worth testing.
  PERFORM pg_temp.st3p_eq('C34 revoking an unpublished wedding says nothing was revoked',
    v_nop, '{"publication_id": null, "revoked": false, "tokens_revoked": 0}'::jsonb);

  PERFORM pg_temp.st3p_eq('C32 twelve refusals wrote nothing: one active publication per wedding',
    (SELECT count(*) FROM public.publications WHERE status = 'active'), 2::bigint);
  PERFORM pg_temp.st3p_eq('C33 and the second family still has exactly one credential',
    (SELECT count(*) FROM private.access_tokens
      WHERE wedding_id = current_setting('probe.wed_d')::uuid), 1::bigint);
END $C$;

-- ===========================================================================
-- D. The public projection, seen by a caller holding nothing but a link
-- ===========================================================================
DO $D$
DECLARE
  v_out     jsonb;
  v_refuse  jsonb;
  v_guest   jsonb;
  v_other   jsonb;
  v_same    jsonb;
  v_dto     jsonb;
  v_dtod    jsonb;
  v_p       jsonb;
  v_preview jsonb;
  v_snap    jsonb;
  v_univ    text[];
  v_banned  text[];
BEGIN
  v_univ := ARRAY['title', 'language', 'primary', 'additional', 'style', 'font', 'fontSize',
                  'color', 'alignment', 'design_template', 'template_key', 'revision',
                  'display_name', 'tradition_pack', 'people', 'event_key',
                  'role_key', 'role_label', 'group_key', 'group_label', 'events',
                  'starts_at_local', 'ends_at_local', 'timezone', 'venue', 'name',
                  'address_text', 'map_url', 'welcome', 'family_introduction',
                  'event_notes', 'closing', 'sections', 'requested', 'items',
                  'section_key', 'position', 'kind', 'required', 'host_field',
                  'heading', 'body', 'text', 'fallback_used', 'source', 'overrode_pack_text'];
  v_banned := ARRAY['owner_user_id', 'user_id', 'profile_id', 'account_id', 'entitlement',
                    'entitlement_tier', 'package_code', 'package', 'token_hash', 'token_kind',
                    'access_token', 'raw_token', 'path', 'publication_id', 'version_id',
                    'wedding_id', 'household_id', 'approval_request_id', 'approval_version_id',
                    'migration_findings', 'legacy', 'legacy_id', 'audit', 'reviewed_by',
                    'reviewed_at', 'review_notes', 'created_by', 'created_by_role', 'created_at',
                    'updated_at', 'published_at', 'revoked_at', 'expires_at', 'private',
                    'service', 'service_role', 'paid_status', 'selected_features', 'is_paid',
                    'base_paid', 'fully_paid', 'email', 'password', 'preview_svg', 'available',
                    'layout_settings', 'structure', 'supported_languages', 'supersedes_version_id',
                    'snapshot_schema_version', 'notes', 'object_key', 'status', 'enabled', 'id',
                    'estimated_guest_count', 'lifecycle_status', 'foilEnabled', 'invitation'];

  -- Nothing has to be live for the refusals that must be indistinguishable.
  v_refuse := pg_temp.st3p_resolve(NULL);
  PERFORM pg_temp.st3p_has_keys('D1 the refusal is one key and no second', v_refuse, ARRAY['available']);
  PERFORM pg_temp.st3p_eq('D2 and it says unavailable', v_refuse, jsonb_build_object('available', false));
  PERFORM pg_temp.st3p_eq('D3 a malformed token is the same answer as no token',
    pg_temp.st3p_resolve('too-short'), v_refuse);
  PERFORM pg_temp.st3p_eq('D4 a well-shaped token that never belonged to anyone is that same answer',
    pg_temp.st3p_resolve(rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=')),
    v_refuse);
  PERFORM pg_temp.st3p_eq('D5 the digest of a real token, presented with one character wrong, is that same answer',
    pg_temp.st3p_resolve(substr(current_setting('probe.hash_a'), 1, 42) || 'A'), v_refuse);
  PERFORM pg_temp.st3p_ok('D6 markup where a credential belongs is still just the one refusal',
    pg_temp.st3p_resolve('<script>alert(1)</script>') = v_refuse);

  v_out := pg_temp.st3p_resolve(current_setting('probe.token_c'));
  v_dto := v_out -> 'invitation';

  PERFORM pg_temp.st3p_has_keys('D7 a live invitation answers with two keys and no third',
    v_out, ARRAY['available', 'invitation']);
  PERFORM pg_temp.st3p_eq('D8 and says it is available', (v_out ->> 'available')::boolean, true);
  PERFORM pg_temp.st3p_has_keys('D9 the guest projection is twelve named things',
    v_dto, ARRAY['title', 'language', 'style', 'design_template', 'tradition_pack',
                 'sections', 'people', 'events', 'welcome', 'family_introduction',
                 'event_notes', 'closing']);
  PERFORM pg_temp.st3p_has_keys('D10 the language block is a primary and an ordered list',
    v_dto -> 'language', ARRAY['primary', 'additional']);
  PERFORM pg_temp.st3p_has_keys('D11 the style block is the four values a renderer may apply',
    v_dto -> 'style', ARRAY['font', 'fontSize', 'color', 'alignment']);
  PERFORM pg_temp.st3p_has_keys('D12 the template is named, keyed and numbered',
    v_dto -> 'design_template', ARRAY['display_name', 'template_key', 'revision']);
  PERFORM pg_temp.st3p_has_keys('D13 the section block is the request and the resolved order',
    v_dto -> 'sections', ARRAY['requested', 'items']);
  PERFORM pg_temp.st3p_has_keys('D13b a resolved section is keyed, ordered, typed and sourced',
    v_dto #> '{sections,items,0}',
    ARRAY['section_key', 'position', 'kind', 'required', 'host_field', 'heading', 'body']);
  PERFORM pg_temp.st3p_has_keys('D13c a host-written body says so, in five fields and no more',
    v_dto #> '{sections,items,0,body}',
    ARRAY['source', 'text', 'language', 'fallback_used', 'overrode_pack_text']);
  -- Compared as text, not as `'host'::jsonb`: a bare word is not a JSON document, and
  -- asking Postgres to parse one fails before the assertion can be measured.
  PERFORM pg_temp.st3p_eq('D13d the host wrote this section, so the guest reads the host''s words',
    v_dto #>> '{sections,items,0,body,source}', 'host');
  PERFORM pg_temp.st3p_eq('D13e and the wording is the same string the top-level section carries',
    v_dto #>> '{sections,items,0,body,text}', v_dto ->> 'welcome');
  -- The host's own words have no language record, because nobody examined them for one.
  -- Saying `language: 'en'` here would be the projection inventing a review fact. The
  -- key is present and holds JSON null, so `#> ... IS NULL` would be true of a missing
  -- key as easily as of an honest null; `jsonb_typeof` tells them apart.
  PERFORM pg_temp.st3p_eq('D13f a host body names no language and claims no fallback',
    ARRAY[jsonb_typeof(v_dto #> '{sections,items,0,body,language}'),
          jsonb_typeof(v_dto #> '{sections,items,0,body,fallback_used}')],
    ARRAY['null', 'null']);
  PERFORM pg_temp.st3p_eq('D13g a pack-less document credits no pack',
    jsonb_typeof(v_dto -> 'tradition_pack'), 'null');
  PERFORM pg_temp.st3p_has_keys('D14 a guest sees a person as five optional labels',
    v_dto -> 'people' -> 0,
    ARRAY['display_name', 'role_key', 'role_label', 'group_key', 'group_label']);
  PERFORM pg_temp.st3p_has_keys('D15 and an event as a time, a name and a place',
    v_dto -> 'events' -> 0,
    ARRAY['event_key', 'display_name', 'starts_at_local', 'ends_at_local', 'timezone', 'venue']);
  PERFORM pg_temp.st3p_has_keys('D16 the venue arrives inline, three fields deep',
    v_dto -> 'events' -> 0 -> 'venue', ARRAY['name', 'address_text', 'map_url']);
  PERFORM pg_temp.st3p_universe('D17 the invitation, at every depth, is exactly the documented vocabulary',
    v_dto, v_univ);
  PERFORM pg_temp.st3p_no_forbidden('D18 none of the banned names appears in the guest document, at any depth',
    v_dto, v_banned);
  PERFORM pg_temp.st3p_ok('D19 no uuid-shaped value reaches a guest',
    v_out::text !~ '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}');
  PERFORM pg_temp.st3p_ok('D20 no email-shaped value reaches a guest',
    v_out::text !~ '@[A-Za-z0-9.-]+\.[A-Za-z]{2,}');
  PERFORM pg_temp.st3p_eq('D21 the colour is revalidated and lower-cased on the way out',
    v_dto #>> '{style,color}', '#c9972f');
  PERFORM pg_temp.st3p_ok('D22 the sections arrive as the text the host wrote',
    v_dto ->> 'welcome' = 'With the blessings of our families'
    AND v_dto ->> 'closing' = 'With love'
    AND v_dto ->> 'event_notes' = 'Lunch follows the ceremony');
  PERFORM pg_temp.st3p_eq('D23 the extra language arrives in the order it was chosen',
    v_dto #> '{language,additional}', '["ta"]'::jsonb);
  PERFORM pg_temp.st3p_eq('D24 the map link survives as the one URL a guest may be handed',
    v_dto #>> '{events,0,venue,map_url}', 'https://maps.example.test/km');
  PERFORM pg_temp.st3p_eq('D25 people reach the guest in the order the host set',
    (SELECT count(*) FROM jsonb_array_elements(v_dto -> 'people')), 3::bigint);

  -- The family with no pack and no template: absence has to be reported as absence.
  v_dtod := pg_temp.st3p_resolve(current_setting('probe.token_d')) -> 'invitation';
  PERFORM pg_temp.st3p_eq('D26 a wedding with no template says null, it does not invent one',
    jsonb_typeof(v_dtod -> 'design_template'), 'null');
  PERFORM pg_temp.st3p_eq('D27 and the same for a pack',
    jsonb_typeof(v_dtod -> 'tradition_pack'), 'null');
  PERFORM pg_temp.st3p_eq('D28 a section the host never wrote is JSON null, not an empty promise',
    jsonb_typeof(v_dtod -> 'family_introduction'), 'null');
  PERFORM pg_temp.st3p_eq('D29 an event with no venue says so rather than dropping the key',
    jsonb_typeof(v_dtod #> '{events,0,venue}'), 'null');
  PERFORM pg_temp.st3p_eq('D30 with no additional languages the list is empty, not missing',
    v_dtod #> '{language,additional}', '[]'::jsonb);
  -- A subset, not an equality: this family has no template, no pack and no venue,
  -- so its document legitimately carries less vocabulary. What must not happen is a
  -- word the full document never used, or a required block dropped along the way.
  PERFORM pg_temp.st3p_ok('D31 the sparse invitation uses no vocabulary the full one lacks',
    pg_temp.st3p_all_keys(v_dtod) <@ v_univ);
  PERFORM pg_temp.st3p_ok('D31b and it still carries every block the shape requires',
    ARRAY['additional', 'alignment', 'closing', 'color', 'design_template', 'display_name',
          'event_key', 'event_notes', 'events', 'family_introduction', 'font', 'fontSize',
          'heading', 'items', 'language', 'people', 'position', 'primary', 'requested',
          'section_key', 'sections', 'source', 'starts_at_local', 'style', 'text', 'title',
          'tradition_pack', 'welcome']
    <@ pg_temp.st3p_all_keys(v_dtod));

  -- ---- history that predates today's validation -------------------------
  --
  -- A frozen snapshot is older than the constraints guarding tomorrow's writes, so
  -- the projection revalidates on the way out. These feed it rows a legal mint could
  -- never have produced, by patching a real snapshot as the trusted role and handing
  -- the result to the projection directly — the resolver reaches the same function,
  -- and no publication has to be disturbed to exercise a branch.
  SELECT iv.snapshot INTO v_snap FROM public.invitation_versions iv
   WHERE iv.wedding_id = current_setting('probe.wed_d')::uuid;

  -- Stage 4 made these three two-part assertions on purpose. The projection now refuses
  -- a snapshot that declares a shape it is not, so a one-part "this field came back
  -- null" would also be satisfied by the whole document being null — the vacuous pass
  -- the header warns about. Each one therefore names the patched document's survival as
  -- well as the patched field's removal.
  v_p := private.public_invitation_dto(2,
        jsonb_set(v_snap, '{events,0,venue,map_url}', '"javascript:alert(1)"'::jsonb));
  PERFORM pg_temp.st3p_ok('D32 an unsafe map link in frozen history is dropped, not rendered',
    v_p IS NOT NULL AND v_p #>> '{events,0,venue,map_url}' IS NULL);
  v_p := private.public_invitation_dto(2,
        jsonb_set(v_snap, '{people,0,display_name}', '{"a":1}'::jsonb));
  PERFORM pg_temp.st3p_ok('D33 a smuggled structure where a string belongs becomes null',
    v_p IS NOT NULL AND v_p #>> '{people,0,display_name}' IS NULL);
  v_p := private.public_invitation_dto(2,
        jsonb_set(v_snap, '{wedding,style_settings,color}',
                  '"red; background:url(http://x)"'::jsonb));
  PERFORM pg_temp.st3p_ok('D34 a style value that would become CSS is refused',
    v_p IS NOT NULL AND v_p #>> '{style,color}' IS NULL);
  -- A version written before Stage 4 records no release and carries no sections, so
  -- projecting it would mean inventing exactly the facts a credit line exists to state.
  PERFORM pg_temp.st3p_ok('D35 a snapshot of a shape this build does not have is unavailable, not partially rendered',
    private.public_invitation_dto(1, v_snap) IS NULL);
  PERFORM pg_temp.st3p_ok('D36 a snapshot that is not the documented document is unavailable',
    private.public_invitation_dto(2, '{"wedding":"not an object"}'::jsonb) IS NULL);
  PERFORM pg_temp.st3p_ok('D37 and a well-formed snapshot still projects',
    private.public_invitation_dto(2, v_snap) IS NOT NULL);
  -- Stage 4 §24 split the next claim in two, and the split is the point rather than a
  -- loosening. This file first pinned "a section with an unknown kind takes the whole document
  -- down", which conflated two cases a guest feels differently about. A section the contract
  -- *requires* and this build cannot draw means the document is not the document it promised,
  -- so it stays unavailable. A section nobody is obliged to show can arrive from a release
  -- frozen after this build shipped, and blanking somebody's wedding invitation for it is the
  -- worse failure: the item is still handed over, named, with its heading and body as JSON
  -- null, so the client's own normalizer reports it and the rest of the page draws.
  PERFORM pg_temp.st3p_ok('D37b a REQUIRED section claiming a kind no renderer knows still takes the whole document down',
    private.public_invitation_dto(2,
      jsonb_set(jsonb_set(v_snap, '{sections,items,0,kind}', '"temple_hymn"'::jsonb),
                '{sections,items,0,required}', 'true'::jsonb)) IS NULL);
  v_p := private.public_invitation_dto(2, jsonb_set(v_snap, '{sections,items,0,kind}',
                                                    '"temple_hymn"'::jsonb));
  PERFORM pg_temp.st3p_ok('D37c and an optional one does not: the document projects, every section is still counted, and the unrenderable one carries its kind with null heading and body',
    v_p IS NOT NULL
    AND jsonb_array_length(v_p -> 'sections' -> 'items')
        = jsonb_array_length(v_snap -> 'sections' -> 'items')
    AND v_p #>> '{sections,items,0,kind}' = 'temple_hymn'
    AND jsonb_typeof(v_p #> '{sections,items,0,heading}') = 'null'
    AND jsonb_typeof(v_p #> '{sections,items,0,body}') = 'null');

  -- ---- the freeze, proved against a live edit ---------------------------
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  UPDATE public.invitation_drafts
     SET content = content || '{"welcome":"SENTINEL-EDITED-AFTER-PUBLISH"}'::jsonb
   WHERE wedding_id = current_setting('probe.wed_c')::uuid;
  SELECT api.preview_invitation(current_setting('probe.wed_c')::uuid) INTO v_preview;
  SELECT api.create_invitation_version(current_setting('probe.wed_c')::uuid) INTO v_out;
  EXECUTE 'RESET ROLE';

  PERFORM pg_temp.st3p_eq('D38 a guest holding the old link still reads what was published',
    pg_temp.st3p_resolve(current_setting('probe.token_c')) -> 'invitation' ->> 'welcome',
    'With the blessings of our families');
  PERFORM pg_temp.st3p_eq('D39 the host''s preview shows the live draft instead',
    v_preview ->> 'welcome', 'SENTINEL-EDITED-AFTER-PUBLISH');
  PERFORM pg_temp.st3p_has_keys('D40 the preview is the same projection, not a second dialect of it',
    v_preview, ARRAY['title', 'language', 'style', 'design_template', 'tradition_pack',
                     'sections', 'people', 'events', 'welcome', 'family_introduction',
                     'event_notes', 'closing']);
  PERFORM pg_temp.st3p_universe('D41 the preview observes the same closed vocabulary as the guest page',
    v_preview, v_univ);
  PERFORM pg_temp.st3p_eq('D42 a new version captures the new wording',
    v_out -> 'snapshot' -> 'draft' ->> 'welcome', 'SENTINEL-EDITED-AFTER-PUBLISH');
  PERFORM pg_temp.st3p_eq('D43 and the fifth version numbers itself after the fourth',
    (v_out ->> 'version_number')::int, 5);

  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('D', 'another account cannot preview this family''s invitation',
     $t$SELECT api.preview_invitation(current_setting('probe.wed_c')::uuid)$t$,
     '42501', '%the caller may not preview this wedding%'),
    ('D', 'another account cannot read its publication state',
     $t$SELECT api.get_invitation_publication_state(current_setting('probe.wed_c')::uuid)$t$,
     '42501', '%the caller may not read this wedding%');
  PERFORM pg_temp.st3p_run('D', 'authenticated', current_setting('probe.owner_d'));

  -- Being signed in is not a second door and not a blocked door. The browser client
  -- sends its token whenever it holds one, so a host opening their own public link
  -- arrives as `authenticated`, and must be answered identically to a guest with no
  -- session at all — including by an account that has nothing to do with the family.
  SELECT pg_temp.st3p_resolve(current_setting('probe.token_c')) INTO v_guest;
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_d'), false);
  PERFORM set_config('request.headers', '{}'::text, false);
  SELECT api.resolve_public_invitation() INTO v_other;
  PERFORM set_config('request.headers',
    jsonb_build_object('x-invitation-token', current_setting('probe.token_c'))::text, false);
  SELECT api.resolve_public_invitation() INTO v_same;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.st3p_eq('D44 a signed-in caller with no credential in the header gets the one refusal',
    v_other, v_refuse);
  PERFORM pg_temp.st3p_eq('D45 and a signed-in stranger holding a live address sees what its guest sees',
    v_same, v_guest);
END $D$;

-- ===========================================================================
-- E. What a credential may point at, in the relation itself
-- ===========================================================================
--
-- The functions above refuse these shapes as a courtesy. This group shows the schema
-- refuses them too, which is the half of the design no RPC can take away: a
-- `service_role` client, a future migration or a hand-written query all hit the same
-- wall. Every probe here therefore runs as the trusted role, so nothing is refused
-- for lack of a grant and the constraint is what answers.
DO $E$
DECLARE
  v_live_pub     uuid;
  v_dead_pub     uuid;
  v_pub_d        uuid;
  v_ver_d        uuid;
  v_chk          text;
  v_tokens       bigint;
  v_pubs         bigint;
BEGIN
  SELECT p.id INTO v_live_pub FROM public.publications p
   WHERE p.wedding_id = current_setting('probe.wed_c')::uuid AND p.status = 'active';
  SELECT p.id INTO v_dead_pub FROM public.publications p
   WHERE p.wedding_id = current_setting('probe.wed_c')::uuid AND p.status = 'revoked';
  SELECT p.id INTO v_pub_d FROM public.publications p
   WHERE p.wedding_id = current_setting('probe.wed_d')::uuid;
  SELECT (array_agg(iv.id ORDER BY iv.version_number))[1] INTO v_ver_d FROM public.invitation_versions iv
   WHERE iv.wedding_id = current_setting('probe.wed_d')::uuid;

  PERFORM set_config('probe.pub_live_c', v_live_pub::text, false);
  PERFORM set_config('probe.pub_dead_c', v_dead_pub::text, false);
  PERFORM set_config('probe.pub_d',      v_pub_d::text,    false);
  PERFORM set_config('probe.ver_d',      v_ver_d::text,    false);
  PERFORM pg_temp.st3p_ok('E1 the fixture produced exactly the two publication generations this group needs',
    v_live_pub IS NOT NULL AND v_dead_pub IS NOT NULL AND v_live_pub <> v_dead_pub);
  PERFORM pg_temp.st3p_eq('E2 the live credential is pinned to the live publication',
    (SELECT t.publication_id FROM private.access_tokens t
      WHERE t.wedding_id = current_setting('probe.wed_c')::uuid), v_live_pub);
  -- Read from the catalog rather than from `pg_indexes.indexdef`: the parenthesisation
  -- of a partial predicate differs between Postgres versions, and what matters here is
  -- that the index is unique *and* has a predicate at all.
  PERFORM pg_temp.st3p_eq('E3 the guard on a second live link is a partial unique index on the credential table',
    (SELECT ARRAY[i.indisunique::text, (i.indpred IS NOT NULL)::text, tc.relname::text,
                  (pg_get_indexdef(i.indexrelid) LIKE '%revoked_at IS NULL%')::text]
       FROM pg_index i
       JOIN pg_class c     ON c.oid = i.indexrelid
       JOIN pg_class tc    ON tc.oid = i.indrelid
       JOIN pg_namespace n ON n.oid  = c.relnamespace
      WHERE c.relname = 'one_live_public_token_per_publication' AND n.nspname = 'private'),
    ARRAY['true', 'true', 'access_tokens', 'true']);

  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    -- Aims at the *revoked* publication of the other family: an index, not a key,
    -- refuses a second live credential on a publication, and that index would answer
    -- first and hide the key this probe is about.
    ('E', 'a credential may not name another wedding''s publication',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, expiry_policy)
        VALUES (current_setting('probe.hash_b'), 'public_invitation',
                current_setting('probe.wed_d')::uuid, current_setting('probe.pub_dead_c')::uuid, 'no_expiry')$t$,
     '23503', '%access_tokens_wedding_id_publication_id_fkey%'),
    ('E', 'a credential may not name another wedding''s household',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, household_id, expiry_policy)
        VALUES (current_setting('probe.hash_a'), 'guest_invitation',
                current_setting('probe.wed_d')::uuid, current_setting('probe.pub_d')::uuid,
                current_setting('probe.household_c')::uuid, 'no_expiry')$t$,
     '23503', '%access_tokens_wedding_id_household_id_fkey%'),
    ('E', 'a public invitation with no publication cannot be written',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, expiry_policy)
        VALUES (current_setting('probe.hash_a'), 'public_invitation',
                current_setting('probe.wed_c')::uuid, 'no_expiry')$t$,
     '23514', '%access_tokens_kind_shape%'),
    ('E', 'a public invitation carrying a household cannot be written',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, household_id, expiry_policy)
        VALUES (current_setting('probe.hash_a'), 'public_invitation',
                current_setting('probe.wed_c')::uuid, current_setting('probe.pub_dead_c')::uuid,
                current_setting('probe.household_c')::uuid, 'no_expiry')$t$,
     '23514', '%access_tokens_kind_shape%'),
    ('E', 'a household invitation with no household cannot be written',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, expiry_policy)
        VALUES (current_setting('probe.hash_a'), 'guest_invitation',
                current_setting('probe.wed_c')::uuid, current_setting('probe.pub_dead_c')::uuid, 'no_expiry')$t$,
     '23514', '%access_tokens_kind_shape%'),
    ('E', 'an approval credential carrying publication scope cannot be written',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id,
                                          household_id, approval_request_id, approval_version_id, expiry_policy)
        VALUES (current_setting('probe.hash_a'), 'approval_review',
                current_setting('probe.wed_c')::uuid, current_setting('probe.pub_dead_c')::uuid,
                current_setting('probe.household_c')::uuid,
                current_setting('probe.no_such')::uuid, current_setting('probe.no_such')::uuid, 'no_expiry')$t$,
     '23514', '%access_tokens_kind_shape%'),
    ('E', 'a kind nobody defined is refused by the kind CHECK, not by the shape CASE''s silence',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, expiry_policy)
        VALUES (current_setting('probe.hash_a'), 'banana',
                current_setting('probe.wed_c')::uuid, current_setting('probe.pub_live_c')::uuid, 'no_expiry')$t$,
     '23514', '%access_tokens_token_kind_check%'),
    ('E', 'a raw secret may not be stored in the digest column',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, expiry_policy)
        VALUES ('stage3-probe-a-not-a-digest', 'public_invitation',
                current_setting('probe.wed_c')::uuid, current_setting('probe.pub_dead_c')::uuid, 'no_expiry')$t$,
     '23514', '%access_tokens_token_hash_check%'),
    ('E', 'one credential may not address two publications',
     $t$INSERT INTO private.access_tokens (id, token_hash, token_kind, wedding_id, publication_id, expiry_policy)
        VALUES (current_setting('probe.no_such')::uuid, current_setting('probe.hash_a'), 'public_invitation',
                current_setting('probe.wed_c')::uuid, current_setting('probe.pub_live_c')::uuid, 'no_expiry')$t$,
     '23505', '%one_live_public_token_per_publication%'),
    ('E', 'a digest may not be issued twice',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, expiry_policy)
        VALUES (current_setting('probe.hash_live'), 'public_invitation',
                current_setting('probe.wed_d')::uuid, current_setting('probe.pub_d')::uuid, 'no_expiry')$t$,
     '23505', '%access_tokens_token_hash_key%'),
    ('E', 'the same secret may not be reused for a household link either',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, household_id, expiry_policy)
        VALUES (current_setting('probe.hash_live'), 'guest_invitation',
                current_setting('probe.wed_c')::uuid, current_setting('probe.pub_dead_c')::uuid,
                current_setting('probe.household_c')::uuid, 'no_expiry')$t$,
     '23505', '%access_tokens_token_hash_key%'),
    -- Aimed at the wedding that has no publication of its own: a second active row
    -- on a wedding that already has one is stopped by the partial unique index, which
    -- answers before the key and would hide the key this probe is about.
    ('E', 'a frozen version may not be published by another wedding',
     $t$INSERT INTO public.publications (wedding_id, version_id, status)
        VALUES (current_setting('probe.wed_bare')::uuid, current_setting('probe.ver_d')::uuid, 'active')$t$,
     '23503', '%publications_wedding_id_version_id_fkey%'),
    ('E', 'a wedding may not have two active publications',
     $t$INSERT INTO public.publications (wedding_id, version_id, status)
        VALUES (current_setting('probe.wed_d')::uuid, current_setting('probe.ver_d')::uuid, 'active')$t$,
     '23505', '%one_active_publication_per_wedding%'),
    ('E', 'an active publication may not carry a revocation time',
     $t$INSERT INTO public.publications (wedding_id, version_id, status, revoked_at)
        VALUES (current_setting('probe.wed_d')::uuid, current_setting('probe.ver_d')::uuid, 'active', now())$t$,
     '23514', '%' || pg_temp.st3p_check_name('public', 'publications', $q$%status = 'active'%$q$) || '%'),
    ('E', 'a revoked publication may not omit one',
     $t$INSERT INTO public.publications (wedding_id, version_id, status)
        VALUES (current_setting('probe.wed_d')::uuid, current_setting('probe.ver_d')::uuid, 'revoked')$t$,
     '23514', '%' || pg_temp.st3p_check_name('public', 'publications', $q$%status = 'active'%$q$) || '%'),
    ('E', 'a fixed expiry with no instant is a contradiction, not a default',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, expiry_policy)
        VALUES (current_setting('probe.hash_a'), 'public_invitation',
                current_setting('probe.wed_c')::uuid, current_setting('probe.pub_dead_c')::uuid, 'fixed')$t$,
     '23514', '%' || pg_temp.st3p_check_name('private', 'access_tokens', $q$%expiry_policy = 'fixed'::text%$q$) || '%'),
    ('E', 'a no-expiry policy carrying an instant is the same contradiction',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, expiry_policy, expires_at)
        VALUES (current_setting('probe.hash_a'), 'public_invitation',
                current_setting('probe.wed_c')::uuid, current_setting('probe.pub_dead_c')::uuid,
                'no_expiry', now() + interval '1 hour')$t$,
     '23514', '%' || pg_temp.st3p_check_name('private', 'access_tokens', $q$%expiry_policy = 'fixed'::text%$q$) || '%'),
    ('E', 'a credential may not expire before it was created',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, expiry_policy,
                                          created_at, expires_at)
        VALUES (current_setting('probe.hash_a'), 'public_invitation',
                current_setting('probe.wed_c')::uuid, current_setting('probe.pub_dead_c')::uuid,
                'fixed', now(), now())$t$,
     '23514', '%' || pg_temp.st3p_check_name('private', 'access_tokens', '%expires_at > created_at%') || '%');
  PERFORM pg_temp.st3p_run('E', 'postgres', NULL);

  -- ---- positive controls: the shapes this group did NOT refuse are writable
  SELECT count(*) INTO v_tokens FROM private.access_tokens;
  SELECT count(*) INTO v_pubs FROM public.publications;

  INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, expiry_policy)
    VALUES (current_setting('probe.hash_a'), 'public_invitation',
            current_setting('probe.wed_c')::uuid, v_dead_pub, 'no_expiry');
  PERFORM pg_temp.st3p_eq('E4 a second live credential is legal on a publication nothing links to',
    (SELECT count(*) FROM private.access_tokens WHERE token_hash = current_setting('probe.hash_a')), 1::bigint);
  PERFORM pg_temp.st3p_ok('E5 which is exactly what proves the guard is about liveness, not about rows',
    (SELECT count(*) FROM private.access_tokens
      WHERE publication_id = v_dead_pub AND revoked_at IS NULL) = 1);

  DELETE FROM private.access_tokens WHERE token_hash = current_setting('probe.hash_a');
  INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id,
                                     household_id, expiry_policy)
    VALUES (current_setting('probe.hash_a'), 'guest_invitation',
            current_setting('probe.wed_c')::uuid, v_dead_pub,
            current_setting('probe.household_c')::uuid, 'no_expiry');
  PERFORM pg_temp.st3p_ok('E6 the household kind is writable when both of its scopes belong to one wedding',
    (SELECT count(*) FROM private.access_tokens WHERE token_hash = current_setting('probe.hash_a')) = 1);

  DELETE FROM private.access_tokens WHERE token_hash = current_setting('probe.hash_a');
  INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id,
                                     household_id, expiry_policy, expires_at)
    VALUES (current_setting('probe.hash_a'), 'rsvp',
            current_setting('probe.wed_c')::uuid, v_dead_pub,
            current_setting('probe.household_c')::uuid, 'fixed', now() + interval '1 day');
  PERFORM pg_temp.st3p_ok('E7 and an expiring RSVP credential is representable',
    (SELECT count(*) FROM private.access_tokens WHERE token_hash = current_setting('probe.hash_a')) = 1);

  DELETE FROM private.access_tokens WHERE token_hash = current_setting('probe.hash_a');
  PERFORM pg_temp.st3p_eq('E8 the group leaves the credential table exactly as it found it',
    (SELECT count(*) FROM private.access_tokens), v_tokens);
  PERFORM pg_temp.st3p_eq('E9 and the publication table untouched as well',
    (SELECT count(*) FROM public.publications), v_pubs);
  -- The legal-shape direction for `approval_review` needs an approval request and a
  -- version of it, which Stage 2's own suites build and assert; this file plants no
  -- approval rows, so it tests only that an approval credential cannot *also* carry
  -- publication scope (probe E above) and says so rather than implying more.
  v_chk := pg_temp.st3p_check_name('private', 'access_tokens', '%approval_request_id IS NULL%');
  PERFORM pg_temp.st3p_eq('E10 the shape CHECK Stage 2 wrote is still the constraint answering today',
    v_chk, 'access_tokens_kind_shape');
END $E$;

-- ===========================================================================
-- G. The api surface, in full, as one matrix
-- ===========================================================================
--
-- Directive §C: list every function in `api`, its arguments, its return, its owner,
-- its security mode, its search_path and each caller role's EXECUTE — so an
-- unexpected callable is a diff rather than a discovery. One assertion holding the
-- whole matrix is stricter than seven holding one column each: it fails when a
-- function is added, removed, renamed, re-signatured or re-granted, and the failure
-- message prints the entire surface as measured.
--
-- After the closure repair this reads as two matrices, because the surface is two
-- schemas: `api` is the profile PostgREST serves and now holds only one-line SECURITY
-- INVOKER delegations, and `internal_api` is unexposed and holds the PRIVILEGED
-- SECURITY DEFINER bodies they name. G1/G1f each assert a whole literal, and G1g
-- asserts the pair relationships — same names, same signatures, one invoker over one
-- definer, identical browser grants, no server role — which is the property that keeps
-- the wrapper layer honest: it cannot quietly grow its own authorization, because the
-- authorization is provably on the other side of the pair.
DO $G$
DECLARE
  v_matrix  text;
  v_impl    text;
  v_pairs   text;
  v_rel     text;
BEGIN
  SELECT string_agg(
           p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> '
           || pg_get_function_result(p.oid)
           || ' | definer=' || CASE WHEN p.prosecdef THEN 'y' ELSE 'n' END
           || ' | lang=' || l.lanname
           || ' | vol=' || p.provolatile::text
           || ' | search_path=' || coalesce(array_to_string(p.proconfig, ','), '(unset)')
           || ' | owner=' || pg_get_userbyid(p.proowner)
           || ' | anon=' || CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'y' ELSE 'n' END
           || ' | authenticated=' || CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'y' ELSE 'n' END
           || ' | service_role=' || CASE WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'y' ELSE 'n' END
           || ' | public=' || CASE WHEN has_function_privilege('public', p.oid, 'EXECUTE') THEN 'y' ELSE 'n' END,
           E'\n' ORDER BY p.proname COLLATE "C")
    INTO v_matrix
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'api';

  -- Seven `lang=sql`, seven `definer=n`: the exposed schema is pure transport. The
  -- volatility letters are the same ones as before the repair because the wrappers
  -- declare them — PostgREST routes GET/POST on `provolatile`, so a wrapper that
  -- dropped `STABLE` would change the HTTP surface while changing no behaviour.
  --
  -- Three literals, picked by the declared head, because this census is of the *union* of two
  -- schemas' history: Stage 5 added the eighth exposed wrapper, so the Stage 3 and Stage 4 heads
  -- carry seven rows and the Stage 5/6 heads carry eight; Stage 7 added five more, so its head
  -- carries thirteen. Every branch is an exact census — the branch changes which literal is
  -- measured against, never how strictly.
  --
  -- Each Stage 7 row was read off a throwaway cluster that had applied the whole published chain
  -- plus the Stage 7 migration (`q7-logs/s7-census-readout-03.log`), then compared line by line
  -- against what `20261008120000_stage7_family_approval_review.sql` §8/§9 declares, before being
  -- written here. The three properties that matter in those five rows, restated because they are
  -- the reason this census is worth its length:
  --   * `vol=v` on `submit_family_review` — a reviewer's answer is a write, so PostgREST routes it
  --     as POST, which is what keeps the credential out of any logged query string;
  --   * `vol=s` on `get_approval_requests` and nowhere else among the new names — the host's queue
  --     is a read, and a stale copy costs nothing, so it is cacheable and the other four are not;
  --   * `anon=y` only on `resolve_family_review` and `submit_family_review`, the two a reviewer
  --     reaches with no session, and `anon=n` on the three host verbs. `service_role=n` and
  --     `public=n` on all thirteen: no server key reaches a browser boundary either.
  PERFORM pg_temp.st3p_eq('G1 the whole callable surface of api, function by function — invoker wrappers only', v_matrix,
    CASE WHEN pg_temp.st3p_at_least('stage7') THEN
      $matrix7$create_invitation_version(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
get_approval_requests(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
get_invitation_publication_state(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
preview_invitation(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
preview_invitation_document(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
publish_invitation_version(p_wedding_id uuid, p_version_id uuid, p_expires_at timestamp with time zone) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
request_family_review(p_wedding_id uuid, p_version_id uuid, p_reviewer_display_name text, p_expires_at timestamp with time zone) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
resolve_family_review() -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=y | authenticated=y | service_role=n | public=n
resolve_public_invitation() -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=y | authenticated=y | service_role=n | public=n
revoke_family_review(p_request_id uuid) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
revoke_invitation_publication(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
rotate_invitation_token(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
submit_family_review(p_decision text, p_reviewer_label text, p_message text, p_section_key text) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=y | authenticated=y | service_role=n | public=n$matrix7$
    WHEN pg_temp.st3p_at_least('stage5') THEN
      $matrix5$create_invitation_version(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
get_invitation_publication_state(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
preview_invitation(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
preview_invitation_document(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
publish_invitation_version(p_wedding_id uuid, p_version_id uuid, p_expires_at timestamp with time zone) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
resolve_public_invitation() -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=y | authenticated=y | service_role=n | public=n
revoke_invitation_publication(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
rotate_invitation_token(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n$matrix5$
    ELSE
      $matrix$create_invitation_version(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
get_invitation_publication_state(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
preview_invitation(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
publish_invitation_version(p_wedding_id uuid, p_version_id uuid, p_expires_at timestamp with time zone) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
resolve_public_invitation() -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=y | authenticated=y | service_role=n | public=n
revoke_invitation_publication(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
rotate_invitation_token(p_wedding_id uuid) -> jsonb | definer=n | lang=sql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n$matrix$
    END);

  -- The privileged half. Same seven names, same seven signatures, the opposite
  -- security mode, and the same pinned empty search_path — an empty path is what makes
  -- running as the owner safe, and it is asserted here rather than assumed from the
  -- wrapper because the definer is the function that actually touches `private`.
  --
  -- The Stage 5-or-later literal is nineteen rows because the unexposed schema also carries the
  -- pack-maintenance bodies, each of them refused to every browser role (`anon=n authenticated=n
  -- service_role=n public=n`) — that they read as *ungranted* rather than *absent* is the point of
  -- census, and why this line is a full matrix instead of a count.
  --
  -- Twenty-four rows from Stage 7, which added five privileged bodies. The reading that matters is
  -- the `definer=` column: all five say `y`, because a reviewer's answer and a host's request both
  -- write rows the calling role has no table privilege on, and that is the only justification this
  -- schema accepts for acting above its caller. `anon=y` appears on exactly the two a sessionless
  -- reviewer needs. Every row keeps `search_path=""` and `service_role=n`.
  SELECT string_agg(
           p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') -> '
           || pg_get_function_result(p.oid)
           || ' | definer=' || CASE WHEN p.prosecdef THEN 'y' ELSE 'n' END
           || ' | lang=' || l.lanname
           || ' | vol=' || p.provolatile::text
           || ' | search_path=' || coalesce(array_to_string(p.proconfig, ','), '(unset)')
           || ' | owner=' || pg_get_userbyid(p.proowner)
           || ' | anon=' || CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'y' ELSE 'n' END
           || ' | authenticated=' || CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'y' ELSE 'n' END
           || ' | service_role=' || CASE WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'y' ELSE 'n' END
           || ' | public=' || CASE WHEN has_function_privilege('public', p.oid, 'EXECUTE') THEN 'y' ELSE 'n' END,
           E'\n' ORDER BY p.proname COLLATE "C")
    INTO v_impl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'internal_api';

  PERFORM pg_temp.st3p_eq('G1f the whole callable surface of internal_api — privileged bodies, none of it a table', v_impl,
    CASE WHEN pg_temp.st3p_at_least('stage7') THEN
      $impl7$approve_tradition_pack_release(p_release_id uuid, p_expected_hash text) -> jsonb | definer=n | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
create_invitation_version(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
create_tradition_pack(p_pack_key text, p_display_name text, p_scope_statement text) -> jsonb | definer=n | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
create_tradition_pack_release(p_pack_key text, p_definition jsonb, p_definition_schema_version integer, p_languages text[], p_author_label text, p_machine_assisted boolean, p_machine_assistance_notes text, p_source_reference text, p_changelog text) -> jsonb | definer=n | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
deprecate_tradition_pack_release(p_release_id uuid) -> jsonb | definer=n | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
get_approval_requests(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
get_invitation_publication_state(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
get_tradition_pack_review_packet(p_release_id uuid) -> jsonb | definer=n | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
inspect_tradition_pack_release(p_release_id uuid) -> jsonb | definer=n | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
preview_invitation(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
preview_invitation_document(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
publish_invitation_version(p_wedding_id uuid, p_version_id uuid, p_expires_at timestamp with time zone) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
request_family_review(p_wedding_id uuid, p_version_id uuid, p_reviewer_display_name text, p_expires_at timestamp with time zone) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
resolve_family_review() -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=y | authenticated=y | service_role=n | public=n
resolve_public_invitation() -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=y | authenticated=y | service_role=n | public=n
revoke_family_review(p_request_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
revoke_invitation_publication(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
rotate_invitation_token(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
submit_family_review(p_decision text, p_reviewer_label text, p_message text, p_section_key text) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=y | authenticated=y | service_role=n | public=n
submit_tradition_pack_review(p_release_id uuid, p_decision text, p_review_label text, p_review_basis text, p_review_scope text, p_reviewed_languages text[], p_expected_hash text) -> jsonb | definer=n | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
tradition_pack_catalog() -> jsonb | definer=n | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
tradition_pack_retention_report() -> jsonb | definer=n | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
update_draft_tradition_pack_release(p_release_id uuid, p_patch jsonb) -> jsonb | definer=n | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
validate_tradition_pack_release(p_release_id uuid) -> jsonb | definer=n | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n$impl7$
    WHEN pg_temp.st3p_at_least('stage5') THEN
      $impl5$approve_tradition_pack_release(p_release_id uuid, p_expected_hash text) -> jsonb | definer=n | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
create_invitation_version(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
create_tradition_pack(p_pack_key text, p_display_name text, p_scope_statement text) -> jsonb | definer=n | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
create_tradition_pack_release(p_pack_key text, p_definition jsonb, p_definition_schema_version integer, p_languages text[], p_author_label text, p_machine_assisted boolean, p_machine_assistance_notes text, p_source_reference text, p_changelog text) -> jsonb | definer=n | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
deprecate_tradition_pack_release(p_release_id uuid) -> jsonb | definer=n | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
get_invitation_publication_state(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
get_tradition_pack_review_packet(p_release_id uuid) -> jsonb | definer=n | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
inspect_tradition_pack_release(p_release_id uuid) -> jsonb | definer=n | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
preview_invitation(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
preview_invitation_document(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
publish_invitation_version(p_wedding_id uuid, p_version_id uuid, p_expires_at timestamp with time zone) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
resolve_public_invitation() -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=y | authenticated=y | service_role=n | public=n
revoke_invitation_publication(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
rotate_invitation_token(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
submit_tradition_pack_review(p_release_id uuid, p_decision text, p_review_label text, p_review_basis text, p_review_scope text, p_reviewed_languages text[], p_expected_hash text) -> jsonb | definer=n | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
tradition_pack_catalog() -> jsonb | definer=n | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
tradition_pack_retention_report() -> jsonb | definer=n | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
update_draft_tradition_pack_release(p_release_id uuid, p_patch jsonb) -> jsonb | definer=n | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n
validate_tradition_pack_release(p_release_id uuid) -> jsonb | definer=n | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=n | service_role=n | public=n$impl5$
    ELSE
      $impl$create_invitation_version(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
get_invitation_publication_state(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
preview_invitation(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=s | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
publish_invitation_version(p_wedding_id uuid, p_version_id uuid, p_expires_at timestamp with time zone) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
resolve_public_invitation() -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=y | authenticated=y | service_role=n | public=n
revoke_invitation_publication(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n
rotate_invitation_token(p_wedding_id uuid) -> jsonb | definer=y | lang=plpgsql | vol=v | search_path=search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n$impl$
    END);

  -- Matched by name *and* argument types, so an implementation renamed into a different
  -- signature would show as an unpaired row on both sides rather than cancelling out.
  --
  -- The Stage 3/Stage 4 expectation is '(none)': total pairing. From the Stage 5 head the same
  -- query is expected to print an exact census of eleven unpaired maintenance bodies, because
  -- pack authoring, review and retention were deliberately given no PostgREST wrapper — the
  -- browser cannot call them at all, so there is nothing for them to pair with. Both branches are
  -- exact: an additional wrapper-less body, or any body-less wrapper, is a diff at either head.
  -- Stage 7 needs no branch of its own, and that is a fact worth stating rather than a gap: it
  -- added five privileged bodies and five wrappers, so the unpaired set is still exactly these
  -- eleven maintenance names. A Stage 7 body written without a wrapper would appear here as a
  -- twelfth, and a wrapper delegating to nothing would appear as an `unpaired-api`.
  PERFORM pg_temp.st3p_eq('G1g api and internal_api are one-for-one by signature: no wrapper without a body, no body without a wrapper',
    (SELECT coalesce(string_agg(t, ', ' ORDER BY t COLLATE "C"), '(none)')
       FROM (
         SELECT 'unpaired-api ' || a.proname AS t
           FROM pg_proc a JOIN pg_namespace an ON an.oid = a.pronamespace
          WHERE an.nspname = 'api'
            AND NOT EXISTS (SELECT 1 FROM pg_proc i JOIN pg_namespace ib ON ib.oid = i.pronamespace
                             WHERE ib.nspname = 'internal_api'
                               AND i.proname = a.proname AND i.proargtypes = a.proargtypes)
         UNION ALL
         SELECT 'unpaired-internal ' || i.proname
           FROM pg_proc i JOIN pg_namespace ib ON ib.oid = i.pronamespace
          WHERE ib.nspname = 'internal_api'
            AND NOT EXISTS (SELECT 1 FROM pg_proc a JOIN pg_namespace ab ON ab.oid = a.pronamespace
                             WHERE ab.nspname = 'api'
                               AND a.proname = i.proname AND a.proargtypes = i.proargtypes)
       ) up),
    CASE WHEN pg_temp.st3p_at_least('stage5') THEN
      'unpaired-internal approve_tradition_pack_release, unpaired-internal create_tradition_pack, unpaired-internal create_tradition_pack_release, unpaired-internal deprecate_tradition_pack_release, unpaired-internal get_tradition_pack_review_packet, unpaired-internal inspect_tradition_pack_release, unpaired-internal submit_tradition_pack_review, unpaired-internal tradition_pack_catalog, unpaired-internal tradition_pack_retention_report, unpaired-internal update_draft_tradition_pack_release, unpaired-internal validate_tradition_pack_release'
    ELSE '(none)' END);

  -- The pair relationships, one line per name, every verdict expected true. Written as
  -- a literal for the same reason as G1: a mismatch prints all the lines, so the
  -- failure says which function drifted and in which direction. Thirteen lines from the
  -- Stage 7 head, eight from Stage 5 or 6, seven before that, for the same reason G1 branches.
  SELECT string_agg(
           a.proname
           || ' wrapper_is_invoker=' || (NOT a.prosecdef)::text
           || ' impl_is_definer=' || i.prosecdef::text
           || ' anon_grants_match=' || (has_function_privilege('anon', a.oid, 'EXECUTE')
                                        IS NOT DISTINCT FROM has_function_privilege('anon', i.oid, 'EXECUTE'))::text
           || ' authenticated_grants_match=' || (has_function_privilege('authenticated', a.oid, 'EXECUTE')
                                        IS NOT DISTINCT FROM has_function_privilege('authenticated', i.oid, 'EXECUTE'))::text
           || ' no_service_role_on_either=' || (NOT has_function_privilege('service_role', a.oid, 'EXECUTE')
                                                AND NOT has_function_privilege('service_role', i.oid, 'EXECUTE'))::text,
           E'\n' ORDER BY a.proname COLLATE "C")
    INTO v_pairs
    FROM pg_proc a JOIN pg_namespace an ON an.oid = a.pronamespace
    JOIN pg_proc i ON i.proname = a.proname AND i.proargtypes = a.proargtypes
    JOIN pg_namespace inn ON inn.oid = i.pronamespace
   WHERE an.nspname = 'api' AND inn.nspname = 'internal_api';

  PERFORM pg_temp.st3p_eq('G1h each wrapper delegates to a definer body with exactly the same browser grants', v_pairs,
    CASE WHEN pg_temp.st3p_at_least('stage7') THEN
      $pairs7$create_invitation_version wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
get_approval_requests wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
get_invitation_publication_state wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
preview_invitation wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
preview_invitation_document wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
publish_invitation_version wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
request_family_review wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
resolve_family_review wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
resolve_public_invitation wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
revoke_family_review wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
revoke_invitation_publication wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
rotate_invitation_token wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
submit_family_review wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true$pairs7$
    WHEN pg_temp.st3p_at_least('stage5') THEN
      $pairs5$create_invitation_version wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
get_invitation_publication_state wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
preview_invitation wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
preview_invitation_document wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
publish_invitation_version wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
resolve_public_invitation wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
revoke_invitation_publication wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
rotate_invitation_token wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true$pairs5$
    ELSE
      $pairs$create_invitation_version wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
get_invitation_publication_state wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
preview_invitation wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
publish_invitation_version wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
resolve_public_invitation wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
revoke_invitation_publication wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true
rotate_invitation_token wrapper_is_invoker=true impl_is_definer=true anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true$pairs$
    END);

  -- Compared as a list rather than a count, so a failure names the relation that
  -- appeared instead of only saying that one did.
  SELECT string_agg(c.oid::regclass::text || ' = ' || c.relkind::text, ', '
                    ORDER BY c.oid::regclass::text COLLATE "C") INTO v_rel
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'api' AND c.relkind IN ('r', 'v', 'm', 'f', 'p', 'S', 'i');
  PERFORM pg_temp.st3p_eq('G2 api holds no table, view, sequence or index: a request profile can name a function and never a row',
    coalesce(v_rel, '(none)'), '(none)');

  -- The same rule stated for the schema that actually carries the privileges, and the
  -- sharper version of it: a relation in `internal_api` would be a relation with no
  -- RLS, no exposed profile and no policy review — reachable by definition because the
  -- functions in there run as their owner.
  SELECT string_agg(c.oid::regclass::text || ' = ' || c.relkind::text, ', '
                    ORDER BY c.oid::regclass::text COLLATE "C") INTO v_rel
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'internal_api' AND c.relkind IN ('r', 'v', 'm', 'f', 'p', 'S', 'i');
  PERFORM pg_temp.st3p_eq('G2b internal_api holds no table, view, sequence or index — only function bodies',
    coalesce(v_rel, '(none)'), '(none)');
  PERFORM pg_temp.st3p_eq('G2c no policy is written inside internal_api, so nothing there is guarded by RLS',
    (SELECT count(*)::bigint FROM pg_policy pol
       JOIN pg_class c ON c.oid = pol.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'internal_api'), 0::bigint);

  PERFORM pg_temp.st3p_eq('G3 the resolver takes no argument at all, which is the mechanism behind "no token in a query string"',
    (SELECT p.pronargs::integer FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api' AND p.proname = 'resolve_public_invitation'), 0);
  -- Restated rather than loosened. Stage 3's rule read as a count — exactly one `api` function is
  -- argument-free — and its force was that the one argument-free callable is the one that reads a
  -- credential out of the request headers, so nothing else in the exposed schema can be reading a
  -- session value that its signature does not admit. Stage 7 adds a second credential reader of the
  -- same shape, so the count is now two and the *list* becomes the assertion: an argument-free
  -- function that is not one of these two names would be reading something no caller can see, which
  -- is precisely what this line exists to catch. The count form would have accepted that silently.
  PERFORM pg_temp.st3p_eq('G4 the argument-free api functions are exactly the two that read a credential from the request',
    (SELECT coalesce(string_agg(p.proname, ', ' ORDER BY p.proname COLLATE "C"), '(none)')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api' AND p.pronargs = 0),
    CASE WHEN pg_temp.st3p_at_least('stage7')
         THEN 'resolve_family_review, resolve_public_invitation'
         ELSE 'resolve_public_invitation' END);

  -- Read the stored ACL directly rather than through `information_schema`: the latter
  -- filters its rows by the calling user, so under an impersonated session it silently
  -- omits the very grants being tested. The raw acl text also names the grantor, so a
  -- grant from an unexpected owner cannot pass unnoticed.
  PERFORM pg_temp.st3p_eq('G5 schema USAGE on api is held by the owner and exactly the two browser roles',
    (SELECT n.nspacl::text FROM pg_namespace n WHERE n.nspname = 'api'),
    '{postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres}');
  PERFORM pg_temp.st3p_eq('G5b api is owned by the trusted migration role, not by a caller role',
    (SELECT pg_get_userbyid(n.nspowner) FROM pg_namespace n WHERE n.nspname = 'api'),
    'postgres');

  -- The one privilege the repair was forced to take, stated as a literal so its exact
  -- size is visible. PostgreSQL checks permissions on a nested call as the *invoking*
  -- role, so a browser role that may call `api.preview_invitation` must also be able to
  -- name `internal_api.preview_invitation` — otherwise the wrapper raises 42501. USAGE
  -- on the schema is what makes the name resolvable; it grants no table, because there
  -- are no tables in there (G2b), and EXECUTE is still per-function (G1f). That this
  -- grant is load-bearing and not decoration is measured by `stage3_security.test.mjs`,
  -- which revokes it and watches the browser RPC fail.
  PERFORM pg_temp.st3p_eq('G5c internal_api USAGE is held by the owner and exactly the two browser roles — nothing more',
    (SELECT n.nspacl::text FROM pg_namespace n WHERE n.nspname = 'internal_api'),
    '{postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres}');
  PERFORM pg_temp.st3p_eq('G5d internal_api is owned by the trusted migration role',
    (SELECT pg_get_userbyid(n.nspowner) FROM pg_namespace n WHERE n.nspname = 'internal_api'),
    'postgres');
  PERFORM pg_temp.st3p_ok('G6 service_role has no USAGE on api, so a server key cannot reach a browser boundary',
    NOT has_schema_privilege('service_role', 'api', 'USAGE'));
  PERFORM pg_temp.st3p_ok('G6b nor on internal_api: the privileged bodies are reached only through a browser session',
    NOT has_schema_privilege('service_role', 'internal_api', 'USAGE')
    AND NOT has_schema_privilege('service_role', 'internal_api', 'CREATE'));
  PERFORM pg_temp.st3p_eq('G7 private keeps its ACL to the owner and the server role: no browser role at all',
    (SELECT n.nspacl::text FROM pg_namespace n WHERE n.nspname = 'private'),
    '{postgres=UC/postgres,service_role=U/postgres}');
  PERFORM pg_temp.st3p_ok('G7b and no browser role can resolve a name inside private',
    NOT has_schema_privilege('anon', 'private', 'USAGE')
    AND NOT has_schema_privilege('authenticated', 'private', 'USAGE'));

  -- Both of the last two assertions read the catalogs directly and name their
  -- offenders, because a bare count from `information_schema` both disappears under
  -- an impersonated session and hides which helper was left open.
  --
  -- From the Stage 5 head this census is expected to print five names, all of them
  -- `<- service_role`, because pack review binds its hash through helpers that the server role has
  -- to be able to call from inside a nested write — a grant `supabase/tests/stage5/50_review_binding.sql`
  -- measures as exactly these five and nothing else in `private`. The browser half of the rule is
  -- unchanged and still enforced here: an entry for `anon` or `authenticated` fails at either head,
  -- and so does a sixth helper or a renamed one, because the expectation is the whole string.
  PERFORM pg_temp.st3p_eq('G8 no helper in private is callable by a browser role',
    (SELECT coalesce(string_agg(p.proname || ' <- ' || r.rolname, ', '
                      ORDER BY p.proname COLLATE "C", r.rolname COLLATE "C"), '(none)')
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN LATERAL aclexplode(p.proacl) a ON true
       JOIN pg_roles r ON r.oid = a.grantee
      WHERE n.nspname = 'private' AND a.privilege_type = 'EXECUTE'
        AND r.rolname IN ('anon', 'authenticated', 'service_role')),
    CASE WHEN pg_temp.st3p_at_least('stage5') THEN
      'canonical_token <- service_role, jsonb_canonical <- service_role, review_field <- service_role, tradition_pack_review_hash <- service_role, tradition_pack_review_payload <- service_role'
    ELSE '(none)' END);
  PERFORM pg_temp.st3p_eq('G9 the credential store is not reachable by a browser role through the data API either',
    (SELECT coalesce(string_agg(c.relname || ':' || r.rolname || '.' || a.privilege_type, ', '
                      ORDER BY c.relname COLLATE "C", r.rolname COLLATE "C", a.privilege_type), '(none)')
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN LATERAL aclexplode(c.relacl) a ON true
       JOIN pg_roles r ON r.oid = a.grantee
      WHERE n.nspname = 'private' AND c.relkind = 'r'
        AND r.rolname IN ('anon', 'authenticated')),
    '(none)');
  -- G8/G9 above only hold if the ACLs they read exist: a NULL proacl or relacl means
  -- the default ACL, which grants PUBLIC. Name any object still running on defaults.
  PERFORM pg_temp.st3p_eq('G9b nothing in private still runs on a default ACL that would include PUBLIC',
    (SELECT coalesce(string_agg(t, ', ' ORDER BY t COLLATE "C"), '(none)')
       FROM (
         SELECT 'table ' || c.relname AS t
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'private' AND c.relkind = 'r' AND c.relacl IS NULL
         UNION ALL
         SELECT 'function ' || p.proname
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'private' AND p.proacl IS NULL
       ) d),
    '(none)');

  -- The same rule across both halves of the new boundary. A function created in
  -- `internal_api` without an explicit REVOKE would default to EXECUTE for PUBLIC, and
  -- because PUBLIC is a pseudo-role every role inherits, that grant would be invisible
  -- to G1f's `anon=n`/`authenticated=n` columns only if the role happened not to be
  -- used — so the ACL is read directly here instead.
  PERFORM pg_temp.st3p_eq('G9c neither RPC schema has a function or relation still running on a default ACL',
    (SELECT coalesce(string_agg(n.nspname || '.' || p.proname, ', '
                      ORDER BY n.nspname || '.' || p.proname COLLATE "C"), '(none)')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api', 'internal_api') AND p.proacl IS NULL),
    '(none)');
END $G$;

-- ===========================================================================
-- H. Rotation, expiry and revocation, as a guest experiences them
-- ===========================================================================
DO $H$
DECLARE
  v_old      text := current_setting('probe.token_c');
  v_rot      jsonb;
  v_rev      jsonb;
  v_pub      jsonb;
  v_state    jsonb;
  v_before   text;
  v_after    text;
  v_new      text;
  v_row      private.access_tokens%ROWTYPE;
  v_old_row  private.access_tokens%ROWTYPE;
  v_vid      uuid;
BEGIN
  v_before := (pg_temp.st3p_resolve(v_old) -> 'invitation')::text;
  PERFORM pg_temp.st3p_ok('H1 before anything is rotated, the link resolves for a guest',
    (pg_temp.st3p_resolve(v_old) ->> 'available')::boolean);

  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  SELECT api.rotate_invitation_token(current_setting('probe.wed_c')::uuid) INTO v_rot;
  EXECUTE 'RESET ROLE';
  v_new := substr(v_rot ->> 'path', 4);

  PERFORM pg_temp.st3p_has_keys('H2 rotation returns five fields, all of them about the link',
    v_rot, ARRAY['publication_id', 'version_id', 'path', 'previous_revoked_at', 'expires_at']);
  PERFORM pg_temp.st3p_ok('H3 the new address is a fresh 43-character secret',
    (v_rot ->> 'path') ~ '^/i/[A-Za-z0-9_-]{43}$' AND v_new <> v_old);
  PERFORM pg_temp.st3p_ok('H4 the answer names when the old one stopped working, rather than leaving it implied',
    (v_rot ->> 'previous_revoked_at') IS NOT NULL
    AND jsonb_typeof(v_rot -> 'previous_revoked_at') = 'string');
  PERFORM pg_temp.st3p_eq('H5 rotation did not move the publication or the version',
    ARRAY[(v_rot ->> 'publication_id')::uuid, (v_rot ->> 'version_id')::uuid],
    ARRAY[(SELECT t.publication_id FROM private.access_tokens t WHERE t.token_kind = 'public_invitation'
            AND t.wedding_id = current_setting('probe.wed_c')::uuid AND t.revoked_at IS NULL),
          (SELECT p.version_id FROM public.publications p
            WHERE p.id = (v_rot ->> 'publication_id')::uuid)]);
  PERFORM pg_temp.st3p_eq('H6 the old credential is now revoked',
    (SELECT count(*) FROM private.access_tokens
      WHERE wedding_id = current_setting('probe.wed_c')::uuid AND revoked_at IS NOT NULL), 1::bigint);
  PERFORM pg_temp.st3p_eq('H7 and history was kept rather than deleted: two rows, one live',
    (SELECT count(*) FROM private.access_tokens
      WHERE wedding_id = current_setting('probe.wed_c')::uuid), 2::bigint);
  PERFORM pg_temp.st3p_eq('H8 exactly one live link exists for the wedding',
    (SELECT count(*) FROM private.access_tokens
      WHERE wedding_id = current_setting('probe.wed_c')::uuid AND revoked_at IS NULL), 1::bigint);
  PERFORM pg_temp.st3p_ok('H9 the revocation time reported is the one stored',
    (SELECT t.revoked_at FROM private.access_tokens t
      WHERE t.wedding_id = current_setting('probe.wed_c')::uuid AND t.revoked_at IS NOT NULL)
      = (v_rot ->> 'previous_revoked_at')::timestamptz);

  SELECT * INTO v_row FROM private.access_tokens
   WHERE wedding_id = current_setting('probe.wed_c')::uuid AND revoked_at IS NULL;
  SELECT * INTO v_old_row FROM private.access_tokens
   WHERE wedding_id = current_setting('probe.wed_c')::uuid AND revoked_at IS NOT NULL;
  PERFORM pg_temp.st3p_eq('H10 the new row''s digest is the digest of the new secret',
    v_row.token_hash, encode(extensions.digest(convert_to(v_new, 'UTF8'), 'sha256'), 'hex'));
  PERFORM pg_temp.st3p_ok('H11 the two secrets are different digests, not one row edited in place',
    v_row.token_hash <> v_old_row.token_hash AND v_row.id <> v_old_row.id);
  PERFORM pg_temp.st3p_eq('H12 a no-expiry link carries its policy forward through a rotation',
    v_row.expiry_policy, v_old_row.expiry_policy);

  PERFORM pg_temp.st3p_eq('H13 the retired address now gives the one generic refusal',
    pg_temp.st3p_resolve(v_old), jsonb_build_object('available', false));
  PERFORM pg_temp.st3p_ok('H14 and the new address resolves',
    (pg_temp.st3p_resolve(v_new) ->> 'available')::boolean);
  v_after := (pg_temp.st3p_resolve(v_new) -> 'invitation')::text;
  PERFORM pg_temp.st3p_eq('H15 the invitation a guest sees is unchanged by a rotation: only the address moved',
    v_after, v_before);

  -- ---- expiry, aged honestly rather than waited out ---------------------
  PERFORM pg_temp.st3p_ok('H16 the second family''s expiring link resolves while it is still in date',
    (pg_temp.st3p_resolve(current_setting('probe.token_d')) ->> 'available')::boolean);
  UPDATE private.access_tokens
     SET created_at = now() - interval '3 days',
         expires_at = now() - interval '1 hour'
   WHERE wedding_id = current_setting('probe.wed_d')::uuid;
  PERFORM pg_temp.st3p_eq('H17 once it is out of date it is the same refusal as a wrong address',
    pg_temp.st3p_resolve(current_setting('probe.token_d')), jsonb_build_object('available', false));
  PERFORM pg_temp.st3p_eq('H18 and it is the expiry that stopped it, not a revocation',
    (SELECT ARRAY[t.revoked_at IS NULL, t.expires_at < now()] FROM private.access_tokens t
      WHERE t.wedding_id = current_setting('probe.wed_d')::uuid), ARRAY[true, true]);

  -- The host's own read has to apply the same rule the guest's door applies. This is
  -- the assertion that failed as a defect the first time around: `link_active` asked
  -- only whether a credential had been revoked, so a wedding whose link had run out
  -- was reported live to its owner while every visitor got the generic refusal.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_d'), false);
  SELECT api.get_invitation_publication_state(current_setting('probe.wed_d')::uuid) INTO v_state;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.st3p_eq('H18b an out-of-date link is not live in the host read either',
    (v_state ->> 'link_active')::boolean, false);
  PERFORM pg_temp.st3p_ok('H18c and the host is still told when it ran out, rather than the row vanishing',
    (v_state ->> 'link_expires_at') IS NOT NULL
    AND (v_state ->> 'link_expires_at')::timestamptz < now()
    AND (v_state ->> 'publication_id') IS NOT NULL);

  -- ---- revocation, and what republishing does not do -------------------
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  SELECT api.revoke_invitation_publication(current_setting('probe.wed_c')::uuid) INTO v_rev;
  EXECUTE 'RESET ROLE';

  PERFORM pg_temp.st3p_has_keys('H19 revocation answers three fields',
    v_rev, ARRAY['revoked', 'publication_id', 'tokens_revoked']);
  PERFORM pg_temp.st3p_eq('H20 it says what it did',
    ARRAY[((v_rev ->> 'revoked')::boolean)::text, (v_rev ->> 'tokens_revoked')],
    ARRAY['true', '1']);
  PERFORM pg_temp.st3p_eq('H21 the live credential is revoked and the publication with it',
    (SELECT ARRAY[(SELECT count(*) FROM private.access_tokens
                    WHERE wedding_id = current_setting('probe.wed_c')::uuid AND revoked_at IS NULL),
                  (SELECT count(*) FROM public.publications
                    WHERE wedding_id = current_setting('probe.wed_c')::uuid AND status = 'active')]
    ), ARRAY[0::bigint, 0::bigint]);
  PERFORM pg_temp.st3p_eq('H22 a guest holding the current address gets the generic refusal after revocation',
    pg_temp.st3p_resolve(v_new), jsonb_build_object('available', false));

  -- The host's own read of the publication state, taken as the owner over the same
  -- boundary a browser uses, rather than inferred from the row counts above.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  SELECT api.get_invitation_publication_state(current_setting('probe.wed_c')::uuid) INTO v_state;
  SELECT api.create_invitation_version(current_setting('probe.wed_c')::uuid) INTO v_pub;
  v_vid := (v_pub ->> 'version_id')::uuid;
  SELECT api.publish_invitation_version(current_setting('probe.wed_c')::uuid, v_vid, NULL) INTO v_pub;
  EXECUTE 'RESET ROLE';

  PERFORM pg_temp.st3p_eq('H23 the host read its own state as the owner, and it said not-live',
    (v_state ->> 'link_active')::boolean, false);

  -- `link_reused` is true only when publish found a live credential and pointed it at
  -- the new version without minting. After a revocation there is no live credential,
  -- so a true here would mean the dead address had been quietly reactivated.
  PERFORM pg_temp.st3p_eq('H24 revoking then republishing mints a new secret instead of waking the old one',
    ARRAY[(v_pub ->> 'link_reused'), ((v_pub ->> 'path') IS NOT NULL)::text],
    ARRAY['false', 'true']);
  PERFORM pg_temp.st3p_eq('H25 the revoked address still does not resolve',
    pg_temp.st3p_resolve(v_new), jsonb_build_object('available', false));
  PERFORM pg_temp.st3p_ok('H26 the freshly published address does',
    (pg_temp.st3p_resolve(substr(v_pub ->> 'path', 4)) ->> 'available')::boolean);
  PERFORM pg_temp.st3p_eq('H27 and the wedding is live again under exactly one publication',
    (SELECT count(*) FROM public.publications
      WHERE wedding_id = current_setting('probe.wed_c')::uuid AND status = 'active'), 1::bigint);
  PERFORM pg_temp.st3p_eq('H28 with three credentials in its history, one of them live',
    (SELECT ARRAY[count(*), count(*) FILTER (WHERE revoked_at IS NULL)] FROM private.access_tokens
      WHERE wedding_id = current_setting('probe.wed_c')::uuid), ARRAY[3::bigint, 1::bigint]);
  PERFORM set_config('probe.token_c', substr(v_pub ->> 'path', 4), false);

  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('H', 'another account cannot rotate this family''s link',
     $t$SELECT api.rotate_invitation_token(current_setting('probe.wed_c')::uuid)$t$,
     '42501', '%the caller may not rotate this wedding%'),
    ('H', 'another account cannot revoke it either',
     $t$SELECT api.revoke_invitation_publication(current_setting('probe.wed_c')::uuid)$t$,
     '42501', '%the caller may not revoke this wedding%'),
    ('H', 'a wedding that does not exist is refused with the same words as one that is not yours',
     $t$SELECT api.rotate_invitation_token(current_setting('probe.no_such')::uuid)$t$,
     '42501', '%the caller may not rotate this wedding%');
  PERFORM pg_temp.st3p_run('H', 'authenticated', current_setting('probe.owner_d'));
END $H$;

-- ===========================================================================
-- F. What no client may do to the publication tables directly
-- ===========================================================================
--
-- The RPC layer is the only door, and this group is the evidence for that sentence.
-- Each probe is a *complete* statement: the rows it names exist, the columns it
-- writes are real, so a refusal cannot be attributed to a typo. Group F2 is the
-- same shape for an anonymous caller, and the positive controls that follow show
-- the trusted path still works, which is what makes the refusals more than a
-- description of a broken database.
DO $F$
DECLARE
  v_rows  integer;
  v_snap  jsonb;
  v_dto   jsonb;
BEGIN
  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('F', 'a host may not write a frozen version by hand',
     $t$INSERT INTO public.invitation_versions (wedding_id, version_number, snapshot)
        VALUES (current_setting('probe.wed_c')::uuid, 99, '{"a":1}'::jsonb)$t$,
     '42501', '%permission denied for table invitation_versions%'),
    ('F', 'a host may not rewrite a version it already froze',
     $t$UPDATE public.invitation_versions SET snapshot = '{"a":1}'::jsonb
        WHERE wedding_id = current_setting('probe.wed_c')::uuid$t$,
     '42501', '%permission denied for table invitation_versions%'),
    ('F', 'a host may not delete frozen history',
     $t$DELETE FROM public.invitation_versions
        WHERE wedding_id = current_setting('probe.wed_c')::uuid$t$,
     '42501', '%permission denied for table invitation_versions%'),
    ('F', 'a host may not open a publication row directly',
     $t$INSERT INTO public.publications (wedding_id, version_id, status)
        VALUES (current_setting('probe.wed_c')::uuid,
                (SELECT (array_agg(iv.id ORDER BY iv.version_number))[1] FROM public.invitation_versions iv
                  WHERE iv.wedding_id = current_setting('probe.wed_c')::uuid), 'active')$t$,
     '42501', '%permission denied for table publications%'),
    ('F', 'a host may not revoke their own publication behind the RPC',
     $t$UPDATE public.publications SET status = 'revoked', revoked_at = now()
        WHERE wedding_id = current_setting('probe.wed_c')::uuid$t$,
     '42501', '%permission denied for table publications%'),
    ('F', 'a host may not delete the record of what was published',
     $t$DELETE FROM public.publications
        WHERE wedding_id = current_setting('probe.wed_c')::uuid$t$,
     '42501', '%permission denied for table publications%'),
    ('F', 'a host may not read the credential store',
     $t$SELECT token_hash FROM private.access_tokens$t$,
     '42501', '%permission denied for schema private%'),
    ('F', 'a host may not mint a credential',
     $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, expiry_policy)
        VALUES (current_setting('probe.hash_b'), 'public_invitation',
                current_setting('probe.wed_c')::uuid, current_setting('probe.pub_live_c')::uuid, 'no_expiry')$t$,
     '42501', '%permission denied for schema private%'),
    ('F', 'a host may not revoke someone else''s credential by hand',
     $t$UPDATE private.access_tokens SET revoked_at = now() WHERE token_hash = current_setting('probe.hash_b')$t$,
     '42501', '%permission denied for schema private%'),
    ('F', 'a host may not create an extra draft row for their own wedding',
     $t$INSERT INTO public.invitation_drafts (wedding_id, content)
        VALUES (current_setting('probe.wed_c')::uuid, '{}'::jsonb)$t$,
     '42501', '%permission denied for table invitation_drafts%'),
    ('F', 'a host may not delete the draft that belongs to their own wedding',
     $t$DELETE FROM public.invitation_drafts
        WHERE wedding_id = current_setting('probe.wed_c')::uuid$t$,
     '42501', '%permission denied for table invitation_drafts%'),
    ('F', 'a published wedding cannot be deleted out from under its guests',
     $t$DELETE FROM public.weddings WHERE id = current_setting('probe.wed_c')::uuid$t$,
     '23503', '%violates foreign key constraint%'),
    ('F', 'a section longer than the contract holds is refused, not truncated',
     $t$UPDATE public.invitation_drafts SET content =
          jsonb_set(content, '{welcome}', to_jsonb(repeat('a', 4001)))
        WHERE wedding_id = current_setting('probe.wed_c')::uuid$t$,
     '23514', '%invitation_drafts_section_length_bound%');
  PERFORM pg_temp.st3p_run('F', 'authenticated', current_setting('probe.owner_c'));

  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('F2', 'anon may not write a version',
     $t$INSERT INTO public.invitation_versions (wedding_id, version_number, snapshot)
        VALUES (current_setting('probe.wed_c')::uuid, 98, '{"a":1}'::jsonb)$t$,
     '42501', '%permission denied for table invitation_versions%'),
    ('F2', 'anon may not write a publication',
     $t$INSERT INTO public.publications (wedding_id, version_id, status)
        VALUES (current_setting('probe.wed_c')::uuid,
                (SELECT (array_agg(iv.id ORDER BY iv.version_number))[1] FROM public.invitation_versions iv
                  WHERE iv.wedding_id = current_setting('probe.wed_c')::uuid), 'active')$t$,
     '42501', '%permission denied for table publications%'),
    ('F2', 'anon may not read the credential store',
     $t$SELECT token_hash FROM private.access_tokens$t$,
     '42501', '%permission denied for schema private%'),
    ('F2', 'anon may not write the draft',
     $t$UPDATE public.invitation_drafts SET content = '{}'::jsonb
        WHERE wedding_id = current_setting('probe.wed_c')::uuid$t$,
     '42501', '%permission denied for table invitation_drafts%');
  PERFORM pg_temp.st3p_run('F2', 'anon', NULL);

  -- ---- positive controls ------------------------------------------------
  -- The same UPDATE the last probe refused is legal at 4000 characters, so the
  -- refusal above is about length and not about the statement being malformed.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  UPDATE public.invitation_drafts SET content =
      jsonb_set(content, '{event_notes}', to_jsonb(repeat('b', 4000)))
    WHERE wedding_id = current_setting('probe.wed_c')::uuid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.st3p_eq('F3 a 4000-character section is exactly as writable as a 4001-character one is not',
    (SELECT length(content ->> 'event_notes') FROM public.invitation_drafts d
      WHERE d.wedding_id = current_setting('probe.wed_c')::uuid), 4000);
  PERFORM pg_temp.st3p_eq('F4 the owner''s draft UPDATE still works, so F''s refusals are not a broken write path',
    v_rows, 1);

  -- An unknown key is unbounded on purpose: the contract projects four sections and
  -- a guest never sees the rest, so refusing here would be editing the editor's
  -- vocabulary into a constraint.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  UPDATE public.invitation_drafts SET content =
      jsonb_set(content, '{draft_history}', to_jsonb(repeat('c', 5000)))
    WHERE wedding_id = current_setting('probe.wed_c')::uuid;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.st3p_eq('F5 a key outside the contract is stored unbounded',
    (SELECT count(*) FROM public.invitation_drafts d
      WHERE d.wedding_id = current_setting('probe.wed_c')::uuid
        AND length(d.content ->> 'draft_history') = 5000), 1::bigint);

  -- ...and it is the *projection* that hides it, not the row: freeze a version now
  -- that the stray key is in the draft, and follow it all the way to the DTO.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  SELECT * INTO v_snap FROM api.create_invitation_version(current_setting('probe.wed_c')::uuid);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.st3p_eq('F6a a version frozen after the stray key exists does not carry it',
    (SELECT count(*) FROM public.invitation_versions iv
      WHERE iv.wedding_id = current_setting('probe.wed_c')::uuid
        AND iv.snapshot -> 'draft' ? 'draft_history'), 0::bigint);
  PERFORM pg_temp.st3p_ok('F6b the frozen draft block is the four contracted sections and nothing else',
    v_snap #> '{snapshot,draft}' ?& ARRAY['welcome', 'family_introduction', 'event_notes', 'closing']
    AND NOT (v_snap #> '{snapshot,draft}' ? 'draft_history'));
  SELECT private.public_invitation_dto((SELECT iv.snapshot_schema_version
      FROM public.invitation_versions iv
     WHERE iv.id = (v_snap ->> 'version_id')::uuid),
      (SELECT iv.snapshot FROM public.invitation_versions iv WHERE iv.id = (v_snap ->> 'version_id')::uuid))
    INTO v_dto;
  -- Stage 4 added the `sections` block to this projection, so the count that used to
  -- read "eleven fields and no twelfth" is now twelve. Asserted as the named set rather
  -- than as a number, because a count passes by coincidence and a set cannot.
  PERFORM pg_temp.st3p_has_keys('F6c the guest document is exactly the twelve contracted fields',
    v_dto, ARRAY['title', 'language', 'style', 'design_template', 'tradition_pack',
                 'sections', 'people', 'events', 'welcome', 'family_introduction',
                 'event_notes', 'closing']);
  PERFORM pg_temp.st3p_ok('F6d and the stray 5000 characters never reach a guest',
    v_dto::text NOT LIKE '%cccccc%');

  -- The wedding with nothing published deletes cleanly, which is what turns probe
  -- F''s 23503 into a statement about publications rather than about deletes.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  DELETE FROM public.weddings WHERE id = current_setting('probe.wed_bare')::uuid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.st3p_eq('F7 an unpublished wedding still deletes for its owner, so publication is the only thing blocked',
    v_rows, 1);
  PERFORM pg_temp.st3p_eq('F8 and its draft went with it, not left behind',
    (SELECT count(*) FROM public.invitation_drafts d
      WHERE d.wedding_id = current_setting('probe.wed_bare')::uuid), 0::bigint);
END $F$;

-- ===========================================================================
-- I. Revocation when the credential row is not there
-- ===========================================================================
--
-- Closure-repair directive §9. `api.revoke_invitation_publication` used to end with
-- `IF FOUND THEN UPDATE public.publications …`, and `FOUND` had been overwritten by
-- the `UPDATE private.access_tokens` in between. So for the one family whose
-- publication was active but whose live credential row was missing, `FOUND` was false,
-- the publication stayed `active`, and the call reported `revoked: false` — a takedown
-- that silently did nothing. The repaired body captures an explicit
-- `v_publication_found` before the token UPDATE and tests that.
--
-- This group is the state that used to be the bug, built honestly: the credential row
-- is deleted by the trusted role, which is the "absent" the directive asked for and
-- the only way to reach it from outside (no browser role may write `private`, and the
-- RPCs will not mint a credential without a publication). It then runs the case the
-- *opposite* way round — a live credential whose publication is already revoked — so
-- both halves of `v_publication_found OR v_count > 0` are observed rather than
-- reasoned about.
--
-- It is placed last, after F, because it removes rows F depends on: F's refusal probes
-- name `probe.pub_live_c` and a live credential, and those must still be exactly what
-- group C left them when F runs.
DO $I$
DECLARE
  v_rev   jsonb;
  v_pub   uuid;
  v_state jsonb;
BEGIN
  -- The precondition is measured, not assumed from group H, and it is asserted before
  -- anything is deleted: without it, "the credential is absent while the publication
  -- is live" would be a sentence about a fixture nobody checked.
  PERFORM pg_temp.st3p_eq('I0 the family is live in both halves — one active publication and exactly one un-revoked credential',
    (SELECT ARRAY[(SELECT count(*) FROM public.publications
                    WHERE wedding_id = current_setting('probe.wed_c')::uuid AND status = 'active'),
                  (SELECT count(*) FROM private.access_tokens
                    WHERE wedding_id = current_setting('probe.wed_c')::uuid AND revoked_at IS NULL)]),
    ARRAY[1::bigint, 1::bigint]);

  SELECT p.id INTO v_pub FROM public.publications p
   WHERE p.wedding_id = current_setting('probe.wed_c')::uuid AND p.status = 'active';

  DELETE FROM private.access_tokens
   WHERE wedding_id = current_setting('probe.wed_c')::uuid AND revoked_at IS NULL;
  PERFORM pg_temp.st3p_eq('I0b with the credential deleted, the publication is still the thing that says a guest link exists',
    (SELECT ARRAY[(SELECT count(*) FROM public.publications
                    WHERE wedding_id = current_setting('probe.wed_c')::uuid AND status = 'active'),
                  (SELECT count(*) FROM private.access_tokens
                    WHERE wedding_id = current_setting('probe.wed_c')::uuid AND revoked_at IS NULL)]),
    ARRAY[1::bigint, 0::bigint]);

  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  SELECT api.revoke_invitation_publication(current_setting('probe.wed_c')::uuid) INTO v_rev;
  EXECUTE 'RESET ROLE';

  PERFORM pg_temp.st3p_has_keys('I1 the answer still carries exactly the three fields it always did',
    v_rev, ARRAY['publication_id', 'revoked', 'tokens_revoked']);
  PERFORM pg_temp.st3p_eq('I2 with no credential to revoke, the takedown still happened, so FOUND-after-UPDATE was the bug and not the design',
    ARRAY[((v_rev ->> 'revoked')::boolean)::text, (v_rev ->> 'tokens_revoked')::text],
    ARRAY['true', '0']);
  PERFORM pg_temp.st3p_eq('I3 and the publication it took down is named, not guessed at',
    (v_rev ->> 'publication_id')::uuid, v_pub);
  PERFORM pg_temp.st3p_eq('I4 the publication row is revoked, with the time recorded',
    (SELECT ARRAY[p.status, (p.revoked_at IS NOT NULL)::text] FROM public.publications p WHERE p.id = v_pub),
    ARRAY['revoked', 'true']);

  -- A no-op has to be reported as a no-op. With the publication already down and no
  -- credential left, the same call must not claim a second takedown: `revoked=false`
  -- and a NULL `publication_id` are what tell a host that nothing was live to begin
  -- with, which is also why `revoked` cannot simply mean "the call succeeded".
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  SELECT api.revoke_invitation_publication(current_setting('probe.wed_c')::uuid) INTO v_rev;
  SELECT api.get_invitation_publication_state(current_setting('probe.wed_c')::uuid) INTO v_state;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.st3p_eq('I5 revoking an already-down invitation says so instead of repeating itself',
    ARRAY[((v_rev ->> 'revoked')::boolean)::text, (v_rev -> 'publication_id')::text, (v_rev ->> 'tokens_revoked')::text],
    ARRAY['false', 'null', '0']);
  PERFORM pg_temp.st3p_eq('I6 the host read agrees: no active publication, no live link',
    ARRAY[(v_state -> 'publication_id')::text, (v_state ->> 'link_active')::text],
    ARRAY['null', 'false']);
  PERFORM pg_temp.st3p_eq('I7 a guest holding the last known address still gets only the generic refusal',
    pg_temp.st3p_resolve(current_setting('probe.token_c')), jsonb_build_object('available', false));

  -- The opposite corruption, built rather than imagined: a credential row that is live
  -- while the publication it names has already been revoked. Nothing in the schema
  -- prevents the row (the composite FK only requires the publication to belong to the
  -- same wedding), which is exactly why revocation must not rely on the publication
  -- half to decide whether to sweep the credential half.
  INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, expiry_policy)
    VALUES (current_setting('probe.hash_b'), 'public_invitation',
            current_setting('probe.wed_c')::uuid, v_pub, 'no_expiry');
  PERFORM pg_temp.st3p_eq('I7b an orphan credential is representable, so the sweep cannot assume a live publication',
    (SELECT count(*) FROM private.access_tokens
      WHERE wedding_id = current_setting('probe.wed_c')::uuid AND revoked_at IS NULL), 1::bigint);

  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', current_setting('probe.owner_c'), false);
  SELECT api.revoke_invitation_publication(current_setting('probe.wed_c')::uuid) INTO v_rev;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.st3p_eq('I8 the orphan is revoked, and the answer reports the credential without inventing a publication',
    ARRAY[((v_rev ->> 'revoked')::boolean)::text, (v_rev -> 'publication_id')::text, (v_rev ->> 'tokens_revoked')::text],
    ARRAY['true', 'null', '1']);
  PERFORM pg_temp.st3p_eq('I9 and it really is revoked in the row, not only in the reply',
    (SELECT count(*) FROM private.access_tokens
      WHERE wedding_id = current_setting('probe.wed_c')::uuid AND revoked_at IS NULL), 0::bigint);

  -- The refusal still cannot be reached by a caller who does not own the wedding, even
  -- in this state — ownership is decided before any of the above runs.
  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('I', 'another account cannot take down a family it does not own, credential row or none',
     $t$SELECT api.revoke_invitation_publication(current_setting('probe.wed_c')::uuid)$t$,
     '42501', '%the caller may not revoke this wedding%'),
    ('I', 'and the same refusal for a wedding that does not exist',
     $t$SELECT api.revoke_invitation_publication(current_setting('probe.no_such')::uuid)$t$,
     '42501', '%the caller may not revoke this wedding%');
  PERFORM pg_temp.st3p_run('I', 'authenticated', current_setting('probe.owner_d'));
END $I$;

-- ===========================================================================
-- Z. Leave nothing behind
-- ===========================================================================
--
-- `--single-transaction` commits a file that succeeds, and the attack suite that
-- runs next counts rows. Child before parent, which is the same erasure order the
-- Stage 2 migrations document for a trusted cleanup.
DO $Z$
DECLARE
  v_left bigint;
BEGIN
  DELETE FROM private.access_tokens t USING pf WHERE t.wedding_id IN (pf.wed_c, pf.wed_d, pf.wed_bare);
  DELETE FROM public.publications p     USING pf WHERE p.wedding_id IN (pf.wed_c, pf.wed_d, pf.wed_bare);
  DELETE FROM public.invitation_versions v USING pf WHERE v.wedding_id IN (pf.wed_c, pf.wed_d, pf.wed_bare);
  DELETE FROM public.weddings w          USING pf WHERE w.id IN (pf.wed_c, pf.wed_d, pf.wed_bare);
  DELETE FROM public.design_templates t  USING pf WHERE t.id = pf.tmpl_c;
  DELETE FROM auth.users u               USING pf WHERE u.id IN (pf.owner_c, pf.owner_d);

  SELECT count(*) INTO v_left FROM public.weddings w JOIN pf ON pf.wed_c = w.id OR pf.wed_d = w.id
                                              OR pf.wed_bare = w.id;
  PERFORM pg_temp.st3p_eq('Z1 no fixture wedding survives', v_left, 0::bigint);
  SELECT count(*) INTO v_left FROM private.access_tokens t JOIN pf ON pf.wed_c = t.wedding_id OR pf.wed_d = t.wedding_id;
  PERFORM pg_temp.st3p_eq('Z2 no credential survives', v_left, 0::bigint);
  SELECT count(*) INTO v_left FROM public.publications p JOIN pf ON pf.wed_c = p.wedding_id OR pf.wed_d = p.wedding_id;
  PERFORM pg_temp.st3p_eq('Z3 no publication survives', v_left, 0::bigint);
  SELECT count(*) INTO v_left FROM public.invitation_versions v JOIN pf ON pf.wed_c = v.wedding_id OR pf.wed_d = v.wedding_id;
  PERFORM pg_temp.st3p_eq('Z4 no frozen version survives', v_left, 0::bigint);
  SELECT count(*) INTO v_left FROM public.invitation_drafts d JOIN pf ON pf.wed_c = d.wedding_id
       OR pf.wed_d = d.wedding_id OR pf.wed_bare = d.wedding_id;
  PERFORM pg_temp.st3p_eq('Z5 no draft outlives the wedding it belongs to', v_left, 0::bigint);
  SELECT count(*) INTO v_left FROM public.guest_households h JOIN pf ON pf.household_c = h.id OR pf.household_d = h.id;
  PERFORM pg_temp.st3p_eq('Z6 the two households cascaded with their weddings', v_left, 0::bigint);
  SELECT count(*) INTO v_left FROM auth.users u JOIN pf ON pf.owner_c = u.id OR pf.owner_d = u.id;
  PERFORM pg_temp.st3p_eq('Z7 the two host accounts are gone, so no other suite sees a stranger''s owner', v_left, 0::bigint);
  PERFORM pg_temp.st3p_eq('Z8 the probe template is gone',
    (SELECT count(*) FROM public.design_templates t JOIN pf ON pf.tmpl_c = t.id), 0::bigint);
  -- Stage 4 made this one worth stating out loud: an approved pack release cannot be
  -- deleted by anybody, so a file that minted one could not clean up after itself and
  -- would leave the suites that run next counting a stranger's rows. This file's answer
  -- is to need no pack at all; the pack-bearing guest document is qualified by
  -- `supabase/tests/stage4/50_pack_release.sql`, which runs after everything else.
  PERFORM pg_temp.st3p_eq('Z9 this file seeded no tradition pack and no release',
    ARRAY[(SELECT count(*) FROM public.tradition_packs),
          (SELECT count(*) FROM public.tradition_pack_releases)],
    ARRAY[0::bigint, 0::bigint]);
END $Z$;

-- ===========================================================================
-- Floor
-- ===========================================================================
--
-- A file that prints its own total proves it reached the end; the floor proves it
-- reached *this* end. The number below is the count of assertions and probes in
-- groups A-Z as measured by a run of both chains: 218 labelled assertions plus 66
-- refusal probes = 284. Stage 3's own total was 246 (182 plus 64) and its closure
-- repair took that to 269; Stage 4 added 15 by asserting the section contract on a
-- pack-less document (B15b-B15g), the resolved section shape on the guest page
-- (D13b-D13g), the unknown-kind refusal in both of its arms (D37b required, D37c
-- optional) and the empty-catalogue cleanup invariant (Z9). An earlier note here
-- counted 13 and printed 282; the two it left out were D13g and the D37c arm that
-- §24's split created. The previous totals are kept rather than overwritten because
-- §20 asks for old and new counts side by side. The probe groups are B(3) B4(1)
-- B2(6) B3(2) C(5) C2(3) C4(4) D(2) E(18) F(13) F2(4) H(3) I(2); every one of them
-- also fails the run outright if it executes zero probes, so a group cannot quietly
-- empty itself.
DO $END$
DECLARE n integer;
BEGIN
  n := coalesce(nullif(current_setting('st3p.passed', true), ''), '0')::int;
  IF n < 284 THEN
    RAISE EXCEPTION 'FAIL: only % assertions ran; this file has 284 and stopped early', n;
  END IF;
  RAISE NOTICE 'ALL STAGE 3 PUBLICATION TESTS PASSED (%)', n;
END $END$;

SELECT 'STAGE3 PUBLICATION TESTS PASSED (' || current_setting('st3p.passed') || ')';
