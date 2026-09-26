# Stage 2 audit — domain and database redesign, legacy migration, security qualification

Executed by the coding agent as a single stage. Reviewers: ChatGPT (auditor / technical auditor /
product controller / stage reviewer). Every number below was printed by a command that ran; each
section names the command or the assertion id that produced it, so a claim can be re-measured rather
than re-believed. Where something was **inferred rather than executed, it says so in those words.**

This document does not calculate a project completion percentage. That is the reviewer's job.

---

## 1. Starting SHA

`e93912d780fc813e1e9b79bf8858638cbec4fd6b` (`origin/main`, the Stage 1 merge closure). All Stage 2
work starts from it; `main` was not moved by this stage.

Re-measure: `git merge-base origin/main HEAD` (must still contain that SHA) and, after the push,
`git ls-remote origin refs/heads/main`.

## 2. Branch

`stage2/domain-database-redesign`, pushed as its own branch. Not merged into `main`. No tag, no
release, no deployment.

## 3. Migration strategy considered

| Option | What it meant | Why it was not chosen |
| --- | --- | --- |
| A. Rename/alter `projects` into `weddings` in place | The blueprint's own suggestion while the domain was still small | `projects.paid_status` is the most-repaired column in this repository's history (Stage 0 found a client-writable paid state, then an INSERT path that bypassed the guard). Keeping the table keeps the compromised column as the thing under edit, and every new constraint would have had to coexist with data whose meaning the product no longer accepts. Also: an in-place rename cannot be *tested against real history* the way a copy can |
| B. New canonical tables + `legacy` archive | Build the domain fresh, copy what is honestly copyable with ids preserved, move the old tables out of reach instead of dropping them | **Chosen** |
| C. Switch to declarative schema (`supabase/schemas/`) and let the CLI diff | One file describing the end state | The directive forbids it ("Do not switch the repository to declarative schema files"), and independently: a declarative diff over data this stage does not understand produces a migration nobody reviewed. Imperative, numbered, commented forward migrations were kept |
| D. Apply to the connected remote project and iterate there | Fast | Forbidden, and would have put real (if scaffold-era) customer-shaped data at risk for a stage whose whole purpose was to decide the schema |

## 4. Chosen strategy

Nine imperative forward migrations, applied in filename order after the four published/Stage 0
migrations, taking 13 files in total to the current end state:

```
20260925120000_stage2_privilege_baseline.sql        schemas + fail-closed defaults, before any table exists
20260925120100_stage2_canonical_domain.sql          weddings, people, venues, events, packs, designs
20260925120200_stage2_versions_and_publication.sql  drafts, immutable versions, publications
20260925120300_stage2_guests_approvals_rsvp.sql     households, event scopes, RSVP, approval request/feedback
20260925120400_stage2_assets_entitlements_secrets.sql assets, entitlements, token digests, audit events
20260925120500_stage2_rls_and_grants.sql            46 policies + the privilege matrix, in one readable place
20260925120600_stage2_migrate_legacy_projects.sql   the copy: projects -> weddings, templates -> designs, + findings
20260925120700_stage2_archive_legacy_scaffold.sql   move the eight old tables to `legacy`, close the schema
20260925120800_stage2_relocate_security_helpers.sql private.* guard functions, drop the retired Stage 0 trigger
```

Rules held throughout: no existing migration file was edited; Stage 0 migrations were not touched; no
destructive `DROP TABLE … CASCADE` of customer-shaped data (data moves, it is not deleted); every
decision that could not be made from evidence was recorded as a refusal rather than guessed.

## 5. Old schema inventory (before Stage 2)

Nine tables in `public`, from the original scaffold plus Stage 0's repairs:

| Table | Fate |
| --- | --- |
| `projects` | superseded by `weddings` (+ `invitation_drafts`, `style_settings`); archived |
| `templates` | superseded by `design_templates`; archived |
| `guests` | superseded by `guest_households` + `household_event_scopes`; archived. It was **never** read by the app |
| `orders`, `payments` | no canonical replacement (commerce is Stage 10); archived |
| `printers` | no canonical replacement; archived |
| `activity_logs` | superseded in *intent* by `private.audit_events`, which has no writer yet; archived |
| `profiles`, `user_roles` | **retained unchanged** — they are the two old tables whose shape is right |

One enum (`app_role`) remains in `public` (C10). Two guard triggers from Stage 0 existed on
`projects.paid_status`; the file that retires them is listed in §4 and the consequence is §25
limitation 5.

Row shape of the archive was measured, not remembered: 7 projects, 6 templates, 3 guests, 2 orders,
2 payments, 1 printer, 2 activity logs (M56–M62).

## 6. Canonical schema inventory (after Stage 2)

**18 tables in `public`, 2 in `private`, 8 in `legacy`.**

* `public`: `profiles`, `user_roles`, `tradition_packs`, `design_templates`, `weddings`,
  `wedding_people`, `venues`, `wedding_events`, `invitation_drafts`, `invitation_versions`,
  `publications`, `guest_households`, `household_event_scopes`, `rsvp_responses`,
  `approval_requests`, `approval_feedback`, `wedding_assets`, `entitlements`
* `private`: `access_tokens`, `audit_events`
* `legacy`: `projects`, `templates`, `guests`, `orders`, `payments`, `printers`, `activity_logs`,
  `migration_findings` (the last one is new: it is where refusals are recorded)

