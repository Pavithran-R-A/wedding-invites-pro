-- Stage 3 / file 2 of N — the publication security model: bearer credentials, the
-- resolved snapshot, and the server-authoritative resolution boundary.
--
-- Stage 2 laid down the relational shape (immutable `invitation_versions`, one
-- active `publications` row per wedding, the `private.access_tokens` credential
-- store) and explicitly stopped short of *issuing* a credential or *reading one
-- back*. This file does the issuing and the reading, and does both inside the
-- database.
--
-- ---------------------------------------------------------------------------
-- WHY THE BOUNDARY IS A DATABASE RPC AND NOT AN EDGE FUNCTION
-- (directive §6: "evaluate both first ... choose the smallest architecture that
-- keeps the secret boundary correct ... document the decision")
--
-- The edge-function option was evaluated and rejected on evidence, not taste:
--
--   1. Every invariant a publication has to respect is already relational, and SQL
--      is the only place that can enforce it for *every* writer. The composite FK
--      `publications (wedding_id, version_id) -> invitation_versions (wedding_id,
--      id)` is what makes "wedding A publishes wedding B's version" unrepresentable;
--      `one_active_publication_per_wedding` is what makes two live links impossible;
--      `access_tokens_token_hash_key` is what makes one secret address one row. A
--      TypeScript boundary would re-implement all three as `if` statements that
--      hold only for callers that happen to route through it.
--   2. The repository's gates cannot read a Deno function. Measured on this machine
--      while deciding this, not assumed: `deno` is absent from PATH, and the only
--      edge image present locally (`edge-runtime:v1.74.3`, cached by an unrelated
--      project) ships `/usr/local/bin/edge-runtime` and no `deno` binary, so there
--      is no `check` or `lint` to wire into typecheck / ESLint / vitest / Actions.
--      An edge boundary would therefore be the one part of Stage 3 whose source no
--      gate in this repository ever reads — the exact class of unqualified security
--      claim Stages 0 to 2 exist to remove. Enabling it is technically possible (the
--      runtime image is cached), which is why this reason is about verification and
--      not about feasibility.
--   3. A second runtime means a second copy of the resolution rules and a second
--      place for the public field whitelist to rot. Directive §10 forbids two
--      invitation implementations; this is the same failure one layer down.
--   4. Stage 0 switched `[edge_runtime]` off deliberately, when it deleted the one
--      function this repository had (`pricing-quote`: `verify_jwt=false`, CORS `*`,
--      caller-supplied costs). config.toml still says so out loud. Re-enabling it
--      would reverse a documented security repair to obtain a layer that reason 2
--      says cannot be qualified.
--
-- What the RPC does NOT buy, recorded so nobody has to rediscover it: no per-IP
-- rate limiting, no request-scoped metadata, and nothing between the browser and
-- Postgres but Kong and PostgREST. If an unauthenticated hot path ever needs
-- throttling, that is a gateway decision for a later stage.
--
-- This choice has been reviewed once and upheld. The alternative considered was a
-- local Edge Function boundary for the privileged host-side writes, on the ground
-- that a browser-callable SECURITY DEFINER function is a way of bypassing Stage 2's
-- (correct) no-write grants on `invitation_versions`, `publications` and
-- `private.access_tokens`. The concern is real; the remedy proposed here is evidence
-- rather than a moved layer, because the bypass is what has to be *bounded*, and a
-- `service_role` client in a TypeScript function bounds it more loosely than SQL
-- does. Four claims are therefore asserted, not argued: the DEFINER surface is an
-- exact named inventory (Stage 2 catalogue checks C26, C28a, C28b, C29); no browser
-- role holds INSERT/UPDATE/DELETE on any of those three tables, at grant level *and*
-- policy level; every host RPC re-derives its caller from `auth.uid()` and checks
-- `weddings.owner_user_id`, so a wedding id supplied in a request body buys nothing;
-- and all of it is attacked over real HTTP and a real JWT in
-- supabase/tests/api/stage3_security.test.mjs, not only by `SET ROLE` in psql.
--
-- ---------------------------------------------------------------------------
-- PRIVILEGE POSTURE
--
-- `anon` reaches exactly one new thing: api.resolve_public_invitation. It
-- already holds USAGE on schema public (asserted by Stage 2 catalog check C17),
-- still holds no table privilege anywhere in `public`, and holds no EXECUTE on
-- anything else in `api`, so this function is the whole anonymous surface rather
-- than a door into it.
--
-- Every boundary function here is SECURITY DEFINER, owned by `postgres`, with
-- `search_path` pinned empty and every relation written out in full. That reverses
-- the Stage 2 helper rule ("guards are SECURITY INVOKER") and needs the reason
-- stated: these operations must write rows browser roles are forbidden to write,
-- and the only way to do that without handing out table privileges is to run as a
-- role that already has them. Which is exactly why SECURITY DEFINER is the
-- dangerous shape, so each function pays for it four ways:
--
--   * the caller is re-identified from the JWT inside the function (`auth.uid()`),
--     and every host operation checks ownership against `weddings.owner_user_id` —
--     the same predicate the policies use, so there is one ownership truth;
--   * EXECUTE is granted per function to the narrowest role list, after an explicit
--     revoke from PUBLIC (Stage 2 measured that a created function is executable by
--     PUBLIC until revoked, and that no default-privilege setting can change that);
--   * nothing is interpolated into dynamic SQL. Session GUCs are read as *data*
--     only: the resolver parses `request.headers` for one key, and no GUC is
--     treated as a role, a schema or a search path;
--   * the anonymous path is read-only and returns one hand-built projection, never
--     a row.
--
-- The internal builders are SECURITY INVOKER: they only transform values or read
-- on behalf of a caller who already passed a gate, so they must not be able to do
-- more than that caller could.
--
-- ---------------------------------------------------------------------------
-- WHY A GUEST LINK SURVIVES A REVISION BUT NOT A ROTATION
--
-- A credential names exactly one publication row, and the composite FK
-- `access_tokens (wedding_id, publication_id)` keeps it inside one wedding for
-- life. Publishing a new version therefore *retargets* the live credential at the
-- new publication row rather than minting a fresh secret: a couple who fix a typo
-- must not have to re-send their invitations. Revoking or rotating an existing
-- link is the explicit operation that does produce a new secret, and the previous
-- one stops working at once (directive §16). Both paths are asserted behaviourally
-- in the API suite; neither is left to a comment.

-- ===========================================================================
-- 0. THE `api` SCHEMA — THE ONLY PLACE A BROWSER-CALLABLE FUNCTION MAY LIVE
-- ===========================================================================
--
-- Stage 2's catalogue check C29 existed to keep `public` free of our functions, on
-- the ground that `public` is where a customer's readable tables live and a
-- browser-callable DEFINER function among them is one that is easy to overlook.
-- Publishing needs browser-callable functions, so rather than weaken C29 this file
-- puts them in a schema whose whole purpose is to be called:
--
--   * `public`  — RLS-governed tables. No functions, before or after this file.
--   * `api`     — the seven host RPCs and the anonymous resolver. No tables, no
--                 views, so switching a request's profile to `api` can name a
--                 function and never a row.
--   * `private` — the builders and the credential store, reachable only from a
--                 function that has already passed a gate.
--
-- Exposing it is a two-part decision, and both parts are intentional: this schema,
-- and the line in supabase/config.toml that reads
-- `schemas = ["public", "api"]`. PostgREST serves exactly the schemas named there
-- (measured: `Accept-Profile: private` is answered `PGRST106 Invalid schema`, which
-- is the same mechanism proving the list is the boundary), and `public` stays first
-- in it, so a client that does not name a profile is still talking to the table
-- schema and never to `api` by accident.
--
-- USAGE is granted to the two browser roles and withheld from `service_role`, which
-- has no reason to enter through a browser's front door. USAGE alone executes
-- nothing: every function below is revoked from PUBLIC first and then granted by
-- exact name, which is the rule Stage 2 measured (a created function carries
-- implicit EXECUTE to PUBLIC, and no default-privilege setting removes it).
CREATE SCHEMA api AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA api FROM PUBLIC;
GRANT USAGE ON SCHEMA api TO anon, authenticated;

COMMENT ON SCHEMA api IS
  'Browser-callable RPCs only: no tables, no views. USAGE is granted to anon and '
  'authenticated; EXECUTE is granted per function, by name.';

-- ===========================================================================
-- 1. A BOUND ON THE WORDING THE HOST ACTUALLY PRODUCES
-- ===========================================================================

-- `invitation_drafts.content` is host-authored JSONB with no shape, and from here
-- it is copied verbatim into an immutable row that every guest then reads forever.
-- Four fields is the whole V1 vocabulary (directive §8), so the bound is stated
-- per field rather than as a document size: an unbounded snapshot is a
-- write-your-own-disk-full the host can reach by accident.
--
-- Unknown keys stay allowed on purpose — the snapshot copies the four it knows and
-- the public projection drops everything else — because refusing them here would
-- mean editing this constraint every time the editor gains a field, which is how
-- constraints rot into lying.
ALTER TABLE public.invitation_drafts
  ADD CONSTRAINT invitation_drafts_section_length_bound
  CHECK (
    coalesce(length(content ->> 'welcome'), 0) <= 4000
    AND coalesce(length(content ->> 'family_introduction'), 0) <= 4000
    AND coalesce(length(content ->> 'event_notes'), 0) <= 4000
    AND coalesce(length(content ->> 'closing'), 0) <= 4000
  );

-- ===========================================================================
-- 2. A CREDENTIAL THAT SCOPES ONE PUBLICATION, NOT ONE HOUSEHOLD
-- ===========================================================================

-- `guest_invitation` as Stage 2 defined it means "this household's link" and
-- requires household_id. Stage 3's product shape is one shareable link per wedding
-- (a family group forwards it to relatives), so a second kind is the honest
-- modelling: narrowing `guest_invitation` by relaxing its CHECK would have quietly
-- changed what an existing column value means.
ALTER TABLE private.access_tokens
  DROP CONSTRAINT access_tokens_token_kind_check;
ALTER TABLE private.access_tokens
  ADD CONSTRAINT access_tokens_token_kind_check
  CHECK (token_kind IN ('public_invitation', 'guest_invitation', 'rsvp', 'approval_review'));

-- The constraint being replaced is `access_tokens_check3` (measured from
-- pg_constraint, not guessed: an unnamed table-level CHECK takes a positional
-- suffix). Its three existing branches are reproduced below word for word, so no
-- household, RSVP or approval credential is validated differently than Stage 2
-- defined it. The new branch is the only addition.
ALTER TABLE private.access_tokens
  DROP CONSTRAINT access_tokens_check3;
ALTER TABLE private.access_tokens
  ADD CONSTRAINT access_tokens_kind_shape CHECK (
    CASE token_kind
      -- Wedding-scoped: no household, no approval. The host operations below move
      -- this pointer between publication rows, and only between rows of the same
      -- wedding, which is what the composite FK makes impossible to get wrong.
      WHEN 'public_invitation' THEN publication_id IS NOT NULL
                                AND household_id IS NULL
                                AND approval_request_id IS NULL
                                AND approval_version_id IS NULL
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
  );

-- One unrevoked credential per publication. Rotation revokes before it mints, so a
-- wedding never has two live links; without this, a bug in rotate would leave an
-- orphaned secret that still resolves and that no screen can list.
CREATE UNIQUE INDEX one_live_public_token_per_publication
  ON private.access_tokens (publication_id)
  WHERE revoked_at IS NULL
    AND token_kind = 'public_invitation'
    AND publication_id IS NOT NULL;

-- ===========================================================================
-- 3. TWO SMALL TOTAL FUNCTIONS
-- ===========================================================================

-- Every value that crosses into a guest-facing string goes through here. A JSON
-- object or array where a string was expected is dropped rather than stringified,
-- so a future writer cannot smuggle a structure into a text slot, and a JSON null
-- becomes SQL NULL, which the renderer reads as "the host never wrote this".
CREATE FUNCTION private.dto_text(p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'string' THEN p_value #>> '{}' END;
$$;

REVOKE ALL ON FUNCTION private.dto_text(jsonb) FROM PUBLIC, anon, authenticated;

-- A map link is the one URL a guest may be handed. `venues.map_url` carries an
-- `^https://` CHECK for new writes, and it is re-checked here because a frozen
-- snapshot is older than the constraint that guards tomorrow's writes: history
-- does not inherit rules it never had a chance to satisfy.
CREATE FUNCTION private.map_link_or_null(p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_value) = 'string'
         AND (p_value #>> '{}') ~* '^https://[^[:space:]]+$'
    THEN (p_value #>> '{}')
  END;
$$;

REVOKE ALL ON FUNCTION private.map_link_or_null(jsonb) FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 4. THE SNAPSHOT: WHAT PUBLISHING FREEZES
-- ===========================================================================

-- Directive §7: "Publishing must NOT render mutable live wedding rows", and the
-- snapshot has to be *resolved* — pack and template wording copied in, not keyed.
-- This is the single function that decides what "the invitation" consists of: the
-- preview RPC and the version INSERT both call it, so a host preview and a public
-- page cannot disagree about which facts belong to an invitation.
--
-- Deliberately absent, each for a stated reason:
--   * any uuid. The snapshot carries no identifiers because nothing downstream
--     should need one, and §14 spends its test budget keeping ids out of payloads.
--   * venues no event uses. A hall nobody gathers at is not part of the message,
--     and a top-level venue list would duplicate venue facts the events already
--     carry inline.
--   * venues.notes, wedding_assets, guest_households, entitlements, every *_at
--     column. Internal planning, billing or account state; the host sees those in
--     their own app, from their own tables.
--   * wedding_events.notes — host-internal by that column's own history. The
--     guest-facing note about the events is draft content instead, which the editor
--     owns and the host can see themselves writing.
--
-- Timestamps are rendered to text here rather than left as JSON dates: a muhurtham
-- is a wall-clock fact, and letting it serialise as a date invites a client to
-- parse it with `new Date()` and move it by an hour. `ORDER BY` ends in `id` so a
-- version's people and event lists are reproducible rather than merely stable.
CREATE FUNCTION private.build_invitation_snapshot(p_wedding_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'wedding', jsonb_build_object(
      'title', w.title,
      'primary_language', w.primary_language,
      'additional_languages', w.additional_languages,
      'style_settings', w.style_settings
    ),
    -- Identity plus resolved settings: what shape and wording this version claims.
    'design_template', CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object(
      'template_key', t.template_key,
      'revision', t.revision,
      'display_name', t.display_name,
      'layout_settings', t.layout_settings,
      'supported_languages', t.supported_languages
    ) END,
    'tradition_pack', CASE WHEN tp.id IS NULL THEN NULL ELSE jsonb_build_object(
      'pack_key', tp.pack_key,
      'revision', tp.revision,
      'display_name', tp.display_name,
      'structure', tp.structure,
      'supported_languages', tp.supported_languages
    ) END,
    'people', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'display_name', p.display_name,
               'role_key', p.role_key,
               'role_label', p.role_label,
               'group_key', p.group_key,
               'group_label', p.group_label
             ) ORDER BY p.display_order, p.created_at, p.id)
        FROM public.wedding_people p
       WHERE p.wedding_id = w.id), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'event_key', e.event_key,
               'display_name', e.display_name,
               'starts_at_local', to_char(e.starts_at_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
               'ends_at_local', CASE WHEN e.ends_at_local IS NULL THEN NULL
                     ELSE to_char(e.ends_at_local, 'YYYY-MM-DD"T"HH24:MI:SS') END,
               'timezone', e.timezone,
               'venue', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object(
                 'name', v.name, 'address_text', v.address_text, 'map_url', v.map_url
               ) END
             ) ORDER BY e.display_order, e.starts_at_local, e.id)
        FROM public.wedding_events e
        LEFT JOIN public.venues v
               ON v.id = e.venue_id AND v.wedding_id = e.wedding_id
       WHERE e.wedding_id = w.id AND e.enabled), '[]'::jsonb),
    'draft', jsonb_build_object(
      'welcome', d.content -> 'welcome',
      'family_introduction', d.content -> 'family_introduction',
      'event_notes', d.content -> 'event_notes',
      'closing', d.content -> 'closing'
    )
  )
  FROM public.weddings w
  JOIN public.invitation_drafts d ON d.wedding_id = w.id
  LEFT JOIN public.design_templates t ON t.id = w.design_template_id
  LEFT JOIN public.tradition_packs tp ON tp.id = w.tradition_pack_id
  WHERE w.id = p_wedding_id;
