-- Stage 2 security qualification suite.
-- Run AFTER bootstrap + published migrations + the Stage 2 chain, as superuser.
--
-- Mode-independent: this file is about the canonical schema, which is identical
-- whether or not the legacy fixture was seeded first. Migration outcomes are
-- asserted by 30_migration_empty.sql / 30_migration_legacy.sql.
--
-- Refusals are told apart on purpose, because "it errored" proves nothing by
-- itself:
--   42501 + "permission denied"                     the privilege layer refused it
--   42501 + "server-authoritative" / "append-only"  the trigger backstop refused a
--                                                   write that a privilege allowed
--   0 rows affected                                 RLS hid the row from the caller
--   23503 / 23514 / 23505                           relational integrity refused it
-- Group 11 distinguishes two of those on purpose: an append-only row deleted by a
-- *client* meets the trigger, and one a cascade would have taken meets the foreign
-- key instead — because a cascade deletes as the child table's owner, which is why
-- the trigger could never have been the barrier.
-- A probe that reports 'no-error' is a failed test, never an unreported pass.
--
-- Row references inside probe statements are read from `probe.*` settings rather
-- than interpolated, so the statements stay literal and any role can execute them.

SET client_min_messages = notice;

-- Helpers, in pg_temp: they die with the run, so the catalogue inventory in
-- 40_catalog.sql never has to special-case test scaffolding out of `public`.
-- They are SECURITY INVOKER, so a statement run through them is checked against
-- the impersonated role, not against the maintenance role that owns them.
-- (Measured, not assumed: the helpers stay callable after SET ROLE, while the
-- temp tables below are not readable by an impersonated role — so the loops load
-- their probe rows into arrays first, while still the owner.)
-- ---------------------------------------------------------------------------

CREATE FUNCTION pg_temp.st2_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- Rows the CURRENT role can read. SECURITY INVOKER, so RLS applies.
CREATE FUNCTION pg_temp.st2_visible(select_sql text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || select_sql || ') q' INTO n;
  RETURN n;
END $$;

-- Rows a write touched. A refusal propagates, so this is only used where success
-- is the expectation: a blocked write must never be mistaken for a passing zero.
CREATE FUNCTION pg_temp.st2_changed(stmt text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ===========================================================================
-- Seed, through the maintenance role: the server-authoritative tables are only
-- writable by a trusted path, so the trusted path has to build the rows this
-- suite then attacks.
-- ===========================================================================
CREATE TEMP TABLE seed ON COMMIT DROP AS
SELECT
  gen_random_uuid() AS owner_a,        gen_random_uuid() AS owner_b,
  gen_random_uuid() AS outsider,       gen_random_uuid() AS wedding_a,
  gen_random_uuid() AS wedding_b,      gen_random_uuid() AS pack,
  gen_random_uuid() AS pack_unshipped, gen_random_uuid() AS release_ok,
  gen_random_uuid() AS release_dep,    gen_random_uuid() AS release_draft,
  gen_random_uuid() AS release_reviewed,
  gen_random_uuid() AS template,       gen_random_uuid() AS template_dep,
  gen_random_uuid() AS person_a,       gen_random_uuid() AS venue_a,
  gen_random_uuid() AS venue_b,        gen_random_uuid() AS event_a1,
  gen_random_uuid() AS event_a2,       gen_random_uuid() AS event_a3,
  gen_random_uuid() AS event_b1,       gen_random_uuid() AS version_a1,
  gen_random_uuid() AS version_b1,
  gen_random_uuid() AS publication_a1, gen_random_uuid() AS publication_b1,
  gen_random_uuid() AS household_a,    gen_random_uuid() AS household_b,
  gen_random_uuid() AS rsvp_a,         gen_random_uuid() AS request_a,
  gen_random_uuid() AS feedback_a,     gen_random_uuid() AS asset_a,
  gen_random_uuid() AS entitlement_a,  gen_random_uuid() AS token_a,
  gen_random_uuid() AS person_b,
  gen_random_uuid() AS rsvp_b,         gen_random_uuid() AS request_b,
  gen_random_uuid() AS feedback_b,     gen_random_uuid() AS asset_b,
  gen_random_uuid() AS entitlement_b;

-- Signups go through auth.users, which also exercises the relocated
-- private.handle_new_user(): profile and default role must appear by themselves.
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT s.owner_a, 'owner-a@example.test', jsonb_build_object('name', 'Asha') FROM seed s
UNION ALL SELECT s.owner_b, 'owner-b@example.test', '{}'::jsonb FROM seed s
UNION ALL SELECT s.outsider, 'outsider@example.test', '{}'::jsonb FROM seed s;

-- Platform content in every catalogue state, which since Stage 4 spans two levels: the
-- pack is the concept a host chooses, and a *release* is the frozen definition a document
-- can pin. `deprecated` must vanish from a customer's read; a template's `draft` must
-- stay readable, because a migrated legacy template has never been reviewed and the
-- picker would otherwise go blank — while a *release* draft must NOT be readable, which
-- is the asymmetry §9 asks for and group 9 measures.
--
-- Everything here is TEST ONLY. The review record beside it is synthetic: no Tamil
-- reader has reviewed these strings, `machine_assisted` is true, the wording is product
-- structure rather than religious text, and the Tamil below is present so that a
-- language-resolution path has two languages to resolve — no assertion in this file
-- measures how a string is spelled.
INSERT INTO public.tradition_packs (id, pack_key, display_name, scope_statement)
SELECT s.pack, 'tamil_vaasthu', 'TEST ONLY — Tamil Vaasthu',
       'TEST ONLY — a synthetic bilingual pack shape used by the Stage 2 attack battery. '
       'It claims no tradition, reviews no religious text, and is never shipped.'
  FROM seed s
UNION ALL
SELECT s.pack_unshipped, 'unshipped_pack', 'TEST ONLY — unshipped candidate',
       'TEST ONLY — a pack whose every release is still unapproved, so neither the '
       'concept nor its wording may reach a customer at all.' FROM seed s;

-- The lifecycle (§6 of the Stage 4 migration) makes an approved release unrepresentable
-- in one statement: the guard refuses a row born as anything but draft, and freezes its
-- content the moment it stops being one. So the trusted path walks the legal steps
-- instead of writing an end state — which is also what makes "approval cannot be faked
-- by an INSERT" a measured fact rather than a documented claim.
--
-- `reviewed_by` stays NULL on purpose. §18 asks for a label and a stated qualification,
-- not a reviewer account, and inventing a row in `auth.users` to credit would be exactly
-- the fabricated-human-review this stage is not allowed to produce.
-- The small definition, reused by three releases. A pg_temp function rather than a
-- repeated literal, because a dollar-quoted body cannot be referenced twice.
CREATE FUNCTION pg_temp.st2_def_small() RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "sections": [
      {"section_key": "opening", "position": 1, "kind": "text", "required": true,
       "host_field": "welcome", "heading": {"en": "Opening"}},
      {"section_key": "family", "position": 2, "kind": "people_list", "required": false,
       "heading": {"en": "Our families"}}
    ]
  }'::jsonb;
$$;

INSERT INTO public.tradition_pack_releases
  (id, pack_id, release_number, definition_schema_version, languages, definition,
   author_label, machine_assisted, machine_assistance_notes, source_reference, changelog)
SELECT s.release_ok, s.pack, 1, 1, ARRAY['en', 'ta'], $def1${
  "sections": [
    {"section_key": "opening", "position": 1, "kind": "text", "required": true,
     "host_field": "welcome", "allow_english_fallback": true,
     "heading": {"en": "Opening", "ta": "தொடக்கம்"},
     "pack_text": {"en": "With the goodwill of both families.", "ta": "வணக்கம்"}},
    {"section_key": "family", "position": 2, "kind": "people_list", "required": true,
     "heading": {"en": "Our families", "ta": "குடும்பம்"}},
    {"section_key": "ceremonies", "position": 3, "kind": "event_list", "required": true,
     "heading": {"en": "The ceremonies", "ta": "நிகழ்ச்சிகள்"}},
    {"section_key": "event_notes", "position": 4, "kind": "text", "required": false,
     "host_field": "event_notes", "allow_english_fallback": true},
    {"section_key": "blessing", "position": 5, "kind": "text", "required": false,
     "allow_english_fallback": true,
     "pack_text": {"en": "A line the pack offers, which the host may replace.",
                   "ta": "நன்றி"}}
  ],
  "event_vocabulary": [
    {"event_key": "muhurtham", "labels": {"en": "Muhurtham"}},
    {"event_key": "reception", "labels": {"en": "Reception"}}
  ],
  "design_guidance": {"lead_size": 32, "motif_reference": "TEST ONLY — no motif ships"}
}$def1$::jsonb,
  'TEST ONLY — synthetic authored fixture', true,
  'TEST ONLY — drafted by a model from product structure, checked for shape and language '
  'coverage only. No human reader of Tamil reviewed these strings.',
  'TEST ONLY — no external source', 'Stage 2 battery fixture' FROM seed s
UNION ALL
SELECT s.release_dep, s.pack, 2, 1, ARRAY['en', 'ta'], pg_temp.st2_def_small(),
  'TEST ONLY — synthetic authored fixture', true,
  'TEST ONLY — drafted by a model from product structure, checked for shape and language '
  'coverage only. No human reader of Tamil reviewed these strings.',
  NULL, 'Second release, retired after approval' FROM seed s
UNION ALL
SELECT s.release_draft, s.pack_unshipped, 1, 1, ARRAY['en', 'ta'], pg_temp.st2_def_small(),
  'TEST ONLY — unreviewed draft candidate', true,
  'TEST ONLY — drafted by a model. Nobody has reviewed this one at all, which is what '
  'draft means.', NULL, NULL FROM seed s
UNION ALL
SELECT s.release_reviewed, s.pack_unshipped, 2, 1, ARRAY['en', 'ta'], pg_temp.st2_def_small(),
  'TEST ONLY — reviewed but never approved', true,
  'TEST ONLY — drafted by a model. A synthetic review record was written against it; no '
  'human reader of Tamil has reviewed these strings.', NULL, NULL FROM seed s;

-- draft → reviewed. `reviewed` is still not selectable; it only says a record exists.
UPDATE public.tradition_pack_releases r
   SET status = 'reviewed', reviewed_at = now(),
       review_label = 'TEST ONLY — REVIEWED FIXTURE',
       review_basis = 'TEST ONLY — a synthetic record written by the Stage 2 battery. '
                      'No human reader of Tamil reviewed these strings.',
       review_scope = 'TEST ONLY — section order and structure only. No language review, '
                      'no religious or community endorsement, no customer validation.',
       reviewed_languages = ARRAY['en', 'ta']
  FROM seed s
 WHERE r.id IN (s.release_ok, s.release_dep, s.release_reviewed);

-- reviewed → approved, carrying the record it was reviewed under forward untouched.
UPDATE public.tradition_pack_releases r SET status = 'approved'
  FROM seed s WHERE r.id IN (s.release_ok, s.release_dep);

-- approved → deprecated: the only step out of `approved`, and the row stays forever.
UPDATE public.tradition_pack_releases r SET status = 'deprecated'
  FROM seed s WHERE r.id = s.release_dep;

INSERT INTO public.design_templates (id, template_key, revision, display_name, status,
                                     supported_languages, preview_svg, layout_settings, reviewed_by, reviewed_at)
SELECT s.template, 'maroon-heritage', 1, 'Maroon Heritage', 'approved',
       ARRAY['en', 'ta'],
       '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
       '{"sections": ["header"]}'::jsonb, s.owner_a, now() FROM seed s;

INSERT INTO public.design_templates (id, template_key, revision, display_name, status, supported_languages)
SELECT s.template_dep, 'old-layout', 1, 'Old Layout', 'deprecated', ARRAY['en']::text[]
FROM seed s;

INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages,
                             tradition_pack_release_id, design_template_id, style_settings,
                             estimated_guest_count)
SELECT s.wedding_a, s.owner_a, 'Asha Canonical', 'ta', ARRAY['en'], s.release_ok, s.template,
       '{"font": "Playfair Display"}'::jsonb, 120 FROM seed s
UNION ALL
SELECT s.wedding_b, s.owner_b, 'Bala Canonical', 'en', '{}'::text[], NULL, NULL,
       '{}'::jsonb, 40 FROM seed s;

INSERT INTO public.wedding_people (id, wedding_id, display_name, role_key, role_label, group_key, display_order)
SELECT s.person_a, s.wedding_a, 'Ravi', 'brother', 'Brother', 'family', 1 FROM seed s;

INSERT INTO public.venues (id, wedding_id, name, address_text, map_url, latitude, longitude)
SELECT s.venue_a, s.wedding_a, 'Kalyana Mantapa', '1 MG Road, Mysuru',
       'https://maps.example.test/mysuru', 12.295800, 76.639300 FROM seed s
UNION ALL
SELECT s.venue_b, s.wedding_b, 'Bala Hall', NULL, NULL, NULL, NULL FROM seed s;

-- The literal timestamps need an explicit cast: UNION ALL resolves an untyped
-- literal to `text` in its first branch, and INSERT will not quietly re-coerce
-- text into the column's `timestamp without time zone`.
INSERT INTO public.wedding_events (id, wedding_id, event_key, display_name, starts_at_local,
                                   ends_at_local, timezone, venue_id, display_order)
SELECT s.event_a1, s.wedding_a, 'muhurtham', 'Muhurtham', '2026-11-14 07:30'::timestamp,
       '2026-11-14 09:00'::timestamp, 'Asia/Kolkata', s.venue_a, 1 FROM seed s
UNION ALL
SELECT s.event_a2, s.wedding_a, 'reception', 'Reception', '2026-11-15 18:00'::timestamp, NULL,
       'Asia/Kolkata', s.venue_a, 2 FROM seed s
UNION ALL
-- Deliberately outside every household scope, so "answer for an event you were
-- never invited to" has something concrete to aim at.
SELECT s.event_a3, s.wedding_a, 'get_together', 'Get together', '2026-11-13 17:00'::timestamp, NULL,
       'Asia/Kolkata', NULL, 3 FROM seed s
UNION ALL
SELECT s.event_b1, s.wedding_b, 'muhurtham', 'Muhurtham', '2026-12-01 08:00'::timestamp, NULL,
       'Asia/Kolkata', s.venue_b, 1 FROM seed s;

-- A draft is no longer a row the caller mints: since the Stage 3 invariant, an INSERT
-- into weddings brings exactly one draft with it. So the seed edits the row the wedding
-- created rather than inserting its own id. The one-row assertion is the point — a
-- zero-row UPDATE would pass silently, which is exactly how a missing trigger would
-- hide. The content under attack is unchanged.
DO $seed_draft$
DECLARE n bigint;
BEGIN
  UPDATE public.invitation_drafts d SET content = '{"heading": "Asha weds Bala"}'::jsonb
    FROM seed s WHERE d.wedding_id = s.wedding_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'SEED: wedding A arrived with % drafts, expected exactly 1', n;
  END IF;
END $seed_draft$;

INSERT INTO public.invitation_versions (id, wedding_id, version_number, snapshot,
                                        tradition_pack_release_id, design_template_id, created_by)
SELECT s.version_a1, s.wedding_a, 1, '{"heading": "Asha weds Bala"}'::jsonb, s.release_ok,
       s.template, s.owner_a FROM seed s
UNION ALL
SELECT s.version_b1, s.wedding_b, 1, '{"heading": "Bala weds Divya"}'::jsonb, NULL,
       NULL, s.owner_b FROM seed s;

INSERT INTO public.publications (id, wedding_id, version_id, status)
SELECT s.publication_a1, s.wedding_a, s.version_a1, 'active' FROM seed s
UNION ALL
SELECT s.publication_b1, s.wedding_b, s.version_b1, 'active' FROM seed s;

INSERT INTO public.guest_households (id, wedding_id, display_name, salutation, expected_party_size)
SELECT s.household_a, s.wedding_a, 'The Rao Family', 'Rao family', 4 FROM seed s
UNION ALL
SELECT s.household_b, s.wedding_b, 'The Iyer Family', 'Iyer family', 2 FROM seed s;

INSERT INTO public.household_event_scopes (wedding_id, household_id, event_id)
SELECT s.wedding_a, s.household_a, s.event_a1 FROM seed s
UNION ALL
SELECT s.wedding_a, s.household_a, s.event_a2 FROM seed s;

INSERT INTO public.rsvp_responses (id, wedding_id, household_id, event_id, attending,
                                   party_size, response_source, answers)
SELECT s.rsvp_a, s.wedding_a, s.household_a, s.event_a1, 'attending', 3, 'host_manual',
       '{"meal": "veg"}'::jsonb FROM seed s;

INSERT INTO public.approval_requests (id, wedding_id, version_id, reviewer_display_name,
                                      reviewer_contact_text, status)
SELECT s.request_a, s.wedding_a, s.version_a1, 'Chethan', 'chethan@example.test',
                                      'pending' FROM seed s;

INSERT INTO public.approval_feedback (id, wedding_id, request_id, version_id, feedback_kind,
                                      decision, author_label)
SELECT s.feedback_a, s.wedding_a, s.request_a, s.version_a1, 'decision', 'approved',
       'Chethan' FROM seed s;

INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, label, object_key, mime_type,
                                   size_bytes, is_generated)
SELECT s.asset_a, s.wedding_a, 'photo', 'Couple', 'weddings/seed/photo-1.jpg',
       'image/jpeg', 204800, false FROM seed s;

INSERT INTO public.entitlements (id, wedding_id, package_code, status, source, metadata)
SELECT s.entitlement_a, s.wedding_a, 'print-plus', 'active', 'service',
       '{"note": "granted by the trusted path in this test"}'::jsonb FROM seed s;

-- Wedding B carries one row in EVERY wedding-scoped table, not just some of them.
-- Isolation is asserted in both directions, and the "B still reads its own rows"
-- half is worthless if B has no rows to read: it would pass on an over-blocking
-- policy that hides everything from everyone.
INSERT INTO public.wedding_people (id, wedding_id, display_name, role_key, role_label, group_key, display_order)
SELECT s.person_b, s.wedding_b, 'Latha', 'sister', 'Sister', 'family', 1 FROM seed s;

DO $seed_draft_b$
DECLARE n bigint;
BEGIN
  UPDATE public.invitation_drafts d SET content = '{"heading": "Bala weds Divya"}'::jsonb
    FROM seed s WHERE d.wedding_id = s.wedding_b;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'SEED: wedding B arrived with % drafts, expected exactly 1', n;
  END IF;
END $seed_draft_b$;

INSERT INTO public.household_event_scopes (wedding_id, household_id, event_id)
SELECT s.wedding_b, s.household_b, s.event_b1 FROM seed s;

INSERT INTO public.rsvp_responses (id, wedding_id, household_id, event_id, attending,
                                   party_size, response_source, answers)
SELECT s.rsvp_b, s.wedding_b, s.household_b, s.event_b1, 'attending', 2, 'host_manual',
       '{"meal": "veg"}'::jsonb FROM seed s;

INSERT INTO public.approval_requests (id, wedding_id, version_id, reviewer_display_name,
                                      reviewer_contact_text, status)
SELECT s.request_b, s.wedding_b, s.version_b1, 'Reviewer B', 'reviewer-b@example.test',
                                      'pending' FROM seed s;

INSERT INTO public.approval_feedback (id, wedding_id, request_id, version_id, feedback_kind,
                                      author_label, message)
SELECT s.feedback_b, s.wedding_b, s.request_b, s.version_b1, 'comment',
       'Reviewer B', 'the gopura photo is too dark' FROM seed s;

INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, label, object_key, mime_type,
                                   size_bytes, is_generated)
SELECT s.asset_b, s.wedding_b, 'photo', 'Couple B', 'weddings/seed/photo-2.jpg',
       'image/jpeg', 102400, false FROM seed s;

INSERT INTO public.entitlements (id, wedding_id, package_code, status, source, metadata)
SELECT s.entitlement_b, s.wedding_b, 'print-plus', 'active', 'service',
       '{"note": "second wedding, same trusted grant"}'::jsonb FROM seed s;

-- A hash, never a token: no column in this schema can hold the bearer value.
INSERT INTO private.access_tokens (id, token_hash, token_kind, wedding_id, publication_id,
                                   household_id, expiry_policy, created_by_role)
SELECT s.token_a, repeat('ab', 32), 'guest_invitation', s.wedding_a, s.publication_a1,
       s.household_a, 'no_expiry', 'postgres' FROM seed s;

INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
SELECT s.wedding_a, 'wedding', s.wedding_a, 'stage2_suite_seed', s.owner_a,
       '{"reason": "test"}'::jsonb FROM seed s;

-- ===========================================================================
-- Probe sets. Every row is one statement that must be refused; the loops treat
-- 'no-error' as a failure, so a probe cannot quietly stop meaning anything.
-- ===========================================================================

