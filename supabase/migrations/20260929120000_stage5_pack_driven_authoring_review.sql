-- ===========================================================================
-- VIVAAHVARNAM — STAGE 5: pack-driven authoring, server-side required content,
-- review binding, and the maintenance-only privileged surface.
--
-- FORWARD ONLY. Nothing in this file edits a Stage 0-4 migration; every Stage 4
-- behaviour that stays is re-declared here, and every behaviour that changes is
-- gated on `definition_schema_version`, so a release authored under Stage 4's
-- contract keeps resolving, freezing, projecting and reviewing exactly as it did.
-- The Stage 4 battery's exact-sentence assertions on
-- `private.invitation_freeze_issues` are what make that claim checkable rather than
-- intended.
--
-- What Stage 5 adds, in one sentence each:
--   * a second definition contract version, which is how a release says whether the
--     host may override reviewed wording, must supply the wording themselves, or may
--     not touch a line at all — and how a required list of people or ceremonies becomes
--     something a freeze refuses rather than something a browser warns about;
--   * one machine-readable issue engine, which the freeze and the host preview now read
--     from the same computation;
--   * a review bound to a SHA-256 over the exact bytes a reviewer was shown, computed
--     inside Postgres, assigned by the guard rather than by the caller, and re-checked at
--     approval;
--   * a maintenance surface narrow enough to drive a local CLI, with no browser door and
--     no exposed wrapper.
--
-- What it deliberately does NOT add: a table, a `kind`, a resolved-section field, a
-- snapshot field, or a second resolver. Each of those was considered and refused, and
-- §3 of docs/audits/stage-5-pack-driven-authoring-review.md records the measured reason
-- — Stage 4's own assertions pin the resolved-section field set at thirteen and the
-- frozen release block at eleven, and `private.public_invitation_dto` refuses any
-- snapshot whose `snapshot_schema_version` is not 2, so widening either would make
-- already-frozen invitations unreadable. The four provenance states this stage needs are
-- already total and exclusive over fields that exist.
-- ===========================================================================

-- ===========================================================================
-- 1. THE ONE NEW COLUMN, AND WHY IT IS A COLUMN
-- ===========================================================================

-- Every other Stage 5 fact rides inside the existing JSON definition, because a
-- definition is already validated on write and hashed on review, and a column would add
-- a second place for the same fact to be wrong. This one cannot live in the definition:
-- it is a statement *about* the definition, written at the moment a reviewer signs it,
-- and storing it inside the hashed material would be a hash that contains itself.
--
-- Shape-constrained, so a value that is not a lowercase SHA-256 hex digest cannot be
-- written even by a role that skips the trigger.
ALTER TABLE public.tradition_pack_releases
  ADD COLUMN review_packet_hash text;

