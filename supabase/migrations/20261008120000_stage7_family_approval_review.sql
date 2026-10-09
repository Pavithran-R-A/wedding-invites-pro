-- Stage 7 — family invitation approval and review.
-- ===========================================================================
-- Forward-only. Nothing here rewrites a Stage 2-6 table, policy, grant or trigger body
-- except the one function explicitly re-declared in section 6.
--
-- What this file adds, in one line: the six database verbs the family-review workflow
-- needs, on tables and columns the schema already reserved for them.
--
--   * `public.approval_requests` and `public.approval_feedback` existed from Stage 2 with
--     their composite keys, their state CHECKs and their append-only guards, and were
--     readable by the owner only. Neither had a write path, because the only writer the
--     schema would accept was a role no browser can be.
--   * `private.access_tokens` already carried `token_kind = 'approval_review'`, the
--     `approval_request_id` / `approval_version_id` pair, the composite FK to
--     `approval_requests (wedding_id, id, version_id)` and an index over it. Nothing minted,
--     looked up or revoked that kind for four stages.
--
-- So the workflow is built out of reserved shapes rather than new ones. That is deliberate:
-- every cross-wedding and cross-version refusal Stage 7 needs is already a foreign key, and
-- a key that has already been attacked (Stage 2 group 12) is a stronger guarantee than a
-- predicate written here.
--
-- What this file does NOT claim:
--   * It does not verify that the person holding a review link is the person the host named.
--     Section 3 says what the build does instead, and `docs/architecture/family-approval-review-security.md`
--     carries the rule for later stages.
--   * It does not give a reviewer access to the guest list, the household rows, the RSVP
--     data, or any uploaded photograph. The review payload is the guest-facing projection and
--     nothing else (section 4), which keeps Stage 6's §7 ruling intact.
--   * It does not touch `tradition_pack_releases` review. Cultural-authority review and
--     family approval remain separate systems with separate tables, separate verbs and
--     separate vocabulary; section 7 says where the two could have been merged and why they
--     were not.
--   * It does not store a reviewer's contact details. The column exists and stays unwritten;
--     section 2.4 explains why that is a privacy decision rather than an omission.

-- ===========================================================================
-- 1. Constants, stated as constants
-- ===========================================================================
-- The Stage 2 blueprint rules that approval links expire
-- (`stage-2-domain-blueprint.md:574`) and that a re-ask must be cheap
-- (`:554-555`), and `publish_invitation_version` already takes a host-supplied
-- `p_expires_at`. No document in this repository states a number for an approval credential,
-- and `domain-model.md:383-385` forbids inventing one for *retention* — which is Stage 13's
-- and is not touched here. Expiry is this stage's own decision, so it is written as one
-- named constant with its reason attached rather than buried in an expression:
--
--   14 days. A wedding review is a favour one family member asks another, and the favour has
--   a natural shelf life: past a fortnight the answer is usually "they never got round to
--   it", and the honest action is a fresh ask rather than a link that keeps working. It is
--   also the window in which a bearer credential that grants a view of an unpublished
--   document stays live, so a shorter default reduces the exposure without making the
--   workflow unusable. A host who wants longer may pass `p_expires_at` explicitly; the
--   default is the product's advice, not a ceiling.

-- ===========================================================================
-- 2. The host's verbs — authenticated only
-- ===========================================================================
-- Each body re-derives the caller from the JWT and refuses a wedding that is not theirs with
-- one phrase, which is the standing rule for `internal_api` (ADR 0006). None of them trusts
-- the wrapper for anything.

