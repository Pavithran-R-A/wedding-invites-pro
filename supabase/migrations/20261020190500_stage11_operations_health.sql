-- ===========================================================================
-- Stage 11, slice 5 — operational health: a projection that reports only what it can reach
--
-- §9's one door. `api.operator_operations_summary(p_window_hours integer)` delegates to an STABLE
-- `internal_api` definer that reads ten blocks over eleven of this schema's stores plus one the migration
-- tool owns, and returns counts and timestamps. It writes
-- nothing, cannot write anything (STABLE), and names in its own answer the three things it was asked
-- about that this schema has no store for. Eight decisions were taken while reading the substrate, and
-- each is recorded here because this is the stage's only read-side projection and a later console
-- inherits its shape.
--
--   1. **No identifier of any kind crosses this projection.** Every other Stage 11 door returns rows a
--      named human is entitled to read — a case's messages, a refund's notes, a publication's object
--      keys. This one is cluster-wide: an operator with `operations` scope sees *every* wedding's
--      counts, because "is the system healthy" cannot be answered per-tenant. The privacy boundary that
--      makes that safe is the field list, not a filter: no `wedding_id`, no `case_ref`, no
--      `request_ref`, no `object_key`, no `user_id`, no `note` and no `reason` text appears anywhere in
--      the answer, and the two free-text columns this screen could have surfaced — `commerce_payment_events.hold_reason`
--      and `audit_events.action` — appear only as *grouped counts* over a closed vocabulary. The
--      battery asserts the absence by planting values that would be visible if the projection leaked a
--      row, then scanning the answer text for them.
--
--   2. **One body, no helper functions.** A second `private` function per block would make this slice
--      movable in four catalogue counts for no reachability benefit — the blocks are not reusable by
--      any other caller, and every one of them is unreadable outside this body anyway. So `private`
--      stays at 52 names at this head while `api` and `internal_api` each gain one, and the whole
--      projection is one plpgsql body whose statements are ordered so that each block reads its own
--      store once.
--
--   3. **The `migrations` block is presence-gated, and its measured branch reads one column.** The
--      design's source is `supabase_migrations.schema_migrations`, which is a tool-owned schema: it
--      exists on a Supabase-managed database and does not exist on the plain PostgreSQL chains this
--      stage is qualified on (§16). Rather than claim a number from a store that is not there, the body
--      asks `to_regclass` and answers `not_measured` with the reason when it is absent — which is the
--      same sentence shape as the three deliberate absences, and is what makes them all one mechanism
--      rather than three hand-written strings. When the table *is* present, the branch reads
--      `count(*)` and `max(version)` and nothing else: `version` is the only column this
--      projection has a right to depend on. A `created_at` field is *not* read,
--      because inventing a timestamp for the newest migration is exactly the decoration §9 refuses. The
--      battery exercises both branches by installing a fixture at that name — a `version` primary
--      key plus the three columns a migration history plausibly carries and this projection must
--      not read — reading the counted block, dropping the fixture, and re-reading `not_measured`, so
--      neither branch is a claim about code that never ran. What the fixture cannot settle is the
--      real tool's own column set: no `supabase_migrations` schema exists on either qualified chain,
--      so §16 proves the branch's read set out of `pg_proc.prosrc` and the report records the CLI's
--      shape as unproven.
--
--   4. **The window is bounded, and its default is a decision.** NULL means 24 hours; 1 to 720 (thirty
--      days) is accepted; anything else is refused `check_violation` with the bound in the sentence —
--      slice 4's review queue states the same shape for `p_limit`, for the same reason: this is an
--      operator's screen, and an unbounded window is a way to make the database count its whole
--      history on every page load. `now()` is captured once into `v_as_of` and every block stamps that
--      same value, so the ten blocks cannot describe ten different instants and the answer's own
--      `as_of` is the instant they do describe.
--
--   5. **The credential classification is exhaustive by construction.** `revoked` is `revoked_at IS NOT
--      NULL`; `expired` is a live row whose `expires_at` has passed; `live` is what is left. The three
--      counts sum to `total` for every kind, which the battery checks as an arithmetic identity rather
--      than as three numbers that happen to look plausible — a `last_used_at`-based class would not have
--      closed the partition, and `never_used` / `used_in_window` are therefore reported as overlapping
--      observations, labelled as such in the field names.
--
--   6. **The attempt ceiling is read back from the schema, not paraphrased.** The delivery block counts
--      `failed` rows at `attempt_count = 5`, the same five that `20261013120000_stage9_render_outputs.sql:134`
--      caps the column at and `20261016120000_stage9_attempt_ceiling_exit.sql:133` refuses a retry past.
--      A literal here could rot against those two files, so the battery compares the literal against the
--      CHECK constraint's own definition from `pg_get_constraintdef` — moving the ceiling without moving
--      this projection then fails a cell instead of quietly reporting a healthy queue.
--
--   7. **An operator row's case link is matched by text, never by casting the audit column.**
--      `audit_events.idempotency_key` is `text` bounded only by `audit_events_idempotency_key_is_bounded_check`
--      (non-blank, at most 200 characters) and nullable, because slice 1 added it after Stage 10 had
--      already written trail rows; `support_case_events.idempotency_key` is a `uuid`. So the join is the
--      widening direction, `e.idempotency_key::text = a.idempotency_key`. Casting the other way would make
--      a key that is legal for `audit_events` but not a uuid — which its own CHECK permits — raise `22P02`
--      inside a read-only health screen. Such a row is simply unlinked, which is the honest reading of it
--      and is what the count reports; the battery plants one to prove the screen still answers.
--
--   8. **`blocks_not_measured` is derived from the blocks, not written beside them.** The top-level list
--      is built by reading each block's own `status` field, so an answer cannot say "three absences"
--      while carrying a fourth `not_measured` block, or a `measured` block whose figures are all zero
--      and therefore indistinguishable from an absence. The battery asserts the vocabulary too: every
--      block has a `status` of exactly `measured` or `not_measured`, and every `measured` block carries
--      the `as_of` it was stamped with.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. The projection (§9)
-- ===========================================================================