Guarantees, read out of the live catalogue. **An earlier draft of this section said "45 foreign keys
(16 CASCADE, 21 NO ACTION, 4 RESTRICT, 4 SET NULL)" and it was wrong**: that was a whole-database
count which quietly included the nine foreign keys still attached to the archived `legacy` tables. The
numbers below were re-measured against the migrated database with per-schema queries, and the
canonical totals are also pinned by name in `40_catalog.sql`, so the mistake cannot return as a
quotation.

| Fact | `public` | `private` | `legacy` | Pinned by |
| --- | --- | --- | --- | --- |
| Tables | 18 | 2 | 8 archived | C05, C06, C03 |
| Foreign keys | 30 | 6 | 9 (out of scope) | C46 (all 36 canonical FKs, by name, with their action) |
| … of which `ON DELETE CASCADE` | 13 | 0 | — | C46, C35 |
| … `NO ACTION` / `SET NULL` / `RESTRICT` | 11 / 2 / 4 | 4 / 2 / 0 | — | C46 |
| CHECK constraints | 62 | 10 | — | C42, C42b, C43, C44, C45b |
| Non-constraint, non-primary indexes | 16 | 6 | — | C48, C50 |
| `updated_at` columns / `touch_updated_at` triggers | 13 / 13 | 0 / 0 | — | C37, C38 |
| Guard triggers (`reject_client_write` / `reject_client_delete`) | 7 / 3 | 2 / 2 | — | C31, C33, C34 |
| Row-level security policies | 46 | 0 (closed by grants) | 0 (closed by grants) | C18–C25b, C24, C04 |
| `SECURITY DEFINER` functions | 0 | 1 — `private.handle_new_user` | 0 | C26, C27, C28, C29 |

Policy commands, measured: 18 SELECT (exactly one per `public` table, C20), 10 UPDATE, 9 INSERT,
9 DELETE. No `float`/`double precision`/`money` column exists anywhere (C39) and `numeric` appears
only as a venue coordinate (C40). A deliberately loose substring scan for money words found exactly
one candidate, `approval_feedback.feedback_kind`, because `fee` is a prefix of `feedback` — a false
positive, and the reason C41's pattern is anchored on `_`/word boundaries and the offline domain test
on `[^a-z0-9]`. Under both, no `public` column holds an amount (C41 passes).

Client-visible surface: the generated types declare exactly the 18 `public` tables and none of the
`private` or `legacy` ones — asserted offline by `npm run dbtypes:check` and in-catalogue by C14/C17.

Per-table purpose, key shapes and the JSON-vs-column rule are in
[`../architecture/domain-model.md`](../architecture/domain-model.md).

## 7. Legacy / archive disposition

* Rows were **moved**, not copied: `ALTER TABLE … SET SCHEMA legacy` preserves the data, breaks every
  name-based reference to it, and cannot be re-interpreted as live truth by accident.
* Reachability: `anon`, `authenticated` **and `service_role`** hold no `USAGE` on the `legacy` schema
  and no privilege on any table in it — group 2 (**48 assertions**: three API roles × the eight
  archived tables × a read and a write attempt each) and C14/C16/C17b/C64. Reading the archive is a
  maintenance-session act.
* Zero policies exist on `legacy` tables (C04): closure is by privilege, which is the stronger
  statement — a policy would imply the table is reachable through the API at all.
* `legacy.migration_findings` holds one row per recorded refusal: **33 findings** in the fixture run
  (M35), each naming a source table, source id, field, the legacy value verbatim and a permitted
  action verb (M37). Two examples: the four `paid_status` claims were refused rather than mapped
  (M41, M63), and the three per-person guest rows were not turned into households (M43).
* Nothing was dropped, because the archived rows are evidence about claims already made to real
  people. The archive's disposal is undecided and is Stage 13's problem.

## 8. Data migration

`20260925120600` is the only file that moves domain data. Its contract:

* **Ids preserved.** `weddings.id = projects.id` and `design_templates.id = templates.id` for the rows
  that arrived (M01, M04), so any URL, log line or support note referencing an old id stays truthful.
* **Timestamps preserved verbatim**, not stamped with migration time (M08, M09, M10).
* **Ownership preserved** (`owner_user_id = user_id`), and every migrated wedding resolves to a live
  account (M06, M07).
* **Names mapped, meanings refused.** `title`/`language`/`guest_count` map to
  `title`/`primary_language`/`estimated_guest_count`; `paid_status`, `selected_features` and
  `template_id`'s billing implications do not map at all. `selected_features.editor` became
  `style_settings` only for the keys that are actually visual settings — unexplained keys were not
  smuggled in (M20).
* **No inference of culture or language.** An unmigratable language persists as NULL, which means
  "unknown" and is *not* the same fact as `'en'` (M11, M12). No tradition pack was inferred from a
  language or a template name, and the migration created none (M14, M15).
* **Nothing invented downstream:** no entitlement from a billing flag (M42), no household from a
  per-person row (M43), no event scope (M44), no RSVP answered on anyone's behalf (M45), no
  host/couple name parsed out of free text (M46), no venue from a title (M47), no event (M48), no
  version minted without a renderer (M49), nothing published (M50), no approval (M51, M52), no asset
  (M53), no credential (M54), no legacy log promoted into the audit trail (M55).
* **Two legacy rows were deliberately left behind** because they could not be mapped honestly: the
  fixture's 7 projects produced 5 weddings (M02, M03), and 6 templates produced 5 designs. Both
  refusals are findings, and the skipped pair is exactly the two title findings (M36).
* **Idempotent by key, not by hope:** re-applying the project mapping is refused by the preserved
  primary key, and the template mapping by the key or primary key, having written nothing (M71, M72,
  M73).

