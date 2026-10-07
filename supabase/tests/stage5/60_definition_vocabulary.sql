-- Stage 5: the version-2 *authoring vocabulary* battery — the two fields the Stage 5 contract
-- adds, measured on the row the guard decides about rather than in prose about the contract.
--
-- Run after `50_review_binding.sql`, as the superuser, in one transaction that commits.
--
-- Why this file exists separately. The review digest is only worth binding if there is a
-- document to bind it to, and Stage 5's document model adds exactly two authoring facts to the
-- version-1 contract: who may replace a section's reviewed wording (`override_rule`) and whether
-- an event list promises a venue for every event it draws (`requires_venue`). Both are claims
-- the guard has to be able to *refuse*, because §A's point is that the browser stops deciding
-- what a pack means. A rule that lives only in a migration comment is not a rule, and a rule
-- tested by accepting one document is not tested either — so every refusal below is measured
-- beside the legal declaration whose mistake it is refusing.
--
--   BASE  the run's identity and the counts this file starts from
--   V     the two new declarations, refused case by case and accepted beside each refusal
--   W     the two optional definition blocks, whose vocabulary did not change
--   L     the version asymmetry, which is the compatibility rule in force rather than in prose
--   C     the same walk reached through the authoring surface rather than through a patch
--   T     the ledger and the floor
--
-- Nothing here reviews anything. The pack is a synthetic shape carrying the words TEST ONLY,
-- `machine_assisted = true` and a scope statement that says out loud it endorses no tradition.
-- Its wording is product-structure placeholder text in English only: no section in this file
-- claims to be ceremonial content, and no assertion measures how a string reads.

SET client_min_messages = notice;
SELECT set_config('s6.passed', '0', false);

