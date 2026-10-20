-- stage10: put every change to the commerce policy on the record that describes money decisions.
--
-- §14's finding on `private.commerce_policy` was measured on a throwaway chain that had run nothing else
-- (`q10-logs/s10r-policy-probe-5.txt`). Three arms, one conclusion:
--
--   A6c/A6d — an UPDATE by the owner role that set `live_capture_enabled` to true, moved
--             `refund_revocation_mode` to `revoke` and named a package in
--             `publish_required_package_codes` produced **zero** rows in `private.audit_events`.
--   A6f     — the catalog holds no history relation for the singleton: not a table, not a view, nothing
--             the row's own values used to live in.
--   A7      — of the four function bodies that read or write the policy (`commerce_reconcile`,
--             `record_commerce_event`, `grant_commerce_entitlement`, `revoke_commerce_entitlement`), the
--             two that write `audit_events` at all never write a row about a policy change.
--
-- So the three answers this stage sells — publishing is not gated on money, live capture is off, a refund
-- waits for a human — could each be flipped by the owner's own role and leave the database looking exactly
-- as it did before the decision was taken. That is not a privacy defect and it does not move a rupee, but it
-- destroys the only evidence a later reviewer has: the row says `false`, and nothing anywhere says it ever
-- said `true`. A financial posture that can change silently is a posture nobody can audit, which is the
-- property §10's whole append-only ledger exists to provide for the rows *below* it.
--
-- Why a trigger, and not a body. There is no product operation that changes the policy — the standing
-- decision is that the owner has not made these decisions yet, so the only way the row changes is a
-- trusted role issuing a statement directly. A wrapper function cannot be the audit point, because the
-- statement that needs auditing does not go through one. The row is the only place that sees every way of
-- moving it, so the row is where the record gets written.
--
-- Why INSERT and DELETE as well as UPDATE. Battery 2's group G deletes the singleton, proves that the
-- publish gate then reads its absence as permissive (G18/G19), and inserts it again (G20). Both arms are
-- accepted, and both are decisions: removing the row is a decision to stop gating, restoring it is a
-- decision to put the shipped defaults back. A trail covering UPDATE alone would record neither, and the
-- residue would look like a database that had never been touched — the exact failure mode this migration
-- exists to close, arriving through a door the first draft of the repair would have left open.
--
-- What the record deliberately does not claim.
--   * It claims no `actor_user_id` and no `wedding_id`. The singleton belongs to no household, and a
--     statement issued over `psql` has no account behind it; inventing either would be the trail asserting
--     a fact the database does not know. `actor_role` comes from the column's own
--     `current_user::text` default, not from a parameter a caller could name.
--   * It does not fire for a write that moved nothing. `SET x = x`, and any UPDATE that leaves all four
--     decision columns as it found them, is a write and not a change; counting those would make the trail
--     measure traffic instead of decisions, and `updated_at` moving under `set_updated_at` would leave a
--     "change" of every column on every no-op.
--   * It says nothing about *why*. There is no note column on the statement and none is invented here; the
--     remedy for a decision the owner wants explained is the commit that changed it, which this database
--     has never had access to.
--
-- The limitation this file cannot close, stated rather than hidden.
--   1. The trail begins when this migration runs. The shipped row was inserted by
--      `20261017120000_stage10_commerce_foundations.sql:457`, which installs before it, so the row's own
--      creation is the one change to the money posture that is not on record. Battery 1's F16 pins that
--      emptiness at the top of its run, so every row the trail group reads afterwards is a row the run made.
--   2. A role that can change the policy can also delete the record of having changed it: `audit_events`
--     guards UPDATE and DELETE with `private.reject_client_delete`, whose trusted branch admits `postgres`
--     and members of `service_role`/`supabase_admin`. That is the already-documented weakness of an
--     append-only table owned by the role that writes it, and this file narrows it — a policy change now
--     leaves evidence — without closing it. Closing it needs a second identity or storage this stage does
--     not have.
--   3. Because the INSERT runs with the caller's own rights (`SECURITY INVOKER`, `search_path = ''`, no
--     grant of anything), the trail is fail-closed rather than fail-open in one specific sense worth
--     naming: a role that cannot write `private.audit_events` cannot complete a policy change either,
--     because the trigger's INSERT raises and the statement with it. The direction of that consequence is
--     deliberate — a posture nobody can record is a posture nobody gets to take. It is a property of the
--     shape, not a measured arm: on this cluster the only role that can change the policy is the owner of
--     both tables, so no reachable role is in the position this would catch, and no cell in either battery
--     drives one. §2's C31 and battery 2's T3 prove the wiring — that this function is attached to this
--     table and to nothing else — which is the half that is measured here.
--
-- Shape of the change: one new function in `private`, one new trigger on `private.commerce_policy`. No new
-- table, column, index, grant or exposed name, so the declared-surface census is unchanged at 22 `api`
-- names and 39 `internal_api` names. Four inventories do move, and all four are tripwires that are supposed
-- to move when a guard is added: §2's `40_catalog.sql` C31 trigger list gains this line, battery 2's
-- `s10tguard` gains the pair for this table and its group G gains `G17b`/`G20b` for the deletion and restore
-- halves, battery 1's action census Z15 gains `policy_changed`, and Stage 4's `50_pack_release.sql` counts
-- this as the thirty-seventh `private` body — `I4` goes 97 → 98, `I8`'s fixture-marker scan and `I10b`'s
-- residue census with it. Each was widened in the same pass as this file, from the run that failed on it,
-- not predicted. Forward-only: a later head may have read a trail row that an in-place edit would change the
-- meaning of.

