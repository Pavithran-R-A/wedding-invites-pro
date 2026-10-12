-- Stage 8 battery 1: the household credential — what one host call writes, what it refuses to
-- write, what the table refuses underneath it, and every way a family's link stops working.
--
-- Run by `supabase/tests/stage8/run.sh` after the storage fixture, the published migrations and the
-- whole stage chain through Stage 8, as the superuser, in one transaction that commits. Battery 2
-- (`90_guest_rsvp.sql`) reads this file's committed residue the same way Stage 7's second battery
-- reads the first one's, and mints its own credentials because a raw secret is legible exactly once.
--
--   F  the fixture's own shape, asserted first: a battery reading an empty schema would print
--      everything below it as a pass
--   H  §3.1 — the send. What one call writes, the six names it answers with, the alphabet of the
--      path it hands back, and the digest it stores instead of the secret
--   B  who may send, withdraw, rotate and read at all — cross-wedding, no publication, signed out,
--      anonymous, service, and the NULL-name arms
--   W  §10 — one live household credential per household: the index's refusal, its scope, and what
--      it deliberately does not constrain
--   S  §1 — the tightened kind CHECK: the arm that was closed, the arms that were already there,
--      and the order the table reports two violations in
--   A  an expiry, reached by moving the clock rather than by waiting, and the two reads that must
--      agree about what it means
--   R  §3.2/§3.3 — withdrawal, idempotence, and rotation: the history it leaves, the deadline it
--      carries, and the one deadline it refuses to carry
--   T  §3.4 — the host's own view of their families, and the token material none of it may contain
--   G  the census this head leaves behind: the six names, their posture, and the caller matrix
--   Z  residue, scoped to the weddings this file created
--   L  the floor
--
-- Where a refusal is measured it is measured twice: the SQLSTATE and the sentence. A bare SQLSTATE
-- is not evidence — `left(...,5)` cannot tell a 42601 from a 42501, and this repository has already
-- scored a psql syntax error as a security refusal. So every probe below carries the phrase the
-- product chose, and `run()` fails a probe that returns no error at all rather than counting it as a
-- refusal that never happened. An empty probe group is likewise a failure, not a skip.
--
-- The role discipline is the point, not decoration. The host's four verbs run as `authenticated`
-- with `test.uid` naming the account; the door runs as `anon`, which is the only role a guest can
-- ever be, because a guest has no account by design. Groups that measure a refusal also measure the
-- neighbouring acceptance through the same role, so a refusal is about the caller or the credential
-- and not about how the statement was addressed.
--
-- Values a probe needs while it holds a role are carried in `s8f.*` settings rather than read from
-- `pg_temp`, for the reason `stage3/30_publication.sql` records: an impersonated role cannot see
-- this file's temp fixture.
--
-- Three things this battery does not claim:
--   1. It is not the HTTP tier. There is no PostgREST, no Kong and no Auth here, so nothing below
--      proves what status code or body a real request gets; that belongs to `tests/api/`. The
--      boundary is the same one Stage 5-7's runners print: a plain Postgres plus
--      `supabase/tests/rls/00_bootstrap.sql` and the Stage 6 storage fixture.
--   2. The direct writes into `private.access_tokens` in groups W and S are not a product path and
--      are not standing in for one. No client role may write that table at all
--      (`20260925120400...:183-186`), which is exactly why the table-level rules can only be
--      measured by the role that owns them — the claim under test is the constraint, not the verb.
--   3. Group A moves a credential's own timestamps to reach an expiry. Waiting is impossible inside
--      one transaction and a fixture that faked `now()` would be measuring its own lie; the first
--      attempt is deliberately wrong and is asserted as refused, so the two-ended edit is proven
--      rather than assumed.

SET client_min_messages = notice;
SELECT set_config('s8f.passed', '0', false);

