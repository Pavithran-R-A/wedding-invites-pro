-- Stage 10 race tier, arm 2 assertions. One committed transaction, run after the session pair
-- `74_race_a2_first.sql` / `75_race_b2_second.sql` has finished and marker-gated by the shell.
--
-- The pair delivered ONE provider event identity twice, concurrently, against w2's frozen quote. The
-- measured probe result this file pins as a contract: the database serialises the collision, the
-- loser is answered by a raw 23505 on `commerce_attempts_payment_ref_uk` (NOT a graceful disposition
-- — the §19 sharp edge: a gateway would see a 500 and the provider's retry is what converges), and
-- the final state carries exactly one of everything. No double grant, no lost evidence, no second
-- attempt row. Cells RB01..RB06 measure that state; RB00 measures the collision was real — if a future
-- repair turns the first clash into a graceful `already_recorded`, that is a contract change and
-- RB00's alarm is where it should surface.
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

-- RB00 the collision was genuine, re-proved as a state machine fact: replay this exact identity now,
-- fully serialised, and the idempotency pre-read answers `already_recorded` while echoing the
-- ORIGINAL applied effect — no second application, no new row (counted by RB01). A delivery that had
-- never actually collided cannot produce this answer either.
SELECT pg_temp.s10x_eq('RB00 serialised replay of the contested identity',
  (SELECT q.v ->> 'disposition' || '/' || coalesce(q.v ->> 'applied_effect', '(none)') FROM
     (SELECT internal_api.record_commerce_event(
        'razorpay', 'r-conc-2', 'payment.candidate.payment_captured', 'payment_captured', 'synthetic',
        repeat('ef', 32), true, NULL,
        (SELECT o.merchant_reference FROM private.commerce_orders o
          WHERE o.wedding_id = '0a0a0a00-0000-4000-8000-000000000002'),
        499900, 'INR', 'po_conc2', 'pay_conc2', now(),
        '0a0a0a00-0000-4000-8000-000000000101'::uuid) AS v) q),
  'already_recorded/entitlement_granted');

SELECT pg_temp.s10x_eq('RB01 exactly one ledger row for the contested identity',
  (SELECT count(*)::text FROM private.commerce_payment_events WHERE event_id = 'r-conc-2'), '1');

-- RB02 one causal head — the redelivery chain's partial unique forbids a second, and a duplicate-capture
-- that had been recorded as a supersession would show as two rows here, not one head.
SELECT pg_temp.s10x_eq('RB02 exactly one head row (supersedes_event_row_id IS NULL)',
  (SELECT count(*)::text FROM private.commerce_payment_events
    WHERE event_id = 'r-conc-2' AND supersedes_event_row_id IS NULL), '1');

-- The ledger's own word for "this row moved money" is `processing_status = 'applied'` alongside a
-- non-null `applied_effect` (the schema CHECK pairs them); there is no boolean `applied` column, so an
-- assertion that reads one is a 42703, measured here once before it was corrected.
SELECT pg_temp.s10x_eq('RB03 the applied row is the winner: applied, with the capture effect',
  (SELECT count(*)::text FROM private.commerce_payment_events
    WHERE event_id = 'r-conc-2' AND processing_status = 'applied'
      AND applied_effect = 'entitlement_granted'), '1');

-- RB04 one payment attempt row carries the provider payment ref — the unique index that took the hit
-- holds exactly one row for it.
SELECT pg_temp.s10x_eq('RB04 exactly one attempt row for the payment ref',
  (SELECT count(*)::text FROM private.commerce_payment_attempts
    WHERE provider = 'razorpay' AND provider_payment_ref = 'pay_conc2'), '1');

-- RB05 the order: captured, with its capture timestamp written once.
SELECT pg_temp.s10x_eq('RB05 w2 order state after the collision',
  (SELECT o.status || '/' || (o.captured_at IS NOT NULL)::text FROM private.commerce_orders o
    WHERE o.wedding_id = '0a0a0a00-0000-4000-8000-000000000002'),
  'captured/true');

-- RB06 the money side: one entitlement and one grant audit line for w2 — the effect applied exactly
-- once across two concurrent deliveries and a third serialised replay.
SELECT pg_temp.s10x_eq('RB06 one entitlement and one grant audit for w2',
  (SELECT (SELECT count(*) FROM public.entitlements
             WHERE wedding_id = '0a0a0a00-0000-4000-8000-000000000002')::text || '/' ||
         (SELECT count(*) FROM private.audit_events
             WHERE action = 'granted_by_commerce_capture'
               AND wedding_id = '0a0a0a00-0000-4000-8000-000000000002')::text),
  '1/1');

DO $$
DECLARE n int := coalesce(nullif(current_setting('s10x.passed', true), ''), '0')::int;
BEGIN
  IF n < 7 THEN
    RAISE EXCEPTION 'FAIL RB07 floor — arm 2 printed % cells, expected at least 7', n;
  END IF;
  RAISE NOTICE 'PASS RB07 floor';
  PERFORM pg_temp.s10x_add(1);
END $$;

SELECT 'STAGE10 RACE TESTS PASSED (' ||
       coalesce(nullif(current_setting('s10x.passed', true), ''), '0')::int || ')' AS result;
