-- Stage 11 / file 1 of 5 — operator authority and one hardened audit trail.
--
-- Written against `docs/architecture/operations-admin-security.md` §3 and §4; the section numbers below
-- refer to that document, which is the reviewable statement of *why* each object is shaped this way.
-- Nothing in this file grants authority to anybody: it creates the table that authority would live in,
-- the predicate that reads it, and the two bodies that write it, and it inserts zero rows. After the
-- full chain runs, `select count(*) from private.operator_grants` is 0 and every operational surface in
-- later Stage 11 files answers "no" to everybody, including the person who deployed it.
--
-- ---------------------------------------------------------------------------
-- What was measured before this file was written, because §3 and §4 were drafted from the design and
-- the design was drafted from reading, and two of its posture claims turned out to be wrong.
--
--   1. The service-only precedent is SECURITY INVOKER, not DEFINER. `internal_api` held 39 names at the
--      Stage 10 head, and 17 of them are `prosecdef = f` bodies whose EXECUTE is false for
--      `service_role`, `anon` *and* `authenticated` — the six commerce writers plus the eleven pack
--      maintenance bodies. `20261017120000_stage10_commerce_foundations.sql:784-838` is the shape:
--      `LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''`, then `REVOKE ALL … FROM PUBLIC, anon,
--      authenticated, service_role` and no grant afterwards. So `grant_operator_role` and
--      `revoke_operator_role` follow that precedent rather than the definer one §10's preamble asserted,
--      and the design document is corrected in the same commit as this file. The distinction is not
--      cosmetic: an INVOKER body sees exactly what its caller sees, so the pair cannot accidentally read
--      more than the trusted console can, and its reachability is a property of the *role*, which is the
--      thing §3 needs.
--
--   2. `private` held 37 functions, every one of them `f|f|f` for (anon, authenticated, service_role)
--      EXECUTE, and exactly three were `SECURITY DEFINER`. §3 needed "the one predicate every
--      operational body calls" to read `auth.uid()` while the *caller* is an API role that holds no
--      privilege on `private.operator_grants` at all. A SECURITY INVOKER predicate would raise
--      `permission denied for table operator_grants` inside the wrapper rather than answering `false`, so
--      it is the fourth definer — the same forced choice `20261017120000…` records for
--      `private.guard_publication_commerce_gate`, and for the same reason. Its privilege is used for one
--      indexed read of one table and it writes nothing.
--
--   3. Hardening the audit trail breaks nothing that exists. Repository-wide there is not one `UPDATE`
--      of `private.audit_events` — in a migration, a test, a script or the product — and the four
--      `DELETE` statements that do exist (`stage10/90_commerce_functions.sql:1120`, `:1184`, and the three
--      HTTP teardowns) are all issued as `postgres` over the peer-authenticated in-container channel,
--      which neither the revocation below nor `reject_client_delete`'s trusted branch touches. So
--      `service_role` can lose UPDATE and DELETE here at no cost.
--
--      What that cost-free revocation does *not* do is move `40_catalog.sql` C15, which this file first
--      predicted would fall from 22 to 21. C15 counts tables where
--      `has_table_privilege('service_role', oid, 'SELECT, INSERT, UPDATE, DELETE')` answers true, and that
--      four-privilege string was then measured on a chain that had run the revocation: for
--      `private.audit_events` the list form answers `t` while the single-privilege forms answer
--      `SELECT t / INSERT t / UPDATE f / DELETE f`. The list form is an ANY-of test, not an ALL-of one, so
--      C15 still reads 22 and would have read 22 had the key lost three of the four privileges instead of
--      two. The number was therefore never the alarm it was being used as, and no branch is added to it —
--      a stage that widened a count to accommodate a revocation it could not see would be measuring the
--      count, not the grant. The revocation is asserted where the instrument actually asks privilege by
--      privilege: `supabase/tests/stage11/80_operator_authority.sql` cells A08 and AI02, which also state
--      the residue rather than hiding it — INSERT survives, so a leaked key may still append a row, and
--      that limit is measured as AI11 instead of being left to the reader who assumes 21.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. The grant table (§3)
-- ===========================================================================

