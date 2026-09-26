-- Stage 2 / file 3 of 9 — immutable invitation versions and the publication foundation.
--
-- No public URL, no token, no anon SELECT exists after this file. Publication is
-- recorded state, not a reachable page; Stage 3 adds the renderer and access contract.

-- ===========================================================================
-- Immutable snapshots
-- ===========================================================================

CREATE TABLE public.invitation_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NO ACTION, not CASCADE. `versions_immutable_no_delete` below is a
  -- SECURITY INVOKER trigger that refuses deletion by name of the acting role,
  -- and an FK cascade is not performed by the role that deleted the parent:
  -- measured on PostgreSQL 16.15 and 17.6, a BEFORE DELETE trigger fired by a cascading
  -- FK sees `current_user` = the *child table's owner*, not the client role that
  -- issued the parent delete. So a client-owned wedding delete would have wiped
  -- frozen history through a guard that only ever speaks to clients. NO ACTION
  -- moves that refusal into relational integrity, which no role context can
  -- bypass, and leaves cleanup to a trusted role in child-before-parent order.
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE NO ACTION,
  version_number integer NOT NULL CHECK (version_number > 0),
  -- The snapshot must be *resolved*: pack wording and template settings are
  -- copied in, not referenced by key. A version that merely points at live
  -- platform content is not immutable, it is a promise the renderer has to keep.
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  -- Which shape the snapshot claims to be. Validating that shape is Stage 3's
  -- rendering contract, not a constraint SQL can express.
  snapshot_schema_version integer NOT NULL DEFAULT 1 CHECK (snapshot_schema_version > 0),
  tradition_pack_id uuid REFERENCES public.tradition_packs(id) ON DELETE RESTRICT,
  design_template_id uuid REFERENCES public.design_templates(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supersedes_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- No updated_at: an immutable row has no second timestamp to maintain.
  UNIQUE (wedding_id, version_number),
  UNIQUE (wedding_id, id),
  -- Self-reference kept NO ACTION (default) rather than RESTRICT: a trusted
  -- cleanup deletes a wedding's whole version set in one statement, and the
  -- lineage links are inside that same row set. RESTRICT would check each row as
  -- it goes and refuse the first link of the chain; NO ACTION defers the test to
  -- the end of the statement, where the referencing row is already gone.
  FOREIGN KEY (wedding_id, supersedes_version_id)
    REFERENCES public.invitation_versions(wedding_id, id)
);

CREATE INDEX invitation_versions_wedding_created_idx
  ON public.invitation_versions (wedding_id, created_at DESC);

CREATE TRIGGER versions_immutable_no_update BEFORE UPDATE ON public.invitation_versions
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();

CREATE TRIGGER versions_immutable_no_delete BEFORE DELETE ON public.invitation_versions
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

-- ===========================================================================
-- Publications: a stable address pointed at one exact version
-- ===========================================================================

CREATE TABLE public.publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NO ACTION for the same reason as invitation_versions.wedding_id: a
  -- publication record is the evidence of what was live and when. Cascading it
  -- away with the wedding would let the ordinary owner-delete path erase that
  -- history unremarkably, and no trigger guard could have objected: an FK
  -- cascade runs as the child table's owner, not as the client that issued the
  -- parent delete. Relational integrity is the only check that survives that.
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE NO ACTION,
  version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  published_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Exactly one active publication per wedding, enforced by the partial unique
  -- index below rather than a cross-row CHECK (which cannot span rows).
  --
  -- The composite FK is what makes "wedding A publishes wedding B's version"
  -- impossible: it can only match a version whose own wedding_id is A's.
  FOREIGN KEY (wedding_id, version_id)
    REFERENCES public.invitation_versions(wedding_id, id),
  -- Phase 30 pattern: lets a later row pin "this token's publication belongs to
  -- this wedding" as one constraint instead of a backend promise.
  UNIQUE (wedding_id, id),
  -- Status and its timestamps may not disagree about whether this link is live.
  CHECK ((status = 'active') = (revoked_at IS NULL)),
  CHECK (revoked_at IS NULL OR revoked_at >= published_at)
);

CREATE UNIQUE INDEX one_active_publication_per_wedding
  ON public.publications (wedding_id)
  WHERE status = 'active';

-- Re-publishing is an explicit new row, so history is never rewritten: the old
-- row flips to 'revoked'.
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.publications
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- Publishing is a server decision: a browser role may never create or move a
-- publication, even if a future migration hands `authenticated` a write grant on
-- this table by mistake. Same backstop shape as invitation_versions.
CREATE TRIGGER publications_no_client_write BEFORE INSERT OR UPDATE ON public.publications
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();

CREATE INDEX publications_wedding_version_idx
  ON public.publications (wedding_id, version_id);
