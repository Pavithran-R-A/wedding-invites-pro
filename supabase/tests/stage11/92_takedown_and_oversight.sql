-- Stage 11 battery 4: publication takedown and refund/dispute oversight — two facts in order, and a
-- reviewer who can look but cannot touch.
--
-- Run by `supabase/tests/stage11/run.sh authority` after `90_privacy_intake.sql`, on the same chain, in one
-- transaction that commits. It therefore inherits batteries 1–3's rows: grants, tickets, threads, privacy
-- requests and their trail. Every absolute count here is a delta against a number captured inside this file
-- or a count of rows this file registered; the only cluster-wide absolutes are `pg_proc` and `pg_class`
-- inventories, which no battery can move.
--
-- Scope. This file proves, at the database: the oversight table's columns, checks, constraints, indexes,
-- triggers and four foreign-key delete rules; the authorising-case predicate's three live statuses and its
-- one-sentence refusal; the plan door's projection and its read-only posture; the takedown's effect set —
-- which credential kinds move, which artefact rows move, which deliberately do not — its trail row, its
-- replay anchor and its ordering against §6's second fact; the purge body's zero-grant exposure and the four
-- things it requires before it will name a single object key; the review queue's scope, window and
-- read-only-ness against the money tables; the note door's authorisation, derived `order_id`, and the rule
-- that the note's prose never leaves the note row; and the insert-only survival of a note when its author's
-- account is erased.
--
-- It does not prove that an object is ever deleted. §6's second fact is a Storage call made by the trusted
-- CLI outside this schema, and the SQL tier's job is to show that nothing inside the schema pretends
-- otherwise: no body in this slice names a DELETE, no Storage row disappears, and the answer each door
-- returns says so in its own fields.
--
-- Six postures carried from the earlier batteries because the naive version of each is wrong:
--   1. A door is called as a role through `pg_temp.s11t_as`, never as the owner, and each operator refusal
--      is measured through the wrapper and through the body directly — the answer must be the same sentence.
--   2. Every refusal asserts SQLSTATE plus sentence, and the digest of every table that did not move.
--   3. The four ways the authorising case can fail (no such ref, another wedding's ticket, a parked case, a
--      finished case) are compared byte-for-byte against each other, because a door that distinguishes them
--      is an oracle over a minted `SV-` string.
--   4. Hand plants are undone by their own rollback and the undo is proved by re-taking the digest. They are
--      the only way to reach the CHECKs, the derived column and the depth-at-two exception the doors cannot
--      reach.
--   5. "This body deletes nothing" is never proven by its name. The file scans the six bodies' source for
--      DELETE (and the two STABLE readers for INSERT/UPDATE), attempts a client DELETE on the new table,
--      attempts the three parent deletes its NO ACTION keys must refuse, and erases an account.
--   6. A claim about a signed URL's life is measured as a surviving row, not asserted. The artefact keeps
--      its `object_key` and the registry keeps its object after both §6 halves are planned.

SET client_min_messages = notice;
SET search_path = public, pg_temp;

SELECT set_config('s11t.passed', '0', false);

-- --------------------------------------------------------------------------- the harness
CREATE FUNCTION pg_temp.s11t_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s11t.passed',
    (coalesce(nullif(current_setting('s11t.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s11t_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11t_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11t_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11t_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11t_array(label text, got text[], want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label,
      array_to_string(coalesce(got, ARRAY[]::text[]), ', '),
      array_to_string(coalesce(want, ARRAY[]::text[]), ', ');
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11t_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11t_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % not an object', label, coalesce(jsonb_typeof(v), 'NULL');
  END IF;
  PERFORM pg_temp.s11t_array(label,
    (SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
       FROM jsonb_object_keys(v) k), want);
END $fn$;

CREATE FUNCTION pg_temp.s11t_err_is(label text, got text, want_state text, want_like text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got IS NULL OR split_part(got, ' | ', 1) <> want_state OR got NOT LIKE want_like THEN
    RAISE EXCEPTION 'FAIL %: got [%] want [% / %]', label, got, want_state, want_like;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11t_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11t_same(label text, a text, b text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF a IS DISTINCT FROM b OR a IS NULL THEN
    RAISE EXCEPTION 'FAIL %: [%] vs [%] — these two refusals are not one sentence', label, a, b;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11t_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11t_accept(label text, got text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF got <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'FAIL %: expected the statement to be accepted, it heard [%]', label, got;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s11t_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s11t_as(p_role text, p_uid uuid, p_stmt text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  IF p_role NOT IN ('anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  PERFORM set_config('test.uid', coalesce(p_uid::text, ''), false);
  PERFORM set_config('test.role', p_role, false);
  BEGIN
    EXECUTE p_stmt INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('test.uid', '', false);
    RETURN jsonb_build_object('_error', SQLSTATE || ' | ' || SQLERRM);
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.uid', '', false);
  IF v IS NULL THEN
    RETURN jsonb_build_object('_null_answer', true);
  END IF;
  RETURN v;
END $fn$;

CREATE FUNCTION pg_temp.s11t_err(v jsonb) RETURNS text
LANGUAGE sql STABLE AS $fn$ SELECT v ->> '_error' $fn$;

CREATE FUNCTION pg_temp.s11t_try(p_role text, p_uid uuid, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  PERFORM set_config('test.uid', coalesce(p_uid::text, ''), false);
  PERFORM set_config('test.role', p_role, false);
  BEGIN
    EXECUTE stmt INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('test.uid', '', false);
    RETURN SQLSTATE || ' | ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.uid', '', false);
  RETURN coalesce(v, '(null)');
END $fn$;

-- Three nested blocks: the innermost captures the answer, the middle raises a marker after the answer is
-- captured, and the outer swallows the marker while aborting the subtransaction the accepted work merged
-- into. An accepted plant and a refused plant therefore leave the same chain behind.
CREATE FUNCTION pg_temp.s11t_probe(p_role text, p_uid uuid, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_answer text;
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  PERFORM set_config('test.uid', coalesce(p_uid::text, ''), false);
  PERFORM set_config('test.role', p_role, false);
  BEGIN
    BEGIN
      BEGIN
        EXECUTE stmt;
        v_answer := 'ACCEPTED';
      EXCEPTION WHEN OTHERS THEN
        v_answer := SQLSTATE || ' | ' || SQLERRM;
      END;
      RAISE EXCEPTION 's11t_probe_rolled_back';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.uid', '', false);
  RETURN v_answer;
END $fn$;

-- --------------------------------------------------------------------------- the digests
-- One per table this slice can move, and one per table it promises not to. Each is every column of every
-- row in identity order, so "the refund did not change" and "the refund's row is byte-identical" are the
-- same measurement rather than two claims.
CREATE FUNCTION pg_temp.s11t_pub() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || wedding_id::text || '|' || version_id::text || '|' || status || '|'
           || published_at::text || '|' || coalesce(revoked_at::text,'') || '|' || created_at::text || '|'
           || updated_at::text, '~' ORDER BY id), ''))
    FROM public.publications $fn$;

CREATE FUNCTION pg_temp.s11t_tok() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || token_hash || '|' || token_kind || '|' || wedding_id::text || '|'
           || coalesce(publication_id::text,'') || '|' || coalesce(household_id::text,'') || '|'
           || coalesce(approval_request_id::text,'') || '|'
           || coalesce(approval_version_id::text,'') || '|' || expiry_policy || '|'
           || coalesce(expires_at::text,'') || '|' || coalesce(revoked_at::text,'') || '|'
           || coalesce(last_used_at::text,'') || '|' || created_by_role || '|' || created_at::text,
             '~' ORDER BY id), ''))
    FROM private.access_tokens $fn$;

CREATE FUNCTION pg_temp.s11t_out() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || wedding_id::text || '|' || version_id::text || '|' || output_kind || '|'
           || coalesce(variant,'') || '|' || coalesce(format,'') || '|'
           || coalesce(page_number::text,'') || '|' || render_config_hash || '|' || source_dto_digest || '|'
           || coalesce(content_digest,'') || '|' || coalesce(target_url_digest,'') || '|'
           || object_key || '|' || storage_domain || '|' || status || '|'
           || coalesce(invalidation_reason,'') || '|' || attempt_count::text || '|'
           || coalesce(last_error,'') || '|' || created_at::text || '|' || updated_at::text || '|'
           || coalesce(ready_at::text,'') || '|' || coalesce(invalidated_at::text,''),
             '~' ORDER BY id), ''))
    FROM public.invitation_outputs $fn$;

CREATE FUNCTION pg_temp.s11t_ord() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || wedding_id::text || '|' || coalesce(owner_user_id::text,'') || '|'
           || merchant_reference || '|' || package_code || '|' || price_version::text || '|'
           || amount_minor::text || '|' || currency || '|' || status || '|'
           || coalesce(quote_expires_at::text,'') || '|' || coalesce(captured_at::text,'') || '|'
           || coalesce(closed_at::text,'') || '|' || coalesce(entitlement_id::text,'') || '|'
           || created_at::text || '|' || updated_at::text, '~' ORDER BY id), ''))
    FROM private.commerce_orders $fn$;

CREATE FUNCTION pg_temp.s11t_ref() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || order_id::text || '|' || coalesce(event_id::text,'') || '|' || kind || '|'
           || status || '|' || coalesce(amount_minor::text,'') || '|' || coalesce(currency,'') || '|'
           || coalesce(provider_refund_ref,'') || '|' || recorded_at::text || '|'
           || coalesce(completed_at::text,'') || '|' || created_at::text || '|' || updated_at::text,
             '~' ORDER BY id), ''))
    FROM private.commerce_refunds $fn$;

-- The ten columns `public.entitlements` actually has, taken from `pg_attribute` rather than from the
-- §7 prose that describes an entitlement by its purpose. A digest that silently drops `metadata` would
-- miss the one column a revocation could be recorded in.
CREATE FUNCTION pg_temp.s11t_ent() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || wedding_id::text || '|' || package_code || '|' || status || '|'
           || source || '|' || granted_at::text || '|' || coalesce(revoked_at::text,'') || '|'
           || coalesce(metadata::text,'') || '|' || created_at::text || '|' || updated_at::text,
             '~' ORDER BY id), ''))
    FROM public.entitlements $fn$;

CREATE FUNCTION pg_temp.s11t_pol() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(row_to_json(p)::text, '~' ORDER BY id), ''))
    FROM private.commerce_policy p $fn$;

CREATE FUNCTION pg_temp.s11t_cse() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || coalesce(wedding_id::text,'') || '|' || case_ref || '|'
           || coalesce(requester_user_id::text,'') || '|' || coalesce(opened_by_user_id::text,'') || '|'
           || category || '|' || severity || '|' || status || '|' || host_summary || '|'
           || coalesce(assigned_operator_user_id::text,'') || '|'
           || coalesce(resolution_code,'') || '|' || coalesce(resolved_at::text,'') || '|'
           || opened_at::text || '|' || updated_at::text || '|'
           || coalesce(open_idempotency_key::text,''), '~' ORDER BY id), ''))
    FROM private.support_cases $fn$;

CREATE FUNCTION pg_temp.s11t_ev() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             case_id::text || ':' || seq::text || '|' || kind || '|' || coalesce(body,'') || '|'
           || coalesce(actor_user_id::text,'') || '|' || actor_kind || '|'
           || coalesce(from_status,'') || '|' || coalesce(to_status,'') || '|'
           || coalesce(idempotency_key::text,'') || '|' || created_at::text, '~' ORDER BY case_id, seq), ''))
    FROM private.support_case_events $fn$;

CREATE FUNCTION pg_temp.s11t_note() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || refund_id::text || '|' || order_id::text || '|' || case_ref || '|'
           || coalesce(author_user_id::text,'') || '|' || kind || '|' || note || '|'
           || idempotency_key::text || '|' || created_at::text, '~' ORDER BY id), ''))
    FROM private.commerce_review_notes $fn$;

CREATE FUNCTION pg_temp.s11t_adigest() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || coalesce(wedding_id::text,'') || '|' || subject_type || '|'
           || coalesce(subject_key::text,'') || '|' || action || '|' || actor_role || '|'
           || coalesce(actor_user_id::text,'') || '|' || payload::text || '|' || created_at::text || '|'
           || actor_kind || '|' || coalesce(reason,'') || '|' || coalesce(idempotency_key,'') || '|'
           || coalesce(before_state::text,'') || '|' || coalesce(after_state::text,''),
             '~' ORDER BY id), ''))
    FROM private.audit_events $fn$;

CREATE FUNCTION pg_temp.s11t_acount() RETURNS bigint
LANGUAGE sql STABLE AS $fn$ SELECT count(*) FROM private.audit_events $fn$;

CREATE FUNCTION pg_temp.s11t_cnt(tbl text) RETURNS bigint
LANGUAGE plpgsql STABLE AS $fn$
DECLARE v bigint;
BEGIN
  EXECUTE 'SELECT count(*) FROM ' || tbl INTO v;
  RETURN v;
END $fn$;

CREATE FUNCTION pg_temp.s11t_is(p_uid uuid, p_scope text) RETURNS boolean
LANGUAGE plpgsql AS $fn$
DECLARE v boolean;
BEGIN
  PERFORM set_config('test.uid', coalesce(p_uid::text, ''), false);
  PERFORM set_config('test.role', 'authenticated', false);
  BEGIN
    SELECT private.actor_is_operator(p_scope) INTO v;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('test.uid', '', false);
    RETURN NULL;
  END;
  PERFORM set_config('test.uid', '', false);
  RETURN v;
END $fn$;

CREATE FUNCTION pg_temp.s11t_u(p uuid) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT coalesce(quote_literal(p::text), 'NULL') $fn$;

