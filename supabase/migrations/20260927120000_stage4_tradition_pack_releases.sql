-- Stage 4 / file 1 — tradition-pack releases, and the governance boundary that makes
-- "reviewed content" mean something to the database rather than to a document.
--
-- The gap this file closes is measured, not inferred; `docs/audits/stage-4-tradition-pack-foundation.md`
-- §3 records the probes. In short: one table held both the concept ("a Tamil+English pack")
-- and one unaugmentable copy of its wording, so there was no way to ask what a published
-- invitation had frozen; `status` decided visibility but nothing at write time, so a
-- customer JWT could select a draft pack and a deprecated one; and an approved pack's
-- wording was editable in place by any privileged path.
--
-- The shape therefore splits in two, per directive §5's "smallest relational model that
-- enforces the governance rules":
--
--   public.tradition_packs          the concept. Slug, display name, scope statement.
--   public.tradition_pack_releases  the thing a wedding chooses: one frozen definition,
--                                   one lifecycle, one review record.
--
-- Both tables hold zero rows in every database this migration reaches (no migration has
-- ever seeded a pack — `30_migration_legacy.sql` M15 asserts that for Stage 2), so this is
-- a forward migration over an empty catalogue rather than a data move. Historical
-- migrations are not rewritten, and the columns this file replaces are dropped rather
-- than left beside their replacements: two columns meaning "the pack this wedding uses",
-- one enforced and one not, is compatibility theatre and the unenforced one is what today's
-- code writes.
--
-- ---------------------------------------------------------------------------
-- WHAT EACH MECHANISM IS FOR
--
--   table CHECKs        the shape of a row: status vocabulary, language lists, and which
--                       lifecycle states must carry which review metadata.
--   a guard trigger     the shape of a *change*: content frozen outside `draft`, only the
--                       four legal status steps, no row born `approved`, an approved
--                       release never deleted. A CHECK cannot see OLD, so this cannot be
--                       a constraint.
--   a selection trigger the difference between "visible" and "choosable": a wedding may
--                       only name an `approved` release, at the moment the reference is
--                       written. The picker hides the rest; this refuses them.
--   RLS + grants        what a browser role may read: approved releases and nothing else,
--                       and no write path at all.
--
-- Content authoring stays a privileged table write guarded by those triggers. No RPC was
-- created for it: directive §9 says not to expose maintenance functions to make tests
-- convenient, `internal_api` maintenance functions would be unreachable over HTTP anyway,
-- and every guarantee the RPC would add is already in a trigger. So the exposed `api`
-- surface stays exactly the seven publication wrappers Stage 3 qualified.

-- ===========================================================================
-- 1. `tradition_packs` BECOMES THE CONCEPT
-- ===========================================================================

-- Retired here rather than in a later cleanup so that from this statement onward the
-- status filter cannot be mistaken for the visibility rule; the rule is now a policy on
-- the release table, where the content actually lives.
DROP POLICY IF EXISTS users_read_platform_packs ON public.tradition_packs;

ALTER TABLE public.tradition_packs DROP CONSTRAINT tradition_packs_pack_key_revision_key;

ALTER TABLE public.tradition_packs
  DROP COLUMN revision,
  DROP COLUMN status,
  DROP COLUMN supported_languages,
  DROP COLUMN structure,
  DROP COLUMN reviewed_by,
  DROP COLUMN reviewed_at,
  DROP COLUMN review_notes,
  ADD COLUMN scope_statement text NOT NULL,
  ADD CONSTRAINT tradition_packs_pack_key_slug
    CHECK (pack_key ~ '^[a-z][a-z0-9]*(_[a-z0-9]*)*$'),
  -- A minimum length is deliberate: the column exists to stop a pack being read as an
  -- endorsement, and "n/a" would satisfy a non-blank check while saying nothing.
  ADD CONSTRAINT tradition_packs_scope_statement_length
    CHECK (length(btrim(scope_statement)) BETWEEN 20 AND 2000),
  ADD CONSTRAINT tradition_packs_pack_key_unique UNIQUE (pack_key);

COMMENT ON TABLE public.tradition_packs IS
  'A tradition-pack concept: slug, display name and the statement of what it claims. '
  'No content and no lifecycle; those live in tradition_pack_releases.';
COMMENT ON COLUMN public.tradition_packs.scope_statement IS
  'What this pack is for and what it does not claim. Shown beside the pack wherever it is '
  'named, so a customer reads the boundary and not only the name.';

-- ===========================================================================
-- 2. `tradition_pack_releases`: THE FROZEN DEFINITION AND ITS PROVENANCE
-- ===========================================================================

-- Reviewer facts are columns, not prose in a notes field, because directive §18 asks
-- questions of them ("which languages did this review actually cover?" has no answer
-- inside a paragraph). There is no reviewer *account* system: `reviewed_by` stays
-- available as an optional FK, and the required facts are a label and a stated basis, so
-- a reviewer who is not a customer of this product can still be credited — and so this
-- stage does not grow an approval workflow it was told not to build.
CREATE TABLE public.tradition_pack_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES public.tradition_packs(id) ON DELETE RESTRICT,
  -- Identity within the concept. A change to an approved definition is a new number,
  -- never an edit, which is what makes "which release did this guest read?" answerable.
  release_number integer NOT NULL CHECK (release_number > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'reviewed', 'approved', 'deprecated')),
  -- The version of the *contract* this definition claims to satisfy, so a future build
  -- that changes the section vocabulary can refuse to resolve an old one instead of
  -- guessing. The guard trigger accepts only version 1; see §3.
  definition_schema_version integer NOT NULL CHECK (definition_schema_version > 0),
  -- Section order, labels, reviewed wording, event vocabulary, design guidance. JSON
  -- because it is read as one document (the Stage 2 blueprint's own conclusion), and
  -- not arbitrary JSON because the guard trigger walks it key by key (§3).
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  languages text[] NOT NULL
    CHECK (cardinality(languages) > 0
           AND languages <@ ARRAY['en', 'ta', 'te', 'ml', 'kn']::text[]),
  -- Provenance: who or what authored it, whether a model was involved, and what a human
  -- said about it. `machine_assisted` is a declared fact rather than a phrase in a note
  -- because directive §7 makes it the condition for a release being publishable at all.
  author_label text NOT NULL CHECK (length(btrim(author_label)) BETWEEN 3 AND 300),
  machine_assisted boolean NOT NULL DEFAULT false,
  -- §B of the Stage 4 continuation asks that a machine-assistance declaration carry the
  -- disclosure beside it, and the two are bound by a constraint rather than by
  -- convention: `machine_assisted = true` with nothing to say about it is the same kind
  -- of hollow tick box as an approval with no review record, which is the thing §18
  -- exists to prevent. It is a *disclosure*, not a transcript: what was generated, what
  -- was checked, by what — in the author's own words.
  machine_assistance_notes text
    CHECK (machine_assistance_notes IS NULL
           OR length(btrim(machine_assistance_notes)) BETWEEN 20 AND 2000),
  -- The biconditional form, because `false` with an explanatory note is harmless while
  -- `true` without one is the lie.
  CONSTRAINT machine_assistance_disclosure_required
    CHECK (machine_assisted = false OR (
      machine_assistance_notes IS NOT NULL
      AND length(btrim(machine_assistance_notes)) >= 20)),
  source_reference text CHECK (source_reference IS NULL OR length(btrim(source_reference)) BETWEEN 3 AND 1000),
  changelog text CHECK (changelog IS NULL OR length(btrim(changelog)) BETWEEN 3 AND 4000),
  review_label text   CHECK (review_label   IS NULL OR length(btrim(review_label))   BETWEEN 3 AND 300),
  review_basis text   CHECK (review_basis   IS NULL OR length(btrim(review_basis))   BETWEEN 20 AND 2000),
  review_scope text   CHECK (review_scope   IS NULL OR length(btrim(review_scope))   BETWEEN 20 AND 2000),
  reviewed_languages text[]
    CONSTRAINT reviewed_languages_are_supported_ones
    CHECK (reviewed_languages IS NULL
           OR (cardinality(reviewed_languages) > 0
               AND reviewed_languages <@ languages)),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  approved_at timestamptz,
  deprecated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- A draft has been looked at by nobody. Enforcing the absence of metadata, not just
  -- its presence at the other end, is what stops "approved" being reachable by an edit
  -- that quietly fills in a reviewer.
  CONSTRAINT draft_carries_no_review_metadata CHECK (status <> 'draft' OR (
    review_label IS NULL AND review_basis IS NULL AND review_scope IS NULL
    AND reviewed_languages IS NULL AND reviewed_by IS NULL
    AND reviewed_at IS NULL AND approved_at IS NULL AND deprecated_at IS NULL)),
  -- These four are named rather than left to the automatic `tradition_pack_releases_checkN`
  -- because an unnamed constraint retargets itself whenever a column is added above it,
  -- and a battery that asserts on the number would then be testing something else.
  CONSTRAINT review_metadata_is_mandatory CHECK (
    status NOT IN ('reviewed', 'approved', 'deprecated') OR (
      review_label IS NOT NULL AND review_basis IS NOT NULL AND review_scope IS NOT NULL
      AND reviewed_languages IS NOT NULL AND reviewed_at IS NOT NULL)),
  -- `approved_at` present means "this release has been approved at some point", and the
  -- guard trigger makes that permanent: the only step out of `approved` is `deprecated`.
  -- So this biconditional, which Stage 2 made awkward for packs, is what makes a
  -- demotion back into an editable state impossible for releases.
  CONSTRAINT approved_at_matches_status
    CHECK ((status IN ('approved', 'deprecated')) = (approved_at IS NOT NULL)),
  CONSTRAINT deprecated_at_matches_status
    CHECK ((status = 'deprecated') = (deprecated_at IS NOT NULL)),
  UNIQUE (pack_id, release_number)
);

