-- Stage 11 / file 2 of 5 — the support case, and the doors that speak to it.
--
-- Written against `docs/architecture/operations-admin-security.md` §5, §10 and §12; the section numbers
-- below refer to that document, which is the reviewable statement of *why* each object is shaped this
-- way. This file is the first one in the stage to put a name on `api`, so it is the first one a request
-- can reach: ten wrappers, each granted to `authenticated` and to nobody else, each backed by a
-- `internal_api` body that re-derives the caller from `auth.uid()` and decides the authorisation itself.
-- After the chain runs, both tables are empty and every one of those doors answers "no" to an anonymous
-- caller, to a signed-in host who is not an operator, and to the server key.
--
-- ---------------------------------------------------------------------------
-- Five decisions §5 left open, each taken here rather than at the console that will call this, and each
-- recorded because the next reader is entitled to know it was a choice and not a discovery.
--
--   1. **Three vocabularies are new and none of them is free text.** §5 named `category`, `severity` and
--      `resolution_code` as closed sets without listing them. `category` is what a ticket is *about*, so
--      the operator queue can be filtered without a second table; `severity` is the host's own claim
--      about urgency, not a promise of response time — nothing in this file reads a clock against it, and
--      inventing an SLA would be inventing a price. `resolution_code` deliberately contains no word about
--      money: `refunded` is absent, because §7 says a documented outcome is a *note* about something done
--      elsewhere, and a resolution code that read like a transaction would be the first step toward the
--      pretend-refund interface the kickoff §1 forbids.
--   2. **`severity` is set at open and never changed.** §10's `operator_transition_case` takes no severity
--      argument, and adding one would mean adding an argument to a wrapper whose whole design is that an
--      operator's lever is status and assignment. A host who under-states an emergency says so on the
--      ticket, and the operator's answer is to resolve it quickly, not to edit a field.
--   3. **`open_support_case` needs an idempotency anchor of its own.** §12 anchors event writes on
--      `(case_id, idempotency_key)`, which cannot help the call that *creates* the case — there is no
--      `case_id` yet. Without an anchor, a double-clicked "contact support" mints two tickets, and
--      duplicate-operation is priority 9 of the directive. So the case row carries
--      `open_idempotency_key`, unique **per caller**. It is one column beyond §5's list, and it is the only
--      one; §5 is edited in the same commit. The scoping is not a refinement: the first draft keyed the
--      anchor globally, and `q11-logs/s11-s2-replay-probe-1.txt` measured what that meant — a second
--      account delivering a key some other account had already used was answered with that other account's
--      `case_ref`, `wedding_id`, category, severity and opened-at, while its own request silently vanished.
--      One key per *account* is the same rule the event table already states for one key per *case*, and it
--      is the version that cannot turn another household's ticket into an answer.
--   4. **One call may write two event rows, so the key anchors only the primary one.** A transition that
--      carries a message writes a `status` row and a `message_host` row; a reply that picks the ticket
--      back up writes both too. `(case_id, idempotency_key)` is unique, so exactly one of the two carries
--      the key — the row that represents the *decision* — and the companion row is keyless. Replay is
--      refused by a pre-read that also checks the *kind* it finds: a key reused for a different action on
--      the same case is refused out loud rather than answered with the earlier action's recorded result,
--      which would be slice 1's "refusal that reports success" in a new costume.
--   5. **A host has no status argument.** `reply_to_support_case` takes a body and a key, and the only
--      status it can ever move is the one edge §5's table gives the requester: `awaiting_information →
--      in_progress`. Forging a status is impossible by surface shape, and the trigger below is the
--      backstop for a hand-written `UPDATE` rather than the primary defence.
--
-- What was measured before this file was written, because the design was drafted from reading and one of
-- its signatures was wrong. §10's `api.operator_case_queue(p_status, p_scope, p_limit)` asks for a scope
-- filter, and there is no scope column on a case — the duty split already lives in three *separate*
-- queues (§10's own rows: `operator_case_queue`, `operator_commerce_review_queue`,
-- `operator_privacy_queue`), so a scope argument on the case queue would be a second word for a fact that
-- has one, and a filter on a column that does not exist is decoration. It takes `p_category` instead, and
-- §10 is corrected in the same commit as this file. §10 also lists eight case wrappers and this file ships
-- ten: the note arm below makes nine, and correcting the assignment signature below splits it into two.
-- An operator with something to say needs a note arm, §13 tests "the note arms" in plural,
-- and §5 is only a real privacy boundary if the internal kind is reachable from a surface rather than from
-- a hand at the console. `api.operator_add_case_note(p_case_ref, p_kind, p_body, p_idempotency_key)` is
-- that arm, and it is shaped like §10's `operator_add_commerce_review_note`, which already takes `p_kind`.
--
--   2. **§10's assignment signature names a person, and the census has refused that since Stage 2.**
--      `api.operator_assign_case(p_case_ref, p_operator_user_id, p_idempotency_key)` — "assignee must
--      itself hold `support`" — was read against `40_catalog.sql` C29c before it was written as SQL: no
--      callable an `anon` or `authenticated` role can execute may take an argument whose name matches
--      `user_id|owner|role|uid`. The rule is not decoration. It is the reason a hostile signed-in account
--      has nothing to point at another account with, and Stage 11's whole thesis is that operational
--      authority must not be reachable by naming somebody. So assignment is two verbs that take no
--      identity at all: `operator_claim_case` records `auth.uid()` as the holder, and
--      `operator_release_case` clears the caller's own hold and refuses to clear anybody else's. §10's grant
--      check survives as the check on the *caller*, which is the honest half — a uuid in a request body
--      proves nothing about who is on the wire. What the pair costs is one more name on `api` and a
--      handover that is two recorded acts instead of one, which is the shape an operator review wants
--      anyway; and it buys the refusal §10 never asked for, that no operator may move a ticket onto
--      somebody else's queue. §10 is corrected in the same commit as this file.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. The case (§5)
-- ===========================================================================

CREATE TABLE private.support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- `SV-` plus eight base32 characters, minted by the trigger below. The row id is a uuid that a REST
  -- route could in principle reach; this is the string a human quotes, and it is the thing a takedown,
  -- a refund note and a privacy advance will all name (§5's authorisation carrier). UNIQUE is not a
  -- nicety: 40 bits of CSPRNG over a handful of tickets collides about never, and if it ever did the
  -- insert would refuse rather than silently produce two cases one operator could not tell apart.
  case_ref text NOT NULL UNIQUE
    CHECK (case_ref ~ '^SV-[A-Z2-7]{8}$'),
  -- Nullable, because a ticket can be about an account rather than a wedding. **NO ACTION**: a closed
  -- ticket is evidence of what was live when it was closed, so it does not cascade away with the
  -- wedding, and §12's rule is that every FK to `public.weddings` refuses the parent's delete rather
  -- than quietly nulling the link. A wedding that is deleted with an open ticket about it is a failure
  -- that says so.
  wedding_id uuid REFERENCES public.weddings(id) ON DELETE NO ACTION,
  -- Whose ticket this is, taken from `auth.uid()` and never from an argument. SET NULL by §12: the case
  -- outlives the account as evidence, and a queue that names nobody is still a queue that says what
  -- happened. That sentence was a claim until this file's guard was given the room to make it true — the
  -- nulling is an UPDATE and the guard below refuses UPDATEs that move this column, so the branch that
  -- protects ownership now steps aside for the one UPDATE the database issues for its own key. Measured on
  -- both sides: `q11-logs/s11-probe-fk-null-1.txt` (refusal, before) and the RI cells of group T in
  -- `85_support_lifecycle.sql` (surviving row, after).
  requester_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Who actually filed it. Same posture, different question — `requester_user_id` is the ownership the
  -- read surface filters on, this is the provenance an incident review reads. Both can legitimately go
  -- NULL on the same row, and a case with neither is a hand plant, which the battery labels as one.
  opened_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category text NOT NULL
    CHECK (category IN ('invitation_access', 'publication_delivery', 'guest_rsvp',
                        'render_output', 'billing_refund_inquiry', 'privacy_data_request',
                        'other')),
  severity text NOT NULL
    CHECK (severity IN ('low', 'normal', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'triaged', 'awaiting_information', 'in_progress',
                      'resolved', 'closed')),
  -- The host's own words, bounded and non-blank. This is the one column in the stage that carries
  -- caller text into an operator's screen, which is exactly why it has a length CHECK rather than a
  -- promise in the body: §4 keeps caller text out of the *audit* trail, and this is not the audit trail.
  host_summary text NOT NULL
    CHECK (length(btrim(host_summary)) > 0 AND length(host_summary) <= 2000),
  assigned_operator_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- NULL on a resting row is impossible and a resting row with no code is impossible, in both
  -- directions. `closed` is included: ending a ticket without saying how it ended is the shape of a
  -- trail that cannot be reviewed. Set by the guard trigger below at the same instant it checks the
  -- edge, so no writer supplies its own clock.
  resolution_code text
    CHECK (resolution_code IS NULL OR resolution_code IN ('resolved_by_operator', 'host_withdrew',
                                                          'no_action_needed', 'duplicate',
                                                          'out_of_scope', 'event_cancelled')),
  resolved_at timestamptz,
  opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_cases_resting_pair_check
    CHECK ((status IN ('resolved', 'closed')) = (resolved_at IS NOT NULL
                                                 AND resolution_code IS NOT NULL)),
  CONSTRAINT support_cases_resting_after_open_check
    CHECK (resolved_at IS NULL OR resolved_at >= opened_at),
  -- Decision 3 above: a key that was never used stays NULL so a hand insert is unconstrained, and the
  -- partial unique index below is the whole mechanism — the same *composite* shape the event table uses for
  -- one row per `(case_id, idempotency_key)`, one level up: one ticket per `(caller, key)`.
  open_idempotency_key uuid
);

-- The index that makes a replayed "contact support" impossible rather than merely unlikely, and the two
-- read paths this file's bodies actually take: a host's own list, oldest-first by nature of being theirs,
-- and an operator's queue, which must be able to find the neglected tickets.
-- The key is the *second* column because the only lookup is the caller's own replay probe — scoping it to
-- the caller is what stops one account's key from answering another account's ticket.
CREATE UNIQUE INDEX support_cases_open_key_uniq
  ON private.support_cases (requester_user_id, open_idempotency_key)
  WHERE open_idempotency_key IS NOT NULL;
CREATE INDEX support_cases_requester_opened_idx
  ON private.support_cases (requester_user_id, opened_at DESC);
CREATE INDEX support_cases_status_opened_idx
  ON private.support_cases (status, opened_at)
  WHERE status IN ('open', 'triaged', 'awaiting_information', 'in_progress');

-- The ref is minted, never supplied — the same rule §5 states for the row id and the reason the trigger
-- refuses a non-NULL input instead of overwriting it. A caller who could choose `case_ref` could choose
-- the string a later takedown names as its authorisation.
CREATE FUNCTION private.mint_support_case_ref() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  -- RFC 4648 base32's alphabet, which has no `0`, `1`, `8`, `9` and no `I`, `L`, `O`, `S`, `U`, `V`, `W`,
  -- `X`: the ambiguity a human reads off a phone screen is the failure, and `SV-` is prefixed outside the
  -- random part so the alphabet never has to spell the prefix.
  v_alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  v_bits text;
  v_ref text := 'SV-';
  v_i int;
BEGIN
  IF NEW.case_ref IS NOT NULL THEN
    RAISE EXCEPTION 'a support case ref is minted by the database, never supplied: it is the string a '
      'later takedown or refund note names as its authorisation, and a caller that could choose it could '
      'choose somebody else''s'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 40 bits = 8 base32 characters exactly, so no rejection sampling and no loop that could in principle
  -- run forever. Same generator as every credential in this schema.
  v_bits := (('x' || encode(extensions.gen_random_bytes(5), 'hex'))::bit(40))::text;
  FOR v_i IN 0..7 LOOP
    v_ref := v_ref || substr(v_alphabet, (substring(v_bits, v_i * 5 + 1, 5)::bit(5))::int + 1, 1);
  END LOOP;

  NEW.case_ref := v_ref;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.mint_support_case_ref() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER support_cases_mint_ref BEFORE INSERT ON private.support_cases
  FOR EACH ROW EXECUTE FUNCTION private.mint_support_case_ref();

-- The state machine, as data the database holds rather than as a document (§5). Three separate
-- refusals in one body, because they answer three different questions and a reader of the run log has to
-- be able to tell them apart: an immutable fact being rewritten, a resting state with no evidence, and
-- an edge that does not exist.
CREATE FUNCTION private.guard_support_case_update() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
BEGIN
  -- What may never move after the case is opened, and why each of those is a fact rather than a field.
  IF NEW.case_ref IS DISTINCT FROM OLD.case_ref THEN
    RAISE EXCEPTION 'support_cases.case_ref is minted once and quoted forever' USING ERRCODE = '42501';
  END IF;
  IF NEW.wedding_id IS DISTINCT FROM OLD.wedding_id THEN
    RAISE EXCEPTION 'a support case cannot be re-parented onto another wedding: the wedding named on the '
      'ticket is the scope of every act it authorises' USING ERRCODE = '42501';
  END IF;
  -- §12 declares both of these links `ON DELETE SET NULL`, and Postgres carries out an `ON DELETE SET NULL`
  -- by issuing an UPDATE on this row — so a guard that refuses every change to them refuses the database's
  -- own cleanup, and the "the case outlives the account as evidence" sentence below would be a claim about a
  -- thing that cannot happen. That is measured, not reasoned: `q11-logs/s11-probe-fk-null-1.txt` cell M1
  -- deleted an account that had filed a ticket and heard "a support case cannot change hands" out of this
  -- branch, while cell M5 deleted an account named only in the *un*protected `assigned_operator_user_id` and
  -- the nulling landed. So the exception is per column and exactly as wide as the mechanism: the link must be
  -- going to NULL, and the statement must be arriving from inside another trigger, which is the shape of the
  -- database's own referential action. The second half is the one that had to be measured — asking instead
  -- whether the account still exists gets the wrong answer, because the cleanup runs inside the deleting
  -- command and a command cannot see its own in-flight deletion
  -- (`q11-logs/s11-probe-ri-cells2-1.txt`, every block). Everything else a caller can attempt — a different
  -- uuid, a null issued from a statement of its own, the opening instant or its key moved — is a hand
  -- steering a ticket, and is refused with the sentence this branch has always used.
  IF NEW.requester_user_id IS DISTINCT FROM OLD.requester_user_id
     AND (NEW.requester_user_id IS NOT NULL OR pg_trigger_depth() < 2) THEN
    RAISE EXCEPTION 'a support case cannot change hands: whose ticket it is decides whose read surface it '
      'appears on' USING ERRCODE = '42501';
  END IF;
  IF NEW.opened_by_user_id IS DISTINCT FROM OLD.opened_by_user_id
     AND (NEW.opened_by_user_id IS NOT NULL OR pg_trigger_depth() < 2) THEN
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

  -- A write that moves no status may move no resting evidence either — the same posture the output
  -- registry takes (`20261013120000_stage9_render_outputs.sql`, "a write that changes no status may
  -- change no evidence either"). Only the assignment moves on a live status.
  IF NEW.status = OLD.status THEN
    IF NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
       OR NEW.resolution_code IS DISTINCT FROM OLD.resolution_code THEN
      RAISE EXCEPTION 'a status that did not change may not gain or lose its resolution'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'a closed support case is terminal' USING ERRCODE = 'check_violation';
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

REVOKE ALL ON FUNCTION private.guard_support_case_update() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER support_cases_guard_update BEFORE UPDATE ON private.support_cases
  FOR EACH ROW EXECUTE FUNCTION private.guard_support_case_update();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON private.support_cases
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER support_cases_no_client_write BEFORE INSERT OR UPDATE ON private.support_cases
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER support_cases_no_client_delete BEFORE DELETE ON private.support_cases
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

ALTER TABLE private.support_cases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.support_cases FROM PUBLIC;

COMMENT ON TABLE private.support_cases IS
  'One support ticket: a minted `SV-` ref, an optional wedding it is about, a host-declared category, '
  'severity and summary, an owner, an optional operator assignee, and a six-state machine whose edges are '
  'enforced by a trigger. Created EMPTY. RLS with no policy, no grant to any client role, so the only '
  'writers are the internal_api bodies below. The wedding FK is NO ACTION and the account FKs are SET '
  'NULL: a ticket is evidence about a wedding, and it outlives an erased account.';

-- ===========================================================================
-- 2. The history (§5)
-- ===========================================================================

CREATE TABLE private.support_case_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- NO ACTION, not CASCADE. A case row cannot be removed while its history survives, which makes
  -- "delete the ticket" an act that has to say what it is doing to the events first — the append-only
  -- posture the directive asks for, expressed as a key rather than as a comment.
  case_id uuid NOT NULL REFERENCES private.support_cases(id) ON DELETE NO ACTION,
  -- Per-case ordinal, minted below, never supplied. `id` is the global order; `seq` is the order this
  -- thread reads, and a client that re-reads the thread by `seq` cannot be shown a gap it would have to
  -- guess about.
  seq integer NOT NULL CHECK (seq > 0),
  -- Five arms. `operation_link` is written by the later slices (§5's reused authorisation carrier: a
  -- takedown, a refund note and a privacy advance each append one), so it is in the vocabulary now and
  -- unreachable until the body that writes it exists — stated rather than left for a reader to notice.
  kind text NOT NULL
    CHECK (kind IN ('message_host', 'message_operator', 'assignment', 'status', 'operation_link')),
  -- Who wrote this row, taken from `auth.uid()` by the door that appends it. SET NULL rather than CASCADE
  -- for the same reason the case table takes it: the thread is the evidence and the account is not. The
  -- guard that lets that nulling through is installed below, next to the insert rule it pairs with.
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('host', 'operator', 'system')),
  from_status text CHECK (from_status IS NULL OR from_status IN ('open', 'triaged',
    'awaiting_information', 'in_progress', 'resolved', 'closed')),
  to_status text CHECK (to_status IS NULL OR to_status IN ('open', 'triaged',
    'awaiting_information', 'in_progress', 'resolved', 'closed')),
  -- Exactly the two message kinds carry text and nothing else may: the arm is what the read surface
  -- filters on, so a `status` row with a body in it is a note smuggled past the filter.
  body text,
  idempotency_key uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_case_events_body_pairs_message_check
    CHECK ((kind IN ('message_host', 'message_operator')) = (body IS NOT NULL)),
  CONSTRAINT support_case_events_body_bounded_check
    CHECK (body IS NULL OR (length(btrim(body)) > 0 AND length(body) <= 4000)),
  CONSTRAINT support_case_events_status_moves_check
    CHECK (from_status IS NULL OR to_status IS NULL OR from_status <> to_status),
  -- A `status` row is the only kind that names a destination, and a `message_*` row is the only kind
  -- that must not. Without this, a note row could claim to have moved the case for a reader that trusts
  -- the arm it reads.
  CONSTRAINT support_case_events_status_kind_check
    CHECK ((to_status IS NOT NULL) = (kind = 'status'))
  -- "A human row must name an account" is enforced below as a BEFORE INSERT guard rather than as a table
  -- CHECK, for the reason slice 1 states at length: deleting the named account is carried out on this table
  -- as an UPDATE that nulls `actor_user_id` (the column's declared `ON DELETE SET NULL` has no other
  -- implementation), and a CHECK fires on that UPDATE too — kept as a CHECK, this rule would not merely
  -- forbid a forged row, it would make every host who ever opened a ticket undeletable.
);

-- Idempotency: one call one primary row. See decision 4 — the key rides the row that represents the
-- decision, and the companion row of a two-row call is deliberately keyless.
CREATE UNIQUE INDEX support_case_events_one_row_per_key
  ON private.support_case_events (case_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- The thread read is this table's whole reason to exist, and one index serves it and enforces the ordinal:
-- a second index on the same two columns would be a second place to look.
CREATE UNIQUE INDEX support_case_events_seq_per_case_uniq
  ON private.support_case_events (case_id, seq);

CREATE FUNCTION private.mint_support_case_seq() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
BEGIN
  IF NEW.seq IS NOT NULL THEN
    RAISE EXCEPTION 'a support case event''s seq is minted by the database: an ordered thread is a '
      'property of the row the next writer must be able to trust' USING ERRCODE = '42501';
  END IF;
  -- Two sessions appending to the same thread at once compute the same seq and one of them is refused by
  -- the unique index above. That is the correct answer to a race the serial battery cannot see, and the
  -- race tier names it; nothing here silently renumbers.
  SELECT coalesce(max(e.seq), 0) + 1 INTO NEW.seq
    FROM private.support_case_events e
   WHERE e.case_id = NEW.case_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.mint_support_case_seq() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER support_case_events_mint_seq BEFORE INSERT ON private.support_case_events
  FOR EACH ROW EXECUTE FUNCTION private.mint_support_case_seq();

-- An insert-only table has no legitimate UPDATE at all — not for a client role and not for its own owner —
-- except the one the database makes for itself when the account this row names is deleted, which is an
-- UPDATE of `actor_user_id` to NULL and is the only way §12's "the thread survives the account" can happen.
-- So this table takes a body of its own rather than `private.reject_any_update()`: every other column is
-- compared as a whole, and the single permitted move is the referential one, recognised by arriving from
-- inside another trigger. §12's client pair stays in place underneath it for the DELETE half.
CREATE FUNCTION private.reject_case_event_update_except_referential_null() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
BEGIN
  IF (v_new - 'actor_user_id') IS DISTINCT FROM (v_old - 'actor_user_id') THEN
    RAISE EXCEPTION '%.% rows are append-only: a correction is a new row and an audit event, never a rewrite',
      TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
     AND (NEW.actor_user_id IS NOT NULL OR pg_trigger_depth() < 2) THEN
    RAISE EXCEPTION '%.% rows are append-only: a correction is a new row and an audit event, never a rewrite',
      TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_case_event_update_except_referential_null()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.reject_case_event_update_except_referential_null() IS
  'BEFORE UPDATE guard on the support thread: refuses every rewrite by every role, including the owner, '
  'except the nulling of `actor_user_id` that arrives from inside another trigger — the database carrying '
  'out that account''s ON DELETE SET NULL. SECURITY INVOKER, and ungrantable to every client role.';

CREATE TRIGGER support_case_events_no_update_any_role BEFORE UPDATE ON private.support_case_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_case_event_update_except_referential_null();

-- The anti-forgery rule for the thread, at the instant the row is written: a `host` or `operator` row that
-- names no account is refused with the 23514 a table CHECK would have used. It is an INSERT guard so that
-- the nulling above is not refused by a rule about writing, and the door bodies that derive the actor from
-- `auth.uid()` are the only writers either way.
CREATE FUNCTION private.reject_case_event_without_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.actor_kind <> 'system' AND NEW.actor_user_id IS NULL THEN
    RAISE EXCEPTION 'a % row in a support thread must name the account that wrote it', NEW.actor_kind
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_case_event_without_actor()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.reject_case_event_without_actor() IS
  'BEFORE INSERT guard on the support thread: a human-kind row must name an account. Refuses with 23514, the '
  'state the table CHECK it replaced used, and is deliberately not a CHECK because the referential nulling '
  'of a deleted account is an UPDATE this table must survive. See '
  'reject_case_event_update_except_referential_null.';

CREATE TRIGGER support_case_events_actor_names_a_human BEFORE INSERT ON private.support_case_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_case_event_without_actor();

CREATE TRIGGER support_case_events_no_client_write BEFORE INSERT OR UPDATE ON private.support_case_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER support_case_events_no_client_delete BEFORE DELETE ON private.support_case_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

ALTER TABLE private.support_case_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.support_case_events FROM PUBLIC;

COMMENT ON TABLE private.support_case_events IS
  'The case''s own append-only history: a minted per-case seq, one of five arms, who wrote it and as what, '
  'the status an edge moved, bounded text on the two message arms only, and an idempotency key on the '
  'primary row of each call. `message_operator` is internal — no host read surface selects it. Created '
  'EMPTY; RLS with no policy; no client grant; UPDATE refused for every role including the owner.';

-- ===========================================================================
-- 3. The shared shape of a refusal (§5's scoping rule)
-- ===========================================================================
-- Every "not yours" and "not there" in this file answers with one SQLSTATE and one sentence, and that is
-- Stage 3's rule re-stated rather than re-invented: no operational RPC may become an existence oracle
-- over a ref or a uuid a caller typed. The bodies do not share a helper function, because a helper would
-- be a tenth `private` name whose only job is an exception string, and the sentence has to be readable at
-- the call site that raises it.

-- ===========================================================================
-- 4. The host's doors
-- ===========================================================================

CREATE FUNCTION internal_api.open_support_case(
  p_wedding_id uuid,
  p_category text,
  p_severity text,
  p_summary text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_case private.support_cases;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'this door needs a signed-in account' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Input rules first, all of them, before anything is read or written.
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'opening a support case requires an idempotency key: a double click must produce one '
      'ticket, not two' USING ERRCODE = 'check_violation';
  END IF;
  IF p_category IS NULL OR p_category NOT IN ('invitation_access', 'publication_delivery', 'guest_rsvp',
                                              'render_output', 'billing_refund_inquiry',
                                              'privacy_data_request', 'other') THEN
    RAISE EXCEPTION 'unknown support category %: the seven are invitation_access, publication_delivery, '
      'guest_rsvp, render_output, billing_refund_inquiry, privacy_data_request and other',
      coalesce(quote_literal(p_category), 'NULL') USING ERRCODE = 'check_violation';
  END IF;
  IF p_severity IS NULL OR p_severity NOT IN ('low', 'normal', 'high', 'critical') THEN
    RAISE EXCEPTION 'unknown support severity %: the four are low, normal, high and critical, and a '
      'fifth word here is not a faster answer',
      coalesce(quote_literal(p_severity), 'NULL') USING ERRCODE = 'check_violation';
  END IF;
  IF p_summary IS NULL OR length(btrim(p_summary)) = 0 THEN
    RAISE EXCEPTION 'a support case must say what is wrong: a ticket with no summary is a queue entry '
      'nobody can triage' USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_summary) > 2000 THEN
    RAISE EXCEPTION 'the summary of a support case must fit in 2000 characters, got %', length(p_summary)
      USING ERRCODE = 'check_violation';
  END IF;

  -- A case may be about an account rather than a wedding, and that is the only way `wedding_id` may be
  -- NULL. When it is not NULL the caller must own that wedding, with the one sentence §5 requires.
  IF p_wedding_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.weddings w
        WHERE w.id = p_wedding_id AND w.owner_user_id = v_caller) THEN
    RAISE EXCEPTION 'the caller may not open a case about this wedding'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Replay: the second delivery of one key *by the account that used it first* returns the ticket the
  -- first delivery made, and does not describe itself as a new one. The `requester_user_id` term is not a
  -- performance filter. Without it this read is a lookup on a caller-supplied uuid that answers with
  -- somebody else's whole ticket — measured against the first draft in
  -- `q11-logs/s11-s2-replay-probe-1.txt`, where a second account got the first account's `case_ref` and
  -- `wedding_id` back and lost its own request. A key belongs to the account that sent it, exactly as a
  -- key belongs to the case an event row is written against.
  SELECT c.* INTO v_case FROM private.support_cases c
   WHERE c.open_idempotency_key = p_idempotency_key
     AND c.requester_user_id = v_caller;
  IF FOUND THEN
    RETURN jsonb_build_object('case_ref', v_case.case_ref, 'wedding_id', v_case.wedding_id,
                              'category', v_case.category, 'severity', v_case.severity,
                              'status', v_case.status, 'opened_at', v_case.opened_at,
                              'replayed', true);
  END IF;

  INSERT INTO private.support_cases
      (wedding_id, requester_user_id, opened_by_user_id, category, severity, status,
       host_summary, opened_at, open_idempotency_key)
    VALUES (p_wedding_id, v_caller, v_caller, p_category, p_severity, 'open',
            btrim(p_summary), now(), p_idempotency_key)
  RETURNING * INTO v_case;

  -- The first row of the thread: an edge from nothing into `open`. Keyless, because the key rides the
  -- case row for this call, and the seq is minted.
  INSERT INTO private.support_case_events
      (case_id, kind, actor_user_id, actor_kind, from_status, to_status, created_at)
    VALUES (v_case.id, 'status', v_caller, 'host', NULL, 'open', now());

  RETURN jsonb_build_object('case_ref', v_case.case_ref, 'wedding_id', v_case.wedding_id,
                            'category', v_case.category, 'severity', v_case.severity,
                            'status', v_case.status, 'opened_at', v_case.opened_at,
                            'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.open_support_case(uuid, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.open_support_case(uuid, text, text, text, uuid) TO authenticated;

CREATE FUNCTION api.open_support_case(
  p_wedding_id uuid,
  p_category text,
  p_severity text,
  p_summary text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.open_support_case(p_wedding_id, p_category, p_severity, p_summary,
                                        p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION api.open_support_case(uuid, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.open_support_case(uuid, text, text, text, uuid) TO authenticated;

COMMENT ON FUNCTION internal_api.open_support_case(uuid, text, text, text, uuid) IS
  'Caller re-derived from auth.uid(); the wedding argument is optional and, when present, must be the '
  'caller''s own. Refuses an unknown category or severity, a blank or oversized summary, and a call with '
  'no idempotency key. A second delivery of one key by the same account returns the ticket the first made '
  'with replayed=true and writes nothing; the anchor is keyed per caller, so a key another account already '
  'used is only ever this account''s own new ticket.';

COMMENT ON FUNCTION api.open_support_case(uuid, text, text, text, uuid) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.open_support_case. Authenticated only. This is '
  'a host asking for help, and the only case-writing door a host has.';

-- --- the host's two reads ---

CREATE FUNCTION internal_api.get_my_support_cases(p_status text, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_limit int;
  v_rows jsonb;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'this door needs a signed-in account' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'triaged', 'awaiting_information',
                                               'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'unknown support status %: a filter word this lifecycle does not have would answer '
      'with an empty list and look like an account with no tickets',
      quote_literal(p_status) USING ERRCODE = 'check_violation';
  END IF;
  v_limit := coalesce(p_limit, 25);
  IF v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'the number of cases to read must be between 1 and 100, got %', p_limit
      USING ERRCODE = 'check_violation';
  END IF;

  -- `requester_user_id`, always, and nothing else. A host's list is not a queue.
  SELECT coalesce(jsonb_agg(pg_temp_none.k), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object('case_ref', c.case_ref, 'wedding_id', c.wedding_id,
                              'category', c.category, 'severity', c.severity, 'status', c.status,
                              'resolution_code', c.resolution_code, 'host_summary', c.host_summary,
                              'opened_at', c.opened_at, 'updated_at', c.updated_at,
                              'resolved_at', c.resolved_at) AS k
      FROM private.support_cases c
     WHERE c.requester_user_id = v_caller
       AND (p_status IS NULL OR c.status = p_status)
     ORDER BY c.opened_at DESC, c.case_ref
     LIMIT v_limit
  ) pg_temp_none;

  RETURN jsonb_build_object('cases', v_rows, 'status_filter', p_status, 'limit', v_limit);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.get_my_support_cases(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.get_my_support_cases(text, integer) TO authenticated;

CREATE FUNCTION api.get_my_support_cases(p_status text, p_limit integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.get_my_support_cases(p_status, p_limit);
$$;

REVOKE ALL ON FUNCTION api.get_my_support_cases(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.get_my_support_cases(text, integer) TO authenticated;

COMMENT ON FUNCTION internal_api.get_my_support_cases(text, integer) IS
  'SECURITY DEFINER, STABLE. The caller''s own tickets, newest first, bounded at 100. Carries the host''s '
  'own summary back to the host and nothing belonging to anybody else: no assignee, no operator note, no '
  'other case.';

COMMENT ON FUNCTION api.get_my_support_cases(text, integer) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.get_my_support_cases. Authenticated only.';

CREATE FUNCTION internal_api.get_my_support_case(p_case_ref text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_case private.support_cases;
  v_events jsonb;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'this door needs a signed-in account' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_case_ref IS NULL OR length(btrim(p_case_ref)) = 0 THEN
    RAISE EXCEPTION 'a case ref must be supplied to read one case' USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.* INTO v_case FROM private.support_cases c
   WHERE c.case_ref = btrim(p_case_ref) AND c.requester_user_id = v_caller;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the caller may not read this support case' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The privacy boundary of this stage, in one WHERE clause (§5): the host sees the messages on their own
  -- thread and the status history, and never an operator's private note, never an assignment, never the
  -- `operation_link` rows that name what an operator did to their wedding behind the scenes.
  SELECT coalesce(jsonb_agg(pg_temp_none.k), '[]'::jsonb) INTO v_events FROM (
    SELECT jsonb_build_object('seq', e.seq, 'kind', e.kind, 'actor_kind', e.actor_kind,
                              'from_status', e.from_status, 'to_status', e.to_status,
                              'body', e.body, 'created_at', e.created_at) AS k
      FROM private.support_case_events e
     WHERE e.case_id = v_case.id
       AND e.kind IN ('message_host', 'status')
     ORDER BY e.seq
     LIMIT 200
  ) pg_temp_none;

  RETURN jsonb_build_object(
    'case_ref', v_case.case_ref, 'wedding_id', v_case.wedding_id, 'category', v_case.category,
    'severity', v_case.severity, 'status', v_case.status, 'resolution_code', v_case.resolution_code,
    'host_summary', v_case.host_summary, 'opened_at', v_case.opened_at,
    'updated_at', v_case.updated_at, 'resolved_at', v_case.resolved_at,
    -- Derived, never stored: the one status a host's own reply can move. A UI that shows a reply box
    -- where this is false is a UI this projection told nothing to be wrong.
    'reply_allowed', v_case.status <> 'closed',
    'resume_expected', v_case.status = 'awaiting_information',
    'events', v_events);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.get_my_support_case(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.get_my_support_case(text) TO authenticated;

CREATE FUNCTION api.get_my_support_case(p_case_ref text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.get_my_support_case(p_case_ref);
$$;

REVOKE ALL ON FUNCTION api.get_my_support_case(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.get_my_support_case(text) TO authenticated;

COMMENT ON FUNCTION internal_api.get_my_support_case(text) IS
  'SECURITY DEFINER, STABLE. The caller''s own case and the two event arms that belong in a host''s read. '
  'A ref that is not theirs and a ref that is not there answer with the same sentence and the same '
  'SQLSTATE, so this is not an oracle over somebody else''s ticket number.';

COMMENT ON FUNCTION api.get_my_support_case(text) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.get_my_support_case. Authenticated only.';

-- --- the host's one write: a reply, and possibly the resume it implies ---

CREATE FUNCTION internal_api.reply_to_support_case(
  p_case_ref text,
  p_body text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_case private.support_cases;
  v_seen private.support_case_events;
  v_seq integer;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'this door needs a signed-in account' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'a reply requires an idempotency key: a resubmitted form must not put the same '
      'paragraph in the thread twice' USING ERRCODE = 'check_violation';
  END IF;
  IF p_body IS NULL OR length(btrim(p_body)) = 0 THEN
    RAISE EXCEPTION 'a reply must say something' USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_body) > 4000 THEN
    RAISE EXCEPTION 'a reply must fit in 4000 characters, got %', length(p_body)
      USING ERRCODE = 'check_violation';
  END IF;

  -- Locked before the decision and the writes, so a second session on the same thread cannot compute the
  -- same seq and cannot both take the case out of `awaiting_information`.
  SELECT c.* INTO v_case FROM private.support_cases c
   WHERE c.case_ref = btrim(p_case_ref) AND c.requester_user_id = v_caller
     FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the caller may not reply on this support case'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT e.* INTO v_seen FROM private.support_case_events e
   WHERE e.case_id = v_case.id AND e.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_seen.kind <> 'message_host' THEN
      RAISE EXCEPTION 'this idempotency key already carries a % row on this case: one key is one action, '
        'and answering a reply with somebody else''s recorded result would be a refusal that reports '
        'success', v_seen.kind USING ERRCODE = 'check_violation';
    END IF;
    RETURN jsonb_build_object('case_ref', v_case.case_ref, 'status', v_case.status,
                              'seq', v_seen.seq, 'replayed', true);
  END IF;

  IF v_case.status = 'closed' THEN
    RAISE EXCEPTION 'a closed support case takes no further messages: the history is what it is, and '
      'opening the thread again is a new ticket rather than a rewrite of this one'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The message first, and it is the row that carries the key — it is the thing this call was for.
  INSERT INTO private.support_case_events
      (case_id, kind, actor_user_id, actor_kind, body, idempotency_key, created_at)
    VALUES (v_case.id, 'message_host', v_caller, 'host', btrim(p_body), p_idempotency_key, now())
  RETURNING seq INTO v_seq;

  -- The one edge §5 gives the requester, taken only when the case is already waiting on them. There is
  -- no target-status argument anywhere in this signature, which is the structural half of "a host cannot
  -- forge a status".
  IF v_case.status = 'awaiting_information' THEN
    UPDATE private.support_cases c
       SET status = 'in_progress'
     WHERE c.id = v_case.id;
    INSERT INTO private.support_case_events
        (case_id, kind, actor_user_id, actor_kind, from_status, to_status, created_at)
      VALUES (v_case.id, 'status', v_caller, 'host', 'awaiting_information', 'in_progress', now());
  END IF;

  RETURN jsonb_build_object('case_ref', v_case.case_ref,
                            'status', (SELECT c.status FROM private.support_cases c WHERE c.id = v_case.id),
                            'seq', v_seq, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.reply_to_support_case(text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.reply_to_support_case(text, text, uuid) TO authenticated;

CREATE FUNCTION api.reply_to_support_case(p_case_ref text, p_body text, p_idempotency_key uuid)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.reply_to_support_case(p_case_ref, p_body, p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION api.reply_to_support_case(text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.reply_to_support_case(text, text, uuid) TO authenticated;

COMMENT ON FUNCTION internal_api.reply_to_support_case(text, text, uuid) IS
  'Requester of that case only, and the `message_host` arm only. Refuses a closed case and a call with no '
  'key. When the case is waiting on this host the reply also walks the single edge the lifecycle gives a '
  'requester, `awaiting_information -> in_progress`; there is no status argument, so there is nothing to '
  'forge.';

COMMENT ON FUNCTION api.reply_to_support_case(text, text, uuid) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.reply_to_support_case. Authenticated only.';

-- ===========================================================================
-- 5. The operator's doors
-- ===========================================================================
-- Six doors follow, and every one of them opens by asking the predicate §3 built. The four that *act*
-- re-derive the caller into a local first, because each of them needs to know whose name to write into the
-- history and the trail; the two reads do not, because they have nothing to attribute. `actor_is_operator`
-- reads `auth.uid()` and never an argument, so no caller can ask the queue whether *somebody else* is an
-- operator, and a revoked or expired grant answers false rather than raising — which is why an expiry needs
-- no cleanup job for the door to be shut.

CREATE FUNCTION internal_api.operator_case_queue(p_status text, p_category text, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_limit int;
  v_rows jsonb;
BEGIN
  IF NOT private.actor_is_operator('support') THEN
    RAISE EXCEPTION 'the caller may not read the case queue' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('open', 'triaged', 'awaiting_information',
                                               'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'unknown support status %', quote_literal(p_status)
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_category IS NOT NULL AND p_category NOT IN ('invitation_access', 'publication_delivery',
      'guest_rsvp', 'render_output', 'billing_refund_inquiry', 'privacy_data_request', 'other') THEN
    RAISE EXCEPTION 'unknown support category %', quote_literal(p_category)
      USING ERRCODE = 'check_violation';
  END IF;
  v_limit := coalesce(p_limit, 25);
  IF v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'the number of cases to read must be between 1 and 100, got %', p_limit
      USING ERRCODE = 'check_violation';
  END IF;

  -- Oldest first: a queue is a list of neglected things, and a host's newest ticket is already answered
  -- by their own inbox. The assignee and the requester are uuids — §3's rule that authority and evidence
  -- name an account and never an email.
  SELECT coalesce(jsonb_agg(pg_temp_none.k), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object('case_ref', c.case_ref, 'wedding_id', c.wedding_id,
                              'requester_user_id', c.requester_user_id, 'category', c.category,
                              'severity', c.severity, 'status', c.status,
                              'assigned_operator_user_id', c.assigned_operator_user_id,
                              'host_summary', c.host_summary, 'opened_at', c.opened_at,
                              'updated_at', c.updated_at) AS k
      FROM private.support_cases c
     WHERE (p_status IS NULL OR c.status = p_status)
       AND (p_category IS NULL OR c.category = p_category)
     ORDER BY c.opened_at, c.case_ref
     LIMIT v_limit
  ) pg_temp_none;

  RETURN jsonb_build_object('cases', v_rows, 'status_filter', p_status, 'category_filter', p_category,
                            'limit', v_limit);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.operator_case_queue(text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.operator_case_queue(text, text, integer) TO authenticated;

CREATE FUNCTION api.operator_case_queue(p_status text, p_category text, p_limit integer)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.operator_case_queue(p_status, p_category, p_limit);
$$;

REVOKE ALL ON FUNCTION api.operator_case_queue(text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.operator_case_queue(text, text, integer) TO authenticated;

COMMENT ON FUNCTION internal_api.operator_case_queue(text, text, integer) IS
  'Scope `support`, STABLE. Every case, oldest first, optionally filtered by status and category; both '
  'filters are refused as unknown words rather than answered as an empty list. The operator projection: '
  'assignee, requester and summary included, internal notes still only through the single-case read.';

COMMENT ON FUNCTION api.operator_case_queue(text, text, integer) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.operator_case_queue. Authenticated only, and '
  'useless without a live grant.';

CREATE FUNCTION internal_api.get_operator_case(p_case_ref text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_case private.support_cases;
  v_events jsonb;
BEGIN
  IF NOT private.actor_is_operator('support') THEN
    RAISE EXCEPTION 'the caller may not read this support case' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_case_ref IS NULL OR length(btrim(p_case_ref)) = 0 THEN
    RAISE EXCEPTION 'a case ref must be supplied to read one case' USING ERRCODE = 'check_violation';
  END IF;

  -- An operator with `support` reads every case, which is the job; what they do not get is another
  -- operator's identity presented as anything but a uuid, and the sentence is the one the host's read
  -- uses, so a missing ref and a ref beyond this scope answer alike.
  SELECT c.* INTO v_case FROM private.support_cases c WHERE c.case_ref = btrim(p_case_ref);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the caller may not read this support case' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT coalesce(jsonb_agg(pg_temp_none.k), '[]'::jsonb) INTO v_events FROM (
    SELECT jsonb_build_object('seq', e.seq, 'kind', e.kind, 'actor_kind', e.actor_kind,
                              'actor_user_id', e.actor_user_id, 'from_status', e.from_status,
                              'to_status', e.to_status, 'body', e.body,
                              'created_at', e.created_at) AS k
      FROM private.support_case_events e
     WHERE e.case_id = v_case.id
     ORDER BY e.seq
     LIMIT 500
  ) pg_temp_none;

  RETURN jsonb_build_object(
    'case_ref', v_case.case_ref, 'wedding_id', v_case.wedding_id,
    'requester_user_id', v_case.requester_user_id, 'opened_by_user_id', v_case.opened_by_user_id,
    'assigned_operator_user_id', v_case.assigned_operator_user_id, 'category', v_case.category,
    'severity', v_case.severity, 'status', v_case.status, 'resolution_code', v_case.resolution_code,
    'host_summary', v_case.host_summary, 'opened_at', v_case.opened_at, 'updated_at', v_case.updated_at,
    'resolved_at', v_case.resolved_at, 'events', v_events);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.get_operator_case(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.get_operator_case(text) TO authenticated;

CREATE FUNCTION api.get_operator_case(p_case_ref text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.get_operator_case(p_case_ref);
$$;

REVOKE ALL ON FUNCTION api.get_operator_case(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.get_operator_case(text) TO authenticated;

COMMENT ON FUNCTION internal_api.get_operator_case(text) IS
  'Scope `support`, STABLE. The whole thread, all five arms, including the internal notes no host read '
  'returns. The wider projection is deliberate and §12 keeps it boring: uuids, statuses, timestamps and '
  'bounded text that somebody already wrote into this case.';

COMMENT ON FUNCTION api.get_operator_case(text) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.get_operator_case. Authenticated only.';

CREATE FUNCTION internal_api.operator_add_case_note(
  p_case_ref text,
  p_kind text,
  p_body text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_case private.support_cases;
  v_seen private.support_case_events;
  v_seq integer;
BEGIN
  v_caller := auth.uid();
  IF NOT private.actor_is_operator('support') THEN
    RAISE EXCEPTION 'the caller may not add a note to this support case'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('message_host', 'message_operator') THEN
    RAISE EXCEPTION 'a case note is either message_host, which the requester can read, or '
      'message_operator, which they cannot; % is neither, and the arm is what the read surface filters on',
      coalesce(quote_literal(p_kind), 'NULL') USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'a note requires an idempotency key' USING ERRCODE = 'check_violation';
  END IF;
  IF p_body IS NULL OR length(btrim(p_body)) = 0 THEN
    RAISE EXCEPTION 'a note must say something' USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_body) > 4000 THEN
    RAISE EXCEPTION 'a note must fit in 4000 characters, got %', length(p_body)
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.* INTO v_case FROM private.support_cases c WHERE c.case_ref = btrim(p_case_ref)
    FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the caller may not add a note to this support case'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT e.* INTO v_seen FROM private.support_case_events e
   WHERE e.case_id = v_case.id AND e.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_seen.kind <> p_kind THEN
      RAISE EXCEPTION 'this idempotency key already carries a % row on this case: one key is one action',
        v_seen.kind USING ERRCODE = 'check_violation';
    END IF;
    RETURN jsonb_build_object('case_ref', v_case.case_ref, 'kind', v_seen.kind, 'seq', v_seen.seq,
                              'replayed', true);
  END IF;

  IF v_case.status = 'closed' THEN
    RAISE EXCEPTION 'a closed support case takes no further rows: an internal note about it belongs on '
      'the ticket that reopened the question' USING ERRCODE = 'check_violation';
  END IF;

  -- No `audit_events` row, deliberately (§4's payload discipline in the only direction that matters
  -- here): a note's content *is* the record, it lives on the case, and copying caller text into the
  -- trail would put a pasted guest roster into the column §9's health block aggregates.
  INSERT INTO private.support_case_events
      (case_id, kind, actor_user_id, actor_kind, body, idempotency_key, created_at)
    VALUES (v_case.id, p_kind, v_caller, 'operator', btrim(p_body), p_idempotency_key, now())
  RETURNING seq INTO v_seq;

  RETURN jsonb_build_object('case_ref', v_case.case_ref, 'kind', p_kind, 'seq', v_seq,
                            'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.operator_add_case_note(text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.operator_add_case_note(text, text, text, uuid) TO authenticated;

CREATE FUNCTION api.operator_add_case_note(
  p_case_ref text,
  p_kind text,
  p_body text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.operator_add_case_note(p_case_ref, p_kind, p_body, p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION api.operator_add_case_note(text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.operator_add_case_note(text, text, text, uuid) TO authenticated;

COMMENT ON FUNCTION internal_api.operator_add_case_note(text, text, text, uuid) IS
  'Scope `support`. Two arms: `message_host` reaches the requester, `message_operator` never does. Refuses '
  'a closed case and an unknown arm, and writes no audit row — the note is the record.';

COMMENT ON FUNCTION api.operator_add_case_note(text, text, text, uuid) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.operator_add_case_note. Authenticated only.';

CREATE FUNCTION internal_api.operator_claim_case(
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
    RAISE EXCEPTION 'the caller may not claim this support case' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'a claim requires an idempotency key: two clicks on one ticket must produce one claim'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.* INTO v_case FROM private.support_cases c WHERE c.case_ref = btrim(p_case_ref)
    FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the caller may not claim this support case' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT e.* INTO v_seen FROM private.support_case_events e
   WHERE e.case_id = v_case.id AND e.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_seen.kind <> 'assignment' THEN
      RAISE EXCEPTION 'this idempotency key already carries a % row on this case: one key is one action',
        v_seen.kind USING ERRCODE = 'check_violation';
    END IF;
    -- Claim and release share one event kind, so the ticket's own history cannot say which of the two the
    -- key bought, and answering a claim with a release's recorded result would be slice 1's "refusal that
    -- reports success" again. The trail row's `action` is the record of the act, and slice 1's partial
    -- unique index on `idempotency_key` means one lookup finds it or finds nothing.
    SELECT a.id, a.action INTO v_audit_id, v_action FROM private.audit_events a
     WHERE a.idempotency_key = p_idempotency_key::text;
    IF v_action IS DISTINCT FROM 'case_claimed' THEN
      RAISE EXCEPTION 'this idempotency key already carries the % act on the trail: one key is one action',
        coalesce(quote_literal(v_action), 'an unknown act') USING ERRCODE = 'check_violation';
    END IF;
    RETURN jsonb_build_object('case_ref', v_case.case_ref,
                              'assigned_operator_user_id', v_case.assigned_operator_user_id,
                              'seq', v_seen.seq, 'audit_id', v_audit_id, 'replayed', true);
  END IF;

  IF v_case.status = 'closed' THEN
    RAISE EXCEPTION 'a closed support case is not rewritten, and claiming it is a rewrite'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_case.assigned_operator_user_id = v_caller THEN
    RAISE EXCEPTION 'this case is already claimed by the caller' USING ERRCODE = 'check_violation';
  END IF;
  -- This refusal is the reason there are two verbs instead of one that takes a name. An operator may not
  -- move a ticket onto somebody else's queue, so handover is release and then claim: two acts, each with
  -- its own actor on the history, and neither of them an identity argument a caller could point anywhere.
  IF v_case.assigned_operator_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'another operator holds this case: it has to be released before it can be claimed'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE private.support_cases c
     SET assigned_operator_user_id = v_caller
   WHERE c.id = v_case.id;

  INSERT INTO private.support_case_events
      (case_id, kind, actor_user_id, actor_kind, idempotency_key, created_at)
    VALUES (v_case.id, 'assignment', v_caller, 'operator', p_idempotency_key, now())
  RETURNING seq INTO v_seq;

  -- The trail row names the decision, not the prose: a reason built from the act itself keeps §4's promise
  -- that no body copies caller text into an audit column, and the state columns carry the before and after
  -- an incident review asks for.
  INSERT INTO private.audit_events
      (wedding_id, subject_type, subject_key, action, actor_user_id, actor_kind, reason,
       payload, before_state, after_state, idempotency_key)
    VALUES (v_case.wedding_id, 'support_case', v_case.id, 'case_claimed', v_caller, 'operator',
            'support case ' || v_case.case_ref || ' claimed by the operator on the call: the decision, '
              'the actor and both states are recorded here and on the ticket',
            jsonb_build_object('case_ref', v_case.case_ref, 'wedding_id', v_case.wedding_id),
            jsonb_build_object('assigned_operator_user_id', v_case.assigned_operator_user_id),
            jsonb_build_object('assigned_operator_user_id', v_caller),
            p_idempotency_key::text)
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object('case_ref', v_case.case_ref,
                            'assigned_operator_user_id', v_caller,
                            'seq', v_seq, 'audit_id', v_audit_id, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.operator_claim_case(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.operator_claim_case(text, uuid) TO authenticated;

CREATE FUNCTION api.operator_claim_case(p_case_ref text, p_idempotency_key uuid)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.operator_claim_case(p_case_ref, p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION api.operator_claim_case(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.operator_claim_case(text, uuid) TO authenticated;

COMMENT ON FUNCTION internal_api.operator_claim_case(text, uuid) IS
  'Scope `support`. Takes the case for the calling account — `auth.uid()`, never an argument — and refuses '
  'a ticket another operator already holds, so no browser-reachable callable names an identity and nobody '
  'receives work they did not ask for. Writes one assignment row on the case and one trail row named '
  '`case_claimed`.';

COMMENT ON FUNCTION api.operator_claim_case(text, uuid) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.operator_claim_case. Authenticated only.';

CREATE FUNCTION internal_api.operator_release_case(
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

CREATE FUNCTION api.operator_release_case(p_case_ref text, p_idempotency_key uuid)
RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.operator_release_case(p_case_ref, p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION api.operator_release_case(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.operator_release_case(text, uuid) TO authenticated;

COMMENT ON FUNCTION internal_api.operator_release_case(text, uuid) IS
  'Scope `support`. Clears the calling account''s own claim and refuses to clear anybody else''s. Writes '
  'one assignment row on the case and one trail row named `case_released`.';

COMMENT ON FUNCTION api.operator_release_case(text, uuid) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.operator_release_case. Authenticated only.';

CREATE FUNCTION internal_api.operator_transition_case(
  p_case_ref text,
  p_to_status text,
  p_resolution_code text,
  p_body text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller uuid;
  v_case private.support_cases;
  v_after private.support_cases;
  v_seen private.support_case_events;
  v_seq integer;
  v_audit_id bigint;
  v_from text;
BEGIN
  v_caller := auth.uid();
  IF NOT private.actor_is_operator('support') THEN
    RAISE EXCEPTION 'the caller may not change this support case' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_to_status IS NULL OR p_to_status NOT IN ('open', 'triaged', 'awaiting_information',
                                                'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'unknown support status %', coalesce(quote_literal(p_to_status), 'NULL')
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'a status change requires an idempotency key' USING ERRCODE = 'check_violation';
  END IF;
  -- The body states the table's own rule because the body's sentence is what an operator reads, and
  -- because the two refusals are different: a code on a live ticket is a claim about an ending that has
  -- not happened.
  IF p_to_status IN ('resolved', 'closed') THEN
    IF p_resolution_code IS NULL THEN
      RAISE EXCEPTION 'entering % requires a resolution code from the six: resolved_by_operator, '
        'host_withdrew, no_action_needed, duplicate, out_of_scope, event_cancelled — and none of them '
        'says money moved, because nothing here can',
        p_to_status USING ERRCODE = 'check_violation';
    END IF;
    IF p_resolution_code NOT IN ('resolved_by_operator', 'host_withdrew', 'no_action_needed',
                                 'duplicate', 'out_of_scope', 'event_cancelled') THEN
      RAISE EXCEPTION 'unknown resolution code %', quote_literal(p_resolution_code)
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF p_resolution_code IS NOT NULL THEN
    RAISE EXCEPTION 'a resolution code belongs to resolved or closed, and this case is going to %',
      p_to_status USING ERRCODE = 'check_violation';
  END IF;
  IF p_body IS NOT NULL AND (length(btrim(p_body)) = 0 OR length(p_body) > 4000) THEN
    RAISE EXCEPTION 'a transition message is either real text or absent, and % characters is neither',
      length(coalesce(p_body, '')) USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.* INTO v_case FROM private.support_cases c WHERE c.case_ref = btrim(p_case_ref)
    FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the caller may not change this support case' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- `open` is reachable by nothing that takes this argument: every edge into it is refused, and the only
  -- door that produces it is the host's own. Refused here rather than left to the trigger so the sentence
  -- is about the intent.
  IF p_to_status = 'open' THEN
    RAISE EXCEPTION 'a case may not be moved back to open: the lifecycle has no such edge, and a ticket '
      'that was picked up is reopened to in_progress rather than returned to the queue as if nobody saw '
      'it' USING ERRCODE = 'check_violation';
  END IF;

  SELECT e.* INTO v_seen FROM private.support_case_events e
   WHERE e.case_id = v_case.id AND e.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_seen.kind <> 'status' THEN
      RAISE EXCEPTION 'this idempotency key already carries a % row on this case: one key is one action, '
        'and answering a transition with the earlier row''s recorded result would be a refusal that '
        'reports success', v_seen.kind USING ERRCODE = 'check_violation';
    END IF;
    SELECT a.id INTO v_audit_id FROM private.audit_events a
     WHERE a.idempotency_key = p_idempotency_key::text
     LIMIT 1;
    RETURN jsonb_build_object('case_ref', v_case.case_ref, 'from_status', v_seen.from_status,
                              'to_status', v_seen.to_status, 'seq', v_seen.seq,
                              'audit_id', v_audit_id, 'replayed', true);
  END IF;

  -- A double click that arrives after the first one landed has no edge to walk: `resolved → resolved` is
  -- not in the table, and saying so here is a sentence about the caller's own stale tab rather than the
  -- trigger's generic pair.
  IF p_to_status = v_case.status THEN
    RAISE EXCEPTION 'this case is already %: a second delivery of the same transition is refused rather '
      'than absorbed, because the thread would then hold two rows claiming one change', p_to_status
      USING ERRCODE = 'check_violation';
  END IF;

  v_from := v_case.status;

  -- The UPDATE below may refuse for a reason this body did not compute, and that is the design: the edge
  -- table lives in one place (`support_cases_guard_update`), so a stale tab, a double click and a
  -- hand-written UPDATE meet the same sentence, and a body that duplicated the edges could drift from it.
  UPDATE private.support_cases c
     SET status = p_to_status, resolution_code = p_resolution_code
   WHERE c.id = v_case.id;

  -- Read back after the trigger has had its say, so the trail's `after_state` is the row's own answer and
  -- not the state the body intended — the instant a transition is stamped by the database, and a body
  -- that reported its own intention would be reporting a guess.
  SELECT c.* INTO v_after FROM private.support_cases c WHERE c.id = v_case.id;

  -- The decision carries the key; the optional message to the host rides behind it, keyless, so one call
  -- can write two rows without either of them claiming to be the idempotent one twice.
  INSERT INTO private.support_case_events
      (case_id, kind, actor_user_id, actor_kind, from_status, to_status, idempotency_key, created_at)
    VALUES (v_case.id, 'status', v_caller, 'operator', v_from, p_to_status, p_idempotency_key, now())
  RETURNING seq INTO v_seq;

  IF p_body IS NOT NULL THEN
    INSERT INTO private.support_case_events
        (case_id, kind, actor_user_id, actor_kind, body, created_at)
      VALUES (v_case.id, 'message_host', v_caller, 'operator', btrim(p_body), now());
  END IF;

  INSERT INTO private.audit_events
      (wedding_id, subject_type, subject_key, action, actor_user_id, actor_kind, reason,
       payload, before_state, after_state, idempotency_key)
    VALUES (v_case.wedding_id, 'support_case', v_case.id, 'status_changed', v_caller, 'operator',
            'support case ' || v_case.case_ref || ' moved ' || v_from || ' to ' || p_to_status ||
              coalesce(' as ' || p_resolution_code, ''),
            jsonb_build_object('case_ref', v_case.case_ref, 'wedding_id', v_case.wedding_id),
            jsonb_build_object('status', v_from, 'resolution_code', v_case.resolution_code,
                               'resolved_at', v_case.resolved_at,
                               'assigned_operator_user_id', v_case.assigned_operator_user_id),
            jsonb_build_object('status', v_after.status, 'resolution_code', v_after.resolution_code,
                               'resolved_at', v_after.resolved_at,
                               'assigned_operator_user_id', v_after.assigned_operator_user_id),
            p_idempotency_key::text)
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object('case_ref', v_case.case_ref, 'from_status', v_from,
                            'to_status', v_after.status, 'seq', v_seq, 'audit_id', v_audit_id,
                            'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.operator_transition_case(text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION internal_api.operator_transition_case(text, text, text, text, uuid)
  TO authenticated;

CREATE FUNCTION api.operator_transition_case(
  p_case_ref text,
  p_to_status text,
  p_resolution_code text,
  p_body text,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT internal_api.operator_transition_case(p_case_ref, p_to_status, p_resolution_code, p_body,
                                               p_idempotency_key);
$$;

REVOKE ALL ON FUNCTION api.operator_transition_case(text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION api.operator_transition_case(text, text, text, text, uuid) TO authenticated;

COMMENT ON FUNCTION internal_api.operator_transition_case(text, text, text, text, uuid) IS
  'Scope `support`. Refuses an unknown target, a `resolved`/`closed` with no resolution code, a code on a '
  'live status, a blank or oversized message, a keyless call and any route back into `open`. Which edges '
  'exist is the trigger''s answer, not this body''s, so the table of transitions is in exactly one place. '
  'Writes the status row, an optional message row and one audit row carrying both states.';

COMMENT ON FUNCTION api.operator_transition_case(text, text, text, text, uuid) IS
  'SECURITY INVOKER wrapper: one delegation to internal_api.operator_transition_case. Authenticated only.';

-- ===========================================================================
-- 6. What this file leaves behind
-- ===========================================================================
-- Nothing else. No row is inserted, no policy is created, and the `private` schema's own comment stays
-- where Stage 2 put it: this file adds two tables and ten pairs of names to a schema that already says
-- it is not exposed, and rewriting another stage's description of that fact would be a claim about a
-- schema rather than about this slice.
