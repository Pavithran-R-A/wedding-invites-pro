-- Stage 9 battery 1: the render manifest as a substrate — what the table refuses underneath every
-- role, how a key is minted, which six lifecycle edges exist, what may be erased, who may write at
-- all, and what the two buckets and their one policy let a caller see.
--
-- Run by `supabase/tests/stage9/run.sh render` after the storage fixture, the published migrations
-- and the whole stage chain through Stage 9, as the superuser, in one transaction that commits.
-- Battery 2 (`90_render_functions.sql`) reads this file's committed residue the way Stage 7's and
-- Stage 8's second batteries read their first ones, and it needs the states named in group V below to
-- still be the states this file left them in.
--
--   F  the fixture's own shape, asserted first: a battery reading an empty schema would print
--      everything below it as a pass
--   T  the declared substrate, read from the catalogue rather than from this file's opinion: the
--      column count, the eight named invariants, the six triggers, the two indexes
--   K  §3 — key minting: what the database writes for each domain, and every arm of what it refuses
--      to be handed
--   C  §2 — the CHECK family, each one reached by the row that violates it, plus the composite key
--      that makes "an artefact of wedding A" impossible
--   E  §4 — the lifecycle, all twenty-five cells of it, measured from a status that was read back
--      before the move was attempted rather than from a status the fixture meant the row to be in
--   I  §4 — the identity arms: ten columns moved from a verified ready row, each refused by the guard
--      itself rather than by an FK or a CHECK underneath it
--   D  §4 — deletion, the same discipline: five explicit cells, each row walked to its state, read
--      back, then deleted, plus the two cells that prove a refusal removed nothing
--   P  §5 — privileges: what a browser role can do to the table (read, and only its own wedding's rows)
--   N  §5 — the same table read by a role with no session at all: `anon` has no SELECT, so this is a
--      privilege refusal rather than the empty set `authenticated` gets
--   R  §5 — row-level security as a row count: the owner sees their own manifest, a second host sees
--      nothing, and a signed-out caller sees nothing
--   W  §5 — the trusted backend's own path: `service_role` may write, and the lifecycle still answers
--   G  §3/§4 — the guard functions: measured on the privilege catalogue, because the schema ACL and the
--      trigger return type between them make an execution probe unable to see the revokes
--   V  the display set battery 2 reads back, deliberately created out of the order it must come back in
--   B  §1/§6 — the two buckets as rows, and the one storage policy as visibility over planted bytes
--   Z  the census this file leaves behind, answered against a ledger rather than against itself
--   L  the floor
--
-- Groups B and V are in this order and not the order the design note lists them, because B plants one
-- `storage.objects` row per manifest row that exists at the moment it runs: planted before V it would
-- leave V's six artefacts without objects, and group Z would then have to compare an object count
-- against a row count that is deliberately one generation older. Planting after V makes the two census
-- lines in Z4 statements about the same set of rows.
--
-- Nothing below pins an auto-generated constraint or index name. §2 declares eight CHECKs and two
-- triggers' worth of invariants *by name* and those are asserted by name; the column-level CHECKs, the
-- primary key, the `object_key` unique, the composite FK and the six-column unique are named by
-- Postgres, which truncates at 63 characters — `invitation_outputs_version_id_output_kind_variant_…`
-- is over that limit, so a literal here would be a guess about a spelling that changes with the
-- server version. Those five are asserted instead by (a) the *shape* of the constraint set, counted by
-- `contype` in T6, and (b) the index column lists read from `pg_index` in T5, and (c) the violation
-- sentence in group C, which names the constraint inside the message where one exists.
--
-- Two deviations between this head and the design note, recorded here because the battery asserts the
-- head, not the note:
--   1. A supplied key that is empty or only whitespace is **accepted and then minted over**, not
--      refused: §3's first arm is `IF NEW.object_key IS NOT NULL AND btrim(NEW.object_key) <> ''`, so a
--      value that btrims to nothing never reaches the refusal and the mint simply writes its own key
--      into the column. K7 and K8 are written as acceptance cells for exactly that reason — a cell
--      expecting a refusal there would be asserting a rule the migration does not contain, and the
--      draft of this file that did expect one was measuring a `23514` that can only arrive after a key
--      has already been minted, i.e. never. A supplied key with content in it is still refused, and K9
--      measures that.
--   2. `authenticated` has USAGE on `internal_api` and EXECUTE on both Stage 9 bodies, so the `api`
--      wrapper is a naming and transport boundary, not a privilege boundary; battery 2 measures the two
--      postures separately and neither claims that the wrapper is what stops a caller.
--
-- Why group G is not an execution probe, measured at this head rather than reasoned about. Calling
-- `private.mint_invitation_output_key()` with `SELECT` as the superuser answers
-- `0A000 trigger functions can only be called as triggers` — plpgsql refuses the call shape before any
-- privilege is consulted, so the cell would answer the same way whether or not the `REVOKE ALL` lines
-- in §3 and §4 were ever deleted. Called as `anon`, the same statement answers
-- `42501 permission denied for schema private`: the schema ACL, which admits `service_role` alone,
-- refuses before the function ACL is reached — so that spelling is also blind to the revokes. G
-- measures the privilege catalogue instead, and its first cell asserts that all three names were found,
-- so the rest is a census of named objects rather than a pass over an empty set. Its last two cells
-- print the schema refusal as a result, which is what makes the reasoning above re-derivable instead of
-- a claim in a comment. Stage 6 reached the same conclusion for its own three guard functions.
--
-- Where a refusal is measured it is measured twice: the SQLSTATE and the sentence. A bare SQLSTATE is
-- not evidence — `left(...,5)` cannot tell a 42601 from a 42501, and this repository has already
-- scored a psql syntax error as a security refusal. Every lifecycle cell below prints the phrase the
-- product chose, and a cell that returns no error at all is a failure rather than a refusal that never
-- happened. An empty probe group is likewise a failure, not a skip.
--
-- Why the lifecycle cells walk a row instead of asserting an UPDATE's text. The first draft of this
-- evidence labelled its delete probes by the state its rows were *meant* to be in, and the SQL showed
-- they were not: one of them deleted every `published_preview` row and another deleted by a config
-- hash, so neither name described a status anybody had read back — and its "delete a ready row was
-- allowed" therefore proved nothing about a ready row, while §4's own comment says the opposite is
-- the point. So `s9f_walk` moves a fresh row through accepted edges only, `s9f_status` reads the
-- result, and a cell whose setup did not reach its `from` state is reported as unmeasurable rather
-- than silently scored.
--
-- The role discipline is the point, not decoration. Every write in groups K, C, E, D and V is issued
-- as `postgres`, because §5 gives no client role INSERT, UPDATE or DELETE on this table at all — a
-- browser cannot reach the guard, which is exactly what group P measures separately. The trusted
-- backend's own path (`service_role`) is measured in P, not used as a fixture convenience. Values a
-- probe needs while it holds a role are carried in `s9f.*` settings rather than read from `pg_temp`,
-- for the reason `stage3/30_publication.sql` records: an impersonated role cannot see this file's
-- temp fixture.
--
-- Three things this battery does not claim:
--   1. It is not the render tier. No image, PDF or QR payload exists here; the manifest's *rows about*
--      artefacts are what is under test, and whether the bytes a `ready` row claims match the artefact
--      that was uploaded is a question the render tier answers.
--   2. It is not the HTTP tier. There is no PostgREST, Kong or Storage API here, so nothing below
--      proves what status code a signed URL download gets or which schemas PostgREST will name; the
--      `storage.objects` rows group B plants are planted in SQL because this engine has the storage
--      *schema* (Stage 6's fixture) and not the storage *service*.
--   3. Group B's visibility counts are measured against the storage read policy as written, which is
--      the only policy Stage 9 adds. `invitation-previews` is asserted to have none, which is §1's
--      published-preview consent decision standing unresolved in the schema — a fact this battery
--      records, not a defect it hides.

SET client_min_messages = notice;
SELECT set_config('s9f.passed', '0', false);

CREATE FUNCTION pg_temp.s9f_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s9f.passed',
    (coalesce(nullif(current_setting('s9f.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s9f_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s9f_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s9f_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s9f_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s9f_sorted(want text[]) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM unnest(coalesce(want, '{}'::text[])) u(k) $fn$;

CREATE FUNCTION pg_temp.s9f_top_keys(v jsonb) RETURNS text[]
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(array_agg(k ORDER BY k COLLATE "C"), '{}'::text[])
    FROM jsonb_object_keys(v) u(k) $fn$;

CREATE FUNCTION pg_temp.s9f_has_keys(label text, v jsonb, want text[]) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'FAIL % — value is % , not an object', label, jsonb_typeof(v);
  END IF;
  PERFORM pg_temp.s9f_eq(label, pg_temp.s9f_top_keys(v), pg_temp.s9f_sorted(want));
END $fn$;

-- How many rows a caller can actually see, measured as that caller. A refusal inside the read is
-- returned as -1 so the caller has to name it: group P asserts the refusal by sentence through
-- `run()`, and uses this only where an acceptance is expected.
CREATE FUNCTION pg_temp.s9f_visible(role text, uid uuid, select_sql text) RETURNS bigint
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

CREATE FUNCTION pg_temp.s9f_err(stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE stmt;
  RETURN 'no-error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $fn$;

CREATE FUNCTION pg_temp.s9f_run(p_grp text, p_role text, p_uid text) RETURNS void
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
            FROM probes p WHERE p.grp = s9f_run.p_grp ORDER BY p.label) s;

  IF v_labels IS NULL THEN
    RAISE EXCEPTION 'FAIL: probe group % ran no probes — an empty group is a skip, not a pass', p_grp;
  END IF;

  FOR i IN 1 .. cardinality(v_labels) LOOP
    EXECUTE 'SET ROLE ' || p_role;
    IF p_uid IS NOT NULL THEN
      PERFORM set_config('test.uid', p_uid, false);
    END IF;
    v := pg_temp.s9f_err(v_stmts[i]);
    EXECUTE 'RESET ROLE';

    IF v = 'no-error' THEN
      RAISE EXCEPTION 'FAIL %: "%" was allowed through', p_grp, v_labels[i];
    END IF;
    IF split_part(v, ' ', 1) <> v_states[i] OR v NOT LIKE v_likes[i] THEN
      RAISE EXCEPTION 'FAIL %: "%" got [%] want [% / %]',
        p_grp, v_labels[i], v, v_states[i], v_likes[i];
    END IF;
    RAISE NOTICE 'PASS %: %', p_grp, v_labels[i];
    PERFORM pg_temp.s9f_add(1);
  END LOOP;
END $fn$;

-- A host verb called by the account that owns the wedding, with the answer handed back. A refusal
-- inside this helper is a failure of the battery, not a measured answer.
CREATE FUNCTION pg_temp.s9f_auth(uid text, stmt text) RETURNS jsonb
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

-- --------------------------------------------------------------------------- the two Stage 9 helpers
-- A 64-hex discriminator. `render_config_hash` is part of the uniqueness key, so every cell that
-- wants its own row asks for its own hash rather than reusing one and colliding with 23505.
CREATE FUNCTION pg_temp.s9f_hash(tag text) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT md5(tag) || md5('s9:' || tag) $fn$;

-- The ledger. Every row this file creates is registered here, and every row it legitimately deletes is
-- unregistered, so group Z can ask two questions that a total cannot answer: is there a manifest row
-- this file did not create, and is there a ledger entry whose row is gone? A census that compares a
-- count to the same count in another spelling proves nothing, which is the defect this replaces.
CREATE TEMP TABLE s9led (
  id  uuid PRIMARY KEY,
  tag text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.s9f_led(p_id uuid, p_tag text) RETURNS void
LANGUAGE sql AS $fn$
  INSERT INTO s9led (id, tag) VALUES (p_id, p_tag) $fn$;

CREATE FUNCTION pg_temp.s9f_unled(p_id uuid) RETURNS void
LANGUAGE sql AS $fn$
  DELETE FROM s9led WHERE id = p_id $fn$;

-- One registered row, minted the only way a row can be minted: no key supplied. Returns the id so a
-- later cell can move it, and takes the geometry so a cell that needs a QR (which must carry a target
-- digest) can have one. Every row lives on the tested wedding and the tested version — the cross-wedding
-- and cross-version refusals are written out by hand in group C, because a helper that could aim at
-- another wedding would be a helper that quietly creates one.
CREATE FUNCTION pg_temp.s9f_row(tag text, p_kind text DEFAULT 'share_image',
                                p_variant text DEFAULT '1080x1620', p_fmt text DEFAULT 'png',
                                p_domain text DEFAULT 'host_private', p_target text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
                                         render_config_hash, source_dto_digest, target_url_digest,
                                         storage_domain)
    SELECT (SELECT current_setting('s9f.wed_a')::uuid),
           (SELECT current_setting('s9f.ver_a')::uuid), p_kind, p_variant, p_fmt,
           pg_temp.s9f_hash(tag), repeat('0', 64), p_target, p_domain
  RETURNING id INTO v_id;
  PERFORM pg_temp.s9f_led(v_id, tag);
  RETURN v_id;
END $fn$;

-- The status a row actually holds, as one name. Every lifecycle and delete cell reads it before it
-- acts, which is the whole difference between this file and the draft it replaces.
CREATE FUNCTION pg_temp.s9f_status(p_id uuid) RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT status FROM public.invitation_outputs WHERE id = p_id $fn$;

-- Walk a row to a status using only edges §4 accepts. The path is written out per target rather than
-- looped, because a generic walk would take a `failed` row through `ready` — and `ready → failed` is
-- one of the edges being measured, so a setup that used it would hide its own refusal.
CREATE FUNCTION pg_temp.s9f_walk(p_id uuid, p_to text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_now text; v_step text;
BEGIN
  SELECT status INTO v_now FROM public.invitation_outputs WHERE id = p_id;
  IF v_now IS NULL THEN RETURN '(row is gone)'; END IF;
  FOREACH v_step IN ARRAY CASE p_to
      WHEN 'registered'  THEN ARRAY[]::text[]
      WHEN 'uploading'   THEN ARRAY['uploading']
      WHEN 'ready'       THEN ARRAY['uploading', 'ready']
      WHEN 'failed'      THEN ARRAY['uploading', 'failed']
      WHEN 'invalidated' THEN ARRAY['uploading', 'ready', 'invalidated']
      ELSE NULL
    END LOOP
    IF v_step = 'uploading' THEN
      UPDATE public.invitation_outputs SET status = 'uploading' WHERE id = p_id;
    ELSIF v_step = 'ready' THEN
      UPDATE public.invitation_outputs SET status = 'ready', content_digest = repeat('d', 64)
        WHERE id = p_id;
    ELSIF v_step = 'failed' THEN
      UPDATE public.invitation_outputs SET status = 'failed', attempt_count = attempt_count + 1,
             last_error = 'the renderer said no' WHERE id = p_id;
    ELSIF v_step = 'invalidated' THEN
      UPDATE public.invitation_outputs SET status = 'invalidated',
             invalidation_reason = 'superseded' WHERE id = p_id;
    END IF;
  END LOOP;
  RETURN pg_temp.s9f_status(p_id);
END $fn$;

-- One cell of the lifecycle matrix. `want_state = 'ACCEPT'` means the edge is supposed to exist, and
-- then the row has to *be* in the new state — an accepted statement that wrote nothing is a pass for
-- the wrong reason. Anything else is compared as SQLSTATE plus the sentence, like `run()`.
CREATE FUNCTION pg_temp.s9f_edge(label text, p_from text, p_to text,
                                 want_state text, want_like text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid; v_state text; v_after text; v_err text;
BEGIN
  v_id := pg_temp.s9f_row('edge:' || p_from || '>' || p_to || ':' || label);
  v_state := pg_temp.s9f_walk(v_id, p_from);
  IF v_state <> p_from THEN
    RAISE EXCEPTION 'FAIL %: setup only reached [%], so % -> % is not measurable here',
      label, v_state, p_from, p_to;
  END IF;

  BEGIN
    UPDATE public.invitation_outputs
       SET status = p_to,
           content_digest = CASE WHEN p_to = 'ready' THEN repeat('d', 64) ELSE content_digest END,
           attempt_count = CASE WHEN p_to = 'failed' THEN attempt_count + 1 ELSE attempt_count END,
           last_error = CASE WHEN p_to = 'failed' THEN 'the renderer said no' ELSE last_error END,
           invalidation_reason = CASE WHEN p_to = 'invalidated' THEN 'superseded'
                                      ELSE invalidation_reason END
     WHERE id = v_id;
    v_after := pg_temp.s9f_status(v_id);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE || ' ' || SQLERRM;
  END;

  IF want_state = 'ACCEPT' THEN
    IF v_err IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL %: the edge % -> % was refused with [%]', label, p_from, p_to, v_err;
    END IF;
    IF v_after IS DISTINCT FROM p_to THEN
      RAISE EXCEPTION 'FAIL %: accepted, but the row reads [%] instead of [%]', label, v_after, p_to;
    END IF;
    RAISE NOTICE 'PASS %', label;
    PERFORM pg_temp.s9f_add(1);
    RETURN;
  END IF;

  IF v_err IS NULL THEN
    RAISE EXCEPTION 'FAIL %: the edge % -> % was allowed through', label, p_from, p_to;
  END IF;
  IF split_part(v_err, ' ', 1) <> want_state OR v_err NOT LIKE want_like THEN
    RAISE EXCEPTION 'FAIL %: got [%] want [% / %]', label, v_err, want_state, want_like;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s9f_add(1);
END $fn$;

-- The same cell for a statement the caller writes out, for the arms that are not a plain status move:
-- becoming `ready` with no digest, entering `failed` with two attempts, or no status change at all.
CREATE FUNCTION pg_temp.s9f_stmt(label text, p_at text, stmt text,
                                 want_state text, want_like text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid; v_state text; v_err text;
BEGIN
  v_id := pg_temp.s9f_row('stmt:' || label);
  v_state := pg_temp.s9f_walk(v_id, p_at);
  IF v_state <> p_at THEN
    RAISE EXCEPTION 'FAIL %: setup only reached [%]', label, v_state;
  END IF;
  BEGIN
    EXECUTE replace(stmt, ':id', quote_literal(v_id::text));
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE || ' ' || SQLERRM;
  END;

  IF want_state = 'ACCEPT' THEN
    IF v_err IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL %: refused with [%]', label, v_err;
    END IF;
    RAISE NOTICE 'PASS %', label;
    PERFORM pg_temp.s9f_add(1);
    RETURN;
  END IF;
  IF v_err IS NULL THEN
    RAISE EXCEPTION 'FAIL %: was allowed through', label;
  END IF;
  IF split_part(v_err, ' ', 1) <> want_state OR v_err NOT LIKE want_like THEN
    RAISE EXCEPTION 'FAIL %: got [%] want [% / %]', label, v_err, want_state, want_like;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s9f_add(1);
END $fn$;

-- One deletion cell, written so that each call owns its own error variable. The first draft of this
-- group looped five states through one `v_err`, and because an accepted deletion assigns nothing the
-- variable kept the previous refusal — so the loop failed at the first accepted deletion after any
-- refusal, and would have failed at any later one. Five explicit calls, each with a fresh local, are
-- the same measurement without the shared memory. The ledger is the second half: an accepted deletion
-- has to take the row *and* its ledger entry, and a refusal has to leave both, so group Z can tell a
-- row this file deleted from a row that vanished on its own.
CREATE FUNCTION pg_temp.s9f_del(label text, p_state text,
                                want_state text, want_like text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid; v_err text; v_rows integer; v_led integer;
BEGIN
  v_id := pg_temp.s9f_row('del:' || p_state || ':' || label);
  IF pg_temp.s9f_walk(v_id, p_state) <> p_state THEN
    RAISE EXCEPTION 'FAIL %: setup only reached [%], so a % row is not measurable here',
      label, pg_temp.s9f_status(v_id), p_state;
  END IF;

  BEGIN
    DELETE FROM public.invitation_outputs WHERE id = v_id;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE || ' ' || SQLERRM;
  END;

  SELECT count(*) INTO v_rows FROM public.invitation_outputs WHERE id = v_id;
  SELECT count(*) INTO v_led  FROM s9led WHERE id = v_id;

  IF want_state = 'ACCEPT' THEN
    IF v_err IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL %: the % row was refused with [%]', label, p_state, v_err;
    END IF;
    -- The row must be gone. The ledger is *this file's* bookkeeping, so it still holds the tag at the
    -- moment the DELETE returns — reading it as 0 here would measure the helper rather than the schema.
    -- What is measured instead is the step the helper has to take next: after the un-ledge, the two
    -- sides have to agree again, because a deletion that left a ledger entry behind would make group
    -- Z's "a ledger entry whose row is gone" signal fire for a deletion the schema itself allowed.
    IF v_rows <> 0 THEN
      RAISE EXCEPTION 'FAIL %: accepted, but the row still reads %', label, v_rows;
    END IF;
    PERFORM pg_temp.s9f_unled(v_id);
    IF (SELECT count(*) FROM s9led WHERE id = v_id) <> 0 THEN
      RAISE EXCEPTION 'FAIL %: the deletion was legal, but the ledger still claims a row that is gone',
        label;
    END IF;
    RAISE NOTICE 'PASS %', label;
    PERFORM pg_temp.s9f_add(1);
    RETURN;
  END IF;

  IF v_err IS NULL THEN
    RAISE EXCEPTION 'FAIL %: the % row was deleted', label, p_state;
  END IF;
  IF split_part(v_err, ' ', 1) <> want_state OR v_err NOT LIKE want_like THEN
    RAISE EXCEPTION 'FAIL %: got [%] want [% / %]', label, v_err, want_state, want_like;
  END IF;
  IF v_rows <> 1 OR v_led <> 1 THEN
    RAISE EXCEPTION 'FAIL %: refused, but the row reads % and the ledger %', label, v_rows, v_led;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s9f_add(1);
END $fn$;

-- --------------------------------------------------------------------------- the cast
CREATE TEMP TABLE s9r ON COMMIT DROP AS
SELECT gen_random_uuid() AS owner_a, gen_random_uuid() AS owner_b,
       gen_random_uuid() AS wed_a, gen_random_uuid() AS wed_b,
       gen_random_uuid() AS wed_none;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT s.owner_a, 's9-owner-a@stage9qual.test', '{}'::jsonb FROM s9r s
UNION ALL SELECT s.owner_b, 's9-owner-b@stage9qual.test', '{}'::jsonb FROM s9r s;

INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages,
                             style_settings)
SELECT s.wed_a, s.owner_a, 'Asha weds Bala', 'en', ARRAY['ta'],
       '{"font":"Playfair Display","fontSize":"24","color":"#C9972F","alignment":"center"}'::jsonb
  FROM s9r s
UNION ALL
SELECT s.wed_b, s.owner_b, 'Bala weds Divya', 'ta', ARRAY[]::text[],
       '{"font":"Mukta Malar","fontSize":"20","color":"#7a1f1f","alignment":"left"}'::jsonb
  FROM s9r s
UNION ALL
SELECT s.wed_none, s.owner_a, 'Nothing Rendered Yet', 'en', ARRAY[]::text[],
       '{"font":"Playfair Display","fontSize":"24","color":"#C9972F","alignment":"center"}'::jsonb
  FROM s9r s;

INSERT INTO public.wedding_people (wedding_id, display_name, role_key, role_label,
                                   group_key, group_label, display_order)
SELECT s.wed_a, 'Maran', 'father', 'Father', 'bride-side', 'The families of', 0 FROM s9r s
UNION ALL
SELECT s.wed_b, 'Sivan', 'father', 'Father', 'groom-side', 'The families of', 0 FROM s9r s;

INSERT INTO public.venues (wedding_id, name, address_text)
SELECT s.wed_a, 'Kalyana Mantapa', '1 Museum Road, Madurai' FROM s9r s
UNION ALL
SELECT s.wed_b, 'Beach Hall', '2 Coast Road, Rameswaram' FROM s9r s;

INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local,
                                   display_order, venue_id)
SELECT s.wed_a, 'muurtham', 'Muurtham', '2026-11-14 07:30', 0, v.id
  FROM s9r s JOIN public.venues v ON v.wedding_id = s.wed_a;

-- The second wedding gets an event too. Not because the manifest needs one — it needs none — but
-- because the version this file freezes for the cross-wedding refusals is built by the product's own
-- snapshot builder, and a snapshot drawn from a wedding with no event at all is a degenerate document
-- that would make C11's refusal about an empty second wedding rather than about the key.
INSERT INTO public.wedding_events (wedding_id, event_key, display_name, starts_at_local,
                                   display_order, venue_id)
SELECT s.wed_b, 'haldi', 'Haldi', '2026-11-13 09:00', 0, v.id
  FROM s9r s JOIN public.venues v ON v.wedding_id = s.wed_b;

INSERT INTO public.guest_households (wedding_id, display_name, salutation)
SELECT s.wed_a, 'The Raman family', 'Dear Raman family' FROM s9r s;

UPDATE public.invitation_drafts d SET content =
  '{"welcome":"With the blessings of our families","family_introduction":"Our families invite you",
    "event_notes":"Lunch follows the ceremony","closing":"With love"}'::jsonb
  FROM s9r s WHERE d.wedding_id = s.wed_a;
UPDATE public.invitation_drafts d SET content =
  '{"welcome":"Second family words","closing":"Nandri"}'::jsonb
  FROM s9r s WHERE d.wedding_id = s.wed_b;

-- Two frozen versions, each by its own owner through the product's own verb, because the artefact and
-- the guest page have to be drawn from a document the product made rather than one this file typed. A
-- DO block rather than a top-level `SELECT set_config(… FROM s9r)`, because `s9f_auth` raises on a
-- refusal and a refusal here is a broken fixture: the block says which wedding failed instead of
-- letting psql abort on an unlabelled exception.
DO $cast$
DECLARE s s9r%ROWTYPE; v jsonb;
BEGIN
  SELECT * INTO s FROM s9r;

  v := pg_temp.s9f_auth(s.owner_a::text,
        'SELECT api.create_invitation_version(' || quote_literal(s.wed_a::text) || '::uuid)');
  IF v IS NULL OR (v ->> 'version_id') IS NULL THEN
    RAISE EXCEPTION 'FAIL cast: the tested wedding''s version was not created (%)', coalesce(v::text, 'NULL');
  END IF;
  PERFORM set_config('s9f.ver_a', v ->> 'version_id', false);

  v := pg_temp.s9f_auth(s.owner_b::text,
        'SELECT api.create_invitation_version(' || quote_literal(s.wed_b::text) || '::uuid)');
  IF v IS NULL OR (v ->> 'version_id') IS NULL THEN
    RAISE EXCEPTION 'FAIL cast: the second wedding''s version was not created (%)', coalesce(v::text, 'NULL');
  END IF;
  PERFORM set_config('s9f.ver_b', v ->> 'version_id', false);
END $cast$;

SELECT set_config('s9f.owner_a', '', false);
SELECT set_config('s9f.owner_b', '', false);
SELECT set_config('s9f.wed_a', '', false);
SELECT set_config('s9f.wed_b', '', false);
SELECT set_config('s9f.wed_none', '', false);

-- --------------------------------------------------------------------------- F: the fixture
DO $F$
DECLARE s s9r%ROWTYPE; v_ver uuid;
BEGIN
  SELECT * INTO s FROM s9r;
  PERFORM set_config('s9f.owner_a', s.owner_a::text, false);
  PERFORM set_config('s9f.owner_b', s.owner_b::text, false);
  PERFORM set_config('s9f.wed_a', s.wed_a::text, false);
  PERFORM set_config('s9f.wed_b', s.wed_b::text, false);
  PERFORM set_config('s9f.wed_none', s.wed_none::text, false);

  PERFORM pg_temp.s9f_eq('F1 two hosts, three weddings, and the third one deliberately without a '
    'frozen version — battery 2 needs an owner-only answer that is an empty array rather than a '
    'refusal, and a fixture where every wedding has been rendered cannot produce one',
    ARRAY[(SELECT count(*)::text FROM auth.users
             WHERE id IN (s.owner_a, s.owner_b)),
          (SELECT count(*)::text FROM public.weddings
             WHERE id IN (s.wed_a, s.wed_b, s.wed_none))]::text[],
    ARRAY['2', '3']::text[]);

  v_ver := current_setting('s9f.ver_a')::uuid;
  PERFORM pg_temp.s9f_ok('F2 the tested wedding has a version frozen by the product path, pinned to '
    'itself and to this wedding (' || v_ver || '), so an artefact can name a document that cannot move',
    v_ver IS NOT NULL
    AND (SELECT count(*) FROM public.invitation_versions v
          WHERE v.id = v_ver AND v.wedding_id = s.wed_a) = 1);

  PERFORM pg_temp.s9f_eq('F3 both weddings have a frozen version and they are different rows — every '
    'cross-wedding cell below is aimed at the second one, so a refusal cannot be an accident of an '
    'id nobody ever made',
    ARRAY[(SELECT count(*)::text FROM public.invitation_versions v
             WHERE v.wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.invitation_versions v
             WHERE v.wedding_id = s.wed_b),
          (SELECT (current_setting('s9f.ver_a') <> current_setting('s9f.ver_b'))::text)]::text[],
    ARRAY['1', '1', 'true']::text[]);

  PERFORM pg_temp.s9f_eq('F4 the manifest starts empty on all three weddings. Nothing above this line '
    'inserted an artefact row, and a battery whose fixture came with rows would be measuring its own '
    'seed rather than the table',
    (SELECT count(*)::text FROM public.invitation_outputs), '0'::text);
END $F$;

-- --------------------------------------------------------------------------- T: the declared substrate
DO $T$
DECLARE v_missing text[];
BEGIN
  PERFORM pg_temp.s9f_eq('T1 the manifest has twenty-one columns and no dropped ones hiding behind '
    'the count — the projection battery 2 asserts is fifteen of these by name, and a sixteenth '
    'arriving quietly would change what the panel can be handed',
    (SELECT count(*)::int FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'invitation_outputs'
        AND a.attnum > 0 AND NOT a.attisdropped), 21::int);

  SELECT array_agg(x ORDER BY x COLLATE "C") INTO v_missing FROM unnest(ARRAY[
    'invitation_outputs_render_shape', 'invitation_outputs_ready_evidence',
    'invitation_outputs_ready_at', 'invitation_outputs_invalidation',
    'invitation_outputs_invalidation_reason', 'invitation_outputs_qr_target',
    'invitation_outputs_domain_shape', 'invitation_outputs_preview_is_og_only']) x
   WHERE NOT EXISTS (SELECT 1 FROM pg_constraint k
                      WHERE k.conrelid = 'public.invitation_outputs'::regclass
                        AND k.contype = 'c' AND k.conname = x);
  PERFORM pg_temp.s9f_eq('T2 all eight named invariants §2 declares are present by name. They are '
    'named because a reader of a failure has to be able to find the sentence in the migration; the '
    'column-level CHECKs are asserted by their own arms in group C and their names are listed in this '
    'file''s evidence capture rather than pinned here',
    coalesce(v_missing, '{}'::text[]), '{}'::text[]);

  PERFORM pg_temp.s9f_eq('T3 six triggers on the table, each one doing a different job: the mint, the '
    'update guard, the delete guard, Stage 2''s two client-write backstops, and the house '
    'updated_at touch. A seventh would mean a rule enforced twice; a missing one would mean §4 is '
    'documentation',
    coalesce((SELECT array_agg(t.tgname::text ORDER BY t.tgname::text COLLATE "C")
                FROM pg_trigger t
               WHERE t.tgrelid = 'public.invitation_outputs'::regclass
                 AND NOT t.tgisinternal), '{}'::text[]),
    ARRAY['invitation_outputs_guard_delete', 'invitation_outputs_guard_update',
          'invitation_outputs_mint_object_key', 'invitation_outputs_no_client_delete',
          'invitation_outputs_no_client_write', 'set_updated_at']::text[]);

  PERFORM pg_temp.s9f_ok('T4 the house updated_at trigger is the shared function, not a private twin. '
    'The migration names it `set_updated_at` for the catalogue''s sake: the inventory decides whether '
    'a column is kept honest by reading the trigger''s name and the function behind it, so a prefixed '
    'clone would leave the column maintained and the inventory blind',
    EXISTS (SELECT 1 FROM pg_trigger t
              JOIN pg_proc p ON p.oid = t.tgfoid
             WHERE t.tgrelid = 'public.invitation_outputs'::regclass
               AND t.tgname = 'set_updated_at'
               AND p.proname = 'touch_updated_at'));

  PERFORM pg_temp.s9f_eq('T5 both declared indexes are there and each leads with the column its reader '
    'asks by, read as ordered column lists from `pg_index` rather than as an index-definition string or '
    'a list of names: the policy predicate reads wedding_id, the panel reads version-led, and the two '
    'auto-generated uniques and the primary key are counted by kind in T6 instead of spelled out here',
    coalesce((SELECT string_agg(ic.relname || '=' ||
                        (SELECT string_agg(a.attname, ',' ORDER BY x.ord)
                           FROM unnest(i.indkey) WITH ORDINALITY x(attnum, ord)
                           JOIN pg_attribute a ON a.attrelid = i.indrelid
                                AND a.attnum = x.attnum),
                        ' ;; ' ORDER BY ic.relname COLLATE "C")
                FROM pg_index i
               JOIN pg_class ic ON ic.oid = i.indexrelid
               WHERE i.indrelid = 'public.invitation_outputs'::regclass
                 AND i.indexrelid IN ('public.invitation_outputs_wedding_version_idx'::regclass,
                                      'public.invitation_outputs_version_idx'::regclass)), '-'),
    'invitation_outputs_version_idx=version_id,output_kind,variant,format,page_number'
    || ' ;; invitation_outputs_wedding_version_idx=wedding_id,version_id');

  PERFORM pg_temp.s9f_eq('T6 the shape of the constraint set, counted by kind: twenty-four CHECKs '
    '(twelve attached to a column, eight named across the table, four more unnamed), two foreign keys, '
    'one primary key, two uniques. This is what replaces pinning the auto-generated names — a thirtieth '
    'CHECK arriving quietly, or the composite FK being dropped in favour of a join, moves this number',
    coalesce((SELECT string_agg(q.k || '=' || q.n, ' ' ORDER BY q.k COLLATE "C")
                FROM (SELECT c.contype::text AS k, count(*)::text AS n
                        FROM pg_constraint c
                       WHERE c.conrelid = 'public.invitation_outputs'::regclass
                       GROUP BY c.contype) q), '-'),
    'c=24 f=2 p=1 u=2'::text);
END $T$;

-- --------------------------------------------------------------------------- K: §3 key minting
-- The four rows the assertions below read are minted first, because the whole point of the mint is that
-- a key is not knowable before the insert — an assertion written against a literal path would be a
-- fixture pretending to be a contract. Every arm of the mint's *acceptance* is a cell in this block and
-- every arm of its *refusal* is a probe, so a change to either half fails one label rather than a group.
SELECT pg_temp.s9f_row('k:plain');
SELECT pg_temp.s9f_row('k:qr', 'qr', '40mm', 'png', 'host_private', repeat('7', 64));
SELECT pg_temp.s9f_row('k:preview', 'og_image', '1200x630', 'png', 'published_preview');
SELECT pg_temp.s9f_row('k:preview2', 'og_image', '1200x630', 'webp', 'published_preview');

DO $K$
DECLARE v_id uuid; v_a text; v_b text; v_p1 text; v_p2 text; v_key text;
BEGIN
  SELECT id, object_key INTO v_id, v_a FROM public.invitation_outputs
   WHERE render_config_hash = pg_temp.s9f_hash('k:plain');
  SELECT object_key INTO v_b FROM public.invitation_outputs
   WHERE render_config_hash = pg_temp.s9f_hash('k:qr');
  SELECT object_key INTO v_p1 FROM public.invitation_outputs
   WHERE render_config_hash = pg_temp.s9f_hash('k:preview');
  SELECT object_key INTO v_p2 FROM public.invitation_outputs
   WHERE render_config_hash = pg_temp.s9f_hash('k:preview2');

  PERFORM pg_temp.s9f_eq('K1 a host_private row that supplies no key gets exactly the four segments and '
    'its own id — rebuilt from the row it names, so a reader can tell a key that was minted from one '
    'that was typed',
    v_a, 'outputs/' || current_setting('s9f.wed_a') || '/share_image/1080x1620/' || v_id::text);

  PERFORM pg_temp.s9f_ok('K2 the kind and geometry inside the key are the row''s own columns, not the '
    'caller''s words: a QR row carries /qr/40mm/ and its key still ends in its id, which is why a PNG '
    'and a WebP of one box cannot collide',
    v_b = 'outputs/' || current_setting('s9f.wed_a') || '/qr/40mm/'
        || (SELECT id::text FROM public.invitation_outputs
             WHERE render_config_hash = pg_temp.s9f_hash('k:qr')));

  PERFORM pg_temp.s9f_ok('K3 a published-preview key is the opaque 43-character shape and contains no '
    'wedding, version or row id — the URL a crawler sees must not be a derivation of anything the '
    'manifest also records',
    v_p1 ~ '^p/[A-Za-z0-9_-]{43}$'
      AND v_p1 NOT LIKE '%' || current_setting('s9f.wed_a') || '%'
      AND v_p1 NOT LIKE '%' || current_setting('s9f.ver_a') || '%'
      AND v_p1 NOT LIKE '%' || v_id::text || '%');

  PERFORM pg_temp.s9f_eq('K4 two preview rows on one version got two different keys. This is the '
    'assertion that the mint is random rather than derived: the shape alone would pass if '
    'gen_random_bytes were replaced by a constant, and then a re-render would be handing out '
    'yesterday''s image from a cache that cannot be invalidated',
    (v_p1 <> v_p2)::text, 'true'::text);

  PERFORM pg_temp.s9f_ok('K5 the two domains differ in their prefix and nothing else is shared between '
    'them: the private half is the one that names the wedding — which is why §7 removes object_key from '
    'the manifest projection rather than filtering it later',
    v_a LIKE 'outputs/%' AND v_p1 LIKE 'p/%' AND v_p1 NOT LIKE 'outputs/%');

  v_id := pg_temp.s9f_row('k:born');
  PERFORM pg_temp.s9f_eq('K6 the row the mint accepted is in the state §3 says a row must be born in, '
    'with no evidence of bytes attached to it',
    ARRAY[pg_temp.s9f_status(v_id),
          (SELECT coalesce(content_digest, '-')::text FROM public.invitation_outputs
             WHERE id = v_id),
          (SELECT coalesce(ready_at::text, '-') FROM public.invitation_outputs WHERE id = v_id),
          (SELECT attempt_count::text FROM public.invitation_outputs WHERE id = v_id)]::text[],
    ARRAY['registered', '-', '-', '0']::text[]);

  -- The two arms a draft of this file had wrong. §3's refusal is guarded by
  -- `btrim(NEW.object_key) <> ''`, so a key that is empty or only whitespace is *not* refused — the mint
  -- overwrites it. Both domains are measured, because the two branches write different shapes and one
  -- cell would let the wrong branch pass the other''s expectation. These are written as explicit
  -- INSERTs rather than through `s9f_row`, which omits the column entirely: the question is what a
  -- supplied blank does.
  INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
                                         render_config_hash, source_dto_digest, storage_domain,
                                         object_key)
    SELECT current_setting('s9f.wed_a')::uuid, current_setting('s9f.ver_a')::uuid,
           'pdf', 'a4', 'pdf', pg_temp.s9f_hash('k:blank'), repeat('0', 64), 'host_private', ''
    RETURNING id, object_key INTO v_id, v_key;
  PERFORM pg_temp.s9f_led(v_id, 'k:blank');
  PERFORM pg_temp.s9f_eq('K7 a supplied empty key is accepted and then minted over, in the private '
    'domain''s own shape — the row is not the caller''s path, and the column cannot stay blank either, '
    'so it is the mint''s else-branch that answers',
    v_key, 'outputs/' || current_setting('s9f.wed_a') || '/pdf/a4/' || v_id::text);

  INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
                                         render_config_hash, source_dto_digest, storage_domain,
                                         object_key)
    SELECT current_setting('s9f.wed_a')::uuid, current_setting('s9f.ver_a')::uuid,
           'og_image', '1200x630', 'png', pg_temp.s9f_hash('k:space'), repeat('0', 64),
           'published_preview', '   '
    RETURNING id, object_key INTO v_id, v_key;
  PERFORM pg_temp.s9f_led(v_id, 'k:space');
  PERFORM pg_temp.s9f_ok('K8 and the same for a whitespace-only key, in the published branch: the blank '
    'the caller supplied is replaced by a fresh 43-character opaque key — not by "p/" plus the trimmed '
    'supplied value, which is what a normalising mint would write',
    v_key ~ '^p/[A-Za-z0-9_-]{43}$' AND v_key NOT IN (v_p1, v_p2) AND v_key <> 'p/');
END $K$;

-- Every arm of the mint's refusal, by role that could reach it. `postgres` is the only one that can
-- get this far at all — §5 gives no client role a write — so these probes measure the trigger, exactly
-- as §3 intends, while group P measures the privilege that keeps a browser away from it.
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('K', 'K9 a supplied key with content in it, in the shape the mint itself would have written',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain, object_key)
        VALUES (current_setting('s9f.wed_a')::uuid, current_setting('s9f.ver_a')::uuid,
                'pdf', 'a4', 'pdf', pg_temp.s9f_hash('k:typed'), repeat('0', 64), 'host_private',
                'outputs/hand-written/path')$q$,
   '42501', '%minted by the database and cannot be supplied%'),
  ('K', 'K10 a traversal-shaped supplied key: the mint never reaches it, because the refusal above '
        'fires first — this cell is here to show the two traversal CHECKs are a second line and not the '
        'only one',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain, object_key)
        VALUES (current_setting('s9f.wed_a')::uuid, current_setting('s9f.ver_a')::uuid,
                'pdf', 'letter', 'pdf', pg_temp.s9f_hash('k:trav'), repeat('0', 64), 'host_private',
                '../../etc/passwd')$q$,
   '42501', '%minted by the database and cannot be supplied%'),
  ('K', 'K11 born uploading',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain, status)
        VALUES (current_setting('s9f.wed_a')::uuid, current_setting('s9f.ver_a')::uuid,
                'pdf', 'a4', 'pdf', pg_temp.s9f_hash('k:up'), repeat('0', 64), 'host_private',
                'uploading')$q$,
   '42501', '%always starts as registered%'),
  ('K', 'K12 born ready, with the digest it never fetched: the state arm fires before the evidence arm',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain, status, content_digest)
        VALUES (current_setting('s9f.wed_a')::uuid, current_setting('s9f.ver_a')::uuid,
                'pdf', 'a4', 'pdf', pg_temp.s9f_hash('k:ready'), repeat('0', 64), 'host_private',
                'ready', repeat('a', 64))$q$,
   '42501', '%always starts as registered%'),
  ('K', 'K13 born carrying a digest',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain, content_digest)
        VALUES (current_setting('s9f.wed_a')::uuid, current_setting('s9f.ver_a')::uuid,
                'pdf', 'a4', 'pdf', pg_temp.s9f_hash('k:dig'), repeat('0', 64), 'host_private',
                repeat('a', 64))$q$,
   '42501', '%cannot carry evidence of bytes it has not produced%'),
  ('K', 'K14 born carrying a ready_at',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain, ready_at)
        VALUES (current_setting('s9f.wed_a')::uuid, current_setting('s9f.ver_a')::uuid,
                'pdf', 'letter', 'pdf', pg_temp.s9f_hash('k:rat'), repeat('0', 64), 'host_private',
                now())$q$,
   '42501', '%cannot carry evidence of bytes it has not produced%'),
  ('K', 'K15 born carrying an invalidated_at',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain, invalidated_at)
        VALUES (current_setting('s9f.wed_a')::uuid, current_setting('s9f.ver_a')::uuid,
                'pdf', 'a4', 'pdf', pg_temp.s9f_hash('k:iat'), repeat('0', 64), 'host_private',
                now())$q$,
   '42501', '%cannot carry evidence of bytes it has not produced%'),
  ('K', 'K16 born with an attempt count',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain, attempt_count)
        VALUES (current_setting('s9f.wed_a')::uuid, current_setting('s9f.ver_a')::uuid,
                'og_image', '1200x630', 'png', pg_temp.s9f_hash('k:att'), repeat('0', 64),
                'host_private', 1)$q$,
   '42501', '%cannot carry evidence of bytes it has not produced%');

