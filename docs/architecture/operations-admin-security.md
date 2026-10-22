# Stage 11 — Operations, support and incident administration: authority model and threat model

**Status: design and threat model, and the contract the Stage 11 migrations are written against — with
slices 1–4 now exercised.** The four batteries have run, on the runner's own chains, against a real
PostgreSQL 17, and §13's `M:` columns cite those logs; what has **not** run is the HTTP, browser and race
tiers, because they need the shared `localvivaahvarnam` stack and starting Docker is a human-only action. So
"every capability here is labelled **designed** until a battery measures it" still governs this document —
a battery has measured a great deal of it, and no line here claims the wire tier on that strength. Every
count is read out of a live database or out of a file at a named SHA, and each §15 block says which head it
belongs to. It authorises no operator, no refund, no erasure, no takedown of a real customer's invitation
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
36 migration files — measured on the runner's throwaway PostgreSQL chains, not on this stack, which has not
been pushed since slice 1 (§16) — and that is what §10 and §15's last block carry.

| Fact | Measured value | Consequence for Stage 11 |
| --- | --- | --- |
| Operator/admin authority that anything reads | **none.** `public.user_roles` holds 6 rows with `CHECK (role IN ('admin','user'))` (`20260925120500_stage2_rls_and_grants.sql:383-387`), RLS `owners_read_own_roles` (`:377`), and `public.has_role` was dropped in Stage 2 (`20260925120800_stage2_relocate_security_helpers.sql:63`). No product code, migration body or policy reads the vocabulary. | Stage 11 must create authority, not discover it. It is created migration-backed, with zero seeded rows (§3). |
| `public.app_role` enum | `('admin','user','planner')` (`20260222071941_b09d0299-796f-4d80-9f5a-e919fa705ffe.sql:3`) | Left untouched. Widening a shared enum to carry an operational role would make `user_roles` a second, weaker authority system (§3). |
| REST-addressable schemas | `supabase/config.toml:32` exposes exactly `public` and `api`. | Every Stage 11 table is created in `private`; every callable is an `api` wrapper delegating to an `internal_api` body, the layout Stage 3 fixed. |
| Callable surface today | **22** `api` functions (5 also `anon`-callable: `resolve_public_invitation`, `resolve_guest_invitation`, `resolve_family_review`, `submit_guest_rsvp`, `submit_family_review`), all `prosecdef = f`, all `sql`; `service_role` holds EXECUTE on none of them. 39 `internal_api` functions, all definer/plpgsql; 37 functions in `private`. | The anonymous door count stays 5. Stage 11 adds authenticated-only wrappers, and `API33`/`API34` (`supabase/tests/api/stage3_publication.test.mjs:1225`, `:1434`) are extended, not relaxed. |
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
its own newest-row timestamp so "current" is a fact rather than an assumption:

| Block | Source it reads | Meaning |
| --- | --- | --- |
| `migrations` | `supabase_migrations.schema_migrations` | applied count and highest version. The comparison against the files under `supabase/migrations/` is the CLI's job, because a file listing is not a database fact: that directory holds 36 files at this head — 31 at §2's baseline plus this stage's five — which is exactly
why the tool reads it instead of carrying a number, and why it prints both figures or says it could not read
one. |
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
measures the whole shape instead: `internal_api` holds 60 names of which 41 are `prosecdef = t` and 19 are
not, `private` holds 52 of which 5 are definers, and `api` holds 40 of which none are. Of the 23 names this
stage wrote, **21 are definers** — the 19 paired bodies plus slice 4's unexposed purge, and in `private`
both `actor_is_operator` and `operator_authorising_case`; the other 2 are the grant pair, which follows the
Stage 10 precedent for the reason §3 gives. A paired body has to be a definer for the same forced reason
the predicate did — it reads `private.operator_grants` and the queue tables on behalf of a caller that
holds no grant on any of them, so an INVOKER body would raise `permission denied` instead of answering the
question the door asks — and §3's ruling for the grant pair is that reachability must stay a property of
the *role*, which is exactly what a body with no reachable surface does not need.
`q11-logs/s11-s4-doc-probe4-1.txt` sections S1–S3 is the per-name reading behind every figure here, and the
same probe's S6 is the assertion §13's erasure row leans on: none of the seven privileged bodies this stage
wrote contains a `DELETE FROM` clause.

| Wrapper | Callable by | Authorisation inside the body |
| --- | --- | --- |
| `api.open_support_case(p_wedding_id, p_category, p_severity, p_summary, p_idempotency_key)` | `authenticated` | owner of that wedding, re-derived from `auth.uid()`; bounded inputs |
| `api.get_my_support_cases(p_status text, p_limit integer)` / `api.get_my_support_case(p_case_ref text)` | `authenticated` | rows whose `requester_user_id = auth.uid()`; host-facing projection only (§5) |
| `api.reply_to_support_case(p_case_ref, p_body, p_idempotency_key)` | `authenticated` | requester of that case, `message_host` arm only |
| `api.create_privacy_request(p_wedding_id, p_kind, p_note)` / `api.get_my_privacy_requests()` | `authenticated` | owner, requester is `auth.uid()` |
| `api.operator_case_queue(p_status, p_scope, p_limit)` / `api.get_operator_case(p_case_ref)` | `authenticated` | `actor_is_operator(auth.uid(),'support')`; operator projection including internal notes |
| `api.operator_claim_case(p_case_ref, p_idempotency_key)` / `api.operator_release_case(p_case_ref, p_idempotency_key)` | `authenticated` | `support`; the holder is `auth.uid()`, never an argument. The design's `operator_assign_case` was refused by `C29c` — no callable may name a person in its signature since Stage 2 — so the shipped pair claims and releases the *calling* operator |
| `api.operator_transition_case(p_case_ref, p_to_status, p_resolution_code, p_body, p_idempotency_key)` | `authenticated` | `support`, edge table in a trigger |
| `api.operator_takedown_plan(p_wedding_id)` | `authenticated` | `operations`; read-only, returns the key list §6 step 2 would need |
| `api.operator_takedown_publication(p_wedding_id, p_case_ref, p_reason, p_idempotency_key)` | `authenticated` | `operations` + case + reason vocabulary |
| `api.operator_commerce_review_queue(p_status, p_limit)` / `api.operator_add_commerce_review_note(p_refund_id, p_case_ref, p_kind, p_note, p_idempotency_key)` | `authenticated` | `finance_review` + case; insert-only note |
| `api.operator_privacy_queue(p_status)` / `api.operator_advance_privacy_request(p_request_ref, p_status, p_note, p_idempotency_key)` | `authenticated` | `privacy` + edge table; the advance's replay anchor is the audit row's key, while the host's create door has no key and answers a live duplicate with `replayed = true` (§8) |
| `api.operator_operations_summary(p_window_hours)` | `authenticated` | `operations`, STABLE |
| — not a wrapper — `internal_api.operator_purge_publication_objects`, `internal_api.grant_operator_role`, `internal_api.revoke_operator_role` | **no role at all**: zero EXECUTE grants; reached only by the trusted `postgres` path | see §3 and §11 |

