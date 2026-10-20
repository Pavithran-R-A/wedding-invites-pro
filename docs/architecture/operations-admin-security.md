# Stage 11 — Operations, support and incident administration: authority model and threat model

**Status: design and threat model, and the contract the Stage 11 migrations are written against.**
Nothing in this document is exercised yet: every count below is read out of the live local stack or
out of a file at a named SHA, and every capability here is labelled **designed** until a battery
measures it. It authorises no operator, no refund, no erasure, no takedown of a real customer's
invitation and no live commerce.
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
migrations, matching the 31 files under `supabase/migrations/`) and from the migrations themselves.

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
the service-only pair `internal_api.grant_operator_role` / `internal_api.revoke_operator_role` — definer
bodies with **zero EXECUTE grants to `anon`, `authenticated` or `service_role`**, reachable only from the
trusted `postgres` path (§11). Each of those two writes an audit row naming who granted what to whom and
why. `private.actor_is_operator(p_scope text)` is the one predicate every operational body calls; it
reads `auth.uid()`, never an argument, and is `SECURITY DEFINER SET search_path = ''`.

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
`actor_kind text NOT NULL DEFAULT 'system' CHECK (actor_kind IN ('system','operator','host'))`,
`reason text`, `idempotency_key text`, `before_state jsonb`, `after_state jsonb`, each of the last two
`CHECK (… IS NULL OR jsonb_typeof(…) = 'object')`.
`CHECK (actor_kind = 'system' OR length(btrim(reason)) > 0)` makes "a human decision with no stated
reason" unrepresentable, which is the distinction the kickoff §2 item 5 asks for.
`UNIQUE (idempotency_key) WHERE idempotency_key IS NOT NULL` is the replay defence: the second delivery
of one operator action finds the row and returns the recorded answer instead of acting twice, the
mechanism `commerce-payment-events` already uses (`commerce-foundations.md` §4).