## 9. Legacy fixture results

Chain: bootstrap → 4 published migrations → `10_seed_legacy.sql` → 9 Stage 2 files →
`30_migration_legacy.sql` → `20_attacks.sql` → `40_catalog.sql`, run with
`bash supabase/tests/stage2/run.sh legacy`.

**75 migration-outcome assertions passed** (M00–M73), then 322 security assertions and 75 catalogue
assertions. The fixture is synthetic — two accounts, seven scaffold projects with deliberately bad
shapes (a paid-state claim, a duplicate template name, a nullable language, an owner with no account)
— and contains no real customer data.

## 10. Clean reset results

`bash supabase/tests/stage2/run.sh clean` runs the same chain without the fixture.

**41 assertions passed** (E01–E16, some of which check more than one thing): the chain creates
exactly the declared canonical tables, **every canonical table is empty**, no account, no profile, no
role row ("no convenience admin was invented", E05), the mapping invented nothing and said nothing
(E08), and all 28 base tables exist.

Why both: the fixture chain proves the migration *carries* what it should; the clean chain proves it
*creates* nothing it should not. Only one of those catches a fabrication bug.

`bash supabase/tests/stage2/run.sh both` — the mode used for the final gate — runs both chains and
echoes the totals: `41 + 322 + 75` and `75 + 322 + 75`.

## 11. RLS / grants matrix

Measured from the catalogue, not from documentation (C11–C17b, C18–C25b, C33–C36):

| Role | `public` | `private` | `legacy` |
| --- | --- | --- | --- |
| `anon` | **no privilege on any table**; no `USAGE` outside `public`, and zero visible rows even where a SELECT was handed to it on purpose (group 1b) | cannot name a table | cannot name a table |
| `authenticated` | `SELECT` on all 18; `INSERT/UPDATE/DELETE` on the 9 host-owned CRUD tables **plus `profiles`** (a host edits their own account record; RLS confines it to their row and C23 confirms `profiles` has SELECT+UPDATE policies only, never INSERT or DELETE); no write privilege on the 8 server-authored tables | no `USAGE`, no function execution | no `USAGE` |
| `service_role` | reaches canonical and server tables (trusted backend) | `USAGE` on `private` only | **nothing** |

Policy shape: 46 policies, **all** `TO authenticated`, **all** permissive, exactly one SELECT policy
per table (C18, C19, C20). Write policies exist on exactly the 10 grant-writable tables (C21), and the
eight server-authored tables carry **no write policy at all** (C22), so a client write fails at the
policy layer before any trigger is consulted. Every wedding-scoped policy
resolves ownership through `weddings` (C25b); the only two policies without an `auth.uid()` predicate
are the catalogue reads (C25). RLS is enabled on all 20 canonical tables and deliberately **not**
`FORCE`d (C02), so a trusted repair path remains possible — proven not to weaken a client, because no
client role has a bypass (C01/C02 with group 5).

## 12. Cross-user attacks

`20_attacks.sql` group 4, executed as `authenticated` holding two independent owners' identities:
**two-way isolation on 13 wedding-scoped tables plus `weddings` itself — 56 assertions.** Each table
is checked in both directions, so a policy that simply blocks everything cannot pass as isolation.

Group 6 (7 assertions) attacks the *WITH CHECK* side, where "cannot read another's row" is not enough:
handing a wedding to another account, stamping a guest answer as if the guest had sent it, and
cross-profile writes are all refused. Group 5 covers the account with no wedding at all: reads 0 rows,
deletes 0 rows, forges 0 rows across the 8 writable tables.

### Attack-suite coverage map

Every group in `20_attacks.sql`, so a reader can see what the 322 covers instead of trusting the
sections that quote it. The committed runner echoes only the total, so the per-group figures below
were measured: a scratch copy of the suite with one `RAISE NOTICE` of the running `passed` counter
inserted at each group header, run against the clean chain and then deleted. The column is that
counter's delta, and **the sixteen deltas add up to the printed 322**, which is what makes them a
measurement rather than a reading of the source.

| Group | What it attacks | Assertions |
| --- | --- | --- |
| 0 | the seed fixture is what the suite assumes it is (2 weddings) | 1 |
| 1 | `anon` refused at the **grant** layer, all canonical tables | 18 |
| 1b | `anon` visibility still zero when a SELECT grant is handed to it on purpose, then revoked | 8 (4 tables × 2) |
| 2 | `legacy` archive unreadable *and* unwritable for `anon`, `authenticated`, `service_role` | 48 |
| 3 | `private` unreachable for browser roles | 4 |
| 4 | two-way owner isolation on every wedding-scoped table and on `weddings` | 56 |
| 5 | an account with no wedding: reads 0, deletes 0, forges 0 across the 8 writable tables | 29 |
| 6 | ownership laundering, guest-attribution forgery, cross-profile writes | 7 |
| 7 | server-authoritative writes refused **by the row's own owner** | 19 |
| 8 | trigger backstop holds after a privilege *and* a permissive policy are granted | 6 |
| 9 | catalogue visibility matches `status` (deprecated hidden; draft/approved readable) | 4 |
| 10 | a customer can run its whole working set on a fresh wedding (1 create + 9 writes) | 10 |
| 11 | the delete paths: an owner may unmake its own wedding until history pins it; 11f pins a venue to its event; 11a–11e refuse for a trusted role too and prove cleanup still possible child-before-parent | 24 |
| 12 | cross-wedding references rejected by composite foreign keys, as the maintenance role | 12 |
| 13 | invalid states refused by the governing constraint, with per-row expected SQLSTATE | 71 |
| 14 | archived payment rows pin their account; the pin is ordered, not permanent | 5 |
| | **total printed by the suite, both chains** | **322** |