Slices 1–4 have shipped, so this table is now partly measured rather than wholly planned: at this head
`api` holds 40 names, `internal_api` 60 and `private` 52 functions, and the grant pair, the ten support
doors, the four privacy doors and slice 4's four operator doors — plus that slice's one body with no door
in front of it — are the names the batteries exercise. Only the health row is still slice 5's design:
`api.operator_operations_summary` has no name at this head, and §13 keeps that arm under `p:` rather than
implying a run. The privacy row is also where the design was amended by measurement: the *advance* door
takes the key and the create door does not, because the host's duplicate anchor is the live row itself (§8).
The other amendment is in the same column of this table: `api.operator_takedown_plan` is `operations` + a
read-only projection, and its body returns the key list §6 step 2 would need without touching a byte —
which is why slice 4's fourth refusal cell measures it as a *plan* that a revoked publication can still be
handed to, rather than as a half of the irreversible act (§6).

**No `api` function is granted to `anon`**, so the anonymous door set stays the five §2 measured — which
this head re-measures rather than inherits, because `C28a` deliberately took no stage11 branch and the
catalogue still passed 106 assertions against a schema that contains slice 4
(`q11-logs/s11-s4-historic-1603.txt`). `API33`/`API34`, `C28a`/`C28b` and the Stage 3/7/8 HTTP refusals are
therefore re-run rather than re-explained. The purge body is deliberately *not* exposed. §6 measures it as
the plan in front of the irreversible half, so what the ruling in this section buys is that neither the
plan nor the objects it names can be reached by a request at all: EXECUTE on
`internal_api.operator_purge_publication_objects` is false for `anon`, `authenticated` and `service_role`
(`q11-logs/s11-s4-purge-probe-1.txt`), the `delete` verb lives in the trusted publisher rather than in this
body, and the CLI reaches the plan as `postgres` over the peer-authenticated channel the repository's other
maintenance tools already use.

## 11. The trusted operations tool

`scripts/stage11-operations-cli.mjs`, import-safe and unit-tested like the other three drivers, with
`--secret-env` for the operator account's password, strict argv, a banned-flag list (no `--service-key`,
no `--token`, no `--price`, no `--sql`, no `--url`, no `--email`), `assertSecretFree` on every line it
prints and on its own run record, and a redactor in front of the rest.

Two channels, and the split is the security design:

- **Acting as an operator:** the CLI authenticates to GoTrue with the operator account's own
  email/password over loopback and calls the `api.operator_*` wrappers with that access token. This is
  why the same batteries that grant a hostile caller nothing also grant the CLI nothing — the tool's
  authority is the database's decision, read from `private.operator_grants`, and the unit tier drives
  the *identical* RPCs with a non-operator token and asserts the refusal. No service-role key is present
  in this path, in its environment, in a log, or in a captured artifact.
- **Granting authority, and the purge:** peer-authenticated in-container `psql` as `postgres`, the
  `tradition-pack-admin.mjs` channel (`stage10-commerce-driver.mjs:423` names the reason: no password,
  no key). Granting cannot depend on already having a grant, and the purge has no HTTP surface by §10's
  choice. Both plan first and require `--yes`; `--dry-run` is the default for every mutating verb, and
  `grant`/`revoke` print the exact statement they will run.

Every mutating verb takes a case ref where §5 requires one, generates an idempotency key unless given
one, and prints the returned audit id so a run is answerable afterwards. Exit codes follow the existing
convention: 0 success, 2 refusal that is the designed answer (a denial, a held state), 1 instrument or
transport failure.

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
`92_takedown_and_oversight.sql`, and the planned `95_operations_health.sql`), the race tier prefixed
`RC*`/`RD*` for
the same reason Stage 10 gave, HTTP dashed (`A-*` authority, `C-*` cases, `T-*` takedown, `R-*` refund
oversight, `V-*` privacy, `H-*` health), and audit-integrity cells `AI-*`. **A citation that no run log
carries is a claim, not evidence**, so this table is written before the code and re-read after the
batteries, and any row whose arm did not run says so in the Stage 11 audit rather than here.