-- --------------------------------------------------------------------------- helpers
CREATE FUNCTION pg_temp.s6_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s6.passed',
    (coalesce(nullif(current_setting('s6.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s6_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s6_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s6_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s6_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s6_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

CREATE FUNCTION pg_temp.s6_is_superuser(label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'FAIL % — running as %', label, current_user;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s6_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s6_head() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(current_setting('app.stage_head', true), '(unset)') $fn$;

-- The one instrument this file needs. A rule about a *section* is only proved when the rest of
-- the row is valid, so every case below is issued as a patch of the `definition` field on one
-- draft release that is otherwise accepted — the shape Stage 4's `s4_def_err` established for
-- the same reason. Because the patch goes through the trigger, each case measures the authoring
-- contract as the lifecycle enforces it rather than as a checker would guess it.
CREATE FUNCTION pg_temp.s6_def_err(p_release uuid, p_def jsonb, p_version integer DEFAULT 2)
RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN pg_temp.s6_err('SELECT internal_api.update_draft_tradition_pack_release('
    || quote_literal(p_release::text) || '::uuid, '
    || quote_literal(jsonb_build_object('definition', p_def,
                                        'definition_schema_version', p_version)::text)
    || '::jsonb)');
END $fn$;

-- The smallest accepted version-2 document: one prose section with reviewed wording the host may
-- replace. Every refusal case in group V is this object with exactly one thing wrong, so the
-- case cannot fail for a reason nobody intended.
CREATE FUNCTION pg_temp.s6_base() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT '{"sections":[
    {"section_key":"opening","position":1,"kind":"text","required":false,
     "host_field":"welcome","override_rule":"host_may_replace",
     "heading":{"en":"Opening"},"pack_text":{"en":"TEST ONLY placeholder wording."}}
  ]}'::jsonb $fn$;

-- The base document with one thing merged into its only section, so a case row states the
-- difference it is testing rather than restating a whole document around it.
CREATE FUNCTION pg_temp.s6_section(p_over jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT jsonb_build_object('sections', jsonb_build_array(
           pg_temp.s6_base() -> 'sections' -> 0 || p_over)) $fn$;

-- ------------------------------------------------------------- the run's own identity
DO $BASE$
DECLARE v_packs bigint; v_rels bigint; v_mine bigint;
BEGIN
  PERFORM pg_temp.s6_is_superuser('BASE0 the vocabulary battery is qualified as the '
    'maintenance identity');
  -- "From Stage 5 up", not "exactly Stage 5": the version-2 vocabulary this file measures is a
  -- Stage 5 object and a later chain still contains it, so refusing a later head would turn a
  -- regression signal into an identity check. An undeclared head yields NULL here, and NULL is
  -- distinct from `true`, so this line cannot pass on a missing declaration.
  PERFORM pg_temp.s6_eq('BASE1 and the run declares a head of Stage 5 or later, because a version-2 '
    'authoring vocabulary does not exist at the Stage 4 head — this file would be measuring '
    'nothing there, and saying so is the honest report',
    (SELECT ((substring(pg_temp.s6_head() from '^stage([0-9]+)$'))::int >= 5)), true);

  SELECT count(*) INTO v_packs FROM public.tradition_packs;
  SELECT count(*) INTO v_rels  FROM public.tradition_pack_releases;
  SELECT count(*) INTO v_mine  FROM public.tradition_packs WHERE pack_key LIKE 'stage6\_%';
  PERFORM pg_temp.s6_eq('BASE2 none of this file''s own pack keys is already in the catalogue, '
    'so the numbers it reports belong to it', v_mine, 0::bigint);
  PERFORM set_config('s6.base_packs', v_packs::text, false);
  PERFORM set_config('s6.base_rels',  v_rels::text,  false);
  RAISE NOTICE 'PASS BASE3 the catalogue at entry is measured, not assumed (packs=%, releases=%)',
    v_packs, v_rels;
  PERFORM pg_temp.s6_add(1);
END $BASE$;

-- ------------------------------------------------------------------------- fixtures
CREATE TEMP TABLE sf ON COMMIT DROP AS
SELECT gen_random_uuid() AS pack, gen_random_uuid() AS rel;

INSERT INTO public.tradition_packs (id, pack_key, display_name, scope_statement)
SELECT pack, 'stage6_vocabulary', 'TEST ONLY — Stage 5 authoring-vocabulary pack',
       'TEST ONLY — a synthetic pack shape used to measure which authoring declarations the '
       'guard accepts and which it refuses. It orders sections and offers placeholder wording; '
       'it claims no tradition, reviews no religious text, and is never shipped.' FROM sf;

-- The scratch release every case patches. It is born with the accepted base document, so the
-- first case that fails is failing for the one thing it changed.
INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT rel, pack, 1, 2, ARRAY['en'], pg_temp.s6_base(),
       'TEST ONLY — synthetic authored fixture', true,
       'TEST ONLY — drafted by a model from product structure and checked for shape only. No '
       || 'human reader reviewed any string in this release.',
       'TEST ONLY — no external source', 'Scratch release for the authoring-vocabulary cases'
  FROM sf;

-- ================================================================= V. the two new declarations
-- Each row is (tag, what is wrong, expected SQLSTATE, expected fragment, the definition). A
-- list rather than twelve PERFORMs because the instrument is identical each time and the
-- *expectation* is what a reader has to be able to check — and because a loop that prints one
-- PASS line per case can fail by naming the case, which a single aggregate assertion cannot.
--
-- R07, R13 and R14 are the reason this group is written as cases rather than as prose. Each one
-- is a declaration whose *absence* is the mistake, which is exactly the shape the guard's own
-- NULL trap hides: `jsonb_typeof(col -> 'k') <> 'object'` is NULL when the key is missing, so
-- the clause does not fire and the malformed section or vocabulary entry is accepted. Two of
-- those arms were repaired in the migration while this file was being written, and a case per
-- arm is what keeps the repair from being undone by the next rewrite.
CREATE TEMP TABLE s6_refusals ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('R01', 'an authoring key this build does not have at all', '23514', 'carries unknown keys',
     pg_temp.s6_section(jsonb_build_object('sentiment', 'devotional'))),
  ('R02', 'override_rule spelled as something between the three rules', '23514', 'not one of',
     pg_temp.s6_section(jsonb_build_object('override_rule', 'host_maybe'))),
  ('R03', 'override_rule as a boolean rather than a rule', '23514', 'as one of the three rules',
     pg_temp.s6_section(jsonb_build_object('override_rule', true))),
  ('R04', 'override_rule on a list section, which has no reviewed wording to govern',
     '23514', 'has no reviewed wording',
     jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
       'section_key', 'family', 'position', 1, 'kind', 'people_list', 'required', false,
       'override_rule', 'host_may_replace')))),
  ('R05', 'host_must_supply beside offered wording, which makes two authors of one line',
     '23514', 'offers wording for it anyway',
     pg_temp.s6_section(jsonb_build_object('override_rule', 'host_must_supply'))),
  ('R06', 'host_must_supply with no host field, so nobody could ever supply it',
     '23514', 'reads no host field',
     jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
       'section_key', 'opening', 'position', 1, 'kind', 'text', 'required', true,
       'override_rule', 'host_must_supply',
       'heading', jsonb_build_object('en', 'Opening'))))),
  ('R07', 'pack_only with no reviewed wording to show instead of the host''s',
     '23514', 'carries no reviewed wording',
     jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
       'section_key', 'opening', 'position', 1, 'kind', 'text', 'required', true,
       'override_rule', 'pack_only',
       'heading', jsonb_build_object('en', 'Opening'))))),
  ('R08', 'requires_venue on a prose section, which does not draw events',
     '23514', 'does not draw events',
     pg_temp.s6_section(jsonb_build_object('requires_venue', true))),
  ('R09', 'requires_venue spelled as a string', '23514', 'as a boolean',
     pg_temp.s6_section(jsonb_build_object('requires_venue', 'yes'))),
  ('R10', 'a second section claiming the same position', '23514', 'claimed by two sections',
     jsonb_build_object('sections', jsonb_build_array(
       pg_temp.s6_base() -> 'sections' -> 0,
       jsonb_set(pg_temp.s6_base() -> 'sections' -> 0, '{section_key}', '"welcome"')))),
  ('R11', 'a section slot this build has nowhere to put', '23514', 'not one of the section slots',
     pg_temp.s6_section(jsonb_build_object('section_key', 'procession'))),
  ('R12', 'a kind no renderer knows', '23514', 'claims kind',
     pg_temp.s6_section(jsonb_build_object('kind', 'venue_list'))),
  ('R13', 'an event vocabulary entry with no event key at all', '23514', 'slug event_key',
     jsonb_set(pg_temp.s6_base(), '{event_vocabulary}',
               '[{"labels":{"en":"Event A"}}]'::jsonb)),
  ('R14', 'an event vocabulary entry with no labels at all', '23514', 'slug event_key',
     jsonb_set(pg_temp.s6_base(), '{event_vocabulary}',
               '[{"event_key":"event_a"}]'::jsonb))
) v(tag, what, code, pattern, def);

