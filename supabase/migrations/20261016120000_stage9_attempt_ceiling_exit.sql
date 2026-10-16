-- Stage 9 forward repair: the attempt budget is spent at the door, not half-spent in the middle.
--
-- THE DEFECT, AND WHERE IT WAS PROVEN. `invitation_outputs` let a caller open a sixth attempt from a
-- row that had already recorded five failures. The step itself was legal (`failed -> uploading` is a
-- whitelisted edge), and it left the row in a state with no way out. Three statements were each tried
-- against one such row on the local stack and all three were refused, verbatim, in
-- `q9-logs/live/probe-s9-shapes-c-01.txt`:
--
--   * `SET status = 'failed', attempt_count = attempt_count + 1` -> 23514
--     `invitation_outputs_attempt_count_check`, because the domain caps the count at 5 (`:134` of
--     `20261013120000_stage9_render_outputs.sql`) and the guard requires exactly one more than the
--     row had (`:374-377`).
--   * `SET status = 'invalidated'` -> 42501 "no edge registered → uploading → invalidated exists in
--     the output lifecycle", from `private.guard_invitation_output_update()`'s whitelist.
--   * `DELETE` -> 42501 "an output with an upload in flight is not deletable; let it reach ready or
--     failed", from `private.guard_invitation_output_delete()`.
--
-- So the guard's own sentence — "let it reach ready or failed" — named an exit that the CHECK had
-- already closed, and the row could only be removed by first *pretending* it had succeeded: walk it to
-- `ready` with a digest it never earned, then invalidate, then delete. A cleanup that has to forge
-- evidence to reach a deletable state is the failure this stage exists to prevent, because the row it
-- leaves behind says "these bytes were fetched back and hashed" about bytes nobody hashed.
--
-- THE REPAIR. Refuse the doomed retry where it is chosen: a `failed` row at the ceiling may not be
-- sent back to `uploading`. Every state the lifecycle can now reach has a legal exit —
--   registered  -> uploading, or a trusted delete
--   uploading   -> ready, or -> failed with a count the CHECK still admits (≤ 5, because the retry
--                  that produced this row could only have come from a failed row below the ceiling)
--   failed      -> trusted delete (retry while the budget lasts, delete once it does not: the
--                  retirement edge is already refused for a row that never earned bytes, at `:366-369`)
--   ready       -> invalidated
--   invalidated -> trusted delete
--
-- WHY NOT THE OTHER TWO. Raising the CHECK's bound moves the deadlock by one attempt and still needs
-- a closing rule, so it buys a second number to keep in sync for nothing. Adding a `uploading ->
-- invalidated` edge would be the general answer, but it hands anyone with UPDATE the right to retire a
-- row while its upload is genuinely in flight; the worker would then hold a signed URL to an object
-- whose manifest row says `invalidated`, its later `-> ready` would be refused as terminal, and the
-- object would be orphaned — the exact state §12's delete-then-mark ordering exists to avoid, and the
-- one the in-flight delete guard was written to refuse. This repair removes an impossible promise
-- instead of adding a new door.
--
-- THE COUPLING, STATED SO IT IS MEASURABLE. The literal 5 here is the same 5 the CHECK asserts at
-- `20261013120000…:134`. It is not read from the catalog, because a trigger that inspects its own
-- table's constraint text on every write is a slower and stranger way to state one number. Instead
-- `supabase/tests/stage9/80_render_manifest.sql` group E3 pins the CHECK definition and pushes a row
-- to the ceiling the only legal way, so the drift between the two literals fails as an assertion
-- rather than as a stranded row. The publisher already refused this retry on its own side
-- (`scripts/stage9-publish-core.mjs`, `retry-ceiling-reached`); that rule is unchanged and is now
-- advice rather than the only thing standing between a wedged queue and an undeletable row.
--
-- No data is rewritten here, because no such row may exist: the local stack measured
-- `uploading_at_ceiling=0` before this file was applied, and a chain built from `supabase/migrations`
-- never had the edge that could create one.

