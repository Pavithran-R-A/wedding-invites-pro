# Stage 2 migration strategy

> **Status: decided, pre-implementation.** This document exists because Phase 6 of the Stage 2
> directive requires the migration strategy to be argued and chosen *before* any SQL is written.
> Every schema statement described here was written after this page was finished, and the
> implementation outcome is recorded in
> [`../audits/stage-2-domain-database.md`](../audits/stage-2-domain-database.md) rather than here —
> a plan must not be allowed to quietly become a claim about what shipped.

Inputs read before deciding: the four published migrations, the Stage 0 RLS suite, the current
application query sites, [the Stage 2 blueprint](stage-2-domain-blueprint.md), ADR 0001–0005,
[`../product/v1-scope.md`](../product/v1-scope.md),
[`../product/invitation-semantics.md`](../product/invitation-semantics.md) and
[`../product/structured-creator.md`](../product/structured-creator.md).

## 1. The starting position, measured

The published database is the Lovable-era scaffold plus two Stage 0 security repairs. Nine tables
live in `public`: `profiles`, `user_roles`, `templates`, `projects`, `guests`, `printers`, `orders`,
`payments`, `activity_logs`. All nine have RLS enabled and 15 live policies between them. There are
**no** column CHECK constraints anywhere, **no** explicit `CREATE INDEX`, **no** table-level
`GRANT`/`REVOKE` in any migration, and **no** `default` privileges configured in SQL — client table
access comes entirely from Supabase platform defaults, which is precisely the assumption Stage 0
proved unsafe to make.

The application touches two of the nine tables. The live query sites are
`src/pages/Dashboard.tsx:34`, `src/pages/CreateProject.tsx:32` and `:52`,
`src/pages/ConfigureProject.tsx:23` and `:42`, `src/pages/EditProject.tsx:88` and `:106`. There are
zero `.rpc(`, `.delete(`, `.upsert(`, Storage or Edge Function calls. So `guests`, `orders`,
`payments`, `printers`, `activity_logs`, `profiles` and `user_roles` are, from the browser's point of
view, dead surface — but they are *plausible-looking* dead surface with money columns
(`cost_printer_paise`, `price_platform_paise`, `amount_paise`, `paid_status`), and the blueprint
already names the consequence: keeping them is an audit hazard, because someone will later assume
they mean something.

That is the whole problem in one sentence: **the columns that matter are unused, and the used table
is named `projects`.**

## 2. Options considered

### Option A — rename and mutate `projects` into `weddings`

`ALTER TABLE public.projects RENAME TO weddings`, rename and retype columns
(`user_id`→`owner_user_id`, `guest_count`→`estimated_guest_count`,
`selected_features`→`style_settings`), drop `paid_status`, add the new columns, then drop or
re-parent the unused scaffold tables.

Honest strengths, because there are real ones. It is the smallest diff. PostgreSQL propagates a
column rename into dependent policies and views, so the `auth.uid() = user_id` policies follow the
rename automatically instead of needing re-authoring. Identity is literally preserved — there is no
copy step to get wrong, and `projects.id` *is* `weddings.id` with no possibility of drift. The app
transition is a search-and-replace of one table name. And the blueprint's own §1 necessity challenge
says this out loud: "This is `projects` renamed. If we do not need fields beyond
title/language/guest_count, the honest answer is *alter `projects` into `weddings`*."

We do need fields beyond title/language/guest_count — that conditional is now false — but "needs
more columns" is not by itself a refutation of a rename. The refutations are elsewhere.

### Option B — canonical new tables, explicit data migration, non-exposed `legacy` archive

Create the canonical domain from scratch in `public`, copy forward the useful facts from `projects`
and `templates` preserving their primary keys, move the obsolete scaffold tables into a `legacy`
schema that no browser role can reach, and revoke every inherited privilege.

### Option C — the variant worth naming explicitly

Keep the name `projects` and add sibling tables (`project_people`, `project_events`, …). Rejected
immediately and for a durable reason: it leaves the aggregate named after the wrong concept while
every new child table's name would need to inherit that mistake, and Stage 1's entire product reset
was about the vocabulary being wrong ("project" erases the family, the rituals, the occasion). A
half-renamed domain is worse than a fully legacy one, because it looks finished.

## 3. Evaluation