DO $V$
DECLARE c record; v_rel uuid; v_err text; v_def jsonb;
BEGIN
  PERFORM pg_temp.s6_is_superuser('V0 the declaration group runs as the maintenance identity');
  SELECT rel INTO v_rel FROM sf;

  FOR c IN SELECT * FROM s6_refusals ORDER BY tag COLLATE "C" LOOP
    v_err := pg_temp.s6_def_err(v_rel, c.def);
    PERFORM pg_temp.s6_ok(c.tag || ' ' || c.what || ' is refused, naming the rule, on a row '
      'that is valid in every other column (' || v_err || ')',
      v_err LIKE c.code || ' %' || c.pattern || '%');
  END LOOP;

  -- The refusals above are worth nothing if the guard simply refuses everything, so each legal
  -- declaration is measured on the same row, in the same form.
  v_err := pg_temp.s6_def_err(v_rel, pg_temp.s6_base());
  PERFORM pg_temp.s6_eq('V13 host_may_replace with offered wording and a host field is accepted '
    '— the declaration Stage 4 measured as the only behaviour, so accepting it keeps an old '
    'release meaningable (' || v_err || ')', v_err, 'no-error');

  v_def := jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
    'section_key', 'opening', 'position', 1, 'kind', 'text', 'required', true,
    'override_rule', 'pack_only',
    'heading', jsonb_build_object('en', 'Opening'),
    'pack_text', jsonb_build_object('en', 'TEST ONLY reviewed wording.'))));
  v_err := pg_temp.s6_def_err(v_rel, v_def);
  PERFORM pg_temp.s6_eq('V14 pack_only with reviewed wording is accepted, which is the shape a '
    'release uses when a line is the reviewer''s rather than the host''s (' || v_err || ')',
    v_err, 'no-error');

  v_def := jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
    'section_key', 'opening', 'position', 1, 'kind', 'text', 'required', true,
    'override_rule', 'host_must_supply', 'host_field', 'welcome',
    'heading', jsonb_build_object('en', 'Opening'))));
  v_err := pg_temp.s6_def_err(v_rel, v_def);
  PERFORM pg_temp.s6_eq('V15 host_must_supply with a host field and no offered wording is '
    'accepted: the release declines to author that line and says who must (' || v_err || ')',
    v_err, 'no-error');

  v_def := jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
    'section_key', 'ceremonies', 'position', 1, 'kind', 'event_list', 'required', true,
    'requires_venue', true,
    'heading', jsonb_build_object('en', 'The ceremonies'))));
  v_err := pg_temp.s6_def_err(v_rel, v_def);
  PERFORM pg_temp.s6_eq('V16 requires_venue is accepted on the one kind that draws events, '
    'because that is where a venue can be missing (' || v_err || ')', v_err, 'no-error');

  v_def := jsonb_build_object('sections', jsonb_build_array(
    jsonb_build_object('section_key', 'opening', 'position', 1, 'kind', 'text',
      'required', false, 'host_field', 'welcome', 'override_rule', 'host_may_replace',
      'heading', jsonb_build_object('en', 'Opening'),
      'pack_text', jsonb_build_object('en', 'Wording the host may replace.')),
    jsonb_build_object('section_key', 'blessing', 'position', 2, 'kind', 'text',
      'required', true, 'override_rule', 'pack_only',
      'heading', jsonb_build_object('en', 'Blessing'),
      'pack_text', jsonb_build_object('en', 'Wording that stays reviewed.')),
    jsonb_build_object('section_key', 'event_notes', 'position', 3, 'kind', 'text',
      'required', false, 'override_rule', 'host_must_supply', 'host_field', 'event_notes',
      'heading', jsonb_build_object('en', 'Note'))));
  v_err := pg_temp.s6_def_err(v_rel, v_def);
  PERFORM pg_temp.s6_eq('V17 and a release may declare all three rules at once, which is the '
    'document the resolver and the issue engine are measured against in the next file ('
    || v_err || ')', v_err, 'no-error');

  v_def := jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
    'section_key', 'opening', 'position', 1, 'kind', 'text', 'required', true,
    'override_rule', 'pack_only', 'host_field', 'welcome',
    'heading', jsonb_build_object('en', 'Opening'),
    'pack_text', jsonb_build_object('en', 'Reviewed wording beside a host field.'))));
  v_err := pg_temp.s6_def_err(v_rel, v_def);
  PERFORM pg_temp.s6_eq('V18 a pack_only section that also names a host field is accepted, '
    'because the field is a real place the host''s words go and the document has to be able to '
    'report that they were not used rather than pretend the field does not exist ('
    || v_err || ')', v_err, 'no-error');

  -- Leave the scratch row on the accepted base document, so group W's cases each start from the
  -- one thing they change rather than from whatever the last control wrote.
  PERFORM pg_temp.s6_def_err(v_rel, pg_temp.s6_base());
