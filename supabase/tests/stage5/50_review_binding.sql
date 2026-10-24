-- Stage 5: the review *digest* battery — what a review covers, who can bind it, who can
-- reach the surface that binds it, and what happens when the material and the record come
-- apart.
--
-- Run after `supabase/tests/stage4/50_pack_release.sql`, as the superuser, in one
-- transaction that commits.
--
-- Why Stage 4's battery is not enough for this. Stage 4 proved that a frozen document says
-- what the host approved, forever, and that a customer cannot walk a release through the
-- lifecycle. It did not have to answer the Stage 5 question, which is a different one: when a
-- human being eventually says "I read this and I vouch for it", *what exactly did they read?*
-- Stage 4 recorded the answer as free text beside the row. Text can describe material that no
-- longer exists. This file measures the alternative: a digest of the material itself, produced
-- by one function, stamped at one edge, re-compared at the next, and impossible to move
-- without moving the content it names.
--
--   BASE  the run's own identity, and the catalogue counts this file starts from
--   P     the canonical payload and its SHA-256, measured as a function of the material
--   B     the digest's whole life inside the lifecycle guard: one writer, one edge, and a
--         refusal rather than a re-stamp when the two disagree
--   S     the maintenance surface's own path through the same edge — packet, submission,
--         stale digest, rejection that is not a status, approval, retirement
--   M     who can reach any of it: the nested call the guard now makes, and the eleven
--         functions no browser role may execute
--   T     the ledger: what this file leaves behind, what it proves about its own fixtures,
--         and its floor
--
-- The `§` numbers below are those of the Stage 5 core-implementation directive (A–Q) and,
-- where a property is inherited, of the extended roadmap's §9 and §20.
--
-- Nothing here reviews anything, and one group is specifically about that. Every pack,
-- release and review record below is a synthetic fixture carrying the words TEST ONLY,
-- `machine_assisted = true`, and review sentences that say out loud they claim no cultural
-- authority. The Tamil strings are reused from Stage 4's committed fixtures so that this file
-- adds no new cultural wording of its own; they are present because a two-language path needs
-- two languages, and no assertion here measures how a string is spelled. The real Tamil
-- candidate is not touched by this file, is not marked reviewed, and is not approved.

SET client_min_messages = notice;
SELECT set_config('s5.passed', '0', false);

