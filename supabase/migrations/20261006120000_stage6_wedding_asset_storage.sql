-- Stage 6 / file 1 — wedding media in Storage, with the registry as the only source of truth.
--
-- Three things about the running storage schema shaped this file, and each was measured on
-- `localvivaahvarnam` with CLI 2.119.0 / storage-api v1.79.28 rather than taken from the docs:
-- the service writes `storage.objects` while impersonating `authenticated`, so the client roles
-- keep table-level DML and only RLS stands between them and another wedding's bytes; `Stage 2
-- catalog assertions C18/C19 scan `pg_policy` across *every* schema, so a policy aimed at
-- `service_role` or a RESTRICTIVE one would fail the historic gate rather than pass it quietly;
-- and `storage.protect_delete()` already refuses direct DELETE against these tables unless a
-- service-only GUC is set. The rules below therefore add policies, never revocations, and never
-- touch the storage tables from SQL.
--
-- A second round of measurements shaped the `ready` edge and the ownership tests, because both were
-- carried over from the design note as assumptions: an upload made with a real user's JWT writes
-- `owner` *and* `owner_id` as that subject (one made with the service key writes neither, which is
-- why the policy is only meaningful for the browser path), and the service records the stored type
-- and length under `metadata->>'mimetype'` and `metadata->>'size'`. An overwrite attempt against a
-- live key was refused with `new row violates row-level security policy` — the missing UPDATE policy
-- is a fact, not a hope.

-- ===========================================================================
-- 1. The bucket. One private bucket for the whole product, created as code.
-- ===========================================================================

-- `public`, `file_size_limit` and `allowed_mime_types` are set here because a bucket that exists
-- only after someone clicks in Studio is a bucket that no migration can prove. The lifecycle
-- columns stay NULL on purpose: `storage.protect_bucket_control_columns()` reserves them for
-- members of the storage service role, so retention is this registry's business (see the
-- `tombstoned` state), not a bucket configuration this file could half-declare.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wedding-assets',
  'wedding-assets',
  false,
  5242880, -- 5 MiB, refused by the bucket before any byte lands
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg']
  -- No image/svg+xml and no text/html, ever: the blueprint forbids rendering user-supplied
  -- markup, and refusing the type at the bucket is stronger than sanitising it later.
);

-- ===========================================================================
-- 2. Registry state: how far a row's claim about its bytes has actually been checked.
-- ===========================================================================

-- `staged` = a key was minted and nothing is claimed about bytes. `ready` = the object was found
-- at that exact key, in this bucket, owned by this account. `tombstoned` = removal has begun.
ALTER TABLE public.wedding_assets
  ADD COLUMN upload_status text NOT NULL DEFAULT 'staged'
    CHECK (upload_status IN ('staged', 'ready', 'tombstoned'));

-- ===========================================================================
-- 3. Key minting. The browser never supplies a path, so no layer has to validate one.
-- ===========================================================================

CREATE FUNCTION private.mint_wedding_asset_object_key() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A presented key is refused rather than normalised: accepting one and rewriting it would make
  -- "the client chose it" indistinguishable from "the client chose it and we changed it", and the
  -- whole invariant is that the second case never happens.
  IF NEW.object_key IS NOT NULL AND btrim(NEW.object_key) <> '' THEN
    RAISE EXCEPTION 'wedding_assets.object_key is minted by the database and cannot be supplied'
      USING ERRCODE = '42501', HINT = 'Omit object_key; read it back from the inserted row.';
  END IF;
  IF NEW.upload_status <> 'staged' THEN
    RAISE EXCEPTION 'a new wedding asset always starts as staged'
      USING ERRCODE = '42501', HINT = 'Confirm the upload to move the row to ready.';
  END IF;

  -- Four segments, no extension: the served type comes from the object metadata and this row's
  -- mime_type, so a file name can never disagree with what the bytes are. The last segment is the
  -- row's own id, which defaults before a BEFORE trigger runs, so the pair is unique by
  -- construction.
  NEW.object_key := 'weddings/' || NEW.wedding_id::text || '/' || NEW.asset_kind || '/' || NEW.id::text;
  RETURN NEW;
END;
$$;