CREATE FUNCTION internal_api.operator_operations_summary(p_window_hours integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = ''
AS $$
DECLARE
  v_as_of     timestamptz := now();
  v_from      timestamptz;
  v_window    integer;
  v_blocks    jsonb := '{}'::jsonb;
  v_migrations jsonb;
  v_obj       jsonb;
  v_sub       jsonb;
BEGIN
  IF NOT private.actor_is_operator('operations') THEN
    RAISE EXCEPTION 'the caller may not read the operations summary'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_window_hours IS NULL THEN
    v_window := 24;
  ELSIF p_window_hours < 1 OR p_window_hours > 720 THEN
    RAISE EXCEPTION 'an operations window is between 1 and 720 hours, not %', p_window_hours
      USING ERRCODE = 'check_violation';
  ELSE
    v_window := p_window_hours;
  END IF;
  v_from := v_as_of - make_interval(hours => v_window);

  -- ---- migrations: the only block whose store belongs to a tool rather than to this schema.
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    v_migrations := jsonb_build_object(
      'status', 'not_measured',
      'as_of', v_as_of,
      'reason', 'no supabase_migrations.schema_migrations table exists in this database',
      'note', 'the applied-versus-on-disk comparison is the trusted CLI''s job, because a file listing '
              || 'is not a database fact');
  ELSE
    SELECT jsonb_build_object('status', 'measured', 'as_of', v_as_of,
                              'applied_count', count(*),
                              'highest_version', max(version))
      INTO v_migrations
      FROM supabase_migrations.schema_migrations;
  END IF;
  v_blocks := v_blocks || jsonb_build_object('migrations', v_migrations);

  -- ---- publication: §2's own vocabulary, `active` and `revoked`, counted both ways.
  SELECT jsonb_build_object(
           'status', 'measured', 'as_of', v_as_of, 'window_hours', v_window,
           'newest_at', max(p.updated_at),
           'total', count(*),
           'active_total', count(*) FILTER (WHERE p.status = 'active'),
           'revoked_total', count(*) FILTER (WHERE p.status = 'revoked'),
           'weddings_with_active_publication',
             count(DISTINCT p.wedding_id) FILTER (WHERE p.status = 'active'),
           'published_in_window', count(*) FILTER (WHERE p.published_at >= v_from),
           'revoked_in_window', count(*) FILTER (WHERE p.revoked_at IS NOT NULL
                                                   AND p.revoked_at >= v_from))
    INTO v_obj FROM public.publications p;
  v_blocks := v_blocks || jsonb_build_object('publication', v_obj);

  -- ---- credentials: the live/revoked/expired partition (§9's "which link did I send and when did it
  --      stop working"), plus the usage observations. `never_used` and `used_in_window` deliberately
  --      overlap the partition rather than forming a fourth class of it.
  SELECT jsonb_build_object(
           'status', 'measured', 'as_of', v_as_of, 'window_hours', v_window,
           'newest_at', max(t.created_at),
           'total', count(*),
           'live', count(*) FILTER (WHERE t.revoked_at IS NULL
                                     AND (t.expires_at IS NULL OR t.expires_at >= v_as_of)),
           'expired', count(*) FILTER (WHERE t.revoked_at IS NULL
                                        AND t.expires_at IS NOT NULL
                                        AND t.expires_at < v_as_of),
           'revoked', count(*) FILTER (WHERE t.revoked_at IS NOT NULL),
           'never_used', count(*) FILTER (WHERE t.last_used_at IS NULL),
           'used_in_window', count(*) FILTER (WHERE t.last_used_at >= v_from),
           'last_used_at', max(t.last_used_at),
           'live_by_kind', NULL)
    INTO v_obj FROM private.access_tokens t;
  SELECT coalesce(jsonb_object_agg(k.token_kind, k.live_count ORDER BY k.token_kind), '{}'::jsonb)
    INTO v_sub
    FROM (SELECT t.token_kind,
                 count(*) FILTER (WHERE t.revoked_at IS NULL
                                   AND (t.expires_at IS NULL OR t.expires_at >= v_as_of)) AS live_count
            FROM private.access_tokens t
           GROUP BY t.token_kind) k;
  v_obj := jsonb_set(v_obj, '{live_by_kind}', v_sub);
  v_blocks := v_blocks || jsonb_build_object('credentials', v_obj);

  -- ---- delivery: the five lifecycle states, and the stuck one Stage 9's repair made visible.
  --      `failed_at_attempt_ceiling` is the count the ceiling was invented to produce: a `failed` row
  --      at five attempts can no longer be retried by the publisher, so it is a queue, not a blip.
  SELECT jsonb_build_object(
           'status', 'measured', 'as_of', v_as_of, 'window_hours', v_window,
           'newest_at', max(o.updated_at),
           'total', count(*),
           'registered', count(*) FILTER (WHERE o.status = 'registered'),
           'uploading', count(*) FILTER (WHERE o.status = 'uploading'),
           'ready', count(*) FILTER (WHERE o.status = 'ready'),
           'failed', count(*) FILTER (WHERE o.status = 'failed'),
           'invalidated', count(*) FILTER (WHERE o.status = 'invalidated'),
           'failed_at_attempt_ceiling', count(*) FILTER (WHERE o.status = 'failed'
                                                           AND o.attempt_count >= 5),
           'invalidated_by_publication_revoked',
             count(*) FILTER (WHERE o.invalidation_reason = 'publication_revoked'))
    INTO v_obj FROM public.invitation_outputs o;
  v_blocks := v_blocks || jsonb_build_object('delivery', v_obj);

  -- ---- commerce: the reconciliation arm Stage 10 measured and nobody could see (§9's own complaint).
  --      `held_by_reason` groups over the free-text `hold_reason` column: the count carries the reason
  --      string a Stage 10 body wrote, so this is the one place a stored sentence reaches the answer.
  --      It is not a host's sentence and not a credential — it is a reconciliation category minted by
  --      `record_commerce_event` — and §9 asks for it by name ("held_for_reconciliation rows by
  --      reason"). A caller that treats it as prose rather than as a key would be misreading it.
  SELECT jsonb_build_object(
           'status', 'measured', 'as_of', v_as_of, 'window_hours', v_window,
           'newest_at', max(e.received_at),
           'events_total', count(*),
           'applied', count(*) FILTER (WHERE e.processing_status = 'applied'),
           'duplicate', count(*) FILTER (WHERE e.processing_status = 'duplicate'),
           'rejected_signature', count(*) FILTER (WHERE e.processing_status = 'rejected_signature'),
           'held_for_reconciliation',
             count(*) FILTER (WHERE e.processing_status = 'held_for_reconciliation'),
           'stale', count(*) FILTER (WHERE e.processing_status = 'stale'),
           'events_in_window', count(*) FILTER (WHERE e.received_at >= v_from),
           'held_by_reason', NULL)
    INTO v_obj FROM private.commerce_payment_events e;
  SELECT coalesce(jsonb_object_agg(h.hold_reason, h.n ORDER BY h.hold_reason), '{}'::jsonb)
    INTO v_sub
    FROM (SELECT e.hold_reason, count(*) AS n
            FROM private.commerce_payment_events e
           WHERE e.processing_status = 'held_for_reconciliation'
           GROUP BY e.hold_reason) h;
  v_obj := jsonb_set(v_obj, '{held_by_reason}', v_sub);

  SELECT jsonb_build_object(
           'total', count(*),
           'open', count(*) FILTER (WHERE o.status = 'open'),
           'payment_pending', count(*) FILTER (WHERE o.status = 'payment_pending'),
           'captured', count(*) FILTER (WHERE o.status = 'captured'),
           'cancelled', count(*) FILTER (WHERE o.status = 'cancelled'),
           'expired', count(*) FILTER (WHERE o.status = 'expired'),
           'newest_at', max(o.updated_at))
    INTO v_sub FROM private.commerce_orders o;
  v_obj := v_obj || jsonb_build_object('orders', v_sub);

  SELECT jsonb_build_object(
           'total', count(*),
           'recorded', count(*) FILTER (WHERE r.status = 'recorded'),
           'succeeded', count(*) FILTER (WHERE r.status = 'succeeded'),
           'failed', count(*) FILTER (WHERE r.status = 'failed'),
           'reversed', count(*) FILTER (WHERE r.status = 'reversed'),
           'without_review_note', count(*) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM private.commerce_review_notes n WHERE n.refund_id = r.id)),
           'newest_at', max(r.recorded_at))
    INTO v_sub FROM private.commerce_refunds r;
  v_obj := v_obj || jsonb_build_object('refunds', v_sub);
  v_blocks := v_blocks || jsonb_build_object('commerce', v_obj);

  -- ---- audit: who acted, in what family of action, and which operator acts carry no case.
  --      `actor_kind` is NOT NULL with a four-value CHECK, so this groups over the column itself rather
  --      than inventing a fifth bucket for a state the table cannot hold.
  SELECT jsonb_build_object(
           'status', 'measured', 'as_of', v_as_of, 'window_hours', v_window,
           'newest_at', max(a.created_at),
           'total', count(*),
           'rows_in_window', count(*) FILTER (WHERE a.created_at >= v_from),
           'with_reason', count(*) FILTER (WHERE a.reason IS NOT NULL),
           'by_actor_kind', NULL, 'by_action_prefix', NULL)
    INTO v_obj FROM private.audit_events a;
  SELECT coalesce(jsonb_object_agg(k.actor_kind, k.n ORDER BY k.actor_kind), '{}'::jsonb)
    INTO v_sub FROM (SELECT a.actor_kind, count(*) AS n
                       FROM private.audit_events a GROUP BY a.actor_kind) k;
  v_obj := jsonb_set(v_obj, '{by_actor_kind}', v_sub);
  SELECT coalesce(jsonb_object_agg(k.prefix, k.n ORDER BY k.prefix), '{}'::jsonb)
    INTO v_sub FROM (SELECT split_part(a.action, '_', 1) AS prefix, count(*) AS n
                       FROM private.audit_events a GROUP BY 1) k;
  v_obj := jsonb_set(v_obj, '{by_action_prefix}', v_sub);
  SELECT jsonb_build_object('count', count(*))
    INTO v_sub
    FROM private.audit_events a
   WHERE a.actor_kind = 'operator'
     AND NOT EXISTS (SELECT 1 FROM private.support_case_events e
                      WHERE e.idempotency_key::text = a.idempotency_key);
  v_obj := v_obj || jsonb_build_object('operator_rows_without_case_link', v_sub);
  v_blocks := v_blocks || jsonb_build_object('audit', v_obj);

  -- ---- queue: the two tables this stage owns, aged by the caller's window.
  SELECT jsonb_build_object(
           'open', count(*) FILTER (WHERE c.status = 'open'),
           'triaged', count(*) FILTER (WHERE c.status = 'triaged'),
           'in_progress', count(*) FILTER (WHERE c.status = 'in_progress'),
           'awaiting_information', count(*) FILTER (WHERE c.status = 'awaiting_information'),
           'resolved', count(*) FILTER (WHERE c.status = 'resolved'),
           'closed', count(*) FILTER (WHERE c.status = 'closed'),
           'live_total', count(*) FILTER (WHERE c.status IN ('open', 'triaged',
                                                             'in_progress', 'awaiting_information')),
           'unclaimed_live', count(*) FILTER (WHERE c.status IN ('open', 'triaged',
                                                                 'in_progress', 'awaiting_information')
                                               AND c.assigned_operator_user_id IS NULL),
           'aged_outside_window', count(*) FILTER (WHERE c.status IN ('open', 'triaged',
                                                                      'in_progress', 'awaiting_information')
                                                    AND c.opened_at < v_from),
           'resolved_in_window', count(*) FILTER (WHERE c.status IN ('resolved', 'closed')
                                                   AND c.resolved_at >= v_from),
           'newest_at', max(c.updated_at), 'total', count(*))
    INTO v_sub FROM private.support_cases c;
  v_obj := jsonb_build_object('status', 'measured', 'as_of', v_as_of, 'window_hours', v_window,
                              'cases', v_sub);
  SELECT jsonb_build_object(
           'received', count(*) FILTER (WHERE r.status = 'received'),
           'identity_verification_requested',
             count(*) FILTER (WHERE r.status = 'identity_verification_requested'),
           'queued_for_stage13', count(*) FILTER (WHERE r.status = 'queued_for_stage13'),
           'satisfied_outside_this_build',
             count(*) FILTER (WHERE r.status = 'satisfied_outside_this_build'),
           'declined', count(*) FILTER (WHERE r.status = 'declined'),
           'unresolved_total', count(*) FILTER (WHERE r.status IN ('received',
                 'identity_verification_requested', 'queued_for_stage13')),
           'unresolved_outside_window', count(*) FILTER (WHERE r.status IN ('received',
                 'identity_verification_requested', 'queued_for_stage13')
                 AND r.requested_at < v_from),
           'newest_at', max(r.updated_at), 'total', count(*))
    INTO v_sub FROM private.privacy_requests r;
  v_obj := v_obj || jsonb_build_object('privacy_requests', v_sub);
  v_blocks := v_blocks || jsonb_build_object('queue', v_obj);

  -- ---- the three named absences. Not a stub: §2 measured that no such store exists anywhere in
  --      `supabase/migrations/`, and there is no application server, Realtime or Edge function to have
  --      logged into. A tile here would be the Stage 0 defect with a number on it.
  v_blocks := v_blocks || jsonb_build_object(
    'auth_failures', jsonb_build_object('status', 'not_measured', 'as_of', v_as_of,
      'reason', 'no such store exists in this schema'),
    'rate_limits', jsonb_build_object('status', 'not_measured', 'as_of', v_as_of,
      'reason', 'no such store exists in this schema'),
    'token_abuse', jsonb_build_object('status', 'not_measured', 'as_of', v_as_of,
      'reason', 'no such store exists in this schema'));

  -- Derived from the blocks themselves so the summary line cannot disagree with them.
  SELECT coalesce(jsonb_agg(x.k ORDER BY x.k), '[]'::jsonb)
    INTO v_sub
    FROM (SELECT key AS k FROM jsonb_each(v_blocks)
          WHERE (value ->> 'status') = 'not_measured') x;

  RETURN jsonb_build_object(
    'as_of', v_as_of,
    'from_inclusive', v_from,
    'window_hours', v_window,
    'blocks', v_blocks,
    'block_count', (SELECT count(*) FROM jsonb_each(v_blocks)),
    'blocks_not_measured', v_sub,
    'writes_anything', false,
    'identifiers_included', false);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.operator_operations_summary(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.operator_operations_summary(integer) TO authenticated;

CREATE FUNCTION api.operator_operations_summary(p_window_hours integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.operator_operations_summary(p_window_hours);
$$;

REVOKE ALL ON FUNCTION api.operator_operations_summary(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.operator_operations_summary(integer) TO authenticated;

COMMENT ON FUNCTION internal_api.operator_operations_summary(integer) IS
  'Scope `operations`. STABLE definer, ten blocks, no write and no possibility of one. Every block '
  'carries `status: measured|not_measured`, its own newest-row timestamp, and the single `as_of` this '
  'call read the stores at; `migrations` is `not_measured` on any database with no '
  'supabase_migrations.schema_migrations, and `auth_failures`, `rate_limits` and `token_abuse` are '
  '`not_measured` because no such store exists in this schema. Counts and grouped categories only: no '
  'wedding, case, request, object key, account or note text crosses this projection.';

COMMENT ON FUNCTION api.operator_operations_summary(integer) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.operator_operations_summary. Authenticated '
  'only; the body refuses an account with no live `operations` grant.';