CREATE INDEX tradition_pack_releases_pack_status_idx
  ON public.tradition_pack_releases (pack_id, status);

COMMENT ON TABLE public.tradition_pack_releases IS
  'One frozen content release of a tradition pack. Content is editable only while status '
  'is draft; the lifecycle moves forward only, and a release that has left draft is '
  'immutable and undeletable — retiring it is a status change, never an edit or a removal.';
COMMENT ON COLUMN public.tradition_pack_releases.machine_assistance_notes IS
  'What the machine-assistance declaration means for this release, in the author''s words: '
  'what was generated, what was checked by a human, and against what. Required whenever '
  'machine_assisted is true, because a checkbox alone discloses nothing.';
COMMENT ON COLUMN public.tradition_pack_releases.review_basis IS
  'The stated qualification behind the review claim, in words. Free text on purpose: a '
  'controlled vocabulary here would be our ranking of who counts.';
COMMENT ON COLUMN public.tradition_pack_releases.review_scope IS
  'What the review covered and what it did not, so that a two-language review of a '
  'three-language release cannot read as a complete one.';

-- ===========================================================================
-- 3. THE RELEASE GUARD — content freeze, legal steps, no invented review
-- ===========================================================================

-- Deliberately self-contained: it calls no other `private` function, because it is
-- SECURITY INVOKER and a nested call would be privilege-checked against whoever issued
-- the statement — which for a content write through a trusted backend is `service_role`,
-- a role this schema grants nothing in `private`. Inlining ~100 lines of validation is
-- the cheaper price than a definer guard with privileges of its own.
CREATE FUNCTION private.guard_tradition_pack_release() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_section   jsonb;
  v_lang      text;
  v_bad       text;
  v_keys      text[];
  v_seen_keys text[] := '{}';
  v_seen_pos  integer[] := '{}';
  v_seen_hf   text[] := '{}';
  v_people_lists integer := 0;
  v_event_lists  integer := 0;
  v_total     integer;
  v_pos       integer;
  v_kind      text;
  v_key       text;
