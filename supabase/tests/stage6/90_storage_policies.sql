-- Stage 6 battery 2: the storage side of media — who may read, write, overwrite and remove the
-- bytes, measured through the policies on `storage.objects` rather than through the registry.
--
-- Run by `supabase/tests/stage6/run.sh` after the storage fixture, the whole migration chain and
-- battery 1, as the superuser, in one transaction that commits.
--
-- Two kinds of write happen here, and the difference is the whole point of separating them:
--
--   * a *client* write goes through `SET ROLE authenticated` / `SET ROLE anon` with `test.uid`
--     naming the account, so RLS decides it. Every assertion about visibility, upload, overwrite and
--     removal is a client write.
--   * a *stand-in* write runs as the harness superuser, which holds `bypassrls`. It puts bytes in the
--     bucket that a client could never have put there — an object no row claims, an object under a
--     loose prefix, an object owned by someone else. Without that ability the attacks below would
--     have nothing to attack, and a policy could pass by having no input to fail on.
--
-- Neither kind uploads a file. This tier has no Storage API in front of it: `storage.objects` is the
-- metadata table the service maintains, and writing a row to it is a stand-in for "these bytes are in
-- the bucket under this name". Nothing here proves an over-size upload is refused, that
-- `allowed_mime_types` is enforced at the edge, or that a signed URL works — those are HTTP-tier
-- measurements. What this tier does prove is that the three policies the Stage 6 migration installs
-- admit exactly the account that registered the row, and that the absence of a fourth policy (UPDATE)
-- is a refusal rather than an accident.
--
--   G  the grant shape, so every refusal below is attributable to a policy and not to a missing GRANT
--   P  the policy census the behaviour sections depend on
--   R  read/list (I8, A1, A5) — what each account can see, and the two shapes of invisible key
--   I  upload (I3, A2, A9) — the registered staged key is the only door
--   U  overwrite (A7) — no UPDATE policy, measured as zero rows *and* an unchanged stored value
--   D  removal (I6, A3, A15) — the tombstone ordering, and the service wall on both sides of it
--   Z  the census this file leaves behind, named rather than summarised
--   L  the ledger and the floor

SET client_min_messages = notice;
SELECT set_config('s6p.passed', '0', false);