SELECT pg_temp.s9f_run('K', 'postgres', NULL);

-- --------------------------------------------------------------------------- C: §2 the CHECK family
-- Each row is the artefact this stage could actually be asked to produce, refused for the reason the
-- schema states. The geometry families, the two domains, the QR's target and the evidence pairs are
-- all here; the two `object_key` traversal CHECKs are deliberately absent, because §3 owns that column
-- and no INSERT can reach them — T2 asserts they are declared, and §3's refusal is what enforces them.
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('C', 'C1 a pdf claiming a share-image box',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'pdf', '1080x1350', 'pdf',
                 pg_temp.s9f_hash('c:c1'), repeat('0', 64), 'host_private')$q$,
   '23514', '%render_shape%'),
  ('C', 'C2 an og image claiming a print size',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'og_image', '40mm', 'png',
                 pg_temp.s9f_hash('c:c2'), repeat('0', 64), 'host_private')$q$,
   '23514', '%render_shape%'),
  ('C', 'C3 a pdf delivered as a png',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'pdf', 'a4', 'png',
                 pg_temp.s9f_hash('c:c3'), repeat('0', 64), 'host_private')$q$,
   '23514', '%render_shape%'),
  ('C', 'C4 a kind the renderer does not offer',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'video', '1080x1620', 'png',
                 pg_temp.s9f_hash('c:c4'), repeat('0', 64), 'host_private')$q$,
   '23514', '%output_kind_check%'),
  ('C', 'C5 a share image parked in the published domain',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'share_image', '1080x1620', 'png',
                 pg_temp.s9f_hash('c:c5'), repeat('0', 64), 'published_preview')$q$,
   '23514', '%preview_is_og_only%'),
  ('C', 'C6 a pdf parked in the published domain',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'pdf', 'a4', 'pdf',
                 pg_temp.s9f_hash('c:c6'), repeat('0', 64), 'published_preview')$q$,
   '23514', '%preview_is_og_only%'),
  ('C', 'C7 a QR with nothing recorded about where it points',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'qr', '40mm', 'png',
                 pg_temp.s9f_hash('c:c7'), repeat('0', 64), 'host_private')$q$,
   '23514', '%qr_target%'),
  ('C', 'C8 a non-QR recording a target',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain, target_url_digest)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'og_image', '1200x630', 'png',
                 pg_temp.s9f_hash('c:c8'), repeat('0', 64), 'host_private',
                 repeat('7', 64))$q$,
   '23514', '%qr_target%'),
  ('C', 'C9 a digest that is not a digest',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'pdf', 'a4', 'pdf',
                 'sha256:short', repeat('0', 64), 'host_private')$q$,
   '23514', '%render_config_hash_check%'),
  ('C', 'C10 a zero-page artefact',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        page_number, render_config_hash, source_dto_digest, storage_domain)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'pdf', 'a4', 'pdf', 0,
                 pg_temp.s9f_hash('c:c10'), repeat('0', 64), 'host_private')$q$,
   '23514', '%page_number_check%'),
  ('C', 'C11 an artefact of this wedding drawn from another wedding''s version — the composite key, '
        'not a join, is what makes it impossible',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_b')::uuid, 'pdf', 'a4', 'pdf',
                 pg_temp.s9f_hash('c:c11'), repeat('0', 64), 'host_private')$q$,
   '23503', '%wedding_id_version_id_fkey%'),
  ('C', 'C12 the same artefact twice: one row per (version, kind, geometry, format, page, config), so '
        'a re-render under a changed config is a new row and a replay is a refusal',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'share_image', '1080x1620', 'png',
                 pg_temp.s9f_hash('k:plain'), repeat('0', 64), 'host_private')$q$,
   '23505', '%variant%'),
  ('C', 'C13 a status word outside the five',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain, status)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'pdf', 'a4', 'pdf',
                 pg_temp.s9f_hash('c:c13'), repeat('0', 64), 'host_private', 'done')$q$,
   '42501', '%always starts as registered%'),
  ('C', 'C14 an invalidation reason on a row that was never retired. On an INSERT this is the *paired* '
        'constraint that fires, not the vocabulary list: a fresh row always starts as registered, so a '
        'non-null reason always contradicts the state before it ever gets to be a word. The word list '
        'itself is measured at E35, on the one edge that can satisfy the pair',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain, invalidation_reason)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'pdf', 'a4', 'pdf',
                 pg_temp.s9f_hash('c:c14'), repeat('0', 64), 'host_private', 'oops')$q$,
   '23514', '%check constraint "invitation_outputs_invalidation_reason"%'),
  ('C', 'C15 a row with no storage domain, which is the same as not knowing who may read it',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain)
        VALUES (current_setting('s9f.wed_a')::uuid,
                   current_setting('s9f.ver_a')::uuid, 'pdf', 'a4', 'pdf',
                 pg_temp.s9f_hash('c:c15'), repeat('0', 64), NULL)$q$,
   '23502', '%storage_domain%');

