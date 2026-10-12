-- Stage 8 battery 2: the guest's two doors — what a household's secret opens, what it never shows,
-- what an answer writes beside it, and what a revision, a rotation and a takedown do to all of that.
--
-- Run by `supabase/tests/stage8/run.sh` after battery 1, as the superuser, in one transaction that
-- commits. Battery 1 leaves its residue on this chain and this file reads it the way Stage 7's second
-- battery reads the first one's (`stage7/90_review_boundary.sql:365-382`): the cast below is a SELECT
-- over committed rows, and where an expectation depends on that residue the label says so and names
-- the battery-1 assertion that pins it. If the residue is not what battery 1 claimed, battery 1 has
-- already failed and stopped the run before this file is reached.
--
--   X  the cast: the residue read back, two households the host adds after publication, and the
--      credentials this file mints because a raw secret is legible exactly once
--   D  §4 — the shape of an opened door: four top-level names, the guest object's eight, the event
--      item's eight, and the invitation half being `private.public_invitation_dto` and nothing else
--   E  §6 — the household's own event list: the document's order, `enabled = false` left out, the
--      greeting fallback, the deadline, and the zero-event family the guest can open but not answer
--   K  §5 — canaries planted in the private columns first, then proved absent from the answer: a
--      host's note, a name the host recorded, another family's answer, another wedding's data, and
--      other households' secrets
--   U  the nine ways a read is refused, all of them one byte-identical answer, with a live
--      credential as the control that the answer is a refusal and not a broken door
--   N  `last_used_at` — written by a read that worked, unmoved by an answer, by a withdrawal and by
--      a storm of forged probes
--   A  §4.1/§4.2 — the answer door: the shape family that raises before the credential is read, the
--      two correctable answer problems, and the access family that answers `unavailable` and writes
--      nothing
--   M  §7 — who may write an answer, in which direction: a host cannot record `guest`, cannot edit a
--      guest's row without relabelling it as their own, and the column CHECK is not the wall
--   S  the write authority read out of the catalog rather than inferred from a passing write
--   P  §6 Ruling 8.1's first sentence — a corrected version moves every live household credential with it
--   Pb Ruling 8.1's second sentence — a rotation of the wedding link cannot touch one of them
--   Q  Ruling 8.1's other half — a takedown withdraws both kinds, leaves every row of the household
--      and its answers in place, and cannot be undone by republishing
--   Z  the census this file leaves behind, named rather than counted where a count can lie
--   L  the floor
--
-- Where a refusal is measured it is measured twice, the SQLSTATE and the sentence, for the reason
-- battery 1 gives at its own head: `left(SQLSTATE,5)` cannot tell a syntax error from a security
-- refusal and this repository has already made that mistake once. Refusals that *answer* rather than
-- raise (`{"available": false}`, `{"recorded": false, "reason": "unavailable"}`) cannot be probes —
-- `run()` fails a probe that returns no error — so groups U, N, P and Q measure them through the door
-- helpers and assert the exact bytes, and the probe groups below are limited to the families that
-- genuinely raise.
--
-- The role discipline mirrors the product, not the test. Host verbs run as `authenticated` with
-- `test.uid` naming the account. Both guest doors run as `anon` with the header PostgREST would write,
-- because a guest has no account and `anon` is therefore the only role they can ever be. Client DML
-- runs as `authenticated` too, so an RLS refusal is measured against the policy rather than against a
-- write the owner made and then described.
--
-- Values a probe needs while it holds a role are carried in `s8b.*` settings, never read from
-- `pg_temp`: an impersonated role cannot see this file's temp fixture, and a probe that could only run
-- as the superuser would not be testing the caller it names.
--
-- Three things this battery does not claim:
--   1. It is not the HTTP tier. No PostgREST, Kong or Auth is present, so nothing here proves a status
--      code or a wire body; `x-guest-token` reaches the door only as `request.headers`, which is the
--      setting PostgREST writes and nothing more. That boundary belongs to `tests/api/`.
--   2. The direct writes into `private.access_tokens` and the ageing of a deadline are not product
--      paths. No client role may write that table at all (`20260925120400...:198`), which is why the
--      table's own rules can only be measured by the role that owns them.
--   3. Group Q's FK refusal is measured as the owner. It is a statement about the schema's teardown
--      order (`guest-rsvp-security.md` §12), not about a verb a host can call.

SET client_min_messages = notice;
SET search_path = public, pg_temp;

-- --------------------------------------------------------------------------- the harness
SELECT set_config('s8b.passed', '0', false);