CREATE FUNCTION pg_temp.s6p_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s6p.passed',
    (coalesce(nullif(current_setting('s6p.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s6p_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s6p_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s6p_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s6p_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s6p_lit(u uuid) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT quote_literal(u::text) $fn$;

-- Run a client statement and hand back SQLSTATE + message, so a refusal is named rather than merely
-- counted. The role is reset here because every call is followed by a superuser measurement, and a
-- leaked `SET ROLE` would silently move all the assertions after it into a different permission set.
CREATE FUNCTION pg_temp.s6p_as(role text, uid uuid, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('test.uid', coalesce(uid::text, ''), false);
  EXECUTE 'SET ROLE ' || role;
  BEGIN
    EXECUTE stmt;
    EXECUTE 'RESET ROLE';
    RETURN 'no-error';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN SQLSTATE || ' | ' || SQLERRM;
  END;
END $fn$;

-- How many rows a caller can see, measured as that caller. -1 means the statement raised, which is a
-- different answer from zero and is never rounded into it: `[]` and `403` are different products.
CREATE FUNCTION pg_temp.s6p_visible(role text, uid uuid, select_sql text) RETURNS bigint
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

-- How many rows a client UPDATE/DELETE actually changed. RLS turns a policy refusal on those two
-- commands into *zero rows*, not an error, so the row count is the measurement and an error here is
-- an unexpected third answer — which this helper surfaces by failing rather than by returning -1.
CREATE FUNCTION pg_temp.s6p_rows(role text, uid uuid, stmt text, flagged boolean) RETURNS bigint
LANGUAGE plpgsql AS $fn$
DECLARE n bigint;
BEGIN
  IF flagged THEN PERFORM set_config('storage.allow_delete_query', 'true', true); END IF;
  PERFORM set_config('test.uid', coalesce(uid::text, ''), false);
  EXECUTE 'SET ROLE ' || role;
  BEGIN
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    IF flagged THEN PERFORM set_config('storage.allow_delete_query', 'false', true); END IF;
    RAISE EXCEPTION 'unexpected % on [%]', SQLSTATE || ' ' || SQLERRM, stmt;
  END;
  EXECUTE 'RESET ROLE';
  IF flagged THEN PERFORM set_config('storage.allow_delete_query', 'false', true); END IF;
  RETURN n;
END $fn$;

-- The statement a browser's upload compiles down to at the database. `format(%L)` everywhere, so a
-- key or metadata blob assembled in a later edit cannot become an injection shape.
CREATE FUNCTION pg_temp.s6p_client_insert(bucket text, key text, owner uuid, meta jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT format('INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) '
    || 'VALUES (%L, %L, %L::uuid, %L, %L::jsonb)', bucket, key, owner, owner::text, meta::text);
$fn$;

-- Bytes that are already in the bucket. Run as the harness superuser, deliberately outside the
-- policies, to create the states a client cannot create but must not be able to read or remove.
CREATE FUNCTION pg_temp.s6p_plant(bucket text, key text, owner uuid, meta jsonb) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES (bucket, key, owner, owner::text, meta);
END $fn$;

CREATE FUNCTION pg_temp.s6p_exists(bucket text, key text) RETURNS bigint
LANGUAGE sql STABLE AS $fn$
  SELECT count(*) FROM storage.objects WHERE bucket_id = bucket AND name = key $fn$;

-- The stand-in for the service completing a removal, and the reason a stand-in is needed:
-- `protect_delete()` fires for every role with no exemption, so no client statement in this file can
-- delete bytes directly — D0 measures that wall from a client role instead of stepping over it.
CREATE FUNCTION pg_temp.s6p_service_delete(bucket text, key text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.objects WHERE bucket_id = bucket AND name = key;
  PERFORM set_config('storage.allow_delete_query', 'false', true);
END $fn$;

CREATE FUNCTION pg_temp.s6p_service_remove_bucket(bucket text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.objects WHERE bucket_id = bucket;
  DELETE FROM storage.buckets WHERE id = bucket;
  PERFORM set_config('storage.allow_delete_query', 'false', true);
END $fn$;

-- --------------------------------------------------------------------------- the cast
-- Two host accounts. `owner_a` is the actor; `owner_b` is the stranger that holds real bytes in the
-- same bucket. Three states of the same product object plus one never-uploaded registration give the
-- policies something to distinguish between.
CREATE TEMP TABLE s6p ON COMMIT DROP AS
SELECT gen_random_uuid() AS owner_a, gen_random_uuid() AS owner_b,
       gen_random_uuid() AS wedding_a, gen_random_uuid() AS wedding_b,
       gen_random_uuid() AS a_staged, gen_random_uuid() AS a_ready,
       gen_random_uuid() AS a_tomb, gen_random_uuid() AS a_open,
       gen_random_uuid() AS b_staged,
       gen_random_uuid() AS unclaimed_leaf;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT s.owner_a, 's6p-owner-a@example.test', '{}'::jsonb FROM s6p s
UNION ALL SELECT s.owner_b, 's6p-owner-b@example.test', '{}'::jsonb FROM s6p s;

INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages)
SELECT s.wedding_a, s.owner_a, 'S6 POLICY BATTERY A', 'en', ARRAY[]::text[] FROM s6p s
UNION ALL
SELECT s.wedding_b, s.owner_b, 'S6 POLICY BATTERY B', 'en', ARRAY[]::text[] FROM s6p s;

-- The registrations go in as their owners, through the minting trigger, so the keys this file tests
-- are keys the product mints and not keys this file invented.
DO $F$
DECLARE s s6p%ROWTYPE; err text;
BEGIN
  SELECT * INTO s FROM s6p;
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    'INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, mime_type, size_bytes) VALUES ('
    || pg_temp.s6p_lit(s.a_staged) || ', ' || quote_literal(s.wedding_a)
    || ', ''photo'', ''image/png'', 68)');
  PERFORM pg_temp.s6p_eq('F0 a staged registration is accepted as its owner (photo)', err, 'no-error');
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    'INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, mime_type, size_bytes) VALUES ('
    || pg_temp.s6p_lit(s.a_ready) || ', ' || quote_literal(s.wedding_a)
    || ', ''monogram'', ''image/webp'', 44)');
  PERFORM pg_temp.s6p_eq('F0b a second registration is accepted (monogram)', err, 'no-error');
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    'INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, mime_type, size_bytes) VALUES ('
    || pg_temp.s6p_lit(s.a_tomb) || ', ' || quote_literal(s.wedding_a)
    || ', ''audio'', ''audio/mpeg'', 900)');
  PERFORM pg_temp.s6p_eq('F0c a third registration is accepted (audio)', err, 'no-error');
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    'INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, mime_type, size_bytes) VALUES ('
    || pg_temp.s6p_lit(s.a_open) || ', ' || quote_literal(s.wedding_a)
    || ', ''photo'', ''image/png'', 1200)');
  PERFORM pg_temp.s6p_eq('F0d a fourth registration is accepted with no bytes yet — the upload door '
    'this file opens in I0', err, 'no-error');
  err := pg_temp.s6p_as('authenticated', s.owner_b,
    'INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, mime_type, size_bytes) VALUES ('
    || pg_temp.s6p_lit(s.b_staged) || ', ' || quote_literal(s.wedding_b)
    || ', ''photo'', ''image/png'', 68)');
  PERFORM pg_temp.s6p_eq('F0e and the stranger has a registration of its own, so a zero-row answer '
    'below cannot be a zero-data artifact', err, 'no-error');

  -- Bytes for everything except `a_open`, which is the row the upload section writes.
  PERFORM pg_temp.s6p_plant('wedding-assets',
    (SELECT object_key FROM public.wedding_assets WHERE id = s.a_staged), s.owner_a,
    jsonb_build_object('mimetype', 'image/png', 'size', 68, 'eTag', '"aaa111"'));
  PERFORM pg_temp.s6p_plant('wedding-assets',
    (SELECT object_key FROM public.wedding_assets WHERE id = s.a_ready), s.owner_a,
    jsonb_build_object('mimetype', 'image/webp', 'size', 44, 'eTag', '"bbb222"'));
  PERFORM pg_temp.s6p_plant('wedding-assets',
    (SELECT object_key FROM public.wedding_assets WHERE id = s.a_tomb), s.owner_a,
    jsonb_build_object('mimetype', 'audio/mpeg', 'size', 900, 'eTag', '"ccc333"'));
  PERFORM pg_temp.s6p_plant('wedding-assets',
    (SELECT object_key FROM public.wedding_assets WHERE id = s.b_staged), s.owner_b,
    jsonb_build_object('mimetype', 'image/png', 'size', 68, 'eTag', '"ddd444"'));
  PERFORM pg_temp.s6p_eq('F1 four objects are in the wedding bucket, each owned by the account that '
    'registered its row',
    (SELECT count(*) FROM storage.objects WHERE bucket_id = 'wedding-assets'
       AND name IN (SELECT object_key FROM public.wedding_assets
                    WHERE id IN (s.a_staged, s.a_ready, s.a_tomb, s.b_staged))), 4::bigint);

  -- Two of the states a client cannot create: bytes whose key has perfect grammar and no row, and
  -- bytes whose key has no `weddings` segment at all. Both are owned by `owner_a` on paper, so only
  -- the policy can make them invisible — nothing about the owner makes them so.
  PERFORM pg_temp.s6p_plant('wedding-assets',
    'weddings/' || s.wedding_a || '/photo/' || s.unclaimed_leaf, s.owner_a,
    jsonb_build_object('mimetype', 'image/png', 'size', 68));
  PERFORM pg_temp.s6p_plant('wedding-assets', 'gallery/loose.png', s.owner_a,
    jsonb_build_object('mimetype', 'image/png', 'size', 68));

  -- The confirmations run as the owner, through the registry edge battery 1 qualified.
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = ' || pg_temp.s6p_lit(s.a_ready));
  PERFORM pg_temp.s6p_eq('F2 one row is confirmed ready (positive control for the read policy)', err, 'no-error');
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = ' || pg_temp.s6p_lit(s.a_tomb));
  PERFORM pg_temp.s6p_eq('F3 the audio row is confirmed ready', err, 'no-error');
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    'UPDATE public.wedding_assets SET upload_status = ''tombstoned'' WHERE id = ' || pg_temp.s6p_lit(s.a_tomb));
  PERFORM pg_temp.s6p_eq('F4 and then tombstoned, so a removal in flight exists for D5 to finish', err, 'no-error');

  -- The same key in a bucket the product does not use. Created as the harness superuser: the
  -- migration owns one bucket, and this row exists only to be refused.
  INSERT INTO storage.buckets (id, name) VALUES ('s6-probe-bucket', 's6-probe-bucket');
  PERFORM pg_temp.s6p_plant('s6-probe-bucket',
    (SELECT object_key FROM public.wedding_assets WHERE id = s.a_ready), s.owner_a,
    jsonb_build_object('mimetype', 'image/png', 'size', 68));
END $F$;

-- --------------------------------------------------------------------------- G: the grant shape
DO $G$
DECLARE s s6p%ROWTYPE;
BEGIN
  SELECT * INTO s FROM s6p;
  -- Measured on the stack in `00_storage_schema.sql` and reproduced here because it decides what
  -- every later refusal in this file means: if the grant were missing, "zero rows" and "42501" would
  -- both still print, and neither would be evidence about a policy.
  PERFORM pg_temp.s6p_eq('G1 authenticated holds every client DML privilege on storage.objects, so '
    'nothing below is refused by a missing GRANT',
    (SELECT ARRAY_AGG(p ORDER BY p) FROM unnest(ARRAY['Select','Insert','Update','Delete']) p
      WHERE has_table_privilege('authenticated', 'storage.objects', p)),
    ARRAY['Delete','Insert','Select','Update']::text[]);
  PERFORM pg_temp.s6p_eq('G2 and so does anon — the storage tables are not protected by the Stage 2 '
    'grant allow-list, which is why this file''s anonymous assertions read as zero rows',
    (SELECT ARRAY_AGG(p ORDER BY p) FROM unnest(ARRAY['Select','Insert','Update','Delete']) p
      WHERE has_table_privilege('anon', 'storage.objects', p)),
    ARRAY['Delete','Insert','Select','Update']::text[]);
  -- The contrast battery 1 recorded for the registry, restated here so the two halves of I7 sit in
  -- one file: same product table, same anonymous caller, different door, different answer.
  PERFORM pg_temp.s6p_eq('G3 the registry table, by contrast, refuses anon at the grant — the '
    'mechanism differs and the labels must not blur it (see battery 1 K21)',
    left(pg_temp.s6p_as('anon', NULL, 'SELECT * FROM public.wedding_assets'), 5), '42501');
  PERFORM pg_temp.s6p_ok('G4 storage.objects has RLS enabled — with it off, the zero-row answers '
    'below would be an empty table rather than a policy',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass));
  PERFORM pg_temp.s6p_eq('G5 and the app tables this file reads through its policies are the real '
    'Stage 2 ones, not fixtures: a wedding owned by the actor and one by the stranger',
    (SELECT count(*) FROM public.weddings WHERE id IN (s.wedding_a, s.wedding_b)), 2::bigint);

  -- Not a hypothetical guard. Measured before the repair, on this very schema: `anon_exec_mint=true`,
  -- because a function created in `private` without its own REVOKE is executable by every role through
  -- PUBLIC, and Stage 2's default-privilege revoke does not reach functions. `private` has no schema
  -- USAGE for the browser roles, so this is the inner layer — and `service_role` does have USAGE, which
  -- is why Stage 5's privileged-function census counts exactly this set and grew when Stage 6 appeared.
  PERFORM pg_temp.s6p_eq('G6 none of Stage 6''s three trigger functions is executable by a browser '
    'role, by PUBLIC, or by service_role',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private'
        AND p.proname IN ('mint_wedding_asset_object_key', 'guard_wedding_asset_update',
                          'guard_wedding_asset_delete')
        AND (has_function_privilege('public', p.oid, 'EXECUTE')
             OR has_function_privilege('anon', p.oid, 'EXECUTE')
             OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
             OR has_function_privilege('service_role', p.oid, 'EXECUTE'))), 0::bigint);
  PERFORM pg_temp.s6p_eq('G6b and all three were found, so the line above is a census of named '
    'objects rather than a pass over an empty set',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private'
        AND p.proname IN ('mint_wedding_asset_object_key', 'guard_wedding_asset_update',
                          'guard_wedding_asset_delete')), 3::bigint);