SELECT pg_temp.s9f_run('C', 'postgres', NULL);

-- --------------------------------------------------------------------------- E: §4 the lifecycle
-- Twenty-five cells, one per (from, to) pair, each on its own fresh row. The five accepted edges are
-- §4's list; the five same-status cells are the "a write that changes no status may change no
-- evidence either" arm, which is where a re-described digest would otherwise enter; the rest are
-- refusals, each named by the sentence the guard chose.
DO $E$
BEGIN
  -- registered
  PERFORM pg_temp.s9f_edge('E1 registered -> registered is a no-op and stays one',
    'registered', 'registered', 'ACCEPT', NULL);
  PERFORM pg_temp.s9f_edge('E2 registered -> uploading: the one way out of birth',
    'registered', 'uploading', 'ACCEPT', NULL);
  PERFORM pg_temp.s9f_edge('E3 registered -> ready: bytes cannot be claimed without the upload',
    'registered', 'ready', '42501', '%no edge%exists in the output lifecycle%');
  PERFORM pg_temp.s9f_edge('E4 registered -> failed',
    'registered', 'failed', '42501', '%no edge%exists in the output lifecycle%');
  PERFORM pg_temp.s9f_edge('E5 registered -> invalidated: nothing was ever there to retire',
    'registered', 'invalidated', '42501', '%no edge%exists in the output lifecycle%');

  -- uploading
  PERFORM pg_temp.s9f_edge('E6 uploading -> registered: an upload cannot be un-started',
    'uploading', 'registered', '42501', '%no edge%exists in the output lifecycle%');
  PERFORM pg_temp.s9f_edge('E7 uploading -> uploading is a no-op and stays one',
    'uploading', 'uploading', 'ACCEPT', NULL);
  PERFORM pg_temp.s9f_edge('E8 uploading -> ready, with the digest the worker fetched',
    'uploading', 'ready', 'ACCEPT', NULL);
  PERFORM pg_temp.s9f_edge('E9 uploading -> failed, with one attempt and its reason',
    'uploading', 'failed', 'ACCEPT', NULL);
  PERFORM pg_temp.s9f_edge('E10 uploading -> invalidated: retire it after it lands or fails',
    'uploading', 'invalidated', '42501', '%no edge%exists in the output lifecycle%');

  -- ready
  PERFORM pg_temp.s9f_edge('E11 ready -> registered: a verified artefact cannot be un-made',
    'ready', 'registered', '42501', '%ready invitation output may only be invalidated%');
  PERFORM pg_temp.s9f_edge('E12 ready -> uploading: the same refusal, from the other direction',
    'ready', 'uploading', '42501', '%ready invitation output may only be invalidated%');
  PERFORM pg_temp.s9f_edge('E13 ready -> ready with its digest standing still is a no-op, and stays one',
    'ready', 'ready', 'ACCEPT', NULL);
  PERFORM pg_temp.s9f_edge('E14 ready -> failed is not a thing that happens to bytes already fetched',
    'ready', 'failed', '42501', '%ready invitation output may only be invalidated%');
  PERFORM pg_temp.s9f_edge('E15 ready -> invalidated: the only exit, and the one the panel prints',
    'ready', 'invalidated', 'ACCEPT', NULL);

  -- failed
  PERFORM pg_temp.s9f_edge('E16 failed -> registered',
    'failed', 'registered', '42501', '%no edge%exists in the output lifecycle%');
  PERFORM pg_temp.s9f_edge('E17 failed -> uploading: the retry the worker is allowed to take',
    'failed', 'uploading', 'ACCEPT', NULL);
  PERFORM pg_temp.s9f_edge('E18 failed -> ready: a retry has to pass through uploading',
    'failed', 'ready', '42501', '%no edge%exists in the output lifecycle%');
  PERFORM pg_temp.s9f_edge('E19 failed -> failed is refused, because this cell moves the attempt count '
    'while the status stands still',
    'failed', 'failed', '42501', '%changes no status may change no evidence either%');
  PERFORM pg_temp.s9f_edge('E20 failed -> invalidated, when the row never earned bytes: removal, not '
    'retirement', 'failed', 'invalidated', '42501',
    '%failed output with no stored bytes is removed rather than invalidated%');

  -- invalidated
  PERFORM pg_temp.s9f_edge('E21 invalidated is terminal in every direction',
    'invalidated', 'registered', '42501', '%invalidated invitation output is terminal%');
  PERFORM pg_temp.s9f_edge('E22 invalidated -> uploading',
    'invalidated', 'uploading', '42501', '%invalidated invitation output is terminal%');
  PERFORM pg_temp.s9f_edge('E23 invalidated -> ready: a retired artefact cannot be re-verified',
    'invalidated', 'ready', '42501', '%invalidated invitation output is terminal%');
  PERFORM pg_temp.s9f_edge('E24 invalidated -> failed',
    'invalidated', 'failed', '42501', '%invalidated invitation output is terminal%');
  PERFORM pg_temp.s9f_edge('E25 invalidated -> invalidated is a no-op, and the retirement keeps its '
    'reason and its clock', 'invalidated', 'invalidated', 'ACCEPT', NULL);