CREATE FUNCTION pg_temp.s8b_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s8b.passed',
    (coalesce(nullif(current_setting('s8b.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s8b_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s8b_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s8b_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s8b_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s8b_sorted(want text[]) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM unnest(coalesce(want, '{}'::text[])) u(k) $fn$;

CREATE FUNCTION pg_temp.s8b_top_keys(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM jsonb_object_keys(v) u(k) $fn$;

-- A flat jsonb object's complete top-level content — every name *and* its value — in an order this file
-- owns. Written because `s8b_answer(...)::text` is not a stable way to name an object: PostgreSQL prints
-- jsonb keys in storage order (shorter keys first, then byte order), not in the order
-- `jsonb_build_object` was written, so a literal like `{"recorded": false, "reason": "unavailable"}` is
-- a claim about an internal ordering rather than about the answer. This renders the same fact through
-- the same `COLLATE "C"` ordering `s8b_top_keys` uses, so it pins the key set, both values, and the
-- absence of a third name, without depending on anything the server sorts behind the scenes.
-- Only for flat objects: a nested value would arrive through `->>`, which returns its JSON text.
CREATE FUNCTION pg_temp.s8b_pairs(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k || '=' || (v ->> k) ORDER BY k COLLATE "C"), '{}'::text[])
    FROM jsonb_object_keys(coalesce(v, '{}'::jsonb)) u(k) $fn$;

-- A jsonb object's top-level inventory, asserted as a set. Used wherever the claim is "and no fifth
-- name", because a count of keys cannot tell a renamed channel from a missing one.
CREATE FUNCTION pg_temp.s8b_has_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % , not an object', label, jsonb_typeof(v);
  END IF;
  PERFORM pg_temp.s8b_eq(label, pg_temp.s8b_top_keys(v), pg_temp.s8b_sorted(want));
END $fn$;

-- A jsonb array read as a sorted set, for the claims about *which* events a household was shown
-- rather than the order they arrived in.
CREATE FUNCTION pg_temp.s8b_arr(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT pg_temp.s8b_sorted(coalesce(array_agg(q.e), '{}'::text[]))
    FROM jsonb_array_elements_text(coalesce(v, '[]'::jsonb)) q(e) $fn$;

CREATE TEMP TABLE probes (
  grp         text,
  label       text,
  stmt        text,
  want_state  text,
  want_like   text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.s8b_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

CREATE FUNCTION pg_temp.s8b_run(p_grp text, p_role text, p_uid text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  v_labels text[];
  v_stmts  text[];
  v_states text[];
  v_likes  text[];
  v        text;
  i        integer;
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;

  SELECT array_agg(label), array_agg(stmt), array_agg(want_state), array_agg(want_like)
    INTO v_labels, v_stmts, v_states, v_likes
    FROM (SELECT p.label, p.stmt, p.want_state, p.want_like
            FROM probes p WHERE p.grp = s8b_run.p_grp ORDER BY p.label) s;

  IF v_labels IS NULL THEN
    RAISE EXCEPTION 'FAIL: probe group % ran no probes — an empty group is a skip, not a pass', p_grp;
  END IF;

  FOR i IN 1 .. cardinality(v_labels) LOOP
    EXECUTE 'SET ROLE ' || p_role;
    IF p_uid IS NOT NULL THEN
      PERFORM set_config('test.uid', p_uid, false);
    END IF;
    v := pg_temp.s8b_err(v_stmts[i]);
    EXECUTE 'RESET ROLE';

    IF v = 'no-error' THEN
      RAISE EXCEPTION 'FAIL %: "%" was allowed through', p_grp, v_labels[i];
    END IF;
    IF split_part(v, ' ', 1) <> v_states[i] OR v NOT LIKE v_likes[i] THEN
      RAISE EXCEPTION 'FAIL %: "%" got [%] want [% / %]',
        p_grp, v_labels[i], v, v_states[i], v_likes[i];
    END IF;
    RAISE NOTICE 'PASS %: %', p_grp, v_labels[i];
    PERFORM pg_temp.s8b_add(1);
  END LOOP;
END $fn$;

-- A host verb called by the account that owns the wedding, with the answer handed back. A refusal
-- inside this helper is a defect of the battery or of the product, never a measured answer; the
-- measured refusals are groups A, M and S.
CREATE FUNCTION pg_temp.s8b_auth(uid text, stmt text) RETURNS jsonb
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

-- A client write a host is entitled to make, measured as that host, returning the row count so a
-- silent no-op can be told from an accepted write. That distinction is the whole of M3: RLS answers a
-- row the caller may not see by matching nothing, not by raising, and a helper that reported only
-- "no error" would turn a cross-tenant no-op into a pass.
CREATE FUNCTION pg_temp.s8b_host_write(uid text, stmt text) RETURNS bigint
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

-- The read door: same header, same zero-argument resolver, same role a guest can only ever be.
-- `raw IS NULL` sends no header at all, which is one of the nine refusals rather than a skip.
CREATE FUNCTION pg_temp.s8b_door(raw text) RETURNS jsonb
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

-- The answer door, the same way: the credential arrives in the header and only the answers arrive as
-- an argument. A body this file expects to raise propagates, so group A's exception family can be
-- asserted through `run()` with the header already in place.
CREATE FUNCTION pg_temp.s8b_answer(raw text, body jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.headers',
    CASE WHEN raw IS NULL THEN '{}'::text
         ELSE jsonb_build_object('x-guest-token', raw)::text END, false);
  EXECUTE 'SET ROLE anon';
  BEGIN
    SELECT api.submit_guest_rsvp(body) INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $fn$;

-- Header only, for the probe groups whose statements must raise. `set_config` here is session-level,
-- so it survives the `SET ROLE` inside `run()` and the credential a probe is answered with is the one
-- the label names.
CREATE FUNCTION pg_temp.s8b_send(raw text) RETURNS void
LANGUAGE sql AS $fn$
  SELECT set_config('request.headers',
    CASE WHEN raw IS NULL THEN '{}'::text
         ELSE jsonb_build_object('x-guest-token', raw)::text END, false) $fn$;

-- The wedding-level door, for the one claim in P that cannot be made without it: a household secret
-- and the wedding's secret are different credentials for different documents, and the same header
-- mechanism opens only one of them. `x-invitation-token` is the name Stage 3's resolver reads, verified
-- at `20260926130000_stage3_publication_resolution_boundary.sql:1033` rather than inferred from its
-- wrapper, and Stage 8's two doors read `x-guest-token` (`20261009120000...:583,829`).
CREATE FUNCTION pg_temp.s8b_public_door(raw text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.headers',
    CASE WHEN raw IS NULL THEN '{}'::text
         ELSE jsonb_build_object('x-invitation-token', raw)::text END, false);
  EXECUTE 'SET ROLE anon';
  BEGIN
    SELECT api.resolve_public_invitation() INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $fn$;

-- The scan that backs "a raw credential never enters a database record", over every text-shaped
-- column of every base table in both schemas the product owns. Deliberately no exception handler: a
-- relation this cannot read is a broken fixture and must stop the run rather than be skipped into a
-- quiet pass. Battery 1 runs the same scan for its own secrets; a second copy is here because the
-- secrets differ and a scan that only ever ran over one family's links would not catch a leak this
-- file introduces.
CREATE FUNCTION pg_temp.s8b_stored_hits(raw text) RETURNS text[]
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

-- --------------------------------------------------------------------------- the cast
-- Everything below is read out of the rows battery 1 committed, joined on the strings that fixture
-- wrote (titles, display names, event keys, version numbers) rather than on ids this file could only
-- have guessed. The join is deliberately wide: it names the four households of the tested wedding,
-- the stranger's household on the other wedding, three events plus the other wedding's one event, the
-- two frozen versions and the live publication, and X1 then asserts that this produced exactly one
-- row. A cast that fanned out would silently multiply every count in this file, so the fan-out is
-- measured rather than assumed.
CREATE TEMP TABLE s8c ON COMMIT DROP AS
SELECT wa.id AS wed_a, wa.owner_user_id AS owner_a,
       wb.id AS wed_b, wb.owner_user_id AS owner_b,
       v1.id AS ver1, v2.id AS ver2,
       pub.id AS pub1,
       hc.id AS hh_chenna, hb.id AS hh_baby, hn.id AS hh_nair, hr.id AS hh_raman,
       hs.id AS hh_stranger,
       em.id AS ev_muurtham, er.id AS ev_reception, ef.id AS ev_farewell,
       eh.id AS ev_haldi
  FROM public.weddings wa
  JOIN public.weddings wb ON wb.title = 'Bala weds Divya'
  JOIN public.guest_households hc ON hc.wedding_id = wa.id AND hc.display_name = 'Chennakrishna Iyer'
  JOIN public.guest_households hb ON hb.wedding_id = wa.id AND hb.display_name = 'The Baby family'
  JOIN public.guest_households hn ON hn.wedding_id = wa.id AND hn.display_name = 'The Nair family'
  JOIN public.guest_households hr ON hr.wedding_id = wa.id AND hr.display_name = 'The Raman family'
  JOIN public.guest_households hs ON hs.wedding_id = wb.id AND hs.display_name = 'The Cousin family'
  JOIN public.wedding_events em ON em.wedding_id = wa.id AND em.event_key = 'muurtham'
  JOIN public.wedding_events er ON er.wedding_id = wa.id AND er.event_key = 'reception'
  JOIN public.wedding_events ef ON ef.wedding_id = wa.id AND ef.event_key = 'farewell'
  JOIN public.wedding_events eh ON eh.wedding_id = wb.id AND eh.event_key = 'haldi'
  JOIN public.invitation_versions v1 ON v1.wedding_id = wa.id AND v1.version_number = 1
  JOIN public.invitation_versions v2 ON v2.wedding_id = wa.id AND v2.version_number = 2
  JOIN public.publications pub ON pub.wedding_id = wa.id AND pub.status = 'active'
 WHERE wa.title = 'Asha weds Bala';

-- The GUCs probes reach while holding a client role, and the canaries the privacy groups need. The
-- marker strings are this file's own, and they are written into the *private* columns of the fixture
-- so that every "the guest is not shown X" below has an X that exists: Stage 7's K group is the
-- precedent for the shape, and battery 1's F5 is the same claim one stage earlier.
SELECT set_config('s8b.wed_a', '', false);
SELECT set_config('s8b.wed_b', '', false);
SELECT set_config('s8b.hh_nair', '', false);
SELECT set_config('s8b.hh_stranger', '', false);
SELECT set_config('s8b.hh_pillai', '', false);
SELECT set_config('s8b.hh_idaveli', '', false);
SELECT set_config('s8b.ev_muurtham', '', false);
SELECT set_config('s8b.ev_reception', '', false);
SELECT set_config('s8b.ev_farewell', '', false);
SELECT set_config('s8b.ev_haldi', '', false);
SELECT set_config('s8b.raw_chenna', '', false);
SELECT set_config('s8b.raw_baby', '', false);
SELECT set_config('s8b.raw_pillai', '', false);
SELECT set_config('s8b.raw_idaveli', '', false);
SELECT set_config('s8b.raw_raman', '', false);
SELECT set_config('s8b.raw_stranger', '', false);
SELECT set_config('s8b.raw_nair2', '', false);
SELECT set_config('s8b.raw_wedb_pub', '', false);
SELECT set_config('s8b.raw_idaveli2', '', false);
SELECT set_config('s8b.pub_now', '', false);
SELECT set_config('s8b.mk_note',        'ZZ-S8B-HOST-ONLY-TRAVEL-NOTE', false);
SELECT set_config('s8b.mk_name',        'ZZ-S8B-PRIVATE-NAME-NITHYA', false);
SELECT set_config('s8b.mk_other_answer','ZZ-S8B-MEAL-ANSWER-BABY', false);
SELECT set_config('s8b.mk_draft3',      'ZZ-S8B-VERSION-THREE-WELCOME', false);
SELECT set_config('s8b.mk_draft4',      'ZZ-S8B-VERSION-FOUR-WELCOME', false);

-- --------------------------------------------------------------------------- X: the cast, extended
-- Two households the host adds *after* the wedding was published, by client DML rather than as the
-- owner, because "a household created after publication can be sent a link" is a product claim and it
-- only means something if the row arrived the way a host's screen sends it. The second is deliberately
-- scoped to nothing: Stage 2 rules a zero-event household representable and a data error to surface
-- rather than a silent "invited to nothing" (`20260925120300...:43-45`), and battery 1 already holds
-- that shape at the host's read. Here it has to be held at the guest's door too, because the door is
-- where `can_respond` is decided.
DO $X$
DECLARE s s8c%ROWTYPE; v jsonb; w jsonb; n bigint; raw text;
        ids text[]; hits text[] := '{}'::text[]; bad_hits text[] := '{}'::text[];
BEGIN
  SELECT * INTO s FROM s8c;
  PERFORM set_config('s8b.wed_a',        s.wed_a::text, false);
  PERFORM set_config('s8b.owner_a',      s.owner_a::text, false);
  PERFORM set_config('s8b.wed_b',        s.wed_b::text, false);
  PERFORM set_config('s8b.owner_b',      s.owner_b::text, false);
  PERFORM set_config('s8b.ver1',         s.ver1::text, false);
  PERFORM set_config('s8b.ver2',         s.ver2::text, false);
  PERFORM set_config('s8b.pub1',         s.pub1::text, false);
  PERFORM set_config('s8b.pub_now',      s.pub1::text, false);
  PERFORM set_config('s8b.hh_chenna',    s.hh_chenna::text, false);
  PERFORM set_config('s8b.hh_baby',      s.hh_baby::text, false);
  PERFORM set_config('s8b.hh_nair',      s.hh_nair::text, false);
  PERFORM set_config('s8b.hh_raman',     s.hh_raman::text, false);
  PERFORM set_config('s8b.hh_stranger',  s.hh_stranger::text, false);
  PERFORM set_config('s8b.ev_muurtham',  s.ev_muurtham::text, false);
  PERFORM set_config('s8b.ev_reception', s.ev_reception::text, false);
  PERFORM set_config('s8b.ev_farewell',  s.ev_farewell::text, false);
  PERFORM set_config('s8b.ev_haldi',     s.ev_haldi::text, false);

  PERFORM pg_temp.s8b_eq('X1 the cast is exactly one row — every count in this file is a count over '
    'one line of it, so a join that fanned out here would multiply all of them rather than empty any '
    'of them, which is the direction a silent-pass bug takes',
    (SELECT count(*) FROM s8c), 1::bigint);

  PERFORM pg_temp.s8b_eq('X2 the residue battery 1 left: the tested wedding has two frozen versions '
    'and its one active publication names the first of them, and the second version was never published '
    '— that unpublished row is what group P needs, so it is asserted as a precondition here rather than '
    'discovered as a missing fixture forty assertions later. Battery 1''s Z6 pins the same pair; if this '
    'disagrees, battery 1 has already failed and stopped the run',
    ARRAY[(SELECT count(*)::text FROM public.invitation_versions x
            WHERE x.wedding_id = s.wed_a),
          (SELECT v.version_number::text FROM public.publications p
             JOIN public.invitation_versions v ON v.id = p.version_id
            WHERE p.id = s.pub1)]::text[],
    ARRAY['2', '1']::text[]);

  PERFORM pg_temp.s8b_eq('X3 the residue''s guest list: four households, five scope rows between them, '
    'and exactly one household scoped to nothing',
    ARRAY[(SELECT count(*)::text FROM public.guest_households h
            WHERE h.wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.household_event_scopes q
            WHERE q.wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.guest_households h
            WHERE h.wedding_id = s.wed_a
              AND NOT EXISTS (SELECT 1 FROM public.household_event_scopes q
                               WHERE q.household_id = h.id))]::text[],
    ARRAY['4', '5', '1']::text[]);

  -- The source column is the one this file is about, so the residue is read as a pair: the three rows
  -- battery 1 recorded by hand, and the zero rows that came through a guest door, which is the whole
  -- of §7''s claim that this stage is the first writer of `guest`.
  PERFORM pg_temp.s8b_eq('X4 the residue''s answers: three rows, all of them `host_manual`, and not one '
    'row anywhere on this wedding whose source is `guest` — so every `guest` row asserted below is this '
    'file''s doing and no earlier stage left one behind',
    ARRAY[(SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.wedding_id = s.wed_a AND r.response_source = 'host_manual'),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.wedding_id = s.wed_a AND r.response_source = 'guest')]::text[],
    ARRAY['3', '3', '0']::text[]);

  PERFORM pg_temp.s8b_eq('X5 the residue''s credentials, counted against battery 1''s own Z3 rather than '
    'against a summary of it: eight household rows on this wedding, two of them unrevoked (the Nair '
    'family''s untouched no-deadline link and the Raman family''s rotation successor), neither of them '
    'expired, and one live wedding-level row. A raw secret is legible once and is not recoverable, so two '
    'live rows with no readable secret are why this file mints its own',
    ARRAY[(SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NULL),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NULL AND t.expires_at IS NOT NULL AND t.expires_at <= now()),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'public_invitation'
              AND t.revoked_at IS NULL)]::text[],
    ARRAY['8', '2', '0', '1']::text[]);

  -- The other wedding has no active publication — battery 1 left it that way on purpose, because two
  -- of its refusals need a wedding with a household and nothing published. Publishing it now, through
  -- its own owner, is the precondition for the only cross-tenant credential this file can honestly
  -- mint: a real link belonging to a real family of a real *other* wedding.
  v := pg_temp.s8b_auth(s.owner_b::text,
    'SELECT api.publish_invitation_version(' || quote_literal(s.wed_b::text) || '::uuid, '
    || quote_literal((SELECT x.id::text FROM public.invitation_versions x
                       WHERE x.wedding_id = s.wed_b AND x.version_number = 1)) || '::uuid, NULL)');
  PERFORM pg_temp.s8b_eq('X6 the other wedding now has one active publication naming its first version, '
    'and the send for it answered issued rather than already_live: a household link is scoped to its own '
    'wedding''s document, so publishing here cannot have re-pinned the tested wedding''s rows',
    ARRAY[(SELECT count(*)::text FROM public.publications p
            WHERE p.wedding_id = s.wed_b AND p.status = 'active'),
          (v ->> 'link_reused'),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.revoked_at IS NULL
              AND t.publication_id <> s.pub1)]::text[],
    ARRAY['1', 'false', '0']::text[]);
  -- Captured for group U's cross-kind probes: this is a *live, unknown-to-the-guest-door* secret of the
  -- other kind, so feeding it to `x-guest-token` distinguishes "the kind column refused it" from
  -- "nothing was ever found", which a forged string cannot do on its own.
  PERFORM set_config('s8b.raw_wedb_pub', substr(v ->> 'path', 4), false);

  -- The two new households, written as the host. The ids are then read back from the table by the name
  -- the write used, exactly as battery 1 reads back a publication pointer, because an id this helper
  -- handed back would be this file''s own claim rather than the schema''s.
  n := pg_temp.s8b_host_write(s.owner_a::text,
    'INSERT INTO public.guest_households (wedding_id, display_name, salutation, '
    || 'expected_party_size, host_notes) VALUES ('
    || quote_literal(s.wed_a::text) || '::uuid, ''The Pillai household'', '
    || '''Dear Pillai family'', 2, '
    || quote_literal(current_setting('s8b.mk_note') || ' and ' || current_setting('s8b.mk_name'))
    || ')');
  PERFORM pg_temp.s8b_eq('X7 RLS let the owner add a household, and the row is there: one row for that '
    'display name, carrying the private note the guest must never be shown. The write is measured by its '
    'row count, not by the absence of an error',
    ARRAY[n::text,
          (SELECT count(*)::text FROM public.guest_households h
            WHERE h.wedding_id = s.wed_a AND h.display_name = 'The Pillai household'),
          (SELECT (h.host_notes LIKE '%' || current_setting('s8b.mk_note')
                              || '%' || '%' || current_setting('s8b.mk_name') || '%')::text
             FROM public.guest_households h WHERE h.display_name = 'The Pillai household')]::text[],
    ARRAY['1', '1', 'true']::text[]);

  n := pg_temp.s8b_host_write(s.owner_a::text,
    'INSERT INTO public.guest_households (wedding_id, display_name) VALUES ('
    || quote_literal(s.wed_a::text) || '::uuid, ''The Idaveli household'')');
  PERFORM pg_temp.s8b_eq('X8 and the second one arrives with neither a salutation nor a party size — the '
    'fallback and the NULL are real rows here, not hypotheses, and this household is deliberately scoped '
    'to nothing',
    ARRAY[n::text,
          (SELECT count(*)::text FROM public.household_event_scopes q
            WHERE q.household_id = (SELECT h.id FROM public.guest_households h
                                     WHERE h.display_name = 'The Idaveli household'))]::text[],
    ARRAY['1', '0']::text[]);

  PERFORM set_config('s8b.hh_pillai',
    (SELECT h.id::text FROM public.guest_households h
      WHERE h.wedding_id = s.wed_a AND h.display_name = 'The Pillai household'), false);
  PERFORM set_config('s8b.hh_idaveli',
    (SELECT h.id::text FROM public.guest_households h
      WHERE h.wedding_id = s.wed_a AND h.display_name = 'The Idaveli household'), false);

  -- The new family's scope is deliberately lopsided: one event the couple is running and the one they
  -- switched off. Every other household in the fixture has a scope set that equals the enabled set
  -- (Chennakrishna and Baby at both live events, Nair at one, Raman and Idaveli at none), so for them a
  -- door that filtered on scope alone and a door that filtered on `enabled` alone would answer the same
  -- cards. This row pair is the only shape in the product's own vocabulary that separates the two
  -- `NOT EXISTS`/`JOIN` halves at `:662` and `:889-900`, and it arrives the way a host's screen sends
  -- it — client DML under the owner policy, not a fixture insert.
  n := pg_temp.s8b_host_write(s.owner_a::text,
    'INSERT INTO public.household_event_scopes (wedding_id, household_id, event_id) VALUES '
    || '(' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s8b.hh_pillai')) || '::uuid, '
    || quote_literal(s.ev_muurtham::text) || '::uuid), '
    || '(' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s8b.hh_pillai')) || '::uuid, '
    || quote_literal(s.ev_farewell::text) || '::uuid)');
  PERFORM pg_temp.s8b_eq('X9 the new family now holds two scope rows, one of an event the couple is '
    'running and one of the event they switched off — the schema accepts the assignment without checking '
    'the switch, which is what makes the door''s own `enabled` test a live question rather than a dead '
    'code path. Two rows landed, one of each kind, and the write is measured by row count',
    ARRAY[n::text,
          (SELECT count(*)::text FROM public.household_event_scopes q
            WHERE q.household_id = current_setting('s8b.hh_pillai')::uuid
              AND q.event_id = s.ev_muurtham),
          (SELECT count(*)::text FROM public.household_event_scopes q
            WHERE q.household_id = current_setting('s8b.hh_pillai')::uuid
              AND q.event_id = s.ev_farewell)]::text[],
    ARRAY['2', '1', '1']::text[]);

  -- The other wedding's family needs a scoped event of its own, or the cross-tenant assertions below are
  -- satisfied by a door that answers nothing: K9 is the positive half of K7's absences, E3 counts its card
  -- in the census, and A9 has to be able to aim a real answer at `ev_haldi`. Written by its own owner
  -- through client DML under `owners_manage_scopes`, the same shape X9 used, so nothing here reaches
  -- across the tenant boundary to invent the fact it is meant to prove.
  n := pg_temp.s8b_host_write(s.owner_b::text,
    'INSERT INTO public.household_event_scopes (wedding_id, household_id, event_id) VALUES ('
    || quote_literal(s.wed_b::text) || '::uuid, '
    || quote_literal(s.hh_stranger::text) || '::uuid, '
    || quote_literal(s.ev_haldi::text) || '::uuid)');
  PERFORM pg_temp.s8b_eq('X9b the second tenant''s family is scoped to the one event of its own wedding — '
    'the write is measured by row count and read back from the scope table, because a household with no '
    'scope cannot demonstrate that the door confined it rather than ignored it',
    ARRAY[n::text,
          (SELECT count(*)::text FROM public.household_event_scopes q
            WHERE q.household_id = s.hh_stranger AND q.wedding_id = s.wed_b
              AND q.event_id = s.ev_haldi)]::text[],
    ARRAY['1', '1']::text[]);

  -- The mints. One call per shape, because a deadline is a property of the call rather than of the
  -- family, and because reading each raw back out of the answer by its own `household_id` — not by a
  -- position in the array — is what keeps this file honest about which secret belongs to whom.
  v := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, ARRAY['
    || quote_literal(s.hh_chenna::text) || '::uuid], now() + interval ''7 days'')');
  PERFORM set_config('s8b.raw_chenna',
    (SELECT substr(i ->> 'path', 4) FROM jsonb_array_elements(v -> 'invitations') i
      WHERE (i ->> 'household_id')::uuid = s.hh_chenna), false);

  w := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, ARRAY['
    || quote_literal(s.hh_baby::text) || '::uuid, '
    || quote_literal(current_setting('s8b.hh_pillai')) || '::uuid, '
    || quote_literal(current_setting('s8b.hh_idaveli')) || '::uuid], NULL)');
  ids := ARRAY[current_setting('s8b.raw_chenna'),
               (SELECT substr(i ->> 'path', 4) FROM jsonb_array_elements(w -> 'invitations') i
                 WHERE (i ->> 'household_id')::uuid = s.hh_baby),
               (SELECT substr(i ->> 'path', 4) FROM jsonb_array_elements(w -> 'invitations') i
                 WHERE (i ->> 'household_id')::uuid = current_setting('s8b.hh_pillai')::uuid),
               (SELECT substr(i ->> 'path', 4) FROM jsonb_array_elements(w -> 'invitations') i
                 WHERE (i ->> 'household_id')::uuid = current_setting('s8b.hh_idaveli')::uuid)];
  PERFORM set_config('s8b.raw_baby',   ids[2], false);
  PERFORM set_config('s8b.raw_pillai', ids[3], false);
  PERFORM set_config('s8b.raw_idaveli', ids[4], false);

  PERFORM pg_temp.s8b_eq('X10 the four families the host had not written to are each answered `issued` '
    'with a path, in two calls that carried different deadlines, and the four secrets are four distinct '
    '43-character strings from the declared alphabet — one family''s link is never another''s',
    ARRAY[(SELECT count(*)::text FROM jsonb_array_elements(v -> 'invitations') i
            WHERE (i ->> 'status') = 'issued' AND (i ->> 'path') IS NOT NULL),
          (SELECT count(*)::text FROM jsonb_array_elements(w -> 'invitations') i
            WHERE (i ->> 'status') = 'issued' AND (i ->> 'path') IS NOT NULL),
          (cardinality(ids)::text),
          (cardinality(ARRAY(SELECT DISTINCT unnest(ids)))::text),
          (SELECT count(*)::text FROM unnest(ids) x
            WHERE octet_length(x) = 43 AND x ~ '^[A-Za-z0-9_-]+$')]::text[],
    ARRAY['1', '3', '4', '4', '4']::text[]);

  -- The Nair family already holds a live link battery 1 minted and never withdrew. Re-sending is the
  -- host checking their work, and the answer must be `already_live` with no path — the secret exists
  -- and this call is not the way to read it.
  v := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, ARRAY['
    || quote_literal(s.hh_nair::text) || '::uuid], NULL)');
  PERFORM pg_temp.s8b_eq('X11 §3.1 across batteries: a family with a live link is answered '
    '`already_live` with no path, nothing is minted, and the credential store still holds exactly one '
    'row for that family — a second send is not a way to read an old secret or to make a new one',
    ARRAY[(v ->> 'already_live'), (v ->> 'issued'),
          jsonb_typeof(v -> 'invitations' -> 0 -> 'path'),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_nair)]::text[],
    ARRAY['1', '0', 'null', '1']::text[]);

  -- The Raman family's one unrevoked row is battery 1's rotation successor: unrevoked, unexpired, and
  -- holding a secret this file never saw. A send for that family is the host checking their work, so the
  -- honest answer is `already_live` even though nothing here can open the link — and the escape is
  -- withdrawal, which works on the household rather than on the secret. The earlier draft of this group
  -- called this row "expired but unrevoked", which is what battery 1's group A left behind and *not* what
  -- its group R left behind after rotating it; R13 and R15 are the assertions that say so.
  v := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, ARRAY['
    || quote_literal(s.hh_raman::text) || '::uuid], NULL)');
  PERFORM pg_temp.s8b_eq('X12 a family whose only live credential was minted by another battery answers '
    '`already_live` with no path and no new row, and the row still carries the fixed deadline battery 1''s '
    'rotation handed it — `already_live` is a statement about the household''s slot, not about whether '
    'this caller can read the secret in it',
    ARRAY[(v ->> 'already_live'), (v ->> 'issued'),
          (SELECT array_agg(t.expiry_policy || '|' || (t.expires_at > now())::text)
             FROM private.access_tokens t
            WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL)::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_raman)]::text[],
    ARRAY['1', '0', '{fixed|true}', '3']::text[]);

  PERFORM pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.revoke_guest_invitation(' || quote_literal(s.hh_raman::text) || '::uuid)');
  v := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, ARRAY['
    || quote_literal(s.hh_raman::text) || '::uuid], NULL)');
  PERFORM set_config('s8b.raw_raman',
    (SELECT substr(i ->> 'path', 4) FROM jsonb_array_elements(v -> 'invitations') i
      WHERE (i ->> 'household_id')::uuid = s.hh_raman), false);
  PERFORM pg_temp.s8b_eq('X13 and once the host has withdrawn it the same send issues a new secret: '
    'withdrawal is addressed to the household rather than to the credential, so a family''s link is '
    'revocable even when its secret is legible only to the battery that minted it. The family now has '
    'four credential rows with one live among them — the history is kept, not rewritten — and the fresh '
    'one opens the door',
    ARRAY[(v ->> 'issued'),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_raman),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL),
          (pg_temp.s8b_door(current_setting('s8b.raw_raman')) ->> 'available')]::text[],
    ARRAY['1', '4', '1', 'true']::text[]);

  -- The foreign household's own link, minted by its own owner. This is the cross-tenant credential the
  -- privacy groups use: not a guess at another family''s secret but a working one.
  v := pg_temp.s8b_auth(s.owner_b::text,
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_b::text) || '::uuid, ARRAY['
    || quote_literal(s.hh_stranger::text) || '::uuid], NULL)');
  PERFORM set_config('s8b.raw_stranger',
    (SELECT substr(i ->> 'path', 4) FROM jsonb_array_elements(v -> 'invitations') i
      WHERE (i ->> 'household_id')::uuid = s.hh_stranger), false);
  PERFORM pg_temp.s8b_eq('X14 the other wedding''s family gets its own live link, and its door answer '
    'names its own household — the credential is scoped by the publication it is pinned to, which is '
    'what makes K8 a test rather than a tautology',
    ARRAY[(v ->> 'issued'),
          (pg_temp.s8b_door(current_setting('s8b.raw_stranger'))
             -> 'guest' ->> 'household_id'),
          (pg_temp.s8b_door(current_setting('s8b.raw_stranger')) ->> 'available')]::text[],
    ARRAY['1', s.hh_stranger::text, 'true']::text[]);

  -- Every secret this file minted, scanned out of the whole cluster rather than out of the one column
  -- that stores digests. The loop is over six raws because a leak that happens on the second link is
  -- the same defect, and a scan that sampled one would report it as clean.
  FOREACH raw IN ARRAY ARRAY[current_setting('s8b.raw_chenna'), current_setting('s8b.raw_baby'),
                             current_setting('s8b.raw_pillai'), current_setting('s8b.raw_idaveli'),
                             current_setting('s8b.raw_raman'), current_setting('s8b.raw_stranger')]
  LOOP
    hits := pg_temp.s8b_stored_hits(raw);
    IF cardinality(hits) > 0 THEN
      bad_hits := bad_hits || raw;
    END IF;
  END LOOP;
  PERFORM pg_temp.s8b_eq('X15 none of the six secrets this file minted appears in any text-shaped column '
    'of any base table in `public` or `private` — the store holds digests, and the count is stated '
    'because six were scanned, not one',
    cardinality(bad_hits)::bigint, 0::bigint);

  PERFORM pg_temp.s8b_eq('X16 the deadline this file chose is the deadline the row carries: one family '
    'was minted with `fixed` and a future instant, four with `no_expiry` and no instant, and the answer '
    'the door gives back is that column rather than a re-derivation of it',
    ARRAY[(SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_chenna AND t.revoked_at IS NULL
              AND t.expiry_policy = 'fixed' AND t.expires_at > now()),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id IN (s.hh_baby, current_setting('s8b.hh_pillai')::uuid,
                                     current_setting('s8b.hh_idaveli')::uuid, s.hh_raman)
              AND t.revoked_at IS NULL AND t.expiry_policy = 'no_expiry'
              AND t.expires_at IS NULL),
          ((pg_temp.s8b_door(current_setting('s8b.raw_chenna')) -> 'guest'
              ->> 'responds_until')::timestamptz
             = (SELECT t.expires_at FROM private.access_tokens t
                 WHERE t.household_id = s.hh_chenna AND t.revoked_at IS NULL))::text]::text[],
    ARRAY['1', '4', 'true']::text[]);

  -- The last canary, written by the host through the same client path, in the column the guest door is
  -- never allowed to project.
  n := pg_temp.s8b_host_write(s.owner_a::text,
    'INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, '
    || 'response_source, answers) VALUES (' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(s.hh_baby::text) || '::uuid, ' || quote_literal(s.ev_reception::text)
    || '::uuid, ''attending'', 1, ''host_manual'', '
    || quote_literal(jsonb_build_object('meal', current_setting('s8b.mk_other_answer'))::text)
    || '::jsonb)');
  PERFORM pg_temp.s8b_eq('X17 one family''s optional answer exists in the database, written by the host '
    'as their own transcription: the row landed, its `answers` object carries the marker, and no guest '
    'row was involved. K5 then reads the absence of this string out of three different doors',
    ARRAY[n::text,
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_baby AND r.event_id = s.ev_reception
              AND r.answers ? 'meal'
              AND r.answers ->> 'meal' = current_setting('s8b.mk_other_answer'))]::text[],
    ARRAY['1', '1']::text[]);

  v := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM pg_temp.s8b_eq('X18 the host''s own read now sees six families and reports every one of them '
    'live: the two households this file added reached the product''s read path rather than only the table '
    'it reads, the withdrawn family is live again through the send, and the Nair family''s untouched link '
    'is still the one battery 1 minted. Six of six rather than five of six is the honest number, and it '
    'is the number because this file withdrew the only link that could have read as dead',
    ARRAY[(SELECT count(*)::text FROM jsonb_array_elements(v))::text,
          (SELECT count(*)::text FROM jsonb_array_elements(v) e
            WHERE (e ->> 'link_state') = 'live'),
          (SELECT count(*)::text FROM jsonb_array_elements(v) e
            WHERE (e ->> 'link_state') <> 'live'),
          (SELECT e ->> 'link_state' FROM jsonb_array_elements(v) e
            WHERE (e ->> 'household_id')::uuid = s.hh_nair)]::text[],
    ARRAY['6', '6', '0', 'live']::text[]);
END $X$;

-- --------------------------------------------------------------------------- D: the shape of a household answer
-- The door's answer is what a guest page is built from, so its inventory is a contract rather than a
-- detail: a sixth name in `guest` is a leak waiting for a renderer, and an `invitation` half that is not
-- the published document is a second rendering of the same wedding. Every expectation below was re-read
-- from the body at `20261009120000_stage8_guest_invitations_rsvp.sql:684-697` (the answer), `:650-660`
-- (the card) and `:627-632` (the greeting) rather than written down from memory, and the DTO is computed
-- here from the frozen row rather than compared against a literal this file invented.
DO $D$
DECLARE s s8c%ROWTYPE; v jsonb; w jsonb; dto jsonb;
BEGIN
  SELECT * INTO s FROM s8c;

  v := pg_temp.s8b_door(current_setting('s8b.raw_chenna'));

  PERFORM pg_temp.s8b_has_keys('D1 the household answer carries exactly three top-level names — and no '
    'wedding id, no publication id, no credential row id and no version id, none of which a guest has '
    'any use for and each of which is a handle on somebody else''s data',
    v, ARRAY['available', 'guest', 'invitation']);

  PERFORM pg_temp.s8b_has_keys('D2 §3.4: the household half is eight names, asserted as a set rather than '
    'as a count, because a renamed channel — a `party_size` where `expected_party_size` should be — would '
    'pass a count and fail a family',
    v -> 'guest', ARRAY['can_respond', 'display_name', 'events', 'expected_party_size', 'greeting',
                        'household_id', 'responds_until', 'version_number']);

  PERFORM pg_temp.s8b_has_keys('D3 an event card is eight names: four that describe the ceremony and three '
    'that describe this household''s own position beside the id the card is keyed by — and the absence of '
    'an `answers` name here is what K5 then measures as the door''s rule rather than as an empty value',
    v -> 'guest' -> 'events' -> 0,
    ARRAY['attending', 'display_name', 'ends_at_local', 'event_id', 'party_size', 'responded_at',
          'starts_at_local', 'timezone']);

  SELECT private.public_invitation_dto(x.snapshot_schema_version, x.snapshot) INTO dto
    FROM public.invitation_versions x
    JOIN public.publications p ON p.version_id = x.id
   WHERE p.id = s.pub1;
  PERFORM pg_temp.s8b_eq('D4 the invitation half is byte-for-byte the projection of the frozen version this '
    'credential is pinned to — the same function the wedding-level door uses, so a household page and the '
    'public page cannot show two different weddings, which is Ruling 5.1 carried into the guest path',
    v -> 'invitation', dto);

  PERFORM pg_temp.s8b_eq('D5 the salutation the host wrote is the greeting shown, verbatim and beside the '
    'display name rather than instead of it, and the version number the answer reports is the one the '
    'publication points at, not the number of versions that exist',
    ARRAY[(v ->> 'available'), (v -> 'guest' ->> 'household_id'),
          (v -> 'guest' ->> 'display_name'), (v -> 'guest' ->> 'greeting'),
          (v -> 'guest' -> 'expected_party_size')::text,
          (v -> 'guest' ->> 'version_number'), (v -> 'guest' ->> 'can_respond')]::text[],
    ARRAY['true', s.hh_chenna::text, 'Chennakrishna Iyer', 'Dear Chennakrishna family',
          '4', '1', 'true']::text[]);

  -- The fallback and both NULLs, on the household the host left blank. `jsonb_typeof` rather than
  -- `IS NULL` throughout, for the reason battery 1's T12 records: an accessor on a present-and-null key
  -- hands back a null *value*, so `IS NULL` is false for exactly the rows the claim is about.
  w := pg_temp.s8b_door(current_setting('s8b.raw_idaveli'));
  PERFORM pg_temp.s8b_eq('D6 §3.4 and §6 together: a family with no salutation is greeted with its own '
    'display name rather than with an empty string, a family with no expected party size is answered with '
    'that key still present and JSON-null rather than with a zero invented for it, and the card list is an '
    'array rather than a null — the shape a client can render without a special case',
    ARRAY[(w -> 'guest' ->> 'greeting'), (w -> 'guest' ->> 'display_name'),
          jsonb_typeof(w -> 'guest' -> 'expected_party_size'),
          jsonb_typeof(w -> 'guest' -> 'responds_until'),
          jsonb_typeof(w -> 'guest' -> 'events'),
          (w -> 'guest' ->> 'can_respond')]::text[],
    ARRAY['The Idaveli household', 'The Idaveli household', 'null', 'null', 'array',
          'false']::text[]);

  PERFORM pg_temp.s8b_eq('D7 and the two facts are independent: a family with no deadline is still a '
    'family that can answer. A client that read `responds_until: null` as "this link is closed" would lock '
    'out the majority of the guest list, because a deadline is the exception this product offers rather '
    'than the rule it enforces',
    ARRAY[jsonb_typeof(pg_temp.s8b_door(current_setting('s8b.raw_baby'))
                          -> 'guest' -> 'responds_until'),
          (pg_temp.s8b_door(current_setting('s8b.raw_baby')) -> 'guest' ->> 'can_respond')]::text[],
    ARRAY['null', 'true']::text[]);

  PERFORM pg_temp.s8b_has_keys('D8 the closed answer is one name long: no empty guest object, no null '
    'invitation, no reason and no hint about which of the eight ways a link stops working this one is — '
    'the shape is closed as well as the value, so a client cannot accidentally render a difference the '
    'product refused to disclose',
    pg_temp.s8b_door(rpad('zzforged', 43, 'z')), ARRAY['available']);
END $D$;

-- --------------------------------------------------------------------------- E: which events, in which order
-- §6's claim is that a household sees the events it was given, in the document's own order, and never a
-- different set. The order matters twice over: a panel that reordered the wedding would contradict the
-- invitation above it, and a disabled card that still appeared would be an answer form for a ceremony the
-- couple stopped running. The parity assertions below compare the answer to the table rather than to
-- constants, because the answering rows were written by battery 1 and this file must not have to know
-- what it did not set — and the one literal set is the pair battery 1's T7 records.
--
-- The fixture is what makes the ordering assertion mean anything. Battery 1 gives the evening reception
-- `display_order` 0 and the morning ceremony `display_order` 1, so the document's order and the clock's
-- order disagree by construction; name order and insertion order both agree with the clock here, so a
-- projection sorted by either of them would answer {Muurtham,Reception} and only `display_order` — the
-- column the frozen document itself uses (`20260927120000...:1138`) — answers the pair below.
--
-- The six doors are opened once, into a temp table, rather than once per assertion. A door read is not a
-- pure call — it stamps `last_used_at` — so an assertion that called it four times would be measuring a
-- household that had opened its invitation four times, and a group that later claims a link was opened
-- once would be contradicted by its own predecessor.
CREATE TEMP TABLE s8d ON COMMIT DROP AS
SELECT q.who, q.hh::uuid AS hh_id, pg_temp.s8b_door(q.raw) AS a
  FROM (VALUES ('chenna',   current_setting('s8b.hh_chenna'),    current_setting('s8b.raw_chenna')),
               ('baby',     current_setting('s8b.hh_baby'),      current_setting('s8b.raw_baby')),
               ('pillai',   current_setting('s8b.hh_pillai'),    current_setting('s8b.raw_pillai')),
               ('idaveli',  current_setting('s8b.hh_idaveli'),   current_setting('s8b.raw_idaveli')),
               ('raman',    current_setting('s8b.hh_raman'),     current_setting('s8b.raw_raman')),
               ('stranger', current_setting('s8b.hh_stranger'),  current_setting('s8b.raw_stranger'))
       ) q(who, hh, raw);

DO $E$
DECLARE s s8c%ROWTYPE; v jsonb; w jsonb; st jsonb;
BEGIN
  SELECT * INTO s FROM s8c;
  v := pg_temp.s8b_door(current_setting('s8b.raw_chenna'));

  PERFORM pg_temp.s8b_eq('E0 all six doors opened, and six is the number of credentials this file minted '
    'or re-minted and could therefore read — the Nair family''s untouched link is a seventh live link '
    'whose secret belongs to battery 1, so the sample is six by construction rather than by omission',
    ARRAY[(SELECT count(*)::text FROM s8d),
          (SELECT count(*)::text FROM s8d d WHERE (d.a ->> 'available') = 'true')]::text[],
    ARRAY['6', '6']::text[]);

  PERFORM pg_temp.s8b_eq('E1 two cards for a two-event family, in the order the frozen document uses and '
    'not the order the clock uses: the reception that starts at six in the evening is the first card, and '
    'the ceremony that starts at half past seven is the second',
    ARRAY[(SELECT count(*)::text FROM jsonb_array_elements(v -> 'guest' -> 'events')),
          (SELECT array_agg(q.e ->> 'display_name' ORDER BY q.ord)::text
             FROM jsonb_array_elements(v -> 'guest' -> 'events') WITH ORDINALITY q(e, ord)),
          (SELECT array_agg(q.e ->> 'starts_at_local' ORDER BY q.ord)::text
             FROM jsonb_array_elements(v -> 'guest' -> 'events') WITH ORDINALITY q(e, ord))]::text[],
    ARRAY['2', '{Reception,Muurtham}',
          '{2026-11-14T18:00:00,2026-11-14T07:30:00}']::text[]);

  -- Compared as sets against the tables the authority lives in, so this is a claim about the door's two
  -- filters rather than about strings this file typed. Pillai is the household that separates them: it is
  -- scoped to one live event and one dead one, and reception is live but unscoped, so a door that ignored
  -- `enabled` answers three cards and a door that ignored the scope answers two.
  PERFORM pg_temp.s8b_eq('E2 not one of the six doors answered with a card list other than its own '
    'household''s enabled scope rows, measured per household against `household_event_scopes` joined to '
    '`wedding_events` — the empty list of a zero-scope family and the single card of a family scoped to a '
    'switched-off ceremony are both in that comparison, and neither is a special case of it',
    coalesce((SELECT array_agg(d.who ORDER BY d.who)::text
                FROM s8d d
               WHERE pg_temp.s8b_arr((SELECT jsonb_agg(q.c ->> 'display_name')
                                        FROM jsonb_array_elements(d.a -> 'guest' -> 'events') q(c)))
                     IS DISTINCT FROM
                     (SELECT pg_temp.s8b_arr(jsonb_agg(e.display_name))
                        FROM public.household_event_scopes sc
                        JOIN public.wedding_events e
                          ON e.wedding_id = sc.wedding_id AND e.id = sc.event_id
                       WHERE sc.household_id = d.hh_id AND e.enabled)),
             '{}'::text),
    '{}'::text);

  PERFORM pg_temp.s8b_eq('E3 the ceremony the couple switched off is in no household''s answer, although '
    'one household is *scoped* to it: zero doors show Farewell, and the scan is not vacuous because the '
    'same six answers show three Muurtham cards, two Reception cards and one Haldi card, and six cards in '
    'total across them',
    ARRAY[(SELECT count(*)::text FROM s8d d WHERE EXISTS (SELECT 1
              FROM jsonb_array_elements(d.a -> 'guest' -> 'events') c
             WHERE c ->> 'display_name' = 'Farewell')),
          (SELECT count(*)::text FROM s8d d WHERE EXISTS (SELECT 1
              FROM jsonb_array_elements(d.a -> 'guest' -> 'events') c
             WHERE c ->> 'display_name' = 'Muurtham')),
          (SELECT count(*)::text FROM s8d d WHERE EXISTS (SELECT 1
              FROM jsonb_array_elements(d.a -> 'guest' -> 'events') c
             WHERE c ->> 'display_name' = 'Reception')),
          (SELECT count(*)::text FROM s8d d WHERE EXISTS (SELECT 1
              FROM jsonb_array_elements(d.a -> 'guest' -> 'events') c
             WHERE c ->> 'display_name' = 'Haldi')),
          (SELECT count(*)::text FROM s8d d,
             jsonb_array_elements(d.a -> 'guest' -> 'events') c)]::text[],
    ARRAY['0', '3', '2', '1', '6']::text[]);

  PERFORM pg_temp.s8b_eq('E4 every card of every answer carries the wedding''s own timezone, a naive local '
    'start stamped to the second with no offset and no trailing Z, and an `ends_at_local` that is present '
    'and JSON-null rather than missing — Stage 2 stores the column as a `timestamp` without a zone '
    '(`20260925120100_stage2_canonical_domain.sql:148-176`) precisely so a Madurai ceremony is not moved '
    'by the reader''s device clock, so the zone has to travel beside the string instead of being folded '
    'into it',
    ARRAY[(SELECT count(*)::text FROM s8d d,
              jsonb_array_elements(d.a -> 'guest' -> 'events') c
             WHERE c ->> 'timezone' = 'Asia/Kolkata'),
          (SELECT count(*)::text FROM s8d d,
              jsonb_array_elements(d.a -> 'guest' -> 'events') c
             WHERE (c ->> 'starts_at_local') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'),
          (SELECT count(*)::text FROM s8d d,
              jsonb_array_elements(d.a -> 'guest' -> 'events') c
             WHERE c ? 'ends_at_local' AND jsonb_typeof(c -> 'ends_at_local') = 'null')]::text[],
    ARRAY['6', '6', '6']::text[]);

  -- The row-parity arm is the one that makes E5 a claim about the door rather than about this file's
  -- reading of it: every field of every card is compared with the answer row it is supposed to come from,
  -- and the join's own row count is asserted so a card with no row cannot drop out of the comparison.
  PERFORM pg_temp.s8b_eq('E5 a family sees its own answers verbatim and nothing else: reception declined '
    'with nobody coming, ceremony attending with four — the exact pair battery 1''s T7 wrote by hand — each '
    'card''s `responded_at` equal to its row''s, two cards matched by two rows, and no card carrying an '
    '`answers` name at all',
    ARRAY[(SELECT array_agg(q.e ->> 'attending' ORDER BY q.ord)::text
             FROM jsonb_array_elements(v -> 'guest' -> 'events') WITH ORDINALITY q(e, ord)),
          (SELECT array_agg(q.e ->> 'party_size' ORDER BY q.ord)::text
             FROM jsonb_array_elements(v -> 'guest' -> 'events') WITH ORDINALITY q(e, ord)),
          (SELECT count(*)::text
             FROM jsonb_array_elements(v -> 'guest' -> 'events') q(e)
             JOIN public.rsvp_responses r
               ON r.household_id = s.hh_chenna AND r.event_id = (q.e ->> 'event_id')::uuid),
          (SELECT bool_and((q.e ->> 'responded_at')::timestamptz = r.responded_at
                           AND (q.e ->> 'attending') = r.attending
                           AND (q.e ->> 'party_size')::int = r.party_size)::text
             FROM jsonb_array_elements(v -> 'guest' -> 'events') q(e)
             JOIN public.rsvp_responses r
               ON r.household_id = s.hh_chenna AND r.event_id = (q.e ->> 'event_id')::uuid),
          (SELECT bool_and(NOT (q.e ? 'answers'))::text
             FROM jsonb_array_elements(v -> 'guest' -> 'events') q(e))]::text[],
    ARRAY['{declined,attending}', '{0,4}', '2', 'true', 'true']::text[]);

  w := pg_temp.s8b_door(current_setting('s8b.raw_pillai'));
  PERFORM pg_temp.s8b_eq('E6 the family that has not answered is shown one card whose three answer fields '
    'are present and JSON-null — not a fabricated `declined` and not a headcount of zero. A guest''s '
    'silence is not a refusal, and a panel that rendered the two alike would report a family that has not '
    'opened its link as a family that said no',
    ARRAY[jsonb_typeof(w -> 'guest' -> 'events' -> 0 -> 'attending'),
          jsonb_typeof(w -> 'guest' -> 'events' -> 0 -> 'party_size'),
          jsonb_typeof(w -> 'guest' -> 'events' -> 0 -> 'responded_at'),
          (w -> 'guest' ->> 'can_respond'),
          (w -> 'guest' -> 'events' -> 0 ->> 'display_name')]::text[],
    ARRAY['null', 'null', 'null', 'true', 'Muurtham']::text[]);

  w := pg_temp.s8b_door(current_setting('s8b.raw_raman'));
  PERFORM pg_temp.s8b_eq('E7 a family scoped to nothing still opens its invitation: available, greeted by '
    'name, an empty array rather than a null or a missing key, and `can_respond` false. The document half '
    'of its answer is byte-identical to the largest family''s, because personalisation is confined to '
    '`guest` — the wedding is one thing for every family of it, and what differs is the household''s own '
    'list',
    ARRAY[(w ->> 'available'),
          jsonb_typeof(w -> 'guest' -> 'events'),
          (jsonb_array_length(w -> 'guest' -> 'events'))::text,
          (w -> 'guest' ->> 'can_respond'),
          (w -> 'guest' ->> 'greeting'),
          (w -> 'invitation' = v -> 'invitation')::text]::text[],
    ARRAY['true', 'array', '0', 'false', 'Dear Raman family', 'true']::text[]);

  -- The two reads of the same household disagree by design, and only an assertion can tell that design
  -- from a bug. The host is entitled to know they assigned a family to a ceremony; the guest is not
  -- entitled to an answer form for it.
  st := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM pg_temp.s8b_eq('E8 the host''s read counts the assignment while the guest''s door honours the '
    'switch: the same household reports `scoped_event_count` two and is shown one card, so switching a '
    'ceremony off hides the card without rewriting the guest list the host maintains',
    ARRAY[(SELECT e ->> 'scoped_event_count' FROM jsonb_array_elements(st) e
            WHERE (e ->> 'household_id')::uuid = current_setting('s8b.hh_pillai')::uuid),
          (jsonb_array_length(pg_temp.s8b_door(current_setting('s8b.raw_pillai'))
                              -> 'guest' -> 'events'))::text]::text[],
    ARRAY['2', '1']::text[]);
END $E$;

-- --------------------------------------------------------------------------- K: what a household is not shown
-- Every claim below is a presence-then-absence pair, for the reason the design note gives at
-- `guest-rsvp-security.md` §5 and battery 1's F5 gives one stage earlier: an assertion that a value is
-- missing from an answer means nothing unless the value exists somewhere first. The markers were written
-- into *private* columns by the host's own client path (X7, X17), so the thing the guest is not shown is
-- a fact about a real family in this wedding rather than a hypothetical.
--
-- The scans are whole-answer scans (`d.a::text`), not scans of the `guest` object, because the leak this
-- group is afraid of is the projection that "just returns the household" — the one the design note calls
-- out at `20261009120000...:555-560`, where `host_notes` sits on the same row as the greeting. A scan
-- confined to `guest` would pass a door that added the note to the document half.
DO $K$
DECLARE s s8c%ROWTYPE; st jsonb; needles text[];
BEGIN
  SELECT * INTO s FROM s8c;

  needles := ARRAY['"host_notes"', '"contact_notes"', '"salutation"', '"token_hash"', '"token_kind"',
                   '"raw_token"', '"access_tokens"', '"expiry_policy"', '"expires_at"', '"revoked_at"',
                   '"last_used_at"', '"publication_id"', '"wedding_id"', '"version_id"',
                   '"response_source"', '"created_at"', '"updated_at"', '"answers"'];

  st := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');

  PERFORM pg_temp.s8b_eq('K1 the canaries exist before anything proves their absence: one household of '
    'this wedding carries both marker strings in `host_notes`, the note battery 1 wrote on the '
    'Chennakrishna family is still there untouched, and the private answer this file planted for one '
    'family is still one row of `rsvp_responses`',
    ARRAY[(SELECT count(*)::text FROM public.guest_households h
            WHERE h.wedding_id = s.wed_a
              AND h.host_notes LIKE '%' || current_setting('s8b.mk_note') || '%'
              AND h.host_notes LIKE '%' || current_setting('s8b.mk_name') || '%'),
          (SELECT count(*)::text FROM public.guest_households h
            WHERE h.id = s.hh_chenna
              AND h.host_notes = 'host-only: cousin needs a ride from the airport'),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_baby AND r.event_id = s.ev_reception
              AND r.answers ->> 'meal' = current_setting('s8b.mk_other_answer'))]::text[],
    ARRAY['1', '1', '1']::text[]);

  PERFORM pg_temp.s8b_eq('K2 neither half of the host''s private note about one family reaches any of the '
    'six household answers — and note that the note was written on the Pillai family, whose own link this '
    'file opened, so the family the note is *about* is the family reading the page. §5''s rule is not '
    '"other households'' notes are hidden", it is "no note is hidden"',
    ARRAY[(SELECT count(*)::text FROM s8d d
            WHERE strpos(d.a::text, current_setting('s8b.mk_note')) > 0
               OR strpos(d.a::text, current_setting('s8b.mk_name')) > 0)]::text[],
    ARRAY['0']::text[]);

  PERFORM pg_temp.s8b_eq('K3 and the host''s own read of their guest list carries no note either: the '
    'marker strings are absent and the `host_notes` name is absent, because the published promise on this '
    'verb is a projection of the columns a link-management screen needs (`:480-482`, `:1226`), not a '
    'SELECT * of the household table',
    ARRAY[(SELECT count(*)::text FROM (SELECT 1) t
            WHERE strpos(st::text, current_setting('s8b.mk_note')) > 0
               OR strpos(st::text, current_setting('s8b.mk_name')) > 0
               OR strpos(st::text, '"host_notes"') > 0)]::text[],
    ARRAY['0']::text[]);

  -- The needle list is in the assertion, not only in the count: a scan of an unnamed set of key names is
  -- the kind of claim that quietly stops covering anything when a name is dropped from it.
  PERFORM pg_temp.s8b_eq('K4 not one of the eighteen internal names a link-management row or a '
    'publication row is made of appears in any of the six answers — host-side column names '
    '(host_notes, contact_notes, salutation, response_source), credential-store internals (token_hash, '
    'token_kind, raw_token, access_tokens, expiry_policy, expires_at, revoked_at, last_used_at) and '
    'foreign handles (publication_id, wedding_id, version_id, created_at, updated_at, answers) — measured '
    'as 108 door-and-needle pairs, all of them clean',
    ARRAY[(SELECT count(*)::text
             FROM s8d d CROSS JOIN unnest(needles) n(k)
            WHERE strpos(d.a::text, n.k) > 0),
          (cardinality(needles) * (SELECT count(*) FROM s8d))::text]::text[],
    ARRAY['0', '108']::text[]);

  PERFORM pg_temp.s8b_eq('K5 §5''s sharpest case: one family''s optional answer is in the database, '
    'written by the host as a transcription, and appears in no door answer at all — not in another '
    'family''s and not in *that family''s own*, because the card inventory (D3) has no `answers` name and '
    'the value therefore has no channel. A client cannot render what the door never sends, so the '
    'optional-question screen has to ask again rather than read an answer back',
    ARRAY[(SELECT count(*)::text FROM s8d d
            WHERE strpos(d.a::text, current_setting('s8b.mk_other_answer')) > 0),
          (SELECT count(*)::text FROM s8d d
            WHERE d.who = 'baby' AND strpos(d.a::text, 'meal') > 0)]::text[],
    ARRAY['0', '0']::text[]);

  -- Households of one wedding, other than this door's own: five others for each of the five `wed_a`
  -- families and none for the stranger, so 25 pairs. Both the display name and the salutation are
  -- needles, since the greeting is a form of the name and a page that leaked a salutation would leak a
  -- greeting this file has already shown to be real. Empty salutations are dropped rather than scanned
  -- as the empty string, which every text contains.
  PERFORM pg_temp.s8b_eq('K6 no answer names a family of its own wedding other than the one reading it: '
    '25 door-and-neighbour pairs scanned over both display name and salutation, and nothing found — this '
    'is the "never expose household membership" rule of the directive stated as a shape a probe can '
    'falsify rather than as a promise',
    ARRAY[(SELECT count(*)::text
             FROM s8d d
             JOIN public.guest_households h ON h.id = d.hh_id
             JOIN public.guest_households o
               ON o.wedding_id = h.wedding_id AND o.id <> h.id
            WHERE strpos(d.a::text, o.display_name) > 0
               OR (coalesce(o.salutation, '') <> ''
                   AND strpos(d.a::text, o.salutation) > 0)),
          (SELECT count(*)::text
             FROM s8d d
             JOIN public.guest_households h ON h.id = d.hh_id
             JOIN public.guest_households o
               ON o.wedding_id = h.wedding_id AND o.id <> h.id)]::text[],
    ARRAY['0', '25']::text[]);

  PERFORM pg_temp.s8b_eq('K7 the other tenant''s title is in no answer of this one, and the stranger''s '
    'answer holds neither this wedding''s title nor this wedding''s ceremony names — with the positive '
    'control that each document does carry its own wedding''s title, so the absence of the other is a '
    'boundary rather than a projection that dropped titles',
    ARRAY[(SELECT count(*)::text FROM s8d d
            WHERE d.who <> 'stranger' AND strpos(d.a::text, 'Bala weds Divya') > 0),
          (SELECT count(*)::text FROM s8d d WHERE d.who = 'stranger'
              AND (strpos(d.a::text, 'Asha weds Bala') > 0
                   OR strpos(d.a::text, 'Muurtham') > 0
                   OR strpos(d.a::text, 'Reception') > 0
                   OR strpos(d.a::text, 'Farewell') > 0)),
          (SELECT count(*)::text FROM s8d d
            WHERE d.who <> 'stranger' AND strpos(d.a::text, 'Asha weds Bala') > 0),
          (SELECT count(*)::text FROM s8d d
            WHERE d.who = 'stranger' AND strpos(d.a::text, 'Bala weds Divya') > 0)]::text[],
    ARRAY['0', '0', '5', '1']::text[]);

  PERFORM pg_temp.s8b_eq('K8 none of the six secrets this file minted appears in an answer body or in the '
    'host''s read of the link list. X15 proved the same strings are in no *column*; this proves they are '
    'in no *response*, which is the other half of "the digest is stored and the secret is shown once", '
    'because a door that echoed the credential back would leave the table scan clean and the wire dirty',
    ARRAY[(SELECT count(*)::text FROM s8d d
            WHERE strpos(d.a::text, current_setting('s8b.raw_chenna')) > 0
               OR strpos(d.a::text, current_setting('s8b.raw_baby')) > 0
               OR strpos(d.a::text, current_setting('s8b.raw_pillai')) > 0
               OR strpos(d.a::text, current_setting('s8b.raw_idaveli')) > 0
               OR strpos(d.a::text, current_setting('s8b.raw_raman')) > 0
               OR strpos(d.a::text, current_setting('s8b.raw_stranger')) > 0),
          (SELECT count(*)::text FROM (SELECT 1) t
            WHERE strpos(st::text, current_setting('s8b.raw_chenna')) > 0
               OR strpos(st::text, current_setting('s8b.raw_baby')) > 0
               OR strpos(st::text, current_setting('s8b.raw_pillai')) > 0
               OR strpos(st::text, current_setting('s8b.raw_idaveli')) > 0
               OR strpos(st::text, current_setting('s8b.raw_raman')) > 0)]::text[],
    ARRAY['0', '0']::text[]);

  -- The positive half of the cross-tenant claim. K7 showed what the stranger''s answer does not contain;
  -- without this, "the other tenant''s data is absent" could be satisfied by a door that answers nothing.
  PERFORM pg_temp.s8b_eq('K9 and the stranger''s own door works: it opens with its own greeting, its own '
    'household id, one card named for its own wedding''s single event, and a document half — so the '
    'refusals above are confinement, not a broken path, and a real second tenant is a real second tenant',
    ARRAY[(SELECT d.a -> 'guest' ->> 'greeting' FROM s8d d WHERE d.who = 'stranger'),
          (SELECT (d.a -> 'guest' ->> 'household_id') FROM s8d d WHERE d.who = 'stranger'),
          (SELECT jsonb_array_length(d.a -> 'guest' -> 'events') FROM s8d d WHERE d.who = 'stranger'),
          (SELECT d.a -> 'guest' -> 'events' -> 0 ->> 'display_name' FROM s8d d WHERE d.who = 'stranger'),
          (SELECT (d.a -> 'guest' ->> 'can_respond') FROM s8d d WHERE d.who = 'stranger'),
          (SELECT jsonb_typeof(d.a -> 'invitation') FROM s8d d WHERE d.who = 'stranger')]::text[],
    ARRAY['Dear cousin', s.hh_stranger::text, '1', 'Haldi', 'true', 'object']::text[]);
END $K$;

-- --------------------------------------------------------------------------- U: every refusal is one answer
-- §4.1's claim is not that a dead link is refused. It is that a dead link is refused *in the same bytes
-- as every other dead link*, so that probing this door cannot tell a holder of a rotated-away secret that
-- their secret was rotated, nor tell a guesser which of their guesses was structurally plausible. The
-- instrument for that is not twelve assertions that each answer says `false`; it is one assertion that the
-- twelve answers are indistinguishable, plus a live control that says the door works.
--
-- Three of the twelve states are produced by the product's own verbs (a withdrawal, a rotation) and one by
-- a direct write to the credential table, because a deadline that has passed cannot be waited for. That
-- write moves both ends of the row and flips the policy name, since `access_tokens` pairs the two with a
-- CHECK (`20260925120400_stage2_assets_entitlements_secrets.sql:149-150`); a battery that set only
-- `expires_at` would abort on a constraint instead of measuring the door.
DO $U$
DECLARE s s8c%ROWTYPE; v jsonb; st jsonb; res jsonb[] := '{}'::jsonb[];
        fam text[] := '{}'::text[]; n bigint; old_pillai text;
BEGIN
  SELECT * INTO s FROM s8c;

  v := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.revoke_guest_invitation(' || quote_literal(s.hh_chenna::text) || '::uuid)');
  PERFORM pg_temp.s8b_eq('U1 the host''s withdrawal is reported as one credential revoked, with the instant '
    'it was written rather than a re-read NULL — the household keeps its rows, which U4 then reads as '
    '`revoked` and K-group''s claims outlive',
    ARRAY[(v ->> 'revoked'), (v ->> 'credentials_revoked'),
          jsonb_typeof(v -> 'revoked_at'),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_chenna AND t.revoked_at IS NULL)]::text[],
    ARRAY['true', '1', 'string', '0']::text[]);

  old_pillai := current_setting('s8b.raw_pillai');
  v := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.rotate_guest_invitation('
    || quote_literal(current_setting('s8b.hh_pillai')) || '::uuid)');
  PERFORM set_config('s8b.raw_pillai', substr(v ->> 'path', 4), false);
  PERFORM pg_temp.s8b_eq('U2 the rotation is revoke-then-mint in one call: the successor arrives as a fresh '
    '43-character secret, the retired instant is reported, the family holds two rows with one live among '
    'them, and the successor is `no_expiry` because what was rotated was the secret and not the deadline '
    'the host never set',
    ARRAY[octet_length(v ->> 'path')::text,
          jsonb_typeof(v -> 'previous_revoked_at'),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = current_setting('s8b.hh_pillai')::uuid),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = current_setting('s8b.hh_pillai')::uuid AND t.revoked_at IS NULL),
          (SELECT array_agg(t.expiry_policy)::text FROM private.access_tokens t
            WHERE t.household_id = current_setting('s8b.hh_pillai')::uuid
              AND t.revoked_at IS NULL)]::text[],
    ARRAY['46', 'string', '2', '1', '{no_expiry}']::text[]);

  UPDATE private.access_tokens
     SET expiry_policy = 'fixed',
         created_at = now() - interval '40 days',
         expires_at = now() - interval '1 day'
   WHERE household_id = s.hh_raman AND token_kind = 'guest_invitation'
     AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  -- The other half of the ageing. `now()` is frozen at the transaction start, so the live row this battery
  -- minted at X13 shared an instant with every row the battery touched, and moving only its `created_at`
  -- 40 days back made it the *oldest* credential the family ever had. The panel's reader takes the
  -- household's newest row (`20261009120000_stage8_guest_invitations_rsvp.sql:527-537`: the liveness flag,
  -- then `c.created_at DESC`) and so reported `revoked` — correct behaviour for a product that can only
  -- ever mint a successor after its predecessor, and an ordering no real rotation can produce. Rotation
  -- puts the newest secret last, so the aged row is aged with its family's whole history behind it. `n`
  -- still counts the live-row write; the history write is measured by its own cell below.
  UPDATE private.access_tokens
     SET created_at = created_at - interval '41 days'
   WHERE household_id = s.hh_raman AND token_kind = 'guest_invitation'
     AND revoked_at IS NOT NULL;
  PERFORM pg_temp.s8b_eq('U3 the expired state is reachable without waiting for a calendar: one live row '
    'aged by hand, still unrevoked, now fixed and in the past, and the ageing moved `created_at` with it so '
    'the table''s own pairing and ordering constraints accepted the write rather than aborting the battery. '
    'The last two cells measure the same write from the panel''s side: the family''s revoked history is '
    'three rows, the count X13 fixed by reporting four rows with one live among them, and the aged row now '
    'holds the newest `created_at` among that household''s invitation credentials — which is the property '
    'U6 reads as `expired` rather than `revoked`, and the only ordering rotation could have produced',
    ARRAY[n::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL
              AND t.expiry_policy = 'fixed' AND t.expires_at <= now()),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_raman AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NOT NULL),
          (SELECT (t.created_at = (SELECT max(x.created_at) FROM private.access_tokens x
                     WHERE x.household_id = s.hh_raman
                       AND x.token_kind = 'guest_invitation'))::text
             FROM private.access_tokens t
            WHERE t.household_id = s.hh_raman AND t.revoked_at IS NULL)]::text[],
    ARRAY['1', '1', '3', 'true']::text[]);

  -- The twelve refusals, collected before any of them is asserted, so the assertion below is about the set.
  -- Each `fam` label carries `::text` for a reason: `text[] || 'literal'` binds the right operand to the
  -- `anyarray || anyarray` operator, so the engine tries to parse the label as an array literal and aborts
  -- the block before any door is opened. The cast selects `anyarray || anyelement`, which appends it.
  res := res || pg_temp.s8b_door(NULL);                                  fam := fam || 'no-header'::text;
  res := res || pg_temp.s8b_door('');                                    fam := fam || 'empty-header'::text;
  res := res || pg_temp.s8b_door(repeat('a', 42));                       fam := fam || '42-chars'::text;
  res := res || pg_temp.s8b_door(repeat('b', 44));                       fam := fam || '44-chars'::text;
  res := res || pg_temp.s8b_door(repeat('c', 41) || '+/');               fam := fam || 'off-alphabet'::text;
  res := res || pg_temp.s8b_door(repeat('0', 64));                       fam := fam || 'stored-digest-shape'::text;
  res := res || pg_temp.s8b_door(rpad('zzforged', 43, 'z'));             fam := fam || 'forged-unknown'::text;
  res := res || pg_temp.s8b_door(current_setting('s8b.raw_chenna'));     fam := fam || 'revoked'::text;
  res := res || pg_temp.s8b_door(old_pillai);                            fam := fam || 'rotated-away'::text;
  res := res || pg_temp.s8b_door(current_setting('s8b.raw_raman'));      fam := fam || 'expired'::text;
  res := res || pg_temp.s8b_door(current_setting('s8b.raw_wedb_pub'));   fam := fam || 'wedding-secret-at-household-door'::text;
  res := res || pg_temp.s8b_public_door(rpad('zzforged', 43, 'z'));      fam := fam || 'forged-at-wedding-door'::text;
  res := res || pg_temp.s8b_public_door(current_setting('s8b.raw_baby'));fam := fam || 'household-secret-at-wedding-door'::text;

  PERFORM pg_temp.s8b_eq('U4 §4.1 measured as one answer, not thirteen: the thirteen refusals above — six '
    'shapes that were never credentials, one replay of the stored-digest form, one unknown-but-well-formed '
    'guess, a revoked link, a rotated-away link, an expired link, the wedding''s own secret at the '
    'household door, a guess and a household secret at the wedding door — render to exactly one distinct '
    'text, and that text is the two-name answer `{"available": false}`',
    ARRAY[cardinality(res)::text,
          (SELECT count(DISTINCT x::text)::text FROM unnest(res) x),
          (SELECT min(x::text) FROM unnest(res) x),
          (SELECT bool_and(pg_temp.s8b_top_keys(x) = ARRAY['available']::text[]) FROM unnest(res) x)::text]::text[],
    ARRAY['13', '1', '{"available": false}', 'true']::text[]);

  PERFORM pg_temp.s8b_eq('U5 and the door is not broken: the household secret the wedding door refused is '
    'the secret the household door opens, the wedding secret the household door refused is the secret the '
    'wedding door opens, and a live family link still opens after all thirteen refusals above — so U4''s '
    'single answer is a policy about indistinguishability and not a door that answers false to everything. '
    'The fourth cell is measured as key absence rather than as the type of a value, because the refusal the '
    'product publishes is the one-name answer `{"available": false}` (`:567`) and never carries an '
    '`invitation` name at all: an answer with `"invitation": null` would fail here, which is the stronger '
    'claim this label makes',
    ARRAY[(pg_temp.s8b_door(current_setting('s8b.raw_baby')) ->> 'available'),
          (pg_temp.s8b_public_door(current_setting('s8b.raw_wedb_pub')) ->> 'available'),
          (pg_temp.s8b_door(current_setting('s8b.raw_pillai')) ->> 'available'),
          (pg_temp.s8b_public_door(current_setting('s8b.raw_baby')) ? 'invitation')::text]::text[],
    ARRAY['true', 'true', 'true', 'false']::text[]);

  st := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM pg_temp.s8b_eq('U6 the asymmetry has its other half: the host''s own read of the same six '
    'families distinguishes revoked from expired from live, in the vocabulary Stage 7 already published '
    'for its queue, precisely because that reader is the host and not a stranger with a link — the door '
    'refuses to say which, the panel must say which, and one row of the fixture is in each of the three '
    'states so all three words are measured',
    ARRAY[(SELECT e ->> 'link_state' FROM jsonb_array_elements(st) e
            WHERE (e ->> 'household_id')::uuid = s.hh_chenna),
          (SELECT e ->> 'link_state' FROM jsonb_array_elements(st) e
            WHERE (e ->> 'household_id')::uuid = s.hh_raman),
          (SELECT e ->> 'link_state' FROM jsonb_array_elements(st) e
            WHERE (e ->> 'household_id')::uuid = current_setting('s8b.hh_pillai')::uuid),
          (SELECT e ->> 'link_state' FROM jsonb_array_elements(st) e
            WHERE (e ->> 'household_id')::uuid = s.hh_baby),
          (SELECT count(*)::text FROM jsonb_array_elements(st) e
            WHERE (e ->> 'link_state') NOT IN ('revoked', 'expired', 'live'))]::text[],
    ARRAY['revoked', 'expired', 'live', 'live', '0']::text[]);

  PERFORM pg_temp.s8b_eq('U7 the refusal is not merely the same bytes but the same *shape*: a revoked, an '
    'expired and a rotated-away credential each answer with one name, and the two facts a client would '
    'need in order to render a difference — which household, which deadline — are absent from every one of '
    'them, so no renderer can accidentally display what the product refused to disclose',
    ARRAY[pg_temp.s8b_top_keys(pg_temp.s8b_door(current_setting('s8b.raw_chenna')))::text,
          pg_temp.s8b_top_keys(pg_temp.s8b_door(current_setting('s8b.raw_raman')))::text,
          pg_temp.s8b_top_keys(pg_temp.s8b_door(old_pillai))::text,
          (pg_temp.s8b_door(current_setting('s8b.raw_chenna')) ? 'guest')::text]::text[],
    ARRAY['{available}', '{available}', '{available}', 'false']::text[]);
END $U$;

-- --------------------------------------------------------------------------- N: the usage ledger
-- `last_used_at` means one thing in this product: the invitation was opened. It is written by the read
-- door and by nothing else (`:675-677`, and the write door's explicit refusal to touch it at
-- `:927-929`), and it is the field a host uses to decide whether to telephone a family. Both halves
-- matter — a field a probe could move would be worse than no field, and a field an answer moves would
-- report a family that only filled in a form as a family that never read the invitation.
--
-- The instrument needed here is a credential that has provably never been opened, and only the product's
-- own verbs can produce one: every raw secret is legible once, so this file rotates a link it minted
-- nothing for and reads the successor's own bytes out of the rotation answer. Rotation is the right
-- tool twice over — it is revoke-then-mint in one transaction, so the family stays answerable, and the
-- successor starts life with a NULL history rather than an inherited one.
--
-- One limit stated before it can be mistaken for a claim: `now()` in PostgreSQL is the *transaction*
-- timestamp, and this whole file runs in one transaction, so every stamp this battery writes carries
-- the same instant. What is therefore measurable is NULL → set → unmoved, and equality with `now()`;
-- what is not is one read being later than another. The assertions below use only the first kind.
-- The ledger, as one instrument, over *every* household credential row of the tested wedding — live and
-- retired alike. Keyed by the credential row rather than the household because the claim is about rows: a
-- probe that stamped a revoked link would move an entry this map already contains, and a map that only
-- listed live rows could not see it.
CREATE FUNCTION pg_temp.s8b_ledger() RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(jsonb_object_agg(t.id::text, coalesce(t.last_used_at::text, 'N')), '{}'::jsonb)
    FROM private.access_tokens t
   WHERE t.wedding_id = current_setting('s8b.wed_a')::uuid
     AND t.token_kind = 'guest_invitation' $fn$;

DO $N$
DECLARE s s8c%ROWTYPE; v jsonb; st jsonb; d jsonb; fresh_lu timestamptz;
        old_lu timestamptz; lu_then timestamptz;
        snap jsonb; snap2 jsonb; snap3 jsonb; storm jsonb[] := '{}'::jsonb[];
        raw2 text; tid text; live_then bigint;
BEGIN
  SELECT * INTO s FROM s8c;

  SELECT t.last_used_at INTO old_lu FROM private.access_tokens t
   WHERE t.household_id = s.hh_nair AND t.token_kind = 'guest_invitation'
     AND t.revoked_at IS NULL;

  v := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.rotate_guest_invitation(' || quote_literal(s.hh_nair::text) || '::uuid)');
  raw2 := substr(v ->> 'path', 4);
  PERFORM set_config('s8b.raw_nair2', raw2, false);

  PERFORM pg_temp.s8b_eq('N1 a rotated link arrives with no history at all: the successor''s secret is a '
    'fresh 43-character string, its `last_used_at` is NULL because nobody has opened it, the retired row '
    'keeps exactly the `last_used_at` it had before the call (withdrawing a link does not erase what is '
    'known about it), the family holds two credential rows with one live among them, and the deadline the '
    'host never set is carried across as `no_expiry` rather than silently given a date',
    ARRAY[octet_length(v ->> 'path')::text,
          (SELECT coalesce(t.last_used_at::text, 'null') FROM private.access_tokens t
            WHERE t.household_id = s.hh_nair AND t.revoked_at IS NULL),
          (SELECT (coalesce(t.last_used_at, 'epoch'::timestamptz)
                 = coalesce(old_lu, 'epoch'::timestamptz))::text
             FROM private.access_tokens t
            WHERE t.household_id = s.hh_nair AND t.revoked_at IS NOT NULL),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_nair),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_nair AND t.revoked_at IS NULL),
          (SELECT array_agg(t.expiry_policy)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_nair AND t.revoked_at IS NULL),
          v ->> 'household_id']::text[],
    ARRAY['46', 'null', 'true', '2', '1', '{no_expiry}',
          current_setting('s8b.hh_nair')]::text[]);

  -- The answer door, on a link nobody has ever opened. This is the only ordering that can prove the
  -- write door does not stamp: answer first, then look, then open.
  v := pg_temp.s8b_answer(raw2,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', current_setting('s8b.ev_muurtham'),
      'attending', 'attending', 'party_size', 3))));
  st := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM pg_temp.s8b_eq('N2 §4.2''s quieter rule, measured: a family may answer an invitation it never '
    'opened — the submission is accepted, one row is written, and it is the household''s own row — but the '
    'credential that carried it still reads `last_used_at` NULL, and the host''s panel still reports the '
    'link as never opened. The write door''s own comment (`:927-929`) says the field means "the invitation '
    'was opened" and that a host did not ask for a claim about anything else; an implementation that '
    'stamped on the way through would be indistinguishable from that comment being wrong',
    ARRAY[(v ->> 'recorded'), (v ->> 'events_recorded'),
          (v ->> 'household_id'),
          ((v ->> 'responded_at')::timestamptz = now())::text,
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_nair AND r.event_id = s.ev_muurtham
              AND r.response_source = 'guest' AND r.party_size = 3),
          (SELECT coalesce(t.last_used_at::text, 'null') FROM private.access_tokens t
            WHERE t.household_id = s.hh_nair AND t.revoked_at IS NULL),
          (SELECT e ->> 'link_state' FROM jsonb_array_elements(st) e
            WHERE (e ->> 'household_id')::uuid = s.hh_nair),
          (SELECT jsonb_typeof(e -> 'link_last_used_at')::text FROM jsonb_array_elements(st) e
            WHERE (e ->> 'household_id')::uuid = s.hh_nair)]::text[],
    ARRAY['true', '1', current_setting('s8b.hh_nair'), 'true', '1', 'null', 'live',
          'null']::text[]);

  PERFORM pg_temp.s8b_door(raw2);
  SELECT t.last_used_at INTO lu_then FROM private.access_tokens t
   WHERE t.household_id = s.hh_nair AND t.revoked_at IS NULL;
  st := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM pg_temp.s8b_eq('N3 and the read door is what writes it: opening that same link once sets the '
    'field, to `now()` rather than to some other clock reading, and the host''s panel now reports a string '
    'where N2 reported JSON null for the same household a few statements earlier — the two halves of the '
    'product''s promise about usage are measured on one row, in the order the promise describes them',
    ARRAY[(lu_then IS NOT NULL)::text,
          (lu_then = now())::text,
          (SELECT jsonb_typeof(e -> 'link_last_used_at')::text FROM jsonb_array_elements(st) e
            WHERE (e ->> 'household_id')::uuid = s.hh_nair),
          (pg_temp.s8b_door(raw2) ->> 'available')]::text[],
    ARRAY['true', 'true', 'string', 'true']::text[]);

  -- A second never-opened link, for the control at the end of the storm arm: without a real read that is
  -- known to move the ledger, "the storm moved nothing" would be unfalsifiable.
  v := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.rotate_guest_invitation('
    || quote_literal(current_setting('s8b.hh_idaveli')) || '::uuid)');
  PERFORM set_config('s8b.raw_idaveli2', substr(v ->> 'path', 4), false);
  SELECT t.id::text INTO tid FROM private.access_tokens t
   WHERE t.household_id = current_setting('s8b.hh_idaveli')::uuid AND t.revoked_at IS NULL;

  snap := pg_temp.s8b_ledger();

  -- The storm: shapes that were never credentials, and every dead state this file can produce, aimed at
  -- both doors, each answer carried by a body that would have been written if the credential had worked.
  storm := storm || pg_temp.s8b_door(rpad('zzprobe', 43, 'q'));
  storm := storm || pg_temp.s8b_door(repeat('9', 43));
  storm := storm || pg_temp.s8b_door(NULL);
  storm := storm || pg_temp.s8b_door(current_setting('s8b.raw_idaveli'));
  storm := storm || pg_temp.s8b_answer(rpad('zzprobe', 43, 'q'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', current_setting('s8b.ev_muurtham'),
      'attending', 'attending', 'party_size', 1))));
  storm := storm || pg_temp.s8b_answer(repeat('8', 43),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', current_setting('s8b.ev_reception'),
      'attending', 'declined', 'party_size', 0))));
  storm := storm || pg_temp.s8b_answer(current_setting('s8b.raw_chenna'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', current_setting('s8b.ev_muurtham'),
      'attending', 'attending', 'party_size', 1))));
  storm := storm || pg_temp.s8b_answer(current_setting('s8b.raw_raman'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', current_setting('s8b.ev_muurtham'),
      'attending', 'attending', 'party_size', 1))));

  snap2 := pg_temp.s8b_ledger();

  -- The positive control, through the same instrument rather than beside it.
  PERFORM pg_temp.s8b_door(current_setting('s8b.raw_idaveli2'));
  snap3 := pg_temp.s8b_ledger();

  PERFORM pg_temp.s8b_eq('N4 eight hostile or dead reads and answers move nothing: the ledger of every '
    'household credential row of this wedding, live and retired alike, is byte-identical after the storm — '
    'including the revoked family whose link was replayed with a perfectly good body, and the expired '
    'family''s row, and the retired link of the family that had just rotated it. Then the same instrument '
    'is proven to notice the one thing it is for: a single real read of a never-opened link changes exactly '
    'one entry, and it is that credential''s. Without the control the first arm would be satisfied by a '
    'door that stamps nothing at all, which is the defect it claims to rule out',
    ARRAY[cardinality(storm)::text,
          (snap2 = snap)::text,
          (SELECT count(*)::text FROM unnest(storm) x
            WHERE NOT ((x ? 'available' AND (x ->> 'available') = 'false')
                    OR (x ? 'recorded' AND (x ->> 'recorded') = 'false'))),
          (SELECT count(*)::text FROM jsonb_each(snap3) a
             JOIN jsonb_each(snap2) b ON b.key = a.key
            WHERE a.value IS DISTINCT FROM b.value),
          (SELECT a.key FROM jsonb_each(snap3) a
             JOIN jsonb_each(snap2) b ON b.key = a.key
            WHERE a.value IS DISTINCT FROM b.value),
          tid,
          cardinality(pg_temp.s8b_top_keys(snap3))::text]::text[],
    ARRAY['8', 'true', '0', '1', tid, tid,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation')]::text[]);

  -- The third arm: a withdrawal is a host action on one family, and it must not rewrite the record of
  -- another — or of itself. Pillai is used because the host then sends it a fresh link, so the household
  -- stays answerable for group A.
  SELECT count(*) INTO live_then FROM private.access_tokens t
   WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
     AND t.revoked_at IS NULL;
  v := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.revoke_guest_invitation('
    || quote_literal(current_setting('s8b.hh_pillai')) || '::uuid)');
  PERFORM pg_temp.s8b_eq('N5 withdrawing one family''s link moves no ledger value anywhere in this wedding '
    '— the whole map is unchanged — while provably doing the one thing it is for: the live count drops by '
    'exactly one, the Nair family''s stamp is still the instant N3 wrote, and the retired Pillai row keeps '
    'the usage it accumulated while it was live (`(s8b_ledger() = snap3)` is the arm that a vacuous '
    'withdrawal could not pass)',
    ARRAY[(v ->> 'credentials_revoked'),
          (pg_temp.s8b_ledger() = snap3)::text,
          (live_then - (SELECT count(*) FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NULL))::text,
          ((SELECT t.last_used_at FROM private.access_tokens t
              WHERE t.household_id = s.hh_nair AND t.revoked_at IS NULL) = lu_then)::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = current_setting('s8b.hh_pillai')::uuid
              AND t.last_used_at IS NOT NULL)]::text[],
    ARRAY['1', 'true', '1', 'true', '2']::text[]);

  -- Pillai must answer later (A's cap and scope refusals, and the guest row M then deletes), so the host
  -- sends it a new link the way a host would: by issuing again.
  v := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, ARRAY['
    || quote_literal(current_setting('s8b.hh_pillai')) || '::uuid], NULL)');
  PERFORM set_config('s8b.raw_pillai',
    (SELECT substr(i ->> 'path', 4) FROM jsonb_array_elements(v -> 'invitations') i
      WHERE (i ->> 'household_id')::uuid = current_setting('s8b.hh_pillai')::uuid), false);
  SELECT t.last_used_at INTO fresh_lu FROM private.access_tokens t
    WHERE t.household_id = current_setting('s8b.hh_pillai')::uuid
      AND t.revoked_at IS NULL;
  d := pg_temp.s8b_door(current_setting('s8b.raw_pillai'));
  PERFORM pg_temp.s8b_eq('N6 and a withdrawn family is not poisoned: the send that answered `already_live` '
    'for a live link answers `issued` now the slot is empty, the new secret is unopened when it arrives and '
    'opens the door — three credential rows for the household, one live, its ledger NULL before the read and '
    'stamped by it. The two ledger readings sit on opposite sides of the door call because every expression '
    'of one SQL statement sees the snapshot taken when that statement began, so a door and a reading of '
    'what the door touched, inside the same `ARRAY[…]`, would compare against the pre-door state whatever '
    'the door did',
    ARRAY[(v ->> 'issued'),
          (fresh_lu IS NULL)::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = current_setting('s8b.hh_pillai')::uuid),
          (d ->> 'available'),
          (SELECT (t.last_used_at IS NOT NULL)::text FROM private.access_tokens t
            WHERE t.household_id = current_setting('s8b.hh_pillai')::uuid
              AND t.revoked_at IS NULL)]::text[],
    ARRAY['1', 'true', '3', 'true', 'true']::text[]);
END $N$;

-- --------------------------------------------------------------------------- A: the answer door
-- §4.1's line, drawn in the opposite direction from U's. The read door answers one way to every dead
-- credential because a stranger with a link is entitled to learn nothing. The answer door has a
-- different reader — a family that is at its own invitation and did something wrong with the form — so a
-- problem with the *body* is answered specifically, and a problem with *access* keeps the generic refusal.
-- Ruling 4.1 says the two never mix, and the body checks are written before the credential is read
-- (`:749-838` versus `:840`).
--
-- That ordering is the whole of this group's first claim, and it is falsified in both directions: the same
-- eighteen malformed bodies must raise the same refusal with a working credential in the header (which is
-- what a real guest's browser sends) and with no header at all (which is what a probe sends). If the
-- credential were read first, the second column would answer `unavailable` instead of raising.
--
-- Two refusals sit between the families — `party_size_too_large` and `answers_not_accepted` — and they
-- divide along the code's own ordering: the ceiling is read from the household the credential resolves to
-- (`:865-883`, after the lookup at `:840`), while the unasked-question answer is returned inside the body
-- loop (`:779-783`), before it. This group proves both halves: no dead credential is ever told anything
-- about its own headcount, and the one answer a dead link does receive is byte-identical to the answer the
-- same body receives from a caller holding no link at all.
DO $A$
DECLARE s s8c%ROWTYPE; v jsonb; w jsonb; st jsonb; muuid text; ruuid text; fuid text;
        g text; n_before bigint; n_after bigint; raw_live text; asked jsonb;
        refused jsonb; accepted jsonb; mis_event jsonb; uncapped jsonb;
        p_before integer; p_after integer; n_a integer; n_b integer; n_labels integer;
        live_ok jsonb; c999 jsonb; r999 jsonb; n999 jsonb; cask jsonb; iask jsonb; nask jsonb;
        q3a jsonb; q3b jsonb; q3c jsonb; q5a jsonb; q5b jsonb; q5c jsonb;
        rev6 jsonb; door6 jsonb; two7 jsonb; mix8 jsonb; sz8 text;
        mis9 jsonb; own9 jsonb; cnt9 bigint;
BEGIN
  SELECT * INTO s FROM s8c;
  muuid := current_setting('s8b.ev_muurtham');
  ruuid := current_setting('s8b.ev_reception');
  fuid  := current_setting('s8b.ev_farewell');
  raw_live := current_setting('s8b.raw_nair2');
  -- One body, sent three ways below: a well-formed answer that also tries to reply to a question this
  -- door never asks.
  asked := jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
    'event_id', muuid, 'attending', 'attending', 'party_size', 1,
    'answers', jsonb_build_object('meal', 'none'))));

  -- The storm's own bookkeeping, read before and after rather than asserted from what this file hopes it
  -- inserted: the counter is the harness's, and the row count is the product's.
  p_before := coalesce(nullif(current_setting('s8b.passed', true), ''), '0')::int;
  n_before := (SELECT count(*) FROM public.rsvp_responses WHERE wedding_id = s.wed_a);

  FOREACH g IN ARRAY ARRAY['MA1', 'MA2'] LOOP
    IF g = 'MA1' THEN
      PERFORM pg_temp.s8b_send(raw_live);
    ELSE
      PERFORM pg_temp.s8b_send(NULL);
    END IF;

    INSERT INTO probes (grp, label, stmt, want_state, want_like)
    SELECT g, q.label,
           CASE WHEN q.body IS NULL THEN 'SELECT api.submit_guest_rsvp(NULL)'
                ELSE 'SELECT api.submit_guest_rsvp(' || quote_literal(q.body) || '::jsonb)' END,
           q.state, q.want_like
      FROM (VALUES
        ('01-null-argument', NULL,
         '23514', '%not in the shape%'),
        ('02-top-level-array', jsonb_build_array(1, 2)::text,
         '23514', '%not in the shape%'),
        ('03-top-level-string', '"x"',
         '23514', '%not in the shape%'),
        ('04-empty-object', '{}'::jsonb::text,
         '23514', '%not in the shape%'),
        ('05-events-absent', jsonb_build_object('welcome', 'x')::text,
         '23514', '%not in the shape%'),
        ('06-events-not-array', jsonb_build_object('events', 'x')::text,
         '23514', '%not in the shape%'),
        ('07-events-empty-array', jsonb_build_object('events', '[]'::jsonb)::text,
         '23514', '%not in the shape%'),
        ('08-item-not-object', jsonb_build_object('events', '[3]'::jsonb)::text,
         '23514', '%not in the shape%'),
        ('09-attending-unknown',
         jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
           'event_id', muuid, 'attending', 'maybe', 'party_size', 1)))::text,
         '23514', '%not in the shape%'),
        ('10-event-id-not-a-uuid',
         jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
           'event_id', 'zz-not-a-uuid', 'attending', 'attending', 'party_size', 1)))::text,
         '23514', '%not in the shape%'),
        ('11-party-size-fraction',
         jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
           'event_id', muuid, 'attending', 'attending', 'party_size', 1.5)))::text,
         '23514', '%not in the shape%'),
        ('12-party-size-absent',
         jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
           'event_id', muuid, 'attending', 'attending')))::text,
         '23514', '%not in the shape%'),
        ('13-attending-with-zero',
         jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
           'event_id', muuid, 'attending', 'attending', 'party_size', 0)))::text,
         '23514', '%not in the shape%'),
        ('14-party-size-negative',
         jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
           'event_id', muuid, 'attending', 'declined', 'party_size', -1)))::text,
         '23514', '%not in the shape%'),
        ('15-party-size-over-ceiling',
         jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
           'event_id', muuid, 'attending', 'attending', 'party_size', 1001)))::text,
         '23514', '%not in the shape%'),
        ('16-unknown-key-on-card',
         jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
           'event_id', muuid, 'attending', 'attending', 'party_size', 1, 'notes', 'x')))::text,
         '23514', '%not in the shape%'),
        ('17-same-event-twice',
         jsonb_build_object('events', jsonb_build_array(
           jsonb_build_object('event_id', muuid, 'attending', 'attending', 'party_size', 1),
           jsonb_build_object('event_id', muuid, 'attending', 'declined', 'party_size', 0)))::text,
         '23514', '%answered twice%'),
        ('18-twenty-one-items',
         jsonb_build_object('events', (SELECT jsonb_agg(jsonb_build_object(
           'event_id', 'x', 'attending', 'attending', 'party_size', 1))
           FROM generate_series(1, 21) n))::text,
         '23514', '%too many answers%'),
        -- The four keys this door requires, each tested as *absent* as well as mis-typed, because the
        -- first body of `submit_guest_rsvp` tested absence with `jsonb_typeof(x) <> 't'`, which is NULL
        -- and therefore never true for a missing key. A card missing `attending` or `party_size` walked
        -- past every guard into the INSERT and aborted there on the column's own NOT NULL
        -- (`20260925120300...:78-79`), reporting a table and a column to a stranger;
        -- a body with no `events` was accepted as a recorded answer that recorded nothing. The guards are
        -- at `:760`, `:793`, `:805` and `:815` now, and these four probes are what that repair is for.
        ('19-item-empty-object', jsonb_build_object('events', '[{}]'::jsonb)::text,
         '23514', '%not in the shape%'),
        ('20-event-id-absent',
         jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
           'attending', 'attending', 'party_size', 1)))::text,
         '23514', '%not in the shape%'),
        ('21-attending-absent',
         jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
           'event_id', muuid, 'party_size', 1)))::text,
         '23514', '%not in the shape%'),
        ('22-party-size-null-value',
         jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
           'event_id', muuid, 'attending', 'attending', 'party_size', NULL)))::text,
         '23514', '%not in the shape%')
      ) q(label, body, state, want_like);

    PERFORM pg_temp.s8b_run(g, 'anon', NULL);
  END LOOP;

  p_after  := coalesce(nullif(current_setting('s8b.passed', true), ''), '0')::int;
  n_a      := (SELECT count(*)::int FROM probes WHERE grp = 'MA1');
  n_b      := (SELECT count(*)::int FROM probes WHERE grp = 'MA2');
  n_labels := (SELECT count(DISTINCT label)::int FROM probes WHERE grp IN ('MA1', 'MA2'));
  n_after  := (SELECT count(*) FROM public.rsvp_responses WHERE wedding_id = s.wed_a);

  PERFORM pg_temp.s8b_eq('A0 the two probe columns are the ordering claim, and both halves of it are '
    'counted rather than described: MA1 ran every body below against a header holding a live, working '
    'household credential, MA2 ran the same set with no header at all, and both columns refused with the '
    'body''s own sentence at 23514 — which is only possible if the shape guards at `:750-838` run before '
    'the credential read at `:840`. Had the credential been resolved first, every MA2 body would have '
    '*returned* `{"recorded": false, "reason": "unavailable"}` instead of raising, and the harness '
    'refuses a probe that returns (`:187-189`), so the group would have failed rather than passed quietly. '
    'The four numbers are the group''s own instrumentation: twenty-two bodies per column, twenty-two '
    'distinct labels, forty-four refusals added to the counter, and this wedding''s answer rows exactly as '
    'numerous afterwards as before — a refusal is a refusal, not a partial write',
    ARRAY[n_a::text, n_b::text, n_labels::text, (p_after - p_before)::text,
          (n_after = n_before)::text]::text[],
    ARRAY['22', '22', '22', '44', 'true']::text[]);

  -- The positive control for the column that carried a header. Without it, MA1 would be consistent with
  -- "the probes were run against a dead credential and every body happens to refuse first", which is a
  -- different claim and a weaker test.
  live_ok := pg_temp.s8b_answer(raw_live,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 1))));
  PERFORM pg_temp.s8b_eq('A0b the header MA1 used was live, measured by the door itself and not asserted: '
    'one well-formed body sent with the same header immediately after the storm is recorded, and it is '
    'recorded against the one event this family was scoped to (`80_guest_invitation_links.sql:422-423`), '
    'which upserts rather than adds — so the forty-four refusals above are refusals of the bodies and not '
    'of a credential that would have refused them anyway, and the family still holds one answer row. The '
    'count is read after the submission statement, not beside it: in one SQL statement every expression '
    'sees that statement''s starting snapshot, so a read next to the write it is meant to check would see '
    'the household as it was before the door ran',
    ARRAY[live_ok ->> 'recorded',
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_nair)]::text[],
    ARRAY['true', '1']::text[]);

  -- Now the access family, at this door.
  n_before := (SELECT count(*) FROM public.rsvp_responses WHERE wedding_id = s.wed_a);
  PERFORM pg_temp.s8b_send(NULL);
  v := pg_temp.s8b_answer(NULL,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 1))));
  w := pg_temp.s8b_answer(rpad('zzanswer', 43, 'q'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 1))));
  st := pg_temp.s8b_answer(current_setting('s8b.raw_chenna'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 1))));
  n_after := (SELECT count(*) FROM public.rsvp_responses WHERE wedding_id = s.wed_a);

  PERFORM pg_temp.s8b_eq('A1 §4.1 carried to the write door: a well-formed answer sent with no credential, '
    'with a well-formed credential that is nobody''s, and with a real credential the host withdrew, all '
    'render the same two-name refusal — and the count of this wedding''s answers is exactly what it was, '
    'so the refusal is a refusal and not a partial write',
    ARRAY[(v = w)::text, (w = st)::text,
          pg_temp.s8b_pairs(v)::text,
          pg_temp.s8b_top_keys(v)::text,
          (n_after = n_before)::text,
          jsonb_typeof(v -> 'reason')]::text[],
    ARRAY['true', 'true', '{reason=unavailable,recorded=false}',
          '{reason,recorded}', 'true', 'string']::text[]);

  -- The converse of Ruling 4.1, which is the half that a family with a dead link is protected by. The six
  -- sends are each their own statement and the store is read afterwards, so the last cell measures what
  -- the five refusals left behind instead of reading the state they all start from.
  c999 := pg_temp.s8b_answer(current_setting('s8b.raw_chenna'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 999))));
  r999 := pg_temp.s8b_answer(current_setting('s8b.raw_raman'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 999))));
  n999 := pg_temp.s8b_answer(NULL,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 999))));
  cask := pg_temp.s8b_answer(current_setting('s8b.raw_chenna'), asked);
  iask := pg_temp.s8b_answer(current_setting('s8b.raw_idaveli'), asked);
  nask := pg_temp.s8b_answer(NULL, asked);
  PERFORM pg_temp.s8b_eq('A2 a dead credential is told nothing about the household behind it, and is told '
    'no more than a stranger with no credential: the withdrawn family''s link asked to bring 999 and the '
    'expired family''s link asked the same, and both got the generic refusal (a working link would have '
    'been told `party_size_too_large`, because the ceiling comes from the household row the credential '
    'resolves to at `:865-883`) — and so does a caller with no header at all, which is the third cell, '
    'without which the first two would also be satisfied by a door that never names a ceiling for '
    'anybody. The same two dead links sending an optional-question answer instead receive, byte for byte, '
    'the answer that body receives with no credential whatsoever (`:779-783`, inside the body loop, in '
    'front of the lookup at `:840`) — a sentence about the request, the same for every household of every '
    'wedding, so holding a dead secret buys no information that holding nothing does not. The reason cell '
    'proves that equality is not two refusals matching by accident: the shared answer is named, not '
    '`unavailable`. And none of the five wrote an answer row',
    ARRAY[(c999 = v)::text, (r999 = v)::text, (n999 = v)::text,
          (cask = nask)::text,
          (iask = nask)::text,
          nask ->> 'reason',
          (n_after = (SELECT count(*) FROM public.rsvp_responses
                       WHERE wedding_id = s.wed_a))::text]::text[],
    ARRAY['true', 'true', 'true', 'true', 'true', 'answers_not_accepted', 'true']::text[]);

  -- The optional-question refusal, and the ordering that only a crafted body can show.
  q3a := pg_temp.s8b_answer(raw_live,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 1,
      'answers', jsonb_build_object('meal', 'no nuts')))));
  q3b := pg_temp.s8b_answer(raw_live,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 1,
      'answers', jsonb_build_object('meal', 'no nuts'), 'notes', 'x'))));
  q3c := pg_temp.s8b_answer(raw_live,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 1,
      'answers', '{}'::jsonb))));
  PERFORM pg_temp.s8b_eq('A3 §4.2: a live family that tried to answer a question this invitation never '
    'asked is told so specifically — and the same body with an unknown key *also* on it is still told '
    '`answers_not_accepted` rather than being called malformed, because the answers test at `:780` is '
    'written before the unknown-key test at `:787`. An implementation that swapped those two lines would '
    'answer this family with 23514, and this assertion is what notices. The empty object is the other edge: '
    '`answers: {}` is a family that opened the optional panel and filled in nothing, and it is accepted — '
    'and the count, read after the three statements above, is the proof that the accepted one revised the '
    'family''s single event row rather than adding a second one',
    ARRAY[q3a ->> 'reason',
          pg_temp.s8b_pairs(q3b)::text,
          q3c ->> 'recorded',
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_nair)]::text[],
    ARRAY['answers_not_accepted',
          '{reason=answers_not_accepted,recorded=false}', 'true', '1']::text[]);

  -- The cap, its ceiling, its skip, and its position in front of the scope test. Each answer is sent by
  -- its own statement, and the store is read only afterwards. That separation is not tidiness: every
  -- expression of one SQL statement sees the snapshot taken when that statement began, so a submission
  -- and a count of what it wrote, sitting in the same `ARRAY[…]`, compare against the *pre-write* state
  -- no matter what the door did — the 'nothing is written for the refused answer' cell would have been
  -- green even against a door that wrote it, and the 'seven is stored' cell failed here for exactly that
  -- reason. Measured on this cluster: `ARRAY[write_returning_1(), read_count()]` answers `{1,0}`.
  refused := pg_temp.s8b_answer(current_setting('s8b.raw_pillai'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 3))));
  PERFORM pg_temp.s8b_eq('A4a §7''s ceiling is named and nothing is stored: the family the host sized at '
    'two asked to bring three, and the answer carries `party_size_too_large` with no second name, while '
    'the household''s whole answer store is still the empty set it was before the call',
    ARRAY[pg_temp.s8b_pairs(refused)::text,
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = current_setting('s8b.hh_pillai')::uuid)]::text[],
    ARRAY['{reason=party_size_too_large,recorded=false}', '0']::text[]);

  accepted := pg_temp.s8b_answer(current_setting('s8b.raw_pillai'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 2))));
  mis_event := pg_temp.s8b_answer(current_setting('s8b.raw_pillai'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', ruuid, 'attending', 'attending', 'party_size', 3))));
  uncapped := pg_temp.s8b_answer(raw_live,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 7))));
  PERFORM pg_temp.s8b_eq('A4b the ceiling accepts its own value, runs before the scope test, and is '
    'skipped when the host set none: two is recorded for Pillai and reads back as two; the same family''s '
    'three-person answer for an event that is not its own is refused for its headcount and not for its '
    'access, which is visible only because the cap loop at `:877` and the scope loop at `:889-900` '
    'disagree about which answer to give; and Nair, whose host left the expectation blank, is allowed '
    'seven because `:879` skips the comparison rather than reading NULL as zero — the difference between '
    '"the host set no ceiling" and "nobody may come", and the stored headcount is the proof it was '
    'accepted rather than a return value that says so',
    ARRAY[accepted ->> 'recorded',
          (SELECT r.party_size::text FROM public.rsvp_responses r
            WHERE r.household_id = current_setting('s8b.hh_pillai')::uuid
              AND r.event_id = s.ev_muurtham),
          pg_temp.s8b_pairs(mis_event)::text,
          uncapped ->> 'recorded',
          (SELECT r.party_size::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_nair AND r.event_id = s.ev_muurtham)]::text[],
    ARRAY['true', '2', '{reason=party_size_too_large,recorded=false}', 'true', '7']::text[]);

  -- The event the household was given but the couple stopped running. This is the assertion that the
  -- `enabled` half of the scope test at `:894-897` exists: Pillai holds a real scope row for Farewell, so
  -- a door that checked only the scope would have written an answer for a ceremony that is not happening.
  q5a := pg_temp.s8b_answer(current_setting('s8b.raw_pillai'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', fuid, 'attending', 'declined', 'party_size', 0))));
  q5b := pg_temp.s8b_answer(current_setting('s8b.raw_pillai'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', fuid, 'attending', 'declined', 'party_size', 0))));
  q5c := pg_temp.s8b_answer(raw_live,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', fuid, 'attending', 'declined', 'party_size', 0))));
  PERFORM pg_temp.s8b_eq('A5 a family scoped to a switched-off ceremony cannot answer it, and is not told '
    'that this is why: Pillai''s own scope row for Farewell is what makes this a measurement of the '
    '`enabled` test rather than of the scope test, and the answer it gets is byte-identical to A1''s dead '
    'credentials — "not invited to that" and "that is not happening" and "your link is dead" are one '
    'sentence, which is the point of Ruling 4.1 at a door whose reader is a guest. The farewell count is '
    'read after the three sends above, so it is a measurement of their writing nothing rather than the '
    'state they all start from',
    ARRAY[pg_temp.s8b_pairs(q5a)::text,
          (q5b = v)::text,
          (q5c = v)::text,
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.event_id = s.ev_farewell)]::text[],
    ARRAY['{reason=unavailable,recorded=false}', 'true', 'true', '0']::text[]);

  -- One family, its whole answer, twice. The before-state and the after-state cannot share one statement
  -- with the revision: every expression of a SQL statement reads that statement's starting snapshot, so the
  -- row the revision rewrites looks unchanged to the reads sitting beside it. Two assertions, three
  -- statements, and the claims each one makes are the ones its own position can measure.
  PERFORM pg_temp.s8b_eq('A6a the family''s position before it changes its mind: one row for the ceremony it '
    'answered, and it is the headcount A4b accepted, carrying the empty optional answers A3 accepted, with '
    'the guest as its source. This is the state A6b''s revision is measured against',
    ARRAY[(SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_nair AND r.event_id = s.ev_muurtham),
          (SELECT (r.attending || '|' || r.party_size::text || '|' || r.response_source)::text
             FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_nair AND r.event_id = s.ev_muurtham),
          (SELECT (r.answers = '{}'::jsonb)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_nair AND r.event_id = s.ev_muurtham)]::text[],
    ARRAY['1', 'attending|7|guest', 'true']::text[]);

  rev6 := pg_temp.s8b_answer(raw_live,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'declined', 'party_size', 0))));
  door6 := pg_temp.s8b_door(raw_live);
  PERFORM pg_temp.s8b_eq('A6b a family that changes its mind overwrites rather than accumulates: the '
    'revision records one event and still leaves one row for it, the second submission''s position is the '
    'one on the table, its `answers` object is reset to empty by the same statement that writes it (`:922`), '
    'its source is still `guest`, and the door now shows the family the revision it made — a returning '
    'household sees what it last said, not what it said first',
    ARRAY[rev6 ->> 'events_recorded',
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_nair AND r.event_id = s.ev_muurtham),
          (SELECT r.attending FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_nair AND r.event_id = s.ev_muurtham),
          (SELECT (r.answers = '{}'::jsonb)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_nair AND r.event_id = s.ev_muurtham),
          (SELECT r.response_source FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_nair AND r.event_id = s.ev_muurtham),
          (door6 -> 'guest' -> 'events' -> 0 ->> 'attending'),
          ((door6 -> 'guest' -> 'events' -> 0 ->> 'responded_at')::timestamptz = now())::text]::text[],
    ARRAY['1', '1', 'declined', 'true', 'guest', 'declined', 'true']::text[]);

  -- The two-event submission, and the host's transcription it erases. The submission is its own statement
  -- and the four store readings follow it, because a read beside the write sees the row before the door
  -- touched it — including the flipped source and the erased marker, which is the whole of this claim.
  two7 := pg_temp.s8b_answer(current_setting('s8b.raw_baby'),
    jsonb_build_object('events', jsonb_build_array(
      jsonb_build_object('event_id', muuid, 'attending', 'attending', 'party_size', 2),
      jsonb_build_object('event_id', ruuid, 'attending', 'attending', 'party_size', 2))));
  PERFORM pg_temp.s8b_eq('A7 one submission, both of a family''s events: two rows written in one call, and '
    'the reception row that X17 planted as the host''s transcription of a phone call is now the '
    'family''s own answer — `response_source` flipped to `guest` and the host''s optional `meal` value '
    'erased, because the DO UPDATE resets `answers` unconditionally. That is a real consequence of the '
    'rule rather than a side effect to apologize for: the household''s latest word outranks the host''s '
    'note of an earlier one, and this battery records it as measured, not as intended-by-accident',
    ARRAY[two7 ->> 'events_recorded',
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_baby AND r.response_source = 'guest'),
          (SELECT (r.attending || '|' || r.party_size::text)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_baby AND r.event_id = s.ev_reception),
          (SELECT (r.answers ? 'meal')::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_baby AND r.event_id = s.ev_reception),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.answers ->> 'meal' = current_setting('s8b.mk_other_answer'))]::text[],
    ARRAY['2', '2', 'attending|2', 'false', '0']::text[]);

  -- All-or-nothing, measured by what did not move. The before-state is read into a variable in its own
  -- statement, the mixed submission runs, and the after-state is read in the assertion — otherwise the
  -- second reading would be the first one again, and the arm that shows the family was not half-replaced
  -- would be satisfied by any door, including one that wrote the wrong event.
  SELECT array_agg(r.party_size::text ORDER BY r.event_id)::text INTO sz8
    FROM public.rsvp_responses r WHERE r.household_id = s.hh_baby;
  mix8 := pg_temp.s8b_answer(current_setting('s8b.raw_baby'),
    jsonb_build_object('events', jsonb_build_array(
      jsonb_build_object('event_id', muuid, 'attending', 'attending', 'party_size', 1),
      jsonb_build_object('event_id', fuid, 'attending', 'declined', 'party_size', 0))));
  PERFORM pg_temp.s8b_eq('A8 §5''s "all-or-nothing" is a shape claim about the write loop, and it is '
    'measured: a submission that gets one event right and one event wrong writes neither — the validation '
    'loops at `:877-900` run to completion before the first INSERT at `:910`, so the family''s earlier '
    'answers keep the headcount they had rather than being half-replaced. The positive half of the same '
    'arm is that both rows really were the two-event submission''s, so the equality is not comparing '
    'nothing',
    ARRAY[sz8,
          pg_temp.s8b_pairs(mix8)::text,
          (SELECT array_agg(r.party_size::text ORDER BY r.event_id)::text
             FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_baby),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_baby)]::text[],
    ARRAY['{2,2}', '{reason=unavailable,recorded=false}', '{2,2}', '2']::text[]);

  -- The cross-tenant aim: a real credential of the other wedding, pointed at this wedding's event. The
  -- refusal and its residue are read in the statements after it, so "writes nothing here" is a measurement
  -- rather than the state every expression in the same statement already saw.
  mis9 := pg_temp.s8b_answer(current_setting('s8b.raw_stranger'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', muuid, 'attending', 'attending', 'party_size', 1))));
  cnt9 := (SELECT count(*) FROM public.rsvp_responses r
            WHERE r.wedding_id = s.wed_a
              AND r.household_id = current_setting('s8b.hh_stranger')::uuid);
  own9 := pg_temp.s8b_answer(current_setting('s8b.raw_stranger'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', current_setting('s8b.ev_haldi'),
      'attending', 'attending', 'party_size', 1))));
  PERFORM pg_temp.s8b_eq('A9 a credential cannot aim a write at another tenant: the cousin family''s own '
    'working link, offered this wedding''s ceremony, is refused with the generic answer and writes nothing '
    'here; offered its own wedding''s single event it is accepted, and the row it writes carries the other '
    'wedding''s id and its own household — because the function derives `wedding_id` from the credential '
    '(`:847-867`) and never from the body',
    ARRAY[(mis9 = v)::text,
          cnt9::text,
          own9 ->> 'household_id',
          (SELECT (r.wedding_id = s.wed_b)::text FROM public.rsvp_responses r
            WHERE r.household_id = current_setting('s8b.hh_stranger')::uuid),
          (SELECT r.response_source FROM public.rsvp_responses r
            WHERE r.household_id = current_setting('s8b.hh_stranger')::uuid)]::text[],
    ARRAY['true', '0', current_setting('s8b.hh_stranger'), 'true', 'guest']::text[]);

  PERFORM pg_temp.s8b_send(NULL);
END $A$;

-- --------------------------------------------------------------------------- M: who may write an answer
-- §7's claim is not "a host cannot write an RSVP". Hosts write them constantly; that is what
-- `owners_record_manual_rsvps` exists for (`20260925120500_stage2_rls_and_grants.sql:278-283`). The claim
-- is narrower: the source label moves in one direction only. A guest's submission outranks a host's note
-- of an earlier one and rewrites it (`20261009120000...:917-922`, already measured by A7, which flipped X17's planted
-- `host_manual` reception row to `guest`), while the host cannot save an edit that leaves a guest's answer
-- labelled as the guest's own — `owners_update_manual_rsvps` pins `response_source = ''host_manual''` in
-- its WITH CHECK (`:285-294`), which is PostgreSQL's way of refusing the edit rather than a trigger's, and
-- the host who genuinely needs to correct a family does it the honest way: delete the reply (`:296-299`)
-- and record a manual one. No Stage 2 policy is edited or weakened for convenience in either direction,
-- and this group is where that sentence is checked rather than repeated — it holds the inherited policies
-- up against every write a host's screen could ask for, and it proves the host's own manual entry is
-- genuinely not capped, which is §7's asymmetry with only one half measured so far.
--
-- Two design rules keep the probes honest.
--
--   * Every probe is built so that exactly one mechanism can refuse it. A `guest`-sourced insert passes
--     every column CHECK, so the only thing that can stop it is the policy; a `host_manual` insert with an
--     oversized `answers` passes the policy, so the only thing that can stop it is the CHECK. That matters
--     because table constraints are evaluated before the row-level WITH CHECK inside `ExecConstraints`, so
--     a probe that could trip both would be a pass for the wrong reason.
--   * No probe's `want_like` names a policy. PostgreSQL's refusal text for a WITH CHECK violation is built
--     around the table name, and whether the policy name appears in it has moved between major versions;
--     nothing here can measure that until a cluster exists. So the probes pin the state (42501, a
--     privilege-class refusal) and the table, which is what distinguishes an RLS refusal from a syntax
--     error or a constraint trip, and group S reads the policy names out of `pg_policy` instead — a catalog
--     read does not depend on message text.
--
-- An anonymous UPDATE or DELETE is deliberately absent. RLS answers a row the caller cannot see by matching
-- nothing, so a browser-role UPDATE is a silent zero-row statement, not an error, and `run()` refuses a
-- probe that returns without raising (`:187-189`) — which is the right verdict for a probe and the wrong
-- instrument for this case. The zero-row arm is therefore measured where the caller *can* see rows and the
-- statement still must not land (M4, as the other wedding's owner), and the anonymous DML arm is measured
-- as an INSERT, which is refused by one mechanism or the other and always refuses.
DO $M$
DECLARE s s8c%ROWTYPE;
        m_wed uuid; m_hh uuid; m_ev uuid; m_exp integer; m_big integer;
        n bigint; up_a bigint; up_b bigint; del_b bigint; del_a bigint;
        n_before bigint; n_after bigint; g_before bigint; g_after bigint;
        still text; gone bigint;
BEGIN
  SELECT * INTO s FROM s8c;
  n_before := (SELECT count(*) FROM public.rsvp_responses WHERE wedding_id = s.wed_a);
  g_before := (SELECT count(*) FROM public.rsvp_responses
                WHERE wedding_id = s.wed_a AND response_source = 'guest');

  -- The slot every write probe aims at: a real scope row of the tested wedding whose household has an
  -- expectation set and has not answered yet. Picked at run time rather than hard-coded, because a probe
  -- whose composite FK does not resolve is refused for the wrong reason and a probe that lands on an
  -- existing UNIQUE row is refused for the wrong reason too. The pick is then asserted rather than
  -- trusted: a zero-row pick would turn every refusal below into a pass produced by nothing at all.
  SELECT sc.wedding_id, sc.household_id, sc.event_id, h.expected_party_size
    INTO m_wed, m_hh, m_ev, m_exp
    FROM public.household_event_scopes sc
    JOIN public.guest_households h ON h.id = sc.household_id
   WHERE sc.wedding_id = s.wed_a
     AND h.expected_party_size IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.rsvp_responses r
                      WHERE r.household_id = sc.household_id AND r.event_id = sc.event_id)
   ORDER BY h.display_name COLLATE "C", sc.event_id
   LIMIT 1;

  m_big := coalesce(m_exp, 0) + 500;
  PERFORM set_config('s8b.m_wed', coalesce(m_wed::text, ''), false);
  PERFORM set_config('s8b.m_hh',  coalesce(m_hh::text,  ''), false);
  PERFORM set_config('s8b.m_ev',  coalesce(m_ev::text,  ''), false);

  PERFORM pg_temp.s8b_eq('M0 the slot exists and is empty, which is what makes each refusal below a refusal of '
    'the statement rather than of a broken fixture: one scope row of this wedding, its household''s '
    'expectation set, and no answer row for that pair yet — and the expectation is a small number, so the '
    'headcount M2 writes past it is past it by an order of magnitude rather than by one',
    ARRAY[(m_wed = s.wed_a)::text, (m_hh IS NOT NULL)::text, (m_ev IS NOT NULL)::text,
          (m_exp IS NOT NULL)::text,
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = m_hh AND r.event_id = m_ev),
          (m_big > coalesce(m_exp, 0) * 10)::text]::text[],
    ARRAY['true', 'true', 'true', 'true', '0', 'true']::text[]);

  -- The raises, one group per caller. Group names carry an R so they cannot be confused with the M-numbered
  -- assertions below, and each group runs as the role its label names.
  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    -- The owner of this wedding, doing the two things §7 says a host may not do from a client.
    ('MR1', '01-insert-row-labelled-guest',
     'INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, '
     || 'response_source) VALUES (' || quote_literal(m_wed::text) || '::uuid, '
     || quote_literal(m_hh::text) || '::uuid, ' || quote_literal(m_ev::text)
     || '::uuid, ''attending'', 1, ''guest'')',
     '42501', '%violates row-level security policy%'),
    ('MR1', '02-edit-guest-row-keeping-its-label',
     'UPDATE public.rsvp_responses SET attending = ''attending'', party_size = 4 WHERE wedding_id = '
     || quote_literal(s.wed_a::text) || '::uuid AND household_id = '
     || quote_literal(current_setting('s8b.hh_nair')) || '::uuid AND event_id = '
     || quote_literal(s.ev_muurtham::text) || '::uuid',
     '42501', '%violates row-level security policy%'),
    -- The other wedding's owner, doing the one thing a host may do — on a wedding that is not theirs.
    ('MR2', '01-other-owner-inserts-host-manual-here',
     'INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, '
     || 'response_source) VALUES (' || quote_literal(m_wed::text) || '::uuid, '
     || quote_literal(m_hh::text) || '::uuid, ' || quote_literal(m_ev::text)
     || '::uuid, ''attending'', 1, ''host_manual'')',
     '42501', '%violates row-level security policy%'),
    -- No session at all. Which mechanism refuses this is read from the catalog in S; either way the guest
    -- door is the only way an anonymous caller can put an answer on this table, and it is not a write.
    ('MR3', '01-anon-inserts',
     'INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, '
     || 'response_source) VALUES (' || quote_literal(m_wed::text) || '::uuid, '
     || quote_literal(m_hh::text) || '::uuid, ' || quote_literal(m_ev::text)
     || '::uuid, ''attending'', 1, ''host_manual'')',
     '42501', '%rsvp_responses%'),
    -- The column that Stage 8 bounded. All three pass the policy, so all three are refused by the CHECK.
    ('MR4', '01-answers-over-the-octet-ceiling',
     'INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, '
     || 'response_source, answers) VALUES (' || quote_literal(m_wed::text) || '::uuid, '
     || quote_literal(m_hh::text) || '::uuid, ' || quote_literal(m_ev::text)
     || '::uuid, ''attending'', 1, ''host_manual'', '
     || quote_literal('{"k":"' || repeat('q', 2100) || '"}') || '::jsonb)',
     '23514', '%rsvp_responses_answers_check%'),
    ('MR4', '02-answers-not-an-object',
     'INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, '
     || 'response_source, answers) VALUES (' || quote_literal(m_wed::text) || '::uuid, '
     || quote_literal(m_hh::text) || '::uuid, ' || quote_literal(m_ev::text)
     || '::uuid, ''attending'', 1, ''host_manual'', '
     || quote_literal('"just prose"') || '::jsonb)',
     '23514', '%rsvp_responses_answers_check%'),
    ('MR4', '03-attending-outside-the-vocabulary',
     'INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, '
     || 'response_source) VALUES (' || quote_literal(m_wed::text) || '::uuid, '
     || quote_literal(m_hh::text) || '::uuid, ' || quote_literal(m_ev::text)
     || '::uuid, ''maybe'', 1, ''host_manual'')',
     '23514', '%rsvp_responses_attending_check%');

  PERFORM pg_temp.s8b_run('MR1', 'authenticated', current_setting('s8b.owner_a'));
  PERFORM pg_temp.s8b_run('MR2', 'authenticated', current_setting('s8b.owner_b'));
  PERFORM pg_temp.s8b_run('MR3', 'anon', NULL);
  PERFORM pg_temp.s8b_run('MR4', 'authenticated', current_setting('s8b.owner_a'));

  PERFORM pg_temp.s8b_eq('M1 the seven raises above are the whole of the source-label wall, and they are counted '
    'rather than described: two from the wedding''s own owner (minting a `guest` row from the client, and '
    'editing a guest''s answer while leaving it labelled as the guest''s), one from the other wedding''s '
    'owner attempting a legitimate host write on a wedding that is not theirs, one from a caller with no '
    'session at all, and three constraint trips on the column Stage 8 bounded. Nothing was written by any of '
    'them — the count of this wedding''s answers is unchanged — and the guest''s own row, which the second '
    'probe aimed at, still carries the position A6 left it in rather than the headcount the probe tried to '
    'give it',
    ARRAY[(SELECT count(*)::int FROM probes WHERE grp = 'MR1')::text,
          (SELECT count(*)::int FROM probes WHERE grp = 'MR2')::text,
          (SELECT count(*)::int FROM probes WHERE grp = 'MR3')::text,
          (SELECT count(*)::int FROM probes WHERE grp = 'MR4')::text,
          (SELECT count(*)::text FROM public.rsvp_responses WHERE wedding_id = s.wed_a),
          (SELECT (r.attending || '|' || r.party_size::text || '|' || r.response_source)::text
             FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_nair AND r.event_id = s.ev_muurtham)]::text[],
    ARRAY['2', '1', '1', '3', n_before::text, 'declined|0|guest']::text[]);

  -- §7's asymmetry, other half. The cap is the body's, not the table's and not the policy's.
  n := pg_temp.s8b_host_write(current_setting('s8b.owner_a'),
    'INSERT INTO public.rsvp_responses (wedding_id, household_id, event_id, attending, party_size, '
    || 'response_source) VALUES (' || quote_literal(m_wed::text) || '::uuid, '
    || quote_literal(m_hh::text) || '::uuid, ' || quote_literal(m_ev::text)
    || '::uuid, ''attending'', ' || m_big::text || ', ''host_manual'')');

  PERFORM pg_temp.s8b_eq('M2 a host transcribing a phone call is not exercising a permission: the same wedding''s '
    'owner writes a headcount ten times the household''s own expectation and it lands, one row, at that '
    'size, labelled host_manual — because `expected_party_size` is an expectation and the cap that refuses a '
    'guest for exceeding it (`:877-883`) lives in the guest''s body, not in a table constraint and not in '
    'either policy. A7 already measured the guest arm of the same sentence, so this is the half that was '
    'unproven',
    ARRAY[n::text,
          (SELECT (r.party_size::text || '|' || r.response_source)::text FROM public.rsvp_responses r
            WHERE r.household_id = m_hh AND r.event_id = m_ev),
          (SELECT (h.expected_party_size < m_big)::text FROM public.guest_households h
            WHERE h.id = m_hh)]::text[],
    ARRAY['1', m_big::text || '|host_manual', 'true']::text[]);

  -- The edit a host *may* make, on their own kind of row: the policy's WITH CHECK is about the label, so
  -- relabelling is allowed and the label is what makes it honest.
  up_a := pg_temp.s8b_host_write(current_setting('s8b.owner_a'),
    'UPDATE public.rsvp_responses SET attending = ''declined'', party_size = 0, answers = ''{}''::jsonb '
    || 'WHERE wedding_id = ' || quote_literal(m_wed::text) || '::uuid AND household_id = '
    || quote_literal(m_hh::text) || '::uuid AND event_id = ' || quote_literal(m_ev::text) || '::uuid');

  PERFORM pg_temp.s8b_eq('M3 the same caller, the same table, the row after the relabelled edit: an UPDATE that '
    'leaves `response_source` at host_manual is accepted where the probe that left it at guest was refused, '
    'so the wall is exactly the label and not the caller''s identity or the table — one row changed, and the '
    'new position is the one on the table',
    ARRAY[up_a::text,
          (SELECT (r.attending || '|' || r.party_size::text)::text FROM public.rsvp_responses r
            WHERE r.household_id = m_hh AND r.event_id = m_ev)]::text[],
    ARRAY['1', 'declined|0']::text[]);

  -- The cross-tenant arm, measured where the caller can see rows so a no-op is distinguishable from a
  -- refusal: owner_b's UPDATE and DELETE match nothing under their own policies, and the row survives both.
  up_b := pg_temp.s8b_host_write(current_setting('s8b.owner_b'),
    'UPDATE public.rsvp_responses SET attending = ''attending'', party_size = 99 '
    || 'WHERE wedding_id = ' || quote_literal(m_wed::text) || '::uuid AND household_id = '
    || quote_literal(m_hh::text) || '::uuid AND event_id = ' || quote_literal(m_ev::text) || '::uuid');
  del_b := pg_temp.s8b_host_write(current_setting('s8b.owner_b'),
    'DELETE FROM public.rsvp_responses WHERE wedding_id = ' || quote_literal(m_wed::text)
    || '::uuid AND household_id = ' || quote_literal(m_hh::text) || '::uuid AND event_id = '
    || quote_literal(m_ev::text) || '::uuid');
  still := (SELECT (r.attending || '|' || r.party_size::text)::text FROM public.rsvp_responses r
             WHERE r.household_id = m_hh AND r.event_id = m_ev);

  PERFORM pg_temp.s8b_eq('M4 §7''s "delete the reply and record a manual one" is not available to a host who does '
    'not own the wedding: the other couple''s owner runs the identical UPDATE and the identical DELETE against '
    'this row and each matches zero rows, and the row is still there afterwards carrying exactly what M3 left '
    'in it — which is the point of measuring the row count rather than the absence of an error, because RLS '
    'answers an invisible row by matching nothing, and a helper that reported only "no error" would call that '
    'a refusal and a success in the same breath',
    ARRAY[up_b::text, del_b::text, coalesce(still, 'absent')::text]::text[],
    ARRAY['0', '0', 'declined|0']::text[]);

  -- The owner's own DELETE, the same statement shape, as the positive control for the two zeros above — and
  -- as the cleanup that returns this wedding to the state A left it in.
  del_a := pg_temp.s8b_host_write(current_setting('s8b.owner_a'),
    'DELETE FROM public.rsvp_responses WHERE wedding_id = ' || quote_literal(m_wed::text)
    || '::uuid AND household_id = ' || quote_literal(m_hh::text) || '::uuid AND event_id = '
    || quote_literal(m_ev::text) || '::uuid');
  gone := (SELECT count(*) FROM public.rsvp_responses r
            WHERE r.household_id = m_hh AND r.event_id = m_ev);
  n_after := (SELECT count(*) FROM public.rsvp_responses WHERE wedding_id = s.wed_a);
  g_after := (SELECT count(*) FROM public.rsvp_responses r
                WHERE r.wedding_id = s.wed_a AND r.response_source = 'guest');

  PERFORM pg_temp.s8b_eq('M5 the control that makes M4''s two zeros mean something, and the state this group '
    'leaves behind: the wedding''s own owner deletes the same row with the same statement and one row goes, so '
    'the zeros above were refusals and not a broken WHERE clause — and this group is state-neutral, which is '
    'what lets P, Q and Z read the answer rows A left rather than an account of M''s own writes. Every probe '
    'here refused, the one row M2 created is the one row M5 deleted, and the guest rows this file relies on '
    'later were never writable from the client at all',
    ARRAY[del_a::text, gone::text, n_after::text, (n_after = n_before)::text,
          (g_after = g_before)::text]::text[],
    ARRAY['1', '0', n_before::text, 'true', 'true']::text[]);

  PERFORM pg_temp.s8b_send(NULL);
END $M$;

-- --------------------------------------------------------------------------- S: the write authority, read from the catalog
-- Everything above this line is behaviour: doors that answer, rows that land, refusals with a state on
-- them. M refused seven probes and never named the mechanism that refused any of them, because a probe's
-- `want_like` cannot honestly carry a policy name — PostgreSQL builds a WITH CHECK refusal around the
-- *table*, and whether the policy name appears in that sentence has moved between major versions
-- (`:1944-1949`). So the mechanism is read out of the catalog here, where no message text is involved:
-- which policies `public.rsvp_responses` has, which half of each one is populated, what those clauses
-- actually pin, what the caller's own privileges settle before a policy is consulted, and which roles
-- can step around policies altogether.
--
-- S4 is the one element of this group that is not a catalog read, and it is here because a catalog read
-- cannot supply it: `polqual` saying nothing about the source column proves no policy *can* filter on it,
-- and only a read made as the host proves a guest's answer therefore reaches the host's own screen.
--
-- What this deliberately does not restate. Stage 2's catalogue battery is global and re-runs on this head,
-- and three items fell out of S when they were found already measured rather than being kept for the
-- comfort of the sentence next to them:
--   * which roles a policy may target, and whether any policy is restrictive —
--     `stage2/40_catalog.sql:481` (C18, every policy in the database targets `authenticated` alone) and
--     `:485` (C19, all of them permissive);
--   * a second live household credential and the object that refuses it —
--     `80_guest_invitation_links.sql:904` measures the `23505`, and `:989`, `:998` and `:1003` pin the
--     partial unique index that produces it;
--   * the two publication verbs Ruling 8.1 re-declared. Their definer posture, their pinned
--     `search_path`, their grantees and the overload question are all settled by name-set comparisons —
--     `40_catalog.sql:580` (C26), `:627` (C27), `:783` (C28a), `:822` (C28b) — and a `CREATE OR REPLACE`
--     that changed a signature would duplicate a name inside those arrays rather than hide in them, which
--     is the same comparison from the other side. What Stage 8 changed in those bodies is that they move
--     household credentials with a corrected version, and that is a behaviour, so it is group P's claim.
-- What survives is the policy inventory, the clause arithmetic, the label vocabulary, the read
-- visibility, the eight-cell privilege matrix, the BYPASSRLS posture and the identity of the bound on
-- `answers` — none of which any of the assertions above states, and every one of which M had to assume.
--
-- Two deparse hazards shaped the expressions below. `pg_get_expr` writes inferred casts into its output,
-- so a stored clause reads `(response_source = 'host_manual'::text AND ...)`; the tests therefore match a
-- bare word and a quoted literal rather than a whole expression, the way C25 matches
-- `position('auth.uid()' IN pg_get_expr(...))` (`40_catalog.sql:534-536`). And a zero count is only a
-- measurement if the pattern can bite, so each scan below carries its own positive control, written the
-- way the deparse writes.
DO $S$
DECLARE s s8c%ROWTYPE; v jsonb; st bigint; sg bigint;
BEGIN
  SELECT * INTO s FROM s8c;

  -- The inventory, with the command letter the catalog stores rather than the SQL keyword: `polcmd` is
  -- `char`, and INSERT is 'a' and UPDATE is 'w'. Written out because a reader who expects 'i' and 'u'
  -- would read a pass here as a coincidence.
  PERFORM pg_temp.s8b_eq('S1 exactly four policies govern `public.rsvp_responses`, they are Stage 2''s, and '
    'each is named with the letter of the command it covers — read/r, insert/a, update/w, delete/d '
    '(`20260925120500_stage2_rls_and_grants.sql:270,278,285,296`). Stage 8 added no policy to this table and '
    'removed none: a guest''s own answer arrives through a privileged function rather than through a new '
    'write path a host''s client could stumble into, which is the difference between this head and one that '
    'handed `anon` the table',
    (SELECT array_agg(p.polname || '=' || p.polcmd::text ORDER BY p.polname COLLATE "C")
       FROM pg_policy p WHERE p.polrelid = 'public.rsvp_responses'::regclass),
    -- The want list is in the order the pinned `COLLATE "C"` produces, which byte order fixes: `read`
    -- precedes `record` because the third differing character is `a` (0x61) against `c` (0x63). The set of
    -- four names and their four command letters is the claim; the draft of this line carried them in the
    -- order a reader would say them, which no collation sorts to, and the assertion could not have passed
    -- on any cluster.
    ARRAY['owners_delete_rsvps=d', 'owners_read_rsvps=r',
          'owners_record_manual_rsvps=a', 'owners_update_manual_rsvps=w']::text[]);

  -- Which half of each policy is populated, read per command instead of counted: the INSERT policy is
  -- `WITH CHECK` only, so its `polqual` is NULL (that file's `:279`), and a count of non-null USING clauses
  -- would be three — a number with nothing behind it. The shape is the point: the label rule reaches the two
  -- commands that can set a label and cannot reach a read, because a read has nothing to constrain.
  PERFORM pg_temp.s8b_eq('S2 and the same four policies read as clause shape — which commands carry a USING '
    'and which carry a WITH CHECK. Only the two writes carry a CHECK, which is the whole of the label rule''s '
    'reach: it can constrain a row being created or edited and it cannot constrain a read. The insert policy '
    'has no USING clause at all, because `FOR INSERT ... WITH CHECK` stores NULL there, and that is why this '
    'arm lists four strings rather than counting non-null clauses',
    (SELECT array_agg(p.polcmd::text || '=' ||
             CASE WHEN p.polqual IS NULL THEN 'no-USING' ELSE 'USING' END || '/' ||
             CASE WHEN p.polwithcheck IS NULL THEN 'no-CHECK' ELSE 'CHECK' END
             ORDER BY p.polcmd::text COLLATE "C")
       FROM pg_policy p WHERE p.polrelid = 'public.rsvp_responses'::regclass),
    ARRAY['a=no-USING/CHECK', 'd=USING/no-CHECK', 'r=USING/no-CHECK',
          'w=USING/CHECK']::text[]);

  -- The vocabulary the clauses speak, which is §7 in one line: both CHECKs name `host_manual`, and no
  -- clause on this table — read or write — contains the literal `guest`. Read together with S2 that says
  -- the direction of travel: a label can be required of a writer and is never used to hide a row.
  PERFORM pg_temp.s8b_eq('S3 what those clauses pin. Both WITH CHECKs name `host_manual` and no other '
    'literal source value; no clause on this table, USING or CHECK, contains the quoted word `guest`; and no '
    'USING clause mentions a label at all, so nothing here can filter a household''s answer out of its own '
    'host''s view. The quoted-`guest` scan is searched against a string written the way `pg_get_expr` writes '
    'one, in element three, because a zero in element two means nothing until the pattern is shown to bite. '
    'Element four is the read arm of the same sentence: a `host_manual` appearing in a USING clause would be '
    'the policy hiding the host''s own manual rows from the host. None of this says the *column* rejects '
    '`guest` — Stage 2''s column CHECK admits both labels (`20260925120300...:83`), which is exactly why the '
    'wall has to be a policy WITH CHECK and why this scan runs over `pg_policy` alone',
    ARRAY[
      (SELECT count(*)::text FROM pg_policy p
        WHERE p.polrelid = 'public.rsvp_responses'::regclass
          AND p.polwithcheck IS NOT NULL
          AND position('host_manual' IN pg_get_expr(p.polwithcheck, p.polrelid)) > 0),
      (SELECT count(*)::text FROM pg_policy p
        WHERE p.polrelid = 'public.rsvp_responses'::regclass
          AND (position('''guest''' IN coalesce(pg_get_expr(p.polqual, p.polrelid), '')) > 0
            OR position('''guest''' IN coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) > 0)),
      (position('''guest''' IN $$response_source = 'guest'::text$$) > 0)::text,
      (SELECT count(*)::text FROM pg_policy p
        WHERE p.polrelid = 'public.rsvp_responses'::regclass
          AND p.polqual IS NOT NULL
          AND position('host_manual' IN pg_get_expr(p.polqual, p.polrelid)) > 0)],
    ARRAY['2', '0', 'true', '0']::text[]);

  -- The behavioural half, and the reason this group is not purely a catalog read. The first two numbers
  -- come from a SELECT made as `authenticated` with the owner's uid — the read a host's screen performs —
  -- and the two it is compared against come from the same query made here, as the role that built the
  -- fixture. Equal means nothing was hidden by a policy. The last arm is not decoration: an equality
  -- between two zeros would pass the middle two elements while proving nothing was ever visible, so the
  -- guest-labelled count is pinned to exist before it is pinned to match, and the row that makes it
  -- nonzero is the one A7 wrote through the door (`:1856`).
  st := (SELECT count(*) FROM public.rsvp_responses WHERE wedding_id = s.wed_a);
  sg := (SELECT count(*) FROM public.rsvp_responses
          WHERE wedding_id = s.wed_a AND response_source = 'guest');
  v := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT jsonb_build_object(''hostVisible'', count(*), ''guestLabelled'', '
    || 'count(*) FILTER (WHERE response_source = ''guest'')) '
    || 'FROM public.rsvp_responses WHERE wedding_id = '
    || quote_literal(s.wed_a::text) || '::uuid');

  PERFORM pg_temp.s8b_eq('S4 and the read half of that sentence, measured rather than inferred: the '
    'wedding''s own owner, selecting the answers table as a signed-in client does, sees every row this '
    'wedding has and every `guest`-labelled row this wedding has — the same two numbers the fixture''s own '
    'role counts immediately afterwards, of which at least one is a guest''s answer. A USING clause that '
    'filtered on the source label would pass S3 and fail here, and a host screen that could not read a '
    'guest''s answer would make §7''s "delete the reply, record a manual one" impossible to perform',
    ARRAY[(v ->> 'hostVisible'), (v ->> 'guestLabelled'),
          ((v ->> 'hostVisible') = st::text)::text,
          ((v ->> 'guestLabelled') = sg::text)::text,
          (sg > 0)::text],
    ARRAY[st::text, sg::text, 'true', 'true', 'true']::text[]);

  -- All eight cells, named. This is the layer underneath every refusal in M, and M could not have named it
  -- itself: a missing table privilege and a policy WITH CHECK refusal arrive with the same SQLSTATE,
  -- `42501`, so a probe's state cannot tell "the caller was never allowed to touch this table" from "the
  -- caller was allowed and the row failed the rule". Only the catalog can, and it does so by settling the
  -- first question before the second is asked — PostgreSQL checks privileges before policies, so a role
  -- with no INSERT grant never reaches a WITH CHECK. Battery 1 read three of these cells
  -- (`80_guest_invitation_links.sql:1828-1836`), the ones a passing host write could show; the UPDATE and
  -- DELETE arms and `anon`'s INSERT are what M had to assume, and the four `authenticated` trues are what
  -- make its refusals refusals of policy rather than of the grant list.
  PERFORM pg_temp.s8b_eq('S5 the privilege matrix those policies sit on, all eight cells named — every '
    '`anon` cell false, which is the mechanism MR3 met before any policy ran, and every `authenticated` cell '
    'true, which is the control that makes M2/M3/M4''s accepted writes, refused edits and silent zero-row '
    'no-ops all statements about policy rather than about Stage 2''s grant lists '
    '(`20260925120500_stage2_rls_and_grants.sql:37,58`)',
    (SELECT array_agg(r || '|' || q || '='
             || has_table_privilege(r, 'public.rsvp_responses', q)::text
             ORDER BY (r || '|' || q) COLLATE "C")
       FROM unnest(ARRAY['anon', 'authenticated']) r
       CROSS JOIN unnest(ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']) q),
    ARRAY['anon|DELETE=false', 'anon|INSERT=false', 'anon|SELECT=false', 'anon|UPDATE=false',
          'authenticated|DELETE=true', 'authenticated|INSERT=true',
          'authenticated|SELECT=true', 'authenticated|UPDATE=true']::text[]);

  PERFORM pg_temp.s8b_eq('S6 and why an `authenticated` refusal binds at all: neither browser role can step '
    'around row-level security and neither is a superuser, so the two zero-row results M4 measured cannot be '
    'a role that silently skipped a policy. `service_role` is the one that can bypass, and it is not a '
    'browser — it is the server key, which is also why this file never impersonates it to make a claim '
    'about a client. The values are set by the chain itself: `supabase/tests/rls/00_bootstrap.sql:18` runs '
    '`ALTER ROLE service_role BYPASSRLS` on every chain the runner builds, reproducing the hosted layer '
    'rather than inventing a convenience',
    (SELECT array_agg(rolname || ' bypass=' || rolbypassrls::text || ' super=' || rolsuper::text
             ORDER BY rolname COLLATE "C")
       FROM pg_roles WHERE rolname = ANY(ARRAY['anon', 'authenticated', 'service_role'])),
    ARRAY['anon bypass=false super=false', 'authenticated bypass=false super=false',
          'service_role bypass=true super=false']::text[]);

  -- The bound Stage 8 wrote, as an object rather than as a diff. MR4 already proved the constraint fires
  -- and named it in the refusal it expected (`:2039`, `:2046`), so the name is not what this adds: what
  -- only a catalog read can say is that the *ceiling* is in the stored definition, that the replacement
  -- was validated rather than added `NOT VALID`, and that no second constraint on this column appeared
  -- alongside it. Tokens rather than the whole deparse, because `pg_get_constraintdef` inserts inferred
  -- casts and parenthesises on its own schedule — an exact-string comparison here would be a claim about
  -- the server's formatter, and this repository has already been burned once by trusting one.
  PERFORM pg_temp.s8b_eq('S7 `rsvp_responses_answers_check` is one validated CHECK on this table, its stored '
    'definition still carries all four tokens of the bound Stage 8 replaced it with — the object test, the '
    'octet measure, the 2000 ceiling and the column itself — and it is the only CHECK on the table that '
    'mentions that column, so the DROP and re-ADD left nothing doubled behind. The name is the fact '
    '`stage2/20_attacks.sql:1495` pins from the other side: that historical probe expects this exact string '
    'in a refusal, so a bound re-added under a fresh name would have made the old suite describe a '
    'different object, and the only way to hide that would have been to edit the old suite',
    ARRAY[
      (SELECT count(*)::text FROM pg_constraint k
        WHERE k.conrelid = 'public.rsvp_responses'::regclass
          AND k.conname = 'rsvp_responses_answers_check'),
      (SELECT k.convalidated::text FROM pg_constraint k
        WHERE k.conrelid = 'public.rsvp_responses'::regclass
          AND k.conname = 'rsvp_responses_answers_check'),
      (SELECT (position('jsonb_typeof' IN pg_get_constraintdef(k.oid)) > 0
           AND position('octet_length' IN pg_get_constraintdef(k.oid)) > 0
           AND position('2000' IN pg_get_constraintdef(k.oid)) > 0
           AND position('answers' IN pg_get_constraintdef(k.oid)) > 0)::text
         FROM pg_constraint k
        WHERE k.conrelid = 'public.rsvp_responses'::regclass
          AND k.conname = 'rsvp_responses_answers_check'),
      (SELECT count(*)::text FROM pg_constraint k
        WHERE k.conrelid = 'public.rsvp_responses'::regclass
          AND k.contype = 'c'
          AND position('answers' IN pg_get_constraintdef(k.oid)) > 0)],
    ARRAY['1', 'true', 'true', '1']::text[]);

  PERFORM pg_temp.s8b_send(NULL);
END $S$;

-- --------------------------------------------------------------------------- P: a revision the families follow
-- Ruling 8.1 (`docs/architecture/guest-rsvp-security.md:539-551`) re-declared
-- `publish_invitation_version` for one reason: the Stage 3 retarget touched only
-- `token_kind = 'public_invitation'`, so a host publishing a corrected version would have stranded every
-- household link on the publication the same call had just revoked — each family's saved URL answering
-- `available: false` while the wedding's own link kept working. The added statement is
-- `20261009120000_stage8_guest_invitations_rsvp.sql:1041-1048`, and it is one `UPDATE` with three
-- assignments and two `WHERE` filters. This group tests exactly that shape and nothing looser: which rows
-- move, which rows may not, which columns may not, and what a family actually sees afterwards.
--
-- The instrument is a per-row snapshot taken before the publish (`s8p`), because the honest form of every
-- claim here is a diff. A count of live rows would be satisfied by a re-mint (same count, new secrets)
-- and the ruling chose *retargeting* over re-minting for the reason Stage 3 argued in the same function
-- (`:1034-1040`): a family that has the URL in its messages must keep being able to use it. Only a
-- row-keyed comparison can tell "the pointer moved" from "the credential was replaced", and
-- `token_hash` is one of the columns compared.
--
-- Two hazards recorded rather than argued away. The first: `p_expires_at` is NULL in every publish below,
-- so the statement's `COALESCE(p_expires_at, expires_at)` leaves each deadline alone — and that is the
-- claim worth measuring, because a publish that re-armed an expired family's deadline would be a
-- quiet relaxation dressed as a revision. The second: `wedding_events.enabled` and the RSVP rows are read
-- by the door, so the card list is compared against the *tables* (group E's idiom,
-- `:911-926`) rather than against group E's stale answer, which was taken before group A wrote answers
-- and before group N rotated a link.
CREATE TEMP TABLE s8p ON COMMIT DROP AS
SELECT t.id AS tid, t.publication_id AS pub, t.expires_at AS exp,
       t.expiry_policy AS pol, t.token_hash AS hash, t.revoked_at AS rev
  FROM private.access_tokens t
 WHERE t.wedding_id = (SELECT wed_a FROM s8c)
   AND t.token_kind = 'guest_invitation';

DO $P$
DECLARE s s8c%ROWTYPE; v jsonb; w jsonb; dto jsonb; n bigint;
        ver3 uuid; newpub uuid;
        total_then bigint; live_then bigint; expired_then bigint;
BEGIN
  SELECT * INTO s FROM s8c;
  total_then   := (SELECT count(*) FROM s8p);
  live_then    := (SELECT count(*) FROM s8p WHERE rev IS NULL);
  expired_then := (SELECT count(*) FROM s8p WHERE rev IS NULL
                     AND exp IS NOT NULL AND exp <= now());

  -- P1 the state the ruling was written against, measured at this instant rather than inherited from
  -- group X's summary: one active publication, every household credential of this wedding pinned to it,
  -- one live wedding-level link, at least one live household link (or the retarget below would be an
  -- assertion about an empty set), at least one live-but-expired row (group U3 aged one by hand at
  -- `:1245-1252`), the marker string present in no frozen version yet — which is what turns P7's
  -- "the guest can see it" into a change rather than a tautology — and the family whose door P7 opens
  -- having at least one enabled card, because P7's card comparison reads the tables on both sides and
  -- would be a set equality between two empty lists otherwise.
  PERFORM pg_temp.s8b_eq('P1 the preconditions Ruling 8.1 was written against, all seven measured: this '
    'wedding has one active publication, no household credential of it points anywhere else, one wedding-level '
    'link is live, at least one household link is live for the retarget to act on, at least one live row is '
    'already past its deadline, the new welcome line appears in no frozen snapshot, and the family P7 opens '
    'the door for has a non-empty enabled event scope',
    ARRAY[(SELECT count(*)::text FROM public.publications p
            WHERE p.wedding_id = s.wed_a AND p.status = 'active' AND p.id = s.pub1),
          (SELECT count(*)::text FROM s8p p WHERE p.pub IS DISTINCT FROM s.pub1),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'public_invitation'
              AND t.revoked_at IS NULL),
          (live_then > 0)::text,
          (expired_then > 0)::text,
          (SELECT count(*)::text FROM public.invitation_versions x
            WHERE x.wedding_id = s.wed_a
              AND x.snapshot::text LIKE '%' || current_setting('s8b.mk_draft3') || '%'),
          (SELECT (count(*) > 0)::text FROM public.household_event_scopes sc
            JOIN public.wedding_events e
              ON e.wedding_id = sc.wedding_id AND e.id = sc.event_id
            WHERE sc.household_id = s.hh_baby AND e.enabled)]::text[],
    ARRAY['1', '0', '1', 'true', 'true', '0', 'true']::text[]);

  -- The host's own edit path, twice over: the draft is written through client DML as the owner (the
  -- table keeps UPDATE and lost INSERT/DELETE at
  -- `20260926140000_stage3_close_draft_invariant.sql:113`, so this is the only shape the editor has), and
  -- the version is frozen by the published verb rather than by an INSERT this role could not make.
  n := pg_temp.s8b_host_write(current_setting('s8b.owner_a'),
    'UPDATE public.invitation_drafts SET content = jsonb_set(content, ''{welcome}'', '
    || 'to_jsonb(current_setting(''s8b.mk_draft3'')::text))'
    || ' WHERE wedding_id = ' || quote_literal(s.wed_a::text) || '::uuid');
  v := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.create_invitation_version(' || quote_literal(s.wed_a::text) || '::uuid)');
  ver3 := (v ->> 'version_id')::uuid;

  -- P2 the freeze: one new version, numbered three, carrying the new line in its own snapshot — and
  -- freezing is not publishing. Group X2 (`:442-452`) left version 2 unpublished on purpose so this
  -- claim could be made about a wedding whose active document is still version 1; if `create_invitation_
  -- version` moved the publication, the retarget below would be measuring the wrong event.
  PERFORM pg_temp.s8b_eq('P2 the host''s draft edit reached the one draft row it names, the freeze made it '
    'version 3 of this wedding with the new welcome line inside the frozen snapshot, and publishing has not '
    'happened yet — version 1 is still the document the active publication points at',
    ARRAY[n::text,
          (SELECT count(*)::text FROM public.invitation_versions x
            WHERE x.id = ver3 AND x.wedding_id = s.wed_a),
          (SELECT x.version_number::text FROM public.invitation_versions x WHERE x.id = ver3),
          (SELECT (x.snapshot::text LIKE '%' || current_setting('s8b.mk_draft3') || '%')::text
             FROM public.invitation_versions x WHERE x.id = ver3),
          (SELECT count(*)::text FROM public.publications p
            JOIN public.invitation_versions x ON x.id = p.version_id
           WHERE p.wedding_id = s.wed_a AND p.status = 'active'
             AND p.id = s.pub1 AND x.version_number = 1)]::text[],
    ARRAY['1', '1', '3', 'true', '1']::text[]);

  v := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.publish_invitation_version(' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(ver3::text) || '::uuid, NULL)');
  newpub := (v ->> 'publication_id')::uuid;

  -- P3 the publish answer and the publication history. `link_reused` is true and `path` is JSON-null
  -- because this wedding already held a live wedding-level link, so the revision did not hand out a new
  -- public secret either — the household retarget is one half of a single decision to keep existing URLs
  -- working rather than to re-issue them.
  PERFORM pg_temp.s8b_eq('P3 the publish made a new publication naming version 3, retired the old one with '
    'a real timestamp rather than a re-read NULL, left exactly one active publication on the wedding, and '
    'answered `link_reused: true` with a JSON-null `path` — no new wedding secret exists, so the only thing '
    'that moved for the families is the pointer',
    ARRAY[(v ->> 'link_reused'),
          jsonb_typeof(v -> 'path'),
          ((v ->> 'publication_id')::uuid IS NOT NULL
            AND (v ->> 'publication_id')::uuid <> s.pub1)::text,
          ((v ->> 'version_id')::uuid = ver3)::text,
          (SELECT p.status FROM public.publications p WHERE p.id = s.pub1),
          (SELECT jsonb_typeof(to_jsonb(p.revoked_at)) FROM public.publications p WHERE p.id = s.pub1),
          (SELECT count(*)::text FROM public.publications p
            JOIN public.invitation_versions x ON x.id = p.version_id
           WHERE p.wedding_id = s.wed_a AND p.status = 'active' AND x.version_number = 3)]::text[],
    ARRAY['true', 'null', 'true', 'true', 'revoked', 'string', '1']::text[]);

  -- P4 the retarget as a diff, in both directions. Every row that was live now names the publication the
  -- publish returned; every row the host had withdrawn still names the publication it was withdrawn from.
  -- The second half is the one that could have been written wrong in the tempting direction: a `WHERE`
  -- clause missing `revoked_at IS NULL` would have re-pinned a revoked family onto the live document, and
  -- a family whose link the host withdrew would be one HTTP request away from a page that says the
  -- withdrawal never happened.
  PERFORM pg_temp.s8b_eq('P4 Ruling 8.1''s first sentence, measured per row against the snapshot taken '
    'before the publish: no credential was added or lost, every live household link now names the new '
    'publication, no revoked household link moved off the publication it was revoked on, and another '
    'wedding''s household links were not swept in — the `WHERE wedding_id` filter is the statement''s own, '
    'and the composite FK that would also refuse it is `20261009120000...:74-83`',
    ARRAY[(SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'),
          (SELECT count(*)::text FROM s8p p JOIN private.access_tokens t ON t.id = p.tid
            WHERE p.rev IS NULL AND t.publication_id IS DISTINCT FROM newpub),
          (SELECT count(*)::text FROM s8p p JOIN private.access_tokens t ON t.id = p.tid
            WHERE p.rev IS NOT NULL AND t.publication_id IS DISTINCT FROM p.pub),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_b AND t.token_kind = 'guest_invitation'
              AND t.publication_id = newpub),
          live_then::text,
          total_then::text]::text[],
    ARRAY[total_then::text, '0', '0', '0',
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NULL AND t.publication_id = newpub),
          (SELECT count(*)::text FROM s8p)]::text[]);

  -- P5 the half only a row-keyed diff can see: *which columns* moved. Nothing but the pointer did —
  -- the deadline, the deadline policy, the stored digest and the revocation instant are each compared
  -- against the same row's own earlier value, so this asserts retargeting rather than re-minting, and it
  -- asserts that a revision did not silently re-arm the expired family U3 aged by hand.
  PERFORM pg_temp.s8b_eq('P5 the retarget moved one column and no other: for every household credential '
    'row of this wedding the stored `token_hash` is the same 64-hex digest it was, so the URL a family '
    'already has in its messages is still the URL that opens it, and no `expires_at`, `expiry_policy` or '
    '`revoked_at` value changed — which is also the proof that publishing with a NULL deadline did not '
    'extend anyone''s deadline as a side effect',
    ARRAY[(SELECT count(*)::text FROM s8p p JOIN private.access_tokens t ON t.id = p.tid
            WHERE t.token_hash IS DISTINCT FROM p.hash
               OR t.expires_at IS DISTINCT FROM p.exp
               OR t.expiry_policy IS DISTINCT FROM p.pol
               OR t.revoked_at IS DISTINCT FROM p.rev),
          (SELECT count(*)::text FROM s8p p JOIN private.access_tokens t ON t.id = p.tid
            WHERE p.rev IS NULL AND p.exp IS NOT NULL AND p.exp <= now()
              AND NOT (t.publication_id = newpub AND t.expires_at = p.exp)),
          expired_then::text]::text[],
    ARRAY['0', '0',
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NULL AND t.expires_at IS NOT NULL
              AND t.expires_at <= now())::text]::text[]);

  -- The new document, projected the way the door projects it (group D4's idiom at `:804-811`), and then
  -- the two doors.
  SELECT private.public_invitation_dto(x.snapshot_schema_version, x.snapshot) INTO dto
    FROM public.invitation_versions x WHERE x.id = ver3;
  w := pg_temp.s8b_door(current_setting('s8b.raw_baby'));

  -- P6 the invitation half is byte-for-byte version 3's projection — not version 1's, which is what a
  -- retarget that pointed at the wrong publication would have produced, and not a page assembled from
  -- live rows, which is what a door that ignored its credential's pinning would have produced.
  PERFORM pg_temp.s8b_eq('P6 the retargeted family''s page is the projection of version 3 and of nothing '
    'else: the answer''s `invitation` equals `private.public_invitation_dto` of the frozen snapshot the new '
    'publication names, and equals by that fact no live-row recomputation, which is D4''s claim one '
    'revision later',
    w -> 'invitation', dto);

  -- P7 the change from the guest's side, with the family's own identity and scope held constant. The
  -- welcome line is read at its own path rather than searched for in the whole answer, because the
  -- projection takes it from the *frozen* snapshot — `'welcome', private.dto_text(v_draft -> 'welcome')`
  -- at `20260927120000_stage4_tradition_pack_releases.sql:1382`, with
  -- `v_draft := p_snapshot -> 'draft'` at `:1205` — so this is a claim about the revision and not about
  -- whatever the draft row currently holds. The old line is compared as *distinct* rather than by its
  -- text, so nothing here depends on the wording battery 1 froze at
  -- `80_guest_invitation_links.sql:426`. The three identity
  -- names come from group E's snapshot table `s8d`, because the household, its display name and its
  -- salutation are properties of the family and must survive a revision untouched — while the card list is
  -- compared against the tables, for the reason given in this group's header, with the count paired
  -- alongside so a family whose cards all vanished would satisfy the set equality and not this one.
  PERFORM pg_temp.s8b_eq('P7 and a family with a saved link sees the corrected invitation without seeing a '
    'different wedding: the door opens, it reports version number 3, the welcome line at its own path is '
    'the new one and differs from the line this same family was shown before the revision, the household''s '
    'three identity names are the ones it was shown, and its card list is exactly its own enabled scope '
    'rows from the tables with a matching card count',
    ARRAY[(w ->> 'available'),
          (w -> 'guest' ->> 'version_number'),
          (w -> 'invitation' ->> 'welcome'),
          ((SELECT d.a -> 'invitation' ->> 'welcome' FROM s8d d WHERE d.who = 'baby')
             IS DISTINCT FROM (w -> 'invitation' ->> 'welcome'))::text,
          (SELECT count(*)::text FROM s8d d WHERE d.who = 'baby'
             AND d.a -> 'guest' ->> 'household_id' = w -> 'guest' ->> 'household_id'
             AND d.a -> 'guest' ->> 'display_name'  = w -> 'guest' ->> 'display_name'
             AND d.a -> 'guest' ->> 'greeting'      = w -> 'guest' ->> 'greeting'),
          ((SELECT pg_temp.s8b_arr(jsonb_agg(e.display_name))
              FROM public.household_event_scopes sc
              JOIN public.wedding_events e
                ON e.wedding_id = sc.wedding_id AND e.id = sc.event_id
             WHERE sc.household_id = s.hh_baby AND e.enabled)
           =
           (SELECT pg_temp.s8b_arr(jsonb_agg(q.c ->> 'display_name'))
              FROM jsonb_array_elements(w -> 'guest' -> 'events') q(c)))::text,
          (SELECT count(*)::text FROM jsonb_array_elements(w -> 'guest' -> 'events'))]::text[],
    ARRAY['true', '3', current_setting('s8b.mk_draft3'), 'true', '1', 'true',
          (SELECT count(*)::text FROM public.household_event_scopes sc
             JOIN public.wedding_events e
               ON e.wedding_id = sc.wedding_id AND e.id = sc.event_id
            WHERE sc.household_id = s.hh_baby AND e.enabled)]::text[]);

  -- P8 the two refusals that must survive the retarget, behaviourally rather than as a column reading: a
  -- withdrawn family whose row was *not* re-pinned, and an expired family whose row *was*. The second is
  -- the interesting one — it is the case where the pointer moved and the answer still has to be no, so
  -- the door's refusal is being made by the deadline and not by the pinning, and P5 already proved the
  -- deadline is the same instant it was.
  PERFORM pg_temp.s8b_eq('P8 a revision revives nobody: the withdrawn family and the expired family each '
    'still answer one name and `available: false`, one because its credential stayed on the revoked '
    'publication and the other although its credential followed the live one — and the sample is not '
    'vacuous, because P7 opened the live family''s door two assertions ago',
    ARRAY[pg_temp.s8b_top_keys(pg_temp.s8b_door(current_setting('s8b.raw_chenna')))::text,
          (pg_temp.s8b_door(current_setting('s8b.raw_chenna')) ->> 'available'),
          pg_temp.s8b_top_keys(pg_temp.s8b_door(current_setting('s8b.raw_raman')))::text,
          (pg_temp.s8b_door(current_setting('s8b.raw_raman')) ->> 'available')]::text[],
    ARRAY['{available}', 'false', '{available}', 'false']::text[]);

  -- Carried forward for group Q, which is written against the state this group leaves rather than
  -- against a number it would have to guess.
  PERFORM set_config('s8b.pub_now', newpub::text, false);
END $P$;

-- The same table again, taken after the publish and before the rotation, so P's second half can diff a
-- wedding-link rotation against the household rows it must not touch.
CREATE TEMP TABLE s8q ON COMMIT DROP AS
SELECT t.id AS tid, t.publication_id AS pub, t.expires_at AS exp,
       t.expiry_policy AS pol, t.token_hash AS hash, t.revoked_at AS rev
  FROM private.access_tokens t
 WHERE t.wedding_id = (SELECT wed_a FROM s8c)
   AND t.token_kind = 'guest_invitation';

-- --------------------------------------------------------------------------- Pb: rotating the wedding link
-- The second sentence of Ruling 8.1 is a prohibition about a verb Stage 8 did *not* re-declare:
-- `api.rotate_invitation_token` keeps its kind filter, "so rotating the wedding link cannot touch a
-- household's" (`docs/architecture/guest-rsvp-security.md:550-551`). The filter is
-- `20260926150000_stage3_privileged_bodies_behind_wrappers.sql:393-398` and the revoke is a single-row
-- `WHERE id = v_old.id` at `:407`, so the reading is unambiguous — but the ruling's whole point is that
-- two kinds of credential now share a table, a wedding and a publication, and a Stage 8 widening of
-- *publish* is one careless edit away from being copied into *rotate*. This half measures it after the
-- retarget, when the household rows are pinned to a publication the rotation also points at — the state
-- in which a missing kind filter would do the most damage.
DO $Pb$
DECLARE s s8c%ROWTYPE; v jsonb; act_pub uuid; ver3 uuid; raw_new text;
        old_hash text; w jsonb; x jsonb;
BEGIN
  SELECT * INTO s FROM s8c;
  -- Read from the tables, and independently of the publication row P answered with: `act_pub` is the
  -- wedding's one active publication and `ver3` is the version this wedding's third number belongs to.
  -- Deriving either of them from `v` two statements later would make the comparison below a restatement
  -- of the answer rather than a check of it — the rotation reads `v_live.id`/`v_live.version_id` out of
  -- that same publication row (`20260926150000...:386-387,413-414`), so an assertion that compared it to
  -- itself would pass whatever the function did.
  act_pub := (SELECT p.id FROM public.publications p
               WHERE p.wedding_id = s.wed_a AND p.status = 'active');
  ver3   := (SELECT x.id FROM public.invitation_versions x
              WHERE x.wedding_id = s.wed_a AND x.version_number = 3);
  old_hash := (SELECT t.token_hash FROM private.access_tokens t
                WHERE t.wedding_id = s.wed_a AND t.token_kind = 'public_invitation'
                  AND t.revoked_at IS NULL);

  v := pg_temp.s8b_auth(current_setting('s8b.owner_a'),
    'SELECT api.rotate_invitation_token(' || quote_literal(s.wed_a::text) || '::uuid)');
  raw_new := substr(v ->> 'path', 4);

  -- Pb1 the rotation did what Stage 3 said it does, and did it against the *new* publication. The first
  -- element is the link in the chain that makes the rest mean something: the publication P's answer named
  -- (held in `s8b.pub_now`, set at the end of group P) is the one row the table now reports as active, so
  -- "the rotation followed the revision" is a statement about a pointer the table agrees is live rather
  -- than about a value the function echoed.
  PERFORM pg_temp.s8b_eq('Pb1 the wedding-link rotation is real and follows the revision: the publication '
    'P published is the wedding''s only active row, the rotation names that same publication and version 3, '
    'a fresh 43-octet secret arrives in a `/i/` path, and the retired instant is reported rather than '
    'implied',
    ARRAY[(act_pub = current_setting('s8b.pub_now')::uuid)::text,
          ((v ->> 'publication_id')::uuid = act_pub)::text,
          ((v ->> 'version_id')::uuid = ver3)::text,
          octet_length(v ->> 'path')::text,
          jsonb_typeof(v -> 'previous_revoked_at'),
          (SELECT count(*)::text FROM public.publications p
            WHERE p.wedding_id = s.wed_a AND p.status = 'active')]::text[],
    ARRAY['true', 'true', 'true', '46', 'string', '1']::text[]);

  -- Pb2 the prohibition itself, as a diff over every household credential row of this wedding. Five
  -- columns compared, so a rotation that re-pinned, re-armed, re-minted or revoked a family's link would
  -- each show up as a number of moved rows rather than as a sentence in a comment.
  PERFORM pg_temp.s8b_eq('Pb2 and no household credential was touched by it: the same rows, with the same '
    'pointer to the live publication, the same digest, the same deadline and the same revocation state, '
    'before and after the wedding link was rotated — Ruling 8.1''s kind filter, measured as a zero-row '
    'diff over the columns a rotation could plausibly move',
    ARRAY[(SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'),
          (SELECT count(*)::text FROM s8q q JOIN private.access_tokens t ON t.id = q.tid
            WHERE t.publication_id IS DISTINCT FROM q.pub
               OR t.token_hash IS DISTINCT FROM q.hash
               OR t.expires_at IS DISTINCT FROM q.exp
               OR t.expiry_policy IS DISTINCT FROM q.pol
               OR t.revoked_at IS DISTINCT FROM q.rev),
          (SELECT count(*)::text FROM s8q q WHERE NOT EXISTS (
             SELECT 1 FROM private.access_tokens t WHERE t.id = q.tid))]::text[],
    ARRAY[(SELECT count(*)::text FROM s8q), '0', '0']::text[]);

  -- Pb3 the wedding side of the same boundary: the rotation retired exactly the link it replaced, which
  -- is the difference between a rotation and a second live secret, and it is read here by the digest
  -- captured before the call because a raw secret is legible only once and this file never held the
  -- wedding's.
  PERFORM pg_temp.s8b_eq('Pb3 the retired wedding link is retired: the digest this file read out of the '
    'table before the rotation now carries a revocation instant, and exactly one wedding-level credential '
    'of this wedding is live — so the household list and the wedding list both have one answerable secret '
    'and no orphan',
    ARRAY[((SELECT t.revoked_at IS NOT NULL FROM private.access_tokens t
            WHERE t.token_hash = old_hash))::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'public_invitation'
              AND t.revoked_at IS NULL)]::text[],
    ARRAY['true', '1']::text[]);

  -- Pb4 the claim this group's own helper was written for (`:290-294`): two kinds of credential, two
  -- documents, and a header mechanism that keeps them apart *after* the revision. The new wedding secret
  -- opens the wedding door and shows version 3 with the same welcome line the family sees; the family's
  -- secret at the wedding door is refused; and the family's door still opens, which is what makes the
  -- middle result a boundary rather than a broken header.
  w := pg_temp.s8b_public_door(raw_new);
  x := pg_temp.s8b_public_door(current_setting('s8b.raw_baby'));
  PERFORM pg_temp.s8b_eq('Pb4 the two doors keep two kinds of secret apart after the revision: the rotated '
    'wedding link opens the wedding door and its own `welcome` carries the corrected line, the household '
    'link is refused at the wedding door with no invitation half at all, and the household link still '
    'opens its own page — so the middle refusal is kind separation, not a door that stopped working',
    ARRAY[(w ->> 'available'),
          (w -> 'invitation' ->> 'welcome'),
          (x ->> 'available'),
          (x ? 'invitation')::text,
          (pg_temp.s8b_door(current_setting('s8b.raw_baby')) ->> 'available')]::text[],
    ARRAY['true', current_setting('s8b.mk_draft3'), 'false', 'false', 'true']::text[]);

  PERFORM pg_temp.s8b_send(NULL);
END $Pb$;

-- --------------------------------------------------------------------------- Q: the takedown, and what a republish does not undo
-- Ruling 8.1's other half, read off the migration rather than paraphrased. The verb is
-- `api.revoke_invitation_publication`, re-declared by Stage 8 so that withdrawing the *document* also
-- withdraws every *link* to it: the revoke is
-- `20261009120000_stage8_guest_invitations_rsvp.sql:1087-1090`, its kind list is
-- `token_kind IN ('public_invitation','guest_invitation')` at `:1089`, and the only other filter is
-- `revoked_at IS NULL` at `:1090`. Group P measured the publish half of the ruling; this group measures
-- the four things the takedown has to get right at once, none of which is "the call returns true":
--
--   1. both kinds go, and exactly the rows that were live go — `tokens_revoked` is the count the UPDATE
--      itself reported (`:1091`), so it is checked against a snapshot taken before the call rather than
--      against the answer;
--   2. nothing else of the household goes with them: the family row, its event scopes, the answers it
--      already gave and the host's panel over all of that are compared as a diff over the same rows;
--   3. the refusal afterwards is *one* answer for every family, in the same bytes group U measured for
--      links that were never credentials, so a withdrawn link cannot be told from a forgery by whoever is
--      holding it;
--   4. the decision is final — publishing a corrected version afterwards must not re-open a withdrawn
--      link, which is the half of the roster's sentence that only the retarget's own
--      `revoked_at IS NULL` (`:1048`) enforces, and which group Qb measures by republishing.
--
-- Two instruments make 1 and 4 measurable rather than arguable. The first is a credential of the third,
-- deliberately unused household kind (`rsvp`, Ruling 2.2's gap, pinned as a CHECK arm at `:87-90`) planted
-- beside the Baby family's real link. The takedown's kind list does not name it, so its survival is the
-- evidence that the list is a list rather than a "not guest_invitation" predicate — and its invisibility at
-- both doors and the host's panel is the evidence that those readers' own `token_kind` arms
-- (`:604`, `:854`, and the state function's LATERAL at `:531`) are what refuse a stranger. The row is
-- deleted again at the end of this group so that group Z's census counts only credentials the product
-- minted, which is the discipline battery 1 applies to its own probe row for the same reason.
--
-- The second instrument is `s8t`: the two kinds' rows for this wedding, keyed by the credential. Every
-- claim about what moved is a diff against it, and every total in it is read from the table rather than
-- written here, because this wedding's credential population is inherited from battery 1's groups as well
-- as this file's. The same applies to the households, scopes and answers: `hh_then`, `sc_then`,
-- `ans_then` and the publication total are measured at the top of the group and re-measured after, so an
-- "in place" claim is a pair of equal numbers this file did not have to guess.
--
-- One limit, restated because an assertion below leans on it: `now()` is the transaction instant here, so
-- `revoked_at = now()` is a claim that the field *moved* (NULL → set), not a claim about ordering; the
-- file's head gives the reason at group N.
--
-- Finally, and for the reason this file's own head gives (`:62-63`), the referential machinery that makes
-- withdrawal the only user-facing way to close a family's link is measured as `postgres`. Group QF's three
-- probes are not a host's verb and do not claim to be: they ask the schema whether a credential can be
-- removed by deleting its publication, removed by deleting the household, or pointed at a publication that
-- does not exist, and all three answers are the table's own foreign keys.
CREATE FUNCTION pg_temp.s8b_panel_facts(p jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  -- The host's panel with its link columns taken out. The claim this shape exists for is "the takedown
  -- moved the link and nothing else", and the only fields a takedown may move are `link_state`,
  -- `link_expires_at` and `link_last_used_at` — so the seven that remain are what gets digested, and the
  -- three that are dropped are asserted separately, as their own vocabulary. Ordered by the panel's own
  -- key so the comparison is about content and not about aggregation.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'household_id',        e ->> 'household_id',
           'display_name',        e ->> 'display_name',
           'salutation',          e ->> 'salutation',
           'expected_party_size', e ->> 'expected_party_size',
           'scoped_event_count',  e ->> 'scoped_event_count',
           'reply_count',         e ->> 'reply_count',
           'attending_count',     e ->> 'attending_count'
         ) ORDER BY e ->> 'display_name', e ->> 'household_id'), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(p, '[]'::jsonb)) q(e) $fn$;

-- Both credential kinds of the tested wedding, taken before the takedown. The wedding's own link is in
-- here on purpose: the ruling's sentence is about *both* kinds, and a snapshot of one kind could not
-- measure a count that includes the other.
CREATE TEMP TABLE s8t ON COMMIT DROP AS
SELECT t.id AS tid, t.household_id AS hh, t.token_kind AS kind,
       t.publication_id AS pub, t.expires_at AS exp, t.expiry_policy AS pol,
       t.token_hash AS hash, t.revoked_at AS rev
  FROM private.access_tokens t
 WHERE t.wedding_id = (SELECT wed_a FROM s8c)
   AND t.token_kind IN ('public_invitation', 'guest_invitation');

DO $Q$
DECLARE s s8c%ROWTYPE; v jsonb; w jsonb; pd jsonb; st jsonb; st2 jsonb;
        act uuid; pub_now uuid; ctl_raw text; ctl_hash text; q_ctl uuid;
        t_total bigint; live_both bigint; live_guest bigint; live_pub bigint;
        wb_total bigint; wb_live bigint; wb_ans bigint; ctl_rows bigint;
        hh_then bigint; sc_then bigint; ans_then bigint; att_then bigint;
        guest_then bigint; manual_then bigint;
        pub_total_then bigint; mid jsonb; cur jsonb; n bigint;
        res jsonb[] := '{}'::jsonb[]; ans jsonb[] := '{}'::jsonb[];
BEGIN
  SELECT * INTO s FROM s8c;
  pub_now        := current_setting('s8b.pub_now')::uuid;
  act            := (SELECT p.id FROM public.publications p
                      WHERE p.wedding_id = s.wed_a AND p.status = 'active');
  t_total        := (SELECT count(*) FROM s8t);
  live_guest     := (SELECT count(*) FROM s8t WHERE rev IS NULL AND kind = 'guest_invitation');
  live_pub       := (SELECT count(*) FROM s8t WHERE rev IS NULL AND kind = 'public_invitation');
  live_both      := live_guest + live_pub;
  wb_total       := (SELECT count(*) FROM private.access_tokens t WHERE t.wedding_id = s.wed_b);
  wb_live        := (SELECT count(*) FROM private.access_tokens t
                      WHERE t.wedding_id = s.wed_b AND t.revoked_at IS NULL);
  wb_ans         := (SELECT count(*) FROM public.rsvp_responses r WHERE r.wedding_id = s.wed_b);
  ctl_rows       := (SELECT count(*) FROM private.access_tokens t WHERE t.token_kind = 'rsvp');
  hh_then        := (SELECT count(*) FROM public.guest_households h WHERE h.wedding_id = s.wed_a);
  sc_then        := (SELECT count(*) FROM public.household_event_scopes q
                      JOIN public.guest_households h ON h.id = q.household_id
                     WHERE q.wedding_id = s.wed_a);
  ans_then       := (SELECT count(*) FROM public.rsvp_responses r WHERE r.wedding_id = s.wed_a);
  guest_then     := (SELECT count(*) FROM public.rsvp_responses r
                      WHERE r.wedding_id = s.wed_a AND r.response_source = 'guest');
  manual_then    := (SELECT count(*) FROM public.rsvp_responses r
                      WHERE r.wedding_id = s.wed_a AND r.response_source = 'host_manual');
  att_then       := (SELECT count(*) FROM public.rsvp_responses r
                      WHERE r.wedding_id = s.wed_a AND r.attending = 'attending');
  pub_total_then := (SELECT count(*) FROM public.publications p WHERE p.wedding_id = s.wed_a);

  st := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');

  -- Q1 the state the ruling is written against, all of it read from the tables at this instant: the
  -- publication the previous group named is the wedding's one active row, every live credential of either
  -- kind points at it, exactly one wedding-level link is live (the successor Pb minted), at least one
  -- household link is live for the takedown to act on, no `rsvp` row exists yet anywhere, the version-4
  -- marker is in no frozen snapshot (which is what turns Qb1 into a change), and the family Qb6 opens for
  -- has cards — or its card comparison would be an equality between two empty lists.
  PERFORM pg_temp.s8b_eq('Q1 the preconditions, eight of them measured: the publication group P published '
    'is this wedding''s only active row and the only thing live credentials point at, one wedding-level link '
    'and at least one household link are live, the third household kind has no rows in the store at all, the '
    'welcome line Qb freezes has not been frozen yet, and the family whose page Qb6 reads has a non-empty '
    'enabled scope',
    ARRAY[((act = pub_now))::text,
          (SELECT count(*)::text FROM public.publications p
            WHERE p.wedding_id = s.wed_a AND p.status = 'active'),
          (SELECT count(*)::text FROM s8t q WHERE q.rev IS NULL AND q.pub IS DISTINCT FROM act),
          live_pub::text,
          (live_guest > 0)::text,
          ctl_rows::text,
          (SELECT count(*)::text FROM public.invitation_versions x
            WHERE x.wedding_id = s.wed_a
              AND x.snapshot::text LIKE '%' || current_setting('s8b.mk_draft4') || '%'),
          (SELECT (count(*) > 0)::text FROM public.household_event_scopes sc
            JOIN public.wedding_events e
              ON e.wedding_id = sc.wedding_id AND e.id = sc.event_id
            WHERE sc.household_id = s.hh_baby AND e.enabled)]::text[],
    ARRAY['true', '1', '0', '1', 'true', '0', '0', 'true']::text[]);

  -- Q1b the panel before the takedown, as the host''s own read, with the two cross-instrument arms that
  -- make it more than a reading of the same table twice: the panel''s non-revoked count has to equal the
  -- snapshot''s unrevoked rows, its per-household scope counts have to sum to the scope table, and its
  -- reply counts have to sum to the answer table. Six households, one withdrawn, one expired-by-deadline
  -- and four live is the state U left behind, and `never_issued` appears nowhere because every family of
  -- this wedding received a link at some point in this file.
  PERFORM pg_temp.s8b_eq('Q1b the host''s panel at the moment of the takedown: six households, one '
    '`revoked`, one `expired`, four `live` and no other word; six distinct families; and three sums that tie '
    'the panel to the tables underneath it — the non-revoked rows equal the snapshot''s unrevoked count, the '
    'scoped-event counts equal the scope table''s rows for this wedding, and the reply counts equal its '
    'answer rows and its attending answers',
    ARRAY[(SELECT count(*)::text FROM jsonb_array_elements(st)),
          (SELECT count(*)::text FROM jsonb_array_elements(st) e
            WHERE e ->> 'link_state' = 'revoked'),
          (SELECT count(*)::text FROM jsonb_array_elements(st) e
            WHERE e ->> 'link_state' = 'expired'),
          (SELECT count(*)::text FROM jsonb_array_elements(st) e
            WHERE e ->> 'link_state' = 'live'),
          (SELECT count(*)::text FROM jsonb_array_elements(st) e
            WHERE e ->> 'link_state' NOT IN ('revoked','expired','live')),
          (SELECT count(DISTINCT e ->> 'household_id')::text FROM jsonb_array_elements(st) e),
          ((SELECT count(*)::text FROM jsonb_array_elements(st) e
              WHERE e ->> 'link_state' <> 'revoked')
            = (SELECT count(*)::text FROM s8t q WHERE q.rev IS NULL AND q.kind = 'guest_invitation'))::text,
          (coalesce((SELECT sum((e ->> 'scoped_event_count')::int)
                       FROM jsonb_array_elements(st) e), 0) = sc_then)::text,
          (coalesce((SELECT sum((e ->> 'reply_count')::int)
                       FROM jsonb_array_elements(st) e), 0) = ans_then)::text,
          (coalesce((SELECT sum((e ->> 'attending_count')::int)
                       FROM jsonb_array_elements(st) e), 0) = att_then)::text]::text[],
    ARRAY['6', '1', '1', '4', '0', '6', 'true', 'true', 'true', 'true']::text[]);

  -- Q2 the third kind, planted. Written by this file rather than minted by a verb precisely because no
  -- verb mints it: `guest-rsvp-security.md` §3 leaves `rsvp` as unused vocabulary, Ruling 2.2 says so, and
  -- the schema nevertheless pins its shape (`:87-90`), so the only way to test that the product''s two
  -- readers and the takedown all honour their own kind filters is to put a row of that kind where a bug
  -- would find it. The shape is the legal one: household-scoped, pinned to the live publication, with no
  -- deadline. The raw is 43 octets of the declared alphabet so the doors'' own header gates
  -- (`:586`, `:841`) let it through to the query, where the kind arm is what refuses it — otherwise this
  -- would be measuring a length check and not a policy.
  ctl_raw  := 's8-q-third-kind-control-' || repeat('z', 19);
  ctl_hash := encode(extensions.digest(convert_to(ctl_raw, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, publication_id,
                                     household_id, expiry_policy)
  VALUES (ctl_hash, 'rsvp', s.wed_a, pub_now, s.hh_baby, 'no_expiry')
  RETURNING id INTO q_ctl;
  GET DIAGNOSTICS n = ROW_COUNT;

  PERFORM pg_temp.s8b_eq('Q2 one row of the unused kind exists beside a real family''s link: one row '
    'written, one such row in the store where there were ' || ctl_rows || ', the pointer and the family are '
    'the live publication and the Baby household, the writer is the role this battery runs as rather than a '
    'client role, the secret is 43 octets of the declared alphabet, neither of the two kinds the ruling '
    'names gained a row, and the family still holds exactly one live household credential — which is the '
    'partial unique index''s own promise (`one_live_guest_token_per_household`, `:103-107`) surviving a '
    'second live row of a different kind',
    ARRAY[n::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.token_kind = 'rsvp'),
          (SELECT (t.publication_id = pub_now AND t.household_id = s.hh_baby
                   AND t.expiry_policy = 'no_expiry' AND t.expires_at IS NULL
                   AND t.revoked_at IS NULL)::text
             FROM private.access_tokens t WHERE t.id = q_ctl),
          (SELECT t.created_by_role::text FROM private.access_tokens t WHERE t.id = q_ctl),
          octet_length(ctl_raw)::text,
          (ctl_raw ~ '^[A-Za-z0-9_-]+$')::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a
              AND t.token_kind IN ('public_invitation','guest_invitation')),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_baby AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NULL)]::text[],
    ARRAY['1', (ctl_rows + 1)::text, 'true', 'postgres', '43', 'true',
          t_total::text, '1']::text[]);

  -- Q2b the row that exists is a row no guest and no host screen can reach. Three refusals and one
  -- silence: the household door, the wedding door and the answer door all answer with their generic no,
  -- and the host''s panel — which is the reader most likely to be written against the household column
  -- rather than the kind column — does not change by so much as a digit. The answer door is sent a *valid*
  -- body for the family''s own enabled event, because an invalid body would refuse for the body''s reason
  -- and prove nothing; if a future submit dropped its kind arm, that body would move the Baby family''s
  -- recorded party from two to one, and the value is therefore re-read here rather than trusted.
  w  := pg_temp.s8b_door(ctl_raw);
  pd := pg_temp.s8b_public_door(ctl_raw);
  v  := pg_temp.s8b_answer(ctl_raw, jsonb_build_object('events', jsonb_build_array(
          jsonb_build_object('event_id', current_setting('s8b.ev_muurtham'),
                             'attending', 'attending', 'party_size', 1))));
  st2 := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');

  PERFORM pg_temp.s8b_eq('Q2b a live row of a kind no verb mints opens nothing: one name and '
    '`available: false` at the household door, the same at the wedding door, `unavailable` from the answer '
    'door with a body that is legal for this family, the Baby family''s own answer still `attending` with '
    'party two and the wedding''s answer count unmoved, and the host''s panel byte-for-byte the same seven '
    'facts per family with still six rows — so the three readers and the panel are each being driven by '
    'their own `token_kind` arm and not by the household column they also filter on',
    ARRAY[pg_temp.s8b_top_keys(w)::text, (w ->> 'available'),
          pg_temp.s8b_top_keys(pd)::text, (pd ->> 'available'),
          pg_temp.s8b_top_keys(v)::text,
          pg_temp.s8b_pairs(v)::text,
          (SELECT (r.attending || '|' || r.party_size)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_baby AND r.event_id = s.ev_muurtham),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.wedding_id = s.wed_a),
          (pg_temp.s8b_panel_facts(st) = pg_temp.s8b_panel_facts(st2))::text,
          (SELECT count(*)::text FROM jsonb_array_elements(st2))]::text[],
    ARRAY['{available}', 'false', '{available}', 'false', '{reason,recorded}',
          '{reason=unavailable,recorded=false}', 'attending|2', ans_then::text,
          'true', '6']::text[]);

  -- Q3 the takedown itself. `tokens_revoked` is the number the UPDATE reported, so the honest test is
  -- whether it equals the rows this file counted as live *before* the call — and whether it is strictly
  -- more than the household count, which is the only arm here that can see the wedding''s own link being
  -- withdrawn in the same statement. The unused kind is not in that number, and does not become revoked.
  v := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.revoke_invitation_publication(' || quote_literal(s.wed_a::text) || '::uuid)');

  PERFORM pg_temp.s8b_eq('Q3 the withdrawal takes both kinds in one statement and nothing else: three '
    'names in the answer, `revoked` true, the publication named is the one P published, and the count the '
    'UPDATE reported is exactly the live rows of the two kinds this file counted before the call — strictly '
    'more than the household rows alone, because the wedding''s own live link is in it — and after the call '
    'neither kind has a single unrevoked row left for this wedding, while the third kind is still live '
    'because the kind list never named it',
    ARRAY[pg_temp.s8b_top_keys(v)::text,
          (v ->> 'revoked'),
          ((v ->> 'publication_id')::uuid = pub_now)::text,
          (v ->> 'tokens_revoked'),
          ((v ->> 'tokens_revoked')::int = live_both)::text,
          ((v ->> 'tokens_revoked')::int > live_guest)::text,
          live_pub::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a
              AND t.token_kind IN ('public_invitation','guest_invitation')
              AND t.revoked_at IS NULL),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.token_kind = 'rsvp' AND t.revoked_at IS NULL)]::text[],
    ARRAY['{publication_id,revoked,tokens_revoked}', 'true', 'true',
          live_both::text, 'true', 'true', '1', '0', (ctl_rows + 1)::text]::text[]);

  -- Q3b the document half of the same call. The publication stops being live whether or not there were
  -- credentials to revoke — the body tests a captured boolean for exactly that reason (`:1094-1099`) — and
  -- "stops being live" here is a status change plus a written instant, not a deletion: the history the
  -- host''s screen reads has to survive its own takedown, which is why the publication count for the
  -- wedding is asserted unmoved and the earlier publication is still sitting revoked.
  PERFORM pg_temp.s8b_eq('Q3b and the publication itself is withdrawn rather than erased: it reads '
    '`revoked` with a real instant written by the call, no active publication is left, it still names a '
    'version of this wedding, the publication group P retired is still retired, and the wedding''s total '
    'publication count is exactly what it was — a takedown ends a document''s life and does not remove its '
    'history',
    ARRAY[(SELECT p.status FROM public.publications p WHERE p.id = pub_now),
          (SELECT (p.revoked_at = now())::text FROM public.publications p WHERE p.id = pub_now),
          (SELECT count(*)::text FROM public.publications p
            WHERE p.wedding_id = s.wed_a AND p.status = 'active'),
          (SELECT count(*)::text FROM public.publications p
            JOIN public.invitation_versions x ON x.id = p.version_id
           WHERE p.id = pub_now AND x.wedding_id = s.wed_a),
          (SELECT p.status FROM public.publications p WHERE p.id = s.pub1),
          (SELECT count(*)::text FROM public.publications p
            WHERE p.wedding_id = s.wed_a)]::text[],
    ARRAY['revoked', 'true', '0', '1', 'revoked', pub_total_then::text]::text[]);

  -- Q4 the credential diff, both directions and both halves of the sentence "nothing else moved". The
  -- first arm counts rows whose revocation *state* changed and must equal the live count exactly — a
  -- takedown that also re-revoked an already-revoked row, or missed one, shows up here as a different
  -- number rather than as a comment. The second arm compares the four columns a withdrawal has no
  -- business touching, on the same rows, so a re-pin, a re-arm, a re-mint or a deletion each becomes a
  -- count. The third is the wedding boundary: nothing on the other wedding moved, because the statement is
  -- keyed by `wedding_id` and not by the caller''s household list.
  PERFORM pg_temp.s8b_eq('Q4 measured per credential row against the snapshot: exactly the live rows '
    'changed, and only in the one column — no digest, deadline, deadline policy or publication pointer moved, '
    'no row vanished and none was added, the family that had already been withdrawn is in the same state it '
    'was, and the other wedding''s credentials are untouched in both total and live count',
    ARRAY[(SELECT count(*)::text FROM s8t q JOIN private.access_tokens t ON t.id = q.tid
            WHERE (q.rev IS NULL) <> (t.revoked_at IS NULL)),
          (SELECT count(*)::text FROM s8t q JOIN private.access_tokens t ON t.id = q.tid
            WHERE t.publication_id IS DISTINCT FROM q.pub
               OR t.token_hash IS DISTINCT FROM q.hash
               OR t.expires_at IS DISTINCT FROM q.exp
               OR t.expiry_policy IS DISTINCT FROM q.pol),
          (SELECT count(*)::text FROM s8t q WHERE NOT EXISTS (
             SELECT 1 FROM private.access_tokens t WHERE t.id = q.tid)),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a
              AND t.token_kind IN ('public_invitation','guest_invitation')),
          (SELECT count(*)::text FROM s8t q JOIN private.access_tokens t ON t.id = q.tid
            WHERE q.kind = 'guest_invitation' AND q.rev IS NOT NULL
              AND t.revoked_at IS DISTINCT FROM q.rev),
          (SELECT count(*)::text FROM private.access_tokens t WHERE t.wedding_id = s.wed_b),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_b AND t.revoked_at IS NULL)]::text[],
    ARRAY[live_both::text, '0', '0', t_total::text, '0', wb_total::text, wb_live::text]::text[]);

  -- Q4b the household half of the ruling''s sentence — "the household row and its answers stay" — read as
  -- the same numbers this group started with, plus the specific answers the fixture is known to hold. A
  -- count alone would be satisfied by a takedown that deleted a family''s rows and inserted different
  -- ones; the value pairs below are what make it the same rows. The stranger''s answer on the other
  -- wedding is in the comparison because a withdrawal that reached across weddings would be the most
  -- expensive possible version of this bug.
  PERFORM pg_temp.s8b_eq('Q4b nothing of the household itself went with the link: six families, the '
    'scope rows they had, the answer rows they had and the attending ones among them, the other wedding''s '
    'answer row, the withdrawn family''s two answers still declined-with-nobody and attending-with-four, the '
    'Baby family''s two answers still attending-with-two, and the two source labels each holding exactly the '
    'rows they held when this group opened — the guest''s own answers and the host''s records measured '
    'separately, because the fixture''s answers are a mix of the two and a claim about one label alone '
    'would either be false or say nothing about the other',
    ARRAY[(SELECT count(*)::text FROM public.guest_households h
            WHERE h.wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.household_event_scopes q
            JOIN public.guest_households h ON h.id = q.household_id
           WHERE q.wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.rsvp_responses r WHERE r.wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.wedding_id = s.wed_a AND r.attending = 'attending'),
          (SELECT count(*)::text FROM public.rsvp_responses r WHERE r.wedding_id = s.wed_b),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_chenna AND r.attending = 'declined' AND r.party_size = 0),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_chenna AND r.attending = 'attending' AND r.party_size = 4),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_baby AND r.attending = 'attending' AND r.party_size = 2),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.wedding_id = s.wed_a AND r.response_source = 'guest'),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.wedding_id = s.wed_a AND r.response_source = 'host_manual'),
          ((guest_then + manual_then = ans_then))::text]::text[],
    ARRAY[hh_then::text, sc_then::text, ans_then::text, att_then::text, wb_ans::text,
          '1', '1', '2', guest_then::text, manual_then::text, 'true']::text[]);

  -- Q4c the host''s panel afterwards, in the two forms the ruling asks for. The link vocabulary has to
  -- have changed — six families all now `revoked`, which is what a takedown looks like from the host''s
  -- screen — and everything that is not about the link has to be *identical*, digest included. The expired
  -- family is the interesting row: its link was past its deadline and unrevoked, the withdrawal wrote a
  -- revocation onto it, and the state function tests revocation first (`:510-513`), so the panel now says
  -- `revoked` rather than `expired`. That is the schema agreeing with itself about which fact is more
  -- informative for a host, and it is measured here rather than assumed.
  st2 := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.get_guest_invitation_state(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM pg_temp.s8b_eq('Q4c the panel tells the truth about the takedown and nothing else changed: all '
    'six families now read `revoked`, no other word survives, and the seven non-link facts per family — '
    'name, salutation, expected party, scope count, reply count and attending count among them — digest to '
    'exactly what they were before the call, with the reply counts still summing to the wedding''s answer '
    'rows',
    ARRAY[(SELECT count(*)::text FROM jsonb_array_elements(st2) e
            WHERE e ->> 'link_state' = 'revoked'),
          (SELECT count(*)::text FROM jsonb_array_elements(st2) e
            WHERE e ->> 'link_state' NOT IN ('revoked')),
          (SELECT count(*)::text FROM jsonb_array_elements(st2) e
            WHERE e ->> 'link_state' = 'expired'),
          (SELECT count(*)::text FROM jsonb_array_elements(st2) e
            WHERE e ->> 'link_state' = 'live'),
          (pg_temp.s8b_panel_facts(st) = pg_temp.s8b_panel_facts(st2))::text,
          (coalesce((SELECT sum((e ->> 'reply_count')::int)
                       FROM jsonb_array_elements(st2) e), 0) = ans_then)::text,
          (SELECT count(*)::text FROM jsonb_array_elements(st2))]::text[],
    ARRAY['6', '0', '0', '0', 'true', 'true', '6']::text[]);

  -- Q5 the guest''s side of the same decision, in the form U established: not twelve assertions that each
  -- link now fails, but one assertion that the failures are indistinguishable. Six secrets that opened
  -- doors an hour ago of this file are collected, each refused, and the set is compared. The two controls
  -- are what make it a policy rather than a broken door — a live link of the *other* wedding still opens
  -- its household page, and the other wedding''s own secret still opens the wedding page — and they are
  -- also the cross-wedding boundary, drawn behaviourally rather than as a column reading.
  res := res || pg_temp.s8b_door(current_setting('s8b.raw_baby'));
  res := res || pg_temp.s8b_door(current_setting('s8b.raw_pillai'));
  res := res || pg_temp.s8b_door(current_setting('s8b.raw_nair2'));
  res := res || pg_temp.s8b_door(current_setting('s8b.raw_idaveli2'));
  res := res || pg_temp.s8b_door(current_setting('s8b.raw_raman'));
  res := res || pg_temp.s8b_door(ctl_raw);

  PERFORM pg_temp.s8b_eq('Q5 a takedown is one answer, in the same bytes as every other no: the four '
    'links that were live when the host withdrew the invitation, the family whose link was already past its '
    'deadline, and the row of the kind no verb mints all render to exactly one distinct text, that text is '
    '`{"available": false}`, and no refusal carries a second name — so nobody holding any of them can tell '
    'that the wedding was taken down rather than that their own link was never real',
    ARRAY[cardinality(res)::text,
          (SELECT count(DISTINCT x::text)::text FROM unnest(res) u(x)),
          (SELECT min(x::text) FROM unnest(res) u(x)),
          (SELECT bool_and(pg_temp.s8b_top_keys(x) = ARRAY['available']::text[])
             FROM unnest(res) u(x))::text]::text[],
    ARRAY['6', '1', '{"available": false}', 'true']::text[]);

  PERFORM pg_temp.s8b_eq('Q5b and the doors still work: a household credential of the other wedding '
    'opens its own page, that wedding''s own secret opens the wedding page, and neither is affected by a '
    'takedown of this one — which is what makes Q5''s six identical no''s a decision about this wedding''s '
    'links rather than a door that stopped answering',
    ARRAY[(pg_temp.s8b_door(current_setting('s8b.raw_stranger')) ->> 'available'),
          (pg_temp.s8b_public_door(current_setting('s8b.raw_wedb_pub')) ->> 'available'),
          jsonb_typeof(pg_temp.s8b_door(current_setting('s8b.raw_stranger')) -> 'guest'),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NULL)]::text[],
    ARRAY['true', 'true', 'object', '0']::text[]);

  -- Q6 the second takedown, which is the one a host''s screen will accidentally send twice. The answer is
  -- `false` with a JSON-null publication and a count of zero, and the state of the store does not change
  -- by one column on one row. The instrument is a map of every credential row to its revocation instant,
  -- taken here and compared after: an idempotent call and a call that re-wrote `revoked_at` to a fresh
  -- instant would be indistinguishable by any assertion about the *answer*, since `now()` is the same
  -- transaction instant throughout, and a host''s audit of when a link died should not depend on how many
  -- times the button was pressed.
  mid := (SELECT coalesce(jsonb_object_agg(t.id::text, coalesce(t.revoked_at::text, 'N')), '{}'::jsonb)
             FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a
              AND t.token_kind IN ('public_invitation','guest_invitation'));

  v := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.revoke_invitation_publication(' || quote_literal(s.wed_a::text) || '::uuid)');

  cur := (SELECT coalesce(jsonb_object_agg(t.id::text, coalesce(t.revoked_at::text, 'N')), '{}'::jsonb)
             FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a
              AND t.token_kind IN ('public_invitation','guest_invitation'));

  PERFORM pg_temp.s8b_eq('Q6 withdrawing twice says so instead of pretending: the second call answers '
    '`revoked: false`, names no publication (`null`, not a missing name and not the stale id), reports zero '
    'tokens, still leaves no live credential of either kind, the third kind is still live, and every '
    'credential row of this wedding carries exactly the revocation instant the first call wrote — an '
    'idempotent verb measured as an unmoved map rather than as a second true',
    ARRAY[pg_temp.s8b_top_keys(v)::text,
          (v ->> 'revoked'),
          jsonb_typeof(v -> 'publication_id'),
          (v ->> 'tokens_revoked'),
          (mid = cur)::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a
              AND t.token_kind IN ('public_invitation','guest_invitation')
              AND t.revoked_at IS NULL),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.token_kind = 'rsvp' AND t.revoked_at IS NULL),
          (SELECT count(*)::text FROM public.publications p
            WHERE p.wedding_id = s.wed_a AND p.status = 'active')]::text[],
    ARRAY['{publication_id,revoked,tokens_revoked}', 'false', 'null', '0',
          'true', '0', (ctl_rows + 1)::text, '0']::text[]);

  -- Q7 the write door after the withdrawal, in the same three forms: the family''s own revoked secret,
  -- the unused kind''s secret, and a well-formed string that was never anybody''s. All three answer the
  -- body-door''s generic no — the one that carries a `reason` because a family at a form is entitled to a
  -- page-level answer, and never a hint about *why* access failed — and the storm writes nothing: the
  -- wedding''s answer count is the number this group started with.
  ans := ans || pg_temp.s8b_answer(current_setting('s8b.raw_baby'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', current_setting('s8b.ev_muurtham'),
      'attending', 'attending', 'party_size', 1))));
  ans := ans || pg_temp.s8b_answer(ctl_raw,
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', current_setting('s8b.ev_muurtham'),
      'attending', 'attending', 'party_size', 1))));
  ans := ans || pg_temp.s8b_answer(rpad('zzforged', 43, 'z'),
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'event_id', current_setting('s8b.ev_muurtham'),
      'attending', 'attending', 'party_size', 1))));

  PERFORM pg_temp.s8b_eq('Q7 a withdrawn family cannot answer either, and is not told which kind of '
    'no it got: the revoked secret, the third-kind secret and a forged well-formed secret all answer one '
    'identical two-name no with a body that would have been accepted while the link lived, and the '
    'wedding''s answer rows are exactly the number counted at the top of this group — the withdrawal closed '
    'the door without writing a single row behind it',
    ARRAY[cardinality(ans)::text,
          (SELECT count(DISTINCT pg_temp.s8b_pairs(x))::text FROM unnest(ans) u(x)),
          (SELECT min(pg_temp.s8b_pairs(x))::text FROM unnest(ans) u(x)),
          (SELECT bool_and(pg_temp.s8b_top_keys(x) = ARRAY['reason','recorded']::text[])
             FROM unnest(ans) u(x))::text,
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.wedding_id = s.wed_a)]::text[],
    ARRAY['3', '1', '{reason=unavailable,recorded=false}', 'true',
          ans_then::text]::text[]);

  -- QF the teardown order, read as the schema''s own answer rather than as a verb. `docs/architecture/
  -- guest-rsvp-security.md` §12 gives the tiers an erasure order because a credential-bearing row blocks
  -- the aggregate above it, and the two composites that do the blocking are Stage 2''s
  -- (`20260925120400_stage2_assets_entitlements_secrets.sql:169-170`); Stage 3 measured the same pair for
  -- the wedding-level kind (`stage3/30_publication.sql:1154,1160`). What Stage 8 adds is a *second* kind
  -- pinned the same way, so the household level is measured here for the first time: a family''s link is
  -- the row that keeps its household undeletable, and — this is the part a host''s screen has to be honest
  -- about — withdrawing a link does not undo that, because a revocation is a timestamp and not a deletion.
  -- The three probes therefore run *after* the takedown, so that the answer "you may not delete this
  -- family" is being measured against a wedding whose links are all already dead.
  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('QF', '01-publication-undeletable',
     'DELETE FROM public.publications WHERE id = ' || quote_literal(pub_now::text) || '::uuid',
     '23503', '%access_tokens_wedding_id_publication_id_fkey%'),
    ('QF', '02-household-undeletable',
     'DELETE FROM public.guest_households WHERE id = '
     || quote_literal(current_setting('s8b.hh_idaveli')) || '::uuid',
     '23503', '%access_tokens_wedding_id_household_id_fkey%'),
    ('QF', '03-pointer-cannot-dangle',
     'UPDATE private.access_tokens SET publication_id = '
     || '''00000000-0000-0000-0000-000000000000''::uuid WHERE id = '
     || quote_literal(q_ctl::text) || '::uuid',
     '23503', '%access_tokens_wedding_id_publication_id_fkey%');

  PERFORM pg_temp.s8b_run('QF', 'postgres', NULL);

  PERFORM pg_temp.s8b_eq('QF the three refusals refused without effect: three probes ran, all three '
    'answered the table''s own foreign key rather than a policy or a trigger, and nothing was removed — the '
    'publication row is still there, the family whose link this file planted is still there, the probe '
    'credential still names the publication it was pinned to, and the wedding''s credential population is '
    'the snapshot plus the one planted row. The erasure order the design note gives is therefore a '
    'requirement and not a suggestion, and it still applies to a wedding whose links are all revoked',
    ARRAY[(SELECT count(*)::text FROM probes WHERE grp = 'QF'),
          (SELECT count(*)::text FROM public.publications p WHERE p.id = pub_now),
          (SELECT count(*)::text FROM public.guest_households h
            WHERE h.id = current_setting('s8b.hh_idaveli')::uuid),
          (SELECT (t.publication_id = pub_now)::text FROM private.access_tokens t
            WHERE t.id = q_ctl),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a)]::text[],
    ARRAY['3', '1', '1', 'true', (t_total + ctl_rows + 1)::text]::text[]);

  -- Q8 the instrument taken back out, so that group Z''s census counts only credentials the product
  -- minted. This is battery 1''s own discipline for the same shape (its W3 plants a row of this kind and
  -- its W4 removes it, naming the reason) and the deletion is by kind, so it removes exactly what this
  -- group planted whenever the store started clean, which Q1 measured.
  DELETE FROM private.access_tokens WHERE token_kind = 'rsvp';
  GET DIAGNOSTICS n = ROW_COUNT;

  PERFORM pg_temp.s8b_eq('Q8 and the probe credential is gone again: one row deleted, no row of the '
    'unused kind anywhere, and the tested wedding''s credential population back to the snapshot this group '
    'started from — so every count in the groups below is a count of the product''s own links, and the '
    'wedding''s links are all still withdrawn',
    ARRAY[n::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.token_kind = 'rsvp'),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a
              AND t.token_kind IN ('public_invitation','guest_invitation')),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.revoked_at IS NULL),
          (SELECT count(*)::text FROM public.publications p
            WHERE p.wedding_id = s.wed_a AND p.status = 'active')]::text[],
    ARRAY[(ctl_rows + 1)::text, '0', t_total::text, '0', '0']::text[]);

  -- Carried so the republish half, and the census in group Z, can tie their arithmetic to the state the
  -- takedown left rather than to a number they would have to guess across a DO block. Each of these is a
  -- measurement this group took from the tables at its own opening; battery 1's residue makes every one of
  -- them unguessable from here, which is exactly why the arithmetic is exported instead of restated.
  PERFORM set_config('s8b.ans_then',       ans_then::text, false);
  PERFORM set_config('s8b.guest_then',     guest_then::text, false);
  PERFORM set_config('s8b.manual_then',    manual_then::text, false);
  PERFORM set_config('s8b.t_total',        t_total::text, false);
  PERFORM set_config('s8b.pub_total_then', pub_total_then::text, false);
  PERFORM set_config('s8b.wb_ans',         wb_ans::text, false);
  PERFORM set_config('s8b.wb_total',       wb_total::text, false);
  PERFORM set_config('s8b.wb_live',        wb_live::text, false);

  PERFORM pg_temp.s8b_send(NULL);
