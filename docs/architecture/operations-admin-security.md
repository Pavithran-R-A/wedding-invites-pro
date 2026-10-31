# Stage 11 — Operations, support and incident administration: authority model and threat model

**Status: design and threat model, and the contract the Stage 11 migrations are written against — with
slices 1–5 now exercised.** The five batteries have run, on the runner's own chains, against a real
PostgreSQL 17 (§13 cites them by log), the six Stage 11 migrations have since been applied to the shared
`localvivaahvarnam` stack (§16), and the HTTP battery has run there for authority group `A` and support group
`C`. So "every capability here is labelled **designed** until a battery measures it" still governs this
document, but it no longer means the wire is unread: what has **not** run is the takedown `T`, health `H`,
privacy `V`, refund-oversight `R` and audit-integrity `AI` groups and the whole browser tier, because they need
Docker running and starting it is a human-only action. The concurrency tier is a different thing, and the two
must not be read as one list: `supabase/tests/stage11/race/` declares `RC00`–`RC16` and `RD00`–`RD07` across
fifteen files, `run.sh` has a `race` mode that builds its own throwaway chain, and that chain **has now run** —
attempts 6 and 7 both exited 0 with 34 counted cells green (the plant census's 9 plus the 25 numbered ones) on a
host `PostgreSQL 17.10` cluster built for this tier alone, with each arm's cross-session rendezvous witnessed as a
pid in `pg_locks` and the chain dropped by the tier's own teardown; §13 cites both logs. The two logs attach the
numbers differently and honestly: attempt 6 executed the repaired files as a dirty work tree at head
`22a05f2a55be81e70000fc3d8d2008ae11029a21`, and attempt 7 re-ran those same bytes *after* they were committed, at
`9bd83ca0f177fc0430854a618b413085dad500af` with `worktree_tier_files_dirty=0` and per-file sha256 equality between
the executed and the committed tree recorded in `q11-logs/s11-race-commit-bytes-check-1.txt`. What that run still
does not touch is the wire: no PostgREST, no JWT, no Storage API and no row of any real wedding. §9, §11 and §16 each name which database a figure was read
off, because the same projection takes one branch on the runner chains and another on the stack. Every count
is read out of a live database or out of a file at a named SHA, and each §15 block says which head
it belongs to. It authorises no operator, no refund, no erasure, no takedown of a real customer's invitation
and no live commerce.
**Branch baseline:** `stage11/operations-admin` at `9f3076a4c0426df4defae8f5b7150ff811f34f5b`, on top of
merged Stage 10 at `c9eb27aa2e27422d9da3bdc29bedd3e49b8adb21`.
**Binding sources:** [`docs/superpowers/specs/2026-10-20-stage11-operations-admin-kickoff.md`](../superpowers/specs/2026-10-20-stage11-operations-admin-kickoff.md),
[ADR 0005](decisions/0005-server-authoritative-commerce.md), [ADR 0008](decisions/0008-provider-neutral-payment-ledger.md),
[`docs/audits/stage-10-commerce-foundations.md`](../audits/stage-10-commerce-foundations.md) §20,
[`docs/audits/stage-9-render-exports.md`](../audits/stage-9-render-exports.md), and the publication,
credential, guest and review boundaries recorded in
[`public-invitation-security.md`](public-invitation-security.md),
[`guest-rsvp-security.md`](guest-rsvp-security.md) and [`family-approval-review-security.md`](family-approval-review-security.md).

## 0. The evidence vocabulary this stage keeps straight

Same five levels Stage 10 defined (`commerce-foundations.md` §0), reused rather than redefined:
**designed** → **implemented** → **exercised locally** → **exercised against synthetic provider
fixtures** → **live-customer-verified**. Stage 11 has no provider and no live money, so its third and
fourth rows are the same row: a capability is proven by driving it over the real Kong/PostgREST/GoTrue
stack with fully synthetic accounts, and nothing here may be described as working for a real customer.
The last row is unreachable from this stage by design — the same discipline Stage 10 §0 used.

## 1. What Stage 11 builds, and what it refuses

One trustworthy operational workflow for a small invitation business: a support case that can be
opened, scoped, assigned, transitioned and closed with a trail; a takedown that a named human
authorised and that says honestly what it did and did not revoke; a refund/dispute queue a person can
*read and annotate* but never pay from; a privacy request that can be received and routed but not
destroyed from; a health view made of database facts rather than dashboard decoration; and one hardened
audit trail in which every human decision is distinguishable from machine evidence, carries its reason
and its idempotency key, and cannot be rewritten afterwards.

Refused, with the assertion that keeps each refused in §14: an admin page hidden behind a route, a
service-role key in any browser or CLI code path, self-service granting of operator authority, an
interface that can move money or delete records, a CRM, a general back-office platform, and any claim
that a signed file link died when the row was merely marked.

## 2. The substrate as measured at this baseline

Read from the running `localvivaahvarnam` database (`supabase_db_localvivaahvarnam`, 31 applied
migrations, matching the 31 files under `supabase/migrations/`) and from the migrations themselves. These
are **baseline** figures, taken before any Stage 11 slice landed, and they are kept unedited for that reason;
the same three schemas re-measured at the slice-4 head read 40 `api`, 60 `internal_api` and 52 `private` over
36 migration files — measured on the runner's throwaway PostgreSQL chains, not on this stack — and that is
what §10 and §15's last block carry. That last clause was true when it was written and is now superseded by
measurement: on 2026-10-25 the six pending Stage 11 files went to this stack through
`npx supabase db push --local --skip-vault --yes` at head `4ea2a9787d9105b128d0af822aeb26f35115b141`, exit 0,
and `q11-logs/s11-q2-applied-fingerprint.txt` prints the before/after pair it moved — `api` 22→41,
`internal_api` 39→61, `private` tables 8→13, Stage 11's five stores 0→5, `schema_migrations` rows 31→37 —
while `private.audit_events` stayed at 27, which is what "applying a migration writes no audit row" measures
like rather than asserts.

| Fact | Measured value | Consequence for Stage 11 |
| --- | --- | --- |
| Operator/admin authority that anything reads | **none.** `public.user_roles` holds 6 rows with `CHECK (role IN ('admin','user'))` (`20260925120500_stage2_rls_and_grants.sql:383-387`), RLS `owners_read_own_roles` (`:377`), and `public.has_role` was dropped in Stage 2 (`20260925120800_stage2_relocate_security_helpers.sql:63`). No product code, migration body or policy reads the vocabulary. | Stage 11 must create authority, not discover it. It is created migration-backed, with zero seeded rows (§3). |
| `public.app_role` enum | `('admin','user','planner')` (`20260222071941_b09d0299-796f-4d80-9f5a-e919fa705ffe.sql:3`) | Left untouched. Widening a shared enum to carry an operational role would make `user_roles` a second, weaker authority system (§3). |
| REST-addressable schemas | `supabase/config.toml:32` exposes exactly `public` and `api`. | Every Stage 11 table is created in `private`; every callable is an `api` wrapper delegating to an `internal_api` body, the layout Stage 3 fixed. |
| Callable surface today | **22** `api` functions (5 also `anon`-callable: `resolve_public_invitation`, `resolve_guest_invitation`, `resolve_family_review`, `submit_guest_rsvp`, `submit_family_review`), all `prosecdef = f`, all `sql`; `service_role` holds EXECUTE on none of them. 39 `internal_api` functions, all definer/plpgsql; 37 functions in `private`. | The anonymous door count stays 5. Stage 11 adds authenticated-only wrappers, and `API33`/`API34` (`supabase/tests/api/stage3_publication.test.mjs:1307`, `:1531`) are extended, not relaxed — both line numbers in that cite moved by this stage's own widening of the file (`4d1daae`, which added the twenty twin-less names and the three lists that carry them), and §15 records the measured refusal the un-widened lists gave against the pushed stack before that edit. |
| Audit trail | `private.audit_events` columns are exactly `id, wedding_id, subject_type, subject_key, action, actor_role, actor_user_id, payload, created_at` (`20260925120400_stage2_assets_entitlements_secrets.sql:86-101`). No reason, no idempotency key, no human/system discriminator. `actor_user_id` is caller-supplied. `service_role` holds **SELECT, INSERT, UPDATE, DELETE** (`:197`) and the append-only triggers (`:107-110`) return NEW/OLD for `postgres`, `service_role` and `supabase_admin` by design (`20260925120000_stage2_privilege_baseline.sql:137-152`, `:169-186`). | The single place the truth is kept is rewritable by a leaked service key and cannot say who decided anything. Stage 11 hardens it in place (§4) rather than starting a second trail. |
| Publication revocation | `internal_api.revoke_invitation_publication` (`20261009120000_stage8_guest_invitations_rsvp.sql:1060-1108`) flips the active publication, revokes that wedding's `public_invitation` and `guest_invitation` credentials, and touches **nothing else** — no `invitation_outputs` row, no object. | A host takedown and an operator takedown are the same door; Stage 11 adds the registry step and the object step around it (§6). |
| Retired artefact delivery | Stage 9 measured, and pins as a requirement, that a row set to `invalidated` keeps serving: the owner's authenticated read is 200, **a fresh mint is 200**, and only deleting the object makes both a previously minted link and the owner's read fail (`supabase/tests/api/stage9_render_outputs.test.mjs:1543-1586`, cell `E-06`). The storage read policy joins on ownership and key only (`20261013120000_stage9_render_outputs.sql:468`). | Stage 11 must **not** narrow that policy: `E-06`'s own message (`'a fresh link was refused for a row the ledger already retired'`) is the assertion that would go red. Takedown therefore separates "the registry retired it" from "the bytes are gone", and says so (§6). |
| Output state vocabulary | `status IN ('registered','uploading','ready','failed','invalidated')`, `invalidation_reason IN ('superseded','token_rotated','publication_revoked','asset_deleted')`, `invalidated` terminal, `ready → invalidated` the only forward edge from `ready` (`20261013120000_stage9_render_outputs.sql:129-170`, `:332-349`). | The vocabulary Stage 11 needs already exists with a reason naming exactly this event (`publication_revoked`), and its trigger already refuses anything else. Write it through the existing edges; do not add one. |
| Money rows | `private.commerce_refunds` (`20261017120000_stage10_commerce_foundations.sql:375-404`) is written only by `record_commerce_event`; `service_role` holds zero privileges on all six commerce tables; refunds have their own identity and a `hold_for_review` default policy. | Oversight reads and annotates; nothing in Stage 11 can pay, reverse, re-price or revoke from a review (§7). |
| Telemetry that exists | No rate-limit, throttle, auth-failure or delivery-failure table anywhere in `supabase/migrations/`; Stage 8 states the absence as a decision (`20261009120000_stage8_guest_invitations_rsvp.sql:31-34`) and Stage 3 defers throttling to a gateway (`20260926130000_stage3_publication_resolution_boundary.sql:47`). | The health view reports measured stores and names the rest `not_measured` (§9). Inventing a "token abuse" tile for a table that does not exist is the Stage 0 defect class. |
| Trusted-tool precedent | `scripts/tradition-pack-admin.mjs` plans before `--yes` and reaches the database through peer-authenticated in-container `psql` (no password, no key); `scripts/stage9-output-publisher.mjs` has a real withheld-write dry run and a log redactor; `scripts/stage10-commerce-driver.mjs` takes `--secret-env`, bans credential and price flags and asserts its own output is secret-free (`:423` names the psql channel). | Stage 11's tool follows all three, and adds one thing none of them does: it acts **as a signed-in operator over HTTP**, so the authorization is exercised rather than assumed (§11). |
| Browser/admin surface today | `src/App.tsx:50-96` routes are host and public only; `ProtectedRoute` checks a session and nothing else. | Stage 11 ships no admin route. An admin page whose door is its URL is exactly what the kickoff forbids; the operator surface is the wire plus the CLI (§10, §11). |

## 3. Operator authority is a grant table, not a role word

**Decision.** A new `private.operator_grants` table is the only source of operational authority:

```
user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE   -- the account, not a name
scope   text CHECK (scope IN ('support','operations','finance_review','privacy'))
status  text CHECK (status IN ('active','revoked'))
granted_by_user_id uuid, reason text NOT NULL (non-blank), expires_at timestamptz NULL
granted_at, revoked_at, -- CHECK ((status='active') = (revoked_at IS NULL))
UNIQUE (user_id, scope) WHERE status = 'active'            -- one live grant per person per scope
```

Four scopes, closed vocabulary, one per duty: someone can be allowed to answer tickets without being
allowed to take a wedding down, and allowed to read the refund queue without touching privacy. A grant
that expires is expressible; a grant that is only a word in a shared enum is not.

**Why not `user_roles.admin`.** Three reasons, in order of weight.

1. `user_roles` is a *public*, REST-addressable table whose only policy is
   `owners_read_own_roles`. Authority that lives there can be probed by every signed-in account with a
   `SELECT` it is allowed to make about itself, and the vocabulary CHECK already lies about `planner`.
   Operational authority should live where the configuration keeps it unreachable over HTTP.
2. The word `admin` is already occupied by legacy semantics: the archived scaffold's
   `Admins manage roles` policy (`20260222071941…:175`) and `has_role` are gone, but 6 rows survive in
   the table. Reusing `admin` would silently hand operational authority to whatever those rows happen
   to be, which is the "authority granted by accident" failure the kickoff §3 names.
3. Scope, expiry, revoker and reason are data. A one-word enum cannot carry them, and an operational
   grant without a reason and an expiry is a permanent credential.

`user_roles` and `app_role` are therefore left exactly as they are, and this stage's security claim does
not depend on them. Self-granting is refused by construction: no client role holds `INSERT`, `UPDATE` or
`DELETE` on `private.operator_grants`, the table has RLS enabled with **no policy**, and the write path is
the service-only pair `internal_api.grant_operator_role` / `internal_api.revoke_operator_role` — `plpgsql
SECURITY INVOKER SET search_path = ''` bodies with **zero EXECUTE grants to `anon`, `authenticated` or
`service_role`**, reachable only from the trusted `postgres` path (§11). Each of those two writes an audit
row naming who granted what to whom and why. `private.actor_is_operator(p_scope text)` is the one predicate
every operational body calls; it reads `auth.uid()`, never an argument, and is `SECURITY DEFINER SET
search_path = ''`.

The pair is INVOKER and the predicate is DEFINER, and that asymmetry is the measured shape of the schema
rather than a stylistic choice. When §3 was drafted it asserted both were definer bodies; the migration's
preamble records the correction. `internal_api` held 39 names at the Stage 10 head and 17 of them — the six
commerce writers and the eleven pack maintenance bodies — are `prosecdef = f` whose EXECUTE is false for
`service_role`, `anon` *and* `authenticated` (`20261017120000_stage10_commerce_foundations.sql:784-838` is
the shape). An INVOKER body sees exactly what its caller sees, so the pair cannot accidentally read more
than the trusted console can, and its reachability stays a property of the *role*, which is what this
section's claim needs. `private` was the opposite census: 37 functions, every one `f|f|f` for EXECUTE, and
only three definer. The predicate had to become the fourth because an INVOKER predicate reading
`private.operator_grants` from inside a wrapper whose caller holds no privilege on that table raises
`permission denied for table operator_grants` instead of answering `false` — the same forced choice
`20261017120000…` records for `private.guard_publication_commerce_gate`. Its definer privilege is one
indexed read of one table, and it writes nothing.

**No operator exists after the migrations run.** The migration creates the table, the predicate and the
grant/revoke bodies and inserts nothing. A deployment therefore has no operational authority until a
human with database access runs the trusted grant command, which is the honest reading of "No live
operator authority is granted by this kickoff document."

## 4. One audit trail, hardened in place

Stage 10's design document rejected a second audit table for a good reason — two places for the truth
to disagree — so Stage 11 extends `private.audit_events` forward-only and repairs the two flaws §2
measured in it.

*New columns* (all defaulted or nullable, so the 29 `INSERT INTO private.audit_events` sites written
across the five Stage 10 migrations keep working unchanged):
`actor_kind text NOT NULL DEFAULT 'system'`, with a separate vocabulary CHECK over
`('system','operator','host','maintenance')`, `reason text`, `idempotency_key text`, `before_state jsonb`,
`after_state jsonb`, each of the last two `CHECK (… IS NULL OR jsonb_typeof(…) = 'object')`. Four values,
not the three §4 was drafted with: `maintenance` is the kind of row the trusted CLI writes when no human
account is on the wire — the state where `auth.uid()` is NULL and the caller is `postgres` — and leaving it
out would force either a false `operator` row or a false `system` row for the grant and revoke bodies.
`CHECK (actor_kind = 'system' OR coalesce(length(btrim(reason)), 0) > 0)` makes "a human decision with no
stated reason" unrepresentable, which is the distinction the kickoff §2 item 5 asks for — and the
`coalesce` is load-bearing, which this section did not originally say. As drafted the predicate was
`length(btrim(reason)) > 0`, and for a `reason` that is SQL NULL that whole expression is NULL, **and a
CHECK passes on NULL**. Cell `AI15` planted a human-kind row with no reason and the chain accepted it, so
the claim was false in exactly the case a reader would care about; the migration carries the `coalesce`, the
sibling sweep of every existing constraint found one other pairing of this shape
(`20260925120300_stage2_guests_approvals_rsvp.sql:181`) and it was already written with `IS NOT NULL`, which
is a predicate that can only be TRUE or FALSE and needs no guard. The companion
`CHECK (actor_kind = 'system' OR actor_user_id IS NOT NULL)` is refused by its own form, measured as `AI16`.
`UNIQUE (idempotency_key) WHERE idempotency_key IS NOT NULL` is the replay defence: the second delivery
of one operator action finds the row and returns the recorded answer instead of acting twice, the
mechanism `commerce-payment-events` already uses (`commerce-foundations.md` §4). Its partial predicate is
the point — `AI13` collides a second delivery against the index and `AI14` shows two keyless rows still
coexist, so the ordinary system-written trail is not asked to invent a key per row.

*Hardening.* `REVOKE UPDATE, DELETE ON private.audit_events FROM service_role` — a leaked service key
keeps its evidence-gathering powers and loses its rewriting ones — and a `BEFORE UPDATE … EXECUTE
FUNCTION private.reject_audit_update_except_referential_null()` trigger that raises for **every** role,
the trusted ones included. It is deliberately *not* the ledger's blunt `reject_any_update`
(`20261017120000_stage10_commerce_foundations.sql:29-43`), and the difference was measured: an
`ON DELETE SET NULL` key is carried out by Postgres as an UPDATE on the child row, so the blunt guard
refused the database's own referential action — `q11-logs/s11-probe-fk-null-1.txt` cell M3 heard
"rows are append-only" from a wedding delete. The specialised body therefore compares every column except
the two attribution links (a column a later slice adds is refused by default) and lets a link move only to
NULL and only at `pg_trigger_depth() = 2`, the signature of a referential action measured by
`q11-logs/s11-probe-depth-1.txt` and again by `85_support_lifecycle.sql` T-RI2f/T-RI2g. A caller's
statement arrives at depth 1 and is refused, measured by T51; no role that can issue a statement against
this table can install a trigger on it. `DELETE` stays refused for client roles by
`reject_client_delete` and is now also ungranted — measured as the whole privilege matrix rather than one
role (`AI02`), at the table level *and* the column level, because `has_table_privilege` does not see a
column grant and the two probes answer different questions.

The two claims about identity have to be stated separately, because they have different scopes and only one
of them survives measurement intact. **No client-reachable callable takes an actor id**: `anon`,
`authenticated` and `service_role` all have EXECUTE false on both grant bodies (`A20`-`A25`, re-taken as
the whole matrix at `AI02`), so there is no
argument a signed-in hostile host can put a borrowed uuid into, and the `actor_user_id` on a row those
bodies write comes from `auth.uid()`. **The trusted path is different**: `internal_api.grant_operator_role`
and `…revoke_operator_role` do take `p_actor_user_id uuid`, deliberately, because on the peer-authenticated
channel `auth.uid()` is NULL by construction and a grant decided by nobody is unanswerable afterwards. What
protects that argument is not the signature, it is the role: only a caller who is already `postgres` can
reach it, and both bodies refuse an actor that names no `auth.users` row.

And the honest residue, which the trail cannot be hardened against by anything in this stage: revoking
UPDATE and DELETE removes a leaked key's *rewriting* powers, not its *appending* ones. `service_role` keeps
INSERT — it must, or 29 existing audit-writing sites stop working — so a leaked key may still add a row that
never happened, with a `reason` nobody wrote and an `actor_user_id` it chose. `AI11` measures that acceptance
rather than asserting it: the cell plants such a row and requires the statement to succeed, and `AI11b`
counts it as the trail's only row keyed to an account that does not exist. Closing forgery-by-addition needs
an anchor outside the table — a signature chain, or a writer that is the only role with INSERT — and this
stage does not build one. Saying "a leaked key cannot touch the trail" would be the kind of claim §0 exists
to catch.

*Payload discipline.* `before_state`/`after_state` are built field-by-field inside each body from ids,
statuses and timestamps. No body copies a caller's text into an audit column, and a battery asserts the
negative across the whole trail after a full operator run: no value equal to any
`private.access_tokens.token_hash`, no raw credential, no email address, no `storage.objects` name
appears in `payload`, `reason`, `before_state` or `after_state` (§13, cells `AI-*`).

## 5. Support cases: one lifecycle, scoped three ways

Two tables, both in `private`, both with RLS and no policy, both with `reject_client_write`/
`reject_client_delete` backstops and **zero role grants** — every write goes through a definer body.

`private.support_cases` — `case_ref` minted by a `BEFORE INSERT` trigger as `SV-` plus 8 base32
characters drawn from `extensions.gen_random_bytes` (the same generator the credentials use; the row id
is never the thing a human quotes), `wedding_id` nullable FK **NO ACTION** (a closed ticket is evidence
of what was live, so it does not cascade away with the wedding), `requester_user_id` nullable FK
`ON DELETE SET NULL`, `opened_by_user_id`, `assigned_operator_user_id` nullable, `category` and
`severity` from closed vocabularies, `status` from the machine below, `host_summary` (bounded, non-blank
free text the host wrote), `resolution_code` nullable, timestamps, and a composite
`CHECK` pair that makes `resolved`/`closed` impossible without `resolved_at` and a `resolution_code`.

| Status | Legal forward edges | Who may walk them |
| --- | --- | --- |
| `open` | `triaged`, `closed` | operator(`support`) |
| `triaged` | `awaiting_information`, `in_progress`, `closed` | operator(`support`) |
| `in_progress` | `awaiting_information`, `resolved`, `closed` | operator(`support`) |
| `awaiting_information` | `in_progress`, `closed` | operator(`support`), and the **requester** moving it back to `in_progress` |
| `resolved` | `closed`, `in_progress` (reopen) | operator(`support`) |
| `closed` | — terminal | — |

The edges are enforced by a `BEFORE UPDATE` trigger that compares OLD and NEW and raises
`check_violation` naming the illegal pair, exactly as the output registry does
(`20261013120000_stage9_render_outputs.sql:336-349`) — so a stale tab, a double click and a hand-written
`UPDATE` all meet the same answer, and "the state machine is a document" is not a claim anyone has to
keep.

`private.support_case_events` — append-only history: `case_id` FK, `seq` (per-case monotonic, unique),
`kind IN ('message_host','message_operator','assignment','status','operation_link')`,
`actor_user_id`, `actor_kind IN ('host','operator','system')`, `from_status`, `to_status`, `body`
(bounded text for the two message kinds, NULL otherwise, with a CHECK pairing them),
`idempotency_key` unique per case, `created_at`. `body` for a `message_operator` row is **internal**: the
host read returns its own case, the host-facing messages and the status history, and never an operator's
private note. This is the guard against leaking a household's identity or another owner's material — an
operator note is allowed to name the wedding and the state, not to become a channel where a guest roster
is pasted and then read back by the guest who filed the ticket.

**A case is the authorisation carrier for every other Stage 11 act.** The takedown, refund-review and
privacy-routing functions all require `p_case_ref` naming an *open, triaged or in_progress* case whose
`wedding_id` matches the target, and each records an `operation_link` event. "Take this wedding down"
therefore cannot exist without a ticket that says why, and the ticket cannot be closed while the act it
authorised has no audit row. That is one mechanism, reused, rather than four bespoke approval flows.

Scoping refusals are Stage 3's shape and for Stage 3's reason: "not yours" and "not there" share one
SQLSTATE (`insufficient_privilege`) and one sentence, so no operator or host RPC is an existence oracle
over a uuid a caller picked.

## 6. Publication takedown: two facts, said separately

**Decision.** `internal_api.operator_takedown_publication(p_wedding_id uuid, p_case_ref text,
p_reason text, p_idempotency_key uuid)` and
`internal_api.operator_purge_publication_objects(p_case_ref text, p_actor_user_id uuid,
p_idempotency_key uuid)` are **not** the same operation,
and the reason is measured, not stylistic: §2's `E-06` row proves that marking a row retired does not
stop delivery, so a single call that claimed both would be a false claim. Two functions, two audit verbs,
two answers. An earlier draft of this section carried the second half as a `p_purge_objects boolean` on the
first signature; no such argument ships, measured from `pg_get_function_arguments` on both bodies in
`q11-logs/s11-s4-actor-params-1.txt`, and the withdrawal is the point — a flag that decides whether an
irreversible step is included is a flag a caller sets by accident, on the one act in the stage that cannot
be undone:

1. `operator_takedown_publication` — requires scope `operations`, a matching open case, a
   `p_reason IN ('owner_request','terms_violation','safety','legal','duplicate')`, and an idempotency key.
   In one transaction it: calls the *existing* revocation path's effect (publication `active → revoked`,
   that wedding's `public_invitation` and `guest_invitation` credentials revoked — the two statements
   Stage 8's body runs, `:1087-1090` for the credentials and `:1097-1099` for the publication), then
   walks every `ready` output row of that wedding's *active and now
   revoked* version to `invalidated` with reason `publication_revoked` through the existing legal edge,
   then writes one `actor_kind='operator'` audit row with `before_state`/`after_state` and counts
   (`publication_revoked`, `credentials_revoked`, `outputs_invalidated`). It does not delete a byte.
   Its return says, in as many fields: which credentials died, that previously issued file links are
   **not** covered by this action, and which purge would cover them.
2. `operator_purge_publication_objects(p_case_ref, p_actor_user_id, p_idempotency_key)` — the *plan* in
   front of the irreversible half, and not itself an irreversible act: the shipped body deletes nothing,
   measured as `DELETE FROM` absent from its own stored `prosecdef` source in
   `q11-logs/s11-s4-doc-probe-1.txt` section O, and returns the exact `object_key` list and its count.
   It requires **a second distinct idempotency key**, the case named above, and is refused entirely
   from any surface other than the trusted CLI (§10). The actor is the third argument, and that is the
   one place in the stage where an operator is named rather than derived: on the peer-authenticated
   `postgres` channel `auth.uid()` is NULL by construction, so nobody is on the session, and an
   unattributed irreversible plan would be unanswerable afterwards (§4). Naming is not trusting — the body
   reads `private.operator_grants` for exactly that uuid with the same four conditions slice 1's predicate
   applies to a session (`scope = 'operations'`, `status = 'active'`, unexpired, and the account exists in
   `auth.users`), and refuses an unknown id, a lapsed grant and a NULL actor each with its own sentence.
   The wedding is read from the case through `private.operator_authorising_case`, never supplied.
   The removal itself goes through the Storage API's own delete (the route `stage9-output-publisher.mjs`
   `remove` uses, `:337-347`), which is how Stage 9 measured that a deleted object fails both the live
   signed URL and the owner's re-mint, and the CLI refuses to execute a plan without `--yes` after showing
   its key list. The registry rows are already `invalidated`, so the delete-then-mark
   ordering that Stage 9's design §12 states, and its migration restates at
   `20261013120000_stage9_render_outputs.sql:395-396`, is preserved rather than inverted.

