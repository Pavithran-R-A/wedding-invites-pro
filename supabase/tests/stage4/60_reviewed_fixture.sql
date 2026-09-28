-- Stage 4 §8: TEST-ONLY fixture tooling — one synthetic pack taken through the whole
-- governed lifecycle, and then rolled back so nothing of it survives the run.
--
-- This file is not an assertion battery. `50_pack_release.sql` qualifies the lifecycle; this
-- file *performs* it, because §8 asks for tooling that can be re-run wherever a later suite
-- needs a reviewed-and-approved release to exist: create pack → draft release → populate a
-- valid definition → mark reviewed with complete metadata → approve → select → freeze →
-- deprecate. Every step runs through the identity that owns it — `service_role` for content,
-- `authenticated` for the host's selection and freeze — rather than as the superuser, so what
-- is exercised is the sequence a real release goes through, not a privileged shortcut.
--
-- Why it manages its own transaction instead of running under `--single-transaction`: a
-- release that has reached `approved` cannot be deleted (guard trigger; ruling A2's "once it
-- leaves draft it is a review unit"), so §8's "ensure final cleanup removes/rolls it back"
-- has exactly one honest mechanism left — ROLLBACK. The refusals below are what makes that
-- sentence a measurement: the fixture attempts the DELETE, is refused, and is then erased by
-- the rollback no DELETE could have done. The Stage 4 runner therefore executes this file
-- *without* `--single-transaction`, and the queries after the ROLLBACK prove the erasure by
-- comparing the catalogue against the entry counts remembered before it began.
--
-- Nothing here is a review. The four strings below are the ones §8 mandates, and they say out
-- loud that no human cultural authority was involved:
--
--   pack_key        test_reviewed_fixture   (see the one deviation, recorded immediately below)
--   display name    TEST ONLY — Synthetic Reviewed Fixture
--   reviewer label  TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW
--   qualification   Automated Stage 4 database qualification only
--
-- §8 spells the pack key `test-reviewed-fixture`, with hyphens. The migration this stage
-- published constrains `pack_key` to a snake_case slug —
-- `tradition_packs_pack_key_slug CHECK (pack_key ~ '^[a-z][a-z0-9]*(_[a-z0-9]*)*$')` — and that
-- rule is what §7's source-controlled candidate (`tamil_english_foundation`) and every key in
-- `50_pack_release.sql` are written against. Two ways out existed. Loosening a published,
-- already-asserted CHECK to fit a fixture's spelling is weakening a gate, so the fixture uses
-- the underscore form of the same name and step 0 *measures* the collision: it attempts the
-- hyphenated spelling, shows it is refused, shows it is refused by that constraint and no other,
-- and shows it left no row. The deviation is therefore evidence in the run, not a footnote.
--
-- The Tamil is fixture text, present so a two-language release has two languages to resolve.
-- No assertion in this file measures how a string is spelled, and none of them should be read
-- as a native speaker's approval of one.

\set ON_ERROR_STOP on

SET client_min_messages = notice;
SELECT set_config('s4fx.passed', '0', false);

-- The same three instruments every other suite here uses: an assertion that cannot be
-- counted can be quietly deleted, and a refusal that reports 'no-error' would let this file
-- claim the lifecycle worked when all it proved was that nothing was checked.
CREATE FUNCTION pg_temp.f_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM set_config('s4fx.passed',
    (coalesce(nullif(current_setting('s4fx.passed', true), ''), '0')::int + 1)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.f_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM set_config('s4fx.passed',
    (coalesce(nullif(current_setting('s4fx.passed', true), ''), '0')::int + 1)::text, false);
END $fn$;

-- SQLSTATE || message, or 'no-error'. SECURITY INVOKER, so what it reports belongs to the role
-- the session is holding when the statement runs — which is why each step below sets its own
-- role, and why the statements it is given name only `public.*` and literals.
CREATE FUNCTION pg_temp.f_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

-- ------------------------------------------------------------------ the fixture's identifiers
-- Carried in session settings rather than a temp table on purpose: a temp table belongs to
-- the user who made it, so once this file switches to `authenticated` or `service_role` it
-- could no longer read one — and a tool that has to stop switching roles to see its own rows
-- would be a tool that quietly tests the superuser path.
--
-- The rule that governs them, measured rather than assumed (the first run of this file found
-- it the hard way, by printing a total of 8 for a fixture that made 43 assertions):
-- `set_config(name, value, false)` is a *session* setting, but a session setting written inside
-- a transaction is reverted when that transaction rolls back. So a setting only carries across
-- this file's ROLLBACK if it was written *before* the BEGIN — which is why every identifier
-- below is captured before the transaction opens, and why the running assertion total, which is
-- written inside it, cannot be: that number leaves the transaction through psql `\gset` at the
-- end of the file, because the client is the only thing here that spans the boundary.
CREATE TEMP TABLE fx_init AS
SELECT gen_random_uuid() AS pack,  gen_random_uuid() AS rel,
       gen_random_uuid() AS rel_bad, gen_random_uuid() AS host,
       gen_random_uuid() AS maintainer, gen_random_uuid() AS wed,
       gen_random_uuid() AS venue, gen_random_uuid() AS evt;

SELECT set_config('s4fx.pack',      (SELECT pack::text FROM fx_init), false);
SELECT set_config('s4fx.rel',       (SELECT rel::text FROM fx_init), false);
SELECT set_config('s4fx.rel_bad',   (SELECT rel_bad::text FROM fx_init), false);
SELECT set_config('s4fx.host',      (SELECT host::text FROM fx_init), false);
SELECT set_config('s4fx.maintainer',(SELECT maintainer::text FROM fx_init), false);
SELECT set_config('s4fx.wed',       (SELECT wed::text FROM fx_init), false);
SELECT set_config('s4fx.venue',     (SELECT venue::text FROM fx_init), false);
SELECT set_config('s4fx.evt',       (SELECT evt::text FROM fx_init), false);
DROP TABLE fx_init;

-- --------------------------------------------------------- the fixture's own honesty, first
DO $HEAD$
DECLARE v_packs bigint; v_rels bigint;
BEGIN
  PERFORM pg_temp.f_ok('H1 the migration history ships no such pack: no key matching '
    || '''test…fixture'' exists before this file runs, under either spelling',
    NOT EXISTS (SELECT 1 FROM public.tradition_packs p
                 WHERE p.pack_key LIKE 'test%fixture'));
  PERFORM pg_temp.f_ok('H1b and no release anywhere carries the fixture reviewer label yet, '
    || 'so §8''s identity cannot be mistaken for a real review record',
    NOT EXISTS (SELECT 1 FROM public.tradition_pack_releases r
                 WHERE r.review_label = 'TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW'));
  -- The catalogue as it stands, remembered rather than assumed. §8's cleanup is a rollback,
  -- and the only honest way to show that a rollback restored the catalogue is to have
  -- measured it first: the after-the-fact assertions below are then a comparison, not a
  -- silence, and they hold whether or not earlier suites left rows behind.
  SELECT count(*) INTO v_packs FROM public.tradition_packs;
  SELECT count(*) INTO v_rels FROM public.tradition_pack_releases;
  PERFORM set_config('s4fx.before_packs', v_packs::text, false);
  PERFORM set_config('s4fx.before_rels', v_rels::text, false);
  RAISE NOTICE 'PASS H2 the catalogue at entry is measured, not assumed (packs=%, releases=%)',
    v_packs, v_rels;
  PERFORM set_config('s4fx.passed',
    (coalesce(nullif(current_setting('s4fx.passed', true), ''), '0')::int + 1)::text, false);
END $HEAD$;

BEGIN;

-- The two accounts the fixture needs: a host, and the maintenance account credited as the
-- reviewer. Both live under the reserved `.example.test` domain, and both vanish below.
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT current_setting('s4fx.host')::uuid, 'stage4-fixture-host@example.test',
       jsonb_build_object('name', 'Fixture host')
UNION ALL
SELECT current_setting('s4fx.maintainer')::uuid, 'stage4-fixture-maintainer@example.test',
       jsonb_build_object('name', 'Fixture maintenance account');

-- -------------------------------------------------------------- step 1 — create the pack
-- Written as `service_role`, the content-maintenance identity the migration leaves its write
-- path to. A customer's JWT has no INSERT on either table, which group A of
-- `50_pack_release.sql` qualifies; what matters here is that the fixture's birth is a
-- maintenance act and not a superuser convenience.
SET ROLE service_role;

-- ------------------------------------------------- step 0 — the one §8 string the schema refuses
-- See the header: §8's hyphenated pack_key cannot be born, and this file proves that rather
-- than quietly pretending the two spellings are interchangeable. The refusal must name
-- `tradition_packs_pack_key_slug` specifically; a rejection by some other rule would mean the
-- slug was fine and something else was broken, which is a different fact worth not confusing.
DO $S0$
DECLARE v_r text;
BEGIN
  v_r := pg_temp.f_err($ins$
    INSERT INTO public.tradition_packs (id, pack_key, display_name, scope_statement)
    VALUES (gen_random_uuid(), 'test-reviewed-fixture',
            'CONTROL — must never exist',
            'Control row that attempts §8''s hyphenated pack_key spelling; it must be refused '
            'and must leave nothing behind.')$ins$);
  PERFORM pg_temp.f_ok('0 §8''s hyphenated key spelling is refused outright: '
    || left(v_r, 120), v_r LIKE '23514%');
  PERFORM pg_temp.f_ok('0b and it is refused by the published slug CHECK, not by a length, '
    || 'unique or not-null rule that happened to be nearer',
    v_r LIKE '%tradition_packs_pack_key_slug%');
  PERFORM pg_temp.f_ok('0c and the refused attempt left no pack of either spelling',
    NOT EXISTS (SELECT 1 FROM public.tradition_packs p
                 WHERE p.pack_key LIKE 'test%fixture'));
END $S0$;

INSERT INTO public.tradition_packs (id, pack_key, display_name, scope_statement)
SELECT current_setting('s4fx.pack')::uuid,
       'test_reviewed_fixture',
       'TEST ONLY — Synthetic Reviewed Fixture',
       'TEST ONLY — a synthetic pack written by the Stage 4 qualification tooling. It orders '
       'sections and offers placeholder wording; it claims no tradition, endorses no '
       'community, and is never shipped.';

RESET ROLE;

DO $S1$
BEGIN
  PERFORM pg_temp.f_eq('1 the pack is stored under the underscore form of §8''s mandated key, '
    || 'which is the same name read through the published slug rule',
    (SELECT p.pack_key FROM public.tradition_packs p
      WHERE p.id = current_setting('s4fx.pack')::uuid),
    'test_reviewed_fixture');
  PERFORM pg_temp.f_eq('1b §8''s display name is stored exactly, TEST ONLY first',
    (SELECT p.display_name FROM public.tradition_packs p
      WHERE p.id = current_setting('s4fx.pack')::uuid),
    'TEST ONLY — Synthetic Reviewed Fixture');
  PERFORM pg_temp.f_ok('1c and its scope statement says out loud that it endorses nothing',
    (SELECT position('endorses no' in p.scope_statement) > 0
       FROM public.tradition_packs p WHERE p.id = current_setting('s4fx.pack')::uuid));
END $S1$;

-- ------------------------------------------ step 2 — a draft release carrying a valid definition
-- Born `draft`: the guard refuses any other birth state, and `draft_carries_no_review_metadata`
-- refuses review facts on a draft row — so a fixture that could not be built this way would
-- not be a fixture, and a fixture that reached `approved` here would already be a lie.
INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT current_setting('s4fx.rel')::uuid, current_setting('s4fx.pack')::uuid, 1, 1,
  ARRAY['en', 'ta'], $def${
  "sections": [
    {"section_key": "opening", "position": 1, "kind": "text", "required": true,
     "host_field": "welcome", "allow_english_fallback": true,
     "heading": {"en": "Opening", "ta": "தொடக்கம்"},
     "pack_text": {"en": "With the goodwill of both families.", "ta": "வணக்கம்"}},
    {"section_key": "family", "position": 2, "kind": "people_list", "required": true,
     "heading": {"en": "Our families", "ta": "குடும்பம்"}},
    {"section_key": "ceremonies", "position": 3, "kind": "event_list", "required": true,
     "heading": {"en": "The ceremonies", "ta": "நிகழ்ச்சிகள்"}}
  ],
  "event_vocabulary": [
    {"event_key": "muhurtham", "labels": {"en": "Muhurtham", "ta": "முஹூர்தம்"}}
  ]
}$def$::jsonb,
  'TEST ONLY — synthetic fixture release', true,
  'TEST ONLY — drafted by a model from the Stage 4 section vocabulary and checked for shape '
  'and language coverage. No human reader of Tamil reviewed any string in this release.',
  'TEST ONLY — no external source',
  'Fixture release 1 of the Stage 4 lifecycle tooling';

-- The definition's hash, and the bookkeeping timestamp, remembered so the review and approval
-- steps below can show that they moved no content byte. `updated_at` is kept for the opposite
-- reason: inside one transaction it cannot move (3h–3j measure what that means), and a reader
-- who expects a clock difference here would be reading the wrong instrument.
SELECT set_config('s4fx.def_hash',
       (SELECT md5(r.definition::text) FROM public.tradition_pack_releases r
          WHERE r.id = current_setting('s4fx.rel')::uuid), false);
SELECT set_config('s4fx.updated_before_review',
       (SELECT r.updated_at::text FROM public.tradition_pack_releases r
          WHERE r.id = current_setting('s4fx.rel')::uuid), false);

DO $S2$
DECLARE v_msg text;
BEGIN
  PERFORM pg_temp.f_eq('2 the release is born as a draft, the only birth state the guard '
    || 'accepts',
    (SELECT r.status FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid), 'draft');
  PERFORM pg_temp.f_eq('2b and it carries no review metadata at all, because §8''s review has '
    || 'not happened yet',
    (SELECT count(*) FROM (
        SELECT unnest(ARRAY[r.review_label, r.review_basis, r.review_scope,
                            r.reviewed_at::text, r.reviewed_by::text]) AS x
          FROM public.tradition_pack_releases r
         WHERE r.id = current_setting('s4fx.rel')::uuid) v
      WHERE v.x IS NOT NULL), 0::bigint);
  PERFORM pg_temp.f_eq('2c the definition is the three-section document it was written as',
    (SELECT jsonb_array_length(r.definition -> 'sections')::bigint
       FROM public.tradition_pack_releases r WHERE r.id = current_setting('s4fx.rel')::uuid),
    3::bigint);
  PERFORM pg_temp.f_ok('2d and the machine assistance is disclosed from the first moment of '
    || 'its life, not added at approval',
    (SELECT r.machine_assisted AND length(btrim(r.machine_assistance_notes)) >= 20
       FROM public.tradition_pack_releases r WHERE r.id = current_setting('s4fx.rel')::uuid));

  -- Positive control in §1's sense: the fixture's birth is shown to be a rule rather than a
  -- habit. A release created already `approved` is refused by name, and the attempt leaves no
  -- row.
  v_msg := pg_temp.f_err(
    'INSERT INTO public.tradition_pack_releases (id, pack_id, release_number, '
    || 'definition_schema_version, languages, definition, author_label, status) VALUES ('
    || quote_literal(current_setting('s4fx.rel_bad')) || ', '
    || quote_literal(current_setting('s4fx.pack'))
    || ', 901, 1, ARRAY[''en''], ''{"sections": []}''::jsonb, '
    || quote_literal('TEST ONLY — born-approved control') || ', ''approved'')');
  PERFORM pg_temp.f_ok('2e control: a release cannot skip its birth — the guard refuses one '
    || 'created already approved (' || left(v_msg, 90) || ')',
    v_msg LIKE '%begins life as draft%');
  PERFORM pg_temp.f_eq('2f and the refused insert left no row behind',
    (SELECT count(*) FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel_bad')::uuid), 0::bigint);
END $S2$;

-- ------------------------------------ step 3 — mark it reviewed, with §8's complete metadata
-- One statement, because `review_metadata_is_mandatory` is a CHECK on the row: a review that
-- says *when* but not *who, on what scope, over which languages* is not a complete record and
-- must not land. The maintenance account is credited through `reviewed_by`, which is why the
-- account above exists — and §12 keeps that account out of any guest-facing projection.
SET ROLE service_role;

UPDATE public.tradition_pack_releases r
   SET status = 'reviewed',
       review_label = 'TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW',
       review_basis = 'Automated Stage 4 database qualification only. No human cultural '
                      'authority, no religious standing and no native-speaker language '
                      'competence is claimed by, or behind, this record.',
       review_scope = 'TEST ONLY — section order, section kinds and language coverage were '
                      'read. No ritual, community or religious content was reviewed, because '
                      'none is present in this release.',
       reviewed_languages = ARRAY['en', 'ta'],
       reviewed_by = current_setting('s4fx.maintainer')::uuid,
       reviewed_at = now()
 WHERE r.id = current_setting('s4fx.rel')::uuid;

RESET ROLE;

-- The review record as it stood at this step, remembered so approval can be shown not to
-- have restated it.
SELECT set_config('s4fx.review_tuple',
       (SELECT md5(concat_ws('|', r.review_label, r.review_basis, r.review_scope,
                             r.reviewed_languages, r.reviewed_at, r.reviewed_by))
          FROM public.tradition_pack_releases r
         WHERE r.id = current_setting('s4fx.rel')::uuid), false);

DO $S3$
DECLARE v_msg text;
BEGIN
  PERFORM pg_temp.f_eq('3 the release is now reviewed',
    (SELECT r.status FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid), 'reviewed');
  PERFORM pg_temp.f_eq('3b §8''s reviewer label is stored exactly, and says for itself that it '
    || 'is not a real cultural review',
    (SELECT r.review_label FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid),
    'TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW');
  PERFORM pg_temp.f_eq('3c §8''s qualification opens the basis field, so the record cannot be '
    || 'read as a person''s standing',
    (SELECT left(r.review_basis, 45) FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid),
    'Automated Stage 4 database qualification only');
  PERFORM pg_temp.f_ok('3d and the scope says what was read, which is structure, and what was '
    || 'not, which is everything a person believes',
    (SELECT position('section order' in r.review_scope) > 0
        AND position('No ritual' in r.review_scope) > 0
       FROM public.tradition_pack_releases r WHERE r.id = current_setting('s4fx.rel')::uuid));
  PERFORM pg_temp.f_eq('3e the review covers exactly the languages the release claims',
    (SELECT r.reviewed_languages FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid),
    ARRAY['en', 'ta']::text[]);
  PERFORM pg_temp.f_ok('3f and it names a maintenance account and a moment, so "reviewed" is a '
    || 'record rather than a mood',
    (SELECT r.reviewed_by IS NOT NULL AND r.reviewed_at IS NOT NULL
       FROM public.tradition_pack_releases r WHERE r.id = current_setting('s4fx.rel')::uuid));
  PERFORM pg_temp.f_eq('3g marking it reviewed moved no byte of the definition — §1''s rule '
    || 'that a lifecycle step is not a content edit',
    (SELECT md5(r.definition::text) FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid),
    current_setting('s4fx.def_hash'));
  -- §1's other sentence, in the only form this environment can measure. The battery found the
  -- shape of this problem first (`50_pack_release.sql` LC7b): this file runs inside one
  -- transaction, `now()` *is* the transaction timestamp, and so the touch trigger rewrites
  -- `updated_at` with the same instant on every step. A clock difference is therefore not
  -- evidence available here, and asserting one would be asserting what the fixture cannot show.
  -- What is available, and what the guard's rule actually turns on, is that the column belongs
  -- to the mechanism and is deliberately absent from the frozen tuple — so a step that names it
  -- is still not content editing, and a caller's value for it does not survive the write.
  PERFORM pg_temp.f_eq('3h and the touch trigger owns the bookkeeping column, writing the one '
    || 'instant this whole transaction shares',
    (SELECT r.updated_at FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid),
    current_setting('s4fx.updated_before_review')::timestamptz);
  v_msg := pg_temp.f_err('UPDATE public.tradition_pack_releases r SET status = status, '
    || 'updated_at = ''2020-01-01T00:00:00+00''::timestamptz WHERE r.id = '
    || quote_literal(current_setting('s4fx.rel')));
  PERFORM pg_temp.f_eq('3i control: a legal step that also names that automatic column is not '
    || 'read as a content edit (' || left(v_msg, 70) || ')', v_msg, 'no-error');
  PERFORM pg_temp.f_ok('3j and the mechanism overwrote the caller''s timestamp anyway, which is '
    || 'precisely why it cannot be part of the frozen tuple',
    (SELECT r.updated_at = now()
            AND r.updated_at <> '2020-01-01T00:00:00+00'::timestamptz
       FROM public.tradition_pack_releases r WHERE r.id = current_setting('s4fx.rel')::uuid));
  PERFORM pg_temp.f_eq('3k and through all of that the definition is still the drafted bytes',
    (SELECT md5(r.definition::text) FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid),
    current_setting('s4fx.def_hash'));
END $S3$;

-- ------------------------------------------------------------------ step 4 — approve it
SET ROLE service_role;

UPDATE public.tradition_pack_releases r
   SET status = 'approved', approved_at = now()
 WHERE r.id = current_setting('s4fx.rel')::uuid;

RESET ROLE;

DO $S4$
DECLARE v_msg text; v_rows bigint;
BEGIN
  PERFORM pg_temp.f_eq('4 the release is approved, which is the only state a customer may '
    || 'select',
    (SELECT r.status FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid), 'approved');
  PERFORM pg_temp.f_ok('4b and approval stamped its own moment without inventing a review',
    (SELECT r.approved_at IS NOT NULL FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid));
  PERFORM pg_temp.f_eq('4c the review record one step back is untouched, which is what makes '
    || 'this the release that was reviewed',
    (SELECT md5(concat_ws('|', r.review_label, r.review_basis, r.review_scope,
                          r.reviewed_languages, r.reviewed_at, r.reviewed_by))
       FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid),
    current_setting('s4fx.review_tuple'));

  -- The immutability §8's cleanup argument depends on, measured rather than assumed: an
  -- approved release cannot be edited, cannot walk backwards, and cannot be deleted.
  v_msg := pg_temp.f_err('UPDATE public.tradition_pack_releases r SET changelog = '
    || quote_literal('TEST ONLY — an edit after approval') || ' WHERE r.id = '
    || quote_literal(current_setting('s4fx.rel')));
  PERFORM pg_temp.f_ok('4d control: editing an approved release is refused by name ('
    || left(v_msg, 90) || ')', v_msg LIKE '%content is frozen%');
  v_msg := pg_temp.f_err('UPDATE public.tradition_pack_releases r SET status = '
    || quote_literal('reviewed') || ' WHERE r.id = '
    || quote_literal(current_setting('s4fx.rel')));
  PERFORM pg_temp.f_ok('4e control: a step backwards is refused by name, so an approval cannot '
    || 'be un-decided (' || left(v_msg, 90) || ')',
    v_msg LIKE '%cannot move from approved to reviewed%');
  v_msg := pg_temp.f_err('DELETE FROM public.tradition_pack_releases r WHERE r.id = '
    || quote_literal(current_setting('s4fx.rel')));
  PERFORM pg_temp.f_ok('4f control: the approved fixture cannot be deleted, which is why this '
    || 'file ends in a ROLLBACK and not a cleanup statement (' || left(v_msg, 90) || ')',
    v_msg LIKE '%may not be deleted%');
  SELECT count(*) INTO v_rows FROM public.tradition_pack_releases r
    WHERE r.pack_id = current_setting('s4fx.pack')::uuid;
  PERFORM pg_temp.f_eq('4g and the three refusals changed nothing: the pack still holds one '
    || 'release, still approved',
    ARRAY[v_rows::text,
          (SELECT r.status FROM public.tradition_pack_releases r
            WHERE r.id = current_setting('s4fx.rel')::uuid)],
    ARRAY['1', 'approved']);
END $S4$;

-- ------------------------------------------------ step 5 — the host selects it, as a customer
-- The wedding and its content exist first, then the selection goes through the same
-- single-column UPDATE the browser sends, under `authenticated`. §9's rule — the customer
-- writes their own selection field and never the release row — is exercised here rather than
-- restated.
INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages,
                             style_settings)
SELECT current_setting('s4fx.wed')::uuid, current_setting('s4fx.host')::uuid,
       'Fixture weds Nobody', 'ta', ARRAY['en'],
       '{"font":"Mukta Malar","fontSize":"20","color":"#7A1F1F","alignment":"left"}';

INSERT INTO public.wedding_people (wedding_id, display_name, role_key, role_label,
                                   group_key, group_label, display_order)
SELECT current_setting('s4fx.wed')::uuid, 'Fixture Parent', 'father', 'Father',
       'bride-side', 'The families of', 0;

INSERT INTO public.venues (id, wedding_id, name, address_text)
SELECT current_setting('s4fx.venue')::uuid, current_setting('s4fx.wed')::uuid,
       'Fixture Hall', '1 Example Road, Anywhere';

INSERT INTO public.wedding_events (id, wedding_id, event_key, display_name, venue_id,
                                   starts_at_local, timezone, display_order, enabled)
SELECT current_setting('s4fx.evt')::uuid, current_setting('s4fx.wed')::uuid, 'muhurtham',
       'Muhurtham', current_setting('s4fx.venue')::uuid, '2027-02-14 09:30', 'Asia/Kolkata',
       0, true;

SET ROLE authenticated;
SELECT set_config('test.uid', current_setting('s4fx.host'), false);
SELECT set_config('s4fx.select_msg', pg_temp.f_err(
         'UPDATE public.weddings w SET tradition_pack_release_id = '
         || quote_literal(current_setting('s4fx.rel')) || ' WHERE w.id = '
         || quote_literal(current_setting('s4fx.wed'))), false);
-- §9's other half, probed while the session still holds the customer's role. This placement is
-- the whole assertion: run after `RESET ROLE` the same statement would be a superuser editing a
-- table no policy bounds, and would "pass" by changing the row. The result is carried out to the
-- block below the way the selection result is, because a control measured under the wrong
-- identity measures nothing.
SELECT set_config('s4fx.write_release_msg', pg_temp.f_err(
         'UPDATE public.tradition_pack_releases r SET status = '
         || quote_literal('draft') || ' WHERE r.id = '
         || quote_literal(current_setting('s4fx.rel'))), false);
RESET ROLE;

DO $S5$
BEGIN
  PERFORM pg_temp.f_eq('5 the host selects the approved fixture through the customer path, '
    || 'with no privilege behind it', current_setting('s4fx.select_msg'), 'no-error');
  PERFORM pg_temp.f_eq('5b and the wedding points at exactly the release that was named',
    (SELECT w.tradition_pack_release_id = current_setting('s4fx.rel')::uuid
       FROM public.weddings w WHERE w.id = current_setting('s4fx.wed')::uuid), true);
  -- Refused as a *grant* problem, not as a trigger complaint: that difference is what §9 means
  -- when it says the customer must never write the release row. A trigger refusal would have
  -- meant the write was reachable and merely unkind to content.
  PERFORM pg_temp.f_ok('5c control: as the customer, the release row just chosen cannot be '
    || 'written at all, so the selection field is the only door ('
    || left(current_setting('s4fx.write_release_msg'), 60) || ')',
    current_setting('s4fx.write_release_msg') LIKE '42501%');
  PERFORM pg_temp.f_eq('5d and the refused write left the release exactly where approval left it',
    (SELECT r.status FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid), 'approved');
END $S5$;

-- ---------------------------------------------------------------------- step 6 — freeze it
SET ROLE authenticated;
SELECT set_config('test.uid', current_setting('s4fx.host'), false);
SELECT set_config('s4fx.freeze_msg', pg_temp.f_err(
         'SELECT set_config(''s4fx.freeze'', '
         || '(SELECT api.create_invitation_version('
         || quote_literal(current_setting('s4fx.wed')) || '::uuid))::text, false)'), false);
RESET ROLE;

DO $S6$
DECLARE v_snap jsonb; v_ver uuid; v_dto jsonb;
BEGIN
  PERFORM pg_temp.f_eq('6 the host freezes a version through the public API surface',
    current_setting('s4fx.freeze_msg'), 'no-error');
  v_snap := current_setting('s4fx.freeze')::jsonb -> 'snapshot';
  v_ver := (current_setting('s4fx.freeze')::jsonb ->> 'version_id')::uuid;
  v_dto := (SELECT private.public_invitation_dto(v.snapshot_schema_version, v.snapshot)
              FROM public.invitation_versions v WHERE v.id = v_ver);

  PERFORM pg_temp.f_eq('6b the frozen document names the fixture pack by its key',
    v_snap -> 'tradition_pack_release' ->> 'pack_key', 'test_reviewed_fixture');
  PERFORM pg_temp.f_eq('6c and by the exact release number, which is the pair that answers '
    || '"what did this guest read?"',
    v_snap -> 'tradition_pack_release' ->> 'release_number', '1');
  PERFORM pg_temp.f_eq('6d the version row pins the release the host selected, not the '
    || 'wedding''s current pointer',
    (SELECT v.tradition_pack_release_id = current_setting('s4fx.rel')::uuid
       FROM public.invitation_versions v WHERE v.id = v_ver), true);
  PERFORM pg_temp.f_eq('6e and the document resolves in the language the host chose, in the '
    || 'order the fixture declared rather than the order it was written',
    (SELECT array_agg(q ->> 'section_key' ORDER BY (q ->> 'position')::integer)
       FROM jsonb_array_elements(v_snap -> 'sections' -> 'items') e(q)),
    ARRAY['opening', 'family', 'ceremonies']);
  PERFORM pg_temp.f_eq('6f the opening line arrived as the pack''s reviewed wording, in the '
    || 'language the host chose, because the host left that field blank',
    (SELECT q -> 'body' ->> 'text'
       FROM jsonb_array_elements(v_dto -> 'sections' -> 'items') q
      WHERE q ->> 'section_key' = 'opening'), 'வணக்கம்');
  -- §12's sentence, measured on the projection rather than asserted about it: the document
  -- names whose sentence it is. A host override would *replace* this value, not qualify it,
  -- which is why there is no "reviewed but edited" state to test for.
  PERFORM pg_temp.f_eq('6g and the guest document says so itself, with `reviewed_pack` as the '
    || 'body source rather than a host sentence',
    (SELECT q -> 'body' ->> 'source'
       FROM jsonb_array_elements(v_dto -> 'sections' -> 'items') q
      WHERE q ->> 'section_key' = 'opening'), 'reviewed_pack');
  PERFORM pg_temp.f_ok('6h and the frozen version projects a guest document at all, so the '
    || 'fixture is a real invitation and not a row count', v_dto IS NOT NULL);
  -- Remembered for the retirement step: §11's claim is that deprecating a release moves
  -- nothing in a document already frozen from it.
  PERFORM set_config('s4fx.snap_hash', (SELECT md5(v.snapshot::text)
     FROM public.invitation_versions v WHERE v.id = v_ver), false);
  PERFORM set_config('s4fx.dto_hash', (SELECT md5(
      private.public_invitation_dto(v.snapshot_schema_version, v.snapshot)::text)
     FROM public.invitation_versions v WHERE v.id = v_ver), false);
  PERFORM set_config('s4fx.version', v_ver::text, false);
END $S6$;

-- ---------------------------------------------------------------- step 7 — deprecate it
SET ROLE service_role;

UPDATE public.tradition_pack_releases r
   SET status = 'deprecated', deprecated_at = now()
 WHERE r.id = current_setting('s4fx.rel')::uuid;

RESET ROLE;

SET ROLE authenticated;
SELECT set_config('test.uid', current_setting('s4fx.host'), false);
SELECT set_config('s4fx.refreeze_msg', pg_temp.f_err(
         'SELECT api.create_invitation_version('
         || quote_literal(current_setting('s4fx.wed')) || '::uuid)'), false);
RESET ROLE;

DO $S7$
BEGIN
  PERFORM pg_temp.f_eq('7 the release is retired, the only step out of approved',
    (SELECT r.status FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid), 'deprecated');
  PERFORM pg_temp.f_ok('7b and retirement stamped its own moment',
    (SELECT r.deprecated_at IS NOT NULL FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid));
  PERFORM pg_temp.f_eq('7c the frozen snapshot is byte-identical to what was frozen before the '
    || 'retirement',
    (SELECT md5(v.snapshot::text) FROM public.invitation_versions v
      WHERE v.id = current_setting('s4fx.version')::uuid),
    current_setting('s4fx.snap_hash'));
  PERFORM pg_temp.f_eq('7d and so is the guest document it projects, which is the whole point '
    || 'of pinning',
    (SELECT md5(private.public_invitation_dto(v.snapshot_schema_version, v.snapshot)::text)
       FROM public.invitation_versions v WHERE v.id = current_setting('s4fx.version')::uuid),
    current_setting('s4fx.dto_hash'));
  PERFORM pg_temp.f_ok('7e ruling A1''s second moment, on the fixture''s own row: a new freeze '
    || 'from the retired release is refused by the database, naming its status ('
    || left(current_setting('s4fx.refreeze_msg'), 90) || ')',
    current_setting('s4fx.refreeze_msg')
      LIKE '42501%may only be frozen from an approved tradition pack release%');
  PERFORM pg_temp.f_eq('7f and the refused freeze created no second version',
    (SELECT count(*) FROM public.invitation_versions v
      WHERE v.wedding_id = current_setting('s4fx.wed')::uuid), 1::bigint);
  -- Ruling A1's first half: retiring is not deleting. The host who chose it can still read it.
  PERFORM pg_temp.f_eq('7g while the retired release is still readable by the customer whose '
    || 'wedding points at it',
    (SELECT count(*) FROM public.tradition_pack_releases r
      WHERE r.id = current_setting('s4fx.rel')::uuid AND r.status = 'deprecated'), 1::bigint);
END $S7$;

-- The lifecycle has been exercised end to end. §8's cleanup is this rollback: nothing the
-- fixture wrote survives it, including the rows no DELETE was permitted to reach.
--
-- The assertion total leaves through the client, because nothing else here outlives the
-- rollback: this is the one number the transaction would otherwise take with it, and a printed
-- total that quietly lost every step assertion would be an instrument reporting a smaller run
-- than happened.
SELECT current_setting('s4fx.passed') AS inner_passed \gset

ROLLBACK;

-- Back to 0, deliberately: after the rollback the session setting has been reverted to what it
-- held before BEGIN, and re-zeroing it outside the transaction means the block below counts
-- exactly its own assertions instead of making a reader reconstruct which three were from the
-- header.
SELECT set_config('s4fx.passed', '0', false);

-- ------------------------------------------------------------ after the rollback: the proof
DO $END$
DECLARE v_packs bigint; v_rels bigint;
BEGIN
  SELECT count(*) INTO v_packs FROM public.tradition_packs;
  SELECT count(*) INTO v_rels FROM public.tradition_pack_releases;
  PERFORM pg_temp.f_eq('8a the rollback restored the catalogue to the counts measured before '
    || 'it began, which is §8''s cleanup proven rather than promised',
    ARRAY[v_packs::text, v_rels::text],
    ARRAY[current_setting('s4fx.before_packs'), current_setting('s4fx.before_rels')]);
  PERFORM pg_temp.f_eq('8b no pack anywhere carries §8''s fixture key, under either spelling',
    (SELECT count(*) FROM public.tradition_packs p
      WHERE p.pack_key LIKE 'test%fixture'), 0::bigint);
  PERFORM pg_temp.f_eq('8c and no release anywhere carries the fixture reviewer label, so the '
    || 'tooling leaves no review claim behind',
    (SELECT count(*) FROM public.tradition_pack_releases r
      WHERE r.review_label = 'TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW'),
    0::bigint);
  PERFORM pg_temp.f_eq('8d and the fixture wedding, its version and its two accounts are gone',
    ARRAY[((SELECT count(*) FROM public.weddings w
              WHERE w.id = current_setting('s4fx.wed')::uuid)::text),
          ((SELECT count(*) FROM public.invitation_versions v
              WHERE v.wedding_id = current_setting('s4fx.wed')::uuid)::text),
          ((SELECT count(*) FROM auth.users u
              WHERE u.email LIKE 'stage4-fixture-%@example.test')::text)],
    ARRAY['0', '0', '0']);
  -- The control that keeps 8a–8d from being silence: the same session can still read the
  -- schema, so the emptiness above was measured against a live database and an intact
  -- migration chain.
  PERFORM pg_temp.f_ok('8e control: the instruments still work after the rollback — the '
    || 'catalogue is readable and the guard is still installed',
    to_regclass('public.tradition_pack_releases') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_trigger t
                   JOIN pg_class c ON c.oid = t.tgrelid
                  WHERE c.relname = 'tradition_pack_releases'
                    AND NOT t.tgisinternal));
END $END$;

-- The whole file's total: what the transaction measured, carried out through psql, plus what
-- the cleanup proof measured after it. Both halves are counted by the same instruments, so the
-- number below is the number of assertions this file ran.
SELECT 'PASSED (' || (:inner_passed::int
       + coalesce(nullif(current_setting('s4fx.passed', true), ''), '0')::int) || ')';