CREATE FUNCTION private.audit_commerce_policy_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  -- The decision four, spelled out rather than read off the row, so that adding a fifth column to the
  -- policy cannot silently join the trail — and cannot silently stay out of it either: this list is what
  -- §2's C31 and battery 1's W12 assert against. `created_at` and `updated_at` are deliberately absent;
  -- they are bookkeeping, and a trail of timestamps is not a trail of decisions.
  v_names constant text[] := ARRAY['live_capture_enabled', 'publish_gate',
                                   'publish_required_package_codes', 'refund_revocation_mode'];
  v_old     jsonb;
  v_new     jsonb;
  v_changed jsonb;
  v_action  text;
  v_pid     integer;
BEGIN
  v_old := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  v_new := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;

  SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb) INTO v_changed
    FROM unnest(v_names) AS k
   WHERE (v_old ? k) <> (v_new ? k)
      OR (v_old -> k) IS DISTINCT FROM (v_new -> k);

  IF v_changed = '[]'::jsonb THEN
    RETURN NULL;
  END IF;

  v_action := CASE TG_OP WHEN 'INSERT' THEN 'policy_created'
                         WHEN 'DELETE' THEN 'policy_deleted'
                         ELSE 'policy_changed' END;
  -- The branch not taken is never evaluated, which is the only reason this reads safely in a DELETE
  -- trigger, where `NEW` carries no row.
  v_pid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;

  INSERT INTO private.audit_events (wedding_id, subject_type, subject_key, action, actor_user_id, payload)
    VALUES (
      NULL,
      'commerce_policy',
      NULL,
      v_action,
      NULL,
      jsonb_build_object(
        'policy_id', v_pid,
        'changed',   v_changed,
        -- Both halves carry only the columns named in `changed`, so `before` and `after` can never
        -- disagree with the list a reader is scanning, and a three-knob statement is one record naming
        -- three columns rather than three records each claiming to be the whole change.
        'before',    COALESCE((SELECT jsonb_object_agg(k, v_old -> k)
                                 FROM jsonb_array_elements_text(v_changed) k
                                WHERE v_old ? k), '{}'::jsonb),
        'after',     COALESCE((SELECT jsonb_object_agg(k, v_new -> k)
                                 FROM jsonb_array_elements_text(v_changed) k
                                WHERE v_new ? k), '{}'::jsonb)
      )
    );

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.audit_commerce_policy_change()
  FROM PUBLIC, anon, authenticated, service_role;

-- AFTER, so that a refusal from `commerce_policy_no_client_write` or `commerce_policy_no_client_delete`
-- above it can never be recorded as a change: the row did not move, and a trail that writes a record for a
-- refused attempt would tell an operator that a decision was taken by somebody who was turned away.
CREATE TRIGGER commerce_policy_change_trail
  AFTER INSERT OR UPDATE OR DELETE ON private.commerce_policy
  FOR EACH ROW EXECUTE FUNCTION private.audit_commerce_policy_change();

COMMENT ON FUNCTION private.audit_commerce_policy_change() IS
  'AFTER INSERT/UPDATE/DELETE guard: writes one `commerce_policy` row to `private.audit_events` naming the '
  'decision columns that moved, with both halves, or nothing at all when none did. SECURITY INVOKER, so it '
  'records with the caller''s own rights and can neither be reached by a client role nor add privilege to one.';