END $G$;

-- --------------------------------------------------------------------------- P: the policy census
DO $P$
BEGIN
  -- Battery 1 measures the policy *shape*; this file depends on the shape still being there, so the
  -- census is re-taken here. Without it, a later migration that dropped the read policy would turn
  -- every "stranger sees zero rows" assertion in R into a pass.
  PERFORM pg_temp.s6p_eq('P1 exactly three policies exist on storage.objects for the product''s own '
    'commands, and they are read, insert and delete',
    (SELECT ARRAY_AGG(DISTINCT cmd ORDER BY cmd) FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname LIKE 'wedding_members_%'),
    ARRAY['DELETE','INSERT','SELECT']::text[]);
  -- `pg_policies` folds a `FOR ALL` policy into cmd = 'ALL', so both spellings of "this policy would
  -- let an UPDATE through" have to be counted; P1's exact census already implies it, and this names
  -- the absence the A7 claim rests on rather than leaving it to be inferred from that census.
  PERFORM pg_temp.s6p_eq('P2 none of them is a FOR UPDATE policy — A7 rests on this absence, so it is '
    'asserted here and not assumed',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd IN ('UPDATE', 'ALL') AND policyname LIKE 'wedding_members_%'), 0::bigint);
  PERFORM pg_temp.s6p_eq('P3 all three target `authenticated` alone — no policy is written for anon, '
    'which is what makes the anonymous answers in R an absence rather than a permission',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'wedding_members_%'
      AND roles IS DISTINCT FROM ARRAY['authenticated']::name[]), 0::bigint);
END $P$;

-- --------------------------------------------------------------------------- R: read / list
DO $R$
DECLARE s s6p%ROWTYPE; k_staged text; k_ready text; k_tomb text; k_open text; k_foreign text;
        k_unclaimed text; k_loose text;
