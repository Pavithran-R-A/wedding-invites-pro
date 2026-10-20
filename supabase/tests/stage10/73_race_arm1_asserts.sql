-- Stage 10 race tier, arm 1 assertions. One committed transaction, run after the session pair
-- `71_race_a1_flip.sql` / `72_race_b1_publish.sql` has finished and marker-gated by the shell.
--
-- What the pair just did, before this file reads it: while an `entitlement_required` flip was
-- written-but-uncommitted, w1 (no entitlement) was published and accepted. This file turns that log
-- into pinned state: the flip is committed, the accepted publication survived it, the control wedding
-- is refused by the same gate a moment later in the same transaction, and the policy is reverted —
-- because a race tier that leaves the singleton flipped would hand every later battery a gate nobody
-- asked for, which is exactly the shared-state mistake §17 exists to prevent.
--
-- Harness shape is `80_commerce_ledger.sql`'s, deliberately: every refusal asserted as SQLSTATE *and*
-- sentence, every state claim as a row that is there or not there, one `NOTICE: PASS <id>` per cell,
-- and the runner's line count must equal the reported total.
SET client_min_messages = notice;
SET search_path = public, pg_temp;

SELECT set_config('s10x.passed', '0', false);

CREATE FUNCTION pg_temp.s10x_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s10x.passed',
    (coalesce(nullif(current_setting('s10x.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s10x_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s10x_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s10x_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s10x_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s10x_err(label text, stmt text, want_state text, want_like text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    v := SQLSTATE || ' | ' || SQLERRM;
  END;
  IF v IS NULL THEN
    RAISE EXCEPTION 'FAIL %: "%" was allowed through', label, stmt;
  END IF;
  IF split_part(v, ' | ', 1) <> want_state OR v NOT LIKE want_like THEN
    RAISE EXCEPTION 'FAIL %: got [%] want [% / %]', label, v, want_state, want_like;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s10x_add(1);
END $fn$;

-- The control publish (RA03) names the wedding id it refused inside its own sentence, so the LIKE below
-- pins everything up to that point rather than guessing at an id this file does not control.
SELECT set_config('s10x.gate_like',
  '%42501 | wedding %may not publish: the commerce policy requires an active entitlement for one of '
  || '[QCLASSIC], and this wedding has none. Hiding a button is not a gate; this is.%', false);

-- RA00 the flip A1 wrote is now the committed policy: the window B1 published through was real, and a
-- run whose flip never committed would leave the control cell vacuous.
SELECT pg_temp.s10x_eq('RA00 committed policy after the race',
  (SELECT publish_gate || '/' || coalesce(array_to_string(publish_required_package_codes, ','), '(none)')
     FROM private.commerce_policy WHERE id = 1),
  'entitlement_required/QCLASSIC');

-- RA01 the un-entitled publish survives its own race: the row is there, committed, active.
SELECT pg_temp.s10x_eq('RA01 w1 publications after the flip committed',
  (SELECT count(*)::text FROM public.publications
    WHERE wedding_id = '0a0a0a00-0000-4000-8000-000000000001'::uuid), '1');

-- RA02 ... and it has no entitlement to point at. This is the finding's shape: the gate derives from
-- the committed policy at statement time and is not retroactive — an accepted publication outlives a
-- flip that would have refused it. Whether the product wants a flip to preempt in-flight publishers
-- is an owner decision recorded in the audit, not a defect asserted here.
SELECT pg_temp.s10x_eq('RA02 w1 entitlements (the published wedding has none)',
  (SELECT count(*)::text FROM public.entitlements
    WHERE wedding_id = '0a0a0a00-0000-4000-8000-000000000001'::uuid), '0');

-- RA03 the gate is not broken, it is stale-read-by-design: the same insert, as a control, one
-- statement later in the same transaction against the committed flip, refuses with the full sentence.
SELECT pg_temp.s10x_err('RA03 control publish of w4 under the committed flip',
  $$ INSERT INTO public.publications (wedding_id, version_id, status)
     SELECT w.id, ver.id, 'active'
       FROM public.weddings w JOIN public.invitation_versions ver ON ver.wedding_id = w.id
      WHERE w.id = '0a0a0a00-0000-4000-8000-000000000004'::uuid $$,
  '42501', current_setting('s10x.gate_like'));

SELECT pg_temp.s10x_eq('RA04 w4 has no publications after the refusal',
  (SELECT count(*)::text FROM public.publications
    WHERE wedding_id = '0a0a0a00-0000-4000-8000-000000000004'::uuid), '0');

-- RA05 reverting the flip must un-stick the control: the identical statement now succeeds, which
-- proves RA03 refused because of the policy and not because of anything structural about w4.
--
-- `ARRAY[]::text[]` and not NULL: `publish_required_package_codes` is NOT NULL with default `'{}'`, so
-- an empty array is the permissive state the shipped chain actually carries (the census prints it as
-- `GATE_PACKAGES=0`). A NULL here is a 23502 on the revert, measured at the RA05 line of a real run.
UPDATE private.commerce_policy
   SET publish_gate = 'permissive', publish_required_package_codes = ARRAY[]::text[]
 WHERE id = 1;
INSERT INTO public.publications (wedding_id, version_id, status)
SELECT w.id, ver.id, 'active'
  FROM public.weddings w JOIN public.invitation_versions ver ON ver.wedding_id = w.id
 WHERE w.id = '0a0a0a00-0000-4000-8000-000000000004'::uuid;
SELECT pg_temp.s10x_eq('RA05 control publish succeeds once the policy is permissive again',
  (SELECT count(*)::text FROM public.publications
    WHERE wedding_id = '0a0a0a00-0000-4000-8000-000000000004'::uuid), '1');

-- RA06..RA08 the measurement's boundary: this arm touches the gate and the publications table only —
-- no money row moves, and the only order on the chain is still the fixture quote for w2.
SELECT pg_temp.s10x_eq('RA06 orders untouched by arm 1',
  (SELECT count(*)::text FROM private.commerce_orders), '1');
SELECT pg_temp.s10x_eq('RA07 ledger rows untouched by arm 1',
  (SELECT count(*)::text FROM private.commerce_payment_events), '0');
SELECT pg_temp.s10x_eq('RA08 chain-wide entitlements untouched by arm 1',
  (SELECT count(*)::text FROM public.entitlements), '0');

-- RA09 the floor: nine named cells, so a run that silently skipped its way here cannot print a total.
DO $$
DECLARE n int := coalesce(nullif(current_setting('s10x.passed', true), ''), '0')::int;
BEGIN
  IF n < 9 THEN
    RAISE EXCEPTION 'FAIL RA09 floor — arm 1 printed % cells, expected at least 9', n;
  END IF;
  RAISE NOTICE 'PASS RA09 floor';
  PERFORM pg_temp.s10x_add(1);
END $$;

SELECT 'STAGE10 RACE TESTS PASSED (' ||
       coalesce(nullif(current_setting('s10x.passed', true), ''), '0')::int || ')' AS result;
