-- Stage 6 fixture: the Storage service's own schema, so an app migration can be applied to it.
--
-- Why a fixture at all. `storage.buckets` and `storage.objects` are created by the storage
-- service, not by anything in `supabase/migrations`, and the Stage 6 migration writes a bucket row
-- and defines policies on `storage.objects`. The qualification runners start a bare
-- `postgres:16-alpine` cluster, where that migration would stop on `relation "storage.buckets"
-- does not exist` — a runner that cannot reach the Stage 6 file is a runner that proves nothing
-- about it (audit §13.3). This file stands in for "the storage service created its tables first",
-- which is also the answer to §12.6's ordering question, measured on a real `supabase db reset`
-- and reproduced here by construction.
--
-- Provenance, because a fixture that invents platform behaviour is worse than no fixture: every
-- column, default, constraint, index, function body and trigger below was read out of the running
-- local stack (CLI 2.119.0, `storage-api:v1.79.28`) on 2026-10-06 with `pg_dump --schema-only` and
-- `pg_get_functiondef`, not written from documentation. The captured dumps are kept beside this
-- repository's Stage 6 logs.
--
-- What is NOT reproduced, and therefore what no Stage 6 SQL assertion may claim:
--   * The other eight `storage` tables (`migrations`, `s3_multipart_uploads*`, the analytics and
--     vector tables). Nothing in Stage 6 addresses them.
--   * Ownership. On the stack these tables belong to `supabase_storage_admin` and the migration
--     role `postgres` writes the bucket row because it holds BYPASSRLS (measured:
--     `rolbypassrls = true`, `rolsuper = false`). Here `postgres` is a superuser, which bypasses
--     RLS for the same reason, so the migration applies the same way — but a claim of the form
--     "the migration role was refused by a policy" is not reproducible in this fixture and is not
--     made. Every policy assertion below runs under `SET ROLE authenticated`, which has no bypass
--     on either cluster, and that is the role the browser's requests are evaluated as.
--   * `protect_bucket_lifecycle_service_role` and its AFTER UPDATE trigger. Stage 6 never writes a
--     lifecycle column, so the only half that matters — the INSERT path demanding NULL lifecycle —
--     is the BEFORE trigger reproduced here.
--   * The Storage API, and therefore bytes. An `INSERT` into `storage.objects` here represents the
--     metadata row the service would write on a successful upload; it does not upload anything, and
--     no assertion in this tier may read "the row exists" as "the object exists". The refusal of an
--     over-size or disallowed-MIME upload happens in the service, so it is measured in the HTTP
--     tier; what this tier can measure is the bucket's own recorded limits.

-- --------------------------------------------------------------------------- schema and enum
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TYPE storage.buckettype AS ENUM ('STANDARD', 'ANALYTICS', 'VECTOR');

-- --------------------------------------------------------------------------- buckets
CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL,
    versioning_status text DEFAULT 'DISABLED'::text NOT NULL,
    lifecycle_configuration jsonb,
    lifecycle_configuration_generation uuid,
    CONSTRAINT buckets_pkey PRIMARY KEY (id),
    CONSTRAINT buckets_lifecycle_configuration_pair_check
        CHECK (((lifecycle_configuration IS NULL) = (lifecycle_configuration_generation IS NULL))),
    CONSTRAINT buckets_lifecycle_configuration_standard_only_check
        CHECK (((type = 'STANDARD'::storage.buckettype)
                OR ((lifecycle_configuration IS NULL)
                    AND (lifecycle_configuration_generation IS NULL)))),
    CONSTRAINT buckets_versioning_dark_check CHECK ((versioning_status = 'DISABLED'::text)),
    CONSTRAINT buckets_versioning_standard_only_check
        CHECK (((type = 'STANDARD'::storage.buckettype) OR (versioning_status = 'DISABLED'::text))),
    CONSTRAINT buckets_versioning_status_check
        CHECK ((versioning_status = ANY (ARRAY['DISABLED'::text, 'ENABLED'::text, 'SUSPENDED'::text])))
);

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);

-- --------------------------------------------------------------------------- objects
-- `path_tokens` is a generated column on the real service, `name` is the key, and the current
-- version is the row where `archived_at IS NULL` — the three facts behind audit §12.5's ruling
-- that a `tombstoned` registry row says nothing about an object row.
CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb,
    archived_at timestamp with time zone,
    is_delete_marker boolean DEFAULT false NOT NULL,
    is_versioned boolean DEFAULT false NOT NULL,
    CONSTRAINT objects_pkey PRIMARY KEY (id),
    CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id)
);

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");
CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");
CREATE UNIQUE INDEX idx_objects_current_version ON storage.objects USING btree (bucket_id, name COLLATE "C")
    WHERE (archived_at IS NULL);