END $Q$;

-- Every household credential of the tested wedding, after the takedown and after the probe row has been
-- removed, so the republish half of the ruling can be written entirely as a diff. Anything that appears in
-- the table but not here was minted by a verb below; anything here whose five columns disagree was moved
-- by one.
CREATE TEMP TABLE s8u ON COMMIT DROP AS
SELECT t.id AS tid, t.household_id AS hh,
       t.publication_id AS pub, t.expires_at AS exp, t.expiry_policy AS pol,
       t.token_hash AS hash, t.revoked_at AS rev
  FROM private.access_tokens t
 WHERE t.wedding_id = (SELECT wed_a FROM s8c)
   AND t.token_kind = 'guest_invitation';

-- --------------------------------------------------------------------------- Qb: what a republish does not undo
-- The second half of the roster''s sentence, and the half with the most tempting way to get it wrong. The
-- retarget Stage 8 added to `publish_invitation_version` is an `UPDATE` whose filters are the wedding, the
-- kind and `revoked_at IS NULL` (`:1045,1047,1048`); drop that last arm and a host republishing a corrected
-- version would silently resurrect every link they had withdrawn, family by family, with the family''s own
-- saved URL working again as though the takedown had never happened. No count in the answer would show it
-- and no status field would say it. The only instrument that can see it is this file''s snapshot `s8u`,
-- taken when every household row is dead, compared column by column after the publish.
--
-- Before that, the two refusals that make the takedown a boundary rather than a coincidence: with no active
-- publication, both minting verbs refuse *before* they look at any household — and the rotate probe is the
-- ordering claim, because the family it names has no live link either, so an implementation that consulted
-- the family first would answer a different sentence (`:421-428`, a `P0001` the host is entitled to be
-- told) and the probe would fail.
DO $Qb$
DECLARE s s8c%ROWTYPE; v jsonb; w jsonb; dto jsonb;
        ver4 uuid; pub4 uuid; raw_baby4 text; raw_pillai4 text; raw_wed4 text;
        n bigint; pp_then bigint; pp_now bigint; pp_val text; pp_val2 text;
        nair_then bigint; nair_now bigint;
        nair_b text; nair_a text;
        ans_w bigint; total_now bigint;
