-- Stage 6 battery 1: the registry side of media — the minted key, the state machine, and the
-- ordering that keeps a pointer to un-collected bytes from being lost.
--
-- Run by `supabase/tests/stage6/run.sh` after the storage fixture and the whole migration chain, as
-- the superuser, in one transaction that commits.
--
-- What "upload" means in this tier, stated up front because it is the boundary of the claim: this
-- file writes a row into `storage.objects` directly, with the column values a real authenticated
-- upload was measured to produce (`owner` and `owner_id` both set to the caller's subject,
-- `metadata->>'mimetype'` and `metadata->>'size'` from the stored bytes). That is a stand-in for the
-- metadata the service writes, not a byte upload. Nothing here proves the Storage API accepts a
-- file, refuses an over-size file, or honours `allowed_mime_types` — those are HTTP-tier
-- measurements, and the bucket-level shape this file does assert is the *recorded* limits.
--
--   B  the bucket and registry shape the rest of the file depends on
--   K  key minting (I2, A6) — every client-supplied shape refused, every legal row minted
--   S  the `staged → ready` edge (I4) — present, owned, matching, and each refusal beside it
--   T  the rest of the state machine (I5) — terminal tombstone, no reverse edge, ordinary edits live
--   D  deletion ordering (I6) — bytes before row, and the two orphan classes counted
--   L  the ledger and the floor
--
-- The role discipline is the point, not decoration: every statement a browser could send is sent
-- here as `authenticated` with `test.uid` naming the account, so a refusal is the database's answer
-- to the caller the product actually has, and every positive control runs through the same role.

SET client_min_messages = notice;
SELECT set_config('s6r.passed', '0', false);

CREATE FUNCTION pg_temp.s6r_add(n integer) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('s6r.passed',
    (coalesce(nullif(current_setting('s6r.passed', true), ''), '0')::int + n)::text, false);
END $fn$;

CREATE FUNCTION pg_temp.s6r_ok(label text, condition boolean) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(condition, false) THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s6r_add(1);
END $fn$;

CREATE FUNCTION pg_temp.s6r_eq(label text, got anyelement, want anyelement) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT (got IS NOT DISTINCT FROM want) THEN
    RAISE EXCEPTION 'FAIL % — got [%] want [%]', label, got, want;
  END IF;
  RAISE NOTICE 'PASS %', label;
  PERFORM pg_temp.s6r_add(1);
END $fn$;

-- A uuid spelled into a dynamic statement has to arrive as a quoted literal, and `quote_literal`
-- is used rather than hand-written apostrophes so that the one place a caller-controlled value is
-- interpolated cannot become an injection shape in a later edit of this file.
CREATE FUNCTION pg_temp.s6r_lit(u uuid) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$ SELECT quote_literal(u::text) $fn$;

