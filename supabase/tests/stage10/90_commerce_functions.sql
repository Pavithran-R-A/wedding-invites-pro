-- Stage 10 battery 2: reachability — who can name the money model, and what it answers when a browser asks.
--
-- Battery 1 asks what the state machine decides when a delivery arrives. This file asks the question that
-- makes those decisions mean something: can a request-bearing role reach the rows at all, and can it make
-- the ledger say its wedding has been paid for? Requirement 6 of the Stage 10 brief is a *negative* claim,
-- and a negative claim is only evidence when the four layers that produce it are each measured separately,
-- which is why groups C, R, T and V exist as four groups rather than one.
--
--   A  the residue battery 1 committed, pinned by the titles and emails that cast planted — this file reads
--      those rows rather than re-deriving them, and closes on the same digest it found
--   C  the catalogue: the eight Stage 10 names, each with its posture, its pinned search_path, its owner,
--      its argument list and the exact set of roles holding EXECUTE
--   R  every Stage 10 door called by every request-bearing role, as SQLSTATE *and* sentence
--   T  the table boundary, measured four ways at once: catalog privilege facts, RLS posture, trigger
--      wiring, and live DML refusals by three roles over the six tables
--   H  the host projection: the thirteen derived states over the cast's residue, the amount that appears
--      only under an approved price, and the identically-worded refusals that keep the door from being an
--      enumeration oracle
--   V  the paid-status forgery suite: every write a host can imagine making about its own purchase, and the
--      reading of the projection after each refusal
--   G  the publish gate: inert by default, a refusal when required, never in the way of a revocation, and
--      failing open exactly once, at the posture its own comment names
--   N  §12's negative build: no paid flag, no billing column, no tax or quantity column, no DELETE path for
--      a product role, no webhook door, and an ACL that has actually been written on all seven objects
--   Z  the census this file leaves, and the digest it promised not to move
--   L  the floor
--
-- Four postures, each because the naive version of it is wrong.
--   1. The whole file changes no money row. `s10f_money()` digests the five money tables at A, and Z closes
--      on the same value — including the order this file mints for its own unapproved-price arm, which it
--      deletes again and proves deleted. That is what "unreachable" costs: a battery that could move the
--      ledger could not claim to be measuring a boundary.
--   2. Expectations about *which* layer refuses are derived from a premise the file also asserts
--      (`has_schema_privilege`, `has_table_privilege`), not typed per cell. A matrix that hard-codes 93
--      sentences would pass identically if the grants moved and somebody re-typed them; the derivation
--      fails the moment the premise and the observed sentence disagree.
--   3. `test.role` is set alongside `SET ROLE`, which the Stage 9 harness does not do. The reason is
--      attribution: a refusal reached while `auth.role()` still answered `anon` could have come from a
--      policy that keys on the claimed role rather than from the grant being measured. Here the claim and
--      the role agree, so a 42501 means the grant.
--   4. One arm is expected to be *accepted*, and it is labelled as such rather than quietly passed:
--      `service_role` may write `public.entitlements`, because that is what a trusted backend means and
--      Stage 2 decided it. The finding V12 records is that the boundary is the role, not the row — which is
--      exactly why reachability, not this trigger, is the control. The row it writes is deleted again and the
--      count is proved back (V12-V15).
--
-- What this battery does not claim:
--   1. It is not the HTTP tier. There is no PostgREST here, so `permission denied for function …` is the
--      database's refusal and not a 403, and nothing about a JWT, a schema cache or an OpenAPI listing has
--      been observed. Whether `internal_api` is unreachable over REST is a property of
--      `supabase/config.toml:32`, asserted by the Node contract checker, not by this file.
--   2. It does not verify a provider signature: the deliveries battery 1 acted on carry a declared
--      validity bit, and the HMAC bytes belong to `scripts/stage10-webhook-core.mjs` and the HTTP tier.
--   3. It cannot prove the absence of a webhook *route*; it proves the absence of a webhook-named function
--      and of any commerce door granted to `anon`, which is the database-shaped half of §12.
--   4. The gate arms plant publications, entitlements, versions and weddings directly as the owner, because
--      no product path can put a wedding in the state the gate is asked about while the price is undecided.
--      Every such row is named by a `S10F-` title so a later reader can tell a plant from a cast row, and
--      the policy row this file toggles is restored and proved restored inside the same group.

SET client_min_messages = notice;
SET search_path = public, pg_temp;

SELECT set_config('s10f.passed', '0', false);