Groups 12, 13 and 14 are detailed in §15, §19 and §16; group 11's sub-cases in §14.

## 13. Anon attacks

Group 1: `anon` is refused at the grant layer on all 18 canonical tables (the privilege wall, checked
separately from RLS on purpose). Group 1b then *hands* `anon` a SELECT privilege on four tables inside
the transaction and proves row visibility is still zero through RLS, then reverts the grant — so the
"RLS hides it" claim is measured rather than assumed. C11 confirms `anon` holds no table privilege
anywhere in the database, and C57/C58 show that a table created after the baseline is invisible to
`anon` and to `authenticated` even with no policy on it.

## 14. Immutability tests

`invitation_versions` and `approval_feedback` are append-only; `publications` is append-only with an
explicit revoke timestamp.

* Group 7: the row's **own owner** may not rewrite a frozen snapshot or delete a version — refused
  like every other forbidden write.
* Group 8: the guards are proven to be a real second layer. The suite deliberately
  `GRANT UPDATE ON public.invitation_versions TO authenticated` and creates a permissive
  `WITH CHECK (true)` policy, then confirms the trigger still refuses the write (and the same for
  `entitlements` and feedback), then drops the temporary policy and privilege and asserts they are
  gone.
* Group 11b/11c: a frozen version pins its wedding **for trusted roles too**, and publications pin
  versions and feedback pins requests — so "immutable" is not merely a client-side rule.
* Group 11e: credentials outlive a refused wedding delete and are retired only on purpose.
* C34/C35/C36: every append-only table has a delete guard, nothing cascades into a guarded or
  append-only table, and append-only rows have no `updated_at` to maintain.

## 15. Cross-wedding FK tests

Group 12: **12 cross-wedding references rejected by composite foreign keys**, executed as the
maintenance role so the refusal cannot be credited to RLS. They include a scope opened for a wedding
that does not own the household, an RSVP recorded against another wedding's household, an approval
request pinned to a borrowed version, a publication naming another wedding's version, and a guest
credential issued over a stranger's household.

The mechanism is `UNIQUE (wedding_id, id)` on each parent plus a composite child FK, so a reference
that crosses a wedding boundary is **unrepresentable** rather than discouraged. C47 confirms every
composite cross-table reference is pinned to one wedding, and C49/C50 that every scoped table carries
a NOT NULL `wedding_id` with an index leading on it.

## 16. Entitlement tests

* Group 7 includes "mint an entitlement for my own wedding" (`INSERT … status='active'`) and granting
  myself `admin` in `user_roles` — both refused. Across the whole server-authoritative set, group 7
  refused **19 writes**.
* Group 8 shows the guard trigger still refuses an entitlement INSERT after the privilege and a
  permissive policy are handed to `authenticated`.
* C22 confirms `entitlements` has no write policy; C33 confirms it has a write guard; C12/C13 confirm
  it is not in the client grant set.
* No column in `public` holds an amount (C41, plus the offline assertion in
  `scripts/domain-contract.test.mjs`), and the only money-shaped thing is `package_code`, a code.
  Nothing in this build ever sets a row to `active`: the one-active-per-(wedding, package) partial
  unique index exists to keep a real grant from being duplicated later.
* Group 14 covers the archived side: `legacy.payments` rows pin their account, the pin is ordered
  rather than permanent, and the probe cleaned up after itself.

## 17. Private schema tests

Group 3: a browser role cannot `USAGE` the `private` schema, cannot name `private.access_tokens` or
`private.audit_events`, and cannot execute anything in it — 4 assertions at the grant layer plus C14,
C30, C61 and C62 (the last proving a function with no explicit revoke is still unreachable, because
schema `USAGE` is the wall). Neither private table appears in the generated client types, which
`npm run dbtypes:check` enforces offline.

### The cultural-identity guarantee (phases 66, and blueprint I-04/I-05)

Nothing in the schema may record or infer caste, sub-caste, jati, gotra, community, religion, sect,
ethnicity, mother tongue or blood group, and no row may be interpretable as declaring one. Enforced
and executed three ways, not asserted in prose:

* **In the catalogue** — C43 (`no column encodes caste, community, religion or inferred identity`)
  and C44 (`no table or constraint name encodes them either`), run against `pg_attribute`, `pg_class`
  and `pg_constraint` across `public`, `private` **and `legacy`**, so neither the canonical schema nor
  the archive can acquire such a column quietly, and a future migration fails the suite rather than
  the code review.
* **Offline** — `scripts/domain-contract.test.mjs` applies the same vocabulary to the migration text
  itself, **code-only**: SQL comments and string literals are stripped first, because the schema
  carries prose that *names* these words to explain the refusal. The test carries a control pair for
  every guard (a hostile name it must match, a near-miss it must not) so the pattern cannot pass by
  being too loose or fail by being too wide. 11 tests, executed in `npm test`.
* **Structurally** — tradition is a choice the host makes, expressed as two nullable foreign keys to
  the platform-owned `tradition_packs`: `weddings.tradition_pack_id` and
  `invitation_versions.tradition_pack_id`, both `ON DELETE RESTRICT`. There is no derivation path:
  no trigger, function or migration in `supabase/migrations/` produces one from a name, a phone
  country code, a location or a guest list, and `tradition_packs` holds 0 rows, so nothing was seeded
  from an inference either (`30_migration_empty.sql` on the clean chain, M14/M15 on the legacy one).