**Host impact.** The host sees the truth through the doors that already exist — `api.get_invitation_publication_state`
answers revoked, and `api.list_invitation_outputs` prints the retired state with the reason vocabulary
already in use — and nothing new is built to tell them, because a second message surface is a second
place for the story to differ from the row. The takedown's audit `reason` is an operator-facing category,
never a per-field narrative, and it is not returned to the host.

**Access semantics, stated for the audit to check:** after step 1 a stranger holding the guest address
gets `{"available": false}`; a person holding a *file link minted before step 1* still gets the file, and
that is measured before and after in both tiers, because the alternative — claiming immediate
invalidation — is the sentence Stage 9 already proved false here.

## 7. Refund and dispute oversight: read, annotate, escalate

`private.commerce_review_notes` — `id`, `refund_id uuid REFERENCES private.commerce_refunds(id) ON DELETE
NO ACTION`, `order_id` (denormalised only as a FK for query, re-derived from the refund row at write
time), `case_ref` (mandatory, §5), `author_user_id`, `kind IN ('evidence_requested','in_review',
'escalated_to_owner','documented_outcome')`, `note` (bounded), `idempotency_key`, `created_at`.
Insert-only: a correction is a new note, never an edit, because an oversight trail that can be rewritten
is not oversight.

`api.operator_commerce_review_queue(...)` requires scope `finance_review` and returns, per refund row:
its kind/status/amount/currency/provider reference, the order's frozen `package_code`,
`price_version` and `merchant_reference`, the notes, and the case's status. **No entitlement changes, no
refund creation, no `commerce_refunds` write, no policy flip** is reachable from this surface, and
`live_capture_enabled` is not merely unread but ungrantable here: the singleton it lives on refuses
client writes and Stage 10 §15 already pins the payment-policy defaults as open owner decisions. A
`documented_outcome` note records what a human did *elsewhere*; the wording of the returned DTO and the
CLI's help text both say the action was not taken here. Stage 10's seven still-open findings stay listed
in the readiness matrix and in the Stage 11 audit as prerequisites for live commerce, and none of them is
closed by adding a queue in front of them.

## 8. Privacy intake: receive and route, never erase

`private.privacy_requests` — `request_ref` minted as `PR-` + 8 base32, `wedding_id` FK **NO ACTION**
(the request is the reason a later erasure is allowed to proceed, so it must outlive the temptation to
cascade), `requester_user_id` nullable on disk and named on insert, `kind IN ('export','erasure')`,
`status IN ('received','identity_verification_requested','queued_for_stage13',
'satisfied_outside_this_build','declined')`, optional `host_note` (≤ 2000, trimmed, the host's words and
deliberately absent from the operator projection), `operator_note` (≤ 4000, the operator's working
record), `requested_at`, `updated_at`, and `CHECK (status <> 'satisfied_outside_this_build' OR
(operator_note IS NOT NULL AND length(btrim(operator_note)) > 0))`.

The nullable requester is the first place this section's prose had to yield to the platform, and the
migration header records the three such places. `requester_user_id` cannot be both `NOT NULL` and
`ON DELETE SET NULL`, and the second is what keeps a request — and the evidence that it preceded an
erasure — from making its own requester's account undeletable. So the column is nullable, a
`BEFORE INSERT` guard (`private.reject_privacy_request_without_requester`) refuses a hand-written row
that names nobody, and the API body always writes `auth.uid()`: only the database's own referential
nulling can empty the link afterwards (`S16`, `D13`–`D15`). The CHECK carries `operator_note IS NOT NULL`
for a related reason: with a NULL note the expression this document originally specified evaluates to
NULL, and a CHECK accepts NULL, so the one status that speaks of completion could have been written with
no note at all. `D08` plants exactly that NULL and expects a refusal rather than a pass for the wrong
reason.

A host creates a request about their own wedding, lists and reads their own, and can do nothing else.
Four doors, all `authenticated` and every one paired with an `internal_api` body:
`api.create_privacy_request(p_wedding_id, p_kind, p_note)` / `api.get_my_privacy_requests()` for the
host, `api.operator_privacy_queue(p_status)` / `api.operator_advance_privacy_request(p_request_ref,
p_status, p_note, p_idempotency_key)` for the desk. The create door takes no idempotency key, so its
duplicate anchor is the database's own state: a partial unique index on `(requester_user_id, wedding_id,
kind)` over the three live statuses, and a second delivery while that request is live returns the first
row with `replayed = true` and writes nothing (`H01`–`H03b`). The lookup is scoped to the caller's own
`requester_user_id`, so no key and no query can answer with another account's request. The advance door
takes a key and anchors replay on the audit row's global partial unique index, because the trail is the
only history this table has (`R01`–`R10b`); the state machine is a five-state routing machine enforced
by a trigger edge table with two terminal states, and `M21`–`M22` probes all twenty ordered pairs and
rolls every one back.

**No function in Stage 11 deletes a row from any table**, and no path exists that could: the erasure
vocabulary has no DELETE arm (`S14` scans all four bodies for the word), the FK posture means a satisfied
erasure request does not silently remove money or publication history, and the battery performs each
attempt and counts rows. `D01`–`D10` refuse the hand plants and both client DELETEs, `D11`–`D12` refuse
the parent wedding delete on `privacy_requests_wedding_id_fkey`, and `D13`–`D21` erase a requester and an
operator, then read back the surviving request, the nulled links, the intact trail and the cascaded
credential; `Z01`–`Z12` close on thirteen registered requests, every ref unique. Deletion/privacy V1's
headline promise from `v1-scope.md` — guests' data removable on request — is therefore
*intake-qualified* in the readiness matrix, not marked implemented, because the destructive half is
Stage 13's legal decision (kickoff §1, §2 item 6).

## 9. Operational health: measured stores, and named absences

`api.operator_operations_summary(p_window_hours integer)` — scope `operations`, STABLE definer body,
returns **only** counts and timestamps it can reach, each block stamped with the statement's `now()` and
its own newest-row timestamp so "current" is a fact rather than an assumption. Slice 5 ships it
(`…190500_stage11_operations_health.sql`), and the shape below is the shipped answer rather than a design:
every figure in it is computed twice at this head — once by the body and once by an independent query in
`95_operations_health.sql`, which reads the pair's posture out of `pg_proc` (group S), the arithmetic of
each partition out of the answer and the stores beside each other (group M), and the whole answer's
byte-identity across a fenced call (group R). That pairing is what makes "the numbers are not decoration"
a measurement instead of a claim:

| Block | Source it reads | Meaning |
| --- | --- | --- |
| `migrations` | `supabase_migrations.schema_migrations` | applied count and highest version. The comparison against the files under `supabase/migrations/` is the CLI's job, because a file listing is not a database fact: that directory holds 37 files at this head — 31 at §2's baseline plus this stage's six — which is exactly why the tool reads it instead of carrying a number, and why it prints both figures or says it could not read one. It cannot read one on the runner chain that the figures in this section come from: `to_regclass` answers NULL for that table there (`q11-logs/s11-s5-doc-figures-2.txt` section 6, which is the same probe the body runs), and section 5 of that file parses the twelve stores the shipped body names straight out of its `prosrc` — the eleven that resolve, plus that one, plus the fact that `authenticated` holds SELECT on none of the nine `private` stores and on both `public` ones only through a single RLS policy each. So the block answers `not_measured` with the reason there — and it is the database, not the code, that decides which arm a reader gets: on the shared `localvivaahvarnam` stack the CLI owns that schema, so the block takes the `measured` arm and only three blocks are absent, not four (`q11-logs/s11-q1-stack-verify.txt` reads the live table's columns as `version|text ; statements|ARRAY ; name|text` with no `schema_migrations_versions` relation beside it, and `q11-logs/s11-q2-applied-fingerprint.txt` counts its rows 31→37 across the Stage 11 push). Neither arm has been read as an answer on that stack: the door returns 200 there with the projection's top-level keys intact (`q11-logs/s11-http-stage11-a5.txt` lines 45 and 53, A-04 and A-07) and no case named the `migrations` block's status; `H-01` is the case that does, and group H had never run — which is this row's state when it was written, not the tier's now: `q11-logs/s11-runtime-2-stage11-http-5.txt` answers `H-01` … `H-05` at 5 pass / 0 fail inside the suite's 38 / 38 green, and its own `H-01` line prints `the migrations branch answered 'measured' against to_regclass=true`, so the `measured` arm has been read as an answer on that stack rather than forecast, while the `not_measured` arm stays group N's fixture alone because taking it here would mean dropping the tool's real table. The SQL tier does not have to wait for the stack for that arm: the battery's group N builds a table at exactly that name in its own transaction, reads the block as `measured` twice, drops it, and re-reads the whole original answer unchanged. The real CLI's column set was *not* proven when this section was first written — no `supabase_migrations` schema exists on either runner chain, so the fixture's shape was the battery's invention, and `N5` reads the shipped branch's own column references from `pg_proc.prosrc` rather than trusting the fixture; the stack has since named that column set, and `version` — the one column this projection depends on — is in it. |
| `publication` | `public.publications` | counts by status inside/outside the window, plus weddings with an active publication. |
| `credentials` | `private.access_tokens` | live vs revoked vs expired, by kind, and `last_used_at` distribution — the "which link did I send and when did it stop working" question Stage 3 left for support. |
| `delivery` | `public.invitation_outputs` | counts by status, and `failed` rows at the attempt ceiling (the stuck state Stage 9's repair made visible). |
| `commerce` | `private.commerce_payment_events`, `commerce_orders`, `commerce_refunds` | `held_for_reconciliation` rows by reason, orders by status, refunds awaiting review with no note. This is the operator's arm of the reconciliation findings Stage 10 §10 produced but gave nobody a way to see. |
| `audit` | `private.audit_events` | counts by `actor_kind` and by `action` prefix, and operator rows with no case link. |
| `queue` | the support and privacy tables | open/aged cases, cases awaiting information, privacy requests past a threshold. |
| `auth_failures`, `rate_limits`, `token_abuse` | — | `{"status":"not_measured","reason":"no such store exists in this schema"}`. |

The last row is the whole honesty of the feature. There is no application server to log into, Realtime
and Edge are off (`supabase/config.toml:44-45`, `:60-61`), and §2 measured that no throttle table exists. A tile
that read a source of failure that does not exist is not a dashboard, it is the Stage 0 defect with a
number on it. A future stage adds the store and this projection's row changes from `not_measured` to a
count — the change is a migration plus a catalogue edit, and the shape already refuses decoration: every
block is `{status: 'measured'|'not_measured', …}` and a caller that wants a figure must read a status.

## 10. The callable surface, and who is refused

Every Stage 11 wrapper is `api.*` → `LANGUAGE sql SECURITY INVOKER SET search_path = ''` one-liner,
`REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` first, then `GRANT EXECUTE … TO
authenticated` — the exact posture §2 measured for all 22 existing functions. Every Stage 11 `internal_api`
body is `plpgsql`, owned by `postgres`, fully qualified inside, `SET search_path = ''` — and its
`SECURITY` clause is decided per body against the measured precedent rather than by one adjective. This
section originally said "every `internal_api` body is `SECURITY DEFINER`", and that is false of the
schema it describes: 17 of the 39 names at the Stage 10 head are `prosecdef = f` with EXECUTE false for all
three client roles, and Stage 11's two grant bodies follow them (§3). The sentence that followed — "the
predicate is the one Stage 11 body that is a definer" — was true of slice 1 alone, and the head now
measures the whole shape instead: `internal_api` holds 61 names of which 42 are `prosecdef = t` and 19 are
not, `private` holds 52 of which 5 are definers, and `api` holds 41 of which none are — 47 definers outside
the system schemas, which is exactly the set `C26` enumerates by name at this head. Of the 56 names this
stage wrote — 19 `api` wrappers, 22 `internal_api` bodies, 15 `private` helpers — **22 are definers**: the 20
`internal_api` bodies (19 paired with a door, plus slice 4's unexposed purge) and, in `private`, both
`actor_is_operator` and `operator_authorising_case`. The other 34 are the 19 wrappers, the 13 `private`
helpers, and the 2 grant bodies, which follow the Stage 10 precedent for the reason §3 gives. That split is
read from the catalogue, not from this prose: `q11-logs/s11-s5-doc-figures-2.txt` section 8 counts the stage's
own names per schema and per posture, and its `granted_to_authenticated` column is 19, 19 and **0** — none of
those 15 `private` names, definer or not, is callable by a browser role, which is what lets §9 census whole
queues without handing a caller a table. A paired body has to be a definer for the same forced reason
the predicate did — it reads `private.operator_grants` and the queue tables on behalf of a caller that
holds no grant on any of them, so an INVOKER body would raise `permission denied` instead of answering the
question the door asks — and §3's ruling for the grant pair is that reachability must stay a property of
the *role*, which is exactly what a body with no reachable surface does not need.
The per-name reading for slices 1–4 is `q11-logs/s11-s4-doc-probe4-1.txt` sections S1–S3, and this head's own
is `q11-logs/s11-s5-doc-probe-2.txt` P1–P4b: P4 lists the stage's 56 names per schema and finds all 56, P4b
lists the names that do *not* resolve and has zero rows, and P2 is the per-name posture, volatility, twin
and role-EXECUTE table behind the counts above. The same probe's P5 is the assertion §13's erasure row leans
on: none of the eight privileged bodies this stage wrote contains a `DELETE FROM` clause — and P5b is what
makes that a measurement rather than an inert scanner, because the identical case-insensitive, whitespace-
bounded scan run over every body in `api`, `internal_api` and `private` does find one that carries the
clause (`reject_client_delete.private`), so the eight refusals are answers and not a pattern that cannot
match. `95_operations_health.sql`'s group S re-reads this paragraph from `pg_proc` on every run, S16 among
its cells, and S16's claim is the body's own `prosrc`: it reads exactly the twelve stores §9's table names
and no others.

| Wrapper | Callable by | Authorisation inside the body |
| --- | --- | --- |
| `api.open_support_case(p_wedding_id, p_category, p_severity, p_summary, p_idempotency_key)` | `authenticated` | owner of that wedding, re-derived from `auth.uid()`; bounded inputs |
| `api.get_my_support_cases(p_status text, p_limit integer)` / `api.get_my_support_case(p_case_ref text)` | `authenticated` | rows whose `requester_user_id = auth.uid()`; host-facing projection only (§5) |
| `api.reply_to_support_case(p_case_ref, p_body, p_idempotency_key)` | `authenticated` | requester of that case, `message_host` arm only |
| `api.create_privacy_request(p_wedding_id, p_kind, p_note)` / `api.get_my_privacy_requests()` | `authenticated` | owner, requester is `auth.uid()` |
| `api.operator_case_queue(p_status, p_category, p_limit)` / `api.get_operator_case(p_case_ref)` | `authenticated` | `actor_is_operator(auth.uid(),'support')`; operator projection including internal notes |
| `api.operator_claim_case(p_case_ref, p_idempotency_key)` / `api.operator_release_case(p_case_ref, p_idempotency_key)` | `authenticated` | `support`; the holder is `auth.uid()`, never an argument. The design's `operator_assign_case` was refused by `C29c` — no callable may name a person in its signature since Stage 2 — so the shipped pair claims and releases the *calling* operator |
| `api.operator_transition_case(p_case_ref, p_to_status, p_resolution_code, p_body, p_idempotency_key)` | `authenticated` | `support`, edge table in a trigger |
| `api.operator_takedown_plan(p_wedding_id)` | `authenticated` | `operations`; read-only, returns the key list §6 step 2 would need |
| `api.operator_takedown_publication(p_wedding_id, p_case_ref, p_reason, p_idempotency_key)` | `authenticated` | `operations` + case + reason vocabulary |
| `api.operator_commerce_review_queue(p_status, p_limit)` / `api.operator_add_commerce_review_note(p_refund_id, p_case_ref, p_kind, p_note, p_idempotency_key)` | `authenticated` | `finance_review` + case; insert-only note |
| `api.operator_privacy_queue(p_status)` / `api.operator_advance_privacy_request(p_request_ref, p_status, p_note, p_idempotency_key)` | `authenticated` | `privacy` + edge table; the advance's replay anchor is the audit row's key, while the host's create door has no key and answers a live duplicate with `replayed = true` (§8) |
| `api.operator_operations_summary(p_window_hours)` | `authenticated` | `operations`, STABLE |
| — not a wrapper — `internal_api.operator_purge_publication_objects`, `internal_api.grant_operator_role`, `internal_api.revoke_operator_role` | **no role at all**: zero EXECUTE grants; reached only by the trusted `postgres` path | see §3 and §11 |

Slices 1–5 have shipped, so this table is measured end to end rather than partly planned: at this head `api`
holds 41 names, `internal_api` 61 and `private` 52 functions, and the nineteen doors above are the ten
support, four privacy and four slice-4 doors plus the health row, which slice 5 wrote.
`q11-logs/s11-s5-doc-probe-2.txt` P2 is the per-name proof of the pairing — 19 of this stage's 22
`internal_api` bodies have an `api` twin and are granted to `authenticated`, 9 of the 22 are STABLE, and the 3
granted to nobody are exactly the names on the table's last row. The pairing runs both ways and is read from
the catalogue: all 41 `api` names have an `internal_api` twin and none is a definer, while `internal_api`
holds 20 names with no door in front of it at all, of which exactly three are this stage's
(`q11-logs/s11-s5-doc-figures-2.txt` sections 7 and 7b are those two counts). The health row's own posture is
the same file's section 4 — `api` side `sql`/INVOKER/STABLE, `internal_api` side `plpgsql`/DEFINER/STABLE,
one `p_window_hours integer` argument, EXECUTE for `authenticated` and for no other role — and group S of
`95_operations_health.sql` re-reads that row out of `pg_proc` on every run, so the table above cannot drift
from the catalogue without the battery failing. The privacy row is also where the design was amended by measurement: the *advance* door
takes the key and the create door does not, because the host's duplicate anchor is the live row itself (§8).
The other amendment is in the same column of this table: `api.operator_takedown_plan` is `operations` + a
read-only projection, and its body returns the key list §6 step 2 would need without touching a byte —
which is why slice 4's fourth refusal cell measures it as a *plan* that a revoked publication can still be
handed to, rather than as a half of the irreversible act (§6).

**No `api` function is granted to `anon`**, so the anonymous door set stays the five §2 measured — which
this head re-measures rather than inherits: `C28a` computes the whole-cluster anon-executable *set* out of
`has_function_privilege` across all five callable schemas, and its expected list takes no stage11 branch on
purpose, so every door this stage opened would have to arrive on that line as a name to pass it. The
catalogue passed the same 106 assertions against slice 4's schema (`q11-logs/s11-s4-historic-1603.txt`) and
against this slice's (`q11-logs/s11-s5-all-1526.txt`, clean chain) — the same total, with `C28b`'s
signed-in set moving by exactly the two halves of one new pair, which is the shape a read-only door leaves
behind. `API33`/`API34`, `C28a`/`C28b` and the Stage 3/7/8 HTTP refusals are
therefore re-run rather than re-explained. The purge body is deliberately *not* exposed. §6 measures it as
the plan in front of the irreversible half, so what the ruling in this section buys is that neither the
plan nor the objects it names can be reached by a request at all: EXECUTE on
`internal_api.operator_purge_publication_objects` is false for `anon`, `authenticated` and `service_role`
(`q11-logs/s11-s4-purge-probe-1.txt`), the `delete` verb lives in the trusted publisher rather than in this
body, and the CLI reaches the plan as `postgres` over the peer-authenticated channel the repository's other
maintenance tools already use.

## 11. The trusted operations tool

`scripts/stage11-operations-cli.mjs`, import-safe and unit-tested like the other three drivers, with
`--secret-env` and `--account-env` for the operator's password and address — both name *variables*, never
values — strict argv (a flag the verb does not take is refused rather than ignored, and `--yes` together with
`--dry-run` is a refusal: a run that both writes and does not is not a plan), and a nineteen-entry banned-flag
list. `OD-40` pins that list at nineteen names and measures each of them refused before any transport exists:
`service-key`, `token`, `price`, `sql`, `url`, `email`, `account`, `secret`, `password`, `apikey`, `anon-key`,
`anonkey`, `publishable-key`, `amount`, `db-url`, `api-origin`, `origin`, `host`, `webhook-secret`.

What stands between this run and a log line is one printer — `makePrinter`, `stage11-operations-cli.mjs:956`,
which is what this section's original `assertSecretFree` sentence should have named — and it has two value
lists and one pattern. Three values may not appear in a printed line at all: the operator password, the bearer
token and the refresh token (`:1015-1016`). A line that carries one raises a `Refusal` naming the *slot* and
prints nothing, because showing the line is the leak. Two are redacted instead: the operator's own address and
the publishable key (`:1017`). And a `postgres://user:pass@` shape is refused on sight (`CONNECTION_STRING`,
`:947`). Both lists are read at print time rather than armed once (`:1013-1018`), because the bearer token does
not exist until the sign-in returns and a printer built with that slot empty would be guarding nothing for the
only answer that ever carries it.

Two boundaries fall out of that shape, and this stage records them rather than repairing them. The first is
the console channel's: credentials are read only when the verb's channel is `http` (`:1028`), so for `grant`,
`revoke` and `purge` both lists are empty and the act's answer is printed under the connection-string guard
alone (`:1083`) — a body that echoed a credential as *data* would be printed. Those three verbs cannot even
name the secret flags: `--account-env` or `--secret-env` on a `psql` verb is refused as a run that has
confused the two channels (`:895-901`, `OD-17`). The second is argv echo: a refusal raised *before* the
credentials are read is printed by a process that cannot yet tell which of those bytes is the secret, so the
two flag sentences describe a value instead of repeating it — `shapeOfValue` (`:682-690`) gives a length and
the class of the first character, `describeContainerName` (`:697-706`) adds whether a dot dragged a hostname
in. What counts as "a name, safe to quote" is one rule, `ENV_NAME = /^[A-Z][A-Z0-9_]*$/` (`:279`, applied at
`:720`), and its boundary is honest: a password that happens to be identifier-shaped, typed where its name
belongs, survives into the "variable … is unset or blank" sentence (`:739-745`) as a variable name the printer
has no slot for. `OD-43` pins the three arms of that rule — absent, bare, misshapen — and the half that never
repeats the value; the exposure is bounded by the fact that the only flags that reach it are the two whose
whole job is to point at a secret.

Two channels, and the split is the security design:

- **Acting as an operator:** the CLI authenticates to GoTrue with the operator account's own
  email/password over loopback and calls the `api.operator_*` wrappers with that access token. This is
  why the same batteries that grant a hostile caller nothing also grant the CLI nothing — the tool's
  authority is the database's decision, read from `private.operator_grants`, and the unit tier drives
  the *identical* RPCs with a non-operator token and asserts the refusal. No service-role key is present
  in this path, in its environment, in a log, or in a captured artifact.
- **Granting authority, and the purge:** peer-authenticated in-container `psql` as `postgres`, the
  `tradition-pack-admin.mjs` channel. `stage10-commerce-driver.mjs:423-424` is the comment above that
  driver's `runPsql` and names the reason in one clause — peer-authenticated, so no password is in this
  process, its environment or argv — and the channel holds no key either, because §10 gave the purge no HTTP
  surface and `--via-docker` accepts only `supabase_db_[A-Za-z0-9_-]+` (`stage11-operations-cli.mjs:911-913`),
  a class that has no dot in it, so no value that passes it can spell a hosted target. Granting cannot depend
  on already having a grant. Both plan first and require `--yes`; `--dry-run` is the default for every
  mutating verb, and `grant`/`revoke` print the exact statement they will run.

