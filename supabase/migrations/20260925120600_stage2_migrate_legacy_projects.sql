-- Stage 2 / file 7 of 9 — carry real historical content into the canonical domain.
--
-- Rules this file is written under:
--   * IDs are preserved, so a bookmarked project id still means the same thing;
--   * a value the canonical schema cannot represent is *not* coerced into a
--     similar-looking one. It is normalised to "unknown" and the original claim is
--     written to legacy.migration_findings, which is evidence, not product truth;
--   * billing claims are recorded and then dropped on the floor: no entitlement is
--     created from them, in this file or in any later one;
--   * anything whose meaning cannot be proven from the data itself is left in the
--     archived table rather than guessed at (see `public.guests`).

-- ===========================================================================
-- Findings table (lives in `legacy`: it is about old rows, not customers)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS legacy.migration_findings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table text NOT NULL,
  source_id uuid,
  field text NOT NULL,
  legacy_value text,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- 1. templates -> design_templates
-- ===========================================================================
--
-- `price_tier` and `tags` have no canonical home: a tier label on a design is
-- guessed commerce metadata (Phase 27) and tags describe nothing the schema
-- queries. Both remain readable in legacy.templates.
-- `active` maps to the catalogue state, not to a review: no legacy template was
-- ever assessed by a named reviewer, so none may be 'approved'.

INSERT INTO public.design_templates (
  id, template_key, revision, display_name, status, supported_languages,
  preview_svg, layout_settings, created_at, updated_at
)
SELECT
  t.id,
  -- Deterministic and collision-free: derived from the name for legibility,
  -- salted with the row id so two legacy rows called "Classic" stay two rows.
  coalesce(nullif(btrim(lower(regexp_replace(t.name, '[^[:alnum:]]+', '-', 'g'))), ''), 'legacy')
    || '-' || left(t.id::text, 8),
  1,
  btrim(t.name),
  CASE WHEN t.active IS DISTINCT FROM true THEN 'deprecated' ELSE 'draft' END,
  -- An empty or out-of-set list would violate the subset CHECK, so the smallest
  -- truthful value is '{en}' *plus* a finding naming what was actually stored.
  CASE
    WHEN coalesce(array_length(t.language_support, 1), 0) = 0 THEN ARRAY['en']::text[]
    WHEN t.language_support <@ ARRAY['en','ta','te','ml','kn']::text[] THEN t.language_support
    ELSE ARRAY['en']::text[]
  END,
  t.preview_svg,
  '{}'::jsonb,
  t.created_at,
  now()
FROM public.templates t
WHERE t.name IS NOT NULL AND length(btrim(t.name)) > 0;

INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'templates', t.id, 'name', t.name,
       'not migrated: an empty display name cannot satisfy the canonical constraint; row left in legacy.templates'
FROM public.templates t
WHERE t.name IS NULL OR length(btrim(t.name)) = 0;

INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'templates', t.id, 'language_support',
       array_to_string(t.language_support, ','),
       'migrated as {en}: stored list was empty or contained codes outside the first-release set'
FROM public.templates t
WHERE t.name IS NOT NULL AND length(btrim(t.name)) > 0
  AND (coalesce(array_length(t.language_support, 1), 0) = 0
       OR NOT (t.language_support <@ ARRAY['en','ta','te','ml','kn']::text[]));

INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'templates', t.id, 'active', t.active::text,
       'migrated as status=deprecated (active was NULL, so the flag cannot be read as a live catalogue entry)'
FROM public.templates t
WHERE t.name IS NOT NULL AND length(btrim(t.name)) > 0 AND t.active IS NULL;

-- ===========================================================================
-- 2. projects -> weddings
-- ===========================================================================
--
-- Skipped entirely (and recorded) when a row cannot carry a canonical title.
-- Normalised (and recorded) when the row is real but a field value is not
-- representable.
--
-- There is deliberately no "row has no owner" branch. `projects.user_id` is
-- NOT NULL with a foreign key to `auth.users` and ON DELETE CASCADE, so an
-- ownerless legacy project cannot be stored, and deleting an account deletes
-- its projects. The canonical NOT NULL is therefore satisfied by the old
-- schema's own integrity, not by a guess — and the Stage 2 suite asserts that
-- every migrated wedding resolves to a live account, rather than the fixture
-- pretending to produce a row the database never allowed.

