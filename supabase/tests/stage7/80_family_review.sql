-- Stage 7 battery 1: the workflow itself — the host's ask, the reviewer's door, the answer, and
-- every way a credential can stop being valid.
--
-- Run by `supabase/tests/stage7/run.sh` after the storage fixture, the published migrations and the
-- whole stage chain through Stage 7, as the superuser, in one transaction that commits.
--
--   F  the fixture's own shape, asserted first: a battery reading an empty schema would print
--      everything below it as a pass
--   A  the ask (§2.1) — what one call writes, what it returns, and what it refuses to write
--   B  who may ask at all (§2.1, §9) — cross-wedding, cross-version, signed-out, anonymous, service
--   D  the open (§3.2) — the envelope, the document, the vocabulary, the timestamp
--   K  credential refusal at the door — malformed, truncated, wrong alphabet, forged, absent
--   V  the answer's payload rules (§5) — the eight that run before the credential is read at all
--   W  the two that can only run after it, and the closed refusal a dead link gives instead
--   S  an approval, recorded once
--   N  a request for changes, pinned to a section that exists
--   X  withdrawal (§2.2)
--   E  expiry, reached by moving the clock rather than by waiting
--   O  one live credential per request (§10)
--   I  I-12 (§6) — a successor version closes the predecessor's open asks, and does not touch the
--      guest link
--   Q  the host's queue (§2.3) — the answers, the link states, and no credential
--   R  residue, scoped to the weddings this file created
--   L  the floor
--
-- Where a refusal is measured it is measured twice: the SQLSTATE and the sentence. A bare SQLSTATE
-- is not evidence — this repository has already scored a psql syntax error as a security refusal,
-- because `left(...,5)` cannot tell 42601 from 42501. So every probe below carries the phrase the
-- product chose, and `run()` fails a probe that returns no error at all rather than counting it as
-- a refusal that never happened.
--
-- The role discipline is the point, not decoration: the host's verbs run as `authenticated` with
-- `test.uid` naming the account, and both doors run as `anon`, which is the only role an
-- account-free reviewer can ever be. Every group that measures a refusal also measures the
-- neighbouring acceptance through the same role, so a refusal is about the credential or the caller
-- and not about how the statement was addressed.
--
-- Values that a probe needs while it holds a role are carried in `s7f.*` settings rather than read
-- from `pg_temp`, for the reason `stage3/30_publication.sql` records: an impersonated role cannot
-- see this file's temp fixture.

SET client_min_messages = notice;
SELECT set_config('s7f.passed', '0', false);

CREATE FUNCTION pg_temp.s7f_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s7f.passed',
    (coalesce(nullif(current_setting('s7f.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s7f_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s7f_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s7f_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s7f_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s7f_sorted(want text[]) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM unnest(coalesce(want, '{}'::text[])) u(k) $fn$;

CREATE FUNCTION pg_temp.s7f_top_keys(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM jsonb_object_keys(v) u(k) $fn$;

CREATE FUNCTION pg_temp.s7f_has_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % , not an object', label, jsonb_typeof(v);
  END IF;
  PERFORM pg_temp.s7f_eq(label, pg_temp.s7f_top_keys(v), pg_temp.s7f_sorted(want));
END $fn$;

-- A jsonb array of names read as a sorted set. `resolve_family_review` builds `section_keys` with
-- `array_agg(DISTINCT …)` and no ORDER BY, so the order it happens to produce is not a contract;
-- the set is. Comparing sorted arrays keeps the assertion honest about which half it is testing.
CREATE FUNCTION pg_temp.s7f_arr(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT pg_temp.s7f_sorted(coalesce(array_agg(q.e), '{}'::text[]))
    FROM jsonb_array_elements_text(coalesce(v, '[]'::jsonb)) q(e) $fn$;

-- How many rows a caller can actually see, measured as that caller.
CREATE FUNCTION pg_temp.s7f_visible(role text, uid uuid, select_sql text) RETURNS bigint
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

CREATE FUNCTION pg_temp.s7f_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

CREATE FUNCTION pg_temp.s7f_run(p_grp text, p_role text, p_uid text) RETURNS void
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
            FROM probes p WHERE p.grp = s7f_run.p_grp ORDER BY p.label) s;

  IF v_labels IS NULL THEN
    RAISE EXCEPTION 'FAIL: probe group % ran no probes — an empty group is a skip, not a pass', p_grp;
  END IF;

  FOR i IN 1 .. cardinality(v_labels) LOOP
    EXECUTE 'SET ROLE ' || p_role;
    IF p_uid IS NOT NULL THEN
      PERFORM set_config('test.uid', p_uid, false);
    END IF;
    v := pg_temp.s7f_err(v_stmts[i]);
    EXECUTE 'RESET ROLE';

    IF v = 'no-error' THEN
      RAISE EXCEPTION 'FAIL %: "%" was allowed through', p_grp, v_labels[i];
    END IF;
    IF split_part(v, ' ', 1) <> v_states[i] OR v NOT LIKE v_likes[i] THEN
      RAISE EXCEPTION 'FAIL %: "%" got [%] want [% / %]',
        p_grp, v_labels[i], v, v_states[i], v_likes[i];
    END IF;
    RAISE NOTICE 'PASS %: %', p_grp, v_labels[i];
    PERFORM pg_temp.s7f_add(1);
  END LOOP;
END $fn$;

-- A host verb called by the account that owns the wedding, with the answer handed back. A refusal
-- inside this helper is a failure of the battery, not a measured answer: refusals are group B's job.
CREATE FUNCTION pg_temp.s7f_auth(uid text, stmt text) RETURNS jsonb
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

-- The review door as an account-free visitor experiences it: the header PostgREST itself writes, the
-- zero-argument resolver, the `anon` role. `raw IS NULL` sends no header at all, which is how the
-- missing-credential branch is reached without inventing a value for it.
CREATE FUNCTION pg_temp.s7f_open(raw text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.headers',
    CASE WHEN raw IS NULL THEN '{}'::text
         ELSE jsonb_build_object('x-review-token', raw)::text END, false);
  EXECUTE 'SET ROLE anon';
  BEGIN
    SELECT api.resolve_family_review() INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $fn$;

-- The answer door. The credential is a header here too, never an argument — which is the shape this
-- stage's whole claim rests on, so the helper cannot express it any other way.
CREATE FUNCTION pg_temp.s7f_answer(raw text, decision text, label text,
                                  message text, section_key text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.headers',
    CASE WHEN raw IS NULL THEN '{}'::text
         ELSE jsonb_build_object('x-review-token', raw)::text END, false);
  EXECUTE 'SET ROLE anon';
  BEGIN
    EXECUTE 'SELECT api.submit_family_review('
      || quote_nullable(decision) || ',' || quote_nullable(label) || ','
      || quote_nullable(message) || ',' || quote_nullable(section_key) || ')' INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $fn$;

-- Header only, for the groups whose statements must raise: `run()` owns the role and the probe text,
-- so this file sets the credential those probes are answered with.
CREATE FUNCTION pg_temp.s7f_send(raw text) RETURNS void
LANGUAGE sql AS $fn$
  SELECT set_config('request.headers',
    CASE WHEN raw IS NULL THEN '{}'::text
         ELSE jsonb_build_object('x-review-token', raw)::text END, false) $fn$;

-- The guest door, used twice: once to show a published invitation answers before Stage 7's
-- invalidation sweep runs, once to show it still answers afterwards.
CREATE FUNCTION pg_temp.s7f_guest_open(raw text) RETURNS jsonb
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

-- The scan that backs "a raw token never enters a database record": every text-shaped column of
-- every base table in the two schemas the product owns, not merely the two columns this stage
-- writes. There is deliberately no exception handler — a relation this cannot read is a broken
-- fixture and must stop the run rather than be skipped into a quiet pass.
CREATE FUNCTION pg_temp.s7f_stored_hits(raw text) RETURNS text[]
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
CREATE TEMP TABLE s7r ON COMMIT DROP AS
SELECT gen_random_uuid() AS owner_a, gen_random_uuid() AS owner_b,
       gen_random_uuid() AS wed_a, gen_random_uuid() AS wed_b, gen_random_uuid() AS wed_empty;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT s.owner_a, 's7-owner-a@example.test', '{}'::jsonb FROM s7r s
UNION ALL SELECT s.owner_b, 's7-owner-b@example.test', '{}'::jsonb FROM s7r s;

INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages,
                             style_settings)
-- The jsonb literals are cast explicitly because these rows are built by a SELECT over `s7r`, and
-- Postgres resolves a bare literal in a SELECT list as text rather than as the INSERT target's
-- type; the `raw_user_meta_data` rows above already carry their cast for the same reason.
SELECT s.wed_a, s.owner_a, 'Asha weds Bala', 'en', ARRAY['ta'],
       '{"font":"Playfair Display","fontSize":"24","color":"#C9972F","alignment":"center"}'::jsonb
  FROM s7r s
UNION ALL
SELECT s.wed_b, s.owner_b, 'Bala weds Divya', 'ta', ARRAY[]::text[],
       '{"font":"Mukta Malar","fontSize":"20","color":"#7a1f1f","alignment":"left"}'::jsonb
  FROM s7r s
UNION ALL
SELECT s.wed_empty, s.owner_a, 'Nothing Asked', 'en', ARRAY[]::text[],
       '{"font":"Playfair Display","fontSize":"24","color":"#C9972F","alignment":"center"}'::jsonb
  FROM s7r s;

-- The invited people, the venue and the events are here because the review payload has to be a real
-- document: a reviewer shown an empty invitation proves nothing about what a reviewer is shown.
INSERT INTO public.wedding_people (wedding_id, display_name, role_key, role_label,
                                   group_key, group_label, display_order)
SELECT s.wed_a, 'Maran', 'father', 'Father', 'bride-side', 'The families of', 0 FROM s7r s
UNION ALL
SELECT s.wed_a, 'Kovalan', 'groom', 'Groom', 'bride-side', 'The families of', 1 FROM s7r s
UNION ALL
SELECT s.wed_b, 'Sivan', 'father', 'Father', 'groom-side', 'The families of', 0 FROM s7r s
UNION ALL
SELECT s.wed_b, 'Vallu', 'bride', 'Bride', 'groom-side', 'The families of', 1 FROM s7r s;

INSERT INTO public.venues (wedding_id, name, address_text)
SELECT s.wed_a, 'Kalyana Mantapa', '1 Museum Road, Madurai' FROM s7r s
UNION ALL
SELECT s.wed_b, 'Beach Hall', '2 Coast Road, Rameswaram' FROM s7r s;

INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local,
                                   display_order, venue_id)
SELECT s.wed_a, 'muurtham', 'Muurtham', '2026-11-14 07:30', 0, v.id
  FROM s7r s JOIN public.venues v ON v.wedding_id = s.wed_a;

INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local, display_order)
SELECT s.wed_a, 'reception', 'Reception', '2026-11-14 18:00', 1 FROM s7r s;

INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local,
                                   display_order, venue_id)
SELECT s.wed_b, 'haldi', 'Haldi', '2026-12-02 09:00', 0, v.id
  FROM s7r s JOIN public.venues v ON v.wedding_id = s.wed_b;

-- A named guest household: `90_review_boundary.sql` proves a reviewer is never shown it, and that
-- proof needs a value that could have leaked.
INSERT INTO public.guest_households (id, wedding_id, display_name, salutation)
SELECT gen_random_uuid(), s.wed_a, 'The Raman family', 'Dear Raman family' FROM s7r s;

UPDATE public.invitation_drafts d SET content =
  '{"welcome":"With the blessings of our families","family_introduction":"Our families invite you",
    "event_notes":"Lunch follows the ceremony","closing":"With love"}'::jsonb
  FROM s7r s WHERE d.wedding_id = s.wed_a;

UPDATE public.invitation_drafts d SET content =
  '{"welcome":"Invoker words","family_introduction":"Our families invite you",
    "event_notes":"Meals follow","closing":"Nandri"}'::jsonb
  FROM s7r s WHERE d.wedding_id = s.wed_b;

SELECT set_config('s7f.v1', '', false);
SELECT set_config('s7f.v2', '', false);
SELECT set_config('s7f.wed_b_v1', '', false);
SELECT set_config('s7f.guest_raw', '', false);