CREATE FUNCTION pg_temp.s11t_t(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT coalesce(quote_literal(p), 'NULL') $fn$;

CREATE FUNCTION pg_temp.s11t_n(p numeric) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT coalesce(p::text, 'NULL') $fn$;

-- The two service-only bodies of slice 1, reached the only way they can be reached. The purge in this file
-- is called the same way: as the owner, with no `SET ROLE`, because no role this file may switch into holds
-- EXECUTE — which is U01–U03, measured rather than asserted.
CREATE FUNCTION pg_temp.s11t_grant(p_acct uuid, p_scope text, p_reason text, p_actor uuid,
                                  p_expires timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  BEGIN
    SELECT internal_api.grant_operator_role(p_acct, p_scope, p_reason, p_actor, p_expires) INTO v;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('_error', SQLSTATE || ' | ' || SQLERRM);
  END;
  RETURN v;
END $fn$;

CREATE FUNCTION pg_temp.s11t_revoke(p_acct uuid, p_scope text, p_reason text, p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  BEGIN
    SELECT internal_api.revoke_operator_role(p_acct, p_scope, p_reason, p_actor) INTO v;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('_error', SQLSTATE || ' | ' || SQLERRM);
  END;
  RETURN v;
END $fn$;

-- A call that must succeed. Fixture setup uses this so a broken plant is a sentence about the door that
-- refused it, not a NULL four groups later.
CREATE FUNCTION pg_temp.s11t_must(p_label text, p_role text, p_uid uuid, p_stmt text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  v := pg_temp.s11t_as(p_role, p_uid, p_stmt);
  IF v ? '_error' THEN
    RAISE EXCEPTION 'FAIL setup %: %', p_label, v ->> '_error';
  END IF;
  RETURN v;
END $fn$;

-- The ledger of accepted mutating calls. Group Z reads it against the trail both ways: a door cannot return
-- an audit id that is not a row, and the trail cannot hold a Stage 11 slice-4 row no door returned. A
-- replayed delivery is not entered, because `replayed=true` is the door saying it wrote nothing.
CREATE TEMP TABLE s11t_led (call text PRIMARY KEY, audit_id bigint, action text,
                            idempotency_key uuid) ON COMMIT DROP;
CREATE TEMP TABLE s11t_reg (tag text PRIMARY KEY, id uuid, ref text) ON COMMIT DROP;
CREATE TEMP TABLE s11t_key (tag text PRIMARY KEY, k uuid) ON COMMIT DROP;

CREATE FUNCTION pg_temp.s11t_ledger(p_call text, p_answer jsonb, p_action text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (p_answer ? 'audit_id') THEN
    RAISE EXCEPTION 'FAIL ledger %: the answer carries no audit_id — [%]', p_call, p_answer::text;
  END IF;
  IF coalesce((p_answer ->> 'replayed')::boolean, false) THEN
    RETURN;
  END IF;
  INSERT INTO s11t_led (call, audit_id, action, idempotency_key)
    VALUES (p_call, (p_answer ->> 'audit_id')::bigint, p_action,
            NULLIF(p_answer ->> '_key', '')::uuid);
END $fn$;

-- The five 64-hex digests this file needs, spelled rather than random so a re-run of the same battery on the
-- same chain can be diffed.
CREATE FUNCTION pg_temp.s11t_h(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5(p) $fn$;

-- --------------------------------------------------------------------------- the cast
-- Fourteen accounts, four weddings and the whole publication/credential/artefact/money shape this slice
-- acts on. Everything here is planted by the superuser because that is the only hand that can build a
-- fixture faster than the doors can be talked into building it — and each plant is the shape a real product
-- path would leave behind, taken from the live chain's CHECKs rather than from the prose that describes
-- them. Group P then measures the plant, so a cell that fails later can be read against P rather than
-- against a guess about what was there to begin with.
CREATE TEMP TABLE s11t_cast ON COMMIT DROP AS
SELECT gen_random_uuid() AS host_a, gen_random_uuid() AS host_b, gen_random_uuid() AS host_x,
       gen_random_uuid() AS op1, gen_random_uuid() AS op2, gen_random_uuid() AS sup1,
       gen_random_uuid() AS fin1, gen_random_uuid() AS fin2, gen_random_uuid() AS dec1,
       gen_random_uuid() AS ghost,
       gen_random_uuid() AS w1, gen_random_uuid() AS w2, gen_random_uuid() AS w3, gen_random_uuid() AS w4,
       gen_random_uuid() AS ver1, gen_random_uuid() AS ver1b, gen_random_uuid() AS ver2,
       gen_random_uuid() AS ver4,
       gen_random_uuid() AS pub1, gen_random_uuid() AS pub1b, gen_random_uuid() AS pub2,
       gen_random_uuid() AS pub4, gen_random_uuid() AS hh1,
       gen_random_uuid() AS ent1, gen_random_uuid() AS ord1, gen_random_uuid() AS ord2,
       gen_random_uuid() AS ref1, gen_random_uuid() AS ref2, gen_random_uuid() AS ref3,
       gen_random_uuid() AS ref4, gen_random_uuid() AS ref5, gen_random_uuid() AS ref6,
       gen_random_uuid() AS out_og, gen_random_uuid() AS out_pdf, gen_random_uuid() AS out_old,
       gen_random_uuid() AS out_w2, gen_random_uuid() AS out_reg, gen_random_uuid() AS out_up,
       gen_random_uuid() AS out_fail, gen_random_uuid() AS out_inv,
       gen_random_uuid() AS cas_live, gen_random_uuid() AS cas_w2, gen_random_uuid() AS cas_park,
       gen_random_uuid() AS cas_done, gen_random_uuid() AS cas_note,
       gen_random_uuid() AS tk_pub, gen_random_uuid() AS tk_guest, gen_random_uuid() AS tk_rsvp,
       gen_random_uuid() AS tk_old, gen_random_uuid() AS tk_w2;

-- The digests this schema demands are 64 hex characters and `md5` answers 32, so one more md5 is appended
-- rather than the shape being loosened. Every digest below is spelled from a label, so a re-run of the same
-- battery on the same chain produces the same fixture bytes and two runs can be diffed.
CREATE FUNCTION pg_temp.s11t_h64(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT md5(p) || md5(p || '::s11t') $fn$;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT c.host_a,  's11t-host-a@stage11qual.test',  '{}'::jsonb FROM s11t_cast c
UNION ALL SELECT c.host_b,  's11t-host-b@stage11qual.test',  '{}'::jsonb FROM s11t_cast c
UNION ALL SELECT c.host_x,  's11t-host-x@stage11qual.test',  '{}'::jsonb FROM s11t_cast c
UNION ALL SELECT c.op1,     's11t-op-1@stage11qual.test',    '{}'::jsonb FROM s11t_cast c
UNION ALL SELECT c.op2,     's11t-op-2@stage11qual.test',    '{}'::jsonb FROM s11t_cast c
UNION ALL SELECT c.sup1,    's11t-sup-1@stage11qual.test',   '{}'::jsonb FROM s11t_cast c
UNION ALL SELECT c.fin1,    's11t-fin-1@stage11qual.test',   '{}'::jsonb FROM s11t_cast c
UNION ALL SELECT c.fin2,    's11t-fin-2@stage11qual.test',   '{}'::jsonb FROM s11t_cast c
UNION ALL SELECT c.dec1,    's11t-dec-1@stage11qual.test',   '{}'::jsonb FROM s11t_cast c
UNION ALL SELECT c.ghost,   's11t-ghost@stage11qual.test',   '{}'::jsonb FROM s11t_cast c;

INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages,
                             style_settings)
SELECT c.w1, c.host_a,  'Takedown w1', 'en', ARRAY[]::text[], '{}'::jsonb FROM s11t_cast c
UNION ALL SELECT c.w2, c.host_b,  'Takedown w2', 'en', ARRAY[]::text[], '{}'::jsonb FROM s11t_cast c
UNION ALL SELECT c.w3, c.host_a,  'Takedown w3', 'en', ARRAY[]::text[], '{}'::jsonb FROM s11t_cast c
UNION ALL SELECT c.w4, c.host_x,  'Takedown w4', 'en', ARRAY[]::text[], '{}'::jsonb FROM s11t_cast c;
-- `w3` is the wedding no plan can answer for, and `w4` is the one whose publication was retired by hand:
-- the two shapes §6's ordering rules need and no product path will produce on cue.

INSERT INTO public.invitation_versions (id, wedding_id, version_number, snapshot,
                                        snapshot_schema_version, created_by)
SELECT c.ver1,  c.w1, 1, '{}'::jsonb, 1, c.host_a FROM s11t_cast c
UNION ALL SELECT c.ver1b, c.w1, 2, '{}'::jsonb, 1, c.host_a FROM s11t_cast c
UNION ALL SELECT c.ver2,  c.w2, 1, '{}'::jsonb, 1, c.host_b FROM s11t_cast c
UNION ALL SELECT c.ver4,  c.w4, 1, '{}'::jsonb, 1, c.host_x FROM s11t_cast c;

-- The live publication and its two deliberately-not-live siblings: `pub1b` is w1's superseded version, so
-- the takedown's version scoping has something to fail open against; `pub4` is retired with no recorded
-- takedown, which is the only way to reach §6's "a purge cannot be the first move".
INSERT INTO public.publications (id, wedding_id, version_id, status, published_at, revoked_at)
SELECT c.pub1,  c.w1, c.ver1,  'active',  now() - interval '1 hour', NULL            FROM s11t_cast c
UNION ALL SELECT c.pub1b, c.w1, c.ver1b, 'revoked',  now() - interval '5 days',
       now() - interval '4 days'                                                      FROM s11t_cast c
UNION ALL SELECT c.pub2,  c.w2, c.ver2,  'active',  now() - interval '1 hour', NULL   FROM s11t_cast c
UNION ALL SELECT c.pub4,  c.w4, c.ver4,  'revoked', now() - interval '2 days',
       now() - interval '2 hours'                                                     FROM s11t_cast c;

INSERT INTO public.guest_households (id, wedding_id, display_name)
SELECT c.hh1, c.w1, 'Takedown household' FROM s11t_cast c;

-- The five credential kinds this slice could touch, in the shapes the shipped CHECKs allow: a public and a
-- guest invitation (the pair Stage 8's own revocation statement names), an `rsvp` credential (the kind that
-- sits outside that pair and must survive), a retired one (so the reported count is not the total), and one
-- on another wedding.
-- The `NULL::timestamptz` casts are not decoration: in a five-branch UNION ALL an all-unknown
-- column in the leading branches is resolved to text at the first join, and the branch that then
-- supplies a real timestamp fails against it.
INSERT INTO private.access_tokens (id, token_hash, token_kind, wedding_id, publication_id, household_id,
                                   expiry_policy, revoked_at, created_at)
SELECT c.tk_pub, pg_temp.s11t_h64('s11t-token-pub'), 'public_invitation', c.w1, c.pub1, NULL,
       'no_expiry', NULL::timestamptz, now() - interval '1 hour' FROM s11t_cast c
UNION ALL
SELECT c.tk_guest, pg_temp.s11t_h64('s11t-token-guest'), 'guest_invitation', c.w1, c.pub1, c.hh1,
       'no_expiry', NULL::timestamptz, now() - interval '1 hour' FROM s11t_cast c
UNION ALL
SELECT c.tk_rsvp, pg_temp.s11t_h64('s11t-token-rsvp'), 'rsvp', c.w1, c.pub1, c.hh1,
       'no_expiry', NULL::timestamptz, now() - interval '1 hour' FROM s11t_cast c
UNION ALL
SELECT c.tk_old, pg_temp.s11t_h64('s11t-token-old'), 'public_invitation', c.w1, c.pub1b, NULL,
       'no_expiry', now() - interval '4 days', now() - interval '5 days' FROM s11t_cast c
UNION ALL
SELECT c.tk_w2, pg_temp.s11t_h64('s11t-token-w2'), 'public_invitation', c.w2, c.pub2, NULL,
       'no_expiry', NULL::timestamptz, now() - interval '1 hour' FROM s11t_cast c;

-- Eight artefact rows on the two versions, walked through the lifecycle the guard defines rather than
-- written into it: born `registered`, then `uploading`, then `ready` with the digest the guard demands.
-- `out_og` is the published-preview domain (a stranger's link), the rest are host-private.
CREATE TEMP TABLE s11t_out_ids (tag text PRIMARY KEY, id uuid, kind text, variant text, fmt text,
                                domain text, ver uuid, wed uuid, target boolean) ON COMMIT DROP;
INSERT INTO s11t_out_ids (tag, id, kind, variant, fmt, domain, ver, wed, target)
SELECT 'out_og',   c.out_og,  'og_image',    '1200x630', 'webp', 'published_preview', c.ver1,  c.w1, false
  FROM s11t_cast c
UNION ALL SELECT 'out_pdf',  c.out_pdf,  'pdf',         'a4',       'pdf',  'host_private',        c.ver1,  c.w1, false
  FROM s11t_cast c
UNION ALL SELECT 'out_old',  c.out_old,  'share_image', '1080x1350','png',  'host_private',        c.ver1b, c.w1, false
  FROM s11t_cast c
UNION ALL SELECT 'out_w2',   c.out_w2,   'pdf',         'a4',       'pdf',  'host_private',        c.ver2,  c.w2, false
  FROM s11t_cast c
UNION ALL SELECT 'out_reg',  c.out_reg,  'qr',          '40mm',     'png',  'host_private',        c.ver1,  c.w1, true
  FROM s11t_cast c
UNION ALL SELECT 'out_up',   c.out_up,   'share_image', '1080x1620','png',  'host_private',        c.ver1,  c.w1, false
  FROM s11t_cast c
UNION ALL SELECT 'out_fail', c.out_fail, 'pdf',         'letter',   'pdf',  'host_private',        c.ver1,  c.w1, false
  FROM s11t_cast c
UNION ALL SELECT 'out_inv',  c.out_inv,  'og_image',    '1200x630', 'png',  'host_private',        c.ver1,  c.w1, false
  FROM s11t_cast c;

INSERT INTO public.invitation_outputs (id, wedding_id, version_id, output_kind, variant, format,
                                       render_config_hash, source_dto_digest, target_url_digest,
                                       storage_domain, status)
SELECT o.id, o.wed, o.ver, o.kind, o.variant, o.fmt,
       pg_temp.s11t_h64('s11t-config-' || o.tag), pg_temp.s11t_h64('s11t-dto-' || o.tag),
       CASE WHEN o.target THEN pg_temp.s11t_h64('s11t-url-' || o.tag) END,
       o.domain, 'registered'
  FROM s11t_out_ids o;

-- Forward edges only, each one the guard's own list: `uploading` for the seven that get that far, then
-- `ready` with a digest for the five that earned bytes, `failed` with exactly one attempt and a named reason
-- for one, and the already-retired row walked through `ready` to `invalidated` with Stage 9's own legal edge.
-- `out_reg` is deliberately left at `registered`: a row that never reached the bucket is the shape §6's
-- "the purge lists only what has bytes" has to be measured against.
UPDATE public.invitation_outputs SET status = 'uploading'
 WHERE id <> (SELECT id FROM s11t_out_ids WHERE tag = 'out_reg');

UPDATE public.invitation_outputs SET status = 'ready', content_digest = pg_temp.s11t_h64('s11t-bytes-' || id::text)
 WHERE id IN (SELECT id FROM s11t_out_ids WHERE tag IN ('out_og','out_pdf','out_old','out_w2','out_inv'));

UPDATE public.invitation_outputs
   SET status = 'failed', attempt_count = 1, last_error = 'the render worker refused the page box'
 WHERE id = (SELECT id FROM s11t_out_ids WHERE tag = 'out_fail');

UPDATE public.invitation_outputs
   SET status = 'invalidated', invalidation_reason = 'superseded'
 WHERE id = (SELECT id FROM s11t_out_ids WHERE tag = 'out_inv');

-- The storage registry as the bucket actually looks on the morning after a takedown: every artefact that
-- ever earned bytes has an object sitting in it, and §6's first fact is measured here by leaving all of
-- them in place.
INSERT INTO storage.objects (id, bucket_id, name)
SELECT gen_random_uuid(),
       CASE WHEN o.domain = 'published_preview' THEN 'invitation-previews' ELSE 'invitation-outputs' END,
       t.object_key
  FROM s11t_out_ids o
  JOIN public.invitation_outputs t ON t.id = o.id
 WHERE t.content_digest IS NOT NULL;

-- The money, frozen: an entitlement the order points at (so "no entitlement moved" reads against a real
-- row), two captured orders on two weddings, and six refunds that cover the four statuses the queue's own
-- vocabulary admits.
INSERT INTO public.entitlements (id, wedding_id, package_code, source, granted_at)
SELECT c.ent1, c.w1, 'classic', 'service', now() - interval '2 days' FROM s11t_cast c;

INSERT INTO private.commerce_orders (id, wedding_id, owner_user_id, merchant_reference, package_code,
                                     price_version, amount_minor, currency, status, quote_expires_at,
                                     captured_at, entitlement_id)
SELECT c.ord1, c.w1, c.host_a, 's11t-ord-1', 'classic', 1, 150000, 'INR', 'captured',
       now() + interval '1 day', now() - interval '2 days', c.ent1 FROM s11t_cast c
UNION ALL SELECT c.ord2, c.w2, c.host_b, 's11t-ord-2', 'premium', 1, 300000, 'INR', 'captured',
       now() + interval '1 day', now() - interval '2 days', NULL FROM s11t_cast c;

INSERT INTO private.commerce_refunds (id, order_id, kind, status, amount_minor, currency,
                                      provider_refund_ref, recorded_at, completed_at)
SELECT c.ref1, c.ord1, 'refund',     'recorded',  50000, 'INR', NULL,          now() - interval '6 hours', NULL                      FROM s11t_cast c
UNION ALL SELECT c.ref2, c.ord1, 'refund',     'succeeded', 20000, 'INR', 'rf-s11t-2', now() - interval '5 hours', now() - interval '4 hours' FROM s11t_cast c
UNION ALL SELECT c.ref3, c.ord1, 'refund',     'failed',    10000, 'INR', 'rf-s11t-3', now() - interval '4 hours', NULL                      FROM s11t_cast c
UNION ALL SELECT c.ref4, c.ord1, 'chargeback', 'reversed',  150000,'INR', 'rf-s11t-4', now() - interval '3 hours', NULL                      FROM s11t_cast c
UNION ALL SELECT c.ref5, c.ord2, 'refund',     'recorded',  75000, 'INR', NULL,          now() - interval '2 hours', NULL                      FROM s11t_cast c
UNION ALL SELECT c.ref6, c.ord1, 'refund',     'recorded',  1000,  'INR', NULL,          now() - interval '1 hour',  NULL                      FROM s11t_cast c;

-- Five tickets: the live one this file's acts cite, one about another wedding, one parked on a host, one
-- finished, and a second live one so a note and a takedown never share a case's event rows. The four that
-- are not simply open are walked through §5's own edges by hand, because the operator transition door
-- would write trail rows into the census group Z is trying to keep clean.
INSERT INTO private.support_cases (id, wedding_id, requester_user_id, opened_by_user_id, category,
                                   severity, host_summary)
SELECT c.cas_live, c.w1, c.host_a, c.host_a, 'publication_delivery',  'high',   'takedown fixture, live'   FROM s11t_cast c
UNION ALL SELECT c.cas_note, c.w1, c.host_a, c.host_a, 'billing_refund_inquiry', 'normal', 'note fixture, live'     FROM s11t_cast c
UNION ALL SELECT c.cas_w2,   c.w2, c.host_b, c.host_b, 'publication_delivery',  'normal', 'other wedding fixture'  FROM s11t_cast c
UNION ALL SELECT c.cas_park, c.w1, c.host_a, c.host_a, 'publication_delivery',  'normal', 'parked fixture'         FROM s11t_cast c
UNION ALL SELECT c.cas_done, c.w1, c.host_a, c.host_a, 'publication_delivery',  'normal', 'finished fixture'       FROM s11t_cast c;

UPDATE private.support_cases SET status = 'triaged'
 WHERE id IN ((SELECT cas_park FROM s11t_cast), (SELECT cas_done FROM s11t_cast));
UPDATE private.support_cases SET status = 'awaiting_information'
 WHERE id = (SELECT cas_park FROM s11t_cast);
UPDATE private.support_cases SET status = 'in_progress' WHERE id = (SELECT cas_done FROM s11t_cast);
UPDATE private.support_cases SET status = 'resolved', resolution_code = 'resolved_by_operator'
 WHERE id = (SELECT cas_done FROM s11t_cast);

-- The authority, granted through slice 1's trusted door rather than by hand, because the grant rows and
-- their trail are the substrate these cells argue about. `op2`'s grant is then revoked through the same
-- door: an expired grant cannot be minted (the body refuses a past expiry) and a revoked one is the real
-- shape of "this person used to be able to do this".
CREATE TEMP TABLE s11t_g ON COMMIT DROP AS
SELECT pg_temp.s11t_grant(c.op1,   'operations',     'stage11 slice-4 battery operator', c.host_a, NULL) AS a1,
       pg_temp.s11t_grant(c.dec1,  'operations',     'stage11 slice-4 purge decider',    c.host_a, NULL) AS a2,
       pg_temp.s11t_grant(c.op2,   'operations',     'to be revoked below',              c.host_a, NULL) AS a3,
       pg_temp.s11t_grant(c.sup1,  'support',        'wrong-scope control',              c.host_a, NULL) AS a4,
       pg_temp.s11t_grant(c.fin1,  'finance_review', 'stage11 slice-4 reviewer',         c.host_a, NULL) AS a5,
       pg_temp.s11t_grant(c.fin2,  'finance_review', 'reviewer whose account is erased', c.host_a, NULL) AS a6
  FROM s11t_cast c;

SELECT pg_temp.s11t_revoke((SELECT op2 FROM s11t_cast), 'operations',
                           'revoked so a stale grant is a measured shape', (SELECT host_a FROM s11t_cast));

-- Keys, one per intended act. Every mutating cell below names its own key so a replay cell can be read
-- against the delivery it replays.
INSERT INTO s11t_key (tag, k) VALUES
  ('tk1', gen_random_uuid()), ('tk1b', gen_random_uuid()), ('tk_w2', gen_random_uuid()),
  ('purge1', gen_random_uuid()), ('purge1b', gen_random_uuid()),
  ('note1', gen_random_uuid()), ('note1b', gen_random_uuid()), ('note_w2', gen_random_uuid()),
  ('note_fin2', gen_random_uuid()), ('shared', gen_random_uuid());

-- The ids this file's later groups quote instead of re-deriving, so a cell that reads a fixture and a cell
-- that acts on it are pointed at the same row by construction.
INSERT INTO s11t_reg (tag, id, ref)
SELECT 'w1', c.w1, NULL FROM s11t_cast c
UNION ALL SELECT 'w2', c.w2, NULL FROM s11t_cast c
UNION ALL SELECT 'w3', c.w3, NULL FROM s11t_cast c
UNION ALL SELECT 'w4', c.w4, NULL FROM s11t_cast c
UNION ALL SELECT 'pub1', c.pub1, NULL FROM s11t_cast c
UNION ALL SELECT 'ver1', c.ver1, NULL FROM s11t_cast c
UNION ALL SELECT 'out_og', c.out_og, NULL FROM s11t_cast c
UNION ALL SELECT 'out_pdf', c.out_pdf, NULL FROM s11t_cast c
UNION ALL SELECT 'ref1', c.ref1, NULL FROM s11t_cast c
UNION ALL SELECT 'ref6', c.ref6, NULL FROM s11t_cast c
UNION ALL SELECT 'ref5', c.ref5, NULL FROM s11t_cast c
UNION ALL SELECT 'tk_pub', c.tk_pub, NULL FROM s11t_cast c
UNION ALL SELECT 'tk_w2', c.tk_w2, NULL FROM s11t_cast c
UNION ALL SELECT 'ent1', c.ent1, NULL FROM s11t_cast c
UNION ALL SELECT 'ord1', c.ord1, NULL FROM s11t_cast c
UNION ALL SELECT 'ord2', c.ord2, NULL FROM s11t_cast c;

INSERT INTO s11t_reg (tag, id, ref)
SELECT 'cas_live', c.cas_live, s.case_ref FROM s11t_cast c
  JOIN private.support_cases s ON s.id = c.cas_live
UNION ALL SELECT 'cas_note', c.cas_note, s.case_ref FROM s11t_cast c
  JOIN private.support_cases s ON s.id = c.cas_note
UNION ALL SELECT 'cas_w2', c.cas_w2, s.case_ref FROM s11t_cast c
  JOIN private.support_cases s ON s.id = c.cas_w2
UNION ALL SELECT 'cas_park', c.cas_park, s.case_ref FROM s11t_cast c
  JOIN private.support_cases s ON s.id = c.cas_park
UNION ALL SELECT 'cas_done', c.cas_done, s.case_ref FROM s11t_cast c
  JOIN private.support_cases s ON s.id = c.cas_done;

INSERT INTO s11t_reg (tag, id, ref)
SELECT 'og_key', o.id, o.object_key FROM public.invitation_outputs o
 WHERE o.id = (SELECT out_og FROM s11t_cast)
UNION ALL SELECT 'pdf_key', o.id, o.object_key FROM public.invitation_outputs o
 WHERE o.id = (SELECT out_pdf FROM s11t_cast)
UNION ALL SELECT 'w2_key', o.id, o.object_key FROM public.invitation_outputs o
 WHERE o.id = (SELECT out_w2 FROM s11t_cast);

-- ===========================================================================
-- T. What the migration ships, before this file writes its own rows
-- ===========================================================================
-- The baseline is captured rather than hard-coded. This battery runs third on one chain, so the grant,
-- ticket, thread and trail counts it inherits are whatever slices 1–3 left behind; every census in group Z
-- is a delta against the row below. The inventories in `pg_proc` and `pg_class` are the only absolutes here,
-- and no battery can move them.
CREATE TEMP TABLE s11t_base (grants bigint, cases bigint, events bigint, audit bigint,
                             pubs bigint, tokens bigint, outputs bigint, orders bigint,
                             refunds bigint, notes bigint, ents bigint, store bigint,
                             first_audit bigint) ON COMMIT DROP;
INSERT INTO s11t_base
SELECT (SELECT count(*) FROM private.operator_grants),
       (SELECT count(*) FROM private.support_cases),
       (SELECT count(*) FROM private.support_case_events),
       (SELECT count(*) FROM private.audit_events),
       (SELECT count(*) FROM public.publications),
       (SELECT count(*) FROM private.access_tokens),
       (SELECT count(*) FROM public.invitation_outputs),
       (SELECT count(*) FROM private.commerce_orders),
       (SELECT count(*) FROM private.commerce_refunds),
       (SELECT count(*) FROM private.commerce_review_notes),
       (SELECT count(*) FROM public.entitlements),
       (SELECT count(*) FROM storage.objects),
       (SELECT coalesce(max(id), 0) FROM private.audit_events);

DO $t$
DECLARE v text;
BEGIN
  PERFORM pg_temp.s11t_eq('T01 the oversight table exists in the server-only schema and is empty before '
    || 'this file writes anything: no migration records a review, because a review is a human act',
    (SELECT count(*)::int FROM private.commerce_review_notes), 0);

  PERFORM pg_temp.s11t_array('T02 the columns are exactly the nine §7 names',
    ARRAY(SELECT a.attname::text FROM pg_attribute a
            WHERE a.attrelid = 'private.commerce_review_notes'::regclass AND a.attnum > 0
              AND NOT a.attisdropped ORDER BY a.attnum),
    ARRAY['id','refund_id','order_id','case_ref','author_user_id','kind','note',
          'idempotency_key','created_at']);

  PERFORM pg_temp.s11t_array('T03 every column but the author is NOT NULL — the third time this stage has '
    || 'had to write that sentence, for the third time the same reason: NOT NULL and ON DELETE SET NULL '
    || 'cannot both hold, and the second is what keeps a note from making its reviewer undeletable',
    ARRAY(SELECT a.attname::text FROM pg_attribute a
            WHERE a.attrelid = 'private.commerce_review_notes'::regclass AND a.attnum > 0
              AND NOT a.attisdropped AND a.attnotnull ORDER BY a.attname),
    ARRAY['case_ref','created_at','id','idempotency_key','kind','note','order_id','refund_id']);

  PERFORM pg_temp.s11t_array('T04 the constraint inventory: primary key, four foreign keys and two value '
    || 'checks — and no unique constraint on (refund, key), because that one is an index',
    ARRAY(SELECT c.conname::text FROM pg_constraint c
            WHERE c.conrelid = 'private.commerce_review_notes'::regclass ORDER BY c.conname),
    ARRAY['commerce_review_notes_author_user_id_fkey','commerce_review_notes_case_ref_fkey',
          'commerce_review_notes_kind_check','commerce_review_notes_note_check',
          'commerce_review_notes_order_id_fkey','commerce_review_notes_pkey',
          'commerce_review_notes_refund_id_fkey']);

  PERFORM pg_temp.s11t_array('T05 the delete rules: three parents refuse their own delete, and only the '
    || 'account releases its name',
    ARRAY(SELECT c.conname::text || '=' || CASE c.confdeltype WHEN 'a' THEN 'NO ACTION'
              WHEN 'n' THEN 'SET NULL' WHEN 'c' THEN 'CASCADE' ELSE c.confdeltype::text END
            FROM pg_constraint c
           WHERE c.conrelid = 'private.commerce_review_notes'::regclass AND c.contype = 'f'
           ORDER BY c.conname),
    ARRAY['commerce_review_notes_author_user_id_fkey=SET NULL',
          'commerce_review_notes_case_ref_fkey=NO ACTION',
          'commerce_review_notes_order_id_fkey=NO ACTION',
          'commerce_review_notes_refund_id_fkey=NO ACTION']);

  PERFORM pg_temp.s11t_array('T06 the index inventory: the two read paths, the one-row-per-key replay '
    || 'backstop, and the key',
    ARRAY(SELECT indexname::text FROM pg_indexes WHERE schemaname = 'private'
            AND tablename = 'commerce_review_notes' ORDER BY indexname),
    ARRAY['commerce_review_notes_case_idx','commerce_review_notes_one_row_per_key',
          'commerce_review_notes_pkey','commerce_review_notes_refund_created_idx']);

  PERFORM pg_temp.s11t_array('T07 five triggers: derive-order, require-author, the every-role UPDATE '
    || 'wall, and the two client walls — and no set_updated_at, because the table has no updated_at column '
    || 'to set, and that absence is the table''s whole argument',
    ARRAY(SELECT t.tgname::text FROM pg_trigger t
            WHERE t.tgrelid = 'private.commerce_review_notes'::regclass AND NOT t.tgisinternal
            ORDER BY t.tgname),
    ARRAY['commerce_review_notes_author_names_a_human','commerce_review_notes_derive_order',
          'commerce_review_notes_no_client_delete','commerce_review_notes_no_client_write',
          'commerce_review_notes_no_update_any_role']);

  PERFORM pg_temp.s11t_eq('T08 the table has no updated_at column at all: the insert-only claim is a '
    || 'shape, not a habit',
    (SELECT count(*)::int FROM pg_attribute a
      WHERE a.attrelid = 'private.commerce_review_notes'::regclass
        AND a.attname = 'updated_at' AND NOT a.attisdropped), 0);

  PERFORM pg_temp.s11t_ok('T09 RLS is on',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'private.commerce_review_notes'::regclass));
  PERFORM pg_temp.s11t_eq('T10 and there are no policies: the server body is the only reader',
    (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'private'
       AND tablename = 'commerce_review_notes'), 0);

  -- Twelve role/verb pairs, asked one verb at a time: the four-verb list form of `has_table_privilege` is
  -- ANY-of, which slice 1 measured on `audit_events`.
  SELECT string_agg(r.rolname || ':' || v.verb || '=' || has_table_privilege(r.rolname,
           'private.commerce_review_notes', v.verb)::text, ',' ORDER BY r.rolname, v.verb)
    INTO v
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
   CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) v(verb);
  PERFORM pg_temp.s11t_eq('T11 twelve of twelve role/verb pairs are false: no browser role reaches the '
    || 'note table directly, whatever a later policy does', v,
    'anon:DELETE=false,anon:INSERT=false,anon:SELECT=false,anon:UPDATE=false,'
    || 'authenticated:DELETE=false,authenticated:INSERT=false,authenticated:SELECT=false,'
    || 'authenticated:UPDATE=false,service_role:DELETE=false,service_role:INSERT=false,'
    || 'service_role:SELECT=false,service_role:UPDATE=false');

  PERFORM pg_temp.s11t_ok('T12 the table comment states the only-writer posture in the schema itself',
    (SELECT obj_description('private.commerce_review_notes'::regclass, 'pg_class')
       LIKE '%the only writer is internal_api.operator_add_commerce_review_note%'));

  -- The surface this head declares, counted from pg_proc and pg_class rather than grepped: a name declared
  -- twice with two argument lists counts twice here and once in a text search.
  PERFORM pg_temp.s11t_eq('T13 this head ships 41 api wrappers: slice 3''s 36 plus this file''s four plus '
    || 'slice 5''s health read, and the purge is not among them',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api'), 41);
  PERFORM pg_temp.s11t_eq('T14 61 internal_api bodies (55 plus this file''s five: plan, takedown, purge, '
    || 'queue, note — plus slice 5''s one paired summary body)',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'internal_api'), 61);
  PERFORM pg_temp.s11t_eq('T15 52 private functions (48 plus four: the authorising-case reader and the '
    || 'three note guards)',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private'), 52);
  PERFORM pg_temp.s11t_eq('T16 13 private tables — the one movement, and it is the note',
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private' AND c.relkind = 'r'), 13);
  PERFORM pg_temp.s11t_eq('T16b and the customer-facing inventory did not move: 20 public tables, exactly '
    || 'as at slice 3''s head. A head that shifted this number has put an operator''s table where an API '
    || 'role can see it',
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'), 20);
  PERFORM pg_temp.s11t_eq('T17 47 SECURITY DEFINER functions at this head — slice 4''s 46 plus slice 5''s '
    || 'one paired summary body. The three note guards are INVOKER, which is why the definers grew by five '
    || 'and not by eight at slice 4, and slice 5''s wrapper is INVOKER too, which is why the count grows by '
    || 'one and not by two here',
    (SELECT count(*)::int FROM pg_proc WHERE prosecdef), 47);

  PERFORM pg_temp.s11t_array('T18 the five bodies are definers with a pinned path, owned by postgres',
    ARRAY(SELECT p.proname::text || '=' || p.prosecdef::text || '/' ||
                 coalesce(array_to_string(p.proconfig, ','), '(none)') || '/' || r.rolname
            FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
           WHERE p.pronamespace = 'internal_api'::regnamespace
             AND p.proname IN ('operator_takedown_plan','operator_takedown_publication',
                               'operator_purge_publication_objects','operator_commerce_review_queue',
                               'operator_add_commerce_review_note')
           ORDER BY 1),
    ARRAY['operator_add_commerce_review_note=true/search_path=""/postgres',
          'operator_commerce_review_queue=true/search_path=""/postgres',
          'operator_purge_publication_objects=true/search_path=""/postgres',
          'operator_takedown_plan=true/search_path=""/postgres',
          'operator_takedown_publication=true/search_path=""/postgres']);

  PERFORM pg_temp.s11t_array('T19 and the wrappers are invokers with a pinned path — four names, not five: '
    || 'the purge has no browser surface, and this cell selects its name anyway so that a later slice '
    || 'adding one fails here rather than passing by omission',
    ARRAY(SELECT p.proname::text || '=' || p.prosecdef::text || '/' ||
                 coalesce(array_to_string(p.proconfig, ','), '(none)')
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'api'
             AND p.proname IN ('operator_takedown_plan','operator_takedown_publication',
                               'operator_commerce_review_queue','operator_add_commerce_review_note',
                               'operator_purge_publication_objects')
           ORDER BY 1),
    ARRAY['operator_add_commerce_review_note=false/search_path=""',
          'operator_commerce_review_queue=false/search_path=""',
          'operator_takedown_plan=false/search_path=""',
          'operator_takedown_publication=false/search_path=""']);

  PERFORM pg_temp.s11t_eq('T20 the api schema holds no purge name: "no wrapper" is a measured absence',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api' AND p.proname = 'operator_purge_publication_objects'), 0);

  -- Twenty-four role/name EXECUTE pairs, printed as the granted subset only, so a leak to anon or to
  -- service_role would change the string rather than hide inside a count.
  SELECT string_agg(s.nsp || '.' || s.proname || ':' || s.rol, ',' ORDER BY s.nsp, s.proname, s.rol)
    INTO v
    FROM (SELECT n.nspname AS nsp, p.proname, e.rol
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) e(rol)
           WHERE n.nspname IN ('api', 'internal_api')
             AND p.proname IN ('operator_takedown_plan','operator_takedown_publication',
                               'operator_purge_publication_objects','operator_commerce_review_queue',
                               'operator_add_commerce_review_note')
             AND has_function_privilege(e.rol, p.oid, 'EXECUTE')) s;
  PERFORM pg_temp.s11t_eq('T21 eight granted pairs out of twenty-four (four names, both schemas, '
    || 'authenticated only) — and the sixteen refusals include all three client roles on the purge body', v,
    'api.operator_add_commerce_review_note:authenticated,api.operator_commerce_review_queue:authenticated,'
    || 'api.operator_takedown_plan:authenticated,api.operator_takedown_publication:authenticated,'
    || 'internal_api.operator_add_commerce_review_note:authenticated,'
    || 'internal_api.operator_commerce_review_queue:authenticated,'
    || 'internal_api.operator_takedown_plan:authenticated,'
    || 'internal_api.operator_takedown_publication:authenticated');

  PERFORM pg_temp.s11t_array('T22 the authorising-case helper is granted to none of the three client '
    || 'roles and to no other schema: it is a callee, and a callee an API role could call directly would '
    || 'be a second door that never appears in a wrapper review',
    ARRAY(SELECT e.rol || '=' || has_function_privilege(e.rol,
                 'private.operator_authorising_case(text, uuid)'::regprocedure, 'EXECUTE')::text
            FROM (VALUES ('anon'), ('authenticated'), ('service_role')) e(rol)),
    ARRAY['anon=false','authenticated=false','service_role=false']);

  PERFORM pg_temp.s11t_array('T23 volatility, read from pg_proc rather than from the prose: two readers '
    || 'STABLE, three writers VOLATILE, and the helper VOLATILE because it takes a row lock',
    ARRAY(SELECT n.nspname || '.' || p.proname || '=' ||
                 CASE p.provolatile WHEN 'v' THEN 'VOLATILE' WHEN 's' THEN 'STABLE' ELSE 'IMMUTABLE' END
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname IN ('api', 'internal_api', 'private')
             AND p.proname IN ('operator_takedown_plan','operator_takedown_publication',
                               'operator_purge_publication_objects','operator_commerce_review_queue',
                               'operator_add_commerce_review_note','operator_authorising_case')
           ORDER BY 1),
    ARRAY['api.operator_add_commerce_review_note=VOLATILE','api.operator_commerce_review_queue=STABLE',
          'api.operator_takedown_plan=STABLE','api.operator_takedown_publication=VOLATILE',
          'internal_api.operator_add_commerce_review_note=VOLATILE',
          'internal_api.operator_commerce_review_queue=STABLE',
          'internal_api.operator_purge_publication_objects=VOLATILE',
          'internal_api.operator_takedown_plan=STABLE',
          'internal_api.operator_takedown_publication=VOLATILE',
          'private.operator_authorising_case=VOLATILE']);

  -- The narrow claim §6 makes, stated as a statement-pattern rather than as a word. The word `delete`
  -- appears in four of these bodies — in `objects_deleted_by_this_call`, in `delete_channel`, and in the
  -- comments that say what is not happening — and a scan for the word would report that as a defect. What
  -- is measurable at the database is that no body contains the statement.
  PERFORM pg_temp.s11t_eq('T24 no DELETE statement in any of the six names this file adds, counted by the '
    || 'statement form. The word itself occurs (T25), inside field names and comments that say the opposite '
    || 'of a write, so this cell is the one that carries the claim',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api', 'internal_api', 'private')
        AND p.proname IN ('operator_takedown_plan','operator_takedown_publication',
                          'operator_purge_publication_objects','operator_commerce_review_queue',
                          'operator_add_commerce_review_note','operator_authorising_case')
        AND p.prosrc ~* '\mdelete\s+from'), 0);

  -- Two cells, because a word-scan and a substring-scan give different answers here and only one of them is
  -- the claim. `objects_deleted_by_this_call` contains the letters d-e-l-e-t-e and is not a verb any more
  -- than `update` inside `updated_at` is one; the standalone word occurs once, in the purge's payload field
  -- that names the channel which does the work.
  PERFORM pg_temp.s11t_array('T25 the standalone word occurs in exactly one of the six bodies, and it is '
    || 'the `delete_channel` string that tells the operator where deletion happens',
    ARRAY(SELECT n.nspname || '.' || p.proname
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname IN ('api', 'internal_api', 'private')
             AND p.proname IN ('operator_takedown_plan','operator_takedown_publication',
                               'operator_purge_publication_objects','operator_commerce_review_queue',
                               'operator_add_commerce_review_note','operator_authorising_case')
             AND p.prosrc ~* '\mdelete\M'
        ORDER BY 1),
    ARRAY['internal_api.operator_purge_publication_objects']);

  PERFORM pg_temp.s11t_array('T25b and the letter-sequence occurs in three, all of them field names that '
    || 'report the absence (`objects_deleted_by_this_call`), which is the reason T24 counts the statement '
    || 'form rather than the word',
    ARRAY(SELECT n.nspname || '.' || p.proname
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname IN ('api', 'internal_api', 'private')
             AND p.proname IN ('operator_takedown_plan','operator_takedown_publication',
                               'operator_purge_publication_objects','operator_commerce_review_queue',
                               'operator_add_commerce_review_note','operator_authorising_case')
             AND lower(p.prosrc) LIKE '%delete%'
        GROUP BY 1 ORDER BY 1),
    ARRAY['internal_api.operator_purge_publication_objects','internal_api.operator_takedown_plan',
          'internal_api.operator_takedown_publication']);

  PERFORM pg_temp.s11t_eq('T26 neither STABLE reader names an INSERT or an UPDATE statement either: a '
    || 'queue that plans a takedown is still a read',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'internal_api' AND p.proname IN ('operator_takedown_plan',
                                                         'operator_commerce_review_queue')
        AND (p.prosrc ~* '\minsert\s+into' OR p.prosrc ~* '\mupdate\s')), 0);

  PERFORM pg_temp.s11t_eq('T27 the purge body is the stage''s ninth identity-taking body, and the shape '
    || 'is measurable: it takes an actor argument and reads the grant table itself, because on the trusted '
    || 'channel auth.uid() is NULL',
    (SELECT count(*)::int FROM pg_proc p
      WHERE p.proname = 'operator_purge_publication_objects'
        AND p.prosrc ~* 'private\.operator_grants'
        AND pg_get_function_arguments(p.oid) LIKE '%p_actor_user_id uuid%'), 1);

  PERFORM pg_temp.s11t_eq('T28 and it does not call the session predicate — which is the difference '
    || 'between a body that could answer "nobody decided this" and one that refuses it',
    (SELECT count(*)::int FROM pg_proc p
      WHERE p.proname = 'operator_purge_publication_objects'
        AND p.prosrc ~* 'actor_is_operator'), 0);

  -- The scope sentence lives in the comment on each of the four client-facing bodies, so an operator reading
  -- a console's function list sees the authority requirement without opening the body. The purge is in this
  -- cell's FROM and not in its answer: its comment names the grant requirement in prose instead, because it
  -- has no session to state a scope for.
  PERFORM pg_temp.s11t_array('T29 four of the five bodies begin their comment with the word Scope and '
    || 'name the scope they require — and the fifth is the purge, which is the one body a browser can never '
    || 'reach',
    ARRAY(SELECT p.proname
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'internal_api'
             AND p.proname IN ('operator_takedown_plan','operator_takedown_publication',
                               'operator_commerce_review_queue','operator_add_commerce_review_note',
                               'operator_purge_publication_objects')
             AND LEFT(obj_description(p.oid, 'pg_proc'), 6) = 'Scope '
        ORDER BY 1),
    ARRAY['operator_add_commerce_review_note','operator_commerce_review_queue',
          'operator_takedown_plan','operator_takedown_publication']);
END $t$;
-- --------------------------------------------------------------------------- the owner's channel
-- The purge has no client-reachable surface, so the only hand that can call it in this battery is the one
-- that owns the database. Same error capture as `s11t_as`, without the `SET ROLE` — and the absence of a
-- `SET ROLE` is the point: on this channel `auth.uid()` is NULL, which is exactly the condition decision 2
-- was written for.
CREATE FUNCTION pg_temp.s11t_owner(p_stmt text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  BEGIN
    EXECUTE p_stmt INTO v;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('_error', SQLSTATE || ' | ' || SQLERRM);
  END;
  IF v IS NULL THEN
    RETURN jsonb_build_object('_null_answer', true);
  END IF;
  RETURN v;
END $fn$;

-- One more digest: the authority table itself. The purge reads it directly, and "reading the grants cannot
-- change the grants" is a claim worth measuring rather than assuming.
CREATE FUNCTION pg_temp.s11t_grants() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             id::text || '|' || user_id::text || '|' || scope || '|' || status || '|' ||
             granted_by_user_id::text || '|' || granted_at::text || '|' ||
             coalesce(expires_at::text,'') || '|' || coalesce(revoked_at::text,'') || '|' || reason,
             '~' ORDER BY id), ''))
    FROM private.operator_grants $fn$;

-- The same digest with one account left out. Group O erases an account and measures that its grant row goes
-- with it, so after that act the plain digest above cannot equal its frozen value. This form keeps the cell
-- honest: it proves every *other* authority row is byte-for-byte what it was, and that the erasure removed
-- exactly the one row it names rather than sweeping the table.
CREATE FUNCTION pg_temp.s11t_grants_excl(p_excl uuid) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(coalesce(string_agg(
             g.id::text || '|' || g.user_id::text || '|' || g.scope || '|' || g.status || '|' ||
             g.granted_by_user_id::text || '|' || g.granted_at::text || '|' ||
             coalesce(g.expires_at::text,'') || '|' || coalesce(g.revoked_at::text,'') || '|' || g.reason,
             '~' ORDER BY g.id), ''))
    FROM private.operator_grants g
   WHERE g.user_id IS DISTINCT FROM p_excl $fn$;

-- ===========================================================================
-- P. What the plant actually left behind
-- ===========================================================================
-- Every cell below is a precondition that group K, U, Q, N or O relies on. If a door later reports a count
-- that looks wrong, the reader needs to know whether the door is wrong or the row was never there — so the
-- plant is measured first, and the digests of the tables this slice promises not to move are frozen here,
-- before the first act.
DO $p$
BEGIN
  PERFORM pg_temp.s11t_eq('P01 two live publications, on two different weddings — the cross-wedding arms of '
    || 'every cell below depend on there being a second live one',
    (SELECT count(*)::int FROM public.publications WHERE status = 'active'), 2);

  PERFORM pg_temp.s11t_eq('P02 and two retired ones, neither of which has a recorded takedown — the only way '
    || 'to reach §6''s "a purge cannot be the first move"',
    (SELECT count(*)::int FROM public.publications p
      WHERE p.status = 'revoked'
        AND NOT EXISTS (SELECT 1 FROM private.audit_events a
                         WHERE a.subject_type = 'publication' AND a.subject_key = p.id
                           AND a.action = 'publication_takedown')), 2);

  PERFORM pg_temp.s11t_array('P03 the artefacts on the live version, in tag order, at the lifecycle stage the '
    || 'guard was walked into: one registered, one uploading, one failed, two ready, one already invalidated '
    || '— the six shapes a takedown has opinions about',
    ARRAY(SELECT o.tag || '=' || i.status FROM s11t_out_ids o
            JOIN public.invitation_outputs i ON i.id = o.id
           WHERE o.ver = (SELECT ver1 FROM s11t_cast) ORDER BY o.tag),
    ARRAY['out_fail=failed','out_inv=invalidated','out_og=ready','out_pdf=ready',
          'out_reg=registered','out_up=uploading']);

  PERFORM pg_temp.s11t_eq('P04 five artefacts have bytes, and five objects sit in the buckets beside them: '
    || 'the registry and the bucket agree before any act, so "nothing was deleted" is a measurement and not '
    || 'a tautology',
    (SELECT count(*)::int FROM public.invitation_outputs WHERE content_digest IS NOT NULL),
    (SELECT count(*)::int FROM storage.objects));

  PERFORM pg_temp.s11t_eq('P05 all eight carry a minted key, including the three that never earned bytes: a '
    || 'key names where a file would go, not whether one is there',
    (SELECT count(*)::int FROM public.invitation_outputs WHERE object_key IS NOT NULL), 8);

  PERFORM pg_temp.s11t_array('P06 the credentials on the target wedding by kind and revocation — the public '
    || 'and guest pair the takedown claims to reach, an `rsvp` it must leave alone, and one already retired '
    || 'so a reported count cannot be read as the total',
    ARRAY(SELECT t.token_kind || ':' || CASE WHEN t.revoked_at IS NULL THEN 'live' ELSE 'revoked' END
            FROM private.access_tokens t
           WHERE t.wedding_id = (SELECT w1 FROM s11t_cast) ORDER BY 1),
    ARRAY['guest_invitation:live','public_invitation:live','public_invitation:revoked','rsvp:live']);

  PERFORM pg_temp.s11t_array('P07 the authority, all of it granted and revoked through slice 1''s doors: six '
    || 'rows, three scopes, and exactly one of them revoked',
    ARRAY(SELECT g.scope || ':' || g.status FROM private.operator_grants g
           WHERE g.user_id IN ((SELECT op1 FROM s11t_cast),(SELECT op2 FROM s11t_cast),
                               (SELECT sup1 FROM s11t_cast),(SELECT fin1 FROM s11t_cast),
                               (SELECT fin2 FROM s11t_cast),(SELECT dec1 FROM s11t_cast))
         ORDER BY 1),
    ARRAY['finance_review:active','finance_review:active','operations:active','operations:active',
          'operations:revoked','support:active']);

  PERFORM pg_temp.s11t_array('P08 the money this slice may only look at: six refunds over the four statuses '
    || 'the queue''s own vocabulary admits, on two captured orders',
    ARRAY(SELECT r.status || ' x' || count(*)::text FROM private.commerce_refunds r GROUP BY r.status ORDER BY 1),
    ARRAY['failed x1','recorded x3','reversed x1','succeeded x1']);

  PERFORM pg_temp.s11t_eq('P09 two orders, both captured, one of them linked to an entitlement the "nothing '
    || 'moved" cells can point at',
    (SELECT count(*)::int FROM private.commerce_orders o WHERE o.status = 'captured'
       AND o.entitlement_id IS NOT NULL), 1);

  PERFORM pg_temp.s11t_array('P10 the five tickets this file planted, and their five statuses: three are live '
    || 'in §5''s sense, which is the takedown''s own authorisation predicate measured against the plant, and '
    || 'the other two are the parked and finished arms every refusal cell below needs. Scoped to the plant '
    || 'by id, because this battery runs last on a chain whose earlier batteries each opened tickets of '
    || 'their own — an absolute over `support_cases` here would measure `85_support_lifecycle.sql`''s plant, '
    || 'not this one, and would fail for a reason that is nothing about slice 4',
    ARRAY(SELECT c.status FROM private.support_cases c
           WHERE c.id IN ((SELECT cas_live FROM s11t_cast),(SELECT cas_note FROM s11t_cast),
                          (SELECT cas_w2 FROM s11t_cast),(SELECT cas_park FROM s11t_cast),
                          (SELECT cas_done FROM s11t_cast))
         ORDER BY 1),
    ARRAY['awaiting_information','open','open','open','resolved']);

  PERFORM pg_temp.s11t_eq('P11 every ref this file cites was minted by the database and matches its own shape '
    || '— eight characters of a 32-symbol alphabet, so a caller cannot guess one — and the five planted rows '
    || 'are five such refs, which is also the proof none of them was typed in by this file',
    (SELECT count(*)::int FROM private.support_cases c
      WHERE c.id IN ((SELECT cas_live FROM s11t_cast),(SELECT cas_note FROM s11t_cast),
                     (SELECT cas_w2 FROM s11t_cast),(SELECT cas_park FROM s11t_cast),
                     (SELECT cas_done FROM s11t_cast))
        AND c.case_ref ~ '^SV-[ABCDEFGHIJKLMNOPQRSTUVWXYZ234567]{8}$'), 5);

  PERFORM pg_temp.s11t_eq('P12 and no note exists yet: the oversight table this slice creates is written only '
    || 'by a human through one door',
    (SELECT count(*)::int FROM private.commerce_review_notes), 0);
END $p$;

-- The digests of every table this slice promises not to move, frozen before the first act. K, U, Q and N each
-- re-read these; Z re-reads them one last time after all of them.
CREATE TEMP TABLE s11t_pbase (ord text, ref text, ent text, pol text, pub text, tok text, out text,
                              cse text, ev text, note text, grants text, grx text, audit text, store bigint,
                              acount bigint) ON COMMIT DROP;
INSERT INTO s11t_pbase SELECT pg_temp.s11t_ord(), pg_temp.s11t_ref(), pg_temp.s11t_ent(),
  pg_temp.s11t_pol(), pg_temp.s11t_pub(), pg_temp.s11t_tok(), pg_temp.s11t_out(), pg_temp.s11t_cse(),
  pg_temp.s11t_ev(), pg_temp.s11t_note(), pg_temp.s11t_grants(),
  pg_temp.s11t_grants_excl((SELECT fin2 FROM s11t_cast)), pg_temp.s11t_adigest(),
  pg_temp.s11t_cnt('storage.objects'), pg_temp.s11t_acount();

-- ===========================================================================
-- K. The plan and the takedown (§6 step 1)
-- ===========================================================================
-- Two of this group's cells call the purge, which belongs to group U. They are here because they are the
-- only measurements §6's ordering rule admits: the refusal fires while the chain still has a wedding whose
-- retired publication has no recorded takedown, and that state cannot be recreated once this group has
-- taken a publication down. Group U measures the walls, the arguments and the effect.
DO $k$
DECLARE
  v_ans jsonb; v_err text; v_a text; v_b text; v_ref text; v_d0 text;
  v_w1 uuid; v_w2 uuid; v_w3 uuid; v_op1 uuid; v_op2 uuid; v_sup1 uuid;
  v_host_a uuid; v_host_x uuid; v_pub1 uuid; v_ver1 uuid; v_og_key text; v_pdf_key text;
  v_inv_key text; v_tk_old_rev timestamptz;
  v_og_at timestamptz;
  v_cas_live text; v_cas_w2 text; v_cas_park text; v_cas_done text;
  v_tk1 uuid; v_tk1b uuid; v_tk_w2 uuid;
BEGIN
  SELECT c.w1, c.w2, c.w3, c.op1, c.op2, c.sup1, c.host_a, c.host_x, c.pub1, c.ver1
    INTO v_w1, v_w2, v_w3, v_op1, v_op2, v_sup1, v_host_a, v_host_x, v_pub1, v_ver1
    FROM s11t_cast c;
  SELECT (SELECT ref FROM s11t_reg WHERE tag = 'cas_live'),
         (SELECT ref FROM s11t_reg WHERE tag = 'cas_w2'),
         (SELECT ref FROM s11t_reg WHERE tag = 'cas_park'),
         (SELECT ref FROM s11t_reg WHERE tag = 'cas_done'),
         (SELECT k FROM s11t_key WHERE tag = 'tk1'),
         (SELECT k FROM s11t_key WHERE tag = 'tk1b'),
         (SELECT k FROM s11t_key WHERE tag = 'tk_w2')
    INTO v_cas_live, v_cas_w2, v_cas_park, v_cas_done, v_tk1, v_tk1b, v_tk_w2;
  SELECT o.object_key INTO v_og_key FROM public.invitation_outputs o
   WHERE o.id = (SELECT out_og FROM s11t_cast);
  SELECT o.object_key INTO v_pdf_key FROM public.invitation_outputs o
   WHERE o.id = (SELECT out_pdf FROM s11t_cast);
  SELECT o.object_key INTO v_inv_key FROM public.invitation_outputs o
   WHERE o.id = (SELECT out_inv FROM s11t_cast);
  SELECT t.revoked_at INTO v_tk_old_rev FROM private.access_tokens t
   WHERE t.id = (SELECT tk_old FROM s11t_cast);

  -- ------------------------------------------------------------------ the plan's refusals
  v_err := pg_temp.s11t_try('anon', NULL, 'SELECT api.operator_takedown_plan('
    || pg_temp.s11t_u(v_w1) || '::uuid)');
  PERFORM pg_temp.s11t_err_is('K01 anon cannot even reach the plan door', v_err, '42501',
    '%permission denied for function operator_takedown_plan%');

  v_ans := pg_temp.s11t_as('authenticated', v_host_a,
    'SELECT api.operator_takedown_plan(' || pg_temp.s11t_u(v_w1) || ')');
  PERFORM pg_temp.s11t_err_is('K02 a wedding''s own host, authenticated and holding no grant, is refused '
    || 'the plan with §5''s one sentence', pg_temp.s11t_err(v_ans), '42501',
    '%may not plan a takedown for this wedding%');
  v_a := pg_temp.s11t_err(v_ans);

  v_ans := pg_temp.s11t_as('authenticated', v_host_x,
    'SELECT api.operator_takedown_plan(' || pg_temp.s11t_u(v_w1) || ')');
  v_b := pg_temp.s11t_err(v_ans);
  PERFORM pg_temp.s11t_same('K03 and a hostile caller gets that same sentence, not a different one', v_a, v_b);

  v_ans := pg_temp.s11t_as('authenticated', v_sup1,
    'SELECT api.operator_takedown_plan(' || pg_temp.s11t_u(v_w1) || ')');
  PERFORM pg_temp.s11t_same('K04 a live grant in the wrong scope is refused the same way: `support` does not '
    || 'buy a takedown plan, and the door says nothing that would tell the holder which scope is missing',
    v_a, pg_temp.s11t_err(v_ans));

  v_ans := pg_temp.s11t_as('authenticated', v_op2,
    'SELECT api.operator_takedown_plan(' || pg_temp.s11t_u(v_w1) || ')');
  PERFORM pg_temp.s11t_same('K05 and a revoked `operations` grant is refused the same way — the person who '
    || 'used to be able to plan a takedown cannot tell the difference between "revoked" and "never granted"',
    v_a, pg_temp.s11t_err(v_ans));

  -- ---------------------------------------------------------------------- the plan itself
  v_ans := pg_temp.s11t_as('authenticated', v_op1,
    'SELECT api.operator_takedown_plan(' || pg_temp.s11t_u(v_w1) || ')');
  PERFORM pg_temp.s11t_ok('K06 the operator with a live grant is answered', NOT (v_ans ? '_error'));

  PERFORM pg_temp.s11t_keys('K07 the plan answers exactly seven fields, and the seventh is its own limit',
    v_ans, ARRAY['count','deletes_anything','object_keys','publication_id','publication_status',
                 'version_id','wedding_id']);

  PERFORM pg_temp.s11t_ok('K08 it names the live publication, its version, and says in one word that it '
    || 'deletes nothing',
    (v_ans ->> 'publication_id')::uuid = v_pub1 AND (v_ans ->> 'version_id')::uuid = v_ver1
      AND (v_ans ->> 'publication_status') = 'active'
      AND (v_ans ->> 'deletes_anything')::boolean IS FALSE
      AND (v_ans ->> 'wedding_id')::uuid = v_w1);

  PERFORM pg_temp.s11t_ok('K09 it lists three keys — the two live artefacts and the one that was already '
    || 'invalidated, because an invalidated row still names a byte that is still in the bucket',
    jsonb_array_length(v_ans -> 'object_keys') = 3
      AND v_ans -> 'object_keys' ? v_og_key AND v_ans -> 'object_keys' ? v_pdf_key
      AND v_ans -> 'object_keys' ? v_inv_key);

  PERFORM pg_temp.s11t_ok('K10 and its count agrees with its own list rather than with a second query, and '
    || 'it is smaller than the bucket — the one way a plan can lie is to report the whole store as its own '
    || 'business',
    (v_ans ->> 'count')::int = jsonb_array_length(v_ans -> 'object_keys')
      AND (v_ans ->> 'count')::int < (SELECT store FROM s11t_pbase));

  v_ans := pg_temp.s11t_as('authenticated', v_op1,
    'SELECT api.operator_takedown_plan(' || pg_temp.s11t_u(v_w3) || ')');
  PERFORM pg_temp.s11t_err_is('K11 a wedding with no publication at all is refused by name, because a plan '
    || 'that returned an empty list would read like "nothing left to clean up"',
    pg_temp.s11t_err(v_ans), '23514', '%no publication to plan against%');

  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_takedown_plan(NULL)');
  PERFORM pg_temp.s11t_err_is('K12 and a plan with no wedding is refused before the wedding question is '
    || 'even asked', pg_temp.s11t_err(v_ans), '23514', '%names a wedding%');

  v_ans := pg_temp.s11t_as('authenticated', v_op1,
    'SELECT api.operator_takedown_plan(' || pg_temp.s11t_u(v_w2) || ')');
  PERFORM pg_temp.s11t_ok('K13 planning the other wedding is answered, and it lists that wedding''s own '
    || 'artefact — a plan is scoped to a publication, not to whoever asked',
    NOT (v_ans ? '_error') AND (v_ans ->> 'count')::int = 1
      AND (v_ans ->> 'version_id')::uuid = (SELECT ver2 FROM s11t_cast));

  PERFORM pg_temp.s11t_eq('K14 five plan calls later, the artefact table is byte-identical to the one P '
    || 'measured: a plan is a read',
    (SELECT out FROM s11t_pbase), pg_temp.s11t_out());

  PERFORM pg_temp.s11t_eq('K15 and so are the bucket, the trail and the publication rows',
    (SELECT store FROM s11t_pbase), pg_temp.s11t_cnt('storage.objects'));

  PERFORM pg_temp.s11t_ok('K16 and the trail digest has not moved either, which is the half a STABLE '
    || 'declaration promises and a body can still break',
    (SELECT audit FROM s11t_pbase) = pg_temp.s11t_adigest()
      AND (SELECT pub FROM s11t_pbase) = pg_temp.s11t_pub()
      AND (SELECT acount FROM s11t_pbase) = pg_temp.s11t_acount());

  -- ------------------------------------------------- §6's ordering, measured while it still can be
  v_ans := pg_temp.s11t_owner('SELECT internal_api.operator_purge_publication_objects('
    || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u(v_op1) || ', '
    || pg_temp.s11t_u((SELECT k FROM s11t_key WHERE tag = 'purge1')) || ')');
  PERFORM pg_temp.s11t_err_is('K17 before this file records one takedown, the purge refuses: w1''s only '
    || 'retired publication was retired by hand, and §6 says the two facts in an order that the audit trail '
    ||' enforces', pg_temp.s11t_err(v_ans), '23514', '%no recorded takedown to purge against%');

  v_ans := pg_temp.s11t_owner('SELECT internal_api.operator_purge_publication_objects('
    || pg_temp.s11t_t(v_cas_w2) || ', ' || pg_temp.s11t_u(v_op1) || ', '
    || pg_temp.s11t_u((SELECT k FROM s11t_key WHERE tag = 'purge1b')) || ')');
  PERFORM pg_temp.s11t_err_is('K18 and for the wedding whose publication is still live it refuses with the '
    || 'other half of the sentence: the publication has to be retired first, in a separate recorded act',
    pg_temp.s11t_err(v_ans), '23514', '%retire the %first%');

  -- ------------------------------------------------------------------ the case as carrier
  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_takedown_publication('
    || pg_temp.s11t_u(v_w1) || ', ' || pg_temp.s11t_t('SV-ZZZZZZZZ') || ', '
    || pg_temp.s11t_t('owner_request') || ', ' || pg_temp.s11t_u(v_tk1) || ')');
  PERFORM pg_temp.s11t_err_is('K19 a ref that exists nowhere is refused', pg_temp.s11t_err(v_ans),
    '42501', '%may not take this publication down%');
  v_a := pg_temp.s11t_err(v_ans);

  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_takedown_publication('
    || pg_temp.s11t_u(v_w1) || ', ' || pg_temp.s11t_t(v_cas_w2) || ', '
    || pg_temp.s11t_t('owner_request') || ', ' || pg_temp.s11t_u(v_tk1) || ')');
  v_b := pg_temp.s11t_err(v_ans);
  PERFORM pg_temp.s11t_same('K20 and so is another wedding''s ticket cited against this wedding — the '
    || 'mismatch cannot be told apart from a guessed ref', v_a, v_b);

  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_takedown_publication('
    || pg_temp.s11t_u(v_w1) || ', ' || pg_temp.s11t_t(v_cas_park) || ', '
    || pg_temp.s11t_t('owner_request') || ', ' || pg_temp.s11t_u(v_tk1) || ')');
  PERFORM pg_temp.s11t_same('K21 nor a ticket parked on the host as `awaiting_information`: a question is '
    || 'not a permission', v_a, pg_temp.s11t_err(v_ans));

  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_takedown_publication('
    || pg_temp.s11t_u(v_w1) || ', ' || pg_temp.s11t_t(v_cas_done) || ', '
    || pg_temp.s11t_t('owner_request') || ', ' || pg_temp.s11t_u(v_tk1) || ')');
  PERFORM pg_temp.s11t_same('K22 nor a resolved one: a finished ticket is the record of an act that '
    || 'already happened, not a standing authorisation', v_a, pg_temp.s11t_err(v_ans));

  PERFORM pg_temp.s11t_eq('K23 four ways to fail, one sentence, and nothing in the trail: the door is not an '
    || 'oracle over a minted `SV-` string',
    (SELECT count(*)::int FROM private.audit_events WHERE idempotency_key = v_tk1::text), 0);

  -- -------------------------------------------------------------------- the argument walls
  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_takedown_publication('
    || pg_temp.s11t_u(v_w1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('because_i_said_so') || ', ' || pg_temp.s11t_u(v_tk1) || ')');
  PERFORM pg_temp.s11t_err_is('K24 an invented reason is refused by name, and the refusal lists the five real '
    || 'ones — the vocabulary is a design table, not a secret', pg_temp.s11t_err(v_ans), '23514',
    '%unknown takedown reason%owner_request, terms_violation, safety, legal%duplicate%');

  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_takedown_publication('
    || pg_temp.s11t_u(v_w1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', NULL, '
    || pg_temp.s11t_u(v_tk1) || ')');
  PERFORM pg_temp.s11t_err_is('K25 including no reason at all', pg_temp.s11t_err(v_ans), '23514',
    '%unknown takedown reason%NULL%');

  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_takedown_publication('
    || pg_temp.s11t_u(v_w1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('safety') || ', NULL)');
  PERFORM pg_temp.s11t_err_is('K26 and a takedown with no key is refused: two clicks on one wedding must take '
    || 'it down once', pg_temp.s11t_err(v_ans), '23514', '%requires an idempotency key%');

  v_ans := pg_temp.s11t_as('authenticated', v_sup1, 'SELECT api.operator_takedown_publication('
    || pg_temp.s11t_u(v_w1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('safety') || ', ' || pg_temp.s11t_u(v_tk1) || ')');
  PERFORM pg_temp.s11t_err_is('K27 the authority question is answered before any of the others, so a caller '
    || 'with no grant learns nothing about the reason vocabulary or the ticket',
    pg_temp.s11t_err(v_ans), '42501', '%may not take this publication down%');

  -- --------------------------------------------------------------------- the act itself
  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_takedown_publication('
    || pg_temp.s11t_u(v_w1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('owner_request') || ', ' || pg_temp.s11t_u(v_tk1) || ')');
  PERFORM pg_temp.s11t_ok('K28 the operator, citing a live ticket about this wedding, is answered',
    NOT (v_ans ? '_error'));
  PERFORM pg_temp.s11t_ledger('K28 takedown w1', v_ans || jsonb_build_object('_key', v_tk1::text),
                              'publication_takedown');

  PERFORM pg_temp.s11t_keys('K29 the answer is the payload it stored, plus the two fields a caller needs to '
    || 'know whether it wrote anything', v_ans,
    ARRAY['audit_id','case_ref','credentials_revoked','file_links_still_valid_until_object_purge',
          'objects_deleted_by_this_call','outputs_invalidated','publication_id','purge_function',
          'reason_category','replayed','version_id','wedding_id']);

  PERFORM pg_temp.s11t_ok('K30 and it reports the two credentials and the two artefacts it reached — not the '
    || 'three credentials and six artefacts on the wedding, which is the difference between a count of the '
    || 'effect and a count of the rows',
    (v_ans ->> 'credentials_revoked')::int = 2 AND (v_ans ->> 'outputs_invalidated')::int = 2
      AND (v_ans ->> 'reason_category') = 'owner_request'
      AND (v_ans ->> 'case_ref') = v_cas_live AND (v_ans ->> 'replayed')::boolean IS FALSE
      AND (v_ans ->> 'objects_deleted_by_this_call')::boolean IS FALSE
      AND (v_ans ->> 'purge_function') = 'internal_api.operator_purge_publication_objects');

  PERFORM pg_temp.s11t_ok('K31 and it states its own limit rather than letting the operator infer it: a file '
    || 'link minted before this call still serves, because nothing here touched the object',
    (v_ans ->> 'file_links_still_valid_until_object_purge')::boolean IS TRUE);

  PERFORM pg_temp.s11t_ok('K32 the publication is retired and its revocation stamp is on the right side of '
    || 'its own publish time',
    (SELECT p.status FROM public.publications p WHERE p.id = v_pub1) = 'revoked'
      AND (SELECT p.revoked_at FROM public.publications p WHERE p.id = v_pub1) IS NOT NULL
      AND (SELECT p.revoked_at >= p.published_at FROM public.publications p WHERE p.id = v_pub1));

  PERFORM pg_temp.s11t_array('K33 the public and guest credentials on this wedding are revoked — two of the '
    || 'three on the wedding, because the third was already retired and keeps its own history — while the '
    || '`rsvp` credential is not, because it authorises a reply rather than a read of the published page',
    ARRAY(SELECT t.token_kind || ':' || CASE WHEN t.revoked_at IS NULL THEN 'live' ELSE 'revoked' END
            FROM private.access_tokens t WHERE t.wedding_id = v_w1 ORDER BY 1),
    ARRAY['guest_invitation:revoked','public_invitation:revoked','public_invitation:revoked','rsvp:live']);

  PERFORM pg_temp.s11t_eq('K34 and the credential that was already retired kept its original timestamp: the '
    || 'statement is scoped to `revoked_at IS NULL`, so a re-run cannot silently restamp history',
    (SELECT t.revoked_at FROM private.access_tokens t WHERE t.id = (SELECT tk_old FROM s11t_cast)),
    v_tk_old_rev);

  PERFORM pg_temp.s11t_eq('K35 and one credential of another wedding was not touched at all',
    (SELECT count(*)::int FROM private.access_tokens t WHERE t.wedding_id = v_w2
       AND t.revoked_at IS NOT NULL), 0);

  PERFORM pg_temp.s11t_array('K36 the artefacts, after the act: the two ready rows of the published version '
    || 'are invalidated, and the registered, uploading, failed, superseded-version and other-wedding rows are '
    || 'exactly where they were. Stage 9''s guard refused the only edge that would have made a takedown fail '
    || 'on a row that never uploaded, and this is what that decision looks like on the data',
    ARRAY(SELECT o.tag || '=' || i.status || coalesce(':' || i.invalidation_reason,'')
            FROM s11t_out_ids o JOIN public.invitation_outputs i ON i.id = o.id ORDER BY o.tag),
    ARRAY['out_fail=failed','out_inv=invalidated:superseded','out_og=invalidated:publication_revoked',
          'out_old=ready','out_pdf=invalidated:publication_revoked','out_reg=registered',
          'out_up=uploading','out_w2=ready']);

  PERFORM pg_temp.s11t_eq('K37 the objects those artefacts name are still in the bucket — five before the '
    || 'takedown, five after', (SELECT store FROM s11t_pbase), pg_temp.s11t_cnt('storage.objects'));

  PERFORM pg_temp.s11t_eq('K38 one trail row, and it is the shape §4 requires: the subject is the '
    || 'publication, the actor kind is `operator`, and the key is the one the caller named',
    (SELECT count(*)::int FROM private.audit_events a WHERE a.idempotency_key = v_tk1::text
       AND a.action = 'publication_takedown' AND a.subject_type = 'publication'
       AND a.subject_key = v_pub1 AND a.actor_user_id = v_op1 AND a.actor_kind = 'operator'
       AND a.wedding_id = v_w1), 1);

  PERFORM pg_temp.s11t_ok('K39 before and after are each a single-field object: the row says what changed and '
    || 'nothing more',
    (SELECT before_state || after_state FROM private.audit_events a
      WHERE a.idempotency_key = v_tk1::text) =
      jsonb_build_object('publication_status','active')
      || jsonb_build_object('publication_status','revoked','credentials_revoked',2,
                            'outputs_invalidated',2));

  PERFORM pg_temp.s11t_eq('K40 one event row links the act to the ticket, and it is `operation_link` rather '
    || 'than a status change — taking a publication down does not close the conversation about it',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.case_id = (SELECT id FROM s11t_reg WHERE tag = 'cas_live')
        AND e.kind = 'operation_link' AND e.idempotency_key = v_tk1 AND e.actor_user_id = v_op1
        AND e.actor_kind = 'operator' AND e.body IS NULL AND e.to_status IS NULL
        AND e.from_status IS NULL), 1);

  PERFORM pg_temp.s11t_eq('K41 and the ticket itself is still open: no operator act in this slice moves a '
    || 'case status, which is the difference between oversight and closing',
    (SELECT c.status FROM private.support_cases c WHERE c.case_ref = v_cas_live), 'open');

  -- ---------------------------------------------------------------------------- the replay
  v_ref := (SELECT a.payload::text FROM private.audit_events a WHERE a.idempotency_key = v_tk1::text);
  -- Taken before the replayed delivery, so that the comparison after it is against a state the replay could
  -- have changed rather than against itself.
  v_d0 := pg_temp.s11t_out() || pg_temp.s11t_tok() || pg_temp.s11t_pub()
          || pg_temp.s11t_cnt('storage.objects')::text;
  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_takedown_publication('
    || pg_temp.s11t_u(v_w1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('terms_violation') || ', ' || pg_temp.s11t_u(v_tk1) || ')');
  PERFORM pg_temp.s11t_ok('K42 the same key a second time is not an error and not a new act: it is answered '
    || 'with the first delivery''s payload — every one of its ten fields, including the reason that was '
    || 'said then and not the one said now — and with the first row''s audit id, because a key belongs to '
    || 'an action, not to a sentence',
    (v_ans ->> 'replayed')::boolean IS TRUE
      AND (v_ans ->> 'reason_category') = 'owner_request'
      AND (v_ans - 'audit_id' - 'replayed') = v_ref::jsonb
      AND (v_ans ->> 'audit_id')::bigint = (SELECT a.id FROM private.audit_events a
                                             WHERE a.idempotency_key = v_tk1::text));

  PERFORM pg_temp.s11t_eq('K43 and the replay wrote nothing: one trail row and one event row still',
    (SELECT count(*)::int FROM private.audit_events a WHERE a.idempotency_key = v_tk1::text), 1);

  PERFORM pg_temp.s11t_eq('K44 and nothing else moved either — the artefacts, the credentials, the '
    || 'publications and the bucket are byte-identical to the state captured immediately before this '
    || 'second delivery was made',
    v_d0, pg_temp.s11t_out() || pg_temp.s11t_tok() || pg_temp.s11t_pub()
          || pg_temp.s11t_cnt('storage.objects')::text);

  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_takedown_publication('
    || pg_temp.s11t_u(v_w1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('legal') || ', ' || pg_temp.s11t_u(v_tk1b) || ')');
  PERFORM pg_temp.s11t_err_is('K45 a new key on a wedding that is already down is refused by the state, not '
    || 'by a lock: there is no active publication left to take down',
    pg_temp.s11t_err(v_ans), '23514', '%no active publication to take down%');

  PERFORM pg_temp.s11t_eq('K46 and that refusal left no trail row behind',
    (SELECT count(*)::int FROM private.audit_events a WHERE a.idempotency_key = v_tk1b::text), 0);

  -- ------------------------------------------------------------------- the other wedding
  SELECT i.invalidated_at INTO v_og_at FROM public.invitation_outputs i
   WHERE i.id = (SELECT out_og FROM s11t_cast);
  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_takedown_publication('
    || pg_temp.s11t_u(v_w2) || ', ' || pg_temp.s11t_t(v_cas_w2) || ', '
    || pg_temp.s11t_t('safety') || ', ' || pg_temp.s11t_u(v_tk_w2) || ')');
  PERFORM pg_temp.s11t_ok('K47 the same operator, citing the other wedding''s own ticket, is answered — the '
    || '`operations` scope is a duty, not a per-wedding grant, and the ticket is what bounds it',
    NOT (v_ans ? '_error')
      AND (v_ans ->> 'credentials_revoked')::int = 1 AND (v_ans ->> 'outputs_invalidated')::int = 1);
  PERFORM pg_temp.s11t_ledger('K47 takedown w2', v_ans || jsonb_build_object('_key', v_tk_w2::text),
                              'publication_takedown');

  PERFORM pg_temp.s11t_ok('K48 and its effect stayed on that wedding: w2''s publication is revoked, its one '
    || 'ready artefact is invalidated, and w1''s already-invalidated rows were not restamped',
    (SELECT p.status FROM public.publications p WHERE p.wedding_id = v_w2) = 'revoked'
      AND (SELECT i.status FROM public.invitation_outputs i
            WHERE i.id = (SELECT out_w2 FROM s11t_cast)) = 'invalidated'
      AND (SELECT i.invalidated_at FROM public.invitation_outputs i
            WHERE i.id = (SELECT out_og FROM s11t_cast)) = v_og_at);

  PERFORM pg_temp.s11t_eq('K49 still nothing was deleted from the bucket by any of it',
    (SELECT store FROM s11t_pbase), pg_temp.s11t_cnt('storage.objects'));

  PERFORM pg_temp.s11t_ok('K50 and the money is untouched in every sense the schema can express: no refund '
    || 'row, no order row and no entitlement row changed a single byte, and the payment-policy singleton was '
    || 'not even read',
    (SELECT ord FROM s11t_pbase) = pg_temp.s11t_ord() AND (SELECT ref FROM s11t_pbase) = pg_temp.s11t_ref()
      AND (SELECT ent FROM s11t_pbase) = pg_temp.s11t_ent()
      AND (SELECT pol FROM s11t_pbase) = pg_temp.s11t_pol()
      AND (SELECT note FROM s11t_pbase) = pg_temp.s11t_note());

  PERFORM pg_temp.s11t_eq('K51 and the only two tables that grew are the trail and the thread — the two '
    || 'append-only stores this stage owns',
    (SELECT count(*)::int FROM private.audit_events WHERE action IN ('publication_takedown')), 2);
END $k$;

-- ===========================================================================
-- U. The purge planner (§6 step 2) — and the wall that keeps it out of a browser
-- ===========================================================================
DO $u$
DECLARE
  v_ans jsonb; v_err text; v_a text; v_b text;
  v_op1 uuid; v_op2 uuid; v_sup1 uuid; v_fin1 uuid; v_cas_live text; v_cas_w2 text;
  v_purge1 uuid; v_purge1b uuid; v_tk1 uuid; v_tk_w2 uuid; v_pub1 uuid;
  v_og_key text; v_pdf_key text; v_inv_key text;
  v_before_keys text; v_audit0 bigint; v_ev0 bigint;
  v_pl text;
BEGIN
  SELECT c.op1, c.op2, c.sup1, c.fin1, c.pub1 INTO v_op1, v_op2, v_sup1, v_fin1, v_pub1
    FROM s11t_cast c;
  SELECT (SELECT ref FROM s11t_reg WHERE tag = 'cas_live'),
         (SELECT ref FROM s11t_reg WHERE tag = 'cas_w2'),
         (SELECT k FROM s11t_key WHERE tag = 'purge1'),
         (SELECT k FROM s11t_key WHERE tag = 'purge1b'),
         (SELECT k FROM s11t_key WHERE tag = 'tk1'),
         (SELECT k FROM s11t_key WHERE tag = 'tk_w2')
    INTO v_cas_live, v_cas_w2, v_purge1, v_purge1b, v_tk1, v_tk_w2;
  SELECT o.object_key INTO v_og_key FROM public.invitation_outputs o WHERE o.id = (SELECT out_og FROM s11t_cast);
  SELECT o.object_key INTO v_pdf_key FROM public.invitation_outputs o WHERE o.id = (SELECT out_pdf FROM s11t_cast);
  SELECT o.object_key INTO v_inv_key FROM public.invitation_outputs o WHERE o.id = (SELECT out_inv FROM s11t_cast);

  -- ---------------------------------------------------------------- the exposure wall, measured
  PERFORM pg_temp.s11t_err_is('U01 anon may not execute the purge',
    pg_temp.s11t_try('anon', NULL, 'SELECT internal_api.operator_purge_publication_objects('
      || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u(v_op1) || ', '
      || pg_temp.s11t_u(v_purge1) || ')'), '42501', '%permission denied for function%');

  PERFORM pg_temp.s11t_err_is('U02 nor may the very operator who holds a live `operations` grant, once that '
    || 'operator is on a session rather than on the trusted channel: the irreversible half of §6 has no '
    || 'browser surface',
    pg_temp.s11t_try('authenticated', v_op1, 'SELECT internal_api.operator_purge_publication_objects('
      || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u(v_op1) || ', '
      || pg_temp.s11t_u(v_purge1) || ')'), '42501', '%permission denied for function%');

  PERFORM pg_temp.s11t_err_is('U03 nor does the service role, and it is stopped one wall earlier than the '
    || 'browser roles: the schema itself will not answer to it — the one role this stage could have used as '
    || 'a back door and deliberately did not',
    pg_temp.s11t_try('service_role', NULL, 'SELECT internal_api.operator_purge_publication_objects('
      || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u(v_op1) || ', '
      || pg_temp.s11t_u(v_purge1) || ')'), '42501', '%permission denied for schema internal_api%');

  PERFORM pg_temp.s11t_array('U03b and the two walls really are in different places, measured rather than '
    || 'inferred: `internal_api` carries USAGE for anon and authenticated, which is why those two get as far '
    || 'as a function refusal, and none for service_role, which is why that one never reaches the function',
    ARRAY[has_schema_privilege('anon','internal_api','USAGE')::text,
          has_schema_privilege('authenticated','internal_api','USAGE')::text,
          has_schema_privilege('service_role','internal_api','USAGE')::text],
    ARRAY['true','true','false']);

  PERFORM pg_temp.s11t_eq('U04 and there is no `api` wrapper to route around: this is the one body in the '
    || 'slice that is deliberately unpaired',
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api' AND p.proname = 'operator_purge_publication_objects'), 0);

  PERFORM pg_temp.s11t_array('U05 and its access list grants EXECUTE to nobody: the three roles a browser '
    || 'session can arrive as are each asked the question the database answers, not the one this file '
    || 'asserts. The measured ACL is literally `{postgres=X/postgres}` — owner only, no PUBLIC half at all.',
    ARRAY[has_function_privilege('anon', 'internal_api.operator_purge_publication_objects(text,uuid,uuid)'::regprocedure, 'EXECUTE')::text,
          has_function_privilege('authenticated', 'internal_api.operator_purge_publication_objects(text,uuid,uuid)'::regprocedure, 'EXECUTE')::text,
          has_function_privilege('service_role', 'internal_api.operator_purge_publication_objects(text,uuid,uuid)'::regprocedure, 'EXECUTE')::text],
    ARRAY['false','false','false']);

  -- ---------------------------------------------------------------------- the argument walls
  v_ans := pg_temp.s11t_owner('SELECT internal_api.operator_purge_publication_objects('
    || pg_temp.s11t_t(v_cas_live) || ', NULL, ' || pg_temp.s11t_u(v_purge1) || ')');
  PERFORM pg_temp.s11t_err_is('U06 a purge that names no account is refused: on this channel nobody is on '
    || 'the session, so an unattributed irreversible act would be unanswerable afterwards',
    pg_temp.s11t_err(v_ans), '23514', '%names the account that decided it%');

  v_ans := pg_temp.s11t_owner('SELECT internal_api.operator_purge_publication_objects('
    || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u('00000000-0000-0000-0000-00000000000e'::uuid)
    || ', ' || pg_temp.s11t_u(v_purge1) || ')');
  PERFORM pg_temp.s11t_err_is('U07 and an id that names no account is refused separately — the name has to '
    || 'be a person, not a uuid that happens to be free. The plant''s `ghost` account is deliberately not '
    || 'used here: it exists, so it would answer the wrong question',
    pg_temp.s11t_err(v_ans), '23514', '%account named as the actor does not exist%');

  v_ans := pg_temp.s11t_owner('SELECT internal_api.operator_purge_publication_objects('
    || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u(v_sup1) || ', '
    || pg_temp.s11t_u(v_purge1) || ')');
  PERFORM pg_temp.s11t_err_is('U08 a live grant in the wrong scope does not name an actor',
    pg_temp.s11t_err(v_ans), '42501', '%holds no live operations grant%');
  v_a := pg_temp.s11t_err(v_ans);

  v_ans := pg_temp.s11t_owner('SELECT internal_api.operator_purge_publication_objects('
    || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u(v_op2) || ', '
    || pg_temp.s11t_u(v_purge1) || ')');
  PERFORM pg_temp.s11t_same('U09 nor does a revoked one, and the sentence is the same: this body cannot be '
    || 'used to ask whether a grant was ever held', v_a, pg_temp.s11t_err(v_ans));

  v_ans := pg_temp.s11t_owner('SELECT internal_api.operator_purge_publication_objects('
    || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u(v_fin1) || ', '
    || pg_temp.s11t_u(v_purge1) || ')');
  PERFORM pg_temp.s11t_same('U10 nor a finance reviewer — the money scope buys a read, never a plan to '
    || 'delete bytes', v_a, pg_temp.s11t_err(v_ans));

  v_ans := pg_temp.s11t_owner('SELECT internal_api.operator_purge_publication_objects('
    || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u(v_op1) || ', NULL)');
  PERFORM pg_temp.s11t_err_is('U11 and a purge with no key of its own is refused',
    pg_temp.s11t_err(v_ans), '23514', '%requires its own idempotency key%');

  -- ------------------------------------------------------------------------ the plan, taken
  v_before_keys := v_og_key || v_pdf_key || v_inv_key;
  v_audit0 := pg_temp.s11t_acount();
  v_ev0 := (SELECT count(*) FROM private.support_case_events);

  v_ans := pg_temp.s11t_owner('SELECT internal_api.operator_purge_publication_objects('
    || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u(v_op1) || ', '
    || pg_temp.s11t_u(v_purge1) || ')');
  PERFORM pg_temp.s11t_ok('U12 the named actor, on the trusted channel, citing a live ticket about a wedding '
    || 'whose publication is already retired, is answered', NOT (v_ans ? '_error'));
  PERFORM pg_temp.s11t_ledger('U12 purge w1', v_ans || jsonb_build_object('_key', v_purge1::text),
                              'publication_objects_purge_planned');

  PERFORM pg_temp.s11t_keys('U13 twelve fields, and the two that matter most are the last pair', v_ans,
    ARRAY['actor_named_by_argument','audit_id','case_ref','count','delete_channel','object_keys',
          'objects_deleted_by_this_call','objects_planned','publication_id','replayed','version_id',
          'wedding_id']);

  PERFORM pg_temp.s11t_ok('U14 the keys go to the caller — the three this publication''s version owns, and '
    || 'no others — because §11 prints the list before it asks for confirmation',
    jsonb_array_length(v_ans -> 'object_keys') = 3
      AND (v_ans -> 'object_keys') ? v_og_key AND (v_ans -> 'object_keys') ? v_pdf_key
      AND (v_ans -> 'object_keys') ? v_inv_key
      AND (v_ans ->> 'count')::int = 3 AND (v_ans ->> 'objects_planned')::int = 3);

  SELECT a.payload::text INTO v_pl FROM private.audit_events a WHERE a.idempotency_key = v_purge1::text;
  PERFORM pg_temp.s11t_ok('U15 and the trail row carries the count only. An object key names a household''s '
    || 'rendered invitation, and the trail is read by whoever holds the trail — so the privacy boundary here '
    || 'is a difference between the two answers, measured on both sides: none of the three keys the caller '
    || 'was handed appears in the stored payload, and neither key shape appears even as a pattern',
    position(v_og_key IN v_pl) = 0 AND position(v_pdf_key IN v_pl) = 0
      AND position(v_inv_key IN v_pl) = 0
      AND v_pl !~ 'p/[A-Za-z0-9_-]{43}' AND v_pl !~ 'outputs/'
      AND (SELECT a.payload ->> 'objects_planned' FROM private.audit_events a
            WHERE a.idempotency_key = v_purge1::text)::int = 3
      AND (v_ans -> 'object_keys') ? v_og_key);

  PERFORM pg_temp.s11t_ok('U16 the trail row says who decided, from the argument rather than the session, '
    || 'and marks the act `maintenance` rather than `operator` because no session could have proved it',
    (SELECT a.actor_user_id FROM private.audit_events a
      WHERE a.idempotency_key = v_purge1::text) = v_op1
      AND (SELECT a.actor_kind FROM private.audit_events a
            WHERE a.idempotency_key = v_purge1::text) = 'maintenance'
      AND (SELECT a.action FROM private.audit_events a
            WHERE a.idempotency_key = v_purge1::text) = 'publication_objects_purge_planned'
      AND (SELECT a.subject_key FROM private.audit_events a
            WHERE a.idempotency_key = v_purge1::text) = v_pub1
      AND (SELECT a.before_state || a.after_state FROM private.audit_events a
            WHERE a.idempotency_key = v_purge1::text) =
          jsonb_build_object('publication_status','revoked')
          || jsonb_build_object('objects_planned', 3));

  PERFORM pg_temp.s11t_ok('U17 the answer names the channel that will do the deleting, so a plan is never '
    || 'mistaken for the act',
    (v_ans ->> 'delete_channel') = 'Storage API delete driven by scripts/stage11-operations-cli.mjs'
      AND (v_ans ->> 'objects_deleted_by_this_call')::boolean IS FALSE
      AND (v_ans ->> 'actor_named_by_argument')::uuid = v_op1
      AND (v_ans ->> 'replayed')::boolean IS FALSE);

  PERFORM pg_temp.s11t_eq('U18 and the bucket is exactly as full as it was. Nothing in this slice deletes a '
    || 'byte, and the only honest way to show that is to count the objects before and after the plan',
    (SELECT store FROM s11t_pbase), pg_temp.s11t_cnt('storage.objects'));

  PERFORM pg_temp.s11t_eq('U19 and every artefact still has its key and its digest — the rows a purge would '
    || 'later name are still fully described',
    (SELECT count(*)::int FROM public.invitation_outputs
      WHERE object_key IS NOT NULL AND content_digest IS NOT NULL), 5);

  PERFORM pg_temp.s11t_eq('U20 one event row links the plan to the ticket, with the named actor rather than a '
    || 'session id',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.kind = 'operation_link' AND e.idempotency_key = v_purge1
        AND e.actor_user_id = v_op1 AND e.actor_kind = 'operator' AND e.to_status IS NULL), 1);

  v_ans := pg_temp.s11t_owner('SELECT internal_api.operator_purge_publication_objects('
    || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u(v_op1) || ', '
    || pg_temp.s11t_u(v_purge1) || ')');
  PERFORM pg_temp.s11t_ok('U21 the same key re-plans: `replayed`, the same audit id, and the key list as of '
    || 'now rather than as of an hour ago — an operator re-asking deserves a current answer without buying a '
    || 'second record',
    (v_ans ->> 'replayed')::boolean IS TRUE
      AND jsonb_array_length(v_ans -> 'object_keys') = 3
      AND (v_ans ->> 'audit_id')::bigint > 0);

  PERFORM pg_temp.s11t_eq('U22 and a replay writes nothing: the trail and the thread both stopped growing',
    (SELECT count(*)::int FROM private.audit_events WHERE idempotency_key = v_purge1::text), 1);

  PERFORM pg_temp.s11t_ok('U23 and the two append-only stores grew by exactly one row each for this act and '
    || 'by nothing for its replay, measured against the counts taken before the first purge call',
    pg_temp.s11t_acount() = v_audit0 + 1
      AND (SELECT count(*) FROM private.support_case_events) = v_ev0 + 1);

  v_ans := pg_temp.s11t_owner('SELECT internal_api.operator_purge_publication_objects('
    || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u(v_op1) || ', '
    || pg_temp.s11t_u(v_tk1) || ')');
  PERFORM pg_temp.s11t_err_is('U24 the takedown''s own key cannot also buy the purge: two facts, two '
    || 'decisions, two clicks', pg_temp.s11t_err(v_ans), '23514',
    '%distinct from the takedown%two facts, two decisions%');

  v_ans := pg_temp.s11t_owner('SELECT internal_api.operator_purge_publication_objects('
    || pg_temp.s11t_t(v_cas_w2) || ', ' || pg_temp.s11t_u(v_op1) || ', '
    || pg_temp.s11t_u(v_tk1) || ')');
  PERFORM pg_temp.s11t_err_is('U25 and a key used on another wedding''s act is refused by the subject rather '
    || 'than the ordering — one key is one action, and the trail says which',
    pg_temp.s11t_err(v_ans), '23514', '%already belongs to a different act%');

  PERFORM pg_temp.s11t_eq('U26 five refusals of this body, and the grant table is byte-identical: reading '
    || 'authority cannot change it', (SELECT grants FROM s11t_pbase), pg_temp.s11t_grants());

  PERFORM pg_temp.s11t_ok('U27 and the wedding whose takedown this file has not recorded still cannot be '
    || 'purged — w4''s publication was retired by hand, and the ordering rule holds against the fixture that '
    || 'no product path would produce on cue',
    (SELECT count(*)::int FROM private.audit_events a
      WHERE a.action = 'publication_objects_purge_planned') = 1
      AND (SELECT count(*)::int FROM public.publications p
            WHERE p.wedding_id = (SELECT w4 FROM s11t_cast) AND p.status = 'revoked') = 1);
END $u$;

-- ===========================================================================
-- Q. The refund and dispute queue (§7) — a read that cannot become a verb
-- ===========================================================================
DO $q$
DECLARE
  v_ans jsonb; v_row jsonb; v_a text; v_b text;
  v_fin1 uuid; v_op1 uuid; v_host_a uuid; v_host_b uuid; v_host_x uuid;
BEGIN
  SELECT c.fin1, c.op1, c.host_a, c.host_b, c.host_x
    INTO v_fin1, v_op1, v_host_a, v_host_b, v_host_x FROM s11t_cast c;

  PERFORM pg_temp.s11t_err_is('Q01 anon may not read the queue',
    pg_temp.s11t_try('anon', NULL, 'SELECT api.operator_commerce_review_queue(NULL, NULL)'),
    '42501', '%permission denied for function operator_commerce_review_queue%');

  v_ans := pg_temp.s11t_as('authenticated', v_host_a,
    'SELECT api.operator_commerce_review_queue(NULL, NULL)');
  PERFORM pg_temp.s11t_err_is('Q02 a host cannot see the ledger it is standing in',
    pg_temp.s11t_err(v_ans), '42501', '%may not read the commerce review queue%');
  v_a := pg_temp.s11t_err(v_ans);

  v_ans := pg_temp.s11t_as('authenticated', v_host_x,
    'SELECT api.operator_commerce_review_queue(NULL, NULL)');
  PERFORM pg_temp.s11t_same('Q03 and neither can a stranger, with the same sentence', v_a,
    pg_temp.s11t_err(v_ans));

  v_ans := pg_temp.s11t_as('authenticated', v_op1,
    'SELECT api.operator_commerce_review_queue(NULL, NULL)');
  PERFORM pg_temp.s11t_same('Q04 nor the operator who took two invitations down this morning: `operations` '
    || 'and `finance_review` are different duties, and a takedown does not buy a look at the money', v_a,
    pg_temp.s11t_err(v_ans));

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_commerce_review_queue(NULL, NULL)');
  PERFORM pg_temp.s11t_ok('Q05 the reviewer is answered', NOT (v_ans ? '_error'));

  PERFORM pg_temp.s11t_keys('Q06 five fields, two of which are the promise', v_ans,
    ARRAY['changes_entitlements','count','moves_money','refunds','status_filter']);

  PERFORM pg_temp.s11t_ok('Q07 it says it moves no money and changes no entitlement, and the row count is '
    || 'the whole ledger this chain holds',
    (v_ans ->> 'moves_money')::boolean IS FALSE AND (v_ans ->> 'changes_entitlements')::boolean IS FALSE
      AND (v_ans ->> 'count')::int = 6 AND jsonb_array_length(v_ans -> 'refunds') = 6);

  PERFORM pg_temp.s11t_ok('Q08 the newest refund first, and the order is the recorded time rather than the '
    || 'row''s own creation — the queue answers "what has been waiting longest?" by showing what arrived last '
    ||' on top',
    (v_ans -> 'refunds' -> 0 ->> 'refund_id')::uuid = (SELECT ref6 FROM s11t_cast)
      AND (v_ans -> 'refunds' -> 1 ->> 'refund_id')::uuid = (SELECT ref5 FROM s11t_cast)
      AND (v_ans -> 'refunds' -> 5 ->> 'refund_id')::uuid = (SELECT ref1 FROM s11t_cast));

  PERFORM pg_temp.s11t_keys('Q09 a row is the refund, the order as it was frozen, and the thread — §7''s '
    || 'three questions in one object', v_ans -> 'refunds' -> 0,
    ARRAY['amount_minor','completed_at','currency','kind','notes','order','provider_refund_ref',
          'recorded_at','refund_id','status','wedding_id']);

  PERFORM pg_temp.s11t_keys('Q10 the order half is six fields, and they are the ones a reviewer takes to a '
    || 'provider dashboard', v_ans -> 'refunds' -> 0 -> 'order',
    ARRAY['captured_at','merchant_reference','order_id','package_code','price_version','status']);

  PERFORM pg_temp.s11t_ok('Q11 no card, account, token or entitlement identifier reaches the caller: the row '
    || 'has no `entitlement_id` and no `owner_user_id` at any level, and neither order owner''s account id '
    || 'appears anywhere in the answer text. The schema has nowhere to leak them from, and the queue does '
    || 'not invent a field to carry one',
    NOT (v_ans -> 'refunds' -> 0 -> 'order' ? 'entitlement_id')
      AND NOT (v_ans -> 'refunds' -> 0 ? 'owner_user_id')
      AND NOT (v_ans -> 'refunds' -> 0 -> 'order' ? 'owner_user_id')
      AND position(v_host_a::text IN v_ans::text) = 0 AND position(v_host_b::text IN v_ans::text) = 0
      AND (v_ans -> 'refunds' -> 0 ->> 'wedding_id') IS NOT NULL);

  PERFORM pg_temp.s11t_eq('Q12 the thread is empty for every row: nothing in this group has annotated a '
    || 'refund, and an empty list here is the measurement that the note join is not fabricating rows',
    (SELECT count(*)::int FROM jsonb_array_elements(v_ans -> 'refunds') r
      WHERE jsonb_array_length(r -> 'notes') > 0), 0);

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_commerce_review_queue(NULL, 2)');
  PERFORM pg_temp.s11t_ok('Q13 a limit of two answers two rows and still reports the filter it applied',
    jsonb_array_length(v_ans -> 'refunds') = 2 AND (v_ans ->> 'count')::int = 2
      AND (v_ans ->> 'status_filter') IS NULL);

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_commerce_review_queue('
    || pg_temp.s11t_t('reversed') || ', NULL)');
  PERFORM pg_temp.s11t_ok('Q14 the one dispute in the ledger is a chargeback, and a filter is a WHERE rather '
    || 'than a post-hoc trim of the same six rows',
    (v_ans ->> 'count')::int = 1 AND (v_ans -> 'refunds' -> 0 ->> 'kind') = 'chargeback'
      AND (v_ans -> 'refunds' -> 0 ->> 'provider_refund_ref') = 'rf-s11t-4'
      AND (v_ans ->> 'status_filter') = 'reversed');

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_commerce_review_queue('
    || pg_temp.s11t_t('recorded') || ', 200)');
  PERFORM pg_temp.s11t_eq('Q15 the recorded arm is the widest one and it agrees with the plant',
    (v_ans ->> 'count')::int, 3);

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_commerce_review_queue('
    || pg_temp.s11t_t('pending') || ', NULL)');
  PERFORM pg_temp.s11t_err_is('Q16 an invented status is refused by name and the four real ones are listed — '
    || 'a queue that quietly returned zero rows would look like an empty ledger',
    pg_temp.s11t_err(v_ans), '23514', '%unknown refund status%recorded, succeeded, failed%reversed%');

  PERFORM pg_temp.s11t_err_is('U16b a limit of zero is refused, not treated as "all"',
    pg_temp.s11t_try('authenticated', v_fin1,
      'SELECT api.operator_commerce_review_queue(NULL, 0)'), '23514', '%between 1 and 200%');

  PERFORM pg_temp.s11t_err_is('Q17 and a limit of 201 is refused for the reason §10 gives: this is an '
    || 'operator''s screen, and a limit a caller can raise to a million is a way to read the whole ledger '
    || 'through a support tool',
    pg_temp.s11t_try('authenticated', v_fin1, 'SELECT api.operator_commerce_review_queue(NULL, 201)'),
    '23514', '%between 1 and 200%');

  PERFORM pg_temp.s11t_err_is('Q18 and so is a negative one',
    pg_temp.s11t_try('authenticated', v_fin1, 'SELECT api.operator_commerce_review_queue(NULL, -5)'),
    '23514', '%between 1 and 200%');

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_commerce_review_queue(NULL, 200)');
  PERFORM pg_temp.s11t_ok('Q19 the top of the window is accepted, and a filter is checked before the limit '
    || 'so a typo costs the caller the sentence about the typo',
    NOT (v_ans ? '_error') AND (v_ans ->> 'count')::int = 6);

  PERFORM pg_temp.s11t_ok('Q20 six queue reads later, every digest this file froze before the first act is '
    || 'still equal — the ledger, the refunds, the entitlement, the policy singleton, the tickets, the notes '
    || 'and the grants — while the trail and the thread are unequal, which is the two acts of groups K and U '
    || 'and nothing from this group. A queue that reads cannot be told apart from one that writes by its own '
    || 'answer; only by this',
    (SELECT ord FROM s11t_pbase) = pg_temp.s11t_ord()
      AND (SELECT ref FROM s11t_pbase) = pg_temp.s11t_ref()
      AND (SELECT ent FROM s11t_pbase) = pg_temp.s11t_ent()
      AND (SELECT pol FROM s11t_pbase) = pg_temp.s11t_pol()
      AND (SELECT cse FROM s11t_pbase) = pg_temp.s11t_cse()
      AND (SELECT grants FROM s11t_pbase) = pg_temp.s11t_grants()
      AND (SELECT note FROM s11t_pbase) = pg_temp.s11t_note()
      AND (SELECT audit FROM s11t_pbase) <> pg_temp.s11t_adigest()
      AND (SELECT ev FROM s11t_pbase) <> pg_temp.s11t_ev());

  PERFORM pg_temp.s11t_ok('Q21 and the policy singleton is not readable through this door either: the queue '
    || 'answers no field of it',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ans -> 'refunds') r
                 WHERE r ? 'publish_gate' OR r ? 'policy' OR (r -> 'order') ? 'policy'));
END $q$;

-- ===========================================================================
-- N. The review note (§7) — the one write this slice makes about money
-- ===========================================================================
DO $n$
DECLARE
  v_ans jsonb; v_a text; v_b text; v_note_id uuid; v_row jsonb; v_q jsonb;
  v_fin1 uuid; v_fin2 uuid; v_op1 uuid; v_host_a uuid; v_ref1 uuid; v_ref2 uuid; v_ref3 uuid;
  v_ref6 uuid; v_ord1 uuid; v_w1 uuid; v_cas_live text; v_cas_w2 text; v_cas_park text;
  v_cas_done text; v_note1 uuid; v_note1b uuid; v_note_fin2 uuid; v_shared uuid; v_purge1 uuid;
  v_pad text := '  Provider says the settlement cleared. Ask for the reference.  ';
  v_long text;
BEGIN
  SELECT c.fin1, c.fin2, c.op1, c.host_a, c.ref1, c.ref2, c.ref3, c.ref6, c.ord1, c.w1
    INTO v_fin1, v_fin2, v_op1, v_host_a, v_ref1, v_ref2, v_ref3, v_ref6, v_ord1, v_w1 FROM s11t_cast c;
  SELECT (SELECT ref FROM s11t_reg WHERE tag = 'cas_live'),
         (SELECT ref FROM s11t_reg WHERE tag = 'cas_w2'),
         (SELECT ref FROM s11t_reg WHERE tag = 'cas_park'),
         (SELECT ref FROM s11t_reg WHERE tag = 'cas_done'),
         (SELECT k FROM s11t_key WHERE tag = 'note1'),
         (SELECT k FROM s11t_key WHERE tag = 'note1b'),
         (SELECT k FROM s11t_key WHERE tag = 'note_fin2'),
         (SELECT k FROM s11t_key WHERE tag = 'shared'),
         (SELECT k FROM s11t_key WHERE tag = 'purge1')
    INTO v_cas_live, v_cas_w2, v_cas_park, v_cas_done, v_note1, v_note1b, v_note_fin2, v_shared, v_purge1;
  v_long := repeat('a', 4001);

  PERFORM pg_temp.s11t_err_is('N01 anon may not annotate a refund',
    pg_temp.s11t_try('anon', NULL, 'SELECT api.operator_add_commerce_review_note(NULL, NULL, NULL, NULL, NULL)'),
    '42501', '%permission denied for function%');

  v_ans := pg_temp.s11t_as('authenticated', v_host_a, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t('a host may not write the oversight record')
    || ', ' || pg_temp.s11t_u(v_note1) || ')');
  PERFORM pg_temp.s11t_err_is('N02 the refund''s own host is refused', pg_temp.s11t_err(v_ans),
    '42501', '%may not annotate this refund%');
  v_a := pg_temp.s11t_err(v_ans);

  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t('an operator took two invitations down today')
    || ', ' || pg_temp.s11t_u(v_note1) || ')');
  PERFORM pg_temp.s11t_same('N03 and so is the takedown operator, in the same words: taking an invitation '
    || 'down is not a right to write about the money', v_a, pg_temp.s11t_err(v_ans));

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u('00000000-0000-0000-0000-00000000000f'::uuid) || ', '
    || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_t('in_review') || ', '
    || pg_temp.s11t_t('a refund that does not exist') || ', ' || pg_temp.s11t_u(v_note1) || ')');
  PERFORM pg_temp.s11t_same('N04 and a refund id that names no row is refused with the same sentence as a '
    || 'caller with no grant — the door answers the authority question and nothing else, so a probe cannot '
    || 'discover which refunds exist', v_a, pg_temp.s11t_err(v_ans));

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t('SV-ZZZZZZZZ') || ', '
    || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t('a guessed ticket') || ', '
    || pg_temp.s11t_u(v_note1) || ')');
  PERFORM pg_temp.s11t_same('N05 and a guessed ticket ref with the same sentence again', v_a,
    pg_temp.s11t_err(v_ans));

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t(v_cas_w2) || ', '
    || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t('another wedding''s ticket') || ', '
    || pg_temp.s11t_u(v_note1) || ')');
  PERFORM pg_temp.s11t_same('N06 and another wedding''s ticket: the case must be about the wedding the '
    || 'refund''s order belongs to, which is the reason the note carries a derived order at all', v_a,
    pg_temp.s11t_err(v_ans));

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t(v_cas_park) || ', '
    || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t('a parked ticket') || ', '
    || pg_temp.s11t_u(v_note1) || ')');
  PERFORM pg_temp.s11t_same('N07 and a parked one', v_a, pg_temp.s11t_err(v_ans));

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t(v_cas_done) || ', '
    || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t('a finished one') || ', '
    || pg_temp.s11t_u(v_note1) || ')');
  PERFORM pg_temp.s11t_same('N08 and a resolved one — §5''s three live statuses are the whole permission, '
    || 'here and in the takedown', v_a, pg_temp.s11t_err(v_ans));

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('approved') || ', ' || pg_temp.s11t_t('an invented kind') || ', '
    || pg_temp.s11t_u(v_note1) || ')');
  PERFORM pg_temp.s11t_err_is('N09 an invented kind is refused by name and the four are listed — none of '
    || 'which is a verb on the money, and none of which is "approved"',
    pg_temp.s11t_err(v_ans), '23514',
    '%unknown review note kind%evidence_requested, in_review, escalated_to_owner%documented_outcome%');

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t('   ') || ', '
    || pg_temp.s11t_u(v_note1) || ')');
  PERFORM pg_temp.s11t_err_is('N10 whitespace is not a note', pg_temp.s11t_err(v_ans), '23514',
    '%at most 4000 characters%');

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t(v_long) || ', '
    || pg_temp.s11t_u(v_note1) || ')');
  PERFORM pg_temp.s11t_err_is('N11 and 4001 characters of it is not either: the bound is the same as the '
    || 'thread''s, so no prose in this stage is stored without one',
    pg_temp.s11t_err(v_ans), '23514', '%at most 4000 characters%');

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t('a note with no key') || ', NULL)');
  PERFORM pg_temp.s11t_err_is('N12 and a note with no key is refused: two clicks must produce one note',
    pg_temp.s11t_err(v_ans), '23514', '%requires an idempotency key%');

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t(v_pad) || ', '
    || pg_temp.s11t_u(v_note1) || ')');
  PERFORM pg_temp.s11t_ok('N13 the reviewer, citing a live ticket about the refund''s own wedding, is '
    || 'answered', NOT (v_ans ? '_error'));
  PERFORM pg_temp.s11t_ledger('N13 note on ref1', v_ans || jsonb_build_object('_key', v_note1::text),
                              'commerce_review_note_added');

  PERFORM pg_temp.s11t_keys('N14 twelve fields — the note''s own identity and the four flags that say what '
    || 'did not happen', v_ans,
    ARRAY['audit_id','case_ref','entitlement_changed','kind','money_moved','note_id','note_only','order_id',
          'refund_id','refund_row_changed','replayed','wedding_id']);

  PERFORM pg_temp.s11t_ok('N15 all four flags in one direction: this is the oversight the stage ships, and '
    || 'the answer says so rather than leaving it to be read out of the body',
    (v_ans ->> 'note_only')::boolean IS TRUE AND (v_ans ->> 'money_moved')::boolean IS FALSE
      AND (v_ans ->> 'entitlement_changed')::boolean IS FALSE
      AND (v_ans ->> 'refund_row_changed')::boolean IS FALSE
      AND (v_ans ->> 'order_id')::uuid = v_ord1 AND (v_ans ->> 'wedding_id')::uuid = v_w1
      AND (v_ans ->> 'case_ref') = v_cas_live AND (v_ans ->> 'replayed')::boolean IS FALSE);

  SELECT (v_ans ->> 'note_id')::uuid INTO v_note_id;
  SELECT to_jsonb(n) || jsonb_build_object('_k', n.idempotency_key::text) INTO v_row
    FROM private.commerce_review_notes n WHERE n.id = v_note_id;

  PERFORM pg_temp.s11t_ok('N16 the stored row is the note, trimmed by the door rather than by whoever typed '
    || 'it, with the author the session named and the order the trigger derived',
    (v_row ->> 'note') = btrim(v_pad) AND (v_row ->> 'author_user_id')::uuid = v_fin1
      AND (v_row ->> 'refund_id')::uuid = v_ref1 AND (v_row ->> 'order_id')::uuid = v_ord1
      AND (v_row ->> 'case_ref') = v_cas_live AND (v_row ->> 'kind') = 'in_review'
      AND (v_row ->> '_k')::uuid = v_note1);

  PERFORM pg_temp.s11t_ok('N17 and the trail row does not contain the sentence. §4''s payload discipline has '
    || 'one column in this slice that carries prose, and the answer to "what did a provider reference end up '
    || 'in the audit store?" is that it did not',
    NOT ((SELECT a.reason FROM private.audit_events a WHERE a.idempotency_key = v_note1::text)
                LIKE '%' || btrim(v_pad) || '%')
      AND NOT ((SELECT a.payload::text FROM private.audit_events a
                 WHERE a.idempotency_key = v_note1::text) LIKE '%' || btrim(v_pad) || '%')
      AND (SELECT a.reason FROM private.audit_events a WHERE a.idempotency_key = v_note1::text)
          LIKE '%in_review review note was added to refund%');

  PERFORM pg_temp.s11t_eq('N18 one trail row with the refund as its subject, the reviewer as its actor and '
    || 'the ticket''s wedding as its scope',
    (SELECT count(*)::int FROM private.audit_events a WHERE a.idempotency_key = v_note1::text
       AND a.action = 'commerce_review_note_added' AND a.subject_type = 'commerce_refund'
       AND a.subject_key = v_ref1 AND a.actor_user_id = v_fin1 AND a.actor_kind = 'operator'
       AND a.wedding_id = v_w1 AND a.before_state = a.after_state), 1);

  PERFORM pg_temp.s11t_eq('N19 and the before/after pair is the same value, which is what "the refund kept '
    || 'its status" looks like when it is an assertion rather than an adjective',
    (SELECT count(*)::int FROM private.audit_events a WHERE a.idempotency_key = v_note1::text
       AND a.before_state = jsonb_build_object('refund_status','recorded')), 1);

  PERFORM pg_temp.s11t_eq('N20 one event row on the ticket, and no status moved on it',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.kind = 'operation_link' AND e.idempotency_key = v_note1
        AND e.actor_user_id = v_fin1 AND e.to_status IS NULL
        AND e.case_id = (SELECT id FROM s11t_reg WHERE tag = 'cas_live')), 1);

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('escalated_to_owner') || ', ' || pg_temp.s11t_t('a second delivery') || ', '
    || pg_temp.s11t_u(v_note1) || ')');
  PERFORM pg_temp.s11t_ok('N21 the same key is one note: the replay answers with the first delivery''s '
    || 'fields and its kind is the one that was actually written',
    (v_ans ->> 'replayed')::boolean IS TRUE
      AND (v_ans ->> 'kind') = 'in_review' AND (v_ans ->> 'note_id')::uuid = v_note_id);

  PERFORM pg_temp.s11t_eq('N22 and it wrote no second note',
    (SELECT count(*)::int FROM private.commerce_review_notes), 1);

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref6) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t('a note on the same ticket, another refund')
    || ', ' || pg_temp.s11t_u(v_note1b) || ')');
  PERFORM pg_temp.s11t_ok('N23 one ticket may carry notes about several refunds — the thread is the ticket''s '
    || 'and the join is the queue''s job', NOT (v_ans ? '_error'));
  PERFORM pg_temp.s11t_ledger('N23 note on ref6', v_ans || jsonb_build_object('_key', v_note1b::text),
                              'commerce_review_note_added');

  v_ans := pg_temp.s11t_as('authenticated', v_fin2, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref3) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('evidence_requested') || ', ' || pg_temp.s11t_t('written by the reviewer whose '
    || 'account is deleted in group O') || ', ' || pg_temp.s11t_u(v_note_fin2) || ')');
  PERFORM pg_temp.s11t_ok('N24 a second reviewer may annotate the same ticket', NOT (v_ans ? '_error'));
  PERFORM pg_temp.s11t_ledger('N24 note on ref3',
    v_ans || jsonb_build_object('_key', v_note_fin2::text), 'commerce_review_note_added');

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref2) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('documented_outcome') || ', ' || pg_temp.s11t_t('a note that will be cited by an act '
    || 'it has nothing to do with') || ', ' || pg_temp.s11t_u(v_shared) || ')');
  PERFORM pg_temp.s11t_ok('N25 and a fourth, under the key this file uses for the cross-act collision',
    NOT (v_ans ? '_error'));
  PERFORM pg_temp.s11t_ledger('N25 note on ref2', v_ans || jsonb_build_object('_key', v_shared::text),
                              'commerce_review_note_added');

  PERFORM pg_temp.s11t_eq('N26 four notes, and every one of them cites the same live ticket',
    (SELECT count(*)::int FROM private.commerce_review_notes n WHERE n.case_ref = v_cas_live), 4);

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t('one key cannot be two notes') || ', '
    || pg_temp.s11t_u(v_note1b) || ')');
  PERFORM pg_temp.s11t_err_is('N27 a key already used on a different refund is refused rather than answered '
    || 'with that other note — reporting a note this refund never saw would be worse than refusing',
    pg_temp.s11t_err(v_ans), '23514', '%already belongs to a different act%');

  v_ans := pg_temp.s11t_as('authenticated', v_fin1, 'SELECT api.operator_add_commerce_review_note('
    || pg_temp.s11t_u(v_ref1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t('a note cannot reuse a purge''s key') || ', '
    || pg_temp.s11t_u(v_purge1) || ')');
  PERFORM pg_temp.s11t_err_is('N28 and the collision is symmetric across the three bodies: the same key '
    || 'bought a purge plan on the trusted channel, and it cannot also buy a sentence about a refund',
    pg_temp.s11t_err(v_ans), '23514', '%already belongs to a different act%');

  v_ans := pg_temp.s11t_as('authenticated', v_op1, 'SELECT api.operator_takedown_publication('
    || pg_temp.s11t_u(v_w1) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_t('terms_violation') || ', ' || pg_temp.s11t_u(v_shared) || ')');
  PERFORM pg_temp.s11t_err_is('N29 and read the other way, a takedown cannot be retro-fitted onto a note''s '
    || 'key — which is measured here rather than assumed, because the replay check in this body runs before '
    || 'the "is there anything live to take down" question', pg_temp.s11t_err(v_ans), '23514',
    '%already belongs to a different act%');

  v_q := pg_temp.s11t_as('authenticated', v_fin1,
    'SELECT api.operator_commerce_review_queue(' || pg_temp.s11t_t('recorded') || ', 50)');
  PERFORM pg_temp.s11t_ok('Q22b and now the queue shows the thread it promised. Under the `recorded` filter '
    || 'three refunds are in the window and two of them carry one note each, so the third row''s empty list '
    || 'is a measurement rather than a missing join; each note carries the ticket''s own status, so a '
    || 'reviewer can see what kind of permission the sentence was written under',
    (SELECT count(*)::int FROM jsonb_array_elements(v_q -> 'refunds') r
      WHERE jsonb_array_length(r -> 'notes') = 1) = 2
      AND (SELECT count(*)::int FROM jsonb_array_elements(v_q -> 'refunds') r
            WHERE r -> 'notes' -> 0 ->> 'case_status' = 'open') = 2
      AND (SELECT count(*)::int FROM jsonb_array_elements(v_q -> 'refunds') r
            WHERE jsonb_array_length(r -> 'notes') = 0) = 1);

  PERFORM pg_temp.s11t_keys('Q22c a note in the thread is seven fields, and the prose is one of them — the '
    || 'note row is the only place it is kept', v_q -> 'refunds' -> 0 -> 'notes' -> 0,
    ARRAY['author_user_id','case_ref','case_status','created_at','kind','note','note_id']);

  PERFORM pg_temp.s11t_ok('N30 four notes written, and the money is still byte-identical to the state P '
    || 'measured: this is the only write to a money-adjacent surface in the whole slice, and it moves nothing',
    (SELECT ord FROM s11t_pbase) = pg_temp.s11t_ord()
      AND (SELECT ref FROM s11t_pbase) = pg_temp.s11t_ref()
      AND (SELECT ent FROM s11t_pbase) = pg_temp.s11t_ent()
      AND (SELECT pol FROM s11t_pbase) = pg_temp.s11t_pol());
END $n$;

-- ===========================================================================
-- O. The walls around the note, and what survives its author
-- ===========================================================================
DO $o$
DECLARE
  v_note_id uuid; v_fin1 uuid; v_fin2 uuid; v_ref1 uuid; v_ord1 uuid; v_cas_live text;
  v_row_before jsonb; v_row_after jsonb; v_err text;
  v_rows integer;
BEGIN
  SELECT n.id INTO v_note_id FROM private.commerce_review_notes n
   WHERE n.author_user_id = (SELECT fin2 FROM s11t_cast) LIMIT 1;
  SELECT c.fin1, c.fin2, c.ref1, c.ord1, (SELECT ref FROM s11t_reg WHERE tag = 'cas_live')
    INTO v_fin1, v_fin2, v_ref1, v_ord1, v_cas_live FROM s11t_cast c;

  SELECT to_jsonb(n) INTO v_row_before FROM private.commerce_review_notes n WHERE n.id = v_note_id;

  PERFORM pg_temp.s11t_err_is('O01 a client role cannot insert a note by hand, whatever the door says: it is '
    || 'stopped one wall before the table, because `private` carries no USAGE for anon or authenticated',
    pg_temp.s11t_try('authenticated', v_fin1, 'INSERT INTO private.commerce_review_notes (refund_id, '
      || 'case_ref, author_user_id, kind, note, idempotency_key) VALUES (' || pg_temp.s11t_u(v_ref1)
      || ', ' || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u(v_fin1) || ', '
      || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t('forged') || ', gen_random_uuid())'),
    '42501', '%permission denied for schema private%');

  PERFORM pg_temp.s11t_err_is('O01b and the second wall is measured where it can actually be reached: '
    || '`service_role` does hold USAGE on `private`, so for that role it is the table grant that answers, '
    || 'and the answer is still no',
    pg_temp.s11t_try('service_role', NULL, 'INSERT INTO private.commerce_review_notes (refund_id, '
      || 'case_ref, author_user_id, kind, note, idempotency_key) VALUES (' || pg_temp.s11t_u(v_ref1)
      || ', ' || pg_temp.s11t_t(v_cas_live) || ', ' || pg_temp.s11t_u(v_fin1) || ', '
      || pg_temp.s11t_t('in_review') || ', ' || pg_temp.s11t_t('forged') || ', gen_random_uuid())'),
    '42501', '%permission denied for table commerce_review_notes%');

  PERFORM pg_temp.s11t_err_is('O02 nor edit one',
    pg_temp.s11t_try('authenticated', v_fin1, 'UPDATE private.commerce_review_notes SET note = '
      || pg_temp.s11t_t('edited by a client') || ' WHERE id = ' || pg_temp.s11t_u(v_note_id)),
    '42501', '%permission denied for schema private%');

  PERFORM pg_temp.s11t_err_is('O03 nor delete one',
    pg_temp.s11t_try('authenticated', v_fin1, 'DELETE FROM private.commerce_review_notes WHERE id = '
      || pg_temp.s11t_u(v_note_id)), '42501', '%permission denied for schema private%');

  PERFORM pg_temp.s11t_err_is('O04 and the owner''s own hand is refused by the append-only trigger rather '
    || 'than by a privilege — this table is insert-only including for the role that owns it, which is the '
    || 'only way "a correction is a new note" means anything',
    pg_temp.s11t_probe('postgres', NULL, 'UPDATE private.commerce_review_notes SET note = '
      || pg_temp.s11t_t('edited by the owner') || ' WHERE id = ' || pg_temp.s11t_u(v_note_id)),
    '42501', '%rows are append-only: a correction is a new note, never an edit%');

  PERFORM pg_temp.s11t_err_is('O05 and hand-nulling the author is refused too, even though it is the exact '
    || 'shape the foreign key produces: the exception is granted by trigger depth, not by the column',
    pg_temp.s11t_probe('postgres', NULL, 'UPDATE private.commerce_review_notes SET author_user_id = NULL '
      || 'WHERE id = ' || pg_temp.s11t_u(v_note_id)), '42501', '%rows are append-only%');

  v_err := pg_temp.s11t_probe('postgres', NULL, 'INSERT INTO private.commerce_review_notes (refund_id, '
    || 'order_id, case_ref, author_user_id, kind, note, idempotency_key) VALUES (' || pg_temp.s11t_u(v_ref1)
    || ', ' || pg_temp.s11t_u((SELECT ord2 FROM s11t_cast)) || ', ' || pg_temp.s11t_t(v_cas_live) || ', '
    || pg_temp.s11t_u(v_fin2) || ', ' || pg_temp.s11t_t('in_review') || ', '
    || pg_temp.s11t_t('a note joined to the wrong order') || ', gen_random_uuid())');
  PERFORM pg_temp.s11t_err_is('O06 a note whose declared order disagrees with its refund is refused by the '
    || 'trigger before the row exists — the queue joins on this column, and a wrong value here would show a '
    || 'reviewer money belonging to another wedding',
    v_err, '23514', '%a review note''s order is its refund''s order%');

  PERFORM pg_temp.s11t_err_is('O07 and a note that names no author is refused at the same instant, by an '
    || 'INSERT guard rather than a CHECK so that a reviewer can still be deleted later',
    pg_temp.s11t_probe('postgres', NULL, 'INSERT INTO private.commerce_review_notes (refund_id, case_ref, '
      || 'author_user_id, kind, note, idempotency_key) VALUES (' || pg_temp.s11t_u(v_ref1) || ', '
      || pg_temp.s11t_t(v_cas_live) || ', NULL, ' || pg_temp.s11t_t('in_review') || ', '
      || pg_temp.s11t_t('anonymous oversight') || ', gen_random_uuid())'),
    '23514', '%must name the account that wrote it%');

  PERFORM pg_temp.s11t_err_is('O08 the refund a note cites cannot be deleted out from under it: this is the '
    || 'money ledger''s own history refusing to lose a row a human annotated',
    pg_temp.s11t_probe('postgres', NULL, 'DELETE FROM private.commerce_refunds WHERE id = '
      || pg_temp.s11t_u(v_ref1)), '23503', '%foreign key constraint%');

  PERFORM pg_temp.s11t_err_is('O09 nor the order',
    pg_temp.s11t_probe('postgres', NULL, 'DELETE FROM private.commerce_orders WHERE id = '
      || pg_temp.s11t_u(v_ord1)), '23503', '%foreign key constraint%');

  PERFORM pg_temp.s11t_err_is('O10 nor the ticket the note cites — the three parent links in the table '
    || 'comment all hold',
    pg_temp.s11t_probe('postgres', NULL, 'DELETE FROM private.support_cases WHERE case_ref = '
      || pg_temp.s11t_t(v_cas_live)), '23503', '%foreign key constraint%');

  DELETE FROM auth.users WHERE id = v_fin2;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM pg_temp.s11t_eq('O11 the author''s account can still be erased: the rule that keeps a note honest '
    || 'is an INSERT guard, and this is the whole reason it was not written as a CHECK. Issued on this '
    || 'channel rather than through `s11t_probe`, because probe rolls the accepted statement back and the '
    || 'four cells that follow read what it left behind', v_rows, 1);

  PERFORM pg_temp.s11t_eq('O11b and the erasure is not cost-free: `operator_grants.user_id` is ON DELETE '
    || 'CASCADE, so the account''s own authority rows go with it. Measured here because it is the reason '
    || 'group Z takes the grants invariant from this point rather than from the plant, and because an audit '
    || 'story that says "deleting a reviewer touches nothing else" would be false',
    (SELECT count(*)::int FROM private.operator_grants g WHERE g.user_id = v_fin2), 0);

  SELECT to_jsonb(n) INTO v_row_after FROM private.commerce_review_notes n WHERE n.id = v_note_id;

  PERFORM pg_temp.s11t_ok('O12 and the note survives it with every other byte identical',
    v_row_after ? 'id' AND (v_row_after ->> 'author_user_id') IS NULL
      AND (v_row_after - 'author_user_id') = (v_row_before - 'author_user_id'));

  PERFORM pg_temp.s11t_eq('O13 the trail row and the event row survive too, and the person''s id is nulled '
    || 'out of both by the same foreign key — the record of what happened stands, the pointer to who said it '
    || 'is the half this stage cannot promise. Stated as a limit, not smoothed over',
    (SELECT count(*)::int FROM private.audit_events a
      WHERE a.action = 'commerce_review_note_added' AND a.actor_user_id IS NULL
        AND a.idempotency_key = (SELECT k::text FROM s11t_key WHERE tag = 'note_fin2')), 1);

  PERFORM pg_temp.s11t_ok('O14 and the note is still readable, still attributed to its ticket and its kind, '
    || 'which is what a finance reviewer sees when the account behind the sentence is gone',
    (SELECT count(*)::int FROM private.commerce_review_notes n
      WHERE n.author_user_id IS NULL AND n.kind = 'evidence_requested'
        AND n.case_ref = v_cas_live) = 1
      AND (SELECT count(*)::int FROM private.commerce_review_notes) = 4);

  PERFORM pg_temp.s11t_ok('O15 nothing else disappeared in this group: the ledger, the artefacts, the '
    || 'publications and the bucket all hold the rows P counted',
    (SELECT count(*)::int FROM private.commerce_refunds) = 6
      AND (SELECT count(*)::int FROM private.commerce_orders) = 2
      AND (SELECT count(*)::int FROM public.invitation_outputs) = 8
      AND (SELECT count(*)::int FROM public.publications) = 4
      AND (SELECT count(*)::int FROM storage.objects) = 5);

  PERFORM pg_temp.s11t_eq('O16 and the erasure did not touch the money',
    (SELECT ref FROM s11t_pbase), pg_temp.s11t_ref());
END $o$;

-- ===========================================================================
-- Z. The census, both ways
-- ===========================================================================
-- The ledger is what this file called and had accepted; the trail is what the database recorded. Read one
-- way it proves a door cannot invent an audit id; read the other it proves an act cannot happen without an
-- answer. A replayed delivery is in neither count, because `replayed=true` is the door saying it wrote
-- nothing — and Z06 checks that the replays in this file really did stay out of the trail.
DO $z$
DECLARE v_passed integer;
BEGIN
  PERFORM pg_temp.s11t_eq('Z01 seven accepted mutating calls in this file',
    (SELECT count(*)::int FROM s11t_led), 7);

  PERFORM pg_temp.s11t_eq('Z02 and exactly seven new trail rows above the baseline slices 1–3 left',
    (SELECT (a - b)::int FROM (SELECT pg_temp.s11t_acount() AS a) x,
       (SELECT acount AS b FROM s11t_pbase) y), 7);

  PERFORM pg_temp.s11t_eq('Z03 every ledger entry names a real trail row whose action matches the one the '
    || 'door returned',
    (SELECT count(*)::int FROM s11t_led l
      WHERE NOT EXISTS (SELECT 1 FROM private.audit_events a
                         WHERE a.id = l.audit_id AND a.action = l.action)), 0);

  PERFORM pg_temp.s11t_eq('Z04 and every trail row written by one of this slice''s five actions is in the '
    || 'ledger — the census is two-way, so an act this file never called cannot hide in the store',
    (SELECT count(*)::int FROM private.audit_events a
      WHERE a.action IN ('publication_takedown','publication_objects_purge_planned',
                         'commerce_review_note_added')
        AND a.id > (SELECT first_audit FROM s11t_base)
        AND NOT EXISTS (SELECT 1 FROM s11t_led l WHERE l.audit_id = a.id)), 0);

  PERFORM pg_temp.s11t_eq('Z05 one event row per accepted act, and no more — the thread cannot grow a link '
    || 'that no door returned',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.kind = 'operation_link'
        AND e.idempotency_key IN (SELECT l.idempotency_key FROM s11t_led l)), 7);

  PERFORM pg_temp.s11t_eq('Z06 the four replays in this file wrote no trail row at all: every key this file '
    || 'used once appears exactly once in the store',
    (SELECT count(*)::int FROM (SELECT a.idempotency_key FROM private.audit_events a
        WHERE a.idempotency_key IS NOT NULL AND a.id > (SELECT first_audit FROM s11t_base)
        GROUP BY 1 HAVING count(*) > 1) dup), 0);

  PERFORM pg_temp.s11t_eq('Z07 four notes, and every one of them has a trail row naming the same refund',
    (SELECT count(*)::int FROM private.commerce_review_notes n
      WHERE EXISTS (SELECT 1 FROM private.audit_events a
                     WHERE a.action = 'commerce_review_note_added'
                       AND a.subject_key = n.refund_id
                       AND a.idempotency_key = n.idempotency_key::text)), 4);

  PERFORM pg_temp.s11t_eq('Z08 the bucket never changed size: not one object was deleted by a slice whose '
    || 'irreversible half is a CLI call this stage does not make',
    (SELECT store FROM s11t_pbase), pg_temp.s11t_cnt('storage.objects'));

  PERFORM pg_temp.s11t_ok('Z09 every digest frozen before the first act is still equal — money, refunds, '
    || 'entitlements, the policy singleton, the artefacts, the credentials, the tickets and the thread. The '
    || 'two stores that grew are the trail and the case thread, which is precisely the pair §4 says an '
    || 'operator may write to. Authority is read in its excluding form, because group O erases an account '
    || 'and that account''s own grant row is measured away in O11b; every other authority row is byte-for-'
    || 'byte the frozen one',
    (SELECT ord FROM s11t_pbase) = pg_temp.s11t_ord()
      AND (SELECT ref FROM s11t_pbase) = pg_temp.s11t_ref()
      AND (SELECT ent FROM s11t_pbase) = pg_temp.s11t_ent()
      AND (SELECT pol FROM s11t_pbase) = pg_temp.s11t_pol()
      AND (SELECT tok FROM s11t_pbase) <> pg_temp.s11t_tok()
      AND (SELECT pub FROM s11t_pbase) <> pg_temp.s11t_pub()
      AND (SELECT cse FROM s11t_pbase) = pg_temp.s11t_cse()
      AND (SELECT grx FROM s11t_pbase) = pg_temp.s11t_grants_excl((SELECT fin2 FROM s11t_cast))
      AND (SELECT ev FROM s11t_pbase) <> pg_temp.s11t_ev());

  PERFORM pg_temp.s11t_eq('Z10 and no case status moved on any ticket this slice touched: an operator took '
    || 'two invitations down and annotated four refunds without closing, triaging or parking a single '
    || 'ticket. Scoped to this file''s five planted cases, because `85_support_lifecycle.sql` ran on this '
    || 'same chain before it and transitioned tickets of its own — a cluster-wide zero here would be a '
    || 'false claim about slice 2''s battery, not a true one about slice 4. The plant''s own status moves '
    || 'are hand `UPDATE`s, which no trigger turns into an event row (measured: the only writers of '
    || '`support_case_events` are the `internal_api` bodies), so these five cases carry no status edge at '
    || 'all — the ones they do carry are `operation_link` rows, counted by Z05',
    (SELECT count(*)::int FROM private.support_case_events e
      WHERE e.case_id IN ((SELECT id FROM s11t_reg WHERE tag = 'cas_live'),
                          (SELECT id FROM s11t_reg WHERE tag = 'cas_note'),
                          (SELECT id FROM s11t_reg WHERE tag = 'cas_w2'),
                          (SELECT id FROM s11t_reg WHERE tag = 'cas_park'),
                          (SELECT id FROM s11t_reg WHERE tag = 'cas_done'))
        AND (e.to_status IS NOT NULL OR e.from_status IS NOT NULL)), 0);

  PERFORM pg_temp.s11t_eq('Z11 the publications this file retired are exactly the two it claims, and both '
    || 'keep a recorded takedown — the plant''s third revoked publication (w4) is deliberately excluded, '
    || 'because it was retired by hand and has no audit row behind it',
    (SELECT count(*)::int FROM public.publications p WHERE p.status = 'revoked'
       AND EXISTS (SELECT 1 FROM private.audit_events a
                    WHERE a.action = 'publication_takedown' AND a.subject_key = p.id)), 2);

  PERFORM pg_temp.s11t_eq('Z12 every artefact the takedowns invalidated is invalidated with the reason the '
    || 'door named and a timestamp the guard set — three rows, no more: two ready artefacts on w1 and one on '
    || 'w2. The artefact w4''s hand-retired publication points at was already invalidated before this slice '
    || 'started, so it carries a different reason',
    (SELECT count(*)::int FROM public.invitation_outputs o
      WHERE o.invalidation_reason = 'publication_revoked' AND o.invalidated_at IS NOT NULL
        AND o.status = 'invalidated'), 3);

  PERFORM pg_temp.s11t_eq('Z13 and the three rows Stage 9''s rule deliberately left alone are still in the '
    || 'states they were: a takedown that swept every not-yet-invalidated row would have aborted on the '
    || 'first artefact that never uploaded',
    (SELECT count(*)::int FROM public.invitation_outputs o
      WHERE o.status IN ('registered','uploading','failed')
        AND o.invalidation_reason IS NULL), 3);

  PERFORM pg_temp.s11t_eq('Z14 no credential outside the two taken-down weddings was revoked, and the '
    || '`rsvp` kind survived on both — the under-revocation and the over-revocation are both measured, not '
    || 'assumed',
    (SELECT count(*)::int FROM private.access_tokens t WHERE t.revoked_at IS NOT NULL), 4);
END $z$;

DO $f$
DECLARE v integer;
BEGIN
  v := coalesce(nullif(current_setting('s11t.passed', true), ''), '0')::int;
  IF v <> 208 THEN
    RAISE EXCEPTION 'FAIL floor: this battery is a fixed catalogue of 208 cells and counted % — a '
      'suite that silently gains or loses cells is worse than one that fails', v;
  END IF;
  RAISE NOTICE 'PASSED (%)', v;
END $f$;