-- Operational authority is data with an owner, a scope, a reason and an end, because that is the only
-- form in which "this person may take a wedding down until the 31st, because of case SV-XXXX" is
-- answerable afterwards. A word in `public.user_roles` cannot carry any of it, and `user_roles` is a
-- REST-addressable table whose one policy lets an account read its own row (§2), so authority kept there
-- is authority every signed-in customer can probe about themselves.
CREATE TABLE private.operator_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The account, never a name or an email. ON DELETE CASCADE is the only deliberate exception in this
  -- schema to "every FK to auth.users is SET NULL" (§12): an erased account must not leave a *live*
  -- operational grant pointing at nothing. Everywhere else, null-ing the attribution keeps the evidence;
  -- here, keeping a credential whose subject no longer exists would be the failure, not the cost.
  -- A cascade runs as the child table's owner, so `reject_client_write` below cannot see it (the general
  -- rule C35 exists to state) — which is another way of saying the same fact the FK choice makes: after
  -- the account goes, the grant goes, and no guard stands in the way.
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Four scopes, one per duty, as a CHECK list rather than an enum: widening the set of duties is one
  -- forward migration, and a shared type would be inheritable by a column nobody has reviewed yet.
  scope text NOT NULL
    CHECK (scope IN ('support', 'operations', 'finance_review', 'privacy')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  -- §3's third reason for not using a role word: a grant without a reason is a permanent credential with
  -- no account of why it exists. Bounded, because this text is echoed into the operator console and an
  -- unbounded column turns a UI into a place to park a wall of prose.
  reason text NOT NULL
    CHECK (length(btrim(reason)) > 0 AND length(reason) <= 500),
  -- Attribution, not proof. This is set from the actor the trusted caller names, and the caller is
  -- already able to write this table by hand, so the column records *whom the console said was deciding*
  -- — it cannot authenticate them. That is the same distinction C29c-b draws for `p_actor_user_id`, and
  -- the reason ON DELETE SET NULL rather than CASCADE: the granter's own erasure must not delete the
  -- record of a grant they made. There is deliberately no table CHECK requiring this to be non-null,
  -- because that would make erasing the granter's account fail on an unrelated rule mid-cascade.
  granted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  -- NULL means "no expiry was chosen", which §17 leaves to the owner; a chosen expiry must be in the
  -- future, so a grant cannot be minted already-dead or back-dated into validity.
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 'revoked' means exactly one timestamp and nothing else, in both directions. A status that can be set
  -- without its instant is a status a writer can lie with.
  CONSTRAINT operator_grants_revoked_pair_check
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT operator_grants_expiry_after_grant_check
    CHECK (expires_at IS NULL OR expires_at > granted_at),
  CONSTRAINT operator_grants_revoke_after_grant_check
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

-- One live grant per account per scope, enforced where a race can actually hit. The console refuses a
-- duplicate before this fires (with a sentence naming the grant that is already live), and this index is
-- what makes that refusal true when two consoles run at once — the pattern the ledger uses for one live
-- order per wedding and package. A *second* grant after a revocation is legal and is a new row: the
-- history of "granted, revoked, re-granted with a different reason" is the thing an operator review
-- needs, and an UPDATE in place would erase it.
CREATE UNIQUE INDEX operator_grants_active_uniq
  ON private.operator_grants (user_id, scope) WHERE status = 'active';

-- `granted_by_user_id` is left unindexed, on purpose and by name in C48: it is attribution, never a query
-- key, and the only FK check an index here would serve is the DELETE of a granter's account, which
-- nulls this column across a table that is a handful of rows. `user_id` is covered by the leading column
-- of the partial unique index above, so the cascade that matters — erasing an operator — is an index
-- probe.

CREATE TRIGGER set_updated_at BEFORE UPDATE ON private.operator_grants
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER operator_grants_no_client_write BEFORE INSERT OR UPDATE ON private.operator_grants
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_write();
CREATE TRIGGER operator_grants_no_client_delete BEFORE DELETE ON private.operator_grants
  FOR EACH ROW EXECUTE FUNCTION private.reject_client_delete();

ALTER TABLE private.operator_grants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.operator_grants FROM PUBLIC;

COMMENT ON TABLE private.operator_grants IS
  'The only source of Stage 11 operational authority: four scopes, one live grant per account per scope, '
  'a required reason, an optional expiry, and a revocation that is a status write on the same row. Created '
  'EMPTY. No client role holds a privilege on it and it has RLS with no policy, so the only writers are '
  'internal_api.grant_operator_role and internal_api.revoke_operator_role, both of which are executable by '
  'no role at all and are reached from the trusted console.';

-- ===========================================================================
-- 2. The predicate every operational body calls (§3)
-- ===========================================================================

CREATE FUNCTION private.actor_is_operator(p_scope text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = ''
AS $$
BEGIN
  -- An unknown scope answers `false` rather than raising. The caller is mid-authorisation, and a
  -- refusal that leaks which four strings this table accepts is a worse answer than the one that
  -- declines the request; the vocabulary is a CHECK on the row, not a secret.
  IF p_scope IS NULL OR p_scope NOT IN ('support', 'operations', 'finance_review', 'privacy') THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM private.operator_grants g
     WHERE g.user_id = auth.uid()
       AND g.scope = p_scope
       AND g.status = 'active'
       AND (g.expires_at IS NULL OR g.expires_at > now())
  );
END;
$$;

REVOKE ALL ON FUNCTION private.actor_is_operator(text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.actor_is_operator(text) IS
  'SECURITY DEFINER because an API role holds no privilege on private.operator_grants and an INVOKER '
  'predicate would raise instead of answering false. Reads auth.uid() and never an argument, so a caller '
  'cannot ask whether somebody else is an operator. Granted to no role: it is called from inside the '
  'definer bodies that need it, and the trusted console can already read the table. An expired or revoked '
  'grant answers false, and so does every caller with no session — including the psql path, which is why '
  'granting authority cannot itself require authority.';

-- ===========================================================================
-- 3. The one audit trail, hardened in place (§4)
-- ===========================================================================

-- Five columns, each nullable or defaulted, so the 29 existing `INSERT INTO private.audit_events` sites
-- written across the five Stage 10 migrations keep working without one character of change — which is the
-- only reason this is an ALTER rather than a new table. A new row that sets none of these is a machine
-- row (`actor_kind` defaults to 'system'), and that is the truthful default: the ledger does not decide
-- anything about a human.
ALTER TABLE private.audit_events ADD COLUMN actor_kind text NOT NULL DEFAULT 'system';
ALTER TABLE private.audit_events ADD COLUMN reason text;
ALTER TABLE private.audit_events ADD COLUMN idempotency_key text;
ALTER TABLE private.audit_events ADD COLUMN before_state jsonb;
ALTER TABLE private.audit_events ADD COLUMN after_state jsonb;

-- Four values, and the fourth is the reason this migration exists at all. A human acting through the
-- trusted console has no session and therefore no `actor_role` that means anything, so calling that row
-- 'system' would erase the one fact an incident review asks for — whether a person or a process decided
-- this. `maintenance` is the console's kind; it is not a privilege, and it does not appear anywhere in
-- the scopes an account can be granted.
ALTER TABLE private.audit_events
  ADD CONSTRAINT audit_events_actor_kind_vocab_check
  CHECK (actor_kind IN ('system', 'operator', 'host', 'maintenance'));

-- "A human decision with no stated reason" is unrepresentable rather than discouraged. The pairing is what
-- makes the column worth reading: a trail that says *someone* took a wedding down, with no name and no why,
-- is decoration with a timestamp.
--
-- `coalesce` in this one is load-bearing and was not there originally: `length(btrim(NULL))` is NULL,
-- `NULL > 0` is NULL, and a CHECK passes on NULL. Measured by battery 1 cell AI15, which planted a
-- human-kind row with a NULL reason and watched it be accepted.
ALTER TABLE private.audit_events
  ADD CONSTRAINT audit_events_human_action_has_reason_check
  CHECK (actor_kind = 'system' OR coalesce(length(btrim(reason)), 0) > 0);
-- The sibling rule — "a human row must name a human" — is written below as an INSERT guard rather than as a
-- table CHECK, and the reason is measured rather than preferred: the deletion of an account is carried out
-- on this table as an UPDATE that nulls `actor_user_id` (`ON DELETE SET NULL` has no other implementation),
-- and a table CHECK fires on that UPDATE too. Kept as a CHECK, the anti-forgery rule would therefore not
-- merely forbid a forged row, it would make every account that ever acted undeletable — §12's "the
-- recording row keeps its attribution null and survives" would be unreachable. `q11-logs/s11-probe-depth-1.txt`
-- measures the nulling against both shapes. As an INSERT guard the rule is exactly as strong where it is a
-- rule about *writing* (no body, and no hand, can create a human row that names nobody) and it stops
-- pretending to be a rule about *rewriting*, which the trigger below already forbids outright.

ALTER TABLE private.audit_events
  ADD CONSTRAINT audit_events_reason_is_bounded_check
  CHECK (reason IS NULL OR (length(btrim(reason)) > 0 AND length(reason) <= 500));
ALTER TABLE private.audit_events
  ADD CONSTRAINT audit_events_idempotency_key_is_bounded_check
  CHECK (idempotency_key IS NULL
         OR (length(btrim(idempotency_key)) > 0 AND length(idempotency_key) <= 200));
-- Objects, not arrays and not scalars, because `before_state`/`after_state` are projections built
-- field-by-field inside each body, and a body that could hand back a list of whole rows would be a body
-- that can hand back a column nobody meant to expose.
ALTER TABLE private.audit_events
  ADD CONSTRAINT audit_events_before_state_is_object_check
  CHECK (before_state IS NULL OR jsonb_typeof(before_state) = 'object');
ALTER TABLE private.audit_events
  ADD CONSTRAINT audit_events_after_state_is_object_check
  CHECK (after_state IS NULL OR jsonb_typeof(after_state) = 'object');

-- The replay defence §4 names: one operator action delivered twice writes one row, because the second
-- delivery finds this index. It is partial so the ordinary machine row — the ledger's `quote_created`,
-- the guest mint, all 29 of the existing sites — keeps its NULL and stays unconstrained, exactly as the
-- commerce ledger's own identity index works.
CREATE UNIQUE INDEX audit_events_one_row_per_idempotency_key
  ON private.audit_events (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- The revocation. `service_role` keeps SELECT and INSERT: a leaked server key can still read the trail
-- it needs to diagnose with, and the Stage 10 bodies that append evidence to it keep working. What it
-- loses is the power to *rewrite* — and the honest limit of that sentence is stated in §4's repair and
-- measured by cell AI-RESIDUE below: appending a row that never happened is still possible for that key,
-- and closing *that* needs an anchor this stage does not build.
REVOKE UPDATE, DELETE ON private.audit_events FROM service_role;

-- The absolute refusal, and the one thing it cannot refuse.
--
-- Stage 10's `private.reject_any_update()` is the body the payment ledger uses (`20261017120000…:29-43`):
-- it raises for every role, `postgres` and `supabase_admin` included. Attaching it here was right about the
-- rewrite and wrong about the *link*, and the difference is measurable rather than arguable: an
-- `ON DELETE SET NULL` foreign key is implemented by Postgres as an UPDATE on the referencing row, so the
-- very first thing the guard did on this table was refuse the database's own referential action.
-- `q11-logs/s11-probe-fk-null-1.txt` cell M3 deleted a wedding that one trail row names and heard
-- "rows are append-only" out of `private.reject_any_update()` — the trail's `wedding_id` is declared SET
-- NULL (§12: the row survives its wedding, because a trail that vanishes with the object it describes is
-- the hole an incident review cannot read back), and the declaration was decoration.
--
-- So the refusal is specialised rather than relaxed. It compares the two rows by *exclusion*: everything
-- that is not one of the two attribution links must be identical, which means a column a later slice adds
-- is refused by default instead of needing this body to be remembered. What is then allowed through is
-- narrow twice over: the link must be going to NULL, and the statement must be arriving from inside
-- another trigger.
--
-- The second of those is the one that took a measurement to get right. The obvious test — "is the parent
-- row already gone" — is wrong, and wrong quietly: Postgres fires the referential action from the parent's
-- AFTER ROW trigger, *inside the deleting command*, and a command cannot see its own in-flight deletion,
-- so `NOT EXISTS (… auth.users …)` answers FALSE for exactly the rows this exception exists for.
-- `q11-logs/s11-probe-ri-cells2-1.txt` measures that: every account and wedding delete issued through the
-- SET NULL edges still refused with the parent-existence test in place. `pg_trigger_depth()` is the signal
-- that does discriminate — 1 for a statement a caller or a body issued, 2 for the UPDATE the database
-- issues for its own key, and the first two cells of `q11-logs/s11-probe-depth-1.txt` show the nulling
-- landing under it. It is not caller-reachable: no role that can issue a statement against this table can
-- also install a trigger on it, and every door that writes here is a function, not a trigger, so a body
-- aiming at the hole finds depth 1 and the same sentence as before.
CREATE FUNCTION private.reject_audit_update_except_referential_null() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
BEGIN
  IF (v_new - 'actor_user_id' - 'wedding_id')
     IS DISTINCT FROM (v_old - 'actor_user_id' - 'wedding_id') THEN
    RAISE EXCEPTION '%.% rows are append-only: a correction is a new row and an audit event, never a rewrite',
      TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
     AND (NEW.actor_user_id IS NOT NULL OR pg_trigger_depth() < 2) THEN
    RAISE EXCEPTION '%.% rows are append-only: a correction is a new row and an audit event, never a rewrite',
      TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.wedding_id IS DISTINCT FROM OLD.wedding_id
     AND (NEW.wedding_id IS NOT NULL OR pg_trigger_depth() < 2) THEN
    RAISE EXCEPTION '%.% rows are append-only: a correction is a new row and an audit event, never a rewrite',
      TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_audit_update_except_referential_null()
  FROM PUBLIC, anon, authenticated, service_role;

-- The anti-forgery rule, stated where it actually holds: at the moment the row is written. Same vocabulary,
-- same refusal class, same SQLSTATE a table CHECK would have used (23514), so the error-handling surface
-- cannot tell the two apart and neither can a test that asserts the state rather than the object.
CREATE FUNCTION private.reject_audit_human_row_without_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.actor_kind <> 'system' AND NEW.actor_user_id IS NULL THEN
    RAISE EXCEPTION 'an audit event whose actor_kind is % must name the account that acted: a human '
      'decision recorded as having no author is the forgery this column exists to prevent',
      NEW.actor_kind USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_audit_human_row_without_actor()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.reject_any_update() IS
  'BEFORE UPDATE guard with no trusted branch: refuses every role, including the owner. Attached to the '
  'payment ledger alone. `private.audit_events` needed the same posture with one hole big enough for the '
  'database''s own referential action and no bigger, and took its own body instead — see '
  'reject_audit_update_except_referential_null.';

COMMENT ON FUNCTION private.reject_audit_update_except_referential_null() IS
  'BEFORE UPDATE guard on the audit trail with no trusted branch: refuses every rewrite by every role, '
  'including the owner, by comparing every column except the two attribution links. A link may move only to '
  'NULL and only from inside another trigger, which is the signature of an ON DELETE SET NULL referential '
  'action and nothing else — a caller cannot install a trigger here, and a door is a function, not a '
  'trigger, so it arrives at depth 1 and is refused. SECURITY INVOKER, like every other guard here: a '
  'definer deciding who may rewrite an audit row is a guard with a privilege of its own to use.';

COMMENT ON FUNCTION private.reject_audit_human_row_without_actor() IS
  'BEFORE INSERT guard on the audit trail: a row whose actor_kind is a human kind must name an account. '
  'Deliberately an INSERT guard rather than a table CHECK because the deletion of the named account is '
  'carried out on this table as an UPDATE that nulls the link, and a CHECK would refuse that too and make '
  'every account that ever acted undeletable. Refuses with 23514, the state a CHECK would have used.';

-- Two BEFORE UPDATE triggers now exist on this table, and they fire in trigger-name collation order, so
-- `audit_append_only_no_update` runs first and returns NEW for a trusted role, and
-- `audit_no_update_any_role` then refuses it. The observable result is deterministic and measured by the
-- battery: a client role that somehow held the grant would hear the guard's sentence, a trusted role hears
-- "a correction is a new row and an audit event, never a rewrite", and after the revocation every client
-- role in fact hears `permission denied for table audit_events` before any trigger runs — which is why the
-- revocation, not the trigger, is the load-bearing half, and the trigger is what stops `postgres` from
-- being the exception.
CREATE TRIGGER audit_no_update_any_role BEFORE UPDATE ON private.audit_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_audit_update_except_referential_null();

CREATE TRIGGER audit_human_row_names_a_human BEFORE INSERT ON private.audit_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_audit_human_row_without_actor();

-- DELETE is left refused for client roles by `reject_client_delete` and is still permitted for the
-- trusted roles. That is a boundary this file does not move: every existing teardown in this repository
-- deletes its own synthetic rows this way, and a trail that can never be pruned is a trail nobody can
-- run a retention policy against (Stage 13's decision, §17 item 4). What changed here is *who* may do it:
-- the server key no longer can.
COMMENT ON TABLE private.audit_events IS
  'The one audit trail. Append-only for every role on UPDATE (audit_no_update_any_role refuses postgres '
  'too, and permits only an attribution link the database is nulling from inside its own referential '
  'trigger) and ungranted for UPDATE and DELETE to service_role; DELETE remains reachable only from the '
  'trusted roles. A human row must name a human and state a reason — the reason as a table CHECK, the '
  'actor as a BEFORE INSERT guard so that the nulling which carries out the account''s deletion is not '
  'refused by a rule that was only ever about writing. An operator action is replay-protected by a partial '
  'unique idempotency key, and before_state/after_state are object-only projections built inside the '
  'writing body. actor_user_id remains a caller-named column on the two service-only bodies and is '
  'auth.uid()-derived everywhere else — see C29c-b for why that is attribution rather than a privilege.';

-- ===========================================================================
-- 4. The two bodies that write authority — reachable by nobody (§3)
-- ===========================================================================

-- Both are SECURITY INVOKER with zero EXECUTE grants, the 17-body posture measured in the preamble. There
-- is no `api` wrapper for either and there never will be: a wrapper would be a browser asking to be an
-- operator, which is the one thing §3 exists to make impossible. They are reached from the trusted
-- console channel (`scripts/stage11-operations-cli.mjs`, §11) and from `psql` as `postgres`, which is the
-- same channel `tradition-pack-admin.mjs` and the Stage 10 driver already use — peer-authenticated, no
-- password, no key, so there is nothing here for a log to leak.
--
-- Self-granting is *not* refused, and that is a decision rather than an oversight: the person qualified to
-- mint the first operator grant is the person who already holds database access, and refusing
-- `p_user_id = p_actor_user_id` would break the only legitimate first use while adding nothing — that
-- caller can insert this row by hand. What the design does instead is make the act visible: it writes an
-- audit row naming both ids, and the trail it writes is the one hardened above.
--
-- Neither body takes an idempotency key. §13 puts the replay defence in the HTTP wrappers, where a client
-- can actually retry; here a double `grant` is a *refusal* (the duplicate-active rule below), so the
-- second delivery of one intent is loudly wrong rather than silently answered, and there is no recorded
-- answer to return.

CREATE FUNCTION internal_api.grant_operator_role(
  p_user_id uuid,
  p_scope text,
  p_reason text,
  p_actor_user_id uuid,
  p_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_grant private.operator_grants;
  v_existing private.operator_grants;
  v_user_id uuid;
  v_actor_id uuid;
  v_audit_id bigint;
BEGIN
  -- Every input is checked before anything is written, so a refusal leaves no half-decision behind. These
  -- are the same rules the table enforces; the body states them because the body's sentence is what an
  -- operator reads, and a constraint name is not an explanation.
  IF p_scope IS NULL OR p_scope NOT IN ('support', 'operations', 'finance_review', 'privacy') THEN
    RAISE EXCEPTION 'unknown operator scope %: the four duties are support, operations, finance_review '
      'and privacy, and a fifth word here would be a grant nobody reviewed',
      coalesce(quote_literal(p_scope), 'NULL')
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'an operator grant must say why: a credential with no stated reason is a permanent '
      'one with no account of itself'
      USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_reason) > 500 THEN
    RAISE EXCEPTION 'the reason for a grant must fit in 500 characters, got %', length(p_reason)
      USING ERRCODE = 'check_violation';
  END IF;

  -- Both accounts have to exist. `auth.users` is the only place an identity lives, so an audit row that
  -- named an account nobody could look up would be a row that could not be checked afterwards — and the
  -- FK here is NOT NULL, so this is the difference between a clear refusal and a constraint error.
  SELECT u.id INTO v_user_id FROM auth.users u WHERE u.id = p_user_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'no account % to grant operator scope % to: authority attaches to a login, never to a '
      'uuid invented at the console', p_user_id, p_scope
      USING ERRCODE = 'raise_exception';
  END IF;
  SELECT u.id INTO v_actor_id FROM auth.users u WHERE u.id = p_actor_user_id;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'no account % behind this grant: name the human who decided, because the trail records '
      'them and a row that names nobody is refused by its own CHECK', p_actor_user_id
      USING ERRCODE = 'raise_exception';
  END IF;

  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'an expiry must be in the future (% was given): a grant minted already dead is a '
      'typo that looks like a decision', p_expires_at
      USING ERRCODE = 'check_violation';
  END IF;

  -- The duplicate refusal, with the live grant's identity and age in the sentence. Deliberately not
  -- silently idempotent: extending an expiry is a revoke-and-regrant, and a `grant` that answered "already
  -- done" to a request for a *longer* window would be a refusal that reported success.
  SELECT g.* INTO v_existing
    FROM private.operator_grants g
   WHERE g.user_id = p_user_id AND g.scope = p_scope AND g.status = 'active';
  IF FOUND THEN
    RAISE EXCEPTION 'account % already holds an active % grant (id %, expires %, granted %): to change its '
      'terms revoke it first and grant again, so the change is two records rather than an overwrite',
      p_user_id, p_scope, v_existing.id,
      coalesce(v_existing.expires_at::text, 'never'), v_existing.granted_at
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO private.operator_grants
      (user_id, scope, status, reason, granted_by_user_id, granted_at, expires_at)
    VALUES (p_user_id, p_scope, 'active', btrim(p_reason), p_actor_user_id, now(), p_expires_at)
    RETURNING * INTO v_grant;

  -- Built field by field, never `to_jsonb(v_grant)`: the row type is a column list that the next
  -- migration widens, and an audit state that grows with the table is a state that starts carrying
  -- something nobody reviewed. The grant id is in here so the record survives the grant row's own
  -- deletion (an operator account erasure cascades) — the audit trail's subject may legitimately vanish.
  INSERT INTO private.audit_events
      (wedding_id, subject_type, subject_key, action, actor_user_id, actor_kind, reason,
       payload, after_state)
    VALUES (NULL, 'operator_grant', v_grant.id, 'granted', p_actor_user_id, 'maintenance',
            btrim(p_reason),
            jsonb_build_object('granted_user_id', v_grant.user_id,
                               'scope', v_grant.scope,
                               'status', v_grant.status,
                               'expires_at', v_grant.expires_at),
            jsonb_build_object('grant_id', v_grant.id,
                               'status', v_grant.status,
                               'granted_at', v_grant.granted_at,
                               'expires_at', v_grant.expires_at,
                               'granted_by_user_id', v_grant.granted_by_user_id))
    RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object('grant_id', v_grant.id, 'user_id', v_grant.user_id,
                            'scope', v_grant.scope, 'status', v_grant.status,
                            'granted_at', v_grant.granted_at, 'expires_at', v_grant.expires_at,
                            'audit_id', v_audit_id);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.grant_operator_role(uuid, text, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.grant_operator_role(uuid, text, text, uuid, timestamptz) IS
  'Service-only, and the only writer of an operator grant besides a trusted hand at the console. Requires a '
  'scope from the four, a non-blank bounded reason, an existing account to grant to and an existing account '
  'behind the decision, and an expiry in the future if one is given. Refuses rather than absorbs a second '
  'active grant for one account and scope. Writes a maintenance-kind audit row naming both accounts.';

CREATE FUNCTION internal_api.revoke_operator_role(
  p_user_id uuid,
  p_scope text,
  p_reason text,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_grant private.operator_grants;
  v_actor_id uuid;
  v_audit_id bigint;
BEGIN
  IF p_scope NOT IN ('support', 'operations', 'finance_review', 'privacy') THEN
    RAISE EXCEPTION 'unknown operator scope %: the four duties are support, operations, finance_review '
      'and privacy', coalesce(quote_literal(p_scope), 'NULL')
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'a revocation must say why: the person who loses authority is entitled to read the '
      'reason for it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_reason) > 500 THEN
    RAISE EXCEPTION 'the reason for a revocation must fit in 500 characters, got %', length(p_reason)
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT u.id INTO v_actor_id FROM auth.users u WHERE u.id = p_actor_user_id;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'no account % behind this revocation: the trail records who took authority away',
      p_actor_user_id USING ERRCODE = 'raise_exception';
  END IF;

  -- The grant row is the thing being changed, so it is looked up by (account, scope) rather than by id:
  -- an id handed to the console could belong to a different account than the one the operator meant.
  SELECT g.* INTO v_grant
    FROM private.operator_grants g
   WHERE g.user_id = p_user_id AND g.scope = p_scope AND g.status = 'active';
  IF NOT FOUND THEN
    -- Two refusals with one sentence, for the reason every other denial in this stage has one: whether an
    -- account ever had this grant is not information a caller is entitled to, and the caller here is a
    -- console that can ask in a second query if it needs to know.
    RAISE EXCEPTION 'no active % grant for account % to revoke', p_scope, p_user_id
      USING ERRCODE = 'raise_exception';
  END IF;

  -- A status write, never a DELETE (§3): the row stays as the record that this account held this scope
  -- between these two instants. The table's own pair CHECK keeps status and `revoked_at` in step, and the
  -- partial unique index is what lets a later re-grant be a new row instead of a resurrection.
  UPDATE private.operator_grants g
     SET status = 'revoked', revoked_at = now()
   WHERE g.id = v_grant.id
   RETURNING * INTO v_grant;

  -- The first real use of the two columns this file adds: a revocation is exactly the decision where "what
  -- was true before" is the question an incident review asks — which expiry was live, who granted it, and
  -- when. Both states are projections, not rows, and neither carries the grant's `reason` text twice.
  INSERT INTO private.audit_events
      (wedding_id, subject_type, subject_key, action, actor_user_id, actor_kind, reason,
       payload, before_state, after_state)
    VALUES (NULL, 'operator_grant', v_grant.id, 'revoked', p_actor_user_id, 'maintenance',
            btrim(p_reason),
            jsonb_build_object('granted_user_id', v_grant.user_id,
                               'scope', v_grant.scope,
                               'revoked_at', v_grant.revoked_at),
            jsonb_build_object('status', 'active',
                               'granted_at', v_grant.granted_at,
                               'expires_at', v_grant.expires_at,
                               'granted_by_user_id', v_grant.granted_by_user_id),
            jsonb_build_object('status', v_grant.status,
                               'revoked_at', v_grant.revoked_at))
    RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object('grant_id', v_grant.id, 'user_id', v_grant.user_id,
                            'scope', v_grant.scope, 'status', v_grant.status,
                            'revoked_at', v_grant.revoked_at, 'audit_id', v_audit_id);
END;
$$;

REVOKE ALL ON FUNCTION internal_api.revoke_operator_role(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION internal_api.revoke_operator_role(uuid, text, text, uuid) IS
  'Service-only, and the only revocation path. Refuses an unknown scope, a blank or oversized reason, a '
  'missing actor and — with one indistinguishable sentence — an account that holds no active grant of that '
  'scope. Writes status and revoked_at on the grant row, never deletes it, and records both states.';