Every mutating verb takes a case ref where §5 requires one, and each then prints the two facts §11 owes an
operator afterwards — which audit row this act is, and whether the body answered a replay instead of doing the
work twice — out of the body's own answer and from no other place (`auditFacts` at
`stage11-operations-cli.mjs:992-998`, the sentence at `:1125-1128`). Eight of the ten have an idempotency key
to answer with, and the tool mints one whenever the operator named none (`OD-14`); the two that have none are
`grant` and `revoke`, whose bodies declare no `p_idempotency_key` parameter at all
(`q11-logs/s11-idempotency-param-probe-1.txt`) and whose printed statements therefore carry none
(`q11-logs/s11-grant-revoke-key-probe-1.txt`). How often that sentence has both halves is a property of the
shipped bodies, and the honest measure is the keys each body hands back, read out of its own
`jsonb_build_object`, not the strings its text happens to contain.
Measured that way across the ten mutating verbs: nine name `audit_id` (`case-claim`, `case-release`,
`case-transition`, `commerce-note`, `grant`, `privacy-advance`, `purge`, `revoke`, `takedown`); the tenth
(`case-note`) does not, and is the tenth that writes no `private.audit_events` row either — it appends a case
event, and its own body records the omission as deliberate (`20261020190100_stage11_support_cases.sql:1085`),
so there is no row for it to name. No verb in this build inserts a trail row and leaves the operator without
that row's identity: the set that would have to be non-empty for the earlier version of this sentence to be
true is empty, and `OD-20` now asserts that it is empty. Eight answer a replay in the payload (`case-claim`,
`case-note`, `case-release`, `case-transition`, `commerce-note`, `privacy-advance`, `purge`, `takedown`), and
the two that do not are exactly the two with no key to answer a replay with, so the second half of the
sentence is absent because there is nothing behind it rather than because an answer dropped it. The ten mutating
verbs are ten of this tool's sixteen; the other six are
read doors (`case-queue`, `case-get`, `privacy-queue`, `takedown-plan`, `commerce-queue`, `health`), they write
nothing, and the audit sentence is not printed for them at all (`OD-24` keeps both the audit sentence and the
purge sentence off a read run). The twenty-second body count closes on the other side: sixteen names held by a
verb, and exactly six not held — `open_support_case`, `reply_to_support_case`, `create_privacy_request`,
`get_my_support_cases`, `get_my_support_case`, `get_my_privacy_requests` — which is `HOST_INTAKE_DOORS` printed
as a set and re-measured as a difference (`OD-01` pins those six onto the schema and off this tool). For the
one verb, the tool prints `audit_id (the answer named none)` and records nothing it did not receive: the print
is reachable, measured and pinned (`OD-20` asserts all five lists against the bodies, `OD-21` asserts the tool
never goes looking for a key it was not given). Nothing in the shipped bodies is left for a forward migration
to close. The one asymmetry that remains is `case-note`'s, and closing it would mean making a verb write a
trail row it currently declines to write on purpose — a behaviour change to a shipped door, not a wording fix,
and this stage records it rather than making it.

The first version of that census was wrong, and what was wrong was the instrument rather than the build. The
reader behind it, `payloadKeys` in `scripts/stage11-operations-cli.test.mjs`, counted a key only where a line
began with a quoted lowercase name and ended with a comma, so a key that shared its line with the value beside
it, or that opened a call inline, was invisible to it — and `OD-20` asserted faithfully against what it saw,
which is how a cell passes while the section beside it publishes six verbs where the bodies answer nine. Nothing
failed: the repaired cell is green against the new lists (`q11-logs/s11-od20-after-2.txt`, whose last line is
`code=0`) exactly as the broken one was against the wrong ones (`q11-logs/s11-od20-before.txt`), and that is the
shape of the defect. The repair reads the arguments of each `jsonb_build_object` the
body actually returns, by position and with the quoting state tracked (`topLevelArgs` at
`scripts/stage11-operations-cli.test.mjs:697`). That the difference is the rule and not the bytes is measured
rather than argued: `q11-logs/s11-oldrule-vs-newrule-2.txt` prints the committed HEAD rule out of `git show`,
runs both over one identical text and ends `totals: verbs naming audit_id OLD=6/10 NEW=9/10`, naming the three
the old rule scored silent — `operator_claim_case`, `operator_release_case`, `revoke_operator_role` — each
beside the key list the repaired rule produces from it. `git diff -- supabase/migrations` at this head is empty:
nothing about the product moved, and what moved is what this stage could see.

An earlier draft of this section set the text count against the payload count and called the disagreement the
finding. Measured properly the two counts agree, and what disagreed were two rules. Over all twenty-two
`internal_api` bodies the weak reading — *does the literal `'audit_id'` appear anywhere in the body?* — scores
nine (`q11-logs/s11-door-auditid-census.txt`), the repaired payload reading scores the same nine, and the
difference between the two sets is empty in both directions
(`q11-logs/s11-text-vs-payload-agreement-1.txt`, which prints
both lists, prints each body's key list beside its two verdicts, and refuses to run at all on a body slice whose
parentheses do not balance). The third reading is the wire: the hand-transcribed projections in `EXPECT_KEYS`
(`supabase/tests/api/stage11_operations_http.test.mjs:1345`) carry `audit_id` for `operator_claim_case` and not
for `operator_add_case_note`, and cell A-04 asserts those two sets against live answers at
`q11-logs/s11-http-stage11-a5.txt:35` and `:38`. A body that mentions an audit id without returning one stays
exactly the failure an operator cannot follow up — it is why the rule is argument-position now and not a line
anchor — it just did not occur here. The capture that appeared to show it,
`q11-logs/s11-door-payload-census.txt`, was written by the superseded reader; it is kept as the record of a wrong
answer and not as a measurement, and the re-runnable census beside this section is
`q11-logs/s11-mutating-census.cjs`, whose capture `-2.txt` emits all five lists under both rules so that `OD-20`
can be re-derived from outside the repository. The cell keeps its teeth by controls rather than by the lists
alone: it pins `case-claim`'s entire key set, and it requires that no word of the commerce body's `p_kind`
vocabulary — read out of that body's own guard — surfaces as a payload key, which is what makes the nine a count
of returned fields rather than of quoted strings anywhere in a body. The unit file is green
against these bytes — forty of forty, exit code on the last line of `q11-logs/s11-cli-unit-docs-4.txt` — and so
is the whole node unit tier: sixty-four files and 1415 tests, `q11-logs/s11-unit-full-docs-4.txt`, a run taken
after the last word of this section was written because one of its cells reads this file. The tier's
first run at this state is kept rather than overwritten, because its five failures are a host fact and not a
product one: 1357 tests passed and five `src/test` suites, none of them Stage 11, failed to *load* with
`ENOSPC: no space left on device` (`q11-logs/s11-unit-full-docs-1.txt`) on a volume holding 1.1 GiB free. Those
five, run alone, are 58 tests green with `code=0` (`q11-logs/s11-unit-enospc-isolation-1.txt`), and
1357 + 58 = 1415 is the total the re-run with one file worker at a time also printed — three readings of the
same tier, so the gap is a full disk and not a missing test.

What the superseded file also carried, and what this section quotes elsewhere, is the declaration census, so it
was re-measured rather than trusted: these six migrations hold 58 declaration sites over 56 distinct names —
19 `api`, 22 `internal_api` and 15 `private` names, which is 19, 23 and 16 sites — the two extras being
`internal_api.operator_release_case` (`20261020190100_stage11_support_cases.sql:1244`, re-declared at
`20261020190200_stage11_closed_is_terminal.sql:213`) and `private.guard_support_case_update`
(`20261020190100_stage11_support_cases.sql:204`, re-declared at
`20261020190200_stage11_closed_is_terminal.sql:63`), both by slice 2's own closure repair.

Exit codes follow the existing convention: 0 answered, 2 a refusal that *is* the designed answer — a denial, a
held state, or one of the seven SQLSTATEs this build ships with (`:417`: `42501`, `23503`, `23505`, `23514`,
`P0001`, `22001`, `22023`; anything outside that list is an instrument failure, and the run says so), and 1 an
instrument or transport failure. Two catch shapes implement it, and the difference is what a reader can rely
on: a plan-stage failure prints one line and no run record (`:1034-1037`), because there is no plan to record
yet, while a target-stage failure prints the refusal *and* the record (`:1136-1159`), with an inner catch that
prints only that the failure could not be reported without a credential when the record itself would be the
leak. `health` is the one verb that carries a second read, and it is where this stage's own honesty rule lives:
the tool prints the census as two figures — files on disk under `supabase/migrations` against the versions the
database names — and which arm of `migrations` a reader gets is the database's decision rather than this
section's: on the runner chains the batteries run on the block answers `not_measured`, because
`supabase_migrations.schema_migrations` resolves on none of them, while on the shared `localvivaahvarnam`
stack the CLI owns that table and the same projection answers `measured` (§9). What that paragraph could only
forecast has since been read: `A-07` runs the `health` verb there and asserts its exit code, the door's top-level
field list and that neither stream carries a credential, so it names no block status, and at the time no case
that had run did — group H had never executed. It now has (`q11-logs/s11-runtime-2-stage11-http-5.txt`: `H-01` …
`H-05`, 5 pass, 0 fail, `node_test_exit=0`), and `H-01` is the case that derives the live `to_regclass` flag and
pins the field list to the arm it selects, so the answer it prints is the stack's, not this section's:
`the migrations branch answered 'measured' against to_regclass=true`, with the derived absences
`["auth_failures","rate_limits","token_abuse"]` beside it. The `not_measured` arm stays the SQL tier's fixture
alone: re-enacting it here would mean dropping the tool's real table, which is a destructive reset of a stack
this stage does not own. `describeCensus` (`:1170-1196`) then says which figure it does not have
rather than implying the pair matched; measured at this head, the one it has is 37 files, highest version
`20261020190500`, none of them unversioned
(`OD-50` counts, `OD-51` prints the five arms, `OD-52` runs both verdicts against this repository's real
directory). No cell in this tier therefore claims a migration was applied: a static read of the directory and a
run against the stack are two different answers, and this section says so in the tool's own words.

Three reading behaviours are kept exactly as they ship, and all three are sentence-quality rather than
security-quality. `assertLoopback` (`:440-456`) tests the hosted mark before it tests the host: `:448` runs
`/supabase\.co|supabase\.io/i` over the whole origin string while `:452` compares the parsed `hostname`, so
`http://127.0.0.1:54321/supabase.co`, `http://127.0.0.1:54321?target=supabase.io` and
`http://supabase.co.localhost:54321` are each refused with the hosted sentence although their hostnames are
loopback, loopback, and a loopback-suffixed name. `OD-44` measures all three at `:2202-2211` — exit 2, zero
requests, `HOSTED_MSG` — and its own comment records the ruling: the run refuses either way and prints the
stronger of the two sentences. The direction is the safe one, and the escaped dots in that pattern are why a
value like `supabaseXco` is not this case. `readEnvFile` (`:461-472`) folds a repeated key by taking the last
line, and a last line that is blank yields a blank value, so a `.env.local` naming `SUPABASE_LOCAL_URL` twice
never says "you have this key twice"; the run dies at the loopback refusal or the no-key refusal instead. That
fold is pinned rather than assumed — `OD-41` asserts both halves at `:1944-1945` and names the row in `OD-44`
it explains — which is why it is a wording note here and not a boundary.

The third behaviour has no cell behind it, and is recorded as unproven-by-test rather than as a defect.
`classifyHttp` (`:552-573`) reads the database's sentence with `body?.message ?? …` at four points (`:555`,
`:563`, `:567`, `:571`), and `??` makes an explicit `"message": null` and an absent `message` key the same
shape: both fall through to the arm's own wording — "(the database gave no sentence)", the no-credential
sentence, or the body printed as JSON. What that function *is* built to keep apart is measured, at the eleven
`classifyHttp` sites inside `OD-53` (`:2468-2561`, the calls running `:2482` to `:2543`): a missing door in both
of its arrivals, each of the seven designed states with the database's words carried through, `401` and `403`
both with and without a body, the residue, the 200- and 300-character caps, a `body` that is `null`, and a
`PGRST202` that arrived with a 200 — and the verdict's text then goes to the printer unchanged, where the
connection-string guard throws before a byte is written (`:2543-2549`). None of the eleven passes a body whose
`message` is present and null. The exit code does not move in that case either — `42501` with
`message: null` is still exit 2, because the classification reads `code` and never the message — and the
fallback sentence is honest about a body that carried no words, so no repair is proposed and none is claimed.

## 12. Invariants each table carries in the DDL

Rules that are only written in §5–§9 are rules the next migration breaks, so they go in the schema:
every new table gets `set_updated_at` where it has `updated_at`, `reject_client_write` +
`reject_client_delete` backstops, `ENABLE ROW LEVEL SECURITY` with **no policy**, no grant to `anon`,
`authenticated` or `service_role`, and non-blank CHECKs (`length(btrim(…)) > 0`) on every text it will
echo. Bounded lengths (`host_summary ≤ 2000`, note/message `body ≤ 4000`) are CHECKs, not application
promises, because the function that writes them is not the only thing that can ever insert. Every FK to
`public.weddings` is **NO ACTION** and every FK to `auth.users` this stage adds is `ON DELETE SET NULL`
except `operator_grants.user_id`, which cascades deliberately: an erased account must not leave a live
operational grant pointing at nothing, and §2 measured that cascade posture is the only guard that
survives a parent delete. The stage **adds eight** `auth.users` edges through slice 4 — two in slice 1
(`operator_grants.user_id` CASCADE, `operator_grants.granted_by_user_id` SET NULL), four in slice 2
(the three `support_cases` attribution links and `support_case_events.actor_user_id`, all SET NULL), one in
slice 3 (`privacy_requests.requester_user_id`, SET NULL) and one in slice 4
(`commerce_review_notes.author_user_id`, SET NULL) — listed as a closed set in `40_catalog.sql` C46 and
counted from `pg_constraint` on the built chain rather than from this paragraph
(`q11-logs/s11-s4-doc-probe-1.txt` sections D and E read all nine edges into `auth.users` that the survey
finds, eight of them the stage's and `audit_events.actor_user_id` the older one, each with the ON-DELETE
posture this paragraph names beside it). Slice 3 also adds the stage's **second** `public.weddings` edge on
the same NO ACTION rule, `privacy_requests_wedding_id_fkey`, which C46 names beside the single support edge
and C48 accepts as unindexed for the measured reason §8 gives — the draft called it the stage's third edge
"beside the two support edges", and `q11-logs/s11-s4-doc-probe3-1.txt` section L is the reading that says
otherwise: `private` holds exactly two edges into `public.weddings` that this stage wrote, so slice 4's note
table adds neither. It reaches its wedding through the case it cites rather than by naming one, which is the
same one-data-model rule that keeps §7's queue a projection over Stage 10's tables instead of a copy of
them. `audit_events.actor_user_id` is not one of them: that SET
NULL edge predates the stage (`20260925120400_stage2_assets_entitlements_secrets.sql:98`), which is why
the trail's guard had to accommodate a link it did not add. `case_ref`/`request_ref` uniqueness is the
idempotency anchor for the §5 rule,
and `support_case_events (case_id, seq)` and `(case_id, idempotency_key)` are unique.
`invitation_outputs` gains **no** column: Stage 9's vocabulary already carries `publication_revoked`, and
a new reason would be a new word for a fact that has one.

Four row guards are specialised rather than absolute, for the same measured reason, and this is the one
place a reader should not have to infer it from a battery. `private.audit_events` lets exactly one UPDATE
through — an attribution link going to NULL at `pg_trigger_depth() = 2`, which is the database carrying
out its own `ON DELETE SET NULL`, compared by exclusion so nothing else may ride along. `private.
support_cases` clears the same exception for its three `auth.users` links and keeps `opened_at` and
`open_idempotency_key` unconditional, because those are provenance *facts* rather than links to an account;
on a `closed` row it additionally lets the referential null through the terminal wall, again by exclusion
and only at depth 2, so the declaration "the ticket survives its requester" holds for every status.
`private.privacy_requests` repeats the construction one queue over: its UPDATE guard lets the requester
link go NULL at depth 2 and nothing else about the row move — `request_ref`, `wedding_id`, `kind`,
`host_note` and `requested_at` are refused unconditionally, and a *statement's own* NULL at depth 1 is
refused with the same sentence as a hand-off (`D01`, `D02`) — so a request that was declined or satisfied
still survives its requester. `private.commerce_review_notes` repeats it a fourth time, on the column this
stage cannot afford to lose loosely: its UPDATE guard compares the rows *by exclusion* — `(v_new -
'author_user_id')` against `(v_old - 'author_user_id')` — so a column a later slice adds is refused by
default rather than allowed by omission, and the one mutation it admits is the author link going to NULL at
`pg_trigger_depth() >= 2`, which is the only way the erase of a reviewer's account can be carried out on a
note without also letting that note be edited. The insert half is a separate `BEFORE INSERT` guard rather than a CHECK,
because a CHECK on the same column would be re-evaluated on every UPDATE and would then refuse the
database's own referential action — slice 4 wrote the same pair of halves for the same reason, and its
migration records the consequence the other three did not have to state: kept as a CHECK, the
require-an-author rule would not merely refuse a forged note, it would make every reviewer who ever
annotated a refund impossible to delete. Everything at depth 1 — every statement a caller or a body can issue —
is refused with the same sentence as before. Measured by `85_support_lifecycle.sql` T49/T50 (the
refusals), T-RI1/T-RI2 (the accepting half) and T65–T72, with the depth itself measured by
`q11-logs/s11-depth-probe.sql` and the closed-row half by `q11-logs/s11-closed-ri-probe.sql`; the privacy
half by `90_privacy_intake.sql` `D01`–`D08b` (the refusals, including the NULL note and the terminal row)
and `D13`–`D15` (the accepting half, with the new physical tuple as the proof the action executed), and the
note half by `92_takedown_and_oversight.sql` `O01`–`O10` (a client INSERT, UPDATE and DELETE refused, then
the owner's *own* hand refused twice — `O04` an edit of the text, `O05` the exact hand-null shape the
foreign key produces — plus the order/refund disagreement trigger and the author-less INSERT) and
`O11`–`O16` (the author's account erased, the note surviving with every other byte identical, the trail and
event rows surviving with the id nulled, and the money digest unchanged).

## 13. Threat model → control → test

Four vocabularies again, because each tier names its own cells: unit `OD-*`
(`scripts/stage11-operations-cli.test.mjs`), SQL batteries a letter and two digits grouped per battery
(`80_operator_authority.sql`, `85_support_lifecycle.sql`, `90_privacy_intake.sql`,
`92_takedown_and_oversight.sql`, and `95_operations_health.sql`, which slice 5 wrote), the race tier prefixed
`RC*`/`RD*` for
the same reason Stage 10 gave — **and that prefix names twenty-five declared cells, in `82_race_arm1_asserts.sql`,
`83_race_arm4_asserts.sql` and `84_race_replay_asserts.sql`, all twenty-five of which have now executed and passed
on a real engine — the four rows below that cite a `RC*`/`RD*` cell each name the two run logs** —
HTTP dashed (`A-*` authority, `C-*` cases, `T-*` takedown, `R-*` refund
oversight, `V-*` privacy, `H-*` health), and audit-integrity cells `AI-*`. **A citation that no run log
carries is a claim, not evidence**, so this table is written before the code and re-read after the
batteries, and any row whose arm did not run says so in the Stage 11 audit rather than here.

Slices 1–5 have now run, so the third column is split rather than rewritten: `M:` ids are in the log of
the battery that owns them. At this head `q11-logs/s11-s5-all-1526.txt` reports all five batteries on one
chain — `80_operator_authority.sql` 137, `85_support_lifecycle.sql` 641, `90_privacy_intake.sql` 191,
`92_takedown_and_oversight.sql` 208 and `95_operations_health.sql` 626, each with the same number of
`NOTICE:  PASS` lines as its reported total — and the earlier per-slice logs beside the numbers below
(`s11-s4-authority-1619.txt`, `s11-s3-st11qual_authority3-80_operator_authority.txt`,
`s11-s3-authority3-85_support_lifecycle-2.txt`, `s11-s3-authority3-90_privacy_intake-2.txt`) are kept
because those are the runs in which each cell first went green. A battery's number is re-measured at each
head, not inherited: 137, 641, 191 and 208 are the same figures slice 4 logged, because slice 5 moved
*figures* inside those four files rather than adding cells — `80_operator_authority.sql`'s
`A06a`/`A06b`/`Z07`/`Z07b`, `85_support_lifecycle.sql`'s S09/S10/S10b, `90_privacy_intake.sql`'s S10/S10b and
`92_takedown_and_oversight.sql`'s T13/T14/T17 now read 41 / 61 / 52 / 47 where slice 4's log records the same
census cells reading 40 / 60 / 52 / 46 — and the `p:` arms left in the table below are HTTP, browser and unit
citations, of which the HTTP set is now bounded rather than open-ended: `supabase/tests/api/stage11_operations_http.test.mjs`
declares 38 cells (`A-01`–`A-07`, `C-01`–`C-09`, `T-01`–`T-05`, `R-01`–`R-05`, `V-01`–`V-04`, `AI-01`–`AI-03`,
`H-01`–`H-05`), and all thirty-eight of them have now run green on this branch's stack — §16 names the log, which
carries `tests 38 / pass 38 / fail 0` beside `node_test_exit=0` and an empty `declared_not_run` — so the HTTP
scope that paragraph bounded at twenty-two outstanding cells is closed, and what those `p:` arms leave unrun is
the browser tier. No `RC*`/`RD*` cell is among them, because those are race-tier cells and the race tier answers
through `run.sh race`, not through an HTTP log; that tier has since been authored, executed twice and passed, and
its 34 counted cells are reported in §13's four rows and §16 rather than counted here. The families `80_operator_authority.sql` actually measures are
`A01-A26b` (the state the migrations ship, then every privilege refusal role by role), `R01-R17` (the
shape of what the two bodies refuse to write), `W01-W15b` (the success path, grant and revocation),
`T01-T11c` (`actor_is_operator`'s truth table), `K01-K09b` (the grant row's own CHECKs and its partial
unique index, reachable only by a hand plant), `AI01-AI24` (the trail) and `Z02-Z07b` (the census; `Z01`
prints the CENSUS line rather than a PASS, which is why the two numbers agree rather than differ).
`85_support_lifecycle.sql` measures the support lifecycle through its own `s11b` helpers and
`90_privacy_intake.sql` the privacy intake through `s11q`. `92_takedown_and_oversight.sql` runs through
`s11t` and in eight groups, each of which owns a letter: `T01-T29` (what the migration ships, before this
file writes a row — columns, CHECKs, the four FK delete rules, the five triggers, the RLS-with-no-policy
posture, the zero client grants, and the six census cells T13-T17, which slice 5 moves three of — T13 to 41
wrappers, T14 to 61 bodies, T17 to 47 definers — while T15 stays 52 because this slice adds no `private`
name), `P01-P12` (the plant it built,
and the digests every later group re-reads), `K01-K51` (the plan door, the takedown's effect set, its
credential and artefact half, its replay anchor and the second wedding it must not touch), `U01-U27` (the
purge planner: its zero-grant exposure, the four preconditions, and the wall that refuses it a browser),
`Q01-Q22c` (the refund queue as a read that cannot become a verb), `N01-N30` (the note door, its derived
`order_id`, its replay and its thread), `O01-O16` (the walls around the note and what survives its author)
and `Z01-Z14` (the census read both ways — and unlike slice 1's `Z01`, this file's is a measured cell, so
its 208 is 208 PASS lines with no CENSUS line excluded). `95_operations_health.sql` runs through `s11h` and
in fourteen letter groups, one per thing this answer could be wrong about: `B0`-`B0c` (the door read before
this file plants a row, so every liveness cell below is a measured delta rather than a coincidence), `C`
(§9's block and field inventories asserted as keys rather than as a paragraph), `W0`-`W9f` (the window: its
default, its bound as it appears in the answer, and no `newest_at` in a future `as_of` does not share), `S0`-`S18`
(the pair's posture, out of `pg_proc`), `A` (the four authority shapes, each reached as the role that would
reach it), `L0` (non-vacuity, leaf by leaf), `V` (the vocabularies compared against the constraints that
enforce them rather than against a list), `M` (every partition required to close over its own total), `I1`-`I13`
(the privacy boundary as a scan), `P` (the legality of the plants, read from the catalogue that made them
legal), `T` (the rules the credential block counts through), `D` (the delivery attempt ceiling), `N1`-`N45`
(the migrations branch built as a fixture in one transaction and undone in the same one) and `R1`-`R38` (the
body cannot write, measured rather than believed) — the `Z` section being the floor emitter rather than a
cell, which is why this battery's letter census counts fourteen and not fifteen. A slice-1 id in the table
below is read from `80_operator_authority.sql` by long-standing convention; a cell from any later battery
names its file beside the id, because the letter vocabularies overlap — which slice 4 proves rather than
illustrates, since `T` is slice 1's predicate family, slice 2's shape group and slice 4's own, and `Q` is
slice 2's queue and slice 4's queue; slice 5 proves it harder, because `95_operations_health.sql` uses
fourteen letters and twelve of them are letters another battery was already using.

