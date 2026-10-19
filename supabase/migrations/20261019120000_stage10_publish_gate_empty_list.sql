-- Stage 10 repair 2: the publish gate's own sentence about an empty package list.
--
-- Found by the Stage 10 HTTP battery, arm G-02, and not by anything before it: the battery is the only tier
-- that sets `publish_required_package_codes = '{}'::text[]` and asks the gate to refuse in front of an
-- operator. Every SQL-tier gate arm names at least one code, so all of them exercise the populated branch.
--
-- The defect is a PostgreSQL behaviour the migration author expected to be NULL. `array_to_string` of an
-- empty array is the empty string, not NULL, so
--
--   coalesce(array_to_string(v_policy.publish_required_package_codes, ', '), '(none named)')
--
-- from 20261017120000_stage10_commerce_foundations.sql:560 never reaches its second argument. A policy with
-- no codes named therefore answers `… requires an active entitlement for one of []` — the refusal is
-- correct and fail-closed (no code satisfies an empty list, so nothing publishes), but the sentence that was
-- written to explain that state is dead code, and an operator reading `[]` has to infer that the bracket is
-- not a formatting accident. The idiom that avoids it — `coalesce(nullif(array_to_string(…), ''), …)` — is
-- already the one this stage's own SQL battery uses to print role lists and refusals
-- (supabase/tests/stage10/90_commerce_functions.sql:508, :878), so the pattern was in the repository and
-- this file did not follow it.
--
-- A forward migration rather than an edit of the Stage 10 file: that file is already applied on the
-- `localvivaahvarnam` stack, and `supabase db push` compares its recorded statements, so changing it in
-- place would look like drift and invite somebody to repair a schema that is actually fine.
--
-- `CREATE OR REPLACE FUNCTION` keeps the object's identity, so the privileges the original file revoked
-- survive it (a replace does not reset `proacl`) and the `publications_commerce_publish_gate` trigger keeps
-- pointing at the same function. The REVOKE is restated anyway: this file defines a SECURITY DEFINER body,
-- and the posture should be visible in the same file that writes it rather than inherited from a file a
-- reviewer may not have open.

CREATE OR REPLACE FUNCTION private.guard_publication_commerce_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_policy private.commerce_policy;
  v_entitled boolean;
BEGIN
  -- Only a row that is or becomes the wedding's live publication needs a right to publish. Revocation
  -- is the opposite of selling nothing, so it must never be gated: status leaves 'active' here and the
  -- trigger stands aside. (`public.publications` spells its live state 'active' — the row-level status
  -- list is ('active','revoked'), from
  -- 20260925120200_stage2_versions_and_publication.sql:60-92.)
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_policy FROM private.commerce_policy WHERE id = 1;
  IF NOT FOUND OR v_policy.publish_gate = 'permissive' THEN
    RETURN NEW;
  END IF;

  -- Re-derived from the row's own wedding_id, never from a client argument (§8): a stale tab and a
  -- racing webhook therefore land on the same answer, because both are asked about the row they touched.
  SELECT EXISTS (
    SELECT 1
      FROM public.entitlements e
     WHERE e.wedding_id = NEW.wedding_id
       AND e.status = 'active'
       AND e.package_code = ANY (v_policy.publish_required_package_codes)
  ) INTO v_entitled;

  IF NOT v_entitled THEN
    RAISE EXCEPTION
      'wedding % may not publish: the commerce policy requires an active entitlement for one of [%], '
      'and this wedding has none. Hiding a button is not a gate; this is.',
      NEW.wedding_id,
      -- `nullif(…, '')` is the whole repair: an empty list stringifies to '' and would otherwise print as
      -- `[]` while the sentence next to it says "one of", which reads like a formatting accident.
      coalesce(nullif(btrim(array_to_string(v_policy.publish_required_package_codes, ', ')), ''), '(none named)')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_publication_commerce_gate()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.guard_publication_commerce_gate() IS
  'The Stage 10 publish gate. Reads private.commerce_policy and, under entitlement_required, demands an '
  'active entitlement for the row''s own wedding whose package_code is in publish_required_package_codes. '
  'Under the shipped default (permissive) it changes nothing, which is why the other nine HTTP suites '
  '(339 declared cases) and every historical chain that publishes stay green without being weakened. An '
  'empty code list is refused with the sentence "(none named)" — see '
  '20261019120000_stage10_publish_gate_empty_list.sql.';
