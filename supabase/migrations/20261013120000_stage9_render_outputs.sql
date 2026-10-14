-- Stage 9 / file 1 — the render manifest and the two storage domains, both created as code.
--
-- Four facts were measured on `localvivaahvarnam` (CLI 2.119.0, engine 17.11.0) before a line below
-- was written, and each one decides something rather than decorating it:
--
--   * `service_role` has `rolbypassrls = t` on this engine while `authenticated`, `anon` and
--     `supabase_storage_admin` have `f`. So the render worker's writes — to this table and to
--     `storage.objects` — need no policy, and writing one anyway would fail Stage 2's C18 ("every
--     policy targets authenticated alone") instead of widening the surface quietly. It is the same
--     constraint Stage 6 records for its own bucket at
--     `20261006120000_stage6_wedding_asset_storage.sql:3-9`.
--   * a table created after the Stage 2 baseline is invisible to `anon` and `authenticated` and is
--     reached by the trusted backend with no grant statement at all (measured by C57/C58/C60), which
--     is why this file writes exactly one privilege line for the new table: the read.
--   * `invitation_versions` already carries `UNIQUE (wedding_id, id)`
--     (`20260925120200_stage2_versions_and_publication.sql:37`), so "an artefact of wedding A cannot
--     freeze wedding B's version" is one composite foreign key here, exactly as `publications` makes
--     it (`:76-81`), and C47 keeps every composite reference pinned that way.
--   * the storage service refuses a direct SQL DELETE against `storage.objects` unless its own
--     service GUC is set (`protect_objects_delete`, inventoried by C31 at the Stage 6 head). Every
--     object operation this stage performs therefore goes through the Storage API, and nothing below
--     touches `storage.objects` from SQL except the two read policies the browser roles need.
--
-- One number is deliberately absent: the page ceilings. `MAX_PDF_PAGES` and `MAX_SHARE_PAGES` live in
-- `src/render/outputGeometry.ts`, where the renderer counts the pages, and a second copy of a limit
-- in a CHECK is a limit that can disagree with itself. The database constrains which
-- (kind, variant, format) triples may exist at all; the worker decides how many pages a document
-- becomes.
--
-- `wedding_assets` is not modified. It models a file a host *uploaded* — no version link, no digest,
-- no output kind, no render config, and a lifecycle whose guard refuses everything but
-- `ready → tombstoned` (`20261006120000…:129-135`). A derived artefact has a different state machine
-- (`failed` and `invalidated` are states of it, not of a photograph), so it gets its own table and its
-- own policies rather than a widened CHECK on a qualified invariant set.

-- ===========================================================================
-- 1. The buckets. Two, because the two read paths are not the same trust relationship.
-- ===========================================================================

-- `invitation-outputs` holds every file the host downloads. It stays private and Stage 6's shape is
-- kept verbatim where it applies: `public = false`, the byte ceiling declared here rather than
-- discovered in Studio, and no SVG and no HTML in the allow-list, because the blueprint forbids
-- rendering host-authored markup and refusing the type at the bucket is stronger than sanitising it
-- later. The ceiling is 10 MiB rather than Stage 6's 5 MiB because a paginated Indic PDF with
-- embedded faces is a different object from a photograph, and a limit that refuses a legitimate
-- artefact is a limit the worker will be asked to route around.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invitation-outputs',
  'invitation-outputs',
  false,
  10485760,
  ARRAY['image/png', 'image/webp', 'application/pdf']
);

-- `invitation-previews` is the bucket an Open Graph crawler would read, and this migration creates it
-- *closed*. The two facts that make it unreachable today are both measured rather than chosen for
-- symmetry: the bucket is `public = false`, and a policy admitting `anon` is not admissible at all,
-- because C18 fails any policy that does not target `authenticated` alone. So a preview object written
-- here cannot be fetched by anybody, which is the correct default until the published-preview consent
-- decision is made — that decision is a product question (`docs/superpowers/specs/
-- 2026-10-13-stage9-render-exports-design.md` §10.3), not a migration, and §14 lists it as unverified.
--
-- It is created now anyway, for the reason Stage 6 gives at `:19-22`: a bucket that exists only after
-- someone clicks in Studio is a bucket no migration can prove, and the *key shape* the manifest
-- enforces below (`p/<43 opaque chars>`, containing no wedding, version, row or user identifier) is
-- only meaningful if there is a domain to mint it for. Flipping consent later changes this bucket's
-- `public` flag and adds nothing to its policies; it does not change the schema.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invitation-previews',
  'invitation-previews',
  false,
  1048576,
  ARRAY['image/png', 'image/webp']
);

