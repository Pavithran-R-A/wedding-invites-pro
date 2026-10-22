-- ===========================================================================
-- Stage 11, slice 4 — publication takedown and refund/dispute oversight
--
-- §6's two takedown functions and §7's oversight pair, on the substrate §2 measured. Nothing here
-- deletes a row or a byte, moves money, changes an entitlement, or touches the payment-policy
-- singleton. Five decisions were taken while reading the tables this file writes into, and each one is
-- recorded here because a later slice inherits it.
--
--   1. **The authorising case must be live in §5's own sense, not merely "not closed".** §5 names three
--      statuses — `open`, `triaged`, `in_progress` — and §6 says "a matching open case". A `resolved` or
--      `closed` ticket is the record of an act that already finished, and an `awaiting_information` one is
--      a question parked on the host; neither is a live permission to revoke somebody's invitation. So the
--      predicate is that closed three-value list, and the refusal is §5's one-sentence shape: an
--      unauthorised, unfindable, mismatched or parked case all answer `insufficient_privilege` with the
--      same words, so no takedown call is an oracle over a `SV-` ref a caller guessed.
--
--   2. **§6's purge signature is amended by one argument, and the amendment is forced by the channel.**
--      The design wrote `operator_purge_publication_objects(p_case_ref, p_idempotency_key)`. That body has
--      no browser surface (§10) and runs only over the peer-authenticated `psql` channel (§11), where
--      `auth.uid()` is NULL by construction — slice 1 measured it, and §4 gives the same reason for the two
--      grant bodies: "a grant decided by nobody is unanswerable afterwards". A purge that recorded no human
--      would be the one irreversible act in the stage with no name against it. So it takes
--      `p_actor_user_id uuid`, refuses an id that names no `auth.users` row, and — the half that keeps §4's
--      promise intact — requires a live, unexpired `operations` grant held by *that named account*. This is
--      the stage's third service-only identity-taking body, and `40_catalog.sql` C29c-b grows from eight
--      names to nine in the same commit, with EXECUTE false for all three client roles on all nine.
--      `private.actor_is_operator(text)` cannot answer for a named account (it reads `auth.uid()` and takes
--      no id), and no predicate that takes an id is added, because a second predicate would be a
--      browser-reachable oracle over who holds authority the moment a later slice granted it. The check is
--      therefore a `SELECT` inside this body, against the grant table, in the same four-condition shape
--      slice 1's predicate uses.
--
--   3. **One replay anchor for all three mutating bodies: the audit row.** The takedown, the purge and the
--      review note each append a `support_case_events` row of kind `operation_link`, and that table's key
--      index is `UNIQUE (case_id, idempotency_key)` — it can prove a key was used on this case, but not
--      *which* of the operations that share the `operation_link` arm the key bought. The trail's `action`
--      and `subject_type` columns can, and `audit_events.idempotency_key` carries the stage's only global
--      unique index. So every body pre-reads the trail by key, requires the recorded subject to be the
--      subject this call is addressing, and answers with the fields the first delivery stored — which is
--      why each body builds one jsonb and returns it on both paths rather than paraphrasing it. Slice 3
--      chose the same anchor for the same reason (the `R` group of `90_privacy_intake.sql`), and the
--      event-table index stays as the backstop that makes a key reused across two acts on one case
--      impossible rather than merely refused.
--
--   4. **`commerce_review_notes.order_id` is re-derived, never trusted.** §7 denormalises it "only as a FK
--      for query", which describes a column whose only honest value is the refund's own. A BEFORE INSERT
--      body looks the order up from `refund_id`, fills the column, and refuses a supplied value that
--      disagrees — because a note joined to the wrong order is a queue that shows a finance reviewer money
--      belonging to another wedding, and the row would still satisfy both of its own foreign keys.
--
--   5. **The takedown walks only `ready` output rows, and that is Stage 9's rule rather than a shortcut.**
--      `invitation_outputs` reaches `invalidated` from `ready`, or from `failed` *only* when a digest was
--      earned (`20261013120000_stage9_render_outputs.sql:341-369`: "a failed output with no stored bytes is
--      removed rather than invalidated"). A sweep over every not-yet-invalidated row of the version would
--      abort the whole takedown on the first artefact that never uploaded, so the UPDATE is written against
--      `status = 'ready'` and reports its own count beside the rows it deliberately left alone.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. The oversight note (§7)
-- ===========================================================================

CREATE TABLE private.commerce_review_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NO ACTION on both money links. A note is the evidence that a human looked at this refund and what they
  -- concluded; deleting the refund or the order must not quietly remove the record of the review, and it
  -- does not get to. §12's posture, stated as keys rather than as intent. The pair also means a refund
  -- cannot be pruned while somebody annotated it, which is the right failure to have to notice at a console.
  refund_id uuid NOT NULL REFERENCES private.commerce_refunds(id) ON DELETE NO ACTION,
  order_id uuid NOT NULL REFERENCES private.commerce_orders(id) ON DELETE NO ACTION,
  -- The §5 carrier, named by the string an operator holds rather than by a uuid they would have to look
  -- up: `case_ref` is UNIQUE on `support_cases`, so this is a real foreign key, and the ref a note cites is
  -- the same ref a takedown would have to cite. NO ACTION for the reason above.
  case_ref text NOT NULL REFERENCES private.support_cases(case_ref) ON DELETE NO ACTION,
  -- Nullable on disk and named at insert — the third time this stage has had to write that sentence, for
  -- the third time the same reason: `NOT NULL` and `ON DELETE SET NULL` cannot both hold, and the second is
  -- what keeps a note from making its author's account undeletable. The BEFORE INSERT guard below refuses a
  -- hand-written row that names nobody; only the database's own referential nulling can empty the link
  -- afterwards. This is the stage's eighth `auth.users` edge and `40_catalog.sql` C46 counts it.
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Four arms, and none of them is a verb on the money. `documented_outcome` is the one a reader could
  -- mistake for an action taken here, so §7's sentence — it records what a human did *elsewhere* — is both
  -- the column comment and the returned DTO's field list.
  kind text NOT NULL
    CHECK (kind IN ('evidence_requested', 'in_review', 'escalated_to_owner', 'documented_outcome')),
  note text NOT NULL
    CHECK (length(btrim(note)) > 0 AND length(note) <= 4000),
  -- NOT NULL with no default: §7's insert-only row is a decision, and a decision that cannot be re-sent
  -- exactly is a decision that gets made twice. The body refuses a missing key long before the column
  -- does, so this is the second wall rather than the first.
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
  -- No `updated_at`, and that is the table's whole argument: a correction is a new note. The UPDATE guard
  -- below is what turns the argument into a fact.
);