Five consequences of measuring rather than planning, all recorded here because a later slice would
otherwise inherit them silently. First, the letter `R` was allocated in this section to refund oversight
and `T` to takedown before either battery existed, and slice 1 needed both letters for grant validation
and the predicate — so the rule was that later batteries take letters the first battery does not own
(`A`, `R`, `W`, `T`, `K`, `AI` and `Z`). Slice 2, slice 3 and slice 4 then reused letters anyway, because
batteries written a slice apart converge on the alphabet; the rule is withdrawn and the convention that
replaces it is that a citation names the battery file beside the cell id. The collision is now measured
rather than conceded, and measured twice. Slice 4's census is
`q11-logs/s11-s4-letter-collision-1.txt`, taken from the four battery files' own first arguments: of the
twenty-one letters those four use, twelve are shared — `A` and `R` in batteries 1–3, `G`, `S`, `V` and `X`
in 2 and 3, `K` in 1 and 4, `O` in 2 and 4, `P` in 2–4, `Q` in 3 and 4, `T` in 1, 2 and 4, and `Z` in all
four — and nine belong to exactly one file: `AI` and `W` to slice 1, `C` and `L` to slice 2, `D`, `H` and
`M` to slice 3, `N` and `U` to slice 4. Slice 5 re-took it over five files
(`q11-logs/s11-s5-letter-collision-2.txt`, printed by `q11-logs/s11_s5_letter_collision.sh`), and because
that script also restricts the same two computations to the first four batteries, slice 4's split is
re-derived here rather than restated: `SHARED_FIRST_FOUR=12 OWNED_FIRST_FOUR=9` over 21 letters, identical
to slice 4's log, and across all five `SHARED_ACROSS_FIVE=18 OWNED_ACROSS_FIVE=5` over 23. Six of slice 4's
nine exclusive letters stopped being exclusive, because `95_operations_health.sql` uses `W`, `C`, `L`, `D`,
`M` and `N` as well; what is left owned by one file is `AI` (80), `H` (90), `U` (92) and slice 5's own `B`
and `I`. The re-take also fixed two shapes in its own first draft before it printed anything, and both were
defects in *this* script rather than in slice 4's census — which enumerates all four of its files and
prints no bogus letter family. A file glob of `8[09]*.sql` matches `80_` and `89_` and silently skips `85_`;
and a first argument counts as a cell label only when it has a label's shape, because
`s11t_owner('SELECT …`) (12 sites), `s11t_t('SV-ZZZZZZZZ`) (2) and `s11q_adv_sql('PR-…`) (2) pass a
statement or a reference value where a label would sit, and an unfiltered census reads them as families
named `SELECT`, `SV` and `PR`. The control that says the wider instrument has not changed the population it
measures is the per-file inventory: 7, 12, 12, 8 for the first four batteries under both methods, even
though the raw per-letter counts differ, because this pattern also allows digits inside helper names.
Second, the
file's own number moved: this section planned `90_takedown_and_oversight.sql`, and `90_` was already taken
by slice 3's privacy battery, which the same `authority` chain runs before this one and in the same glob
(`run_stage11_batteries()` matches `supabase/tests/stage11/[89]*.sql`, and the comment above that loop now
records all four arrivals — `85_`, `90_`, `92_` and `95_`). A fourth battery therefore had to arrive
between `90_` and the then-unwritten `95_`, and the order is load-bearing rather than cosmetic — group P
inherits tickets, threads, grants and trail rows from batteries 1–3 on that one chain, which is exactly why
P10, P11 and Z10 count the plant's own five case ids instead of `private.support_cases`, and why the money
and artefact absolutes in O15 *can* be cluster-wide: no battery before this one writes a refund. Third, one
planned control turned out to be partly false and the measurement is what found it: the audit-rewrite row
below carries `AI11` as the *limit* of the control rather than as a pass, and both `40_catalog.sql`'s
`C15` and Stage 10's `N04b` had to be re-measured because this stage **removes** a privilege rather than
adding one — a direction neither instrument was written to see, and §15 and §17 record both repairs.
Fourth, the cell count is not the assertion: `90_privacy_intake.sql`'s 191 includes `M21`–`M22`, whose
twenty probes all roll back, so a green total is only meaningful beside the census `Z01`–`Z12` that reads
the surviving state back. Fifth, slice 5's battery made the total itself need two sides, because it is the
first file this stage wrote whose cell count is also a hard-coded expectation the file holds about itself.
The runner's `suite … lines` style compares the `PASSED (n)` a battery prints with the `PASS` lines it
counted, and `q11-logs/s11-s5-runner-shape-verdict-3.txt` records the pair agreeing at 626 with `exit=0` and
`failures=0`; that is only half an instrument until the number is broken, so the other side is a mutant of
the battery's own floor — the shipped file with its two executable `626`s rewritten to `627`, and the run
*fails* rather than merely reporting differently: `q11-logs/s11-s5-floor-recheck-3.txt` prints
`mutant_exit=3` with 626 PASS lines, no reported total at all, and the message naming both numbers, beside
`shipped_exit=0` for the unmutated file on the same chain in the same wrapper. A green 626 therefore means this
file emitted 626 cells *and* its floor expected 626, which neither instrument asserts on its own.

