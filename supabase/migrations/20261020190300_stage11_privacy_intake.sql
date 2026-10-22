-- Stage 11 / file 3 of 5 — privacy intake: receive a request, route it, never erase anything.
--
-- Written against `docs/architecture/operations-admin-security.md` §8 and §10. This file adds one table,
-- three private helpers, four `internal_api` bodies and their four `api` wrappers. It inserts no row, and
-- the destructive half of a privacy request is deliberately absent: there is no DELETE arm here, no
-- function below names a DELETE, and `private.privacy_requests` is the one Stage 11 table whose whole
-- reason for existing is that a later legal decision can point at it.
--
-- Three places where §8's prose and the platform disagree, each resolved in favour of the measured rule
-- and recorded here rather than only in the battery:
--
--   1. §8 says `requester_user_id` is NOT NULL. It cannot be both NOT NULL and `ON DELETE SET NULL`, and
--      the second is what keeps a request (and the evidence that it preceded an erasure) from making its
--      own requester's account undeletable. Slice 2's group T measured exactly that collision for support
--      cases (`q11-logs/s11-probe-fk-null-1.txt`), and the repair is the same one: the column is nullable
--      on disk, and a BEFORE INSERT guard refuses a hand-written row that names nobody. The API body
--      always writes `auth.uid()`, so every door-created row names its requester; only the database's own
--      referential nulling can empty the link afterwards.
--
--   2. §8's CHECK for the satisfied status is `length(btrim(operator_note)) > 0`. With a NULL note that
--      expression is NULL, and a CHECK accepts NULL, so the declared constraint would let a request be
--      marked satisfied with no note at all. The constraint below adds `operator_note IS NOT NULL`; the
--      battery plants the NULL case and expects a refusal rather than a pass for the wrong reason.
--
--   3. §10 gives the host's create door no idempotency-key argument. A double-tapped privacy request is
--      still a duplicate a queue should not hold, so the anchor is the database's own state rather than a
--      caller-chosen uuid: one *active* request per `(requester, wedding, kind)`, enforced by a partial
--      unique index. The second delivery returns the first row with `replayed=true` and writes nothing,
--      and because the lookup is scoped to `requester_user_id` it cannot answer with somebody else's
--      request. The operator's advance does take a key, and its replay anchor is the audit row's global
--      partial unique index — the trail is the only history this table has.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. The request (§8)
-- ===========================================================================

CREATE TABLE private.privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- `PR-` plus eight base32 characters, minted by the trigger below. The prefix is part of the CHECK: a
  -- hand row cannot borrow the support prefix and pass as a different kind of evidence.
  request_ref text NOT NULL UNIQUE
    CHECK (request_ref ~ '^PR-[A-Z2-7]{8}$'),
  -- **NO ACTION**: the request is the reason a later erasure is allowed to proceed, so deleting the
  -- wedding must fail loudly while a request about it exists rather than cascade the reason away.
  wedding_id uuid NOT NULL REFERENCES public.weddings(id) ON DELETE NO ACTION,
  -- Nullable on disk and named on insert; see header item 1. The read surface filters on this column, so
  -- a request whose requester account was erased is visible to the privacy queue and to nobody else.
  requester_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL
    CHECK (kind IN ('export', 'erasure')),
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'identity_verification_requested', 'queued_for_stage13',
                      'satisfied_outside_this_build', 'declined')),
  -- The host's own words, optional but bounded: this is caller text that reaches an operator's screen, and
  -- §4 keeps it out of the audit trail.
  host_note text
    CHECK (host_note IS NULL OR (length(btrim(host_note)) > 0 AND length(host_note) <= 2000)),
  -- The operator's annotation, bounded like every other operator-facing text in the stage. It is not in
  -- the host's projection: a note about how identity was checked is not the host's record.
  operator_note text
    CHECK (operator_note IS NULL OR (length(btrim(operator_note)) > 0 AND length(operator_note) <= 4000)),
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Header item 2. The guard trigger repeats this sentence with a clearer message; the CHECK is the wall a
  -- hand plant meets when it bypasses the body.
  CONSTRAINT privacy_requests_satisfied_names_where_check
    CHECK (status <> 'satisfied_outside_this_build'
           OR (operator_note IS NOT NULL AND length(btrim(operator_note)) > 0))
);