INSERT INTO public.weddings (
  id, owner_user_id, title, primary_language, additional_languages,
  tradition_pack_id, design_template_id, style_settings,
  estimated_guest_count, lifecycle_status, created_at, updated_at
)
SELECT
  p.id,
  p.user_id,
  btrim(p.title),
  -- NULL, never a guess: 'hi' in a legacy row does not license us to decide the
  -- wedding is in English, and 'en' is not a safe fallback either.
  CASE WHEN p.language IN ('en','ta','te','ml','kn') THEN p.language ELSE NULL END,
  ARRAY[]::text[],
  NULL,
  -- Keep the template link only when that template itself migrated.
  CASE WHEN dt.id IS NOT NULL THEN p.template_id ELSE NULL END,
  -- The legacy catch-all is not copied. Only the visual editor block, which is the
  -- one key the application actually reads, becomes style_settings.
  CASE WHEN jsonb_typeof(p.selected_features -> 'editor') = 'object'
       THEN p.selected_features -> 'editor'
       ELSE '{}'::jsonb END,
  CASE WHEN p.guest_count IS NULL OR p.guest_count < 0 THEN 0 ELSE p.guest_count END,
  'draft',
  p.created_at,
  p.updated_at
FROM public.projects p
LEFT JOIN public.design_templates dt ON dt.id = p.template_id
WHERE length(btrim(p.title)) > 0;

INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'projects', p.id, 'title', p.title,
       'not migrated: empty title cannot satisfy the canonical constraint; left in legacy.projects'
FROM public.projects p
WHERE length(btrim(p.title)) = 0;

INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'projects', p.id, 'language', p.language,
       'migrated with primary_language = NULL: stored value is not a first-release code and no language may be inferred'
FROM public.projects p
WHERE length(btrim(p.title)) > 0
  AND p.language IS NOT NULL AND p.language NOT IN ('en','ta','te','ml','kn');

INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'projects', p.id, 'template_id', p.template_id::text,
       'migrated with design_template_id = NULL: the referenced row did not migrate'
FROM public.projects p
WHERE length(btrim(p.title)) > 0
  AND p.template_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.design_templates dt WHERE dt.id = p.template_id);

INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'projects', p.id, 'guest_count', p.guest_count::text,
       'migrated as 0: a negative estimate is not a usable number'
FROM public.projects p
WHERE length(btrim(p.title)) > 0
  AND p.guest_count IS NOT NULL AND p.guest_count < 0;

-- Anything besides the editor block in the old catch-all is unexplained. It is not
-- reinterpreted; it is listed so a human can decide what it meant.
INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'projects', p.id, 'selected_features',
       (SELECT string_agg(k, ',' ORDER BY k)
          FROM jsonb_object_keys(p.selected_features) k
         WHERE k <> 'editor'),
       'not migrated: keys other than "editor" have no canonical meaning; original JSON left in legacy.projects'
FROM public.projects p
WHERE length(btrim(p.title)) > 0
  AND jsonb_typeof(p.selected_features) = 'object'
  AND EXISTS (SELECT 1 FROM jsonb_object_keys(p.selected_features) k WHERE k <> 'editor');

INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'projects', p.id, 'selected_features',
       jsonb_typeof(p.selected_features),
       'migrated with empty style_settings: the stored value was not a JSON object'
FROM public.projects p
WHERE length(btrim(p.title)) > 0
  AND p.selected_features IS NOT NULL
  AND jsonb_typeof(p.selected_features) <> 'object';

-- The editor block itself can be the wrong shape while the surrounding object is
-- fine ("editor": "Playfair Display"). That must be recorded too: leaving it
-- unmentioned would make an empty style_settings look like an untouched wedding.
INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'projects', p.id, 'selected_features->editor',
       jsonb_typeof(p.selected_features -> 'editor'),
       'migrated with empty style_settings: the editor block was not a JSON object'
