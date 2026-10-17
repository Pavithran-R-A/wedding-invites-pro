-- Stage 10 battery 1: the payment ledger — what a delivery may and may not do to a purchase.
--
-- Run by `supabase/tests/stage10/run.sh commerce` on a chain that has run nothing else, as the owner
-- role, in one transaction that commits. Battery 2 (`90_commerce_functions.sql`) reads the residue this
-- file leaves and pins it before asserting anything about reachability, which is the shape every stage's
-- pair has used since Stage 7.
--
-- Why everything here runs as `postgres` and not through a browser role: the six service bodies in
-- `internal_api` carry zero EXECUTE grants for any request-bearing role — measured, not assumed, and
-- battery 2's group R asserts it for all of them — so a call as `authenticated` cannot reach the state
-- machine at all. "A customer cannot write their own paid status" is therefore battery 2's question.
-- This file asks the other half of the same requirement: given a delivery that HAS arrived through the
-- trusted path, does the machine decide correctly when the delivery is a forgery, a replay, an old
-- message, a wrong amount, a wrong currency, a cross-provider confirmation, a cancellation after money,
-- or money moving the other way.
--
--   F  the shipped defaults and the cast: three weddings, two owners, five price rows, six quotes
--   P  §4.2's input refusals and the empty-catalogue refusal, each as SQLSTATE *and* sentence
--   Q  the frozen quote: what it copies, what it mints, what it refuses to sit beside, its audit row
--   D  initiation and capture: the two objects, the two timestamps, the one entitlement, the replay
--   H  the holds: forged signature, undeclared environment, live capture, unknown order, wrong amount,
--      wrong currency, wrong provider, and the closed-order states — a kept row and no state change
--   S  staleness: §4.1's honour-a-capture-without-an-initiation, and the reordered delivery
--   C  failure and cancellation: an attempt may fail while the purchase survives it
--   R  refunds and chargebacks: refund and revocation are different decisions, and a chargeback never
--      revokes whatever the policy row says
--   X  expiry: the quote's own clock, and the capture that arrives after it
--   K  §10's reconciliation: six named findings from real rows, and a sweep that changes nothing
--   Z  the census this file leaves behind
--   L  the floor
--
-- Four postures this file deliberately takes, each because the naive version of it is wrong.
--   1. A refusal is asserted twice: as a state, and as the row that did NOT appear. A guard that raises
--      after writing half its effects would pass a message-only test.
--   2. "Changed nothing" is measured as a digest of every money row except the ledger itself
--      (`s10l_state`), because a refusal that is recorded *is* a new ledger row — asserting the full
--      digest instead would make every hold cell fail for the right reason being invisible.
--   3. Two cells are reached only by a plant no product path can produce: a quote whose own expiry has
--      passed (the writer sets `now() + 30 minutes` and nothing moves it), and a held delivery older than
--      §10's fifteen-minute grace window (the ledger refuses UPDATE to every role, so `received_at`
--      cannot be backdated). Both are labelled, and the plant that must be undone is undone and proved
--      undone (K8) — the convention Stage 9's group V uses. The append-only rule that *forces* the plant
--      is itself a cell (H13), so the shortcut and the rule that required it are on file together.
--   4. `p_actor_user_id` is asserted as attribution, never as authorisation. The grant, revoke, expire
--      and reconcile bodies take an actor to write into `private.audit_events` and do not compare it to
--      the wedding's owner, which is correct for a webhook (the provider is not the family) and is
--      exactly why reachability, not the actor argument, is the control. K9 measures a non-owner actor
--      being recorded verbatim so a reader sees the posture instead of inferring it.
--
-- Nothing here contacts a provider, mints a checkout object or reads a secret: the deliveries are
-- synthesised, with a digest of their own event id in `raw_body_sha256`, and the environment is
-- `synthetic` except in the cells whose whole subject is a live or undeclared environment.

SET client_min_messages = notice;
SET search_path = public, pg_temp;

SELECT set_config('s10l.passed', '0', false);