BEGIN
  SELECT * INTO s FROM s8c;

  -- QB the two minting verbs, refused at the publication rather than at the family.
  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('QB', '01-issue-needs-publication',
     'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, ARRAY['
     || quote_literal(s.hh_nair::text) || '::uuid], NULL)',
     '23514', '%publish the invitation before sending household links%'),
    ('QB', '02-rotate-checks-publication-first',
     'SELECT api.rotate_guest_invitation('
     || quote_literal(current_setting('s8b.hh_pillai')) || '::uuid)',
     '23514', '%there is no published invitation to rotate%');

  PERFORM pg_temp.s8b_run('QB', 'authenticated', s.owner_a::text);

  -- ...and the refusal minted nothing, which is the difference between a guard and a guard that raises
  -- after the INSERT. Measured against `s8u`: no row added for any family, no live row, and none of the
  -- five columns of the rows that exist moved.
  PERFORM pg_temp.s8b_eq('QB'' the two refusals were refusals and not partial sends: no household '
    'credential of this wedding was added by either call (the population is exactly the snapshot, and the '
    'Nair and Pillai families'' own row counts are what they were), none is live, and no column of any '
    'existing row moved — a withdrawn link stays withdrawn through a refused attempt to rotate it',
    ARRAY[(SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NULL),
          (SELECT count(*)::text FROM s8u q JOIN private.access_tokens t ON t.id = q.tid
            WHERE t.publication_id IS DISTINCT FROM q.pub
               OR t.token_hash IS DISTINCT FROM q.hash
               OR t.expires_at IS DISTINCT FROM q.exp
               OR t.expiry_policy IS DISTINCT FROM q.pol
               OR t.revoked_at IS DISTINCT FROM q.rev),
          (SELECT count(*)::text FROM s8u q WHERE NOT EXISTS (
             SELECT 1 FROM private.access_tokens t WHERE t.id = q.tid)),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_nair),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = current_setting('s8b.hh_pillai')::uuid)]::text[],
    ARRAY[(SELECT count(*)::text FROM s8u), '0', '0', '0',
          (SELECT count(*)::text FROM s8u q WHERE q.hh = s.hh_nair),
          (SELECT count(*)::text FROM s8u q
            WHERE q.hh = current_setting('s8b.hh_pillai')::uuid)]::text[]);

  -- Qb1 freezing a corrected version while the wedding has no document. `create_invitation_version` is
  -- Stage 7''s verb and carries no publication precondition (`:675-736` is owner, language, draft,
  -- snapshot, issue-record and version-number guards, then the INSERT) — a host may prepare a revision
  -- during a takedown; what they may not do is send it, or have their families'' old links keep working
  -- because of it. So the freeze is asserted to change exactly one thing: a new frozen version.
  n := pg_temp.s8b_host_write(s.owner_a::text,
    'UPDATE public.invitation_drafts SET content = jsonb_set(content, ''{welcome}'', '
    || 'to_jsonb(current_setting(''s8b.mk_draft4'')::text))'
    || ' WHERE wedding_id = ' || quote_literal(s.wed_a::text) || '::uuid');
  v := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.create_invitation_version(' || quote_literal(s.wed_a::text) || '::uuid)');
  ver4 := (v ->> 'version_id')::uuid;

  PERFORM pg_temp.s8b_eq('Qb1 a withdrawn wedding can still be revised and a revision is not a '
    'resurrection: the draft write touched its one row, the freeze made version 4 carrying the new line in '
    'the frozen snapshot and nowhere else, the wedding still has no active publication, still has no live '
    'credential of either kind, and no household credential row moved — freezing does not retarget, which is '
    'the same distinction group P drew for version 3, one takedown later',
    ARRAY[n::text,
          (SELECT x.version_number::text FROM public.invitation_versions x WHERE x.id = ver4),
          (SELECT (x.wedding_id = s.wed_a
                   AND (x.snapshot::text LIKE '%' || current_setting('s8b.mk_draft4') || '%'))::text
             FROM public.invitation_versions x WHERE x.id = ver4),
          (SELECT count(*)::text FROM public.invitation_versions x
            WHERE x.wedding_id = s.wed_a
              AND x.snapshot::text LIKE '%' || current_setting('s8b.mk_draft4') || '%'),
          (SELECT count(*)::text FROM public.publications p
            WHERE p.wedding_id = s.wed_a AND p.status = 'active'),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.revoked_at IS NULL),
          (SELECT count(*)::text FROM s8u q JOIN private.access_tokens t ON t.id = q.tid
            WHERE t.publication_id IS DISTINCT FROM q.pub
               OR t.revoked_at IS DISTINCT FROM q.rev)]::text[],
    ARRAY['1', '4', 'true', '1', '0', '0', '0']::text[]);

  -- Qb2 the republish. `link_reused` is false this time and a real path arrives, because the takedown
  -- retired the wedding''s own link and the publish''s lookup (`:1014-1018`) found nothing to keep — the
  -- mirror image of P3, and the pair of them is what makes `link_reused` a report rather than a constant.
  -- The household rows, meanwhile, do not move by one column: every one of them is revoked, so the
  -- retarget''s own `revoked_at IS NULL` has nothing to act on. That zero is this group''s reason to exist.
  v := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.publish_invitation_version(' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(ver4::text) || '::uuid, NULL)');
  pub4 := (v ->> 'publication_id')::uuid;
  raw_wed4 := substr(v ->> 'path', 4);
  PERFORM set_config('s8b.raw_wed4', raw_wed4, false);

  PERFORM pg_temp.s8b_eq('Qb2 republishing makes a new document and revives no old link: five names in '
    'the answer, `link_reused: false` with a real 46-octet `/i/` path because the takedown left no wedding '
    'secret to keep, exactly one active publication and it names version 4, the publication the host '
    'withdrew is still `revoked`, and every household credential row this file snapshotted is untouched in '
    'all five of its columns with none added and none lost — the retarget ran and matched nothing, which is '
    'the only way the ruling''s "cannot be undone by republishing" can be true',
    ARRAY[pg_temp.s8b_top_keys(v)::text,
          (v ->> 'link_reused'),
          octet_length(v ->> 'path')::text,
          (left(v ->> 'path', 3) = '/i/')::text,
          (SELECT count(*)::text FROM public.publications p
            JOIN public.invitation_versions x ON x.id = p.version_id
           WHERE p.wedding_id = s.wed_a AND p.status = 'active' AND x.version_number = 4),
          ((SELECT p.id FROM public.publications p
             WHERE p.wedding_id = s.wed_a AND p.status = 'active') = pub4)::text,
          (SELECT p.status FROM public.publications p WHERE p.id = current_setting('s8b.pub_now')::uuid),
          (SELECT count(*)::text FROM s8u q JOIN private.access_tokens t ON t.id = q.tid
            WHERE t.publication_id IS DISTINCT FROM q.pub
               OR t.token_hash IS DISTINCT FROM q.hash
               OR t.expires_at IS DISTINCT FROM q.exp
               OR t.expiry_policy IS DISTINCT FROM q.pol
               OR t.revoked_at IS DISTINCT FROM q.rev),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NULL)]::text[],
    ARRAY['{expires_at,link_reused,path,publication_id,version_id}', 'false', '46', 'true',
          '1', 'true', 'revoked', '0',
          (SELECT count(*)::text FROM s8u), '0']::text[]);

  -- Qb3 the family''s links, freshly sent after the revision. This is the distinction the whole ruling
  -- turns on and it is easy to lose in an implementation: a *new* link for a family is not the old link
  -- coming back, and the way to tell them apart is the digest. Both calls report `issued` rather than
  -- `already_live`, because the retired rows do not occupy the one-live slot
  -- (`one_live_guest_token_per_household`, `:103-107`), and each raw is read out of the array by its own
  -- `household_id` before the answer is reused for anything else — a secret is legible once, and a group
  -- that re-reads `v` after overwriting it is measuring its own bookkeeping.
  v := pg_temp.s8b_auth(s.owner_a::text,
    'SELECT api.issue_guest_invitations(' || quote_literal(s.wed_a::text) || '::uuid, ARRAY['
    || quote_literal(s.hh_baby::text) || '::uuid, '
    || quote_literal(current_setting('s8b.hh_pillai')) || '::uuid], NULL)');
  raw_baby4 := (SELECT substr(i ->> 'path', 4) FROM jsonb_array_elements(v -> 'invitations') i
                 WHERE (i ->> 'household_id')::uuid = s.hh_baby);
  raw_pillai4 := (SELECT substr(i ->> 'path', 4) FROM jsonb_array_elements(v -> 'invitations') i
                   WHERE (i ->> 'household_id')::uuid = current_setting('s8b.hh_pillai')::uuid);
  PERFORM set_config('s8b.raw_baby4', raw_baby4, false);
  PERFORM set_config('s8b.raw_pillai4', raw_pillai4, false);

  PERFORM pg_temp.s8b_eq('Qb3 after a takedown the only way to reach a family is a new secret: one call '
    'for two families answered issued twice and already_live zero times — the retired rows did not block '
    'the slot and did not come back — with two distinct 43-octet paths in the `/g/` form, both new rows '
    'pinned to the publication this group just published and neither revoked, and the answer naming that '
    'same publication',
    ARRAY[(v ->> 'issued'), (v ->> 'already_live'),
          ((v ->> 'publication_id')::uuid = pub4)::text,
          (SELECT count(*)::text FROM jsonb_array_elements(v -> 'invitations') i
            WHERE (i ->> 'status') = 'issued' AND left(i ->> 'path', 3) = '/g/'),
          (SELECT count(DISTINCT i ->> 'path')::text
             FROM jsonb_array_elements(v -> 'invitations') i),
          octet_length(raw_baby4)::text,
          octet_length(raw_pillai4)::text,
          (raw_baby4 <> raw_pillai4)::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NULL AND t.publication_id = pub4),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NULL)]::text[],
    ARRAY['2', '0', 'true', '2', '2', '43', '43', 'true', '2', '2']::text[]);

  -- Qb4 which rows arrived, per family, as an arithmetic diff against `s8u` rather than as a total. Two
  -- families gained exactly one row each and the other four gained none — which is the same statement as
  -- "the host''s re-send did not touch the families they were not addressing", and is what a count of live
  -- links on its own cannot say. The retired rows stay pinned where they were retired: the Baby and Pillai
  -- families now hold both a dead row naming the withdrawn publication and a live row naming the new one,
  -- which is the rotation-shaped history the state function''s LATERAL was written to prefer the live half
  -- of (§3.4).
  total_now := (SELECT count(*) FROM private.access_tokens t
                  WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation');
  PERFORM pg_temp.s8b_eq('Qb4 exactly two families gained a credential and no other family lost or moved '
    'one: the wedding''s household rows are the snapshot plus two, the two new rows belong to the Baby and '
    'Pillai families, every other family holds the same rows it held before, no snapshotted row changed '
    'pointer or state, and the withdrawn publication still has the retired rows pinned to it — history is '
    'append-only, which is the same claim the file''s head makes about the credential store, measured at the '
    'moment the store has both generations in it',
    ARRAY[(total_now = (SELECT count(*)::text FROM s8u)::int + 2)::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_baby
              AND t.id NOT IN (SELECT tid FROM s8u)),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = current_setting('s8b.hh_pillai')::uuid
              AND t.id NOT IN (SELECT tid FROM s8u)),
          (SELECT count(*)::text FROM (
             SELECT q.hh, count(*) AS then_n FROM s8u q GROUP BY q.hh) a
             JOIN (SELECT t.household_id AS hh, count(*) AS now_n
                     FROM private.access_tokens t
                    WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation'
                    GROUP BY 1) b ON b.hh = a.hh
            WHERE b.now_n <> a.then_n
                  + CASE WHEN b.hh IN (s.hh_baby,
                        current_setting('s8b.hh_pillai')::uuid) THEN 1 ELSE 0 END),
          (SELECT count(*)::text FROM s8u q JOIN private.access_tokens t ON t.id = q.tid
            WHERE t.publication_id IS DISTINCT FROM q.pub
               OR t.revoked_at IS DISTINCT FROM q.rev),
          ((SELECT count(*) FROM s8u q
              JOIN private.access_tokens t ON t.id = q.tid
             WHERE q.rev IS NOT NULL AND q.pub = current_setting('s8b.pub_now')::uuid
               AND t.publication_id = q.pub)
           = (SELECT count(*) FROM s8u
               WHERE rev IS NOT NULL AND pub = current_setting('s8b.pub_now')::uuid))::text,
          (SELECT (count(*) > 0)::text FROM s8u
            WHERE rev IS NOT NULL AND pub = current_setting('s8b.pub_now')::uuid)]::text[],
    ARRAY['true', '1', '1', '0', '0', 'true', 'true']::text[]);

  -- Qb5 the doors, in both directions. The new secrets open, the secrets the takedown withdrew stay
  -- shut *through a republish of the very version they were withdrawn before*, the new wedding link opens
  -- the wedding door, and the new household link is refused there. The middle pair is the ruling''s
  -- sentence read by the only reader a stranger has.
  w := pg_temp.s8b_door(raw_baby4);
  PERFORM pg_temp.s8b_eq('Qb5 the new links open and the withdrawn ones do not: the Baby and Pillai '
    'families'' fresh secrets each answer their own household, the two secrets this file watched being '
    'withdrawn are refused by the household door with one name and no guest half even though the wedding now '
    'has an active publication again, the untouched Nair secret is refused the same way, and the new wedding '
    'secret opens the wedding door while a household secret is refused at it',
    ARRAY[(w ->> 'available'),
          ((w -> 'guest' ->> 'household_id')::uuid = s.hh_baby)::text,
          (pg_temp.s8b_door(raw_pillai4) ->> 'available'),
          ((pg_temp.s8b_door(raw_pillai4) -> 'guest' ->> 'household_id')::uuid
            = current_setting('s8b.hh_pillai')::uuid)::text,
          pg_temp.s8b_top_keys(pg_temp.s8b_door(current_setting('s8b.raw_baby')))::text,
          pg_temp.s8b_top_keys(pg_temp.s8b_door(current_setting('s8b.raw_nair2')))::text,
          (pg_temp.s8b_door(current_setting('s8b.raw_chenna')) ? 'guest')::text,
          (pg_temp.s8b_public_door(raw_wed4) ->> 'available'),
          (pg_temp.s8b_public_door(raw_wed4) -> 'invitation' ->> 'welcome'),
          (pg_temp.s8b_public_door(raw_baby4) ->> 'available'),
          (pg_temp.s8b_public_door(raw_baby4) ? 'invitation')::text]::text[],
    ARRAY['true', 'true', 'true', 'true', '{available}', '{available}', 'false',
          'true', current_setting('s8b.mk_draft4'), 'false', 'false']::text[]);

  -- Qb6 what the family sees now, with the document half and the personal half compared by different
  -- instruments for different reasons: the invitation is byte-equal to `private.public_invitation_dto` of
  -- the version 4 snapshot (the parity Ruling 5.1 keeps intact through a takedown and a republish), while
  -- the card list is compared against the *tables*, because group E established that the door projects its
  -- household''s own enabled scope rows and this file has written answers since then. The greeting is
  -- compared against the value group E read out of the door before any of this happened, so the family''s
  -- own identity survives four revisions and one takedown.
  SELECT private.public_invitation_dto(x.snapshot_schema_version, x.snapshot) INTO dto
    FROM public.invitation_versions x WHERE x.id = ver4;
  PERFORM pg_temp.s8b_eq('Qb6 a family re-invited after a takedown is shown the corrected document and '
    'its own name: the page opens at version 4, its `invitation` is the projection of the frozen version 4 '
    'snapshot and nothing else, the welcome line is the new one, the greeting is the one this family was '
    'greeted with at the start of this file, its cards are exactly its own enabled scope rows read from the '
    'tables with a matching count, and it may answer',
    ARRAY[(w ->> 'available'),
          (w -> 'guest' ->> 'version_number'),
          (w -> 'invitation' = dto)::text,
          (w -> 'invitation' ->> 'welcome'),
          ((w -> 'guest' ->> 'greeting')
            = (SELECT d.a -> 'guest' ->> 'greeting' FROM s8d d WHERE d.who = 'baby'))::text,
          ((SELECT pg_temp.s8b_arr(jsonb_agg(e.display_name))
              FROM public.household_event_scopes sc
              JOIN public.wedding_events e
                ON e.wedding_id = sc.wedding_id AND e.id = sc.event_id
             WHERE sc.household_id = s.hh_baby AND e.enabled)
            =
           (SELECT pg_temp.s8b_arr(jsonb_agg(q.c ->> 'display_name'))
              FROM jsonb_array_elements(w -> 'guest' -> 'events') q(c)))::text,
          (SELECT count(*)::text FROM jsonb_array_elements(w -> 'guest' -> 'events')),
          (w -> 'guest' ->> 'can_respond')]::text[],
    ARRAY['true', '4', 'true', current_setting('s8b.mk_draft4'), 'true', 'true',
          (SELECT count(*)::text FROM public.household_event_scopes sc
             JOIN public.wedding_events e
               ON e.wedding_id = sc.wedding_id AND e.id = sc.event_id
            WHERE sc.household_id = s.hh_baby AND e.enabled)::text,
          'true']::text[]);

  -- Qb7 the new link can actually answer, and answers into the row the family already had. Pillai is the
  -- family chosen for this because group A4 gave it exactly one answer through its first link, so what the
  -- re-issued secret has to prove here is the harder half of the ruling: it lands on the same
  -- (household, event) row, overwrites the headcount the family first gave, and leaves this wedding's answer
  -- count exactly where group Q left it. A re-send that accumulated a second reply for a family that had
  -- already answered would show up in the host's panel as a household that replied twice, and no count of
  -- live links would ever show it. The Nair family is read alongside it: its answer came in through battery
  -- 1's link, so an implementation whose new secret could reach across would show up as a changed Nair row.
  pp_then   := (SELECT count(*) FROM public.rsvp_responses r
                  WHERE r.household_id = current_setting('s8b.hh_pillai')::uuid);
  pp_val    := (SELECT coalesce(string_agg(r.attending || '|' || r.party_size::text, ','
                                           ORDER BY r.event_id::text), '')
                  FROM public.rsvp_responses r
                 WHERE r.household_id = current_setting('s8b.hh_pillai')::uuid);
  nair_then := (SELECT count(*) FROM public.rsvp_responses r WHERE r.household_id = s.hh_nair);
  nair_b    := (SELECT coalesce(string_agg(r.attending || '|' || r.party_size::text, ','
                                           ORDER BY r.event_id::text), '')
                  FROM public.rsvp_responses r WHERE r.household_id = s.hh_nair);

  v := pg_temp.s8b_answer(raw_pillai4, jsonb_build_object('events', jsonb_build_array(
    jsonb_build_object('event_id', current_setting('s8b.ev_muurtham'),
                       'attending', 'attending', 'party_size', 1))));

  pp_now    := (SELECT count(*) FROM public.rsvp_responses r
                  WHERE r.household_id = current_setting('s8b.hh_pillai')::uuid);
  pp_val2   := (SELECT coalesce(string_agg(r.attending || '|' || r.party_size::text, ','
                                           ORDER BY r.event_id::text), '')
                  FROM public.rsvp_responses r
                 WHERE r.household_id = current_setting('s8b.hh_pillai')::uuid);
  nair_now  := (SELECT count(*) FROM public.rsvp_responses r WHERE r.household_id = s.hh_nair);
  nair_a    := (SELECT coalesce(string_agg(r.attending || '|' || r.party_size::text, ','
                                           ORDER BY r.event_id::text), '')
                  FROM public.rsvp_responses r WHERE r.household_id = s.hh_nair);
  ans_w     := (SELECT count(*) FROM public.rsvp_responses r WHERE r.wedding_id = s.wed_a);
  PERFORM pg_temp.s8b_eq('Qb7 the re-issued link is a working invitation and not a wider one, and not a '
    'second mouthpiece either: the submission is recorded against the Pillai household alone with one event, '
    'that family held exactly the one answer group A wrote for it and holds exactly one still, its position '
    'moves from the two it first gave to the one it gave through the new secret while the label stays '
    '`guest` and the headcount stays inside what the host expected, this wedding''s answer count is the number '
    'group Q left rather than one more, the Nair family''s answer is untouched in both count and value, and '
    'the host''s panel still reports one reply for the Pillai household — the personalisation and the privacy '
    'boundary both still hold one takedown and one re-send later',
    ARRAY[(v ->> 'recorded'),
          ((v ->> 'household_id')::uuid
            = current_setting('s8b.hh_pillai')::uuid)::text,
          (v ->> 'events_recorded'),
          pp_then::text,
          (pp_now = pp_then)::text,
          pp_val,
          (pp_val2 = 'attending|1')::text,
          (ans_w = current_setting('s8b.ans_then')::bigint)::text,
          (SELECT (r.attending = 'attending' AND r.party_size = 1
                   AND r.response_source = 'guest')::text FROM public.rsvp_responses r
            WHERE r.household_id = current_setting('s8b.hh_pillai')::uuid
              AND r.event_id = s.ev_muurtham),
          (nair_now = nair_then)::text,
          (nair_a = nair_b)::text,
          (SELECT e ->> 'reply_count' FROM jsonb_array_elements(
             pg_temp.s8b_auth(s.owner_a::text,
               'SELECT api.get_guest_invitation_state('
               || quote_literal(s.wed_a::text) || '::uuid)')) e
            WHERE (e ->> 'household_id')::uuid = current_setting('s8b.hh_pillai')::uuid)]::text[],
    ARRAY['true', 'true', '1', '1', 'true', 'attending|2', 'true', 'true',
          'true', 'true', 'true', '1']::text[]);

  -- Qb8 the leak scan, over the three secrets this group minted. It runs last because it is the claim
  -- about *this file''s* additions: a stage that mints credentials has to prove its own raws never enter a
  -- record, and the earlier groups'' raws were scanned by the groups that made them. The scan is every
  -- text-shaped column of every base table in both schemas the product owns (the helper''s own note at its
  -- definition says why it deliberately does not swallow an error).
  PERFORM pg_temp.s8b_eq('Qb8 and none of the three secrets this group created is stored anywhere a '
    'database read could reach it: the Baby family''s new link, the Pillai family''s new link and the '
    'wedding''s new public link each produce zero hits across every text, varchar, domain and jsonb column '
    'of every base table in `public` and `private` — so what the store holds is the digests, and the raws '
    'exist only in the answers that minted them',
    ARRAY[coalesce(pg_temp.s8b_stored_hits(raw_baby4), '{}'::text[])::text,
          coalesce(pg_temp.s8b_stored_hits(raw_pillai4), '{}'::text[])::text,
          coalesce(pg_temp.s8b_stored_hits(raw_wed4), '{}'::text[])::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.household_id = s.hh_baby AND t.token_kind = 'guest_invitation'
              AND t.revoked_at IS NULL)]::text[],
    ARRAY['{}', '{}', '{}', '1']::text[]);

  PERFORM set_config('s8b.pub_now', pub4::text, false);
  PERFORM pg_temp.s8b_send(NULL);