Slices 1–4 have now run, so the third column is split rather than rewritten: `M:` ids are in the log of
the battery that owns them. At this head `q11-logs/s11-s4-authority-1619.txt` reports the four batteries on
one chain — `80_operator_authority.sql` 137, `85_support_lifecycle.sql` 641, `90_privacy_intake.sql` 191 and
`92_takedown_and_oversight.sql` 208, each with the same number of `NOTICE:  PASS` lines as its reported
total — and the slice-3 logs beside the numbers below (`s11-s3-st11qual_authority3-80_operator_authority.txt`,
`s11-s3-authority3-85_support_lifecycle-2.txt`, `s11-s3-authority3-90_privacy_intake-2.txt`) are kept
because those are the runs in which each cell first went green. A battery's number is re-measured at each
head, not inherited: the 137, 641 and 191 are the same figures at both heads because slice 4 moved
*figures* inside those files rather than adding cells — `85_support_lifecycle.sql`'s own census cells S09,
S10 and S10b now read 40 / 60 / 52, where the slice-3 log records the same three cells reading 36 / 55 / 48
— and `p:` ids are still plans. The families `80_operator_authority.sql` actually measures are
`A01-A26b` (the state the migrations ship, then every privilege refusal role by role), `R01-R17` (the
shape of what the two bodies refuse to write), `W01-W15b` (the success path, grant and revocation),
`T01-T11c` (`actor_is_operator`'s truth table), `K01-K09b` (the grant row's own CHECKs and its partial
unique index, reachable only by a hand plant), `AI01-AI24` (the trail) and `Z02-Z07b` (the census; `Z01`
prints the CENSUS line rather than a PASS, which is why the two numbers agree rather than differ).
`85_support_lifecycle.sql` measures the support lifecycle through its own `s11b` helpers and
`90_privacy_intake.sql` the privacy intake through `s11q`. `92_takedown_and_oversight.sql` runs through
`s11t` and in eight groups, each of which owns a letter: `T01-T29` (what the migration ships, before this
file writes a row — columns, CHECKs, the four FK delete rules, the five triggers, the RLS-with-no-policy
posture, the zero client grants, and the three schema censuses T14/T15/T16), `P01-P12` (the plant it built,
and the digests every later group re-reads), `K01-K51` (the plan door, the takedown's effect set, its
credential and artefact half, its replay anchor and the second wedding it must not touch), `U01-U27` (the
purge planner: its zero-grant exposure, the four preconditions, and the wall that refuses it a browser),
`Q01-Q22c` (the refund queue as a read that cannot become a verb), `N01-N30` (the note door, its derived
`order_id`, its replay and its thread), `O01-O16` (the walls around the note and what survives its author)
and `Z01-Z14` (the census read both ways — and unlike slice 1's `Z01`, this file's is a measured cell, so
its 208 is 208 PASS lines with no CENSUS line excluded). A slice-1 id in the table below is read from
`80_operator_authority.sql` by long-standing convention; a cell from any later battery names its file
beside the id, because the letter vocabularies overlap — which slice 4 proves rather than illustrates, since
`T` is slice 1's predicate family, slice 2's shape group and slice 4's own, and `Q` is slice 2's queue and
slice 4's queue.