BEGIN
  -- ---------------------------------------------------------------- delete
  IF TG_OP = 'DELETE' THEN
    -- Referenced rows are already unreachable: both FKs onto this table are RESTRICT, so
    -- a release a wedding or a frozen invitation points at cannot disappear under them.
    -- This is the other half, and it is about the row rather than about who points at it:
    -- a release that has left `draft` is evidence of what a guest may have been offered,
    -- and retiring it is a status change, not an edit to history. Reviewer ruling A2's
    -- "once it leaves draft it is a review unit" and §D's "deletion is the ultimate edit"
    -- meet here, which is why `reviewed` is refused alongside the two that have been
    -- approved — a reviewed row that can be erased is a review that never happened.
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION
        'release % of pack % is % and may not be deleted: a release that has left draft is retired by status, never removed',
        OLD.release_number, OLD.pack_id, OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- ------------------------------------------------------- birth as draft
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION
      'a tradition pack release begins life as draft; it cannot be created already %',
      NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- --------------------------------------------------- language list shape
  -- Sorted and duplicate-free, so two releases that cover the same languages have the
  -- same value and `reviewed_languages <@ languages` is a comparison of sets.
  IF NEW.languages IS DISTINCT FROM (
       SELECT array_agg(DISTINCT l ORDER BY l) FROM unnest(NEW.languages) l) THEN
    RAISE EXCEPTION 'languages must be sorted and free of duplicates (got %)',
      NEW.languages USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reviewed_languages IS NOT NULL AND NEW.reviewed_languages IS DISTINCT FROM (
       SELECT array_agg(DISTINCT l ORDER BY l) FROM unnest(NEW.reviewed_languages) l) THEN
    RAISE EXCEPTION 'reviewed_languages must be sorted and free of duplicates (got %)',
      NEW.reviewed_languages USING ERRCODE = 'check_violation';
  END IF;

  -- ------------------------------------------- the definition is not free-form
  IF NEW.definition_schema_version <> 1 THEN
    RAISE EXCEPTION
      'definition schema version % is not understood by this build, so it cannot be validated',
      NEW.definition_schema_version
      USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(NEW.definition) <> 'object' THEN
    RAISE EXCEPTION 'a release definition must be a JSON object'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO v_bad
    FROM jsonb_object_keys(NEW.definition) k
   WHERE k NOT IN ('sections', 'event_vocabulary', 'design_guidance');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'a release definition carries keys this build does not understand: %',
      v_bad USING ERRCODE = 'check_violation';
  END IF;
  -- Every "this must be present and of shape X" test below is written as
  -- `key IS NULL OR jsonb_typeof(key) <> 'X'`, never as the bare second half. The reason
  -- is a NULL trap that four of these rules fell into while they were being written:
  -- `jsonb_typeof` of an absent key is NULL, `NULL <> 'array'` is NULL, and an IF treats
  -- NULL as false — so a section that omits `position` entirely was accepted by the rule
  -- named "section % has no numeric position", and a definition with no `sections` key was
  -- accepted by the rule that requires one. Measured, not assumed: 50_pack_release.sql
  -- re-probes each of the four absence cases, which is the only reason a later edit
  -- cannot quietly put the bare form back.
  IF NEW.definition -> 'sections' IS NULL
     OR jsonb_typeof(NEW.definition -> 'sections') <> 'array'
     OR jsonb_array_length(NEW.definition -> 'sections') = 0 THEN
    RAISE EXCEPTION 'a release must declare at least one section'
      USING ERRCODE = 'check_violation';
  END IF;

  v_total := jsonb_array_length(NEW.definition -> 'sections');
  FOR v_section IN
      SELECT s FROM jsonb_array_elements(NEW.definition -> 'sections') s LOOP

    IF jsonb_typeof(v_section) <> 'object' THEN
      RAISE EXCEPTION 'every section must be a JSON object'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT array_agg(k ORDER BY k) INTO v_keys
      FROM jsonb_object_keys(v_section) k
     WHERE k NOT IN ('section_key', 'position', 'kind', 'required', 'host_field',
                     'heading', 'pack_text', 'allow_english_fallback');
    IF v_keys IS NOT NULL THEN
      RAISE EXCEPTION 'section % carries unknown keys: %',
        COALESCE(v_section ->> 'section_key', '(unnamed)'), v_keys
        USING ERRCODE = 'check_violation';
    END IF;

    -- §C of the Stage 4 continuation asks for a small, finite section vocabulary, and
    -- the honest way to read that is: these are *product slots*, each of which the app
    -- has a place to put. A closed set is what makes "a pack can reorder, rename and
    -- refill an invitation without a code change" true while "a pack cannot invent a
    -- section the app has nowhere to render" is also true. The list carries no culture —
    -- no slot is named after a rite, a community or a deity — and adding one is a code
    -- change with a renderer beside it, not a content write.
    --
    -- `src/lib/traditionPackContract.ts` holds the same list for the client, and
    -- `scripts/check-db-contract.mjs` fails if the two ever differ.
    IF v_section -> 'section_key' IS NULL
       OR jsonb_typeof(v_section -> 'section_key') <> 'string'
       OR (v_section ->> 'section_key') NOT IN (
            'opening', 'welcome', 'family_introduction', 'family', 'couple',
            'invitation', 'ceremonies', 'venue', 'event_notes', 'blessing', 'closing') THEN
      RAISE EXCEPTION 'section % is not one of the section slots this build renders',
        COALESCE(v_section ->> 'section_key', '(unnamed)')
        USING ERRCODE = 'check_violation';
    END IF;
    v_key := v_section ->> 'section_key';
    IF v_key = ANY (v_seen_keys) THEN
      RAISE EXCEPTION 'section_key % appears twice in one release', v_key
        USING ERRCODE = 'check_violation';
    END IF;
    v_seen_keys := v_seen_keys || v_key;

    IF v_section -> 'position' IS NULL
       OR jsonb_typeof(v_section -> 'position') <> 'number' THEN
      RAISE EXCEPTION 'section % has no numeric position', v_key
        USING ERRCODE = 'check_violation';
    END IF;
    v_pos := (v_section ->> 'position')::integer;
    -- Dense by the pigeonhole principle: every position is inside 1..n and no position
    -- repeats, so there are no gaps and no renumbering surprises downstream.
    IF v_pos < 1 OR v_pos > v_total THEN
      RAISE EXCEPTION 'section % has position % outside 1..%', v_key, v_pos, v_total
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_pos = ANY (v_seen_pos) THEN
      RAISE EXCEPTION 'position % is claimed by two sections', v_pos
        USING ERRCODE = 'check_violation';
    END IF;
    v_seen_pos := v_seen_pos || v_pos;

    -- The whole of directive §12's neutrality, stated as one line: a section names a
    -- *drawing rule*, never a culture. The renderer switches on `kind`, which is why a
    -- pack can reorder, rename and refill an invitation without a branch in the app.
    v_kind := v_section ->> 'kind';
    IF v_kind IS NULL OR v_kind NOT IN ('text', 'people_list', 'event_list') THEN
      RAISE EXCEPTION 'section % claims kind % that no renderer knows', v_key,
        COALESCE(v_kind, '(none)') USING ERRCODE = 'check_violation';
    END IF;
    IF v_kind IN ('people_list', 'event_list') THEN
      -- Counted per kind, and the counter is set *before* the second one can arrive. A
      -- shared counter over both kinds let a release declare two people lists — the
      -- renderer draws one list of people, so "at most one people list and one event
      -- list" was a claim about a rule that did not exist. Measured: the old shape
      -- accepted `family` and `couple` both as people_list.
      IF v_kind = 'people_list' THEN
        IF v_people_lists = 1 THEN
          RAISE EXCEPTION 'a release may declare at most one people list; section % is a second',
            v_key USING ERRCODE = 'check_violation';
        END IF;
        v_people_lists := 1;
      ELSE
        IF v_event_lists = 1 THEN
          RAISE EXCEPTION 'a release may declare at most one event list; section % is a second',
            v_key USING ERRCODE = 'check_violation';
        END IF;
        v_event_lists := 1;
      END IF;
      IF jsonb_typeof(v_section -> 'host_field') <> 'null' AND v_section ? 'host_field' THEN
        RAISE EXCEPTION 'section % is a % and may not read a host field', v_key, v_kind
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF v_section -> 'required' IS NULL
       OR jsonb_typeof(v_section -> 'required') <> 'boolean' THEN
      RAISE EXCEPTION 'section % must declare required as a boolean', v_key
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_section ? 'host_field' AND jsonb_typeof(v_section -> 'host_field') <> 'null' THEN
      v_bad := v_section ->> 'host_field';
      IF v_bad NOT IN ('welcome', 'family_introduction', 'event_notes', 'closing') THEN
        RAISE EXCEPTION 'section % reads unknown host field %', v_key, v_bad
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_bad = ANY (v_seen_hf) THEN
        RAISE EXCEPTION 'two sections read host field %', v_bad
          USING ERRCODE = 'check_violation';
      END IF;
      v_seen_hf := v_seen_hf || v_bad;
    END IF;

    IF v_section ? 'allow_english_fallback'
       AND jsonb_typeof(v_section -> 'allow_english_fallback') <> 'boolean' THEN
      RAISE EXCEPTION 'section % must declare allow_english_fallback as a boolean', v_key
        USING ERRCODE = 'check_violation';
    END IF;
    -- Directive §14: a fallback is only honest if the language it falls back to is one
    -- this release actually claims. A pack covering Tamil alone cannot fall back to an
    -- English it never declared, and a caller must not be able to write that silently.
    IF COALESCE((v_section ->> 'allow_english_fallback')::boolean, false)
       AND NOT ('en' = ANY (NEW.languages)) THEN
      RAISE EXCEPTION
        'section % allows an English fallback but this release does not cover en', v_key
        USING ERRCODE = 'check_violation';
    END IF;

    -- Each language map, if present, is an object of non-blank strings keyed by a
    -- language this release covers. Length caps keep a "heading" from carrying an essay.
    IF v_section ? 'heading' AND jsonb_typeof(v_section -> 'heading') <> 'null' THEN
      IF jsonb_typeof(v_section -> 'heading') <> 'object' THEN
        RAISE EXCEPTION 'section % heading must be an object of language keys', v_key
          USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_section -> 'heading') k
                  WHERE k <> ALL (NEW.languages)) THEN
        RAISE EXCEPTION 'section % declares a heading in a language this release does not cover',
          v_key USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_section -> 'heading') k
                  WHERE jsonb_typeof(v_section -> 'heading' -> k) <> 'string'
                     OR length(btrim(v_section -> 'heading' ->> k)) = 0
                     OR length(v_section -> 'heading' ->> k) > 160) THEN
        RAISE EXCEPTION 'section % has a heading that is empty, too long, or not a string',
          v_key USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF v_section ? 'pack_text' AND jsonb_typeof(v_section -> 'pack_text') <> 'null' THEN
      IF v_kind <> 'text' THEN
        RAISE EXCEPTION 'section % is a % and cannot carry reviewed wording', v_key, v_kind
          USING ERRCODE = 'check_violation';
      END IF;
      IF jsonb_typeof(v_section -> 'pack_text') <> 'object' THEN
        RAISE EXCEPTION 'section % pack_text must be an object of language keys', v_key
          USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_section -> 'pack_text') k
                  WHERE k <> ALL (NEW.languages)) THEN
        RAISE EXCEPTION 'section % declares wording in a language this release does not cover',
          v_key USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_section -> 'pack_text') k
                  WHERE jsonb_typeof(v_section -> 'pack_text' -> k) <> 'string'
                     OR length(btrim(v_section -> 'pack_text' ->> k)) = 0
                     OR length(v_section -> 'pack_text' ->> k) > 4000) THEN
        RAISE EXCEPTION 'section % has wording that is empty, over 4000 characters, or not a string',
          v_key USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- A `text` section with nothing in it would be an invisible entry in the ordered
    -- list, which is a bug dressed as content.
    IF v_kind = 'text'
       AND NOT (v_section ? 'heading')
       AND NOT (v_section ? 'pack_text')
       AND NOT (v_section ? 'host_field') THEN
      RAISE EXCEPTION 'section % says nothing: no heading, no reviewed wording, no host field',
        v_key USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- Optional, and validated when present: the event vocabulary the editor may *suggest*
  -- (a host's own event name always wins), and the design guidance a reviewer read.
  IF NEW.definition ? 'event_vocabulary' THEN
    IF jsonb_typeof(NEW.definition -> 'event_vocabulary') <> 'array'
       OR jsonb_array_length(NEW.definition -> 'event_vocabulary') > 50 THEN
      RAISE EXCEPTION 'event_vocabulary must be an array of at most 50 entries'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1
                 FROM jsonb_array_elements(NEW.definition -> 'event_vocabulary') ev
                WHERE jsonb_typeof(ev) <> 'object'
                   OR jsonb_typeof(ev -> 'event_key') <> 'string'
                   OR (ev ->> 'event_key') !~ '^[a-z][a-z0-9_]{0,39}$'
                   OR jsonb_typeof(ev -> 'labels') <> 'object'
                   OR EXISTS (SELECT 1 FROM jsonb_object_keys(ev -> 'labels') k
                               WHERE k <> ALL (NEW.languages)
                                  OR jsonb_typeof(ev -> 'labels' -> k) <> 'string'
                                  OR length(btrim(ev -> 'labels' ->> k)) = 0
                                  OR length(ev -> 'labels' ->> k) > 160)) THEN
      RAISE EXCEPTION 'every event_vocabulary entry needs a slug event_key and label strings '
                      'in languages this release covers'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1
                 FROM jsonb_array_elements(NEW.definition -> 'event_vocabulary') ev,
                      jsonb_object_keys(ev) k
                WHERE k NOT IN ('event_key', 'labels')) THEN
      RAISE EXCEPTION 'an event_vocabulary entry carries an unknown key'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.definition ? 'design_guidance' THEN
    IF jsonb_typeof(NEW.definition -> 'design_guidance') <> 'object' THEN
      RAISE EXCEPTION 'design_guidance must be an object'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.definition -> 'design_guidance') k
                WHERE k NOT IN ('lead_size', 'motif_reference')) THEN
      RAISE EXCEPTION 'design_guidance carries a key this build does not understand'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.definition -> 'design_guidance') k
                WHERE (k = 'lead_size' AND (jsonb_typeof(NEW.definition -> 'design_guidance' -> k) <> 'number'
                                            OR (NEW.definition -> 'design_guidance' ->> k)::numeric NOT BETWEEN 8 AND 72))
                   OR (k = 'motif_reference' AND (jsonb_typeof(NEW.definition -> 'design_guidance' -> k) <> 'string'
                                                  OR length(btrim(NEW.definition -> 'design_guidance' ->> k)) = 0
                                                  OR length(NEW.definition -> 'design_guidance' ->> k) > 200))) THEN
      RAISE EXCEPTION 'design_guidance is out of range: lead_size must be 8 to 72 and motif_reference a short string'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- A new row has no history to be frozen about, and `OLD` is not addressable in an
  -- INSERT trigger at all, so the two rules below belong to UPDATE alone.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- ------------------------------------------------------- immutability
  -- Content is frozen the moment a release stops being a draft. `reviewed` is included
  -- on purpose: the metadata that row carries describes exactly the wording beside it,
  -- so editing that wording in place would leave a review claim attached to text nobody
  -- read. Reviewer ruling A2 makes that the whole rule: once the status leaves `draft`
  -- this row *is* the review unit, and the only honest way to change the wording is a
  -- new draft release.
  --
  -- The tuple below is the content/provenance half only — status, the review metadata and
  -- the three lifecycle timestamps are deliberately absent, because those are exactly the
  -- columns a legal lifecycle step must be able to write. `updated_at` is absent for the
  -- same reason and is the interesting case: the `set_updated_at` trigger rewrites it on
  -- every UPDATE, so including it here would make every legal step look like a content
  -- edit and the guard would refuse the lifecycle it is meant to enforce.
  IF OLD.status <> 'draft' AND (
       NEW.pack_id, NEW.release_number, NEW.definition_schema_version, NEW.definition,
       NEW.languages, NEW.machine_assisted, NEW.machine_assistance_notes,
       NEW.author_label, NEW.source_reference, NEW.changelog
     ) IS DISTINCT FROM (
       OLD.pack_id, OLD.release_number, OLD.definition_schema_version, OLD.definition,
       OLD.languages, OLD.machine_assisted, OLD.machine_assistance_notes,
       OLD.author_label, OLD.source_reference, OLD.changelog) THEN
    RAISE EXCEPTION
      'release %/% is %: its content is frozen, so a change means a new release_number',
      OLD.pack_id, OLD.release_number, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- --------------------------------------------------- lifecycle, one edge at a time
  -- Reviewer ruling A2: forward-only, three steps, and no step back. The row that has
  -- been reviewed is a review unit, so "un-reviewing" it would either leave a review
  -- claim on wording nobody read or silently destroy the record of what was read — and
  -- the second is the one a draft row cannot be trusted to represent afterwards. A
  -- mistake is corrected by a new release number, which is also the only correction that
  -- can never retroactively change what a guest already read.
  IF NEW.status IS DISTINCT FROM OLD.status THEN

    IF NOT ((OLD.status = 'draft'    AND NEW.status = 'reviewed')
         OR (OLD.status = 'reviewed' AND NEW.status = 'approved')
         OR (OLD.status = 'approved'  AND NEW.status = 'deprecated')) THEN
      RAISE EXCEPTION 'a release cannot move from % to %: the only steps are draft→reviewed, '
                      'reviewed→approved and approved→deprecated, and a release whose wording '
                      'must change becomes a new release_number',
        OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.status = 'draft' AND NEW.status = 'reviewed' THEN
      -- The caller states the review; this trigger never invents one.
      IF NEW.reviewed_at IS NULL THEN
        RAISE EXCEPTION 'marking a release reviewed has to say when'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF OLD.status = 'reviewed' AND NEW.status = 'approved' THEN
      -- Approval cannot restate the review it was based on: the row that becomes
      -- publishable is the row a reviewer looked at.
      IF (NEW.review_label, NEW.review_basis, NEW.review_scope,
          NEW.reviewed_languages, NEW.reviewed_at, NEW.reviewed_by)
         IS DISTINCT FROM
         (OLD.review_label, OLD.review_basis, OLD.review_scope,
          OLD.reviewed_languages, OLD.reviewed_at, OLD.reviewed_by) THEN
        RAISE EXCEPTION 'approving release % cannot change the review record it was reviewed under',
          OLD.release_number USING ERRCODE = 'check_violation';
      END IF;
      NEW.approved_at := now();
    END IF;

    IF OLD.status = 'approved' AND NEW.status = 'deprecated' THEN
      -- The same sentence as approval, spoken at the other edge: retirement is the last
      -- thing a release does, and a caller who restates the review while retiring it has
      -- changed what the published versions were approved against.
      IF (NEW.review_label, NEW.review_basis, NEW.review_scope, NEW.reviewed_languages,
          NEW.reviewed_at, NEW.reviewed_by, NEW.approved_at)
         IS DISTINCT FROM
         (OLD.review_label, OLD.review_basis, OLD.review_scope, OLD.reviewed_languages,
          OLD.reviewed_at, OLD.reviewed_by, OLD.approved_at) THEN
        RAISE EXCEPTION 'retiring release % cannot change the review it was approved under',
          OLD.release_number USING ERRCODE = 'check_violation';
      END IF;
      NEW.deprecated_at := now();
    END IF;
  END IF;

  -- ------------------------------------------------ the review record, for the rest
  -- Reviewer ruling A2 says a release that has left `draft` *is* a review unit: the
  -- wording and the record of who read which of it describe one another. The two edges
  -- above refuse a status step that restates the record; this closes the other door, which
  -- is a caller that changes the record and leaves the status exactly where it is. Measured
  -- before the fix: `UPDATE … SET review_scope = …` and `SET reviewed_at = … - interval
  -- '5 years'` both succeeded on an approved release, which would have let a row keep its
  -- publishable status while quietly describing a different review.
  --
  -- The comparison runs only when the status is not moving, because the legal status steps
  -- *do* write timestamps — the trigger fills in `approved_at` and `deprecated_at` itself,
  -- and a check that ran over them mid-transition would refuse the lifecycle it documents.
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND OLD.status <> 'draft' AND
     (NEW.review_label, NEW.review_basis, NEW.review_scope, NEW.reviewed_languages,
      NEW.reviewed_at, NEW.reviewed_by, NEW.approved_at, NEW.deprecated_at)
     IS DISTINCT FROM
     (OLD.review_label, OLD.review_basis, OLD.review_scope, OLD.reviewed_languages,
      OLD.reviewed_at, OLD.reviewed_by, OLD.approved_at, OLD.deprecated_at) THEN
    RAISE EXCEPTION
      'release %/% is %: its review record is part of the frozen unit, so it is corrected '
      'by a new release_number, never rewritten',
      OLD.pack_id, OLD.release_number, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_tradition_pack_release()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tradition_pack_releases
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- Existing guard functions, reused rather than restated: these are the identity half of
-- the boundary and they already speak with the measured role name.
CREATE TRIGGER no_client_write_tradition_pack_releases
  BEFORE INSERT OR UPDATE ON public.tradition_pack_releases
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();