BEGIN
  SELECT * INTO s FROM s6p;
  SELECT object_key INTO k_staged   FROM public.wedding_assets WHERE id = s.a_staged;
  SELECT object_key INTO k_ready    FROM public.wedding_assets WHERE id = s.a_ready;
  SELECT object_key INTO k_tomb     FROM public.wedding_assets WHERE id = s.a_tomb;
  SELECT object_key INTO k_open     FROM public.wedding_assets WHERE id = s.a_open;
  SELECT object_key INTO k_foreign  FROM public.wedding_assets WHERE id = s.b_staged;
  k_unclaimed := 'weddings/' || s.wedding_a || '/photo/' || s.unclaimed_leaf;
  k_loose := 'gallery/loose.png';

  -- The positive control for the whole section: it is what makes every zero below a refusal instead
  -- of a broken policy or an empty table.
  PERFORM pg_temp.s6p_eq('R0 the owner sees exactly the three objects its own rows claim',
    pg_temp.s6p_visible('authenticated', s.owner_a,
      'SELECT * FROM storage.objects WHERE bucket_id = ''wedding-assets'''
      || ' AND name IN (' || quote_literal(k_staged) || ',' || quote_literal(k_ready)
      || ',' || quote_literal(k_tomb) || ')'), 3::bigint);
  PERFORM pg_temp.s6p_eq('R1 the object the stranger uploaded is invisible to this account (A1)',
    pg_temp.s6p_visible('authenticated', s.owner_a,
      'SELECT * FROM storage.objects WHERE name = ' || quote_literal(k_foreign)), 0::bigint);
  PERFORM pg_temp.s6p_eq('R2 and the stranger sees its own object and nothing else — the same policy '
      'that hides one account hides the other, symmetrically',
    pg_temp.s6p_visible('authenticated', s.owner_b,
      'SELECT * FROM storage.objects WHERE bucket_id = ''wedding-assets'''), 1::bigint);
  PERFORM pg_temp.s6p_eq('R3 the stranger cannot list the bucket to discover the owner''s key at all '
      '(A1, the listing half)',
    pg_temp.s6p_visible('authenticated', s.owner_b,
      'SELECT * FROM storage.objects WHERE bucket_id = ''wedding-assets'' AND owner_id <> '
      || quote_literal(s.owner_b::text)), 0::bigint);
  -- G1 said anon holds SELECT, so this zero is the policy and nothing else. This is I7 at the layer
  -- the guest page actually reaches, and it is the opposite mechanism from the registry's 42501.
  PERFORM pg_temp.s6p_eq('R4 §I7: anon reads zero rows out of storage.objects even though it holds '
      'the SELECT grant — an invitation link is not a storage credential',
    pg_temp.s6p_visible('anon', NULL, 'SELECT * FROM storage.objects'), 0::bigint);
  PERFORM pg_temp.s6p_eq('R5 and anon sees zero of the bucket listing specifically, not just zero of '
      'a filtered query',
    pg_temp.s6p_visible('anon', NULL,
      'SELECT * FROM storage.objects WHERE bucket_id = ''wedding-assets'''
      || ' OR bucket_id = ''s6-probe-bucket'''), 0::bigint);
  -- A5 in its read form: a key with perfect grammar, in the right bucket, owned on paper by the
  -- caller, and claimed by nothing. The `EXISTS` over the registry is the only thing that hides it.
  PERFORM pg_temp.s6p_eq('R6 §I3/A5 a guessed key that is correctly formed and correctly owned is '
      'still invisible, because visibility comes from the registration and not from the name',
    pg_temp.s6p_visible('authenticated', s.owner_a,
      'SELECT * FROM storage.objects WHERE name = ' || quote_literal(k_unclaimed)), 0::bigint);
  PERFORM pg_temp.s6p_eq('R7 the bytes are really there — R6 is a policy answer, not a missing row',
    pg_temp.s6p_exists('wedding-assets', k_unclaimed), 1::bigint);
  -- The `foldername` clause is redundant against the minter, and is measured anyway: a key inside
  -- the wedding bucket that does not start with `weddings` is unreachable by any account.
  PERFORM pg_temp.s6p_eq('R8 an object under a non-`weddings` prefix in the same bucket is invisible '
      'even to the account recorded as its owner — the prefix clause does its own work',
    pg_temp.s6p_visible('authenticated', s.owner_a,
      'SELECT * FROM storage.objects WHERE name = ' || quote_literal(k_loose)), 0::bigint);
  PERFORM pg_temp.s6p_eq('R9 the same key in a different bucket is invisible: the policy binds the '
      'bucket, so a name alone is never a location (§5.1''s refusal to add a `bucket` column)',
    pg_temp.s6p_visible('authenticated', s.owner_a,
      'SELECT * FROM storage.objects WHERE bucket_id = ''s6-probe-bucket'''), 0::bigint);
  -- Stated, not smoothed over: the read policy does not require `ready`. The owner can therefore
  -- preview bytes it uploaded but never confirmed — which is the product behaviour the edit screen
  -- needs — and a guest page cannot reach that object because a guest never queries storage.objects:
  -- availability on the public side is the registry state column, qualified in battery 1 (O2c).
  PERFORM pg_temp.s6p_eq('R10 the owner can read its own staged object, and this is deliberate: the '
      'door is registration, not confirmation, and the guest path reads the state column instead',
    pg_temp.s6p_visible('authenticated', s.owner_a,
      'SELECT * FROM storage.objects o JOIN public.wedding_assets a ON a.object_key = o.name '
      || 'WHERE o.bucket_id = ''wedding-assets'' AND a.upload_status = ''staged'''
      || ' AND a.id = ' || pg_temp.s6p_lit(s.a_staged)), 1::bigint);
END $R$;

-- --------------------------------------------------------------------------- I: upload
DO $I$
DECLARE s s6p%ROWTYPE; err text; n_before bigint; k_open text; k_ready text; k_staged text;
        k_foreign text; k_foreign_key_owner_a text;
