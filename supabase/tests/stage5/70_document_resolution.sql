-- Stage 5: the resolution battery — one server resolver feeding preview and freeze alike, the
-- provenance a frozen document keeps forever, the issues the editor is allowed to act on, and
-- what a retirement does and does not change about a document a guest is already reading.
--
-- Run last in the Stage 5 chain, as the superuser, in one transaction that commits.
--
-- Stage 4 already proved the document half of this: an approved release pins, a section order is
-- data, Tamil is served when a release has Tamil, and a guest reads what the host approved
-- forever. What Stage 5 changed is *who decides*, so this file measures three things Stage 4's
-- battery could not: the authoring rules that now govern whose words reach the page
-- (`override_rule`, `requires_venue`), the machine-readable verdict the editor renders instead
-- of re-implementing, and the single resolution both preview and freeze go through — which is
-- the only arrangement in which "the preview showed me no problem" and "the freeze refused"
-- cannot both be true of the same document.
--
--   BASE  the run's identity and the counts this file starts from
--   S     what a customer may select, measured through the UPDATE the browser sends
--   R     the resolver under the three override rules, and the four provenance states
--   I     the issue engine: every code, the record shape, and what a record must never contain
--   F     the freeze: what it refuses, what it accepts, and that it recomputes
--   P     preview/freeze parity, measured as document equality and as sentence equality
--   H     history: a retirement, a newer release, and the bytes that do not move
--   D     the recursive walk over everything the browser is handed
--   C     the culture-free body test over every body the document path can reach
--   T     the ledger and the floor
--
-- Nothing here reviews anything. Every pack and release below is a synthetic fixture carrying
-- the words TEST ONLY, `machine_assisted = true` and a scope statement that endorses no
-- tradition. The Tamil strings are reused from Stage 4's committed fixtures so this file
-- invents no ceremonial wording; the real Tamil candidate is not touched, not reviewed and not
-- approved by anything in here.

SET client_min_messages = notice;
SELECT set_config('s7.passed', '0', false);