*Hardening.* `REVOKE UPDATE, DELETE ON private.audit_events FROM service_role` — a leaked service key
keeps its evidence-gathering powers and loses its rewriting ones — and a
`BEFORE UPDATE … EXECUTE FUNCTION private.reject_any_update()` trigger, the same absolute refusal
already used for the ledger (`20261017120000_stage10_commerce_foundations.sql:29`, `:353`), which raises
for **every** role including the trusted ones. `DELETE` stays refused for client roles by
`reject_client_delete` and is now also ungranted. The `actor_user_id` of an operator row is written by
the body from `auth.uid()`; no callable surface takes an actor id, so "forge another owner's identity"
has no argument to put it in.

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
p_reason text, p_idempotency_key uuid)` and `…p_purge_objects boolean` are **not** the same operation,
and the reason is measured, not stylistic: §2's `E-06` row proves that marking a row retired does not
stop delivery, so a single call that claimed both would be a false claim. Two functions, two audit verbs,
two answers:

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
2. `operator_purge_publication_objects(p_case_ref, p_idempotency_key)` — the irreversible half, and the
   only path in Stage 11 that can remove something a real guest already holds. It requires scope
   `operations`, **a second distinct idempotency key**, the case named above, and is refused entirely
   from any surface other than the trusted CLI (§10). It is a *planner*: it returns the exact
   `object_key` list and the count, and the CLI refuses to execute it without `--yes` after showing that
   list. Removal goes through the Storage API's own delete (the route `stage9-output-publisher.mjs`
   `remove` uses, `:337-346`), which is how Stage 9 measured that a deleted object fails both the live
   signed URL and the owner's re-mint. The registry rows are already `invalidated`, so the delete-then-mark
   ordering that Stage 9's design §12 states, and its migration restates at
   `20261013120000_stage9_render_outputs.sql:396`, is preserved rather than inverted.

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
cascade), `requester_user_id` NOT NULL (taken from `auth.uid()`, never supplied), `kind IN ('export',
'erasure')`, `status IN ('received','identity_verification_requested','queued_for_stage13',
'satisfied_outside_this_build','declined')`, `operator_note`, `requested_at`, `updated_at`, and
`CHECK (status <> 'satisfied_outside_this_build' OR length(btrim(operator_note)) > 0)` — the one status
that speaks of completion cannot be written without naming where it happened.

A host creates a request about their own wedding (`api.create_privacy_request`, authenticated, owner
re-derived), lists and reads their own, and can do nothing else. An operator with scope `privacy` lists
the queue, advances the status through the same trigger-enforced edge table as the cases, and annotates.
**No function in Stage 11 deletes a row from any table**, and no path exists that could: the erasure
vocabulary has no DELETE arm, the FK posture means a satisfied erasure request does not silently remove
money or publication history, and a battery proves the point by attempting one and reading the row count
back unchanged (§13, cells `PV-*`). Deletion/privacy V1's headline promise from `v1-scope.md` — guests'
data removable on request — is therefore *intake-qualified* in the readiness matrix, not marked
implemented, because the destructive half is Stage 13's legal decision (kickoff §1, §2 item 6).

## 9. Operational health: measured stores, and named absences

`api.operator_operations_summary(p_window_hours integer)` — scope `operations`, STABLE definer body,
returns **only** counts and timestamps it can reach, each block stamped with the statement's `now()` and
its own newest-row timestamp so "current" is a fact rather than an assumption:

| Block | Source it reads | Meaning |
| --- | --- | --- |
| `migrations` | `supabase_migrations.schema_migrations` | applied count and highest version. The comparison against the 31 files in the repository is the CLI's job, because a file listing is not a database fact, and the CLI prints both numbers or says it could not read one. |
| `publication` | `public.publications` | counts by status inside/outside the window, plus weddings with an active publication. |
| `credentials` | `private.access_tokens` | live vs revoked vs expired, by kind, and `last_used_at` distribution — the "which link did I send and when did it stop working" question Stage 3 left for support. |
| `delivery` | `public.invitation_outputs` | counts by status, and `failed` rows at the attempt ceiling (the stuck state Stage 9's repair made visible). |
| `commerce` | `private.commerce_payment_events`, `commerce_orders`, `commerce_refunds` | `held_for_reconciliation` rows by reason, orders by status, refunds awaiting review with no note. This is the operator's arm of the reconciliation findings Stage 10 §10 produced but gave nobody a way to see. |
| `audit` | `private.audit_events` | counts by `actor_kind` and by `action` prefix, and operator rows with no case link. |
| `queue` | the three Stage 11 tables | open/aged cases, cases awaiting information, privacy requests past a threshold. |
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
authenticated` — the exact posture §2 measured for all 22 existing functions. Every `internal_api` body is
`plpgsql`, `SECURITY DEFINER SET search_path = ''`, owned by `postgres`, fully qualified inside.

| Wrapper | Callable by | Authorisation inside the body |
| --- | --- | --- |
| `api.open_support_case(p_wedding_id, p_category, p_severity, p_summary, p_idempotency_key)` | `authenticated` | owner of that wedding, re-derived from `auth.uid()`; bounded inputs |
| `api.get_my_support_cases(p_status text, p_limit integer)` / `api.get_my_support_case(p_case_ref text)` | `authenticated` | rows whose `requester_user_id = auth.uid()`; host-facing projection only (§5) |
| `api.reply_to_support_case(p_case_ref, p_body, p_idempotency_key)` | `authenticated` | requester of that case, `message_host` arm only |
| `api.create_privacy_request(p_wedding_id, p_kind, p_note)` / `api.get_my_privacy_requests()` | `authenticated` | owner, requester is `auth.uid()` |
| `api.operator_case_queue(p_status, p_scope, p_limit)` / `api.get_operator_case(p_case_ref)` | `authenticated` | `actor_is_operator(auth.uid(),'support')`; operator projection including internal notes |
| `api.operator_assign_case(p_case_ref, p_operator_user_id, p_idempotency_key)` | `authenticated` | `support`; assignee must itself hold `support` |
| `api.operator_transition_case(p_case_ref, p_to_status, p_resolution_code, p_body, p_idempotency_key)` | `authenticated` | `support`, edge table in a trigger |
| `api.operator_takedown_plan(p_wedding_id)` | `authenticated` | `operations`; read-only, returns the key list §6 step 2 would need |
| `api.operator_takedown_publication(p_wedding_id, p_case_ref, p_reason, p_idempotency_key)` | `authenticated` | `operations` + case + reason vocabulary |
| `api.operator_commerce_review_queue(p_status, p_limit)` / `api.operator_add_commerce_review_note(p_refund_id, p_case_ref, p_kind, p_note, p_idempotency_key)` | `authenticated` | `finance_review` + case; insert-only note |
| `api.operator_privacy_queue(p_status)` / `api.operator_advance_privacy_request(p_request_ref, p_status, p_note, p_idempotency_key)` | `authenticated` | `privacy` + edge table |
| `api.operator_operations_summary(p_window_hours)` | `authenticated` | `operations`, STABLE |
| — not a wrapper — `internal_api.operator_purge_publication_objects`, `internal_api.grant_operator_role`, `internal_api.revoke_operator_role` | **no role at all**: zero EXECUTE grants; reached only by the trusted `postgres` path | see §3 and §11 |