CREATE TRIGGER no_client_delete_tradition_pack_releases
  BEFORE DELETE ON public.tradition_pack_releases
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

-- Fires last of the three (alphabetically), so a browser-role write is answered by the
-- refusal that names the role rather than by a content complaint that leaks the shape of
-- a row it should never have been able to attempt.
CREATE TRIGGER tradition_pack_release_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.tradition_pack_releases
  FOR EACH ROW EXECUTE FUNCTION private.guard_tradition_pack_release();

-- ===========================================================================
-- 4. SELECTION IS PINNED TO A RELEASE, AND GATED WHERE IT IS WRITTEN
-- ===========================================================================

ALTER TABLE public.weddings DROP CONSTRAINT weddings_tradition_pack_id_fkey;
ALTER TABLE public.weddings RENAME COLUMN tradition_pack_id TO tradition_pack_release_id;
ALTER TABLE public.weddings
  ADD CONSTRAINT weddings_tradition_pack_release_id_fkey
  FOREIGN KEY (tradition_pack_release_id)
  REFERENCES public.tradition_pack_releases(id) ON DELETE RESTRICT;

ALTER TABLE public.invitation_versions DROP CONSTRAINT invitation_versions_tradition_pack_id_fkey;
ALTER TABLE public.invitation_versions
  RENAME COLUMN tradition_pack_id TO tradition_pack_release_id;
ALTER TABLE public.invitation_versions
  ADD CONSTRAINT invitation_versions_tradition_pack_release_id_fkey
  FOREIGN KEY (tradition_pack_release_id)
  REFERENCES public.tradition_pack_releases(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.weddings.tradition_pack_release_id IS
  'The exact approved release this wedding reads. NULL means the host wrote their own '
  'wording with no pack behind it. Gated at write time by weddings_pack_release_gate.';
COMMENT ON COLUMN public.invitation_versions.tradition_pack_release_id IS
  'The release a frozen invitation credits. Recorded, never chosen: it must equal the '
  'wedding''s current selection at the moment the version was created.';

-- The measured hole this closes: Stage 2 filtered the catalogue by status in a *read*
-- policy, so `INSERT INTO weddings (... tradition_pack_id ...)` with a draft or
-- deprecated pack succeeded through an ordinary owner JWT. Visibility was the rule, and
-- visibility is not a constraint.
CREATE FUNCTION private.require_approved_pack_release() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.tradition_pack_release_id IS NULL THEN
    RETURN NEW;  -- "no pack, I'll write it myself" is always a legal choice
  END IF;

  -- Read as the calling role. For a customer that read returns nothing for a release that
  -- is neither approved nor already selected by one of their own weddings, because of the
  -- policy in §9, which is the correct outcome here: an unreadable release is by
  -- definition not one they may newly select.
  SELECT r.status INTO v_status
    FROM public.tradition_pack_releases r
   WHERE r.id = NEW.tradition_pack_release_id;

  IF v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION
      'a wedding may only select an approved tradition pack release (this one is %)',
      COALESCE(v_status, 'not readable by this role')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.require_approved_pack_release()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER weddings_pack_release_gate
  BEFORE INSERT OR UPDATE OF tradition_pack_release_id ON public.weddings
  FOR EACH ROW EXECUTE FUNCTION private.require_approved_pack_release();

-- A version records what the wedding used; it must not be a second, independent choice.
-- Without the equality half, a caller with any write path at all could attach a release
-- to a frozen invitation that never selected it, and the credit line a guest reads would
-- be a claim about a document rather than a fact about it.
--
-- The status half is reviewer ruling A1, and it is a different claim from the selection
-- gate's. `weddings_pack_release_gate` says *you may not start* pointing at a release
-- that is not approved; nothing in it says anything about a wedding that started pointing
-- at one while it was approved and has since been deprecated — and §6 requires that
-- wedding to keep its selection for historical visibility. So the two moments genuinely
-- differ, and a guest link is made at the second one: a deprecated release must remain
-- readable through every version already frozen, and must not be able to freeze a new
-- one. Enforcing approval only at selection would let "we never publish new content from
-- a retired release" be a UI convention.
CREATE FUNCTION private.require_frozen_pack_release() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_wedding uuid;
  v_status  text;
BEGIN
  IF NEW.tradition_pack_release_id IS NULL THEN
    RETURN NEW;  -- "no pack, I'll write it myself" is always a legal choice
  END IF;

  SELECT w.tradition_pack_release_id INTO v_wedding
    FROM public.weddings w WHERE w.id = NEW.wedding_id;

  IF NEW.tradition_pack_release_id IS DISTINCT FROM v_wedding THEN
    RAISE EXCEPTION
      'a version may only record the release its wedding currently selects'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Equality first, because a mismatch is a wrong *row* and a wrong status is a right row
  -- in the wrong moment; a caller who gets the mismatch message has one thing to fix.
  --
  -- Read as the calling role, exactly like the selection gate: for a customer an
  -- unapproved release is not readable, and "not readable" is the correct answer to
  -- "may I publish from it?". The trusted maintenance path bypasses row security, so it
  -- sees the real status and is refused by name.
  SELECT r.status INTO v_status
    FROM public.tradition_pack_releases r
   WHERE r.id = NEW.tradition_pack_release_id;

  IF v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION
      'a new invitation version may only be frozen from an approved tradition pack release (this one is %); a version already frozen from it is unaffected',
      COALESCE(v_status, 'not readable by this role')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.require_frozen_pack_release()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER versions_pack_release_gate
  BEFORE INSERT OR UPDATE OF tradition_pack_release_id ON public.invitation_versions
  FOR EACH ROW EXECUTE FUNCTION private.require_frozen_pack_release();

-- ===========================================================================
-- 5. THE SECTION CONTRACT: ORDER, WORDING AND PROVENANCE IN ONE DOCUMENT
-- ===========================================================================

-- The vocabulary a renderer knows, with no culture in it. Everything about a particular
-- tradition arrives as *data* — which sections exist, in what order, under what heading,
-- with what reviewed wording — and none of it is a branch in application code.
--
-- `private.default_invitation_definition()` is what a wedding with no pack resolves
-- against. It is written in the same shape as a release definition, on purpose: the
-- no-pack path and the pack path are then the same code, and "we removed the branch when
-- a pack is absent" is a fact about this file rather than a hope about the app.
CREATE FUNCTION private.default_invitation_definition() RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT '{
    "sections": [
      {"section_key": "welcome",             "position": 1, "kind": "text",
       "required": false, "host_field": "welcome"},
      {"section_key": "family_introduction", "position": 2, "kind": "text",
       "required": false, "host_field": "family_introduction"},
      {"section_key": "family",              "position": 3, "kind": "people_list",
       "required": false},
      {"section_key": "ceremonies",          "position": 4, "kind": "event_list",
       "required": false, "heading": {"en": "The ceremonies"}},
      {"section_key": "event_notes",         "position": 5, "kind": "text",
       "required": false, "host_field": "event_notes"},
      {"section_key": "closing",             "position": 6, "kind": "text",
       "required": false, "host_field": "closing"}
    ]
  }'::jsonb;