-- --------------------------------------------------------------------------- F: the fixture
DO $F$
DECLARE s s7r%ROWTYPE; v jsonb;
BEGIN
  SELECT * INTO s FROM s7r;
  PERFORM set_config('s7f.wed_a', s.wed_a::text, false);
  PERFORM set_config('s7f.wed_b', s.wed_b::text, false);
  PERFORM set_config('s7f.wed_empty', s.wed_empty::text, false);

  v := pg_temp.s7f_auth(s.owner_a::text,
    'SELECT api.create_invitation_version(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM set_config('s7f.v1', v ->> 'version_id', false);
  v := pg_temp.s7f_auth(s.owner_a::text,
    'SELECT api.create_invitation_version(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM set_config('s7f.v2', v ->> 'version_id', false);
  v := pg_temp.s7f_auth(s.owner_b::text,
    'SELECT api.create_invitation_version(' || quote_literal(s.wed_b::text) || '::uuid)');
  PERFORM set_config('s7f.wed_b_v1', v ->> 'version_id', false);

  PERFORM pg_temp.s7f_eq('F0 this battery''s wedding holds exactly two versions, numbered 1 and 2 — '
    'every version assertion below reads one of these two',
    (SELECT array_agg(version_number::text ORDER BY version_number)
       FROM public.invitation_versions WHERE wedding_id = s.wed_a),
    ARRAY['1','2']::text[]);
  PERFORM pg_temp.s7f_eq('F1 both are NO-PACK snapshots — the section vocabulary this file expects is '
    'the hand-authored one, and a pack would change it',
    (SELECT count(*) FROM public.invitation_versions
      WHERE wedding_id = s.wed_a AND tradition_pack_release_id IS NULL), 2::bigint);
  PERFORM pg_temp.s7f_eq('F2 the frozen document has six sections to review at all — a door opened on '
    'an empty document would prove nothing about what a reviewer sees',
    (SELECT jsonb_array_length(snapshot -> 'sections' -> 'items')
       FROM public.invitation_versions WHERE id = current_setting('s7f.v1')::uuid), 6);
  PERFORM pg_temp.s7f_eq('F3 the stranger owns the other wedding, which is what makes group B a '
    'cross-tenant test rather than a test of a row nobody claims',
    (SELECT owner_user_id FROM public.weddings WHERE id = s.wed_b), s.owner_b);
END $F$;

-- --------------------------------------------------------------------------- A: the ask
DO $A$
DECLARE s s7r%ROWTYPE; v jsonb; w jsonb;
BEGIN
  SELECT * INTO s FROM s7r;

  -- Padded on purpose: the name the host types is not the name the record keeps.
  v := pg_temp.s7f_auth(s.owner_a::text,
    'SELECT api.request_family_review(' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s7f.v1')) || '::uuid, ''  Mother-in-law  '', NULL)');

  PERFORM pg_temp.s7f_has_keys('A1 one ask answers with three names and no fourth', v,
    ARRAY['request_id', 'review_token', 'expires_at']);
  PERFORM pg_temp.s7f_eq('A2 the credential is 43 octets — 256 bits, base64url without padding, so a '
    'reviewer''s URL needs no escaping', octet_length(v ->> 'review_token'), 43);
  PERFORM pg_temp.s7f_ok('A2b and it is inside the alphabet the door accepts, so the shape check is '
    'not refusing the product''s own tokens', (v ->> 'review_token') ~ '^[A-Za-z0-9_-]+$');
  PERFORM pg_temp.s7f_eq('A3 §2.1: the name is stored trimmed — "  Mother-in-law  " becomes what a '
    'queue can read',
    (SELECT reviewer_display_name FROM public.approval_requests
      WHERE id = (v ->> 'request_id')::uuid), 'Mother-in-law');
  PERFORM pg_temp.s7f_ok('A4 §1: the default window is fourteen days, measured against the request''s '
    'own timestamp rather than described',
    (SELECT r.requested_at + interval '14 days' = t.expires_at
       FROM public.approval_requests r
       JOIN private.access_tokens t ON t.approval_request_id = r.id
      WHERE r.id = (v ->> 'request_id')::uuid));
  PERFORM pg_temp.s7f_eq('A5 the credential carries exactly the instant the response reported, so the '
    'link and the ask cannot disagree about when they die',
    (SELECT count(*) FROM private.access_tokens
      WHERE approval_request_id = (v ->> 'request_id')::uuid
        AND expires_at = (v ->> 'expires_at')::timestamptz), 1::bigint);
  PERFORM pg_temp.s7f_eq('A6 §2.4: no reviewer contact detail is written anywhere — the column stays '
    'NULL, which is a privacy decision, not an omission',
    (SELECT reviewer_contact_text FROM public.approval_requests
      WHERE id = (v ->> 'request_id')::uuid), NULL::text);
  PERFORM pg_temp.s7f_eq('A7 exactly one token row exists for this request, of the kind Stage 2 '
    'reserved and four stages left unused',
    (SELECT token_kind FROM private.access_tokens
      WHERE approval_request_id = (v ->> 'request_id')::uuid), 'approval_review');
  PERFORM pg_temp.s7f_ok('A7b and it is born live and unopened',
    (SELECT revoked_at IS NULL AND last_used_at IS NULL FROM private.access_tokens
      WHERE approval_request_id = (v ->> 'request_id')::uuid));
  PERFORM pg_temp.s7f_ok('A8 only the digest is stored, and it is the digest of the exact string the '
    'host was shown',
    (SELECT token_hash = encode(extensions.digest(convert_to(v ->> 'review_token', 'UTF8'),
                                                   'sha256'), 'hex')
       FROM private.access_tokens WHERE approval_request_id = (v ->> 'request_id')::uuid));
  PERFORM pg_temp.s7f_eq('A8b and the raw string appears in no column of no row of either schema — '
    'the scan covers every text-shaped column, not only the ones this stage writes',
    pg_temp.s7f_stored_hits(v ->> 'review_token'), '{}'::text[]);
  PERFORM pg_temp.s7f_ok('A8c the stored half is 64 lowercase hex and the raw string is nowhere in it '
    '— the column can only hold a digest shape, so a future writer cannot store a secret here by '
    'accident',
    (SELECT token_hash ~ '^[0-9a-f]{64}$' AND octet_length(token_hash) = 64
       FROM private.access_tokens WHERE approval_request_id = (v ->> 'request_id')::uuid));
  -- Read out of the catalog rather than demonstrated by a bad insert: the assertion below names the
  -- constraint that makes the line above a rule of the schema instead of a habit of this function.
  PERFORM pg_temp.s7f_eq('A8d and that shape is a CHECK on the column, in the catalog, at this head',
    (SELECT count(*) FROM pg_constraint
      WHERE conrelid = 'private.access_tokens'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%token_hash%^[0-9a-f%'), 1::bigint);
  PERFORM pg_temp.s7f_eq('A8e and the digest is UNIQUE across the whole credential store, so no two '
    'links can ever point at the same record',
    (SELECT count(*) FROM pg_constraint
      WHERE conrelid = 'private.access_tokens'::regclass AND contype = 'u'
        AND pg_get_constraintdef(oid) LIKE '%token_hash%'), 1::bigint);

  PERFORM pg_temp.s7f_ok('A9 §2.1: the credential pins the whole triple — wedding, request, and the '
    'version the host was looking at when they asked',
    (SELECT t.wedding_id = r.wedding_id AND t.approval_version_id = r.version_id
       FROM private.access_tokens t
       JOIN public.approval_requests r ON r.id = t.approval_request_id
      WHERE r.id = (v ->> 'request_id')::uuid));

  -- Two relatives, one document: the ask is per-person, not per-version.
  w := pg_temp.s7f_auth(s.owner_a::text,
    'SELECT api.request_family_review(' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s7f.v1')) || '::uuid, ''Brother'', NULL)');
  PERFORM pg_temp.s7f_ok('A10 a second ask about the same version is a second ask, not an error — a '
    'host may want two relatives'' eyes on one draft', (w ->> 'request_id') <> (v ->> 'request_id'));
  PERFORM pg_temp.s7f_ok('A10b and the two credentials differ, because each is minted fresh',
    (w ->> 'review_token') <> (v ->> 'review_token'));
  PERFORM pg_temp.s7f_eq('A11 both requests are pending and each holds exactly one live credential',
    (SELECT count(*) FROM public.approval_requests r
      WHERE r.wedding_id = s.wed_a AND r.status = 'pending'
        AND (SELECT count(*) FROM private.access_tokens t
              WHERE t.approval_request_id = r.id
                AND t.token_kind = 'approval_review' AND t.revoked_at IS NULL) = 1),
    2::bigint);

  PERFORM set_config('s7f.req1', v ->> 'request_id', false);
  PERFORM set_config('s7f.tok1', v ->> 'review_token', false);
  PERFORM set_config('s7f.req2', w ->> 'request_id', false);
  PERFORM set_config('s7f.tok2', w ->> 'review_token', false);
END $A$;

-- --------------------------------------------------------------------------- B: who may ask
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('B', 'a wedding the caller does not own cannot be asked about',
   $t$SELECT api.request_family_review(current_setting('s7f.wed_b')::uuid,
        (SELECT id FROM public.invitation_versions
          WHERE wedding_id = current_setting('s7f.wed_b')::uuid), 'Someone else', NULL)$t$,
   '42501', '%the caller may not ask for a review of this wedding%'),
  ('B', 'a wedding that does not exist is the same refusal, not a different one',
   $t$SELECT api.request_family_review(gen_random_uuid(), gen_random_uuid(), 'Stranger', NULL)$t$,
   '42501', '%the caller may not ask for a review of this wedding%'),
  ('B2', '§2.1: a version belonging to another wedding is refused in its own words, before the '
    'foreign key gets to describe the database to the caller',
   $t$SELECT api.request_family_review(current_setting('s7f.wed_a')::uuid,
        current_setting('s7f.wed_b_v1')::uuid, 'Wrong family', NULL)$t$,
   '42501', '%that version is not a version of this wedding%'),
  ('B3', 'a signed-out caller cannot ask at all',
   $t$SELECT api.request_family_review(current_setting('s7f.wed_a')::uuid,
        current_setting('s7f.v1')::uuid, 'Nobody', NULL)$t$,
   '42501', '%the caller may not ask for a review of this wedding%'),
  ('B4', 'an anonymous caller has no EXECUTE on the host verb',
   $t$SELECT api.request_family_review(current_setting('s7f.wed_a')::uuid,
        current_setting('s7f.v1')::uuid, 'Anonymous', NULL)$t$,
   '42501', '%permission denied for function request_family_review%'),
  ('B4', 'nor on the withdrawal verb',
   $t$SELECT api.revoke_family_review(current_setting('s7f.req1')::uuid)$t$,
   '42501', '%permission denied for function revoke_family_review%'),
  ('B4', 'nor on the queue read',
   $t$SELECT api.get_approval_requests(current_setting('s7f.wed_a')::uuid)$t$,
   '42501', '%permission denied for function get_approval_requests%'),
  ('B5', '§9: service_role is not a browser and has no path through `api`',
   $t$SELECT api.request_family_review(current_setting('s7f.wed_a')::uuid,
        current_setting('s7f.v1')::uuid, 'Machine', NULL)$t$,
   '42501', '%permission denied for schema api%'),
  ('B5', '§9: nor through `internal_api` — the privileged half is not a service surface either',
   $t$SELECT internal_api.request_family_review(current_setting('s7f.wed_a')::uuid,
        current_setting('s7f.v1')::uuid, 'Machine', NULL)$t$,
   '42501', '%permission denied for schema internal_api%'),
  ('B6', 'a reviewer with no name is refused before anything is written',
   $t$SELECT api.request_family_review(current_setting('s7f.wed_a')::uuid,
        current_setting('s7f.v1')::uuid, '   ', NULL)$t$,
   '23514', '%name the reviewer you are asking%'),
  ('B6', 'and a name of NULL is the same refusal as an empty one',
   $t$SELECT api.request_family_review(current_setting('s7f.wed_a')::uuid,
        current_setting('s7f.v1')::uuid, NULL, NULL)$t$,
   '23514', '%name the reviewer you are asking%'),
  ('B6', 'a name too long to display is refused, not truncated',
   $t$SELECT api.request_family_review(current_setting('s7f.wed_a')::uuid,
        current_setting('s7f.v1')::uuid, repeat('n', 121), NULL)$t$,
   '23514', '%that reviewer name is too long to record%'),
  ('B6', 'an expiry in the past is refused — a link born dead is a bug dressed as a feature',
   $t$SELECT api.request_family_review(current_setting('s7f.wed_a')::uuid,
        current_setting('s7f.v1')::uuid, 'Yesterday',
        now() - interval '1 hour')$t$,
   '23514', '%a review link must be given a time in the future%');

DO $B$
DECLARE s s7r%ROWTYPE; n_before bigint;
BEGIN
  SELECT * INTO s FROM s7r;
  n_before := (SELECT count(*) FROM public.approval_requests);

  PERFORM pg_temp.s7f_run('B',  'authenticated', s.owner_a::text);
  PERFORM pg_temp.s7f_run('B2', 'authenticated', s.owner_a::text);
  PERFORM pg_temp.s7f_run('B3', 'authenticated', '');
  PERFORM pg_temp.s7f_run('B4', 'anon',          s.owner_a::text);
  PERFORM pg_temp.s7f_run('B5', 'service_role',  NULL);
  PERFORM pg_temp.s7f_run('B6', 'authenticated', s.owner_a::text);

  PERFORM pg_temp.s7f_eq('B7 thirteen refusals and not one request row written — every refusal '
    'happens before the INSERT, so a rejected ask leaves no trace',
    (SELECT count(*) FROM public.approval_requests), n_before);
  PERFORM pg_temp.s7f_eq('B8 the caller refused another family''s wedding could not read that '
    'family''s draft either — the same answer RLS gives',
    pg_temp.s7f_visible('authenticated', s.owner_a,
      'SELECT * FROM public.weddings WHERE id = ' || quote_literal(s.wed_b::text)), 0::bigint);
  PERFORM pg_temp.s7f_eq('B9 and the stranger sees none of this battery''s review requests — the '
    'queue is not the only wall, RLS is',
    pg_temp.s7f_visible('authenticated', s.owner_b, 'SELECT * FROM public.approval_requests'),
    0::bigint);
END $B$;

-- --------------------------------------------------------------------------- D: the open
DO $D$
DECLARE v jsonb; r jsonb;
BEGIN
  v := pg_temp.s7f_open(current_setting('s7f.tok1'));

  PERFORM pg_temp.s7f_has_keys('D1 the door answers with two names and no third', v,
    ARRAY['available', 'review']);
  PERFORM pg_temp.s7f_eq('D2 and it says the review is available', (v -> 'available')::boolean, true);
  r := v -> 'review';
  PERFORM pg_temp.s7f_has_keys('D3 the review block is seven named things — the ask, the document and '
    'the vocabulary, and nothing else', r,
    ARRAY['expires_at', 'invitation', 'request_id', 'requested_at', 'reviewer_display_name',
          'section_keys', 'version_number']);
  PERFORM pg_temp.s7f_eq('D4 it names the reviewer the host typed, so an answer can be read against '
    'the ask it belongs to', r ->> 'reviewer_display_name', 'Mother-in-law');
  PERFORM pg_temp.s7f_eq('D5 it reports the version the ask was pinned to, not the newest one',
    r ->> 'version_number', '1');
  PERFORM pg_temp.s7f_eq('D6 and the request it answers is the request this credential was minted for',
    r ->> 'request_id', current_setting('s7f.req1'));
  PERFORM pg_temp.s7f_ok('D7 the expiry the host was told is the expiry the reviewer is told — one '
    'date, two views of it',
    (r ->> 'expires_at')::timestamptz =
      (SELECT expires_at FROM private.access_tokens
        WHERE approval_request_id = current_setting('s7f.req1')::uuid));
  PERFORM pg_temp.s7f_has_keys('D8 §4: the reviewer is handed the guest projection, exactly the twelve '
    'names a guest is handed — there is no second document shape', r -> 'invitation',
    ARRAY['title', 'language', 'style', 'design_template', 'tradition_pack', 'sections', 'people',
          'events', 'welcome', 'family_introduction', 'event_notes', 'closing']);
  PERFORM pg_temp.s7f_eq('D9 §3.2: the vocabulary a note may pin itself to is the six section keys of '
    'the frozen document being reviewed, compared as a set',
    pg_temp.s7f_arr(r -> 'section_keys'),
    ARRAY['ceremonies', 'closing', 'event_notes', 'family', 'family_introduction', 'welcome']);
  PERFORM pg_temp.s7f_ok('D10 the invitation is this wedding''s — the title the host wrote is in it',
    position('Asha weds Bala' in (r -> 'invitation')::text) > 0);
  PERFORM pg_temp.s7f_eq('D11 §3: opening the link stamps `last_used_at` — Stage 2 declared the column '
    'and this is the first thing in the product to use it',
    (SELECT count(*) FROM private.access_tokens
      WHERE approval_request_id = current_setting('s7f.req1')::uuid
        AND last_used_at IS NOT NULL), 1::bigint);
  PERFORM pg_temp.s7f_eq('D11b and it stamps only the credential that was used — the sibling ask on '
    'the same version is still unopened, so the trace names one link, not one family',
    (SELECT count(*) FROM private.access_tokens t
      WHERE t.token_kind = 'approval_review' AND t.last_used_at IS NOT NULL
        AND t.approval_request_id <> current_setting('s7f.req1')::uuid), 0::bigint);
  PERFORM pg_temp.s7f_ok('D12 the answer carries neither the credential it was given nor its digest',
    position(current_setting('s7f.tok1') in v::text) = 0
    AND position(encode(extensions.digest(convert_to(current_setting('s7f.tok1'), 'UTF8'),
                                          'sha256'), 'hex') in v::text) = 0);
  PERFORM pg_temp.s7f_ok('D13 §3: and it does not mention the other person the host asked — one '
    'reviewer cannot see who else is reviewing the same wedding',
    position('Brother' in v::text) = 0);
END $D$;

-- --------------------------------------------------------------------------- K: refusal at the door
-- Every one of these is an answer shape, not an error: the door does not tell a stranger why.
DO $K$
DECLARE v jsonb; w jsonb; tok1 text; forged text;
BEGIN
  tok1 := current_setting('s7f.tok1');
  -- 32 fresh bytes in the same alphabet, so it is a credential in every respect except existence.
  forged := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  PERFORM pg_temp.s7f_eq('K1 no header at all is {"available": false} and nothing else — the door does '
    'not explain that a link was expected',
    pg_temp.s7f_top_keys(pg_temp.s7f_open(NULL)), ARRAY['available']);
  PERFORM pg_temp.s7f_eq('K2 an empty header is refused the same way',
    (pg_temp.s7f_open('') -> 'available')::boolean, false);
  PERFORM pg_temp.s7f_ok('K2b and the refusal is a closed shape: one name, one value',
    (pg_temp.s7f_open(''))::text = '{"available": false}');
  PERFORM pg_temp.s7f_eq('K3 a real credential truncated to 42 characters is refused by the shape '
    'check before anything is hashed — a URL copied short is not a partial read',
    (pg_temp.s7f_open(left(tok1, 42)) -> 'available')::boolean, false);
  PERFORM pg_temp.s7f_eq('K4 a credential whose alphabet has been mangled is refused',
    (pg_temp.s7f_open(translate(tok1, 'abc', '!!!')) -> 'available')::boolean, false);
  PERFORM pg_temp.s7f_eq('K5 the stored *digest* presented as a credential is refused — the shape '
    'check alone rejects it, so a leaked database of hashes is not a set of links',
    (pg_temp.s7f_open(encode(extensions.digest(convert_to(tok1, 'UTF8'), 'sha256'), 'hex'))
       -> 'available')::boolean, false);
  PERFORM pg_temp.s7f_eq('K6 a well-formed 43-character credential that was never issued — a forgery — '
    'is refused, and refused identically to the junk above',
    (pg_temp.s7f_open(forged) -> 'available')::boolean, false);
  PERFORM pg_temp.s7f_eq('K7 a real digest, base64-encoded to look credential-shaped, is still '
    'refused — 88 characters is not a link however plausible its alphabet, and group I measures the '
    'other half of this claim, where a *valid* credential of the guest kind is refused here',
    (pg_temp.s7f_open(encode(extensions.digest(convert_to(tok1, 'UTF8'), 'sha256'), 'base64'))
       -> 'available')::boolean,
    false);
  PERFORM pg_temp.s7f_ok('K8 every shape above agreed on one answer, so a holder of a dead credential '
    'learns nothing about which of them it was',
    (pg_temp.s7f_open(''))::text = (pg_temp.s7f_open(forged))::text
      AND (pg_temp.s7f_open(''))::text = (pg_temp.s7f_open(left(tok1, 42)))::text);
  -- Positive control, last: five refusals mean nothing if the door had simply stopped answering.
  w := pg_temp.s7f_open(tok1);
  PERFORM pg_temp.s7f_eq('K9 and the live credential still opens the door after all of them — the '
    'refusals were about the credential', (w -> 'available')::boolean, true);
  PERFORM pg_temp.s7f_eq('K10 the other live credential opens too, at the same document and the same '
    'version, with its own name on the ask',
    (pg_temp.s7f_open(current_setting('s7f.tok2')) -> 'review' ->> 'reviewer_display_name'),
    'Brother');
END $K$;

-- --------------------------------------------------------------------------- V: the answer's own rules
-- Which of these refusals a caller can be given depends on where the workflow reads it, so the group
-- is split along that line rather than pretending the line is not there:
--
--   * group `V` — the eight payload checks `submit_family_review` performs *before* it reads the
--     credential. They run twice, once with a live link in the header and once with a well-formed
--     43-character credential that was never issued, and must print the same sentence both times.
--     That is the whole of §5's ordering claim: a validation error is never an oracle about anybody's
--     link, and a junk verb cannot be used to probe one.
--   * group `W` — the two section checks, which are necessarily *after* the credential resolves
--     because they need the frozen document to know what a section is. Under a live link they raise
--     their own sentences; under the never-issued credential they are answered by the closed liveness
--     refusal, which is then measured against the refusal a caller with no header at all gets. Three
--     identical objects is the evidence that the payload has stopped changing the answer.
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('V', 'a decision the product does not record is refused',
   $t$SELECT api.submit_family_review('maybe', 'Son', NULL, NULL)$t$,
   '23514', '%the review decision is not one this product records%'),
  ('V', 'and NULL is not a decision either',
   $t$SELECT api.submit_family_review(NULL, 'Son', NULL, NULL)$t$,
   '23514', '%the review decision is not one this product records%'),
  ('V', 'an answer with nobody named is refused — §3 makes attribution the point of the label',
   $t$SELECT api.submit_family_review('approved', '', NULL, NULL)$t$,
   '23514', '%say who is answering, in their own words%'),
  ('V', 'and a label of NULL is the same refusal',
   $t$SELECT api.submit_family_review('approved', NULL, NULL, NULL)$t$,
   '23514', '%say who is answering, in their own words%'),
  ('V', 'a label too long to display is refused by the same sentence',
   $t$SELECT api.submit_family_review('approved', repeat('n', 121), NULL, NULL)$t$,
   '23514', '%say who is answering, in their own words%'),
  ('V', 'a rejection with no reason is refused — the schema allows it, the workflow does not (§5.1)',
   $t$SELECT api.submit_family_review('changes_requested', 'Son', '   ', NULL)$t$,
   '23514', '%a request for changes needs a note saying what to change%'),
  ('V', 'and a rejection with a NULL note is the same refusal',
   $t$SELECT api.submit_family_review('changes_requested', 'Son', NULL, NULL)$t$,
   '23514', '%a request for changes needs a note saying what to change%'),
  ('V', 'a note too long to record is refused rather than truncated',
   $t$SELECT api.submit_family_review('approved', 'Son', repeat('m', 2001), NULL)$t$,
   '23514', '%that note is too long to record%'),
  ('W', '§5.2: a note pinned to a section this frozen document does not contain is refused',
   $t$SELECT api.submit_family_review('approved', 'Son', NULL, 'not_a_section_key')$t$,
   '23514', '%that note does not name a section of this invitation%'),
  ('W', 'and a section reference too long to be a key is refused before it reaches the document',
   $t$SELECT api.submit_family_review('approved', 'Son', NULL, repeat('k', 121))$t$,
   '23514', '%that section reference is too long%');

DO $VV$
DECLARE v jsonb; n_before bigint; f_before bigint;
        v_dead constant jsonb := '{"recorded": false, "reason": "unavailable"}'::jsonb;
BEGIN
  n_before := (SELECT count(*) FROM public.approval_requests);
  f_before := (SELECT count(*) FROM public.approval_feedback);

  PERFORM pg_temp.s7f_send(current_setting('s7f.tok1'));
  PERFORM pg_temp.s7f_run('V', 'anon', NULL);
  PERFORM pg_temp.s7f_run('W', 'anon', NULL);

  v := pg_temp.s7f_open(current_setting('s7f.tok1'));
  PERFORM pg_temp.s7f_eq('V0 the door is still open for that credential, so none of the ten refusals '
    'above cost the reviewer their link', (v -> 'available')::boolean, true);
  PERFORM pg_temp.s7f_eq('V1a and ten refusals wrote no feedback row',
    (SELECT count(*) FROM public.approval_feedback), f_before);
  PERFORM pg_temp.s7f_eq('V1b nor any request — the refusals are about the payload, and nothing a '
    'rejected answer touches is left behind',
    (SELECT count(*) FROM public.approval_requests), n_before);

  -- The eight pre-credential payloads again, this time with a well-formed 43-character credential
  -- that was never issued: one that gets past the shape check and fails only at the digest lookup.
  -- `run()` re-reads the same probe rows, so any difference in SQLSTATE or wording between a live
  -- and a dead link fails the run.
  PERFORM pg_temp.s7f_send('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe');
  PERFORM pg_temp.s7f_run('V', 'anon', NULL);

  -- The two section payloads under the same dead credential. They cannot raise their own sentences
  -- here — the workflow has already refused the link — so what is measured is that the answer is the
  -- closed object, and that it does not vary with the payload or with the presence of a header.
  v := pg_temp.s7f_answer('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe',
                          'approved', 'Son', NULL, 'not_a_section_key');
  PERFORM pg_temp.s7f_eq('W1a an unissued credential answers a bad section key with the closed '
    'liveness refusal, not with a sentence about the section', v, v_dead);
  v := pg_temp.s7f_answer('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe',
                          'approved', 'Son', NULL, repeat('k', 121));
  PERFORM pg_temp.s7f_eq('W1b and the same answer for a section reference that is too long to be a '
    'key — the payload has stopped changing the refusal', v, v_dead);
  v := pg_temp.s7f_answer(NULL, 'approved', 'Son', NULL, 'not_a_section_key');
  PERFORM pg_temp.s7f_eq('W1c and the same answer with no header at all, which is the branch a '
    'visitor with no link ever takes', v, v_dead);
END $VV$;

-- One row of the host's queue, read out of a setting rather than a temp table, for the same reason
-- the probes carry their values in settings: `E` wants one request's row before a successor version
-- lands (so that an expired link can be seen reporting `expired`) and `Q` wants the whole queue
-- afterwards, and neither read is useful if the value it belongs to cannot outlive a `SET ROLE`.
CREATE FUNCTION pg_temp.s7f_qrow(req text) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT q FROM jsonb_array_elements(current_setting('s7f.queue')::jsonb) q
   WHERE q ->> 'request_id' = req $fn$;

-- --------------------------------------------------------------------------- S: an approval, recorded once
DO $S$
DECLARE s s7r%ROWTYPE; v jsonb; w jsonb; n_fb bigint; n_req bigint; snap text;
BEGIN
  SELECT * INTO s FROM s7r;
  snap := (SELECT md5(snapshot::text) FROM public.invitation_versions
            WHERE id = current_setting('s7f.v1')::uuid);
  PERFORM set_config('s7f.snap1', snap, false);
  n_fb  := (SELECT count(*) FROM public.approval_feedback);
  n_req := (SELECT count(*) FROM public.approval_requests);

  -- Padded on purpose again: what the reviewer types is not quite what the record keeps.
  v := pg_temp.s7f_answer(current_setting('s7f.tok1'), 'approved', '  Son  ', NULL, NULL);

  PERFORM pg_temp.s7f_eq('S1 §5.1: an approval that carries no note is accepted — the refusals in '
    'group V are refusals, not a demand to explain a yes — and the answer reports four names',
    pg_temp.s7f_top_keys(v),
    pg_temp.s7f_sorted(ARRAY['feedback_id', 'recorded', 'responded_at', 'status']));
  PERFORM pg_temp.s7f_eq('S2 it says the answer was recorded', (v -> 'recorded')::boolean, true);
  PERFORM pg_temp.s7f_eq('S3 and the state it moved the request to is the decision itself',
    v ->> 'status', 'approved');
  PERFORM pg_temp.s7f_eq('S4 the request row agrees with the response — one status, two readers',
    (SELECT status FROM public.approval_requests
      WHERE id = current_setting('s7f.req1')::uuid), 'approved');
  PERFORM pg_temp.s7f_eq('S5 the stamp on the row is the instant the response reported',
    (SELECT responded_at = (v ->> 'responded_at')::timestamptz FROM public.approval_requests
      WHERE id = current_setting('s7f.req1')::uuid), true);
  PERFORM pg_temp.s7f_eq('S5b and nothing was written to `invalidated_at`, because the ask was '
    'answered rather than voided',
    (SELECT invalidated_at FROM public.approval_requests
      WHERE id = current_setting('s7f.req1')::uuid), NULL::timestamptz);
  PERFORM pg_temp.s7f_eq('S6 the answer wrote no new request',
    (SELECT count(*) FROM public.approval_requests), n_req);
  PERFORM pg_temp.s7f_eq('S7 and exactly one feedback row',
    (SELECT count(*) FROM public.approval_feedback), n_fb + 1);
  PERFORM pg_temp.s7f_eq('S8 the decision is stored the way the schema reads it: a `decision` row with '
    'no section and no message',
    (SELECT f.feedback_kind || '|' || coalesce(f.decision, '-') || '|'
            || coalesce(f.section_key, '-') || '|' || coalesce(f.message, '-')
       FROM public.approval_feedback f
      WHERE f.request_id = current_setting('s7f.req1')::uuid),
    'decision|approved|-|-');
  PERFORM pg_temp.s7f_eq('S9 §5.3: the feedback row is pinned to the version the ask was made about, '
    'not to whatever happens to be newest',
    (SELECT version_id::text FROM public.approval_feedback
      WHERE request_id = current_setting('s7f.req1')::uuid), current_setting('s7f.v1'));
  PERFORM pg_temp.s7f_eq('S10 §3: the label the reviewer typed is their own words, trimmed — and it is '
    'not the name the host asked',
    (SELECT author_label FROM public.approval_feedback
      WHERE request_id = current_setting('s7f.req1')::uuid), 'Son');
  PERFORM pg_temp.s7f_eq('S10b so the record reads asked-of-Mother-in-law, answered-by-Son: holding the '
    'link is not the same as being the person it was asked of, and keeping both names side by side is '
    'what makes that visible instead of silent',
    (SELECT reviewer_display_name FROM public.approval_requests
      WHERE id = current_setting('s7f.req1')::uuid), 'Mother-in-law');
  PERFORM pg_temp.s7f_eq('S11 the frozen document is byte-identical to the instant before the answer — '
    'a verdict does not edit the thing it is a verdict about',
    (SELECT md5(snapshot::text) FROM public.invitation_versions
      WHERE id = current_setting('s7f.v1')::uuid), snap);
  PERFORM pg_temp.s7f_eq('S12 and no new version was minted by an answer either',
    (SELECT count(*) FROM public.invitation_versions WHERE wedding_id = s.wed_a), 2::bigint);

  -- Replay: a full second answer, valid payload and all, against a request that is no longer open.
  w := pg_temp.s7f_answer(current_setting('s7f.tok1'), 'changes_requested', 'Son',
        'The muurtham time is wrong', 'ceremonies');
  PERFORM pg_temp.s7f_eq('S13 a second answer with the same credential gets the one closed shape, and '
    'it names two things', pg_temp.s7f_top_keys(w),
    pg_temp.s7f_sorted(ARRAY['reason', 'recorded']));
  PERFORM pg_temp.s7f_eq('S14 the same answer a forged credential gets — a holder of a used link is not '
    'entitled to learn that they were the first',
    w, '{"recorded": false, "reason": "unavailable"}'::jsonb);
  PERFORM pg_temp.s7f_eq('S15 and the refused replay wrote no second row for that ask: no-replay is the '
    'count, not a promise',
    (SELECT count(*) FROM public.approval_feedback
      WHERE request_id = current_setting('s7f.req1')::uuid), 1::bigint);
  PERFORM pg_temp.s7f_eq('S16 and the request never left `approved` — the UPDATE that would have moved '
    'it is fenced on the pending state and its row count is checked, not ignored',
    (SELECT status FROM public.approval_requests
      WHERE id = current_setting('s7f.req1')::uuid), 'approved');
  PERFORM pg_temp.s7f_eq('S17 an answered credential is refused at the door as well: a reviewer who has '
    'said yes cannot reopen the same link and read a second version of the invitation',
    pg_temp.s7f_open(current_setting('s7f.tok1')), '{"available": false}'::jsonb);
  PERFORM pg_temp.s7f_eq('S18 and it is refused because the ask is answered, not because the credential '
    'was revoked — a successful answer retires nothing by itself',
    (SELECT revoked_at FROM private.access_tokens
      WHERE approval_request_id = current_setting('s7f.req1')::uuid), NULL::timestamptz);
  PERFORM pg_temp.s7f_eq('S19 §I10: after all those writes, the raw credential is still in no column of '
    'no row of either schema',
    pg_temp.s7f_stored_hits(current_setting('s7f.tok1')), '{}'::text[]);
END $S$;

-- --------------------------------------------------------------------------- N: a request for changes, pinned to a section
DO $N$
DECLARE s s7r%ROWTYPE; v jsonb; c_before text;
BEGIN
  SELECT * INTO s FROM s7r;
  c_before := (SELECT content::text FROM public.invitation_drafts WHERE wedding_id = s.wed_a);

  v := pg_temp.s7f_answer(current_setting('s7f.tok2'), 'changes_requested', 'Daughter',
        'The muurtham time is hard to read for elders travelling from out of town.', 'ceremonies');

  PERFORM pg_temp.s7f_eq('N1 a request for changes is recorded exactly the way an approval is — four '
    'names, no fifth', pg_temp.s7f_top_keys(v),
    pg_temp.s7f_sorted(ARRAY['feedback_id', 'recorded', 'responded_at', 'status']));
  PERFORM pg_temp.s7f_eq('N2 and the state it reports is `changes_requested`',
    v ->> 'status', 'changes_requested');
  PERFORM pg_temp.s7f_eq('N3 the request row carries that state, with a response stamp and no '
    'invalidation',
    (SELECT status || '/' || (responded_at IS NOT NULL)::text
            || '/' || (invalidated_at IS NULL)::text FROM public.approval_requests
      WHERE id = current_setting('s7f.req2')::uuid), 'changes_requested/true/true');
  PERFORM pg_temp.s7f_eq('N4 §5.2: the note is stored pinned to the section the reviewer chose, out of '
    'the frozen document''s own vocabulary',
    (SELECT coalesce(f.section_key, '-') || '|' || coalesce(f.message, '-') || '|'
            || f.feedback_kind || '|' || coalesce(f.decision, '-')
       FROM public.approval_feedback f
      WHERE f.request_id = current_setting('s7f.req2')::uuid),
    'ceremonies|The muurtham time is hard to read for elders travelling from out of town.'
    || '|decision|changes_requested');
  PERFORM pg_temp.s7f_eq('N5 a note that names a section does not create one: the frozen document is '
    'byte-identical after the objection',
    (SELECT md5(snapshot::text) FROM public.invitation_versions
      WHERE id = current_setting('s7f.v1')::uuid), current_setting('s7f.snap1'));
  PERFORM pg_temp.s7f_eq('N6 nor is the living draft touched — the snapshot and the draft are different '
    'objects, and the review path only ever reads the first',
    (SELECT content::text FROM public.invitation_drafts WHERE wedding_id = s.wed_a), c_before);
  PERFORM pg_temp.s7f_eq('N7 §5: a re-approval would have to be another row, never an overwrite, and '
    'that is a trigger on the table rather than a habit of this function',
    (SELECT array_agg(t.tgname::text ORDER BY t.tgname) FROM pg_trigger t
      WHERE t.tgrelid = 'public.approval_feedback'::regclass AND NOT t.tgisinternal),
    ARRAY['feedback_append_only_no_delete', 'feedback_append_only_no_update']::text[]);
  PERFORM pg_temp.s7f_eq('N8 and `anon` — the only role a reviewer can ever be — cannot name the '
    'feedback table at all, which is why the answer is a function and not a policy',
    pg_temp.s7f_visible('anon', NULL, 'SELECT * FROM public.approval_feedback'), -1::bigint);
  PERFORM pg_temp.s7f_eq('N9 two answers and no third state: exactly one approved ask and one '
    'changes_requested ask for this wedding',
    (SELECT count(*) FROM public.approval_requests
      WHERE wedding_id = s.wed_a AND status IN ('approved', 'changes_requested')), 2::bigint);
END $N$;

-- --------------------------------------------------------------------------- X: withdrawal
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('XP1', '§2.2: a withdrawal aimed at another family''s ask is refused in the same words as one that '
    'does not exist — the host''s verb does not confirm which relatives hold live links',
   $t$SELECT api.revoke_family_review(current_setting('s7f.req3')::uuid)$t$,
   '42501', '%the caller may not withdraw this review request%'),
  ('XP1', 'and a request id that is simply absent gets the identical answer',
   $t$SELECT api.revoke_family_review(gen_random_uuid())$t$,
   '42501', '%the caller may not withdraw this review request%'),
  ('XP2', 'a signed-out caller is refused the same way',
   $t$SELECT api.revoke_family_review(current_setting('s7f.req3')::uuid)$t$,
   '42501', '%the caller may not withdraw this review request%'),
  ('XP3', 'and `anon` has no EXECUTE on the host verb at all',
   $t$SELECT api.revoke_family_review(current_setting('s7f.req3')::uuid)$t$,
   '42501', '%permission denied for function revoke_family_review%');

DO $X$
DECLARE s s7r%ROWTYPE; v jsonb; w jsonb; stamp timestamptz; n_fb bigint; n_req bigint;
BEGIN
  SELECT * INTO s FROM s7r;

  v := pg_temp.s7f_auth(s.owner_a::text,
    'SELECT api.request_family_review(' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s7f.v1')) || '::uuid, ''Grandmother'', NULL)');
  PERFORM set_config('s7f.req3', v ->> 'request_id', false);
  PERFORM set_config('s7f.tok3', v ->> 'review_token', false);

  -- Refusal first, while the ask still stands: "someone else could not withdraw this" is only a fact
  -- about an ask that is still pending.
  PERFORM pg_temp.s7f_run('XP1', 'authenticated', s.owner_b::text);
  PERFORM pg_temp.s7f_run('XP2', 'authenticated', '');
  PERFORM pg_temp.s7f_run('XP3', 'anon', NULL);
  PERFORM pg_temp.s7f_eq('X0 three callers refused, and the ask is still pending with its credential '
    'still live — a refusal leaves the state exactly where it was found',
    (SELECT r.status || '/' || (t.revoked_at IS NULL)::text
       FROM public.approval_requests r
       JOIN private.access_tokens t ON t.approval_request_id = r.id
      WHERE r.id = current_setting('s7f.req3')::uuid), 'pending/true');

  PERFORM pg_temp.s7f_eq('X1 the link opens before the host changes their mind, so the withdrawal below '
    'is measured against a link that demonstrably worked',
    (pg_temp.s7f_open(current_setting('s7f.tok3')) -> 'available')::boolean, true);

  w := pg_temp.s7f_auth(s.owner_a::text, 'SELECT api.revoke_family_review('
    || quote_literal(current_setting('s7f.req3')) || '::uuid)');
  PERFORM pg_temp.s7f_eq('X2 §2.2: withdrawal reports four names — what it moved, and whether there was '
    'a credential to move', pg_temp.s7f_top_keys(w),
    pg_temp.s7f_sorted(ARRAY['credential_revoked', 'request_id', 'status', 'was_pending']));
  PERFORM pg_temp.s7f_eq('X3 an unanswered ask becomes `invalidated`, visibly',
    w ->> 'status', 'invalidated');
  PERFORM pg_temp.s7f_eq('X3b and it reports that the ask had been pending',
    (w -> 'was_pending')::boolean, true);
  PERFORM pg_temp.s7f_eq('X3c and that a live credential went down with it',
    (w -> 'credential_revoked')::boolean, true);
  PERFORM pg_temp.s7f_eq('X4 the row tells the same story: invalidated, stamped, never answered',
    (SELECT status || '/' || (invalidated_at IS NOT NULL)::text || '/'
            || (responded_at IS NULL)::text FROM public.approval_requests
      WHERE id = current_setting('s7f.req3')::uuid), 'invalidated/true/true');
  stamp := (SELECT invalidated_at FROM public.approval_requests
             WHERE id = current_setting('s7f.req3')::uuid);
  PERFORM pg_temp.s7f_eq('X5 the credential row survives with `revoked_at` set — a withdrawal retires a '
    'link, it does not erase the evidence that one was issued',
    (SELECT count(*) FROM private.access_tokens
      WHERE approval_request_id = current_setting('s7f.req3')::uuid AND revoked_at IS NOT NULL),
    1::bigint);
  PERFORM pg_temp.s7f_eq('X6 the withdrawn link is refused at the door in the same closed shape as a '
    'forgery: revoked and never-issued are indistinguishable to whoever holds them',
    pg_temp.s7f_open(current_setting('s7f.tok3')), '{"available": false}'::jsonb);
  PERFORM pg_temp.s7f_eq('X7 and an answer sent to it is refused as unavailable, with no word about the '
    'person who withdrew it',
    pg_temp.s7f_answer(current_setting('s7f.tok3'), 'approved', 'Whoever', NULL, NULL),
    '{"recorded": false, "reason": "unavailable"}'::jsonb);
  PERFORM pg_temp.s7f_eq('X8 §I10: the withdrawn credential appears in no stored column',
    pg_temp.s7f_stored_hits(current_setting('s7f.tok3')), '{}'::text[]);

  w := pg_temp.s7f_auth(s.owner_a::text, 'SELECT api.revoke_family_review('
    || quote_literal(current_setting('s7f.req3')) || '::uuid)');
  PERFORM pg_temp.s7f_eq('X9 withdrawing the same ask again is a report, not a second action: it had '
    'stopped being pending', (w -> 'was_pending')::boolean, false);
  PERFORM pg_temp.s7f_eq('X10 and there was no live credential left to take down',
    (w -> 'credential_revoked')::boolean, false);
  PERFORM pg_temp.s7f_eq('X11 and the status it reports is the state it found, not a new one',
    w ->> 'status', 'invalidated');
  PERFORM pg_temp.s7f_eq('X12 and the first withdrawal''s timestamp was not rewritten — a repeated verb '
    'does not quietly move history',
    (SELECT invalidated_at FROM public.approval_requests
      WHERE id = current_setting('s7f.req3')::uuid), stamp);

  -- The harder case: an ask that already has an answer.
  n_fb  := (SELECT count(*) FROM public.approval_feedback);
  n_req := (SELECT count(*) FROM public.approval_requests);
  w := pg_temp.s7f_auth(s.owner_a::text, 'SELECT api.revoke_family_review('
    || quote_literal(current_setting('s7f.req1')) || '::uuid)');
  PERFORM pg_temp.s7f_eq('X13 §2.2: withdrawing an ask that was already answered does not un-answer it '
    '— the status reported is the decision, not `invalidated`', w ->> 'status', 'approved');
  PERFORM pg_temp.s7f_eq('X14 and both halves of the report say so: it was not pending, and the link '
    'that survived the answer is now down',
    (w -> 'was_pending')::text || '/' || (w -> 'credential_revoked')::text, 'false/true');
  PERFORM pg_temp.s7f_eq('X15 the decision is still on the record, with its stamp',
    (SELECT status || '/' || (responded_at IS NOT NULL)::text FROM public.approval_requests
      WHERE id = current_setting('s7f.req1')::uuid), 'approved/true');
  PERFORM pg_temp.s7f_eq('X16 the feedback row is untouched — what a person said is not a side effect '
    'of the host losing the link', (SELECT count(*) FROM public.approval_feedback), n_fb);
  PERFORM pg_temp.s7f_eq('X17 and no request row appeared or vanished while withdrawing',
    (SELECT count(*) FROM public.approval_requests), n_req);

  -- §2.2's choice is not stylistic. The schema refuses the alternative, so overwriting a verdict would
  -- mean erasing when the family answered.
  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('XQ', 'an answered ask cannot be moved to `invalidated` even by the superuser this battery runs as',
     $t$UPDATE public.approval_requests SET status = 'invalidated'
        WHERE id = current_setting('s7f.req1')::uuid$t$,
     '23514', '%violates check constraint%');
  PERFORM pg_temp.s7f_run('XQ', 'postgres', NULL);
  PERFORM pg_temp.s7f_eq('X18 and the refusal changed nothing',
    (SELECT status FROM public.approval_requests
      WHERE id = current_setting('s7f.req1')::uuid), 'approved');
  PERFORM pg_temp.s7f_eq('X19 the constraint that fired is the biconditional between the status and the '
    'response stamp, read out of the catalog rather than named by hand',
    (SELECT count(*) FROM pg_constraint
      WHERE conrelid = 'public.approval_requests'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%responded_at%'
        AND pg_get_constraintdef(oid) LIKE '%approved%'), 1::bigint);
END $X$;

-- --------------------------------------------------------------------------- E: expiry, reached by moving the clock
-- Waiting is not available inside one transaction, and a fixture that fakes `now()` would be
-- measuring its own lie. So the credential's own timestamps are moved, and the first attempt is made
-- deliberately wrong: moving only `expires_at` trips the schema's `expires_at > created_at` CHECK,
-- which is the database refusing a sloppy fixture. Both ends have to move together, and that is
-- itself an assertion worth printing.
DO $E$
DECLARE s s7r%ROWTYPE; v jsonb; q jsonb;
BEGIN
  SELECT * INTO s FROM s7r;

  v := pg_temp.s7f_auth(s.owner_a::text,
    'SELECT api.request_family_review(' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s7f.v1')) || '::uuid, ''Aunt'', now() + interval ''1 hour'')');
  PERFORM set_config('s7f.req4', v ->> 'request_id', false);
  PERFORM set_config('s7f.tok4', v ->> 'review_token', false);

  PERFORM pg_temp.s7f_eq('E1 §2.1: an explicit window is honoured to the instant, against the request''s '
    'own timestamp',
    (SELECT r.requested_at + interval '1 hour' = t.expires_at
       FROM public.approval_requests r
       JOIN private.access_tokens t ON t.approval_request_id = r.id
      WHERE r.id = (v ->> 'request_id')::uuid), true);
  PERFORM pg_temp.s7f_eq('E1b and the same instant is what the host was told',
    (SELECT t.expires_at FROM private.access_tokens t
      WHERE t.approval_request_id = (v ->> 'request_id')::uuid),
    (v ->> 'expires_at')::timestamptz);
  PERFORM pg_temp.s7f_eq('E2 while the window is in the future the link works — the expiry test below '
    'only means something because this one did',
    (pg_temp.s7f_open(current_setting('s7f.tok4')) -> 'available')::boolean, true);

  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('EP', 'moving only the expiry end is refused by the schema: a credential cannot be made to die '
      'before it was born, which is exactly what a one-ended edit to this fixture would have done',
     $t$UPDATE private.access_tokens SET expires_at = now() - interval '1 hour'
        WHERE approval_request_id = current_setting('s7f.req4')::uuid$t$,
     '23514', '%violates check constraint%');
  PERFORM pg_temp.s7f_run('EP', 'postgres', NULL);

  UPDATE private.access_tokens
     SET created_at = now() - interval '2 hours',
         expires_at = now() - interval '1 hour'
   WHERE approval_request_id = current_setting('s7f.req4')::uuid;

  PERFORM pg_temp.s7f_eq('E3 with both ends moved, the credential is genuinely in the past',
    (SELECT expires_at < now() FROM private.access_tokens
      WHERE approval_request_id = current_setting('s7f.req4')::uuid), true);
  PERFORM pg_temp.s7f_eq('E4 the door refuses an expired credential in the one closed shape — the same '
    'answer a forgery gets, so a stale link does not tell its holder why it died',
    pg_temp.s7f_open(current_setting('s7f.tok4')), '{"available": false}'::jsonb);
  PERFORM pg_temp.s7f_eq('E5 and the answer door refuses it the same way, with no word about expiry',
    pg_temp.s7f_answer(current_setting('s7f.tok4'), 'approved', 'Aunt', NULL, NULL),
    '{"recorded": false, "reason": "unavailable"}'::jsonb);
  PERFORM pg_temp.s7f_eq('E6 §2.1: and the ask is STILL pending — nothing in this build rewrites a '
    'request because its link aged out. The link dies; the question stands until the host or a '
    'successor version says otherwise',
    (SELECT status FROM public.approval_requests
      WHERE id = current_setting('s7f.req4')::uuid), 'pending');
  PERFORM pg_temp.s7f_eq('E7 the expired credential was not revoked by ageing — the two facts are '
    'separate columns, and the queue has to be able to tell them apart',
    (SELECT revoked_at FROM private.access_tokens
      WHERE approval_request_id = current_setting('s7f.req4')::uuid), NULL::timestamptz);

  -- The host's own view, read before any successor version sweeps it away.
  q := pg_temp.s7f_auth(s.owner_a::text, 'SELECT api.get_approval_requests('
    || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM set_config('s7f.queue', q::text, false);
  PERFORM pg_temp.s7f_eq('E8 §2.3: the queue reports that link as `expired`, which is the only place in '
    'the product where the distinction is visible to the host',
    pg_temp.s7f_qrow(current_setting('s7f.req4')) ->> 'link_state', 'expired');
  PERFORM pg_temp.s7f_eq('E8b and it reports it while the ask itself still reads `pending` — two '
    'columns, two meanings, both true at once',
    pg_temp.s7f_qrow(current_setting('s7f.req4')) ->> 'status', 'pending');
  -- Not "the expiry the host was given at the ask": E just moved that row's end, so the ask's own
  -- answer is now a stale copy of a date the product has changed. What the queue must do is report
  -- the credential's *current* end, which is the only version of the claim that survives the clock
  -- moving — and the pre-move equality (one instant, host view and reviewer view) is E1b's and D7's.
  PERFORM pg_temp.s7f_eq('E8c the expiry the queue shows is that credential''s expiry, read from the '
    'row itself rather than from a copy the host was handed at the ask',
    (pg_temp.s7f_qrow(current_setting('s7f.req4')) ->> 'link_expires_at')::timestamptz,
    (SELECT expires_at FROM private.access_tokens
      WHERE approval_request_id = current_setting('s7f.req4')::uuid));
  PERFORM pg_temp.s7f_eq('E8d and the instant it shows is in the past, which is what makes the state '
    'above the word `expired` rather than a label this battery chose',
    (SELECT (pg_temp.s7f_qrow(current_setting('s7f.req4')) ->> 'link_expires_at')::timestamptz < now()),
    true);
  PERFORM pg_temp.s7f_eq('E9 and the answered ask''s link still reads `live` there, because nothing '
    'revoked it — the queue describes the credential while the door refuses on the request. Both '
    'statements are about different things, and the copy has to keep them apart',
    pg_temp.s7f_qrow(current_setting('s7f.req2')) ->> 'link_state', 'live');
  PERFORM pg_temp.s7f_eq('E10 while the ask that was opened and then withdrawn keeps both marks — '
    'revoked, and used — which is the evidence a forwarded link leaves behind',
    (SELECT (t.revoked_at IS NOT NULL)::text || '/' || (t.last_used_at IS NOT NULL)::text
       FROM private.access_tokens t
      WHERE t.approval_request_id = current_setting('s7f.req3')::uuid), 'true/true');
  PERFORM pg_temp.s7f_eq('E11 §2.3: and every row of the queue carries exactly the twelve names that '
    'decision chose, including the two timestamps and none of the credential',
    pg_temp.s7f_top_keys(pg_temp.s7f_qrow(current_setting('s7f.req4'))),
    pg_temp.s7f_sorted(ARRAY['history', 'invalidated_at', 'link_expires_at', 'link_last_used_at',
                             'link_state', 'request_id', 'requested_at', 'responded_at',
                             'reviewer_display_name', 'status', 'version_id', 'version_number']));
  PERFORM pg_temp.s7f_eq('E12 the fifth vocabulary word in the status CHECK is never written: nothing in '
    'this build produces an `expired` request, so no screen may say a link expired by turning the ask '
    'into that state',
    (SELECT count(*) FROM public.approval_requests WHERE status = 'expired'), 0::bigint);
  PERFORM pg_temp.s7f_eq('E13 and the CHECK itself still lists all five literals — E12 is a gap in the '
    'writes, not a missing value in the schema',
    (SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) FROM pg_constraint
      CROSS JOIN LATERAL regexp_matches(
              pg_get_constraintdef(pg_constraint.oid), '''([a-z_]+)''', 'g') AS m
      WHERE conrelid = 'public.approval_requests'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%status%'),
    ARRAY['approved', 'changes_requested', 'expired', 'invalidated', 'pending']::text[]);
  PERFORM pg_temp.s7f_eq('E14 the expired credential is in no stored column either — dying does not '
    'change what was written while it lived',
    pg_temp.s7f_stored_hits(current_setting('s7f.tok4')), '{}'::text[]);
END $E$;

-- --------------------------------------------------------------------------- O: one live credential per request
DO $O$
DECLARE s s7r%ROWTYPE; v jsonb; raw_dup text; raw_succ text; hash_dup text; hash_succ text;
BEGIN
  SELECT * INTO s FROM s7r;
  v := pg_temp.s7f_auth(s.owner_a::text,
    'SELECT api.request_family_review(' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s7f.v1')) || '::uuid, ''Grandfather'', NULL)');
  PERFORM set_config('s7f.req5', v ->> 'request_id', false);
  PERFORM set_config('s7f.tok5', v ->> 'review_token', false);

  raw_dup := 'DuplicateAttempt' || repeat('0', 25) || 'ab';
  raw_succ := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  PERFORM set_config('s7f.succ_raw', raw_succ, false);
  hash_dup := encode(extensions.digest(convert_to(raw_dup, 'UTF8'), 'sha256'), 'hex');
  hash_succ := encode(extensions.digest(convert_to(raw_succ, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('O1', '§10: a second live credential for one ask is refused, so the queue''s LEFT JOIN can never '
      'silently double a row or give one ask two working links',
     'INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, approval_request_id, '
     || 'approval_version_id, expiry_policy, expires_at) VALUES ('
     || quote_literal(hash_dup) || ', ''approval_review'', '
     || quote_literal(s.wed_a::text) || '::uuid, '
     || quote_literal(current_setting('s7f.req5')) || '::uuid, '
     || quote_literal(current_setting('s7f.v1')) || '::uuid, ''fixed'', now() + interval ''7 days'')',
     '23505', '%duplicate key value violates unique constraint "one_live_token_per_approval_request"%');
  PERFORM pg_temp.s7f_run('O1', 'postgres', NULL);

  PERFORM pg_temp.s7f_eq('O2 and the refusal left exactly one live credential on that ask',
    (SELECT count(*) FROM private.access_tokens
      WHERE approval_request_id = current_setting('s7f.req5')::uuid AND revoked_at IS NULL),
    1::bigint);

  -- Retire the issued credential by hand. No product verb does this: withdrawal retires a link *and*
  -- invalidates the ask, and answering leaves the link alone. The claim under test is the index's
  -- scope — one live credential, not one credential ever — and measuring it needs a retired row beside
  -- a still-pending ask, which is a maintenance shape rather than a workflow.
  UPDATE private.access_tokens SET revoked_at = now()
   WHERE approval_request_id = current_setting('s7f.req5')::uuid AND revoked_at IS NULL;

  EXECUTE 'INSERT INTO private.access_tokens (token_hash, token_kind, wedding_id, '
    || 'approval_request_id, approval_version_id, expiry_policy, expires_at) VALUES ('
    || quote_literal(hash_succ) || ', ''approval_review'', '
    || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s7f.req5')) || '::uuid, '
    || quote_literal(current_setting('s7f.v1')) || '::uuid, ''fixed'', '
    || 'now() + interval ''7 days'')';

  PERFORM pg_temp.s7f_eq('O3 once the first is retired the successor is accepted, which is what makes '
    'this a one-live rule rather than a one-ever rule',
    (SELECT count(*) FROM private.access_tokens
      WHERE approval_request_id = current_setting('s7f.req5')::uuid AND revoked_at IS NULL),
    1::bigint);
  PERFORM pg_temp.s7f_eq('O4 and the successor is a working credential that names the same ask — the '
    'row is not decoration',
    pg_temp.s7f_open(raw_succ) -> 'review' ->> 'request_id', current_setting('s7f.req5'));
  PERFORM pg_temp.s7f_eq('O5 while the retired credential is refused at the door',
    pg_temp.s7f_open(current_setting('s7f.tok5')), '{"available": false}'::jsonb);
  PERFORM pg_temp.s7f_eq('O6 and the ask still reads pending — retiring a credential did not touch the '
    'state machine',
    (SELECT status FROM public.approval_requests
      WHERE id = current_setting('s7f.req5')::uuid), 'pending');
  PERFORM pg_temp.s7f_ok('O7 §10: the index is unique and partial in exactly the three ways the claim '
    'needs — only live rows, only this kind, only rows that name a request — so it constrains nothing '
    'else in the credential store',
    (SELECT d LIKE 'CREATE UNIQUE INDEX%' AND d LIKE '%(approval_request_id)%'
            AND d LIKE '%WHERE%'
            AND d LIKE '%(revoked_at IS NULL)%'
            AND d LIKE '%approval_review%'
            AND d LIKE '%(approval_request_id IS NOT NULL)%'
       FROM (SELECT pg_get_indexdef(c.oid) AS d
               FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
              WHERE c.relname = 'one_live_token_per_approval_request') x));
  PERFORM pg_temp.s7f_eq('O8 §I10: the successor credential is in no stored column, and only its digest '
    'is anywhere',
    pg_temp.s7f_stored_hits(raw_succ), '{}'::text[]);
END $O$;

-- --------------------------------------------------------------------------- I: I-12, and the guest link it must not touch
-- The order here is the whole point of the group. A guest link is published *before* the successor
-- version lands, an ask stays open on the predecessor, and only then is the sweep triggered — so
-- "the guest link still works" and "the review link no longer does" are two answers about the same
-- wedding at the same moment, rather than two facts about different databases.
DO $I$
DECLARE s s7r%ROWTYPE; v jsonb; w jsonb; guest_raw text; snap2_before text; chain text;
BEGIN
  SELECT * INTO s FROM s7r;
  snap2_before := (SELECT md5(snapshot::text) FROM public.invitation_versions
                    WHERE id = current_setting('s7f.v2')::uuid);

  v := pg_temp.s7f_auth(s.owner_a::text, 'SELECT api.publish_invitation_version('
    || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s7f.v2')) || '::uuid, NULL)');
  PERFORM pg_temp.s7f_eq('I1 the host''s own publication verb still reports five names — Stage 7 added '
    'nothing to its shape', pg_temp.s7f_top_keys(v),
    pg_temp.s7f_sorted(ARRAY['expires_at', 'link_reused', 'path', 'publication_id', 'version_id']));
  guest_raw := substr(v ->> 'path', 4);
  PERFORM set_config('s7f.guest_raw', guest_raw, false);
  PERFORM pg_temp.s7f_eq('I2 a guest credential and a review credential share one grammar — 43 octets, '
    'base64url, unpadded — so what separates them is the kind column, not the alphabet',
    octet_length(guest_raw), 43);
  PERFORM pg_temp.s7f_eq('I3 and the guest door answers for it',
    (pg_temp.s7f_guest_open(guest_raw) -> 'available')::boolean, true);
  PERFORM pg_temp.s7f_eq('I4 its token row is the guest kind with no request attached, which is the '
    'half of §10''s index that keeps it out of the sweep''s reach',
    (SELECT t.token_kind || '/' || (t.approval_request_id IS NULL)::text
       FROM private.access_tokens t
      WHERE t.wedding_id = s.wed_a AND t.token_kind = 'public_invitation'),
    'public_invitation/true');

  v := pg_temp.s7f_auth(s.owner_a::text,
    'SELECT api.request_family_review(' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s7f.v1')) || '::uuid, ''Sister'', NULL)');
  PERFORM set_config('s7f.req6', v ->> 'request_id', false);
  PERFORM set_config('s7f.tok6', v ->> 'review_token', false);
  PERFORM pg_temp.s7f_eq('I5 an ask left open on the predecessor, still pending with a live link',
    (SELECT r.status || '/' || (t.revoked_at IS NULL)::text
       FROM public.approval_requests r
       JOIN private.access_tokens t ON t.approval_request_id = r.id
      WHERE r.id = current_setting('s7f.req6')::uuid), 'pending/true');
  PERFORM pg_temp.s7f_eq('I6 and nobody has ever opened it, which is what makes the trace honest: an '
    'unvisited link reports itself unvisited',
    (SELECT last_used_at IS NULL FROM private.access_tokens
      WHERE approval_request_id = current_setting('s7f.req6')::uuid), true);

  -- The successor lands. Everything above is the state the sweep has to respect.
  w := pg_temp.s7f_auth(s.owner_a::text, 'SELECT api.create_invitation_version('
    || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM set_config('s7f.v3', w ->> 'version_id', false);
  PERFORM pg_temp.s7f_eq('I7 freezing a successor still answers with the three names it has always '
    'given the host — the invalidation is inside the verb, not bolted onto it',
    pg_temp.s7f_top_keys(w),
    pg_temp.s7f_sorted(ARRAY['snapshot', 'version_id', 'version_number']));
  PERFORM pg_temp.s7f_eq('I8 and the new version is number 3', w ->> 'version_number', '3');
  PERFORM pg_temp.s7f_eq('I9 the successor names its predecessor, which is the relation I-12 turns on',
    (SELECT supersedes_version_id::text FROM public.invitation_versions
      WHERE id = current_setting('s7f.v3')::uuid), current_setting('s7f.v2'));

  PERFORM pg_temp.s7f_eq('I10 §6: not one ask about this wedding is left pending — every open question '
    'about a document the host has moved past stopped being openable',
    (SELECT count(*) FROM public.approval_requests
      WHERE wedding_id = s.wed_a AND status = 'pending'), 0::bigint);
  PERFORM pg_temp.s7f_eq('I11 the two asks that had been answered kept their decisions, their stamps, '
    'and no invalidation — history is not overwritten by a successor',
    (SELECT count(*) FROM public.approval_requests
      WHERE wedding_id = s.wed_a AND status IN ('approved', 'changes_requested')
        AND responded_at IS NOT NULL AND invalidated_at IS NULL), 2::bigint);
  PERFORM pg_temp.s7f_eq('I12 the four that were still open are invalidated, stamped, and never '
    'answered: the withdrawn one from group X and the three the sweep caught',
    (SELECT count(*) FROM public.approval_requests
      WHERE wedding_id = s.wed_a AND status = 'invalidated'
        AND invalidated_at IS NOT NULL AND responded_at IS NULL), 4::bigint);
  PERFORM pg_temp.s7f_eq('I13 §6: every review credential of this wedding is revoked now, including the '
    'ones whose asks were answered — the sweep is scoped by kind and wedding, not by request status',
    (SELECT count(*) FROM private.access_tokens
      WHERE wedding_id = s.wed_a AND token_kind = 'approval_review' AND revoked_at IS NULL),
    0::bigint);
  PERFORM pg_temp.s7f_eq('I14 and nothing was deleted to get there: six asks and one hand-retired '
    'successor, seven credential rows still present as evidence',
    (SELECT count(*) FROM private.access_tokens
      WHERE wedding_id = s.wed_a AND token_kind = 'approval_review'), 7::bigint);
  PERFORM pg_temp.s7f_eq('I15 no feedback row was touched by the sweep — what a relative said about v1 '
    'stays in the record even after the ask closes',
    (SELECT count(*) FROM public.approval_feedback WHERE wedding_id = s.wed_a), 2::bigint);
  PERFORM pg_temp.s7f_eq('I16 the invalidated ask''s credential is refused at the door',
    pg_temp.s7f_open(current_setting('s7f.tok6')), '{"available": false}'::jsonb);
  PERFORM pg_temp.s7f_eq('I17 and an answer sent to it is simply unavailable: a reviewer following an '
    'old link is stopped, never silently re-pointed at the newer version',
    pg_temp.s7f_answer(current_setting('s7f.tok6'), 'approved', 'Sister', NULL, NULL),
    '{"recorded": false, "reason": "unavailable"}'::jsonb);
  PERFORM pg_temp.s7f_eq('I18 §5.3: the frozen documents are byte-identical across the whole sweep — '
    'invalidating an ask rewrites no invitation',
    (SELECT md5(snapshot::text) FROM public.invitation_versions
      WHERE id = current_setting('s7f.v1')::uuid), current_setting('s7f.snap1'));
  PERFORM pg_temp.s7f_eq('I19 the same for the version the guest is reading',
    (SELECT md5(snapshot::text) FROM public.invitation_versions
      WHERE id = current_setting('s7f.v2')::uuid), snap2_before);

  -- The half of the claim the summary of the design keeps asserting: the guest link is not collateral.
  PERFORM pg_temp.s7f_eq('I20 §6: the published version is still v2, active, after a successor was '
    'frozen — closing a family''s review asks does not unpublish a wedding',
    (SELECT p.version_id::text FROM public.publications p
      WHERE p.wedding_id = s.wed_a AND p.status = 'active'), current_setting('s7f.v2'));
  PERFORM pg_temp.s7f_eq('I20b the guest credential is still unrevoked, because the sweep names the '
    'review kind and nothing else',
    (SELECT revoked_at FROM private.access_tokens
      WHERE wedding_id = s.wed_a AND token_kind = 'public_invitation'), NULL::timestamptz);
  PERFORM pg_temp.s7f_eq('I21 and the guest door still answers for it — the family that was sent the '
    'invitation reads the same document they read an instant ago',
    (pg_temp.s7f_guest_open(guest_raw) -> 'available')::boolean, true);

  -- The cross-kind refusal, which group K could only describe: both credentials are 43 octets of the
  -- same alphabet, so only the kind column can tell the doors apart.
  PERFORM pg_temp.s7f_eq('I22 §3.1: a valid guest credential is refused at the review door',
    pg_temp.s7f_open(guest_raw), '{"available": false}'::jsonb);
  PERFORM pg_temp.s7f_eq('I23 and a valid review credential is refused at the guest door — neither door '
    'answers the other''s kind, and both refuse in the same closed shape',
    pg_temp.s7f_guest_open(current_setting('s7f.tok6')), '{"available": false}'::jsonb);

  -- The structural half of "a credential minted for v1 cannot be used to answer v2".
  PERFORM pg_temp.s7f_ok('I24 §5: no argument of the browser-facing answer verb names a wedding, a '
    'request or a version — a reviewer cannot aim an answer at a document they choose, so the version '
    'is whatever the credential already pinned',
    (SELECT proargnames IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(proargnames) a
        WHERE a::text ILIKE '%version%' OR a::text ILIKE '%wedding%'
           OR a::text ILIKE '%request%')
       FROM pg_proc WHERE oid = 'api.submit_family_review(text, text, text, text)'::regprocedure));
  PERFORM pg_temp.s7f_eq('I24b and it takes exactly the four things a reviewer is allowed to say',
    (SELECT cardinality(proargnames) FROM pg_proc
      WHERE oid = 'api.submit_family_review(text, text, text, text)'::regprocedure), 4);

  -- A fresh ask after the sweep, and a different family moving on: the sweep must not be a global.
  v := pg_temp.s7f_auth(s.owner_a::text,
    'SELECT api.request_family_review(' || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(current_setting('s7f.v3')) || '::uuid, ''Nephew'', NULL)');
  PERFORM set_config('s7f.req7', v ->> 'request_id', false);
  PERFORM set_config('s7f.tok7', v ->> 'review_token', false);
  w := pg_temp.s7f_auth(s.owner_b::text, 'SELECT api.create_invitation_version('
    || quote_literal(s.wed_b::text) || '::uuid)');
  PERFORM pg_temp.s7f_eq('I25 the other family freezing its own successor invalidates nothing here — '
    'one family''s new draft is not another family''s lost review link',
    (SELECT r.status || '/' || (t.revoked_at IS NULL)::text
       FROM public.approval_requests r
       JOIN private.access_tokens t ON t.approval_request_id = r.id
      WHERE r.id = current_setting('s7f.req7')::uuid), 'pending/true');
  PERFORM pg_temp.s7f_eq('I26 and its link still opens',
    (pg_temp.s7f_open(current_setting('s7f.tok7')) -> 'available')::boolean, true);
  PERFORM pg_temp.s7f_eq('I27 while that family''s own asks — none — are untouched too: the successor '
    'verb ran on a wedding with no review workflow at all',
    (SELECT count(*) FROM public.approval_requests r
      WHERE r.wedding_id = s.wed_b), 0::bigint);
  chain := (SELECT array_to_string(ARRAY_AGG(version_number::text ORDER BY version_number), ',')
              FROM public.invitation_versions WHERE wedding_id = s.wed_a);
  PERFORM pg_temp.s7f_eq('I28 this wedding''s version history reads 1,2,3 — the sweep added no version '
    'and removed none', chain, '1,2,3');
END $I$;

-- --------------------------------------------------------------------------- Q: the host's queue
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('QP1', '§2.3: reading another family''s review queue is refused in one sentence, whether the wedding '
    'is someone else''s or does not exist — both probes run as the owner of the *other* wedding, so '
    'the first one is a real cross-tenant read and not a host looking at their own record',
   $t$SELECT api.get_approval_requests(current_setting('s7f.wed_a')::uuid)$t$,
   '42501', '%the caller may not read these reviews%'),
  ('QP1', 'and a nonexistent wedding is not a different answer',
   $t$SELECT api.get_approval_requests(gen_random_uuid())$t$,
   '42501', '%the caller may not read these reviews%'),
  ('QP2', 'a signed-out caller gets the same sentence',
   $t$SELECT api.get_approval_requests(current_setting('s7f.wed_a')::uuid)$t$,
   '42501', '%the caller may not read these reviews%'),
  ('QP3', 'and `anon` has no EXECUTE on it at all',
   $t$SELECT api.get_approval_requests(current_setting('s7f.wed_a')::uuid)$t$,
   '42501', '%permission denied for function get_approval_requests%'),
  ('QP4', '§9: `service_role` has no path through `api` either — the queue is a host verb behind a host '
    'wrapper, not a server-side back door',
   $t$SELECT api.get_approval_requests(current_setting('s7f.wed_a')::uuid)$t$,
   '42501', '%permission denied for schema api%');

DO $Q$
DECLARE s s7r%ROWTYPE; q jsonb; raw text; i integer; raws text[];
BEGIN
  SELECT * INTO s FROM s7r;
  q := pg_temp.s7f_auth(s.owner_a::text, 'SELECT api.get_approval_requests('
    || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM set_config('s7f.queue', q::text, false);

  PERFORM pg_temp.s7f_eq('Q1 the seven asks this battery made, and nothing else — the queue is the '
    'host''s complete record of who they asked, including the ones that no longer work',
    (SELECT pg_temp.s7f_sorted(array_agg(x ->> 'request_id')) FROM jsonb_array_elements(q) x),
    pg_temp.s7f_sorted(ARRAY[
      current_setting('s7f.req1'), current_setting('s7f.req2'), current_setting('s7f.req3'),
      current_setting('s7f.req4'), current_setting('s7f.req5'), current_setting('s7f.req6'),
      current_setting('s7f.req7')]));
  -- The ask `O` gave a retired-and-replaced link. Two credential rows, one ask: this is the row that
  -- would print twice, with the same `history` on both copies, if the queue joined the credential
  -- store instead of choosing the one link that represents the ask.
  PERFORM pg_temp.s7f_eq('Q1b and the ask whose link was retired and replaced appears exactly once, '
    'though the credential store holds two rows for it',
    (SELECT count(*) FROM jsonb_array_elements(q) x
      WHERE x ->> 'request_id' = current_setting('s7f.req5')), 1::bigint);
  PERFORM pg_temp.s7f_eq('Q1c that ask reads with the state of the link that represents it now — the '
    'successor, which the successor version swept away — and not with the state of the retired one',
    pg_temp.s7f_qrow(current_setting('s7f.req5')) ->> 'link_state', 'revoked');
  PERFORM pg_temp.s7f_eq('Q2 every row has the same shape, so a screen can be written against it once',
    (SELECT count(DISTINCT (SELECT array_agg(k ORDER BY k COLLATE "C")
                             FROM jsonb_object_keys(x) k))
       FROM jsonb_array_elements(q) x), 1::bigint);
  PERFORM pg_temp.s7f_eq('Q3 the statuses on offer are the four the schema knows, and the only open one '
    'is the ask made after the successor version landed — nothing the sweep passed over is left '
    'pretending to be open',
    (SELECT pg_temp.s7f_sorted(array_agg(DISTINCT x ->> 'status'))
       FROM jsonb_array_elements(q) x),
    pg_temp.s7f_sorted(ARRAY['approved', 'changes_requested', 'invalidated', 'pending']));
  PERFORM pg_temp.s7f_eq('Q3b and naming that open row is enough: it is this battery''s seventh ask, '
    'and it is the only one',
    (SELECT pg_temp.s7f_sorted(array_agg(x ->> 'request_id'))
       FROM jsonb_array_elements(q) x WHERE x ->> 'status' = 'pending'),
    ARRAY[current_setting('s7f.req7')]);
  PERFORM pg_temp.s7f_eq('Q4 the link states on offer are two, live and revoked: everything the sweep '
    'touched reads revoked, and the one ask made after it reads live',
    (SELECT pg_temp.s7f_sorted(array_agg(DISTINCT x ->> 'link_state'))
       FROM jsonb_array_elements(q) x),
    pg_temp.s7f_sorted(ARRAY['live', 'revoked']));
  PERFORM pg_temp.s7f_eq('Q5 and the single live row is the ask made after the sweep, which is the only '
    'way that ordering can be true',
    (SELECT count(*) FROM jsonb_array_elements(q) x WHERE x ->> 'link_state' = 'live'),
    1::bigint);
  PERFORM pg_temp.s7f_eq('Q6 §2.3: each row reports the version it was asked about, not the newest one '
    '— six asks against v1, one against v3',
    (SELECT count(*) FROM jsonb_array_elements(q) x WHERE x ->> 'version_number' = '1'),
    6::bigint);
  PERFORM pg_temp.s7f_eq('Q6b and the ask that names version 3 is the nephew''s, so the queue shows the '
    'document each person was actually shown',
    (SELECT pg_temp.s7f_qrow(current_setting('s7f.req7')) ->> 'reviewer_display_name'), 'Nephew');
  PERFORM pg_temp.s7f_eq('Q7 §3: the answered ask carries its one history entry, and the entry keeps '
    'both names — asked of, answered by — which is the doctrine made visible to the host',
    -- Parenthesised because `->>`, `->` and `||` sit at one precedence level in Postgres, so an
    -- unparenthesised chain of them reassociates and feeds `||` a jsonb value rather than a text.
    (SELECT (x -> 'history' -> 0 ->> 'author_label') || '/'
            || (x ->> 'reviewer_display_name')
       FROM jsonb_array_elements(q) x
      WHERE x ->> 'request_id' = current_setting('s7f.req1')), 'Son/Mother-in-law');
  PERFORM pg_temp.s7f_eq('Q8 a history entry is seven named things and no eighth',
    pg_temp.s7f_top_keys((SELECT x -> 'history' -> 0 FROM jsonb_array_elements(q) x
      WHERE x ->> 'request_id' = current_setting('s7f.req1'))),
    pg_temp.s7f_sorted(ARRAY['author_label', 'created_at', 'decision', 'id', 'kind', 'message',
                             'section_key']));
  PERFORM pg_temp.s7f_eq('Q9 §5.2: the objection arrives in the queue with its section pin and its text '
    'intact — nothing is summarised away on the way to the host',
    (SELECT (x -> 'history' -> 0 ->> 'section_key') || '|'
            || coalesce(x -> 'history' -> 0 ->> 'message', '-')
       FROM jsonb_array_elements(q) x
      WHERE x ->> 'request_id' = current_setting('s7f.req2')),
    'ceremonies|The muurtham time is hard to read for elders travelling from out of town.');
  PERFORM pg_temp.s7f_eq('Q10 the invalidated asks carry no history at all: closing an ask does not '
    'manufacture an answer, and an empty record is reported as empty',
    (SELECT count(*) FROM jsonb_array_elements(q) x
      WHERE x ->> 'status' = 'invalidated' AND jsonb_array_length(x -> 'history') = 0), 4::bigint);
  -- Two assertions rather than one concatenated pair: `->>` on a JSON null is SQL NULL, and NULL is
  -- not a string that survives `||`, so a combined check would report `<NULL>` for the very case it
  -- is trying to name.
  PERFORM pg_temp.s7f_eq('Q11 §2.3: the never-opened ask reports no instant in `link_last_used_at` at '
    'all — an unvisited link reports itself unvisited',
    (SELECT (pg_temp.s7f_qrow(current_setting('s7f.req6')) ->> 'link_last_used_at') IS NULL), true);
  PERFORM pg_temp.s7f_eq('Q11b while the one that was opened before it expired reports the instant it '
    'was read, which is the trace a forwarded link leaves for the host',
    (SELECT (pg_temp.s7f_qrow(current_setting('s7f.req4')) ->> 'link_last_used_at')::timestamptz
            IS NOT NULL), true);
  PERFORM pg_temp.s7f_eq('Q12 and the live ask still reports its fourteen-day window, minted by the '
    'default rather than by the host',
    (SELECT (x ->> 'requested_at')::timestamptz + interval '14 days'
            = (x ->> 'link_expires_at')::timestamptz
       FROM jsonb_array_elements(q) x
      WHERE x ->> 'request_id' = current_setting('s7f.req7')), true);

  -- The credential-material scan, one PASS per credential so a dropped case cannot hide in a count.
  raws := ARRAY[current_setting('s7f.tok1'), current_setting('s7f.tok2'),
                 current_setting('s7f.tok3'), current_setting('s7f.tok4'),
                 current_setting('s7f.tok5'), current_setting('s7f.tok6'),
                 current_setting('s7f.tok7'), current_setting('s7f.succ_raw'),
                 current_setting('s7f.guest_raw')];
  -- The ordinal in the label is the only identifier a loop over credentials may print: it names the
  -- slot in the array above, never the credential itself.
  i := 1;
  FOREACH raw IN ARRAY raws LOOP
    PERFORM pg_temp.s7f_ok('Q13 §I10: credential ' || i || ' of ' || cardinality(raws)
      || ' appears in the queue neither raw nor digested, and in no stored column of the database '
      'either',
      position(raw in q::text) = 0
      AND position(encode(extensions.digest(convert_to(raw, 'UTF8'), 'sha256'), 'hex') in q::text) = 0
      AND pg_temp.s7f_stored_hits(raw) = '{}'::text[]);
    i := i + 1;
  END LOOP;

  PERFORM pg_temp.s7f_eq('Q14 §2.3: the queue carries no guest list, no household, no storage object '
    'key and no RSVP material — it is a record of asks and answers about an invitation, not a view '
    'into the wedding''s other tables',
    (SELECT count(*) FROM unnest(ARRAY['The Raman family', 'wedding-assets', 'object_key',
                                       'rsvp', 'guest']) needle
      WHERE position(needle in q::text) > 0), 0::bigint);

  PERFORM pg_temp.s7f_run('QP1', 'authenticated', s.owner_b::text);
  PERFORM pg_temp.s7f_run('QP2', 'authenticated', '');
  PERFORM pg_temp.s7f_run('QP3', 'anon', NULL);
  PERFORM pg_temp.s7f_run('QP4', 'service_role', NULL);

  -- Disclosure, the other direction: a queue is a per-wedding window, not a per-owner one.
  q := pg_temp.s7f_auth(s.owner_b::text, 'SELECT api.get_approval_requests('
    || quote_literal(s.wed_b::text) || '::uuid)');
  PERFORM pg_temp.s7f_eq('Q15 the other family''s queue is an empty array, not an error and not a '
    'handful of rows borrowed from the neighbour', jsonb_typeof(q), 'array');
  PERFORM pg_temp.s7f_eq('Q16 and it holds nothing — seven asks in one wedding are invisible to the '
    'account that owns the next one', jsonb_array_length(q), 0);
  q := pg_temp.s7f_auth(s.owner_a::text, 'SELECT api.get_approval_requests('
    || quote_literal(s.wed_empty::text) || '::uuid)');
  PERFORM pg_temp.s7f_eq('Q17 a wedding nobody was ever asked about reads the same way: the queue is '
    'honest about emptiness', jsonb_array_length(q), 0);

  PERFORM pg_temp.s7f_eq('Q18 §2.3: the four link states the queue can name are read from the function '
    'body, not from a string in this file, so a fifth state cannot be added without failing here',
    (SELECT pg_temp.s7f_sorted(array_agg(DISTINCT m[1])) FROM pg_proc
      CROSS JOIN LATERAL regexp_matches(
              pg_get_functiondef('internal_api.get_approval_requests(uuid)'::regprocedure),
              '''(never_issued|revoked|expired|live)''', 'g') AS m),
    ARRAY['expired', 'live', 'never_issued', 'revoked']::text[]);
  PERFORM pg_temp.s7f_eq('Q19 and `never_issued` is not reachable by anything this build writes: every '
    'ask minted exactly one credential, so no row of any queue can read that way — a fact about the '
    'state machine, stated rather than implied by an absent case',
    (SELECT count(*) FROM jsonb_array_elements(current_setting('s7f.queue')::jsonb) x
      WHERE x ->> 'link_state' = 'never_issued'), 0::bigint);
END $Q$;

-- --------------------------------------------------------------------------- R: residue, scoped to this battery
-- The membership assertions are relational and therefore true whatever else the database holds. The
-- two global counts below are not: they are meaningful because `run.sh` applies the chain into a
-- fresh throwaway cluster with no seed, and they say so.
DO $R$
DECLARE s s7r%ROWTYPE; raws text[]; raw text; i integer;
BEGIN
  SELECT * INTO s FROM s7r;
  PERFORM pg_temp.s7f_eq('R1 no approval request exists that does not belong to one of this battery''s '
    'three weddings',
    (SELECT count(*) FROM public.approval_requests r
      WHERE r.wedding_id NOT IN (s.wed_a, s.wed_b, s.wed_empty)), 0::bigint);
  PERFORM pg_temp.s7f_eq('R2 no access token either — every credential in the store was minted here',
    (SELECT count(*) FROM private.access_tokens t
      WHERE t.wedding_id NOT IN (s.wed_a, s.wed_b, s.wed_empty)), 0::bigint);
  PERFORM pg_temp.s7f_eq('R3 and no feedback row',
    (SELECT count(*) FROM public.approval_feedback f
      WHERE f.wedding_id NOT IN (s.wed_a, s.wed_b, s.wed_empty)), 0::bigint);
  PERFORM pg_temp.s7f_eq('R4 the stranger''s wedding carries no review artefact of any kind: it got a '
    'successor version in I25 and never an ask',
    (SELECT (SELECT count(*) FROM public.approval_requests WHERE wedding_id = s.wed_b)
          + (SELECT count(*) FROM private.access_tokens
              WHERE wedding_id = s.wed_b AND token_kind = 'approval_review')
          + (SELECT count(*) FROM public.approval_feedback WHERE wedding_id = s.wed_b)), 0::bigint);
  PERFORM pg_temp.s7f_eq('R5 the wedding nobody asked about is still empty of asks',
    (SELECT count(*) FROM public.approval_requests WHERE wedding_id = s.wed_empty), 0::bigint);
  PERFORM pg_temp.s7f_eq('R6 one ask is left open in the whole database, and it is the nephew''s — the '
    'end state of this battery is one live link, deliberately, on the newest version. Fresh-cluster '
    'dependency stated: the count is global because nothing else writes here',
    (SELECT count(*) FROM public.approval_requests WHERE status = 'pending'), 1::bigint);
  PERFORM pg_temp.s7f_eq('R7 and exactly one review credential is live in the whole store, the same '
    'ask''s',
    (SELECT count(*) FROM private.access_tokens
      WHERE token_kind = 'approval_review' AND revoked_at IS NULL), 1::bigint);

  -- The final form of the §I10 claim: after every write the battery performed, including the sweep,
  -- no credential of any kind is recoverable from the database. One PASS per credential.
  raws := ARRAY[current_setting('s7f.tok1'), current_setting('s7f.tok2'),
                 current_setting('s7f.tok3'), current_setting('s7f.tok4'),
                 current_setting('s7f.tok5'), current_setting('s7f.tok6'),
                 current_setting('s7f.tok7'), current_setting('s7f.succ_raw'),
                 current_setting('s7f.guest_raw')];
  i := 1;
  FOREACH raw IN ARRAY raws LOOP
    PERFORM pg_temp.s7f_eq('R8 §I10: credential ' || i || ' of ' || cardinality(raws)
      || ' is stored nowhere in the clear, in any column of any table this product owns',
      pg_temp.s7f_stored_hits(raw), '{}'::text[]);
    i := i + 1;
  END LOOP;
END $R$;

-- --------------------------------------------------------------------------- L: the floor
-- The floor is the measured count at this head, not a rounded-down guess. It exists to catch a group
-- that stops running: a `DO` block whose fixture failed quietly would leave the groups after it
-- reading an empty database and still printing a pass. When a genuine assertion is added or removed
-- this number moves with it, and the assertion itself is made *through* the counter so the printed
-- total and the observed PASS lines cannot drift apart.
DO $L$
DECLARE ran integer;
BEGIN
  ran := coalesce(nullif(current_setting('s7f.passed', true), ''), '0')::int;
  IF ran < 254 THEN
    RAISE EXCEPTION 'FAIL: only % Stage 7 workflow assertions ran — the measured floor is 254', ran;
  END IF;
  PERFORM pg_temp.s7f_ok('L1 the counter, the fixtures and the floor all moved together ('
    || ran || ' assertions)', true);
END $L$;

SELECT 'STAGE7 FAMILY REVIEW TESTS PASSED (' || current_setting('s7f.passed') || ')';