END $E$;

-- The companion arms, which the matrix cannot express because they are not status moves: the evidence
-- that must arrive with a state, the clock the worker may not supply, and the attempt count that may
-- not move on its own. Each one owns its own row: `s9f_stmt` mints and walks a fresh row to the state
-- it names, so no cell inherits another's setup.
DO $E2$
DECLARE v_id uuid;
BEGIN
  PERFORM pg_temp.s9f_stmt('E26 becoming ready with no digest: the refusal and the hint that names '
    'the fetch', 'uploading',
    'UPDATE public.invitation_outputs SET status = ''ready'' WHERE id = :id',
    '42501', '%may not become ready without the digest%');

  PERFORM pg_temp.s9f_stmt('E27 entering failed with two attempts at once: the count and the state '
    'are one piece of evidence', 'uploading',
    'UPDATE public.invitation_outputs SET status = ''failed'', attempt_count = 2, '
    'last_error = $$two at once$$ WHERE id = :id',
    '42501', '%entering failed records exactly one attempt%');

  PERFORM pg_temp.s9f_stmt('E28 entering failed with no reason named', 'uploading',
    'UPDATE public.invitation_outputs SET status = ''failed'', attempt_count = 1 WHERE id = :id',
    '42501', '%a failure must name its reason%');

  -- The two arms §4's `ELSIF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count` can actually reach.
  -- A count moved on a statement that changes no status is refused by the *no-status-change* block,
  -- which returns before the ELSIF is ever consulted, so that arm is measured in E30 and E31 and the
  -- ELSIF is measured here — on a retry that clears the evidence of the attempt before it, and on a
  -- verification that arrives with an inflated count.
  PERFORM pg_temp.s9f_stmt('E29 a retry that resets the attempt count: the evidence of the failed '
    'attempt before it survives the retry', 'failed',
    'UPDATE public.invitation_outputs SET status = ''uploading'', attempt_count = 0 WHERE id = :id',
    '42501', '%attempt_count moves only when a failure is recorded%');

  PERFORM pg_temp.s9f_stmt('E29b a row becoming ready with a count that moved on the way', 'uploading',
    'UPDATE public.invitation_outputs SET status = ''ready'', content_digest = repeat(''d'', 64), '
    'attempt_count = 1 WHERE id = :id',
    '42501', '%attempt_count moves only when a failure is recorded%');

  PERFORM pg_temp.s9f_stmt('E30 a ready row re-describing its digest, with no status change', 'ready',
    'UPDATE public.invitation_outputs SET content_digest = repeat(''e'', 64) WHERE id = :id',
    '42501', '%changes no status may change no evidence either%');

  PERFORM pg_temp.s9f_stmt('E31 an invalidated row moved to a different retirement reason, with no '
    'status change', 'invalidated',
    'UPDATE public.invitation_outputs SET invalidation_reason = ''token_rotated'' WHERE id = :id',
    '42501', '%changes no status may change no evidence either%');

  -- The clock belongs to the database. A worker that supplied its own ready_at could make a superseded
  -- artefact look newer than the row that replaced it, which is the one comparison the staleness
  -- answer depends on — so the value handed in is checked to be the one the database wrote.
  v_id := pg_temp.s9f_row('e32:clock');
  UPDATE public.invitation_outputs SET status = 'uploading' WHERE id = v_id;
  UPDATE public.invitation_outputs SET status = 'ready', content_digest = repeat('d', 64),
         ready_at = '2000-01-01' WHERE id = v_id;
  PERFORM pg_temp.s9f_ok('E32 a ready_at supplied by the writer is overwritten by the database clock',
    (SELECT ready_at > now() - interval '1 hour' FROM public.invitation_outputs WHERE id = v_id));

  UPDATE public.invitation_outputs SET status = 'invalidated',
         invalidation_reason = 'token_rotated', invalidated_at = '2000-01-01' WHERE id = v_id;
  PERFORM pg_temp.s9f_ok('E33 and the same for invalidated_at, because the comparison this row exists '
    'to answer is between two timestamps the database set',
    (SELECT invalidated_at > now() - interval '1 hour' FROM public.invitation_outputs WHERE id = v_id));
  PERFORM pg_temp.s9f_ok('E34 and the ordering CHECK still holds after both were rewritten: a '
    'retirement is never older than the artefact it retires',
    (SELECT invalidated_at >= ready_at FROM public.invitation_outputs WHERE id = v_id));

  -- The word list, on the one edge where it can be reached. `C14` above shows why an INSERT cannot
  -- test it — a fresh row always starts as `registered`, so the paired constraint refuses any non-null
  -- reason before the vocabulary is consulted — while `ready -> invalidated` satisfies the pair and
  -- leaves the four words as the only rule standing. Without this cell the list at line 130 of the
  -- migration would be a comment, not a constraint anyone measured.
  PERFORM pg_temp.s9f_stmt('E35 retiring a ready artefact for a reason the design does not have',
    'ready',
    'UPDATE public.invitation_outputs SET status = ''invalidated'', invalidation_reason = ''oops'' '
    'WHERE id = :id',
    '23514', '%invitation_outputs_invalidation_reason_check%');