END $V$;

-- ================================================== W. the definition blocks that did not change
DO $W$
DECLARE v_rel uuid; v_err text;
BEGIN
  PERFORM pg_temp.s6_is_superuser('W0 the definition-block group runs as the maintenance identity');
  SELECT rel INTO v_rel FROM sf;

  v_err := pg_temp.s6_def_err(v_rel,
    jsonb_set(pg_temp.s6_base(), '{event_vocabulary}',
      '[{"event_key":"event_a","labels":{"en":"Event A"},"extra":1}]'::jsonb));
  PERFORM pg_temp.s6_ok('W1 an event_vocabulary entry cannot acquire a key the build does not '
    'read, which is the same rule the sections are held to (' || v_err || ')',
    v_err LIKE '23514%unknown key%');

  v_err := pg_temp.s6_def_err(v_rel,
    jsonb_set(pg_temp.s6_base(), '{event_vocabulary}',
      '[{"event_key":"Event A","labels":{"en":"Event A"}}]'::jsonb));
  PERFORM pg_temp.s6_ok('W2 and an event key has to be a slug, so a label can never be smuggled '
    'in as an identifier (' || v_err || ')', v_err LIKE '23514%slug%');

  v_err := pg_temp.s6_def_err(v_rel,
    jsonb_set(pg_temp.s6_base(), '{event_vocabulary}',
      '[{"event_key":"event_a","labels":{"en":"   "}}]'::jsonb));
  PERFORM pg_temp.s6_ok('W2b and a label has to be a non-empty string, because a blank event '
    'label is a rendering bug no reviewer would ever be shown (' || v_err || ')',
    v_err LIKE '23514%label strings%');

  v_err := pg_temp.s6_def_err(v_rel,
    jsonb_set(pg_temp.s6_base(), '{design_guidance}', '{"lead_size":900}'::jsonb));
  PERFORM pg_temp.s6_ok('W3 design guidance is bounded, so a release cannot ask for type no '
    'guest can read (' || v_err || ')', v_err LIKE '23514%out of range%');

  v_err := pg_temp.s6_def_err(v_rel,
    jsonb_set(pg_temp.s6_base(), '{design_guidance}', '{"motif_reference":"   "}'::jsonb));
  PERFORM pg_temp.s6_ok('W3b and a motif reference has to say something (' || v_err || ')',
    v_err LIKE '23514%out of range%');

  v_err := pg_temp.s6_def_err(v_rel,
    jsonb_set(jsonb_set(pg_temp.s6_base(), '{design_guidance}',
      '{"lead_size":18,"motif_reference":"TEST ONLY — a shape, not a symbol"}'::jsonb),
      '{event_vocabulary}', '[{"event_key":"event_a","labels":{"en":"Event A"}}]'::jsonb));
  PERFORM pg_temp.s6_eq('W4 and the accepted form of both blocks is accepted, which is the '
    'control that keeps the five refusals above from being a refusal of everything ('
    || v_err || ')', v_err, 'no-error');

  v_err := pg_temp.s6_def_err(v_rel, jsonb_set(pg_temp.s6_base(), '{theme}', '"temple-gold"'));
  PERFORM pg_temp.s6_ok('W5 a top-level key the build does not understand is refused by name, so '
    'a release cannot ask for a behaviour this renderer does not have (' || v_err || ')',
    v_err LIKE '23514%does not understand%');

  PERFORM pg_temp.s6_def_err(v_rel, pg_temp.s6_base());
