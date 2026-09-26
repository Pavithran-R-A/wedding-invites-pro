-- Stage 2 fixture — a synthetic pre-Stage-2 database, applied between the published
-- migrations and the Stage 2 chain, so the migration is tested against real-shaped
-- history instead of an empty schema.
--
-- Everything here is invented. No real customer, guest, order or payment row was
-- used, and every identifier is fixed so a failing run is reproducible.
--
-- The point of the awkward rows is to prove the migration refuses to guess:
--   'hi' is not a first-release language code, so that wedding must arrive with
--       primary_language = NULL and a recorded finding, not silently as English;
--   a whitespace-only and an empty title both fail the canonical constraint, so
--       those rows must be left behind with a reason;
--   an editor block that is a bare string is not a style, and must be recorded as
--       dropped rather than reshaped into one;
--   base_paid / fully_paid must produce findings and zero entitlements;
--   guest rows must not become households, because nothing proves group_name names a
--       family rather than a label like "Bride's side".

-- ===========================================================================
-- Accounts (the signup trigger provisions profiles + the default role)
-- ===========================================================================

INSERT INTO auth.users (id, email, raw_user_meta_data, created_at) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'asha@example.test',
   jsonb_build_object('name', 'Asha'), '2026-01-05T09:00:00Z'),
  ('a0000000-0000-4000-8000-000000000002', 'bala@example.test',
   jsonb_build_object('name', 'Bala'), '2026-01-06T09:00:00Z'),
  ('a0000000-0000-4000-8000-000000000003', 'carol@example.test',
   '{}'::jsonb, '2026-01-07T09:00:00Z');

-- A second role fact for one account, so "this caller is an admin" remains a state
-- the Stage 2 suite can reason about.
INSERT INTO public.user_roles (id, user_id, role) VALUES
  ('a0000000-0000-4000-8000-0000000000aa',
   'a0000000-0000-4000-8000-000000000002', 'admin');

-- ===========================================================================
-- Legacy templates
-- ===========================================================================

INSERT INTO public.templates (id, name, preview_svg, price_tier, tags, language_support, active, created_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'Maroon Heritage',
   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
   'premium', ARRAY['classic', 'foil'], ARRAY['en', 'ta'], true, '2026-01-02T00:00:00Z'),
  ('b0000000-0000-4000-8000-000000000002', 'Gold Temple',
   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>',
   'standard', ARRAY['temple'], ARRAY['te', 'kn'], true, '2026-01-03T00:00:00Z'),
  -- retired from the catalogue
  ('b0000000-0000-4000-8000-000000000003', 'Old Layout', NULL, 'standard', '{}', '{en}', false,
   '2026-01-04T00:00:00Z'),
  -- blank name: cannot migrate
  ('b0000000-0000-4000-8000-000000000004', '   ', NULL, 'standard', '{}', '{en}', true,
   '2026-01-04T00:00:00Z'),
  -- language list containing a code the product never offered
  ('b0000000-0000-4000-8000-000000000005', 'Hindi Experiment', NULL, NULL, NULL,
   ARRAY['en', 'hi'], true, '2026-01-04T00:00:00Z'),
  -- shares a name with the first row, to prove key derivation stays collision-free
  -- (its id differs inside the first eight characters, which is the part the key
  -- borrows — exactly how two real v4 UUIDs differ)
  ('b1000000-0000-4000-8000-000000000006', 'Maroon Heritage', NULL, 'standard', '{}',
   '{en}', true, '2026-01-04T00:00:00Z');

-- ===========================================================================
-- Legacy projects
-- ===========================================================================

INSERT INTO public.projects
  (id, user_id, title, language, template_id, paid_status, selected_features, guest_count, created_at, updated_at)
VALUES
  -- the healthy row: everything about it should survive intact
  ('c0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'Asha Wedding', 'ta',
   'b0000000-0000-4000-8000-000000000001', 'unpaid',
   '{"editor": {"font": "Playfair Display", "fontSize": "24", "color": "#6b1e2a", "alignment": "center", "foilEnabled": false}}',
   120, '2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z'),

  -- real wedding, unusable values: language, template link, negative count, mystery
  -- keys. Its template is the blank-named one, which cannot migrate, so the link
  -- must be dropped with a finding. (A truly dangling template_id is not
  -- reproducible here: legacy.projects.template_id carries a foreign key.)
  ('c0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000001', 'Second Draft', 'hi',
   'b0000000-0000-4000-8000-000000000004', 'unpaid',
   '{"editor": {"font": "Noto Serif", "alignment": "left"}, "beta_gifting": true, "notes": "leftover"}',
   -5, '2026-02-03T00:00:00Z', '2026-02-03T00:00:00Z'),

  -- blank title and a paid claim: must not migrate, must be recorded
  ('c0000000-0000-4000-8000-000000000003',
   'a0000000-0000-4000-8000-000000000002', '   ', 'en',
   'b0000000-0000-4000-8000-000000000002', 'fully_paid', '{}'::jsonb, 40,
   '2026-02-04T00:00:00Z', '2026-02-04T00:00:00Z'),

  -- empty title + base_paid: same outcome as the blank row, different shape.
  -- (`projects.title` is NOT NULL, so "missing title" can only ever arrive as
  -- an empty or whitespace-only string — both must be caught, not just one.)
  ('c0000000-0000-4000-8000-000000000004',
   'a0000000-0000-4000-8000-000000000001', '', NULL, NULL, 'base_paid', NULL, NULL,
   '2026-02-05T00:00:00Z', '2026-02-05T00:00:00Z'),

  -- every legacy account here survives, so this row is a *representable* awkward
  -- shape: the editor block exists but is a bare string, and the wedding has no
  -- template at all. style_settings must arrive empty rather than storing a
  -- sentence as a style, and the normalisation must be recorded.
  ('c0000000-0000-4000-8000-000000000005',
   'a0000000-0000-4000-8000-000000000001', 'Asha Reprise', 'ml', NULL, 'fully_paid',
   '{"editor": "Playfair Display", "notes": "leftover"}'::jsonb, 10,
   '2026-02-06T00:00:00Z', '2026-02-06T00:00:00Z'),

  -- valid row whose catch-all holds a JSON array instead of an object
  ('c0000000-0000-4000-8000-000000000006',
   'a0000000-0000-4000-8000-000000000002', 'Bala Wedding', NULL,
   'b0000000-0000-4000-8000-000000000003', 'unpaid',
   '["not", "an", "object"]'::jsonb, 0,
   '2026-02-07T00:00:00Z', '2026-02-07T00:00:00Z'),

  -- a paid claim attached to an otherwise perfectly good wedding
  ('c0000000-0000-4000-8000-000000000007',
   'a0000000-0000-4000-8000-000000000003', 'Carol Wedding', 'en',
   'b0000000-0000-4000-8000-000000000001', 'fully_paid',
   '{"editor": {"font": "Inter"}}', 250, '2026-02-08T00:00:00Z', '2026-02-08T00:00:00Z');

