-- Stage 9 battery 2: the two exposed render verbs — what they answer, to whom, from which document, and
-- what they refuse to carry.
--
-- Run by `supabase/tests/stage9/run.sh render` immediately after battery 1, as the superuser, in one
-- transaction that commits. It reads battery 1's committed residue the way Stage 7's and Stage 8's second
-- batteries read their first ones: the cast below is a SELECT over rows battery 1 created, and group X
-- pins that residue *before* anything is asserted about the answers, because a projection assertion made
-- over an empty manifest passes for the wrong reason. If the residue is not what battery 1 claimed, X
-- fails here and says which number moved.
--
--   X  the cast: the residue read back — two hosts, three weddings, two frozen versions, sixty artefact
--      rows in five states, sixty-one planted objects in three buckets, and the draft word this file
--      mutates and must restore
--   A  §7/§8 — the four names as catalogue rows: the two postures, the two search paths, the two ACLs,
--      the two languages, the volatility, the owner, and the wrapper's body read as one statement
--   R  §7/§8 — every caller posture that is refused, each one measured as SQLSTATE *and* sentence, on
--      both surfaces, through both schemas, plus the arms that must read identically to be one refusal
--      rather than an existence oracle
--   D  §7 — the manifest as an answer: the fifteen names on every element, the three names deliberately
--      not there, nulls that stay present, the order the client receives, and what no element may
--      contain
--   F  §7 — the frozen document: its twelve top-level names, the projection rather than the snapshot,
--      the fixture's own words inside it, and the privacy needles run over the answer itself
--   C  the determinism claim the whole stage rests on: the frozen answer does not move when the host
--      types, and the live answer does
--   V  the arm that refuses to render a version it cannot project, on a row no product path would make
--   W  the second wedding's document, and the same answer twice
--   Z  the census this file leaves behind — which is battery 1's census, unchanged
--   L  the floor
--
-- Where a refusal is measured it is measured twice, the SQLSTATE and the sentence, for the reason every
-- battery in this repository now gives: `left(SQLSTATE,5)` cannot tell a 42501 from a psql syntax error,
-- and this repository has already scored a syntax error as a security refusal once. A probe group that
-- runs no rows is a failure, not a skip, and a probe that returns no error is a failure, not a refusal
-- that happened not to fire.
--
-- The role discipline mirrors the product, not the test. Every host read runs as `authenticated` with
-- `test.uid` naming the account, including the two verbs themselves — these are browser-facing doors, and
-- a measurement of them made as the superuser would be measuring a caller that does not exist. The
-- superuser's own answer *is* measured (R5), because it is a fact about this engine that a reader of this
-- file cannot see from the grants: `postgres` bypasses the function ACL entirely, so both verbs answer
-- for it. That is disclosed, not asserted as product behaviour.
--
-- Values a probe needs while it holds a role are carried in `s9b.*` settings or written into the probe's
-- own statement text, never read from `pg_temp`: an impersonated role cannot see this file's temp
-- fixture.
--
-- Two things are asserted about privacy that are worth naming, because a naive version of each would be
-- wrong rather than merely weak.
--   1. The credential needles are exact-value needles. `storage.objects` holds four published-preview
--      keys of the shape `p/<43 unguessable characters>` and sixty artefact paths; the battery asks
--      whether *those strings* appear inside the answer, not whether the answer contains a 43-character
--      run. It does: `content_digest` and `render_config_hash` are 64-hex digests, and a 43-character
--      window inside a 64-character hex string is a shape match with no meaning. The first draft of this
--      file used the shape needle and passed a defect-free answer through it in one direction and failed
--      a correct one in the other.
--   2. The word `token` does appear in the manifest, once, as the invalidation reason `token_rotated`,
--      which §4's vocabulary legitimately contains. D7 asserts that and only that, so the needle is
--      documented against the residue rather than pretended absent.
--
-- Three things this battery does not claim:
--   1. It is not the render tier. Nothing here produces an image, a PDF or a QR payload; the verbs under
--      test answer with a description of artefacts and a document, and whether the bytes a `ready` row
--      claims match what was uploaded is the render tier's question (`docs/audits/stage-9-render-exports.md`).
--   2. It is not the HTTP tier. There is no PostgREST here, so `permission denied for function …` is the
--      database's refusal and not a status code, and no signed URL is minted or fetched.
--   3. Group V's row is planted by the superuser with the columns filled in by hand, because no product
--      path can freeze a snapshot this build cannot project. It exists to measure a guard that is only
--      reachable from underneath, is labelled as such in every cell that uses it, and is deleted by the
--      group that created it — Z2 proves the deletion.

SET client_min_messages = notice;
SET search_path = public, pg_temp;

-- --------------------------------------------------------------------------- the harness
SELECT set_config('s9b.passed', '0', false);