-- The lifecycle columns stay NULL on both, as they do for `wedding-assets`:
-- `storage.protect_bucket_control_columns()` reserves them for the storage service role, so retention
-- is this registry's business (the `invalidated` state below), not a bucket setting half-declared here.

-- ===========================================================================
-- 2. The manifest. One row per artefact, and no copy of the document in it.
-- ===========================================================================

-- The row holds ids, digests and states. `snapshot` is never duplicated: a second copy of the
-- invitation would be a second thing to keep in sync with the version it claims to render, and the
-- whole reproducibility claim is that the artefact and the guest page came from one document.
CREATE TABLE public.invitation_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NO ACTION, for the reason `invitation_versions` and `publications` both give: an FK cascade runs
  -- as the child table's owner, so no guard trigger could see it, and an artefact's history must not
  -- vanish unremarkably with the aggregate it belongs to.
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE NO ACTION,
  version_id uuid NOT NULL,
  -- Which deliverable this row is. The page size is a `variant`, never a second kind, so no fact is
  -- encoded twice and `og_image` cannot acquire a geometry its name does not imply.
  output_kind text NOT NULL
    CHECK (output_kind IN ('og_image', 'share_image', 'pdf', 'qr')),
  -- The finite box set the renderer itself offers (1200x630 for the teaser; the four share heights
  -- over the 1080-wide column; the two papers; the three print sizes for a QR). Anything else is a
  -- refusal at the database rather than a row that describes a geometry nothing produced.
  variant text NOT NULL
    CHECK (variant IN ('1200x630', '1080x1350', '1080x1620', '1080x1800', '1080x2160',
                       'a4', 'letter', '25mm', '40mm', '60mm')),
  -- Orthogonal to geometry: the same 1200x630 exists as PNG and as WebP.
  format text NOT NULL CHECK (format IN ('png', 'webp', 'pdf')),
  page_number integer NOT NULL DEFAULT 1 CHECK (page_number > 0),
  -- SHA-256 over the pinned render configuration (stylesheet hash, font-manifest hash, box, device
  -- pixel ratio, browser version, renderer source hash). It is part of the uniqueness key below, so
  -- "this artefact predates that change" is a query rather than a guess, which is how §13's
  -- staleness answer is given with evidence.
  render_config_hash text NOT NULL CHECK (render_config_hash ~ '^[0-9a-f]{64}$'),
  -- SHA-256 of the exact DTO bytes that were rendered: the proof that the artefact and the guest page
  -- read one document. Immutable, because it is a statement about what happened, not about state.
  source_dto_digest text NOT NULL CHECK (source_dto_digest ~ '^[0-9a-f]{64}$'),
  -- SHA-256 of the produced bytes, recorded when the worker has re-fetched them. NULL until then.
  content_digest text CHECK (content_digest IS NULL OR content_digest ~ '^[0-9a-f]{64}$'),
  -- The QR's input string, hashed. The raw address is never stored anywhere in this table: the
  -- credential store keeps only its own digest (`private.access_tokens.token_hash`), so no function
  -- could reconstruct the URL and none is written for this row either. A digest is what makes the
  -- printed sheet comparable against a live credential without holding it.
  target_url_digest text CHECK (target_url_digest IS NULL OR target_url_digest ~ '^[0-9a-f]{64}$'),
  object_key text NOT NULL UNIQUE,
  -- The two security domains are a column, not an assumption about a bucket name.
  storage_domain text NOT NULL CHECK (storage_domain IN ('host_private', 'published_preview')),
  -- Failure, retry and invalidation are states of the artefact rather than absences of a row.
  status text NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'uploading', 'ready', 'failed', 'invalidated')),
  invalidation_reason text
    CHECK (invalidation_reason IS NULL OR invalidation_reason IN
           ('superseded', 'token_rotated', 'publication_revoked', 'asset_deleted')),
  -- Recorded failures, bounded: reaching the ceiling is a visible stuck state, not a silent loop.
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 5),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  invalidated_at timestamptz,
  -- The immutability anchor: the version this artefact was drawn from, pinned to the same wedding by
  -- the composite key, so a row cannot be re-parented between either.
  FOREIGN KEY (wedding_id, version_id)
    REFERENCES public.invitation_versions(wedding_id, id) ON DELETE NO ACTION,
  -- One artefact per (version, kind, geometry, format, page, config). This is the determinism key: a
  -- re-render under a *changed* config is a new row rather than an overwrite, and §12's "the older
  -- one becomes invalidated/superseded" is then a queryable fact about two rows.
  UNIQUE (version_id, output_kind, variant, format, page_number, render_config_hash),
  -- Every kind has exactly one geometry family and exactly one set of encodings. Stated as one
  -- constraint so the four-way table is readable in one place, and so a `pdf` row claiming a teaser
  -- box or a PNG row claiming `application/pdf` is impossible rather than discouraged.
  CONSTRAINT invitation_outputs_render_shape CHECK (
    (output_kind = 'og_image'      AND variant = '1200x630'                                 AND format IN ('png', 'webp'))
    OR (output_kind = 'share_image' AND variant IN ('1080x1350', '1080x1620', '1080x1800', '1080x2160') AND format IN ('png', 'webp'))
    OR (output_kind = 'pdf'         AND variant IN ('a4', 'letter')                        AND format = 'pdf')
    OR (output_kind = 'qr'          AND variant IN ('25mm', '40mm', '60mm')                AND format = 'png')
  ),
  -- `ready` means the bytes were fetched back and hashed. `invalidated` shares the evidence, because
  -- a retired artefact has to keep the digest it was verified at — §13's answer to "is this
  -- artefact still the current document?" reads the stored digest, and a superseded row that lost it
  -- would make the comparison impossible. So the pair of states holds the digest, and the three
  -- pre-ready states may not claim one.
  CONSTRAINT invitation_outputs_ready_evidence
    CHECK ((status IN ('ready', 'invalidated')) = (content_digest IS NOT NULL)),
  CONSTRAINT invitation_outputs_ready_at
    CHECK ((status IN ('ready', 'invalidated')) = (ready_at IS NOT NULL)),
  -- Invalidation is a fact with a timestamp and a reason, and it is terminal (the guard below).
  CONSTRAINT invitation_outputs_invalidation
    CHECK ((status = 'invalidated') = (invalidated_at IS NOT NULL)),
  CONSTRAINT invitation_outputs_invalidation_reason
    CHECK ((status = 'invalidated') = (invalidation_reason IS NOT NULL)),
  CHECK (invalidated_at IS NULL OR ready_at IS NULL OR invalidated_at >= ready_at),
  -- A QR is only a QR if it records what it points at; nothing else may record it.
  CONSTRAINT invitation_outputs_qr_target
    CHECK ((output_kind = 'qr') = (target_url_digest IS NOT NULL)),
  -- The two domains and the two key shapes are the same fact seen from either side, so a row cannot
  -- sit in the published domain carrying a private key (or the reverse) even for one statement.
  CONSTRAINT invitation_outputs_domain_shape CHECK (
    (storage_domain = 'host_private'     AND object_key LIKE 'outputs/%')
    OR (storage_domain = 'published_preview' AND object_key ~ '^p/[A-Za-z0-9_-]{43}$')
  ),
  -- Stage 6's key discipline restated: never absolute, never a traversal, whatever the minting trigger
  -- is handed. The trigger is the first line of defence and this is the one that survives it being
  -- edited.
  CHECK (object_key NOT LIKE '/%'),
  CHECK (object_key NOT LIKE '%..%'),
  -- Only the teaser is ever published. A share image, a PDF and above all a QR carry either the
  -- whole invitation at print quality or a bearer credential, and the published domain is read by
  -- whoever can fetch a URL — so the domain itself refuses those kinds.
  CONSTRAINT invitation_outputs_preview_is_og_only
    CHECK (storage_domain <> 'published_preview' OR output_kind = 'og_image'),
  -- A row that has failed at least once keeps the sentence about why, even after a retry succeeds:
  -- the count and the reason are one piece of evidence, not two.
  CHECK (attempt_count = 0 OR last_error IS NOT NULL)
);