END $Qb$;

-- --------------------------------------------------------------------------- Z: the census this file leaves behind
-- The HTTP tier, the client adapter and the browser tier are written against the state this battery leaves,
-- the way this file's own group X was written against the state battery 1's Z section declared. Two rules
-- keep that honest.
--
--   * No number here is recalled. Every total is either one of the eight baselines group Q measured from the
--     tables at its own opening and exported (`s8b.ans_then`, `s8b.guest_then`, `s8b.manual_then`,
--     `s8b.t_total`, `s8b.pub_total_then`, `s8b.wb_ans`, `s8b.wb_total`, `s8b.wb_live`), a count taken from
--     the snapshots `s8t` and `s8u`, or a shape battery 1's Z section declared and group X re-measured. The
--     tested wedding's credential population is inherited across a committed battery as well as minted here,
--     so a hand-written total would be a guess dressed as an assertion.
--   * No number here reaches for a table's global count without saying so. Two arms below do count whole
--     tables — the unused credential kind, and the answer table's total — and they are the same two global
--     claims battery 1's Z section already stakes, so if they are wrong it fails first and stops the run
--     rather than this file failing for another stage's residue.
--
-- One footgun, named because group Q and this group read the same GUC differently: `s8b.pub_now` was the
-- publication group P made active, and group Qb overwrote it at its last line with the publication that
-- replaced it after the takedown. This section therefore reads the wedding's active publication out of the
-- table rather than out of the GUC, and the withdrawn one by its `revoked` status.
DO $Z$
DECLARE s s8c%ROWTYPE;
BEGIN
  SELECT * INTO s FROM s8c;

  -- Z1 the guest list, by name. Two of these six rows did not exist when this file opened and arrived
  -- through the host's own RLS policy; one of them is deliberately incomplete, because Stage 2 rules an
  -- unsaluted, unmeasured household representable and the guest door's fallback is what has to be true
  -- rather than this file's hope.
  PERFORM pg_temp.s8b_eq('Z1 the guest list this battery leaves: six households on the tested wedding, and '
    'they are exactly the six names the cast read and the two host writes inserted, with no seventh row under '
    'any other name; the family added without a salutation or a headcount still holds both nulls, the family '
    'added with a private note still holds it in the column no guest door may project, and the other '
    'wedding''s family is still here — this file created two households and deleted none',
    ARRAY[(SELECT count(*)::text FROM public.guest_households h
            WHERE h.wedding_id = s.wed_a),
          (SELECT coalesce(string_agg(h.display_name, ',' ORDER BY h.display_name COLLATE "C"), '-')
             FROM public.guest_households h WHERE h.wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.guest_households h
            WHERE h.wedding_id = s.wed_a
              AND h.id NOT IN (s.hh_chenna, s.hh_baby, s.hh_nair, s.hh_raman,
                               current_setting('s8b.hh_pillai')::uuid,
                               current_setting('s8b.hh_idaveli')::uuid)),
          (SELECT count(*)::text FROM public.guest_households h WHERE h.id = s.hh_stranger),
          (SELECT (h.salutation IS NULL AND h.expected_party_size IS NULL)::text
             FROM public.guest_households h
            WHERE h.id = current_setting('s8b.hh_idaveli')::uuid),
          (SELECT (h.host_notes LIKE '%' || current_setting('s8b.mk_note') || '%'
                   AND h.host_notes LIKE '%' || current_setting('s8b.mk_name') || '%')::text
             FROM public.guest_households h
            WHERE h.id = current_setting('s8b.hh_pillai')::uuid)]::text[],
    ARRAY['6',
          'Chennakrishna Iyer,The Baby family,The Idaveli household,The Nair family,'
          || 'The Pillai household,The Raman family',
          '0', '1', 'true', 'true']::text[]);

  -- Z2 the invitations, by family. The lopsided pair is the reason this census bothers to name the counts
  -- per household at all: Pillai is the only family whose scope set is not the enabled set, so it is the
  -- only row pair that can separate a door that filters on scope from one that filters on the switch.
  PERFORM pg_temp.s8b_eq('Z2 seven scope rows on the tested wedding, spread in the shape the cast was '
    'written in — two at both running ceremonies for Chennakrishna and for Baby, one for Nair, the pair '
    'Pillai was given, and nothing at all for Raman or Idaveli — four of the six families are invited '
    'somewhere, Pillai''s pair is one running ceremony plus the ceremony the couple switched off, and no '
    'scope row of this wedding names an event belonging to another wedding',
    ARRAY[(SELECT count(*)::text FROM public.household_event_scopes q
            WHERE q.wedding_id = s.wed_a),
          (SELECT coalesce(string_agg(f.dn || ':' || f.n, ' ' ORDER BY f.dn COLLATE "C"), '-')
             FROM (SELECT h.display_name AS dn,
                          (SELECT count(*)::text FROM public.household_event_scopes q
                             WHERE q.household_id = h.id) AS n
                     FROM public.guest_households h
                    WHERE h.wedding_id = s.wed_a) f),
          (SELECT count(*)::text FROM public.household_event_scopes q
             JOIN public.guest_households h ON h.id = q.household_id
            WHERE q.wedding_id = s.wed_a
              AND h.wedding_id <> q.wedding_id),
          (SELECT count(*)::text FROM public.household_event_scopes q
             JOIN public.wedding_events e ON e.id = q.event_id
            WHERE q.household_id = current_setting('s8b.hh_pillai')::uuid AND e.enabled),
          (SELECT count(DISTINCT q.household_id)::text FROM public.household_event_scopes q
            WHERE q.wedding_id = s.wed_a)]::text[],
    ARRAY['7',
          'Chennakrishna Iyer:2 The Baby family:2 The Idaveli household:0 The Nair family:1 '
          || 'The Pillai household:2 The Raman family:0',
          '0', '1', '4']::text[]);

  -- Z3 the credential arithmetic. Each of the three minted by group Qb is a *new* row, so the population is
  -- the snapshot plus three, and the live set is exactly those three: nothing the takedown retired came back
  -- through the republish, which is Ruling 8.1 read as a census rather than as a behaviour.
  PERFORM pg_temp.s8b_eq('Z3 the credential arithmetic, derived rather than recalled: the tested wedding '
    'holds the two kinds group Q snapshotted plus the three secrets group Qb minted, and its household rows '
    'are the snapshot plus two; exactly three credentials are live; every live row points at the wedding''s '
    'one active publication; no retired row was re-pointed at it by the republish; the third, unused kind '
    'holds no row anywhere now that group Q took its instrument back out; and no row of this wedding stores '
    'anything but a lowercase 64-character hex digest',
    ARRAY[((SELECT count(*) FROM private.access_tokens t
              WHERE t.wedding_id = s.wed_a
                AND t.token_kind IN ('public_invitation','guest_invitation'))
           = (current_setting('s8b.t_total')::bigint + 3))::text,
          ((SELECT count(*) FROM private.access_tokens t
              WHERE t.wedding_id = s.wed_a AND t.token_kind = 'guest_invitation')
           = ((SELECT count(*) FROM s8u)::bigint + 2))::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.revoked_at IS NULL),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.revoked_at IS NULL
              AND t.publication_id IS DISTINCT FROM
                  (SELECT p.id FROM public.publications p
                    WHERE p.wedding_id = s.wed_a AND p.status = 'active')),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.revoked_at IS NOT NULL
              AND t.publication_id =
                  (SELECT p.id FROM public.publications p
                    WHERE p.wedding_id = s.wed_a AND p.status = 'active')),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.token_kind = 'rsvp'),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a
              AND t.token_kind IN ('public_invitation','guest_invitation')
              AND t.token_hash !~ '^[0-9a-f]{64}$')]::text[],
    ARRAY['true', 'true', '3', '0', '0', '0', '0']::text[]);

  -- Z4 the same population named family by family, which is the statement a live-link count cannot make.
  -- Baby and Pillai each hold a working link among more rows than that, because a withdrawal is a timestamp
  -- and not a deletion; the four families whose links this file closed hold none.
  --
  -- Pillai's four are counted, not recalled, and each is pinned by the group that made it: X10's mint,
  -- U2's rotation (which measured the household at two rows with one live), N6's re-send after N5 withdrew
  -- it (three rows, one live) and Qb3's post-takedown re-send, whose new row Qb4 identified as the one not
  -- in `s8u`. The qualification run that first reached this line measured `1/4` and the probe read the two
  -- newest digests back against `s8b.raw_pillai` and `s8b.raw_pillai4`, so the fourth row is Qb3's and not a
  -- mint nobody called; the hand total `1/2` predated group N and was the stale half of this assertion.
  PERFORM pg_temp.s8b_eq('Z4 the credentials named family by family, live-of-all: Chennakrishna Iyer none of '
    'its two, Baby one of five, Idaveli none of its two, Nair none of its two after group N rotated it, '
    'Pillai one of the four this file minted for it (X''s, U2''s successor, N6''s re-send and Qb3''s), Raman '
    'none of its four — and the other wedding is '
    'untouched by every mint, publish, takedown and re-send in this file, in both its total and its live '
    'count, against the pair group Q measured before any of it',
    ARRAY[(SELECT coalesce(string_agg(f.dn || ':' || f.lv || '/' || f.all_, ' '
                                     ORDER BY f.dn COLLATE "C"), '-')
             FROM (SELECT h.display_name AS dn,
                          (SELECT count(*)::text FROM private.access_tokens t
                             WHERE t.household_id = h.id AND t.revoked_at IS NULL) AS lv,
                          (SELECT count(*)::text FROM private.access_tokens t
                             WHERE t.household_id = h.id) AS all_
                     FROM public.guest_households h
                    WHERE h.wedding_id = s.wed_a) f),
          ((SELECT count(*) FROM private.access_tokens t
              WHERE t.wedding_id = s.wed_b)
           = current_setting('s8b.wb_total')::bigint)::text,
          ((SELECT count(*) FROM private.access_tokens t
              WHERE t.wedding_id = s.wed_b AND t.revoked_at IS NULL)
           = current_setting('s8b.wb_live')::bigint)::text,
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.revoked_at IS NULL
              AND t.token_kind = 'guest_invitation'
              AND t.household_id NOT IN (s.hh_baby, current_setting('s8b.hh_pillai')::uuid))]::text[],
    ARRAY['Chennakrishna Iyer:0/2 The Baby family:1/5 The Idaveli household:0/2 '
          || 'The Nair family:0/2 The Pillai household:1/4 The Raman family:0/4',
          'true', 'true', '0']::text[]);

  -- Z5 the answers, and whose they are. Group Qb7's submission overwrote the Pillai row group A wrote
  -- rather than adding a second one, so the wedding's total is the number group Q exported and the guest /
  -- host_manual split is unchanged — which is also the residue claim the next tier needs: a re-invited
  -- family must not appear in the host's panel twice.
  PERFORM pg_temp.s8b_eq('Z5 the answer census: the tested wedding still holds exactly the six rows group Q '
    'counted, four of them the family''s own and two the host''s transcriptions, in the family-by-family '
    'shape this file wrote them — Chennakrishna''s two are the inherited pair nobody could overwrite '
    'because its link was already dead, Baby''s are the two-event reply, Nair''s is the single revised row, '
    'Pillai''s is the one group A minted and group Qb overwrote, and Raman and Idaveli never answered; the '
    'source vocabulary is those two words and no third; no answer row of one wedding names a household of '
    'another; the host''s private optional-answer marker is nowhere in the table; the other wedding holds the '
    'one reply its own family gave through its own link and the whole store holds seven rows',
    ARRAY[((SELECT count(*) FROM public.rsvp_responses r
              WHERE r.wedding_id = s.wed_a)
           = current_setting('s8b.ans_then')::bigint)::text,
          ((SELECT count(*) FROM public.rsvp_responses r
              WHERE r.wedding_id = s.wed_a AND r.response_source = 'guest')
           = current_setting('s8b.guest_then')::bigint)::text,
          ((SELECT count(*) FROM public.rsvp_responses r
              WHERE r.wedding_id = s.wed_a AND r.response_source = 'host_manual')
           = current_setting('s8b.manual_then')::bigint)::text,
          (SELECT coalesce(string_agg(f.dn || ':' || f.n, ' ' ORDER BY f.dn COLLATE "C"), '-')
             FROM (SELECT h.display_name AS dn,
                          (SELECT count(*)::text FROM public.rsvp_responses r
                             WHERE r.household_id = h.id) AS n
                     FROM public.guest_households h
                    WHERE h.wedding_id = s.wed_a) f),
          (SELECT string_agg(u.v, ',' ORDER BY u.v COLLATE "C")
             FROM (SELECT DISTINCT response_source AS v
                     FROM public.rsvp_responses
                    WHERE wedding_id = s.wed_a) u),
          (SELECT count(*)::text FROM public.rsvp_responses r
             JOIN public.guest_households h ON h.id = r.household_id
            WHERE h.wedding_id <> r.wedding_id),
          (SELECT (r.attending || '|' || r.party_size::text || '|' || r.response_source)::text
             FROM public.rsvp_responses r
            WHERE r.household_id = current_setting('s8b.hh_pillai')::uuid
              AND r.event_id = s.ev_muurtham),
          (SELECT count(*)::text FROM public.rsvp_responses r
            WHERE r.answers ->> 'meal' = current_setting('s8b.mk_other_answer')),
          ((SELECT count(*) FROM public.rsvp_responses r
              WHERE r.wedding_id = s.wed_b)
           = current_setting('s8b.wb_ans')::bigint)::text,
          (SELECT r.response_source FROM public.rsvp_responses r
            WHERE r.household_id = s.hh_stranger),
          (SELECT count(*)::text FROM public.rsvp_responses)]::text[],
    ARRAY['true', 'true', 'true',
          'Chennakrishna Iyer:2 The Baby family:2 The Idaveli household:0 The Nair family:1 '
          || 'The Pillai household:1 The Raman family:0',
          'guest,host_manual', '0', 'attending|1|guest', '0', 'true', 'guest', '7']::text[]);

  -- Z6 the document history the links are pinned into. Four frozen versions, of which one was frozen during
  -- a takedown and could not be sent until the wedding had a document again; four publication rows of which
  -- exactly one is live, and the arithmetic of the rest is group P's and group Qb's own, exported.
  PERFORM pg_temp.s8b_eq('Z6 the document half: four frozen versions on the tested wedding numbered exactly '
    'one through four, the live draft carrying the line group Qb1 froze into version 4, one active '
    'publication naming version 4, the publication count the number group Q measured plus that one and every '
    'other publication row of this wedding revoked rather than deleted, the corrected welcome line present '
    'in exactly one frozen snapshot, and the other wedding still published at its own first version',
    ARRAY[(SELECT count(*)::text FROM public.invitation_versions x
            WHERE x.wedding_id = s.wed_a),
          (SELECT string_agg(u.n, ',' ORDER BY u.n)
             FROM (SELECT DISTINCT x.version_number::text AS n
                     FROM public.invitation_versions x
                    WHERE x.wedding_id = s.wed_a) u),
          (SELECT (d.content ->> 'welcome') FROM public.invitation_drafts d
            WHERE d.wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.publications p
            WHERE p.wedding_id = s.wed_a AND p.status = 'active'),
          (SELECT v.version_number::text FROM public.publications p
             JOIN public.invitation_versions v ON v.id = p.version_id
            WHERE p.wedding_id = s.wed_a AND p.status = 'active'),
          ((SELECT count(*) FROM public.publications p WHERE p.wedding_id = s.wed_a)
           = (current_setting('s8b.pub_total_then')::bigint + 1))::text,
          ((SELECT count(*) FROM public.publications p
              WHERE p.wedding_id = s.wed_a AND p.status = 'revoked')
           = current_setting('s8b.pub_total_then')::bigint)::text,
          (SELECT count(*)::text FROM public.invitation_versions x
            WHERE x.wedding_id = s.wed_a
              AND x.snapshot::text LIKE '%' || current_setting('s8b.mk_draft4') || '%'),
          (SELECT count(*)::text FROM public.publications p
            WHERE p.wedding_id = s.wed_b AND p.status = 'active'),
          (SELECT v.version_number::text FROM public.publications p
             JOIN public.invitation_versions v ON v.id = p.version_id
            WHERE p.wedding_id = s.wed_b AND p.status = 'active')]::text[],
    ARRAY['4', '1,2,3,4', current_setting('s8b.mk_draft4'), '1', '4',
          'true', 'true', '1', '1', '1']::text[]);

  -- Z7 the refusals, declared and counted together. Every one of these ran — `run()` refuses an empty group
  -- and refuses a probe that returns no error — but the census is here because a group whose rows were
  -- deleted, or whose `run()` was never reached, would otherwise leave the file green and thinner.
  PERFORM pg_temp.s8b_eq('Z7 the probe census for the whole file, declared and measured together: '
    'fifty-six refusals in eight groups — the shape storm ran twice over the same twenty-two bodies so a '
    'live header and an absent one are both covered, MA1 22 and MA2 22; the write-authority groups MR1 2, '
    'MR2 1, MR3 1 and MR4 3; the three referential refusals QF; and the two minting refusals QB — with one '
    'name per group, every row pinning both a state and a message, and no probe sharing a label with '
    'another',
    ARRAY[(SELECT count(*)::text FROM probes),
          (SELECT count(DISTINCT grp)::text FROM probes),
          (SELECT count(DISTINCT grp || '/' || label)::text FROM probes),
          (SELECT coalesce(string_agg(g.grp || ':' || g.n, ' ' ORDER BY g.grp COLLATE "C"), '-')
             FROM (SELECT p.grp AS grp, count(*)::text AS n FROM probes p GROUP BY p.grp) g),
          (SELECT count(*)::text FROM probes p
            WHERE p.want_state IS NULL OR p.want_like IS NULL
               OR p.stmt IS NULL OR p.label IS NULL)]::text[],
    ARRAY['56', '8', '56',
          'MA1:22 MA2:22 MR1:2 MR2:1 MR3:1 MR4:3 QB:2 QF:3', '0']::text[]);

  -- Z8 the three secrets the next tiers have to work with. A raw is legible once, at the answer that
  -- minted it, so a battery that mints a credential and then withdraws it has handed the following tiers
  -- nothing usable — these three are the residue the HTTP and browser tiers can be written against, and
  -- each is checked here against the row it digests into, and at the door it is supposed to open.
  --
  -- The last arm counts the disabled events of the *whole* wedding rather than the three the cast names.
  -- That is the tighter of the two claims and it is safe to make: battery 1's fixture inserts exactly three
  -- events for this wedding, two live and the farewell switched off, and nothing in this file writes the
  -- `enabled` column at all, so the only way this arm can read other than 1 is an implementation that
  -- disabled a card on its own. A cast-scoped count could not see that.
  PERFORM pg_temp.s8b_eq('Z8 the residue the next tier reads: the three secrets group Qb minted are each 43 '
    'octets of the declared alphabet and all three distinct, each digests to exactly one credential row of '
    'this wedding, the two household secrets open their own household and nothing else, the wedding secret '
    'opens the document door, and no household secret opens it — and the wedding still has exactly the one '
    'switched-off ceremony battery 1 wrote, so nothing here silently hid a card from a guest — so the HTTP '
    'battery can name these three strings without minting a fourth',
    ARRAY[octet_length(current_setting('s8b.raw_baby4'))::text,
          octet_length(current_setting('s8b.raw_pillai4'))::text,
          octet_length(current_setting('s8b.raw_wed4'))::text,
          (SELECT count(DISTINCT u.r)::text FROM unnest(ARRAY[
              current_setting('s8b.raw_baby4'), current_setting('s8b.raw_pillai4'),
              current_setting('s8b.raw_wed4')]) u(r)
            WHERE u.r ~ '^[A-Za-z0-9_-]{43}$'),
          (SELECT count(*)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.revoked_at IS NULL
              AND t.token_hash IN (
                encode(extensions.digest(convert_to(current_setting('s8b.raw_baby4'), 'UTF8'), 'sha256'), 'hex'),
                encode(extensions.digest(convert_to(current_setting('s8b.raw_pillai4'), 'UTF8'), 'sha256'), 'hex'),
                encode(extensions.digest(convert_to(current_setting('s8b.raw_wed4'), 'UTF8'), 'sha256'), 'hex'))),
          ((pg_temp.s8b_door(current_setting('s8b.raw_baby4')) -> 'guest' ->> 'household_id')::uuid
            = s.hh_baby)::text,
          ((pg_temp.s8b_door(current_setting('s8b.raw_pillai4')) -> 'guest' ->> 'household_id')::uuid
            = current_setting('s8b.hh_pillai')::uuid)::text,
          (pg_temp.s8b_public_door(current_setting('s8b.raw_wed4')) ->> 'available'),
          (pg_temp.s8b_public_door(current_setting('s8b.raw_baby4')) ? 'invitation')::text,
          (SELECT count(*)::text FROM public.wedding_events e
            WHERE e.wedding_id = s.wed_a AND NOT e.enabled)]::text[],
    ARRAY['43', '43', '43', '3', '3', 'true', 'true', 'true', 'false', '1']::text[]);

  PERFORM pg_temp.s8b_send(NULL);