BEGIN
  SELECT * INTO s FROM s6p;
  SELECT object_key INTO k_staged  FROM public.wedding_assets WHERE id = s.a_staged;
  SELECT object_key INTO k_foreign FROM public.wedding_assets WHERE id = s.b_staged;
  SELECT object_key INTO k_open   FROM public.wedding_assets WHERE id = s.a_open;
  SELECT object_key INTO k_ready  FROM public.wedding_assets WHERE id = s.a_ready;
  SELECT object_key INTO k_staged FROM public.wedding_assets WHERE id = s.a_staged;

  -- The honest upload first, because every refusal after it is only meaningful beside a door that
  -- opens.
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    pg_temp.s6p_client_insert('wedding-assets', k_open, s.owner_a,
      jsonb_build_object('mimetype', 'image/png', 'size', 1200)));
  PERFORM pg_temp.s6p_eq('I0 writing bytes into the exact key a staged row of mine claims is '
    'accepted — this is the only door into the bucket', err, 'no-error');
  PERFORM pg_temp.s6p_eq('I1 and the object is there, recorded as owned by the caller',
    (SELECT owner_id FROM storage.objects WHERE bucket_id = 'wedding-assets' AND name = k_open),
    s.owner_a::text);
  PERFORM pg_temp.s6p_eq('I2 and the account can now see it — registration plus ownership is what '
    'makes bytes visible, in that order',
    pg_temp.s6p_visible('authenticated', s.owner_a,
      'SELECT * FROM storage.objects WHERE name = ' || quote_literal(k_open)), 1::bigint);

  -- §I3, the attack the design note names first: bytes inside the bucket with no row behind them.
  -- The refusal is measured against the bucket's own object count rather than against the key,
  -- because the attempted key carries a freshly generated uuid — naming it would mean rebuilding the
  -- very randomness the statement was made of, and a count cannot be fooled that way.
  n_before := pg_temp.s6p_exists('wedding-assets', k_staged)
            + pg_temp.s6p_exists('wedding-assets', k_ready)
            + pg_temp.s6p_exists('wedding-assets', k_open)
            + pg_temp.s6p_exists('wedding-assets', k_foreign)
            + pg_temp.s6p_exists('wedding-assets',
                'weddings/' || s.wedding_a || '/photo/' || s.unclaimed_leaf)
            + pg_temp.s6p_exists('wedding-assets', 'gallery/loose.png');
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    pg_temp.s6p_client_insert('wedding-assets',
      'weddings/' || s.wedding_a || '/photo/' || gen_random_uuid(), s.owner_a,
      jsonb_build_object('mimetype', 'image/png', 'size', 68)));
  PERFORM pg_temp.s6p_eq('I3 §I3: the same insert at a correctly-formed key of my own wedding with '
    'no registered row is refused (A5, write half)',
    left(err, 5), '42501');
  PERFORM pg_temp.s6p_eq('I3b and the bucket still holds exactly the objects this file named before '
    'the attempt — a refused policy writes nothing, not a partial row',
    pg_temp.s6p_exists('wedding-assets', k_staged)
    + pg_temp.s6p_exists('wedding-assets', k_ready)
    + pg_temp.s6p_exists('wedding-assets', k_open)
    + pg_temp.s6p_exists('wedding-assets', k_foreign)
    + pg_temp.s6p_exists('wedding-assets', 'weddings/' || s.wedding_a || '/photo/' || s.unclaimed_leaf)
    + pg_temp.s6p_exists('wedding-assets', 'gallery/loose.png'), n_before);

  -- A2: the attacker knows the victim's wedding id and the minted grammar. That is all a listing or
  -- a shared link can leak, so it must not be enough.
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    pg_temp.s6p_client_insert('wedding-assets',
      'weddings/' || s.wedding_b || '/photo/' || gen_random_uuid(), s.owner_a,
      jsonb_build_object('mimetype', 'image/png', 'size', 68)));
  PERFORM pg_temp.s6p_eq('I4 §A2: writing into another wedding''s prefix is refused even though the '
    'key is perfectly formed and the caller owns the object it claims', err,
    '42501 | new row violates row-level security policy for table "objects"');

  -- The object's own owner column is the second lock on the door: without it, a caller who somehow
  -- held a staged key could plant bytes attributed to somebody else.
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    pg_temp.s6p_client_insert('wedding-assets', k_open, s.owner_b,
      jsonb_build_object('mimetype', 'image/png', 'size', 68)));
  PERFORM pg_temp.s6p_eq('I5 an insert that claims another account as the object owner is refused',
    left(err, 5), '42501');
  PERFORM pg_temp.s6p_eq('I5b and it was refused for the right reason — the key already holds the '
    'caller''s object from I0, untouched',
    (SELECT owner_id FROM storage.objects WHERE bucket_id = 'wedding-assets' AND name = k_open),
    s.owner_a::text);

  -- A registered staged key, in a bucket the product does not use. The row's `owner_id` is honest
  -- and the key is honest: only the bucket clause can refuse this, so it is measured.
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    pg_temp.s6p_client_insert('s6-probe-bucket', k_staged, s.owner_a,
      jsonb_build_object('mimetype', 'image/png', 'size', 68)));
  PERFORM pg_temp.s6p_eq('I6 the same legal key inserted into a different bucket is refused — the '
    'policies bind one bucket and cannot be borrowed by another', left(err, 5), '42501');

  -- Copy-on-write is a database fact here, not a convention: `wedding_assets.object_key` is UNIQUE
  -- and the minted key never changes, so a second write to a live key has nowhere to land. This is
  -- the shape `upsert: true` would need to succeed, and the reason the SDK cannot overwrite in place.
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    pg_temp.s6p_client_insert('wedding-assets', k_open, s.owner_a,
      jsonb_build_object('mimetype', 'image/png', 'size', 999)));
  PERFORM pg_temp.s6p_eq('I7 a second write over a live registered key is refused — named by its '
    'SQLSTATE so a later edit that turns it into a policy pass is visible as a change, not a pass',
    left(err, 5), '23505');
  PERFORM pg_temp.s6p_eq('I7b and the stored metadata still says 1200, not 999 — the refusal did not '
    'half-write the new object',
    (SELECT metadata ->> 'size' FROM storage.objects
      WHERE bucket_id = 'wedding-assets' AND name = k_open), '1200');
  PERFORM pg_temp.s6p_eq('I7c and exactly one object sits at that key: replacement is two registered '
    'objects and a tombstone, never an overwrite',
    pg_temp.s6p_exists('wedding-assets', k_open), 1::bigint);

  -- The anonymous upload attempt, which is what an unauthenticated form post compiles to.
  err := pg_temp.s6p_as('anon', NULL,
    pg_temp.s6p_client_insert('wedding-assets', k_open, s.owner_a,
      jsonb_build_object('mimetype', 'image/png', 'size', 68)));
  PERFORM pg_temp.s6p_eq('I8 anon cannot write into the bucket at all: with no INSERT policy for it, '
    'the WITH CHECK has nothing to satisfy, so this is an error and not a zero-row no-op (contrast U3)',
    left(err, 5), '42501');

  -- A staged row of the *stranger's*, written by its own owner, is the case the policy must admit;
  -- the same key written by anyone else is the case it must refuse. Both halves in one pair:
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    pg_temp.s6p_client_insert('wedding-assets',
      (SELECT object_key FROM public.wedding_assets WHERE id = s.b_staged), s.owner_a,
      jsonb_build_object('mimetype', 'image/png', 'size', 68)));
  PERFORM pg_temp.s6p_eq('I9 writing over a stranger''s staged key is refused even with the caller''s '
    'own owner_id on the object — the row has to be the caller''s too, not merely exist',
    left(err, 5), '42501');
  k_foreign_key_owner_a := (SELECT object_key FROM public.wedding_assets WHERE id = s.b_staged);
  PERFORM pg_temp.s6p_eq('I9b and the stranger''s object is still its own',
    (SELECT owner_id FROM storage.objects
      WHERE bucket_id = 'wedding-assets' AND name = k_foreign_key_owner_a), s.owner_b::text);

  -- A ready row is not an upload target: its bytes already exist and its key is fixed. Measured
  -- beside I7 because the two refusals come from different places — the WITH CHECK runs before any
  -- index, so the state gate is what answers here, and the answer is a policy refusal rather than a
  -- uniqueness clash.
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    pg_temp.s6p_client_insert('wedding-assets', k_ready, s.owner_a,
      jsonb_build_object('mimetype', 'image/png', 'size', 68)));
  PERFORM pg_temp.s6p_eq('I10 a ready row''s key cannot be re-uploaded to — refused by the state '
    'gate inside the INSERT policy, not by the unique index that answered I7',
    left(err, 5), '42501');
