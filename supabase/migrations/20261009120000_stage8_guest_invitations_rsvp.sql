-- Stage 8 — guest households, personalised household links, event scope and RSVP.
-- ===========================================================================
-- Forward-only. Nothing here rewrites a Stage 2-7 table, policy, grant or trigger body except
-- the two constraints this file tightens by name and the two publication verbs section 6
-- re-declares in full. No historical migration was edited.
--
-- What this file adds, in one line: the six database verbs the household-invitation workflow
-- needs, on tables and columns the schema reserved for them six stages ago.
--
--   * `public.guest_households`, `public.household_event_scopes` and `public.rsvp_responses`
--     existed from Stage 2 (`20260925120300_stage2_guests_approvals_rsvp.sql:18-100`) with their
--     composite keys, their one-answer-per-event UNIQUE, their `response_source` vocabulary and
--     their four owner policies — and no path that could write a guest's own answer, because the
--     only source value a client may write is `host_manual`.
--   * `private.access_tokens` already carried `token_kind = 'guest_invitation'`, the
--     `household_id` column and the composite FK to `guest_households (wedding_id, id)`. Nothing
--     minted, looked up, revoked or rotated that kind for six stages.
--
-- So the workflow is built out of reserved shapes rather than new ones. Every cross-wedding and
-- cross-household refusal Stage 8 needs is already a foreign key, and a key that has already been
-- attacked (Stage 2's `20_attacks.sql`) is a stronger guarantee than a predicate written here.
-- `docs/architecture/guest-rsvp-security.md` carries the rulings and the measurements behind
-- each choice; this file is the implementation of that document, and where the two disagree the
-- document is the one that has to say so.
--
-- What this file does NOT claim:
--   * It does not verify that the person holding a household link is a member of that household.
--     Possession of the link is the whole of the authorisation, exactly as it is for the wedding
--     link and the review link, and the blast radius of a leak is one household's own view and
--     one household's own answers.
--   * It rate-limits nothing. There is no edge function, no paid provider and no application
--     server in this repository, so there is nowhere a throttle could live; the design states that
--     as a limitation (`guest-rsvp-security.md` §10) rather than presenting a bearer credential as
--     an abuse control.
--   * It does not expose another household to a guest in any form — not its name, its answer, its
--     existence, or a count of either. The overlay is one hand-built object about one household
--     (section 5), and the batteries attack that claim by counting.
--   * It does not touch Stage 6's private asset protections, `tradition_pack_releases` review, or
--     the guest-facing uploaded-media question. Nothing here gives a guest a way to reach a bucket.
--   * It does not deliver a link to anybody. There is no email or SMS path; the host screen shows
--     each link once, to be copied.

-- ===========================================================================
-- 1. The credential's shape, tightened
-- ===========================================================================
-- `guest-rsvp-security.md` §2 records the measurement this repair rests on: the `guest_invitation`
-- and `rsvp` branches of the kind-shape CHECK each say `approval_request_id IS NULL` and are silent
-- about `approval_version_id`, while `public_invitation` says both. Under `MATCH SIMPLE` FK
-- semantics that leaves a household credential able to carry a pointer into a family's approval
-- version — the cross-family state the directive forbids in its own words. Nothing that exists can
-- produce such a row (no mint path sets that column for these kinds), so this is a latent gap, and
-- the repair is forward.
--
-- The constraint being replaced is `access_tokens_kind_shape`, measured from `pg_constraint` on the
-- live local stack and re-read from `20260926130000_stage3_publication_resolution_boundary.sql:191-214`,
-- which created it under that name. The other three branches are reproduced word for word so that no
-- wedding-link or review credential is validated differently than the stage that defined it does.
--
-- Safety of the replacement: `ALTER TABLE ... ADD CONSTRAINT ... CHECK` validates against existing
-- rows, and the tables this could fail on are empty on every chain — `guest_households`,
-- `household_event_scopes` and `rsvp_responses` appear in neither
-- `20260925120600_stage2_migrate_legacy_projects.sql` nor `20260925120700_stage2_archive_legacy_scaffold.sql`
-- (measured by grep, `q8-logs/s8-substrate-01.log`), and the running stack holds zero rows in each
-- (same capture). So the tightening cannot strand a deployment, and the battery proves the new arm
-- refuses rather than trusting this paragraph.
ALTER TABLE private.access_tokens
  DROP CONSTRAINT access_tokens_kind_shape;
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
      -- Household-scoped. Stage 8 is the first thing to mint this kind, so the new
      -- term costs nothing today and closes the gap permanently.
      WHEN 'guest_invitation' THEN publication_id IS NOT NULL
                                AND household_id IS NOT NULL
                                AND approval_request_id IS NULL
                                AND approval_version_id IS NULL
      -- Still unused vocabulary (`guest-rsvp-security.md` §3, Ruling 2.2). Tightened
      -- anyway: an arm that no verb can reach today should not be the arm that a
      -- later stage walks into unprepared.
      WHEN 'rsvp'             THEN publication_id IS NOT NULL
                                AND household_id IS NOT NULL
                                AND approval_request_id IS NULL
                                AND approval_version_id IS NULL
      WHEN 'approval_review'  THEN approval_request_id IS NOT NULL
                                AND approval_version_id IS NOT NULL
                                AND publication_id IS NULL
                                AND household_id IS NULL
    END
  );

-- At most one unrevoked household credential per household. Same purpose, same shape as
-- `one_live_public_token_per_publication` (Stage 3, `:219-223`) and
-- `one_live_token_per_approval_request` (Stage 7, `:900-904`): if a bug in the host path double-mints,
-- the bug surfaces as a `unique_violation` inside a battery instead of as a second live secret that no
-- screen can list and no one can revoke as a pair.
CREATE UNIQUE INDEX one_live_guest_token_per_household
  ON private.access_tokens (household_id)
 WHERE revoked_at IS NULL
   AND token_kind = 'guest_invitation'
   AND household_id IS NOT NULL;