CREATE INDEX idx_objects_delete_markers ON storage.objects USING btree (bucket_id, name COLLATE "C")
    WHERE is_delete_marker;
CREATE UNIQUE INDEX idx_objects_null_version ON storage.objects USING btree (bucket_id, name COLLATE "C")
    WHERE (NOT is_versioned);
CREATE UNIQUE INDEX objects_bucket_id_name_version_key ON storage.objects
    USING btree (bucket_id, name COLLATE "C", version) NULLS NOT DISTINCT;
CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);

-- --------------------------------------------------------------------------- policy helpers
-- Reproduced verbatim, because Stage 6's read policy is written with `storage.foldername(name)`
-- and an inert helper would silently widen or narrow it.
CREATE FUNCTION storage.foldername(name text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$function$;

CREATE FUNCTION storage.filename(name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[array_length(_parts, 1)];
END
$function$;

CREATE FUNCTION storage.extension(name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$function$;

-- The operation GUC and the two comparators. Stage 6 ships no operation-scoped policy (§12.5.6),
-- so these exist for the fixture to be able to say what it declined to use — and so that a later
-- stage does not have to guess whether the names are spelled as the docs claim.
CREATE FUNCTION storage.operation()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
    RETURN current_setting('storage.operation', true);
END
$function$;

CREATE FUNCTION storage.allow_only_operation(expected_operation text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$function$;

CREATE FUNCTION storage.allow_any_operation(expected_operations text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$function$;

-- --------------------------------------------------------------------------- service guards
CREATE FUNCTION storage.protect_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END
$function$;

CREATE FUNCTION storage.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END
$function$;

CREATE FUNCTION storage.enforce_bucket_name_length()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$function$;

CREATE FUNCTION storage.protect_bucket_control_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  configuration_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_configuration IS NOT NULL
       OR NEW.lifecycle_configuration_generation IS NOT NULL THEN
      IF NOT pg_has_role(current_user, TG_ARGV[0], 'MEMBER') THEN
        RAISE EXCEPTION 'only members of the configured storage service role may insert lifecycle policy state'
          USING ERRCODE = '42501',
                HINT = format(
                  'Insert with both lifecycle columns NULL and configure lifecycle through the Storage API afterward, or insert as a member of %I.',
                  TG_ARGV[0]
                );
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  configuration_changed =
    OLD.lifecycle_configuration IS DISTINCT FROM NEW.lifecycle_configuration
    OR OLD.lifecycle_configuration_generation IS DISTINCT FROM NEW.lifecycle_configuration_generation;

  IF NOT configuration_changed THEN
    RETURN NEW;
  END IF;

  IF NEW.type IS DISTINCT FROM 'STANDARD' THEN
    RAISE EXCEPTION 'bucket versioning and lifecycle controls require a Standard bucket'
      USING ERRCODE = '0A000';
  END IF;

  IF NEW.lifecycle_configuration IS NULL
     AND NEW.lifecycle_configuration_generation IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.lifecycle_configuration IS NULL
     OR NEW.lifecycle_configuration_generation IS NULL
     OR OLD.lifecycle_configuration IS NOT DISTINCT FROM NEW.lifecycle_configuration
     OR OLD.lifecycle_configuration_generation IS NOT DISTINCT FROM NEW.lifecycle_configuration_generation THEN
    RAISE EXCEPTION 'a changed lifecycle policy requires a new non-null generation'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER enforce_bucket_name_length_trigger
    BEFORE INSERT OR UPDATE OF name ON storage.buckets
    FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();

CREATE TRIGGER protect_bucket_control_insert
    BEFORE INSERT ON storage.buckets
    FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns('service_role');

CREATE TRIGGER protect_bucket_control_update
    BEFORE UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets
    FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns();

CREATE TRIGGER protect_buckets_delete
    BEFORE DELETE ON storage.buckets
    FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

CREATE TRIGGER protect_objects_delete
    BEFORE DELETE ON storage.objects
    FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

CREATE TRIGGER update_objects_updated_at
    BEFORE UPDATE ON storage.objects
    FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();

-- --------------------------------------------------------------------------- security posture
-- RLS on, nothing forced, and zero policies: deny-by-default is the state the Stage 6 migration
-- adds its three policies to, measured on the stack rather than assumed.
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- The measured grant shape: the client roles hold table-level DML and only RLS stops them, and
-- `service_role` additionally holds the privileges a trusted backend needs. No Stage 6 assertion
-- may therefore be phrased as "the grant is missing" — see audit §12.5.1.
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON storage.buckets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON storage.objects TO service_role;