END $E2$;

-- Identity: the columns that say what the artefact *is*, each moved from a verified ready row. The
-- guard answers first, which is the point: an FK or a CHECK underneath would refuse some of these for
-- a reason a reader could not tell apart from the rule they are testing.
DO $I$
BEGIN
  PERFORM pg_temp.s9f_stmt('I1 the wedding a row belongs to cannot be moved', 'ready',
    'UPDATE public.invitation_outputs SET wedding_id = (SELECT current_setting(''s9f.wed_b'')::uuid) '
    'WHERE id = :id', '42501', '%cannot be re-parented to another wedding%');
  PERFORM pg_temp.s9f_stmt('I2 the version it was drawn from cannot be moved', 'ready',
    'UPDATE public.invitation_outputs SET version_id = (SELECT current_setting(''s9f.ver_b'')::uuid) '
    'WHERE id = :id', '42501', '%bound to the version it was rendered from%');
  PERFORM pg_temp.s9f_stmt('I3 the kind cannot be moved', 'ready',
    'UPDATE public.invitation_outputs SET output_kind = ''pdf'' WHERE id = :id',
    '42501', '%kind, geometry, format and page are part of the uniqueness key%');
  PERFORM pg_temp.s9f_stmt('I4 the geometry cannot be moved', 'ready',
    'UPDATE public.invitation_outputs SET variant = ''1080x1800'' WHERE id = :id',
    '42501', '%kind, geometry, format and page are part of the uniqueness key%');
  PERFORM pg_temp.s9f_stmt('I5 the page cannot be moved — a re-pagination is a new artefact, not an '
    'edit of this one', 'ready',
    'UPDATE public.invitation_outputs SET page_number = 2 WHERE id = :id',
    '42501', '%kind, geometry, format and page are part of the uniqueness key%');
  PERFORM pg_temp.s9f_stmt('I6 the render config cannot be rewritten to make a stale artefact look '
    'current', 'ready',
    'UPDATE public.invitation_outputs SET render_config_hash = repeat(''9'', 64) WHERE id = :id',
    '42501', '%makes a stale artefact detectable%');
  PERFORM pg_temp.s9f_stmt('I7 the source digest cannot be rewritten', 'ready',
    'UPDATE public.invitation_outputs SET source_dto_digest = repeat(''9'', 64) WHERE id = :id',
    '42501', '%records what was rendered and cannot be rewritten%');
  PERFORM pg_temp.s9f_stmt('I8 a QR''s target cannot be filled in after the sheet was printed', 'ready',
    'UPDATE public.invitation_outputs SET target_url_digest = repeat(''9'', 64) WHERE id = :id',
    '42501', '%cannot be rewritten%');
  PERFORM pg_temp.s9f_stmt('I9 the minted key cannot be moved', 'ready',
    'UPDATE public.invitation_outputs SET object_key = ''outputs/elsewhere'' WHERE id = :id',
    '42501', '%immutable once minted%');
  PERFORM pg_temp.s9f_stmt('I10 a file cannot be switched from private to published', 'ready',
    'UPDATE public.invitation_outputs SET storage_domain = ''published_preview'' WHERE id = :id',
    '42501', '%cannot be moved between the private and published storage domains%');