-- --------------------------------------------------------------------------- helpers
CREATE FUNCTION pg_temp.s7_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s7.passed',
    (coalesce(nullif(current_setting('s7.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s7_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s7_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s7_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s7_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s7_jq(label text, got jsonb, want jsonb) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label,
      coalesce(got::text, '<null>'), coalesce(want::text, '<null>');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s7_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s7_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

CREATE FUNCTION pg_temp.s7_is_superuser(label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'FAIL % — running as %', label, current_user;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s7_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s7_head() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(current_setting('app.stage_head', true), '(unset)') $fn$;

-- The host's own freeze, as the host. Written again rather than shared with Stage 4's battery,
-- because `pg_temp` lives for one psql invocation and the two suites are separate invocations by
-- design — and because a leaked `SET ROLE` here would silently turn the rest of this file into a
-- customer-role test, so both the success and the failure path reset.
CREATE FUNCTION pg_temp.s7_freeze(p_host uuid, p_wedding uuid) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v_res jsonb;
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_host::text, false);
  SELECT api.create_invitation_version(p_wedding) INTO v_res;
  EXECUTE 'RESET ROLE';
  RETURN v_res;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RAISE;
END $fn$;

CREATE FUNCTION pg_temp.s7_freeze_err(p_host uuid, p_wedding uuid) RETURNS text
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

-- The host's live document, from the one call that also carries the server's verdict.
CREATE FUNCTION pg_temp.s7_doc(p_host uuid, p_wedding uuid) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v_res jsonb;
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_host::text, false);
  SELECT api.preview_invitation_document(p_wedding) INTO v_res;
  EXECUTE 'RESET ROLE';
  RETURN v_res;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RETURN jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM);
END $fn$;

CREATE FUNCTION pg_temp.s7_select(p_host uuid, p_wedding uuid, p_release uuid)
RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_res text;
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_host::text, false);
  v_res := pg_temp.s7_err('UPDATE public.weddings w SET tradition_pack_release_id = '
    || coalesce(quote_literal(p_release::text), 'NULL')
    || ' WHERE w.id = ' || quote_literal(p_wedding::text));
  EXECUTE 'RESET ROLE';
  RETURN v_res;
END $fn$;

-- The host's own edit of the draft text, through the same UPDATE the editor's save performs.
CREATE FUNCTION pg_temp.s7_write_draft(p_host uuid, p_wedding uuid, p_content jsonb)
RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_res text;
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', p_host::text, false);
  v_res := pg_temp.s7_err('UPDATE public.invitation_drafts SET content = '
    || quote_literal(coalesce(p_content, '{}'::jsonb)::text)
    || '::jsonb WHERE wedding_id = ' || quote_literal(p_wedding::text));
  EXECUTE 'RESET ROLE';
  RETURN v_res;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

CREATE FUNCTION pg_temp.s7_dto(p_version uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT private.public_invitation_dto(v.snapshot_schema_version, v.snapshot)
    FROM public.invitation_versions v WHERE v.id = p_version $fn$;

CREATE FUNCTION pg_temp.s7_snapshot(p_version uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT v.snapshot FROM public.invitation_versions v WHERE v.id = p_version $fn$;

-- The resolved section list as one line per section, in position order — the same eight facts
-- Stage 4 pinned, so a change reads as a changed row rather than as a re-projection.
CREATE FUNCTION pg_temp.s7_rows(p_snapshot jsonb) RETURNS text[]
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

CREATE FUNCTION pg_temp.s7_section(p_snapshot jsonb, p_key text) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT q FROM jsonb_array_elements(p_snapshot -> 'sections' -> 'items') e(q)
   WHERE q ->> 'section_key' = p_key $fn$;

CREATE FUNCTION pg_temp.s7_sorted(want text[]) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM unnest(coalesce(want, '{}'::text[])) u(k) $fn$;

CREATE FUNCTION pg_temp.s7_keys(v jsonb) RETURNS TABLE(k text)
LANGUAGE plpgsql AS $fn$
DECLARE r record;
BEGIN
  IF jsonb_typeof(v) = 'object' THEN
    FOR r IN SELECT jsonb_object_keys(v) AS key LOOP
      k := r.key;
      RETURN NEXT;
      RETURN QUERY SELECT * FROM pg_temp.s7_keys(v -> r.key);
    END LOOP;
  ELSIF jsonb_typeof(v) = 'array' THEN
    RETURN QUERY
      SELECT q.k FROM jsonb_array_elements(v) AS e(j)
                 JOIN LATERAL pg_temp.s7_keys(e.j) q ON true;
  END IF;
END $fn$;

CREATE FUNCTION pg_temp.s7_all_keys(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT pg_temp.s7_sorted(coalesce(array_agg(DISTINCT s.k), '{}'::text[]))
    FROM pg_temp.s7_keys(v) s $fn$;

-- Names that must never appear anywhere in a browser-facing document, at any depth, with the
-- offender named rather than counted — §L's recursive deny-list walk.
CREATE FUNCTION pg_temp.s7_no_forbidden(label text, v jsonb, banned text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE offenders text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT k), '{}'::text[]) INTO offenders
    FROM unnest(pg_temp.s7_all_keys(v)) u(k)
   WHERE k = ANY (banned);
  IF cardinality(offenders) > 0 THEN
    RAISE EXCEPTION 'FAIL % — leaked [%]', label, array_to_string(offenders, ', ');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s7_add(1);
END $fn$;

-- The instrument group C runs, declared here because `pg_temp` lives for one psql invocation and
-- this file is its own invocation. The vocabulary is Stage 4's `s4_cultural_hits` copied term for
-- term, not a Stage 5 dialect of it: two batteries holding the same contract in two word lists
-- would drift, and the drift would look like a passing run.
--
-- Code only, with both comment styles replaced by a space so a stripped comment cannot splice two
-- words together.
CREATE FUNCTION pg_temp.s7_code_only(src text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT lower(
           regexp_replace(
             regexp_replace(coalesce(src, ''), '/\*.*?\*/', ' ', 'gn'),
             '--[^\n]*', ' ', 'g')) $fn$;

-- What a body on the document path may not test for. A *concept* word may not appear in the code
-- at all, because its presence would mean the path is reasoning about it; a pack's *identifier*
-- may appear (a frozen document has to credit its release) but may not be compared to a literal.
-- Language codes are deliberately absent: switching on `'en'` is the declared-fallback rule the
-- release's own data asks for. See Stage 4's note on the same split.
CREATE FUNCTION pg_temp.s7_cultural_hits(src text) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT pg_temp.s7_sorted(coalesce(array_agg(DISTINCT u.k), '{}'::text[]))
    FROM (
      SELECT m[1] AS k
        FROM regexp_matches(
               pg_temp.s7_code_only(src),
               '\m(religion|religious|caste|jati|gotra|biradari|community|sect|sampradaya|'
               || 'hindu|muslim|christian|jain|sikh|buddhist|parivar|kula|gotriya|'
               || 'brahmin|bramin|kshatriya|vaishya|shudra|temple|church|mosque|gurudwara|'
               || 'deity|god|goddess|priest|pandit|purohit|archaka|auspicious|muhurat|'
               || 'horoscope|rahu|zodiac|astrolog|surname|pedigree|vedic|mantra|sanskrit|'
               || 'use_tamil_layout|tamil_layout|tamil_only|tamiz_only)\M', 'g') m
      UNION ALL
      SELECT 'pack_key compared to a literal' AS k
        WHERE pg_temp.s7_code_only(src)
              ~ '(pack_key[^a-z_0-9]*(=|<>|!~|~|<|>)[^a-z_0-9]*''[a-z0-9_-]+''|''[a-z0-9_-]+''[^a-z_0-9]*(=|<>)[^a-z_0-9]*pack_key)'
      UNION ALL
      SELECT 'tradition_pack_key compared to a literal' AS k
        WHERE pg_temp.s7_code_only(src)
              ~ '(tradition_pack_id[^a-z_0-9]*(=|<>)[^a-z_0-9]*''[a-f0-9-]{36}''|[a-f0-9-]{36}[^a-z_0-9]*(=|<>)[^a-z_0-9]*tradition_pack_id)'
    ) u $fn$;

-- One step of the closure: every qualified call written in these bodies, at a word boundary so a
-- reference to `internal_api.x` cannot also be read as a reference to a non-existent `api.x`.
CREATE FUNCTION pg_temp.s7_calls(src text) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT pg_temp.s7_sorted(coalesce(array_agg(DISTINCT (m[1] || '.' || m[2])), '{}'::text[]))
    FROM regexp_matches(pg_temp.s7_code_only(src),
                        '\m(internal_api|api|private|public)\.([a-z_0-9]+)\(', 'g') m $fn$;

-- The codes this build knows, in one place, so an arm added without a case here is visible as a
-- gap between this list and the engine's own body.
CREATE FUNCTION pg_temp.s7_issue_record_keys() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT pg_temp.s7_sorted(ARRAY['blocking', 'code', 'field', 'message_key',
                                 'params', 'section_key']) $fn$;

-- The version-2 document this battery resolves, freezes and retires: one section per override
-- rule, a required people list, a required event list that demands a venue, and an optional
-- English-only line a Tamil wedding will read as a declared substitution.
CREATE FUNCTION pg_temp.s7_def() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT '{"sections":[
    {"section_key":"opening","position":1,"kind":"text","required":false,
     "host_field":"welcome","override_rule":"host_may_replace","allow_english_fallback":true,
     "heading":{"en":"Opening","ta":"தொடக்கம்"},
     "pack_text":{"en":"With the goodwill of both families.","ta":"வணக்கம்"}}
    ,
    {"section_key":"family","position":2,"kind":"people_list","required":true,
     "heading":{"en":"Our families","ta":"குடும்பம்"}}
    ,
    {"section_key":"ceremonies","position":3,"kind":"event_list","required":true,
     "requires_venue":true,"heading":{"en":"The ceremonies","ta":"நிகழ்ச்சிகள்"}}
    ,
    {"section_key":"blessing","position":4,"kind":"text","required":true,
     "override_rule":"pack_only","host_field":"family_introduction",
     "heading":{"en":"A closing line","ta":"முடிப்பு"},
     "pack_text":{"en":"Reviewed wording the host may not replace.",
                  "ta":"வணக்கம்"}}
    ,
    {"section_key":"event_notes","position":5,"kind":"text","required":false,
     "override_rule":"host_must_supply","host_field":"event_notes",
     "heading":{"en":"Note","ta":"குறிப்பு"}}
    ,
    {"section_key":"closing","position":6,"kind":"text","required":false,
     "host_field":"closing","override_rule":"host_may_replace","allow_english_fallback":true,
     "heading":{"en":"Farewell","ta":"வீடை"},
     "pack_text":{"en":"English-only wording, which a Tamil invitation may not read as Tamil."}}
  ]}'::jsonb $fn$;

-- ------------------------------------------------------------- the run's own identity
DO $BASE$
DECLARE v_weds bigint; v_vers bigint; v_mine bigint;
BEGIN
  PERFORM pg_temp.s7_is_superuser('BASE0 the resolution battery is qualified as the maintenance '
    'identity and hands the pen to the host wherever a case needs one');
  PERFORM pg_temp.s7_eq('BASE1 the run declares the Stage 5 head, because the resolver, the '
    'issue engine and the preview document measured here are all Stage 5 objects',
    pg_temp.s7_head(), 'stage5');
  SELECT count(*) INTO v_weds FROM public.weddings;
  SELECT count(*) INTO v_vers FROM public.invitation_versions;
  SELECT count(*) INTO v_mine FROM public.tradition_packs WHERE pack_key LIKE 'stage7\_%';
  PERFORM pg_temp.s7_eq('BASE2 none of this file''s own pack keys is already in the catalogue, '
    'so the documents below are this file''s and nobody else''s', v_mine, 0::bigint);
  PERFORM set_config('s7.base_weds', v_weds::text, false);
  PERFORM set_config('s7.base_vers', v_vers::text, false);
  RAISE NOTICE 'PASS BASE3 the catalogue at entry is measured, not assumed (weddings=%, versions=%)',
    v_weds, v_vers;
  PERFORM pg_temp.s7_add(1);
END $BASE$;

-- ------------------------------------------------------------------------- fixtures
CREATE TEMP TABLE sf ON COMMIT DROP AS
SELECT gen_random_uuid() AS host, gen_random_uuid() AS maint,
       gen_random_uuid() AS pack, gen_random_uuid() AS rel_a,
       gen_random_uuid() AS rel_b, gen_random_uuid() AS rel_c,
       gen_random_uuid() AS rel_d,
       gen_random_uuid() AS pack_dep, gen_random_uuid() AS rel_e,
       gen_random_uuid() AS wed, gen_random_uuid() AS wed_nolive,
       gen_random_uuid() AS wed_novenue, gen_random_uuid() AS wed_ml,
       gen_random_uuid() AS wed_none, gen_random_uuid() AS tmpl;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT host, 'stage7-host@example.test', jsonb_build_object('name', 'Stage 7 host') FROM sf
UNION ALL
SELECT maint, 'stage7-maintainer@example.test',
       jsonb_build_object('name', 'Stage 7 maintenance account') FROM sf;

INSERT INTO public.design_templates (id, template_key, revision, display_name,
                                     layout_settings, preview_svg)
SELECT tmpl, 'stage7-template', 1, 'TEST ONLY — Stage 5 resolution battery template',
       '{"margins":"SENTINEL-LAYOUT"}'::jsonb,
       '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
  FROM sf;

-- Five weddings, one per outcome the server has to produce: complete, nothing written yet, a
-- ceremony with no place, an unsupported language, and no tradition pack at all. The style
-- literals are cast because a `UNION ALL` resolves an untyped string to text, and the column is
-- jsonb — a plain single-branch INSERT would have been assignment-cast without saying so.
INSERT INTO public.weddings (id, owner_user_id, title, primary_language,
                             additional_languages, style_settings, design_template_id)
SELECT wed, host, 'Asha weds Bala', 'ta', ARRAY['en'],
       '{"font":"Mukta Malar","fontSize":"20","color":"#7A1F1F","alignment":"left"}'::jsonb, tmpl
  FROM sf
UNION ALL
SELECT wed_nolive, host, 'Asha weds Bala (nothing written yet)', 'ta', ARRAY['en'],
       '{"font":"Mukta Malar","fontSize":"20","color":"#7A1F1F","alignment":"left"}'::jsonb, tmpl
  FROM sf
UNION ALL
SELECT wed_novenue, host, 'Asha weds Bala (a ceremony with no place)', 'ta', ARRAY['en'],
       '{"font":"Mukta Malar","fontSize":"20","color":"#7A1F1F","alignment":"left"}'::jsonb, tmpl
  FROM sf
UNION ALL
SELECT wed_ml, host, 'Asha weds Bala (Malayalam)', 'ml', ARRAY['en'],
       '{"font":"Anek Malayalam","fontSize":"20","color":"#1F3A5C","alignment":"left"}'::jsonb, tmpl
  FROM sf
UNION ALL
SELECT wed_none, host, 'Asha weds Bala (no tradition pack)', 'ta', ARRAY['en'],
       '{"font":"Mukta Malar","fontSize":"20","color":"#7A1F1F","alignment":"left"}'::jsonb, tmpl
  FROM sf;

-- The people and the places. `wed_nolive` is deliberately left with neither, and `wed_novenue`
-- gets a second enabled ceremony with no venue so the venue arm has exactly one gap to count.
INSERT INTO public.wedding_people (wedding_id, display_name, role_key, role_label,
                                   group_key, group_label, display_order)
SELECT w.id, 'Maran', 'father', 'Father', 'bride-side', 'The families of', 0
  FROM (SELECT wed AS id FROM sf
        UNION ALL SELECT wed_novenue FROM sf
        UNION ALL SELECT wed_ml FROM sf
        UNION ALL SELECT wed_none FROM sf) w;

INSERT INTO public.venues (wedding_id, name, address_text, map_url)
SELECT x.id, 'Kalyana Mantapa', '1 Museum Road, Madurai', 'https://maps.example.test/km'
  FROM (SELECT wed AS id FROM sf
        UNION ALL SELECT wed_novenue FROM sf
        UNION ALL SELECT wed_ml FROM sf
        UNION ALL SELECT wed_none FROM sf) x;

INSERT INTO public.wedding_events (wedding_id, event_key, display_name, venue_id,
                                   starts_at_local, ends_at_local, timezone,
                                   display_order, enabled)
SELECT x.id, x.key, x.label,
       (SELECT v.id FROM public.venues v
         WHERE v.wedding_id = x.id AND x.with_venue),
       x.starts, NULL, 'Asia/Kolkata', x.ord, true
  FROM (VALUES
    ((SELECT wed FROM sf),        'event_a', 'First ceremony',  true,
      '2027-02-14 09:30'::timestamp, 0),
    ((SELECT wed_novenue FROM sf),'event_a', 'First ceremony',  true,
      '2027-02-14 09:30'::timestamp, 0),
    ((SELECT wed_novenue FROM sf),'event_b', 'Second ceremony', false,
      '2027-02-14 18:00'::timestamp, 1),
    ((SELECT wed_ml FROM sf),     'event_a', 'First ceremony',  true,
      '2027-02-14 09:30'::timestamp, 0),
    ((SELECT wed_none FROM sf),   'event_a', 'First ceremony',  true,
      '2027-02-14 09:30'::timestamp, 0)
  ) AS x(id, key, label, with_venue, starts, ord);

-- The host's own words on the complete wedding: a replacement of offered wording, a line this
-- release forbids replacing, and a line only the host can write.
UPDATE public.invitation_drafts d SET content = jsonb_build_object(
       'welcome', 'Written by the host, in the host''s own words.',
       'family_introduction', 'The host''s own introduction, which this release will not show.',
       'event_notes', 'Please arrive by nine.')
  FROM sf WHERE d.wedding_id = sf.wed;

UPDATE public.invitation_drafts d SET content = jsonb_build_object(
       'welcome', 'A host welcome written in English.')
  FROM sf WHERE d.wedding_id = sf.wed_ml;

UPDATE public.invitation_drafts d SET content = jsonb_build_object(
       'welcome', 'A host welcome for the wedding that chose no pack.',
       'family_introduction', 'The families, in the host''s words.',
       'event_notes', 'Please arrive by nine.',
       'closing', 'Thank you for coming.')
  FROM sf WHERE d.wedding_id = sf.wed_none;

-- The packs. `stage7_resolution` carries two approved releases so the history group can retire
-- one and offer the other; `stage7_retired` carries the one that gets retired underneath a
-- wedding; the third and fourth releases of the resolution pack stay at draft and reviewed,
-- which is what the selection refusals below depend on rather than on a fixture invented for it.
INSERT INTO public.tradition_packs (id, pack_key, display_name, scope_statement)
SELECT pack, 'stage7_resolution', 'TEST ONLY — Stage 5 resolution pack',
       'TEST ONLY — a synthetic pack shape used to measure how a resolved document, its verdict '
       'and its frozen bytes are produced. It claims no tradition, reviews no religious text, and '
       'is never shipped.' FROM sf
UNION ALL
SELECT pack_dep, 'stage7_retired', 'TEST ONLY — Stage 5 retired pack',
       'TEST ONLY — a pack whose one approved release is retired underneath a wedding while that '
       'wedding''s frozen documents keep their bytes. It claims no tradition and ships nothing.'
  FROM sf;

INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT rel_a, pack, 1, 2, ARRAY['en', 'ta'], pg_temp.s7_def(),
       'TEST ONLY — synthetic authored fixture', true,
       'TEST ONLY — drafted by a model from product structure and checked for shape and language '
       || 'coverage. No human reader of Tamil reviewed any string in this release.',
       'TEST ONLY — no external source', 'First resolution release' FROM sf
UNION ALL
SELECT rel_b, pack, 2, 2, ARRAY['en', 'ta'],
       jsonb_set(pg_temp.s7_def(), '{sections,0,pack_text,en}',
                 '"With the goodwill of both families, in release two."'::jsonb),
       'TEST ONLY — synthetic authored fixture', true,
       'TEST ONLY — drafted by a model from product structure and checked for shape and language '
       || 'coverage. No human reader of Tamil reviewed any string in this release.',
       'TEST ONLY — no external source', 'Second release, one English line away from the first'
  FROM sf
UNION ALL
SELECT rel_c, pack, 3, 2, ARRAY['en', 'ta'], pg_temp.s7_def(),
       'TEST ONLY — synthetic authored fixture', true,
       'TEST ONLY — drafted by a model from product structure and checked for shape and language '
       || 'coverage. No human reader of Tamil reviewed any string in this release.',
       'TEST ONLY — no external source', 'A release nobody has reviewed' FROM sf
UNION ALL
SELECT rel_d, pack, 4, 2, ARRAY['en', 'ta'], pg_temp.s7_def(),
       'TEST ONLY — synthetic authored fixture', true,
       'TEST ONLY — drafted by a model from product structure and checked for shape and language '
       || 'coverage. No human reader of Tamil reviewed any string in this release.',
       'TEST ONLY — no external source', 'A release reviewed but never approved' FROM sf
UNION ALL
SELECT rel_e, pack_dep, 1, 2, ARRAY['en', 'ta'], pg_temp.s7_def(),
       'TEST ONLY — synthetic authored fixture', true,
       'TEST ONLY — drafted by a model from product structure and checked for shape and language '
       || 'coverage. No human reader of Tamil reviewed any string in this release.',
       'TEST ONLY — no external source', 'A release that will be retired under a wedding'
  FROM sf;

-- Move the three releases that need an approved state through the guard rather than stamping
-- the state, so every fixture below carries the binding §9 requires of a reviewed release, and
-- the reviewed-but-never-approved one stops exactly there.
CREATE FUNCTION pg_temp.s7_publish(p_rel uuid, p_maint uuid, p_to text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_err text;
BEGIN
  v_err := pg_temp.s7_err(
    'UPDATE public.tradition_pack_releases SET status = ''reviewed'', '
    || 'review_label = ''TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW'', '
    || 'review_basis = ''Automated Stage 5 database qualification only. No human cultural '
    || 'authority, no religious standing and no native-speaker language competence is claimed '
    || 'by, or behind, this record.'', '
    || 'review_scope = ''TEST ONLY — section order, kinds, override rules and coverage read; no '
    || 'ritual or religious content is present to review.'', '
    || 'reviewed_languages = ''{en,ta}''::text[], reviewed_by = '
    || quote_literal(p_maint::text) || '::uuid, reviewed_at = now() WHERE id = '
    || quote_literal(p_rel::text) || '::uuid');
  IF v_err <> 'no-error' THEN RETURN 'reviewed: ' || v_err; END IF;
  IF p_to = 'reviewed' THEN RETURN 'no-error'; END IF;
  v_err := pg_temp.s7_err('UPDATE public.tradition_pack_releases SET status = ''approved'' '
    || 'WHERE id = ' || quote_literal(p_rel::text) || '::uuid');
  IF v_err <> 'no-error' THEN RETURN 'approved: ' || v_err; END IF;
  RETURN 'no-error';
END $fn$;

DO $PUB$
DECLARE v_maint uuid; v_err text;
BEGIN
  SELECT maint INTO v_maint FROM sf;
  v_err := pg_temp.s7_publish((SELECT rel_a FROM sf), v_maint, 'approved');
  PERFORM pg_temp.s7_eq('PUB0 release 1 was walked through the guard rather than stamped, so it '
    'carries the binding a reviewed release has to carry (' || v_err || ')', v_err, 'no-error');
  v_err := pg_temp.s7_publish((SELECT rel_b FROM sf), v_maint, 'approved');
  PERFORM pg_temp.s7_eq('PUB0b the same for release 2, which the history group will offer after '
    'release 1 is retired (' || v_err || ')', v_err, 'no-error');
  v_err := pg_temp.s7_publish((SELECT rel_e FROM sf), v_maint, 'approved');
  PERFORM pg_temp.s7_eq('PUB0c and for the release that is about to be retired underneath a '
    'wedding (' || v_err || ')', v_err, 'no-error');
  v_err := pg_temp.s7_publish((SELECT rel_d FROM sf), v_maint, 'reviewed');
  PERFORM pg_temp.s7_eq('PUB0d and the reviewed-but-never-approved fixture stops at reviewed, '
    'which is the state the selection refusals depend on (' || v_err || ')', v_err, 'no-error');
  PERFORM pg_temp.s7_jq('PUB1 the four states this battery needs really are the four states the '
    'catalogue holds, so a refusal below is about a lifecycle position and not about a missing row',
    (SELECT jsonb_object_agg(r.release_number, r.status ORDER BY r.release_number)
       FROM public.tradition_pack_releases r
       JOIN public.tradition_packs p ON p.id = r.pack_id
      WHERE p.pack_key = 'stage7_resolution'),
    '{"1":"approved","2":"approved","3":"draft","4":"reviewed"}'::jsonb);
END $PUB$;

-- ===================================================== S. what a customer may select
-- Selection is the one place where a customer touches the catalogue, so it is measured through
-- the UPDATE the browser actually sends, as `authenticated`, with `test.uid` set to the account
-- that owns the wedding. A fixture written by the maintenance role would prove the row policy
-- and nothing else.
DO $S$
DECLARE v_host uuid; v_rel_a uuid; v_rel_c uuid; v_rel_d uuid; v_wed uuid;
        v_err text; v_unknown uuid := '11111111-2222-3333-4444-555555555555'::uuid;
BEGIN
  PERFORM pg_temp.s7_is_superuser('S0 the selection group hands the pen to the host and takes '
    'it back');
  SELECT host, rel_a, rel_c, rel_d, wed INTO v_host, v_rel_a, v_rel_c, v_rel_d, v_wed FROM sf;

  v_err := pg_temp.s7_select(v_host, v_wed, v_rel_c);
  PERFORM pg_temp.s7_ok('S1 a draft release cannot be selected, so unreviewed wording has no '
    'path onto a customer''s page however well it is authored (' || v_err || ')',
    v_err LIKE '42501%');

  v_err := pg_temp.s7_select(v_host, v_wed, v_rel_d);
  PERFORM pg_temp.s7_ok('S2 and a reviewed release cannot be selected either: a reader having '
    'said "this is fit" is not the same act as the platform shipping it (' || v_err || ')',
    v_err LIKE '42501%');

  v_err := pg_temp.s7_select(v_host, v_wed, v_unknown);
  PERFORM pg_temp.s7_ok('S3 a guessed release id selects nothing, because the refusal comes from '
    'the row policy over a row that does not exist rather than from a lookup that could be '
    'probed (' || v_err || ')', v_err LIKE '42501%');

  v_err := pg_temp.s7_select(v_host, v_wed, v_rel_a);
  PERFORM pg_temp.s7_eq('S4 the approved TEST ONLY fixture can be selected, which is the control '
    'that keeps the three refusals above from meaning "a customer selects nothing" ('
    || v_err || ')', v_err, 'no-error');

  PERFORM pg_temp.s7_eq('S4b and the wedding really does hold that pointer now',
    (SELECT tradition_pack_release_id FROM public.weddings WHERE id = v_wed), v_rel_a);

  v_err := pg_temp.s7_err('SET ROLE authenticated; SELECT set_config(''test.uid'', '
    || quote_literal(v_host::text) || ', false); '
    || 'UPDATE public.tradition_pack_releases SET changelog = ''edited after selection'' '
    || 'WHERE id = ' || quote_literal(v_rel_a::text) || '; RESET ROLE');
  PERFORM pg_temp.s7_ok('S5 selecting a release does not make it editable by the customer who '
    'selected it — §L''s "cannot mutate a release after selection" (' || v_err || ')',
    v_err LIKE '42501%');
END $S$;

-- ======================================= R. the resolver under the three override rules
DO $R$
DECLARE v_snap jsonb; v_rows text[]; v_bless jsonb; v_open jsonb; v_note jsonb;
        v_close jsonb;
BEGIN
  PERFORM pg_temp.s7_is_superuser('R0 the resolver group reads the live document as the '
    'maintenance identity, then compares it with the host''s own copy in group P');
  SELECT private.build_invitation_snapshot(wed) INTO v_snap FROM sf;

  -- The eight facts per section, in position order. This is the document: the order is the
  -- release's, the wording attribution is the resolver's, and no branch below knows the pack's
  -- name or the wedding's language beyond the tag it was handed.
  v_rows := pg_temp.s7_rows(v_snap);
  PERFORM pg_temp.s7_eq('R1 the resolved document is six sections in the release''s order, each '
    'with the attribution its own override rule produced — and nothing in this row was decided by '
    'a per-pack branch (' || array_to_string(v_rows, ' ;; ') || ')',
    v_rows,
    ARRAY['1|opening|text|host|-|-|true|ta',
          '2|family|people_list|-|-|-|-|ta',
          '3|ceremonies|event_list|-|-|-|-|ta',
          '4|blessing|text|reviewed_pack|ta|false|false|ta',
          '5|event_notes|text|host|-|-|false|ta',
          '6|closing|text|reviewed_pack|en|true|false|ta']);

  v_open  := pg_temp.s7_section(v_snap, 'opening');
  v_bless := pg_temp.s7_section(v_snap, 'blessing');
  v_note  := pg_temp.s7_section(v_snap, 'event_notes');
  v_close := pg_temp.s7_section(v_snap, 'closing');

  PERFORM pg_temp.s7_ok('R2 host_may_replace with a host line present resolves to the host, and '
    'says it replaced wording the release had offered',
    v_open ->> 'body_source' = 'host' AND (v_open ->> 'overrode_pack_text')::boolean);

  -- §D's sentence, made measurable: a host override never inherits review credit. The section
  -- that forbids replacement still reports the reviewer's wording as the body even though the
  -- host filled the field, and the field itself is what the advisory below points at.
  PERFORM pg_temp.s7_jq('R3 pack_only keeps the reviewed line as the body however full the '
    'host''s field is, so a host override cannot inherit review credit by editing around it',
    jsonb_build_object('source', v_bless -> 'body_source',
                       'overrode', v_bless -> 'overrode_pack_text',
                       'text', v_bless -> 'body_text',
                       'field', v_bless -> 'host_field'),
    jsonb_build_object('source', '"reviewed_pack"'::jsonb, 'overrode', false,
                       'text', '"வணக்கம்"'::jsonb,
                       'field', '"family_introduction"'::jsonb));

  PERFORM pg_temp.s7_jq('R4 host_must_supply resolves to the host with overrode_pack_text false, '
    'which is the difference between "the host replaced wording we supplied" and "the host wrote '
    'the line" — and the document reports it',
    jsonb_build_object('source', v_note -> 'body_source',
                       'overrode', v_note -> 'overrode_pack_text',
                       'text', v_note -> 'body_text'),
    jsonb_build_object('source', '"host"'::jsonb, 'overrode', false, 'text', null));

  PERFORM pg_temp.s7_jq('R5 and a line the release has only in English reaches a Tamil wedding '
    'marked as English and marked as the substitution it is, never labelled Tamil',
    jsonb_build_object('source', v_close -> 'body_source',
                       'language', v_close -> 'body_language',
                       'fallback', v_close -> 'body_fallback_used'),
    jsonb_build_object('source', '"reviewed_pack"'::jsonb, 'language', '"en"'::jsonb,
                       'fallback', true));

  -- The four provenance states §7 asks a frozen document to keep distinguishable. They are not
  -- four enum values; they are the combinations the resolver already emits, and the derivation
  -- below is what says all four are reachable in one document — a list written by this battery
  -- and compared with itself would prove nothing at all.
  SELECT pg_temp.s7_sorted(coalesce(array_agg(z.st), '{}'::text[]))
    INTO v_rows
    FROM (SELECT CASE WHEN q ->> 'body_source' = 'reviewed_pack'
                       AND (q ->> 'body_fallback_used')::boolean   THEN 'fallback'
                      WHEN q ->> 'body_source' = 'host'
                       AND (q ->> 'overrode_pack_text')::boolean   THEN 'host_override'
                      WHEN q ->> 'body_source' = 'host'            THEN 'host'
                      WHEN q ->> 'body_source' = 'reviewed_pack'   THEN 'reviewed_pack'
                 END AS st
            FROM jsonb_array_elements(v_snap -> 'sections' -> 'items') e(q)) z
   WHERE z.st IS NOT NULL;
  PERFORM pg_temp.s7_eq('R6 the document this release resolves holds all four provenance states '
    'at once — reviewed wording, a host line the release never offered, a host line that replaced '
    'offered wording, and reviewed wording reached as a declared fallback — derived from the '
    'sections rather than listed by this battery (' || array_to_string(v_rows, ', ') || ')',
    v_rows, ARRAY['fallback', 'host', 'host_override', 'reviewed_pack']);
  PERFORM pg_temp.s7_jq('R6b and the four states come from four different sections of one '
    'release, so they describe what a document can contain rather than what four fixtures happen '
    'to look like',
    jsonb_build_object('host_override', v_open ->> 'section_key',
                       'reviewed_pack', v_bless ->> 'section_key',
                       'host', v_note ->> 'section_key',
                       'fallback', v_close ->> 'section_key'),
    jsonb_build_object('host_override', '"opening"'::jsonb,
                       'reviewed_pack', '"blessing"'::jsonb,
                       'host', '"event_notes"'::jsonb,
                       'fallback', '"closing"'::jsonb));

  -- The authoring rules themselves must not be echoed into the document that gets frozen.
  PERFORM pg_temp.s7_eq('R7 a resolved section carries exactly the thirteen fields Stage 4 '
    'pinned, so `override_rule` and `requires_venue` stay authoring rules rather than becoming a '
    'second, contradictable claim about who wrote a line',
    pg_temp.s7_all_keys(v_snap -> 'sections' -> 'items'),
    pg_temp.s7_sorted(ARRAY['body_fallback_used', 'body_language', 'body_source', 'body_text',
                            'heading_fallback_used', 'heading_language', 'heading_text',
                            'host_field', 'kind', 'overrode_pack_text', 'position',
                            'required', 'section_key']));

  -- A v1 release takes the identical path: Stage 4's own document battery (428 at this head)
  -- measures that, so this file measures the *shape* difference only, and says which half is
  -- covered where rather than repeating a whole suite.
  PERFORM pg_temp.s7_ok('R8 the resolver has no branch that consults a pack key, a tradition '
    'name, a surname, a community or a location — the only inputs it takes are a definition, a '
    'requested language and the draft, which is what makes the rows above reproducible for any '
    'release anyone authors',
    (SELECT (p.prosrc !~* ('(tamil|malayalam|telugu|kannada|brahmin|community|caste|surname|'
             || 'religion|hindu|muslim|christian|temple|mosque|church|pack_key)'))::boolean
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private' AND p.proname = 'resolve_invitation_sections'));
END $R$;

-- ================================================= I. the issue engine, code by code
-- The records are the product's contract with the editor: a code to branch on, the section and
-- field it is about, whether it blocks, and nothing else. Sentences are a projection over them
-- for the one surface that still speaks in English, which is why Stage 4's exact-wording
-- assertions are the regression cover for this refactor rather than a second rule.
DO $I$
DECLARE v_host uuid; v_wed uuid; v_rel_a uuid; v_doc jsonb; v_rec jsonb; v_keys text[];
        v_msgs text[]; v_snap jsonb; v_bad text[];
BEGIN
  PERFORM pg_temp.s7_is_superuser('I0 the issue group reads live documents as the host and '
    'hand-built ones as the maintenance identity, because those are the two callers');
  SELECT host, wed, rel_a INTO v_host, v_wed, v_rel_a FROM sf;

  -- The complete wedding: one advisory, no refusal. This is §D's other half of "a host override
  -- must never inherit review credit" — the reviewer's credit cannot be claimed for the host's
  -- words, and the host's words are not dropped in silence either.
  v_doc := pg_temp.s7_doc(v_host, v_wed);
  v_rec := v_doc -> 'issues';
  PERFORM pg_temp.s7_jq('I1 a wedding whose required sections are all satisfied reports exactly '
    'one issue, and it is the advisory about the line the host wrote over reviewed wording',
    (SELECT jsonb_agg(jsonb_build_object('code', e -> 'code', 'section', e -> 'section_key',
                                         'field', e -> 'field', 'blocking', e -> 'blocking')
                        ORDER BY e ->> 'code')
       FROM jsonb_array_elements(v_rec) e),
    '[{"code": "host_override_not_permitted", "section": "blessing", "field": "family_introduction", "blocking": false}]'::jsonb);

  PERFORM pg_temp.s7_eq('I2 and the advisory is not in the blocking sentence list, so a notice '
    'about a field that will not land can never become a reason the freeze refuses',
    private.invitation_issue_messages(v_rec), '{}'::text[]);

  PERFORM pg_temp.s7_eq('I3 every record carries exactly the six fields of the contract as its '
    'own keys, so the editor can branch on `code` without parsing anything else',
    (SELECT count(*) FROM jsonb_array_elements(v_rec) e
      WHERE (SELECT pg_temp.s7_sorted(array_agg(k)) FROM jsonb_object_keys(e) k)
            IS DISTINCT FROM pg_temp.s7_issue_record_keys()), 0::bigint);

  -- The one nested depth the contract allows is `params`, and its vocabulary is closed too: a
  -- record whose params block started carrying a sentence, a column name or an id would still
  -- satisfy I3. Asserted as the offenders list rather than as an equality, because a single
  -- advisory legitimately carries only one of the five names.
  PERFORM pg_temp.s7_eq('I3b and nothing appears below the record level except the five values a '
    'host can act on — a language, the coverage list, a contract version, a kind and a count',
    (SELECT coalesce(array_agg(DISTINCT k), '{}'::text[])
       FROM jsonb_array_elements(v_rec) e, jsonb_object_keys(e -> 'params') k
      WHERE k NOT IN ('language', 'covers', 'version', 'kind', 'missing')), '{}'::text[]);

  PERFORM pg_temp.s7_eq('I3b and no record names a schema, a table, a column or a function, so '
    'there is no database interior for the browser to display or translate away',
    (SELECT count(*) FROM jsonb_array_elements(v_rec) e
      WHERE e::text ~* '(internal_api|private\.|public\.|api\.|column|table|function|trigger)'),
    0::bigint);

  -- ------------------------------------------------------------------ the blocking arms
  PERFORM pg_temp.s7_select(v_host, (SELECT wed_nolive FROM sf), v_rel_a);
  v_doc := pg_temp.s7_doc(v_host, (SELECT wed_nolive FROM sf));
  PERFORM pg_temp.s7_jq('I4 a wedding with nothing written yet is refused by the two required '
    'lists the release declares, each named with the kind that is empty, from the document''s own '
    'rows rather than from a table count that could disagree with what a guest would see',
    (SELECT jsonb_agg(jsonb_build_object('code', e -> 'code', 'section', e -> 'section_key',
                                         'kind', e -> 'params' -> 'kind',
                                         'blocking', e -> 'blocking')
                        ORDER BY e ->> 'section_key')
       FROM jsonb_array_elements(v_doc -> 'issues') e),
    '[{"code": "required_list_empty", "section": "ceremonies", "kind": "event_list", "blocking": true}, {"code": "required_list_empty", "section": "family", "kind": "people_list", "blocking": true}]'::jsonb);

  PERFORM pg_temp.s7_eq('I4b and a required prose section filled by the release is NOT reported '
    'as a gap beside them, which is what makes the two above a measurement rather than a refusal '
    'of everything',
    (SELECT count(*) FROM jsonb_array_elements(v_doc -> 'issues') e
      WHERE e ->> 'section_key' IN ('blessing', 'opening', 'closing', 'event_notes')), 0::bigint);

  PERFORM pg_temp.s7_select(v_host, (SELECT wed_novenue FROM sf), v_rel_a);
  v_doc := pg_temp.s7_doc(v_host, (SELECT wed_novenue FROM sf));
  PERFORM pg_temp.s7_jq('I5 the venue rule is answered from the release''s own `requires_venue` '
    'declaration and counts the enabled events with no place, which is exactly what the renderer '
    'decided to draw',
    (SELECT jsonb_agg(jsonb_build_object('code', e -> 'code', 'section', e -> 'section_key',
                                         'missing', e -> 'params' -> 'missing',
                                         'blocking', e -> 'blocking') ORDER BY e ->> 'code')
       FROM jsonb_array_elements(v_doc -> 'issues') e),
    '[{"blocking":true,"code":"event_venue_missing","missing":1,"section":"ceremonies"}]'::jsonb);

  PERFORM pg_temp.s7_select(v_host, (SELECT wed_ml FROM sf), v_rel_a);
  v_doc := pg_temp.s7_doc(v_host, (SELECT wed_ml FROM sf));
  PERFORM pg_temp.s7_eq('I6 a language the release does not cover is named once as the cause, '
    'rather than arriving as one empty-section refusal per required section the host cannot act '
    'on individually',
    (SELECT count(*) FROM jsonb_array_elements(v_doc -> 'issues') e
      WHERE e ->> 'code' = 'language_not_covered'), 1::bigint);
  PERFORM pg_temp.s7_eq('I6b and the two sentences the host is shown are the projection of those '
    'records, in the order Stage 4 pinned, naming the language and the coverage',
    private.invitation_issue_messages(v_doc -> 'issues'),
    ARRAY['section blessing is required and has no wording in ml, and the release does not allow '
          || 'it to fall back',
          'the invitation language ml is not one of the languages this release covers (en, ta)']);

  -- ------------------------------------------------------------- hand-built snapshots only
  v_snap := jsonb_build_object(
    'sections', jsonb_build_object('requested', 'en', 'items', '[]'::jsonb),
    'people', '[]'::jsonb, 'events', '[]'::jsonb, 'draft', '{}'::jsonb,
    'tradition_pack_release', jsonb_build_object(
      'definition_schema_version', 3, 'languages', '["en"]'::jsonb));
  v_rec := private.invitation_issue_records(v_snap, NULL::jsonb);
  PERFORM pg_temp.s7_eq('I7 a contract version this build cannot interpret is reported by name '
    'as a blocking record, which is the behaviour the guard''s "refuse rather than render half of '
    'it" rule asks the checker to share (' || v_rec::text || ')',
    (SELECT count(*) FROM jsonb_array_elements(v_rec) e
      WHERE e ->> 'code' = 'contract_unsupported' AND (e ->> 'blocking')::boolean
        AND e -> 'params' ->> 'version' = '3'), 1::bigint);

  v_snap := jsonb_set(v_snap, '{tradition_pack_release,definition_schema_version}', '"two"');
  v_rec := private.invitation_issue_records(v_snap, NULL::jsonb);
  PERFORM pg_temp.s7_eq('I7b and a definition carrying a version that is not a number at all is '
    'still reported by name rather than crashing the freeze with a cast error — Stage 4 measured '
    'that failure and the CASE that avoids it is re-asserted here',
    (SELECT e -> 'params' ->> 'version' FROM jsonb_array_elements(v_rec) e
      WHERE e ->> 'code' = 'contract_unsupported'), 'two');

  v_snap := jsonb_build_object(
    'sections', jsonb_build_object('requested', 'en', 'items', jsonb_build_array(
      jsonb_build_object('section_key', 'procession', 'position', 1, 'kind', 'venue_list',
                         'required', true))),
    'people', '[]'::jsonb, 'events', '[]'::jsonb, 'draft', '{}'::jsonb,
    'tradition_pack_release', jsonb_build_object(
      'definition_schema_version', 2, 'languages', '["en"]'::jsonb));
  v_rec := private.invitation_issue_records(v_snap, NULL::jsonb);
  PERFORM pg_temp.s7_eq('I8 a kind no renderer knows is blocking on its own, and its own '
    'record, rather than being folded into the position rule beside it',
    (SELECT count(*) FROM jsonb_array_elements(v_rec) e
      WHERE e ->> 'code' = 'kind_unrenderable' AND (e ->> 'blocking')::boolean), 1::bigint);

  v_snap := jsonb_set(v_snap, '{sections,items,0,kind}', '"text"');
  v_snap := jsonb_set(v_snap, '{sections,items,0,position}', '"first"');
  v_rec := private.invitation_issue_records(v_snap, NULL::jsonb);
  PERFORM pg_temp.s7_eq('I8b and a position that is not a number gets its own record for the '
    'same reason Stage 4 gave: reporting an unorderable section as an unknown kind is a reason '
    'nobody can act on',
    (SELECT count(*) FROM jsonb_array_elements(v_rec) e
      WHERE e ->> 'code' = 'position_unorderable' AND (e ->> 'blocking')::boolean), 1::bigint);

  -- The one-argument entry point Stage 4 pinned sees only what a snapshot can show. This is the
  -- contract the migration documents, measured rather than asserted in prose.
  v_bad := private.invitation_freeze_issues(
    private.build_invitation_snapshot((SELECT wed_novenue FROM sf)));
  PERFORM pg_temp.s7_eq('I9 the Stage 4 one-argument entry point does not see the venue rule, '
    'because `requires_venue` is an authoring rule and the snapshot alone cannot carry it — which '
    'is the reason the engine takes a definition as its second argument at all ('
    || array_to_string(v_bad, '; ') || ')',
    cardinality(v_bad), 0);
  PERFORM pg_temp.s7_ok('I9b and the same snapshot, given its release''s definition, does report '
    'the venue gap, so the two-argument form is strictly stronger rather than different',
    cardinality(private.invitation_issue_messages(
      private.invitation_issue_records(
        private.build_invitation_snapshot((SELECT wed_novenue FROM sf)),
        private.wedding_invitation_definition((SELECT wed_novenue FROM sf))))) = 1);

  -- Control for I1: with the host's line removed from that field, the advisory goes away — so
  -- the advisory is a response to what the host wrote, not a fixed property of the release.
  PERFORM pg_temp.s7_write_draft(v_host, v_wed, jsonb_build_object(
    'welcome', 'Written by the host, in the host''s own words.',
    'family_introduction', '   ',
    'event_notes', 'Please arrive by nine.'));
  v_doc := pg_temp.s7_doc(v_host, v_wed);
  PERFORM pg_temp.s7_eq('I10 clearing that field to whitespace removes the advisory, so it is a '
    'report about the host''s words and not a permanent property of the section',
    (v_doc -> 'issues') #>> '{}', '[]');

  PERFORM pg_temp.s7_write_draft(v_host, v_wed, jsonb_build_object(
    'welcome', 'Written by the host, in the host''s own words.',
    'family_introduction', 'The host''s own introduction, which this release will not show.',
    'event_notes', 'Please arrive by nine.'));
  PERFORM pg_temp.s7_eq('I10b and writing the words back brings it again, which rules out the '
    'other explanation for I10 (a stale read)',
    jsonb_array_length(pg_temp.s7_doc(v_host, v_wed) -> 'issues'), 1);
END $I$;

-- ================================================================== F. the freeze
DO $F$
DECLARE v_host uuid; v_wed uuid; v_rel_a uuid; v_res jsonb; v_snap jsonb;
        v_doc jsonb; v_err text; v_off text[]; v_msgs text[];
        v_unknown uuid := '11111111-2222-3333-4444-555555555555'::uuid;
BEGIN
  PERFORM pg_temp.s7_is_superuser('F0 the freeze group calls the host''s own function, as the '
    'host, for every case');
  SELECT host, wed, rel_a INTO v_host, v_wed, v_rel_a FROM sf;

  v_res := pg_temp.s7_freeze(v_host, v_wed);
  PERFORM set_config('s7.v1', (v_res ->> 'version_id'), false);
  PERFORM pg_temp.s7_eq('F1 the complete wedding freezes, at version 1, and the RPC tells the '
    'host which row it made',
    jsonb_build_object('version_number', v_res -> 'version_number',
                       'made', (v_res -> 'version_id') IS NOT NULL),
    jsonb_build_object('version_number', 1, 'made', true));

  v_snap := pg_temp.s7_snapshot((v_res ->> 'version_id')::uuid);
  PERFORM pg_temp.s7_eq('F2 the frozen document is the same six rows the live resolver produced '
    'one statement earlier — the freeze recomputes rather than accepting, and the bytes a guest '
    'will read are the bytes the host was shown',
    pg_temp.s7_rows(v_snap), pg_temp.s7_rows(private.build_invitation_snapshot(v_wed)));

  PERFORM pg_temp.s7_eq('F3 the frozen snapshot records which release it came from, as identity '
    'and authorship facts, so "which release did this guest read?" stays answerable after the '
    'release itself has moved on',
    jsonb_build_object('pack_key', v_snap -> 'tradition_pack_release' -> 'pack_key',
                       'release_number', v_snap -> 'tradition_pack_release' -> 'release_number',
                       'dsv', v_snap -> 'tradition_pack_release' -> 'definition_schema_version'),
    jsonb_build_object('pack_key', '"stage7_resolution"'::jsonb, 'release_number', 1, 'dsv', 2));

  PERFORM pg_temp.s7_eq('F3b and the release block is exactly the eleven facts Stage 4 froze, '
    'which is the pinned surface a new assertion about "what a document preserves" has to be '
    'checked against before anything is added to it',
    pg_temp.s7_all_keys(v_snap -> 'tradition_pack_release'),
    pg_temp.s7_sorted(ARRAY['pack_key', 'display_name', 'scope_statement', 'release_number',
                            'definition_schema_version', 'languages', 'machine_assisted',
                            'author_label', 'review_label', 'reviewed_languages',
                            'source_reference']));

  -- The refusals, each compared with the sentence list the preview was showing at the same
  -- moment. This is the parity claim in its strongest available form: not "both surfaces
  -- complain", but "the freeze's complaint is the projection of the preview's records".
  v_doc := pg_temp.s7_doc(v_host, (SELECT wed_nolive FROM sf));
  v_msgs := private.invitation_issue_messages(v_doc -> 'issues');
  v_err := pg_temp.s7_freeze_err(v_host, (SELECT wed_nolive FROM sf));
  PERFORM pg_temp.s7_eq('F4 a wedding with nothing written yet cannot be frozen, and the reason '
    'the host is given is exactly the sentences its own preview was showing (' || v_err || ')',
    v_err, '23514 this invitation cannot be frozen yet: '
      || array_to_string(v_msgs, '; '));

  v_doc := pg_temp.s7_doc(v_host, (SELECT wed_novenue FROM sf));
  v_err := pg_temp.s7_freeze_err(v_host, (SELECT wed_novenue FROM sf));
  PERFORM pg_temp.s7_ok('F5 a ceremony promised to a place it does not have is refused by the '
    'venue rule the release declared, and the refusal counts the gap rather than describing it '
    'vaguely (' || v_err || ')',
    v_err LIKE '23514%promises a venue for every event and 1 of them has none%');

  v_err := pg_temp.s7_freeze_err(v_host, (SELECT wed_ml FROM sf));
  PERFORM pg_temp.s7_ok('F6 an unsupported language is refused, naming the language, rather than '
    'freezing a document whose required line simply does not exist in it (' || v_err || ')',
    v_err LIKE '23514%invitation language ml is not one of the languages this release covers%');

  v_err := pg_temp.s7_freeze_err(v_host, v_unknown);
  PERFORM pg_temp.s7_ok('F7 a guessed wedding id is refused before anything is resolved, so the '
    'freeze cannot be used to probe which rows exist (' || v_err || ')',
    v_err LIKE '42501%may not create a version of this wedding%');

  -- The general invariant, over every wedding this battery owns, in the direction that can be
  -- tested without writing: a wedding the preview says is blocked must never be freezable. The
  -- other direction — a wedding the preview says is clear really can be frozen — is F1 and F9,
  -- which are the same fact produced deliberately rather than as a side effect of an assertion,
  -- and the CASE below is written that way on purpose so this group cannot mint a version row.
  SELECT coalesce(array_agg(z.q ORDER BY z.q COLLATE "C"), '{}'::text[]) INTO v_off
    FROM (SELECT w.id || ': preview blocks but the freeze accepted it' AS q,
                 CASE WHEN cardinality(private.invitation_issue_messages(
                        (pg_temp.s7_doc(v_host, w.id) -> 'issues'))) > 0
                      THEN pg_temp.s7_freeze_err(v_host, w.id) ELSE 'not attempted' END AS outcome
            FROM public.weddings w
           WHERE w.owner_user_id = v_host) z
   WHERE z.outcome = 'no-error';
  PERFORM pg_temp.s7_eq('F8 no wedding this battery owns can be frozen while its own preview is '
    'reporting a blocking issue — the disagreement §I forbids is not producible through this '
    'schema (' || array_to_string(v_off, ' ;; ') || ')', v_off, '{}'::text[]);

  PERFORM pg_temp.s7_eq('F8b and the freeze RPC takes one argument, the wedding: there is no '
    'parameter through which a client could send a verdict, an issue list or a snapshot, which is '
    'what "the server does not trust a React validation result" looks like as a signature',
    (SELECT p.proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'internal_api' AND p.proname = 'create_invitation_version')::text[],
    ARRAY['p_wedding_id']);

  -- The wedding that chose no pack at all, which has to keep working rather than becoming a
  -- special case the resolver tolerates.
  v_res := pg_temp.s7_freeze(v_host, (SELECT wed_none FROM sf));
  PERFORM pg_temp.s7_eq('F9 a wedding with no tradition pack still freezes, so pack-driven '
    'authoring added a path rather than replacing one',
    (v_res -> 'version_number')::int, 1);
  PERFORM pg_temp.s7_jq('F9b and the preview reports no release standing behind it as an explicit '
    'null rather than as a missing key, so the editor reads "you are writing this yourself" '
    'instead of having to infer a state from an absent field',
    pg_temp.s7_doc(v_host, (SELECT wed_none FROM sf)) -> 'selected_release', 'null'::jsonb);
END $F$;

-- ======================================================= P. preview and freeze, one document
DO $P$
DECLARE v_host uuid; v_wed uuid; v_v1 uuid; v_doc jsonb; v_dto jsonb;
        v_before text; v_res jsonb; v_v2 uuid;
BEGIN
  PERFORM pg_temp.s7_is_superuser('P0 the parity group reads the host''s live preview and the '
    'guest''s projection of the same frozen row');
  SELECT host, wed INTO v_host, v_wed FROM sf;
  v_v1 := current_setting('s7.v1')::uuid;

  -- The requirement in §I's words: the canonical preview document and the canonical frozen guest
  -- document are the same bytes. Everything the host saw before pressing the button is what the
  -- guest gets, or the button lied.
  v_doc := pg_temp.s7_doc(v_host, v_wed);
  v_dto := pg_temp.s7_dto(v_v1);
  PERFORM pg_temp.s7_jq('P1 the document the host previewed and the document a guest reads from '
    'the frozen version are byte-identical, so the preview was a promise rather than an opinion',
    v_doc -> 'invitation', v_dto);

  -- The envelope grew by exactly one member when §19 gave the editor its controls, so this
  -- assertion had to be told the truth rather than relaxed: the fourth block carries *which rules
  -- apply to which section* and no wording at all — which is what D4b measures — so it cannot
  -- arrive as a second answer about a line. The claim P2 was built to keep is that nothing in the
  -- envelope can contradict the document it describes, and four blocks still satisfy that.
  PERFORM pg_temp.s7_eq('P2 the preview document is exactly four things — the invitation, the '
    'server''s verdict on it, what it is standing on, and the authoring rules the editor builds '
    'its controls from — so there is no fifth channel through which a second truth about the same '
    'document could arrive',
    (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
       FROM jsonb_object_keys(v_doc) k),
    ARRAY['authoring', 'invitation', 'issues', 'selected_release']);

  -- A fourth channel is only tolerable if it is a producer with a shape, not a hole. `STABLE`
  -- alone does not stop a browser from calling a `private` helper; the schema it sits in does,
  -- and M6c in the binding battery measures that experience. Named here because an inventory that
  -- reports only a number cannot tell a renamed producer from an absent one.
  PERFORM pg_temp.s7_jq('P2c the fourth channel has one named producer, and it is not a privilege: '
    '`private.invitation_authoring_declaration` runs as the invoker, has a pinned search path, and '
    'is executable by neither browser role',
    (SELECT jsonb_build_object(
              'name', p.proname,
              'invoker', (NOT p.prosecdef)::text,
              'pinned', (p.proconfig @> ARRAY['search_path=""'])::text,
              'anon_exec', has_function_privilege('anon', p.oid, 'EXECUTE')::text,
              'auth_exec', has_function_privilege('authenticated', p.oid, 'EXECUTE')::text)
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private' AND p.proname = 'invitation_authoring_declaration'),
    jsonb_build_object('name', 'invitation_authoring_declaration', 'invoker', 'true',
                       'pinned', 'true', 'anon_exec', 'false', 'auth_exec', 'false'));

  PERFORM pg_temp.s7_ok('P2d and the preview body really is what hands that block over, so the '
    'controls a host sees and the document they describe come out of one call rather than being '
    'assembled from two',
    (SELECT p.prosrc ~ 'private\.invitation_authoring_declaration\('
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'internal_api'
        AND p.proname = 'preview_invitation_document'));

  PERFORM pg_temp.s7_ok('P2e and the body test R8 runs on the resolver runs on this new producer '
    'too — no branch on a language name, a pack key, a community, a faith or a surname appears in '
    'it. A helper added to the document path is exactly the thing a scan written before it exists '
    'misses, so the scan is re-run rather than inherited',
    (SELECT (p.prosrc !~* ('(tamil|malayalam|telugu|kannada|brahmin|community|caste|surname|'
             || 'religion|hindu|muslim|christian|temple|mosque|church|pack_key)'))::boolean
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private'
        AND p.proname = 'invitation_authoring_declaration'));

  PERFORM pg_temp.s7_eq('P2b and the verdict is an array of records even when there is nothing to '
    'say, so the editor never has to guess whether a missing key means "clean" or "not checked"',
    jsonb_typeof(v_doc -> 'issues'), 'array');

  PERFORM pg_temp.s7_jq('P3 and the release the preview names is the release the version pinned, '
    'in the narrow form the editor needs in order to say "this invitation uses an older release" '
    'when it stops being current',
    v_doc -> 'selected_release',
    jsonb_build_object('pack_key', '"stage7_resolution"'::jsonb,
                       'display_name', '"TEST ONLY — Stage 5 resolution pack"'::jsonb,
                       'release_number', 1,
                       'definition_schema_version', 2,
                       'status_is_current', true));

  -- Editing the draft after a freeze must not reach the frozen bytes: the half of the promise a
  -- guest can actually see.
  v_before := md5((pg_temp.s7_snapshot(v_v1))::text);
  PERFORM pg_temp.s7_write_draft(v_host, v_wed, jsonb_build_object(
    'welcome', 'The host rewrote the line after version 1 was frozen.',
    'family_introduction', 'A different introduction, also written afterwards.',
    'event_notes', 'Please arrive by half past eight instead.'));
  PERFORM pg_temp.s7_eq('P4 editing the draft after version 1 was frozen changes version 1 by '
    'nothing at all, byte for byte',
    md5((pg_temp.s7_snapshot(v_v1))::text), v_before);

  v_res := pg_temp.s7_freeze(v_host, v_wed);
  v_v2 := (v_res ->> 'version_id')::uuid;
  PERFORM set_config('s7.v2', v_v2::text, false);
  PERFORM pg_temp.s7_ok('P4b and the new version really does carry the new words, so the '
    'immutability above is a fact about the old row rather than about a freeze that wrote '
    'nothing',
    md5((pg_temp.s7_snapshot(v_v2))::text) <> v_before
    AND (v_res ->> 'version_number')::int = 2);

  PERFORM pg_temp.s7_eq('P4c and the live preview now carries the new words while version 1 still '
    'carries the old ones, which is the difference between "preview what you are writing now" and '
    '"the guest reads what you froze" — both true at once, and neither by accident',
    jsonb_build_object('live', pg_temp.s7_doc(v_host, v_wed) -> 'invitation' ->> 'welcome',
                       'frozen', v_dto ->> 'welcome'),
    jsonb_build_object('live', 'The host rewrote the line after version 1 was frozen.',
                       'frozen', 'Written by the host, in the host''s own words.'));
END $P$;

-- ============================================================= H. a retirement, and what it
-- §L's history case, measured on a document a guest is already reading: release 1 is retired
-- underneath the wedding that chose it, release 2 is approved beside it, and the point of the
-- group is that none of that moves a byte of version 1 while making it impossible to mint a new
-- version from the retired release without the host choosing otherwise.
DO $H$
DECLARE v_host uuid; v_wed uuid; v_rel_a uuid; v_rel_b uuid; v_v1 uuid;
        v_bytes text; v_dbytes text; v_hash text; v_res jsonb; v_v3 uuid; v_err text;
BEGIN
  PERFORM pg_temp.s7_is_superuser('H0 the history group retires through the maintenance surface, '
    'as the maintenance identity, and freezes as the host');
  SELECT host, wed, rel_a, rel_b INTO v_host, v_wed, v_rel_a, v_rel_b FROM sf;
  v_v1 := current_setting('s7.v1')::uuid;
  v_bytes := md5((pg_temp.s7_snapshot(v_v1))::text);
  v_dbytes := md5((pg_temp.s7_dto(v_v1))::text);
  v_hash := (SELECT review_packet_hash FROM public.tradition_pack_releases WHERE id = v_rel_a);

  v_res := internal_api.deprecate_tradition_pack_release(v_rel_a);
  PERFORM pg_temp.s7_jq('H1 an approved release is retired through the maintenance surface, which '
    'reports what it did and how many weddings are still attached to it',
    jsonb_build_object('transition', v_res -> 'transition',
                       'still_selecting', (v_res ->> 'weddings_still_selecting')::int > 0),
    jsonb_build_object('transition', '"approved -> deprecated"'::jsonb, 'still_selecting', true));

  PERFORM pg_temp.s7_eq('H2 the frozen document a guest is reading did not change by one byte, '
    'including the section the retired release had supplied',
    md5((pg_temp.s7_snapshot(v_v1))::text), v_bytes);
  PERFORM pg_temp.s7_eq('H2b and the guest''s projection of it is unchanged either, which is the '
    'half a reader can actually verify — the snapshot is not the thing a guest sees',
    md5((pg_temp.s7_dto(v_v1))::text), v_dbytes);
  PERFORM pg_temp.s7_eq('H2c and the retirement stamped a timestamp rather than rewriting '
    'history: the release now reports a deprecated_at and keeps every other fact it had',
    (SELECT status || '|' || (deprecated_at IS NOT NULL)::text || '|'
            || (approved_at IS NOT NULL)::text || '|' || review_label
       FROM public.tradition_pack_releases WHERE id = v_rel_a),
    'deprecated|true|true|TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW');

  PERFORM pg_temp.s7_eq('H3 and the binding survives its release: the stored digest still equals '
    'the recomputation of the material, so a retired release can still be audited for what its '
    'review covered',
    (SELECT review_packet_hash FROM public.tradition_pack_releases WHERE id = v_rel_a), v_hash);
  PERFORM pg_temp.s7_ok('H3b and recomputing it now produces the same value it always did, which '
    'is the fact an inspector reports as binding_current',
    (SELECT private.tradition_pack_review_hash(
              r.pack_id, r.release_number, r.definition_schema_version, r.languages,
              r.definition, r.author_label, r.machine_assisted, r.machine_assistance_notes,
              r.source_reference, r.changelog)
       FROM public.tradition_pack_releases r WHERE r.id = v_rel_a) = v_hash);

  -- §H's "not auto-migrated": a newer approved release existing beside a wedding does not move
  -- the wedding. The host has to choose.
  PERFORM pg_temp.s7_eq('H4 approving a newer release did not re-point the wedding, so an '
    'invitation a guest is reading never changes underneath its host because the platform shipped '
    'something better',
    (SELECT tradition_pack_release_id FROM public.weddings WHERE id = v_wed), v_rel_a);

  PERFORM pg_temp.s7_eq('H5 and the preview now reports the release as not current, which is the '
    'one fact the editor needs in order to say "this invitation uses an older release" without '
    'showing a customer the maintenance diary behind it',
    pg_temp.s7_doc(v_host, v_wed) -> 'selected_release' -> 'status_is_current', 'false'::jsonb);

  v_err := pg_temp.s7_freeze_err(v_host, v_wed);
  PERFORM pg_temp.s7_ok('H6 a new version cannot be frozen from the retired release the wedding '
    'still points at, while every version already frozen from it stays readable (' || v_err || ')',
    v_err LIKE '42501%may only be frozen from an approved tradition pack release (this one is '
    || 'deprecated)%');

  v_err := pg_temp.s7_select(v_host, (SELECT wed_none FROM sf), v_rel_a);
  PERFORM pg_temp.s7_ok('H7 and the retired release cannot be newly selected by another wedding '
    'either, so retirement really does leave the menu rather than only changing a label',
    v_err LIKE '42501%may only select an approved tradition pack release%');

  v_err := pg_temp.s7_select(v_host, v_wed, v_rel_b);
  PERFORM pg_temp.s7_eq('H8 the host can choose the newer approved release explicitly, which is '
    'the only way the historical state can end (' || v_err || ')', v_err, 'no-error');

  v_res := pg_temp.s7_freeze(v_host, v_wed);
  v_v3 := (v_res ->> 'version_id')::uuid;
  PERFORM pg_temp.s7_eq('H9 freezing after that choice produces a new version pinned to the new '
    'release, and the numbers keep their sequence',
    jsonb_build_object('number', (v_res ->> 'version_number')::int,
                       'pinned', (SELECT tradition_pack_release_id
                                    FROM public.invitation_versions WHERE id = v_v3)),
    jsonb_build_object('number', 3, 'pinned', v_rel_b));

  PERFORM pg_temp.s7_eq('H9b and version 1 is still pinned to release 1, which is the answer to '
    '"which release did this guest read?" for as long as that link exists',
    (SELECT tradition_pack_release_id FROM public.invitation_versions WHERE id = v_v1), v_rel_a);
  PERFORM pg_temp.s7_eq('H9c and its bytes are still the bytes it was frozen with, after a '
    'retirement, a newer approval and a re-selection all happened around it',
    md5((pg_temp.s7_snapshot(v_v1))::text), v_bytes);
END $H$;

-- =========================================== D. the recursive walk over what the browser is handed
DO $D$
DECLARE v_banned text[]; v_guest text[]; v_doc jsonb; v_host uuid; v_wed uuid; v_v1 uuid;
BEGIN
  SELECT host, wed INTO v_host, v_wed FROM sf;
  v_v1 := current_setting('s7.v1')::uuid;
  v_doc := pg_temp.s7_doc(v_host, v_wed);
  v_banned := ARRAY[
    -- the reviewer's own record and the binding, none of which a document consumer may see
    'reviewed_by', 'review_basis', 'review_scope', 'reviewed_at', 'reviewed_languages',
    'review_packet_hash', 'review_label',
    -- how the wording was produced, which is a maintenance fact
    'machine_assistance_notes', 'source_reference', 'changelog', 'author_label',
    -- the definition itself and the governance columns around it
    'definition', 'pack_id', 'release_id', 'status', 'approved_at', 'deprecated_at',
    -- §G's other half: the maintenance surface must not be reachable through a document either
    'review_payload', 'canonical_payload', 'transitions_available', 'binding_current',
    'weddings_selecting', 'versions_frozen', 'customer_selectable'];
  -- The guest document is the narrower surface, so its list is the envelope's plus the two
  -- facts only an editor needs: which contract version a release claims (the editor must be able
  -- to name it to refuse an unreadable one) and the release's identity as a row.
  v_guest := v_banned || ARRAY['definition_schema_version', 'tradition_pack_release_id',
                               'snapshot_schema_version'];

  PERFORM pg_temp.s7_no_forbidden('D1 none of the reviewer record, the binding, the raw '
    'definition or any maintenance counter appears anywhere in the preview document at any depth, '
    'which is the property a deny-list has to be tested against the whole envelope rather than '
    'against the block someone remembered to check',
    v_doc, v_banned);

  PERFORM pg_temp.s7_no_forbidden('D2 and none of it appears in the guest''s projection of the '
    'frozen version either, which is the copy a stranger reads — with the contract version and '
    'the row identity refused there as well, since a guest has no use for either',
    pg_temp.s7_dto(v_v1), v_guest);

  -- The authoring rules stay rules. A frozen document that recorded `override_rule` beside
  -- `body_source` could later disagree with itself about who wrote a line.
  PERFORM pg_temp.s7_no_forbidden('D3 the frozen snapshot carries no authoring rule at any depth, '
    'so what a guest reads reports what happened rather than the instruction that made it happen',
    pg_temp.s7_snapshot(v_v1), ARRAY['override_rule', 'requires_venue']);

  -- D4 is the assertion the authoring block forced into the open. Written when no such block
  -- existed, it said these two words never appear in a preview document; §19 then put them in one
  -- place on purpose, because the editor must not re-implement the contract. Relaxing it to
  -- silence would have thrown the property away, so what is measured now is the narrower claim
  -- that still bites: the words appear in exactly one place, that place holds rules and no
  -- wording, and every other part of the envelope stays as clean as D4 expected.
  PERFORM pg_temp.s7_eq('D4 outside the `authoring` block neither rule word appears anywhere in '
    'the preview document, so the editor has one source for who may touch a line and nothing else '
    'in the envelope to cross-check it against',
    (SELECT pg_temp.s7_sorted(coalesce(array_agg(DISTINCT k), '{}'::text[]))
       FROM unnest(pg_temp.s7_all_keys(v_doc - 'authoring')) u(k)
      WHERE k IN ('override_rule', 'requires_venue')),
    '{}'::text[]);

  PERFORM pg_temp.s7_eq('D4b and every entry of that block carries exactly the seven fields the '
    'declaration is allowed to make — no heading, no reviewed wording, no language map — which is '
    'what keeps it a rule about a section rather than a second copy of the section that could '
    'disagree with the first',
    (SELECT pg_temp.s7_sorted(coalesce(array_agg(DISTINCT k), '{}'::text[]))
       FROM jsonb_array_elements(v_doc -> 'authoring') e,
            LATERAL (SELECT jsonb_object_keys(e) AS k) x),
    pg_temp.s7_sorted(ARRAY['host_field', 'kind', 'override_rule', 'position',
                             'required', 'requires_venue', 'section_key']));

  PERFORM pg_temp.s7_eq('D4c and no entry pairs a rule with a kind that cannot carry it: '
    '`override_rule` is emitted exactly on the text sections and `requires_venue` exactly on the '
    'event list, so a screen reading this block never has to work out which instruction to ignore '
    '(the offender list is the failure message)',
    (SELECT coalesce(array_agg(e ->> 'section_key' ORDER BY (e ->> 'position')::int), '{}'::text[])
       FROM jsonb_array_elements(v_doc -> 'authoring') e
      WHERE (e ->> 'kind') = 'text'
             IS DISTINCT FROM ((e ->> 'override_rule') IS NOT NULL)
         OR (e ->> 'kind') = 'event_list'
             IS DISTINCT FROM ((e ->> 'requires_venue') IS NOT NULL)),
    '{}'::text[]);

  -- The block is the standing release''s own definition, projected in the resolver''s order —
  -- measured line by line rather than counted. Group H has by now moved this wedding onto release
  -- 2, whose only difference from release 1 is one English line of *wording*, so the same literal
  -- is the honest expectation for either, and that is itself the point: choosing the newer release
  -- changes what a guest reads, not what controls the host is offered.
  PERFORM pg_temp.s7_eq('D6 the authoring block declares this release''s six sections, in the '
    'resolver''s own position order, with the seven facts an editor acts on and nothing else',
    (SELECT coalesce(array_agg(
              (e ->> 'position') || '|' || coalesce(e ->> 'section_key', '-') || '|' ||
              coalesce(e ->> 'kind', '-') || '|' || coalesce(e ->> 'required', '-') || '|' ||
              coalesce(e ->> 'host_field', '-') || '|' ||
              coalesce(e ->> 'override_rule', '-') || '|' ||
              coalesce(e ->> 'requires_venue', '-') ORDER BY (e ->> 'position')::int),
              '{}'::text[])
       FROM jsonb_array_elements(v_doc -> 'authoring') e),
    ARRAY['1|opening|text|false|welcome|host_may_replace|-',
          '2|family|people_list|true|-|-|-',
          '3|ceremonies|event_list|true|-|-|true',
          '4|blessing|text|true|family_introduction|pack_only|-',
          '5|event_notes|text|false|event_notes|host_must_supply|-',
          '6|closing|text|false|closing|host_may_replace|-']);

  PERFORM pg_temp.s7_eq('D7 and the wedding that chose no pack is handed the same shaped '
    'declaration out of this build''s own default: every prose line host-writable, nothing marked '
    'required, and the event list still declaring its venue rule — so writing it yourself is a '
    'declared state rather than a screen with the controls switched off',
    (SELECT coalesce(array_agg(
              (e ->> 'position') || '|' || coalesce(e ->> 'section_key', '-') || '|' ||
              coalesce(e ->> 'kind', '-') || '|' || coalesce(e ->> 'required', '-') || '|' ||
              coalesce(e ->> 'host_field', '-') || '|' ||
              coalesce(e ->> 'override_rule', '-') || '|' ||
              coalesce(e ->> 'requires_venue', '-') ORDER BY (e ->> 'position')::int),
              '{}'::text[])
       FROM jsonb_array_elements(
              pg_temp.s7_doc(v_host, (SELECT wed_none FROM sf)) -> 'authoring') e),
    ARRAY['1|welcome|text|false|welcome|host_may_replace|-',
          '2|family_introduction|text|false|family_introduction|host_may_replace|-',
          '3|family|people_list|false|-|-|-',
          '4|ceremonies|event_list|false|-|-|false',
          '5|event_notes|text|false|event_notes|host_may_replace|-',
          '6|closing|text|false|closing|host_may_replace|-']);

  PERFORM pg_temp.s7_no_forbidden('D5 and a frozen version stores the document, not the verdict: '
    'no issue record is written into the snapshot, because a record of what the editor was told '
    'last week is not a fact about what a guest is reading',
    pg_temp.s7_snapshot(v_v1), ARRAY['issues', 'message_key', 'blocking']);
END $D$;

-- ================== C. the cultural-safety closure of the whole document path
-- Stage 4's S7 walks the call closure of the freeze path and its S8 runs a culture-free body test
-- over every body that walk finds. Stage 5 moved the decision: a browser now calls
-- `api.preview_invitation_document` and `api.create_invitation_version`, whose bodies live in
-- `internal_api`, and added two producers — `private.wedding_invitation_definition` and
-- `private.invitation_authoring_declaration` — that no Stage 4 body calls. S7's seeds are all
-- `private` functions, so none of that surface is inside its walk, and P2e can only ever test the
-- single body P2 names. This group is the wider instrument the audit promised (§19.3): the same
-- closure walk, seeded from every body a browser can reach in order to decide a document, plus the
-- release gates that fire from a *trigger* rather than a call, which no call walk can see.
--
-- Why it uses Stage 4's instrument rather than the blunter one R8 and P2e use. Measured on this
-- head before the group was written, the whole-source word test R8 runs is false for four of these
-- seventeen bodies, and for two different reasons, both of which Stage 4's instrument already
-- answers on purpose. Three of them fire on `pack_key` appearing in *code* — as
-- `'pack_key', p.pack_key,`, the line that credits the release a document came from, which is
-- required behaviour and is what S8's own control refuses to confuse with branching on it. The
-- fourth fires on 'tamil' and 'malayalam' appearing in its *comments*, where discussing a tradition
-- in prose is exactly what these bodies are allowed to do. Widening the blunt test would therefore
-- have meant deleting credit lines and comments to make a number appear; widening S8's test costs
-- nothing, measures the same claim the resolver is already held to, and reports the offender.
--
-- R8 and P2e keep their stricter word list untouched: both of the bodies they name genuinely
-- contain none of those words, comments included, so the narrower claim about those two functions
-- stays the narrower claim.
DO $C$
DECLARE v_path text[]; v_front text[]; v_more text[]; v_name text; v_hits text[];
        v_missing bigint;
BEGIN
  -- Two kinds of head: the RPCs a browser executes, and the trigger functions a write to a
  -- document fires. The second kind is not remembered from the migration — C3 measures it out of
  -- `pg_trigger`, so the seed list is checked rather than trusted.
  v_path := ARRAY['api.preview_invitation_document', 'api.create_invitation_version',
                  'internal_api.preview_invitation_document',
                  'internal_api.create_invitation_version',
                  'private.require_approved_pack_release', 'private.require_frozen_pack_release'];
  v_front := v_path;
  WHILE cardinality(v_front) > 0 LOOP
    SELECT pg_temp.s7_sorted(coalesce(array_agg(DISTINCT q.name), '{}'::text[]))
      INTO v_more
      FROM (SELECT p.prosrc AS src
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname || '.' || p.proname = ANY (v_front)) c,
           LATERAL unnest(pg_temp.s7_calls(c.src)) q(name)
     WHERE q.name <> ALL (v_path);
    EXIT WHEN cardinality(v_more) = 0;
    v_path := v_path || v_more;
    v_front := v_more;
  END LOOP;

  PERFORM pg_temp.s7_eq('C1 the document path is these ' || cardinality(v_path) || ' bodies, found '
    'by walking the call closure from every browser-reachable document RPC plus the release '
    'gates rather than from a hand-written list (' || array_to_string(pg_temp.s7_sorted(v_path), ', ') || ')',
    pg_temp.s7_sorted(v_path),
    pg_temp.s7_sorted(ARRAY[
      'api.create_invitation_version', 'api.preview_invitation_document',
      'internal_api.create_invitation_version', 'internal_api.preview_invitation_document',
      'private.build_invitation_snapshot', 'private.default_invitation_definition',
      'private.dto_text', 'private.invitation_authoring_declaration',
      'private.invitation_issue_messages', 'private.invitation_issue_records',
      'private.map_link_or_null', 'private.pack_text_for', 'private.public_invitation_dto',
      'private.require_approved_pack_release', 'private.require_frozen_pack_release',
      'private.resolve_invitation_sections', 'private.wedding_invitation_definition']));

  -- The gap this group exists to close was a `private`-only scan. A scan that quietly stayed
  -- inside `private` would fail this row, which is the difference between a wider instrument and a
  -- wider-sounding one.
  PERFORM pg_temp.s7_eq('C2 and the inventory reaches every schema a document can be decided in, not only the '
    'one the resolver lives in',
    (SELECT pg_temp.s7_sorted(coalesce(array_agg(DISTINCT split_part(x, '.', 1)), '{}'::text[]))
       FROM unnest(v_path) x),
    pg_temp.s7_sorted(ARRAY['api', 'internal_api', 'private']));

  PERFORM pg_temp.s7_eq('C3 and the two gates the walk is seeded with really are the triggers this schema puts on '
    'the release pointer, measured from pg_trigger, so a third gate added on that column shows '
    'up here as a name missing from the closure instead of being scanned by nobody',
    (SELECT pg_temp.s7_sorted(coalesce(array_agg(DISTINCT n.nspname || '.' || p.proname),
                                     '{}'::text[]))
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace rn ON rn.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (t.tgattr::int2[])
       JOIN pg_proc p ON p.oid = t.tgfoid
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE NOT t.tgisinternal
        AND rn.nspname = 'public'
        AND c.relname IN ('weddings', 'invitation_versions')
        AND a.attname = 'tradition_pack_release_id'),
    pg_temp.s7_sorted(ARRAY['private.require_approved_pack_release',
                            'private.require_frozen_pack_release']));

  PERFORM pg_temp.s7_eq('C4 every name in the inventory resolves to a body this run can read, which is what stops '
    'a renamed or moved producer from being reported as a clean scan of one fewer function',
    (SELECT count(*) FROM unnest(v_path) x(k)
      WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname || '.' || p.proname = x.k)),
    0::bigint);

  FOR v_name IN SELECT u.k FROM unnest(pg_temp.s7_sorted(v_path)) u(k) LOOP
    SELECT pg_temp.s7_cultural_hits(p.prosrc) INTO v_hits
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname || '.' || p.proname = v_name;
    PERFORM pg_temp.s7_eq('C5 ' || v_name || ' contains no test on a pack identity, a faith, a community, '
      'a family name or a script-specific layout',
      v_hits, '{}'::text[]);
  END LOOP;

  -- The instrument's own controls, because seventeen clean rows are only a measurement if the same
  -- scan is shown to fire on the thing it claims to refuse. Mirrored from Stage 4's S8b-S8e so the
  -- two batteries are demonstrably holding one contract, not two word lists that can drift apart.
  PERFORM pg_temp.s7_eq('C6 and the scan does catch a planted branch, so the clean rows above are a measurement '
    'and not a mute instrument',
    pg_temp.s7_cultural_hits(
      'IF w.religion = ''hindu'' OR p.pack_key = ''tamil-english'' THEN use_tamil_layout := true;'),
    ARRAY['hindu', 'pack_key compared to a literal', 'religion', 'use_tamil_layout']::text[]);
  PERFORM pg_temp.s7_eq('C7 and it reads a comment as a comment: the same words behind -- do not count, which is '
    'what lets these bodies discuss caste in prose without being scanned for it',
    pg_temp.s7_cultural_hits('SELECT 1; -- if the family is brahmin the temple sends a priest'),
    '{}'::text[]);
  PERFORM pg_temp.s7_eq('C8 and naming the pack a document came from is not treated as branching on it, because a '
    'frozen document has to credit its release',
    pg_temp.s7_cultural_hits(
      'SELECT jsonb_build_object(''pack_key'', p.pack_key, ''release_number'', r.release_number)'),
    '{}'::text[]);
  PERFORM pg_temp.s7_eq('C9 and a word that merely looks like a banned one is not a hit: `section` is not '
    '`sect`, and `community_id` is a column this product does not have',
    pg_temp.s7_cultural_hits('SELECT count(*) FROM sections WHERE community_id = 3 /* contemplate */'),
    '{}'::text[]);
END $C$;

-- ================================================================= T. the ledger
DO $T$
DECLARE v_weds bigint; v_vers bigint; v_packs bigint; v_rels bigint; v_bad bigint;
BEGIN
  SELECT count(*) INTO v_weds FROM public.weddings;
  SELECT count(*) INTO v_vers FROM public.invitation_versions;
  SELECT count(*) INTO v_packs FROM public.tradition_packs;
  SELECT count(*) INTO v_rels  FROM public.tradition_pack_releases;

  PERFORM pg_temp.s7_eq('T1 five weddings added, against the entry count measured at BASE3',
    v_weds - current_setting('s7.base_weds')::bigint, 5::bigint);
  PERFORM pg_temp.s7_eq('T1b four versions frozen — one for the no-pack wedding and three for the '
    'wedding that was frozen, edited and re-frozen after a retirement — and every refusal in '
    'groups F and H wrote none',
    v_vers - current_setting('s7.base_vers')::bigint, 4::bigint);
  PERFORM pg_temp.s7_jq('T1c two packs and five releases, counted over this file''s own pack keys '
    'rather than as an offset into a catalogue it does not own, so the number is the same whoever '
    'ran before it',
    (SELECT jsonb_build_object('packs',
              (SELECT count(*) FROM public.tradition_packs WHERE pack_key LIKE 'stage7\_%'),
              'releases',
              (SELECT count(*) FROM public.tradition_pack_releases r
                 JOIN public.tradition_packs p ON p.id = r.pack_id
                WHERE p.pack_key LIKE 'stage7\_%'))),
    jsonb_build_object('packs', 2, 'releases', 5));

  -- The honesty of the fixtures themselves, which is the property a reader of this catalogue
  -- needs most: nothing left behind here could be mistaken for shipped content, and nothing
  -- claims a human cultural authority.
  PERFORM pg_temp.s7_eq('T2 every release this file left behind sits under a pack whose scope '
    'statement says TEST ONLY, and every one that has left draft carries its binding',
    (SELECT count(*) FROM public.tradition_pack_releases r
       JOIN public.tradition_packs p ON p.id = r.pack_id
      WHERE p.pack_key LIKE 'stage7\_%'
        AND (p.scope_statement NOT LIKE 'TEST ONLY%'
             OR (r.status <> 'draft' AND r.review_packet_hash IS NULL))), 0::bigint);

  PERFORM pg_temp.s7_eq('T2b and no release here records a review basis that claims a human '
    'cultural authority, in either suite''s dialect',
    (SELECT count(*) FROM public.tradition_pack_releases r
      WHERE r.review_basis IS NOT NULL
        AND r.review_basis !~ '(TEST ONLY|qualification only)'), 0::bigint);

  PERFORM pg_temp.s7_eq('T3 the versions this file froze all pin releases of this file''s own '
    'packs, so no earlier suite''s fixture was silently re-frozen by a case above',
    (SELECT count(*) FROM public.invitation_versions v
       JOIN public.tradition_pack_releases r ON r.id = v.tradition_pack_release_id
       JOIN public.tradition_packs p ON p.id = r.pack_id
      WHERE p.pack_key LIKE 'stage7\_%' AND v.wedding_id NOT IN
        (SELECT wed FROM sf UNION ALL SELECT wed_nolive FROM sf
         UNION ALL SELECT wed_novenue FROM sf UNION ALL SELECT wed_ml FROM sf
         UNION ALL SELECT wed_none FROM sf)), 0::bigint);

  -- ---------------------------------------------------------------------- the floor
  -- The number this chain printed, counted from its own PASS lines: BASE 4, PUB 5, S 7, R 10,
  -- I 19, F 13, P 11, H 15, D 9, C 25, T 6 — 124 in all. P grew by three when the preview document
  -- grew an `authoring` block (its producer is now named, its call site and its body are both
  -- measured), and D by four when D4 was re-scoped from "these words never appear" to "these words
  -- appear in one place, and that place carries no wording" — see D4's note. C is the closure group
  -- §19.3 promised: four assertions about the inventory and its seeds, one per body in it, and four
  -- controls on the scan itself. Re-measure and say so whenever an assertion is added or removed; a
  -- floor nobody re-measures stops meaning anything.
  IF (current_setting('s7.passed'))::int < 124 THEN
    RAISE EXCEPTION 'FAIL: only % Stage 5 resolution assertions ran — the measured floor is 124',
      (current_setting('s7.passed'))::int;
  END IF;
END $T$;

SELECT 'STAGE5 DOCUMENT-RESOLUTION TESTS PASSED (' || current_setting('s7.passed') || ')' AS result;