| Threat | Control | Cases |
| --- | --- | --- |
| Anonymous caller reaches any operational surface | `private` not in `config.toml:32`; zero `anon` EXECUTE on every new wrapper | `M:` `A09`, `A10` (the grant table refused at the schema layer, before any object check runs), `A17` (the predicate unreachable), `A20`, `A23` (both bodies unreachable). Slice 4 opens four more doors and closes all of them at the same layer: `92_takedown_and_oversight.sql` `K01` (anon cannot even reach the plan), `Q01` (nor the refund queue), `N01` (nor the note door) and `U01`-`U05` (the purge holds EXECUTE for nobody — `U02` refuses the very operator whose grant was revoked, `U03`/`U03b` stop the service role one wall earlier than the client roles, `U04` measures that there is no `api` wrapper to route around, `U05` reads the access list itself). The cluster-wide half is `40_catalog.sql` `C28a`, re-run at this head against a schema containing slice 4 (`q11-logs/s11-s4-historic-1603.txt`). `p:` HTTP `A-01`, `H-05`, `API33`/`API34` |
| A signed-in host operates on someone else's wedding | ownership re-derived from `auth.uid()` in every body; one shared SQLSTATE and sentence for "not yours"/"not there" | `M:` no slice-1 cell exists for this row, because the grant table is account-scoped and no wedding is involved — and the row is kept rather than dropped so the reader can see which arm is still only a claim. The adjacent measured refusals are `A11`, `A12`, `A21`, `A24`. `85_support_lifecycle.sql` `X00`–`X32` and `90_privacy_intake.sql` `X01`–`X06` are the case and privacy halves: a foreign wedding and an invented one answer identically, a host citing somebody else's request is refused, and the other kind on the host's own wedding is allowed because ownership, not the queue, is the scope. `92_takedown_and_oversight.sql` measures the same refusal on the four doors slice 4 opens: `K02` (a wedding's own host, authenticated and holding no grant, is refused the plan) and `K03` (the hostile caller gets that same sentence, not a different one), `Q02`/`Q03` (a host cannot see the refund ledger it is standing in, nor can a stranger, in one sentence), `N02` (the refund's own host is refused a note) and `N06` (another wedding's ticket cannot carry a note about this wedding's refund). The scope half is measured too: `K20` refuses another wedding's ticket cited against this wedding, `K35`/`Z14` prove no credential outside the two weddings this file takes down was revoked, and `K47`/`K48` keep one operator's act on the wedding it cited. `p:` HTTP `C-04`, `T-03`, `V-03` |
| A signed-in host operates on **their own** wedding without operator status | `actor_is_operator` before any scope work; the table has no client grant to write | `M:` `A18` (the host is refused before the predicate is entered), `80_operator_authority.sql`'s `T01`-`T05`, `T07`, `T08` (no session, an account holding nothing, a uuid that is no account, an unknown duty word, a NULL, and the scopes never granted — all answer false rather than raising), `T10` (the human who minted every grant holds nothing themselves), `T11` (a live row past its expiry answers false). Slice 4 reaches the same owner from four directions and refuses all four: `92_takedown_and_oversight.sql` `K02` (the wedding's own host, authenticated, holding no grant, cannot even plan a takedown), `Q02` (cannot read the refund queue), `N02` (cannot annotate its own refund) and `N04`-`N08` (a refund id that names no row, a guessed ticket ref, another wedding's ticket, a parked and a resolved case all answer in the same sentence, so the door cannot be used to probe what exists). `p:` HTTP `A-02`, `A-03`, `T-01` |
| Self-granting operator scope | no surface at all: zero EXECUTE on `internal_api.grant_operator_role` for every role, RLS with no policy, `reject_client_write`; reachable only from `postgres` | `M:` `A02`, `A02b` (RLS enabled with zero policies, which is the pair that makes the posture mean something), `A03` (no DML for any role a request can arrive as, server key included), `A05`, `A05b` (`internal_api` only, no `api` twin), `A20`-`A25` and `AI02` (both bodies, three roles, then the whole matrix), `A26`, `A26b` (and the count is still zero), `80_operator_authority.sql`'s `K01`-`K09b` (eight hand plants refused) and `Z03`, `Z04`. Slice 4 adds the doors a self-granted scope would need: `92_takedown_and_oversight.sql` `U01`-`U05` (the purge is executed by nobody — not anon, not the operator whose grant was revoked, not the service role, and there is no `api` wrapper to route around, because its access list grants EXECUTE to nobody but the owner), `T11` (twelve of twelve role/verb pairs on the oversight table are false), `O01`-`O04` (a client role cannot insert, edit or delete a note and neither can the table's owner, whose hand is refused by the append-only trigger rather than a privilege), and `K04`/`K05` (a live grant in the wrong scope and a revoked `operations` grant are refused in the same sentence as no grant at all). `p:` HTTP `A-04`, `A-05`, unit `OD-12` |
| Forgery of the actor in an audit row | §4's split, not one rule: no client-reachable callable takes an actor id, while the three service-only bodies this stage wrote do take `p_actor_user_id` — the grant pair and slice 4's purge planner — protected by the role that is the only one able to reach them, by a refusal of any decider that names no account, and by `40_catalog.sql` C29c-b holding the whole identity-taking set closed at nine names (six commerce, two operator-grant, one purge) with EXECUTE false for every browser role on each | `M:` `80_operator_authority.sql` `R05`, `R06`, `R12` (beneficiary and decider both checked against `auth.users`, on each side), `W04`, `W04b` (the audit actor and the grant's subject are different columns, and the kind is `maintenance`), `AI15`-`AI18`, `AI22`; slice 4's half is `92_takedown_and_oversight.sql` `U06`/`U07` (the purge refuses a NULL actor and an id that names no account *separately*, because the second is a forged attribution and the first is merely an anonymous one), `U08`-`U10` (a wrong-scope grant, a revoked grant and a finance reviewer all fail to name an actor), `U16` (the trail row takes its decider from the argument, since this channel has no session to read) and `O07` (a note that names no author cannot be inserted at all). `p:` HTTP `AI-01`, `C-09` |
| Audit rewritten or deleted after the fact | `reject_audit_update_except_referential_null` on `private.audit_events` refuses every rewrite by every role including its own owner, with one measured hole: an attribution link going to NULL from inside the database's own referential trigger at depth 2. UPDATE and DELETE are both revoked from `service_role` | `M:` `A08`-`A08c`, `AI01`-`AI10` (six refused mutations, then the whole trail digests identically and the row they aimed at re-reads byte-identical), `AI12b`; `85_support_lifecycle.sql` T51 (a hand nulling `actor_user_id` at depth 1 is refused) and T-RI2f/T-RI2g (the erase of the named account nulls the link, moves no other byte, and deletes no row). **`AI11`/`AI11b` is the limit of the control, measured rather than glossed**: `service_role` keeps INSERT — it must, or 29 existing audit-writing sites stop working — so the cell requires a forged append to *succeed*, and the owner's DELETE is `AI12`; the revocation itself is re-read at this head from `pg_proc`-adjacent ACLs in `q11-logs/s11-s4-doc-probe-1.txt` section G (`service_role`: UPDATE false, DELETE false, INSERT true). Slice 4 holds the same line from the other side: `92_takedown_and_oversight.sql` `K38`/`K39` (one trail row per act, in the shape §4 requires, with a before/after pair that is a single-field object), `K46` (a refusal leaves no trail row behind), `U23` (the two append-only stores grow by exactly one row each for an accepted act and no more), `N19` (the note's before/after pair is the *same* value, which is what "the refund kept its history" means) and the group `Z03`-`Z06` census, which reads the ledger and the trail against each other both ways and shows the four replays in this file wrote no trail row at all. `p:` HTTP `AI-02`, `AI-03` |
| Duplicate or replayed operator action | `audit_events.idempotency_key` unique; each body pre-reads the key and returns the recorded answer; second delivery acts on nothing; the privacy create door's anchor is the live row itself, because it takes no key | `M:` `AI13` (a second delivery of one key collides with the partial unique index), `AI14` (two keyless rows still coexist, which is the other half), `AI21` (an over-long key is refused with its own bound), `W08`, `W08b`, `W14`, `W14b` (a duplicate grant and a double revocation each refuse without writing), `85_support_lifecycle.sql` `R` group (the case queue's replay), `90_privacy_intake.sql` `H01`–`H03b` (a live duplicate answers `replayed = true` and writes no row) and `R01`–`R10b` (one key, one audit row; the replay reads the recorded answer and moves neither the request nor the trail). `92_takedown_and_oversight.sql` measures the replay on each of its three doors and on the key as one namespace: `K26` (a takedown with no key is refused — two clicks on one wedding must take it down once), `K42`/`K43`/`K44` (the same key is answered again with the *first* delivery's payload, reason and audit id, and writes nothing — one trail row, one event row, and nothing else moved), `K45`/`K46` (a fresh key on an already-down wedding is refused by the state rather than the key and leaves no trail row), `U11` + `U21`/`U22` (the purge planner requires its own key, re-plans under it with a current key list, and grows neither store), `N12` + `N21`/`N22` (a note with no key is refused; one key is one note), and `N27`-`N29`, the half the naive design misses — a key already spent on another refund, another body or another act is *refused* rather than answered with somebody else's recorded result, and the collision is symmetric across the three bodies. `Z06` closes the row: the four replays this file ran wrote no trail row at all. `p:` HTTP `C-07`, `T-05`; race half **executed**: `84_race_replay_asserts.sql` declares `RD00`–`RD07` (two operators delivering one key to two different weddings at the same moment, the loser's own completed work undone by the trail index it died on, then the same key shapes met serially through the shipped doors), and `82_race_arm1_asserts.sql` counts arm 2's replay as `RC07`–`RC09`. Both suites have now run, twice each — `q11-logs/s11-race-run-6.txt` and `q11-logs/s11-race-run-7.txt`, each ending `race_runner_exit=0` with `STAGE11 RACE TESTS PASSED (10)` beside the arm-1 file and `(8)` beside the replay file, the second of the two at the pushed head `9bd83ca0f177fc0430854a618b413085dad500af` with a clean work tree and per-file byte identity proven in `q11-logs/s11-race-commit-bytes-check-1.txt`. What they settle is the half the serial battery could only plan: the second delivery of one live key **answers** rather than acts — its own session log reads `B2_ANSWERED=replayed-record-answer` with `B2_MATCHES_STORED=audit-id-equals-stored-row` (the recorded answer carries the first delivery's audit id 14), while `RC07`–`RC09` re-measure the same claim from a backend that took no part in the race: one trail row for the key and one for the wedding, that row's payload a complete record of the *first* delivery, and nothing at all moved in any of the four stores the body writes — two deliveries leave one revoked credential, one invalidated artefact, one thread row and one trail row, which is the difference between a replay and a second revocation. The cell also names the mechanism instead of leaving it to be inferred: the pre-read at the top of the body is what answered the second delivery, so the unique index never had to fire — and one key spent across two weddings is refused inside the loser, `B3_OUTCOME=RAISED 23505` on the trail index, whose post-rollback re-read `B3_OWN_VIEW_AFTER_ROLLBACK=pub=active tokenlive=1 ready=1 keyrows=0 threadrows=0` says the wedding it aimed at is still published with its credentials live and its artefacts ready and not one trail row or case event survives the act that died. `RD00`–`RD02` read that same collision from the committed side, `RD03`–`RD05` meet the three key shapes serially through the shipped doors, and `RD07` closes the census, so this row's concurrency half is a result and not an instrument |
| Race: two operators take the same wedding down at once | one active publication per wedding, `FOR UPDATE` on the publication row, the state machine's terminal `revoked`, one idempotency namespace | `M:` the serial half only, because slice 1 has no publication surface to race and slice 4's battery is one session — so what it can prove is the state machine, not the second session: `92_takedown_and_oversight.sql` `K26` (no key ⇒ refused, so two clicks cannot be two acts), `K42`-`K44` (a second delivery of one key answers the first payload and moves nothing), `K45`/`K46` (the state is the second lock: a new key on a wedding already down is refused by the publication's own state, not by the key, and writes no trail row), `U25` (one idempotency key cannot be spent on two weddings) and `Z11` (the file retires exactly the two publications it claims and no third). `p:` **executed**: `71_race_arm1_a.sql` and `72_race_arm1_b.sql` are the two live sessions this row always lacked — A takes w1 down under its own key and holds open, refusing to commit until it has seen B ungranted on B's *own* transaction id, and B, a different operator with a different ticket and a different key, is the one that has to answer for the second lock; counted by `82_race_arm1_asserts.sql` `RC00`–`RC06`, which read the committed residue from a backend that never took part. The question the serial battery could not settle — which of the body's two locks serialises, and whether the refused operator left a mark — is answered in both runs (`q11-logs/s11-race-run-6.txt`, `q11-logs/s11-race-run-7.txt`; the arm-1 suite reports `STAGE11 RACE TESTS PASSED (10)` in each, and the runner ends `race_runner_exit=0`). At run 7 the rendezvous was witnessed, not inferred: `A1_SEES_B_BLOCKED=waiterpids=19844 txwait=1 after 7 polls` with the driver confirming backend 19844 as B's own self-reported pid, and B — parked on the publication row A had already locked — answered `B1_OUTCOME=RAISED 23514 | this wedding has no active publication to take down`, re-read `B1_PUB_SEEN_AFTER_BLOCK=revoked` and ended `B1_ENDED=rolled-back`, while A's own act completed as `A1_APPLIED=replayed=false/tokens=2/outputs=2/audit_id=13/objects_deleted=false`. So it is the publication row's own `FOR UPDATE` that queues the second operator — no advisory lock is taken anywhere in this arm, which is what makes the wait a fact about the shipped body rather than about the harness — and the state, not the key, that refuses him: `FOR UPDATE` returns the row A already committed, the `v_pub.id IS NULL` active-publication branch (`20261020190400_stage11_takedown_and_oversight.sql:390-393`) answers, and the whole act rolls back. `RC02` proves the refused operator spent nothing (his key appears nowhere in the trail), `RC01` that the one recorded act is the first operator's rather than whichever session finished last, and `RC03` that w1 presents exactly one publication row, terminal and stamped, with no second wedding touched |
| Race: an action against a grant revoked mid-flight | authority answered **once, at the door**: `private.actor_is_operator` (`20261020190000_stage11_operator_authority.sql:148-167`) is a single `EXISTS` read with no `FOR UPDATE` on the grant row and no second call after the publication lock, so a revocation that commits while the act is parked does not reach it. §6's decision is one transaction, one authorisation — and this row is that decision, not a control that stops an act in flight | `M:` slice 1 measures the serial halves (`80_operator_authority.sql` `T11`, `W12`, `W12b`) and cannot see a second session at all; slice 4 measures its own three, where a revoked grant is the mid-flight event it can actually stage: `92_takedown_and_oversight.sql` `K05` (a revoked `operations` grant is refused the same sentence as no grant at all), `U02` (the very operator who held the live grant cannot execute the purge once it is gone), `U09`/`U10` (a revoked grant and a money-only scope both fail to name an actor for the planner) and `U26` (five refusals of this body leave the grant table byte-identical — reading authority cannot spend it). `p:` **executed**: `77`/`78`/`79_race_arm4_*.sql` are three clients — a trusted hand holds w5's publication row, an operator with a live `operations` grant reads its own authority at the door and parks a real takedown inside the body, and a third client withdraws the grant and commits while it is parked — counted by `83_race_arm4_asserts.sql` `RC10`–`RC12`, whose `RC12` pins the window in data rather than in a log line, and whose header states the finding before the numbers: **the act finished**. `RC13`–`RC16` are the row's stale-operator half, four accounts and four reasons for being stale sent through the same shipped door rather than against the predicate. Both files ran, in `q11-logs/s11-race-run-6.txt` and again at the pushed head in `q11-logs/s11-race-run-7.txt`, where the arm-4 suite answers `STAGE11 RACE TESTS PASSED (7)` and `race_runner_exit=0`, and the interleaving is witnessed rather than assumed: the holder saw the waiter backend (pid 22208 at run 7) ungranted on its own transaction id — `A4_SEES_WAITER_BLOCKED=waiterpids=22208 txwait=1` and, from the revoker's own connection, `R4_SEES_WAITER_BLOCKED=txwait=1 xid=1376 waiterpids=22208` — the holder then saw the revocation land underneath the act still parked on it (`A4_SAW_REVOKE_COMMITTED=revoketrows=1 after 6 polls`), and the parked act read `W4_AUTH_AT_ENTRY=granted`, applied its effect (`W4_APPLIED=replayed=false/tokens=1/outputs=1/audit_id=18`) and ended `W4_ENDED=act-completed-after-revocation`, with `W4_AUTH_AFTER=refused-as-revoked` on the very next read. That is this row's claim measured, not softened: authority answered once, at the door, and the revocation that arrived while the act was parked reached only the *next* act. `RC13`–`RC16` passed in the same suite, so the revoked, never-granted, lapsed and wrong-scope accounts are four shapes refused with one sentence and 42501 |
| Stale tab transitions a case twice | trigger-compared OLD/NEW edge table, per-case `seq`, and `SELECT … FOR UPDATE` on the case inside every mutating body. The design's `p_expected_status` argument did not ship: `operator_transition_case` takes no status it expects, so the serialisation is the row lock plus the edge table rather than an optimistic check | `M:` `85_support_lifecycle.sql` T06, T12, T30–T40 (the edge machine's own refusals). `p:` HTTP `C-05`, `C-06`; race half **executed** — `80_race_arm5_first.sql` and `81_race_arm5_second.sql` are two sessions appending to one ticket's ordinal by hand, which is the collision the shipped door structurally cannot reach because it locks the case row *before* re-reading `coalesce(max(seq),0)+1`, and `84_race_replay_asserts.sql` `RD06` counts what the door then does with a committed hand row already sitting on seq 1. Both arms and that cell ran, in `q11-logs/s11-race-run-6.txt` and again at the pushed head in `q11-logs/s11-race-run-7.txt`: A minted `A5_APPLIED=row=7/seq=1` and held, saw B (pid 25088) ungranted on its own transaction id, and committed to `threadrows=1 seqs=1 keyrows=1`; B, whose snapshot showed the same empty thread and therefore the same `seq = 1`, was refused with `B5_OUTCOME=RAISED 23505` classified by its own session as `B5_REFUSAL=expected-ordinal-collision` — the seq-per-case index, not a check and not an authority refusal — and re-read from inside its still-open backend `B5_ROWS_SEEN_BY_B=threadrows=1 seqs=1 key307=1 key308=0`: one row, one ordinal, its own key unspent, then `B5_ENDED=rolled-back`. `RD06` passed in the same `(8)` as those runs, which is the positive half: called after that committed hand row, the shipped door mints seq 2 rather than colliding, so the row lock plus the post-lock re-read is the serialisation and the silent renumbering the file refuses to allow did not occur. The second-tab half is now a result |
| Takedown claimed to kill a file link it does not kill | §6's split; purge is a separate, unexposed, twice-confirmed act; the answer text names its own limit | `M:` `92_takedown_and_oversight.sql` — read with the battery file beside its letters, because `T` is also slice 1's predicate family — `K30` (the answer reports the two credentials and the two artefacts it *reached*, not the three credentials and six artefacts on the wedding, which is the difference between a count of the effect and a count of the rows), `K31` (`file_links_still_valid_until_object_purge` is a field of the answer, so the door states its own limit instead of letting the operator infer it), `K37` (the objects those artefacts name are still in the bucket: five before the takedown, five after), `K49` (nothing was deleted by any of the file's acts), `U13`/`U17` (the planner's twelve fields include `delete_channel` and `objects_deleted_by_this_call`, so a plan is never mistaken for an erasure) and `U18`/`U19` + `Z08` (the bucket is counted before and after the plan and never changes size across the whole file). The absence is structural as well as counted: `q11-logs/s11-s4-doc-probe4-1.txt` section S6 found no `DELETE FROM` clause in any of the then-seven privileged bodies this stage wrote, and `q11-logs/s11-s5-doc-probe-2.txt` P5 re-reads that scan over the eight it is now — every one answering `f`, the health projection included — with P5b as the control that makes the eight `f` a measurement rather than an inert scanner, the same predicate finding exactly one body in this schema that does carry the clause (`reject_client_delete.private`). `p:` unit `OD-20`..`OD-24` only — the HTTP half this row planned as `T-06`..`T-09`, measuring signed-URL status **before and after** each, was never authored: this suite's takedown family stops at `T-05`, so no HTTP run can close this row |
| Takedown of the wrong wedding, or an id-guessing operator | `wedding_id` of the target must equal the case's; composite FKs cannot re-parent; case ref is `SV-` + 8 random base32 | `M:` `92_takedown_and_oversight.sql` `K19`/`K20` (a ref that exists nowhere, and another wedding's ticket cited against this wedding, refuse in the same sentence, so the door is not an existence oracle), `K21`/`K22` (nor does a ticket parked on the host as `awaiting_information`, nor a resolved one — a finished ticket is the record of an act that already happened), `K23` (four ways to fail, one sentence, and nothing in the trail), `K24`/`K25` (an invented reason and no reason at all are refused by name and the five real ones are listed), `K27` (the authority question is answered before any of the others, so a caller missing the grant cannot probe the wedding half), `K47`/`K48` (the same operator citing the other wedding, and its effect stayed on that wedding), `P11` (every ref this file cites was minted by the database and matches its own shape — the `SV-` + 8 base32 space is measured, not assumed), `U25`/`U27` (a key spent on one wedding cannot buy a plan on another, and a wedding whose takedown this file has not recorded still cannot be purged) and the census `Z11`/`Z14` (exactly the two claimed publications retired; no credential outside those two weddings revoked). `p:` HTTP `T-02`, `T-04` |
| Takedown leaves a guest roster reachable | the existing credential revocation set is reused, not re-derived (`20261009120000_stage8_guest_invitations_rsvp.sql:1087-1090`); household and wedding kinds both go | `M:` `92_takedown_and_oversight.sql` `K32`-`K35` (the publication retires; the two credential kinds on this wedding are both revoked; the credential that was already retired keeps its original timestamp instead of a fresh stamp; one credential of another wedding is not touched at all), `K36` (the two ready rows of the published version are invalidated while the registered, uploading, failed, superseded and other-wedding rows stay exactly where they were) and the census `Z12`/`Z14` (every invalidated artefact carries the reason the door gave, and no credential outside the two taken-down weddings revoked) — with `P06` the plant's own kind-and-revocation ledger those cells are read against. The Stage 8 guest suite re-ran green at this head on the `regress` chain: `stage 8 80_guest_invitation_links` 182 and `90_guest_rsvp` 185 (`q11-logs/s11-s4-regress-1615.txt`). `p:` no HTTP arm — `T-10` was planned for this row and never authored, so the roster half rests on `92_takedown_and_oversight.sql` `K32`-`K36` with the census `Z12`/`Z14`, and on the Stage 8 guest suite re-run above |
| Refund queue used to move money | no insert/update on `commerce_refunds` from any Stage 11 body; notes only; policy singleton untouched | `M:` `92_takedown_and_oversight.sql` proves the read-only posture from both ends. From the door: `Q04` (the operator who took two invitations down this morning cannot read the ledger — `operations` is not `finance`), `Q07` (the answer says it moves no money and changes no entitlement, beside a row count read from the money tables), `Q20` (six queue reads later every digest this file froze before the first act is still equal) and `Q21` (the `commerce_policy` singleton is not reachable through this door either). From the data: `N15` (the note's four flags all point one way — look, not touch), `N20` (annotating writes one event row on the ticket and moves no status on it), `N30` (four notes written and the money byte-identical to the state the plant left), `K50`/`K51` (a takedown leaves the money untouched in every sense the schema can express, and the only tables that grew are the trail and the thread), `O08`-`O10` (the refund, the order and the ticket a note cites cannot be deleted out from under it) and `Z09`/`Z10` (no refund digest moved and no case status moved anywhere in this file). `T05` is the delete-rule inventory the row rests on: three parents refuse their own delete and only the author's link goes NULL. `p:` HTTP `R-01`..`R-05`, which is the entire `R-*` family this suite declares: `R-06` and `R-07` are Stage 10's and Stage 8's cells under a reused name, not two arms of this row that went unrun. The older census half of this row is measured at the slice-1 head: `q11-logs/s11-historic-5.txt` prints `POLICY=permissive GATE_PACKAGES=0 LIVE_CAPTURE=false`, and Stage 10's `N04b` re-measures the trail's DELETE posture against it |
| Cross-wedding leak through a support note, or a credential/PII surfacing in an operator projection | host/operator message kinds are separate arms; projections are field-built and each field list is named by a `keys` cell; and the batteries scan for the **absence** of what must not appear — a value planted where only the other side may read it, then looked for in the answer text | `M:` shape first: `80_operator_authority.sql` `W01` (a grant answer is seven named fields, not the row), `W11` (six), `W06`, `W06b`, `W07`, `W07b` (the payload is built field by field), and `s11a_gstate`/`s11a_adigest` proving a refused path left nothing. Then the absence scans, which are the half that can actually fail: `85_support_lifecycle.sql` `X03`-`X06` (three operator-arm rows planted by hand into a thread a host cannot see, the host's payload byte-identical after the plants, and none of the three arm names appearing anywhere in it — the filter is a `WHERE`, not a label the client hides), `X07` (the internal note's own sentence is absent, and that note names the host's address), `X30`/`X31` (an address appears exactly once where it belongs and the thread of that ticket holds none), and `92_takedown_and_oversight.sql` `U14`/`U15` (the three object keys go to the caller and *only* to the caller: none appears in the stored trail payload, and neither key shape appears there even as a pattern — `p/<43>` and `outputs/` both scanned) and `Q10`/`Q11` (the order half is six named fields; no `entitlement_id`, no `owner_user_id` at any level, and neither order owner's account uuid appears anywhere in the answer text). What is **not** shipped is a sweep of every returned value of every door for every PII class; the scans above are per-arm and named, and an unmeasured projection would be caught by the field lists rather than by a pattern. `p:` HTTP `H-03`, unit `OD-30`-`OD-34` — the two HTTP arms once cited here, `C-10` and `R-08`, are not pending runs: this suite's `C-*` family stops at `C-09`, and `R-08` is declared in Stage 10's and Stage 8's files, so this row's projection-absence claim is measured in SQL and at the unit tier only |
| Erasure request silently deleting data | no Stage 11 body contains a DELETE; every FK this stage adds to `public.weddings` is NO ACTION, and the eight it adds to `auth.users` are SET NULL except the credential subject, which cascades so a duty cannot outlive its holder (`q11-logs/s11-s4-doc-probe-1.txt` sections D and E name all eight edges and their delete rules; `private.audit_events.actor_user_id` and Stage 10's `commerce_orders.owner_user_id` sit in the same catalog listing but are not counted, because those tables predate the stage); a cell performs each attempt and counts rows, threads and trail bytes before and after | `M:` `85_support_lifecycle.sql` T-RI1/T-RI2 (erasing an account nulls the ticket's attribution links and every trail row's actor, and deletes no ticket, thread row or trail row), T72 (a wedding a ticket names refuses deletion on `support_cases_wedding_id_fkey`, with the corrected control in `q11-logs/s11-probe-fk-null-control.txt`), T45-T47 (only a ticket with no history at all is deletable, by the trusted channel, and the deletion is measured as one row), T65-T70 (the credential cascades with its subject while her acts are nulled rather than removed), Z06-Z08 (the census after two erasures). `90_privacy_intake.sql` is slice 3's half: `S14` scans all four bodies for a DELETE, `D01`–`D10` refuse the hand plants and both client DELETEs, `D11`–`D12` refuse the parent delete on `privacy_requests_wedding_id_fkey`, `D13`–`D15` erase the requester and read the surviving request back from a new physical tuple, `D17`–`D21` erase the operator and read the intact requests, trail and cascaded credential back, and `Z01`–`Z12` close on thirteen requests with exactly one NULL requester. `40_catalog.sql` `C46` re-measures the ON-DELETE inventory at the head; `AI12` records that a trusted role can still prune the trail. Slice 4's half is the note and its author: `92_takedown_and_oversight.sql` `O11` (the author's account can still be erased — the require-an-author rule is an INSERT trigger, not a CHECK, so deleting a reviewer never makes the record impossible to delete), `O11b` (and the erasure is not cost-free: `operator_grants.user_id` is ON DELETE CASCADE, so removing a person removes their duties with them, measured rather than assumed), `O12`-`O14` (the note survives with every other byte identical, its trail row and its event row survive too, and the note is still readable and still attributed to its ticket and its kind), `O15`/`O16` (nothing else disappeared in that group — the ledger, the artefacts, the credentials — and the erasure did not touch the money) and `T05` + `O08`-`O10` (three of the note's four parents refuse their own delete, and only the author's link goes NULL). The no-DELETE claim is now read from the catalog rather than inferred from four bodies: `q11-logs/s11-s4-doc-probe4-1.txt` section S6 scanned the seven privileged bodies then written and found none, and at this head `q11-logs/s11-s5-doc-probe-2.txt` P5 scans all eight — `operator_operations_summary` included, all eight `f` — beside P5b, which shows the same predicate lighting on the one body that does contain the clause. `p:` HTTP `V-01`-`V-04` — four cells, and the `V-04`-`V-07` range this row carried was a wrong citation rather than four unrun arms: `V-05`–`V-07` exist in no battery, and the suite's own header comment still names a `V-06`, which is instrument residue for whoever authors the next privacy cell to clear. |
| Health numbers that are decoration | every block carries `status: measured\|not_measured` and its own newest-row timestamp; four blocks answer `not_measured` on the runner chains these batteries run on — three because no such store exists, and `migrations` because `supabase_migrations.schema_migrations` resolves on neither — and that is a chain fact rather than a head fact: the same projection on the stack §16 pushed to answers three, because the CLI owns that table there (§9) | `M:` `95_operations_health.sql`. The shape is asserted as field lists, not as a paragraph: `C1` (the answer carries exactly the eight fields §9 describes), one `keys` cell per block and per sub-object through `C21`, `C2` naming the ten blocks and `C9` giving the migrations block presence, reason and note with no invented timestamp, `C17` making the case-link count an object so it can carry a reason later. The absence is derived rather than typed: `V11` requires `blocks_not_measured` to be exactly the set of blocks whose own status says so, `V12` requires that derived list to be `auth_failures`, `migrations`, `rate_limits`, `token_abuse` by name and in order, and `V18` that no measured block borrows the absence vocabulary — so a fifth silence cannot appear and one cannot disappear. `V13` reads `block_count` from the blocks object rather than trusting a hand-written ten, and `V19`-`V21` make `writes_anything` and `identifiers_included` JSON booleans rather than the strings `"false"`. Every counted vocabulary is compared with the constraint that enforces it, not with a list (`V1`-`V8`, and `V9a`/`V9c` over the open `hold_reason` rule — the latter paired with the cell that shows the same scan finding values in a closed column, which is what makes the zero a measurement). The arithmetic has to close: group `M` requires each partition to sum to its own total (`M1`, `M2`, `M10`-`M21`) and bounds each sub-count against its parent. The timestamps are fenced: `W4` makes `as_of` this transaction, `W6` refuses any `newest_at` in a future `as_of` does not share, `I11` scans every string leaf for a timestamp later than the answer. The body cannot write, read from its own `prosrc`: `R8` finds no DML verb as a word, `R9` opens the word boundaries on the same bytes and gets 47 hits so the instrument is provably not inert, `R11`/`R12` glue one `INSERT` clause onto those very bytes and the scanner lights up on the verb that clause added, and `R13`/`R14` run the same instrument over slice 4's publication body, which really does write eight times. `R3`-`R6` add that the STABLE half is refused by the executor rather than by a rule this file wrote — and that a write attempted inside an aborted subtransaction moves the store digest and then moves it back. `R16`-`R19` count the body's call-shaped tokens and follow the one hop it makes, to a helper that is itself STABLE and verb-clean, so the closure is two deep and stops there; `R20`-`R24` show the two disclaimer fields are literal `false` and are the last thing the body does; and `R25`-`R38` run the door inside a read-only fence that bites before the function is reached and cannot be lowered from inside, then require the fenced answer to be the *whole* answer, byte-identical to the one the same account read one statement earlier, across an eighteen-store digest set of which every member is a real relation — `R38` naming the empty set of disagreements rather than implying it. `L0` proves the answer is non-vacuous leaf by leaf before any of the above, and `B0`-`B0c` read the door before this file plants a row, so each figure below is a measured delta. Group `N` builds the migrations branch as a fixture in one transaction, reads the block as `measured` twice, drops it and re-reads the original answer unchanged — with `N5` quoting the shipped body's own column references out of `pg_proc.prosrc` instead of trusting the fixture, and `N42` returning the summary line to the four names `V12` pinned. The `Z` floor prints the total and refuses any other. `p:` HTTP `H-01`-`H-05` — five cells, and `H-06` is not a sixth that went unrun: that id is declared in `stage8_guest_rsvp.test.mjs`, whose `H-*` family runs 01–08, so an HTTP run reporting six Stage 11 health cells would be reading another stage's suite rather than this one. |
| A service-role key in the tool, a log, or a bundle | The CLI takes the operator's password and address only as the *names* of environment variables (`--secret-env` / `--account-env`), refuses all nineteen flags that could carry a secret, an amount or a server before any transport exists, describes a mis-typed value by its length and the class of its first character instead of quoting it, and prints through one gatekeeper (`makePrinter`) that will not print a line carrying the password, the bearer token or the refresh token — it raises a refusal naming the slot and prints nothing — softens the operator's own address and the publishable key, and stops a `postgres://user:pass@` shape on sight; the recorded boundary is that the three `psql` acts read no credential at all, so their answer prints under the connection-string guard alone. `service-role-key-in-browser-code` unchanged in `src/`; and the product-contract rule `operator-rpc-referenced-outside-cli` (pattern `\b(?:get_\|grant_\|revoke_)?operator_[a-z0-9_]+\b`, global, `scope: ["src/"]`, `exclude: ["src/integrations/supabase/types.ts"]`) refuses any `src/` mention of an operator door name, while the checker's own `docs/audits/` + `scripts/` exclusions keep this instrument outside the scanned set on purpose | `M:` `80_operator_authority.sql` `A05b` and `A13`-`A16` are the SQL half of the same promise — there is no `api` wrapper to call and the server key can neither read who holds authority nor write, resurrect or erase a credential, four refusals all named `permission denied for table operator_grants`. Slice 4 measured the harder version of the same boundary on the one body this stage could have handed to the server key and deliberately did not: `92_takedown_and_oversight.sql` `U03` stops `service_role` at `permission denied for schema internal_api`, `U03b` reads why the two refusals differ — `internal_api` USAGE is `true`/`true`/`false` for anon/authenticated/service_role, so the browser roles reach the function and are refused there while the server key never reaches it — `U04` counts zero `api` wrappers for the purge, and `U05` asks the database rather than this file and gets three `false`, with the measured ACL literally `{postgres=X/postgres}`: owner only, no PUBLIC half at all. Neither a browser session nor the server key has a wire path to the irreversible act. The tool half is now measured, and only at the unit tier: forty cells green in `scripts/stage11-operations-cli.test.mjs`, of which `OD-17` keeps the two channels apart (`--secret-env` on a `psql` verb is itself a refusal), `OD-30`-`OD-34` sweep every chunk all sixteen verbs print and prove the sweep can fire, `OD-40`-`OD-46` measure the flag ban, the two-name `.env.local` allowlist, the loopback address, the checker rule against this repository's real tree, and the absence of any product path to the CLI, and `OD-50`-`OD-54` the migration census. `OD-45` is this row's own pair: each of the sixteen door names lights the rule under `src/`, and the same sixteen are silent in the CLI file and in the generated `types.ts`, with `isScannedPath` proving one is outside the scanned tree and the other inside it — so the silence is a scope decision, not a blind spot. The stack half has since run: `A-06` passed there, the five stores refusing all three credentials as `PGRST205` while the exposed table answered 200 for the same client, with 0 client table grants read back out of the catalog (`q11-logs/s11-http-stage11-a5.txt`), and `A-07` then drove the shipped tool itself against that stack on both channels and asserted this row's promise on the wire rather than in a double — the account password, the service key and the account address are each absent from the raw stdout and stderr of both operator-channel verbs, and the console channel's purge plan and two grant refusals print under the connection-string guard alone, as the row says they must. What that pair does not settle is stated in §11 and §16: no `psql` act has *executed* a mutation against a stack — the purge ran `--dry-run` with `executed:false` and both grants were refused — so the leak sweep over an executed console answer is still unit-only. `p:` unit `OD-17`, `OD-30`-`OD-34`, `OD-40`-`OD-46`, `OD-50`-`OD-54`; `npm run product:check` beside its `--self-test` (both re-taken in `q11-logs/s11-final-selftest.txt` and the post-document run named in §15, each with its exit code); `npm run bundle:check`; HTTP `A-06`, `A-07` |
| A new migration quietly exposing a `private` operational table | `40_catalog.sql` inventories widened behind a stage11 branch, `check-db-contract.mjs` `NON_CLIENT_SCHEMAS`, `API33`/`API34` name lists | `M:` `C06` names `commerce_review_notes` among the five `private` tables this stage declares, inside a thirteen-table inventory that `92_takedown_and_oversight.sql` T16 measures independently; `C15` still measures reach; `C26` pins the definer set by name, and the count that set now carries is 47 — one more than the 46 slice 4's census logged, and the figure `92_takedown_and_oversight.sql` T17 measures from `pg_proc` at this head; `C26d`/`C26f` read 41 paired wrappers, one more than the 40 slice 4 logged, and `C26e` names `internal_api.operator_operations_summary` among the bodies that may be definers without a door; `C29a`'s stage11 arm names all nineteen of the stage's exposed RPCs (ten from slice 2, four from slice 3, four from slice 4, one from slice 5) and `C28b` pins the eighty-two-name wrapper-plus-implementation set that goes with them — 41 `api` plus 41 `internal_api`, counted out of the cell's own literal — while `internal_api.operator_purge_publication_objects` stays *absent* from both, which is the unexposed body showing up in the catalogue as a measured absence; `C29c-b` holds the identity-taking set closed at nine names; `C31` carries the stage's twenty-six triggers — slice 5 adds no table and no trigger, so the inventory is the twenty-four over the five stage tables plus the two on the shared trail, read row by row in `q11-logs/s11-s5-doc-figures-2.txt` section 9 — of which slice 4's five on the review-note row are the newest and all INVOKER; `C46` and `C48` carry the new edges; and the file closes at 106 assertions at this head — `q11-logs/s11-s5-all-1526.txt` prints `STAGE2 CATALOG TESTS PASSED (106)` twice, once per historic chain, beside the census `API_NAMES=41 INTERNAL_NAMES=61 PRIVATE_FUNCS=52` on all seven chains it builds. That total did not move, and the reason is worth stating: the slice's whole catalogue edit widens names and counts *inside* cells that already existed — `C26`, `C26d`, `C26e`, `C26f`, `C28b` and `C29a`, with `C26c` carrying only the comment that explains the new count — and adds no assertion, so a green 106 here is the same 106 read against a larger schema, which is what a tripwire is for. `A06a`-`A06c` prove the *declared* surface did not move. `p:` `API33`/`API34` |
| Privilege granted by hiding links rather than by the database | §10: no admin route, no admin component, and the denial matrix is run at the wire for all four caller classes | `M:` `80_operator_authority.sql` `A05b` — slice 1's three names have no `api` wrapper at all, so for the authority surface there is no URL to hide behind and the claim is purely a grant claim, which `A13`-`A16` then test against the server key as well. The stage has since chosen to ship a browser-reachable surface, so this row can no longer rest on absence: `40_catalog.sql` `C29a` names nineteen exposed `api` RPCs at this head (ten from slice 2, four from slice 3, four from slice 4, one from slice 5) and `C28b` pins the eighty-two-name wrapper-plus-implementation set beside them, which means an exposure is a decision with a name in the catalogue rather than a link that was never clicked. Slice 5 adds the nineteenth name, and refuses it from every side the row cares about: `95_operations_health.sql` `A1`/`A2`/`A3` (anon refused at the wrapper and at the body, in one sentence), `A6` (an anon token that *claims* a live operator is still refused), `A4`/`A5` (`service_role` cannot even name the schema the wrapper lives in, nor the body), `A12` (a signed-in host is refused the cluster-wide screen), `A13`/`A14` (the superuser is refused by the body's own sentence rather than by its privilege, and a stranger and an owner carrying a stranger's uid hear one sentence), `A8`/`A9`/`A10`/`A11` (an account holding no grant, a support-scoped operator, a revoked grant and an expired live grant all refused, because a scope is not a seniority), and `A20` (the scope test runs before the window test, so a caller who is not an operator cannot probe the bounds). What holds the line is refusal at the door, measured per battery: `92_takedown_and_oversight.sql` `K01`, `Q01`, `N01` run each of its three doors as anon, `U01`/`U02` add the purge and refuse it even to the operator holding a live `operations` grant once that operator is on a session, `85_support_lifecycle.sql` `P01`-`P03` and `90_privacy_intake.sql` `P01`/`P02`/`Q11` run their own anon arms — the letter `P` is one of the collided ones, which is why the file rides the id — and `80_operator_authority.sql` `A09`/`A10` refuse an anonymous read and an anonymous write of the grant table itself at the schema layer. `p:` every HTTP `A-*`, `C-*`, `T-*`, `R-*`, `V-*` refusal paired with the operator's success control |

### The `p:` column audited against the suites that would have to satisfy it

§13's rule — **a citation that no run log carries is a claim, not evidence** — was written to police the
`M:` column, and it also condemns this one. Read against the eleven HTTP suites and the CLI unit suite at this
head, the column carried three kinds of defect, all now repaired above. First, misspelling: `AI-1`, `AI-2` and
`AI-3` are declared as `AI-01`, `AI-02` and `AI-03`, so the zero-padded names the run log answers to appeared
nowhere. Second, ids that exist in no file at all: `C-10`, `T-06`–`T-10`, `V-05`–`V-07`, and the entire
`RC00`–`RC16` / `RD00`–`RD07` race range — which meant four rows cited an arm no tier could run, and the two
rows whose threat is literally "Race:" were awaiting an instrument rather than a Docker start. The race half of
that finding is since closed all the way through: fifteen files in `supabase/tests/stage11/race/` declare the
twenty-five cells, `run.sh` accepts a `race` mode, and that mode **has run** — twice, on a host PostgreSQL 17.10
cluster built for this tier alone, green in both (`q11-logs/s11-race-run-6.txt`, `q11-logs/s11-race-run-7.txt`,
the second at the pushed head `9bd83ca0f177fc0430854a618b413085dad500af`) — so those four rows are now cited
against a run log rather than against an authoring. The other ids in this list still name no cell at all.
Third, borrowed names: `R-06`, `R-07` and `R-08` are declared in `stage10_commerce_http.test.mjs` and
`stage8_guest_rsvp.test.mjs`, and `H-06`–`H-08` in the Stage 8 file, because the dashed namespace is reused
across suites; citing them on Stage 11 rows reported another stage's cells as this stage's outstanding work —
which is also how a range asking this branch for six health cells (`H-01`–`H-06`) came to be written at all,
when the suite ships five.

The numbers behind that are read, not asserted. `supabase/tests/api/stage11_operations_http.test.mjs` declares
**38** cells — `A-01`–`A-07`, `C-01`–`C-09`, `T-01`–`T-05`, `R-01`–`R-05`, `V-01`–`V-04`, `AI-01`–`AI-03`,
`H-01`–`H-05`, seven disjoint families. When this section was written §16 recorded that only `A` (7) and `C` (9)
had run on the stack, so exactly **22** were outstanding and that was the whole HTTP scope this stage owed; the
scope has since been spent rather than narrowed — §16's log re-derives the declaration from the file's bytes
before it runs them (`declared_test_calls|38`, `declared_unique_ids|38`, `run_unique_ids|38`, with
`declared_not_run` and `run_not_declared` both printed empty) and then reports all 38 green.
`scripts/stage11-operations-cli.test.mjs` declares **40** — `OD-01`–`OD-18`, `OD-20`–`OD-24`, `OD-30`–`OD-34`,
`OD-40`–`OD-46`, `OD-50`–`OD-54` — which is the "forty cells" the tool row claims, with `OD-19` absent from the
sequence rather than from a count. The instruments are `q11-logs/s11-http-cell-inventory.cjs` (capture `-2.txt`:
**11** suites, **375** id-shaped declared cells across nine of them; `stage3_security.test.mjs` and
`stage5_admin_cli.test.mjs` score 0 because their titles are sentences, and their 29 and 36 no-id titles are
printed rather than silently dropped) and `q11-logs/s11-od-cell-count.cjs` (capture `-1.txt`); the first pass of
this census is `q11-logs/s11-pcol-instrument-census-1.txt`.

Two of the failures were the instrument's own, and both are recorded because a repaired citation you cannot
re-derive is the same problem in a cleaner costume. The inventory's first run disagreed with itself — it
reported 40 cells for a file whose printed list held 38 tokens — because the shared `RegExp` carried
`lastIndex` from one file into the next, so a count included matches consumed at another file's bytes; the fix
is the reset inside the loop, and the capture above is the run after it, where declared = unique = the sum of
the families. A `test\(['\`]…` pattern also missed `C-07`, whose double-quoted title contains an apostrophe,
and naive `grep 'T-0'` / `grep 'V-0'` light inside `CAT-0*` (Stage 4) and `PRV-0*` (Stage 5), which is why ids
here are matched at the start of a title and then resolved to the file that declares them.

What this pass deliberately leaves alone: the comment at `stage11_operations_http.test.mjs:1116` still names a
`V-06` — the suite ships `V-01`–`V-04` — and it stays as residue for the reason that has now changed direction:
it was left because the file was a battery this branch had not run, and editing a line of it today would move
the bytes a green run quoted. The repair that took the suite's eleven red cells did touch other lines of the same
file, and where those eleven come from is a capture rather than a section: run 1 of the harness read the battery as
`dbbbebf` ships it (`suite_lines|5263`) and printed `tests 38 / pass 27 / fail 6 / cancelled 5`
(`q11-logs/s11-runtime-2-stage11-http-1-raw/node-test.txt`); runs 2 and 3 read it at 5319 and 5337 lines with 2
failures and then 1; run 4 read the repaired length and died in one second against the engine
(`tests 39 / pass 0 / fail 1 / cancelled 38`); and run 5 is the green one — `node_test_exit=0` at 248 s,
`tests 38 / suites 7 / pass 38 / fail 0`, `declared_test_calls|38`, `declared_unique_ids|38` and
`run_unique_ids|38` with `declared_not_run` and `run_not_declared` both printed empty, seven families
(A 7, C 9, T 5, R 5, V 4, AI 3, H 5) each at zero failures, and the harness's own outer census identical on all
30 names before and after. Two consequences follow, and this section states both instead of letting one green
number carry them. First, the repair is uncommitted: `git diff --stat` against `dbbbebf` is +110 −23 on this one
file, so the run that closed the scope measured a working tree, and §16's A and C captures are of bytes from
before that repair — no capture yet pairs a green Stage 11 battery to a head whose tracked file holds those bytes.
Second, this comment is the one line the repair chose not to touch, so the number above is the post-repair one
(`git show HEAD:` prints the same sentence at `:1113` for the pre-repair bytes, which is the pair a reader can
check), while the citation at `:789` that pointed at `3641-3643` was corrected to `3649-3652` *after* run 5:
`q11-logs/s11-suite-bytes-delta-2.txt` states that pair, shows the line begins ` * ` and carries
`executable_markers_on_line_789|0`, and prints the limit of the pairing — run 5 stamped `suite_lines|5350`, which
the file still has, but no digest, so `sha256_of_the_bytes_run5_read|NOT_RECORDED` and the strongest honest claim
is the same line count plus one known comment-only line. The byte-level claim is owed to the next run of the
tracked chain, which can pay it because the harness now stamps `suite_sha256_before_run`
(`q11-logs/run-runtime-2-stage11-http.sh:24`). §13 promises that an arm which did not run
"says so in the Stage 11 audit", and there is no `docs/audits/stage-11-*.md` at this head; that file is the
closure deliverable, so until it exists §13 and §16 are where the absences live. And this section changes no
gate: no unit or CI file reads the HTTP suite's bytes (`grep -rn "stage11_operations_http" scripts/*.mjs` is
empty), and the one doc-sensitive cell, `scripts/stage11-operations-cli.test.mjs:2343`, asserts only that this
file still names `scripts/stage11-operations-cli.mjs`. Repairing a citation is truth-sync, not qualification: the
22 cells this sentence left unrun have since run, and no citation repair made that happen — nothing here turns an
unrun arm into a measured refusal, and the arms §13 still leaves without a run are the browser tier and the races
over the wire. The race tier's later execution is a separate act from this citation pass, not a
by-product of it: rewriting a `p:` cell name cannot make an engine run an arm, and the two run logs §13's four
race rows now cite came from writing and repairing the harness itself.

## 14. What Stage 11 refuses to build

Each row's third column is the assertion that would have to fail if the refusal were abandoned. Slice 1
names its cell; the rows whose instrument belongs to a later slice point at the row of §13 they are held to,
and §13 says which of those arms has not run — a sentence the tier has since narrowed, because its HTTP set is
now closed there and the arm left without a run is the browser tier, not a refusal this stage can name.

| Refused | Why | The assertion that keeps it refused |
| --- | --- | --- |
| an admin/operator page in the browser | the kickoff's own first boundary; the authority-critical surface is provable at the wire and in SQL, and a UI whose door is its URL is the failure mode, not the feature | `src/App.tsx` gains no route; the product-contract rule above fires on any `operator_*` name under `src/`; `bundle:check` finds no operator chunk |
| an irreversible act reachable over HTTP | §6, and "human/owner-only approval for operations that impact unrelated real customers" | `92_takedown_and_oversight.sql` `U05` measures the zero: the three roles a browser can arrive as each answer `false` for EXECUTE and the access list is `{postgres=X/postgres}`; `U03`/`U03b` add that the server key has no USAGE on the schema to ask in, `U04` that no `api` wrapper exists, and `U02` that even a live `operations` grant on a session is refused. `p:` `API33` lists it as service-only |
| a refund, chargeback, capture or entitlement write | Stage 10 §12 and ADR 0008: no provider, no price | §13's refund-queue row; the six commerce tables stay grant-free |
| destructive erasure | Stage 13 owns retention and identity verification | §13's erasure row; readiness row stays intake-qualified |
| a rate-limiting, lockout or abuse feature | no application server exists to host one, and §2 measured the absence | the health projection's `not_measured` blocks on the runner chains — `auth_failures`, `migrations`, `rate_limits`, `token_abuse`, pinned by name and in order by `95_operations_health.sql` `V12`, the first three because no such store exists anywhere in this schema and the fourth because `supabase_migrations.schema_migrations` resolves on neither chain — and `V11`, which requires that list to be derived from the blocks' own statuses rather than typed; `40_catalog.sql` finds no such table. On the stack the same projection names three, not four, and none of the three is a rate limit (§9) |
| a second audit trail, a second case model, a second `wedding` or `output` schema | §4, §5, and one-data-model is a standing constraint | table inventories in `40_catalog.sql`; no new column on `invitation_outputs` |
| a seeded operator | "No live operator authority is granted by this kickoff document" | `A01` in `80_operator_authority.sql` asserts `count(*) FROM private.operator_grants = 0` on a chain that has applied every migration and run nothing else, and `A26`/`A26b` re-assert it after the whole refusal battery; the runner prints the same fact for every chain it builds — `OPERATOR_GRANTS=0 ACTIVE=0` above both chains in `q11-logs/s11-historic-5.txt` |
| a hosted call, a deploy, a merge into `main`, Stage 12 | the work order | push read-back of `stage11/operations-admin` only (`git ls-remote` plus `gh api`, never a tracking ref) |

## 15. Instruments that must move with the code

Not optional cleanup — these gates fail loudly, and the response Stage 10 recorded for a stack whose
applied migrations were behind the repository was to make the precondition refuse rather than relax the
count ([`commerce-foundations.md`](commerce-foundations.md) §14 item 3), which is the posture this
section inherits. What moved for slice 1, listed by cell rather than by line number because a line
number in a file that this section is describing as changing is a citation that rots the moment the
change lands:

- `supabase/tests/stage2/30_migration_empty.sql` — `E01`'s declared inventory gains
  `private.operator_grants`.
- `supabase/tests/stage2/40_catalog.sql` — `C06` (the `private` table list, nine names), `C26` (the
  SECURITY DEFINER inventory, which gains `private.actor_is_operator` and reads 26 at this head),
  `C26e` (the unpaired `internal_api` bodies, which gain the two grant verbs), `C29c-b` (the closed
  set of identity-taking callable parameters, which gains four names), `C31` (the trigger inventory,
  which gains four bindings: the audit `audit_no_update_any_role` guard — whose body reads
  `reject_audit_update_except_referential_null` — and the grant table's write, delete and timestamp
  trio), `C46` (the ON-DELETE census, which gains the `CASCADE` and the `SET NULL` edges), and
  `C48` (the accepted unindexed foreign keys, which gains `granted_by_user_id` alone).
- `supabase/tests/stage3/30_publication.sql` — `G1f` (the whole `internal_api` surface, 41) and `G1g`
  (the unpaired-by-signature set, 19).
- `supabase/tests/stage4/50_pack_release.sql` — nine census cells move to their stage11 arms, the
  constraint inventory reaching 101.
- `supabase/tests/stage7/90_review_boundary.sql` — `G2` (41 bodies) and `G3f` (the nineteen a host
  cannot call, named). `G1`, `G3`, `G3d`, `G4`, `G5`, `G6` and `G7` needed **no** branch and were
  re-measured rather than assumed: 22 wrappers, 22 and 22 EXECUTE grants, the same five doors for
  `anon`, zero for `service_role`, zero definers in `api`, seven bindings.
- `supabase/tests/stage10/90_commerce_functions.sql` — `N04b`, plus the head ladder it was missing.
  This is the one historical battery that had none: `90_review_boundary.sql` got `s7b_at_least` when
  Stage 8 widened it, Stage 10 wrote no equivalent because its own pair had never been asked to run
  behind a later head, and the first time that happened `N04b` refused a revocation Stage 11 made on
  purpose. `pg_temp.s10f_head()`/`s10f_at_least()` are now the shape the rest of this stage's
  re-measurements use.

Slices 2 and 3 moved these cells again, and the list is appended rather than substituted so a reader can
see which head a number belongs to. Slice 2 added ten support doors and five private functions; slice 3
added one table, four pairs and three private helpers. At the slice-3 head:

- `supabase/tests/stage2/30_migration_empty.sql` — `E01`'s declared inventory gains
  `private.support_cases`, `private.support_case_events` and `private.privacy_requests`.
- `supabase/tests/stage2/40_catalog.sql` — `C06` names twelve `private` tables; `C26` reads 40
  SECURITY DEFINER functions; `C26d`/`C26f` read 36 paired wrappers; `C28b` enumerates the fourteen
  callables Stage 11 exposes, while `C28a` — the anonymous matrix — deliberately does not move; `C31`
  gains the six privacy triggers; `C46` gains the `privacy_requests` SET NULL and NO ACTION edges; `C48`
  gains `privacy_requests->weddings`. The file closes at 106 assertions in
  `q11-logs/s11-s3clean-40_catalog.txt`.
- `supabase/tests/stage3/30_publication.sql` — `G1f` reads 55 `internal_api` bodies, `G1g` stays 19
  unpaired, and `G4` gains `get_my_privacy_requests`: the first argument-free door that reads
  `auth.uid()` rather than a bearer secret, recorded as such in the cell.
- `supabase/tests/stage4/50_pack_release.sql` — `I1` 36, `I2` 55, `I3` 36/36/36/55, `I4` 139, and
  `I8`/`I9b` read the same total; the census behind them is `q11-logs/s11-s3-readout-1.txt`.
- `supabase/tests/stage5/50_review_binding.sql` — `M5b` gains the stage11 arm: the customer surface is
  exactly 36 names, the fourteen Stage 11 verbs enumerated rather than counted.
- `supabase/tests/stage7/90_review_boundary.sql` — `G2` 55, `G3` 36/36, `G3e` the mirrors, `G3f` the
  same nineteen a host cannot call.
- `supabase/tests/stage11/85_support_lifecycle.sql` — `S09`/`S10`/`S10b` read 36 / 55 / 48.

The slice-3 head was then swept rather than spot-checked, in runner order on a clean `st11qual_s3clean`
chain: `migration_empty` 54, the draft invariant 46, publication 284, attacks 464, catalog 106, pack
release 428, the reviewed fixture 57 (rolled back), review binding 122, definition vocabulary 50,
document resolution 124, asset registry 91, storage policies 80 — the twelve logs are
`q11-logs/s11-s3clean-*.txt`. The legacy chain adds `migration_legacy` 77
(`q11-logs/s11-s3-st11qual_legacy-30_migration_legacy.txt`); the older pairs were re-run in place —
Stage 8 182/185, Stage 9 134/94, Stage 10 380/293 (`q11-logs/s11-s3-st11qual_g8-*.txt`, `…_g9-*.txt`,
`…_g10-*.txt`) — and Stage 7's pair from the same tree reads 255/116
(`q11-logs/s11-s3c-80_family_review-1.txt`, `…-90_review_boundary-2.txt`). Stage 11's own three
batteries close at 137, 641 and 191 (`…_authority3-80_operator_authority.txt`,
`…_authority3-85_support_lifecycle-2.txt`, `…_authority3-90_privacy_intake-2.txt`), each with the PASS
line count equal to its reported total. The first run of each cell that moved is kept beside its repair
rather than deleted: `s11-s3-st11qual_authority3-85_support_lifecycle.txt` is the slice-2 expectation
failing at 36/55/48, and `s11-s3c-90_review_boundary-1.txt` is `G2` failing before its literal moved.

Slice 4 is the fourth such list, and it moved figures rather than shapes: one table, four browser-reachable
pairs, five privileged bodies — four mirrors plus the twin-less purge — four private functions and five
triggers. At the slice-4 head:

- `supabase/tests/stage2/30_migration_empty.sql` — `E01`'s stage11 arm names all five declared tables,
  `private.commerce_review_notes` last, and because `E02` loops that same list the suite's total moves with
  it: `STAGE2 CLEAN-CHAIN TESTS PASSED (55)` where slice 3 read 54.
- `supabase/tests/stage2/40_catalog.sql` — `C06` thirteen `private` tables, `C26` 46 definers, `C26d`/`C26f`
  forty paired wrappers, `C28b` the eighty-name signed-in set with the purge body *absent* from it,
  `C29a` eighteen exposed RPCs, `C29c-b` still nine identity-taking names, `C31` twenty-six stage triggers,
  `C46`/`C48` the new edges. The file still closes at 106 assertions — arms widened, no cell added.
- `supabase/tests/stage3/30_publication.sql` — `G1f` reads sixty `internal_api` bodies and `G1g` grows to a
  twentieth `unpaired-internal` name, which is slice 4's purge and is the first time that census moved at
  this stage; `G4` does **not** move, because all four of slice 4's doors take arguments, so the
  argument-free list is still four names.
- `supabase/tests/stage4/50_pack_release.sql` — `I1` forty, `I2` sixty (forty twins plus twenty
  maintenance), `I3` forty-one definers against nineteen INVOKER bodies, `I4`/`I8` 152 real functions,
  `I9b` 41 with this suite's own probe installed.
- `supabase/tests/stage5/50_review_binding.sql` — `M5b` forty names.
- `supabase/tests/stage7/90_review_boundary.sql` — `G2` sixty, `G3` forty and forty, `G3f` the twenty a host
  cannot call at all.
- `supabase/tests/stage10/90_commerce_functions.sql` — `R20`'s executor census gains slice 4's review-desk
  pair, `api` and `internal_api` both.
- `supabase/tests/stage11/85_support_lifecycle.sql` — `S09`/`S10`/`S10b` read 40 / 60 / 52.

The slice-4 head was swept, and three runs were red before the green one, which is why the red logs are kept
in `../q11-logs/` rather than dropped. `run.sh authority` first failed inside the new battery itself:
`q11-logs/s11-s4-authority-1617.txt` prints `P10` reading twelve ticket statuses, because on the shared
chain the earlier batteries each open tickets of their own — the cell was scoped to the plant's own five
case ids, not the expectation widened. The green run of the same mode, `q11-logs/s11-s4-authority-1619.txt`,
reports 137 / 641 / 191 / 208 with PASS-line equality on all four. `regress` was then red twice for the
reason this section exists to catch — a stale literal in an older suite, not a broken schema:
`s11-s4-regress-1604.txt` prints Stage 10's `R20` refusing the two new review-desk names and
`s11-s4-regress2-1608.txt` prints Stage 7's `G1` missing slice 4's four doors from its name list. After both
literals moved, `bash supabase/tests/stage11/run.sh regress` finished `exit=0` on all four pairs — Stage 10's
380 and 293, Stage 9's 134 and 94, Stage 8's 182 and 185, Stage 7's 255 and 116
(`q11-logs/s11-s4-regress-1615.txt`) — and `run.sh historic` finished `exit=0` with `migration_empty` 55 and
77 on the clean and legacy chains, the draft invariant 46 and 49, publication 284, attacks 464, catalog 106
on both chains, pack release 428, the reviewed fixture 57, review binding 122, definition vocabulary 50,
document resolution 124, asset registry 91 and storage policies 80, under the same censuses slice 3 recorded:
`API_NAMES=40`, `OPERATOR_GRANTS=0 ACTIVE=0`,
`AUDIT_POSTURE=svc_select=true svc_insert=true svc_update=false svc_delete=false before_update_triggers=2`
(`q11-logs/s11-s4-historic-1603.txt`, `q11-logs/s11-s4-tier-codes.txt`). Six recorded runs in that file —
three red, three green — each exit code written beside the log it belongs to.

After the last prose and comment edits landed on `run.sh` and on this document, the three modes were run
again as one command rather than trusted from the three separate logs: `bash supabase/tests/stage11/run.sh all`
finished `exit=0` (`q11-logs/s11-s4-all-1701.txt`, `MODE=all exit=0` in the same tier file) with the same
four Stage 11 totals 137 / 641 / 191 / 208, the same eight older-stage pairs, the same Stage 2–6 sweep on both
chains, and the same `API_NAMES=40 INTERNAL_NAMES=60 PRIVATE_FUNCS=52 PUBLIC_TABLES=20 PRIVATE_TABLES=13
STORAGE_BUCKETS=3` census printed above every chain — so the certified tree is the tree this section
describes, not an earlier draft of it.

Slice 5 is the fifth such list, and its shape is the smallest this stage has shipped: one `api` wrapper and one
`internal_api` body, and nothing else. The migration is counted out of its own leading keywords rather than
described — `20261020190500_stage11_operations_health.sql` is 370 lines and carries two `CREATE FUNCTION`, no
`CREATE TABLE`, no `CREATE TRIGGER`, no `CREATE INDEX`, two `GRANT EXECUTE` and two `REVOKE` — so every cell
that moves here moves by one, and the cells that count tables, triggers, edges and `private` names do not move
at all. At the slice-5 head:

- `supabase/tests/stage2/30_migration_empty.sql` — **not edited**, and that absence is the assertion: `E01`
  declares the five tables this stage creates and slice 5 creates none, so `E02` loops the same five and the
  suite still reads 55 on the clean chain and 77 on the legacy one, the same pair slice 4 logged, printed again
  in `q11-logs/s11-s5-all-1526.txt`.
- `supabase/tests/stage2/40_catalog.sql` — `C26` adds `internal_api.operator_operations_summary` to the by-name
  definer inventory and its comment now reads 47; `C26d` and `C26f` each step 40 → 41 (the `api` function count,
  and the count of implementations paired by name to a wrapper); `C26e` adds the same body to the declared
  `internal_api` set; `C28b` adds both halves of the new pair, so the signed-in callable matrix it pins by name
  is 82 entries — 41 `api` plus 41 `internal_api`, counted out of the cell's own literal, against the 80 it
  pinned at slice 4; and `C29a`'s stage11 arm gains its nineteenth exposed RPC. `C26c` carries only the comment
  that explains the new count, and `C06`, `C15`, `C28a`, `C31`, `C46` and `C48` carry **no** branch — no table,
  no trigger, no foreign-key edge, no grant change and nothing anonymous. The file closes at 106 assertions on
  both historic chains again.
- `supabase/tests/stage3/30_publication.sql` — three cells, each of them a whole-surface matrix string, so each
  gained one *row* rather than a number: `G1` gains
  `operator_operations_summary(p_window_hours integer) -> jsonb | definer=n | lang=sql | vol=s |
  search_path="" | owner=postgres | anon=n | authenticated=y | service_role=n | public=n`, `G1f` gains the
  `definer=y | lang=plpgsql` twin, and `G1h` gains `wrapper_is_invoker=true impl_is_definer=true
  anon_grants_match=true authenticated_grants_match=true no_service_role_on_either=true`. The three literals
  were copied out of `q11-logs/s11-s5-g1-rows.txt` and `q11-logs/s11-s5-g1h-rows.txt`, not typed from the
  migration. `G1g` takes no branch because this body is paired — slice 4's purge stays the only `internal_api`
  name no door shadows — and `G4` takes none because the door takes an argument.
- `supabase/tests/stage4/50_pack_release.sql` — `I1` forty-one, `I2` sixty-one names (forty-one twins plus the
  same twenty maintenance bodies, so the twin-less half does not move, which is the difference between this
  slice and slice 4 stated as a number), `I3` `api_invoker 41 / api_pinned 41 / internal_definer 42 /
  internal_pinned 61`, `I4`/`I8`/`I9b` 154 real functions, and the census object `api 41 / internal_api 61 /
  private 52`.
- `supabase/tests/stage5/50_review_binding.sql` — `M5b` forty-one names, with the cell's own sentence recording
  that this surface moves by one and that `M5`'s twin-less half stays as §B left it.
- `supabase/tests/stage7/90_review_boundary.sql` — `G1` forty-one exposed names, `G2` sixty-one bodies, `G3`
  forty-one and forty-one EXECUTE grants, and the prose inside those cells moves with the literals: thirteen
  operator bodies re-read the grant row where the cell had said twelve, and "All eighteen" becomes "All
  nineteen". `G3f` — the twenty a host cannot call — takes no branch, and the cell now says so itself: the
  uncallable half "stays at twenty", the same nineteen plus that one purge, unchanged by slice 5.
- `supabase/tests/stage10/90_commerce_functions.sql` — **not edited**: `R20`'s executor census already carries
  slice 4's review-desk pair, and slice 5 gives no commerce verb a new executor.
- The four sibling Stage 11 batteries all print the head census, so all four moved: `80_operator_authority.sql`
  `A06a`/`A06b` and the closing `Z07`/`Z07b` read 41 and 61; `85_support_lifecycle.sql` `S09`/`S10` read 41 and
  61, with `S10`'s `private` half still 52 and `S10b` taking no branch; `90_privacy_intake.sql` `S10` reads
  41 / 61; and `92_takedown_and_oversight.sql` `T13`/`T14` read 41 and 61 while `T17` reads 47 definers — one
  more than slice 4's 46, and one rather than two because this slice's wrapper is INVOKER.
- `supabase/tests/stage11/run.sh` — the header census comment, rewritten in three places rather than one: the
  slices-1–4 inventory sentence becomes slices 1–5 with `internal_api` at twenty-two bodies and `api` at
  nineteen wrappers; the 41 / 61 / 52 / 154 statement is added together with the reason the twin-less half stays
  at twenty; the table and bucket figures are re-measured from `q11-logs/s11-s5-readout-1.txt`
  (`PUBLIC_TABLES=20 PRIVATE_TABLES=13 STORAGE_BUCKETS=3`) and re-read again in the certified sweep's own
  census on all seven chains, because that readout was taken eighteen and a half hours before this slice's
  last migration edit; and `run_stage11_batteries()`'s comment stops
  calling slice 5 a plan now that the file exists. The glob itself did not change — `[89]*.sql` received
  `95_operations_health.sql` on its first run, which is the property that shape is chosen for.

The slice-5 head was then swept as one command rather than mode by mode, and the sweep was green on its first
attempt because the iteration loop had already spent the red runs: `bash q11-logs/s11_s5_tier.sh all` finished
`MODE=all exit=0` (`q11-logs/s11-s5-tier-codes.txt`, `q11-logs/s11-s5-all-1303.txt`) with Stage 11's five
totals 137 / 641 / 191 / 208 / 626, each with its reported total equal to the `PASS` lines the runner counted,
the eight older-stage pairs 380 / 293, 134 / 94, 182 / 185 and 255 / 116, the Stage 2–6 sweep on both chains at
`migration_empty` 55 and 77, the draft invariant 46 and 49, publication 284, attacks 464, catalog 106, pack
release 428, the reviewed fixture 57, review binding 122, definition vocabulary 50, document resolution 124,
asset registry 91 and storage policies 80, and `API_NAMES=41` above every one of the seven chains it builds.
That log is not the one this section cites, and the reason is worth keeping: `s11-s5-all-1303.txt` was written
at 13:07, and this slice's last two SQL edits — `40_catalog.sql` at 13:19 and `95_operations_health.sql` at
13:42 — landed after it, so a figure taken from it could not be evidence about the bytes being committed.
The sweep was therefore run again, `MODE=all exit=0` beside the first line in the same tier file
(`q11-logs/s11-s5-all-1526.txt`), and that second log is what every Stage 11 number above is cited to. The
two logs are byte-identical, which is the measurement that says the interval moved no printed figure: `diff`
between them prints nothing, both carry `API_NAMES=41` on seven chains, `STAGE2 CATALOG TESTS PASSED (106)`
twice — once per historic chain — and `STAGE2 CLEAN-CHAIN TESTS PASSED (55)` and `STAGE2 LEGACY MIGRATION
TESTS PASSED (77)` on their own chains. The pair of stage-2 totals is not a discrepancy and was briefly read
as one here: `migration_empty` runs on both chains, so one log reports 55 and 77 for the same suite, and the
draft invariant likewise reports 46 and 49; a reader who greps one block and compares it against the other
block of an older log has invented a regression. Re-running the sweep is also what makes the widened tripwires
safe rather than merely green: `30_publication.sql`'s `G1`, `G1f` and `G1h`, `50_pack_release.sql`'s `I1` and
`40_catalog.sql`'s `C29a` are all equality cells between a matrix or set read out of the live catalogue and a
literal copied into the file, so a row that went stale when this slice's migration last moved would have
failed the sweep instead of passing it.
The red runs live beside the sweep rather than being dropped: `q11-logs/s11-s5-batt-7.txt` and `-8.txt` are `S7`
refusing the projection's own `search_path` pair, `-15` is `V9` naming a reconciliation reason the events table
will not accept, `-18` is `M3`'s delivery lifecycle closing over 0 where it wanted 14, `-20` is `I10` catching
the `as_of` timestamp inside a string it meant to pin, and `-23` through `-33` and `-38` are the plant cells
discovering shared-chain state — `P5`, `P8`, `T18`, `T39`, `T44`, `T46`, `T51b`, `N44` — the same failure shape
slice 4 recorded for `P10`, and repaired the same way: the cell scoped to what it planted, not the expectation
widened. Two instruments were added rather than trusted, and both were re-taken after those edits, because
each of them speaks about `95_operations_health.sql`'s own bytes and the earlier pair of readings predates
them (`q11-logs/s11-s5-runner-shape-verdict-2.txt` and `s11-s5-floor-mutant-verdict-2.txt`, both at 13:13):
the runner-shape check (`q11-logs/s11-s5-runner-shape-verdict-3.txt`, `reported=626 observed=626`,
`GUARD lines-style satisfied`, `failures=0`) and the floor mutant
(`q11-logs/s11-s5-floor-recheck-3.txt`, `mutant_exit=3`, 626 `PASS` lines, no reported total, and a message
naming 627 against the 626 it counted). The mutant is now derived from the shipped file rather than copied
out of it: the driver rewrites the two executable `626`s to `627`, refuses to run unless `diff` reports
exactly two changed lines, and then runs the shipped battery on the same chain in the same wrapper so the
mutant's redness is a delta against a green control (`shipped_exit=0`, `reported=626`) and not a cluster that
happens to be down. Those two, together, are the evidence that the 626 is a census and not a number the file
agrees with itself about. §13's fifth consequence carries what the same re-derivation did to the letter census.

A figure this document repeated three times was wrong, and the diff is what said so. §13's catalogue row, this
section's "Three planned claims" block and slice 4's own bullet all described `C28b` as a thirty-six-name or
thirty-eight-name set. Neither number is `C28b` at any Stage 11 head: the cell's comment enumerates its own
history — sixty-four at slice 2, seventy-two at slice 3, eighty at slice 4, eighty-two here — and the literal
counts 80 names at slice 4's head and 82 at this one, 41 per schema, measured by `grep -oE` over the array
between its `unnest(` and its `x));`. The thirty-eight was read out of the middle of that history comment,
where Stage 8's figure sits, and the thirty-six is the same mistake one step earlier. §13's row and slice 4's
bullet now carry the measured pair, and the sentence in this section that used the wrong one is corrected in
place rather than quietly replaced.

Three planned claims here were wrong, and measurement is what said so.

First, this section used to promise "the two counts this stage *lowers*: `service_role` loses UPDATE
and DELETE on `private.audit_events`, and `private` gains five tables". Neither half survives contact
with the catalogue. `private` gains **one** table. And `service_role` does lose those two privileges —
`AUDIT_POSTURE=svc_select=true svc_insert=true svc_update=false svc_delete=false`, printed by the
runner's own census in `q11-logs/s11-historic-5.txt` — but **no** catalogue count moves, because `C15`
asks `has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE')`, and Postgres answers a
four-verb string as ANY-of: that call returns `t` on `audit_events` at this head while the single-verb
calls return `t / t / f / f` (`q11-logs/s11-catalog-readout-1.txt`). `C15`'s label says *reach* and it
measures reach; the belief that it was a count of fully-writable tables was this document's, not the
instrument's, and the revocation is therefore asserted privilege by privilege in `80_operator_authority.sql`
(`A03`, `A08`-`A08c`, `AI01`-`AI10`) instead of by a number that cannot see it.

Second, the plan listed `C28a` and `C28b` — the anonymous and signed-in callable matrices — as cells to
extend. They took no branch, and that absence is the assertion: slice 1 exposes no callable at all, so a
browser-visible closed set that did not move is the evidence, while a `C26e`/`G1g` that grew by exactly
two unpaired names is the evidence for the side that did. That sentence held for two slices and then
only for one of them: `C28b` gained its stage11 arm when slice 2 opened ten doors, and carries the
eighty-two-name set §13's catalogue row reads at this head — the "thirty-six" this paragraph printed for two
slices was one of the historical counts inside that cell's own comment, and the slice-5 list above records how
the literal was re-counted — so a signed-in callable surface that grows
without being named there is now a failing assertion. `C28a`'s anonymous matrix still has no Stage 11 arm,
and slice 4 re-measured that rather than assuming it — `92_takedown_and_oversight.sql` `U05` is the cell
that would move if an irreversible body were ever handed to `anon`, and the 106 that `C28a` sits inside is
printed again on both chains in `q11-logs/s11-s4-historic-1603.txt`.

Third, the runner shipped with different modes than planned. `supabase/tests/stage11/run.sh` is new on
the "a new head gets a new runner" rule (`stage10/run.sh:16-21`), with `STAGE11_LOCAL=1`,
`app.stage_head=stage11`, `st11qual_` databases and masking on every printed line — but its chain modes
are `authority|historic|regress|race|all`, not the eight named here in advance. The reason is Stage 10's,
rediscovered: the modes are chain *shapes* (an empty chain for a battery whose census counts the whole
cluster, two chains for Stage 2's clean/legacy pair, one chain per older stage's own pair), not one mode
per migration slice. `race` is the fifth word and it is a chain shape as well — it builds a throwaway database
the other modes never touch (`st11qual_race`, dropped with `FORCE` when the battery ends) rather than adding a
migration. `all` takes the tier with it, which is Stage 10's shape (`stage10/run.sh:433`), and that has a consequence
for the numbers elsewhere in this document: the `all` total §15 records — 1526 cells across the five serial batteries
— is the pre-race figure, and it is still the last measured `all` total, because `all` has not been re-run with the
tier inside it. What has been measured is the tier on its own word: `race` was driven twice, green both times
(`q11-logs/s11-race-run-6.txt`, `q11-logs/s11-race-run-7.txt` at the pushed head), and the harness that §15's
sentence guessed might "fail on a harness no engine has ever driven" turned out to need real repair before it
passed at all — a frozen `pg_stat_activity` name join replaced by a pid rendezvous on `pg_locks`, one re-scoped
key count, two `RD` rows widened from a state read to a `publication_takedown` class guard, and one
one-character call-arity defect. Its counted contribution in isolation is 34 cells (`(9)` plant, `(10)` arm 1,
`(7)` arm 4, `(8)` replay), so the arithmetic the next `all` owes is known rather than forecast even though the
run itself is still outstanding. §13's replay, two-operator, revoked-mid-flight and second-tab rows no longer
name an authored arm and disclaim it in the same breath; they cite those two logs.

Three instruments stand behind that tier and none of them opens a connection, so none of them is a race-tier pass.
Each is a claim about the bytes of the tier and its driver, and each has been made to demonstrate that it can say
no — which is the only reason the two green runs are worth more than their own exit codes.

**The structure validator.** `scripts/stage11-race-structure.sh` — promoted out of this session's
`q11-racecheck/check_race_tier.sh`, which is the path the captures below were taken at; the paragraph at the end
of this section records the move and its proof — reads the fifteen files under
`supabase/tests/stage11/race/` plus the `race` block of `supabase/tests/stage11/run.sh` and answers 26 numbered
rules that print 30 lines, because `S02` carries two claims (that the chain build, the battery and the teardown
are live lines of the dispatch block, and that they sit in that order) and `S07` carries four (one assert file
each, plus the tier-wide arithmetic). What it decides, rule by rule, is in `q11-logs/s11-race-structure-5.txt`:
`run.sh` parses as bash (`S01`); the fifteen files on disk are the fifteen the driver references, with nothing
orphaned in either direction and no arm reachable by the serial glob (`S03`); dollar-quote tags open and close an
even number of times in every file (`S04`); only the four suite files may print a counted total and no session
file may call a counting helper, so an arm is chronology and can never be read as a score (`S05`, `S06`); the 25
numbered cells are declared exactly once and every `RC`/`RD` token anywhere in the tier or the driver names one of
them (`S07d`, `S14`); cross-session order rests on `pg_locks` rows over real locks, with no advisory lock in
either file (`S08`); all 14 plant/gate failure notices are followed within three lines by a `RAISE EXCEPTION`, and
both `start_session` definitions carry `ON_ERROR_STOP=1`, so a plant that fails cannot exit 0 and be counted as
an arm that passed (`S09`, `S12`); every rendezvous token sits under an `ARM_INVALID` test on its own gate string,
so a poll that never saw the wait aborts rather than reporting (`S10`); all 26 markers the driver waits on are
literal strings the session that must print them is able to print (`S11`) — the rule that caught an arm printing
its banner through a `%` placeholder the driver could never match; the driver's 900-second budget exceeds the
longest in-SQL poll of 600 and no marker call shortens it, so the session's own `ARM_INVALID` surfaces first
(`S13`); all 93 tokens the eleven sessions emit belong to one of the two vocabularies the driver greps the log
with (`S15`); suite files hold no top-level transaction statement while each session file owns and ends its own
(`S16`); the tier's only `pg_sleep` is the 0.05 poll cadence and every file that polls can return `ARM_INVALID`
(`S17`); every `…03xx` key is named inside one arm only and lies in the allocated `0301`-`0313` block (`S18`);
every uuid is under the `0b0b0b00` plant prefix, the race block names only its own chain, and only the fixture
issues teardown DDL (`S19`); all 41 punctuation-free verdict literals and marker patterns survive `mask()`
unchanged (`S20`); the holder's own transaction id and the revoker's observed xid are both extracted and
compared, with `exit 1` within eight lines of disagreement (`S21`); no executable line in the tier or the driver
names the local stack, the Supabase CLI or a hosted endpoint (`S22`); each token lives in the namespace of the
session that prints it and no session spans two (`S23`); no session reads `pg_stat_activity` in an executable
line while all six wait helpers return `waiterpids` (`S24`); all six arms bind those pids to the peer's own
logged `pg_backend_pid()` and refuse both an unverifiable and a mismatched witness (`S25`); and all 51
`pg_temp` helper calls carry the arity their definitions declare (`S26`). At the head this pass opened that is
30 lines and `validator_exit=0`. It was re-taken once this section stopped moving:
`q11-logs/s11-race-structure-7.txt` is the run against the final bytes of this paragraph, prints the same 30
`PASS` lines with no `FAIL`, ends `structure_validator_exit=0`, and stamps the head plus the working tree it read,
so the claim "these sentences were checked" is a measurement of the bytes that ship rather than of an earlier read.

Two of those thirty lines were decoration before anything fired them, and both catches are kept rather than
relabelled: `q11-logs/s11-race-mutation-control-1b-FOUND-INERT-S06-S07.txt` prints `INERT S06` — the mutated copy
still reported every rule green — and `WRONG S07/84_race_replay_asserts.sql`, where the copy failed but not on the
target rule, and it closes `MUTATION CONTROL FAILED: 2 of 27 rules did not fire on their own defect`. A third
defect was in how the validator was invoked rather than in what it checked: run by bare name from inside its own
directory, `${0%/*}` evaluates to `$0`, so the arity helper beside it was declared missing and `S26` reported an
unmeasured rule; the `SELF_DIR` repair is recorded with both invocation forms re-taken green in
`q11-logs/s11-race-structure-4.txt`. And `S02`'s first draft grepped the whole runner, which let the mutation
control comment the chain build out with a line that repeated the words and leave the rule green on a tier whose
arms would have run against no database at all; it now requires live, non-comment lines inside the block, and
`S02b` pins their order, because a build behind the arms is arms run against somebody else's chain.

**The mutation battery.** `scripts/stage11-race-mutation.sh` (promoted from
`q11-racecheck/mutation_control.sh`) copies the tier into a fresh `mktemp` tree 31 times:
once unmuted, to prove the copy is equivalent to the tree, then 30 times breaking exactly one property per copy —
a deletion, a rewrite or an append inside an existing block, so the rest of the file stays byte-identical and a
failure names one property instead of a diff — and requires the named rule to fail each time. It writes nothing to
the repository, and no copy is given a database. The authoritative capture is
`q11-logs/s11-race-mutation-control-3.txt`: `tree_head=9bd83ca…`, `BASELINE ok`, thirty `FIRED` lines,
`mutation_control_exit=0`, and the closing line `MUTATION CONTROL PASSED (30 of 30 rules, each fired against its
own defect; 1 unmuted copy also passed)`. Its cost is on the record too — `utc_start=06:26:47Z`,
`utc_end=07:52:00Z`, eighty-five minutes for thirty-one validator runs on a shared host — and there is no cheaper
way to show that a green line is capable of going red. Six cases co-fire a second rule (`S02`+`S02b`, `S05`+`S06`,
`S06`+`S07d`, `S07/84`+`S14`, `S07d`+`S07/82`, `S20`+`S15`). That is correct behaviour — a cell that stops
existing must not stay cited — but it blurs which property broke, which is why single-rule cases are the default
and why the list is printed instead of hidden. Because "30 of 30" is a sentence the battery writes about itself,
`q11-racecheck/verify_mutation_capture.sh`, now `scripts/stage11-mutation-capture-verify.sh`, re-reads the
capture and re-derives it from the per-case lines: every
case must name a rule that appears in its own failing set, no case may be `INERT`/`WRONG`/`SETUP`/`COVERAGE`, no
case may be reported `FIRED` with `exit=0`, the verdict must equal the count of `FIRED` lines, and the exit marker
and the head must both be stamped. That re-derivation prints five `PASS` lines and the co-firing list in
`q11-logs/s11-race-mutation-verify-1.txt` and ends `MUTATION CAPTURE VERIFIED (30 cases, baseline green, exit 0)`.

A second capture exists and is not quotable, and it is kept because the reason is an instrument lesson, not a
typo. `q11-logs/s11-race-mutation-control-2-SUPERSEDED-concurrent-run.txt` was mid-battery when a second battery
was started into `-3.txt`. The first process was never killed: it kept its file descriptor open, wrote `VOID:
stopped after 4 of 30 cases` and then continued past its own marker to a `PASSED (30 of 30)` line. So the marker
is false — that run did reach its end — while it carries no wrapper-recorded exit code, no `utc_end`, and
per-case durations measured against a concurrent battery on a shared host. The correction is appended inside that
file rather than left for a reader who finds it first. The lesson is the §0 vocabulary seen from the other side:
a run that never recorded what it observed is not evidence at any of the five levels, however green its last line
reads.

The battery ran at `9bd83ca` and this section is read at a later head, so the reach of those thirty verdicts was
measured, not assumed: `git diff 9bd83ca..HEAD -- supabase/tests/stage11` prints nothing (the delta is two
documents), and the tier's bytes in the working tree are its bytes in the commit — the sha256 of `run.sh` and of
each of the fifteen race files taken once from `git show HEAD:` and once from disk agrees on all sixteen, with
`files_compared=16 differing=0` in `q11-logs/s11-race-tier-head-bytes-2.txt`. The sixteen digests are the same
sixteen printed file by file in `q11-logs/s11-race-commit-bytes-check-1.txt`, which is the pair that ties
`s11-race-run-7.txt` to committed bytes rather than to a working tree.

**The citation checker.** `scripts/stage11-race-doc-citations.sh` (promoted from
`q11-racecheck/check_doc_citations.sh`) answers two questions this document cannot answer
about itself: whether every arm marker the four race rows print is a string the run log actually contains, and
whether every cell those rows name singly is a cell the tier declares, with the range forms contiguous over those
declarations. Against `q11-logs/s11-race-run-7.txt` it reports all 22 markers verbatim, all 17 doc-named cells
among the 25 declarations, `RC00`-`RC16` contiguous at 17 and `RD00`-`RD07` contiguous at 8, and the arithmetic
that holds the two together: the four suite totals in the log sum to 34, which is what the tier declares as 9
plant cells plus 25 numbered ones (`q11-logs/s11-race-doc-citations-1.txt`, `code=0`). Its negative control is in
the same file: with one suite total doctored from 8 to 7 the checker prints
`MISMATCH  the log's suite totals (33) do not equal the tier's counted cells (34)` and exits 1, so the agreement
above it is a measurement rather than a coincidence. The checker reads §13's rows through a fixed line window of
this file, which is a fragility of the instrument and not of the evidence, and it is therefore re-run whenever
anything in or above those rows moves. The run cited for this section's own bytes is
`q11-logs/s11-race-doc-citations-3.txt`, taken after the last markdown byte above it: the same five `PASS` lines
and the same arithmetic, ending `citation_checker_exit=0`, with the sha256 of the document bytes it read stamped
beside the head — which is what makes "these sentences cite that log" a measurement of this commit rather than of
the one before it.

That last clause — a fixed line window, re-run whenever anything in or above those rows moves — was honoured, and
then made unnecessary by a change to the instrument rather than to the arithmetic, and what forced it was this
pass's own editing. The lines this stage added above the threat matrix, retiring §15's and §16's stale runtime
claims, shifted the two race rows from 908–909 to 915–916 while the checker still read lines 900..915. Over the
committed document (HEAD `dbbbebf1`) that window extracts 22 arm markers, and all seven arm-4 names are inside it,
which is what the `markers=22` figure above honestly reports; over this working tree the same window extracts **9**
and none of the seven — `A4_SEES_WAITER_BLOCKED`, `A4_SAW_REVOKE_COMMITTED`, `R4_SEES_WAITER_BLOCKED`,
`W4_AUTH_AT_ENTRY`, `W4_APPLIED`, `W4_ENDED`, `W4_AUTH_AFTER` — and exits 0 regardless. Nothing failed loudly: the
checker read a block that had lost an entire race arm and printed a PASS about text it no longer names, which is
the mode §13's rule exists to catch. The 14 names the shifted window never read are printed one per line as
`markers_the_window_never_read` in `q11-logs/s11-citecheck-anchor-controls-1.txt`.

The repair removes the coupling instead of re-typing its numbers: rule 1 locates the contiguous Markdown table
carrying the row that opens `| Race: two operators`, prints the range it read on every run, and exits 2 with
`SETUP: … rule 1 has nothing to read` if that row is gone, so a shrunken or empty window cannot pass. Re-taken at
this tree it answers `BLOCK rule 1 reads doc lines 906..927 (22 table rows)` and
`markers=23 cells=17 numbered=25 counted=34`, green against both race captures (`run6 code=0`, `run7 code=0` in
the same file); the name the 22 did not include is `API_NAMES`, printed by a row below the retired window's last
line. Four controls come with it. Ten blank lines inserted above the matrix move the reported range to `916..937`
with the same 23 markers and `shift code=0`, which is the property the repair was for. Deleting the arm-1 row earns
`anchor code=2` from the anchored rule, while the retired window reading that same doctored file still finds 11
markers and would have passed over it (`retired-window-still-reads:`, 11 lines). Renaming one arm-4 marker to
`W4_ENDED_ISH` earns `ABSENT W4_ENDED_ISH (printed by the doc, absent from the run log)` and `marker2 code=1`, and
`retired_window_saw_the_mutation=0` says the pinned window could not have caught that defect at all. That last
control was run twice and the first run is void: its needle demanded a closing backtick after `W4_ENDED=` and the
document prints none — the marker runs straight into `act-completed-after-revocation` — so nothing was mutated,
`needle_lines=0` printed only after the checker had already returned its green, and that green described
unmutated bytes. The sequel checks the needle before trusting the instrument and then fails as designed
(`needle_present=1 original_present=0`): `q11-logs/s11-citecheck-anchor-controls-2.txt`,
`harness2_exit=1`, harnesses `q11-logs/run-citecheck-anchor-controls.sh` and `-2.sh`. Their fixtures are copies of
the document, the tier and the scripts under `q11-citecheck/` (1.6 MiB); no committed file was opened for writing
by any of them. What the anchor does not buy: it guarantees the checker reads the right block, not that the block's
sentences are true, and rules 2–4 are untouched. The paragraph added here sits *below* the matrix, so the range it
quotes stays `906..927`; the next edit above the matrix will move it, and the checker will print the new range
rather than read the old one in silence.

One limitation covered all three instruments, and it is now closed by a move rather than by a sentence: they
lived in this session's `q11-racecheck/` directory, outside the repository, and were cited by log path exactly as
this stage's other shell probes are (`q11-logs/s11_s5_tier.sh`, `q11-logs/s11-http-tier-probe.sh`), so a reader
who cloned this branch got the tier, its runner and its batteries but not the validator that checks the tier's
shape and not the battery that proves that validator can fail. Five files now ship —
`scripts/stage11-race-structure.sh`, `scripts/stage11-race-arity.pl`, `scripts/stage11-race-mutation.sh`,
`scripts/stage11-mutation-capture-verify.sh` and `scripts/stage11-race-doc-citations.sh` — and the move is
measured in `q11-logs/s11-promotion-proof-1.txt`, whose steps each print their own adjacent exit code.

What had to change was resolution, not logic: every machine path and every session-only name is gone
(`residual_machine_paths` and `residual_old_names` both 0 for each of the five files), the four shells parse with
`bash -n` and the helper with `perl -c` at `code=0`, and each instrument derives its own repository, so all four
ways a reader can invoke it — no argument, an explicit repository argument, by bare name from inside `scripts/`,
and by absolute path from the root — answered `exit=0` with `pass_lines=30 fail_lines=0`, including the
`S26: all 51 pg_temp helper calls in the tier carry the arity their definitions declare` line that the bare-name
form once lost. Byte form is the part a Windows clone cannot skip, and it was tested rather than assumed: an
index-and-worktree copy of the branch landed 21 of 21 requested files with the tier's CRLF forms intact
(`run.sh|cr=662`, `70_race_fixtures.sql|cr=445`), and three pairings then ran green — an LF instrument judging a
CRLF tier, a CRLF instrument judging that same CRLF tier (the subject that matters: exactly what a clone without
a pin hands a reader), and, after the `.gitattributes` rules added beside these files (`scripts/*.sh text eol=lf`,
`scripts/*.pl text eol=lf`), a pinned instrument judging a pinned tier. Each printed 30 `PASS` and no `FAIL`.
The pin's own effect was sampled on the two files whose resolution it exercises — `stage11-race-structure.sh`
and `stage11-race-arity.pl`, both `cr=0` on checkout after it where both had been `cr=474` and `cr=82` before —
while `supabase/tests/stage11/run.sh` keeps its CRLF working copy, because this stage pins its instruments and
not the tier's runner; step 7 of the same capture lists all five promoted files as `i/lf w/lf attr/text eol=lf`.

The `S26` floor hid one hazard one level down, and this pass walked into it. The arity helper walks `@ARGV` and has
no default file list, so the static-gate harness that ran `perl scripts/stage11-race-arity.pl` bare from the
repository root examined nothing and said so cheerfully — `call-arity check: 0 helper calls examined, 0 malformed`
with `race_arity_exit=0` in `q11-logs/s11-static-gates-anchor-repair-1.txt`. A green line whose subject was an
empty list is the same failure mode as the stale window above, caught here only because it was printed and read
rather than counted. The composed validator was never exposed to it: `S26` requires an examined count of at least
40 alongside exit 0 (`scripts/stage11-race-structure.sh:459`), so a zero-file run fails the tier check instead of
passing it; the harness calling the helper directly was the unprotected path. Two changes close it — the helper
refuses an empty list with a usage line and exit 2, and the gate invocation names the tier's files. Both shapes are
printed in `q11-logs/s11-static-gates-anchor-repair-4.txt`: `51 helper calls examined, 0 malformed` at
`race_arity_exit=0` for the glob, and `bare_code=2` with `bare_says_zero=0` for the bare form, which is the
measurement that the "0 examined, exit 0" line cannot be produced again. That capture re-takes the rest of the
static set at these bytes — `product:check` 263 files and 0 violations, its self-test 34 rules, `check-db-contract`
37 migrations, `S01`–`S26` at `race_structure_exit=0`, the CLI battery at `cli_unit_battery_exit=0` with
`Tests 40 passed (40)` under vitest (the `node --test` shape in capture -1 was this harness's error, not the tree's:
the file imports vitest and cannot load outside its runner), the citation checker green against both race logs at
`markers=23`, and the mutation-capture verifier's five `PASS` lines. Disk is recorded on either side of it,
1,915,976 KB free before and 1,688,492 KB after, because this host has been falling and these gates are cheap.

The promotion adds no gate, which was the owner's condition and is read from the three instruments that could
have grown one: `vitest.config.ts:11` collects `src/**/*.{test,spec}.{ts,tsx}` and `scripts/**/*.test.mjs`, so a
`.sh` and a `.pl` are never loaded by `npm test`; `scripts/check-product-contract.mjs:49` sets
`EXCLUDED_PREFIXES = ["docs/audits/", "scripts/"]` and applies it at `:687`, so `product:check` never scans
them; and `package.json`'s script list has no shell-lint or formatter entry that could reach them. They are
callable on demand. That includes the mutation battery's cost — thirty-one validator runs took 5,113 s pre
promotion and the full verdict already landed in `q11-logs/s11-race-mutation-control-3.txt`, so the promoted
copy was executed under a deliberate 900 s budget (`battery|exit=124`, `baseline_ok_lines=1`,
`fired_lines=11`, `inert_lines=0`), proving the promoted path runs rather than repeating finished
qualification. The pair's refusal behaviour was then proven on the same bytes: the capture verifier accepted
the retained complete run (`exit=0`, five `PASS` lines, `MUTATION CAPTURE VERIFIED (30 cases…`) and refused the
truncated one (`exit=1`, `ABSENT no PASSED verdict line`, `BADCODE mutation_control_exit=124`).
The citation checker, promoted, re-ran green against `q11-logs/s11-race-run-7.txt` at the same head
(`markers=22 cells=17 numbered=25 counted=34`, `exit=0`).

What still lives outside the repository is the evidence itself — every `q11-logs/` capture, all of them
machine-local by design — and one recursion that cannot be written away: this section names a capture whose
stamped digest is of the bytes it read, so the sentence naming that capture cannot be inside it. The pairing of
the *shipped* document bytes with the checker's verdict therefore belongs to the run-log directory, and the
last re-run recorded there is the authority for "these sentences were checked", not the one this paragraph
cites.

`scripts/check-db-contract.mjs` compares the migrations with the generated
`src/integrations/supabase/types.ts` for **tables in `public`** and for nothing else — at this head it prints
`schema: 20 public + 21 non-client table(s)` and `client types: 20 table(s); data layer: 45 query column
group(s) reconciled, 0 finding(s)` and exits 0 — so the plan's sentence that the file "is regenerated once a
wrapper exists" was measured rather than repeated, and it does not hold: a new `api` wrapper is outside that
checker's scope, and no regeneration was owed by any of the five slices. What is owed one step removed is
larger, and it has now been measured instead of forecast: `stage3_publication.test.mjs`'s `API33` reads the
live `api` and `internal_api` surfaces and compares them against `INTENDED`, `MAINTENANCE_ONLY`,
`COMMERCE_SERVICE_ONLY` and — since this stage widened it — `OPERATOR_SERVICE_ONLY`
(`supabase/tests/api/stage3_publication.test.mjs:1264`), and when the pushed stack was first walked suite by
suite (`q11-logs/s11-http-tier-probe.sh`, whose first suite output is stamped 13:16 on 2026-10-25, twelve
minutes after `s11-q2-applied-fingerprint.txt` stamps the apply at 13:04) those closed
inventories did refuse Stage 11's surface. `q11-logs/s11-http-tier/stage3_publication.txt` prints
**39 tests / 37 pass / 2 fail**: `API33` failing as `unexpected callable in api:` with all nineteen of this
stage's exposed RPCs named in its own message, and `API39` failing as
`['commerce_host_summary','operator_add_commerce_review_note','operator_commerce_review_queue']` against the
single name its list held — the two doors that carry `commerce` in their names landing in a set written
before they existed. The same sweep failed `CAT-08` in Stage 4's suite (**28 / 27 / 1**) and `WRT-04` in
Stage 5's (**28 / 27 / 1**), and the other seven of the ten suites that probe walked — `stage3_security`
56/56, `stage5_admin_cli` 36/36, `stage6_storage` 34/34, `stage7_family_approval` 61/61,
`stage8_guest_rsvp` 56/56, `stage9_render_outputs` 30/30, `stage10_commerce_http` 68/68 — stayed green
across it, which is what turns the three reds into a measurement of the three lists rather than of the
stack. The widening that answers them is `4d1daae`, the same three files Stage 7 and Stage 8 widened in
turn, and at this head a grep of the HTTP tier for `operator_`, `support_case` or `privacy_request` returns
**435** lines across **four** of its **eleven** files, 385 of them Stage 11's own battery. The sentence this
paragraph carried until now said *zero*, which was true the day slice 5 wrote it, is false because of
`4d1daae`, and is corrected here rather than quietly replaced. Re-running those three suites on 2026-10-25
printed `stage3_publication` **39 / 39 / 0**, `stage4_tradition_packs` **28 / 28 / 0** and
`stage5_pack_driven_http` **28 / 28 / 0** (`q11-logs/s11-http-tier/after-*.txt`), so the loop closes on the
instrument's own terms: it fires on an unnamed door and goes quiet once the door is named. What that green
trio does *not* certify is a head. The three captures are stamped 13:31, 13:31 and 13:32 on 2026-10-25 and
the widened files were committed as `b18027d` and `4d1daae` at 21:38 and 21:40 on 2026-10-26; none of the
three prints a git head, or even a forty-character sha, so what passed was a working tree and the
*committed* lists have never been executed. The same caveat applies to the two captures §16 records —
`s11-http-stage11-a5.txt` at 16:15 and `s11-http-c3.txt` at 18:26 on 2026-10-25, both before either commit
and neither stamped with a head — and §16's list of what did not run beside them stood until 2026-10-31, when the
whole 38-cell battery went green on that stack (`q11-logs/s11-runtime-2-stage11-http-5.txt`, the first Stage 11
HTTP capture to stamp a head at both ends: `HEAD dbbbebf1…` on its first line and `git_head_after|dbbbebf1…` on
its last). That head stamp buys less than it appears to, and §15 is where the reason is written out: the head it
names does not yet carry the repair the run measured, its census is the harness's own before/after read rather
than the runner's inside-chain read, and it stamped line counts where the harness now stamps a digest. Neither has the runner's own chain, and the reason is no longer a missing engine: the probe that
walked the suites called `node --test` once per file (`q11-logs/s11-http-tier-probe.sh:31`) and deliberately
bypassed `supabase/tests/api/run.sh`, so that file's `leak_census` baseline (`:188`) and closing comparison
(`:277`), its precondition object list (`:200`) and its migration-count parity (`:225`–`:245`) have still
never printed against Stage 11 — the parity sentence `ok  N migrations applied, matching supabase/migrations`
appears in no capture under `q11-logs/`. The residue picture is more mixed than the first version of this
paragraph claimed. It said the only residue printed anywhere was Stage 11's own, and the ten captures say
otherwise: five of them close with their own residue census (`stage6_storage`, `stage7_family_approval`,
`stage8_guest_rsvp`, `stage9_render_outputs`, `stage10_commerce_http`) and five print none at all
(`stage3_publication`, `stage3_security`, `stage4_tradition_packs`, `stage5_admin_cli`,
`stage5_pack_driven_http`), so six of the eleven suites in the tier prove their own cleanup and five do not.
Stage 11's block is the second of those six, and it is in all five of its captures rather than only the green
two — `operator_grants=0 support_cases=0 support_case_events=0 privacy_requests=0 commerce_review_notes=0
stage11_audit_rows=0` prints in `s11-http-stage11-a2.txt`, `-a4.txt`, `-a5.txt`, `s11-http-c2.txt` and
`s11-http-c3.txt`, which is three failed or cancelled runs alongside the two green ones, because the census
runs in the teardown hook and a teardown hook fires on a red suite too. That is still a suite proving it
cleaned up after itself, not eleven suites proving the same thing inside one chain with a baseline to compare
against. `docs/product/feature-readiness.md` is treated the same way, and this change touches
three rows and no more: the "Admin / operations console" row no longer says the
repository has *no* admin-facing surface, because `private.operator_grants` and nineteen named `api` RPCs are
one, the "Activity / audit logging" row no longer lets its own clause stand alone, and the "Data-access adapter"
row's word *all* is falsified by this stage rather than merely overtaken by it — its claim that ten modules call
every exposed `api` function went from short by one name to short by twenty, nineteen of them this stage's, and
the row now prints the measured split. The console row has since been edited a second time, for a different
reason and disclosed here: it used to close by saying none of the nineteen had been called over HTTP and that
the stack's apply of these six files was outstanding, and §16's push plus the A and C captures make both
halves false, so it now prints what ran beside the list of what did not — groups T, R, V, AI and H, a grant,
revoke or purge that actually executes, the races *over the wire* (that clause was rewritten when the race tier
ran: the row no longer lists the races among the absences, and says instead that the tier executed on a host
cluster and what remains unrun is the same collision through PostgREST), the runner's own chain — with its label unchanged.
The row has been edited a third time for the same reason, disclosed in the same place: it opened its absence list
with "the same file's groups T, R, V, AI and H", and §16's whole-file 38 / 38 capture is what retired that clause
rather than any change to what the groups do. What the row lists as unrun now therefore starts where the battery
cannot reach — an operator grant or revoke, or a console purge, *executed* rather than dry-run or refused, the
runner's own chain, and the collision through PostgREST — and it prints the whole-file run beside the two family
captures that came before it. Its label moves for none of it: rule 3 still earns `PLANNED V1`, because nothing in `src/` names an operator verb. The
rest of the matrix is recorded below, not rewritten. That clause — "no writer
in product code" — survived the re-read and still says something true: no query in `src/` names
`private.audit_events`. What the row did not say is that thirty-nine `INSERT INTO private.audit_events`
statements across ten migrations write the trail today, twenty-nine of them Stage 10's and ten of them this
stage's, every one of them inside an `internal_api` or `private` function body. The thirty-nine is the second
number this slice's documentation pass had to correct, and the trap is worth keeping: the plain
`grep -rc "INSERT INTO private.audit_events" supabase/migrations/` prints **forty** matches, and the fortieth is
the comment at `20261020190000_stage11_operator_authority.sql:185`, which quotes the phrase while justifying the
`ALTER` that let the existing sites go unchanged. A comment is not a writer, so the re-derivation drops comment
lines, and the first draft of the readiness row and the first draft of this paragraph — both written in this
slice, and both corrected before commit — repeated the match count as a write count. Those two rows keep `PLANNED V1`: rule 3
earns a status from working code *plus* a test or verified manual check of the user-visible feature, and there
is no console screen, no activity view and no browser interaction with either. The third item in that list used
to read *no HTTP call*, and it is now false on its own terms: groups A and C of
`supabase/tests/api/stage11_operations_http.test.mjs` put the nineteen doors and the ticket lifecycle over HTTP
against the pushed stack — 7 tests / 7 pass and 9 / 9 (`§16`) — and the whole file has since run in one pass on
that stack, so `T`, `V`, `R`, `AI` and `H` answered too (38 / 38, §16) — so the labels rest on the product surface this
stage did not build, which is what rule 3 asks, and not on a server that has since been fed the schema. The
descriptions move and the labels do not, which is recorded here rather than left to the reader to infer. The
rule-3 sweep then read the rest of that matrix and `README.md` for the same class of sentence and found five
more cells — four rows and one README bullet — whose counts do not match this head. Whose they are was not
settled by subtraction: the head before this stage's kickoff (`c9eb27a`), this head, and the head the matrix
itself names (`f7096ef`) were each extracted with `git archive` into scratch trees outside the clone and every
tree ran its own copies of the checkers, so each figure below is an instrument readout at a named tree rather
than a prediction of one (`q11-logs/s11-s5-doc-stale-1.txt`, `q11-logs/s11-s5-doc-stale-3.txt`).
`dbtypes:check` prints **37** migration files, **20 public + 21 non-client** tables and **45** query column
groups in this tree; in `c9eb27a`, **31**, **20 + 16** and **45**; in `f7096ef`, **24**, **20 + 10** and **45**.
The "Forward migration chain" row prints **21** files, **19 public + 10 non-client** and **34** column groups,
and none of those three is this stage's falsification: the column groups are identical at all three trees, so
the **34** was already wrong at the head the neighbouring row pins itself to; the twentieth `public` table is
`invitation_outputs`, created by Stage 9's `20261013120000_stage9_render_outputs.sql` and named by six files
under `src/`; and **10** non-client is exactly what `f7096ef` prints, so the "Canonical domain schema" row's **2**
`private` tables were overtaken by Stage 10's six commerce tables first and this stage's five after — the same
parser lists eight private names at `c9eb27a` and thirteen here. `README.md:252` and the "Row-level security"
row print **13** `api` and **24** `internal_api` as a live-stack read at Stage 7's head, while the same names
counted in migration source are **22** and **39** at `c9eb27a` against **41** and **61** here: two instruments,
which is why the pair is recorded as a comparison and not as a correction. `product:check` scanned **262** files
in this tree when slice 5 wrote that sentence, **260** of them tracked here and **258** at `c9eb27a`, and the two
this stage added were its own design note and its kickoff spec. The figure is **263** at the head this section now
describes, and the step was re-measured rather than inferred: the checker's own `isScannedPath` was run over two
`git archive` trees — **248** tracked in scope at `f7096ef`, **261** at this head, thirteen additions and no
removal, with the thirteen named in `q11-logs/s11-doc-scan-delta-1.txt` — and the thirteenth, the one that arrived
after the earlier capture printed **262**, is `supabase/tests/api/stage11_operations_http.test.mjs`,
Stage 11's own HTTP battery, which became tracked at `b18027d` on 2026-10-26. So the addition is this stage's, and
it is still not this stage's *instrument* that moved it: the operations CLI and its forty-cell battery sit under
`scripts/`, where the walk answers `false`. The **261** tracked names and the **263** on disk are one measurement
seen twice, the two-file gap being this worktree's untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml`; the row
now leads with **263** beside its own capture, and the
**250** it used to lead with stays pinned to `f7096ef`, whose
tracked tree scans **248** while the log that row cites printed **250**, the row itself disclosing that its
figure came from a working tree — this tree's own gap is the same shape, `pnpm-lock.yaml` and
`pnpm-workspace.yaml`; and its **32** rules were true at `f7096ef`, where the checker's own id list ends at
`qr-encoder-imported-outside-its-owner`, but not at `c9eb27a`, which prints **33** because Stage 10's `7a2eeb6`
added `client-side-checkout-affordance` — and `git rev-list c9eb27a..HEAD -- scripts/check-product-contract.mjs`
prints exactly one commit, `c898cbb`, whose diff against this file is three added and two removed lines, every
one of them inside a `//` comment, so *at HEAD* this stage moved no rule. That last clause was wrong as written
when this section first said it, and the truth needs both halves. The rev-list is not empty: it names the
comment-only commit that corrected the surface count described two sentences below. And the stage did add a
rule — `operator-rpc-referenced-outside-cli`, the one §13's tool row rests on — but it has lived in the working
tree only: `git show HEAD:scripts/check-product-contract.mjs` counts **33** rule ids and carries zero
occurrences of that name, while this tree's file counts **34** and carries three, `git diff --stat` printing
+73 lines against the checker. So §13 was describing a guard that existed in bytes nobody had committed, and
the **33**-rule self-test logs cited further down were correct for the trees they ran on; the commit this pass
makes is the one where the rule, the CLI, its unit battery and this document finally agree. Five cells, then,
every one of them false before this stage
opened, and recorded here rather than repaired here, because a documentation fix that is not this stage's defect
is a second piece of work wearing this one's label. One sentence this stage *did* falsify lives in
`scripts/check-product-contract.mjs`, whose checkout rule explains itself by naming the exposed surface as
twenty-two functions; with Stage 11's nineteen the distinct `api` names are forty-one, the comment now says so,
and the sentence's actual point survived the re-check — none of those forty-one names contains `initiate`,
`checkout`, `capture`, `refund` or `dispute`. A new
`supabase/tests/stage11/` battery directory joins the sweep, and the historical Stage 2–10 chains are run
at each head: a foundation that weakens Stage 3's publication, Stage 6's private assets, Stage 8's guest
privacy or Stage 9's delivery claims is not a foundation.

One defect this stage owned outright was not a figure at all but a rendering, and it is the kind a prose-only
truth pass cannot see: §9's `migrations` row had been hand-wrapped *inside its own cell*, so the pipe that
closes it sat two lines below the pipe that opens it and the markdown renderer shows a broken block instead of
a row. It is Stage 11's own, not inherited — `git blame` over the three physical lines at HEAD attributes all
three to `4043dda`, slice 4's docs commit (`q11-logs/s11-s5-pipe-evidence-8.txt` B.1), and the same log reads
HEAD's shape out of `git show` rather than from memory: 79 table rows, exactly one of them not ending in a
pipe, at line 384, carrying three structural pipes where a three-column row needs four. Slice 5 lengthened
that cell's text and left the wrap standing, which is why the repair belongs here rather than in the
record-only list above. The join is measured, not asserted: the shipped row is one physical line of 1455
characters, opens and closes with a pipe, splits into the same three segments as the `| --- | --- | --- |`
header above it, contains no double-space run where a wrap used to be and an even number of backticks, and
holds no escaped pipe — with the whole file carrying exactly one, so the counter is known able to report a
non-zero number (`q11-logs/s11_s5_row_content_check.cjs`, section C.2 of that log). What the log cannot
re-derive is how many physical lines *this slice's* version of the row spanned before the join: those bytes are
gone, HEAD holds only slice 4's shorter shape, and the count survives solely in the join script's own stdout,
so it is not printed here as a measurement. Section A of the same log then reads `rows whose structural pipe
count is not 4: []` across all 79 rows, and the sweep that looked for the shape everywhere — every file
matched by `git ls-files 'docs/**/*.md' 'README.md'`, checked rather than guessed — found one other offender
and named it: `docs/audits/stage-8-guest-rsvp.md:1417`, a row in Stage 8's own audit section that this stage
did not move. It is recorded, not repaired, for the reason already given. Seven earlier runs of that evidence
driver are void or superseded and `q11-logs/s11-s5-pipe-evidence-codes.txt` says which is which: two predate
sections B.1 and C.2 entirely, three printed the escaped-pipe count from a character class that had collapsed
into "bracket or pipe" and so reported the four structural pipes as escapes (an earlier form of the same
expression printed 1456 for the same reason), and two died because section B.1 `cd`-ed into the clone, leaving
section C.2's script unfindable — while the line the driver logged still read `exit=0`, because the last
command in the file is a `git diff --stat`. The driver now runs B.1 in a subshell and aborts unless C.2 exits
0; `-8.txt` is the surviving log, and a re-run today reproduces it byte for byte except the working-tree
insertion count in its own diff tail, which grew as this paragraph was written. Because this section prints
the checker figures too, the three node gates were re-taken after the last markdown byte rather than inherited
from the earlier read: `q11-logs/s11-s5-doc-readiness-3.txt` through `-6.txt` each end `product:check code=0`
on **262** active files with 0 violations, `dbtypes:check code=0` on **37** migrations with **20 public + 21
non-client** tables and **45** reconciled column groups, and `self-test code=0` on **33** rules; the four logs
are byte-identical, `-6.txt` is the run written after the final byte of this paragraph, and the identity is
what turns "the prose pass moved no figure" from an assumption into a measurement — the same four numbers the
stale-cell list above reads, unchanged.

Those figures moved afterwards, by exactly one rule, and the move is the arrival of the guard §13's tool row
rests on. The checker was re-taken after the last markdown byte of this section and prints `Product contract
self-test OK — 34 rule(s) verified.` beside `self-test code=0` — one id more than the four `-3` … `-6` logs
above, and the extra one is `operator-rpc-referenced-outside-cli` — while `product:check code=0` still scans
**262** active files with 0 violations at that tree, so the new rule fires on nothing in the shipped tree. Both
halves of that pair hold at the head this section now describes, and the file half holds by moving: `product:check`
exits 0 on **263** files with 0 violations, `--self-test` exits 0 on the same **34** rules and `dbtypes:check`
exits 0 on **37** migrations, **20 public + 21 non-client** tables and **45** reconciled column groups
(`q11-logs/s11-race-static-gates-1.txt`, each exit read from the line beside it). The **262** to **263** step is
the single tracked file the scanned-set paragraph above names, measured in `q11-logs/s11-doc-scan-delta-1.txt`,
and nothing else in that trio moved. That the rule fires on nothing is
measured rather than assumed: `OD-45` writes each of the sixteen operator door names into a file under `src/`
and shows the rule lighting on all sixteen, then shows the same sixteen silent in the CLI itself and in the
generated `src/integrations/supabase/types.ts`, with `isScannedPath` proving one of those two paths is outside
the scanned tree and the other inside it — which is what makes the second silence a decision about a generated
catalogue instead of a hole in the scanner. §11's own battery stands at forty cells with `vitest_exit=0`
(`q11-logs/s11-final-cli-battery.txt`; `q11-logs/od-group6-run2.txt` prints the same `Tests 40 passed (40)`
line but no adjacent exit code, so the forty is cited from the capture that carries one), and its before-half
is `q11-logs/od-group6-run.txt`: `1 failed | 39 passed
(40)`, because `OD-51` had demanded that two of the tool's sentences appear as contiguous substrings of source
literals the tool itself writes across a line break. The cell now pins the six fragments exactly as the source
spells them and keeps the joined runtime sentences as their own `toBe` assertions, so what moved was the guard's
reading of the bytes, not the promise those bytes make.

Two refusals were the sweep's own, and both were the instrument being stale rather than the schema being
wrong — `q11-logs/s11-regress-1.txt` printed `N04b` refusing a revocation Stage 11 made on purpose, and
`q11-logs/s11-regress-2.txt` printed `G2` with `got [41] want [39]`. After the six cells above moved,
`bash supabase/tests/stage11/run.sh regress` finished `sweep_exit=0` on the four older pairs at the
slice-1 head: Stage 10's ledger 380 and functions 293, Stage 9's 134 and 94, Stage 8's 182 and 185,
Stage 7's family review 255 and review boundary 116 (`q11-logs/s11-regress-3.txt`), alongside Stage 2–6's
24 suites at `sweep_exit=0` in `q11-logs/s11-historic-5.txt` and Stage 11's own 134 in
`q11-logs/s11-authority-3.txt`. Every one of those is a `sweep_exit=` line read out of the log it belongs
to. The slice-3 head repeats the measurement rather than inheriting it: the runs and totals are the block
above, each read from its own log, and the 134 is not carried forward as a current figure.

Two historical instruments caught this stage, and in both cases the instrument was working rather than
drifting. `scripts/domain-contract.test.mjs:69` pins the `private` table inventory name by name, and the head
this pass opened held eight names while the committed Stage 11 migrations create thirteen, so `npm test` was
red before a byte of prose moved here: `2 failed | 1413 passed (1415)` at `vitest_exit=1`
(`q11-logs/s11-final-npm-test.txt`, the second failure being the checker's own fixture cell below). The two
cells that walk that same set at the *column* level passed over the five new tables untouched — no retired
scaffold name appears in any of them, and none holds an amount outside the ledger — which is what makes this
widening an inventory move rather than a rule move, and the repair is the five names with their reason written
beside them. The second finding is this section's own rule: the cell at `scripts/product-contract.test.mjs:22`
builds one synthetic file and asserts every rule id the checker carries fires somewhere in it, and
`operator-rpc-referenced-outside-cli` had no shape in that file, so the guard §13's tool row rests on could
not fire in the one battery whose job is to prove the rules can. The repair is a `get_operator_case` call in
the fixture, not a relaxed assertion, and both files re-taken green print `28 passed (28)` at `vitest_exit=0`
(`q11-logs/s11-final-two-repaired-cells.txt`). Neither move changes what Stage 11 refuses to build; both are
why the two readiness rows for these checkers now carry the repair in their own words rather than leaving it
in a commit message nobody reads with the row.

## 16. Migration slices

Forward-only, monotone after `20261020180000_stage10_nested_revocation.sql`, one concern per file so a
refusal can be bisected to a slice: `…190000_stage11_operator_authority.sql` (§3 + §4),
`…190100_stage11_support_cases.sql`, `…190200_stage11_closed_is_terminal.sql` (the slice-2 closure
repair, added after the battery proved the release door and the row wall both admitted a write to a
finished ticket), `…190300_stage11_privacy_intake.sql`,
`…190400_stage11_takedown_and_oversight.sql`, `…190500_stage11_operations_health.sql`, each followed by
its catalogue branch edit in the same commit, and each applied to this repository's own local stack by
`npx supabase db push --local --skip-vault` **after** a `--dry-run` shows exactly the expected pending
files — the sequence Stage 10 recorded for the publish-gate repair. No `supabase db push` without
`--local`, no reset of the shared database, no shadow of another project's stack. Through slice 5 the
migrations are qualified on native PostgreSQL 17 chains built by the runner, slice 5's own file included:
`q11-logs/s11-s5-chain-43.txt` prints the census the chain reaches once `…190500_…` has been applied
(`API=41`, `INTERNAL=61`, `PRIVATE_F=52`, `PRIVATE_T=13`), which is the migration being exercised rather than
being assumed. That last clause was true when this section was written, and it is now superseded by
measurement rather than restated: on 2026-10-25 the six files named above went to the shared
`localvivaahvarnam` stack through `npx supabase db push --local --skip-vault --yes` at head
`4ea2a9787d9105b128d0af822aeb26f35115b141`, exit 0, after a `--dry-run` had named exactly those six and
nothing else (`q11-logs/s11-q1-dryrun.txt`), and `q11-logs/s11-q2-applied-fingerprint.txt` prints the
pair the apply moved — `private` tables 8→13, `api` functions 22→41, `internal_api` functions 39→61, the
twelve `api.operator_*` doors plus `get_operator_case` present where none of them were, this stage's five
private stores 0→5, `supabase_migrations.schema_migrations` rows 31→37 — while `private.audit_events` held
at 27→27, because applying a migration writes no audit row. So the apply this section once recorded as
outstanding is done, and what remains of the old caveat is the wire: of the HTTP battery, authority group
`A` (A-01 … A-07 — 7 tests, 7 pass, 0 fail, `q11-logs/s11-http-stage11-a5.txt`) and support group `C`
(C-01 … C-09 — 9 tests, 9 pass, 0 fail, with `node_test_exit=0` recorded beside it,
`q11-logs/s11-http-c3.txt`) have run on that stack; takedown `T`, health `H`, privacy `V`, refund-oversight
`R` and audit-integrity `AI` had not — twenty-two of the suite's thirty-eight declared cells — and the
browser tier had not. The HTTP half of that sentence is now closed by measurement rather than by this section's
permission: `q11-logs/s11-runtime-2-stage11-http-5.txt` runs the whole file against that same stack in one pass —
`node_test_exit=0` at 248 s, `tests 38 / suites 7 / pass 38 / fail 0`, each family at zero failures (A 7, C 9,
T 5, R 5, V 4, AI 3, H 5), `declared_test_calls|38`, `declared_unique_ids|38` and `run_unique_ids|38` with
`declared_not_run` and `run_not_declared` both printed empty, and the harness's outer census identical across all
30 store names before and after, `stage11_audit_rows=0` among them. So the scope §13 and §15 bounded at twenty-two
outstanding cells is spent, and what the wire still lacks is narrower than a count: the runner's own chain with
Stage 11's file inside it, the two-operator collision through PostgREST rather than through a host cluster, an
operator grant or revoke and a console purge *executed* rather than dry-run or refused, and any browser tier —
which has no subject, because nothing in `src/` names an operator verb. §15 is where the limit of the green
capture is written: it stamps a head whose tracked file does not yet hold the repair it ran. The concurrency tier is a third list, and it has closed on its own terms: fifteen files in
`supabase/tests/stage11/race/` declare `RC00`–`RC16` and `RD00`–`RD07`, and `run.sh`'s `race` mode builds the
throwaway `st11qual_race` chain for them and drops it at the end — and that mode **has run twice**, green in both
(`q11-logs/s11-race-run-6.txt`, then `q11-logs/s11-race-run-7.txt` at the pushed head
`9bd83ca0f177fc0430854a618b413085dad500af`, `race_runner_exit=0` and 34 counted cells in each), with all sixteen
files the run reads — `run.sh` and the fifteen tier files — sha256-matched to the bytes that executed
(`q11-logs/s11-race-commit-bytes-check-1.txt`, 16 `MATCH` lines)
and the chain gone again by the runner's own teardown (`databases_after=postgres,template1,template0,s11dbg`).
One sentence of this section was wrong about *how* it could be run, and the repair is the point: the tier never
needed the Supabase container engine. It speaks Postgres, and a loopback host postmaster on `127.0.0.1:55442`
at `server_version=17.10`, started by this task for this tier alone, is sufficient — so its result was never
gated on the human-only Docker start that still gates the HTTP and browser tiers, and claiming it was would have
deferred a measurable thing behind an unmeasurable one. What the two runs do **not** reach is the wire: no
PostgREST, no JWT, no Storage API and no row of any real wedding — every identifier in the tier lives under the
`0b0b0b00-…` synthetic prefix, and nothing in either log touched a customer. §13 carries the remaining absences
case by case, and no cell in this document turns a migration on the stack into a capability proven over it.

## 17. Decisions that stay the owner's

1. **Who may ever be an operator, and with what password policy** — the account lives in GoTrue; the
   grant is a human act through §11's trusted path. Nothing in this stage can answer it.
2. **Whether a takedown may purge objects without the owner's separate consent**, and under which reason
   codes — §6 makes purge possible and separate precisely so this can be decided rather than discovered.
3. **Refund/chargeback policy** — carried unchanged from [`commerce-foundations.md`](commerce-foundations.md) §15
   and [`../audits/stage-10-commerce-foundations.md`](../audits/stage-10-commerce-foundations.md) §18,
   with the review queue in front
   of it and the defaults untouched.
4. **The retention and erasure model, including identity verification** — Stage 13. §8 is intake.
5. **Whether host-facing support intake gets a UI** — deliberately not built here (§14), so the product
   answer to "how does a couple reach us" is still the owner's, and the readiness matrix says intake is
   API-and-CLI only.
6. **Where operational telemetry comes from** — auth failures, throttling and abuse need a store and a
   server (§2, §9). Deciding that is a hosting decision, not a migration.

Reporting any one of these as decided would be the kind of claim Stage 0 was written to remove.