CREATE FUNCTION pg_temp.s8f_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s8f.passed',
    (coalesce(nullif(current_setting('s8f.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s8f_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s8f_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s8f_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s8f_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s8f_sorted(want text[]) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM unnest(coalesce(want, '{}'::text[])) u(k) $fn$;

CREATE FUNCTION pg_temp.s8f_top_keys(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM jsonb_object_keys(v) u(k) $fn$;

CREATE FUNCTION pg_temp.s8f_has_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % , not an object', label, jsonb_typeof(v);
  END IF;
  PERFORM pg_temp.s8f_eq(label, pg_temp.s8f_top_keys(v), pg_temp.s8f_sorted(want));
END $fn$;

-- A jsonb array read as a sorted set. Where the product's own ORDER BY is the contract this file
-- asserts the array itself (group H does, twice); where it is not, a set comparison keeps the
-- assertion honest about which half it is testing.
CREATE FUNCTION pg_temp.s8f_arr(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT pg_temp.s8f_sorted(coalesce(array_agg(q.e), '{}'::text[]))
    FROM jsonb_array_elements_text(coalesce(v, '[]'::jsonb)) q(e) $fn$;

-- How many rows a caller can actually see, measured as that caller.
CREATE FUNCTION pg_temp.s8f_visible(role text, uid uuid, select_sql text) RETURNS bigint
LANGUAGE plpgsql AS $fn$
DECLARE n bigint;
BEGIN
  PERFORM set_config('test.uid', coalesce(uid::text, ''), false);
  EXECUTE 'SET ROLE ' || role;
  BEGIN
    EXECUTE 'SELECT count(*) FROM (' || select_sql || ') s' INTO n;
  EXCEPTION WHEN OTHERS THEN
    n := -1;
  END;
  EXECUTE 'RESET ROLE';
  RETURN n;
END $fn$;

CREATE TEMP TABLE probes (
  grp         text,
  label       text,
  stmt        text,
  want_state  text,
  want_like   text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.s8f_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

CREATE FUNCTION pg_temp.s8f_run(p_grp text, p_role text, p_uid text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  v_labels text[];
  v_stmts  text[];
  v_states text[];
  v_likes  text[];
  v        text;
  i        integer;
BEGIN
  -- A role name is interpolated into `SET ROLE`, so it is a whitelist rather than a value a later
  -- edit to the fixture could steer.
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;

  SELECT array_agg(label), array_agg(stmt), array_agg(want_state), array_agg(want_like)
    INTO v_labels, v_stmts, v_states, v_likes
    FROM (SELECT p.label, p.stmt, p.want_state, p.want_like
            FROM probes p WHERE p.grp = s8f_run.p_grp ORDER BY p.label) s;

  IF v_labels IS NULL THEN
    RAISE EXCEPTION 'FAIL: probe group % ran no probes — an empty group is a skip, not a pass', p_grp;
  END IF;

  FOR i IN 1 .. cardinality(v_labels) LOOP
    EXECUTE 'SET ROLE ' || p_role;
    IF p_uid IS NOT NULL THEN
      PERFORM set_config('test.uid', p_uid, false);
    END IF;
    v := pg_temp.s8f_err(v_stmts[i]);
    EXECUTE 'RESET ROLE';

    IF v = 'no-error' THEN
      RAISE EXCEPTION 'FAIL %: "%" was allowed through', p_grp, v_labels[i];
    END IF;
    IF split_part(v, ' ', 1) <> v_states[i] OR v NOT LIKE v_likes[i] THEN
      RAISE EXCEPTION 'FAIL %: "%" got [%] want [% / %]',
        p_grp, v_labels[i], v, v_states[i], v_likes[i];
    END IF;
    RAISE NOTICE 'PASS %: %', p_grp, v_labels[i];
    PERFORM pg_temp.s8f_add(1);
  END LOOP;
END $fn$;

-- A host verb called by the account that owns the wedding, with the answer handed back. A refusal
-- inside this helper is a failure of the battery, not a measured answer: refusals are group B's job.
CREATE FUNCTION pg_temp.s8f_auth(uid text, stmt text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('test.uid', coalesce(uid, ''), false);
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    EXECUTE stmt INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL: expected success, got % | % for %', SQLSTATE, SQLERRM, stmt;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $fn$;

-- A client write a host is entitled to make, measured as that host. Group T needs answers in the table
-- that the reply counts count, and the only honest way to have them there is the plain INSERT the host's
-- own screen issues on a client-writable table — not a write as the owner, which would bypass the very
-- policy whose effect is being read. A failure inside this helper ends the run: an answer that did not
-- land would otherwise turn T's counts into claims about nothing.
CREATE FUNCTION pg_temp.s8f_host_write(uid text, stmt text) RETURNS bigint
LANGUAGE plpgsql AS $fn$
DECLARE n bigint;
BEGIN
  PERFORM set_config('test.uid', coalesce(uid, ''), false);
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL: expected an accepted client write, got % | % for %',
      SQLSTATE, SQLERRM, stmt;
  END;
  EXECUTE 'RESET ROLE';
  RETURN n;
END $fn$;

-- The guest door, used by groups H, A and R to prove a row that this battery minted or aged is a
-- working credential rather than decoration: the same header PostgREST writes, the zero-argument
-- resolver, the `anon` role. `raw IS NULL` sends no header at all.
CREATE FUNCTION pg_temp.s8f_door(raw text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.headers',
    CASE WHEN raw IS NULL THEN '{}'::text
         ELSE jsonb_build_object('x-guest-token', raw)::text END, false);
  EXECUTE 'SET ROLE anon';
  BEGIN
    SELECT api.resolve_guest_invitation() INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $fn$;

-- Header only, for the groups whose statements must raise: `run()` owns the role and the probe text,
-- so this file sets the credential those probes are answered with.
CREATE FUNCTION pg_temp.s8f_send(raw text) RETURNS void
LANGUAGE sql AS $fn$
  SELECT set_config('request.headers',
    CASE WHEN raw IS NULL THEN '{}'::text
         ELSE jsonb_build_object('x-guest-token', raw)::text END, false) $fn$;

-- The scan that backs "a raw token never enters a database record": every text-shaped column of
-- every base table in the two schemas the product owns, not merely the one column this stage
-- writes. There is deliberately no exception handler — a relation this cannot read is a broken
-- fixture and must stop the run rather than be skipped into a quiet pass.
CREATE FUNCTION pg_temp.s8f_stored_hits(raw text) RETURNS text[]
LANGUAGE plpgsql AS $fn$
DECLARE r record; hits text[] := '{}'::text[]; n bigint;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN pg_class pc ON pc.relname = c.table_name
      JOIN pg_namespace ns ON ns.oid = pc.relnamespace AND ns.nspname = c.table_schema
     WHERE c.table_schema IN ('public', 'private')
       AND pc.relkind = 'r'
       AND c.data_type IN ('text', 'character varying', 'USER-DEFINED', 'jsonb')
     ORDER BY c.table_schema, c.table_name, c.column_name
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE strpos(coalesce(%I::text, ''''), $1) > 0',
                   r.table_schema, r.table_name, r.column_name)
      INTO n USING raw;
    IF n > 0 THEN
      hits := hits || (r.table_schema || '.' || r.table_name || '.' || r.column_name);
    END IF;
  END LOOP;
  RETURN hits;
END $fn$;

-- The household row for a raw credential, found by the digest rather than by a pointer this file
-- already holds, so an assertion below can disagree about a named column instead of only about a
-- result. Group A uses it to prove that moving a credential's timestamps moved the row the door reads.
CREATE FUNCTION pg_temp.s8f_token(raw text) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT array_agg(t.expiry_policy || '|' || coalesce(t.expires_at::text, '-')
                    || '|revoked=' || coalesce(t.revoked_at::text, '-')
                    || '|used=' || coalesce(t.last_used_at::text, '-') ORDER BY t.created_at)
    FROM private.access_tokens t
   WHERE t.token_hash = encode(extensions.digest(convert_to(raw, 'UTF8'), 'sha256'), 'hex') $fn$;

-- --------------------------------------------------------------------------- the cast
CREATE TEMP TABLE s8r ON COMMIT DROP AS
SELECT gen_random_uuid() AS owner_a, gen_random_uuid() AS owner_b,
       gen_random_uuid() AS wed_a, gen_random_uuid() AS wed_b,
       gen_random_uuid() AS wed_empty, gen_random_uuid() AS wed_nopub,
       gen_random_uuid() AS hh_chenna, gen_random_uuid() AS hh_baby,
       gen_random_uuid() AS hh_nair, gen_random_uuid() AS hh_raman,
       gen_random_uuid() AS hh_stranger, gen_random_uuid() AS hh_nopub;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT s.owner_a, 's8-owner-a@example.test', '{}'::jsonb FROM s8r s
UNION ALL SELECT s.owner_b, 's8-owner-b@example.test', '{}'::jsonb FROM s8r s;

INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages,
                             style_settings)
-- The jsonb literals are cast explicitly because these rows are built by a SELECT over `s8r`, and
-- Postgres resolves a bare literal in a SELECT list as text rather than as the INSERT target's type.
SELECT s.wed_a, s.owner_a, 'Asha weds Bala', 'en', ARRAY['ta'],
       '{"font":"Playfair Display","fontSize":"24","color":"#C9972F","alignment":"center"}'::jsonb
  FROM s8r s
UNION ALL
SELECT s.wed_b, s.owner_b, 'Bala weds Divya', 'ta', ARRAY[]::text[],
       '{"font":"Mukta Malar","fontSize":"20","color":"#7a1f1f","alignment":"left"}'::jsonb
  FROM s8r s
UNION ALL
SELECT s.wed_empty, s.owner_a, 'Nobody Invited', 'en', ARRAY[]::text[],
       '{"font":"Playfair Display","fontSize":"24","color":"#C9972F","alignment":"center"}'::jsonb
  FROM s8r s
UNION ALL
SELECT s.wed_nopub, s.owner_a, 'Not Yet Published', 'en', ARRAY[]::text[],
       '{"font":"Playfair Display","fontSize":"24","color":"#C9972F","alignment":"center"}'::jsonb
  FROM s8r s;

INSERT INTO public.wedding_people (wedding_id, display_name, role_key, role_label,
                                   group_key, group_label, display_order)
SELECT s.wed_a, 'Maran', 'father', 'Father', 'bride-side', 'The families of', 0 FROM s8r s
UNION ALL
SELECT s.wed_a, 'Kovalan', 'groom', 'Groom', 'bride-side', 'The families of', 1 FROM s8r s
UNION ALL
SELECT s.wed_b, 'Sivan', 'father', 'Father', 'groom-side', 'The families of', 0 FROM s8r s;

INSERT INTO public.venues (wedding_id, name, address_text)
SELECT s.wed_a, 'Kalyana Mantapa', '1 Museum Road, Madurai' FROM s8r s
UNION ALL
SELECT s.wed_b, 'Beach Hall', '2 Coast Road, Rameswaram' FROM s8r s;

-- Three events on the tested wedding, deliberately uneven: two the households are scoped to, and a
-- third the host has switched off. `enabled` is the column the read door is required to honour, and
-- a fixture in which every event is live could not tell honouring it from never checking it.
--
-- The two live rows also have their `display_order` and their clock times *inverted* — the evening
-- reception is the card the document puts first, and the morning ceremony second. A host features one
-- card ahead of the others all the time, and `display_order` is the column that decides it rather than
-- the clock. The inversion is here for battery 2's E1, which asserts the guest's card list in the
-- document's order: with name order, insertion order and time order all agreeing, an answer sorted by
-- any of the three would pass, and the assertion would be about the fixture rather than about the door.
INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local,
                                   display_order, venue_id)
SELECT s.wed_a, 'muurtham', 'Muurtham', '2026-11-14 07:30', 1, v.id
  FROM s8r s JOIN public.venues v ON v.wedding_id = s.wed_a;

INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local,
                                   display_order)
SELECT s.wed_a, 'reception', 'Reception', '2026-11-14 18:00', 0 FROM s8r s;

INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local,
                                   display_order, enabled)
SELECT s.wed_a, 'farewell', 'Farewell', '2026-11-15 09:00', 2, false FROM s8r s;

INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local,
                                   display_order, venue_id)
SELECT s.wed_b, 'haldi', 'Haldi', '2026-12-02 09:00', 0, v.id
  FROM s8r s JOIN public.venues v ON v.wedding_id = s.wed_b;

-- The guest list, in the order the display names sort into rather than the order written, so that
-- group H's ordering assertion cannot be satisfied by the cast happening to be alphabetical. The
-- shapes are chosen for what each one proves downstream:
--
--   * Chennakrishna Iyer — the largest party, two events, and the host's private note about the
--     family, which sits on the same table as the greeting the guest is shown (Ruling 5.1). Group R
--     withdraws this family's link and group T reads it back as `revoked`.
--   * The Baby family — no deadline, and the household the credential-store arithmetic is measured on:
--     group W double-mints against the partial index and replaces the live row by hand, and group R
--     rotates it through the product's own verb.
--   * The Nair family — no salutation and no party size, the household the greeter must fall back to
--     `display_name` for, and the one whose link the second send mints. Nothing later touches it, so
--     group T reads the untouched shape.
--   * The Raman family — scoped to nothing, and the only household given a fixed deadline. Stage 2
--     says a zero-event household is representable and is a data error to surface rather than a silent
--     "invited to nothing" (`20260925120300...:43-45`), so this row is how Stage 8 is made to show it;
--     group A ages its deadline and group R measures the refusal that a spent deadline now produces.
INSERT INTO public.guest_households (id, wedding_id, display_name, salutation,
                                     expected_party_size, host_notes)
SELECT s.hh_chenna, s.wed_a, 'Chennakrishna Iyer', 'Dear Chennakrishna family', 4,
       'host-only: cousin needs a ride from the airport' FROM s8r s
UNION ALL
SELECT s.hh_baby, s.wed_a, 'The Baby family', 'Dear Baby family', 2, NULL FROM s8r s
UNION ALL
SELECT s.hh_nair, s.wed_a, 'The Nair family', NULL, NULL, NULL FROM s8r s
UNION ALL
SELECT s.hh_raman, s.wed_a, 'The Raman family', 'Dear Raman family', 3, NULL FROM s8r s
UNION ALL
SELECT s.hh_stranger, s.wed_b, 'The Cousin family', 'Dear cousin', 1, NULL FROM s8r s
UNION ALL
SELECT s.hh_nopub, s.wed_nopub, 'The Unpublished family', 'Dear friend', 2, NULL FROM s8r s;

-- The event scope. Two families at both live events, one family at one, one family at none.
INSERT INTO public.household_event_scopes (wedding_id, household_id, event_id)
SELECT s.wed_a, s.hh_chenna, e.id FROM s8r s
  JOIN public.wedding_events e ON e.wedding_id = s.wed_a AND e.event_key = 'muurtham'
UNION ALL
SELECT s.wed_a, s.hh_chenna, e.id FROM s8r s
  JOIN public.wedding_events e ON e.wedding_id = s.wed_a AND e.event_key = 'reception'
UNION ALL
SELECT s.wed_a, s.hh_baby, e.id FROM s8r s
  JOIN public.wedding_events e ON e.wedding_id = s.wed_a AND e.event_key = 'muurtham'
UNION ALL
SELECT s.wed_a, s.hh_baby, e.id FROM s8r s
  JOIN public.wedding_events e ON e.wedding_id = s.wed_a AND e.event_key = 'reception'
UNION ALL
SELECT s.wed_a, s.hh_nair, e.id FROM s8r s
  JOIN public.wedding_events e ON e.wedding_id = s.wed_a AND e.event_key = 'muurtham';

UPDATE public.invitation_drafts d SET content =
  '{"welcome":"With the blessings of our families","family_introduction":"Our families invite you",
    "event_notes":"Lunch follows the ceremony","closing":"With love"}'::jsonb
  FROM s8r s WHERE d.wedding_id = s.wed_a;

UPDATE public.invitation_drafts d SET content =
  '{"welcome":"Invoker words","family_introduction":"Our families invite you",
    "event_notes":"Meals follow","closing":"Nandri"}'::jsonb
  FROM s8r s WHERE d.wedding_id = s.wed_b;

SELECT set_config('s8f.wed_a', '', false);
SELECT set_config('s8f.wed_b', '', false);
SELECT set_config('s8f.wed_empty', '', false);
SELECT set_config('s8f.wed_nopub', '', false);
SELECT set_config('s8f.v1', '', false);
SELECT set_config('s8f.v2', '', false);
SELECT set_config('s8f.wed_b_v1', '', false);
SELECT set_config('s8f.pub1', '', false);
SELECT set_config('s8f.wed_raw', '', false);
SELECT set_config('s8f.raw_chenna', '', false);
SELECT set_config('s8f.raw_baby', '', false);
SELECT set_config('s8f.raw_nair', '', false);
SELECT set_config('s8f.raw_raman', '', false);
SELECT set_config('s8f.raw_raman2', '', false);
SELECT set_config('s8f.raw_baby_retired', '', false);

-- --------------------------------------------------------------------------- F: the fixture
DO $F$
DECLARE s s8r%ROWTYPE; v jsonb;
BEGIN
  SELECT * INTO s FROM s8r;
  PERFORM set_config('s8f.wed_a', s.wed_a::text, false);
  PERFORM set_config('s8f.wed_b', s.wed_b::text, false);
  PERFORM set_config('s8f.wed_empty', s.wed_empty::text, false);
  PERFORM set_config('s8f.wed_nopub', s.wed_nopub::text, false);
  -- The households the probe statements name by id have to be reachable *while a client role is
  -- held*, and `s8r` is this session's temp table — which is why every value a probe reads lives in
  -- a `s8f.*` setting. A probe that read `s8r` would either fail on privileges or, worse, be run by
  -- the role that can see it and stop being a cross-tenant test.
  PERFORM set_config('s8f.hh_chenna', s.hh_chenna::text, false);
  PERFORM set_config('s8f.hh_baby', s.hh_baby::text, false);
  PERFORM set_config('s8f.hh_nair', s.hh_nair::text, false);
  PERFORM set_config('s8f.hh_raman', s.hh_raman::text, false);
  PERFORM set_config('s8f.hh_stranger', s.hh_stranger::text, false);
  PERFORM set_config('s8f.hh_nopub', s.hh_nopub::text, false);

  -- One household of the tested wedding is deliberately left out of the cast's own list until the
  -- moment it is needed, so an assertion that counts households counts the fixture rather than a
  -- number this file typed twice.
  v := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.create_invitation_version(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM set_config('s8f.v1', v ->> 'version_id', false);
  v := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.create_invitation_version(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM set_config('s8f.v2', v ->> 'version_id', false);
  v := pg_temp.s8f_auth(s.owner_b::text,
    'SELECT api.create_invitation_version(' || quote_literal(s.wed_b::text) || '::uuid)');
  PERFORM set_config('s8f.wed_b_v1', v ->> 'version_id', false);

  v := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.publish_invitation_version(' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s8f.v1')) || '::uuid, NULL)');
  PERFORM set_config('s8f.wed_raw', substr(v ->> 'path', 4), false);
  -- Read back from the table rather than trusted out of the answer: every household credential the
  -- send mints is pinned to this row by the kind CHECK, so an unverified pointer here would quietly
  -- move a dozen assertions below it.
  PERFORM set_config('s8f.pub1',
    (SELECT p.id::text FROM public.publications p
      WHERE p.wedding_id = s.wed_a AND p.status = 'active'), false);

  PERFORM pg_temp.s8f_eq('F1 the tested wedding holds exactly four households — every count below is '
    'a count of these four rows and nothing else',
    cardinality((SELECT array_agg(h.id) FROM public.guest_households h
                  WHERE h.wedding_id = s.wed_a))::bigint, 4::bigint);
  PERFORM pg_temp.s8f_eq('F2 five scope rows across those four households, and the two-event shape is '
    'what makes a cross-scope refusal mean something',
    (SELECT count(*) FROM public.household_event_scopes WHERE wedding_id = s.wed_a), 5::bigint);
  PERFORM pg_temp.s8f_eq('F3 one household is scoped to nothing — the zero-event case Stage 2 calls a '
    'data error to surface, which is only surfaceable if a fixture contains it',
    (SELECT count(*) FROM public.guest_households h
      WHERE h.wedding_id = s.wed_a
        AND NOT EXISTS (SELECT 1 FROM public.household_event_scopes s2
                         WHERE s2.household_id = h.id)), 1::bigint);
  PERFORM pg_temp.s8f_eq('F4 the wedding has three events and exactly one of them is switched off',
    (SELECT array_agg(e.enabled::text ORDER BY e.display_order)
       FROM public.wedding_events e WHERE e.wedding_id = s.wed_a),
    ARRAY['true','true','false']::text[]);
  PERFORM pg_temp.s8f_eq('F5 the host''s private note exists in the database, which is the only reason '
    'its absence from a guest answer later means anything',
    (SELECT host_notes FROM public.guest_households WHERE id = s.hh_chenna),
    'host-only: cousin needs a ride from the airport');
  PERFORM pg_temp.s8f_eq('F6 one household carries neither a salutation nor a party size — the fallback '
    'and the NULL are both real rows here, not hypotheticals',
    (SELECT ARRAY[h.salutation::text, h.expected_party_size::text] FROM public.guest_households h
      WHERE h.id = s.hh_nair), ARRAY[NULL, NULL]::text[]);
  PERFORM pg_temp.s8f_eq('F7 the stranger owns the other wedding, which is what makes group B a '
    'cross-tenant test rather than a test of a row nobody claims',
    (SELECT owner_user_id FROM public.weddings WHERE id = s.wed_b), s.owner_b);
  PERFORM pg_temp.s8f_eq('F8 the caller who owns three weddings does not own the fourth row of this '
    'fixture — the unpublished and the household-less weddings are needed for two different refusals',
    (SELECT count(*) FROM public.weddings WHERE owner_user_id = s.owner_a), 3::bigint);
  PERFORM pg_temp.s8f_eq('F9 the tested wedding has an active publication and exactly one, pinned to '
    'the first version — a household credential is pinned to this row by its own CHECK, so the '
    'fixture has to have one before anything mints',
    (SELECT array_agg((p.version_id = current_setting('s8f.v1')::uuid)::text)
       FROM public.publications p WHERE p.wedding_id = s.wed_a AND p.status = 'active'),
    '{true}');
  PERFORM pg_temp.s8f_eq('F10 and publishing left the two families'' own state alone: no household of '
    'this wedding has a credential yet, so every mint counted below is this battery''s doing',
    (SELECT count(*) FROM private.access_tokens t
      WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'), 0::bigint);
  PERFORM pg_temp.s8f_eq('F11 the wedding link the publish call handed back is 43 characters of the '
    'declared alphabet — the same generator, alphabet and storage as every other credential in this '
    'product, measured here once so the household assertions below can lean on it',
    (SELECT octet_length(current_setting('s8f.wed_raw'))), 43);
END $F$;

-- --------------------------------------------------------------------------- H: the send
-- Two households in one call, with the list written in the opposite order to the display names, so
-- that H4's ordering assertion is a claim about the verb rather than a coincidence of the cast.
DO $H$
DECLARE s s8r%ROWTYPE; v jsonb; w jsonb; raw_a text; raw_b text; raw_f text; raw_r text;
BEGIN
  SELECT * INTO s FROM s8r;

  v := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, ARRAY['
    || quote_literal(s.hh_baby::text) || '::uuid, ' || quote_literal(s.hh_chenna::text)
    || '::uuid], NULL)');

  PERFORM pg_temp.s8f_has_keys('H1 the answer names six things and no seventh — the wedding, the '
    'publication the links are pinned to, the two counts, the deadline policy and the list', v,
    ARRAY['already_live', 'expires_at', 'invitations', 'issued', 'publication_id', 'wedding_id']);
  PERFORM pg_temp.s8f_eq('H2 it reports the publication this wedding actually has, not a row the '
    'caller could have named', v ->> 'publication_id', current_setting('s8f.pub1'));
  PERFORM pg_temp.s8f_eq('H3 two households asked, two credentials minted, none already live',
    ARRAY[(v ->> 'issued')::text, (v ->> 'already_live')::text]::text[],
    ARRAY['2', '0']::text[]);
  PERFORM pg_temp.s8f_eq('H4 the list comes back ordered by display name, which is the order the host '
    'screen prints and the order `get_guest_invitation_state` uses, so a link can never be attributed '
    'to the wrong family between two reads of the same data. Position is read with ORDINALITY, because '
    'the claim is about the array the verb returned rather than about a set this file could re-sort',
    (SELECT array_agg(q.i ->> 'display_name' ORDER BY q.n)
       FROM jsonb_array_elements(v -> 'invitations') WITH ORDINALITY q(i, n)),
    ARRAY['Chennakrishna Iyer', 'The Baby family']);
  PERFORM pg_temp.s8f_eq('H5 and exactly two items, each with the four names it needs to be actionable',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'invitations') i), 2::bigint);
  PERFORM pg_temp.s8f_eq('H6 every item carries the same four keys and no fifth',
    (SELECT count(*) FROM jsonb_array_elements(v -> 'invitations') i
      WHERE NOT (pg_temp.s8f_top_keys(i) = pg_temp.s8f_sorted(
        ARRAY['display_name', 'household_id', 'path', 'status']))),
    0::bigint);

  raw_a := substr(v -> 'invitations' -> 0 ->> 'path', 4);
  raw_b := substr(v -> 'invitations' -> 1 ->> 'path', 4);
  PERFORM set_config('s8f.raw_chenna', raw_a, false);
  PERFORM set_config('s8f.raw_baby', raw_b, false);

  PERFORM pg_temp.s8f_ok('H7 both paths are /g/ followed by 43 characters of the URL-safe base64 '
    'alphabet, and the two families got different secrets — nothing else may be in a path, because the '
    'client route pastes it straight into an address bar',
    (v -> 'invitations' -> 0 ->> 'path') ~ '^/g/[A-Za-z0-9_-]{43}$'
    AND (v -> 'invitations' -> 1 ->> 'path') ~ '^/g/[A-Za-z0-9_-]{43}$'
    AND raw_a <> raw_b);
  PERFORM pg_temp.s8f_eq('H8 the row behind each path stores the SHA-256 of exactly that secret as 64 '
    'lowercase hex characters, and pairs it with the household the answer named — the digest is proved '
    'against the secret the caller was handed, not against a transcription of it',
    ARRAY[(SELECT t.token_hash FROM private.access_tokens t
            WHERE t.household_id = (v -> 'invitations' -> 0 ->> 'household_id')::uuid),
          (SELECT t.token_hash FROM private.access_tokens t
            WHERE t.household_id = (v -> 'invitations' -> 1 ->> 'household_id')::uuid)]::text[],
    ARRAY[encode(extensions.digest(convert_to(raw_a, 'UTF8'), 'sha256'), 'hex'),
          encode(extensions.digest(convert_to(raw_b, 'UTF8'), 'sha256'), 'hex')]);

  PERFORM pg_temp.s8f_eq('H9 every minted row is a household credential of this wedding, pinned to the '
    'active publication, with no approval pointer of any kind — the four facts the kind CHECK holds '
    'together, read back from the rows rather than from the call that wrote them',
    (SELECT count(*) FROM private.access_tokens t
      WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
        AND t.publication_id = current_setting('s8f.pub1')::uuid
        AND t.household_id IS NOT NULL
        AND t.approval_request_id IS NULL AND t.approval_version_id IS NULL),
    2::bigint);
  PERFORM pg_temp.s8f_eq('H10 with no expiry asked for, the policy says so rather than leaving a NULL '
    'to be interpreted — `expires_at IS NULL` is always a declared policy in this schema',
    (SELECT array_agg(t.expiry_policy ORDER BY t.household_id::text)
       FROM private.access_tokens t
      WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'),
    ARRAY['no_expiry', 'no_expiry']);
  PERFORM pg_temp.s8f_eq('H11 the answer''s `expires_at` reports the same NULL the rows carry, so a host '
    'screen cannot show a deadline the database does not',
    (v ->> 'expires_at') IS NULL, true);
  PERFORM pg_temp.s8f_ok('H12 a credential minted here resolves at the guest door, which is the only '
    'proof that the generator written twice in this migration is the same generator the door reads',
    (pg_temp.s8f_door(raw_a) -> 'available')::boolean);

  raw_f := 'ForgedLookalike' || repeat('0', 26) || 'zz';
  PERFORM pg_temp.s8f_eq('H13 and a string of the same shape that was never minted does not — the '
    'acceptance above is about the digest, not about the alphabet',
    (pg_temp.s8f_door(raw_f) -> 'available')::boolean, false);

  -- Re-running the same screen action must not be a way to read an old secret a second time, and
  -- must not be a way to make a second live secret for one family.
  w := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, ARRAY['
    || quote_literal(s.hh_baby::text) || '::uuid, ' || quote_literal(s.hh_chenna::text)
    || '::uuid, ' || quote_literal(s.hh_nair::text) || '::uuid], NULL)');
  PERFORM pg_temp.s8f_eq('H14 the second send mints only the family that had no link, and reports the '
    'two that did',
    ARRAY[(w ->> 'issued')::text, (w ->> 'already_live')::text]::text[],
    ARRAY['1', '2']::text[]);
  PERFORM pg_temp.s8f_eq('H15 an already-live item carries no path at all — a re-issued screen action '
    'cannot become a way to read a household''s secret again',
    (SELECT count(*) FROM jsonb_array_elements(w -> 'invitations') i
      WHERE (i ->> 'path') IS NOT NULL), 1::bigint);
  PERFORM pg_temp.s8f_eq('H16 and the answer distinguishes the three families by status alone, in the '
    'same display-name order: nothing about the credential the caller could not already derive from '
    'the household row is added',
    (SELECT array_agg(q.i ->> 'status' ORDER BY q.n)
       FROM jsonb_array_elements(w -> 'invitations') WITH ORDINALITY q(i, n)),
    ARRAY['already_live', 'already_live', 'issued']);
  PERFORM pg_temp.s8f_eq('H17 and the family that was already live still has exactly one live '
    'credential, which is the mint path not double-writing rather than the index catching it',
    (SELECT count(*) FROM private.access_tokens t
      WHERE t.household_id = s.hh_chenna AND t.revoked_at IS NULL), 1::bigint);
  PERFORM pg_temp.s8f_eq('H18 the same live credential still answers at the door, unreplaced',
    (pg_temp.s8f_door(raw_a) -> 'available')::boolean, true);
  PERFORM set_config('s8f.raw_nair',
    (SELECT substr(i ->> 'path', 4) FROM jsonb_array_elements(w -> 'invitations') i
      WHERE (i ->> 'path') IS NOT NULL), false);
  PERFORM pg_temp.s8f_ok('H19 the one item that did carry a path resolves too, so the second send is a '
    'working link for the family it claimed to give one, and not a row that only exists on the host''s '
    'screen',
    (pg_temp.s8f_door(current_setting('s8f.raw_nair')) -> 'available')::boolean);

  -- Duplicates are tolerated deliberately (the loop walks `guest_households`, so a family appears
  -- once however often its id was sent). This is asserted rather than assumed because the sentence
  -- in the migration is an argument about a query, and only the answer proves it.
  w := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, ARRAY['
    || quote_literal(s.hh_chenna::text) || '::uuid, ' || quote_literal(s.hh_chenna::text)
    || '::uuid, ' || quote_literal(s.hh_chenna::text) || '::uuid], NULL)');
  PERFORM pg_temp.s8f_eq('H20 three copies of one family''s id answer with one item and no new '
    'credential — the host screen re-sending a row is a retry, not an error about their own list',
    ARRAY[(SELECT count(*) FROM jsonb_array_elements(w -> 'invitations'))::text,
          (w ->> 'issued'), (w ->> 'already_live')]::text[],
    ARRAY['1', '0', '1']::text[]);

  -- A fixed deadline, given to the family rotation later carries: minted through the verb rather
  -- than written into the table, so the deadline under test is one the product produced.
  w := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, ARRAY['
    || quote_literal(s.hh_raman::text) || '::uuid], now() + interval ''30 days'')');
  raw_r := substr(w -> 'invitations' -> 0 ->> 'path', 4);
  PERFORM set_config('s8f.raw_raman', raw_r, false);
  PERFORM pg_temp.s8f_eq('H21 an explicit deadline is honoured to the instant and is reported back to '
    'the caller who set it',
    (SELECT ARRAY[t.expiry_policy, (t.expires_at = (w ->> 'expires_at')::timestamptz)::text]
       FROM private.access_tokens t WHERE t.household_id = s.hh_raman),
    ARRAY['fixed', 'true']);
  PERFORM pg_temp.s8f_eq('H22 the household with no event scope still gets a working link — the '
    'zero-event family is shown as invited to nothing, not silently skipped by the send',
    (pg_temp.s8f_door(raw_r) -> 'available')::boolean, true);

  PERFORM pg_temp.s8f_eq('H23 no raw credential from this group is anywhere in the database, and only '
    'its digest is — the scan covers every text column of every base table in both schemas the '
    'product owns, not only the one column these mints wrote',
    pg_temp.s8f_stored_hits(raw_a), '{}'::text[]);
  PERFORM pg_temp.s8f_eq('H24 the same holds for the family given a deadline, whose secret is therefore '
    'not recoverable from the row that carries its expiry',
    pg_temp.s8f_stored_hits(raw_r), '{}'::text[]);
  PERFORM pg_temp.s8f_eq('H25 and every credential in the whole store — every kind, not only the rows '
    'this battery minted — is recorded as 64 lowercase hex characters',
    (SELECT count(*) FROM private.access_tokens t
      WHERE t.token_hash !~ '^[0-9a-f]{64}$'), 0::bigint);
END $H$;

-- --------------------------------------------------------------------------- B: who may touch a link
-- The four host verbs are refused in four different places (the caller, the household, the
-- publication, the list), and the point of a group like this is that a caller learns the *place* only
-- when the place is their own. Every cross-boundary probe is answered with the same sentence a
-- nonexistent row gets, which is what stops a refusal being an enumeration oracle.
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('B1', 'a household of another wedding cannot be sent a link by this wedding''s host',
   $t$SELECT api.issue_guest_invitations(current_setting('s8f.wed_a')::uuid,
        ARRAY[current_setting('s8f.hh_stranger')::uuid], NULL)$t$,
   '42501', '%a household in this list is not a household of this wedding%'),
  ('B1', 'a household that does not exist at all is refused in exactly those words, not with a '
    'foreign-key detail that describes the database to a caller who was only refused',
   $t$SELECT api.issue_guest_invitations(current_setting('s8f.wed_a')::uuid,
        ARRAY[gen_random_uuid()], NULL)$t$,
   '42501', '%a household in this list is not a household of this wedding%'),
  ('B1', 'and a NULL id in the list is the same refusal — no household row can answer to it',
   $t$SELECT api.issue_guest_invitations(current_setting('s8f.wed_a')::uuid,
        ARRAY[NULL::uuid], NULL)$t$,
   '42501', '%a household in this list is not a household of this wedding%'),
  ('B2', 'an empty list is not a send',
   $t$SELECT api.issue_guest_invitations(current_setting('s8f.wed_a')::uuid,
        ARRAY[]::uuid[], NULL)$t$,
   '23514', '%choose the households you are inviting%'),
  ('B2', 'and neither is a NULL list',
   $t$SELECT api.issue_guest_invitations(current_setting('s8f.wed_a')::uuid, NULL, NULL)$t$,
   '23514', '%choose the households you are inviting%'),
  ('B2', 'the cap is two hundred, and it is measured before membership: 201 copies of one real '
    'household are refused for being 201, not for being a list this host could not have sent',
   $t$SELECT api.issue_guest_invitations(current_setting('s8f.wed_a')::uuid,
        array_fill(current_setting('s8f.hh_chenna')::uuid, ARRAY[201]), NULL)$t$,
   '23514', '%two hundred households is the most one request may carry%'),
  ('B3', 'a deadline in the past is refused — a link born dead is a bug dressed as a feature',
   $t$SELECT api.issue_guest_invitations(current_setting('s8f.wed_a')::uuid,
        ARRAY[current_setting('s8f.hh_chenna')::uuid], now() - interval '1 hour')$t$,
   '23514', '%a household link must be given a time in the future%'),
  ('B4', 'a wedding the caller does not own cannot be sent links, even with a household of that '
    'wedding named honestly',
   $t$SELECT api.issue_guest_invitations(current_setting('s8f.wed_b')::uuid,
        ARRAY[current_setting('s8f.hh_stranger')::uuid], NULL)$t$,
   '42501', '%the caller may not send invitations for this wedding%'),
  ('B4', 'a wedding that does not exist is the same refusal, not a different one',
   $t$SELECT api.issue_guest_invitations(gen_random_uuid(), ARRAY[gen_random_uuid()], NULL)$t$,
   '42501', '%the caller may not send invitations for this wedding%'),
  ('B5', '§3.1 Ruling 3.3: a wedding with a real household and no active publication is told to '
    'publish first, rather than being handed an empty success',
   $t$SELECT api.issue_guest_invitations(current_setting('s8f.wed_nopub')::uuid,
        ARRAY[current_setting('s8f.hh_nopub')::uuid], NULL)$t$,
   '23514', '%publish the invitation before sending household links%'),
  ('B6', 'rotating a household of a wedding that has nothing published is refused before the '
    'household''s own link state is looked at',
   $t$SELECT api.rotate_guest_invitation(current_setting('s8f.hh_nopub')::uuid)$t$,
   '23514', '%there is no published invitation to rotate%');

INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('B7', 'withdrawing a household of another wedding is one sentence for "not yours" and "no such '
    'household", so a poke cannot enumerate families',
   $t$SELECT api.revoke_guest_invitation(current_setting('s8f.hh_stranger')::uuid)$t$,
   '42501', '%the caller may not withdraw this household''s link%'),
  ('B7', 'and a household that does not exist gets the identical answer',
   $t$SELECT api.revoke_guest_invitation(gen_random_uuid())$t$,
   '42501', '%the caller may not withdraw this household''s link%'),
  ('B7', 'with no name at all the refusal is a different one, and it is the half the host screen can '
    'act on: the verb says a household was not named rather than pretending the caller was refused a '
    'family',
   $t$SELECT api.revoke_guest_invitation(NULL)$t$,
   '23514', '%name the household whose link you are withdrawing%'),
  ('B8', 'rotating another wedding''s household is refused',
   $t$SELECT api.rotate_guest_invitation(current_setting('s8f.hh_stranger')::uuid)$t$,
   '42501', '%the caller may not rotate this household''s link%'),
  ('B8', 'and a household that does not exist is the same refusal',
   $t$SELECT api.rotate_guest_invitation(gen_random_uuid())$t$,
   '42501', '%the caller may not rotate this household''s link%'),
  ('B8', 'rotating nothing is named as nothing',
   $t$SELECT api.rotate_guest_invitation(NULL)$t$,
   '23514', '%name the household whose link you are replacing%'),
  ('B9', 'reading another wedding''s guest list is refused',
   $t$SELECT api.get_guest_invitation_state(current_setting('s8f.wed_b')::uuid)$t$,
   '42501', '%the caller may not read this wedding%'),
  ('B9', 'a wedding that does not exist is the same refusal',
   $t$SELECT api.get_guest_invitation_state(gen_random_uuid())$t$,
   '42501', '%the caller may not read this wedding%'),
  ('B9', 'and a wedding named as NULL is the same refusal again, not a full-table read',
   $t$SELECT api.get_guest_invitation_state(NULL)$t$,
   '42501', '%the caller may not read this wedding%');

-- The signed-out and anonymous halves. `test.uid` empty is the shape of a request that carried no
-- JWT; `anon` is the shape of a request that carried none and was not even pretending.
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('B10', 'signed out: no send',
   $t$SELECT api.issue_guest_invitations(current_setting('s8f.wed_a')::uuid,
        ARRAY[current_setting('s8f.hh_chenna')::uuid], NULL)$t$,
   '42501', '%the caller may not send invitations for this wedding%'),
  ('B10', 'signed out: no withdrawal',
   $t$SELECT api.revoke_guest_invitation(current_setting('s8f.hh_chenna')::uuid)$t$,
   '42501', '%the caller may not withdraw this household''s link%'),
  ('B10', 'signed out: no rotation',
   $t$SELECT api.rotate_guest_invitation(current_setting('s8f.hh_chenna')::uuid)$t$,
   '42501', '%the caller may not rotate this household''s link%'),
  ('B10', 'signed out: no read of the guest list',
   $t$SELECT api.get_guest_invitation_state(current_setting('s8f.wed_a')::uuid)$t$,
   '42501', '%the caller may not read this wedding%'),
  ('B11', '§8: an anonymous caller has no EXECUTE on the send',
   $t$SELECT api.issue_guest_invitations(current_setting('s8f.wed_a')::uuid,
        ARRAY[current_setting('s8f.hh_chenna')::uuid], NULL)$t$,
   '42501', '%permission denied for function issue_guest_invitations%'),
  ('B11', 'nor on withdrawal',
   $t$SELECT api.revoke_guest_invitation(current_setting('s8f.hh_chenna')::uuid)$t$,
   '42501', '%permission denied for function revoke_guest_invitation%'),
  ('B11', 'nor on rotation',
   $t$SELECT api.rotate_guest_invitation(current_setting('s8f.hh_chenna')::uuid)$t$,
   '42501', '%permission denied for function rotate_guest_invitation%'),
  ('B11', 'nor on the guest-list read',
   $t$SELECT api.get_guest_invitation_state(current_setting('s8f.wed_a')::uuid)$t$,
   '42501', '%permission denied for function get_guest_invitation_state%'),
  ('B12', '§9: service_role is not a browser and has no path through `api`',
   $t$SELECT api.issue_guest_invitations(current_setting('s8f.wed_a')::uuid,
        ARRAY[current_setting('s8f.hh_chenna')::uuid], NULL)$t$,
   '42501', '%permission denied for schema api%'),
  ('B12', '§9: nor through `internal_api` — the privileged half is not a service surface either',
   $t$SELECT internal_api.revoke_guest_invitation(current_setting('s8f.hh_chenna')::uuid)$t$,
   '42501', '%permission denied for schema internal_api%');

DO $B$
DECLARE s s8r%ROWTYPE; v jsonb; n_before bigint; h_before bigint;
BEGIN
  SELECT * INTO s FROM s8r;
  n_before := (SELECT count(*) FROM private.access_tokens
                WHERE token_kind = 'guest_invitation');
  h_before := (SELECT count(*) FROM public.guest_households);

  PERFORM pg_temp.s8f_run('B1',  'authenticated', s.owner_a::text);
  PERFORM pg_temp.s8f_run('B2',  'authenticated', s.owner_a::text);
  PERFORM pg_temp.s8f_run('B3',  'authenticated', s.owner_a::text);
  PERFORM pg_temp.s8f_run('B4',  'authenticated', s.owner_a::text);
  PERFORM pg_temp.s8f_run('B5',  'authenticated', s.owner_a::text);
  PERFORM pg_temp.s8f_run('B6',  'authenticated', s.owner_a::text);
  PERFORM pg_temp.s8f_run('B7',  'authenticated', s.owner_a::text);
  PERFORM pg_temp.s8f_run('B8',  'authenticated', s.owner_a::text);
  PERFORM pg_temp.s8f_run('B9',  'authenticated', s.owner_a::text);
  PERFORM pg_temp.s8f_run('B10', 'authenticated', '');
  PERFORM pg_temp.s8f_run('B11', 'anon',          s.owner_a::text);
  PERFORM pg_temp.s8f_run('B12', 'service_role',  NULL);

  -- The cap's other edge, measured as an acceptance because `run()` is a refusal instrument: 201 ids
  -- are refused, 200 of the same real household are not, and the answer is one item. A cap that only
  -- ever refused would have been a smaller number dressed as two hundred.
  v := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, '
    || 'array_fill(' || quote_literal(s.hh_chenna::text) || '::uuid, ARRAY[200]), NULL)');
  PERFORM pg_temp.s8f_eq('B13 two hundred ids of one household are accepted as one already-live item, '
    'so the bound is a bound and the duplicate-tolerating loop is what makes it survivable',
    ARRAY[jsonb_array_length(v -> 'invitations')::text, (v ->> 'issued'),
          (v ->> 'already_live')]::text[],
    ARRAY['1', '0', '1']::text[]);

  PERFORM pg_temp.s8f_eq('B14 thirty refusals were declared in this group and thirty were measured — the '
    'census of the probe table at this point in the file, so a group that stopped running would move this '
    'number instead of passing quietly. The twelve groups are B1 3, B2 3, B3 1, B4 2, B5 1, B6 1, B7 3, '
    'B8 3, B9 3, B10 4, B11 4 and B12 2, and that list, not the number, is what was counted. Group Z '
    'reads the final total.',
    (SELECT count(*) FROM probes), 30::bigint);
  PERFORM pg_temp.s8f_eq('B15 and not one credential was written by any of them: every refusal happens '
    'before the loop that mints, so a rejected send leaves no trace',
    (SELECT count(*) FROM private.access_tokens
      WHERE token_kind = 'guest_invitation'), n_before);
  PERFORM pg_temp.s8f_eq('B16 nor one household created or changed: a refused send cannot become a way '
    'to write a guest list',
    (SELECT count(*) FROM public.guest_households), h_before);
  PERFORM pg_temp.s8f_eq('B17 the caller refused another family''s wedding could not read that family''s '
    'wedding row either — the verb and RLS give the same answer',
    pg_temp.s8f_visible('authenticated', s.owner_a,
      'SELECT * FROM public.weddings WHERE id = ' || quote_literal(s.wed_b::text)), 0::bigint);
  PERFORM pg_temp.s8f_eq('B18 and the stranger sees none of the tested wedding''s households, while still '
    'seeing the one household of the wedding they do own — the host verbs are not the only wall, RLS is, '
    'and the second half is what proves the first is a policy rather than a blanket denial. The unscoped '
    'form of this claim could not be true: groups B1, B4, B7 and B8 all refuse against a real household '
    'of the stranger''s own wedding, so that row exists to be read by its host',
    ARRAY[pg_temp.s8f_visible('authenticated', s.owner_b,
      'SELECT * FROM public.guest_households WHERE wedding_id = '
      || quote_literal(s.wed_a::text))::text,
      pg_temp.s8f_visible('authenticated', s.owner_b,
      'SELECT * FROM public.guest_households WHERE wedding_id = '
      || quote_literal(s.wed_b::text))::text]::text[],
    ARRAY['0', '1']::text[]);
  -- `<= 0`, not `= -1`: a relation-level privilege refusal and an RLS-denied empty read are both
  -- invisibility, and which of the two a given role gets is a fact about the grant inventory that
  -- group G pins by name. What would be a defect is a positive count, so that is what is refused here.
  PERFORM pg_temp.s8f_ok('B19 and no browser role reaches the credential table at all, whether by a '
    'refused relation or by an empty read — which is why the host''s link state has to be an RPC '
    'instead of a client query',
    pg_temp.s8f_visible('authenticated', s.owner_b, 'SELECT * FROM private.access_tokens') <= 0);
  PERFORM pg_temp.s8f_ok('B20 the same for an anonymous caller, the role every guest is',
    pg_temp.s8f_visible('anon', NULL, 'SELECT * FROM private.access_tokens') <= 0);
END $B$;

-- --------------------------------------------------------------------------- W: one live link per family
-- `issue_guest_invitations` refuses to double-mint by *reading* first — `FOR UPDATE` on the household's
-- live row, then a `already_live` item instead of a second secret. Group H measured that behaviour.
-- This group measures the thing that makes it a guarantee rather than a habit: the partial unique index
-- written next to it. A test of a table-level rule has to write at the table, which no client role may
-- do (`20260925120400...:183-186`), so this group runs as the owner and says so in every label — the
-- claim is the index, not a product path, and nothing here pretends to be a screen action.
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('W1', '§10: a second live credential for one family is refused by the index''s own name, so a bug in '
    'the host path surfaces as a duplicate key inside a battery rather than as two working secrets that '
    'no screen can list and no one can revoke as a pair',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id,
        household_id, expiry_policy)
     SELECT encode(extensions.digest(convert_to('s8-w-double-mint', 'UTF8'), 'sha256'), 'hex'),
            'guest_invitation', current_setting('s8f.wed_a')::uuid,
            current_setting('s8f.pub1')::uuid, current_setting('s8f.hh_baby')::uuid, 'no_expiry'$t$,
   '23505', '%duplicate key value violates unique constraint "one_live_guest_token_per_household"%');

DO $W$
DECLARE s s8r%ROWTYPE; raw_prev text; raw_succ text; hash_succ text; hash_rsvp text;
BEGIN
  SELECT * INTO s FROM s8r;
  raw_prev := current_setting('s8f.raw_baby');

  PERFORM pg_temp.s8f_run('W1', 'postgres', NULL);

  PERFORM pg_temp.s8f_eq('W2 and the refusal changed nothing: the family still has exactly one live '
    'household credential, which is the one group H minted — a rejected write that leaves the store '
    'untouched is the whole value of a constraint at this level',
    (SELECT count(*) FROM private.access_tokens t
      WHERE t.household_id = s.hh_baby AND t.token_kind = 'guest_invitation'
        AND t.revoked_at IS NULL), 1::bigint);

  -- The other half of a *partial* index: what it does not cover. `rsvp` is the household-scoped kind
  -- this schema leaves unused (design Ruling 2.2), and the index says nothing about it, so a live row
  -- of that kind beside a live guest row is the shape that proves the predicate is `token_kind =
  -- 'guest_invitation'` rather than "one row per household". Written and then removed, because leaving
  -- an unused-vocabulary row in the store would make every count in the groups below a count of two
  -- different things.
  hash_rsvp := encode(extensions.digest(convert_to('s8-w-rsvp-kind', 'UTF8'), 'sha256'), 'hex');
  EXECUTE 'INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, '
    || 'household_id, expiry_policy) VALUES (' || quote_literal(hash_rsvp) || ', ''rsvp'', '
    || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s8f.pub1')) || '::uuid, '
    || quote_literal(s.hh_baby::text) || '::uuid, ''no_expiry'')';
  PERFORM pg_temp.s8f_eq('W3 a live row of the *other* household kind for the same family is accepted, '
    'so the index constrains one kind rather than the table',
    (SELECT count(*) FROM private.access_tokens t
      WHERE t.household_id = s.hh_baby AND t.revoked_at IS NULL), 2::bigint);
  DELETE FROM private.access_tokens WHERE token_hash = hash_rsvp;
  PERFORM pg_temp.s8f_eq('W4 and that probe row is gone again, so every count below this line is the '
    'product''s own credentials plus the one successor W6 writes',
    (SELECT count(*) FROM private.access_tokens WHERE token_hash = hash_rsvp), 0::bigint);

  -- One-live, not one-ever: retirement by the same rule has to open the slot again, or rotation (group
  -- R) could not mint a successor at all. No product verb produces this intermediate shape — withdraw
  -- also closes nothing here, and rotate does both halves in one call — so the retirement is written by
  -- hand, which is the same instrument Stage 7's group O used for the same reason.
  UPDATE private.access_tokens SET revoked_at = now()
   WHERE household_id = s.hh_baby AND token_kind = 'guest_invitation' AND revoked_at IS NULL;
  PERFORM pg_temp.s8f_eq('W5 the hand-retired family now has no live credential, so the slot W1 refused '
    'to double is genuinely empty rather than occupied by a row the index happens to ignore',
    (SELECT count(*) FROM private.access_tokens t
      WHERE t.household_id = s.hh_baby AND t.token_kind = 'guest_invitation'
        AND t.revoked_at IS NULL), 0::bigint);

  raw_succ := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  hash_succ := encode(extensions.digest(convert_to(raw_succ, 'UTF8'), 'sha256'), 'hex');
  EXECUTE 'INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, '
    || 'household_id, expiry_policy) VALUES (' || quote_literal(hash_succ) || ', ''guest_invitation'', '
    || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s8f.pub1')) || '::uuid, '
    || quote_literal(s.hh_baby::text) || '::uuid, ''no_expiry'')';
  PERFORM pg_temp.s8f_eq('W6 once the first is retired the successor is accepted, which is what makes '
    'this a one-live rule and not a one-ever rule',
    (SELECT count(*) FROM private.access_tokens t
      WHERE t.household_id = s.hh_baby AND t.token_kind = 'guest_invitation'
        AND t.revoked_at IS NULL), 1::bigint);

  -- The successor has to satisfy the door's own shape filter before its acceptance at the door means
  -- anything: a secret of the wrong length would be refused for a reason that has nothing to do with
  -- the index. Measured first so W7 and W8 below are claims about liveness.
  PERFORM pg_temp.s8f_ok('W7 the hand-minted successor is 43 characters of the URL-safe alphabet, so '
    'the door cannot refuse it for a reason unrelated to the fact under test',
    octet_length(raw_succ) = 43 AND raw_succ ~ '^[A-Za-z0-9_-]+$');
  PERFORM pg_temp.s8f_ok('W8 and it resolves at the guest door as the family it names — the row is a '
    'working credential, and the index slot it filled is the one the door reads',
    (pg_temp.s8f_door(raw_succ) -> 'available')::boolean
    AND (pg_temp.s8f_door(raw_succ) -> 'guest' ->> 'household_id')::uuid = s.hh_baby);
  PERFORM pg_temp.s8f_eq('W9 while the credential it replaced is refused at the same door with the same '
    'closed shape a forgery gets — retiring a link is not a distinguishable answer to its holder',
    (pg_temp.s8f_door(raw_prev) -> 'available')::boolean, false);

  PERFORM set_config('s8f.raw_baby', raw_succ, false);
  PERFORM set_config('s8f.raw_baby_retired', raw_prev, false);
  PERFORM pg_temp.s8f_eq('W10 the live secret groups R and T read is therefore this successor, and the '
    'retired one is kept under its own name — a fixture-state assertion, because a later group silently '
    'reading the retired value would fail for the wrong reason',
    ARRAY[current_setting('s8f.raw_baby'), current_setting('s8f.raw_baby_retired')]::text[],
    ARRAY[raw_succ, raw_prev]::text[]);

  PERFORM pg_temp.s8f_eq('W11 §10: the enforcing object is an index, unique and partial in exactly the '
    'three ways the claim needs — only live rows, only this kind, only rows that name a household — so '
    'it constrains nothing else in the credential store',
    (SELECT d LIKE 'CREATE UNIQUE INDEX%' AND d LIKE '%(household_id)%' AND d LIKE '%WHERE%'
            AND d LIKE '%(revoked_at IS NULL)%' AND d LIKE '%guest_invitation%'
            AND d LIKE '%(household_id IS NOT NULL)%'
       FROM (SELECT pg_get_indexdef(c.oid) AS d
               FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
              WHERE c.relname = 'one_live_guest_token_per_household') x), true);
  PERFORM pg_temp.s8f_eq('W12 and it is keyed on one column, which is the difference between this rule '
    'and the wedding-scoped pair (`(wedding_id, household_id)` would let two families of one wedding '
    'share a slot)',
    (SELECT i.indnatts::int FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
      WHERE c.relname = 'one_live_guest_token_per_household'), 1);
  PERFORM pg_temp.s8f_eq('W13 and no table constraint of that name exists — the rule is enforced by the '
    'index alone, which is what a reader who looks in `pg_constraint` for it needs to be told',
    (SELECT count(*) FROM pg_constraint WHERE conname = 'one_live_guest_token_per_household'),
    0::bigint);
  PERFORM pg_temp.s8f_eq('W14 §I10: and the successor secret is in no stored column anywhere, only its '
    'digest is — the hand-minted row is held to the same rule as the verb-minted ones',
    pg_temp.s8f_stored_hits(raw_succ), '{}'::text[]);
END $W$;

-- --------------------------------------------------------------------------- S: the tightened kind CHECK
-- Section 1 of the migration replaces one named CHECK, and the reason it gives is a latent gap: the two
-- household arms said `approval_request_id IS NULL` and were silent about `approval_version_id`, while
-- the wedding arm said both. Under `MATCH SIMPLE` FK semantics a household credential could therefore
-- carry a pointer into a family's approval *version* with nothing to catch it — the cross-family state
-- the directive forbids. Nothing that exists can write such a row, so the only way to measure the closed
-- arm is to try, as the owner, with `revoked_at` set on every probe row so the partial index of group W
-- cannot be the thing that answers. Every refusal below is therefore pinned to the constraint's name.
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('S1', '§1: a household credential carrying an approval version pointer is refused by the constraint '
    'Stage 8 tightened — the arm that was open at the previous head. `revoked_at` is set on every probe '
    'row in this group so group W''s partial index cannot be the thing that answers',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id,
        household_id, approval_version_id, expiry_policy, revoked_at)
     SELECT encode(extensions.digest(convert_to('s8-s-guest-version', 'UTF8'), 'sha256'), 'hex'),
            'guest_invitation', current_setting('s8f.wed_a')::uuid,
            current_setting('s8f.pub1')::uuid, current_setting('s8f.hh_chenna')::uuid,
            current_setting('s8f.v1')::uuid, 'no_expiry', now()$t$,
   '23514', '%violates check constraint "access_tokens_kind_shape"%'),
  ('S1', 'and the same pointer on the other household kind, which the same sentence tightened for the '
    'same reason even though no verb reaches it',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id,
        household_id, approval_version_id, expiry_policy, revoked_at)
     SELECT encode(extensions.digest(convert_to('s8-s-rsvp-version', 'UTF8'), 'sha256'), 'hex'),
            'rsvp', current_setting('s8f.wed_a')::uuid,
            current_setting('s8f.pub1')::uuid, current_setting('s8f.hh_chenna')::uuid,
            current_setting('s8f.v1')::uuid, 'no_expiry', now()$t$,
   '23514', '%violates check constraint "access_tokens_kind_shape"%'),
  ('S1', 'a household credential naming no household is refused — an arm this file reproduced rather '
    'than invented, measured to prove the reproduction still bites',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id,
        household_id, expiry_policy, revoked_at)
     SELECT encode(extensions.digest(convert_to('s8-s-guest-nohousehold', 'UTF8'), 'sha256'), 'hex'),
            'guest_invitation', current_setting('s8f.wed_a')::uuid,
            current_setting('s8f.pub1')::uuid, NULL, 'no_expiry', now()$t$,
   '23514', '%violates check constraint "access_tokens_kind_shape"%'),
  ('S1', 'a household credential naming an approval request is refused by the term Stage 2 already had, '
    'which is the sentence the new one was extended from — and the composite foreign key cannot be the '
    'author of this refusal, because `approval_version_id` is NULL and `MATCH SIMPLE` leaves the key '
    'unenforced on such a row',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id,
        household_id, approval_request_id, expiry_policy, revoked_at)
     SELECT encode(extensions.digest(convert_to('s8-s-guest-request', 'UTF8'), 'sha256'), 'hex'),
            'guest_invitation', current_setting('s8f.wed_a')::uuid,
            current_setting('s8f.pub1')::uuid, current_setting('s8f.hh_chenna')::uuid,
            gen_random_uuid(), 'no_expiry', now()$t$,
   '23514', '%violates check constraint "access_tokens_kind_shape"%'),
  ('S1', 'and the wedding-scoped arm is unchanged: a public link that names a household is refused by '
    'the same constraint, which is the pair of arms the tightening had to leave word for word',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id,
        household_id, expiry_policy, revoked_at)
     SELECT encode(extensions.digest(convert_to('s8-s-public-household', 'UTF8'), 'sha256'), 'hex'),
            'public_invitation', current_setting('s8f.wed_a')::uuid,
            current_setting('s8f.pub1')::uuid, current_setting('s8f.hh_chenna')::uuid,
            'no_expiry', now()$t$,
   '23514', '%violates check constraint "access_tokens_kind_shape"%');

DO $S$
DECLARE s s8r%ROWTYPE; hash_ok text; def text;
BEGIN
  SELECT * INTO s FROM s8r;

  PERFORM pg_temp.s8f_run('S1', 'postgres', NULL);

  -- The five refusals above mean nothing unless the row shape *without* the pointer is accepted —
  -- otherwise the fixture, not the constraint, would be doing the refusing. Same household, same
  -- publication, same retired-by-hand posture, one column less.
  hash_ok := encode(extensions.digest(convert_to('s8-s-control', 'UTF8'), 'sha256'), 'hex');
  EXECUTE 'INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id, '
    || 'household_id, expiry_policy, revoked_at) VALUES (' || quote_literal(hash_ok)
    || ', ''guest_invitation'', ' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s8f.pub1')) || '::uuid, '
    || quote_literal(s.hh_chenna::text) || '::uuid, ''no_expiry'', now())';
  PERFORM pg_temp.s8f_eq('S2 the identical row minus the approval pointer is accepted, so the refusal '
    'above is the pointer and not the fixture',
    (SELECT count(*) FROM private.access_tokens t WHERE t.token_hash = hash_ok), 1::bigint);
  PERFORM pg_temp.s8f_eq('S3 and it is history rather than a second door: that family still has exactly '
    'one live credential after the control row lands',
    (SELECT count(*) FROM private.access_tokens t
      WHERE t.household_id = s.hh_chenna AND t.token_kind = 'guest_invitation'
        AND t.revoked_at IS NULL), 1::bigint);
  DELETE FROM private.access_tokens WHERE token_hash = hash_ok;
  PERFORM pg_temp.s8f_eq('S4 and the control row is removed, so the census in groups T and Z counts only '
    'credentials the product''s own verbs produced',
    (SELECT count(*) FROM private.access_tokens WHERE token_hash = hash_ok), 0::bigint);

  -- What the tightening actually added, read out of the catalog rather than inferred from the five
  -- refusals: three arms now carry the term, and the two arms that always named a household still
  -- say so in the same words.
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'access_tokens_kind_shape'
     AND conrelid = 'private.access_tokens'::regclass;
  PERFORM pg_temp.s8f_eq('S5 §1: the constraint now states `approval_version_id IS NULL` exactly three '
    'times — the wedding arm that always had it, plus the two household arms this file closed. A fourth '
    'would mean the approval arm lost its own term; a second would mean one household arm is still open',
    (SELECT count(*) FROM regexp_matches(def, 'approval_version_id IS NULL', 'g')), 3::bigint);
  PERFORM pg_temp.s8f_eq('S6 and the household vocabulary is intact in both directions: two arms name a '
    'household and two forbid one, which is the reproduction the migration promised was word for word',
    ARRAY[(SELECT count(*) FROM regexp_matches(def, 'household_id IS NOT NULL', 'g'))::text,
          (SELECT count(*) FROM regexp_matches(def, 'household_id IS NULL', 'g'))::text]::text[],
    ARRAY['2', '2']::text[]);
  PERFORM pg_temp.s8f_eq('S7 and the approval arm still demands both of its pointers, which is the arm '
    'a household row was being smuggled alongside',
    (def LIKE '%approval_request_id IS NOT NULL%' AND def LIKE '%approval_version_id IS NOT NULL%'),
    true);

  -- The drop was by name, so the sibling rules have to still be there under their own names. If this
  -- file had dropped the wrong constraint the vocabulary CHECK would be gone and every kind in the
  -- alphabet would be legal; that is a silent failure a refusal-based group cannot see.
  PERFORM pg_temp.s8f_eq('S8 the two constraints Stage 2 and Stage 3 left beside this one are still '
    'present under the names this head measures: the kind vocabulary is enforced and the positional '
    'name the old CASE had is gone, so exactly one shape rule governs the table',
    ARRAY[
      (SELECT count(*) FROM pg_constraint WHERE conname = 'access_tokens_token_kind_check'
         AND conrelid = 'private.access_tokens'::regclass)::text,
      (SELECT count(*) FROM pg_constraint WHERE conname = 'access_tokens_check3'
         AND conrelid = 'private.access_tokens'::regclass)::text,
      (SELECT count(*) FROM pg_constraint WHERE conname = 'access_tokens_kind_shape'
         AND conrelid = 'private.access_tokens'::regclass)::text]::text[],
    ARRAY['1', '0', '1']::text[]);
  PERFORM pg_temp.s8f_ok('S9 and the replacement was validated against the rows that already existed, '
    'which is the safety claim section 1 makes about empty guest tables being checked rather than argued',
    (SELECT convalidated FROM pg_constraint WHERE conname = 'access_tokens_kind_shape'
       AND conrelid = 'private.access_tokens'::regclass));
  PERFORM pg_temp.s8f_eq('S10 and after every mint, rotation and probe in this file no household-scoped '
    'credential in the store carries an approval pointer of either kind — the gap has no live instance, '
    'not merely a rule against it',
    (SELECT count(*) FROM private.access_tokens t
      WHERE t.token_kind IN ('guest_invitation', 'rsvp')
        AND (t.approval_version_id IS NOT NULL OR t.approval_request_id IS NOT NULL)), 0::bigint);
END $S$;

-- --------------------------------------------------------------------------- A: an expiry, by moving the clock
-- Waiting is not available inside one transaction, and a fixture that faked `now()` would be measuring
-- its own lie. So the credential's own two timestamps move, and the first attempt is deliberately wrong:
-- moving only `expires_at` trips the schema's `expires_at > created_at` rule — the database refusing a
-- sloppy fixture. That refusal is asserted rather than quietly worked around, because every expiry claim
-- below is only meaningful if the row really is in the past.
--
-- The subject is the Raman family, the one household group H minted with an explicit deadline. Its
-- `last_used_at` was already written by the successful door read at H22, which is what makes A5 a claim
-- about a host's signal being unpoisonable rather than about a NULL staying a NULL.
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('A1', 'one end of a credential''s life cannot be moved into the past on its own — a link may not die '
    'before it was born, which is exactly what a careless expiry fixture would write',
   $t$UPDATE private.access_tokens SET expires_at = now() - interval '1 hour'
      WHERE household_id = current_setting('s8f.hh_raman')::uuid AND revoked_at IS NULL$t$,
   '23514', '%violates check constraint%');

DO $A$
DECLARE s s8r%ROWTYPE; v jsonb; used_before text; expires_before timestamptz;
BEGIN
  SELECT * INTO s FROM s8r;
  SELECT t.last_used_at::text, t.expires_at INTO used_before, expires_before
    FROM private.access_tokens t
   WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL;
  PERFORM pg_temp.s8f_ok('A0 the deadline this group ages was still in the future and the credential had '
    'been used once — the two facts A2 and A5 then read as unchanged, which is only a claim if they were '
    'settable in the first place',
    expires_before > now() AND used_before IS NOT NULL);

  PERFORM pg_temp.s8f_run('A1', 'postgres', NULL);

  PERFORM pg_temp.s8f_eq('A2 the refused edit changed nothing: the family''s deadline is still the exact '
    'instant group H set, and still in the future',
    (SELECT t.expires_at = expires_before AND t.expires_at > now() FROM private.access_tokens t
      WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL), true);

  UPDATE private.access_tokens
     SET created_at = now() - interval '31 days',
         expires_at = now() - interval '1 hour'
   WHERE household_id = s.hh_raman AND revoked_at IS NULL;

  PERFORM pg_temp.s8f_eq('A3 with both ends moved the credential is genuinely in the past — the state in '
    'which every refusal below is about expiry rather than about this file',
    (SELECT t.expires_at < now() AND t.created_at < now() - interval '30 days'
       FROM private.access_tokens t WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL), true);
  PERFORM pg_temp.s8f_eq('A4 the guest door refuses an expired household link in the one closed shape, '
    'byte-identical to the answer a never-minted forgery gets at H13 — a stale link does not tell its '
    'holder that it expired rather than never having existed',
    pg_temp.s8f_door(current_setting('s8f.raw_raman')), '{"available": false}'::jsonb);
  PERFORM pg_temp.s8f_eq('A5 and the refused read left `last_used_at` exactly where the successful one '
    'put it: somebody probing the door with an aged family''s secret cannot move the host''s "has this '
    'family opened the invitation" signal',
    (SELECT t.last_used_at::text FROM private.access_tokens t
      WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL), used_before);
  PERFORM pg_temp.s8f_eq('A6 ageing is not withdrawal — the row is still unrevoked, so the two facts stay '
    'separable columns and a host screen can tell "this link died of time" from "I took this link away"',
    (SELECT t.revoked_at IS NULL FROM private.access_tokens t
      WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL), true);
  PERFORM pg_temp.s8f_eq('A7 and the expired credential was not deleted for being refused: the store '
    'still holds exactly one row for it, found by its digest rather than by a pointer this file carries',
    cardinality(pg_temp.s8f_token(current_setting('s8f.raw_raman')))::bigint, 1::bigint);
  PERFORM pg_temp.s8f_eq('A8 that row reads back as the policy it was minted with and no revocation',
    (SELECT array_agg(t.expiry_policy || '|revoked=' || coalesce(t.revoked_at::text, '-'))
       FROM private.access_tokens t WHERE t.household_id = s.hh_raman),
    ARRAY['fixed|revoked=-']::text[]);

  v := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM pg_temp.s8f_eq('A9 §3.4: the host''s own read says the single word `expired` for that family '
    'and reports the aged instant rather than hiding it, so the door and the screen use one vocabulary',
    ARRAY[(SELECT e ->> 'link_state' FROM jsonb_array_elements(v) e
            WHERE (e ->> 'household_id')::uuid = s.hh_raman),
          (SELECT ((e ->> 'link_expires_at')::timestamptz
                   = (SELECT t.expires_at FROM private.access_tokens t
                       WHERE t.household_id = s.hh_raman))::text
             FROM jsonb_array_elements(v) e
            WHERE (e ->> 'household_id')::uuid = s.hh_raman)]::text[],
    ARRAY['expired', 'true']::text[]);
  PERFORM pg_temp.s8f_ok('A10 while the families with no deadline are untouched by this — an expiry is a '
    'fact about one credential, not a way to take a wedding down, and the Nair link still resolves',
    (pg_temp.s8f_door(current_setting('s8f.raw_nair')) -> 'available')::boolean);
END $A$;

-- --------------------------------------------------------------------------- R: §3.2 withdraw, §3.3 rotate
-- Two verbs whose difference is the point. Withdrawal answers whether there was anything to withdraw and
-- leaves the family, its scope and its answers exactly where they were; rotation retires a secret and
-- mints its replacement in one transaction, carrying the deadline the host set. The order below is
-- deliberate: the rotate refusal on an expired link (the repair in audit §8) is measured while that row
-- is still unrevoked, because after withdrawal the same call would be refused for a different and quite
-- correct reason.
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('R1', '§3.3: a family whose link was withdrawn has no live secret to replace, and that is a fact about '
    'the caller''s own wedding, so it is told to them in words rather than answered with the boundary '
    'sentence a stranger gets',
   $t$SELECT api.rotate_guest_invitation(current_setting('s8f.hh_chenna')::uuid)$t$,
   'P0001', '%this household has no live link to rotate%'),
  ('R2', '§3.3/audit §8: a link whose deadline has already passed cannot be rotated, because the '
    'successor would have to be born before its own expiry. Before the repair this was a 23514 from a '
    'constraint the host has never seen, raised after the row had been selected FOR UPDATE — so the '
    'wanted answer here is the actionable sentence, and the SQLSTATE being P0001 rather than 23514 is '
    'half of what this probe measures',
   $t$SELECT api.rotate_guest_invitation(current_setting('s8f.hh_raman')::uuid)$t$,
   'P0001', '%link has already expired; withdraw it and send a new one%');

DO $R$
DECLARE s s8r%ROWTYPE; v jsonb; w jsonb; n_rows bigint; raw_old text; raw_new text;
        revoked_at_1 timestamptz; expires_before timestamptz;
BEGIN
  SELECT * INTO s FROM s8r;

  -- Withdraw, once.
  v := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.revoke_guest_invitation(' || quote_literal(s.hh_chenna::text) || '::uuid)');
  PERFORM pg_temp.s8f_has_keys('R1 the withdrawal answer names four things and no fifth: the family, '
    'whether there was anything to withdraw, how many credentials it retired, and when', v,
    ARRAY['credentials_revoked', 'household_id', 'revoked', 'revoked_at']);
  PERFORM pg_temp.s8f_eq('R2 the first withdrawal reports the one credential group H minted and stamps '
    'it with an instant it can name',
    ARRAY[(v ->> 'revoked'), (v ->> 'credentials_revoked'),
          ((v ->> 'revoked_at') IS NOT NULL)::text]::text[],
    ARRAY['true', '1', 'true']::text[]);
  PERFORM pg_temp.s8f_eq('R3 and the instant it reports is the instant the row carries, to the '
    'microsecond — the value is reported back rather than re-read, which is the bug shape §3.2 names',
    (SELECT t.revoked_at FROM private.access_tokens t
      WHERE t.household_id = s.hh_chenna AND t.revoked_at IS NOT NULL),
    (v ->> 'revoked_at')::timestamptz);
  PERFORM pg_temp.s8f_eq('R4 the withdrawn family''s secret is refused at the door in the same closed '
    'shape as an expiry and a forgery — a host taking a link away is not distinguishable to its holder',
    pg_temp.s8f_door(current_setting('s8f.raw_chenna')), '{"available": false}'::jsonb);

  -- Withdraw, twice. A host pressing the button again is a person checking, not an error.
  w := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.revoke_guest_invitation(' || quote_literal(s.hh_chenna::text) || '::uuid)');
  revoked_at_1 := (SELECT t.revoked_at FROM private.access_tokens t
                    WHERE t.household_id = s.hh_chenna AND t.revoked_at IS NOT NULL);
  PERFORM pg_temp.s8f_eq('R5 the second withdrawal says there was nothing to withdraw, retires nothing, '
    'and carries no timestamp at all — the key is reported as JSON null rather than as a stale stamp or '
    'an absence a client would have to guess about. `jsonb_typeof` is the test because a jsonb accessor '
    'returns a null *value*, not a missing key',
    ARRAY[(w ->> 'revoked'), (w ->> 'credentials_revoked'),
          jsonb_typeof(w -> 'revoked_at')]::text[],
    ARRAY['false', '0', 'null']::text[]);
  PERFORM pg_temp.s8f_eq('R6 and it did not re-stamp the history: the row still carries the first instant, '
    'so "when did the host cut this link off" has one answer however often the screen is pressed',
    (SELECT t.revoked_at FROM private.access_tokens t
      WHERE t.household_id = s.hh_chenna AND t.revoked_at IS NOT NULL), revoked_at_1);

  -- Only the secret died.
  PERFORM pg_temp.s8f_eq('R7 §3.2: the family, its two event scopes and its place in the guest list are '
    'exactly as they were — withdrawal is not a way to delete a household',
    ARRAY[(SELECT count(*)::text FROM public.guest_households h
            WHERE h.wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.household_event_scopes q
            WHERE q.household_id = s.hh_chenna),
          (SELECT host_notes FROM public.guest_households WHERE id = s.hh_chenna)]::text[],
    ARRAY['4', '2', 'host-only: cousin needs a ride from the airport']::text[]);

  PERFORM pg_temp.s8f_run('R1', 'authenticated', s.owner_a::text);

  n_rows := (SELECT count(*) FROM private.access_tokens WHERE household_id = s.hh_raman);
  PERFORM pg_temp.s8f_run('R2', 'authenticated', s.owner_a::text);
  PERFORM pg_temp.s8f_eq('R8 §8: and the refused rotation changed nothing at all — the expired row is '
    'still the only row for that family, still unrevoked, still carrying the deadline that aged it. This '
    'is the shape of the defect the repair removed: the abort used to happen after the row had been '
    'locked, so the whole call rolled back and the dead link stayed dead behind a database error',
    ARRAY[(SELECT count(*)::text FROM private.access_tokens
            WHERE household_id = s.hh_raman),
          (SELECT (t.revoked_at IS NULL)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_raman),
          (SELECT (cardinality(pg_temp.s8f_token(current_setting('s8f.raw_raman'))) = 1)::text)]::text[],
    ARRAY[n_rows::text, 'true', 'true']::text[]);

  -- The pair the refusal points at: withdraw the expired link, then send a new one.
  v := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.revoke_guest_invitation(' || quote_literal(s.hh_raman::text) || '::uuid)');
  PERFORM pg_temp.s8f_eq('R9 withdrawing an expired link reports the credential it retires — expiry and '
    'withdrawal are separate columns, and both can be true of one family in that order',
    ARRAY[(v ->> 'revoked'), (v ->> 'credentials_revoked')]::text[],
    ARRAY['true', '1']::text[]);

  v := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, ARRAY['
    || quote_literal(s.hh_raman::text) || '::uuid], now() + interval ''45 days'')');
  raw_new := substr(v -> 'invitations' -> 0 ->> 'path', 4);
  raw_old := current_setting('s8f.raw_raman');
  PERFORM set_config('s8f.raw_raman2', raw_new, false);
  PERFORM pg_temp.s8f_eq('R10 a re-send after withdrawal mints rather than reporting already_live: the '
    'retired row does not hold the slot, which is the same one-live-not-one-ever rule group W measured '
    'against the index, now measured through the verb a host actually uses',
    ARRAY[(v ->> 'issued'), (v ->> 'already_live'),
          (raw_new <> raw_old)::text]::text[],
    ARRAY['1', '0', 'true']::text[]);
  PERFORM pg_temp.s8f_eq('R11 that family now has two rows and exactly one live secret, the aged one '
    'kept as history under its own digest',
    ARRAY[(SELECT count(*)::text FROM private.access_tokens
            WHERE household_id = s.hh_raman),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL)]::text[],
    ARRAY['2', '1']::text[]);
  PERFORM pg_temp.s8f_eq('R12 and the retired predecessor is still refused while the new secret works — '
    'the door does not resurrect a link because a fresher one exists, and a re-send does not hand the '
    'family back the secret their host withdrew',
    ARRAY[(pg_temp.s8f_door(raw_old) ->> 'available'),
          (pg_temp.s8f_door(raw_new) ->> 'available')]::text[],
    ARRAY['false', 'true']::text[]);
  v := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM pg_temp.s8f_eq('R13 §3.4: the LATERAL preference is what makes that read say `live` with the '
    'new deadline, not `expired` with the old one, while two rows exist for the family',
    ARRAY[(SELECT e ->> 'link_state' FROM jsonb_array_elements(v) e
            WHERE (e ->> 'household_id')::uuid = s.hh_raman),
          (SELECT ((e ->> 'link_expires_at')::timestamptz > now())::text
             FROM jsonb_array_elements(v) e
            WHERE (e ->> 'household_id')::uuid = s.hh_raman)]::text[],
    ARRAY['live', 'true']::text[]);

  -- Rotate a live link that has a deadline: the secret changes, the deadline does not.
  raw_old := current_setting('s8f.raw_raman2');
  expires_before := (SELECT t.expires_at FROM private.access_tokens t
                     WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL);
  w := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.rotate_guest_invitation(' || quote_literal(s.hh_raman::text) || '::uuid)');
  PERFORM pg_temp.s8f_has_keys('R14 the rotation answer names five things and no sixth: the family, the '
    'publication the successor is pinned to, the new path, when the predecessor was retired, and the '
    'deadline the successor carries', w,
    ARRAY['expires_at', 'household_id', 'path', 'previous_revoked_at', 'publication_id']);
  raw_new := substr(w ->> 'path', 4);
  PERFORM pg_temp.s8f_eq('R15 §3.3: the deadline survives the replacement to the instant, in the answer '
    'and on the row — what is rotated is the secret, not the host''s decision about time',
    ARRAY[((w ->> 'expires_at')::timestamptz = expires_before)::text,
          (SELECT (t.expires_at = expires_before)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL)]::text[],
    ARRAY['true', 'true']::text[]);
  PERFORM pg_temp.s8f_eq('R16 and the pinned publication is the one the household links belong to, which '
    'is what keeps a rotated link inside the same frozen document',
    w ->> 'publication_id', current_setting('s8f.pub1'));
  PERFORM pg_temp.s8f_eq('R17 revoke-then-mint, in that order: exactly one live secret, and the two '
    'retired rows beside it. A rotation that failed at the mint would have left this count at one row '
    'retired and none live',
    ARRAY[(SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_raman AND t.revoked_at IS NOT NULL)]::text[],
    ARRAY['1', '2']::text[]);
  PERFORM pg_temp.s8f_eq('R18 the instant the answer calls `previous_revoked_at` is the instant the '
    'predecessor row carries',
    (SELECT t.revoked_at FROM private.access_tokens t
      WHERE t.household_id = s.hh_raman AND t.token_hash =
            encode(extensions.digest(convert_to(raw_old, 'UTF8'), 'sha256'), 'hex')),
    (w ->> 'previous_revoked_at')::timestamptz);
  PERFORM pg_temp.s8f_eq('R19 and the address the family was holding stops working at the same moment the '
    'new one starts — the old link is never left resolving beside its replacement',
    ARRAY[(pg_temp.s8f_door(raw_old) ->> 'available'),
          (pg_temp.s8f_door(raw_new) ->> 'available')]::text[],
    ARRAY['false', 'true']::text[]);
  PERFORM set_config('s8f.raw_raman', raw_new, false);
  PERFORM pg_temp.s8f_eq('R20 §I10: the rotated secret is nowhere in the store as anything but a digest, '
    'including in the row that carries the deadline it inherited',
    pg_temp.s8f_stored_hits(raw_new), '{}'::text[]);

  -- The other half of the same CASE: a family with no deadline must not acquire one by being rotated.
  raw_old := current_setting('s8f.raw_baby');
  w := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.rotate_guest_invitation(' || quote_literal(s.hh_baby::text) || '::uuid)');
  raw_new := substr(w ->> 'path', 4);
  PERFORM pg_temp.s8f_eq('R21 rotating a no-deadline family answers no deadline and stores no deadline — '
    'a button labelled "new link" cannot become a way to set the host''s expiry policy for them. The '
    'answer half is `jsonb_typeof` because the key is present and JSON-null, which is what a client that '
    'reads the field needs to see',
    ARRAY[jsonb_typeof(w -> 'expires_at'),
          (SELECT array_agg(t.expiry_policy ORDER BY t.created_at DESC)::text
             FROM private.access_tokens t
            WHERE t.household_id = s.hh_baby AND t.revoked_at IS NULL)]::text[],
    ARRAY['null', '{no_expiry}']::text[]);
  PERFORM pg_temp.s8f_eq('R22 and the arithmetic of three lifetimes for one family is legible: one live '
    'secret, the row group H minted retired by hand in W, and the successor W minted retired here',
    ARRAY[(SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_baby),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_baby AND t.revoked_at IS NULL),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_baby AND t.revoked_at IS NOT NULL)]::text[],
    ARRAY['3', '1', '2']::text[]);
  PERFORM pg_temp.s8f_eq('R23 both of the Baby family''s retired secrets are refused at the door while '
    'the current one works — history is kept, but none of it opens anything',
    ARRAY[(pg_temp.s8f_door(current_setting('s8f.raw_baby_retired')) ->> 'available'),
          (pg_temp.s8f_door(raw_old) ->> 'available'),
          (pg_temp.s8f_door(raw_new) ->> 'available')]::text[],
    ARRAY['false', 'false', 'true']::text[]);
  PERFORM set_config('s8f.raw_baby_retired', raw_old, false);
  PERFORM set_config('s8f.raw_baby', raw_new, false);

  -- The invariant the index exists to hold, measured after every mint, retirement and rotation above.
  PERFORM pg_temp.s8f_eq('R24 no household anywhere in the database has two live guest credentials, and '
    'the wedding this battery churned has exactly three live links — the withdrawn family is not one of '
    'them, and the fourth household is reported rather than hidden',
    ARRAY[(SELECT count(*)::text FROM (SELECT t.household_id FROM private.access_tokens t
            WHERE t.token_kind = 'guest_invitation' AND t.revoked_at IS NULL
            GROUP BY t.household_id HAVING count(*) > 1) x),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NULL)]::text[],
    ARRAY['0', '3']::text[]);
  PERFORM pg_temp.s8f_eq('R25 §3.2: withdrawing a link a family never had is a legal no-op rather than an '
    'error — and note the asymmetry this exposes, which group B measures from the other side: withdrawal '
    'needs no publication, because it only ever removes, while rotation refuses without one, because it '
    'has to mint',
    pg_temp.s8f_auth(s.owner_b::text,
      'SELECT api.revoke_guest_invitation(' || quote_literal(s.hh_stranger::text) || '::uuid)'),
    jsonb_build_object('household_id', s.hh_stranger, 'revoked', false,
                       'credentials_revoked', 0, 'revoked_at', NULL));
  PERFORM pg_temp.s8f_eq('R26 and nothing in this group wrote or removed a household: the six rows of the '
    'cast are still six, of which this wedding''s four are unchanged',
    (SELECT count(*) FROM public.guest_households), 6::bigint);
END $R$;

-- --------------------------------------------------------------------------- T: §3.4 the host's own view
-- This read is an RPC rather than a client query for the one reason the migration gives at :480-482 —
-- link state lives in `private.access_tokens`, which no browser role may read — and that same reason
-- makes it the verb where a privacy leak is easiest to write by accident: a single `SELECT h.*` in the
-- subquery would put a host's private notes about a family on a screen, and `row_to_json` would name the
-- column for them. So this group counts keys and greps for secrets instead of trusting a projection it
-- can read in the migration, and it writes the answers it counts through the host's own RLS path rather
-- than as the owner.
DO $T$
DECLARE s s8r%ROWTYPE; v jsonb; w jsonb; b jsonb; ev_m uuid; ev_r uuid; n bigint;
BEGIN
  SELECT * INTO s FROM s8r;

  v := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');

  PERFORM pg_temp.s8f_eq('T1 one row per household and no fifth: the read answers about the four families '
    'of this wedding, which is the whole of what a host is entitled to know about their own guest list',
    jsonb_array_length(v)::bigint, 4::bigint);
  PERFORM pg_temp.s8f_eq('T2 in display-name order with the household id as the tiebreak, which is the '
    'order the send at H4 used — a link and a state row must never be able to disagree about which family '
    'they name',
    (SELECT array_agg(q.e ->> 'display_name' ORDER BY q.n)
       FROM jsonb_array_elements(v) WITH ORDINALITY q(e, n)),
    ARRAY['Chennakrishna Iyer', 'The Baby family', 'The Nair family', 'The Raman family']);
  PERFORM pg_temp.s8f_eq('T3 every row carries exactly these ten names and no eleventh, measured row by '
    'row, because the answer is a `row_to_json` over a subquery and a column added there would otherwise '
    'arrive on a host screen without any verb being changed',
    (SELECT count(*) FROM jsonb_array_elements(v) e
      WHERE NOT (pg_temp.s8f_top_keys(e) = pg_temp.s8f_sorted(ARRAY[
        'attending_count', 'display_name', 'expected_party_size', 'household_id', 'link_expires_at',
        'link_last_used_at', 'link_state', 'reply_count', 'salutation', 'scoped_event_count']))),
    0::bigint);
  PERFORM pg_temp.s8f_eq('T4 §3.4: the four states are the four this battery produced — the withdrawn '
    'family, the rotated family, the untouched family and the re-sent-then-rotated family, in one word '
    'each and in Stage 7''s vocabulary rather than a new one',
    (SELECT array_agg(q.e ->> 'link_state' ORDER BY q.n)
       FROM jsonb_array_elements(v) WITH ORDINALITY q(e, n)),
    ARRAY['revoked', 'live', 'live', 'live']);
  PERFORM pg_temp.s8f_eq('T5 the zero-event family is reported as zero rather than skipped, and the '
    'counts agree with the scope table row for row',
    ARRAY[(SELECT array_agg(q.e ->> 'scoped_event_count' ORDER BY q.n)::text
             FROM jsonb_array_elements(v) WITH ORDINALITY q(e, n)),
          (SELECT count(*) FROM jsonb_array_elements(v) e
            WHERE (e ->> 'scoped_event_count')::int <>
                  (SELECT count(*) FROM public.household_event_scopes q
                    WHERE q.household_id = (e ->> 'household_id')::uuid))::bigint::text]::text[],
    ARRAY['{2,2,1,0}', '0']::text[]);
  PERFORM pg_temp.s8f_eq('T6 and no answer has been recorded for anybody yet, so every reply count below '
    'is a count of rows this group writes and not of a fixture this file forgot to clear',
    (SELECT count(*) FROM jsonb_array_elements(v) e
      WHERE (e ->> 'reply_count')::int <> 0 OR (e ->> 'attending_count')::int <> 0), 0::bigint);

  SELECT e.id INTO ev_m FROM public.wedding_events e
   WHERE e.wedding_id = s.wed_a AND e.event_key = 'muurtham';
  SELECT e.id INTO ev_r FROM public.wedding_events e
   WHERE e.wedding_id = s.wed_a AND e.event_key = 'reception';

  n := pg_temp.s8f_host_write(s.owner_a::text,
    'INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, '
    || 'response_source) VALUES (' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(s.hh_chenna::text) || '::uuid, ' || quote_literal(ev_m::text) || '::uuid, '
    || '''attending'', 4, ''host_manual'')');
  n := pg_temp.s8f_host_write(s.owner_a::text,
    'INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, '
    || 'response_source) VALUES (' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(s.hh_chenna::text) || '::uuid, ' || quote_literal(ev_r::text) || '::uuid, '
    || '''declined'', 0, ''host_manual'')');
  n := pg_temp.s8f_host_write(s.owner_a::text,
    'INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, '
    || 'response_source) VALUES (' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(s.hh_baby::text) || '::uuid, ' || quote_literal(ev_m::text) || '::uuid, '
    || '''attending'', 2, ''host_manual'')');
  PERFORM pg_temp.s8f_eq('T7 three manual answers written by the host through their own RLS policy, one '
    'row each — the counts below are therefore a claim about the read, not about a privileged insert',
    n, 1::bigint);

  v := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM pg_temp.s8f_eq('T8 §3.4: the reply counts are per household and the attending count is the '
    'narrower one — two answers and one yes for the first family, one and one for the second, and zero '
    'for the two families nobody answered for. There is no total across families anywhere in the answer, '
    'because T3 says what keys exist and none of them is a sum',
    ARRAY[(SELECT array_agg(q.e ->> 'reply_count' ORDER BY q.n)::text
             FROM jsonb_array_elements(v) WITH ORDINALITY q(e, n)),
          (SELECT array_agg(q.e ->> 'attending_count' ORDER BY q.n)::text
             FROM jsonb_array_elements(v) WITH ORDINALITY q(e, n))]::text[],
    ARRAY['{2,1,0,0}', '{1,1,0,0}']::text[]);

  -- The privacy half of the claim, measured as text rather than as a projection: this answer is what a
  -- host screen is built from, and everything a household must never see is on the same rows.
  PERFORM pg_temp.s8f_eq('T9 none of the six household secrets this file has held, live or retired, '
    'appears anywhere in the host''s own view',
    (SELECT count(*) FROM unnest(ARRAY[current_setting('s8f.raw_chenna'),
      current_setting('s8f.raw_baby'), current_setting('s8f.raw_baby_retired'),
      current_setting('s8f.raw_nair'), current_setting('s8f.raw_raman'),
      current_setting('s8f.raw_raman2')]) x
      WHERE x <> '' AND position(x in v::text) > 0), 0::bigint);
  PERFORM pg_temp.s8f_ok('T10 and there is no digest, no path and no credential-shaped string in it '
    'either: nothing a host forwarding this JSON could hand to a third party as a link',
    (v::text !~ '[0-9a-f]{64}') AND position('/g/' in v::text) = 0);
  PERFORM pg_temp.s8f_ok('T11 §5 Ruling 5.1: the host''s private note about the first family, which sits '
    'on the very table this read projects, is not in it — and its absence is measured against the '
    'sentence F5 proved exists',
    position('host-only' in v::text) = 0 AND position('ride from the airport' in v::text) = 0);
  PERFORM pg_temp.s8f_eq('T12 a family with no salutation and no expected party size is reported with '
    'both keys still JSON-null rather than with an empty string or a zero invented for them. The test is '
    '`jsonb_typeof`, not `IS NULL`: an accessor on a present-and-null key hands back a null *value*, so '
    '`IS NULL` would be false for exactly the rows this claim is about',
    ARRAY[(SELECT (jsonb_typeof(e -> 'salutation') = 'null')::text
             FROM jsonb_array_elements(v) e
            WHERE (e ->> 'household_id')::uuid = s.hh_nair),
          (SELECT (jsonb_typeof(e -> 'expected_party_size') = 'null')::text
             FROM jsonb_array_elements(v) e
            WHERE (e ->> 'household_id')::uuid = s.hh_nair),
          (SELECT count(*)::text FROM jsonb_array_elements(v) e
            WHERE (e ->> 'household_id')::uuid = s.hh_nair
              AND ((e ->> 'salutation' = '') OR (e ->> 'expected_party_size')::text = '0'))]::text[],
    ARRAY['true', 'true', '0']::text[]);
  PERFORM pg_temp.s8f_ok('T13 and the "has this family opened the invitation" column is populated for '
    'all four, because this battery opened each of their current links at the door — the half that makes '
    'A5 worth measuring, where a refused probe with an aged secret moved nothing',
    (SELECT count(*) FROM jsonb_array_elements(v) e
      WHERE (e ->> 'link_last_used_at') IS NULL) = 0);

  b := pg_temp.s8f_auth(s.owner_b::text,
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_b::text) || '::uuid)');
  PERFORM pg_temp.s8f_eq('T14 a family with no credential at all is reported as `never_issued` with both '
    'link keys present and JSON-null — the state a host needs in order to know the send never happened, '
    'and the shape that only exists because the read LEFT JOINs instead of filtering',
    ARRAY[jsonb_array_length(b)::text, b -> 0 ->> 'link_state',
          (jsonb_typeof(b -> 0 -> 'link_expires_at') = 'null')::text,
          (jsonb_typeof(b -> 0 -> 'link_last_used_at') = 'null')::text]::text[],
    ARRAY['1', 'never_issued', 'true', 'true']::text[]);

  b := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_empty::text) || '::uuid)');
  PERFORM pg_temp.s8f_eq('T15 a wedding with an empty guest list reads as an empty list rather than as '
    'null, an error, or a zero the client has to interpret',
    b, '[]'::jsonb);

  v := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');
  b := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT internal_api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM pg_temp.s8f_eq('T16 the exposed wrapper and the privileged body it delegates to answer '
    'identically for the same caller, which is the only way the one-line-wrapper layout is safe to keep',
    b, v);

  -- Withdraw a family that has already answered. This is the case the earlier version of group R could
  -- not measure, because no answer existed yet: the sentence "only the secret dies" needs a reply to
  -- survive.
  w := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.revoke_guest_invitation(' || quote_literal(s.hh_baby::text) || '::uuid)');
  PERFORM pg_temp.s8f_eq('T17 §3.2: withdrawing that family''s link retires the credential and leaves '
    'their recorded answer exactly where it was — a host cutting off a link is not a way to delete what '
    'a family already said',
    ARRAY[(w ->> 'revoked'), (w ->> 'credentials_revoked'),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_baby)]::text[],
    ARRAY['true', '1', '1']::text[]);

  b := pg_temp.s8f_auth(s.owner_a::text,
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM pg_temp.s8f_eq('T18 and read from that one answer: the withdrawn family''s own secret stops '
    'opening anything, while their state row still says `revoked` with the answer still counted — the '
    'host''s view and the guest''s door disagreeing in exactly this direction is the whole of §3.2',
    ARRAY[(pg_temp.s8f_door(current_setting('s8f.raw_baby')) ->> 'available'),
          (SELECT e ->> 'link_state' FROM jsonb_array_elements(b) e
            WHERE (e ->> 'household_id')::uuid = s.hh_baby),
          (SELECT e ->> 'reply_count' FROM jsonb_array_elements(b) e
            WHERE (e ->> 'household_id')::uuid = s.hh_baby)]::text[],
    ARRAY['false', 'revoked', '1']::text[]);
END $T$;

-- --------------------------------------------------------------------------- G: the surface this head adds
-- Stage 7's battery already counts the whole exposed cluster, and counts it head-aware for exactly
-- this stage's arrival (`stage7/90_review_boundary.sql:1051-1130` enumerates nineteen `api` names and
-- five anonymous bodies from `stage8` on). This group deliberately does not re-state that census: a
-- second copy of a number is a second thing a later stage has to move, and the point of Stage 7's
-- ordinal `at_least` was to keep one home for it. What is measured here instead is the shape of the
-- twelve names Stage 8 itself added — that each privileged body has exactly one mirror, that the two
-- postures are actually different in the catalog rather than only in the migration text, that the
-- caller matrix in §9 is the real ACL, and that nothing in the new surface was opened to a role beyond
-- the two browser roles. Plus the one thing no behaviour test can show: which wall B19 and B20 were
-- actually hitting.
--
-- The scan in G11 is re-run over the new bodies rather than inherited from Stage 5's copy of the same
-- pattern, because a helper added to the guest path after that battery was written is precisely what a
-- scan fixed to a list of names misses. Its positive control matters more here than it does in Stage 5:
-- a `prosrc` scan over code that does not exist yet passes trivially.
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('GA', '§9: `anon` has USAGE on `internal_api` — Stage 3 granted it so the door could be reached at '
    'all — and that is not the same thing as being able to call a body in it. This is the stronger place '
    'for the boundary because the engine enforces it in plain SQL, not a gateway configuration that a '
    'different `db-schemas` setting would dissolve',
   $t$SELECT internal_api.issue_guest_invitations(current_setting('s8f.wed_a')::uuid,
        ARRAY[current_setting('s8f.hh_chenna')::uuid], NULL)$t$,
   '42501', '%permission denied for function issue_guest_invitations%'),
  ('GA', 'nor may an account-free caller read a host''s guest list through the privileged half either: '
    'the read is a mirror of a mirror, and both halves are closed to it',
   $t$SELECT internal_api.get_guest_invitation_state(current_setting('s8f.wed_a')::uuid)$t$,
   '42501', '%permission denied for function get_guest_invitation_state%'),
  ('GB', '§I8 / Ruling 8.2: a host cannot write the credential store directly. This is the probe that '
    'tells B19''s `-1` or `0` apart from a polite empty read — Stage 2''s baseline revokes the whole '
    '`private` schema from both browser roles (`20260925120000_stage2_privilege_baseline.sql:29`, '
    'USAGE to `service_role` only at `:38`), so the engine refuses at the schema before the table is '
    'reached; the table grant itself is pinned by G7, which is the assertion that reads the ACL rather '
    'than the message. Either way the write cannot land, which is why the host''s link state has to '
    'travel as an RPC answer',
   $t$INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, expiry_policy)
     SELECT encode(extensions.digest(convert_to('s8-g-hostwrite', 'UTF8'), 'sha256'), 'hex'),
            'guest_invitation', current_setting('s8f.wed_a')::uuid, 'no_expiry'$t$,
   '42501', '%permission denied for schema private%'),
  ('GC', 'and a guest cannot delete their own credential, which is the only way this schema could be '
    'made to forget a family rather than retire them — the whole audit trail is one UPDATE away and not '
    'one DELETE',
   $t$DELETE FROM private.access_tokens
     WHERE wedding_id = current_setting('s8f.wed_a')::uuid
       AND token_kind = 'guest_invitation'$t$,
   '42501', '%permission denied for schema private%');

DO $G$
DECLARE s s8r%ROWTYPE; names text[]; scan constant text := '(tamil|malayalam|telugu|kannada|brahmin|'
  || 'community|caste|surname|religion|hindu|muslim|christian|temple|mosque|church|pack_key)';
BEGIN
  SELECT * INTO s FROM s8r;
  PERFORM pg_temp.s8f_run('GA', 'anon', NULL);
  PERFORM pg_temp.s8f_run('GB', 'authenticated', s.owner_a::text);
  PERFORM pg_temp.s8f_run('GC', 'anon', NULL);

  names := ARRAY['get_guest_invitation_state', 'issue_guest_invitations',
                 'resolve_guest_invitation', 'revoke_guest_invitation',
                 'rotate_guest_invitation', 'submit_guest_rsvp'];

  -- Arity is part of this list rather than a separate assertion, because the argument-free shape of
  -- the door is the security fact: `resolve_guest_invitation()` takes no parameter a caller could
  -- pass a household secret through, so the credential can only arrive as a header.
  PERFORM pg_temp.s8f_eq('G1 §9: Stage 8 adds exactly twelve functions, six privileged bodies and six '
    'one-line mirrors, named here as `schema.name(arity)` — no thirteenth name in either schema, and '
    'the guest door is arity zero in both halves',
    (SELECT array_agg(n.nspname || '.' || p.proname || '(' || p.pronargs || ')'
             ORDER BY (n.nspname || '.' || p.proname) COLLATE "C")
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api', 'internal_api') AND p.proname = ANY(names)),
    ARRAY['api.get_guest_invitation_state(1)', 'api.issue_guest_invitations(3)',
          'api.resolve_guest_invitation(0)', 'api.revoke_guest_invitation(1)',
          'api.rotate_guest_invitation(1)', 'api.submit_guest_rsvp(1)',
          'internal_api.get_guest_invitation_state(1)', 'internal_api.issue_guest_invitations(3)',
          'internal_api.resolve_guest_invitation(0)', 'internal_api.revoke_guest_invitation(1)',
          'internal_api.rotate_guest_invitation(1)', 'internal_api.submit_guest_rsvp(1)']::text[]);

  PERFORM pg_temp.s8f_eq('G2 §9: the two postures are different in the catalog, not only in the '
    'migration text — every body is SECURITY DEFINER, every mirror is SECURITY INVOKER, and all twelve '
    'pin `search_path = ''''` so a caller cannot steer which schema a delegation resolves through. '
    '`proconfig @> ARRAY[''search_path=""'']` is the form Stage 4 and Stage 5 measured and this reuses, '
    'because an exact-serialisation comparison would be a claim about Postgres''s quoting',
    (SELECT array_agg(n.nspname || '.' || p.proname || ' definer=' || p.prosecdef::text
             || ' pinned=' || (p.proconfig @> ARRAY['search_path=""'])::text
             ORDER BY (n.nspname || '.' || p.proname) COLLATE "C")
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api', 'internal_api') AND p.proname = ANY(names)),
    ARRAY['api.get_guest_invitation_state definer=false pinned=true',
          'api.issue_guest_invitations definer=false pinned=true',
          'api.resolve_guest_invitation definer=false pinned=true',
          'api.revoke_guest_invitation definer=false pinned=true',
          'api.rotate_guest_invitation definer=false pinned=true',
          'api.submit_guest_rsvp definer=false pinned=true',
          'internal_api.get_guest_invitation_state definer=true pinned=true',
          'internal_api.issue_guest_invitations definer=true pinned=true',
          'internal_api.resolve_guest_invitation definer=true pinned=true',
          'internal_api.revoke_guest_invitation definer=true pinned=true',
          'internal_api.rotate_guest_invitation definer=true pinned=true',
          'internal_api.submit_guest_rsvp definer=true pinned=true']::text[]);

  -- The caller matrix of §9 said out loud. Written as the grantee names rather than as a count, because
  -- a count of grants cannot tell a verb opened to `anon` from a verb opened to `service_role`, and the
  -- whole of Ruling 8.2 is about which of those two happened.
  PERFORM pg_temp.s8f_eq('G3 §9: the two halves of each pair are open to exactly the same browser '
    'roles, verb by verb and read as role names — the four host verbs to `authenticated` only, the two '
    'household doors to `anon` and `authenticated`, and `service_role` nowhere, because it is not a '
    'browser and already owns the tables these bodies write',
    (SELECT array_agg(n.nspname || '.' || p.proname || '='
             || coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname)
                            FROM aclexplode(p.proacl) acl
                            JOIN pg_roles r ON r.oid = acl.grantee
                           WHERE acl.privilege_type = 'EXECUTE'
                             AND r.rolname IN ('anon', 'authenticated', 'service_role')), '-')
             ORDER BY (n.nspname || '.' || p.proname) COLLATE "C")
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api', 'internal_api') AND p.proname = ANY(names)),
    ARRAY['api.get_guest_invitation_state=authenticated',
          'api.issue_guest_invitations=authenticated',
          'api.resolve_guest_invitation=anon,authenticated',
          'api.revoke_guest_invitation=authenticated',
          'api.rotate_guest_invitation=authenticated',
          'api.submit_guest_rsvp=anon,authenticated',
          'internal_api.get_guest_invitation_state=authenticated',
          'internal_api.issue_guest_invitations=authenticated',
          'internal_api.resolve_guest_invitation=anon,authenticated',
          'internal_api.revoke_guest_invitation=authenticated',
          'internal_api.rotate_guest_invitation=authenticated',
          'internal_api.submit_guest_rsvp=anon,authenticated']::text[]);

  PERFORM pg_temp.s8f_eq('G4 of the twelve, exactly four are executable by a caller with no account, '
    'and they are the two doors in both halves: an anonymous caller can open a household link and '
    'answer it, and can do nothing else on this head''s new surface',
    (SELECT array_agg(n.nspname || '.' || p.proname ORDER BY (n.nspname || '.' || p.proname)
             COLLATE "C")
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api', 'internal_api') AND p.proname = ANY(names)
        AND has_function_privilege('anon', p.oid, 'EXECUTE')),
    ARRAY['api.resolve_guest_invitation', 'api.submit_guest_rsvp',
          'internal_api.resolve_guest_invitation',
          'internal_api.submit_guest_rsvp']::text[]);

  PERFORM pg_temp.s8f_eq('G5 §9: and the arithmetic of Ruling 8.2 in one line — the only grantees '
    'anywhere on those twelve are the two browser roles, and nothing at all is granted to PUBLIC, which '
    'is the grant a `REVOKE ALL FROM PUBLIC`-less migration would have left behind. The owner''s own '
    'ACL row is excluded because it is not a grant to anyone: PostgreSQL materialises '
    '`postgres=X/postgres` on the first GRANT to any other role, so it is present on every function this '
    'product''s migrations create and names the installer rather than a caller. Every other grantee '
    'still appears here, so a migration that opened one of these verbs to a third role would move this '
    'line rather than hide behind that exclusion',
    ARRAY[(SELECT coalesce(string_agg(DISTINCT r.rolname, ',' ORDER BY r.rolname), '-')
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(p.proacl) acl
             JOIN pg_roles r ON r.oid = acl.grantee
            WHERE n.nspname IN ('api', 'internal_api') AND p.proname = ANY(names)
              AND acl.privilege_type = 'EXECUTE' AND acl.grantee <> p.proowner),
          (SELECT count(*) FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL aclexplode(p.proacl) acl
            WHERE n.nspname IN ('api', 'internal_api') AND p.proname = ANY(names)
              AND acl.privilege_type = 'EXECUTE' AND acl.grantee = 0)::bigint::text]::text[],
    ARRAY['anon,authenticated', '0']::text[]);

  -- `::text` on both sides is load-bearing, not noise: `proname`/`nspname` are type `name`, and a
  -- `COLLATE "C"` applied to a `name` expression stops matching the `DISTINCT` argument, which the
  -- engine then rejects before running any of it.
  PERFORM pg_temp.s8f_eq('G6 §9: the posture is written where a reader of the catalog will find it — '
    'all six privileged bodies carry a comment, and among the mirrors exactly the two anonymous doors '
    'do, which are the two a caller who is not the host''s own screen has to reason about. A reviewer '
    'who checks this by reading the migration instead has to re-read 1205-1226; this says the same '
    'thing from the live catalog',
    ARRAY[(SELECT coalesce(string_agg(DISTINCT p.proname::text COLLATE "C", ',' ORDER BY p.proname::text COLLATE "C"), '-')
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'internal_api' AND p.proname = ANY(names)
              AND obj_description(p.oid) IS NOT NULL),
          (SELECT coalesce(string_agg(DISTINCT p.proname::text COLLATE "C", ',' ORDER BY p.proname::text COLLATE "C"), '-')
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'api' AND p.proname = ANY(names)
              AND obj_description(p.oid) IS NOT NULL)]::text[],
    ARRAY['get_guest_invitation_state,issue_guest_invitations,resolve_guest_invitation,'
          || 'revoke_guest_invitation,rotate_guest_invitation,submit_guest_rsvp',
          'resolve_guest_invitation,submit_guest_rsvp']::text[]);

  -- B19 and B20 accept `-1` or `0` because either is invisibility. Which one actually happened is a
  -- fact about the grant inventory rather than about RLS, and it is pinned here rather than left to
  -- the first run: the relation itself refuses both browser roles, the service role is the one role
  -- that may read it, RLS is nevertheless enabled on the table, and there is no policy on it at all.
  PERFORM pg_temp.s8f_eq('G7 §I8: the wall under B19/B20 is the table grant, not a filtered read — '
    '`anon` and `authenticated` hold no SELECT on the credential store, `service_role` does, RLS is on '
    'anyway, and zero policies exist, so an empty result was never available to a browser role as an '
    'alternative to a refusal. A later stage that granted SELECT here would not weaken B19/B20''s '
    'answer; it would move this one, which is the assertion that has teeth',
    ARRAY[has_table_privilege('anon', 'private.access_tokens', 'SELECT')::text,
          has_table_privilege('authenticated', 'private.access_tokens', 'SELECT')::text,
          has_table_privilege('service_role', 'private.access_tokens', 'SELECT')::text,
          (SELECT relrowsecurity::text FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'private' AND c.relname = 'access_tokens'),
          (SELECT count(*) FROM pg_policies WHERE schemaname = 'private'
             AND tablename = 'access_tokens')::bigint::text]::text[],
    ARRAY['false', 'false', 'true', 'true', '0']::text[]);

  PERFORM pg_temp.s8f_eq('G8 Ruling 8.2: and the three tables these bodies write are still exactly on '
    'Stage 2''s lists — a browser role may read and write the guest list, its event scope and its '
    'answers as the host, and may not read them at all unsigned-out. No new table privilege, no new '
    'role grant, measured per table rather than inferred from the migration not containing a GRANT',
    (SELECT array_agg(t || '|auth_select='
             || has_table_privilege('authenticated', 'public.' || t, 'SELECT')::text
             || '|auth_insert='
             || has_table_privilege('authenticated', 'public.' || t, 'INSERT')::text
             || '|anon_select='
             || has_table_privilege('anon', 'public.' || t, 'SELECT')::text
             ORDER BY t COLLATE "C")
       FROM unnest(ARRAY['guest_households', 'household_event_scopes',
                         'rsvp_responses']) t),
    ARRAY['guest_households|auth_select=true|auth_insert=true|anon_select=false',
          'household_event_scopes|auth_select=true|auth_insert=true|anon_select=false',
          'rsvp_responses|auth_select=true|auth_insert=true|anon_select=false']::text[]);

  PERFORM pg_temp.s8f_eq('G9 §I10: the new names exist in exactly the two schemas this layout uses. '
    'There is no third place a guest credential verb could be reached from, and nothing was added to '
    '`private` — where Stage 2 put the triggers and the helpers every client can call through their '
    'own table''s policy',
    (SELECT coalesce(string_agg(DISTINCT n.nspname::text COLLATE "C", ',' ORDER BY n.nspname::text COLLATE "C"), '-')
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = ANY(names)),
    'api,internal_api');

  PERFORM pg_temp.s8f_ok('G10 the directive''s first prohibition, re-run rather than inherited: no '
    'community, faith, caste, ceremony-word or surname test appears in any of the twelve new bodies, '
    'counted by name so a hit would be readable as a name rather than as a number',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api', 'internal_api') AND p.proname = ANY(names)
        AND p.prosrc ~* scan) = 0);
  PERFORM pg_temp.s8f_ok('G10b and the scanner above is known to bite, which is the half that makes '
    'G10 a measurement instead of an absence of evidence: the same pattern, run against a sentence that '
    'does contain the vocabulary, matches it. A `prosrc` scan also sees a body''s own comments, so a '
    'clean result here is a statement about the whole text of the new code, not only its expressions',
    'Dear brahmin family of the temple' ~* scan);
END $G$;

-- --------------------------------------------------------------------------- Z: the census this file leaves behind
-- Battery 2 reads this residue the way Stage 7's two batteries read each other, so the state named
-- here is the state that file is written against — and a claim about a live link battery 2 has to mint
-- for itself is worth more than a count that would silently move when a group above it changed.
DO $Z$
DECLARE s s8r%ROWTYPE;
BEGIN
  SELECT * INTO s FROM s8r;

  PERFORM pg_temp.s8f_eq('Z1 four weddings and two accounts, and no fifth of either: the tested one, the '
    'stranger''s, the one with an empty guest list, and the one with no publication. This file created '
    'nothing else and deleted nothing outside itself',
    ARRAY[(SELECT count(*)::text FROM public.weddings
             WHERE id IN (s.wed_a, s.wed_b, s.wed_empty, s.wed_nopub)),
          (SELECT count(*)::text FROM auth.users
             WHERE id IN (s.owner_a, s.owner_b))]::text[],
    ARRAY['4', '2']::text[]);

  PERFORM pg_temp.s8f_eq('Z2 six households and five scope rows, in the shape the cast was written in: '
    'two families at both live events, one at one, one at none, and the two households of the other '
    'weddings untouched by any mint. No household was removed, so the guest list a host screen would '
    'show is the one this file started with',
    ARRAY[(SELECT count(*)::text FROM public.guest_households),
          (SELECT count(*)::text FROM public.household_event_scopes),
          (SELECT count(*)::text FROM public.household_event_scopes
             WHERE wedding_id = s.wed_b OR wedding_id = s.wed_nopub)]::text[],
    ARRAY['6', '5', '0']::text[]);

  PERFORM pg_temp.s8f_eq('Z3 the credential arithmetic this battery produced, named per family rather '
    'than summed: Chennakrishna one row retired by R, Baby three rows all retired (H''s, W''s successor, '
    'R''s successor) with T finishing the rotation it never got, Nair one row still live, Raman three '
    'rows — the aged one, the re-sent one R retired to rotate it, and the successor still live. Eight '
    'guest rows on this wedding, two of them live',
    ARRAY[(SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'),
          (SELECT coalesce(string_agg(x.n || ':' || x.live || '/' || x.all_, ' ' ORDER BY x.n COLLATE "C"), '-')
             FROM (SELECT 'chenna' AS n,
                          (SELECT count(*) FROM private.access_tokens t
                            WHERE t.household_id = s.hh_chenna AND t.revoked_at IS NULL)::text AS live,
                          (SELECT count(*) FROM private.access_tokens t
                            WHERE t.household_id = s.hh_chenna)::text AS all_
             UNION ALL
             SELECT 'baby',
                    (SELECT count(*) FROM private.access_tokens t
                      WHERE t.household_id = s.hh_baby AND t.revoked_at IS NULL)::text,
                    (SELECT count(*) FROM private.access_tokens t
                      WHERE t.household_id = s.hh_baby)::text
             UNION ALL
             SELECT 'nair',
                    (SELECT count(*) FROM private.access_tokens t
                      WHERE t.household_id = s.hh_nair AND t.revoked_at IS NULL)::text,
                    (SELECT count(*) FROM private.access_tokens t
                      WHERE t.household_id = s.hh_nair)::text
             UNION ALL
             SELECT 'raman',
                    (SELECT count(*) FROM private.access_tokens t
                      WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL)::text,
                    (SELECT count(*) FROM private.access_tokens t
                      WHERE t.household_id = s.hh_raman)::text) x),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id <> s.wed_a AND t.token_kind = 'guest_invitation')]::text[],
    ARRAY['8', 'baby:0/3 chenna:0/1 nair:1/1 raman:1/3', '0']::text[]);

  PERFORM pg_temp.s8f_eq('Z4 the wedding''s own public link survived all of it: one live '
    '`public_invitation` row on this wedding, which is what battery 2 needs in order to measure that a '
    'wedding-token rotation cannot reach a household row, and the half of Ruling 8.1 that says the '
    'document door and the household doors are different credentials on the same wedding',
    ARRAY[(SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'public_invitation'
              AND t.revoked_at IS NULL),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.token_hash !~ '^[0-9a-f]{64}$')]::text[],
    ARRAY['1', '0']::text[]);

  PERFORM pg_temp.s8f_eq('Z5 three answers, all of them written by the host through their own RLS '
    'policy in group T, all of them `host_manual`, two for the withdrawn family and one for the rotated '
    'one — so battery 2''s override test has a previous answer to override and this file''s '
    '"only the secret dies" has a reply that outlived a withdrawal',
    ARRAY[(SELECT count(*)::text FROM public.rsvp_responses),
          (SELECT coalesce(string_agg(DISTINCT response_source COLLATE "C", ',' ORDER BY response_source COLLATE "C"), '-')
             FROM public.rsvp_responses),
          (SELECT count(*)::text FROM public.rsvp_responses r
             WHERE r.household_id IN (s.hh_nair, s.hh_raman))]::text[],
    ARRAY['3', 'host_manual', '0']::text[]);

  PERFORM pg_temp.s8f_eq('Z6 the invitation history is where the fixture put it: two versions and one '
    'active publication on the tested wedding, still pinned to the first version — nothing in groups H '
    'through G published a second time, which is what keeps every household credential in Z3 pinned to '
    'the same document it was minted against',
    ARRAY[(SELECT count(*)::text FROM public.invitation_versions WHERE wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.publications p
             WHERE p.wedding_id = s.wed_a AND p.status = 'active'),
          (SELECT (p.version_id = current_setting('s8f.v1')::uuid)::text
             FROM public.publications p
            WHERE p.wedding_id = s.wed_a AND p.status = 'active'),
          (SELECT count(*)::text FROM public.publications p
             WHERE p.wedding_id = s.wed_b AND p.status = 'active')]::text[],
    ARRAY['2', '1', 'true', '0']::text[]);

  PERFORM pg_temp.s8f_eq('Z7 the probe census for the whole file, declared and measured together: '
    'thirty in B (B1 3, B2 3, B3 1, B4 2, B5 1, B6 1, B7 3, B8 3, B9 3, B10 4, B11 4, B12 2), one in W, '
    'five in S, one in A, two in R and four in G (GA 2, GB 1, GC 1) — forty-three refusals, every one '
    'of which was run. A group whose rows were deleted, or whose `run()` was never called, would leave '
    'this number wrong rather than this file quietly green',
    (SELECT count(*) FROM probes), 43::bigint);
END $Z$;

-- --------------------------------------------------------------------------- L: the floor
-- The floor is the authored count at this head, not a rounded-down guess. It exists so that a skipped
-- group — a `DO` block that never ran, a probe group whose rows were deleted — cannot read as a pass.
-- The assertion is made *through* the counter, so the printed total and the observed PASS lines cannot
-- drift apart.
--
-- 181 is the number of assertions this file declares before the floor line itself, counted mechanically
-- rather than estimated, against the file as it stands at this head. Every increment in this battery comes
-- from one of three call sites, each of which adds exactly one: inside `ok`, inside `eq`, and once per probe
-- row inside `run`. No call site lives in a loop, so the text count and the run count are the same number,
-- and the instrument is anchored to the start of a statement, because that is the form prose cannot move: the
-- draft this line replaces counted with an unanchored search, and its own comment spelled the patterns out in
-- full, so each of its three totals carried the line that quoted it:
--
--   grep -cE '^[[:space:]]*PERFORM pg_temp\.s8f_eq\('        -> 121, one of which is the call inside
--                                                             `s8f_has_keys`'s own body, so 120 direct
--                                                             equalities
--   grep -cE '^[[:space:]]*PERFORM pg_temp\.s8f_ok\('        ->  16, and the last of them is the L1 pass
--                                                             below, so 15 before the floor line
--   grep -cE '^[[:space:]]*PERFORM pg_temp\.s8f_has_keys\('  ->   3, each incrementing once through that
--                                                             inner call
--   grep -cE "^\s*\('(B[0-9]+|W1|S1|A1|R[12]|G[ABC])',"      ->  43 refusals, which `run()` counts one per
--                                                             probe
--
-- 120 + 15 + 3 + 43 = 181, and this L1 pass is the 182nd assertion the closing line reports. The previous
-- draft of this line asserted 183, and both of its errors are visible above: it read the eq total from an
-- unanchored `grep -c`, which also matched the line of its own comment quoting the pattern, then subtracted
-- the inner call from that already-inflated total instead of from the anchored one, and finally counted all
-- sixteen `ok` occurrences as though none of them were this floor line's own pass. The corrected
-- subtraction moves two assertions, not one, because each of those two mistakes contributed one. An even
-- earlier draft said 182, which was true of the file before group G gained its last assertion; the re-count
-- that caught it was itself done with the polluted instrument, so that repair was incomplete. This is it
-- finished.
--
-- The pollution is worth demonstrating rather than asserting, and the demonstration is that this comment is
-- written so it cannot cause one: every pattern above is quoted escaped (`pg_temp\.s8f_eq\(`) or bracketed
-- (`pg_temp[.]s8f_eq`), neither of which an unanchored search for the literal call text matches. So at this
-- head the two forms agree — 121, 16 and 3 whether or not the anchor is present — and the anchor is kept
-- because it is the form prose cannot move, not because the two currently differ. The draft's three
-- unanchored readings (122, 17 and 4) are named as history: that comment quoted all three patterns in full,
-- so each count carried its own quoting line, and no command re-run here will reproduce those three numbers.
--
-- The number is written out because a bare floor would have to be re-derived by hand anyway; the first run
-- prints its own total one line below, and if the two disagree the difference is a group that did not run —
-- the repair is to find that group, not to move this number.
DO $L$
DECLARE ran integer;
BEGIN
  ran := coalesce(nullif(current_setting('s8f.passed', true), ''), '0')::int;
  IF ran < 181 THEN
    RAISE EXCEPTION 'FAIL: only % Stage 8 link assertions ran — the authored floor is 181 (the closing '
      'line reports one more, this L1 assertion itself)', ran;
  END IF;
  PERFORM pg_temp.s8f_ok('L1 the counter, the fixtures and the floor all moved together ('
    || ran || ' assertions)', true);
END $L$;

SELECT 'STAGE8 GUEST LINKS TESTS PASSED (' || current_setting('s8f.passed') || ')';