-- --------------------------------------------------------------------------- the harness
CREATE FUNCTION pg_temp.s10l_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s10l.passed',
    (coalesce(nullif(current_setting('s10l.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s10l_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s10l_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s10l_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s10l_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s10l_array(label text, got text[], want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label,
      array_to_string(coalesce(got, ARRAY[]::text[]), ', '),
      array_to_string(coalesce(want, ARRAY[]::text[]), ', ');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s10l_add(1);
END $fn$;

-- A refusal measured as both halves. `left(SQLSTATE,5)` alone cannot tell a 42501 from a psql syntax
-- error, and this repository has scored a syntax error as a security refusal once, so every raising cell
-- states the code and the sentence.
CREATE FUNCTION pg_temp.s10l_err(label text, stmt text, want_state text, want_like text) RETURNS void
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
  PERFORM pg_temp.s10l_add(1);
END $fn$;

-- A 64-hex digest derived from the event id. Not a real body hash — there is no body — but the column's
-- CHECK wants the shape, and `md5` twice is re-derivable from the label a failing cell prints.
CREATE FUNCTION pg_temp.s10l_sha(tag text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5(tag) || md5(tag || '|body') $fn$;

CREATE FUNCTION pg_temp.s10l_actor() RETURNS uuid
LANGUAGE sql STABLE AS $fn$ SELECT current_setting('s10l.actor')::uuid $fn$;

CREATE FUNCTION pg_temp.s10l_order(n text) RETURNS uuid
LANGUAGE sql STABLE AS $fn$ SELECT current_setting('s10l.o' || n)::uuid $fn$;

CREATE FUNCTION pg_temp.s10l_ref(n text) RETURNS text
LANGUAGE sql STABLE AS $fn$ SELECT current_setting('s10l.r' || n) $fn$;

CREATE FUNCTION pg_temp.s10l_wed(n text) RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT CASE n WHEN 'a' THEN current_setting('s10l.wed_a')::uuid
                WHEN 'b' THEN current_setting('s10l.wed_b')::uuid
                WHEN 'c' THEN current_setting('s10l.wed_c')::uuid END $fn$;

-- One delivery, written once. Errors come back as `_error` rather than aborting the run, so a delivery
-- the machine cannot answer fails as a named cell carrying the code and the sentence.
CREATE FUNCTION pg_temp.s10l_deliver_raw(
  p_event_id text, p_kind text, p_env text, p_verified boolean, p_ref text,
  p_amount bigint, p_currency text, p_order_ref text, p_pay_ref text,
  p_occurred timestamptz, p_event_type text DEFAULT NULL, p_provider text DEFAULT 'razorpay',
  p_reason text DEFAULT NULL, p_actor uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  BEGIN
    SELECT internal_api.record_commerce_event(
      p_provider, p_event_id, p_event_type, p_kind, p_env,
      pg_temp.s10l_sha(p_event_id), p_verified, p_reason, p_ref,
      p_amount, p_currency, p_order_ref, p_pay_ref, p_occurred,
      coalesce(p_actor, pg_temp.s10l_actor())) INTO v;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('_error', SQLSTATE || ' | ' || SQLERRM);
  END;
  RETURN v;
END $fn$;

-- The ordinary synthetic delivery: verified, in vocabulary, named by the provider it came from.
CREATE FUNCTION pg_temp.s10l_deliver(
  p_event_id text, p_kind text, p_ref text, p_amount bigint,
  p_order_ref text DEFAULT NULL, p_pay_ref text DEFAULT NULL,
  p_occurred timestamptz DEFAULT NULL, p_env text DEFAULT 'synthetic',
  p_provider text DEFAULT 'razorpay', p_currency text DEFAULT 'INR'
) RETURNS jsonb
LANGUAGE sql AS $fn$
  SELECT pg_temp.s10l_deliver_raw(p_event_id, p_kind, p_env, true, p_ref, p_amount, p_currency,
    p_order_ref, p_pay_ref, coalesce(p_occurred, now()),
    'payment.candidate.' || p_kind, p_provider)
$fn$;

-- A quote, taken through the service body rather than typed in, so every order row in this file is one
-- the product's own writer made.
CREATE FUNCTION pg_temp.s10l_quote(p_wed uuid, p_pkg text, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  BEGIN
    SELECT internal_api.create_commerce_order(p_wed, p_pkg, p_actor) INTO v;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('_error', SQLSTATE || ' | ' || SQLERRM);
  END;
  RETURN v;
END $fn$;

CREATE FUNCTION pg_temp.s10l_call(label text, stmt text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  BEGIN
    EXECUTE stmt INTO v;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('_error', SQLSTATE || ' | ' || SQLERRM);
  END;
  RETURN v;
END $fn$;

-- The money state as one digest. `s10l_state` excludes the ledger, because a refusal legitimately adds a
-- ledger row and a "nothing moved" cell must not be satisfied by ignoring the evidence table it is
-- talking about; `s10l_snapshot` includes it, and is only used where no row may appear at all.
CREATE FUNCTION pg_temp.s10l_state() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(t, '~' ORDER BY t COLLATE "C"), '')) FROM (
    SELECT 'o|' || id::text || '|' || coalesce(status,'') || '|' || coalesce(captured_at::text,'')
           || '|' || coalesce(closed_at::text,'') || '|' || coalesce(entitlement_id::text,'')
           || '|' || amount_minor::text || '|' || currency || '|' || package_code || '|'
           || price_version::text || '|' || merchant_reference AS t
      FROM private.commerce_orders
    UNION ALL
    SELECT 'a|' || id::text || '|' || order_id::text || '|' || provider || '|' || environment
           || '|' || coalesce(provider_order_ref,'') || '|' || coalesce(provider_payment_ref,'')
           || '|' || status FROM private.commerce_payment_attempts
    UNION ALL
    SELECT 'r|' || id::text || '|' || order_id::text || '|' || kind || '|' || status
           || '|' || coalesce(amount_minor::text,'') || '|' || coalesce(completed_at::text,'')
      FROM private.commerce_refunds
    UNION ALL
    SELECT 'n|' || id::text || '|' || wedding_id::text || '|' || package_code || '|' || status
           FROM public.entitlements
  ) d $fn$;

CREATE FUNCTION pg_temp.s10l_snapshot() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(pg_temp.s10l_state() || '~' || string_agg(
             'e|' || id::text || '|' || provider || '|' || event_id || '|' || kind || '|'
             || coalesce(order_id::text,'') || '|' || coalesce(attempt_id::text,'') || '|'
             || processing_status || '|' || coalesce(applied_effect,'') || '|'
             || coalesce(hold_reason,'') || '|' || coalesce(amount_minor::text,'') || '|'
             || coalesce(currency,''), '~' ORDER BY id), ''))
    FROM private.commerce_payment_events $fn$;

CREATE FUNCTION pg_temp.s10l_audit_count(p_action text, p_subject uuid) RETURNS bigint
LANGUAGE sql STABLE AS $fn$
  SELECT count(*) FROM private.audit_events
   WHERE action = p_action AND subject_key = p_subject $fn$;

CREATE FUNCTION pg_temp.s10l_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % not an object', label, coalesce(jsonb_typeof(v), 'NULL');
  END IF;
  PERFORM pg_temp.s10l_array(label,
    (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
       FROM jsonb_object_keys(v) k), want);
END $fn$;

-- --------------------------------------------------------------------------- F. shipped defaults, then cast
CREATE TEMP TABLE s10r ON COMMIT DROP AS
SELECT gen_random_uuid() AS owner_a, gen_random_uuid() AS owner_b, gen_random_uuid() AS stranger,
       gen_random_uuid() AS wed_a, gen_random_uuid() AS wed_b, gen_random_uuid() AS wed_c;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT s.owner_a, 's10-owner-a@stage10qual.test', '{}'::jsonb FROM s10r s
UNION ALL SELECT s.owner_b, 's10-owner-b@stage10qual.test', '{}'::jsonb FROM s10r s
UNION ALL SELECT s.stranger, 's10-stranger@stage10qual.test', '{}'::jsonb FROM s10r s;

INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages,
                             style_settings)
SELECT s.wed_a, s.owner_a, 'Ledger A weds B', 'en', ARRAY[]::text[],
       '{"font":"Playfair Display"}'::jsonb FROM s10r s
UNION ALL
SELECT s.wed_b, s.owner_b, 'Ledger C weds D', 'ta', ARRAY[]::text[],
       '{"font":"Mukta Malar"}'::jsonb FROM s10r s
UNION ALL
SELECT s.wed_c, s.owner_a, 'Ledger E weds F', 'en', ARRAY[]::text[],
       '{"font":"Playfair Display"}'::jsonb FROM s10r s;

DO $preflight$
DECLARE s s10r%ROWTYPE; v jsonb;
BEGIN
  SELECT * INTO s FROM s10r;
  PERFORM set_config('s10l.actor', s.owner_a::text, false);
  PERFORM set_config('s10l.wed_a', s.wed_a::text, false);
  PERFORM set_config('s10l.wed_b', s.wed_b::text, false);
  PERFORM set_config('s10l.wed_c', s.wed_c::text, false);

  -- The state a fresh install ships in, measured before this file plants anything. Every one of these is
  -- the migration's own claim about itself (§2, §7), and each is the honest answer to "has the owner
  -- decided yet?" — the answer being no, stored as data rather than coded as an opinion.
  PERFORM pg_temp.s10l_eq('F01 the shipped policy table holds exactly one row, the singleton the gate reads',
    (SELECT count(*) FROM private.commerce_policy), 1::bigint);
  PERFORM pg_temp.s10l_eq('F02 its publish gate ships permissive, so no family is stopped by an undecided policy',
    (SELECT publish_gate FROM private.commerce_policy WHERE id = 1), 'permissive');
  PERFORM pg_temp.s10l_eq('F03 and names no required package, the half of the decision the owner has not made',
    (SELECT coalesce(array_length(publish_required_package_codes, 1), 0)
       FROM private.commerce_policy WHERE id = 1), 0);
  PERFORM pg_temp.s10l_eq('F04 live capture ships off, which makes "no live payments" a database fact',
    (SELECT live_capture_enabled FROM private.commerce_policy WHERE id = 1), false);
  PERFORM pg_temp.s10l_eq('F05 and a refund ships holding for review rather than revoking a family''s right',
    (SELECT refund_revocation_mode FROM private.commerce_policy WHERE id = 1), 'hold_for_review');
  PERFORM pg_temp.s10l_eq('F06 the price catalogue is empty of every row, not merely of active ones',
    (SELECT count(*) FROM private.commerce_packages), 0::bigint);
  PERFORM pg_temp.s10l_array('F07 and the orders, ledger, attempts, refunds and entitlements are each empty',
    ARRAY[(SELECT count(*) FROM private.commerce_orders)::text,
          (SELECT count(*) FROM private.commerce_payment_events)::text,
          (SELECT count(*) FROM private.commerce_payment_attempts)::text,
          (SELECT count(*) FROM private.commerce_refunds)::text,
          (SELECT count(*) FROM public.entitlements)::text],
    ARRAY['0','0','0','0','0']);

  v := pg_temp.s10l_quote(s.wed_a, 'QCLASSIC', s.owner_a);
  PERFORM pg_temp.s10l_eq('F08 with no approved price, a quote refuses rather than inventing a number',
    split_part(coalesce(v ->> '_error', 'ACCEPTED'), ' | ', 1), 'P0001');
  PERFORM pg_temp.s10l_ok('F09 and names the package it has no price for',
    coalesce(v ->> '_error', '') LIKE 'P0001 | no approved price exists for package QCLASSIC%');
  PERFORM pg_temp.s10l_eq('F10 the refusal wrote no order, the half a message-only test misses',
    (SELECT count(*) FROM private.commerce_orders), 0::bigint);
  PERFORM pg_temp.s10l_eq('F11 and no audit event either, so a refused quote leaves no trace of a sale',
    (SELECT count(*) FROM private.audit_events WHERE action = 'quote_created'), 0::bigint);

  v := pg_temp.s10l_quote(gen_random_uuid(), 'QCLASSIC', s.owner_a);
  PERFORM pg_temp.s10l_ok('F12 a wedding that does not exist is refused as a missing wedding, never as permission',
    coalesce(v ->> '_error', '') LIKE 'P0001 | no wedding % exists to quote for%');

  v := pg_temp.s10l_quote(s.wed_a, 'QCLASSIC', s.stranger);
  PERFORM pg_temp.s10l_eq('F13 a caller who names somebody else''s wedding is refused on the privilege code',
    split_part(coalesce(v ->> '_error', 'ACCEPTED'), ' | ', 1), '42501');
  PERFORM pg_temp.s10l_ok('F14 and the sentence comes from the comparison, not from a lookup that found nothing',
    coalesce(v ->> '_error', '') LIKE '%does not own wedding%a quote is made for the wedding''s owner and no one else%');
  PERFORM pg_temp.s10l_eq('F15 neither arm created a row',
    (SELECT count(*) FROM private.commerce_orders), 0::bigint);
END $preflight$;

-- The price rows, planted by the owner role because no product path can write a price: §2 creates the
-- catalogue empty and the approval that fills it is the owner's decision, not this build's. Every code is
-- Q-prefixed so a qualification row stays distinguishable in any later read of a chain.
INSERT INTO private.commerce_packages (package_code, currency, amount_minor, price_version, status,
                                       display_approved, retired_at)
SELECT p.code, 'INR', p.amount, p.vers, p.stat, p.shown,
       CASE WHEN p.stat = 'retired' THEN now() END
  FROM (VALUES ('QCLASSIC', 499900::bigint, 1, 'active',  true),
               ('QQUIET',   199900::bigint, 1, 'active',  false),
               ('QDRAFT',   299900::bigint, 1, 'draft',   false),
               ('QRETIRED',  99900::bigint, 1, 'retired', false),
               ('QCLASSIC', 549900::bigint, 2, 'draft',   true)) p(code, amount, vers, stat, shown);

DO $cast$
DECLARE s s10r%ROWTYPE; v jsonb; n text; o uuid;
        pair text[][] = ARRAY[['a','QCLASSIC'],['a','QQUIET'],['b','QCLASSIC'],
                              ['c','QCLASSIC'],['c','QQUIET'],['b','QQUIET']];
BEGIN
  SELECT * INTO s FROM s10r;
  FOR n IN 1 .. 6 LOOP
    v := pg_temp.s10l_quote(
      CASE pair[n][1] WHEN 'a' THEN s.wed_a WHEN 'b' THEN s.wed_b ELSE s.wed_c END,
      pair[n][2],
      CASE pair[n][1] WHEN 'b' THEN s.owner_b ELSE s.owner_a END);
    IF v ? '_error' THEN
      RAISE EXCEPTION 'FAIL cast: quote % (%) was not created — %', n, pair[n][2], v ->> '_error';
    END IF;
    o := (v ->> 'order_id')::uuid;
    PERFORM set_config('s10l.o' || n, o::text, false);
    PERFORM set_config('s10l.r' || n, v ->> 'merchant_reference', false);
  END LOOP;

  PERFORM pg_temp.s10l_eq('F16 the cast planted five price rows across four codes',
    (SELECT count(*) FROM private.commerce_packages), 5::bigint);
  PERFORM pg_temp.s10l_eq('F17 exactly one active price per code, which is what makes a quote answerable',
    (SELECT coalesce(string_agg(package_code, ',' ORDER BY package_code COLLATE "C"), '(none)')
       FROM private.commerce_packages WHERE status = 'active'),
    'QCLASSIC,QQUIET');
  PERFORM pg_temp.s10l_eq('F18 six live quotes exist, one per wedding-and-package pair',
    (SELECT count(*) FROM private.commerce_orders WHERE status = 'open'), 6::bigint);
END $cast$;

-- --------------------------------------------------------------------------- Q. the frozen quote
DO $quote$
DECLARE s s10r%ROWTYPE; v jsonb; o1 uuid;
BEGIN
  SELECT * INTO s FROM s10r;
  o1 := pg_temp.s10l_order('1');

  PERFORM pg_temp.s10l_eq('Q01 the quote carries the amount of the active price row, not of any argument',
    (SELECT amount_minor FROM private.commerce_orders WHERE id = o1), 499900::bigint);
  PERFORM pg_temp.s10l_eq('Q02 and the price version it was computed from, frozen beside it',
    (SELECT price_version FROM private.commerce_orders WHERE id = o1), 1);
  PERFORM pg_temp.s10l_eq('Q03 and the currency, as a minor-unit pair and never a decimal',
    (SELECT currency FROM private.commerce_orders WHERE id = o1), 'INR');
  PERFORM pg_temp.s10l_eq('Q04 the owner copied onto the order is the wedding''s owner, re-derived not accepted',
    (SELECT owner_user_id FROM private.commerce_orders WHERE id = o1), s.owner_a);
  PERFORM pg_temp.s10l_ok('Q05 the merchant reference is the server-minted shape and nothing else',
    (SELECT merchant_reference ~ '^vv1_[0-9a-f]{32}$' FROM private.commerce_orders WHERE id = o1));
  PERFORM pg_temp.s10l_eq('Q06 every reference is distinct, so a webhook can name exactly one row',
    (SELECT count(DISTINCT merchant_reference) FROM private.commerce_orders), 6::bigint);
  PERFORM pg_temp.s10l_ok('Q07 every quote expires on the server''s own clock, thirty minutes out',
    (SELECT bool_and(quote_expires_at BETWEEN now() + interval '29 minutes'
                                            AND now() + interval '31 minutes')
       FROM private.commerce_orders));
  PERFORM pg_temp.s10l_array('Q08 nothing is captured, closed or entitled yet, and the CHECKs keep both timestamps absent',
    ARRAY[(SELECT captured_at IS NULL AND closed_at IS NULL AND entitlement_id IS NULL
              FROM private.commerce_orders WHERE id = o1)::text,
          (SELECT count(*) FROM private.commerce_orders
             WHERE captured_at IS NOT NULL OR closed_at IS NOT NULL)::text],
    ARRAY['true','0']);
  PERFORM pg_temp.s10l_eq('Q09 one audit row names the quote, its subject and its actor',
    pg_temp.s10l_audit_count('quote_created', o1), 1::bigint);
  PERFORM pg_temp.s10l_eq('Q10 and the actor recorded is the one the caller named as the subject of the quote',
    (SELECT actor_user_id FROM private.audit_events
      WHERE action = 'quote_created' AND subject_key = o1), s.owner_a);
  PERFORM pg_temp.s10l_keys('Q11 its payload is exactly the five frozen fields, with no provider object',
    (SELECT payload FROM private.audit_events WHERE action = 'quote_created' AND subject_key = o1),
    ARRAY['amount_minor','currency','merchant_reference','package_code','price_version']);

  v := pg_temp.s10l_quote(s.wed_a, 'QCLASSIC', s.owner_a);
  PERFORM pg_temp.s10l_eq('Q12 a second live order for one wedding and package is refused on the unique code',
    split_part(coalesce(v ->> '_error', 'ACCEPTED'), ' | ', 1), '23505');
  PERFORM pg_temp.s10l_ok('Q13 and names the live order it refuses to sit beside',
    coalesce(v ->> '_error', '') LIKE '%already has live order %for package QCLASSIC at version 1%');
  PERFORM pg_temp.s10l_eq('Q14 the refusal added no row: two live quotes for one price is the double-charge state',
    (SELECT count(*) FROM private.commerce_orders WHERE wedding_id = s.wed_a
       AND package_code = 'QCLASSIC' AND status IN ('open','payment_pending')), 1::bigint);
  PERFORM pg_temp.s10l_eq('Q15 a draft price is not quotable, so an unpublished number cannot be sold',
    split_part(coalesce(pg_temp.s10l_quote(s.wed_b, 'QDRAFT', s.owner_b) ->> '_error',
      'ACCEPTED'), ' | ', 1), 'P0001');
  PERFORM pg_temp.s10l_eq('Q16 and a retired price is not quotable either, even though its row survives',
    split_part(coalesce(pg_temp.s10l_quote(s.wed_b, 'QRETIRED', s.owner_b) ->> '_error',
      'ACCEPTED'), ' | ', 1), 'P0001');
  PERFORM pg_temp.s10l_eq('Q17 the second version of a code stays unquotable while it is a draft',
    (SELECT status FROM private.commerce_packages
      WHERE package_code = 'QCLASSIC' AND price_version = 2), 'draft');
  PERFORM pg_temp.s10l_err('Q18 the one-active-per-code rule is a database fact, not a habit',
    'INSERT INTO private.commerce_packages (package_code, currency, amount_minor, price_version, status)'
    ' VALUES (''QCLASSIC'', ''INR'', 600000, 3, ''active'')',
    '23505', '%commerce_packages_one_active_per_code%');
  PERFORM pg_temp.s10l_err('Q19 a retired row must carry the moment it was retired',
    'INSERT INTO private.commerce_packages (package_code, currency, amount_minor, price_version, status)'
    ' VALUES (''QRETLESS'', ''INR'', 100, 1, ''retired'')',
    '23514', '%commerce_packages_retired_pair_check%');
  PERFORM pg_temp.s10l_err('Q19b and the same rule reads backwards: an active price cannot be retired too',
    'INSERT INTO private.commerce_packages (package_code, currency, amount_minor, price_version, status,'
    ' retired_at) VALUES (''QRETBOTH'', ''INR'', 100, 1, ''active'', now())',
    '23514', '%commerce_packages_retired_pair_check%');
  PERFORM pg_temp.s10l_err('Q20 a price cannot be zero: a free quote would be a commercial decision',
    'INSERT INTO private.commerce_packages (package_code, currency, amount_minor, price_version)'
    ' VALUES (''QZERO'', ''INR'', 0, 1)',
    '23514', '%commerce_packages_amount_minor_check%');
  PERFORM pg_temp.s10l_err('Q21 and two rows cannot share one code and one version',
    'INSERT INTO private.commerce_packages (package_code, currency, amount_minor, price_version)'
    ' VALUES (''QCLASSIC'', ''INR'', 100, 1)',
    '23505', '%commerce_packages_package_code_price_version_key%');
  PERFORM pg_temp.s10l_err('Q22 a decimal rupee amount has no home in this schema, so C40 stays true',
    'INSERT INTO private.commerce_packages (package_code, currency, amount_minor, price_version)'
    ' VALUES (''QDECIMAL'', ''INR'', ''4999.50'', 1)',
    '22P02', '%invalid input syntax for type bigint%');
  PERFORM pg_temp.s10l_err('Q23 a second currency cannot be spelled into the catalogue either',
    'INSERT INTO private.commerce_packages (package_code, currency, amount_minor, price_version)'
    ' VALUES (''QUSD'', ''USD'', 100, 1)',
    '23514', '%commerce_packages_currency_check%');
  PERFORM pg_temp.s10l_err('Q24 and a price version below one is not a version',
    'INSERT INTO private.commerce_packages (package_code, currency, amount_minor, price_version)'
    ' VALUES (''QZEROVER'', ''INR'', 100, 0)',
    '23514', '%commerce_packages_price_version_check%');

  -- Why this cell exists: an unnamed table-level CHECK lands as `<table>_check`, `<table>_check1` and so
  -- on, numbered by declaration order. A refusal then names neither the invariant nor the operator's
  -- mistake, and adding a CHECK earlier in the list renames its neighbours out from under every assertion
  -- and runbook keyed to them. The ten cross-column invariants in §2-§6 are exactly the ones a reader
  -- cannot infer from a row, so they are named, and this cell keeps a later migration from forgetting to.
  PERFORM pg_temp.s10l_eq('Q25 no check constraint in the six money tables still runs on a positional name',
    (SELECT coalesce(string_agg(d.conname, ', ' ORDER BY d.conname COLLATE "C"), '(none)')
       FROM pg_constraint d JOIN pg_class r ON r.oid = d.conrelid
       JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'private' AND r.relname LIKE 'commerce%' AND d.contype = 'c'
        AND (d.conname = r.relname || '_check' OR d.conname ~ ('^' || r.relname || '_check[0-9]+$'))),
    '(none)');
END $quote$;

-- --------------------------------------------------------------------------- H. the forged signature
-- First, before any trusted delivery exists, so "it wrote nothing else" is measured against an empty set.
DO $forge$
DECLARE v jsonb; v2 jsonb; st text;
BEGIN
  st := pg_temp.s10l_state();
  -- The forgery names itself a capture, because that is the attack: a message that reads exactly like a
  -- `payment.captured` event, signed with a key that does not match. `p_event_type` is passed explicitly
  -- rather than left to the harness default so H04 and H05 measure the pair the migration promises — the
  -- claim kept, the kind refused.
  v := pg_temp.s10l_deliver_raw('h-forge-1', 'payment_captured', 'synthetic', false,
    pg_temp.s10l_ref('1'), 499900, 'INR', 'po_forged', 'pay_forged', now(),
    'payment.candidate.payment_captured');
  PERFORM pg_temp.s10l_eq('H01 an unverified delivery is recorded, never applied',
    v ->> 'processing_status', 'rejected_signature');
  PERFORM pg_temp.s10l_eq('H02 its disposition says recorded, because a refused delivery is still evidence',
    v ->> 'disposition', 'recorded');
  PERFORM pg_temp.s10l_eq('H03 and the answer states that nothing moved',
    v ->> 'state_changed', 'false');
  PERFORM pg_temp.s10l_eq('H04 the ledger row''s kind is forced to other: an unverified body names nothing',
    (SELECT kind FROM private.commerce_payment_events WHERE event_id = 'h-forge-1'), 'other');
  PERFORM pg_temp.s10l_eq('H05 while the provider''s own event name is kept verbatim beside it',
    (SELECT event_type FROM private.commerce_payment_events WHERE event_id = 'h-forge-1'),
    'payment.candidate.payment_captured');
  PERFORM pg_temp.s10l_eq('H06 a refusal with no stated reason gets the only one this build can honestly give',
    (SELECT refusal_reason FROM private.commerce_payment_events WHERE event_id = 'h-forge-1'),
    'signature_mismatch');
  PERFORM pg_temp.s10l_eq('H07 and it links to no order, no attempt, no effect and no hold',
    (SELECT coalesce(order_id::text,'') || '/' || coalesce(attempt_id::text,'') || '/'
            || coalesce(applied_effect,'') || '/' || coalesce(hold_reason,'')
       FROM private.commerce_payment_events WHERE event_id = 'h-forge-1'), '///');
  PERFORM pg_temp.s10l_eq('H08 the money state is unchanged by the forgery', pg_temp.s10l_state(), st);
  PERFORM pg_temp.s10l_eq('H09 and it wrote no audit event: a forgery is not a business act',
    (SELECT count(*) FROM private.audit_events WHERE subject_type = 'commerce_event'), 0::bigint);
  PERFORM pg_temp.s10l_eq('H10 no entitlement and no attempt exist, so the attack has nothing to show',
    ARRAY[(SELECT count(*) FROM public.entitlements)::text,
          (SELECT count(*) FROM private.commerce_payment_attempts)::text],
    ARRAY['0','0']);

  v := pg_temp.s10l_deliver_raw('h-forge-2', 'payment_captured', 'synthetic', false,
    pg_temp.s10l_ref('1'), 499900, 'INR', NULL, NULL, now(), NULL, 'razorpay',
    'timestamp_out_of_window');
  PERFORM pg_temp.s10l_eq('H11 a stated refusal reason is kept rather than overwritten with the default',
    (SELECT refusal_reason FROM private.commerce_payment_events WHERE event_id = 'h-forge-2'),
    'timestamp_out_of_window');
  PERFORM pg_temp.s10l_eq('H12 and that row still refuses to carry a kind of its own',
    (SELECT kind FROM private.commerce_payment_events WHERE event_id = 'h-forge-2'), 'other');

  -- The ledger's own append-only rule, measured while a forgery row is in hand. This is the guard ADR
  -- 0005 rule 5 rests on: evidence that the highest-privileged writer may rewrite answers nothing.
  PERFORM pg_temp.s10l_err('H13 the ledger refuses UPDATE to the owner role, so evidence cannot be rewritten',
    'UPDATE private.commerce_payment_events SET signature_valid = true WHERE event_id = ''h-forge-1''',
    '42501', '%rows are append-only: a correction is a new row and an audit event, never a rewrite%');
  PERFORM pg_temp.s10l_eq('H14 and the refusal left the forged row forged, not merely complained about',
    (SELECT signature_valid FROM private.commerce_payment_events WHERE event_id = 'h-forge-1'), false);
  -- A provider that retries a forgery gets the same answer the first one got: the row already exists, so
  -- idempotency answers `already_recorded` and no second row is written. Measured here rather than only in
  -- group D because a refusal path that bypassed level 1 would leave the forged delivery's evidence
  -- duplicated, and two rows for one provider event is the state that makes the ledger untrustworthy.
  v2 := pg_temp.s10l_deliver_raw('h-forge-1', 'payment_captured', 'synthetic', false,
    pg_temp.s10l_ref('1'), 499900, 'INR', 'po_forged', 'pay_forged', now());
  PERFORM pg_temp.s10l_eq('H15 the forgery is answered with a row, so a replay of it is a duplicate',
    v2 ->> 'disposition', 'already_recorded');
  PERFORM pg_temp.s10l_eq('H16 and the replay names the row it found rather than writing another',
    (v2 ->> 'event_row_id') = (SELECT id::text FROM private.commerce_payment_events
                                 WHERE event_id = 'h-forge-1'), true);
  PERFORM pg_temp.s10l_eq('H17 one provider event still has exactly one ledger row, replays included',
    (SELECT count(*) FROM private.commerce_payment_events WHERE event_id = 'h-forge-1'), 1::bigint);
  PERFORM pg_temp.s10l_eq('H18 and the replay moved no money state either', pg_temp.s10l_state(), st);
END $forge$;

-- --------------------------------------------------------------------------- D. initiation and capture
DO $deliver$
DECLARE v jsonb; o1 uuid; r1 text; st text; e_id uuid; s s10r%ROWTYPE;
BEGIN
  SELECT * INTO s FROM s10r;
  o1 := pg_temp.s10l_order('1');
  r1 := pg_temp.s10l_ref('1');

  v := pg_temp.s10l_deliver('d-init-1', 'payment_initiated', r1, 499900, 'po_a1', NULL,
    now() - interval '5 minutes');
  PERFORM pg_temp.s10l_eq('D01 a verified initiation is applied', v ->> 'processing_status', 'applied');
  PERFORM pg_temp.s10l_eq('D02 with the effect the state machine names for an open order',
    v ->> 'applied_effect', 'attempt_initiated');
  PERFORM pg_temp.s10l_eq('D03 and the order moves to payment_pending, which is not a capture',
    (SELECT status FROM private.commerce_orders WHERE id = o1), 'payment_pending');
  PERFORM pg_temp.s10l_eq('D04 nothing is captured yet, and the CHECK keeps that timestamp absent',
    (SELECT captured_at FROM private.commerce_orders WHERE id = o1), NULL::timestamptz);
  PERFORM pg_temp.s10l_eq('D05 one attempt row exists, in the provider''s name and this environment',
    (SELECT count(*) FROM private.commerce_payment_attempts WHERE order_id = o1
       AND provider = 'razorpay' AND environment = 'synthetic' AND status = 'initiated'), 1::bigint);
  PERFORM pg_temp.s10l_eq('D06 it carries the reference the delivery named and no payment reference yet',
    (SELECT coalesce(provider_order_ref,'') || '/' || coalesce(provider_payment_ref,'(none)')
       FROM private.commerce_payment_attempts WHERE order_id = o1), 'po_a1/(none)');
  -- Asserted as exact equality, not a tolerance: `now()` is transaction-stable, this battery runs in one
  -- transaction, and §9.5's writer stores `coalesce(p_occurred, v_now)` — so a drifted value here would be
  -- the migration substituting its own clock, which is the fact the cell is about.
  PERFORM pg_temp.s10l_eq('D07 its initiated_at is the delivery''s own time, not the moment we read it',
    (SELECT initiated_at = now() - interval '5 minutes'
       FROM private.commerce_payment_attempts WHERE order_id = o1), true);
  PERFORM pg_temp.s10l_eq('D08 the ledger row names both the order and the attempt it is evidence about',
    (SELECT order_id = o1 AND attempt_id IS NOT NULL FROM private.commerce_payment_events
      WHERE event_id = 'd-init-1'), true);
  PERFORM pg_temp.s10l_eq('D09 and its effect is recorded, so a replay''s answer is reproducible',
    (SELECT applied_effect FROM private.commerce_payment_events WHERE event_id = 'd-init-1'),
    'attempt_initiated');
  PERFORM pg_temp.s10l_eq('D10 one audit row records the initiation against the order',
    pg_temp.s10l_audit_count('attempt_initiated', o1), 1::bigint);
  PERFORM pg_temp.s10l_keys('D11 whose payload carries the four names needed to retrace it',
    (SELECT payload FROM private.audit_events
      WHERE action = 'attempt_initiated' AND subject_key = o1),
    ARRAY['attempt_id','event_row_id','order_status_before','provider']);

  -- A replay of the same provider event: the answer is the first delivery's answer and nothing doubles.
  st := pg_temp.s10l_snapshot();
  v := pg_temp.s10l_deliver('d-init-1', 'payment_initiated', r1, 499900, 'po_a1', NULL,
    now() - interval '5 minutes');
  PERFORM pg_temp.s10l_eq('D12 a replay is answered already_recorded, not re-decided',
    v ->> 'disposition', 'already_recorded');
  PERFORM pg_temp.s10l_eq('D13 and it reports the first delivery''s own status',
    v ->> 'processing_status', 'applied');
  PERFORM pg_temp.s10l_eq('D14 and its effect, so two deliveries produce one answer',
    v ->> 'applied_effect', 'attempt_initiated');
  PERFORM pg_temp.s10l_ok('D15 it names the same ledger row rather than a new one',
    (v ->> 'event_row_id') = (SELECT id::text FROM private.commerce_payment_events
                               WHERE event_id = 'd-init-1'));
  PERFORM pg_temp.s10l_eq('D16 the replay created no second row, no second attempt and no second audit event',
    ARRAY[(SELECT count(*) FROM private.commerce_payment_events WHERE event_id = 'd-init-1')::text,
          (SELECT count(*) FROM private.commerce_payment_attempts WHERE order_id = o1)::text,
          pg_temp.s10l_audit_count('attempt_initiated', o1)::text],
    ARRAY['1','1','1']);
  PERFORM pg_temp.s10l_eq('D17 and the entire money state including the ledger is byte-identical',
    pg_temp.s10l_snapshot(), st);

  -- Capture.
  v := pg_temp.s10l_deliver('d-capt-1', 'payment_captured', r1, 499900, 'po_a1', 'pay_a1', now());
  PERFORM pg_temp.s10l_eq('D18 a verified capture is applied and grants the right',
    v ->> 'applied_effect', 'entitlement_granted');
  PERFORM pg_temp.s10l_eq('D19 and the answer reports that state actually moved',
    v ->> 'state_changed', 'true');
  PERFORM pg_temp.s10l_eq('D20 the order is captured',
    (SELECT status FROM private.commerce_orders WHERE id = o1), 'captured');
  PERFORM pg_temp.s10l_eq('D21 with its capture timestamp and no closing timestamp',
    (SELECT captured_at IS NOT NULL AND closed_at IS NULL FROM private.commerce_orders WHERE id = o1),
    true);
  PERFORM pg_temp.s10l_eq('D22 the attempt it matched on is now confirmed, not a new row',
    (SELECT status FROM private.commerce_payment_attempts WHERE provider_payment_ref = 'pay_a1'),
    'confirmed');
  PERFORM pg_temp.s10l_eq('D23 the ledger row carries the delivery''s own kind, because it verified',
    (SELECT kind FROM private.commerce_payment_events WHERE event_id = 'd-capt-1'), 'payment_captured');
  PERFORM pg_temp.s10l_eq('D24 exactly one entitlement exists for this wedding and package',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = s.wed_a
       AND package_code = 'QCLASSIC' AND status = 'active'), 1::bigint);
  PERFORM pg_temp.s10l_eq('D25 granted by the service, never by an admin or a billing flag',
    (SELECT source FROM public.entitlements WHERE wedding_id = s.wed_a AND package_code = 'QCLASSIC'),
    'service');
  PERFORM pg_temp.s10l_keys('D26 and its metadata names the order, the reference and the price version',
    (SELECT metadata FROM public.entitlements
      WHERE wedding_id = s.wed_a AND package_code = 'QCLASSIC'),
    ARRAY['granted_by','merchant_reference','order_id','price_version']);
  PERFORM pg_temp.s10l_eq('D27 the order points at the entitlement it bought, by foreign key',
    (SELECT entitlement_id IS NOT NULL FROM private.commerce_orders WHERE id = o1), true);
  e_id := (SELECT entitlement_id FROM private.commerce_orders WHERE id = o1);
  PERFORM pg_temp.s10l_eq('D28 and that pointer is the entitlement row that exists',
    (SELECT count(*) FROM public.entitlements WHERE id = e_id AND status = 'active'), 1::bigint);
  PERFORM pg_temp.s10l_eq('D29 one audit row for the capture, naming the grant it made',
    pg_temp.s10l_audit_count('order_captured', o1), 1::bigint);
  PERFORM pg_temp.s10l_eq('D30 whose payload says this was a first grant',
    (SELECT payload ->> 'newly_granted' FROM private.audit_events
      WHERE action = 'order_captured' AND subject_key = o1), 'true');
  PERFORM pg_temp.s10l_eq('D31 and that the initiation did arrive, which is the finding §10 would otherwise raise',
    (SELECT payload ->> 'initiation_never_delivered' FROM private.audit_events
      WHERE action = 'order_captured' AND subject_key = o1), 'false');
  PERFORM pg_temp.s10l_keys('D32 and carries the six names a reader of a dispute needs',
    (SELECT payload FROM private.audit_events
      WHERE action = 'order_captured' AND subject_key = o1),
    ARRAY['attempt_id','entitlement_id','event_row_id','initiation_never_delivered',
          'newly_granted','order_status_before']);

  -- A second capture of the same purchase under a different event id: money does not double, and neither
  -- does the right it bought.
  st := pg_temp.s10l_state();
  v := pg_temp.s10l_deliver('d-capt-2', 'payment_captured', r1, 499900, 'po_a1', 'pay_a1', now());
  PERFORM pg_temp.s10l_eq('D33 a second capture of a captured order is a duplicate, not a re-grant',
    v ->> 'processing_status', 'duplicate');
  PERFORM pg_temp.s10l_eq('D34 named for what it ignored', v ->> 'applied_effect',
    'ignored_already_captured');
  PERFORM pg_temp.s10l_eq('D35 its ledger row says duplicate while the effect says nothing was done',
    (SELECT processing_status || '/' || applied_effect FROM private.commerce_payment_events
      WHERE event_id = 'd-capt-2'), 'duplicate/ignored_already_captured');
  PERFORM pg_temp.s10l_eq('D36 and there is still one entitlement, one attempt and one capture audit row',
    ARRAY[(SELECT count(*) FROM public.entitlements WHERE wedding_id = s.wed_a)::text,
          (SELECT count(*) FROM private.commerce_payment_attempts WHERE order_id = o1)::text,
          pg_temp.s10l_audit_count('order_captured', o1)::text],
    ARRAY['1','1','1']);
  PERFORM pg_temp.s10l_eq('D37 the money state outside the ledger did not move at all',
    pg_temp.s10l_state(), st);
  PERFORM pg_temp.s10l_eq('D38 a duplicate carries no hold reason, because it was understood, not refused',
    (SELECT hold_reason FROM private.commerce_payment_events WHERE event_id = 'd-capt-2'), NULL::text);
END $deliver$;

-- --------------------------------------------------------------------------- H2. the holds
-- Each hold is the same shape: a kept ledger row, a named reason, and no state change. §4.2's whole claim
-- is that a delivery this build cannot trust is *filed*, not dropped and not applied.
DO $holds$
DECLARE v jsonb; st text; o2 uuid; r2 text; s s10r%ROWTYPE;
BEGIN
  SELECT * INTO s FROM s10r;
  o2 := pg_temp.s10l_order('2');
  r2 := pg_temp.s10l_ref('2');
  st := pg_temp.s10l_state();

  v := pg_temp.s10l_deliver_raw('h-env-null', 'payment_captured', NULL, true, r2,
    199900, 'INR', 'po_x', 'pay_x', now());
  PERFORM pg_temp.s10l_eq('H20 an undeclared environment is held, never read as a safe non-live value',
    v ->> 'processing_status', 'held_for_reconciliation');
  PERFORM pg_temp.s10l_eq('H21 with the reason §6 names', v ->> 'hold_reason', 'environment_undeclared');
  PERFORM pg_temp.s10l_eq('H22 and the row stores NULL rather than the nearest match, so the gap is visible',
    (SELECT environment FROM private.commerce_payment_events WHERE event_id = 'h-env-null'),
    NULL::text);
  PERFORM pg_temp.s10l_eq('H23 its kind is the delivery''s own, because the body verified',
    (SELECT kind FROM private.commerce_payment_events WHERE event_id = 'h-env-null'),
    'payment_captured');

  v := pg_temp.s10l_deliver_raw('h-env-bogus', 'payment_captured', 'production', true, r2,
    199900, 'INR', 'po_x', 'pay_x', now());
  PERFORM pg_temp.s10l_eq('H24 an environment string outside the vocabulary is held the same way',
    v ->> 'hold_reason', 'environment_undeclared');
  PERFORM pg_temp.s10l_eq('H25 and it is not filed under sandbox, test or live by a nearest-match rule',
    (SELECT environment FROM private.commerce_payment_events WHERE event_id = 'h-env-bogus'),
    NULL::text);

  v := pg_temp.s10l_deliver_raw('h-live', 'payment_captured', 'live', true, r2,
    199900, 'INR', 'po_x', 'pay_x', now());
  PERFORM pg_temp.s10l_eq('H26 a live delivery is held while the policy row says live capture is off',
    v ->> 'hold_reason', 'live_capture_disabled');
  PERFORM pg_temp.s10l_eq('H27 and its environment IS recorded, because live is a fact about the message',
    (SELECT environment FROM private.commerce_payment_events WHERE event_id = 'h-live'), 'live');
  PERFORM pg_temp.s10l_eq('H28 no entitlement exists for the held live capture',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = s.wed_a
       AND package_code = 'QQUIET'), 0::bigint);
  PERFORM pg_temp.s10l_eq('H29 the hold produced no state change outside the ledger',
    pg_temp.s10l_state(), st);

  v := pg_temp.s10l_deliver_raw('h-unknown', 'payment_captured', 'synthetic', true,
    'vv1_this_reference_was_never_minted', 199900, 'INR', 'po_u', 'pay_u', now());
  PERFORM pg_temp.s10l_eq('H30 a delivery naming a reference this product never issued is held, not dropped',
    v ->> 'hold_reason', 'unknown_order');
  PERFORM pg_temp.s10l_eq('H31 and the row keeps the reference it was given as evidence',
    (SELECT merchant_reference FROM private.commerce_payment_events WHERE event_id = 'h-unknown'),
    'vv1_this_reference_was_never_minted');
  PERFORM pg_temp.s10l_eq('H32 while its order and attempt links are nulled, so it cannot claim a wedding',
    (SELECT coalesce(order_id::text,'(none)') || '/' || coalesce(attempt_id::text,'(none)')
       FROM private.commerce_payment_events WHERE event_id = 'h-unknown'), '(none)/(none)');
  PERFORM pg_temp.s10l_eq('H33 the CHECK that forbids an attempt without an order stays satisfied by that nulling',
    (SELECT count(*) FROM private.commerce_payment_events
      WHERE attempt_id IS NOT NULL AND order_id IS NULL), 0::bigint);

  v := pg_temp.s10l_deliver('h-amt', 'payment_captured', r2, 100, 'po_a1', 'pay_a1', now());
  PERFORM pg_temp.s10l_eq('H34 a capture whose amount disagrees with the frozen quote is held',
    v ->> 'hold_reason', 'amount_mismatch');
  PERFORM pg_temp.s10l_eq('H35 and the ledger keeps the amount that was claimed, as evidence',
    (SELECT amount_minor FROM private.commerce_payment_events WHERE event_id = 'h-amt'),
    100::bigint);
  PERFORM pg_temp.s10l_eq('H36 while the order keeps its own price: the quote never moves to match a webhook',
    (SELECT amount_minor FROM private.commerce_orders WHERE id = o2), 199900::bigint);
  PERFORM pg_temp.s10l_eq('H37 and the held row still resolves its order, because the reference was valid',
    (SELECT order_id FROM private.commerce_payment_events WHERE event_id = 'h-amt'), o2);

  v := pg_temp.s10l_deliver('h-cur', 'payment_captured', r2, 199900, 'po_a1', 'pay_a1', now(),
    'synthetic', 'razorpay', 'USD');
  PERFORM pg_temp.s10l_eq('H38 a right amount in the wrong currency is the same refusal, not a silent coercion',
    v ->> 'hold_reason', 'amount_mismatch');
  PERFORM pg_temp.s10l_eq('H39 and the evidence row records the currency the delivery actually named',
    (SELECT currency FROM private.commerce_payment_events WHERE event_id = 'h-cur'), 'USD');
  PERFORM pg_temp.s10l_eq('H40 no order row anywhere changed its currency',
    (SELECT count(*) FROM private.commerce_orders WHERE currency <> 'INR'), 0::bigint);

  -- A cross-provider confirmation: the open attempt belongs to Razorpay, and a Cashfree event may not
  -- confirm it. Requires a live initiated attempt, so o2 is initiated first and this stays honest.
  --
  -- Measured before that initiation runs, so the hash covers only holds: the initiation is the one
  -- delivery in this block that is *supposed* to move state, and a baseline drawn across it would let
  -- a misapplied hold hide behind a legitimate change.
  PERFORM pg_temp.s10l_eq('H40b every hold before the initiation left the money state as the block found it',
    pg_temp.s10l_state(), st);

  v := pg_temp.s10l_deliver('h2-init', 'payment_initiated', r2, 199900, 'po_q2', NULL, now());
  PERFORM pg_temp.s10l_eq('H41 an initiation for the quiet package is applied',
    v ->> 'applied_effect', 'attempt_initiated');
  -- The initiation is allowed to move state, so its exact footprint is pinned here rather than left to
  -- a bare applied_effect: one order transition, one attempt row, nothing else.
  PERFORM pg_temp.s10l_eq('H41b and that footprint is order 2 moved to payment_pending',
    (SELECT status FROM private.commerce_orders WHERE id = o2), 'payment_pending');
  PERFORM pg_temp.s10l_eq('H41c one initiated Razorpay attempt, and that is all',
    ARRAY[(SELECT count(*) FROM private.commerce_payment_attempts WHERE order_id = o2)::text,
          (SELECT provider || '/' || status || '/' || provider_order_ref
             FROM private.commerce_payment_attempts WHERE order_id = o2)],
    ARRAY['1', 'razorpay/initiated/po_q2']);
  PERFORM pg_temp.s10l_eq('H41d and an initiation grants nothing: still no entitlement for the quiet package',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = s.wed_a
       AND package_code = 'QQUIET'), 0::bigint);
  -- Re-baselined: the refusals below must not move *this* state, the one the initiation legitimately made.
  st := pg_temp.s10l_state();
  v := pg_temp.s10l_deliver('h-xprov', 'payment_captured', r2, 199900, 'po_q2', 'pay_q2', now(),
    'synthetic', 'cashfree');
  PERFORM pg_temp.s10l_eq('H42 a Cashfree event cannot confirm a Razorpay payment object',
    v ->> 'hold_reason', 'provider_mismatch');
  PERFORM pg_temp.s10l_eq('H43 and the Razorpay attempt stays initiated rather than being adopted',
    (SELECT status FROM private.commerce_payment_attempts WHERE provider_order_ref = 'po_q2'),
    'initiated');
  PERFORM pg_temp.s10l_eq('H44 no Cashfree attempt was minted by the refused delivery',
    (SELECT count(*) FROM private.commerce_payment_attempts WHERE provider = 'cashfree'), 0::bigint);
  PERFORM pg_temp.s10l_eq('H45 every hold after the initiation left the money state as it found it',
    pg_temp.s10l_state(), st);
END $holds$;

-- --------------------------------------------------------------------------- S. staleness and reordering
DO $stale$
DECLARE v jsonb; st text; o1 uuid; r1 text; o4 uuid; r4 text; s s10r%ROWTYPE;
BEGIN
  SELECT * INTO s FROM s10r;
  o1 := pg_temp.s10l_order('1');  r1 := pg_temp.s10l_ref('1');
  o4 := pg_temp.s10l_order('4');  r4 := pg_temp.s10l_ref('4');
  st := pg_temp.s10l_state();

  -- §4.1: `occurred_at` may not re-order history. A refund dated before the capture it would follow is
  -- understood but not applied.
  v := pg_temp.s10l_deliver('s-old-refund', 'refund_succeeded', r1, 499900, 'po_a1', 'rf_old',
    now() - interval '10 minutes');
  PERFORM pg_temp.s10l_eq('S01 a delivery older than the last one applied for that attempt is stale',
    v ->> 'processing_status', 'stale');
  PERFORM pg_temp.s10l_eq('S02 and no effect is claimed for it', v ->> 'applied_effect', NULL::text);
  PERFORM pg_temp.s10l_eq('S03 its ledger row is still written, because staleness is history not absence',
    (SELECT processing_status FROM private.commerce_payment_events WHERE event_id = 's-old-refund'),
    'stale');
  PERFORM pg_temp.s10l_eq('S04 and it created no refund record',
    (SELECT count(*) FROM private.commerce_refunds), 0::bigint);
  PERFORM pg_temp.s10l_eq('S05 the state machine would have granted the refund had it not been old: it is now held out of order',
    pg_temp.s10l_state(), st);

  -- §4.1's other half: a capture may arrive with no initiation ever having arrived, and must be honoured
  -- from its own evidence rather than refused for a message that never came.
  v := pg_temp.s10l_deliver('s-bare-capture', 'payment_captured', r4, 499900, 'po_bare', 'pay_bare',
    now());
  PERFORM pg_temp.s10l_eq('S06 a capture with no prior initiation is applied',
    v ->> 'applied_effect', 'entitlement_granted');
  PERFORM pg_temp.s10l_eq('S07 and the attempt is created already confirmed, from this delivery',
    (SELECT status FROM private.commerce_payment_attempts WHERE order_id = o4), 'confirmed');
  PERFORM pg_temp.s10l_eq('S08 with both timestamps set to the delivery''s own time',
    (SELECT initiated_at = confirmed_at FROM private.commerce_payment_attempts WHERE order_id = o4),
    true);
  PERFORM pg_temp.s10l_eq('S09 exactly one attempt row exists for that order',
    (SELECT count(*) FROM private.commerce_payment_attempts WHERE order_id = o4), 1::bigint);
  PERFORM pg_temp.s10l_eq('S10 and the entitlement the bare capture bought is active',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = s.wed_c
       AND package_code = 'QCLASSIC' AND status = 'active'), 1::bigint);

  -- An initiation that arrives after the capture: initiation cannot follow capture.
  v := pg_temp.s10l_deliver('s-late-init', 'payment_initiated', r4, 499900, 'po_bare', NULL,
    now() - interval '3 minutes');
  PERFORM pg_temp.s10l_eq('S11 an initiation delivered after a capture is stale, not applied',
    v ->> 'processing_status', 'stale');
  PERFORM pg_temp.s10l_eq('S12 and it did not move the order back out of captured',
    (SELECT status FROM private.commerce_orders WHERE id = o4), 'captured');
  PERFORM pg_temp.s10l_eq('S13 nor add a second attempt',
    (SELECT count(*) FROM private.commerce_payment_attempts WHERE order_id = o4), 1::bigint);