-- Leads with `wedding_id` for the policy predicate (C50) and covers both foreign keys, so this table
-- adds nothing to C48's closed set of accepted unindexed references.
CREATE INDEX invitation_outputs_wedding_version_idx
  ON public.invitation_outputs (wedding_id, version_id);

-- The same tuple from the artefact's own side: the panel asks "what exists for this version", and the
-- uniqueness key leads with `version_id` so it serves that too. Indexing it is the difference between
-- a listed manifest and a scan of every artefact the product has ever made.
CREATE INDEX invitation_outputs_version_idx
  ON public.invitation_outputs (version_id, output_kind, variant, format, page_number);

COMMENT ON TABLE public.invitation_outputs IS
  'The render manifest: one row per derived artefact of one immutable invitation version. Holds ids, '
  'digests and lifecycle state; never the document, never a raw credential, never a URL. Written by '
  'the trusted backend only (trigger guard), read by the wedding''s owner through one policy.';

-- ===========================================================================
-- 3. Key minting. No layer of this product ever validates a path, because none receives one.
-- ===========================================================================

CREATE FUNCTION private.mint_invitation_output_key() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  -- Refused rather than normalised, for Stage 6's reason (`20261006120000…:60-66`): accepting a
  -- presented key and rewriting it would make "the client chose it" indistinguishable from "the
  -- client chose it and we changed it", and the invariant is that the second case never happens.
  IF NEW.object_key IS NOT NULL AND btrim(NEW.object_key) <> '' THEN
    RAISE EXCEPTION 'invitation_outputs.object_key is minted by the database and cannot be supplied'
      USING ERRCODE = '42501', HINT = 'Omit object_key; read it back from the inserted row.';
  END IF;

  -- Registration is the only state a row can be born in, and it claims nothing about bytes.
  IF NEW.status <> 'registered' THEN
    RAISE EXCEPTION 'a new invitation output always starts as registered'
      USING ERRCODE = '42501', HINT = 'Move the row through uploading to ready.';
  END IF;
  IF NEW.content_digest IS NOT NULL OR NEW.ready_at IS NOT NULL
     OR NEW.invalidated_at IS NOT NULL OR NEW.attempt_count <> 0 THEN
    RAISE EXCEPTION 'a registered output cannot carry evidence of bytes it has not produced'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.storage_domain = 'published_preview' THEN
    -- 256 bits of server randomness, base64url without padding — the same 43-character shape the
    -- invitation and guest credentials use (`20260926130000…:515`, `20261009120000…:451`), chosen
    -- because it is not enumerable and because the shape is already measured on this stack.
    --
    -- Not content-addressed, although the design says "content-addressed": the digest of the bytes
    -- does not exist when the row is inserted (the key is minted before anything is rendered), and
    -- writing it afterwards would mutate an identity column that the guard below has just declared
    -- immutable. The property §8 actually wants is delivered by the row, not by the spelling of the
    -- key: a re-render is a new row, so it is a new key, so a cache holding yesterday's image cannot
    -- be handed it today — it becomes an unavailable image, which is the safer half of the same
    -- answer.
    NEW.object_key := 'p/' ||
      rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  ELSE
    -- Four segments plus the row's own id, no extension: the served type comes from the object
    -- metadata and this row's `format`, so a file name can never disagree with what the bytes are.
    -- The last segment is unique by construction, which is why a PNG and a WebP of the same box do
    -- not collide.
    NEW.object_key := 'outputs/' || NEW.wedding_id::text || '/' || NEW.output_kind || '/'
      || NEW.variant || '/' || NEW.id::text;
  END IF;

  RETURN NEW;