END $I$;

-- --------------------------------------------------------------------------- D: §4 deletion
-- Five explicit cells, each of which mints its own row, walks it to the state it names, reads the
-- state back, and only then deletes — so the sentence printed for a `ready` row is about a row that was
-- demonstrably ready. The first draft of this evidence looped all five through one `v_err`, and because
-- an accepted deletion assigns nothing the variable kept the previous refusal, so it failed at the first
-- acceptance after any refusal. `s9f_del` owns its error variable per call, and checks the row and the
-- ledger on both sides of the outcome.
DO $D$
BEGIN
  PERFORM pg_temp.s9f_del('D1 a registered row is deletable: nothing was ever produced, so removing the '
    'row removes no evidence', 'registered', 'ACCEPT', NULL);
  PERFORM pg_temp.s9f_del('D2 an uploading row refuses deletion, naming the in-flight upload — erasing '
    'it would leave the object the worker is writing without a registry row to claim it',
    'uploading', '42501', '%upload in flight is not deletable%');
  PERFORM pg_temp.s9f_del('D3 a ready row refuses deletion, saying invalidate first: the manifest is '
    'what tells a host their artefact exists, and a row that vanishes silently is a pointer to '
    'un-collected bytes', 'ready', '42501',
    '%invalidate the output before deleting its manifest row%');
  PERFORM pg_temp.s9f_del('D4 a failed row is deletable — the cleanup path, and the reason §4 keeps '
    'failed as a state rather than an absence until somebody chooses', 'failed', 'ACCEPT', NULL);
  PERFORM pg_temp.s9f_del('D5 an invalidated row is deletable once its object is gone, and it keeps the '
    'digest it was verified at right up to the moment it is removed',
    'invalidated', 'ACCEPT', NULL);
END $D$;

-- The other half of the same decision: the two foreign keys are NO ACTION, and an FK cascade runs as
-- the child table's owner, so no guard trigger could see it. Measured from the parent side, as the
-- superuser, because that is the only identity that can attempt it at all.
DO $D6$
DECLARE v_err text;
BEGIN
  BEGIN
    EXECUTE 'DELETE FROM public.invitation_versions WHERE id = '
         || quote_literal(current_setting('s9f.ver_a')::text);
    RAISE EXCEPTION 'FAIL D6: the version an artefact was drawn from was deleted, so every artefact '
      'of it went with it unremarkably';
  EXCEPTION WHEN FOREIGN_KEY_VIOLATION THEN
    v_err := SQLSTATE || ' ' || SQLERRM;
  END;
  IF v_err IS NULL THEN
    RAISE EXCEPTION 'FAIL D6: the version delete neither succeeded nor was refused by a foreign key';
  END IF;
  PERFORM pg_temp.s9f_eq('D6 deleting the frozen version is refused by the composite key this table '
    'declares, and the message names the manifest''s own constraint — which is the whole argument §2 '
    'gives for NO ACTION over a cascade: an artefact''s history cannot vanish with the aggregate it '
    'belongs to, and the refusal is attributed to the table that holds it',
    left(v_err, 5), '23503'::text);
  PERFORM pg_temp.s9f_ok('D6b the refusal came from `invitation_outputs_wedding_id_version_id_fkey`, '
    'not from any earlier Stage 2 rule on the version itself, so it is this stage''s key doing the '
    'protecting', v_err LIKE '%wedding_id_version_id_fkey%');
END $D6$;

-- --------------------------------------------------------------------------- P/N/R: §5 privileges and RLS
-- The boundary this stage added nothing to: a browser reads its own wedding's manifest and cannot
-- write, and the trusted backend does the writing. Measured per role rather than read off the GRANT
-- lines, because the grant is the claim and the refusal is the evidence.
--
-- Three groups rather than one, because the three answers are three different kinds of thing. `P` is
-- what a host's session may not do to the table at all. `N` is what a caller with no session gets, and
-- that is a privilege refusal rather than the empty set a signed-out *host* gets. `R` counts rows: the
-- policy is what decides whether the one SELECT this stage grants reads your manifest or somebody
-- else's. Splitting them keeps a `run()` call per role, which a single group could not do.
INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('P', 'P1 authenticated inserts a manifest row',
   $q$INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
        render_config_hash, source_dto_digest, storage_domain)
        VALUES (current_setting('s9f.wed_a')::uuid,
                current_setting('s9f.ver_a')::uuid, 'pdf', 'a4', 'pdf',
                pg_temp.s9f_hash('p:p1'), repeat('0', 64), 'host_private')$q$,
   '42501', '%permission denied for table invitation_outputs%'),
  ('P', 'P2 authenticated moves a status',
   $q$UPDATE public.invitation_outputs SET status = 'ready', content_digest = repeat('d', 64)
       WHERE wedding_id = current_setting('s9f.wed_a')::uuid$q$,
   '42501', '%permission denied for table invitation_outputs%'),
  ('P', 'P3 authenticated deletes a row',
   $q$DELETE FROM public.invitation_outputs
       WHERE wedding_id = current_setting('s9f.wed_a')::uuid$q$,
   '42501', '%permission denied for table invitation_outputs%');

SELECT pg_temp.s9f_run('P', 'authenticated', (SELECT owner_a::text FROM s9r));

INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('N', 'N1 anonymous reads the table: the one answer here that is a refusal rather than an empty set, '
        'because §5 grants SELECT to `authenticated` alone and no policy can be reached without the '
        'privilege first',
   $q$SELECT count(*) FROM public.invitation_outputs$q$,
   '42501', '%permission denied for table invitation_outputs%');

SELECT pg_temp.s9f_run('N', 'anon', NULL);