CREATE FUNCTION pg_temp.s9b_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s9b.passed',
    (coalesce(nullif(current_setting('s9b.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s9b_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s9b_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s9b_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s9b_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s9b_sorted(want text[]) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM unnest(coalesce(want, '{}'::text[])) u(k) $fn$;

CREATE FUNCTION pg_temp.s9b_top_keys(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM jsonb_object_keys(v) u(k) $fn$;

CREATE FUNCTION pg_temp.s9b_has_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % , not an object', label, jsonb_typeof(v);
  END IF;
  PERFORM pg_temp.s9b_eq(label, pg_temp.s9b_top_keys(v), pg_temp.s9b_sorted(want));
END $fn$;

-- The answer the caller is handed, with a refusal treated as a broken battery rather than as a measured
-- result. Every acceptance in this file goes through it, so a door that quietly stopped working cannot
-- make the assertions below vacuous.
CREATE FUNCTION pg_temp.s9b_auth(uid text, stmt text) RETURNS jsonb
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

-- The same call, but the answer *is* whether it refused: `ACCEPTED` or `SQLSTATE | sentence`. Used for
-- the refusal arms, whose content is the message, and for the one posture whose acceptance is itself the
-- finding.
CREATE FUNCTION pg_temp.s9b_try(p_role text, p_uid text, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  IF p_uid IS NOT NULL THEN
    PERFORM set_config('test.uid', p_uid, false);
  END IF;
  BEGIN
    EXECUTE stmt INTO v;
    EXECUTE 'RESET ROLE';
    RETURN 'ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN SQLSTATE || ' | ' || SQLERRM;
  END;
END $fn$;

-- The same posture as `s9b_try` for a statement that returns no rows. `EXECUTE … INTO` cannot run an
-- UPDATE, so the two cells that make a host write its own draft would otherwise score the harness's own
-- 42601 as if the host had been refused.
CREATE FUNCTION pg_temp.s9b_write(p_role text, p_uid text, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_role NOT IN ('postgres', 'anon', 'authenticated', 'service_role') THEN
    RAISE EXCEPTION 'FAIL: probe role % is not one this file may assume', p_role;
  END IF;
  EXECUTE 'SET ROLE ' || p_role;
  IF p_uid IS NOT NULL THEN
    PERFORM set_config('test.uid', p_uid, false);
  END IF;
  BEGIN
    EXECUTE stmt;
    EXECUTE 'RESET ROLE';
    RETURN 'ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN SQLSTATE || ' | ' || SQLERRM;
  END;
END $fn$;

CREATE TEMP TABLE probes (
  grp         text,
  label       text,
  stmt        text,
  want_state  text,
  want_like   text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.s9b_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

CREATE FUNCTION pg_temp.s9b_run(p_grp text, p_role text, p_uid text) RETURNS void
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
            FROM probes p WHERE p.grp = s9b_run.p_grp ORDER BY p.label) s;

  IF v_labels IS NULL THEN
    RAISE EXCEPTION 'FAIL: probe group % ran no probes — an empty group is a skip, not a pass', p_grp;
  END IF;

  FOR i IN 1 .. cardinality(v_labels) LOOP
    EXECUTE 'SET ROLE ' || p_role;
    IF p_uid IS NOT NULL THEN
      PERFORM set_config('test.uid', p_uid, false);
    END IF;
    v := pg_temp.s9b_err(v_stmts[i]);
    EXECUTE 'RESET ROLE';

    IF v = 'no-error' THEN
      RAISE EXCEPTION 'FAIL %: "%" was allowed through', p_grp, v_labels[i];
    END IF;
    IF split_part(v, ' ', 1) <> v_states[i] OR v NOT LIKE v_likes[i] THEN
      RAISE EXCEPTION 'FAIL %: "%" got [%] want [% / %]',
        p_grp, v_labels[i], v, v_states[i], v_likes[i];
    END IF;
    RAISE NOTICE 'PASS %: %', p_grp, v_labels[i];
    PERFORM pg_temp.s9b_add(1);
  END LOOP;
END $fn$;

-- An exact-substring absence over a list the caller hands in, and a needle list this file reads out of
-- the database rather than types. `strpos`, not `LIKE`, because a preview key contains `_` characters
-- that a `LIKE` pattern would silently turn into single-character wildcards.
CREATE FUNCTION pg_temp.s9b_absent(label text, hay text, list text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF hay IS NULL THEN
    RAISE EXCEPTION 'FAIL % — nothing was answered, so nothing was proven absent', label;
  END IF;
  IF list IS NULL OR cardinality(list) = 0 THEN
    RAISE EXCEPTION 'FAIL % — the needle list is empty, which proves nothing', label;
  END IF;
  PERFORM pg_temp.s9b_eq(label || ' (carried by none of the ' || cardinality(list) ||
    ' names, first hit at offset)',
    coalesce((SELECT min(strpos(hay, n)) FROM unnest(list) n WHERE strpos(hay, n) > 0), 0)::text,
    '0');
END $fn$;

-- The manifest's fifteen names and the document's twelve, written once here because several groups have
-- to compare against them, and a projection assertion that re-types the list at each call site is a list
-- that can differ per call site.
CREATE FUNCTION pg_temp.s9b_manifest_keys() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT pg_temp.s9b_sorted(ARRAY['attempt_count','content_digest','created_at','format','id',
         'invalidation_reason','last_error','output_kind','page_number','ready_at',
         'render_config_hash','status','storage_domain','variant','version_id']) $fn$;

CREATE FUNCTION pg_temp.s9b_document_keys() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT pg_temp.s9b_sorted(ARRAY['closing','design_template','event_notes','events',
         'family_introduction','language','people','sections','style','title','tradition_pack',
         'welcome']) $fn$;

-- --------------------------------------------------------------------------- X: the cast
-- Read back, not assumed. Battery 2 mints nothing: the two hosts, the three weddings, the two frozen
-- versions and the sixty artefact rows are battery 1's, and the counts below are battery 1's own
-- published numbers, re-derivable from its `Z` group. This group is what makes the rest of the file mean
-- something — a manifest projection asserted over zero elements passes, and means nothing.
DO $X$
DECLARE v_owner_a uuid; v_owner_b uuid; v_wed_a uuid; v_wed_b uuid; v_wed_none uuid;
        v_ver_a uuid; v_ver_b uuid; v jsonb;
BEGIN
  SELECT u.id, w.id INTO v_owner_a, v_wed_a
    FROM auth.users u JOIN public.weddings w ON w.owner_user_id = u.id
   WHERE u.email = 's9-owner-a@stage9qual.test';
  SELECT u.id, w.id INTO v_owner_b, v_wed_b
    FROM auth.users u JOIN public.weddings w ON w.owner_user_id = u.id
   WHERE u.email = 's9-owner-b@stage9qual.test';
  SELECT w.id INTO v_wed_none FROM public.weddings w WHERE w.title = 'Nothing Rendered Yet';
  SELECT i.id INTO v_ver_a FROM public.invitation_versions i WHERE i.wedding_id = v_wed_a;
  SELECT i.id INTO v_ver_b FROM public.invitation_versions i WHERE i.wedding_id = v_wed_b;

  PERFORM set_config('s9b.owner_a', v_owner_a::text, false);
  PERFORM set_config('s9b.owner_b', v_owner_b::text, false);
  PERFORM set_config('s9b.wed_a',   v_wed_a::text, false);
  PERFORM set_config('s9b.wed_b',   v_wed_b::text, false);
  PERFORM set_config('s9b.wed_none', v_wed_none::text, false);
  PERFORM set_config('s9b.ver_a',   v_ver_a::text, false);
  PERFORM set_config('s9b.ver_b',   v_ver_b::text, false);

  PERFORM pg_temp.s9b_eq('X1 the two hosts, three weddings and two frozen versions battery 1 left '
    'behind are all here, each one resolved from the fixture''s own names rather than from a saved uuid, '
    'and exactly one version belongs to each of the two rendered weddings',
    ARRAY[(SELECT count(*)::text FROM auth.users WHERE id IN (v_owner_a, v_owner_b)),
          (SELECT count(*)::text FROM public.weddings),
          (SELECT count(*)::text FROM public.invitation_versions),
          (SELECT count(*)::text FROM public.invitation_versions WHERE wedding_id = v_wed_a),
          (SELECT count(*)::text FROM public.invitation_versions WHERE wedding_id = v_wed_none)]::text[],
    ARRAY['2', '3', '2', '1', '0']::text[]);

  PERFORM pg_temp.s9b_ok('X2 the tested version is pinned to the tested wedding and declares snapshot '
    'schema 2, which is the schema the render body hands to the projection function rather than an '
    'assumption this file makes about it',
    (SELECT count(*) FROM public.invitation_versions i
      WHERE i.id = v_ver_a AND i.wedding_id = v_wed_a
        AND i.snapshot_schema_version = 2) = 1);

  PERFORM pg_temp.s9b_eq('X3 the sixty artefact rows are all on this wedding and all on this version: '
    'the manifest this file reads is battery 1''s display set, and a row that belonged to another wedding '
    'or another version would make every element assertion below it about a set that is not this one',
    (SELECT ARRAY[
        (count(*))::text,
        (count(*) FILTER (WHERE wedding_id = current_setting('s9b.wed_a')::uuid))::text,
        (count(*) FILTER (WHERE version_id = current_setting('s9b.ver_a')::uuid))::text
       ]::text[]
       FROM public.invitation_outputs),
    ARRAY['60', '60', '60']::text[]);

  PERFORM pg_temp.s9b_eq('X4 the five-state census battery 1 published at its Z3b, read again here — '
    'battery 2 asserts about states, digests and nulls that only exist in these proportions',
    (SELECT coalesce(string_agg(x, ' ' ORDER BY x COLLATE "C"), '-')
       FROM (SELECT status || '=' || count(*)::text AS x
               FROM public.invitation_outputs GROUP BY status) q),
    'failed=7 invalidated=9 ready=19 registered=14 uploading=11'::text);

  PERFORM pg_temp.s9b_eq('X5 the geometry census: four kinds across six variants and three formats, '
    'so an ordering assertion has real columns to order by rather than one repeated value',
    ARRAY[(SELECT coalesce(string_agg(x, ' ' ORDER BY x COLLATE "C"), '-')
             FROM (SELECT output_kind || '=' || count(*)::text AS x
                     FROM public.invitation_outputs GROUP BY output_kind) q),
          (SELECT coalesce(string_agg(x, ' ' ORDER BY x COLLATE "C"), '-')
             FROM (SELECT format || '=' || count(*)::text AS x
                     FROM public.invitation_outputs GROUP BY format) q),
          (SELECT coalesce(string_agg(x, ' ' ORDER BY x COLLATE "C"), '-')
             FROM (SELECT storage_domain || '=' || count(*)::text AS x
                     FROM public.invitation_outputs GROUP BY storage_domain) q)]::text[],
    ARRAY['og_image=6 pdf=3 qr=2 share_image=49', 'pdf=3 png=54 webp=3',
          'host_private=56 published_preview=4']::text[]);

  PERFORM pg_temp.s9b_eq('X6 the bytes behind the rows: sixty-one objects in three buckets, fifty-seven '
    'in the readable one and four in the closed one, and exactly one object no manifest row claims — the '
    'battery-1 decoy, still here, so D6 asks about a set that includes a name the answer must never print',
    ARRAY[(SELECT count(*)::text FROM storage.objects),
          (SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'invitation-outputs'),
          (SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'invitation-previews'),
          (SELECT count(*)::text FROM storage.objects o
             WHERE NOT EXISTS (SELECT 1 FROM public.invitation_outputs m
                                 WHERE m.object_key = o.name)),
          (SELECT coalesce(string_agg(id, ',' ORDER BY id COLLATE "C"), '(none)')
             FROM storage.buckets)]::text[],
    ARRAY['61', '57', '4', '1',
          'invitation-outputs,invitation-previews,wedding-assets']::text[]);

  PERFORM pg_temp.s9b_eq('X7 every preview object is credential-shaped: four names of the form '
    'p/<43 characters>. They exist in this database, which is what makes the needle at D5 a test rather '
    'than a tautology — the answer is being compared against live keys, not against an empty table',
    (SELECT count(*)::text FROM storage.objects
      WHERE bucket_id = 'invitation-previews'
        AND name ~ '^p/[A-Za-z0-9_-]{43}$'),
    '4'::text);

  v := pg_temp.s9b_auth(current_setting('s9b.owner_a'),
        'SELECT content FROM public.invitation_drafts WHERE wedding_id = '
        || quote_literal(current_setting('s9b.wed_a')) || '::uuid');
  PERFORM pg_temp.s9b_eq('X8 the draft word this file mutates at C2 and must restore at C8, captured '
    'before the mutation rather than remembered after it',
    v ->> 'closing', 'With love');
  PERFORM set_config('s9b.draft_before', v::text, false);

  v := pg_temp.s9b_auth(current_setting('s9b.owner_a'),
        'SELECT api.list_invitation_outputs(' || quote_literal(current_setting('s9b.wed_a'))
        || '::uuid)');
  PERFORM pg_temp.s9b_ok('X9 the manifest is not empty when this file reaches it (60 elements), so '
    'nothing in group D is an assertion made over the empty array',
    jsonb_typeof(v) = 'array' AND jsonb_array_length(v) = 60);
END $X$;

-- --------------------------------------------------------------------------- A: the catalogue
-- Read from `pg_proc` and `pg_namespace`, because the claim is about the objects the migration made, and
-- the two postures being distinguishable in the catalog is what the design says they are for.
DO $A$
DECLARE v text;
BEGIN
  PERFORM pg_temp.s9b_eq('A1 exactly four names carry these two verbs, two per schema, and nothing else '
    'in the running build shares either name',
    (SELECT coalesce(string_agg(x, ',' ORDER BY x COLLATE "C"), '(none)')
       FROM (SELECT format('%s.%s', n.nspname, p.proname) AS x
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.proname IN ('render_invitation_document','list_invitation_outputs')) q)::text,
    'api.list_invitation_outputs,api.render_invitation_document,'
    || 'internal_api.list_invitation_outputs,internal_api.render_invitation_document'::text);

  PERFORM pg_temp.s9b_eq('A2 each name has exactly one signature, taking one uuid: a call site cannot be '
    'ambiguous, and a second overload would be a second way to ask that this file does not know about',
    (SELECT coalesce(string_agg(x, ' ;; ' ORDER BY x COLLATE "C"), '(none)')
       FROM (SELECT format('%s.%s(%s)=%s', n.nspname, p.proname,
                           pg_get_function_arguments(p.oid),
                           (SELECT count(*) FROM pg_proc p2
                             WHERE p2.proname = p.proname
                               AND p2.pronamespace = p.pronamespace)) AS x
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE p.proname IN ('render_invitation_document','list_invitation_outputs')) q)::text,
    'api.list_invitation_outputs(p_wedding_id uuid)=1 ;; '
    || 'api.render_invitation_document(p_version_id uuid)=1 ;; '
    || 'internal_api.list_invitation_outputs(p_wedding_id uuid)=1 ;; '
    || 'internal_api.render_invitation_document(p_version_id uuid)=1'::text);

  -- The two postures, side by side. `api` is INVOKER (prosecdef false) and `internal_api` DEFINER (true);
  -- both set an empty search_path; both are STABLE and non-strict; both are owned by `postgres`.
  PERFORM pg_temp.s9b_eq('A3 the wrapper schema is SECURITY INVOKER and the body schema is SECURITY '
    'DEFINER, read as prosecdef rather than inferred from a passing call — this is the pair the comment '
    'on the migration says should be legible from the catalog',
    (SELECT coalesce(string_agg(x, ' ;; ' ORDER BY x COLLATE "C"), '(none)')
       FROM (SELECT format('%s.%s=%s', n.nspname, p.proname,
                           CASE WHEN p.prosecdef THEN 'true' ELSE 'false' END) AS x
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.proname IN ('render_invitation_document','list_invitation_outputs')) q)::text,
    'api.list_invitation_outputs=false ;; api.render_invitation_document=false ;; '
    || 'internal_api.list_invitation_outputs=true ;; '
    || 'internal_api.render_invitation_document=true'::text);

  PERFORM pg_temp.s9b_eq('A4 all four pin an empty search_path, including the wrappers that only '
    'delegate — which is what stops a caller steering which schema the delegation resolves through',
    (SELECT coalesce(string_agg(x, ' ;; ' ORDER BY x COLLATE "C"), '(none)')
       FROM (SELECT format('%s.%s=%s', n.nspname, p.proname,
                           coalesce(array_to_string(p.proconfig, ','), '(none)')) AS x
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.proname IN ('render_invitation_document','list_invitation_outputs')) q)::text,
    'api.list_invitation_outputs=search_path="" ;; '
    || 'api.render_invitation_document=search_path="" ;; '
    || 'internal_api.list_invitation_outputs=search_path="" ;; '
    || 'internal_api.render_invitation_document=search_path=""'::text);

  PERFORM pg_temp.s9b_eq('A5 the wrappers are SQL and the bodies are plpgsql, STABLE for all four, and '
    'none is strict — so a NULL argument reaches the body''s own refusal instead of silently answering '
    'NULL, which is the difference between an authorisation check and a missing row',
    ARRAY[(SELECT coalesce(string_agg(x, ' ;; ' ORDER BY x COLLATE "C"), '(none)')
             FROM (SELECT format('%s.%s=%s', n.nspname, p.proname, l.lanname) AS x
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     JOIN pg_language l ON l.oid = p.prolang
                    WHERE p.proname IN ('render_invitation_document','list_invitation_outputs')) q),
          (SELECT coalesce(string_agg(x, ' ;; ' ORDER BY x COLLATE "C"), '(none)')
             FROM (SELECT format('%s.%s=%s', n.nspname, p.proname, p.provolatile) AS x
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE p.proname IN ('render_invitation_document','list_invitation_outputs')) q),
          (SELECT coalesce(string_agg(x, ' ;; ' ORDER BY x COLLATE "C"), '(none)')
             FROM (SELECT format('%s.%s=%s', n.nspname, p.proname,
                           CASE WHEN p.proisstrict THEN 'true' ELSE 'false' END) AS x
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE p.proname IN ('render_invitation_document','list_invitation_outputs')) q)]::text[],
    ARRAY['api.list_invitation_outputs=sql ;; api.render_invitation_document=sql ;; '
          || 'internal_api.list_invitation_outputs=plpgsql ;; '
          || 'internal_api.render_invitation_document=plpgsql',
          'api.list_invitation_outputs=s ;; api.render_invitation_document=s ;; '
          || 'internal_api.list_invitation_outputs=s ;; internal_api.render_invitation_document=s',
          'api.list_invitation_outputs=false ;; api.render_invitation_document=false ;; '
          || 'internal_api.list_invitation_outputs=false ;; '
          || 'internal_api.render_invitation_document=false']::text[]);

  PERFORM pg_temp.s9b_eq('A6 the executable ACL of all four names is exactly `postgres` plus '
    '`authenticated`, granted by `postgres`: no `anon`, no `service_role`, no PUBLIC, and the grantor is '
    'the same in both schemas. This is why R answers what it answers',
    (SELECT coalesce(string_agg(x, ' ;; ' ORDER BY x COLLATE "C"), '(none)')
       FROM (SELECT format('%s.%s=%s', n.nspname, p.proname,
                           coalesce(array_to_string(p.proacl, ','), '(default)')) AS x
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.proname IN ('render_invitation_document','list_invitation_outputs')) q)::text,
    'api.list_invitation_outputs=postgres=X/postgres,authenticated=X/postgres ;; '
    || 'api.render_invitation_document=postgres=X/postgres,authenticated=X/postgres ;; '
    || 'internal_api.list_invitation_outputs=postgres=X/postgres,authenticated=X/postgres ;; '
    || 'internal_api.render_invitation_document=postgres=X/postgres,authenticated=X/postgres'::text);

  -- The wrapper's body, with every whitespace character removed, compared to the one statement it is
  -- supposed to be. Read this as: the wrapper decides nothing.
  PERFORM pg_temp.s9b_eq('A7 each wrapper''s source is a single delegation and nothing else — not a '
    'check, not a coalesce, not a second call. The authorization lives in the body, which is the layout '
    'Stage 3 fixed and Stages 4-8 followed',
    (SELECT coalesce(string_agg(x, ' ;; ' ORDER BY x COLLATE "C"), '(none)')
       FROM (SELECT format('%s={%s}', p.proname, regexp_replace(p.prosrc, '\s', '', 'g')) AS x
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'api'
                AND p.proname IN ('render_invitation_document','list_invitation_outputs')) q)::text,
    'list_invitation_outputs={SELECTinternal_api.list_invitation_outputs(p_wedding_id);}'
    || ' ;; render_invitation_document='
    || '{SELECTinternal_api.render_invitation_document(p_version_id);}'::text);

  PERFORM pg_temp.s9b_eq('A8 the two bodies raise the two sentences the callers receive, read out of '
    'their own source: the refusal is the product''s words, not something a layer above the database '
    'substitutes on the way out',
    ARRAY[(SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'internal_api' AND p.proname = 'list_invitation_outputs'
              AND p.prosrc LIKE '%the caller may not read this wedding%'),
          (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'internal_api' AND p.proname = 'render_invitation_document'
              AND p.prosrc LIKE '%the caller may not render this version%'),
          (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'internal_api' AND p.proname = 'render_invitation_document'
              AND p.prosrc LIKE '%this version cannot be rendered as it is currently shaped%')]::text[],
    ARRAY['1', '1', '1']::text[]);

  PERFORM pg_temp.s9b_eq('A9 the schemas, not just the functions: `anon` holds USAGE on both and EXECUTE '
    'on neither of these four, so its refusal is about the function — and `service_role` holds USAGE on '
    'neither, so the trusted backend cannot call a browser door even though it can write the table',
    ARRAY[has_schema_privilege('anon', 'api', 'USAGE')::text,
          has_schema_privilege('anon', 'internal_api', 'USAGE')::text,
          has_function_privilege('anon', 'api.list_invitation_outputs(uuid)', 'EXECUTE')::text,
          has_function_privilege('anon', 'internal_api.list_invitation_outputs(uuid)', 'EXECUTE')::text,
          has_schema_privilege('service_role', 'api', 'USAGE')::text,
          has_schema_privilege('service_role', 'internal_api', 'USAGE')::text]::text[],
    ARRAY['true', 'true', 'false', 'false', 'false', 'false']::text[]);

  PERFORM pg_temp.s9b_ok('A10 `authenticated` may execute the internal bodies directly, which is the '
    'deviation battery 1 records at its head: the `api` wrapper is a naming and transport boundary, not '
    'the thing standing in front of the data. Every authorization claim below is therefore made about the '
    'body, and R6 measures the two paths against each other rather than pretending one guards the other',
    has_function_privilege('authenticated', 'internal_api.list_invitation_outputs(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'internal_api.render_invitation_document(uuid)', 'EXECUTE'));

  PERFORM pg_temp.s9b_eq('A11 both Stage 9 bodies are owned by `postgres`, which is what makes their '
    'SECURITY DEFINER posture a real elevation rather than a no-op: the body runs as the table''s owner, '
    'and its first act is to ask whether the caller may be served',
    (SELECT coalesce(string_agg(r.rolname, ',' ORDER BY r.rolname COLLATE "C"), '(none)')
       FROM (SELECT DISTINCT p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.proname IN ('render_invitation_document','list_invitation_outputs')) d
       JOIN pg_roles r ON r.oid = d.proowner)::text,
    'postgres'::text);
END $A$;

-- --------------------------------------------------------------------------- R: the refusals
-- Twelve statements, six postures, two surfaces. Every one of them is a *raised* refusal, so every one
-- goes through `s9b_run` and has to answer with both a code and a sentence.
DO $R0$
DECLARE v_wed_a uuid; v_wed_b uuid; v_ver_a uuid; v_uuid text;
BEGIN
  v_wed_a := current_setting('s9b.wed_a')::uuid;
  v_wed_b := current_setting('s9b.wed_b')::uuid;
  v_ver_a := current_setting('s9b.ver_a')::uuid;

  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('AN', 'AN1 an unauthenticated caller cannot ask for a wedding''s manifest through the exposed '
           'wrapper, and the refusal names the function',
     'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_a::text) || '::uuid)',
     '42501', '%permission denied for function list_invitation_outputs%'),
    ('AN', 'AN2 an unauthenticated caller cannot ask for the document behind a version id through the '
           'exposed wrapper either — the anonymous surface stays where Stages 3, 7 and 8 left it',
     'SELECT api.render_invitation_document(' || quote_literal(v_ver_a::text) || '::uuid)',
     '42501', '%permission denied for function render_invitation_document%'),
    ('AI', 'AN3 the same caller naming the internal body directly gets the same answer, because the '
           'function ACL is the wall and `anon` holds USAGE on `internal_api`',
     'SELECT internal_api.list_invitation_outputs(' || quote_literal(v_wed_a::text) || '::uuid)',
     '42501', '%permission denied for function list_invitation_outputs%'),
    ('AI', 'AN4 and the same for the internal render body',
     'SELECT internal_api.render_invitation_document(' || quote_literal(v_ver_a::text) || '::uuid)',
     '42501', '%permission denied for function render_invitation_document%'),
    ('SA', 'SA1 the trusted backend has no door here: it is not a browser, and it holds no USAGE on the '
           'exposed schema, so it refuses at the schema',
     'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_a::text) || '::uuid)',
     '42501', '%permission denied for schema api%'),
    ('SA', 'SA2 the same for the document',
     'SELECT api.render_invitation_document(' || quote_literal(v_ver_a::text) || '::uuid)',
     '42501', '%permission denied for schema api%'),
    ('SI', 'SI1 and the same at the internal schema, which is the pair of refusals that makes A9 a '
           'measured fact rather than a reading of a GRANT line',
     'SELECT internal_api.list_invitation_outputs(' || quote_literal(v_wed_a::text) || '::uuid)',
     '42501', '%permission denied for schema internal_api%'),
    ('SI', 'SI2 and the same for the document',
     'SELECT internal_api.render_invitation_document(' || quote_literal(v_ver_a::text) || '::uuid)',
     '42501', '%permission denied for schema internal_api%');

  -- A signed-in host reaching sideways, and the two arms that must read exactly the same: this second
  -- host's own wedding has a version, so the refusal is not about there being nothing to find.
  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('CO', 'CO1 a host cannot read another wedding''s manifest',
     'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_a::text) || '::uuid)',
     '42501', '%the caller may not read this wedding%'),
    ('CO', 'CO2 a host cannot render another wedding''s frozen version, which is the arm that matters '
           'most on this surface: a version id is an unguessable-looking handle, and the body is asked to '
           'answer for it anyway',
     'SELECT api.render_invitation_document(' || quote_literal(v_ver_a::text) || '::uuid)',
     '42501', '%the caller may not render this version%');

  v_uuid := gen_random_uuid()::text;
  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('UK', 'UK1 a uuid that is no wedding at all answers the same sentence as another host''s wedding',
     'SELECT api.list_invitation_outputs(' || quote_literal(v_uuid) || '::uuid)',
     '42501', '%the caller may not read this wedding%'),
    ('UK', 'UK2 and the same for a uuid that is no version — the body never says "not yours" and "no '
           'such thing" in different words, so a caller learning ids gains nothing',
     'SELECT api.render_invitation_document(' || quote_literal(v_uuid) || '::uuid)',
     '42501', '%the caller may not render this version%');

  INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
    ('SO', 'SO1 a caller with a role but no account gets the body''s own refusal, not a crash on a NULL '
           'owner comparison: `auth.uid()` answers NULL and the body checks for it first',
     'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_a::text) || '::uuid)',
     '42501', '%the caller may not read this wedding%'),
    ('SO', 'SO2 the same on the document',
     'SELECT api.render_invitation_document(' || quote_literal(v_ver_a::text) || '::uuid)',
     '42501', '%the caller may not render this version%');
END $R0$;

SELECT set_config('test.uid', '', false);

-- The six postures run, one group each: fourteen statements, each of which has to answer with both a
-- SQLSTATE and a sentence, and each of which fails the battery if it answers with nothing.
DO $R1$
BEGIN
  PERFORM pg_temp.s9b_run('AN', 'anon', NULL);
  PERFORM pg_temp.s9b_run('AI', 'anon', NULL);
  PERFORM pg_temp.s9b_run('SA', 'service_role', NULL);
  PERFORM pg_temp.s9b_run('SI', 'service_role', NULL);
  PERFORM pg_temp.s9b_run('CO', 'authenticated', current_setting('s9b.owner_b'));
  PERFORM pg_temp.s9b_run('UK', 'authenticated', current_setting('s9b.owner_a'));
  PERFORM pg_temp.s9b_run('SO', 'authenticated', '');
END $R1$;

-- The four identity claims. These are the cells that turn fourteen refusals into two refusals: a caller
-- who learns nothing from a probe is a caller whose probes all answer the same way.
DO $R2$
DECLARE v_lit_l text; v_lit_r text; v_wed_a text; v_ver_a text; v_a text; v_b text; v_c text; v_d text;
        v_rand uuid;
BEGIN
  v_wed_a := current_setting('s9b.wed_a');
  v_ver_a := current_setting('s9b.ver_a');
  v_rand := gen_random_uuid();
  v_lit_l := '42501 | permission denied for function list_invitation_outputs';
  v_lit_r := '42501 | permission denied for function render_invitation_document';

  PERFORM pg_temp.s9b_eq('R8 an unauthenticated caller hears one refusal whether it names the exposed '
    'wrapper or the internal body: the wrapper adds a name, not a wall, and the message that arrives is '
    'the function ACL speaking before either body runs',
    ARRAY[pg_temp.s9b_try('anon', NULL,
          'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_a) || '::uuid)'),
          pg_temp.s9b_try('anon', NULL,
          'SELECT internal_api.list_invitation_outputs(' || quote_literal(v_wed_a) || '::uuid)')]::text[],
    ARRAY[v_lit_l, v_lit_l]::text[]);

  PERFORM pg_temp.s9b_eq('R9 the same on the document surface',
    ARRAY[pg_temp.s9b_try('anon', NULL,
          'SELECT api.render_invitation_document(' || quote_literal(v_ver_a) || '::uuid)'),
          pg_temp.s9b_try('anon', NULL,
          'SELECT internal_api.render_invitation_document(' || quote_literal(v_ver_a) || '::uuid)')]::text[],
    ARRAY[v_lit_r, v_lit_r]::text[]);

  -- "Not yours", "no such thing" and "not signed in" are one answer, on both surfaces. An existence
  -- oracle over a uuid the caller chose is the failure mode this pair rules out, and it can only be
  -- ruled out by comparing the three bytes rather than by reading the body.
  v_a := pg_temp.s9b_try('authenticated', current_setting('s9b.owner_b'),
        'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_a) || '::uuid)');
  v_b := pg_temp.s9b_try('authenticated', current_setting('s9b.owner_a'),
        'SELECT api.list_invitation_outputs(' || quote_literal(v_rand::text) || '::uuid)');
  v_c := pg_temp.s9b_try('authenticated', '',
        'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_a) || '::uuid)');
  PERFORM pg_temp.s9b_eq('R10 the manifest surface refuses a foreign wedding, a wedding that does not '
    'exist and a caller with no account in one and the same words',
    ARRAY[v_a, v_b, v_c]::text[],
    ARRAY['42501 | the caller may not read this wedding',
          '42501 | the caller may not read this wedding',
          '42501 | the caller may not read this wedding']::text[]);

  v_a := pg_temp.s9b_try('authenticated', current_setting('s9b.owner_b'),
        'SELECT api.render_invitation_document(' || quote_literal(v_ver_a) || '::uuid)');
  v_b := pg_temp.s9b_try('authenticated', current_setting('s9b.owner_a'),
        'SELECT api.render_invitation_document(' || quote_literal(v_rand::text) || '::uuid)');
  v_c := pg_temp.s9b_try('authenticated', '',
        'SELECT api.render_invitation_document(' || quote_literal(v_ver_a) || '::uuid)');
  PERFORM pg_temp.s9b_eq('R11 and the document surface refuses a foreign version, a version that does '
    'not exist and a caller with no account in one and the same words — so a render request cannot be '
    'used to test whether a version id is real',
    ARRAY[v_a, v_b, v_c]::text[],
    ARRAY['42501 | the caller may not render this version',
          '42501 | the caller may not render this version',
          '42501 | the caller may not render this version']::text[]);

  -- The posture this engine allows and the product does not use, stated rather than quietly passed over.
  -- The first two cells of this pair of arms are the interesting ones: `postgres` is not stopped by the
  -- function ACL, so what answers it is the body's own authorization sentence rather than a permission
  -- error — and the body still refuses when the setting names nobody or names the wrong host. The
  -- elevation the SECURITY DEFINER posture grants is the table read, never the permission decision.
  PERFORM pg_temp.s9b_eq('R12 MEASURED, NOT A DOOR: the superuser reaches both bodies past the function '
    'ACL — which is a fact about this harness, because the battery itself runs as that role, and no '
    'client role the API can present is in this set — and is refused by the body''s own words when the '
    'session names no account or names another host''s, and answered only when it names the wedding''s '
    'owner',
    ARRAY[pg_temp.s9b_try('postgres', '',
          'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_a) || '::uuid)'),
          pg_temp.s9b_try('postgres', '',
          'SELECT api.render_invitation_document(' || quote_literal(v_ver_a) || '::uuid)'),
          pg_temp.s9b_try('postgres', current_setting('s9b.owner_b'),
          'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_a) || '::uuid)'),
          pg_temp.s9b_try('postgres', current_setting('s9b.owner_a'),
          'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_a) || '::uuid)'),
          pg_temp.s9b_try('postgres', current_setting('s9b.owner_a'),
          'SELECT api.render_invitation_document(' || quote_literal(v_ver_a) || '::uuid)')]::text[],
    ARRAY['42501 | the caller may not read this wedding',
          '42501 | the caller may not render this version',
          '42501 | the caller may not read this wedding',
          'ACCEPTED', 'ACCEPTED']::text[]);

  -- The consequence of A10, measured as a call rather than as a grant: the internal body answers for a
    -- signed-in host, and answers with the same bytes the wrapper does.
  v_a := pg_temp.s9b_try('authenticated', current_setting('s9b.owner_a'),
        'SELECT internal_api.list_invitation_outputs(' || quote_literal(v_wed_a) || '::uuid)');
  v_b := pg_temp.s9b_try('authenticated', current_setting('s9b.owner_a'),
        'SELECT internal_api.render_invitation_document(' || quote_literal(v_ver_a) || '::uuid)');
  PERFORM pg_temp.s9b_eq('R13 a signed-in host may also reach the two bodies directly, which is the '
    'deviation battery 1 records: the schemas are a naming boundary. Nothing about the answer changes, so '
    'nothing about the authorization was hiding in the wrapper',
    ARRAY[v_a, v_b]::text[], ARRAY['ACCEPTED', 'ACCEPTED']::text[]);

  PERFORM pg_temp.s9b_eq('R14 and the two paths are byte-identical, on both verbs, for the same caller: '
    'the wrapper delegates exactly, which is the claim A7 makes about its source and this cell makes '
    'about its behaviour',
    ARRAY[(SELECT count(*)::text FROM (SELECT 1) z
             WHERE pg_temp.s9b_auth(current_setting('s9b.owner_a'),
                     'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_a) || '::uuid)')
                 = pg_temp.s9b_auth(current_setting('s9b.owner_a'),
                     'SELECT internal_api.list_invitation_outputs(' || quote_literal(v_wed_a) || '::uuid)')),
          (SELECT count(*)::text FROM (SELECT 1) z
             WHERE pg_temp.s9b_auth(current_setting('s9b.owner_a'),
                     'SELECT api.render_invitation_document(' || quote_literal(v_ver_a) || '::uuid)')
                 = pg_temp.s9b_auth(current_setting('s9b.owner_a'),
                     'SELECT internal_api.render_invitation_document(' || quote_literal(v_ver_a) || '::uuid)'))]::text[],
    ARRAY['1', '1']::text[]);
END $R2$;

-- --------------------------------------------------------------------------- D: the manifest as an answer
DO $D$
DECLARE v jsonb; v_txt text; v_keys text[]; v_n bigint; v_first text; v_printed text; v_expected text;
        v_wed_a text; v_wed_none text; v_ver_a text;
BEGIN
  v_wed_a := current_setting('s9b.wed_a');
  v_wed_none := current_setting('s9b.wed_none');
  v_ver_a := current_setting('s9b.ver_a');
  v := pg_temp.s9b_auth(current_setting('s9b.owner_a'),
        'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_a) || '::uuid)');
  v_txt := v::text;
  v_keys := pg_temp.s9b_manifest_keys();

  PERFORM pg_temp.s9b_eq('D1 sixty elements, and every one of them carries exactly the fifteen names '
    'the projection selects — no sixteenth name appears on any row, which is the difference between a '
    'column list and a table dump',
    (SELECT count(*)::text FROM jsonb_array_elements(v) el
      WHERE pg_temp.s9b_top_keys(el) = v_keys),
    '60'::text);

  PERFORM pg_temp.s9b_eq('D2 the five names §7 withholds are absent from every element as a key, not '
    'merely empty: no path, no live-credential target, no wedding the caller already named. The count is '
    'taken over all sixty elements so a single leak cannot hide behind a matching majority',
    (SELECT count(*)::text FROM jsonb_array_elements(v) el
      WHERE jsonb_exists(el, 'object_key') OR jsonb_exists(el, 'target_url_digest')
         OR jsonb_exists(el, 'wedding_id') OR jsonb_exists(el, 'source_dto_digest')
         OR jsonb_exists(el, 'snapshot'))::text,
    '0'::text);

  PERFORM pg_temp.s9b_absent('D3 the answer names no path and no URL: not an artefact prefix, not a '
    'preview prefix, not the render source''s own invitation path, not a scheme, and not one single path '
    'separator anywhere in sixty elements. A client that wants the bytes goes through the Storage API with '
    'the artefact id, which is why the id is in D1''s list and the key is not',
    v_txt, ARRAY['outputs/', 'previews/', '/i/', 'http://', 'https://', '/', '.png', '.pdf', '.webp']);

  PERFORM pg_temp.s9b_absent('D4 no storage object of either bucket appears in the answer, compared by '
    'exact value against all sixty-one names the database actually holds, including the four live '
    'published-preview keys — this is the needle that matters, because a path is what a signature URL is '
    'built from and a preview key is what an unguessable URL is built from',
    v_txt, (SELECT array_agg(name ORDER BY name COLLATE "C") FROM storage.objects));

  PERFORM pg_temp.s9b_absent('D5 and the same comparison restricted to the four closed-bucket '
    'credentials, stated separately so a failure here says which boundary moved',
    v_txt, (SELECT array_agg(name ORDER BY name COLLATE "C") FROM storage.objects
              WHERE bucket_id = 'invitation-previews'));

  -- The honest version of a token search. The shape needle would be wrong in both directions (64-hex
  -- digests contain 43-character windows, and the legitimate reason vocabulary is spelled with the word),
  -- so this cell pins what actually matches.
  PERFORM pg_temp.s9b_eq('D6 the only token-shaped text anywhere in the manifest is the invalidation '
    'reason the design''s own vocabulary contains, on the one row battery 1 retired for it: the word is '
    'here, a credential is not, and an assertion that merely searched for "token" would have called that '
    'a leak',
    ARRAY[(SELECT count(*)::text FROM jsonb_array_elements(v) el
             WHERE el::text ILIKE '%token%'),
          (SELECT coalesce(string_agg(DISTINCT el ->> 'invalidation_reason', ','), '(none)')
             FROM jsonb_array_elements(v) el WHERE el::text ILIKE '%token%')]::text[],
    ARRAY['1', 'token_rotated']::text[]);

  PERFORM pg_temp.s9b_eq('D7 the digests are digests: every element carries a 64-character hex '
    'render_config_hash, and the content_digest is either absent-or-64-hex, so the field the panel '
    'compares is a value a caller could not forge by editing a prefix',
    ARRAY[(SELECT count(*)::text FROM jsonb_array_elements(v) el
             WHERE (el ->> 'render_config_hash') ~ '^[0-9a-f]{64}$'),
          (SELECT count(*)::text FROM jsonb_array_elements(v) el
             WHERE (el ->> 'content_digest') IS NOT NULL
               AND (el ->> 'content_digest') !~ '^[0-9a-f]{64}$'),
          (SELECT count(*)::text FROM jsonb_array_elements(v) el
             WHERE (el ->> 'id') !~ '^[0-9a-f-]{36}$')]::text[],
    ARRAY['60', '0', '0']::text[]);

  -- Nulls are the part of a JSON projection that a careless assertion misses: a key that disappears when
  -- its value is NULL would make "every row has fifteen names" true only for the rows that are complete.
  PERFORM pg_temp.s9b_eq('D8 the four columns that are NULL on some rows are present as keys on all '
    'sixty: a JSON null is a stated absence, not a missing field, so a client can read the manifest '
    'without guessing which names exist per row',
    ARRAY[(SELECT count(*)::text FROM jsonb_array_elements(v) el
             WHERE jsonb_exists(el, 'ready_at')),
          (SELECT count(*)::text FROM jsonb_array_elements(v) el
             WHERE jsonb_exists(el, 'content_digest')),
          (SELECT count(*)::text FROM jsonb_array_elements(v) el
             WHERE jsonb_exists(el, 'last_error')),
          (SELECT count(*)::text FROM jsonb_array_elements(v) el
             WHERE jsonb_exists(el, 'invalidation_reason'))]::text[],
    ARRAY['60', '60', '60', '60']::text[]);

  PERFORM pg_temp.s9b_eq('D9 the answer''s absences are the table''s absences, row by row and column by '
    'column: for each of the four nullable columns an element is NULL exactly when the row behind it is, '
    'so the projection neither invents a value the manifest does not hold nor withholds one it does. '
    'Counted as disagreements with `public.invitation_outputs` rather than as literals, so this cell stays '
    'true if battery 1''s arithmetic moves',
    ARRAY[(SELECT count(*)::text FROM jsonb_array_elements(v) el
             JOIN public.invitation_outputs o ON o.id = (el ->> 'id')::uuid
            WHERE ((el ->> 'ready_at') IS NULL) <> (o.ready_at IS NULL)),
          (SELECT count(*)::text FROM jsonb_array_elements(v) el
             JOIN public.invitation_outputs o ON o.id = (el ->> 'id')::uuid
            WHERE ((el ->> 'content_digest') IS NULL) <> (o.content_digest IS NULL)),
          (SELECT count(*)::text FROM jsonb_array_elements(v) el
             JOIN public.invitation_outputs o ON o.id = (el ->> 'id')::uuid
            WHERE ((el ->> 'last_error') IS NULL) <> (o.last_error IS NULL)),
          (SELECT count(*)::text FROM jsonb_array_elements(v) el
             JOIN public.invitation_outputs o ON o.id = (el ->> 'id')::uuid
            WHERE ((el ->> 'invalidation_reason') IS NULL) <> (o.invalidation_reason IS NULL)),
          -- The join itself has to be total: an element whose row could not be found would silently drop
          -- out of the four counts above and make them all zero for the wrong reason.
          (SELECT count(*)::text FROM jsonb_array_elements(v) el
             LEFT JOIN public.invitation_outputs o ON o.id = (el ->> 'id')::uuid
            WHERE o.id IS NULL)]::text[],
    ARRAY['0', '0', '0', '0', '0']::text[]);

  -- The shape those absences take in this residue, and where the errors come from. Measured at
  -- `q9-logs/s9-ground-14.sql`: `ready_at` and `content_digest` are non-NULL on exactly the 19 ready and
  -- 9 invalidated rows and on no other; `last_error` is on all 7 failed rows and on 1 uploading row — the
  -- artefact battery 1 retried, whose error is retained rather than cleared.
  PERFORM pg_temp.s9b_eq('D9b the nulls line up with the states: the elements with no ready_at and no '
    'content_digest are exactly the rows that have not finished uploading (registered, uploading, failed), '
    'and the elements that carry an error are exactly the rows that do, counted against the table rather '
    'than typed in',
    ARRAY[(SELECT count(*)::text FROM jsonb_array_elements(v) el
             WHERE (el ->> 'ready_at') IS NULL),
          (SELECT count(*)::text FROM jsonb_array_elements(v) el
             WHERE (el ->> 'content_digest') IS NULL),
          (SELECT count(*)::text FROM jsonb_array_elements(v) el
             WHERE (el ->> 'last_error') IS NOT NULL)]::text[],
    ARRAY[(SELECT count(*)::text FROM public.invitation_outputs
             WHERE status IN ('registered', 'uploading', 'failed')),
          (SELECT count(*)::text FROM public.invitation_outputs
             WHERE content_digest IS NULL),
          (SELECT count(*)::text FROM public.invitation_outputs
             WHERE last_error IS NOT NULL)]::text[]);

  PERFORM pg_temp.s9b_eq('D9c the composition of those errors, as relations: every failed row carries '
    'one, no state other than failed and uploading carries one, and the answer names the uploading row '
    'that still shows its last failure — so a panel reading this list can tell "broken" from "broken, and '
    'now trying again" instead of reading the error as a state flag',
    ARRAY[(SELECT count(*)::text FROM public.invitation_outputs
             WHERE status = 'failed' AND last_error IS NULL),
          (SELECT count(*)::text FROM public.invitation_outputs
             WHERE last_error IS NOT NULL
               AND status NOT IN ('failed', 'uploading')),
          (SELECT count(*)::text FROM jsonb_array_elements(v) el
             WHERE (el ->> 'status') = 'uploading'
               AND (el ->> 'last_error') IS NOT NULL)]::text[],
    ARRAY['0', '0',
          (SELECT count(*)::text FROM public.invitation_outputs
             WHERE status = 'uploading' AND last_error IS NOT NULL)]::text[]);

  -- The order the client receives, compared against the order the body declares, over the ids rather than
  -- the serialised timestamps: `created_at` prints as JSON text inside the answer and as Postgres text
  -- outside it, and an ordering claim has to survive that difference to be worth anything.
  v_printed := (SELECT string_agg((el ->> 'id'), ',' ORDER BY ord)
                  FROM jsonb_array_elements(v) WITH ORDINALITY q(el, ord));
  v_expected := (SELECT string_agg(id::text, ',' ORDER BY output_kind, variant, format,
                                           page_number, created_at, id)
                   FROM public.invitation_outputs WHERE wedding_id = v_wed_a::uuid);
  -- Compared as complete sequences, not as prefixes: a truncated equality would pass while the tail of the
  -- list was in a different order, and the tail is where a tie-break lives.
  PERFORM pg_temp.s9b_eq('D10 the elements arrive in the order the body declares — kind, then geometry, '
    'then format, then page, then time, then id — all sixty ids in the answer''s own order, so a panel '
    'that renders the list in the answer''s order is showing the order the SQL was written for rather than '
    'an accident of the heap',
    v_printed, v_expected);

  PERFORM pg_temp.s9b_eq('D11 and the ordering is doing real work rather than replaying insertion '
    'order: the answer''s first element is an og_image at 1200x630, which is not the first artefact '
    'battery 1 created, and the printed sequence differs from the id-sorted one',
    ARRAY[(SELECT ((v -> 0) ->> 'output_kind') || '/' || ((v -> 0) ->> 'variant')
                  || '/' || ((v -> 0) ->> 'format')),
          (SELECT (v_printed <> (SELECT string_agg(id::text, ',' ORDER BY id)
                                   FROM public.invitation_outputs
                                  WHERE wedding_id = v_wed_a::uuid))::text)]::text[],
    ARRAY['og_image/1200x630/png', 'true']::text[]);

  PERFORM pg_temp.s9b_eq('D12 MEASURED LIMITATION of this residue, stated rather than papered over: '
    'page_number is 1 on all sixty rows, because battery 1 mints single-page artefacts. The declared '
    'ORDER BY therefore has no page tie to break here, and D10 is evidence about the other five columns. '
    'A multi-page sweep is the render tier''s job, not this file''s',
    ARRAY[(SELECT coalesce(string_agg(DISTINCT coalesce(page_number::text, '(null)'), ','), '-')
             FROM public.invitation_outputs),
          (SELECT count(*)::text FROM public.invitation_outputs
             WHERE page_number IS DISTINCT FROM 1)]::text[],
    ARRAY['1', '0']::text[]);

  PERFORM pg_temp.s9b_eq('D13 every element names the version the caller asked about and no other: the '
    'manifest is a per-wedding view over that wedding''s frozen documents, and a second version id '
    'appearing here would mean the projection leaked across a pin',
    (SELECT count(*)::text FROM jsonb_array_elements(v) el
      WHERE (el ->> 'version_id') = v_ver_a)::text,
    '60'::text);

  v := pg_temp.s9b_auth(current_setting('s9b.owner_a'),
        'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_none) || '::uuid)');
  PERFORM pg_temp.s9b_eq('D14 the wedding that has never been rendered answers an empty array, not a '
    'refusal and not a NULL: an owner-only surface for a real wedding the caller owns is allowed to have '
    'nothing in it, and a client that treats "no artefacts yet" as an error is a client that will show a '
    'host a failure they never had',
    ARRAY[jsonb_typeof(v), jsonb_array_length(v)::text, v::text]::text[],
    ARRAY['array', '0', '[]']::text[]);
END $D$;

-- --------------------------------------------------------------------------- F: the frozen document
DO $F$
DECLARE v jsonb; v_txt text; v_snap jsonb; v_dto jsonb; v_wed_a text; v_ver_a text;
BEGIN
  v_wed_a := current_setting('s9b.wed_a');
  v_ver_a := current_setting('s9b.ver_a');
  v := pg_temp.s9b_auth(current_setting('s9b.owner_a'),
        'SELECT api.render_invitation_document(' || quote_literal(v_ver_a) || '::uuid)');
  v_txt := v::text;

  PERFORM pg_temp.s9b_has_keys('F1 the render answer is the public document: twelve top-level names, '
    'the same set the guest page is given, and nothing that belongs to the version row or the manifest',
    v, pg_temp.s9b_document_keys());

  SELECT i.snapshot, private.public_invitation_dto(i.snapshot_schema_version, i.snapshot)
    INTO v_snap, v_dto
    FROM public.invitation_versions i WHERE i.id = v_ver_a::uuid;
  PERFORM pg_temp.s9b_eq('F2 the answer is exactly the projection of the pinned row, computed here from '
    'the version''s own snapshot and its own declared schema version: this is what "rendered from a '
    'document that cannot move" means at SQL level',
    (v = v_dto)::text, 'true'::text);

  PERFORM pg_temp.s9b_eq('F3 and it is not the snapshot: the frozen row stores seven names, the answer '
    'returns twelve, and the two are different shapes because one is an archive and the other is the '
    'render contract. A worker that read the snapshot directly would be rendering a schema, not a document',
    ARRAY[jsonb_typeof(v_snap), (v = v_snap)::text,
          (SELECT coalesce(string_agg(x, ',' ORDER BY x COLLATE "C"), '-')
             FROM (SELECT jsonb_object_keys(v_snap) AS x) q)]::text[],
    ARRAY['object', 'false',
          'design_template,draft,events,people,sections,tradition_pack_release,wedding']::text[]);

  PERFORM pg_temp.s9b_eq('F4 the fixture''s own words are in it, chosen by battery 1 rather than typed '
    'here, which is what makes F2 a statement about this wedding''s document rather than about an empty '
    'object that projects to itself',
    ARRAY[v ->> 'title', v ->> 'closing', v ->> 'welcome',
          v #>> '{events,0,display_name}', v #>> '{events,0,venue,name}',
          v #>> '{people,0,display_name}', v #>> '{language,primary}',
          (v #>> '{language,additional}')::text]::text[],
    ARRAY['Asha weds Bala', 'With love', 'With the blessings of our families',
          'Muurtham', 'Kalyana Mantapa', 'Maran', 'en', '["ta"]']::text[]);

  PERFORM pg_temp.s9b_eq('F5 the answer carries no credential, no address of any kind, no household '
    'vocabulary and no guest-routing path, searched case-insensitively over the whole document: the render '
    'source is the guest page''s own data and nothing that identifies or reaches a guest',
    coalesce((SELECT string_agg(x, ',' ORDER BY x COLLATE "C")
                FROM unnest(ARRAY['http', 'https', '@', '/i/', 'token', 'secret', 'credential',
                                  'household', 'salutation', 'guest', 'rsvp', 'attendance',
                                  'access_token', 'password', 'authorization']) x
               WHERE v_txt ILIKE '%' || x || '%'), '(none)'),
    '(none)'::text);

  -- The venue half, read with `jsonb_typeof` rather than `#>>`. `#>>` cannot tell a JSON null from an
  -- absent key — both answer SQL NULL — and this row is exactly the case where the difference matters:
  -- the fixture records no map target, so the projection has to say so with a present null rather than by
  -- dropping the field or inventing a proxy. Measured at `q9-logs/s9-ground-15.sql`.
  PERFORM pg_temp.s9b_eq('F6 the venue object keeps its three names and carries the host''s absence '
    'honestly: map_url is a JSON null *present as a key*, the address is the host''s own text, the zone is '
    'the host''s own zone, and nothing in the document stands in for a map link the host never gave',
    ARRAY[(SELECT coalesce(string_agg(k, ',' ORDER BY k COLLATE "C"), '-')
             FROM jsonb_object_keys(v -> 'events' -> 0 -> 'venue') k),
          jsonb_typeof((v -> 'events' -> 0 -> 'venue' -> 'map_url'))::text,
          (v #>> '{events,0,venue,address_text}'),
          (v #>> '{events,0,timezone}')]::text[],
    ARRAY['address_text,map_url,name', 'null',
          '1 Museum Road, Madurai', 'Asia/Kolkata']::text[]);

  PERFORM pg_temp.s9b_eq('F6b and the event item itself carries six names, including a JSON null for the '
    'end time the fixture does not record — the same rule D8 makes about the manifest, one level deeper: a '
    'stated absence stays a key, so a client never has to work out whether a missing name means "no value" '
    'or "a document from an older schema"',
    ARRAY[(SELECT coalesce(string_agg(k, ',' ORDER BY k COLLATE "C"), '-')
             FROM jsonb_object_keys(v -> 'events' -> 0) k),
          jsonb_typeof((v -> 'events' -> 0 -> 'ends_at_local'))::text,
          (v #>> '{events,0,starts_at_local}'),
          (v #>> '{events,0,display_name}')]::text[],
    ARRAY['display_name,ends_at_local,event_key,starts_at_local,timezone,venue',
          'null', '2026-11-14T07:30:00', 'Muurtham']::text[]);

  PERFORM pg_temp.s9b_eq('F7 the projection normalises the host''s style rather than echoing the row: '
    'the snapshot holds the colour the host typed with capitals in it, the document carries the same '
    'colour lower-cased — which is the mechanism by which two artefacts frozen from one version get byte-'
    'identical input, and the reason F3''s two shapes could not be equal by accident',
    ARRAY[(SELECT (v_snap #>> '{wedding,style_settings,color}')),
          (v #>> '{style,color}'),
          (v #>> '{style,font}'),
          ((v #>> '{style,alignment}') || '/' || (v #>> '{style,fontSize}'))]::text[],
    ARRAY['#C9972F', '#c9972f', 'Playfair Display', 'center/24']::text[]);

  PERFORM pg_temp.s9b_eq('F8 the section list is carried as data, in the order the pack and the host '
    'put it, with the pack''s own heading for the ceremony list: the renderer has a document to lay out, '
    'not a template to fill',
    ARRAY[(SELECT count(*)::text FROM jsonb_array_elements(v -> 'sections' -> 'items') q),
          (SELECT string_agg((q.value ->> 'section_key'), ',' ORDER BY (q.value ->> 'position')::int)
             FROM jsonb_array_elements(v -> 'sections' -> 'items') q(value)),
          (v #>> '{sections,items,3,heading,text}')::text,
          (v #>> '{sections,items,5,body,text}')]::text[],
    ARRAY['6', 'welcome,family_introduction,family,ceremonies,event_notes,closing',
          'The ceremonies', 'With love']::text[]);
END $F$;

-- --------------------------------------------------------------------------- C: frozen, not a keystroke
-- The claim the whole stage rests on, measured as a host typing. The edit is made by the host's own role
-- through the RLS grant Stage 3 wrote on `invitation_drafts` — measured here, not assumed: A10's lesson
-- is that a grant that is not exercised is a claim.
DO $C$
DECLARE v_live jsonb; v_frozen jsonb; v_wed_a text; v_ver_a text; v_try text; v_after jsonb;
        v_frozen_after jsonb; v_snap_before text; v_snap_after text; v_r1 jsonb; v_r2 jsonb;
        v_before text; v_diff text;
BEGIN
  v_wed_a := current_setting('s9b.wed_a');
  v_ver_a := current_setting('s9b.ver_a');
  v_before := current_setting('s9b.draft_before');

  SELECT snapshot::text INTO v_snap_before FROM public.invitation_versions WHERE id = v_ver_a::uuid;

  v_live := pg_temp.s9b_auth(current_setting('s9b.owner_a'),
            'SELECT api.preview_invitation(' || quote_literal(v_wed_a) || '::uuid)');
  v_frozen := pg_temp.s9b_auth(current_setting('s9b.owner_a'),
            'SELECT api.render_invitation_document(' || quote_literal(v_ver_a) || '::uuid)');

  PERFORM pg_temp.s9b_eq('C1 the control, at rest: the live editor preview and the frozen render are '
    'the same document, byte for byte. Without this the comparison below would only prove that one of the '
    'two is broken',
    (v_live = v_frozen)::text, 'true'::text);

  -- The host types. This is the product's own write path for a draft, taken as the account that owns the
  -- wedding.
  v_try := pg_temp.s9b_write('authenticated', current_setting('s9b.owner_a'),
    'UPDATE public.invitation_drafts SET content = '
    || quote_literal((SELECT jsonb_set(v_before::jsonb, '{closing}',
                       '"EDITED AFTER THE FREEZE"'::jsonb))::text) || '::jsonb '
    || 'WHERE wedding_id = ' || quote_literal(v_wed_a) || '::uuid');
  PERFORM pg_temp.s9b_eq('C2 the host''s own role may write its own draft, so the mutation below is a '
    'keystroke and not a superuser reach-around (the grant is Stage 3''s; it is exercised rather than '
    'cited)',
    v_try, 'ACCEPTED'::text);

  v_r1 := pg_temp.s9b_auth(current_setting('s9b.owner_a'),
          'SELECT api.preview_invitation(' || quote_literal(v_wed_a) || '::uuid)');
  v_r2 := pg_temp.s9b_auth(current_setting('s9b.owner_a'),
          'SELECT api.render_invitation_document(' || quote_literal(v_ver_a) || '::uuid)');

  PERFORM pg_temp.s9b_eq('C3 the live preview carries the new words',
    (v_r1 ->> 'closing'), 'EDITED AFTER THE FREEZE'::text);

  PERFORM pg_temp.s9b_eq('C4 the frozen render does not: it is still the word that was in the draft when '
    'the version was cast, which is the difference between a document and a keystroke and the reason a '
    'worker reads this verb instead of the preview',
    (v_r2 ->> 'closing'), 'With love'::text);

  PERFORM pg_temp.s9b_eq('C5 the two answers now differ, so C1 and C4 together are a movement rather '
    'than two copies of the same constant',
    (v_r1 = v_r2)::text, 'false'::text);

  v_diff := (SELECT coalesce(string_agg(k, ',' ORDER BY k COLLATE "C"), '(none)')
               FROM jsonb_object_keys(v_r1) k
              WHERE v_r1 -> k IS DISTINCT FROM v_r2 -> k);
  PERFORM pg_temp.s9b_eq('C6 and exactly which top-level names moved: the host''s closing line and the '
    'section list that projects it. Nothing else about the document changed, so the edit did not perturb '
    'a rendering the host had already frozen',
    v_diff, 'closing,sections'::text);

  SELECT snapshot::text INTO v_snap_after FROM public.invitation_versions WHERE id = v_ver_a::uuid;
  PERFORM pg_temp.s9b_eq('C7 the version row itself is untouched by the host typing beside it: the '
    'frozen snapshot is byte-identical to the one read before the edit, which is the property every '
    'reproducibility claim in this stage is built on',
    v_snap_after, v_snap_before);

  v_try := pg_temp.s9b_write('authenticated', current_setting('s9b.owner_a'),
    'UPDATE public.invitation_drafts SET content = ' || quote_literal(v_before) || '::jsonb '
    || 'WHERE wedding_id = ' || quote_literal(v_wed_a) || '::uuid');
  PERFORM pg_temp.s9b_eq('C8 the draft restored through the same host path',
    v_try, 'ACCEPTED'::text);

  v_after := pg_temp.s9b_auth(current_setting('s9b.owner_a'),
             'SELECT content FROM public.invitation_drafts WHERE wedding_id = '
             || quote_literal(v_wed_a) || '::uuid');
  PERFORM pg_temp.s9b_eq('C9 restored to the bytes X8 captured, not to a re-typed approximation, so Z4 '
    'can leave this file with a fixture it did not modify',
    v_after::text, v_before);

  v_live := pg_temp.s9b_auth(current_setting('s9b.owner_a'),
            'SELECT api.preview_invitation(' || quote_literal(v_wed_a) || '::uuid)');
  PERFORM pg_temp.s9b_eq('C10 and at-rest equality is back, which is what makes C1 a reproducible '
    'measurement rather than a one-off coincidence',
    (v_live = v_frozen)::text, 'true'::text);

  PERFORM pg_temp.s9b_eq('C11 the second wedding''s version still renders its own document after all of '
    'this: the tested wedding''s edit did not reach across the pin, and the two frozen versions are '
    'separate documents rather than two views of one live draft',
    ARRAY[pg_temp.s9b_auth(current_setting('s9b.owner_b'),
            'SELECT api.render_invitation_document('
            || quote_literal(current_setting('s9b.ver_b')) || '::uuid)') ->> 'closing',
          pg_temp.s9b_try('authenticated', current_setting('s9b.owner_b'),
            'SELECT api.render_invitation_document('
            || quote_literal(current_setting('s9b.ver_b')) || '::uuid)')]::text[],
    ARRAY['Nandri', 'ACCEPTED']::text[]);
END $C$;

-- --------------------------------------------------------------------------- V: the shape this build refuses
-- The guard at §7's third branch. No product path can freeze a snapshot this projection cannot read, so
-- the row is planted by the superuser with the columns filled in by hand, used once, and deleted. Every
-- cell below says which of those it is measuring.
DO $V$
DECLARE v_id uuid; v_wed_a text; v_ver_a text; v_owner text; v_try text; v_n0 bigint; v_n1 bigint; v_manifest jsonb;
        v_ok jsonb;
BEGIN
  v_wed_a := current_setting('s9b.wed_a');
  v_ver_a := current_setting('s9b.ver_a');
  v_owner := current_setting('s9b.owner_a');
  SELECT count(*) INTO v_n0 FROM public.invitation_versions;

  BEGIN
    INSERT INTO public.invitation_versions (wedding_id, version_number, snapshot,
                                            snapshot_schema_version, created_by)
    VALUES (v_wed_a::uuid, 999, '{}'::jsonb, 2, v_owner::uuid)
    RETURNING id INTO v_id;
    PERFORM pg_temp.s9b_ok('V1 a version row whose snapshot is legal to the table (the column CHECKs '
      'say nothing about its content) and unintelligible to the projection exists, planted as the '
      'superuser because no host verb will make one',
      v_id IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL V1: the unprojectable version could not be planted (% | %), so §7''s third '
      'refusal arm is not reachable from SQL and this battery''s V group has nothing to measure',
      SQLSTATE, SQLERRM;
  END;

  v_try := pg_temp.s9b_try('authenticated', v_owner,
            'SELECT api.render_invitation_document(' || quote_literal(v_id::text) || '::uuid)');
  PERFORM pg_temp.s9b_eq('V2 the owner of that wedding is refused, with the version''s own words and not '
    'an ownership refusal: the caller may look, this document simply cannot be rendered as it is shaped. '
    'P0001 is the body''s own RAISE, not a privilege code, which is what keeps the two arms distinguishable',
    v_try, 'P0001 | this version cannot be rendered as it is currently shaped'::text);

  PERFORM pg_temp.s9b_ok('V3 the refusal returns no document: the body raises rather than answering '
    'NULL, an empty object or the live draft, so a worker that asked for this version gets a failure it '
    'can record instead of bytes it can stamp with a version id',
    position('{' in v_try) = 0 AND v_try <> 'ACCEPTED');

  v_ok := pg_temp.s9b_auth(v_owner,
          'SELECT api.render_invitation_document(' || quote_literal(v_ver_a) || '::uuid)');
  PERFORM pg_temp.s9b_eq('V4 and the arm is per-version rather than per-wedding: with the unreadable '
    'version sitting on the same wedding, the readable version still renders its twelve-name document',
    ARRAY[jsonb_typeof(v_ok)::text,
          (SELECT count(*)::text FROM jsonb_object_keys(v_ok) q)]::text[],
    ARRAY['object', '12']::text[]);

  v_manifest := pg_temp.s9b_auth(v_owner,
                'SELECT api.list_invitation_outputs(' || quote_literal(v_wed_a) || '::uuid)');
  PERFORM pg_temp.s9b_eq('V5 the manifest is unmoved by the extra version (no artefact references it), '
    'so a version that cannot render is not a hole in the display set',
    jsonb_array_length(v_manifest)::text, '60'::text);

  DELETE FROM public.invitation_versions WHERE id = v_id;
  SELECT count(*) INTO v_n1 FROM public.invitation_versions;
  PERFORM pg_temp.s9b_eq('V6 the planted row is gone and the version count is what X1 found: this '
    'battery leaves the fixture it read, and the arm it measured is the only reason the count had to be '
    'taken twice',
    ARRAY[v_n1::text,
          (SELECT count(*)::text FROM public.invitation_versions
             WHERE snapshot_schema_version IS NULL OR snapshot = '{}'::jsonb)]::text[],
    ARRAY[v_n0::text, '0']::text[]);
END $V$;

-- --------------------------------------------------------------------------- W: the other wedding, and the same answer twice
DO $W$
DECLARE v jsonb; v2 jsonb; v_txt text;
BEGIN
  v := pg_temp.s9b_auth(current_setting('s9b.owner_b'),
        'SELECT api.render_invitation_document('
        || quote_literal(current_setting('s9b.ver_b')) || '::uuid)');
  v_txt := v::text;
  PERFORM pg_temp.s9b_eq('W1 the second host renders their own frozen version and gets their own '
    'document — the Tamil-language wedding, its own title, its own closing line, its own left-aligned '
    'style. Two versions on one engine are two documents, not two renderings of the first',
    ARRAY[v ->> 'title', v ->> 'closing', (v #>> '{language,primary}'),
          (v #>> '{style,font}'), (v #>> '{style,alignment}')]::text[],
    ARRAY['Bala weds Divya', 'Nandri', 'ta', 'Mukta Malar', 'left']::text[]);

  v2 := pg_temp.s9b_auth(current_setting('s9b.owner_a'),
        'SELECT api.render_invitation_document('
        || quote_literal(current_setting('s9b.ver_a')) || '::uuid)');
  PERFORM pg_temp.s9b_eq('W2 and the two documents differ, which is what makes W1 a statement about '
    'the pin rather than about a projection that flattens everything to the same shape',
    (v = v2)::text, 'false'::text);

  PERFORM pg_temp.s9b_eq('W3 the second wedding has no artefact rows, so its manifest is the empty '
    'array while its document renders: the two surfaces are independent, and a host who has frozen a '
    'version has not thereby rendered anything',
    ARRAY[jsonb_array_length(pg_temp.s9b_auth(current_setting('s9b.owner_b'),
            'SELECT api.list_invitation_outputs('
            || quote_literal(current_setting('s9b.wed_b')) || '::uuid)'))::text,
          jsonb_typeof(v)::text]::text[],
    ARRAY['0', 'object']::text[]);

  PERFORM pg_temp.s9b_eq('W4 the same call twice, from the same session and the same caller, answers '
    'byte-identically. This is the SQL-tier half of reproducibility and it is the smallest version of the '
    'claim: a document that moved between two reads would make every artefact digest below it a lie',
    (pg_temp.s9b_auth(current_setting('s9b.owner_a'),
      'SELECT api.render_invitation_document('
      || quote_literal(current_setting('s9b.ver_a')) || '::uuid)') = v2)::text,
    'true'::text);

  PERFORM pg_temp.s9b_eq('W5 the second host sees nothing of the first''s artefacts even though both '
    'weddings are on the same table with the same policy: their own manifest is empty, and the row count '
    'they can read at all is zero, which is RLS answering rather than a filter in the projection',
    ARRAY[(SELECT count(*)::text FROM public.invitation_outputs o
             WHERE o.wedding_id = current_setting('s9b.wed_b')::uuid),
          (SELECT count(*)::text FROM public.invitation_outputs o
             JOIN public.weddings w ON w.id = o.wedding_id
            WHERE w.owner_user_id = current_setting('s9b.owner_b')::uuid)]::text[],
    ARRAY['0', '0']::text[]);
END $W$;

-- --------------------------------------------------------------------------- Z: the census
-- Battery 2 creates no artefact rows, uploads no object, and restores the one draft it edited. What it
-- leaves behind is battery 1's residue and nothing else, and these cells are what make that a fact a
-- reader can check rather than a promise in a comment.
DO $Z$
DECLARE v text;
BEGIN
  PERFORM pg_temp.s9b_eq('Z1 the manifest is the sixty rows and the five states X found, unchanged '
    'after every group above — nothing in this battery wrote, retired or deleted an artefact',
    ARRAY[(SELECT count(*)::text FROM public.invitation_outputs),
          (SELECT coalesce(string_agg(x, ' ' ORDER BY x COLLATE "C"), '-')
             FROM (SELECT status || '=' || count(*)::text AS x
                     FROM public.invitation_outputs GROUP BY status) q)]::text[],
    ARRAY['60', 'failed=7 invalidated=9 ready=19 registered=14 uploading=11']::text[]);

  PERFORM pg_temp.s9b_eq('Z2 the objects, buckets, weddings, accounts and versions are the counts X '
    'cast from: sixty-one objects in three buckets, two versions, three weddings, and the two hosts. '
    'V''s planted row is gone, C''s draft edit is undone, and nothing else moved',
    ARRAY[(SELECT count(*)::text FROM storage.objects),
          (SELECT count(*)::text FROM storage.buckets),
          (SELECT count(*)::text FROM public.invitation_versions),
          (SELECT count(*)::text FROM public.weddings),
          (SELECT count(*)::text FROM auth.users
             WHERE id IN (current_setting('s9b.owner_a')::uuid,
                          current_setting('s9b.owner_b')::uuid))]::text[],
    ARRAY['61', '3', '2', '3', '2']::text[]);

  PERFORM pg_temp.s9b_eq('Z3 the draft this battery edited is byte-identical to the value captured '
    'before the edit, read back rather than assumed from C9',
    (SELECT content::text FROM public.invitation_drafts
      WHERE wedding_id = current_setting('s9b.wed_a')::uuid),
    current_setting('s9b.draft_before'));

  PERFORM pg_temp.s9b_eq('Z4 the probe census for the whole file, declared here and counted there: two '
    'statements in each of seven groups — anon through the wrapper, anon through the body, service_role '
    'through the exposed schema, service_role through the internal schema, one host sideways at the '
    'other''s wedding and version, two uuids that name nothing, and a caller with no account. Fourteen '
    'refusals, each one carrying both a code and a sentence',
    (SELECT coalesce(string_agg(x, ' ' ORDER BY x COLLATE "C"), '-')
       FROM (SELECT grp || '=' || count(*)::text AS x FROM probes GROUP BY grp) q),
    'AI=2 AN=2 CO=2 SA=2 SI=2 SO=2 UK=2'::text);

  PERFORM pg_temp.s9b_ok('Z5 no artefact row is in a state its own evidence contradicts, re-checked '
    'over the residue this file leaves: the same read battery 1 made at its Z6, so a defect introduced by '
    'a Stage 9 *reader* would be caught by a reader rather than only by a writer',
    (SELECT count(*) FROM public.invitation_outputs o
      WHERE (o.status IN ('ready', 'invalidated')) <> (o.content_digest IS NOT NULL)
         OR (o.status IN ('ready', 'invalidated')) <> (o.ready_at IS NOT NULL)
         OR (o.status = 'invalidated') <> (o.invalidated_at IS NOT NULL)
         OR (o.status = 'invalidated') <> (o.invalidation_reason IS NOT NULL)
         OR (o.output_kind = 'qr') <> (o.target_url_digest IS NOT NULL)) = 0);
END $Z$;

-- --------------------------------------------------------------------------- L: the floor
DO $L$
DECLARE ran integer;
BEGIN
  ran := coalesce(nullif(current_setting('s9b.passed', true), ''), '0')::int;
  -- Re-derived from this file's own call sites at this head, and the derivation is a command rather than
  -- a story:
  --   grep -oE "s9b_(ok|eq|absent|has_keys)\('[A-Za-z0-9]+" <this file> | sed "s/.*('//;s/[0-9].*//" | sort | uniq -c
  -- answers 9 X, 11 A, 7 R, 16 D, 9 F, 11 C, 6 V, 5 W and 5 Z = 79 cells, one per label. Requiring a
  -- quoted label is what keeps the two `s9b_eq` calls *inside* the `s9b_has_keys` and `s9b_absent` bodies
  -- out of the count: they carry the caller's label, so they score the caller's cell and never a second
  -- one. The remaining fourteen come from `$R0$`: `s9b_run` adds one assertion per probe row it answers,
  -- and Z4 counts those rows as `AI=2 AN=2 CO=2 SA=2 SI=2 SO=2 UK=2`. 79 + 14 = 93 before this cell, 94 in
  -- the file.
  IF ran <> 93 THEN
    RAISE EXCEPTION 'FAIL: the floor moved — % assertions had run, this file declares 93 before its own '
      'last cell. A skipped group, a deleted cell or an added one all land here, and the number is what '
      'has to be re-derived from the call sites listed above, not guessed', ran;
  END IF;
  PERFORM pg_temp.s9b_ok('L1 the counter reached the floor derived from this file''s call sites ('
    || ran || ' assertions, plus this one)', true);
END $L$;

SELECT 'STAGE9 RENDER FUNCTIONS TESTS PASSED (' || current_setting('s9b.passed') || ')';