$$;

REVOKE ALL ON FUNCTION private.build_invitation_snapshot(uuid)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 5. THE PUBLIC PROJECTION
-- ===========================================================================

-- The whitelist is expressed as code rather than as a filter applied afterwards
-- (directive §14: "Never serialize an entire database row and filter it in
-- React"). A column a later migration adds, a draft key a future editor writes, or
-- a host note nobody meant to publish is invisible here until this function says
-- otherwise — which is the property the recursive forbidden-field test pins.
--
-- It returns NULL for anything it cannot vouch for, and NULL means "unavailable"
-- to the caller. An invitation that will not project is not an invitation to
-- render partially: §11's "do not invent missing information" and §18's generic
-- refusal are the same instruction seen from two sides.
CREATE FUNCTION private.public_invitation_dto(
  p_snapshot_schema_version integer,
  p_snapshot jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_wedding jsonb;
  v_draft   jsonb;
  v_style   jsonb;
BEGIN
  IF p_snapshot_schema_version IS DISTINCT FROM 1 THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_snapshot) <> 'object'
     OR jsonb_typeof(p_snapshot -> 'wedding') <> 'object'
     OR jsonb_typeof(p_snapshot -> 'draft') <> 'object'
     OR jsonb_typeof(p_snapshot -> 'people') <> 'array'
     OR jsonb_typeof(p_snapshot -> 'events') <> 'array'
  THEN
    RETURN NULL;
  END IF;

  v_wedding := p_snapshot -> 'wedding';
  v_draft   := p_snapshot -> 'draft';
  v_style   := CASE WHEN jsonb_typeof(v_wedding -> 'style_settings') = 'object'
                    THEN v_wedding -> 'style_settings' ELSE '{}'::jsonb END;

  RETURN jsonb_build_object(
    'title', private.dto_text(v_wedding -> 'title'),
    'language', jsonb_build_object(
      'primary', private.dto_text(v_wedding -> 'primary_language'),
      'additional', COALESCE((
        SELECT jsonb_agg(value ORDER BY ord)
          FROM jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(v_wedding -> 'additional_languages') = 'array'
                      THEN v_wedding -> 'additional_languages' ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS e(value, ord)), '[]'::jsonb)
    ),
    -- The four keys a guest may be shown, under the names the editor writes them
    -- under, so there is one style vocabulary and not a mapping between two.
    -- `foilEnabled` is absent on purpose: it is a screen-only flourish standing in
    -- for a printed object that does not exist, and a guest would read it as a
    -- promise about paper (directive §26).
    -- Each value is revalidated on the way out rather than trusted for coming from
    -- a column — `color` becomes a CSS value and `fontSize` a length, and a frozen
    -- snapshot can be older than the client that learned to check them.
    'style', jsonb_build_object(
      'font', CASE WHEN jsonb_typeof(v_style -> 'font') = 'string'
                    AND (v_style ->> 'font') ~ '^[A-Za-z ]{1,40}$'
              THEN (v_style ->> 'font') END,
      'fontSize', CASE WHEN jsonb_typeof(v_style -> 'fontSize') = 'string'
                        AND (v_style ->> 'fontSize') ~ '^[1-9][0-9]{0,2}$'
                  THEN (v_style ->> 'fontSize') END,
      'color', CASE WHEN jsonb_typeof(v_style -> 'color') = 'string'
                    AND (v_style ->> 'color') ~* '^#[0-9a-f]{6}$'
              THEN lower(v_style ->> 'color') END,
      'alignment', CASE WHEN v_style ->> 'alignment' IN ('left', 'center', 'right')
                  THEN (v_style ->> 'alignment') END
    ),
    'design_template', CASE WHEN jsonb_typeof(p_snapshot -> 'design_template') = 'object'
      THEN jsonb_build_object(
        'display_name', private.dto_text(p_snapshot -> 'design_template' -> 'display_name'),
        'template_key', private.dto_text(p_snapshot -> 'design_template' -> 'template_key'),
        'revision', CASE WHEN jsonb_typeof(p_snapshot -> 'design_template' -> 'revision') = 'number'
                THEN (p_snapshot -> 'design_template' ->> 'revision')::integer END
      ) END,
    'tradition_pack', CASE WHEN jsonb_typeof(p_snapshot -> 'tradition_pack') = 'object'
      THEN jsonb_build_object(
        'display_name', private.dto_text(p_snapshot -> 'tradition_pack' -> 'display_name'),
        'pack_key', private.dto_text(p_snapshot -> 'tradition_pack' -> 'pack_key'),
        'revision', CASE WHEN jsonb_typeof(p_snapshot -> 'tradition_pack' -> 'revision') = 'number'
                THEN (p_snapshot -> 'tradition_pack' ->> 'revision')::integer END
      ) END,
    'people', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'display_name', private.dto_text(row_value -> 'display_name'),
               'role_key', private.dto_text(row_value -> 'role_key'),
               'role_label', private.dto_text(row_value -> 'role_label'),
               'group_key', private.dto_text(row_value -> 'group_key'),
               'group_label', private.dto_text(row_value -> 'group_label')
             ) ORDER BY ord)
        FROM jsonb_array_elements(p_snapshot -> 'people')
             WITH ORDINALITY AS e(row_value, ord)), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'event_key', private.dto_text(row_value -> 'event_key'),
               'display_name', private.dto_text(row_value -> 'display_name'),
               'starts_at_local', private.dto_text(row_value -> 'starts_at_local'),
               'ends_at_local', private.dto_text(row_value -> 'ends_at_local'),
               'timezone', private.dto_text(row_value -> 'timezone'),
               'venue', CASE WHEN jsonb_typeof(row_value -> 'venue') = 'object'
                 THEN jsonb_build_object(
                   'name', private.dto_text(row_value -> 'venue' -> 'name'),
                   'address_text', private.dto_text(row_value -> 'venue' -> 'address_text'),
                   'map_url', private.map_link_or_null(row_value -> 'venue' -> 'map_url')
                 ) END
             ) ORDER BY ord)
        FROM jsonb_array_elements(p_snapshot -> 'events')
             WITH ORDINALITY AS e(row_value, ord)), '[]'::jsonb),
    'welcome', private.dto_text(v_draft -> 'welcome'),
    'family_introduction', private.dto_text(v_draft -> 'family_introduction'),
    'event_notes', private.dto_text(v_draft -> 'event_notes'),
    'closing', private.dto_text(v_draft -> 'closing')
  );