DO $R$
DECLARE s s9r%ROWTYPE; v_owner bigint; v_stranger bigint;
BEGIN
  SELECT * INTO s FROM s9r;

  v_stranger := pg_temp.s9f_visible('authenticated', s.owner_b,
    'SELECT 1 FROM public.invitation_outputs');
  v_owner := pg_temp.s9f_visible('authenticated', s.owner_a,
    'SELECT 1 FROM public.invitation_outputs');
  PERFORM pg_temp.s9f_eq('R1 a second host holding the same SELECT privilege sees no rows at all: the '
    'policy is keyed on their own wedding, and a manifest that leaked would leak every artefact''s '
    'digest and geometry, not one document',
    ARRAY[v_stranger::text, (v_owner > 0)::text]::text[], ARRAY['0', 'true']::text[]);

  PERFORM pg_temp.s9f_eq('R2 signed out, the same privilege answers nothing: auth.uid() is NULL and the '
    'ownership EXISTS cannot hold',
    pg_temp.s9f_visible('authenticated', NULL,
      'SELECT 1 FROM public.invitation_outputs')::text, '0'::text);

  PERFORM pg_temp.s9f_eq('R3 the table is RLS-enabled and its only policy is a SELECT for '
    'authenticated alone — §5 adds one readable surface and no writable one, and C18 is the check that '
    'a policy targeting anything else is a defect',
    ARRAY[
      (SELECT coalesce(bool_and(c.relrowsecurity)::text, 'false') FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'invitation_outputs'),
      (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public'
                                          AND tablename = 'invitation_outputs'),
      -- `pg_policies.roles` is a `name[]`, so the role set is compared as its printed form: `TO
      -- authenticated` reads `authenticated`, `TO PUBLIC` reads `public`, and a two-role target reads
      -- both names in one cell. Same discriminator, one type that has an equality operator.
      (SELECT coalesce(bool_and(p.cmd = 'SELECT'
                                AND array_to_string(p.roles, ',') = 'authenticated')::text, 'false')
         FROM pg_policies p WHERE p.tablename = 'invitation_outputs'
           AND p.policyname = 'owners_read_own_invitation_outputs')]::text[],
    -- A `boolean::text` cast reads `true`/`false`, which is not how psql displays a boolean row (`t`/`f`);
    -- the first and third cells are casts, so that is the spelling the answer has to carry.
    ARRAY['true', '1', 'true']::text[]);

  -- Every value on the right below was read from the catalogue at this head before it was written here,
  -- which is why the cell is a census rather than a restatement of the GRANT line: `service_role` may
  -- write with no grant statement of its own (Stage 2's default-privilege posture) and the table is
  -- owned by neither role the product hands out.
  PERFORM pg_temp.s9f_eq('R4 the privilege catalogue itself: the trusted backend may INSERT, no client '
    'role may, `authenticated` may read, `anon` may not even read, the table is owned by `postgres`, and '
    '`service_role` bypasses row security — the last of those is why §5 writes no write policy, since a '
    'policy the writer never evaluates is a policy that cannot be tested',
    ARRAY[
      (SELECT has_table_privilege('service_role', 'public.invitation_outputs', 'INSERT')::text),
      (SELECT has_table_privilege('authenticated', 'public.invitation_outputs', 'SELECT')::text),
      (SELECT has_table_privilege('authenticated', 'public.invitation_outputs', 'INSERT')::text),
      (SELECT has_table_privilege('anon', 'public.invitation_outputs', 'SELECT')::text),
      (SELECT pg_get_userbyid(c.relowner) FROM pg_class c
        WHERE c.relname = 'invitation_outputs'),
      (SELECT r.rolbypassrls::text FROM pg_roles r WHERE r.rolname = 'service_role')]::text[],
    ARRAY['true', 'true', 'false', 'false', 'postgres', 'true']::text[]);
END $R$;

-- The worker's own path, both halves in one place: §5's claim that the triggers are the whole story for
-- a trusted writer is only true if the trusted writer can write at all, and the write that lands is the
-- one that has to be stopped from skipping a state.
DO $W$
DECLARE v_id uuid; v_err text; v_state text;
BEGIN
  EXECUTE 'SET ROLE service_role';
  BEGIN
    INSERT INTO public.invitation_outputs (wedding_id, version_id, output_kind, variant, format,
                                           render_config_hash, source_dto_digest, storage_domain)
      VALUES (current_setting('s9f.wed_a')::uuid, current_setting('s9f.ver_a')::uuid,
              'og_image', '1200x630', 'webp', pg_temp.s9f_hash('w:worker'), repeat('0', 64),
              'host_private')
      RETURNING id INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE || ' ' || SQLERRM;
  END;
  BEGIN
    UPDATE public.invitation_outputs SET status = 'ready', content_digest = repeat('d', 64)
      WHERE id = v_id;
  EXCEPTION WHEN OTHERS THEN
    v_err := coalesce(v_err || ' ;; ', '') || SQLSTATE || ' ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'FAIL W1: the trusted backend''s own INSERT was refused — [%]', v_err;
  END IF;
  PERFORM pg_temp.s9f_led(v_id, 'w:worker');
  v_state := pg_temp.s9f_status(v_id);

  PERFORM pg_temp.s9f_eq('W1 the worker''s INSERT is accepted and its edge-skipping UPDATE is refused, '
    'so the row is still in the state it was born in: an artefact cannot be marked verified by the one '
    'identity that could do it without asking',
    v_state, 'registered'::text);
  PERFORM pg_temp.s9f_ok('W2 the refusal that stopped it is the lifecycle''s own sentence and not a '
    'privilege sentence — bypassed row security is not a bypassed trigger',
    coalesce(v_err, '') LIKE '%42501 no edge registered%exists in the output lifecycle%');
END $W$;

-- --------------------------------------------------------------------------- G: the guard functions
-- Why this is a catalogue census and not an execution probe — both halves of that sentence measured at
-- this head, not assumed. `SELECT private.mint_invitation_output_key()` issued as the superuser answers
-- `0A000 trigger functions can only be called as triggers`: plpgsql refuses the call shape before any
-- privilege is consulted. The same statement issued as `anon` answers
-- `42501 permission denied for schema private`, because the `private` schema ACL admits `service_role`
-- alone — so the *schema* answers first and the cell would still print 42501 with every per-function
-- REVOKE line in §3 and §4 deleted. Either spelling is a cell that cannot see the thing it claims to
-- test, which is the shape this repository has already been burned by twice. What the revokes actually
-- did is readable in the catalogue, so G reads that, and its first cell asserts that all three names
-- were found — the rest is a census of named objects, not a pass over an empty set. G4 and G5 then
-- measure the schema boundary itself, so the reason the execution probe is uninformative is recorded as
-- a result rather than left as a comment.
DO $G$
DECLARE v_found text; v_acl text; v_exec text; v_auth text;
BEGIN
  v_found := coalesce((SELECT string_agg(p.proname, ',' ORDER BY p.proname COLLATE "C")
                         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'private'
                          AND p.proname IN ('mint_invitation_output_key',
                                            'guard_invitation_output_update',
                                            'guard_invitation_output_delete')), '-');
  PERFORM pg_temp.s9f_eq('G1 all three names §3 and §4 create are present in `private`. Without this, '
    'the ACL and privilege cells below would be an aggregate over a set that could be empty',
    v_found,
    'guard_invitation_output_delete,guard_invitation_output_update,mint_invitation_output_key');

  -- §3 and §4 never GRANT these to anyone, and the Stage 2 baseline removes the implicit EXECUTE to
  -- PUBLIC that Postgres puts on a created function, so the only grantee left is the owner. `proacl` is
  -- printed with `|` between elements and `(null)` for a missing list.
  v_acl := coalesce((SELECT string_agg(p.proname || '=' ||
                                        coalesce(array_to_string(p.proacl, '|'), '(null)'),
                                        ' ' ORDER BY p.proname COLLATE "C")
                       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'private'
                        AND p.proname IN ('mint_invitation_output_key',
                                          'guard_invitation_output_update',
                                          'guard_invitation_output_delete')), '-');
  PERFORM pg_temp.s9f_eq('G2 every one of the three carries exactly one grant, to its own owner, and '
    'nothing else: PUBLIC is absent, so all three client roles are refused by the absence of a grant '
    'rather than by an explicit deny that a later GRANT could overwrite',
    v_acl,
    'guard_invitation_output_delete=postgres=X/postgres'
    || ' guard_invitation_output_update=postgres=X/postgres'
    || ' mint_invitation_output_key=postgres=X/postgres');

  v_exec := coalesce((SELECT string_agg(r.rol || '.' || f.fn || '=' ||
                                          has_function_privilege(r.rol, 'private.' || f.fn || '()',
                                                                 'EXECUTE')::text,
                                          ' ' ORDER BY r.rol COLLATE "C", f.fn COLLATE "C")
                         FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(rol)
                        CROSS JOIN (VALUES ('guard_invitation_output_delete'),
                                           ('guard_invitation_output_update'),
                                           ('mint_invitation_output_key')) f(fn)), '-');
  -- The three-argument form is the only one that works: the two-argument
  -- `has_function_privilege(role, function)` is parsed as a cast and raises `expected a left
  -- parenthesis`, which an earlier draft of this cell scored as a failed expectation instead of as the
  -- API fact it is.
  PERFORM pg_temp.s9f_eq('G3 the nine-way census: no client role, and not the trusted backend either, '
    'holds EXECUTE on any of the three. A trigger needs no EXECUTE from the role that writes the row, so '
    'all nine falses are the design working — and `service_role` is in the list because it is the one '
    'role that bypasses row security, which makes this ACL the only thing standing between it and a '
    'hand-called guard',
    v_exec,
    'anon.guard_invitation_output_delete=false anon.guard_invitation_output_update=false'
    || ' anon.mint_invitation_output_key=false'
    || ' authenticated.guard_invitation_output_delete=false'
    || ' authenticated.guard_invitation_output_update=false'
    || ' authenticated.mint_invitation_output_key=false'
    || ' service_role.guard_invitation_output_delete=false'
    || ' service_role.guard_invitation_output_update=false'
    || ' service_role.mint_invitation_output_key=false');

  -- The one execution probe that is worth printing: it is not evidence about the function ACL (the
  -- schema answers first — that is the finding, and G5 measures the same boundary from `anon`), it is
  -- evidence that the signed-in host whose SELECT on the table group P measures has no route to the
  -- code that decides what that SELECT may say about lifecycle state.
  BEGIN
    EXECUTE 'SET ROLE authenticated';
    BEGIN
      EXECUTE 'SELECT private.guard_invitation_output_update()';
      v_auth := 'no-error';
    EXCEPTION WHEN OTHERS THEN
      v_auth := SQLSTATE || ' ' || SQLERRM;
    END;
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'FAIL G4 could not assume the authenticated role: %', SQLERRM;
  END;
  PERFORM pg_temp.s9f_eq('G4 authenticated''s call does not reach the function: the whole answer, '
    'state and sentence, is the schema boundary',
    v_auth, '42501 permission denied for schema private');
END $G$;

INSERT INTO probes (grp, label, stmt, want_state, want_like) VALUES
  ('G', 'G5 anon is refused by the same boundary and on the minting function too, so the sentence names '
        'a schema and not a privilege — the measurement that says why G2 and G3, not an execution probe, '
        'are the real test of the revokes',
   $q$SELECT private.mint_invitation_output_key()$q$, '42501',
   '%permission denied for schema private%');

SELECT pg_temp.s9f_run('G', 'anon', NULL);

-- --------------------------------------------------------------------------- V: what battery 2 reads back
-- Deliberately created in an order the read must not preserve: `qr` first, then `pdf`, then the two
-- `og_image` formats, then the `share_image` that sorts between them. The documented ORDER BY leads
-- with output_kind, so an answer that comes back in creation order is the failure this catches, and
-- the pdf row is then aged backwards — which a creation-order sort would have put first and a
-- kind-led sort leaves in its place.
DO $V$
DECLARE v_qr uuid; v_pdf uuid; v_og1 uuid; v_og2 uuid; v_share uuid; v_inval uuid;
        v_order text; v_pos text;
BEGIN
  v_qr    := pg_temp.s9f_row('v:qr', 'qr', '40mm', 'png', 'host_private', repeat('7', 64));
  v_pdf   := pg_temp.s9f_row('v:pdf', 'pdf', 'a4', 'pdf');
  v_og1   := pg_temp.s9f_row('v:og-png', 'og_image', '1200x630', 'png');
  v_og2   := pg_temp.s9f_row('v:og-webp', 'og_image', '1200x630', 'webp', 'published_preview');
  v_share := pg_temp.s9f_row('v:share', 'share_image', '1080x1350', 'png');
  v_inval := pg_temp.s9f_row('v:invalidated', 'pdf', 'letter', 'pdf');

  PERFORM pg_temp.s9f_walk(v_qr, 'ready');
  PERFORM pg_temp.s9f_walk(v_og1, 'failed');
  PERFORM pg_temp.s9f_walk(v_share, 'uploading');
  PERFORM pg_temp.s9f_walk(v_inval, 'invalidated');

  -- The pdf row is three hours older than every other row in this set, and it must still come back
  -- third. Without this, an answer sorted by `created_at` would satisfy the same expectation.
  UPDATE public.invitation_outputs SET created_at = now() - interval '3 hours' WHERE id = v_pdf;

  -- The set is scoped by the ledger tag, not by `version_id`: group C, group E and the delete cells all
  -- mint their rows on this same version, so a version-scoped count would have been a census of the
  -- whole file rather than of the six artefacts battery 2 is supposed to read back.
  v_order := coalesce((SELECT string_agg(status || ':' || storage_domain, ' '
                                           ORDER BY output_kind COLLATE "C", variant COLLATE "C",
                                                    format COLLATE "C")
                          FROM public.invitation_outputs o
                          JOIN s9led l ON l.id = o.id
                         WHERE l.tag LIKE 'v:%'), '-');

  PERFORM pg_temp.s9f_eq('V1 six artefacts of one frozen version, in the five states the lifecycle '
    'admits at once — registered, uploading, ready, failed, invalidated — and both storage domains. '
    'Battery 2 reads this set instead of inventing one, so the manifest projection is asserted over '
    'rows whose states this file verified. The order is the product''s own: `output_kind, variant, '
    'format`, which puts the failed png teaser first and the aged pdf third',
    ARRAY[(SELECT count(*)::text FROM public.invitation_outputs o
            JOIN s9led l ON l.id = o.id WHERE l.tag LIKE 'v:%'),
          v_order]::text[],
    ARRAY['6',
          'failed:host_private registered:published_preview registered:host_private '
          || 'invalidated:host_private ready:host_private uploading:host_private']::text[]);

  -- V2 is the reason V1's literal is not a coincidence. `created_at` is the fifth key of the documented
  -- sort, so an implementation that led with it would put the aged pdf first and still pass a count
  -- check. This asks where the aged row actually landed and how many rows are old: one is old, it is the
  -- pdf, and the product's order puts it third.
  PERFORM pg_temp.s9f_eq('V2 the ordering trap is planted and not assumed: exactly one row in this set '
    'predates the others by hours, it is the pdf, and the kind-led order still puts it third — so a '
    'read that sorted by age would print a different string than the one V1 just required',
    ARRAY[(SELECT count(*)::text FROM public.invitation_outputs o
             JOIN s9led l ON l.id = o.id
            WHERE l.tag LIKE 'v:%' AND o.created_at < now() - interval '2 hours'),
          (SELECT (created_at < now() - interval '2 hours')::text FROM public.invitation_outputs
            WHERE id = v_pdf),
          (SELECT q.rn::text
             FROM (SELECT o.id, row_number() OVER (ORDER BY o.output_kind COLLATE "C",
                                                   o.variant COLLATE "C", o.format COLLATE "C") AS rn
                     FROM public.invitation_outputs o JOIN s9led l ON l.id = o.id
                    WHERE l.tag LIKE 'v:%') q
            WHERE q.id = v_pdf)]::text[],
    ARRAY['1', 'true', '3']::text[]);

  PERFORM pg_temp.s9f_ok('V3 the QR row in this set carries its target digest and the preview-domain '
    'row carries its minted opaque key, so battery 2''s needle test has something real to look for and '
    'fail to find',
    (SELECT target_url_digest = repeat('7', 64) FROM public.invitation_outputs WHERE id = v_qr)
    AND (SELECT object_key ~ '^p/[A-Za-z0-9_-]{43}$' FROM public.invitation_outputs WHERE id = v_og2));

  PERFORM pg_temp.s9f_ok('V4 the wedding with no renders is still empty, which is the other half of '
    'battery 2''s manifest test: an owner-only answer that is an array and not a refusal',
    (SELECT count(*) FROM public.invitation_outputs
      WHERE wedding_id = (SELECT current_setting('s9f.wed_none')::uuid)) = 0);
END $V$;

-- --------------------------------------------------------------------------- B: §1/§6 buckets and visibility
DO $B$
DECLARE s s9r%ROWTYPE; v_out bigint; v_prev bigint; v_anon bigint; v_none bigint;
        v_stranger bigint;
BEGIN
  SELECT * INTO s FROM s9r;

  -- `banned_mime_types` is not a column this engine's storage schema has, so the allow-list is the whole
  -- statement: a type that is not in it cannot be uploaded, and there is no second list that could
  -- contradict the first.
  PERFORM pg_temp.s9f_eq('B1 both buckets exist, both are private, and their declared ceilings and '
    'type allow-lists are the migration''s: 10 MiB for a paginated Indic PDF with embedded faces, '
    '1 MiB for a teaser, and no SVG and no HTML in either list, because the blueprint forbids rendering '
    'host-authored markup and refusing the type at the bucket is stronger than sanitising it later',
    coalesce((SELECT string_agg(id || '|' || public::text || '|'
                                  || coalesce(file_size_limit::text, '-') || '|'
                                  || coalesce(array_to_string(allowed_mime_types, '+'), '-'),
                                  ' ;; '
                       ORDER BY id COLLATE "C")
               FROM storage.buckets
              WHERE id IN ('invitation-outputs', 'invitation-previews')), '-'),
    'invitation-outputs|false|10485760|image/png+image/webp+application/pdf'
    || ' ;; invitation-previews|false|1048576|image/png+image/webp');

  PERFORM pg_temp.s9f_eq('B2 neither bucket is public and the preview one is closed on purpose: it has '
    'no policy at all, so nothing can be read from it, which is §1''s published-preview consent '
    'decision still open rather than a hole someone forgot',
    ARRAY[(SELECT count(*)::text FROM storage.buckets WHERE id = 'invitation-previews' AND public),
          (SELECT coalesce(string_agg(p.policyname, ','), '(none)') FROM pg_policies p
             WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
               AND (coalesce(p.qual, '') LIKE '%invitation-previews%'
                    OR coalesce(p.with_check, '') LIKE '%invitation-previews%'))]::text[],
    ARRAY['0', '(none)']::text[]);

  PERFORM pg_temp.s9f_eq('B3 the output bucket has exactly one policy, it is a SELECT, and it targets '
    'authenticated alone — the absence of an INSERT policy is the decision §6 records: the worker '
    'bypasses row security, so writing a policy for it would fail C18 without being honoured',
    coalesce((SELECT string_agg(p.cmd || '/' || array_to_string(p.roles, '|'), ',')
                FROM pg_policies p
               WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
                 AND (coalesce(p.qual, '') LIKE '%invitation-outputs%'
                      OR coalesce(p.with_check, '') LIKE '%invitation-outputs%')), '(none)'),
    'SELECT/authenticated');

  -- Now the policy as visibility, over bytes that exist. Objects are planted under the keys the rows
  -- already carry, so the predicate is being asked the question the panel will ask it. The cast is
  -- pulled through a row of `s9r` aliased `r` rather than the block's own record variable `s`, because
  -- `s` is a plpgsql name here and an alias written `s` collides with it.
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  SELECT 'invitation-outputs', o.object_key, r.owner_a, 'planted', '{"mimetype":"image/png"}'
    FROM s9r r JOIN public.invitation_outputs o ON o.wedding_id = r.wed_a
   WHERE o.storage_domain = 'host_private';
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  SELECT 'invitation-previews', o.object_key, r.owner_a, 'planted', '{"mimetype":"image/png"}'
    FROM s9r r JOIN public.invitation_outputs o ON o.wedding_id = r.wed_a
   WHERE o.storage_domain = 'published_preview';
  -- A key no manifest row claims, in the same bucket: the shape is valid, the registry is not, and the
  -- policy is supposed to answer from the registry.
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  SELECT 'invitation-outputs', 'outputs/never-registered/placeholder', r.owner_a, 'planted', '{}'::jsonb
    FROM s9r r;

  v_out := pg_temp.s9f_visible('authenticated', s.owner_a,
    'SELECT 1 FROM storage.objects WHERE bucket_id = ''invitation-outputs''');
  v_stranger := pg_temp.s9f_visible('authenticated', s.owner_b,
    'SELECT 1 FROM storage.objects WHERE bucket_id = ''invitation-outputs''');
  v_anon := pg_temp.s9f_visible('anon', NULL,
    'SELECT 1 FROM storage.objects WHERE bucket_id = ''invitation-outputs''');
  v_prev := pg_temp.s9f_visible('authenticated', s.owner_a,
    'SELECT 1 FROM storage.objects WHERE bucket_id = ''invitation-previews''');
  v_none := pg_temp.s9f_visible('authenticated', NULL,
    'SELECT 1 FROM storage.objects WHERE bucket_id = ''invitation-outputs''');

  PERFORM pg_temp.s9f_eq('B4 what each caller can see, planted against real keys: the owner sees every '
    'one of their private artefacts and the unclaimed key is invisible to everyone, because the '
    'predicate joins the registry rather than reading the name — a valid-looking path is not a '
    'permission',
    ARRAY[v_out::text, v_stranger::text, v_anon::text, v_none::text, v_prev::text]::text[],
    ARRAY[(SELECT count(*)::text FROM public.invitation_outputs
            WHERE wedding_id = s.wed_a AND storage_domain = 'host_private'),
          '0', '0', '0', '0']::text[]);

  PERFORM pg_temp.s9f_ok('B5 the preview objects are planted and unreadable, by their own host '
    'included: two rows exist in the closed bucket because §6 minted their keys, and no policy admits '
    'anybody. This is the consent question, recorded as a fact about this head',
    v_prev = 0 AND (SELECT count(*) FROM storage.objects
                     WHERE bucket_id = 'invitation-previews') >= 1);
END $B$;

-- --------------------------------------------------------------------------- Z: the census
DO $Z$
DECLARE s s9r%ROWTYPE; v_census text;
BEGIN
  SELECT * INTO s FROM s9r;

  PERFORM pg_temp.s9f_eq('Z1 three weddings and two accounts, and nothing else of either kind. This '
    'file created them and deleted no row outside itself',
    ARRAY[(SELECT count(*)::text FROM auth.users WHERE id IN (s.owner_a, s.owner_b)),
          (SELECT count(*)::text FROM public.weddings
             WHERE id IN (s.wed_a, s.wed_b, s.wed_none)),
          (SELECT count(*)::text FROM public.weddings
             WHERE owner_user_id NOT IN (s.owner_a, s.owner_b))]::text[],
    ARRAY['2', '3', '0']::text[]);

  PERFORM pg_temp.s9f_eq('Z2 the manifest''s own total, by wedding: the tested set battery 2 reads, '
    'and nothing that belongs to another wedding. A row that leaked into the second wedding would show '
    'up here rather than in a projection assertion',
    ARRAY[(SELECT count(*)::text FROM public.invitation_outputs
             WHERE wedding_id = s.wed_a),
          (SELECT count(*)::text FROM public.invitation_outputs
             WHERE wedding_id IN (s.wed_b, s.wed_none)),
          (SELECT count(*)::text FROM public.invitation_outputs
             WHERE version_id = (SELECT current_setting('s9f.ver_b')::uuid))]::text[],
    ARRAY[(SELECT count(*)::text FROM public.invitation_outputs), '0', '0']::text[]);

  PERFORM pg_temp.s9f_eq('Z3 the ledger and the table agree in both directions: every artefact row '
    'that survived the lifecycle, identity and delete groups is one this file registered when it '
    'created it, and every registration still has a row underneath it. A row that vanished without '
    'passing through a delete cell would show up as a ledger entry with nothing under it, and a row '
    'that arrived from somewhere else would show up on the left',
    ARRAY[(SELECT count(*)::text FROM public.invitation_outputs o
             WHERE NOT EXISTS (SELECT 1 FROM s9led l WHERE l.id = o.id)),
          (SELECT count(*)::text FROM s9led l
             WHERE NOT EXISTS (SELECT 1 FROM public.invitation_outputs o WHERE o.id = l.id)),
          (SELECT count(*)::text FROM public.invitation_outputs)]::text[],
    ARRAY['0', '0', (SELECT count(*)::text FROM s9led)]::text[]);

  -- The state census is printed on every run *and* asserted, so the literal below carries its own
  -- provenance: the number an auditor has to trust appears in the same capture as the cell that checks
  -- it. Battery 2 reads this residue rather than inventing rows, so which states exist and how many of
  -- each is a fact the second file depends on, not an incidental side effect of the first.
  v_census := (SELECT coalesce(string_agg(status || '=' || n, ' ' ORDER BY status COLLATE "C"), '-')
                 FROM (SELECT status, count(*)::text AS n FROM public.invitation_outputs
                        GROUP BY status) q);
  RAISE NOTICE 'MEASURE Z3b census = %', v_census;

  PERFORM pg_temp.s9f_eq('Z3b the state census of every artefact row this file left behind: all five '
    'lifecycle states are present, the counts are the file''s own arithmetic, and the total is the '
    '60 rows Z2 already tied to one wedding and one version',
    v_census,
    'failed=7 invalidated=9 ready=19 registered=14 uploading=11');

  PERFORM pg_temp.s9f_eq('Z4 the two buckets and the planted objects, stated as relations rather than '
    'as two spellings of the same count: the output bucket holds exactly one object more than the '
    'private rows claim — the extra one is the key no manifest row owns, which B proved is invisible — '
    'the preview bucket mirrors its rows exactly, and nothing was deleted to make either relation true',
    ARRAY[(SELECT count(*)::text FROM storage.buckets),
          (SELECT (count(*) - (SELECT count(*) FROM public.invitation_outputs
                                WHERE storage_domain = 'host_private'))::text
             FROM storage.objects WHERE bucket_id = 'invitation-outputs'),
          (SELECT (count(*) - (SELECT count(*) FROM public.invitation_outputs
                                WHERE storage_domain = 'published_preview'))::text
             FROM storage.objects WHERE bucket_id = 'invitation-previews'),
          (SELECT count(*)::text FROM storage.objects o
             WHERE NOT EXISTS (SELECT 1 FROM public.invitation_outputs m
                                 WHERE m.object_key = o.name))]::text[],
    ARRAY['3', '1', '0', '1']::text[]);

  PERFORM pg_temp.s9f_eq('Z5 the probe census for the whole file, declared here and counted there: '
    'eight in K, fifteen in C, three in P, one in N, one in G — twenty-eight statements that each have '
    'to answer with both a SQLSTATE and a sentence. A group whose rows were deleted, or whose `run()` '
    'was never called, would leave this line wrong rather than this file quietly green',
    (SELECT coalesce(string_agg(g || '=' || n, ' ' ORDER BY g COLLATE "C"), '-')
       FROM (SELECT grp AS g, count(*)::text AS n FROM probes GROUP BY grp) q),
    'C=15 G=1 K=8 N=1 P=3'::text);

  PERFORM pg_temp.s9f_ok('Z6 no artefact row is in a state its own evidence contradicts: the four '
    'paired CHECKs would have refused such a row at write time, and this is the read that proves the '
    'census above is about a consistent table rather than a table that stopped being consistent in the '
    'last group',
    (SELECT count(*) FROM public.invitation_outputs o
      WHERE (o.status IN ('ready', 'invalidated')) <> (o.content_digest IS NOT NULL)
         OR (o.status IN ('ready', 'invalidated')) <> (o.ready_at IS NOT NULL)
         OR (o.status = 'invalidated') <> (o.invalidated_at IS NOT NULL)
         OR (o.status = 'invalidated') <> (o.invalidation_reason IS NOT NULL)
         OR (o.output_kind = 'qr') <> (o.target_url_digest IS NOT NULL)
         OR o.attempt_count > 0 AND o.last_error IS NULL) = 0);
END $Z$;

-- --------------------------------------------------------------------------- L: the floor
-- The floor is the authored count at this head, counted mechanically from the file rather than
-- estimated, so a skipped group cannot read as a pass. The assertion is made *through* the counter, so
-- the printed total and the observed PASS lines cannot drift apart.
DO $L$
DECLARE ran integer;
BEGIN
  ran := coalesce(nullif(current_setting('s9f.passed', true), ''), '0')::int;
  -- 125 is counted from this file at this head and is re-derivable from it: 28 probe rows (K=8, C=15,
  -- P=3, N=1, G=1) + 25 `s9f_edge` cells + 18 `s9f_stmt` cells + 5 `s9f_del` cells + 34 inline
  -- `s9f_eq` calls + 16 inline `s9f_ok` calls = 126 assertions in the file, and this cell is the last
  -- of them, so 125 have been counted when the counter is read above. (`s9f_eq` is counted at its call
  -- sites only: the one call inside `s9f_has_keys` belongs to a helper this file does not use.)
  IF ran <> 125 THEN
    RAISE EXCEPTION 'FAIL: the floor moved — % assertions had run, this file declares 125 before its '
      'own last cell. A skipped group, a deleted cell or an added one all land here, and the number is '
      'what has to be re-derived from the call sites listed above, not guessed', ran;
  END IF;
  PERFORM pg_temp.s9f_ok('L1 the counter reached the floor derived from this file''s call sites ('
    || ran || ' assertions, plus this one)', true);
END $L$;

SELECT 'STAGE9 RENDER MANIFEST TESTS PASSED (' || current_setting('s9f.passed') || ')';