**No `api` function is granted to `anon`**, so the anonymous door set stays the five §2 measured, and
`API33`/`API34`, `C28a`/`C28b` and the Stage 3/7/8 HTTP refusals are re-run rather than re-explained.
The purge body is deliberately *not* exposed: the one irreversible act in the stage has no browser
surface at all, so a stolen session cannot reach it, and the CLI reaches it as `postgres` over the
peer-authenticated channel the repository's other maintenance tools already use.

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
`public.weddings` is **NO ACTION** and every FK to `auth.users` is `ON DELETE SET NULL` except
`operator_grants.user_id`, which cascades deliberately: an erased account must not leave a live
operational grant pointing at nothing, and §2 measured that cascade posture is the only guard that
survives a parent delete. `case_ref`/`request_ref` uniqueness is the idempotency anchor for the §5 rule,
and `support_case_events (case_id, seq)` and `(case_id, idempotency_key)` are unique.
`invitation_outputs` gains **no** column: Stage 9's vocabulary already carries `publication_revoked`, and
a new reason would be a new word for a fact that has one.

## 13. Threat model → control → test

Four vocabularies again, because each tier names its own cells: unit `OD-*`
(`scripts/stage11-operations-cli.test.mjs`), SQL batteries a letter and two digits grouped per battery
(`80_operator_authority.sql`, `85_support_lifecycle.sql`, `90_takedown_and_oversight.sql`,
`95_operations_health.sql`), the race tier prefixed `RC*`/`RD*` for the same reason Stage 10 gave, HTTP
dashed (`A-*` authority, `C-*` cases, `T-*` takedown, `R-*` refund oversight, `V-*` privacy, `H-*`
health), and audit-integrity cells `AI-*`. **A citation that no run log carries is a claim, not
evidence**, so this table is written before the code and re-read after the batteries, and any row whose
arm did not run says so in the Stage 11 audit rather than here.