-- --------------------------------------------------------------------------- helpers
-- The same four instruments as the Stage 2, 3 and 4 suites, for the same three reasons: an
-- assertion that cannot be counted can be deleted without anything noticing, a refusal that
-- reports 'no-error' can pass by accident, and a set compared in the machine's collation can
-- disagree between two runs of identical code.
CREATE FUNCTION pg_temp.s5_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s5.passed',
    (coalesce(nullif(current_setting('s5.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s5_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s5_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s5_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s5_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s5_jq(label text, got jsonb, want jsonb) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label,
      coalesce(got::text, '<null>'), coalesce(want::text, '<null>');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s5_add(1);
END $fn$;

-- SQLSTATE || message, or 'no-error'. SECURITY INVOKER, so it reports what the role the
-- session is holding at the time actually experienced.
CREATE FUNCTION pg_temp.s5_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

-- One statement, issued as one named role, reported as an outcome. Every refusal in group M
-- needs this form: a privilege assertion made by inspecting an ACL proves what was *granted*,
-- not what a caller experiences, and the two have already differed once in this repository
-- (Stage 2's C63 records that ALTER DEFAULT PRIVILEGES cannot revoke the implicit PUBLIC
-- EXECUTE, so a forgotten grant is reachable even though the ACL says otherwise).
CREATE FUNCTION pg_temp.s5_as(p_role text, p_stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  EXECUTE 'SET ROLE ' || quote_ident(p_role);
  v := pg_temp.s5_err(p_stmt);
  EXECUTE 'RESET ROLE';
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  -- A `SET ROLE` inside a function outlives the function (measured, and recorded in
  -- Stage 4's own freeze helper), so leaving here without the reset would run the rest of
  -- this file as a browser role and silently change what every later group measures.
  EXECUTE 'RESET ROLE';
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

CREATE FUNCTION pg_temp.s5_is_superuser(label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'FAIL % — running as %', label, current_user;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s5_add(1);
END $fn$;

-- Which schema head this run qualifies, declared to the session by the runner rather than read
-- from the catalogue. A helper of this file's own, not Stage 4's: `pg_temp` lives only for one
-- psql invocation, and the two suites are separate invocations by design.
CREATE FUNCTION pg_temp.s5_head() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(current_setting('app.stage_head', true), '(unset)') $fn$;

-- "From stage <n> up", for the handful of assertions in this file that enumerate a schema rather
-- than naming objects inside it. A whole-schema census is the only kind of check a later
-- migration can trip without intending to, so it has to be able to say which head it measured —
-- the same reason Stage 4's inventory group carries a ladder. The token is the runner's, not the
-- catalogue's: a head derived from `pg_proc` would make the expectation follow the measurement.
CREATE FUNCTION pg_temp.s5_at_least(want text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $fn$
DECLARE h int; w int;
BEGIN
  IF pg_temp.s5_head() !~ '^stage[0-9]+$' OR want !~ '^stage[0-9]+$' THEN
    RAISE EXCEPTION 's5_at_least: a stage head must be spelled stage<n> — got head=% want=%',
      pg_temp.s5_head(), want;
  END IF;
  h := regexp_replace(pg_temp.s5_head(), '^stage', '')::int;
  w := regexp_replace(want, '^stage', '')::int;
  RETURN h >= w;
END;
$fn$;

-- The digest of a stored row, recomputed from the row's own material by the same function the
-- trigger calls. This is the file's central instrument: it is what "stored == current" means,
-- and it is deliberately *not* a second implementation — an independent re-derivation of the
-- payload here would prove only that this file can write JSON.
CREATE FUNCTION pg_temp.s5_hash_of(p_rel uuid) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT private.tradition_pack_review_hash(
           r.pack_id, r.release_number, r.definition_schema_version, r.languages,
           r.definition, r.author_label, r.machine_assisted, r.machine_assistance_notes,
           r.source_reference, r.changelog)
    FROM public.tradition_pack_releases r WHERE r.id = p_rel $fn$;

-- ... and the same for a row that does not exist yet, so a packet's printed digest can be
-- compared with the one a submission will be checked against.
CREATE FUNCTION pg_temp.s5_packet_hash(p_rel uuid) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT (internal_api.get_tradition_pack_review_packet(p_rel) ->> 'review_packet_hash')::text $fn$;

-- The content tuple, as a fingerprint. `updated_at` is excluded because a BEFORE trigger
-- rewrites it on every statement, so including it would report "changed" for a patch that
-- changed nothing — which is the opposite of what this instrument is for.
CREATE FUNCTION pg_temp.s5_fingerprint(p_rel uuid) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(concat_ws('|', r.pack_id, r.release_number, r.definition_schema_version,
                       r.languages, r.definition, r.author_label, r.machine_assisted,
                       r.machine_assistance_notes, r.source_reference, r.changelog,
                       r.review_label, r.review_basis, r.review_scope,
                       r.reviewed_languages, r.reviewed_by, r.status,
                       r.review_packet_hash))
    FROM public.tradition_pack_releases r WHERE r.id = p_rel $fn$;

-- The v2 definition this file authors with. It is Stage 4's release-1 fixture plus the two
-- v2 declarations, and the choice of which sections get which rule is not arbitrary: one of
-- each, so all three rules and the venue requirement are in force in the same document.
-- Event keys are named `event_a`/`event_b` rather than after any rite, because this file adds
-- no cultural vocabulary of its own and a fixture named after a ceremony would be the one
-- thing §K refuses.
CREATE FUNCTION pg_temp.s5_def() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT $${
    "sections": [
      {"section_key": "opening", "position": 1, "kind": "text", "required": true,
       "host_field": "welcome", "override_rule": "host_may_replace",
       "allow_english_fallback": true,
       "heading": {"en": "Opening", "ta": "தொடக்கம்"},
       "pack_text": {"en": "With the goodwill of both families.", "ta": "வணக்கம்"}}
      ,
      {"section_key": "family", "position": 2, "kind": "people_list", "required": true,
       "heading": {"en": "Our families", "ta": "குடும்பம்"}}
      ,
      {"section_key": "ceremonies", "position": 3, "kind": "event_list", "required": true,
       "requires_venue": true,
       "heading": {"en": "The ceremonies", "ta": "நிகழ்ச்சிகள்"}}
      ,
      {"section_key": "blessing", "position": 4, "kind": "text", "required": true,
       "override_rule": "pack_only",
       "heading": {"en": "A closing line", "ta": "முடிப்பு"},
       "pack_text": {"en": "TEST ONLY reviewed wording that the host may not replace.",
                     "ta": "வணக்கம்"}}
      ,
      {"section_key": "event_notes", "position": 5, "kind": "text", "required": false,
       "override_rule": "host_must_supply", "host_field": "event_notes",
       "heading": {"en": "Note", "ta": "குறிப்பு"}}
    ],
    "event_vocabulary": [
      {"event_key": "event_a", "labels": {"en": "Event A", "ta": "நிகழ்ச்சி"}},
      {"event_key": "event_b", "labels": {"en": "Event B", "ta": "நிகழ்ச்சி"}}
    ]
  }$$::jsonb $fn$;

-- One review record, spelled once so no group below can differ about what the words mean, and
-- every one of them says what it is. §D of the Stage 5 directive is the reason no string in
-- here reads as a human cultural authority. It returns the *statement* rather than running it,
-- because the same step has to be issued twice in this file — once as the maintenance identity
-- and once as `service_role`, which is the role the grant above §-group M exists for.
CREATE FUNCTION pg_temp.s5_review_stmt(p_rel uuid, p_maintainer uuid, p_hash text DEFAULT NULL)
RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT format(
    'UPDATE public.tradition_pack_releases SET status = %L, review_label = %L, '
    || 'review_basis = %L, review_scope = %L, reviewed_languages = %L::text[], '
    || 'reviewed_by = %L::uuid, reviewed_at = now()'
    || coalesce(', review_packet_hash = ' || quote_literal(p_hash), '')
    || ' WHERE id = %L::uuid',
    'reviewed',
    'TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW',
    'Automated Stage 5 database qualification only. No human cultural authority, no '
    'religious standing and no native-speaker language competence is claimed by, or behind, '
    'this record.',
    'TEST ONLY — section order, section kinds, override rules and language coverage were '
    'read. No ritual, community or religious content was reviewed, because none is present '
    'in this release.',
    ARRAY['en', 'ta'], p_maintainer, p_rel) $fn$;

-- ------------------------------------------------------ the run's own identity, first
-- Same discipline as Stage 4's BASE group: the catalogue is not empty when this file runs,
-- because Stage 4's battery committed its fixtures immediately before. So the entry counts are
-- measured and remembered, and every count asserted later is a delta from here — which is what
-- lets this file be re-run in a different order and still mean the same thing.
DO $BASE$
DECLARE v_packs bigint; v_rels bigint; v_vers bigint; v_mine bigint;
BEGIN
  PERFORM pg_temp.s5_is_superuser('BASE0 this battery is qualified as the maintenance identity, '
    'because the digest is written by a trigger whose nested call is privilege-checked against '
    'whoever issued the statement');

  -- Declared by `supabase/tests/stage5/run.sh` through `PGOPTIONS=-c app.stage_head=stage5`,
  -- not derived from the schema. If the head were read back from `pg_proc`, the assertion
  -- below could not fail, and the two-head split in Stage 4's inventory group would be
  -- measuring the instrument rather than the thing.
  --
  -- "From Stage 5 up", not "exactly Stage 5": heads are cumulative, so a Stage 6 chain still
  -- contains every object this file measures, and refusing it there would hide a real regression
  -- signal behind an identity check. An undeclared or malformed token still fails — the substring
  -- yields NULL, and NULL is distinct from `true`, so this cannot pass by accident.
  PERFORM pg_temp.s5_eq('BASE1 the run declares which schema head it is qualifying, and this '
    'file only means anything from the Stage 5 head up — a battery whose own identity is unverifiable '
    'cannot report a delta',
    (SELECT ((substring(pg_temp.s5_head() from '^stage([0-9]+)$'))::int >= 5)), true);

  SELECT count(*) INTO v_packs FROM public.tradition_packs;
  SELECT count(*) INTO v_rels FROM public.tradition_pack_releases;
  SELECT count(*) INTO v_vers FROM public.invitation_versions;
  SELECT count(*) INTO v_mine FROM public.tradition_packs
   WHERE pack_key LIKE 'stage5\_%';
  PERFORM pg_temp.s5_eq('BASE2 and none of this file''s own pack keys is already in the '
    'catalogue, so every row it goes on to count is one it made (' || v_mine || ' pre-existing)',
    v_mine, 0::bigint);
  PERFORM set_config('s5.base_packs',  v_packs::text, false);
  PERFORM set_config('s5.base_rels',   v_rels::text,  false);
  PERFORM set_config('s5.base_vers',   v_vers::text,  false);
  RAISE NOTICE 'PASS BASE3 the catalogue at entry is measured, not assumed (packs=%, releases=%, versions=%)',
    v_packs, v_rels, v_vers;
  PERFORM pg_temp.s5_add(1);
END $BASE$;

-- ------------------------------------------------------------------------- fixtures
-- Three releases of one pack, in three different starting states, plus a maintenance account
-- that is a fixture rather than a person. `ON COMMIT DROP` for the ids: psql commits this file
-- only when the whole battery has passed, and the rows the lifecycle refuses to delete are
-- erased with the throwaway database either way — which is the same arrangement Stage 4's
-- battery documents at its own fixture block.
CREATE TEMP TABLE sf ON COMMIT DROP AS
SELECT gen_random_uuid() AS maintainer, gen_random_uuid() AS pack_a,
       gen_random_uuid() AS rel_1, gen_random_uuid() AS rel_2,
       gen_random_uuid() AS rel_3, gen_random_uuid() AS rel_4,
       '0000000000000000000000000000000000000000000000000000000000000000'::text AS fake_hash;

SELECT set_config('s5.maintainer', (SELECT maintainer::text FROM sf), false);

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT maintainer, 'stage5-digest-maintainer@example.test',
       jsonb_build_object('name', 'Stage 5 maintenance account — not a reviewer') FROM sf;

INSERT INTO public.tradition_packs (id, pack_key, display_name, scope_statement)
SELECT pack_a, 'stage5_binding', 'TEST ONLY — Stage 5 digest battery pack',
       'TEST ONLY — a synthetic pack this battery uses to measure how a review is bound to the '
       'material it describes. It claims no tradition, endorses no community, reviews no '
       'religious text, and is never shipped to a customer.' FROM sf;

-- Release 1 carries the full v2 definition: one section for each of the three override rules,
-- a people list, a required event list that demands a venue, and an optional section only the
-- host can write. It is the material every digest assertion below is made of.
INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT rel_1, pack_a, 1, 2, ARRAY['en', 'ta'], pg_temp.s5_def(),
       'TEST ONLY — synthetic authored fixture', true,
       'TEST ONLY — drafted by a model from product structure and checked for shape and '
       'language coverage. No human reader of Tamil reviewed any string in this release.',
       'TEST ONLY — no external source', 'First release of the digest battery' FROM sf;

-- Release 2: byte-identical material to release 1 except the `changelog`, which is the
-- cheapest way to hold two rows whose digests must differ while everything else about them is
-- the same. Group P uses it to show the digest is a function of the content and not of the
-- pack, the release number being the only other difference.
INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT rel_2, pack_a, 2, 2, ARRAY['en', 'ta'], pg_temp.s5_def(),
       'TEST ONLY — synthetic authored fixture', true,
       'TEST ONLY — drafted by a model from product structure and checked for shape and '
       'language coverage. No human reader of Tamil reviewed any string in this release.',
       'TEST ONLY — no external source',
       'Second release of the digest battery, one changelog line away from the first' FROM sf;

-- Release 3 starts as the draft the maintenance path will walk, so group S never has to
-- invent a row to hold its own assertions.
INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT rel_3, pack_a, 3, 2, ARRAY['en', 'ta'], pg_temp.s5_def(),
       'TEST ONLY — synthetic authored fixture', true,
       'TEST ONLY — drafted by a model from product structure and checked for shape and '
       'language coverage. No human reader of Tamil reviewed any string in this release.',
       'TEST ONLY — no external source', 'Draft for the maintenance path' FROM sf;

-- Release 4 is the one `service_role` walks, and the reason it exists separately is that the
-- step it takes is the exact step the new grant in the migration exists to make possible.
INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT rel_4, pack_a, 4, 2, ARRAY['en', 'ta'], pg_temp.s5_def(),
       'TEST ONLY — synthetic authored fixture', true,
       'TEST ONLY — drafted by a model from product structure and checked for shape and '
       'language coverage. No human reader of Tamil reviewed any string in this release.',
       'TEST ONLY — no external source', 'Draft for the trusted-backend lifecycle step' FROM sf;

-- =========================================================== P. the digest, as a function
DO $P$
DECLARE v_rel1   uuid; v_maint uuid; v_pack uuid;
        v_h1     text; v_h2     text; v_pkt  jsonb; v_pay text;
        v_missing text[]; v_present text[];
        v_def    jsonb;
BEGIN
  PERFORM pg_temp.s5_is_superuser('P0 the digest group runs as the maintenance identity');
  SELECT rel_1, maintainer, pack_a INTO v_rel1, v_maint, v_pack FROM sf;
  v_def  := pg_temp.s5_def();
  v_pkt  := internal_api.get_tradition_pack_review_packet(v_rel1);
  v_h1   := pg_temp.s5_hash_of(v_rel1);
  v_pay  := v_pkt ->> 'canonical_payload';

  -- A digest that is not 64 lowercase hex is not a SHA-256, and a review bound to anything
  -- else would be bound to a guess about the algorithm.
  PERFORM pg_temp.s5_ok('P1 the digest of one release is a lowercase SHA-256 hex string of '
    'exactly 64 characters, so the review is bound to a value that cannot be a placeholder',
    v_h1 ~ '^[0-9a-f]{64}$');

  -- The whole §E design in one equality: the packet the reviewer is shown and the value the
  -- trigger will write are produced by the same call, so a CLI that renders this packet cannot
  -- disagree with the database about what was reviewed. An independent re-implementation here
  -- would prove only that this file can write JSON.
  PERFORM pg_temp.s5_eq('P2 the packet printed for a reviewer already carries the digest the '
    'lifecycle will store, because both come from one function rather than two implementations',
    (v_pkt ->> 'review_packet_hash'), v_h1);

  PERFORM pg_temp.s5_eq('P3 the payload the packet prints is the payload that digests to it, '
    'so the reviewer can read the exact bytes the binding is made of',
    encode(sha256(v_pay::bytea), 'hex'), v_h1);

  PERFORM pg_temp.s5_eq('P4 the payload declares which contract it serialises, so a reader who '
    'finds this string in a log years from now knows how to re-derive it',
    left(v_pay, 29), 'VIVAAHVARNAM-REVIEW-PAYLOAD/1');

  -- Everything whose change should invalidate a review. Each name is looked for in the form
  -- the payload emits (a field name followed by its tab), not as a bare substring, so a word
  -- appearing inside ceremonial copy would not count as coverage.
  SELECT coalesce(array_agg(f), '{}'::text[]) INTO v_missing
    FROM unnest(ARRAY['pack_key', 'pack_display_name', 'pack_scope_statement',
                      'release_number', 'definition_schema_version', 'languages',
                      'definition', 'author_label', 'machine_assisted',
                      'machine_assistance_notes', 'source_reference', 'changelog']) f
   WHERE position(f || chr(9) in v_pay) = 0;
  PERFORM pg_temp.s5_eq('P5 the payload covers all twelve fields whose change must invalidate a '
    'review, and names none of them by accident ('
    || array_to_string(v_missing, ', ') || ' missing)', v_missing, '{}'::text[]);

  -- Everything whose change must NOT, spelled out as the reviewer's answer and the row's
  -- operational state. The reason this is an assertion rather than a comment is that the
  -- tempting way to "improve" a review binding is to hash the reviewer's name and the approval
  -- timestamp into it, and doing so would make draft -> reviewed unsatisfiable by construction,
  -- because those columns are written in the same statement that computes the digest.
  SELECT coalesce(array_agg(f), '{}'::text[]) INTO v_present
    FROM unnest(ARRAY['review_label', 'review_basis', 'review_scope', 'reviewed_languages',
                      'reviewed_by', 'reviewed_at', 'approved_at', 'deprecated_at',
                      'status', 'created_at', 'updated_at', 'review_packet_hash']) f
   WHERE position(f || chr(9) in v_pay) > 0;
  PERFORM pg_temp.s5_eq('P6 and no reviewer answer, no lifecycle state and no timestamp appears '
    'in the payload, so the digest describes the material rather than the row''s diary ('
    || array_to_string(v_present, ', ') || ' leaked)', v_present, '{}'::text[]);

  -- What an author can and cannot do to a binding by reformatting. A `definition` column is
  -- jsonb, which is normalised on input, so the same object typed with its keys in a different
  -- order is the same stored value and therefore the same digest: reformatting cannot create a
  -- spurious review difference, and the payload does not have to sort anything to guarantee it.
  -- Measured on a rebuilt definition rather than argued — each section re-emitted with its own
  -- keys in reverse order, which is exactly what a diff-view or a re-serialising tool produces.
  v_h2 := private.tradition_pack_review_hash(
    v_pack, 1, 2, ARRAY['en', 'ta'],
    jsonb_set(v_def, '{sections}',
      (SELECT jsonb_agg((SELECT jsonb_object_agg(k, s -> k)
                           FROM (SELECT k FROM jsonb_object_keys(s) k ORDER BY k DESC) y))
         FROM jsonb_array_elements(v_def -> 'sections') s)),
    'TEST ONLY — synthetic authored fixture', true,
    'TEST ONLY — drafted by a model from product structure and checked for shape and '
    || 'language coverage. No human reader of Tamil reviewed any string in this release.',
    'TEST ONLY — no external source', 'First release of the digest battery');
  PERFORM pg_temp.s5_eq('P7 a definition whose section objects have their keys listed in the '
    'opposite order digests identically, so "same bytes, same hash" does not depend on how the '
    'author typed it', v_h2, v_h1);

  -- ... and the other side of the same line, which is where the guarantee stops: the sections
  -- *array* is ordered material, because it is the document. A release whose array is re-ordered
  -- is refused an inherited binding and gets a fresh one, which is the conservative direction —
  -- an over-binding would be a reviewer credited for bytes they were not shown.
  v_h2 := private.tradition_pack_review_hash(
    v_pack, 1, 2, ARRAY['en', 'ta'],
    jsonb_set(v_def, '{sections}',
      (SELECT jsonb_agg(s) FROM (SELECT s FROM jsonb_array_elements(v_def -> 'sections') s
                                 ORDER BY (s ->> 'position')::integer DESC) r)),
    'TEST ONLY — synthetic authored fixture', true,
    'TEST ONLY — drafted by a model from product structure and checked for shape and '
    || 'language coverage. No human reader of Tamil reviewed any string in this release.',
    'TEST ONLY — no external source', 'First release of the digest battery');
  PERFORM pg_temp.s5_ok('P8 a re-ordered section array does digest differently, and that is the '
    'safe way round: the array is the order a guest reads the invitation in, so it is content '
    'rather than formatting', v_h2 <> v_h1);

  -- A position rewritten is the same fact reached by a different act, and §3.2's rule that the
  -- resolver orders by `position` is the reason it belongs in the payload.
  v_h2 := private.tradition_pack_review_hash(
    v_pack, 1, 2, ARRAY['en', 'ta'],
    jsonb_set(v_def, '{sections,0,position}', '4'),
    'TEST ONLY — synthetic authored fixture', true,
    'TEST ONLY — drafted by a model from product structure and checked for shape and '
    || 'language coverage. No human reader of Tamil reviewed any string in this release.',
    'TEST ONLY — no external source', 'First release of the digest battery');
  PERFORM pg_temp.s5_ok('P8b and changing one section''s declared position moves the digest too, '
    'so the binding covers the ordering the release asks for, not only the array it was written '
    'in', v_h2 <> v_h1);

  -- One reviewable character, in the host-visible wording, must move the digest. This is §E's
  -- "one reviewable character changed -> hash changes", measured on the Tamil field rather than
  -- the English one because the Tamil is the material a cultural reviewer would be asked about.
  v_h2 := private.tradition_pack_review_hash(
    v_pack, 1, 2, ARRAY['en', 'ta'],
    jsonb_set(v_def, '{sections,0,pack_text,ta}', to_jsonb('வணக்கம'::text)),
    'TEST ONLY — synthetic authored fixture', true,
    'TEST ONLY — drafted by a model from product structure and checked for shape and '
    || 'language coverage. No human reader of Tamil reviewed any string in this release.',
    'TEST ONLY — no external source', 'First release of the digest battery');
  PERFORM pg_temp.s5_ok('P9 one character changed in the reviewed Tamil wording of one section '
    'produces a different digest, so a reviewer who approved the earlier bytes could not be '
    'said to have approved these', v_h2 <> v_h1);

  PERFORM pg_temp.s5_ok('P10 and the same single-character edit in the machine-assistance '
    'disclosure moves the digest too, because what a reviewer was told about how the text was '
    'produced is part of what they read',
    private.tradition_pack_review_hash(
      v_pack, 1, 2, ARRAY['en', 'ta'], v_def, 'TEST ONLY — synthetic authored fixture', true,
      'TEST ONLY — drafted by a model from product structure and checked for shape and '
      || 'language coverage. No human reader of Tamil reviewed any string here.',
      'TEST ONLY — no external source', 'First release of the digest battery') <> v_h1);

  -- The release number is in the payload on purpose. Two rows with identical wording, identical
  -- authorship and identical language coverage but different numbers must not be able to share
  -- a binding, or an approval recorded against one could be re-quoted for the other — and this
  -- is measurable directly, because release 2 of this pack is release 1's material.
  v_h2 := private.tradition_pack_review_hash(
    v_pack, 2, 2, ARRAY['en', 'ta'], v_def,
    'TEST ONLY — synthetic authored fixture', true,
    'TEST ONLY — drafted by a model from product structure and checked for shape and '
    || 'language coverage. No human reader of Tamil reviewed any string in this release.',
    'TEST ONLY — no external source', 'First release of the digest battery');
  PERFORM pg_temp.s5_ok('P11 the same material stamped with a different release number digests '
    'differently, so a review bound to release 1 cannot be read back as a review of release 2',
    v_h2 <> v_h1);

  -- NULL is not empty. `review_field` prints -1 for a value that is absent and the byte length
  -- for one that is present, which is what stops an author deleting `source_reference` from
  -- under a review that read it.
  PERFORM pg_temp.s5_ok('P12 the payload distinguishes an absent field from an empty one, so '
    'deleting the source reference is a change a reviewer would have noticed rather than a '
    'silence that hashes the same',
    private.review_field('source_reference', NULL)
      <> private.review_field('source_reference', ''));

  -- The column cannot hold anything but a SHA-256 hex digest, independently of the trigger.
  -- Asserted as a schema fact rather than as a behaviour, because the only caller that writes
  -- the column writes a valid digest — which is exactly why a future bug in that caller needs
  -- a second, dumb constraint underneath it.
  PERFORM pg_temp.s5_ok('P13 and the column itself refuses any value that is not 64 lowercase '
    'hex, so a defect in the one writer cannot silently store a placeholder',
    EXISTS (SELECT 1 FROM pg_constraint k
             JOIN pg_class c ON c.oid = k.conrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = 'tradition_pack_releases'
              AND k.contype = 'c'
              AND pg_get_constraintdef(k.oid) LIKE '%[0-9a-f]{64}%'));
END $P$;

-- ================================================== B. the digest inside the lifecycle guard
-- Group P measured the function. This group measures the only place it is *written*, which is
-- where §B's requirements actually live: one writer, one edge, no backwards edit to make a
-- digest match, and a refusal rather than a re-stamp when the material and the record have
-- come apart.
DO $B$
DECLARE v_rel1 uuid; v_rel2 uuid; v_pack uuid; v_maint uuid;
        v_h0 text; v_h1 text; v_err text; v_gone uuid; v_nullhash uuid;
        v_forged uuid; v_fake text; v_rows bigint;
BEGIN
  PERFORM pg_temp.s5_is_superuser('B0 the lifecycle group runs as the maintenance identity');
  SELECT rel_1, rel_2, pack_a, maintainer INTO v_rel1, v_rel2, v_pack, v_maint FROM sf;
  -- An invalid digest, deliberately. A forged 64-hex value could be accepted by the column's
  -- shape CHECK, so the only way to tell "the trigger overwrote what I sent" apart from "the
  -- trigger let it through" is to send something the CHECK itself would refuse.
  v_fake := 'not-a-sha256-digest-at-all';

  ---------------------------------------------------- a draft holds no binding, by construction
  PERFORM pg_temp.s5_eq('B1 a release born as draft carries no review digest, because a digest '
    'is evidence that a review happened and this one has not',
    (SELECT count(*) FROM public.tradition_pack_releases r
      WHERE r.id = v_rel1 AND r.review_packet_hash IS NULL), 1::bigint);

  -- ------------------------------------------------------------------ a row cannot be born bound
  -- The INSERT path returns before the UPDATE arms, so this needs its own refusal — and it is
  -- measured with a definition that is otherwise valid, so the hash is the only reason it fails.
  v_err := pg_temp.s5_err('INSERT INTO public.tradition_pack_releases '
    || '(id, pack_id, release_number, definition_schema_version, languages, definition, '
    || 'author_label, machine_assisted, machine_assistance_notes, source_reference, changelog, '
    || 'review_packet_hash) VALUES ('
    || quote_literal(gen_random_uuid()::text) || ', ' || quote_literal(v_pack::text) || '::uuid, '
    || '900, 2, ARRAY[''en'',''ta''], pg_temp.s5_def(), '
    || '''TEST ONLY — forged birth'', true, '
    || '''TEST ONLY — drafted by a model and checked for shape only. No human reader of Tamil '
    || 'reviewed any string in this release.''::text, '
    || '''TEST ONLY — no external source'', ''Forged birth'', '
    || 'private.tradition_pack_review_hash(' || quote_literal(v_pack::text) || '::uuid, 900, 2, '
    || 'ARRAY[''en'',''ta''], pg_temp.s5_def(), ''TEST ONLY — forged birth'', true, '
    || '''TEST ONLY — drafted by a model and checked for shape only. No human reader of Tamil '
    || 'reviewed any string in this release.''::text, ''TEST ONLY — no external source'', '
    || '''Forged birth''))');
  PERFORM pg_temp.s5_ok('B2 a release cannot be created already carrying a binding (' || v_err || ')',
    v_err LIKE 'P0001%cannot already carry a review binding%');

  -- Scoped to the pack this probe authored against, and that is a measurement rather than a
  -- tidy-up. Measured at the Stage 6 head, alone on a schema with no other suite's rows: this
  -- file prints PASSED (122) and B2b reads zero. Run after `stage2/20_attacks.sql` has committed
  -- in the same database — which is the order `tests/stage6/run.sh` chains — an unscoped count
  -- of 900 reported 1, and the row it was counting is `unshipped_pack`'s own approved scratch
  -- release at 900, kept on purpose by that suite's lifecycle cases. The same count scoped to
  -- `stage5_binding` still reported 0, so nothing about this file's forged birth was written;
  -- the assertion was answering a question about another battery's fixtures. Stage 4 made the
  -- identical repair for the identical reason (`50_pack_release.sql`, the note above its `Dc3`).
  SELECT count(*) INTO v_rows FROM public.tradition_pack_releases
    WHERE pack_id = v_pack AND release_number = 900;
  PERFORM pg_temp.s5_eq('B2b and the refusal wrote nothing, including no half-formed row a later '
    'release number would have to work around', v_rows, 0::bigint);

  -- ------------------------------------------------------- the only writer is the trigger
  -- A caller that simply sets the column on a draft gets it put back, not an error: §3's note
  -- in the migration is that refusing here would leak the shape of the row for an act that is
  -- merely pointless. What matters is the outcome — the value a draft holds is the value the
  -- guard gave it, which for a draft is nothing.
  v_err := pg_temp.s5_err('UPDATE public.tradition_pack_releases SET review_packet_hash = '
    || quote_literal(v_fake) || ' WHERE id = ' || quote_literal(v_rel2::text));
  PERFORM pg_temp.s5_eq('B3 an attempt to stamp a digest onto a draft by hand is not an error '
    'and not a write either — the column is put back exactly where it was (' || v_err || ')',
    v_err, 'no-error');
  PERFORM pg_temp.s5_eq('B3b and the draft still carries no digest afterwards, which is the only '
    'form of "a caller cannot forge a hash" that is worth asserting, because it holds whether or '
    'not the caller bothered to try',
    (SELECT review_packet_hash FROM public.tradition_pack_releases WHERE id = v_rel2), NULL::text);

  v_h0 := pg_temp.s5_hash_of(v_rel2);
  v_err := pg_temp.s5_err('UPDATE public.tradition_pack_releases SET changelog = '
    || '''Drafts are editable; that is the whole point of them'' WHERE id = '
    || quote_literal(v_rel2::text));
  PERFORM pg_temp.s5_eq('B4 while a draft really is editable, because the guard that refuses '
    'forgery must not also refuse authoring (' || v_err || ')', v_err, 'no-error');
  PERFORM pg_temp.s5_ok('B4a and editing a draft moves the digest the review will later be bound '
    'to, so a review of the earlier bytes cannot describe these',
    pg_temp.s5_hash_of(v_rel2) <> v_h0);
  PERFORM pg_temp.s5_eq('B4b and it still carries no recorded digest, because nothing has been '
    'reviewed yet',
    (SELECT review_packet_hash FROM public.tradition_pack_releases WHERE id = v_rel2), NULL::text);

  ------------------------------------------------------------------ draft -> reviewed, once
  v_h0 := pg_temp.s5_hash_of(v_rel1);
  v_err := pg_temp.s5_err(pg_temp.s5_review_stmt(v_rel1, v_maint));
  PERFORM pg_temp.s5_eq('B5 the legal draft -> reviewed step runs, and it is the step the whole '
    'binding depends on being possible (' || v_err || ')', v_err, 'no-error');

  v_h1 := (SELECT review_packet_hash FROM public.tradition_pack_releases WHERE id = v_rel1);
  PERFORM pg_temp.s5_eq('B6 the reviewed row now holds exactly the digest the packet had already '
    'printed for it, so a reviewer who was shown those bytes was shown the ones that were bound',
    v_h1, v_h0);
  PERFORM pg_temp.s5_ok('B6b and the stored digest is a lowercase SHA-256, not a placeholder the '
    'guard happened to pass through', v_h1 ~ '^[0-9a-f]{64}$');
  PERFORM pg_temp.s5_eq('B6c and the recomputation still agrees with the stored value, which is '
    'the fact `inspect` reports as binding_current',
    pg_temp.s5_hash_of(v_rel1), v_h1);

  -- A caller cannot choose the value at the edge either: the assignment overwrites whatever was
  -- sent, and an invalid one proves the overwrite happened rather than the CHECK passing.
  SELECT gen_random_uuid() INTO v_nullhash;
  INSERT INTO public.tradition_pack_releases
    (id, pack_id, release_number, definition_schema_version, languages, definition,
     author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
    SELECT v_nullhash, pack_a, 5, 2, ARRAY['en', 'ta'], pg_temp.s5_def(),
           'TEST ONLY — synthetic authored fixture', true,
           'TEST ONLY — drafted by a model from product structure and checked for shape and '
           || 'language coverage. No human reader of Tamil reviewed any string in this release.',
           'TEST ONLY — no external source', 'A row to try forging at the review edge' FROM sf;
  v_err := pg_temp.s5_err(pg_temp.s5_review_stmt(v_nullhash, v_maint, v_fake));
  PERFORM pg_temp.s5_eq('B7 the digest cannot be chosen at the review edge either: this attempt '
    'sends an invalid value beside a legitimate transition, and the transition succeeding at all '
    'is what shows the guard overwrote it rather than passing it on to the column CHECK ('
    || v_err || ')', v_err, 'no-error');
  PERFORM pg_temp.s5_eq('B7b and what the row holds afterwards is the recomputation of its own '
    'material, not the forged string and not nothing',
    (SELECT review_packet_hash FROM public.tradition_pack_releases WHERE id = v_nullhash),
    pg_temp.s5_hash_of(v_nullhash));

  -- ------------------------------------------------------------------ a reviewed row is not a draft
  v_err := pg_temp.s5_err('UPDATE public.tradition_pack_releases SET changelog = '
    || '''Let me just make the material match the digest instead'' WHERE id = '
    || quote_literal(v_rel1::text));
  PERFORM pg_temp.s5_ok('B8 a reviewed release''s content cannot be edited to bring a digest '
    'back into line — §B''s rule that a reviewed row may not be moved backwards to get a '
    'matching hash (' || v_err || ')',
    v_err LIKE '23514%content is frozen%');

  v_err := pg_temp.s5_err('UPDATE public.tradition_pack_releases SET review_packet_hash = '
    || '''0000000000000000000000000000000000000000000000000000000000000000'' WHERE id = '
    || quote_literal(v_rel1::text));
  PERFORM pg_temp.s5_ok('B8b and the digest itself is inside the immutable review record, so '
    'rewriting it on a release that has left draft is refused by the same rule that refuses '
    'rewriting the reviewer''s words (' || v_err || ')',
    v_err LIKE '23514%review record is part of the frozen unit%');

  -- ----------------------------------------------------------- reviewed -> approved, re-compared
  v_err := pg_temp.s5_err('UPDATE public.tradition_pack_releases SET status = ''approved'' '
    || 'WHERE id = ' || quote_literal(v_rel1::text));
  PERFORM pg_temp.s5_eq('B9 approval of a reviewed release whose material still matches its '
    'binding succeeds, which is the positive control for every refusal in this group ('
    || v_err || ')', v_err, 'no-error');

  v_err := pg_temp.s5_err('UPDATE public.tradition_pack_releases SET status = ''reviewed'' '
    || 'WHERE id = ' || quote_literal(v_rel1::text));
  PERFORM pg_temp.s5_ok('B10 and the walk does not go backwards: approved -> reviewed is refused '
    'by name, because a release whose wording must change becomes a new release number rather '
    'than a reopened review (' || v_err || ')',
    v_err LIKE '23514%the only steps are draft%reviewed%');

  v_err := pg_temp.s5_err('UPDATE public.tradition_pack_releases SET status = ''draft'', '
    || 'review_label = NULL WHERE id = ' || quote_literal(v_rel1::text));
  PERFORM pg_temp.s5_ok('B10b and approved -> draft is refused too, so the state that would make '
    'the content editable again is unreachable from here (' || v_err || ')',
    v_err LIKE '23514%the only steps are draft%reviewed%');

  -- ------------------------------------------------------------------------ retirement
  v_err := pg_temp.s5_err('UPDATE public.tradition_pack_releases SET status = ''deprecated'' '
    || 'WHERE id = ' || quote_literal(v_rel1::text));
  PERFORM pg_temp.s5_eq('B11 an approved release can be retired, which is the only way the '
    'lifecycle lets content leave the menu without deleting what a guest already reads ('
    || v_err || ')', v_err, 'no-error');

  v_err := pg_temp.s5_err('UPDATE public.tradition_pack_releases SET status = ''approved'' '
    || 'WHERE id = ' || quote_literal(v_rel1::text));
  PERFORM pg_temp.s5_ok('B12 and nothing comes back from deprecated, including not approved, '
    'which is the step a maintainer under pressure would be tempted to take (' || v_err || ')',
    v_err LIKE '23514%the only steps are draft%reviewed%');

  ------------------------------------------------------------------ deletion, by state only
  SELECT gen_random_uuid() INTO v_gone;
  INSERT INTO public.tradition_pack_releases
    (id, pack_id, release_number, definition_schema_version, languages, definition,
     author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
    SELECT v_gone, pack_a, 6, 2, ARRAY['en', 'ta'], pg_temp.s5_def(),
           'TEST ONLY — synthetic authored fixture', true,
           'TEST ONLY — drafted by a model from product structure and checked for shape and '
           || 'language coverage. No human reader of Tamil reviewed any string in this release.',
           'TEST ONLY — no external source', 'A draft this battery is allowed to remove' FROM sf;
  v_err := pg_temp.s5_err('DELETE FROM public.tradition_pack_releases WHERE id = '
    || quote_literal(v_gone::text));
  PERFORM pg_temp.s5_eq('B13 a draft that was never reviewed can be deleted, because nothing '
    'outside this row ever referred to it (' || v_err || ')', v_err, 'no-error');

  v_err := pg_temp.s5_err('DELETE FROM public.tradition_pack_releases WHERE id = '
    || quote_literal(v_nullhash::text));
  PERFORM pg_temp.s5_ok('B14 a reviewed release cannot be deleted, and the refusal names the '
    'rule rather than a permission (' || v_err || ')',
    v_err LIKE '23001%may not be deleted%');

  v_err := pg_temp.s5_err('DELETE FROM public.tradition_pack_releases WHERE id = '
    || quote_literal(v_rel1::text));
  PERFORM pg_temp.s5_ok('B14b and a retired one cannot be deleted either — the guest link that '
    'outlives its pack is the whole point, and this row is now deprecated (' || v_err || ')',
    v_err LIKE '23001%may not be deleted%');

  -- ------------------------------------------------- a digest riding beside a later transition
  -- B3 covered a caller that sets the column with no transition, and B7b a caller that sets it
  -- at the review edge. The pair nobody tried was a legitimate step *and* a caller-supplied
  -- digest in the same statement: the approval arm below re-compares what is already stored and
  -- never reads what the caller sent, and the immutability tuple deliberately leaves the hash
  -- out so that the review edge can write it. Measured on this head before the guard was
  -- repaired, `SET status = 'approved', review_packet_hash = <whatever>` walked straight through
  -- and stored the caller's value. These cases are the control that keeps it a rule.
  --
  -- They work on their own row (release 7), not on release 5. Reusing one would retire it, and
  -- S27 measures what the retention report says about a release that is *reviewed* — a state this
  -- battery would then no longer contain. Consuming a fixture to prove one rule, and silently
  -- removing the state another rule is measured on, is how a battery shrinks.
  SELECT gen_random_uuid() INTO v_forged;
  INSERT INTO public.tradition_pack_releases
    (id, pack_id, release_number, definition_schema_version, languages, definition,
     author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
    SELECT v_forged, pack_a, 7, 2, ARRAY['en', 'ta'], pg_temp.s5_def(),
           'TEST ONLY — synthetic authored fixture', true,
           'TEST ONLY — drafted by a model from product structure and checked for shape and '
           || 'language coverage. No human reader of Tamil reviewed any string in this release.',
           'TEST ONLY — no external source', 'A row to try forging beside a later step' FROM sf;
  v_err := pg_temp.s5_err(pg_temp.s5_review_stmt(v_forged, v_maint));
  PERFORM pg_temp.s5_eq('B16b the row these cases work on reaches reviewed by the ordinary step, '
    'so nothing about it is special except that a caller keeps trying to write it (' || v_err || ')',
    v_err, 'no-error');
  v_h0 := (SELECT review_packet_hash FROM public.tradition_pack_releases WHERE id = v_forged);
  PERFORM pg_temp.s5_ok('B17a the row these cases work on arrives holding a real digest, so a '
    'later assertion that it still holds it is not a tautology',
    v_h0 ~ '^[0-9a-f]{64}$');

  v_err := pg_temp.s5_err('UPDATE public.tradition_pack_releases SET status = ''approved'', '
    || 'review_packet_hash = ' || quote_literal(v_fake) || ' WHERE id = '
    || quote_literal(v_forged::text));
  PERFORM pg_temp.s5_eq('B17 approving while sending a digest is not an error and not a write of '
    'what was sent either — the step happens, the digest stays the guard''s own (' || v_err || ')',
    v_err, 'no-error');
  PERFORM pg_temp.s5_eq('B17b and the row is approved',
    (SELECT status FROM public.tradition_pack_releases WHERE id = v_forged), 'approved');
  PERFORM pg_temp.s5_eq('B17c and the digest it holds is still the one the review edge wrote, '
    'byte for byte — this is the value a guest document''s provenance is later bound to, so a '
    'caller getting it stored is the forgery this guard claims is impossible',
    (SELECT review_packet_hash FROM public.tradition_pack_releases WHERE id = v_forged), v_h0);

  v_err := pg_temp.s5_err('UPDATE public.tradition_pack_releases SET status = ''deprecated'', '
    || 'review_packet_hash = ' || quote_literal(v_fake) || ' WHERE id = '
    || quote_literal(v_forged::text));
  PERFORM pg_temp.s5_eq('B18 the same attempt on the retirement edge is pinned the same way ('
    || v_err || ')', v_err, 'no-error');
  PERFORM pg_temp.s5_eq('B18b and it retired, which is the point: the pin must not turn a real '
    'step into a refusal',
    (SELECT status FROM public.tradition_pack_releases WHERE id = v_forged), 'deprecated');
  PERFORM pg_temp.s5_eq('B18c and the digest still has not moved',
    (SELECT review_packet_hash FROM public.tradition_pack_releases WHERE id = v_forged), v_h0);

  -- The other half of the repair: the pin must not eat the refusal. A caller that changes only
  -- the digest, with no transition to hide behind, is what the review-record arm has always
  -- named out loud — B8b measured that on a reviewed row. This measures it on a row that has
  -- been through both later edges, and with a value whose *shape* is legal (64 lowercase hex),
  -- so a passing assertion can only mean the guard spoke, not that a column CHECK happened to
  -- reject a malformed string.
  v_err := pg_temp.s5_err('UPDATE public.tradition_pack_releases SET review_packet_hash = '
    || '''0000000000000000000000000000000000000000000000000000000000000000'' WHERE id = '
    || quote_literal(v_forged::text));
  PERFORM pg_temp.s5_ok('B19 a digest rewrite with no transition is still refused by name on a '
    'retired row, so the pin added for B17/B18 did not quietly turn a published release''s '
    'frozen review record into a silently-restored column (' || v_err || ')',
    v_err LIKE '23514%review record is part of the frozen unit%');
  PERFORM pg_temp.s5_eq('B19b and the refusal left the digest it objected to exactly where it was',
    (SELECT review_packet_hash FROM public.tradition_pack_releases WHERE id = v_forged), v_h0);

  -- §33's second finding on this surface was a read-then-write window, not a forged value: the
  -- review submission compared the digest it was handed against material it had *read*, then wrote
  -- the row, with nothing in between holding the row still. A concurrent draft edit in that window
  -- would bind the reviewer to bytes they never saw, and the recheck at approval would agree with
  -- it, because by then both halves describe the new material. The repair is `FOR UPDATE` on the
  -- read. This battery is one session and cannot race itself, so the control is structural, in the
  -- same shape as B15 below: the shipped body has to carry the lock. The semicolon is what makes
  -- the pattern the clause rather than the prose — a comment that merely names `FOR UPDATE` would
  -- not satisfy it, and the assertion says so in its own detail.
  PERFORM pg_temp.s5_ok('B20 the review submission takes a row lock before it compares the digest, '
    'so the window §33 found cannot be re-opened by a future migration without this failing ('
    || CASE WHEN (SELECT prosrc FROM pg_proc p
                   JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'internal_api'
                    AND p.proname = 'submit_tradition_pack_review')
                LIKE '%FOR UPDATE;%'
        THEN 'clause present' ELSE 'clause absent' END || ')',
    (SELECT prosrc FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'internal_api'
        AND p.proname = 'submit_tradition_pack_review') LIKE '%FOR UPDATE;%');

  -- The unapprovable-with-no-binding arm is a real branch of the guard that this schema's
  -- client path cannot produce (B7b shows the review edge always writes a digest). It is
  -- asserted as a property of the shipped body, because a future migration that removed the
  -- arm would silently re-open "approve a review that was never bound to anything", and no
  -- behavioural test in this file could notice.
  PERFORM pg_temp.s5_ok('B15 the guard still contains the arm that refuses to approve a release '
    'whose review predates bindings, so the one row this file cannot reach is still a rule rather '
    'than a memory',
    (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private'
        AND p.proname = 'guard_tradition_pack_release')
      LIKE '%was reviewed before review material was bound%');

  PERFORM pg_temp.s5_eq('B16 and the pack this group worked on holds six of the seven releases it '
    'created — the seventh was a draft it deleted again — so the numbers above are about rows '
    'that exist rather than about a running total',
    (SELECT count(*) FROM public.tradition_pack_releases WHERE pack_id = v_pack), 6::bigint);
END $B$;

-- ==================================== S. the maintenance surface, walked one step at a time
-- Group B moved a row with plain SQL as the maintenance identity. This group moves one with
-- the functions the Stage 5 CLI will call, because §F's rule is that a human operator must be
-- able to do the whole job without writing an UPDATE — and a lifecycle that only works when
-- somebody types SQL correctly is not a maintenance surface, it is a schema with a secret.
--
-- Every refusal below is paired with the legal step beside it, which is what makes the refusal
-- mean something: an author that refuses everything would pass twenty assertions of this shape.
DO $S$
DECLARE v_pack uuid; v_rel1 uuid; v_rel2 uuid; v_rel3 uuid; v_maint uuid;
        v_new_pack uuid; v_new uuid; v_pkt jsonb; v_res jsonb;
        v_hash_pre text; v_hash_now text; v_fp_pre text;
        v_err text; v_states text[]; v_codes text[]; v_secs text[];
        v_unknown uuid := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
  PERFORM pg_temp.s5_is_superuser('S0 the maintenance group runs as the identity §F''s CLI '
    'connects as, because no browser role may reach any function in this group');
  SELECT pack_a, rel_1, rel_2, rel_3, maintainer
    INTO v_pack, v_rel1, v_rel2, v_rel3, v_maint FROM sf;

  -- ----------------------------------------------------------------------- the two reports
  SELECT coalesce(array_agg(x.state ORDER BY x.state COLLATE "C"), '{}'::text[]) INTO v_states
    FROM (SELECT (r ->> 'release_number') || '=' || (r ->> 'status') AS state
            FROM (SELECT p -> 'releases' AS rels
                    FROM jsonb_array_elements(
                           internal_api.tradition_pack_catalog() -> 'packs') p
                   WHERE p ->> 'pack_key' = 'stage5_binding') b,
                 jsonb_array_elements(b.rels) r) x;
  PERFORM pg_temp.s5_eq('S1 the catalog reports this pack''s six surviving releases in the '
    'states they are actually in, including the one group B retired, the one it walked to '
    'deprecated while testing the digest pin, and the one it deleted ('
    || array_to_string(v_states, ', ') || ')',
    v_states,
    ARRAY['1=deprecated', '2=draft', '3=draft', '4=draft', '5=reviewed', '7=deprecated']);

  v_res := internal_api.inspect_tradition_pack_release(v_rel3);
  PERFORM pg_temp.s5_jq('S2 inspect reports a draft as carrying no binding and its binding as '
    'not current — a draft has no recorded digest, so "the stored value describes the material" '
    'is false rather than vacuously true, and the one legal step is named beside it',
    jsonb_build_object('binding_current', v_res -> 'binding_current',
                       'hash_recorded', v_res -> 'hash_recorded',
                       'transitions_available', v_res -> 'transitions_available'),
    jsonb_build_object('binding_current', false, 'hash_recorded', false,
                       'transitions_available', '["reviewed"]'::jsonb));

  v_err := pg_temp.s5_err('SELECT internal_api.inspect_tradition_pack_release('
    || quote_literal(v_unknown::text) || '::uuid)');
  PERFORM pg_temp.s5_ok('S3 and inspecting a release that is not in the catalogue is refused by '
    'name rather than answered with an empty object, because an empty object would read as '
    '"nothing is bound" (' || v_err || ')',
    v_err LIKE 'P0001%no release %is in the catalogue%');

  -- ---------------------------------------------------------------------- creating a concept
  v_err := pg_temp.s5_err('SELECT internal_api.create_tradition_pack(''stage5_binding'', '
    || '''TEST ONLY — duplicate'', ''TEST ONLY — a second attempt at a concept that exists.'')');
  PERFORM pg_temp.s5_ok('S4 a pack concept is never reused, so a typo cannot silently create a '
    'second Tamil-ish thing beside the real one (' || v_err || ')',
    v_err LIKE '23505%already exists%');

  v_err := pg_temp.s5_err('SELECT internal_api.create_tradition_pack(''Stage5 Bad Key'', '
    || '''TEST ONLY — bad slug'', ''TEST ONLY — a scope statement long enough to pass.'')');
  PERFORM pg_temp.s5_ok('S5 a pack key has to be a lower_snake slug, which is the difference '
    'between an identifier and a display string (' || v_err || ')',
    v_err LIKE '23514%lower_snake slug%');

  v_err := pg_temp.s5_err('SELECT internal_api.create_tradition_pack(''stage5_short_scope'', '
    || '''TEST ONLY — too short'', ''claims nothing'')');
  PERFORM pg_temp.s5_ok('S6 and a pack cannot be created without saying what it does not claim, '
    'because the scope statement is the one field a reader uses to decide whether this content '
    'speaks for anybody (' || v_err || ')',
    v_err LIKE '23514%at least 20%');

  v_res := internal_api.create_tradition_pack('stage5_created',
    'TEST ONLY — Stage 5 created by the surface',
    'TEST ONLY — a pack created through the maintenance surface during qualification. It holds '
    'no approved release, claims no tradition, and is never shipped to a customer.');
  v_new_pack := (v_res ->> 'pack_id')::uuid;
  PERFORM pg_temp.s5_jq('S7 the valid call works, and says so in terms a reader can act on: the '
    'concept exists and has no content yet',
    jsonb_build_object('created', v_res -> 'created', 'has_content', v_res -> 'has_content',
                       'pack_key', v_res -> 'pack_key'),
    jsonb_build_object('created', true, 'has_content', false,
                       'pack_key', '"stage5_created"'::jsonb));

  -- --------------------------------------------------------------------- creating a release
  v_err := pg_temp.s5_err('SELECT internal_api.create_tradition_pack_release(''stage5_no_such'', '
    || '''{}''::jsonb, 2, ''{en,ta}''::text[], ''TEST ONLY — author'', true, '
    || '''TEST ONLY — drafted by a model and checked for shape only.'', '
    || '''TEST ONLY — none'', ''Draft under a pack that does not exist'')');
  PERFORM pg_temp.s5_ok('S8 a release cannot be authored under a pack concept that was never '
    'created, so the catalogue cannot acquire orphan wording (' || v_err || ')',
    v_err LIKE 'P0001%create the concept before a release%');

  v_res := internal_api.create_tradition_pack_release('stage5_created', pg_temp.s5_def(), 2,
    ARRAY['en', 'ta'], 'TEST ONLY — synthetic authored fixture', true,
    'TEST ONLY — drafted by a model from product structure and checked for shape and '
    || 'language coverage. No human reader of Tamil reviewed any string in this release.',
    'TEST ONLY — no external source', 'First release of the created pack');
  v_new := (v_res ->> 'release_id')::uuid;
  PERFORM pg_temp.s5_eq('S8b and the pack this file created through the surface now holds '
    'exactly one release',
    (SELECT count(*) FROM public.tradition_pack_releases r
      JOIN public.tradition_packs p ON p.id = r.pack_id
     WHERE p.pack_key = 'stage5_created'), 1::bigint);
  PERFORM pg_temp.s5_jq('S9 the surface numbered it itself, born it as a draft, and stored no '
    'digest — status is not an argument a caller can pass, which is what makes "create this '
    'already approved" inexpressible rather than merely refused',
    jsonb_build_object('release_number', v_res -> 'release_number',
                       'status', v_res -> 'status',
                       'review_packet_hash', v_res -> 'review_packet_hash',
                       'transition', v_res -> 'transition'),
    jsonb_build_object('release_number', 1, 'status', '"draft"'::jsonb,
                       'review_packet_hash', null,
                       'transition', '"(none — created as draft)"'::jsonb));
  PERFORM set_config('s5.rel_new', v_new::text, false);

  -- ------------------------------------------------------------------------- editing a draft
  v_err := pg_temp.s5_err('SELECT internal_api.update_draft_tradition_pack_release('
    || quote_literal(v_new::text) || '::uuid, ''[]''::jsonb)');
  PERFORM pg_temp.s5_ok('S10 a patch has to be an object of the fields to change (' || v_err || ')',
    v_err LIKE '23514%must be a JSON object%');

  v_err := pg_temp.s5_err('SELECT internal_api.update_draft_tradition_pack_release('
    || quote_literal(v_new::text) || '::uuid, ''{"defenition": {}}''::jsonb)');
  PERFORM pg_temp.s5_ok('S11 a misspelled field is refused by name instead of reported as '
    'success, because an author who believes the wording was fixed is worse off than one who was '
    'told it was not (' || v_err || ')',
    v_err LIKE '23514%defenition%');

  v_err := pg_temp.s5_err('SELECT internal_api.update_draft_tradition_pack_release('
    || quote_literal(v_new::text) || '::uuid, ''{"status": "approved"}''::jsonb)');
  PERFORM pg_temp.s5_ok('S11b and promotion cannot be smuggled into a content patch: status is '
    'outside the editable set, so "approve this while I am here" is not expressible at all ('
    || v_err || ')', v_err LIKE '23514%does not have: status%');

  v_err := pg_temp.s5_err('SELECT internal_api.update_draft_tradition_pack_release('
    || quote_literal(v_rel1::text) || '::uuid, ''{"changelog": "reopen the retired one"}''::jsonb)');
  PERFORM pg_temp.s5_ok('S12 a release that has left draft cannot be edited through this '
    'surface either, and the refusal is about the lifecycle rather than the caller ('
    || v_err || ')', v_err LIKE '23514%is not edited%');

  v_hash_pre := pg_temp.s5_hash_of(v_new);
  v_err := pg_temp.s5_err('SELECT internal_api.update_draft_tradition_pack_release('
    || quote_literal(v_new::text) || '::uuid, ''{"changelog": "One legitimate draft edit."}''::jsonb)');
  PERFORM pg_temp.s5_eq('S13 the legal patch goes through, which is the control that keeps every '
    'refusal above from being "this surface refuses everything" (' || v_err || ')',
    v_err, 'no-error');
  PERFORM pg_temp.s5_ok('S13a and the patch reports that something changed, from the row rather '
    'than from the caller''s intent',
    (internal_api.update_draft_tradition_pack_release(v_new,
       '{"source_reference": "TEST ONLY — no external source, restated"}'::jsonb)
       ->> 'changed')::boolean);
  PERFORM pg_temp.s5_ok('S13b and a draft edit moves the digest a future review will be bound '
    'to, while the row itself still records none',
    pg_temp.s5_hash_of(v_new) <> v_hash_pre
    AND (SELECT review_packet_hash FROM public.tradition_pack_releases WHERE id = v_new) IS NULL);

  -- --------------------------------------------------------------------- the packet itself
  v_pkt := internal_api.get_tradition_pack_review_packet(v_new);
  PERFORM pg_temp.s5_eq('S14 the packet a reviewer is shown carries the digest the row does not '
    'yet carry, and says plainly that nothing has been recorded',
    jsonb_build_object('printed', v_pkt -> 'review_packet_hash',
                       'recorded', v_pkt -> 'review_packet_hash_recorded'),
    jsonb_build_object('printed', to_jsonb(pg_temp.s5_hash_of(v_new)), 'recorded', 'null'::jsonb));
  v_hash_now := (v_pkt ->> 'review_packet_hash');

  -- --------------------------------------------------------------- submitting a review
  v_err := pg_temp.s5_err('SELECT internal_api.submit_tradition_pack_review('
    || quote_literal(v_new::text) || '::uuid, ''approve'', ''TEST ONLY — label'', '
    || '''TEST ONLY — a basis long enough to be accepted by the row constraint'', '
    || '''TEST ONLY — a scope long enough to pass too'', ''{en,ta}''::text[], '
    || quote_literal(v_hash_now) || ')');
  PERFORM pg_temp.s5_ok('S15 a decision is one of three named answers, and "approve" is not one '
    'of them — the review surface cannot be used to skip the approval step (' || v_err || ')',
    v_err LIKE '23514%a review decision is accept%');

  v_err := pg_temp.s5_err('SELECT internal_api.submit_tradition_pack_review('
    || quote_literal(v_new::text) || '::uuid, ''accept'', ''TEST ONLY — label'', '
    || '''TEST ONLY — a basis long enough to be accepted by the row constraint'', '
    || '''TEST ONLY — a scope long enough to pass too'', ''{en,ta}''::text[], NULL)');
  PERFORM pg_temp.s5_ok('S16 a review submitted without a digest is refused before the row is '
    'read, because a review that names no bytes vouches for nothing (' || v_err || ')',
    v_err LIKE '23514%cannot be accepted without one%');

  v_err := pg_temp.s5_err('SELECT internal_api.submit_tradition_pack_review('
    || quote_literal(v_new::text) || '::uuid, ''accept'', ''TEST ONLY — label'', '
    || '''TEST ONLY — a basis long enough to be accepted by the row constraint'', '
    || '''TEST ONLY — a scope long enough to pass too'', ''{en,ta}''::text[], ''abc123'')');
  PERFORM pg_temp.s5_ok('S17 and a digest that is not a SHA-256 is refused in the same place, so '
    'a truncated copy-paste from a terminal cannot become a review record (' || v_err || ')',
    v_err LIKE '23514%64-character%');

  -- The fingerprint is taken immediately before the refused statement, not at the top of the
  -- group: the two legitimate draft edits above are *supposed* to move it, and "nothing was
  -- written" is a claim about this one statement.
  v_fp_pre := pg_temp.s5_fingerprint(v_new);
  v_err := pg_temp.s5_err('SELECT internal_api.submit_tradition_pack_review('
    || quote_literal(v_new::text) || '::uuid, ''accept'', ''TEST ONLY — label'', '
    || '''TEST ONLY — a basis long enough to be accepted by the row constraint'', '
    || '''TEST ONLY — a scope long enough to pass too'', ''{en,ta}''::text[], '
    || quote_literal(v_hash_pre) || ')');
  PERFORM pg_temp.s5_ok('S18 §E''s central case: submitting against the digest printed *before* '
    'the draft moved is refused, and the refusal names both digests so the operator can see which '
    'is which (' || v_err || ')',
    v_err LIKE '23514%digests to%');

  PERFORM pg_temp.s5_eq('S18a and the refusal wrote nothing — the release is still a draft with '
    'no recorded binding',
    pg_temp.s5_fingerprint(v_new), v_fp_pre);

  v_res := internal_api.submit_tradition_pack_review(v_new, 'reject',
    'TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW',
    'Automated Stage 5 database qualification only. No human cultural authority, no '
    || 'religious standing and no native-speaker language competence is claimed by, or behind, '
    || 'this record.',
    'TEST ONLY — order, kinds, override rules and coverage read; no ritual or religious '
    || 'content is present to review.',
    ARRAY['en', 'ta'], v_hash_now);
  PERFORM pg_temp.s5_jq('S19 a rejection is not a lifecycle state: the release stays a draft, '
    'invisible to customers, and the packet the reviewer returned is the artefact that says why',
    jsonb_build_object('recorded', v_res -> 'recorded',
                       'status_after', v_res -> 'status_after',
                       'status_now', to_jsonb((SELECT status FROM public.tradition_pack_releases
                                                WHERE id = v_new))),
    jsonb_build_object('recorded', false, 'status_after', '"draft"'::jsonb,
                       'status_now', '"draft"'::jsonb));

  v_res := internal_api.submit_tradition_pack_review(v_new, 'accept',
    'TEST FIXTURE REVIEWER — NOT A REAL CULTURAL REVIEW',
    'Automated Stage 5 database qualification only. No human cultural authority, no '
    || 'religious standing and no native-speaker language competence is claimed by, or behind, '
    || 'this record.',
    'TEST ONLY — order, kinds, override rules and coverage read; no ritual or religious '
    || 'content is present to review.',
    ARRAY['en', 'ta'], v_hash_now);
  PERFORM pg_temp.s5_eq('S20 and the same call with a decision of accept binds the digest the '
    'packet printed to the row, through the guard rather than around it',
    (v_res ->> 'review_packet_hash'), (SELECT review_packet_hash
                                         FROM public.tradition_pack_releases WHERE id = v_new));
  PERFORM pg_temp.s5_eq('S20a the recorded digest is the one the packet showed before any of '
    'this happened, so what was reviewed and what was bound are the same bytes',
    (SELECT review_packet_hash FROM public.tradition_pack_releases WHERE id = v_new),
    v_hash_now);

  v_err := pg_temp.s5_err('SELECT internal_api.submit_tradition_pack_review('
    || quote_literal(v_new::text) || '::uuid, ''accept'', ''TEST ONLY — label'', '
    || '''TEST ONLY — a basis long enough to be accepted by the row constraint'', '
    || '''TEST ONLY — a scope long enough to pass too'', ''{en,ta}''::text[], '
    || quote_literal(v_hash_now) || ')');
  PERFORM pg_temp.s5_ok('S21 a second review cannot be submitted over the first, so a reviewer '
    'cannot be added to a record that already names one (' || v_err || ')',
    v_err LIKE '23514%already reviewed%');

  v_err := pg_temp.s5_err('SELECT internal_api.approve_tradition_pack_release('
    || quote_literal(v_new::text) || '::uuid, '''
    || '1111111111111111111111111111111111111111111111111111111111111111'' )');
  PERFORM pg_temp.s5_ok('S22 approval against a digest that is not the one the review recorded '
    'is refused, and the release stays reviewed rather than being re-stamped to suit the '
    'caller (' || v_err || ')', v_err LIKE '23514%');
  PERFORM pg_temp.s5_eq('S22a and it really is still reviewed, with its binding untouched',
    (SELECT status || '|' || coalesce(review_packet_hash, 'none')
       FROM public.tradition_pack_releases WHERE id = v_new),
    'reviewed|' || v_hash_now);

  v_res := internal_api.approve_tradition_pack_release(v_new, v_hash_now);
  PERFORM pg_temp.s5_jq('S23 approving against the recorded digest is the step that makes a '
    'release selectable, and the surface says so in the same breath',
    jsonb_build_object('transition', v_res -> 'transition',
                       'customer_selectable', v_res -> 'customer_selectable',
                       'hash', v_res -> 'review_packet_hash'),
    jsonb_build_object('transition', '"reviewed -> approved"'::jsonb,
                       'customer_selectable', true,
                       'hash', to_jsonb(v_hash_now)));

  v_err := pg_temp.s5_err('SELECT internal_api.deprecate_tradition_pack_release('
    || quote_literal(v_rel2::text) || '::uuid)');
  PERFORM pg_temp.s5_ok('S24 a draft cannot be retired, because retirement is a statement about '
    'content that was offered and is no longer — and nothing here was ever offered ('
    || v_err || ')', v_err LIKE '23514%only an approved release can be retired%');

  -- ------------------------------------------------------------------- the two questions asked
  v_res := internal_api.validate_tradition_pack_release(v_new);
  SELECT coalesce(array_agg(l ->> 'language' ORDER BY l ->> 'language' COLLATE "C"), '{}'::text[])
    INTO v_codes
    FROM jsonb_array_elements(v_res -> 'per_language') l;
  PERFORM pg_temp.s5_eq('S25 validate answers for every language the release declares, which is '
    'the only form of "would this ship?" worth asking before a host is involved',
    v_codes, ARRAY['en', 'ta']);

  SELECT coalesce(array_agg(q ORDER BY q COLLATE "C"), '{}'::text[]) INTO v_secs
    FROM (SELECT (i ->> 'code') || '|' || (i ->> 'section_key') || '|' || (i ->> 'blocking')
            FROM jsonb_array_elements(v_res -> 'per_language') l,
                 jsonb_array_elements(l -> 'issues') i) x(q);
  PERFORM pg_temp.s5_eq('S26 and for a host who has written nothing, this release refuses to '
    'freeze for exactly the two required lists it declares, both blocking, and for nothing else '
    '— the reviewed prose sections arrive from the pack, so they are satisfied by the release '
    'itself (' || array_to_string(v_secs, ' ; ') || ')',
    v_secs, ARRAY['required_list_empty|ceremonies|true', 'required_list_empty|ceremonies|true',
                  'required_list_empty|family|true', 'required_list_empty|family|true']);

  -- ------------------------------------------------------------------------- the retention view
  SELECT coalesce(array_agg(z.q ORDER BY z.q COLLATE "C"), '{}'::text[]) INTO v_secs
    FROM (SELECT (x ->> 'release_number') || '=' || (x ->> 'status')
                 || ',can_deprecate=' || (x ->> 'can_deprecate')
                 || ',can_delete=' || (x ->> 'can_delete') AS q
            FROM jsonb_array_elements(internal_api.tradition_pack_retention_report()
                                      -> 'releases') x
           WHERE x ->> 'pack_key' IN ('stage5_binding', 'stage5_created')) z;
  PERFORM pg_temp.s5_eq('S27 the retention report states, per release, what can still be done '
    'with it — deprecate only for the approved one, delete only for the drafts — which is §F''s '
    'rule that the tool must say what it will do before it does it ('
    || array_to_string(v_secs, ' ; ') || ')',
    v_secs,
    ARRAY['1=approved,can_deprecate=true,can_delete=false',
          '1=deprecated,can_deprecate=false,can_delete=false',
          '2=draft,can_deprecate=false,can_delete=true',
          '3=draft,can_deprecate=false,can_delete=true',
          '4=draft,can_deprecate=false,can_delete=true',
          '5=reviewed,can_deprecate=false,can_delete=false',
          '7=deprecated,can_deprecate=false,can_delete=false']);

  PERFORM pg_temp.s5_eq('S28 and every release it lists carries the digest question as a '
    'separate fact from the digest itself, so a row whose binding has come apart is reportable',
    (SELECT count(*) FROM jsonb_array_elements(
            internal_api.tradition_pack_retention_report() -> 'releases') x
      WHERE jsonb_typeof(x -> 'review_binding_current') <> 'boolean'), 0::bigint);
END $S$;

-- ================================================ M. who can reach any of this
-- §B's rules are mostly about reach: not in an exposed schema, no browser wrapper, no grant to
-- `anon` or `authenticated`, `service_role` only where the privilege is genuinely required.
-- Those are sentences about the migration, so each one is measured here against the catalogue
-- and against a real statement, because an ACL and a caller's experience have already differed
-- once in this repository — Stage 2's C63 records that a default-privileges revoke cannot remove
-- the implicit PUBLIC EXECUTE, so a forgotten grant is reachable even where the intent says
-- otherwise.
--
-- The eleven calls, with arguments that are valid enough to parse. The refusal happens at
-- EXECUTE, before any of them is read, so what is being measured is reach and not behaviour.
CREATE FUNCTION pg_temp.s5_maint_stmts() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ARRAY[
    'SELECT internal_api.tradition_pack_catalog()',
    'SELECT internal_api.inspect_tradition_pack_release(''00000000-0000-0000-0000-000000000000''::uuid)',
    'SELECT internal_api.create_tradition_pack(''x'', ''y'', ''z'')',
    'SELECT internal_api.create_tradition_pack_release(''x'', ''{}''::jsonb, 2, '
      || '''{en}''::text[], ''author'', false, NULL, NULL, NULL)',
    'SELECT internal_api.update_draft_tradition_pack_release('
      || '''00000000-0000-0000-0000-000000000000''::uuid, ''{}''::jsonb)',
    'SELECT internal_api.get_tradition_pack_review_packet('
      || '''00000000-0000-0000-0000-000000000000''::uuid)',
    'SELECT internal_api.submit_tradition_pack_review('
      || '''00000000-0000-0000-0000-000000000000''::uuid, ''accept'', ''l'', ''b'', ''s'', '
      || '''{en}''::text[], ''h'')',
    'SELECT internal_api.approve_tradition_pack_release('
      || '''00000000-0000-0000-0000-000000000000''::uuid, ''h'')',
    'SELECT internal_api.deprecate_tradition_pack_release('
      || '''00000000-0000-0000-0000-000000000000''::uuid)',
    'SELECT internal_api.validate_tradition_pack_release('
      || '''00000000-0000-0000-0000-000000000000''::uuid)',
    'SELECT internal_api.tradition_pack_retention_report()'
  ] $fn$;

-- The eleven names, spelled once, so M1 and M5 cannot disagree about what the surface is.
CREATE FUNCTION pg_temp.s5_maint_names() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT ARRAY[
    'approve_tradition_pack_release', 'create_tradition_pack',
    'create_tradition_pack_release', 'deprecate_tradition_pack_release',
    'get_tradition_pack_review_packet', 'inspect_tradition_pack_release',
    'submit_tradition_pack_review', 'tradition_pack_catalog',
    'tradition_pack_retention_report', 'update_draft_tradition_pack_release',
    'validate_tradition_pack_release'] $fn$;

DO $M$
DECLARE v_rel4 uuid; v_maint uuid; v_new uuid;
        v_names text[]; v_bad text[]; v_n bigint; v_err text;
BEGIN
  PERFORM pg_temp.s5_is_superuser('M0 the privilege group reads the catalogue as the '
    'maintenance identity, then issues each probe statement as the role it is about');
  SELECT rel_4, maintainer INTO v_rel4, v_maint FROM sf;
  v_new := current_setting('s5.rel_new')::uuid;

  -- ------------------------------------------------------------- the surface, named
  SELECT coalesce(array_agg(p.proname ORDER BY p.proname COLLATE "C"), '{}'::text[]) INTO v_names
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'internal_api'
     AND p.proname = ANY (pg_temp.s5_maint_names());
  PERFORM pg_temp.s5_eq('M1 the maintenance surface is exactly these eleven names in '
    'internal_api, so a twelfth privileged function would be reported by this line before it '
    'was ever reached by a caller', v_names, pg_temp.s5_maint_names());

  -- ---------------------------------------------------------- refused by every client role
  -- One assertion per role rather than one for all three: `anon`, `authenticated` and
  -- `service_role` are refused by different rules, and a single combined claim could pass while
  -- one of the three had drifted. `service_role` matters most, because it is the role that a
  -- leaked server key hands to whoever holds it.
  SELECT coalesce(array_agg(z.q ORDER BY z.q COLLATE "C"), '{}'::text[]) INTO v_bad
    FROM (SELECT split_part(y.o, ' ', 1) AS code,
                 split_part(y.s, 'internal_api.', 2) || ' -> ' || split_part(y.o, ' ', 1) AS q
            FROM (SELECT s, pg_temp.s5_as('anon', s) AS o
                    FROM unnest(pg_temp.s5_maint_stmts()) s) y) z
   WHERE z.code <> '42501';
  SELECT count(*) INTO v_n FROM unnest(pg_temp.s5_maint_stmts()) s;
  PERFORM pg_temp.s5_ok('M2 an anonymous caller is refused all eleven, by the function rather '
    'than by an empty result (' || array_to_string(v_bad, ', ') || ')',
    v_bad = '{}'::text[] AND v_n = 11);

  SELECT coalesce(array_agg(z.q ORDER BY z.q COLLATE "C"), '{}'::text[]) INTO v_bad
    FROM (SELECT split_part(y.o, ' ', 1) AS code,
                 split_part(y.s, 'internal_api.', 2) || ' -> ' || split_part(y.o, ' ', 1) AS q
            FROM (SELECT s, pg_temp.s5_as('authenticated', s) AS o
                    FROM unnest(pg_temp.s5_maint_stmts()) s) y) z
   WHERE z.code <> '42501';
  PERFORM pg_temp.s5_ok('M3 a signed-in customer is refused all eleven too, including the '
    'create, review, approve and deprecate steps §L enumerates — a browser cannot mark its own '
    'content reviewed (' || array_to_string(v_bad, ', ') || ')', v_bad = '{}'::text[]);

  SELECT coalesce(array_agg(z.q ORDER BY z.q COLLATE "C"), '{}'::text[]) INTO v_bad
    FROM (SELECT split_part(y.o, ' ', 1) AS code,
                 split_part(y.s, 'internal_api.', 2) || ' -> ' || split_part(y.o, ' ', 1) AS q
            FROM (SELECT s, pg_temp.s5_as('service_role', s) AS o
                    FROM unnest(pg_temp.s5_maint_stmts()) s) y) z
   WHERE z.code <> '42501';
  PERFORM pg_temp.s5_eq('M4 and the server key is refused all eleven as well, because §B''s '
    'surface is a maintenance path rather than an application path: nothing in the product needs '
    'to approve a pack, so nothing in the product may ('
    || array_to_string(v_bad, ', ') || ')', v_bad, '{}'::text[]);

  -- ------------------------------------------------------------------ no browser wrapper
  SELECT coalesce(array_agg(p.proname ORDER BY p.proname COLLATE "C"), '{}'::text[]) INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api' AND p.proname = ANY (pg_temp.s5_maint_names());
  PERFORM pg_temp.s5_eq('M5 none of the eleven has a twin in the exposed `api` schema, so no '
    'HTTP request can name a maintenance act even by guessing the wrapper''s name',
    v_bad, '{}'::text[]);

  SELECT coalesce(array_agg(p.proname ORDER BY p.proname COLLATE "C"), '{}'::text[]) INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api';
  PERFORM pg_temp.s5_eq('M5b and the customer surface at this head is exactly the '
    || CASE WHEN pg_temp.s5_at_least('stage11') THEN 'forty-one names'
            WHEN pg_temp.s5_at_least('stage10') THEN 'twenty-two names'
            WHEN pg_temp.s5_at_least('stage9') THEN 'twenty-one names'
            WHEN pg_temp.s5_at_least('stage8') THEN 'nineteen names'
            WHEN pg_temp.s5_at_least('stage7') THEN 'thirteen names' ELSE 'eight names' END
    || ' it is meant to expose — Stage 4 shipped the seven pack-and-publication verbs, Stage 5 adds '
    || 'the document preview, and from Stage 7 the host''s three review verbs and the reviewer''s '
    || 'open and answer doors add five more'
    -- The label has to add up to the array it names: at the Stage 7 head that was 7 + 1 + 5 =
    -- thirteen, and Stage 8 appends six names rather than revising any of them. All six arrive as a
    -- pair — an invoker wrapper over a definer body — so the twin-less maintenance half M1
    -- enumerates stays at eleven and M5 stays empty. The clause is head-aware, and the sentence
    -- above is left exactly as the Stage 7 head measured it.
    --
    -- Stage 9 appends two more on the same pair pattern, so nineteen becomes twenty-one and M5 is
    -- still empty: both new names are reads of already-frozen or already-recorded state, neither is
    -- a maintenance act, and neither has a twin-less body behind it.
    || CASE WHEN pg_temp.s5_at_least('stage11') THEN
              ', from Stage 8 the four household verbs a host calls — issue, revoke, rotate, '
              || 'read the link state — plus the two doors a guest walks through, to read its own '
              || 'invitation and to answer it, add six more, from Stage 9 the two reads a render '
              || 'worker and a host panel need — the output manifest and one frozen version''s own '
              || 'document — add two more, from Stage 10 the one read a host needs to see the '
              || 'quote it was given adds the twenty-second. Stage 10''s other six commerce names are '
              || 'not on this list by design: an order, a payment event, an entitlement grant or a '
              || 'reconciliation finding that a browser could call would be a customer deciding their '
              || 'own paid status, which is the exact thing M5 and the Stage 2 attack battery exist to '
              || 'refuse. Stage 11 slice 2 adds ten support doors on a different ruling — four a host '
              || 'may knock on and six whose bodies re-read the caller''s `operator_grants` row and '
              || 'refuse anyone else with `insufficient_privilege`, so the grant is deliberately not '
              || 'the authority on that surface — and slice 3 adds four privacy names: the host''s '
              || 'file-and-read pair and the operator desk''s queue-and-advance pair, all four as '
              || 'wrappers over `internal_api` bodies. Slice 4 adds four more on the same wrapper-over-body '
              || 'shape: the finance desk''s queue-and-note pair and the takedown plan-and-publication pair. '
              || 'The fifth body that slice writes has no name here, and that absence is the ruling rather '
              || 'than an omission — `operator_purge_publication_objects` is the plan in front of removing '
              || 'the rendered objects behind a publication (the body deletes nothing; §6 hands the delete '
              || 'to the CLI''s Storage call), §10 keeps that step off the browser surface entirely, and '
              || 'this assertion enumerates the surface by name rather than by count, so a wrapper added '
              || 'for it later fails here rather than passing a total. Slice 5 adds the forty-first and '
              || 'last name — `operator_operations_summary`, the health read a console points at over '
              || 'HTTP — and it is an ordinary wrapper over a body, so this surface moves by one and '
              || 'M5''s twin-less half stays as §B left it'
            WHEN pg_temp.s5_at_least('stage10') THEN
              ', from Stage 8 the four household verbs a host calls — issue, revoke, rotate, '
              || 'read the link state — plus the two doors a guest walks through, to read its own '
              || 'invitation and to answer it, add six more, from Stage 9 the two reads a render '
              || 'worker and a host panel need — the output manifest and one frozen version''s own '
              || 'document — add two more, and from Stage 10 the one read a host needs to see the '
              || 'quote it was given adds the twenty-second. Stage 10''s other six commerce names are '
              || 'not on this list by design: an order, a payment event, an entitlement grant or a '
              || 'reconciliation finding that a browser could call would be a customer deciding their '
              || 'own paid status, which is the exact thing M5 and the Stage 2 attack battery exist to '
              || 'refuse'
            WHEN pg_temp.s5_at_least('stage9') THEN
              ', from Stage 8 the four household verbs a host calls — issue, revoke, rotate, '
              || 'read the link state — plus the two doors a guest walks through, to read its own '
              || 'invitation and to answer it, add six more, and from Stage 9 the two reads a render '
              || 'worker and a host panel need — the output manifest and one frozen version''s own '
              || 'document — add two more'
            WHEN pg_temp.s5_at_least('stage8') THEN
              ', and from Stage 8 the four household verbs a host calls — issue, revoke, rotate, '
              || 'read the link state — plus the two doors a guest walks through, to read its own '
              || 'invitation and to answer it, add six more'
            ELSE '' END
    || ', all of them wrappers over `internal_api` bodies — '
    || 'which is the shape §B asked for: '
    || 'the privileged half of the new pair is reachable by nested call and by nothing else',
    v_bad,
    CASE WHEN pg_temp.s5_at_least('stage11') THEN
      ARRAY['commerce_host_summary', 'create_invitation_version', 'create_privacy_request',
            'get_approval_requests', 'get_guest_invitation_state',
            'get_invitation_publication_state', 'get_my_privacy_requests',
            'get_my_support_case', 'get_my_support_cases', 'get_operator_case',
            'issue_guest_invitations', 'list_invitation_outputs', 'open_support_case',
            'operator_add_case_note', 'operator_add_commerce_review_note',
            'operator_advance_privacy_request',
            'operator_case_queue', 'operator_claim_case', 'operator_commerce_review_queue',
            'operator_operations_summary',
            'operator_privacy_queue', 'operator_release_case', 'operator_takedown_plan',
            'operator_takedown_publication', 'operator_transition_case', 'preview_invitation',
            'preview_invitation_document', 'publish_invitation_version',
            'render_invitation_document', 'reply_to_support_case',
            'request_family_review', 'resolve_family_review',
            'resolve_guest_invitation', 'resolve_public_invitation',
            'revoke_family_review', 'revoke_guest_invitation',
            'revoke_invitation_publication', 'rotate_guest_invitation',
            'rotate_invitation_token', 'submit_family_review',
            'submit_guest_rsvp']::text[]
    WHEN pg_temp.s5_at_least('stage10') THEN
      ARRAY['commerce_host_summary', 'create_invitation_version', 'get_approval_requests',
            'get_guest_invitation_state', 'get_invitation_publication_state',
            'issue_guest_invitations', 'list_invitation_outputs', 'preview_invitation',
            'preview_invitation_document', 'publish_invitation_version',
            'render_invitation_document',
            'request_family_review', 'resolve_family_review',
            'resolve_guest_invitation', 'resolve_public_invitation',
            'revoke_family_review', 'revoke_guest_invitation',
            'revoke_invitation_publication', 'rotate_guest_invitation',
            'rotate_invitation_token', 'submit_family_review',
            'submit_guest_rsvp']::text[]
    WHEN pg_temp.s5_at_least('stage9') THEN
      ARRAY['create_invitation_version', 'get_approval_requests',
            'get_guest_invitation_state', 'get_invitation_publication_state',
            'issue_guest_invitations', 'list_invitation_outputs', 'preview_invitation',
            'preview_invitation_document', 'publish_invitation_version',
            'render_invitation_document',
            'request_family_review', 'resolve_family_review',
            'resolve_guest_invitation', 'resolve_public_invitation',
            'revoke_family_review', 'revoke_guest_invitation',
            'revoke_invitation_publication', 'rotate_guest_invitation',
            'rotate_invitation_token', 'submit_family_review',
            'submit_guest_rsvp']::text[]
    WHEN pg_temp.s5_at_least('stage8') THEN
      ARRAY['create_invitation_version', 'get_approval_requests',
            'get_guest_invitation_state', 'get_invitation_publication_state',
            'issue_guest_invitations', 'preview_invitation', 'preview_invitation_document',
            'publish_invitation_version', 'request_family_review', 'resolve_family_review',
            'resolve_guest_invitation', 'resolve_public_invitation',
            'revoke_family_review', 'revoke_guest_invitation',
            'revoke_invitation_publication', 'rotate_guest_invitation',
            'rotate_invitation_token', 'submit_family_review',
            'submit_guest_rsvp']::text[]
    WHEN pg_temp.s5_at_least('stage7') THEN
      ARRAY['create_invitation_version', 'get_approval_requests',
            'get_invitation_publication_state', 'preview_invitation',
            'preview_invitation_document', 'publish_invitation_version',
            'request_family_review', 'resolve_family_review', 'resolve_public_invitation',
            'revoke_family_review', 'revoke_invitation_publication',
            'rotate_invitation_token', 'submit_family_review']::text[]
    ELSE
      ARRAY['create_invitation_version', 'get_invitation_publication_state',
            'preview_invitation', 'preview_invitation_document',
            'publish_invitation_version', 'resolve_public_invitation',
            'revoke_invitation_publication', 'rotate_invitation_token']::text[]
    END);

  -- ------------------------------------------------- the one grant this migration had to make
  SELECT coalesce(array_agg(p.proname ORDER BY p.proname COLLATE "C"), '{}'::text[]) INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'private'
     AND has_function_privilege('service_role', p.oid, 'EXECUTE');
  PERFORM pg_temp.s5_eq('M6 the guard''s nested call is why `service_role` holds EXECUTE on '
    'exactly these five helpers and on nothing else in `private`: the digest, the payload it is '
    'built from, and the three serialisation primitives the payload calls',
    v_bad,
    ARRAY['canonical_token', 'jsonb_canonical', 'review_field',
          'tradition_pack_review_hash', 'tradition_pack_review_payload']);

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'private'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  PERFORM pg_temp.s5_eq('M6b and no browser role holds EXECUTE on any function in `private` at '
    'all, so the grant above widened the trusted backend and not the customer', v_n, 0::bigint);

  v_err := pg_temp.s5_as('anon', 'SELECT private.jsonb_canonical(''{}''::jsonb)');
  PERFORM pg_temp.s5_ok('M6c and the refusal is measured as the caller experiences it, which is '
    'the schema rather than the function — a role with no USAGE cannot even name the helper that '
    'hashes a review (' || v_err || ')',
    v_err LIKE '42501%permission denied for schema private%');

  -- ---------------------------------------------------------- the privilege model unchanged
  SELECT coalesce(array_agg(p.proname ORDER BY p.proname COLLATE "C"), '{}'::text[]) INTO v_bad
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal AND p.prosecdef
     AND c.relname IN ('tradition_packs', 'tradition_pack_releases');
  PERFORM pg_temp.s5_eq('M7 no trigger on the pack tables became SECURITY DEFINER on the way '
    'through, which is the restatement of Stage 2''s C32b at this head: a guard that decided '
    'against the owner''s view of the schema would turn "this release is not approved" into '
    '"this release is invisible to you", and only the second is a secret ('
    || array_to_string(v_bad, ', ') || ')', v_bad, '{}'::text[]);

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'internal_api' AND p.prosecdef
     AND p.proname = ANY (pg_temp.s5_maint_names());
  PERFORM pg_temp.s5_eq('M7b and not one of the eleven maintenance functions is SECURITY '
    'DEFINER: every step they take is one the calling identity could already perform on the row, '
    'so the schema-qualified, empty-search-path, invoker form is the whole privilege model',
    v_n, 0::bigint);

  v_err := pg_temp.s5_as('service_role', 'SELECT private.reject_client_write()');
  PERFORM pg_temp.s5_ok('M8 and the write guard is still not executable by the server key, so '
    'the five grants in M6 are a named set rather than a door into `private` — Stage 2''s C69, '
    'restated at the Stage 5 head (' || v_err || ')',
    v_err LIKE '42501%permission denied for function reject_client_write%');

  -- ---------------------------------------------------------------- the grant, in use
  v_err := pg_temp.s5_as('service_role', pg_temp.s5_review_stmt(v_rel4, v_maint));
  PERFORM pg_temp.s5_eq('M9 the grant exists for this statement: the trusted backend moves a '
    'release from draft to reviewed, and the guard computes its digest inside the trigger as the '
    'role that issued the write (' || v_err || ')', v_err, 'no-error');
  PERFORM pg_temp.s5_ok('M9a and the digest it stored is the recomputation of that row''s own '
    'material, which is the fact that makes the grant a capability rather than a convenience',
    (SELECT review_packet_hash FROM public.tradition_pack_releases WHERE id = v_rel4)
      = pg_temp.s5_hash_of(v_rel4));

  v_err := pg_temp.s5_as('service_role',
    'UPDATE public.tradition_pack_releases SET status = ''approved'' WHERE id = '
    || quote_literal(v_rel4::text) || '::uuid');
  PERFORM pg_temp.s5_eq('M9b and the same role completes the step that re-compares the binding, '
    'so the grant did not half-work: an approval path that only functions for the table owner '
    'would be a lifecycle with a secret in it (' || v_err || ')', v_err, 'no-error');

  SELECT coalesce(array_agg(z.q ORDER BY z.q COLLATE "C"), '{}'::text[]) INTO v_bad
    FROM (SELECT p.proname AS q
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'internal_api'
             AND p.proname = ANY (pg_temp.s5_maint_names())
             AND p.proacl::text <> '{postgres=X/postgres}') z;
  PERFORM pg_temp.s5_eq('M10 every one of the eleven carries exactly one ACL entry — the '
    'owner''s — so there is no half-granted function whose EXECUTE a later migration could '
    'forget to revoke and nobody would notice (' || array_to_string(v_bad, ', ') || ')',
    v_bad, '{}'::text[]);
END $M$;

-- ================================================================= T. the ledger
-- A file that adds rows it cannot delete has to say which ones, because everything it asserted
-- about counts is then a fact about this file's own fixtures as much as about the schema. The
-- group ends by proving its own honesty scan can fail, and cleaning up the proof.
DO $T$
DECLARE v_packs bigint; v_rels bigint; v_vers bigint; v_off text[];
        v_probe_pack uuid; v_probe_rel uuid; v_err text;
BEGIN
  PERFORM pg_temp.s5_is_superuser('T0 the ledger runs as the maintenance identity');

  SELECT count(*) INTO v_packs FROM public.tradition_packs;
  SELECT count(*) INTO v_rels  FROM public.tradition_pack_releases;
  SELECT count(*) INTO v_vers  FROM public.invitation_versions;
  PERFORM pg_temp.s5_eq('T1 this file added exactly two packs to the catalogue — the one it '
    'authored three releases under and the one it created through the maintenance surface — '
    'against the entry count it measured rather than an absolute',
    v_packs - current_setting('s5.base_packs')::bigint, 2::bigint);
  PERFORM pg_temp.s5_eq('T1b and seven surviving releases, which is the six it created plus the '
    'one it walked through the guard, and the two drafts it deleted are not counted',
    v_rels - current_setting('s5.base_rels')::bigint, 7::bigint);
  PERFORM pg_temp.s5_eq('T1c and no invitation version was frozen, because a review-binding '
    'battery has no business changing what a guest reads',
    v_vers - current_setting('s5.base_vers')::bigint, 0::bigint);

  PERFORM pg_temp.s5_eq('T2 every release this file authored sits under a pack whose scope '
    'statement says TEST ONLY, so no row left behind by this suite could be read as product '
    'content by whoever opens the catalogue next',
    (SELECT count(*) FROM public.tradition_pack_releases r
       JOIN public.tradition_packs p ON p.id = r.pack_id
      WHERE p.pack_key LIKE 'stage5_%'
        AND p.scope_statement NOT LIKE 'TEST ONLY%'), 0::bigint);

  -- The catalogue-wide claim, in both suites' words. Stage 4's fixtures disclaim a human
  -- reader in one form and Stage 5's in another; what is being asserted is that neither of
  -- them claims one, which is the truth boundary the whole stage is built on. A third dialect
  -- added by a future migration would show up here as an offender by name.
  SELECT coalesce(array_agg(q ORDER BY q COLLATE "C"), '{}'::text[]) INTO v_off
    FROM (SELECT p.pack_key || '/' || r.release_number AS q
            FROM public.tradition_pack_releases r
            JOIN public.tradition_packs p ON p.id = r.pack_id
           WHERE r.review_basis IS NOT NULL
             AND r.review_basis !~ '(TEST ONLY|qualification only)') z;
  PERFORM pg_temp.s5_eq('T3 and no release anywhere in the catalogue records a review basis that '
    'claims a human cultural authority — there is still no human-reviewed customer-safe Tamil '
    'ceremonial release, and nothing in this run pretends otherwise ('
    || array_to_string(v_off, ', ') || ')', v_off, '{}'::text[]);

  PERFORM pg_temp.s5_eq('T4 and none of this file''s releases is attached to a wedding or '
    'referenced by a frozen version, so the qualification fixtures are inert with respect to '
    'every customer row',
    (SELECT count(*) FROM public.weddings w
       JOIN public.tradition_pack_releases r ON r.id = w.tradition_pack_release_id
      WHERE r.pack_id IN (SELECT id FROM public.tradition_packs WHERE pack_key LIKE 'stage5_%')),
    0::bigint);
  PERFORM pg_temp.s5_eq('T4b the same for frozen versions, which is the half that matters most, '
    'because a version pinned to a test release would be a guest reading a TEST ONLY sentence',
    (SELECT count(*) FROM public.invitation_versions v
       JOIN public.tradition_pack_releases r ON r.id = v.tradition_pack_release_id
      WHERE r.pack_id IN (SELECT id FROM public.tradition_packs WHERE pack_key LIKE 'stage5_%')),
    0::bigint);

  -- ------------------------------------------------------------- a ledger that cannot fail is
  -- decoration, so T2 and T3 are shown to be able to catch the thing they claim to catch: a
  -- pack whose scope statement reads like product content rather than a test fixture. The row
  -- is a draft, which is the one state the deletion guard lets go, and it is removed before
  -- this group returns — so nothing it could expose outlives the run.
  v_probe_pack := gen_random_uuid();
  v_probe_rel  := gen_random_uuid();
  INSERT INTO public.tradition_packs (id, pack_key, display_name, scope_statement)
    VALUES (v_probe_pack, 'stage5_ledger_probe',
            'A pack that reads like shipped content',
            'This pack endorses a tradition and speaks for a community. It is a deliberate '
            || 'violation, created inside the ledger group to prove the ledger can see one.');
  INSERT INTO public.tradition_pack_releases
    (id, pack_id, release_number, definition_schema_version, languages, definition,
     author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
    VALUES (v_probe_rel, v_probe_pack, 1, 2, ARRAY['en', 'ta'], pg_temp.s5_def(),
            'Authored by a human cultural advisor', true,
            'Drafted with a model and approved by the advisor who wrote the wording.',
            'TEST ONLY — no external source', 'The sin T2 is inventoried against');

  SELECT coalesce(array_agg(q ORDER BY q COLLATE "C"), '{}'::text[]) INTO v_off
    FROM (SELECT p.pack_key AS q
            FROM public.tradition_pack_releases r
            JOIN public.tradition_packs p ON p.id = r.pack_id
           WHERE p.pack_key LIKE 'stage5_%'
             AND p.scope_statement NOT LIKE 'TEST ONLY%') z;
  PERFORM pg_temp.s5_eq('T5 the honesty scan really does fail when a shipped-sounding pack '
    'appears, and names it (' || array_to_string(v_off, ', ') || ')',
    v_off, ARRAY['stage5_ledger_probe']);

  v_err := pg_temp.s5_err('DELETE FROM public.tradition_pack_releases WHERE id = '
    || quote_literal(v_probe_rel::text))
       || '|' || pg_temp.s5_err('DELETE FROM public.tradition_packs WHERE id = '
    || quote_literal(v_probe_pack::text));
  PERFORM pg_temp.s5_eq('T5b and the probe is removed again, as a draft is allowed to be ('
    || v_err || ')', v_err, 'no-error|no-error');

  SELECT coalesce(array_agg(q ORDER BY q COLLATE "C"), '{}'::text[]) INTO v_off
    FROM (SELECT p.pack_key AS q
            FROM public.tradition_pack_releases r
            JOIN public.tradition_packs p ON p.id = r.pack_id
           WHERE p.pack_key LIKE 'stage5_%'
             AND p.scope_statement NOT LIKE 'TEST ONLY%') z;
  PERFORM pg_temp.s5_eq('T5c and the scan is clean again, which is the state the counts in T1 '
    'were measured in', v_off, '{}'::text[]);

  PERFORM pg_temp.s5_ok('T6 the instruments are still live at the end: the counter exists, the '
    'baseline this file measured is still in the session, and the release the maintenance surface '
    'created is still the row group S asserted about',
    current_setting('s5.passed') IS NOT NULL
    AND current_setting('s5.base_packs') IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.tradition_pack_releases
                 WHERE id = current_setting('s5.rel_new')::uuid AND status = 'approved'));

  -- ---------------------------------------------------------------------- the floor
  -- The number this chain printed, not one carried over from another file. Re-measure and say
  -- so whenever an assertion is added or removed: a floor nobody re-measures stops meaning
  -- anything. Per group, counted from the PASS lines this chain printed: BASE 4, P 15, B 38,
  -- S 36, M 17, T 12, total 122. The B group is 38 rather than the 27 this comment carried while
  -- the file was still 111 long: §29's digest-forgery repair added ten controls to it (B16b, B17a,
  -- B17, B17b, B17c, B18, B18b, B18c, B19, B19b) and §33 added one more (B20), and the comment was
  -- found to have fallen behind those runs rather than the runs having shrunk. Two of those groups
  -- exist because the battery found something rather than because the directive
  -- asked for a number: the guard's v2 section whitelist omitted the two v2 keys it was written
  -- to allow, so no version-2 release could be authored at all (P and S could not get as far as
  -- their first assertion), and the digest group had to be split into the key-order and
  -- array-order cases once the measurement showed that jsonb normalises the first and cannot
  -- normalise the second.
  IF (current_setting('s5.passed'))::int < 122 THEN
    RAISE EXCEPTION 'FAIL: only % Stage 5 digest assertions ran — the measured floor is 122',
      (current_setting('s5.passed'))::int;
  END IF;
END $T$;

SELECT 'STAGE5 REVIEW-BINDING TESTS PASSED (' || current_setting('s5.passed') || ')' AS result;