END $I$;

-- --------------------------------------------------------------------------- U: overwrite (A7)
DO $U$
DECLARE s s6p%ROWTYPE; k_ready text; k_foreign text; n bigint;
BEGIN
  SELECT * INTO s FROM s6p;
  SELECT object_key INTO k_ready   FROM public.wedding_assets WHERE id = s.a_ready;
  SELECT object_key INTO k_foreign FROM public.wedding_assets WHERE id = s.b_staged;

  -- The owner, writing to its own object, with the grant in place and no policy for the command.
  -- `UPDATE` is filtered by RLS rather than refused, so the honest measurement is a row count.
  n := pg_temp.s6p_rows('authenticated', s.owner_a,
    'UPDATE storage.objects SET metadata = jsonb_set(metadata, ''{eTag}'', ''"ATTACKER"'') '
    || 'WHERE bucket_id = ''wedding-assets'' AND name = ' || quote_literal(k_ready), false);
  PERFORM pg_temp.s6p_eq('U7 §A7: the owner''s own UPDATE of a live object changes zero rows — there '
    'is no UPDATE policy, and this is the half of `upsert: true` the migration refuses to provide',
    n, 0::bigint);
  PERFORM pg_temp.s6p_eq('U7b and the stored metadata is byte-for-byte what the upload wrote — the '
    'zero rows is a refusal, not a silent success on a different row',
    (SELECT metadata ->> 'eTag' FROM storage.objects
      WHERE bucket_id = 'wedding-assets' AND name = k_ready), '"bbb222"');

  n := pg_temp.s6p_rows('authenticated', s.owner_b,
    'UPDATE storage.objects SET metadata = jsonb_set(metadata, ''{eTag}'', ''"ATTACKER"'') '
    || 'WHERE bucket_id = ''wedding-assets'' AND name = ' || quote_literal(k_ready), false);
  PERFORM pg_temp.s6p_eq('U7c a stranger''s UPDATE of the same object also changes zero rows', n, 0::bigint);

  n := pg_temp.s6p_rows('anon', NULL,
    'UPDATE storage.objects SET metadata = jsonb_set(metadata, ''{eTag}'', ''"ATTACKER"'') '
    || 'WHERE bucket_id = ''wedding-assets''', false);
  PERFORM pg_temp.s6p_eq('U7d anon''s UPDATE changes zero rows too, and the shape is worth naming: '
    'for UPDATE and DELETE an absent policy filters the target set instead of raising, which is why '
    'I8 and U7d are different kinds of refusal', n, 0::bigint);
  PERFORM pg_temp.s6p_eq('U7e and no object in the bucket carries the injected tag — four UPDATE '
    'attempts, zero mutations (`->>` unwraps the JSON string, so the compared value has no quotes of '
    'its own)',
    (SELECT count(*) FROM storage.objects WHERE metadata ->> 'eTag' = 'ATTACKER'), 0::bigint);

  -- The owner rewriting the *name* is the copy-on-write attack in another form: it would move bytes
  -- off a key a row still points at. Same absence, same answer, measured separately because the
  -- damage would be a broken pointer rather than a false description.
  n := pg_temp.s6p_rows('authenticated', s.owner_a,
    'UPDATE storage.objects SET name = name || ''.renamed'' '
    || 'WHERE bucket_id = ''wedding-assets'' AND name = ' || quote_literal(k_ready), false);
  PERFORM pg_temp.s6p_eq('U7f and a rename of a registered object changes zero rows, so no client '
    'statement can move bytes away from the key the registry holds', n, 0::bigint);
  PERFORM pg_temp.s6p_eq('U7g the object is still at the registered key',
    pg_temp.s6p_exists('wedding-assets', k_ready), 1::bigint);
END $U$;

-- --------------------------------------------------------------------------- D: removal
DO $D$
DECLARE s s6p%ROWTYPE; err text; n bigint;
        k_staged text; k_ready text; k_tomb text; k_open text; k_foreign text; k_unclaimed text;
