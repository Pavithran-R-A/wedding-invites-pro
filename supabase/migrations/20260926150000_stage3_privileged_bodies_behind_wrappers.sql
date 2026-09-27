-- Stage 3 / closure repair — the privileged publication bodies move behind thin,
-- exposed wrappers.
--
-- Independent review of the pushed Stage 3 branch compared
-- `20260926130000_stage3_publication_resolution_boundary.sql` with current Supabase
-- guidance and found the layout wrong in one specific way: seven `SECURITY DEFINER`
-- bodies lived directly inside `api`, the schema PostgREST serves. The consequence is
-- that every privileged body in this product was itself a Data API object — a
-- correctly-signed request could name it — so "the exposed surface is the privileged
-- surface" and "the privileged surface is the audited surface" became the same
-- sentence. That is survivable only because each body re-derives its caller, which is
-- a lot of weight on a convention.
--
-- The repair separates the two roles without changing the architecture:
--
--   api           exposed, SECURITY INVOKER wrappers. One `SELECT` each. No tables.
--   internal_api  NOT exposed, SECURITY DEFINER implementations. No tables.
--
-- Nothing else about the boundary moves. The RPC stays an RPC (ADR 0006's four reasons
-- for that are untouched by this file — it is a privilege-layout change, not a runtime
-- change), the seven exposed names and identity signatures are exactly the ones the
-- frontend already calls, and every ownership check, refusal phrase, snapshot rule and
-- token rule is carried over unchanged from the file above. No browser-visible
-- behaviour is intended to differ; the API suites are re-run as written to prove it.
--
-- ---------------------------------------------------------------------------
-- WHY THE IMPLEMENTATIONS ARE DEFINER AND THE WRAPPERS ARE NOT
--
-- A wrapper that is `SECURITY INVOKER` contains nothing worth calling by accident: it
-- takes its arguments as given, does no arithmetic, reads no header, writes no row, and
-- cannot report anything a caller could not already learn from the refusal. It runs as
-- the calling role, which is the definition of "cannot act above its caller" that
-- Stage 2 wrote into its helper rule.
--
-- The implementation has to escalate — publishing writes `publications` and
-- `private.access_tokens` rows that no browser role may write, and no grant can be
-- handed out for that — so it keeps `SECURITY DEFINER`, and it is the escalation that
-- the unexposed schema is for. `supabase/config.toml` serves
-- `schemas = ["public", "api"]`; `internal_api` is absent from that list, which the
-- same mechanism that makes `Accept-Profile: private` answer `PGRST106` (measured when
-- `api` was introduced) applies to here. `stage3_security.test.mjs` asserts all three
-- request shapes over real HTTP.
--
-- What this file does *not* claim: that the wrapper split is itself an authorization
-- boundary. It is not. A `SECURITY DEFINER` function is still reachable by any role the
-- database lets call it, so the ownership checks inside each implementation are still
-- the thing that decides whether a caller may publish a wedding — they are kept
-- verbatim for exactly that reason. What the split buys is a smaller *request* surface:
-- the set of privileged bodies a stranger can name over HTTP drops from seven to zero,
-- and the set of things a browser role can execute without going through a wrapper is
-- asserted by name rather than inherited from a schema that had no other purpose.
--
-- ---------------------------------------------------------------------------
-- THE ONE GRANT THIS LAYOUT FORCES, AND WHY IT IS NOT A HOLE
--
-- Nested execution is permission-checked as the *invoking* role, because a `SECURITY
-- INVOKER` wrapper never changes `current_user`. So a role that may call
-- `api.preview_invitation` must also hold USAGE on `internal_api` and EXECUTE on
-- `internal_api.preview_invitation`, or the delegation raises
-- `permission denied for schema internal_api`. Measured on this stack, not inferred:
-- revoking that USAGE makes every host wrapper fail, which is how the grant is known to
-- be load-bearing rather than defensive padding.
--
-- That is a wider SQL privilege than the wrapper alone would need, and it is worth
-- stating what it does and does not allow. It allows a role that can already execute the
-- wrapper to execute the implementation *by SQL name*. It does not allow anything over
-- HTTP, because the schema is not served; it does not grant a single table privilege; and
-- it does not skip an ownership check, because the checks live inside the implementation
-- the wrapper would have reached anyway. The grant set is therefore mirrored function for
-- function from the exposed wrapper beside it (`anon` + `authenticated` for the resolver,
-- `authenticated` alone for the six host operations, nothing for `service_role`), and
-- `C28a`/`C28b`/`API33`/`API34` enumerate all fourteen names.
--
-- ---------------------------------------------------------------------------
-- THE `revoke_invitation_publication` CONTROL FLOW FIXED ON THE WAY THROUGH
--
-- Review flagged the old body's use of PL/pgSQL `FOUND` across statements, and the flag
-- is correct. The body was:
--
--   SELECT * INTO v_live FROM public.publications WHERE ... status = 'active';  -- sets FOUND
--   UPDATE private.access_tokens SET revoked_at = now() WHERE ...;              -- sets FOUND again
--   GET DIAGNOSTICS v_count = ROW_COUNT;
--   IF FOUND THEN UPDATE public.publications SET status = 'revoked' ...;        -- reads the UPDATE's FOUND
--
-- `FOUND` is one variable, and a data-changing statement rewrites it. So the `IF FOUND`
-- that reads like "an active publication existed" was actually "the token UPDATE changed
-- at least one row". The reachable consequence is a wedding whose live credential row is
-- missing while its publication row is `active` — a partially-rolled-back earlier
-- operation, or a row deleted by hand — reporting `{ "revoked": false }` and leaving the
-- publication `active`. Revocation is the operation a host reaches for when something is
-- already wrong, so the state this function must never produce is the one where it
-- declines because of a missing row in a *different* table.
--
-- The implementation now captures the publication lookup in `v_publication_found` on the
-- line after the `SELECT` and tests nothing else for the rest of the body. An active
-- publication is revoked whenever one exists, whatever the token rows say, and
-- `tokens_revoked` remains the honest count of credentials taken down. Group I of
-- `supabase/tests/stage3/30_publication.sql` drives the exact shape (active publication,
-- no live credential) and API35 drives it over HTTP.