-- Writes a customer must never make, even about their own wedding. Run as
-- `authenticated` holding owner A's identity.
CREATE TEMP TABLE probes_privileged (label text, stmt text) ON COMMIT DROP;
INSERT INTO probes_privileged (label, stmt) VALUES
  ('mint an entitlement for my own wedding',
   $t$INSERT INTO public.entitlements (wedding_id, package_code, status, source)
      VALUES (current_setting('probe.wedding_a')::uuid, 'free-forever', 'active', 'service')$t$),
  ('un-revoke an entitlement I never bought',
   $t$UPDATE public.entitlements SET status = 'active', revoked_at = NULL
      WHERE wedding_id = current_setting('probe.wedding_a')::uuid$t$),
  ('delete an entitlement record',
   $t$DELETE FROM public.entitlements WHERE wedding_id = current_setting('probe.wedding_a')::uuid$t$),
  ('publish without the server',
   $t$INSERT INTO public.publications (wedding_id, version_id, status)
      VALUES (current_setting('probe.wedding_a')::uuid,
              (SELECT id FROM public.invitation_versions
                WHERE wedding_id = current_setting('probe.wedding_a')::uuid LIMIT 1), 'active')$t$),
  ('freeze a published version by rewriting it',
   $t$UPDATE public.invitation_versions SET snapshot = '{"heading": "rewritten"}'::jsonb
      WHERE wedding_id = current_setting('probe.wedding_a')::uuid$t$),
  ('erase version history',
   $t$DELETE FROM public.invitation_versions WHERE wedding_id = current_setting('probe.wedding_a')::uuid$t$),
  ('open an approval request myself',
   $t$INSERT INTO public.approval_requests (wedding_id, version_id, reviewer_display_name)
      VALUES (current_setting('probe.wedding_a')::uuid,
              (SELECT id FROM public.invitation_versions
                WHERE wedding_id = current_setting('probe.wedding_a')::uuid LIMIT 1), 'me')$t$),
  ('answer an approval request on the reviewer''s behalf',
   $t$UPDATE public.approval_requests SET status = 'approved', responded_at = now()
      WHERE wedding_id = current_setting('probe.wedding_a')::uuid$t$),
  ('rewrite approval feedback',
   $t$UPDATE public.approval_feedback SET decision = 'approved'
      WHERE wedding_id = current_setting('probe.wedding_a')::uuid$t$),
  ('delete approval feedback',
   $t$DELETE FROM public.approval_feedback WHERE wedding_id = current_setting('probe.wedding_a')::uuid$t$),
  ('add myself to the design catalogue',
   $t$INSERT INTO public.design_templates (template_key, revision, display_name)
      VALUES ('mine', 1, 'Mine')$t$),
  ('retitle a catalogue template',
   $t$UPDATE public.design_templates SET display_name = 'Free for everyone'$t$),
  ('remove a tradition pack',
   $t$DELETE FROM public.tradition_packs$t$),
  -- Stage 4 §9: "RLS and grants must make pack administration impossible through a
  -- user JWT". The three rows above reach the catalogue concept; the five below reach
  -- the release, which is where the authority actually lives — content, lifecycle and
  -- the review record.
  ('add a tradition pack to the catalogue',
   $t$INSERT INTO public.tradition_packs (pack_key, display_name, scope_statement)
      VALUES ('my_own_pack', 'Mine', 'A pack a customer wrote, which is not a thing they do')$t$),
  ('retitle a tradition pack',
   $t$UPDATE public.tradition_packs SET display_name = 'Free for everyone'
      WHERE pack_key = 'tamil_vaasthu'$t$),
  ('write a tradition pack release',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 99, 1, ARRAY['en'],
              pg_temp.st2_def_small(), 'Mine')$t$),
  ('promote a release to approved myself',
   $t$UPDATE public.tradition_pack_releases SET status = 'approved'
      WHERE pack_id = current_setting('probe.pack')::uuid$t$),
  ('sign a release as its own reviewer',
   $t$UPDATE public.tradition_pack_releases
         SET review_label = 'Reviewed by me', reviewed_at = now(),
             review_basis = 'I read it, which is the whole point of this probe',
             review_scope = 'Everything, claimed by the customer who may not claim it',
             reviewed_languages = ARRAY['en', 'ta']
      WHERE id = current_setting('probe.release_draft')::uuid$t$),
  ('delete an approved release',
   $t$DELETE FROM public.tradition_pack_releases
      WHERE id = current_setting('probe.release_ok')::uuid$t$),
  ('write the audit trail',
   $t$INSERT INTO private.audit_events (subject_type, action) VALUES ('wedding', 'forged')$t$),
  ('read the audit trail',
   $t$SELECT * FROM private.audit_events$t$),
  ('read hashed access credentials',
   $t$SELECT * FROM private.access_tokens$t$),
  ('mint an access credential',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, expiry_policy, created_by_role)
      VALUES ('0', 'rsvp', current_setting('probe.wedding_a')::uuid, 'no_expiry', 'authenticated')$t$),
  ('promote myself to admin',
   $t$INSERT INTO public.user_roles (user_id, role) VALUES (current_setting('probe.owner_a')::uuid, 'admin')$t$),
  ('rewrite my own role row',
   $t$UPDATE public.user_roles SET role = 'admin'
      WHERE user_id = current_setting('probe.owner_a')::uuid$t$);

-- Relational integrity: a reference may not cross a wedding boundary. Run as the
-- maintenance role, because these are constraint tests rather than privilege tests.
CREATE TEMP TABLE probes_cross_wedding (label text, stmt text) ON COMMIT DROP;
INSERT INTO probes_cross_wedding (label, stmt) VALUES
  ('hold an event in someone else''s venue',
   $t$INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local, venue_id)
      VALUES (current_setting('probe.wedding_a')::uuid, 'stolen', 'Stolen',
              '2026-11-20 10:00', current_setting('probe.venue_b')::uuid)$t$),
  ('scope a stranger''s household onto my event',
   $t$INSERT INTO public.household_event_scopes (wedding_id, household_id, event_id)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.household_b')::uuid,
              current_setting('probe.event_a1')::uuid)$t$),
  ('scope my household onto a stranger''s event',
   $t$INSERT INTO public.household_event_scopes (wedding_id, household_id, event_id)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.household_a')::uuid,
              current_setting('probe.event_b1')::uuid)$t$),
  ('claim a scope for a wedding that does not own the household',
   $t$INSERT INTO public.household_event_scopes (wedding_id, household_id, event_id)
      VALUES (current_setting('probe.wedding_b')::uuid,
              current_setting('probe.household_a')::uuid,
              current_setting('probe.event_a1')::uuid)$t$),
  ('record an answer for an event nobody was invited to',
   $t$INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, response_source)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.household_a')::uuid,
              current_setting('probe.event_a3')::uuid, 'attending', 1, 'host_manual')$t$),
  ('record an answer for a household across the wedding boundary',
   $t$INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, response_source)
      VALUES (current_setting('probe.wedding_b')::uuid,
              current_setting('probe.household_a')::uuid,
              current_setting('probe.event_b1')::uuid, 'attending', 1, 'host_manual')$t$),
  ('publish a version belonging to another wedding',
   -- 'revoked' rather than 'active' on purpose: wedding A already holds an active
   -- publication, and a probe that trips the one-active-per-wedding index first
   -- would report 23505 and prove nothing about the cross-wedding foreign key.
   $t$INSERT INTO public.publications (wedding_id, version_id, status, published_at, revoked_at)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.version_b1')::uuid, 'revoked',
              now() - interval '1 hour', now())$t$),
  ('ask a reviewer to approve a borrowed version',
   $t$INSERT INTO public.approval_requests (wedding_id, version_id, reviewer_display_name)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.version_b1')::uuid, 'them')$t$),
  ('attach feedback to a version the request never referenced',
   $t$INSERT INTO public.approval_feedback (wedding_id, request_id, version_id, feedback_kind,
                                           decision, author_label)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.request_a')::uuid,
              current_setting('probe.version_b1')::uuid, 'decision', 'approved',
              'peer')$t$),
  ('supersede a version from another wedding',
   $t$INSERT INTO public.invitation_versions (wedding_id, version_number, snapshot, created_by, supersedes_version_id)
      VALUES (current_setting('probe.wedding_a')::uuid, 9, '{"x": 1}'::jsonb,
              current_setting('probe.owner_a')::uuid,
              current_setting('probe.version_b1')::uuid)$t$),
  ('open a scope for a wedding that never existed',
   $t$INSERT INTO public.household_event_scopes (wedding_id, household_id, event_id)
      VALUES (gen_random_uuid(),
              current_setting('probe.household_a')::uuid,
              current_setting('probe.event_a1')::uuid)$t$),
  ('issue a guest credential over a stranger''s household',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, household_id, expiry_policy, created_by_role)
      VALUES (repeat('cd', 32), 'guest_invitation',
              current_setting('probe.wedding_a')::uuid,
              current_setting('probe.publication_a1')::uuid,
              current_setting('probe.household_b')::uuid, 'no_expiry', 'postgres')$t$);