This is the invariant most likely to be re-broken by a well-meaning later stage, which is why it is a
failing test rather than a comment.

Token storage shape (phase 68): the columns mentioning "token" are exactly `token_hash` and
`token_kind`; the primary key is `id` and the digest is a separate `UNIQUE` constraint, so a rotation
replaces a value without replacing a row; `expiry_policy`, `expires_at`, `revoked_at`, `wedding_id`,
`publication_id`, `household_id` and `created_by_role` all exist; and C45b measures the digest column
is shaped like a SHA-256 hex value. **No code path in this build mints, reads or returns a token** —
there is no guest flow yet, and nothing in `src/` can reach the table.

## 18. Default-privilege tests

The risk this section covers is a table created *after* the baseline silently inheriting access.

C57–C60: a table created after the baseline is invisible to `anon` (C57) and to `authenticated`
(C58, with no grant and no policy), a new sequence is not usable by a client role (C59), and the
trusted backend *does* reach a new public table (C60) — the last one matters because a blanket
"nothing is granted" result would look identical to a broken test. All four run inside a transaction
that rolls the probe object back.

C63 is recorded as a **limitation, not a goal**: `ALTER DEFAULT PRIVILEGES … REVOKE ALL ON FUNCTIONS
FROM PUBLIC` changes nothing, measured on this schema — a newly created function's ACL still carries
the implicit `EXECUTE` to `PUBLIC`, because that grant is layered on top of the stored default list
rather than replaced by it. Function reachability is therefore controlled by schema `USAGE`, which is
why `private` is closed to browser roles and why C62 exists as its own assertion. Do not let a future
contributor read "13 ALTER DEFAULT PRIVILEGES statements" as "functions are fail-closed".

Related measurement, worth knowing when reading `pg_default_acl`: Postgres stores no row for a default
ACL that reduces to empty, so 13 `ALTER DEFAULT PRIVILEGES` statements appear in the catalogue as
**one** row. The suite asserts behaviour, not row counts.

## 19. Constraint tests

Group 13: **71 invalid states refused by the constraint that governs them**, each with an expected
SQLSTATE stored per row so a probe cannot pass for the wrong reason (23514 for CHECK, 23503 for FK,
23505 for unique). They cover negative and zero quantities, an out-of-vocabulary enum-ish text, a
blank reviewer name, an approval marked decided with no decision time, an `invalidated_at` without the
status that says so, feedback carrying a decision it should not have, a comment with no message, asset
keys that escape their prefix or traverse, a version numbered zero, a template revision of zero, a
publication with no `published_at`, and so on.

Aggregate counts: 72 CHECK constraints (62 in `public`, 10 in `private`; C42: every integer quantity
column is bounded; C42b: the
quantity columns are exactly the seven expected). C46 asserts every `ON DELETE` action is the chosen
one, by name — a drift from `NO ACTION` to `CASCADE` on a history table fails as a catalogue
assertion, not as a surprise.

## 20. Indexes

16 non-constraint indexes, each with a reason (phase 49), and **no index added for aesthetics**:

| Index | Why it exists |
| --- | --- |
| `weddings_owner_user_id_idx` | the dashboard's only query: "my weddings, newest first" |
| `wedding_people_wedding_order_idx`, `wedding_events_wedding_order_idx` | documents render people and events in `display_order` within one wedding |
| `wedding_events_venue_id_idx` | the FK column would otherwise be unindexed after `venues` is deleted-checked |
| `guest_households_wedding_name_idx` | the guest list is scrolled by name inside a wedding |
| `household_event_scopes_event_idx` | "who is invited to this event", the reverse direction of the scope PK |
| `rsvp_responses_wedding_event_idx` | per-event RSVP tallies |
| `wedding_assets_wedding_kind_idx` | the asset picker filters by kind |
| `invitation_versions_wedding_created_idx` | version history, newest first |
| `publications_wedding_version_idx` | the hot resolution path from a live publication to its version |
| `approval_requests_wedding_requested_idx`, `approval_requests_version_id_idx` | the review queue, and "is this version pending" |
| `approval_feedback_request_idx` | a thread under one request |
| `entitlements_wedding_id_idx` | the FK pin, needed by the delete-path probes |
| `one_active_publication_per_wedding` (unique, partial) | the invariant "at most one live publication", enforced by an index rather than a rule |
| `one_active_entitlement_per_wedding_package` (unique, partial) | the same idea for entitlements |

C48 accepts **twelve unindexed foreign keys by name** — each one a column whose only query direction
is through its composite parent pin; the assertion exists so a thirteenth cannot appear silently. C50
requires an index leading with `wedding_id` on every scoped table.

Phase 70 sanity, executed as `EXPLAIN` assertions rather than eyeballed plans: C52 the owner's wedding
list is served by an index; C53 resolving a live publication to its version needs no scan; C54 a
household RSVP write probes one index; C55 the review queue is already ordered by its index; C56 a
presented credential is looked up by its digest, not scanned. These are plan-shape assertions on a
small catalogue, so they prove the access path exists, **not** that it wins at production volume —
that claim needs data this stage refuses to fabricate.

## 21. App data-access changes

* `src/integrations/supabase/weddings.ts` (new) — the only module in `src/` that names a table:
  `weddings` and `design_templates`, 8 query sites. It returns `{ data, error }` with a log-safe
  phrase as the error, never a database message, because a raw error can name a table, a policy or a
  column that the customer is not entitled to learn.