| Threat | Control | Planned cases |
| --- | --- | --- |
| Anonymous caller reaches any operational surface | `private` not in `config.toml:32`; zero `anon` EXECUTE on every new wrapper | SQL `A01-A06`, HTTP `A-01`, `H-05`; re-run of `C28a`/`API33` unchanged |
| A signed-in host operates on someone else's wedding | ownership re-derived from `auth.uid()` in every body; one shared SQLSTATE and sentence for "not yours"/"not there" | SQL `A07-A12`, `C20-C28`, HTTP `C-04`, `T-03`, `V-03` |
| A signed-in host operates on **their own** wedding without operator status | `actor_is_operator` before any scope work; the table has no client grant to write | SQL `A13-A19`, HTTP `A-02`, `A-03`, `T-01` |
| Self-granting operator scope | no surface at all: zero EXECUTE on `internal_api.grant_operator_role` for every role, RLS with no policy, `reject_client_write`; reachable only from `postgres` | SQL `A20-A26`, HTTP `A-04`, `A-05`, unit `OD-12` |
| Forgery of the actor in an audit row | `actor_user_id` from `auth.uid()` inside the body; no callable takes an actor argument (contrast §2's measured caller-supplied column) | SQL `AI01-AI05`, HTTP `AI-1`, `C-09` |
| Audit rewritten or deleted after the fact | `reject_any_update` on `private.audit_events` (refuses every role) + UPDATE/DELETE revoked from `service_role` | SQL `AI06-AI12` (attempt as postgres, service_role, authenticated; read back identical), HTTP `AI-2`, `AI-3` |
| Duplicate or replayed operator action | `audit_events.idempotency_key` unique; each body pre-reads the key and returns the recorded answer; second delivery acts on nothing | SQL `AI13-AI20`, HTTP `C-07`, `T-05`, race `RD00-RD07`; **race arm is where the concurrency claim comes from, not the serial one** |
| Race: two operators take the same wedding down at once | one active publication per wedding, `FOR UPDATE` on the publication row, the state machine's terminal `revoked`, one idempotency namespace | race tier `RC00-RC09` (two live sessions), asserted once both committed |
| Race: an action against a grant revoked mid-flight | `actor_is_operator` re-read inside the same transaction that acts, after `SELECT … FOR UPDATE` on the grant row | race tier `RC10-RC16` |
| Stale tab transitions a case twice | trigger-compared OLD/NEW edge table, per-case `seq`, optimistic `p_expected_status` | SQL `C30-C44`, HTTP `C-05`, `C-06` |
| Takedown claimed to kill a file link it does not kill | §6's split; purge is a separate, unexposed, twice-confirmed act; the answer text names its own limit | SQL `T20-T34`, HTTP `T-06`..`T-09` measuring signed-URL status **before and after** each half, unit `OD-20`..`OD-24` |
| Takedown of the wrong wedding, or an id-guessing operator | `wedding_id` of the target must equal the case's; composite FKs cannot re-parent; case ref is `SV-` + 8 random base32 | SQL `T10-T19`, HTTP `T-02`, `T-04` |
| Takedown leaves a guest roster reachable | the existing credential revocation set is reused, not re-derived (`20261009120000_stage8_guest_invitations_rsvp.sql:1087-1090`); household and wedding kinds both go | SQL `T35-T40`, HTTP `T-10`, and the Stage 8 guest suite re-run green |
| Refund queue used to move money | no insert/update on `commerce_refunds` from any Stage 11 body; notes only; policy singleton untouched | SQL `R01-R24`, HTTP `R-01`..`R-07`, plus the Stage 10 census proving `live_capture_enabled` still false |
| Cross-wedding leak through a support note, or a credential/PII surfacing in an operator projection | host/operator message kinds are separate arms; projections are field-built; battery greps every returned value and every audit column for a token digest, an email, an object key | SQL `AI21-AI30`, HTTP `C-10`, `R-08`, `H-03`, unit `OD-30`..`OD-34` |
| Erasure request silently deleting data | no DELETE arm exists anywhere in the stage; FKs are NO ACTION; a cell performs the attempt and counts rows before and after | SQL `V10-V26`, HTTP `V-04`..`V-07` |
| Health numbers that are decoration | every block carries `status: measured|not_measured` and its own newest-row timestamp; three blocks are `not_measured` by construction | SQL `H01-H18` (each figure computed and re-computed by an independent query in the battery), HTTP `H-01`..`H-06` |
| A service-role key in the tool, a log, or a bundle | CLI takes an account password through `--secret-env` only; `assertSecretFree`; `service-role-key-in-browser-code` unchanged in `src/`; a new product-contract rule (`operator-rpc-referenced-outside-cli`) refuses any `src/` mention of an `operator_*` name, self-tested | unit `OD-40`..`OD-46`, `npm run product:check`, `npm run bundle:check`, HTTP `A-06` |
| A new migration quietly exposing a `private` operational table | `40_catalog.sql` inventories widened behind a stage11 branch, `check-db-contract.mjs` `NON_CLIENT_SCHEMAS`, `API33`/`API34` name lists | §15; these assert by inventory, not by case id |
| Privilege granted by hiding links rather than by the database | §10: no admin route, no admin component, and the denial matrix is run at the wire for all four caller classes | every HTTP `A-*`, `C-*`, `T-*`, `R-*`, `V-*` refusal paired with the operator's success control |

## 14. What Stage 11 refuses to build

| Refused | Why | The assertion that keeps it refused |
| --- | --- | --- |
| an admin/operator page in the browser | the kickoff's own first boundary; the authority-critical surface is provable at the wire and in SQL, and a UI whose door is its URL is the failure mode, not the feature | `src/App.tsx` gains no route; the product-contract rule above fires on any `operator_*` name under `src/`; `bundle:check` finds no operator chunk |
| an irreversible act reachable over HTTP | §6, and "human/owner-only approval for operations that impact unrelated real customers" | `internal_api.operator_purge_publication_objects` has zero EXECUTE grants and `API33` lists it as service-only |
| a refund, chargeback, capture or entitlement write | Stage 10 §12 and ADR 0008: no provider, no price | §13's refund-queue row; the six commerce tables stay grant-free |
| destructive erasure | Stage 13 owns retention and identity verification | §13's erasure row; readiness row stays intake-qualified |
| a rate-limiting, lockout or abuse feature | no application server exists to host one, and §2 measured the absence | the health projection's three `not_measured` blocks; `40_catalog.sql` finds no such table |
| a second audit trail, a second case model, a second `wedding` or `output` schema | §4, §5, and one-data-model is a standing constraint | table inventories in `40_catalog.sql`; no new column on `invitation_outputs` |
| a seeded operator | "No live operator authority is granted by this kickoff document" | a named SQL cell asserts `count(*) FROM private.operator_grants = 0` after the full migration chain |
| a hosted call, a deploy, a merge into `main`, Stage 12 | the work order | push read-back of `stage11/operations-admin` only (`git ls-remote` plus `gh api`, never a tracking ref) |

## 15. Instruments that must move with the code

Not optional cleanup — these gates fail loudly, and the response Stage 10 recorded for a stack whose
applied migrations were behind the repository was to make the precondition refuse rather than relax the
count ([`commerce-foundations.md`](commerce-foundations.md) §14 item 3), which is the posture this
section inherits. `40_catalog.sql`'s closed inventories and exact-count
tripwires (public tables `:135-146` and C05 `:400-405`, private tables `:163-176` and C06 `:406-410`,
SELECT grants `:442-446`, write grants `:466-496`, service_role DML count `:507-518`, zero-commerce
grants `:526-534`, schema USAGE `:566-590`, policy counts `:604-610`, definer inventory `:704-780`,
wrapper count `:822-826`, grant matrices `:981`, `:1028`) each need a stage11 branch at the head-aware
points (`:169`, `:303`, `:364`, `:781`, `:945`), including the two counts this stage *lowers*:
`service_role` loses UPDATE and DELETE on `private.audit_events`, and `private` gains five tables.
`stage3_publication.test.mjs`'s `API33`/`API34` name lists grow by every wrapper and record the three
service-only bodies. `supabase/tests/api/run.sh` gains the new `private` stores in its `leak_census`
(`:114-139`), the precondition object list (`:147-168`), migration-count parity (`:170-190`) and the
closing residue comparison (`:221-258`) — including a proof that `operator_grants` is back to zero and
that no audit row from this run survives, which is what makes residue measured rather than assumed.
`supabase/tests/stage11/run.sh` is new, on the "a new head gets a new runner" rule
(`stage10/run.sh:16-21`), with `STAGE11_LOCAL=1`, `app.stage_head=stage11`, `st11qual_` databases, chain
modes `authority|support|takedown|oversight|health|historic|race|all` and its own battery glob.
`scripts/check-db-contract.mjs` and the generated `src/integrations/supabase/types.ts` are regenerated
(`dbtypes:check`); `docs/product/feature-readiness.md`'s "Admin / operations console" and "Activity /
audit logging" rows move in the same change they are earned in, per its rule 3, and its audit row's stale
"no writer in product code" clause is corrected while Stage 10's writer is being described. A new
`supabase/tests/stage11/` battery directory joins the sweep, and the historical Stage 2–10 chains are run
at each head: a foundation that weakens Stage 3's publication, Stage 6's private assets, Stage 8's guest
privacy or Stage 9's delivery claims is not a foundation.

## 16. Migration slices

Forward-only, monotone after `20261020180000_stage10_nested_revocation.sql`, one concern per file so a
refusal can be bisected to a slice: `…190000_stage11_operator_authority.sql` (§3 + §4),
`…190100_stage11_support_cases.sql`, `…190200_stage11_privacy_intake.sql`,
`…190300_stage11_takedown_and_oversight.sql`, `…190400_stage11_operations_health.sql`, each followed by
its catalogue branch edit in the same commit, and each applied to this repository's own local stack by
`npx supabase db push --local --skip-vault` **after** a `--dry-run` shows exactly the expected pending
files — the sequence Stage 10 recorded for the publish-gate repair. No `supabase db push` without
`--local`, no reset of the shared database, no shadow of another project's stack.

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