CREATE SCHEMA internal_api AUTHORIZATION postgres;

COMMENT ON SCHEMA internal_api IS
  'Privileged SECURITY DEFINER implementations behind the exposed api wrappers. '
  'Not served by PostgREST (supabase/config.toml lists public and api only). No tables.';

-- PUBLIC gets nothing anywhere in this schema, which is why the reverts below name the
-- role list explicitly rather than relying on a default.
REVOKE ALL ON SCHEMA internal_api FROM PUBLIC;
-- Load-bearing, see "THE ONE GRANT THIS LAYOUT FORCES" above.
GRANT USAGE ON SCHEMA internal_api TO anon, authenticated;

-- ===========================================================================
-- 1. THE IMPLEMENTATIONS — carried over from file 20260926130000
-- ===========================================================================

CREATE FUNCTION internal_api.create_invitation_version(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner  uuid;
  v_lang   text;
  v_draft  public.invitation_drafts%ROWTYPE;
  v_snap   jsonb;
  v_number integer;
  v_prev   uuid;
  v_id     uuid;
  v_try    integer := 0;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not create a version of this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Directive §7 names the language choices as frozen content, and Stage 2 left
  -- `primary_language` nullable with the instruction that rendering must refuse
  -- without it: a version is the promise a guest reads, so it cannot be made
  -- about text in a language nobody chose.
  SELECT w.primary_language INTO v_lang FROM public.weddings w WHERE w.id = p_wedding_id;
  IF v_lang IS NULL THEN
    RAISE EXCEPTION 'choose the invitation language before creating a version'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The draft row is guaranteed by weddings_have_draft (Stage 3 file 1); its
  -- absence would mean the invariant broke, which is an error, not a 404.
  SELECT * INTO v_draft FROM public.invitation_drafts d WHERE d.wedding_id = p_wedding_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this wedding has no invitation draft'
      USING ERRCODE = 'raise_exception';
  END IF;

  v_snap := private.build_invitation_snapshot(p_wedding_id);

  LOOP
    v_try := v_try + 1;
    SELECT coalesce(max(v.version_number), 0) + 1,
           (array_agg(v.id ORDER BY v.version_number DESC))[1]
      INTO v_number, v_prev
      FROM public.invitation_versions v
     WHERE v.wedding_id = p_wedding_id;

    BEGIN
      INSERT INTO public.invitation_versions (
        wedding_id, version_number, snapshot, snapshot_schema_version,
        tradition_pack_id, design_template_id, created_by, supersedes_version_id
      )
      SELECT p_wedding_id, v_number, v_snap, 1,
             w.tradition_pack_id, w.design_template_id, v_owner, v_prev
        FROM public.weddings w WHERE w.id = p_wedding_id
      RETURNING id INTO v_id;

      RETURN jsonb_build_object(
        'version_id', v_id,
        'version_number', v_number,
        'snapshot', v_snap
      );
    EXCEPTION WHEN unique_violation THEN
      -- Two tabs creating a version at once: `wedding_id, version_number` is the
      -- arbiter, and the loser recomputes rather than reporting a key violation
      -- for a thing the host asked for twice deliberately.
      IF v_try >= 3 THEN
        RAISE EXCEPTION 'too many versions were being created at once; try again'
          USING ERRCODE = 'raise_exception';
      END IF;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION internal_api.create_invitation_version(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.create_invitation_version(uuid) TO authenticated;

CREATE FUNCTION internal_api.publish_invitation_version(
  p_wedding_id uuid,
  p_version_id uuid,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner      uuid;
  v_live       public.publications%ROWTYPE;
  v_token      private.access_tokens%ROWTYPE;
  v_publication uuid;
  v_raw        text;
  -- Captured per lookup rather than read from `FOUND` later in the body. See the header.
  v_live_found  boolean := false;
  v_token_found boolean := false;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not publish this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Checked, not merely relied on. The composite FK would refuse "wedding A
  -- publishes wedding B's version" anyway, but a foreign key reports itself as
  -- 23503 with the referencing key in its detail, which is a description of the
  -- database to someone who was only refused.
  IF NOT EXISTS (
       SELECT 1 FROM public.invitation_versions v
        WHERE v.id = p_version_id AND v.wedding_id = p_wedding_id) THEN
    RAISE EXCEPTION 'that version is not a version of this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'an expiring link must be given a time in the future'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_live FROM public.publications
   WHERE wedding_id = p_wedding_id AND status = 'active';
  -- Captured before the next statement rewrites FOUND. Here the two later `FOUND`
  -- tests happen to be safe — nothing between them is a data-changing statement —
  -- and they are replaced anyway so the function reads the same way every other
  -- lookup in this file does.
  v_live_found := FOUND;

  IF v_live_found AND v_live.version_id = p_version_id THEN
    RAISE EXCEPTION 'this version is already the published one'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_live_found THEN
    UPDATE public.publications
       SET status = 'revoked', revoked_at = now()
     WHERE id = v_live.id;
  END IF;

  INSERT INTO public.publications (wedding_id, version_id, status)
    VALUES (p_wedding_id, p_version_id, 'active')
  RETURNING id INTO v_publication;

  -- The wedding's live credential, if it has one, follows the publication it is
  -- pinned to. Same wedding, so the composite FK accepts it; a credential
  -- attached to another family's publication is not a thing this statement can
  -- express.
  SELECT * INTO v_token FROM private.access_tokens
   WHERE wedding_id = p_wedding_id
     AND token_kind = 'public_invitation'
     AND revoked_at IS NULL
   ORDER BY created_at DESC
   FOR UPDATE;
  v_token_found := FOUND;

  IF v_token_found THEN
    UPDATE private.access_tokens
       SET publication_id = v_publication,
           expires_at = COALESCE(p_expires_at, expires_at),
           expiry_policy = CASE WHEN p_expires_at IS NOT NULL THEN 'fixed'
                                ELSE expiry_policy END
     WHERE id = v_token.id;
    v_raw := NULL;
  ELSE
    v_raw := private.mint_public_invitation_token(p_wedding_id, v_publication, p_expires_at);
  END IF;

  RETURN jsonb_build_object(
    'publication_id', v_publication,
    'version_id', p_version_id,
    'path', CASE WHEN v_raw IS NULL THEN NULL ELSE '/i/' || v_raw END,
    -- The raw credential appears in a response exactly once, in the call that
    -- created it. `link_reused` is the host being told, in plain terms, that the
    -- address they already shared now shows this version.
    'link_reused', (v_raw IS NULL),
    'expires_at', p_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION internal_api.publish_invitation_version(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.publish_invitation_version(uuid, uuid, timestamptz)
  TO authenticated;

-- Takes the link down. Directive §15 of Stage 3: after this the same URL must stop
-- resolving, and the answer a visitor gets must not say that a wedding is behind it.
--
-- See the header for why this body is the one that changed rather than moved: the old
-- shape tested PL/pgSQL `FOUND` after an `UPDATE` had already overwritten it, so an
-- active publication whose live credential row was missing was left `active` and the
-- call reported nothing revoked.
CREATE FUNCTION internal_api.revoke_invitation_publication(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner             uuid;
  v_publication_id    uuid;
  v_publication_found boolean := false;
  v_count             integer;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not revoke this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Only the id is taken: `status = 'revoked'` below is written by primary key, and a
  -- whole-row variable invites the same "is this still what I read?" question this fix
  -- exists to answer. `one_active_publication_per_wedding` makes one row the maximum.
  SELECT p.id INTO v_publication_id
    FROM public.publications p
   WHERE p.wedding_id = p_wedding_id AND p.status = 'active';
  v_publication_found := FOUND;

  UPDATE private.access_tokens SET revoked_at = now()
   WHERE wedding_id = p_wedding_id
     AND token_kind = 'public_invitation'
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Tested on the captured boolean, not on `FOUND`. A takedown is a takedown of the
  -- publication: whether a credential row was there to revoke is reported separately by
  -- `tokens_revoked`, and must not be able to decide whether the publication itself
  -- stops being live.
  IF v_publication_found THEN
    UPDATE public.publications
       SET status = 'revoked', revoked_at = now()
     WHERE id = v_publication_id;
  END IF;

  RETURN jsonb_build_object(
    'revoked', v_publication_found OR v_count > 0,
    'publication_id', CASE WHEN v_publication_found THEN v_publication_id END,
    'tokens_revoked', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION internal_api.revoke_invitation_publication(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.revoke_invitation_publication(uuid) TO authenticated;

CREATE FUNCTION internal_api.rotate_invitation_token(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_live  public.publications%ROWTYPE;
  v_old   private.access_tokens%ROWTYPE;
  v_raw   text;
  v_revoked_at timestamptz := now();
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not rotate this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_live FROM public.publications
   WHERE wedding_id = p_wedding_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'there is no published invitation to rotate'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_old FROM private.access_tokens
   WHERE wedding_id = p_wedding_id
     AND token_kind = 'public_invitation'
     AND revoked_at IS NULL
   ORDER BY created_at DESC
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the published invitation has no live link to rotate'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- The value written here is the value reported back below. `v_old` was fetched
  -- before the UPDATE, so `v_old.revoked_at` is still NULL — an earlier draft of
  -- this function returned that NULL and the API suite caught it.
  UPDATE private.access_tokens SET revoked_at = v_revoked_at WHERE id = v_old.id;

  v_raw := private.mint_public_invitation_token(
    p_wedding_id, v_live.id, CASE WHEN v_old.expiry_policy = 'fixed' THEN v_old.expires_at END);

  RETURN jsonb_build_object(
    'publication_id', v_live.id,
    'version_id', v_live.version_id,
    'path', '/i/' || v_raw,
    'previous_revoked_at', v_revoked_at,
    'expires_at', CASE WHEN v_old.expiry_policy = 'fixed' THEN v_old.expires_at END
  );
END;
$$;

REVOKE ALL ON FUNCTION internal_api.rotate_invitation_token(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.rotate_invitation_token(uuid) TO authenticated;

CREATE FUNCTION internal_api.preview_invitation(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_dto   jsonb;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not preview this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_dto := private.public_invitation_dto(1, private.build_invitation_snapshot(p_wedding_id));
  IF v_dto IS NULL THEN
    RAISE EXCEPTION 'this invitation cannot be previewed as it is currently written'
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN v_dto;
END;
$$;

REVOKE ALL ON FUNCTION internal_api.preview_invitation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.preview_invitation(uuid) TO authenticated;

CREATE FUNCTION internal_api.get_invitation_publication_state(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_state jsonb;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not read this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
           'publication_id', p.id,
           'version_id', p.version_id,
           'version_number', v.version_number,
           'published_at', p.published_at,
           -- The join below deliberately keeps an expired credential in view, so that
           -- `link_expires_at` can still tell a host *when* their link ran out. That
           -- is also why `link_active` cannot simply be `t.id IS NOT NULL`: a
           -- credential is live until it is revoked **or** until it runs out, which is
           -- the rule `private.invitation_for_token` applies to a guest. Reading only
           -- the revocation here once told a host "live" about a link whose visitors
           -- were getting the generic refusal; the expiry half is measured by
           -- `stage3_publication.test.mjs` (API31) and by the aged-token group of
           -- `supabase/tests/stage3/30_publication.sql`.
           'link_active', t.id IS NOT NULL
                          AND (t.expires_at IS NULL OR t.expires_at > now()),
           'link_created_at', t.created_at,
           'link_expires_at', t.expires_at
         )
    INTO v_state
    FROM public.publications p
    JOIN public.invitation_versions v ON v.id = p.version_id
    LEFT JOIN private.access_tokens t
           ON t.publication_id = p.id
          AND t.token_kind = 'public_invitation'
          AND t.revoked_at IS NULL
   WHERE p.wedding_id = p_wedding_id AND p.status = 'active';

  RETURN COALESCE(v_state, jsonb_build_object('publication_id', NULL, 'version_id', NULL,
                                              'version_number', NULL, 'published_at', NULL,
                                              'link_active', false, 'link_created_at', NULL,
                                              'link_expires_at', NULL));
END;
$$;

REVOKE ALL ON FUNCTION internal_api.get_invitation_publication_state(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.get_invitation_publication_state(uuid)
  TO authenticated;

-- The transport half of the guest door: read the one header that may carry a
-- credential and look it up. Still no arguments, still the same generic refusal —
-- the reason the argument does not exist is recorded in file 20260926130000 and is
-- unaffected by which schema this body now lives in.
CREATE FUNCTION internal_api.resolve_public_invitation()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_unavailable constant jsonb := jsonb_build_object('available', false);
  v_dto jsonb;
BEGIN
  -- Written by PostgREST, never by the caller, so the cast cannot be handed junk.
  -- `true` makes an unset setting (a direct SQL call from outside the API) NULL
  -- rather than an error, and NULL fails the shape test inside the lookup like any
  -- other junk.
  v_dto := private.invitation_for_token(
    current_setting('request.headers', true)::jsonb ->> 'x-invitation-token');

  IF v_dto IS NULL THEN
    RETURN v_unavailable;
  END IF;

  RETURN jsonb_build_object('available', true, 'invitation', v_dto);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.resolve_public_invitation()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.resolve_public_invitation()
  TO anon, authenticated;

-- ===========================================================================
-- 2. THE EXPOSED WRAPPERS — each one line of delegation
-- ===========================================================================
--
-- `SECURITY INVOKER` is the Postgres default and is written out anyway, because this
-- file exists to make the two postures readable side by side from the catalog
-- (`prosecdef` is what API33 and C26 assert). `SET search_path = ''` is not decoration
-- here either: a wrapper that resolved `internal_api` through an inherited path could
-- be re-pointed at a same-named schema by a caller who steered `search_path`, which is
-- the one attack an otherwise-empty function body could still be made to carry.
--
-- No authorization is duplicated. Each wrapper's only decision is which implementation
-- to hand its arguments to.

CREATE OR REPLACE FUNCTION api.create_invitation_version(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.create_invitation_version(p_wedding_id);
$$;

CREATE OR REPLACE FUNCTION api.publish_invitation_version(
  p_wedding_id uuid,
  p_version_id uuid,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.publish_invitation_version(p_wedding_id, p_version_id, p_expires_at);
$$;

CREATE OR REPLACE FUNCTION api.revoke_invitation_publication(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.revoke_invitation_publication(p_wedding_id);
$$;

CREATE OR REPLACE FUNCTION api.rotate_invitation_token(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.rotate_invitation_token(p_wedding_id);
$$;

-- `STABLE` carries over to the wrappers that were stable, so a caller that relied on
-- naming the same snapshot twice in one statement still can.
CREATE OR REPLACE FUNCTION api.preview_invitation(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.preview_invitation(p_wedding_id);
$$;

CREATE OR REPLACE FUNCTION api.get_invitation_publication_state(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.get_invitation_publication_state(p_wedding_id);
$$;

CREATE OR REPLACE FUNCTION api.resolve_public_invitation()
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.resolve_public_invitation();
$$;

-- ===========================================================================
-- 3. THE CALLER MATRIX, RESTATED FOR BOTH HALVES OF THE BOUNDARY
-- ===========================================================================
--
-- Re-issued explicitly because `CREATE OR REPLACE` keeps a function's existing ACL
-- rather than recomputing it, and a reader of this file should not have to know which
-- of the seven inherited which grant from file 20260926130000. The exposed set is
-- unchanged from that file, function for function.
REVOKE ALL ON FUNCTION api.create_invitation_version(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.create_invitation_version(uuid) TO authenticated;

REVOKE ALL ON FUNCTION api.publish_invitation_version(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.publish_invitation_version(uuid, uuid, timestamptz)
  TO authenticated;

REVOKE ALL ON FUNCTION api.revoke_invitation_publication(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.revoke_invitation_publication(uuid) TO authenticated;

REVOKE ALL ON FUNCTION api.rotate_invitation_token(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.rotate_invitation_token(uuid) TO authenticated;

REVOKE ALL ON FUNCTION api.preview_invitation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.preview_invitation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION api.get_invitation_publication_state(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.get_invitation_publication_state(uuid) TO authenticated;

REVOKE ALL ON FUNCTION api.resolve_public_invitation()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.resolve_public_invitation() TO anon, authenticated;

-- `service_role` is absent from both halves on purpose. It has no USAGE on `api` (C17c)
-- and none on `internal_api` (asserted the same way by C17/C17d here), because it is not
-- a browser and does not need a browser's door to write the tables it already owns the
-- grants on. Convenience is not a reason to widen a request surface.

-- ===========================================================================
-- 4. COMMENTS, SO `pg_description` TELLS THE TRUTH ABOUT BOTH SCHEMAS
-- ===========================================================================

COMMENT ON FUNCTION api.resolve_public_invitation() IS
  'Exposed wrapper: delegates to internal_api.resolve_public_invitation. '
  'SECURITY INVOKER, no logic, the only anonymous entry point.';
COMMENT ON FUNCTION api.preview_invitation(uuid) IS
  'Exposed wrapper: delegates to internal_api.preview_invitation. SECURITY INVOKER, no logic.';
COMMENT ON FUNCTION api.create_invitation_version(uuid) IS
  'Exposed wrapper: delegates to internal_api.create_invitation_version. SECURITY INVOKER, no logic.';
COMMENT ON FUNCTION api.publish_invitation_version(uuid, uuid, timestamptz) IS
  'Exposed wrapper: delegates to internal_api.publish_invitation_version. SECURITY INVOKER, no logic.';
COMMENT ON FUNCTION api.get_invitation_publication_state(uuid) IS
  'Exposed wrapper: delegates to internal_api.get_invitation_publication_state. SECURITY INVOKER, no logic.';
COMMENT ON FUNCTION api.rotate_invitation_token(uuid) IS
  'Exposed wrapper: delegates to internal_api.rotate_invitation_token. SECURITY INVOKER, no logic.';
COMMENT ON FUNCTION api.revoke_invitation_publication(uuid) IS
  'Exposed wrapper: delegates to internal_api.revoke_invitation_publication. SECURITY INVOKER, no logic.';

COMMENT ON FUNCTION internal_api.resolve_public_invitation() IS
  'Privileged implementation behind an exposed wrapper. Not served by PostgREST. '
  'Credential in a request header, digest-only lookup, one generic refusal.';
COMMENT ON FUNCTION internal_api.revoke_invitation_publication(uuid) IS
  'Takes the publication down whenever an active one exists, whatever the credential rows '
  'say; tokens_revoked reports the credentials separately.';

-- The schema-level facts the design rests on, said out loud where a maintainer can find
-- them without reading the migration history.
COMMENT ON SCHEMA api IS
  'Browser-callable RPC wrappers only: no tables, no views, SECURITY INVOKER. Every body '
  'is one delegation into the unexposed internal_api schema.';