-- One *active* request per requester, wedding and kind. A host who double-taps the form gets the first
-- request back; a host who was declined, or whose request was satisfied elsewhere, may ask again because
-- the partial index only covers the three live statuses. `requester_user_id` is part of the key so this is
-- a per-caller anchor, never a global one: it can suppress this account's duplicate and cannot collide
-- with, or reveal, another account's request. (Rows whose requester was erased have a NULL here, and NULLs
-- are not equal in a unique index, so an erased account's surviving request constrains nobody.)
CREATE UNIQUE INDEX privacy_requests_active_uniq
  ON private.privacy_requests (requester_user_id, wedding_id, kind)
  WHERE status IN ('received', 'identity_verification_requested', 'queued_for_stage13');

CREATE INDEX privacy_requests_requester_requested_idx
  ON private.privacy_requests (requester_user_id, requested_at DESC);
CREATE INDEX privacy_requests_status_requested_idx
  ON private.privacy_requests (status, requested_at);

CREATE FUNCTION private.mint_privacy_request_ref() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  -- The same unambiguous base32 alphabet the support ref uses; see `mint_support_case_ref` for why the
  -- letters that read alike off a phone screen are absent.
  v_alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  v_bits text;
  v_ref text := 'PR-';
  v_i int;
BEGIN
  IF NEW.request_ref IS NOT NULL THEN
    RAISE EXCEPTION 'a privacy request ref is minted by the database, never supplied: it is the string a '
      'later erasure decision and an operator advance name as their authorisation, and a caller that could '
      'choose it could choose somebody else''s'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_bits := (('x' || encode(extensions.gen_random_bytes(5), 'hex'))::bit(40))::text;
  FOR v_i IN 0..7 LOOP
    v_ref := v_ref || substr(v_alphabet, (substring(v_bits, v_i * 5 + 1, 5)::bit(5))::int + 1, 1);
  END LOOP;

  NEW.request_ref := v_ref;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.mint_privacy_request_ref()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER privacy_requests_mint_ref BEFORE INSERT ON private.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION private.mint_privacy_request_ref();

-- The insert half of header item 1. A CHECK cannot carry this rule because the same column must be allowed
-- to go NULL when its account is erased, and a constraint is re-evaluated on every UPDATE. A BEFORE INSERT
-- trigger is exactly as wide as the rule: rows must be born with a requester, and the referential action is
-- the one statement that never passes through here.
CREATE FUNCTION private.reject_privacy_request_without_requester() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
BEGIN
  IF NEW.requester_user_id IS NULL THEN
    RAISE EXCEPTION 'a privacy request must name the account that filed it: the link is nullable only so '
      'that erasing that account can release it without deleting the request'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_privacy_request_without_requester()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER privacy_requests_require_requester BEFORE INSERT ON private.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION private.reject_privacy_request_without_requester();