END;
$$;

-- Per-object, because Stage 2 measured that no default-privilege setting removes the implicit
-- EXECUTE-to-PUBLIC on a created function (`20260925120000…:57-91`). A trigger needs no EXECUTE from
-- the role that writes the row, so the revoke costs the flow nothing — and leaving it off would put
-- this name in `anon`'s executable set and fail C28a.
REVOKE ALL ON FUNCTION private.mint_invitation_output_key() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER invitation_outputs_mint_object_key
  BEFORE INSERT ON public.invitation_outputs
  FOR EACH ROW EXECUTE FUNCTION private.mint_invitation_output_key();

-- ===========================================================================
-- 4. The lifecycle. Six edges, one terminal state, and no identity that moves.
-- ===========================================================================

CREATE FUNCTION private.guard_invitation_output_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  -- Everything that describes *what this artefact is* is immovable once registered. Re-parenting a
  -- row to another version would leave a rendered file claiming to be a document it was never drawn
  -- from, and the digest recorded against it would be true of the wrong bytes — a lie that every
  -- downstream determinism check would then inherit.
  IF NEW.wedding_id IS DISTINCT FROM OLD.wedding_id THEN
    RAISE EXCEPTION 'an invitation output cannot be re-parented to another wedding' USING ERRCODE = '42501';
  END IF;
  IF NEW.version_id IS DISTINCT FROM OLD.version_id THEN
    RAISE EXCEPTION 'an invitation output is bound to the version it was rendered from' USING ERRCODE = '42501';
  END IF;
  IF NEW.output_kind IS DISTINCT FROM OLD.output_kind
     OR NEW.variant IS DISTINCT FROM OLD.variant
     OR NEW.format IS DISTINCT FROM OLD.format
     OR NEW.page_number IS DISTINCT FROM OLD.page_number THEN
    RAISE EXCEPTION 'the kind, geometry, format and page are part of the uniqueness key' USING ERRCODE = '42501';
  END IF;
  IF NEW.render_config_hash IS DISTINCT FROM OLD.render_config_hash THEN
    RAISE EXCEPTION 'render_config_hash is the key half that makes a stale artefact detectable' USING ERRCODE = '42501';
  END IF;
  IF NEW.source_dto_digest IS DISTINCT FROM OLD.source_dto_digest THEN
    RAISE EXCEPTION 'source_dto_digest records what was rendered and cannot be rewritten' USING ERRCODE = '42501';
  END IF;
  IF NEW.target_url_digest IS DISTINCT FROM OLD.target_url_digest THEN
    RAISE EXCEPTION 'target_url_digest records what a QR pointed at and cannot be rewritten' USING ERRCODE = '42501';
  END IF;
  IF NEW.object_key IS DISTINCT FROM OLD.object_key THEN
    RAISE EXCEPTION 'invitation_outputs.object_key is immutable once minted' USING ERRCODE = '42501';
  END IF;
  IF NEW.storage_domain IS DISTINCT FROM OLD.storage_domain THEN
    RAISE EXCEPTION 'an artefact cannot be moved between the private and published storage domains' USING ERRCODE = '42501';
  END IF;

  -- A write that moves no state may move no evidence either. Without this, a `ready` row whose
  -- digest was earned by a verified fetch could be re-described afterwards — the same failure Stage 6
  -- closes for `mime_type` and `size_bytes` at `20261006120000…:112-122`, and here it would be a
  -- determinism claim rather than a description.
  IF NEW.status = OLD.status THEN
    IF NEW.content_digest IS DISTINCT FROM OLD.content_digest
       OR NEW.ready_at IS DISTINCT FROM OLD.ready_at
       OR NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at
       OR NEW.invalidation_reason IS DISTINCT FROM OLD.invalidation_reason
       OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
       OR NEW.last_error IS DISTINCT FROM OLD.last_error THEN
      RAISE EXCEPTION 'a write that changes no status may change no evidence either' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'invalidated' THEN
    RAISE EXCEPTION 'an invalidated invitation output is terminal' USING ERRCODE = '42501';
  END IF;
  -- `ready` may only be retired, never re-opened and never sent back to a state that claims no bytes.
  IF OLD.status = 'ready' AND NEW.status <> 'invalidated' THEN
    RAISE EXCEPTION 'a ready invitation output may only be invalidated' USING ERRCODE = '42501';
  END IF;
  -- The remaining forward edges, each named, so an edge nobody designed reports itself as the
  -- sentence below rather than as a state a later reader has to reverse-engineer.
  IF NOT (
       (OLD.status = 'registered' AND NEW.status = 'uploading')
    OR (OLD.status = 'uploading' AND NEW.status IN ('ready', 'failed'))
    OR (OLD.status = 'failed'    AND NEW.status IN ('uploading', 'invalidated'))
    OR (OLD.status = 'ready'     AND NEW.status = 'invalidated')
  ) THEN
    RAISE EXCEPTION 'no edge registered → % → % exists in the output lifecycle', OLD.status, NEW.status
      USING ERRCODE = '42501',
            HINT = 'registered -> uploading -> ready | uploading -> failed -> (retry | invalidate) | ready -> invalidated';
  END IF;

  -- The two instants belong to the database. A worker that supplied its own clock could make a
  -- superseded artefact look newer than the row that replaced it, which is the one comparison §13
  -- depends on. Same posture as `private.touch_updated_at()`.
  IF NEW.status = 'ready' THEN
    NEW.ready_at := now();
    IF NEW.content_digest IS NULL THEN
      RAISE EXCEPTION 'a row may not become ready without the digest of the bytes it produced'
        USING ERRCODE = '42501', HINT = 'Fetch the object back and hash it first.';
    END IF;
  ELSIF NEW.status = 'invalidated' THEN
    NEW.invalidated_at := now();
    -- Retiring a row that never became ready is not an invalidation, it is the absence of an artefact,
    -- and `invitation_outputs_ready_evidence` above already refuses the pair. `failed` is where such a
    -- row stays, as visible retry evidence; a trusted cleanup removes it outright.
    IF OLD.status = 'failed' AND OLD.content_digest IS NULL THEN
      RAISE EXCEPTION 'a failed output with no stored bytes is removed rather than invalidated'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A retry may not silently reset the evidence of the attempt before it, and entering `failed` is
  -- exactly one recorded attempt plus one named reason.
  IF NEW.status = 'failed' THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1 THEN
      RAISE EXCEPTION 'entering failed records exactly one attempt' USING ERRCODE = '42501';
    END IF;
    IF NEW.last_error IS NULL THEN
      RAISE EXCEPTION 'a failure must name its reason' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count THEN
    RAISE EXCEPTION 'attempt_count moves only when a failure is recorded' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_invitation_output_update() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER invitation_outputs_guard_update
  BEFORE UPDATE ON public.invitation_outputs
  FOR EACH ROW EXECUTE FUNCTION private.guard_invitation_output_update();

