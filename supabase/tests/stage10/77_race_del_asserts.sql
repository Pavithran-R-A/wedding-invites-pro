-- Stage 10 race tier, deletion arms. One committed transaction; runs after the two session pairs, on
-- the same `race` chain.
--
-- This is the closure of the gap §13 admitted in words — "no cell asserts this in any tier yet" — that
-- a paid wedding's financial history cannot be erased by the very DELETEs a host (or a compromised
-- role with table rights) would try. Three boundaries, all measured in the probe rounds first and
-- pinned here as contract:
--   1. a wedding WITH history refuses deletion by foreign key — first via `invitation_versions`,
--      then, with versions stripped inside the same transaction, via `entitlements`: the protection
--      is the history, and the money side is a blocker of its own;
--   2. a version-less, money-less wedding deletes cleanly — proving (1) is the history, not a blanket
--      "weddings are undeletable" claim nobody made;
--   3. erasing the OWNER is refused not by a foreign key but by the frozen-quote guard its SET NULL
--      cascade provokes — money rows survive a user deletion even through an indirect path.
-- Every refusal is asserted twice, as the SQLSTATE *and* sentence and as the rows that did NOT
-- disappear; the whole-file digest at the end is the same "changed nothing" posture `80_commerce_
-- ledger.sql` uses for its holds.
SET client_min_messages = notice;
SET search_path = public, pg_temp;

SELECT set_config('s10x.passed', '0', false);

CREATE FUNCTION pg_temp.s10x_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s10x.passed',
    (coalesce(nullif(current_setting('s10x.passed', true), ''), '0')::int + n)::text, false);
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

-- Build w3's money history through the product's own writers, in-file, so the deletion arm and the
-- evidence it protects are one named transaction the run can point at.
SELECT pg_temp.s10x_eq('RM00 w3 quote minted through the service body',
  (SELECT q.v ->> 'status' FROM
     (SELECT internal_api.create_commerce_order(
        '0a0a0a00-0000-4000-8000-000000000003'::uuid, 'QCLASSIC',
        '0a0a0a00-0000-4000-8000-000000000101'::uuid) AS v) q),
  'open');

SELECT pg_temp.s10x_eq('RM01 w3 capture applied through the service body',
  (SELECT q.v ->> 'disposition' || '/' || coalesce(q.v ->> 'applied_effect', '(none)') FROM
     (SELECT internal_api.record_commerce_event(
        'razorpay', 'r-del-1', 'payment.candidate.payment_captured', 'payment_captured', 'synthetic',
        repeat('cd', 32), true, NULL,
        (SELECT o.merchant_reference FROM private.commerce_orders o
          WHERE o.wedding_id = '0a0a0a00-0000-4000-8000-000000000003'),
        499900, 'INR', 'po_del', 'pay_del', now(),
        '0a0a0a00-0000-4000-8000-000000000101'::uuid) AS v) q),
  'applied/entitlement_granted');

SELECT pg_temp.s10x_eq('RM02 w3 is captured with exactly one entitlement',
  (SELECT o.status FROM private.commerce_orders o
     WHERE o.wedding_id = '0a0a0a00-0000-4000-8000-000000000003') || '/' ||
  (SELECT count(*)::text FROM public.entitlements
     WHERE wedding_id = '0a0a0a00-0000-4000-8000-000000000003'),
  'captured/1');

-- RM03 the precondition for RM04's ordering: the shared fixture gives w1–w4 exactly one version each, so
-- the first blocker a w3 delete meets is the version FK, not the money. Asserted as a count rather
-- than written here — `invitation_versions` carries `UNIQUE (wedding_id, version_number)`
-- (20260925120200_stage2_versions_and_publication.sql:36), so a second `version_number = 1` row for w3
-- could only be a 23505, and RM04's blocker would never be reached.
SELECT pg_temp.s10x_eq('RM03 w3 arrives with exactly one version',
  (SELECT count(*)::text FROM public.invitation_versions
    WHERE wedding_id = '0a0a0a00-0000-4000-8000-000000000003'), '1');

SELECT pg_temp.s10x_err('RM04 deleting a wedding with history is refused (versions first)',
  $$ DELETE FROM public.weddings
     WHERE id = '0a0a0a00-0000-4000-8000-000000000003'::uuid $$,
  '23503', '%invitation_versions_wedding_id_fkey%');

-- Strip the versions *inside this transaction* and retry: now the blocker is the money side. This
-- commit is real but harmless — no later cell or battery reads w3's versions, and the wedding row
-- itself never survives a moment where it could be deleted by accident.
DELETE FROM public.invitation_versions
 WHERE wedding_id = '0a0a0a00-0000-4000-8000-000000000003';