-- The state machine. Two terminal states, no reopen: an erasure request that was declined is a decision,
-- and a second attempt is a new request rather than a rewrite of the refusal.
CREATE FUNCTION private.guard_privacy_request_update() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
BEGIN
  IF NEW.request_ref IS DISTINCT FROM OLD.request_ref THEN
    RAISE EXCEPTION 'privacy_requests.request_ref is minted once and quoted forever'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.wedding_id IS DISTINCT FROM OLD.wedding_id THEN
    RAISE EXCEPTION 'a privacy request cannot be re-parented onto another wedding: the wedding named on '
      'the request is the scope of the data it asks about' USING ERRCODE = '42501';
  END IF;
  -- The one UPDATE the database itself issues for an ON DELETE SET NULL arrives at depth two with the link
  -- going to NULL. Everything a caller can attempt is refused, including a NULL issued by a statement of
  -- its own — the same measured distinction slice 2 records in `guard_support_case_update`.
  IF NEW.requester_user_id IS DISTINCT FROM OLD.requester_user_id
     AND (NEW.requester_user_id IS NOT NULL OR pg_trigger_depth() < 2) THEN
    RAISE EXCEPTION 'a privacy request cannot change hands: whose request it is decides whose read '
      'surface it appears on' USING ERRCODE = '42501';
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'export or erasure is the request''s own subject, declared by the host, and is not '
      'edited afterwards; an operator who believes it is mislabelled declines it and says why'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.host_note IS DISTINCT FROM OLD.host_note
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'what the host asked and when are the first two facts in this request''s history'
      USING ERRCODE = '42501';
  END IF;

  -- A write that moves no status is an annotation (or the referential nulling above); it may change the
  -- operator's note and nothing else this guard has not already refused.
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('satisfied_outside_this_build', 'declined') THEN
    RAISE EXCEPTION 'a % privacy request is terminal: a later request is a new row, not a rewrite of this '
      'decision', OLD.status USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (
       (OLD.status = 'received'                      AND NEW.status IN
          ('identity_verification_requested', 'queued_for_stage13', 'declined'))
    OR (OLD.status = 'identity_verification_requested' AND NEW.status IN
          ('queued_for_stage13', 'declined'))
    OR (OLD.status = 'queued_for_stage13'              AND NEW.status IN
          ('satisfied_outside_this_build', 'declined'))
  ) THEN
    RAISE EXCEPTION 'no edge % → % exists in the privacy request lifecycle', OLD.status, NEW.status
      USING ERRCODE = 'check_violation',
            HINT = 'received -> (identity_verification_requested | queued_for_stage13), either of those -> '
                   'queued_for_stage13, queued_for_stage13 -> satisfied_outside_this_build; declined is '
                   'reachable from any live status, and both satisfied and declined are terminal';
  END IF;

  IF NEW.status = 'satisfied_outside_this_build'
     AND (NEW.operator_note IS NULL OR length(btrim(NEW.operator_note)) = 0) THEN
    RAISE EXCEPTION 'entering satisfied_outside_this_build requires an operator note saying where the '
      'request was satisfied: the status speaks of completion, and a completion nobody can name is not '
      'evidence' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_privacy_request_update()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER privacy_requests_guard_update BEFORE UPDATE ON private.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION private.guard_privacy_request_update();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON private.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER privacy_requests_no_client_write BEFORE INSERT OR UPDATE ON private.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER privacy_requests_no_client_delete BEFORE DELETE ON private.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

ALTER TABLE private.privacy_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.privacy_requests
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.privacy_requests IS
  'One received privacy request: a minted `PR-` ref, the wedding it is about, the account that filed it, '
  '`export` or `erasure`, a five-state routing machine, the host''s optional note and the operator''s '
  'annotation. Created EMPTY. RLS with no policy and no grant to any client role; the only writers are the '
  'internal_api bodies below. The wedding FK is NO ACTION so the request outlives the data it asks about; '
  'the requester link is SET NULL so erasing the account leaves the request and its trail standing. No '
  'function in this stage deletes a row from any table — satisfaction records that a human acted '
  'elsewhere, and Stage 13 owns the destructive decision.';

-- ===========================================================================
-- 2. The host's two doors (§10)
-- ===========================================================================