-- A row is only ever removed after the bytes it points at are gone. `invalidated` is the state that
-- proves the object was deleted (delete-then-mark, §12 of the design), so erasing a `ready` row would
-- turn "the manifest no longer lists it" into a pointer to un-collected bytes. The refusal is
-- role-agnostic on purpose: Stage 6 reaches the same conclusion for the same reason at
-- `20261006120000…:196-223`, and a leak is easier to find when no identity can create one.
CREATE FUNCTION private.guard_invitation_output_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'ready' THEN
    RAISE EXCEPTION 'invalidate the output before deleting its manifest row' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'uploading' THEN
    RAISE EXCEPTION 'an output with an upload in flight is not deletable; let it reach ready or failed'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_invitation_output_delete() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER invitation_outputs_guard_delete
  BEFORE DELETE ON public.invitation_outputs
  FOR EACH ROW EXECUTE FUNCTION private.guard_invitation_output_delete();

-- Named `set_updated_at`, not `<table>_set_updated_at`, and that is not a style choice: catalogue
-- assertion C37 decides whether a table that has an `updated_at` column is kept honest by reading the
-- trigger's *name* and the function behind it, so a prefixed twin of the house trigger would leave the
-- column maintained and the inventory blind. Same-name-order rule as every other guarded table: this
-- fires after `invitation_outputs_guard_update` on an UPDATE, so the timestamp is touched only on a
-- transition the guard let through.
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.invitation_outputs
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- ===========================================================================
-- 5. Privileges and row-level security: readable by its wedding's owner, writable by nobody's browser.
-- ===========================================================================

