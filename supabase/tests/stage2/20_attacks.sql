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
  gen_random_uuid() AS template,       gen_random_uuid() AS template_dep,
  gen_random_uuid() AS person_a,       gen_random_uuid() AS venue_a,
  gen_random_uuid() AS venue_b,        gen_random_uuid() AS event_a1,
  gen_random_uuid() AS event_a2,       gen_random_uuid() AS event_a3,
  gen_random_uuid() AS event_b1,       gen_random_uuid() AS draft_a,
  gen_random_uuid() AS version_a1,     gen_random_uuid() AS version_b1,
  gen_random_uuid() AS publication_a1, gen_random_uuid() AS publication_b1,
  gen_random_uuid() AS household_a,    gen_random_uuid() AS household_b,
  gen_random_uuid() AS rsvp_a,         gen_random_uuid() AS request_a,
  gen_random_uuid() AS feedback_a,     gen_random_uuid() AS asset_a,
  gen_random_uuid() AS entitlement_a,  gen_random_uuid() AS token_a,
  gen_random_uuid() AS person_b,       gen_random_uuid() AS draft_b,
  gen_random_uuid() AS rsvp_b,         gen_random_uuid() AS request_b,
  gen_random_uuid() AS feedback_b,     gen_random_uuid() AS asset_b,
  gen_random_uuid() AS entitlement_b;

-- Signups go through auth.users, which also exercises the relocated
-- private.handle_new_user(): profile and default role must appear by themselves.
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT s.owner_a, 'owner-a@example.test', jsonb_build_object('name', 'Asha') FROM seed s
UNION ALL SELECT s.owner_b, 'owner-b@example.test', '{}'::jsonb FROM seed s
UNION ALL SELECT s.outsider, 'outsider@example.test', '{}'::jsonb FROM seed s;

-- Platform content in every catalogue state. `deprecated` must vanish from a
-- customer's read; `draft` must stay readable, because a migrated legacy template
-- has never been reviewed and the picker would otherwise go blank.
INSERT INTO public.tradition_packs (id, pack_key, revision, display_name, status,
                                    supported_languages, structure, reviewed_by, reviewed_at, review_notes)
SELECT s.pack, 'tamil-vaasthu', 1, 'Tamil Vaasthu', 'approved',
       ARRAY['ta', 'en'], '{"rituals": ["haathi_puja"]}'::jsonb, s.owner_a, now(),
       'seeded by the Stage 2 suite' FROM seed s;

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
                             tradition_pack_id, design_template_id, style_settings,
                             estimated_guest_count)
SELECT s.wedding_a, s.owner_a, 'Asha Canonical', 'ta', ARRAY['en'], s.pack, s.template,
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

INSERT INTO public.invitation_drafts (id, wedding_id, content)
SELECT s.draft_a, s.wedding_a, '{"heading": "Asha weds Bala"}'::jsonb FROM seed s;

INSERT INTO public.invitation_versions (id, wedding_id, version_number, snapshot,
                                        tradition_pack_id, design_template_id, created_by)
SELECT s.version_a1, s.wedding_a, 1, '{"heading": "Asha weds Bala"}'::jsonb, s.pack,
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

INSERT INTO public.invitation_drafts (id, wedding_id, content)
SELECT s.draft_b, s.wedding_b, '{"heading": "Bala weds Divya"}'::jsonb FROM seed s;

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
  ('pack structure that is not an object', '23514',
   $t$INSERT INTO public.tradition_packs (pack_key, revision, display_name, structure)
      VALUES ('broken', 1, 'Broken pack', '[]'::jsonb)$t$),
  -- Withdrawing platform content that a customer already relies on has to fail,
  -- whatever role asks: a published invitation must not lose its template under the
  -- customer's feet. This is the delete side of "admin/service write only".
  ('withdraw a template a snapshot still points at', '23503',
   $t$DELETE FROM public.design_templates WHERE id = current_setting('probe.template')::uuid$t$),
  ('withdraw a tradition pack in use', '23503',
   $t$DELETE FROM public.tradition_packs WHERE id = current_setting('probe.pack')::uuid$t$),
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
BEGIN
  SELECT * INTO s FROM seed;

  canonical := ARRAY[
    'weddings','wedding_people','venues','wedding_events','invitation_drafts',
    'invitation_versions','publications','guest_households','household_event_scopes',
    'rsvp_responses','approval_requests','approval_feedback','wedding_assets',
    'entitlements','design_templates','tradition_packs','profiles','user_roles'];
  legacy_tbls := ARRAY[
    'projects','templates','guests','orders','payments','printers','activity_logs',
    'migration_findings'];
  private_tbls := ARRAY['access_tokens','audit_events'];
  scoped := ARRAY[
    'wedding_people','venues','wedding_events','invitation_drafts','invitation_versions',
    'publications','guest_households','household_event_scopes','rsvp_responses',
    'approval_requests','approval_feedback','wedding_assets','entitlements'];
  owner_writable := ARRAY[
    'wedding_people','venues','wedding_events','invitation_drafts','guest_households',
    'household_event_scopes','rsvp_responses','wedding_assets'];
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
    $t5$INSERT INTO public.invitation_drafts (wedding_id, content)
        VALUES (current_setting('probe.wedding_a')::uuid, '{"forged": true}'::jsonb)$t5$,
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

  -- ----------------------------------------------------------------- group 9
  -- Platform catalogue: customers read what was reviewed or is still unreviewed, and
  -- never what was withdrawn. Computed against the real table, so the assertion
  -- cannot drift away from the seed.
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
  EXECUTE 'SET ROLE authenticated';
  n := pg_temp.st2_visible('SELECT 1 FROM public.tradition_packs');
  EXECUTE 'RESET ROLE';
  IF n = 0 THEN
    RAISE EXCEPTION 'FAIL 9: the approved tradition pack is invisible — the picker would be empty';
  END IF;
  passed := passed + 1;
  RAISE NOTICE 'PASS 9: catalogue visibility matches status (deprecated hidden, draft and approved readable)';

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
  n := pg_temp.st2_changed($t10$INSERT INTO public.invitation_drafts (wedding_id, content)
      VALUES (current_setting('probe.fresh')::uuid, '{"heading": "fresh"}'::jsonb)$t10$);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 10: owner could not open a draft (rows=%)', n; END IF;
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
  -- Invalid states, each against the constraint that owns it. The expected SQLSTATE
  -- is stored per row, so a probe cannot pass by failing for the wrong reason.
  SELECT array_agg(label ORDER BY label), array_agg(expect ORDER BY label),
         array_agg(stmt ORDER BY label)
    INTO labels, expects, stmts
    FROM probes_state;
  IF labels IS NULL THEN
    RAISE EXCEPTION 'FAIL: the invalid-state probe set is empty';
  END IF;
  FOR i IN 1 .. array_length(labels, 1) LOOP
    v := pg_temp.st2_err(stmts[i]);
    IF v NOT LIKE (expects[i] || '%') THEN
      RAISE EXCEPTION 'FAIL 13: "%" expected SQLSTATE %, got %', labels[i], expects[i], v;
    END IF;
    passed := passed + 1;
  END LOOP;
  RAISE NOTICE 'PASS 13: % invalid states refused by the constraint that governs them',
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

  IF passed < 100 THEN
    RAISE EXCEPTION 'FAIL: only % assertions ran — the probe sets must not be empty', passed;
  END IF;
  RAISE NOTICE 'STAGE2 SECURITY TESTS PASSED (%)', passed;
END;
$STAGE2$;