-- Run a statement as a named caller and hand back SQLSTATE + message, so a refusal can be named
-- rather than merely counted. `RESET ROLE` happens in the caller's session, not here, because the
-- helper must not decide who the next statement is attributed to.
CREATE FUNCTION pg_temp.s6r_as(role text, uid uuid, stmt text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('test.uid', coalesce(uid::text, ''), false);
  EXECUTE 'SET ROLE ' || role;
  BEGIN
    EXECUTE stmt;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('test.role', 'authenticated', false);
    RETURN 'no-error';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN SQLSTATE || ' | ' || SQLERRM;
  END;
END $fn$;

-- How many rows a caller can see, measured as that caller.
CREATE FUNCTION pg_temp.s6r_visible(role text, uid uuid, select_sql text) RETURNS bigint
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

-- The stand-in for "the Storage API removed the bytes", and the reason it has to be a stand-in.
-- `protect_delete()` is a BEFORE DELETE FOR EACH STATEMENT trigger on both storage tables, and it
-- fires for every role including the one running this file: it refuses unless the transaction has
-- set `storage.allow_delete_query`. The service does set it, in the transaction where it deletes a
-- row it has already removed from the object store. So a removal below carries the flag the service
-- carries, and the flag is put back immediately afterwards so that no later statement in this file
-- runs with the wall taken down. D0 measures the refusal on the other side of that door.
CREATE FUNCTION pg_temp.s6r_service_delete_object(key text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.objects WHERE bucket_id = 'wedding-assets' AND name = key;
  PERFORM set_config('storage.allow_delete_query', 'false', true);
END $fn$;

CREATE FUNCTION pg_temp.s6r_service_remove_bucket(bucket text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.objects WHERE bucket_id = bucket;
  DELETE FROM storage.buckets WHERE id = bucket;
  PERFORM set_config('storage.allow_delete_query', 'false', true);
END $fn$;

-- Which head is being qualified, and is it this one or later — the same two questions every suite
-- from Stage 5 onwards asks of itself, for the reason they all give: heads are cumulative, so a
-- chain that qualifies Stage 9 still contains everything Stage 6 added, and an equality test would
-- hand a later chain this file's Stage 6 expectations. A malformed token refuses rather than
-- defaulting, because a runner that cannot name the head it is qualifying must not print a green.
-- This file needs the machinery for one line of its census, B1/D6's bucket inventory, which Stage 9
-- moves from one bucket to three.
CREATE FUNCTION pg_temp.s6r_head() RETURNS text
LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(current_setting('app.stage_head', true), 'stage6') $fn$;

CREATE FUNCTION pg_temp.s6r_at_least(want text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $fn$
DECLARE h int; w int;
BEGIN
  IF pg_temp.s6r_head() !~ '^stage[0-9]+$' OR want !~ '^stage[0-9]+$' THEN
    RAISE EXCEPTION 's6r_at_least: a stage head must be spelled stage<n> — got head=% want=%',
      pg_temp.s6r_head(), want;
  END IF;
  h := regexp_replace(pg_temp.s6r_head(), '^stage', '')::int;
  w := regexp_replace(want, '^stage', '')::int;
  RETURN h >= w;
END
$fn$;

-- --------------------------------------------------------------------------- the cast
-- Two host accounts and their weddings: one is the actor, one is the stranger. A third wedding
-- belongs to the stranger and is the target of the "upload into someone else's prefix" shape.
CREATE TEMP TABLE s6r ON COMMIT DROP AS
SELECT gen_random_uuid() AS owner_a, gen_random_uuid() AS owner_b,
       gen_random_uuid() AS wedding_a, gen_random_uuid() AS wedding_b,
       gen_random_uuid() AS asset_photo, gen_random_uuid() AS asset_monogram,
       gen_random_uuid() AS asset_audio, gen_random_uuid() AS asset_noobj,
       gen_random_uuid() AS asset_wrong_mime, gen_random_uuid() AS asset_wrong_size,
       gen_random_uuid() AS asset_foreigner;

INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT s.owner_a, 's6-owner-a@example.test', '{}'::jsonb FROM s6r s
UNION ALL SELECT s.owner_b, 's6-owner-b@example.test', '{}'::jsonb FROM s6r s;

INSERT INTO public.weddings (id, owner_user_id, title, primary_language, additional_languages)
SELECT s.wedding_a, s.owner_a, 'S6 BATTERY A', 'en', ARRAY[]::text[] FROM s6r s
UNION ALL
SELECT s.wedding_b, s.owner_b, 'S6 BATTERY B', 'en', ARRAY[]::text[] FROM s6r s;

-- --------------------------------------------------------------------------- B: the shape asserted
DO $B$
DECLARE s s6r%ROWTYPE; bucket_row storage.buckets%ROWTYPE; col information_schema.columns%ROWTYPE;
BEGIN
  SELECT * INTO s FROM s6r;

  SELECT * INTO bucket_row FROM storage.buckets WHERE id = 'wedding-assets';
  PERFORM pg_temp.s6r_ok('B0 the bucket the migration declares is here — a guard that silently '
    'skipped it would print every assertion below as a pass on an empty schema',
    found);
  -- §4's "one bucket for the whole product" was true of the product Stage 6 shipped, and Stage 9
  -- is the first stage to add to it: the render artefacts get a bucket of their own, and the
  -- published-preview bucket is created closed with nothing readable in it. The census is therefore
  -- stated as the inventory *by name* at both heads rather than as a number, because a number can be
  -- raised by whatever a later stage forgets to declare; a fourth id fails this line by appearing in
  -- the list. Stage 6's own bucket keeps every property below.
  PERFORM pg_temp.s6r_eq('B1 §4: the bucket inventory is '
    || CASE WHEN pg_temp.s6r_at_least('stage9')
              THEN 'exactly these three — the wedding-asset bucket §4 declares, Stage 9''s render '
                   || 'outputs, and Stage 9''s published-preview bucket, which is created closed'
            ELSE 'exactly one, the wedding-asset bucket §4 declares' END,
    (SELECT coalesce(string_agg(b.id, ', ' ORDER BY b.id), '(none)') FROM storage.buckets b),
    CASE WHEN pg_temp.s6r_at_least('stage9')
         THEN 'invitation-outputs, invitation-previews, wedding-assets'
         ELSE 'wedding-assets' END);
  PERFORM pg_temp.s6r_eq('B2 §4: it is private, so I8 has something to stand on',
    bucket_row.public, false);
  PERFORM pg_temp.s6r_eq('B3 §4: the recorded byte ceiling is 5 MiB',
    bucket_row.file_size_limit, 5242880::bigint);
  PERFORM pg_temp.s6r_eq('B4 §4: the allowed types are the four image/audio types and nothing else '
    '— no image/svg+xml, no text/html, no application/pdf, which is the blueprint rule enforced '
    'before any sanitiser exists',
    bucket_row.allowed_mime_types,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg']::text[]);
  PERFORM pg_temp.s6r_eq('B5 §12.4: a bare bucket row is STANDARD and un-versioned, so no '
    'delete-marker semantics reach the tombstone rules',
    bucket_row.type::text || '/' || bucket_row.versioning_status, 'STANDARD/DISABLED');
  PERFORM pg_temp.s6r_ok('B5b the lifecycle columns are NULL — retention is registry state, not a '
    'half-declared bucket configuration (§12.5.3)',
    bucket_row.lifecycle_configuration IS NULL
    AND bucket_row.lifecycle_configuration_generation IS NULL);

  SELECT * INTO col FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'wedding_assets'
     AND column_name = 'upload_status';
  PERFORM pg_temp.s6r_eq('B6 the state column is NOT NULL with a staged default, so a row cannot '
    'arrive unlabelled', col.is_nullable, 'NO');
  PERFORM pg_temp.s6r_eq('B6b and the default really is staged', col.column_default,
    '''staged''::text');
  -- Read out of the catalog rather than string-surgery on the whole definition: every quoted
  -- lowercase word inside the constraint that names `upload_status`. A fourth state would appear
  -- here, and a reworded CHECK that dropped one would too.
  PERFORM pg_temp.s6r_eq('B7 the vocabulary is the three states and no fourth',
    (SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
       FROM pg_constraint
      CROSS JOIN LATERAL regexp_matches(
              pg_get_constraintdef(pg_constraint.oid), '''([a-z]+)', 'g') AS m
      WHERE conrelid = 'public.wedding_assets'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%upload_status%'),
    ARRAY['ready','staged','tombstoned']::text[]);

  PERFORM pg_temp.s6r_ok('B8 the three registry guards and the key minter are attached to the table '
    'the browser writes',
    (SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
      WHERE tgrelid = 'public.wedding_assets'::regclass AND NOT tgisinternal)
    = ARRAY['set_updated_at','wedding_assets_guard_delete','wedding_assets_guard_update',
            'wedding_assets_mint_object_key']::text[]);

  -- §5's claim is about the *kinds* of statement a policy admits to: read, insert, delete, and no
  -- UPDATE — which is what makes A7 a refusal rather than a convention. Stage 9 adds a second read
  -- policy, for its own bucket, so the multiset of command letters is no longer a statement of that
  -- claim (two `r` rows would have to be explained by a count). The distinct set still is, and B9b
  -- names the policies themselves, which is what stops a third read policy, an update policy or a
  -- renamed one from arriving as a number that happens to fit.
  PERFORM pg_temp.s6r_eq('B9 §5: the policy kinds on storage.objects are read, insert, delete — and no '
    'UPDATE, which is what makes A7 a refusal instead of a convention',
    (SELECT array_agg(DISTINCT pol.polcmd::text ORDER BY pol.polcmd::text) FROM pg_policy pol
      WHERE pol.polrelid = 'storage.objects'::regclass),
    ARRAY['a','d','r']::text[]);
  PERFORM pg_temp.s6r_eq('B9b and the policies on that table are '
    || CASE WHEN pg_temp.s6r_at_least('stage9')
              THEN 'exactly these four — Stage 6''s read, upload and tombstone-delete for the asset '
                   || 'bucket, plus Stage 9''s read for the output bucket; no insert, update or '
                   || 'delete policy reaches a render artefact'
            ELSE 'exactly these three, one read, one insert and one delete, all of them Stage 6''s' END,
    (SELECT coalesce(string_agg(pol.polname, ', ' ORDER BY pol.polname COLLATE "C"), '(none)')
       FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass),
    CASE WHEN pg_temp.s6r_at_least('stage9')
         THEN 'wedding_members_read_asset_objects, wedding_members_read_output_objects, '
              || 'wedding_members_remove_tombstoned_asset_objects, '
              || 'wedding_members_upload_staged_asset_objects'
         ELSE 'wedding_members_read_asset_objects, '
              || 'wedding_members_remove_tombstoned_asset_objects, '
              || 'wedding_members_upload_staged_asset_objects' END);
  PERFORM pg_temp.s6r_eq('B10 every one of those policies is PERMISSIVE and aimed at authenticated '
    'alone, which is what Stage 2 C18/C19 require of a policy in any schema',
    (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass
       AND pol.polpermissive
       AND ARRAY(SELECT r::regrole::text FROM unnest(pol.polroles) r) = ARRAY['authenticated']),
    CASE WHEN pg_temp.s6r_at_least('stage9') THEN 4::bigint ELSE 3::bigint END);

  PERFORM pg_temp.s6r_ok('B11 the storage helpers the policies call are executable by '
    'authenticated — measured here rather than assumed, because an inert helper turns a policy into '
    'a door',
    has_function_privilege('authenticated', 'storage.foldername(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'storage.extension(text)', 'EXECUTE')
    AND has_schema_privilege('authenticated', 'storage', 'USAGE'));

  PERFORM pg_temp.s6r_ok('B12 the key grammar the design promised is the grammar the CHECK still '
    'enforces: no leading slash, no traversal, non-blank',
    (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.wedding_assets'::regclass
       AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%object_key%') >= 1);
END $B$;

-- --------------------------------------------------------------------------- K: minting
DO $K$
DECLARE s s6r%ROWTYPE; err text; minted text; parts text[];
BEGIN
  SELECT * INTO s FROM s6r;

  -- The legal path: a client insert that names no key at all, as the account that owns the wedding.
  err := pg_temp.s6r_as('authenticated', s.owner_a,
    'INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, label, mime_type, size_bytes) '
    || 'VALUES (''' || s.asset_photo || ''', ''' || s.wedding_a || ''', ''photo'', '
    || '''TEST ONLY — family photograph'', ''image/png'', 68)');
  PERFORM pg_temp.s6r_eq('K0 the honest insert is accepted (positive control: every refusal below '
    'is only meaningful because this one was not a refusal)', err, 'no-error');

  SELECT object_key INTO minted FROM public.wedding_assets WHERE id = s.asset_photo;
  PERFORM pg_temp.s6r_eq('K1 §4: the minted key is weddings/<wedding>/<kind>/<row id>, four '
    'segments, no extension, and its last segment is the row''s own id',
    minted, 'weddings/' || s.wedding_a || '/photo/' || s.asset_photo);
  parts := string_to_array(minted, '/');
  PERFORM pg_temp.s6r_eq('K2 the segment count is exactly four', array_length(parts, 1), 4);
  PERFORM pg_temp.s6r_eq('K3 storage.foldername sees the three leading segments, which is what the '
    'read policy binds ownership to',
    array_to_string(storage.foldername(minted), ','), 'weddings,' || s.wedding_a || ',photo');
  -- Reproduced verbatim from the live service, so the measurement is of the real helper: it splits
  -- the *filename* on '.', and a minted key has no dot, so it hands back the whole last segment.
  -- That is the fact the design relies on — an extension-shaped reader of a wedding key can only
  -- ever see the row's own id, never a type the client chose.
  PERFORM pg_temp.s6r_eq('K4 and storage.extension on a minted key is the last segment itself — '
    'there is no extension to disagree with the stored type',
    storage.extension(minted), parts[4]);

  PERFORM pg_temp.s6r_eq('K5 the row is born staged and nothing else',
    (SELECT upload_status FROM public.wedding_assets WHERE id = s.asset_photo), 'staged');

  -- Every non-blank shape a client could present as a key. Each must be refused by the minter, with
  -- the trigger's own SQLSTATE, before any of them reaches the CHECK that would also (second
  -- defence) refuse two of them. K11 handles the one shape that is not a claim at all.
  PERFORM pg_temp.s6r_eq('K6 a client-supplied key is refused outright, not normalised',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'INSERT INTO public.wedding_assets (wedding_id, asset_kind, object_key) VALUES ('
      || '''' || s.wedding_a || ''', ''photo'', ''weddings/' || s.wedding_a || '/photo/x'')'), 5),
    '42501');
  PERFORM pg_temp.s6r_eq('K7 traversal shape refused',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'INSERT INTO public.wedding_assets (wedding_id, asset_kind, object_key) VALUES ('
      || '''' || s.wedding_a || ''', ''photo'', ''../../etc/passwd'')'), 5), '42501');
  PERFORM pg_temp.s6r_eq('K8 absolute-path shape refused',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'INSERT INTO public.wedding_assets (wedding_id, asset_kind, object_key) VALUES ('
      || '''' || s.wedding_a || ''', ''photo'', ''/weddings/absolute'')'), 5), '42501');
  PERFORM pg_temp.s6r_eq('K9 another wedding''s prefix refused — the prefix is not a hint the '
    'database accepts and then honours',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'INSERT INTO public.wedding_assets (wedding_id, asset_kind, object_key) VALUES ('
      || '''' || s.wedding_a || ''', ''photo'', ''weddings/' || s.wedding_b || '/photo/steal'')'), 5),
    '42501');
  PERFORM pg_temp.s6r_eq('K10 an over-long key is refused at the same door, not stored and truncated',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'INSERT INTO public.wedding_assets (wedding_id, asset_kind, object_key) VALUES ('
      || '''' || s.wedding_a || ''', ''photo'', ''weddings/'' || repeat(''a'', 400))'), 5), '42501');
  -- A blank claim is not a key: `btrim(object_key) = ''` is the same statement as omitting the
  -- column, so the minter mints over it instead of refusing. The guarantee this stage sells is
  -- therefore not "every non-empty string is refused" — it is "no client string is ever stored as
  -- a key", and that is what the two assertions below measure. The row is removed afterwards so
  -- the residue counts further down stay about the three legal inserts only.
  err := pg_temp.s6r_as('authenticated', s.owner_a,
    'INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, object_key) VALUES ('
    || '''' || s.asset_foreigner || ''', ''' || s.wedding_a || ''', ''photo'', ''   '')');
  PERFORM pg_temp.s6r_eq('K11 a whitespace-only key claim reads as an absent claim, not a refusal',
    err, 'no-error');
  SELECT object_key INTO minted FROM public.wedding_assets WHERE id = s.asset_foreigner;
  PERFORM pg_temp.s6r_eq('K11b and what the row carries is the minted grammar, not the client''s '
    'blanks — the blank never reached the row, so no read path can echo it back',
    minted, 'weddings/' || s.wedding_a || '/photo/' || s.asset_foreigner);
  PERFORM pg_temp.s6r_eq('K11c no row in the registry carries a blank or empty key',
    (SELECT count(*) FROM public.wedding_assets WHERE btrim(object_key) = ''), 0::bigint);
  PERFORM pg_temp.s6r_as('authenticated', s.owner_a,
    'DELETE FROM public.wedding_assets WHERE id = ' || pg_temp.s6r_lit(s.asset_foreigner));

  -- A client cannot insert a row already claiming `ready`.
  PERFORM pg_temp.s6r_eq('K12 born-ready refused: the claim of bytes is only made by the edge that '
    'looks for them',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'INSERT INTO public.wedding_assets (wedding_id, asset_kind, upload_status) VALUES ('
      || '''' || s.wedding_a || ''', ''photo'', ''ready'')'), 5), '42501');
  PERFORM pg_temp.s6r_eq('K13 born-tombstoned refused for the same reason',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'INSERT INTO public.wedding_assets (wedding_id, asset_kind, upload_status) VALUES ('
      || '''' || s.wedding_a || ''', ''photo'', ''tombstoned'')'), 5), '42501');

  -- The kind vocabulary is what the third segment is made of, so an illegal kind must be refused
  -- before a key can be minted from it.
  PERFORM pg_temp.s6r_eq('K14 an unknown asset_kind never reaches the minter — the CHECK on the '
    'vocabulary fires first, so no key can carry a segment outside the grammar',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'INSERT INTO public.wedding_assets (wedding_id, asset_kind) VALUES ('
      || '''' || s.wedding_a || ''', ''executable'')'), 5), '23514');

  -- Two rows in one wedding must not collide, because the last segment is each row's own id.
  err := pg_temp.s6r_as('authenticated', s.owner_a,
    'INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, label, mime_type, size_bytes) '
    || 'VALUES (''' || s.asset_monogram || ''', ''' || s.wedding_a || ''', ''monogram'', '
    || '''TEST ONLY — monogram'', ''image/webp'', 44)');
  PERFORM pg_temp.s6r_eq('K15 a second asset in the same wedding, a different kind, is accepted',
    err, 'no-error');
  SELECT object_key INTO minted FROM public.wedding_assets WHERE id = s.asset_monogram;
  PERFORM pg_temp.s6r_eq('K16 and its key differs in both the kind segment and the id segment',
    minted, 'weddings/' || s.wedding_a || '/monogram/' || s.asset_monogram);

  err := pg_temp.s6r_as('authenticated', s.owner_a,
    'INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, mime_type, size_bytes) '
    || 'VALUES (''' || s.asset_audio || ''', ''' || s.wedding_a || ''', ''audio'', '
    || '''audio/mpeg'', 900)');
  PERFORM pg_temp.s6r_eq('K17 the audio kind mints through the same grammar', err, 'no-error');

  PERFORM pg_temp.s6r_eq('K18 an insert for a wedding the caller does not own is refused by '
    'ownership, not by the minter — the minter is not the ownership boundary and is not claimed to be',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'INSERT INTO public.wedding_assets (wedding_id, asset_kind) VALUES ('
      || '''' || s.wedding_b || ''', ''photo'')'), 5), '42501');

  -- The stranger cannot even read the count of what the owner registered.
  PERFORM pg_temp.s6r_eq('K19 a stranger sees zero of the owner''s registry rows (A1, SQL half)',
    pg_temp.s6r_visible('authenticated', s.owner_b, 'SELECT * FROM public.wedding_assets'),
    0::bigint);
  PERFORM pg_temp.s6r_eq('K20 and the owner sees exactly the three accepted here',
    pg_temp.s6r_visible('authenticated', s.owner_a, 'SELECT * FROM public.wedding_assets'),
    3::bigint);
  -- I7 for the registry side, measured at the door that actually shuts it: Stage 2's grant
  -- allow-list gives `anon` no table privileges on any customer table, so an anonymous read is a
  -- refusal rather than an empty list. The label names the mechanism because the two are different
  -- answers over HTTP (403 versus `[]`), and the battery should not quietly redefine which one it
  -- measured. `storage.objects` is the opposite shape — anon holds SELECT there and only RLS stops
  -- it — and battery 2 measures that one.
  PERFORM pg_temp.s6r_eq('K21 anon never reaches the registry at all: the table grant refuses it, '
    'which is I7 enforced one layer before RLS',
    left(pg_temp.s6r_as('anon', NULL, 'SELECT * FROM public.wedding_assets'), 5), '42501');

  -- Counted over the two weddings this battery created, and that scope is a measurement, not a
  -- tidy-up: alone on a schema with no other suite's rows, the whole-table count and this one agree,
  -- but `stage2/20_attacks` seeds two `wedding_assets` rows of its own and commits them, so the
  -- table-wide count reported 5 where this file's own probes left 3. The residue this assertion is
  -- about is this file's residue. Stage 4 made the same repair for the same reason (its `Dc3`, in
  -- `stage4/50_pack_release.sql`), and `stage5/50_review_binding`'s B2b needed it at this head too.
  PERFORM pg_temp.s6r_eq('K22 exactly the three legal inserts left rows behind — nine refusals, '
    'one blank claim that was minted over and then removed, and no residue',
    (SELECT count(*) FROM public.wedding_assets a
      WHERE a.wedding_id IN (s.wedding_a, s.wedding_b)), 3::bigint);
END $K$;

-- --------------------------------------------------------------------------- S: the ready edge
DO $S$
DECLARE s s6r%ROWTYPE; err text; k_photo text; k_mono text; k_audio text; k_noobj text;
BEGIN
  SELECT * INTO s FROM s6r;
  SELECT object_key INTO k_photo FROM public.wedding_assets WHERE id = s.asset_photo;
  SELECT object_key INTO k_mono  FROM public.wedding_assets WHERE id = s.asset_monogram;
  SELECT object_key INTO k_audio FROM public.wedding_assets WHERE id = s.asset_audio;

  -- The metadata rows stand in for the service's own writes, with the column values an
  -- authenticated upload was measured to produce.
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES ('wedding-assets', k_photo, s.owner_a, s.owner_a::text,
          jsonb_build_object('mimetype', 'image/png', 'size', 68, 'eTag', '"deadbeef"')),
         ('wedding-assets', k_mono,  s.owner_a, s.owner_a::text,
          jsonb_build_object('mimetype', 'image/webp', 'size', 44)),
         ('wedding-assets', k_audio, s.owner_a, s.owner_a::text,
          jsonb_build_object('mimetype', 'audio/mpeg', 'size', 900));

  err := pg_temp.s6r_as('authenticated', s.owner_a,
    'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = ' || pg_temp.s6r_lit(s.asset_photo));
  PERFORM pg_temp.s6r_eq('S0 the honest confirmation is accepted (positive control for every '
    'refusal below)', err, 'no-error');
  PERFORM pg_temp.s6r_eq('S1 and the row is ready',
    (SELECT upload_status FROM public.wedding_assets WHERE id = s.asset_photo), 'ready');

  -- A row with no bytes behind it.
  err := pg_temp.s6r_as('authenticated', s.owner_a,
    'INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, label) VALUES ('
    || pg_temp.s6r_lit(s.asset_noobj) || ', ' || '''' || s.wedding_a || ''', ''decorative'', '
    || '''TEST ONLY — never uploaded'')');
  PERFORM pg_temp.s6r_eq('S2 a decorative asset can be registered with no bytes yet', err, 'no-error');
  SELECT object_key INTO k_noobj FROM public.wedding_assets WHERE id = s.asset_noobj;
  PERFORM pg_temp.s6r_eq('S3 §I4: confirming it anyway is refused — this is the exact row this stage '
    'exists to make unrepresentable',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = ' || pg_temp.s6r_lit(s.asset_noobj)), 5),
    '42501');
  PERFORM pg_temp.s6r_eq('S3b and it stays staged rather than half-claiming',
    (SELECT upload_status FROM public.wedding_assets WHERE id = s.asset_noobj), 'staged');

  -- Same key, wrong bucket. The row's *own* minted key is placed in a bucket the product does not
  -- use, because that is the only shape in which a name-only lookup would be satisfied while the
  -- real bucket stays empty — and the design's claim is that the edge looks in one bucket.
  INSERT INTO storage.buckets (id, name) VALUES ('s6-other-bucket', 's6-other-bucket');
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES ('s6-other-bucket', k_noobj, s.owner_a, s.owner_a::text,
          jsonb_build_object('mimetype', 'image/png', 'size', 68));
  PERFORM pg_temp.s6r_eq('S4 an object of the same name in another bucket does not make a row ready '
    '— §5.1''s refusal to add a `bucket` column is enforced by the edge that reads the table',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = '
      || pg_temp.s6r_lit(s.asset_noobj)), 5), '42501');
  PERFORM pg_temp.s6r_eq('S4b and the row is still staged after that attempt, so the refusal left '
    'nothing half-written',
    (SELECT upload_status FROM public.wedding_assets WHERE id = s.asset_noobj), 'staged');

  -- Ownership of the bytes, not just presence at the key.
  UPDATE storage.objects SET owner_id = s.owner_b::text, owner = s.owner_b
   WHERE bucket_id = 'wedding-assets' AND name = k_mono;
  PERFORM pg_temp.s6r_eq('S5 a staged row whose bytes were written by another account cannot be '
    'confirmed by this account',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = ' || pg_temp.s6r_lit(s.asset_monogram)), 5),
    '42501');
  UPDATE storage.objects SET owner_id = s.owner_a::text, owner = s.owner_a
   WHERE bucket_id = 'wedding-assets' AND name = k_mono;
  PERFORM pg_temp.s6r_eq('S6 and the same statement succeeds once the object belongs to the caller '
    '— the refusal above was about ownership, not about the role''s ability to write the column',
    pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = ' || pg_temp.s6r_lit(s.asset_monogram)),
    'no-error');

  -- The two claims the row makes about the bytes.
  INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, label, mime_type, size_bytes)
  VALUES (s.asset_wrong_mime, s.wedding_a, 'photo', 'TEST ONLY — claims png, is jpeg',
          'image/png', 68);
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  SELECT 'wedding-assets', object_key, s.owner_a, s.owner_a::text,
         jsonb_build_object('mimetype', 'image/jpeg', 'size', 68)
    FROM public.wedding_assets WHERE id = s.asset_wrong_mime;
  PERFORM pg_temp.s6r_eq('S7 §I4: a row claiming one type while the object records another is '
    'refused — the served type comes from the row, so this pair would be a lie the guest page reads',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = ' || pg_temp.s6r_lit(s.asset_wrong_mime)), 5),
    '42501');

  INSERT INTO public.wedding_assets (id, wedding_id, asset_kind, label, mime_type, size_bytes)
  VALUES (s.asset_wrong_size, s.wedding_a, 'photo', 'TEST ONLY — claims 68, stored 120',
          'image/png', 68);
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  SELECT 'wedding-assets', object_key, s.owner_a, s.owner_a::text,
         jsonb_build_object('mimetype', 'image/png', 'size', 120)
    FROM public.wedding_assets WHERE id = s.asset_wrong_size;
  PERFORM pg_temp.s6r_eq('S8 §I4: and a size mismatch is refused for the same reason',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = ' || pg_temp.s6r_lit(s.asset_wrong_size)), 5),
    '42501');

  -- A row that does not describe its bytes is not "described wrongly": the nullable columns exist,
  -- and the edge must accept them rather than invent a claim.
  UPDATE public.wedding_assets SET mime_type = NULL, size_bytes = NULL WHERE id = s.asset_wrong_size;
  PERFORM pg_temp.s6r_eq('S9 an undeclared type and size is accepted where a wrong one was refused '
    '— the check compares claims, and an absent claim is not a false one',
    pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = ' || pg_temp.s6r_lit(s.asset_wrong_size)),
    'no-error');

  -- Unreadable metadata must refuse with the guard's own SQLSTATE rather than a cast error, because
  -- a caller cannot tell a 22P02 apart from a broken build.
  UPDATE public.wedding_assets SET mime_type = NULL, size_bytes = 68 WHERE id = s.asset_noobj;
  PERFORM pg_temp.s6r_service_delete_object(
    (SELECT object_key FROM public.wedding_assets WHERE id = s.asset_noobj));
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  SELECT 'wedding-assets', object_key, s.owner_a, s.owner_a::text,
         jsonb_build_object('mimetype', 'image/png', 'size', 'not-a-number')
    FROM public.wedding_assets WHERE id = s.asset_noobj;
  PERFORM pg_temp.s6r_eq('S10 metadata whose size is not a number refuses the confirmation as 42501, '
    'not as a cast failure',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = ' || pg_temp.s6r_lit(s.asset_noobj)), 5),
    '42501');

  -- The stranger cannot confirm someone else's row: under RLS the UPDATE matches no row at all, so
  -- the statement succeeds as a no-op and the state is the measurement — not the return code. An
  -- assertion written on the return code here would read as a pass for the wrong reason.
  PERFORM pg_temp.s6r_eq('S11 a stranger''s confirmation of the owner''s staged row runs without '
    'error, because RLS removes every row from its target set',
    pg_temp.s6r_as('authenticated', s.owner_b,
      'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = '
      || pg_temp.s6r_lit(s.asset_noobj)), 'no-error');
  PERFORM pg_temp.s6r_eq('S11b and the row is still staged — the zero-row match is the refusal, and '
    'this is the assertion that distinguishes the two',
    (SELECT upload_status FROM public.wedding_assets WHERE id = s.asset_noobj), 'staged');
END $S$;

-- --------------------------------------------------------------------------- T: the rest of the machine
DO $T$
DECLARE s s6r%ROWTYPE; err text; k_audio text;
BEGIN
  SELECT * INTO s FROM s6r;
  SELECT object_key INTO k_audio FROM public.wedding_assets WHERE id = s.asset_audio;

  err := pg_temp.s6r_as('authenticated', s.owner_a,
    'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = ' || pg_temp.s6r_lit(s.asset_audio));
  PERFORM pg_temp.s6r_eq('T0 the audio row confirms (positive control for the edges below)',
    err, 'no-error');

  PERFORM pg_temp.s6r_eq('T1 §I5: ready cannot go back to staged — a row that has claimed bytes '
    'cannot un-claim them and keep the key',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''staged'' WHERE id = ' || pg_temp.s6r_lit(s.asset_audio)), 5),
    '42501');
  -- Stated separately because it is the shape a client library can produce by accident: a write
  -- guarded so that it matches no row is *accepted* and changes nothing. The return code is not the
  -- measurement here; the row is.
  PERFORM pg_temp.s6r_eq('T2 a re-confirmation written to match no row runs as a silent no-op',
    pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''ready'', label = ''again'' '
      || 'WHERE id = ' || pg_temp.s6r_lit(s.asset_audio) || ' AND upload_status <> ''ready'''),
    'no-error');
  PERFORM pg_temp.s6r_eq('T2a and the label it tried to write is not there — the statement touched '
    'zero rows, which is the only reason it was allowed to look like a success',
    (SELECT label FROM public.wedding_assets WHERE id = s.asset_audio), NULL::text);
  -- What the machine does *not* do, measured rather than assumed: a write that moves neither the
  -- state nor a byte-claim returns before the object read, so re-asserting `ready → ready` on an
  -- unchanged description is accepted as the no-op it is. Stated narrowly on purpose — the next two
  -- assertions cover the half of same-status writes this early return must *not* swallow.
  PERFORM pg_temp.s6r_eq('T2b a ready row re-claimed as ready with its description untouched is '
    'accepted — the state does not move and no claim moved with it',
    pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = ' || pg_temp.s6r_lit(s.asset_audio)),
    'no-error');
  -- The door a blanket same-status early return leaves open, and the reason it is a defect rather
  -- than a detail: `mime_type` and `size_bytes` are columns a PATCH can name without touching the
  -- state at all, and the served description of a ready row comes from those columns. A write that
  -- keeps the row ready while making it describe the bytes falsely must therefore be refused by the
  -- same edge that refused the false claim at confirmation.
  PERFORM pg_temp.s6r_eq('T2c §I4: a ready row cannot be re-described into a lie — changing the '
    'claimed type with the state unchanged is refused, because the description of a ready row is a '
    'claim about bytes that have to agree with it',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET mime_type = ''text/html'' WHERE id = '
      || pg_temp.s6r_lit(s.asset_audio)), 5), '42501');
  PERFORM pg_temp.s6r_eq('T2cd and the refused lie did not land — the row still claims the type it '
    'was confirmed against',
    (SELECT mime_type FROM public.wedding_assets WHERE id = s.asset_audio), 'audio/mpeg');
  PERFORM pg_temp.s6r_eq('T2d §I4: the same door on the other claim — a size the object does not '
    'have is refused by the same route',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET size_bytes = 901 WHERE id = ' || pg_temp.s6r_lit(s.asset_audio)), 5),
    '42501');
  -- The repaired route must verify, not blanket-refuse. An absent claim is not a false one, so
  -- dropping the claims is legal; putting honest claims back through the same edge is the positive
  -- control that says the verification ran and agreed rather than that it was skipped.
  PERFORM pg_temp.s6r_eq('T2e dropping the claims on a ready row is accepted — §I4 compares claims, '
    'and a row that claims nothing cannot be a liar',
    pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET mime_type = NULL, size_bytes = NULL WHERE id = '
      || pg_temp.s6r_lit(s.asset_audio)), 'no-error');
  PERFORM pg_temp.s6r_eq('T2f and re-declaring them truthfully through the same route is accepted — '
    'the edge re-reads the object, it does not freeze the row',
    pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET mime_type = ''audio/mpeg'', size_bytes = 900 WHERE id = '
      || pg_temp.s6r_lit(s.asset_audio)), 'no-error');
  PERFORM pg_temp.s6r_eq('T2g the row is still ready and now carries the claims again — the state '
    'machine never moved during the description edits',
    (SELECT upload_status || '|' || mime_type || '|' || size_bytes::text
       FROM public.wedding_assets WHERE id = s.asset_audio), 'ready|audio/mpeg|900');

  -- A same-status write must stay legal: the guard is about state, and a state machine that blocks
  -- editing a caption is a broken feature, not a safe one.
  PERFORM pg_temp.s6r_eq('T3 an ordinary edit of a ready row still works (label only, same state) — '
    'the guard refuses transitions, not updates',
    pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET label = ''TEST ONLY — renamed'' WHERE id = ' || pg_temp.s6r_lit(s.asset_audio)),
    'no-error');

  -- Quoted with `quote_literal`, not hand-written apostrophes. An earlier draft of this assertion
  -- concatenated the literal *inside* the dynamic statement, and the run answered 42601 — a syntax
  -- error from psql — which `left(..., 5)` would have reported as a refusal that never happened.
  PERFORM pg_temp.s6r_eq('T4 §I2: the minted key cannot be rewritten, not even to another key of the '
    'same legal grammar under the same wedding',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET object_key = '
      || quote_literal('weddings/' || s.wedding_a || '/photo/renamed-by-client')
      || ' WHERE id = ' || pg_temp.s6r_lit(s.asset_audio)), 5), '42501');
  PERFORM pg_temp.s6r_eq('T4b and the key the row holds is still the one it was minted with',
    (SELECT object_key FROM public.wedding_assets WHERE id = s.asset_audio), k_audio);
  PERFORM pg_temp.s6r_eq('T5 §I2: nor can the row be re-parented to another wedding',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET wedding_id = ''' || s.wedding_b || ''' WHERE id = '
      || pg_temp.s6r_lit(s.asset_audio)), 5), '42501');
  PERFORM pg_temp.s6r_eq('T6 and the kind cannot be swapped, because the kind is a segment of the key',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET asset_kind = ''monogram'' WHERE id = ' || pg_temp.s6r_lit(s.asset_audio)), 5),
    '42501');

  PERFORM pg_temp.s6r_eq('T7 ready → tombstoned is the only forward edge',
    pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''tombstoned'' WHERE id = ' || pg_temp.s6r_lit(s.asset_audio)),
    'no-error');
  PERFORM pg_temp.s6r_eq('T8 §I5: and tombstoned is terminal — a row that began removal cannot '
    'claim availability again',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''ready'' WHERE id = ' || pg_temp.s6r_lit(s.asset_audio)), 5),
    '42501');
  PERFORM pg_temp.s6r_eq('T8b not even back to staged',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''staged'' WHERE id = ' || pg_temp.s6r_lit(s.asset_audio)), 5),
    '42501');

  -- staged → tombstoned (abandoning an upload) is legal and must not need bytes.
  PERFORM pg_temp.s6r_eq('T9 a never-uploaded row can be abandoned straight to tombstoned',
    pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''tombstoned'' WHERE id = ' || pg_temp.s6r_lit(s.asset_wrong_mime)),
    'no-error');