-- No client role gets INSERT, UPDATE or DELETE: the manifest is the record of what the product made,
-- and a host's session that could set `status` or `content_digest` could mark an artefact verified
-- without a byte of evidence. `service_role` reaches the table through the Stage 2 default-privilege
-- posture (C60 measures that it does so without a grant statement), which is why the two guard
-- triggers above are the whole story for clients and the write guard below is a backstop.
GRANT SELECT ON public.invitation_outputs TO authenticated;

ALTER TABLE public.invitation_outputs ENABLE ROW LEVEL SECURITY;

-- The ownership predicate is the canonical shape (C25b): this row's own `wedding_id`, resolved through
-- `weddings`, with no join chain and no read of the table being decided about.
CREATE POLICY owners_read_own_invitation_outputs ON public.invitation_outputs
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.weddings w
    WHERE w.id = invitation_outputs.wedding_id AND w.owner_user_id = auth.uid()));

-- The backstop, not the boundary: a browser role has no write grant here, so it cannot name a write
-- that reaches this trigger. It exists because a later `GRANT INSERT ... TO authenticated` added for
-- convenience would otherwise be the only line of defence (`invitation_versions` and `publications`
-- take the same position at `20260925120200…:50-54` and `:105-110`).
CREATE TRIGGER invitation_outputs_no_client_write BEFORE INSERT OR UPDATE
  ON public.invitation_outputs FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();