* `ConfigureProject.tsx`, `CreateProject.tsx`, `Dashboard.tsx`, `EditProject.tsx` — rewired from
  `supabase.from('projects'|'templates')` to the adapter's functions. No new UI behaviour was added;
  the vocabulary in routes and copy stayed as-is deliberately (§26 of
  [`../architecture/domain-model.md`](../architecture/domain-model.md)).
* Retired fields removed from code: `paid_status`, `selected_features`, `guest_count`,
  `template_id`, `project_id`. They were not renamed into new fields with the same meaning —
  `style_settings` is constrained to an object and holds visual settings only.
* `scripts/check-product-contract.mjs` gained two rules that make the retirement stick: no client
  module may name a scaffold table in a `.from()` call, and no `src/` or README prose may describe
  `projects`/`templates` as a current table.
* `scripts/check-db-contract.mjs` + `scripts/db-contract.test.mjs` + `scripts/domain-contract.test.mjs`
  (new): an offline reconciliation of migrations ↔ generated types ↔ the adapter's queries, plus the
  domain rules that need no database. It parses the SQL itself and **fails loudly on any statement it
  cannot classify**, so it cannot rot into a checker that passes by understanding nothing.
* `src/test/fakeSupabase.ts` + `src/test/weddingQueries.test.tsx` (new): 13 behavioural tests that run
  the four pages against a hand-written Supabase double — including "an empty result is not an error",
  "a database message is never repeated to the caller", and "a wedding built on a retired design still
  opens".
* `package.json`: `typecheck`, `product:check`, `dbtypes:check`. `.github/workflows/ci.yml`: a
  `Database contract` step between `Typecheck` and `Product contract`. No CI job was weakened or
  removed, and no Postgres service was added to CI (that would need a runner this repository's quota
  cannot pay for right now).

## 22. Types generation / sync method

`src/integrations/supabase/types.ts` was produced by:

```
npx supabase gen types typescript \
  --db-url "postgres://postgres:<local-password>@127.0.0.1:<port>/appdb?sslmode=disable" \
  --schema public
```

against the throwaway local cluster that `bash supabase/tests/stage2/run.sh clean` builds. The
`--db-url` form (rather than `--linked`) is what keeps this honest: it cannot reach a project the CLI
is linked to, and nothing was linked. `--schema public` is deliberate — `private` and `legacy` have no
browser-readable surface, so they must not appear in a type client code can reach. **No remote
`gen types` was run.** The method is recorded in the file's own header.

Sync is then *checked*, not trusted: `npm run dbtypes:check` reconciles the declared types against the
end state folded out of the migration files (18 client tables = 18 public tables, 0 findings) and
reconciles the adapter's `select` strings against those columns. Regenerating types is therefore a
build step, not a manual edit; hand-editing `types.ts` to make code compile is the failure mode this
gate exists to catch.

## 23. Local Supabase vs plain Postgres — the testing boundary

**What ran on plain Postgres.** Every number in §9–§20 comes from
`supabase/tests/stage2/run.sh`, which starts `postgres:16-alpine` (measured: `PostgreSQL 16.15`) or
accepts an existing cluster via `STAGE2_LOCAL=1`, and applies
`supabase/tests/rls/00_bootstrap.sql`. That bootstrap reproduces *only* the pieces the migrations
depend on: the three API roles, an `auth.users` table, `auth.uid()`/`auth.role()` reading session GUCs
instead of JWT claims, and default grants. It therefore proves the schema, the grants, the policies and
the migration. **It does not prove PostgREST or Supabase Auth behaviour, because neither was
running.** The runner prints that boundary on stdout at the end of every successful run, so it cannot
be quoted out of context.

**What additionally ran on a real Supabase-managed Postgres** (this was attempted at the reviewer's
request, and it succeeded):

```
npx supabase db start      # CLI 2.118.0, image public.ecr.aws/supabase/postgres:17.6.1.171
```

* The CLI applied **all 13 migrations in order, with no error**, into a database that already had the
  platform's own `auth` schema, `auth.users`, `supabase_migrations` bookkeeping and role defaults.
  Measured there: 18 `public` tables, `relrowsecurity` true on all 18.
* `anon` held **0** privileges on `public` tables; `authenticated` held SELECT on 18 and
  INSERT/UPDATE/DELETE on exactly 10 — the same matrix §11 claims, produced by the same migration
  files, in an environment where Supabase's *own* default privileges do name the API roles. This is
  the case the plain shim cannot exhibit, and it is the reason §18's revoke work had to exist.
* A table created afterwards inside that database inherited privileges for `postgres` and
  `service_role` only — `anon` and `authenticated` inherited nothing. C57/C58's synthetic probe and
  the real platform default now agree.
* Zero `USAGE` on `legacy` for `anon`, `authenticated` and `service_role`.
* The signup trigger fired on the platform's real `auth.users`: one insert produced exactly one
  `profiles` row and one `user_roles` row, and the profile was then visible to its own user through
  RLS.