-- ===========================================================================
-- 2. The answers column, bounded before anything writes into it
-- ===========================================================================
-- `rsvp_responses.answers` is Stage 2's slot for optional questions ("meal, transport,
-- accommodation", `20260925120300...:85-87`). Stage 8 asks no question and writes `'{}'`, and refuses
-- a body that tries to answer one — but the column must not become the place a browser can put
-- arbitrary prose into a host's database, so it gets a forward bound now.
--
-- The bound is on the stored text, not on the keys, and the reason is a limitation of the instrument
-- rather than of the design: a table CHECK may not contain a subquery, and `jsonb_object_keys` is a
-- set-returning function, so "at most eight keys, each value a string" is not expressible here. That
-- is the same wall Stage 2 hit for "at least one scope row exists" (`:43-45`). 2,000 octets is half the
-- ceiling `invitation_drafts_section_length_bound` puts on one field of host-authored prose
-- (`20260926130000_stage3_publication_resolution_boundary.sql:162-170`), which is the closest thing
-- this schema has to a stated size for "a sentence a guest meant" — with the units differing on
-- purpose, since Stage 3 counts `length()` characters of one extracted string and this counts the
-- octets of the whole encoded object. The per-key rule belongs to whichever later stage starts
-- accepting answers, in the RPC that validates them.
--
-- The name is deliberately unchanged. Stage 2 wrote this CHECK inline and unnamed (`:87`), so Postgres
-- generated `rsvp_responses_answers_check`, and `supabase/tests/stage2/20_attacks.sql:1495` pins that
-- exact string in the refusal it expects from a non-object answer. Re-adding the wider bound under a
-- fresh name would have made that historical probe report a different constraint, and the only way to
-- tell "the rule moved" from "the rule vanished" would have been to edit the old test — which is the
-- one move a qualification stage may not make to obtain a pass. Dropping and re-adding under the same
-- name keeps the refusal self-describing at both heads.
ALTER TABLE public.rsvp_responses
  DROP CONSTRAINT rsvp_responses_answers_check;
ALTER TABLE public.rsvp_responses
  ADD CONSTRAINT rsvp_responses_answers_check CHECK (
    jsonb_typeof(answers) = 'object'
    AND octet_length(answers::text) <= 2000
  );

-- ===========================================================================
-- 3. The host's verbs — authenticated only
-- ===========================================================================
-- Each body re-derives the caller from the JWT and refuses with one phrase for "not signed in",
-- "not your wedding" and "no such household", which is the standing rule for `internal_api`
-- (ADR 0006) and the shape Stage 3 fixed at `20260926130000...:539-548`. None of them trusts the
-- wrapper for anything.