END $W$;

-- ================== L. the version asymmetry, which is the migration rule in force
-- §A's compatibility requirement is not "old documents still work" as a hope; it is the
-- measurable asymmetry that a release claiming version 1 cannot carry version-2 semantics, so an
-- old build and a new build read the same bytes the same way. Both halves are measured on one
-- row, by flipping the declared version rather than by creating a second release that might
-- differ in some unrelated column.
DO $L$
DECLARE v_rel uuid; v_err text; v_v1 jsonb; v_def jsonb;
BEGIN
  PERFORM pg_temp.s6_is_superuser('L0 the version group runs as the maintenance identity');
  SELECT rel INTO v_rel FROM sf;

  v_v1 := jsonb_set(pg_temp.s6_base(), '{sections,0}',
                    (pg_temp.s6_base() -> 'sections' -> 0) - 'override_rule');
  v_err := pg_temp.s6_def_err(v_rel, v_v1, 1);
  PERFORM pg_temp.s6_eq('L1 a version-1 document with the same content apart from the new field '
    'is accepted, which is what "Stage 4 releases keep meaning what they meant" is actually made '
    'of (' || v_err || ')', v_err, 'no-error');

  v_err := pg_temp.s6_def_err(v_rel, pg_temp.s6_base(), 1);
  PERFORM pg_temp.s6_ok('L2 and the same document with override_rule put back is refused *as a '
    'version-1 row*, so a release cannot claim the old contract while depending on the new one ('
    || v_err || ')', v_err LIKE '23514%carries unknown keys%');

  v_def := jsonb_build_object('sections', jsonb_build_array(jsonb_build_object(
    'section_key', 'ceremonies', 'position', 1, 'kind', 'event_list', 'required', true,
    'requires_venue', true,
    'heading', jsonb_build_object('en', 'The ceremonies'))));
  v_err := pg_temp.s6_def_err(v_rel, v_def, 1);
  PERFORM pg_temp.s6_ok('L2b and requires_venue is refused on a version-1 row too, by the same '
    'arm, which is why the resolver never has to guess what an old release meant by it ('
    || v_err || ')', v_err LIKE '23514%carries unknown keys%');

  v_err := pg_temp.s6_def_err(v_rel, pg_temp.s6_base(), 3);
  PERFORM pg_temp.s6_ok('L3 a contract version this build does not understand is refused before '
    'any section is walked, so an unreadable release cannot reach a customer by being '
    'half-parsed (' || v_err || ')', v_err LIKE '23514%not understood by this build%');

  -- Back to the accepted version-2 shape, so the row this file leaves behind is one the guard
  -- reads as valid rather than the last case it rejected.
  v_err := pg_temp.s6_def_err(v_rel, pg_temp.s6_base(), 2);
  PERFORM pg_temp.s6_eq('L3b and the row ends on the accepted version-2 document (' || v_err || ')',
    v_err, 'no-error');
