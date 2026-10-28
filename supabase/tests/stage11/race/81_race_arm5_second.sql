-- ARM 5 session B (the second tab, and the refusal). The peer of `80_race_arm5_first.sql`.
--
-- This session appends to the same thread with its own key, on a snapshot that still shows the thread empty:
-- A's row exists but is not committed, so `max(seq)` here is the same `0` it is for A and the minter hands
-- both writers `seq = 1`. Neither writer can see the other's intention — that is the whole point of a race
-- over an ordinal — and nothing in the minter is allowed to silently renumber (`…:401` says so explicitly).
-- So the second writer waits, and what it waits on is what A's `A5_SEES_B_BLOCKED=` reports from the other
-- side: an ungranted lock on A's transaction id, which for an index insertion is how Postgres spells "the row
-- you are trying to put a unique key on is in doubt".
--
-- The answer this session must print is the shipped one: `23505`, `duplicate key value violates unique
-- constraint "support_case_events_seq_per_case_uniq"`. Anything else — `23514`, `42501`, an accepted second
-- row — means the arm measured something other than the collision, and the line says so under its own name.
--
-- The nested block is not decoration. A raised error would otherwise abort this session's transaction, and the
-- two lines after it are the half of the arm that can only be read from inside the same backend: the thread as
-- B now sees it (A's committed row, one row, one seq) and the fact that B's own key wrote nothing.
BEGIN;
SET search_path = public, pg_temp;
SET application_name = 's11r-arm5-second';

DO $b$
DECLARE v_id bigint; v_seq int; v_pre text; v_err text;
BEGIN
  RAISE NOTICE 'B5_STARTED=pid %', (SELECT pg_backend_pid());
  SELECT 'threadrows=' || count(*) || ' maxseq=' || coalesce(max(seq)::text, 'none')
    INTO v_pre FROM private.support_case_events
     WHERE case_id = '0b0b0b00-0000-4000-8000-000000000909'::uuid;
  -- Read in this session's own snapshot, before the wait: if A's row were already visible here, B's minter
  -- would have produced seq 2 and the collision below would be an artefact of the fixture rather than of the
  -- race.
  RAISE NOTICE 'B5_PRE=%', v_pre;

  BEGIN
    INSERT INTO private.support_case_events
        (case_id, kind, actor_user_id, actor_kind, idempotency_key, body)
      VALUES ('0b0b0b00-0000-4000-8000-000000000909'::uuid, 'message_operator',
              '0b0b0b00-0000-4000-8000-000000000119'::uuid, 'operator',
              '0b0b0b00-0000-4000-8000-000000000308'::uuid,
              'arm 5 second tab: the same ordinal, computed independently and one transaction late')
    RETURNING id, seq INTO v_id, v_seq;
    -- Reaching here means the thread took two rows with the same ordinal, or B minted a second one quietly.
    -- Either is an outcome rather than a plant failure, and `RD06` fails on it in the counted file — but it
    -- prints under the same `UNEXPECTED` word every other non-expected branch in this tier uses, so the driver
    -- stops the run here instead of carrying a broken premise into the asserts.
    RAISE NOTICE 'B5_OUTCOME=ACCEPTED row=%/seq=%', v_id, v_seq;
    RAISE NOTICE 'B5_REFUSAL=UNEXPECTED — the second append was allowed, so no ordinal collision happened';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'B5_OUTCOME=RAISED % | %', SQLSTATE, SQLERRM;
    IF SQLERRM LIKE '%support_case_events_seq_per_case_uniq%' THEN
      -- Short, because `mask()` redacts any run of 36-43 characters and the ordinal index's own name is 37: the
      -- needle in the line above is what ties this token to that index, and this one has to stay readable in the
      -- printed run log.
      RAISE NOTICE 'B5_REFUSAL=expected-ordinal-collision';
    ELSE
      RAISE NOTICE 'B5_REFUSAL=UNEXPECTED — a unique violation, but not the ordinal''s: %', SQLERRM;
    END IF;
  WHEN OTHERS THEN
    v_err := 'RAISED ' || SQLSTATE || ' | ' || SQLERRM;
    RAISE NOTICE 'B5_OUTCOME=%', left(v_err, 220);
    RAISE NOTICE 'B5_REFUSAL=UNEXPECTED — not unique_violation';
  END;

  -- After the savepoint rollback, still inside this transaction: a fresh statement, so a fresh snapshot under
  -- READ COMMITTED. This is B's own record of what the thread actually holds.
  RAISE NOTICE 'B5_ROWS_SEEN_BY_B=%', (SELECT 'threadrows=' || count(*)
      || ' seqs=' || coalesce(string_agg(seq::text, ',' ORDER BY seq), 'none')
      || ' key307=' || count(*) FILTER (WHERE idempotency_key = '0b0b0b00-0000-4000-8000-000000000307'::uuid)
      || ' key308=' || count(*) FILTER (WHERE idempotency_key = '0b0b0b00-0000-4000-8000-000000000308'::uuid)
    FROM private.support_case_events
   WHERE case_id = '0b0b0b00-0000-4000-8000-000000000909'::uuid);
  -- And the case itself: an append that refused must not have moved the ticket's status or its own row count.
  RAISE NOTICE 'B5_CASE_SEEN_BY_B=%', (SELECT 'status=' || c.status || ' events=' ||
      (SELECT count(*) FROM private.support_case_events e WHERE e.case_id = c.id)
    FROM private.support_cases c WHERE c.id = '0b0b0b00-0000-4000-8000-000000000909'::uuid);
END $b$;

ROLLBACK;

DO $b$
BEGIN
  RAISE NOTICE 'B5_ENDED=rolled-back';
END $b$;