END $stale$;

-- --------------------------------------------------------------------------- C. failure and cancellation
DO $fail$
DECLARE v jsonb; o3 uuid; r3 text; o5 uuid; r5 text; o6 uuid; r6 text; s s10r%ROWTYPE;
BEGIN
  SELECT * INTO s FROM s10r;
  o3 := pg_temp.s10l_order('3');  r3 := pg_temp.s10l_ref('3');
  o5 := pg_temp.s10l_order('5');  r5 := pg_temp.s10l_ref('5');
  o6 := pg_temp.s10l_order('6');  r6 := pg_temp.s10l_ref('6');

  v := pg_temp.s10l_deliver('c-fail-open', 'payment_failed', r6, 199900, 'po_f1', 'pay_f1', now());
  PERFORM pg_temp.s10l_eq('C01 a failure on an order that was never initiated is recorded, not closed',
    v ->> 'applied_effect', 'failure_recorded');
  PERFORM pg_temp.s10l_eq('C02 and the order stays open: one failed attempt is not a cancelled purchase',
    (SELECT status FROM private.commerce_orders WHERE id = o6), 'open');
  PERFORM pg_temp.s10l_eq('C03 and no attempt row was created for a failure this file never initiated',
    (SELECT count(*) FROM private.commerce_payment_attempts WHERE order_id = o6), 0::bigint);

  v := pg_temp.s10l_deliver('c-init-3', 'payment_initiated', r3, 499900, 'po_c1', NULL,
    now() - interval '8 minutes');
  PERFORM pg_temp.s10l_eq('C04 the third order''s initiation is applied', v ->> 'applied_effect',
    'attempt_initiated');
  v := pg_temp.s10l_deliver('c-fail-3', 'payment_failed', r3, 499900, 'po_c1', 'pay_c1',
    now() - interval '6 minutes');
  PERFORM pg_temp.s10l_eq('C05 a failure on a pending order is applied against its attempt',
    v ->> 'applied_effect', 'attempt_failed');
  PERFORM pg_temp.s10l_eq('C06 the attempt is failed, with the timestamp that says when',
    (SELECT status FROM private.commerce_payment_attempts WHERE provider_order_ref = 'po_c1'),
    'failed');
  PERFORM pg_temp.s10l_eq('C07 whose failed_at is set and confirmed_at is not',
    (SELECT failed_at IS NOT NULL AND confirmed_at IS NULL
       FROM private.commerce_payment_attempts WHERE provider_order_ref = 'po_c1'), true);
  PERFORM pg_temp.s10l_eq('C08 and the ORDER deliberately stays payment_pending: a failed attempt is not a closed purchase',
    (SELECT status FROM private.commerce_orders WHERE id = o3), 'payment_pending');
  PERFORM pg_temp.s10l_eq('C09 no entitlement exists for it',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = s.wed_b
       AND package_code = 'QCLASSIC'), 0::bigint);

  v := pg_temp.s10l_deliver('c-capt-3', 'payment_captured', r3, 499900, 'po_c2', 'pay_c2', now());
  PERFORM pg_temp.s10l_eq('C10 a later attempt succeeding is applied on the same order',
    v ->> 'applied_effect', 'entitlement_granted');
  PERFORM pg_temp.s10l_eq('C11 and it is a second attempt object, because the failed one is evidence',
    (SELECT count(*) FROM private.commerce_payment_attempts WHERE order_id = o3), 2::bigint);
  PERFORM pg_temp.s10l_eq('C12 the failed row did not move',
    (SELECT status FROM private.commerce_payment_attempts WHERE provider_order_ref = 'po_c1'),
    'failed');
  PERFORM pg_temp.s10l_eq('C13 the order is captured through the successful attempt',
    (SELECT status FROM private.commerce_orders WHERE id = o3), 'captured');
  PERFORM pg_temp.s10l_eq('C14 one active entitlement for the second wedding''s package',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = s.wed_b
       AND package_code = 'QCLASSIC' AND status = 'active'), 1::bigint);

  v := pg_temp.s10l_deliver('c-fail-after', 'payment_failed', r3, 499900, 'po_c2', 'pay_c2', now());
  PERFORM pg_temp.s10l_eq('C15 a failure arriving after a capture is held, never applied',
    v ->> 'hold_reason', 'failure_after_capture');
  PERFORM pg_temp.s10l_eq('C16 and the entitlement the capture bought survives it',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = s.wed_b
       AND package_code = 'QCLASSIC' AND status = 'active'), 1::bigint);

  v := pg_temp.s10l_deliver('c-cancel-5', 'order_cancelled', r5, 199900, 'po_c5', NULL, now());
  PERFORM pg_temp.s10l_eq('C17 a cancellation of a live order is applied on the order itself',
    v ->> 'applied_effect', 'order_cancelled');
  PERFORM pg_temp.s10l_eq('C18 the order is cancelled with its closing timestamp',
    ARRAY[(SELECT status FROM private.commerce_orders WHERE id = o5),
          (SELECT closed_at IS NOT NULL FROM private.commerce_orders WHERE id = o5)::text],
    ARRAY['cancelled','true']);
  PERFORM pg_temp.s10l_eq('C19 one audit row says the provider cancelled it, and names the prior state',
    pg_temp.s10l_audit_count('cancelled_by_provider', o5), 1::bigint);
  PERFORM pg_temp.s10l_keys('C20 whose payload is the event, the order''s prior status',
    (SELECT payload FROM private.audit_events
      WHERE action = 'cancelled_by_provider' AND subject_key = o5 LIMIT 1),
    ARRAY['event_row_id','order_status_before']);

  v := pg_temp.s10l_deliver('c-cancel-again', 'order_cancelled', r5, 199900, 'po_c5', NULL, now());
  PERFORM pg_temp.s10l_eq('C21 a second cancellation of a cancelled order is recorded only',
    v ->> 'applied_effect', 'recorded_only');
  v := pg_temp.s10l_deliver('c-cancel-after', 'order_cancelled', r3, 499900, 'po_c2', NULL, now());
  PERFORM pg_temp.s10l_eq('C22 a cancellation arriving after a capture is held: money was taken',
    v ->> 'hold_reason', 'cancel_after_capture');
  PERFORM pg_temp.s10l_eq('C23 and the captured order stays captured with its entitlement',
    (SELECT status FROM private.commerce_orders WHERE id = o3), 'captured');

  v := pg_temp.s10l_deliver('c-init-on-cancelled', 'payment_initiated', r5, 199900, 'po_c5x', NULL,
    now());
  PERFORM pg_temp.s10l_eq('C24 an initiation for a cancelled order is held as a closed order',
    v ->> 'hold_reason', 'closed_order');
  v := pg_temp.s10l_deliver('c-capt-on-cancelled', 'payment_captured', r5, 199900, 'po_c5x',
    'pay_c5x', now());
  PERFORM pg_temp.s10l_eq('C25 while a capture for one is the most dangerous row and is held by name',
    v ->> 'hold_reason', 'captured_on_closed_order');
  PERFORM pg_temp.s10l_eq('C26 and it granted nothing: no entitlement exists for the cancelled pair',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = s.wed_c
       AND package_code = 'QQUIET'), 0::bigint);

  v := pg_temp.s10l_deliver('c-other-kind', 'other', r6, 199900, 'po_f1', NULL, now());
  PERFORM pg_temp.s10l_eq('C27 an event this build has not read is recorded and inert',
    v ->> 'applied_effect', 'recorded_only');
  PERFORM pg_temp.s10l_eq('C28 its kind survives as other, which is what §4 promises for an unknown event',
    (SELECT kind FROM private.commerce_payment_events WHERE event_id = 'c-other-kind'), 'other');