CREATE FUNCTION internal_api.create_privacy_request(
  p_wedding_id uuid,
  p_kind text,
  p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_row private.privacy_requests;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'this door needs a signed-in account' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('export', 'erasure') THEN
    RAISE EXCEPTION 'unknown privacy request kind %: the two are export and erasure, and neither of them '
      'deletes anything', coalesce(quote_literal(p_kind), 'NULL') USING ERRCODE = 'check_violation';
  END IF;
  IF p_note IS NOT NULL AND (length(btrim(p_note)) = 0 OR length(p_note) > 2000) THEN
    RAISE EXCEPTION 'a privacy request note is either real text or absent, and % characters is neither',
      length(p_note) USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_caller) THEN
    RAISE EXCEPTION 'the caller may not open a privacy request about this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The duplicate anchor is this account's own live request, not a caller-supplied key. The requester term
  -- is the whole privacy of the lookup: without it a second account could read the first account's ref and
  -- status out of a replay answer, which is the defect slice 2's replay probe measured on its first draft.
  SELECT r.* INTO v_row FROM private.privacy_requests r
   WHERE r.requester_user_id = v_caller
     AND r.wedding_id = p_wedding_id
     AND r.kind = p_kind
     AND r.status IN ('received', 'identity_verification_requested', 'queued_for_stage13');
  IF FOUND THEN
    RETURN jsonb_build_object('request_ref', v_row.request_ref, 'wedding_id', v_row.wedding_id,
                              'kind', v_row.kind, 'status', v_row.status,
                              'requested_at', v_row.requested_at, 'replayed', true);
  END IF;

  INSERT INTO private.privacy_requests
      (wedding_id, requester_user_id, kind, status, host_note, requested_at)
    VALUES (p_wedding_id, v_caller, p_kind, 'received', btrim(p_note), now())
  RETURNING * INTO v_row;

  -- No audit row: the host filing a request is the subject of the request, not an operator act, and the row
  -- itself is the history. This is the same line `open_support_case` draws between a host's own words and
  -- the trail §4 reserves for accountable acts.
  RETURN jsonb_build_object('request_ref', v_row.request_ref, 'wedding_id', v_row.wedding_id,
                            'kind', v_row.kind, 'status', v_row.status,
                            'requested_at', v_row.requested_at, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.create_privacy_request(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.create_privacy_request(uuid, text, text) TO authenticated;

CREATE FUNCTION api.create_privacy_request(
  p_wedding_id uuid,
  p_kind text,
  p_note text
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.create_privacy_request(p_wedding_id, p_kind, p_note);
$$;

REVOKE ALL ON FUNCTION api.create_privacy_request(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.create_privacy_request(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION internal_api.create_privacy_request(uuid, text, text) IS
  'The caller must own the wedding, re-derived from auth.uid(); the requester is that same account and is '
  'never an argument. Refuses an unknown kind and a blank or oversized note. A second delivery while this '
  'account''s request for the same wedding and kind is live returns the first row with replayed=true and '
  'writes nothing; the anchor is per caller, so no key and no lookup can reach another account''s request.';

COMMENT ON FUNCTION api.create_privacy_request(uuid, text, text) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.create_privacy_request. Authenticated only. '
  'Receives a request; it deletes nothing, and its `kind` vocabulary has no destructive arm.';

CREATE FUNCTION internal_api.get_my_privacy_requests()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_rows jsonb;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'this door needs a signed-in account' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The host's own projection. `operator_note` is deliberately absent: it is the operator's working record,
  -- and the support projection draws the same line for the same reason.
  SELECT coalesce(jsonb_agg(q.k), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object('request_ref', r.request_ref, 'wedding_id', r.wedding_id,
                              'kind', r.kind, 'status', r.status, 'host_note', r.host_note,
                              'requested_at', r.requested_at, 'updated_at', r.updated_at) AS k
      FROM private.privacy_requests r
     WHERE r.requester_user_id = v_caller
     ORDER BY r.requested_at DESC, r.request_ref
  ) q;

  RETURN jsonb_build_object('requests', v_rows, 'count', jsonb_array_length(v_rows));
END;
$$;

REVOKE ALL ON FUNCTION internal_api.get_my_privacy_requests()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.get_my_privacy_requests() TO authenticated;

CREATE FUNCTION api.get_my_privacy_requests()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.get_my_privacy_requests();
$$;

REVOKE ALL ON FUNCTION api.get_my_privacy_requests()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.get_my_privacy_requests() TO authenticated;

COMMENT ON FUNCTION internal_api.get_my_privacy_requests() IS
  'SECURITY DEFINER, STABLE. Only rows whose requester_user_id is the caller. Returns the ref, wedding, '
  'kind, status, the host''s own note and both timestamps; never the operator''s annotation and never '
  'anybody else''s request.';

COMMENT ON FUNCTION api.get_my_privacy_requests() IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.get_my_privacy_requests. Authenticated only.';

-- ===========================================================================
-- 3. The privacy desk's two doors (§10)
-- ===========================================================================

CREATE FUNCTION internal_api.operator_privacy_queue(p_status text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT private.actor_is_operator('privacy') THEN
    RAISE EXCEPTION 'the caller may not read the privacy queue' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('received', 'identity_verification_requested',
                                               'queued_for_stage13', 'satisfied_outside_this_build',
                                               'declined') THEN
    RAISE EXCEPTION 'unknown privacy status %: a filter word this lifecycle does not have would answer '
      'with an empty queue and look like a quiet desk', quote_literal(p_status)
      USING ERRCODE = 'check_violation';
  END IF;

  -- Oldest first, because this is a queue: the request that has been waiting longest is the one a privacy
  -- duty is failing first. The ref breaks ties so two requests sharing a timestamp have one stable order.
  SELECT coalesce(jsonb_agg(q.k), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object('request_ref', r.request_ref, 'wedding_id', r.wedding_id,
                              'requester_user_id', r.requester_user_id, 'kind', r.kind,
                              'status', r.status, 'host_note', r.host_note,
                              'operator_note', r.operator_note, 'requested_at', r.requested_at,
                              'updated_at', r.updated_at) AS k
      FROM private.privacy_requests r
     WHERE p_status IS NULL OR r.status = p_status
     ORDER BY r.requested_at ASC, r.request_ref
  ) q;

  RETURN jsonb_build_object('requests', v_rows, 'status_filter', p_status,
                            'count', jsonb_array_length(v_rows));
END;
$$;

REVOKE ALL ON FUNCTION internal_api.operator_privacy_queue(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.operator_privacy_queue(text) TO authenticated;

CREATE FUNCTION api.operator_privacy_queue(p_status text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.operator_privacy_queue(p_status);
$$;

REVOKE ALL ON FUNCTION api.operator_privacy_queue(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.operator_privacy_queue(text) TO authenticated;

COMMENT ON FUNCTION internal_api.operator_privacy_queue(text) IS
  'Scope `privacy`, re-derived from auth.uid(). Every request, oldest first, with the operator projection '
  'including the annotation; the host projection never carries that column. A status filter outside the '
  'five refuses rather than answering empty.';

COMMENT ON FUNCTION api.operator_privacy_queue(text) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.operator_privacy_queue. Authenticated only; '
  'the body refuses an account with no live `privacy` grant.';

CREATE FUNCTION internal_api.operator_advance_privacy_request(
  p_request_ref text,
  p_status text,
  p_note text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_row private.privacy_requests;
  v_after private.privacy_requests;
  v_seen private.audit_events;
  v_audit_id bigint;
  v_from text;
  v_note text;
BEGIN
  v_caller := auth.uid();
  IF NOT private.actor_is_operator('privacy') THEN
    RAISE EXCEPTION 'the caller may not change this privacy request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('received', 'identity_verification_requested',
                                          'queued_for_stage13', 'satisfied_outside_this_build',
                                          'declined') THEN
    RAISE EXCEPTION 'unknown privacy status %: the five are received, identity_verification_requested, '
      'queued_for_stage13, satisfied_outside_this_build and declined',
      coalesce(quote_literal(p_status), 'NULL') USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'advancing a privacy request requires an idempotency key'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_note IS NOT NULL AND (length(btrim(p_note)) = 0 OR length(p_note) > 4000) THEN
    RAISE EXCEPTION 'an operator note is either real text or absent, and % characters is neither',
      length(p_note) USING ERRCODE = 'check_violation';
  END IF;

  SELECT r.* INTO v_row FROM private.privacy_requests r
   WHERE r.request_ref = btrim(p_request_ref)
     FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the caller may not change this privacy request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The replay anchor is the audit row, because this table has no event thread. The lookup is global on the
  -- key on purpose: a key that already wrote a row about a *different* request must be refused here rather
  -- than collide with the partial unique index after this request's status has moved, and the refusal names
  -- no other subject.
  SELECT a.* INTO v_seen FROM private.audit_events a
   WHERE a.idempotency_key = p_idempotency_key::text;
  IF FOUND THEN
    IF v_seen.subject_type IS DISTINCT FROM 'privacy_request'
       OR v_seen.subject_key IS DISTINCT FROM v_row.id THEN
      RAISE EXCEPTION 'this idempotency key already belongs to a different act: one key is one action, '
        'and answering with that act would report a change this request never saw'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN jsonb_build_object('request_ref', v_row.request_ref,
                              'from_status', v_seen.before_state ->> 'status',
                              'to_status', v_seen.after_state ->> 'status',
                              'audit_id', v_seen.id, 'replayed', true);
  END IF;

  IF p_status = 'received' THEN
    RAISE EXCEPTION 'a privacy request may not be moved back to received: the desk saw it the moment it '
      'arrived, and a request that was worked is not new again' USING ERRCODE = 'check_violation';
  END IF;
  IF p_status = v_row.status THEN
    RAISE EXCEPTION 'this privacy request is already %: a second delivery of the same advance is refused '
      'rather than absorbed, because the trail would then hold two rows claiming one change', p_status
      USING ERRCODE = 'check_violation';
  END IF;

  v_from := v_row.status;
  -- A move that carries no note keeps the annotation already on the row; a satisfied move is checked
  -- against the *effective* note, so an earlier annotation can carry the completion and a blank one cannot.
  v_note := coalesce(btrim(p_note), v_row.operator_note);
  IF p_status = 'satisfied_outside_this_build'
     AND (v_note IS NULL OR length(btrim(v_note)) = 0) THEN
    RAISE EXCEPTION 'entering satisfied_outside_this_build requires an operator note saying where the '
      'request was satisfied: the status speaks of completion, and a completion nobody can name is not '
      'evidence' USING ERRCODE = 'check_violation';
  END IF;

  -- The edge table lives in the trigger. A stale tab, a double click and a hand-written UPDATE therefore
  -- meet one sentence, and a body that repeated the edges could drift from the table that enforces them.
  UPDATE private.privacy_requests r
     SET status = p_status, operator_note = v_note
   WHERE r.id = v_row.id;

  SELECT r.* INTO v_after FROM private.privacy_requests r WHERE r.id = v_row.id;

  INSERT INTO private.audit_events
      (wedding_id, subject_type, subject_key, action, actor_user_id, actor_kind, reason,
       payload, before_state, after_state, idempotency_key)
    VALUES (v_row.wedding_id, 'privacy_request', v_row.id, 'privacy_status_changed',
            v_caller, 'operator',
            'privacy request ' || v_row.request_ref || ' moved ' || v_from || ' to ' || p_status,
            jsonb_build_object('request_ref', v_row.request_ref, 'wedding_id', v_row.wedding_id,
                               'kind', v_row.kind),
            jsonb_build_object('status', v_from),
            jsonb_build_object('status', v_after.status),
            p_idempotency_key::text)
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object('request_ref', v_row.request_ref, 'from_status', v_from,
                            'to_status', v_after.status, 'audit_id', v_audit_id, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.operator_advance_privacy_request(text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.operator_advance_privacy_request(text, text, text, uuid)
  TO authenticated;

CREATE FUNCTION api.operator_advance_privacy_request(
  p_request_ref text,
  p_status text,
  p_note text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.operator_advance_privacy_request(p_request_ref, p_status, p_note,
                                                       p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION api.operator_advance_privacy_request(text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.operator_advance_privacy_request(text, text, text, uuid)
  TO authenticated;

COMMENT ON FUNCTION internal_api.operator_advance_privacy_request(text, text, text, uuid) IS
  'Scope `privacy`. Refuses an unknown target, a move back to received, a same-status repeat, a blank or '
  'oversized note, a keyless call, a satisfied move with no effective note, and a ref this desk cannot see '
  '— with one sentence whether the ref is foreign or invented. The edge table is the trigger''s answer. '
  'One update and one audit row per accepted call; a replayed key returns the row that first wrote and '
  'writes nothing. It never deletes anything.';

COMMENT ON FUNCTION api.operator_advance_privacy_request(text, text, text, uuid) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.operator_advance_privacy_request. '
  'Authenticated only; the body refuses an account with no live `privacy` grant.';

-- ===========================================================================
-- 4. What this file leaves behind
-- ===========================================================================
-- One empty table, seven names in `private`, four callable pairs, zero rows. The `privacy` scope already
-- exists in slice 1's CHECK and predicate, so no authority shape moves here: granting a person this duty
-- is still the one trusted body in file 1, and revoking it is still the other.