BEGIN
  SELECT * INTO s FROM s6p;
  SELECT object_key INTO k_staged  FROM public.wedding_assets WHERE id = s.a_staged;
  SELECT object_key INTO k_ready   FROM public.wedding_assets WHERE id = s.a_ready;
  SELECT object_key INTO k_tomb    FROM public.wedding_assets WHERE id = s.a_tomb;
  SELECT object_key INTO k_open    FROM public.wedding_assets WHERE id = s.a_open;
  SELECT object_key INTO k_foreign FROM public.wedding_assets WHERE id = s.b_staged;
  k_unclaimed := 'weddings/' || s.wedding_a || '/photo/' || s.unclaimed_leaf;

  -- A15, the wall first: the reproduced `protect_delete()` trigger has no role exemption, so a
  -- client cannot delete bytes from the table directly even when its own policy would let it. The
  -- assertions below therefore run with the flag the Storage API sets in its own transaction, and
  -- this one measures the door from the other side rather than being stepped over.
  err := pg_temp.s6p_as('authenticated', s.owner_a,
    'DELETE FROM storage.objects WHERE bucket_id = ''wedding-assets'' AND name = '
    || quote_literal(k_tomb));
  PERFORM pg_temp.s6p_eq('D0 §A15: an owner''s direct DELETE is refused while '
    'storage.allow_delete_query is unset — byte removal belongs to the service, not to a client '
    'statement', left(err, 5), '42501');
  PERFORM pg_temp.s6p_eq('D0b and the object survives that refusal, which is the point of the wall',
    pg_temp.s6p_exists('wedding-assets', k_tomb), 1::bigint);

  -- Now the policy, measured with the wall taken down the way the service takes it down. Everything
  -- below is still `authenticated` with a caller's uid: the flag removes the trigger, not RLS.
  n := pg_temp.s6p_rows('authenticated', s.owner_a,
    'DELETE FROM storage.objects WHERE bucket_id = ''wedding-assets'' AND name = '
    || quote_literal(k_ready), true);
  PERFORM pg_temp.s6p_eq('D1 §I6: with the service flag set, the owner''s DELETE of a *ready* row''s '
    'object changes zero rows — the bytes a live registration advertises cannot be pulled out from '
    'under it', n, 0::bigint);
  PERFORM pg_temp.s6p_eq('D1b and they are still there, so a guest page holding that key is not '
    'pointing at removed media', pg_temp.s6p_exists('wedding-assets', k_ready), 1::bigint);

  n := pg_temp.s6p_rows('authenticated', s.owner_a,
    'DELETE FROM storage.objects WHERE bucket_id = ''wedding-assets'' AND name = '
    || quote_literal(k_staged), true);
  PERFORM pg_temp.s6p_eq('D2 the same refusal for a staged row''s object: the DELETE policy speaks '
    'only of tombstoned rows, so an abandoned upload is not cleanable by any client statement',
    n, 0::bigint);
  PERFORM pg_temp.s6p_eq('D2b and the staged bytes remain',
    pg_temp.s6p_exists('wedding-assets', k_staged), 1::bigint);

  n := pg_temp.s6p_rows('authenticated', s.owner_b,
    'DELETE FROM storage.objects WHERE bucket_id = ''wedding-assets'' AND name = '
    || quote_literal(k_ready), true);
  PERFORM pg_temp.s6p_eq('D3 §A3: the stranger''s DELETE of the owner''s object changes zero rows — '
    'the wedding join is what makes another account''s key unreachable even when the name is known',
    n, 0::bigint);
  PERFORM pg_temp.s6p_eq('D3b and the object is untouched',
    pg_temp.s6p_exists('wedding-assets', k_ready), 1::bigint);

  n := pg_temp.s6p_rows('authenticated', s.owner_a,
    'DELETE FROM storage.objects WHERE bucket_id = ''wedding-assets'' AND name = '
    || quote_literal(k_foreign), true);
  PERFORM pg_temp.s6p_eq('D4 the owner cannot remove the stranger''s object either, in either '
    'direction — ownership is checked from both sides of the same join', n, 0::bigint);

  n := pg_temp.s6p_rows('authenticated', s.owner_a,
    'DELETE FROM storage.objects WHERE bucket_id = ''wedding-assets'' AND name = '
    || quote_literal(k_unclaimed), true);
  PERFORM pg_temp.s6p_eq('D5 §A5: an object that no row claims is undeletable by the account the '
    'object records as its owner — there is no "no row ever claimed it" branch, and that absence is '
    'what keeps guessed keys from being a target', n, 0::bigint);
  PERFORM pg_temp.s6p_eq('D5b stated plainly rather than softened: orphan bytes are therefore not '
    'cleanable by any account in V1. This is the honest shape of I6 given C18 (no service_role policy '
    'is admissible), and it is why removal order is object-then-row and never row-then-object',
    pg_temp.s6p_exists('wedding-assets', k_unclaimed), 1::bigint);

  n := pg_temp.s6p_rows('anon', NULL,
    'DELETE FROM storage.objects WHERE bucket_id = ''wedding-assets''', true);
  PERFORM pg_temp.s6p_eq('D6 anon''s DELETE, even with the service flag set, changes zero rows — the '
    'flag is a statement-level trigger gate and not an escalation', n, 0::bigint);

  -- The positive control for the whole section, and the only legal removal: tombstone, then delete.
  PERFORM pg_temp.s6p_eq('D7 the audio row is tombstoned and its object is the only thing the DELETE '
    'policy admits',
    pg_temp.s6p_rows('authenticated', s.owner_a,
      'DELETE FROM storage.objects WHERE bucket_id = ''wedding-assets'' AND name = '
      || quote_literal(k_tomb), true), 1::bigint);
  PERFORM pg_temp.s6p_eq('D8 and the bytes are gone',
    pg_temp.s6p_exists('wedding-assets', k_tomb), 0::bigint);
  PERFORM pg_temp.s6p_eq('D8b while the row still holds the pointer, mid-removal — that pair is the '
    'state battery 1 calls a removable row, not an orphan',
    (SELECT upload_status FROM public.wedding_assets WHERE id = s.a_tomb), 'tombstoned');

  err := pg_temp.s6p_as('authenticated', s.owner_a,
    'UPDATE public.wedding_assets SET upload_status = ''tombstoned'' WHERE id = '
    || pg_temp.s6p_lit(s.a_ready));
  PERFORM pg_temp.s6p_eq('D9 the monogram row may now begin removal (the registry edge allows '
    'ready → tombstoned and nothing else forward)', err, 'no-error');
  PERFORM pg_temp.s6p_eq('D10 and its object becomes deletable by exactly that statement — the two '
    'halves of I6 are one ordering, not two independent rules',
    pg_temp.s6p_rows('authenticated', s.owner_a,
      'DELETE FROM storage.objects WHERE bucket_id = ''wedding-assets'' AND name = '
      || quote_literal(k_ready), true), 1::bigint);
  PERFORM pg_temp.s6p_eq('D11 and the attempt that D1 refused now succeeds against the same key with '
    'the same caller and the same flag: the only variable that moved was the row''s state',
    pg_temp.s6p_exists('wedding-assets', k_ready), 0::bigint);