-- Invalid states the schema itself must refuse, whatever role is asking.
CREATE TEMP TABLE probes_state (label text, expect text, stmt text) ON COMMIT DROP;
INSERT INTO probes_state (label, expect, stmt) VALUES
  -- weddings
  ('blank wedding title', '23514',
   $t$INSERT INTO public.weddings (owner_user_id, title)
      VALUES (current_setting('probe.owner_a')::uuid, '   ')$t$),
  ('language outside the first-release set', '23514',
   $t$INSERT INTO public.weddings (owner_user_id, title, primary_language)
      VALUES (current_setting('probe.owner_a')::uuid, 'Hindi test', 'hi')$t$),
  ('primary language repeated in the additional list', '23514',
   $t$INSERT INTO public.weddings (owner_user_id, title, primary_language, additional_languages)
      VALUES (current_setting('probe.owner_a')::uuid, 'Duplicated', 'ta', ARRAY['ta','en'])$t$),
  ('additional language outside the set', '23514',
   $t$INSERT INTO public.weddings (owner_user_id, title, additional_languages)
      VALUES (current_setting('probe.owner_a')::uuid, 'Stray code', ARRAY['xx'])$t$),
  ('negative guest estimate', '23514',
   $t$INSERT INTO public.weddings (owner_user_id, title, estimated_guest_count)
      VALUES (current_setting('probe.owner_a')::uuid, 'Impossible count', -1)$t$),
  ('style settings that is not an object', '23514',
   $t$INSERT INTO public.weddings (owner_user_id, title, style_settings)
      VALUES (current_setting('probe.owner_a')::uuid, 'Array style', '[]'::jsonb)$t$),
  ('lifecycle state that does not exist', '23514',
   $t$INSERT INTO public.weddings (owner_user_id, title, lifecycle_status)
      VALUES (current_setting('probe.owner_a')::uuid, 'Published early', 'published')$t$),
  ('wedding with no owner', '23502',
   $t$INSERT INTO public.weddings (owner_user_id, title) VALUES (NULL, 'Homeless')$t$),
  ('wedding owned by an account that does not exist', '23503',
   $t$INSERT INTO public.weddings (owner_user_id, title)
      VALUES (gen_random_uuid(), 'Orphan')$t$),
  -- people, venues, events
  ('person with a blank role key', '23514',
   $t$INSERT INTO public.wedding_people (wedding_id, display_name, role_key)
      VALUES (current_setting('probe.wedding_a')::uuid, 'Brought to you by', '  ')$t$),
  ('person with a negative display order', '23514',
   $t$INSERT INTO public.wedding_people (wedding_id, display_name, role_key, display_order)
      VALUES (current_setting('probe.wedding_a')::uuid, 'Early', 'guest', -1)$t$),
  ('venue with a blank name', '23514',
   $t$INSERT INTO public.venues (wedding_id, name)
      VALUES (current_setting('probe.wedding_a')::uuid, ' ')$t$),
  ('venue map link that is not https', '23514',
   $t$INSERT INTO public.venues (wedding_id, name, map_url)
      VALUES (current_setting('probe.wedding_a')::uuid, 'Insecure', 'http://maps.example.test/x')$t$),
  ('venue latitude off the planet', '23514',
   $t$INSERT INTO public.venues (wedding_id, name, latitude)
      VALUES (current_setting('probe.wedding_a')::uuid, 'North of north', 100)$t$),
  ('event ending before it starts', '23514',
   $t$INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local, ends_at_local)
      VALUES (current_setting('probe.wedding_a')::uuid, 'time-warp', 'Warp',
              '2026-11-14 10:00', '2026-11-14 09:00')$t$),
  ('event with a blank display name', '23514',
   $t$INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local)
      VALUES (current_setting('probe.wedding_a')::uuid, 'anon-event', '  ', '2026-11-14 10:00')$t$),
  ('event with no timezone named', '23514',
   $t$INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local, timezone)
      VALUES (current_setting('probe.wedding_a')::uuid, 'zt', 'Zoneless', '2026-11-14 10:00', '')$t$),
  -- platform catalogue
  ('template revision zero', '23514',
   $t$INSERT INTO public.design_templates (template_key, revision, display_name) VALUES ('rev0', 0, 'Rev zero')$t$),
  ('template with a blank display name', '23514',
   $t$INSERT INTO public.design_templates (template_key, revision, display_name) VALUES ('blank', 1, '  ')$t$),
  ('template supporting no language', '23514',
   $t$INSERT INTO public.design_templates (template_key, revision, display_name, supported_languages)
      VALUES ('nolang', 1, 'No language', ARRAY[]::text[])$t$),
  ('template supporting an unknown language', '23514',
   $t$INSERT INTO public.design_templates (template_key, revision, display_name, supported_languages)
      VALUES ('unknown', 1, 'Unknown language', ARRAY['en','xx'])$t$),
  ('template status outside the vocabulary', '23514',
   $t$INSERT INTO public.design_templates (template_key, revision, display_name, status)
      VALUES ('live', 1, 'Live-ish', 'live')$t$),
  ('template approved with no reviewer', '23514',
   $t$INSERT INTO public.design_templates (template_key, revision, display_name, status)
      VALUES ('unreviewed', 1, 'Self approved', 'approved')$t$),
  ('template reviewed but not approved', '23514',
   $t$INSERT INTO public.design_templates (template_key, revision, display_name, status, reviewed_by, reviewed_at)
      VALUES ('half', 1, 'Half reviewed', 'draft',
              current_setting('probe.owner_a')::uuid, now())$t$),
  ('template layout that is not an object', '23514',
   $t$INSERT INTO public.design_templates (template_key, revision, display_name, layout_settings)
      VALUES ('scalar', 1, 'Scalar layout', '5'::jsonb)$t$),
  ('two revisions claiming the same slot', '23505',
   $t$INSERT INTO public.design_templates (template_key, revision, display_name)
      VALUES ('maroon-heritage', 1, 'Maroon Heritage copy')$t$),
  -- The catalogue concept: identity only, since Stage 4 moved content and lifecycle onto
  -- releases. A slug is a slug, a scope statement has to be long enough to be a scope
  -- statement, and two concepts cannot share a key.
  ('pack slug with a hyphen in it', '23514',
   $t$INSERT INTO public.tradition_packs (pack_key, display_name, scope_statement)
      VALUES ('tamil-vaasthu-again', 'Hyphen', 'A scope statement long enough to be legal here')$t$),
  ('pack whose scope statement is a shrug', '23514',
   $t$INSERT INTO public.tradition_packs (pack_key, display_name, scope_statement)
      VALUES ('shrug_pack', 'Shrug', 'n/a')$t$),
  ('two packs claiming the same key', '23505',
   $t$INSERT INTO public.tradition_packs (pack_key, display_name, scope_statement)
      VALUES ('tamil_vaasthu', 'Duplicate', 'A scope statement long enough to be legal here')$t$),
  -- A release definition is not free-form JSON, and a release lifecycle is not a suggestion.
  -- Each row below is refused by the rule its label names, which is *measured* by the
  -- expected message in `probe_msgs` rather than by the label alone: the first version of
  -- this block asserted only the SQLSTATE, and because 23514 is what every CHECK and every
  -- guard-RAISE in this schema reports, six of those rows were being refused by the pinned
  -- section vocabulary instead of by the rule they claimed to test (`section_key: 'a'` is
  -- not a slot the build renders, so it was refused as an unknown slot and the gap-ordering
  -- rule underneath was never reached). Every section_key below is therefore inside the
  -- vocabulary, and the message is part of the expectation.
  ('release with no sections at all', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 50, 1, ARRAY['en', 'ta'],
              '{"sections": []}'::jsonb, 'TEST ONLY — probe')$t$),
  ('release whose sections key is absent rather than empty', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 61, 1, ARRAY['en', 'ta'],
              '{"design_guidance": {"lead_size": 20}}'::jsonb, 'TEST ONLY — probe')$t$),
  ('release whose sections key is not an array', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 63, 1, ARRAY['en', 'ta'],
              '{"sections": {"section_key": "opening"}}'::jsonb, 'TEST ONLY — probe')$t$),
  ('release whose section names a kind no renderer knows', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 51, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "blessing", "position": 1, "kind": "temple_hymn",
                              "required": false, "heading": {"en": "Blessing"}}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose section omits the kind entirely', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 64, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "blessing", "position": 1,
                              "required": false, "heading": {"en": "Blessing"}}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release naming a slot this build has nowhere to render', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 65, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "unknown_slot", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release repeating one section slot twice', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 66, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome"},
                             {"section_key": "opening", "position": 2, "kind": "text",
                              "required": false, "host_field": "closing"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose section order leaves a gap', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 52, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome"},
                             {"section_key": "closing", "position": 3, "kind": "text",
                              "required": false, "host_field": "closing"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release with two sections in one position', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 53, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome"},
                             {"section_key": "closing", "position": 1, "kind": "text",
                              "required": false, "host_field": "closing"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose section has no numeric position', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 67, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "kind": "text",
                              "required": false, "host_field": "welcome"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose position is a string, not a number', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 68, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": "1", "kind": "text",
                              "required": false, "host_field": "welcome"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose text section says nothing', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 54, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "blessing", "position": 1, "kind": "text",
                              "required": false}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose list section reads a host field', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 55, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "family", "position": 1, "kind": "people_list",
                              "required": false, "host_field": "welcome"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release declaring two people lists', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 69, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "family", "position": 1, "kind": "people_list",
                              "required": false},
                             {"section_key": "couple", "position": 2, "kind": "people_list",
                              "required": false}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release declaring two event lists', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 70, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "ceremonies", "position": 1, "kind": "event_list",
                              "required": false},
                             {"section_key": "venue", "position": 2, "kind": "event_list",
                              "required": false}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  -- One people list *and* one event list is legal — the rule is per kind, and it used to be
  -- written as a single counter over both, which refused the second of one kind only by
  -- accident and let two people lists through. This row is that mistake's control.
  ('release with one people list and one event list', 'no-error',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 71, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "family", "position": 1, "kind": "people_list",
                              "required": false},
                             {"section_key": "ceremonies", "position": 2, "kind": "event_list",
                              "required": false}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release reading a host field that does not exist', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 56, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "guest_phone_numbers"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release with two sections reading one host field', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 72, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome"},
                             {"section_key": "closing", "position": 2, "kind": "text",
                              "required": false, "host_field": "welcome"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release carrying an unknown key in a section', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 57, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome",
                              "css": "body {display: none}"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose section omits the required flag', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 73, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "host_field": "welcome"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose required flag is a string', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 74, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": "yes", "host_field": "welcome"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose list section carries reviewed wording', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 75, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "family", "position": 1, "kind": "people_list",
                              "required": false,
                              "pack_text": {"en": "A list draws rows, not sentences."}}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose heading is a bare string', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 76, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome",
                              "heading": "Opening"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose heading is blank after trimming', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 78, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome",
                              "heading": {"en": "   "}}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose wording is blank after trimming', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 79, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "blessing", "position": 1, "kind": "text",
                              "required": false, "pack_text": {"en": "  "}}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  -- Directive §14: an unsupported locale has to be unrepresentable rather than quietly
  -- ignored. A string in a language the release never claims, and a fallback to a
  -- language it never claims, are the two shapes that mistake takes.
  ('release declaring a heading in a language it does not cover', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 58, 1, ARRAY['en'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome",
                              "heading": {"en": "Opening", "ta": "தொடக்கம்"}}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release declaring wording in a language it does not cover', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 80, 1, ARRAY['en'],
              '{"sections": [{"section_key": "blessing", "position": 1, "kind": "text",
                              "required": false,
                              "pack_text": {"en": "Fine.", "ta": "சரி"}}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release allowing an English fallback it never declared', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 59, 1, ARRAY['ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome",
                              "allow_english_fallback": true,
                              "heading": {"ta": "தொடக்கம்"}}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release claiming a language outside the product set', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 60, 1, ARRAY['en', 'hi'],
              pg_temp.st2_def_small(), 'TEST ONLY — probe')$t$),
  ('release whose language list is unsorted', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 81, 1, ARRAY['ta', 'en'],
              pg_temp.st2_def_small(), 'TEST ONLY — probe')$t$),
  ('release whose language list repeats a language', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 82, 1, ARRAY['en', 'en'],
              pg_temp.st2_def_small(), 'TEST ONLY — probe')$t$),
  ('release whose definition carries a key this build does not understand', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 83, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome"}],
                "caste_rules": {"by_surname": "assign"}}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose event vocabulary entry carries an unknown key', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 84, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome"}],
                "event_vocabulary": [{"event_key": "muhurtham",
                                      "labels": {"en": "Muhurtham"}, "religion": "hindu"}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose event vocabulary key is not a slug', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 85, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome"}],
                "event_vocabulary": [{"event_key": "Muhurtham Ceremony",
                                      "labels": {"en": "Muhurtham"}}]}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose design guidance is out of range', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 86, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome"}],
                "design_guidance": {"lead_size": 400}}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose design guidance carries an unknown key', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 87, 1, ARRAY['en', 'ta'],
              '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                              "required": false, "host_field": "welcome"}],
                "design_guidance": {"temple_gopuram_svg": "<svg/>"}}'::jsonb,
              'TEST ONLY — probe')$t$),
  ('release whose definition schema version this build cannot read', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 62, 99, ARRAY['en'],
              pg_temp.st2_def_small(), 'TEST ONLY — probe')$t$),
  ('release with no release number', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 0, 1, ARRAY['en'],
              pg_temp.st2_def_small(), 'TEST ONLY — probe')$t$),
  ('two releases of one pack in the same slot', '23505',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (current_setting('probe.pack')::uuid, 1, 1, ARRAY['en'],
              pg_temp.st2_def_small(), 'TEST ONLY — probe')$t$),
  ('release belonging to no pack', '23503',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label)
      VALUES (gen_random_uuid(), 1, 1, ARRAY['en'],
              pg_temp.st2_def_small(), 'TEST ONLY — probe')$t$),
  ('release created already reviewed', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label, status,
            reviewed_at, review_label, review_basis, review_scope, reviewed_languages)
      VALUES (current_setting('probe.pack')::uuid, 88, 1, ARRAY['en', 'ta'],
              pg_temp.st2_def_small(), 'TEST ONLY — probe', 'reviewed', now(),
              'TEST ONLY — REVIEWED', 'TEST ONLY — synthetic record, nobody read the Tamil.',
              'TEST ONLY — structure only.', ARRAY['en', 'ta'])$t$),
  ('release created already approved', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label, status,
            reviewed_at, approved_at, review_label, review_basis, review_scope,
            reviewed_languages)
      VALUES (current_setting('probe.pack')::uuid, 89, 1, ARRAY['en', 'ta'],
              pg_temp.st2_def_small(), 'TEST ONLY — probe', 'approved', now(), now(),
              'TEST ONLY — APPROVED', 'TEST ONLY — synthetic record, nobody read the Tamil.',
              'TEST ONLY — structure only.', ARRAY['en', 'ta'])$t$),
  -- Directive §B: machine assistance is disclosed or it is not representable. A release
  -- that says a model drafted it has to say so in prose a reader sees; the control half
  -- of this pair is group 16's, because a successful INSERT cannot live in a table whose
  -- loop asserts refusal.
  ('machine-assisted release with no disclosure', '23514',
   $t$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
            definition_schema_version, languages, definition, author_label,
            machine_assisted)
      VALUES (current_setting('probe.pack')::uuid, 90, 1, ARRAY['en', 'ta'],
              pg_temp.st2_def_small(), 'TEST ONLY — probe', true)$t$),
  ('draft given a review label', '23514',
   $t$UPDATE public.tradition_pack_releases SET review_label = 'TEST ONLY — REVIEWED'
      WHERE id = current_setting('probe.release_draft')::uuid$t$),
  ('draft given an approval timestamp', '23514',
   $t$UPDATE public.tradition_pack_releases SET approved_at = now()
      WHERE id = current_setting('probe.release_draft')::uuid$t$),
  ('draft given a retirement timestamp', '23514',
   $t$UPDATE public.tradition_pack_releases SET deprecated_at = now()
      WHERE id = current_setting('probe.release_draft')::uuid$t$),
  -- Each of these three is one statement that both moves the status and writes the
  -- metadata the move requires — the review record has to arrive *with* the step, and the
  -- rules below are the halves of "with" that a caller might leave out.
  ('draft promoted without saying when it was reviewed', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET status = 'reviewed', review_label = 'TEST ONLY — REVIEWED',
            review_basis = 'TEST ONLY — synthetic record, nobody read the Tamil.',
            review_scope = 'TEST ONLY — structure only.', reviewed_languages = ARRAY['en','ta']
      WHERE id = current_setting('probe.release_draft')::uuid$t$),
  ('draft promoted with no basis for the review', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET status = 'reviewed', reviewed_at = now(),
            review_label = 'TEST ONLY — REVIEWED',
            review_scope = 'TEST ONLY — structure only.', reviewed_languages = ARRAY['en','ta']
      WHERE id = current_setting('probe.release_draft')::uuid$t$),
  ('draft promoted on a review too short to be a claim', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET status = 'reviewed', reviewed_at = now(), review_label = 'TEST ONLY — REVIEWED',
            review_basis = 'short', review_scope = 'TEST ONLY — structure only.',
            reviewed_languages = ARRAY['en','ta']
      WHERE id = current_setting('probe.release_draft')::uuid$t$),
  ('draft promoted on a language the release never covered', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET status = 'reviewed', reviewed_at = now(), review_label = 'TEST ONLY — REVIEWED',
            review_basis = 'TEST ONLY — synthetic record, nobody read the Tamil.',
            review_scope = 'TEST ONLY — structure only.', reviewed_languages = ARRAY['en','ml']
      WHERE id = current_setting('probe.release_draft')::uuid$t$),
  ('draft promoted on an empty reviewed-language list', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET status = 'reviewed', reviewed_at = now(), review_label = 'TEST ONLY — REVIEWED',
            review_basis = 'TEST ONLY — synthetic record, nobody read the Tamil.',
            review_scope = 'TEST ONLY — structure only.', reviewed_languages = ARRAY[]::text[]
      WHERE id = current_setting('probe.release_draft')::uuid$t$),
  ('draft promoted on an unsorted reviewed-language list', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET status = 'reviewed', reviewed_at = now(), review_label = 'TEST ONLY — REVIEWED',
            review_basis = 'TEST ONLY — synthetic record, nobody read the Tamil.',
            review_scope = 'TEST ONLY — structure only.', reviewed_languages = ARRAY['ta','en']
      WHERE id = current_setting('probe.release_draft')::uuid$t$),
  -- §B: `reviewed_by` is optional, and where it points is a real account. A caller cannot
  -- sign a review with an invented person.
  ('review naming a reviewer who does not exist', '23503',
   $t$UPDATE public.tradition_pack_releases
        SET status = 'reviewed', reviewed_at = now(), review_label = 'TEST ONLY — REVIEWED',
            review_basis = 'TEST ONLY — synthetic record, nobody read the Tamil.',
            review_scope = 'TEST ONLY — structure only.', reviewed_languages = ARRAY['en','ta'],
            reviewed_by = gen_random_uuid()
      WHERE id = current_setting('probe.release_draft')::uuid$t$),
  ('draft promoted straight to approved', '23514',
   $t$UPDATE public.tradition_pack_releases SET status = 'approved'
      WHERE id = current_setting('probe.release_draft')::uuid$t$),
  ('draft promoted straight to deprecated', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET status = 'deprecated', deprecated_at = now()
      WHERE id = current_setting('probe.release_draft')::uuid$t$),
  ('reviewed release moved back to draft', '23514',
   $t$UPDATE public.tradition_pack_releases SET status = 'draft'
      WHERE id = current_setting('probe.release_reviewed')::uuid$t$),
  ('reviewed release moved straight to deprecated', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET status = 'deprecated', deprecated_at = now()
      WHERE id = current_setting('probe.release_reviewed')::uuid$t$),
  ('approved release moved back to reviewed', '23514',
   $t$UPDATE public.tradition_pack_releases SET status = 'reviewed', approved_at = NULL
      WHERE id = current_setting('probe.release_ok')::uuid$t$),
  ('deprecated release restored to approved', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET status = 'approved', deprecated_at = NULL
      WHERE id = current_setting('probe.release_dep')::uuid$t$),
  -- The review record arriving is the draft→reviewed step; after that it is part of the
  -- frozen unit. Each row below is a different door on the same room: restating the review
  -- *while* approving it, restating it while retiring it, and restating it later with the
  -- status left exactly where it is.
  ('approval restating the review it was based on', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET status = 'approved', review_scope = 'TEST ONLY — restated at approval'
      WHERE id = current_setting('probe.release_reviewed')::uuid$t$),
  ('approval attaching a reviewer it did not review with', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET status = 'approved', reviewed_by = current_setting('probe.owner_a')::uuid
      WHERE id = current_setting('probe.release_reviewed')::uuid$t$),
  ('retirement restating the review it was approved under', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET status = 'deprecated', review_scope = 'TEST ONLY — restated at retirement'
      WHERE id = current_setting('probe.release_ok')::uuid$t$),
  ('approved release''s review record rewritten', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET review_scope = 'TEST ONLY — rewritten after approval'
      WHERE id = current_setting('probe.release_ok')::uuid$t$),
  ('approved release''s review timestamp moved', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET reviewed_at = now() - interval '5 years'
      WHERE id = current_setting('probe.release_ok')::uuid$t$),
  ('approved release''s reviewer identity attached afterwards', '23514',
   $t$UPDATE public.tradition_pack_releases
        SET reviewed_by = current_setting('probe.owner_a')::uuid
      WHERE id = current_setting('probe.release_ok')::uuid$t$),
  ('approved release''s approval timestamp dropped', '23514',
   $t$UPDATE public.tradition_pack_releases SET approved_at = NULL
      WHERE id = current_setting('probe.release_ok')::uuid$t$),
  -- Reviewed content is a review unit (ruling A2), so the wording beside that review record
  -- freezes at the same moment. Group 15e measures the same rule on an *approved* release;
  -- these two rows are the step before it, where the row already carries a review claim.
  ('reviewed release''s wording edited after review', '23514',
   $t$UPDATE public.tradition_pack_releases SET definition =
        '{"sections": [{"section_key": "opening", "position": 1, "kind": "text",
                        "required": false, "host_field": "welcome",
                        "heading": {"en": "Opening"}},
                       {"section_key": "family", "position": 2, "kind": "people_list",
                        "required": false, "heading": {"en": "The families"}}]}'::jsonb
      WHERE id = current_setting('probe.release_reviewed')::uuid$t$),
  ('reviewed release''s language list edited after review', '23514',
   $t$UPDATE public.tradition_pack_releases SET languages = ARRAY['en']
      WHERE id = current_setting('probe.release_reviewed')::uuid$t$),
  -- Withdrawing platform content that a customer already relies on has to fail,
  -- whatever role asks: a published invitation must not lose its template or its pack
  -- under the customer's feet. This is the delete side of "admin/service write only".
  ('withdraw a template a snapshot still points at', '23503',
   $t$DELETE FROM public.design_templates WHERE id = current_setting('probe.template')::uuid$t$),
  ('withdraw a pack whose releases still exist', '23503',
   $t$DELETE FROM public.tradition_packs WHERE id = current_setting('probe.pack')::uuid$t$),
  ('withdraw the unshipped pack while its candidate is still a release', '23503',
   $t$DELETE FROM public.tradition_packs
      WHERE id = current_setting('probe.pack_unshipped')::uuid$t$),
  -- guests and responses
  ('household with a blank name', '23514',
   $t$INSERT INTO public.guest_households (wedding_id, display_name)
      VALUES (current_setting('probe.wedding_a')::uuid, '  ')$t$),
  ('household expecting nobody', '23514',
   $t$INSERT INTO public.guest_households (wedding_id, display_name, expected_party_size)
      VALUES (current_setting('probe.wedding_a')::uuid, 'Zero', 0)$t$),
  ('response that is neither yes nor no', '23514',
   $t$INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, response_source)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.household_a')::uuid,
              current_setting('probe.event_a1')::uuid, 'maybe', 1, 'host_manual')$t$),
  ('response with a negative party size', '23514',
   $t$INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, response_source)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.household_a')::uuid,
              current_setting('probe.event_a1')::uuid, 'attending', -1, 'host_manual')$t$),
  ('response attributed to a source that does not exist', '23514',
   $t$INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, response_source)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.household_a')::uuid,
              current_setting('probe.event_a1')::uuid, 'attending', 1, 'oracle')$t$),
  ('response answers that are not an object', '23514',
   $t$INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, response_source, answers)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.household_a')::uuid,
              current_setting('probe.event_a1')::uuid, 'attending', 1, 'host_manual', '[]'::jsonb)$t$),
  ('second response for one household and event', '23505',
   $t$INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, response_source)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.household_a')::uuid,
              current_setting('probe.event_a1')::uuid, 'declined', 1, 'host_manual')$t$),
  -- approvals
  ('approval request with an unnamed reviewer', '23514',
   $t$INSERT INTO public.approval_requests (wedding_id, version_id, reviewer_display_name)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.version_a1')::uuid, ' ')$t$),
  ('approval status outside the vocabulary', '23514',
   $t$INSERT INTO public.approval_requests (wedding_id, version_id, reviewer_display_name, status)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.version_a1')::uuid, 'peer', 'denied')$t$),
  ('approval marked decided with no decision time', '23514',
   $t$INSERT INTO public.approval_requests (wedding_id, version_id, reviewer_display_name, status)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.version_a1')::uuid, 'peer', 'approved')$t$),
  ('approval invalidated without a status that says so', '23514',
   $t$INSERT INTO public.approval_requests (wedding_id, version_id, reviewer_display_name, status, invalidated_at)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.version_a1')::uuid, 'peer', 'pending', now())$t$),
  ('feedback kind outside the vocabulary', '23514',
   $t$INSERT INTO public.approval_feedback (wedding_id, request_id, version_id, feedback_kind, author_label)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.request_a')::uuid,
              current_setting('probe.version_a1')::uuid, 'note', 'peer')$t$),
  ('decision feedback with no decision', '23514',
   $t$INSERT INTO public.approval_feedback (wedding_id, request_id, version_id, feedback_kind, author_label)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.request_a')::uuid,
              current_setting('probe.version_a1')::uuid, 'decision', 'peer')$t$),
  ('comment feedback with no comment', '23514',
   $t$INSERT INTO public.approval_feedback (wedding_id, request_id, version_id, feedback_kind, author_label, message)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.request_a')::uuid,
              current_setting('probe.version_a1')::uuid, 'comment', 'peer', '   ')$t$),
  ('feedback carrying a decision it should not have', '23514',
   $t$INSERT INTO public.approval_feedback (wedding_id, request_id, version_id, feedback_kind, author_label, decision, message)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.request_a')::uuid,
              current_setting('probe.version_a1')::uuid, 'comment', 'peer', 'approved', 'nice')$t$),
  -- assets
  ('asset key that escapes its prefix', '23514',
   $t$INSERT INTO public.wedding_assets (wedding_id, asset_kind, object_key)
      VALUES (current_setting('probe.wedding_a')::uuid, 'photo', '/etc/passwd')$t$),
  ('asset key with a traversal segment', '23514',
   $t$INSERT INTO public.wedding_assets (wedding_id, asset_kind, object_key)
      VALUES (current_setting('probe.wedding_a')::uuid, 'photo', 'weddings/../../other/x.jpg')$t$),
  ('asset with a negative size', '23514',
   $t$INSERT INTO public.wedding_assets (wedding_id, asset_kind, object_key, size_bytes)
      VALUES (current_setting('probe.wedding_a')::uuid, 'photo', 'weddings/a.jpg', -1)$t$),
  ('asset kind outside the vocabulary', '23514',
   $t$INSERT INTO public.wedding_assets (wedding_id, asset_kind, object_key)
      VALUES (current_setting('probe.wedding_a')::uuid, 'video', 'weddings/a.mp4')$t$),
  -- versions and publications
  ('version zero', '23514',
   $t$INSERT INTO public.invitation_versions (wedding_id, version_number, snapshot, created_by)
      VALUES (current_setting('probe.wedding_a')::uuid, 0, '{}'::jsonb,
              current_setting('probe.owner_a')::uuid)$t$),
  ('snapshot that is not an object', '23514',
   $t$INSERT INTO public.invitation_versions (wedding_id, version_number, snapshot, created_by)
      VALUES (current_setting('probe.wedding_a')::uuid, 777, '[]'::jsonb,
              current_setting('probe.owner_a')::uuid)$t$),
  ('two versions claiming the same number', '23505',
   $t$INSERT INTO public.invitation_versions (wedding_id, version_number, snapshot, created_by)
      VALUES (current_setting('probe.wedding_a')::uuid, 1, '{"x":1}'::jsonb,
              current_setting('probe.owner_a')::uuid)$t$),
  ('publication status outside the vocabulary', '23514',
   $t$INSERT INTO public.publications (wedding_id, version_id, status)
      VALUES (current_setting('probe.wedding_b')::uuid,
              (SELECT id FROM public.invitation_versions WHERE id = current_setting('probe.version_b1')::uuid), 'scheduled')$t$),
  ('active publication that is also revoked', '23514',
   $t$UPDATE public.publications SET revoked_at = now() WHERE status = 'active'$t$),
  ('second active publication for one wedding', '23505',
   $t$INSERT INTO public.publications (wedding_id, version_id, status)
      VALUES (current_setting('probe.wedding_a')::uuid,
              current_setting('probe.version_a1')::uuid, 'active')$t$),
  -- entitlements
  ('entitlement with a blank package code', '23514',
   $t$INSERT INTO public.entitlements (wedding_id, package_code, status, source)
      VALUES (current_setting('probe.wedding_b')::uuid, '  ', 'active', 'service')$t$),
  ('entitlement status outside the vocabulary', '23514',
   $t$INSERT INTO public.entitlements (wedding_id, package_code, status, source)
      VALUES (current_setting('probe.wedding_b')::uuid, 'trial', 'pending', 'service')$t$),
  ('entitlement source that is not a trusted path', '23514',
   $t$INSERT INTO public.entitlements (wedding_id, package_code, status, source)
      VALUES (current_setting('probe.wedding_b')::uuid, 'trial', 'active', 'gateway')$t$),
  ('the same package granted active twice', '23505',
   -- 'print-plus' is the seeded active grant on wedding A. A *different* package
   -- code is deliberately not a violation here: a wedding may hold a base grant and
   -- an add-on at the same time, and the unique index is per (wedding, package).
   -- Probing with a fresh code would have asserted a rule the schema does not have.
   $t$INSERT INTO public.entitlements (wedding_id, package_code, status, source)
      VALUES (current_setting('probe.wedding_a')::uuid, 'print-plus', 'active', 'service')$t$),
  ('entitlement metadata that is not an object', '23514',
   $t$INSERT INTO public.entitlements (wedding_id, package_code, status, source, metadata)
      VALUES (current_setting('probe.wedding_b')::uuid, 'meta', 'active', 'service', '[]'::jsonb)$t$),
  -- roles
  ('a role the product does not have', '23514',
   $t$INSERT INTO public.user_roles (user_id, role)
      VALUES (current_setting('probe.outsider')::uuid, 'planner')$t$),
  -- hashed credentials
  ('credential that is not a 64-hex digest', '23514',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, expiry_policy, created_by_role)
      VALUES ('deadbeef', 'rsvp', current_setting('probe.wedding_a')::uuid, 'no_expiry', 'postgres')$t$),
  ('credential digest in uppercase', '23514',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, expiry_policy, created_by_role)
      VALUES (upper(repeat('ab', 32)), 'rsvp', current_setting('probe.wedding_a')::uuid, 'no_expiry', 'postgres')$t$),
  ('credential kind that does not exist', '23514',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, expiry_policy, created_by_role)
      VALUES (repeat('ef', 32), 'admin', current_setting('probe.wedding_a')::uuid, 'no_expiry', 'postgres')$t$),
  ('rsvp credential with no publication to belong to', '23514',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, household_id, expiry_policy, created_by_role)
      VALUES (repeat('12', 32), 'rsvp', current_setting('probe.wedding_a')::uuid,
              current_setting('probe.household_a')::uuid, 'no_expiry', 'postgres')$t$),
  ('approval credential with no version', '23514',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, approval_request_id, expiry_policy, created_by_role)
      VALUES (repeat('34', 32), 'approval_review', current_setting('probe.wedding_a')::uuid,
              current_setting('probe.request_a')::uuid, 'no_expiry', 'postgres')$t$),
  ('fixed-expiry credential with no expiry', '23514',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, approval_request_id, approval_version_id, expiry_policy, created_by_role)
      VALUES (repeat('56', 32), 'approval_review', current_setting('probe.wedding_a')::uuid,
              current_setting('probe.request_a')::uuid,
              current_setting('probe.version_a1')::uuid, 'fixed', 'postgres')$t$),
  ('credential expiring before it was created', '23514',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, approval_request_id, approval_version_id, expiry_policy, expires_at, created_by_role)
      VALUES (repeat('78', 32), 'approval_review', current_setting('probe.wedding_a')::uuid,
              current_setting('probe.request_a')::uuid,
              current_setting('probe.version_a1')::uuid, 'fixed', now() - interval '1 hour', 'postgres')$t$),
  ('audit event with an empty action', '23514',
   $t$INSERT INTO private.audit_events (subject_type, action) VALUES ('wedding', '  ')$t$),
  ('audit payload that is not an object', '23514',
   $t$INSERT INTO private.audit_events (subject_type, action, payload) VALUES ('wedding', 'x', '[]'::jsonb)$t$),
  ('two drafts for one wedding', '23505',
   $t$INSERT INTO public.invitation_drafts (wedding_id, content)
      VALUES (current_setting('probe.wedding_a')::uuid, '{}'::jsonb)$t$),
  ('two credentials sharing one digest', '23505',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, household_id, expiry_policy, created_by_role)
      VALUES (repeat('ab', 32), 'guest_invitation',
              current_setting('probe.wedding_a')::uuid,
              current_setting('probe.publication_a1')::uuid,
              current_setting('probe.household_a')::uuid, 'no_expiry', 'postgres')$t$);