FROM public.projects p
WHERE length(btrim(p.title)) > 0
  AND jsonb_typeof(p.selected_features) = 'object'
  AND p.selected_features ? 'editor'
  AND jsonb_typeof(p.selected_features -> 'editor') <> 'object';

-- ===========================================================================
-- 3. Legacy billing claims: recorded, then stopped at the door
-- ===========================================================================
--
-- Phase 26/37: an old paid_status is not evidence of a purchase. It was settable by
-- a client until Stage 0 closed it, and the product never took money. So the claim
-- is preserved as a finding for manual review and *nothing* is written to
-- public.entitlements — not here, and not by a later "sync" either.

INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'projects', p.id, 'paid_status', p.paid_status::text,
       'not migrated: no entitlement was created from a legacy billing flag'
FROM public.projects p
WHERE p.paid_status IS NOT NULL AND p.paid_status <> 'unpaid';

-- ===========================================================================
-- 4. One empty working draft per migrated wedding
-- ===========================================================================
--
-- The draft is a row that exists so the editing surface has a target, not content
-- we recovered: the legacy editor JSON was visual settings, and nothing else is
-- claimed.

INSERT INTO public.invitation_drafts (wedding_id, content, created_at, updated_at)
SELECT w.id, '{}'::jsonb, w.created_at, w.updated_at
FROM public.weddings w;

-- ===========================================================================
-- 5. Explicitly NOT migrated, with the reason recorded
-- ===========================================================================
--
-- public.guests: one row per person, with group_name, meal_type, accommodation and
-- a plaintext bearer token. Turning that into households requires believing that
-- group_name identifies a family rather than a category ("Bride's side"), and
-- nothing in the data proves it. Phase 7 forbids that inference, so the rows are
-- archived untouched and no household, scope or RSVP is created from them.
INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'projects', p.id, 'guests', (SELECT count(*)::text FROM public.guests g WHERE g.project_id = p.id),
       'not migrated: legacy guest rows are per-person with unproven group_name semantics; no household was invented'
FROM public.projects p
WHERE EXISTS (SELECT 1 FROM public.guests g WHERE g.project_id = p.id);

-- public.activity_logs: the new trail is private.audit_events. Copying old rows in
-- would give unverified history the authority of an audit table, so it is archived
-- instead of laundered.
INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'activity_logs', a.id, 'action', a.action,
       'not migrated: unverified legacy log rows are archived, not promoted into private.audit_events'
FROM public.activity_logs a;

-- public.orders / payments / printers: guessed commerce scaffolding with no live
-- provider behind it. Archived for inspection; Stage 10 designs these properly.
INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'orders', o.id, 'status', o.status::text,
       'not migrated: scaffold order rows are archived, not modelled as VivaahVarnam orders'
FROM public.orders o;

INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'payments', pm.id, 'amount_paise', pm.amount_paise::text,
       'not migrated: scaffold payment rows are archived; no entitlement follows from them'
FROM public.payments pm;

-- invitation_versions / publications stay empty: a version is a resolved render,
-- and there is no renderer yet. Minting one from a draft would create a snapshot
-- whose shape nothing has agreed to.
INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'projects', p.id, 'invitation_versions', '0',
       'not created: versioning needs the Stage 3 render contract; drafts migrated without any published version'
FROM public.projects p
WHERE p.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id)
  AND p.title IS NOT NULL AND length(btrim(p.title)) > 0;

-- ===========================================================================
-- 6. People: nothing inventable, so nothing created
-- ===========================================================================
--
-- wedding_people starts empty for migrated weddings. The legacy editor stored
-- free-text lines, not structured hosts/couple/elders, and parsing names out of a
-- text block would put words in a family's mouth. Stage 5 collects them.
INSERT INTO legacy.migration_findings (source_table, source_id, field, legacy_value, action)
SELECT 'projects', p.id, 'wedding_people', '0',
       'not migrated: legacy content has no structured host/couple data to map onto wedding_people'
FROM public.projects p
WHERE p.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id)
  AND p.title IS NOT NULL AND length(btrim(p.title)) > 0;