-- 2.1 Ask a named family reviewer to read one frozen version.
CREATE FUNCTION internal_api.request_family_review(
  p_wedding_id uuid,
  p_version_id uuid,
  p_reviewer_display_name text,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner   uuid;
  v_request uuid;
  v_raw     text;
  v_expiry  timestamptz;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not ask for a review of this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Checked before relying on it, for the reason `publish_invitation_version` already gives:
  -- the composite FK would refuse "wedding A asks about wedding B's version" anyway, but a
  -- foreign key answers 23503 with the referencing key in its detail, which describes the
  -- database to someone who was only refused.
  IF NOT EXISTS (
       SELECT 1 FROM public.invitation_versions v
        WHERE v.id = p_version_id AND v.wedding_id = p_wedding_id) THEN
    RAISE EXCEPTION 'that version is not a version of this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A reviewer is a person the host names. The name is not an identity (section 3), but an
  -- empty one would make the recorded answer unattributable, and misattribution in a family
  -- disagreement is the harm `stage-2-domain-blueprint.md:285` names. Bounded here rather
  -- than by a table CHECK, so the schema's constraint inventory does not move under a
  -- Stage 2 assertion that enumerates it.
  IF length(btrim(coalesce(p_reviewer_display_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name the reviewer you are asking'
      USING ERRCODE = 'check_violation';
  END IF;
  IF length(btrim(p_reviewer_display_name)) > 120 THEN
    RAISE EXCEPTION 'that reviewer name is too long to record'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'a review link must be given a time in the future'
      USING ERRCODE = 'check_violation';
  END IF;
  v_expiry := coalesce(p_expires_at, now() + interval '14 days');

  -- `reviewer_contact_text` is deliberately left NULL. See section 2.4.
  INSERT INTO public.approval_requests (wedding_id, version_id, reviewer_display_name)
    VALUES (p_wedding_id, p_version_id, btrim(p_reviewer_display_name))
  RETURNING id INTO v_request;

  -- The credential. Same generator, same alphabet, same digest-only storage as the guest
  -- link, and for the same reasons: 256 bits from the backend CSPRNG, `convert_to` so the
  -- hash covers the token's UTF-8 bytes rather than whatever a session encoding would give,
  -- and the raw string existing in exactly one HTTP response — this one.
  v_raw := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  INSERT INTO private.access_tokens (
    token_hash, token_kind, wedding_id, approval_request_id, approval_version_id,
    expiry_policy, expires_at
  ) VALUES (
    encode(extensions.digest(convert_to(v_raw, 'UTF8'), 'sha256'), 'hex'),
    'approval_review',
    p_wedding_id,
    v_request,
    p_version_id,
    'fixed',
    v_expiry
  );

  -- The raw token is returned and never stored. A host who loses it asks again; the old
  -- request can be withdrawn, and `internal_api.revoke_family_review` exists so that
  -- "ask again" does not leave two live links pointing at one document.
  RETURN jsonb_build_object(
    'request_id', v_request,
    'review_token', v_raw,
    'expires_at', v_expiry
  );
END;
$$;

REVOKE ALL ON FUNCTION internal_api.request_family_review(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.request_family_review(uuid, uuid, text, timestamptz)
  TO authenticated;

-- 2.2 Withdraw an ask.
CREATE FUNCTION internal_api.revoke_family_review(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_req   public.approval_requests%ROWTYPE;
  v_live  integer := 0;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'the caller may not withdraw this review request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The row is read first, as the caller's own row, and its absence is a refusal rather
  -- than a no-op. Stage 3 lost a real bug to deciding an outcome from `FOUND` after an
  -- intervening statement had changed it (`stage-3-public-invitation.md` §9), so every
  -- fact this response reports is captured where it is true.
  SELECT * INTO v_req
    FROM public.approval_requests r
    JOIN public.weddings w ON w.id = r.wedding_id
   WHERE r.id = p_request_id AND w.owner_user_id = v_owner;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'the caller may not withdraw this review request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE private.access_tokens
     SET revoked_at = now()
   WHERE approval_request_id = p_request_id
     AND token_kind = 'approval_review'
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_live = ROW_COUNT;

  -- Only an unanswered ask becomes `invalidated`. A request that already holds a decision
  -- keeps it: the decision is history, and `approval_feedback` is append-only precisely so
  -- that withdrawing a link cannot un-write what somebody said. The biconditional CHECK at
  -- `20260925120300_stage2_guests_approvals_rsvp.sql:132` would refuse the alternative
  -- anyway — an answered row cannot be moved to `invalidated` without erasing its
  -- `responded_at`, which is the record of when the family answered.
  IF v_req.status = 'pending' THEN
    UPDATE public.approval_requests
       SET status = 'invalidated', invalidated_at = now()
     WHERE id = p_request_id AND status = 'pending';
  END IF;

  RETURN jsonb_build_object(
    'request_id', v_req.id,
    'status', CASE WHEN v_req.status = 'pending' THEN 'invalidated' ELSE v_req.status END,
    'was_pending', (v_req.status = 'pending'),
    'credential_revoked', v_live > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION internal_api.revoke_family_review(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.revoke_family_review(uuid) TO authenticated;

-- 2.3 The host's queue: the requests they made, the answers they got, and the state of the
-- link — without the credential.
CREATE FUNCTION internal_api.get_approval_requests(p_wedding_id uuid)
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
    RAISE EXCEPTION 'the caller may not read these reviews'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- This is the one read that has to be a function: `link_state` lives in
  -- `private.access_tokens`, which no browser role can name. It answers the same question
  -- `api.get_invitation_publication_state` answers for a guest link, with the same rule —
  -- state about a credential, never the credential. `expires_at` and `revoked_at` are times
  -- the host needs; `token_hash` is not returned, and a digest of a value the host was only
  -- ever shown once is not something a page should carry.
  --
  -- One row per ask, deliberately. The credential is read through a lateral that keeps exactly one
  -- of them — the live one if there is one, otherwise the most recently issued — because the store
  -- allows a request to accumulate retired credentials while holding at most one live link (that is
  -- what `one_live_token_per_approval_request` says). Joining every credential row instead printed
  -- one ask several times, each copy carrying the identical `history`, so a host screen built on this
  -- read would show the same person's note twice and offer no way to tell which link answered. The
  -- count of links a family has been sent is not a fact the host's queue claims to report; the state
  -- of the ask, and of the link that currently represents it, is.
  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.requested_at DESC, x.request_id), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT r.id AS request_id,
             r.version_id,
             v.version_number,
             r.reviewer_display_name,
             r.status,
             r.requested_at,
             r.responded_at,
             r.invalidated_at,
             CASE WHEN t.id IS NULL THEN 'never_issued'
                  WHEN t.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN t.expires_at IS NOT NULL AND t.expires_at <= now() THEN 'expired'
                  ELSE 'live' END AS link_state,
             t.expires_at AS link_expires_at,
             t.last_used_at AS link_last_used_at,
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                        'id', f.id,
                        'kind', f.feedback_kind,
                        'decision', f.decision,
                        'section_key', f.section_key,
                        'message', f.message,
                        'author_label', f.author_label,
                        'created_at', f.created_at)
                      ORDER BY f.created_at, f.id)
               FROM public.approval_feedback f
              WHERE f.wedding_id = r.wedding_id
                AND f.request_id = r.id
             ), '[]'::jsonb) AS history
        FROM public.approval_requests r
        JOIN public.invitation_versions v
          ON v.id = r.version_id AND v.wedding_id = r.wedding_id
        LEFT JOIN LATERAL (
          SELECT c.id, c.revoked_at, c.expires_at, c.last_used_at
            FROM private.access_tokens c
           WHERE c.approval_request_id = r.id
             AND c.token_kind = 'approval_review'
           ORDER BY (c.revoked_at IS NULL
                     AND (c.expires_at IS NULL OR c.expires_at > now())) DESC,
                    c.created_at DESC,
                    c.id
           LIMIT 1
        ) t ON true
       WHERE r.wedding_id = p_wedding_id
    ) x;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION internal_api.get_approval_requests(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.get_approval_requests(uuid) TO authenticated;

-- 2.4 Why `reviewer_contact_text` stays NULL in this build.
--
-- The column exists and nothing here writes it. Three reasons, in order of weight:
--   1. The link is the delivery mechanism. Once the host can copy a URL, a stored phone
--      number or email adds no capability the workflow needs.
--   2. A reviewer is a third party with no account, no consent record and no erasure path —
--      `docs/audits/stage-4-tradition-pack-foundation.md:1352` records that erasure is §33's
--      deferred work, and Stage 13 owns retention. Storing their contact details would start
--      a personal-data accumulation that this repository has explicitly not designed yet.
--   3. `domain-model.md:406-410` conditions that accumulation on Stage 7 designing "that
--      person's view and objection path" first. This file designs the view and the objection
--      (sections 3-5) and still declines the contact detail, because designing a view is not
--      consent to hold an address book of strangers.
-- The consequence is stated plainly: the product cannot email or WhatsApp a reviewer on the
-- host's behalf, and no copy anywhere may imply that it can.

-- ===========================================================================
-- 3. The reviewer's door — anonymous, header-borne, and honest about identity
-- ===========================================================================
-- A reviewer has no account, so they are `anon`, and `anon` holds no table privilege at all
-- (C11). The door is therefore a function, exactly like `api.resolve_public_invitation`, and
-- for exactly the same reason: not convenience, but that a policy granting `anon` a table
-- would fail Stage 2's C18 and weakening C18 is not available.
--
-- Identity, stated as this build says it: the credential proves that whoever holds it may
-- answer this request. It does not prove who they are, and nothing in this file or the UI may
-- present it as if it did. What the schema *can* do is make a forwarded link leave a trace:
--   * `approval_requests.reviewer_display_name` is the name the host typed.
--   * `approval_feedback.author_label` is the name the person answering typed.
--   * The host's queue shows both, so "this was asked of my mother-in-law and answered by
--     someone who typed a different name" is visible rather than silent.
--   * `private.access_tokens.last_used_at` is written on each successful review read, so
--     "the link was opened, and when" is evidence the host can see. Stage 2 declared the
--     column and four stages left it NULL; this is the first thing in the product to use it,
--     and it is used for the one purpose the column's name implies.
-- None of that is verification, and the reviewer page says so in its own words.

-- 3.1 The lookup, shared by the read and the answer.
--
-- Inlined in both bodies rather than placed in `private`, and the reason is the catalogue:
-- `private` is a scanned schema in three head-aware censuses (I4 in the Stage 4 suite, and
-- the same family in Stage 2's), and a helper that exists only to avoid typing a JOIN twice
-- would change three assertions for no gain in clarity. The predicates are identical in both
-- bodies and both are attacked by the same battery cases.
--
-- The liveness rule, in full: shape checked before hashing, digest equality, `token_kind`,
-- `revoked_at IS NULL`, unexpired, the request still `pending`, and the whole
-- (wedding, request, version) triple agreeing with the request row. The last one is the
-- cross-version refusal: a credential minted for v1 cannot be used to answer v2, because the
-- row it points at names v1 and the request pins v1.
--
-- One vocabulary note that has to be stated rather than left to the reader. The CHECK on
-- `public.approval_requests.status` (Stage 2) permits five literals, and `expired` is one of
-- them. Nothing in this file ever writes it: expiry lives on the credential row, so an ask
-- whose link has run out still reads `status = 'pending'` in the host queue while its
-- `link_state` reads `expired`, and the door refuses the credential. That is a deliberate
-- division — there is no scheduler at this head, and a status that only a cron could set would
-- be a second, drift-prone clock. The queue therefore reports the deadline (`link_expires_at`)
-- and the derived state, and `stage7/80_family_review.sql` group E measures both halves of this
-- sentence on a moved-out credential.

-- 3.2 Open the review.
CREATE FUNCTION internal_api.resolve_family_review()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_unavailable constant jsonb := jsonb_build_object('available', false);
  v_raw       text;
  v_hash      text;
  v_request   uuid;
  v_version   uuid;
  v_name      text;
  v_requested timestamptz;
  v_expires   timestamptz;
  v_number    integer;
  v_dto       jsonb;
  v_keys      text[];
BEGIN
  v_raw := current_setting('request.headers', true)::jsonb ->> 'x-review-token';
  -- Shape before arithmetic, and a filter rather than an error: junk never reaches a digest.
  IF v_raw IS NULL OR octet_length(v_raw) <> 43 OR v_raw !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN v_unavailable;
  END IF;

  v_hash := encode(extensions.digest(convert_to(v_raw, 'UTF8'), 'sha256'), 'hex');

  SELECT t.approval_request_id, r.version_id, r.reviewer_display_name,
         r.requested_at, t.expires_at
    INTO v_request, v_version, v_name, v_requested, v_expires
    FROM private.access_tokens t
    JOIN public.approval_requests r
      ON r.id = t.approval_request_id
     AND r.wedding_id = t.wedding_id
     AND r.version_id = t.approval_version_id
   WHERE t.token_hash = v_hash
     AND t.token_kind = 'approval_review'
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
     AND r.status = 'pending';

  IF NOT FOUND THEN
    RETURN v_unavailable;
  END IF;

  SELECT v.version_number,
         private.public_invitation_dto(v.snapshot_schema_version, v.snapshot)
    INTO v_number, v_dto
    FROM public.invitation_versions v
   WHERE v.id = v_version;

  IF v_dto IS NULL THEN
    -- A snapshot this build cannot draw is not a document to review. The guest page answers
    -- the same way for the same reason: a partial render of a wedding is a lie about it.
    RETURN v_unavailable;
  END IF;

  UPDATE private.access_tokens
     SET last_used_at = now()
   WHERE approval_request_id = v_request
     AND token_kind = 'approval_review'
     AND revoked_at IS NULL;

  -- The vocabulary a reviewer may pin a note to, taken from the frozen document they are
  -- looking at. It is returned so the page can offer it, and re-checked on the way in
  -- (section 5.2) so a hand-built request cannot invent a key the document does not contain.
  SELECT coalesce(array_agg(DISTINCT s ->> 'section_key'), '{}')
    INTO v_keys
    FROM jsonb_array_elements(v_dto -> 'sections' -> 'items') s
   WHERE coalesce(s ->> 'section_key', '') <> '';

  -- The door answers with the document, the vocabulary and the ask's own metadata — and with no
  -- note history. Writing feedback and leaving `pending` are the two outcomes of the same
  -- transaction, so a request this caller can open provably has no feedback row yet; an earlier
  -- draft of this response carried `my_previous_notes`, which measurement showed to be `[]` on
  -- every open. A field that can never hold anything is a promise a page would break, so it is
  -- absent rather than empty: what a reviewer said reaches the host, through
  -- `get_approval_requests`, and cannot be re-opened from the link.
  RETURN jsonb_build_object(
    'available', true,
    'review', jsonb_build_object(
      'request_id', v_request,
      'reviewer_display_name', v_name,
      'version_number', v_number,
      'requested_at', v_requested,
      'expires_at', v_expires,
      'invitation', v_dto,
      'section_keys', to_jsonb(v_keys)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION internal_api.resolve_family_review()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.resolve_family_review() TO anon, authenticated;

-- ===========================================================================
-- 4. What a reviewer may see, and what they may not
-- ===========================================================================
-- The review payload is `private.public_invitation_dto` — the guest-facing, twelve-name
-- whitelist (Stage 3 drew it at eleven names; Stage 4's schema-v2 projection added `sections`)
-- — with review metadata beside it. Reusing that projection rather than writing a second
-- "review DTO" is the load-bearing decision in this section:
--   * The projection already refuses a snapshot whose shape it does not recognise, so a
--     reviewer cannot be shown a partial document.
--   * It already carries no `object_key`, which is the assertion Stage 3 closed (B28) and the
--     reason Stage 6's §7 ruling could be written at all. A reviewer therefore gets no
--     photograph, no signed URL, and no key to build one from — the private asset boundary
--     holds over the review door for the same reason it holds over the guest door.
--   * It contains no guest list, no household, no RSVP and no other reviewer. I-13 was
--     recorded as "not applicable yet" in Stage 2 because there was no reviewer identity;
--     with one now, the invariant is honoured by the payload's shape rather than by a filter.
-- Anything a later stage adds to this payload is a change to the guest projection too, and
-- both doors' batteries have to move together. That coupling is the point.

-- ===========================================================================
-- 5. Answering — one decision, append-only, never a mutation of the snapshot
-- ===========================================================================
-- 5.1 The history rule. Each answer writes one `approval_feedback` row and moves the request
-- out of `pending`. A second attempt is refused because the request is no longer pending —
-- which is what makes the recorded decision un-replayable without needing a nonce. If the
-- family wants to change their mind, the host asks again: a new request, a new credential, a
-- new row. `approval_feedback` has no UPDATE path and no `updated_at` (C36), so nothing in
-- this design can rewrite what was said.
--
-- 5.2 The immutability rule. The body touches `invitation_versions` in one place — a
-- `SELECT` of `version_number` — and the snapshot is read, never assigned. `private` holds
-- the only snapshot builder, and it is called by the freeze path, not by review. So
-- "reviewing cannot silently mutate the approved document" is not a promise this function
-- has to keep politely; it is a grant shape (`authenticated` has SELECT on
-- `invitation_versions` and nothing else) plus a BEFORE UPDATE trigger that answers 42501.

CREATE FUNCTION internal_api.submit_family_review(
  p_decision text,
  p_reviewer_label text,
  p_message text,
  p_section_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_unavailable constant jsonb := jsonb_build_object('recorded', false, 'reason', 'unavailable');
  v_raw       text;
  v_hash      text;
  v_request   uuid;
  v_wedding   uuid;
  v_version   uuid;
  v_note      text;
  v_key       text;
  v_rows      integer;
  v_feedback  uuid;
BEGIN
  IF p_decision IS NULL OR NOT p_decision IN ('approved', 'changes_requested') THEN
    -- Validated before anything else is read, including the credential, so a junk verb says
    -- what is wrong with the verb rather than probing the door. This is the one refusal that
    -- is safe to be specific: it carries no information about anyone's link.
    --
    -- The `IS NULL` half is not decoration. `NOT NULL IN (...)` evaluates to NULL, so without it a
    -- JSON `null` in `p_decision` — which an anonymous RPC caller can send — fell through every
    -- guard in this function and reached the INSERT, where the schema stopped it. Measured: the
    -- caller was then handed `new row for relation "approval_feedback" violates check constraint
    -- "approval_feedback_check"`, which names a table and a constraint to someone who is not
    -- supposed to know either exists. The workflow owns this refusal, so the workflow says it.
    RAISE EXCEPTION 'the review decision is not one this product records'
      USING ERRCODE = 'check_violation';
  END IF;

  IF length(btrim(coalesce(p_reviewer_label, ''))) = 0
     OR length(btrim(p_reviewer_label)) > 120 THEN
    RAISE EXCEPTION 'say who is answering, in their own words'
      USING ERRCODE = 'check_violation';
  END IF;

  v_note := NULLIF(btrim(coalesce(p_message, '')), '');
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN
    RAISE EXCEPTION 'that note is too long to record'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_decision = 'changes_requested' AND v_note IS NULL THEN
    -- A rejection with no reason is not actionable and, worse, reads as a person saying no to
    -- a family's wedding. The schema allows it (`feedback_kind='decision'` does not require a
    -- message), so the workflow has to refuse it.
    RAISE EXCEPTION 'a request for changes needs a note saying what to change'
      USING ERRCODE = 'check_violation';
  END IF;

  v_raw := current_setting('request.headers', true)::jsonb ->> 'x-review-token';
  IF v_raw IS NULL OR octet_length(v_raw) <> 43 OR v_raw !~ '^[A-Za-z0-9_-]+$' THEN
    RETURN v_unavailable;
  END IF;

  v_hash := encode(extensions.digest(convert_to(v_raw, 'UTF8'), 'sha256'), 'hex');

  SELECT t.approval_request_id, t.wedding_id, r.version_id
    INTO v_request, v_wedding, v_version
    FROM private.access_tokens t
    JOIN public.approval_requests r
      ON r.id = t.approval_request_id
     AND r.wedding_id = t.wedding_id
     AND r.version_id = t.approval_version_id
   WHERE t.token_hash = v_hash
     AND t.token_kind = 'approval_review'
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
     AND r.status = 'pending';

  IF NOT FOUND THEN
    -- One answer for malformed, unknown, forged, revoked, expired, superseded and already
    -- answered. A holder of a dead credential is not entitled to learn which of those it was,
    -- and `stage-3-public-invitation.md` §"liveness policy" already made that the product's
    -- refusal shape rather than only an invitation-page convenience.
    RETURN v_unavailable;
  END IF;

  v_key := NULLIF(btrim(coalesce(p_section_key, '')), '');
  IF v_key IS NOT NULL AND length(v_key) > 120 THEN
    RAISE EXCEPTION 'that section reference is too long'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The note is pinned to a section the frozen document actually has, or to nothing. `NOT IN`
  -- against an empty array is TRUE, so the no-key case is tested first rather than assumed.
  IF v_key IS NOT NULL AND NOT EXISTS (
       SELECT 1
         FROM public.invitation_versions v,
              jsonb_array_elements(v.snapshot -> 'sections' -> 'items') s
        WHERE v.id = v_version
          AND s ->> 'section_key' = v_key) THEN
    RAISE EXCEPTION 'that note does not name a section of this invitation'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.approval_feedback (
    wedding_id, request_id, version_id, feedback_kind, decision, section_key, message, author_label
  ) VALUES (
    v_wedding, v_request, v_version, 'decision', p_decision, v_key, v_note, btrim(p_reviewer_label)
  )
  RETURNING id INTO v_feedback;

  UPDATE public.approval_requests
     SET status = p_decision, responded_at = now()
   WHERE id = v_request AND status = 'pending';
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    -- Two answers raced for one request. Aborting rolls the feedback row back with the
    -- decision, so the loser's note is not left pointing at a request somebody else already
    -- answered; and the count is checked rather than ignored because "exactly one row moved"
    -- is the whole content of the no-replay claim.
    RAISE EXCEPTION 'this review has already been answered'
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN jsonb_build_object(
    'recorded', true,
    'status', p_decision,
    'feedback_id', v_feedback,
    'responded_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION internal_api.submit_family_review(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.submit_family_review(text, text, text, text)
  TO anon, authenticated;

-- ===========================================================================
-- 6. I-12: a successor version closes the predecessor's open asks
-- ===========================================================================
-- `stage-2-domain-blueprint.md:722` recorded this invariant as "constrained, not performed":
-- the status literal and its CHECK existed, and nothing wrote them, because the marking
-- action needed the version-minting path. That path exists since Stage 3 and was rewritten in
-- Stage 5, so the marking is performed here.
--
-- Re-declared in full rather than patched, because plpgsql has no patch. The body below is
-- Stage 5's `20260929120000_stage5_pack_driven_authoring_review.sql:1544-1635` with exactly
-- one addition — the invalidation block marked `I-12` — and nothing else changed: same header
-- (`plpgsql SECURITY DEFINER SET search_path = ''`), same guards, same issue-list engine, same
-- retry loop, same result shape. The posture assertions (C26, G1, I1-I3) read those properties
-- and must keep reading the same values.

CREATE OR REPLACE FUNCTION internal_api.create_invitation_version(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_owner   uuid;
  v_lang    text;
  v_release uuid;
  v_draft   public.invitation_drafts%ROWTYPE;
  v_snap    jsonb;
  v_records jsonb;
  v_issues  text[];
  v_number  integer;
  v_prev    uuid;
  v_id      uuid;
  v_try     integer := 0;
BEGIN
  v_owner := auth.uid();
  IF v_owner IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_owner) THEN
    RAISE EXCEPTION 'the caller may not create a version of this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT w.primary_language, w.tradition_pack_release_id
    INTO v_lang, v_release
    FROM public.weddings w WHERE w.id = p_wedding_id
    FOR UPDATE;

  IF v_lang IS NULL THEN
    RAISE EXCEPTION 'choose the invitation language before creating a version'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_draft FROM public.invitation_drafts d WHERE d.wedding_id = p_wedding_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this wedding has no invitation draft'
      USING ERRCODE = 'raise_exception';
  END IF;

  v_snap := private.build_invitation_snapshot(p_wedding_id);

  -- §O of the Stage 4 continuation, restated against the record engine: a version a guest
  -- could read may not be created while the document it would freeze falls short. The list is
  -- the blocking half of what the host's editor is showing at the same moment, from the same
  -- records, and the sentence form is kept because the refusal a host sees has to be the one
  -- this build already produces.
  --
  -- The release's *status* is still not checked here: `versions_pack_release_gate` refuses it
  -- at the INSERT below, which is the stronger place because it holds for any writer and not
  -- only for this RPC.
  v_records := private.invitation_issue_records(
    v_snap, private.wedding_invitation_definition(p_wedding_id));
  v_issues := private.invitation_issue_messages(v_records);
  IF cardinality(v_issues) > 0 THEN
    RAISE EXCEPTION 'this invitation cannot be frozen yet: %', array_to_string(v_issues, '; ')
      USING ERRCODE = 'check_violation';
  END IF;

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
        tradition_pack_release_id, design_template_id, created_by, supersedes_version_id
      )
      SELECT p_wedding_id, v_number, v_snap, 2,
             w.tradition_pack_release_id, w.design_template_id, v_owner, v_prev
        FROM public.weddings w WHERE w.id = p_wedding_id
      RETURNING id INTO v_id;

      -- I-12 (Stage 2 blueprint:459-461, disposition at :722). The successor now exists, so a
      -- pending ask about its predecessor is asking for a verdict on a document the host has
      -- already moved past. Marking it `invalidated` is the visible, historical half of the
      -- rule — `status` and `invalidated_at` are exactly what the CHECK at
      -- 20260925120300_stage2_guests_approvals_rsvp.sql:132-133 was written for.
      --
      -- Two things are deliberately NOT done here. Answered requests keep their status and
      -- their `responded_at`: what a reviewer said about v1 is a fact about v1, and the
      -- biconditional CHECK would refuse to keep the timestamp while moving the row anyway.
      -- And no row is deleted: `stage-2-migration-plan.md` §7.1 settled that approval history
      -- does not vanish with an aggregate, and a silent erase of a family's disagreement is
      -- the same harm in a different shape.
      --
      -- The live credential goes with it. An invalidated request whose link still worked would
      -- let a reviewer answer a superseded document; revoking here is what makes
      -- "stop resolving" true rather than aspirational.
      UPDATE public.approval_requests
         SET status = 'invalidated', invalidated_at = now()
       WHERE wedding_id = p_wedding_id
         AND status = 'pending';

      UPDATE private.access_tokens
         SET revoked_at = now()
       WHERE wedding_id = p_wedding_id
         AND token_kind = 'approval_review'
         AND revoked_at IS NULL;

      RETURN jsonb_build_object(
        'version_id', v_id,
        'version_number', v_number,
        'snapshot', v_snap
      );
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 3 THEN
        RAISE EXCEPTION 'too many versions were being created at once; try again'
          USING ERRCODE = 'raise_exception';
      END IF;
    END;
  END LOOP;
END;
$$;

-- ===========================================================================
-- 7. Separation from cultural-authority review, and the one place they touch
-- ===========================================================================
-- `internal_api.submit_tradition_pack_review` / `approve_tradition_pack_release` (Stage 5)
-- move a *pack release* between `candidate` and `approved`, are callable only by a maintenance
-- identity, and produce a review packet hash. `internal_api.submit_family_review` moves a
-- *host's request* between `pending` and an answer, is callable by an anonymous link-holder,
-- and produces an append-only feedback row. They share no table, no column, no status
-- vocabulary and no privilege. Nothing in this file reads `tradition_pack_releases`.
--
-- The one place the two could legitimately be merged is the deferred promotion in
-- `domain-model.md:370` ("Stage 7's review workflow, if the review is ever to be done by a
-- named person inside the product rather than by a maintenance identity at a terminal"). This
-- stage declines it, and the reason is privilege rather than scope: an anonymous
-- link-holding family reviewer is not a cultural reviewer, and giving the family-review door
-- any path to a pack release status would let a bearer credential decide platform content.
-- The pack-review surface therefore stays a local operator tool, and the sentence that keeps
-- them apart is asserted by `docs/architecture/family-approval-review-security.md` rather than
-- by a shared code path.

-- ===========================================================================
-- 8. The exposed half: `api` wrappers
-- ===========================================================================
-- One `SELECT` each, SECURITY INVOKER, search path pinned, STABLE carried onto the read that
-- is stable. `resolve_family_review` is VOLATILE because section 3.2 writes `last_used_at`,
-- and PostgREST will then require POST for it — which is also what keeps the credential out
-- of any URL: a volatile zero-argument function has no query string to leak through.

CREATE OR REPLACE FUNCTION api.request_family_review(
  p_wedding_id uuid,
  p_version_id uuid,
  p_reviewer_display_name text,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.request_family_review(p_wedding_id, p_version_id, p_reviewer_display_name, p_expires_at);
$$;

CREATE OR REPLACE FUNCTION api.revoke_family_review(p_request_id uuid)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.revoke_family_review(p_request_id);
$$;

CREATE OR REPLACE FUNCTION api.get_approval_requests(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.get_approval_requests(p_wedding_id);
$$;

CREATE OR REPLACE FUNCTION api.resolve_family_review()
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.resolve_family_review();
$$;

CREATE OR REPLACE FUNCTION api.submit_family_review(
  p_decision text,
  p_reviewer_label text,
  p_message text,
  p_section_key text
)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT internal_api.submit_family_review(p_decision, p_reviewer_label, p_message, p_section_key);
$$;

-- ===========================================================================
-- 9. The caller matrix, restated for both halves
-- ===========================================================================
-- `service_role` is absent from both halves, as it is for all eight existing wrappers: it has
-- no USAGE on `api` or `internal_api` (C17c/C17e), it is not a browser, and it already owns
-- the grants on the tables these bodies write.
--
-- `anon` is granted the two review-door functions and nothing else. That is the second
-- anonymous door in the product, and it is deliberate rather than incidental: a reviewer has
-- no account, so `anon` is the only role they can ever be, and the alternative — a policy
-- granting `anon` a table — would fail Stage 2's C18 and is not available.

REVOKE ALL ON FUNCTION api.request_family_review(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.request_family_review(uuid, uuid, text, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION api.revoke_family_review(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.revoke_family_review(uuid) TO authenticated;

REVOKE ALL ON FUNCTION api.get_approval_requests(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.get_approval_requests(uuid) TO authenticated;

REVOKE ALL ON FUNCTION api.resolve_family_review()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.resolve_family_review() TO anon, authenticated;

REVOKE ALL ON FUNCTION api.submit_family_review(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.submit_family_review(text, text, text, text) TO anon, authenticated;

-- ===========================================================================
-- 10. One live credential per request
-- ===========================================================================
-- Stage 3 gave a publication that guarantee with `one_live_public_token_per_publication`
-- (`20260926130000_stage3_publication_resolution_boundary.sql:219-223`), and left the
-- approval kind uncovered. Without it, a bug in the host path could mint a second live link
-- for one request and the product would have two answers to "which link did I send". The
-- request row is the unit of asking, so it is the unit of uniqueness.
--
-- Partial, and the `approval_request_id IS NOT NULL` term is required for a partial index to
-- be usable as an FK-independent guarantee: guest and RSVP rows have NULL there and must not
-- collide with each other.
CREATE UNIQUE INDEX one_live_token_per_approval_request
  ON private.access_tokens (approval_request_id)
 WHERE revoked_at IS NULL
   AND token_kind = 'approval_review'
   AND approval_request_id IS NOT NULL;

-- ===========================================================================
-- 11. Posture, written where a reader of the catalog will find it
-- ===========================================================================
COMMENT ON FUNCTION internal_api.request_family_review(uuid, uuid, text, timestamptz) IS
  'Host verb. Creates one approval request pinned to one immutable version of the caller''s own wedding, and mints the single approval_review credential that answers it. Returns the raw token once and stores only its SHA-256 digest. Writes reviewer_display_name; never writes reviewer_contact_text.';

COMMENT ON FUNCTION internal_api.revoke_family_review(uuid) IS
  'Host verb. Withdraws an ask: revokes its live credential and, if no answer had been recorded, marks the request invalidated. A decision already given stays on the record.';

COMMENT ON FUNCTION internal_api.get_approval_requests(uuid) IS
  'Host read. Requests, version numbers, answers and history for the caller''s own wedding, plus each link''s state (never_issued / live / revoked / expired) and last-opened time. Returns no token material of any kind.';

COMMENT ON FUNCTION internal_api.resolve_family_review() IS
  'Anonymous review door. Reads the x-review-token request header, shape-checks it before hashing, and answers with the guest projection plus review metadata for a live credential on a pending request, or {"available": false} for every other case including a malformed, forged, revoked, expired, superseded or answered one. Stamps last_used_at.';

COMMENT ON FUNCTION internal_api.submit_family_review(text, text, text, text) IS
  'Anonymous review answer. Credential arrives in the x-review-token header, never as an argument. Writes one append-only approval_feedback row and moves the request out of pending; refuses a second answer, refuses a note pinned to a section the frozen snapshot does not contain, and never touches invitation_versions or its snapshot.';

COMMENT ON FUNCTION api.resolve_family_review() IS
  'INVOKER single-statement wrapper over the anonymous review door. Zero arguments, so the credential cannot be addressed in a query string.';

COMMENT ON FUNCTION api.submit_family_review(text, text, text, text) IS
  'INVOKER single-statement wrapper over the review answer. Carries the decision text only; the credential is a header and has no parameter to be passed through.';

COMMENT ON INDEX private.one_live_token_per_approval_request IS
  'At most one unrevoked approval_review credential per request, mirroring one_live_public_token_per_publication for the guest kind.';