$$;

REVOKE ALL ON FUNCTION private.default_invitation_definition()
  FROM PUBLIC, anon, authenticated;

-- One string out of one language map, and how it was arrived at. Three outcomes only:
-- the requested language, an English text *the release declared as a fallback*, or
-- nothing. The middle case is reported as a fallback rather than returned silently,
-- because directive §14's objection is to an English sentence passing for a Tamil one —
-- and a snapshot that records `fallback_used` makes the substitution visible to whoever
-- reads the invitation's provenance later.
CREATE FUNCTION private.pack_text_for(
  p_node jsonb,
  p_requested text,
  p_allow_english_fallback boolean
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_text text;
BEGIN
  IF jsonb_typeof(p_node) <> 'object' OR p_requested IS NULL THEN
    RETURN NULL;
  END IF;

  v_text := CASE WHEN jsonb_typeof(p_node -> p_requested) = 'string'
            THEN btrim(p_node ->> p_requested) END;
  IF v_text IS NOT NULL AND v_text <> '' THEN
    RETURN jsonb_build_object('text', v_text, 'language', p_requested,
                              'fallback_used', false);
  END IF;

  IF p_allow_english_fallback AND p_requested <> 'en' THEN
    v_text := CASE WHEN jsonb_typeof(p_node -> 'en') = 'string'
              THEN btrim(p_node ->> 'en') END;
    IF v_text IS NOT NULL AND v_text <> '' THEN
      RETURN jsonb_build_object('text', v_text, 'language', 'en',
                                'fallback_used', true);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.pack_text_for(jsonb, text, boolean)
  FROM PUBLIC, anon, authenticated;

-- The resolution: definition + the wedding's language + the host's own draft → the
-- ordered list a guest is shown. Host wording is referenced by field name and never
-- copied here, so the host's words stay in exactly one place in the snapshot (`draft`)
-- and a version cannot freeze a paragraph twice with two spellings.
--
-- Where the pack wrote something and the host wrote over it, the host wins and the
-- snapshot says so (`body_source = host`, `overrode_pack_text = true`): directive §13's
-- point is that a guest reads the host's text and the review record must not pretend
-- otherwise.
CREATE FUNCTION private.resolve_invitation_sections(
  p_definition jsonb,
  p_requested text,
  p_draft jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_section jsonb;
  v_heading jsonb;
  v_pack    jsonb;
  v_host    text;
  v_allow   boolean;
  v_body    jsonb;
  v_out     jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_definition) <> 'object'
     OR jsonb_typeof(p_definition -> 'sections') <> 'array' THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_section IN
      SELECT s FROM jsonb_array_elements(p_definition -> 'sections') s
      ORDER BY (s ->> 'position')::integer LOOP

    v_allow := COALESCE((v_section ->> 'allow_english_fallback')::boolean, false);
    v_heading := private.pack_text_for(v_section -> 'heading', p_requested, v_allow);
    v_pack := private.pack_text_for(v_section -> 'pack_text', p_requested, v_allow);
    v_host := NULL;
    IF v_section ? 'host_field' AND jsonb_typeof(v_section -> 'host_field') = 'string'
       AND jsonb_typeof(p_draft) = 'object' THEN
      v_host := NULLIF(btrim(COALESCE(p_draft ->> (v_section ->> 'host_field'), '')), '');
    END IF;

    v_body := NULL;
    IF v_host IS NOT NULL THEN
      v_body := jsonb_build_object('source', 'host', 'overrode_pack_text',
                                   v_pack IS NOT NULL);
    ELSIF v_pack IS NOT NULL THEN
      v_body := jsonb_build_object(
        'source', 'reviewed_pack',
        'text', v_pack -> 'text',
        'language', v_pack -> 'language',
        'fallback_used', v_pack -> 'fallback_used',
        'overrode_pack_text', false);
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'section_key',    v_section ->> 'section_key',
      'position',       (v_section ->> 'position')::integer,
      'kind',           v_section ->> 'kind',
      'required',       COALESCE((v_section ->> 'required')::boolean, false),
      'host_field',     CASE WHEN jsonb_typeof(v_section -> 'host_field') = 'string'
                        THEN v_section ->> 'host_field' END,
      'heading_text',   CASE WHEN v_heading IS NOT NULL THEN v_heading -> 'text' END,
      'heading_language', CASE WHEN v_heading IS NOT NULL THEN v_heading -> 'language' END,
      'heading_fallback_used',
                        CASE WHEN v_heading IS NOT NULL THEN v_heading -> 'fallback_used' END,
      'body_text',      CASE WHEN v_body IS NOT NULL THEN v_body -> 'text' END,
      'body_source',    CASE WHEN v_body IS NOT NULL THEN v_body -> 'source' END,
      'body_language',  CASE WHEN v_body IS NOT NULL THEN v_body -> 'language' END,
      'body_fallback_used',
                        CASE WHEN v_body IS NOT NULL THEN v_body -> 'fallback_used' END,
      'overrode_pack_text', CASE WHEN v_body IS NOT NULL
                             THEN v_body -> 'overrode_pack_text' END
    ));
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION private.resolve_invitation_sections(jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.resolve_invitation_sections(jsonb, text, jsonb) IS
  'The only place a pack definition becomes an ordered document. Returns a section per '
  'entry with its provenance; a section with no resolvable text stays in the list and is '
  'reported by the host preview rather than hidden from it.';

-- §O of the Stage 4 continuation: a frozen version must not be creatable while the
-- document it would freeze is unresolved. The rule is stated once, here, as a *list*
-- rather than as a boolean, because the same computation is what the host's editor shows
-- before they press freeze (`src/lib/traditionPackContract.ts` mirrors it) and an
-- explanation is only useful if it names which section and why.
--
-- Four things can fail closed at this boundary:
--   * a `text` section marked required that resolved to no wording at all — the case a
--     pack that does not cover the wedding''s language produces, where every optional
--     section simply goes missing and every required one is a promise nobody can keep;
--   * a requested language the release does not cover, named as the cause rather than
--     left to appear as a list of empty sections;
--   * a `kind` no renderer knows, which the public projection already refuses wholesale;
--   * a definition whose contract version this build cannot interpret.
-- The second and third are defensive rather than reachable: the release guard rejects
-- both at write time, so a row that got here cannot carry them. They are checked anyway
-- because the freeze is the last moment at which a document can be refused, and an
-- invariant that is only true of the writer that produced it is not an invariant.
CREATE FUNCTION private.invitation_freeze_issues(p_snapshot jsonb) RETURNS text[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT coalesce(array_agg(i ORDER BY i), '{}'::text[]) FROM (
    SELECT 'section ' || coalesce(s ->> 'section_key', '(unnamed)')
             || ' is required and has no wording in '
             || coalesce(p_snapshot -> 'sections' ->> 'requested', 'the chosen language')
             || ', and the release does not allow it to fall back' AS i
      FROM jsonb_array_elements(p_snapshot -> 'sections' -> 'items') s
     WHERE coalesce((s ->> 'required')::boolean, false)
       AND s ->> 'kind' = 'text'
       AND private.dto_text(s -> 'body_source') IS NULL
    UNION ALL
    -- §O's second bullet is about the language, and this is the case the required-section
    -- rule above can only report as a symptom: a release that covers `en, ta` asked to
    -- resolve an invitation in `ml` produces no wording anywhere, so naming the mismatch
    -- is the difference between "fix the language" and "hunt through empty sections".
    SELECT 'the invitation language ' || (p_snapshot -> 'sections' ->> 'requested')
             || ' is not one of the languages this release covers ('
             || (SELECT string_agg(l, ', ' ORDER BY l)
                   FROM jsonb_array_elements_text(
                        p_snapshot -> 'tradition_pack_release' -> 'languages') l)
             || ')' AS i
      -- The guard is not decoration. `requested` is NULL for a wedding whose host has not
      -- chosen a language yet, and the concatenation above would then yield a NULL row that
      -- `array_to_string` hides from the message while `cardinality` still counts — an
      -- unnameable issue in a list whose whole purpose is to be named. The RPC refuses that
      -- wedding earlier, so this arm is unreachable today; it is guarded because an
      -- invariant that only holds while the one caller behaves is not an invariant.
      WHERE (p_snapshot -> 'sections' ->> 'requested') IS NOT NULL
        AND jsonb_typeof(
              p_snapshot -> 'tradition_pack_release' -> 'languages') = 'array'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(
                       p_snapshot -> 'tradition_pack_release' -> 'languages') l
           WHERE l = p_snapshot -> 'sections' ->> 'requested')
    UNION ALL
    SELECT 'section ' || coalesce(s ->> 'section_key', '(unnamed)')
             || ' claims kind ' || coalesce(s ->> 'kind', '(none)')
             || ', which this build has no renderer for' AS i
      FROM jsonb_array_elements(p_snapshot -> 'sections' -> 'items') s
     WHERE coalesce(s ->> 'kind', '') NOT IN ('text', 'people_list', 'event_list')
    UNION ALL
    -- Its own sentence, rather than a second condition on the arm above. A section with a
    -- known kind and an unusable position would otherwise be reported as a kind the
    -- renderer does not know, which is a reason the host cannot act on — the difference
    -- between "this build cannot lay this section out in order" and a false claim about
    -- the section's type. `IS DISTINCT FROM`, because the whole reason this sentence
    -- exists is the section that has no position at all — with `<>` that row compared
    -- NULL and dropped itself out of the list, so the checker reported no issue for a
    -- document it could not order.
    SELECT 'section ' || coalesce(s ->> 'section_key', '(unnamed)')
             || ' has a position that is not a number, so this build cannot order it' AS i
      FROM jsonb_array_elements(p_snapshot -> 'sections' -> 'items') s
     WHERE jsonb_typeof(s -> 'position') IS DISTINCT FROM 'number'
    UNION ALL
    SELECT 'this release''s definition uses contract version '
             || (p_snapshot -> 'tradition_pack_release' ->> 'definition_schema_version')
             || ', which this build does not understand' AS i
      WHERE p_snapshot -> 'tradition_pack_release' ? 'definition_schema_version'
        AND (p_snapshot -> 'tradition_pack_release' ->> 'definition_schema_version')::integer
            <> 1
  ) q;
$$;

REVOKE ALL ON FUNCTION private.invitation_freeze_issues(jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.invitation_freeze_issues(jsonb) IS
  'Why this resolved document may not be frozen, as sentences. Empty means it may. The '
  'host''s editor computes the same list for preview; the freeze re-checks it in the '
  'database because a client-side warning is not a constraint.';

-- ===========================================================================
-- 6. THE SNAPSHOT NOW FREEZES CONTENT, NOT A LABEL
-- ===========================================================================

-- Replaces Stage 3's builder. Two things change and both are the point of the stage:
-- the pack block names an exact *release* with its review facts, and `sections` carries
-- the resolved wording so that a guest page is rendered from the document rather than
-- from a catalogue row that has since moved on. `snapshot_schema_version` becomes 2:
-- the projection refuses anything else, so a v1 document — whose pack block records no
-- release and which carries no sections — cannot be shown to a guest by having its
-- missing facts invented. Nothing outside a disposable local database has ever held one
-- (this product has no deployed project), and the refusal, not a migration, is the
-- mechanism that keeps the rule true if that ever stops being so.
CREATE OR REPLACE FUNCTION private.build_invitation_snapshot(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'wedding', jsonb_build_object(
      'title', w.title,
      'primary_language', w.primary_language,
      'additional_languages', w.additional_languages,
      'style_settings', w.style_settings
    ),
    'design_template', CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object(
      'template_key', t.template_key,
      'revision', t.revision,
      'display_name', t.display_name,
      'layout_settings', t.layout_settings,
      'supported_languages', t.supported_languages
    ) END,
    -- Identity and provenance of the exact release this document froze. No uuid: the
    -- number that answers "what did the guest read" is the pack key plus the release
    -- number, and an identifier in a published payload is a leak with no use case.
    'tradition_pack_release', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
      'pack_key', p.pack_key,
      'display_name', p.display_name,
      'scope_statement', p.scope_statement,
      'release_number', r.release_number,
      'definition_schema_version', r.definition_schema_version,
      'languages', r.languages,
      'machine_assisted', r.machine_assisted,
      'author_label', r.author_label,
      'review_label', r.review_label,
      'reviewed_languages', r.reviewed_languages,
      'source_reference', r.source_reference
    ) END,
    -- `COALESCE(w.primary_language, 'en')` for the request only: a wedding with no
    -- language chosen yet has no pack text to resolve for a language nobody picked, and
    -- the app's own copy is English. `requested` records the null, so nothing about the
    -- choice is being quietly assumed. Publishing refuses a wedding with no language, so
    -- this shape never reaches a guest.
    'sections', jsonb_build_object(
      'requested', w.primary_language,
      'items', private.resolve_invitation_sections(
        COALESCE(r.definition, private.default_invitation_definition()),
        COALESCE(w.primary_language, 'en'),
        d.content)),
    'people', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'display_name', pp.display_name,
               'role_key', pp.role_key,
               'role_label', pp.role_label,
               'group_key', pp.group_key,
               'group_label', pp.group_label
             ) ORDER BY pp.display_order, pp.created_at, pp.id)
        FROM public.wedding_people pp
       WHERE pp.wedding_id = w.id), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'event_key', e.event_key,
               'display_name', e.display_name,
               'starts_at_local', to_char(e.starts_at_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
               'ends_at_local', CASE WHEN e.ends_at_local IS NULL THEN NULL
                     ELSE to_char(e.ends_at_local, 'YYYY-MM-DD"T"HH24:MI:SS') END,
               'timezone', e.timezone,
               'venue', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object(
                 'name', v.name, 'address_text', v.address_text, 'map_url', v.map_url
               ) END
             ) ORDER BY e.display_order, e.starts_at_local, e.id)
        FROM public.wedding_events e
        LEFT JOIN public.venues v
               ON v.id = e.venue_id AND v.wedding_id = e.wedding_id
       WHERE e.wedding_id = w.id AND e.enabled), '[]'::jsonb),
    'draft', jsonb_build_object(
      'welcome', d.content -> 'welcome',
      'family_introduction', d.content -> 'family_introduction',
      'event_notes', d.content -> 'event_notes',
      'closing', d.content -> 'closing'
    )
  )
  FROM public.weddings w
  JOIN public.invitation_drafts d ON d.wedding_id = w.id
  LEFT JOIN public.design_templates t ON t.id = w.design_template_id
  LEFT JOIN public.tradition_pack_releases r ON r.id = w.tradition_pack_release_id
  LEFT JOIN public.tradition_packs p ON p.id = r.pack_id
  WHERE w.id = p_wedding_id;