END $Z$;

-- --------------------------------------------------------------------------- L: the floor
-- The floor is the authored count at this head, not a rounded-down guess. It exists so that a skipped group —
-- a `DO` block that never ran, a probe group whose rows were deleted — cannot read as a pass, and the
-- assertion is made *through* the counter so the printed total and the observed PASS lines cannot drift apart.
--
-- 184 is the number of assertions this file declares before the floor line itself, counted mechanically
-- rather than estimated, against the file as it stands at this head — the three splits this qualification
-- introduced (X9 into X9 and X9b, A4 into A4a and A4b, A6 into A6a and A6b) each add one to the 181 that
-- was authored with the file. The reason for those splits is stated once at A4 and re-used below: every
-- expression of one SQL statement sees the snapshot taken when that statement began, so an assertion that
-- puts a table-writing door call and a reading of what that call must have left together measures the
-- pre-call state for the reading, whatever the door did. The instrument has to be anchored to the start of
-- a statement rather than a plain substring search: a substring search also matches prose that quotes the
-- call, so the count would move every time someone explained it. Anchored, a comment line can never match,
-- and the numbers below can be re-taken and are expected to reproduce:
--
--   grep -cE '^[[:space:]]*PERFORM pg_temp\.s8b_eq\('        -> 125, of which one is the call inside
--                                                             `pg_temp.s8b_has_keys`'s own body, so 124
--                                                             direct equalities
--   grep -cE '^[[:space:]]*PERFORM pg_temp\.s8b_has_keys\('  ->   4, each incrementing once through that
--                                                             inner call
--   grep -cE '^[[:space:]]*PERFORM pg_temp\.s8b_ok\('        ->   1, and that one is the L1 pass below: the
--                                                             helper has no other use in this file, which
--                                                             is why it is still defined
--
-- The hazard is not hypothetical — it is this comment's own first draft, which quoted the three patterns
-- verbatim and so counted itself: that form returned 123, 5 and 2, each too high by exactly the line that
-- quoted it, and a floor read from those numbers would have been one assertion larger than the file really
-- runs. Those three are named as what the unanchored form produced *then*, not as a command to re-run now;
-- in the version you are reading the quoted patterns are written escaped, so an unanchored search of the
-- literal call text no longer matches them and the two forms agree at this head. The anchor is kept because
-- it is the form prose cannot move, not because the two currently disagree.
--
-- The refusals are not a grep number at all. Probe rows are built in loops and multi-row `VALUES` chains, so
-- their count is read from the `probes` table rather than from the text, and group Z7 pins that census: 56
-- rows, distributed MA1:22 MA2:22 MR1:2 MR2:1 MR3:1 MR4:3 QB:2 QF:3, which sums to the same 56. Each of the
-- seven `run()` groups counts one assertion per probe row it runs.
--
-- 124 + 4 + 56 = 184, and this L1 pass is the 185th assertion the closing line reports. The arithmetic is
-- written out because a bare number in a floor would have to be re-derived by hand anyway; the first run
-- prints its own total one line below, and if the two disagree the difference is a group that did not run —
-- the repair is to find that group, not to move this number.
DO $L$
DECLARE ran integer;
BEGIN
  ran := coalesce(nullif(current_setting('s8b.passed', true), ''), '0')::int;
  IF ran < 184 THEN
    RAISE EXCEPTION 'FAIL: only % Stage 8 RSVP assertions ran — the authored floor is 184 (the closing line '
      'reports one more, this L1 assertion itself)', ran;
  END IF;
  PERFORM pg_temp.s8b_ok('L1 the counter, the fixtures and the floor all moved together ('
    || ran || ' assertions)', true);
END $L$;

SELECT 'STAGE8 GUEST RSVP TESTS PASSED (' || current_setting('s8b.passed') || ')';