-- Per-object, because it has to be: Stage 2's baseline records that `ALTER DEFAULT PRIVILEGES
-- ... REVOKE ... ON FUNCTIONS` is layered on top of the stored default list rather than replacing it,
-- so a function created here without its own REVOKE is executable by `anon`, `authenticated` and
-- `service_role` through PUBLIC — measured, before this line, as `anon_exec_mint=true`. A trigger
-- needs no EXECUTE from the role that writes the row, so the revoke costs the flow nothing.
REVOKE ALL ON FUNCTION private.mint_wedding_asset_object_key() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER wedding_assets_mint_object_key
  BEFORE INSERT ON public.wedding_assets
  FOR EACH ROW EXECUTE FUNCTION private.mint_wedding_asset_object_key();

-- ===========================================================================
-- 4. Registry transitions, and the one edge that reads Storage.
-- ===========================================================================

CREATE FUNCTION private.guard_wedding_asset_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  object_found boolean;
  object_owner_text text;
  object_mime text;
  object_size bigint;
  owner_text text;
BEGIN
  -- The key and its two identifying segments are immovable. Re-parenting a row to another wedding
  -- would silently move a family photograph between accounts while keeping every constraint it
  -- already satisfied, which is the failure this stage exists to make impossible.
  IF NEW.object_key IS DISTINCT FROM OLD.object_key THEN
    RAISE EXCEPTION 'wedding_assets.object_key is immutable once minted' USING ERRCODE = '42501';
  END IF;
  IF NEW.wedding_id IS DISTINCT FROM OLD.wedding_id THEN
    RAISE EXCEPTION 'a wedding asset cannot be re-parented to another wedding' USING ERRCODE = '42501';
  END IF;
  IF NEW.asset_kind IS DISTINCT FROM OLD.asset_kind THEN
    RAISE EXCEPTION 'asset_kind is part of the minted object key' USING ERRCODE = '42501';
  END IF;

  -- A write that moves no state is usually nothing this trigger is asked about. The exception is a
  -- `ready` row: its `mime_type` and `size_bytes` are claims about particular stored bytes, so
  -- re-describing them while the state stands still has to meet the same evidence the confirmation
  -- met. Without this, a row that was true at confirmation could be edited into a lie afterwards
  -- and keep being rendered, downloaded and re-offered on the false description.
  IF NEW.upload_status = OLD.upload_status THEN
    IF OLD.upload_status <> 'ready'
       OR (NEW.mime_type IS NOT DISTINCT FROM OLD.mime_type
           AND NEW.size_bytes IS NOT DISTINCT FROM OLD.size_bytes) THEN
      RETURN NEW;
    END IF;
  ELSE
    -- tombstoned is terminal: a row that began removal cannot claim availability again.
    IF OLD.upload_status = 'tombstoned' THEN
      RAISE EXCEPTION 'a tombstoned wedding asset cannot change state' USING ERRCODE = '42501';
    END IF;
    -- ready may only move forward to removal, never back to a key that was minted and unclaimed.
    IF OLD.upload_status = 'ready' AND NEW.upload_status <> 'tombstoned' THEN
      RAISE EXCEPTION 'a ready wedding asset may only be tombstoned' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.upload_status = 'ready' THEN
    -- SECURITY INVOKER on purpose. The role executing this is `authenticated`, which is exactly
    -- the role the read policy below is written for, so the confirmation sees the object only if
    -- the same account could see it through the API. A DEFINER function would look up bytes the
    -- caller has no policy for and turn this check into a privilege of its own.
    --
    -- `metadata->>'mimetype'` and `metadata->>'size'` are the two key spellings the service writes;
    -- both were read off a real authenticated upload on this stack (a 68-byte PNG produced
    -- `mimetype = image/png`, `size = 68`, `contentLength = 68`), not taken from a guide. The
    -- `size` cast is guarded by a digit test because a malformed metadata blob must refuse the
    -- confirmation, not abort the statement with a cast error the caller cannot distinguish from a
    -- policy refusal.
    SELECT true, owner_id,
           metadata ->> 'mimetype',
           CASE WHEN (metadata ->> 'size') ~ '^[0-9]+$'
                THEN (metadata ->> 'size')::bigint END
      INTO object_found, object_owner_text, object_mime, object_size
      FROM storage.objects
     WHERE bucket_id = 'wedding-assets' AND name = NEW.object_key;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no stored object exists at %', NEW.object_key USING ERRCODE = '42501';
    END IF;

    SELECT auth.uid()::text INTO owner_text;
    IF object_owner_text IS DISTINCT FROM owner_text THEN
      RAISE EXCEPTION 'the object at % is not owned by this account', NEW.object_key
        USING ERRCODE = '42501';
    END IF;

    -- A row that records `image/png` while the stored object is something else is a row that will
    -- be rendered, downloaded and re-offered on a false description, so the claim is checked
    -- against the bytes rather than trusted. Both are compared only when the row makes the claim:
    -- the columns are nullable for rows the product has not described yet, and "not claimed" is
    -- not the same as "claimed wrong".
    IF NEW.mime_type IS NOT NULL AND object_mime IS DISTINCT FROM NEW.mime_type THEN
      RAISE EXCEPTION 'the object at % is stored as %, but this row claims %',
        NEW.object_key, coalesce(object_mime, 'no recorded type'), NEW.mime_type
        USING ERRCODE = '42501';
    END IF;
    IF NEW.size_bytes IS NOT NULL AND object_size IS DISTINCT FROM NEW.size_bytes THEN
      RAISE EXCEPTION 'the object at % is % bytes, but this row claims %',
        NEW.object_key, coalesce(object_size::text, 'a size this build cannot read'), NEW.size_bytes
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Same per-object rule as the minting trigger above.
REVOKE ALL ON FUNCTION private.guard_wedding_asset_update() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER wedding_assets_guard_update
  BEFORE UPDATE ON public.wedding_assets
  FOR EACH ROW EXECUTE FUNCTION private.guard_wedding_asset_update();

-- A row is only ever deleted after its bytes are gone. Refusing while the object still resolves is
-- what keeps "the metadata row is gone" from becoming a pointer to un-collected bytes, and it makes
-- the crash windows observable as the two named orphan classes instead of an undefined state.
CREATE FUNCTION private.guard_wedding_asset_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  object_exists boolean;
BEGIN
  IF OLD.upload_status = 'ready' THEN
    RAISE EXCEPTION 'tombstone the asset before deleting the registry row' USING ERRCODE = '42501';
  END IF;

  SELECT true INTO object_exists FROM storage.objects
   WHERE bucket_id = 'wedding-assets' AND name = OLD.object_key;
  IF FOUND THEN
    RAISE EXCEPTION 'the object for % is still in storage; remove it first', OLD.object_key
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

-- Same per-object rule as the minting trigger above.
REVOKE ALL ON FUNCTION private.guard_wedding_asset_delete() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER wedding_assets_guard_delete
  BEFORE DELETE ON public.wedding_assets
  FOR EACH ROW EXECUTE FUNCTION private.guard_wedding_asset_delete();

-- ===========================================================================
-- 5. Storage policies. Ownership-bound, PERMISSIVE, and `authenticated` alone.
-- ===========================================================================

-- Read/preview: the caller owns the wedding, and a registry row pairs this exact key to it. A key
-- that merely has a valid shape yields nothing, because nothing claims it.
CREATE POLICY wedding_members_read_asset_objects ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'wedding-assets'
    AND (storage.foldername(name))[1] = 'weddings'
    AND EXISTS (
      SELECT 1 FROM public.weddings w
      JOIN public.wedding_assets a ON a.wedding_id = w.id
      WHERE w.owner_user_id = auth.uid()
        AND a.object_key = storage.objects.name
    )
  );

-- Upload: only into a key a staged row already claims for a wedding the caller owns, and only with
-- the object's own owner set to this account. This is the invariant that no unregistered object can
-- exist inside the wedding bucket.
CREATE POLICY wedding_members_upload_staged_asset_objects ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'wedding-assets'
    AND owner_id = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.weddings w
      JOIN public.wedding_assets a ON a.wedding_id = w.id
      WHERE w.owner_user_id = auth.uid()
        AND a.object_key = storage.objects.name
        AND a.upload_status = 'staged'
    )
  );

-- Delete: only a tombstoned row's object. There is deliberately no "no row ever claimed it" branch,
-- because without a row there is no owner to check, and an unowned-but-deletable object is a
-- guessed-key target. Orphan bytes are therefore not cleanable by any account in V1, which is the
-- honest shape of I6 given C18 (no service_role policy is admissible).
CREATE POLICY wedding_members_remove_tombstoned_asset_objects ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'wedding-assets'
    AND EXISTS (
      SELECT 1 FROM public.weddings w
      JOIN public.wedding_assets a ON a.wedding_id = w.id
      WHERE w.owner_user_id = auth.uid()
        AND a.object_key = storage.objects.name
        AND a.upload_status = 'tombstoned'
    )
  );

-- There is no UPDATE policy on storage.objects, and that is a design decision rather than an
-- omission: the Storage SDK's `upsert: true` needs INSERT + SELECT + UPDATE together, so refusing
-- to create the third makes in-place overwrite of a live key impossible at the database. Replacing
-- media is two registered objects and a tombstone.