-- An expected SQLSTATE alone cannot tell a good refusal from an accidental one, because
-- 23514 is what every CHECK *and* every guard RAISE in this schema reports. Without the
-- message, a probe can pass while being refused by an unrelated constraint — which is
-- exactly what happened to six rows of the first version of the Stage 4 block below, where
-- a `section_key` outside the pinned vocabulary was refused as an unknown slot rather than
-- as the position-gap violation its label claimed. So each probe now carries the text of
-- the refusal it expects, and a probe with no row here fails the run rather than letting
-- the loop guess.
--
-- The one row whose expectation is '' is the 'no-error' control, for which there is no
-- refusal to name. Where several probes share a table-level CHECK that Postgres reports
-- by one unnamed constraint (`access_tokens_kind_shape`, `weddings_check`,
-- `publications_check`, `design_templates_check`, `approval_feedback_check`), the
-- constraint name is the finest discrimination the server offers; it is stated here rather
-- than padded out into a claim the server never made.
CREATE TEMP TABLE probe_msgs (label text, msg text) ON COMMIT DROP;
INSERT INTO probe_msgs (label, msg) VALUES
  ('a role the product does not have', 'violates check constraint "user_roles_role_no_vocabulary_lie"'),
  ('active publication that is also revoked', 'violates check constraint "publications_check"'),
  ('additional language outside the set', 'violates check constraint "weddings_check"'),
  ('approval attaching a reviewer it did not review with', 'approving release 2 cannot change the review record it was reviewed under'),
  ('approval credential with no version', 'violates check constraint "access_tokens_kind_shape"'),
  ('approval invalidated without a status that says so', 'violates check constraint "approval_requests_check1"'),
  ('approval marked decided with no decision time', 'violates check constraint "approval_requests_check"'),
  ('approval request with an unnamed reviewer', 'violates check constraint "approval_requests_reviewer_display_name_check"'),
  ('approval restating the review it was based on', 'approving release 2 cannot change the review record it was reviewed under'),
  ('approval status outside the vocabulary', 'violates check constraint "approval_requests_status_check"'),
  ('approved release moved back to reviewed', 'the only steps are'),
  ('approved release''s approval timestamp dropped', 'is part of the frozen unit'),
  ('approved release''s review record rewritten', 'is part of the frozen unit'),
  ('approved release''s review timestamp moved', 'is part of the frozen unit'),
  ('approved release''s reviewer identity attached afterwards', 'is part of the frozen unit'),
  ('asset key that escapes its prefix', 'violates check constraint "wedding_assets_object_key_check"'),
  ('asset key with a traversal segment', 'violates check constraint "wedding_assets_object_key_check"'),
  ('asset kind outside the vocabulary', 'violates check constraint "wedding_assets_asset_kind_check"'),
  ('asset with a negative size', 'violates check constraint "wedding_assets_size_bytes_check"'),
  ('audit event with an empty action', 'violates check constraint "audit_events_action_check"'),
  ('audit payload that is not an object', 'violates check constraint "audit_events_payload_check"'),
  ('blank wedding title', 'violates check constraint "weddings_title_check"'),
  ('comment feedback with no comment', 'violates check constraint "approval_feedback_check1"'),
  ('credential digest in uppercase', 'violates check constraint "access_tokens_kind_shape"'),
  ('credential expiring before it was created', 'violates check constraint "access_tokens_check1"'),
  ('credential kind that does not exist', 'violates check constraint "access_tokens_token_kind_check"'),
  ('credential that is not a 64-hex digest', 'violates check constraint "access_tokens_kind_shape"'),
  ('decision feedback with no decision', 'violates check constraint "approval_feedback_check"'),
  ('deprecated release restored to approved', 'the only steps are'),
  ('draft given a retirement timestamp', 'violates check constraint "deprecated_at_matches_status"'),
  ('draft given a review label', 'violates check constraint "draft_carries_no_review_metadata"'),
  ('draft given an approval timestamp', 'violates check constraint "approved_at_matches_status"'),
  ('draft promoted on a language the release never covered', 'violates check constraint "reviewed_languages_are_supported_ones"'),
  ('draft promoted on a review too short to be a claim', 'violates check constraint "tradition_pack_releases_review_basis_check"'),
  ('draft promoted on an empty reviewed-language list', 'reviewed_languages must be sorted and free of duplicates'),
  ('draft promoted on an unsorted reviewed-language list', 'reviewed_languages must be sorted and free of duplicates'),
  ('draft promoted straight to approved', 'the only steps are'),
  ('draft promoted straight to deprecated', 'the only steps are'),
  ('draft promoted with no basis for the review', 'violates check constraint "review_metadata_is_mandatory"'),
  ('draft promoted without saying when it was reviewed', 'marking a release reviewed has to say when'),
  ('entitlement metadata that is not an object', 'violates check constraint "entitlements_metadata_check"'),
  ('entitlement source that is not a trusted path', 'violates check constraint "entitlements_source_check"'),
  ('entitlement status outside the vocabulary', 'violates check constraint "entitlements_check"'),
  ('entitlement with a blank package code', 'violates check constraint "entitlements_package_code_check"'),
  ('event ending before it starts', 'violates check constraint "wedding_events_check"'),
  ('event with a blank display name', 'violates check constraint "wedding_events_display_name_check"'),
  ('event with no timezone named', 'violates check constraint "wedding_events_timezone_check"'),
  ('feedback carrying a decision it should not have', 'violates check constraint "approval_feedback_check"'),
  ('feedback kind outside the vocabulary', 'violates check constraint "approval_feedback_feedback_kind_check"'),
  ('fixed-expiry credential with no expiry', 'violates check constraint "access_tokens_check"'),
  ('household expecting nobody', 'violates check constraint "guest_households_expected_party_size_check"'),
  ('household with a blank name', 'violates check constraint "guest_households_display_name_check"'),
  ('language outside the first-release set', 'violates check constraint "weddings_primary_language_check"'),
  ('lifecycle state that does not exist', 'violates check constraint "weddings_lifecycle_status_check"'),
  ('machine-assisted release with no disclosure', 'violates check constraint "machine_assistance_disclosure_required"'),
  ('negative guest estimate', 'violates check constraint "weddings_estimated_guest_count_check"'),
  ('pack slug with a hyphen in it', 'violates check constraint "tradition_packs_pack_key_slug"'),
  ('pack whose scope statement is a shrug', 'violates check constraint "tradition_packs_scope_statement_length"'),
  ('person with a blank role key', 'violates check constraint "wedding_people_role_key_check"'),
  ('person with a negative display order', 'violates check constraint "wedding_people_display_order_check"'),
  ('primary language repeated in the additional list', 'violates check constraint "weddings_check"'),
  ('publication status outside the vocabulary', 'violates check constraint "publications_check"'),
  ('release allowing an English fallback it never declared', 'section opening allows an English fallback but this release does not cover en'),
  ('release belonging to no pack', 'violates foreign key constraint "tradition_pack_releases_pack_id_fkey"'),
  ('release carrying an unknown key in a section', 'section opening carries unknown keys: {css}'),
  ('release claiming a language outside the product set', 'violates check constraint "tradition_pack_releases_languages_check"'),
  ('release created already approved', 'a tradition pack release begins life as draft; it cannot be created already approved'),
  ('release created already reviewed', 'a tradition pack release begins life as draft; it cannot be created already reviewed'),
  ('release declaring a heading in a language it does not cover', 'section opening declares a heading in a language this release does not cover'),
  ('release declaring two event lists', 'a release may declare at most one event list; section venue is a second'),
  ('release declaring two people lists', 'a release may declare at most one people list; section couple is a second'),
  ('release declaring wording in a language it does not cover', 'section blessing declares wording in a language this release does not cover'),
  ('release naming a slot this build has nowhere to render', 'section unknown_slot is not one of the section slots this build renders'),
  ('release reading a host field that does not exist', 'section opening reads unknown host field guest_phone_numbers'),
  ('release repeating one section slot twice', 'section_key opening appears twice in one release'),
  ('release whose definition carries a key this build does not understand', 'a release definition carries keys this build does not understand: {caste_rules}'),
  ('release whose definition schema version this build cannot read', 'definition schema version 99 is not understood by this build, so it cannot be validated'),
  ('release whose design guidance carries an unknown key', 'design_guidance carries a key this build does not understand'),
  ('release whose design guidance is out of range', 'design_guidance is out of range: lead_size must be 8 to 72 and motif_reference a short string'),
  ('release whose event vocabulary entry carries an unknown key', 'an event_vocabulary entry carries an unknown key'),
  ('release whose event vocabulary key is not a slug', 'every event_vocabulary entry needs a slug event_key and label strings in languages this release covers'),
  ('release whose heading is a bare string', 'section opening heading must be an object of language keys'),
  ('release whose heading is blank after trimming', 'section opening has a heading that is empty, too long, or not a string'),
  ('release whose language list is unsorted', ' languages must be sorted and free of duplicates'),
  ('release whose language list repeats a language', ' languages must be sorted and free of duplicates'),
  ('release whose list section carries reviewed wording', 'section family is a people_list and cannot carry reviewed wording'),
  ('release whose list section reads a host field', 'section family is a people_list and may not read a host field'),
  ('release whose position is a string, not a number', 'section opening has no numeric position'),
  ('release whose required flag is a string', 'section opening must declare required as a boolean'),
  ('release whose section has no numeric position', 'section opening has no numeric position'),
  ('release whose section names a kind no renderer knows', 'section blessing claims kind temple_hymn that no renderer knows'),
  ('release whose section omits the kind entirely', 'section blessing claims kind (none) that no renderer knows'),
  ('release whose section omits the required flag', 'section opening must declare required as a boolean'),
  ('release whose section order leaves a gap', 'section closing has position 3 outside 1..2'),
  ('release whose sections key is absent rather than empty', 'a release must declare at least one section'),
  ('release whose sections key is not an array', 'a release must declare at least one section'),
  ('release whose text section says nothing', 'section blessing says nothing: no heading, no reviewed wording, no host field'),
  ('release whose wording is blank after trimming', 'section blessing has wording that is empty, over 4000 characters, or not a string'),
  ('release with no release number', 'violates check constraint "tradition_pack_releases_release_number_check"'),
  ('release with no sections at all', 'a release must declare at least one section'),
  ('release with one people list and one event list', ''),
  ('release with two sections in one position', 'position 1 is claimed by two sections'),
  ('release with two sections reading one host field', 'two sections read host field welcome'),
  ('response answers that are not an object', 'violates check constraint "rsvp_responses_answers_check"'),
  ('response attributed to a source that does not exist', 'violates check constraint "rsvp_responses_response_source_check"'),
  ('response that is neither yes nor no', 'violates check constraint "rsvp_responses_attending_check"'),
  ('response with a negative party size', 'violates check constraint "rsvp_responses_party_size_check"'),
  ('retirement restating the review it was approved under', 'retiring release 1 cannot change the review it was approved under'),
  ('review naming a reviewer who does not exist', 'violates foreign key constraint "tradition_pack_releases_reviewed_by_fkey"'),
  ('reviewed release moved back to draft', 'the only steps are'),
  ('reviewed release moved straight to deprecated', 'the only steps are'),
  ('reviewed release''s language list edited after review', 'is frozen, so a change means a new release_number'),
  ('reviewed release''s wording edited after review', 'is frozen, so a change means a new release_number'),
  ('rsvp credential with no publication to belong to', 'violates check constraint "access_tokens_kind_shape"'),
  ('second active publication for one wedding', 'violates unique constraint "one_active_publication_per_wedding"'),
  ('second response for one household and event', 'violates unique constraint "rsvp_responses_wedding_id_household_id_event_id_key"'),
  ('snapshot that is not an object', 'violates check constraint "invitation_versions_snapshot_check"'),
  ('style settings that is not an object', 'violates check constraint "weddings_style_settings_check"'),
  ('template approved with no reviewer', 'violates check constraint "design_templates_check"'),
  ('template layout that is not an object', 'violates check constraint "design_templates_layout_settings_check"'),
  ('template reviewed but not approved', 'violates check constraint "design_templates_check"'),
  ('template revision zero', 'violates check constraint "design_templates_revision_check"'),
  ('template status outside the vocabulary', 'violates check constraint "design_templates_status_check"'),
  ('template supporting an unknown language', 'violates check constraint "design_templates_supported_languages_check"'),
  ('template supporting no language', 'violates check constraint "design_templates_supported_languages_check"'),
  ('template with a blank display name', 'violates check constraint "design_templates_display_name_check"'),
  ('the same package granted active twice', 'violates unique constraint "one_active_entitlement_per_wedding_package"'),
  ('two credentials sharing one digest', 'violates unique constraint "access_tokens_token_hash_key"'),
  ('two drafts for one wedding', 'violates unique constraint "invitation_drafts_wedding_id_key"'),
  ('two packs claiming the same key', 'violates unique constraint "tradition_packs_pack_key_unique"'),
  ('two releases of one pack in the same slot', 'violates unique constraint "tradition_pack_releases_pack_id_release_number_key"'),
  ('two revisions claiming the same slot', 'violates unique constraint "design_templates_template_key_revision_key"'),
  ('two versions claiming the same number', 'violates unique constraint "invitation_versions_wedding_id_version_number_key"'),
  ('venue latitude off the planet', 'violates check constraint "venues_latitude_check"'),
  ('venue map link that is not https', 'violates check constraint "venues_map_url_check"'),
  ('venue with a blank name', 'violates check constraint "venues_name_check"'),
  ('version zero', 'violates check constraint "invitation_versions_version_number_check"'),
  ('wedding owned by an account that does not exist', 'violates foreign key constraint "weddings_owner_user_id_fkey"'),
  ('wedding with no owner', 'violates not-null constraint'),
  ('withdraw a pack whose releases still exist', 'violates foreign key constraint "tradition_pack_releases_pack_id_fkey"'),
  ('withdraw a template a snapshot still points at', 'violates foreign key constraint "weddings_design_template_id_fkey"'),
  ('withdraw the unshipped pack while its candidate is still a release', 'violates foreign key constraint "tradition_pack_releases_pack_id_fkey"');

-- ===========================================================================
-- Assertions.
--
-- Every group ends with an explicit counter increment, and the run reports the
-- total it actually achieved. Empty probe sets would therefore report a suspiciously
-- small number rather than a silent green — a loop over nothing proves nothing.
-- ===========================================================================
DO $STAGE2$
DECLARE
  s             seed%ROWTYPE;
  t             text;
  r             text;
  v             text;
  n             bigint;
  m             bigint;
  i             integer;
  passed        integer := 0;
  canonical     text[];
  legacy_tbls   text[];
  private_tbls  text[];
  scoped        text[];         -- everything keyed by wedding_id
  owner_writable text[];        -- ... that a customer role also holds INSERT on
  forge         text[];         -- one complete row per writable table
  labels        text[];
  stmts         text[];
  expects       text[];
  msgs          text[];
  pre           bigint[];
  post          bigint[];
  fresh         uuid;
  bill_wedding  uuid;
  venue_wedding uuid;
  venue_pin     uuid;
  event_pin     uuid;
  hist_wedding  uuid;
  hist_version  uuid;
  hist_pub      uuid;
  appr_wedding  uuid;
  appr_version  uuid;
  appr_request  uuid;
  appr_feedback uuid;
  payer         uuid;
  probe_owner   uuid;
  probe_project uuid;
  probe_order   uuid;
  probe_statuses text[];
  rel_scratch       uuid;
  rel_reviewed_with_auditor uuid;
  rel_draft_scratch uuid;
  ver_scratch    uuid;
  wedding_c      uuid;
  control_rows   bigint;
  rec            record;
  g15_start      integer;
  g15c_seen      integer;