EXCEPTION
  WHEN OTHERS THEN
    -- A snapshot this projection cannot read is refused, not explained: an
    -- exception message would describe the internal shape of someone's frozen
    -- invitation to whoever asked for it.
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.public_invitation_dto(integer, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 6. MINTING
-- ===========================================================================

-- 32 bytes from the backend CSPRNG (`gen_random_bytes`, pgcrypto) encoded
-- base64url without padding: 256 bits of entropy in 43 URL-safe characters, so the
-- link is short enough to dictate over a phone call and needs no percent-encoding
-- in a chat app. Lower- and upper-case letters plus `-` and `_` are all distinct
-- under URL rules, so no transport may fold the token into a different string.
--
-- Only the SHA-256 hex digest of that exact text is stored, and the caller's token
-- is digested the same way before lookup: `convert_to(.., 'UTF8')` is spelled out
-- so the hash is over the token's UTF-8 bytes rather than over whatever
-- `text::bytea` would produce under the session's client encoding. A guest who
-- loses the link cannot be given it back (there is nothing to give back), and a
-- reader of the digest column cannot recover it.
--
-- No constant-time comparison is used or needed: the lookup is an equality probe on
-- a unique index over the digest, so no code path ever compares two secrets byte by
-- byte and there is no partial-match timing signal to observe. The failure a
-- guesser sees is the same `{"available": false}` for a near miss and a random
-- string, and 256 bits puts the near misses out of range of any number of tries.
CREATE FUNCTION private.mint_public_invitation_token(
  p_wedding_id uuid,
  p_publication_id uuid,
  p_expires_at timestamptz
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_raw text;
BEGIN
  v_raw := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  INSERT INTO private.access_tokens (
    token_hash, token_kind, wedding_id, publication_id, expiry_policy, expires_at
  ) VALUES (
    encode(extensions.digest(convert_to(v_raw, 'UTF8'), 'sha256'), 'hex'),
    'public_invitation',
    p_wedding_id,
    p_publication_id,
    CASE WHEN p_expires_at IS NULL THEN 'no_expiry' ELSE 'fixed' END,
    p_expires_at
  );

  RETURN v_raw;
END;
$$;

REVOKE ALL ON FUNCTION private.mint_public_invitation_token(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 7. THE HOST BOUNDARY
-- ===========================================================================

-- One shared refusal shape for "not signed in", "not your wedding" and "no such
-- wedding": the same SQLSTATE and the same message. §5.7 of the API suite
-- established that a hidden row must be indistinguishable from a missing one for
-- table reads, and an RPC that said "that wedding does not exist" would reopen the
-- question through a different door.
--
-- `auth.uid()` IS NULL is folded into the same refusal rather than treated as a
-- separate "please log in" case: PostgREST has already rejected a missing or
-- invalid JWT before this body runs, so a NULL here means a correctly signed
-- anonymous token, which is not a host.

-- Freezes the invitation's current state into a new immutable version.
CREATE FUNCTION api.create_invitation_version(p_wedding_id uuid)
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

REVOKE ALL ON FUNCTION api.create_invitation_version(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.create_invitation_version(uuid) TO authenticated;

-- Records a version as what the public link currently shows, and returns the
-- credential for it exactly once, here, to the host who asked.
CREATE FUNCTION api.publish_invitation_version(
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

  IF FOUND AND v_live.version_id = p_version_id THEN
    RAISE EXCEPTION 'this version is already the published one'
      USING ERRCODE = 'check_violation';
  END IF;

  IF FOUND THEN
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

  IF FOUND THEN
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

REVOKE ALL ON FUNCTION api.publish_invitation_version(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.publish_invitation_version(uuid, uuid, timestamptz)
  TO authenticated;

-- Takes the link down. Directive §15: after this the same URL must stop resolving,
-- and the answer a visitor gets must not say that a wedding is behind it.
CREATE FUNCTION api.revoke_invitation_publication(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_live  public.publications%ROWTYPE;
  v_count integer;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not revoke this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_live FROM public.publications
   WHERE wedding_id = p_wedding_id AND status = 'active';

  UPDATE private.access_tokens SET revoked_at = now()
   WHERE wedding_id = p_wedding_id
     AND token_kind = 'public_invitation'
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF FOUND THEN
    UPDATE public.publications
       SET status = 'revoked', revoked_at = now()
     WHERE id = v_live.id;
  END IF;

  RETURN jsonb_build_object(
    'revoked', FOUND OR v_count > 0,
    'publication_id', CASE WHEN FOUND THEN v_live.id END,
    'tokens_revoked', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION api.revoke_invitation_publication(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.revoke_invitation_publication(uuid) TO authenticated;

-- Replaces the secret without changing what it points at: the old address stops
-- working mid-conversation and the host gets a new one to send. Directive §16;
-- `snapshot unchanged` is asserted by the API suite comparing versions.
CREATE FUNCTION api.rotate_invitation_token(p_wedding_id uuid)
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

REVOKE ALL ON FUNCTION api.rotate_invitation_token(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.rotate_invitation_token(uuid) TO authenticated;

-- The host's preview, built from live rows through the same snapshot function and
-- the same projection a guest sees. This is why there is one renderer: a preview
-- cannot flatter an invitation into looking better than its guests will find it.
CREATE FUNCTION api.preview_invitation(p_wedding_id uuid)
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

REVOKE ALL ON FUNCTION api.preview_invitation(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.preview_invitation(uuid) TO authenticated;

-- The host's own publication state. `publications` is already readable through
-- RLS, but the status of the *credential* lives in `private` where no browser role
-- goes, and a host who asks "is my link live" deserves a yes from one round trip.
-- No token material of any kind is returned: there is nothing to return it from.
CREATE FUNCTION api.get_invitation_publication_state(p_wedding_id uuid)
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

REVOKE ALL ON FUNCTION api.get_invitation_publication_state(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.get_invitation_publication_state(uuid) TO authenticated;

-- ===========================================================================
-- 8. THE RESOLUTION BOUNDARY — THE ONLY ANONYMOUS DOOR
-- ===========================================================================

-- The credential arrives in a request header, and this function takes **no
-- arguments at all** — which is the mechanism, not a convention, behind directive
-- §6's "no token in the query string".
--
-- That design was forced by a measurement, not by taste. The obvious way to keep a
-- secret out of a URL is to declare the function VOLATILE, because PostgREST is
-- commonly described as refusing GET for volatile calls. On this stack it does not:
-- `GET /rest/v1/rpc/resolve_public_invitation?p_token=<token>` against the
-- argument-taking version of this function returned **HTTP 200 with the DTO**
-- (PostgREST v16.3, measured; the function was verified `provolatile = 'v'` in
-- `pg_proc` afterwards). A comment claiming otherwise would have been a lie, and a
-- query string is exactly where a share link ends up in a proxy access log, a
-- Referer header and the browser's own history.
--
-- So the parameter does not exist. With zero arguments, every request shape that
-- tries to name one fails before reaching any of this code — PostgREST answers
-- `PGRST202 could not find the function ... without parameters`/`with parameters
-- p_token` — which the API suite asserts in both directions. The one way in is
-- `request.headers`, a JSON setting PostgREST writes for itself from the request's
-- headers; the header name is a Stage 3 convention documented in
-- `docs/architecture/public-invitation-security.md`, and CORS preflight for it was
-- measured against the local Kong before this was written.
--
-- Every refusal is the same value. Not the same-shaped value, the same bytes:
-- `{"available": false}` for a missing header, a malformed token, an unknown one, a
-- revoked one and an expired one, so nothing a guest can observe tells them whether
-- an address ever belonged to anyone. Directive §18 accepts the generic "this
-- invitation is unavailable" precisely because it is the only answer.
-- The lookup, separated from the transport on purpose. Everything that decides
-- whether a credential is live — shape, digest, revocation, expiry, the
-- publication still being active, the snapshot still being readable — is here, as
-- SECURITY INVOKER, taking the token as plain text. `supabase/tests/stage3/
-- 30_publication.sql` can then drive every one of those branches with a row it
-- ages itself, which the HTTP layer cannot do from the outside: no test may wait
-- for a clock, and no test may hand itself a header.
--
-- It is not a privileged door. `private` has no USAGE for anon or authenticated
-- (Stage 2 file 1), it is revoked explicitly anyway, and when the DEFINER wrapper
-- below calls it the execution context is already the wrapper owner's, so nothing
-- is gained by reaching for it directly.
CREATE FUNCTION private.invitation_for_token(p_raw_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_hash text;
  v_dto  jsonb;
BEGIN
  -- Shape-checked before it is hashed, so a hostile string cannot make this
  -- function do arithmetic on junk; the check is the same one the minting side
  -- guarantees, and it is a filter, never an error.
  IF p_raw_token IS NULL OR octet_length(p_raw_token) <> 43 OR p_raw_token !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN NULL;
  END IF;

  v_hash := encode(extensions.digest(convert_to(p_raw_token, 'UTF8'), 'sha256'), 'hex');

  -- One join, one read. The predicates are the whole security property, in the
  -- order that costs least: the digest is a unique-index probe, and only then does
  -- anything ask whether the publication it names is still active, still unexpired,
  -- and still carries a snapshot this code can read.
  SELECT private.public_invitation_dto(v.snapshot_schema_version, v.snapshot)
    INTO v_dto
    FROM private.access_tokens t
    JOIN public.publications p ON p.id = t.publication_id
                              AND p.wedding_id = t.wedding_id
    JOIN public.invitation_versions v ON v.id = p.version_id
                                     AND v.wedding_id = p.wedding_id
   WHERE t.token_hash = v_hash
     AND t.token_kind = 'public_invitation'
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
     AND p.status = 'active';

  RETURN v_dto;  -- NULL covers "no such live invitation", which is all anyone may learn.
END;
$$;

REVOKE ALL ON FUNCTION private.invitation_for_token(text)
  FROM PUBLIC, anon, authenticated;

-- The transport: read the one header that may carry a credential, and hand the
-- answer to the browser. Nothing else about this function is a decision.
CREATE FUNCTION api.resolve_public_invitation()
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

REVOKE ALL ON FUNCTION api.resolve_public_invitation()
  FROM PUBLIC, anon, authenticated, service_role;
-- The exact caller set, not a superset. `service_role` is deliberately absent: it has
-- no USAGE on `api` (it does not need the browser boundary — it writes the tables the
-- boundary exists to protect), and a grant to a role that cannot reach the schema
-- would read as an invitation to fix that later.
GRANT EXECUTE ON FUNCTION api.resolve_public_invitation()
  TO anon, authenticated;

COMMENT ON FUNCTION api.resolve_public_invitation() IS
  'The only anonymous entry point. Credential in a request header, digest-only lookup, one generic refusal.';
COMMENT ON FUNCTION private.invitation_for_token(text) IS
  'Liveness rules for a public invitation credential: shape, digest, revocation, expiry, active publication.';
COMMENT ON FUNCTION private.build_invitation_snapshot(uuid) IS
  'The single definition of what an invitation consists of. Preview and versioning share it.';
COMMENT ON FUNCTION private.public_invitation_dto(integer, jsonb) IS
  'Guest-facing whitelist. Unknown snapshot shape returns NULL, which means unavailable.';