| Criterion | Option A (rename) | Option B (canonical + archive) |
| --- | --- | --- |
| Migration safety | Higher — no data copy step | Copy is `INSERT…SELECT` and reviewable line-by-line; IDs preserved |
| ID preservation | Total by construction | Total: `weddings.id` is copied verbatim from `projects.id` |
| Rollback / debuggability | Poor — after the rename, the old shape exists nowhere and a rollback needs a reverse migration that invents it | Good — legacy tables remain physically intact with their rows and their own DDL; the canonical set is additive until the archive step |
| Old-data preservation | Selective at best; `selected_features` is half-migrated by definition | Complete — nothing is deleted, everything unreachable is moved |
| App transition complexity | Lower | Higher: 7 query sites change table *and* column names, and generated types must be rebuilt |
| Long-term schema clarity | Medium: `weddings` keeps the ancestry of a generic project row, including any column a future reader finds and cannot explain | High: every canonical column is one this stage chose on purpose |
| Accidental entitlement carryover | **Material risk.** `paid_status` is a column on the aggregate; a rename invites "keep it for now" and leaves a billing column on the canonical table, guarded by a trigger instead of absent | **Structurally impossible.** `weddings` is born with no billing column; `paid_status` survives only in `legacy.projects`, which no app role can read |
| Same-wedding composite FKs | Awkward: `projects.id` is already referenced by the legacy children, so adding `UNIQUE (id)`-style composite targets entangles the canonical aggregate with rows we are trying to isolate | Natural: canonical children are created with `UNIQUE (wedding_id, id)` from the start, and legacy children keep referencing `legacy.projects` |
| RLS/grants story | Inherited: the existing policies were written against defaults we did not choose and cannot see | Rewritten: explicit `REVOKE` then minimal `GRANT`, with fail-closed `ALTER DEFAULT PRIVILEGES` |
| Schema clarity for later stages | Two vocabularies (`projects`-derived columns, mixed names) | Three bounded zones: `public` (browser-legible), `private` (server-only), `legacy` (history, unreachable) |

## 4. Decision: Option B

Chosen, and not merely because the directive biases toward it. Two of the reasons above are
decisive on their own merits:

1. **Entitlement carryover is the single most dangerous thing this stage could get wrong.** Stage 0
   had to repair a `paid_status` bypass, which means a client-writable billing column has already
   once been real in this product. Option A keeps the column on the canonical aggregate and relies
   on a trigger to hold it shut. Option B means there is nothing to hold shut. Phase 7 says legacy
   paid state must not be reinterpreted as a VivaahVarnam entitlement; a schema where no such
   reinterpretation is *representable* is a stronger answer than a policy that forbids it.
2. **The composite-FK requirement and the rename fight each other.** Phase 30 wants
   `unique (wedding_id, id)` so that `(wedding_id, venue_id) → venues(wedding_id, id)` makes a
   cross-wedding attachment impossible at the constraint layer. Building that on a table whose
   existing FK graph is entangled with the scaffold rows we are isolating means either dragging the
   scaffold along or breaking FKs mid-migration. Both are worse than creating clean children.

Option A's genuine advantage — a much smaller application diff — is real but is worth less than the
two points above, because the app diff is 7 query sites in 4 files and it has to be taken anyway:
the preview must stop depending on `projects` as the canonical model (Phase 51) under either option.

Bias followed. Recorded, per Phase 6's instruction not to follow it blindly: a rename would have been
the better call if Stage 2 needed only a handful of extra columns on the aggregate and had no
requirement to isolate the guessed commerce tables. It needs both, so it is not the better call.

## 5. Consequences accepted

- **A data copy must be proven, not assumed.** Hence two independent qualification chains: an
  empty-database run of the whole migration history, and a seeded-legacy run where the old rows are
  created first and their migration asserted (Phases 38–39).
- **IDs are preserved deliberately**, so support history and any pre-existing external reference to
  a project id keeps resolving to the same object.
- **Legacy is history, not truth.** `legacy` gets no `USAGE` for `anon`/`authenticated`, no table
  grants, and no exposed schema entry. Its rows stay readable to a human operator with a psql
  session and nothing else.
- **The Stage 0 attack suite cannot survive unchanged.** It asserts policies on `public.projects`,
  which will no longer exist. This is handled openly in §8, not by deleting the inconvenient tests.
- **Money history must not vanish on account deletion.** The legacy tables currently cascade from
  `auth.users` (`payments.user_id`) and from `projects` (`orders.project_id`), so deleting a user
  would silently destroy payment records. See §7 — this is changed to `RESTRICT` and the
  consequence is accepted on the record.

## 6. Target shape

Three zones:

- **`public`** — the canonical domain, reachable by the browser strictly through RLS and explicit
  minimum grants: `weddings` and its owned children (people, venues, events, drafts, households,
  event scopes, RSVP responses, approval requests and feedback, assets), platform content
  (`tradition_packs`, `design_templates`), the trust-bearing aggregates (`invitation_versions`,
  `publications`, `entitlements`), and the retained account tables (`profiles`, `user_roles`).
- **`private`** — not exposed. Server-only helpers with pinned `search_path`, the centralised
  `updated_at` mechanism, the client-write and immutability guards, the hashed access-token table
  and the append-only audit-event table. No `USAGE` for client roles.
- **`legacy`** — the archived scaffold: `projects`, `guests`, `orders`, `payments`, `printers`,
  `activity_logs`, `templates`. Rows preserved, policies dropped as redundant, privileges revoked.

`weddings` carries no billing concept of any kind. The closest it comes is
`style_settings jsonb` constrained to an object, and `estimated_guest_count` constrained
non-negative — the latter being an *estimate the host types*, which is not a price input and is
never a billing quantity (Stage 0 established that per-guest pricing is not V1's model).

## 7. Deletion and cascade policy

Every `ON DELETE` action is chosen, not inherited (Phase 63). The enforceable list lives in
`supabase/tests/stage2/40_catalog.sql` as its `fk_actions` array — all **36** canonical foreign keys
(30 in `public`, 6 in `private`), each written as
`child(parent_column)->parent=ACTION`, and C46 compares that array against `pg_constraint` in both
directions, so an unlisted action, a changed action or a renamed relationship fails the suite. The
table below is the **reasoning**, grouped by family rather than enumerated row by row, and it is kept
in step with the array by hand: no test reads this document, so a change here that contradicts the
array would not go red. Read the array as the fact and this table as the argument.

### 7.1 The finding that decided four of these rows

The first draft of this stage protected frozen versions, publications, approval requests and review
feedback with `private.reject_client_delete()` and let them cascade away with the wedding. That was
wrong, and it was caught by a test rather than by review.

`reject_client_delete()` decides by *role name*, and a cascading foreign key does not delete as the
role that removed the parent. Measured on PostgreSQL 16.15 with a minimal
`parent → child ON DELETE CASCADE` pair plus a `BEFORE DELETE` trigger on the child that records
`current_user`: after `SET ROLE authenticated` and a parent delete, the child's trigger saw
`current_user` equal to the child table's **owner**, and the child row went. The same result was
reproduced against this schema directly — an owner's `DELETE FROM weddings` removed a frozen
`invitation_versions` row without the immutability trigger ever objecting.

So a role-named trigger cannot be the thing that makes server-authored history undeletable, and
immutability moved to the one mechanism that has no role context to step around: relational
integrity. The trigger stays for the case it does cover (a direct `DELETE` by a client role that
some future grant or policy mistake let through), but it is now a backstop rather than the wall.

### 7.2 The policy as implemented

| Relationship | Action | Why |
| --- | --- | --- |
| `auth.users` → `weddings.owner_user_id` | `CASCADE` | A consumer account must be deletable. Blocking account deletion is not an option a privacy promise can survive. |
| `weddings` → people, venues, events, drafts, households, scopes, RSVP, assets | `CASCADE` | Genuine working data of that family: no meaning outside the wedding, and erasure has to be complete. The CASCADE is only safe because a child pinning *another* child of the same wedding is `RESTRICT` in its own right (`wedding_events.venue_id` → venues): the two clauses have to coexist, since the venue cannot be deleted alone while an event names it, yet the wedding delete that removes both must still succeed. `20_attacks.sql` group 11f executes both halves rather than asserting one from the other. |
| `weddings` → `invitation_versions`, `publications`, `approval_requests` | `NO ACTION` | §7.1. A wedding delete must not become an unremarkable way to erase what was published and what was approved. Cleanup is an ordered, deliberate act, asserted in `20_attacks.sql` group 11. |
| `weddings` → `entitlements` | `NO ACTION` (no clause) | Money-adjacent history does not vanish with the aggregate; a right is revoked explicitly. |
| `weddings` → `private.access_tokens.wedding_id` | `NO ACTION`, tightened from the `CASCADE` this file first shipped | Same rule as the other frozen-history tables: a cascade runs as the child's owner, so `tokens_no_client_delete` could not have refused one. Outcome-neutral rather than protective, and that is the honest description — every token row needs a publication or an approval request by its own CHECK, and both already pin the wedding. `20_attacks.sql` group 11e executes each half: a credential-bearing wedding delete is refused and destroys nothing, one credential can still be retired by a trusted role, and a token that pins nothing but its wedding is rejected by the CHECK that makes the case unwritable. |
| `weddings` → `private.audit_events.wedding_id` | `SET NULL`, `subject_key`/`payload` retained | The record that something destructive happened must outlive the object it happened to. |
| `approval_requests` → `approval_feedback` | `NO ACTION` | §7.1 again, one level down: `feedback_append_only_no_delete` cannot see a cascade, so "what did we ask her about" survives its request only if a key says so. |
| `invitation_versions` → `publications`, `approval_requests` | `NO ACTION` on the composite `(wedding_id, version_id)` | A live link and a recorded decision cannot be orphaned by withdrawing a snapshot. `NO ACTION` rather than `RESTRICT` because a trusted cleanup removes a whole version chain in one statement, and the self-referencing `supersedes_version_id` links are inside that same row set — `RESTRICT` is checked row-by-row and would refuse the first link of the chain. |
| `auth.users` → `invitation_versions.created_by` | `CASCADE` | An attribution column must not be able to block an account deletion. The history it points at is pinned by the rows above, not by this one. |
| `weddings`, `invitation_versions` → `tradition_packs`, `design_templates` | `RESTRICT` | Platform content a wedding depends on is not deletable out from under it, and there is no cleanup order that makes it one. |
| `tradition_packs`, `design_templates` → `reviewed_by` | `SET NULL` | A reviewer leaving the platform must not delete the pack they approved. |
| `auth.users` → `legacy.payments.user_id` | `CASCADE` → `NO ACTION` in file 8 | Financial records must not be destroyed as a side effect of an account delete, even archived ones. Accepted consequence: hard-deleting an account that has legacy money rows now *fails loudly* until Stage 13's retention decision exists. A visible blocker beats silent destruction. |
| `legacy.projects` → `legacy.orders.project_id` | left `CASCADE` | `legacy.orders` has no surviving money row of its own — `payments` is pinned to `auth.users` above — so this cascade moves order scaffolding, not financial history. Recorded rather than reasoned away: it is the one legacy cascade that was *not* tightened, and Stage 13's retention decision owns it. |
| everything else in `legacy` | left as published | The schema is unreachable for every API role (file 8's `REVOKE` block), so these actions can fire only from a migration or a maintenance session, where the order is written down and reviewable. |

`40_catalog.sql` asserts the general rule behind the table: no table carrying an append-only or
server-authoritative trigger may be reachable by a `CASCADE` from a parent a client role can delete,
and the twelve `weddings → child` cascades are exactly the customer-working-data set listed above.

## 8. What happens to the Stage 0 security suite

The published 24-assertion suite encodes guarantees that must not be lost. It cannot literally
survive, because 12 of its assertions exercise `public.projects` policies that Stage 2 removes along
with the table. Silently deleting it, or leaving a runner that fails, are both dishonest options.

So the suite is **carried forward by substitution, with a per-assertion mapping** in the Stage 2
audit: each Stage 0 guarantee is traced to either (a) the same assertion against the new canonical
object, (b) an assertion that the equivalent capability is now structurally impossible, or (c) an
assertion that the old surface is unreachable. Concretely: "client may not set paid state" becomes
"`weddings` has no billing column and `entitlements` rejects client writes" plus "`legacy.projects`
cannot be read by any app role"; "service path intact" becomes a service-role write probe against
the canonical tables; the `SECURITY DEFINER` search-path assertion is retained and strengthened to
cover every definer function that exists after Stage 2, and adds the stronger claim that `public`
contains none.

The Stage 0 *migrations* are not touched — forward-only, per rule 18.

## 9. Deviations from the Stage 1 blueprint, recorded

The blueprint is a design input, and Phase 3 says to challenge it where implementation facts demand
it. Where the Stage 2 directive and the blueprint disagree, the directive wins, and the disagreement
is noted rather than smoothed over:

| Topic | Blueprint position | Stage 2 decision | Reason |
| --- | --- | --- | --- |
| `venues` | "Table if deduplicated/referenced; JSON if merely embedded… for one wedding, the venue is content on the event" | **Table**, wedding-scoped | The directive requires a relational same-wedding invariant between event and venue. JSON cannot express a foreign key, so it cannot fail closed. |
| `event_scopes` | "JSON array of event ids on the household… A join table here is ceremony for its own sake" | **Join table** with composite FKs | The directive requires "no response for an unscoped event" to be enforced. A composite FK from RSVP to the scope key is the only primitive that does that; and RSVP-to-scope is a genuine query, which is the blueprint's own table criterion. |
| `people` | "Lean JSON first… extract later when a real query demands it" | **Table**, role/group/display-order columns | The directive's Phase 11 lists the relational shape. Independent querying is real for later stages (RSVP attribution, ordered rendering per group). |
| `recipients` | "JSON inside the household initially", strong deferral candidate | **Deferred entirely** — no table, no JSON column | Phase 19 asks for a decision. The household is the V1 sharing and RSVP unit; a member-name array has no consumer in this stage and an unconsumed JSON shape is how a schema accrets. Promotion criterion written down: a per-recipient token or an individual RSVP record. |
| `wedding → is_published` | Warned against | Not added | Publication is a table with its own lifecycle. |
| Language constraint | "A static list in `src/lib/i18n.ts`, plus a DB enum if a constraint is needed" | **`CHECK` list**, no enum, no table | An PostgreSQL enum needs `ALTER TYPE … ADD VALUE`, which cannot run inside a transaction block and is operationally awkward; a reference table would add a join to every ownership policy for data that changes once a release. `en/ta/te/ml/kn` are ISO 639-1 codes, so the *type* is already `text` and stable; extension is one forward migration. |
| Ceremony/event vocabulary | — | **No CHECK on event keys** | Phase 13 forbids hard-coding Tamil/Telugu ceremony types in SQL. The customer chooses the label; a pack may later recommend vocabulary. |
| Cultural identity | I-04/I-05 | No column expresses caste, religion, community or ethnicity; `role_key`/`group_key` are free labels; a static schema assertion plus a live catalog query prove no such column exists | Direct requirement of Phase 66 and ADR 0003's rule that tradition is behaviour selected by the host. |
| Platform content compatibility | "one row per visual design, or per (design × pack) pairing?" | **No pack-compatibility relation in Stage 2** | Zero pack rows exist. An empty join table whose semantics nobody has validated is worse than a documented deferral; the compatibility question lands with Stage 4's first real pack pair. |
| `tokens` | Blueprint §19 + token design | `private.access_tokens` created as foundation, hash-only, **no token generation, no public path** | The domain must support secure unauthenticated-link credentials, and Phase 28 permits deferral only with an explanation. Hash storage with scoped kinds is safe to build now; minting links is not. |
| `orders` / `payments` | "Stage 2's decision is *delete or reshape*, deliberately" | **Archive, do not reshape** into `legacy` | Phase 27's preferred bias. Provider-specific columns must not be guessed a second time. Stage 10 designs them from a real integration. |
| `activity_logs` | "either wire it purposefully or drop it" | Neither: **archive** it, and create `private.audit_events` as the canonical append-only design | The old table's actor columns are client-namable (`user_id`, `ip`, `user_agent`) and its shape assumes a project. Wiring it would bless that shape; dropping it would lose whatever rows exist. |
| Money | integer paise, non-negative, no floats | No monetary column is introduced in `public`. `legacy` keeps its integer paise columns as-is. Floats are not used anywhere new. | Phase 67. |

## 10. Sequencing the migrations

Forward files, ordered so that each step is individually valid SQL and no step depends on an object
created later:

1. Schemas and `private` helpers; fail-closed `ALTER DEFAULT PRIVILEGES` for `public`, `private`,
   `legacy`.
2. Canonical aggregate and its owned relational children.
3. Platform content, immutable versions, publications with the one-active-publication partial index.
4. Guests, approvals, RSVP, assets, entitlements, `private.audit_events`, `private.access_tokens`.
5. Explicit `REVOKE ALL` from client roles across `public`, then minimum `GRANT`s, then the policy
   set for every exposed table, with RLS enabled on all of them.
6. Copy `templates` → `design_templates` and `projects` → `weddings` (+ one draft row per migrated
   wedding), preserving primary keys, mapping only the styling keys the editor actually writes, and
   asserting that no entitlement is created from `paid_status`.
7. Move the archived scaffold into `legacy`, drop its now-redundant policies, change the
   money-record FK actions to `RESTRICT`, and revoke all client access.
8. Move the surviving security helpers into `private`, re-point the `auth.users` trigger and the
   `profiles`/`user_roles` tightening, and drop the superseded `public` functions after their
   consumers are gone.

Each file is a single transaction, so a failure mid-chain aborts rather than half-applies.

## 11. What this stage deliberately does not do

No public invitation route, no `/i/:token`, no guest or RSVP or approval UI, no event or venue or
family editor, no uploads, no Storage policies, no payment provider, no price values, no admin
panel, no QR/PDF/OG/video renderer, no remote deployment, and no edit to a published migration.
Schema existing is not a feature existing, and the readiness matrix says so per row.
