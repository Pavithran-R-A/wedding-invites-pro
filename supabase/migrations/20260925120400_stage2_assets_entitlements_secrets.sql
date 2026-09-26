-- Stage 2 / file 5 of 9 — assets, entitlements, and the two server-only tables.
--
-- Nothing in this file is reachable from the browser: `private` has no USAGE for
-- anon/authenticated and the default-privilege configuration from file 1 gives the
-- new tables no client grants, so the boundary here is privileges, not policies.

-- ===========================================================================
-- Customer asset metadata (upload itself is Storage work, later stage)
-- ===========================================================================

CREATE TABLE public.wedding_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE CASCADE,
  asset_kind text NOT NULL
    CHECK (asset_kind IN ('photo', 'monogram', 'decorative', 'audio', 'generated_output')),
  label text,
  -- A Storage object key, never a path a browser supplied: no absolute path and
  -- no traversal, so this column can never be read back as a filesystem fact.
  object_key text NOT NULL UNIQUE
    CHECK (length(btrim(object_key)) > 0
           AND object_key NOT LIKE '/%'
           AND object_key NOT LIKE '%..%'),
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  is_generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wedding_assets_wedding_kind_idx ON public.wedding_assets (wedding_id, asset_kind);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.wedding_assets
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- Platform motif assets (a pack's own artwork) are deliberately not modelled yet:
-- there is no reviewed pack content to attach them to, and a kind flag pretending
-- otherwise would just widen the customer table's meaning. Stage 4 adds that.

-- ===========================================================================
-- Entitlements (server-authoritative; no pricing anywhere)
-- ===========================================================================

CREATE TABLE public.entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No ON DELETE clause: NO ACTION. A wedding carrying a recorded entitlement
  -- cannot be deleted out from under it; the right is revoked explicitly first,
  -- because money-adjacent history does not vanish with the aggregate.
  wedding_id uuid NOT NULL REFERENCES public.weddings(id),
  -- A code, never an amount: prices live in the pricing decision record until a
  -- payment stage makes them data.
  package_code text NOT NULL CHECK (length(btrim(package_code)) > 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  source text NOT NULL CHECK (source IN ('service', 'admin_manual')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  metadata jsonb CHECK (metadata IS NULL OR jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'active') = (revoked_at IS NULL)),
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

-- One live grant per package per wedding; regranting after revocation is a new row.
CREATE UNIQUE INDEX one_active_entitlement_per_wedding_package
  ON public.entitlements (wedding_id, package_code)
  WHERE status = 'active';

CREATE INDEX entitlements_wedding_id_idx ON public.entitlements (wedding_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.entitlements
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

CREATE TRIGGER entitlements_no_client_write BEFORE INSERT OR UPDATE ON public.entitlements
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER entitlements_no_client_delete BEFORE DELETE ON public.entitlements
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

-- ===========================================================================
-- Audit trail
-- ===========================================================================

-- Append-only, server-written, and *not* cascaded away with the wedding:
-- SET NULL keeps "this publication was revoked" answerable after the data it
-- described is exported and deleted.
CREATE TABLE private.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wedding_id uuid REFERENCES public.weddings(id) ON DELETE SET NULL,
  -- Free namespace keys ('publication', 'entitlement', ...) rather than FKs:
  -- the subject may legitimately have been deleted, and an audit row that
  -- disappears with its subject is not an audit row.
  subject_type text NOT NULL CHECK (length(btrim(subject_type)) > 0),
  subject_key uuid,
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  -- Server-supplied by construction: no client can write this table at all, so
  -- the actor cannot be forged by a request body.
  actor_role text NOT NULL DEFAULT current_user::text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_wedding_created_idx
  ON private.audit_events (wedding_id, created_at DESC);
CREATE INDEX audit_events_subject_idx ON private.audit_events (subject_type, subject_key);

CREATE TRIGGER audit_append_only_no_update BEFORE UPDATE ON private.audit_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER audit_append_only_no_delete BEFORE DELETE ON private.audit_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

-- ===========================================================================
-- Bearer-credential persistence (foundation only: no minting, no lookup path)
-- ===========================================================================

-- Deliberately NOT in Stage 2: issuing a token, the hash-of-secret contract with
-- an edge function, and the public lookup. The table exists now because its shape
-- is what constrains every later public path, and adding it afterwards means
-- inventing a credential store under release pressure.
CREATE TABLE private.access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 hex of the presented secret, never the secret itself, and never used
  -- as the primary key: a raw token must not become an identifier that leaks
  -- through URLs, logs or error messages.
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_kind text NOT NULL CHECK (token_kind IN ('guest_invitation', 'rsvp', 'approval_review')),
  -- NO ACTION, matching the rule this schema states for every frozen-history table:
  -- a cascade runs as the child table's owner, so `tokens_no_client_delete` below
  -- could not have refused one (measured; migration plan section 7). A minted
  -- credential is evidence of who was let in, so it does not vanish as a side effect
  -- of a wedding removal — the erasure order is tokens first, by a trusted role.
  -- Accepted consequence, verified rather than assumed: this refusal was already
  -- unreachable in practice, because every token row needs a publication or an
  -- approval request by its own CHECK, and both of those block the wedding delete.
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE NO ACTION,
  publication_id uuid,
  household_id uuid,
  approval_request_id uuid,
  approval_version_id uuid,
  -- 'event_date' / 'no_expiry' express intent for a mint that has not happened
  -- yet; only 'fixed' may carry a concrete instant, so a null expiry is always a
  -- declared policy rather than an omission.
  expiry_policy text NOT NULL CHECK (expiry_policy IN ('fixed', 'event_date', 'no_expiry')),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by_role text NOT NULL DEFAULT current_user::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((expiry_policy = 'fixed') = (expires_at IS NOT NULL)),
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (
    CASE token_kind
      WHEN 'guest_invitation' THEN publication_id IS NOT NULL
                                AND household_id IS NOT NULL
                                AND approval_request_id IS NULL
      WHEN 'rsvp'             THEN publication_id IS NOT NULL
                                AND household_id IS NOT NULL
                                AND approval_request_id IS NULL
      WHEN 'approval_review'  THEN approval_request_id IS NOT NULL
                                AND approval_version_id IS NOT NULL
                                AND publication_id IS NULL
                                AND household_id IS NULL
    END
  ),
  -- Each scope column is paired with the wedding in one constraint, so a token
  -- can never address another family's household or publication.
  FOREIGN KEY (wedding_id, publication_id) REFERENCES public.publications(wedding_id, id),
  FOREIGN KEY (wedding_id, household_id) REFERENCES public.guest_households(wedding_id, id),
  FOREIGN KEY (wedding_id, approval_request_id, approval_version_id)
    REFERENCES public.approval_requests(wedding_id, id, version_id)
);

-- Delete-time referential checks and the future "revoke this wedding's links"
-- path both need a wedding-leading lookup; the other two serve the reverse
-- checks when a publication or household row is removed.
CREATE INDEX access_tokens_wedding_idx ON private.access_tokens (wedding_id);
CREATE INDEX access_tokens_publication_idx ON private.access_tokens (wedding_id, publication_id);
CREATE INDEX access_tokens_household_idx ON private.access_tokens (wedding_id, household_id);
CREATE INDEX access_tokens_approval_idx
  ON private.access_tokens (wedding_id, approval_request_id, approval_version_id);

CREATE TRIGGER tokens_no_client_write BEFORE INSERT OR UPDATE ON private.access_tokens
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER tokens_no_client_delete BEFORE DELETE ON private.access_tokens
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

-- ===========================================================================
-- Belt-and-braces on top of privileges: RLS with no policy denies every read, so
-- a later accidental GRANT on these two tables still reveals nothing.
-- ===========================================================================

ALTER TABLE private.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.access_tokens ENABLE ROW LEVEL SECURITY;

-- Only the trusted backend reaches these tables at all.
GRANT SELECT, INSERT, UPDATE, DELETE ON private.audit_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON private.access_tokens TO service_role;
GRANT USAGE ON SEQUENCE private.audit_events_id_seq TO service_role;