END $D$;

-- --------------------------------------------------------------------------- Z: the census left behind
DO $Z$
DECLARE s s6p%ROWTYPE; k_staged text; k_open text; k_foreign text; k_unclaimed text; n bigint;
BEGIN
  SELECT * INTO s FROM s6p;
  SELECT object_key INTO k_staged  FROM public.wedding_assets WHERE id = s.a_staged;
  SELECT object_key INTO k_open    FROM public.wedding_assets WHERE id = s.a_open;
  SELECT object_key INTO k_foreign FROM public.wedding_assets WHERE id = s.b_staged;
  k_unclaimed := 'weddings/' || s.wedding_a || '/photo/' || s.unclaimed_leaf;

  -- The two tombstoned rows whose bytes are gone are the only rows the registry's delete guard lets
  -- through, and removing them closes the path this file opened. Measured as the owner, because the
  -- DELETE policy on the registry is the owner's own.
  n := pg_temp.s6p_rows('authenticated', s.owner_a,
    'DELETE FROM public.wedding_assets WHERE id IN ('
    || pg_temp.s6p_lit(s.a_tomb) || ',' || pg_temp.s6p_lit(s.a_ready) || ')', false);
  PERFORM pg_temp.s6p_eq('Z0 a tombstoned row whose bytes are gone can be deleted by its owner — the '
    'full removal sequence, end to end, in one client session', n, 2::bigint);

  PERFORM pg_temp.s6p_eq('Z1 no ready row is left in this file''s cast, and no ready row is missing '
    'its object — the invariant of the stage, re-measured after every write above',
    (SELECT count(*) FROM public.wedding_assets a
      WHERE a.id IN (s.a_staged, s.a_ready, s.a_tomb, s.a_open, s.b_staged)
        AND a.upload_status = 'ready'
        AND NOT EXISTS (SELECT 1 FROM storage.objects o
                        WHERE o.bucket_id = 'wedding-assets' AND o.name = a.object_key)), 0::bigint);

  -- Named rather than summarised, because "the residue" is the claim a later reader has to be able
  -- to check. Three objects claimed by a staged row, two planted unclaimed, nothing else of this
  -- file's still in the bucket.
  PERFORM pg_temp.s6p_eq('Z2 this file''s own objects in the wedding bucket are exactly five',
    (SELECT count(*) FROM storage.objects WHERE bucket_id = 'wedding-assets'
      AND name IN (k_staged, k_open, k_foreign, k_unclaimed, 'gallery/loose.png')), 5::bigint);
  PERFORM pg_temp.s6p_eq('Z3 three of them are claimed by a staged row (the actor''s two, the '
    'stranger''s one) — invisible to a guest because availability reads the state',
    (SELECT count(*) FROM public.wedding_assets a WHERE a.id IN (s.a_staged, s.a_open, s.b_staged)
      AND a.upload_status = 'staged'
      AND EXISTS (SELECT 1 FROM storage.objects o
                  WHERE o.bucket_id = 'wedding-assets' AND o.name = a.object_key)), 3::bigint);
  PERFORM pg_temp.s6p_eq('Z4 and two are unclaimed by construction: the guessed-shape key and the '
    'loose-prefix key. Neither is readable, listable or deletable by any client role (R6, R8, D5) — '
    'the O1 class, kept in the bucket on purpose because no client may remove it',
    (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'wedding-assets'
      AND NOT EXISTS (SELECT 1 FROM public.wedding_assets a WHERE a.object_key = o.name)
      AND o.name IN (k_unclaimed, 'gallery/loose.png')), 2::bigint);

  -- The probe bucket existed to be refused. Battery 1 removed its own so that a later file could
  -- count buckets; the same courtesy is extended forward here, and the removal is the service's
  -- shape, not a client's, because D0 measured the difference.
  PERFORM pg_temp.s6p_service_remove_bucket('s6-probe-bucket');
  PERFORM pg_temp.s6p_eq('Z5 no s6-* probe bucket survives this file: the product''s bucket census '
    'stays a single row for anything measured after it',
    (SELECT count(*) FROM storage.buckets WHERE id LIKE 's6-%'), 0::bigint);
  PERFORM pg_temp.s6p_eq('Z6 the wedding bucket is still present with its recorded ceiling intact — '
    'this file wrote objects and policies, never the bucket row',
    (SELECT file_size_limit FROM storage.buckets WHERE id = 'wedding-assets'), 5242880::bigint);
  PERFORM pg_temp.s6p_eq('Z7 and it is still private: I8 has the same value it started with',
    (SELECT public FROM storage.buckets WHERE id = 'wedding-assets'), false);
END $Z$;

-- --------------------------------------------------------------------------- L: the floor
-- The floor is the measured count at this head, and it exists to catch a section that stops running:
-- a `DO` block whose fixture insert fails would otherwise leave the rest of the file reading an empty
-- bucket and printing passes for all the wrong reasons.
DO $L$
DECLARE ran int;
BEGIN
  ran := coalesce(nullif(current_setting('s6p.passed', true), '')::int, 0);
  IF ran < 79 THEN
    RAISE EXCEPTION 'FAIL: only % Stage 6 storage-policy assertions ran — the measured floor is 79', ran;
  END IF;
  PERFORM pg_temp.s6p_ok('L1 the counter, the fixtures and the floor all moved together ('
    || ran || ' assertions)', true);
END $L$;

SELECT 'STAGE6 STORAGE POLICY TESTS PASSED (' || current_setting('s6p.passed') || ')' AS result;