Four consequences of measuring rather than planning, all recorded here because a later slice would
otherwise inherit them silently. First, the letter `R` was allocated in this section to refund oversight
and `T` to takedown before either battery existed, and slice 1 needed both letters for grant validation
and the predicate — so the rule was that later batteries take letters the first battery does not own
(`A`, `R`, `W`, `T`, `K`, `AI` and `Z`). Slice 2, slice 3 and slice 4 then reused letters anyway, because
batteries written a slice apart converge on the alphabet; the rule is withdrawn and the convention that
replaces it is that a citation names the battery file beside the cell id. The collision is now measured
rather than conceded: of the twenty-one letters the four batteries use, twelve are shared — `A` and `R` in
batteries 1–3, `G`, `S`, `V` and `X` in 2 and 3, `K` in 1 and 4, `O` in 2 and 4, `P` in 2–4, `Q` in 3 and 4,
`T` in 1, 2 and 4, and `Z` in all four — and nine belong to exactly one file: `AI` and `W` to slice 1, `C`
and `L` to slice 2, `D`, `H` and `M` to slice 3, `N` and `U` to slice 4.
`q11-logs/s11-s4-letter-collision-1.txt` is the census, taken from the four battery files' own first
arguments. Second, the
file's own number moved: this section planned `90_takedown_and_oversight.sql`, and `90_` was already taken
by slice 3's privacy battery, which the same `authority` chain runs before this one and in the same glob
(`supabase/tests/stage11/run.sh:247-251` now records the arrival — `85_`, `90_` and `92_` — and leaves only
slice 5's `95_` as a plan). A fourth battery therefore had to arrive
between `90_` and the still-unwritten `95_`, and the order is load-bearing rather than cosmetic — group P
inherits tickets, threads, grants and trail rows from batteries 1–3 on that one chain, which is exactly why
P10, P11 and Z10 count the plant's own five case ids instead of `private.support_cases`, and why the money
and artefact absolutes in O15 *can* be cluster-wide: no battery before this one writes a refund. Third, one
planned control turned out to be partly false and the measurement is what found it: the audit-rewrite row
below carries `AI11` as the *limit* of the control rather than as a pass, and both `40_catalog.sql`'s
`C15` and Stage 10's `N04b` had to be re-measured because this stage **removes** a privilege rather than
adding one — a direction neither instrument was written to see, and §15 and §17 record both repairs.
Fourth, the cell count is not the assertion: `90_privacy_intake.sql`'s 191 includes `M21`–`M22`, whose
twenty probes all roll back, so a green total is only meaningful beside the census `Z01`–`Z12` that reads
the surviving state back.

| Threat | Control | Cases |
| --- | --- | --- |
| Anonymous caller reaches any operational surface | `private` not in `config.toml:32`; zero `anon` EXECUTE on every new wrapper | `M:` `A09`, `A10` (the grant table refused at the schema layer, before any object check runs), `A17` (the predicate unreachable), `A20`, `A23` (both bodies unreachable). Slice 4 opens four more doors and closes all of them at the same layer: `92_takedown_and_oversight.sql` `K01` (anon cannot even reach the plan), `Q01` (nor the refund queue), `N01` (nor the note door) and `U01`-`U05` (the purge holds EXECUTE for nobody — `U02` refuses the very operator whose grant was revoked, `U03`/`U03b` stop the service role one wall earlier than the client roles, `U04` measures that there is no `api` wrapper to route around, `U05` reads the access list itself). The cluster-wide half is `40_catalog.sql` `C28a`, re-run at this head against a schema containing slice 4 (`q11-logs/s11-s4-historic-1603.txt`). `p:` HTTP `A-01`, `H-05`, `API33`/`API34` |
| A signed-in host operates on someone else's wedding | ownership re-derived from `auth.uid()` in every body; one shared SQLSTATE and sentence for "not yours"/"not there" | `M:` no slice-1 cell exists for this row, because the grant table is account-scoped and no wedding is involved — and the row is kept rather than dropped so the reader can see which arm is still only a claim. The adjacent measured refusals are `A11`, `A12`, `A21`, `A24`. `85_support_lifecycle.sql` `X00`–`X32` and `90_privacy_intake.sql` `X01`–`X06` are the case and privacy halves: a foreign wedding and an invented one answer identically, a host citing somebody else's request is refused, and the other kind on the host's own wedding is allowed because ownership, not the queue, is the scope. `92_takedown_and_oversight.sql` measures the same refusal on the four doors slice 4 opens: `K02` (a wedding's own host, authenticated and holding no grant, is refused the plan) and `K03` (the hostile caller gets that same sentence, not a different one), `Q02`/`Q03` (a host cannot see the refund ledger it is standing in, nor can a stranger, in one sentence), `N02` (the refund's own host is refused a note) and `N06` (another wedding's ticket cannot carry a note about this wedding's refund). The scope half is measured too: `K20` refuses another wedding's ticket cited against this wedding, `K35`/`Z14` prove no credential outside the two weddings this file takes down was revoked, and `K47`/`K48` keep one operator's act on the wedding it cited. `p:` HTTP `C-04`, `T-03`, `V-03` |
| A signed-in host operates on **their own** wedding without operator status | `actor_is_operator` before any scope work; the table has no client grant to write | `M:` `A18` (the host is refused before the predicate is entered), `80_operator_authority.sql`'s `T01`-`T05`, `T07`, `T08` (no session, an account holding nothing, a uuid that is no account, an unknown duty word, a NULL, and the scopes never granted — all answer false rather than raising), `T10` (the human who minted every grant holds nothing themselves), `T11` (a live row past its expiry answers false). Slice 4 reaches the same owner from four directions and refuses all four: `92_takedown_and_oversight.sql` `K02` (the wedding's own host, authenticated, holding no grant, cannot even plan a takedown), `Q02` (cannot read the refund queue), `N02` (cannot annotate its own refund) and `N04`-`N08` (a refund id that names no row, a guessed ticket ref, another wedding's ticket, a parked and a resolved case all answer in the same sentence, so the door cannot be used to probe what exists). `p:` HTTP `A-02`, `A-03`, `T-01` |
| Self-granting operator scope | no surface at all: zero EXECUTE on `internal_api.grant_operator_role` for every role, RLS with no policy, `reject_client_write`; reachable only from `postgres` | `M:` `A02`, `A02b` (RLS enabled with zero policies, which is the pair that makes the posture mean something), `A03` (no DML for any role a request can arrive as, server key included), `A05`, `A05b` (`internal_api` only, no `api` twin), `A20`-`A25` and `AI02` (both bodies, three roles, then the whole matrix), `A26`, `A26b` (and the count is still zero), `80_operator_authority.sql`'s `K01`-`K09b` (eight hand plants refused) and `Z03`, `Z04`. Slice 4 adds the doors a self-granted scope would need: `92_takedown_and_oversight.sql` `U01`-`U05` (the purge is executed by nobody — not anon, not the operator whose grant was revoked, not the service role, and there is no `api` wrapper to route around, because its access list grants EXECUTE to nobody but the owner), `T11` (twelve of twelve role/verb pairs on the oversight table are false), `O01`-`O04` (a client role cannot insert, edit or delete a note and neither can the table's owner, whose hand is refused by the append-only trigger rather than a privilege), and `K04`/`K05` (a live grant in the wrong scope and a revoked `operations` grant are refused in the same sentence as no grant at all). `p:` HTTP `A-04`, `A-05`, unit `OD-12` |
| Forgery of the actor in an audit row | §4's split, not one rule: no client-reachable callable takes an actor id, while the three service-only bodies this stage wrote do take `p_actor_user_id` — the grant pair and slice 4's purge planner — protected by the role that is the only one able to reach them, by a refusal of any decider that names no account, and by `40_catalog.sql` C29c-b holding the whole identity-taking set closed at nine names (six commerce, two operator-grant, one purge) with EXECUTE false for every browser role on each | `M:` `80_operator_authority.sql` `R05`, `R06`, `R12` (beneficiary and decider both checked against `auth.users`, on each side), `W04`, `W04b` (the audit actor and the grant's subject are different columns, and the kind is `maintenance`), `AI15`-`AI18`, `AI22`; slice 4's half is `92_takedown_and_oversight.sql` `U06`/`U07` (the purge refuses a NULL actor and an id that names no account *separately*, because the second is a forged attribution and the first is merely an anonymous one), `U08`-`U10` (a wrong-scope grant, a revoked grant and a finance reviewer all fail to name an actor), `U16` (the trail row takes its decider from the argument, since this channel has no session to read) and `O07` (a note that names no author cannot be inserted at all). `p:` HTTP `AI-1`, `C-09` |
| Audit rewritten or deleted after the fact | `reject_audit_update_except_referential_null` on `private.audit_events` refuses every rewrite by every role including its own owner, with one measured hole: an attribution link going to NULL from inside the database's own referential trigger at depth 2. UPDATE and DELETE are both revoked from `service_role` | `M:` `A08`-`A08c`, `AI01`-`AI10` (six refused mutations, then the whole trail digests identically and the row they aimed at re-reads byte-identical), `AI12b`; `85_support_lifecycle.sql` T51 (a hand nulling `actor_user_id` at depth 1 is refused) and T-RI2f/T-RI2g (the erase of the named account nulls the link, moves no other byte, and deletes no row). **`AI11`/`AI11b` is the limit of the control, measured rather than glossed**: `service_role` keeps INSERT — it must, or 29 existing audit-writing sites stop working — so the cell requires a forged append to *succeed*, and the owner's DELETE is `AI12`; the revocation itself is re-read at this head from `pg_proc`-adjacent ACLs in `q11-logs/s11-s4-doc-probe-1.txt` section G (`service_role`: UPDATE false, DELETE false, INSERT true). Slice 4 holds the same line from the other side: `92_takedown_and_oversight.sql` `K38`/`K39` (one trail row per act, in the shape §4 requires, with a before/after pair that is a single-field object), `K46` (a refusal leaves no trail row behind), `U23` (the two append-only stores grow by exactly one row each for an accepted act and no more), `N19` (the note's before/after pair is the *same* value, which is what "the refund kept its history" means) and the group `Z03`-`Z06` census, which reads the ledger and the trail against each other both ways and shows the four replays in this file wrote no trail row at all. `p:` HTTP `AI-2`, `AI-3` |
| Duplicate or replayed operator action | `audit_events.idempotency_key` unique; each body pre-reads the key and returns the recorded answer; second delivery acts on nothing; the privacy create door's anchor is the live row itself, because it takes no key | `M:` `AI13` (a second delivery of one key collides with the partial unique index), `AI14` (two keyless rows still coexist, which is the other half), `AI21` (an over-long key is refused with its own bound), `W08`, `W08b`, `W14`, `W14b` (a duplicate grant and a double revocation each refuse without writing), `85_support_lifecycle.sql` `R` group (the case queue's replay), `90_privacy_intake.sql` `H01`–`H03b` (a live duplicate answers `replayed = true` and writes no row) and `R01`–`R10b` (one key, one audit row; the replay reads the recorded answer and moves neither the request nor the trail). `92_takedown_and_oversight.sql` measures the replay on each of its three doors and on the key as one namespace: `K26` (a takedown with no key is refused — two clicks on one wedding must take it down once), `K42`/`K43`/`K44` (the same key is answered again with the *first* delivery's payload, reason and audit id, and writes nothing — one trail row, one event row, and nothing else moved), `K45`/`K46` (a fresh key on an already-down wedding is refused by the state rather than the key and leaves no trail row), `U11` + `U21`/`U22` (the purge planner requires its own key, re-plans under it with a current key list, and grows neither store), `N12` + `N21`/`N22` (a note with no key is refused; one key is one note), and `N27`-`N29`, the half the naive design misses — a key already spent on another refund, another body or another act is *refused* rather than answered with somebody else's recorded result, and the collision is symmetric across the three bodies. `Z06` closes the row: the four replays this file ran wrote no trail row at all. `p:` HTTP `C-07`, `T-05`, race `RD00`-`RD07` — **the race tier is where the concurrency claim lives and it has not run, so this row does not yet carry one** |
| Race: two operators take the same wedding down at once | one active publication per wedding, `FOR UPDATE` on the publication row, the state machine's terminal `revoked`, one idempotency namespace | `M:` the serial half only, because slice 1 has no publication surface to race and slice 4's battery is one session — so what it can prove is the state machine, not the second session: `92_takedown_and_oversight.sql` `K26` (no key ⇒ refused, so two clicks cannot be two acts), `K42`-`K44` (a second delivery of one key answers the first payload and moves nothing), `K45`/`K46` (the state is the second lock: a new key on a wedding already down is refused by the publication's own state, not by the key, and writes no trail row), `U25` (one idempotency key cannot be spent on two weddings) and `Z11` (the file retires exactly the two publications it claims and no third). `p:` race tier `RC00`-`RC09` (two live sessions), asserted once both committed — **two operators committing at once is still unmeasured, and no cell in this row claims it** |
| Race: an action against a grant revoked mid-flight | `actor_is_operator` re-read inside the same transaction that acts, after `SELECT … FOR UPDATE` on the grant row | `M:` slice 1 measures the serial halves (`80_operator_authority.sql` `T11`, `W12`, `W12b`) and cannot see a second session at all; slice 4 measures its own three, where a revoked grant is the mid-flight event it can actually stage: `92_takedown_and_oversight.sql` `K05` (a revoked `operations` grant is refused the same sentence as no grant at all), `U02` (the very operator who held the live grant cannot execute the purge once it is gone), `U09`/`U10` (a revoked grant and a money-only scope both fail to name an actor for the planner) and `U26` (five refusals of this body leave the grant table byte-identical — reading authority cannot spend it). `p:` race tier `RC10`-`RC16` |
| Stale tab transitions a case twice | trigger-compared OLD/NEW edge table, per-case `seq`, and `SELECT … FOR UPDATE` on the case inside every mutating body. The design's `p_expected_status` argument did not ship: `operator_transition_case` takes no status it expects, so the serialisation is the row lock plus the edge table rather than an optimistic check | `M:` `85_support_lifecycle.sql` T06, T12, T30–T40 (the edge machine's own refusals). `p:` HTTP `C-05`, `C-06`, and the race tier — a second tab is a second session, and no two-session SQL or HTTP case exists yet |
| Takedown claimed to kill a file link it does not kill | §6's split; purge is a separate, unexposed, twice-confirmed act; the answer text names its own limit | `M:` `92_takedown_and_oversight.sql` — read with the battery file beside its letters, because `T` is also slice 1's predicate family — `K30` (the answer reports the two credentials and the two artefacts it *reached*, not the three credentials and six artefacts on the wedding, which is the difference between a count of the effect and a count of the rows), `K31` (`file_links_still_valid_until_object_purge` is a field of the answer, so the door states its own limit instead of letting the operator infer it), `K37` (the objects those artefacts name are still in the bucket: five before the takedown, five after), `K49` (nothing was deleted by any of the file's acts), `U13`/`U17` (the planner's twelve fields include `delete_channel` and `objects_deleted_by_this_call`, so a plan is never mistaken for an erasure) and `U18`/`U19` + `Z08` (the bucket is counted before and after the plan and never changes size across the whole file). The absence is structural as well as counted: `q11-logs/s11-s4-doc-probe4-1.txt` section S6 finds no `DELETE FROM` clause in any of the seven privileged bodies this stage wrote. `p:` HTTP `T-06`..`T-09` measuring signed-URL status **before and after** each half, unit `OD-20`..`OD-24` |
| Takedown of the wrong wedding, or an id-guessing operator | `wedding_id` of the target must equal the case's; composite FKs cannot re-parent; case ref is `SV-` + 8 random base32 | `M:` `92_takedown_and_oversight.sql` `K19`/`K20` (a ref that exists nowhere, and another wedding's ticket cited against this wedding, refuse in the same sentence, so the door is not an existence oracle), `K21`/`K22` (nor does a ticket parked on the host as `awaiting_information`, nor a resolved one — a finished ticket is the record of an act that already happened), `K23` (four ways to fail, one sentence, and nothing in the trail), `K24`/`K25` (an invented reason and no reason at all are refused by name and the five real ones are listed), `K27` (the authority question is answered before any of the others, so a caller missing the grant cannot probe the wedding half), `K47`/`K48` (the same operator citing the other wedding, and its effect stayed on that wedding), `P11` (every ref this file cites was minted by the database and matches its own shape — the `SV-` + 8 base32 space is measured, not assumed), `U25`/`U27` (a key spent on one wedding cannot buy a plan on another, and a wedding whose takedown this file has not recorded still cannot be purged) and the census `Z11`/`Z14` (exactly the two claimed publications retired; no credential outside those two weddings revoked). `p:` HTTP `T-02`, `T-04` |
| Takedown leaves a guest roster reachable | the existing credential revocation set is reused, not re-derived (`20261009120000_stage8_guest_invitations_rsvp.sql:1087-1090`); household and wedding kinds both go | `M:` `92_takedown_and_oversight.sql` `K32`-`K35` (the publication retires; the two credential kinds on this wedding are both revoked; the credential that was already retired keeps its original timestamp instead of a fresh stamp; one credential of another wedding is not touched at all), `K36` (the two ready rows of the published version are invalidated while the registered, uploading, failed, superseded and other-wedding rows stay exactly where they were) and the census `Z12`/`Z14` (every invalidated artefact carries the reason the door gave, and no credential outside the two taken-down weddings revoked) — with `P06` the plant's own kind-and-revocation ledger those cells are read against. The Stage 8 guest suite re-ran green at this head on the `regress` chain: `stage 8 80_guest_invitation_links` 182 and `90_guest_rsvp` 185 (`q11-logs/s11-s4-regress-1615.txt`). `p:` HTTP `T-10` |
| Refund queue used to move money | no insert/update on `commerce_refunds` from any Stage 11 body; notes only; policy singleton untouched | `M:` `92_takedown_and_oversight.sql` proves the read-only posture from both ends. From the door: `Q04` (the operator who took two invitations down this morning cannot read the ledger — `operations` is not `finance`), `Q07` (the answer says it moves no money and changes no entitlement, beside a row count read from the money tables), `Q20` (six queue reads later every digest this file froze before the first act is still equal) and `Q21` (the `commerce_policy` singleton is not reachable through this door either). From the data: `N15` (the note's four flags all point one way — look, not touch), `N20` (annotating writes one event row on the ticket and moves no status on it), `N30` (four notes written and the money byte-identical to the state the plant left), `K50`/`K51` (a takedown leaves the money untouched in every sense the schema can express, and the only tables that grew are the trail and the thread), `O08`-`O10` (the refund, the order and the ticket a note cites cannot be deleted out from under it) and `Z09`/`Z10` (no refund digest moved and no case status moved anywhere in this file). `T05` is the delete-rule inventory the row rests on: three parents refuse their own delete and only the author's link goes NULL. `p:` HTTP `R-01`..`R-07`. The older census half of this row is measured at the slice-1 head: `q11-logs/s11-historic-5.txt` prints `POLICY=permissive GATE_PACKAGES=0 LIVE_CAPTURE=false`, and Stage 10's `N04b` re-measures the trail's DELETE posture against it |
| Cross-wedding leak through a support note, or a credential/PII surfacing in an operator projection | host/operator message kinds are separate arms; projections are field-built and each field list is named by a `keys` cell; and the batteries scan for the **absence** of what must not appear — a value planted where only the other side may read it, then looked for in the answer text | `M:` shape first: `80_operator_authority.sql` `W01` (a grant answer is seven named fields, not the row), `W11` (six), `W06`, `W06b`, `W07`, `W07b` (the payload is built field by field), and `s11a_gstate`/`s11a_adigest` proving a refused path left nothing. Then the absence scans, which are the half that can actually fail: `85_support_lifecycle.sql` `X03`-`X06` (three operator-arm rows planted by hand into a thread a host cannot see, the host's payload byte-identical after the plants, and none of the three arm names appearing anywhere in it — the filter is a `WHERE`, not a label the client hides), `X07` (the internal note's own sentence is absent, and that note names the host's address), `X30`/`X31` (an address appears exactly once where it belongs and the thread of that ticket holds none), and `92_takedown_and_oversight.sql` `U14`/`U15` (the three object keys go to the caller and *only* to the caller: none appears in the stored trail payload, and neither key shape appears there even as a pattern — `p/<43>` and `outputs/` both scanned) and `Q10`/`Q11` (the order half is six named fields; no `entitlement_id`, no `owner_user_id` at any level, and neither order owner's account uuid appears anywhere in the answer text). What is **not** shipped is a sweep of every returned value of every door for every PII class; the scans above are per-arm and named, and an unmeasured projection would be caught by the field lists rather than by a pattern. `p:` HTTP `C-10`, `R-08`, `H-03`, unit `OD-30`-`OD-34` |
| Erasure request silently deleting data | no Stage 11 body contains a DELETE; every FK this stage adds to `public.weddings` is NO ACTION, and the eight it adds to `auth.users` are SET NULL except the credential subject, which cascades so a duty cannot outlive its holder (`q11-logs/s11-s4-doc-probe-1.txt` sections D and E name all eight edges and their delete rules; `private.audit_events.actor_user_id` and Stage 10's `commerce_orders.owner_user_id` sit in the same catalog listing but are not counted, because those tables predate the stage); a cell performs each attempt and counts rows, threads and trail bytes before and after | `M:` `85_support_lifecycle.sql` T-RI1/T-RI2 (erasing an account nulls the ticket's attribution links and every trail row's actor, and deletes no ticket, thread row or trail row), T72 (a wedding a ticket names refuses deletion on `support_cases_wedding_id_fkey`, with the corrected control in `q11-logs/s11-probe-fk-null-control.txt`), T45-T47 (only a ticket with no history at all is deletable, by the trusted channel, and the deletion is measured as one row), T65-T70 (the credential cascades with its subject while her acts are nulled rather than removed), Z06-Z08 (the census after two erasures). `90_privacy_intake.sql` is slice 3's half: `S14` scans all four bodies for a DELETE, `D01`–`D10` refuse the hand plants and both client DELETEs, `D11`–`D12` refuse the parent delete on `privacy_requests_wedding_id_fkey`, `D13`–`D15` erase the requester and read the surviving request back from a new physical tuple, `D17`–`D21` erase the operator and read the intact requests, trail and cascaded credential back, and `Z01`–`Z12` close on thirteen requests with exactly one NULL requester. `40_catalog.sql` `C46` re-measures the ON-DELETE inventory at the head; `AI12` records that a trusted role can still prune the trail. Slice 4's half is the note and its author: `92_takedown_and_oversight.sql` `O11` (the author's account can still be erased — the require-an-author rule is an INSERT trigger, not a CHECK, so deleting a reviewer never makes the record impossible to delete), `O11b` (and the erasure is not cost-free: `operator_grants.user_id` is ON DELETE CASCADE, so removing a person removes their duties with them, measured rather than assumed), `O12`-`O14` (the note survives with every other byte identical, its trail row and its event row survive too, and the note is still readable and still attributed to its ticket and its kind), `O15`/`O16` (nothing else disappeared in that group — the ledger, the artefacts, the credentials — and the erasure did not touch the money) and `T05` + `O08`-`O10` (three of the note's four parents refuse their own delete, and only the author's link goes NULL). The no-DELETE claim is now read from the catalog rather than inferred from four bodies: `q11-logs/s11-s4-doc-probe4-1.txt` section S6 scans all seven privileged bodies this stage wrote and finds none. `p:` HTTP `V-04`-`V-07` |
| Health numbers that are decoration | every block carries `status: measured\|not_measured` and its own newest-row timestamp; three blocks are `not_measured` by construction | `p:` slice 5's `95_operations_health.sql` (each figure computed and re-computed by an independent query in the battery), HTTP `H-01`-`H-06` |
| A service-role key in the tool, a log, or a bundle | CLI takes an account password through `--secret-env` only; `assertSecretFree`; `service-role-key-in-browser-code` unchanged in `src/`; a new product-contract rule (`operator-rpc-referenced-outside-cli`) refuses any `src/` mention of an `operator_*` name, self-tested | `M:` `80_operator_authority.sql` `A05b` and `A13`-`A16` are the SQL half of the same promise — there is no `api` wrapper to call and the server key can neither read who holds authority nor write, resurrect or erase a credential, four refusals all named `permission denied for table operator_grants`. Slice 4 measured the harder version of the same boundary on the one body this stage could have handed to the server key and deliberately did not: `92_takedown_and_oversight.sql` `U03` stops `service_role` at `permission denied for schema internal_api`, `U03b` reads why the two refusals differ — `internal_api` USAGE is `true`/`true`/`false` for anon/authenticated/service_role, so the browser roles reach the function and are refused there while the server key never reaches it — `U04` counts zero `api` wrappers for the purge, and `U05` asks the database rather than this file and gets three `false`, with the measured ACL literally `{postgres=X/postgres}`: owner only, no PUBLIC half at all. Neither a browser session nor the server key has a wire path to the irreversible act; the tool half can only be measured once §11's CLI exists. `p:` unit `OD-40`-`OD-46`, `npm run product:check`, `npm run bundle:check`, HTTP `A-06` |
| A new migration quietly exposing a `private` operational table | `40_catalog.sql` inventories widened behind a stage11 branch, `check-db-contract.mjs` `NON_CLIENT_SCHEMAS`, `API33`/`API34` name lists | `M:` `C06` names `commerce_review_notes` among the five `private` tables this stage declares, inside a thirteen-table inventory that `92_takedown_and_oversight.sql` T16 measures independently; `C15` still measures reach; `C26` pins the definer set by name, and the count that set now carries is 46 — five more than slice 3, the figure T17 measures from `pg_proc`; `C26d`/`C26f` read 40 paired wrappers (`40_catalog.sql:1081` and `:1247` both declare 40 at this head); `C29a`'s stage11 arm names all eighteen of the stage's exposed RPCs (ten from slice 2, four from slice 3, four from slice 4) and `C28b` pins the thirty-six-name wrapper-plus-implementation set that goes with them — and `internal_api.operator_purge_publication_objects` is *absent* from both, which is the unexposed body showing up in the catalogue as a measured absence; `C29c-b` holds the identity-taking set closed at nine names; `C31` carries the stage's twenty-six triggers, of which slice 4's five on the review-note row are the newest and all INVOKER; `C46` and `C48` carry the new edges; and the file closes at 106 assertions at this head — `q11-logs/s11-s4-historic-1603.txt` prints `STAGE2 CATALOG TESTS PASSED (106)` twice, once per chain, beside the census `API_NAMES=40 INTERNAL_NAMES=60 PRIVATE_FUNCS=52`. `A06a`-`A06c` prove the *declared* surface did not move. `p:` `API33`/`API34` |
| Privilege granted by hiding links rather than by the database | §10: no admin route, no admin component, and the denial matrix is run at the wire for all four caller classes | `M:` `80_operator_authority.sql` `A05b` — slice 1's three names have no `api` wrapper at all, so for the authority surface there is no URL to hide behind and the claim is purely a grant claim, which `A13`-`A16` then test against the server key as well. The stage has since chosen to ship a browser-reachable surface, so this row can no longer rest on absence: `40_catalog.sql` `C29a` names eighteen exposed `api` RPCs at this head (ten from slice 2, four from slice 3, four from slice 4) and `C28b` pins the thirty-six-name wrapper-plus-implementation set beside them, which means an exposure is a decision with a name in the catalogue rather than a link that was never clicked. What holds the line is refusal at the door, measured per battery: `92_takedown_and_oversight.sql` `K01`, `Q01`, `N01` run each of its three doors as anon, `U01`/`U02` add the purge and refuse it even to the operator holding a live `operations` grant once that operator is on a session, `85_support_lifecycle.sql` `P01`-`P03` and `90_privacy_intake.sql` `P01`/`P02`/`Q11` run their own anon arms — the letter `P` is one of the collided ones, which is why the file rides the id — and `80_operator_authority.sql` `A09`/`A10` refuse an anonymous read and an anonymous write of the grant table itself at the schema layer. `p:` every HTTP `A-*`, `C-*`, `T-*`, `R-*`, `V-*` refusal paired with the operator's success control |

## 14. What Stage 11 refuses to build

Each row's third column is the assertion that would have to fail if the refusal were abandoned. Slice 1
names its cell; the rows whose instrument belongs to a later slice point at the row of §13 they are held to,
and §13 says which of those arms has not run.

| Refused | Why | The assertion that keeps it refused |
| --- | --- | --- |
| an admin/operator page in the browser | the kickoff's own first boundary; the authority-critical surface is provable at the wire and in SQL, and a UI whose door is its URL is the failure mode, not the feature | `src/App.tsx` gains no route; the product-contract rule above fires on any `operator_*` name under `src/`; `bundle:check` finds no operator chunk |
| an irreversible act reachable over HTTP | §6, and "human/owner-only approval for operations that impact unrelated real customers" | `92_takedown_and_oversight.sql` `U05` measures the zero: the three roles a browser can arrive as each answer `false` for EXECUTE and the access list is `{postgres=X/postgres}`; `U03`/`U03b` add that the server key has no USAGE on the schema to ask in, `U04` that no `api` wrapper exists, and `U02` that even a live `operations` grant on a session is refused. `p:` `API33` lists it as service-only |
| a refund, chargeback, capture or entitlement write | Stage 10 §12 and ADR 0008: no provider, no price | §13's refund-queue row; the six commerce tables stay grant-free |
| destructive erasure | Stage 13 owns retention and identity verification | §13's erasure row; readiness row stays intake-qualified |
| a rate-limiting, lockout or abuse feature | no application server exists to host one, and §2 measured the absence | the health projection's three `not_measured` blocks; `40_catalog.sql` finds no such table |
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
  forty paired wrappers, `C28b` the thirty-six-name signed-in set with the purge body *absent* from it,
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
thirty-six-name set §13's catalogue row reads at this head, so a signed-in callable surface that grows
without being named there is now a failing assertion. `C28a`'s anonymous matrix still has no Stage 11 arm,
and slice 4 re-measured that rather than assuming it — `92_takedown_and_oversight.sql` `U05` is the cell
that would move if an irreversible body were ever handed to `anon`, and the 106 that `C28a` sits inside is
printed again on both chains in `q11-logs/s11-s4-historic-1603.txt`.

Third, the runner shipped with different modes than planned. `supabase/tests/stage11/run.sh` is new on
the "a new head gets a new runner" rule (`stage10/run.sh:16-21`), with `STAGE11_LOCAL=1`,
`app.stage_head=stage11`, `st11qual_` databases and masking on every printed line — but its chain modes
are `authority|historic|regress|all`, not the eight named here in advance. The reason is Stage 10's,
rediscovered: the modes are chain *shapes* (an empty chain for a battery whose census counts the whole
cluster, two chains for Stage 2's clean/legacy pair, one chain per older stage's own pair), not one mode
per migration slice, and there is no `race` mode yet because the race tier is still a plan — which is why
§13's replay row declines to carry a concurrency claim.

`scripts/check-db-contract.mjs` and the generated `src/integrations/supabase/types.ts` are regenerated
(`dbtypes:check`) once a wrapper exists; `stage3_publication.test.mjs`'s `API33`/`API34` lists and
`supabase/tests/api/run.sh`'s `leak_census`, precondition object list, migration-count parity and
closing residue comparison all grow when the first browser-reachable verb does, and a residue check that
proves `operator_grants` is back to zero and that no audit row from the run survives is what will make
that tier measured rather than assumed. None of that moved for slice 1, because slice 1 gave no browser a
new thing to call. `docs/product/feature-readiness.md`'s "Admin / operations console" and "Activity /
audit logging" rows move in the same change they are earned in, per its rule 3, and its audit row's stale
"no writer in product code" clause is corrected while Stage 10's writer is being described. A new
`supabase/tests/stage11/` battery directory joins the sweep, and the historical Stage 2–10 chains are run
at each head: a foundation that weakens Stage 3's publication, Stage 6's private assets, Stage 8's guest
privacy or Stage 9's delivery claims is not a foundation.

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
`--local`, no reset of the shared database, no shadow of another project's stack. Through slice 4 the
migrations are qualified on native PostgreSQL 17 chains built by the runner; the shared
`localvivaahvarnam` stack apply is outstanding rather than performed, because Docker Desktop is not
running and starting it is a human-only action. No sentence in this document reports that apply as done,
and the HTTP and browser tiers that need the stack remain unrun for the same reason.

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