$$;

REVOKE ALL ON FUNCTION private.build_invitation_snapshot(uuid)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 7. THE PUBLIC PROJECTION GROWS TWO WHITELISTED PARTS
-- ===========================================================================

-- The whitelist rule is unchanged and still the reason this function exists: what a
-- guest may read is enumerated in code, and a column, key or reviewed note that is not
-- named here stays invisible. `sections` is therefore projected field by field, and the
-- release block loses everything except the three keys a credit line needs — the review
-- record, the scope statement and the machine-assistance flag belong to the host's own
-- view of their invitation and to the platform's review artefact, not to a stranger's
-- browser.
CREATE OR REPLACE FUNCTION private.public_invitation_dto(
  p_snapshot_schema_version integer,
  p_snapshot jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_wedding  jsonb;
  v_draft    jsonb;
  v_style    jsonb;
  v_sections jsonb;
BEGIN
  IF p_snapshot_schema_version IS DISTINCT FROM 2 THEN
    RETURN NULL;
  END IF;
  -- `IS DISTINCT FROM`, not `<>`. Measured before the repair: with `<>`, a snapshot with a
  -- block *missing* made every term of this OR chain NULL rather than TRUE, so the guard
  -- fell through and the projection returned a fully shaped document of nulls — a guest
  -- page with no invitation on it, which is the partial render this projection's own
  -- all-or-nothing rule exists to refuse. A missing key is the case the guard is for.
  IF p_snapshot IS NULL
     OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot -> 'wedding') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot -> 'draft') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot -> 'people') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_snapshot -> 'events') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_snapshot -> 'sections') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot -> 'sections' -> 'items') IS DISTINCT FROM 'array'
  THEN
    RETURN NULL;
  END IF;

  v_wedding := p_snapshot -> 'wedding';
  v_draft   := p_snapshot -> 'draft';
  v_style   := CASE WHEN jsonb_typeof(v_wedding -> 'style_settings') = 'object'
                    THEN v_wedding -> 'style_settings' ELSE '{}'::jsonb END;

  -- Sections are all-or-nothing *for the shapes this build is responsible for*, which after
  -- directive §24 is not the same sentence as "all-or-nothing for every kind string". The split
  -- is deliberate and it is the historical-document rule, not a convenience:
  --
  --   * a non-numeric `position` is a broken document by this contract and every later one,
  --     because section order is frozen content;
  --   * an unknown `kind` that the release marks **required** is a promise this build cannot
  --     keep — the guest was promised a paragraph there is no renderer for, and a page that
  --     silently omits a promised section is the false-completeness failure the whole
  --     provenance model exists to prevent. Refuse the whole document, as Stage 3 does;
  --   * an unknown `kind` that is **optional** is a future build's feature arriving in an old
  --     reader. §24: "a guest renderer should not crash a historical publication merely because
  --     current app code doesn't recognise an optional section". The known sections still
  --     render, and the unrecognised item is carried through as exactly what this build can
  --     verify about it — its key, its frozen position, its kind — with no heading and no body,
  --     because inventing wording for a section nobody recognised is not a degradation, it is a
  --     fabrication, and dropping the row would silently reorder the guest's document.
  --
  -- Nothing reachable from this build's own API can produce either arm: the release guard
  -- refuses an unknown `kind` when a definition is written, and the freeze rechecks it. So this
  -- is not a code path a customer can enter today — it is the answer the projection gives when
  -- a document frozen tomorrow is read by a build from yesterday, which is the only moment the
  -- question can be asked and therefore the only moment it can be answered correctly.
  v_sections := CASE WHEN EXISTS (
                   SELECT 1 FROM jsonb_array_elements(
                     p_snapshot -> 'sections' -> 'items') s
                    WHERE jsonb_typeof(s -> 'position') IS DISTINCT FROM 'number'
                       OR (coalesce(s ->> 'kind', '') NOT IN ('text', 'people_list', 'event_list')
                           AND CASE WHEN jsonb_typeof(s -> 'required') = 'boolean'
                                    THEN (s ->> 'required')::boolean ELSE false END)
                 ) THEN NULL
                 ELSE COALESCE((
                   SELECT jsonb_agg(CASE
                     -- §24's optional-unknown arm. `required` is reported as false because that
                     -- is the only state in which this branch is reachable, and the item's own
                     -- `required` value is deliberately not passed on: a section this build cannot
                     -- draw must not be *presented* to a later reader as a promise it can rely on.
                     WHEN coalesce(s ->> 'kind', '')
                            NOT IN ('text', 'people_list', 'event_list')
                       THEN jsonb_build_object(
                         'section_key', private.dto_text(s -> 'section_key'),
                         'position',    (s ->> 'position')::integer,
                         'kind',        s ->> 'kind',
                         'required',    false,
                         'host_field',  NULL,
                         'heading',     NULL,
                         'body',        NULL)
                     ELSE jsonb_build_object(
                            'section_key',   private.dto_text(s -> 'section_key'),
                            'position',      (s ->> 'position')::integer,
                            'kind',          s ->> 'kind',
                            'required',      CASE WHEN jsonb_typeof(s -> 'required') = 'boolean'
                                             THEN (s ->> 'required')::boolean END,
                            'host_field',    CASE WHEN private.dto_text(s -> 'host_field')
                                                IN ('welcome', 'family_introduction',
                                                    'event_notes', 'closing')
                                             THEN private.dto_text(s -> 'host_field') END,
                            'heading',       CASE WHEN jsonb_typeof(s -> 'heading_text') = 'string'
                                             THEN jsonb_build_object(
                                               'text', private.dto_text(s -> 'heading_text'),
                                               'language', private.dto_text(s -> 'heading_language'),
                                               'fallback_used', CASE WHEN jsonb_typeof(s -> 'heading_fallback_used') = 'boolean'
                                                                 THEN (s ->> 'heading_fallback_used')::boolean END
                                             ) END,
                            'body',          CASE WHEN private.dto_text(s -> 'body_source')
                                                IN ('host', 'reviewed_pack')
                                             THEN jsonb_build_object(
                                               'source', private.dto_text(s -> 'body_source'),
                                               -- A host body carries no text of its own in the
                                               -- snapshot: the words are frozen once, in `draft`,
                                               -- and the section names the field it comes from so
                                               -- a version cannot hold two spellings of one
                                               -- paragraph. The projection follows that pointer
                                               -- here, and only for a field name the whitelist
                                               -- already allows.
                                               'text', CASE WHEN private.dto_text(s -> 'body_source') = 'host'
                                                        THEN private.dto_text(
                                                               p_snapshot -> 'draft' -> CASE
                                                                 WHEN private.dto_text(s -> 'host_field')
                                                                      IN ('welcome', 'family_introduction',
                                                                          'event_notes', 'closing')
                                                                 THEN private.dto_text(s -> 'host_field') END)
                                                        ELSE private.dto_text(s -> 'body_text') END,
                                               -- `language` and `fallback_used` describe which
                                               -- reviewed node a pack string was taken from. The
                                               -- platform does not know what language a host
                                               -- typed, so a host body reports neither, and no
                                               -- renderer may be told otherwise.
                                               'language', private.dto_text(s -> 'body_language'),
                                               'fallback_used', CASE WHEN jsonb_typeof(s -> 'body_fallback_used') = 'boolean'
                                                                 THEN (s ->> 'body_fallback_used')::boolean END,
                                               'overrode_pack_text', CASE WHEN jsonb_typeof(s -> 'overrode_pack_text') = 'boolean'
                                                                     THEN (s ->> 'overrode_pack_text')::boolean END
                                             ) END
                          ) END ORDER BY ord)
                     FROM jsonb_array_elements(p_snapshot -> 'sections' -> 'items')
                          WITH ORDINALITY AS e(s, ord)), '[]'::jsonb)
                 END;
  IF v_sections IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'title', private.dto_text(v_wedding -> 'title'),
    'language', jsonb_build_object(
      'primary', private.dto_text(v_wedding -> 'primary_language'),
      'additional', COALESCE((
        SELECT jsonb_agg(value ORDER BY ord)
          FROM jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(v_wedding -> 'additional_languages') = 'array'
                      THEN v_wedding -> 'additional_languages' ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS e(value, ord)), '[]'::jsonb)
    ),
    'style', jsonb_build_object(
      'font', CASE WHEN jsonb_typeof(v_style -> 'font') = 'string'
                    AND (v_style ->> 'font') ~ '^[A-Za-z ]{1,40}$'
              THEN (v_style ->> 'font') END,
      'fontSize', CASE WHEN jsonb_typeof(v_style -> 'fontSize') = 'string'
                        AND (v_style ->> 'fontSize') ~ '^[1-9][0-9]{0,2}$'
                  THEN (v_style ->> 'fontSize') END,
      'color', CASE WHEN jsonb_typeof(v_style -> 'color') = 'string'
                    AND (v_style ->> 'color') ~* '^#[0-9a-f]{6}$'
              THEN lower(v_style ->> 'color') END,
      'alignment', CASE WHEN v_style ->> 'alignment' IN ('left', 'center', 'right')
                  THEN (v_style ->> 'alignment') END
    ),
    'design_template', CASE WHEN jsonb_typeof(p_snapshot -> 'design_template') = 'object'
      THEN jsonb_build_object(
        'display_name', private.dto_text(p_snapshot -> 'design_template' -> 'display_name'),
        'template_key', private.dto_text(p_snapshot -> 'design_template' -> 'template_key'),
        'revision', CASE WHEN jsonb_typeof(p_snapshot -> 'design_template' -> 'revision') = 'number'
                THEN (p_snapshot -> 'design_template' ->> 'revision')::integer END
      ) END,
    'tradition_pack', CASE WHEN jsonb_typeof(p_snapshot -> 'tradition_pack_release') = 'object'
      THEN jsonb_build_object(
        'display_name', private.dto_text(p_snapshot -> 'tradition_pack_release' -> 'display_name'),
        'pack_key', private.dto_text(p_snapshot -> 'tradition_pack_release' -> 'pack_key'),
        'release_number', CASE WHEN jsonb_typeof(p_snapshot -> 'tradition_pack_release' -> 'release_number') = 'number'
                THEN (p_snapshot -> 'tradition_pack_release' ->> 'release_number')::integer END
      ) END,
    -- The requested language, so a host preview can say "Tamil was asked for and this
    -- heading is English" in the host's own words. The guest sees the substitution
    -- either way; only the explanation is host-side.
    'sections', jsonb_build_object(
      'requested', private.dto_text(p_snapshot -> 'sections' -> 'requested'),
      'items', v_sections
    ),
    'people', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'display_name', private.dto_text(row_value -> 'display_name'),
               'role_key', private.dto_text(row_value -> 'role_key'),
               'role_label', private.dto_text(row_value -> 'role_label'),
               'group_key', private.dto_text(row_value -> 'group_key'),
               'group_label', private.dto_text(row_value -> 'group_label')
             ) ORDER BY ord)
        FROM jsonb_array_elements(p_snapshot -> 'people')
             WITH ORDINALITY AS e(row_value, ord)), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'event_key', private.dto_text(row_value -> 'event_key'),
               'display_name', private.dto_text(row_value -> 'display_name'),
               'starts_at_local', private.dto_text(row_value -> 'starts_at_local'),
               'ends_at_local', private.dto_text(row_value -> 'ends_at_local'),
               'timezone', private.dto_text(row_value -> 'timezone'),
               'venue', CASE WHEN jsonb_typeof(row_value -> 'venue') = 'object'
                 THEN jsonb_build_object(
                   'name', private.dto_text(row_value -> 'venue' -> 'name'),
                   'address_text', private.dto_text(row_value -> 'venue' -> 'address_text'),
                   'map_url', private.map_link_or_null(row_value -> 'venue' -> 'map_url')
                 ) END
             ) ORDER BY ord)
        FROM jsonb_array_elements(p_snapshot -> 'events')
             WITH ORDINALITY AS e(row_value, ord)), '[]'::jsonb),
    'welcome', private.dto_text(v_draft -> 'welcome'),
    'family_introduction', private.dto_text(v_draft -> 'family_introduction'),
    'event_notes', private.dto_text(v_draft -> 'event_notes'),
    'closing', private.dto_text(v_draft -> 'closing')
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.public_invitation_dto(integer, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 8. THE TWO CALLERS THAT NAMED THE OLD SHAPE
-- ===========================================================================

CREATE OR REPLACE FUNCTION internal_api.create_invitation_version(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner  uuid;
  v_lang   text;
  v_draft  public.invitation_drafts%ROWTYPE;
  v_snap   jsonb;
  v_issues text[];
  v_number integer;
  v_prev   uuid;
  v_id     uuid;
  v_try    integer := 0;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not create a version of this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT w.primary_language INTO v_lang FROM public.weddings w WHERE w.id = p_wedding_id;
  IF v_lang IS NULL THEN
    RAISE EXCEPTION 'choose the invitation language before creating a version'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_draft FROM public.invitation_drafts d WHERE d.wedding_id = p_wedding_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this wedding has no invitation draft'
      USING ERRCODE = 'raise_exception';
  END IF;

  v_snap := private.build_invitation_snapshot(p_wedding_id);

  -- §O: the version a guest reads must not be creatable while the document it would
  -- freeze is unresolved. The host's editor warns about the same list; this is the half
  -- that makes the warning a constraint rather than a suggestion, and it runs on the
  -- resolved document rather than on the definition because the resolution is where a
  -- missing translation, a host override and a fallback rule all become one answer.
  --
  -- The release's *status* is not checked here: `versions_pack_release_gate` refuses it
  -- at the INSERT below, which is the stronger place because it holds for any writer, not
  -- only for this RPC.
  v_issues := private.invitation_freeze_issues(v_snap);
  IF cardinality(v_issues) > 0 THEN
    RAISE EXCEPTION 'this invitation cannot be frozen yet: %', array_to_string(v_issues, '; ')
      USING ERRCODE = 'check_violation';
  END IF;

  LOOP
    v_try := v_try + 1;
    SELECT coalesce(max(v.version_number), 0) + 1,
           (array_agg(v.id ORDER BY v.version_number DESC))[1]
      INTO v_number, v_prev
      FROM public.invitation_versions v
     WHERE v.wedding_id = p_wedding_id;

    BEGIN
      -- 2 is the shape `private.build_invitation_snapshot` now writes and the only shape
      -- `private.public_invitation_dto` will project. They are stated here rather than
      -- derived because a version that records a shape it does not have would be the
      -- worst kind of lie: silent, and discovered by a guest.
      INSERT INTO public.invitation_versions (
        wedding_id, version_number, snapshot, snapshot_schema_version,
        tradition_pack_release_id, design_template_id, created_by, supersedes_version_id
      )
      SELECT p_wedding_id, v_number, v_snap, 2,
             w.tradition_pack_release_id, w.design_template_id, v_owner, v_prev
        FROM public.weddings w WHERE w.id = p_wedding_id
      RETURNING id INTO v_id;

      RETURN jsonb_build_object(
        'version_id', v_id,
        'version_number', v_number,
        'snapshot', v_snap
      );
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 3 THEN
        RAISE EXCEPTION 'too many versions were being created at once; try again'
          USING ERRCODE = 'raise_exception';
      END IF;
    END;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION internal_api.preview_invitation(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_dto   jsonb;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not preview this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_dto := private.public_invitation_dto(2, private.build_invitation_snapshot(p_wedding_id));
  IF v_dto IS NULL THEN
    RAISE EXCEPTION 'this invitation cannot be previewed as it is currently written'
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN v_dto;
END;
$$;

-- ===========================================================================
-- 9. PRIVILEGES AND ROW POLICIES
-- ===========================================================================

-- Explicit, because this table is created after Stage 2's blanket revoke and a new table
-- in `public` would otherwise keep whatever the hosting layer's default privileges hand
-- out. `service_role` keeps its inherited write path — that is the content-maintenance
-- identity, and the triggers in §3 are what govern it.
--
-- The customer half is a *column* grant, and the reason is the difference between a filter
-- and a gate. A table-level SELECT would let any logged-in account name `review_label`,
-- `review_basis`, `review_scope`, `reviewed_at`, `author_label`, `machine_assistance_notes`,
-- `source_reference` or `changelog` on a release it is allowed to see — and "the UI does not
-- display it" is a statement about this build, while a column the role cannot SELECT is a
-- statement about the database. Directive §12 forbids exposing a reviewer's qualification
-- because provenance exists internally; directive §17 asks for the catalogue to carry only
-- customer-safe fields. Both are satisfied by exactly one mechanism: the seven columns below
-- are what a browser is *able* to read, and they are the seven the adapter reads.
--
-- Which seven, and why each one is not cuttable:
--   id, pack_id, release_number   the release's name, in the concept it belongs to, and
--                                 which number of it this is — what a credit line shows.
--   status                        the selection and freeze gates read it as the calling role,
--                                 and the editor's "this pack has been retired" note is derived
--                                 from it. A gate that cannot read the column it gates on is a
--                                 gate that answers "not readable" for everything.
--   languages                     the coverage a host chooses on.
--   definition                    the reviewed wording itself, which is this release's content
--                                 and resolves into the host's own invitation.
--   definition_schema_version     so a build can refuse a contract it does not understand by
--                                 name rather than render half of it.
-- Deliberately absent: the review record, the authorship record, the machine-assistance
-- disclosure, the source reference, the changelog, and the three lifecycle timestamps — the
-- last because `approved_at`/`deprecated_at` answer "when did the platform change this", which
-- is maintenance's diary rather than the host's fact, and because `status` already carries the
-- present-tense answer the editor needs.
REVOKE ALL ON public.tradition_pack_releases FROM PUBLIC, anon;
REVOKE ALL ON public.tradition_pack_releases FROM authenticated;
GRANT SELECT (id, pack_id, release_number, status, languages, definition,
              definition_schema_version)
  ON public.tradition_pack_releases TO authenticated;

ALTER TABLE public.tradition_pack_releases ENABLE ROW LEVEL SECURITY;

-- Directive §9: "read access only to the subset they genuinely need". A customer reads
-- approved releases — the selectable catalogue — and the one retired release their own
-- wedding already points at. Reviewer ruling A1 asks for the second half by name: a
-- deprecated release "may remain referenced by an existing wedding for historical
-- visibility", and a wedding that cannot read the row it references would be holding an
-- id rather than a fact. So the editor can say "the pack you chose has been retired"
-- (§N) instead of showing a blank where a choice used to be.
--
-- The widening cannot leak an unpublished release, and that is structural rather than a
-- matter of care: `weddings_pack_release_gate` refuses a selection of anything that is not
-- approved at the moment of selection, so the only releases a wedding can ever point at
-- are ones that were approved once. A draft or a reviewed candidate stays invisible, which
-- is what makes §10's "never show the draft candidate" a property of the database rather
-- than of a filter in React.
CREATE POLICY users_read_approved_and_own_retired_pack_releases
  ON public.tradition_pack_releases
  FOR SELECT TO authenticated USING (
    status = 'approved'
    OR (status = 'deprecated' AND id IN (
          SELECT w.tradition_pack_release_id FROM public.weddings w
           WHERE w.owner_user_id = auth.uid())));

-- A pack concept is only interesting once it has something to choose. Hiding the concept
-- row of an unshipped pack is what stops a name and a scope statement being readable as
-- a promise.
CREATE POLICY users_read_packs_with_approved_releases ON public.tradition_packs
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.tradition_pack_releases r
    WHERE r.pack_id = tradition_packs.id AND r.status = 'approved'));

-- ===========================================================================
-- 10. WHAT THIS FILE LEAVES ALONE, AND WHY
-- ===========================================================================

-- `design_templates` keeps its `status IN ('draft','approved')` read policy. The reason
-- Stage 2 gave for it — a migrated legacy template has never been reviewed, and a picker
-- that hides drafts would go blank — still holds there and does not hold for tradition
-- packs, whose table is empty and whose content is the sensitive half of the product.
-- Two catalogue tables with different visibility rules is the correct outcome of reading
-- each one's reason rather than copying the shape.
