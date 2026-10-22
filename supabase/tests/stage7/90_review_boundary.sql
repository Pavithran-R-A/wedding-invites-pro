-- =============================================================================
-- Stage 7 battery 2: the boundary of what a family reviewer is shown, and what the
-- workflow is allowed to touch.
--
-- Battery 1 (`80_family_review.sql`) walks the state machine: it mints credentials, ages them,
-- revokes them, answers them and refuses them. This file asks the two questions that battery
-- 1 can only assume: *is the document behind the review door the right document and nothing
-- more*, and *does the workflow leave everything it was not told to touch alone*.
--
-- Run by `supabase/tests/stage7/run.sh` after the storage fixture, the whole migration chain
-- and battery 1, as the superuser, in one transaction that commits. It therefore reads
-- battery 1's committed residue rather than rebuilding it: the same three weddings, the same
-- three frozen versions, the same household. Group X re-derives that cast by title and asserts
-- it resolved to exactly one row, so a run in which battery 1 did not happen fails at X1 with a
-- named assertion instead of quietly comparing nothing. (Each battery runs in its own session,
-- so `pg_temp` helpers and GUCs are never shared; only rows are.)
--
-- The headline method is that the reviewer's document is compared against a *projection*, not
-- against a list. `80_family_review.sql` group D names the twelve keys a guest is given; a name
-- list can go stale. Here the reviewer's payload is compared, as a value, against
-- `private.public_invitation_dto(snapshot_schema_version, snapshot)` read straight out of the
-- frozen row the request is pinned to. If the review door ever diverges from the guest
-- projection — a new field, a dropped field, a second implementation that drifts — the two stop
-- being the same jsonb and P1 says so.
--
-- Where a leak is claimed, the leaked value is planted first. A reviewer is never shown the
-- household, its private host note, an RSVP answer, or a photograph's object key: each of those
-- facts is asserted twice, once that the value exists in the database with the marker this file
-- wrote, and once that the marker is absent from the answer. An absence with no matching
-- presence is not evidence.
--
--   X  the cast, re-derived from battery 1's residue, and the canaries planted in it
--   P  the reviewer's document is the guest projection — proved as a projection
--   K  what the review answer must never carry, with each canary's presence measured first
--   S  the frozen snapshot: the draft moved, a successor landed, the pinned document did not
--   G  who may write the three tables this workflow touches, and the exposed-surface census
--   C  cultural-authority review stays a separate surface, in both directions
--   N  the guest link is untouched by the review workflow, and the two credentials are not
--      interchangeable at either door
--   Z  the census this file leaves behind, named rather than summarised
--   L  the floor
--
-- Two scope statements, because both are narrower than a reader will assume:
--
-- 1. The canaries are planted by direct writes because no client path in this product produces
--    them: an RSVP needs a guest credential and a live form, `household_event_scopes` is
--    maintenance data, and a `ready` asset is planted as the Stage 6 battery plants it — a
--    staged row, a `storage.objects` row owned by the host, then the *host's own* confirmation
--    UPDATE, which is the path the upload adapter takes. Stage 6's second battery stands in for
--    the bucket the same way, for the same reason, and the standing-in is stated rather than
--    hidden.
-- 2. `invitation_drafts` is written directly too, and that one is not a stand-in: measured at
--    this head, no name in the group G census writes a draft (G1 enumerates the exposed names, and
--    a draft-writing verb would have to appear in that list to exist),
--    because the host edits the draft through row-level security on the table. A direct UPDATE
--    here is the product's own path, not a substitute for one.
-- =============================================================================

SET client_min_messages = notice;
SELECT set_config('s7b.passed', '0', false);