BEGIN
  SELECT * INTO s FROM seed;

  canonical := ARRAY[
    'weddings','wedding_people','venues','wedding_events','invitation_drafts',
    'invitation_versions','publications','guest_households','household_event_scopes',
    'rsvp_responses','approval_requests','approval_feedback','wedding_assets',
    'entitlements','design_templates','tradition_packs','tradition_pack_releases',
    'profiles','user_roles'];
  legacy_tbls := ARRAY[
    'projects','templates','guests','orders','payments','printers','activity_logs',
    'migration_findings'];
  private_tbls := ARRAY['access_tokens','audit_events'];
  scoped := ARRAY[
    'wedding_people','venues','wedding_events','invitation_drafts','invitation_versions',
    'publications','guest_households','household_event_scopes','rsvp_responses',
    'approval_requests','approval_feedback','wedding_assets','entitlements'];
  owner_writable := ARRAY[
    'wedding_people','venues','wedding_events','guest_households',
    'household_event_scopes','rsvp_responses','wedding_assets'];
  -- `invitation_drafts` is deliberately absent from the two lists below. Stage 3 §3
  -- revoked a browser role's INSERT and DELETE on it, so an outsider's attempt is
  -- refused one layer *earlier* than the ownership check group 5 is about — the grant
  -- layer, with no policy reached. That is a different claim, so it gets its own
  -- probes (group 5b) rather than quietly joining a loop that asserts another one.
  -- One complete, otherwise-legal row per writable table, aimed at wedding A. Only
  -- the ownership check can refuse these: the columns are right, so a 42501 here is
  -- RLS speaking rather than a typo.
  forge := ARRAY[
    $t5$INSERT INTO public.wedding_people (wedding_id, display_name, role_key)
        VALUES (current_setting('probe.wedding_a')::uuid, 'Forged', 'guest')$t5$,
    $t5$INSERT INTO public.venues (wedding_id, name)
        VALUES (current_setting('probe.wedding_a')::uuid, 'Forged Hall')$t5$,
    $t5$INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local)
        VALUES (current_setting('probe.wedding_a')::uuid, 'forged', 'Forged', '2026-11-20 10:00')$t5$,
    $t5$INSERT INTO public.guest_households (wedding_id, display_name)
        VALUES (current_setting('probe.wedding_a')::uuid, 'Forged family')$t5$,
    $t5$INSERT INTO public.household_event_scopes (wedding_id, household_id, event_id)
        VALUES (current_setting('probe.wedding_a')::uuid, current_setting('probe.household_a')::uuid,
                current_setting('probe.event_a1')::uuid)$t5$,
    $t5$INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, response_source)
        VALUES (current_setting('probe.wedding_a')::uuid, current_setting('probe.household_a')::uuid,
                current_setting('probe.event_a2')::uuid, 'attending', 1, 'host_manual')$t5$,
    $t5$INSERT INTO public.wedding_assets (wedding_id, asset_kind, object_key)
        VALUES (current_setting('probe.wedding_a')::uuid, 'photo', 'weddings/forged/x.jpg')$t5$];

  -- Publish the fixture ids for the probe statements, which any role has to be able
  -- to execute. GUCs are session-wide, so SET ROLE does not hide them.
  PERFORM set_config('probe.owner_a',       s.owner_a::text,       false);
  PERFORM set_config('probe.owner_b',       s.owner_b::text,       false);
  PERFORM set_config('probe.outsider',      s.outsider::text,      false);
  PERFORM set_config('probe.wedding_a',     s.wedding_a::text,     false);
  PERFORM set_config('probe.wedding_b',     s.wedding_b::text,     false);
  PERFORM set_config('probe.venue_a',       s.venue_a::text,       false);
  PERFORM set_config('probe.venue_b',       s.venue_b::text,       false);
  PERFORM set_config('probe.event_a1',      s.event_a1::text,      false);
  PERFORM set_config('probe.event_a2',      s.event_a2::text,      false);
  PERFORM set_config('probe.event_a3',      s.event_a3::text,      false);
  PERFORM set_config('probe.event_b1',      s.event_b1::text,      false);
  PERFORM set_config('probe.household_a',   s.household_a::text,   false);
  PERFORM set_config('probe.household_b',   s.household_b::text,   false);
  PERFORM set_config('probe.version_a1',    s.version_a1::text,    false);
  PERFORM set_config('probe.version_b1',    s.version_b1::text,    false);
  PERFORM set_config('probe.publication_a1', s.publication_a1::text, false);
  PERFORM set_config('probe.request_a',     s.request_a::text,     false);
  PERFORM set_config('probe.rsvp_a',        s.rsvp_a::text,        false);
  PERFORM set_config('probe.feedback_a',    s.feedback_a::text,    false);
  PERFORM set_config('probe.asset_a',       s.asset_a::text,       false);
  PERFORM set_config('probe.template',      s.template::text,      false);
  PERFORM set_config('probe.pack',          s.pack::text,          false);
  PERFORM set_config('probe.pack_unshipped', s.pack_unshipped::text, false);
  PERFORM set_config('probe.release_ok',    s.release_ok::text,    false);
  PERFORM set_config('probe.release_dep',   s.release_dep::text,   false);
  PERFORM set_config('probe.release_draft', s.release_draft::text, false);
  PERFORM set_config('probe.release_reviewed', s.release_reviewed::text, false);
  PERFORM set_config('probe.token_a',       s.token_a::text,       false);

  -- Guard against a vacuous run: if the fixture is not there, nothing below means
  -- anything, and "0 rows visible" would look like a passing isolation test.
  n := pg_temp.st2_visible(format(
    'SELECT 1 FROM public.weddings WHERE id IN (current_setting(%L)::uuid, current_setting(%L)::uuid)',
    'probe.wedding_a', 'probe.wedding_b'));
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL: fixture did not create both weddings (found %)', n;
  END IF;
  passed := passed + 1;
  RAISE NOTICE 'PASS: fixture present (2 weddings)';

  -- The release lifecycle is walked by four separate statements, so a seed that stops
  -- halfway would otherwise leave a later "refused" looking like a pass. This checks the
  -- end state of the walk, and that exactly one release is approved — the one thing every
  -- visibility and selection assertion below is measured against.
  SELECT array_agg(status ORDER BY status), count(*)
    INTO probe_statuses, n
    FROM public.tradition_pack_releases;
  IF n <> 4 OR probe_statuses <> ARRAY['approved', 'deprecated', 'draft', 'reviewed']::text[] THEN
    RAISE EXCEPTION 'FAIL: the release fixture is % rows in states %', n, probe_statuses;
  END IF;
  IF (SELECT count(*) FROM public.tradition_pack_releases
       WHERE id = current_setting('probe.release_ok')::uuid
         AND approved_at IS NOT NULL AND deprecated_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'FAIL: release_ok is not the approved-and-current row the battery assumes';
  END IF;
  passed := passed + 2;
  RAISE NOTICE 'PASS: release fixture walked to draft, reviewed, approved and deprecated';

  -- ----------------------------------------------------------------- group 1
  -- anon holds no table privilege anywhere in the canonical schema. This is the
  -- grant layer, deliberately separate from RLS: a missing GRANT is what stops the
  -- data API before it can even ask for rows.
  EXECUTE 'SET ROLE anon';
  FOREACH t IN ARRAY canonical LOOP
    v := pg_temp.st2_err('SELECT count(*) FROM public.' || t);
    IF v NOT LIKE '42501%' THEN
      RAISE EXCEPTION 'FAIL 1: anon read of public.% was not refused: %', t, v;
    END IF;
    passed := passed + 1;
  END LOOP;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'PASS 1: anon refused at the grant layer on all % canonical tables',
    array_length(canonical, 1);

  -- ----------------------------------------------------------------- group 1b
  -- Grants are only half of "test grants AND row visibility". Hand anon a SELECT
  -- privilege on purpose, inside this transaction, and prove row visibility is
  -- still zero because no policy exists for anon. Then take the grant back.
  FOREACH t IN ARRAY ARRAY['weddings','guest_households','profiles','entitlements'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon', t);
    EXECUTE 'SET ROLE anon';
    n := pg_temp.st2_visible('SELECT 1 FROM public.' || t);
    EXECUTE 'RESET ROLE';
    IF n <> 0 THEN
      RAISE EXCEPTION 'FAIL 1b: anon saw % rows of public.% with a bare SELECT grant', n, t;
    END IF;
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', t);
    EXECUTE 'SET ROLE anon';
    v := pg_temp.st2_err('SELECT count(*) FROM public.' || t);
    EXECUTE 'RESET ROLE';
    IF v NOT LIKE '42501%' THEN
      RAISE EXCEPTION 'FAIL 1b: the temporary grant on public.% was not taken back: %', t, v;
    END IF;
    passed := passed + 2;
  END LOOP;
  RAISE NOTICE 'PASS 1b: anon row visibility is zero even with a granted SELECT (4 tables, grant reverted)';

  -- ----------------------------------------------------------------- group 2
  -- The legacy archive is offline evidence, not product truth. No API role may
  -- read it, including service_role: reading the archive is a migration/DB-owner
  -- action, so reaching it takes a deliberate new migration rather than an ad-hoc
  -- grant from a server function.
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    EXECUTE 'SET ROLE ' || r;
    FOREACH t IN ARRAY legacy_tbls LOOP
      v := pg_temp.st2_err('SELECT count(*) FROM legacy.' || t);
      IF v NOT LIKE '42501%' THEN
        RAISE EXCEPTION 'FAIL 2: % could read legacy.%: %', r, t, v;
      END IF;
      v := pg_temp.st2_err(format(
        'INSERT INTO legacy.migration_findings (source_table, source_id, field, action) VALUES (%L, gen_random_uuid(), %L, %L)',
        'forged', 'field', 'written by an API role'));
      IF v NOT LIKE '42501%' THEN
        RAISE EXCEPTION 'FAIL 2: % could write the legacy findings table: %', r, v;
      END IF;
      passed := passed + 2;
    END LOOP;
    EXECUTE 'RESET ROLE';
  END LOOP;
  RAISE NOTICE 'PASS 2: legacy archive unreadable and unwritable for anon, authenticated and service_role (% assertions)',
    array_length(legacy_tbls, 1) * 2 * 3;

  -- ----------------------------------------------------------------- group 3
  -- private/ holds the hashed credentials and the audit trail. A browser role may
  -- not even name a table in it.
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    EXECUTE 'SET ROLE ' || r;
    FOREACH t IN ARRAY private_tbls LOOP
      v := pg_temp.st2_err('SELECT count(*) FROM private.' || t);
      IF v NOT LIKE '42501%' THEN
        RAISE EXCEPTION 'FAIL 3: % could read private.%: %', r, t, v;
      END IF;
      passed := passed + 1;
    END LOOP;
    EXECUTE 'RESET ROLE';
  END LOOP;
  RAISE NOTICE 'PASS 3: private schema unreachable for browser roles (4 assertions)';

  -- ----------------------------------------------------------------- group 4
  -- Owner isolation, both directions, on every wedding-scoped table: an owner sees
  -- its own rows (so the policy is not simply blocking everything) and sees none of
  -- anybody else's.
  IF array_length(scoped, 1) IS NULL THEN
    RAISE EXCEPTION 'FAIL: the scoped table list is empty, so isolation proved nothing';
  END IF;
  FOREACH r IN ARRAY ARRAY['a','b'] LOOP
    PERFORM set_config('test.uid',
      CASE r WHEN 'a' THEN s.owner_a::text ELSE s.owner_b::text END, false);
    EXECUTE 'SET ROLE authenticated';
    FOREACH t IN ARRAY scoped LOOP
      n := pg_temp.st2_visible(format(
        'SELECT 1 FROM public.%I WHERE wedding_id = current_setting(%L)::uuid',
        t, 'probe.wedding_' || r));
      IF n = 0 THEN
        RAISE EXCEPTION 'FAIL 4: owner % sees none of its own rows in public.% — the policy over-blocks',
          upper(r), t;
      END IF;
      m := pg_temp.st2_visible(format(
        'SELECT 1 FROM public.%I WHERE wedding_id = current_setting(%L)::uuid',
        t, 'probe.wedding_' || CASE r WHEN 'a' THEN 'b' ELSE 'a' END));
      IF m <> 0 THEN
        RAISE EXCEPTION 'FAIL 4: owner % sees % rows of public.% belonging to the other wedding',
          upper(r), m, t;
      END IF;
      passed := passed + 2;
    END LOOP;
    EXECUTE 'RESET ROLE';
  END LOOP;
  -- and on the aggregate root itself, keyed by id rather than wedding_id
  FOREACH r IN ARRAY ARRAY['a','b'] LOOP
    PERFORM set_config('test.uid',
      CASE r WHEN 'a' THEN s.owner_a::text ELSE s.owner_b::text END, false);
    EXECUTE 'SET ROLE authenticated';
    n := pg_temp.st2_visible(format(
      'SELECT 1 FROM public.weddings WHERE id = current_setting(%L)::uuid', 'probe.wedding_' || r));
    m := pg_temp.st2_visible(format(
      'SELECT 1 FROM public.weddings WHERE id = current_setting(%L)::uuid',
      'probe.wedding_' || CASE r WHEN 'a' THEN 'b' ELSE 'a' END));
    EXECUTE 'RESET ROLE';
    IF n = 0 OR m <> 0 THEN
      RAISE EXCEPTION 'FAIL 4: wedding visibility wrong for owner % (own=%, other=%)', upper(r), n, m;
    END IF;
    passed := passed + 2;
  END LOOP;
  RAISE NOTICE 'PASS 4: two-way owner isolation on % wedding-scoped tables and on weddings itself (% assertions)',
    array_length(scoped, 1), array_length(scoped, 1) * 4 + 4;

  -- ----------------------------------------------------------------- group 5
  -- An authenticated account with no wedding at all: reads nothing, and a write
  -- attempt changes nothing. DELETE is the uniform probe here because it needs no
  -- per-table column knowledge; a zero row count is the refusal, and the rows are
  -- then re-counted as the maintenance role to prove they really are intact.
  PERFORM set_config('test.uid', s.outsider::text, false);
  EXECUTE 'SET ROLE authenticated';
  FOREACH t IN ARRAY scoped LOOP
    n := pg_temp.st2_visible(format(
      'SELECT 1 FROM public.%I WHERE wedding_id = current_setting(%L)::uuid', t, 'probe.wedding_a'));
    IF n <> 0 THEN
      RAISE EXCEPTION 'FAIL 5: an owner-less account read % rows of public.%', n, t;
    END IF;
    passed := passed + 1;
  END LOOP;
  EXECUTE 'RESET ROLE';

  pre := ARRAY[]::bigint[];
  FOREACH t IN ARRAY owner_writable LOOP
    pre := pre || pg_temp.st2_visible('SELECT 1 FROM public.' || t);
  END LOOP;
  EXECUTE 'SET ROLE authenticated';
  i := 0;
  FOREACH t IN ARRAY owner_writable LOOP
    i := i + 1;
    n := pg_temp.st2_changed(format(
      'DELETE FROM public.%I WHERE wedding_id = current_setting(%L)::uuid', t, 'probe.wedding_a'));
    IF n <> 0 THEN
      RAISE EXCEPTION 'FAIL 5: an owner-less account deleted % rows from public.%', n, t;
    END IF;
    -- and forging a row into somebody else's wedding is refused by WITH CHECK
    v := pg_temp.st2_err(forge[i]);
    IF v NOT LIKE '42501%' THEN
      RAISE EXCEPTION 'FAIL 5: an owner-less account forged a row into public.%: %', t, v;
    END IF;
    passed := passed + 2;
  END LOOP;
  EXECUTE 'RESET ROLE';
  post := ARRAY[]::bigint[];
  FOREACH t IN ARRAY owner_writable LOOP
    post := post || pg_temp.st2_visible('SELECT 1 FROM public.' || t);
  END LOOP;
  IF pre <> post THEN
    RAISE EXCEPTION 'FAIL 5: the owner-less attacks changed the server-side row counts';
  END IF;
  RAISE NOTICE 'PASS 5: owner-less account read 0, deleted 0, forged 0 rows across % writable tables (grant layer + RLS)',
    array_length(owner_writable, 1);

  -- ----------------------------------------------------------------- group 5b
  -- The draft's write surface, after Stage 3 §3 closed it. Run as the wedding's OWN
  -- owner, on purpose: an outsider's refusal is ambiguous (it could be the policy),
  -- while the owner's refusal can only be the grant. The message is asserted as well
  -- as the SQLSTATE because the two 42501s mean different guarantees —
  -- 'permission denied for table' is the privilege layer, 'row-level security' is a
  -- policy — and the claim here is specifically the first one.
  PERFORM set_config('test.uid', s.owner_a::text, false);
  EXECUTE 'SET ROLE authenticated';
  v := pg_temp.st2_err($t5b$INSERT INTO public.invitation_drafts (wedding_id, content)
        VALUES (current_setting('probe.wedding_a')::uuid, '{"forged": true}'::jsonb)$t5b$);
  IF v NOT LIKE '42501%' OR v NOT LIKE '%permission denied for table invitation_drafts%' THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL 5b: the draft owner inserted a second draft, or was refused by something other than the grant layer: %', v;
  END IF;
  passed := passed + 1;

  v := pg_temp.st2_err('DELETE FROM public.invitation_drafts WHERE wedding_id = current_setting(''probe.wedding_a'')::uuid');
  IF v NOT LIKE '42501%' OR v NOT LIKE '%permission denied for table invitation_drafts%' THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL 5b: the draft owner deleted its own draft, or was refused by something other than the grant layer: %', v;
  END IF;
  passed := passed + 1;
  EXECUTE 'RESET ROLE';

  -- ... and the row is still there, so neither refusal was a partial write.
  n := pg_temp.st2_visible('SELECT 1 FROM public.invitation_drafts WHERE wedding_id = current_setting(''probe.wedding_a'')::uuid');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 5b: the refused draft writes left % rows for wedding A', n;
  END IF;
  passed := passed + 1;

  EXECUTE 'SET ROLE anon';
  v := pg_temp.st2_err('DELETE FROM public.invitation_drafts');
  EXECUTE 'RESET ROLE';
  IF v NOT LIKE '42501%' THEN
    RAISE EXCEPTION 'FAIL 5b: anon deleted drafts: %', v;
  END IF;
  passed := passed + 1;

  -- The mechanism, not just the outcome: no INSERT or DELETE policy survives on the
  -- table, so there is no future grant that could silently re-open the hole without a
  -- policy also having to be added back.
  SELECT count(*) INTO n FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace k ON k.oid = c.relnamespace
   WHERE c.relname = 'invitation_drafts' AND k.nspname = 'public'
     AND pol.polcmd IN ('a', 'd');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 5b: % INSERT/DELETE polic% still attached to invitation_drafts',
      n, CASE WHEN n = 1 THEN 'y' ELSE 'ies' END;
  END IF;
  passed := passed + 1;
  RAISE NOTICE 'PASS 5b: the draft is created and destroyed by the schema only — insert, delete and the policy inventory (5 assertions)';

  -- ----------------------------------------------------------------- group 6
  -- WITH CHECK has to bind the *new* row, not just the old one: otherwise an owner
  -- could hand a wedding to somebody else, or stamp a guest answer as if the guest
  -- sent it.
  PERFORM set_config('test.uid', s.owner_a::text, false);
  EXECUTE 'SET ROLE authenticated';
  v := pg_temp.st2_err(
    'UPDATE public.weddings SET owner_user_id = current_setting(''probe.outsider'')::uuid'
    || ' WHERE id = current_setting(''probe.wedding_a'')::uuid');
  IF v NOT LIKE '42501%' THEN
    RAISE EXCEPTION 'FAIL 6: an owner handed its wedding to somebody else: %', v;
  END IF;
  passed := passed + 1;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.uid', s.owner_a::text, false);
  EXECUTE 'SET ROLE authenticated';
  v := pg_temp.st2_err(
    $t6$INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, response_source)
     VALUES (current_setting('probe.wedding_a')::uuid, current_setting('probe.household_a')::uuid,
             current_setting('probe.event_a2')::uuid, 'attending', 2, 'guest')$t6$);
  IF v NOT LIKE '42501%' THEN
    RAISE EXCEPTION 'FAIL 6: an owner recorded a guest-authored RSVP on insert: %', v;
  END IF;
  passed := passed + 1;
  v := pg_temp.st2_err(
    $t6$UPDATE public.rsvp_responses SET response_source = 'guest'
     WHERE id = current_setting('probe.rsvp_a')::uuid$t6$);
  IF v NOT LIKE '42501%' THEN
    RAISE EXCEPTION 'FAIL 6: an owner re-labelled its manual RSVP as guest-authored: %', v;
  END IF;
  passed := passed + 1;
  -- a control, so the policy above is not simply refusing all owner RSVP writes
  n := pg_temp.st2_changed(
    $t6$UPDATE public.rsvp_responses SET party_size = 3
     WHERE id = current_setting('probe.rsvp_a')::uuid$t6$);
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 6: an owner could not correct its own manual RSVP (rows=%)', n;
  END IF;
  passed := passed + 1;

  -- Cross-profile write: RLS hides the other user's row, so the statement "succeeds"
  -- having changed nothing. That is the correct shape, and it is asserted as zero
  -- rows rather than as an error.
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.uid', s.owner_b::text, false);
  EXECUTE 'SET ROLE authenticated';
  n := pg_temp.st2_changed(
    $t6$UPDATE public.profiles SET name = 'Forged name'
     WHERE user_id = current_setting('probe.owner_a')::uuid$t6$);
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 6: user B changed % rows of user A''s profile', n;
  END IF;
  EXECUTE 'RESET ROLE';
  n := pg_temp.st2_visible(
    'SELECT 1 FROM public.profiles WHERE user_id = current_setting(''probe.owner_a'')::uuid'
    || ' AND name = ''Asha''');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 6: owner A''s profile name was altered by the cross-user write';
  END IF;
  passed := passed + 2;

  PERFORM set_config('test.uid', s.owner_a::text, false);
  EXECUTE 'SET ROLE authenticated';
  n := pg_temp.st2_changed(
    $t6$UPDATE public.profiles SET name = 'Asha R'
     WHERE user_id = current_setting('probe.owner_a')::uuid$t6$);
  EXECUTE 'RESET ROLE';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 6: a user could not edit its own profile (rows=%)', n;
  END IF;
  passed := passed + 1;
  RAISE NOTICE 'PASS 6: ownership laundering, guest-attribution and cross-profile writes refused (7 assertions)';

  -- ----------------------------------------------------------------- group 7
  -- Everything a customer must never do, run as a real owner so RLS cannot be
  -- blamed for the refusal: these rows are inside the caller's own wedding.
  SELECT array_agg(label ORDER BY label), array_agg(stmt ORDER BY label)
    INTO labels, stmts
    FROM probes_privileged;
  IF labels IS NULL THEN
    RAISE EXCEPTION 'FAIL: the privileged probe set is empty';
  END IF;
  PERFORM set_config('test.uid', s.owner_a::text, false);
  EXECUTE 'SET ROLE authenticated';
  FOR i IN 1 .. array_length(labels, 1) LOOP
    v := pg_temp.st2_err(stmts[i]);
    IF v NOT LIKE '42501%' THEN
      RAISE EXCEPTION 'FAIL 7: "%" was not refused for an owner: %', labels[i], v;
    END IF;
    passed := passed + 1;
  END LOOP;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'PASS 7: % server-authoritative writes refused for the row''s own owner',
    array_length(labels, 1);

  -- ----------------------------------------------------------------- group 8
  -- The guard triggers are only a real second layer if they still refuse once the
  -- privilege layer has (wrongly) let the caller through. So hand `authenticated`
  -- the grant and a permissive policy, and require the trigger's own message.
  -- Without this, group 7 would be measuring nothing but GRANTs.
  EXECUTE 'GRANT INSERT ON public.entitlements TO authenticated';
  EXECUTE 'CREATE POLICY zz_backstop_insert ON public.entitlements FOR INSERT TO authenticated WITH CHECK (true)';
  EXECUTE 'GRANT UPDATE ON public.invitation_versions TO authenticated';
  EXECUTE 'CREATE POLICY zz_backstop_update ON public.invitation_versions FOR UPDATE TO authenticated USING (true) WITH CHECK (true)';
  EXECUTE 'GRANT DELETE ON public.approval_feedback TO authenticated';
  EXECUTE 'CREATE POLICY zz_backstop_delete ON public.approval_feedback FOR DELETE TO authenticated USING (true)';

  PERFORM set_config('test.uid', s.owner_a::text, false);
  EXECUTE 'SET ROLE authenticated';
  v := pg_temp.st2_err(
    $t8$INSERT INTO public.entitlements (wedding_id, package_code, status, source)
     VALUES (current_setting('probe.wedding_a')::uuid, 'free-forever', 'active', 'service')$t8$);
  IF v NOT LIKE '%server-authoritative%' THEN
    RAISE EXCEPTION 'FAIL 8: with a grant and a policy in place, the entitlement guard did not speak: %', v;
  END IF;
  passed := passed + 1;
  -- targeted at a row that exists, so a vacuous zero-row update cannot pass
  v := pg_temp.st2_err(
    $t8$UPDATE public.invitation_versions SET snapshot = '{"heading": "rewritten"}'::jsonb
     WHERE id = current_setting('probe.version_a1')::uuid$t8$);
  IF v NOT LIKE '%server-authoritative%' THEN
    RAISE EXCEPTION 'FAIL 8: the version-freeze guard did not speak for a row that exists: %', v;
  END IF;
  passed := passed + 1;
  v := pg_temp.st2_err(
    $t8$DELETE FROM public.approval_feedback WHERE id = current_setting('probe.feedback_a')::uuid$t8$);
  IF v NOT LIKE '%append-only%' THEN
    RAISE EXCEPTION 'FAIL 8: the append-only guard did not speak for a row that exists: %', v;
  END IF;
  passed := passed + 1;
  n := pg_temp.st2_visible(
    'SELECT 1 FROM public.invitation_versions WHERE id = current_setting(''probe.version_a1'')::uuid'
    || ' AND snapshot ->> ''heading'' = ''Asha weds Bala''');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 8: the frozen snapshot changed anyway';
  END IF;
  EXECUTE 'RESET ROLE';

  EXECUTE 'DROP POLICY zz_backstop_insert ON public.entitlements';
  EXECUTE 'DROP POLICY zz_backstop_update ON public.invitation_versions';
  EXECUTE 'DROP POLICY zz_backstop_delete ON public.approval_feedback';
  EXECUTE 'REVOKE INSERT ON public.entitlements FROM authenticated';
  EXECUTE 'REVOKE UPDATE ON public.invitation_versions FROM authenticated';
  EXECUTE 'REVOKE DELETE ON public.approval_feedback FROM authenticated';
  IF has_table_privilege('authenticated', 'public.entitlements', 'INSERT')
     OR has_table_privilege('authenticated', 'public.invitation_versions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.approval_feedback', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL 8: the temporary backstop grants were not taken back';
  END IF;
  passed := passed + 2;
  EXECUTE 'SET ROLE authenticated';
  v := pg_temp.st2_err(
    $t8$UPDATE public.invitation_versions SET snapshot = '{}'::jsonb
     WHERE id = current_setting('probe.version_a1')::uuid$t8$);
  EXECUTE 'RESET ROLE';
  IF v NOT LIKE '42501%' OR v NOT LIKE '%permission denied%' THEN
    RAISE EXCEPTION 'FAIL 8: after the revoke, the write is neither blocked nor blocked by the grant layer: %', v;
  END IF;
  passed := passed + 1;
  RAISE NOTICE 'PASS 8: trigger backstop refuses a write that a granted privilege + permissive policy allow (entitlements, versions, feedback)';

  -- -------------------------------------------------------------- group 8b
  -- The same second-layer question for the Stage 4 boundary, which is the one a reader
  -- can most plausibly get wrong in a later migration: §9 forbids a customer creating a
  -- pack, creating a release, moving a lifecycle state or signing a review record, and
  -- the honest proof is not "the GRANT is missing" (group 7 covers that) but "even with
  -- the GRANT and a permissive POLICY, the guard still refuses and still refuses by
  -- naming the role".
  --
  -- The read policy below is not decoration, and it is the part of this group that was
  -- wrong when it was first written. A SELECT policy governs which rows an UPDATE or
  -- DELETE scan can reach, not only which rows a query returns — measured on this schema
  -- with INSERT/UPDATE/DELETE granted and a `FOR UPDATE USING (true) WITH CHECK (true)`
  -- policy: `UPDATE ... SET status = 'approved'` against a *draft* release reported
  -- `UPDATE 0` rather than a refusal, because the approved-only SELECT policy had already
  -- hidden the row from the scan. A probe that "passes" there proves nothing about the
  -- trigger. So the mistake this group imagines a future author making is the complete
  -- one — writes *and* reads open — and visibility is asserted wide before the probes and
  -- narrow again after them, so the refusal below can only have come from the guard.
  EXECUTE 'GRANT INSERT, UPDATE, DELETE ON public.tradition_pack_releases TO authenticated';
  EXECUTE 'CREATE POLICY zz_backstop_release_read ON public.tradition_pack_releases'
       || ' FOR SELECT TO authenticated USING (true)';
  EXECUTE 'CREATE POLICY zz_backstop_release_write ON public.tradition_pack_releases'
       || ' FOR INSERT TO authenticated WITH CHECK (true)';
  EXECUTE 'CREATE POLICY zz_backstop_release_update ON public.tradition_pack_releases'
       || ' FOR UPDATE TO authenticated USING (true) WITH CHECK (true)';
  EXECUTE 'CREATE POLICY zz_backstop_release_delete ON public.tradition_pack_releases'
       || ' FOR DELETE TO authenticated USING (true)';
  EXECUTE 'GRANT UPDATE ON public.tradition_packs TO authenticated';
  EXECUTE 'CREATE POLICY zz_backstop_pack_update ON public.tradition_packs'
       || ' FOR UPDATE TO authenticated USING (true) WITH CHECK (true)';

  PERFORM set_config('test.uid', s.owner_a::text, false);
  EXECUTE 'SET ROLE authenticated';
  -- The opening measurement is of the *mistake*: all four releases are now reachable, so
  -- none of the refusals below can be attributed to a row the caller could not see.
  n := pg_temp.st2_visible('SELECT 1 FROM public.tradition_pack_releases');
  IF n <> 4 THEN
    RAISE EXCEPTION 'FAIL 8b: the backstop opened reads to % releases, not all 4 — the '
                    'probes below would be measuring visibility instead of the guard', n;
  END IF;
  passed := passed + 1;
  -- Which guard speaks is asserted, not merely that something did: a refusal that names
  -- the role is the identity layer, and only a refusal that names the role proves *this*
  -- table is server-authoritative rather than accidentally unwritable.
  v := pg_temp.st2_err(
    $t8b$INSERT INTO public.tradition_pack_releases (pack_id, release_number,
              definition_schema_version, languages, definition, author_label, status)
           VALUES (current_setting('probe.pack')::uuid, 77, 1, ARRAY['en'],
                   pg_temp.st2_def_small(), 'Self minted', 'draft')$t8b$);
  IF v NOT LIKE '42501%' OR v NOT LIKE '%server-authoritative%' THEN
    RAISE EXCEPTION 'FAIL 8b: with a grant and a policy, the release write guard did not speak: %', v;
  END IF;
  passed := passed + 1;
  v := pg_temp.st2_err(
    $t8b$UPDATE public.tradition_pack_releases SET status = 'approved'
          WHERE id = current_setting('probe.release_draft')::uuid$t8b$);
  IF v NOT LIKE '42501%' OR v NOT LIKE '%server-authoritative%' THEN
    RAISE EXCEPTION 'FAIL 8b: a customer promoted a release through a granted UPDATE: %', v;
  END IF;
  passed := passed + 1;
  v := pg_temp.st2_err(
    $t8b$UPDATE public.tradition_pack_releases
            SET review_label = 'Reviewed by me', reviewed_at = now()
          WHERE id = current_setting('probe.release_draft')::uuid$t8b$);
  IF v NOT LIKE '42501%' OR v NOT LIKE '%server-authoritative%' THEN
    RAISE EXCEPTION 'FAIL 8b: a customer forged a review record: %', v;
  END IF;
  passed := passed + 1;
  v := pg_temp.st2_err(
    $t8b$DELETE FROM public.tradition_pack_releases
          WHERE id = current_setting('probe.release_ok')::uuid$t8b$);
  IF v NOT LIKE '42501%' OR v NOT LIKE '%append-only%' THEN
    RAISE EXCEPTION 'FAIL 8b: a customer deleted platform content through a granted DELETE: %', v;
  END IF;
  passed := passed + 1;
  v := pg_temp.st2_err(
    $t8b$UPDATE public.tradition_packs SET display_name = 'Free for everyone'
          WHERE id = current_setting('probe.pack')::uuid$t8b$);
  IF v NOT LIKE '42501%' OR v NOT LIKE '%server-authoritative%' THEN
    RAISE EXCEPTION 'FAIL 8b: a customer retitled the catalogue concept: %', v;
  END IF;
  passed := passed + 1;
  EXECUTE 'RESET ROLE';
  -- Nothing was written by any of the five attempts above, in any state.
  SELECT count(*) INTO n FROM public.tradition_pack_releases;
  IF n <> 4 THEN
    RAISE EXCEPTION 'FAIL 8b: the backstop probes left % releases where 4 were seeded', n;
  END IF;
  passed := passed + 1;

  EXECUTE 'DROP POLICY zz_backstop_release_read ON public.tradition_pack_releases';
  EXECUTE 'DROP POLICY zz_backstop_release_write ON public.tradition_pack_releases';
  EXECUTE 'DROP POLICY zz_backstop_release_update ON public.tradition_pack_releases';
  EXECUTE 'DROP POLICY zz_backstop_release_delete ON public.tradition_pack_releases';
  EXECUTE 'DROP POLICY zz_backstop_pack_update ON public.tradition_packs';
  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.tradition_pack_releases FROM authenticated';
  EXECUTE 'REVOKE UPDATE ON public.tradition_packs FROM authenticated';
  IF has_table_privilege('authenticated', 'public.tradition_pack_releases', 'INSERT')
     OR has_table_privilege('authenticated', 'public.tradition_pack_releases', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.tradition_pack_releases', 'DELETE')
     OR has_table_privilege('authenticated', 'public.tradition_packs', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL 8b: the temporary backstop grants were not taken back';
  END IF;
  -- And the mistake is closed, not merely parked: the read policy that made the probes
  -- honest is gone, so a customer is back to seeing the one approved release. Group 9
  -- then measures the same fact from the other direction.
  EXECUTE 'SET ROLE authenticated';
  n := pg_temp.st2_visible('SELECT 1 FROM public.tradition_pack_releases');
  EXECUTE 'RESET ROLE';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 8b: after dropping the backstop policies a customer still reads '
                    '% releases (1 expected)', n;
  END IF;
  IF (SELECT count(*) FROM pg_policy
       WHERE polrelid = 'public.tradition_pack_releases'::regclass) <> 1 THEN
    RAISE EXCEPTION 'FAIL 8b: a temporary policy survived the cleanup';
  END IF;
  passed := passed + 2;
  RAISE NOTICE 'PASS 8b: with reads *and* writes opened to a customer role, every pack write is still refused by the guard that names the role — and the opening is taken back (9 assertions)';

  -- ----------------------------------------------------------------- group 9
  -- Platform catalogue. Two tables, and since Stage 4 they do NOT share a visibility
  -- rule: a template's `draft` stays readable (a migrated legacy template has never been
  -- reviewed and a picker that hid drafts would go blank), while a *release* draft is
  -- invisible, because unapproved wording about a tradition is the sensitive half of the
  -- product. Computed against the real tables, so the assertions cannot drift away from
  -- the seed.
  EXECUTE 'SET ROLE authenticated';
  n := pg_temp.st2_visible('SELECT 1 FROM public.design_templates');
  EXECUTE 'RESET ROLE';
  m := pg_temp.st2_visible(
    'SELECT 1 FROM public.design_templates WHERE status <> ''deprecated''');
  IF n <> m THEN
    RAISE EXCEPTION 'FAIL 9: an authenticated caller sees % templates, expected the % non-deprecated ones', n, m;
  END IF;
  -- the filter has to be removing something, or this comparison is vacuous
  IF m = (SELECT count(*) FROM public.design_templates) THEN
    RAISE EXCEPTION 'FAIL 9: nothing in the seed is deprecated, so visibility proved nothing';
  END IF;
  passed := passed + 2;
  EXECUTE 'SET ROLE authenticated';
  n := pg_temp.st2_visible('SELECT 1 FROM public.design_templates WHERE status = ''deprecated''');
  EXECUTE 'RESET ROLE';
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 9: a deprecated template is still visible to customers (% rows)', n;
  END IF;
  passed := passed + 1;
  -- The release table is where the wording lives, so this is the half §9 actually cares
  -- about. The fixture guard proved all four lifecycle states exist as rows; one of them
  -- is approved, so "exactly one row visible" is a statement about the policy rather
  -- than about an empty table.
  EXECUTE 'SET ROLE authenticated';
  n := pg_temp.st2_visible('SELECT 1 FROM public.tradition_pack_releases');
  m := pg_temp.st2_visible(
    'SELECT 1 FROM public.tradition_pack_releases WHERE status <> ''approved''');
  EXECUTE 'RESET ROLE';
  IF n <> 1 OR m <> 0 THEN
    RAISE EXCEPTION 'FAIL 9: release visibility is not approved-only (% visible, % of them '
                    'non-approved)', n, m;
  END IF;
  IF (SELECT count(*) FROM public.tradition_pack_releases WHERE status = 'approved') <> 1 THEN
    RAISE EXCEPTION 'FAIL 9: the seed stopped being a controlled fixture (more than one approved release)';
  END IF;
  passed := passed + 2;
  EXECUTE 'SET ROLE authenticated';
  n := pg_temp.st2_visible('SELECT 1 FROM public.tradition_packs');
  EXECUTE 'RESET ROLE';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 9: a customer sees % tradition packs; exactly the 1 pack with an '
                    'approved release may be visible (the fixture guard above proved the '
                    'second pack exists with only unapproved releases)', n;
  END IF;
  passed := passed + 1;
  -- Which one, not merely how many: the unshipped pack's name and scope statement are a
  -- promise about wording nobody has approved, and a count alone would pass if the policy
  -- happened to hide the wrong half of the catalogue.
  EXECUTE 'SET ROLE authenticated';
  n := pg_temp.st2_visible(format(
    'SELECT 1 FROM public.tradition_packs WHERE id = current_setting(%L)::uuid',
    'probe.pack'));
  m := pg_temp.st2_visible(format(
    'SELECT 1 FROM public.tradition_packs WHERE id = current_setting(%L)::uuid',
    'probe.pack_unshipped'));
  EXECUTE 'RESET ROLE';
  IF n <> 1 OR m <> 0 THEN
    RAISE EXCEPTION 'FAIL 9: pack visibility is on the wrong rows (shipped visible=%, unshipped visible=%)', n, m;
  END IF;
  passed := passed + 1;
  RAISE NOTICE 'PASS 9: catalogue visibility matches status (templates: deprecated hidden; releases: approved only; an unshipped pack is invisible)';

  -- ----------------------------------------------------------------- group 10
  -- The customer's own working set has to be writable, or every refusal above is
  -- just a locked door. Full lifecycle on a fresh wedding, as the owner.
  PERFORM set_config('test.uid', s.owner_b::text, false);
  EXECUTE 'SET ROLE authenticated';
  EXECUTE $t10$INSERT INTO public.weddings (owner_user_id, title, primary_language)
             VALUES (current_setting('probe.owner_b')::uuid, 'Divya Reprise', 'en')
             RETURNING id$t10$ INTO fresh;
  IF fresh IS NULL THEN
    RAISE EXCEPTION 'FAIL 10: an owner could not create a wedding';
  END IF;
  PERFORM set_config('probe.fresh', fresh::text, false);
  passed := passed + 1;

  n := pg_temp.st2_changed($t10$INSERT INTO public.wedding_people (wedding_id, display_name, role_key)
      VALUES (current_setting('probe.fresh')::uuid, 'Maran', 'father')$t10$);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 10: owner could not add a person (rows=%)', n; END IF;
  n := pg_temp.st2_changed($t10$INSERT INTO public.venues (wedding_id, name)
      VALUES (current_setting('probe.fresh')::uuid, 'Riverside Hall')$t10$);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 10: owner could not add a venue (rows=%)', n; END IF;
  n := pg_temp.st2_changed($t10$INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local, timezone)
      VALUES (current_setting('probe.fresh')::uuid, 'muhurtham', 'Muhurtham', '2026-12-05 08:00', 'Asia/Kolkata')$t10$);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 10: owner could not add an event (rows=%)', n; END IF;
  n := pg_temp.st2_changed($t10$INSERT INTO public.guest_households (wedding_id, display_name)
      VALUES (current_setting('probe.fresh')::uuid, 'The Nair Family')$t10$);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 10: owner could not add a household (rows=%)', n; END IF;
  n := pg_temp.st2_changed($t10$INSERT INTO public.household_event_scopes (wedding_id, household_id, event_id)
      SELECT current_setting('probe.fresh')::uuid, h.id, e.id
        FROM public.guest_households h, public.wedding_events e
       WHERE h.wedding_id = current_setting('probe.fresh')::uuid
         AND e.wedding_id = current_setting('probe.fresh')::uuid$t10$);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 10: owner could not scope an invitation (rows=%)', n; END IF;
  n := pg_temp.st2_changed($t10$INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, response_source)
      SELECT current_setting('probe.fresh')::uuid, h.id, e.id, 'attending', 2, 'host_manual'
        FROM public.guest_households h, public.wedding_events e
       WHERE h.wedding_id = current_setting('probe.fresh')::uuid
         AND e.wedding_id = current_setting('probe.fresh')::uuid$t10$);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 10: owner could not record an RSVP (rows=%)', n; END IF;
  n := pg_temp.st2_changed($t10$INSERT INTO public.wedding_assets (wedding_id, asset_kind, label, object_key)
      VALUES (current_setting('probe.fresh')::uuid, 'photo', 'Hall', 'weddings/fresh/photo.jpg')$t10$);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 10: owner could not register an asset (rows=%)', n; END IF;
  -- The draft a customer edits is the one that came with the wedding (Stage 3), so this
  -- step writes the content rather than the row. Same strength as before: it proves the
  -- owner holds writable authority over `invitation_drafts` for its own wedding.
  n := pg_temp.st2_changed($t10$UPDATE public.invitation_drafts SET content = '{"heading": "fresh"}'::jsonb
      WHERE wedding_id = current_setting('probe.fresh')::uuid$t10$);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 10: owner could not edit the draft its wedding arrived with (rows=%)', n; END IF;
  n := pg_temp.st2_changed($t10$UPDATE public.weddings SET estimated_guest_count = 80
      WHERE id = current_setting('probe.fresh')::uuid$t10$);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 10: owner could not edit its wedding (rows=%)', n; END IF;
  passed := passed + 9;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'PASS 10: a customer can run its whole working set on a fresh wedding (1 create + 9 writes)';

  -- ----------------------------------------------------------------- group 11
  -- Destructive semantics, one mechanism per case, each on its own wedding — except
  -- (e), which runs against the shared wedding because it measures what a refused
  -- delete leaves behind rather than which key refuses it.
  --
  -- An owner may unmake a wedding that is still only its own working data. A
  -- wedding that has acquired server-authored history may not. The reason that
  -- refusal is a foreign key rather than the append-only trigger is a measured
  -- result, not a style preference: `private.reject_client_delete()` decides by
  -- *role name*, and a cascading foreign key does not delete as the role that
  -- removed the parent. Probed on PostgreSQL 16.15 with a minimal
  -- parent -> child ON DELETE CASCADE pair and a BEFORE DELETE trigger on the
  -- child that records current_user — after `SET ROLE authenticated` and a parent
  -- delete, the trigger saw current_user = the child table's *owner* and the child
  -- row went anyway. Reproduced against this schema in its earlier form, where an
  -- owner's wedding delete silently took a frozen version with it.
  --
  -- So immutability now lives where no role context can step around it, and the
  -- cases below assert the refusal from both sides: as the owner, and as the
  -- maintenance role that the guard would have trusted. Each scratch wedding
  -- carries exactly one kind of history, because Postgres does not promise which
  -- of several blocking foreign keys it names first — with one blocker the
  -- constraint in the message is the constraint under test.
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.owner_b::text, false);
  n := pg_temp.st2_changed(
    'DELETE FROM public.weddings WHERE id = current_setting(''probe.fresh'')::uuid');
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 11: an owner could not delete its own draft wedding (rows=%)', n;
  END IF;
  EXECUTE 'RESET ROLE';
  n := pg_temp.st2_visible('SELECT 1 FROM public.weddings WHERE id = current_setting(''probe.fresh'')::uuid');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 11: the deleted wedding is still there';
  END IF;
  passed := passed + 2;
  RAISE NOTICE 'PASS 11 (working data): an owner may unmake a wedding that is still only its own';

  -- (f) The venue/event pin — the one NO ACTION choice an ordinary owner has to live
  -- with daily. `wedding_events(wedding_id, venue_id)` is NO ACTION rather than
  -- RESTRICT on a measured argument (migration file 2): during the CASCADE from
  -- `weddings`, Postgres removes venue rows while event rows in the same statement
  -- still reference them, so RESTRICT would abort a delete the owner is entitled to
  -- make. An argument of that shape is worth nothing until both halves are executed:
  -- an in-use venue that cannot be pulled out from under its event, and a wedding
  -- that still comes out cleanly with both inside it.
  venue_wedding := gen_random_uuid();
  venue_pin := gen_random_uuid();
  event_pin := gen_random_uuid();
  INSERT INTO public.weddings (id, owner_user_id, title, primary_language)
    VALUES (venue_wedding, s.owner_b, 'Hall Pin', 'en');
  INSERT INTO public.venues (id, wedding_id, name)
    VALUES (venue_pin, venue_wedding, 'Kalyana Mahal');
  INSERT INTO public.wedding_events (id, wedding_id, event_key, display_name, starts_at_local, venue_id)
    VALUES (event_pin, venue_wedding, 'muhurtham', 'Muhurtham', '2026-12-05 07:30', venue_pin);
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.owner_b::text, false);
  v := pg_temp.st2_err(format(
    'DELETE FROM public.venues WHERE id = %L::uuid', venue_pin::text));
  IF v NOT LIKE '23503%' OR v NOT LIKE '%wedding_events%' THEN
    RAISE EXCEPTION 'FAIL 11f: an in-use venue was deleted out from under its event: %', v;
  END IF;
  passed := passed + 1;
  -- The same role, same pin, deleting the wedding. If NO ACTION had been written as
  -- RESTRICT, this is the statement that fails.
  n := pg_temp.st2_changed(format(
    'DELETE FROM public.weddings WHERE id = %L::uuid', venue_wedding::text));
  EXECUTE 'RESET ROLE';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 11f: the venue pin blocked an owner deleting its own wedding (rows=%)', n;
  END IF;
  SELECT count(*) INTO n FROM public.venues WHERE wedding_id = venue_wedding;
  SELECT count(*) INTO m FROM public.wedding_events WHERE wedding_id = venue_wedding;
  IF n <> 0 OR m <> 0 THEN
    RAISE EXCEPTION 'FAIL 11f: the cascade left % venues and % events of the deleted wedding', n, m;
  END IF;
  passed := passed + 2;
  RAISE NOTICE 'PASS 11f: an in-use venue cannot be deleted alone, yet its wedding still can be';

  -- (a) billing history pins the wedding, and only billing history is in the way
  bill_wedding := gen_random_uuid();
  INSERT INTO public.weddings (id, owner_user_id, title, primary_language)
    VALUES (bill_wedding, s.owner_a, 'Billing Pin', 'en');
  INSERT INTO public.entitlements (wedding_id, package_code, status, source)
    VALUES (bill_wedding, 'archive', 'active', 'admin_manual');
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.owner_a::text, false);
  v := pg_temp.st2_err(format(
    'DELETE FROM public.weddings WHERE id = %L::uuid', bill_wedding::text));
  EXECUTE 'RESET ROLE';
  IF v NOT LIKE '23503%' OR v NOT LIKE '%entitlement%' THEN
    RAISE EXCEPTION 'FAIL 11a: an owner deleted a wedding out from under its billing record: %', v;
  END IF;
  SELECT count(*) INTO n FROM public.weddings WHERE id = bill_wedding;
  SELECT count(*) INTO m FROM public.entitlements WHERE wedding_id = bill_wedding;
  IF n <> 1 OR m <> 1 THEN
    RAISE EXCEPTION 'FAIL 11a: the refused delete left % weddings and % entitlements behind', n, m;
  END IF;
  passed := passed + 2;
  RAISE NOTICE 'PASS 11a: billing history pins the wedding (NO ACTION refuses the owner''s delete)';

  -- (b) frozen version history: refused for the owner, and for a trusted role too
  hist_wedding := gen_random_uuid();
  hist_version := gen_random_uuid();
  INSERT INTO public.weddings (id, owner_user_id, title, primary_language)
    VALUES (hist_wedding, s.owner_a, 'History Pin', 'en');
  INSERT INTO public.invitation_versions (id, wedding_id, version_number, snapshot, created_by)
    VALUES (hist_version, hist_wedding, 1, '{"heading": "frozen"}'::jsonb, s.owner_a);
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('test.uid', s.owner_a::text, false);
  v := pg_temp.st2_err(format(
    'DELETE FROM public.weddings WHERE id = %L::uuid', hist_wedding::text));
  EXECUTE 'RESET ROLE';
  IF v NOT LIKE '23503%' OR v NOT LIKE '%invitation_versions%' THEN
    RAISE EXCEPTION 'FAIL 11b: an owner deleted a wedding through its frozen version: %', v;
  END IF;
  passed := passed + 1;

  -- The same statement as the role the guard would have trusted. If immutability
  -- depended on the trigger this is where it leaked; on a foreign key it cannot.
  v := pg_temp.st2_err(format(
    'DELETE FROM public.weddings WHERE id = %L::uuid', hist_wedding::text));
  IF v NOT LIKE '23503%' OR v NOT LIKE '%invitation_versions%' THEN
    RAISE EXCEPTION 'FAIL 11b: the append-only history was only role-protected: %', v;
  END IF;
  SELECT count(*) INTO n FROM public.weddings WHERE id = hist_wedding;
  SELECT count(*) INTO m FROM public.invitation_versions WHERE id = hist_version;
  IF n <> 1 OR m <> 1 THEN
    RAISE EXCEPTION 'FAIL 11b: the refused delete left % weddings and % versions behind', n, m;
  END IF;
  passed := passed + 2;
  RAISE NOTICE 'PASS 11b: a frozen version pins its wedding for every role, trusted ones included';

  -- (c) a published snapshot cannot be withdrawn from under the publication, and
  -- a pinned one cannot be withdrawn from under a review request either — so the
  -- only way out is the order the history actually happened in.
  hist_pub := gen_random_uuid();
  INSERT INTO public.publications (id, wedding_id, version_id, status)
    VALUES (hist_pub, hist_wedding, hist_version, 'active');
  v := pg_temp.st2_err(format(
    'DELETE FROM public.invitation_versions WHERE id = %L::uuid', hist_version::text));
  IF v NOT LIKE '23503%' OR v NOT LIKE '%publication%' THEN
    RAISE EXCEPTION 'FAIL 11c: a published snapshot was withdrawn from under its publication: %', v;
  END IF;
  appr_wedding := gen_random_uuid();
  appr_version := gen_random_uuid();
  appr_request := gen_random_uuid();
  appr_feedback := gen_random_uuid();
  INSERT INTO public.weddings (id, owner_user_id, title, primary_language)
    VALUES (appr_wedding, s.owner_a, 'Approval Pin', 'en');
  INSERT INTO public.invitation_versions (id, wedding_id, version_number, snapshot, created_by)
    VALUES (appr_version, appr_wedding, 1, '{"heading": "for review"}'::jsonb, s.owner_a);
  INSERT INTO public.approval_requests (id, wedding_id, version_id, reviewer_display_name,
                                        reviewer_contact_text, status)
    VALUES (appr_request, appr_wedding, appr_version, 'Chethan', 'chethan@example.test',
            'pending');
  INSERT INTO public.approval_feedback (id, wedding_id, request_id, version_id,
                                        feedback_kind, decision, author_label)
    VALUES (appr_feedback, appr_wedding, appr_request, appr_version, 'decision',
            'approved', 'Chethan');
  v := pg_temp.st2_err(format(
    'DELETE FROM public.approval_requests WHERE id = %L::uuid', appr_request::text));
  IF v NOT LIKE '23503%' OR v NOT LIKE '%approval_feedback%' THEN
    RAISE EXCEPTION 'FAIL 11c: append-only review feedback vanished with its request: %', v;
  END IF;
  SELECT count(*) INTO n FROM public.approval_feedback WHERE id = appr_feedback;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 11c: the refused delete removed the feedback row';
  END IF;
  passed := passed + 2;
  RAISE NOTICE 'PASS 11c: publications pin versions and feedback pins requests, for a trusted role too';

  -- (d) cleanup is possible, in the order the history was written. This is the
  -- counterweight to (b) and (c): a NO ACTION that could only ever refuse would
  -- be a dead end rather than a rule.
  n := pg_temp.st2_changed(format(
    'DELETE FROM public.approval_feedback WHERE id = %L::uuid', appr_feedback::text));
  m := pg_temp.st2_changed(format(
    'DELETE FROM public.approval_requests WHERE id = %L::uuid', appr_request::text));
  IF n <> 1 OR m <> 1 THEN
    RAISE EXCEPTION 'FAIL 11d: the trusted path could not retire review history (rows=%,%)', n, m;
  END IF;
  n := pg_temp.st2_changed(format(
    'DELETE FROM public.publications WHERE id = %L::uuid', hist_pub::text));
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 11d: the trusted path could not retire a publication (rows=%)', n;
  END IF;
  FOREACH v IN ARRAY ARRAY[
      format('DELETE FROM public.invitation_versions WHERE id = %L::uuid', hist_version::text),
      format('DELETE FROM public.invitation_versions WHERE id = %L::uuid', appr_version::text),
      format('DELETE FROM public.entitlements WHERE wedding_id = %L::uuid', bill_wedding::text),
      format('DELETE FROM public.weddings WHERE id = %L::uuid', hist_wedding::text),
      format('DELETE FROM public.weddings WHERE id = %L::uuid', appr_wedding::text),
      format('DELETE FROM public.weddings WHERE id = %L::uuid', bill_wedding::text)]
  LOOP
    n := pg_temp.st2_changed(v);
    IF n <> 1 THEN
      RAISE EXCEPTION 'FAIL 11d: cleanup was refused by something other than the order of history: % -> % rows', v, n;
    END IF;
    passed := passed + 1;
  END LOOP;
  SELECT count(*) INTO n FROM public.weddings
    WHERE id IN (bill_wedding, hist_wedding, appr_wedding);
  SELECT count(*) INTO m FROM public.invitation_versions
    WHERE wedding_id IN (hist_wedding, appr_wedding);
  IF n <> 0 OR m <> 0 THEN
    RAISE EXCEPTION 'FAIL 11d: cleanup left % weddings and % versions behind', n, m;
  END IF;
  passed := passed + 1;
  RAISE NOTICE 'PASS 11d: a trusted role can still retire history, child before parent';

  -- (e) A credential is not collateral. private.access_tokens.wedding_id is NO ACTION,
  -- like every other frozen-history table. What that buys is stated precisely, because
  -- wedding_a carries several pins at once and Postgres does not promise which one it
  -- names first: the delete is refused, and nothing in it is destroyed either way.
  INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id,
                                     household_id, expiry_policy, created_by_role)
    VALUES (repeat('cd', 32), 'guest_invitation', s.wedding_a, s.publication_a1,
            s.household_a, 'no_expiry', 'postgres');

  v := pg_temp.st2_err(format(
    'DELETE FROM public.weddings WHERE id = %L::uuid', s.wedding_a::text));
  IF v NOT LIKE '23503%' THEN
    RAISE EXCEPTION 'FAIL 11e: a wedding carrying credentials was deletable by a trusted role: %', v;
  END IF;
  passed := passed + 1;

  n := pg_temp.st2_changed(
    'DELETE FROM private.access_tokens WHERE token_hash = ' || quote_literal(repeat('cd', 32)));
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 11e: the trusted path could not retire one credential (rows=%)', n;
  END IF;
  v := pg_temp.st2_err(format(
    'DELETE FROM public.weddings WHERE id = %L::uuid', s.wedding_a::text));
  IF v NOT LIKE '23503%' THEN
    RAISE EXCEPTION 'FAIL 11e: retiring one credential unlocked the wedding: %', v;
  END IF;
  SELECT count(*) INTO n FROM private.access_tokens WHERE id = s.token_a;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 11e: the refused delete destroyed the seeded credential';
  END IF;
  passed := passed + 3;

  -- ... and the reason this row could be tightened without changing any outcome: a
  -- token that pins nothing but its own wedding cannot be written. Every mint must name
  -- a publication or a review request, and both of those already pin the wedding, so
  -- the access_tokens key is never the first door a wedding delete meets.
  v := pg_temp.st2_err(format(
    'INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, expiry_policy, created_by_role) '
    || 'VALUES (%L, %L, %L::uuid, %L, %L)',
    repeat('ef', 32), 'guest_invitation', s.wedding_a::text, 'no_expiry', 'postgres'));
  IF v NOT LIKE '23514%' THEN
    RAISE EXCEPTION 'FAIL 11e: a credential pinning nothing but its wedding was accepted: %', v;
  END IF;
  passed := passed + 1;
  RAISE NOTICE 'PASS 11e: credentials outlive a refused wedding delete, and are retired only on purpose';

  -- ----------------------------------------------------------------- group 12
  -- Relational integrity: a reference that crosses a wedding boundary must be
  -- unrepresentable, not merely discouraged. Run as the maintenance role so the
  -- refusal can only come from the constraint.
  SELECT array_agg(label ORDER BY label), array_agg(stmt ORDER BY label)
    INTO labels, stmts
    FROM probes_cross_wedding;
  IF labels IS NULL THEN
    RAISE EXCEPTION 'FAIL: the cross-wedding probe set is empty';
  END IF;
  FOR i IN 1 .. array_length(labels, 1) LOOP
    v := pg_temp.st2_err(stmts[i]);
    IF v NOT LIKE '23503%' THEN
      RAISE EXCEPTION 'FAIL 12: cross-wedding "%" was not refused by a foreign key: %', labels[i], v;
    END IF;
    passed := passed + 1;
  END LOOP;
  RAISE NOTICE 'PASS 12: % cross-wedding references rejected by composite foreign keys',
    array_length(labels, 1);

  -- ----------------------------------------------------------------- group 13
  -- Invalid states, each against the constraint that owns it. Both halves of the refusal
  -- are stored per row — the SQLSTATE *and* the text the server produced — because a
  -- bare SQLSTATE is satisfied by any constraint that happens to fire, and several of
  -- these probes share a table with a dozen of them.
  -- The aliases are `ps`/`pm` rather than the shorter `s`/`m`: `s` is this block's own
  -- seed record, and PL/pgSQL resolves an unqualified `s.label` to the variable first.
  SELECT array_agg(ps.label ORDER BY ps.label), array_agg(ps.expect ORDER BY ps.label),
         array_agg(ps.stmt ORDER BY ps.label),
         array_agg(coalesce(pm.msg, '<none>') ORDER BY ps.label)
    INTO labels, expects, stmts, msgs
    FROM probes_state ps LEFT JOIN probe_msgs pm ON pm.label = ps.label;
  IF labels IS NULL THEN
    RAISE EXCEPTION 'FAIL: the invalid-state probe set is empty';
  END IF;
  -- A message row whose label has drifted away from the probe it belongs to would simply
  -- stop being read, which is the quietest way for an assertion to disappear.
  SELECT count(*) INTO n FROM probe_msgs pm
    LEFT JOIN probes_state ps ON ps.label = pm.label WHERE ps.label IS NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 13: % expected-message rows name no probe', n;
  END IF;
  passed := passed + 1;
  FOR i IN 1 .. array_length(labels, 1) LOOP
    v := pg_temp.st2_err(stmts[i]);
    IF msgs[i] = '<none>' THEN
      RAISE EXCEPTION 'FAIL 13: probe "%" has no expected message recorded, so it could '
                      'pass by being refused for an unrelated reason', labels[i];
    END IF;
    IF v NOT LIKE (expects[i] || '%') THEN
      RAISE EXCEPTION 'FAIL 13: "%" expected SQLSTATE %, got %', labels[i], expects[i], v;
    END IF;
    IF msgs[i] <> '' AND v NOT LIKE '%' || msgs[i] || '%' THEN
      RAISE EXCEPTION 'FAIL 13: "%" expected the refusal "%", got %', labels[i], msgs[i], v;
    END IF;
    passed := passed + 1;
  END LOOP;
  RAISE NOTICE 'PASS 13: % invalid states refused by the constraint that governs them, '
               'each matched on its own message',
    array_length(labels, 1);

  -- ----------------------------------------------------------------- group 14
  -- The archived money. `legacy.payments.user_id` shipped as ON DELETE CASCADE, so
  -- deleting an account destroyed the record that it had ever paid. File 8 makes
  -- that NO ACTION.
  --
  -- Everything here is built from scratch rather than reused from the fixture, for
  -- two reasons. The clean chain has no fixture at all, so a probe that needs one is
  -- not portable; and a fixture account also owns projects and activity_logs rows
  -- whose keys would refuse first — Postgres names one blocker and does not promise
  -- which, so the assertion "the payment key is the one that holds" needs a payer with
  -- exactly one pin. Hence the archived project belongs to a *different* account from
  -- the payer, which is also how a real order looks when a relative pays for it.
  probe_owner   := gen_random_uuid();
  payer         := gen_random_uuid();
  probe_project := gen_random_uuid();
  probe_order   := gen_random_uuid();
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (probe_owner, 'archived-owner+stage2@example.test', '{"name": "Owner"}'::jsonb),
    (payer,       'archived-payer+stage2@example.test', '{"name": "Payer"}'::jsonb);
  INSERT INTO legacy.projects (id, user_id, title)
    VALUES (probe_project, probe_owner, 'Stage 2 probe project');
  INSERT INTO legacy.orders (id, project_id, type)
    VALUES (probe_order, probe_project, 'print');
  INSERT INTO legacy.payments (order_id, user_id, provider, provider_id, amount_paise, status)
    VALUES (probe_order, payer, 'razorpay', 'stage2_probe_payer', 100, 'created');

  v := pg_temp.st2_err(format(
    'DELETE FROM auth.users WHERE id = %L::uuid', payer::text));
  IF v NOT LIKE '23503%' OR v NOT LIKE '%payments_user_id_fkey%' THEN
    RAISE EXCEPTION 'FAIL 14: an account with archived payments was deletable, or refused for '
                    'some other reason: %', v;
  END IF;
  SELECT count(*) INTO n FROM legacy.payments WHERE provider_id = 'stage2_probe_payer';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 14: the refused account delete took the archived payment with it';
  END IF;
  passed := passed + 2;

  -- Not a dead end: retire the money row first and the account goes with it.
  DELETE FROM legacy.payments WHERE provider_id = 'stage2_probe_payer';
  DELETE FROM auth.users WHERE id = payer;
  SELECT count(*) INTO n FROM auth.users WHERE id = payer;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 14: the scratch account outlived its archived payment';
  END IF;
  passed := passed + 1;

  -- This file commits (psql's --single-transaction commits when it succeeds), so the
  -- probe has to remove its own scaffolding or the migration suites that follow would
  -- be counting someone else's rows.
  DELETE FROM legacy.orders WHERE id = probe_order;
  DELETE FROM legacy.projects WHERE id = probe_project;
  DELETE FROM auth.users WHERE id = probe_owner;
  SELECT count(*) INTO n FROM legacy.projects WHERE id = probe_project;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 14: the probe left an archived project behind'; END IF;
  SELECT count(*) INTO n FROM auth.users WHERE email LIKE '%+stage2@example.test';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 14: the probe left its accounts behind'; END IF;
  passed := passed + 2;
  RAISE NOTICE 'PASS 14: archived payment rows pin their account; the pin is ordered, not permanent, and the probe cleaned up after itself';

  -- ----------------------------------------------------------------- group 15
  -- Stage 4's own attack surface: selecting a pack release, and what may happen to a
  -- release once it has been approved. Directive §20 lists these cases, and each refusal
  -- below is paired with a control that has to succeed — a table that refuses everything
  -- would satisfy the refusals and still be a broken product.
  --
  -- Two roles carry the weight here, and they measure different things. The customer path
  -- is the hole Stage 2 actually had: catalogue visibility lived in a *read* policy, so an
  -- ordinary owner JWT could point a wedding at a draft. The trusted path is the only one
  -- that can answer "was that refused because the row is invisible, or because the status
  -- is wrong?" — a superuser bypasses row security, so what it reads is the real status.
  g15_start := passed;

  -- (a) A host may not select an unapproved release, and the refusal reaches it as an
  -- ordinary update on its own wedding.
  PERFORM set_config('test.uid', s.owner_a::text, false);
  EXECUTE 'SET ROLE authenticated';
  FOREACH r IN ARRAY ARRAY['probe.release_draft', 'probe.release_reviewed',
                           'probe.release_dep'] LOOP
    v := pg_temp.st2_err(format(
      'UPDATE public.weddings SET tradition_pack_release_id = current_setting(%L)::uuid'
      '  WHERE id = current_setting(%L)::uuid', r, 'probe.wedding_a'));
    IF v NOT LIKE '42501%'
       OR v NOT LIKE '%only select an approved tradition pack release%' THEN
      RAISE EXCEPTION 'FAIL 15a: % became selectable through an owner JWT: %', r, v;
    END IF;
    passed := passed + 1;
  END LOOP;
  -- and the refusal wrote nothing: the wedding still pins the release it was seeded with.
  SELECT count(*) INTO n FROM public.weddings
    WHERE id = s.wedding_a AND tradition_pack_release_id = s.release_ok;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 15a: the refused selections moved wedding_a off its approved release';
  END IF;
  passed := passed + 1;

  -- (b) The two legal choices, measured as writes rather than asserted as comments: "no
  -- tradition pack, I'll write my own" and "this approved one" both have to go through,
  -- or §10's selection UX is a picture of a door that is not there.
  n := pg_temp.st2_changed(format(
    'UPDATE public.weddings SET tradition_pack_release_id = NULL'
    '  WHERE id = current_setting(%L)::uuid', 'probe.wedding_a'));
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 15b: a host could not choose to use no tradition pack (rows=%)', n;
  END IF;
  n := pg_temp.st2_changed(format(
    'UPDATE public.weddings SET tradition_pack_release_id = current_setting(%L)::uuid'
    '  WHERE id = current_setting(%L)::uuid', 'probe.release_ok', 'probe.wedding_a'));
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 15b: an approved release was not selectable by a host (rows=%)', n;
  END IF;
  passed := passed + 2;
  -- Born selection: the rule has to hold on INSERT too, because a wedding can be created
  -- with its pack already chosen.
  v := pg_temp.st2_err(format(
    'INSERT INTO public.weddings (owner_user_id, title, primary_language,'
    '                             tradition_pack_release_id) VALUES ('
    '  current_setting(%L)::uuid, %L, %L, current_setting(%L)::uuid)',
    'probe.owner_a', 'Stage 4 probe (born unapproved)', 'en', 'probe.release_draft'));
  IF v NOT LIKE '42501%'
     OR v NOT LIKE '%only select an approved tradition pack release%' THEN
    RAISE EXCEPTION 'FAIL 15b: a wedding was created pointing at a draft release: %', v;
  END IF;
  passed := passed + 1;
  EXECUTE 'RESET ROLE';

  -- (c) The same three refusals as the maintenance role, which bypasses row security and
  -- so reads the real status. This is the half that proves the gate is about the
  -- lifecycle rather than about visibility: each refusal has to name its own state.
  g15c_seen := 0;
  FOR rec IN SELECT id, status FROM public.tradition_pack_releases
              WHERE status <> 'approved' ORDER BY status LOOP
    v := pg_temp.st2_err(format(
      'UPDATE public.weddings SET tradition_pack_release_id = %L::uuid'
      '  WHERE id = %L::uuid', rec.id::text, s.wedding_a::text));
    IF v NOT LIKE '42501%' OR v NOT LIKE '%this one is ' || rec.status || '%' THEN
      RAISE EXCEPTION 'FAIL 15c: a % release was selectable, or refused for the wrong '
                      'reason: %', rec.status, v;
    END IF;
    g15c_seen := g15c_seen + 1;
    passed := passed + 1;
  END LOOP;
  -- The loop walks the whole table rather than a hand-listed set, so its coverage is the
  -- claim: every release that is not approved, wherever it came from. Three of the rows it
  -- now sees are the fixture's draft / reviewed / deprecated releases; the fourth is the
  -- draft that group 13's per-kind control released (number 71) had to become in order to
  -- be inserted at all. Reaching it is not an accident to be worked around — a selection
  -- gate that only held for the fixture would be no gate.
  IF g15c_seen < 3 OR g15c_seen <> (SELECT count(*) FROM public.tradition_pack_releases
                                     WHERE status <> 'approved') THEN
    RAISE EXCEPTION 'FAIL 15c: the loop above ran over % releases where the table holds % '
                    'unapproved ones, and never fewer than the 3 the fixture seeds',
      g15c_seen, (SELECT count(*) FROM public.tradition_pack_releases
                   WHERE status <> 'approved');
  END IF;
  passed := passed + 1;
  SELECT count(*) INTO n FROM public.weddings
    WHERE id = s.wedding_a AND tradition_pack_release_id = s.release_ok;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 15c: wedding_a no longer pins its approved release';
  END IF;
  passed := passed + 1;

  -- (d) A frozen invitation may only record the release its wedding actually selects.
  -- On a scratch wedding with no history, so the only thing that can refuse is the gate.
  wedding_c := gen_random_uuid();
  INSERT INTO public.weddings (id, owner_user_id, title, primary_language)
    VALUES (wedding_c, s.owner_a, 'Stage 4 selection probe', 'en');
  -- control: a version of a wedding with no pack records no pack.
  v := pg_temp.st2_err(format(
    'INSERT INTO public.invitation_versions (wedding_id, version_number, snapshot, created_by)'
    '  VALUES (%L::uuid, 1, %L::jsonb, %L::uuid)',
    wedding_c::text, '{"heading": "written by hand"}', s.owner_a::text));
  IF v <> 'no-error' THEN
    RAISE EXCEPTION 'FAIL 15d: a pack-less wedding could not freeze a version: %', v;
  END IF;
  passed := passed + 1;
  v := pg_temp.st2_err(format(
    'UPDATE public.weddings SET tradition_pack_release_id = %L::uuid WHERE id = %L::uuid',
    s.release_ok::text, wedding_c::text));
  IF v <> 'no-error' THEN
    RAISE EXCEPTION 'FAIL 15d: the scratch wedding could not select the approved release: %', v;
  END IF;
  -- control: the matching release is recordable.
  v := pg_temp.st2_err(format(
    'INSERT INTO public.invitation_versions (wedding_id, version_number, snapshot, created_by,'
    '                                       tradition_pack_release_id)'
    '  VALUES (%L::uuid, 2, %L::jsonb, %L::uuid, %L::uuid)',
    wedding_c::text, '{"heading": "with the pack"}', s.owner_a::text, s.release_ok::text));
  IF v <> 'no-error' THEN
    RAISE EXCEPTION 'FAIL 15d: a version could not record the release its wedding selects: %', v;
  END IF;
  passed := passed + 1;
  -- and two versions cannot claim one wedding's number, so the mismatch probes below need
  -- their own slots rather than a rejected duplicate key.
  FOREACH r IN ARRAY ARRAY['probe.release_dep', 'probe.release_draft',
                           'probe.release_reviewed'] LOOP
    v := pg_temp.st2_err(format(
      'INSERT INTO public.invitation_versions (wedding_id, version_number, snapshot, created_by,'
      '                                       tradition_pack_release_id)'
      '  VALUES (%L::uuid, 3, %L::jsonb, %L::uuid, current_setting(%L)::uuid)',
      wedding_c::text, '{"heading": "mismatch"}', s.owner_a::text, r));
    IF v NOT LIKE '23514%' OR v NOT LIKE '%only record the release its wedding currently selects%' THEN
      RAISE EXCEPTION 'FAIL 15d: a version credited % without its wedding selecting it: %', r, v;
    END IF;
    passed := passed + 1;
  END LOOP;
  SELECT count(*) INTO n FROM public.invitation_versions WHERE wedding_id = wedding_c;
  IF n <> 2 THEN
    RAISE EXCEPTION 'FAIL 15d: the refused freezes left % versions on the scratch wedding (2 controls)', n;
  END IF;
  passed := passed + 1;

  -- (e) An approved release is evidence, not a draft. Content is frozen, the lifecycle
  -- cannot run backwards, and the row cannot be removed — with a never-approved release
  -- beside it proving each of those refusals is about approval rather than about the
  -- table being unwritable.
  rel_scratch := gen_random_uuid();
  INSERT INTO public.tradition_pack_releases
    (id, pack_id, release_number, definition_schema_version, languages, definition,
     author_label, machine_assisted, machine_assistance_notes)
    VALUES (rel_scratch, s.pack_unshipped, 900, 1, ARRAY['en', 'ta'],
            pg_temp.st2_def_small(), 'TEST ONLY — scratch release for the freeze probes',
            true,
            'TEST ONLY — drafted by a model from the fixture above. Nobody has reviewed '
            || 'it, which is what makes it a draft.');
  v := pg_temp.st2_err(format(
    'UPDATE public.tradition_pack_releases SET definition = %L::jsonb WHERE id = %L::uuid',
    pg_temp.st2_def_small(), s.release_ok::text));
  IF v NOT LIKE '23514%' OR v NOT LIKE '%content is frozen%' THEN
    RAISE EXCEPTION 'FAIL 15e: an approved release''s wording was edited in place: %', v;
  END IF;
  passed := passed + 1;
  -- the whole content record, not just the big column: a changelog that can be rewritten
  -- after approval is a provenance claim nobody verified.
  v := pg_temp.st2_err(format(
    'UPDATE public.tradition_pack_releases SET changelog = %L WHERE id = %L::uuid',
    'rewritten after approval', s.release_ok::text));
  IF v NOT LIKE '23514%' OR v NOT LIKE '%content is frozen%' THEN
    RAISE EXCEPTION 'FAIL 15e: an approved release''s changelog was rewritten: %', v;
  END IF;
  passed := passed + 1;
  -- control: the same edits on a draft, which is what they are for.
  v := pg_temp.st2_err(format(
    'UPDATE public.tradition_pack_releases SET definition = %L::jsonb,'
    '       changelog = %L WHERE id = %L::uuid',
    pg_temp.st2_def_small(), 'still a draft, still editable', rel_scratch::text));
  IF v <> 'no-error' THEN
    RAISE EXCEPTION 'FAIL 15e: a draft release could not be edited: %', v;
  END IF;
  SELECT count(*) INTO n FROM public.tradition_pack_releases
    WHERE id = rel_scratch AND changelog = 'still a draft, still editable';
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 15e: the draft edit reported success but did not land';
  END IF;
  passed := passed + 2;
  -- lifecycle: approved cannot step back to draft; the legal step forward is deprecation.
  v := pg_temp.st2_err(format(
    'UPDATE public.tradition_pack_releases SET status = %L WHERE id = %L::uuid',
    'draft', s.release_ok::text));
  IF v NOT LIKE '23514%' OR v NOT LIKE '%cannot move from approved to draft%' THEN
    RAISE EXCEPTION 'FAIL 15e: an approved release went back to draft: %', v;
  END IF;
  passed := passed + 1;
  -- control for the same shape: the scratch release takes the one legal step open to it —
  -- and *only* with a complete review record. The step below with a timestamp and nothing
  -- else is the lie §18 exists to prevent, and the table refuses it by name.
  v := pg_temp.st2_err(format(
    'UPDATE public.tradition_pack_releases SET status = %L, reviewed_at = now()'
    '  WHERE id = %L::uuid', 'reviewed', rel_scratch::text));
  IF v NOT LIKE '23514%' OR v NOT LIKE '%review_metadata_is_mandatory%' THEN
    RAISE EXCEPTION 'FAIL 15e: a release was marked reviewed with no review record behind '
                    'it, or refused by something other than the metadata constraint: %', v;
  END IF;
  passed := passed + 1;
  v := pg_temp.st2_err(format(
    'UPDATE public.tradition_pack_releases SET status = %L, reviewed_at = now(),'
    '       review_label = %L, review_basis = %L, review_scope = %L,'
    '       reviewed_languages = ARRAY[%L, %L]'
    '  WHERE id = %L::uuid',
    'reviewed', 'TEST ONLY — REVIEWED FIXTURE',
    'TEST ONLY — a synthetic record written by the Stage 2 battery. No human reader of '
    || 'Tamil reviewed these strings.',
    'TEST ONLY — structure and language coverage only, no religious or cultural claim.',
    'en', 'ta', rel_scratch::text));
  IF v <> 'no-error' THEN
    RAISE EXCEPTION 'FAIL 15e: the legal draft→reviewed step was refused for the scratch '
                    'release: %', v;
  END IF;
  passed := passed + 1;
  -- deletion: once a row *is* a review unit it cannot be erased, and reviewer ruling A2
  -- says why — a reviewed release that can be deleted is a review that never happened.
  v := pg_temp.st2_err(format(
    'DELETE FROM public.tradition_pack_releases WHERE id = %L::uuid', rel_scratch::text));
  IF v NOT LIKE '23001%' OR v NOT LIKE '%may not be deleted%' THEN
    RAISE EXCEPTION 'FAIL 15e: a reviewed release was deleted: %', v;
  END IF;
  SELECT count(*) INTO n FROM public.tradition_pack_releases WHERE id = rel_scratch;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 15e: the refused delete still removed the reviewed scratch release';
  END IF;
  passed := passed + 2;
  -- deletion: an approved-once release is retired, never removed.
  v := pg_temp.st2_err(format(
    'DELETE FROM public.tradition_pack_releases WHERE id = %L::uuid', s.release_dep::text));
  IF v NOT LIKE '23001%' OR v NOT LIKE '%may not be deleted%' THEN
    RAISE EXCEPTION 'FAIL 15e: a release that had been approved was deleted: %', v;
  END IF;
  SELECT count(*) INTO n FROM public.tradition_pack_releases WHERE id = s.release_dep;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 15e: the refused delete still removed the deprecated release';
  END IF;
  passed := passed + 2;
  -- control: the guard above is about the review unit, not about the table being sealed —
  -- a row that has never been reviewed or approved leaves freely.
  rel_draft_scratch := gen_random_uuid();
  INSERT INTO public.tradition_pack_releases
    (id, pack_id, release_number, definition_schema_version, languages, definition,
     author_label, machine_assisted, machine_assistance_notes)
    VALUES (rel_draft_scratch, s.pack_unshipped, 901, 1, ARRAY['en', 'ta'],
            pg_temp.st2_def_small(), 'TEST ONLY — scratch draft for the delete control',
            true,
            'TEST ONLY — drafted by a model, never reviewed, deleted by this probe.');
  v := pg_temp.st2_err(format(
    'DELETE FROM public.tradition_pack_releases WHERE id = %L::uuid',
    rel_draft_scratch::text));
  IF v <> 'no-error' THEN
    RAISE EXCEPTION 'FAIL 15e: a never-reviewed draft release could not be removed: %', v;
  END IF;
  SELECT count(*) INTO n FROM public.tradition_pack_releases
    WHERE id = rel_draft_scratch;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 15e: the draft scratch row outlived its delete';
  END IF;
  passed := passed + 2;

  -- (f) Nothing above disturbed a frozen invitation, which is the property the whole
  -- lifecycle exists to protect: §11's promise is that a guest's document does not move
  -- when the catalogue does.
  SELECT count(*) INTO n FROM public.invitation_versions
    WHERE id = s.version_a1 AND tradition_pack_release_id = s.release_ok
      AND snapshot = '{"heading": "Asha weds Bala"}'::jsonb;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 15f: version_a1''s frozen bytes or its pinned release changed '
                    'while the catalogue was being probed';
  END IF;
  passed := passed + 1;

  -- (g) Cross-account, §19's last bullet: selecting a platform release is not a relation
  -- with anyone else's wedding. owner_b may choose the very same release owner_a chose —
  -- it is catalogue content — and that choice must buy it nothing in wedding A.
  PERFORM set_config('test.uid', s.owner_b::text, false);
  EXECUTE 'SET ROLE authenticated';
  n := pg_temp.st2_changed(format(
    'UPDATE public.weddings SET tradition_pack_release_id = current_setting(%L)::uuid'
    '  WHERE id = current_setting(%L)::uuid', 'probe.release_ok', 'probe.wedding_b'));
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 15g: a second host could not select the approved release (rows=%)', n;
  END IF;
  passed := passed + 1;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO control_rows FROM public.weddings
    WHERE id = s.wedding_b AND tradition_pack_release_id = s.release_ok;
  IF control_rows <> 1 THEN
    RAISE EXCEPTION 'FAIL 15g: wedding_b did not keep the selection its owner made';
  END IF;
  passed := passed + 1;
  EXECUTE 'SET ROLE authenticated';
  n := pg_temp.st2_visible(
    'SELECT 1 FROM public.invitation_versions'
    '  WHERE wedding_id = current_setting(''probe.wedding_a'')::uuid');
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL 15g: after selecting the same release, host B reads % of host A''s '
                    'frozen invitations', n;
  END IF;
  passed := passed + 1;

  -- Cleanup, child before parent: the scratch wedding's two control versions, then the
  -- wedding itself. The scratch *release* is left in place on purpose — it was walked to
  -- `reviewed` by the probe above, and a reviewed release is undeletable by the same rule
  -- the probe just measured. Nothing here needs it gone: run.sh drops this database.
  EXECUTE 'RESET ROLE';
  DELETE FROM public.invitation_versions WHERE wedding_id = wedding_c;
  DELETE FROM public.weddings WHERE id = wedding_c;
  SELECT count(*) INTO n FROM public.weddings WHERE id = wedding_c;
  SELECT count(*) INTO m FROM public.invitation_versions WHERE wedding_id = wedding_c;
  IF n <> 0 OR m <> 0 THEN
    RAISE EXCEPTION 'FAIL 15: the probe left % weddings and % versions behind', n, m;
  END IF;
  passed := passed + 1;
  SELECT count(*) INTO n FROM public.tradition_pack_releases;
  IF n <> 6 THEN
    RAISE EXCEPTION 'FAIL 15: the pack probes left % releases where the fixture seeded 4 '
                    '(one approved, one deprecated, one draft, one reviewed), group 13''s '
                    'per-kind control added a 5th draft that had to be insertable to prove '
                    'the rule it tests is per kind, and the reviewed scratch release is the '
                    '6th — undeletable on purpose, which is what group 15e just measured', n;
  END IF;
  passed := passed + 1;
  RAISE NOTICE 'PASS 15: a release may be selected only when approved, only its owning '
               'wedding may record it, an approved one is frozen and undeletable, and none '
               'of it reaches across accounts (assertions since group 15: %)',
    passed - g15_start;

  -- ---------------------------------------------------------------- group 16
  -- The successful half of the review-metadata rules, kept out of group 13 because a loop
  -- that asserts refusal cannot host a write that is meant to land. Directive §20's "every
  -- refusal gets a valid control" is unsatisfied by a comment saying the shape is legal:
  -- an optional column that no row ever carries, and a promotion no row ever survives, are
  -- both indistinguishable from a broken schema until something writes them.
  --
  -- Group 13 proves `reviewed_by` refuses an invented account (23503). This is the other
  -- side: a real one is accepted, on the step where a reviewer may honestly be named.
  rel_reviewed_with_auditor := gen_random_uuid();
  INSERT INTO public.tradition_pack_releases
    (id, pack_id, release_number, definition_schema_version, languages, definition,
     author_label, machine_assisted, machine_assistance_notes)
    VALUES (rel_reviewed_with_auditor, s.pack_unshipped, 902, 1, ARRAY['en', 'ta'],
            pg_temp.st2_def_small(), 'TEST ONLY — scratch release for the metadata controls',
            true,
            'TEST ONLY — drafted by a model from the fixture above and disclosed as such, '
            'which is the minimum prose the constraint asks for.');
  v := pg_temp.st2_err(format(
    'UPDATE public.tradition_pack_releases SET status = %L, reviewed_at = now(),'
    '       review_label = %L, review_basis = %L, review_scope = %L,'
    '       reviewed_languages = ARRAY[%L], reviewed_by = %L::uuid'
    '  WHERE id = %L::uuid',
    'reviewed', 'TEST ONLY — REVIEWED CONTROL',
    'TEST ONLY — a synthetic record written by the Stage 2 battery. No human reader of '
    || 'Tamil reviewed these strings.',
    'TEST ONLY — structure and language coverage only, no religious or cultural claim.',
    'en', s.owner_a::text, rel_reviewed_with_auditor::text));
  IF v <> 'no-error' THEN
    RAISE EXCEPTION 'FAIL 16: a review could not name a real account, or name one language '
                    'of a two-language release: %', v;
  END IF;
  -- Both halves of that write have to be visible afterwards, not merely un-refused.
  SELECT count(*) INTO n FROM public.tradition_pack_releases
    WHERE id = rel_reviewed_with_auditor AND status = 'reviewed'
      AND reviewed_by = s.owner_a AND reviewed_languages = ARRAY['en']
      AND machine_assisted AND length(btrim(machine_assistance_notes)) >= 20;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 16: the review write reported success but did not land intact';
  END IF;
  passed := passed + 2;
  -- The optional reviewer stays optional: group 15e walked a release to `reviewed` with the
  -- column left alone, and here that row is read back. A NOT NULL that crept in through a
  -- later migration would fail this rather than quietly making every review anonymous.
  SELECT count(*) INTO n FROM public.tradition_pack_releases
    WHERE id = rel_scratch AND status = 'reviewed' AND reviewed_by IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 16: the release reviewed without a named auditor no longer reads '
                    'back that way';
  END IF;
  passed := passed + 1;
  -- reviewed → approved is the one step every refusal in group 13 stands beside, and it has
  -- to work: the fixture's approved release proves the schema can hold one, but the fixture
  -- runs before the guard has been probed from either side. `approved_at` is written by the
  -- trigger, not the caller, so the caller supplies nothing but the step.
  v := pg_temp.st2_err(format(
    'UPDATE public.tradition_pack_releases SET status = %L WHERE id = %L::uuid',
    'approved', rel_scratch::text));
  IF v <> 'no-error' THEN
    RAISE EXCEPTION 'FAIL 16: the legal reviewed→approved step was refused: %', v;
  END IF;
  SELECT count(*) INTO n FROM public.tradition_pack_releases
    WHERE id = rel_scratch AND status = 'approved' AND approved_at IS NOT NULL
      AND review_label = 'TEST ONLY — REVIEWED FIXTURE'
      AND reviewed_languages = ARRAY['en', 'ta'];
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL 16: approval did not stamp itself, or did not carry the review '
                    'record it was granted under';
  END IF;
  passed := passed + 2;
  -- An approved release is now the thing group 13 refused everywhere else: an approved row
  -- that could not actually be *used* would mean the refusals were protecting nothing.
  v := pg_temp.st2_err(format(
    'UPDATE public.weddings SET tradition_pack_release_id = %L::uuid WHERE id = %L::uuid',
    rel_scratch::text, s.wedding_b::text));
  IF v <> 'no-error' THEN
    RAISE EXCEPTION 'FAIL 16: a release this run walked to approved could not be selected: %', v;
  END IF;
  passed := passed + 1;
  -- Nothing above touched the fixture's own release, which is the point of doing this on
  -- scratch rows: wedding B is left holding the release it was given, and can be moved back
  -- because a selection is not a pin.
  v := pg_temp.st2_err(format(
    'UPDATE public.weddings SET tradition_pack_release_id = %L::uuid WHERE id = %L::uuid',
    s.release_ok::text, s.wedding_b::text));
  IF v <> 'no-error' THEN
    RAISE EXCEPTION 'FAIL 16: wedding B could not be moved back onto its seeded release: %', v;
  END IF;
  passed := passed + 1;
  -- The two scratch releases this group produced are both approved now, and approved rows
  -- are undeletable by group 15e's own rule, so the table ends here rather than tidied.
  -- Stated as an exact number on purpose: a probe that stopped running would change it, and
  -- a smaller count in the log is a failure, not a cleaner database.
  SELECT count(*) INTO n FROM public.tradition_pack_releases;
  IF n <> 7 THEN
    RAISE EXCEPTION 'FAIL 16: the battery ends with % releases: 4 fixture, 1 from group '
                    '13''s per-kind control, 1 walked to reviewed by group 15e and 1 walked '
                    'through the full lifecycle here — all of the last three undeletable on '
                    'purpose', n;
  END IF;
  passed := passed + 1;
  RAISE NOTICE 'PASS 16: a review may name a real auditor or name none, a single-language '
               'review of a two-language release is legal, and the step the refusals stand '
               'beside actually promotes a release and makes it selectable (8 assertions)';

  -- A floor, not an expectation. Carried forward rather than replaced: this file printed
  -- 322 at Stage 2's own commit (a51856f), 325 immediately before Stage 4 began, 399 with
  -- the Stage 4 pack boundary in it (group 8b's opened-up backstop, group 9's
  -- release/pack visibility, and group 15), 401 once §D's deletion matrix was measured
  -- across three states instead of two, and 464 now. Most of what was added is not new
  -- probes so much as existing ones being told to mean something: group 13's set grew from
  -- the 71 rows Stage 3 left behind to 142 as the Stage 4 release contract was written out
  -- slot by slot, and every one of those rows now carries an expected refusal *text* beside
  -- its SQLSTATE — the repair for six rows that had been passing by being refused by the
  -- pinned section vocabulary instead of by the position-ordering rule they claimed to
  -- test. Group 16 adds the eight successful writes those refusals depend on: a review that
  -- may name a real auditor or name none, a one-language review of a two-language release,
  -- and the reviewed→approved step actually promoting a row and making it selectable.
  -- The number below is a little under the last measurement, so an assertion that quietly
  -- stops running is a failure rather than a smaller number in the log.
  IF passed < 458 THEN
    RAISE EXCEPTION 'FAIL: only % assertions ran — the probe sets must not be empty', passed;
  END IF;
  RAISE NOTICE 'STAGE2 SECURITY TESTS PASSED (%)', passed;
END;
$STAGE2$;