CREATE OR REPLACE FUNCTION private.guard_invitation_output_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  -- Everything that describes *what this artefact is* is immovable once registered. Re-parenting a
  -- row to another version would leave a rendered file claiming to be a document it was never drawn
  -- from, and the digest recorded against it would be true of the wrong bytes — a lie that every
  -- downstream determinism check would then inherit.
  IF NEW.wedding_id IS DISTINCT FROM OLD.wedding_id THEN
    RAISE EXCEPTION 'an invitation output cannot be re-parented to another wedding' USING ERRCODE = '42501';
  END IF;
  IF NEW.version_id IS DISTINCT FROM OLD.version_id THEN
    RAISE EXCEPTION 'an invitation output is bound to the version it was rendered from' USING ERRCODE = '42501';
  END IF;
  IF NEW.output_kind IS DISTINCT FROM OLD.output_kind
     OR NEW.variant IS DISTINCT FROM OLD.variant
     OR NEW.format IS DISTINCT FROM OLD.format
     OR NEW.page_number IS DISTINCT FROM OLD.page_number THEN
    RAISE EXCEPTION 'the kind, geometry, format and page are part of the uniqueness key' USING ERRCODE = '42501';
  END IF;
  IF NEW.render_config_hash IS DISTINCT FROM OLD.render_config_hash THEN
    RAISE EXCEPTION 'render_config_hash is the key half that makes a stale artefact detectable' USING ERRCODE = '42501';
  END IF;
  IF NEW.source_dto_digest IS DISTINCT FROM OLD.source_dto_digest THEN
    RAISE EXCEPTION 'source_dto_digest records what was rendered and cannot be rewritten' USING ERRCODE = '42501';
  END IF;
  IF NEW.target_url_digest IS DISTINCT FROM OLD.target_url_digest THEN
    RAISE EXCEPTION 'target_url_digest records what a QR pointed at and cannot be rewritten' USING ERRCODE = '42501';
  END IF;
  IF NEW.object_key IS DISTINCT FROM OLD.object_key THEN
    RAISE EXCEPTION 'invitation_outputs.object_key is immutable once minted' USING ERRCODE = '42501';
  END IF;
  IF NEW.storage_domain IS DISTINCT FROM OLD.storage_domain THEN
    RAISE EXCEPTION 'an artefact cannot be moved between the private and published storage domains' USING ERRCODE = '42501';
  END IF;

  -- A write that moves no state may move no evidence either. Without this, a `ready` row whose
  -- digest was earned by a verified fetch could be re-described afterwards — the same failure Stage 6
  -- closes for `mime_type` and `size_bytes` at `20261006120000…:112-122`, and here it would be a
  -- determinism claim rather than a description.
  IF NEW.status = OLD.status THEN
    IF NEW.content_digest IS DISTINCT FROM OLD.content_digest
       OR NEW.ready_at IS DISTINCT FROM OLD.ready_at
       OR NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at
       OR NEW.invalidation_reason IS DISTINCT FROM OLD.invalidation_reason
       OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
       OR NEW.last_error IS DISTINCT FROM OLD.last_error THEN
      RAISE EXCEPTION 'a write that changes no status may change no evidence either' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'invalidated' THEN
    RAISE EXCEPTION 'an invalidated invitation output is terminal' USING ERRCODE = '42501';
  END IF;
  -- `ready` may only be retired, never re-opened and never sent back to a state that claims no bytes.
  IF OLD.status = 'ready' AND NEW.status <> 'invalidated' THEN
    RAISE EXCEPTION 'a ready invitation output may only be invalidated' USING ERRCODE = '42501';
  END IF;
  -- The remaining forward edges, each named, so an edge nobody designed reports itself as the
  -- sentence below rather than as a state a later reader has to reverse-engineer.
  IF NOT (
       (OLD.status = 'registered' AND NEW.status = 'uploading')
    OR (OLD.status = 'uploading' AND NEW.status IN ('ready', 'failed'))
    OR (OLD.status = 'failed'    AND NEW.status IN ('uploading', 'invalidated'))
    OR (OLD.status = 'ready'     AND NEW.status = 'invalidated')
  ) THEN
    RAISE EXCEPTION 'no edge registered → % → % exists in the output lifecycle', OLD.status, NEW.status
      USING ERRCODE = '42501',
            HINT = 'registered -> uploading -> ready | uploading -> failed -> (retry | invalidate) | ready -> invalidated';
  END IF;

  -- The attempt ceiling, on the one edge that could reach it. `uploading` is the only state in this
  -- lifecycle with no delete and no retirement underneath it, so a row may not be put there once its
  -- next failure can no longer be recorded: `uploading -> failed` is defined as exactly one more
  -- attempt, and the domain admits no sixth. The row that is refused here stays exactly where it was —
  -- `failed`, count 5, reason kept — and is cleared by a trusted delete, which its own state admits.
  IF OLD.status = 'failed' AND NEW.status = 'uploading' AND OLD.attempt_count >= 5 THEN
    RAISE EXCEPTION 'the attempt budget is spent: a failed output at attempt_count % may not be retried',
      OLD.attempt_count
      USING ERRCODE = '42501',
            HINT = 'delete the failed row with a trusted delete, or register the artefact again as a new row';
  END IF;

  -- The two instants belong to the database. A worker that supplied its own clock could make a
  -- superseded artefact look newer than the row that replaced it, which is the one comparison §13
  -- depends on. Same posture as `private.touch_updated_at()`.
  IF NEW.status = 'ready' THEN
    NEW.ready_at := now();
    IF NEW.content_digest IS NULL THEN
      RAISE EXCEPTION 'a row may not become ready without the digest of the bytes it produced'
        USING ERRCODE = '42501', HINT = 'Fetch the object back and hash it first.';
    END IF;
  ELSIF NEW.status = 'invalidated' THEN
    NEW.invalidated_at := now();
    -- Retiring a row that never became ready is not an invalidation, it is the absence of an artefact,
    -- and `invitation_outputs_ready_evidence` above already refuses the pair. `failed` is where such a
    -- row stays, as visible retry evidence; a trusted cleanup removes it outright.
    IF OLD.status = 'failed' AND OLD.content_digest IS NULL THEN
      RAISE EXCEPTION 'a failed output with no stored bytes is removed rather than invalidated'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A retry may not silently reset the evidence of the attempt before it, and entering `failed` is
  -- exactly one recorded attempt plus one named reason.
  IF NEW.status = 'failed' THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1 THEN
      RAISE EXCEPTION 'entering failed records exactly one attempt' USING ERRCODE = '42501';
    END IF;
    IF NEW.last_error IS NULL THEN
      RAISE EXCEPTION 'a failure must name its reason' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.attempt_count IS DISTINCT FROM OLD.attempt_count THEN
    RAISE EXCEPTION 'attempt_count moves only when a failure is recorded' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- Re-issued from `20261013120000…:389` so the forward definition keeps the ACL the catalogue census
-- reads: a trigger body that became callable by a client role would be a second write path on the row.
REVOKE ALL ON FUNCTION private.guard_invitation_output_update() FROM PUBLIC, anon, authenticated;
