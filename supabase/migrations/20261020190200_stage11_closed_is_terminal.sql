-- Stage 11 / the slice-2 closure repair (migration file 3 of 6, between slice 2 and slice 3) — closure
-- means closure, in the two places where slice 2 left it a sentence rather than a rule, plus the
-- referential-null exception the first version of this file dropped.
--
-- §5 states that `closed` is terminal, and `20261020190100_stage11_support_cases.sql` says so in three
-- write doors — `reply_to_support_case` ("a closed support case takes no further messages"),
-- `operator_add_case_note` ("a closed support case takes no further rows"), `operator_claim_case` ("a
-- closed support case is not rewritten, and claiming it is a rewrite") — and once in the wall
-- (`guard_support_case_update`: "a closed support case is terminal"). The fourth write door,
-- `operator_release_case`, carries no such sentence, and the wall's terminal test sits *below* its
-- "the status did not change" branch — which the release always takes, because a release moves the
-- assignee and not the status. So neither the door nor the guard refused it.
--
-- Measured on a throwaway chain built at `37a6989`, inside one transaction that was rolled back:
--
--   `q11-logs/s11-s2-release-closed-probe.txt` — a ticket planted in `closed` with the calling operator
--       still holding it. `api.operator_release_case` answers
--       `{"seq": 1, "audit_id": 1, "case_ref": "SV-5HCZPX5J", "replayed": false, …}`, i.e. accepted,
--       while `api.operator_claim_case` on the same row refuses with slice 2's own sentence.
--   `q11-logs/s11-s2-release-closed-probe2b.txt` — the accepted call's footprint: the assignee is
--       cleared, the closed thread gains `1:assignment:operator`, and `private.audit_events` gains a
--       `case_released/operator` row whose subject is a finished ticket.
--
-- That is not a privilege escalation — every actor here already holds `support`, and the release is
-- still restricted to the operator who holds the case. What it breaks is the property §5 and priority 9
-- of the directive are about: an ended case whose history keeps growing is a case whose history cannot
-- be trusted to have ended, and a review that reads `closed` as "nothing after this row" reads it wrong.
-- The same asymmetry is also a *test* problem: the battery can assert that three doors refuse a closed
-- ticket, and the reader of those assertions cannot tell closure from "three of four doors".
--
-- The guard's own comment at slice 2 already states the intended rule — "Only the assignment moves on a
-- live status" — so this is the code catching up with the sentence above it, not a new policy. The other
-- fact visible in that capture is worth keeping: `now()` is the transaction timestamp, so the planted
-- row's `updated_at` did not appear to move even though the row was written. A battery cell that trusted
-- `updated_at` to prove a write would have been measuring the clock, not the door.
--
-- A third defect lives in the same body, and it was found by the battery rather than by a probe: when this
-- file first replaced `guard_support_case_update`, it dropped the exception slice 2 had written for the
-- database's own `ON DELETE SET NULL`. The declared link behaviour became decoration — every account named
-- by a ticket was undeletable, and `85_support_lifecycle.sql` T72 heard this guard's "cannot change hands"
-- where the schema's `support_cases_wedding_id_fkey` should have answered 23503. Measured with a diagnostic
-- trigger on the built chain (`q11-logs/s11-depth-probe.sql`): the referential action arrives at
-- `pg_trigger_depth() = 2` on both this table and `private.audit_events`, while a caller's statement arrives
-- at 1. The body below therefore carries slice 2's exception again — for the attribution links only, never
-- for `opened_at` or `open_idempotency_key` — and the terminal wall grants it exactly the database's own
-- nulling, recognised by exclusion so no fourth column can ride along. T49 and T50 measure the depth-1
-- refusals; T65–T72 and T-RI1/T-RI2 measure the accepting half.
--
-- Three repairs in two replaced bodies, both name-preserving `CREATE OR REPLACE`, so `40_catalog.sql`'s
-- census of 32 wrapper and implementation names, 51 `api`-visible functions and 41 definer bodies does not
-- move, and no grant or revoke has to be re-earned. Nothing in this file adds a table, a column, a policy
-- or a name. `85_support_lifecycle.sql`'s group L measures the release door's refusal, and the T-RI block
-- measures the nulling.

-- ===========================================================================
-- 1. The wall: a closed row takes no write a hand can issue
-- ===========================================================================
-- The terminal test moves above the same-status branch. That reordering is the whole repair: a write that
-- changes nothing but the assignee is still a write to a finished ticket, and the branch that used to
-- wave it through was written for live statuses. The immutable-column refusals stay first, because a hand
-- that rewrites `case_ref` on a closed row is answering a different question and deserves the sentence
-- that names the column.
CREATE OR REPLACE FUNCTION private.guard_support_case_update() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  -- The database's own `ON DELETE SET NULL` action arrives as a nested UPDATE on this row, at trigger
  -- depth 2. A caller's statement and every door in this schema arrive at depth 1. Measured on the built
  -- chain (`q11-logs/s11-depth-probe.sql`, a diagnostic trigger on this table): deleting an account that
  -- filed a case reports depth=2 here, and deleting a wedding reports depth=2 on the audit table's
  -- equivalent path. This is the same signal slice 2's guard used before this file rewrote its body; the
  -- rewrite dropped it, which made every account named by a ticket undeletable and refused the very
  -- `SET NULL` the key declares. Measured by `85_support_lifecycle.sql` T-RI (T65–T72).
  v_referential boolean := pg_trigger_depth() >= 2;
BEGIN
  -- What may never move after the case is opened, and why each of those is a fact rather than a field.
  IF NEW.case_ref IS DISTINCT FROM OLD.case_ref THEN
    RAISE EXCEPTION 'support_cases.case_ref is minted once and quoted forever' USING ERRCODE = '42501';
  END IF;
  IF NEW.wedding_id IS DISTINCT FROM OLD.wedding_id THEN
    RAISE EXCEPTION 'a support case cannot be re-parented onto another wedding: the wedding named on the '
      'ticket is the scope of every act it authorises' USING ERRCODE = '42501';
  END IF;
  IF NEW.requester_user_id IS DISTINCT FROM OLD.requester_user_id
     AND (NEW.requester_user_id IS NOT NULL OR NOT v_referential) THEN
    RAISE EXCEPTION 'a support case cannot change hands: whose ticket it is decides whose read surface it '
      'appears on' USING ERRCODE = '42501';
  END IF;
  -- The provenance link takes the same exception and the provenance *facts* do not: `opened_by_user_id` is
  -- an account that can cease to exist, while the instant and the key are written once and are not derived
  -- from any account. A hand that clears the link at depth 1 still hears the sentence (measured at T50).
  IF NEW.opened_by_user_id IS DISTINCT FROM OLD.opened_by_user_id
     AND (NEW.opened_by_user_id IS NOT NULL OR NOT v_referential) THEN
    RAISE EXCEPTION 'who opened this case and when are the first two facts in its history'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.opened_at IS DISTINCT FROM OLD.opened_at
     OR NEW.open_idempotency_key IS DISTINCT FROM OLD.open_idempotency_key THEN
    RAISE EXCEPTION 'who opened this case and when are the first two facts in its history'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.category IS DISTINCT FROM OLD.category OR NEW.severity IS DISTINCT FROM OLD.severity THEN
    RAISE EXCEPTION 'category and severity are the host''s own claim at the moment of opening and are not '
      'edited afterwards; an operator who disagrees says so in a note, which is a row rather than a '
      'rewrite' USING ERRCODE = '42501';
  END IF;

  -- Terminal, and tested before anything else about the write. Slice 2 put this below the same-status
  -- branch, which made it unreachable for the one column a same-status write is allowed to touch at all,
  -- and so a closed row kept accepting appends: `q11-logs/s11-s2-release-closed-probe2b.txt`.
  --
  -- The one write a finished ticket still takes is the database's own attribution nulling, and it is
  -- recognised by exclusion rather than by naming the columns that may move: everything that is not an
  -- attribution link — `updated_at` included, because `set_updated_at` has already stamped it by the time
  -- this trigger fires — must be identical, and every link that did move must have moved to NULL. Same
  -- shape as the audit trail's guard (`20261020190000…`), so a column a later slice adds is refused by
  -- default instead of needing this body to be remembered. The depth test is what keeps it out of reach
  -- of a caller; T49, T50 and T-RI2f measure the refusing and the accepting halves.
  IF OLD.status = 'closed' THEN
    IF NOT (
         v_referential
         AND (to_jsonb(NEW) - 'requester_user_id' - 'opened_by_user_id' - 'assigned_operator_user_id'
                - 'updated_at')
             IS NOT DISTINCT FROM
             (to_jsonb(OLD) - 'requester_user_id' - 'opened_by_user_id' - 'assigned_operator_user_id'
                - 'updated_at')
         AND (NEW.requester_user_id IS NULL
              OR NEW.requester_user_id IS NOT DISTINCT FROM OLD.requester_user_id)
         AND (NEW.opened_by_user_id IS NULL
              OR NEW.opened_by_user_id IS NOT DISTINCT FROM OLD.opened_by_user_id)
         AND (NEW.assigned_operator_user_id IS NULL
              OR NEW.assigned_operator_user_id IS NOT DISTINCT FROM OLD.assigned_operator_user_id)
       ) THEN
      RAISE EXCEPTION 'a closed support case is terminal' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- A write that moves no status may move no resting evidence either — the same posture the output
  -- registry takes (`20261013120000_stage9_render_outputs.sql`, "a write that changes no status may
  -- change no evidence either"). Only the assignment moves on a live status, and after the block above,
  -- that sentence is finally true: a closed row reaches this branch only through the database's own
  -- status-preserving link nulling, which changed no resolution.
  IF NEW.status = OLD.status THEN
    IF NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
       OR NEW.resolution_code IS DISTINCT FROM OLD.resolution_code THEN
      RAISE EXCEPTION 'a status that did not change may not gain or lose its resolution'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- The edge table, stated as the same six rows §5's table states. Anything not on this list reports
  -- itself as the pair rather than as a state a later reader has to reverse-engineer.
  IF NOT (
       (OLD.status = 'open'                 AND NEW.status IN ('triaged', 'closed'))
    OR (OLD.status = 'triaged'              AND NEW.status IN ('awaiting_information', 'in_progress',
                                                               'closed'))
    OR (OLD.status = 'in_progress'          AND NEW.status IN ('awaiting_information', 'resolved',
                                                               'closed'))
    OR (OLD.status = 'awaiting_information' AND NEW.status IN ('in_progress', 'closed'))
    OR (OLD.status = 'resolved'             AND NEW.status IN ('closed', 'in_progress'))
  ) THEN
    RAISE EXCEPTION 'no edge % → % exists in the support case lifecycle', OLD.status, NEW.status
      USING ERRCODE = 'check_violation',
            HINT = 'open -> triaged -> (awaiting_information | in_progress) -> resolved -> closed, with '
                   'a reopen from resolved and a resume from awaiting_information; closed is terminal';
  END IF;

  -- The two instants belong to the database, and the code belongs to the caller: a resting state whose
  -- evidence arrives as a *rewrite* of the old one would be a ticket that was resolved twice with the
  -- second answer hiding the first.
  IF NEW.status IN ('resolved', 'closed') THEN
    IF NEW.resolution_code IS NULL THEN
      RAISE EXCEPTION 'entering % requires a resolution code: a ticket that ends without saying how it '
        'ended is not evidence', NEW.status USING ERRCODE = 'check_violation';
    END IF;
    NEW.resolved_at := now();
  ELSIF OLD.status IN ('resolved', 'closed') THEN
    -- The only edge that gets here from a resting state is `resolved → in_progress`, the reopen. The
    -- previous resolution does not vanish: it is the `status` event that recorded it, and the audit row
    -- that carried it. Clearing the columns is what makes the row's own state honest about *now*.
    NEW.resolved_at := NULL;
    NEW.resolution_code := NULL;
  ELSE
    NEW.resolved_at := NULL;
    NEW.resolution_code := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_support_case_update()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.guard_support_case_update() IS
  'The state machine as data, and the row-level wall against a hand at the console. Three refusals that '
  'answer three questions: an immutable fact being rewritten (42501), a closed row being written to at all '
  '(terminal, tested before the same-status branch), and an edge that does not exist. One write passes: the '
  'database''s own ON DELETE SET NULL of an attribution link at trigger depth 2, changed by exclusion so '
  'no other column can ride along. Entering a resting state requires a code and stamps `resolved_at`; the '
  'reopen from `resolved` clears both, because the thread and the trail still hold the earlier ending.';

-- ===========================================================================
-- 2. The door: the release says the same sentence as the claim
-- ===========================================================================
-- The pair matters more than the repair. §10's handover is release-then-claim, two acts, each with its own
-- actor; if one of the two refuses a closed ticket and the other does not, the handover is the only way to
-- end a ticket with a live assignee, which is exactly the state a queue screen has to guess about. Placed
-- after the replay block and before the holding rules, matching `operator_claim_case`: a caller who
-- resubmits the key that bought this release is answered with the release they already made, and a caller
-- who is merely late learns that the ticket finished.
CREATE OR REPLACE FUNCTION internal_api.operator_release_case(
  p_case_ref text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_case private.support_cases;
  v_seen private.support_case_events;
  v_seq integer;
  v_audit_id bigint;
  v_action text;
BEGIN
  v_caller := auth.uid();
  IF NOT private.actor_is_operator('support') THEN
    RAISE EXCEPTION 'the caller may not release this support case' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'a release requires an idempotency key: two clicks on one ticket must produce one '
      'release' USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.* INTO v_case FROM private.support_cases c WHERE c.case_ref = btrim(p_case_ref)
    FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the caller may not release this support case' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT e.* INTO v_seen FROM private.support_case_events e
   WHERE e.case_id = v_case.id AND e.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_seen.kind <> 'assignment' THEN
      RAISE EXCEPTION 'this idempotency key already carries a % row on this case: one key is one action',
        v_seen.kind USING ERRCODE = 'check_violation';
    END IF;
    SELECT a.id, a.action INTO v_audit_id, v_action FROM private.audit_events a
     WHERE a.idempotency_key = p_idempotency_key::text;
    IF v_action IS DISTINCT FROM 'case_released' THEN
      RAISE EXCEPTION 'this idempotency key already carries the % act on the trail: one key is one action',
        coalesce(quote_literal(v_action), 'an unknown act') USING ERRCODE = 'check_violation';
    END IF;
    RETURN jsonb_build_object('case_ref', v_case.case_ref,
                              'assigned_operator_user_id', v_case.assigned_operator_user_id,
                              'seq', v_seen.seq, 'audit_id', v_audit_id, 'replayed', true);
  END IF;

  -- The sentence this door owed slice 2, in the claim door's own words so the pair reads as one policy.
  IF v_case.status = 'closed' THEN
    RAISE EXCEPTION 'a closed support case is not rewritten, and releasing it is a rewrite'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_case.assigned_operator_user_id IS NULL THEN
    RAISE EXCEPTION 'nobody holds this case, so there is nothing to release' USING ERRCODE = 'check_violation';
  END IF;
  -- The other half of the handover rule, and the only one that cannot be stated as a state check: clearing
  -- a ticket somebody else claimed is an act upon their work, which is the same escalation the signature
  -- would have carried had it taken a name.
  IF v_case.assigned_operator_user_id <> v_caller THEN
    RAISE EXCEPTION 'this case is held by another operator, and one release may not clear their claim'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE private.support_cases c
     SET assigned_operator_user_id = NULL
   WHERE c.id = v_case.id;

  INSERT INTO private.support_case_events
      (case_id, kind, actor_user_id, actor_kind, idempotency_key, created_at)
    VALUES (v_case.id, 'assignment', v_caller, 'operator', p_idempotency_key, now())
  RETURNING seq INTO v_seq;

  INSERT INTO private.audit_events
      (wedding_id, subject_type, subject_key, action, actor_user_id, actor_kind, reason,
       payload, before_state, after_state, idempotency_key)
    VALUES (v_case.wedding_id, 'support_case', v_case.id, 'case_released', v_caller, 'operator',
            'support case ' || v_case.case_ref || ' released by the operator who held it: the decision, '
              'the actor and both states are recorded here and on the ticket',
            jsonb_build_object('case_ref', v_case.case_ref, 'wedding_id', v_case.wedding_id),
            jsonb_build_object('assigned_operator_user_id', v_case.assigned_operator_user_id),
            jsonb_build_object('assigned_operator_user_id', NULL),
            p_idempotency_key::text)
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object('case_ref', v_case.case_ref,
                            'assigned_operator_user_id', NULL,
                            'seq', v_seq, 'audit_id', v_audit_id, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.operator_release_case(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.operator_release_case(text, uuid) TO authenticated;

COMMENT ON FUNCTION internal_api.operator_release_case(text, uuid) IS
  'Scope `support`. Clears the calling account''s own hold and refuses to clear another operator''s. Like '
  'the claim, the note, the reply and the wall, it refuses a closed case: an ended ticket takes no further '
  'rows, from a host or from the operator who was holding it.';

-- ===========================================================================
-- 3. What this file leaves behind
-- ===========================================================================
-- Two replaced bodies and two refreshed comments. No name is added or removed, so the catalogue census
-- this stage's batteries assert is unchanged; the grants below each name are restated rather than
-- re-derived. The throwaway chain this repair was measured on was rolled back, so nothing durable from
-- the probe is on any chain — the state it described is reproduced inside
-- `85_support_lifecycle.sql`'s group L instead, where a reader can see the assertion that used to fail.