SELECT pg_temp.s10x_err('RM06 with versions gone the money rows still block (entitlements)',
  $$ DELETE FROM public.weddings
     WHERE id = '0a0a0a00-0000-4000-8000-000000000003'::uuid $$,
  '23503', '%entitlements_wedding_id_fkey%');

SELECT pg_temp.s10x_eq('RM07 the refused wedding is still there',
  (SELECT count(*)::text FROM public.weddings
    WHERE id = '0a0a0a00-0000-4000-8000-000000000003'), '1');

-- The control half: w5 exists in the shared fixture with no versions, publications or money, and it
-- deletes cleanly. Without this cell, (1) above would be indistinguishable from "weddings cannot be
-- deleted at all".
DO $$
DECLARE c int;
BEGIN
  DELETE FROM public.weddings WHERE id = '0a0a0a00-0000-4000-8000-000000000005'::uuid;
  GET DIAGNOSTICS c = ROW_COUNT;
  IF c <> 1 THEN RAISE EXCEPTION 'FAIL RM08 — bare-wedding delete removed % rows, want 1', c; END IF;
  RAISE NOTICE 'PASS RM08 version-less money-less wedding deletes cleanly';
  PERFORM pg_temp.s10x_add(1);
END $$;

-- The owner-erase arm. `weddings.owner_user_id` is ON DELETE CASCADE, so deleting the user *would*
-- reach every wedding — but the cascade's SET NULL onto the frozen orders provokes the freeze guard
-- first, and the whole statement is refused two rows away from the money.
SELECT pg_temp.s10x_err('RM09 erasing the owner user is refused by the frozen-quote guard',
  $$ DELETE FROM auth.users $$,
  '23514', '%is a frozen quote: wedding, owner, reference, package, price version, amount and currency may never change%');

SELECT pg_temp.s10x_eq('RM10 the owner survives the refused erase',
  (SELECT count(*)::text FROM auth.users
    WHERE id = '0a0a0a00-0000-4000-8000-000000000101'), '1');

-- RM10..RM12: each refusal left its target and its money alone.
SELECT pg_temp.s10x_eq('RM11 w3 order and entitlement survive everything above',
  (SELECT count(*)::text FROM private.commerce_orders
    WHERE wedding_id = '0a0a0a00-0000-4000-8000-000000000003') || '/' ||
  (SELECT count(*)::text FROM public.entitlements
    WHERE wedding_id = '0a0a0a00-0000-4000-8000-000000000003'),
  '1/1');

SELECT pg_temp.s10x_eq('RM12 w2 keeps its captured order and the grant evidence',
  (SELECT count(*)::text FROM private.commerce_orders
    WHERE wedding_id = '0a0a0a00-0000-4000-8000-000000000002' AND status = 'captured') || '/' ||
  (SELECT count(*)::text FROM private.commerce_payment_events
    WHERE order_id = (SELECT id FROM private.commerce_orders
                       WHERE wedding_id = '0a0a0a00-0000-4000-8000-000000000002')),
  '1/1');

-- RM14 the whole-file "changed nothing" digest, after three refused deletions and one accepted one.
-- Read it as arithmetic, not a magic string: two weddings carry money by now (w2 from the capture
-- pair, w3 from RM00/RM01), so two orders, two ledger rows, two attempts, two entitlements — and no
-- refund table row has been touched by this tier at all. Measured, not predicted: the first run of
-- this cell printed `2/2/2/2/0` against a `3/...` copied from a probe fixture that had one order more.
SELECT pg_temp.s10x_eq('RM14 chain-wide money digest after the deletion arms',
  (SELECT count(*) FROM private.commerce_orders)::text || '/' ||
  (SELECT count(*) FROM private.commerce_payment_events)::text || '/' ||
  (SELECT count(*) FROM private.commerce_payment_attempts)::text || '/' ||
  (SELECT count(*) FROM public.entitlements)::text || '/' ||
  (SELECT count(*) FROM private.commerce_refunds)::text,
  '2/2/2/2/0');

-- The floor: thirteen counted cells run before this one — RM00, RM01, RM02, RM03, RM04, RM06, RM07, RM08,
-- RM09, RM10, RM11, RM12, RM14 (RM05 is the in-file version strip, a step rather than a claim, so it prints
-- nothing). A run that skipped its way here cannot print a total.
DO $$
DECLARE n int := coalesce(nullif(current_setting('s10x.passed', true), ''), '0')::int;
BEGIN
  IF n < 13 THEN
    RAISE EXCEPTION 'FAIL RM20 floor — the deletion arms printed % cells, expected at least 13', n;
  END IF;
  RAISE NOTICE 'PASS RM20 floor';
  PERFORM pg_temp.s10x_add(1);
END $$;

SELECT 'STAGE10 RACE TESTS PASSED (' ||
       coalesce(nullif(current_setting('s10x.passed', true), ''), '0')::int || ')' AS result;