-- --------------------------------------------------------------------------- the harness
CREATE FUNCTION pg_temp.s10f_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s10f.passed',
    (coalesce(nullif(current_setting('s10f.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s10f_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s10f_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s10f_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s10f_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s10f_sorted(want text[]) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM unnest(coalesce(want, '{}'::text[])) u(k) $fn$;

CREATE FUNCTION pg_temp.s10f_array(label text, got text[], want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label,
      array_to_string(coalesce(got, ARRAY[]::text[]), ', '),
      array_to_string(coalesce(want, ARRAY[]::text[]), ', ');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s10f_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s10f_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % not an object', label, coalesce(jsonb_typeof(v), 'NULL');
  END IF;
  PERFORM pg_temp.s10f_array(label,
    (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
       FROM jsonb_object_keys(v) k), pg_temp.s10f_sorted(want));
END $fn$;

-- An exact-substring absence over a needle list. `strpos`, not `LIKE`, because the names searched for here
-- contain `_`, which a LIKE pattern would turn into a single-character wildcard and report as absent.
CREATE FUNCTION pg_temp.s10f_absent(label text, hay text, list text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF hay IS NULL THEN
    RAISE EXCEPTION 'FAIL % — nothing was answered, so nothing was proven absent', label;
  END IF;
  IF list IS NULL OR cardinality(list) = 0 THEN
    RAISE EXCEPTION 'FAIL % — the needle list is empty, which proves nothing', label;
  END IF;
  PERFORM pg_temp.s10f_eq(label || ' (carried by none of the ' || cardinality(list) || ' names)',
    coalesce((SELECT min(strpos(hay, n)) FROM unnest(list) n WHERE strpos(hay, n) > 0), 0)::text, '0');
END $fn$;

-- Capture only: the answer is the string a posture produced, and the caller decides what it means.
CREATE FUNCTION pg_temp.s10f_cap(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  BEGIN
    EXECUTE stmt INTO v;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' | ' || SQLERRM;
  END;
  RETURN 'ACCEPTED';
END $fn$;

-- A write probe, for statements that return no rows and therefore cannot go through `EXECUTE … INTO`.
CREATE FUNCTION pg_temp.s10f_cap_write(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' | ' || SQLERRM;
  END;
  RETURN 'ACCEPTED';
END $fn$;

-- The posture probe: switch role, claim the uid and the role in the two GUCs `auth.uid()`/`auth.role()`
-- read, run, switch back. `RESET ROLE` runs on both paths because a probe that left the session inside
-- `authenticated` would make every later cell answer as the wrong caller — and because `s10f_cap` swallows
-- the statement's own exception, the ordinary answer is the success path, so the reset belongs there too.
-- `s10f_untrusted` is in the allowed list because group T fabricates that role for exactly one purpose,
-- stated in the group: no request-bearing role holds a table grant on `private`, so the trigger layer is
-- otherwise unreachable live and would be measured only as a catalog row.
CREATE FUNCTION pg_temp.s10f_try(p_role text, p_uid text, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role', 's10f_untrusted') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  PERFORM set_config('test.uid', coalesce(p_uid, ''), false);
  PERFORM set_config('test.role', p_role, false);
  BEGIN
    v := pg_temp.s10f_cap(stmt);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL: probe harness broke on % — %', stmt, SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $fn$;

-- The same, for a write.
CREATE FUNCTION pg_temp.s10f_try_write(p_role text, p_uid text, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role', 's10f_untrusted') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  PERFORM set_config('test.uid', coalesce(p_uid, ''), false);
  PERFORM set_config('test.role', p_role, false);
  BEGIN
    v := pg_temp.s10f_cap_write(stmt);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL: probe harness broke on % — %', stmt, SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $fn$;

-- A call that must answer with a value. A refusal here is a broken battery, not a measured result, except
-- in the cells whose whole subject is the refusal — those go through `s10f_try`.
CREATE FUNCTION pg_temp.s10f_call(p_role text, p_uid text, stmt text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  PERFORM set_config('test.uid', coalesce(p_uid, ''), false);
  PERFORM set_config('test.role', p_role, false);
  BEGIN
    EXECUTE stmt INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('_error', SQLSTATE || ' | ' || SQLERRM);
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $fn$;

-- The projection, read the way the host reads it: through `api`, as `authenticated`, with the wedding the
-- caller claims to own.
CREATE FUNCTION pg_temp.s10f_sum(p_uid text, p_wed text) RETURNS jsonb
LANGUAGE sql AS $fn$
  SELECT pg_temp.s10f_call('authenticated', p_uid,
    'SELECT api.commerce_host_summary(' || quote_literal(p_wed) || '::uuid)')
$fn$;

-- A delivery applied through the ledger's only writer rather than planted into the table. Group H needs an
-- order in a state the *state machine* produced — pending, with a failed attempt behind it — and a
-- projection proven only against hand-made rows would be measuring this file, not the product. Same
-- posture as battery 1's cast: `record_commerce_event` is SECURITY INVOKER and the chain runs as its owner.
CREATE FUNCTION pg_temp.s10f_deliver(
  p_event_id text, p_kind text, p_ref text, p_amount bigint,
  p_order_ref text, p_pay_ref text, p_actor uuid,
  p_occurred timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  BEGIN
    SELECT internal_api.record_commerce_event(
      'razorpay', p_event_id, 'payment.candidate.' || p_kind, p_kind, 'synthetic',
      md5(p_event_id) || md5(p_event_id || '|body'), true, NULL, p_ref,
      p_amount, 'INR', p_order_ref, p_pay_ref, coalesce(p_occurred, now()), p_actor) INTO v;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('_error', SQLSTATE || ' | ' || SQLERRM);
  END;
  RETURN v;
END $fn$;

-- The same money digest battery 1 uses for the five money tables, plus `commerce_packages`: this file must
-- not move any of them, so the baseline is taken at A and closed at Z. `commerce_policy` is deliberately
-- outside the digest because G toggles it on purpose and restores it; §12's closing cells prove the restore.
CREATE FUNCTION pg_temp.s10f_money() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(t, '~' ORDER BY t COLLATE "C"), '')) FROM (
    SELECT 'o|' || id::text || '|' || status || '|' || coalesce(captured_at::text,'')
           || '|' || coalesce(closed_at::text,'') || '|' || coalesce(quote_expires_at::text,'')
           || '|' || coalesce(entitlement_id::text,'') || '|' || amount_minor::text || '|'
           || currency || '|' || package_code || '|' || price_version::text || '|'
           || merchant_reference || '|' || wedding_id::text || '|' || coalesce(owner_user_id::text,'') AS t
      FROM private.commerce_orders
    UNION ALL
    SELECT 'a|' || id::text || '|' || order_id::text || '|' || provider || '|' || status || '|'
           || coalesce(provider_order_ref,'') || '|' || coalesce(provider_payment_ref,'')
      FROM private.commerce_payment_attempts
    UNION ALL
    SELECT 'e|' || id::text || '|' || provider || '|' || event_id || '|' || kind || '|'
           || coalesce(order_id::text,'') || '|' || coalesce(attempt_id::text,'') || '|'
           || processing_status || '|' || coalesce(applied_effect,'') || '|'
           || coalesce(hold_reason,'') || '|' || coalesce(amount_minor::text,'') || '|'
           || coalesce(currency,'') || '|' || coalesce(environment,'') || '|'
           || signature_valid::text
      FROM private.commerce_payment_events
    UNION ALL
    SELECT 'r|' || id::text || '|' || order_id::text || '|' || kind || '|' || status || '|'
           || coalesce(amount_minor::text,'') || '|' || coalesce(completed_at::text,'')
      FROM private.commerce_refunds
    UNION ALL
    SELECT 'p|' || id::text || '|' || package_code || '|' || currency || '|' || amount_minor::text
           || '|' || price_version::text || '|' || status || '|' || display_approved::text || '|'
           || coalesce(retired_at::text,'')
      FROM private.commerce_packages
  ) d $fn$;

-- EXECUTE holders of one function, as role names, with the owner's own implicit privilege excluded. The
-- grantee list is read out of the catalog so no cell in group C depends on this file remembering a grant.
CREATE FUNCTION pg_temp.s10f_exec(p_oid regprocedure) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(r.rolname ORDER BY r.rolname COLLATE "C"), '{}'::text[])
    FROM pg_proc p, aclexplode(p.proacl) x
    JOIN pg_roles r ON r.oid = x.grantee
   WHERE p.oid = p_oid
     AND x.privilege_type = 'EXECUTE'
     AND x.grantee <> p.proowner $fn$;

CREATE FUNCTION pg_temp.s10f_polcount(p_rel regclass) RETURNS bigint
LANGUAGE sql STABLE AS $fn$
  -- `pg_policy`, not `pg_policies`: the view has no `polrelid` to match a regclass against, so the view
  -- version of this cell would raise rather than report zero, which is not the same as being empty.
  SELECT count(*) FROM pg_policy WHERE polrelid = p_rel $fn$;

-- A publication written through the gate, as one of two postures, with the answer kept as a string.
CREATE FUNCTION pg_temp.s10f_pub(p_role text, p_uid text, p_wed text, p_ver text, p_status text)
RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  v := pg_temp.s10f_try_write(p_role, p_uid,
    'INSERT INTO public.publications (wedding_id, version_id, status) VALUES ('
    || quote_literal(p_wed) || '::uuid, ' || quote_literal(p_ver) || '::uuid, '
    || quote_literal(p_status) || '::text)');
  RETURN v;
END $fn$;

CREATE FUNCTION pg_temp.s10f_pubcount(p_wed text) RETURNS bigint
LANGUAGE sql STABLE AS $fn$
  SELECT count(*) FROM public.publications
   WHERE wedding_id = p_wed::uuid AND status = 'active' $fn$;

-- The head this battery is being measured at. Stage 10 wrote no such helper because Stage 10's pair had
-- never run behind its own head; `supabase/tests/stage11/run.sh regress` is the first sweep that re-runs
-- it at a later one, and it refused on the first cell whose expectation is a closed privilege inventory
-- (`q11-logs/s11-regress-1.txt`). Cumulative and ordinal for the reason `40_catalog.sql` gives: a census
-- keyed on `= 'stage11'` would hand the Stage 12 chain Stage 10's numbers, and a malformed head raises
-- rather than quietly choosing a branch. The default when the GUC is unset is this battery's own head, so
-- `stage10/run.sh` measures exactly what it always measured.
CREATE FUNCTION pg_temp.s10f_head() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(nullif(current_setting('app.stage_head', true), ''), 'stage10') $fn$;

CREATE FUNCTION pg_temp.s10f_at_least(want text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $fn$
DECLARE h int; w int;
BEGIN
  IF pg_temp.s10f_head() !~ '^stage[0-9]+$' OR want !~ '^stage[0-9]+$' THEN
    RAISE EXCEPTION 's10f_at_least: a stage head must be spelled stage<n> — got head=% want=%',
      pg_temp.s10f_head(), want;
  END IF;
  h := regexp_replace(pg_temp.s10f_head(), '^stage', '')::int;
  w := regexp_replace(want, '^stage', '')::int;
  RETURN h >= w;
END
$fn$;

-- --------------------------------------------------------------------------- the probe matrix
CREATE TEMP TABLE probes (
  grp         text,
  label       text,
  stmt        text,
  want_state  text,
  want_like   text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.s10f_err_only(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' | ' || SQLERRM;
END $fn$;

CREATE FUNCTION pg_temp.s10f_run(p_grp text, p_role text, p_uid text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  v_labels text[];
  v_stmts  text[];
  v_states text[];
  v_likes  text[];
  v        text;
  i        integer;
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role', 's10f_untrusted') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;

  SELECT array_agg(label), array_agg(stmt), array_agg(want_state), array_agg(want_like)
    INTO v_labels, v_stmts, v_states, v_likes
    FROM (SELECT p.label, p.stmt, p.want_state, p.want_like
            FROM probes p WHERE p.grp = s10f_run.p_grp ORDER BY p.label) s;

  IF v_labels IS NULL THEN
    RAISE EXCEPTION 'FAIL: probe group % ran no probes — an empty group is a skip, not a pass', p_grp;
  END IF;

  FOR i IN 1 .. cardinality(v_labels) LOOP
    BEGIN
      EXECUTE 'SET ROLE ' || p_role;
      PERFORM set_config('test.uid', coalesce(p_uid, ''), false);
      PERFORM set_config('test.role', p_role, false);
      v := pg_temp.s10f_err_only(v_stmts[i]);
      EXECUTE 'RESET ROLE';
    EXCEPTION WHEN OTHERS THEN
      EXECUTE 'RESET ROLE';
      RAISE EXCEPTION 'FAIL %: the probe harness itself broke on "%" — %',
        p_grp, v_labels[i], SQLERRM;
    END;

    IF v = 'no-error' THEN
      RAISE EXCEPTION 'FAIL %: "%" was allowed through', p_grp, v_labels[i];
    END IF;
    IF split_part(v, ' | ', 1) <> v_states[i] OR v NOT LIKE v_likes[i] THEN
      RAISE EXCEPTION 'FAIL %: "%" got [%] want [% / %]',
        p_grp, v_labels[i], v, v_states[i], v_likes[i];
    END IF;
    RAISE NOTICE 'PASS %: %', p_grp, v_labels[i];
    PERFORM pg_temp.s10f_add(1);
  END LOOP;
END $fn$;

-- --------------------------------------------------------------------------- A. the residue, pinned
-- Battery 1 commits, so its cast is this file's fixture. Pinning it by the titles and emails that cast
-- wrote — rather than by counts — is what lets a cell say "the order battery 1 left on wedding A" instead
-- of "some row". A missing pin is a hard failure at the top of the file, not a vacuous group further down.
CREATE TEMP TABLE s10res ON COMMIT DROP AS
SELECT (SELECT id FROM public.weddings WHERE title = 'Ledger A weds B') AS wed_a,
       (SELECT id FROM public.weddings WHERE title = 'Ledger C weds D') AS wed_b,
       (SELECT id FROM public.weddings WHERE title = 'Ledger E weds F') AS wed_c,
       (SELECT id FROM auth.users WHERE email = 's10-owner-a@stage10qual.test') AS owner_a,
       (SELECT id FROM auth.users WHERE email = 's10-owner-b@stage10qual.test') AS owner_b,
       (SELECT id FROM auth.users WHERE email = 's10-stranger@stage10qual.test') AS stranger;

DO $pin$
DECLARE s s10res%ROWTYPE; v jsonb;
BEGIN
  SELECT * INTO s FROM s10res;
  IF s.wed_a IS NULL OR s.wed_b IS NULL OR s.wed_c IS NULL
     OR s.owner_a IS NULL OR s.owner_b IS NULL OR s.stranger IS NULL THEN
    RAISE EXCEPTION 'FAIL A00 the cast battery 1 left cannot be pinned — a title or email is missing, '
      'so this file would be measuring an empty database and reporting it as a boundary';
  END IF;

  PERFORM set_config('s10f.wed_a', s.wed_a::text, false);
  PERFORM set_config('s10f.wed_b', s.wed_b::text, false);
  PERFORM set_config('s10f.wed_c', s.wed_c::text, false);
  PERFORM set_config('s10f.owner_a', s.owner_a::text, false);
  PERFORM set_config('s10f.owner_b', s.owner_b::text, false);
  PERFORM set_config('s10f.stranger', s.stranger::text, false);

  -- The door names its own row. `commerce_host_summary` ranks an wedding's orders by status and then by
  -- `created_at`, and battery 1's four orders on wedding A were all written in one transaction, so the
  -- tie-break inside the top rank is heap order rather than a rule this file could re-type: pinning by
  -- `ORDER BY created_at DESC LIMIT 1` here would name a different row from the one the host is shown.
  -- So this file asks the host door which order it means, and pins that one by the reference it printed --
  -- a column `commerce_orders_merchant_reference_key` makes unique across the whole ledger.
  v := pg_temp.s10f_sum(s.owner_a::text, s.wed_a::text);
  PERFORM set_config('s10f.mref', coalesce(v ->> 'merchant_reference', ''), false);
  PERFORM set_config('s10f.ord', coalesce((SELECT o.id::text FROM private.commerce_orders o
    WHERE o.merchant_reference = v ->> 'merchant_reference'), ''), false);

  PERFORM pg_temp.s10f_eq('A01 the residue is five cast weddings — battery 1''s three, group P''s order and the flap''s own — and the three this file names are the ones pinned above',
    (SELECT count(*) FROM public.weddings WHERE title LIKE 'Ledger %'), 5::bigint);
  PERFORM pg_temp.s10f_eq('A02 and the three cast users',
    (SELECT count(*) FROM auth.users WHERE email LIKE 's10-%@stage10qual.test'), 3::bigint);
  PERFORM pg_temp.s10f_ok('A03 wedding A carries at least one order, so group R can name a real one',
    (SELECT count(*) FROM private.commerce_orders WHERE wedding_id = s.wed_a) >= 1);
  PERFORM pg_temp.s10f_eq('A04 the shipped price catalogue is still the cast''s six rows',
    (SELECT count(*) FROM private.commerce_packages), 6::bigint);
  PERFORM pg_temp.s10f_eq('A05 and the policy row is still the single row the gate reads',
    (SELECT count(*) FROM private.commerce_policy), 1::bigint);
  PERFORM pg_temp.s10f_eq('A06 it is still permissive when this file starts, because G has not run yet',
    (SELECT publish_gate FROM private.commerce_policy WHERE id = 1), 'permissive');
  PERFORM pg_temp.s10f_ok('A07 an order id and a merchant reference were pinned, and neither is empty',
    coalesce(nullif(current_setting('s10f.ord', true), ''), '')::uuid IS NOT NULL
    AND length(coalesce(nullif(current_setting('s10f.mref', true), ''), '')) > 0);

  -- The three cells below are the pin earning its keep: the row named is the row the door means, it belongs
  -- to wedding A, and it is one of the rows the door ranks first.
  PERFORM pg_temp.s10f_eq('A08 the pinned order belongs to wedding A',
    (SELECT o.wedding_id FROM private.commerce_orders o
      WHERE o.id = current_setting('s10f.ord')::uuid), s.wed_a);
  PERFORM pg_temp.s10f_ok('A09 and it is in the rank the door puts first, so group R names a live quote or capture',
    (SELECT o.status IN ('open', 'payment_pending', 'captured') FROM private.commerce_orders o
      WHERE o.id = current_setting('s10f.ord')::uuid));
  PERFORM pg_temp.s10f_eq('A10 and exactly one order in the ledger carries that reference, which is what makes the pin a pin',
    (SELECT count(*) FROM private.commerce_orders o
      WHERE o.merchant_reference = current_setting('s10f.mref')), 1::bigint);
  -- Stated rather than smoothed over: the door''s tie-break is not a rule on this residue, and a reader of
  -- the residue should be told that the ordering above is the reason the pin does not use it.
  PERFORM pg_temp.s10f_ok('A11 wedding A does carry several orders in the door''s first rank, all with one created_at',
    (SELECT count(*) FROM private.commerce_orders o WHERE o.wedding_id = s.wed_a
       AND o.status IN ('open', 'payment_pending', 'captured')) > 1
    AND (SELECT count(DISTINCT o.created_at) FROM private.commerce_orders o WHERE o.wedding_id = s.wed_a) = 1);

  PERFORM set_config('s10f.money0', pg_temp.s10f_money(), false);
  PERFORM set_config('s10f.audit0',
    (SELECT count(*)::text FROM private.audit_events), false);
END $pin$;

-- --------------------------------------------------------------------------- C. the eight names, as catalog rows
-- §9's claim about the six service bodies is three things at once: SECURITY INVOKER, no EXECUTE grant for
-- anybody, and owned by `postgres` so the trusted maintenance connection is what reaches them. §10's claim
-- about the pair is the mirror: the implementation is DEFINER *because* it re-derives the caller from
-- `auth.uid()`, and the wrapper is INVOKER with a body too small to hide a decision in. Each is measured
-- here from `pg_proc` rather than inferred from a REVOKE statement in a file that might not have run.
DO $cat$
DECLARE
  -- The names are what `pg_get_function_identity_arguments` returns, which means they carry parameter
  -- names (`p_wedding_id uuid`, not `uuid`) and spell the datetime type out in full. They were read off
  -- the catalog at this head rather than typed from the migration's argument list, because the two forms
  -- differ in exactly the way that makes a `= ANY` list match nothing and a count come out short.
  n text;
  s10 text[] = ARRAY[
    'internal_api.create_commerce_order(p_wedding_id uuid, p_package_code text, p_actor_user_id uuid)',
    'internal_api.grant_commerce_entitlement(p_order_id uuid, p_actor_user_id uuid)',
    'internal_api.revoke_commerce_entitlement(p_order_id uuid, p_actor_user_id uuid, p_reason text)',
    'internal_api.expire_commerce_order(p_order_id uuid, p_actor_user_id uuid)',
    'internal_api.record_commerce_event(p_provider text, p_event_id text, p_event_type text, p_kind text, p_environment text, p_raw_body_sha256 text, p_delivery_verified boolean, p_refusal_reason text, p_merchant_reference text, p_amount_minor bigint, p_currency text, p_provider_order_ref text, p_provider_payment_ref text, p_occurred_at timestamp with time zone, p_actor_user_id uuid)',
    'internal_api.commerce_reconcile(p_order_id uuid, p_actor_user_id uuid)',
    'internal_api.commerce_host_summary(p_wedding_id uuid)',
    'api.commerce_host_summary(p_wedding_id uuid)'];
  svc text[] = ARRAY['internal_api.create_commerce_order(p_wedding_id uuid, p_package_code text, p_actor_user_id uuid)',
                     'internal_api.grant_commerce_entitlement(p_order_id uuid, p_actor_user_id uuid)',
                     'internal_api.revoke_commerce_entitlement(p_order_id uuid, p_actor_user_id uuid, p_reason text)',
                     'internal_api.expire_commerce_order(p_order_id uuid, p_actor_user_id uuid)',
                     'internal_api.record_commerce_event(p_provider text, p_event_id text, p_event_type text, p_kind text, p_environment text, p_raw_body_sha256 text, p_delivery_verified boolean, p_refusal_reason text, p_merchant_reference text, p_amount_minor bigint, p_currency text, p_provider_order_ref text, p_provider_payment_ref text, p_occurred_at timestamp with time zone, p_actor_user_id uuid)',
                     'internal_api.commerce_reconcile(p_order_id uuid, p_actor_user_id uuid)'];
  v pg_proc%ROWTYPE;
  v_owner text;
  v_args  text;
BEGIN
  -- Every name in the list resolves to exactly one row. An overload would make the rest of the group's
  -- per-name assertions meaningless, so it is caught rather than assumed.
  PERFORM pg_temp.s10f_eq('C01 all eight Stage 10 names resolve, one row each',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace x ON x.oid = p.pronamespace
      WHERE x.nspname || '.' || p.proname ||
            '(' || pg_get_function_identity_arguments(p.oid) || ')' = ANY (s10)), 8::bigint);

  FOREACH n IN ARRAY s10 LOOP
    SELECT * INTO v FROM pg_proc p JOIN pg_namespace x ON x.oid = p.pronamespace
     WHERE x.nspname || '.' || p.proname ||
           '(' || pg_get_function_identity_arguments(p.oid) || ')' = n;
    SELECT r.rolname::text INTO v_owner FROM pg_roles r WHERE r.oid = v.proowner;

    -- The sixth element is the role set the catalog actually grants EXECUTE to, named rather than
    -- counted, and it is limited to the three request-bearing roles: `postgres` is a superuser, so
    -- `has_function_privilege` answers true for it whatever the ACL says and a superuser in this list
    -- would say nothing about who can call the door.
    IF n = ANY (svc) THEN
      PERFORM pg_temp.s10f_array('C the posture of ' || n,
        ARRAY[v.prosecdef::text, coalesce(array_to_string(v.proconfig, ','), '(none)'),
              v_owner, v.provolatile::text,
              coalesce(nullif(array_to_string(pg_temp.s10f_exec(v.oid), ','), ''), '(none)'),
              coalesce((SELECT string_agg(e.rolname, ',' ORDER BY e.rolname COLLATE "C") FROM pg_roles e
                         WHERE e.rolname IN ('anon','authenticated','service_role')
                           AND has_function_privilege(e.rolname, v.oid, 'EXECUTE')), '(none)')],
        ARRAY['false', 'search_path=""', 'postgres', 'v', '(none)', '(none)']);
    ELSIF n = 'internal_api.commerce_host_summary(p_wedding_id uuid)' THEN
      PERFORM pg_temp.s10f_array('C the posture of the re-deriving implementation',
        ARRAY[v.prosecdef::text, coalesce(array_to_string(v.proconfig, ','), '(none)'),
              v_owner, v.provolatile::text,
              coalesce(nullif(array_to_string(pg_temp.s10f_exec(v.oid), ','), ''), '(none)'),
              coalesce((SELECT string_agg(e.rolname, ',' ORDER BY e.rolname COLLATE "C") FROM pg_roles e
                         WHERE e.rolname IN ('anon','authenticated','service_role')
                           AND has_function_privilege(e.rolname, v.oid, 'EXECUTE')), '(none)')],
        ARRAY['true', 'search_path=""', 'postgres', 's', 'authenticated', 'authenticated']);
    ELSE
      PERFORM pg_temp.s10f_array('C the posture of the exposed wrapper',
        ARRAY[v.prosecdef::text, coalesce(array_to_string(v.proconfig, ','), '(none)'),
              v_owner, v.provolatile::text,
              coalesce(nullif(array_to_string(pg_temp.s10f_exec(v.oid), ','), ''), '(none)'),
              coalesce((SELECT string_agg(e.rolname, ',' ORDER BY e.rolname COLLATE "C") FROM pg_roles e
                         WHERE e.rolname IN ('anon','authenticated','service_role')
                           AND has_function_privilege(e.rolname, v.oid, 'EXECUTE')), '(none)')],
        ARRAY['false', 'search_path=""', 'postgres', 's', 'authenticated', 'authenticated']);
    END IF;
  END LOOP;

  -- The wrapper's body, measured instead of trusted to a review: one statement, a delegation, and nothing
  -- in it that could decide anything. §10 says the wrapper's only decision is which implementation to hand
  -- its arguments to, and that is checkable as a property of the text PostgreSQL stored.
  SELECT prosrc INTO v_args FROM pg_proc p JOIN pg_namespace x ON x.oid = p.pronamespace
   WHERE x.nspname = 'api' AND p.proname = 'commerce_host_summary';
  PERFORM pg_temp.s10f_eq('C the stored body of the wrapper is exactly the delegation',
    btrim(regexp_replace(v_args, '[[:space:]]+', ' ', 'g')),
    'SELECT internal_api.commerce_host_summary(p_wedding_id);');
  PERFORM pg_temp.s10f_eq('C and it carries one statement',
    (SELECT count(*) FROM regexp_split_to_table(v_args, ';') t(x)
      WHERE x ~ '\S'), 1::bigint);
  PERFORM pg_temp.s10f_absent('C and it holds no decision of its own',
    upper(v_args), ARRAY[' IF ', ' PERFORM ', ' RAISE ', ' EXECUTE ', ' UPDATE ', ' INSERT ',
                          ' DELETE ', ' auth.uid', ' COALESCE', ' CASE']);

  -- Argument names, because C29b's rule is about what a client can put in a query string: no
  -- credential-shaped argument may exist on an exposed door. The list is read from the catalog, so a new
  -- argument added by a later migration is caught by the rule rather than by this file's typing.
  PERFORM pg_temp.s10f_eq('C no Stage 10 argument on either exposed schema is credential-shaped',
    (SELECT count(*) FROM pg_proc p
      JOIN pg_namespace x ON x.oid = p.pronamespace
      JOIN unnest(p.proargnames) a(name) ON true
     WHERE x.nspname IN ('api','internal_api')
       AND p.proname LIKE 'commerce%'
       AND a.name ~* '(token|secret|signature|hmac|key|password|credential)'), 0::bigint);

  -- §9's nested-call posture: the six bodies are INVOKER, so `record_commerce_event` reaching the grant
  -- and revoke steps is privilege-checked against the role that issued the statement, not a definer.
  PERFORM pg_temp.s10f_eq('C every service body in internal_api is SECURITY INVOKER and pinned',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace x ON x.oid = p.pronamespace
      WHERE x.nspname = 'internal_api' AND p.proname LIKE '%commerce%'
        AND p.prosecdef = false AND p.proconfig @> ARRAY['search_path=""']), 6::bigint);
END $cat$;

-- --------------------------------------------------------------------------- R. every door, every role
-- The seven `internal_api` names plus the exposed wrapper, called by each request-bearing role. Expectations
-- are derived, per role, from whether that role holds USAGE on the schema — asserted as premises in T and
-- measured here as a sentence — so the matrix says *which* layer refused rather than only that something did.
DO $rprobes$
DECLARE
  s s10res%ROWTYPE;
  ord uuid; mref text;
  body text;
BEGIN
  SELECT * INTO s FROM s10res;
  ord := current_setting('s10f.ord')::uuid;
  mref := current_setting('s10f.mref');

  -- Every pair that the role can actually execute is left out of this matrix rather than asserted against,
  -- because a cell that expected a refusal where the grant allows the call would fail — and, worse, would
  -- tempt somebody to revoke a grant the product needs. R2 below is the census that makes the skips
  -- auditable: it names exactly which doors each request-bearing role may execute.
  INSERT INTO probes (grp, label, stmt, want_state, want_like)
  SELECT g.grp || '.' || r.role,
         'R1 ' || g.name || ' as ' || r.role,
         'SELECT ' || g.name || '(' || g.args || ')',
         '42501',
         -- USAGE answers before the function grant, so the sentence is the one the *first* missing layer
         -- emits. Deriving it from the catalog means the cell states which layer refused, and a later
         -- migration that moves the boundary moves a named cell instead of passing silently.
         CASE WHEN has_schema_privilege(r.role, g.sch, 'USAGE')
              THEN '%permission denied for function ' || split_part(g.name, '.', 2) || '%'
              ELSE '%permission denied for schema ' || g.sch || '%' END
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(role),
    (VALUES
      ('Ra', 'internal_api.create_commerce_order',
        quote_literal(s.wed_a::text) || '::uuid, ' || quote_literal('QCLASSIC') || ', '
        || quote_literal(s.owner_a::text) || '::uuid', 'internal_api'),
      ('Ra', 'internal_api.grant_commerce_entitlement',
        quote_literal(ord::text) || '::uuid, ' || quote_literal(s.owner_a::text) || '::uuid', 'internal_api'),
      ('Ra', 'internal_api.revoke_commerce_entitlement',
        quote_literal(ord::text) || '::uuid, ' || quote_literal(s.owner_a::text) || '::uuid, '
        || quote_literal('qualification probe'), 'internal_api'),
      ('Ra', 'internal_api.expire_commerce_order',
        quote_literal(ord::text) || '::uuid, ' || quote_literal(s.owner_a::text) || '::uuid', 'internal_api'),
      ('Ra', 'internal_api.record_commerce_event',
        quote_literal('razorpay') || ', ' || quote_literal('s10f-probe-event') || ', '
        || quote_literal('payment.candidate.payment_captured') || ', '
        || quote_literal('payment_captured') || ', ' || quote_literal('synthetic') || ', '
        || quote_literal(md5('s10f') || md5('s10f-probe')) || ', true, NULL, '
        || quote_literal(mref) || ', 499900, ' || quote_literal('INR') || ', '
        || quote_literal('order_probe') || ', ' || quote_literal('pay_probe') || ', now(), '
        || quote_literal(s.owner_a::text) || '::uuid', 'internal_api'),
      ('Ra', 'internal_api.commerce_reconcile',
        quote_literal(ord::text) || '::uuid, ' || quote_literal(s.owner_a::text) || '::uuid', 'internal_api'),
      ('Ra', 'internal_api.commerce_host_summary',
        quote_literal(s.wed_a::text) || '::uuid', 'internal_api'),
      ('Ra', 'api.commerce_host_summary',
        quote_literal(s.wed_a::text) || '::uuid', 'api')
    ) g(grp, name, args, sch)
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname || '.' || p.proname = g.name
                        AND has_function_privilege(r.role, p.oid, 'EXECUTE'));
END $rprobes$;

SELECT pg_temp.s10f_run('Ra.anon', 'anon', NULL);
SELECT pg_temp.s10f_run('Ra.authenticated', 'authenticated', current_setting('s10f.owner_a'));
SELECT pg_temp.s10f_run('Ra.service_role', 'service_role', NULL);

-- R1's matrix skips the doors a role may execute, so the skips are named here instead of left implicit: a
-- later migration that quietly grants `authenticated` into the money schema would move one of these three
-- lists, which is the thing a refusal-only matrix cannot see.
DO $rcensus$
DECLARE s s10res%ROWTYPE; v text;
BEGIN
  SELECT * INTO s FROM s10res;

  -- Head-aware because this predicate is a name pattern rather than a Stage 10 declaration: it asks "which
  -- doors containing `commerce` may a browser role execute", and Stage 11 slice 4 legitimately answers six.
  -- Its two new pairs — the finance desk's queue and its note door, each an `api` wrapper over an
  -- `internal_api` body — are granted to `authenticated` for the same measured reason §9 gave for the host
  -- projection: the grant is the only way in, and the authority is the body re-deriving `auth.uid()` and
  -- matching it against a live `finance_review` row in `private.operator_grants`, so the signed-in customer
  -- that is not on the desk gets `insufficient_privilege` rather than the queue. Nothing here can move
  -- money: the queue reads a completed refund, and the note door only inserts — its UPDATE trigger names no
  -- role at all and lets exactly the database's own referential null through, and its DELETE backstop is the
  -- same one N04 measures for the rest of the money model. The
  -- pattern's two negatives, R21 and R22, are untouched and still empty — `anon` and `service_role` gained
  -- no commerce door.
  PERFORM pg_temp.s10f_array('R20 the doors `authenticated` may execute are exactly the '
    || CASE WHEN pg_temp.s10f_at_least('stage11') THEN 'six — the host projection pair plus the '
            || 'finance desk''s queue-and-note pair and the two bodies behind them'
            ELSE 'two projections' END,
    ARRAY(SELECT n.nspname || '.' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api','internal_api') AND p.proname LIKE '%commerce%'
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      ORDER BY 1),
    CASE WHEN pg_temp.s10f_at_least('stage11') THEN
      ARRAY['api.commerce_host_summary', 'api.operator_add_commerce_review_note',
            'api.operator_commerce_review_queue', 'internal_api.commerce_host_summary',
            'internal_api.operator_add_commerce_review_note',
            'internal_api.operator_commerce_review_queue']
    ELSE ARRAY['api.commerce_host_summary', 'internal_api.commerce_host_summary'] END);

  PERFORM pg_temp.s10f_array('R21 and `anon` may execute none of the eight',
    ARRAY(SELECT n.nspname || '.' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api','internal_api') AND p.proname LIKE '%commerce%'
        AND has_function_privilege('anon', p.oid, 'EXECUTE')
      ORDER BY 1),
    ARRAY[]::text[]);

  PERFORM pg_temp.s10f_array('R22 nor may `service_role`, which is trusted at the table, not at the door',
    ARRAY(SELECT n.nspname || '.' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api','internal_api') AND p.proname LIKE '%commerce%'
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      ORDER BY 1),
    ARRAY[]::text[]);

  -- The positive half: the grant that survives is the one the host is actually served, and it answers.
  v := pg_temp.s10f_try('authenticated', s.owner_a::text,
    'SELECT api.commerce_host_summary(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM pg_temp.s10f_eq('R23 the exposed door answers for the wedding its caller owns', v, 'ACCEPTED');
END $rcensus$;

-- The two doors a browser is actually given, in the four postures that must not be distinguishable. This is
-- the enumeration claim: a host that cannot tell "not yours" from "does not exist" cannot be walked through
-- another family's wedding ids.
DO $h4$
DECLARE s s10res%ROWTYPE; v text; w text; x text; y text;
BEGIN
  SELECT * INTO s FROM s10res;
  v := pg_temp.s10f_try('authenticated', s.owner_b::text,
    'SELECT api.commerce_host_summary(' || quote_literal(s.wed_a::text) || '::uuid)');
  w := pg_temp.s10f_try('authenticated', s.stranger::text,
    'SELECT api.commerce_host_summary(' || quote_literal(s.wed_a::text) || '::uuid)');
  x := pg_temp.s10f_try('authenticated', s.owner_a::text,
    'SELECT api.commerce_host_summary(' || quote_literal(gen_random_uuid()::text) || '::uuid)');
  y := pg_temp.s10f_try('authenticated', NULL,
    'SELECT api.commerce_host_summary(' || quote_literal(s.wed_a::text) || '::uuid)');

  PERFORM pg_temp.s10f_eq('R05 another owner''s wedding is refused on the privilege code, by sentence',
    v, '42501 | the caller may not read this wedding');
  PERFORM pg_temp.s10f_eq('R06 and a caller who owns nothing anywhere gets the identical answer',
    w, '42501 | the caller may not read this wedding');
  PERFORM pg_temp.s10f_eq('R07 and so does a wedding that does not exist at all',
    x, '42501 | the caller may not read this wedding');
  PERFORM pg_temp.s10f_eq('R08 and a caller with no claimed uid at all',
    y, '42501 | the caller may not read this wedding');
  PERFORM pg_temp.s10f_eq('R09 the four refusals are byte-identical, so the door is not an enumeration oracle',
    (SELECT count(DISTINCT t) FROM unnest(ARRAY[v, w, x, y]) t), 1::bigint);
END $h4$;

-- --------------------------------------------------------------------------- T. the table boundary, four layers
-- The migration's §11 claim is that four independent layers have to fail before a browser can name a money
-- row. Layer 1 is the written ACL, layer 2 is RLS with no policy, layer 3 is the trigger, layer 4 is the
-- function grant measured in C and R. Each gets its own cells here because a single live probe can only
-- ever reach the outermost one — and a battery that only ran live probes would report "denied" while the
-- layer that denied it silently disappeared.
-- `updcol` is a column that exists and is assignable on each table, read off the catalog at this head:
-- `commerce_payment_events` is append-only and has no `updated_at`, which is why the uniform probe shape
-- below cannot hard-code one column name.
CREATE TEMP TABLE s10tbl ON COMMIT DROP AS
SELECT t.name, ('private.' || t.name)::regclass AS rel, t.updcol FROM (VALUES
  ('commerce_packages', 'updated_at'), ('commerce_orders', 'updated_at'),
  ('commerce_payment_attempts', 'updated_at'), ('commerce_payment_events', 'environment'),
  ('commerce_refunds', 'updated_at'), ('commerce_policy', 'updated_at')) t(name, updcol);

CREATE TEMP TABLE s10tguard ON COMMIT DROP AS
SELECT t.name, t.expect FROM (VALUES
  ('commerce_packages',
    ARRAY['commerce_packages_no_client_delete=reject_client_delete',
          'commerce_packages_no_client_write=reject_client_write',
          'set_updated_at=touch_updated_at']),
  ('commerce_orders',
    ARRAY['commerce_orders_freeze=guard_commerce_order_freeze',
          'commerce_orders_no_client_delete=reject_client_delete',
          'commerce_orders_no_client_write=reject_client_write',
          'set_updated_at=touch_updated_at']),
  ('commerce_payment_attempts',
    ARRAY['commerce_attempts_no_client_delete=reject_client_delete',
          'commerce_attempts_no_client_write=reject_client_write',
          'set_updated_at=touch_updated_at']),
  ('commerce_payment_events',
    ARRAY['commerce_events_append_only_no_update=reject_any_update',
          'commerce_events_no_client_delete=reject_client_delete',
          'commerce_events_no_client_write=reject_client_write']),
  ('commerce_policy',
    ARRAY['commerce_policy_change_trail=audit_commerce_policy_change',
          'commerce_policy_no_client_delete=reject_client_delete',
          'commerce_policy_no_client_write=reject_client_write',
          'set_updated_at=touch_updated_at']),
  ('commerce_refunds',
    ARRAY['commerce_refunds_no_client_delete=reject_client_delete',
          'commerce_refunds_no_client_write=reject_client_write',
          'set_updated_at=touch_updated_at'])) t(name, expect);

DO $tbl$
DECLARE s s10res%ROWTYPE; r record; v text; v_role text;
BEGIN
  SELECT * INTO s FROM s10res;

  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    PERFORM pg_temp.s10f_eq('T the premise that ' || v_role || ' does not hold USAGE on private is '
      || (SELECT has_schema_privilege(v_role, 'private', 'USAGE'))::text,
      (SELECT has_schema_privilege(v_role, 'private', 'USAGE')),
      CASE WHEN v_role = 'service_role' THEN true ELSE false END);
    PERFORM pg_temp.s10f_eq('T and the premise that ' || v_role
      || ' does hold USAGE on internal_api is ' || (SELECT has_schema_privilege(v_role, 'internal_api', 'USAGE'))::text,
      (SELECT has_schema_privilege(v_role, 'internal_api', 'USAGE')),
      CASE WHEN v_role IN ('anon','authenticated') THEN true ELSE false END);
  END LOOP;

  -- Layer 1 measured as a privilege fact, independent of schema USAGE, because `has_table_privilege` asks
  -- the question the ACL answers and not the question the first reachable door answers.
  FOR r IN SELECT t.name, t.rel, t.updcol FROM s10tbl t ORDER BY t.name LOOP
    PERFORM pg_temp.s10f_array('T1 ' || r.name || ' grants nothing to any request-bearing role',
      ARRAY(SELECT (v.verb, g.role)::text
              FROM (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('REFERENCES'),('TRIGGER')) v(verb),
                   unnest(ARRAY['anon','authenticated','service_role']) g(role)
             WHERE has_table_privilege(g.role, r.rel, v.verb)
             ORDER BY 1),
      ARRAY[]::text[]);
    -- Layer 2: RLS is on, and nothing makes it bypassable for a client role, because there is no policy.
    PERFORM pg_temp.s10f_array('T2 ' || r.name || ' is RLS-enabled with zero policies and a written ACL',
      ARRAY(SELECT x.relrowsecurity::text FROM pg_class x WHERE x.oid = r.rel),
      ARRAY['true']);
    PERFORM pg_temp.s10f_eq('T2 and ' || r.name || ' carries no policy at all',
      pg_temp.s10f_polcount(r.rel), 0::bigint);
    PERFORM pg_temp.s10f_ok('T2 and ' || r.name || '''s ACL column has actually been written (not NULL)',
      (SELECT ro.relacl IS NOT NULL FROM pg_class ro WHERE ro.oid = r.rel));
    -- Layer 3: every non-internal trigger on the table, by name and by which guard function it wires, in
    -- the order a reader of the migration would expect. The list is the whole set rather than a filter, so
    -- a guard that was renamed, a guard that was dropped, and a guard somebody added all move a named cell.
    PERFORM pg_temp.s10f_array('T3 ' || r.name || ' carries exactly its wired guards',
      ARRAY(SELECT tg.tgname || '=' || p.proname FROM pg_trigger tg
              JOIN pg_proc p ON p.oid = tg.tgfoid
             WHERE tg.tgrelid = r.rel AND NOT tg.tgisinternal
             ORDER BY 1),
      (SELECT g.expect FROM s10tguard g WHERE g.name = r.name));
  END LOOP;

  -- The identity sequence, because a grant there would let a holder mint a row's key with no table
  -- privilege at all — the narrower hinge §7b names.
  PERFORM pg_temp.s10f_array('T4 the events sequence is granted to no request-bearing role and has a written ACL',
    ARRAY(SELECT g.role FROM unnest(ARRAY['anon','authenticated','service_role']) g(role)
            WHERE has_sequence_privilege(g.role, 'private.commerce_payment_events_id_seq', 'USAGE')
           ORDER BY 1),
    ARRAY[]::text[]);
  PERFORM pg_temp.s10f_ok('T4 and its ACL column has been written too',
    (SELECT sq.relacl IS NOT NULL FROM pg_class sq
      WHERE sq.oid = 'private.commerce_payment_events_id_seq'::regclass));

  -- The live probes, generated rather than typed: one statement per verb per table per role. Every arm is
  -- shaped so that the catalog says it is well-formed, because a type or syntax error answers *before* the
  -- privilege check does and a `want_state = 42501` cell would score it as a refusal. `DEFAULT VALUES`
  -- needs no column list and a self-assign needs no literal — and both stay harmless if a grant ever
  -- appears, since neither can change what a row holds.
  INSERT INTO probes (grp, label, stmt, want_state, want_like)
  SELECT 'Tb.' || rl.role,
         tb.name || ' ' || vb.verb || ' as ' || rl.role || ' (layer 1)',
         CASE vb.verb
           WHEN 'SELECT' THEN 'SELECT count(*) FROM private.' || tb.name
           WHEN 'INSERT'  THEN 'INSERT INTO private.' || tb.name || ' DEFAULT VALUES'
           WHEN 'UPDATE'  THEN 'UPDATE private.' || tb.name || ' SET ' || tb.updcol || ' = ' || tb.updcol
                            || ' WHERE 1 = 0'
           ELSE 'DELETE FROM private.' || tb.name || ' WHERE 1 = 0'
         END,
         '42501',
         CASE WHEN has_schema_privilege(rl.role, 'private', 'USAGE')
              THEN '%permission denied for table ' || tb.name || '%'
              ELSE '%permission denied for schema private%' END
    FROM s10tbl tb,
         (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) vb(verb),
         (VALUES ('anon'), ('authenticated'), ('service_role')) rl(role);
END $tbl$;

SELECT pg_temp.s10f_run('Tb.anon', 'anon', NULL);
SELECT pg_temp.s10f_run('Tb.authenticated', 'authenticated', current_setting('s10f.owner_a'));
SELECT pg_temp.s10f_run('Tb.service_role', 'service_role', NULL);

-- The gate's own trigger wiring, and the fact that it is the one definer guard in `private` — the posture
-- §8 argues for and G measures from underneath.
DO $gate0$
BEGIN
  -- `tgtype` bits, not `tginsert`/`tgupdate`: those columns were removed from `pg_trigger` in PostgreSQL 12,
  -- so a cell that read them would raise rather than report. The bit values are 4 INSERT, 16 UPDATE,
  -- 8 DELETE, 2 BEFORE, 1 ROW.
  PERFORM pg_temp.s10f_array('T5 the publish gate is one BEFORE-row trigger for both writes on public.publications',
    ARRAY(SELECT tg.tgname || '/' || CASE WHEN tg.tgtype::int & 2 <> 0 THEN 'BEFORE' ELSE 'AFTER' END
                 || '/' || CASE WHEN tg.tgtype::int & 1 <> 0 THEN 'ROW' ELSE 'STATEMENT' END
                 || '/' || CASE WHEN tg.tgtype::int & 4 <> 0 THEN 'I' ELSE '-' END
                 || CASE WHEN tg.tgtype::int & 16 <> 0 THEN 'U' ELSE '-' END
                 || CASE WHEN tg.tgtype::int & 8 <> 0 THEN 'D' ELSE '-' END
      FROM pg_trigger tg WHERE tg.tgrelid = 'public.publications'::regclass
        AND NOT tg.tgisinternal ORDER BY 1),
    ARRAY['publications_commerce_publish_gate/BEFORE/ROW/IU-',
          'publications_no_client_write/BEFORE/ROW/IU-',
          'set_updated_at/BEFORE/ROW/-U-']);
  PERFORM pg_temp.s10f_array('T5 and its function is SECURITY DEFINER with a pinned path, owned by postgres',
    ARRAY(SELECT p.prosecdef::text || '/' || coalesce(array_to_string(p.proconfig, ','), '(none)') || '/'
                 || r.rolname
      FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
     WHERE p.proname = 'guard_publication_commerce_gate'),
    ARRAY['true/search_path=""/postgres']);
  PERFORM pg_temp.s10f_array('T5 and it is granted to no request-bearing role',
    ARRAY(SELECT e.rolname FROM pg_proc p JOIN pg_roles e ON has_function_privilege(e.rolname, p.oid, 'EXECUTE')
           WHERE p.proname = 'guard_publication_commerce_gate'
             AND e.rolname IN ('anon','authenticated','service_role') ORDER BY 1),
    ARRAY[]::text[]);
  -- The append-only guard that refuses even its owner: the one place where a trusted branch would be wrong.
  PERFORM pg_temp.s10f_eq('T6 the payment ledger alone carries the no-exceptions UPDATE refusal',
    (SELECT count(*) FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE p.proname = 'reject_any_update'
        AND tg.tgrelid::regclass::text = 'private.commerce_payment_events'), 1::bigint);
END $gate0$;

-- ------------------------------------------------------------------- Tc. layer 3, reached on purpose
-- T1 proves no request-bearing role holds a table grant, and the live probes in Tb therefore answer at the
-- schema or table ACL — which means the guards themselves are never executed by any of them. A battery that
-- stopped there would report "denied" forever, including on the day a guard was dropped from the migration.
-- So this group fabricates the one posture that can reach layer 3: a NOLOGIN BYPASSRLS role holding exactly
-- the grants the guards are written against, and takes it away again before the file closes. Every arm is
-- either an INSERT the guard must refuse or a self-assign on a real row, so if a guard ever stopped
-- answering the worst outcome is a column rewritten to the value it already held.
-- A grant list, run one statement at a time: `EXECUTE` in plpgsql takes exactly one statement, so the
-- multi-command form of a GRANT list would answer 42601 and read as a refusal to grant. The answer is the
-- failures joined up, so a cell that says ACCEPTED means every statement in the list landed.
CREATE FUNCTION pg_temp.s10f_many(p_stmts text[]) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE s text; v text; bad text[] := '{}'::text[];
BEGIN
  FOREACH s IN ARRAY p_stmts LOOP
    v := pg_temp.s10f_try_write('postgres', NULL, s);
    IF v <> 'ACCEPTED' THEN bad := bad || (s || ' -> ' || v); END IF;
  END LOOP;
  RETURN coalesce(nullif(array_to_string(bad, ' | '), ''), 'ACCEPTED');
END $fn$;

DO $guard$
DECLARE
  s s10res%ROWTYPE;
  ve uuid; mr text;
  v text; base text;
BEGIN
  SELECT * INTO s FROM s10res;
  base := pg_temp.s10f_money();

  v := pg_temp.s10f_try_write('postgres', NULL, 'CREATE ROLE s10f_untrusted NOLOGIN BYPASSRLS');
  PERFORM pg_temp.s10f_eq('T70 the fabricated grantee can be created (a leftover role means a previous run did not clean up)', v, 'ACCEPTED');
  v := pg_temp.s10f_many(ARRAY[
    'GRANT USAGE ON SCHEMA private TO s10f_untrusted',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON private.commerce_orders TO s10f_untrusted',
    'GRANT SELECT, UPDATE ON private.commerce_policy TO s10f_untrusted',
    'GRANT SELECT, UPDATE ON private.commerce_payment_events TO s10f_untrusted']);
  PERFORM pg_temp.s10f_eq('T71 and the money-side grants land', v, 'ACCEPTED');
  v := pg_temp.s10f_many(ARRAY[
    'GRANT USAGE ON SCHEMA public TO s10f_untrusted',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON public.entitlements TO s10f_untrusted',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON public.publications TO s10f_untrusted']);
  PERFORM pg_temp.s10f_eq('T72 and the customer-visible-side grants land', v, 'ACCEPTED');

  -- A version for the publications arms: an FK violation would also be a refusal, and a cell that cannot
  -- tell which constraint answered is not measuring the gate.
  INSERT INTO public.invitation_versions (wedding_id, version_number, snapshot, created_by)
  SELECT s.wed_c, 1, jsonb_build_object('title','S10F-GUARD probe'), s.owner_b
    RETURNING id INTO ve;
  SELECT o.merchant_reference INTO mr FROM private.commerce_orders o
   WHERE o.wedding_id = s.wed_a ORDER BY o.created_at DESC LIMIT 1;

  -- Each refusal is followed by the row count that proves the refused write left nothing behind.
  v := pg_temp.s10f_try_write('s10f_untrusted', NULL,
    'INSERT INTO private.commerce_orders (wedding_id, merchant_reference, package_code, price_version, '
    || 'amount_minor, currency, status, owner_user_id) VALUES ('
    || quote_literal(s.wed_c::text) || '::uuid, ' || quote_literal('tc-probe') || ', '
    || quote_literal('QCLASSIC') || ', 1, 499900, ' || quote_literal('INR') || ', '
    || quote_literal('open') || ', NULL)');
  PERFORM pg_temp.s10f_eq('T73 a granted non-owner cannot open an order in the ledger',
    v, '42501 | role s10f_untrusted may not write private.commerce_orders: this table is server-authoritative');
  PERFORM pg_temp.s10f_eq('T74 and the refused INSERT left no row',
    (SELECT count(*) FROM private.commerce_orders WHERE merchant_reference = 'tc-probe'), 0::bigint);

  v := pg_temp.s10f_try_write('s10f_untrusted', NULL,
    'UPDATE private.commerce_orders SET status = status WHERE merchant_reference = '
    || quote_literal(mr));
  PERFORM pg_temp.s10f_eq('T75 nor can it rewrite one it was handed a reference to',
    v, '42501 | role s10f_untrusted may not write private.commerce_orders: this table is server-authoritative');

  v := pg_temp.s10f_try_write('s10f_untrusted', NULL,
    'UPDATE private.commerce_payment_events SET environment = environment WHERE id = '
    || '(SELECT min(e.id) FROM private.commerce_payment_events e)');
  PERFORM pg_temp.s10f_eq('T76 the ledger''s own append-only sentence answers before the generic write guard',
    v, '42501 | private.commerce_payment_events rows are append-only: a correction is a new row and an audit event, never a rewrite');

  v := pg_temp.s10f_try_write('s10f_untrusted', NULL,
    'UPDATE private.commerce_policy SET publish_gate = publish_gate WHERE id = 1');
  PERFORM pg_temp.s10f_eq('T77 and the policy that decides live capture and the publish gate is guarded too',
    v, '42501 | role s10f_untrusted may not write private.commerce_policy: this table is server-authoritative');

  v := pg_temp.s10f_try_write('s10f_untrusted', NULL,
    'INSERT INTO public.entitlements (wedding_id, package_code, status, source) VALUES ('
    || quote_literal(s.wed_c::text) || '::uuid, ' || quote_literal('QCLASSIC') || ', '
    || quote_literal('active') || ', ' || quote_literal('admin_manual') || ')');
  PERFORM pg_temp.s10f_eq('T78 the customer-visible entitlement table is guarded at the trigger, not only at the grant',
    v, '42501 | role s10f_untrusted may not write public.entitlements: this table is server-authoritative');

  v := pg_temp.s10f_try_write('s10f_untrusted', NULL,
    'UPDATE public.entitlements SET status = status WHERE wedding_id = '
    || quote_literal(s.wed_a::text) || '::uuid');
  PERFORM pg_temp.s10f_eq('T79 and a self-assign on a real row reaches the same guard, which a zero-row arm cannot',
    v, '42501 | role s10f_untrusted may not write public.entitlements: this table is server-authoritative');

  -- The pair that measures the publications ordering: under the shipped permissive policy the gate stands
  -- aside and the generic write guard answers; under a required policy the gate fires first, because two
  -- BEFORE-row triggers on one table fire in name order and `..._commerce_publish_gate` sorts before
  -- `..._no_client_write`.
  v := pg_temp.s10f_try_write('s10f_untrusted', NULL,
    'INSERT INTO public.publications (wedding_id, version_id, status) VALUES ('
    || quote_literal(s.wed_c::text) || '::uuid, ' || quote_literal(ve::text) || '::uuid, '
    || quote_literal('active') || ')');
  PERFORM pg_temp.s10f_eq('T80 under the shipped permissive policy the write guard answers for publications',
    v, '42501 | role s10f_untrusted may not write public.publications: this table is server-authoritative');

  v := pg_temp.s10f_try_write('postgres', NULL,
    'UPDATE private.commerce_policy SET publish_gate = ' || quote_literal('entitlement_required')
    || ', publish_required_package_codes = ARRAY[' || quote_literal('QCLASSIC') || '] WHERE id = 1');
  PERFORM pg_temp.s10f_eq('T81 the owner can raise the policy for this measurement', v, 'ACCEPTED');
  v := pg_temp.s10f_try_write('s10f_untrusted', NULL,
    'INSERT INTO public.publications (wedding_id, version_id, status) VALUES ('
    || quote_literal(s.wed_c::text) || '::uuid, ' || quote_literal(ve::text) || '::uuid, '
    || quote_literal('active') || ')');
  PERFORM pg_temp.s10f_ok('T82 with the gate up, the gate answers first, so a definer guard is really reachable',
    v LIKE '42501 | wedding % may not publish: the commerce policy requires an active entitlement for one of [QCLASSIC], and this wedding has none. Hiding a button is not a gate; this is.%');
  PERFORM pg_temp.s10f_eq('T83 and neither refusal wrote a publication row',
    (SELECT count(*) FROM public.publications WHERE wedding_id = s.wed_c), 0::bigint);
  v := pg_temp.s10f_try_write('postgres', NULL,
    'UPDATE private.commerce_policy SET publish_gate = ' || quote_literal('permissive')
    || ', publish_required_package_codes = ARRAY[]::text[] WHERE id = 1');
  PERFORM pg_temp.s10f_eq('T84 and the policy is put back to the shipped posture', v, 'ACCEPTED');

  PERFORM pg_temp.s10f_eq('T85 eight refused writes moved no money state at all',
    pg_temp.s10f_money(), base);

  -- The fabricated grantee is this group''s own row in the cluster, so it goes away here rather than being
  -- left for the next run to trip over — and the count that proves it went is the same one a reader can
  -- re-derive after a green run.
  DELETE FROM public.invitation_versions WHERE id = ve;
  v := pg_temp.s10f_many(ARRAY[
    'REVOKE ALL ON public.entitlements FROM s10f_untrusted',
    'REVOKE ALL ON public.publications FROM s10f_untrusted',
    'REVOKE ALL ON private.commerce_orders FROM s10f_untrusted',
    'REVOKE ALL ON private.commerce_policy FROM s10f_untrusted',
    'REVOKE ALL ON private.commerce_payment_events FROM s10f_untrusted',
    'REVOKE USAGE ON SCHEMA private FROM s10f_untrusted',
    'REVOKE USAGE ON SCHEMA public FROM s10f_untrusted']);
  PERFORM pg_temp.s10f_eq('T86 every grant this group made is taken back', v, 'ACCEPTED');
  v := pg_temp.s10f_try_write('postgres', NULL, 'DROP ROLE s10f_untrusted');
  PERFORM pg_temp.s10f_eq('T87 and the role itself is dropped', v, 'ACCEPTED');
  PERFORM pg_temp.s10f_eq('T88 with the catalog agreeing that it is gone',
    (SELECT count(*) FROM pg_roles WHERE rolname = 's10f_untrusted'), 0::bigint);
END $guard$;

-- --------------------------------------------------------------------------- H. the host projection
-- One door, eighteen keys, and an amount that is either in the answer or not in it. The states below are
-- battery 1's residue read through the host's own door, which is the pairing the two files are for: a
-- change to what `record_commerce_event` ends a purchase as has to move a reading here, or it did not
-- happen at all. H23..H33 then drive the door with the product's own writers, because the fourth state
-- requirement 8 asks for is the one battery 1's residue cannot supply: §4 leaves the ORDER pending after a
-- failed attempt, so `payment_attempt_failed` is read off the newest attempt at the moment of the read and
-- no stored row says it.
DO $proj$
DECLARE
  s s10res%ROWTYPE;
  v jsonb;
  wed_h uuid; wed_v uuid; ord_h uuid;
  wed_f uuid; ord_f uuid; ref_f text; del jsonb;
  base text; aud bigint;
BEGIN
  SELECT * INTO s FROM s10res;
  base := pg_temp.s10f_money();
  SELECT count(*) INTO aud FROM private.audit_events;

  -- Owner A's reading. The projection names one order, and the cells below state which order that is, so a
  -- change in `commerce_host_summary`'s pick-one rule moves a named cell rather than a blob. Battery 1 ends
  -- this wedding's second purchase as a succeeded refund, so the door answers the refund state, and the
  -- order it picks is the captured QCLASSIC one the pin in group A names by merchant reference.
  v := pg_temp.s10f_sum(s.owner_a::text, s.wed_a::text);
  PERFORM pg_temp.s10f_ok('H01 wedding A''s owner gets an object back', jsonb_typeof(v) = 'object');
  PERFORM pg_temp.s10f_eq('H02 its state, read through the door the host uses', v ->> 'state', 'refunded_pending_review');
  PERFORM pg_temp.s10f_eq('H03 the price the ledger quoted, not one the caller supplied', v ->> 'package_code', 'QCLASSIC');
  PERFORM pg_temp.s10f_eq('H04 and the amount that goes with it is the frozen one', (v ->> 'amount_minor')::text, '499900');
  PERFORM pg_temp.s10f_eq('H05 and currency', v ->> 'currency', 'INR');

  v := pg_temp.s10f_sum(s.owner_b::text, s.wed_b::text);
  PERFORM pg_temp.s10f_eq('H06 wedding B''s owner reads its own state', v ->> 'state', 'entitlement_active');
  PERFORM pg_temp.s10f_eq('H07 with the entitlement status that produced it', v ->> 'entitlement_status', 'active');

  v := pg_temp.s10f_sum(s.owner_a::text, s.wed_c::text);
  PERFORM pg_temp.s10f_eq('H08 wedding C''s owner reads its own state', v ->> 'state', 'refunded_pending_review');
  PERFORM pg_temp.s10f_eq('H09 named as a refund by kind rather than by a status column', v ->> 'refund_kind', 'refund');
  PERFORM pg_temp.s10f_eq('H09b and the refund''s own status is part of the answer', v ->> 'refund_status', 'succeeded');

  -- The key set, in both display postures. Sixteen always-present keys, plus the two money keys only under
  -- a price the catalogue says is displayable.
  PERFORM pg_temp.s10f_keys('H10 the answer carries exactly the documented keys, amount included', v,
    ARRAY['amount_minor','attempt_status','captured_at','closed_at','currency','entitlement_status',
          'merchant_reference','order_status','package_code','price_available','price_display_enabled',
          'price_version','publish_gate','quote_expires_at','refund_kind','refund_status','state',
          'wedding_id']);

  -- An unapproved price: minted here, for a wedding minted here, because the cast's QQUIET rows have all
  -- been moved by battery 1's deliveries and the projection can only be asked about a live quote at the
  -- posture the catalogue ships in. Deleted again before this group closes.
  INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages, style_settings)
    VALUES (gen_random_uuid(), s.owner_a, 'S10F-GATE h', 'en', ARRAY[]::text[], '{"font":"Playfair Display"}'::jsonb)
    RETURNING id INTO wed_h;
  INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages, style_settings)
    VALUES (gen_random_uuid(), s.owner_a, 'S10F-GATE v', 'en', ARRAY[]::text[], '{"font":"Playfair Display"}'::jsonb)
    RETURNING id INTO wed_v;
  PERFORM set_config('s10f.wed_h', wed_h::text, false);
  PERFORM set_config('s10f.wed_v', wed_v::text, false);

  SELECT internal_api.create_commerce_order(wed_h, 'QQUIET', s.owner_a) INTO v;
  ord_h := (v ->> 'order_id')::uuid;
  PERFORM pg_temp.s10f_eq('H11 a quote on the unapproved price is minted for this arm to read', v ->> 'status', 'open');

  v := pg_temp.s10f_sum(s.owner_a::text, wed_h::text);
  PERFORM pg_temp.s10f_eq('H12 its state is a live quote', v ->> 'state', 'quote_open');
  PERFORM pg_temp.s10f_eq('H13 and the projection says the price is not displayable', v ->> 'price_display_enabled', 'false');
  PERFORM pg_temp.s10f_keys('H14 and does not carry the money keys at all — absent, not null', v,
    ARRAY['attempt_status','captured_at','closed_at','entitlement_status','merchant_reference',
          'order_status','package_code','price_available','price_display_enabled','price_version',
          'publish_gate','quote_expires_at','refund_kind','refund_status','state','wedding_id']);
  PERFORM pg_temp.s10f_absent('H15 the two amount names appear nowhere in that answer',
    v #>> '{}', ARRAY['amount_minor','currency']);
  PERFORM pg_temp.s10f_eq('H16 and the package it quotes is still named, because the wedding and the package are not the price',
    v ->> 'package_code', 'QQUIET');

  -- A wedding that has never been quoted, which is the shipped product state for every family until the
  -- owner decides about price.
  v := pg_temp.s10f_sum(s.owner_a::text, wed_v::text);
  PERFORM pg_temp.s10f_eq('H17 a wedding with no order at all reads as no_purchase, not as unpaid-and-chargeable',
    v ->> 'state', 'no_purchase');
  PERFORM pg_temp.s10f_eq('H18 and still carries no amount, because no price has been approved for it',
    v ->> 'price_display_enabled', 'false');

  -- Operational configuration is not a host's business: the two policy columns must not be reachable
  -- through the projection even though the body reads the row that holds them.
  v := pg_temp.s10f_sum(s.owner_a::text, s.wed_a::text);
  PERFORM pg_temp.s10f_absent('H19 the projection carries none of the policy columns it reads',
    v #>> '{}', ARRAY['live_capture_enabled','publish_required_package_codes','refund_revocation_mode']);

  -- The minted quote is this file's own row, so it goes away again and the digest returns to its reading.
  DELETE FROM private.commerce_orders WHERE id = ord_h;
  DELETE FROM private.audit_events WHERE action = 'quote_created' AND subject_key = ord_h;
  PERFORM pg_temp.s10f_eq('H20 the order this file minted is gone, and its audit row with it',
    (SELECT count(*) FROM private.commerce_orders WHERE id = ord_h), 0::bigint);
  PERFORM pg_temp.s10f_eq('H21 and the money state is byte-identical to the reading taken before it',
    pg_temp.s10f_money(), base);
  PERFORM pg_temp.s10f_eq('H22 reading the projection through the host door wrote no audit event either',
    (SELECT count(*) FROM private.audit_events), aud);

  -- The failed arm, which is requirement 8's word that this door did not yet answer. §4 lets a failed
  -- attempt leave the order `payment_pending` — a later attempt may still succeed, and closing the order
  -- on one failure would be the ledger claiming a purchase died when only a card did — so *nothing stored
  -- at order level says "failed"*. The host nonetheless has to be told, and the only honest way to tell it
  -- is to read the newest attempt at the moment of the read. This arm runs the product's own writers to
  -- get there; the projection is then asked what it says.
  INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages, style_settings)
    VALUES (gen_random_uuid(), s.owner_a, 'S10F-FAIL f', 'en', ARRAY[]::text[], '{"font":"Playfair Display"}'::jsonb)
    RETURNING id INTO wed_f;
  SELECT internal_api.create_commerce_order(wed_f, 'QQUIET', s.owner_a) INTO v;
  ord_f := (v ->> 'order_id')::uuid;
  ref_f := v ->> 'merchant_reference';

  del := pg_temp.s10f_deliver('h-f-init', 'payment_initiated', ref_f, 199900, 'po_h_f1', NULL,
    s.owner_a, now() - interval '4 minutes');
  PERFORM pg_temp.s10f_eq('H23a the arm''s initiation is applied by the state machine, not planted',
    del ->> 'applied_effect', 'attempt_initiated');
  del := pg_temp.s10f_deliver('h-f-fail', 'payment_failed', ref_f, 199900, 'po_h_f1', 'pay_h_f1',
    s.owner_a, now() - interval '2 minutes');
  PERFORM pg_temp.s10f_eq('H23b and the failure is applied against that same attempt',
    del ->> 'applied_effect', 'attempt_failed');

  v := pg_temp.s10f_sum(s.owner_a::text, wed_f::text);
  PERFORM pg_temp.s10f_eq('H24 the host can be told the attempt failed, which is the state the brief asks for',
    v ->> 'state', 'payment_attempt_failed');
  PERFORM pg_temp.s10f_eq('H25 while the order it was read from still says pending, because the state is derived',
    v ->> 'order_status', 'payment_pending');
  PERFORM pg_temp.s10f_eq('H26 the answer names which attempt it read, so the sentence is retraceable',
    v ->> 'attempt_status', 'failed');
  PERFORM pg_temp.s10f_eq('H27 and a failed attempt grants nothing: no entitlement status is in the answer',
    coalesce(v ->> 'entitlement_status', '(none)'), '(none)');
  PERFORM pg_temp.s10f_absent('H28 and the new state leaks no price: this arm is quoted on the unapproved row',
    v #>> '{}', ARRAY['amount_minor', 'currency']);
  PERFORM pg_temp.s10f_absent('H29 nor does it carry the provider''s own object names, which a host never needed',
    v #>> '{}', ARRAY['provider_order_ref', 'provider_payment_ref']);

  -- The derivation follows the *newest* attempt, so a second try in flight reads as pending again rather
  -- than keeping the previous failure on the screen after the customer has already retried.
  del := pg_temp.s10f_deliver('h-f-init2', 'payment_initiated', ref_f, 199900, 'po_h_f2', NULL,
    s.owner_a, now());
  PERFORM pg_temp.s10f_eq('H30 a second initiation on a pending order is §4''s attempt_recorded, not a re-initiation',
    del ->> 'applied_effect', 'attempt_recorded');
  PERFORM pg_temp.s10f_eq('H30b and it really is a second attempt object, which is the row the derivation now reads',
    (SELECT count(*) FROM private.commerce_payment_attempts WHERE order_id = ord_f), 2::bigint);
  v := pg_temp.s10f_sum(s.owner_a::text, wed_f::text);
  PERFORM pg_temp.s10f_eq('H31 and the host now reads pending, not the older failure',
    v ->> 'state', 'payment_pending');
  PERFORM pg_temp.s10f_eq('H32 with the newer attempt named, so the two readings differ by the row they read',
    v ->> 'attempt_status', 'initiated');

  -- This arm's own rows, removed the way H20 removed its quote, so the digest this file closes on is the
  -- reading taken before it. Order of deletion is the foreign keys' order: evidence, then attempts, then
  -- the order, then the wedding the order pointed at (money rows reference weddings NO ACTION, §11).
  DELETE FROM private.commerce_payment_events WHERE event_id IN ('h-f-init', 'h-f-fail', 'h-f-init2');
  DELETE FROM private.commerce_payment_attempts WHERE order_id = ord_f;
  DELETE FROM private.commerce_orders WHERE id = ord_f;
  DELETE FROM private.audit_events WHERE subject_key = ord_f;
  DELETE FROM public.weddings WHERE id = wed_f;
  PERFORM pg_temp.s10f_eq('H33 the failed arm left nothing behind, and the money state is the earlier reading',
    pg_temp.s10f_money(), base);
END $proj$;

-- --------------------------------------------------------------------------- V. the paid-status forgery suite
-- Requirement 6, end to end: every way a host might try to make its own wedding look paid, and the
-- projection re-read afterwards to prove a refusal is not just a message.
DO $forge$
DECLARE s s10res%ROWTYPE; v text; before_state text; after jsonb; aud bigint;
BEGIN
  SELECT * INTO s FROM s10res;
  before_state := pg_temp.s10f_money();
  SELECT count(*) INTO aud FROM private.audit_events;

  -- The right itself. `public.entitlements` is a customer-visible table, so what stands between an owner and
  -- a forged grant is the written SELECT-only grant, then RLS with its owner-read policy, then the trigger.
  -- Measured, the *grant* is what answers a browser role — the sentence is `permission denied for table
  -- entitlements`, not the guard's — and that is the ordering §11 claims: the outermost layer is the one a
  -- live probe can reach. T78/T79 prove the guard behind it is live by reaching it from a posture that has
  -- the grant, so neither layer is taken on trust here.
  v := pg_temp.s10f_try_write('authenticated', s.owner_a::text,
    'INSERT INTO public.entitlements (wedding_id, package_code, status, source) VALUES ('
    || quote_literal(s.wed_a::text) || '::uuid, ' || quote_literal('QCLASSIC') || ', '
    || quote_literal('active') || ', ' || quote_literal('admin_manual') || ')');
  PERFORM pg_temp.s10f_eq('V01 an owner cannot grant itself an entitlement, refused at the written grant',
    v, '42501 | permission denied for table entitlements');
  PERFORM pg_temp.s10f_eq('V02 and not with a policy or trigger sentence, which is the layer ordering claimed',
    v NOT LIKE '%server-authoritative%' AND v NOT LIKE '%row-level security%', true);

  v := pg_temp.s10f_try_write('authenticated', s.owner_a::text,
    'UPDATE public.entitlements SET status = ' || quote_literal('active') || ', revoked_at = NULL '
    || 'WHERE wedding_id = ' || quote_literal(s.wed_a::text) || '::uuid');
  PERFORM pg_temp.s10f_eq('V03 and it cannot re-activate a revoked one either, by the same answer',
    v, '42501 | permission denied for table entitlements');

  -- The ledger itself, from a role that at least holds table grants on `public`.
  v := pg_temp.s10f_try_write('authenticated', s.owner_a::text,
    'UPDATE private.commerce_orders SET status = ' || quote_literal('captured') || ', captured_at = now() '
    || 'WHERE wedding_id = ' || quote_literal(s.wed_a::text) || '::uuid');
  PERFORM pg_temp.s10f_eq('V04 the order table is not even nameable from a browser role',
    v, '42501 | permission denied for schema private');

  v := pg_temp.s10f_try_write('authenticated', s.owner_a::text,
    'INSERT INTO private.commerce_payment_events (provider, event_id, kind, raw_body_sha256, signature_valid, processing_status) '
    || 'VALUES (' || quote_literal('razorpay') || ', ' || quote_literal('s10f-forged') || ', '
    || quote_literal('payment_captured') || ', ' || quote_literal(md5('f') || md5('g')) || ', true, '
    || quote_literal('applied') || ')');
  PERFORM pg_temp.s10f_eq('V05 nor is the payment ledger',
    v, '42501 | permission denied for schema private');

  v := pg_temp.s10f_try_write('authenticated', s.owner_a::text,
    'UPDATE private.commerce_policy SET live_capture_enabled = true WHERE id = 1');
  PERFORM pg_temp.s10f_eq('V06 nor the policy that would turn live capture on',
    v, '42501 | permission denied for schema private');

  v := pg_temp.s10f_try('authenticated', s.owner_a::text,
    'SELECT internal_api.grant_commerce_entitlement('
    || quote_literal(current_setting('s10f.ord')) || '::uuid, '
    || quote_literal(s.owner_a::text) || '::uuid)');
  PERFORM pg_temp.s10f_eq('V07 and the activation door is refused at the function, not at its arguments',
    v, '42501 | permission denied for function grant_commerce_entitlement');

  -- After all of it: nothing moved. This is the half every refusal-only suite misses.
  PERFORM pg_temp.s10f_eq('V08 the money state is exactly what the forgery suite found before it ran',
    pg_temp.s10f_money(), before_state);
  PERFORM pg_temp.s10f_eq('V09 and no audit event was written by any refused attempt',
    (SELECT count(*) FROM private.audit_events), aud);
  after := pg_temp.s10f_sum(s.owner_a::text, s.wed_a::text);
  PERFORM pg_temp.s10f_eq('V10 and the host''s own reading still says what the ledger says, not what it tried to say',
    after ->> 'state', 'refunded_pending_review');
  PERFORM pg_temp.s10f_eq('V11 with the entitlement still revoked behind it', after ->> 'entitlement_status', 'revoked');

  -- The one posture whose acceptance is the finding, labelled as such: the trusted backend role is trusted
  -- by design, so a row it writes is allowed. That is why reachability (R, T) is the control and not this
  -- trigger. Deleted again, and the count proved back.
  v := pg_temp.s10f_try_write('service_role', NULL,
    'INSERT INTO public.entitlements (wedding_id, package_code, status, source) VALUES ('
    || quote_literal(current_setting('s10f.wed_v')) || '::uuid, ' || quote_literal('QCLASSIC') || ', '
    || quote_literal('active') || ', ' || quote_literal('admin_manual') || ')');
  PERFORM pg_temp.s10f_eq('V12 service_role is NOT refused on public.entitlements — the posture §2 chose, measured',
    v, 'ACCEPTED');
  PERFORM pg_temp.s10f_eq('V13 and the row it wrote is there',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = current_setting('s10f.wed_v')::uuid), 1::bigint);
  v := pg_temp.s10f_try_write('service_role', NULL,
    'DELETE FROM public.entitlements WHERE wedding_id = '
    || quote_literal(current_setting('s10f.wed_v')) || '::uuid');
  PERFORM pg_temp.s10f_eq('V14 and this file takes it back out, because it was never bought',
    v, 'ACCEPTED');
  PERFORM pg_temp.s10f_eq('V15 with the count proved back to what V12 found',
    (SELECT count(*) FROM public.entitlements WHERE wedding_id = current_setting('s10f.wed_v')::uuid), 0::bigint);
END $forge$;

-- --------------------------------------------------------------------------- G. the publish gate
DO $gate$
DECLARE
  s s10res%ROWTYPE;
  g record;
  g1 uuid; g2 uuid; g3 uuid; g4 uuid; g5 uuid; g6 uuid; g7 uuid; g8 uuid;
  v1 uuid; v2 uuid; v3 uuid; v4 uuid; v5 uuid; v6 uuid; v7 uuid; v8 uuid;
  v text;
BEGIN
  SELECT * INTO s FROM s10res;

  -- Eight planted weddings, each with its own version, because `one_active_publication_per_wedding` would
  -- otherwise make the second arm that has to land a row a unique violation and read as the gate working.
  -- They are titled `S10F-GATE n` so a reader of the residue can tell a plant from battery 1's cast, and
  -- `s10f_pub` is given a real version id in every arm: an FK violation would look like a refusal too, and
  -- a cell that cannot tell which constraint answered is not measuring the gate.
  INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages, style_settings)
  SELECT x.id, s.owner_a, 'S10F-GATE ' || x.tag, 'en', ARRAY[]::text[],
         '{"font":"Playfair Display"}'::jsonb
    FROM (VALUES (gen_random_uuid(), 'g1'), (gen_random_uuid(), 'g2'), (gen_random_uuid(), 'g3'),
                 (gen_random_uuid(), 'g4'), (gen_random_uuid(), 'g5'), (gen_random_uuid(), 'g6'),
                 (gen_random_uuid(), 'g7'), (gen_random_uuid(), 'g8')) x(id, tag);

  SELECT id INTO g1 FROM public.weddings WHERE title = 'S10F-GATE g1';
  SELECT id INTO g2 FROM public.weddings WHERE title = 'S10F-GATE g2';
  SELECT id INTO g3 FROM public.weddings WHERE title = 'S10F-GATE g3';
  SELECT id INTO g4 FROM public.weddings WHERE title = 'S10F-GATE g4';
  SELECT id INTO g5 FROM public.weddings WHERE title = 'S10F-GATE g5';
  SELECT id INTO g6 FROM public.weddings WHERE title = 'S10F-GATE g6';
  SELECT id INTO g7 FROM public.weddings WHERE title = 'S10F-GATE g7';
  SELECT id INTO g8 FROM public.weddings WHERE title = 'S10F-GATE g8';
  IF g1 IS NULL OR g8 IS NULL THEN
    RAISE EXCEPTION 'FAIL G00 the gate plants were not written, so every arm below would measure nothing';
  END IF;

  INSERT INTO public.invitation_versions (wedding_id, version_number, snapshot, created_by)
  SELECT w, 1, jsonb_build_object('title', 'gate probe'), s.owner_a
    FROM unnest(ARRAY[g1,g2,g3,g4,g5,g6,g7,g8]) w;

  SELECT id INTO v1 FROM public.invitation_versions WHERE wedding_id = g1;
  SELECT id INTO v2 FROM public.invitation_versions WHERE wedding_id = g2;
  SELECT id INTO v3 FROM public.invitation_versions WHERE wedding_id = g3;
  SELECT id INTO v4 FROM public.invitation_versions WHERE wedding_id = g4;
  SELECT id INTO v5 FROM public.invitation_versions WHERE wedding_id = g5;
  SELECT id INTO v6 FROM public.invitation_versions WHERE wedding_id = g6;
  SELECT id INTO v7 FROM public.invitation_versions WHERE wedding_id = g7;
  SELECT id INTO v8 FROM public.invitation_versions WHERE wedding_id = g8;

  -- The shipped posture, measured before anything is toggled: the gate is a trigger that stands aside,
  -- which is the property that keeps Stage 3-9's publication suites green at this head unmodified.
  v := pg_temp.s10f_pub('postgres', NULL, g1::text, v1::text, 'active');
  PERFORM pg_temp.s10f_eq('G01 under the shipped permissive default a wedding with no purchase publishes',
    v, 'ACCEPTED');
  PERFORM pg_temp.s10f_eq('G02 and the row is live',
    pg_temp.s10f_pubcount(g1::text), 1::bigint);

  -- Turn the decision on. Only the owner role can, which V06 already proved is not a browser.
  v := pg_temp.s10f_try_write('postgres', NULL,
    'UPDATE private.commerce_policy SET publish_gate = ' || quote_literal('entitlement_required')
    || ', publish_required_package_codes = ARRAY[' || quote_literal('QCLASSIC') || '] WHERE id = 1');
  PERFORM pg_temp.s10f_eq('G03 the trusted owner can move the policy the gate reads', v, 'ACCEPTED');
  PERFORM pg_temp.s10f_eq('G04 and the readback says required, with one package named',
    (SELECT publish_gate || '/' || coalesce(array_to_string(publish_required_package_codes, ','), '(none)')
       FROM private.commerce_policy WHERE id = 1), 'entitlement_required/QCLASSIC');

  v := pg_temp.s10f_pub('postgres', NULL, g2::text, v2::text, 'active');
  PERFORM pg_temp.s10f_ok('G05 a wedding that has never bought anything is refused once the gate is up',
    v LIKE '42501 |%may not publish%');
  PERFORM pg_temp.s10f_eq('G05b and the refusal wrote no row, which is the half a message-only cell misses',
    pg_temp.s10f_pubcount(g2::text), 0::bigint);

  -- The empty-code-list posture, pinned here as well as over HTTP because the sentence is produced by the
  -- database, not by PostgREST. `publish_gate` stays `entitlement_required` and only the list goes empty:
  -- no code can satisfy an empty array, so the refusal is correct and fail-closed and what is under test is
  -- the *message*. Before 20261019120000_stage10_publish_gate_empty_list.sql this arm printed `one of []`,
  -- because `array_to_string('{}'::text[], ', ')` is '' and not NULL, so the migration's
  -- `coalesce(…, '(none named)')` was unreachable — a defect found by HTTP arm G-02, which is the only tier
  -- that set an empty list until this cell existed.
  v := pg_temp.s10f_try_write('postgres', NULL,
    'UPDATE private.commerce_policy SET publish_required_package_codes = ARRAY[]::text[] WHERE id = 1');
  PERFORM pg_temp.s10f_eq('G05c the owner can empty the package list the gate reads', v, 'ACCEPTED');
  v := pg_temp.s10f_pub('postgres', NULL, g2::text, v2::text, 'active');
  PERFORM pg_temp.s10f_ok('G05d an empty list still refuses, and refuses with the sentence that says none is named',
    v LIKE '42501 | wedding % may not publish: the commerce policy requires an active entitlement for one of %'
    AND position('[(none named)], and this wedding has none.' in v) > 0);
  PERFORM pg_temp.s10f_ok('G05e and the answer is no longer the bare bracket an operator had to decode before the repair',
    position('one of []' in v) = 0);
  PERFORM pg_temp.s10f_eq('G05f and that refusal too wrote no row',
    pg_temp.s10f_pubcount(g2::text), 0::bigint);
  v := pg_temp.s10f_try_write('postgres', NULL,
    'UPDATE private.commerce_policy SET publish_required_package_codes = ARRAY[' || quote_literal('QCLASSIC')
    || '] WHERE id = 1');
  PERFORM pg_temp.s10f_eq('G05g the list can be populated again', v, 'ACCEPTED');
  v := pg_temp.s10f_pub('postgres', NULL, g2::text, v2::text, 'active');
  PERFORM pg_temp.s10f_ok('G05h and with a code named the refusal names that code, so the repair did not blank the other branch',
    position('one of [QCLASSIC], and this wedding has none.' in v) > 0
    AND position('(none named)' in v) = 0);

  -- An entitled wedding, in the named package.
  INSERT INTO public.entitlements (wedding_id, package_code, status, source)
  VALUES (g4, 'QCLASSIC', 'active', 'admin_manual');
  v := pg_temp.s10f_pub('postgres', NULL, g4::text, v4::text, 'active');
  PERFORM pg_temp.s10f_eq('G06 a wedding holding the required entitlement publishes', v, 'ACCEPTED');
  PERFORM pg_temp.s10f_eq('G07 and it is the row the gate approved', pg_temp.s10f_pubcount(g4::text), 1::bigint);

  -- A wedding with an entitlement in a package the policy did not name.
  INSERT INTO public.entitlements (wedding_id, package_code, status, source)
  VALUES (g3, 'QQUIET', 'active', 'admin_manual');
  v := pg_temp.s10f_pub('postgres', NULL, g3::text, v3::text, 'active');
  PERFORM pg_temp.s10f_ok('G08 an entitlement in an unnamed package does not buy the door',
    v LIKE '42501 |%may not publish%');

  -- The gate refusing an unentitled wedding, and the row not existing afterwards.
  v := pg_temp.s10f_pub('postgres', NULL, g5::text, v5::text, 'active');
  PERFORM pg_temp.s10f_ok('G09 an unentitled wedding is refused, by the gate''s own sentence',
    v LIKE '42501 | wedding % may not publish: the commerce policy requires an active entitlement for one of [QCLASSIC]%');
  PERFORM pg_temp.s10f_ok('G10 and the refusal says hiding a button is not a gate, which is the claim on file',
    v LIKE '%Hiding a button is not a gate; this is.%');
  PERFORM pg_temp.s10f_eq('G11 and no publication row landed, the half a message-only cell misses',
    (SELECT count(*) FROM public.publications WHERE wedding_id = g5), 0::bigint);

  -- Revocation is never gated, in either of its shapes.
  v := pg_temp.s10f_try_write('postgres', NULL,
    'UPDATE public.publications SET status = ' || quote_literal('revoked') || ', revoked_at = now() '
    || 'WHERE wedding_id = ' || quote_literal(g1::text) || '::uuid');
  PERFORM pg_temp.s10f_eq('G12 taking a live publication down is allowed while the gate is up', v, 'ACCEPTED');
  v := pg_temp.s10f_try_write('postgres', NULL,
    'UPDATE public.publications SET status = ' || quote_literal('active') || ', revoked_at = NULL '
    || 'WHERE wedding_id = ' || quote_literal(g1::text) || '::uuid');
  PERFORM pg_temp.s10f_ok('G13 and putting it back up is the same question as publishing, so it is gated',
    v LIKE '42501 |%may not publish%');
  v := pg_temp.s10f_try_write('postgres', NULL,
    'INSERT INTO public.publications (wedding_id, version_id, status, revoked_at) VALUES ('
    || quote_literal(g5::text) || '::uuid, ' || quote_literal(v5::text) || '::uuid, '
    || quote_literal('revoked') || ', now())');
  PERFORM pg_temp.s10f_eq('G14 a row that never claims to be live is not gated on arrival either', v, 'ACCEPTED');

  -- The definer posture, measured from underneath. `service_role` holds no SELECT on private.commerce_policy
  -- (T1), so an INVOKER gate reading the policy would answer with that missing grant and every trusted
  -- backend publish would fail for the wrong reason. The gate sentence is the proof it reads as a definer.
  -- This is the failure §8 says would tempt somebody to grant a client role into the money schema.
  v := pg_temp.s10f_pub('service_role', NULL, g6::text, v6::text, 'active');
  PERFORM pg_temp.s10f_ok('G15 a trusted backend role reaching the gate is refused by the gate, not by its own missing grant',
    v LIKE '42501 | wedding % may not publish: the commerce policy requires an active entitlement for one of [QCLASSIC]%'
    AND v LIKE '%Hiding a button is not a gate; this is.%');
  PERFORM pg_temp.s10f_ok('G16 and the answer carries no missing-privilege sentence anywhere, which is what an INVOKER gate would have said',
    v NOT LIKE '%permission denied%');

  -- The reachability half of the same claim: a browser never gets inside the gate at all, because the
  -- table's own written ACL answers first.
  v := pg_temp.s10f_pub('authenticated', s.owner_a::text, g6::text, v6::text, 'active');
  PERFORM pg_temp.s10f_eq('G16b a browser role is refused at the table before the gate is ever entered',
    v, '42501 | permission denied for table publications');
  PERFORM pg_temp.s10f_eq('G16c and neither of those two arms left a publication row behind',
    pg_temp.s10f_pubcount(g6::text), 0::bigint);

  -- The one fail-open choice, taken at the posture its comment names and then repaired.
  v := pg_temp.s10f_try_write('postgres', NULL, 'DELETE FROM private.commerce_policy WHERE id = 1');
  PERFORM pg_temp.s10f_eq('G17 the owner can remove the policy row (which is why G22 has to prove the restore)',
    v, 'ACCEPTED');
  -- The two cells below are why this stage's trail fires on DELETE and INSERT as well as UPDATE. G17 is
  -- a real, accepted removal of the row that carries all three undecided answers, and G18/G19 then show
  -- the gate reading the *absence* of that row as permissive — so a deletion alone is a decision to stop
  -- gating, and a restore alone is a decision to put the shipped defaults back. A trail that covered only
  -- UPDATE would record neither, and the residue would look like a database that had never been touched.
  -- Read from the newest row, which these two arms can trust because nothing else writes between them.
  PERFORM pg_temp.s10f_eq('G17b and the deletion is on record, naming all four values it removed',
    (SELECT action || '/' || coalesce(jsonb_array_length(payload -> 'changed')::text, '(none)')
       FROM private.audit_events ORDER BY id DESC LIMIT 1), 'policy_deleted/4');
  PERFORM pg_temp.s10f_eq('G17c and the record claims no wedding and no account, because removing the singleton is not something a household did',
    (SELECT coalesce(wedding_id::text, '(null)') || '/' || coalesce(actor_user_id::text, '(null)') || '/'
            || actor_role
       FROM private.audit_events ORDER BY id DESC LIMIT 1), '(null)/(null)/postgres');
  v := pg_temp.s10f_pub('postgres', NULL, g7::text, v7::text, 'active');
  PERFORM pg_temp.s10f_eq('G18 a missing policy row reads as permissive, the deliberate fail-open §8 records',
    v, 'ACCEPTED');
  PERFORM pg_temp.s10f_eq('G19 and a deleted row would otherwise have stopped every family publishing',
    pg_temp.s10f_pubcount(g7::text), 1::bigint);

  INSERT INTO private.commerce_policy (id) VALUES (1);
  PERFORM pg_temp.s10f_eq('G20 the policy row is restored, one row again',
    (SELECT count(*) FROM private.commerce_policy), 1::bigint);
  PERFORM pg_temp.s10f_eq('G20b and putting it back is on record with the values it came back with, so the pair of rows reads as a round trip rather than silence',
    (SELECT action || '/' || (SELECT count(*) FROM jsonb_object_keys(payload -> 'before') k)::text || '/'
            || coalesce(payload -> 'after' ->> 'publish_gate', '(none)') || '/'
            || coalesce(jsonb_array_length(payload -> 'changed')::text, '(none)')
       FROM private.audit_events ORDER BY id DESC LIMIT 1),
    'policy_created/0/permissive/4');
  PERFORM pg_temp.s10f_array('G21 restored to the shipped defaults in every column, not merely present',
    ARRAY(SELECT publish_gate || '|'
                || CASE WHEN publish_required_package_codes = '{}'::text[] THEN '(empty array)'
                        ELSE array_to_string(publish_required_package_codes, ',') END
                || '|' || live_capture_enabled::text || '|' || refund_revocation_mode
            FROM private.commerce_policy WHERE id = 1),
    ARRAY['permissive|(empty array)|false|hold_for_review']);
  PERFORM pg_temp.s10f_eq('G21b and no policy column is nullable, so a read of the default cannot be a read of NULL',
    (SELECT count(*) FROM information_schema.columns c
      WHERE c.table_schema = 'private' AND c.table_name = 'commerce_policy'
        AND c.is_nullable = 'YES'), 0::bigint);
  v := pg_temp.s10f_pub('postgres', NULL, g8::text, v8::text, 'active');
  PERFORM pg_temp.s10f_eq('G22 and with the restore in place the gate is inert again, which is the historic-suite promise',
    v, 'ACCEPTED');
END $gate$;

-- --------------------------------------------------------------------------- N. §12's negative build
-- Each cell here is a claim that something is absent, so each one states the scope it is absent *in* and a
-- needle list the file reads rather than a single name it hopes for.
DO $neg$
DECLARE forbidden text[];
BEGIN
  forbidden := ARRAY['paid_status','paid','price_paid','billing','billing_status','tax','gst',
                     'invoice','invoice_number','quantity','qty'];

  PERFORM pg_temp.s10f_eq('N01 no relation in public, private or api carries a paid-state column at all',
    (SELECT count(*) FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public','private','api')
       AND c.relkind IN ('r','v','p')
       AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname = ANY (forbidden)), 0::bigint);

  -- The money columns Stage 10 could have bolted onto the aggregate root and did not (§2).
  PERFORM pg_temp.s10f_eq('N02 public.weddings carries no money, price or purchase column of any name',
    (SELECT count(*) FROM pg_attribute a
     WHERE a.attrelid = 'public.weddings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND (a.attname ~* '(price|amount|paid|billing|charge|order|invoice|tax|gst|currency)')), 0::bigint);

  -- No tax/GST/invoice/quantity anywhere in the ledger (§12), and the list is the one this file prints above.
  -- Head-aware only in its wording: the sweep's predicate is `commerce%` on `private`, so slice 4's note
  -- table is inside it at this head, and the assertion it satisfies is the stronger one.
  PERFORM pg_temp.s10f_eq('N03 none of the '
    || CASE WHEN pg_temp.s10f_at_least('stage11') THEN 'seven' ELSE 'six' END
    || ' ledger tables carries a tax, invoice or quantity column',
    (SELECT count(*) FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
     WHERE c.relnamespace = 'private'::regnamespace AND c.relname LIKE 'commerce%'
       AND c.relkind = 'r'
       AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname = ANY (forbidden)), 0::bigint);

  -- No DELETE path for a browser role, over the whole money model rather than the six tables alone. The
  -- trusted backend is not folded into that claim: `reject_client_delete` whitelists `service_role` and
  -- `supabase_admin` by name, so its own grants are enumerated below instead of being hidden inside a zero.
  PERFORM pg_temp.s10f_eq('N04 no browser role holds DELETE on any money or right row anywhere',
    (SELECT count(*) FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN unnest(ARRAY['anon','authenticated']) g(role) ON true
     WHERE n.nspname IN ('public','private')
       AND c.relkind = 'r'
       AND (n.nspname = 'private' OR c.relname IN ('entitlements','audit_events','access_tokens'))
       AND has_table_privilege(g.role, c.oid, 'DELETE')), 0::bigint);
  PERFORM pg_temp.s10f_array('N04b and the only DELETE grants in that whole scope are the '
    || CASE WHEN pg_temp.s10f_at_least('stage11')
            THEN 'two the trusted role still holds — Stage 11 revoked this one, on purpose'
            ELSE 'three the trusted role holds' END,
    ARRAY(SELECT n.nspname || '.' || c.relname || '|' || g.role FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN unnest(ARRAY['anon','authenticated','service_role']) g(role) ON true
     WHERE n.nspname IN ('public','private')
       AND c.relkind = 'r'
       AND (n.nspname = 'private' OR c.relname IN ('entitlements','audit_events','access_tokens'))
       AND has_table_privilege(g.role, c.oid, 'DELETE')
     ORDER BY 1),
    CASE WHEN pg_temp.s10f_at_least('stage11')
         THEN ARRAY['private.access_tokens|service_role', 'public.entitlements|service_role']
         ELSE ARRAY['private.access_tokens|service_role', 'private.audit_events|service_role',
                    'public.entitlements|service_role'] END);

  -- The surface §12 says does not exist: a door a provider could post to.
  PERFORM pg_temp.s10f_eq('N05 no function on either exposed schema is named for a webhook or a callback',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api','internal_api')
        AND p.proname ~* '(webhook|callback|notify_provider|charge|refund_now)'), 0::bigint);
  PERFORM pg_temp.s10f_eq('N06 and no commerce function at all is granted to the anonymous role',
    (SELECT count(*) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api','internal_api') AND p.proname LIKE '%commerce%'
        AND has_function_privilege('anon', p.oid, 'EXECUTE')), 0::bigint);

  -- The declared surface, as the shape §10 promises rather than a number this file re-types.
  -- The two commerce-surface lists below are head-aware for the same reason R20 is: the predicate is a name
  -- pattern, and Stage 11 slice 4's finance desk puts two `api` names and two bodies that contain the word
  -- `commerce` in front of this suite. Their arrival is what the pattern was for — a later stage that
  -- quietly widened the money surface moves these lists and has to justify the names here, in prose, rather
  -- than slipping past a count. N09 grows the same way, because the oversight note table is named for what
  -- it reviews; N03's forbidden-column sweep now runs over seven tables instead of six and still prints
  -- zero, and N10's negative — no commerce table in the customer-facing schema — is unchanged by it, which
  -- is the distinction worth keeping: a desk that reads the ledger is not a second ledger.
  PERFORM pg_temp.s10f_array('N07 the exposed commerce surface is exactly the one projection this stage added'
    || CASE WHEN pg_temp.s10f_at_least('stage11')
            THEN ' plus slice 4''s two finance-desk doors' ELSE '' END,
    ARRAY(SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'api' AND p.proname LIKE '%commerce%' ORDER BY 1),
    CASE WHEN pg_temp.s10f_at_least('stage11') THEN
      ARRAY['commerce_host_summary', 'operator_add_commerce_review_note',
            'operator_commerce_review_queue']
    ELSE ARRAY['commerce_host_summary'] END);
  PERFORM pg_temp.s10f_array('N08 and the internal commerce surface is the seven names §9 shipped'
    || CASE WHEN pg_temp.s10f_at_least('stage11')
            THEN ' plus the two bodies behind those doors' ELSE '' END,
    ARRAY(SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'internal_api' AND p.proname LIKE '%commerce%' ORDER BY 1),
    CASE WHEN pg_temp.s10f_at_least('stage11') THEN
      ARRAY['commerce_host_summary','commerce_reconcile','create_commerce_order',
            'expire_commerce_order','grant_commerce_entitlement',
            'operator_add_commerce_review_note','operator_commerce_review_queue',
            'record_commerce_event','revoke_commerce_entitlement']
    ELSE
      ARRAY['commerce_host_summary','commerce_reconcile','create_commerce_order',
            'expire_commerce_order','grant_commerce_entitlement','record_commerce_event',
            'revoke_commerce_entitlement'] END);
  PERFORM pg_temp.s10f_array('N09 and the ledger is six tables in private, none of them in public'
    || CASE WHEN pg_temp.s10f_at_least('stage11')
            THEN ' — seven once the oversight note table counts, still none in public' ELSE '' END,
    ARRAY(SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'private' AND c.relname LIKE 'commerce%' AND c.relkind = 'r' ORDER BY 1),
    CASE WHEN pg_temp.s10f_at_least('stage11') THEN
      ARRAY['commerce_orders','commerce_packages','commerce_payment_attempts',
            'commerce_payment_events','commerce_policy','commerce_refunds',
            'commerce_review_notes']
    ELSE
      ARRAY['commerce_orders','commerce_packages','commerce_payment_attempts',
            'commerce_payment_events','commerce_policy','commerce_refunds'] END);
  PERFORM pg_temp.s10f_eq('N10 and no commerce table was added to the customer-facing schema',
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname LIKE 'commerce%'), 0::bigint);

  -- The two storage-shaped negatives Stage 10 promised by not being about files at all.
  PERFORM pg_temp.s10f_eq('N11 Stage 10 added no bucket, so the customer-facing storage inventory did not move',
    (SELECT count(*) FROM storage.buckets b WHERE b.id LIKE '%commerce%'), 0::bigint);
END $neg$;

-- --------------------------------------------------------------------------- Z. the census, and the promise
DO $census$
DECLARE n integer;
BEGIN
  -- The claim the whole file is built to keep: a battery that spends its time probing unreachable doors
  -- must leave the money model exactly as it found it. Anything else means one of the doors opened.
  PERFORM pg_temp.s10f_eq('Z01 every money row battery 1 committed is byte-identical after this battery ran',
    pg_temp.s10f_money(), current_setting('s10f.money0'));
  PERFORM pg_temp.s10f_eq('Z02 and the policy row is the shipped one at the close, because G toggled it and restored it',
    (SELECT publish_gate FROM private.commerce_policy WHERE id = 1), 'permissive');

  -- Rows this file did plant, stated rather than left implicit, so a reader of the residue can tell a
  -- qualification plant from a cast row. They are titled `S10F-` and none of them carries money.
  PERFORM pg_temp.s10f_eq('Z03 the plants this file made are ten weddings, all titled for the gate arms',
    (SELECT count(*) FROM public.weddings WHERE title LIKE 'S10F-GATE %'), 10::bigint);
  PERFORM pg_temp.s10f_eq('Z04 and not one of them carries an order, so no planted wedding looks purchased',
    (SELECT count(*) FROM private.commerce_orders o
      JOIN public.weddings w ON w.id = o.wedding_id WHERE w.title LIKE 'S10F-GATE %'), 0::bigint);
  PERFORM pg_temp.s10f_eq('Z05 and the entitlements this file planted are the two the gate arms needed, both revoked-or-gone',
    (SELECT count(*) FROM public.entitlements e
      JOIN public.weddings w ON w.id = e.wedding_id
     WHERE w.title LIKE 'S10F-GATE %' AND e.status = 'active'), 2::bigint);

  n := coalesce(nullif(current_setting('s10f.passed', true), ''), '0')::int;
  IF n < 200 THEN
    RAISE EXCEPTION 'FAIL L01 the reachability battery ran % assertions, which is fewer than the floor', n;
  END IF;
  RAISE NOTICE 'PASS L01 the reachability battery ran at least its floor of assertions (%)', n;
  PERFORM pg_temp.s10f_add(1);
END $census$;

SELECT 'STAGE10 FUNCTIONS TESTS PASSED ('
    || coalesce(nullif(current_setting('s10f.passed', true), ''), '0') || ')';