-- One row per (refund, key): the same composite shape the case event table uses, one level down. It is a
-- full unique index rather than a partial one because the column is NOT NULL, so there is no NULL half to
-- exclude. The pair below is the thread read the queue performs on every row it returns.
CREATE UNIQUE INDEX commerce_review_notes_one_row_per_key
  ON private.commerce_review_notes (refund_id, idempotency_key);
CREATE INDEX commerce_review_notes_refund_created_idx
  ON private.commerce_review_notes (refund_id, created_at, id);
-- The case's own review history, which is the question an owner asks after a dispute: what did we say about
-- the refunds on this ticket, in order.
CREATE INDEX commerce_review_notes_case_idx
  ON private.commerce_review_notes (case_ref, created_at, id);

-- Decision 4. Runs before the NOT NULL and FK checks, so a body that leaves the column NULL is filled and a
-- body that names somebody else's order is refused with the sentence that says which.
CREATE FUNCTION private.derive_commerce_review_note_order() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_order uuid;
BEGIN
  SELECT r.order_id INTO v_order FROM private.commerce_refunds r WHERE r.id = NEW.refund_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'a commerce review note must name a refund that exists'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.order_id IS NOT NULL AND NEW.order_id <> v_order THEN
    RAISE EXCEPTION 'a review note''s order is its refund''s order: refund % belongs to order %',
      NEW.refund_id, v_order USING ERRCODE = 'check_violation';
  END IF;
  NEW.order_id := v_order;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.derive_commerce_review_note_order()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.derive_commerce_review_note_order() IS
  'BEFORE INSERT guard on private.commerce_review_notes: fills `order_id` from the named refund and refuses '
  'a supplied value that disagrees. The denormalised column exists for the queue join only, so the only '
  'honest value in it is the refund''s own.';

CREATE TRIGGER commerce_review_notes_derive_order BEFORE INSERT ON private.commerce_review_notes
  FOR EACH ROW EXECUTE FUNCTION private.derive_commerce_review_note_order();

-- The anti-forgery half of the nullable author, at the instant the row is written. An INSERT guard rather
-- than a CHECK for the reason slices 1–3 state at length: deleting the named account is carried out on this
-- row as an UPDATE that nulls `author_user_id`, and a CHECK re-evaluates on that UPDATE too — kept as a
-- CHECK, this rule would not merely refuse a forged note, it would make every reviewer who ever annotated a
-- refund undeletable.
CREATE FUNCTION private.reject_commerce_review_note_without_author() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.author_user_id IS NULL THEN
    RAISE EXCEPTION 'a commerce review note must name the account that wrote it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_commerce_review_note_without_author()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER commerce_review_notes_author_names_a_human BEFORE INSERT ON private.commerce_review_notes
  FOR EACH ROW EXECUTE FUNCTION private.reject_commerce_review_note_without_author();

-- Insert-only, for every role including this table's owner, except the one UPDATE the database issues for
-- its own key. Same construction as `reject_case_event_update_except_referential_null`, compared by
-- exclusion so a column a later slice adds is refused by default rather than allowed by omission.
CREATE FUNCTION private.reject_commerce_review_note_update_except_referential_null() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
BEGIN
  IF (v_new - 'author_user_id') IS DISTINCT FROM (v_old - 'author_user_id') THEN
    RAISE EXCEPTION '%.% rows are append-only: a correction is a new note, never an edit',
      TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
     AND (NEW.author_user_id IS NOT NULL OR pg_trigger_depth() < 2) THEN
    RAISE EXCEPTION '%.% rows are append-only: a correction is a new note, never an edit',
      TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_commerce_review_note_update_except_referential_null()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER commerce_review_notes_no_update_any_role
  BEFORE UPDATE ON private.commerce_review_notes
  FOR EACH ROW EXECUTE FUNCTION private.reject_commerce_review_note_update_except_referential_null();

CREATE TRIGGER commerce_review_notes_no_client_write
  BEFORE INSERT OR UPDATE ON private.commerce_review_notes
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER commerce_review_notes_no_client_delete BEFORE DELETE ON private.commerce_review_notes
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