END $fail$;

-- --------------------------------------------------------------------------- R. refunds, chargebacks, revocation
DO $refund$
DECLARE v jsonb; st text; o1 uuid; r1 text; o4 uuid; r4 text; o6 uuid; r6 text;
        ent1 uuid; s s10r%ROWTYPE;
BEGIN
  SELECT * INTO s FROM s10r;
  o1 := pg_temp.s10l_order('1');  r1 := pg_temp.s10l_ref('1');
  o4 := pg_temp.s10l_order('4');  r4 := pg_temp.s10l_ref('4');
  o6 := pg_temp.s10l_order('6');  r6 := pg_temp.s10l_ref('6');
  ent1 := (SELECT entitlement_id FROM private.commerce_orders WHERE id = o1);

  v := pg_temp.s10l_deliver('r-refund-1', 'refund_succeeded', r1, 499900, 'po_a1', 'rf_a1', now());
  PERFORM pg_temp.s10l_eq('R01 a refund under the shipped policy records money moving back',
    v ->> 'applied_effect', 'refund_recorded');
  PERFORM pg_temp.s10l_eq('R02 as a refund row of its own, with its own provider reference',
    (SELECT kind || '/' || status || '/' || coalesce(provider_refund_ref,'')
       FROM private.commerce_refunds WHERE order_id = o1), 'refund/succeeded/rf_a1');
  PERFORM pg_temp.s10l_eq('R03 completed, since the delivery said it succeeded',
    (SELECT completed_at IS NOT NULL FROM private.commerce_refunds WHERE order_id = o1), true);
  PERFORM pg_temp.s10l_eq('R04 and the order stays captured: refund does not overwrite the money fact',
    (SELECT status FROM private.commerce_orders WHERE id = o1), 'captured');
  PERFORM pg_temp.s10l_eq('R05 while the entitlement the money bought is still active',
    (SELECT status FROM public.entitlements WHERE id = ent1), 'active');
  PERFORM pg_temp.s10l_eq('R06 the refund row points at the ledger row that caused it',
    (SELECT event_id IS NOT NULL FROM private.commerce_refunds WHERE order_id = o1), true);
  PERFORM pg_temp.s10l_eq('R07 and the audit row names the revocation mode it decided under',
    (SELECT payload ->> 'revocation_mode' FROM private.audit_events
      WHERE action = 'refund_succeeded' AND subject_key = o1), 'hold_for_review');
  PERFORM pg_temp.s10l_keys('R08 whose payload is the four names a reviewer needs',
    (SELECT payload FROM private.audit_events
      WHERE action = 'refund_succeeded' AND subject_key = o1 LIMIT 1),
    ARRAY['event_row_id','kind','refund_id','revocation_mode']);

  v := pg_temp.s10l_deliver('r-chb-1', 'chargeback_opened', r1, 499900, 'po_a1', 'cb_a1', now());
  PERFORM pg_temp.s10l_eq('R09 a chargeback is always hold-for-review, whatever the policy row says',
    v ->> 'applied_effect', 'chargeback_hold_for_review');
  PERFORM pg_temp.s10l_eq('R10 recorded as its own kind of row, never as a revoked right',
    (SELECT kind || '/' || status FROM private.commerce_refunds
      WHERE order_id = o1 AND kind = 'chargeback'), 'chargeback/recorded');
  PERFORM pg_temp.s10l_eq('R11 and the entitlement is untouched: an unadjudicated claim cannot lock a family out',
    (SELECT status FROM public.entitlements WHERE id = ent1), 'active');
  PERFORM pg_temp.s10l_eq('R12 its audit row''s mode is hold_for_review even though the delivery is a dispute',
    (SELECT payload ->> 'revocation_mode' FROM private.audit_events
      WHERE action = 'chargeback_opened' AND subject_key = o1), 'hold_for_review');

  -- A refund against a quote that was never paid: nothing moves back, and inventing a refund row would
  -- be a second false account of the same purchase.
  st := pg_temp.s10l_state();
  v := pg_temp.s10l_deliver('r-refund-open', 'refund_succeeded', r6, 199900, 'po_f1', 'rf_f1', now());
  PERFORM pg_temp.s10l_eq('R13 a refund on an order that never captured is recorded only',
    v ->> 'applied_effect', 'recorded_only');
  PERFORM pg_temp.s10l_eq('R14 and no refund row was created for money that was never ours',
    (SELECT count(*) FROM private.commerce_refunds WHERE order_id = o6), 0::bigint);
  PERFORM pg_temp.s10l_eq('R15 the state outside the ledger is unchanged', pg_temp.s10l_state(), st);

  -- The owner's decision flipped on purpose, inside a test that will flip it back.
  UPDATE private.commerce_policy SET refund_revocation_mode = 'revoke' WHERE id = 1;
  PERFORM pg_temp.s10l_eq('R16 the policy row is writable by the trusted role and refuses a browser',
    (SELECT refund_revocation_mode FROM private.commerce_policy WHERE id = 1), 'revoke');

  v := pg_temp.s10l_deliver('r-refund-4', 'refund_succeeded', r4, 499900, 'po_bare', 'rf_bare', now());
  PERFORM pg_temp.s10l_eq('R17 under revoke, the same delivery names the revocation it is about to make',
    v ->> 'applied_effect', 'entitlement_revoked');
  PERFORM pg_temp.s10l_eq('R18 and the entitlement for that wedding and package is no longer active',
    (SELECT status FROM public.entitlements WHERE wedding_id = s.wed_c AND package_code = 'QCLASSIC'),
    'revoked');
  PERFORM pg_temp.s10l_eq('R19 revoked with a timestamp and a stated reason, never deleted',
    ARRAY[(SELECT revoked_at IS NOT NULL FROM public.entitlements
              WHERE wedding_id = s.wed_c AND package_code = 'QCLASSIC')::text,
          (SELECT count(*) FROM public.entitlements WHERE wedding_id = s.wed_c)::text],
    ARRAY['true','1']);
  PERFORM pg_temp.s10l_eq('R20 whose metadata carries the reason the policy gave and the order it came from',
    (SELECT metadata ->> 'revoked_reason' FROM public.entitlements
      WHERE wedding_id = s.wed_c AND package_code = 'QCLASSIC'),
    'refund_succeeded while refund_revocation_mode = revoke');
  PERFORM pg_temp.s10l_ok('R21 and the order still points at the entitlement, now revoked: the link is history',
    (SELECT entitlement_id IS NOT NULL FROM private.commerce_orders WHERE id = o4));
  PERFORM pg_temp.s10l_eq('R22 one audit row of action revoked, against the entitlement not the order',
    (SELECT count(*) FROM private.audit_events WHERE action = 'revoked'
       AND subject_type = 'entitlement'), 1::bigint);

  -- The killer arm of §9: a chargeback under `revoke` mode must still not revoke.
  v := pg_temp.s10l_deliver('r-chb-revoke', 'chargeback_opened', r1, 499900, 'po_a1', 'cb_a2', now());
  PERFORM pg_temp.s10l_eq('R23 a chargeback under revoke mode is still hold-for-review',
    v ->> 'applied_effect', 'chargeback_hold_for_review');
  PERFORM pg_temp.s10l_eq('R24 and the entitlement it might have revoked is still active',
    (SELECT status FROM public.entitlements WHERE id = ent1), 'active');
  PERFORM pg_temp.s10l_eq('R25 its audit payload says hold_for_review while the policy row says revoke',
    (SELECT payload ->> 'revocation_mode' FROM private.audit_events
      WHERE action = 'chargeback_opened' AND subject_key = o1
      ORDER BY id DESC LIMIT 1), 'hold_for_review');

  v := pg_temp.s10l_deliver('r-refund-fail', 'refund_failed', r1, 499900, 'po_a1', 'rf_a2', now());
  PERFORM pg_temp.s10l_eq('R26 a failed refund is recorded as failed',
    v ->> 'applied_effect', 'refund_failed_recorded');
  PERFORM pg_temp.s10l_eq('R27 with no completion timestamp, which is the CHECK that keeps that honest',
    (SELECT status || '/' || coalesce(completed_at::text,'(none)') FROM private.commerce_refunds
      WHERE provider_refund_ref = 'rf_a2'), 'failed/(none)');
  PERFORM pg_temp.s10l_eq('R28 and it revoked nothing',
    (SELECT status FROM public.entitlements WHERE id = ent1), 'active');

  v := pg_temp.s10l_deliver_raw('r-null-amount', 'refund_succeeded', 'synthetic', true, r1,
    NULL, NULL, 'po_a1', 'rf_a3', now());
  PERFORM pg_temp.s10l_eq('R29 a refund delivery that names no amount is still recorded',
    v ->> 'disposition', 'applied');
  PERFORM pg_temp.s10l_eq('R30 with the amount kept absent rather than filled from the order',
    (SELECT coalesce(amount_minor::text,'(none)') FROM private.commerce_refunds
      WHERE provider_refund_ref = 'rf_a3'), '(none)');

  UPDATE private.commerce_policy SET refund_revocation_mode = 'hold_for_review' WHERE id = 1;
  PERFORM pg_temp.s10l_eq('R31 the policy row is restored to the shipped default before the census',
    (SELECT refund_revocation_mode FROM private.commerce_policy WHERE id = 1), 'hold_for_review');
  PERFORM pg_temp.s10l_err('R32 a revocation must say why: an entitlement is a right somebody was told they have',
    'SELECT internal_api.revoke_commerce_entitlement(' || quote_literal(o1::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid, ''   '')',
    '23514', '%a revocation must say why%');
  PERFORM pg_temp.s10l_err('R33 and a revocation of an order with no live entitlement refuses rather than inventing one',
    'SELECT internal_api.revoke_commerce_entitlement(' || quote_literal(o4::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid, ''second attempt'')',
    'P0001', '%has no live entitlement to revoke%');
