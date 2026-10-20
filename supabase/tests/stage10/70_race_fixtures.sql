-- Stage 10 race tier, shared fixture. Run by `supabase/tests/stage10/run.sh race` (and `all`) before any
-- session pair, as one committed transaction, on the `race` chain — a database that runs nothing else,
-- because the publish-gate arm commits a real `entitlement_required` flip (reverted by its own assert
-- file) and the capture arm commits a real collision. Both live here, never on the shared
-- `localvivaahvarnam` stack and never on a hosted project.
--
-- The cast, by role:
--   w1  published by session B1 while session A1's policy flip is written-but-uncommitted (arm 1)
--   w2  quoted here, captured twice concurrently by sessions A2/B2 under one event identity (arm 2)
--   w3  gets its money history inside the deletion assert file itself, so the deletion arm and the
--       evidence it protects live in one transaction the run can point at
--   w4  the control wedding: published by the assert file AFTER the committed flip; must be refused
--   w5  planted WITHOUT versions, publications or money — the deletion arm's permissive half
-- Nothing here contacts a provider; the order is minted by the product's own quoting body.
SET search_path = public, pg_temp;

-- The fixture is a counted suite like everything else this runner reaches — a file the runner executes
-- but that reports no total is how a silently-skipped fixture stage reads as progress. The counter
-- lives in `s10f.passed`, not in the GUC-default namespace: this file runs as the chain owner with the
-- session `search_path` and no battery harness loaded, so `pg_catalog.set_config` is spelled whole.
SELECT pg_catalog.set_config('s10f.passed', '0', false);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('0a0a0a00-0000-4000-8000-000000000101'::uuid, 's10race-owner@stage10qual.test', '{}'::jsonb);

INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages, style_settings)
VALUES ('0a0a0a00-0000-4000-8000-000000000001'::uuid, '0a0a0a00-0000-4000-8000-000000000101'::uuid,
        'Race w1 publish', 'en', ARRAY[]::text[], '{"font":"Playfair Display"}'::jsonb),
       ('0a0a0a00-0000-4000-8000-000000000002'::uuid, '0a0a0a00-0000-4000-8000-000000000101'::uuid,
        'Race w2 capture', 'en', ARRAY[]::text[], '{"font":"Playfair Display"}'::jsonb),
       ('0a0a0a00-0000-4000-8000-000000000003'::uuid, '0a0a0a00-0000-4000-8000-000000000101'::uuid,
        'Race w3 money history', 'en', ARRAY[]::text[], '{"font":"Playfair Display"}'::jsonb),
       ('0a0a0a00-0000-4000-8000-000000000004'::uuid, '0a0a0a00-0000-4000-8000-000000000101'::uuid,
        'Race w4 control', 'en', ARRAY[]::text[], '{"font":"Playfair Display"}'::jsonb),
       ('0a0a0a00-0000-4000-8000-000000000005'::uuid, '0a0a0a00-0000-4000-8000-000000000101'::uuid,
        'Race w5 bare', 'en', ARRAY[]::text[], '{"font":"Playfair Display"}'::jsonb);

-- w1 through w4 get versions; w5 deliberately has none, and its deletion is the arm that shows the
-- protection is the history, not the wedding.
INSERT INTO public.invitation_versions (wedding_id, version_number, snapshot, created_by)
SELECT w, 1, jsonb_build_object('title', 'race tier'), '0a0a0a00-0000-4000-8000-000000000101'::uuid
  FROM unnest(ARRAY['0a0a0a00-0000-4000-8000-000000000001'::uuid,
                    '0a0a0a00-0000-4000-8000-000000000002'::uuid,
                    '0a0a0a00-0000-4000-8000-000000000003'::uuid,
                    '0a0a0a00-0000-4000-8000-000000000004'::uuid]) w;

INSERT INTO private.commerce_packages (package_code, currency, amount_minor, price_version, status, display_approved)
VALUES ('QCLASSIC', 'INR', 499900, 1, 'active', true);

-- One live order for w2, so the capture pair has a frozen quote to collide on.
DO $$
DECLARE v jsonb;
BEGIN
  SELECT internal_api.create_commerce_order(
    '0a0a0a00-0000-4000-8000-000000000002'::uuid, 'QCLASSIC',
    '0a0a0a00-0000-4000-8000-000000000101'::uuid) INTO v;
  IF v ->> 'status' IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'FAIL fixture: create_commerce_order returned %', v;
  END IF;
  RAISE NOTICE 'PASS RF00 fixture order minted for w2';
  PERFORM pg_catalog.set_config('s10f.passed',
    (coalesce(nullif(current_setting('s10f.passed', true), ''), '0')::int + 1)::text, false);
END $$;

SELECT 'STAGE10 RACE TESTS PASSED (' ||
       coalesce(nullif(current_setting('s10f.passed', true), ''), '0')::int || ')' AS result;