ALTER TABLE private.commerce_review_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.commerce_review_notes FROM PUBLIC;

COMMENT ON TABLE private.commerce_review_notes IS
  'The refund/dispute oversight record (§7): insert-only, four kinds, none of which is a verb on the money. '
  'Created EMPTY. No client role holds a privilege on it and it has RLS with no policy, so the only writer '
  'is internal_api.operator_add_commerce_review_note. The `order_id` it carries is derived from the refund '
  'by trigger, and all three parent links refuse their parent''s delete.';

-- ===========================================================================
-- 2. The authorisation carrier, read once per act (§5)
-- ===========================================================================

-- Three mutating bodies need the same thing — a case that is live, about this wedding, and locked — before
-- any other question is answered. It is one `private` helper rather than three copies because a duplicated
-- authorisation check is three chances to drift, and it is a definer because no API role can read
-- `private.support_cases` — the same measured reason slice 1 gives for `actor_is_operator`. It answers
-- `{}` rather than raising, so each body keeps its own §5 one-sentence refusal, and it returns jsonb rather
-- than an anonymous RECORD so the callers can assign it in an expression.
CREATE FUNCTION private.operator_authorising_case(p_case_ref text, p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_found jsonb;
BEGIN
  -- `FOR UPDATE` is the serialisation decision 3 relies on: two acts authorised by one ticket cannot both
  -- be mid-flight against it, and a case being closed cannot race a takedown that cites it. The three
  -- conditions are in the WHERE rather than in chained IFs because a row that fails them is not a row this
  -- act may hold, and locking a row only to refuse it would let a stranger's guessed ref serialise the
  -- ticket it does not match.
  SELECT jsonb_build_object('case_id', c.id, 'case_ref', c.case_ref, 'wedding_id', c.wedding_id,
                            'status', c.status)
    INTO v_found
    FROM private.support_cases c
   WHERE c.case_ref = btrim(p_case_ref)
     AND c.status IN ('open', 'triaged', 'in_progress')
     AND c.wedding_id = p_wedding_id
     FOR UPDATE OF c;
  RETURN coalesce(v_found, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION private.operator_authorising_case(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.operator_authorising_case(text, uuid) IS
  'The §5 authorisation carrier, read once per mutating Stage 11 act: locks the named case and requires it '
  'to be open, triaged or in_progress and its wedding to be the target. SECURITY DEFINER because no API '
  'role can read private.support_cases; VOLATILE because it takes a row lock. Answers an empty object '
  'rather than raising, so each body keeps its own refusal sentence, and is granted to no role.';

-- ===========================================================================
-- 3. The takedown (§6 step 1)
-- ===========================================================================

CREATE FUNCTION internal_api.operator_takedown_plan(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = ''
AS $$
DECLARE
  v_pub   public.publications;
  v_keys  jsonb;
  v_count integer;
BEGIN
  IF NOT private.actor_is_operator('operations') THEN
    RAISE EXCEPTION 'the caller may not plan a takedown for this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_wedding_id IS NULL THEN
    RAISE EXCEPTION 'a takedown plan names a wedding' USING ERRCODE = 'check_violation';
  END IF;

  -- The live publication if there is one; otherwise the most recently created, because a plan is also how
  -- an operator answers "what is still sitting in the bucket for that wedding" the day after a takedown.
  -- The tie-break is the row id, so two publications created in the same instant plan the same list.
  SELECT p.* INTO v_pub FROM public.publications p
   WHERE p.wedding_id = p_wedding_id
   ORDER BY (p.status = 'active') DESC, p.created_at DESC, p.id
   LIMIT 1;
  IF v_pub.id IS NULL THEN
    RAISE EXCEPTION 'this wedding has no publication to plan against' USING ERRCODE = 'check_violation';
  END IF;

  -- Every row that ever earned bytes, whatever its lifecycle state now: an artefact already `invalidated`
  -- still names an object that may still be in the bucket, and a plan that hid those would be a plan to
  -- leave them behind.
  SELECT coalesce(jsonb_agg(k.object_key ORDER BY k.object_key), '[]'::jsonb), count(*)
    INTO v_keys, v_count
    FROM (SELECT o.object_key FROM public.invitation_outputs o
           WHERE o.version_id = v_pub.version_id
             AND o.object_key IS NOT NULL
             AND o.content_digest IS NOT NULL) k;

  RETURN jsonb_build_object('wedding_id', p_wedding_id, 'publication_id', v_pub.id,
                            'publication_status', v_pub.status, 'version_id', v_pub.version_id,
                            'object_keys', v_keys, 'count', v_count,
                            'deletes_anything', false);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.operator_takedown_plan(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.operator_takedown_plan(uuid) TO authenticated;

CREATE FUNCTION api.operator_takedown_plan(p_wedding_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.operator_takedown_plan(p_wedding_id);
$$;

REVOKE ALL ON FUNCTION api.operator_takedown_plan(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.operator_takedown_plan(uuid) TO authenticated;

COMMENT ON FUNCTION internal_api.operator_takedown_plan(uuid) IS
  'Scope `operations`. STABLE, read-only: the publication this call would act on, its version, and the '
  'object keys a purge would list. One `insufficient_privilege` sentence for a caller with no live grant, '
  '`check_violation` for a wedding with no publication. Deletes nothing and moves no row.';

COMMENT ON FUNCTION api.operator_takedown_plan(uuid) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.operator_takedown_plan. Authenticated only.';

CREATE FUNCTION internal_api.operator_takedown_publication(
  p_wedding_id uuid,
  p_case_ref text,
  p_reason text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller   uuid;
  v_case     jsonb;
  v_pub      public.publications;
  v_seen     private.audit_events;
  v_payload  jsonb;
  v_tokens   integer := 0;
  v_outputs  integer := 0;
  v_audit_id bigint;
BEGIN
  v_caller := auth.uid();
  IF NOT private.actor_is_operator('operations') THEN
    RAISE EXCEPTION 'the caller may not take this publication down' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- §6's closed five. The vocabulary is a design table, not a secret, and naming it in the refusal is what
  -- makes an operator's typo answerable; slice 1 takes the same position on the four scope words.
  IF p_reason IS NULL OR p_reason NOT IN ('owner_request', 'terms_violation', 'safety', 'legal',
                                          'duplicate') THEN
    RAISE EXCEPTION 'unknown takedown reason %: the five are owner_request, terms_violation, safety, legal '
      'and duplicate', coalesce(quote_literal(p_reason), 'NULL') USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'a takedown requires an idempotency key: two clicks on one wedding must take it down '
      'once' USING ERRCODE = 'check_violation';
  END IF;

  v_case := private.operator_authorising_case(p_case_ref, p_wedding_id);
  IF v_case = '{}'::jsonb THEN
    -- One sentence for the four ways this fails — no such ref, another account's ticket, the wrong wedding,
    -- a parked or finished case — so the door is not an oracle over a minted `SV-` string (§5).
    RAISE EXCEPTION 'the caller may not take this publication down' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Decision 3, and it is read before the "is it still live" question because the reason a second delivery
  -- finds no active publication is that the first one revoked it. The subject comparison is on the
  -- `wedding_id` the trail row carries rather than on the publication id, because the publication this key
  -- retired is exactly the row that is no longer findable as active.
  SELECT a.* INTO v_seen FROM private.audit_events a
   WHERE a.idempotency_key = p_idempotency_key::text;
  IF v_seen.id IS NOT NULL THEN
    IF v_seen.subject_type IS DISTINCT FROM 'publication'
       OR v_seen.action IS DISTINCT FROM 'publication_takedown'
       OR v_seen.wedding_id IS DISTINCT FROM p_wedding_id THEN
      RAISE EXCEPTION 'this idempotency key already belongs to a different act: one key is one action'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN v_seen.payload || jsonb_build_object('audit_id', v_seen.id, 'replayed', true);
  END IF;

  -- The lock is what makes `one_active_publication_per_wedding` a serialisation rather than a coincidence:
  -- a second session blocks here, then either replays above or meets the refusal below, and cannot revoke a
  -- row that is already revoked.
  SELECT p.* INTO v_pub FROM public.publications p
   WHERE p.wedding_id = p_wedding_id AND p.status = 'active'
   FOR UPDATE OF p;
  IF v_pub.id IS NULL THEN
    RAISE EXCEPTION 'this wedding has no active publication to take down'
      USING ERRCODE = 'check_violation';
  END IF;

  -- §6 step 1 reproduces the *existing* revocation effect rather than re-deriving it: the statement the
  -- host's own door runs (`20260926150000_stage3_privileged_bodies_behind_wrappers.sql:339-343`), widened
  -- to both guest-facing kinds because an operator takedown is about the whole published artefact
  -- (`20261009120000_stage8_guest_invitations_rsvp.sql:1087-1090` is the pair in its own scope). Household
  -- rosters and approval-review credentials are deliberately untouched: a review credential names a
  -- reviewer, not a reader, and §13's roster row is about reachability, which this statement closes.
  UPDATE private.access_tokens SET revoked_at = now()
   WHERE wedding_id = p_wedding_id
     AND token_kind IN ('public_invitation', 'guest_invitation')
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_tokens = ROW_COUNT;

  UPDATE public.publications SET status = 'revoked', revoked_at = now() WHERE id = v_pub.id;

  -- Decision 5: `ready` only, and the guard on that table sets `invalidated_at` itself, so this statement
  -- names the reason and no clock.
  UPDATE public.invitation_outputs
     SET status = 'invalidated', invalidation_reason = 'publication_revoked'
   WHERE version_id = v_pub.version_id
     AND wedding_id = p_wedding_id
     AND status = 'ready';
  GET DIAGNOSTICS v_outputs = ROW_COUNT;

  INSERT INTO private.support_case_events
      (case_id, kind, actor_user_id, actor_kind, idempotency_key, created_at)
    VALUES ((v_case ->> 'case_id')::uuid, 'operation_link', v_caller, 'operator', p_idempotency_key, now());

  -- The answer and the payload are the same jsonb, which is what makes a replay return the first delivery's
  -- fields instead of a paraphrase of them. The two limit fields are §6's whole point: a stranger holding
  -- the guest address is stopped by this call, and a person holding a file link minted before it is not,
  -- because nothing here touched the object.
  v_payload := jsonb_build_object(
    'wedding_id', p_wedding_id,
    'case_ref', v_case ->> 'case_ref',
    'reason_category', p_reason,
    'publication_id', v_pub.id,
    'version_id', v_pub.version_id,
    'credentials_revoked', v_tokens,
    'outputs_invalidated', v_outputs,
    'file_links_still_valid_until_object_purge', true,
    'objects_deleted_by_this_call', false,
    'purge_function', 'internal_api.operator_purge_publication_objects');

  INSERT INTO private.audit_events
      (wedding_id, subject_type, subject_key, action, actor_user_id, actor_kind, reason,
       payload, before_state, after_state, idempotency_key)
    VALUES (p_wedding_id, 'publication', v_pub.id, 'publication_takedown', v_caller, 'operator',
            'publication of wedding ' || p_wedding_id || ' taken down by an operator citing case '
              || (v_case ->> 'case_ref') || ' as ' || p_reason || '; credentials revoked and ready '
              'artefacts marked invalid, no object deleted',
            v_payload,
            jsonb_build_object('publication_status', 'active'),
            jsonb_build_object('publication_status', 'revoked', 'credentials_revoked', v_tokens,
                               'outputs_invalidated', v_outputs),
            p_idempotency_key::text)
    RETURNING id INTO v_audit_id;

  RETURN v_payload || jsonb_build_object('audit_id', v_audit_id, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.operator_takedown_publication(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.operator_takedown_publication(uuid, text, text, uuid)
  TO authenticated;

CREATE FUNCTION api.operator_takedown_publication(
  p_wedding_id uuid,
  p_case_ref text,
  p_reason text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.operator_takedown_publication(p_wedding_id, p_case_ref, p_reason,
                                                    p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION api.operator_takedown_publication(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.operator_takedown_publication(uuid, text, text, uuid) TO authenticated;

COMMENT ON FUNCTION internal_api.operator_takedown_publication(uuid, text, text, uuid) IS
  'Scope `operations`, plus §5''s live case about this wedding, plus §6''s five reason categories, plus a '
  'key. In one transaction: both guest-facing credential kinds revoked, the active publication retired, its '
  '`ready` artefacts invalidated through Stage 9''s legal edge, one `operation_link` event, one `operator` '
  'trail row. Deletes no object, so the answer carries its own limit and names the body that covers it. A '
  'replayed key returns the first delivery''s fields and writes nothing.';

COMMENT ON FUNCTION api.operator_takedown_publication(uuid, text, text, uuid) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.operator_takedown_publication. Authenticated '
  'only; the body refuses an account with no live `operations` grant.';

-- ===========================================================================
-- 4. The purge planner (§6 step 2) — no browser surface, ever
-- ===========================================================================

CREATE FUNCTION internal_api.operator_purge_publication_objects(
  p_case_ref text,
  p_actor_user_id uuid,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_case      jsonb;
  v_pub       public.publications;
  v_tk_key    text;
  v_seen      private.audit_events;
  v_keys      jsonb;
  v_count     integer;
  v_payload   jsonb;
  v_audit_id  bigint;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'a purge names the account that decided it: on the trusted channel nobody is on the '
      'session, so an unattributed irreversible act is unanswerable afterwards'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Decision 2. On this channel `auth.uid()` is NULL by construction, so the named account is the actor and
  -- the grant table is what makes the name mean something: a live, unexpired `operations` grant held by
  -- exactly this uuid, read with the same four conditions slice 1's predicate applies to the session.
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_actor_user_id) THEN
    RAISE EXCEPTION 'the account named as the actor does not exist' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.operator_grants g
                  WHERE g.user_id = p_actor_user_id
                    AND g.scope = 'operations'
                    AND g.status = 'active'
                    AND (g.expires_at IS NULL OR g.expires_at > now())) THEN
    RAISE EXCEPTION 'the account named as the actor holds no live operations grant'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'a purge requires its own idempotency key' USING ERRCODE = 'check_violation';
  END IF;

  -- The case is the carrier here too, and the wedding it authorises is read from the case rather than
  -- supplied: an operator who wants a different wedding takes a different ticket.
  v_case := private.operator_authorising_case(p_case_ref,
                                              (SELECT c.wedding_id FROM private.support_cases c
                                                WHERE c.case_ref = btrim(p_case_ref)));
  IF v_case = '{}'::jsonb THEN
    RAISE EXCEPTION 'the caller may not plan this purge' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The most recently retired publication of the authorised wedding. A plan against an *active* publication
  -- would be a plan to delete the files the live invitation is still serving, which §6 puts outside this
  -- stage's vocabulary: retiring it is step 1's job and has to have happened first.
  SELECT p.* INTO v_pub FROM public.publications p
   WHERE p.wedding_id = (v_case ->> 'wedding_id')::uuid
     AND p.status = 'revoked'
   ORDER BY p.revoked_at DESC NULLS LAST, p.created_at DESC, p.id
   LIMIT 1;
  IF v_pub.id IS NULL THEN
    RAISE EXCEPTION 'this wedding has no revoked publication whose objects could be purged: retire the '
      'publication first, in a separate recorded act' USING ERRCODE = 'check_violation';
  END IF;

  -- §6's ordering enforced where it can be: a purge exists only against a publication somebody already
  -- retired, so the plan cannot be the first move.
  SELECT t.idempotency_key INTO v_tk_key FROM private.audit_events t
   WHERE t.subject_type = 'publication' AND t.subject_key = v_pub.id
     AND t.action = 'publication_takedown'
   ORDER BY t.id DESC LIMIT 1;
  IF v_tk_key IS NULL THEN
    RAISE EXCEPTION 'this publication has no recorded takedown to purge against: §6''s two facts are said '
      'in order, and the order is the audit trail' USING ERRCODE = 'check_violation';
  END IF;
  -- §6's "a second distinct idempotency key": one uuid cannot buy both halves, so a single click cannot be
  -- both the decision and its own irreversible confirmation.
  IF v_tk_key = p_idempotency_key::text THEN
    RAISE EXCEPTION 'the purge requires an idempotency key distinct from the takedown''s: two facts, two '
      'decisions' USING ERRCODE = 'check_violation';
  END IF;

  -- Read before both writes and before the replay return, because the replay path answers with it too: an
  -- operator re-asking the plan deserves the list as of now, not the list as of an hour ago. The two writes
  -- below are what a replay refuses to repeat.
  SELECT coalesce(jsonb_agg(k.object_key ORDER BY k.object_key), '[]'::jsonb), count(*)
    INTO v_keys, v_count
    FROM (SELECT o.object_key FROM public.invitation_outputs o
           WHERE o.version_id = v_pub.version_id
             AND o.object_key IS NOT NULL
             AND o.content_digest IS NOT NULL) k;

  -- Decision 3, after the two ordering checks because those read facts that cannot move: the retirement, the
  -- recorded takedown and the distinct key are all still true on a replay, so the replay path stays open.
  SELECT a.* INTO v_seen FROM private.audit_events a
   WHERE a.idempotency_key = p_idempotency_key::text;
  IF v_seen.id IS NOT NULL THEN
    IF v_seen.subject_type IS DISTINCT FROM 'publication'
       OR v_seen.subject_key IS DISTINCT FROM v_pub.id
       OR v_seen.action IS DISTINCT FROM 'publication_objects_purge_planned' THEN
      RAISE EXCEPTION 'this idempotency key already belongs to a different act: one key is one action'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN v_seen.payload || jsonb_build_object('object_keys', v_keys, 'count', v_count,
                                                'audit_id', v_seen.id, 'replayed', true);
  END IF;

  INSERT INTO private.support_case_events
      (case_id, kind, actor_user_id, actor_kind, idempotency_key, created_at)
    VALUES ((v_case ->> 'case_id')::uuid, 'operation_link', p_actor_user_id, 'operator',
            p_idempotency_key, now());

  -- Counts only, and that is §4's payload discipline with a specific referent: an object key names a
  -- household's rendered invitation, and the trail is read by whoever holds the trail. The keys go to the
  -- caller's own answer, which §11 prints before it asks for `--yes`.
  v_payload := jsonb_build_object(
    'wedding_id', v_pub.wedding_id,
    'case_ref', v_case ->> 'case_ref',
    'publication_id', v_pub.id,
    'version_id', v_pub.version_id,
    'objects_planned', v_count,
    'actor_named_by_argument', p_actor_user_id,
    'objects_deleted_by_this_call', false,
    'delete_channel', 'Storage API delete driven by scripts/stage11-operations-cli.mjs');

  INSERT INTO private.audit_events
      (wedding_id, subject_type, subject_key, action, actor_user_id, actor_kind, reason,
       payload, before_state, after_state, idempotency_key)
    VALUES (v_pub.wedding_id, 'publication', v_pub.id, 'publication_objects_purge_planned',
            p_actor_user_id,
            -- `maintenance`, not `operator`: §4 reserves `operator` for a decision made on the wire by a
            -- session that could prove it, and this row is a trusted-channel plan that names a human in an
            -- argument. The named human is still in `actor_user_id`, which is the half that answers "who
            -- decided".
            'maintenance',
            'object purge planned for publication ' || v_pub.id || ' by the account named on the call, '
              'citing case ' || (v_case ->> 'case_ref') || '; the plan lists keys to the caller, stores '
              'counts here, and deletes nothing',
            v_payload,
            jsonb_build_object('publication_status', 'revoked'),
            jsonb_build_object('objects_planned', v_count),
            p_idempotency_key::text)
    RETURNING id INTO v_audit_id;

  RETURN v_payload || jsonb_build_object('object_keys', v_keys, 'count', v_count,
                                         'audit_id', v_audit_id, 'replayed', false);
END;
$$;

-- No GRANT at all, and that sentence is the whole exposure story: the irreversible half of §6 has no browser
-- surface, so a stolen session cannot reach it and the only way to it is the peer-authenticated channel §11
-- describes, as `postgres`. C29c-b names it as the stage's ninth identity-taking body and re-measures that
-- no client role can execute it.
REVOKE ALL ON FUNCTION internal_api.operator_purge_publication_objects(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.operator_purge_publication_objects(text, uuid, uuid) IS
  'The §6 step-2 planner, and the stage''s third service-only identity-taking body. Requires a live '
  '`operations` grant held by the account named in `p_actor_user_id` — because on the trusted channel the '
  'session is `postgres` and `auth.uid()` is NULL — a live §5 case about the wedding that case names, a '
  'revoked publication with a recorded takedown, and a key distinct from that takedown''s. Returns the '
  'object keys and a count; deletes nothing, because removal is the CLI''s Storage call and Stage 9''s '
  'delete-then-mark ordering. Zero EXECUTE grants to any role: no `api` wrapper exists for it and none will.';

-- ===========================================================================
-- 5. The oversight queue and the note (§7)
-- ===========================================================================

CREATE FUNCTION internal_api.operator_commerce_review_queue(p_status text, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = ''
AS $$
DECLARE
  v_rows  jsonb;
  v_limit integer;
BEGIN
  IF NOT private.actor_is_operator('finance_review') THEN
    RAISE EXCEPTION 'the caller may not read the commerce review queue'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status IS NOT NULL
     AND p_status NOT IN ('recorded', 'succeeded', 'failed', 'reversed') THEN
    RAISE EXCEPTION 'unknown refund status %: the four are recorded, succeeded, failed and reversed',
      coalesce(quote_literal(p_status), 'NULL') USING ERRCODE = 'check_violation';
  END IF;
  -- The same window §10's case queue uses, for the same reason: this is an operator's screen, and a limit a
  -- caller can raise to a million is a way to read the whole ledger through a support tool.
  IF p_limit IS NULL THEN
    v_limit := 50;
  ELSIF p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'a review queue reads between 1 and 200 rows, not %', p_limit
      USING ERRCODE = 'check_violation';
  ELSE
    v_limit := p_limit;
  END IF;

  -- Field by field, and the fields are §7's list: what the refund is, what the order was frozen as, and what
  -- humans have said about it. `merchant_reference` is the provider's own string and is the only identifier
  -- a reviewer can take to a provider dashboard; no card or account data exists in this schema to leak.
  SELECT coalesce(jsonb_agg(q.k ORDER BY q.recorded_at DESC, q.refund_id), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT r.recorded_at, r.id AS refund_id,
        jsonb_build_object(
          'refund_id', r.id,
          'kind', r.kind,
          'status', r.status,
          'amount_minor', r.amount_minor,
          'currency', r.currency,
          'provider_refund_ref', r.provider_refund_ref,
          'recorded_at', r.recorded_at,
          'completed_at', r.completed_at,
          'wedding_id', o.wedding_id,
          'order', jsonb_build_object('order_id', o.id, 'package_code', o.package_code,
                                      'price_version', o.price_version,
                                      'merchant_reference', o.merchant_reference,
                                      'status', o.status, 'captured_at', o.captured_at),
          'notes', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                 'note_id', n.id, 'kind', n.kind, 'note', n.note,
                                 'case_ref', n.case_ref, 'case_status', c.status,
                                 'author_user_id', n.author_user_id, 'created_at', n.created_at)
                                 ORDER BY n.created_at, n.id)
                               FROM private.commerce_review_notes n
                               JOIN private.support_cases c ON c.case_ref = n.case_ref
                              WHERE n.refund_id = r.id), '[]'::jsonb)
        ) AS k
        FROM private.commerce_refunds r
        JOIN private.commerce_orders o ON o.id = r.order_id
       WHERE p_status IS NULL OR r.status = p_status
       ORDER BY r.recorded_at DESC, r.id
       LIMIT v_limit
    ) q;

  RETURN jsonb_build_object('refunds', v_rows, 'count', jsonb_array_length(v_rows),
                            'status_filter', p_status,
                            'moves_money', false,
                            'changes_entitlements', false);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.operator_commerce_review_queue(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.operator_commerce_review_queue(text, integer) TO authenticated;

CREATE FUNCTION api.operator_commerce_review_queue(p_status text, p_limit integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.operator_commerce_review_queue(p_status, p_limit);
$$;

REVOKE ALL ON FUNCTION api.operator_commerce_review_queue(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.operator_commerce_review_queue(text, integer) TO authenticated;

COMMENT ON FUNCTION internal_api.operator_commerce_review_queue(text, integer) IS
  'Scope `finance_review`. STABLE. §7''s refund/dispute read: the refund, the order as it was frozen, the '
  'notes, and the status of the case each note cites. It contains no INSERT and no UPDATE anywhere in its '
  'body, and the payment-policy singleton is not read, not written, and not grantable from here.';

COMMENT ON FUNCTION api.operator_commerce_review_queue(text, integer) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.operator_commerce_review_queue. Authenticated '
  'only; the body refuses an account with no live `finance_review` grant.';

CREATE FUNCTION internal_api.operator_add_commerce_review_note(
  p_refund_id uuid,
  p_case_ref text,
  p_kind text,
  p_note text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller   uuid;
  v_case     jsonb;
  v_refund   private.commerce_refunds;
  v_order    private.commerce_orders;
  v_seen     private.audit_events;
  v_note_id  uuid;
  v_payload  jsonb;
  v_audit_id bigint;
BEGIN
  v_caller := auth.uid();
  IF NOT private.actor_is_operator('finance_review') THEN
    RAISE EXCEPTION 'the caller may not annotate this refund' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('evidence_requested', 'in_review', 'escalated_to_owner',
                                      'documented_outcome') THEN
    RAISE EXCEPTION 'unknown review note kind %: the four are evidence_requested, in_review, '
      'escalated_to_owner and documented_outcome', coalesce(quote_literal(p_kind), 'NULL')
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) = 0 OR length(p_note) > 4000 THEN
    RAISE EXCEPTION 'a review note is real text of at most 4000 characters, and % is neither',
      coalesce(length(p_note)::text, 'a missing note') USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'a review note requires an idempotency key: two clicks must produce one note'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Locked before anything is decided: the refund is the subject, and a refund being written while a note is
  -- added to it is exactly the pairing §7 refuses to have a queue that could misreport.
  SELECT r.* INTO v_refund FROM private.commerce_refunds r WHERE r.id = p_refund_id
    FOR UPDATE OF r;
  IF v_refund.id IS NULL THEN
    RAISE EXCEPTION 'the caller may not annotate this refund' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT o.* INTO v_order FROM private.commerce_orders o WHERE o.id = v_refund.order_id;

  v_case := private.operator_authorising_case(p_case_ref, v_order.wedding_id);
  IF v_case = '{}'::jsonb THEN
    RAISE EXCEPTION 'the caller may not annotate this refund' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT a.* INTO v_seen FROM private.audit_events a
   WHERE a.idempotency_key = p_idempotency_key::text;
  IF v_seen.id IS NOT NULL THEN
    IF v_seen.subject_type IS DISTINCT FROM 'commerce_refund'
       OR v_seen.subject_key IS DISTINCT FROM v_refund.id THEN
      RAISE EXCEPTION 'this idempotency key already belongs to a different act: one key is one action, and '
        'answering with that act would report a note this refund never saw'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN v_seen.payload || jsonb_build_object('audit_id', v_seen.id, 'replayed', true);
  END IF;

  -- One INSERT, and it is the only write to the money-adjacent surface in this stage. The refund row is not
  -- re-read afterwards because nothing in it changed, and `refund_row_changed: false` below is a statement
  -- the battery verifies against a digest rather than a sentence nobody checked.
  INSERT INTO private.commerce_review_notes
      (refund_id, order_id, case_ref, author_user_id, kind, note, idempotency_key, created_at)
    VALUES (v_refund.id, v_refund.order_id, v_case ->> 'case_ref', v_caller, p_kind, btrim(p_note),
            p_idempotency_key, now())
    RETURNING id INTO v_note_id;

  INSERT INTO private.support_case_events
      (case_id, kind, actor_user_id, actor_kind, idempotency_key, created_at)
    VALUES ((v_case ->> 'case_id')::uuid, 'operation_link', v_caller, 'operator', p_idempotency_key, now());

  -- §4's discipline, applied to the one column in this slice that carries prose: the note text lives in the
  -- note row and nowhere else. The trail says that a note was written, about which refund, of which kind —
  -- a column that copied the note would put a provider reference or a customer's sentence into a store
  -- readable by whoever holds the store.
  v_payload := jsonb_build_object(
    'note_id', v_note_id,
    'refund_id', v_refund.id,
    'order_id', v_refund.order_id,
    'wedding_id', v_order.wedding_id,
    'case_ref', v_case ->> 'case_ref',
    'kind', p_kind,
    'note_only', true,
    'money_moved', false,
    'entitlement_changed', false,
    'refund_row_changed', false);

  INSERT INTO private.audit_events
      (wedding_id, subject_type, subject_key, action, actor_user_id, actor_kind, reason,
       payload, before_state, after_state, idempotency_key)
    VALUES (v_order.wedding_id, 'commerce_refund', v_refund.id, 'commerce_review_note_added',
            v_caller, 'operator',
            'a ' || p_kind || ' review note was added to refund ' || v_refund.id || ' by an operator '
              'citing case ' || (v_case ->> 'case_ref') || '; the note text stays in the note row, and no '
              'money or entitlement moved here',
            v_payload,
            jsonb_build_object('refund_status', v_refund.status),
            jsonb_build_object('refund_status', v_refund.status),
            p_idempotency_key::text)
    RETURNING id INTO v_audit_id;

  RETURN v_payload || jsonb_build_object('audit_id', v_audit_id, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.operator_add_commerce_review_note(uuid, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.operator_add_commerce_review_note(uuid, text, text, text, uuid)
  TO authenticated;

CREATE FUNCTION api.operator_add_commerce_review_note(
  p_refund_id uuid,
  p_case_ref text,
  p_kind text,
  p_note text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.operator_add_commerce_review_note(p_refund_id, p_case_ref, p_kind, p_note,
                                                        p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION api.operator_add_commerce_review_note(uuid, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.operator_add_commerce_review_note(uuid, text, text, text, uuid)
  TO authenticated;

COMMENT ON FUNCTION internal_api.operator_add_commerce_review_note(uuid, text, text, text, uuid) IS
  'Scope `finance_review`, plus §5''s live case about the wedding the refund''s order belongs to. One note '
  'row, one `operation_link` event, one `operator` trail row, and nothing else: the refund keeps its status, '
  'no entitlement is granted or revoked, no policy value is read or written. The answer carries '
  '`money_moved: false` because the kind of oversight this stage ships is review, and a caller should not '
  'have to read the body to find that out.';

COMMENT ON FUNCTION api.operator_add_commerce_review_note(uuid, text, text, text, uuid) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.operator_add_commerce_review_note. '
  'Authenticated only; the body refuses an account with no live `finance_review` grant.';

-- ===========================================================================
-- 6. What this file leaves behind
-- ===========================================================================
-- One empty table, four `private` functions, five `internal_api` bodies, four `api` wrappers, and one body
-- that is deliberately unpaired. The `operations` and `finance_review` scopes already exist in slice 1's
-- CHECK and predicate, so no authority shape moved here either: granting a person these duties is still the
-- one trusted body in file 190000, and revoking it is still the other.
--
-- What is NOT here, stated because §6, §7 and the kickoff each name a thing an admin console would be
-- expected to do: no refund is created, marked succeeded or reversed; no entitlement is granted, extended or
-- revoked; no price, package or policy value is written; no row is deleted from any table; no object is
-- removed from Storage. The purge body plans, and records that it planned. The takedown's second fact — the
-- objects actually going away — is the CLI's Storage call (§11), and until that call runs the file links
-- minted before the takedown still serve, which §6 says out loud and both tiers measure rather than smooth
-- over.