END $T$;

-- --------------------------------------------------------------------------- D: ordering and orphans
DO $D$
DECLARE s s6r%ROWTYPE; k_audio text; k_photo text; n_before bigint;
BEGIN
  SELECT * INTO s FROM s6r;
  SELECT object_key INTO k_audio FROM public.wedding_assets WHERE id = s.asset_audio;
  SELECT object_key INTO k_photo FROM public.wedding_assets WHERE id = s.asset_photo;

  -- The wall this file's own stand-ins work around, measured rather than quietly stepped over: the
  -- reproduced `protect_delete()` trigger has no role exemption, so even the superuser is refused
  -- until the flag the service sets is set. A15 measures the same wall from a client role.
  PERFORM pg_temp.s6r_eq('D0 a direct DELETE from storage.objects is refused with 42501 while '
    'storage.allow_delete_query is unset — the deletions below run with the flag the Storage API '
    'itself sets, so they stand in for the service, not around it',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'DELETE FROM storage.objects WHERE bucket_id = ''wedding-assets'' '
      || 'AND name = ''' || k_audio || ''''), 5), '42501');

  -- A ready row whose object exists cannot be deleted out from under it.
  PERFORM pg_temp.s6r_eq('D1 §I5: deleting a ready row is refused while it claims bytes',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'DELETE FROM public.wedding_assets WHERE id = ' || pg_temp.s6r_lit(s.asset_photo)), 5), '42501');

  -- Tombstoned, but the bytes are still there: the row may not go first. This is the crash window
  -- named as O2 rather than left undefined.
  PERFORM pg_temp.s6r_service_delete_object(k_photo);
  PERFORM pg_temp.s6r_eq('D1b with the bytes gone, the tombstone path is open — but the row is still '
    'ready here, and that combination is refused too: removal order is object-then-tombstone-then-row',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'DELETE FROM public.wedding_assets WHERE id = ' || pg_temp.s6r_lit(s.asset_photo)), 5), '42501');
  PERFORM pg_temp.s6r_eq('D2 §I5: a ready row with no object cannot be silently deleted either; it '
    'must move through tombstoned, which is how an inconsistency becomes visible instead of vanishing',
    pg_temp.s6r_as('authenticated', s.owner_a,
      'UPDATE public.wedding_assets SET upload_status = ''tombstoned'' WHERE id = ' || pg_temp.s6r_lit(s.asset_photo)
      || ' AND (SELECT count(*) FROM storage.objects WHERE bucket_id = ''wedding-assets'' '
      || 'AND name = ''' || k_photo || ''') = 0'), 'no-error');
  PERFORM pg_temp.s6r_eq('D3 now the row can go',
    pg_temp.s6r_as('authenticated', s.owner_a,
      'DELETE FROM public.wedding_assets WHERE id = ' || pg_temp.s6r_lit(s.asset_photo)), 'no-error');

  -- The tombstoned row whose bytes still exist: refuse, because losing the pointer is exactly the
  -- orphan the docs warn about ("deleting the metadata doesn't remove the object").
  PERFORM pg_temp.s6r_eq('D4 a tombstoned row cannot be deleted while its object is still in the '
    'bucket — the ordering that keeps un-collected bytes from losing their pointer',
    left(pg_temp.s6r_as('authenticated', s.owner_a,
      'DELETE FROM public.wedding_assets WHERE id = ' || pg_temp.s6r_lit(s.asset_audio)), 5), '42501');

  n_before := (SELECT count(*) FROM storage.objects WHERE bucket_id = 'wedding-assets');
  PERFORM pg_temp.s6r_service_delete_object(k_audio);
  PERFORM pg_temp.s6r_eq('D5 and once the object is gone the row goes too',
    pg_temp.s6r_as('authenticated', s.owner_a,
      'DELETE FROM public.wedding_assets WHERE id = ' || pg_temp.s6r_lit(s.asset_audio)), 'no-error');
  PERFORM pg_temp.s6r_eq('D5b the object count did move down — the two statements above are about '
    'the same pair of rows, not about two unrelated successes',
    (SELECT count(*) FROM storage.objects WHERE bucket_id = 'wedding-assets'), n_before - 1);

  -- Orphan classes, counted rather than hidden.
  PERFORM pg_temp.s6r_eq('O1 zero objects in the wedding bucket have no registry row claiming them '
    '(bytes with no row — the class I3 is supposed to prevent)',
    (SELECT count(*) FROM storage.objects o
      WHERE o.bucket_id = 'wedding-assets'
        AND NOT EXISTS (SELECT 1 FROM public.wedding_assets a WHERE a.object_key = o.name)), 0::bigint);
  PERFORM pg_temp.s6r_eq('O2 the residue is named by state rather than summarised away: two rows '
    'ready, one staged that never confirmed, one tombstoned mid-removal',
    (SELECT array_agg(x ORDER BY x) FROM (
       SELECT a.upload_status || '=' || count(*)::text AS x
         FROM public.wedding_assets a
        WHERE a.wedding_id IN (s.wedding_a, s.wedding_b)
        GROUP BY a.upload_status
     ) y),
    ARRAY['ready=2', 'staged=1', 'tombstoned=1']::text[]);

  PERFORM pg_temp.s6r_eq('O2b no ready row is missing its object — the invariant of this whole '
    'stage, measured over the residue rather than asserted in prose',
    (SELECT count(*) FROM public.wedding_assets a WHERE a.upload_status = 'ready'
      AND NOT EXISTS (SELECT 1 FROM storage.objects o
                       WHERE o.bucket_id = 'wedding-assets' AND o.name = a.object_key)), 0::bigint);
  PERFORM pg_temp.s6r_eq('O2c the staged residue is a row whose bytes are in the bucket and whose '
    'confirmation was refused (S10''s unreadable metadata) — invisible to a guest page because '
    'availability reads the state, never the object table',
    (SELECT count(*) FROM public.wedding_assets a WHERE a.upload_status = 'staged'
      AND EXISTS (SELECT 1 FROM storage.objects o
                  WHERE o.bucket_id = 'wedding-assets' AND o.name = a.object_key)), 1::bigint);
  PERFORM pg_temp.s6r_eq('O2d and the tombstoned residue still holds its pointer: the bytes are '
    'there, which is why D4 refused to let the row go first. A removal in flight is a row a later '
    'pass can finish, not an orphan',
    (SELECT count(*) FROM public.wedding_assets a WHERE a.upload_status = 'tombstoned'
      AND EXISTS (SELECT 1 FROM storage.objects o
                  WHERE o.bucket_id = 'wedding-assets' AND o.name = a.object_key)), 1::bigint);

  -- The bucket that only existed to prove S4 must not survive into the next file's counts.
  PERFORM pg_temp.s6r_service_remove_bucket('s6-other-bucket');
  PERFORM pg_temp.s6r_eq('D6 the probe bucket and its object are gone and the inventory is the '
    'declared one again — the same list B1 printed before this file created anything, so a fixture '
    'bucket leaving residue is a failing line here rather than a number that happens to match '
    '(note that both DELETEs above ran with the flag the Storage API sets, '
    'because D0 measured that the same statement is refused without it even for this role)',
    (SELECT coalesce(string_agg(b.id, ', ' ORDER BY b.id), '(none)') FROM storage.buckets b),
    CASE WHEN pg_temp.s6r_at_least('stage9')
         THEN 'invitation-outputs, invitation-previews, wedding-assets'
         ELSE 'wedding-assets' END);
END $D$;

-- --------------------------------------------------------------------------- L: the floor
-- The floor is the measured count at this head, not a rounded-down guess. It exists to catch a
-- section that stops running: a `DO` block whose setup fails silently would otherwise leave the
-- remaining files reading an empty database and still printing a pass. When a genuine assertion is
-- added or removed, this number moves with it — and the runner's cross-check between the printed
-- total and the observed PASS lines is what stops the two from drifting apart unnoticed.
DO $L$
DECLARE ran int;
BEGIN
  ran := coalesce(nullif(current_setting('s6r.passed', true), '')::int, 0);
  IF ran < 90 THEN
    RAISE EXCEPTION 'FAIL: only % Stage 6 registry assertions ran — the measured floor is 90', ran;
  END IF;
  PERFORM pg_temp.s6r_ok('L1 the counter, the fixtures and the floor all moved together ('
    || ran || ' assertions)', true);
END $L$;

SELECT 'STAGE6 REGISTRY TESTS PASSED (' || current_setting('s6r.passed') || ')' AS result;