* `auth.uid()` resolved from the platform's JWT GUC (`request.jwt.claim.sub` in this image); as
  `authenticated`, an INSERT of a wedding owned by `auth.uid()` succeeded and was visible to its owner,
  and an INSERT naming **someone else's** user id was refused with `42501 new row violates
  row-level security policy`.
* Everything above ran inside explicit transactions that were rolled back; the container and its
  disposable volume were then removed (`supabase stop`, `docker volume rm`), and the temporary
  `supabase/config.toml` port override used for the attempt was reverted, so the committed config is
  unchanged.

**What was not run, and why.** Only the database service was started (`db start`), not the full API
stack: `PostgREST`, `gotrue`, `kong`, `storage` and `realtime` were never pointed at this project's
schema, so **no REST-level or JWT-issuance behaviour is claimed anywhere in this document**. A second
full local stack was deliberately not started, because this machine is *already* running a complete
Supabase stack for a different project (verified with `docker ps`: the `…_dueweave` containers occupy
the default local API and DB ports). Starting ours would have collided with, or required
reconfiguring, shared local infrastructure belonging to unrelated live work. That other stack was not
read, not linked, not reconfigured and not used as a test target at any point.

`supabase/config.toml` was inspected as required: it carries the Lovable-era `project_id`
(`hgvztvaoebeyjnyfarii`) and no active function configuration. That id was never linked against. Its
presence is listed as a known limitation (§25), not silently cleaned up, because removing it is a
decision about project identity rather than a Stage 2 schema matter.

That last sentence is a security claim, so it was measured rather than asserted. The signed-out app
was loaded in a browser against a local dev server and its full request log was captured: **86
requests, of which 0 touched that project host or any `supabase.co` address** — the Supabase client is
constructed at import time but only ever reads `localStorage` until a form is submitted. 7 of the 86
left the machine for a *different* destination: one `fonts.googleapis.com` stylesheet and six
`fonts.gstatic.com` font files. So the accurate statement is "no call to the connected project", not
"no network activity"; an earlier draft of this paragraph implied the stronger form and was wrong.

## 24. Dependency / build gates

The install gate (`rm -rf node_modules && npm ci`) ran at 04:13 IST on 2026-09-26, which postdates
the last change to `package.json` and `package-lock.json`, so every npm gate below ran against a
from-scratch `node_modules`. Every gate in the table was then **re-run in one pass after the final
edit of this stage** — that last edit was to prose in `stage-2-migration-plan.md` §7.2, and
`npm run product:check` reads prose, so a documentation edit is a gate-invalidating edit rather than
a safe one. The numbers in the table are from that post-final-edit pass; they were identical to the
pass it replaced, which is the point of re-running rather than of running once. Exact numbers, not
summaries:

| Gate | Command | Result |
| --- | --- | --- |
| Clean install | `rm -rf node_modules && npm ci` | exit 0, `added 506 packages`; `package-lock.json` is the lockfile of record; `pnpm-lock.yaml`/`pnpm-workspace.yaml` were left untouched and are **not** part of this branch's diff. npm reported 2 install scripts it does not allow (`@swc/core`, `esbuild`) — an environment policy, not a repo change, and every gate below still passed |
| Lint | `npm run lint` | exit 0 — **8 problems, 0 errors, 8 warnings**, all `react-refresh/only-export-components` on pre-existing component modules |
| Types | `npm run typecheck` | exit 0, clean; no `any`, no `as unknown as` added anywhere in the Stage 2 diff |
| Product contract | `npm run product:check` | exit 0 — `126 active file(s) scanned, 0 violation(s)` |
| Database contract | `npm run dbtypes:check` | exit 0 — `13 migration file(s)`, `18 public + 10 non-client table(s)`, `client types: 18 table(s)`, `data layer: 8 query column group(s) reconciled, 0 finding(s)` |
| Unit tests | `npm test` | exit 0 — **59 tests in 7 files**, all passing |
| Build | `npm run build` | exit 0 — `dist/assets/index-*.js 745.65 kB` (gzip 229.50 kB). Vite's chunk-size warning fires and was **not** suppressed by raising `chunkSizeWarningLimit`; the bundle was not this stage's subject and no code-splitting claim is made for it |
| Production audit | `npm audit --omit=dev --audit-level=high` | exit 0 — **0 high/critical**. 2 **moderate** advisories remain, both in `react-router` / `react-router-dom` (an open-redirect bypass and an SSR-hydration error-deserialisation issue); the fix is a breaking major-version bump, which is a dependency decision rather than a Stage 2 schema change, so it was recorded instead of applied |
| Stage 0 regression | `bash supabase/tests/rls/run.sh` | exit 0 — `STAGE0 RLS TESTS PASSED (24)` |
| Stage 2 qualification | `bash supabase/tests/stage2/run.sh both` | exit 0 — clean `41 + 322 + 75`; legacy `75 + 322 + 75` |
| Diff hygiene | `git diff --check` | exit 0 — no whitespace errors. One non-finding was printed: `LF will be replaced by CRLF` on `src/integrations/supabase/types.ts`, caused by `core.autocrlf=true` in this machine's **system** Git config (verified: local and global are unset). Git was not reconfigured; the committed blob stays LF |

The paragraph above is not self-invalidating, and it is worth naming why: `check-product-contract.mjs`
walks `docs/` but excludes `docs/audits/` and `scripts/` by prefix (its own `EXCLUDED_PREFIXES`), so
this file is the one document in the stage that no gate reads. `docs/architecture/` **is** read, which
is why §7.2's edit forced the re-run rather than being waved through.

The Stage 0 suite needed one change and it is worth stating plainly: its runner enumerates migration
files, and Stage 2's `_stage2_` files would have been applied into the Stage 0 fixture database. The
runner now excludes them, which is what keeps the Stage 0 baseline a baseline instead of a partially
upgraded schema. **No Stage 0 migration or assertion was edited.**

## 25. Known limitations

Stated as findings, not as caveats. Ordered by how much they could bite.

1. **API-level behaviour is unverified.** The plain-Postgres suites prove grants, policies, triggers
   and migrations; the real-Supabase run in §23 proves the same files under the platform's own image,
   roles, `auth` schema and default privileges. Neither proves PostgREST filtering, JWT issuance,
   storage policies or Auth email flows. Any Stage 3 claim about "the public page resolves a token"
   needs a full local stack or a real project.
2. **`invitation_drafts` is not created for a wedding made by the app.** The domain says one draft per
   wedding, and the migration path honours that (M31, M32: one empty draft for each of the five
   migrated weddings). But `createWedding()` inserts only a `weddings` row, so a wedding created
   through the UI has **no draft row**, and no screen reads drafts anyway. This is a real gap between
   the documented invariant and the product path. It is *not* closed by adding a trigger quietly at
   the end of a stage; Stage 5's editor or an explicit follow-up should own it.
3. **The audit trail has a table and no writer.** `private.audit_events` exists, is server-only, is
   shaped for non-forgeable attribution, and is written by nothing in product code. Blueprint
   invariant I-25 is therefore only partially satisfied, and the "logged" half of I-09 is not
   satisfied at all.
4. **Account and wedding deletes now fail loudly where history is pinned.** Chosen deliberately
   (§7.1 of [`../architecture/stage-2-migration-plan.md`](../architecture/stage-2-migration-plan.md)),
   but it has an operational cost nobody has felt yet: an owner deleting a wedding that carries an
   entitlement, a frozen version or a publication is *refused* (11a, 11b, 11c), and an account whose
   archived payment rows exist cannot be cascade-deleted (group 14). There is no product flow that
   performs the ordered cleanup. Stage 13 must build it, and until then "delete my data" has no
   answer that satisfies both the privacy request and the immutability guarantee.
5. **The Stage 0 `paid_status` guard no longer protects anything, because its column is gone.** The
   trigger was dropped with its table in file 8 and lives on only in `legacy`, which no API role can
   reach. The replacement guarantees are structural, not trigger-based: `weddings` has no billing
   column at all (C41) and `entitlements` refuses client writes (groups 7 and 8). The history is
   relevant: Stage 0 found a client-writable paid state, then found the INSERT path bypassed the
   UPDATE-only guard. That is why group 7 attacks INSERT *and* UPDATE on every trusted column, and why
   the offline domain test refuses any monetary column in `public`/`private` outright.
6. **Default privileges cannot revoke `PUBLIC EXECUTE` on functions** (§18, measured, C63). Function
   reachability rests on schema `USAGE`, so a future function placed in `public` would be executable
   by browser roles by default. C29 asserts no function lives in `public` today; keep it that way.
7. **`supabase/config.toml` still names a Lovable-era `project_id`.** Inert in this stage (nothing was
   linked or pushed), but it is a loaded gun for a future contributor running `supabase link` /
   `db push`. It needs an explicit ownership decision, not a silent edit.
8. **No down migrations.** Forward-only. What is reversible, what copies data, and what makes rollback
   hard is written out in the blueprint's outcome section rather than hand-waved; a restore from backup
   is the actual rollback plan.
9. **The catalogue's numbers are small.** `EXPLAIN` assertions prove an access path exists; they do not
   prove query performance at production volume, and no synthetic volume test was run (that would have
   meant inventing customer-shaped data at scale).
10. **Platform content is empty by design and untested with real content.** `tradition_packs` has 0
    rows and the 5 `design_templates` rows come from the migrated fixture, not from review. The
    five-seed count in §6 is a *fixture* count; a freshly reset database has an empty catalogue (E02).
    No reviewed, culturally-checked pack or design exists yet, so the cultural-safety argument in
    [`../product/invitation-semantics.md`](../product/invitation-semantics.md) is still untested against
    real content.
11. **Hosted CI is not green, and that is not a code result.** The private repository's Actions
    runner quota is exhausted, so runs are deferred — classified as `EXTERNAL CI QUOTA DEFERRAL`. CI
    was not weakened, not removed, and not re-run repeatedly to fish for a green badge.
12. **The synthetic fixture is not real history.** It was written to contain the shapes the scaffold
    actually produced (nullable language, duplicate names, a paid claim, an orphan owner), and it
    contains no customer data. Real production history, if any exists elsewhere, has not been migrated
    by these files.

## 26. No remote deployment — confirmation

* No `supabase link`, no `supabase db push`, no remote SQL editor, no remote project contact, no
  migration applied outside a container or a local cluster created for this purpose.
* No deployment, no hosting change, no domain, no DNS, no certificate, no purchase, no registration,
  no third-party service added.
* No tag, no release, no merge into `main`. `origin/main` remains
  `e93912d780fc813e1e9b79bf8858638cbec4fd6b`.
* Nothing was pasted into a command or a report from a credential file. The local database password
  used in §23 was the disposable container's own trust/`postgres` value and is not reproduced here.
* The only files written outside the repository were scratch databases and throwaway containers, all
  removed or stopped by the end of the stage; the temporary `supabase/config.toml` edit used for the
  local attempt was reverted and is not in the diff.

---

## What Stage 2 did not do

It did not render an invitation. No `/i/:token` route, no guest page, no public invitation API, no OG
generator, no QR, no PDF, no WhatsApp share, no no-login approval UI, no RSVP UI, no event/venue/
family editor, no payment checkout, no provider integration, no admin panel. Those are Stage 3 and
later, and the tables that will support them are marked `PLANNED V1` — not "done" — in
[`../product/feature-readiness.md`](../product/feature-readiness.md).