-- ===========================================================================
-- Legacy guests (per-person rows with a plaintext bearer token)
-- ===========================================================================

INSERT INTO public.guests
  (id, project_id, name, phone, email, group_name, rsvp_status, people_count,
   meal_type, accommodation, transport, notes, token)
VALUES
  ('d0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000001',
   'Anitha Rao', '+919000000001', 'anitha@example.test', 'Bride''s side', 'attending', 2,
   'veg', true, false, 'Arriving by train', 'deadbeef-token-1'),
  ('d0000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000001',
   'Suresh Rao', '+919000000001', NULL, 'Bride''s side', 'pending', 2,
   NULL, false, false, NULL, 'deadbeef-token-2'),
  -- group_name that is plainly a category, not a household
  ('d0000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000002',
   'College friends', NULL, NULL, 'Groom''s friends', 'declined', 6,
   'nonveg', false, true, 'Might be late', 'deadbeef-token-3');

-- ===========================================================================
-- Legacy commerce scaffolding (never wired to a provider)
-- ===========================================================================

INSERT INTO public.printers (id, name, contact, api_endpoint, payment_terms, regions, active)
VALUES ('e0000000-0000-4000-8000-000000000001', 'Print Mart', 'contact@example.test',
        'https://partner.example.invalid/secret-path', 'NET-30', ARRAY['chennai'], true);

INSERT INTO public.orders (id, project_id, type, printer_id, status, pdf_url, cost_printer_paise, price_platform_paise)
VALUES
  ('f0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'print', 'e0000000-0000-4000-8000-000000000001', 'pending', NULL, 1500000, 249900),
  ('f0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000007',
   'print', NULL, 'held', NULL, 0, 99900);

INSERT INTO public.payments (id, order_id, user_id, provider, provider_id, amount_paise, status)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'razorpay', 'order_fake_1', 249900, 'created'),
  ('10000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000003', 'razorpay', NULL, 99900, 'failed');

INSERT INTO public.activity_logs (id, user_id, project_id, action, ip, user_agent)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001', 'project_created', '203.0.113.10', 'Mozilla/5.0'),
  ('20000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003',
   'c0000000-0000-4000-8000-000000000007', 'paid_status_set', NULL, NULL);

-- ===========================================================================
-- Self-check: the fixture is only meaningful if it holds what the migration
-- assertions claim about it, so the counts are verified before they are relied on.
-- ===========================================================================
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM public.projects;
  IF n <> 7 THEN RAISE EXCEPTION 'fixture: expected 7 legacy projects, found %', n; END IF;

  SELECT count(*) INTO n FROM public.templates;
  IF n <> 6 THEN RAISE EXCEPTION 'fixture: expected 6 legacy templates, found %', n; END IF;

  SELECT count(*) INTO n FROM public.projects
   WHERE paid_status IS NOT NULL AND paid_status <> 'unpaid';
  IF n <> 4 THEN RAISE EXCEPTION 'fixture: expected 4 legacy paid claims, found %', n; END IF;

  SELECT count(*) INTO n FROM public.guests;
  IF n <> 3 THEN RAISE EXCEPTION 'fixture: expected 3 legacy guest rows, found %', n; END IF;

  SELECT count(*) INTO n FROM public.payments;
  IF n <> 2 THEN RAISE EXCEPTION 'fixture: expected 2 legacy payment rows, found %', n; END IF;

  -- The expectation the Stage 2 suite later checks against real output. Only the
  -- title can block a legacy row: user_id is NOT NULL with a working foreign key.
  SELECT count(*) INTO n FROM public.projects p
   WHERE length(btrim(p.title)) > 0;
  IF n <> 5 THEN RAISE EXCEPTION 'fixture: expected 5 migratable projects, found %', n; END IF;

  RAISE NOTICE 'STAGE2 LEGACY FIXTURE READY (7 projects, 6 templates, 3 guests, 4 paid claims, 5 migratable)';
END
$$;