-- 3.1 Send the links. Mints one credential per requested household, or reports the one that is
-- already live, and never both.
CREATE FUNCTION internal_api.issue_guest_invitations(
  p_wedding_id uuid,
  p_household_ids uuid[],
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner      uuid;
  v_publication uuid;
  v_found_pub  boolean := false;
  v_items      jsonb := '[]'::jsonb;
  v_issued     integer := 0;
  v_already    integer := 0;
  v_hid        uuid;
  v_name       text;
  v_existing   uuid;
  v_found_existing boolean;
  v_raw        text;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not send invitations for this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_household_ids IS NULL OR array_length(p_household_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'choose the households you are inviting'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Bounded in the body rather than by a new table CHECK, for the reason Stage 7 gives for its own
  -- bounded names (`20261008120000...:98-110`): the schema's constraint inventory is enumerated by
  -- Stage 2's catalogue assertions, and a limit that only ever governs one call does not belong there.
  IF array_length(p_household_ids, 1) > 200 THEN
    RAISE EXCEPTION 'two hundred households is the most one request may carry'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Checked, not merely relied on. The composite FK on `access_tokens` would refuse to point a
  -- wedding's credential at another family's household anyway, but a foreign key answers 23503 with
  -- the referencing key in its detail, which describes the database to a host who was only refused.
  -- A NULL id is refused by the first arm because no household row can answer to it. Duplicates are
  -- deliberately not refused: the loop below walks `guest_households`, so one family appears once no
  -- matter how many times its id was sent, and a host whose screen re-sends a row gets the truthful
  -- `already_live` answer rather than an error about their own list.
  IF (SELECT count(*) FROM unnest(p_household_ids) x WHERE x IS NULL) > 0
     OR (SELECT count(DISTINCT x) FROM unnest(p_household_ids) x)
       <> (SELECT count(*) FROM public.guest_households h
            WHERE h.wedding_id = p_wedding_id AND h.id = ANY (p_household_ids)) THEN
    RAISE EXCEPTION 'a household in this list is not a household of this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'a household link must be given a time in the future'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Ruling 3.3. A household credential is pinned to a publication by the kind CHECK itself
  -- (`publication_id IS NOT NULL`, section 1), so "build the guest list, then send the links" is not a
  -- sequence this schema can express before the couple has published. Say so, in the words Stage 3's
  -- rotate uses for the wedding link (`20260926150000...:388-391`), rather than minting nothing and
  -- reporting an empty success.
  SELECT p.id INTO v_publication
    FROM public.publications p
   WHERE p.wedding_id = p_wedding_id AND p.status = 'active';
  v_found_pub := FOUND;
  IF NOT v_found_pub THEN
    RAISE EXCEPTION 'publish the invitation before sending household links'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR v_hid, v_name IN
    SELECT h.id, h.display_name
      FROM public.guest_households h
     WHERE h.wedding_id = p_wedding_id AND h.id = ANY (p_household_ids)
     -- The caller's array order is not preserved: a list ordered by display order on the host's
     -- screen and by name here means the response and the table cannot disagree about which family
     -- a link belongs to. Stated because the host page prints this array. `display_name` is NOT NULL
     -- (`20260925120300...:21`), so plain name order has no NULL placement to decide, and `id` breaks
     -- a tie between two identically-named families. This is the same ordering `get_guest_invitation_state`
     -- uses for its whole list, so the two reads cannot disagree.
     ORDER BY h.display_name, h.id
  LOOP
    SELECT t.id INTO v_existing
      FROM private.access_tokens t
     WHERE t.household_id = v_hid
       AND t.token_kind = 'guest_invitation'
       AND t.revoked_at IS NULL
     FOR UPDATE;
    v_found_existing := FOUND;

    IF v_found_existing THEN
      -- Nothing is minted and nothing is revealed. A raw credential is legible exactly once, in the
      -- response that created it, so re-running "send the links" cannot be a way to read an old secret
      -- a second time — and cannot be a way to make a second live secret for one family.
      v_already := v_already + 1;
      v_items := v_items || jsonb_build_object(
        'household_id', v_hid,
        'display_name', v_name,
        'status', 'already_live',
        'path', NULL
      );
    ELSE
      -- Same generator, same alphabet, same digest-only storage as the wedding link
      -- (`20260926130000...:505-530`) and the review link (`20261008120000...:127-140`). Written inline
      -- rather than in a new `private` helper for Ruling 3.1's reason: `private`'s function inventory is
      -- counted by head-aware catalogue assertions in three earlier suites, and a helper whose whole body
      -- is two expressions would move three assertions to save four lines. The batteries pin the two
      -- copies against each other by resolving a credential minted here at the door in section 5.
      --
      -- The row this writes also freezes the household against the host's own delete, by the `NO ACTION`
      -- key at `20260925120400...:169`. That is Stage 2's accepted consequence for a credential-bearing
      -- aggregate (`20_attacks.sql` group 11e, `stage-2-migration-plan.md:188`), now applied one level
      -- down for the first time; `guest-rsvp-security.md` §7 rules it and §12 gives the tiers their
      -- teardown order because of it. Withdrawal is the user-facing answer, and the host screen offers
      -- deletion only for a household that never received a link.
      v_raw := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

      INSERT INTO private.access_tokens (
        token_hash, token_kind, wedding_id, publication_id, household_id,
        expiry_policy, expires_at
      ) VALUES (
        encode(extensions.digest(convert_to(v_raw, 'UTF8'), 'sha256'), 'hex'),
        'guest_invitation',
        p_wedding_id,
        v_publication,
        v_hid,
        CASE WHEN p_expires_at IS NULL THEN 'no_expiry' ELSE 'fixed' END,
        p_expires_at
      );

      v_issued := v_issued + 1;
      v_items := v_items || jsonb_build_object(
        'household_id', v_hid,
        'display_name', v_name,
        'status', 'issued',
        'path', '/g/' || v_raw
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'wedding_id', p_wedding_id,
    'publication_id', v_publication,
    'issued', v_issued,
    'already_live', v_already,
    'expires_at', p_expires_at,
    'invitations', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION internal_api.issue_guest_invitations(uuid, uuid[], timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.issue_guest_invitations(uuid, uuid[], timestamptz)
  TO authenticated;

-- 3.2 Take one household's link away. The household row and its answers stay; only the secret dies.
CREATE FUNCTION internal_api.revoke_guest_invitation(p_household_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner   uuid;
  v_wedding uuid;
  v_found   boolean := false;
  v_count   integer;
  v_now     timestamptz := now();
BEGIN
  v_owner := auth.uid();
  IF p_household_id IS NULL THEN
    RAISE EXCEPTION 'name the household whose link you are withdrawing'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT h.wedding_id INTO v_wedding
    FROM public.guest_households h
   WHERE h.id = p_household_id;
  v_found := FOUND;

  -- One refusal for "no such household" and "not your household", so that poking this verb with a
  -- stranger's uuid cannot enumerate which households exist in which weddings.
  IF NOT v_found OR v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = v_wedding AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not withdraw this household''s link'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE private.access_tokens SET revoked_at = v_now
   WHERE household_id = p_household_id
     AND token_kind = 'guest_invitation'
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'household_id', p_household_id,
    'revoked', v_count > 0,
    'credentials_revoked', v_count,
    -- The value written above, reported back rather than re-read: `now()` is the transaction's
    -- timestamp, so a second call to it would return the same instant, and an earlier draft of a
    -- sibling function in this product returned a captured NULL and was caught by the API suite
    -- (`20260926150000...:404-406`).
    'revoked_at', CASE WHEN v_count > 0 THEN v_now END
  );
END;
$$;

REVOKE ALL ON FUNCTION internal_api.revoke_guest_invitation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.revoke_guest_invitation(uuid) TO authenticated;

-- 3.3 Replace one household's link with a new secret. Revoke first, then mint, in that order and in
-- one transaction, as rotation already works at the wedding door (`20260926150000...:393-410`): a
-- failed mint cannot leave two live secrets, and a successful one never leaves the old address
-- resolving.
CREATE FUNCTION internal_api.rotate_guest_invitation(p_household_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner       uuid;
  v_wedding     uuid;
  v_publication uuid;
  v_found_hh    boolean := false;
  v_found_pub   boolean := false;
  v_old         private.access_tokens%ROWTYPE;
  v_raw         text;
  v_revoked_at  timestamptz := now();
  v_expires     timestamptz;
BEGIN
  v_owner := auth.uid();
  IF p_household_id IS NULL THEN
    RAISE EXCEPTION 'name the household whose link you are replacing'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT h.wedding_id INTO v_wedding
    FROM public.guest_households h
   WHERE h.id = p_household_id;
  v_found_hh := FOUND;

  IF NOT v_found_hh OR v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = v_wedding AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not rotate this household''s link'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.id INTO v_publication
    FROM public.publications p
   WHERE p.wedding_id = v_wedding AND p.status = 'active';
  v_found_pub := FOUND;
  IF NOT v_found_pub THEN
    RAISE EXCEPTION 'there is no published invitation to rotate'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_old FROM private.access_tokens
   WHERE household_id = p_household_id
     AND token_kind = 'guest_invitation'
     AND revoked_at IS NULL
   ORDER BY created_at DESC
   FOR UPDATE;
  IF NOT FOUND THEN
    -- Distinct from the refusals above because it is not a boundary question. The caller has already
    -- been established as this household's host; what is missing is a live link, which is a fact about
    -- their own wedding and is theirs to be told.
    RAISE EXCEPTION 'this household has no live link to rotate'
      USING ERRCODE = 'raise_exception';
  END IF;

  -- The expiry a host set for a family is carried across the replacement. What is being rotated is
  -- the secret, not the deadline; silently extending a revoked-by-time link would be the host's
  -- decision made by a button labelled "new link".
  --
  -- A deadline that has already passed is the one case that cannot be carried, and it is refused
  -- here rather than discovered by the table. The row this verb writes has `created_at = now()`, and
  -- `access_tokens` requires `expires_at > created_at` (`20260925120400...:150`), so copying an
  -- expired instant onto the successor would abort the whole call with a `23514` from a constraint
  -- the host has never seen — and would abort it *after* `v_old` had been selected `FOR UPDATE`, so
  -- the transaction rolls back and the dead link stays dead while the button reports a database
  -- error. The actionable answer already exists as a pair of verbs: withdraw the expired link, then
  -- send the family a new one. `get_guest_invitation_state`'s own CASE (§3.4) reports this state as
  -- `expired`, so the host screen and the refusal use one word.
  IF v_old.expiry_policy = 'fixed' AND v_old.expires_at <= now() THEN
    RAISE EXCEPTION 'this household''s link has already expired; withdraw it and send a new one'
      USING ERRCODE = 'raise_exception';
  END IF;

  v_expires := CASE WHEN v_old.expiry_policy = 'fixed' THEN v_old.expires_at END;

  UPDATE private.access_tokens SET revoked_at = v_revoked_at WHERE id = v_old.id;

  v_raw := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  INSERT INTO private.access_tokens (
    token_hash, token_kind, wedding_id, publication_id, household_id,
    expiry_policy, expires_at
  ) VALUES (
    encode(extensions.digest(convert_to(v_raw, 'UTF8'), 'sha256'), 'hex'),
    'guest_invitation',
    v_wedding,
    v_publication,
    p_household_id,
    CASE WHEN v_expires IS NULL THEN 'no_expiry' ELSE 'fixed' END,
    v_expires
  );

  RETURN jsonb_build_object(
    'household_id', p_household_id,
    'publication_id', v_publication,
    'path', '/g/' || v_raw,
    'previous_revoked_at', v_revoked_at,
    'expires_at', v_expires
  );
END;
$$;

REVOKE ALL ON FUNCTION internal_api.rotate_guest_invitation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.rotate_guest_invitation(uuid) TO authenticated;

-- 3.4 What the host may know about their own families' links. An RPC rather than a client query for
-- one reason: link state lives in `private.access_tokens`, which no browser role may read
-- (`20260925120400...:188-199`).
CREATE FUNCTION internal_api.get_guest_invitation_state(p_wedding_id uuid)
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

  -- One row per household, and no token material in any of them: not the digest, not the secret, not
  -- anything from which either could be recovered. The vocabulary of `link_state` is Stage 7's,
  -- published for its own queue (`20261008120000...:264-267`), so one word means one thing across both
  -- host screens.
  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.display_name, x.household_id), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT h.id AS household_id,
             h.display_name,
             h.salutation,
             h.expected_party_size,
             CASE WHEN t.id IS NULL THEN 'never_issued'
                  WHEN t.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN t.expires_at IS NOT NULL AND t.expires_at <= now() THEN 'expired'
                  ELSE 'live' END AS link_state,
             t.expires_at AS link_expires_at,
             t.last_used_at AS link_last_used_at,
             (SELECT count(*) FROM public.household_event_scopes s
               WHERE s.wedding_id = h.wedding_id AND s.household_id = h.id) AS scoped_event_count,
             (SELECT count(*) FROM public.rsvp_responses r
               WHERE r.wedding_id = h.wedding_id AND r.household_id = h.id) AS reply_count,
             (SELECT count(*) FROM public.rsvp_responses r
               WHERE r.wedding_id = h.wedding_id AND r.household_id = h.id
                 AND r.attending = 'attending') AS attending_count
        FROM public.guest_households h
        -- The household's own credential, preferring the live one when both a dead and a live row
        -- exist, which is the whole point of rotation leaving history behind. Same LATERAL shape as
        -- Stage 7's queue read (`:287-297`).
        LEFT JOIN LATERAL (
          SELECT c.id, c.revoked_at, c.expires_at, c.last_used_at
            FROM private.access_tokens c
           WHERE c.household_id = h.id
             AND c.token_kind = 'guest_invitation'
           ORDER BY (c.revoked_at IS NULL
                     AND (c.expires_at IS NULL OR c.expires_at > now())) DESC,
                    c.created_at DESC,
                    c.id
           LIMIT 1
        ) t ON true
       WHERE h.wedding_id = p_wedding_id
    ) x;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION internal_api.get_guest_invitation_state(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.get_guest_invitation_state(uuid) TO authenticated;

-- ===========================================================================
-- 4. The read door
-- ===========================================================================
-- Zero arguments, deliberately, and the reason is measured rather than stylistic: PostgREST v16.3
-- answers a GET that names a parameter with HTTP 200 against an argument-taking volatile function, so a
-- credential in a query string would *work* — the failure Stage 3 removed by deleting the parameter
-- (`20260926130000...:937-958`). The secret arrives in `x-guest-token`, which PostgREST writes into
-- `request.headers` from the request, and a request that names a parameter cannot reach this SQL at all.
--
-- The answer is the frozen document plus one hand-built object about one household. Ruling 5.1 of the
-- design doc is the argument; the shape below is the implementation of it, and Ruling 5.2's discipline
-- is why nothing here is a row: `host_notes` sits on the same table as the greeting, so a projection
-- that "just returns the household" would hand a host's private notes about a family to that family.
CREATE FUNCTION internal_api.resolve_guest_invitation()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_unavailable constant jsonb := jsonb_build_object('available', false);
  v_raw       text;
  v_hash      text;
  v_token     uuid;
  v_wedding   uuid;
  v_household uuid;
  v_version   uuid;
  v_expires   timestamptz;
  v_dto       jsonb;
  v_number    integer;
  v_name      text;
  v_greeting  text;
  v_expected  integer;
  v_found_hh  boolean;
  v_events    jsonb;
BEGIN
  v_raw := current_setting('request.headers', true)::jsonb ->> 'x-guest-token';
  -- Shape before arithmetic, and a filter rather than an error: junk never reaches a digest, and a
  -- hostile string cannot make this function do work on it.
  IF v_raw IS NULL OR octet_length(v_raw) <> 43 OR v_raw !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN v_unavailable;
  END IF;

  v_hash := encode(extensions.digest(convert_to(v_raw, 'UTF8'), 'sha256'), 'hex');

  -- The liveness rule in one join, in the order that costs least: a unique-index equality on the
  -- digest, then the kind, then revocation and expiry, then the publication the credential is pinned
  -- to still being active. `p.status = 'active'` is what makes Ruling 8.1's takedown widening visible
  -- at this door: a withdrawn document stops resolving for every family at once, without a row-by-row
  -- revoke having to have happened first.
  SELECT t.id, t.wedding_id, t.household_id, t.expires_at, p.version_id
    INTO v_token, v_wedding, v_household, v_expires, v_version
    FROM private.access_tokens t
    JOIN public.publications p
      ON p.id = t.publication_id
     AND p.wedding_id = t.wedding_id
   WHERE t.token_hash = v_hash
     AND t.token_kind = 'guest_invitation'
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
     AND p.status = 'active';

  IF NOT FOUND THEN
    RETURN v_unavailable;
  END IF;

  SELECT v.version_number,
         private.public_invitation_dto(v.snapshot_schema_version, v.snapshot)
    INTO v_number, v_dto
    FROM public.invitation_versions v
   WHERE v.id = v_version;

  IF v_dto IS NULL THEN
    -- A snapshot this build cannot draw is not a document to read. The guest page answers the same way
    -- for the same reason (Stage 4's `WHEN OTHERS THEN RETURN NULL` posture,
    -- `20260927120000_stage4_tradition_pack_releases.sql:1387-1389`): a partial render of a wedding is
    -- a lie about it, and a greeting with no invitation behind it is the same lie with a name in it.
    RETURN v_unavailable;
  END IF;

  SELECT h.display_name,
         coalesce(nullif(btrim(coalesce(h.salutation, '')), ''), h.display_name),
         h.expected_party_size
    INTO v_name, v_greeting, v_expected
    FROM public.guest_households h
   WHERE h.id = v_household;
  v_found_hh := FOUND;

  IF NOT v_found_hh THEN
    -- Unreachable through this schema today: the composite FK from `access_tokens` to
    -- `guest_households` is `NO ACTION`, so a household with any credential row cannot be deleted
    -- under it. The guard is here because the answer's shape is a promise — `display_name` and
    -- `greeting` are always text — and a null in either slot would be a defect the page cannot see.
    RETURN v_unavailable;
  END IF;

  -- This household's own list, from its own scope rows, in the order the document itself uses
  -- (`build_invitation_snapshot`'s `ORDER BY e.display_order, e.starts_at_local, e.id`,
  -- `20260927120000...:1138`) so the panel under the invitation does not reorder the wedding.
  -- `enabled = false` takes a card out of the running without taking it out of the frozen document;
  -- §6's fifth row rules that the guest may not answer it, which is what the join does here.
  -- Each item carries the household's own latest answer, because "what did we already say" is the
  -- guest's fact and a returning family must not have to guess.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'event_id', e.id,
           'display_name', e.display_name,
           'starts_at_local', to_char(e.starts_at_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
           'ends_at_local', CASE WHEN e.ends_at_local IS NULL THEN NULL
                                 ELSE to_char(e.ends_at_local, 'YYYY-MM-DD"T"HH24:MI:SS') END,
           'timezone', e.timezone,
           'attending', r.attending,
           'party_size', r.party_size,
           'responded_at', r.responded_at
         ) ORDER BY e.display_order, e.starts_at_local, e.id), '[]'::jsonb)
    INTO v_events
    FROM public.household_event_scopes s
    JOIN public.wedding_events e
      ON e.id = s.event_id AND e.wedding_id = s.wedding_id AND e.enabled
     AND s.wedding_id = v_wedding AND s.household_id = v_household
    LEFT JOIN public.rsvp_responses r
      ON r.wedding_id = s.wedding_id
     AND r.household_id = s.household_id
     AND r.event_id = s.event_id;

  -- `last_used_at`, written only on a read that succeeded. A forged, revoked, expired or withdrawn
  -- token leaves the field exactly where it was, so a host's "has this family opened the invitation"
  -- cannot be poisoned by somebody probing for live links. What it does not prove is stated in the
  -- design doc rather than here: a household link is held by a household.
  UPDATE private.access_tokens
     SET last_used_at = now()
   WHERE id = v_token;

  -- The invitation half is `private.public_invitation_dto` unchanged, which is what keeps
  -- preview/freeze/publication parity intact and keeps this document readable by an earlier renderer
  -- (Ruling 5.1). No key below is derived from anything but this household's rows: no other name, no
  -- count of anyone else, no `host_notes`, no entitlement, no `estimated_guest_count`, no approval
  -- material, no token column.
  RETURN jsonb_build_object(
    'available', true,
    'guest', jsonb_build_object(
      'household_id', v_household,
      'display_name', v_name,
      'greeting', v_greeting,
      'expected_party_size', v_expected,
      'version_number', v_number,
      'can_respond', jsonb_array_length(v_events) > 0,
      'responds_until', v_expires,
      'events', v_events
    ),
    'invitation', v_dto
  );
END;
$$;

REVOKE ALL ON FUNCTION internal_api.resolve_guest_invitation()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.resolve_guest_invitation() TO anon, authenticated;

-- ===========================================================================
-- 5. The write door
-- ===========================================================================
-- The household's answer, for the events its own credential resolves to, in one transaction,
-- all-or-nothing. It takes the answers as one argument and the credential as a header — the same
-- division Stage 7 established for the review answer, and for the same measured reason: a parameter
-- that could carry the secret is a parameter somebody will eventually pass the secret through.
--
-- Two refusal families, and the line between them is Ruling 4.1. A problem with the *body* is
-- actionable and specific, and is raised as an exception before the credential is read, because a
-- malformed submission says nothing about anybody's link (Stage 7's decision-verb check at
-- `20261008120000...:528-541` is the precedent, including the `IS NULL` half that a JSON null needs).
-- A problem with *access* — missing, malformed, unknown, forged, revoked, expired, rotated-away,
-- withdrawn publication, an event this household was not given — is one indistinguishable
-- `{"recorded": false, "reason": "unavailable"}`, and writes nothing. Between them sit exactly two
-- correctable answer problems, `party_size_too_large` and `answers_not_accepted`, and the battery
-- proves that no credential state can produce either.
CREATE FUNCTION internal_api.submit_guest_rsvp(p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_unavailable constant jsonb := jsonb_build_object('recorded', false, 'reason', 'unavailable');
  v_too_large   constant jsonb := jsonb_build_object('recorded', false, 'reason', 'party_size_too_large');
  v_not_asked   constant jsonb := jsonb_build_object('recorded', false, 'reason', 'answers_not_accepted');
  v_bad_shape   constant text := 'the answers submitted are not in the shape this invitation records';
  v_raw         text;
  v_hash        text;
  v_wedding     uuid;
  v_household   uuid;
  v_expected    integer;
  v_item        jsonb;
  v_eid         uuid;
  v_att         text;
  v_party       integer;
  v_ids         uuid[] := '{}';
  v_attending   text[] := '{}';
  v_parties     integer[] := '{}';
  v_i           integer;
  v_now         timestamptz;
  v_rows        integer;
  v_written     integer := 0;
  v_seen        text;
BEGIN
  -- Body first, credential second, and neither before the shape test.
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object' THEN
    RAISE EXCEPTION '%', v_bad_shape USING ERRCODE = 'check_violation';
  END IF;
  -- Each of the four tests below names its key's absence as well as its wrong type, and the reason is
  -- three-valued logic rather than style: `jsonb_typeof()` answers SQL NULL for a missing key, so
  -- `jsonb_typeof(x) <> 'array'` is NULL — not true — for exactly the bodies this test exists to refuse.
  -- Before that was written down, `{}` and `{"welcome":"x"}` fell through to a successful return of
  -- `recorded: true, events_recorded: 0`, and a card missing `attending` or `party_size` reached the
  -- INSERT and aborted there with a `23502` naming a table and a column — the same leak the uuid test
  -- below exists to close, arriving by a different route.
  IF p_answers -> 'events' IS NULL
     OR jsonb_typeof(p_answers -> 'events') <> 'array'
     OR jsonb_array_length(p_answers -> 'events') = 0 THEN
    RAISE EXCEPTION '%', v_bad_shape USING ERRCODE = 'check_violation';
  END IF;
  -- A wedding has a handful of events; a submission naming fifty is a scripted probe, and refusing it
  -- here keeps the loop below bounded without a new constraint on any table.
  IF jsonb_array_length(p_answers -> 'events') > 20 THEN
    RAISE EXCEPTION 'too many answers in one submission' USING ERRCODE = 'check_violation';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_answers -> 'events') LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION '%', v_bad_shape USING ERRCODE = 'check_violation';
    END IF;

    -- An optional-question answer, at this door, is not a question this invitation asked. Named as its
    -- own refusal rather than as junk because the guest-facing wording differs: "the couple is not
    -- asking that yet" is actionable, "your request is malformed" is insulting.
    IF v_item ? 'answers' THEN
      IF jsonb_typeof(v_item -> 'answers') <> 'object'
         OR (v_item -> 'answers') <> '{}'::jsonb THEN
        RETURN v_not_asked;
      END IF;
    END IF;

    IF EXISTS (
         SELECT 1 FROM (SELECT jsonb_object_keys(v_item) AS k) t
          WHERE t.k NOT IN ('event_id', 'attending', 'party_size', 'answers')
        ) THEN
      RAISE EXCEPTION '%', v_bad_shape USING ERRCODE = 'check_violation';
    END IF;

    IF v_item -> 'event_id' IS NULL
       OR jsonb_typeof(v_item -> 'event_id') <> 'string' THEN
      RAISE EXCEPTION '%', v_bad_shape USING ERRCODE = 'check_violation';
    END IF;
    -- Checked as text before it is cast: a uuid cast that fails answers 22P02 with the offending
    -- string in its message, which is a description of the database to somebody who was only refused.
    v_seen := (v_item ->> 'event_id');
    IF v_seen !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION '%', v_bad_shape USING ERRCODE = 'check_violation';
    END IF;
    v_eid := v_seen::uuid;

    IF v_item -> 'attending' IS NULL
       OR jsonb_typeof(v_item -> 'attending') <> 'string'
       OR (v_item ->> 'attending') NOT IN ('attending', 'declined') THEN
      RAISE EXCEPTION '%', v_bad_shape USING ERRCODE = 'check_violation';
    END IF;
    v_att := v_item ->> 'attending';

    -- `party_size` is required. Stage 2's column default is 0, and an "attending" row with a headcount
    -- of zero is a contradiction the host panel would read as nobody coming; the page always sends a
    -- number, so making it explicit costs nothing and removes the invented default of 1.
    IF v_item -> 'party_size' IS NULL
       OR jsonb_typeof(v_item -> 'party_size') <> 'number' THEN
      RAISE EXCEPTION '%', v_bad_shape USING ERRCODE = 'check_violation';
    END IF;
    -- `jsonb_typeof` says "number" for 1 and for 1.5, and the text form of the second is refused by an
    -- integer cast with 22P02 and the offending string in its message — the same leak the uuid test
    -- above exists to close. So the digits are checked before the cast, not after it.
    IF (v_item ->> 'party_size') !~ '^-?[0-9]+$' THEN
      RAISE EXCEPTION '%', v_bad_shape USING ERRCODE = 'check_violation';
    END IF;
    v_party := (v_item ->> 'party_size')::int;
    IF v_party < 0 OR v_party > 1000
       OR (v_att = 'attending' AND v_party < 1) THEN
      RAISE EXCEPTION '%', v_bad_shape USING ERRCODE = 'check_violation';
    END IF;

    IF v_eid = ANY (v_ids) THEN
      RAISE EXCEPTION 'the same event was answered twice' USING ERRCODE = 'check_violation';
    END IF;

    v_ids := v_ids || v_eid;
    v_attending := v_attending || v_att;
    v_parties := v_parties || v_party;
  END LOOP;

  v_raw := current_setting('request.headers', true)::jsonb ->> 'x-guest-token';
  IF v_raw IS NULL OR octet_length(v_raw) <> 43 OR v_raw !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN v_unavailable;
  END IF;

  v_hash := encode(extensions.digest(convert_to(v_raw, 'UTF8'), 'sha256'), 'hex');

  SELECT t.wedding_id, t.household_id
    INTO v_wedding, v_household
    FROM private.access_tokens t
    JOIN public.publications p
      ON p.id = t.publication_id
     AND p.wedding_id = t.wedding_id
   WHERE t.token_hash = v_hash
     AND t.token_kind = 'guest_invitation'
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
     AND p.status = 'active';

  IF NOT FOUND THEN
    -- One answer for malformed, unknown, forged, revoked, expired, rotated-away and withdrawn. A
    -- holder of a dead credential is not entitled to learn which of those it was.
    RETURN v_unavailable;
  END IF;

  SELECT h.expected_party_size INTO v_expected
    FROM public.guest_households h
   WHERE h.id = v_household AND h.wedding_id = v_wedding;
  IF NOT FOUND THEN
    RETURN v_unavailable;
  END IF;

  -- The cap, and the reason it is asymmetric. `expected_party_size` is the host's expectation, so a
  -- guest may not raise the headcount past it; the host's own manual entry is not capped, because a
  -- host transcribing a phone call is recording a fact rather than exercising a permission (§7). A
  -- refusal happens before any write, and names the ceiling in the returned shape so the page can say
  -- "you may bring up to N" without a second round trip.
  FOR v_i IN 1 .. array_length(v_ids, 1) LOOP
    IF v_attending[v_i] = 'attending'
       AND v_expected IS NOT NULL
       AND v_parties[v_i] > v_expected THEN
      RETURN v_too_large;
    END IF;
  END LOOP;

  -- Every named event must be one this household was invited to and the couple is still running. The
  -- scope row is the whole of the authority: an id that was not issued to this household either has no
  -- scope row or names an event of another wedding, and both answer with the same bytes a dead
  -- credential answers with, so "not yours" cannot be distinguished from "does not exist".
  FOR v_i IN 1 .. array_length(v_ids, 1) LOOP
    IF NOT EXISTS (
         SELECT 1 FROM public.household_event_scopes s
          WHERE s.wedding_id = v_wedding AND s.household_id = v_household AND s.event_id = v_ids[v_i]
        )
       OR NOT EXISTS (
         SELECT 1 FROM public.wedding_events e
          WHERE e.id = v_ids[v_i] AND e.wedding_id = v_wedding AND e.enabled
        ) THEN
      RETURN v_unavailable;
    END IF;
  END LOOP;

  v_now := now();
  FOR v_i IN 1 .. array_length(v_ids, 1) LOOP
    -- `ON CONFLICT DO UPDATE` over Stage 2's one-answer UNIQUE
    -- (`20260925120300...:90-92`) is the revision model: a family that mis-taps corrects its answer,
    -- and the only record that matters is the household's latest position. `response_source` becomes
    -- `'guest'` here and nowhere else; a guest's submission outranks a `host_manual` row, and the
    -- reverse direction stays blocked by the inherited policy WITH CHECK
    -- (`20260925120500_stage2_rls_and_grants.sql:285-294`), which this file does not touch.
    INSERT INTO public.rsvp_responses (
      wedding_id, household_id, event_id, attending, party_size,
      response_source, responded_at, answers
    ) VALUES (
      v_wedding, v_household, v_ids[v_i], v_attending[v_i], v_parties[v_i],
      'guest', v_now, '{}'::jsonb
    )
    ON CONFLICT (wedding_id, household_id, event_id) DO UPDATE
      SET attending = EXCLUDED.attending,
          party_size = EXCLUDED.party_size,
          response_source = 'guest',
          responded_at = v_now,
          answers = '{}'::jsonb;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_written := v_written + v_rows;
  END LOOP;

  -- No `last_used_at` stamp on this path. The field means "the invitation was opened", and only the
  -- read door may write it; an answer arriving without a read would be a claim the host did not ask
  -- for and a value a probe could move.
  RETURN jsonb_build_object(
    'recorded', true,
    'household_id', v_household,
    'events_recorded', v_written,
    'responded_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION internal_api.submit_guest_rsvp(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.submit_guest_rsvp(jsonb) TO anon, authenticated;

-- ===========================================================================
-- 6. The two publication verbs, re-declared to move household credentials with them
-- ===========================================================================
-- Ruling 8.1. Today `publish_invitation_version` retargets only `token_kind = 'public_invitation'`
-- (`20260926150000...:264-286`) and `revoke_invitation_publication` revokes only that kind (`:339-342`).
-- Without a change here, a host publishing a corrected version would strand every household link on the
-- revoked publication it replaced: each family's saved address would answer `available: false` while the
-- wedding's own link worked. That is a wrong behaviour, not merely an unwritten one.
--
-- Both bodies are reproduced in full from the current definitions, and the only additions are marked.
-- `CREATE OR REPLACE` keeps each body's owner, its grants and its `prosecdef` flag, which the Stage 3
-- catalogue assertions read (API33/C26); the COMMENT is restated in section 8 so the catalog does not
-- carry a sentence that no longer describes the function.

CREATE OR REPLACE FUNCTION internal_api.publish_invitation_version(
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
  -- Captured per lookup rather than read from `FOUND` later in the body. See the Stage 3 header.
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

  -- Stage 8's addition, and the direction of it is set by the precedent above: retargeting rather than
  -- re-minting is why a family's saved link survives a revision at all
  -- (`20260926130000...:98-107`). Every live household credential of this wedding follows the
  -- publication it is pinned to, so a corrected salutation does not silently cut forty families out of
  -- their own invitation. Same wedding, so the composite FK accepts it; another family's credential is
  -- not a thing this statement can express. `api.rotate_invitation_token` keeps its kind filter, so
  -- rotating the wedding link still cannot touch a household's secret.
  UPDATE private.access_tokens
     SET publication_id = v_publication,
         expires_at = COALESCE(p_expires_at, expires_at),
         expiry_policy = CASE WHEN p_expires_at IS NOT NULL THEN 'fixed'
                              ELSE expiry_policy END
   WHERE wedding_id = p_wedding_id
     AND token_kind = 'guest_invitation'
     AND revoked_at IS NULL;

  RETURN jsonb_build_object(
    'publication_id', v_publication,
    'version_id', p_version_id,
    'path', CASE WHEN v_raw IS NULL THEN NULL ELSE '/i/' || v_raw END,
    'link_reused', (v_raw IS NULL),
    'expires_at', p_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION internal_api.revoke_invitation_publication(p_wedding_id uuid)
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

  SELECT p.id INTO v_publication_id
    FROM public.publications p
   WHERE p.wedding_id = p_wedding_id AND p.status = 'active';
  v_publication_found := FOUND;

  -- Stage 8's widening, and it is a tightening: revoking a publication withdraws the *content*, so
  -- leaving forty household links live after a takedown would be a breach of the host's decision. Both
  -- kinds of this wedding go; `tokens_revoked` counts them honestly, which is why the census in
  -- `supabase/tests/api/run.sh` reports the kind-filtered line as well as the total.
  UPDATE private.access_tokens SET revoked_at = now()
   WHERE wedding_id = p_wedding_id
     AND token_kind IN ('public_invitation', 'guest_invitation')
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Tested on the captured boolean, not on `FOUND`: whether a credential row was there to revoke must
  -- not decide whether the publication itself stops being live (Stage 3's own repair of this exact
  -- mistake, `20260926150000...:345-359`).
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

-- ===========================================================================
-- 7. The exposed wrappers — each one line of delegation
-- ===========================================================================
-- The layout Stage 3 fixed and Stage 7 followed: `api` is served by PostgREST, `internal_api` is not
-- (`supabase/config.toml:32` lists `public` and `api`), so a privileged body cannot be reached by a
-- REST call while its one-line INVOKER wrapper can. `SECURITY INVOKER` is written out although it is
-- the default, because the two postures being readable side by side from the catalog is the point, and
-- `SET search_path = ''` on a wrapper that only delegates is what stops a caller steering which schema
-- the delegation resolves through.

CREATE OR REPLACE FUNCTION api.issue_guest_invitations(
  p_wedding_id uuid,
  p_household_ids uuid[],
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.issue_guest_invitations(p_wedding_id, p_household_ids, p_expires_at);
$$;

CREATE OR REPLACE FUNCTION api.revoke_guest_invitation(p_household_id uuid)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.revoke_guest_invitation(p_household_id);
$$;

CREATE OR REPLACE FUNCTION api.rotate_guest_invitation(p_household_id uuid)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.rotate_guest_invitation(p_household_id);
$$;

CREATE OR REPLACE FUNCTION api.get_guest_invitation_state(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.get_guest_invitation_state(p_wedding_id);
$$;

CREATE OR REPLACE FUNCTION api.resolve_guest_invitation()
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.resolve_guest_invitation();
$$;

CREATE OR REPLACE FUNCTION api.submit_guest_rsvp(p_answers jsonb)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.submit_guest_rsvp(p_answers);
$$;

-- ===========================================================================
-- 8. The caller matrix
-- ===========================================================================
-- `service_role` is absent from both halves of every pair, as it is for all the existing wrappers: it
-- has no USAGE on `api` or `internal_api`, it is not a browser, and it already owns the grants on the
-- tables these bodies write.
--
-- `anon` is granted exactly the two household-door functions. A guest has no account, so `anon` is the
-- only role they can ever be, and the alternative — a policy granting `anon` a table — would fail
-- Stage 2's C18 and is not available. This makes three anonymous doors in the product
-- (`resolve_public_invitation`, `resolve_family_review`/`submit_family_review`, and these two), and each
-- one is a header, a digest probe and a generic refusal; none of them is a table.
--
-- Ruling 8.2, asserted rather than promised: no new table privilege, no new role grant, no new exposed
-- schema, and the SELECT/write lists in `20260925120500...:27-61` are untouched. The catalogue tripwires
-- that watch for exactly this drift are widened for this head in `supabase/tests/`, not silenced.

REVOKE ALL ON FUNCTION api.issue_guest_invitations(uuid, uuid[], timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.issue_guest_invitations(uuid, uuid[], timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION api.revoke_guest_invitation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.revoke_guest_invitation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION api.rotate_guest_invitation(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.rotate_guest_invitation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION api.get_guest_invitation_state(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.get_guest_invitation_state(uuid) TO authenticated;

REVOKE ALL ON FUNCTION api.resolve_guest_invitation()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.resolve_guest_invitation() TO anon, authenticated;

REVOKE ALL ON FUNCTION api.submit_guest_rsvp(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.submit_guest_rsvp(jsonb) TO anon, authenticated;

-- ===========================================================================
-- 9. Posture, written where a reader of the catalog will find it
-- ===========================================================================
COMMENT ON FUNCTION internal_api.issue_guest_invitations(uuid, uuid[], timestamptz) IS
  'Host verb. Mints one guest_invitation credential per requested household of the caller''s own wedding, pinned to the active publication, or reports the household''s existing live link as already_live with no path. Returns each raw token exactly once, in the call that created it, and stores only its SHA-256 digest. Refuses without an active publication; never reads or writes host_notes.';

COMMENT ON FUNCTION internal_api.revoke_guest_invitation(uuid) IS
  'Host verb. Revokes that household''s live guest_invitation credential and reports whether there was one. Leaves the household row, its event scope and its answers alone.';

COMMENT ON FUNCTION internal_api.rotate_guest_invitation(uuid) IS
  'Host verb. Revokes the live credential, then mints its replacement, in that order and in one transaction, carrying the host''s expiry across when that deadline has not already passed. Returns the new raw token once and the instant the old one died; refuses a link whose deadline is gone, because withdraw-then-send is the pair that gives that family a working new link.';

COMMENT ON FUNCTION internal_api.get_guest_invitation_state(uuid) IS
  'Host read. One row per household of the caller''s own wedding: name, salutation, expected party size, link state (never_issued / live / revoked / expired), expiry, last-opened time, scoped-event count and reply counts. Returns no token material of any kind.';

COMMENT ON FUNCTION internal_api.resolve_guest_invitation() IS
  'Anonymous household door. Reads the x-guest-token request header, shape-checks it before hashing, and answers with the schema-v2 guest projection plus one hand-built object about that household alone — greeting, its own scoped events and its own answers — for a live credential on an active publication, or {"available": false} for every other case including a malformed, forged, revoked, expired, rotated-away or withdrawn one. Stamps last_used_at on a successful read only.';

COMMENT ON FUNCTION internal_api.submit_guest_rsvp(jsonb) IS
  'Anonymous household answer. Credential arrives in the x-guest-token header, never as an argument. Refuses a body that is not an object naming at least one event card, or a card missing or mis-typing event_id, attending or party_size, with one 23514 shape sentence and before the credential is read, so no malformed body can reach a table constraint. Writes or revises one rsvp_responses row per named event, with response_source = ''guest'', all rows or none; refuses an event outside this household''s scope with the generic unavailable, refuses a party size above the host''s expected_party_size actionably, refuses optional-question answers as not asked, and writes nothing to the frozen document.';

COMMENT ON FUNCTION api.resolve_guest_invitation() IS
  'INVOKER single-statement wrapper over the anonymous household door. Zero arguments, so the credential cannot be addressed in a query string.';

COMMENT ON FUNCTION api.submit_guest_rsvp(jsonb) IS
  'INVOKER single-statement wrapper over the household answer. Carries the answer text only; the credential is a header and has no parameter to be passed through.';

COMMENT ON INDEX private.one_live_guest_token_per_household IS
  'At most one unrevoked guest_invitation credential per household, mirroring one_live_public_token_per_publication and one_live_token_per_approval_request.';

COMMENT ON CONSTRAINT access_tokens_kind_shape ON private.access_tokens IS
  'Per-kind row shape. Stage 8 added approval_version_id IS NULL to the guest_invitation and rsvp branches, so no household credential can point into a family''s approval version; the other three branches are Stage 3''s words unchanged.';

COMMENT ON CONSTRAINT rsvp_responses_answers_check ON public.rsvp_responses IS
  'Optional-question slot: an object, and at most 2000 octets of stored text. A CHECK cannot count keys or type values, so the per-key rule belongs to the RPC that accepts answers.';

COMMENT ON FUNCTION internal_api.publish_invitation_version(uuid, uuid, timestamptz) IS
  'Host verb. Revokes the active publication, publishes the named version, and re-pins every live credential of this wedding to it — the wedding''s own and each household''s — so a revision does not strand a family that already has its link. Mints the wedding link only when the wedding has none.';

COMMENT ON FUNCTION internal_api.revoke_invitation_publication(uuid) IS
  'Host verb. Takes the active publication down and revokes every live credential of that wedding, both the wedding link and every household link. tokens_revoked counts them.';