ALTER TABLE public.tradition_pack_releases
  ADD CONSTRAINT tradition_pack_releases_review_hash_shape CHECK (
    review_packet_hash IS NULL
    OR review_packet_hash ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN public.tradition_pack_releases.review_packet_hash IS
  'The SHA-256 of the canonical review payload for this release''s exact reviewable '
  'material, recorded by the lifecycle guard during draft -> reviewed and re-compared at '
  'approval. It is a binding, not a claim: it proves which bytes a review record describes, '
  'never that a person of standing read them — `review_basis` is the field that claims (or '
  'refuses to claim) that, and it is the author''s and reviewer''s own words. Three of the '
  'hashed fields (the pack''s key, display name and scope statement) are read from the pack '
  'row rather than copied onto the release, so a later edit to the pack row leaves this digest '
  'describing the material as it stood at review time: that drift is detectable, through '
  '`inspect_tradition_pack_release`''s `binding_current`, and it is not prevented, because the '
  'pack row is shared by every release of the pack. See FINDING 4 of the §33 closure section.';

-- The column is present and shape-checked, but "a release past draft carries one" is
-- enforced by the guard rather than by a NOT NULL-style CHECK, and that is a decision
-- rather than an oversight. A table CHECK is validated against every existing row when it
-- is added, and this database legitimately contains reviewed and approved Stage 4 fixture
-- releases with no hash — they were reviewed before a binding existed. The two ways to
-- satisfy such a constraint would be to delete history, which Stage 4's guard makes
-- impossible and which would be the worse act, or to backfill hashes over material nobody
-- ever bound, which would be inventing review evidence. The guard refuses the same thing
-- for every write from now on, which is where the guarantee has to bite anyway.

-- ===========================================================================
-- 2. CANONICAL SERIALISATION AND THE REVIEW HASH
-- ===========================================================================

-- Determinism is the whole property. A hash that moves because a session's collation, or
-- a key insertion order, or a numeric formatting choice moved, would invalidate reviews
-- for a reason no reviewer can see and no operator can explain. So every order in here is
-- pinned with `COLLATE "C"`, which is byte order and does not answer to locale — the same
-- instrument Stage 4's inventory assertions use to pin aggregation order.
CREATE FUNCTION private.jsonb_canonical(p_value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_key   text;
  v_elem  jsonb;
  v_out   text;
BEGIN
  IF p_value IS NULL THEN RETURN 'NULL'; END IF;
  IF p_value = 'null'::jsonb THEN RETURN 'null'; END IF;

  IF jsonb_typeof(p_value) = 'object' THEN
    v_out := '{';
    FOR v_key IN SELECT k FROM jsonb_object_keys(p_value) k
                  ORDER BY k COLLATE "C" LOOP
      IF v_out <> '{' THEN v_out := v_out || ','; END IF;
      v_out := v_out || private.canonical_token(v_key) || ':'
                     || private.jsonb_canonical(p_value -> v_key);
    END LOOP;
    RETURN v_out || '}';
  END IF;

  IF jsonb_typeof(p_value) = 'array' THEN
    v_out := '[';
    -- Array order is *content*: two sections in the other order are a different
    -- invitation, so this loop preserves it rather than sorting.
    FOR v_elem IN SELECT e FROM jsonb_array_elements(p_value) e LOOP
      IF v_out <> '[' THEN v_out := v_out || ','; END IF;
      v_out := v_out || private.jsonb_canonical(v_elem);
    END LOOP;
    RETURN v_out || ']';
  END IF;

  IF jsonb_typeof(p_value) = 'string' THEN
    RETURN private.canonical_token(p_value #>> '{}');
  END IF;

  -- A jsonb number or boolean has exactly one text form, which is why this returns the
  -- stored text rather than re-formatting anything: `28.0` and `28` are the same value and
  -- arrive here identically, and a hand-rolled numeric formatter would be one more thing
  -- that could disagree with itself across a version.
  RETURN p_value #>> '{}';
END;
$$;

-- One token, quoted when it is a string, and — because the payload is line-based and reviewable
-- material is allowed to contain a newline — escaped so that a string *inside* a canonical
-- definition cannot forge a line of the manifest it is inside. The scope of this sentence is the
-- token layer: the fields handed to `review_field` below are written as they are stored, so a
-- value that itself contains a line break appears in the payload as one line break, and the digest
-- still binds it exactly (that value is part of the hashed bytes) while the printed manifest stops
-- describing one field per line. The Stage 5 audit's §33 closure section records this as FINDING 2,
-- its reach (the maintenance identity, which is the only party that can write any of these fields)
-- and why the repair was not taken inside this stage: escaping at render time moves every digest
-- already recorded in the catalogue.
CREATE FUNCTION private.canonical_token(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT '"' || replace(replace(replace(coalesce(p_text, ''),
                 '\', '\\'), '"', '\"'), chr(10), '\n') || '"'
$$;

-- A field of the payload manifest: name, byte length, value. The length is what makes
-- `NULL` and the empty string two different facts, and makes a truncated value a different
-- hash rather than the same one. It is also what a reader checks when a value's own text
-- contains a line break: the length belongs to the value, and a line that claims a length it
-- does not have is the tell.
CREATE FUNCTION private.review_field(p_name text, p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT p_name || chr(9)
         || CASE WHEN p_value IS NULL THEN '-1'
                 ELSE octet_length(p_value)::text END
         || chr(9) || coalesce(p_value, 'NULL');
$$;

REVOKE ALL ON FUNCTION private.jsonb_canonical(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.canonical_token(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.review_field(text, text) FROM PUBLIC, anon, authenticated;

-- The canonical review payload (§E, §9).
--
-- Covered: everything whose change should invalidate a review — the pack's own identity
-- and scope sentence, the release number, the contract version, the language coverage, the
-- definition, and the authorship/machine-assistance/source/changelog record a cultural
-- reviewer reads to decide what they are being asked to vouch for.
--
-- Not covered, each for a reason that can be stated:
--   * `id`, `pack_id` — a surrogate identifier changes nothing a reader saw.
--   * `status`, `created_at`, `updated_at`, `approved_at`, `deprecated_at` — operational
--     state that moves independently of content, and `updated_at` moves on *every* write.
--   * `review_label`, `review_basis`, `review_scope`, `reviewed_languages`, `reviewed_by`,
--     `reviewed_at` — these are the reviewer's ANSWER. They are written in the same
--     statement as the hash, so hashing them would make draft → reviewed unsatisfiable by
--     construction: the value to match would not exist until the moment it is matched.
--   * `review_packet_hash` — a hash of a payload containing itself.
--
-- The release's own values arrive as arguments rather than being read back from the table,
-- because the only caller that matters most of the time is a BEFORE trigger, whose view of
-- the row is `NEW` and not the table. The pack row is the one thing read here: it is a
-- different table, so the trigger is not looking at its own uncommitted write.
CREATE FUNCTION private.tradition_pack_review_payload(
  p_pack_id uuid,
  p_release_number integer,
  p_definition_schema_version integer,
  p_languages text[],
  p_definition jsonb,
  p_author_label text,
  p_machine_assisted boolean,
  p_machine_assistance_notes text,
  p_source_reference text,
  p_changelog text
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_pack   record;
  v_out    text := 'VIVAAHVARNAM-REVIEW-PAYLOAD/1' || chr(10);
BEGIN
  SELECT p.pack_key, p.display_name, p.scope_statement INTO v_pack
    FROM public.tradition_packs p WHERE p.id = p_pack_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the pack this release belongs to cannot be read, so its review '
                    'material cannot be hashed'
      USING ERRCODE = 'raise_exception';
  END IF;

  v_out := v_out || private.review_field('pack_key', v_pack.pack_key) || chr(10)
                 || private.review_field('pack_display_name', v_pack.display_name) || chr(10)
                 || private.review_field('pack_scope_statement', v_pack.scope_statement) || chr(10)
                 || private.review_field('release_number', p_release_number::text) || chr(10)
                 || private.review_field('definition_schema_version',
                                         p_definition_schema_version::text) || chr(10)
                 -- Languages as a sorted, comma-joined set: the column is already pinned
                 -- sorted and duplicate-free by the Stage 4 guard, so this is a restatement
                 -- of a fact the row already guarantees rather than a new order to agree on.
                 || private.review_field('languages',
                                         (SELECT string_agg(l, ',' ORDER BY l COLLATE "C")
                                            FROM unnest(coalesce(p_languages, '{}'::text[])) l)) || chr(10)
                 || private.review_field('definition', private.jsonb_canonical(p_definition)) || chr(10)
                 || private.review_field('author_label', p_author_label) || chr(10)
                 || private.review_field('machine_assisted',
                                         CASE WHEN p_machine_assisted IS NULL THEN NULL
                                              ELSE p_machine_assisted::text END) || chr(10)
                 || private.review_field('machine_assistance_notes', p_machine_assistance_notes) || chr(10)
                 || private.review_field('source_reference', p_source_reference) || chr(10)
                 || private.review_field('changelog', p_changelog) || chr(10);
  RETURN v_out;
END;
$$;

-- The authoritative digest. Core Postgres `sha256(bytea)`, not pgcrypto's `digest()`:
-- measured available in the live local stack and, more to the point, in the throwaway
-- databases the SQL batteries create — so the review-binding guarantee does not depend on
-- an extension having been installed somewhere. `extensions.pgcrypto` is present too, and
-- §11 of the Stage 5 audit records both measurements.
CREATE FUNCTION private.tradition_pack_review_hash(
  p_pack_id uuid,
  p_release_number integer,
  p_definition_schema_version integer,
  p_languages text[],
  p_definition jsonb,
  p_author_label text,
  p_machine_assisted boolean,
  p_machine_assistance_notes text,
  p_source_reference text,
  p_changelog text
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_payload text;
BEGIN
  v_payload := private.tradition_pack_review_payload(
    p_pack_id, p_release_number, p_definition_schema_version, p_languages, p_definition,
    p_author_label, p_machine_assisted, p_machine_assistance_notes, p_source_reference,
    p_changelog);
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'the review payload could not be formed, so nothing can be hashed'
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN encode(sha256(v_payload::bytea), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION private.tradition_pack_review_payload(
  uuid, integer, integer, text[], jsonb, text, boolean, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.tradition_pack_review_hash(
  uuid, integer, integer, text[], jsonb, text, boolean, text, text, text)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ the guard's one nested call
-- `private.guard_tradition_pack_release()` is SECURITY INVOKER and stays that way: Stage 2's
-- `40_catalog.sql` C32b names it among the pack gates that must not run as the owner, because
-- a definer body decides against the privileged schema's view instead of the caller's. Being
-- INVOKER has a consequence this file has to meet rather than argue around: when the trigger
-- computes the hash, the privilege check for the nested call is against *whoever issued the
-- UPDATE*, and the functions it reaches (`_hash` -> `_payload` -> `review_field`,
-- `jsonb_canonical`, `canonical_token`) have just been revoked from PUBLIC, which also
-- removes them from `service_role`, since it held them only through PUBLIC.
--
-- So the five are granted back to `service_role` specifically. The reasoning, in the order
-- that matters:
--   * `service_role` is the trusted backend, and Stage 2 measured and recorded that it is
--     the role with write access to the catalogue (`C60 the trusted backend does reach a new
--     public table`). It could already move a release from draft to reviewed; letting it do
--     so is not new authority. What would be new is a lifecycle that *half*-works for it —
--     a transition that raises 42501 from inside a trigger is an operation that fails with
--     a message about privileges rather than a statement about the content.
--   * The alternative fixes were rejected, not overlooked. Inlining the payload into the
--     guard duplicates "what a review covers" in two places, and the second one can drift.
--     Making the guard or the hasher SECURITY DEFINER is refused by C32b and would let a
--     caller read `public.tradition_packs` through a function rather than through its own
--     table privileges. Narrowing `service_role`'s write access to the catalogue to dodge
--     the problem would silently withdraw a Stage 2 guarantee and would break the Stage 4
--     lifecycle fixture, which walks a release as exactly this role.
--   * Nothing browser-reachable changes. `anon` and `authenticated` hold neither USAGE on
--     `private` (measured by Stage 2's C61/C62) nor EXECUTE on any of these five, and the
--     customer-facing path never needs them: the preview and freeze RPCs are SECURITY
--     DEFINER, so their nested calls run as the owner. The only roles that fire this
--     trigger directly are the owner and `service_role`.
--   * `supabase_admin` is deliberately absent. It is not created by
--     `supabase/tests/rls/00_bootstrap.sql`, and Stage 2 :132 records that naming a
--     nonexistent role raises 42704 — a grant to it would make this migration unappliable
--     in the throwaway qualification databases, which is where every other guarantee in
--     this repository is measured.
GRANT EXECUTE ON FUNCTION private.tradition_pack_review_hash(
  uuid, integer, integer, text[], jsonb, text, boolean, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION private.tradition_pack_review_payload(
  uuid, integer, integer, text[], jsonb, text, boolean, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION private.review_field(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION private.jsonb_canonical(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION private.canonical_token(text) TO service_role;

COMMENT ON FUNCTION private.tradition_pack_review_hash(
  uuid, integer, integer, text[], jsonb, text, boolean, text, text, text) IS
  'The one implementation of "what a review covers". Called by the lifecycle guard and by '
  'the maintenance surface, which is why a packet rendered by the CLI and a hash stored in '
  'the table cannot disagree about the material: they read the same function or the CLI has '
  'nothing to display.';

-- ===========================================================================
-- 3. THE RELEASE GUARD, v2 — forward re-declaration of the Stage 4 function
-- ===========================================================================

-- Re-declared whole, because the arms that change are interleaved with the arms that do
-- not, and a patch-style rewrite of a trigger is how a rule gets lost. Everything not
-- called out below is the Stage 4 body, unchanged.
--
-- What changed, and where the reason lives:
--   (a) `definition_schema_version` now understands 1 and 2.
--   (b) A v2 section may declare `override_rule` and, on an event list, `requires_venue`.
--   (c) `review_packet_hash` is assigned here during draft → reviewed and nowhere else, and
--       re-compared at reviewed → approved.
--   (d) The review-record immutability tuple now includes the hash column.
--
-- The Stage 4 file's note that this function "calls no other `private` function, because it
-- is SECURITY INVOKER and a nested call would be privilege-checked against whoever issued
-- the statement" still stands as a warning, and this version now has to live with it: the
-- hash cannot be computed without a function, and duplicating the payload inside the
-- trigger would put two implementations of "what a review covers" where one of them can
-- drift. The consequence is met by the grant block above §4 rather than assumed away — the
-- five functions this body reaches are executable by the owner and by `service_role`, and by
-- no one else, which is measured by the Stage 5 battery.
CREATE OR REPLACE FUNCTION private.guard_tradition_pack_release() RETURNS trigger
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
  v_v         integer;
  v_rule      text;
BEGIN
  -- ---------------------------------------------------------------- delete
  IF TG_OP = 'DELETE' THEN
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
  -- (a) Two contract versions are understood. The rule behind the change is unchanged and
  -- worth restating, because it is the reason a version number exists at all: a build that
  -- cannot interpret a definition must refuse it by name rather than render half of it.
  -- What "understood" now covers is written down once, in
  -- docs/audits/stage-5-pack-driven-authoring-review.md §3, as the v1 → v2 statement.
  IF NEW.definition_schema_version NOT IN (1, 2) THEN
    RAISE EXCEPTION
      'definition schema version % is not understood by this build, so it cannot be validated',
      NEW.definition_schema_version
      USING ERRCODE = 'check_violation';
  END IF;
  v_v := NEW.definition_schema_version;
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
  -- Every "this must be present and of shape X" claim below keeps the
  -- `key IS NULL OR jsonb_typeof(key) <> 'X'` form. The NULL trap that four of these rules
  -- fell into while they were being written is documented in the Stage 4 file at
  -- :277-285, and the absence cases are re-probed by 50_pack_release.sql; a rewrite is
  -- exactly when a bare `<>` would creep back in.
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
    -- (b) The v2 section vocabulary is the v1 one plus two fields, and the two are refused
    -- outright on a v1 definition. That asymmetry is the compatibility rule in force rather
    -- than in prose: a release that claims version 1 cannot carry version 2 semantics, so an
    -- old build and a new build read the same bytes the same way.
    --
    -- Both clauses are load-bearing and the order of them is not a style choice: the first
    -- list has to *contain* the two new keys, or the rule that permits them on a v2 row can
    -- never be reached. `supabase/tests/stage5/50_review_binding.sql` was the thing that found
    -- this — it authored a v2 definition and the guard refused its own new vocabulary. A
    -- whitelist that omits the fields it was written to allow is a defect no version-1 row can
    -- notice, which is exactly why the Stage 5 battery authors version-2 material rather than
    -- only asserting about it. The message is shared by both clauses, so on a version-2 row it
    -- can only ever mean the first one; the wording is kept as Stage 4 pinned it.
    SELECT array_agg(k ORDER BY k) INTO v_keys
      FROM jsonb_object_keys(v_section) k
     WHERE k NOT IN ('section_key', 'position', 'kind', 'required', 'host_field',
                     'heading', 'pack_text', 'allow_english_fallback',
                     'override_rule', 'requires_venue')
        OR (v_v = 1 AND k IN ('override_rule', 'requires_venue'));
    IF v_keys IS NOT NULL THEN
      RAISE EXCEPTION 'section % carries unknown keys, or version-2 keys on a version-% '
                      'definition: %',
        COALESCE(v_section ->> 'section_key', '(unnamed)'), v_v, v_keys
        USING ERRCODE = 'check_violation';
    END IF;

    -- The closed slot list is Stage 4's, unchanged, and unchanged for a reason: these are
    -- product slots with a place to put them, not a taxonomy of rites. Adding a slot is a
    -- code change with a renderer beside it.
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
    IF v_pos < 1 OR v_pos > v_total THEN
      RAISE EXCEPTION 'section % has position % outside 1..%', v_key, v_pos, v_total
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_pos = ANY (v_seen_pos) THEN
      RAISE EXCEPTION 'position % is claimed by two sections', v_pos
        USING ERRCODE = 'check_violation';
    END IF;
    v_seen_pos := v_seen_pos || v_pos;

    -- The kind vocabulary does not grow. §3.2 of the Stage 5 audit records why: a section
    -- names a *drawing rule*, and the two new facts are about which resource a drawing rule
    -- needs and whose words may fill it, neither of which is a new way to draw.
    v_kind := v_section ->> 'kind';
    IF v_kind IS NULL OR v_kind NOT IN ('text', 'people_list', 'event_list') THEN
      RAISE EXCEPTION 'section % claims kind % that no renderer knows', v_key,
        COALESCE(v_kind, '(none)') USING ERRCODE = 'check_violation';
    END IF;
    IF v_kind IN ('people_list', 'event_list') THEN
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
    IF COALESCE((v_section ->> 'allow_english_fallback')::boolean, false)
       AND NOT ('en' = ANY (NEW.languages)) THEN
      RAISE EXCEPTION
        'section % allows an English fallback but this release does not cover en', v_key
        USING ERRCODE = 'check_violation';
    END IF;

    -- (b) The two v2 declarations, validated only for a v2 definition. Both are inert on a
    -- v1 row because the key is refused there at all, so this block cannot change what an
    -- existing release means.
    IF v_section ? 'override_rule' THEN
      IF jsonb_typeof(v_section -> 'override_rule') <> 'string' THEN
        RAISE EXCEPTION 'section % must declare override_rule as one of the three rules this '
                        'build knows', v_key USING ERRCODE = 'check_violation';
      END IF;
      v_rule := v_section ->> 'override_rule';
      IF v_rule NOT IN ('host_may_replace', 'pack_only', 'host_must_supply') THEN
        RAISE EXCEPTION 'section % declares override_rule %, which is not one of '
                        'host_may_replace, pack_only or host_must_supply', v_key,
          COALESCE(v_rule, '(none)') USING ERRCODE = 'check_violation';
      END IF;
      -- Only a prose section has wording that could be overridden, and a list section has
      -- no host field to permit in the first place. Refusing the mismatch here is what keeps
      -- the resolver from having to invent a meaning for it.
      IF v_kind <> 'text' THEN
        RAISE EXCEPTION 'section % is a % and has no reviewed wording for an override rule to '
                        'govern', v_key, v_kind USING ERRCODE = 'check_violation';
      END IF;
      IF v_rule = 'host_must_supply' THEN
        -- The release says "this line is yours alone". It cannot also offer wording: the two
        -- declarations disagree about who the author is, and the resolver would have to pick.
        IF jsonb_typeof(v_section -> 'pack_text') <> 'null' AND v_section ? 'pack_text' THEN
          RAISE EXCEPTION 'section % must be written by the host but this release offers '
                          'wording for it anyway', v_key
            USING ERRCODE = 'check_violation';
        END IF;
        IF NOT (v_section ? 'host_field')
           OR jsonb_typeof(v_section -> 'host_field') <> 'string' THEN
          RAISE EXCEPTION 'section % must be written by the host but reads no host field, so '
                          'nobody could supply it', v_key
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      IF v_rule = 'pack_only' THEN
        -- "This wording is reviewed and stays reviewed" is a claim about reviewed wording, so
        -- a section with none is the claim with nothing to attach it to. The absence test is
        -- written as `NOT (… ? …) OR` rather than as a bare `jsonb_typeof(…) <> 'object'`,
        -- because a missing key makes `jsonb_typeof` return NULL, and NULL is not `<> 'object'`
        -- — the trap the note at the top of this walk says every arm keeps out of. Stage 5's
        -- own battery found this arm failing to fire: `supabase/tests/stage5/60_definition_vocabulary.sql`
        -- R07 writes a `pack_only` section with no `pack_text` at all and requires a refusal.
        IF NOT (v_section ? 'pack_text')
           OR jsonb_typeof(v_section -> 'pack_text') <> 'object' THEN
          RAISE EXCEPTION 'section % may not be overridden but carries no reviewed wording to '
                          'show instead', v_key USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;

    IF v_section ? 'requires_venue' THEN
      IF jsonb_typeof(v_section -> 'requires_venue') <> 'boolean' THEN
        RAISE EXCEPTION 'section % must declare requires_venue as a boolean', v_key
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_kind <> 'event_list' THEN
        RAISE EXCEPTION 'section % is a % and does not draw events, so it cannot require a '
                        'venue', v_key, v_kind USING ERRCODE = 'check_violation';
      END IF;
    END IF;

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

    IF v_kind = 'text'
       AND NOT (v_section ? 'heading')
       AND NOT (v_section ? 'pack_text')
       AND NOT (v_section ? 'host_field') THEN
      RAISE EXCEPTION 'section % says nothing: no heading, no reviewed wording, no host field',
        v_key USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  IF NEW.definition ? 'event_vocabulary' THEN
    IF jsonb_typeof(NEW.definition -> 'event_vocabulary') <> 'array'
       OR jsonb_array_length(NEW.definition -> 'event_vocabulary') > 50 THEN
      RAISE EXCEPTION 'event_vocabulary must be an array of at most 50 entries'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1
                 FROM jsonb_array_elements(NEW.definition -> 'event_vocabulary') ev
                WHERE jsonb_typeof(ev) <> 'object'
                   -- Both presence tests are written out rather than left to `jsonb_typeof`,
                   -- which returns NULL for a missing key: `NULL <> 'string'` is NULL, so an
                   -- entry with no `event_key` at all would satisfy none of the clauses and be
                   -- accepted. The same trap is what R07 in
                   -- `supabase/tests/stage5/60_definition_vocabulary.sql` caught on the
                   -- `pack_only` arm, and this block is the one place in the guard where Stage 4
                   -- had already written it. Repairing it here is a forward change to a function
                   -- Stage 5 re-declares anyway, and it can only turn an accepted definition into
                   -- a refused one, so no Stage 4 expectation moves.
                   OR NOT (ev ? 'event_key')
                   OR jsonb_typeof(ev -> 'event_key') <> 'string'
                   OR (ev ->> 'event_key') !~ '^[a-z][a-z0-9_]{0,39}$'
                   OR NOT (ev ? 'labels')
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

  IF TG_OP = 'INSERT' THEN
    -- A brand new row is a draft, a draft carries no review, and therefore a draft carries
    -- no binding either. Stated here because the INSERT path returns before the UPDATE rules
    -- below, and `OLD` is not addressable in an INSERT trigger at all.
    IF NEW.review_packet_hash IS NOT NULL THEN
      RAISE EXCEPTION 'a release born as draft cannot already carry a review binding';
    END IF;
    RETURN NEW;
  END IF;

  -- ------------------------------------------------------ who may write the hash
  -- (c) One writer: this trigger, at one edge. A caller that sets the column on a row that
  -- is not moving draft → reviewed has it put back exactly where it was, rather than being
  -- refused for a reason that would leak the shape of the row. Setting a *different* hash on
  -- the review edge is equally pointless — the value assigned below overwrites it — which is
  -- the whole answer to "can a caller forge a hash": not from any direction, because the
  -- only code that produces one is a function of the material in front of it.
  --
  -- "Not moving draft → reviewed" is therefore the condition, and it is written that way
  -- rather than as `NEW.status = 'draft'`. The narrower test left the two later edges open:
  -- `UPDATE ... SET status = 'approved', review_packet_hash = <64 hex>` cleared the guard,
  -- because the approval arm below validates the *stored* pair and never reads what the
  -- caller put in NEW, and the immutability tuple above deliberately excludes the hash (the
  -- review edge has to be able to write it). Same shape on approved → deprecated. Both were
  -- reachable only from a trusted role that already owns the catalogue — never from
  -- `anon`/`authenticated`, which hold column-level SELECT and are refused by
  -- `private.reject_client_write` — so this is not a browser-reachable forgery. It is
  -- nonetheless the invariant this file states, so the pin now covers it.
  --
  -- The pin deliberately does *not* cover "same status, row has already left draft", and that
  -- is not an oversight: the review-record arm further down refuses exactly that, by name,
  -- and the first version of this repair swallowed the refusal by restoring the value before
  -- the arm could see it. A caller rewriting the digest on a published release should be told
  -- in words, not silently answered. So the pin fires when the row is actually moving between
  -- states — where no later arm looks at the hash — and while it is still a draft.
  IF NOT (OLD.status = 'draft' AND NEW.status = 'reviewed')
     AND (NEW.status IS DISTINCT FROM OLD.status OR OLD.status = 'draft') THEN
    NEW.review_packet_hash := OLD.review_packet_hash;
  END IF;

  -- ------------------------------------------------------- immutability
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
      IF NEW.reviewed_at IS NULL THEN
        RAISE EXCEPTION 'marking a release reviewed has to say when'
          USING ERRCODE = 'check_violation';
      END IF;
      -- (c) The binding is made here, from the row as it now stands, and it is the hash of
      -- the material rather than of the review: what a reviewer would have been shown, not
      -- what they said back. `digest` of a draft's own bytes is a fact about those bytes, so
      -- this line cannot credit anybody with reading them — `review_label` says who read
      -- them, and §D of the directive is the reason this stage ships no sentence that could
      -- claim a real reader for the Tamil candidate.
      NEW.review_packet_hash := private.tradition_pack_review_hash(
        NEW.pack_id, NEW.release_number, NEW.definition_schema_version, NEW.languages,
        NEW.definition, NEW.author_label, NEW.machine_assisted, NEW.machine_assistance_notes,
        NEW.source_reference, NEW.changelog);
    END IF;

    IF OLD.status = 'reviewed' AND NEW.status = 'approved' THEN
      IF (NEW.review_label, NEW.review_basis, NEW.review_scope,
          NEW.reviewed_languages, NEW.reviewed_at, NEW.reviewed_by)
         IS DISTINCT FROM
         (OLD.review_label, OLD.review_basis, OLD.review_scope,
          OLD.reviewed_languages, OLD.reviewed_at, OLD.reviewed_by) THEN
        RAISE EXCEPTION 'approving release % cannot change the review record it was reviewed under',
          OLD.release_number USING ERRCODE = 'check_violation';
      END IF;
      -- (c) Approval is where the binding bites. The stored hash is what a review record
      -- describes; this recomputes it from the material as it now is, and a mismatch means
      -- the two have come apart — which, given the immutability tuple above, can only happen
      -- to a row whose review was recorded before bindings existed. Refusing rather than
      -- re-stamping is the point: re-stamping would quietly attach a fresh binding to old
      -- review words, and "reviewed against this" would stop meaning "the reviewer saw
      -- exactly this".
      IF OLD.review_packet_hash IS NULL THEN
        RAISE EXCEPTION
          'release % was reviewed before review material was bound to a digest, so it cannot '
          'be approved from that review: the material has to be reviewed against a recorded '
          'hash, which means a new release_number',
          OLD.release_number USING ERRCODE = 'check_violation';
      END IF;
      IF OLD.review_packet_hash <> private.tradition_pack_review_hash(
           OLD.pack_id, OLD.release_number, OLD.definition_schema_version, OLD.languages,
           OLD.definition, OLD.author_label, OLD.machine_assisted, OLD.machine_assistance_notes,
           OLD.source_reference, OLD.changelog) THEN
        RAISE EXCEPTION
          'release % cannot be approved: the material bound to its review no longer matches '
          'the review record beside it',
          OLD.release_number USING ERRCODE = 'check_violation';
      END IF;
      NEW.approved_at := now();
    END IF;

    IF OLD.status = 'approved' AND NEW.status = 'deprecated' THEN
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
  -- (d) The hash joins the tuple this arm already protects. It is part of the review record
  -- in the only sense that matters: it describes the same act, and rewriting it on a
  -- published release would re-date what a frozen document was approved against.
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND OLD.status <> 'draft' AND
     (NEW.review_label, NEW.review_basis, NEW.review_scope, NEW.reviewed_languages,
      NEW.reviewed_at, NEW.reviewed_by, NEW.approved_at, NEW.deprecated_at,
      NEW.review_packet_hash)
     IS DISTINCT FROM
     (OLD.review_label, OLD.review_basis, OLD.review_scope, OLD.reviewed_languages,
      OLD.reviewed_at, OLD.reviewed_by, OLD.approved_at, OLD.deprecated_at,
      OLD.review_packet_hash) THEN
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

-- ===========================================================================
-- 4. THE RESOLVER, v2 — obeys the override rule, and still emits thirteen fields
-- ===========================================================================

-- The resolved section keeps Stage 4's exact thirteen keys. Two of the v2 facts are
-- deliberately NOT echoed into the output:
--
--   * `override_rule` is an authoring instruction. A frozen document that recorded it would
--     be able to disagree with its own `body_source`, and the guest's copy would then carry
--     two claims about who wrote a line where only one of them can be honoured later.
--   * `requires_venue` is a *validation* fact about the host's data, and the renderer draws
--     events with or without a venue. Where a rule needs to be visible after the fact it is
--     already visible: `body_source`, `overrode_pack_text` and `body_fallback_used` say what
--     happened, which is the only thing a frozen document can honestly report.
--
-- `scripts/check-db-contract.mjs` compares the client and database vocabularies, and Stage 5
-- adds `override_rule` to that comparison in §7 of the audit.
CREATE OR REPLACE FUNCTION private.resolve_invitation_sections(
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
  v_rule    text;
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
    -- Absent on a v1 definition, and `host_may_replace` is exactly what Stage 4's resolver
    -- was measured to do, so a v1 release takes the identical path through this function.
    v_rule := COALESCE(v_section ->> 'override_rule', 'host_may_replace');

    v_pack := private.pack_text_for(v_section -> 'pack_text', p_requested, v_allow);
    IF v_rule = 'host_must_supply' THEN
      -- The release offered nothing to show, so nothing can be overridden by what arrives:
      -- `overrode_pack_text` stays false on a host body here, which is the difference
      -- between "the host replaced wording we supplied" and "the host wrote the line".
      v_pack := NULL;
    END IF;

    v_host := NULL;
    IF v_rule <> 'pack_only'
       AND v_section ? 'host_field' AND jsonb_typeof(v_section -> 'host_field') = 'string'
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
  'reported by the host preview rather than hidden from it. Since Stage 5 the wording that '
  'wins is decided by the release''s `override_rule`, and a `pack_only` section keeps its '
  'reviewed provenance however the host''s field is filled.';

-- ===========================================================================
-- 5. ONE ISSUE ENGINE, AND PROSE AS A PROJECTION OVER IT
-- ===========================================================================

-- Stage 4 asked "why may this not be frozen?" and answered with sentences. Stage 5 has to
-- answer two further questions from the same computation — "what should the editor say while
-- the host is still writing?" and "which of these is advice rather than refusal?" — and a
-- sentence cannot answer them, because a browser that re-parses English to find out what to do
-- has become a second implementation of the rule, and the two drift.
--
-- So the rules move into `private.invitation_issue_records`, which returns stable
-- machine-readable records, and the sentences Stage 4 pinned become a projection over them.
-- The projection is what makes the refactor testable rather than merely intended: Stage 4's
-- battery asserts on *exact arrays of these sentences, in this order*, so a drift of one byte
-- of wording or one ordering choice fails a Stage 4 line. That is the regression cover bought
-- by choosing a projection over writing a second checker.
--
-- Two of the arms need one thing a resolved document deliberately does not carry: an authoring
-- rule. `requires_venue` is a statement about the release, not about what a guest was shown, so
-- putting it into the frozen document would be §3.2's refused option. Hence the second
-- argument. Both live callers pass the definition their own snapshot was resolved from; a
-- caller that passes NULL gets every snapshot-derivable arm and none of the
-- definition-only ones, which is exactly what a hand-built defensive snapshot needs and what
-- Stage 4's one-argument entry point now does.
--
-- Records carry no prose. A code is a lower_snake machine name, `params` holds only values a
-- host can act on (a language tag, a section key, a count, a kind), and the product copy that
-- renders them lives in the adapter. Nothing in the record names a table, a column or a
-- function, so there is nothing to translate away at the boundary and no database interior for
-- a browser to display.
CREATE FUNCTION private.invitation_issue_records(
  p_snapshot jsonb,
  p_definition jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_release   jsonb;
  v_items     jsonb;
  v_requested text;
  v_langs     jsonb;
  v_dsv       integer;
  v_people    jsonb;
  v_events    jsonb;
  v_draft     jsonb;
  s           jsonb;
  v_key       text;
  v_kind      text;
  v_field     text;
  v_required  boolean;
  v_host      text;
  v_gap       integer;
  v_out       jsonb := '[]'::jsonb;
BEGIN
  v_release   := p_snapshot -> 'tradition_pack_release';
  v_items     := p_snapshot -> 'sections' -> 'items';
  v_requested := p_snapshot -> 'sections' ->> 'requested';
  v_langs     := v_release -> 'languages';
  v_people    := p_snapshot -> 'people';
  v_events    := p_snapshot -> 'events';
  v_draft     := p_snapshot -> 'draft';

  -- Read the contract version once, and read it without casting anything that is not a
  -- number. Stage 4's own arm cast inline, so a definition row carrying
  -- `definition_schema_version: "two"` failed a freeze with a cast error rather than with a
  -- reason; the CASE below is ordered, so the cast is only ever reached for a number. The
  -- version is then reported by name in `contract_unsupported`, which is the behaviour the
  -- guard's whole "refuse by name rather than render half of it" rule asks for.
  v_dsv := CASE WHEN jsonb_typeof(v_release -> 'definition_schema_version') = 'number'
                THEN (v_release ->> 'definition_schema_version')::integer END;

  -- ---------------------------------------------------------------- the whole-document arms
  -- A requested language the release does not cover, named as the cause. Without this arm the
  -- same wedding produces one required-section refusal per required section, and the host has
  -- to infer from a list of symptoms that the language is the thing to change.
  IF COALESCE(v_requested IS NOT NULL
              AND jsonb_typeof(v_langs) = 'array'
              AND NOT EXISTS (
                    SELECT 1 FROM jsonb_array_elements_text(v_langs) l
                     WHERE l = v_requested), false) THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'code', 'language_not_covered', 'section_key', NULL, 'field', 'primary_language',
      'blocking', true, 'message_key', 'language_not_covered',
      'params', jsonb_build_object('language', v_requested, 'covers', v_langs)));
  END IF;

  -- A contract this build cannot interpret. The `?` test keeps "this snapshot has no release
  -- block" out of the arm: a missing block is the no-pack case, which is not an unreadable
  -- contract, and the built-in default definition is a version-1 document by construction.
  IF COALESCE(jsonb_typeof(v_release) = 'object'
              AND (v_release ? 'definition_schema_version')
              AND CASE WHEN jsonb_typeof(v_release -> 'definition_schema_version') = 'number'
                       THEN (v_release ->> 'definition_schema_version')::integer NOT IN (1, 2)
                       ELSE TRUE END, false) THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'code', 'contract_unsupported', 'section_key', NULL, 'field', NULL,
      'blocking', true, 'message_key', 'contract_unsupported',
      'params', jsonb_build_object(
        'version', CASE WHEN jsonb_typeof(v_release -> 'definition_schema_version') = 'number'
                        THEN (v_release ->> 'definition_schema_version')::text
                        ELSE (v_release ->> 'definition_schema_version') END)));
  END IF;

  -- ------------------------------------------------------------------- the per-section arms
  IF jsonb_typeof(v_items) <> 'array' THEN
    RETURN v_out;
  END IF;

  FOR s IN SELECT e FROM jsonb_array_elements(v_items) e LOOP
    v_key      := s ->> 'section_key';
    v_kind     := s ->> 'kind';
    v_field    := private.dto_text(s -> 'host_field');
    -- Same cast form as Stage 4's arm, deliberately: the guard makes a non-boolean
    -- `required` unwritable, and a hand-built snapshot that breaks that is a defensive case
    -- which should fail loudly here rather than be quietly coerced.
    v_required := COALESCE((s ->> 'required')::boolean, false);

    -- A kind no renderer knows. The guard refuses one at write time, so this arm is for a
    -- snapshot handed to the checker directly — which is what the freeze does with whatever it
    -- is given, and why §C of the Stage 4 continuation asked for the check anyway.
    IF COALESCE(v_kind, '') NOT IN ('text', 'people_list', 'event_list') THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'code', 'kind_unrenderable', 'section_key', v_key, 'field', NULL,
        'blocking', true, 'message_key', 'kind_unrenderable',
        'params', jsonb_build_object('kind', v_kind)));
    END IF;

    -- Its own record, not a second condition on the arm above, for the reason Stage 4
    -- measured: a section with a perfectly renderable kind and an unusable position is a
    -- different problem for the host, and reporting it as a kind the build does not know is a
    -- reason nobody can act on.
    IF jsonb_typeof(s -> 'position') IS DISTINCT FROM 'number' THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'code', 'position_unorderable', 'section_key', v_key, 'field', 'position',
        'blocking', true, 'message_key', 'position_unorderable',
        'params', '{}'::jsonb));
    END IF;

    -- A required prose section that resolved to nothing. This is the arm Stage 4 shipped, and
    -- the sentence has to come out identical, because that is what proves the engine is the
    -- same rule rather than a similar one.
    --
    -- It covers a `host_must_supply` section whose field is empty too, and that is a
    -- measurement rather than a shortcut: the only difference between "the release offered no
    -- wording and you have not written any" and "the release has no wording in this language
    -- and you have not written any" is an authoring rule this document does not carry, and the
    -- host's action is the same in both. The record's `field` says which, and the editor —
    -- which does hold the release definition — turns that into the right sentence.
    IF v_required AND v_kind = 'text'
       AND private.dto_text(s -> 'body_source') IS NULL THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'code', 'required_text_missing', 'section_key', v_key, 'field', v_field,
        'blocking', true, 'message_key', 'required_text_missing',
        'params', jsonb_build_object('language', v_requested)));
    END IF;

    -- From here on, the v2 arms. Each is gated so that a release authored under Stage 4's
    -- contract freezes exactly as it did: §3.3 of the Stage 5 audit records the two
    -- qualification runs that prove the gate is load-bearing rather than decorative (a
    -- Malayalam wedding in the SQL battery, the Tamil one in the HTTP battery, both with
    -- required lists and no rows, both asserted to freeze).
    IF v_dsv IS NOT NULL AND v_dsv >= 2 THEN
      -- A required list with nothing in it. The snapshot's own `people` and `events` arrays
      -- are the measure, because they are what the renderer will draw — a row count from a
      -- table would be a second opinion about the same fact, and could disagree with the
      -- document a guest would see.
      IF v_required AND v_kind = 'people_list'
         AND COALESCE(jsonb_array_length(
               CASE WHEN jsonb_typeof(v_people) = 'array' THEN v_people ELSE '[]'::jsonb END), 0) = 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'code', 'required_list_empty', 'section_key', v_key, 'field', NULL,
          'blocking', true, 'message_key', 'required_list_empty',
          'params', jsonb_build_object('kind', 'people_list')));
      END IF;
      IF v_required AND v_kind = 'event_list'
         AND COALESCE(jsonb_array_length(
               CASE WHEN jsonb_typeof(v_events) = 'array' THEN v_events ELSE '[]'::jsonb END), 0) = 0 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'code', 'required_list_empty', 'section_key', v_key, 'field', NULL,
          'blocking', true, 'message_key', 'required_list_empty',
          'params', jsonb_build_object('kind', 'event_list')));
      END IF;

      -- Venue-dependent sections, answered from the release's declaration rather than from any
      -- knowledge of what a particular tradition asks for. The count is of *enabled* events
      -- with no resolvable venue, which is exactly what `build_invitation_snapshot` decided to
      -- draw; the LEFT JOIN that produces them is Stage 4's and is not re-done here.
      IF v_kind = 'event_list'
         AND COALESCE((SELECT TRUE FROM jsonb_array_elements(
                         CASE WHEN jsonb_typeof(p_definition -> 'sections') = 'array'
                              THEN p_definition -> 'sections' ELSE '[]'::jsonb END) e
                        WHERE e ->> 'section_key' = v_key
                          AND jsonb_typeof(e -> 'requires_venue') = 'boolean'
                          AND (e ->> 'requires_venue')::boolean), false) THEN
        v_gap := (SELECT count(*) FROM jsonb_array_elements(
                             CASE WHEN jsonb_typeof(v_events) = 'array'
                                  THEN v_events ELSE '[]'::jsonb END) ev
                   WHERE jsonb_typeof(ev -> 'venue') IS DISTINCT FROM 'object')::integer;
        IF v_gap > 0 THEN
          v_out := v_out || jsonb_build_array(jsonb_build_object(
            'code', 'event_venue_missing', 'section_key', v_key, 'field', 'venue',
            'blocking', true, 'message_key', 'event_venue_missing',
            'params', jsonb_build_object('missing', v_gap)));
        END IF;
      END IF;
    END IF;

    -- The one non-blocking arm, and it needs no version gate because it cannot fire on a v1
    -- release: `body_source = 'reviewed_pack'` beside a non-empty host field is only
    -- reachable when the release forbade the override, which is a v2 declaration. It is the
    -- other half of "a host override must never inherit review credit" — the reviewer's credit
    -- cannot be claimed for the host's words, and the host's words are not dropped in silence.
    IF v_kind = 'text'
       AND private.dto_text(s -> 'body_source') = 'reviewed_pack'
       AND v_field IS NOT NULL
       AND NULLIF(btrim(private.dto_text(v_draft -> v_field)), '') IS NOT NULL THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'code', 'host_override_not_permitted', 'section_key', v_key, 'field', v_field,
        'blocking', false, 'message_key', 'host_override_not_permitted',
        'params', jsonb_build_object('language', private.dto_text(s -> 'body_language'))));
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION private.invitation_issue_records(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.invitation_issue_records(jsonb, jsonb) IS
  'Every way a resolved invitation document can fall short, as machine-readable records: '
  '{code, section_key, field, blocking, message_key, params}. The freeze refuses when any '
  'record is blocking; the host editor shows all of them. No record carries prose, a table '
  'name or a column name, so a client renders a record by its code and never repeats what it '
  'was handed.';

-- Sentences, projected out of records. Kept as a separate function rather than inlined twice
-- so that the Stage 4 entry point below and the freeze share one wording, and the wording
-- cannot drift from the rule that produces it.
--
-- The blocking filter lives here, which is why `host_override_not_permitted` has a sentence at
-- all: an advisory has to be describable in the language the database already uses, and the
-- only reason it never reaches a refusal is that it is not blocking. The `ELSE` arm is
-- deliberate and unreachable today: a code added to the engine without a sentence here would
-- otherwise project no message, and a blocking issue that projects no message is an
-- unexplainable refusal — which is the failure mode Stage 4's `'(unnamed)'` and
-- `'the chosen language'` guards exist for.
CREATE FUNCTION private.invitation_issue_messages(p_records jsonb) RETURNS text[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT coalesce(array_agg(m ORDER BY m), '{}'::text[]) FROM (
    SELECT CASE r ->> 'code'
             WHEN 'required_text_missing' THEN
               'section ' || coalesce(r ->> 'section_key', '(unnamed)')
                 || ' is required and has no wording in '
                 || coalesce(r -> 'params' ->> 'language', 'the chosen language')
                 || ', and the release does not allow it to fall back'
             WHEN 'language_not_covered' THEN
               'the invitation language ' || (r -> 'params' ->> 'language')
                 || ' is not one of the languages this release covers ('
                 || (SELECT string_agg(l, ', ' ORDER BY l)
                       FROM jsonb_array_elements_text(r -> 'params' -> 'covers') l)
                 || ')'
             WHEN 'kind_unrenderable' THEN
               'section ' || coalesce(r ->> 'section_key', '(unnamed)')
                 || ' claims kind ' || coalesce(r -> 'params' ->> 'kind', '(none)')
                 || ', which this build has no renderer for'
             WHEN 'position_unorderable' THEN
               'section ' || coalesce(r ->> 'section_key', '(unnamed)')
                 || ' has a position that is not a number, so this build cannot order it'
             WHEN 'contract_unsupported' THEN
               'this release''s definition uses contract version '
                 || (r -> 'params' ->> 'version')
                 || ', which this build does not understand'
             WHEN 'required_list_empty' THEN
               'section ' || coalesce(r ->> 'section_key', '(unnamed)')
                 || ' is required and has no '
                 || CASE r -> 'params' ->> 'kind'
                      WHEN 'event_list' THEN 'events' ELSE 'people' END
                 || ' to show yet'
             WHEN 'event_venue_missing' THEN
               'section ' || coalesce(r ->> 'section_key', '(unnamed)')
                 || ' promises a venue for every event and '
                 || (r -> 'params' ->> 'missing')
                 || ' of them has none'
             WHEN 'host_override_not_permitted' THEN
               'section ' || coalesce(r ->> 'section_key', '(unnamed)')
                 || ' carries reviewed wording that cannot be replaced, so the text in '
                 || coalesce(r ->> 'field', 'its host field')
                 || ' is not shown'
             ELSE 'this invitation has an issue this build cannot describe'
           END AS m,
           (r ->> 'blocking')::boolean AS blocking
      FROM jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) r
  ) q
  WHERE q.blocking;
$$;

REVOKE ALL ON FUNCTION private.invitation_issue_messages(jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.invitation_issue_messages(jsonb) IS
  'The blocking records, as sentences, sorted by the sentence itself — the order and the '
  'wording Stage 4''s battery asserts on. Empty means the document may be frozen.';

-- Stage 4's pinned entry point, forward-declared as the composition it now is. The signature
-- is untouched because twenty-odd assertions in `supabase/tests/stage4/50_pack_release.sql`
-- call it with a snapshot and nothing else, and every one of them is now also a test of the
-- engine above.
CREATE OR REPLACE FUNCTION private.invitation_freeze_issues(p_snapshot jsonb) RETURNS text[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT private.invitation_issue_messages(
    private.invitation_issue_records(p_snapshot, NULL::jsonb));
$$;

REVOKE ALL ON FUNCTION private.invitation_freeze_issues(jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.invitation_freeze_issues(jsonb) IS
  'Why this resolved document may not be frozen, as sentences. Empty means it may. Since '
  'Stage 5 this is a projection over `invitation_issue_records`, which is the single '
  'implementation of the rule; the snapshot-only arms are all it can see, so a caller with a '
  'definition to pass uses the records directly.';

-- ===========================================================================
-- 6. ONE DOCUMENT, ONE VERDICT, TWO CALLERS
-- ===========================================================================

-- The definition a wedding's own snapshot is resolved against, read the same way
-- `build_invitation_snapshot` reads it. A no-pack wedding gets the built-in document, which is
-- what the snapshot already resolves against, so the two callers cannot disagree about which
-- definition is in force — and `validate_tradition_pack_release` can be pointed at a release
-- nobody has selected.
CREATE FUNCTION private.wedding_invitation_definition(p_wedding_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT COALESCE(r.definition, private.default_invitation_definition())
    FROM public.weddings w
    LEFT JOIN public.tradition_pack_releases r ON r.id = w.tradition_pack_release_id
   WHERE w.id = p_wedding_id;
$$;

REVOKE ALL ON FUNCTION private.wedding_invitation_definition(uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.wedding_invitation_definition(uuid) IS
  'The authoring rules behind a wedding''s current selection, for the one purpose that needs '
  'them: validating a resolved document against the rules that produced it. A frozen '
  'invitation does not carry them, because they describe a release rather than a guest''s page.';

-- The same definition, in the one form an authoring screen can act on: the rules, in the
-- release's own order, and none of the words. Two things make this a projection rather than a
-- second reader of pack JSON.
--
--   * It reads the *same* definition the snapshot was resolved from — the caller passes
--     `wedding_invitation_definition(...)`, the identical expression the issue engine beside it
--     is given — so the order and the rules on screen are the ones that produced the document on
--     screen. A screen that read `tradition_pack_releases.definition` on its own would be a
--     second implementation of the contract, and the two would drift exactly the way §5 of the
--     audit says a client-side resolver drifts.
--   * Every value that is absent in the JSON arrives as the value the resolver already treats
--     it as: `required` false, `override_rule` `host_may_replace`, `requires_venue` false. That
--     is what makes a v1 release and the built-in no-pack definition produce a declaration with
--     nothing in it, rather than a declaration that invents a requirement the release never
--     stated — the "no new requirement accidentally imposed" case, settled by the defaults
--     rather than by a branch.
--
-- A field is emitted only where the guard allows it to mean something (`override_rule` on prose
-- only, `requires_venue` on an event list only), because a rule attached to a section that
-- cannot honour it would have to be ignored on the client, and an ignored rule is a client-side
-- guess about the server's intent. The reviewed wording is deliberately not here: it is already
-- in the resolved document as a section body with its provenance, and duplicating it would give
-- the editor two answers about a line to choose between.
CREATE FUNCTION private.invitation_authoring_declaration(p_definition jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_section jsonb;
  v_kind    text;
  v_out     jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_definition) <> 'object'
     OR jsonb_typeof(p_definition -> 'sections') <> 'array' THEN
    RETURN '[]'::jsonb;
  END IF;

  -- The resolver's own ordering, character for character: an authoring screen that sorted
  -- differently from the document would show the host a section list their invitation is not.
  FOR v_section IN
      SELECT s FROM jsonb_array_elements(p_definition -> 'sections') s
      ORDER BY (s ->> 'position')::integer LOOP

    v_kind := CASE WHEN jsonb_typeof(v_section -> 'kind') = 'string'
                   THEN v_section ->> 'kind' END;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'section_key',   CASE WHEN jsonb_typeof(v_section -> 'section_key') = 'string'
                            THEN v_section ->> 'section_key' END,
      'position',      (v_section ->> 'position')::integer,
      'kind',          v_kind,
      'required',      COALESCE((v_section ->> 'required')::boolean, false),
      'host_field',    CASE WHEN jsonb_typeof(v_section -> 'host_field') = 'string'
                            THEN v_section ->> 'host_field' END,
      'override_rule', CASE WHEN v_kind = 'text'
                            THEN COALESCE(v_section ->> 'override_rule', 'host_may_replace')
                      END,
      'requires_venue', CASE WHEN v_kind = 'event_list'
                             THEN COALESCE((v_section ->> 'requires_venue')::boolean, false)
                      END));
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION private.invitation_authoring_declaration(jsonb)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.invitation_authoring_declaration(jsonb) IS
  'The authoring rules of a release definition, in the release''s own order, as an array of '
  '{section_key, position, kind, required, host_field, override_rule, requires_venue}. Absent '
  'fields become the defaults the resolver applies, so a version-1 or no-pack definition '
  'declares nothing beyond what the host has always had. No wording, no heading, no language '
  'map: those are in the resolved document, and a screen that read the raw definition instead '
  'would be a second implementation of the contract.';

-- The host's own preview call, and the reason it is one function rather than two client
-- requests: a document and its verdict fetched in two calls can straddle a save, which shows a
-- host an invitation that never existed and, worse, can report an issue list for a different
-- document than the one on screen. One snapshot, one verdict, one answer.
--
-- `invitation_freeze_issues` is not what this returns. The browser gets the records, which is
-- the form it can act on — a blocking list to refuse the button with and an advisory to
-- explain a field that will not land. The decision it may not make is its own: §I of the
-- Stage 5 audit records the refusal as a server-side fact, and
-- `internal_api.create_invitation_version` below recomputes everything from the row rather
-- than reading anything a client sent.
CREATE OR REPLACE FUNCTION internal_api.preview_invitation_document(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner    uuid;
  v_snap     jsonb;
  v_dto      jsonb;
  v_selected jsonb;
  v_def      jsonb;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not preview this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_snap := private.build_invitation_snapshot(p_wedding_id);
  v_dto  := private.public_invitation_dto(2, v_snap);
  IF v_dto IS NULL THEN
    RAISE EXCEPTION 'this invitation cannot be previewed as it is currently written'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Read once and hand the same value to both consumers. Reading it twice would be two
  -- statements that can see different rows if the host re-points the selection in between, and
  -- then the rules on screen could describe a release the verdict was computed against a
  -- different one from — the same straddle this whole function exists to close.
  v_def := private.wedding_invitation_definition(p_wedding_id);

  -- The release the host is looking at, in the narrow form the editor needs to say
  -- "this invitation uses an older release". No review record, no hash, no ids: §D's rule
  -- that a host learns the *consequence* of a retirement, not the maintenance diary behind
  -- it. `status_is_current` is the present-tense fact the retired notice is built from, and
  -- the row policy already lets this caller read `status` for a release it selected.
  SELECT jsonb_build_object(
           'pack_key', p.pack_key,
           'display_name', p.display_name,
           'release_number', r.release_number,
           'definition_schema_version', r.definition_schema_version,
           'status_is_current', r.status = 'approved')
    INTO v_selected
    FROM public.weddings w
    JOIN public.tradition_pack_releases r ON r.id = w.tradition_pack_release_id
    JOIN public.tradition_packs p ON p.id = r.pack_id
   WHERE w.id = p_wedding_id;

  RETURN jsonb_build_object(
    'invitation', v_dto,
    'issues', private.invitation_issue_records(v_snap, v_def),
    'authoring', private.invitation_authoring_declaration(v_def),
    'selected_release', v_selected);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.preview_invitation_document(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.preview_invitation_document(uuid) TO authenticated;

COMMENT ON FUNCTION internal_api.preview_invitation_document(uuid) IS
  'The host''s live document, the server''s verdict on it, the authoring rules behind it and '
  'what it is standing on, from one resolution. Owner-only, like every other preview surface. '
  'The document carries words and provenance; `authoring` carries the rules and no words, so an '
  'editor can lay out its controls without reading a raw pack definition.';

CREATE OR REPLACE FUNCTION api.preview_invitation_document(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.preview_invitation_document(p_wedding_id);
$$;

REVOKE ALL ON FUNCTION api.preview_invitation_document(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.preview_invitation_document(uuid) TO authenticated;

-- The freeze, forward-declared. Two changes and both are about the same thing: the verdict is
-- taken from the record engine, and the selection is locked for the statement pair so the
-- document, its verdict and the release the version row pins are the same selection.
--
-- The lock is the half worth reading. `build_invitation_snapshot` and the definition accessor
-- are two reads of a mutable pointer — `weddings.tradition_pack_release_id`, which the owner
-- may re-point at any time — and Stage 4 read it twice inside one transaction without a lock,
-- which meant a selection change landing between them could pin a version at release B over a
-- snapshot resolved from release A. Nothing observable today proves that happened; nothing
-- proved it could not. `FOR UPDATE` closes the window for the price of one row lock, and
-- because the release rows themselves are content-immutable once approved, the pointer is the
-- only thing that could move.
CREATE OR REPLACE FUNCTION internal_api.create_invitation_version(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner   uuid;
  v_lang    text;
  v_release uuid;
  v_draft   public.invitation_drafts%ROWTYPE;
  v_snap    jsonb;
  v_records jsonb;
  v_issues  text[];
  v_number  integer;
  v_prev    uuid;
  v_id      uuid;
  v_try     integer := 0;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not create a version of this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT w.primary_language, w.tradition_pack_release_id
    INTO v_lang, v_release
    FROM public.weddings w WHERE w.id = p_wedding_id
    FOR UPDATE;

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

  -- §O of the Stage 4 continuation, restated against the record engine: a version a guest
  -- could read may not be created while the document it would freeze falls short. The list is
  -- the blocking half of what the host's editor is showing at the same moment, from the same
  -- records, and the sentence form is kept because the refusal a host sees has to be the one
  -- this build already produces.
  --
  -- The release's *status* is still not checked here: `versions_pack_release_gate` refuses it
  -- at the INSERT below, which is the stronger place because it holds for any writer and not
  -- only for this RPC.
  v_records := private.invitation_issue_records(
    v_snap, private.wedding_invitation_definition(p_wedding_id));
  v_issues := private.invitation_issue_messages(v_records);
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

COMMENT ON FUNCTION internal_api.create_invitation_version(uuid) IS
  'Freeze the invitation as it currently resolves. The verdict is recomputed here from the '
  'row and never accepted from the caller: a client-side warning is a courtesy, not a '
  'constraint. Since Stage 5 the selection is locked for the duration, so the snapshot, the '
  'issues and the release the version pins all describe one moment.';

-- ===========================================================================
-- 7. THE MAINTENANCE SURFACE
-- ===========================================================================
--
-- The Stage 4 file declined to author RPCs for content maintenance and said why
-- (`:41-45`: no exposed surface, no convenience wrappers, the triggers already hold every
-- guarantee). That reasoning stands and is not reversed here. What changed is the request:
-- the Stage 5 tranche names this surface explicitly, and asks for it because a lifecycle
-- walked by hand-written UPDATEs cannot print what it is about to do, cannot bind a review to
-- a digest, and cannot be pointed at one local target by one flag. So these functions are
-- authored to be *used by a local maintenance identity through a direct connection*, and they
-- are authored to add nothing to what that identity could already do:
--
--   * They live in `internal_api`, which is not in PostgREST's schema list
--     (`supabase/config.toml`: `schemas = ["public", "api"]`), so no HTTP request can name
--     them whatever else happens.
--   * There is no `api.` wrapper for any of them, and the Stage 5 battery asserts that the
--     absence is deliberate rather than an oversight.
--   * They are `SECURITY INVOKER`, not `SECURITY DEFINER`. §B asks for DEFINER only where a
--     privilege is genuinely required, and none is: the caller already needs INSERT/UPDATE on
--     the release table and USAGE on `private` to do any of this, and a definer body owned by
--     a superuser would be an escalation path offered for no reason. Every one of them
--     therefore runs with exactly the caller's rights, and `private.reject_client_write`
--     judges the write on the caller's identity — which is the same trusted-role rule the
--     whole repository's maintenance path already uses.
--   * EXECUTE is revoked from PUBLIC, anon, authenticated and service_role on each one, so
--     the only callers are the owner and a superuser. `service_role` is refused here even
--     though Stage 2 trusts it for writes: it is a server-side content-maintenance identity
--     with table rights, not a holder of this product's review workflow, and widening a
--     request surface for a role that does not ask is how surfaces grow.
--
-- What they add over a hand-written UPDATE is the two things a trigger cannot do: refuse a
-- review submitted against the wrong digest *with the digest named*, and say what is about to
-- change before it changes.
-- --------------------------------------------------------------------------- the read side

CREATE FUNCTION internal_api.tradition_pack_catalog() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'packs', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'pack_key', p.pack_key,
               'display_name', p.display_name,
               'scope_statement', p.scope_statement,
               'releases', coalesce((
                 SELECT jsonb_agg(jsonb_build_object(
                          'release_number', r.release_number,
                          'status', r.status,
                          'definition_schema_version', r.definition_schema_version,
                          'languages', r.languages,
                          'machine_assisted', r.machine_assisted,
                          'review_packet_hash', r.review_packet_hash)
                        ORDER BY r.release_number)
                   FROM public.tradition_pack_releases r
                  WHERE r.pack_id = p.id), '[]'::jsonb))
             ORDER BY p.pack_key COLLATE "C")
        FROM public.tradition_packs p), '[]'::jsonb),
    -- Counted separately so a reader cannot mistake "there are six releases" for "a host can
    -- choose from six". Only approved releases are offered, and this says which that is
    -- without the caller having to re-derive the rule.
    'customer_selectable_releases', coalesce((
      SELECT count(*)::integer FROM public.tradition_pack_releases r
       WHERE r.status = 'approved'), 0))
    INTO v_out;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION internal_api.tradition_pack_catalog()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.tradition_pack_catalog() IS
  'Every pack and every release of it, in the states they are actually in. A maintenance view '
  'of platform content, not a customer surface: it names the review digests it reads, which '
  'is exactly what a guest must never learn.';

CREATE FUNCTION internal_api.inspect_tradition_pack_release(p_release_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_row      public.tradition_pack_releases%ROWTYPE;
  v_recomputed text;
  v_out      jsonb;
BEGIN
  SELECT * INTO v_row FROM public.tradition_pack_releases r WHERE r.id = p_release_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no release % is in the catalogue', p_release_id
      USING ERRCODE = 'raise_exception';
  END IF;

  -- `binding_current` is the whole audit question in one boolean: does the digest stored
  -- beside the review still describe the material? Recomputed from the row rather than read
  -- from it, so a row whose two halves have come apart reports false instead of asserting
  -- what it claims.
  v_recomputed := private.tradition_pack_review_hash(
    v_row.pack_id, v_row.release_number, v_row.definition_schema_version, v_row.languages,
    v_row.definition, v_row.author_label, v_row.machine_assisted,
    v_row.machine_assistance_notes, v_row.source_reference, v_row.changelog);

  SELECT jsonb_build_object(
    'release', to_jsonb(v_row),
    'pack_key', (SELECT p.pack_key FROM public.tradition_packs p WHERE p.id = v_row.pack_id),
    'review_payload_recomputed', v_recomputed,
    'binding_current', v_row.review_packet_hash IS NOT DISTINCT FROM v_recomputed,
    'hash_recorded', v_row.review_packet_hash IS NOT NULL,
    'transitions_available', CASE v_row.status
      WHEN 'draft' THEN ARRAY['reviewed']
      WHEN 'reviewed' THEN ARRAY['approved']
      WHEN 'approved' THEN ARRAY['deprecated']
      ELSE '{}'::text[] END,
    'weddings_selecting', (SELECT count(*)::integer FROM public.weddings w
                            WHERE w.tradition_pack_release_id = v_row.id),
    'versions_frozen', (SELECT count(*)::integer FROM public.invitation_versions v
                         WHERE v.tradition_pack_release_id = v_row.id))
    INTO v_out;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION internal_api.inspect_tradition_pack_release(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.inspect_tradition_pack_release(uuid) IS
  'Everything the catalogue holds about one release, including the digest recomputed from the '
  'material rather than repeated from the row.';

-- ------------------------------------------------------------------------ the authoring side

CREATE FUNCTION internal_api.create_tradition_pack(
  p_pack_key text,
  p_display_name text,
  p_scope_statement text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- These two checks exist for the message, not the guarantee: the table's own CHECK
  -- constraints are what hold, and a bare 23514 tells an operator nothing about which of the
  -- three fields they got wrong. Everything else is left to the constraints rather than
  -- re-stated here, so there is exactly one place each rule lives.
  IF p_pack_key IS NULL OR p_pack_key !~ '^[a-z][a-z0-9]*(_[a-z0-9]*)*$' THEN
    RAISE EXCEPTION 'a pack key must be a lower_snake slug (got %)',
      COALESCE(p_pack_key, '(none)') USING ERRCODE = 'check_violation';
  END IF;
  IF p_scope_statement IS NULL OR length(btrim(p_scope_statement)) < 20 THEN
    RAISE EXCEPTION 'a pack must state what it claims and what it does not, in at least 20 '
                    'characters: the sentence beside the name is the boundary'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tradition_packs p WHERE p.pack_key = p_pack_key) THEN
    RAISE EXCEPTION 'a pack named % already exists; a pack concept is never reused', p_pack_key
      USING ERRCODE = 'unique_violation';
  END IF;

  -- The value is named here as a statement about intent: a new concept carries no content, so
  -- `create_tradition_pack` cannot also be a way to ship wording.
  INSERT INTO public.tradition_packs (pack_key, display_name, scope_statement)
    VALUES (btrim(p_pack_key), btrim(p_display_name), btrim(p_scope_statement))
    RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'pack_id', v_id, 'pack_key', p_pack_key, 'created', true,
    'has_content', false,
    'note', 'the concept exists with no releases, which makes it invisible to a host: a pack '
            || 'becomes selectable when a release of it is approved');
END;
$$;

REVOKE ALL ON FUNCTION internal_api.create_tradition_pack(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION internal_api.create_tradition_pack_release(
  p_pack_key text,
  p_definition jsonb,
  p_definition_schema_version integer,
  p_languages text[],
  p_author_label text,
  p_machine_assisted boolean,
  p_machine_assistance_notes text,
  p_source_reference text,
  p_changelog text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_pack_id uuid;
  v_number  integer;
  v_id      uuid;
BEGIN
  SELECT p.id INTO v_pack_id FROM public.tradition_packs p WHERE p.pack_key = p_pack_key;
  IF v_pack_id IS NULL THEN
    RAISE EXCEPTION 'no pack % is in the catalogue; create the concept before a release of it',
      COALESCE(p_pack_key, '(none)') USING ERRCODE = 'raise_exception';
  END IF;

  -- Numbered here rather than accepted from the caller, because the number is the answer to
  -- "which of this pack's releases is this?" and an author who could choose it could also
  -- reuse one. The UNIQUE (pack_id, release_number) is the guarantee; this is what makes the
  -- next number the only thing a caller can ask for.
  SELECT coalesce(max(r.release_number), 0) + 1 INTO v_number
    FROM public.tradition_pack_releases r WHERE r.pack_id = v_pack_id;

  -- Status is absent from the argument list on purpose. A release is born a draft, the guard
  -- refuses any other birth state, and a signature that offered a status would be an offer to
  -- create something already approved.
  INSERT INTO public.tradition_pack_releases (
    pack_id, release_number, definition_schema_version, languages, definition,
    author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
  VALUES (
    v_pack_id, v_number, p_definition_schema_version, p_languages, p_definition,
    btrim(p_author_label), p_machine_assisted,
    NULLIF(btrim(coalesce(p_machine_assistance_notes, '')), ''),
    NULLIF(btrim(coalesce(p_source_reference, '')), ''),
    NULLIF(btrim(coalesce(p_changelog, '')), ''))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'release_id', v_id, 'pack_key', p_pack_key, 'release_number', v_number,
    'status', 'draft', 'review_packet_hash', NULL,
    'transition', '(none — created as draft)',
    'valid', true,
    'note', 'the lifecycle guard accepted this definition, which is this build''s structural '
            || 'validation: an author who needs to test a definition without storing it tests '
            || 'it as a draft, since a draft is invisible to customers and deletable');
END;
$$;

REVOKE ALL ON FUNCTION internal_api.create_tradition_pack_release(
  text, jsonb, integer, text[], text, boolean, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION internal_api.update_draft_tradition_pack_release(
  p_release_id uuid,
  p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_before public.tradition_pack_releases%ROWTYPE;
  v_after  public.tradition_pack_releases%ROWTYPE;
  v_bad    text;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'the patch must be a JSON object of the fields to change'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A closed key set, and an unknown key is a refusal rather than a no-op. Without this a
  -- typo (`defenition`) would report success while changing nothing, which on a content
  -- pipeline is the worst possible answer: the author believes the wording was fixed.
  SELECT string_agg(k, ', ') INTO v_bad
    FROM (SELECT DISTINCT k FROM jsonb_object_keys(p_patch) k
           WHERE k NOT IN ('definition', 'definition_schema_version', 'languages',
                           'author_label', 'machine_assisted', 'machine_assistance_notes',
                           'source_reference', 'changelog')) u;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'a draft patch names fields this surface does not have: %. The editable '
                    'fields are definition, definition_schema_version, languages, '
                    'author_label, machine_assisted, machine_assistance_notes, '
                    'source_reference and changelog.', v_bad
      USING ERRCODE = 'check_violation';
  END IF;
  -- Status and every review field are outside that list, so "promote this while I am here"
  -- cannot be expressed. The guard would refuse the write anyway; this makes the attempt
  -- legible instead of turning it into a constraint violation with no name.

  SELECT * INTO v_before FROM public.tradition_pack_releases r WHERE r.id = p_release_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no release % is in the catalogue', p_release_id
      USING ERRCODE = 'raise_exception';
  END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION 'release % of pack % is %, and a release that has left draft is not '
                    'edited: the change is a new release_number, which is what makes an '
                    'existing invitation''s answer stay answerable',
      v_before.release_number, v_before.pack_id, v_before.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- `p_patch ? 'x'` rather than `COALESCE(p_patch ->> 'x', old)`: a patch key absent leaves
  -- the field alone, and a patch key present with JSON null clears it. Anything else would
  -- make "remove the source reference" unexpressible, which on a draft is a legitimate act.
  UPDATE public.tradition_pack_releases r SET
    definition = CASE WHEN p_patch ? 'definition'
                      THEN p_patch -> 'definition' ELSE v_before.definition END,
    definition_schema_version = CASE WHEN p_patch ? 'definition_schema_version'
                      THEN (p_patch ->> 'definition_schema_version')::integer
                      ELSE v_before.definition_schema_version END,
    languages = CASE WHEN p_patch ? 'languages'
                      THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'languages'))
                      ELSE v_before.languages END,
    author_label = CASE WHEN p_patch ? 'author_label'
                      THEN NULLIF(btrim(p_patch ->> 'author_label'), '')
                      ELSE v_before.author_label END,
    machine_assisted = CASE WHEN p_patch ? 'machine_assisted'
                      THEN (p_patch ->> 'machine_assisted')::boolean
                      ELSE v_before.machine_assisted END,
    machine_assistance_notes = CASE WHEN p_patch ? 'machine_assistance_notes'
                      THEN NULLIF(btrim(coalesce(p_patch ->> 'machine_assistance_notes', '')), '')
                      ELSE v_before.machine_assistance_notes END,
    source_reference = CASE WHEN p_patch ? 'source_reference'
                      THEN NULLIF(btrim(coalesce(p_patch ->> 'source_reference', '')), '')
                      ELSE v_before.source_reference END,
    changelog = CASE WHEN p_patch ? 'changelog'
                      THEN NULLIF(btrim(coalesce(p_patch ->> 'changelog', '')), '')
                      ELSE v_before.changelog END
   WHERE r.id = p_release_id;

  SELECT * INTO v_after FROM public.tradition_pack_releases r WHERE r.id = p_release_id;

  RETURN jsonb_build_object(
    'release_id', p_release_id, 'pack_id', v_after.pack_id,
    'pack_key', (SELECT p.pack_key FROM public.tradition_packs p WHERE p.id = v_after.pack_id),
    'release_number', v_after.release_number,
    'transition', 'draft -> draft (content edited)',
    'status', v_after.status,
    'review_packet_hash_before', v_before.review_packet_hash,
    'review_packet_hash_after', v_after.review_packet_hash,
      -- `updated_at` is excluded because a BEFORE trigger rewrites it on every UPDATE, so
    -- including it would report "changed" for a patch that changed nothing — which is the
    -- opposite of the reason this field is returned.
    'changed', (to_jsonb(v_before) - 'updated_at' - 'created_at')
               <> (to_jsonb(v_after) - 'updated_at' - 'created_at'),
    'definition_schema_version', v_after.definition_schema_version,
    'languages', v_after.languages,
    'note', 'a draft holds no review digest, and the digest a review will be bound to is '
            || 'produced when it is submitted, from whatever the content is then');
END;
$$;

REVOKE ALL ON FUNCTION internal_api.update_draft_tradition_pack_release(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.update_draft_tradition_pack_release(uuid, jsonb) IS
  'Edit a draft release, or refuse. The lifecycle guard is still the authority on what a '
  'draft may hold; this function only names the fields a caller may ask about and turns a '
  'typo into a refusal instead of a silent success.';

-- --------------------------------------------------------------------- review and lifecycle

-- The packet (§9). Everything in it is either the material or the digest of the material, so
-- the reviewer is shown exactly what gets hashed and the hash shown is the one the guard will
-- store. Note what is NOT here: the reviewer's own answer fields. They are the reviewer's to
-- write, and the digest deliberately does not cover them (§2 of this file says why).
CREATE FUNCTION internal_api.get_tradition_pack_review_packet(p_release_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_row public.tradition_pack_releases%ROWTYPE;
  v_payload text;
  v_out     jsonb;
BEGIN
  SELECT * INTO v_row FROM public.tradition_pack_releases r WHERE r.id = p_release_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no release % is in the catalogue', p_release_id
      USING ERRCODE = 'raise_exception';
  END IF;

  v_payload := private.tradition_pack_review_payload(
    v_row.pack_id, v_row.release_number, v_row.definition_schema_version, v_row.languages,
    v_row.definition, v_row.author_label, v_row.machine_assisted,
    v_row.machine_assistance_notes, v_row.source_reference, v_row.changelog);

  SELECT jsonb_build_object(
    'release_id', v_row.id,
    'pack_id', v_row.pack_id,
    'pack_key', (SELECT p.pack_key FROM public.tradition_packs p WHERE p.id = v_row.pack_id),
    'pack_display_name', (SELECT p.display_name FROM public.tradition_packs p
                           WHERE p.id = v_row.pack_id),
    'pack_scope_statement', (SELECT p.scope_statement FROM public.tradition_packs p
                              WHERE p.id = v_row.pack_id),
    'release_number', v_row.release_number,
    'status', v_row.status,
    'definition_schema_version', v_row.definition_schema_version,
    'languages', v_row.languages,
    'definition', v_row.definition,
    'author_label', v_row.author_label,
    'machine_assisted', v_row.machine_assisted,
    'machine_assistance_notes', v_row.machine_assistance_notes,
    'source_reference', v_row.source_reference,
    'changelog', v_row.changelog,
    'review_label', v_row.review_label,
    'review_basis', v_row.review_basis,
    'review_scope', v_row.review_scope,
    'reviewed_languages', v_row.reviewed_languages,
    'canonical_payload', v_payload,
    'review_packet_hash', private.tradition_pack_review_hash(
      v_row.pack_id, v_row.release_number, v_row.definition_schema_version, v_row.languages,
      v_row.definition, v_row.author_label, v_row.machine_assisted,
      v_row.machine_assistance_notes, v_row.source_reference, v_row.changelog),
    'review_packet_hash_recorded', v_row.review_packet_hash)
    INTO v_out;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION internal_api.get_tradition_pack_review_packet(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.get_tradition_pack_review_packet(uuid) IS
  'The material a reviewer is shown, the canonical payload those bytes serialise to, and the '
  'SHA-256 of that payload. The CLI renders this into a document and computes nothing of its '
  'own: one implementation of "what a review covers" is the whole point of putting the digest '
  'in the database.';

CREATE FUNCTION internal_api.submit_tradition_pack_review(
  p_release_id uuid,
  p_decision text,
  p_review_label text,
  p_review_basis text,
  p_review_scope text,
  p_reviewed_languages text[],
  p_expected_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_row      public.tradition_pack_releases%ROWTYPE;
  v_current  text;
  v_after    public.tradition_pack_releases%ROWTYPE;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN
     ('accept', 'accept_with_changes', 'reject') THEN
    RAISE EXCEPTION 'a review decision is accept, accept_with_changes or reject, not %',
      COALESCE(p_decision, '(none)') USING ERRCODE = 'check_violation';
  END IF;
  IF p_expected_hash IS NULL OR p_expected_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'a review is submitted against the digest printed on the packet, so it '
                    'cannot be accepted without one: pass the 64-character SHA-256 the '
                    'packet shows'
      USING ERRCODE = 'check_violation';
  END IF;

  -- `FOR UPDATE` is what makes the comparison below a decision about one state of the row rather
  -- than about two. Without it a second maintenance session could edit the draft between this read
  -- and the write at the end of this function, and the guard would bind the digest of bytes the
  -- reviewer never saw — while the recheck at approval would still agree, because both halves
  -- would then describe the *new* material. The lock is held to the end of the transaction, so the
  -- edit that loses the race is refused outright: by then the row has left `draft`, which is the
  -- state the content-immutability arm already protects.
  SELECT * INTO v_row FROM public.tradition_pack_releases r WHERE r.id = p_release_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no release % is in the catalogue', p_release_id
      USING ERRCODE = 'raise_exception';
  END IF;
  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'release % of pack % is already %, and a review is not re-submitted over '
                    'an existing one: a second reading is a new release_number or a new packet',
      v_row.release_number, v_row.pack_id, v_row.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- The comparison that makes §9's binding real. `get_tradition_pack_review_packet` printed a
  -- digest; the reviewer read those bytes; if the draft has moved since, this differs and the
  -- submission is refused before anything is written. The message names both digests because
  -- an operator who cannot see the difference cannot explain it to anybody.
  v_current := private.tradition_pack_review_hash(
    v_row.pack_id, v_row.release_number, v_row.definition_schema_version, v_row.languages,
    v_row.definition, v_row.author_label, v_row.machine_assisted,
    v_row.machine_assistance_notes, v_row.source_reference, v_row.changelog);
  IF v_current <> p_expected_hash THEN
    RAISE EXCEPTION
      'this review is submitted against packet %, but the material as it now stands digests '
      'to %. Nothing was written: the wording changed after the packet was produced, so it has '
      'to be reviewed again against the new digest',
      p_expected_hash, v_current USING ERRCODE = 'check_violation';
  END IF;

  IF p_decision = 'reject' THEN
    -- A rejection is not a status. The lifecycle has four states and none of them means
    -- "a reader said no", because a draft that was rejected and a draft nobody has looked at
    -- are the same thing to every other reader of this table — and inventing a fifth state to
    -- hold the difference would be a schema change driven by a preference for recording an
    -- answer over acting on it. So nothing moves, and the packet the reviewer returned is the
    -- artefact that says why.
    RETURN jsonb_build_object(
      'release_id', p_release_id, 'pack_key', NULL,
      'release_number', v_row.release_number, 'status_before', v_row.status,
      'status_after', v_row.status,
      'transition', '(none — rejected, and the release stays a draft)',
      'review_packet_hash', v_current,
      'recorded', false,
      'note', 'a rejection is not a lifecycle state in this schema; the release remains a '
              || 'draft, invisible to customers, and the reviewer''s packet is the record of '
              || 'the refusal');
  END IF;

  -- `accept_with_changes` moves the row exactly as `accept` does, and that is the only honest
  -- option: the guard forbids content edits once a release has left draft, so "with changes"
  -- cannot mean "edit them in afterwards". It means the changes were made while it was still
  -- a draft and this reading is what the reviewer signed. The distinction belongs in
  -- `review_scope`, which is the reviewer's own sentence about what they covered — and the
  -- digest is what stops that sentence drifting from the bytes.
  UPDATE public.tradition_pack_releases r SET
    status = 'reviewed',
    review_label = btrim(p_review_label),
    review_basis = btrim(p_review_basis),
    review_scope = btrim(p_review_scope),
    reviewed_languages = p_reviewed_languages,
    reviewed_at = now()
   WHERE r.id = p_release_id;

  SELECT * INTO v_after FROM public.tradition_pack_releases r WHERE r.id = p_release_id;

  RETURN jsonb_build_object(
    'release_id', p_release_id,
    'pack_id', v_after.pack_id,
    'pack_key', (SELECT p.pack_key FROM public.tradition_packs p WHERE p.id = v_after.pack_id),
    'release_number', v_after.release_number,
    'status_before', 'draft', 'status_after', v_after.status,
    'transition', 'draft -> reviewed',
    'review_packet_hash', v_after.review_packet_hash,
    'recorded', true,
    'decision', p_decision,
    'note', 'reviewed is not selectable. The step to approved re-compares the digest against '
            || 'the material, so a reviewed release that has since moved cannot be shipped');
END;
$$;

REVOKE ALL ON FUNCTION internal_api.submit_tradition_pack_review(
  uuid, text, text, text, text, text[], text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION internal_api.approve_tradition_pack_release(
  p_release_id uuid,
  p_expected_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_row   public.tradition_pack_releases%ROWTYPE;
  v_after public.tradition_pack_releases%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.tradition_pack_releases r WHERE r.id = p_release_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no release % is in the catalogue', p_release_id
      USING ERRCODE = 'raise_exception';
  END IF;
  IF v_row.status <> 'reviewed' THEN
    RAISE EXCEPTION 'release % of pack % is %, and only a reviewed release can be approved: '
                    'the lifecycle has no step that skips a reading',
      v_row.release_number, v_row.pack_id, v_row.status
      USING ERRCODE = 'check_violation';
  END IF;
  -- The stored digest is the binding; this says whether the caller is approving the thing the
  -- binding describes. It is a courtesy check with the same teeth as the guard's, and it
  -- exists because the alternative — letting an approval stand on a row whose review describes
  -- other bytes — is the failure the whole of §9 is about.
  IF p_expected_hash IS NOT NULL AND p_expected_hash <> v_row.review_packet_hash THEN
    RAISE EXCEPTION
      'release % was reviewed against packet %, and this approval names %. Nothing was '
      'written: approve the digest the review record carries, or re-review the material',
      v_row.release_number,
      COALESCE(v_row.review_packet_hash, '(no digest was recorded for this review)'),
      p_expected_hash USING ERRCODE = 'check_violation';
  END IF;
  IF p_expected_hash IS NULL THEN
    RAISE EXCEPTION 'approval without the digest the release was reviewed against is refused: '
                    'name the packet being signed off, or read its digest from the review '
                    'packet for this release'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The UPDATE carries no content and no review fields, so the guard's two immutability arms
  -- hold trivially, and its digest re-comparison is the second opinion that makes this
  -- function's check unnecessary to trust.
  UPDATE public.tradition_pack_releases r SET status = 'approved' WHERE r.id = p_release_id;
  SELECT * INTO v_after FROM public.tradition_pack_releases r WHERE r.id = p_release_id;

  RETURN jsonb_build_object(
    'release_id', p_release_id, 'pack_id', v_after.pack_id,
    'pack_key', (SELECT p.pack_key FROM public.tradition_packs p WHERE p.id = v_after.pack_id),
    'release_number', v_after.release_number,
    'status_before', 'reviewed', 'status_after', v_after.status,
    'transition', 'reviewed -> approved',
    'review_packet_hash', v_after.review_packet_hash,
    'customer_selectable', true,
    'languages', v_after.languages);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.approve_tradition_pack_release(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION internal_api.deprecate_tradition_pack_release(p_release_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_row   public.tradition_pack_releases%ROWTYPE;
  v_after public.tradition_pack_releases%ROWTYPE;
  v_weds  integer;
  v_vers  integer;
BEGIN
  SELECT * INTO v_row FROM public.tradition_pack_releases r WHERE r.id = p_release_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no release % is in the catalogue', p_release_id
      USING ERRCODE = 'raise_exception';
  END IF;
  IF v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'release % of pack % is %, and only an approved release can be retired: '
                    'there is nothing to withdraw that was ever offered',
      v_row.release_number, v_row.pack_id, v_row.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Counted and reported, never used as a condition. A release whose retirement were blocked
  -- by the weddings still pointing at it could never be withdrawn, which would make
  -- "deprecated" a word for "retired only when convenient"; and the invitations already frozen
  -- from it are unchanged either way, because a frozen document does not consult the
  -- catalogue.
  SELECT count(*)::integer INTO v_weds FROM public.weddings w
   WHERE w.tradition_pack_release_id = p_release_id;
  SELECT count(*)::integer INTO v_vers FROM public.invitation_versions v
   WHERE v.tradition_pack_release_id = p_release_id;

  UPDATE public.tradition_pack_releases r SET status = 'deprecated' WHERE r.id = p_release_id;
  SELECT * INTO v_after FROM public.tradition_pack_releases r WHERE r.id = p_release_id;

  RETURN jsonb_build_object(
    'release_id', p_release_id, 'pack_id', v_after.pack_id,
    'release_number', v_after.release_number,
    'status_before', 'approved', 'status_after', v_after.status,
    'transition', 'approved -> deprecated',
    'review_packet_hash', v_after.review_packet_hash,
    'weddings_still_selecting', v_weds,
    'versions_frozen_from_it', v_vers,
    'note', 'existing invitations keep their answer: the weddings still attached can read '
            || 'this row and the versions frozen from it are byte-for-byte unchanged, but no '
            || 'new wedding can select it and no new version can be frozen from it');
END;
$$;

REVOKE ALL ON FUNCTION internal_api.deprecate_tradition_pack_release(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ------------------------------------------------------------------------ the two reports

-- "Would this ship as it stands?" for a release nobody has chosen, per declared language,
-- against an empty host document. It is the same engine the freeze uses on the same shape of
-- input, which is the only version of this answer worth having: a second validator would be a
-- second rule.
--
-- What it does not do is structural validation, and it is worth being explicit about why:
-- every row in this table passed the lifecycle guard's key-by-key walk to exist at all, so
-- re-checking the shape here would duplicate the guard. To test a definition that has not been
-- written yet, write it as a draft — the guard is the validator, a draft is invisible to
-- customers, and a draft is the one release state the deletion guard lets go.
CREATE FUNCTION internal_api.validate_tradition_pack_release(p_release_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_row    public.tradition_pack_releases%ROWTYPE;
  v_lang   text;
  v_docs   jsonb := '[]'::jsonb;
  v_out    jsonb;
BEGIN
  SELECT * INTO v_row FROM public.tradition_pack_releases r WHERE r.id = p_release_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no release % is in the catalogue', p_release_id
      USING ERRCODE = 'raise_exception';
  END IF;

  FOR v_lang IN SELECT l FROM unnest(v_row.languages) l ORDER BY l COLLATE "C" LOOP
    v_out := private.invitation_issue_records(
      jsonb_build_object(
        'sections', jsonb_build_object(
          'requested', v_lang,
          'items', private.resolve_invitation_sections(v_row.definition, v_lang, '{}'::jsonb)),
        'people', '[]'::jsonb,
        'events', '[]'::jsonb,
        'draft', '{}'::jsonb,
        'tradition_pack_release', jsonb_build_object(
          'definition_schema_version', v_row.definition_schema_version,
          'languages', v_row.languages)),
      v_row.definition);
    v_docs := v_docs || jsonb_build_array(jsonb_build_object(
      'language', v_lang,
      'sections', (SELECT count(*)::integer
                     FROM jsonb_array_elements(
                       private.resolve_invitation_sections(v_row.definition, v_lang,
                                                           '{}'::jsonb))),
      -- The verdict an author is asking for, in the form the freeze will use it: an empty
      -- host document with no people, no events and nothing typed. Everything blocking here
      -- is something the release asks of a host rather than offers them.
      'issues', v_out));
  END LOOP;

  RETURN jsonb_build_object(
    'release_id', p_release_id,
    'release_number', v_row.release_number,
    'status', v_row.status,
    'definition_schema_version', v_row.definition_schema_version,
    'per_language', v_docs);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.validate_tradition_pack_release(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.validate_tradition_pack_release(uuid) IS
  'What this release would ask of a host who has written nothing yet, per language, from the '
  'same record engine the freeze reads.';

-- §20's retention view. One row per release, with the counts that decide whether it can be
-- retired and the timestamps that say when it moved. No customer field appears in it: the
-- counts are aggregates over other people's rows, deliberately the most this surface will say
-- about them.
CREATE FUNCTION internal_api.tradition_pack_retention_report() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
    'generated_at', now(),
    'releases', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'pack_key', p.pack_key,
               'pack_display_name', p.display_name,
               'release_number', r.release_number,
               'status', r.status,
               'definition_schema_version', r.definition_schema_version,
               'languages', r.languages,
               'created_at', r.created_at,
               'reviewed_at', r.reviewed_at,
               'approved_at', r.approved_at,
               'deprecated_at', r.deprecated_at,
               'review_packet_hash', r.review_packet_hash,
               'review_binding_current',
                 r.review_packet_hash IS NOT NULL AND r.review_packet_hash =
                 private.tradition_pack_review_hash(
                   r.pack_id, r.release_number, r.definition_schema_version, r.languages,
                   r.definition, r.author_label, r.machine_assisted,
                   r.machine_assistance_notes, r.source_reference, r.changelog),
               'weddings_selecting', (SELECT count(*)::integer FROM public.weddings w
                                       WHERE w.tradition_pack_release_id = r.id),
               'versions_frozen', (SELECT count(*)::integer FROM public.invitation_versions v
                                    WHERE v.tradition_pack_release_id = r.id),
               'can_deprecate', r.status = 'approved',
               'can_delete', r.status = 'draft',
               'live_wedding_attached', EXISTS (
                 SELECT 1 FROM public.weddings w
                  WHERE w.tradition_pack_release_id = r.id))
             ORDER BY p.pack_key COLLATE "C", r.release_number)
        FROM public.tradition_pack_releases r
        JOIN public.tradition_packs p ON p.id = r.pack_id), '[]'::jsonb))
    INTO v_out;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION internal_api.tradition_pack_retention_report()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.tradition_pack_retention_report() IS
  'Every release with its lifecycle timestamps, how many weddings and frozen versions still '
  'refer to it, and whether it can be deprecated or deleted. Maintenance only: it names '
  'digests and counts across every customer''s rows, which is the reason it has no browser '
  'door and no grant to any client role.';

-- ===========================================================================
-- 8. WHAT THIS FILE LEAVES ALONE, AND THE PRIVILEGE SHAPE IT PRODUCES
-- ===========================================================================
--
-- A migration is judged as much by what it declines to touch as by what it does, so the
-- deliberate non-changes are written down beside the changes rather than left to be inferred
-- from absence.
--
-- **No new table, no new policy, no new column beyond `review_packet_hash`.** Stage 4 already
-- owns the versioned release schema, the ordering, the lifecycle, the selection and freeze
-- gates, and the provenance columns. Every Stage 5 gap that §3 of the audit records is a gap
-- in *rules the server applies*, not a missing place to store a fact, so the definition keeps
-- travelling inside `definition` jsonb. An extra column per named concept would split one
-- fact across two representations, and a release whose `definition` says `pack_only` while a
-- column says something else is a release nobody can review.
--
-- **`private.public_invitation_dto` is untouched, and `snapshot_schema_version` stays 2.** The
-- 13-key resolved-section shape and the 11-key snapshot release block already carry every
-- Stage 5 fact: `body_source`, `overrode_pack_text`, `language_used` and `used_fallback` are
-- all present in Stage 4's output, so provenance for the four states §7 of the audit names is
-- a matter of which value the resolver now picks, not of a new field. Widening the shape would
-- collide with the DTO's version guard, which refuses any snapshot version it was not written
-- for, and would make historical frozen documents unreadable — the one outcome §A forbids.
--
-- **The five named lifecycle CHECKs are not edited.** `machine_assistance_disclosure_required`,
-- `draft_carries_no_review_metadata`, `review_metadata_is_mandatory`,
-- `approved_at_matches_status` and `deprecated_at_matches_status` all still hold exactly what
-- they held in Stage 4. §1 explains why "past draft implies a hash" is a guard rule rather than
-- a sixth CHECK: a CHECK would either need the historical rows backfilled — inventing a review
-- digest for a release nobody reviewed — or the constraint dropped. Both would be worse than
-- the rule living in the one place that sees every transition.
--
-- **`public.tradition_packs`, its row policies and its write trigger are untouched**, as are
-- `public.weddings`' selection gate, `public.invitation_versions`' freeze gate, the draft
-- visibility policies and the design-template rules. The catalogue visibility rule is Stage
-- 4's, and Stage 5 changed nothing about who may read a pack.
--
-- The privilege shape this file produces, stated as the rules the Stage 5 battery then
-- asserts, so the shape is measured rather than claimed:
--
--   * `api` gains exactly one name, `preview_invitation_document`, and it is SECURITY INVOKER
--     with a pinned search path like every other function in that schema. Executable by
--     `authenticated`, by `anon` never.
--   * `internal_api` gains twelve names, of which exactly one (`preview_invitation_document`)
--     is executable by `authenticated`. The other eleven are the maintenance surface: no grant
--     to `anon`, `authenticated` or `service_role`, and no `api.` twin. The Stage 4 inventory
--     group's rule "every privileged function has a public twin" is therefore replaced by a
--     stricter one rather than relaxed: the surface is enumerated by name, and a twelfth
--     unlisted name fails the battery.
--   * `private` gains eight helpers and re-declares three functions forward. All eleven are
--     revoked from `PUBLIC`, `anon` and `authenticated`, and `private` is a schema no client
--     role has USAGE on, which is what keeps the review-hash machinery reachable only through
--     the guard and the maintenance bodies rather than from a request.
--
-- Exact counts are the battery's to report, not this file's to assert: a number written here
-- and measured elsewhere is a comment that can rot, and §L asks for the measurement.