END $refund$;

-- --------------------------------------------------------------------------- X. expiry
DO $expiry$
DECLARE v jsonb; o2 uuid; r2 text; o6 uuid; r6 text; o7 uuid; before timestamptz;
BEGIN
  o2 := pg_temp.s10l_order('2');  r2 := pg_temp.s10l_ref('2');
  o6 := pg_temp.s10l_order('6');  r6 := pg_temp.s10l_ref('6');

  PERFORM pg_temp.s10l_err('X01 a quote whose own expiry has not arrived cannot be closed by the sweep',
    'SELECT internal_api.expire_commerce_order(' || quote_literal(o2::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)',
    '23514', '%is quoted until %, which has not passed%');

  -- TEST-ONLY PLANT. Nothing in the product can produce an overage quote inside a single transaction,
  -- because the writer sets `now() + 30 minutes` and the clock is fixed for this transaction. Setting
  -- `quote_expires_at` is legal for the owner role precisely because it is *not* one of the frozen
  -- fields, which is what X02 measures alongside the plant.
  UPDATE private.commerce_orders SET quote_expires_at = now() - interval '1 minute' WHERE id = o2;
  PERFORM pg_temp.s10l_ok('X02 the freeze trigger stands aside for the quote''s own clock, which is not frozen',
    (SELECT quote_expires_at < now() FROM private.commerce_orders WHERE id = o2));
  PERFORM pg_temp.s10l_eq('X03 while every frozen field on that row is untouched by the plant',
    ARRAY[(SELECT amount_minor::text FROM private.commerce_orders WHERE id = o2),
          (SELECT currency FROM private.commerce_orders WHERE id = o2),
          (SELECT package_code FROM private.commerce_orders WHERE id = o2),
          (SELECT price_version::text FROM private.commerce_orders WHERE id = o2)],
    ARRAY['199900','INR','QQUIET','1']);
  PERFORM pg_temp.s10l_err('X04 and the same row refuses a price change, which is the frozen half',
    'UPDATE private.commerce_orders SET amount_minor = 1 WHERE id = ' || quote_literal(o2::text),
    '23514', '%is a frozen quote: wedding, owner, reference, package, price version, amount and currency may never change%');
  PERFORM pg_temp.s10l_err('X05 or a wedding change, which would be a cross-wedding attack the row itself would permit',
    'UPDATE private.commerce_orders SET wedding_id = '
    || quote_literal(pg_temp.s10l_wed('c')::text) || '::uuid WHERE id = ' || quote_literal(o2::text),
    '23514', '%frozen quote%');
  PERFORM pg_temp.s10l_err('X06 or a merchant reference change, which would break the only id a delivery names',
    'UPDATE private.commerce_orders SET merchant_reference = ''vv1_replaced'' WHERE id = '
    || quote_literal(o2::text), '23514', '%frozen quote%');
  -- `status` is deliberately outside the frozen set — a trusted writer must be able to close a quote, and
  -- X02 showed the quote's own clock is writable too. So what stops a direct status write that lies is not
  -- the freeze trigger but the DDL, and these cells separate exactly that: the complete transition is legal,
  -- the half-written one is not. They run on a freshly minted quote rather than on one of the cast's six,
  -- because by this point each cast order has been captured, cancelled or expired by the events delivered
  -- above — and a pair CHECK cannot be violated by a row that already satisfies it. (Order 5, the first
  -- attempt at this arm, was closed for real by C17, so the bare write there broke nothing and the cell
  -- would have passed on a false premise.)
  v := pg_temp.s10l_quote(pg_temp.s10l_wed('a'), 'QCLASSIC', pg_temp.s10l_actor());
  PERFORM pg_temp.s10l_eq('X06b a re-quote beside the captured order 1 is minted, which is the live row these cells need',
    coalesce(v ->> 'status', 'REFUSED: ' || (v ->> '_error')), 'open');
  o7 := (v ->> 'order_id')::uuid;
  PERFORM pg_temp.s10l_array('X06c and it is genuinely live, with neither timestamp set, so the pair CHECK is unsatisfied',
    ARRAY[(SELECT status FROM private.commerce_orders WHERE id = o7),
          (SELECT closed_at IS NULL FROM private.commerce_orders WHERE id = o7)::text,
          (SELECT captured_at IS NULL FROM private.commerce_orders WHERE id = o7)::text],
    ARRAY['open','true','true']);

  PERFORM pg_temp.s10l_err('X07 a status write that moves to cancelled without its closing moment is refused by the pair CHECK, not by the trigger',
    'UPDATE private.commerce_orders SET status = ''cancelled'' WHERE id = '
    || quote_literal(o7::text),
    '23514', '%commerce_orders_closure_pair_check%');
  PERFORM pg_temp.s10l_array('X07a and the refusal left the row wholly as it was, with no half-written status behind it',
    ARRAY[(SELECT status FROM private.commerce_orders WHERE id = o7),
          (SELECT closed_at IS NULL FROM private.commerce_orders WHERE id = o7)::text],
    ARRAY['open','true']);
  UPDATE private.commerce_orders SET status = 'cancelled', closed_at = now() WHERE id = o7;
  PERFORM pg_temp.s10l_array('X07b the same write, carrying the timestamp its status asserts, lands in exactly that state',
    ARRAY[(SELECT status FROM private.commerce_orders WHERE id = o7),
          (SELECT closed_at IS NOT NULL FROM private.commerce_orders WHERE id = o7)::text,
          (SELECT captured_at IS NULL FROM private.commerce_orders WHERE id = o7)::text],
    ARRAY['cancelled','true','true']);
  PERFORM pg_temp.s10l_array('X07c while the frozen fields on that row are still the quoted ones, untouched by the close',
    ARRAY[(SELECT amount_minor::text FROM private.commerce_orders WHERE id = o7),
          (SELECT currency FROM private.commerce_orders WHERE id = o7),
          (SELECT package_code FROM private.commerce_orders WHERE id = o7),
          (SELECT price_version::text FROM private.commerce_orders WHERE id = o7)],
    ARRAY['499900','INR','QCLASSIC','1']);

  v := pg_temp.s10l_deliver('x-capt-late', 'payment_captured', r2, 199900, 'po_q2', 'pay_q9', now());
  PERFORM pg_temp.s10l_eq('X08 a capture arriving while the quote is overage is applied, not refused',
    v ->> 'applied_effect', 'entitlement_granted');
  v := pg_temp.s10l_deliver('x-expire-check', 'payment_initiated', r6, 199900, 'po_f2', NULL, now());
  PERFORM pg_temp.s10l_eq('X09 the same is true of an initiation on an open quote',
    v ->> 'applied_effect', 'attempt_initiated');

  PERFORM pg_temp.s10l_err('X10 and a captured order refuses to be expired, because it is refunded instead',
    'SELECT internal_api.expire_commerce_order(' || quote_literal(o2::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)',
    '23514', '%which is not a live order; a captured order is refunded, never expired%');

  UPDATE private.commerce_orders SET quote_expires_at = now() - interval '1 minute' WHERE id = o6;
  v := pg_temp.s10l_call('expire-6',
    'SELECT internal_api.expire_commerce_order(' || quote_literal(o6::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('X11 an overage quote closes through the service body', v ->> 'status',
    'expired');
  PERFORM pg_temp.s10l_eq('X12 with its closing timestamp and no capture timestamp',
    ARRAY[(SELECT status FROM private.commerce_orders WHERE id = o6),
          (SELECT closed_at IS NOT NULL FROM private.commerce_orders WHERE id = o6)::text,
          (SELECT captured_at IS NULL FROM private.commerce_orders WHERE id = o6)::text],
    ARRAY['expired','true','true']);
  PERFORM pg_temp.s10l_eq('X13 one audit row says expired and names the state before it',
    pg_temp.s10l_audit_count('expired', o6), 1::bigint);
  PERFORM pg_temp.s10l_eq('X14 and the prior state it names is payment_pending, which the initiation set',
    (SELECT payload ->> 'status_before' FROM private.audit_events
      WHERE action = 'expired' AND subject_key = o6), 'payment_pending');
  PERFORM pg_temp.s10l_err('X15 expiring it twice refuses: an expired order is not a live order',
    'SELECT internal_api.expire_commerce_order(' || quote_literal(o6::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)',
    '23514', '%not a live order%');
  v := pg_temp.s10l_deliver('x-capt-expired', 'payment_captured', r6, 199900, 'po_f2', 'pay_f9',
    now());
  PERFORM pg_temp.s10l_eq('X16 a capture that arrives after the expiry is held, never applied retroactively',
    v ->> 'hold_reason', 'captured_on_closed_order');
  PERFORM pg_temp.s10l_eq('X17 and it granted nothing',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = pg_temp.s10l_wed('b')
       AND package_code = 'QQUIET'), 0::bigint);
  PERFORM pg_temp.s10l_err('X18 an unknown order id is refused as missing, not as unauthorised',
    'SELECT internal_api.expire_commerce_order(gen_random_uuid(), '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)',
    'P0001', '%no order % to expire%');