CREATE FUNCTION pg_temp.s7b_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s7b.passed',
    (coalesce(nullif(current_setting('s7b.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s7b_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s7b_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s7b_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s7b_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s7b_sorted(want text[]) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM unnest(coalesce(want, '{}'::text[])) u(k) $fn$;

-- Which schema head this run is qualifying. The group G census below counts the exposed surface of
-- the *whole* cluster, not just this workflow's, so it is the part of Stage 7's battery that a later
-- stage cannot leave alone: Stage 8 adds six verbs, and an assertion pinned at thirteen would fail
-- for a change that has nothing to do with family review. Unset means this file's own head, so
-- `supabase/tests/stage7/run.sh` still measures exactly what it was written against.
CREATE FUNCTION pg_temp.s7b_head() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(current_setting('app.stage_head', true), 'stage7') $fn$;

-- Ordinal, not equality, for the reason every runner since Stage 5 records: heads are cumulative, so
-- a census keyed on `= 'stage8'` would hand a later chain the older expectations. A malformed head
-- raises rather than choosing a branch, so a typo in PGOPTIONS reports itself instead of passing.
CREATE FUNCTION pg_temp.s7b_at_least(want text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $fn$
DECLARE h int; w int;
BEGIN
  IF pg_temp.s7b_head() !~ '^stage[0-9]+$' OR want !~ '^stage[0-9]+$' THEN
    RAISE EXCEPTION 's7b_at_least: a stage head must be spelled stage<n> — got head=% want=%',
      pg_temp.s7b_head(), want;
  END IF;
  h := regexp_replace(pg_temp.s7b_head(), '^stage', '')::int;
  w := regexp_replace(want, '^stage', '')::int;
  RETURN h >= w;
END
$fn$;

CREATE FUNCTION pg_temp.s7b_top_keys(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM jsonb_object_keys(v) u(k) $fn$;

-- The top-level member names, or the single refusal this door gives when it will not answer.
CREATE FUNCTION pg_temp.s7b_has_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % , not an object', label, jsonb_typeof(v);
  END IF;
  PERFORM pg_temp.s7b_eq(label, pg_temp.s7b_top_keys(v), pg_temp.s7b_sorted(want));
END $fn$;

-- Is `needle` nowhere in the serialised answer? Compared on the text rather than on a walked key
-- path, because the claim is about what a reviewer could read out of the response body, whichever
-- member it hid in. An empty needle would make this false rather than silently true.
CREATE FUNCTION pg_temp.s7b_absent(v jsonb, needle text) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT v IS NOT NULL AND needle IS NOT NULL AND needle <> ''
         AND position(needle in v::text) = 0 $fn$;

-- The contact-name scanner, and the only honest way to state it: a case-insensitive text search
-- for a JSON member name that would carry a way to reach a person. K14 runs it against a synthetic
-- object that does contain one, so a scanner that silently matched nothing could not pass.
CREATE FUNCTION pg_temp.s7b_contact_hits(v jsonb) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT v::text ~*
    '"(email|e-mail|phone|mobile|whatsapp|contact_text|contact|address_line|aadhaar|ssn)"[[:space:]]*:' $fn$;

-- The guest projection of a frozen version, computed from the row itself. This is the other half
-- of P1: the reviewer's answer is not compared to a transcription of a comment, it is compared to
-- what the same function returns for the same snapshot when no door is involved at all.
CREATE FUNCTION pg_temp.s7b_dto(p_version_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $fn$
  SELECT private.public_invitation_dto(v.snapshot_schema_version, v.snapshot)
    FROM public.invitation_versions v WHERE v.id = p_version_id $fn$;

-- How many rows a caller can actually see, measured as that caller.
CREATE FUNCTION pg_temp.s7b_visible(role text, uid uuid, select_sql text) RETURNS bigint
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

-- Defined here, not where the G8 block uses them: a DO block resolves a function reference when it
-- reaches the statement, so a helper declared later in the file does not exist yet for the block
-- above it.
CREATE FUNCTION pg_temp.s7b_owner_a() RETURNS uuid
LANGUAGE sql STABLE AS $fn$ SELECT current_setting('s7b.owner_a')::uuid $fn$;
CREATE FUNCTION pg_temp.s7b_owner_b() RETURNS uuid
LANGUAGE sql STABLE AS $fn$ SELECT current_setting('s7b.owner_b')::uuid $fn$;

CREATE TEMP TABLE probes (
  grp         text,
  label       text,
  stmt        text,
  want_state  text,
  want_like   text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.s7b_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

CREATE FUNCTION pg_temp.s7b_run(p_grp text, p_role text, p_uid text) RETURNS void
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
            FROM probes p WHERE p.grp = s7b_run.p_grp ORDER BY p.label) s;

  IF v_labels IS NULL THEN
    RAISE EXCEPTION 'FAIL: probe group % ran no probes — an empty group is a skip, not a pass', p_grp;
  END IF;

  FOR i IN 1 .. cardinality(v_labels) LOOP
    EXECUTE 'SET ROLE ' || p_role;
    IF p_uid IS NOT NULL THEN
      PERFORM set_config('test.uid', p_uid, false);
    END IF;
    v := pg_temp.s7b_err(v_stmts[i]);
    EXECUTE 'RESET ROLE';

    IF v = 'no-error' THEN
      RAISE EXCEPTION 'FAIL %: "%" was allowed through', p_grp, v_labels[i];
    END IF;
    IF split_part(v, ' ', 1) <> v_states[i] OR v NOT LIKE v_likes[i] THEN
      RAISE EXCEPTION 'FAIL %: "%" got [%] want [% / %]',
        p_grp, v_labels[i], v, v_states[i], v_likes[i];
    END IF;
    RAISE NOTICE 'PASS %: %', p_grp, v_labels[i];
    PERFORM pg_temp.s7b_add(1);
  END LOOP;
END $fn$;

-- A host verb called by the account that owns the wedding. A refusal inside this helper is a
-- battery failure, not a measured answer.
CREATE FUNCTION pg_temp.s7b_auth(uid text, stmt text) RETURNS jsonb
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

-- The same, for a host write that returns no rows: the confirmation UPDATE that moves a staged
-- asset to `ready`, and the draft edit. A refusal here is a battery failure.
CREATE FUNCTION pg_temp.s7b_host_do(uid text, stmt text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('test.uid', coalesce(uid, ''), false);
  EXECUTE 'SET ROLE authenticated';
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL: expected success, got % | % for %', SQLSTATE, SQLERRM, stmt;
  END;
  EXECUTE 'RESET ROLE';
END $fn$;

-- The review door as an account-free visitor experiences it: header-borne credential, the
-- zero-argument resolver, the `anon` role.
CREATE FUNCTION pg_temp.s7b_open(raw text) RETURNS jsonb
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

CREATE FUNCTION pg_temp.s7b_answer(raw text, decision text, label text,
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

-- The guest door. `which` names the header this credential belongs in, so a cross-kind probe can
-- put a review credential where a guest credential belongs and nothing else.
CREATE FUNCTION pg_temp.s7b_door(which text, raw text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  IF which NOT IN ('review', 'guest') THEN
    RAISE EXCEPTION 'FAIL: % is not a door this file knows', which;
  END IF;
  PERFORM set_config('request.headers',
    jsonb_build_object(
      CASE WHEN which = 'review' THEN 'x-review-token' ELSE 'x-invitation-token' END,
      raw)::text, false);
  EXECUTE 'SET ROLE anon';
  BEGIN
    SELECT CASE WHEN which = 'review' THEN api.resolve_family_review()
                ELSE api.resolve_public_invitation() END INTO v;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $fn$;

-- A host ask, minted through the host verb. It returns the verb's own answer, unchanged, with the
-- two version pointers this file needs added beside it — so a caller that asserts the answer's
-- shape is asserting the product's shape, not this helper's projection of it. Kept together
-- because every group that needs a live link needs both, and a raw credential cannot be read back
-- out of the database afterwards by design.
CREATE FUNCTION pg_temp.s7b_ask(p_version_number integer, p_name text) RETURNS jsonb
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb; vid uuid;
BEGIN
  SELECT x.id INTO vid FROM public.invitation_versions x
    WHERE x.wedding_id = current_setting('s7b.wed_a')::uuid
      AND x.version_number = p_version_number;
  IF vid IS NULL THEN
    RAISE EXCEPTION 'FAIL: this wedding has no version % to ask about', p_version_number;
  END IF;
  v := pg_temp.s7b_auth(current_setting('s7b.owner_a'),
    'SELECT api.request_family_review(' || quote_literal(current_setting('s7b.wed_a')) || '::uuid, '
    || quote_literal(vid::text) || '::uuid, ' || quote_literal(p_name) || ', NULL)');
  RETURN v || jsonb_build_object('version_id', vid::text,
                                 'version_number', p_version_number::text);
END $fn$;

-- --------------------------------------------------------------------------- X: the cast
-- The marker strings are this file's own. They are written into the private columns of the
-- residue so that every "the reviewer is not shown X" below has an X that exists.
CREATE TEMP TABLE s7c ON COMMIT DROP AS
SELECT wa.id AS wed_a, wa.owner_user_id AS owner_a,
       wb.id AS wed_b, wb.owner_user_id AS owner_b,
       we.id AS wed_empty,
       v1.id AS ver1, v3.id AS ver3,
       hh.id AS household,
       ev.id AS event
  FROM public.weddings wa
  JOIN public.weddings wb ON wb.title = 'Bala weds Divya'
  JOIN public.weddings we ON we.title = 'Nothing Asked'
  JOIN public.invitation_versions v1 ON v1.wedding_id = wa.id AND v1.version_number = 1
  JOIN public.invitation_versions v3 ON v3.wedding_id = wa.id AND v3.version_number = 3
  JOIN public.guest_households hh ON hh.wedding_id = wa.id
  JOIN public.wedding_events ev ON ev.wedding_id = wa.id AND ev.event_key = 'muurtham'
 WHERE wa.title = 'Asha weds Bala';

SELECT set_config('s7b.mk_household', 'ZZ-BOUNDARY-HOUSEHOLD-NOTE', false);
SELECT set_config('s7b.mk_rsvp',      'ZZ-BOUNDARY-RSVP-ANSWER', false);
SELECT set_config('s7b.mk_salut',     'ZZ-BOUNDARY-SALUTATION', false);
SELECT set_config('s7b.mk_draft',     'ZZ-DRAFT-EDIT-WELCOME-MARKER', false);

DO $X$
DECLARE s s7c%ROWTYPE; v jsonb; aid uuid; ak text;
BEGIN
  SELECT * INTO s FROM s7c;
  PERFORM set_config('s7b.wed_a',   s.wed_a::text,  false);
  PERFORM set_config('s7b.owner_a',  s.owner_a::text, false);
  PERFORM set_config('s7b.wed_b',   s.wed_b::text,  false);
  PERFORM set_config('s7b.owner_b',  s.owner_b::text, false);
  PERFORM set_config('s7b.ver1',    s.ver1::text,   false);
  PERFORM set_config('s7b.ver3',    s.ver3::text,   false);

  PERFORM pg_temp.s7b_eq('X1 the cast this file borrows from battery 1 resolved to exactly one '
    'wedding per title — a run in which battery 1 did not happen stops here rather than comparing '
    'nothing', (SELECT count(*) FROM s7c), 1::bigint);

  PERFORM pg_temp.s7b_eq('X2 the reviewed wedding still carries three frozen versions, numbered 1, '
    '2 and 3 — S1 adds a fourth, so this is measured now and not assumed later',
    (SELECT array_agg(v.version_number::text ORDER BY v.version_number)
       FROM public.invitation_versions v WHERE v.wedding_id = s.wed_a),
    ARRAY['1','2','3']::text[]);

  PERFORM pg_temp.s7b_eq('X3 battery 1 left seven asks on this wedding, and exactly one of them is '
    'still open — the end state its own R6 assertion declared',
    (SELECT count(*) FROM public.approval_requests r WHERE r.wedding_id = s.wed_a), 7::bigint);
  PERFORM pg_temp.s7b_eq('X3b and the one open ask is pinned to version 3, the newest: battery 1 '
    'deliberately ends with a live link on the current document, which is why nothing in this file '
    'has to reuse it',
    (SELECT array_agg(r.status || ':' || v.version_number::text)
       FROM public.approval_requests r
       JOIN public.invitation_versions v ON v.id = r.version_id
      WHERE r.wedding_id = s.wed_a AND r.status = 'pending'),
    ARRAY['pending:3']::text[]);

  PERFORM pg_temp.s7b_eq('X4 one guest credential and one review credential are live at the start, '
    'and they are different kinds — the pair N1 then follows through the whole review lifecycle',
    (SELECT ARRAY[
        (SELECT count(*) FROM private.access_tokens t WHERE t.wedding_id = s.wed_a
           AND t.token_kind = 'public_invitation' AND t.revoked_at IS NULL)::text,
        (SELECT count(*) FROM private.access_tokens t WHERE t.wedding_id = s.wed_a
           AND t.token_kind = 'approval_review' AND t.revoked_at IS NULL)::text]::text[]),
      ARRAY['1', '1']::text[]);

  -- The canaries.
  UPDATE public.guest_households h
     SET host_notes = current_setting('s7b.mk_household'),
         salutation = current_setting('s7b.mk_salut')
   FROM s7c c WHERE h.id = c.household;

  INSERT INTO public.household_event_scopes (wedding_id, household_id, event_id)
  SELECT c.wed_a, c.household, c.event FROM s7c c;

  INSERT INTO public.rsvp_responses (id, wedding_id, household_id, event_id, attending,
                                     party_size, response_source, answers)
  SELECT gen_random_uuid(), c.wed_a, c.household, c.event, 'attending', 4, 'guest',
         jsonb_build_object('meal', current_setting('s7b.mk_rsvp'))
    FROM s7c c;

  -- A `ready` photograph, made the way the product makes one: the row starts staged with a key the
  -- database mints, the bytes are recorded as the host's own object, and the *host* confirms it.
  -- The mint trigger refuses a supplied key and refuses a row that does not start staged, so an
  -- INSERT that claimed `ready` directly would not be this product's asset at all — and the
  -- confirmation is a host write, which is what makes the leak claim below about the real thing.
  INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, label, mime_type, size_bytes)
  SELECT gen_random_uuid(), c.wed_a, 'photo', 'Boundary probe photo', 'image/png', 1024 FROM s7c c
  RETURNING id, object_key INTO aid, ak;
  PERFORM set_config('s7b.asset_key', ak, false);

  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  SELECT 'wedding-assets', ak, c.owner_a, c.owner_a::text,
         jsonb_build_object('mimetype', 'image/png', 'size', 1024) FROM s7c c;

  PERFORM pg_temp.s7b_host_do(s.owner_a::text,
    'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = '
    || quote_literal(aid::text) || '::uuid');

  PERFORM pg_temp.s7b_eq('X5 every canary landed where it was written — a host note, a salutation, '
    'an RSVP answer, a household invitation scope, and one photograph that reached `ready` through '
    'the host''s own confirmation: five present values, without which the leak checks below would '
    'be vacuous',
    (SELECT count(*) FROM public.guest_households h
      WHERE h.host_notes = current_setting('s7b.mk_household')
        AND h.salutation = current_setting('s7b.mk_salut'))
    + (SELECT count(*) FROM public.rsvp_responses r
        WHERE r.answers ->> 'meal' = current_setting('s7b.mk_rsvp'))
    + (SELECT count(*) FROM public.household_event_scopes e WHERE e.household_id = s.household)
    + (SELECT count(*) FROM public.wedding_assets a WHERE a.id = aid
        AND a.upload_status = 'ready')
    + (SELECT count(*) FROM storage.objects o WHERE o.name = ak),
    5::bigint);

  PERFORM pg_temp.s7b_eq('X6 the object key really is the database''s own four-segment mint — '
    'weddings/<wedding>/<kind>/<row id>, with no file name to leak — and it is the value K6 then '
    'looks for',
    (SELECT ARRAY[(SELECT a.object_key FROM public.wedding_assets a WHERE a.id = aid)]::text[]
      = ARRAY[ak]::text[]), true);

  PERFORM pg_temp.s7b_eq('X6b and the household is genuinely a *different* family from the ones the '
    'invitation names: the reviewed document speaks of Maran and Kovalan, while the planted '
    'household is The Raman family — so K1 is not refusing text that was never there to show',
    pg_temp.s7b_sorted(ARRAY[
      (SELECT p.display_name FROM public.wedding_people p
        WHERE p.wedding_id = s.wed_a AND p.display_order = 0),
      (SELECT p.display_name FROM public.wedding_people p
        WHERE p.wedding_id = s.wed_a AND p.display_order = 1),
      (SELECT h.display_name FROM public.guest_households h WHERE h.id = s.household)]),
    ARRAY['Kovalan', 'Maran', 'The Raman family']::text[]);

  -- The two credentials this file runs on. Battery 1's raws are gone by design — a raw credential
  -- is never stored, so no later file can recover one — so this file mints its own ask, pinned to
  -- version 1, and obtains a guest raw by rotation, whose credential arrives inside a URL path.
  v := pg_temp.s7b_ask(1, 'Boundary aunt');
  PERFORM set_config('s7b.raw', v ->> 'review_token', false);
  PERFORM set_config('s7b.req', v ->> 'request_id', false);

  PERFORM pg_temp.s7b_has_keys('X7 the ask answers with three names and no fourth, and the review '
    'credential is among them — unlike the guest link, there is no `path` to carry it in §2.1',
    v - 'version_id' - 'version_number',
    ARRAY['expires_at', 'request_id', 'review_token']);

  v := pg_temp.s7b_auth(s.owner_a::text,
    'SELECT api.rotate_invitation_token(' || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM set_config('s7b.gue', split_part(v ->> 'path', '/', 3), false);
  PERFORM set_config('s7b.gpath', v ->> 'path', false);

  PERFORM pg_temp.s7b_eq('X8 and the guest answer is a *path*: `/i/` then 43 characters — the '
    'credential is a URL segment by Stage 3 design, which is exactly the thing the review '
    'credential is not',
    ARRAY[left(v ->> 'path', 3), (length(split_part(v ->> 'path', '/', 3)))::text],
    ARRAY['/i/', '43']::text[]);

  PERFORM pg_temp.s7b_eq('X9 the rotated guest credential is now the only live one, and its row id '
    'and mint time are captured so N1 can prove the whole review lifecycle never touched that '
    'specific row',
    (SELECT count(*) FROM private.access_tokens t WHERE t.wedding_id = s.wed_a
       AND t.token_kind = 'public_invitation' AND t.revoked_at IS NULL), 1::bigint);
  PERFORM set_config('s7b.guest_tok',
    (SELECT t.id::text FROM private.access_tokens t WHERE t.wedding_id = s.wed_a
       AND t.token_kind = 'public_invitation' AND t.revoked_at IS NULL), false);
  PERFORM set_config('s7b.guest_created',
    (SELECT t.created_at::text FROM private.access_tokens t WHERE t.wedding_id = s.wed_a
       AND t.token_kind = 'public_invitation' AND t.revoked_at IS NULL), false);

  PERFORM pg_temp.s7b_eq('X10 the published version this wedding''s guest link points at is version '
    '2, which is a *different row* from the version 1 the review ask is pinned to — P5 reads this '
    'number, and S is what forces the two documents apart in content',
    (SELECT v.version_number FROM public.publications p
       JOIN public.invitation_versions v ON v.id = p.version_id
      WHERE p.wedding_id = s.wed_a AND p.status = 'active'), 2);
END $X$;

-- --------------------------------------------------------------------------- P: the projection
DO $P$
DECLARE v jsonb; r jsonb; g jsonb; d1 jsonb; pub uuid;
BEGIN
  d1 := pg_temp.s7b_dto(current_setting('s7b.ver1')::uuid);
  v  := pg_temp.s7b_open(current_setting('s7b.raw'));
  r  := v -> 'review';
  g  := pg_temp.s7b_door('guest', current_setting('s7b.gue')) -> 'invitation';
  pub := (SELECT p.version_id FROM public.publications p
           WHERE p.wedding_id = current_setting('s7b.wed_a')::uuid AND p.status = 'active');

  PERFORM pg_temp.s7b_eq('P0 the pinned version really does project, into a twelve-name object — if '
    'this half were NULL every equality below would be comparing nothing',
    cardinality(pg_temp.s7b_top_keys(d1))::bigint, 12::bigint);

  PERFORM pg_temp.s7b_eq('P1 the review door answers with the guest projection of the very snapshot '
    'the request is pinned to — compared as a value against `private.public_invitation_dto` computed '
    'straight from `invitation_versions`, not against a transcription of a comment',
    r -> 'invitation', d1);

  PERFORM pg_temp.s7b_has_keys('P2 and the answer itself is two names — the guest document is '
    'reached inside `review`, which is the only review-specific member §4 adds',
    v, ARRAY['available', 'review']);

  PERFORM pg_temp.s7b_has_keys('P3 the review block is seven named things, the same seven battery 1 '
    'measured, restated here because P7 and S5 depend on the document and the version pointer being '
    'inside this object', r,
    ARRAY['expires_at', 'invitation', 'request_id', 'requested_at', 'reviewer_display_name',
          'section_keys', 'version_number']);

  PERFORM pg_temp.s7b_eq('P4 a reviewer and a guest are handed the same *shape*: the twelve names in '
    'the review document are exactly the twelve names the guest door hands for this wedding — '
    'compared key-set to key-set, so a second review DTO could not be added without this moving',
    pg_temp.s7b_top_keys(r -> 'invitation'), pg_temp.s7b_top_keys(g));

  PERFORM pg_temp.s7b_eq('P5 the guest door is reading a *different frozen row* right now — the '
    'publication points at version 2 while this credential is pinned to version 1 — so P1 is a claim '
    'about a version the guest is not currently shown, not about whichever row happens to be live',
    ARRAY[(pub = current_setting('s7b.ver1')::uuid)::text,
          (SELECT v.version_number::text FROM public.invitation_versions v WHERE v.id = pub)],
    ARRAY['false', '2']::text[]);

  -- The honest half of the pairing. Battery 1 froze versions 1 and 2 from one draft without an edit
  -- between them, so at this instant the two projections *are* equal as values. Saying so is what
  -- keeps P4 from being read as a proof it does not carry: equal values here show the doors agree,
  -- and S5 is where the documents are forced apart and the doors are re-compared.
  PERFORM pg_temp.s7b_eq('P6 and their values coincide at this head because battery 1 froze v1 and '
    'v2 from an unedited draft — recorded, not hidden: it means P4''s shape agreement has not yet '
    'been tested against two different documents, which is exactly what S5 does',
    (r -> 'invitation') = pg_temp.s7b_dto(pub), true);

  PERFORM pg_temp.s7b_eq('P7 the review answer reports the version it is pinned to, and the store '
    'agrees: `version_number` 1, and the request this credential was minted for names version 1',
    ARRAY[r ->> 'version_number',
          (SELECT v.version_number::text FROM public.approval_requests q
             JOIN public.invitation_versions v ON v.id = q.version_id
            WHERE q.id::text = current_setting('s7b.req'))],
    ARRAY['1', '1']::text[]);

  PERFORM pg_temp.s7b_eq('P8 the guest answer carries no `review` member — the projection is shared, '
    'the review metadata is not, and a guest cannot read a family ask through the invitation door',
    pg_temp.s7b_top_keys(pg_temp.s7b_door('guest', current_setting('s7b.gue'))),
    ARRAY['available', 'invitation']::text[]);

  PERFORM pg_temp.s7b_eq('P9 and no member of the review document is named `request_id`, '
    '`reviewer_display_name` or `section_keys` — the review framing sits beside the document, never '
    'inside the thing a guest is also shown, so the guest projection cannot acquire review fields by '
    'accident',
    ARRAY[jsonb_exists(r -> 'invitation', 'request_id'),
          jsonb_exists(r -> 'invitation', 'reviewer_display_name'),
          jsonb_exists(r -> 'invitation', 'section_keys')],
    ARRAY[false, false, false]::boolean[]);

  PERFORM pg_temp.s7b_eq('P10 the review answer holds no path-shaped value at all: the guest link is '
    '`/i/<credential>` and the review credential is header-only, so a screenshot of a review page '
    'cannot carry a URL that reopens it §3',
    position('/i/' in v::text), 0);

  PERFORM pg_temp.s7b_has_keys('P11 read as its owner, the host queue gives twelve named things per '
    'ask — and among them is the link''s *state*, never a credential or a path §9',
    (SELECT el FROM jsonb_array_elements(
        pg_temp.s7b_auth(current_setting('s7b.owner_a'),
          'SELECT api.get_approval_requests('
          || quote_literal(current_setting('s7b.wed_a')) || '::uuid)')) el
      WHERE el ->> 'reviewer_display_name' = 'Boundary aunt'),
    ARRAY['history', 'invalidated_at', 'link_expires_at', 'link_last_used_at', 'link_state',
          'request_id', 'requested_at', 'responded_at', 'reviewer_display_name', 'status',
          'version_id', 'version_number']);

  PERFORM pg_temp.s7b_eq('P12 and of those twelve, the three that would carry a credential are '
    'absent while the one that carries its state is present — the same rule the guest publication '
    'state follows',
    ARRAY[jsonb_exists((SELECT el FROM jsonb_array_elements(
            pg_temp.s7b_auth(current_setting('s7b.owner_a'),
              'SELECT api.get_approval_requests('
              || quote_literal(current_setting('s7b.wed_a')) || '::uuid)')) el
            WHERE el ->> 'reviewer_display_name' = 'Boundary aunt'), 'path'),
          jsonb_exists((SELECT el FROM jsonb_array_elements(
            pg_temp.s7b_auth(current_setting('s7b.owner_a'),
              'SELECT api.get_approval_requests('
              || quote_literal(current_setting('s7b.wed_a')) || '::uuid)')) el
            WHERE el ->> 'reviewer_display_name' = 'Boundary aunt'), 'url'),
          jsonb_exists((SELECT el FROM jsonb_array_elements(
            pg_temp.s7b_auth(current_setting('s7b.owner_a'),
              'SELECT api.get_approval_requests('
              || quote_literal(current_setting('s7b.wed_a')) || '::uuid)')) el
            WHERE el ->> 'reviewer_display_name' = 'Boundary aunt'), 'token')],
    ARRAY[false, false, false]::boolean[]);
END $P$;

-- --------------------------------------------------------------------------- K: what it must not carry
DO $K$
DECLARE v jsonb; s s7c%ROWTYPE;
BEGIN
  SELECT * INTO s FROM s7c;
  v := pg_temp.s7b_open(current_setting('s7b.raw'));

  PERFORM pg_temp.s7b_eq('K1 the household that exists on this wedding is not in the review answer '
    'at all — its display name, measured present in the table first (X6b), absent here',
    pg_temp.s7b_absent(v, (SELECT h.display_name FROM public.guest_households h
                            WHERE h.id = s.household)), true);

  PERFORM pg_temp.s7b_eq('K2 nor is its salutation, the exact words the host wrote for that '
    'family''s own invitation',
    pg_temp.s7b_absent(v, current_setting('s7b.mk_salut')), true);

  PERFORM pg_temp.s7b_eq('K3 nor the private host note, which is a host''s memory about a guest, '
    'not part of any document',
    pg_temp.s7b_absent(v, current_setting('s7b.mk_household')), true);

  PERFORM pg_temp.s7b_eq('K4 nor the RSVP answer planted here: who is coming, in what number, and '
    'what they asked to be served. I-13 was recorded as "not applicable yet" in Stage 2 because '
    'there was no reviewer identity; with one now, it holds because the projection has no such '
    'member at all',
    pg_temp.s7b_absent(v, current_setting('s7b.mk_rsvp')), true);

  PERFORM pg_temp.s7b_eq('K5 and no RSVP-shaped member exists to carry one: the document speaks of '
    'people and events, never of replies, and the household scope row this file planted is not '
    'reachable through any name the answer uses',
    ARRAY[jsonb_exists(v -> 'review' -> 'invitation', 'rsvp'),
          jsonb_exists(v -> 'review' -> 'invitation', 'rsvps'),
          jsonb_exists(v -> 'review' -> 'invitation', 'guests'),
          jsonb_exists(v -> 'review' -> 'invitation', 'households')],
    ARRAY[false, false, false, false]::boolean[]);

  -- Stage 6's boundary over the review door: the pointer is the sensitive half, so the object key
  -- and any hint of a signed URL are the things to look for.
  PERFORM pg_temp.s7b_eq('K6 the Stage 6 private asset boundary holds over the review door for the '
    'same reason it holds over the guest door: the ready photograph''s minted object key is nowhere '
    'in the answer §7',
    pg_temp.s7b_absent(v, current_setting('s7b.asset_key')), true);

  PERFORM pg_temp.s7b_eq('K6b nor is the key''s shape even hinted at: the answer contains no '
    '`weddings/` prefix, and the asset exists (X5) while its pointer does not appear',
    position('weddings/' in v::text), 0);

  PERFORM pg_temp.s7b_eq('K7 nor is any `wedding_assets`-shaped member present — no key, no mime '
    'type, no size, no signed URL, no `assets` list to hold one',
    ARRAY[jsonb_exists(v -> 'review' -> 'invitation', 'assets'),
          jsonb_exists(v -> 'review' -> 'invitation', 'photos'),
          jsonb_exists(v, 'object_key'),
          jsonb_exists(v, 'signed_url')],
    ARRAY[false, false, false, false]::boolean[]);

  -- Measured, not assumed: a bare `position('sign' …)` test found this payload "leaking", because the
  -- guest projection legitimately carries a `design_template` member. So the needles below are
  -- anchored to a word boundary — they refuse a *name* a reviewer could point a client at, which is
  -- the claim — and K8a then names the one letter-run they deliberately do not refuse.
  PERFORM pg_temp.s7b_eq('K8 and the answer contains no storage or signature vocabulary as a member '
    'name, so a reviewer cannot reconstruct a key from parts the payload does carry',
    (SELECT count(*) FROM regexp_matches(lower(v::text),
       '(^|[^a-z])(storage|signature|signed|sign|sign_url|signed_url|bucket|object_key)([^a-z]|$)',
       'g')), 0::bigint);

  PERFORM pg_temp.s7b_eq('K8a and the single `sign`-bearing word K8 does not refuse is named: it is '
    '`design_template`, a member of the guest projection both doors share — an absence checked '
    'against a presence, so K8 cannot pass by accident',
    pg_temp.s7b_sorted(ARRAY(SELECT DISTINCT m[1] FROM regexp_matches(lower(v::text),
      '[a-z_]*sign[a-z_]*', 'g') m)),
    ARRAY['design_template']::text[]);

  PERFORM pg_temp.s7b_eq('K9 the review credential is not in the review answer: the raw string the '
    'door was just given is nowhere in what it sent back §I10',
    pg_temp.s7b_absent(v, current_setting('s7b.raw')), true);

  PERFORM pg_temp.s7b_eq('K9b nor is the guest credential, nor a digest of either, nor any member '
    'named to hold one',
    ARRAY[pg_temp.s7b_absent(v, current_setting('s7b.gue'))::text,
          position('token_hash' in v::text)::text,
          jsonb_exists(v, 'review_token')::text,
          jsonb_exists(v, 'token')::text],
    ARRAY['true', '0', 'false', 'false']::text[]);

  PERFORM pg_temp.s7b_eq('K10 the reviewer is shown only their own ask: the answer names the request '
    'this credential was minted for, and not one of the seven reviewer names battery 1 wrote on '
    'this wedding appears anywhere in it',
    ARRAY[((v -> 'review' ->> 'request_id') = current_setting('s7b.req'))::text,
          (SELECT count(*) FROM unnest(pg_temp.s7b_sorted(ARRAY['Aunt', 'Brother', 'Grandfather',
                  'Grandmother', 'Mother-in-law', 'Nephew', 'Sister'])) nm
             WHERE position(nm in v::text) > 0)::text],
    ARRAY['true', '0']::text[]);

  -- The presence half of K10, because an absence with no matching presence is not evidence: those
  -- seven names are rows on this same wedding, and the host can read all of them right now.
  PERFORM pg_temp.s7b_eq('K10c and the seven names K10 refuses are present in the same wedding, one '
    'per ask, where the host''s own queue reads them all — so the review door is withholding real '
    'material, not reporting an empty table',
    (SELECT count(*) FROM jsonb_array_elements(
        pg_temp.s7b_auth(current_setting('s7b.owner_a'),
          'SELECT api.get_approval_requests('
          || quote_literal(current_setting('s7b.wed_a')) || '::uuid)')) el
      WHERE el ->> 'reviewer_display_name' = ANY(pg_temp.s7b_sorted(ARRAY['Aunt', 'Brother',
        'Grandfather', 'Grandmother', 'Mother-in-law', 'Nephew', 'Sister']))), 7::bigint);

  PERFORM pg_temp.s7b_eq('K10b and the one personal name the answer does carry is the one the host '
    'typed for this ask §2.4 — possession of the link is not treated as an identity, so the name is '
    'decoration and the credential is the authority',
    ARRAY[v -> 'review' ->> 'reviewer_display_name',
          (SELECT r.reviewer_display_name FROM public.approval_requests r
            WHERE r.id::text = current_setting('s7b.req'))],
    ARRAY['Boundary aunt', 'Boundary aunt']::text[]);

  -- Other families' invitations, and other tenants' documents, are the same class of "unrelated
  -- disclosure": the door is scoped by (wedding, request, version), so the payload can only be one
  -- document.
  PERFORM pg_temp.s7b_eq('K11 the stranger wedding on this cluster is not in the answer either: its '
    'title is a real, frozen document owned by another account, and nothing about it crosses over',
    position('Bala weds Divya' in v::text), 0);

  PERFORM pg_temp.s7b_eq('K12 nor is any of its people — the other account''s father and bride are '
    'rows this credential cannot address at all',
    ARRAY[position('Sivan' in v::text), position('Vallu' in v::text)],
    ARRAY[0, 0]::int[]);

  PERFORM pg_temp.s7b_eq('K13 the reviewer gets no history member: what the family said is the '
    'host''s read, not a second reviewer''s, and an open link shows only the ask it belongs to',
    ARRAY[jsonb_exists(v -> 'review', 'history'),
          jsonb_exists(v -> 'review', 'feedback'),
          jsonb_exists(v -> 'review', 'requests')],
    ARRAY[false, false, false]::boolean[]);

  -- The scanner itself, proved live. Without this a broken regexp would silently pass every
  -- "absent" claim above.
  PERFORM pg_temp.s7b_eq('K14 the contact-name scanner is not vacuous: run against a synthetic '
    'object that does carry an `email` member it reports a hit, so its silence on the review answer '
    'means something',
    pg_temp.s7b_contact_hits(jsonb_build_object('person',
      jsonb_build_object('name', 'X', 'email', 'a@example.test'))), true);

  PERFORM pg_temp.s7b_eq('K15 and it stays quiet on the real answer, at every depth, for every '
    'contact-shaped member name it looks for',
    pg_temp.s7b_contact_hits(v), false);

  PERFORM pg_temp.s7b_eq('K16 the schema itself keeps the promise: the projection has no contact '
    'member, and although `approval_requests` carries a `reviewer_contact_text` column, the review '
    'answer has no member named for it, because §2.4 leaves it NULL and §4 never projects it',
    ARRAY[jsonb_exists(v -> 'review' -> 'invitation', 'contact')::text,
          jsonb_exists(v -> 'review', 'reviewer_contact_text')::text,
          (SELECT count(*) FROM information_schema.columns c
            WHERE c.table_schema = 'public' AND c.table_name = 'approval_requests'
              AND c.column_name = 'reviewer_contact_text')::text,
          (SELECT count(*) FROM public.approval_requests r
            WHERE r.wedding_id = current_setting('s7b.wed_a')::uuid
              AND r.reviewer_contact_text IS NOT NULL)::text],
    ARRAY['false', 'false', '1', '0']::text[]);

  PERFORM pg_temp.s7b_eq('K17 the closed refusal is the same shape as the open answer''s envelope '
    'minus one name: a forged credential is refused with exactly {"available": false}, which carries '
    'no reviewer-visible difference from any other refusal',
    pg_temp.s7b_open('not-a-real-credential-at-all-not-really-this-has-too-many-parts'),
    '{"available": false}'::jsonb);
END $K$;

-- --------------------------------------------------------------------------- S: the frozen snapshot
-- The claim this group exists for: a reviewer's document is pinned by *version*, and nothing the
-- host does afterwards — editing the draft, freezing a successor, publishing it, or answering the
-- review — rewrites what a frozen row says. The difference P5 could only point at is manufactured
-- here: the draft moves, so the published document and the pinned document are no longer equal.
DO $S$
DECLARE s s7c%ROWTYPE; v jsonb; w jsonb; d1 jsonb; g jsonb; raw2 text; req2 text;
        md5_1 text; md5_2 text; md5_3 text; created_1 timestamptz;
BEGIN
  SELECT * INTO s FROM s7c;
  raw2 := current_setting('s7b.raw');
  req2 := current_setting('s7b.req');
  d1   := pg_temp.s7b_dto(s.ver1);
  v    := pg_temp.s7b_open(raw2);
  md5_1 := (SELECT md5(x.snapshot::text) FROM public.invitation_versions x WHERE x.id = s.ver1);
  md5_2 := (SELECT md5(x.snapshot::text) FROM public.invitation_versions x WHERE x.id = s.ver3);
  created_1 := (SELECT x.created_at FROM public.invitation_versions x WHERE x.id = s.ver1);

  -- The host edits the draft (the product's own path: RLS on the table, no RPC — see the header),
  -- freezes a successor, and publishes it.
  PERFORM pg_temp.s7b_host_do(s.owner_a::text,
    'UPDATE public.invitation_drafts d SET content = d.content || jsonb_build_object(''welcome'', '
    || quote_literal(current_setting('s7b.mk_draft')) || ') WHERE d.wedding_id = '
    || quote_literal(s.wed_a::text) || '::uuid');

  w := pg_temp.s7b_auth(s.owner_a::text, 'SELECT api.create_invitation_version('
    || quote_literal(s.wed_a::text) || '::uuid)');
  PERFORM pg_temp.s7b_eq('S1 the successor is version 4 and the chain now reads 1,2,3,4 — freezing '
    'is the only thing that added a row here',
    ARRAY[w ->> 'version_number',
          (SELECT array_to_string(array_agg(x.version_number::text ORDER BY x.version_number), ',')
             FROM public.invitation_versions x WHERE x.wedding_id = s.wed_a)],
    ARRAY['4', '1,2,3,4']::text[]);

  PERFORM pg_temp.s7b_eq('S2 and the ask this file was reading is closed by it: pinned to version 1, '
    'now invalidated with its credential revoked, while the answered asks around it keep their '
    'decisions',
    (SELECT r.status FROM public.approval_requests r WHERE r.id::text = req2), 'invalidated');

  PERFORM pg_temp.s7b_eq('S3 the door now answers the closed shape for that same credential — a '
    'reviewer following an old link is stopped, never silently re-pointed at the newer document',
    pg_temp.s7b_open(raw2), '{"available": false}'::jsonb);

  PERFORM pg_temp.s7b_eq('S4 and closing it wrote nothing: no feedback row appeared for the '
    'invalidated ask, and its history is empty in the host''s queue',
    ARRAY[(SELECT count(*) FROM public.approval_feedback f
             WHERE f.request_id::text = req2)::text,
          (SELECT coalesce(jsonb_array_length(x -> 'history'), 0)::text
             FROM jsonb_array_elements(pg_temp.s7b_auth(s.owner_a::text,
               'SELECT api.get_approval_requests(' || quote_literal(s.wed_a::text) || '::uuid)')) x
            WHERE x ->> 'request_id' = req2)],
    ARRAY['0', '0']::text[]);

  PERFORM pg_temp.s7b_eq('S5 the frozen rows are byte-identical to what they were before the draft '
    'moved, a successor landed and a review ask was invalidated — including `created_at`, which an '
    'overwrite would have to keep anyway but which is recorded here because "immutable" has to mean '
    'the row, not just the json',
    ARRAY[(SELECT md5(x.snapshot::text) FROM public.invitation_versions x WHERE x.id = s.ver1),
          (SELECT md5(x.snapshot::text) FROM public.invitation_versions x WHERE x.id = s.ver3),
          (SELECT x.created_at::text FROM public.invitation_versions x WHERE x.id = s.ver1)],
    ARRAY[md5_1, md5_2, created_1::text]::text[]);

  PERFORM pg_temp.s7b_eq('S6 the pinned projection is unchanged as a value too, even though the '
    'document it belongs to is no longer what the guest is served',
    pg_temp.s7b_dto(s.ver1), d1);

  v := pg_temp.s7b_auth(s.owner_a::text, 'SELECT api.publish_invitation_version('
    || quote_literal(s.wed_a::text) || '::uuid, '
    || quote_literal(w ->> 'version_id') || '::uuid, NULL)');
  PERFORM pg_temp.s7b_eq('S7 the publish verb still answers with its five names and nothing Stage 7 '
    'added — the review workflow did not widen a Stage 3 verb''s shape',
    pg_temp.s7b_top_keys(v),
    pg_temp.s7b_sorted(ARRAY['expires_at', 'link_reused', 'path', 'publication_id', 'version_id']));

  PERFORM pg_temp.s7b_eq('S7b and publishing the successor gives the guest the edited document '
    'through the *same* live credential — rotation is a separate verb, so a published correction '
    'reaches people who already hold the link',
    (position(current_setting('s7b.mk_draft')
              in pg_temp.s7b_door('guest', current_setting('s7b.gue'))::text) > 0)::text, 'true');

  -- The manufactured divergence, at last: a fresh ask pinned to version 1, read while the guest
  -- reads version 4.
  w := pg_temp.s7b_ask(1, 'Boundary aunt second');
  raw2 := w ->> 'review_token';
  req2 := w ->> 'request_id';
  PERFORM set_config('s7b.raw2', raw2, false);
  PERFORM set_config('s7b.req2', req2, false);
  v := pg_temp.s7b_open(raw2);
  g := pg_temp.s7b_door('guest', current_setting('s7b.gue')) -> 'invitation';

  PERFORM pg_temp.s7b_eq('S8 same twelve names, different documents: the reviewer pinned to version 1 '
    'is still reading the unedited welcome while the guest is reading the edited one — P4''s shape '
    'claim and P6''s coincidence finally separated, which is what proves the door follows the '
    '*pinned row* and not the live publication',
    ARRAY[(v -> 'review' -> 'invitation') = d1,
          position(current_setting('s7b.mk_draft') in (v -> 'review' -> 'invitation')::text) = 0,
          position(current_setting('s7b.mk_draft') in g::text) > 0,
          ((v -> 'review' -> 'invitation') IS DISTINCT FROM g)]::text[],
    ARRAY['true', 'true', 'true', 'true']::text[]);

  PERFORM pg_temp.s7b_eq('S8b and the two documents differ in exactly the members the edit could '
    'touch — the welcome text and the sections built from it — with no member added, dropped or '
    'reordered: a divergence in anything else would mean one door inventing a field',
    ARRAY[(pg_temp.s7b_top_keys(v -> 'review' -> 'invitation') = pg_temp.s7b_top_keys(g))::text,
          (SELECT array_to_string(array_agg(k ORDER BY k COLLATE "C"), ',')
             FROM unnest(pg_temp.s7b_top_keys(g)) k
            WHERE (v -> 'review' -> 'invitation') -> k IS DISTINCT FROM g -> k)],
    ARRAY['true', 'sections,welcome']::text[]);

  -- The answer itself, and what it is allowed to leave behind.
  v := pg_temp.s7b_answer(raw2, 'changes_requested', 'Boundary aunt second',
                          'The muurtham time is hard to read for elders travelling out of town.',
                          'ceremonies');
  PERFORM pg_temp.s7b_has_keys('S9 the answer returns four names — the feedback id, what it became, '
    'when, and the request''s new status §2.4', v,
    ARRAY['feedback_id', 'recorded', 'responded_at', 'status']);

  PERFORM pg_temp.s7b_eq('S10 and the note is appended, not merged: one feedback row for this ask, '
    'the snapshot still byte-identical, and the document the reviewer was shown still equal to the '
    'pinned projection — an approved snapshot is never silently edited to match a relative''s wish',
    ARRAY[(SELECT count(*)::text FROM public.approval_feedback f
            WHERE f.request_id::text = req2),
          (SELECT md5(x.snapshot::text) FROM public.invitation_versions x WHERE x.id = s.ver1),
          ((pg_temp.s7b_open(current_setting('s7b.raw2')) -> 'available')::text),
          (SELECT f.message FROM public.approval_feedback f WHERE f.request_id::text = req2)]::text[],
    ARRAY['1', md5_1, 'false',
          'The muurtham time is hard to read for elders travelling out of town.']::text[]);

  PERFORM pg_temp.s7b_eq('S11 the answered ask moves out of pending and its decision is readable by '
    'the host with its history — but the door that answered it is now closed, so a second answer is '
    'not a revision and a screenshot cannot re-open it',
    ARRAY[(SELECT r.status FROM public.approval_requests r WHERE r.id::text = req2),
          (SELECT x ->> 'link_state' FROM jsonb_array_elements(
             pg_temp.s7b_auth(s.owner_a::text, 'SELECT api.get_approval_requests('
             || quote_literal(s.wed_a::text) || '::uuid)')) x
            WHERE x ->> 'request_id' = req2),
          (pg_temp.s7b_answer(raw2, 'approved', 'Boundary aunt second', NULL, NULL)
            = '{"recorded": false, "reason": "unavailable"}'::jsonb)::text]::text[],
    ARRAY['changes_requested', 'live', 'true']::text[]);

  PERFORM pg_temp.s7b_eq('S12 and the host''s queue shows the note exactly once, attributed to the '
    'name the reviewer typed, carrying an instant, on the ask pinned to version 1 — the document the '
    'reviewer was actually shown, while the guest is now served version 4',
    (SELECT ARRAY[jsonb_array_length(x -> 'history')::text,
                  (x -> 'history' -> 0 ->> 'author_label') || ':'
                    || ((x -> 'history' -> 0 -> 'created_at') IS NOT NULL)::text,
                  x ->> 'version_number']
       FROM jsonb_array_elements(pg_temp.s7b_auth(s.owner_a::text,
         'SELECT api.get_approval_requests(' || quote_literal(s.wed_a::text) || '::uuid)')) x
      WHERE x ->> 'request_id' = req2)::text[],
    ARRAY['1', 'Boundary aunt second:true', '1']::text[]);

  PERFORM pg_temp.s7b_eq('S13 nothing in this group deleted a row to make its point: the residue is '
    'exactly battery 1''s (3 versions, 7 asks, 9 credentials) plus what this file had written by '
    'here — one frozen successor, two asks with their two review credentials, and the guest '
    'credential X rotated, which revokes its predecessor rather than removing it',
    ARRAY[(SELECT count(*)::text FROM public.invitation_versions
            WHERE wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.approval_requests
            WHERE wedding_id = s.wed_a),
          (SELECT count(*)::text FROM private.access_tokens
            WHERE wedding_id = s.wed_a)]::text[],
    ARRAY['4', '9', '12']::text[]);
END $S$;

-- --------------------------------------------------------- G: who may write these three tables
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('GA', 'the host themself cannot UPDATE an answer they already received — no column grant, no '
    'table grant, refused before any row is read',
   $t$UPDATE public.approval_feedback SET message = 'rewritten' WHERE wedding_id =
       current_setting('s7b.wed_a')::uuid$t$, '42501',
   '%permission denied for table approval_feedback%'),
  ('GA', 'nor can they delete one: what a relative said cannot be un-said from a client session',
   $t$DELETE FROM public.approval_feedback WHERE wedding_id =
       current_setting('s7b.wed_a')::uuid$t$, '42501',
   '%permission denied for table approval_feedback%'),
  ('GA', 'nor move a frozen snapshot',
   $t$UPDATE public.invitation_versions SET snapshot = snapshot WHERE wedding_id =
       current_setting('s7b.wed_a')::uuid$t$, '42501',
   '%permission denied for table invitation_versions%'),
  ('GA', 'nor delete a version',
   $t$DELETE FROM public.invitation_versions WHERE wedding_id =
       current_setting('s7b.wed_a')::uuid$t$, '42501',
   '%permission denied for table invitation_versions%'),
  ('GA', 'nor open an ask by writing the row themselves — the only path is the RPC, which derives '
    'the caller from the JWT',
   $t$INSERT INTO public.approval_requests (wedding_id, version_id, reviewer_display_name, status)
       SELECT current_setting('s7b.wed_a')::uuid, current_setting('s7b.ver1')::uuid,
              'Self-authored', 'pending'$t$, '42501',
   '%permission denied for table approval_requests%'),
  ('GA', 'nor move one out of pending by hand',
   $t$UPDATE public.approval_requests SET status = 'approved' WHERE wedding_id =
       current_setting('s7b.wed_a')::uuid$t$, '42501',
   '%permission denied for table approval_requests%'),
  ('GA', 'nor mint a credential — `private` is not reachable from a client role at all',
   $t$INSERT INTO private.access_tokens (id, wedding_id, token_kind, token_hash, expiry_policy,
        expires_at) VALUES (gen_random_uuid(), current_setting('s7b.wed_a')::uuid,
        'approval_review', repeat('0', 64), 'standard', now() + interval '1 day')$t$, '42501',
   '%permission denied for schema private%'),
  ('GB', 'a signed-out caller cannot even read the credential store',
   $t$SELECT count(*) FROM private.access_tokens$t$, '42501',
   '%permission denied for schema private%'),
  ('GB', 'and the review bodies are not reachable by name either. Measured at this head, the refusal '
    'is at the *function*: `anon` holds USAGE on `internal_api` (G3b), so what stops the call is the '
    'withheld EXECUTE — which is the stronger place for it, because it holds in plain SQL and not '
    'only while a gateway is configured to hide the schema',
   $t$SELECT internal_api.request_family_review(current_setting('s7b.wed_a')::uuid,
        current_setting('s7b.ver1')::uuid, 'Direct', NULL)$t$, '42501',
   '%permission denied for function request_family_review%'),
  ('GC', 'a host calling the cultural-authority verdict verb directly is refused the same way — '
    'the family workflow grants nothing on the pack surface §7. The call is written against the '
    'seven-argument signature measured at this head: an earlier draft passed six and was answered '
    'with 42883 undefined function, which is a complaint about this file, not a security result',
   $t$SELECT internal_api.submit_tradition_pack_review(current_setting('s7b.ver1')::uuid,
        'approved', 'label', 'basis', 'scope', ARRAY['en']::text[], 'hash')$t$, '42501',
   '%permission denied for function submit_tradition_pack_review%'),
  ('GC', 'and so is a signed-out caller: an account-free review link is not a maintenance identity',
   $t$SELECT internal_api.approve_tradition_pack_release(current_setting('s7b.ver1')::uuid,
        'hash')$t$,
   '42501', '%permission denied for function approve_tradition_pack_release%'),
  ('GC', 'a read-shaped pack verb is refused too, not only the write-shaped ones: the review packet '
    'is the cultural-authority''s own view of a release, and a host with no grant on it cannot open '
    'it even to look',
   $t$SELECT internal_api.get_tradition_pack_review_packet(current_setting('s7b.ver1')::uuid)$t$,
   '42501', '%permission denied for function get_tradition_pack_review_packet%');

DO $G$
DECLARE s s7c%ROWTYPE; api_names text[]; internal_names text[];
BEGIN
  SELECT * INTO s FROM s7c;
  PERFORM pg_temp.s7b_run('GA', 'authenticated', s.owner_a::text);
  PERFORM pg_temp.s7b_run('GB', 'anon', NULL);
  PERFORM pg_temp.s7b_run('GC', 'authenticated', s.owner_a::text);

  api_names := (SELECT array_agg(p.proname ORDER BY p.proname COLLATE "C") FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'api');
  internal_names := (SELECT array_agg(p.proname ORDER BY p.proname COLLATE "C") FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'internal_api');

  PERFORM pg_temp.s7b_eq('G1 `api` is exactly the host and door verbs it was measured to be at this '
    'head — thirteen at Stage 7, with Stage 7''s three added names and no fourteenth; nineteen from '
    'Stage 8, which adds the six household-invitation verbs; twenty-one from Stage 9, which adds the '
    'output manifest and one frozen version''s document, both reads; twenty-two from Stage 10, which '
    'adds `commerce_host_summary` and nothing else a browser can call; forty from Stage 11, whose '
    'first ten are the support workflow''s doors: four a wedding host may knock on '
    '(`open_support_case`, `get_my_support_case`, `get_my_support_cases`, `reply_to_support_case`) and '
    'six that only an operator''s body lets through '
    '(`get_operator_case`, `operator_case_queue`, `operator_add_case_note`, `operator_claim_case`, '
    '`operator_release_case`, `operator_transition_case`); slice 3 adds four more on exactly the same '
    'ruling — `create_privacy_request` and `get_my_privacy_requests` for a host, '
    '`operator_privacy_queue` and `operator_advance_privacy_request` for an operator; slice 4 adds the '
    'last four on the same ruling — `operator_commerce_review_queue` and '
    '`operator_add_commerce_review_note` for the finance desk, `operator_takedown_plan` and '
    '`operator_takedown_publication` for operations. All eighteen are '
    'EXECUTE-granted to `authenticated`, because on this surface the grant is not the authority: the '
    'twelve operator bodies re-read the caller''s `operator_grants` row and refuse anyone else with '
    '`insufficient_privilege` — the six support doors and the takedown pair on the `operations` duty, '
    'the two privacy doors likewise, the finance pair on `finance_review` — '
    'which is §4''s "not merely by hiding links" written as a grant list '
    'rather than as a route table — and the refusal cells are `85_support_lifecycle.sql`''s, '
    '`90_privacy_intake.sql`''s and `92_takedown_and_oversight.sql`''s own, not this census. '
    'Named rather than counted, '
    'because a checker that only counts would not notice a swapped-out name',
    api_names,
    CASE WHEN pg_temp.s7b_at_least('stage11')
         THEN pg_temp.s7b_sorted(ARRAY['commerce_host_summary', 'create_invitation_version',
           'create_privacy_request', 'get_approval_requests', 'get_guest_invitation_state',
           'get_invitation_publication_state', 'get_my_privacy_requests', 'get_my_support_case',
           'get_my_support_cases',
           'get_operator_case', 'issue_guest_invitations', 'list_invitation_outputs',
           'open_support_case', 'operator_add_case_note', 'operator_add_commerce_review_note',
           'operator_advance_privacy_request',
           'operator_case_queue',
           'operator_claim_case', 'operator_commerce_review_queue', 'operator_privacy_queue',
           'operator_release_case', 'operator_takedown_plan', 'operator_takedown_publication',
           'operator_transition_case',
           'preview_invitation', 'preview_invitation_document', 'publish_invitation_version',
           'render_invitation_document', 'reply_to_support_case',
           'request_family_review', 'resolve_family_review',
           'resolve_guest_invitation', 'resolve_public_invitation', 'revoke_family_review',
           'revoke_guest_invitation', 'revoke_invitation_publication', 'rotate_guest_invitation',
           'rotate_invitation_token', 'submit_family_review', 'submit_guest_rsvp'])
         WHEN pg_temp.s7b_at_least('stage10')
         THEN pg_temp.s7b_sorted(ARRAY['commerce_host_summary', 'create_invitation_version',
           'get_approval_requests', 'get_guest_invitation_state',
           'get_invitation_publication_state', 'issue_guest_invitations', 'list_invitation_outputs',
           'preview_invitation', 'preview_invitation_document', 'publish_invitation_version',
           'render_invitation_document',
           'request_family_review', 'resolve_family_review',
           'resolve_guest_invitation', 'resolve_public_invitation', 'revoke_family_review',
           'revoke_guest_invitation', 'revoke_invitation_publication', 'rotate_guest_invitation',
           'rotate_invitation_token', 'submit_family_review', 'submit_guest_rsvp'])
         WHEN pg_temp.s7b_at_least('stage9')
         THEN pg_temp.s7b_sorted(ARRAY['create_invitation_version', 'get_approval_requests',
           'get_guest_invitation_state', 'get_invitation_publication_state',
           'issue_guest_invitations', 'list_invitation_outputs', 'preview_invitation',
           'preview_invitation_document', 'publish_invitation_version',
           'render_invitation_document',
           'request_family_review', 'resolve_family_review',
           'resolve_guest_invitation', 'resolve_public_invitation', 'revoke_family_review',
           'revoke_guest_invitation', 'revoke_invitation_publication', 'rotate_guest_invitation',
           'rotate_invitation_token', 'submit_family_review', 'submit_guest_rsvp'])
         WHEN pg_temp.s7b_at_least('stage8')
         THEN pg_temp.s7b_sorted(ARRAY['create_invitation_version', 'get_approval_requests',
           'get_guest_invitation_state', 'get_invitation_publication_state',
           'issue_guest_invitations', 'preview_invitation', 'preview_invitation_document',
           'publish_invitation_version', 'request_family_review', 'resolve_family_review',
           'resolve_guest_invitation', 'resolve_public_invitation', 'revoke_family_review',
           'revoke_guest_invitation', 'revoke_invitation_publication', 'rotate_guest_invitation',
           'rotate_invitation_token', 'submit_family_review', 'submit_guest_rsvp'])
         ELSE pg_temp.s7b_sorted(ARRAY['create_invitation_version', 'get_approval_requests',
           'get_invitation_publication_state', 'preview_invitation', 'preview_invitation_document',
           'publish_invitation_version', 'request_family_review', 'resolve_family_review',
           'resolve_public_invitation', 'revoke_family_review', 'revoke_invitation_publication',
           'rotate_invitation_token', 'submit_family_review'])
    END);

  PERFORM pg_temp.s7b_eq('G2 and `internal_api` holds the bodies behind them: twenty-four at Stage 7, '
    'thirteen mirrored from `api` plus the eleven cultural-authority names §7 keeps on this side; '
    'thirty from Stage 8, whose six new bodies are all mirrors, so the eleven stay eleven; thirty-two '
    'from Stage 9, whose two are mirrors too; thirty-nine from Stage 10, whose seven are one mirror '
    'and six names no browser may call at all — the money verbs; forty-one at Stage 11 slice 1, whose '
    'two are neither mirrors nor money verbs but the operator-authority bodies — `grant_operator_role` '
    'and `revoke_operator_role` — that §13 keeps reachable only from the trusted owner role, which '
    'is why that count moved while G3''s did not; fifty-five at this head, because slice 2''s ten are '
    'the exact mirrors of slice 2''s ten doors — one body per wrapper, no extra body opened to a host '
    'beyond the surface it is served, which is G3e''s claim by name — so both halves of G3 grew to '
    'thirty-two while the uncallable nineteen stayed nineteen; and slice 3''s four are mirrors by that '
    'same construction — `create_privacy_request` and `get_my_privacy_requests` behind the host''s '
    'privacy pair, `operator_privacy_queue` and `operator_advance_privacy_request` behind the '
    'operator''s — so both halves of G3 moved again to thirty-six while the uncallable nineteen stayed '
    'nineteen; and slice 4 adds five bodies, four of them mirrors of that slice''s four doors and the '
    'fifth (`operator_purge_publication_objects`) deliberately left with no door at all, so the total '
    'is sixty here while the uncallable half grows to twenty. G3f below is the line that proves that '
    'twenty is the same nineteen plus that one purge rather than a set quietly granted through',
    cardinality(internal_names)::bigint,
    CASE WHEN pg_temp.s7b_at_least('stage11') THEN 60::bigint
         WHEN pg_temp.s7b_at_least('stage10') THEN 39::bigint
         WHEN pg_temp.s7b_at_least('stage9') THEN 32::bigint
         WHEN pg_temp.s7b_at_least('stage8') THEN 30::bigint ELSE 24::bigint END);

  PERFORM pg_temp.s7b_eq('G3 `authenticated` holds EXECUTE on the mirrored internal bodies and on the '
    'same number of `api` names — thirteen and thirteen at Stage 7, nineteen and nineteen from Stage '
    '8, twenty-one and twenty-one from Stage 9, twenty-two and twenty-two from Stage 10, thirty-two '
    'and thirty-two after Stage 11 slice 2, which grants its six operator doors to the same role as its '
    'four host doors and puts the difference inside the body, thirty-six and thirty-six at slice 3 '
    'because its four repeat that construction, and forty and forty at this head because slice 4''s '
    'four doors are granted the same way while that slice''s fifth body is granted to nobody — so the '
    'uncallable half is refused '
    'to a host by the absence of a grant, '
    'not by the size of the schema §7. The two halves must agree: a host granted an internal body '
    'with no wrapper would be a second, unadvertised door',
    ARRAY[(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'internal_api'
               AND has_function_privilege('authenticated', p.oid, 'execute'))::text,
          (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'api'
               AND has_function_privilege('authenticated', p.oid, 'execute'))::text]::text[],
    CASE WHEN pg_temp.s7b_at_least('stage11') THEN ARRAY['40', '40']::text[]
         WHEN pg_temp.s7b_at_least('stage10') THEN ARRAY['22', '22']::text[]
         WHEN pg_temp.s7b_at_least('stage9') THEN ARRAY['21', '21']::text[]
         WHEN pg_temp.s7b_at_least('stage8') THEN ARRAY['19', '19']::text[]
         ELSE ARRAY['13', '13']::text[] END);

  -- The sentence G3 cannot say, said here instead. Both schemas are visible to both client roles: an
  -- earlier draft of this assertion called USAGE the difference between them, and the measured ACLs
  -- below show that it is not. What withholds the pack bodies is EXECUTE, which is the stronger
  -- place for the boundary because it is enforced by the engine in plain SQL rather than by a
  -- gateway configuration that a different `db-schemas` setting would dissolve.
  PERFORM pg_temp.s7b_eq('G3b USAGE is *identical* across the two client roles and both schemas '
    '(anon and authenticated each hold it on `api` and on `internal_api`; service_role holds it on '
    'neither), so a caller who can see a schema still cannot call a body in it',
    ARRAY[
      has_schema_privilege('anon','api','USAGE')::text,
      has_schema_privilege('anon','internal_api','USAGE')::text,
      has_schema_privilege('authenticated','api','USAGE')::text,
      has_schema_privilege('authenticated','internal_api','USAGE')::text,
      has_schema_privilege('service_role','api','USAGE')::text,
      has_schema_privilege('service_role','internal_api','USAGE')::text]::text[],
    ARRAY['true','true','true','true','false','false']::text[]);

  PERFORM pg_temp.s7b_eq('G3c and the two namespaces carry the same access-control string, measured as '
    'text rather than inferred from the boolean probes above: `postgres` owns both and `anon` and '
    '`authenticated` may use both — the asymmetry a reviewer of §7 should be looking for is at the '
    'function level, not here',
    ARRAY[(SELECT nspacl::text FROM pg_namespace WHERE nspname = 'api'),
          (SELECT nspacl::text FROM pg_namespace WHERE nspname = 'internal_api')]::text[],
    ARRAY['{postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres}',
          '{postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres}']::text[]);

  PERFORM pg_temp.s7b_eq('G3d an account-free caller sees only the mirrors of the door verbs G4 '
    'names — three at Stage 7, five from Stage 8, when the household guest adds its own open and '
    'answer — so `internal_api` being reachable by `anon` is not a wider surface than the published '
    'one, it is the same verbs again',
    (SELECT array_agg(p.proname::text ORDER BY p.proname COLLATE "C") FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'internal_api' AND has_function_privilege('anon', p.oid, 'execute')),
    CASE WHEN pg_temp.s7b_at_least('stage8')
         THEN ARRAY['resolve_family_review', 'resolve_guest_invitation',
                    'resolve_public_invitation', 'submit_family_review',
                    'submit_guest_rsvp']::text[]
         ELSE ARRAY['resolve_family_review', 'resolve_public_invitation',
                    'submit_family_review']::text[]
    END);

  -- G2 says twenty-four = thirteen + eleven and G3 says thirteen. Both are counts. Named below so
  -- neither can be satisfied by a swapped-out body that happens to leave the arithmetic intact.
  -- The want-list here is `api_names`, the array G1 was just checked against, so this assertion
  -- follows the head automatically: thirteen against thirteen at Stage 7, nineteen against nineteen
  -- from Stage 8, twenty-one against twenty-one from Stage 9, thirty-six against thirty-six at slice 3
  -- and forty against forty at this Stage 11 head, and in each case by name rather than by count.
  -- Slice 3's and slice 4's doors are mirrors by the
  -- same construction, so they move both sides of this assertion together and cannot be satisfied by
  -- an extra body on either side alone — except slice 4's purge body, which is granted to nobody and so
  -- can only ever appear in G3f's list.
  PERFORM pg_temp.s7b_eq('G3e the internal bodies that `authenticated` may call are not merely '
    'counted: taken by name they are exactly the published `api` wrappers'' own names, one mirror '
    'per verb and no extra body opened to a host beyond the surface it is served',
    pg_temp.s7b_sorted(ARRAY(SELECT p.proname::text FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'internal_api'
        AND has_function_privilege('authenticated', p.oid, 'execute'))),
    api_names);

  PERFORM pg_temp.s7b_eq('G3f and the complement is '
    || CASE WHEN pg_temp.s7b_at_least('stage11')
              THEN 'twenty bodies a host cannot call at all: the eleven cultural-authority names '
                   || '§7 keeps on this side, plus the six money verbs Stage 10 put behind the server '
                   || '— open an order, record a payment event, grant a right, revoke a right, expire '
                   || 'an order, reconcile — plus the two operator-authority bodies Stage 11 slice 1 '
                   || 'added, '
                   || 'grant and revoke, plus the one body slice 4 wrote with no door in front of it — '
                   || '`operator_purge_publication_objects`, the plan that hands the actual object '
                   || 'delete to the trusted CLI, which §10 keeps off the browser surface by ruling '
                   || 'rather than by omission. G3e proves the other forty of the sixty are exactly '
                   || 'G1''s names, so growth in this file can only ever mean a body nobody opened to '
                   || 'a browser — including slice 2''s ten and slice 3''s four, every one of which is '
                   || 'a mirror and so leaves by definition for G3e''s list rather than this one. Listing them is the '
                   || 'point either way: a body someone granted to '
                   || '`authenticated` would leave this list by moving to G3e''s, and one that '
                   || 'should have been a mirror but was not would show up here'
            WHEN pg_temp.s7b_at_least('stage10')
              THEN 'seventeen bodies a host cannot call at all: the eleven cultural-authority names '
                   || '§7 keeps on this side, plus the six money verbs Stage 10 put behind the server '
                   || '— open an order, record a payment event, grant a right, revoke a right, expire '
                   || 'an order, reconcile. Listing them is the point: a seventh commerce name that '
                   || 'someone granted to `authenticated` would leave this list by moving to G3e''s, '
                   || 'and one that should have been a mirror but was not would show up here'
            ELSE 'the eleven cultural-authority bodies §7 keeps on this side, listed rather than '
                   || 'inferred from subtraction' END,
    pg_temp.s7b_sorted(ARRAY(SELECT p.proname::text FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'internal_api'
        AND NOT has_function_privilege('authenticated', p.oid, 'execute'))),
    CASE WHEN pg_temp.s7b_at_least('stage11')
         THEN pg_temp.s7b_sorted(ARRAY['approve_tradition_pack_release', 'commerce_reconcile',
           'create_commerce_order', 'create_tradition_pack', 'create_tradition_pack_release',
           'deprecate_tradition_pack_release', 'expire_commerce_order',
           'get_tradition_pack_review_packet', 'grant_commerce_entitlement', 'grant_operator_role',
           'inspect_tradition_pack_release', 'operator_purge_publication_objects',
           'record_commerce_event',
           'revoke_commerce_entitlement', 'revoke_operator_role',
           'submit_tradition_pack_review', 'tradition_pack_catalog',
           'tradition_pack_retention_report', 'update_draft_tradition_pack_release',
           'validate_tradition_pack_release'])
         WHEN pg_temp.s7b_at_least('stage10')
         THEN pg_temp.s7b_sorted(ARRAY['approve_tradition_pack_release', 'commerce_reconcile',
           'create_commerce_order', 'create_tradition_pack', 'create_tradition_pack_release',
           'deprecate_tradition_pack_release', 'expire_commerce_order',
           'get_tradition_pack_review_packet', 'grant_commerce_entitlement',
           'inspect_tradition_pack_release', 'record_commerce_event',
           'revoke_commerce_entitlement', 'submit_tradition_pack_review', 'tradition_pack_catalog',
           'tradition_pack_retention_report', 'update_draft_tradition_pack_release',
           'validate_tradition_pack_release'])
         ELSE pg_temp.s7b_sorted(ARRAY['approve_tradition_pack_release', 'create_tradition_pack',
      'create_tradition_pack_release', 'deprecate_tradition_pack_release',
      'get_tradition_pack_review_packet', 'inspect_tradition_pack_release',
      'submit_tradition_pack_review', 'tradition_pack_catalog',
      'tradition_pack_retention_report', 'update_draft_tradition_pack_release',
      'validate_tradition_pack_release'])
    END);

  -- The set equality below is what carries Stage 7's claim, and it is worth saying why widening it
  -- for Stage 8 does not weaken anything: because the want-list is exact, the three host-side family
  -- verbs (`get_approval_requests`, `request_family_review`, `revoke_family_review`) are refused to
  -- `anon` by their *absence* from it. Adding the household guest's two doors makes the list longer,
  -- not the permission looser — a fourth name could only ever arrive here by being written into this
  -- file first.
  PERFORM pg_temp.s7b_eq('G4 an account-free caller reaches exactly the doors and answers and nothing '
    'else — three verbs at Stage 7, five from Stage 8 — so nothing about the family''s queue, the '
    'wedding, or a version is readable without a credential that names it §3',
    (SELECT array_agg(p.proname::text ORDER BY p.proname COLLATE "C") FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api' AND has_function_privilege('anon', p.oid, 'execute')),
    CASE WHEN pg_temp.s7b_at_least('stage8')
         THEN ARRAY['resolve_family_review', 'resolve_guest_invitation',
                    'resolve_public_invitation', 'submit_family_review',
                    'submit_guest_rsvp']::text[]
         ELSE ARRAY['resolve_family_review', 'resolve_public_invitation',
                    'submit_family_review']::text[]
    END);

  PERFORM pg_temp.s7b_eq('G5 and `service_role` — the key a server integration would hold — has no '
    'path through either schema: zero EXECUTE grants across every name in both of them (thirty-seven '
    'at the Stage 7 head, forty-nine from Stage 8, fifty-three from Stage 9, sixty-one from Stage 10, '
    'ninety-one at Stage 11 slice 3, one hundred at this head), '
    'so neither the review workflow nor the guest one nor the money model nor the support queue '
    'can be driven by a trusted key bypassing the caller checks §9',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('api','internal_api')
        AND has_function_privilege('service_role', p.oid, 'execute')), 0::bigint);

  PERFORM pg_temp.s7b_eq('G6 every `api` name is a SECURITY INVOKER wrapper, so the caller the body '
    'sees is the caller who presented the JWT — the ownership checks in §2.1 are made against a '
    'role that cannot be inflated by the wrapper',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'api' AND p.prosecdef), 0::bigint);

  PERFORM pg_temp.s7b_eq('G7 the guards that make the three tables this workflow writes '
    'server-authoritative are still bound after the Stage 7 migration — named, not summarised: six '
    'bindings across approval_requests, approval_feedback, invitation_versions and access_tokens',
    (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal AND p.proname IN ('reject_client_write','reject_client_delete')
        AND (c.relname, t.tgname) IN (
          ('approval_requests','approval_requests_no_client_write'),
          ('approval_feedback','feedback_append_only_no_update'),
          ('approval_feedback','feedback_append_only_no_delete'),
          ('invitation_versions','versions_immutable_no_update'),
          ('invitation_versions','versions_immutable_no_delete'),
          ('access_tokens','tokens_no_client_write'),
          ('access_tokens','tokens_no_client_delete'))), 7::bigint);

  -- The guard's scope, measured rather than assumed, because it is narrower than its name.
  -- The sentence this assertion used to carry quoted a line range in a migration file, which SQL
  -- cannot check. Measured instead: the exemption is read out of the two guard bodies themselves,
  -- and the first element is the number of bodies that actually hold the clause, so a guard that
  -- lost it cannot make the name list pass by silently contributing nothing to the union.
  PERFORM pg_temp.s7b_eq('G8 the guard''s scope, taken from its own text rather than from a comment: '
    'both `private.reject_client_write()` and `private.reject_client_delete()` (2 of 2 bodies carry '
    'the clause) short-circuit for exactly `service_role` and `supabase_admin`, in addition to the '
    '`current_user = ''postgres''` test their source opens with — so this battery''s append-only '
    'claim is a claim about client roles, and the live probe below is what carries the rest of it',
    pg_temp.s7b_sorted(ARRAY[(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'private' AND p.proname IN ('reject_client_write','reject_client_delete')
          AND (regexp_match(p.prosrc, 'rolname IN \(([^)]*)\)'))[1] IS NOT NULL)::text]
      || ARRAY(SELECT DISTINCT btrim(replace(part, '''', ''))
          FROM (SELECT (regexp_match(p.prosrc, 'rolname IN \(([^)]*)\)'))[1] AS lst
                  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'private'
                   AND p.proname IN ('reject_client_write','reject_client_delete')) g,
               unnest(regexp_split_to_array(g.lst, ',')) AS part)),
    ARRAY['2', 'service_role', 'supabase_admin']::text[]);
END $G$;

DO $G8$
DECLARE f uuid; before_row text[]; after_row text[]; got text; fb_before bigint; fb_after bigint;
BEGIN
  -- Ordered by `id`, not by `created_at`: battery 1 writes its two feedback rows inside one
  -- transaction, so both carry the same instant and an ordering by time picks between them at
  -- random. An earlier draft ordered by `created_at`, drew the decision row whose `message` is NULL
  -- by design, and then compared that NULL against itself.
  SELECT x.id, ARRAY[x.message, x.decision, x.author_label, x.section_key]::text[]
    INTO f, before_row
    FROM public.approval_feedback x
   WHERE x.wedding_id = current_setting('s7b.wed_a')::uuid
   ORDER BY x.id LIMIT 1;
  IF f IS NULL THEN
    RAISE EXCEPTION 'FAIL G8a: this file expected battery 1 to leave at least one feedback row on '
      'the reviewed wedding, and found none';
  END IF;
  fb_before := (SELECT count(*) FROM public.approval_feedback x
    WHERE x.wedding_id = current_setting('s7b.wed_a')::uuid);

  EXECUTE 'SET ROLE service_role';
  BEGIN
    EXECUTE 'UPDATE public.approval_feedback SET message = message WHERE id = '
      || quote_literal(f::text) || '::uuid';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL G8a: the trusted-role exemption did not behave as G8 reads it from the '
      'guard''s own text: % %', SQLSTATE, SQLERRM;
  END;
  EXECUTE 'RESET ROLE';

  -- The write-back is a no-op only if the row is the same afterwards, so the claim is made on the
  -- values rather than on the absence of an error: an exemption that accepted the UPDATE *and*
  -- changed the row would be a different finding, and a worse one. Four columns, because one of
  -- them is legitimately NULL and a comparison resting on that alone would prove nothing.
  SELECT ARRAY[y.message, y.decision, y.author_label, y.section_key]::text[]
    INTO after_row
    FROM public.approval_feedback y WHERE y.id = f;
  PERFORM pg_temp.s7b_eq('G8a the exemption exercised on the live row, not only read from the '
    'trigger text: a `service_role` UPDATE of a feedback row is accepted and leaves the row '
    'value-for-value as it was (message, decision, author label, section key) — the guard is the '
    'backstop for a mistaken grant or policy, not a wall around history from every identity, which '
    'is why the next assertions carry the rest of the guarantee',
    after_row, before_row);

  got := pg_temp.s7b_err('DELETE FROM public.approval_requests r WHERE r.id = '
    || quote_literal((SELECT r.id FROM public.approval_requests r
                       JOIN public.approval_feedback f2 ON f2.request_id = r.id
                      WHERE r.wedding_id = current_setting('s7b.wed_a')::uuid LIMIT 1)::text)
    || '::uuid');
  PERFORM pg_temp.s7b_eq('G8b what a trusted role *is* stopped by is relational integrity, not the '
    'trigger: deleting an answered request is refused by the composite FK that its feedback pins, '
    'because a guard that fires as the child''s owner cannot see a parent''s delete §stage2',
    ARRAY[split_part(got, ' ', 1), (got LIKE '%violates foreign key constraint%')::text],
    ARRAY['23503', 'true']::text[]);

  fb_after := (SELECT count(*) FROM public.approval_feedback x
    WHERE x.wedding_id = current_setting('s7b.wed_a')::uuid);
  PERFORM pg_temp.s7b_eq('G8c and the answered feedback is still there, whole, after both attempts: '
    'the row this file exercised is still addressable by its own id, and the wedding''s history has '
    'neither gained nor lost a row across the exemption and the refused delete — counted against the '
    'number taken at the top of this block, so the claim holds whatever battery 1 and the S group '
    'left behind it',
    ARRAY[fb_after::text, (SELECT count(*) FROM public.approval_feedback y
      WHERE y.id = f)::text]::text[],
    ARRAY[fb_before::text, '1']::text[]);

  PERFORM pg_temp.s7b_eq('G8d the row-level read stays scoped for a second, unrelated account: it '
    'sees none of this wedding''s asks, while the owner sees all nine of them — seven battery 1 '
    'committed plus the two this file opened on the reviewed wedding before this point — and the '
    'third element is the same nine counted straight out of the table, so the owner''s zero-row '
    'neighbour is a real withholding and not an empty database',
    ARRAY[pg_temp.s7b_visible('authenticated', pg_temp.s7b_owner_b(),
            'SELECT * FROM public.approval_requests')::text,
          pg_temp.s7b_visible('authenticated', pg_temp.s7b_owner_a(),
            'SELECT * FROM public.approval_requests')::text,
          (SELECT count(*) FROM public.approval_requests r
            WHERE r.wedding_id = current_setting('s7b.wed_a')::uuid)::text]::text[],
    ARRAY['0', '9', '9']::text[]);

  -- A different kind of refusal, said separately. `anon` does not get zero rows from
  -- `approval_feedback`: it is denied the table before any policy runs. Reporting both as `0` would
  -- have let a lost table grant look like working RLS, so the helper that counts rows is not used
  -- here at all.
  PERFORM set_config('test.uid', '', false);
  EXECUTE 'SET ROLE anon';
  BEGIN
    EXECUTE 'SELECT count(*) FROM public.approval_feedback';
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL G8e: a signed-out caller was allowed to read approval_feedback at all, '
      'whatever policy it was told it was subject to';
  EXCEPTION WHEN INSUFFICIENT_PRIVILEGE THEN
    got := SQLSTATE || ' ' || SQLERRM;
    EXECUTE 'RESET ROLE';
  END;
  PERFORM pg_temp.s7b_eq('G8e and the signed-out caller''s attempt is a grant-level denial, not an '
    'empty result set: 42501 permission denied for the *table*, raised before any row policy is '
    'consulted — which is the half G8d''s zero cannot say on its own',
    ARRAY[split_part(got, ' ', 1), (got LIKE '%permission denied for table approval_feedback%')::text]::text[],
    ARRAY['42501', 'true']::text[]);
END $G8$;

-- ------------------------------------------------- C: cultural-authority review stays separate
DO $C$
DECLARE pack_names text[]; mirror bigint; rel bigint;
BEGIN
  pack_names := (SELECT array_agg(p.proname ORDER BY p.proname COLLATE "C") FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'internal_api' AND p.proname LIKE '%tradition_pack%');

  PERFORM pg_temp.s7b_eq('C1 the eleven cultural-authority names are exactly the measured set, and '
    'all of them live in `internal_api` §7 — a twelfth would have to be reached before it could be '
    'tested, which is why C2 checks the mirror instead of trusting this list to stay right',
    pack_names,
    pg_temp.s7b_sorted(ARRAY['approve_tradition_pack_release', 'create_tradition_pack',
      'create_tradition_pack_release', 'deprecate_tradition_pack_release',
      'get_tradition_pack_review_packet', 'inspect_tradition_pack_release',
      'submit_tradition_pack_review', 'tradition_pack_catalog',
      'tradition_pack_retention_report', 'update_draft_tradition_pack_release',
      'validate_tradition_pack_release']));

  PERFORM pg_temp.s7b_eq('C2 and not one of them is mirrored into `api`, in either direction: no '
    'pack name appears among the exposed wrappers, and no family-review name appears among the '
    'pack bodies',
    ARRAY[(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'api' AND p.proname LIKE '%tradition_pack%')::text,
          (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'internal_api'
              AND p.proname IN ('request_family_review','resolve_family_review',
                                'submit_family_review','revoke_family_review',
                                'get_approval_requests'))::text]::text[],
    ARRAY['0', '5']::text[]);

  -- Why this assertion is not a string search: a body's comments may name the other surface on
  -- purpose (this migration's §7 does, to explain the separation), so a `prosrc` grep would be
  -- fooled by documentation. What is comment-proof is the argument list a caller must satisfy and
  -- the rows a call can write.
  PERFORM pg_temp.s7b_eq('C3 a reviewer has no way to express a cultural-authority verdict through '
    'the family door: the four arguments of the answer verb name a decision, a label, a message and '
    'a section — none of them a pack, a release or an approval of platform content',
    (SELECT coalesce(array_agg(a ORDER BY a COLLATE "C"), '{}'::text[]) FROM unnest(
       (SELECT proargnames FROM pg_proc
         WHERE oid = 'api.submit_family_review(text,text,text,text)'::regprocedure)) a),
    pg_temp.s7b_sorted(ARRAY['p_decision','p_reviewer_label','p_message','p_section_key']));

  PERFORM pg_temp.s7b_eq('C4 and the family workflow wrote nothing to the cultural-authority tables '
    'across everything this file did — an ask, an invalidation, a freeze, a publication, an answer '
    'with a note: zero rows in both tables, before and after',
    ARRAY[(SELECT count(*) FROM public.tradition_packs)::text,
          (SELECT count(*) FROM public.tradition_pack_releases)::text]::text[],
    ARRAY['0', '0']::text[]);

  PERFORM pg_temp.s7b_eq('C5 the two surfaces are also separable by their rows: the tables a family '
    'review touches hold this wedding''s ten asks and three notes, while the release the pack side '
    'would need cannot even be created at an approved status — measured as a refusal, because a '
    'release that could be born approved would make this separation a naming convention',
    left(pg_temp.s7b_err('INSERT INTO public.tradition_pack_releases (id, pack_id, release_number, '
      || 'status, definition_schema_version, definition, languages, author_label, machine_assisted) '
      || 'VALUES (gen_random_uuid(), gen_random_uuid(), 1, ''approved'', 1, '
      || '''{"sections":[{"key":"welcome","label":"Welcome"}]}''::jsonb, ARRAY[''en'']::text[], '
      || '''ZZ Boundary elder'', false)'), 5), '23514');

  PERFORM pg_temp.s7b_eq('C6 and the refusal says why: the cultural-authority lifecycle is the only '
    'way a release becomes an authority, so a family reviewer — who is not an identity the product '
    'verifies (§3) — could not grant that status even with a table grant',
    (SELECT CASE WHEN pg_temp.s7b_err('INSERT INTO public.tradition_pack_releases (id, pack_id, '
      || 'release_number, status, definition_schema_version, definition, languages, author_label, '
      || 'machine_assisted) VALUES (gen_random_uuid(), gen_random_uuid(), 1, ''approved'', 1, '
      || '''{"sections":[{"key":"welcome","label":"Welcome"}]}''::jsonb, ARRAY[''en'']::text[], '
      || '''ZZ Boundary elder'', false)') LIKE '%begins life as draft%' THEN 'named'
      ELSE 'unnamed' END), 'named');
END $C$;

-- ------------------------------------- N: the guest link, and the two credentials that are not one
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('ND', 'a well-formed credential that belongs to nothing is refused by the review door with one '
    'closed shape — no distinction between "not found", "wrong kind" and "expired" reaches an '
    'account-free caller',
   $t$SELECT api.resolve_family_review()$t$, 'P0001', '%'),
  ('ND', 'and the guest door answers the same way for the same credential',
   $t$SELECT api.resolve_public_invitation()$t$, 'P0001', '%');

DO $N$
DECLARE s s7c%ROWTYPE; v jsonb; raw3 text; req3 text; closed jsonb;
BEGIN
  SELECT * INTO s FROM s7c;

  PERFORM pg_temp.s7b_eq('N1 the guest credential captured in X9 is still the live one after an ask, '
    'a superseding freeze, an invalidation, a publication and an answer — same row id, same mint '
    'time, still unrevoked, and still exactly one',
    ARRAY[(SELECT count(*)::text FROM private.access_tokens t WHERE t.wedding_id = s.wed_a
             AND t.token_kind = 'public_invitation' AND t.revoked_at IS NULL),
          (SELECT t.id::text FROM private.access_tokens t WHERE t.wedding_id = s.wed_a
             AND t.token_kind = 'public_invitation' AND t.revoked_at IS NULL),
          (SELECT t.created_at::text FROM private.access_tokens t WHERE t.wedding_id = s.wed_a
             AND t.token_kind = 'public_invitation' AND t.revoked_at IS NULL),
          (SELECT (t.revoked_at IS NULL)::text FROM private.access_tokens t WHERE t.wedding_id =
             s.wed_a AND t.token_kind = 'public_invitation' AND t.revoked_at IS NULL)]::text[],
    ARRAY['1', current_setting('s7b.guest_tok'), current_setting('s7b.guest_created'),
          'true']::text[]);

  PERFORM pg_temp.s7b_eq('N2 the kind census at this point, named rather than summarised: review '
    'credentials exist revoked and live, and so do guest credentials. The guest pair is not sweep '
    'damage — it is the credential X rotated, which revokes its predecessor instead of deleting it. '
    'N2b is the assertion that does not need the reader to know that',
    (SELECT array_to_string(array_agg(k ORDER BY k COLLATE "C"), ',') FROM (
       SELECT t.token_kind || ':' || (t.revoked_at IS NOT NULL)::text AS k
         FROM private.access_tokens t WHERE t.wedding_id = s.wed_a
        GROUP BY 1) x),
    'approval_review:false,approval_review:true,public_invitation:false,public_invitation:true');

  -- The same claim relationally, so it does not rest on the reader knowing which event produced each
  -- row: the sweep is complete over the asks it was supposed to close, it over-reached into nothing
  -- that is still open, and the guest kind is untouched by it. The fourth count is deliberately not
  -- a publication match: `publish_invitation_version` re-points the live credential at the new
  -- publication row (20260926150000_stage3_privileged_bodies_behind_wrappers.sql:268-284), so the
  -- rotated-out predecessor keeps the *superseded* one. What rotation always leaves behind, and a
  -- sweep never would, is a later live credential on the same wedding — so that is what is counted.
  PERFORM pg_temp.s7b_eq('N2b four counts that add up to the scoping: no invalidated ask still '
    'holds a live review credential, no still-pending ask has had its credential revoked, exactly '
    'one guest credential is live, and no revoked guest credential is orphaned — each one has a '
    'younger live guest credential on the same wedding, which is the signature of a rotation and '
    'not of a review sweep §3 §6',
    ARRAY[
      (SELECT count(*)::text FROM private.access_tokens t
         JOIN public.approval_requests r ON r.id = t.approval_request_id
        WHERE t.wedding_id = s.wed_a AND t.token_kind = 'approval_review'
          AND r.status = 'invalidated' AND t.revoked_at IS NULL),
      (SELECT count(*)::text FROM private.access_tokens t
         JOIN public.approval_requests r ON r.id = t.approval_request_id
        WHERE t.wedding_id = s.wed_a AND t.token_kind = 'approval_review'
          AND r.status = 'pending' AND t.revoked_at IS NOT NULL),
      (SELECT count(*)::text FROM private.access_tokens t
        WHERE t.wedding_id = s.wed_a AND t.token_kind = 'public_invitation'
          AND t.revoked_at IS NULL),
      (SELECT count(*)::text FROM private.access_tokens t
        WHERE t.wedding_id = s.wed_a AND t.token_kind = 'public_invitation'
          AND t.revoked_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM private.access_tokens u
                           WHERE u.wedding_id = t.wedding_id
                             AND u.token_kind = 'public_invitation'
                             AND u.revoked_at IS NULL
                             AND u.created_at > t.created_at))
    ]::text[],
    ARRAY['0', '0', '1', '0']::text[]);

  -- A live review credential, for the interchange tests: an answered link proves nothing about a
  -- live one, and the whole point of the kind column is that the alphabets are identical.
  v := pg_temp.s7b_ask(4, 'Boundary cousin');
  raw3 := v ->> 'review_token';
  req3 := v ->> 'request_id';
  PERFORM set_config('s7b.raw3', raw3, false);
  PERFORM set_config('s7b.req3', req3, false);

  PERFORM pg_temp.s7b_eq('N3 a valid review credential presented to the guest door is refused, and '
    'the refusal is the closed shape rather than a different answer §3.1',
    pg_temp.s7b_door('guest', raw3), '{"available": false}'::jsonb);

  PERFORM pg_temp.s7b_eq('N4 and a valid guest credential presented to the review door is refused '
    'the same way: both credentials are 43 octets of the same alphabet, so only the kind column can '
    'tell them apart, and it does at both doors',
    pg_temp.s7b_door('review', current_setting('s7b.gue')), '{"available": false}'::jsonb);

  PERFORM pg_temp.s7b_eq('N5 neither door leaks the other''s answer when it refuses: the review door '
    'never carried the guest path, and the guest door''s path member is its own',
    ARRAY[pg_temp.s7b_absent(pg_temp.s7b_door('guest', raw3),
                             current_setting('s7b.gpath'))::text,
          pg_temp.s7b_absent(pg_temp.s7b_open(raw3),
                             current_setting('s7b.gpath'))::text,
          pg_temp.s7b_absent(pg_temp.s7b_open(current_setting('s7b.gue')),
                             current_setting('s7b.raw'))::text]::text[],
    ARRAY['true', 'true', 'true']::text[]);

  PERFORM pg_temp.s7b_eq('N6 the two doors differ in what they *record*: a guest read leaves no '
    'trace on its credential, while a review read stamps it — so the host''s queue can honestly say '
    'whether an aunt opened her link, and can never claim to know who is reading the invitation',
    ARRAY[(SELECT (t.last_used_at IS NULL)::text FROM private.access_tokens t
            WHERE t.wedding_id = s.wed_a AND t.token_kind = 'public_invitation'
              AND t.revoked_at IS NULL),
          (SELECT (t.last_used_at IS NOT NULL)::text FROM private.access_tokens t
            WHERE t.approval_request_id::text = current_setting('s7b.req3'))]::text[],
    ARRAY['true', 'true']::text[]);

  PERFORM pg_temp.s7b_eq('N7 and a header that is simply absent is the same closed refusal as a '
    'wrong one — a reviewer with no credential learns nothing about which weddings have asks open',
    pg_temp.s7b_open(NULL), '{"available": false}'::jsonb);

  PERFORM pg_temp.s7b_eq('N8 nor does a shape-violating credential reach the hash: the door checks '
    'the grammar before it digests anything, so a caller cannot use the door as an oracle on whether '
    'a string is a real credential §3',
    ARRAY[pg_temp.s7b_open('short')::text, pg_temp.s7b_open(repeat('A', 44))::text,
          pg_temp.s7b_open(repeat('!', 43))::text]::text[],
    ARRAY['{"available": false}', '{"available": false}', '{"available": false}']::text[]);
END $N$;

-- ------------------------------------------------ Z: the census this file leaves behind, named
DO $Z$
DECLARE s s7c%ROWTYPE;
BEGIN
  SELECT * INTO s FROM s7c;

  PERFORM pg_temp.s7b_eq('Z1 asks: battery 1''s seven, plus three minted here — one invalidated by a '
    'successor, one answered with a note, one still live for N3 to N8 to read. All ten are still '
    'rows: this file deleted no history',
    (SELECT count(*) FROM public.approval_requests r WHERE r.wedding_id = s.wed_a), 10::bigint);

  -- Sorted, not ordered by time. Battery 1 writes its two feedback rows inside one transaction, so
  -- both carry the same `created_at` instant and an `ORDER BY created_at` picks between them at
  -- random — the same hazard the `$G8$` block records, and the shape that made an earlier draft of
  -- this census fail on one chain and pass on the next. `id` is no better: it is a
  -- `gen_random_uuid()`, stable within a run but different on every fresh chain, so a hardcoded
  -- want list could not survive a rebuild either. What is reproducible is the multiset, so the
  -- census states the multiset — plus the message count, because the note's shape is part of the
  -- claim being made here and is measured rather than asserted in the prose.
  PERFORM pg_temp.s7b_eq('Z2 feedback: battery 1''s two decisions plus the one note this file '
    'answered with — three rows, all of kind `decision`, one approved and two changes_requested, and '
    'two of them carrying a message (battery 1''s Daughter note and this file''s Boundary-aunt note; '
    'the approved decision carries none), which is the shape §2.4 chose',
    pg_temp.s7b_sorted(
      (SELECT array_agg(x.feedback_kind || ':' || coalesce(x.decision, '-'))
         FROM public.approval_feedback x WHERE x.wedding_id = s.wed_a))
      || ARRAY[(SELECT count(*)::text FROM public.approval_feedback x
                 WHERE x.wedding_id = s.wed_a AND x.message IS NOT NULL)::text],
    ARRAY['decision:approved', 'decision:changes_requested',
          'decision:changes_requested', '2']::text[]);

  PERFORM pg_temp.s7b_eq('Z3 versions: three from battery 1 plus this file''s fourth, and the '
    'publication now names the fourth — the wedding is left in a state its own host could reach, not '
    'in a half-written one',
    ARRAY[(SELECT count(*)::text FROM public.invitation_versions WHERE wedding_id = s.wed_a),
          (SELECT v.version_number::text FROM public.publications p
             JOIN public.invitation_versions v ON v.id = p.version_id
            WHERE p.wedding_id = s.wed_a AND p.status = 'active')]::text[],
    ARRAY['4', '4']::text[]);

  PERFORM pg_temp.s7b_eq('Z4 credentials: thirteen rows on this wedding, no raw string among them — '
    'the whole store holds hashes. Two review credentials are live, and both are named: battery 1 '
    'left the nephew''s ask pending with its link unrevoked, and this file added the cousin''s ask '
    'that N3 to N8 read. The nine rows under them are battery 1''s eight review credentials and '
    'guest link, plus this file''s three more asks, its one rotation and the successor link — a '
    'thirteenth row that deletes nothing §I10',
    ARRAY[(SELECT count(*)::text FROM private.access_tokens WHERE wedding_id = s.wed_a),
          (SELECT count(*)::text FROM private.access_tokens WHERE wedding_id = s.wed_a
             AND token_kind = 'approval_review' AND revoked_at IS NULL),
          (SELECT count(*)::text FROM private.access_tokens t
             WHERE t.wedding_id = s.wed_a AND t.token_hash !~ '^[0-9a-f]{64}$')]::text[],
    ARRAY['13', '2', '0']::text[]);

  PERFORM pg_temp.s7b_eq('Z5 the draft was edited and the guest document with it, while the two '
    'earlier snapshots stay as they were frozen: this file leaves one wedding whose published page '
    'carries a marker string and whose history does not',
    ARRAY[(SELECT (d.content ->> 'welcome') = current_setting('s7b.mk_draft') FROM
             public.invitation_drafts d WHERE d.wedding_id = s.wed_a)::text,
          (SELECT count(*)::text FROM public.invitation_versions x
             WHERE x.wedding_id = s.wed_a
               AND x.snapshot::text LIKE '%' || current_setting('s7b.mk_draft') || '%')]::text[],
    ARRAY['true', '1']::text[]);

  PERFORM pg_temp.s7b_eq('Z6 the canaries are left in place on purpose: a host note, a salutation, an '
    'RSVP row, a household scope, one `ready` asset and its object record. They are disclosure, not '
    'leakage — nothing in the invitation, publication or review surface projects them, which is '
    'what K measured',
    ARRAY[(SELECT count(*)::text FROM public.rsvp_responses WHERE wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.household_event_scopes WHERE wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.wedding_assets a WHERE a.wedding_id = s.wed_a
             AND a.upload_status = 'ready'),
          (SELECT count(*)::text FROM storage.objects o
             WHERE o.name = current_setting('s7b.asset_key'))]::text[],
    ARRAY['1', '1', '1', '1']::text[]);

  PERFORM pg_temp.s7b_eq('Z7 the object record cannot be removed from this tier, and that is a fact '
    'about the product rather than an oversight here: `storage.objects` refuses direct deletion, so '
    'a battery that wants bytes gone uses the Storage API, which this SQL tier does not have — the '
    'row is left, named, and never referenced by any response this file tested',
    (SELECT count(*) FROM storage.objects o
      WHERE o.name = current_setting('s7b.asset_key')
        AND o.bucket_id = 'wedding-assets'), 1::bigint);

  PERFORM pg_temp.s7b_eq('Z8 and the stranger wedding is untouched by all of it: battery 1 left it '
    'two versions and no asks, and this file never wrote to it — the cross-tenant claims above are '
    'about a document that stayed exactly as large as it was',
    ARRAY[(SELECT count(*)::text FROM public.invitation_versions WHERE wedding_id = s.wed_b),
          (SELECT count(*)::text FROM public.approval_requests WHERE wedding_id = s.wed_b),
          (SELECT count(*)::text FROM public.approval_feedback WHERE wedding_id = s.wed_b)]::text[],
    ARRAY['2', '0', '0']::text[]);
END $Z$;

-- --------------------------------------------------------------------------- L: the floor
-- The floor is the measured count at this head, not a rounded-down guess. It exists so that a
-- skipped group — a DO block that never ran, a probe group whose rows were deleted — cannot read
-- as a pass. The assertion is made *through* the counter so the printed total and the observed PASS
-- lines cannot drift apart.
--
-- 115 is the counter's value at this statement; the L1 pass below is the 116th assertion, and 116 is
-- the number the closing line reports. Measured on a chain-only database with battery 1 committed
-- first, which is what `run.sh` arranges: this file reads that battery's residue, so its count is
-- only defined on that state. An earlier draft of this floor was `< 1`, which would have printed a
-- pass for a single surviving assertion.
DO $L$
DECLARE ran integer;
BEGIN
  ran := coalesce(nullif(current_setting('s7b.passed', true), ''), '0')::int;
  IF ran < 115 THEN
    RAISE EXCEPTION 'FAIL: only % Stage 7 boundary assertions ran — the measured floor is 115 '
      '(the closing line reports one more, this L1 assertion itself)', ran;
  END IF;
  PERFORM pg_temp.s7b_ok('L1 the counter, the fixtures and the floor all moved together ('
    || ran || ' assertions)', true);
END $L$;

SELECT 'STAGE7 REVIEW BOUNDARY TESTS PASSED (' || current_setting('s7b.passed') || ')';