END $L$;

-- ============================ C. the same walk, reached the way an author would reach it
DO $C$
DECLARE v_err text; v_rows bigint;
BEGIN
  PERFORM pg_temp.s6_is_superuser('C0 the authoring-path group runs as the maintenance identity');

  -- A draft patch is one author's edit; `create_tradition_pack_release` is the other entry
  -- point, and the guard is the same — but only the second leaves no row behind when it
  -- refuses, which is worth measuring rather than assuming.
  v_err := pg_temp.s6_err('SELECT internal_api.create_tradition_pack_release('
    || '''stage6_vocabulary'', '
    || quote_literal((pg_temp.s6_section(jsonb_build_object('override_rule', 'host_maybe')))::text)
    || '::jsonb, 2, ''{en}''::text[], ''TEST ONLY — synthetic authored fixture'', true, '
    || '''TEST ONLY — drafted by a model from product structure and checked for shape only. No '
    || 'human reader reviewed any string in this release.'', '
    || '''TEST ONLY — no external source'', ''A release the guard should refuse at birth'')');
  PERFORM pg_temp.s6_ok('C1 authoring a release with an unusable override rule is refused at '
    'birth rather than stored and refused later (' || v_err || ')',
    v_err LIKE '23514%not one of%');

  SELECT count(*) INTO v_rows FROM public.tradition_pack_releases r
    JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE p.pack_key = 'stage6_vocabulary';
  PERFORM pg_temp.s6_eq('C1b and the refusal wrote no row, so the catalogue does not accumulate '
    'definitions nobody can review', v_rows, 1::bigint);

  v_err := pg_temp.s6_err('SELECT internal_api.update_draft_tradition_pack_release('
    || quote_literal(gen_random_uuid()::text) || '::uuid, ''{"changelog": "x"}''::jsonb)');
  PERFORM pg_temp.s6_ok('C2 patching a release that is not in the catalogue is refused by name '
    'rather than answered with an empty result (' || v_err || ')',
    v_err LIKE 'P0001%no release%');

  v_err := pg_temp.s6_err('SELECT internal_api.get_tradition_pack_review_packet('
    || quote_literal(gen_random_uuid()::text) || '::uuid)');
  PERFORM pg_temp.s6_ok('C2b and a review packet for a release that does not exist is refused in '
    'the same form, so a guessed id cannot produce an empty object that reads like a packet ('
    || v_err || ')', v_err LIKE 'P0001%no release%');

  v_err := pg_temp.s6_err('SELECT internal_api.validate_tradition_pack_release('
    || quote_literal(gen_random_uuid()::text) || '::uuid)');
  PERFORM pg_temp.s6_ok('C2c and so is a validation run against a guessed id (' || v_err || ')',
    v_err LIKE 'P0001%no release%');
END $C$;

-- ================================================================= T. the ledger
DO $T$
DECLARE v_packs bigint; v_rels bigint; v_bad bigint;
BEGIN
  SELECT count(*) INTO v_packs FROM public.tradition_packs;
  SELECT count(*) INTO v_rels  FROM public.tradition_pack_releases;
  PERFORM pg_temp.s6_eq('T1 this file added exactly one pack to the catalogue, against the entry '
    'count it measured rather than an absolute',
    v_packs - current_setting('s6.base_packs')::bigint, 1::bigint);
  PERFORM pg_temp.s6_eq('T1b and exactly one release, which is the scratch row every case above '
    'patched — the refusals left nothing behind, which is what C1b showed',
    v_rels - current_setting('s6.base_rels')::bigint, 1::bigint);

  -- The scratch row has been rewritten by every accepted control above, so the file ends by
  -- checking the state it leaves is one the guard still reads as valid.
  SELECT count(*) INTO v_bad FROM public.tradition_pack_releases r
    JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE p.pack_key = 'stage6_vocabulary'
     AND (r.status <> 'draft' OR r.review_packet_hash IS NOT NULL
          OR r.definition_schema_version <> 2
          OR jsonb_typeof(r.definition -> 'sections') <> 'array');
  PERFORM pg_temp.s6_eq('T2 the release this file leaves behind is a version-2 draft with no '
    'binding and a section array, which is the only state an unreviewed fixture may be left in ('
    || v_bad || ' rows are not)', v_bad, 0::bigint);

  PERFORM pg_temp.s6_eq('T3 and nothing this file made is attached to a wedding, so an authoring '
    'vocabulary probe cannot reach a guest',
    (SELECT count(*) FROM public.weddings w
       JOIN public.tradition_pack_releases r ON r.id = w.tradition_pack_release_id
       JOIN public.tradition_packs p ON p.id = r.pack_id
      WHERE p.pack_key = 'stage6_vocabulary'), 0::bigint);

  PERFORM pg_temp.s6_ok('T4 the instruments are still live at the end: the counter exists and '
    'the baseline this file measured is still in the session',
    current_setting('s6.passed') IS NOT NULL
    AND current_setting('s6.base_packs') IS NOT NULL);

  -- ---------------------------------------------------------------------- the floor
  -- The number this chain printed, counted from its own PASS lines: BASE 4, V 21 (one per
  -- refusal case plus one per accepted declaration), W 8, L 6, C 6, T 5 — 50 in all. Re-measure
  -- and say so whenever an assertion is added or removed; a floor nobody re-measures stops
  -- meaning anything. The fourteen refusal cases are one per rule the version-2 contract adds or
  -- carries forward, which is the only form in which "the guard validates the new fields" is a
  -- fact rather than an intention.
  IF (current_setting('s6.passed'))::int < 50 THEN
    RAISE EXCEPTION 'FAIL: only % Stage 5 authoring-vocabulary assertions ran — the measured '
      'floor is 50', (current_setting('s6.passed'))::int;
  END IF;
END $T$;

SELECT 'STAGE5 AUTHORING-VOCABULARY TESTS PASSED (' || current_setting('s6.passed') || ')'
  AS result;