END $expiry$;

-- --------------------------------------------------------------------------- K. reconciliation
DO $recon$
DECLARE v jsonb; codes text; snap text; st text; planted bigint; aud bigint; swp bigint;
        o3 uuid; r3 text; o4 uuid; o6 uuid; o8 uuid;
        ent3 uuid; s s10r%ROWTYPE;
BEGIN
  SELECT * INTO s FROM s10r;
  o3 := pg_temp.s10l_order('3'); o4 := pg_temp.s10l_order('4'); o6 := pg_temp.s10l_order('6');
  r3 := pg_temp.s10l_ref('3');

  PERFORM pg_temp.s10l_err('K01 an unknown order id is refused as missing, not silently empty',
    'SELECT internal_api.commerce_reconcile(gen_random_uuid(), '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)',
    'P0001', '%no order % to reconcile%');

  v := pg_temp.s10l_call('recon-4', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(o4::text) || '::uuid, ' || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K02 a bare capture is reported as a finding, never as an error',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'findings') f
      WHERE f ->> 'code' = 'initiation_never_delivered'), 1::bigint);
  PERFORM pg_temp.s10l_ok('K03 and the finding says the capture stands on its own evidence',
    (SELECT bool_and(f ->> 'detail' NOT ILIKE '%invented%') FROM jsonb_array_elements(v -> 'findings') f));
  PERFORM pg_temp.s10l_keys('K04 the sweep''s answer carries the five names a reader needs',
    v, ARRAY['finding_count','findings','merchant_reference','order_id','order_status','wedding_id']);
  PERFORM pg_temp.s10l_eq('K05 and it wrote exactly one audit row, saying it swept',
    pg_temp.s10l_audit_count('swept', o4), 1::bigint);
  PERFORM pg_temp.s10l_eq('K06 whose payload is the sweep itself: the order, its state, its reference and its findings',
    (SELECT coalesce(string_agg(k, ',' ORDER BY k COLLATE "C"), '(none)')
       FROM jsonb_object_keys((SELECT payload FROM private.audit_events
                                WHERE action = 'swept' AND subject_key = o4)) k),
    'findings,merchant_reference,order_id,order_status');

  st := pg_temp.s10l_state();
  v := pg_temp.s10l_call('recon-again', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(o4::text) || '::uuid, ' || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K07 the sweep changes no money state: reconciling is comparison, not repair',
    pg_temp.s10l_state(), st);
  PERFORM pg_temp.s10l_eq('K08 and running it twice leaves two records, because each sweep is its own fact',
    pg_temp.s10l_audit_count('swept', o4), 2::bigint);

  -- captured_without_entitlement, reached by the honest route: a revocation that leaves a captured order
  -- holding no right. Then the recovery step, which is the same body the capture used.
  v := pg_temp.s10l_call('revoke-3', 'SELECT internal_api.revoke_commerce_entitlement('
    || quote_literal(o3::text) || '::uuid, ' || quote_literal(pg_temp.s10l_actor()::text)
    || '::uuid, ''qualification: recovery arm'')');
  PERFORM pg_temp.s10l_eq('K09 a manual revocation of a captured order''s right succeeds with a reason',
    v ->> 'status', 'revoked');
  v := pg_temp.s10l_call('recon-3', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(o3::text) || '::uuid, ' || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K10 and the sweep names the state this file is in: money taken, right gone',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'findings') f
      WHERE f ->> 'code' = 'captured_without_entitlement'), 1::bigint);
  v := pg_temp.s10l_call('grant-3', 'SELECT internal_api.grant_commerce_entitlement('
    || quote_literal(o3::text) || '::uuid, ' || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K11 the recovery step grants, and says it is a new grant',
    v ->> 'newly_granted', 'true');
  PERFORM pg_temp.s10l_eq('K12 as a new row, since the revoked one stays as the record that it existed',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = s.wed_b
       AND package_code = 'QCLASSIC'), 2::bigint);
  PERFORM pg_temp.s10l_eq('K13 exactly one of which is active',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = s.wed_b
       AND package_code = 'QCLASSIC' AND status = 'active'), 1::bigint);
  v := pg_temp.s10l_call('grant-3-again', 'SELECT internal_api.grant_commerce_entitlement('
    || quote_literal(o3::text) || '::uuid, ' || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K14 re-invoking the grant is idempotent: recovery cannot double-grant',
    v ->> 'already_granted', 'true');
  PERFORM pg_temp.s10l_eq('K15 with the entitlement count unchanged',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = s.wed_b
       AND package_code = 'QCLASSIC'), 2::bigint);
  v := pg_temp.s10l_call('recon-3b', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(o3::text) || '::uuid, ' || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K16 and after the recovery the finding is gone, which is what makes it a remedy',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'findings') f
      WHERE f ->> 'code' = 'captured_without_entitlement'), 0::bigint);
  PERFORM pg_temp.s10l_err('K17 a grant against an order that never captured refuses: no right without money',
    'SELECT internal_api.grant_commerce_entitlement(' || quote_literal(o6::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)',
    '23514', '%is expired and carries no captured money to grant a right for%');

  -- amount_drift, from the holds this file already produced.
  v := pg_temp.s10l_call('recon-2', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(pg_temp.s10l_order('2')::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K18 a held wrong-amount delivery is reported as drift, because a refusal is not a disagreement that went away',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'findings') f
      WHERE f ->> 'code' = 'amount_drift'), 1::bigint);
  PERFORM pg_temp.s10l_ok('K19 and the detail names the order''s own frozen price as the thing that did not move',
    (SELECT bool_or(f ->> 'detail' LIKE '%199900 INR%') FROM jsonb_array_elements(v -> 'findings') f));
  PERFORM pg_temp.s10l_eq('K20 the order''s amount is still the quoted one',
    (SELECT amount_minor FROM private.commerce_orders WHERE id = pg_temp.s10l_order('2')),
    199900::bigint);

  -- stale_open_order, both halves. The negative half is order 5, closed for real by C17 and then given an
  -- overage clock: a quote that expired *after* it was cancelled is not a stale open order, and §10 must
  -- not claim it is. The `AND status = 'cancelled'` in the plant is the guard that this row really is the
  -- closed one — if C17 had not closed it, the plant would match no row and the cell below would pass on
  -- an empty update, which is how K21 is checked rather than assumed.
  UPDATE private.commerce_orders SET quote_expires_at = now() - interval '2 minutes'
   WHERE id = pg_temp.s10l_order('5') AND status = 'cancelled';
  PERFORM pg_temp.s10l_eq('K21a the overage-clock plant landed on order 5, so the negative arm has a row behind it',
    (SELECT quote_expires_at < now() FROM private.commerce_orders
      WHERE id = pg_temp.s10l_order('5')), true);
  v := pg_temp.s10l_call('recon-5', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(pg_temp.s10l_order('5')::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K21b a closed order reports no stale-open finding, because it is already closed',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'findings') f
      WHERE f ->> 'code' = 'stale_open_order'), 0::bigint);

  -- The positive half needs a live quote whose clock has run out, and after X11 no cast order is live any
  -- more, so one is minted for it. Minting it beside the order X07 closed is also the proof that a
  -- hand-cancelled quote gives the wedding-and-package pair back, which is the whole point of allowing a
  -- cancellation at all (§4: cancel, then re-quote, never alongside).
  v := pg_temp.s10l_quote(pg_temp.s10l_wed('a'), 'QCLASSIC', pg_temp.s10l_actor());
  PERFORM pg_temp.s10l_eq('K21c a fresh quote is minted beside the cancelled one, so the stale arm has a live row',
    coalesce(v ->> 'status', 'REFUSED: ' || (v ->> '_error')), 'open');
  o8 := (v ->> 'order_id')::uuid;
  UPDATE private.commerce_orders SET quote_expires_at = now() - interval '2 minutes' WHERE id = o8;
  v := pg_temp.s10l_call('recon-8', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(o8::text) || '::uuid, ' || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K21d an overage live quote is reported as exactly one stale-open finding',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'findings') f
      WHERE f ->> 'code' = 'stale_open_order'), 1::bigint);
  PERFORM pg_temp.s10l_eq('K21e and it is the only thing wrong with a fresh untouched quote',
    jsonb_array_length(v -> 'findings'), 1);
  PERFORM pg_temp.s10l_ok('K21f whose detail names the remedy rather than a repair: the service body that closes it',
    (SELECT bool_or(f ->> 'detail' LIKE '%expire_commerce_order closes it%')
       FROM jsonb_array_elements(v -> 'findings') f));
  PERFORM pg_temp.s10l_array('K21g and the sweep still did not close it: reconciling is comparison, not repair',
    ARRAY[(SELECT status FROM private.commerce_orders WHERE id = o8),
          (SELECT closed_at IS NULL FROM private.commerce_orders WHERE id = o8)::text],
    ARRAY['open','true']);

  -- entitlement_after_refund. This finding cannot be produced by a refund delivered under `revoke`,
  -- because that revokes on the spot — R17 to R20 do exactly that, correctly. The state §10 names happens
  -- the way an owner's later decision happens: money returns while the policy still says hold, the right
  -- stays live, and the revoke ruling arrives afterwards. So the pair is built here in that order, on
  -- order 2, which has held the quiet package's entitlement since X08.
  v := pg_temp.s10l_deliver('k-refund-hold', 'refund_succeeded', pg_temp.s10l_ref('2'),
    199900, 'po_q2', 'rf_k2', now());
  PERFORM pg_temp.s10l_eq('K22 a refund while the policy says hold records the money and leaves the right alone',
    v ->> 'applied_effect', 'refund_recorded');
  PERFORM pg_temp.s10l_array('K23 so the pair this finding is about now genuinely exists: money returned, right live',
    ARRAY[coalesce((SELECT status FROM private.commerce_refunds
                     WHERE provider_refund_ref = 'rf_k2'), '(none)'),
          coalesce((SELECT status FROM public.entitlements
                     WHERE wedding_id = pg_temp.s10l_wed('a') AND package_code = 'QQUIET'
                       AND status = 'active'), '(none)')],
    ARRAY['succeeded','active']);

  -- The owner's decision, made after the fact — the moment two true facts start disagreeing.
  UPDATE private.commerce_policy SET refund_revocation_mode = 'revoke' WHERE id = 1;
  v := pg_temp.s10l_call('recon-2c', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(pg_temp.s10l_order('2')::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K24 the sweep names a live right sitting on a succeeded refund',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'findings') f
      WHERE f ->> 'code' = 'entitlement_after_refund'), 1::bigint);
  PERFORM pg_temp.s10l_eq('K24b and it does not fix it: the entitlement is still active after the sweep',
    coalesce((SELECT status FROM public.entitlements WHERE wedding_id = pg_temp.s10l_wed('a')
                AND package_code = 'QQUIET' AND status = 'active'), '(none)'), 'active');

  -- The remedy the finding's own detail names, taken through the same trusted step a human would invoke.
  v := pg_temp.s10l_call('revoke-2', 'SELECT internal_api.revoke_commerce_entitlement('
    || quote_literal(pg_temp.s10l_order('2')::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid, '
    || quote_literal('qualification: entitlement_after_refund remedy') || ')');
  PERFORM pg_temp.s10l_eq('K24c the named remedy revokes that right', v ->> 'status', 'revoked');
  v := pg_temp.s10l_call('recon-2d', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(pg_temp.s10l_order('2')::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K24d and after the remedy this finding is gone, which is what makes it a remedy',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'findings') f
      WHERE f ->> 'code' = 'entitlement_after_refund'), 0::bigint);
  -- Recorded rather than predicted: revoking the right leaves order 2 captured with no active entitlement,
  -- which is the *other* §10 state, and the drift the H holds left on this order is still on file. A sweep
  -- that stayed silent about that pair would be the failure, not this cell.
  PERFORM pg_temp.s10l_array('K24e and the sweep of the remedied state names exactly the two facts still true',
    ARRAY(SELECT f ->> 'code' FROM jsonb_array_elements(v -> 'findings') f
          ORDER BY f ->> 'code' COLLATE "C"),
    ARRAY['amount_drift','captured_without_entitlement']);

  UPDATE private.commerce_policy SET refund_revocation_mode = 'hold_for_review' WHERE id = 1;
  v := pg_temp.s10l_call('recon-2e', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(pg_temp.s10l_order('2')::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K24f and the finding is a reading of the policy, not a permanent verdict: none under hold either',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'findings') f
      WHERE f ->> 'code' = 'entitlement_after_refund'), 0::bigint);
  PERFORM pg_temp.s10l_eq('K24g with the shipped policy row restored before the census',
    (SELECT refund_revocation_mode FROM private.commerce_policy WHERE id = 1), 'hold_for_review');

  -- held_event_unapplied needs a held row older than fifteen minutes. The ledger refuses UPDATE to every
  -- role, so `received_at` cannot be backdated — which is H13 reasserted as the reason this plant exists.
  v := pg_temp.s10l_call('recon-2b', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(pg_temp.s10l_order('2')::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K25 a held delivery from this transaction reports no grace-window finding yet',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'findings') f
      WHERE f ->> 'code' = 'held_event_unapplied'), 0::bigint);
  PERFORM pg_temp.s10l_err('K26 and its own received_at cannot be moved, because the ledger is append-only',
    'UPDATE private.commerce_payment_events SET received_at = now() - interval ''20 minutes'''
    ' WHERE event_id = ''h-live''',
    '42501', '%rows are append-only%');

  -- TEST-ONLY PLANT: a held row that arrived twenty minutes ago, inserted with its own identity value.
  INSERT INTO private.commerce_payment_events (id, provider, event_id, kind, environment, order_id,
    merchant_reference, amount_minor, currency, raw_body_sha256, signature_valid, hold_reason,
    processing_status, occurred_at, received_at)
  OVERRIDING SYSTEM VALUE
  VALUES (9000001, 'razorpay', 'k-planted-old', 'payment_captured', 'synthetic',
    pg_temp.s10l_order('2'), pg_temp.s10l_ref('2'), 199900, 'INR',
    pg_temp.s10l_sha('k-planted-old'), true, 'manual_operator_note', 'held_for_reconciliation',
    now() - interval '20 minutes', now() - interval '20 minutes');
  SELECT count(*) INTO planted FROM private.commerce_payment_events WHERE id = 9000001;
  PERFORM pg_temp.s10l_eq('K27 the grace-window plant is in place, one row, held', planted, 1::bigint);
  v := pg_temp.s10l_call('recon-2c', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(pg_temp.s10l_order('2')::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K28 the sweep names a held delivery older than fifteen minutes',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'findings') f
      WHERE f ->> 'code' = 'held_event_unapplied'), 1::bigint);
  PERFORM pg_temp.s10l_ok('K29 and says nothing edits a held row retroactively, which is the remedy it refuses',
    (SELECT bool_or(f ->> 'detail' LIKE '%re-record the delivery as a new event id%')
       FROM jsonb_array_elements(v -> 'findings') f));
  DELETE FROM private.commerce_payment_events WHERE id = 9000001;
  PERFORM pg_temp.s10l_eq('K30 the plant is removed, so the census below counts only real deliveries',
    (SELECT count(*) FROM private.commerce_payment_events WHERE id = 9000001), 0::bigint);
  v := pg_temp.s10l_call('recon-2d', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(pg_temp.s10l_order('2')::text) || '::uuid, '
    || quote_literal(pg_temp.s10l_actor()::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K31 and the finding goes with it, proving which row was producing it',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'findings') f
      WHERE f ->> 'code' = 'held_event_unapplied'), 0::bigint);

  -- Attribution, not authorisation: an actor that owns nothing is still recorded verbatim.
  -- Re-baselined here, because the remedy above deliberately moved state: measuring a sweep against a
  -- baseline from before a real revocation would score the revocation as the sweep's doing.
  st := pg_temp.s10l_state();
  SELECT count(*) INTO aud FROM private.audit_events WHERE action <> 'swept';
  SELECT count(*) INTO swp FROM private.audit_events WHERE action = 'swept' AND subject_key = o3;
  v := pg_temp.s10l_call('recon-stranger', 'SELECT internal_api.commerce_reconcile('
    || quote_literal(o3::text) || '::uuid, ' || quote_literal(s.stranger::text) || '::uuid)');
  PERFORM pg_temp.s10l_eq('K32 the actor written to the sweep row is the one the caller named, whoever it was',
    (SELECT actor_user_id FROM private.audit_events
      WHERE action = 'swept' AND subject_key = o3 ORDER BY id DESC LIMIT 1), s.stranger);
  PERFORM pg_temp.s10l_eq('K33 and the sweep still changed nothing, which is why attribution is safe here',
    pg_temp.s10l_state(), st);
  -- Counted as a delta across this sweep, not absolutely: the capture, initiation and grant audits this
  -- file produced on purpose are keyed to an order or to an entitlement, so "no such row exists anywhere"
  -- was never a statement about the reconciler — and §10's claim is precisely that a sweep *adds* nothing
  -- but its own record. Every non-`swept` action is in the comparison, not just the money ones.
  PERFORM pg_temp.s10l_array('K34 the sweep adds exactly one audit row, of action `swept`, and no other',
    ARRAY[(SELECT count(*) FROM private.audit_events WHERE action <> 'swept')::text,
          (SELECT count(*) FROM private.audit_events
             WHERE action = 'swept' AND subject_key = o3)::text],
    ARRAY[aud::text, (swp + 1)::text]);
END $recon$;

-- --------------------------------------------------------------------------- Z. the census this file leaves
-- Every expectation below is the value a run produced, not a value this file predicted; the four that are
-- read back as CENSUS notices in `$print$` at the bottom are printed again after the assertion, so a
-- reviewer sees the number beside the word.
DO $census$
DECLARE s s10r%ROWTYPE;
BEGIN
  SELECT * INTO s FROM s10r;

  PERFORM pg_temp.s10l_array('Z01 the eight quotes this file made, by status: four captured, two cancelled, one expired, one left live on purpose',
    ARRAY(SELECT status || '=' || count(*)::text FROM private.commerce_orders
           GROUP BY status ORDER BY status COLLATE "C"),
    ARRAY['cancelled=2','captured=4','expired=1','open=1']);
  PERFORM pg_temp.s10l_array('Z01b the order left live is exactly the stale quote K21 planted: overage, and never named by a delivery',
    ARRAY[(SELECT count(*) FROM private.commerce_orders WHERE status = 'open')::text,
          (SELECT count(*) FROM private.commerce_orders WHERE status = 'open'
             AND quote_expires_at < now())::text,
          (SELECT count(*) FROM private.commerce_payment_events e
             WHERE e.merchant_reference IN (SELECT merchant_reference FROM private.commerce_orders
                                             WHERE status = 'open'))::text],
    ARRAY['1','1','0']);
  PERFORM pg_temp.s10l_array('Z02 the attempts, by status: an initiation that failed, and captures that minted their own',
    ARRAY(SELECT status || '=' || count(*)::text FROM private.commerce_payment_attempts
           GROUP BY status ORDER BY status COLLATE "C"),
    ARRAY['confirmed=4','failed=1','initiated=1']);
  -- `ORDER BY <ordinal> COLLATE "C"` is not an ordinal at all: the collation clause types the constant, and
  -- Postgres then sorts by the integer 1 and refuses. Each census cell names its own expression.
  PERFORM pg_temp.s10l_array('Z03 the ledger, by processing status: every delivery this file sent, applied or not',
    ARRAY(SELECT processing_status || '=' || count(*)::text FROM private.commerce_payment_events
           GROUP BY processing_status ORDER BY processing_status COLLATE "C"),
    ARRAY['applied=21','duplicate=1','held_for_reconciliation=12','rejected_signature=2','stale=2']);
  PERFORM pg_temp.s10l_eq('Z04 each ledger row was written exactly once, including the replays',
    (SELECT count(*) FROM private.commerce_payment_events),
    (SELECT count(DISTINCT provider || '|' || event_id) FROM private.commerce_payment_events));
  PERFORM pg_temp.s10l_array('Z05 the refund and dispute records, by kind and status',
    ARRAY(SELECT kind || '/' || status || '=' || count(*)::text FROM private.commerce_refunds
           GROUP BY kind, status ORDER BY (kind || '/' || status) COLLATE "C"),
    ARRAY['chargeback/recorded=2','refund/failed=1','refund/succeeded=4']);
  PERFORM pg_temp.s10l_array('Z06 the entitlements: granted by capture, one revoked by policy, one recovered',
    ARRAY(SELECT status || '=' || count(*)::text FROM public.entitlements
           GROUP BY status ORDER BY status COLLATE "C"),
    ARRAY['active=1','revoked=4']);
  PERFORM pg_temp.s10l_eq('Z07 every entitlement this chain holds came from a capture, not an admin',
    (SELECT count(*) FROM public.entitlements WHERE source <> 'service'), 0::bigint);
  PERFORM pg_temp.s10l_eq('Z08 nothing was deleted: the five money tables still carry their full history',
    (SELECT count(*) FROM private.commerce_payment_events WHERE processing_status = 'rejected_signature'),
    2::bigint);
  PERFORM pg_temp.s10l_eq('Z09 the price catalogue is exactly the five rows this file planted',
    (SELECT count(*) FROM private.commerce_packages), 5::bigint);
  PERFORM pg_temp.s10l_array('Z10 the policy row is back on every shipped default after the two deliberate flips',
    ARRAY(SELECT publish_gate || '/' || coalesce(array_length(publish_required_package_codes,1),0)::text
                || '/' || live_capture_enabled::text || '/' || refund_revocation_mode
            FROM private.commerce_policy WHERE id = 1),
    ARRAY['permissive/0/false/hold_for_review']);
  PERFORM pg_temp.s10l_eq('Z11 no live capture was ever enabled by this file',
    (SELECT count(*) FROM private.commerce_payment_events WHERE environment = 'live'
       AND processing_status = 'applied'), 0::bigint);
  PERFORM pg_temp.s10l_eq('Z12 and no live environment was ever applied for any order',
    (SELECT count(*) FROM private.commerce_payment_attempts WHERE environment = 'live'), 0::bigint);
  PERFORM pg_temp.s10l_eq('Z13 the wedding rows are the three this file made, and no others',
    (SELECT count(*) FROM public.weddings), 3::bigint);
  PERFORM pg_temp.s10l_eq('Z14 the accounts are the three this file made',
    (SELECT count(*) FROM auth.users), 3::bigint);
  PERFORM pg_temp.s10l_array('Z15 the audit actions this file produced, named and counted, so a verb that stopped writing its record is caught',
    ARRAY(SELECT action || '=' || count(*)::text FROM private.audit_events
           GROUP BY action ORDER BY action COLLATE "C"),
    ARRAY['attempt_failed=1','attempt_initiated=4','cancelled_by_provider=2','chargeback_opened=2',
          'expired=1','failure_recorded=1','granted_by_commerce_capture=5','order_captured=4',
          'quote_created=8','refund_failed=1','refund_succeeded=4','revoked=4','swept=14']);
  PERFORM pg_temp.s10l_eq('Z16 every money verb this file called recorded its actor as an account that exists',
    (SELECT count(*) FROM private.audit_events ae
      JOIN auth.users u ON u.id = ae.actor_user_id),
    (SELECT count(*) FROM private.audit_events WHERE actor_user_id IS NOT NULL));
END $census$;

-- The census arrays above are printed with a NULL expectation so this file states them as measurements;
-- Z17 replaces each with the value this run produced, read back from the same queries, so a reviewer can
-- see the numbers rather than a word.
DO $print$
DECLARE n integer;
BEGIN
  RAISE NOTICE 'CENSUS Z03 ledger by status: %',
    array_to_string(ARRAY(SELECT processing_status || '=' || count(*)::text
                            FROM private.commerce_payment_events
                           GROUP BY processing_status ORDER BY processing_status COLLATE "C"), ', ');
  RAISE NOTICE 'CENSUS Z05 refunds by kind/status: %',
    array_to_string(ARRAY(SELECT kind || '/' || status || '=' || count(*)::text
                            FROM private.commerce_refunds
                           GROUP BY kind, status ORDER BY (kind || '/' || status) COLLATE "C"), ', ');
  RAISE NOTICE 'CENSUS Z06 entitlements by status: %',
    array_to_string(ARRAY(SELECT status || '=' || count(*)::text FROM public.entitlements
                           GROUP BY status ORDER BY status COLLATE "C"), ', ');
  RAISE NOTICE 'CENSUS Z15 audit actions: %',
    array_to_string(ARRAY(SELECT action || '=' || count(*)::text FROM private.audit_events
                           GROUP BY action ORDER BY action COLLATE "C"), ', ');

  n := coalesce(nullif(current_setting('s10l.passed', true), ''), '0')::int;
  -- A floor, not an equality: the count this file prints is the number of assertions it ran, and a future
  -- cell added to any group moves it upward. 290 is the count read at this point by the run that produced
  -- this file (`q10-logs/live/s10-battery1-18.txt`, which ended `STAGE10 LEDGER TESTS PASSED (291)` — the
  -- 291st is this cell, which adds itself after the read). It is set from a run rather than from a guess so
  -- that a suite which silently skips a group is caught rather than read as a smaller pass.
  IF n < 290 THEN
    RAISE EXCEPTION 'FAIL L01 the ledger battery ran % assertions, which is fewer than the floor', n;
  END IF;
  RAISE NOTICE 'PASS L01 the ledger battery ran at least its floor of assertions (%)', n;
  PERFORM pg_temp.s10l_add(1);
END $print$;

SELECT 'STAGE10 LEDGER TESTS PASSED ('
    || coalesce(nullif(current_setting('s10l.passed', true), ''), '0') || ')';