CREATE TRIGGER invitation_outputs_no_client_delete BEFORE DELETE
  ON public.invitation_outputs FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

-- ===========================================================================
-- 6. Storage policies: the host's read of their own artefacts, and nothing else.
-- ===========================================================================

-- The signed download URL the panel mints is minted by the host's own session, so the storage service
-- evaluates this policy as `authenticated` — the same mechanism Stage 6 measured for uploaded media.
-- A key that merely has a valid shape yields nothing, because nothing in the registry claims it for a
-- wedding this caller owns.
CREATE POLICY wedding_members_read_output_objects ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'invitation-outputs'
    AND EXISTS (
      SELECT 1 FROM public.weddings w
      JOIN public.invitation_outputs o ON o.wedding_id = w.id
      WHERE w.owner_user_id = auth.uid()
        AND o.object_key = storage.objects.name
    )
  );

-- `invitation-outputs` gets no INSERT, UPDATE or DELETE policy, and each absence is a decision:
-- uploads are the worker's, made as `service_role`, which holds `rolbypassrls = t` on this engine —
-- so a policy would not be honoured by the role that needs it and would fail C18 for trying
-- (Stage 6's identical finding, `20261006120000…:4-9`). Removal goes through the Storage API for the
-- same reason. And `invitation-previews` gets no policy at all, which is what §1 says it means:
-- nothing is readable from it until the published-preview consent is decided.

-- ===========================================================================
-- 7. The two privileged bodies.
-- ===========================================================================

-- `internal_api` is not served by PostgREST (`supabase/config.toml:32` lists `public` and `api`), so
-- these bodies are unreachable as request bodies while their one-line wrappers beside them are the
-- callable surface. That is the layout Stage 3 fixed and Stages 4-8 followed.

-- The render worker's authorised source: the public projection of exactly one frozen version, for a
-- caller who owns that version's wedding.
--
-- It is a separate function from `api.preview_invitation` and from `api.preview_invitation_document`
-- for one reason that decides the whole determinism story: both of those resolve the *live* draft
-- through `private.build_invitation_snapshot`, so calling either from a worker would render whatever
-- the host had typed most recently and stamp it with a version id. The artefact and the guest page
-- have to be drawn from one document, and the only document that cannot move is the frozen row.
CREATE FUNCTION internal_api.render_invitation_document(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner   uuid;
  v_wedding uuid;
  v_schema  integer;
  v_snap    jsonb;
  v_dto     jsonb;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.owner_user_id = v_owner
          AND w.id = (SELECT v.wedding_id FROM public.invitation_versions v WHERE v.id = p_version_id)) THEN
    RAISE EXCEPTION 'the caller may not render this version'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The version's own schema declaration is passed through, not assumed: a version frozen at an older
  -- snapshot shape must still render the document it froze, and `private.public_invitation_dto` is the
  -- function that knows the difference between "an older shape" and "not a shape at all".
  SELECT v.wedding_id, v.snapshot_schema_version, v.snapshot
    INTO v_wedding, v_schema, v_snap
    FROM public.invitation_versions v
   WHERE v.id = p_version_id;
  IF NOT FOUND THEN
    -- The same sentence for "no such version" and "not yours", which is one refusal rather than an
    -- existence oracle over a uuid the caller picked.
    RAISE EXCEPTION 'the caller may not render this version'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_dto := private.public_invitation_dto(v_schema, v_snap);
  IF v_dto IS NULL THEN
    RAISE EXCEPTION 'this version cannot be rendered as it is currently shaped'
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN v_dto;
END;
$$;

REVOKE ALL ON FUNCTION internal_api.render_invitation_document(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.render_invitation_document(uuid) TO authenticated;

-- The manifest, in the vocabulary the panel prints. Three things are deliberately not in any element:
-- `object_key` (a path is not a delivery mechanism — the client asks for a signed URL through the
-- same Storage path Stage 6 already uses), `target_url_digest` (it identifies a live credential's
-- target, and the panel has no use for a comparison it cannot complete), and the row's `wedding_id`
-- (the caller named the wedding to get here).
CREATE FUNCTION internal_api.list_invitation_outputs(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_out   jsonb;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not read this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb
              ORDER BY x.output_kind, x.variant, x.format, x.page_number, x.created_at, x.id),
           '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT o.id, o.version_id, o.output_kind, o.variant, o.format, o.page_number,
             o.status, o.content_digest, o.render_config_hash, o.storage_domain,
             o.ready_at, o.invalidation_reason, o.attempt_count, o.last_error, o.created_at
        FROM public.invitation_outputs o
       WHERE o.wedding_id = p_wedding_id
    ) x;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION internal_api.list_invitation_outputs(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.list_invitation_outputs(uuid) TO authenticated;

-- ===========================================================================
-- 8. The exposed wrappers — each one line of delegation
-- ===========================================================================
-- `SECURITY INVOKER` is the default and is written out anyway, because the two postures being
-- readable side by side from the catalog is the point (it is what C26b and C26f assert), and
-- `SET search_path = ''` on a body that only delegates is what stops a caller steering which schema
-- the delegation resolves through. No authorization is duplicated here: each wrapper's only decision
-- is which implementation to hand its arguments to.
--
-- Both are granted to `authenticated` alone. The anonymous surface stays at the five doors Stages 3,
-- 7 and 8 opened, which is the claim C28a measures by name: an unauthenticated caller can neither
-- read a wedding's manifest nor ask the database for the document behind someone else's version id.

CREATE OR REPLACE FUNCTION api.render_invitation_document(p_version_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.render_invitation_document(p_version_id);
$$;

CREATE OR REPLACE FUNCTION api.list_invitation_outputs(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.list_invitation_outputs(p_wedding_id);
$$;

-- Re-issued explicitly rather than inherited: `CREATE OR REPLACE` keeps a function's existing ACL
-- instead of recomputing it, and a reader of this file should not have to know which grants came from
-- an earlier migration. `service_role` is absent from both halves on purpose — it has no USAGE on
-- `api` or `internal_api`, and it is not a browser, so it does not need a browser's door to write the
-- table it already has grants on.
REVOKE ALL ON FUNCTION api.render_invitation_document(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.render_invitation_document(uuid) TO authenticated;

REVOKE ALL ON FUNCTION api.list_invitation_outputs(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.list_invitation_outputs(uuid) TO authenticated;

COMMENT ON FUNCTION internal_api.render_invitation_document(uuid) IS
  'SECURITY DEFINER. The public projection of one frozen invitation version, for the owner of the '
  'wedding that version belongs to. Reads the version''s own snapshot rather than the live draft, '
  'which is the difference between rendering a document and rendering a keystroke. Refuses a caller '
  'who may not read it with `insufficient_privilege`, and refuses a version whose snapshot shape this '
  'build cannot project; it never returns a substitute for either. No field appears here that the '
  'guest page does not already receive.';

COMMENT ON FUNCTION api.render_invitation_document(uuid) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.render_invitation_document. Authenticated '
  'only. The render worker''s authorised source and the host''s "what a guest sees of this exact '
  'version" view; it cannot reach a draft, because a draft has no version row.';

COMMENT ON FUNCTION internal_api.list_invitation_outputs(uuid) IS
  'SECURITY DEFINER. The wedding''s render manifest as an array, newest artefacts addressed by kind, '
  'geometry, format and page. Carries state and digests; carries no object key, no URL, no '
  'target_url_digest and no credential material of any kind. Owner-only, like every other host read '
  'surface.';

COMMENT ON FUNCTION api.list_invitation_outputs(uuid) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.list_invitation_outputs. Authenticated '
  'only. A client that needs the bytes asks for a signed URL through the Storage API afterwards; this '
  'function is a description of artefacts, not a delivery mechanism.';
